// ════════════════════════════════════════════════════════════════════
//  📦 v848 · PORTABILIDAD DE LOS DATOS DE UN JUGADOR (RGPD art. 20)
// ════════════════════════════════════════════════════════════════════
//  Reauditoría del 31-10: «la portabilidad está descrita como exportación,
//  pero el formato JSON/CSV estructurado sigue pendiente». Hasta aquí sólo
//  había TXT/PDF de informes: legibles para una persona, no para otra
//  plataforma.
//
//  QUIÉN Y DÓNDE. En el modelo del proyecto el CLUB es el responsable y
//  Chronos el encargado (encargo.html): la familia pide sus datos al club y
//  el club los entrega. Por eso la herramienta vive en la pestaña de
//  Informes de Dirección, junto al resumen de cada equipo, y sólo la ven los
//  roles del lado del responsable (`_sdPuedeAtenderDerechos`).
//
//  🔑 NO HACE NI UNA CONSULTA NUEVA DE INFORMES. Trabaja sobre lo que esa
//  pestaña YA ha leído y pinta (`_sdStatsData`, `_sdPartidosClub`,
//  `_sdPlantillasData`): mismas reglas de Firestore, ningún permiso nuevo, y
//  el fichero no puede decir otra cosa que la pantalla. La única lectura
//  propia es el extracto de asistencia de ESE jugador
//  (clubs/{club}/attendance_players/{equipo}__{ficha}), que la regla ya deja
//  leer a Dirección.
//
//  🔑🔑 LA IDENTIDAD ES LA DEL ACUMULADO, NO UNA NUEVA. Qué entradas de un
//  informe son «este jugador» lo decide la misma regla que
//  `ctAccumulatePlayerStats` (category-tree.js): el código de ficha, con los
//  informes viejos traducidos desde su dorsal sólo si el par es inequívoco,
//  y los invitados por su ficha de origen. Y las cifras de cada partido se
//  calculan LLAMANDO a ese acumulador con el partido reducido a este
//  jugador: una segunda forma de contar minutos acabaría discrepando.
//  El guard test_portabilidad_jugador.js compara las dos.
//
//  QUÉ NO SALE, a propósito (va escrito dentro del propio JSON):
//   · datos de TERCEROS: comentarios del partido, registros colectivos y
//     los demás jugadores;
//   · los contactos de la familia (son datos de los padres, no del menor, y
//     viven en el documento privado del entrenador);
//   · los vídeos: son ficheros, no datos estructurados (se entregan aparte
//     si se piden).
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var FS_URL  = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
    var ESQUEMA = 'chronos.portabilidad.jugador/1';

    var ESTADOS = { P: 'Presente', R: 'Presente con retraso', I: 'Falta injustificada', J: 'Falta justificada' };

    function _t(v) { return String(v == null ? '' : v).trim(); }

    // ── Identidad (la regla de ctAccumulatePlayerStats) ─────────────────
    // Pares dorsal de plantilla → código, para traducir los informes viejos.
    function _codigosDeDorsal(partidos) {
        var mapa = {};
        (partidos || []).forEach(function (m) {
            ((m && Array.isArray(m.players)) ? m.players : []).forEach(function (p) {
                if (!p || p.isGuest === true) return;
                var c = _t(p.playerCode), rn = _t(p.rosterNumber);
                if (!c || !rn) return;
                (mapa[rn] = mapa[rn] || {})[c] = true;
            });
        });
        return function (num) {
            var s = num ? mapa[num] : null;
            var ks = s ? Object.keys(s) : [];
            return ks.length === 1 ? ks[0] : '';
        };
    }

    function _claveEntrada(p, codigoDeViejo) {
        var num   = _t(p.playerNumber);
        var alias = _t(p.playerAlias || p.playerName).toLowerCase();
        if (p.isGuest === true && p.originPlayerId) return 'f:' + _t(p.originPlayerId);
        var cod = (p.isGuest === true) ? '' : (_t(p.playerCode) || codigoDeViejo(num));
        return cod ? 'c:' + cod : (num ? 'n:' + num : 'a:' + alias);
    }

    // La clave con la que este jugador aparece en el acumulado de su equipo.
    function _claveJugador(j) {
        if (_t(j.ficha))  return 'c:' + _t(j.ficha);
        if (_t(j.dorsal)) return 'n:' + _t(j.dorsal);
        return 'a:' + _t(j.alias || j.nombre).toLowerCase();
    }

    // Las cifras de ESTE jugador en UN partido, con el acumulador oficial.
    function _cifras(m, entradas) {
        if (!entradas.length || typeof window.ctAccumulatePlayerStats !== 'function') return null;
        var solo = Object.assign({}, m, { players: entradas });
        return window.ctAccumulatePlayerStats([solo])[0] || null;
    }

    function _bloqueCifras(f) {
        f = f || {};
        var out = {
            convocatorias:   f.called || 0,
            partidosJugados: f.pj || 0,
            titularidades:   f.pt || 0,
            segundos:        f.seconds || 0,
            minutos:         f.minutes || 0,
            goles:           f.goals || 0,
            amarillas:       f.yellow || 0,
            rojas:           f.red || 0,
            lesiones:        f.injuries || 0,
            perdidas:        f.prPerdidas || 0,
            recuperaciones:  f.prRecuperaciones || 0,
        };
        if (f.sav) out.estadisticasAvanzadas = Object.assign({}, f.sav);
        return out;
    }

    function _partido(m, entradas, miClub, invitadoEn) {
        var enf = (typeof window.cronosEnfrentamiento === 'function')
            ? window.cronosEnfrentamiento(m, miClub) : null;
        var p0 = entradas[0] || {};
        var incid = [];
        if (typeof window.rxLineasIncidencias === 'function') {
            entradas.forEach(function (p) { incid = incid.concat(window.rxLineasIncidencias(p) || []); });
        }
        var c = _bloqueCifras(_cifras(m, entradas));
        return {
            partidoId:    _t(m.matchId),
            fecha:        _t(m.matchDate),
            rival:        _t(m.rival),
            tipo:         _t(m.matchType),
            categoria:    _t(m.category),
            subcategoria: _t(m.subcategory),
            localia:      m.myTeamRole === 'away' ? 'visitante' : 'local',
            marcador:     enf ? enf.marcador : '',
            resultado:    enf ? enf.veredicto : '',
            equipoAnfitrion: invitadoEn || '',
            participacion: {
                dorsal:       _t(p0.playerNumber),
                posicion:     _t(p0.position),
                titular:      c.titularidades > 0,
                jugo:         c.partidosJugados > 0,
                segundos:     c.segundos,
                minutos:      c.minutos,
                goles:        c.goles,
                amarillas:    c.amarillas,
                roja:         c.rojas > 0,
                lesion:       c.lesiones > 0,
                perdidas:     c.perdidas,
                recuperaciones: c.recuperaciones,
                estadisticasAvanzadas: c.estadisticasAvanzadas || null,
                incidencias:  incid,
            },
        };
    }

    function _asistencia(doc) {
        if (!doc) return { disponible: false, dias: [] };
        var days = (doc.days && typeof doc.days === 'object') ? doc.days : {};
        var motivo = (window.CronosAttendance && typeof window.CronosAttendance.motivoLabel === 'function')
            ? window.CronosAttendance.motivoLabel : function (id) { return id || ''; };
        var dias = Object.keys(days).sort().map(function (fecha) {
            var v = days[fecha] || {};
            return {
                fecha:       fecha,
                sesion:      _t(v.t),
                estado:      _t(v.s),
                estadoTexto: ESTADOS[v.s] || '',
                motivo:      _t(v.m),
                motivoTexto: v.m ? motivo(v.m) : '',
            };
        });
        return { disponible: true, dias: dias };
    }

    // ════════════════════════════════════════════════════════════════
    //  cronosPortabilidadJugador(ctx) → objeto listo para JSON.stringify
    //  ctx = { club:{id,nombre}, equipo:{teamId,categoria,subcategoria,
    //          etiqueta}, jugador:{ficha,dorsal,nombre,alias},
    //          partidosEquipo:[m], partidosClub:[m], asistencia:doc|null,
    //          generadoPor:{uid,nombre,rol}, ahora:ISO }
    //  PURA: no lee nada de fuera salvo los helpers de cálculo compartidos.
    // ════════════════════════════════════════════════════════════════
    window.cronosPortabilidadJugador = function (ctx) {
        ctx = ctx || {};
        var j       = ctx.jugador || {};
        var equipo  = ctx.equipo || {};
        var miClub  = (ctx.club && ctx.club.nombre) || 'Mi equipo';
        var propios = Array.isArray(ctx.partidosEquipo) ? ctx.partidosEquipo : [];
        var clave   = _claveJugador(j);

        // Partidos de SU equipo.
        var deViejo = _codigosDeDorsal(propios);
        var partidos = [];
        propios.forEach(function (m) {
            var ent = ((m && m.players) || []).filter(function (p) {
                return p && p.isGuest !== true && _claveEntrada(p, deViejo) === clave;
            });
            if (ent.length) partidos.push(_partido(m, ent, miClub, ''));
        });

        // Plazas de apoyo: sus minutos con OTRO equipo del club, donde va
        // como invitado y se le reconoce por su ficha de origen.
        var colaboraciones = [];
        var ficha = _t(j.ficha);
        if (ficha && Array.isArray(ctx.partidosClub)) {
            var yaPropio = {};
            propios.forEach(function (m) { if (m) yaPropio[m.key || m.matchId] = true; });
            ctx.partidosClub.forEach(function (m) {
                if (!m || yaPropio[m.key || m.matchId]) return;
                var ent = (m.players || []).filter(function (p) {
                    return p && p.isGuest === true && _t(p.originPlayerId) === ficha;
                });
                if (!ent.length) return;
                var anfitrion = [_t(m.category), _t(m.subcategory)].filter(Boolean).join(' ');
                colaboraciones.push(_partido(m, ent, miClub, anfitrion || 'otro equipo'));
            });
        }

        // El resumen de temporada es la fila del acumulado de su equipo: la
        // MISMA que se ve en pantalla (cero si aún no ha jugado).
        var filaTemporada = null;
        if (typeof window.ctAccumulatePlayerStats === 'function') {
            window.ctAccumulatePlayerStats(propios).forEach(function (f) {
                if (f.isGuest) return;
                var k = _claveJugador({ ficha: f.ficha, dorsal: f.number, alias: f.alias });
                if (k === clave) filaTemporada = f;
            });
        }

        return {
            esquema: ESQUEMA,
            generado: {
                fecha: ctx.ahora || new Date().toISOString(),
                por:   ctx.generadoPor || null,
                herramienta: 'Chronos Fútbol',
            },
            responsable: { clubId: _t(ctx.club && ctx.club.id), club: _t(ctx.club && ctx.club.nombre) },
            interesado: {
                ficha:  ficha,
                dorsal: _t(j.dorsal),
                nombre: _t(j.nombre),
                alias:  _t(j.alias),
                equipo: {
                    teamId:       _t(equipo.teamId),
                    categoria:    _t(equipo.categoria),
                    subcategoria: _t(equipo.subcategoria),
                    etiqueta:     _t(equipo.etiqueta),
                },
            },
            resumenTemporada: _bloqueCifras(filaTemporada),
            partidos:         partidos,
            colaboraciones:   colaboraciones,
            asistencia:       _asistencia(ctx.asistencia),
            notas: {
                incluye: ['ficha publicada del jugador', 'participación por partido (informes del club)',
                          'colaboraciones con otros equipos del club', 'asistencia a entrenamientos y partidos'],
                excluye: ['datos de terceros (comentarios del partido, registros colectivos, otros jugadores)',
                          'contactos de la familia (son datos de los padres)',
                          'vídeos de jugadas (ficheros: se entregan aparte si se solicitan)'],
            },
        };
    };

    // ── CSV: una tabla limpia por fichero, una cabecera y nada más ──────
    window.cronosPortabilidadFilasPartidos = function (d) {
        var filas = [['Fecha', 'Equipo anfitrión', 'Rival', 'Localía', 'Marcador', 'Resultado', 'Tipo',
                      'Dorsal', 'Titular', 'Minutos', 'Goles', 'Amarillas', 'Roja', 'Lesión',
                      'Pérdidas', 'Recuperaciones', 'Incidencias']];
        (d.partidos || []).concat(d.colaboraciones || []).forEach(function (p) {
            var x = p.participacion || {};
            filas.push([p.fecha, p.equipoAnfitrion || d.interesado.equipo.etiqueta, p.rival, p.localia,
                        p.marcador, p.resultado, p.tipo, x.dorsal, x.titular ? 'Sí' : 'No', x.minutos,
                        x.goles, x.amarillas, x.roja ? 'Sí' : 'No', x.lesion ? 'Sí' : 'No',
                        x.perdidas, x.recuperaciones, (x.incidencias || []).join(' | ')]);
        });
        return filas;
    };

    window.cronosPortabilidadFilasAsistencia = function (d) {
        var filas = [['Fecha', 'Sesión', 'Estado', 'Motivo']];
        ((d.asistencia && d.asistencia.dias) || []).forEach(function (a) {
            filas.push([a.fecha, a.sesion, a.estadoTexto || a.estado, a.motivoTexto || a.motivo]);
        });
        return filas;
    };

    // ── Quién puede: los roles del lado del responsable ─────────────────
    // Una función por regla (ver club-reports.js): hoy coincide con quien
    // puede purgar —Director, Administrador del Club, SuperAdmin y el titular
    // de un ente individual—, pero es OTRA decisión y puede separarse.
    window._sdPuedeAtenderDerechos = function (user) {
        return typeof window._sdPuedePurgar === 'function' && window._sdPuedePurgar(user);
    };

    // ════════════════════════════════════════════════════════════════
    //  LA PANTALLA: elegir jugador → preparar → descargar
    // ════════════════════════════════════════════════════════════════
    function _esc(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(_t(s))
            : _t(s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function _toast(msg, ms) { if (typeof showToast === 'function') showToast(msg, ms || 3000); }

    function _cerrar() { var o = document.getElementById('cq-porta-ov'); if (o) o.remove(); }
    window.cronosPortabilidadCerrar = _cerrar;

    function _overlay(html) {
        _cerrar();
        var o = document.createElement('div');
        o.id = 'cq-porta-ov';
        o.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.65);' +
            'display:flex;align-items:center;justify-content:center;padding:16px;';
        o.innerHTML = '<div style="background:#161b22;border:1px solid rgba(88,166,255,0.35);border-radius:12px;' +
            'max-width:520px;width:100%;max-height:85vh;overflow:auto;padding:1rem 1.1rem;color:#c9d1d9;">' +
            html + '<button onclick="cronosPortabilidadCerrar()" style="margin-top:0.9rem;width:100%;' +
            'padding:0.55rem;background:transparent;border:1px solid rgba(255,255,255,0.15);border-radius:8px;' +
            'color:#8b949e;cursor:pointer;">Cerrar</button></div>';
        o.addEventListener('click', function (e) { if (e.target === o) _cerrar(); });
        document.body.appendChild(o);
    }

    // Lista de jugadores del equipo: la plantilla publicada y, además, quien
    // tenga informes sin estar en ella (p. ej. una ficha antigua).
    function _jugadoresDe(skey) {
        var lista = [], visto = {};
        ((window._sdPlantillasData || {})[skey] || []).forEach(function (j) {
            var k = _claveJugador(j);
            if (visto[k]) return;
            visto[k] = true;
            lista.push({ ficha: j.ficha, dorsal: j.dorsal, nombre: j.nombre, alias: j.alias });
        });
        var ms = (window._sdStatsData || {})[skey] || [];
        if (typeof window.ctAccumulatePlayerStats === 'function') {
            window.ctAccumulatePlayerStats(ms).forEach(function (f) {
                if (f.isGuest) return;
                var j = { ficha: f.ficha || '', dorsal: f.number || '', nombre: '', alias: f.alias || '' };
                var k = _claveJugador(j);
                if (visto[k]) return;
                visto[k] = true;
                lista.push(j);
            });
        }
        lista.sort(function (a, b) {
            var na = parseInt(a.dorsal, 10), nb = parseInt(b.dorsal, 10);
            na = isNaN(na) ? Infinity : na; nb = isNaN(nb) ? Infinity : nb;
            return na !== nb ? na - nb : String(a.alias).localeCompare(String(b.alias), 'es');
        });
        return lista;
    }

    window.cronosPortabilidadAbrir = function (skey) {
        var me = window._cronosCurrentUser || {};
        if (!window._sdPuedeAtenderDerechos(me)) { _toast('⚠️ Sólo Dirección o la administración del club.'); return; }
        var lista = _jugadoresDe(skey);
        window._cqPortaLista = lista;
        window._cqPortaSkey = skey;
        var filas = lista.map(function (j, i) {
            return '<button onclick="cronosPortabilidadPreparar(' + i + ')" style="display:flex;gap:0.6rem;' +
                'align-items:center;width:100%;text-align:left;padding:0.5rem 0.7rem;margin-bottom:0.3rem;' +
                'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;' +
                'color:#c9d1d9;cursor:pointer;font-size:0.82rem;"><span style="min-width:1.8rem;color:#8b949e;' +
                'font-weight:700;">' + _esc(j.dorsal || '–') + '</span><span style="flex:1;">' +
                _esc(j.nombre || j.alias) + '</span><span style="color:#8b949e;font-size:0.7rem;">' +
                _esc(j.ficha) + '</span></button>';
        }).join('');
        _overlay('<div style="font-weight:800;color:#79c0ff;margin-bottom:0.25rem;">📦 Portabilidad de datos</div>' +
            '<div style="font-size:0.74rem;color:#8b949e;margin-bottom:0.8rem;">Elige el jugador cuyos datos ha ' +
            'solicitado la familia. Se genera un JSON completo y dos CSV (partidos y asistencia). Entrégalos sólo ' +
            'a quien ejerce el derecho.</div>' + (filas || '<div style="font-size:0.8rem;">Este equipo no tiene ' +
            'jugadores con datos.</div>'));
    };

    // ⚠️ SE PREPARA ANTES DE DESCARGAR. En el iPad la entrega va por
    // `navigator.share`, que exige el gesto del usuario: si la lectura de la
    // asistencia ocurriera dentro del clic de «descargar», el permiso
    // caducaría (ver reports-export.js). Así que primero se lee y se monta
    // todo, y los botones de descarga ya sólo entregan texto hecho.
    window.cronosPortabilidadPreparar = async function (i) {
        var j = (window._cqPortaLista || [])[i];
        var skey = window._cqPortaSkey || '';
        if (!j) return;
        var me = window._cronosCurrentUser || {};
        var clubId = window._testRoleClubId || me.clubId || '';
        var cat = skey.split('|')[0], sub = skey.split('|')[1] || '';
        var teamId = (typeof window.cronosTeamId === 'function') ? window.cronosTeamId(clubId, cat, sub) : '';
        var def = (window.CT_CATEGORIES || []).filter(function (c) { return c.id === cat; })[0];
        var etiqueta = ((def && def.label) || cat) + (sub ? ' ' + sub : '');

        _overlay('<div style="font-size:0.85rem;">⏳ Preparando los datos de ' + _esc(j.nombre || j.alias) + '…</div>');

        var asist = null;
        if (j.ficha && teamId && clubId) {
            try {
                var mod = await import(FS_URL);
                var fa = window._cronos_auth;
                var snap = await mod.getDoc(mod.doc(fa.db, 'clubs', clubId, 'attendance_players', teamId + '__' + j.ficha));
                asist = snap.exists() ? (snap.data() || {}) : null;
            } catch (e) {
                console.warn('[portabilidad] asistencia no disponible:', e && e.message ? e.message : e);
            }
        }

        var datos = window.cronosPortabilidadJugador({
            club:           { id: clubId, nombre: me.clubName || '' },
            equipo:         { teamId: teamId, categoria: cat, subcategoria: sub, etiqueta: etiqueta },
            jugador:        j,
            partidosEquipo: (window._sdStatsData || {})[skey] || [],
            partidosClub:   window._sdPartidosClub || [],
            asistencia:     asist,
            generadoPor:    { uid: me.uid || '', nombre: (typeof window.rxNombreDe === 'function')
                                ? window.rxNombreDe(me) : (me.displayName || ''), rol: me._activeRole || me.role || '' },
        });
        var base = 'portabilidad_' + ((typeof window.rxSlug === 'function') ? window.rxSlug(j.ficha || j.alias || 'jugador') : 'jugador') +
                   '_' + ((typeof window.rxHoy === 'function') ? window.rxHoy() : new Date().toISOString().slice(0, 10));
        window._cqPortaListo = {
            json: { nombre: base + '.json', texto: JSON.stringify(datos, null, 2) },
            partidos: { nombre: base + '_partidos.csv', texto: window.rxCsv(window.cronosPortabilidadFilasPartidos(datos)) },
            asistencia: { nombre: base + '_asistencia.csv', texto: window.rxCsv(window.cronosPortabilidadFilasAsistencia(datos)) },
        };

        var btn = function (k, txt) {
            return '<button onclick="cronosPortabilidadDescargar(\'' + k + '\')" style="width:100%;padding:0.6rem;' +
                'margin-bottom:0.4rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.35);' +
                'border-radius:8px;color:#79c0ff;font-weight:700;cursor:pointer;">' + txt + '</button>';
        };
        _overlay('<div style="font-weight:800;color:#79c0ff;margin-bottom:0.25rem;">📦 ' + _esc(j.nombre || j.alias) +
            '</div><div style="font-size:0.74rem;color:#8b949e;margin-bottom:0.8rem;">' + datos.partidos.length +
            ' partido(s) · ' + datos.colaboraciones.length + ' colaboración(es) · ' +
            (datos.asistencia.disponible ? datos.asistencia.dias.length + ' día(s) de asistencia' : 'sin registro de asistencia') +
            '</div>' + btn('json', '🧾 JSON completo (para otra plataforma)') +
            btn('partidos', '📊 CSV · partidos') + btn('asistencia', '📊 CSV · asistencia'));
    };

    window.cronosPortabilidadDescargar = function (k) {
        var f = (window._cqPortaListo || {})[k];
        if (!f) { _toast('⚠️ Vuelve a elegir el jugador.'); return; }
        var ok = (k === 'json') ? window.rxDescargarJSON(f.nombre, f.texto) : window.rxDescargarCSV(f.nombre, f.texto);
        if (ok) _toast('✅ ' + f.nombre, 2500);
    };
})();

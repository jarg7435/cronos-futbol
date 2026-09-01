// ════════════════════════════════════════════════════════════════════
//  CONTROL DE ASISTENCIA — ALMACÉN (2026-08-13)
// ════════════════════════════════════════════════════════════════════
//  Guarda quién vino a cada entrenamiento y a cada partido, y con qué
//  motivo faltó quien faltó.
//
//  ── DÓNDE VIVE ──────────────────────────────────────────────────────
//  clubs/{clubId}/attendance/{teamId}__{YYYY-MM}  ·  UN documento por
//  equipo y MES.
//
//    { clubId, teamId, category, subcategory, month,
//      sessions: { '2026-08-13': { tipo:'entrenamiento', hora:'20:00' } },
//      marks:    { '2026-08-13': { 'ALC07': { s:'P' },
//                                  'ALC09': { s:'J', m:'medico' } } },
//      updatedAt, updatedBy }
//
//  🔑🔑🔑 POR QUÉ NO VA DENTRO DE LA PLANTILLA. `cronos_master_roster` vive
//  en users/{uid}/cronos_data/main, el MISMO documento que guarda
//  `cronos_email_config` —los correos y teléfonos de todos los padres—.
//  Colgar de ahí un curso entero de marcas obligaría a reescribir ese
//  documento entero en cada toque.
//
//  🔑🔑 CADA MARCA SE GUARDA SOLA, con updateDoc de ruta punteada
//  (`marks.2026-08-13.ALC07`). Nada espera a un botón GUARDAR: la pantalla
//  de plantilla se repinta por innerHTML y lo no guardado muere, y una lista
//  de asistencia no puede funcionar así. Además dos dispositivos marcando a
//  la vez no se pisan, porque cada uno escribe SU campo y no el mapa entero.
//
//  🔑 LAS SESIONES SE COPIAN DEL CUADRANTE, NO SE CONSULTAN EN VIVO. Si en
//  noviembre el entrenador limpia la semana de agosto, las faltas de agosto
//  no pueden evaporarse. Se congelan en el momento de pasar lista.
//
//  🔑 LA CLAVE DEL JUGADOR ES SU FICHA ('ALC07'), NUNCA EL DORSAL. El dorsal
//  cambia a mitad de temporada y ya costó un acumulado mal agrupado.
//
//  ⚠️ NI LAS FICHAS NI LAS FECHAS PUEDEN LLEVAR PUNTOS, porque van dentro de
//  una ruta punteada de Firestore. La ficha la genera _cronosGeneratePlayerId
//  (letras y dígitos) y la fecha es YYYY-MM-DD. _rutaSegura() lo comprueba
//  antes de escribir en vez de confiar en ello.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var FS_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
    var LS_KEY = 'cronos_attendance_cache';

    // ── Vocabulario ──────────────────────────────────────────────────
    // 'P' presente · 'I' falta injustificada · 'J' falta justificada.
    //
    // ⚠️ NO EXISTE "ENFERMEDAD" A PROPÓSITO. El estado de salud de un menor
    // es categoría especial del RGPD (art. 9). Se dejó una causa genérica
    // 'medico' que cubre lesión y enfermedad sin registrar el diagnóstico, y
    // no hay texto libre donde poder escribirlo.
    var MOTIVOS = [
        { id: 'estudios', label: 'Estudios',            icon: '📚' },
        { id: 'trabajo',  label: 'Trabajo',             icon: '💼' },
        { id: 'medico',   label: 'Motivo médico / lesión', icon: '🩹' },
        // ⚠️ 'otros' NO PUEDE SER UN PUNTO. Fue '•' hasta v652, y en la rejilla
        // del parte mensual la celda "Sin marcar" pinta '·': dos puntitos que
        // sólo se distinguían por el color y por el `title`. El icono de una
        // causa tiene que leerse de un vistazo — para eso está la rejilla—, así
        // que aquí van cuatro EMOJIS con silueta y color propios, ninguno un
        // signo de puntuación.
        { id: 'otros',    label: 'Otros',               icon: '📝' }
    ];

    function motivoLabel(id) {
        for (var i = 0; i < MOTIVOS.length; i++) if (MOTIVOS[i].id === id) return MOTIVOS[i].label;
        return '';
    }

    // El icono de cada causa. Existía dentro de MOTIVOS desde el principio y
    // sólo lo usaba el desglose del parte mensual; la lista de "pasar lista"
    // pintaba siempre el mismo y las cuatro causas se veían iguales.
    // Respaldo 🩹 (el de "justificada") para un id que ya no exista en la
    // lista: mejor el genérico de siempre que un hueco.
    function motivoIcon(id) {
        for (var i = 0; i < MOTIVOS.length; i++) if (MOTIVOS[i].id === id) return MOTIVOS[i].icon;
        return '🩹';
    }

    // ── Utilidades de fecha ──────────────────────────────────────────
    function mesDe(dateKey) { return String(dateKey || '').slice(0, 7); }

    function lunesDe(date) {
        var d = (date instanceof Date) ? new Date(date) : new Date(String(date) + 'T12:00:00');
        var dow = d.getDay();
        d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function _clave(date) {
        return (typeof window._cronosLocalDateKey === 'function')
            ? window._cronosLocalDateKey(date) : '';
    }

    // ⚠️ Un punto en la ficha o en la fecha partiría la ruta punteada en dos
    // y la marca se escribiría en un campo anidado que nadie lee. Vale más
    // negarse a escribir que escribir en el sitio equivocado en silencio.
    function _rutaSegura(trozo) {
        return typeof trozo === 'string' && trozo.length > 0 &&
               trozo.indexOf('.') === -1 && trozo.indexOf('/') === -1 &&
               trozo.indexOf('[') === -1 && trozo.indexOf(']') === -1 &&
               trozo.indexOf('`') === -1;
    }

    // ── El equipo de quien mira ──────────────────────────────────────
    function _miEquipo() {
        return (typeof window.cronosMyTeam === 'function') ? window.cronosMyTeam() : null;
    }

    function docId(teamId, mes) { return String(teamId) + '__' + String(mes); }

    // ══════════════════════════════════════════════════════════════════
    //  LA PLANTILLA SOBRE LA QUE SE PASA LISTA
    // ══════════════════════════════════════════════════════════════════
    //  Funde F7 y F11 y deduplica por ficha: un jugador es la misma persona
    //  juegue en la modalidad que juegue, y un club que tiene las dos
    //  plantillas no debe pasar lista dos veces al mismo chaval.
    //
    //  ⚠️ Se descartan las filas VACÍAS (la plantilla se rellena hasta 18/25
    //  con huecos en blanco) y las PLAZAS DE APOYO sin jugador asignado.
    function jugadores() {
        var roster = {};
        // v580 · la plantilla DEL EQUIPO abierto. Guard `typeof`: este modulo
        // puede correr antes de que utils.js haya definido el accesor, y
        // quedarse sin lista es preferible a lanzar en el arranque.
        try {
            roster = (typeof window.cronosPlantillaAmbas === 'function')
                ? window.cronosPlantillaAmbas() : {};
        } catch (e) { roster = {}; }

        var vistos = {}, out = [];
        ['f7', 'f11'].forEach(function (modo) {
            (roster[modo] || []).forEach(function (p) {
                if (!p) return;
                var nombre = String(p.name || '').trim();
                var alias  = String(p.alias || '').trim();
                if (!nombre && !alias) return;                 // fila vacía
                var ficha = String(p.id || '').trim();
                if (!ficha) return;                            // sin ficha no hay clave
                if (vistos[ficha]) return;
                vistos[ficha] = true;
                out.push({
                    ficha:   ficha,
                    dorsal:  String(p.number == null ? '' : p.number).trim(),
                    nombre:  nombre,
                    alias:   alias || nombre.split(' ')[0],
                    isGuest: p.isGuest === true,
                    origen:  p.isGuest ? String(p.originCategory || '') + ' ' + String(p.originSubcategory || '') : ''
                });
            });
        });
        return out;
    }

    // ══════════════════════════════════════════════════════════════════
    //  LAS SESIONES: SÓLO LOS DÍAS QUE EL CUADRANTE TIENE PROGRAMADOS
    // ══════════════════════════════════════════════════════════════════
    //  🔑 Es la diferencia entre un control útil y una rejilla de 30 casillas
    //  con 22 vacías. Si el equipo entrena martes y jueves y juega el sábado,
    //  la semana tiene TRES sesiones, y el % de asistencia se calcula sobre
    //  esas tres. Sobre días naturales, "faltas" no significaría nada.
    //  💤 v604 · UN DÍA DE DESCANSO NO ES UNA SESIÓN.
    //  Al añadir "descanso" al desplegable de la Planificación Semanal
    //  (js/coach/training/panel.js), esta función lo habría clasificado como
    //  'entrenamiento' —cualquier cosa que no empiece por "partido" lo era— y
    //  el cuadrante habría abierto una fila para pasar lista de un día en el
    //  que nadie entrena. Los ausentes de ese día habrían contado como faltas
    //  y el % de asistencia de todo el club habría bajado sin motivo.
    //
    //  🔑 Se compara por PREFIJO como con "partido", no por igualdad: el valor
    //  guardado puede venir con mayúsculas o con algo detrás.
    function _tipoDeSesion(dd) {
        var t = String((dd && dd.tipo) || '').toLowerCase();
        if (!t) return '';
        if (t.indexOf('descanso') === 0) return '';
        return t.indexOf('partido') === 0 ? 'partido' : 'entrenamiento';
    }

    // Sesiones de la semana cuyo lunes es `weekKey`, ordenadas por fecha.
    function sesionesDeSemana(weekKey) {
        var dias = {};
        if (window.TrainingSync && typeof window.TrainingSync.readWeekDays === 'function') {
            dias = window.TrainingSync.readWeekDays(weekKey) || {};
        }
        return Object.keys(dias).sort().map(function (fecha) {
            var dd = dias[fecha] || {};
            return {
                fecha: fecha,
                tipo:  _tipoDeSesion(dd),
                tipoRaw: String(dd.tipo || ''),
                hora:  String(dd.hora || ''),
                lugar: String(dd.lugar || '')
            };
        }).filter(function (s) { return !!s.tipo; });   // un día sin TIPO no es sesión
    }

    // Sesiones de un mes entero. Recorre los lunes que tocan ese mes: una
    // semana puede empezar en el mes anterior y acabar en este.
    function sesionesDeMes(mes) {
        var y = parseInt(String(mes).slice(0, 4), 10);
        var m = parseInt(String(mes).slice(5, 7), 10);
        if (!y || !m) return [];

        var primero = new Date(y, m - 1, 1, 12, 0, 0);
        var ultimo  = new Date(y, m, 0, 12, 0, 0);
        var cursor  = lunesDe(primero);
        var out = [];
        while (cursor.getTime() <= ultimo.getTime()) {
            sesionesDeSemana(_clave(cursor)).forEach(function (s) {
                if (mesDe(s.fecha) === mes) out.push(s);
            });
            cursor = new Date(cursor.getTime() + 7 * 86400000);
        }
        out.sort(function (a, b) { return a.fecha < b.fecha ? -1 : (a.fecha > b.fecha ? 1 : 0); });
        return out;
    }

    // ══════════════════════════════════════════════════════════════════
    //  CACHÉ LOCAL
    // ══════════════════════════════════════════════════════════════════
    //  El entrenador pasa lista en el campo, muchas veces sin cobertura. La
    //  marca se pinta y se guarda en local al instante y la subida va detrás;
    //  si falla, la marca NO se pierde y se reintenta al volver a abrir.
    //
    //  ⚠️ `await setDoc` NO RESUELVE sin cobertura (ya pasó en v447): por eso
    //  la subida nunca se espera antes de pintar.
    function _cache() {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
        catch (e) { return {}; }
    }
    function _guardarCache(todo) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(todo)); } catch (e) {}
    }
    function _mesLocal(id) {
        var c = _cache();
        return c[id] || { sessions: {}, marks: {} };
    }
    function _ponerMesLocal(id, datos) {
        var c = _cache();
        c[id] = datos;
        _guardarCache(c);
    }

    // ══════════════════════════════════════════════════════════════════
    //  LECTURA DEL MES
    // ══════════════════════════════════════════════════════════════════
    async function cargarMes(mes, equipoOpc) {
        var eq = equipoOpc || _miEquipo();
        if (!eq) return { sessions: {}, marks: {}, _sinEquipo: true };

        var id = docId(eq.teamId, mes);
        var local = _mesLocal(id);

        try {
            var fa = window._cronos_auth;
            if (!fa || !fa.db) return local;
            var mod = await import(FS_URL);
            var snap = await mod.getDoc(mod.doc(fa.db, 'clubs', eq.clubId, 'attendance', id));
            if (snap.exists()) {
                var v = snap.data() || {};
                var datos = { sessions: v.sessions || {}, marks: v.marks || {} };
                _ponerMesLocal(id, datos);
                return datos;
            }
            return local;
        } catch (e) {
            console.warn('[Asistencia] no se pudo leer el mes ' + mes + ':', e && e.message ? e.message : e);
            return local;
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  ESCRITURA DE UNA MARCA
    // ══════════════════════════════════════════════════════════════════
    //  Devuelve true si la marca quedó guardada EN LOCAL (que es lo que el
    //  entrenador ve). La subida va aparte y no bloquea.
    function marcar(fecha, ficha, estado, motivo, sesion) {
        var eq = _miEquipo();
        if (!eq) { console.warn('[Asistencia] sin equipo: no se marca.'); return false; }
        if (!_rutaSegura(fecha) || !_rutaSegura(ficha)) {
            console.warn('[Asistencia] fecha o ficha no válidas para una ruta de Firestore:', fecha, ficha);
            return false;
        }
        if (estado !== 'P' && estado !== 'I' && estado !== 'J') return false;

        var mes = mesDe(fecha);
        var id  = docId(eq.teamId, mes);

        var marca = { s: estado };
        if (estado === 'J' && motivo) marca.m = String(motivo);

        // 1. LOCAL PRIMERO — éxito garantizado, sin depender de la red.
        var datos = _mesLocal(id);
        if (!datos.marks) datos.marks = {};
        if (!datos.marks[fecha]) datos.marks[fecha] = {};
        datos.marks[fecha][ficha] = marca;
        if (sesion && sesion.tipo) {
            if (!datos.sessions) datos.sessions = {};
            datos.sessions[fecha] = { tipo: sesion.tipo, hora: sesion.hora || '' };
        }
        _ponerMesLocal(id, datos);

        // 2. Subida en segundo plano.
        _subirMarca(eq, id, mes, fecha, ficha, marca, sesion);
        // 3. Y el extracto que verá el padre, con retardo.
        _programarPublicacion(ficha, fecha);
        return true;
    }

    async function _subirMarca(eq, id, mes, fecha, ficha, marca, sesion) {
        try {
            var fa = window._cronos_auth;
            if (!fa || !fa.db) return;
            var mod = await import(FS_URL);
            var ref = mod.doc(fa.db, 'clubs', eq.clubId, 'attendance', id);

            var patch = {};
            patch['marks.' + fecha + '.' + ficha] = marca;
            if (sesion && sesion.tipo) {
                patch['sessions.' + fecha] = { tipo: sesion.tipo, hora: sesion.hora || '' };
            }
            patch.updatedAt = mod.serverTimestamp();
            patch.updatedBy = (window._cronosCurrentUser && window._cronosCurrentUser.uid) || '';

            try {
                await mod.updateDoc(ref, patch);
            } catch (err) {
                if (err && err.code === 'not-found') {
                    // Primera marca del mes: hay que crear el documento con
                    // los campos de identidad, que son los que usan las
                    // reglas y el panel del director para filtrar.
                    var inicial = {
                        clubId: eq.clubId, teamId: eq.teamId,
                        category: eq.category || '', subcategory: eq.subcategory || '',
                        month: mes, sessions: {}, marks: {},
                        updatedAt: mod.serverTimestamp(),
                        updatedBy: (window._cronosCurrentUser && window._cronosCurrentUser.uid) || ''
                    };
                    inicial.marks[fecha] = {};
                    inicial.marks[fecha][ficha] = marca;
                    if (sesion && sesion.tipo) {
                        inicial.sessions[fecha] = { tipo: sesion.tipo, hora: sesion.hora || '' };
                    }
                    await mod.setDoc(ref, inicial, { merge: true });
                } else { throw err; }
            }
        } catch (e) {
            console.warn('[Asistencia] la marca no subió (queda guardada en local):',
                         e && e.message ? e.message : e);
        }
    }

    // Retira la marca de un jugador en un día (vuelve a "sin marcar").
    function desmarcar(fecha, ficha) {
        var eq = _miEquipo();
        if (!eq || !_rutaSegura(fecha) || !_rutaSegura(ficha)) return false;

        var mes = mesDe(fecha);
        var id  = docId(eq.teamId, mes);

        var datos = _mesLocal(id);
        if (datos.marks && datos.marks[fecha]) delete datos.marks[fecha][ficha];
        _ponerMesLocal(id, datos);

        (async function () {
            try {
                var fa = window._cronos_auth;
                if (!fa || !fa.db) return;
                var mod = await import(FS_URL);
                var ref = mod.doc(fa.db, 'clubs', eq.clubId, 'attendance', id);
                var patch = {};
                // ⚠️ deleteField, no null: escribir null dejaría el campo vivo
                // y los recuentos lo seguirían contando como una marca.
                patch['marks.' + fecha + '.' + ficha] = mod.deleteField();
                patch.updatedAt = mod.serverTimestamp();
                await mod.updateDoc(ref, patch);
            } catch (e) {
                console.warn('[Asistencia] no se pudo retirar la marca:', e && e.message ? e.message : e);
            }
        })();
        _programarPublicacion(ficha, fecha);
        return true;
    }

    // ══════════════════════════════════════════════════════════════════
    //  RECUENTOS
    // ══════════════════════════════════════════════════════════════════
    //  Un jugador SIN MARCAR no cuenta como falta: cuenta como no registrado.
    //  Meterlo en las faltas convertiría el olvido del entrenador en una
    //  falta injustificada del chaval, que es exactamente lo que no puede
    //  pasar cuando esto sirve de criterio para convocar.
    function resumenJugador(marks, sesiones, ficha) {
        var r = { sesiones: sesiones.length, P: 0, I: 0, J: 0, sinMarcar: 0,
                  faltasPartido: 0, faltasEntreno: 0, motivos: {} };
        sesiones.forEach(function (s) {
            var m = marks[s.fecha] && marks[s.fecha][ficha];
            if (!m || !m.s) { r.sinMarcar++; return; }
            if (m.s === 'P') { r.P++; return; }
            if (m.s === 'I') r.I++; else if (m.s === 'J') r.J++; else return;
            if (s.tipo === 'partido') r.faltasPartido++; else r.faltasEntreno++;
            if (m.s === 'J' && m.m) r.motivos[m.m] = (r.motivos[m.m] || 0) + 1;
        });
        r.faltas = r.I + r.J;
        r.registradas = r.P + r.faltas;
        // El porcentaje se calcula sobre lo REGISTRADO, no sobre el total de
        // sesiones: si el entrenador no pasó lista un día, ese día no puede
        // bajarle el porcentaje a nadie.
        r.pct = r.registradas ? Math.round((r.P / r.registradas) * 100) : null;
        return r;
    }

    function resumenSesion(marks, fecha, fichas) {
        var r = { P: 0, I: 0, J: 0, sinMarcar: 0 };
        var dia = marks[fecha] || {};
        fichas.forEach(function (f) {
            var m = dia[f];
            if (!m || !m.s) { r.sinMarcar++; return; }
            if (m.s === 'P') r.P++; else if (m.s === 'I') r.I++; else if (m.s === 'J') r.J++;
        });
        return r;
    }

    // ══════════════════════════════════════════════════════════════════
    //  RESUMEN RECIENTE — el criterio para convocar
    // ══════════════════════════════════════════════════════════════════
    //  Devuelve la asistencia de los últimos `dias` días naturales, que es lo
    //  que el entrenador mira al decidir a quién convoca.
    //
    //  ⚠️ LEE DE LA CACHÉ LOCAL Y NO DE LA RED, a propósito: la pantalla de
    //  convocatoria se pinta de golpe y de forma síncrona. Si esto tuviera
    //  que esperar a Firestore, o bien bloquearía el pintado o bien llegaría
    //  tarde. `precargarMeses` deja los datos listos ANTES y el distintivo se
    //  rellena después sin repintar la rejilla —repintarla perdería la
    //  selección de convocados que el entrenador lleve hecha—.
    function _mesesRecientes(dias) {
        var hoy = new Date();
        var desde = new Date(hoy.getTime() - (dias || 28) * 86400000);
        var meses = {}, cursor = new Date(desde.getFullYear(), desde.getMonth(), 1, 12, 0, 0);
        while (cursor.getTime() <= hoy.getTime()) {
            meses[_clave(cursor).slice(0, 7)] = true;
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12, 0, 0);
        }
        return { meses: Object.keys(meses), desde: _clave(desde), hasta: _clave(hoy) };
    }

    async function precargarMeses(dias) {
        var eq = _miEquipo();
        if (!eq) return;
        var r = _mesesRecientes(dias);
        for (var i = 0; i < r.meses.length; i++) {
            try { await cargarMes(r.meses[i], eq); } catch (e) {}
        }
    }

    function resumenReciente(ficha, dias) {
        var eq = _miEquipo();
        if (!eq) return null;
        var r = _mesesRecientes(dias);

        var sesiones = [], marks = {};
        r.meses.forEach(function (mes) {
            var datos = _mesLocal(docId(eq.teamId, mes));
            Object.keys(datos.marks || {}).forEach(function (f) { marks[f] = datos.marks[f]; });
            sesionesDeMes(mes).forEach(function (s) {
                if (s.fecha >= r.desde && s.fecha <= r.hasta) sesiones.push(s);
            });
        });
        if (!sesiones.length) return null;
        return resumenJugador(marks, sesiones, ficha);
    }

    // ══════════════════════════════════════════════════════════════════
    //  BLOQUE DE TEXTO PARA EL INFORME COLECTIVO
    // ══════════════════════════════════════════════════════════════════
    //  Sumatoria mensual de asistencias y faltas, en el mismo formato de
    //  WhatsApp que usa el resto del informe.
    //
    //  ⚠️ DEVUELVE CADENA VACÍA SI NO HAY NADA QUE CONTAR, y el llamador no
    //  añade nada. Un bloque "ASISTENCIA: 0 de 0" en un club que todavía no
    //  usa esta función sólo ensucia el mensaje que llega a dirección.
    //
    //  ⚠️ Lee de la caché local: quien lo llame debe haber hecho antes
    //  `await precargarMeses(...)`.
    function textoMensual(mes) {
        var eq = _miEquipo();
        if (!eq) return '';
        var m = mes || _clave(new Date()).slice(0, 7);
        var sesiones = sesionesDeMes(m);
        if (!sesiones.length) return '';

        var datos = _mesLocal(docId(eq.teamId, m));
        var marks = datos.marks || {};
        var plantel = jugadores();
        if (!plantel.length) return '';

        var totP = 0, totI = 0, totJ = 0, conDatos = 0;
        var lineas = [];
        plantel.forEach(function (p) {
            var r = resumenJugador(marks, sesiones, p.ficha);
            if (!r.registradas) return;
            conDatos++;
            totP += r.P; totI += r.I; totJ += r.J;
            var extra = [];
            if (r.I) extra.push(r.I + ' inj.');
            if (r.J) extra.push(r.J + ' just.');
            lineas.push('• ' + (p.alias || p.nombre) + ' — ' + r.P + '/' + r.registradas +
                        (r.pct != null ? ' (' + r.pct + '%)' : '') +
                        (extra.length ? ' · ' + extra.join(', ') : ''));
        });
        if (!conDatos) return '';

        var nombreMes = new Date(parseInt(m.slice(0, 4), 10), parseInt(m.slice(5, 7), 10) - 1, 1)
            .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        var registradas = totP + totI + totJ;

        var out = '\n✅ *ASISTENCIA — ' + nombreMes.toUpperCase() + '*\n';
        out += 'Sesiones del mes: ' + sesiones.length +
               ' (' + sesiones.filter(function (s) { return s.tipo === 'partido'; }).length + ' partidos)\n';
        out += 'Total asistencias: ' + totP + '\n';
        out += 'Total faltas: ' + (totI + totJ) +
               '  (injustificadas ' + totI + ' · justificadas ' + totJ + ')\n';
        if (registradas) out += 'Media del equipo: ' + Math.round(totP / registradas * 100) + '%\n';
        out += lineas.join('\n') + '\n';
        return out;
    }

    // ══════════════════════════════════════════════════════════════════
    //  EXTRACTO POR JUGADOR — LO QUE VE EL PADRE
    // ══════════════════════════════════════════════════════════════════
    //  🔑🔑🔑 POR QUÉ HACE FALTA UN SEGUNDO DOCUMENTO. El del equipo lleva
    //  las marcas de los 25 jugadores dentro de UN campo (`marks`), y las
    //  reglas de Firestore no pueden conceder lectura "sólo de la clave
    //  ALC07": o se lee el documento entero o no se lee. Dejar que el padre
    //  leyera el del equipo sería publicarle las faltas —y sus causas— de
    //  todos los hijos de los demás.
    //
    //  🔑 SE PUBLICA CON RETARDO, no en cada toque. Pasar lista son 25
    //  pulsaciones seguidas; publicando al vuelo serían 50 escrituras. Se
    //  acumulan y se sueltan juntas 1,5 s después del último toque, y
    //  `publicarYa()` las fuerza al salir de la pantalla.
    //
    //  ⚠️ SI LA PUBLICACIÓN FALLA, LA MARCA NO SE PIERDE: vive en el
    //  documento del equipo, que es la fuente. Esto es una copia derivada.
    var _pendientes = {};        // ficha -> { fecha: true }
    var _timerPub   = null;
    var _linksPorDorsal = null;  // dorsal -> [parentUid]
    var _linksClub  = null;

    // Padres vinculados, resueltos desde cronos_player_links — el mismo
    // puente que ya usan los informes individuales. Se cachea por club:
    // dentro de una sesión de pasar lista no cambia.
    async function _cargarLinks(clubId) {
        if (_linksPorDorsal && _linksClub === clubId) return _linksPorDorsal;
        var mapa = {};
        try {
            var fa = window._cronos_auth;
            if (!fa || !fa.db) return mapa;
            var mod = await import(FS_URL);
            var snap = await mod.getDocs(mod.query(
                mod.collection(fa.db, 'cronos_player_links'),
                mod.where('clubId', '==', clubId)));
            snap.forEach(function (d) {
                var v = d.data() || {};
                var dorsal = String(v.playerNumber == null ? '' : v.playerNumber).trim();
                var uid = String(v.parentUid || '').trim();
                if (!dorsal || !uid) return;
                if (!mapa[dorsal]) mapa[dorsal] = [];
                if (mapa[dorsal].indexOf(uid) === -1) mapa[dorsal].push(uid);
            });
        } catch (e) {
            console.warn('[Asistencia] no se pudieron leer los vínculos de padres:',
                         e && e.message ? e.message : e);
        }
        _linksPorDorsal = mapa;
        _linksClub = clubId;
        return mapa;
    }

    function _programarPublicacion(ficha, fecha) {
        if (!_pendientes[ficha]) _pendientes[ficha] = {};
        _pendientes[ficha][fecha] = true;
        if (_timerPub) clearTimeout(_timerPub);
        _timerPub = setTimeout(function () { publicarYa(); }, 1500);
    }

    async function publicarYa() {
        if (_timerPub) { clearTimeout(_timerPub); _timerPub = null; }
        var fichas = Object.keys(_pendientes);
        if (!fichas.length) return;

        var eq = _miEquipo();
        if (!eq) { _pendientes = {}; return; }

        var deudas = _pendientes;
        _pendientes = {};

        try {
            var fa = window._cronos_auth;
            if (!fa || !fa.db) return;
            var mod = await import(FS_URL);
            var links = await _cargarLinks(eq.clubId);
            var porFicha = {};
            jugadores().forEach(function (p) { porFicha[p.ficha] = p; });

            for (var i = 0; i < fichas.length; i++) {
                var ficha = fichas[i];
                var p = porFicha[ficha];
                if (!p) continue;

                var ref = mod.doc(fa.db, 'clubs', eq.clubId, 'attendance_players',
                                  eq.teamId + '__' + ficha);
                var patch = {};
                var fechas = Object.keys(deudas[ficha] || {});
                for (var k = 0; k < fechas.length; k++) {
                    var fecha = fechas[k];
                    var datos = _mesLocal(docId(eq.teamId, mesDe(fecha)));
                    var m = (datos.marks && datos.marks[fecha]) ? datos.marks[fecha][ficha] : null;
                    var ses = (datos.sessions && datos.sessions[fecha]) || {};
                    if (!m || !m.s) {
                        patch['days.' + fecha] = mod.deleteField();
                    } else {
                        var v = { s: m.s, t: ses.tipo || '' };
                        if (m.m) v.m = m.m;
                        patch['days.' + fecha] = v;
                    }
                }
                // Identidad y permiso de lectura viajan SIEMPRE, por si el
                // vínculo del padre se creó después de la primera marca.
                patch.clubId = eq.clubId;
                patch.teamId = eq.teamId;
                patch.ficha = ficha;
                patch.dorsal = p.dorsal;
                patch.alias = p.alias;
                patch.category = eq.category || '';
                patch.subcategory = eq.subcategory || '';
                patch.parentUids = links[p.dorsal] || [];
                patch.updatedAt = mod.serverTimestamp();

                try {
                    await mod.updateDoc(ref, patch);
                } catch (err) {
                    if (err && err.code === 'not-found') {
                        var inicial = {
                            clubId: eq.clubId, teamId: eq.teamId, ficha: ficha,
                            dorsal: p.dorsal, alias: p.alias,
                            category: eq.category || '', subcategory: eq.subcategory || '',
                            parentUids: links[p.dorsal] || [], days: {},
                            updatedAt: mod.serverTimestamp()
                        };
                        Object.keys(patch).forEach(function (kk) {
                            if (kk.indexOf('days.') !== 0) return;
                            var f = kk.slice(5);
                            if (patch[kk] && patch[kk].s) inicial.days[f] = patch[kk];
                        });
                        await mod.setDoc(ref, inicial, { merge: true });
                    } else { throw err; }
                }
            }
        } catch (e) {
            console.warn('[Asistencia] no se pudo publicar el extracto del jugador:',
                         e && e.message ? e.message : e);
        }
    }

    // ── Exportación ──────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════
    //  📅 EL PARTE MENSUAL, EN UN SOLO SITIO
    // ══════════════════════════════════════════════════════════════════
    //  Lo pintan DOS pantallas: la del entrenador (su equipo) y la del
    //  Director Deportivo / Coordinador (cualquier equipo del club). El autor
    //  pidió que la segunda fuera «idéntica» a la primera, y la única forma de
    //  que siga siéndolo dentro de seis meses es que sea LA MISMA FUNCIÓN.
    //
    //  🔑 ES PURA: recibe sesiones, plantel y marcas por argumento y no mira
    //  ni el equipo abierto ni el DOM. Ahí está la diferencia con
    //  `sesionesDeMes()` y `jugadores()`, que sí leen el equipo del entrenador
    //  y por eso no servían para el director.
    //
    //  Devuelve la cabecera + la tabla + el desglose. NO envuelve: cada
    //  pantalla la mete en su propio contenedor (un modal, o el panel de
    //  dirección), que es lo único que legítimamente cambia entre las dos.
    //
    //  `acciones` es el hueco de botones a la derecha del selector de mes:
    //  el entrenador pone PASAR LISTA, el director pone VOLVER.
    function parteMensualHtml(o) {
        o = o || {};
        var esc = function (s) {
            return (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : s)
                                                      : String(s == null ? '' : s);
        };
        var diaMes = function (fecha) {
            var d = new Date(fecha + 'T12:00:00');
            return d.getDate() + '/' + (d.getMonth() + 1);
        };

        var isMobile   = o.isMobile === true;
        var mes        = String(o.mes || '');
        var sesiones   = o.sesiones || [];
        var plantel    = o.plantel  || [];
        var marks      = o.marks    || {};
        var cambiarMes = o.cambiarMes || '_attCambiarMes';
        var acciones   = o.acciones || '';

        var nombreMes = new Date(parseInt(mes.slice(0, 4), 10), parseInt(mes.slice(5, 7), 10) - 1, 1)
            .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

        var html = '' +
        '<div style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.8rem;">' +
          '<div>' +
            '<h2 style="margin:0 0 0.05rem; font-size:' + (isMobile ? '1rem' : '1.3rem') + ';">📅 Parte mensual de asistencia</h2>' +
            '<p style="font-size:0.72rem; color:var(--text-muted); margin:0;">' + esc(o.equipo || '') + '</p>' +
          '</div>' +
          '<div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">' +
            '<button class="btn" onclick="' + cambiarMes + '(-1)" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">◀</button>' +
            '<span style="font-size:0.8rem; font-weight:700; color:white; min-width:' + (isMobile ? '120px' : '160px') + '; text-align:center; text-transform:capitalize;">' + esc(nombreMes) + '</span>' +
            '<button class="btn" onclick="' + cambiarMes + '(1)" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">▶</button>' +
            acciones +
          '</div>' +
        '</div>';

        if (!sesiones.length || !plantel.length) {
            return html +
                '<div style="padding:2rem 1rem; text-align:center; border:1px dashed var(--glass-border); border-radius:12px;">' +
                '<div style="font-size:2rem; margin-bottom:0.5rem;">🗓️</div>' +
                '<div style="font-weight:700;">Sin sesiones registradas en este mes</div>' +
                '<div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.4rem;">Las sesiones salen de la Planificación Semanal.</div>' +
                '</div>';
        }

        // ── Rejilla ─────────────────────────────────────────────────────
        // ⚠️ La tabla scrollea DENTRO de su contenedor. Un mes con 20 sesiones
        // no cabe en un móvil y sin este overflow el modal entero se desplazaría
        // en horizontal.
        html += '<div style="flex:1; overflow:auto; border:1px solid var(--glass-border); border-radius:12px;">' +
                '<table style="border-collapse:collapse; font-size:0.72rem; min-width:100%;">' +
                '<thead><tr style="background:rgba(88,166,255,0.08);">' +
                '<th style="position:sticky; left:0; z-index:2; background:#12161c; padding:0.5rem 0.6rem; text-align:left; white-space:nowrap; border-bottom:2px solid rgba(88,166,255,0.25);">JUGADOR</th>';

        sesiones.forEach(function (s) {
            var icono = s.tipo === 'partido' ? '⚽' : '🏃';
            var col = s.tipo === 'partido' ? '#f0883e' : '#3fb950';
            html += '<th title="' + esc(s.tipoRaw) + (s.lugar ? ' · ' + esc(s.lugar) : '') + '" style="padding:0.4rem 0.25rem; border-bottom:2px solid rgba(88,166,255,0.25); color:' + col + '; font-size:0.62rem; white-space:nowrap;">' +
                    icono + '<br>' + diaMes(s.fecha) + '</th>';
        });

        html += '<th style="padding:0.4rem 0.5rem; border-bottom:2px solid rgba(88,166,255,0.25); color:#3fb950; white-space:nowrap;">✅</th>' +
                '<th style="padding:0.4rem 0.5rem; border-bottom:2px solid rgba(88,166,255,0.25); color:#ff5858; white-space:nowrap;">❌</th>' +
                '<th style="padding:0.4rem 0.5rem; border-bottom:2px solid rgba(88,166,255,0.25); color:#f0883e; white-space:nowrap;">🩹</th>' +
                '<th style="padding:0.4rem 0.5rem; border-bottom:2px solid rgba(88,166,255,0.25); color:var(--primary); white-space:nowrap;">%</th>' +
                '</tr></thead><tbody>';

        plantel.forEach(function (p) {
            var r = resumenJugador(marks, sesiones, p.ficha);
            html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">' +
                    '<td style="position:sticky; left:0; z-index:1; background:#12161c; padding:0.35rem 0.6rem; white-space:nowrap;">' +
                      '<span style="color:var(--primary); font-weight:700;">' + esc(p.dorsal) + '</span> ' + esc(p.alias || p.nombre) +
                    '</td>';
            sesiones.forEach(function (s) {
                var m = (marks[s.fecha] || {})[p.ficha];
                var txt = '·', col = 'rgba(255,255,255,0.15)', tit = 'Sin marcar';
                if (m && m.s === 'P') { txt = '✅'; col = '#3fb950'; tit = 'Presente'; }
                else if (m && m.s === 'I') { txt = '❌'; col = '#ff5858'; tit = 'Falta injustificada'; }
                // 🎨 CADA CAUSA CON SU ICONO, TAMBIÉN AQUÍ. v620 arregló esto
                // en la lista de "pasar lista" y dejó la rejilla del parte con
                // el 🩹 escrito a mano: estudios, trabajo, médico y otros se
                // veían los cuatro iguales, y el desglose de abajo —que sí
                // usaba `MOTIVOS`— contradecía a la tabla que tenía encima.
                // El icono sale de la MISMA lista que ese desglose, así que la
                // leyenda de abajo y la celda no se pueden volver a separar.
                // ⚠️ Sin motivo grabado, `motivoIcon` devuelve el 🩹 genérico:
                // una justificada sin causa se sigue viendo como antes.
                else if (m && m.s === 'J') { txt = motivoIcon(m.m); col = '#f0883e'; tit = 'Justificada: ' + motivoLabel(m.m); }
                html += '<td title="' + esc(tit) + '" style="text-align:center; padding:0.3rem 0.2rem; color:' + col + ';">' + txt + '</td>';
            });
            html += '<td style="text-align:center; font-weight:700; color:#3fb950;">' + r.P + '</td>' +
                    '<td style="text-align:center; font-weight:700; color:#ff5858;">' + r.I + '</td>' +
                    '<td style="text-align:center; font-weight:700; color:#f0883e;">' + r.J + '</td>' +
                    '<td style="text-align:center; font-weight:700; color:var(--primary);">' + (r.pct == null ? '—' : r.pct + '%') + '</td>' +
                    '</tr>';
        });

        // ── Sumatoria final ─────────────────────────────────────────────
        var fichas = plantel.map(function (x) { return x.ficha; });
        var totP = 0, totI = 0, totJ = 0;
        html += '<tr style="background:rgba(88,166,255,0.06); border-top:2px solid rgba(88,166,255,0.25);">' +
                '<td style="position:sticky; left:0; z-index:1; background:#12161c; padding:0.45rem 0.6rem; font-weight:700; white-space:nowrap;">TOTAL PRESENTES</td>';
        sesiones.forEach(function (s) {
            var rs = resumenSesion(marks, s.fecha, fichas);
            totP += rs.P; totI += rs.I; totJ += rs.J;
            html += '<td style="text-align:center; padding:0.35rem 0.2rem; font-weight:700; color:#58a6ff;">' + rs.P + '</td>';
        });
        html += '<td style="text-align:center; font-weight:700; color:#3fb950;">' + totP + '</td>' +
                '<td style="text-align:center; font-weight:700; color:#ff5858;">' + totI + '</td>' +
                '<td style="text-align:center; font-weight:700; color:#f0883e;">' + totJ + '</td>' +
                '<td style="text-align:center; font-weight:700; color:var(--primary);">' +
                  ((totP + totI + totJ) ? Math.round(totP / (totP + totI + totJ) * 100) + '%' : '—') + '</td>' +
                '</tr>';

        html += '</tbody></table></div>';

        // ── Desglose de faltas ──────────────────────────────────────────
        var porMotivo = {}, faltasPartido = 0, faltasEntreno = 0;
        plantel.forEach(function (p) {
            var r = resumenJugador(marks, sesiones, p.ficha);
            faltasPartido += r.faltasPartido;
            faltasEntreno += r.faltasEntreno;
            Object.keys(r.motivos).forEach(function (k) { porMotivo[k] = (porMotivo[k] || 0) + r.motivos[k]; });
        });

        html += '<div style="margin-top:0.9rem; padding:0.8rem 1rem; border-radius:10px; background:var(--glass); border:1px solid var(--glass-border);">' +
                '<div style="font-size:0.75rem; font-weight:700; color:var(--text-muted); margin-bottom:0.5rem;">📊 DESGLOSE DE FALTAS DEL MES</div>' +
                '<div style="display:flex; gap:1.2rem; flex-wrap:wrap; font-size:0.78rem;">' +
                  '<span>Total faltas: <strong style="color:#ff5858;">' + (totI + totJ) + '</strong></span>' +
                  '<span>Injustificadas: <strong style="color:#ff5858;">' + totI + '</strong></span>' +
                  '<span>Justificadas: <strong style="color:#f0883e;">' + totJ + '</strong></span>' +
                  '<span title="Faltar a un partido no pesa igual que faltar a un entrenamiento">⚽ a partidos: <strong style="color:#f0883e;">' + faltasPartido + '</strong></span>' +
                  '<span>🏃 a entrenamientos: <strong style="color:#f0883e;">' + faltasEntreno + '</strong></span>' +
                '</div>';

        var motivosTxt = MOTIVOS
            .filter(function (mo) { return porMotivo[mo.id]; })
            .map(function (mo) { return mo.icon + ' ' + esc(mo.label) + ': <strong>' + porMotivo[mo.id] + '</strong>'; })
            .join(' &nbsp;·&nbsp; ');
        if (motivosTxt) {
            html += '<div style="margin-top:0.5rem; font-size:0.75rem; color:var(--text-muted);">' + motivosTxt + '</div>';
        }
        html += '</div>';

        return html;
    }

    // Sesiones de un mes a partir del PARTE ya descargado, sin pasar por el
    // cuadrante. El documento guarda una copia congelada en `sessions`, así que
    // el director puede reconstruirlas para un equipo que no es el suyo.
    // ⚠️ El parte NO guarda el lugar, sólo tipo y hora: `lugar` queda vacío y
    // el `title` de la columna sale sin él, que es la verdad de lo guardado.
    function sesionesDeParte(parte) {
        var ses = (parte && parte.sessions) || {};
        return Object.keys(ses).sort().map(function (fecha) {
            var dd = ses[fecha] || {};
            return {
                fecha: fecha,
                tipo: String(dd.tipo || ''),
                tipoRaw: String(dd.tipo || ''),
                hora: String(dd.hora || ''),
                lugar: ''
            };
        }).filter(function (s) { return !!s.tipo; });
    }

    window.CronosAttendance = {
        publicarYa: publicarYa,
        precargarMeses: precargarMeses,
        resumenReciente: resumenReciente,
        textoMensual: textoMensual,
        MOTIVOS: MOTIVOS,
        motivoLabel: motivoLabel,
        motivoIcon: motivoIcon,
        mesDe: mesDe,
        lunesDe: lunesDe,
        docId: docId,
        jugadores: jugadores,
        sesionesDeSemana: sesionesDeSemana,
        sesionesDeMes: sesionesDeMes,
        cargarMes: cargarMes,
        marcar: marcar,
        desmarcar: desmarcar,
        resumenJugador: resumenJugador,
        resumenSesion: resumenSesion,
        parteMensualHtml: parteMensualHtml,
        sesionesDeParte: sesionesDeParte,
        // Para los guards y los tests: funciones puras.
        _rutaSegura: _rutaSegura,
        _tipoDeSesion: _tipoDeSesion,
        _mesLocal: _mesLocal
    };
})();

// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — retroactive-modal.js
//  Registro de Eventos Retroactivos (Pérdida de Batería / Cobertura)
// ════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // 🎬 v817 · null = SIN TIPO: el suceso es sólo el vídeo de la jugada (ver
    // _setRetroEventType). El modal abre así, sin nada marcado.
    let _selectedEventType = null;
    let _targetMatchId = null;
    // v434 · Datos del partido destino, para saber si admite incidencias. Lo
    // aportan los listados de Partidos Terminados al abrir el modal desde una
    // tarjeta. Sin él (partido en curso) el estado es 'live' por definición.
    let _targetMatchData = null;
    // v531 · Los jugadores que se están ofreciendo en el modal abierto.
    let _jugadoresModal = [];

    // ════════════════════════════════════════════════════════════════════
    //  🔓 v797 · EL PARTIDO SE ELIGE, Y PASADAS 2 H HACE FALTA PERMISO
    //
    //  Encargo del autor (implementar.txt 2026-10-11, capturas 11295-11298):
    //    · un desplegable OBLIGATORIO al principio con los últimos partidos
    //      del equipo, para decir a qué encuentro va el suceso. Antes, sin
    //      matchId, el modal caía en la global `liveMatchId`: el partido que
    //      tuviera la pestaña, o ninguno.
    //    · pasadas las 2 h el partido está cerrado y sólo se abre con permiso
    //      de Dirección/Coordinación (js/match/events/match-unlocks.js).
    //
    //  🔑 LOS PARTIDOS DE MÁS DE 10 H YA NO ESTÁN EN live_matches (los borra
    //  `cleanupLiveMatches`). Para ellos sólo quedan los INFORMES, así que el
    //  suceso se apunta en los informes y nada más (`_soloInformes`). La
    //  plantilla sale de las copias del entrenador.
    // ════════════════════════════════════════════════════════════════════
    let _soloInformes = false;
    let _partidosLista = [];
    let _listo = false;          // hay partido elegido y admite sucesos
    let _tokEleccion = 0;        // la última elección manda (carreras de red)
    const _FS_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
    const _MAX_PARTIDOS = 12;

    // ════════════════════════════════════════════════════════════════════
    //  v531 · LOS JUGADORES SALEN DEL PARTIDO DESTINO
    //
    //  Reporte del autor (implementar.txt, 2026-08-14): en un partido ya
    //  terminado no se podían registrar amarillas, rojas ni lesiones — "daba la
    //  impresión de que sólo dejaba actuar con el gol del rival".
    //
    //  🔑🔑🔑 Y era literalmente eso: la lista salía de `window.players`, que son
    //  los jugadores del partido cargado EN MEMORIA. Abriendo el modal desde la
    //  tarjeta de un partido terminado esa lista viene vacía, y el código caía en
    //  una rama que dejaba UNA sola opción: "Gol del Rival". El partido destino
    //  ya estaba disponible en `_targetMatchData` —se usaba para los permisos
    //  desde v434— pero no para sacar de él los jugadores. Mismo descuido que
    //  entonces, en el otro extremo de la función.
    // ════════════════════════════════════════════════════════════════════
    function _jugadoresDestino() {
        const enCurso = (typeof liveMatchId !== 'undefined') ? liveMatchId : null;
        const esElEnCurso = !_targetMatchId || _targetMatchId === enCurso;
        const delDestino = (_targetMatchData && Array.isArray(_targetMatchData.players))
            ? _targetMatchData.players : [];
        if (!esElEnCurso && delDestino.length) return delDestino;
        // 🔓 v797 · Un partido ELEGIDO que no es el que se juega no puede caer
        // a la plantilla en memoria: sería la de OTRO partido (o de otro
        // equipo), y el suceso se apuntaría a un jugador que no jugó.
        if (!esElEnCurso && _targetMatchId) return delDestino;
        const enMemoria = Array.isArray(window.players) ? window.players : [];
        if (enMemoria.length) return enMemoria;
        return delDestino;   // último recurso: mejor la plantilla guardada que nada
    }

    // ⚠️ EN EL MÓVIL EL <select> NATIVO ES UNA RUEDA que recorta el texto por la
    // derecha: el sufijo "(Campo)"/"(Banquillo)" que llevaba cada opción era
    // justo lo que se perdía, y por eso él veía una lista revuelta. Ahora el
    // sitio lo dice el GRUPO, que la rueda sí muestra como cabecera, y el texto
    // de cada opción se queda corto a propósito.
    function _opcionesJugadores(lista, filtro) {
        const porDorsal = (a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0);
        const enCampo = lista.filter(p => p.status === 'field').sort(porDorsal);
        const enBanco = lista.filter(p => p.status !== 'field').sort(porDorsal);
        const opt = p => `<option value="${p.id}">#${p.number} ${escapeHtml(p.name)}</option>`;
        const grupo = (etiqueta, jugadores) => jugadores.length
            ? `<optgroup label="${etiqueta}">${jugadores.map(opt).join('')}</optgroup>` : '';

        // 🔓 v797 · Un partido que sólo vive en los INFORMES no sabe quién
        // acabó en el campo y quién en el banquillo: se ofrece la plantilla
        // entera en todos los desplegables, en vez de dejar uno vacío.
        if (_soloInformes) {
            const todos = lista.slice().sort(porDorsal);
            return grupo('Jugadores del partido', todos) +
                   (filtro === 'todos' ? `<option value="rival">⚽ Gol del Rival / Visitante</option>` : '');
        }

        if (filtro === 'campo')     return grupo('En el campo', enCampo);
        if (filtro === 'banquillo') return grupo('En el banquillo', enBanco);
        // Lista completa: el rival al final, para no estorbar al caso normal.
        return grupo('En el campo', enCampo) + grupo('En el banquillo', enBanco) +
               `<option value="rival">⚽ Gol del Rival / Visitante</option>`;
    }

    // Repinta los dos desplegables al cambiar de tipo de suceso: en un CAMBIO
    // las listas no son la misma (sale uno del campo, entra uno del banquillo).
    function _repintaSelectores(tipo) {
        const sel = document.getElementById('retro-player-select');
        const selIn = document.getElementById('retro-sub-player-select');
        if (sel)   sel.innerHTML   = _opcionesJugadores(_jugadoresModal, tipo === 'sub' ? 'campo' : 'todos');
        if (selIn) selIn.innerHTML = _opcionesJugadores(_jugadoresModal, 'banquillo');
    }

    // ── Abrir el modal para registrar un evento retroactivo ────────────
    // v434 · 2º parámetro `matchData`: el documento del partido, para aplicar la
    // ventana de gracia. Es opcional a propósito — el botón "⏱️ PERDIDOS" del
    // partido en curso (index.html) llama sin argumentos y debe seguir yendo.
    // v434 · Lee el documento del partido para decidir la ventana con el dato
    // del SERVIDOR y no con la copia que tenga pintada la pantalla, que puede
    // llevar ahí un buen rato. Si la lectura falla se devuelve null y el cliente
    // deja pasar: entonces manda la regla de firestore.rules, que es la barrera
    // de verdad. Nunca al revés — un fallo de red no debe abrir la puerta.
    async function _cargarPartido(matchId) {
        try {
            const fa = window._cronos_auth;
            if (!fa || !fa.db || !matchId) return null;
            const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            const snap = await fs.getDoc(fs.doc(fa.db, 'live_matches', matchId));
            return snap.exists() ? { id: snap.id, ...snap.data() } : null;
        } catch (e) {
            console.warn('[v434] No se pudo leer el partido destino:', e && e.message);
            return null;
        }
    }

    // ════════════════════════════════════════════════════════════════════
    //  🎤 v803 · DICTADO POR VOZ DEL COMENTARIO
    //
    //  Encargo del autor (implementar.txt 2026-10-11, captura 11319): un
    //  micrófono junto al comentario que transcriba la voz al cuadro en tiempo
    //  real, con la API de reconocimiento de voz del navegador.
    //
    //  🔑 TRES CONDICIONES, y si falta una el botón NO APARECE:
    //    · el navegador la tiene (`SpeechRecognition`, o el prefijado de
    //      Chrome/Safari). Firefox no: ahí no se ofrece un botón que falle;
    //    · el micrófono no está prohibido por la cabecera Permissions-Policy:
    //      era `microphone=()` en toda la web y pasa a `microphone=(self)`
    //      (firebase.json, decisión del autor);
    //    · el usuario da permiso al micrófono (lo pregunta el navegador).
    //
    //  ⚠️ PRIVACIDAD (decisión del autor): esa API NO transcribe en el aparato.
    //  Chrome manda el audio a Google y Safari a Apple. El comentario va a un
    //  informe sobre MENORES, así que el aviso está junto al micrófono. Y lo
    //  dictado pasa por el MISMO filtro de datos de salud que lo escrito
    //  (`_leeFormulario`), porque acaba en el mismo cuadro.
    //
    //  Lo dictado se AÑADE a lo que ya hubiera, con el tope de 500. Mientras se
    //  habla sale el texto provisional; se fija al reconocerse. Para al volver
    //  a pulsar, al callarse un rato, al cerrar el modal o al cambiar de tipo.
    // ════════════════════════════════════════════════════════════════════
    let _dictado = null;          // el reconocedor en marcha, o null
    function _ReconocedorVoz() {
        return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }
    function _hayDictado() { return !!_ReconocedorVoz(); }
    function _pintaMic(activo, texto) {
        const b = document.getElementById('retro-mic-btn');
        const t = document.getElementById('retro-mic-txt');
        if (b) {
            b.style.background  = activo ? 'rgba(255,88,88,0.25)' : 'rgba(210,168,255,0.12)';
            b.style.borderColor = activo ? '#ff5858' : 'rgba(210,168,255,0.45)';
            b.style.color       = activo ? '#ff5858' : '#d2a8ff';
            b.title = activo ? 'Pulsa para dejar de dictar' : 'Dictar el comentario por voz';
        }
        if (t) t.textContent = texto || (activo ? 'PARAR' : 'DICTAR');
    }
    // ⚠️ Se DESCONECTA antes de parar: el fin del reconocimiento llega un
    // instante después y, si siguiera enganchado, reescribiría el cuadro —
    // por ejemplo, el que «Añadir a la lista» acaba de vaciar. Lo que ya
    // está en el cuadro (también lo provisional) se queda tal cual.
    function _paraDictado() {
        const r = _dictado;
        _dictado = null;
        if (r) {
            r.onresult = null; r.onend = null; r.onerror = null;
            try { r.stop(); } catch (e) {}
        }
        _pintaMic(false);
    }
    window._retroDictar = function () {
        if (_dictado) { _paraDictado(); return; }
        const SR = _ReconocedorVoz();
        const ta = document.getElementById('retro-comment-input');
        if (!SR || !ta) return;
        let rec;
        try { rec = new SR(); } catch (e) { return; }
        rec.lang = 'es-ES';
        rec.continuous = true;
        rec.interimResults = true;
        const base = String(ta.value || '').replace(/\s+$/, '');
        let fijo = '';
        const vuelca = (provisional) => {
            const txt = [base, (fijo + ' ' + (provisional || '')).trim()].filter(Boolean).join(' ')
                .replace(/\s+/g, ' ').slice(0, 500);
            ta.value = txt;
            const c = document.getElementById('retro-comment-count');
            if (c) c.textContent = txt.length + ' / 500';
        };
        rec.onresult = (e) => {
            let prov = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) fijo = (fijo + ' ' + r[0].transcript).trim();
                else prov += r[0].transcript;
            }
            vuelca(prov);
        };
        rec.onerror = (e) => {
            const motivo = {
                'not-allowed':         '🎤 El navegador no tiene permiso para usar el micrófono. Actívalo en los ajustes del sitio.',
                'service-not-allowed': '🎤 El dictado no está disponible en este navegador o modo.',
                'audio-capture':       '🎤 No se encuentra ningún micrófono.',
                'network':             '🎤 El dictado necesita conexión a internet.',
                'no-speech':           '🎤 No se ha oído nada. Vuelve a pulsar y habla cerca del micrófono.',
            }[e && e.error] || '';
            if (motivo && typeof showToast === 'function') showToast(motivo, 4500);
        };
        rec.onend = () => {
            if (_dictado === rec) _dictado = null;
            vuelca('');
            _pintaMic(false);
        };
        try { rec.start(); } catch (e) { return; }
        _dictado = rec;
        _pintaMic(true, 'PARAR');
        try { ta.focus(); } catch (_) {}
    };

    // El candado completo (js/match/immutability.js), o null. Se pide la
    // forma ENTERA: con un candado a medias se apaga la parte nueva y manda
    // `canAddEvent`, que es lo que miraba el modal antes de v797.
    function _lock() {
        const l = window.CronosMatchLock;
        return (l && typeof l.state === 'function' && typeof l.unlockValid === 'function') ? l : null;
    }

    // ── 🔓 v797 · ¿Hay un partido JUGÁNDOSE en esta pestaña? ─────────────
    function _idEnCurso() {
        const id = (typeof liveMatchId !== 'undefined') ? liveMatchId : null;
        if (!id) return null;
        const fase = (typeof matchPhase !== 'undefined') ? matchPhase : '';
        return fase === 'finished' ? null : id;
    }

    function _fechaCorta(iso) {
        const t = Date.parse(iso || '');
        if (isNaN(t)) return '';
        return new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    }

    // ── 🔓 v797 · Un partido que YA NO está en live_matches, desde sus informes ──
    //  Las copias del entrenador (`{matchId}_coach_pN`) llevan marcador,
    //  rival, lado y la ficha de cada jugador. Se piden por `coachUid` +
    //  `matchId`: dos igualdades, que no necesitan índice compuesto y que las
    //  reglas pueden demostrar por `coachUid`.
    async function _partidoDesdeInformes(matchId) {
        const fa = window._cronos_auth;
        const me = window._cronosCurrentUser || {};
        if (!fa || !fa.db || !matchId || !me.uid) return null;
        try {
            const fsm = await import(_FS_URL);
            const snap = await fsm.getDocs(fsm.query(fsm.collection(fa.db, 'cronos_player_reports'),
                fsm.where('coachUid', '==', me.uid), fsm.where('matchId', '==', String(matchId))));
            if (snap.empty) return null;
            const porDorsal = new Map();
            let base = null;
            snap.forEach(d => {
                const r = d.data() || {};
                if (!base || r._forCoach === true) base = r;
                const n = String(r.playerNumber || '').trim();
                if (!n || porDorsal.has(n)) return;
                porDorsal.set(n, { id: 'inf_' + n, number: n, name: r.playerAlias || r.playerName || ('#' + n),
                                   team: r.myTeamRole || 'home', status: 'field' });
            });
            if (!base) return null;
            const miRol = base.myTeamRole === 'away' ? 'away' : 'home';
            const miNombre = me.clubName || 'Mi equipo';
            const rival = base.rival || 'Rival';
            return {
                id: String(matchId),
                status: 'finished',
                // El informe se despacha al terminar: su fecha es el final.
                finishedAt: base.createdAt || null,
                myTeamRole: miRol,
                homeTeam: { name: miRol === 'home' ? miNombre : rival, score: Number(base.scoreHome) || 0 },
                awayTeam: { name: miRol === 'away' ? miNombre : rival, score: Number(base.scoreAway) || 0 },
                players: Array.from(porDorsal.values()),
                category: base.category || '', subcategory: base.subcategory || '',
                teamId: base.teamId || '', matchDate: base.matchDate || '',
                _soloInformes: true,
            };
        } catch (e) {
            console.warn('[v797] No se pudo reconstruir el partido desde sus informes:', e && e.message);
            return null;
        }
    }

    // ── 🔓 v797 · Los últimos partidos DEL EQUIPO SELECCIONADO ────────────
    //  Salen de los informes del entrenador (sobreviven toda la temporada),
    //  acotados al equipo activo por su sello `teamId` — el mismo criterio que
    //  «Recuperar» desde v794. Más el que se esté jugando, si lo hay.
    async function _cargaPartidosDelEquipo() {
        const fa = window._cronos_auth;
        const me = window._cronosCurrentUser || {};
        const lista = [];
        const enCurso = _idEnCurso();
        if (enCurso) lista.push({ id: enCurso, enCurso: true, etiqueta: '🟢 Partido en curso (el que estás jugando)' });
        if (!fa || !fa.db || !me.uid) return lista;
        let eq = '';
        try {
            const S = window._cronosMatchSlots;
            eq = (S && typeof S.equipoActual === 'function') ? (S.equipoActual() || '') : '';
        } catch (e) { eq = ''; }
        try {
            const fsm = await import(_FS_URL);
            const [snap, permisos] = await Promise.all([
                fsm.getDocs(fsm.query(fsm.collection(fa.db, 'cronos_player_reports'),
                    fsm.where('coachUid', '==', me.uid), fsm.orderBy('createdAt', 'desc'), fsm.limit(500))),
                fsm.getDocs(fsm.query(fsm.collection(fa.db, 'cronos_match_unlocks'),
                    fsm.where('coachUid', '==', me.uid))).catch(() => null),
            ]);
            const unl = new Map();
            if (permisos) permisos.forEach(d => unl.set(d.id, d.data() || {}));
            const vistos = new Set(lista.map(p => p.id));
            snap.forEach(d => {
                if (lista.length >= _MAX_PARTIDOS + (enCurso ? 1 : 0)) return;
                const r = d.data() || {};
                const mid = r.matchId ? String(r.matchId) : '';
                if (!mid || vistos.has(mid)) return;
                // Con equipo seleccionado, el sello tiene que ser EXACTO (v794).
                if (eq && r.teamId && String(r.teamId) !== eq) return;
                vistos.add(mid);
                const miRol = r.myTeamRole === 'away' ? 'away' : 'home';
                const yo = me.clubName || 'Mi equipo';
                const rival = r.rival || 'Rival';
                const marcador = (Number(r.scoreHome) || 0) + '-' + (Number(r.scoreAway) || 0);
                lista.push({
                    id: mid,
                    finishedAt: r.createdAt || null,
                    etiqueta: (_fechaCorta(r.createdAt || r.matchDate) ? _fechaCorta(r.createdAt || r.matchDate) + ' · ' : '') +
                              (miRol === 'home' ? yo + ' ' + marcador + ' ' + rival : rival + ' ' + marcador + ' ' + yo),
                    unlock: unl.get(mid) || null,
                });
            });
        } catch (e) {
            console.warn('[v797] No se pudieron listar los partidos del equipo:', e && e.message);
        }
        return lista;
    }

    // 🔓 v798 · A QUIÉN SE PIDE. En un club, al Director Deportivo o al
    // Coordinador; en un ENTE individual no existen y decide su administrador.
    // Mismo criterio de «estoy en el ente» que la purga (club-reports.js).
    function _quienDecide() {
        const ente = typeof window._sdEsEntornoIndividual === 'function' && window._sdEsEntornoIndividual();
        return ente
            ? { corto: 'el administrador de tu entidad',
                html: 'del <strong>administrador de tu entidad</strong>',
                aviso: 'El administrador de tu entidad la verá en su panel («Desbloqueos»).' }
            : { corto: 'el Director Deportivo o el Coordinador',
                html: 'del <strong>Director Deportivo</strong> o del <strong>Coordinador</strong>',
                aviso: 'Dirección y Coordinación la verán en su panel («Desbloqueos»).' };
    }

    // Lo que dice cada opción del desplegable sobre si admite sucesos.
    function _sufijoEstado(p) {
        if (p.enCurso) return '';
        const lock = _lock();
        if (!lock || !p.finishedAt) return '';
        const m = { status: 'finished', finishedAt: p.finishedAt, _cronosUnlock: p.unlock };
        const st = lock.state(m);
        if (st === 'grace') return ' · ✏️ ' + lock.graceRemainingText(m);
        if (lock.unlockValid(p.unlock)) return ' · 🔓 desbloqueado';
        if (p.unlock && p.unlock.status === 'pending') return ' · ⏳ permiso pedido';
        return ' · 🔒 cerrado';
    }

    function _opcionesPartidos() {
        const sel = _targetMatchId ? String(_targetMatchId) : '';
        let html = `<option value=""${sel ? '' : ' selected'}>— Elige el partido —</option>`;
        const lista = _partidosLista.slice();
        if (sel && !lista.some(p => p.id === sel)) {
            const d = _targetMatchData || {};
            const nombre = (d.homeTeam && d.awayTeam)
                ? `${d.homeTeam.name || 'Local'} ${d.homeTeam.score || 0}-${d.awayTeam.score || 0} ${d.awayTeam.name || 'Visitante'}`
                : 'Partido seleccionado';
            lista.unshift({ id: sel, etiqueta: nombre, finishedAt: null });
        }
        lista.forEach(p => {
            html += `<option value="${escapeHtml(p.id)}"${p.id === sel ? ' selected' : ''}>` +
                    escapeHtml(p.etiqueta + _sufijoEstado(p)) + '</option>';
        });
        return html;
    }

    // ── El recuadro de estado bajo el desplegable ──────────────────────────
    function _htmlEstado() {
        const lock = _lock();
        const caja = (col, html) =>
            `<div style="font-size:0.76rem; line-height:1.45; color:${col}; background:${col}14; border:1px solid ${col}55; padding:0.6rem; border-radius:8px;">${html}</div>`;
        if (!_targetMatchId) {
            return caja('#8b949e', '👆 Elige primero a qué partido pertenece el suceso. Sin partido no se puede registrar nada.');
        }
        if (!_targetMatchData || !lock) {
            return caja('#3fb950', '🟢 Partido en curso: el suceso entra en su historial con el minuto que indiques.');
        }
        const st = lock.state(_targetMatchData);
        const aviso = '<br><em>Todo lo que añadas aquí saldrá en los informes en cursiva y con el icono en rojo, como información posterior al partido.</em>';
        if (st === 'live')  return caja('#3fb950', '🟢 Partido en curso.' + aviso);
        if (st === 'grace') return caja('#f0883e', `✏️ Partido terminado: quedan <strong>${escapeHtml(lock.graceRemainingText(_targetMatchData))}</strong> de margen para añadir sucesos.` + aviso);

        const U = window.CronosUnlocks;
        const u = _targetMatchData._cronosUnlock || null;
        const est = U ? U.estado(u) : 'none';
        const hora = (v) => (U ? U.horaCorta(U.toMs(v)) : '');
        if (est === 'granted') {
            return caja('#3fb950', `🔓 Desbloqueado por <strong>${escapeHtml(u.decidedByName || 'Dirección')}</strong> hasta las <strong>${escapeHtml(hora(u.expiresAt))}</strong>.` + aviso);
        }
        const solo = _soloInformes ? '<br>📋 El partido ya no está en el directo: el suceso se añadirá a sus informes.' : '';
        if (est === 'pending') {
            return caja('#f0883e', `⏳ Has pedido el desbloqueo (${escapeHtml(hora(u.requestedAt))}). En cuanto ${_quienDecide().corto} lo conceda podrás añadir los sucesos.` +
                `<div style="margin-top:0.5rem;"><button type="button" onclick="window._retroElegirPartido(document.getElementById('retro-match-select').value)" style="background:rgba(240,136,62,0.15); border:1px solid rgba(240,136,62,0.5); color:#f0883e; padding:0.4rem 0.8rem; border-radius:7px; font-weight:800; cursor:pointer;">🔄 Comprobar de nuevo</button></div>`);
        }
        const previo = est === 'denied' ? `<br>⛔ La última solicitud la denegó ${escapeHtml(u.decidedByName || 'Dirección')}.`
                     : est === 'revoked' ? `<br>↩️ ${escapeHtml(u.decidedByName || 'Dirección')} retiró el permiso.`
                     : est === 'expired' ? '<br>⌛ El permiso anterior ya caducó.' : '';
        return caja('#ff5858',
            '🔒 <strong>Partido cerrado.</strong> Terminó hace más de 2 horas y ya no admite cambios. ' +
            'Para añadir sucesos necesitas permiso ' + _quienDecide().html + ' para este partido.' +
            previo + solo +
            `<textarea id="retro-unlock-reason" maxlength="300" rows="2" placeholder="Motivo (opcional): p. ej. me quedé sin batería en la 2ª parte" style="width:100%; box-sizing:border-box; margin-top:0.5rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.45rem; border-radius:7px; font-size:0.78rem; font-family:inherit; resize:vertical;"></textarea>` +
            `<div style="margin-top:0.45rem;"><button type="button" onclick="window._retroSolicitarDesbloqueo()" style="background:linear-gradient(135deg,#f0883e,#d2691e); border:none; color:white; padding:0.5rem 0.9rem; border-radius:7px; font-weight:800; cursor:pointer;">📨 Solicitar desbloqueo</button></div>`);
    }

    // Formulario apagado mientras no haya partido que admita sucesos. El
    // apagado es de interfaz: `submitRetroactiveEvent` vuelve a comprobarlo.
    function _pintaEstadoYFormulario() {
        const est = document.getElementById('retro-match-status');
        if (est) est.innerHTML = _htmlEstado();
        const cuerpo = document.getElementById('retro-form-body');
        if (cuerpo) {
            cuerpo.style.opacity = _listo ? '1' : '0.35';
            cuerpo.style.pointerEvents = _listo ? 'auto' : 'none';
        }
        const btn = document.getElementById('retro-save-btn');
        if (btn) {
            btn.disabled = !_listo;
            btn.style.opacity = _listo ? '1' : '0.45';
            btn.style.cursor = _listo ? 'pointer' : 'not-allowed';
        }
    }

    // 🔓 v797 · Campos que dicen que el suceso se añadió A POSTERIORI. Sin
    // `undefined` (el SDK de Firestore lanza): sólo se ponen si hay dato.
    function _marcasPosteriores() {
        const lock = _lock();
        const m = { retro: true };
        const st = (_targetMatchData && lock) ? lock.state(_targetMatchData) : 'live';
        if (st !== 'live') m.addedAfterMatch = true;
        const u = _targetMatchData && _targetMatchData._cronosUnlock;
        if (st === 'frozen' && lock && lock.unlockValid(u)) {
            m.unlockedBy = String(u.decidedByName || u.decidedBy || '').slice(0, 80);
        }
        return m;
    }

    function _calculaListo() {
        const lock = window.CronosMatchLock;
        _listo = !!_targetMatchId && (!_targetMatchData || !lock || lock.canAddEvent(_targetMatchData));
    }

    // Trae el permiso al partido si está cerrado (lo mira CronosMatchLock).
    function _hayQueLeerPermiso() {
        const lock = _lock();
        return !!(_targetMatchData && lock && window.CronosUnlocks
                  && lock.state(_targetMatchData) === 'frozen');
    }
    async function _adjuntaPermiso() {
        if (!_hayQueLeerPermiso()) return;
        _targetMatchData._cronosUnlock = await window.CronosUnlocks.leer(_targetMatchId);
    }

    // ── 🔓 v797 · Elegir (o volver a comprobar) el partido destino ─────────
    window._retroElegirPartido = async function (id) {
        // 📋 v799 · EL LOTE ES DE UN PARTIDO: cambiar con sucesos pendientes
        // los mandaría al encuentro equivocado. Se pregunta; si no, se vuelve.
        if (_lote.length && String(id || '') !== String(_targetMatchId || '')) {
            if (!_confirma('Tienes ' + _lote.length + ' suceso(s) en la lista de este partido SIN GUARDAR.\n\n' +
                           '¿Cambiar de partido y descartarlos?')) {
                const sel = document.getElementById('retro-match-select');
                if (sel) sel.value = _targetMatchId || '';
                return;
            }
            _lote = [];
            _informePendiente = null;
            _pintaLote();
        }
        const tok = ++_tokEleccion;
        _targetMatchId = id ? String(id) : null;
        _targetMatchData = null;
        _soloInformes = false;
        _listo = false;
        const est = document.getElementById('retro-match-status');
        if (est && _targetMatchId) est.innerHTML = '<div style="font-size:0.76rem; color:#8b949e;">⏳ Comprobando el partido…</div>';
        _pintaEstadoYFormulario();
        if (!_targetMatchId) { _pintaEstadoYFormulario(); return; }

        if (_targetMatchId !== _idEnCurso()) {
            let d = await _cargarPartido(_targetMatchId);
            if (tok !== _tokEleccion) return;
            if (!d) {
                d = await _partidoDesdeInformes(_targetMatchId);
                if (tok !== _tokEleccion) return;
                _soloInformes = !!d;
            }
            if (!d) {
                if (est) est.innerHTML = '<div style="font-size:0.76rem; color:#ff5858;">⚠️ No se ha podido cargar ese partido. Revisa la conexión e inténtalo otra vez.</div>';
                return;
            }
            _targetMatchData = d;
            await _adjuntaPermiso();
            if (tok !== _tokEleccion) return;
        }
        _calculaListo();
        _jugadoresModal = _jugadoresDestino();
        _repintaSelectores(_selectedEventType);
        _pintaEstadoYFormulario();
        _pintaOpcionClip();   // 🎬 v804 · «también familias» sólo en adultos
        _pintaAvisoSalud();   // 🧒 v832 · aviso de menores sólo en base
    };

    // ── 🔓 v797 · El entrenador pide el desbloqueo ─────────────────────────
    window._retroSolicitarDesbloqueo = async function () {
        const U = window.CronosUnlocks;
        if (!U || !_targetMatchId || !_targetMatchData) return;
        const sel = document.getElementById('retro-match-select');
        const opt = sel && sel.options ? sel.options[sel.selectedIndex] : null;
        const etiqueta = opt ? String(opt.textContent || '').replace(/ · (🔒|⏳|🔓|✏️).*$/, '') : '';
        const ta = document.getElementById('retro-unlock-reason');
        const d = _targetMatchData;
        const r = await U.solicitar({
            matchId: _targetMatchId,
            matchLabel: etiqueta || ((d.homeTeam && d.awayTeam)
                ? `${d.homeTeam.name} ${d.homeTeam.score || 0}-${d.awayTeam.score || 0} ${d.awayTeam.name}` : _targetMatchId),
            matchDate: d.matchDate || _fechaCorta(d.finishedAt && d.finishedAt.toDate ? d.finishedAt.toDate().toISOString() : d.finishedAt) || '',
            teamId: d.teamId || '',
            category: d.category || d.matchCategory || '',
            subcategory: d.subcategory || d.matchSubcategory || '',
            reason: ta ? String(ta.value || '').trim() : '',
        });
        if (typeof showToast === 'function') {
            showToast(r.ok ? '📨 Solicitud enviada. ' + _quienDecide().aviso
                           : '⚠️ No se ha podido enviar la solicitud. Inténtalo de nuevo.', r.ok ? 5000 : 6000);
        }
        if (r.ok) await window._retroElegirPartido(_targetMatchId);
    };

    // Rellena el desplegable con la lista del equipo SIN pisar la elección.
    async function _rellenaSelector() {
        const lista = await _cargaPartidosDelEquipo();
        _partidosLista = lista;
        const sel = document.getElementById('retro-match-select');
        if (sel) sel.innerHTML = _opcionesPartidos();
        const nota = document.getElementById('retro-match-note');
        if (nota) {
            nota.textContent = lista.length
                ? 'Últimos partidos de tu equipo seleccionado.'
                : 'No se han encontrado partidos recientes de tu equipo seleccionado.';
        }
    }

    window.openRetroactiveEventModal = async function(matchId, matchData) {
        // 🔓 v797 · SIN partido explícito NO se elige ninguno: antes caía en
        // la global `liveMatchId`. Ahora lo elige el entrenador en el
        // desplegable (encargo del autor). Los listados de Partidos Terminados
        // sí lo pasan, y llega ya seleccionado.
        _tokEleccion++;
        _targetMatchId = matchId ? String(matchId) : null;
        _targetMatchData = matchData || null;
        _soloInformes = !!(_targetMatchData && _targetMatchData._soloInformes);
        _partidosLista = [];

        // Si el destino NO es el partido que se está jugando, se lee su estado.
        // Así la puerta funciona para cualquier punto de llamada sin que tenga
        // que cooperar pasando los datos — incluidos los que se añadan después.
        if (!_targetMatchData && _targetMatchId && _targetMatchId !== _idEnCurso()) {
            _targetMatchData = await _cargarPartido(_targetMatchId);
            if (!_targetMatchData) {
                _targetMatchData = await _partidoDesdeInformes(_targetMatchId);
                _soloInformes = !!_targetMatchData;
            }
        }

        // v434 · PUERTA DE ENTRADA, 🔓 v797 · AHORA ABRE CON EL AVISO. Un
        // partido cerrado ya no cierra el modal con un toast: lo abre con el
        // formulario apagado, el motivo y el botón para pedir el permiso.
        // ⚠️ El `await` SÓLO si hay permiso que leer: un partido en curso o en
        // su ventana se pinta en el acto, sin esperar a la red.
        if (_hayQueLeerPermiso()) await _adjuntaPermiso();
        _calculaListo();

        let modal = document.getElementById('cronos-retroactive-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cronos-retroactive-modal';
            modal.className = 'modal-backdrop';
            modal.style.cssText = `
                position: fixed; inset: 0; z-index: 100005;
                background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: white;
            `;
            document.body.appendChild(modal);
        }

        // v690 · El tipo elegido NO sobrevive de la vez anterior: tras un
        // "Cambio", reabrir enseñaba "Gol" y guardaba un cambio.
        // 🎬 v817 · Y ya no abre con "Gol" marcado: abre SIN TIPO (encargo del
        // autor, implementar.txt 2026-10-14). Con Gol por defecto, quien sólo
        // quería subir un vídeo apuntaba un gol sin darse cuenta — y un gol
        // mueve el marcador y el informe.
        _selectedEventType = null;
        _paraDictado();   // 🎤 v803 · un dictado de la vez anterior no sigue escuchando
        _jugadoresModal = _targetMatchId ? _jugadoresDestino() : [];
        const playerOptions    = _opcionesJugadores(_jugadoresModal, 'todos');
        const playerOptionsIn  = _opcionesJugadores(_jugadoresModal, 'banquillo');

        modal.innerHTML = `
            <div class="modal-content" style="width:min(94vw, 580px); max-height:92vh; overflow-y:auto; box-sizing:border-box; background:#0d1117; border:1px solid rgba(88,166,255,0.3); border-radius:14px; padding:1.2rem; display:flex; flex-direction:column; gap:1rem; box-shadow:0 10px 30px rgba(0,0,0,0.8);">
                <!-- Cabecera -->
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.6rem;">
                    <h3 style="margin:0; font-size:1.05rem; color:white; display:flex; align-items:center; gap:0.5rem;">
                        ⏱️ Registrar Evento Perdido
                    </h3>
                    <button onclick="window.closeRetroactiveEventModal()" style="background:none; border:none; color:#7d8590; font-size:1.4rem; cursor:pointer;">✕</button>
                </div>

                <div style="font-size:0.75rem; color:#7d8590; background:rgba(88,166,255,0.08); border:1px solid rgba(88,166,255,0.2); padding:0.6rem; border-radius:8px;">
                    💡 Usa este formulario si te quedaste sin batería o cobertura durante el partido. El evento se insertará cronológicamente en el historial y en el informe.
                </div>

                <!-- 🔓 v797 · EL PARTIDO, LO PRIMERO Y OBLIGATORIO -->
                <div>
                    <label for="retro-match-select" style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.3rem;">Partido al que pertenece el suceso:</label>
                    <select id="retro-match-select" onchange="window._retroElegirPartido(this.value)" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(88,166,255,0.45); color:white; padding:0.55rem; border-radius:8px; font-weight:700;">
                        ${_opcionesPartidos()}
                    </select>
                    <div id="retro-match-note" style="font-size:0.66rem; color:#7d8590; margin-top:0.25rem;">⏳ Cargando los últimos partidos de tu equipo…</div>
                </div>
                <div id="retro-match-status"></div>

                <div id="retro-form-body" style="display:flex; flex-direction:column; gap:1rem; transition:opacity 0.15s;">
                <!-- Selección de Minuto y Parte -->
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.8rem;">
                    <div>
                        <label style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.3rem;">Parte del Partido:</label>
                        <select id="retro-half-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700;">
                            <option value="1T">1ª Parte (1T)</option>
                            <option value="2T">2ª Parte (2T)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.3rem;">Minuto Exacto (1' - 90'):</label>
                        <input type="number" id="retro-minute-input" min="1" max="120" value="30" style="width:100%; box-sizing:border-box; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700; font-family:monospace;">
                    </div>
                </div>

                <!-- Selección del Tipo de Evento -->
                <div>
                    <label style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.4rem;">Tipo de Suceso:</label>
                    <!-- v690 · seis tipos: en tres columnas caben en el móvil sin cortar el texto -->
                    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:0.4rem;">
                        <button type="button" onclick="window._setRetroEventType('goal')" id="btn-retro-goal" class="btn-retro-type" aria-pressed="false" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">⚽ Gol</button>
                        <button type="button" onclick="window._setRetroEventType('sub')" id="btn-retro-sub" class="btn-retro-type" aria-pressed="false" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🔄 Cambio</button>
                        <button type="button" onclick="window._setRetroEventType('yellow')" id="btn-retro-yellow" class="btn-retro-type" aria-pressed="false" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🟨 Amarilla</button>
                        <button type="button" onclick="window._setRetroEventType('red')" id="btn-retro-red" class="btn-retro-type" aria-pressed="false" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🟥 Roja</button>
                        <button type="button" onclick="window._setRetroEventType('injury')" id="btn-retro-injury" class="btn-retro-type" aria-pressed="false" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🚑 Lesión</button>
                        <button type="button" onclick="window._setRetroEventType('comment')" id="btn-retro-comment" class="btn-retro-type" aria-pressed="false" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">💬 Comentario</button>
                    </div>
                    <div id="retro-type-hint" style="font-size:0.66rem; color:#7d8590; margin-top:0.3rem; line-height:1.35;">
                        Pulsa otra vez un tipo para quitarlo. Sin tipo, sólo se guarda el vídeo de la jugada.
                    </div>
                </div>

                <!-- Selección de Jugador -->
                <div id="retro-player-container">
                    <label id="retro-player-label" style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.3rem;">Jugador Implicado:</label>
                    <select id="retro-player-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700;">
                        ${playerOptions}
                    </select>
                </div>

                <!-- 💬 v690 · Comentario del partido: texto libre, sin jugador -->
                <div id="retro-comment-container" style="display:none;">
                    <label for="retro-comment-input" style="font-size:0.75rem; font-weight:700; color:#d2a8ff; display:block; margin-bottom:0.3rem;">Comentario del partido:</label>
                    <!-- 🎤 v803 · el micrófono va PEGADO al cuadro (a su derecha) y sólo
                         si el navegador sabe dictar: ver _retroDictar. -->
                    <div style="display:flex; gap:0.45rem; align-items:stretch;">
                    <textarea id="retro-comment-input" maxlength="500" rows="4"
                        placeholder="Observaciones tácticas o generales sobre el partido (de los dos equipos)…"
                        oninput="var c=document.getElementById('retro-comment-count'); if (c) c.textContent = this.value.length + ' / 500';"
                        style="flex:1; min-width:0; width:100%; box-sizing:border-box; resize:vertical; background:rgba(255,255,255,0.05); border:1px solid rgba(210,168,255,0.35); color:white; padding:0.55rem; border-radius:8px; font-size:0.85rem; font-family:inherit; line-height:1.4;"></textarea>
                    ${_hayDictado() ? `
                    <button type="button" id="retro-mic-btn" onclick="window._retroDictar()" title="Dictar el comentario por voz" aria-label="Dictar el comentario por voz"
                        style="flex-shrink:0; width:3rem; border-radius:8px; cursor:pointer; font-size:1.25rem; background:rgba(210,168,255,0.12); border:1px solid rgba(210,168,255,0.45); color:#d2a8ff; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.15rem;">
                        🎤<span id="retro-mic-txt" style="font-size:0.52rem; font-weight:800; letter-spacing:0.3px;">DICTAR</span>
                    </button>` : ''}
                    </div>
                    <div style="display:flex; justify-content:space-between; gap:0.5rem; margin-top:0.25rem; font-size:0.68rem; color:#7d8590;">
                        <span>🔒 Sólo lo ve el cuerpo técnico: historial del partido e informe.</span>
                        <span id="retro-comment-count" style="flex-shrink:0;">0 / 500</span>
                    </div>
                    ${_hayDictado() ? `
                    <div style="margin-top:0.3rem; font-size:0.64rem; color:#8b949e; line-height:1.35;">
                        🎤 El dictado lo transcribe el servicio de voz de tu navegador (Google o Apple), fuera de la app: no dictes nombres completos ni datos de salud.
                    </div>` : ''}
                    <!-- ══════════════════════════════════════════════════════
                         🛡️ Fase 4 (2026-09-22) · EL AVISO DE DATOS DE SALUD

                         Éste es el ÚNICO texto libre de la aplicación que
                         acaba dentro de cronos_player_reports: los despachos
                         copian matchComments en cada documento del cuerpo
                         técnico. O sea, lo que se escriba aquí se guarda
                         junto a los datos de un MENOR.

                         🔑 La app no registra salud en ningún sitio a
                         propósito —la asistencia sólo admite una causa
                         genérica «médico», sin diagnóstico ni texto—, pero
                         esa protección se cae si alguien la escribe AQUÍ a
                         mano. No se puede impedir por código sin mutilar el
                         campo; lo que sí se puede es decirlo donde se está
                         escribiendo, que es el único momento en que sirve.

                         ⚠️ El aviso va DEBAJO del contador y no dentro del
                         placeholder: un placeholder desaparece en cuanto se
                         teclea la primera letra, justo cuando haría falta.

                         🚨 SIN COMILLAS INVERTIDAS EN ESTE COMENTARIO. Todo
                         este HTML vive dentro de un template literal de JS:
                         una sola comilla invertida lo CIERRA y el fichero
                         deja de compilar. Es la trampa de v596 y v641, y me
                         la comí escribiendo justo este aviso.

                         🧒 v832 · Según la CATEGORÍA del partido elegido
                         (encargo del autor, implementar.txt 2026-10-21): en
                         base (Juvenil hacia abajo) este aviso tal cual; en
                         adultos (Regional, Nacional, FEM...) uno genérico sin
                         la mención a menores. Lo pinta _pintaAvisoSalud con
                         la MISMA regla que el vídeo (CronosClips.esAdultos).
                         Por defecto, el de menores: ante la duda, el estricto.
                         ══════════════════════════════════════════════════ -->
                    <div id="retro-aviso-salud" style="margin-top:0.4rem; padding:0.4rem 0.55rem; border-radius:6px; background:rgba(248,81,73,0.08); border:1px solid rgba(248,81,73,0.28); font-size:0.66rem; color:#ff9b93; line-height:1.35;">
                        ⚠️ <strong>No anotes datos de salud</strong> (lesiones concretas, diagnósticos, medicación)
                        ni información personal ajena al partido. Es un informe deportivo sobre menores.
                    </div>
                </div>

                <!-- Jugador Entrante (para cambios) -->
                <div id="retro-sub-container" style="display:none;">
                    <label style="font-size:0.75rem; font-weight:700; color:#2ecc71; display:block; margin-bottom:0.3rem;">Jugador que Entra al Campo:</label>
                    <select id="retro-sub-player-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700;">
                        ${playerOptionsIn}
                    </select>
                </div>

                <!-- 🎬 v804 · vídeo de la jugada (sólo con el extra modulo_videos) -->
                ${(window.CronosClips && window.CronosClips.activo()) ? `
                <div id="retro-clip-box" style="background:rgba(255,255,255,0.03); border:1px dashed rgba(88,166,255,0.35); border-radius:8px; padding:0.55rem;">
                    <div style="font-size:0.75rem; font-weight:700; color:#58a6ff; margin-bottom:0.35rem;">🎬 Vídeo de la jugada (opcional):</div>
                    <!-- 🎬 v806 · DOS entradas: con capture el sistema abre SÓLO la cámara
                         (Android no deja ir a la galería), así que grabar y elegir van por
                         separado. accept="video/*" sin códecs: cualquier vídeo del aparato. -->
                    <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                        <label id="retro-clip-grabar" style="flex:1 1 130px; display:${(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 'flex' : 'none'}; align-items:center; justify-content:center; gap:0.3rem; min-height:44px; background:rgba(248,81,73,0.12); border:1px solid rgba(248,81,73,0.5); color:#ff7b72; border-radius:8px; font-size:0.78rem; font-weight:800; cursor:pointer; position:relative; overflow:hidden;">
                            📹 Grabar ahora
                            <input type="file" id="retro-clip-camara" accept="video/*" capture="environment" onchange="window._retroClipElegido(this)"
                                style="position:absolute; inset:0; opacity:0; width:100%; height:100%; cursor:pointer;">
                        </label>
                        <label id="retro-clip-elegir" style="flex:1 1 130px; display:flex; align-items:center; justify-content:center; gap:0.3rem; min-height:44px; background:rgba(88,166,255,0.12); border:1px solid rgba(88,166,255,0.5); color:#58a6ff; border-radius:8px; font-size:0.78rem; font-weight:800; cursor:pointer; position:relative; overflow:hidden;">
                            🖼️ ${(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 'Elegir de la galería' : 'Elegir vídeo'}
                            <input type="file" id="retro-clip-input" accept="video/*" onchange="window._retroClipElegido(this)"
                                style="position:absolute; inset:0; opacity:0; width:100%; height:100%; cursor:pointer;">
                        </label>
                    </div>
                    <div id="retro-clip-info" style="font-size:0.66rem; color:#8b949e; margin-top:0.3rem; line-height:1.35;">
                        Máx. ${window.CronosClips.MAX_SEG} s y 50 MB. Se verá UNA vez por cuenta, con marca de agua, y se borra solo a las 24 h.
                    </div>
                    <label id="retro-clip-familias-box" style="display:none; margin-top:0.35rem; font-size:0.72rem; color:#c9d1d9; gap:0.4rem; align-items:center;">
                        <input type="checkbox" id="retro-clip-familias"> 👪 Que también lo vean los jugadores y sus familias (categoría de adultos)
                    </label>
                </div>` : ''}

                <!-- 📋 v799 · apuntar sin guardar: el suceso va a la lista de abajo -->
                <button type="button" id="retro-add-btn" onclick="window._retroAnadirALista()" style="width:100%; background:rgba(63,185,80,0.12); border:1px dashed rgba(63,185,80,0.55); color:#3fb950; padding:0.55rem; border-radius:8px; font-weight:800; cursor:pointer;">
                    ➕ Añadir a la lista
                </button>
                </div>

                <!-- 📋 v799 · los sucesos pendientes de guardar -->
                <!-- 🎬 v817 · más grande y legible (encargo del autor, implementar.txt 2026-10-14):
                     filas en tarjeta, y crece hasta media pantalla antes de hacer scroll. -->
                <div id="retro-lote" style="display:none; background:rgba(88,166,255,0.05); border:1px solid rgba(88,166,255,0.35); border-radius:10px; padding:0.75rem; min-height:110px; max-height:min(50vh, 440px); overflow-y:auto;"></div>

                <!-- Botón Guardar -->
                <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:0.4rem;">
                    <button type="button" onclick="window.closeRetroactiveEventModal()" style="background:rgba(255,255,255,0.08); border:none; color:white; padding:0.6rem 1.2rem; border-radius:8px; font-weight:700; cursor:pointer;">Cancelar</button>
                    <button type="button" id="retro-save-btn" onclick="window.submitRetroactiveEvent()" style="background:linear-gradient(135deg,#58a6ff,#1f6beb); border:none; color:white; padding:0.6rem 1.4rem; border-radius:8px; font-weight:800; cursor:pointer; box-shadow:0 4px 12px rgba(88,166,255,0.3);">
                        💾 Guardar Evento Retroactivo
                    </button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';
        // 🔓 v797 · Estado del partido elegido y, después, la lista del equipo
        // (va a la nube: el modal no la espera para aparecer).
        // 📋 v799 · cada apertura empieza con el lote vacío.
        _lote = [];
        _informePendiente = null;
        _pintaLote();
        _pintaEstadoYFormulario();
        _limpiaClip();       // 🎬 v804
        _pintaOpcionClip();
        _pintaAvisoSalud();  // 🧒 v832
        _rellenaSelector();
    };

    // ════════════════════════════════════════════════════════════════════
    //  v531 · PERSISTIR LA CORRECCIÓN EN EL PARTIDO DESTINO
    //
    //  El suceso lo escribe `_registerMatchEvent` (arrayUnion sobre `events`).
    //  Pero los contadores del jugador y el marcador viven en OTROS campos del
    //  mismo documento y nadie los estaba escribiendo para un partido que no sea
    //  el que se está jugando.
    //
    //  ⚠️⚠️ OJO, BARRERA DE SERVIDOR: en la ventana de gracia de 2 h,
    //  `lmOnlyEvents()` de firestore.rules permite cambiar SOLO `events` y
    //  `updatedAt` (hasOnly). Escribir `players` o el marcador de un partido
    //  terminado se DENIEGA hoy, a propósito: ese hasOnly se puso en v434 para
    //  impedir que se reescriban marcador y alineaciones. Por eso aquí no se da
    //  por hecho el éxito — se devuelve si ha ido o no, y quien llama lo dice.
    //  Mientras la regla siga así, en un partido TERMINADO el suceso se registra
    //  pero los contadores no se corrigen.
    // ════════════════════════════════════════════════════════════════════
    async function _persisteCorreccionDestino() {
        const enCurso = (typeof liveMatchId !== 'undefined') ? liveMatchId : null;
        // El partido en curso ya se sincroniza solo: aquí no hay nada que hacer.
        if (!_targetMatchId || _targetMatchId === enCurso || !_targetMatchData) return true;
        try {
            const fa = window._cronos_auth;
            if (!fa || !fa.db) return false;
            const fsm = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            await fsm.setDoc(fsm.doc(fa.db, 'live_matches', _targetMatchId), {
                players:  _targetMatchData.players,
                homeTeam: _targetMatchData.homeTeam,
                awayTeam: _targetMatchData.awayTeam,
            }, { merge: true });
            return true;
        } catch (e) {
            console.warn('[v531] No se pudo corregir la ficha del partido destino:',
                         e && e.message);
            return false;
        }
    }

    // ════════════════════════════════════════════════════════════════════
    //  ⚽🟠 v715 · Y EL INFORME DEL PARTIDO SE CORRIGE TAMBIÉN
    // ════════════════════════════════════════════════════════════════════
    //  Encargo del autor (implementar.txt 2026-09-14): «cuando se añade un gol
    //  mediante este formulario retroactivo, el sistema debe actualizar de
    //  inmediato el tanteo global del partido y modificar el resultado final
    //  del marcador (y las estadísticas asociadas)».
    //
    //  🔑 EL MARCADOR NO VIVE EN UN SOLO SITIO. v531 ya corregía
    //  `live_matches` —`homeTeam.score` / `awayTeam.score` y la ficha de los
    //  jugadores—, que es lo que pinta el VISOR. Pero el resultado que se ve en
    //  Mis Informes, en el Panel de Dirección y en el Área de Familias sale de
    //  OTRA colección: `cronos_player_reports`, con una copia por jugador y por
    //  destinatario, escrita al terminar el partido. Ese lado no lo tocaba
    //  nadie, así que el visor decía 0-3 y el informe seguía diciendo 0-2.
    //
    //  🔑 POR ESO SE ESCRIBEN TODAS LAS COPIAS DEL PARTIDO, no una: el marcador
    //  está DESNORMALIZADO en cada documento, y corregir sólo algunas deja el
    //  resultado dependiendo de cuál lea primero el agrupador. Va en UN LOTE
    //  (`writeBatch`): o se corrige el partido entero o no se corrige nada.
    //
    //  ⚠️ LA MARCA `(RETRO)` VIAJA EN EL APUNTE. Entra en el `history` del
    //  jugador con `retro: true` —la misma forma que deja
    //  `_parseHistoryForFirestore`— para que el informe individual lo pinte en
    //  naranja (v715) y no como un suceso cantado en directo.
    //
    //  ⚠️ LOS COMENTARIOS NO VAN A LAS FAMILIAS. Es la política de v690: son
    //  notas del cuerpo técnico. Se añaden sólo a las copias de staff y del
    //  entrenador.
    //
    //  ⚠️ Si el partido no tiene informes (nunca se despacharon), no hay nada
    //  que corregir y eso NO es un fallo: se devuelve éxito.
    // ════════════════════════════════════════════════════════════════════
    // 📋 v799 · `cambio` puede ser UNO o una LISTA (el lote del modal). Todo
    // va igualmente en UN `writeBatch`: los marcadores y los goles se SUMAN
    // por documento, y los apuntes y comentarios entran en un único
    // `arrayUnion`. Un lote de 5 sucesos no son 5 escrituras de cada copia.
    async function _corrigeInformesDelPartido(cambio) {
        const cambios = (Array.isArray(cambio) ? cambio : [cambio]).filter(Boolean);
        if (!_targetMatchId || !cambios.length) return true;
        const fa = window._cronos_auth;
        if (!fa || !fa.db) return false;
        try {
            const fsm = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            // ════════════════════════════════════════════════════════════
            //  🔴 v817 · «EL INFORME DEL PARTIDO NO SE PUDO ACTUALIZAR»
            //  (captura 11547). La consulta iba SÓLO por `matchId`, y las
            //  reglas no son filtros: Firestore rechaza entera una consulta
            //  que no puede DEMOSTRAR que sólo devuelve documentos legibles, y
            //  `matchId` no aparece en ninguna regla de cronos_player_reports.
            //  Era permission-denied siempre que quien guarda no es SuperAdmin.
            //  Ahora van dos consultas que las reglas sí pueden demostrar —por
            //  el club (sameClubAsDoc/userDocClubId) y por el autor (coachUid),
            //  el patrón de _partidoDesdeInformes— y se funden por documento.
            //  Basta con que una responda; si fallan las dos, se avisa.
            // ════════════════════════════════════════════════════════════
            const me = window._cronosCurrentUser || {};
            const col = fsm.collection(fa.db, 'cronos_player_reports');
            const clubId = (_targetMatchData && _targetMatchData.clubId) || me.clubId || '';
            const consultas = [];
            if (clubId) consultas.push(fsm.getDocs(fsm.query(col,
                fsm.where('clubId', '==', String(clubId)), fsm.where('matchId', '==', String(_targetMatchId)))));
            if (me.uid) consultas.push(fsm.getDocs(fsm.query(col,
                fsm.where('coachUid', '==', me.uid), fsm.where('matchId', '==', String(_targetMatchId)))));
            // Sin club ni sesión conocidos, la de siempre (que sólo el SuperAdmin pasa).
            if (!consultas.length) consultas.push(fsm.getDocs(fsm.query(col,
                fsm.where('matchId', '==', String(_targetMatchId)))));
            const res = await Promise.allSettled(consultas);
            const buenas = res.filter(r => r.status === 'fulfilled');
            res.filter(r => r.status === 'rejected').forEach(r =>
                console.warn('[v817] Consulta de informes rechazada:', r.reason && (r.reason.code || r.reason.message)));
            if (!buenas.length) return false;
            const porRuta = new Map();
            buenas.forEach(r => r.value.forEach(d => porRuta.set((d.ref && d.ref.path) || d.ref || d.id, d)));
            if (!porRuta.size) return true;

            const lote = fsm.writeBatch(fa.db);
            let escrituras = 0;
            porRuta.forEach(d => {
                const r = d.data() || {};
                const upd = {};
                const dorsalDoc = String(r.playerNumber || '').trim();
                const esDe = (dorsal) => dorsal != null && dorsalDoc !== '' && dorsalDoc === String(dorsal).trim();
                let home = Number(r.scoreHome) || 0, away = Number(r.scoreAway) || 0;
                let goles = Number(r.goals) || 0, tarjeta = r.cards;
                const apuntes = [], notas = [];

                cambios.forEach(c => {
                    // 1 · EL MARCADOR, en todas las copias.
                    if (c.ladoGol === 'away') upd.scoreAway = ++away;
                    else if (c.ladoGol)       upd.scoreHome = ++home;

                    // 2 · LA FICHA DEL JUGADOR, sólo en sus copias.
                    if (esDe(c.dorsal)) {
                        if (c.tipo === 'goal')   upd.goals = ++goles;
                        if (c.tipo === 'yellow') upd.cards = tarjeta = (tarjeta === 'amarilla' || tarjeta === 'roja') ? 'roja' : 'amarilla';
                        if (c.tipo === 'red')    upd.cards = tarjeta = 'roja';
                        if (c.tipo === 'injury') upd.injured = true;
                        if (c.apunte)            apuntes.push(c.apunte);
                    }
                    // 🔄 v799 · el que ENTRA en un cambio, en SUS copias.
                    if (c.apunteEntra && esDe(c.dorsalEntra)) apuntes.push(c.apunteEntra);

                    // 3 · EL COMENTARIO, sólo a staff y entrenador (v690).
                    if (c.comentario && r.type !== 'parent_player_report') notas.push(c.comentario);
                });
                if (apuntes.length) upd.history = fsm.arrayUnion(...apuntes);
                if (notas.length)   upd.matchComments = fsm.arrayUnion(...notas);

                if (Object.keys(upd).length) { lote.update(d.ref, upd); escrituras++; }
            });
            if (!escrituras) return true;
            await lote.commit();
            if (window._CRONOS_DEBUG) {
                console.log('[v715] Informes corregidos:', escrituras, 'documentos de', _targetMatchId);
            }
            return true;
        } catch (e) {
            console.warn('[v715] No se pudieron corregir los informes del partido:', e && (e.code || ''), e && e.message);
            return false;
        }
    }

    window._setRetroEventType = function(type) {
        // 🎬 v817 · PULSAR EL TIPO YA ACTIVO LO QUITA (encargo del autor,
        // implementar.txt 2026-10-14): sin tipo, el suceso es sólo el vídeo de
        // la jugada. Todo lo de abajo entiende null como «ninguno».
        if (type && type === _selectedEventType) type = null;
        // 🎤 v803 · el dictado es del comentario: fuera de él, se para.
        if (type !== 'comment') _paraDictado();
        _selectedEventType = type;
        const types = ['goal', 'sub', 'yellow', 'red', 'injury', 'comment'];
        types.forEach(t => {
            const btn = document.getElementById(`btn-retro-${t}`);
            if (btn) {
                if (btn.setAttribute) btn.setAttribute('aria-pressed', t === type ? 'true' : 'false');
                if (t === type) {
                    btn.style.background = 'rgba(88,166,255,0.25)';
                    btn.style.borderColor = '#58a6ff';
                    btn.style.color = 'white';
                } else {
                    btn.style.background = 'rgba(255,255,255,0.05)';
                    btn.style.borderColor = 'rgba(255,255,255,0.1)';
                    btn.style.color = '#7d8590';
                }
            }
        });

        const subContainer = document.getElementById('retro-sub-container');
        const playerLabel = document.getElementById('retro-player-label');
        if (subContainer) subContainer.style.display = type === 'sub' ? 'block' : 'none';
        // 💬 v690 · Un comentario no tiene jugador: se esconde el selector y
        // aparece el texto libre. Y al revés para cualquier otro tipo.
        const playerContainer  = document.getElementById('retro-player-container');
        const commentContainer = document.getElementById('retro-comment-container');
        if (playerContainer)  playerContainer.style.display  = type === 'comment' ? 'none' : 'block';
        if (commentContainer) commentContainer.style.display = type === 'comment' ? 'block' : 'none';
        if (type === 'comment') {
            const ta = document.getElementById('retro-comment-input');
            if (ta) { try { ta.focus(); } catch (_) {} }
        }
        // ⚠️ La etiqueta decía "Jugador que Sale (Banquillo)": al revés. El que
        // sale está EN EL CAMPO; al banquillo es a donde va.
        if (playerLabel) playerLabel.textContent = type === 'sub' ? 'Jugador que Sale (del campo):' : 'Jugador Implicado:';
        _repintaSelectores(type);
    };

    // ════════════════════════════════════════════════════════════════════
    //  📋 v799 · SUCESOS EN LOTE
    //
    //  Encargo del autor (implementar.txt 2026-10-11, captura 11304): en vez
    //  de guardar y cerrar con CADA suceso, poder ir «añadiendo a la lista»,
    //  revisar lo apuntado (y borrar lo equivocado) y guardar TODO de una vez,
    //  en orden cronológico, en el partido elegido.
    //
    //  🔑 TRES PIEZAS, una por responsabilidad:
    //    · `_leeFormulario`  → valida y convierte el formulario en un suceso
    //       (la validación va AL AÑADIR: un error al final del lote obligaría a
    //       rehacerlo entero);
    //    · `_aplicaSuceso`   → lo que hacía el guardado de UNO (fichas,
    //       historial, marcador, ruta central de sucesos), sin escribir aún
    //       los informes; devuelve su corrección para el informe;
    //    · `submitRetroactiveEvent` → ordena por parte y minuto, aplica, y
    //       escribe la ficha del partido UNA vez y los informes en UN lote.
    //
    //  ⚠️ CON LA LISTA VACÍA EL BOTÓN SIGUE GUARDANDO EL SUCESO DEL FORMULARIO,
    //  como siempre: registrar uno solo no debe costar un clic más.
    //
    //  ⚠️ EL LOTE ES DE UN PARTIDO. Cambiar de partido con sucesos pendientes
    //  pide confirmación y vacía la lista: si no, irían al partido equivocado.
    //
    //  ⚠️ SI EL INFORME FALLA NO SE REPITEN LOS SUCESOS. Para entonces ya
    //  están en la cola del directo (CronosOutbox reintenta sola) y en las
    //  fichas: volver a guardarlos los DUPLICARÍA. Lo que se guarda para
    //  reintentar es sólo la corrección del informe (`_informePendiente`).
    // ════════════════════════════════════════════════════════════════════
    let _lote = [];
    let _informePendiente = null;

    const _ICONO_TIPO = { goal: '⚽', sub: '🔄', yellow: '🟨', red: '🟥', injury: '🚑', comment: '💬' };
    const _NOMBRE_TIPO = { goal: 'Gol', sub: 'Cambio', yellow: 'Amarilla', red: 'Roja', injury: 'Lesión', comment: 'Comentario' };

    function _toast(m, ms) { if (typeof showToast === 'function') showToast(m, ms); }
    function _confirma(m) { return typeof confirm !== 'function' || confirm(m); }

    // ── El formulario, convertido en un suceso (o null si no vale) ─────────
    function _leeFormulario() {
        _paraDictado();   // 🎤 v803 · se lee lo que hay, y el micrófono se cierra
        const half = document.getElementById('retro-half-select')?.value || '1T';
        const minute = parseInt(document.getElementById('retro-minute-input')?.value || '30');
        const playerId = document.getElementById('retro-player-select')?.value;
        const subPlayerId = document.getElementById('retro-sub-player-select')?.value;
        const tipo = _selectedEventType;
        const item = { uid: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                       tipo, half: half === '2T' ? '2T' : '1T', minute, playerId, subPlayerId, nota: '' };

        // 🎬 v817 · SIN TIPO, el suceso es el vídeo: sin vídeo no hay nada que guardar.
        if (!tipo && !_clipElegido) {
            _toast('✋ Elige un tipo de suceso o un vídeo de la jugada.', 4000);
            return null;
        }
        if (tipo === 'comment') {
            const ta = document.getElementById('retro-comment-input');
            const nota = String((ta && ta.value) || '').replace(/\s+/g, ' ').trim().slice(0, 500);
            if (!nota) {
                _toast('✏️ Escribe el comentario antes de guardarlo.', 3500);
                if (ta) { try { ta.focus(); } catch (_) {} }
                return null;
            }
            if (!Number.isFinite(minute) || minute < 0 || minute > 130) {
                _toast('⏱️ Indica un minuto válido.', 3500);
                return null;
            }
            // 🛡️ v758 · VALIDACIÓN DE DATOS DE SALUD (reauditoría 23-09). El aviso
            // fijo bajo el campo se lee una vez y se deja de ver; esto salta en
            // el momento de apuntarlo y dice QUÉ palabra lo ha activado. Avisa, no
            // bloquea: ver `cronosPosiblesDatosSalud` en utils.js. Va ANTES de
            // cualquier escritura: cancelar no deja nada a medias.
            const _salud = (typeof window.cronosPosiblesDatosSalud === 'function')
                ? window.cronosPosiblesDatosSalud(nota) : [];
            if (_salud.length && !confirm(
                    '⚠️ Este comentario parece contener datos de salud: «' + _salud.slice(0, 5).join('», «') + '».\n\n' +
                    (_partidoDeAdultos() ? 'Es un informe deportivo. ' : 'Es un informe deportivo sobre MENORES. ') +
                    'La salud es un dato especialmente protegido ' +
                    '(art. 9 RGPD) y la política de privacidad no permite anotarla aquí: ' +
                    'ni lesiones concretas, ni diagnósticos, ni medicación.\n\n' +
                    'Pulsa CANCELAR para corregirlo, o ACEPTAR si de verdad no es un dato de salud.')) {
                if (ta) { try { ta.focus(); } catch (_) {} }
                return null;
            }
            item.nota = nota;
        } else if (!Number.isFinite(minute) || minute < 0 || minute > 130) {
            _toast('⏱️ Indica un minuto válido.', 3500);
            return null;
        }

        // Rótulo para la lista: se calcula AHORA, con los nombres a la vista.
        const lista = _jugadoresModal.length ? _jugadoresModal : _jugadoresDestino();
        const nom = (id) => {
            if (String(id) === 'rival') return 'Rival';
            const j = lista.find(x => String(x.id) === String(id));
            return j ? '#' + j.number + ' ' + j.name : '';
        };
        item.resumen = tipo === 'comment' ? '«' + item.nota.slice(0, 60) + (item.nota.length > 60 ? '…' : '') + '»'
                     : tipo === 'sub' ? 'Sale ' + (nom(playerId) || '—') + ' · Entra ' + (nom(subPlayerId) || '—')
                     : (nom(playerId) || (tipo ? 'Equipo' : ''));
        // 🎬 v804 · El vídeo elegido viaja CON su suceso (ya comprobado al elegirlo).
        if (_clipElegido) {
            item.clip = _clipElegido.file;
            item.clipDuracion = _clipElegido.duracion;
            item.clipNombre = String(_clipElegido.file.name || 'vídeo');
            item.clipMB = (_clipElegido.file.size || 0) / 1048576;
            const fam = document.getElementById('retro-clip-familias');
            item.clipFamilias = !!(fam && fam.checked && _partidoDeAdultos());
        }
        return item;
    }

    // ══════════════════════════════════════════════════════════════════
    //  🎬 v804 · EL VÍDEO DE LA JUGADA (js/match/events/match-clips.js)
    //  Se elige aquí, se comprueba al momento (peso y duración) y se SUBE al
    //  guardar, después de registrar los sucesos. La opción «también
    //  familias» sólo aparece en categorías de adultos (decisión del autor);
    //  el servidor lo vuelve a exigir.
    // ══════════════════════════════════════════════════════════════════
    let _clipElegido = null;   // { file, duracion }
    function _equipoDelPartido() {
        const d = _targetMatchData || {};
        const enCurso = !_targetMatchData;
        const cat = d.category || d.matchCategory || (enCurso ? (window._currentMatchCategory || '') : '') || '';
        const sub = d.subcategory || d.matchSubcategory || '';
        let teamId = d.teamId || '';
        if (!teamId && enCurso) {
            try { const S = window._cronosMatchSlots; teamId = (S && S.equipoActual && S.equipoActual()) || ''; } catch (e) {}
        }
        return { category: cat, subcategory: sub, teamId };
    }
    function _partidoDeAdultos() {
        return !!(window.CronosClips && window.CronosClips.esAdultos(_equipoDelPartido().category));
    }
    function _pintaOpcionClip() {
        const box = document.getElementById('retro-clip-familias-box');
        if (box) box.style.display = _partidoDeAdultos() ? 'flex' : 'none';
        const fam = document.getElementById('retro-clip-familias');
        if (fam && !_partidoDeAdultos()) fam.checked = false;
    }
    // 🧒 v832 · El aviso del comentario según la categoría del partido ELEGIDO
    // (no la del perfil): base = el de menores; adultos = genérico, sin
    // menores, y en gris en vez de rojo. La salud sigue fuera en los dos:
    // también en adultos es un dato especialmente protegido (art. 9 RGPD).
    function _pintaAvisoSalud() {
        const av = document.getElementById('retro-aviso-salud');
        if (!av) return;
        const adultos = _partidoDeAdultos();
        av.style.background = adultos ? 'rgba(139,148,158,0.08)' : 'rgba(248,81,73,0.08)';
        av.style.borderColor = adultos ? 'rgba(139,148,158,0.3)' : 'rgba(248,81,73,0.28)';
        av.style.color = adultos ? '#b1bac4' : '#ff9b93';
        av.innerHTML = adultos
            ? 'ℹ️ Escribe sólo observaciones deportivas del partido: sin datos de salud (lesiones concretas, diagnósticos, medicación) ni información personal ajena al juego.'
            : '⚠️ <strong>No anotes datos de salud</strong> (lesiones concretas, diagnósticos, medicación) ni información personal ajena al partido. Es un informe deportivo sobre menores.';
    }
    function _limpiaClip() {
        _clipElegido = null;
        ['retro-clip-input', 'retro-clip-camara'].forEach((id) => {
            const inp = document.getElementById(id);
            if (inp) { try { inp.value = ''; } catch (e) {} }
        });
        const info = document.getElementById('retro-clip-info');
        if (info && window.CronosClips) info.textContent = 'Máx. ' + window.CronosClips.MAX_SEG + ' s y 50 MB. Se verá UNA vez por cuenta, con marca de agua, y se borra solo a las 24 h.';
    }
    window._retroClipElegido = async function (input) {
        _clipElegido = null;
        const file = input && input.files && input.files[0];
        const info = document.getElementById('retro-clip-info');
        if (!file || !window.CronosClips) return;
        // 🎬 v806 · Grabar y Galería son dos entradas: vale la última usada.
        ['retro-clip-input', 'retro-clip-camara'].forEach((id) => {
            const otra = document.getElementById(id);
            if (otra && otra !== input) { try { otra.value = ''; } catch (e) {} }
        });
        if (info) info.textContent = '⏳ Comprobando el vídeo…';
        const r = await window.CronosClips.compruebaFichero(file);
        if (!r.ok) {
            try { input.value = ''; } catch (e) {}
            if (info) info.textContent = '⚠️ ' + r.motivo;
            _toast('🎬 ' + r.motivo, 5000);
            return;
        }
        _clipElegido = { file, duracion: r.duracion };
        if (info) info.textContent = '✅ ' + file.name + ' · ' + (file.size / 1048576).toFixed(1) + ' MB' +
            (r.duracion ? ' · ' + Math.round(r.duracion) + ' s' : '') + '. Se subirá al guardar.';
    };

    // Sube los vídeos de los sucesos guardados. Devuelve cuántos y cuántos fallaron.
    async function _subeClips(items) {
        const conClip = items.filter(it => it.clip);
        if (!conClip.length || !window.CronosClips) return { ok: 0, mal: 0 };
        const eq = _equipoDelPartido();
        let ok = 0, mal = 0;
        for (let i = 0; i < conClip.length; i++) {
            const it = conClip[i];
            _toast('🎬 Subiendo vídeo ' + (i + 1) + ' de ' + conClip.length + '…', 2500);
            const r = await window.CronosClips.subir({
                file: it.clip, duracion: it.clipDuracion, matchId: _targetMatchId,
                teamId: eq.teamId, category: eq.category, subcategory: eq.subcategory,
                tipo: it.tipo, half: it.half, minute: it.minute,
                rotulo: [_NOMBRE_TIPO[it.tipo] || 'Jugada', it.resumen, it.half + ' ' + it.minute + "'"].filter(Boolean).join(' · '),
                paraFamilias: it.clipFamilias,
            });
            if (r.ok) ok++; else mal++;
        }
        return { ok, mal };
    }

    // Orden cronológico: parte, minuto y, a igualdad, el orden en que se apuntó.
    function _ordenCrono(items) {
        return items.map((it, i) => ({ it, i }))
            .sort((a, b) => ((a.it.half === '2T' ? 1 : 0) - (b.it.half === '2T' ? 1 : 0)) ||
                            (a.it.minute - b.it.minute) || (a.i - b.i))
            .map(x => x.it);
    }

    // ── La lista en pantalla ──────────────────────────────────────────────
    function _pintaLote() {
        const caja = document.getElementById('retro-lote');
        const btn = document.getElementById('retro-save-btn');
        const n = _lote.length;
        if (btn) btn.innerHTML = n ? '💾 Guardar todos los sucesos (' + n + ')' : '💾 Guardar Evento Retroactivo';
        if (!caja) return;
        let html = '';
        if (n) {
            html += '<div style="font-size:0.85rem; font-weight:800; color:#58a6ff; margin-bottom:0.55rem;">📋 Pendientes de guardar (' + n + ') <span style="font-weight:600; color:#7d8590; font-size:0.72rem;">· se guardarán en orden de minuto</span></div>';
            html += _ordenCrono(_lote).map(it => {
                // 🎬 v817 · EL VÍDEO SE VE EN LA FILA: una etiqueta propia con el
                // nombre del archivo, no un icono suelto al final del texto.
                const etiquetaVideo = it.clip
                    ? '<div style="margin-top:0.35rem;"><span title="Este suceso lleva un vídeo adjunto" style="display:inline-flex; align-items:center; gap:0.3rem; max-width:100%; background:rgba(163,113,247,0.18); border:1px solid rgba(163,113,247,0.6); color:#d2a8ff; border-radius:999px; padding:0.15rem 0.6rem; font-size:0.72rem; font-weight:800;">🎬 VÍDEO <span style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">' +
                      escapeHtml(it.clipNombre || '') + (it.clipMB ? ' · ' + it.clipMB.toFixed(1) + ' MB' : '') +
                      (it.clipDuracion ? ' · ' + Math.round(it.clipDuracion) + ' s' : '') + '</span></span></div>'
                    : '';
                const nombre = it.tipo ? (_NOMBRE_TIPO[it.tipo] || it.tipo) : 'Sólo vídeo';
                return '<div style="display:flex; align-items:flex-start; gap:0.65rem; padding:0.6rem 0.7rem; margin-bottom:0.45rem; background:rgba(255,255,255,0.04); border:1px solid ' + (it.clip ? 'rgba(163,113,247,0.45)' : 'rgba(255,255,255,0.08)') + '; border-radius:8px; font-size:0.88rem;">' +
                    '<span style="min-width:58px; font-weight:800; color:#f0883e; font-variant-numeric:tabular-nums; padding-top:0.1rem;">' + it.half + ' ' + String(it.minute).padStart(2, '0') + '\'</span>' +
                    '<span style="flex-shrink:0; font-size:1.05rem;">' + (it.tipo ? (_ICONO_TIPO[it.tipo] || '•') : '🎬') + '</span>' +
                    '<div style="flex:1; min-width:0; color:#e6edf3; word-break:break-word; line-height:1.35;"><strong>' + escapeHtml(nombre) + '</strong>' + (it.resumen ? ' · ' + escapeHtml(it.resumen) : '') + etiquetaVideo + '</div>' +
                    '<button type="button" onclick="window._retroQuitarDeLista(\'' + it.uid + '\')" title="Quitar de la lista" aria-label="Quitar de la lista" style="flex-shrink:0; background:rgba(255,88,88,0.12); border:1px solid rgba(255,88,88,0.4); color:#ff5858; border-radius:6px; min-width:2rem; min-height:2rem; cursor:pointer; font-weight:800;">✕</button>' +
                '</div>';
            }).join('');
        }
        if (_informePendiente) {
            html += '<div style="margin-top:0.5rem; font-size:0.76rem; color:#ff9b93; background:rgba(248,81,73,0.08); border:1px solid rgba(248,81,73,0.35); border-radius:8px; padding:0.5rem;">' +
                    '⚠️ Los sucesos ya están registrados, pero el informe del partido no se pudo actualizar.' +
                    '<div style="margin-top:0.4rem;"><button type="button" onclick="window._retroReintentarInforme()" style="background:rgba(248,81,73,0.15); border:1px solid rgba(248,81,73,0.5); color:#ff9b93; padding:0.35rem 0.75rem; border-radius:7px; font-weight:800; cursor:pointer;">🔁 Reintentar el informe</button></div></div>';
        }
        caja.innerHTML = html;
        caja.style.display = html ? 'block' : 'none';
    }

    window._retroAnadirALista = function () {
        if (!_targetMatchId) { _toast('⚽ Elige primero el partido al que pertenece el suceso.', 4000); return; }
        if (!_listo) { _toast('🔒 Este partido no admite sucesos ahora mismo.', 4000); return; }
        const item = _leeFormulario();
        if (!item) return;
        _lote.push(item);
        _limpiaClip();   // 🎬 v804 · el vídeo ya va con su suceso
        // Lo que se repite de un suceso a otro (parte y minuto) se queda; el
        // texto del comentario no, o se duplicaría la nota sin querer.
        const ta = document.getElementById('retro-comment-input');
        if (ta && item.tipo === 'comment') { ta.value = ''; const c = document.getElementById('retro-comment-count'); if (c) c.textContent = '0 / 500'; }
        _pintaLote();
        _toast('➕ Añadido a la lista (' + _lote.length + '). Sigue apuntando o pulsa «Guardar todos».', 2500);
    };

    window._retroQuitarDeLista = function (uid) {
        _lote = _lote.filter(it => it.uid !== uid);
        _pintaLote();
    };

    window.closeRetroactiveEventModal = function(forzar) {
        _paraDictado();   // 🎤 v803 · cerrar nunca deja el micrófono abierto
        if (forzar !== true && _lote.length &&
            !_confirma('Tienes ' + _lote.length + ' suceso(s) en la lista SIN GUARDAR.\n\n¿Cerrar y descartarlos?')) return;
        _lote = [];
        _informePendiente = null;
        const modal = document.getElementById('cronos-retroactive-modal');
        if (modal) modal.style.display = 'none';
    };

    // ── Aplicar UN suceso (sin escribir aún los informes) ─────────────────
    //  Devuelve { cambio, resumen } — `cambio` es la corrección del informe,
    //  o null si no hay informe que corregir (un comentario del partido en
    //  curso: ése lo recoge el informe al terminar).
    function _aplicaSuceso(item) {
        const half = item.half, minute = item.minute;
        const playerId = item.playerId, subPlayerId = item.subPlayerId;

        // v531 · Del partido DESTINO, no de lo que haya en memoria (ver
        // _jugadoresDestino). `id` es número y el value del <option> es cadena:
        // se comparan siempre con String(), como en el resto del proyecto.
        const currentPlayers = _jugadoresDestino();
        const esRival = String(playerId) === 'rival';
        const p = esRival ? null : currentPlayers.find(x => String(x.id) === String(playerId));
        const pSub = currentPlayers.find(x => String(x.id) === String(subPlayerId));

        const minStr = String(minute).padStart(2, '0');
        const matchTime = `${half} ${minStr}:00`;
        const _enCurso = (typeof liveMatchId !== 'undefined') ? liveMatchId : null;
        const _esElEnCurso = !_targetMatchId || _targetMatchId === _enCurso;

        // ════════════════════════════════════════════════════════════════
        //  💬 v690 · COMENTARIO DEL PARTIDO
        //
        //  🔑 NO ES UN SUCESO DE JUGADOR: no suma goles ni tarjetas, no toca
        //  `history` de nadie (de ahí sale el Gantt), ni el marcador, ni la
        //  ficha del partido. Sólo entra en `events` por la ruta central, con
        //  el texto en un campo ESTRUCTURADO (`comment`). El informe lo recoge
        //  de ahí al terminar el partido (`cronosComentariosDelPartido`).
        // ════════════════════════════════════════════════════════════════
        if (item.tipo === 'comment') {
            const nota = item.nota;
            // 🔓 v797 · Un partido que sólo vive en los informes no tiene
            // documento de directo en el que escribir: la nota va al informe.
            if (!_soloInformes && typeof _registerMatchEvent === 'function') {
                _registerMatchEvent('comment', 'COMENTARIO · ' + nota, '💬', matchTime,
                                    Object.assign({ comment: nota, half: half, minute: minute, staffOnly: true },
                                                  _marcasPosteriores()),
                                    { matchId: _targetMatchId, matchData: _targetMatchData });
            }
            // 💬🟠 v715 · EL INFORME YA GENERADO TAMBIÉN SE CORRIGE: la nota se
            // añade a `matchComments` de las copias de staff y entrenador (a
            // las de las familias NO: v690), marcada como retroactiva.
            return {
                cambio: _esElEnCurso ? null : {
                    tipo: 'comment',
                    comentario: {
                        id: 'retro_' + Date.now() + '_' + item.uid,
                        minute: minute, half: half, text: nota,
                        realTime: (typeof window._horaRealAhora === 'function') ? window._horaRealAhora() : '',
                        createdAt: Date.now(),
                        retro: true,
                    },
                },
            };
        }

        // 🎬 v817 · SIN TIPO = sólo el vídeo: no hay suceso que registrar, ni
        // ficha, ni marcador, ni informe. El vídeo lo sube _subeClips después.
        if (!item.tipo) return { cambio: null };

        const eventType = item.tipo;
        let text = '';
        let icon = '•';

        if (eventType === 'goal') {
            const nombreRival = (_targetMatchData && _targetMatchData.awayTeam && _targetMatchData.awayTeam.name)
                ? _targetMatchData.awayTeam.name : 'Rival';
            text = p ? `GOL · ${p.name} (Retroactivo)`
                     : (esRival ? `GOL · ${nombreRival} (Retroactivo)` : 'GOL · Equipo (Retroactivo)');
            icon = '⚽';
        } else if (eventType === 'yellow') {
            text = p ? `TARJETA AMARILLA · ${p.name} (Retroactivo)` : 'TARJETA AMARILLA (Retroactivo)';
            icon = '🟨';
        } else if (eventType === 'red') {
            text = p ? `TARJETA ROJA · ${p.name} (Retroactivo)` : 'TARJETA ROJA (Retroactivo)';
            icon = '🟥';
        } else if (eventType === 'injury') {
            text = p ? `LESIÓN · ${p.name} (Retroactivo)` : 'LESIÓN (Retroactivo)';
            icon = '🚑';
        } else if (eventType === 'sub') {
            const nameOut = p ? p.name : 'Jugador';
            const nameIn = pSub ? pSub.name : 'Jugador Entrante';
            text = `CAMBIO · Sale ${nameOut}, Entra ${nameIn} (Retroactivo)`;
            icon = '🔄';
        }

        // Actualizar estadísticas del jugador si existe
        if (p) {
            if (eventType === 'goal') p.goals = (p.goals || 0) + 1;
            if (eventType === 'yellow') {
                p.yellowCards = (p.yellowCards || 0) + 1;
                p.cards = p.yellowCards >= 2 ? 'roja' : 'amarilla';
            }
            if (eventType === 'red') p.cards = 'roja';
            if (eventType === 'injury') p.injured = true;
        }

        // ════════════════════════════════════════════════════════════════
        //  v531 · EL EVENTO ENTRA EN EL HISTORIAL DEL JUGADOR
        //
        //  🔑🔑 Sin esto no llegaba al informe individual: el cronograma se
        //  dibuja desde `history` (report-engine.js). Formato de `logMovement`
        //  para que `_parseHistoryForFirestore` lo entienda igual que cualquier
        //  otro; la marca `(RETRO)` sigue el patrón de `(DESCANSO)` y `#subId`.
        // ════════════════════════════════════════════════════════════════
        const _faseHist = half === '2T' ? '2ªP' : '1ªP';
        const _horaReal = (typeof window._horaRealAhora === 'function') ? window._horaRealAhora() : '';
        const _apunta = (jugador, etiqueta, sufijo) => {
            if (!jugador) return;
            if (!Array.isArray(jugador.history)) jugador.history = [];
            jugador.history.push(
                `${etiqueta} a las ${minStr}:00 (${_faseHist}) (RETRO)${sufijo || ''}` +
                (_horaReal ? ' @' + _horaReal : '')
            );
        };
        // Pareja emparejable por el informe: comparten sello #<digitos>. En un
        // lote dos cambios pueden caer en el mismo milisegundo: se desempata.
        const _sello = String(Date.now()) + String(_lote.indexOf(item) >= 0 ? _lote.indexOf(item) : 0);
        if (eventType === 'goal' && p)     _apunta(p, 'GOL');
        if (eventType === 'yellow')        _apunta(p, 'TARJETA AMARILLA');
        if (eventType === 'red')           _apunta(p, 'TARJETA ROJA');
        if (eventType === 'injury')        _apunta(p, 'LESIÓN');
        if (eventType === 'sub') {
            _apunta(p, 'Sale', ' #' + _sello);
            _apunta(pSub, 'Entra', ' #' + _sello);
            if (p)    p.status = 'bench';
            if (pSub) pSub.status = 'field';
        }

        // ── El marcador del partido destino ─────────────────────────────
        // Él lo pidió explícitamente: que el acumulado cuadre con lo que dicen
        // las incidencias. `homeTeam.score`/`awayTeam.score` (leído por REST).
        if (eventType === 'goal' && _targetMatchData) {
            const miRol = _targetMatchData.myTeamRole || 'home';
            const rol = esRival ? (miRol === 'away' ? 'home' : 'away')
                                : (p ? (p.team || miRol) : miRol);
            const equipo = rol === 'away' ? _targetMatchData.awayTeam : _targetMatchData.homeTeam;
            if (equipo) equipo.score = (equipo.score || 0) + 1;
        }

        // Registrar el evento reutilizando la ruta central _registerMatchEvent
        // (cola del partido + live_matches con arrayUnion), con el minuto
        // manual como 4º parámetro y el PARTIDO DESTINO como 6º (v434).
        // v439 · `extra` lleva el equipo en campos estructurados.
        const extraEq = (p && !_soloInformes && typeof _datosEquipoDe === 'function') ? _datosEquipoDe(p) : null;
        // 🔓 v797 · Las marcas de «añadido después» viajan en el suceso, como
        // campos (el texto no es el contrato). `isRetroactive` ya lo pone
        // `_registerMatchEvent` por llevar minuto manual.
        const extraEv = Object.assign({}, extraEq || {}, _marcasPosteriores());
        if (!_soloInformes && typeof _registerMatchEvent === 'function') {
            _registerMatchEvent(eventType, text, icon, matchTime, extraEv,
                                { matchId: _targetMatchId, matchData: _targetMatchData });
            // El evento retroactivo se inserta fuera de orden: reordenar por tiempo.
            if (Array.isArray(window._cronosMatchEvents)) {
                window._cronosMatchEvents.sort((a, b) => (a.createdAt - b.createdAt));
            }
        }

        // Tras un gol retroactivo, recalcular el marcador desde los jugadores.
        if (eventType === 'goal' && p && typeof syncScoreFromPlayers === 'function') {
            syncScoreFromPlayers(p.team);
        }

        // Auditar la acción crítica igual que hace el resto de acciones.
        const _liveId = _targetMatchId || (typeof liveMatchId !== 'undefined' ? liveMatchId : null);
        if (p && window.auditLogger && _liveId) {
            window.auditLogger.logPlayerAction(p.id, p.name, p.number, 'retroactive_' + eventType, text,
                                               { retroactive: true, matchTime: matchTime });
        }

        // ⚽🟠 v715 · LA CORRECCIÓN DEL INFORME. El lado del gol se resuelve con
        // la MISMA cuenta que el marcador del documento (arriba): si divergieran,
        // el informe sumaría el gol al equipo contrario.
        const _ladoGol = (eventType === 'goal')
            ? (function () {
                const miRol = (_targetMatchData && _targetMatchData.myTeamRole) || 'home';
                return esRival ? (miRol === 'away' ? 'home' : 'away')
                               : (p ? (p.team || miRol) : miRol);
              })()
            : null;
        const _apunte = (tipo, nota) => ({
            type: tipo, minute: minute, second: 0, timeStr: minStr + ':00',
            subId: eventType === 'sub' ? _sello : null,
            note: nota + ' a las ' + minStr + ':00 (' + _faseHist + ') (RETRO)',
            phase: false, realTime: _horaReal || '', retro: true,
        });
        const cambio = {
            tipo:    eventType,
            ladoGol: _ladoGol,
            dorsal:  p ? p.number : null,
            apunte:  p ? _apunte(eventType === 'sub' ? 'sub_out' : eventType,
                                 eventType === 'goal' ? 'GOL' : eventType === 'yellow' ? 'TARJETA AMARILLA'
                                 : eventType === 'red' ? 'TARJETA ROJA' : eventType === 'injury' ? 'LESIÓN' : 'Sale')
                     : null,
        };
        // 🔄 v799 · Y en un cambio, también el que ENTRA (antes sólo llegaba al
        // informe la mitad que sale, y el Gantt del que entra no lo veía).
        if (eventType === 'sub' && pSub) {
            cambio.dorsalEntra = pSub.number;
            cambio.apunteEntra = _apunte('sub_in', 'Entra');
        }
        return { cambio };
    }

    // ── Guardar: el lote entero, o el suceso del formulario si no hay lote ──
    window.submitRetroactiveEvent = async function() {
        // 🔓 v797 · Sin partido elegido no se guarda nada: es justo lo que el
        // desplegable obligatorio viene a impedir.
        if (!_targetMatchId) {
            _toast('⚽ Elige primero el partido al que pertenece el suceso.', 4000);
            return;
        }
        // v434 · SE REVALIDA AL GUARDAR, no basta con la puerta de apertura: el
        // modal puede quedarse abierto y la ventana de 2 h (o el permiso de
        // desbloqueo) vencer mientras se rellena.
        // 📋 v799 · Con sucesos en la lista NO se cierra: se conservan para
        // pedir el permiso y guardarlos después, en vez de perderlos.
        if (_targetMatchData && window.CronosMatchLock
            && !window.CronosMatchLock.canAddEvent(_targetMatchData)) {
            const motivo = window.CronosMatchLock.lockReason(_targetMatchData);
            if (typeof showToast === 'function') showToast('🔒 ' + motivo, 5000);
            else alert(motivo);
            if (!_lote.length) window.closeRetroactiveEventModal(true);
            return;
        }

        let items;
        if (_lote.length) {
            items = _lote.slice();
        } else {
            const it = _leeFormulario();
            if (!it) return;
            items = [it];
        }
        items = _ordenCrono(items);

        const cambios = [];
        items.forEach(it => {
            const r = _aplicaSuceso(it);
            if (r && r.cambio) cambios.push(r.cambio);
        });
        if (typeof renderPlayers === 'function') renderPlayers();
        if (typeof updateMasterUI === 'function') updateMasterUI();

        const _haySucesosDeJuego = items.some(it => it.tipo && it.tipo !== 'comment');
        // v531 · Ficha y marcador del partido destino, UNA vez para todo el
        // lote. 🔓 v797 · Sin documento de directo (más de 10 h) no hay ficha.
        const _corregido = (_soloInformes || !_haySucesosDeJuego) ? true : await _persisteCorreccionDestino();
        // ⚽🟠 v715 · Y EL INFORME: todas las correcciones en UN lote.
        const _informes = cambios.length ? await _corrigeInformesDelPartido(cambios) : true;

        _lote = [];
        _informePendiente = _informes ? null : cambios;
        // 🎬 v804 · los vídeos, DESPUÉS de los sucesos (si un vídeo falla, el suceso ya está).
        const _vid = await _subeClips(items);
        _limpiaClip();

        // Los avisos de siempre cuando es UN suceso; un resumen cuando son varios.
        const _enCurso = (typeof liveMatchId !== 'undefined') ? liveMatchId : null;
        const _esElEnCurso = !_targetMatchId || _targetMatchId === _enCurso;
        let aviso, ms;
        if (items.length === 1 && !items[0].tipo) {
            // 🎬 v817 · sólo el vídeo: el resultado lo añade la línea de _vid de abajo.
            aviso = '🎬 Jugada guardada sin suceso';
            ms = 4000;
        } else if (items.length === 1 && items[0].tipo === 'comment') {
            aviso = _esElEnCurso
                ? '💬 Comentario añadido al historial. Saldrá en el informe del partido.'
                : (_informes
                    ? '💬 Comentario añadido al historial y al informe de ese partido (marcado como retroactivo).'
                    : '💬 Comentario añadido al historial. No se ha podido añadir al informe ya generado.');
            ms = _esElEnCurso ? 3500 : 6500;
        } else if (items.length === 1) {
            aviso = !_corregido
                ? '⚠️ Suceso registrado, pero no se han podido corregir las estadísticas del partido terminado.'
                : (!_informes
                    ? '⚠️ Suceso y marcador corregidos, pero el informe del partido no se ha podido actualizar.'
                    : (items[0].tipo === 'goal'
                        ? '✅ Gol retroactivo registrado: marcador e informe actualizados'
                        : '✅ Evento perdido registrado con éxito'));
            ms = (_corregido && _informes) ? 3500 : 7000;
        } else {
            aviso = (!_corregido && !_informes)
                ? '⚠️ ' + items.length + ' sucesos registrados, pero no se han podido corregir ni las estadísticas del partido ni su informe.'
                : !_corregido
                ? '⚠️ ' + items.length + ' sucesos registrados, pero no se han podido corregir las estadísticas del partido terminado.'
                : (!_informes
                    ? '⚠️ ' + items.length + ' sucesos registrados, pero el informe del partido no se ha podido actualizar.'
                    : '✅ ' + items.length + ' sucesos guardados en orden: historial, marcador e informe actualizados');
            ms = (_corregido && _informes) ? 4500 : 7000;
        }
        if (_vid.ok)  aviso += ' · 🎬 ' + _vid.ok + (_vid.ok === 1 ? ' vídeo subido' : ' vídeos subidos');
        if (_vid.mal) { aviso += ' · ⚠️ ' + _vid.mal + (_vid.mal === 1 ? ' vídeo no se pudo subir' : ' vídeos no se pudieron subir'); ms = 7000; }
        _toast(aviso, ms);

        // Si el informe falló, el modal se queda con el botón de reintentar.
        if (_informePendiente) { _pintaLote(); return; }
        window.closeRetroactiveEventModal(true);
    };

    // Reintenta SÓLO la corrección del informe (los sucesos ya están dentro).
    window._retroReintentarInforme = async function () {
        if (!_informePendiente) return;
        const okInf = await _corrigeInformesDelPartido(_informePendiente);
        if (okInf) {
            _informePendiente = null;
            _toast('✅ Informe del partido actualizado.', 3500);
            window.closeRetroactiveEventModal(true);
        } else {
            _toast('⚠️ El informe sigue sin poder actualizarse. Revisa la conexión.', 5000);
            _pintaLote();
        }
    };

})();

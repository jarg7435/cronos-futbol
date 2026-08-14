// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — retroactive-modal.js
//  Registro de Eventos Retroactivos (Pérdida de Batería / Cobertura)
// ════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    let _selectedEventType = 'goal';
    let _targetMatchId = null;
    // v434 · Datos del partido destino, para saber si admite incidencias. Lo
    // aportan los listados de Partidos Terminados al abrir el modal desde una
    // tarjeta. Sin él (partido en curso) el estado es 'live' por definición.
    let _targetMatchData = null;
    // v531 · Los jugadores que se están ofreciendo en el modal abierto.
    let _jugadoresModal = [];

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

    window.openRetroactiveEventModal = async function(matchId, matchData) {
        _targetMatchId = matchId || (typeof liveMatchId !== 'undefined' ? liveMatchId : null);
        _targetMatchData = matchData || null;

        // Si el destino NO es el partido que se está jugando, se lee su estado.
        // Así la puerta funciona para cualquier punto de llamada sin que tenga
        // que cooperar pasando los datos — incluidos los que se añadan después.
        const _enCurso = (typeof liveMatchId !== 'undefined') ? liveMatchId : null;
        if (!_targetMatchData && _targetMatchId && _targetMatchId !== _enCurso) {
            _targetMatchData = await _cargarPartido(_targetMatchId);
        }

        // v434 · PUERTA DE ENTRADA. Un partido congelado no abre el modal: es
        // preferible decirlo antes que dejar rellenar el formulario para
        // rechazarlo al guardar.
        if (_targetMatchData && window.CronosMatchLock
            && !window.CronosMatchLock.canAddEvent(_targetMatchData)) {
            const motivo = window.CronosMatchLock.lockReason(_targetMatchData);
            if (typeof showToast === 'function') showToast('🔒 ' + motivo, 5000);
            else alert(motivo);
            return;
        }

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

        _jugadoresModal = _jugadoresDestino();
        const playerOptions    = _opcionesJugadores(_jugadoresModal, 'todos');
        const playerOptionsIn  = _opcionesJugadores(_jugadoresModal, 'banquillo');

        modal.innerHTML = `
            <div class="modal-content" style="width:min(92vw, 480px); background:#0d1117; border:1px solid rgba(88,166,255,0.3); border-radius:14px; padding:1.2rem; display:flex; flex-direction:column; gap:1rem; box-shadow:0 10px 30px rgba(0,0,0,0.8);">
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
                        <input type="number" id="retro-minute-input" min="1" max="120" value="30" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700; font-family:monospace;">
                    </div>
                </div>

                <!-- Selección del Tipo de Evento -->
                <div>
                    <label style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.4rem;">Tipo de Suceso:</label>
                    <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:0.4rem;">
                        <button type="button" onclick="window._setRetroEventType('goal')" id="btn-retro-goal" class="btn-retro-type" style="background:rgba(88,166,255,0.25); border:1px solid #58a6ff; color:white; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">⚽ Gol</button>
                        <button type="button" onclick="window._setRetroEventType('sub')" id="btn-retro-sub" class="btn-retro-type" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🔄 Cambio</button>
                        <button type="button" onclick="window._setRetroEventType('yellow')" id="btn-retro-yellow" class="btn-retro-type" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🟨 Amarilla</button>
                        <button type="button" onclick="window._setRetroEventType('red')" id="btn-retro-red" class="btn-retro-type" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🟥 Roja</button>
                        <button type="button" onclick="window._setRetroEventType('injury')" id="btn-retro-injury" class="btn-retro-type" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🚑 Lesión</button>
                    </div>
                </div>

                <!-- Selección de Jugador -->
                <div>
                    <label id="retro-player-label" style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.3rem;">Jugador Implicado:</label>
                    <select id="retro-player-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700;">
                        ${playerOptions}
                    </select>
                </div>

                <!-- Jugador Entrante (para cambios) -->
                <div id="retro-sub-container" style="display:none;">
                    <label style="font-size:0.75rem; font-weight:700; color:#2ecc71; display:block; margin-bottom:0.3rem;">Jugador que Entra al Campo:</label>
                    <select id="retro-sub-player-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700;">
                        ${playerOptionsIn}
                    </select>
                </div>

                <!-- Botón Guardar -->
                <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:0.4rem;">
                    <button type="button" onclick="window.closeRetroactiveEventModal()" style="background:rgba(255,255,255,0.08); border:none; color:white; padding:0.6rem 1.2rem; border-radius:8px; font-weight:700; cursor:pointer;">Cancelar</button>
                    <button type="button" onclick="window.submitRetroactiveEvent()" style="background:linear-gradient(135deg,#58a6ff,#1f6beb); border:none; color:white; padding:0.6rem 1.4rem; border-radius:8px; font-weight:800; cursor:pointer; box-shadow:0 4px 12px rgba(88,166,255,0.3);">
                        💾 Guardar Evento Retroactivo
                    </button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';
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

    window._setRetroEventType = function(type) {
        _selectedEventType = type;
        const types = ['goal', 'sub', 'yellow', 'red', 'injury'];
        types.forEach(t => {
            const btn = document.getElementById(`btn-retro-${t}`);
            if (btn) {
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
        // ⚠️ La etiqueta decía "Jugador que Sale (Banquillo)": al revés. El que
        // sale está EN EL CAMPO; al banquillo es a donde va.
        if (playerLabel) playerLabel.textContent = type === 'sub' ? 'Jugador que Sale (del campo):' : 'Jugador Implicado:';
        _repintaSelectores(type);
    };

    window.closeRetroactiveEventModal = function() {
        const modal = document.getElementById('cronos-retroactive-modal');
        if (modal) modal.style.display = 'none';
    };

    // ── Procesar el envío del evento retroactivo ──────────────────────
    window.submitRetroactiveEvent = async function() {
        // v434 · SE REVALIDA AL GUARDAR, no basta con la puerta de apertura: el
        // modal puede quedarse abierto y la ventana de 2 h vencer mientras se
        // rellena. Sin esto, dejar el modal abierto sería la forma de saltarse
        // la congelación.
        if (_targetMatchData && window.CronosMatchLock
            && !window.CronosMatchLock.canAddEvent(_targetMatchData)) {
            const motivo = window.CronosMatchLock.lockReason(_targetMatchData);
            if (typeof showToast === 'function') showToast('🔒 ' + motivo, 5000);
            else alert(motivo);
            window.closeRetroactiveEventModal();
            return;
        }

        const half = document.getElementById('retro-half-select')?.value || '1T';
        const minute = parseInt(document.getElementById('retro-minute-input')?.value || '30');
        const playerId = document.getElementById('retro-player-select')?.value;
        const subPlayerId = document.getElementById('retro-sub-player-select')?.value;

        // v531 · Del partido DESTINO, no de lo que haya en memoria (ver
        // _jugadoresDestino). `id` es número y el value del <option> es cadena:
        // se comparan siempre con String(), como en el resto del proyecto.
        const currentPlayers = _jugadoresDestino();
        const esRival = String(playerId) === 'rival';
        const p = esRival ? null : currentPlayers.find(x => String(x.id) === String(playerId));
        const pSub = currentPlayers.find(x => String(x.id) === String(subPlayerId));

        const minStr = String(minute).padStart(2, '0');
        const matchTime = `${half} ${minStr}:00`;
        const nowStr = new Date().toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });

        let eventType = _selectedEventType;
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
        //  dibuja desde `history` (report-engine.js), y este modal no lo tocaba
        //  en absoluto. El evento sólo existía en la lista de incidencias.
        //
        //  El formato es el de `logMovement` para que `_parseHistoryForFirestore`
        //  lo entienda igual que cualquier otro: la PRIMERA hora de la cadena es
        //  el minuto de partido (la del reloj de pared va detrás, con @).
        //  La marca `(RETRO)` sigue el mismo patrón que `(DESCANSO)` y `#subId`,
        //  y el parser la convierte en un campo estructurado.
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
        if (eventType === 'goal' && p)     _apunta(p, 'GOL');
        if (eventType === 'yellow')        _apunta(p, 'TARJETA AMARILLA');
        if (eventType === 'red')           _apunta(p, 'TARJETA ROJA');
        if (eventType === 'injury')        _apunta(p, 'LESIÓN');
        if (eventType === 'sub') {
            // Pareja emparejable por el informe: comparten sello #<digitos>.
            const sello = ' #' + Date.now();
            _apunta(p, 'Sale', sello);
            _apunta(pSub, 'Entra', sello);
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

        // Registrar el evento reutilizando la ruta central _registerMatchEvent,
        // que además persiste en Firestore (live_matches) con arrayUnion. Le
        // pasamos el matchTime manual como 4º parámetro (override retroactivo).
        //
        // v434 · Y EL PARTIDO DESTINO como 6º. Antes no se pasaba: _targetMatchId
        // solo se usaba para el registro de auditoría, mientras la escritura de
        // Firestore iba a la global `liveMatchId`. Abrir este modal desde la
        // tarjeta de un partido terminado escribía el evento en el partido que
        // el entrenador estuviera jugando, o en ninguno.
        // v439 · `extra` deja de ser `null`: el evento lleva el equipo en campos
        // estructurados (team/teamName) para que el mini-feed de las tarjetas de
        // Partidos en Vivo pueda decir de quien es el suceso sin parsear texto.
        // Sin jugador seleccionado no hay equipo que deducir y se manda null,
        // exactamente como antes.
        const extraEq = (p && typeof _datosEquipoDe === 'function') ? _datosEquipoDe(p) : null;
        if (typeof _registerMatchEvent === 'function') {
            _registerMatchEvent(eventType, text, icon, matchTime, extraEq,
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

        if (typeof renderPlayers === 'function') renderPlayers();
        if (typeof updateMasterUI === 'function') updateMasterUI();

        // Auditar la acción crítica igual que hace el resto de acciones.
        const _liveId = _targetMatchId || (typeof liveMatchId !== 'undefined' ? liveMatchId : null);
        if (p && window.auditLogger && _liveId) {
            window.auditLogger.logPlayerAction(
                p.id,
                p.name,
                p.number,
                'retroactive_' + eventType,
                text,
                { retroactive: true, matchTime: matchTime }
            );
        }

        // v531 · Y se corrigen ficha y marcador del partido destino. Si el
        // servidor lo rechaza (partido terminado: ver _persisteCorreccionDestino)
        // se dice claramente, en vez de dar por bueno algo que no se ha guardado.
        const _corregido = await _persisteCorreccionDestino();
        if (typeof showToast === 'function') {
            showToast(_corregido
                ? '✅ Evento perdido registrado con éxito'
                : '⚠️ Suceso registrado, pero no se han podido corregir las estadísticas del partido terminado.',
                _corregido ? 3500 : 7000);
        }

        window.closeRetroactiveEventModal();
    };

})();

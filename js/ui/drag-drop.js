// --- DRAG & DROP ---

// ── Guard anti-duplicación táctil ─────────────────────────────────────────
// En móvil, un longpress dispara TANTO el evento táctil personalizado COMO
// el evento HTML5 drag nativo del navegador, procesando al jugador dos veces.
// Este flag bloquea la segunda llamada dentro de una ventana de 400ms.
let _dropGuardTs  = 0;       // timestamp del último drop procesado
let _dropGuardId  = null;    // playerId del último drop procesado
const _DROP_GUARD_MS = 400;  // ventana de bloqueo en milisegundos

function _dropAllowed(playerId) {
    const now = Date.now();
    if (now - _dropGuardTs < _DROP_GUARD_MS && _dropGuardId == playerId) {
        return false; // segunda llamada dentro de la ventana → ignorar
    }
    _dropGuardTs = now;
    _dropGuardId = playerId;
    return true;
}

function allowDrop(e) { e.preventDefault(); }

function resolveOverlaps(ox, oy, excludeId) {
    const PUSH_DIST = 10;
    players.forEach(p => {
        if (p.status !== 'field' || p.id == excludeId) return;
        let dx = p.x - ox;
        let dy = p.y - oy;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PUSH_DIST) {
            if (dist === 0) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; dist = 0.05; }
            const pushFactor = (PUSH_DIST - dist) / dist;
            const newX = p.x + dx * pushFactor * 0.4;
            const newY = p.y + dy * pushFactor * 0.4;
            const clamped = clampToField(newX, newY);
            p.x = clamped.x; p.y = clamped.y;
        }
    });
}

function toggleBench(team) {
    const selector = team === 'home' ? '.sidebar' : '.sidebar-right';
    const otherSelector = team === 'home' ? '.sidebar-right' : '.sidebar';
    const drawer = document.querySelector(selector);
    const otherDrawer = document.querySelector(otherSelector);
    if (otherDrawer) otherDrawer.classList.remove('open');
    if (drawer) drawer.classList.toggle('open');
}

function closeDrawers() {
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.sidebar-right')?.classList.remove('open');
}

let _lastTacticalLog = {};

function logTacticalMove(player, x, y) {
    if (!player || !player.id) return;
    const now = Date.now();
    const lastTs = _lastTacticalLog[player.id] || 0;
    if (now - lastTs < 800) return; // Throttle 800ms
    _lastTacticalLog[player.id] = now;

    if (typeof _registerMatchEvent === 'function') {
        const xPct = Math.round((x || 0) * 10) / 10;
        const yPct = Math.round((y || 0) * 10) / 10;
        _registerMatchEvent('tactical_move', JSON.stringify({
            playerId: String(player.id),
            playerName: player.name || '',
            playerNumber: player.number || 0,
            team: player.team || 'home',
            status: player.status || 'field',
            x: xPct,
            y: yPct
        }), '📍');
    }
}

function dropToField(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId') || touchData.draggedPlayerId;
    if (!_dropAllowed(playerId)) return; // anti-duplicación táctil
    const player = players.find(p => p.id == playerId);
    if (!player) return;

    const pitch = document.getElementById('football-pitch');
    const rect = pitch.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    // Calcular porcentajes ANTES del clamp
    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = ((clientY - rect.top) / rect.height) * 100;
    // Clamp para que nombre y crono nunca salgan del campo
    const clamped = clampToField(rawX, rawY);
    const xPct = clamped.x;
    const yPct = clamped.y;

    const teamFieldPlayers = players.filter(p => p.team === player.team && p.status === 'field');
    const fieldLimit = currentMode === 'f7' ? 7 : 11;

    // Buscar swap con jugador del mismo equipo cercano
    let targetPlayer = null;
    let minDistance = 8;
    teamFieldPlayers.forEach(p => {
        if (p.id == player.id) return;
        const dx = xPct - p.x;
        const dy = yPct - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDistance) { minDistance = dist; targetPlayer = p; }
    });

    if (!targetPlayer && player.status === 'bench' && teamFieldPlayers.length >= fieldLimit) {
        let absMinDist = 999;
        teamFieldPlayers.forEach(p => {
            const dx = xPct - p.x;
            const dy = yPct - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < absMinDist) { absMinDist = dist; targetPlayer = p; }
        });
    }

    if (targetPlayer) {
        handleSmartSwap(player, targetPlayer);
    } else {
        const currentFieldPlayers = players.filter(p => p.team === player.team && p.status === 'field');
        if (player.status === 'field' || currentFieldPlayers.length < fieldLimit) {
            // 🔑 v425 — EL FALSO "ENTRA" DE LOS MOVIMIENTOS TÁCTICOS.
            // Hay que quedarse con el estado ANTES de mutarlo: "entra" describe
            // una TRANSICIÓN (banquillo → campo), no el estado final. Mover por
            // el campo a alguien que ya estaba en el campo no es una entrada.
            const estabaEnCampo = (player.status === 'field');
            resolveOverlaps(xPct, yPct, player.id);
            player.status = 'field';
            player.x = xPct;
            player.y = yPct;
            logTacticalMove(player, xPct, yPct);
            // ⚠️ LO QUE HABÍA AQUÍ ERA UNA HEURÍSTICA SOBRE EL TEXTO DEL
            // HISTORIAL: "registra si history está vacío o si la última línea no
            // dice 'Entra'". Fallaba justo con los TITULARES —history vacío—, y
            // por eso el autor veía "▼ ENTRA: BRUNO" al recolocar a un titular.
            // Es otra vez la misma trampa: el TEXTO no puede ser el contrato de
            // datos. Ahora se mira la transición real del estado.
            if (isRunning && !estabaEnCampo) {
                logMovement(player, undefined, 'bench');
            }
        }
    }

    renderPlayers();
}

function dropToBench(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId');
    const actualId = playerId || touchData.draggedPlayerId;
    if (!_dropAllowed(actualId)) return; // anti-duplicación táctil
    const player = players.find(p => p.id == actualId);
    if (!player || player.team !== 'home') return;
    handleBenchDrop(e, player);
}

function dropToAwayBench(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId');
    const actualId = playerId || touchData.draggedPlayerId;
    if (!_dropAllowed(actualId)) return; // anti-duplicación táctil
    const player = players.find(p => p.id == actualId);
    if (!player || player.team !== 'away') return;
    handleBenchDrop(e, player);
}

function handleBenchDrop(e, player) {
    const clientX = e.clientX;
    const clientY = e.clientY;
    const potentialTargets = players.filter(p => p.team === player.team && p.status === 'bench' && p.id !== player.id);

    if (player.cards === 'roja' && player.status === 'field') {
        player.status = 'bench'; player.x = 0; player.y = 0;
        if (isRunning) logMovement(player, undefined, 'field');
        renderPlayers(); sortBenchUI(player.team); return;
    }

    if (potentialTargets.length === 0) {
        // v425: el `|| player.cards === 'roja'` deja entrar aquí a un expulsado
        // que YA estaba en el banquillo; sin el estado previo, eso registraba un
        // "Sale" de alguien que no estaba en el campo. Misma familia que el
        // falso "Entra" de los movimientos tácticos.
        const _prev = player.status;
        if (player.status !== 'bench' || player.cards === 'roja') {
            player.status = 'bench'; player.x = 0; player.y = 0;
            if (isRunning) logMovement(player, undefined, _prev);
        }
        renderPlayers(); return;
    }

    let targetPlayer = null;
    let minDistance = 9999;
    const directHitMargin = 40;

    potentialTargets.forEach(tp => {
        const chip = document.getElementById(`player-${tp.id}`);
        if (chip) {
            const rect = chip.getBoundingClientRect();
            const isInside = (
                clientX >= rect.left - directHitMargin && clientX <= rect.right + directHitMargin &&
                clientY >= rect.top - directHitMargin && clientY <= rect.bottom + directHitMargin
            );
            if (isInside) {
                const dx = clientX - (rect.left + rect.width / 2);
                const dy = clientY - (rect.top + rect.height / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDistance) { minDistance = dist; targetPlayer = tp; }
            }
        }
    });

    if (!targetPlayer && player.status === 'field') {
        minDistance = 9999;
        potentialTargets.forEach(tp => {
            const chip = document.getElementById(`player-${tp.id}`);
            if (chip) {
                const rect = chip.getBoundingClientRect();
                const dx = clientX - (rect.left + rect.width / 2);
                const dy = clientY - (rect.top + rect.height / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDistance) { minDistance = dist; targetPlayer = tp; }
            }
        });
    }

    if (targetPlayer) {
        handleSmartSwap(player, targetPlayer);
    } else {
        if (player.status !== 'bench') {
            const teamBench = players.filter(p => p.team === player.team && p.status === 'bench').sort((a, b) => (a.benchOrder || 0) - (b.benchOrder || 0));
            player.status = 'bench'; player.x = 0; player.y = 0;
            teamBench.push(player);
            teamBench.forEach((p, i) => p.benchOrder = i);
            if (isRunning) logMovement(player, undefined, 'field');
        }
    }

    renderPlayers();
}

function handleSmartSwap(dragged, target, forcedSubId) {
    if (dragged.cards === 'roja') {
        if (target.status === 'bench') {
            const _prevDrag = dragged.status;   // v425: no registrar si ya estaba en la banca
            dragged.status = 'bench'; dragged.x = 0; dragged.y = 0;
            if (isRunning) logMovement(dragged, forcedSubId, _prevDrag);
            renderPlayers(); sortBenchUI(dragged.team); return;
        } else {
            alert("Un jugador expulsado no puede volver al campo."); return;
        }
    }
    if (target.cards === 'roja') { alert("No se puede realizar cambios con un jugador expulsado."); return; }

    const oldDraggedStatus = dragged.status;
    const oldDraggedX = dragged.x;
    const oldDraggedY = dragged.y;
    const oldDraggedOrder = dragged.benchOrder;

    dragged.status = target.status;
    dragged.x = target.x; dragged.y = target.y;
    dragged.benchOrder = target.benchOrder;

    target.status = oldDraggedStatus;
    target.x = oldDraggedX; target.y = oldDraggedY;
    target.benchOrder = oldDraggedOrder;

    if (dragged.status === 'bench') { dragged.x = 0; dragged.y = 0; }
    if (target.status === 'bench') { target.x = 0; target.y = 0; }

    // Clamp posiciones en campo
    if (dragged.status === 'field') { const c = clampToField(dragged.x, dragged.y); dragged.x = c.x; dragged.y = c.y; logTacticalMove(dragged, dragged.x, dragged.y); }
    if (target.status === 'field') { const c = clampToField(target.x, target.y); target.x = c.x; target.y = c.y; logTacticalMove(target, target.x, target.y); }

    // v240: SIEMPRE registrar el cambio, no solo si isRunning.
    // Antes, si el partido estaba pausado o en descanso, los cambios no se
    // registraban y el historial se perdía al salir y volver a entrar.
    //
    // 🔑 v425 — PERO SÓLO SI ES UNA SUSTITUCIÓN DE VERDAD.
    // Intercambiar dos jugadores que YA ESTÁN LOS DOS EN EL CAMPO es una
    // permuta de posiciones, no un cambio: nadie entra y nadie sale. Como
    // logMovement deduce la acción del estado FINAL, y el estado final de los
    // dos sigue siendo 'field', registraba DOS "Entra" falsos — uno por
    // jugador. Ése es el segundo origen del "▼ ENTRA" que veía el autor, y
    // además ensuciaba el historial del que sale el cronograma de informes
    // (las cadenas se convierten en sub_in/sub_out en _parseHistoryForFirestore).
    // El caso banquillo↔banquillo (reordenar la banca) tampoco es un cambio.
    {
        const permutaEnCampo   = (oldDraggedStatus === 'field'  && dragged.status === 'field');
        const permutaEnBanca   = (oldDraggedStatus === 'bench'  && dragged.status === 'bench');
        if (!permutaEnCampo && !permutaEnBanca) {
            const subId = forcedSubId || Date.now();
            logMovement(dragged, subId, oldDraggedStatus);
            logMovement(target,  subId, dragged.status);   // el target recibió el estado viejo del dragged
        }
    }
    if (dragged.status === 'bench' || target.status === 'bench') sortBenchUI(dragged.team);
}

// `prevStatus`: el estado del jugador ANTES del movimiento que se está
// registrando. Opcional por compatibilidad con las llamadas que no lo pasan.
//
// 🔑 v425 — POR QUÉ HACE FALTA. "Entra"/"Sale" describen una TRANSICIÓN, pero
// esta función sólo veía el estado FINAL (`player.status === 'field' ?
// 'Entra' : 'Sale'`). Cualquier movimiento que no cambiara el estado —recolocar
// a un titular por el campo, permutar dos jugadores del campo— se registraba
// igualmente como "Entra". Y esa cadena falsa no se queda en el visor: la
// convierte en un sub_in falso _parseHistoryForFirestore, y con él el
// cronograma de informes cree que el jugador entró al campo en ese minuto.
// Cuando el llamante sabe de dónde venía el jugador, aquí se descarta el
// no-movimiento en vez de confiar en que cada sitio se acuerde de filtrar.
function logMovement(player, subId, prevStatus) {
    if (prevStatus !== undefined && prevStatus === player.status) return;
    const elapsed = matchPhase === '2nd_half' ? (masterTimeH1 + masterTimeH2) : masterTimeH1;
    const timestamp = formatTime(elapsed);
    const halfLabel = matchPhase === '1st_half' ? '1ªP' : matchPhase === '2nd_half' ? '2ªP' : 'DESC';
    const action = player.status === 'field' ? 'Entra' : 'Sale';
    // subId permite emparejar la entrada con la salida en el informe.
    // v445: y la hora real del reloj al final, con '@'. Va DESPUÉS del subId a
    // propósito: el parser saca el minuto con la PRIMERA hora de la cadena y el
    // subId con /#(\d+)/, así que anexar al final no le toca ni uno ni otro.
    const _real = (typeof window !== 'undefined' && typeof window._horaRealAhora === 'function')
        ? window._horaRealAhora() : '';
    player.history.push(`${action} a las ${timestamp} (${halfLabel})${subId ? ' #' + subId : ''}${_real ? ' @' + _real : ''}`);
    // v230: registrar cambio en el historial del partido para Firestore.
    // 2026-07-31: se emite UN ÚNICO evento por sustitución. logMovement se
    // llama una vez por jugador, así que se entrega la mitad y _registerSubHalf
    // empareja por subId; el evento sale cuando llegan las dos.
    if (typeof window._registerSubHalf === 'function') {
        window._registerSubHalf(player, subId, action);
    }
}

// ═══════════════════════════════════════════════════════════════════
// NOTA (v75): Las siguientes funciones fueron eliminadas de este archivo
// porque estaban duplicadas en js/match/events/movement-log.js, que
// es el módulo canónico. Cargar movement-log.js ANTES que este archivo.
//   - logEvent()      → movement-log.js
//   - resetMatch()    → movement-log.js
//   - goBackToSetup() → movement-log.js
//   - changeScore()   → movement-log.js
//   - exportData()    → movement-log.js
// ═══════════════════════════════════════════════════════════════════





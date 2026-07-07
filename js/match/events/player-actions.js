// ════════════════════════════════════════════════════════════════════
//  PLAYER ACTION MODAL — v2 (con doble amarilla = expulsión)
//  Este archivo se carga DESPUÉS de cronos_patches.js, así que
//  las funciones que define son las definitivas que se ejecutan.
// ════════════════════════════════════════════════════════════════════

// activeActionPlayerId ya declarado en app.js

// v246: Registrar eventos del partido en window._cronosMatchEvents (local)
// Y escribirlos DIRECTAMENTE a Firestore con setDoc + merge + arrayUnion.
// arrayUnion anade al array sin sobrescribir los eventos anteriores.
// setDoc con merge crea el documento si no existe.
// pushLiveSnapshot NUNCA incluye events en el snapshot (ver sync.js v246).
window._cronosMatchEvents = window._cronosMatchEvents || [];
function _registerMatchEvent(type, text, icon) {
    try {
        var now = new Date();
        var realTime = now.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        var matchTime = '';
        try {
            var h1 = (typeof masterTimeH1 !== 'undefined') ? masterTimeH1 : 0;
            var h2 = (typeof masterTimeH2 !== 'undefined') ? masterTimeH2 : 0;
            var phase = (typeof matchPhase !== 'undefined') ? matchPhase : '1st_half';
            var total = (phase === '2nd_half' || phase === 'finished') ? (h1 + h2) : h1;
            var part = (phase === '2nd_half' || phase === 'finished') ? '2T' : '1T';
            var m = Math.floor(total / 60).toString().padStart(2, '0');
            var s = (total % 60).toString().padStart(2, '0');
            matchTime = part + ' ' + m + ':' + s;
        } catch(e) {}
        var eventEntry = {
            type: type, text: text, icon: icon || '\u2022',
            realTime: realTime, matchTime: matchTime,
            timestamp: now.toISOString(),
            createdAt: now.getTime()
        };
        window._cronosMatchEvents.push(eventEntry);
        if (window._cronosMatchEvents.length > 200) {
            window._cronosMatchEvents = window._cronosMatchEvents.slice(-200);
        }
        console.log('[v246] Evento registrado:', type, '| Total local:', window._cronosMatchEvents.length);

        // v246: escribir a Firestore con setDoc + merge + arrayUnion.
        var fa = window._cronos_auth;
        var _id = (typeof liveMatchId !== 'undefined') ? liveMatchId : null;
        if (fa && fa.db && _id) {
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
                .then(function(fs) {
                    return fs.setDoc(fs.doc(fa.db, 'live_matches', _id), {
                        events: fs.arrayUnion(eventEntry)
                    }, { merge: true });
                })
                .then(function() {
                    console.log('[v246] Evento guardado en Firestore OK');
                })
                .catch(function(err) {
                    console.error('[v246] ERROR guardando evento:', err && err.code || '', err && err.message);
                });
        } else {
            console.warn('[v246] No se pudo guardar: fa=', !!fa, 'matchId=', _id);
        }
    } catch(e) { console.error('[v246] ERROR _registerMatchEvent:', e && e.message); }
}

// ════════════════════════════════════════════════════════════════════
//  E1: Guard para acciones permitidas SOLO a jugadores EN EL CAMPO.
//  Se aplica únicamente a GOLES. Las TARJETAS y la LESIÓN se permiten
//  también en banquillo (un suplente puede recibir tarjeta o lesionarse
//  calentando).
// ====================================================================
function _requireOnField(p, accionLabel) {
    if (!p || p.status !== 'field') {
        alert(`⛔ ${p ? p.name : 'El jugador'} está en el banquillo. ` +
              `Solo se pueden registrar ${accionLabel} a jugadores EN EL CAMPO.`);
        return false;
    }
    return true;
}

function openPlayerActionModal(player) {
    activeActionPlayerId = player.id;
    document.getElementById('action-player-name').innerHTML =
        `${escapeHtml(player.name)} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-number').innerHTML =
        `Dorsal ${escapeHtml(String(player.number))} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-goals').textContent = `${player.goals || 0} ⚽`;

    // ── Resaltar botón de tarjeta activa ──
    const btnAmarilla = document.querySelector('#player-action-modal .btn[onclick*="amarilla"]');
    const btnRoja     = document.querySelector('#player-action-modal .btn[onclick*="roja"]');

    if (btnAmarilla) {
        // Limpiar badge previo
        const oldBadge = btnAmarilla.querySelector('.cronos-ycard-badge');
        if (oldBadge) oldBadge.remove();
        btnAmarilla.style.outline   = '';
        btnAmarilla.style.boxShadow = '';

        // Si tiene 1ª amarilla → mostrar badge "1ª" y aviso visual
        const yellows = (typeof player.yellowCards === 'number') ? player.yellowCards : 0;
        if (player.cards === 'amarilla' && yellows >= 1) {
            btnAmarilla.style.outline   = '3px solid #f1c40f';
            btnAmarilla.style.boxShadow = '0 0 10px rgba(241,196,15,0.9)';
            const badge = document.createElement('span');
            badge.className   = 'cronos-ycard-badge';
            badge.textContent = '1ª';
            badge.style.cssText = 'margin-left:5px;background:#f1c40f;color:#000;' +
                'border-radius:3px;font-size:0.62rem;font-weight:800;' +
                'padding:1px 4px;vertical-align:middle;';
            badge.title = 'Ya tiene 1ª amarilla — siguiente pulsación = EXPULSIÓN';
            btnAmarilla.appendChild(badge);
        }
    }
    if (btnRoja) {
        btnRoja.style.outline   = player.cards === 'roja' ? '3px solid #fff' : '';
        btnRoja.style.boxShadow = player.cards === 'roja' ? '0 0 8px rgba(231,76,60,0.8)' : '';
    }

    // Reflejar estado de lesión en el botón
    const injBtn = document.getElementById('btn-injury');
    if (injBtn) {
        injBtn.style.background = player.injured ? 'rgba(231,76,60,0.3)' : 'rgba(255,255,255,0.08)';
        injBtn.style.border     = player.injured ? '1px solid #e74c3c' : '';
        injBtn.textContent      = player.injured ? '🚑 Lesionado ✓' : '🚑 Lesión';
    }
    // ── E1: Deshabilitar SOLO los botones de GOL (+1/-1) si el jugador
    //    NO está en el campo. Tarjetas (🟨/🟥) y lesión (🚑) permanecen
    //    SIEMPRE activas: un suplente puede recibir tarjeta o lesionarse
    //    calentando. Se actúa sobre cada botón changeGoals de forma
    //    individual (NO sobre el contenedor padre, que comparte fila con
    //    la lesión) para no afectar a otras acciones.
    const onField = player.status === 'field';
    document.querySelectorAll('#player-action-modal .btn[onclick*="changeGoals"]').forEach(btn => {
        btn.disabled = !onField;
        btn.style.opacity = onField ? '' : '0.35';
        btn.style.pointerEvents = onField ? '' : 'none';
        btn.title = onField ? '' : 'Solo se registran goles a jugadores EN EL CAMPO';
    });

    // ── Botón de rectificación arbitral (revertir tarjeta roja) ──
    // Solo visible cuando el jugador está expulsado. Se inyecta/retira
    // dinámicamente para no alterar el HTML estático del modal.
    _syncRevertRedCardButton(player);

    document.getElementById('player-action-modal').style.display = 'flex';
}

// ════════════════════════════════════════════════════════════════════
//  Inserta o elimina el botón "Revertir tarjeta roja (rectificación
//  arbitral)" dentro del modal según el estado del jugador.
// ════════════════════════════════════════════════════════════════════
function _syncRevertRedCardButton(player) {
    const modal = document.getElementById('player-action-modal');
    if (!modal) return;
    const content = modal.querySelector('.modal-content');
    if (!content) return;

    const existing = document.getElementById('btn-revert-red');

    if (player.cards !== 'roja') {
        if (existing) existing.remove();
        return;
    }

    if (existing) return; // ya presente

    const btn = document.createElement('button');
    btn.id = 'btn-revert-red';
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = '↩️ Revertir tarjeta roja (rectificación arbitral)';
    btn.style.cssText =
        'width:100%;margin-top:0.6rem;background:#5a3a1a;color:#ffd9a3;' +
        'border:1px solid #e67e22;font-size:0.78rem;font-weight:700;';
    btn.setAttribute('onclick', 'revertRedCard()');
    content.appendChild(btn);
}

function closePlayerActionModal() {
    activeActionPlayerId = null;
    document.getElementById('player-action-modal').style.display = 'none';
    renderPlayers(); // redibujar para mostrar cambios (lesión, tarjeta, goles)
    renderStaffInBench();
}

function toggleInjury() {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (!p) return;
    const wasInjured = p.injured;
    p.injured = !p.injured;
    if (p.injured) { logEvent(p, 'LESIÓN'); _registerMatchEvent('injury', 'LESIÓN · ' + p.name, '🚑'); }

    // 📊 SOLUCIÓN #7: Auditar cambio de lesión
    if (window.auditLogger && liveMatchId) {
        window.auditLogger.logPlayerAction(
            p.id,
            p.name,
            p.number,
            'injury',
            p.injured ? 'marcado' : 'desmarcado',
            { injured: { before: wasInjured, after: p.injured } }
        );
    }

    // Actualizar botón del modal — compatible con ambos estilos de markup
    const btn = document.getElementById('btn-injury');
    if (btn) {
        btn.style.background  = p.injured ? 'rgba(231,76,60,0.3)'  : 'rgba(255,255,255,0.08)';
        btn.style.border      = p.injured ? '1px solid #e74c3c'    : '';
        btn.style.borderColor = p.injured ? '#e74c3c'              : 'transparent';
        // Soporte para botón con <span> interior o texto directo
        const span = btn.querySelector('span');
        if (span) {
            span.style.color = p.injured ? '#e74c3c' : 'var(--text-muted)';
        } else {
            btn.textContent = p.injured ? '🚑 Lesionado ✓' : '🚑 Lesión';
        }
    }
    renderPlayers();
    // Commit síncrono del evento crítico (snapshot localStorage + IndexedDB
    // durable) antes de sincronizar con Firestore. Mecanismo único en
    // commitCriticalEvent() para no perder el evento si el navegador se cierra.
    if (typeof commitCriticalEvent === 'function') {
        commitCriticalEvent('injury', { playerId: p.id, playerName: p.name, playerNumber: p.number, value: p.injured });
    }
    liveSyncOnAction();
}

// ════════════════════════════════════════════════════════════════════
//  assignCard v2 — Con doble amarilla = expulsión automática
//
//  Flujo:
//    1ª amarilla → p.cards='amarilla', p.yellowCards=1 → badge "1" en chip
//    2ª amarilla → p.cards='roja', p.yellowCards=2 → badge "2🟨" en chip
//    Roja directa → p.cards='roja', p.yellowCards=0 → badge "🟥" en chip
//
//  Al final del partido se distingue claramente si fue doble amarilla
//  o roja directa gracias al campo yellowCards.
// ════════════════════════════════════════════════════════════════════
function assignCard(type) {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (!p) return;

    // Inicializar contador de amarillas (retrocompatibilidad)
    if (typeof p.yellowCards !== 'number') p.yellowCards = 0;

    // ── Jugador ya expulsado ──────────────────────────────────────
    // No se permite reasignar tarjetas sobre un expulsado, pero el modal
    // muestra el botón "Revertir tarjeta roja (rectificación arbitral)"
    // (ver openPlayerActionModal → revertRedCard) para deshacer la roja.
    if (p.cards === 'roja') {
        alert(`⛔ ${p.name} ya está expulsado.\n\nSi se trata de un error, usa "Revertir tarjeta roja (rectificación arbitral)".`);
        return;
    }

    // ── TARJETA ROJA DIRECTA ──────────────────────────────────────
    if (type === 'roja') {
        const wasCards = p.cards;
        p.cards       = 'roja';
        p.yellowCards = 0; // Roja directa → NO es doble amarilla
        logEvent(p, 'TARJETA ROJA'); _registerMatchEvent('red', 'TARJETA ROJA · ' + p.name, '🟥');
        // Commit síncrono del evento crítico antes de sincronizar con Firestore.
        if (typeof commitCriticalEvent === 'function') {
            commitCriticalEvent('card_red', { playerId: p.id, playerName: p.name, playerNumber: p.number, value: 'roja_directa' });
        }
        liveSyncOnAction();

        // 📊 SOLUCIÓN #7: Auditar tarjeta roja
        if (window.auditLogger && liveMatchId) {
            window.auditLogger.logPlayerAction(
                p.id,
                p.name,
                p.number,
                'card',
                'roja_directa',
                { card: { before: wasCards, after: 'roja' }, yellowCards: { before: 0, after: 0 } }
            );
        }

        const limit = currentMode === 'f7' ? 3 : 5;
        if (p.status === 'field') {
            p.status = 'bench'; p.x = 0; p.y = 0;
            if (isRunning) logMovement(p);
        }

        const teamReds = players.filter(x => x.team === p.team && x.cards === 'roja').length;
        if (teamReds >= limit) {
            terminateMatch(`LÍMITE DE EXPULSIONES ALCANZADO (${limit} en ${p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away})`);
        } else {
            alert(`🟥 TARJETA ROJA: ${p.name} ha sido expulsado y retirado al banquillo automáticamente.`);
        }

        closePlayerActionModal();
        renderPlayers();
        return;
    }

    // ── TARJETA AMARILLA ──────────────────────────────────────────
    if (type === 'amarilla') {

        // ── Si ya tiene 1ª amarilla → SEGUNDA AMARILLA = EXPULSIÓN ──
        if (p.cards === 'amarilla' && p.yellowCards >= 1) {
            const wasCards = p.cards;
            const wasYellow = p.yellowCards;
            p.cards       = 'roja';
            p.yellowCards = 2; // Doble amarilla → queda registrado
            logEvent(p, 'DOBLE AMARILLA → EXPULSADO'); _registerMatchEvent('red', 'TARJETA ROJA · ' + p.name + ' (doble amarilla)', '🟥');
            // Commit síncrono del evento crítico antes de sincronizar con Firestore.
            if (typeof commitCriticalEvent === 'function') {
                commitCriticalEvent('card_red', { playerId: p.id, playerName: p.name, playerNumber: p.number, value: 'doble_amarilla' });
            }
            liveSyncOnAction();

            // 📊 SOLUCIÓN #7: Auditar doble amarilla
            if (window.auditLogger && liveMatchId) {
                window.auditLogger.logPlayerAction(
                    p.id,
                    p.name,
                    p.number,
                    'card',
                    'doble_amarilla',
                    { card: { before: wasCards, after: 'roja' }, yellowCards: { before: wasYellow, after: 2 } }
                );
            }

            if (p.status === 'field') {
                p.status = 'bench'; p.x = 0; p.y = 0;
                if (isRunning) logMovement(p);
            }

            const limit2 = currentMode === 'f7' ? 3 : 5;
            const teamReds2 = players.filter(x => x.team === p.team && x.cards === 'roja').length;
            if (teamReds2 >= limit2) {
                terminateMatch(`LÍMITE DE EXPULSIONES ALCANZADO (${limit2} en ${p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away})`);
            } else {
                alert(`🟨🟨 DOBLE AMARILLA: ${p.name} queda EXPULSADO automáticamente.`);
            }

            closePlayerActionModal();
            renderPlayers();
            return;
        }

        // ── Primera amarilla → mantener modal abierto con aviso ──
        const wasCards2 = p.cards;
        p.cards       = 'amarilla';
        p.yellowCards = 1;
        logEvent(p, 'TARJETA AMARILLA'); _registerMatchEvent('yellow', 'TARJETA AMARILLA · ' + p.name, '🟨');
        // Commit síncrono del evento crítico antes de sincronizar con Firestore.
        if (typeof commitCriticalEvent === 'function') {
            commitCriticalEvent('card_yellow', { playerId: p.id, playerName: p.name, playerNumber: p.number, value: 1 });
        }
        liveSyncOnAction();

        // 📊 SOLUCIÓN #7: Auditar primera amarilla
        if (window.auditLogger && liveMatchId) {
            window.auditLogger.logPlayerAction(
                p.id,
                p.name,
                p.number,
                'card',
                'amarilla_1',
                { card: { before: wasCards2, after: 'amarilla' }, yellowCards: { before: 0, after: 1 } }
            );
        }

        renderPlayers();

        // NO cerrar modal — mostrar aviso de que la siguiente = expulsión
        const btnAm = document.querySelector('#player-action-modal .btn[onclick*="amarilla"]');
        if (btnAm) {
            // Limpiar badge previo
            const oldBadge = btnAm.querySelector('.cronos-ycard-badge');
            if (oldBadge) oldBadge.remove();

            const badge = document.createElement('span');
            badge.className   = 'cronos-ycard-badge';
            badge.textContent = '1ª';
            badge.style.cssText = 'margin-left:5px;background:#f1c40f;color:#000;' +
                'border-radius:3px;font-size:0.62rem;font-weight:800;' +
                'padding:1px 4px;vertical-align:middle;';
            badge.title = 'Ya tiene 1ª amarilla — siguiente pulsación = EXPULSIÓN';
            btnAm.appendChild(badge);
            btnAm.style.outline   = '3px solid #f1c40f';
            btnAm.style.boxShadow = '0 0 10px rgba(241,196,15,0.9)';
        }
        return;
    }

    // Cualquier otro tipo: flujo original
    p.cards = type;
    logEvent(p, type);
    liveSyncOnAction();
    closePlayerActionModal();
    renderPlayers();
}

// ════════════════════════════════════════════════════════════════════
//  revertRedCard — Rectificación arbitral de una tarjeta roja.
//
//  Deshace una expulsión asignada por error. A diferencia de assignCard,
//  el jugador NO cambia de posición: se queda donde está (campo o
//  banquillo). Queda registrado en el historial del jugador, en el
//  auditLogger ('red_card_reversed') y como evento crítico durable.
// ════════════════════════════════════════════════════════════════════
function revertRedCard() {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (!p) return;

    // Solo aplica a jugadores realmente expulsados.
    if (p.cards !== 'roja') return;

    if (!confirm('¿Confirmar rectificación arbitral? Esta acción quedará registrada en el informe.')) {
        return;
    }

    const wasCards   = p.cards;
    const wasYellow  = (typeof p.yellowCards === 'number') ? p.yellowCards : 0;

    // Revertir: el jugador deja de estar expulsado. NO se mueve de su
    // posición actual (campo o banquillo se mantiene tal cual).
    p.cards       = 'ninguna';
    p.yellowCards = 0;

    // Historial del jugador / matchEvents
    logEvent(p, 'ROJA REVERTIDA (rectificación arbitral)');

    // Evento crítico durable (mismo patrón que assignCard).
    if (typeof commitCriticalEvent === 'function') {
        commitCriticalEvent('red_card_reversed', {
            playerId: p.id,
            playerName: p.name,
            playerNumber: p.number,
            value: 'rectificacion_arbitral'
        });
    }

    liveSyncOnAction();

    // Auditoría (antes → después).
    if (window.auditLogger && liveMatchId) {
        window.auditLogger.logPlayerAction(
            p.id,
            p.name,
            p.number,
            'red_card_reversed',
            'rectificacion_arbitral',
            {
                card: { before: wasCards, after: 'ninguna' },
                yellowCards: { before: wasYellow, after: 0 },
                position: p.status, // queda en su posición actual (sin mover)
                timestamp: new Date().toISOString()
            }
        );
    }

    closePlayerActionModal();
    renderPlayers();
}
window.revertRedCard = revertRedCard;

function terminateMatch(reason) {
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    // Punto 2: limpiar el estado persistido para que el partido no quede
    // recuperable tras finalizar por expulsiones (misma corrección que endMatch).
    try {
        localStorage.removeItem('cronos_active_match_v2');
        localStorage.setItem('cronos_active_match_v2_finished', Date.now().toString());
    } catch (e) {}
    // Commit sincrono del FIN (por expulsiones) como evento critico durable.
    try {
        const _mgr = window._cronosOffline;
        if (_mgr && typeof _mgr.saveEventSync === 'function') {
            _mgr.saveEventSync({
                kind: 'match_critical', type: 'phase', detail: { phase: 'finished', reason: reason },
                phase: 'finished',
                matchId: (typeof liveMatchId !== 'undefined') ? liveMatchId : null,
                clientTs: Date.now(),
            }).catch(() => {});
        }
    } catch (e) { /* silencioso */ }
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    stopLiveSync();

    // Disparar informes automáticos e internos
    // FIX (C4): log de errores en vez de silenciarlos. Antes una promesa
    // rechazada (p.ej. permisos Firestore) no se reportaba y los informes de
    // staff no se escribían sin rastro en consola.
    if (typeof saveAllMatchReportsInternal === 'function') {
        Promise.resolve(saveAllMatchReportsInternal()).catch(e => {
            console.error('[C4 terminateMatch] Error al guardar informes automáticamente:', e && e.message);
        });
    }

    alert(`🏁 PARTIDO FINALIZADO: ${reason}\nResultado final: ${TEAM_NAMES.home} ${document.getElementById('score-home').textContent} - ${document.getElementById('score-away').textContent} ${TEAM_NAMES.away}`);
}

window.endMatch = function endMatch(skipConfirm = false) {
    if (matchPhase === 'finished') return; // E5: guard idempotencia (evita Sale FIN duplicado por rutas multiples de fin)
    if (!skipConfirm && !confirm('¿Finalizar el partido?')) return;

    // Detener cronómetro
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';

    // Registrar salida de todos los jugadores en campo
    const finalTime = formatTime((masterTimeH1 || 0) + (masterTimeH2 || 0));
    (players || []).filter(p => p.status === 'field').forEach(p => {
        p.history.push('Sale a las ' + finalTime + ' (FIN)');
    });

    updateMasterUI();

    // Detener sincronización en vivo
    if (typeof stopLiveSync === 'function') {
        stopLiveSync();
    }

    // NOTA: este endMatch queda eclipsado por window.endMatch de active-match.js
    // (cargado despues). El envio de informes se dispara desde la ruta activa.

    _showPostMatchOptions();
};

function changeGoals(amount) {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (p) {
        // ── E1: Goles SOLO a jugadores en el campo ──
        if (!_requireOnField(p, 'goles')) { closePlayerActionModal(); return; }
        if (!isRunning) {
            alert("⚠️ No se pueden sumar o quitar goles con el cronómetro del partido detenido. Debe iniciar o reanudar el partido.");
            return;
        }
        const prevGoals = p.goals || 0;
        p.goals = Math.max(0, prevGoals + amount);
        if (amount > 0 && p.goals > prevGoals) {
            logEvent(p, `GOL (${p.goals}º)`); _registerMatchEvent('goal', 'GOL · ' + p.name, '⚽');;
            
            // 📊 SOLUCIÓN #7: Auditar gol
            if (window.auditLogger && liveMatchId) {
                window.auditLogger.logPlayerAction(
                    p.id,
                    p.name,
                    p.number,
                    'goal',
                    `gol_${p.goals}`,
                    { goals: { before: prevGoals, after: p.goals } }
                );
            }
        } else if (amount < 0 && p.goals < prevGoals) {
            logEvent(p, `GOL ANULADO (Quedan: ${p.goals})`);
            
            // 📊 SOLUCIÓN #7: Auditar gol anulado
            if (window.auditLogger && liveMatchId) {
                window.auditLogger.logPlayerAction(
                    p.id,
                    p.name,
                    p.number,
                    'goal_cancelled',
                    `gol_anulado_${p.goals}`,
                    { goals: { before: prevGoals, after: p.goals } }
                );
            }
        }
        document.getElementById('action-player-goals').textContent = `${p.goals} ⚽`;
        syncScoreFromPlayers(p.team);
        renderPlayers();
        // Commit síncrono del evento crítico antes de sincronizar con Firestore.
        // Solo cuando el gol AUMENTA (amount > 0): los goles anulados no
        // necesitan registrarse como evento crítico de gol.
        if (amount > 0 && typeof commitCriticalEvent === 'function') {
            commitCriticalEvent('goal', { playerId: p.id, playerName: p.name, playerNumber: p.number, team: p.team, value: p.goals });
        }
        // v225: flush inmediato en goles (no esperar al throttle de 500ms)
        // para que el panel en vivo reciba el gol sin delay. Antes usábamos
        // liveSyncOnAction() que esperaba 2s (ahora 500ms) y el gol podía
        // llegar retrasado o perderse en race conditions.
        if (amount > 0 && typeof window.liveSyncFlushNow === 'function') {
            window.liveSyncFlushNow();
        } else {
            liveSyncOnAction();
        }
    }
}

function syncScoreFromPlayers(team) {
    const total = players.filter(x => x.team === team).reduce((sum, x) => sum + (x.goals || 0), 0);
    const extra = window._cronosExtraGoals ? (window._cronosExtraGoals[team] || 0) : 0;
    document.getElementById(`score-${team}`).textContent = total + extra;
}

function clearPlayerActions() {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (p) {
        if (!isRunning) {
            alert("⚠️ No se pueden modificar las acciones del jugador con el cronómetro del partido detenido. Debe iniciar o reanudar el partido.");
            return;
        }
        const prevGoals = p.goals || 0;
        const prevCards = p.cards;
        const prevInjured = p.injured;
        const prevYellow = p.yellowCards || 0;
        
        p.goals = 0; p.cards = 'ninguna'; p.injured = false; p.yellowCards = 0;
        
        // 📊 SOLUCIÓN #7: Auditar limpieza de acciones
        if (window.auditLogger && liveMatchId) {
            window.auditLogger.logPlayerAction(
                p.id,
                p.name,
                p.number,
                'actions_cleared',
                'todas_las_acciones',
                {
                    goals: { before: prevGoals, after: 0 },
                    cards: { before: prevCards, after: 'ninguna' },
                    injured: { before: prevInjured, after: false },
                    yellowCards: { before: prevYellow, after: 0 }
                }
            );
        }
        
        document.getElementById('action-player-goals').textContent = `${p.goals} ⚽`;
        syncScoreFromPlayers(p.team);
        closePlayerActionModal();
        renderPlayers();
    }
}

function editNameFromModal() {
    if (!activeActionPlayerId) return;
    const player = players.find(p => p.id === activeActionPlayerId);
    const newName = prompt(`Editar nombre para dorsal ${player.number}:`, player.name);
    if (newName !== null && newName.trim() !== "") {
        player.name = newName.trim();
        document.getElementById('action-player-name').innerHTML =
            `${escapeHtml(player.name)} <span style="font-size:0.8rem">✏️</span>`;
        renderPlayers();
    }
}

function editNumberFromModal() {
    if (!activeActionPlayerId) return;
    const player = players.find(p => p.id === activeActionPlayerId);
    const newNum = prompt(`Editar dorsal para ${player.name}:`, player.number);
    if (newNum !== null && !isNaN(newNum)) {
        player.number = newNum;
        document.getElementById('action-player-number').innerHTML =
            `Dorsal ${escapeHtml(String(player.number))} <span style="font-size:0.8rem">✏️</span>`;
        renderPlayers();
    }
}

function selectForSubstitution(benchPlayer) {
    pendingSubstitution = { player: benchPlayer };
    closeDrawers();
    document.querySelectorAll('.player-chip').forEach(c => c.classList.remove('sub-selected', 'sub-target'));
    const selectedChip = document.getElementById(`player-${benchPlayer.id}`);
    if (selectedChip) selectedChip.classList.add('sub-selected');
    players.filter(p => p.team === benchPlayer.team && p.status === 'field').forEach(p => {
        const chip = document.getElementById(`player-${p.id}`);
        if (chip) chip.classList.add('sub-target');
    });
    const actionsEl = document.getElementById('phase-actions');
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'btn-cancel-sub';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = '✕ Cancelar cambio';
    cancelBtn.style.cssText = 'background:var(--glass);color:var(--danger);font-size:0.7rem;';
    cancelBtn.onclick = cancelPendingSubstitution;
    if (!document.getElementById('btn-cancel-sub')) actionsEl.appendChild(cancelBtn);
}

function confirmSubstitutionWith(fieldPlayer) {
    if (!pendingSubstitution) return;
    const inPlayer = pendingSubstitution.player;
    handleSmartSwap(pendingSubstitution.player, fieldPlayer);
    cancelPendingSubstitution();
    renderPlayers();
    // Commit síncrono del evento crítico antes de sincronizar con Firestore.
    if (typeof commitCriticalEvent === 'function') {
        commitCriticalEvent('substitution', {
            playerId: inPlayer ? inPlayer.id : null,
            playerName: inPlayer ? inPlayer.name : null,
            playerNumber: inPlayer ? inPlayer.number : null,
            value: { inId: inPlayer ? inPlayer.id : null, outId: fieldPlayer ? fieldPlayer.id : null },
        });
    }
    liveSyncOnAction();
}

function cancelPendingSubstitution() {
    pendingSubstitution = null;
    document.querySelectorAll('.player-chip').forEach(c => c.classList.remove('sub-selected', 'sub-target'));
    const cancelBtn = document.getElementById('btn-cancel-sub');
    if (cancelBtn) cancelBtn.remove();
    // NOTA: NO tocamos groupSubMode aquí para evitar el bug circular
    updateMasterUI();
}

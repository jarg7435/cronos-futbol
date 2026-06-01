// ════════════════════════════════════════════════════════════════════
//  PLAYER ACTION MODAL — v2 (con doble amarilla = expulsión)
//  Este archivo se carga DESPUÉS de cronos_patches.js, así que
//  las funciones que define son las definitivas que se ejecutan.
// ════════════════════════════════════════════════════════════════════

// activeActionPlayerId ya declarado en app.js

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

    document.getElementById('player-action-modal').style.display = 'flex';
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
    if (p.injured) logEvent(p, 'LESIÓN');

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
    if (p.cards === 'roja') {
        alert(`⛔ ${p.name} ya está expulsado.`);
        closePlayerActionModal();
        return;
    }

    // ── TARJETA ROJA DIRECTA ──────────────────────────────────────
    if (type === 'roja') {
        const wasCards = p.cards;
        p.cards       = 'roja';
        p.yellowCards = 0; // Roja directa → NO es doble amarilla
        logEvent(p, 'TARJETA ROJA');
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
            logEvent(p, 'DOBLE AMARILLA → EXPULSADO');
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
        logEvent(p, 'TARJETA AMARILLA');
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

function terminateMatch(reason) {
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    stopLiveSync();

    // Disparar informes automáticos e internos
    if (typeof saveAllMatchReportsInternal === 'function') {
        saveAllMatchReportsInternal();
    }

    alert(`🏁 PARTIDO FINALIZADO: ${reason}\nResultado final: ${TEAM_NAMES.home} ${document.getElementById('score-home').textContent} - ${document.getElementById('score-away').textContent} ${TEAM_NAMES.away}`);
}

window.endMatch = function endMatch(skipConfirm = false) {
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

    // Guardar informes automáticamente si la función existe
    if (typeof saveAllMatchReportsInternal === 'function') {
        saveAllMatchReportsInternal().catch(() => {});
    }

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
            logEvent(p, `GOL (${p.goals}º)`);
            
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
        liveSyncOnAction();
    }
}

function syncScoreFromPlayers(team) {
    const total = players.filter(x => x.team === team).reduce((sum, x) => sum + (x.goals || 0), 0);
    document.getElementById(`score-${team}`).textContent = total;
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
    handleSmartSwap(pendingSubstitution.player, fieldPlayer);
    cancelPendingSubstitution();
    renderPlayers();
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

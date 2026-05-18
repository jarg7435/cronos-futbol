// ════════════════════════════════════════════════════════════════════
//  PLAYER ACTION MODAL — v2 (con doble amarilla = expulsión)
//  Este archivo se carga DESPUÉS de cronos_patches.js, así que
//  las funciones que define son las definitivas que se ejecutan.
// ════════════════════════════════════════════════════════════════════

// activeActionPlayerId ya declarado en app.js

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
    p.injured = !p.injured;
    if (p.injured) logEvent(p, 'LESIÓN');

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
        p.cards       = 'roja';
        p.yellowCards = 0; // Roja directa → NO es doble amarilla
        logEvent(p, 'TARJETA ROJA');
        liveSyncOnAction();

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
            p.cards       = 'roja';
            p.yellowCards = 2; // Doble amarilla → queda registrado
            logEvent(p, 'DOBLE AMARILLA → EXPULSADO');
            liveSyncOnAction();

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
        p.cards       = 'amarilla';
        p.yellowCards = 1;
        logEvent(p, 'TARJETA AMARILLA');
        liveSyncOnAction();
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

function endMatch() {
    if (!confirm('¿Finalizar el partido? Esta acción detiene el reloj y enviará automáticamente los informes internos configurados.')) return;
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    document.getElementById('phase-actions').innerHTML = '';
    document.getElementById('match-phase-label').textContent = 'FIN DEL PARTIDO';
    const scoreHome = document.getElementById('score-home').textContent;
    const scoreAway = document.getElementById('score-away').textContent;
    stopLiveSync();

    // Disparar informes automáticos e internos
    if (typeof saveAllMatchReportsInternal === 'function') {
        saveAllMatchReportsInternal();
    }

    alert(`🏁 PARTIDO FINALIZADO\n${TEAM_NAMES.home} ${scoreHome} - ${scoreAway} ${TEAM_NAMES.away}\n\nLos informes están siendo enviados internamente.`);
}

function changeGoals(amount) {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (p) {
        const prevGoals = p.goals || 0;
        p.goals = Math.max(0, prevGoals + amount);
        if (amount > 0 && p.goals > prevGoals) {
            logEvent(p, `GOL (${p.goals}º)`);
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
        p.goals = 0; p.cards = 'ninguna'; p.injured = false; p.yellowCards = 0;
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

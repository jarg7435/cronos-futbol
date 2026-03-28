// --- PLAYER ACTION MODAL ---
let activeActionPlayerId = null;

function openPlayerActionModal(player) {
    activeActionPlayerId = player.id;
    document.getElementById('action-player-name').innerHTML = `${player.name} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-number').innerHTML = `Dorsal ${player.number} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-goals').textContent = `${player.goals || 0} ⚽`;
    // Resaltar botón de tarjeta activa
    const btnAmarilla = document.querySelector('#player-action-modal .btn[onclick*="amarilla"]');
    const btnRoja     = document.querySelector('#player-action-modal .btn[onclick*="roja"]');
    if (btnAmarilla) {
        btnAmarilla.style.outline   = player.cards === 'amarilla' ? '3px solid #fff' : '';
        btnAmarilla.style.boxShadow = player.cards === 'amarilla' ? '0 0 8px rgba(241,196,15,0.8)' : '';
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
    // Actualizar botón en el modal para reflejar estado
    const btn = document.getElementById('btn-injury');
    if (btn) {
        btn.style.background = p.injured ? 'rgba(231,76,60,0.3)' : 'rgba(255,255,255,0.08)';
        btn.style.border     = p.injured ? '1px solid #e74c3c' : '';
        btn.textContent      = p.injured ? '🚑 Lesionado ✓' : '🚑 Lesión';
    }
    renderPlayers();
    liveSyncOnAction();
}

function toggleInjury() {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (!p) return;
    p.injured = !p.injured;
    // Actualizar aspecto del botón en el modal
    const btn = document.getElementById('btn-injury');
    if (btn) {
        btn.style.borderColor  = p.injured ? '#e74c3c' : 'transparent';
        btn.style.background   = p.injured ? 'rgba(231,76,60,0.15)' : 'var(--glass)';
        btn.querySelector('span').style.color = p.injured ? '#e74c3c' : 'var(--text-muted)';
    }
    renderPlayers();
    liveSyncOnAction();
}

function assignCard(type) {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (p) {
        // Toggle: si ya tiene esa tarjeta, la quita
        if (p.cards === type) {
            p.cards = 'ninguna';
            // Actualizar visualmente el botón
            document.querySelectorAll('#player-action-modal .btn').forEach(b => {
                b.style.outline = '';
                b.style.boxShadow = '';
            });
            renderPlayers();
            liveSyncOnAction();
            return;
        }
        p.cards = type;
        logEvent(p, type === 'amarilla' ? 'TARJETA AMARILLA' : 'TARJETA ROJA');
        liveSyncOnAction();
        if (type === 'roja') {
            const teamRedCards = players.filter(x => x.team === p.team && x.cards === 'roja').length;
            const limit = currentMode === 'f7' ? 3 : 5;
            if (p.status === 'field') {
                p.status = 'bench'; p.x = 0; p.y = 0;
                if (isRunning) logMovement(p);
            }
            if (teamRedCards >= limit) {
                terminateMatch(`LÍMITE DE EXPULSIONES ALCANZADO (${limit} en ${p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away})`);
            } else {
                alert(`🟥 TARJETA ROJA: ${p.name} ha sido expulsado y retirado al banquillo automáticamente.`);
            }
        }
        closePlayerActionModal();
        renderPlayers();
    }
}

function terminateMatch(reason) {
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    stopLiveSync(); // marcar partido como finalizado en Firestore
    alert(`🏁 PARTIDO FINALIZADO: ${reason}\nResultado final: ${TEAM_NAMES.home} ${document.getElementById('score-home').textContent} - ${document.getElementById('score-away').textContent} ${TEAM_NAMES.away}`);
}

function endMatch() {
    if (!confirm('¿Finalizar el partido? Esta acción detiene el reloj y cierra el encuentro.')) return;
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    document.getElementById('phase-actions').innerHTML = '';
    document.getElementById('match-phase-label').textContent = 'FIN DEL PARTIDO';
    const scoreHome = document.getElementById('score-home').textContent;
    const scoreAway = document.getElementById('score-away').textContent;
    stopLiveSync(); // marcar partido como finalizado en Firestore
    alert(`🏁 PARTIDO FINALIZADO\n${TEAM_NAMES.home} ${scoreHome} - ${scoreAway} ${TEAM_NAMES.away}`);
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
        p.goals = 0; p.cards = 'ninguna'; p.injured = false;
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
        document.getElementById('action-player-name').innerHTML = `${player.name} <span style="font-size:0.8rem">✏️</span>`;
        renderPlayers();
    }
}

function editNumberFromModal() {
    if (!activeActionPlayerId) return;
    const player = players.find(p => p.id === activeActionPlayerId);
    const newNum = prompt(`Editar dorsal para ${player.name}:`, player.number);
    if (newNum !== null && !isNaN(newNum)) {
        player.number = newNum;
        document.getElementById('action-player-number').innerHTML = `Dorsal ${player.number} <span style="font-size:0.8rem">✏️</span>`;
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
    updateMasterUI();
}


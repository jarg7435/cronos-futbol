// --- PERSISTENCE ---

function populateSavedTeams(teamKey) {
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    if (!dropdown) return;
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    dropdown.innerHTML = '<option value="">-- Cargar --</option>';
    teams.forEach((team, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = team.name;
        dropdown.appendChild(opt);
    });
}

function loadTeamFromDropdown(teamKey) {
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    const index = dropdown.value;
    if (index === "") return;
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const team = teams[index];
    if (team) {
        document.getElementById(`setup-${teamKey}-name`).value = team.name;
        document.getElementById(`setup-${teamKey}-color`).value = team.color;
        document.getElementById(`setup-${teamKey}-shorts`).value = team.shortsColor || '#ffffff';
        document.getElementById(`setup-${teamKey}-text`).value = team.textColor || '#ffffff';

        // Restaurar color secundario si existe
        if (team.secondaryColor) {
            const secEl = document.getElementById(`setup-${teamKey}-secondary`);
            if (secEl) secEl.value = team.secondaryColor;
            if (COLORS[teamKey]) COLORS[teamKey].secondary = team.secondaryColor;
        }

        // Cargar modalidad y formación si están guardadas
        if (team.mode) {
            document.getElementById('setup-mode').value = team.mode;
            updateFormationOptions();
        }
        if (team.formation) {
            document.getElementById('setup-formation').value = team.formation;
        }

        // Guardar los jugadores de este equipo para restaurar convocatoria, titulares y suplentes
        if (!window.loadedTeamPlayers) window.loadedTeamPlayers = {};
        window.loadedTeamPlayers[teamKey] = team.players;
    }
}

function saveCurrentTeam() {
    const choice = prompt("¿Qué equipo quieres guardar?\nEscribe '1' para Local\nEscribe '2' para Visitante");
    if (!choice) return;
    let teamKey = '';
    if (choice === '1' || choice.toLowerCase() === 'local') teamKey = 'home';
    else if (choice === '2' || choice.toLowerCase() === 'visitante') teamKey = 'away';
    else return;

    const teamName = TEAM_NAMES[teamKey];
    const currentPlayers = players.filter(p => p.team === teamKey).map(p => ({
        id: p.id,
        number: p.number,
        name: p.name,
        status: p.status,
        x: p.x,
        y: p.y
    }));
    const newTeam = {
        name: teamName,
        color: COLORS[teamKey].primary,
        secondaryColor: COLORS[teamKey].secondary,
        shortsColor: COLORS[teamKey].shorts,
        textColor: COLORS[teamKey].text,
        players: currentPlayers,
        mode: currentMode,
        formation: activeFormationKey
    };
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const existingIndex = teams.findIndex(t => t.name === teamName);
    if (existingIndex >= 0) {
        if (confirm(`¿Sobrescribir equipo "${teamName}"?`)) teams[existingIndex] = newTeam;
        else return;
    } else {
        if (teams.length >= 20) { alert('Memoria llena (20 equipos).'); return; }
        teams.push(newTeam);
    }
    showSpinner('Guardando equipo…');
    setTimeout(() => {
        cloudSet('cronos_teams', JSON.stringify(teams));
        const titulares = currentPlayers.filter(p => p.status === 'field').length;
        const suplentes = currentPlayers.filter(p => p.status === 'bench').length;
        const formationDisplay = activeFormationKey ? '1-' + activeFormationKey : 'sin definir';
        hideSpinner();
        showToast('✅ ' + teamName + ' guardado · ' + (currentMode === 'f7' ? 'F7' : 'F11') + ' · ' + formationDisplay + ' · ' + titulares + 'T + ' + suplentes + 'S');
    }, 300);
}

function setupEventListeners() {
    document.getElementById('btn-play-pause').addEventListener('click', toggleGame);
    document.getElementById('btn-reset').addEventListener('click', resetMatch);
    document.getElementById('btn-save-team').addEventListener('click', saveCurrentTeam);
    document.getElementById('btn-export').addEventListener('click', exportData);

    window.endFirstHalf = () => {
        if (!confirm("¿Finalizar 1ª Parte?")) return;
        isRunning = false;
        clearInterval(timerInterval);
        const timestamp1 = formatTime(masterTimeH1);
        players.filter(p => p.status === 'field').forEach(p => {
            p.history.push(`Sale a las ${timestamp1} (DESCANSO)`);
        });
        matchPhase = 'break';
        document.getElementById('btn-play-pause').textContent = 'REANUDAR';
        document.getElementById('btn-play-pause').classList.remove('danger');
        updateMasterUI();
        alert("1ª Parte finalizada. Realice los cambios necesarios durante el descanso.");
    };

    window.startSecondHalf = () => {
        matchPhase = '2nd_half';
        const timestamp2 = formatTime(masterTimeH1);
        players.filter(p => p.status === 'field').forEach(p => {
            p.history.push(`Entra a las ${timestamp2} (2ªP)`);
        });
        lastTickTime = Date.now();
        if (!isRunning) toggleGame();
        updateMasterUI();
    };

    const dropZones = ['.sidebar', '.field-area'];
    dropZones.forEach(selector => {
        const el = document.querySelector(selector);
        if (!el) return;
        el.addEventListener('dragenter', () => el.classList.add('drop-hover'));
        el.addEventListener('dragleave', (e) => {
            if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hover');
        });
        el.addEventListener('drop', () => el.classList.remove('drop-hover'));
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isRunning) tick();
    });
}

function spawnInitialPlayers() {
    players = [];
    const defaultStartersLimit = currentMode === 'f7' ? 7 : 11;
    const defaultTotalCount = currentMode === 'f7' ? 14 : 18;
    const homeColors = COLORS.home;
    const homeConvocation = window.activeConvocation;
    const loadedHome = window.loadedTeamPlayers?.['home'];

    if (homeConvocation) {
        homeConvocation.forEach((pData, index) => {
            const playerObj = {
                id: (index + 1),
                playerId: pData.id || null,
                number: pData.number,
                name: pData.alias || pData.name || `J${pData.number}`,
                team: 'home',
                status: pData.initialStatus === 'field' ? 'field' : 'bench',
                time: 0,
                color: homeColors.primary,
                shortsColor: homeColors.shorts,
                textColor: homeColors.text,
                history: [], goals: 0, cards: 'ninguna', x: 0, y: 0
            };

            if (loadedHome) {
                const saved = loadedHome.find(lp => lp.number == pData.number);
                if (saved) {
                    playerObj.x = saved.x !== undefined ? saved.x : 0;
                    playerObj.y = saved.y !== undefined ? saved.y : 0;
                }
            }
            players.push(playerObj);
        });
    } else {
        for (let i = 1; i <= defaultTotalCount; i++) {
            players.push({
                id: i, number: i, name: `Jugador ${i}`, team: 'home',
                status: i <= defaultStartersLimit ? 'field' : 'bench',
                time: 0, color: homeColors.primary, shortsColor: homeColors.shorts,
                textColor: homeColors.text, history: [], goals: 0, cards: 'ninguna', x: 0, y: 0
            });
        }
    }

    if (analyzeAway) {
        const awayColors = COLORS.away;
        for (let i = 1; i <= defaultTotalCount; i++) {
            players.push({
                id: 100 + i, number: i, name: `Rival ${i}`, team: 'away',
                status: i <= defaultStartersLimit ? 'field' : 'bench',
                time: 0, color: awayColors.primary, shortsColor: awayColors.shorts,
                textColor: awayColors.text, history: [], goals: 0, cards: 'ninguna', x: 0, y: 0
            });
        }
    }

    window.activeConvocation = null;
}

function toggleGame() {
    isRunning = !isRunning;
    const btn = document.getElementById('btn-play-pause');
    if (isRunning) {
        btn.textContent = 'PAUSAR';
        btn.classList.add('danger');
        lastTickTime = Date.now();
        timerInterval = setInterval(tick, 1000);
    } else {
        btn.textContent = 'REANUDAR';
        btn.classList.remove('danger');
        clearInterval(timerInterval);
    }
}

function tick() {
    const now = Date.now();
    const deltaMs = now - lastTickTime;
    const deltaSec = Math.floor(deltaMs / 1000);
    if (deltaSec >= 1) {
        lastTickTime += deltaSec * 1000;
        if (matchPhase === '1st_half') masterTimeH1 += deltaSec;
        else if (matchPhase === '2nd_half') masterTimeH2 += deltaSec;
        updateMasterUI();
        players.forEach(p => {
            if (p.status === 'field') { p.time += deltaSec; updatePlayerUI(p); }
        });
    }
}

function updateMasterUI() {
    const timerH1El = document.getElementById('timer-h1');
    const timerH2El = document.getElementById('timer-h2');
    const containerH1 = document.getElementById('timer-h1-container');
    const containerH2 = document.getElementById('timer-h2-container');
    const phaseLabel = document.getElementById('match-phase-label');
    const actionsEl = document.getElementById('phase-actions');

    const h1Display = masterTimeH1 <= half1MaxTime ? (half1MaxTime - masterTimeH1) : (masterTimeH1 - half1MaxTime);
    timerH1El.textContent = formatTime(h1Display);
    containerH1.classList.toggle('added', masterTimeH1 > half1MaxTime && matchPhase === '1st_half');
    containerH1.classList.toggle('active', matchPhase === '1st_half');

    const h2Display = masterTimeH2 <= half2MaxTime ? (half2MaxTime - masterTimeH2) : (masterTimeH2 - half2MaxTime);
    timerH2El.textContent = formatTime(h2Display);
    containerH2.classList.toggle('added', masterTimeH2 > half2MaxTime);
    containerH2.classList.toggle('active', matchPhase === '2nd_half');

    if (matchPhase === '1st_half') phaseLabel.textContent = masterTimeH1 > half1MaxTime ? '1ª PARTE (AÑADIDO)' : '1ª PARTE';
    else if (matchPhase === 'break') phaseLabel.textContent = 'DESCANSO';
    else if (matchPhase === '2nd_half') phaseLabel.textContent = masterTimeH2 > half2MaxTime ? '2ª PARTE (AÑADIDO)' : '2ª PARTE';
    else if (matchPhase === 'finished') phaseLabel.textContent = 'FIN DEL PARTIDO';

    const prev = document.getElementById('btn-inline-phase');
    if (prev) prev.remove();

    if (matchPhase !== 'finished') {
        const btn = document.createElement('button');
        btn.id = 'btn-inline-phase';
        btn.style.cssText = 'font-size:1.1rem;padding:3px 6px;border-radius:6px;border:none;cursor:pointer;line-height:1;flex-shrink:0;';
        if (matchPhase === '1st_half') {
            btn.textContent = '🏁'; btn.title = 'Finalizar 1ª Parte';
            btn.style.background = '#b8860b';
            btn.onclick = (e) => { e.stopPropagation(); endFirstHalf(); };
            containerH1.insertAdjacentElement('afterend', btn);
        } else if (matchPhase === 'break') {
            btn.textContent = '▶️'; btn.title = 'Iniciar 2ª Parte';
            btn.style.background = '#1a5e8a';
            btn.onclick = (e) => { e.stopPropagation(); startSecondHalf(); };
            containerH2.insertAdjacentElement('beforebegin', btn);
        } else if (matchPhase === '2nd_half') {
            btn.textContent = '🏁'; btn.title = 'Finalizar Partido';
            btn.style.background = '#8b0000';
            btn.onclick = (e) => { e.stopPropagation(); endMatch(); };
            containerH2.insertAdjacentElement('afterend', btn);
        }
    }

    const cancelSubBtn = document.getElementById('btn-cancel-sub');
    actionsEl.innerHTML = '';
    if (cancelSubBtn) actionsEl.appendChild(cancelSubBtn);
}

function editTimer(half) {
    const currentMin = Math.floor((half === 1 ? half1MaxTime : half2MaxTime) / 60);
    const newMin = prompt(`Minutos para la ${half}ª parte:`, currentMin);
    if (newMin !== null && !isNaN(newMin) && newMin > 0) {
        if (half === 1) half1MaxTime = parseInt(newMin) * 60;
        else half2MaxTime = parseInt(newMin) * 60;
        updateMasterUI();
    }
}

function showSpinner(msg) {
    msg = msg || 'Guardando…';
    let overlay = document.getElementById('cronos-spinner');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cronos-spinner';
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(10,14,20,0.75);z-index:99999;' +
            'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;' +
            'backdrop-filter:blur(3px);';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML =
        '<div style="width:44px;height:44px;border-radius:50%;' +
        'border:4px solid rgba(88,166,255,0.2);border-top-color:#58a6ff;' +
        'animation:spinnerRotate 0.8s linear infinite;"></div>' +
        '<p style="color:#cdd9e5;font-size:0.9rem;font-weight:700;margin:0;">' + msg + '</p>' +
        '<style>@keyframes spinnerRotate{to{transform:rotate(360deg)}}</style>';
    overlay.style.display = 'flex';
}

function hideSpinner() {
    const overlay = document.getElementById('cronos-spinner');
    if (overlay) overlay.style.display = 'none';
}

function showToast(msg, duration) {
    duration = duration || 3000;
    const existing = document.getElementById('cronos-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'cronos-toast';
    toast.textContent = msg;
    toast.style.cssText =
        'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
        'background:#1a7a3e;color:#fff;padding:10px 22px;border-radius:8px;' +
        'font-size:0.85rem;font-weight:700;z-index:99998;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.4);white-space:nowrap;' +
        'animation:toastIn 0.2s ease;';
    const style = document.createElement('style');
    style.textContent = '@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(style);
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, duration);
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════════════
//  FIN DE PARTIDO — con opción de volver
// ════════════════════════════════════════════════════════════════════

/**
 * endMatch() — Finaliza el partido, muestra pantalla post-partido.
 * Sobreescribe la versión simple de app.js con la versión completa:
 * registra salidas, detiene live sync, muestra modal post-partido.
 */
window.endMatch = function endMatch() {
    if (!confirm('¿Finalizar el partido?')) return;

    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';

    const finalTime = formatTime((masterTimeH1 || 0) + (masterTimeH2 || 0));
    (players || []).filter(p => p.status === 'field').forEach(p => {
        p.history.push('Sale a las ' + finalTime + ' (FIN)');
    });

    updateMasterUI();

    if (typeof stopLiveSync === 'function') {
        stopLiveSync();
    }

    if (typeof saveAllMatchReportsInternal === 'function') {
        saveAllMatchReportsInternal().catch(() => {});
    }

    _showPostMatchOptions();
};

/**
 * _showPostMatchOptions() — Modal post-partido sobre la vista del partido.
 * Usa #setup-modal para no destruir el estado del partido en #main-container.
 * Así el entrenador puede volver si lo necesita.
 */
window._showPostMatchOptions = function _showPostMatchOptions() {
    const home   = (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES.home) || 'Local';
    const away   = (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES.away) || 'Visitante';
    const scoreH = (typeof scoreHome  !== 'undefined') ? scoreHome  : '—';
    const scoreA = (typeof scoreAway  !== 'undefined') ? scoreAway  : '—';

    const totalPlayers  = (players || []).filter(p => p.team === 'home').length;
    const totalGoals    = (players || []).filter(p => p.team === 'home').reduce((s, p) => s + (p.goals || 0), 0);
    const totalCards    = (players || []).filter(p => p.team === 'home' && p.cards && p.cards !== 'ninguna').length;
    const totalInjured  = (players || []).filter(p => p.team === 'home' && p.injured).length;
    const h1min = Math.floor((masterTimeH1 || 0) / 60);
    const h2min = Math.floor((masterTimeH2 || 0) / 60);

    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,480px);max-height:94vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#161b22,#0d1117);
                    padding:1.2rem 1.5rem;border-bottom:1px solid var(--glass-border);">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:0.8rem;">
                <span style="font-size:1.8rem;">🏁</span>
                <div>
                    <div style="font-family:'Outfit',sans-serif;font-weight:700;
                                font-size:1.1rem;color:white;">
                        ¡Partido Finalizado!
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-muted);">
                        1ª parte: ${h1min}' · 2ª parte: ${h2min}'
                    </div>
                </div>
            </div>
            <!-- Marcador -->
            <div style="display:flex;justify-content:center;align-items:center;
                        gap:1.2rem;background:rgba(255,255,255,0.04);
                        border-radius:10px;padding:0.8rem;
                        border:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:0.9rem;font-weight:700;color:white;">${home}</span>
                <span style="font-size:1.8rem;font-weight:800;
                             color:var(--primary);letter-spacing:2px;">
                    ${scoreH} – ${scoreA}
                </span>
                <span style="font-size:0.9rem;font-weight:700;color:white;">${away}</span>
            </div>
        </div>

        <!-- Stats rápidas -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;
                    border-bottom:1px solid var(--glass-border);">
            ${[
                ['👥', totalPlayers, 'Jugadores'],
                ['⚽', totalGoals,   'Goles'],
                ['🟨', totalCards,   'Tarjetas'],
                ['🩹', totalInjured, 'Lesiones'],
            ].map(([icon, val, lbl]) => `
            <div style="text-align:center;padding:0.8rem 0.4rem;
                        border-right:1px solid var(--glass-border);">
                <div style="font-size:1rem;">${icon}</div>
                <div style="font-size:1.2rem;font-weight:800;color:white;">${val}</div>
                <div style="font-size:0.62rem;color:var(--text-muted);">${lbl}</div>
            </div>`).join('')}
        </div>

        <!-- Opciones -->
        <div style="flex:1;overflow-y:auto;padding:1.1rem;
                    display:flex;flex-direction:column;gap:0.6rem;">

            <!-- ENVIAR INFORMES — acción principal -->
            <button onclick="_postMatchSendReports()"
                style="display:flex;align-items:center;gap:0.9rem;
                       padding:0.9rem 1rem;width:100%;
                       background:rgba(63,185,80,0.12);
                       border:1px solid rgba(63,185,80,0.35);
                       border-radius:10px;cursor:pointer;
                       color:white;font-size:0.92rem;font-weight:700;
                       transition:all 0.2s;"
                onmouseover="this.style.background='rgba(63,185,80,0.2)'"
                onmouseout="this.style.background='rgba(63,185,80,0.12)'">
                <span style="font-size:1.4rem;">📊</span>
                <div style="text-align:left;">
                    <div style="color:#3fb950;">Enviar Informes a Padres</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);
                                font-weight:400;">WhatsApp · Email · App interna</div>
                </div>
            </button>

            <!-- VOLVER AL PARTIDO -->
            <button onclick="_postMatchReturn()"
                style="display:flex;align-items:center;gap:0.9rem;
                       padding:0.9rem 1rem;width:100%;
                       background:rgba(88,166,255,0.1);
                       border:1px solid rgba(88,166,255,0.3);
                       border-radius:10px;cursor:pointer;
                       color:white;font-size:0.92rem;font-weight:600;
                       transition:all 0.2s;"
                onmouseover="this.style.background='rgba(88,166,255,0.18)'"
                onmouseout="this.style.background='rgba(88,166,255,0.1)'">
                <span style="font-size:1.4rem;">↩️</span>
                <div style="text-align:left;">
                    <div style="color:var(--primary);">Volver al Partido</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);
                                font-weight:400;">Los datos del partido se conservan</div>
                </div>
            </button>

            <!-- COMUNICACIONES -->
            <button onclick="openUnifiedCommsMenu ? openUnifiedCommsMenu() : null"
                style="display:flex;align-items:center;gap:0.9rem;
                       padding:0.9rem 1rem;width:100%;
                       background:rgba(255,255,255,0.04);
                       border:1px solid var(--glass-border);
                       border-radius:10px;cursor:pointer;
                       color:white;font-size:0.92rem;font-weight:600;
                       transition:all 0.2s;"
                onmouseover="this.style.background='rgba(255,255,255,0.08)'"
                onmouseout="this.style.background='rgba(255,255,255,0.04)'">
                <span style="font-size:1.4rem;">💬</span>
                <div style="text-align:left;">
                    <div>Comunicaciones</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);
                                font-weight:400;">Convocatoria, mensajes y más</div>
                </div>
            </button>

            <!-- NUEVA CONFIGURACIÓN -->
            <button onclick="_postMatchNewSetup()"
                style="display:flex;align-items:center;gap:0.9rem;
                       padding:0.9rem 1rem;width:100%;
                       background:rgba(255,255,255,0.03);
                       border:1px solid rgba(255,255,255,0.08);
                       border-radius:10px;cursor:pointer;
                       color:var(--text-muted);font-size:0.88rem;
                       transition:all 0.2s;"
                onmouseover="this.style.background='rgba(255,255,255,0.06)'"
                onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                <span style="font-size:1.2rem;">🔄</span>
                <div style="text-align:left;">
                    <div>Nueva Configuración</div>
                    <div style="font-size:0.7rem;color:rgba(125,133,144,0.8);
                                font-weight:400;">Volver a la pantalla inicial del partido</div>
                </div>
            </button>

        </div>
    </div>`;
};

/** Desde la pantalla post-partido → abre el módulo de envío de informes */
window._postMatchSendReports = function() {
    if (typeof sendMatchReportsToParents === 'function') {
        sendMatchReportsToParents(false);
    } else if (typeof openUnifiedCommsMenu === 'function') {
        openUnifiedCommsMenu();
    } else {
        document.getElementById('setup-modal').style.display = 'none';
    }
};

/**
 * Volver al partido — cierra el modal y muestra el main-container.
 * El estado del partido (jugadores, crono, goles) se conserva intacto.
 */
window._postMatchReturn = function() {
    const modal = document.getElementById('setup-modal');
    if (modal) modal.style.display = 'none';

    const mc = document.getElementById('main-container');
    const mh = document.getElementById('main-header');
    if (mc) mc.style.display = 'flex';
    if (mh) mh.style.display = 'flex';

    if (typeof showToast === 'function')
        showToast('↩️ Volviste al partido — los datos siguen activos', 3000);
};

/** Desde la pantalla post-partido → nueva configuración */
window._postMatchNewSetup = function() {
    if (!confirm('¿Empezar una nueva configuración? Se perderá el estado actual del partido.')) return;
    if (typeof openSetupModal === 'function') {
        openSetupModal();
    } else {
        const modal = document.getElementById('setup-modal');
        if (modal) modal.style.display = 'none';
    }
};
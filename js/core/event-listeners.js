// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — CORE/EVENT LISTENERS
// setupEventListeners, spawnInitialPlayers
// Extraído de app.js (líneas 4324-4508)
// ══════════════════════════════════════════════════════════════════

function setupEventListeners() {
    document.getElementById('btn-play-pause').addEventListener('click', toggleGame);
    document.getElementById('btn-reset').addEventListener('click', resetMatch);
    document.getElementById('btn-save-team').addEventListener('click', saveCurrentTeam);
    document.getElementById('btn-export').addEventListener('click', exportData);
    window.endFirstHalf = function endFirstHalf(skipConfirm) {
        if (!skipConfirm && !confirm("¿Finalizar 1ª Parte?")) return;
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
        if (liveIsActive) pushLiveSnapshot('active').catch(() => {});
        _saveMatchStateToStorage();
        if (!skipConfirm) alert("1ª Parte finalizada. Realice los cambios necesarios durante el descanso.");
    };
    window.startSecondHalf = function startSecondHalf() {
        matchPhase = '2nd_half';
        const timestamp2 = formatTime(masterTimeH1);
        players.filter(p => p.status === 'field').forEach(p => {
            p.history.push(`Entra a las ${timestamp2} (2ªP)`);
        });
        lastTickTime = Date.now();
        if (!isRunning) toggleGame();
        updateMasterUI();
        if (liveIsActive) pushLiveSnapshot('active').catch(() => {});
        _saveMatchStateToStorage();
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
        if (document.visibilityState === 'visible') {
            if (isRunning) {
                // Recuperar segundos perdidos por throttling del navegador/SO
                const now = Date.now();
                const lostMs = now - lastTickTime;
                if (lostMs > 1200) {
                    const lostSec = Math.floor(lostMs / 1000);
                    lastTickTime = now - (lostMs % 1000);
                    if (matchPhase === '1st_half') {
                        masterTimeH1 = Math.min(masterTimeH1 + lostSec, half1MaxTime + 900);
                    } else if (matchPhase === '2nd_half') {
                        masterTimeH2 = Math.min(masterTimeH2 + lostSec, half2MaxTime + 900);
                    }
                    players.forEach(p => { if (p.status === 'field') p.time += lostSec; });
                    updateMasterUI();
                    players.forEach(p => { if (p.status === 'field') updatePlayerUI(p); });
                }
                // Reiniciar timerInterval (puede haber muerto por throttling)
                clearInterval(timerInterval);
                lastTickTime = Date.now();
                timerInterval = setInterval(tick, 1000);
            }
            // Empujar estado actualizado al live
            if (liveIsActive) pushLiveSnapshot('active').catch(() => {});
        }
        if (document.visibilityState === 'hidden') {
            _saveMatchStateToStorage();
            if (liveIsActive) pushLiveSnapshot('active').catch(() => {});
        }
    });

    // Guardar estado cuando el usuario cierra/abandona la app
    window.addEventListener('pagehide', () => {
        _saveMatchStateToStorage();
        // Asegurar que el estado en la nube tenga los datos más recientes antes de cerrar
        if (liveMatchId && matchPhase !== 'finished') {
            if (typeof pushLiveSnapshot === 'function') {
                pushLiveSnapshot('active').catch(() => {});
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        _saveMatchStateToStorage();
    });
}

function spawnInitialPlayers() {
    players = [];
    const defaultStartersLimit = currentMode === 'f7' ? 7 : 11;
    const defaultTotalCount = currentMode === 'f7' ? 14 : 18;
    const homeColors = COLORS.home;
    const homeConvocation = window.activeConvocation;
    const loadedHome = window.loadedTeamPlayers?.['home'];

    const userRole = window._userTeamRole || 'home';
    const loadedAway = window.loadedTeamPlayers?.['away'];

    if (userRole === 'home' && homeConvocation) {
        homeConvocation.forEach((pData, index) => {
            const playerObj = {
                id: (index + 1),
                number: pData.number,
                name: pData.alias || pData.name || `J${pData.number}`,
                team: 'home',
                status: pData.initialStatus === 'field' ? 'field' : 'bench',
                titularOrder: pData.titularOrder,
                time: 0,
                color: homeColors.primary,
                shortsColor: homeColors.shorts,
                textColor: homeColors.text,
                history: [], goals: 0, cards: 'ninguna', x: 0, y: 0,
                convocado: true
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
                id: i, number: i, name: `Local ${i}`, team: 'home',
                status: i <= defaultStartersLimit ? 'field' : 'bench',
                time: 0, color: homeColors.primary, shortsColor: homeColors.shorts,
                textColor: homeColors.text, history: [], goals: 0, cards: 'ninguna', x: 0, y: 0,
                convocado: true
            });
        }
    }

    if (analyzeAway || userRole === 'away') {
        const awayColors = COLORS.away;
        
        if (userRole === 'away' && homeConvocation) {
            homeConvocation.forEach((pData, index) => {
                const playerObj = {
                    id: 100 + (index + 1),
                    number: pData.number,
                    name: pData.alias || pData.name || `J${pData.number}`,
                    team: 'away',
                    status: pData.initialStatus === 'field' ? 'field' : 'bench',
                    titularOrder: pData.titularOrder,
                    time: 0,
                    color: awayColors.primary,
                    shortsColor: awayColors.shorts,
                    textColor: awayColors.text,
                    history: [], goals: 0, cards: 'ninguna', x: 0, y: 0,
                    convocado: true
                };

                if (loadedAway) {
                    const saved = loadedAway.find(lp => lp.number == pData.number);
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
                    id: 100 + i, number: i, name: `Visitante ${i}`, team: 'away',
                    status: i <= defaultStartersLimit ? 'field' : 'bench',
                    time: 0, color: awayColors.primary, shortsColor: awayColors.shorts,
                    textColor: awayColors.text, history: [], goals: 0, cards: 'ninguna', x: 0, y: 0,
                    convocado: true
                });
            }
        }
    }
}

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
        // E5: guard de idempotencia. La 1ª parte solo se cierra una vez.
        // Cierra la carrera entre el auto-fin del crono (tick → endFirstHalf(true))
        // y el botón manual: el segundo en llegar ve matchPhase!=='1st_half' y aborta,
        // evitando el "Sale (DESCANSO)" duplicado por jugador en la línea de tiempo.
        if (matchPhase !== '1st_half') return;
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
        // E5: guard de idempotencia. La 2ª parte solo arranca desde el descanso;
        // una doble llamada/pulsación encuentra matchPhase!=='break' y aborta,
        // evitando el "Entra (2ªP)" duplicado por jugador.
        if (matchPhase !== 'break') return;
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
                // FIX: Proteger contra lastTickTime = 0
                if (!lastTickTime || lastTickTime === 0) lastTickTime = now;
                const lostMs = now - lastTickTime;
                if (lostMs > 1200) {
                    let lostSec = Math.floor(lostMs / 1000);
                    // FIX: Limitar recuperación a 30 min máximo para evitar saltos grotescos
                    // (si la pestaña estuvo cerrada horas, no sumamos horas al timer)
                    const maxRecoverySec = 1800;
                    lostSec = Math.min(lostSec, maxRecoverySec);
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
                // FIX: NO sobrescribir lastTickTime aquí — ya se ajustó arriba
                clearInterval(timerInterval);
                if (!lastTickTime || lastTickTime === 0) lastTickTime = Date.now();
                timerInterval = setInterval(tick, 1000);
            }
            // Empujar estado actualizado al live
            if (liveIsActive) pushLiveSnapshot('active').catch(() => {});
        }
        if (document.visibilityState === 'hidden') {
            if (typeof matchPhase !== 'undefined' && matchPhase === 'finished') return;
            _saveMatchStateToStorage();
            if (liveIsActive) pushLiveSnapshot('active').catch(() => {});
        }
    });

    // Guardar estado cuando el usuario cierra/abandona la app
    window.addEventListener('pagehide', () => {
        if (typeof matchPhase !== 'undefined' && matchPhase === 'finished') return;
        _saveMatchStateToStorage();
        // Asegurar que el estado en la nube tenga los datos más recientes antes de cerrar
        if (liveMatchId && matchPhase !== 'finished') {
            if (typeof pushLiveSnapshot === 'function') {
                pushLiveSnapshot('active').catch(() => {});
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        if (typeof matchPhase !== 'undefined' && matchPhase === 'finished') return;
        _saveMatchStateToStorage();
    });
}

function spawnInitialPlayers() {
    players = [];
    // Bloque B: arrancar siempre el marcador de goles no asignados a cero.
    window._cronosExtraGoals = { home: 0, away: 0 };
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

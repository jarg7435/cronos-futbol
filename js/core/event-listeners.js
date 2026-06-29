// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — CORE/EVENT LISTENERS
// setupEventListeners, spawnInitialPlayers
// Extraído de app.js (líneas 4324-4508)
// ══════════════════════════════════════════════════════════════════

// ── SILBATO DEL ÁRBITRO ─────────────────────────────────────────────
// Sintetiza el silbato con Web Audio API (sin archivos externos).
// times: número de pitidos (2 = fin 1ª parte, 3 = fin de partido)
// onDone: callback ejecutado cuando termina la secuencia
function _cronosWhistle(times, onDone) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const whistleDuration = 1.1; // segundos por pitido
        const gapDuration     = 0.35; // silencio entre pitidos
        let t = ctx.currentTime + 0.05;

        for (let i = 0; i < times; i++) {
            const osc     = ctx.createOscillator();
            const gainEnv = ctx.createGain();
            const noise   = ctx.createOscillator();
            const noiseG  = ctx.createGain();

            // Tono principal del silbato (~3100 Hz con vibrato)
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(3100, t);
            // Vibrato rápido (trino del árbitro)
            osc.frequency.setValueAtTime(3200, t + 0.05);
            osc.frequency.setValueAtTime(3050, t + 0.10);
            osc.frequency.setValueAtTime(3200, t + 0.15);
            osc.frequency.setValueAtTime(3050, t + 0.20);
            osc.frequency.setValueAtTime(3150, t + 0.25);
            osc.frequency.setValueAtTime(3000, t + 0.30);
            osc.frequency.setValueAtTime(3150, t + 0.35);
            osc.frequency.setValueAtTime(3000, t + 0.40);

            // Envolvente de volumen: ataque rápido, caída suave al final
            gainEnv.gain.setValueAtTime(0, t);
            gainEnv.gain.linearRampToValueAtTime(0.55, t + 0.04);
            gainEnv.gain.setValueAtTime(0.55, t + whistleDuration - 0.15);
            gainEnv.gain.linearRampToValueAtTime(0, t + whistleDuration);

            // Ruido de "cuerpo" del silbato (2º armónico)
            noise.type = 'square';
            noise.frequency.setValueAtTime(6200, t);
            noiseG.gain.setValueAtTime(0.08, t);
            noiseG.gain.linearRampToValueAtTime(0, t + whistleDuration);

            osc.connect(gainEnv);
            noise.connect(noiseG);
            gainEnv.connect(ctx.destination);
            noiseG.connect(ctx.destination);

            osc.start(t);
            osc.stop(t + whistleDuration);
            noise.start(t);
            noise.stop(t + whistleDuration);

            t += whistleDuration + gapDuration;
        }

        const totalMs = (whistleDuration + gapDuration) * times * 1000;
        setTimeout(() => {
            try { ctx.close(); } catch(e) {}
            if (typeof onDone === 'function') onDone();
        }, totalMs + 100);

    } catch (e) {
        console.warn('[Cronos] Whistle AudioContext error:', e);
        if (typeof onDone === 'function') onDone();
    }
}

// ── PANTALLA FLASH DE MOMENTO DEL PARTIDO ──────────────────────────
// Muestra un overlay de pantalla completa durante 3 segundos.
// icon: emoji/svg, title: texto grande, subtitle: texto pequeño
function _cronosMatchMomentOverlay(icon, title, subtitle, onDone) {
    const existing = document.getElementById('cronos-moment-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'cronos-moment-overlay';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:999999',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center', 'gap:1rem',
        'background:rgba(10,14,20,0.96)',
        'backdrop-filter:blur(8px)',
        'animation:_cmFadeIn 0.3s ease',
        'cursor:pointer'
    ].join(';');

    overlay.innerHTML = `
        <style>
            @keyframes _cmFadeIn  { from { opacity:0; transform:scale(0.92) } to { opacity:1; transform:scale(1) } }
            @keyframes _cmFadeOut { from { opacity:1; transform:scale(1)    } to { opacity:0; transform:scale(1.05) } }
            @keyframes _cmBounce  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
            @keyframes _cmPulse   { 0%,100%{opacity:1} 50%{opacity:0.6} }
        </style>
        <div style="font-size:5.5rem;animation:_cmBounce 0.8s ease infinite;line-height:1;">${icon}</div>
        <div style="font-size:2.2rem;font-weight:900;letter-spacing:3px;color:#ffffff;
                    text-align:center;text-transform:uppercase;text-shadow:0 0 30px rgba(255,255,255,0.4);
                    font-family:'Inter',system-ui,sans-serif;">${title}</div>
        <div style="font-size:1rem;font-weight:600;color:rgba(255,255,255,0.55);
                    letter-spacing:1.5px;text-transform:uppercase;">${subtitle}</div>
        <div style="margin-top:1.5rem;font-size:0.75rem;color:rgba(255,255,255,0.25);
                    animation:_cmPulse 1.2s ease infinite;">Toca para continuar</div>
    `;

    document.body.appendChild(overlay);

    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        overlay.style.animation = '_cmFadeOut 0.4s ease forwards';
        setTimeout(() => {
            if (overlay.parentNode) overlay.remove();
            if (typeof onDone === 'function') onDone();
        }, 400);
    };

    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 4000); // Auto-cierra a los 4 segundos
}


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

        // 🔴🔴 DOBLE SILBATO + PANTALLA FINAL DE 1ª PARTE
        _cronosWhistle(2, () => {
            _cronosMatchMomentOverlay(
                '🏁',
                'FINAL DE PRIMERA PARTE',
                'Descanso · Reanudar cuando estés listo',
                () => {
                    if (!skipConfirm) alert("1ª Parte finalizada. Realice los cambios necesarios durante el descanso.");
                }
            );
        });
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
    const awayColors = COLORS.away;

    // ── Modelo: "mi equipo" (el del entrenador) vs "el contrario" ──────────
    //  - Mi equipo (team = userRole) SIEMPRE se crea desde la convocatoria.
    //  - El contrario (el otro team) SOLO se crea si "Analizar Contrario"
    //    (analyzeAway) está activo, y se rellena con jugadores genéricos.
    //  Esto evita que al jugar de VISITANTE con el checkbox desactivado se
    //  dibuje también el equipo local genérico (bug del campo con ambos equipos).
    const myTeam       = userRole;                       // 'home' | 'away'
    const oppTeam      = userRole === 'away' ? 'home' : 'away';
    const myColors     = userRole === 'away' ? awayColors : homeColors;
    const oppColors    = userRole === 'away' ? homeColors : awayColors;
    const myIdBase     = userRole === 'away' ? 100 : 0;  // ids 1..N (home) o 101..N (away)
    const oppIdBase    = userRole === 'away' ? 0   : 100;
    const oppGenLabel  = oppTeam === 'home' ? 'Local' : 'Visitante';
    const loadedMine   = userRole === 'away' ? loadedAway : loadedHome;

    // ── 1) MI EQUIPO (siempre) ─────────────────────────────────────────────
    if (homeConvocation && homeConvocation.length) {
        homeConvocation.forEach((pData, index) => {
            const playerObj = {
                id: myIdBase + (index + 1),
                number: pData.number,
                name: pData.alias || pData.name || `J${pData.number}`,
                team: myTeam,
                status: pData.initialStatus === 'field' ? 'field' : 'bench',
                titularOrder: pData.titularOrder,
                time: 0,
                color: myColors.primary,
                shortsColor: myColors.shorts,
                textColor: myColors.text,
                history: [], goals: 0, cards: 'ninguna', x: 0, y: 0,
                convocado: true
            };
            if (loadedMine) {
                const saved = loadedMine.find(lp => lp.number == pData.number);
                if (saved) {
                    playerObj.x = saved.x !== undefined ? saved.x : 0;
                    playerObj.y = saved.y !== undefined ? saved.y : 0;
                }
            }
            players.push(playerObj);
        });
    } else {
        // Sin convocatoria: plantilla genérica para mi propio equipo.
        for (let i = 1; i <= defaultTotalCount; i++) {
            players.push({
                id: myIdBase + i, number: i,
                name: `${myTeam === 'home' ? 'Local' : 'Visitante'} ${i}`, team: myTeam,
                status: i <= defaultStartersLimit ? 'field' : 'bench',
                time: 0, color: myColors.primary, shortsColor: myColors.shorts,
                textColor: myColors.text, history: [], goals: 0, cards: 'ninguna', x: 0, y: 0,
                convocado: true
            });
        }
    }

    // ── 2) EL CONTRARIO (solo si "Analizar Contrario" está activo) ─────────
    if (analyzeAway) {
        for (let i = 1; i <= defaultTotalCount; i++) {
            players.push({
                id: oppIdBase + i, number: i, name: `${oppGenLabel} ${i}`, team: oppTeam,
                status: i <= defaultStartersLimit ? 'field' : 'bench',
                time: 0, color: oppColors.primary, shortsColor: oppColors.shorts,
                textColor: oppColors.text, history: [], goals: 0, cards: 'ninguna', x: 0, y: 0,
                convocado: true
            });
        }
    }
}

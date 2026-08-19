// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — MATCH/TIMER/CORE
// toggleGame, tick, updateMasterUI, editTimer, spinners, toasts
// Extraído de app.js (líneas 4509-4674)
// ══════════════════════════════════════════════════════════════════

// ── SOLUCIÓN #1: Timer Sync Point (corregir drift)
// Variables para sincronización con servidor cada 5 segundos
let _lastServerSync = 0;
const _SERVER_SYNC_INTERVAL_MS = 5000;  // Sincronizar cada 5 segundos
let _maxDriftAllowed = 1500; // Si la diferencia es > 1.5s, corregir

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
    // Push inmediato → live.html recibe pausa/reanuda en <1s
    if (liveIsActive) pushLiveSnapshot('active').catch(() => {});
}

function tick() {
    const now = Date.now();
    // FIX: Si lastTickTime es 0 (reset mal hecho), el delta sería ~1.7 billones de ms,
    // causando que el timer se congele al intentar sumar miles de segundos de golpe.
    if (!lastTickTime || lastTickTime === 0) {
        lastTickTime = now;
    }
    const deltaMs = now - lastTickTime;
    const deltaSec = Math.floor(deltaMs / 1000);
    // FIX: Limitar deltaSec máximo a 2 segundos para evitar saltos grotescos
    // (ej: tab en segundo plano, o lastTickTime corrupto)
    const clampedDeltaSec = Math.min(deltaSec, 2);
    if (clampedDeltaSec >= 1) {
        lastTickTime += clampedDeltaSec * 1000;

        // Límite de añadido por modalidad: F11=15 min, F7=10 min
        const maxAddedSecs = (typeof currentMode !== 'undefined' && currentMode === 'f11') ? 900 : 600;
        let shouldAutoEnd1 = false;
        let shouldAutoEnd2 = false;

        if (matchPhase === '1st_half') {
            masterTimeH1 += clampedDeltaSec;
            if (masterTimeH1 >= (half1MaxTime + maxAddedSecs)) {
                masterTimeH1 = half1MaxTime + maxAddedSecs;
                shouldAutoEnd1 = true;
            }
        } else if (matchPhase === '2nd_half') {
            masterTimeH2 += clampedDeltaSec;
            if (masterTimeH2 >= (half2MaxTime + maxAddedSecs)) {
                masterTimeH2 = half2MaxTime + maxAddedSecs;
                shouldAutoEnd2 = true;
            }
        }

        // ⚡ SOLUCIÓN #2: Usar RenderOptimizer para batching de updates
        if (window.renderOptimizer) {
            window.renderOptimizer.scheduleRender(updateMasterUI, 'high');
        } else {
            updateMasterUI();
        }

        // Actualizar timers de jugadores con render optimization
        players.forEach(p => {
            if (p.status === 'field') { 
                p.time += clampedDeltaSec;
                if (window.renderOptimizer) {
                    window.renderOptimizer.scheduleRender(() => updatePlayerUI(p), 'normal');
                } else {
                    updatePlayerUI(p);
                }
            }
        });

        // ── SOLUCIÓN #1: Sincronizar con servidor cada 5 segundos para corregir drift
        if (now - _lastServerSync > _SERVER_SYNC_INTERVAL_MS) {
            _lastServerSync = now;
            syncTimerWithServer();  // Llamada asíncrona (no esperar)
        }

        if (shouldAutoEnd1) {
            if (typeof window.endFirstHalf === 'function') window.endFirstHalf(true);
        } else if (shouldAutoEnd2) {
            if (typeof window.endMatch === 'function') window.endMatch(true);
        }
    }
}

// ── SOLUCIÓN #1: Función para sincronizar timer con servidor
async function syncTimerWithServer() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db || !liveMatchId) return;

    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await getDoc(doc(fa.db, 'live_matches', liveMatchId));
        
        if (!snap.exists()) return;

        const serverData = snap.data();
        
        // Calcular la diferencia entre cliente y servidor
        const diffH1 = Math.abs(serverData.timeH1 - masterTimeH1);
        const diffH2 = Math.abs(serverData.timeH2 - masterTimeH2);
        
        // Si la diferencia es significativa (> 1.5s), corregir
        if (diffH1 > _maxDriftAllowed && matchPhase === '1st_half') {
            const correction = serverData.timeH1 - masterTimeH1;
            masterTimeH1 = serverData.timeH1;
            if(window._CRONOS_DEBUG) console.warn(`Timer H1 ajustado: ${correction > 0 ? '+' : ''}${correction}s (drift corregido)`);
            if (window.renderOptimizer) {
                window.renderOptimizer.scheduleRender(updateMasterUI, 'high');
            } else {
                updateMasterUI();
            }
        }

        if (diffH2 > _maxDriftAllowed && matchPhase === '2nd_half') {
            const correction = serverData.timeH2 - masterTimeH2;
            masterTimeH2 = serverData.timeH2;
            if(window._CRONOS_DEBUG) console.warn(`Timer H2 ajustado: ${correction > 0 ? '+' : ''}${correction}s (drift corregido)`);
            if (window.renderOptimizer) {
                window.renderOptimizer.scheduleRender(updateMasterUI, 'high');
            } else {
                updateMasterUI();
            }
        }
    } catch (e) {
        // Offline o error de Firebase: continuar sin sync (no crítico)
        // El próximo sync reintenará
    }
}

function updateMasterUI() {
    const timerH1El = document.getElementById('timer-h1');
    const timerH2El = document.getElementById('timer-h2');
    const containerH1 = document.getElementById('timer-h1-container');
    const containerH2 = document.getElementById('timer-h2-container');
    const phaseLabel = document.getElementById('match-phase-label');
    const actionsEl = document.getElementById('phase-actions');

    // FIX: Guardar contra elementos DOM inexistentes (primer arranque)
    if (!timerH1El || !timerH2El || !containerH1 || !containerH2 || !phaseLabel) return;

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

// ════════════════════════════════════════════════════════════════════
//  🔴🔴🔴 v587 · CAMBIAR LA DURACIÓN EN CALIENTE DESINCRONIZABA EL VISOR
//
//  Reporte del autor (partido real de Regional FEM A, v586): arrancó con
//  45 minutos por parte y a mitad de la 1ª los cambió a 5. En ese instante
//  **el visor en vivo se desvinculó**: su reloj se congeló mientras el panel
//  del entrenador seguía sumando los 42-43 minutos reales.
//
//  🔑🔑🔑 ESTA FUNCIÓN CAMBIABA UNA VARIABLE LOCAL Y REPINTABA. Nada más.
//  Ni guardaba el estado, ni empujaba un snapshot. Así que:
//    · el visor seguía con la duración VIEJA hasta que otra cosa cualquiera
//      provocara un envío (de ahí que al pulsar "Reiniciar" apareciera "de
//      golpe"), y
//    · al llegarle por fin la duración nueva, `live.html` topa el reloj en
//      `maxTime + añadido`; con 42 minutos jugados y un tope nuevo de 5, ese
//      `Math.min` congela el número en seco.
//  El panel no se desincronizaba "por su cuenta": es que nadie le había
//  contado al visor que la duración había cambiado.
//
//  🔑 LO QUE NO SE PUEDE ARREGLAR CON CÓDIGO, y por eso ahora se PREGUNTA:
//  si ya se han jugado 42 minutos y la parte pasa a durar 5, esa parte está
//  terminada — el tiempo transcurrido es un hecho, no un ajuste. Hay dos
//  respuestas razonables y sólo el entrenador sabe cuál quiere:
//    · dar la parte por acabada (conserva lo jugado), o
//    · volver a contar desde cero con la duración nueva.
//  Antes no se preguntaba y no pasaba ninguna de las dos: se quedaba a medias.
//
//  ⚠️ Reiniciar el contador re-ancla el visor solo: `phaseStartedAt`
//  (sync.js) se DERIVA de masterTimeH1/H2, así que ponerlo a cero mueve el
//  ancla absoluta del espectador sin tocar nada más.
// ════════════════════════════════════════════════════════════════════
function editTimer(half) {
    const enCurso = (half === 1 && matchPhase === '1st_half') ||
                    (half === 2 && matchPhase === '2nd_half');
    const currentMin = Math.floor((half === 1 ? half1MaxTime : half2MaxTime) / 60);
    const newMin = prompt(`Minutos para la ${half}ª parte:`, currentMin);
    if (newMin === null) return;                       // canceló: no se toca nada
    const min = parseInt(newMin, 10);
    if (isNaN(min) || min <= 0) {
        if (typeof showToast === 'function') showToast('⚠️ Duración no válida. No se ha cambiado nada.', 3500);
        return;
    }
    const nuevoMax     = min * 60;
    const transcurrido = ((half === 1 ? masterTimeH1 : masterTimeH2) || 0);

    // ¿La parte EN CURSO ya lleva jugado más de lo que va a durar?
    let reiniciar = false;
    if (enCurso && transcurrido >= nuevoMax) {
        const mm = String(Math.floor(transcurrido / 60));
        const ss = String(transcurrido % 60).padStart(2, '0');
        reiniciar = confirm(
            '⏱️ Esta parte ya lleva ' + mm + ':' + ss + ' jugados, más de los ' +
            min + ' minutos que le acabas de poner.\n\n' +
            'ACEPTAR → el cronómetro vuelve a CERO y cuenta los ' + min + ' minutos nuevos.\n' +
            'CANCELAR → se conserva lo jugado y la parte se dará por terminada.\n\n' +
            'En los dos casos el visor en vivo se sincroniza al instante.'
        );
    }

    if (half === 1) half1MaxTime = nuevoMax; else half2MaxTime = nuevoMax;
    if (reiniciar) {
        if (half === 1) masterTimeH1 = 0; else masterTimeH2 = 0;
        // El ancla del visor se deriva de masterTime + lo que el tick no pudo
        // procesar: se pone a cero también, o el espectador vería el desfase.
        if (typeof lastTickTime !== 'undefined') lastTickTime = Date.now();
    }
    updateMasterUI();

    // ── Y AHORA SÍ: SE GUARDA Y SE CUENTA. Esto era lo que faltaba. ──
    // Mismo par que usan endFirstHalf/startSecondHalf y todos los puntos que
    // tocan el reloj (event-listeners.js): persistir y empujar snapshot.
    if (typeof window !== 'undefined' && typeof window._saveMatchStateToStorage === 'function') {
        try { window._saveMatchStateToStorage(); } catch (_) {}
    }
    if (typeof liveIsActive !== 'undefined' && liveIsActive &&
        typeof pushLiveSnapshot === 'function') {
        pushLiveSnapshot('active').catch(() => {});
    }
    if (typeof showToast === 'function') {
        showToast('⏱️ ' + half + 'ª parte: ' + min + ' min' +
                  (reiniciar ? ' · cronómetro reiniciado' : '') +
                  '. Visor en vivo sincronizado.', 3500);
    }
}

// ── SPINNER DE CARGA ──────────────────────────────────────────────
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
    sec = Math.max(0, sec || 0); // FIX: proteger contra valores negativos o undefined
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- RENDER ---

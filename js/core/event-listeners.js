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
        console.warn('[Chronos] Whistle AudioContext error:', e);
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
    // ── Botón superior de control de tiempo (EMPEZAR / PAUSAR / REANUDAR) ──
    //
    // Es el control PRINCIPAL del partido y se quedaba MUERTO en el DESCANSO:
    // estaba enganchado directamente a toggleGame(), que sólo levanta la
    // bandera `isRunning` y arranca el intervalo... pero `tick()` únicamente
    // suma tiempo en '1st_half' y '2nd_half'. En 'break' el entrenador pulsaba
    // REANUDAR, el botón cambiaba a PAUSAR y el cronómetro NO se movía: había
    // que ir a buscar el ▶️ pequeño de la 2ª parte.
    //
    // Ahora el botón enruta por FASE, que es lo que se espera de un control
    // universal: en el descanso arranca la 2ª parte, y en cualquier otra fase
    // se comporta EXACTAMENTE igual que antes.
    //
    // ⚠️ POR QUÉ EL ENRUTADO VA AQUÍ Y NO DENTRO DE toggleGame(): esa función
    // la llaman también la recuperación de partido (setup-modal.js, cuando el
    // snapshot trae `isRunning`) y la propia startSecondHalf(). Metiéndolo en
    // toggleGame, retomar un partido guardado en descanso habría ARRANCADO LA
    // 2ª PARTE SOLO, sin que nadie la pidiera, y además startSecondHalf() se
    // llamaría a sí misma. Aquí sólo cambia lo que hace el CLIC del usuario.
    window.onPlayPauseClick = function onPlayPauseClick() {
        if (typeof matchPhase !== 'undefined' && matchPhase === 'break' &&
            typeof window.startSecondHalf === 'function') {
            window.startSecondHalf();   // ella misma pone la fase y llama a toggleGame()
            return;
        }
        toggleGame();
    };
    // ══════════════════════════════════════════════════════════════════
    //  🔴🔴🔴 v719 · UN CLIC, UN LISTENER: EL BOTÓN SE ANULABA A SÍ MISMO
    // ══════════════════════════════════════════════════════════════════
    //  Reporte del autor (implementar.txt 2026-09-15, capturas 10429-10433,
    //  producción v718): «los botones de la barra superior (Empezar, Reanudar,
    //  Pausar) NO SIEMPRE ejecutan la acción de forma inmediata al pulsarlos,
    //  quedando el cronómetro estático», y —la pista que lo resuelve— hay que
    //  arreglarlo «sin obligar al usuario a SALIR AL PANEL DEL ENTRENADOR ni
    //  usar Recuperar Partido».
    //
    //  📏 MEDIDO: `setupEventListeners()` se ejecuta desde `init()`, e `init()`
    //  se llama desde CUATRO sitios —`unlockApp`, el arranque de rol
    //  (role-launch.js, DOS veces), los informes del Director y el
    //  diagnóstico—. Cada pasada hacía `window.onPlayPauseClick = function…`
    //  **creando una función NUEVA** y la registraba: el navegador sólo
    //  descarta el `addEventListener` repetido si es LA MISMA referencia, y
    //  aquí nunca lo era.
    //
    //  🔑🔑 CON DOS LISTENERS, UN CLIC LLAMA DOS VECES A `toggleGame()`: la
    //  bandera va false → true → false. El reloj NO arranca y el botón se
    //  queda como estaba. Con TRES vuelve a funcionar. Por eso «no siempre»:
    //  depende de la PARIDAD, y salir a los roles y volver a entrar la cambia
    //  — que es justo el apaño que él describe como molestia.
    //
    //  ⚠️ Y NO ERA SÓLO EL PLAY/PAUSE: se duplicaban también REINICIAR
    //  (preguntaba dos veces), GUARDAR, DESCARGAR, el `visibilitychange` —que
    //  suma los segundos perdidos, o sea que los sumaba DOS VECES: de ahí los
    //  «saltos» de rondas anteriores— y el `pagehide`.
    //
    //  🔑 EL ARREGLO ES DOBLE, a propósito:
    //   1 · la función se instala UNA VEZ (es un «setup», no un repintado);
    //   2 · y los cuatro botones se desenganchan antes de engancharse, así que
    //       ni siquiera un camino futuro que se salte la bandera puede volver
    //       a duplicarlos.
    //  ⚠️ Los cuatro botones y las zonas de arrastre viven en el HTML estático
    //  de index.html y NO se reconstruyen al cambiar de rol (la app oculta y
    //  muestra), así que instalar una vez es seguro. Si algún día se
    //  reconstruyera la barra, habría que volver a enganchar ahí.
    const _engancha = (id, fn, clave) => {
        const el = document.getElementById(id);
        if (!el || typeof fn !== 'function') return;
        const previo = window._cronosManejadores && window._cronosManejadores[clave];
        if (previo) { try { el.removeEventListener('click', previo); } catch (e) {} }
        window._cronosManejadores = window._cronosManejadores || {};
        window._cronosManejadores[clave] = fn;
        el.addEventListener('click', fn);
    };
    _engancha('btn-play-pause', window.onPlayPauseClick, 'playPause');
    _engancha('btn-reset',      typeof resetMatch === 'function' ? resetMatch : null, 'reset');
    _engancha('btn-save-team',  typeof saveCurrentTeam === 'function' ? saveCurrentTeam : null, 'saveTeam');
    _engancha('btn-export',     typeof exportData === 'function' ? exportData : null, 'export');
    window.endFirstHalf = function endFirstHalf(skipConfirm) {
        // E5: guard de idempotencia. La 1ª parte solo se cierra una vez.
        // Cierra la carrera entre el auto-fin del crono (tick → endFirstHalf(true))
        // y el botón manual: el segundo en llegar ve matchPhase!=='1st_half' y aborta,
        // evitando el "Sale (DESCANSO)" duplicado por jugador en la línea de tiempo.
        if (matchPhase !== '1st_half') return;
        if (!skipConfirm && !confirm("¿Finalizar 1ª Parte?")) return;
        isRunning = false;
        // 🔴 v716 · Puerta única: al cerrar la parte no puede quedar ningún
        // intervalo vivo sumando tiempo con el partido parado.
        if (typeof window._cronosParaReloj === 'function') window._cronosParaReloj();
        else clearInterval(timerInterval);
        const timestamp1 = formatTime(masterTimeH1);
        players.filter(p => p.status === 'field').forEach(p => {
            p.history.push(`Sale a las ${timestamp1} (DESCANSO)`);
        });
        matchPhase = 'break';
        // 🔴 v721 · EL FINAL DE LA PARTE ES UNA DECISIÓN DEL ENTRENADOR SOBRE LA
        // MARCHA, igual que pausar: se sella como tal. Así el latido de pausa
        // de v718 lo reintenta hasta que llegue (compara este sello con el del
        // último latido bueno) y el vigía no puede devolverle la marcha al
        // descanso durante la gracia de la pulsación.
        window._cronosUltimoToggleLocal = Date.now();
        document.getElementById('btn-play-pause').textContent = 'REANUDAR';
        document.getElementById('btn-play-pause').classList.remove('danger');
        updateMasterUI();
        // 📡 v721 · Y se emite COMPROBANDO QUE LLEGA, como pausar, reanudar y
        // finalizar desde v718. Era el único cambio de estado del reloj que se
        // mandaba a ciegas: si ese envío se perdía, el visor seguía contando la
        // 1ª parte por su cuenta mientras el panel estaba en el descanso.
        if (liveIsActive) {
            if (typeof window.cronosEmiteEstadoAhora === 'function') {
                window.cronosEmiteEstadoAhora('active').catch(() => {});
            } else {
                pushLiveSnapshot('active').catch(() => {});
            }
        }
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

    // ══════════════════════════════════════════════════════════════════
    //  🔴🔴 v719 · LO QUE NO PUEDE INSTALARSE DOS VECES
    // ══════════════════════════════════════════════════════════════════
    //  Los tres oyentes que vienen ahora se enganchan al DOCUMENTO y a la
    //  VENTANA con funciones ANÓNIMAS: no hay forma de desengancharlos, así
    //  que cada pasada de `init()` —y son cuatro los sitios que lo llaman—
    //  añadía otra copia.
    //
    //  🔑 Y EL DUPLICADO DE `visibilitychange` HACE DAÑO DE VERDAD: ese
    //  manejador recupera los segundos que el navegador se comió mientras la
    //  pestaña estaba en segundo plano y los SUMA al reloj y a las fichas. Con
    //  dos copias instaladas, al volver a la pestaña **se sumaban dos veces**:
    //  el reloj daba un salto del doble de lo que tocaba. Encaja con los
    //  «saltos extraños» que se venían reportando.
    //
    //  ⚠️ LA BANDERA VA AQUÍ Y NO AL PRINCIPIO DE LA FUNCIÓN, a propósito: lo
    //  de arriba (los cuatro botones y las funciones de fase) SÍ conviene que
    //  se rehaga en cada `init()` —engancha por referencia y se desengancha
    //  antes, así que no puede duplicarse— y además
    //  `scripts/test_play_pause_universal.js` extrae ese trozo y lo ejecuta
    //  suelto: un `return` ahí arriba lo dejaba con un «Illegal return
    //  statement» (medido).
    if (window._cronosListenersGlobalesPuestos) return;
    window._cronosListenersGlobalesPuestos = true;

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
                    // ⏱️ v748 · El tope al recuperar tiempo perdido también es
                    // el añadido de la CATEGORÍA (tabla única en utils.js).
                    const _add = (typeof window.cronosAnadidoSegundos === 'function')
                        ? window.cronosAnadidoSegundos() : 900;
                    if (matchPhase === '1st_half') {
                        masterTimeH1 = Math.min(masterTimeH1 + lostSec, half1MaxTime + _add);
                    } else if (matchPhase === '2nd_half') {
                        masterTimeH2 = Math.min(masterTimeH2 + lostSec, half2MaxTime + _add);
                    }
                    players.forEach(p => { if (p.status === 'field') p.time += lostSec; });
                    updateMasterUI();
                    players.forEach(p => { if (p.status === 'field') updatePlayerUI(p); });
                }
                // Reiniciar timerInterval (puede haber muerto por throttling)
                // FIX: NO sobrescribir lastTickTime aquí — ya se ajustó arriba
                // 🔴 v716 · Puerta única (apaga antes de encender). Este
                // camino ya limpiaba, pero ahora lo hace por el mismo sitio
                // que los otros tres creadores: un solo intervalo, con dueño.
                // ⚠️ `_cronosArrancaReloj` re-ancla `lastTickTime`, que es lo
                // que aquí se quiere: los segundos perdidos ya se han sumado
                // arriba y volver a contarlos los doblaría.
                if (typeof window._cronosArrancaReloj === 'function') window._cronosArrancaReloj();
                else {
                    clearInterval(timerInterval);
                    if (!lastTickTime || lastTickTime === 0) lastTickTime = Date.now();
                    timerInterval = setInterval(tick, 1000);
                }
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
    // 🆕 v747 · CUÁNTAS FICHAS SE CREAN SIN CONVOCATORIA, por la regla única.
    //  La cabecera de `cronosCupoConvocatoria` (utils.js) avisaba de que estos
    //  números estaban escritos a mano en CINCO sitios y de que el día que
    //  cambiaran habría que mirarlos todos. Ese día es hoy: Regional y
    //  Nacional convocan 20, y un equipo que arranca sin convocatoria tiene
    //  que poder colocar a los veinte.
    //  ⚠️ Se pide el cupo de COMPETICIÓN (tipo 'liga'), no el del amistoso:
    //  esto es cuántas fichas se preparan, y «sin tope» no se puede dibujar.
    let defaultTotalCount = currentMode === 'f7' ? 14 : 18;
    if (typeof window.cronosCupoConvocatoria === 'function') {
        const _cat = (window.CronosSubRules && typeof window.CronosSubRules.categoriaActual === 'function')
            ? window.CronosSubRules.categoriaActual()
            : (window._currentMatchCategory || '');
        const _cupo = window.cronosCupoConvocatoria(currentMode, 'liga', _cat);
        if (_cupo && _cupo.maxConvocados) defaultTotalCount = _cupo.maxConvocados;
    }
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
                // 🔑 `status` MUTA durante el partido: un suplente que entra
                // acaba en 'field'. `initialStatus` conserva con qué salió, y
                // es lo que necesita la columna PT del acumulado. Sin esta
                // línea se perdía aquí, en la lista fija de campos, igual que
                // se perdían los datos del invitado antes de las plazas de
                // apoyo.
                initialStatus: pData.initialStatus === 'field' ? 'field' : 'bench',
                titularOrder: pData.titularOrder,
                time: 0,
                color: myColors.primary,
                shortsColor: myColors.shorts,
                textColor: myColors.text,
                history: [], goals: 0, cards: 'ninguna', x: 0, y: 0,
                convocado: true,
                // ⚠️ PLAZAS DE APOYO (2026-08-12): este objeto se construye con
                // una LISTA FIJA de campos, así que todo lo que no esté aquí se
                // pierde entre la convocatoria y el partido. Sin estas cuatro
                // líneas el invitado llegaba al informe indistinguible de un
                // jugador de la casa y sus minutos no podían volver al acumulado
                // de su categoría de origen — sin ningún error por el camino.
                isGuest:           pData.isGuest === true,
                originTeamId:      pData.originTeamId || '',
                originCategory:    pData.originCategory || '',
                originSubcategory: pData.originSubcategory || '',
                originPlayerId:    pData.originPlayerId || '',
                // 🔗 v765 · EL CÓDIGO DE LA PLANTILLA ('RGB07'), el enlace
                // definitivo con su familia: Contactos guarda en el vínculo el
                // código que elige el entrenador, y el envío de informes busca
                // AQUÍ ese código (_cronosResolveParentReportTargets). El `id`
                // de arriba es interno de la sesión (1..N) y no sirve para eso.
                code:              String(pData.id || '')
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

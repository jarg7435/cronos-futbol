// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — cronos_patches.js  v10
//  Mejoras que se cargan siempre frescos (nunca cacheados)
//
//  Cambios v10 (desde v9):
//  [FIX] ensureMatchViewVisible: isSetupModalActive usa children.length > 0
//        en lugar de querySelector('.modal-content') — evita el warning
//        espurio al abrir modales que reutilizan #setup-modal (p.ej. aviso
//        de entrenamiento, convocatoria) mientras body tiene setup-mode.
//  [FIX] Se añade document.body.classList.remove('setup-mode') como
//        defensa adicional al detectar cualquier modal activo.
//  Cambios v9 (desde v8):
//  [CRITICAL FIX] ensureMatchViewVisible() ya NO quita setup-mode
//        cuando el setup-modal está visible (display:flex con contenido).
//        Antes, eliminaba setup-mode cada 2s si main-header era visible,
//        pero _launchWithRole() SIEMPRE pone main-header en flex ANTES
//        de llamar a init() → openSetupModal(). Esto hacía que el parche
//        destruyera el layout del panel del entrenador a los 2 segundos.
//  [FIX] Añadida comprobación: si setup-modal está visible (display:flex)
//        y tiene contenido (.modal-content), setup-mode es legítimo.
//  [KEEP] Todo lo demás igual (semáforo, fix cronómetro, syncSetupMode).
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── 0. Control de ciclo de vida de los intervalos del parche ─────
    //  Los dos setInterval del parche (colorAllTimers cada 1s y
    //  ensureMatchViewVisible cada 2s) se guardan en globales con nombre
    //  para poder pararlos explícitamente cuando el partido termina o se
    //  ejecuta la limpieza/salida del panel, evitando fugas de CPU/memoria
    //  (el parche se carga sin caché y se re-ejecutaría en cada recarga).
    //
    //  Si el parche se vuelve a cargar, primero limpiamos cualquier
    //  intervalo previo para no acumular duplicados.
    if (window._cronos_interval_colorTimers)   clearInterval(window._cronos_interval_colorTimers);
    if (window._cronos_interval_ensureVisible) clearInterval(window._cronos_interval_ensureVisible);
    window._cronos_interval_colorTimers   = null;
    window._cronos_interval_ensureVisible = null;

    //  Limpieza centralizada: para ambos intervalos y deja las globales a null.
    function clearCronosIntervals() {
        if (window._cronos_interval_colorTimers) {
            clearInterval(window._cronos_interval_colorTimers);
            window._cronos_interval_colorTimers = null;
        }
        if (window._cronos_interval_ensureVisible) {
            clearInterval(window._cronos_interval_ensureVisible);
            window._cronos_interval_ensureVisible = null;
        }
    }
    window.cronosClearIntervals = clearCronosIntervals;

    //  Defensa adicional: limpiar también al descargar la página.
    //  Guard para no registrar el listener dos veces si patches.js se recarga.
    if (!window._cronosUnloadHooked) {
        window._cronosUnloadHooked = true;
        window.addEventListener('pagehide', clearCronosIntervals);
        window.addEventListener('beforeunload', clearCronosIntervals);
    }

    // ── 1. Estilos globales ──────────────────────────────────────────
    var styleEl = document.createElement('style');
    styleEl.textContent =
        '#btn-export{display:none!important}' +
        '.header-actions{gap:0.5rem!important}' +
        '@media(max-width:768px){' +
            '.header-actions{gap:0.3rem!important}' +
            '#btn-play-pause,#btn-reset,#btn-save-team,#btn-unified-comms{' +
                'font-size:0.65rem!important;padding:0.35rem 0.55rem!important}}' +
        // Badge numérico de amarilla en el chip del jugador
        '.cronos-ycard-num{' +
            'position:absolute;top:-5px;right:-5px;' +
            'background:#e67e22;color:#fff;' +
            'border-radius:50%;font-size:0.5rem;font-weight:900;' +
            'width:13px;height:13px;line-height:13px;text-align:center;' +
            'border:1px solid #fff;pointer-events:none;}' +
        // Badge "1ª" en el botón amarilla del modal
        '.cronos-ycard-badge{' +
            'display:inline-block;margin-left:5px;' +
            'background:#f1c40f;color:#000;' +
            'border-radius:3px;font-size:0.62rem;font-weight:800;' +
            'padding:1px 4px;vertical-align:middle;letter-spacing:.3px;}';
    document.head.appendChild(styleEl);

    // ── 2. Semáforo de tiempo jugado ─────────────────────────────────
    //  Referencia = tiempo TOTAL del partido (h1+h2).
    //  Los umbrales se leen de window._clubTimerThresholds (configurables
    //  desde el panel del Director Deportivo y guardados en
    //  clubs/{clubId}.timerThresholds = { red, yellow }).
    //  Defaults: rojo <33% · ámbar 33-50% · verde ≥50%.
    //  FIX (v217): antes este bloque hardcodeaba total/3 y total/2 y
    //  pisaba con window.getTimerColor = getTimerColor la versión
    //  correcta de js/core/app-init.js, ignorando los umbrales
    //  configurados por el Director Deportivo. Ahora delegamos SIEMPRE
    //  en window.getTimerColor (canónica) y no reasignamos.
    function getTimerColor(timeSec) {
        // Delegar en la implementación canónica de app-init.js, que sí
        // consulta window._clubTimerThresholds. Si por alguna razón no
        // existe todavía (orden de carga), usar un fallback que también
        // respete los umbrales.
        if (typeof window.getTimerColor === 'function' &&
            // evitamos recursión si ya somos nosotros
            window.getTimerColor !== getTimerColor) {
            return window.getTimerColor(timeSec);
        }
        var _f7Def = 1800, _f11Def = 2400;
        var _isF11 = (typeof currentMode !== 'undefined' && currentMode === 'f11');
        var _def = _isF11 ? _f11Def : _f7Def;
        var h1 = (typeof half1MaxTime !== 'undefined' && half1MaxTime > 0) ? half1MaxTime : _def;
        var h2 = (typeof half2MaxTime !== 'undefined' && half2MaxTime > 0) ? half2MaxTime : _def;
        var total = h1 + h2;
        var t = (typeof window !== 'undefined' && window._clubTimerThresholds) || {};
        var redPct    = (typeof t.red    === 'number' && !isNaN(t.red))    ? t.red    : 33;
        var yellowPct = (typeof t.yellow === 'number' && !isNaN(t.yellow)) ? t.yellow : 50;
        var redSec    = total * (redPct    / 100);
        var yellowSec = total * (yellowPct / 100);
        if (timeSec >= yellowSec) return { bg: '#2ea043', text: '#000000' };
        if (timeSec >= redSec)    return { bg: '#e3b341', text: '#000000' };
        return                        { bg: '#da3633', text: '#ffffff' };
    }
    // NO reasignamos window.getTimerColor: la versión canónica vive en
    // js/core/app-init.js y ya consulta window._clubTimerThresholds.
    // Esto evita que los umbrales del Director Deportivo sean ignorados.

    function applyTimerColor(el, sec) {
        if (!el) return;
        // Usar siempre la versión canónica de window.getTimerColor
        // (definida en app-init.js), que respeta los umbrales configurados.
        var c = (typeof window.getTimerColor === 'function')
            ? window.getTimerColor(sec || 0)
            : getTimerColor(sec || 0);
        el.style.setProperty('background',    c.bg,     'important');
        el.style.setProperty('color',         c.text,   'important');
        el.style.setProperty('font-weight',   '800',    'important');
        el.style.setProperty('font-size',     '0.9rem', 'important');
        el.style.setProperty('min-width',     '46px',   'important');
        el.style.setProperty('padding',       '2px 5px','important');
        el.style.setProperty('border-radius', '4px',    'important');
        el.style.setProperty('text-align',    'center', 'important');
    }

    function patchUpdatePlayerUI() {
        if (typeof updatePlayerUI === 'undefined') { setTimeout(patchUpdatePlayerUI, 200); return; }
        var orig = updatePlayerUI;
        window.updatePlayerUI = function(p) {
            orig(p);
            var chip = document.getElementById('player-' + p.id);
            if (chip) applyTimerColor(chip.querySelector('.player-timer'), p.time || 0);
        };
    }
    patchUpdatePlayerUI();

    function colorAllTimers() {
        if (typeof players === 'undefined' || !Array.isArray(players)) return;
        players.forEach(function(p) {
            var chip = document.getElementById('player-' + p.id);
            if (chip) applyTimerColor(chip.querySelector('.player-timer'), p.time || 0);
        });
    }

    function startTimerObserver() {
        var pitch = document.getElementById('football-pitch');
        if (!pitch) { setTimeout(startTimerObserver, 500); return; }
        new MutationObserver(colorAllTimers).observe(pitch, { childList:true, subtree:true });
        var bench = document.getElementById('bench-list');
        if (bench) new MutationObserver(colorAllTimers).observe(bench, { childList:true, subtree:true });
        colorAllTimers();
        // Guardamos el id para poder pararlo en la limpieza del partido/panel.
        if (window._cronos_interval_colorTimers) clearInterval(window._cronos_interval_colorTimers);
        window._cronos_interval_colorTimers = setInterval(colorAllTimers, 1000);
    }

    // ── 3. Fix cronómetro inicial ────────────────────────────────────
    var _cronosCorrectHalfTime = null;

    function _fmtTime(secs) {
        var m = Math.floor(secs / 60);
        var s = secs % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function patchConfirmSetupTimer() {
        if (typeof confirmSetup === 'undefined') { setTimeout(patchConfirmSetupTimer, 200); return; }
        var orig = window.confirmSetup;
        window.confirmSetup = function() {
            orig();
            _cronosCorrectHalfTime = (typeof half1MaxTime !== 'undefined' && half1MaxTime > 0)
                ? half1MaxTime : null;
            if (_cronosCorrectHalfTime) {
                var display = _fmtTime(_cronosCorrectHalfTime);
                var t1 = document.getElementById('timer-h1');
                var t2 = document.getElementById('timer-h2');
                if (t1) t1.textContent = display;
                if (t2) t2.textContent = display;
            }
        };
    }
    patchConfirmSetupTimer();

    function patchGoToTitularTimer() {
        if (typeof goToTitularSelection === 'undefined') { setTimeout(patchGoToTitularTimer, 200); return; }
        var orig = window.goToTitularSelection;
        window.goToTitularSelection = function() {
            orig();
            if (_cronosCorrectHalfTime && _cronosCorrectHalfTime > 0) {
                half1MaxTime = _cronosCorrectHalfTime;
                half2MaxTime = _cronosCorrectHalfTime;
                var display = _fmtTime(_cronosCorrectHalfTime);
                var t1 = document.getElementById('timer-h1');
                var t2 = document.getElementById('timer-h2');
                if (t1) t1.textContent = display;
                if (t2) t2.textContent = display;
                try { if (typeof updateMasterUI === 'function') updateMasterUI(); } catch(e) {}
            }
        };
    }
    patchGoToTitularTimer();

    // ── 4. syncSetupMode: función centralizada de sincronización ────
    //  Esta es la función que usa el onchange del select #setup-mode.
    //  Garantiza que al cambiar la modalidad, SIEMPRE se actualicen
    //  las formaciones Y la categoría de forma coordinada.
    window.syncSetupMode = function(mode) {
        if (!mode) mode = document.getElementById('setup-mode')?.value || 'f7';

        // Asegurar que #match-category existe en el DOM
        var catSel = document.getElementById('match-category');
        if (!catSel) {
            // Buscar el contenedor para insertar categoría
            var modeSelect = document.getElementById('setup-mode');
            if (modeSelect && modeSelect.parentElement) {
                var parentRow = modeSelect.closest('div[style*="grid"]');
                if (parentRow) {
                    var catDiv = document.createElement('div');
                    catDiv.className = 'form-group';
                    catDiv.style.margin = '0';
                    catDiv.innerHTML =
                        '<label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;display:block;">Categoría</label>' +
                        '<select id="match-category" style="width:100%;background:var(--bg);border-color:var(--glass-border);padding:0.5rem;border-radius:8px;color:white;"></select>';
                    modeSelect.parentElement.insertAdjacentElement('afterend', catDiv);
                }
            }
        }

        // Actualizar formaciones (esto también llama a updateCategoryOptions internamente)
        if (typeof updateFormationOptions === 'function') {
            updateFormationOptions(mode);
        }

        // Actualizar categoría (llamada explícita por seguridad — doble garantía)
        if (typeof updateCategoryOptions === 'function') {
            updateCategoryOptions(mode);
        }

        // FIX (Error #27): forzar categoria/subcategoria del entrenador despues
        // de que updateCategoryOptions haya rellenado el dropdown.
        var _me = window._cronosCurrentUser;
        if (_me && _me.category) {
            var _catSel = document.getElementById('match-category');
            var _subSel = document.getElementById('match-subcategory');
            if (_catSel) {
                var _userCat = String(_me.category).toLowerCase();
                var _targetValue = '';
                if (_userCat.includes('prebenj'))      _targetValue = mode + '_prebenjamin';
                else if (_userCat.includes('benj'))    _targetValue = mode + '_benjamin';
                else if (_userCat.includes('alev'))    _targetValue = mode + '_alevin';
                else if (_userCat.includes('infant'))  _targetValue = mode + '_infantil';
                else if (_userCat.includes('cadet'))   _targetValue = mode + '_cadete';
                else if (_userCat.includes('juvenil')) _targetValue = mode + '_juvenil';
                else if (_userCat.includes('regional'))_targetValue = mode + '_regional';
                if (_targetValue) {
                    var _opt = _catSel.querySelector('option[value="' + _targetValue + '"]');
                    if (_opt) {
                        _catSel.value = _targetValue;
                        _catSel.disabled = true;
                    }
                }
            }
            if (_subSel && _me.subcategory) {
                var _userSub = String(_me.subcategory).toUpperCase().trim();
                if (['A','B','C'].includes(_userSub)) {
                    _subSel.value = _userSub;
                    _subSel.disabled = true;
                }
            }
        }

        // Sincronizar currentMode global
        if (typeof currentMode !== 'undefined') {
            currentMode = mode;
        }

        // Re-poblar y filtrar los equipos guardados según la nueva modalidad
        if (typeof populateSavedTeams === 'function') {
            populateSavedTeams('home');
            populateSavedTeams('away');
        }

    };

    // ── 5. Observer para parchear el select #setup-mode si se recrea ──
    function patchSetupModeSelect() {
        var modal = document.getElementById('setup-modal');
        if (!modal) { setTimeout(patchSetupModeSelect, 500); return; }

        var observer = new MutationObserver(function() {
            var sel = document.getElementById('setup-mode');
            if (!sel) return;

            // Solo parchear si el onchange NO usa syncSetupMode
            var currentOnchange = sel.getAttribute('onchange') || '';
            if (currentOnchange.indexOf('syncSetupMode') === -1) {
                sel.setAttribute('onchange', 'syncSetupMode(this.value)');
            }

            // Asegurar que match-category existe y está sincronizado
            var catSel = document.getElementById('match-category');
            if (!catSel) {
                window.syncSetupMode(sel.value);
            }
        });

        observer.observe(modal, { childList: true, subtree: true });
    }

    // ── 6. Seguridad: quitar setup-mode SOLO cuando es legítimo ──────
    //  v9 FIX: Antes, este intervalo quitaba setup-mode cada vez que
    //  main-header tenía display:flex, pero _launchWithRole() SIEMPRE
    //  pone main-header en flex ANTES de llamar a init()→openSetupModal().
    //  Esto destruía el layout del panel del entrenador a los 2 segundos.
    //
    //  Ahora comprobamos: si setup-modal está visible (display:flex) y
    //  tiene contenido (.modal-content), setup-mode es legítimo y NO
    //  se debe quitar.
    function ensureMatchViewVisible() {
        var mainHeader    = document.getElementById('main-header');
        var mainContainer = document.getElementById('main-container');
        var setupModal    = document.getElementById('setup-modal');

        // ── NUEVO v9: Si el modal está visible con contenido, setup-mode es legítimo ──
        // v10 FIX: usar children.length > 0 en vez de querySelector('.modal-content')
        // Cualquier contenido en #setup-modal (setup, entrenamiento, convocatoria…)
        // es señal de que el modal está en uso legítimo.
        var isSetupModalActive = setupModal &&
            setupModal.style.display === 'flex' &&
            setupModal.children.length > 0;

        if (isSetupModalActive) {
            // El modal está activo con contenido — NO quitar setup-mode
            return;
        }

        // Solo quitar setup-mode si main-header es visible Y el modal NO está activo
        if (mainHeader && mainHeader.style.display === 'flex' &&
            document.body.classList.contains('setup-mode')) {
            console.warn('[Chronos v9] Detectado setup-mode + partido visible (sin modal) — corrigiendo');
            document.body.classList.remove('setup-mode');
        }

        if (setupModal && setupModal.style.display === 'none' &&
            document.body.classList.contains('setup-mode')) {
            console.warn('[Chronos v9] setup-mode activo sin modal visible — quitando clase');
            document.body.classList.remove('setup-mode');
        }
    }
    // Guardamos el id para poder pararlo en la limpieza del partido/panel.
    if (window._cronos_interval_ensureVisible) clearInterval(window._cronos_interval_ensureVisible);
    window._cronos_interval_ensureVisible = setInterval(ensureMatchViewVisible, 2000);

    // ── 7. Parchear goToTitularSelection para más seguridad ─────────
    function patchGoToTitularSelection() {
        if (typeof goToTitularSelection === 'undefined') {
            setTimeout(patchGoToTitularSelection, 300);
            return;
        }
        var orig = goToTitularSelection;
        window.goToTitularSelection = function() {
            // CRÍTICO: Quitar setup-mode ANTES de cualquier otra cosa
            document.body.classList.remove('setup-mode');

            try {
                orig();
            } catch(e) {
                console.error('[Chronos v8] Error en goToTitularSelection original:', e);
            }

            // Asegurar que la vista de partido es visible
            var mainHeader    = document.getElementById('main-header');
            var mainContainer = document.getElementById('main-container');
            var setupModal    = document.getElementById('setup-modal');
            if (mainHeader)    mainHeader.style.display    = 'flex';
            if (mainContainer) mainContainer.style.display = 'flex';
            if (setupModal)    setupModal.style.display    = 'none';

            // Doble verificación: si no hay jugadores, crear fallback
            if (typeof players !== 'undefined' && (!players || players.length === 0)) {
                console.warn('[Chronos v8] No hay jugadores después de goToTitularSelection — creando fallback');
                try {
                    var defaultCount = (typeof currentMode !== 'undefined' && currentMode === 'f7') ? 7 : 11;
                    var homeColors = (typeof COLORS !== 'undefined') ? COLORS.home : { primary: '#58a6ff', shorts: '#ffffff', text: '#000000' };
                    for (var i = 1; i <= defaultCount; i++) {
                        players.push({
                            id: i, number: i, name: 'Jugador ' + i,
                            team: 'home', status: 'field',
                            time: 0, color: homeColors.primary,
                            shortsColor: homeColors.shorts,
                            textColor: homeColors.text,
                            history: [], goals: 0, cards: 'ninguna',
                            yellowCards: 0, x: 0, y: 0
                        });
                    }
                    if (typeof renderPlayers === 'function') renderPlayers();
                } catch(e2) {
                    console.error('[Chronos v8] Error creando jugadores fallback:', e2);
                }
            }

            document.body.classList.remove('setup-mode');
        };
    }
    patchGoToTitularSelection();

    // ── 8. Limpieza de intervalos al finalizar el partido ────────────
    //  endMatch() lo define active-match.js (cargado DESPUÉS de patches.js),
    //  por eso esperamos a que exista y lo envolvemos para parar nuestros
    //  intervalos cuando el partido termina. No se altera su lógica: solo
    //  añadimos la limpieza del ciclo de vida de los setInterval del parche.
    function patchEndMatchCleanup() {
        if (typeof window.endMatch !== 'function') {
            setTimeout(patchEndMatchCleanup, 300);
            return;
        }
        if (window.endMatch._cronosCleanupWrapped) return; // idempotente
        var orig = window.endMatch;
        window.endMatch = function() {
            var r = orig.apply(this, arguments);
            // Solo limpiar si el partido quedó realmente finalizado
            // (endMatch puede abortar si el usuario cancela el confirm).
            if (typeof matchPhase === 'undefined' || matchPhase === 'finished') {
                clearCronosIntervals();
            }
            return r;
        };
        window.endMatch._cronosCleanupWrapped = true;
    }
    patchEndMatchCleanup();

    function init() {
        if (window._cronosInited) return;   // evita intervalos/observers duplicados
        window._cronosInited = true;
        startTimerObserver();
        patchSetupModeSelect();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();

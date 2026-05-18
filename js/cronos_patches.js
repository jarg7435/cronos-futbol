// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — cronos_patches.js  v8
//  Mejoras que se cargan siempre frescos (nunca cacheados)
//
//  Cambios v8:
//  [FIX] Categoría: syncSetupMode() es la función centralizada que
//        SIEMPRE actualiza formaciones + categoría al cambiar modalidad.
//        Se usa directamente en el onchange del select #setup-mode.
//  [FIX] Doble amarilla: la lógica ahora vive directamente en
//        02_player_actions.js (assignCard) y 12_render.js (chip visual).
//        Este archivo ya NO necesita parchear assignCard.
//  [KEEP] Semáforo de tiempo, fix cronómetro, fix pantalla negra.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

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
    //  Referencia = tiempo TOTAL del partido (h1+h2):
    //    F7   30+30=60 min → rojo <20 · ámbar 20-30 · verde ≥30
    //    F11  40+40=80 min → rojo <26:40 · ámbar 26:40-40 · verde ≥40
    //    F11j 45+45=90 min → rojo <30 · ámbar 30-45 · verde ≥45
    function getTimerColor(timeSec) {
        var h1 = (typeof half1MaxTime !== 'undefined' && half1MaxTime > 0) ? half1MaxTime : 1800;
        var h2 = (typeof half2MaxTime !== 'undefined' && half2MaxTime > 0) ? half2MaxTime : 1800;
        var total = h1 + h2;
        if (timeSec >= total / 2) return { bg: '#2ea043', text: '#000000' };
        if (timeSec >= total / 3) return { bg: '#e3b341', text: '#000000' };
        return                        { bg: '#da3633', text: '#000000' };
    }
    window.getTimerColor = getTimerColor;

    function applyTimerColor(el, sec) {
        if (!el) return;
        var c = getTimerColor(sec || 0);
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
        setInterval(colorAllTimers, 1000);
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
                console.log('[Cronos v8] Tiempo de parte:', display);
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
                console.log('[Cronos v8] Timers confirmados:', display);
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
                    console.log('[Cronos v8] Inyectado select #match-category dinámicamente');
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

        // Sincronizar currentMode global
        if (typeof currentMode !== 'undefined') {
            currentMode = mode;
        }

        console.log('[Cronos v8] syncSetupMode:', mode, '| categoría actualizada');
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
                console.log('[Cronos v8] Patched setup-mode onchange → syncSetupMode');
            }

            // Asegurar que match-category existe y está sincronizado
            var catSel = document.getElementById('match-category');
            if (!catSel) {
                window.syncSetupMode(sel.value);
            }
        });

        observer.observe(modal, { childList: true, subtree: true });
    }

    // ── 6. Seguridad: quitar setup-mode al mostrar partido ──────────
    function ensureMatchViewVisible() {
        var mainHeader    = document.getElementById('main-header');
        var mainContainer = document.getElementById('main-container');
        var setupModal    = document.getElementById('setup-modal');

        if (mainHeader && mainHeader.style.display === 'flex' &&
            document.body.classList.contains('setup-mode')) {
            console.warn('[Cronos v8] Detectado setup-mode + partido visible — corrigiendo');
            document.body.classList.remove('setup-mode');
        }

        if (setupModal && setupModal.style.display === 'none' &&
            document.body.classList.contains('setup-mode')) {
            console.warn('[Cronos v8] setup-mode activo sin modal visible — quitando clase');
            document.body.classList.remove('setup-mode');
        }
    }
    setInterval(ensureMatchViewVisible, 2000);

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
                console.error('[Cronos v8] Error en goToTitularSelection original:', e);
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
                console.warn('[Cronos v8] No hay jugadores después de goToTitularSelection — creando fallback');
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
                    console.error('[Cronos v8] Error creando jugadores fallback:', e2);
                }
            }

            document.body.classList.remove('setup-mode');
        };
    }
    patchGoToTitularSelection();

    function init() {
        startTimerObserver();
        patchSetupModeSelect();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();

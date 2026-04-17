// --- RENDER + CAMBIO GRUPAL ---

// ── Estado del cambio grupal ──
var groupSubMode = false;
var groupSelectedOut = {};   // { playerId: true } — titulares (campo → amarillo)
var groupSelectedIn  = {};   // { playerId: true } — suplentes (banquillo → verde)
var _skipNextClick = false; // true cuando touchEnd ya gestionó la selección

// ══════════════════════════════════════════════
//  BANNER DE ESTADO DEL MODO GRUPAL
// ══════════════════════════════════════════════
function updateGroupBanner() {
    var banner = document.getElementById('group-sub-banner');
    if (!groupSubMode) {
        if (banner) banner.remove();
        return;
    }
    var outCount = Object.keys(groupSelectedOut).length;
    var inCount  = Object.keys(groupSelectedIn).length;

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'group-sub-banner';
        banner.style.cssText =
            'position:fixed;top:0;left:0;right:0;z-index:99990;' +
            'background:linear-gradient(135deg,#1a5e2a,#0d3b1a);' +
            'color:#fff;text-align:center;padding:6px 10px;' +
            'font-size:0.75rem;font-weight:700;letter-spacing:0.03em;' +
            'display:flex;align-items:center;justify-content:center;gap:12px;' +
            'box-shadow:0 2px 10px rgba(0,0,0,0.5);';
        document.body.appendChild(banner);
    }

    var html = '<span style="color:#ffde59">GRUPAL</span>';
    html += '<span>Titulares: <b style="color:#ffde59">' + outCount + '</b></span>';
    html += '<span style="opacity:0.4">|</span>';
    html += '<span>Suplentes: <b style="color:#2ecc71">' + inCount + '</b></span>';

    if (outCount === inCount && outCount > 0) {
        html += '<span style="background:#2ecc71;color:#000;padding:2px 10px;border-radius:4px;font-size:0.7rem;">Pulsa EJECUTAR</span>';
    }
    banner.innerHTML = html;
}

// ══════════════════════════════════════════════
//  TOGGLE: 1er click activa, 2º click ejecuta
// ══════════════════════════════════════════════
function toggleGroupSubMode() {
    try {
        var btn = document.getElementById('btn-group-sub');

        // ── ACTIVAR modo selección ──
        if (!groupSubMode) {
            // 1) Feedback visual INMEDIATO
            if (btn) {
                btn.textContent = '✅ EJECUTAR';
                btn.classList.add('mode-group-active');
            }

            // 2) Limpiar cambio individual pendiente (inline, sin llamar a cancelPendingSubstitution)
            pendingSubstitution = null;
            pendingSubstituteEl = null;
            document.querySelectorAll('.player-chip').forEach(function(c) {
                c.classList.remove('sub-selected', 'sub-target');
            });
            var oldCancel = document.getElementById('btn-cancel-sub');
            if (oldCancel) oldCancel.remove();

            // 3) Activar estado
            groupSubMode = true;
            groupSelectedOut = {};
            groupSelectedIn  = {};
            _skipNextClick = false;

            // 4) Banner
            updateGroupBanner();

            // 5) Abrir banquillo en móvil
            try {
                var sidebar = document.querySelector('.sidebar');
                if (sidebar && !sidebar.classList.contains('open')) {
                    if (typeof toggleBench === 'function') toggleBench('home');
                }
            } catch(benchErr) {}

            return;
        }

        // ── 2º CLICK: Ejecutar o desactivar ──
        var outCount = Object.keys(groupSelectedOut).length;
        var inCount  = Object.keys(groupSelectedIn).length;

        if (outCount === 0 && inCount === 0) {
            exitGroupSubMode();
            return;
        }

        if (outCount !== inCount) {
            updateGroupBanner();
            try { showToast('Mismo numero de titulares y suplentes (' + outCount + ' vs ' + inCount + ')'); } catch(e) {}
            return;
        }

        if (outCount > 0) {
            executeGroupSubstitution();
        }
    } catch(err) {
        console.error('[GRUPAL] toggleGroupSubMode error:', err);
        exitGroupSubMode();
    }
}

// ── Ejecutar los cambios grupales ──
function executeGroupSubstitution() {
    try {
        var outKeys = Object.keys(groupSelectedOut);
        var inKeys  = Object.keys(groupSelectedIn);

        for (var i = 0; i < outKeys.length; i++) {
            var starter = players.find(function(p) { return p.id == outKeys[i]; });
            var sub     = players.find(function(p) { return p.id == inKeys[i]; });
            if (starter && sub) {
                var forcedSubId = 'C' + (i + 1);
                handleSmartSwap(sub, starter, null, null, forcedSubId);
            }
        }

        var count = outKeys.length;
        exitGroupSubMode();
        renderPlayers();
        try { if (typeof liveSyncOnAction === 'function') liveSyncOnAction(); } catch(e) {}
        try { showToast('Cambio grupal: ' + count + ' jugador(es) cambiado(s)'); } catch(e) {}
    } catch(err) {
        console.error('[GRUPAL] executeGroupSubstitution error:', err);
        exitGroupSubMode();
    }
}

// ── Salir del modo grupal ──
function exitGroupSubMode() {
    groupSubMode = false;
    groupSelectedOut = {};
    groupSelectedIn  = {};
    _skipNextClick = false;

    var btn = document.getElementById('btn-group-sub');
    if (btn) {
        btn.textContent = '🔄 GRUPAL';
        btn.classList.remove('mode-group-active');
    }

    document.querySelectorAll('.player-chip').forEach(function(c) {
        c.classList.remove('group-sub-out', 'group-sub-in');
    });

    updateGroupBanner();
}

// ── Seleccionar/deseleccionar jugador en modo grupal ──
function handleGroupSubClick(player) {
    try {
        var chip = document.getElementById('player-' + player.id);
        if (!chip) return;

        if (player.status === 'field') {
            if (groupSelectedOut[player.id]) {
                delete groupSelectedOut[player.id];
                chip.classList.remove('group-sub-out');
            } else {
                groupSelectedOut[player.id] = true;
                chip.classList.add('group-sub-out');
            }
        } else if (player.status === 'bench') {
            if (groupSelectedIn[player.id]) {
                delete groupSelectedIn[player.id];
                chip.classList.remove('group-sub-in');
            } else {
                groupSelectedIn[player.id] = true;
                chip.classList.add('group-sub-in');
            }
        }

        updateGroupBanner();
    } catch(err) {
        console.error('[GRUPAL] handleGroupSubClick error:', err);
    }
}

// ══════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════

function renderPlayers() {
    var pitch = document.getElementById('football-pitch');
    var benchHome = document.getElementById('bench-list');
    var benchAway = document.getElementById('bench-list-away');

    pitch.querySelectorAll('.player-chip').forEach(function(c) { c.remove(); });
    benchHome.innerHTML = '';
    benchAway.innerHTML = '';

    players.forEach(function(p) {
        var chip = createPlayerChip(p);
        if (p.status === 'field') {
            pitch.appendChild(chip);
            placeOnField(chip, p);
        } else {
            if (p.team === 'home') benchHome.appendChild(chip);
            else benchAway.appendChild(chip);
        }
    });

    sortBenchUI('home');
    if (typeof analyzeAway !== 'undefined' && analyzeAway) sortBenchUI('away');

    // Re-aplicar marcas visuales tras re-render
    if (groupSubMode) {
        Object.keys(groupSelectedOut).forEach(function(id) {
            var chip = document.getElementById('player-' + id);
            if (chip) chip.classList.add('group-sub-out');
        });
        Object.keys(groupSelectedIn).forEach(function(id) {
            var chip = document.getElementById('player-' + id);
            if (chip) chip.classList.add('group-sub-in');
        });
    }
}

function sortBenchUI(team) {
    var listId = team === 'home' ? 'bench-list' : 'bench-list-away';
    var list = document.getElementById(listId);
    if (!list) return;
    var chips = Array.from(list.children);
    players.filter(function(p) { return p.team === team && p.status === 'bench'; }).forEach(function(p, idx) {
        if (p.benchOrder === undefined) p.benchOrder = idx;
    });
    chips.sort(function(a, b) {
        var pA = players.find(function(p) { return 'player-' + p.id === a.id; });
        var pB = players.find(function(p) { return 'player-' + p.id === b.id; });
        return (pA && pA.benchOrder || 0) - (pB && pB.benchOrder || 0);
    });
    chips.forEach(function(chip) { list.appendChild(chip); });
}

function createPlayerChip(player) {
    var div = document.createElement('div');
    div.className = 'player-chip' + (player.cards === 'roja' ? ' expelled' : '');
    div.id = 'player-' + player.id;
    div.draggable = (player.cards !== 'roja' || player.status === 'field');
    div.style.background = 'linear-gradient(to bottom, ' + player.color + ' 50%, ' + player.shortsColor + ' 50%)';
    // touch-action: manipulation elimina el retardo de 300ms del click en móviles/tablets
    div.style.touchAction = 'manipulation';

    var indicatorsHTML = '';
    if (player.goals > 0)           indicatorsHTML += '<div class="player-goal-indicator">' + player.goals + ' ⚽</div>';
    if (player.cards === 'amarilla') indicatorsHTML += '<div class="player-card-indicator amarilla"></div>';
    else if (player.cards === 'roja') indicatorsHTML += '<div class="player-card-indicator roja"></div>';

    if (player.injured) {
        div.style.border = '3px solid #e74c3c';
        div.style.boxShadow = '0 0 10px rgba(231,76,60,0.9), 0 4px 6px rgba(0,0,0,0.3)';
    } else {
        div.style.border = '';
        div.style.boxShadow = '';
    }

    var injuredLabel = player.injured
        ? '<span style="color:#ff4040;font-weight:900;margin-left:2px;">✚</span>'
        : '';

    div.innerHTML =
        '<div class="player-timer ' + (player.status === 'field' ? 'timer-active' : 'timer-bench') + '">' + formatTime(player.time) + '</div>' +
        '<div class="player-number" style="color: ' + (player.textColor || '#ffffff') + '; pointer-events: none;">' + player.number + '</div>' +
        '<div class="player-name" style="pointer-events: none;">' + player.name + injuredLabel + '</div>' +
        indicatorsHTML;

    div.addEventListener('dragstart', function(e) {
        e.dataTransfer.setData('playerId', player.id);
        div.classList.add('dragging');
        if (typeof cancelPendingSubstitution === 'function') cancelPendingSubstitution();
        if (groupSubMode) exitGroupSubMode();
    });
    div.addEventListener('dragend', function() { div.classList.remove('dragging'); });
    div.addEventListener('touchstart', function(e) { handleTouchStart(e, player); }, { passive: false });
    div.addEventListener('touchmove',  function(e) { handleTouchMove(e, player); },  { passive: false });
    div.addEventListener('touchend',   function(e) { handleTouchEnd(e, player); },   { passive: false });

    var lastTap = 0;
    var tapTimer = null;

    // ── CLICK: funciona en PC y como respaldo en móvil ──
    div.addEventListener('click', function(e) {
        // Si touchEnd ya gestionó este tap, saltar (evita doble ejecución en tablets)
        if (_skipNextClick) {
            _skipNextClick = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (div.classList.contains('dragging')) return;
        if (player.cards === 'roja' && player.status === 'bench') return;
        e.stopPropagation();

        // ── MODO GRUPAL: manejar INMEDIATAMENTE ──
        if (groupSubMode) {
            handleGroupSubClick(player);
            return;
        }

        // ── FLUJO NORMAL (con detección doble click para abrir modal) ──
        var currentTime = new Date().getTime();
        var tapLength = currentTime - lastTap;
        lastTap = currentTime;
        if (tapLength < 400 && tapLength > 0) {
            e.preventDefault();
            clearTimeout(tapTimer);
            lastTap = 0;
            openPlayerActionModal(player);
            return;
        }
        tapTimer = setTimeout(function() {
            if (groupSubMode) {
                handleGroupSubClick(player);
            } else {
                if (player.status === 'bench') selectForSubstitution(player);
                else if (player.status === 'field' && pendingSubstitution) confirmSubstitutionWith(player);
            }
        }, 200);
    });

    div.addEventListener('dblclick', function(e) {
        e.stopPropagation(); e.preventDefault();
        lastTap = 0; clearTimeout(tapTimer);
        openPlayerActionModal(player);
    });

    return div;
}

// ══════════════════════════════════════════════
//  TOUCH HANDLERS
// ══════════════════════════════════════════════

var touchData = { draggedPlayerId: null, hasMoved: false, clone: null };
var lastTouchTime = 0;

function handleTouchStart(e, player) {
    var now = new Date().getTime();
    var timeSince = now - lastTouchTime;
    if (timeSince < 400 && timeSince > 0) {
        e.preventDefault(); e.stopPropagation();
        lastTouchTime = 0;
        touchData.draggedPlayerId = null;
        openPlayerActionModal(player);
        return;
    }
    lastTouchTime = now;
    touchData.draggedPlayerId = player.id;
    touchData.hasMoved = false;

    // En modo grupal: NO crear clon visual (es solo selección por tap)
    if (groupSubMode) return;

    // Crear CLON visual para arrastre normal
    var original = document.getElementById('player-' + player.id);
    var clone = original.cloneNode(true);
    clone.id = 'drag-clone-' + player.id;
    clone.style.position = 'fixed';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '9999';
    clone.style.opacity = '0.85';
    clone.style.transform = 'translate(-50%, -50%) scale(1.15)';
    clone.style.transition = 'none';
    var rect = original.getBoundingClientRect();
    clone.style.left = (rect.left + rect.width / 2) + 'px';
    clone.style.top  = (rect.top + rect.height / 2) + 'px';
    document.body.appendChild(clone);
    touchData.clone = clone;
    original.style.opacity = '0.3';
}

function handleTouchMove(e, player) {
    if (!touchData.draggedPlayerId) return;
    if (e.cancelable) e.preventDefault();
    touchData.hasMoved = true;
    if (touchData.clone) {
        var touch = e.touches[0];
        touchData.clone.style.left = touch.clientX + 'px';
        touchData.clone.style.top  = touch.clientY + 'px';
    }
}

function handleTouchEnd(e, player) {
    if (!touchData.draggedPlayerId) return;

    // Limpiar clon
    if (touchData.clone) { touchData.clone.remove(); touchData.clone = null; }
    var original = document.getElementById('player-' + player.id);
    if (original) original.style.opacity = '';

    // ════════════════════════════════════════════
    // MODO GRUPAL: seleccionar DIRECTAMENTE desde touchEnd
    // Luego bloquear el click sintético del navegador
    // ════════════════════════════════════════════
    if (groupSubMode && !touchData.hasMoved) {
        handleGroupSubClick(player);
        _skipNextClick = true; // bloquear el click que el navegador disparará después
        touchData.draggedPlayerId = null;
        touchData.hasMoved = false;
        return;
    }

    // ── FLUJO NORMAL: drag & drop ──
    var touch = e.changedTouches[0];
    var clientX = touch.clientX;
    var clientY = touch.clientY;

    var pitchRect = document.getElementById('football-pitch').getBoundingClientRect();
    var homeBenchRect = document.querySelector('.sidebar').getBoundingClientRect();
    var awayBenchEl = document.querySelector('.sidebar-right');
    var awayBenchRect = awayBenchEl ? awayBenchEl.getBoundingClientRect() : null;
    var margin = player.cards === 'roja' ? 80 : 0;

    var isInside = function(rect, x, y) { return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom; };

    if (isInside(pitchRect, clientX, clientY)) {
        dropToField({ preventDefault: function(){}, clientX: clientX, clientY: clientY, dataTransfer: { getData: function() { return player.id; } } });
    } else if (clientX < homeBenchRect.right + margin) {
        dropToBench({ preventDefault: function(){}, clientX: clientX, clientY: clientY, dataTransfer: { getData: function() { return player.id; } } });
    } else if (awayBenchRect && clientX > awayBenchRect.left - margin) {
        dropToAwayBench({ preventDefault: function(){}, clientX: clientX, clientY: clientY, dataTransfer: { getData: function() { return player.id; } } });
    } else {
        renderPlayers();
    }
    touchData.draggedPlayerId = null;
    touchData.hasMoved = false;
}

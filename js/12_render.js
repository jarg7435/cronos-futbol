// --- RENDER ---

// ══════════════════════════════════════════════
//  ESTADO DEL CAMBIO GRUPAL (con aislamiento por equipo)
// ══════════════════════════════════════════════
let groupSubMode = false;
let groupSubTeam = null;  // 'home' o 'away' — equipo activo en modo grupal
let groupSelectedOut = new Set();   // IDs de titulares seleccionados (salen)
let groupSelectedIn  = new Set();   // IDs de suplentes seleccionados (entran)

// ── TOGGLE MODO GRUPAL (acepta 'home' o 'away') ────────────────────
function toggleGroupSubMode(team) {
    const btnId = team === 'away' ? 'btn-group-sub-away' : 'btn-group-sub';
    const btn = document.getElementById(btnId);
    if (!btn) return;

    // ── Si ya estamos en modo grupal para ESTE equipo ──
    if (groupSubMode && groupSubTeam === team) {
        // Si hay jugadores seleccionados en ambos lados → EJECUTAR
        if (groupSelectedOut.size > 0 && groupSelectedIn.size > 0) {
            executeGroupSubstitution(team);
            return;
        }
        // Si no hay selecciones → desactivar
        clearGroupSubSelection();
        groupSubMode = false;
        groupSubTeam = null;
        btn.textContent = '\u{1F504} GRUPAL';
        btn.classList.remove('mode-group-active');
        return;
    }

    // ── Si ya estaba activo para OTRO equipo → desactivar el otro ──
    if (groupSubMode && groupSubTeam && groupSubTeam !== team) {
        const otherBtnId = groupSubTeam === 'away' ? 'btn-group-sub-away' : 'btn-group-sub';
        const otherBtn = document.getElementById(otherBtnId);
        if (otherBtn) {
            otherBtn.textContent = '\u{1F504} GRUPAL';
            otherBtn.classList.remove('mode-group-active');
        }
        clearGroupSubSelection();
    }

    // ── Activar modo grupal para ESTE equipo ──
    groupSubMode = true;
    groupSubTeam = team;
    btn.textContent = '\u{1F504} GRUPAL';
    btn.classList.add('mode-group-active');

    // Limpiar cualquier sustitución individual pendiente
    pendingSubstitution = null;
    const highlight = document.querySelector('.sub-highlight');
    if (highlight) highlight.classList.remove('sub-highlight');
}

// ── CLICK EN JUGADOR DENTRO DEL MODO GRUPAL ────────────────────────
function handleGroupSubClick(player) {
    if (!groupSubMode || !groupSubTeam) return;

    // AISLAMIENTO POR EQUIPO: solo afecta jugadores del equipo activo
    if (player.team !== groupSubTeam) return;

    const el = document.getElementById('player-' + player.id);
    if (!el) return;

    if (player.status === 'field') {
        // Titular → marcar como SALIENTE
        if (groupSelectedOut.has(player.id)) {
            groupSelectedOut.delete(player.id);
            el.classList.remove('group-sub-out');
        } else {
            groupSelectedOut.add(player.id);
            el.classList.add('group-sub-out');
            if (navigator.vibrate) navigator.vibrate(30);
        }
    } else if (player.status === 'bench') {
        // Suplente → marcar como ENTRANTE
        if (groupSelectedIn.has(player.id)) {
            groupSelectedIn.delete(player.id);
            el.classList.remove('group-sub-in');
        } else {
            groupSelectedIn.add(player.id);
            el.classList.add('group-sub-in');
            if (navigator.vibrate) navigator.vibrate(30);
        }
    }

    // Actualizar texto del botón según selecciones
    const btnId = groupSubTeam === 'away' ? 'btn-group-sub-away' : 'btn-group-sub';
    const btn = document.getElementById(btnId);
    if (btn && groupSubMode) {
        const outCount = groupSelectedOut.size;
        const inCount = groupSelectedIn.size;
        if (outCount > 0 || inCount > 0) {
            btn.textContent = '\u2705 EJECUTAR (' + outCount + '\u2192' + inCount + ')';
        } else {
            btn.textContent = '\u{1F504} GRUPAL';
        }
    }
}

// ── EJECUTAR CAMBIO GRUPAL ────────────────────────────────────────
function executeGroupSubstitution(team) {
    const outArr = Array.from(groupSelectedOut);
    const inArr  = Array.from(groupSelectedIn);
    const count = Math.min(outArr.length, inArr.length);

    if (count === 0) {
        clearGroupSubSelection();
        groupSubMode = false;
        groupSubTeam = null;
        const btnId = team === 'away' ? 'btn-group-sub-away' : 'btn-group-sub';
        const btn = document.getElementById(btnId);
        if (btn) { btn.textContent = '\u{1F504} GRUPAL'; btn.classList.remove('mode-group-active'); }
        return;
    }

    for (let i = 0; i < count; i++) {
        const outPlayer = players.find(p => p.id === outArr[i]);
        const inPlayer  = players.find(p => p.id === inArr[i]);
        if (outPlayer && inPlayer) {
            const forcedSubId = 'C' + (i + 1);
            handleSmartSwap(outPlayer, inPlayer, forcedSubId);
        }
    }

    // Limpiar estado
    clearGroupSubSelection();
    groupSubMode = false;
    groupSubTeam = null;
    const btnId = team === 'away' ? 'btn-group-sub-away' : 'btn-group-sub';
    const btn = document.getElementById(btnId);
    if (btn) { btn.textContent = '\u{1F504} GRUPAL'; btn.classList.remove('mode-group-active'); }
    renderPlayers();
}

function clearGroupSubSelection() {
    groupSelectedOut.forEach(id => {
        const el = document.getElementById('player-' + id);
        if (el) el.classList.remove('group-sub-out');
    });
    groupSelectedIn.forEach(id => {
        const el = document.getElementById('player-' + id);
        if (el) el.classList.remove('group-sub-in');
    });
    groupSelectedOut.clear();
    groupSelectedIn.clear();
}

function reapplyGroupSubMarks() {
    groupSelectedOut.forEach(id => {
        const el = document.getElementById('player-' + id);
        if (el) el.classList.add('group-sub-out');
    });
    groupSelectedIn.forEach(id => {
        const el = document.getElementById('player-' + id);
        if (el) el.classList.add('group-sub-in');
    });
}

function renderPlayers() {
    const pitch = document.getElementById('football-pitch');
    const benchHome = document.getElementById('bench-list');
    const benchAway = document.getElementById('bench-list-away');

    pitch.querySelectorAll('.player-chip').forEach(c => c.remove());
    benchHome.innerHTML = '';
    benchAway.innerHTML = '';

    players.forEach(p => {
        const chip = createPlayerChip(p);
        if (p.status === 'field') {
            pitch.appendChild(chip);
            placeOnField(chip, p);
        } else {
            if (p.team === 'home') benchHome.appendChild(chip);
            else benchAway.appendChild(chip);
        }
    });

    sortBenchUI('home');
    if (analyzeAway) sortBenchUI('away');

    // Re-renderizar la tarjeta del cuerpo técnico después de limpiar el bench
    if (typeof renderStaffInBench === 'function') {
        renderStaffInBench();
    }

    // Re-aplicar marcas visuales del modo grupal después de re-renderizar
    if (groupSubMode) reapplyGroupSubMarks();
}

function sortBenchUI(team) {
    const listId = team === 'home' ? 'bench-list' : 'bench-list-away';
    const list = document.getElementById(listId);
    if (!list) return;
    const chips = Array.from(list.children);
    players.filter(p => p.team === team && p.status === 'bench').forEach((p, idx) => {
        if (p.benchOrder === undefined) p.benchOrder = idx;
    });
    chips.sort((a, b) => {
        const pA = players.find(p => `player-${p.id}` === a.id);
        const pB = players.find(p => `player-${p.id}` === b.id);
        return (pA?.benchOrder || 0) - (pB?.benchOrder || 0);
    });
    chips.forEach(chip => list.appendChild(chip));
}

function createPlayerChip(player) {
    const div = document.createElement('div');
    div.className = 'player-chip' + (player.cards === 'roja' ? ' expelled' : '');
    div.id = `player-${player.id}`;
    div.draggable = (player.cards !== 'roja' || player.status === 'field');
    div.style.background = `linear-gradient(to bottom, ${player.color} 50%, ${player.shortsColor} 50%)`;

    let indicatorsHTML = '';
    if (player.goals > 0)           indicatorsHTML += `<div class="player-goal-indicator">${player.goals} \u26BD</div>`;
    if (player.cards === 'amarilla') indicatorsHTML += `<div class="player-card-indicator amarilla"></div>`;
    else if (player.cards === 'roja') indicatorsHTML += `<div class="player-card-indicator roja"></div>`;

    // Lesión: borde rojo en chip + ✚ en la etiqueta del nombre
    if (player.injured) {
        div.style.border = '3px solid #e74c3c';
        div.style.boxShadow = '0 0 10px rgba(231,76,60,0.9), 0 4px 6px rgba(0,0,0,0.3)';
    } else {
        div.style.border = '';
        div.style.boxShadow = '';
    }

    const injuredLabel = player.injured
        ? `<span style="color:#ff4040;font-weight:900;margin-left:2px;">\u271A</span>`
        : '';

    // Sanitizar nombre del jugador para prevenir XSS
    const safeName = typeof escapeHtml === 'function' ? escapeHtml(player.name) : player.name;
    const safeNumber = typeof escapeHtml === 'function' ? escapeHtml(String(player.number)) : player.number;

    div.innerHTML = `
        <div class="player-timer ${player.status === 'field' ? 'timer-active' : 'timer-bench'}">${formatTime(player.time)}</div>
        <div class="player-number" style="color: ${player.textColor || '#ffffff'}; pointer-events: none;">${safeNumber}</div>
        <div class="player-name" style="pointer-events: none;">${safeName}${injuredLabel}</div>
        ${indicatorsHTML}
    `;

    div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('playerId', player.id);
        div.classList.add('dragging');
        cancelPendingSubstitution();
    });
    div.addEventListener('dragend', () => div.classList.remove('dragging'));
    div.addEventListener('touchstart', (e) => handleTouchStart(e, player), { passive: false });
    div.addEventListener('touchmove',  (e) => handleTouchMove(e, player),  { passive: false });
    div.addEventListener('touchend',   (e) => handleTouchEnd(e, player),   { passive: false });
    div.style.touchAction = 'manipulation';

    let lastTap = 0;
    let tapTimer = null;
    let _skipNextClick = false;

    div.addEventListener('click', (e) => {
        if (_skipNextClick) { _skipNextClick = false; return; }
        if (div.classList.contains('dragging')) return;
        if (player.cards === 'roja' && player.status === 'bench') return;
        e.stopPropagation();

        // ── MODO GRUPAL: prioridad máxima ──
        if (groupSubMode) {
            handleGroupSubClick(player);
            return;
        }

        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        lastTap = currentTime;
        if (tapLength < 400 && tapLength > 0) {
            e.preventDefault();
            clearTimeout(tapTimer);
            lastTap = 0;
            openPlayerActionModal(player);
            return;
        }
        tapTimer = setTimeout(() => {
            if (player.status === 'bench') selectForSubstitution(player);
            else if (player.status === 'field' && pendingSubstitution) confirmSubstitutionWith(player);
        }, 450);
    });

    div.addEventListener('dblclick', (e) => {
        e.stopPropagation(); e.preventDefault();
        lastTap = 0; clearTimeout(tapTimer);
        openPlayerActionModal(player);
    });

    return div;
}

// touchData y lastTouchTime ya declarados en app.js — NO redeclarar con let
touchData = { draggedPlayerId: null, hasMoved: false, clone: null };
lastTouchTime = 0;

function handleTouchStart(e, player) {
    const now = new Date().getTime();
    const timeSince = now - lastTouchTime;
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

    // Crear CLON visual para el arrastre
    const original = document.getElementById(`player-${player.id}`);
    const clone = original.cloneNode(true);
    clone.id = `drag-clone-${player.id}`;
    clone.style.position = 'fixed';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '9999';
    clone.style.opacity = '0.85';
    clone.style.transform = 'translate(-50%, -50%) scale(1.15)';
    clone.style.transition = 'none';
    const rect = original.getBoundingClientRect();
    clone.style.left = `${rect.left + rect.width / 2}px`;
    clone.style.top  = `${rect.top  + rect.height / 2}px`;
    document.body.appendChild(clone);
    touchData.clone = clone;

    // Atenuar la ficha original
    original.style.opacity = '0.3';
}

function handleTouchMove(e, player) {
    if (!touchData.draggedPlayerId) return;
    if (e.cancelable) e.preventDefault();
    touchData.hasMoved = true;
    const touch = e.touches[0];
    if (touchData.clone) {
        touchData.clone.style.left = `${touch.clientX}px`;
        touchData.clone.style.top  = `${touch.clientY}px`;
    }
}

function handleTouchEnd(e, player) {
    if (!touchData.draggedPlayerId) return;

    // Eliminar el clon y restaurar opacidad de la ficha original
    if (touchData.clone) {
        touchData.clone.remove();
        touchData.clone = null;
    }
    const original = document.getElementById(`player-${player.id}`);
    if (original) original.style.opacity = '';

    // ── Si NO se movió → es un toque, NO arrastre ──
    if (!touchData.hasMoved) {
        touchData.draggedPlayerId = null;
        touchData.hasMoved = false;
        // El click (o handleGroupSubClick) se encargará
        return;
    }

    const touch = e.changedTouches[0];
    const clientX = touch.clientX;
    const clientY = touch.clientY;

    const pitchRect = document.getElementById('football-pitch').getBoundingClientRect();
    const homeBenchRect = document.querySelector('.sidebar').getBoundingClientRect();
    const awayBenchEl = document.querySelector('.sidebar-right');
    const awayBenchRect = awayBenchEl ? awayBenchEl.getBoundingClientRect() : null;
    const margin = player.cards === 'roja' ? 80 : 0;

    const isInside = (rect, x, y) => rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

    if (isInside(pitchRect, clientX, clientY)) {
        dropToField({ preventDefault: () => {}, clientX, clientY, dataTransfer: { getData: () => player.id } });
    } else if (clientX < homeBenchRect.right + margin) {
        dropToBench({ preventDefault: () => {}, clientX, clientY, dataTransfer: { getData: () => player.id } });
    } else if (awayBenchRect && clientX > awayBenchRect.left - margin) {
        dropToAwayBench({ preventDefault: () => {}, clientX, clientY, dataTransfer: { getData: () => player.id } });
    } else {
        renderPlayers();
    }
    touchData.draggedPlayerId = null;
    touchData.hasMoved = false;
}

// ══════════════════════════════════════════════
//  ATTACH LISTENERS A LOS BOTONES GRUPAL (touch + click)
// ══════════════════════════════════════════════
function attachGroupSubBtnEvents(btnId, team) {
    function tryAttach() {
        var btn = document.getElementById(btnId);
        if (!btn) { setTimeout(tryAttach, 300); return; }

        // Evitar doble ejecución en dispositivos táctiles
        var touchFired = false;

        btn.addEventListener('touchstart', function() {
            touchFired = true;
        }, { passive: true });

        btn.addEventListener('touchend', function(e) {
            if (touchFired) {
                e.preventDefault(); // bloquear click sintético
                touchFired = false;
                toggleGroupSubMode(team);
            }
        }, { passive: false });

        btn.addEventListener('click', function(e) {
            if (touchFired) {
                touchFired = false;
                return;
            }
            toggleGroupSubMode(team);
        });

        // Quitar el onclick del HTML para evitar triple ejecución
        btn.removeAttribute('onclick');
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryAttach);
    } else {
        tryAttach();
    }
}

// GRUPAL LOCAL (siempre disponible)
attachGroupSubBtnEvents('btn-group-sub', 'home');

// GRUPAL VISITANTE: solo attach si existe el botón (modo ambos equipos)
(function() {
    function checkAwayBtn() {
        var btn = document.getElementById('btn-group-sub-away');
        if (btn) {
            attachGroupSubBtnEvents('btn-group-sub-away', 'away');
        } else {
            setTimeout(checkAwayBtn, 500);
        }
    }
    checkAwayBtn();
})();

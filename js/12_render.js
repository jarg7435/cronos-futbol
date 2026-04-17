// --- RENDER + CAMBIO GRUPAL ---

// ── Estado del cambio grupal ──
let groupSubMode = false;          // true = modo selección activo
let groupSelectedOut = new Set();   // IDs de titulares seleccionados (campo → amarillo)
let groupSelectedIn  = new Set();   // IDs de suplentes seleccionados (banquillo → verde)

// ── Toggle: 1er click activa modo, 2º click ejecuta ──
function toggleGroupSubMode() {
    const btn = document.getElementById('btn-group-sub');
    if (!btn) return;

    if (!groupSubMode) {
        // ── ACTIVAR modo selección ──
        cancelPendingSubstitution();  // limpiar cambio individual pendiente
        groupSubMode = true;
        groupSelectedOut.clear();
        groupSelectedIn.clear();

        // Cambiar apariencia del botón a "EJECUTAR"
        btn.textContent = '✅ EJECUTAR';
        btn.classList.add('mode-group-active');

        // Abrir el banquillo si está cerrado (móvil)
        closeDrawers();
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && !sidebar.classList.contains('open')) {
            if (typeof toggleBench === 'function') toggleBench('home');
        }

        showToast('Cambio grupal: selecciona titulares (campo) y suplentes (banquillo)');
    } else {
        // ── 2º CLICK: Intentar ejecutar ──
        if (groupSelectedOut.size === 0 && groupSelectedIn.size === 0) {
            // No seleccionó nada → simplemente desactivar
            exitGroupSubMode();
            return;
        }

        if (groupSelectedOut.size !== groupSelectedIn.size) {
            showToast(`Selecciona ${groupSelectedOut.size} suplente(s) del banquillo o ${groupSelectedIn.size} titular(es) más del campo`);
            return;
        }

        if (groupSelectedOut.size === groupSelectedIn.size && groupSelectedOut.size > 0) {
            executeGroupSubstitution();
        }
    }
}

// ── Ejecutar los cambios grupales ──
function executeGroupSubstitution() {
    const outArr = Array.from(groupSelectedOut);
    const inArr  = Array.from(groupSelectedIn);

    // Emparejar por orden de selección (1º titular con 1º suplente, etc.)
    for (let i = 0; i < outArr.length; i++) {
        const starter  = players.find(p => p.id === outArr[i]);
        const sub      = players.find(p => p.id === inArr[i]);
        if (starter && sub) {
            // forcedSubId único por par para distinguir en CSV (#C1, #C2, ...)
            const forcedSubId = 'C' + (i + 1);
            handleSmartSwap(sub, starter, null, null, forcedSubId);
        }
    }

    // Salir del modo grupal
    exitGroupSubMode();
    renderPlayers();
    if (typeof liveSyncOnAction === 'function') liveSyncOnAction();
    showToast(`Cambio grupal realizado: ${outArr.length} jugador(es) cambiado(s)`);
}

// ── Salir del modo grupal y limpiar ──
function exitGroupSubMode() {
    groupSubMode = false;
    groupSelectedOut.clear();
    groupSelectedIn.clear();

    // Restaurar botón
    const btn = document.getElementById('btn-group-sub');
    if (btn) {
        btn.textContent = '🔄 GRUPAL';
        btn.classList.remove('mode-group-active');
    }

    // Quitar marcas visuales
    document.querySelectorAll('.player-chip').forEach(c => {
        c.classList.remove('group-sub-out', 'group-sub-in');
    });
}

// ── Click en jugador en modo grupal ──
function handleGroupSubClick(player) {
    const chip = document.getElementById(`player-${player.id}`);
    if (!chip) return;

    if (player.status === 'field') {
        // Toggle titular (amarillo)
        if (groupSelectedOut.has(player.id)) {
            groupSelectedOut.delete(player.id);
            chip.classList.remove('group-sub-out');
        } else {
            groupSelectedOut.add(player.id);
            chip.classList.add('group-sub-out');
        }
    } else if (player.status === 'bench') {
        // Toggle suplente (verde)
        if (groupSelectedIn.has(player.id)) {
            groupSelectedIn.delete(player.id);
            chip.classList.remove('group-sub-in');
        } else {
            groupSelectedIn.add(player.id);
            chip.classList.add('group-sub-in');
        }
    }
}

// ── Mostrar toast informativo ──
function showToast(msg) {
    // Reutilizar toast existente o crear uno
    let toast = document.getElementById('toast-msg');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-msg';
        toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.88);color:#fff;padding:10px 20px;border-radius:8px;font-size:0.8rem;z-index:99999;text-align:center;pointer-events:none;transition:opacity 0.3s;max-width:85vw;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ──────────────────────────────────────────
// ── RENDER (original) ──
// ──────────────────────────────────────────

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
    if (player.goals > 0)           indicatorsHTML += `<div class="player-goal-indicator">${player.goals} ⚽</div>`;
    if (player.cards === 'amarilla') indicatorsHTML += `<div class="player-card-indicator amarilla"></div>`;
    else if (player.cards === 'roja') indicatorsHTML += `<div class="player-card-indicator roja"></div>`;

    // Lesión: borde rojo en chip + ✚ en la etiqueta del nombre (siempre visible)
    if (player.injured) {
        div.style.border = '3px solid #e74c3c';
        div.style.boxShadow = '0 0 10px rgba(231,76,60,0.9), 0 4px 6px rgba(0,0,0,0.3)';
    } else {
        div.style.border = '';
        div.style.boxShadow = '';
    }

    const injuredLabel = player.injured
        ? `<span style="color:#ff4040;font-weight:900;margin-left:2px;">✚</span>`
        : '';

    div.innerHTML = `
        <div class="player-timer ${player.status === 'field' ? 'timer-active' : 'timer-bench'}">${formatTime(player.time)}</div>
        <div class="player-number" style="color: ${player.textColor || '#ffffff'}; pointer-events: none;">${player.number}</div>
        <div class="player-name" style="pointer-events: none;">${player.name}${injuredLabel}</div>
        ${indicatorsHTML}
    `;

    div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('playerId', player.id);
        div.classList.add('dragging');
        cancelPendingSubstitution();
        if (groupSubMode) exitGroupSubMode(); // cancelar modo grupal al arrastrar
    });
    div.addEventListener('dragend', () => div.classList.remove('dragging'));
    div.addEventListener('touchstart', (e) => handleTouchStart(e, player), { passive: false });
    div.addEventListener('touchmove',  (e) => handleTouchMove(e, player),  { passive: false });
    div.addEventListener('touchend',   (e) => handleTouchEnd(e, player),   { passive: false });

    let lastTap = 0;
    let tapTimer = null;

    div.addEventListener('click', (e) => {
        if (div.classList.contains('dragging')) return;
        if (player.cards === 'roja' && player.status === 'bench') return;
        e.stopPropagation();
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
            // ── Si estamos en modo grupal, usar la lógica grupal ──
            if (groupSubMode) {
                handleGroupSubClick(player);
                return;
            }
            // ── Flujo normal de cambio individual ──
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

let touchData = { draggedPlayerId: null, hasMoved: false, clone: null };
let lastTouchTime = 0;

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

    // Crear CLON visual para el arrastre — la ficha original queda en su sitio
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

    // Atenuar la ficha original para indicar que se está moviendo
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

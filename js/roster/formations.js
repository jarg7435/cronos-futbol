// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — ROSTER/FORMATIONS  (function overrides)
// ══════════════════════════════════════════════════════════════════
// NOTE: FORMATION_PRESETS and FIELD_MARGIN are declared in app-init.js
// which loads BEFORE this file. They must NOT be re-declared here or
// a SyntaxError ("Identifier has already been declared") will block
// ALL JavaScript execution.
//
// This file ONLY contains updated function overrides that replace
// the versions defined in app-init.js:
//   • clampToField          — bounds-clamping using FIELD_MARGIN
//   • updateFormationOptions — populates <select> with forcedMode param
//   • updateCategoryOptions  — populates category <select> (new)
//   • applyFormationPreset   — applies preset with titularOrder sort + DOM updates
// ══════════════════════════════════════════════════════════════════

function clampToField(x, y) {
    return {
        x: Math.max(FIELD_MARGIN.minX, Math.min(FIELD_MARGIN.maxX, x)),
        y: Math.max(FIELD_MARGIN.minY, Math.min(FIELD_MARGIN.maxY, y)),
    };
}

// Actualiza el <select> de formación según la modalidad elegida
function updateFormationOptions(forcedMode) {
    const mode = (forcedMode !== undefined && forcedMode) ? forcedMode
                : (document.getElementById('setup-mode')?.value || 'f7');
    const sel  = document.getElementById('setup-formation');
    if (!sel) return;
    const presets = FORMATION_PRESETS[mode];
    if (!presets) return;
    sel.innerHTML = '<option value="">-- Sin formación predefinida --</option>';
    Object.entries(presets).forEach(([key, val]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = val.label;
        sel.appendChild(opt);
    });
    // Pasar el modo EXPLÍCITAMENTE para evitar cualquier lectura stale del DOM
    updateCategoryOptions(mode);
}

function updateCategoryOptions(forcedMode) {
    // Siempre usar forcedMode si se proporciona; si no, leer del DOM
    const mode = (forcedMode !== undefined && forcedMode) ? forcedMode
                : (document.getElementById('setup-mode')?.value || 'f7');
    const sel = document.getElementById('match-category');
    if (!sel) return; // El select existe solo en ciertos modales — no es un error

    sel.innerHTML = '';
    if (mode === 'f7') {
        sel.innerHTML = `
            <option value="f7_prebenjamin">Prebenjamín (2T x 30')</option>
            <option value="f7_benjamin">Benjamín (2T x 35')</option>
            <option value="f7_alevin">Alevín (2T x 35')</option>
        `;
    } else {
        sel.innerHTML = `
            <option value="f11_infantil">Infantil (2T x 40')</option>
            <option value="f11_cadete">Cadete (2T x 40')</option>
            <option value="f11_juvenil">Juvenil (2T x 45')</option>
            <option value="f11_regional">Regional (2T x 45')</option>
        `;
    }
    // NO dispatchEvent — elimina bucles y efectos secundarios indeseados
}

// --- APLICAR FORMACIÓN ---
function applyFormationPreset(key) {
    console.log('[FORMACIÓN] applyFormationPreset called:', key,
        '| currentMode:', currentMode, '| analyzeAway:', analyzeAway,
        '| players count:', players.length);

    const presets = FORMATION_PRESETS[currentMode];
    if (!presets) { console.warn('[FORMACIÓN] No presets para modo:', currentMode); return; }
    if (!presets[key]) { console.warn('[FORMACIÓN] No preset para key:', key, '| disponibles:', Object.keys(presets)); return; }

    const preset = presets[key];
    const useFullField = !analyzeAway; // solo local → campo completo

    // CRÍTICO: Ordenar por selección para asignar posiciones correctas de la formación.
    // Sin esto, los jugadores se colocan en orden de adición al array, no por dorsal ni por selección.
    const sortedPlayers = [...players].sort((a, b) => {
        if (a.titularOrder !== undefined && b.titularOrder !== undefined) return a.titularOrder - b.titularOrder;
        return (a.number || 0) - (b.number || 0);
    });
    console.log('[FORMACIÓN] Jugadores ordenados por dorsal:',
        sortedPlayers.filter(p => p.status === 'field').map(p => `#${p.number} ${p.name} (${p.team})`).join(', '));

    let homeIdx = 0, awayIdx = 0;
    sortedPlayers.forEach(p => {
        if (p.status !== 'field') return;
        if (p.team === 'home') {
            const positions = useFullField ? preset.full : preset.home;
            if (positions[homeIdx]) {
                const pos = clampToField(positions[homeIdx].x, positions[homeIdx].y);
                p.x = pos.x; p.y = pos.y;
                console.log(`[FORMACIÓN] ${p.team} #${p.number} ${p.name} → pos[${homeIdx}] (${pos.x}, ${pos.y})`);
                homeIdx++;
            }
        } else if (p.team === 'away') {
            const positions = preset.away;
            if (positions && positions[awayIdx]) {
                const pos = clampToField(positions[awayIdx].x, positions[awayIdx].y);
                p.x = pos.x; p.y = pos.y;
                console.log(`[FORMACIÓN] ${p.team} #${p.number} ${p.name} → pos[${awayIdx}] (${pos.x}, ${pos.y})`);
                awayIdx++;
            }
        }
    });

    // Actualizar botones activos
    activeFormationKey = key;
    document.querySelectorAll('.formation-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fkey === key);
    });

    // ACTUALIZAR POSICIONES DIRECTAMENTE EN EL DOM (sin depender de renderPlayers)
    players.forEach(p => {
        if (p.status !== 'field') return;
        const chip = document.getElementById(`player-${p.id}`);
        if (chip) {
            chip.style.left = `${p.x}%`;
            chip.style.top = `${p.y}%`;
            chip.style.transform = 'translate(-50%, -50%)';
            console.log(`[FORMACIÓN] DOM actualizado: player-${p.id} → (${p.x}%, ${p.y}%)`);
        }
    });

    // Re-renderizar completo como respaldo
    renderPlayers();
    console.log('[FORMACIÓN] Completada. activeFormationKey:', activeFormationKey);
}

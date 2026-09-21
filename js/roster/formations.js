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

    // ════════════════════════════════════════════════════════════════
    //  ⏱️ v748 · LOS MINUTOS DE CADA OPCIÓN SALEN DE LA TABLA ÚNICA
    // ════════════════════════════════════════════════════════════════
    //  Este desplegable ANUNCIA la duración («Cadete (2T x 40')») y era otra
    //  de las siete copias de la tabla: escrita a mano, y con dos que ya no
    //  cuadraban con el cronómetro (Benjamín decía 35' y FUTureFEM 35').
    //  Un rótulo que promete 35 minutos y un reloj que cuenta 30 es peor que
    //  no poner el rótulo, así que ahora los dos salen del mismo sitio.
    //
    //  ⚠️ EL `value` NO CAMBIA. Es la clave con la que se identifica el equipo
    //  y con la que se guardaron los partidos de siempre; tocarla dejaría
    //  huérfano todo lo anterior. Lo único que se genera es la ETIQUETA.
    //  🚨 Y 'prebenjamín' conserva su tilde en el value, como hasta hoy: el
    //  respaldo por etiqueta lo busca así (ver el comentario de cache-bust).
    const CATS = [
        ['prebenjamín',  'Prebenjamín'],
        ['benjamin',     'Benjamín'],
        ['alevin',       'Alevín'],
        ['infantil',     'Infantil'],
        ['cadete',       'Cadete'],
        ['juvenil',      'Juvenil'],
        ['regional',     'Regional'],
        ['regional_fem', 'Regional FEM'],
        ['futurefem',    'FUTureFEM'],
        ['nacional',     'Nacional'],
    ];
    const _mins = (clave) => (typeof window.cronosTiemposCategoria === 'function')
        ? window.cronosTiemposCategoria(clave, mode).mitad
        : (mode === 'f11' ? 40 : 30);
    sel.innerHTML = CATS.map(([clave, etiqueta]) =>
        '<option value="' + mode + '_' + clave + '">' +
        etiqueta + " (2T x " + _mins(clave) + "')</option>"
    ).join('');
    // NO dispatchEvent — elimina bucles y efectos secundarios indeseados
}

// --- APLICAR FORMACIÓN ---
function applyFormationPreset(key) {

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

    // ══════════════════════════════════════════════════════════════
    //  🏠✈️ v707 · EL CAMPO ENTERO ES PARA MI EQUIPO, SEA LOCAL O VISITANTE
    // ══════════════════════════════════════════════════════════════
    //  `preset.full` son las posiciones para cuando NO se dibuja al contrario:
    //  el equipo se reparte por todo el campo. Estaba reservado a `p.team ===
    //  'home'`, así que un entrenador que juega FUERA sin analizar al rival
    //  veía a sus once apretados en media cancha, con la otra mitad vacía
    //  (capturas 10360/10361). Es el mismo «mi equipo == el local» que
    //  provocaba el resto de esta tanda.
    const _miLado = (typeof window.cronosMiLado === 'function')
        ? window.cronosMiLado()
        : ((window._userTeamRole === 'away') ? 'away' : 'home');
    let homeIdx = 0, awayIdx = 0;
    sortedPlayers.forEach(p => {
        if (p.status !== 'field') return;
        if (p.team !== 'home' && p.team !== 'away') return;
        // Con el campo entero manda `full`; con los dos equipos, el lado que
        // ocupa cada uno.
        const positions = (p.team === _miLado && useFullField) ? preset.full : preset[p.team];
        if (!positions) return;
        const idx = (p.team === 'home') ? homeIdx : awayIdx;
        if (positions[idx]) {
            const pos = clampToField(positions[idx].x, positions[idx].y);
            p.x = pos.x; p.y = pos.y;
            if (p.team === 'home') homeIdx++; else awayIdx++;
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
        }
    });

    // Re-renderizar completo como respaldo
    renderPlayers();
}

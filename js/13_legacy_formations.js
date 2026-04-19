// --- FORMACIONES HEREDADAS (para posicionamiento inicial si no se usa preset) ---
// NOTA: FORMATIONS y FORMATIONS_FULL ya están declarados en app.js como const.
// Este archivo solo sobreescribe placeOnField() con la versión que ordena por dorsal.
// NO redeclaramos const para evitar SyntaxError por redeclaración.

function placeOnField(chip, player) {
    if (player.x === 0 && player.y === 0) {
        // CRÍTICO: Ordenar por dorsal para que el portero (1) vaya a portería,
        // defensa (2,3) a línea defensiva, etc. Sin esto, el orden es arbitrario
        // según cómo se añadió cada jugador al array players.
        const fieldPlayers = players
            .filter(p => p.status === 'field' && p.team === player.team)
            .sort((a, b) => (a.number || 0) - (b.number || 0));
        const index = fieldPlayers.indexOf(player);
        const formationSet = (!analyzeAway && player.team === 'home') ? FORMATIONS_FULL : FORMATIONS;
        const formation = formationSet[currentMode]?.[player.team];
        if (formation && formation[index]) {
            const pos = clampToField(formation[index].x, formation[index].y);
            player.x = pos.x; player.y = pos.y;
        } else {
            player.x = 50; player.y = 50;
        }
    }
    chip.style.left = `${player.x}%`;
    chip.style.top = `${player.y}%`;
    chip.style.transform = `translate(-50%, -50%)`;
}

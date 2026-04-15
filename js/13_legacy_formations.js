// --- FORMACIONES HEREDADAS (para posicionamiento inicial si no se usa preset) ---
if (typeof FORMATIONS === "undefined") var FORMATIONS = {
    f7: {
        home: [
            {x:8,y:50}, {x:20,y:30},{x:20,y:70},
            {x:32,y:18},{x:30,y:50},{x:32,y:82}, {x:40,y:50}
        ],
        away: [
            {x:92,y:50}, {x:80,y:30},{x:80,y:70},
            {x:68,y:18},{x:70,y:50},{x:68,y:82}, {x:60,y:50}
        ]
    },
    f11: {
        home: [
            {x:6,y:50}, {x:16,y:15},{x:13,y:38},{x:13,y:62},{x:16,y:85},
            {x:26,y:20},{x:23,y:50},{x:26,y:80},
            {x:38,y:20},{x:40,y:50},{x:38,y:80}
        ],
        away: [
            {x:94,y:50}, {x:84,y:15},{x:87,y:38},{x:87,y:62},{x:84,y:85},
            {x:74,y:20},{x:77,y:50},{x:74,y:80},
            {x:62,y:20},{x:60,y:50},{x:62,y:80}
        ]
    }
};

if (typeof FORMATIONS_FULL === "undefined") var FORMATIONS_FULL = {
    f7: { home: [{x:5,y:50},{x:25,y:30},{x:25,y:70},{x:55,y:18},{x:50,y:50},{x:55,y:82},{x:85,y:50}] },
    f11: { home: [
        {x:5,y:50},{x:22,y:15},{x:18,y:38},{x:18,y:62},{x:22,y:85},
        {x:45,y:22},{x:42,y:50},{x:45,y:78},
        {x:75,y:20},{x:80,y:50},{x:75,y:80}
    ]}
};

function placeOnField(chip, player) {
    if (player.x === 0 && player.y === 0) {
        const fieldPlayers = players.filter(p => p.status === 'field' && p.team === player.team);
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

function updatePlayerUI(player) {
    const chip = document.getElementById(`player-${player.id}`);
    if (chip) {
        const timerDiv = chip.querySelector('.player-timer');
        if (timerDiv) timerDiv.textContent = formatTime(player.time);
    }
}


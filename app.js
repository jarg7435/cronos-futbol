// --- CONFIGURATION & STATE ---
let players = [];
let masterTime = 0; // seconds
let isRunning = false;
let timerInterval = null;
let currentMode = 'f7'; // f7 or f11

const COLORS = {
    primary: '#58a6ff',
    secondary: '#f0883e'
};

// --- CORE FUNCTIONS ---

function init() {
    setupEventListeners();
    openSetupModal();
    registerServiceWorker();
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('Cronos PWA Ready'))
            .catch(err => console.log('SW Error:', err));
    }
}

function openSetupModal() {
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content">
            <h2>Configuración del Encuentro</h2>
            <div class="form-group">
                <label>Nombre Equipo Local</label>
                <input type="text" id="setup-team-name" value="MIS CRONOS">
            </div>
            <div class="form-group">
                <label>Color Camiseta</label>
                <input type="color" id="setup-team-color" value="#58a6ff">
            </div>
            <div class="form-group">
                <label>Modalidad</label>
                <select id="setup-mode">
                    <option value="f7">Fútbol 7 (2 tiempos de 35 min)</option>
                    <option value="f11">Fútbol 11 (2 tiempos de 45 min)</option>
                </select>
            </div>
            <button class="btn primary" onclick="confirmSetup()">INICIAR PARTIDO</button>
        </div>
    `;
}

function confirmSetup() {
    const teamName = document.getElementById('setup-team-name').value;
    const teamColor = document.getElementById('setup-team-color').value;
    const mode = document.getElementById('setup-mode').value;

    document.getElementById('team-a-name').textContent = teamName.toUpperCase();
    COLORS.primary = teamColor;
    currentMode = mode;
    document.getElementById('match-mode').value = mode;

    spawnInitialPlayers();
    renderPlayers();
    document.getElementById('setup-modal').style.display = 'none';
}

function setupEventListeners() {
    document.getElementById('btn-play-pause').addEventListener('click', toggleGame);
    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('match-mode').addEventListener('change', (e) => {
        console.log("Changing mode to:", e.target.value);
        currentMode = e.target.value;
        resetGame();
    });

    // Hover feedback
    const dropZones = ['.sidebar', '.field-area'];
    dropZones.forEach(selector => {
        const el = document.querySelector(selector);
        el.addEventListener('dragenter', () => el.classList.add('drop-hover'));
        el.addEventListener('dragleave', (e) => {
            if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hover');
        });
        el.addEventListener('drop', () => el.classList.remove('drop-hover'));
    });
}

function spawnInitialPlayers() {
    // For prototype, we'll auto-generate some players
    // F7 = 7 Starters, 7 Subs per team. Total 14.
    // For simplicity, we'll manage 1 team (the directed team)
    const count = currentMode === 'f7' ? 14 : 18;
    const startersCount = currentMode === 'f7' ? 7 : 11;

    players = [];
    for (let i = 1; i <= count; i++) {
        players.push({
            id: i,
            number: i,
            name: `Jugador ${i}`,
            status: i <= startersCount ? 'field' : 'bench',
            time: 0,
            color: COLORS.primary,
            history: [],
            x: 0, y: 0 // field relative coords
        });
    }
}

function toggleGame() {
    isRunning = !isRunning;
    const btn = document.getElementById('btn-play-pause');

    if (isRunning) {
        btn.textContent = 'PAUSAR';
        btn.classList.add('danger');
        timerInterval = setInterval(tick, 1000);
    } else {
        btn.textContent = 'REANUDAR';
        btn.classList.remove('danger');
        clearInterval(timerInterval);
    }
}

function tick() {
    masterTime++;
    updateMasterUI();

    players.forEach(p => {
        if (p.status === 'field') {
            p.time++;
            updatePlayerUI(p);
        }
    });
}

function updateMasterUI() {
    document.getElementById('master-timer').textContent = formatTime(masterTime);
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- RENDER LOGIC ---

function renderPlayers() {
    const pitch = document.getElementById('football-pitch');
    const bench = document.getElementById('bench-list');

    pitch.innerHTML = `
        <div class="center-circle"></div>
        <div class="penalty-area top"></div>
        <div class="penalty-area bottom"></div>
        <div class="goal-area top"></div>
        <div class="goal-area bottom"></div>
    `;
    bench.innerHTML = '';

    players.forEach(p => {
        const chip = createPlayerChip(p);
        if (p.status === 'field') {
            pitch.appendChild(chip);
            placeOnField(chip, p);
        } else {
            bench.appendChild(chip);
            chip.style.position = 'static'; // Let grid/flex flow handle it
            chip.style.margin = 'auto';
        }
    });
}

function createPlayerChip(player) {
    const div = document.createElement('div');
    div.className = 'player-chip';
    div.id = `player-${player.id}`;
    div.draggable = true;
    div.style.backgroundColor = player.color;

    div.innerHTML = `
        <div class="player-timer ${player.status === 'field' ? 'timer-active' : 'timer-bench'}">${formatTime(player.time)}</div>
        <div class="player-number" onclick="editPlayerNumber(${player.id})">${player.number}</div>
        <div class="player-name" onclick="editPlayerName(${player.id})">${player.name}</div>
    `;

    div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('playerId', player.id);
        div.classList.add('dragging');
    });

    div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
    });

    // --- TOUCH EVENTS SUPPORT ---
    div.addEventListener('touchstart', (e) => handleTouchStart(e, player), { passive: false });
    div.addEventListener('touchmove', (e) => handleTouchMove(e, player), { passive: false });
    div.addEventListener('touchend', (e) => handleTouchEnd(e, player), { passive: false });

    return div;
}

let touchData = {
    draggedPlayerId: null,
    initialX: 0,
    initialY: 0
};

function handleTouchStart(e, player) {
    e.preventDefault();
    touchData.draggedPlayerId = player.id;
    const chip = document.getElementById(`player-${player.id}`);
    chip.classList.add('dragging');
}

function handleTouchMove(e, player) {
    if (!touchData.draggedPlayerId) return;
    e.preventDefault();

    const touch = e.touches[0];
    const chip = document.getElementById(`player-${player.id}`);
    const pitch = document.getElementById('football-pitch');
    const rect = pitch.getBoundingClientRect();

    // Visual move feedback during touch
    const x = ((touch.clientX - rect.left) / rect.width) * 100;
    const y = ((touch.clientY - rect.top) / rect.height) * 100;

    chip.style.left = `${x}%`;
    chip.style.top = `${y}%`;
    chip.style.transform = `translate(-50%, -50%)`;
}

function handleTouchEnd(e, player) {
    if (!touchData.draggedPlayerId) return;
    const chip = document.getElementById(`player-${player.id}`);
    chip.classList.remove('dragging');

    const touch = e.changedTouches[0];

    // Hide chip temporarily to detect what's underneath
    const originalDisplay = chip.style.display;
    chip.style.display = 'none';
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY) || document.body;
    chip.style.display = originalDisplay;

    // Create a fake event object to reuse drop logic
    const fakeEvent = {
        preventDefault: () => { },
        clientX: touch.clientX,
        clientY: touch.clientY,
        dataTransfer: {
            getData: () => player.id
        },
        target: targetEl
    };

    // Determine where it was dropped
    const pitch = document.getElementById('football-pitch');
    const sidebar = document.querySelector('.sidebar');

    if (pitch.contains(fakeEvent.target) || fakeEvent.target.closest('.pitch')) {
        dropToField(fakeEvent);
    } else if (sidebar.contains(fakeEvent.target) || fakeEvent.target.closest('.sidebar')) {
        dropToBench(fakeEvent);
    } else {
        renderPlayers(); // Reset visual
    }

    touchData.draggedPlayerId = null;
}

function editPlayerName(id) {
    const player = players.find(p => p.id === id);
    const newName = prompt(`Editar nombre para dorsal ${player.number}:`, player.name);
    if (newName !== null && newName.trim() !== "") {
        player.name = newName.trim();
        renderPlayers();
    }
}

function editPlayerNumber(id) {
    const player = players.find(p => p.id === id);
    const newNum = prompt(`Editar dorsal para ${player.name}:`, player.number);
    if (newNum !== null && !isNaN(newNum)) {
        player.number = newNum;
        renderPlayers();
    }
}

const FORMATIONS = {
    f7: [
        { x: 50, y: 88 }, // GK
        { x: 30, y: 70 }, { x: 70, y: 70 }, // DEF
        { x: 20, y: 45 }, { x: 50, y: 45 }, { x: 80, y: 45 }, // MID
        { x: 50, y: 15 }  // FWD
    ],
    f11: [
        { x: 50, y: 92 }, // GK
        { x: 15, y: 75 }, { x: 38, y: 78 }, { x: 62, y: 78 }, { x: 85, y: 75 }, // DEF
        { x: 30, y: 50 }, { x: 50, y: 55 }, { x: 70, y: 50 }, // MID
        { x: 20, y: 25 }, { x: 80, y: 25 }, { x: 50, y: 12 }  // FWD
    ]
};

function placeOnField(chip, player) {
    if (player.x === 0 && player.y === 0) {
        const fieldPlayers = players.filter(p => p.status === 'field');
        const index = fieldPlayers.indexOf(player);
        const formation = FORMATIONS[currentMode];

        if (formation && formation[index]) {
            player.x = formation[index].x;
            player.y = formation[index].y;
        } else {
            // Fallback grid
            player.x = 20 + (index % 3) * 30;
            player.y = 20 + Math.floor(index / 3) * 20;
        }
    }

    // Anchor calculation to center the chip on the point
    // We use px for the offset to keep it centered regardless of scale
    chip.style.left = `${player.x}%`;
    chip.style.top = `${player.y}%`;
    chip.style.transform = `translate(-50%, -50%)`;
}

function updatePlayerUI(player) {
    const chip = document.getElementById(`player-${player.id}`);
    if (chip) {
        const timerDiv = chip.querySelector('.player-timer');
        timerDiv.textContent = formatTime(player.time);
    }
}

// --- DRAG & DROP LOGIC (SMART SWAP) ---

function allowDrop(e) {
    e.preventDefault();
}

function dropToField(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId');
    const player = players.find(p => p.id == playerId);
    if (!player) return;

    const pitch = document.getElementById('football-pitch');
    const rect = pitch.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;

    // Detect target underneath without pointer-events: none
    const draggedChip = document.getElementById(`player-${playerId}`);
    draggedChip.style.display = 'none'; // Temporarily hide to see what's below
    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
    draggedChip.style.display = 'flex'; // Restore

    const targetChip = targetEl?.closest('.player-chip');

    if (targetChip && targetChip.id !== `player-${playerId}`) {
        const targetId = targetChip.id.replace('player-', '');
        const targetPlayer = players.find(p => p.id == targetId);
        handleSmartSwap(player, targetPlayer);
    } else {
        player.status = 'field';
        player.x = xPct;
        player.y = yPct;
        if (player.history.length === 0 || !player.history[player.history.length - 1].includes('Entra')) {
            logMovement(player);
        }
    }
    renderPlayers();
}

function dropToBench(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId');
    const player = players.find(p => p.id == playerId);
    if (!player) return;

    const draggedChip = document.getElementById(`player-${playerId}`);
    draggedChip.style.display = 'none';
    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
    draggedChip.style.display = 'flex';

    const targetChip = targetEl?.closest('.player-chip');

    if (targetChip && targetChip.id !== `player-${playerId}`) {
        const targetId = targetChip.id.replace('player-', '');
        const targetPlayer = players.find(p => p.id == targetId);
        handleSmartSwap(player, targetPlayer);
    } else {
        player.status = 'bench';
        player.x = 0; player.y = 0;
        if (player.history.length > 0 && player.history[player.history.length - 1].includes('Entra')) {
            logMovement(player);
        }
    }
    renderPlayers();
}

function handleSmartSwap(dragged, target) {
    // Save current states
    const oldDraggedStatus = dragged.status;
    const oldDraggedX = dragged.x;
    const oldDraggedY = dragged.y;

    // Dragged takes target's place
    dragged.status = target.status;
    dragged.x = target.x;
    dragged.y = target.y;

    // Target takes dragged's previous place
    target.status = oldDraggedStatus;
    target.x = oldDraggedX;
    target.y = oldDraggedY;

    if (isRunning) {
        logMovement(dragged);
        logMovement(target);
    }
}

function logMovement(player) {
    const timestamp = formatTime(masterTime);
    player.history.push(`${player.status === 'field' ? 'Entra' : 'Sale'} a las ${timestamp}`);
}

function resetGame() {
    masterTime = 0;
    isRunning = false;
    clearInterval(timerInterval);
    updateMasterUI();
    document.getElementById('btn-play-pause').textContent = 'EMPEZAR';
    document.getElementById('btn-play-pause').classList.remove('danger');
    spawnInitialPlayers();
    renderPlayers();
}

function exportData() {
    let csv = "Dorsal,Nombre,Entradas/Salidas,Tiempo Total\n";
    players.forEach(p => {
        const historyStr = p.history.join(' / ') || 'Sin cambios';
        csv += `${p.number},${p.name},"${historyStr}",${formatTime(p.time)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `reporte_cronos_${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Initialize on load
window.onload = init;

// --- SECURITY & INITIALIZATION ---
const ACCESS_CODE = '1234';

window.onload = () => {
    // Initial check for access
    if (sessionStorage.getItem('cronos_access') === 'true') {
        unlockApp();
    } else {
        // Only focus if the element exists
        const accessInput = document.getElementById('access-input');
        if (accessInput) {
            accessInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') validateAccess();
            });
        }
    }
};

function validateAccess() {
    const input = document.getElementById('access-input').value;
    const errorEl = document.getElementById('access-error');

    if (input === ACCESS_CODE) {
        sessionStorage.setItem('cronos_access', 'true');
        unlockApp();
    } else {
        errorEl.textContent = 'Código incorrecto. Inténtelo de nuevo.';
        document.getElementById('access-input').value = '';
    }
}

function unlockApp() {
    document.getElementById('access-screen').style.display = 'none';
    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-container').style.display = 'flex';
    document.body.classList.remove('locked');
    init(); // Start the app
}

// --- CONFIGURATION & STATE ---
let players = [];
let masterTime = 0; // seconds
let isRunning = false;
let timerInterval = null;
let currentMode = 'f7'; // f7 or f11

const COLORS = {
    home: { primary: '#58a6ff', secondary: '#f0883e', shorts: '#ffffff', text: '#ffffff' },
    away: { primary: '#ff5858', secondary: '#f0883e', shorts: '#000000', text: '#ffffff' }
};

const TEAM_NAMES = {
    home: 'LOCAL',
    away: 'VISITANTE'
};

// --- CORE FUNCTIONS ---

function init() {
    setupEventListeners();
    openSetupModal();
    registerServiceWorker();
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
            .then(reg => {
                console.log('Cronos PWA Ready');
                // Detect update
                reg.onupdatefound = () => {
                    const newWorker = reg.installing;
                    newWorker.onstatechange = () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            if (confirm('Nueva versión disponible (v3.2). ¿Actualizar ahora?')) {
                                window.location.reload();
                            }
                        }
                    };
                };
            })
            .catch(err => console.log('SW Error:', err));
    }
}

// Global helper for the manual button
async function forceUpdate() {
    if (confirm('Esto forzará la descarga de la última versión (v3.2+). ¿Continuar?')) {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let registration of registrations) {
                await registration.unregister();
            }
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            for (let key of keys) {
                await caches.delete(key);
            }
        }
        // Use a cache-busting parameter to force reload from server
        window.location.href = window.location.pathname + '?v=' + Date.now();
    }
}

function openSetupModal() {
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 95%;">
            <h2>Configuración del Encuentro</h2>
            
            <div style="display: flex; gap: 2rem; flex-wrap: wrap;">
                <!-- HOME CONFIG -->
                <div style="flex: 1; min-width: 250px;">
                    <h3>Equipo Local</h3>
                    <div class="form-group">
                        <label>Cargar Guardado</label>
                        <select id="saved-teams-home" onchange="loadTeamFromDropdown('home')">
                            <option value="">-- Seleccionar --</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Nombre</label>
                        <input type="text" id="setup-home-name" value="LOCAL">
                    </div>
                    <div class="form-group">
                        <label>Camiseta</label>
                        <input type="color" id="setup-home-color" value="#58a6ff">
                    </div>
                    <div class="form-group">
                        <label>Pantalón</label>
                        <input type="color" id="setup-home-shorts" value="#ffffff">
                    </div>
                    <div class="form-group">
                        <label>Color Número</label>
                        <input type="color" id="setup-home-text" value="#ffffff">
                    </div>
                </div>

                <!-- AWAY CONFIG -->
                <div style="flex: 1; min-width: 250px; border-left: 1px solid var(--glass-border); padding-left: 1rem;">
                    <h3>Equipo Visitante</h3>
                    <div class="form-group">
                        <label>Cargar Guardado</label>
                        <select id="saved-teams-away" onchange="loadTeamFromDropdown('away')">
                            <option value="">-- Seleccionar --</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Nombre</label>
                        <input type="text" id="setup-away-name" value="VISITANTE">
                    </div>
                    <div class="form-group">
                        <label>Camiseta</label>
                        <input type="color" id="setup-away-color" value="#ff5858">
                    </div>
                     <div class="form-group">
                        <label>Pantalón</label>
                        <input type="color" id="setup-away-shorts" value="#000000">
                    </div>
                    <div class="form-group">
                        <label>Color Número</label>
                        <input type="color" id="setup-away-text" value="#ffffff">
                    </div>
                </div>
            </div>

            <div class="form-group" style="margin-top: 1rem;">
                <label>Modalidad</label>
                <select id="setup-mode">
                    <option value="f7">Fútbol 7 (2 tiempos de 35 min)</option>
                    <option value="f11">Fútbol 11 (2 tiempos de 45 min)</option>
                </select>
            </div>
            <button class="btn primary" onclick="confirmSetup()">INICIAR PARTIDO</button>
        </div>
    `;
    populateSavedTeams('home');
    populateSavedTeams('away');
}

function confirmSetup() {
    // Capture Home
    TEAM_NAMES.home = document.getElementById('setup-home-name').value.toUpperCase();
    COLORS.home.primary = document.getElementById('setup-home-color').value;
    COLORS.home.shorts = document.getElementById('setup-home-shorts').value;
    COLORS.home.text = document.getElementById('setup-home-text').value;

    // Capture Away
    TEAM_NAMES.away = document.getElementById('setup-away-name').value.toUpperCase();
    COLORS.away.primary = document.getElementById('setup-away-color').value;
    COLORS.away.shorts = document.getElementById('setup-away-shorts').value;
    COLORS.away.text = document.getElementById('setup-away-text').value;

    const mode = document.getElementById('setup-mode').value;

    document.getElementById('team-a-name').textContent = TEAM_NAMES.home;
    document.getElementById('team-b-name').textContent = TEAM_NAMES.away;

    currentMode = mode;

    spawnInitialPlayers();
    renderPlayers();
    document.getElementById('setup-modal').style.display = 'none';
}

// --- PERSISTENCE ---

function populateSavedTeams(teamKey) {
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    if (!dropdown) return;

    // Database is shared? Or separate? 
    // "Base de datos... misma para los equipos..."
    // So one unique list of saved teams.
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');

    dropdown.innerHTML = '<option value="">-- Cargar --</option>';
    teams.forEach((team, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = team.name;
        dropdown.appendChild(opt);
    });
}

function loadTeamFromDropdown(teamKey) {
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    const index = dropdown.value;
    if (index === "") return;

    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const team = teams[index];

    if (team) {
        document.getElementById(`setup-${teamKey}-name`).value = team.name;
        document.getElementById(`setup-${teamKey}-color`).value = team.color;
        document.getElementById(`setup-${teamKey}-shorts`).value = team.shortsColor || '#ffffff';
        document.getElementById(`setup-${teamKey}-text`).value = team.textColor || '#ffffff';

        // Save loaded roster to temporary window object to be picked up by spawn
        if (!window.loadedTeamPlayers) window.loadedTeamPlayers = {};
        window.loadedTeamPlayers[teamKey] = team.players;
    }
}

function saveCurrentTeam() {
    // We need to ask WHICH team to save.
    // Simple prompt for now, or check what user wants.
    // "Guardar Equipo" button is generic.

    const choice = prompt("¿Qué equipo quieres guardar?\nEscribe '1' para Local\nEscribe '2' para Visitante");
    if (!choice) return;

    let teamKey = '';
    if (choice === '1' || choice.toLowerCase() === 'local') teamKey = 'home';
    else if (choice === '2' || choice.toLowerCase() === 'visitante') teamKey = 'away';
    else return;

    const teamName = TEAM_NAMES[teamKey];
    // Filter players by team
    const currentPlayers = players.filter(p => p.team === teamKey).map(p => ({
        id: p.id, // ID might be > 100, but that's fine for roster
        number: p.number,
        name: p.name
    }));

    const newTeam = {
        name: teamName,
        color: COLORS[teamKey].primary,
        shortsColor: COLORS[teamKey].shorts,
        textColor: COLORS[teamKey].text,
        players: currentPlayers
    };

    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');

    // Check if updating existing by name
    const existingIndex = teams.findIndex(t => t.name === teamName);
    if (existingIndex >= 0) {
        if (confirm(`¿Sobrescribir equipo "${teamName}"?`)) {
            teams[existingIndex] = newTeam;
        } else {
            return;
        }
    } else {
        if (teams.length >= 20) {
            alert('Memoria llena (20 equipos). Borra alguno antes de guardar.');
            return;
        }
        teams.push(newTeam);
    }

    localStorage.setItem('cronos_teams', JSON.stringify(teams));
    alert(`Equipo ${teamName} guardado.`);

    // Refresh dropdowns if still in setup 
    // (but here we are in main game usually)
}

function setupEventListeners() {
    document.getElementById('btn-play-pause').addEventListener('click', toggleGame);
    document.getElementById('btn-reset').addEventListener('click', resetMatch);
    document.getElementById('btn-save-team').addEventListener('click', saveCurrentTeam);
    document.getElementById('btn-export').addEventListener('click', exportData);

    // Match mode is now handled in Setup Modal only
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
    players = [];
    const count = currentMode === 'f7' ? 14 : 18;
    const startersCount = currentMode === 'f7' ? 7 : 11;

    const createTeam = (teamKey, startId) => {
        const teamColors = COLORS[teamKey];
        const savedRoster = window.loadedTeamPlayers ? window.loadedTeamPlayers[teamKey] : null;

        if (savedRoster) {
            savedRoster.forEach((savedP, index) => {
                // Adjust saved player to current match state
                players.push({
                    id: startId + (index + 1),
                    number: savedP.number,
                    name: savedP.name,
                    team: teamKey,
                    status: index < startersCount ? 'field' : 'bench',
                    time: 0,
                    color: teamColors.primary,
                    shortsColor: teamColors.shorts,
                    textColor: teamColors.text,
                    history: [],
                    x: 0, y: 0
                });
            });
            // If saved roster is smaller than count? Fill the rest?
            // If saved roster is larger? It will be cut off?
            // For now assume saved roster replaces default spawn completely.
        } else {
            // Default generation
            for (let i = 1; i <= count; i++) {
                players.push({
                    id: startId + i,
                    number: i,
                    name: `Jugador ${i}`,
                    team: teamKey,
                    status: i <= startersCount ? 'field' : 'bench',
                    time: 0,
                    color: teamColors.primary,
                    shortsColor: teamColors.shorts,
                    textColor: teamColors.text,
                    history: [],
                    x: 0, y: 0
                });
            }
        }
    };

    createTeam('home', 0);
    createTeam('away', 100);

    // Clear temp storage
    window.loadedTeamPlayers = null;
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
    const benchHome = document.getElementById('bench-list');
    const benchAway = document.getElementById('bench-list-away');

    // Clear all
    // pitch.innerHTML = `<img ...>` or keep SVG drawing
    // We need to preserve the pitch markings!
    const chips = pitch.querySelectorAll('.player-chip');
    chips.forEach(c => c.remove());

    benchHome.innerHTML = '';
    benchAway.innerHTML = '';

    players.forEach(p => {
        const chip = createPlayerChip(p);

        if (p.status === 'field') {
            pitch.appendChild(chip);
            placeOnField(chip, p);
        } else {
            // Bench
            if (p.team === 'home') {
                benchHome.appendChild(chip);
            } else {
                benchAway.appendChild(chip);
            }
        }
    });
}

function createPlayerChip(player) {
    const div = document.createElement('div');
    div.className = 'player-chip';
    div.id = `player-${player.id}`;
    div.draggable = true;
    div.style.background = `linear-gradient(to bottom, ${player.color} 50%, ${player.shortsColor} 50%)`;

    div.innerHTML = `
        <div class="player-timer ${player.status === 'field' ? 'timer-active' : 'timer-bench'}" style="color: white">${formatTime(player.time)}</div>
        <div class="player-number" onclick="editPlayerNumber(${player.id})" style="color: ${player.textColor || '#ffffff'}">${player.number}</div>
        <div class="player-name" onclick="editPlayerName(${player.id})" style="color: white">${player.name}</div>
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
    // DO NOT preventDefault here, or clicks (edit name/number) won't work
    touchData.draggedPlayerId = player.id;
    const chip = document.getElementById(`player-${player.id}`);
    chip.classList.add('dragging-active');
}

function handleTouchMove(e, player) {
    if (!touchData.draggedPlayerId) return;
    if (e.cancelable) e.preventDefault();

    const touch = e.touches[0];
    const chip = document.getElementById(`player-${player.id}`);

    // Use fixed positioning during drag for absolute accuracy relative to finger
    chip.style.position = 'fixed';
    chip.style.left = `${touch.clientX}px`;
    chip.style.top = `${touch.clientY}px`;
    chip.style.transform = `translate(-50%, -50%)`;
    chip.style.zIndex = '9999';
}

function handleTouchEnd(e, player) {
    if (!touchData.draggedPlayerId) return;
    const chip = document.getElementById(`player-${player.id}`);
    chip.classList.remove('dragging-active');

    // Restore styling so renderPlayers can position it correctly
    chip.style.position = '';
    chip.style.zIndex = '';

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

    // Determine where it was dropped using the coordinates and the target
    const pitch = document.getElementById('football-pitch');
    const sidebarHome = document.querySelector('.sidebar');
    const sidebarAway = document.querySelector('.sidebar-right');
    const toggleHome = document.getElementById('toggle-bench-home');
    const toggleAway = document.getElementById('toggle-bench-away');

    // Ensure we have a valid target element
    const actualTarget = fakeEvent.target;

    if (pitch.contains(actualTarget) || actualTarget.closest('.pitch')) {
        dropToField(fakeEvent);
    } else if (sidebarHome.contains(actualTarget) || actualTarget.closest('.sidebar') || (toggleHome && toggleHome.contains(actualTarget))) {
        dropToBench(fakeEvent);
    } else if (sidebarAway.contains(actualTarget) || actualTarget.closest('.sidebar-right') || (toggleAway && toggleAway.contains(actualTarget))) {
        dropToAwayBench(fakeEvent);
    } else {
        renderPlayers(); // Reset visual position if dropped nowhere
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
    f7: {
        home: [
            { x: 50, y: 88 }, // GK
            { x: 30, y: 70 }, { x: 70, y: 70 }, // DEF
            { x: 20, y: 45 }, { x: 50, y: 45 }, { x: 80, y: 45 }, // MID
            { x: 50, y: 25 }  // FWD
        ],
        away: [
            { x: 50, y: 12 }, // GK (Top)
            { x: 30, y: 30 }, { x: 70, y: 30 }, // DEF
            { x: 20, y: 55 }, { x: 50, y: 55 }, { x: 80, y: 55 }, // MID
            { x: 50, y: 75 }  // FWD
        ]
    },
    f11: {
        home: [
            { x: 50, y: 92 }, // GK
            { x: 15, y: 75 }, { x: 38, y: 78 }, { x: 62, y: 78 }, { x: 85, y: 75 }, // DEF
            { x: 30, y: 50 }, { x: 50, y: 55 }, { x: 70, y: 50 }, // MID
            { x: 20, y: 25 }, { x: 80, y: 25 }, { x: 50, y: 12 }  // FWD
        ],
        away: [
            { x: 50, y: 8 }, // GK (Top)
            { x: 15, y: 25 }, { x: 38, y: 22 }, { x: 62, y: 22 }, { x: 85, y: 25 }, // DEF
            { x: 30, y: 50 }, { x: 50, y: 45 }, { x: 70, y: 50 }, // MID
            { x: 20, y: 75 }, { x: 80, y: 75 }, { x: 50, y: 88 }  // FWD
        ]
    }
};

function placeOnField(chip, player) {
    if (player.x === 0 && player.y === 0) {
        // Auto-position logic
        // Filter players of SAME TEAM on field
        const fieldPlayers = players.filter(p => p.status === 'field' && p.team === player.team);
        const index = fieldPlayers.indexOf(player);
        const formation = FORMATIONS[currentMode][player.team];

        if (formation && formation[index]) {
            player.x = formation[index].x;
            player.y = formation[index].y;
        } else {
            // Fallback
            player.x = 50;
            player.y = 50;
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

// --- DRAG & DROP LOGIC (SMART SWAP) ---

function allowDrop(e) {
    e.preventDefault();
}



function toggleBench(team) {
    const selector = team === 'home' ? '.sidebar' : '.sidebar-right';
    const otherSelector = team === 'home' ? '.sidebar-right' : '.sidebar';

    const drawer = document.querySelector(selector);
    const otherDrawer = document.querySelector(otherSelector);

    // Close the other one first
    otherDrawer.classList.remove('open');
    // Toggle current
    drawer.classList.toggle('open');
}

// Helper to close all drawers after a substitution
function closeDrawers() {
    document.querySelector('.sidebar').classList.remove('open');
    document.querySelector('.sidebar-right').classList.remove('open');
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

        // Prevent swapping with opp team
        if (targetPlayer && targetPlayer.team === player.team) {
            handleSmartSwap(player, targetPlayer);
        }
    } else {
        player.status = 'field';
        player.x = xPct;
        player.y = yPct;
        if (player.history.length === 0 || !player.history[player.history.length - 1].includes('Entra')) {
            logMovement(player);
        }
    }
    closeDrawers(); // Auto-close drawer on mobile
    renderPlayers();
}

function dropToBench(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId');
    const player = players.find(p => p.id == playerId);
    if (!player) return; // or check if player.team === 'home'

    // If trying to drop away player to home bench?
    if (player.team !== 'home') return;

    handleBenchDrop(e, player);
}

function dropToAwayBench(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId');
    const player = players.find(p => p.id == playerId);
    if (!player) return;

    if (player.team !== 'away') return;

    handleBenchDrop(e, player);
}

function handleBenchDrop(e, player) {
    const draggedChip = document.getElementById(`player-${player.id}`);
    draggedChip.style.display = 'none';
    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
    draggedChip.style.display = 'flex';

    const targetChip = targetEl?.closest('.player-chip');

    if (targetChip && targetChip.id !== `player-${player.id}`) {
        const targetId = targetChip.id.replace('player-', '');
        const targetPlayer = players.find(p => p.id == targetId);

        if (targetPlayer && targetPlayer.team === player.team) {
            handleSmartSwap(player, targetPlayer);
        }
    } else {
        player.status = 'bench';
        player.x = 0; player.y = 0;
        if (player.history.length > 0 && player.history[player.history.length - 1].includes('Entra')) {
            logMovement(player);
        }
    }
    closeDrawers();
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

function resetMatch() {
    if (!confirm("¿Reiniciar partido? Se perderá el tiempo y las estadísticas, pero se mantendrán los jugadores.")) return;

    // Stop timer
    isRunning = false;
    clearInterval(timerInterval);
    masterTime = 0;
    updateMasterUI();

    // Reset Play button
    const btn = document.getElementById('btn-play-pause');
    btn.textContent = 'EMPEZAR';
    btn.classList.remove('danger');

    // Reset Players Stats & Positions
    const startersCount = currentMode === 'f7' ? 7 : 11;

    // Separate counters for home and away to assign field status
    let homeCount = 0;
    let awayCount = 0;

    players.forEach((p) => {
        p.time = 0;
        p.history = [];
        p.x = 0;
        p.y = 0;

        if (p.team === 'home') {
            homeCount++;
            p.status = homeCount <= startersCount ? 'field' : 'bench';
        } else {
            awayCount++;
            p.status = awayCount <= startersCount ? 'field' : 'bench';
        }
    });

    renderPlayers();
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

function updateScore(team) {
    const el = document.getElementById(`score-${team}`);
    const currentVal = el.textContent;
    const teamName = team === 'home' ? 'LOCAL' : 'VISITANTE';

    const newVal = prompt(`Goles ${teamName}:`, currentVal);

    // Allow empty to cancel, but if it's a number (even 0), update.
    if (newVal !== null && newVal.trim() !== "" && !isNaN(newVal)) {
        el.textContent = parseInt(newVal);
    }
}

async function exportData() {
    // 1. Process all active and bench players
    const allPlayers = [...Object.values(PLAYERS['home']), ...Object.values(PLAYERS['away'])];

    const processedPlayers = allPlayers.map(p => {
        const shifts = [];
        let currentEntry = null;

        const hasImplicitStart = (p.history.length > 0 && p.history[0].includes('Sale')) ||
            (p.history.length === 0 && (p.time > 0 || p.status === 'field'));

        if (hasImplicitStart) {
            currentEntry = "00:00";
        }

        p.history.forEach(h => {
            const match = h.match(/(\d{2}:\d{2})/);
            const timestamp = match ? match[1] : "";

            if (h.includes('Entra')) {
                currentEntry = timestamp;
            } else if (h.includes('Sale')) {
                if (currentEntry) {
                    shifts.push({ in: currentEntry, out: timestamp });
                    currentEntry = null;
                } else {
                    shifts.push({ in: "00:00", out: timestamp });
                }
            }
        });

        if (currentEntry) {
            shifts.push({ in: currentEntry, out: "" });
        }

        return { ...p, processedShifts: shifts };
    });

    // 2. Determine Max Shifts and columns
    const maxShifts = Math.max(...processedPlayers.map(p => p.processedShifts.length), 1);
    const totalCols = 3 + (maxShifts * 2) + 1; // EQUIPO, DORSAL, NOMBRE + (IN/OUT * max) + TOTAL

    // 3. Helper Functions for CSV Alignment
    const q = (v) => `"${(v || "").toString().replace(/"/g, '""')}"`;
    const makeRow = (cells) => {
        // Ensure every row has exactly totalCols
        const rowData = [...cells];
        while (rowData.length < totalCols) rowData.push("");
        return rowData.map(q).join(";") + "\n";
    };

    // 4. Build Content
    let csvContent = "sep=;\n"; // Excel hint

    const date = new Date().toLocaleDateString();
    const mode = currentMode === 'f7' ? 'Fútbol 7' : 'Fútbol 11';
    const homeName = TEAM_NAMES.home;
    const awayName = TEAM_NAMES.away;
    const scoreHome = document.getElementById('score-home').textContent;
    const scoreAway = document.getElementById('score-away').textContent;

    // Metadata rows
    csvContent += makeRow(["FECHA", date]);
    csvContent += makeRow(["MODO", mode]);
    csvContent += makeRow(["ENCUENTRO", `${homeName} vs ${awayName}`]);
    csvContent += makeRow(["RESULTADO", `${scoreHome} - ${scoreAway}`]);
    csvContent += makeRow(["TIEMPO GLOBAL", formatTime(masterTime)]);
    csvContent += makeRow([]); // Empty spacer row

    // Table Headers
    const headers = ["EQUIPO", "DORSAL", "NOMBRE"];
    for (let i = 1; i <= maxShifts; i++) {
        headers.push(`ENTRADA ${i}`, `SALIDA ${i}`);
    }
    headers.push("TIEMPO TOTAL");
    csvContent += makeRow(headers);

    // Data Rows
    const sortedPlayers = [...processedPlayers].sort((a, b) => {
        if (a.team !== b.team) return a.team === 'home' ? -1 : 1;
        return a.number - b.number;
    });

    sortedPlayers.forEach(p => {
        const teamName = p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away;
        const rowCells = [teamName, p.number, p.name];

        for (let i = 0; i < maxShifts; i++) {
            const s = p.processedShifts[i];
            rowCells.push(s ? s.in : "");
            rowCells.push(s ? s.out : "");
        }

        rowCells.push(formatTime(p.time));
        csvContent += makeRow(rowCells);
    });

    // 5. Download
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cronos_match_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Initialize on load
// Initialized via window.onload at the top

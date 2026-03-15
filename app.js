// --- CONFIGURACIÓN Y ESTADO GLOBAL ---
let players = [];
let isRunning = false;
let timerInterval = null;
let lastTickTime = 0;
let currentMode = 'f7';
let matchPhase = '1st_half';
let half1MaxTime = 30 * 60;
let half2MaxTime = 30 * 60;
let masterTimeH1 = 0;
let masterTimeH2 = 0;

// Configuración de Email y WhatsApp (persiste en localStorage)
let emailConfig = JSON.parse(localStorage.getItem('cronos_email_config')) || {
    coachEmail: '',
    directorEmail: '',
    whatsappNumber: ''
};

// --- FUNCIÓN DE ARRANQUE (Llamada desde auth.js) ---
window.init = () => {
    console.log("Motor de Cronos Fútbol iniciado.");
    
    // 1. Cargar configuración previa si existe
    const savedPlayers = localStorage.getItem('cronos_current_match_players');
    if (savedPlayers) {
        players = JSON.parse(savedPlayers);
    }

    // 2. Inicializar eventos de la interfaz
    setupEventListeners();
    
    // 3. Dibujar el banquillo y el campo
    renderBench();
    renderPitch();
    
    // 4. Actualizar visualmente los cronómetros
    updateTimerDisplay();
};

// --- GESTIÓN DE EVENTOS ---
function setupEventListeners() {
    const btnPlay = document.getElementById('btn-play-pause');
    if (btnPlay) {
        btnPlay.onclick = () => {
            if (isRunning) pauseTimer();
            else startTimer();
        };
    }

    // Otros botones del header
    const btnSave = document.getElementById('btn-save-team');
    if (btnSave) btnSave.onclick = saveCurrentStatus;
}

// --- LÓGICA DEL CRONÓMETRO ---
function startTimer() {
    if (isRunning) return;
    isRunning = true;
    const btn = document.getElementById('btn-play-pause');
    btn.textContent = 'PAUSAR';
    btn.classList.replace('primary', 'danger');
    
    lastTickTime = Date.now();
    timerInterval = setInterval(tick, 1000);
}

function pauseTimer() {
    isRunning = false;
    const btn = document.getElementById('btn-play-pause');
    btn.textContent = 'CONTINUAR';
    btn.classList.replace('danger', 'primary');
    clearInterval(timerInterval);
}

function tick() {
    const now = Date.now();
    const delta = Math.floor((now - lastTickTime) / 1000);
    if (delta < 1) return;
    lastTickTime = now;

    if (matchPhase === '1st_half') {
        masterTimeH1 += delta;
    } else {
        masterTimeH2 += delta;
    }

    // Aumentar tiempo de jugadores que están en el campo
    players.forEach(p => {
        if (p.status === 'field') {
            p.time += delta;
        }
    });

    updateTimerDisplay();
    // Guardado automático cada segundo por seguridad
    localStorage.setItem('cronos_current_match_players', JSON.stringify(players));
}

function updateTimerDisplay() {
    document.getElementById('timer-h1').textContent = formatSeconds(masterTimeH1);
    document.getElementById('timer-h2').textContent = formatSeconds(masterTimeH2);
}

function formatSeconds(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- RENDERIZADO DE JUGADORES (Banquillo y Campo) ---
function renderBench() {
    const benchLocal = document.getElementById('bench-list');
    const benchAway = document.getElementById('bench-list-away');
    
    if (benchLocal) benchLocal.innerHTML = '';
    if (benchAway) benchAway.innerHTML = '';

    players.filter(p => p.status === 'bench').forEach(p => {
        const el = createPlayerElement(p);
        if (p.team === 'home') benchLocal.appendChild(el);
        else benchAway.appendChild(el);
    });
}

function createPlayerElement(p) {
    const div = document.createElement('div');
    div.className = `player-card ${p.team}`;
    div.draggable = true;
    div.innerHTML = `
        <span class="p-number">${p.number}</span>
        <span class="p-name">${p.name}</span>
        <span class="p-time">${formatSeconds(p.time)}</span>
    `;
    
    // Lógica de Drag & Drop
    div.ondragstart = (e) => {
        e.dataTransfer.setData('playerId', p.id);
    };
    
    return div;
}

function renderPitch() {
    const pitch = document.getElementById('football-pitch');
    // Aquí va tu lógica original para posicionar los jugadores en el campo
    // Basado en las coordenadas p.x y p.y
}

// --- PERSISTENCIA Y GUARDADO ---
function saveCurrentStatus() {
    localStorage.setItem('cronos_current_match_players', JSON.stringify(players));
    alert("Estado del partido guardado localmente.");
}

// --- UTILIDADES ---
window.forceUpdate = () => {
    if(confirm("¿Seguro? Se borrarán todos los datos guardados.")) {
        localStorage.clear();
        location.reload(true);
    }
};
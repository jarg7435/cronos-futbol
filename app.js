// --- CONFIGURACIÓN & ESTADO GLOBAL ---
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

// Configuración de Email y WhatsApp
let emailConfig = JSON.parse(localStorage.getItem('cronos_email_config')) || {
    coachEmail: '',
    directorEmail: '',
    whatsappNumber: ''
};

// --- FUNCIÓN CRÍTICA: DESBLOQUEO DE APP ---
// Esta función es la que llama auth.js cuando el login es correcto
window.unlockApp = () => {
    console.log("Desbloqueando Cronos Fútbol...");
    
    // 1. Ocultamos todas las pantallas de acceso
    const authScreen = document.getElementById('auth-screen');
    const installScreen = document.getElementById('install-screen');
    if(authScreen) authScreen.style.display = 'none';
    if(installScreen) installScreen.style.display = 'none';

    // 2. Mostramos la interfaz principal
    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-container').style.display = 'flex';
    
    // 3. Quitamos el bloqueo del body
    document.body.classList.remove('locked');
    document.body.classList.add('unlocked');

    // 4. Arrancamos la lógica del juego
    init();
};

// --- INICIALIZACIÓN ---
function init() {
    console.log("Iniciando lógica de campo...");
    renderBench();
    setupEventListeners();
    loadSavedTeamsList();
    
    // Si eres admin, el botón ya se habrá activado en auth.js
}

// --- GESTIÓN DE TIEMPOS ---
function setupEventListeners() {
    const btnPlay = document.getElementById('btn-play-pause');
    if(btnPlay) {
        btnPlay.onclick = () => {
            if (isRunning) pauseTimer();
            else startTimer();
        };
    }

    const btnReset = document.getElementById('btn-reset');
    if(btnReset) {
        btnReset.onclick = () => {
            if(confirm("¿Reiniciar todo el partido? Se perderán los tiempos actuales.")) {
                location.reload();
            }
        };
    }
}

function startTimer() {
    isRunning = true;
    document.getElementById('btn-play-pause').textContent = 'PAUSAR';
    document.getElementById('btn-play-pause').classList.replace('primary', 'danger');
    lastTickTime = Date.now();
    timerInterval = setInterval(updateTimers, 1000);
}

function pauseTimer() {
    isRunning = false;
    document.getElementById('btn-play-pause').textContent = 'CONTINUAR';
    document.getElementById('btn-play-pause').classList.replace('danger', 'primary');
    clearInterval(timerInterval);
}

function updateTimers() {
    const now = Date.now();
    const delta = Math.floor((now - lastTickTime) / 1000);
    if (delta < 1) return;
    lastTickTime = now;

    if (matchPhase === '1st_half') {
        masterTimeH1 += delta;
        document.getElementById('timer-h1').textContent = formatTime(masterTimeH1);
    } else {
        masterTimeH2 += delta;
        document.getElementById('timer-h2').textContent = formatTime(masterTimeH2);
    }

    // Actualizar tiempo de jugadores en campo
    players.forEach(p => {
        if (p.status === 'field') p.time += delta;
    });
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- RENDERIZADO BÁSICO (Para que no salga vacío) ---
function renderBench() {
    const container = document.getElementById('bench-list');
    if(!container) return;
    container.innerHTML = '<p style="font-size:0.7rem; color:gray; padding:10px;">Configure su equipo en INICIO</p>';
}

function loadSavedTeamsList() {
    // Aquí iría tu lógica de cargar equipos de localStorage
    console.log("Cargando plantillas guardadas...");
}

// --- COMPATIBILIDAD CON BOTONES DE INDEX ---
window.goBackToSetup = () => {
    // Lógica para volver a la configuración
    alert("Volviendo a configuración...");
};

window.forceUpdate = () => {
    localStorage.clear();
    location.reload(true);
};
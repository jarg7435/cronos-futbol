// --- SECURITY & INITIALIZATION ---
const ACCESS_CODE = '1234';

// ── Helper Global: Usuario efectivo con fallbacks para Superadmin ─────
// Permite que el Superadmin pueda acceder a cualquier panel aunque no tenga
// clubId propio. Si tiene rol SA y no tiene clubId, usa 'demo' como fallback.
window._getEffectiveUser = function() {
    const me = window._cronosCurrentUser;
    if (!me) return null;
    const isSA = me.role === 'superadmin' || me.role === 'admin';
    return {
        ...me,
        _isSuperAdmin: isSA,
        // Si el SA no tiene clubId, usar 'demo' para no bloquear módulos
        clubId: me.clubId || (isSA ? '_sa_preview' : null),
        clubName: me.clubName || (isSA ? 'Vista Superadmin' : null),
        uid: me.uid || 'sa_user',
    };
};

window.onload = () => {
    // La app arranca desde enterApp() en index.html tras la autenticación Firebase
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
    document.body.classList.remove('locked');
    init();
}

// --- CONFIGURATION & STATE ---
let players = [];
let isRunning = false;
let timerInterval = null;
let lastTickTime = 0;
let currentMode = 'f7';
let matchPhase = '1st_half';
let analyzeAway = false;
let activeFormationKey = null;
let selectedFormationOnStart = '';

let half1MaxTime = 30 * 60;
let half2MaxTime = 30 * 60;
let masterTimeH1 = 0;
let masterTimeH2 = 0;

let pendingSubstitution = null;

// --- SINCRONIZACIÓN EN VIVO (Firestore) ---
let liveMatchId    = null;   // ID del partido en Firestore
let liveSyncTimer  = null;   // Intervalo de sincronización del cronómetro
let liveIsActive   = false;  // true cuando hay partido en vivo activo

// --- CUERPO TÉCNICO (persiste en localStorage) ---
let staffConfig = {
    coach1:    '',   // Primer entrenador
    coach2:    '',   // Segundo entrenador
    delegate:  '',   // Delegado de equipo
    fieldDelegate: '' // Delegado de campo (opcional, solo en casa)
};

// --- CONFIGURACIÓN DE EMAIL Y WHATSAPP (persiste en localStorage) ---
let emailConfig = {
    coachEmail: '',        // correo del entrenador (copia para él)
    directorEmail: '',     // correo del director deportivo (destino principal)
    emailjsServiceId: '',  // ID del servicio EmailJS
    emailjsTemplateId: '', // ID de la plantilla EmailJS
    emailjsPublicKey: '',  // Clave pública EmailJS
    whatsappNumber: ''     // número del director deportivo con prefijo país (ej: 34612345678)
};

const COLORS = {
    home: { primary: '#58a6ff', secondary: '#f0883e', shorts: '#ffffff', text: '#ffffff' },
    away: { primary: '#ff5858', secondary: '#f0883e', shorts: '#000000', text: '#ffffff' }
};

const TEAM_NAMES = { home: 'LOCAL', away: 'VISITANTE' };

// ══════════════════════════════════════════════════════════════════
//  FORMACIONES PREDEFINIDAS
//  El campo es HORIZONTAL (aspect-ratio 3:2).
//  x = izquierda→derecha (%), y = arriba→abajo (%)
//  LOCAL ocupa el LADO IZQUIERDO (x: 5-46) en modo ambos equipos.
//  VISITANTE ocupa el LADO DERECHO (x: 54-95), espejo del local.
//  FULL = local solo, ocupa campo completo (x: 5-92).
// ══════════════════════════════════════════════════════════════════
const FORMATION_PRESETS = {
    // ─── FÚTBOL 7 ───────────────────────────────────────────────────────────────
    // Campo horizontal. Local lado izquierdo (x≈9-47), Visitante lado derecho (x≈53-91).
    // Full = local solo, campo completo (x≈9-88).
    // Márgenes: minX:8 maxX:92  minY:13 maxY:87
    f7: {
        '231': {
            label: '1-2-3-1',
            // GK · 2 DEF · 3 MED · 1 DEL
            home: [
                {x:9, y:50},                                    // GK
                {x:20,y:35},{x:20,y:65},                        // DEF
                {x:33,y:22},{x:33,y:50},{x:33,y:78},            // MED
                {x:45,y:50}                                     // DEL
            ],
            away: [
                {x:91,y:50},
                {x:80,y:35},{x:80,y:65},
                {x:67,y:22},{x:67,y:50},{x:67,y:78},
                {x:55,y:50}
            ],
            full: [
                {x:9, y:50},
                {x:22,y:35},{x:22,y:65},
                {x:50,y:22},{x:50,y:50},{x:50,y:78},
                {x:82,y:50}
            ],
        },
        '321': {
            label: '1-3-2-1',
            // GK · 3 DEF · 2 MED · 1 DEL
            home: [
                {x:9, y:50},
                {x:20,y:24},{x:20,y:50},{x:20,y:76},
                {x:33,y:37},{x:33,y:63},
                {x:45,y:50}
            ],
            away: [
                {x:91,y:50},
                {x:80,y:24},{x:80,y:50},{x:80,y:76},
                {x:67,y:37},{x:67,y:63},
                {x:55,y:50}
            ],
            full: [
                {x:9, y:50},
                {x:22,y:24},{x:22,y:50},{x:22,y:76},
                {x:50,y:37},{x:50,y:63},
                {x:82,y:50}
            ],
        },
        '222': {
            label: '1-2-2-2',
            // GK · 2 DEF · 2 MED · 2 DEL
            home: [
                {x:9, y:50},
                {x:20,y:35},{x:20,y:65},
                {x:32,y:35},{x:32,y:65},
                {x:44,y:35},{x:44,y:65}
            ],
            away: [
                {x:91,y:50},
                {x:80,y:35},{x:80,y:65},
                {x:68,y:35},{x:68,y:65},
                {x:56,y:35},{x:56,y:65}
            ],
            full: [
                {x:9, y:50},
                {x:22,y:35},{x:22,y:65},
                {x:50,y:35},{x:50,y:65},
                {x:80,y:35},{x:80,y:65}
            ],
        },
    },
    // ─── FÚTBOL 11 ──────────────────────────────────────────────────────────────
    f11: {
        '4231': {
            label: '1-4-2-3-1',
            // GK · 4 DEF · 2 MCD · 3 MC/EXT · 1 DEL
            home: [
                {x:9, y:50},
                {x:18,y:18},{x:18,y:40},{x:18,y:60},{x:18,y:82},
                {x:28,y:37},{x:28,y:63},
                {x:38,y:22},{x:38,y:50},{x:38,y:78},
                {x:47,y:50}
            ],
            away: [
                {x:91,y:50},
                {x:82,y:18},{x:82,y:40},{x:82,y:60},{x:82,y:82},
                {x:72,y:37},{x:72,y:63},
                {x:62,y:22},{x:62,y:50},{x:62,y:78},
                {x:53,y:50}
            ],
            full: [
                {x:9, y:50},
                {x:18,y:18},{x:18,y:40},{x:18,y:60},{x:18,y:82},
                {x:35,y:37},{x:35,y:63},
                {x:58,y:22},{x:58,y:50},{x:58,y:78},
                {x:88,y:50}
            ],
        },
        '442': {
            label: '1-4-4-2',
            // GK · 4 DEF · 4 MED · 2 DEL
            home: [
                {x:9, y:50},
                {x:18,y:18},{x:18,y:40},{x:18,y:60},{x:18,y:82},
                {x:30,y:18},{x:30,y:40},{x:30,y:60},{x:30,y:82},
                {x:41,y:36},{x:41,y:64}
            ],
            away: [
                {x:91,y:50},
                {x:82,y:18},{x:82,y:40},{x:82,y:60},{x:82,y:82},
                {x:70,y:18},{x:70,y:40},{x:70,y:60},{x:70,y:82},
                {x:59,y:36},{x:59,y:64}
            ],
            full: [
                {x:9, y:50},
                {x:18,y:18},{x:18,y:40},{x:18,y:60},{x:18,y:82},
                {x:50,y:18},{x:50,y:40},{x:50,y:60},{x:50,y:82},
                {x:80,y:36},{x:80,y:64}
            ],
        },
        '4141': {
            label: '1-4-1-4-1',
            // GK · 4 DEF · 1 MCD · 4 MC/EXT · 1 DEL
            home: [
                {x:9, y:50},
                {x:17,y:18},{x:17,y:40},{x:17,y:60},{x:17,y:82},
                {x:27,y:50},
                {x:36,y:18},{x:36,y:40},{x:36,y:60},{x:36,y:82},
                {x:46,y:50}
            ],
            away: [
                {x:91,y:50},
                {x:83,y:18},{x:83,y:40},{x:83,y:60},{x:83,y:82},
                {x:73,y:50},
                {x:64,y:18},{x:64,y:40},{x:64,y:60},{x:64,y:82},
                {x:54,y:50}
            ],
            full: [
                {x:9, y:50},
                {x:18,y:18},{x:18,y:40},{x:18,y:60},{x:18,y:82},
                {x:36,y:50},
                {x:58,y:18},{x:58,y:40},{x:58,y:60},{x:58,y:82},
                {x:88,y:50}
            ],
        },
        '541': {
            label: '1-5-4-1',
            // GK · 5 DEF · 4 MED · 1 DEL
            home: [
                {x:9, y:50},
                {x:17,y:15},{x:17,y:33},{x:17,y:50},{x:17,y:67},{x:17,y:85},
                {x:32,y:20},{x:32,y:40},{x:32,y:60},{x:32,y:80},
                {x:46,y:50}
            ],
            away: [
                {x:91,y:50},
                {x:83,y:15},{x:83,y:33},{x:83,y:50},{x:83,y:67},{x:83,y:85},
                {x:68,y:20},{x:68,y:40},{x:68,y:60},{x:68,y:80},
                {x:54,y:50}
            ],
            full: [
                {x:9, y:50},
                {x:18,y:15},{x:18,y:33},{x:18,y:50},{x:18,y:67},{x:18,y:85},
                {x:50,y:20},{x:50,y:40},{x:50,y:60},{x:50,y:80},
                {x:88,y:50}
            ],
        },
    },
};

// Márgenes seguros en % del campo.
// Chip radio ≈ 4.5%, etiqueta (crono/nombre) ≈ 6% adicional → total mínimo ≈ 11%
// Usamos 13% para tener holgura y garantizar visibilidad en cualquier tamaño de pantalla.
const FIELD_MARGIN = {
    minX: 8,   // margen izquierdo
    maxX: 92,  // margen derecho
    minY: 13,  // margen superior (espacio para el crono)
    maxY: 87,  // margen inferior (espacio para el nombre)
};

function clampToField(x, y) {
    return {
        x: Math.max(FIELD_MARGIN.minX, Math.min(FIELD_MARGIN.maxX, x)),
        y: Math.max(FIELD_MARGIN.minY, Math.min(FIELD_MARGIN.maxY, y)),
    };
}

// Actualiza el <select> de formación según la modalidad elegida
function updateFormationOptions() {
    const mode = document.getElementById('setup-mode')?.value || 'f7';
    const sel  = document.getElementById('setup-formation');
    if (!sel) return;
    const presets = FORMATION_PRESETS[mode];
    sel.innerHTML = '<option value="">-- Sin formación predefinida --</option>';
    Object.entries(presets).forEach(([key, val]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = val.label;
        sel.appendChild(opt);
    });
}

// --- APLICAR FORMACIÓN ---
function applyFormationPreset(key) {
    const presets = FORMATION_PRESETS[currentMode];
    if (!presets || !presets[key]) return;

    const preset = presets[key];
    const useFullField = !analyzeAway; // solo local → campo completo

    let homeIdx = 0, awayIdx = 0;
    players.forEach(p => {
        if (p.status !== 'field') return;
        if (p.team === 'home') {
            const positions = useFullField ? preset.full : preset.home;
            if (positions[homeIdx]) {
                const pos = clampToField(positions[homeIdx].x, positions[homeIdx].y);
                p.x = pos.x; p.y = pos.y;
                homeIdx++;
            }
        } else if (p.team === 'away') {
            const positions = preset.away;
            if (positions && positions[awayIdx]) {
                const pos = clampToField(positions[awayIdx].x, positions[awayIdx].y);
                p.x = pos.x; p.y = pos.y;
                awayIdx++;
            }
        }
    });

    // Actualizar botones activos
    activeFormationKey = key;
    document.querySelectorAll('.formation-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fkey === key);
    });

    renderPlayers();
}

// --- PLAYER ACTION MODAL ---
let activeActionPlayerId = null;

function openPlayerActionModal(player) {
    activeActionPlayerId = player.id;
    document.getElementById('action-player-name').innerHTML = `${player.name} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-number').innerHTML = `Dorsal ${player.number} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-goals').textContent = `${player.goals || 0} ⚽`;
    // Resaltar botón de tarjeta activa
    const btnAmarilla = document.querySelector('#player-action-modal .btn[onclick*="amarilla"]');
    const btnRoja     = document.querySelector('#player-action-modal .btn[onclick*="roja"]');
    if (btnAmarilla) {
        btnAmarilla.style.outline   = player.cards === 'amarilla' ? '3px solid #fff' : '';
        btnAmarilla.style.boxShadow = player.cards === 'amarilla' ? '0 0 8px rgba(241,196,15,0.8)' : '';
    }
    if (btnRoja) {
        btnRoja.style.outline   = player.cards === 'roja' ? '3px solid #fff' : '';
        btnRoja.style.boxShadow = player.cards === 'roja' ? '0 0 8px rgba(231,76,60,0.8)' : '';
    }
    // Reflejar estado de lesión en el botón
    const injBtn = document.getElementById('btn-injury');
    if (injBtn) {
        injBtn.style.background = player.injured ? 'rgba(231,76,60,0.3)' : 'rgba(255,255,255,0.08)';
        injBtn.style.border     = player.injured ? '1px solid #e74c3c' : '';
        injBtn.textContent      = player.injured ? '🚑 Lesionado ✓' : '🚑 Lesión';
    }
    document.getElementById('player-action-modal').style.display = 'flex';
}

function closePlayerActionModal() {
    activeActionPlayerId = null;
    document.getElementById('player-action-modal').style.display = 'none';
    renderPlayers(); // redibujar para mostrar cambios (lesión, tarjeta, goles)
    renderStaffInBench();
}

function toggleInjury() {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (!p) return;
    p.injured = !p.injured;
    if (p.injured) logEvent(p, 'LESIÓN');
    // Actualizar botón en el modal para reflejar estado
    const btn = document.getElementById('btn-injury');
    if (btn) {
        btn.style.background = p.injured ? 'rgba(231,76,60,0.3)' : 'rgba(255,255,255,0.08)';
        btn.style.border     = p.injured ? '1px solid #e74c3c' : '';
        btn.textContent      = p.injured ? '🚑 Lesionado ✓' : '🚑 Lesión';
    }
    renderPlayers();
    liveSyncOnAction();
}

function toggleInjury() {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (!p) return;
    p.injured = !p.injured;
    // Actualizar aspecto del botón en el modal
    const btn = document.getElementById('btn-injury');
    if (btn) {
        btn.style.borderColor  = p.injured ? '#e74c3c' : 'transparent';
        btn.style.background   = p.injured ? 'rgba(231,76,60,0.15)' : 'var(--glass)';
        btn.querySelector('span').style.color = p.injured ? '#e74c3c' : 'var(--text-muted)';
    }
    renderPlayers();
    liveSyncOnAction();
}

function assignCard(type) {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (p) {
        // Toggle: si ya tiene esa tarjeta, la quita
        if (p.cards === type) {
            p.cards = 'ninguna';
            // Actualizar visualmente el botón
            document.querySelectorAll('#player-action-modal .btn').forEach(b => {
                b.style.outline = '';
                b.style.boxShadow = '';
            });
            renderPlayers();
            liveSyncOnAction();
            return;
        }
        p.cards = type;
        logEvent(p, type === 'amarilla' ? 'TARJETA AMARILLA' : 'TARJETA ROJA');
        liveSyncOnAction();
        if (type === 'roja') {
            const teamRedCards = players.filter(x => x.team === p.team && x.cards === 'roja').length;
            const limit = currentMode === 'f7' ? 3 : 5;
            if (p.status === 'field') {
                p.status = 'bench'; p.x = 0; p.y = 0;
                if (isRunning) logMovement(p);
            }
            if (teamRedCards >= limit) {
                terminateMatch(`LÍMITE DE EXPULSIONES ALCANZADO (${limit} en ${p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away})`);
            } else {
                alert(`🟥 TARJETA ROJA: ${p.name} ha sido expulsado y retirado al banquillo automáticamente.`);
            }
        }
        closePlayerActionModal();
        renderPlayers();
    }
}

function terminateMatch(reason) {
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    stopLiveSync(); // marcar partido como finalizado en Firestore
    alert(`🏁 PARTIDO FINALIZADO: ${reason}\nResultado final: ${TEAM_NAMES.home} ${document.getElementById('score-home').textContent} - ${document.getElementById('score-away').textContent} ${TEAM_NAMES.away}`);
}

function endMatch() {
    if (!confirm('¿Finalizar el partido? Esta acción detiene el reloj y cierra el encuentro.')) return;
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    document.getElementById('match-phase-label').textContent = 'FIN DEL PARTIDO';
    const scoreHome = document.getElementById('score-home').textContent;
    const scoreAway = document.getElementById('score-away').textContent;
    
    stopLiveSync(); // marcar partido como finalizado en Firestore
    
    // ── Guardar datos del partido terminado para poder volver ──
    try {
        const matchData = {
            id: 'match_' + Date.now(),
            date: new Date().toISOString(),
            home: TEAM_NAMES.home,
            away: TEAM_NAMES.away,
            scoreHome,
            scoreAway,
            mode: currentMode,
            players: JSON.parse(JSON.stringify(window.players || [])),
            events: JSON.parse(JSON.stringify(window.matchEvents || [])),
            half1Time: typeof half1Time !== 'undefined' ? half1Time : 0,
            half2Time: typeof half2Time !== 'undefined' ? half2Time : 0,
        };
        const saved = JSON.parse(localStorage.getItem('cronos_finished_matches') || '[]');
        saved.unshift(matchData);
        // Guardar máximo 20 partidos
        if (saved.length > 20) saved.length = 20;
        localStorage.setItem('cronos_finished_matches', JSON.stringify(saved));
        window._lastFinishedMatch = matchData;
    } catch(e) { /* silencioso */ }

    // Generar informes técnicos automáticamente para el Staff (Director/Coordinador)
    if (typeof saveAllMatchReportsInternal === 'function') {
        saveAllMatchReportsInternal();
    }

    // Mostrar opciones post-partido
    showPostMatchOptions(scoreHome, scoreAway);
}

function showPostMatchOptions(scoreHome, scoreAway) {
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(95vw,440px);padding:1.5rem;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">🏁</div>
        <h2 style="margin:0 0 0.3rem;color:white;">PARTIDO FINALIZADO</h2>
        <p style="font-size:1.2rem;color:#f0883e;font-weight:800;margin:0.5rem 0;">
            ${TEAM_NAMES.home} ${scoreHome} - ${scoreAway} ${TEAM_NAMES.away}
        </p>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1.2rem;">
            ${new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
        </p>
        <div style="display:flex;flex-direction:column;gap:0.6rem;">
            <button onclick="document.getElementById('setup-modal').style.display='none';"
                style="padding:0.7rem;background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);
                       border-radius:10px;color:var(--primary);font-weight:700;cursor:pointer;font-size:0.9rem;">
                ⚽ VOLVER AL PARTIDO
            </button>
            <button onclick="document.getElementById('setup-modal').style.display='none'; if(typeof openUnifiedCommsMenu==='function') openUnifiedCommsMenu();"
                style="padding:0.7rem;background:rgba(210,168,255,0.12);border:1px solid rgba(210,168,255,0.3);
                       border-radius:10px;color:#d2a8ff;font-weight:700;cursor:pointer;font-size:0.9rem;">
                📊 ENVIAR INFORMES
            </button>
            <button onclick="document.getElementById('setup-modal').style.display='none'; openSetupModal();"
                style="padding:0.7rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
                       border-radius:10px;color:var(--text-muted);font-weight:600;cursor:pointer;font-size:0.85rem;">
                🏠 INICIO
            </button>
        </div>
    </div>`;
}

// ── Ver partidos terminados ──
function showFinishedMatches() {
    const saved = JSON.parse(localStorage.getItem('cronos_finished_matches') || '[]');
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    
    const listHtml = saved.length === 0
        ? '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No hay partidos terminados guardados.</p>'
        : saved.map((m, i) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.7rem 0.8rem;
                        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:0.5rem;">
                <div style="text-align:left;">
                    <div style="font-weight:700;color:white;font-size:0.9rem;">${typeof escapeHtml==='function'?escapeHtml(m.home):m.home} ${m.scoreHome} - ${m.scoreAway} ${typeof escapeHtml==='function'?escapeHtml(m.away):m.away}</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);">${new Date(m.date).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})} · ${m.mode.toUpperCase()}</div>
                </div>
                <button onclick="loadFinishedMatch(${i});"
                    style="padding:0.35rem 0.8rem;background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.3);
                           border-radius:7px;color:#58a6ff;font-size:0.75rem;cursor:pointer;font-weight:700;">
                    VER
                </button>
            </div>`).join('');

    modal.innerHTML = `
    <div class="modal-content" style="width:min(95vw,480px);max-height:90vh;display:flex;flex-direction:column;padding:1.2rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
            <h2 style="margin:0;color:white;font-size:1.1rem;">📋 Partidos Terminados</h2>
            <button onclick="document.getElementById('setup-modal').style.display='none';"
                style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
        </div>
        <div style="flex:1;overflow-y:auto;">
            ${listHtml}
        </div>
    </div>`;
}

function loadFinishedMatch(index) {
    const saved = JSON.parse(localStorage.getItem('cronos_finished_matches') || '[]');
    const m = saved[index];
    if (!m) return;
    
    // Restaurar datos del partido
    if (m.players) window.players = m.players;
    if (m.events) window.matchEvents = m.events;
    if (m.mode) currentMode = m.mode;
    if (m.home) TEAM_NAMES.home = m.home;
    if (m.away) TEAM_NAMES.away = m.away;
    matchPhase = 'finished';
    
    // Actualizar UI
    document.getElementById('score-home').textContent = m.scoreHome;
    document.getElementById('score-away').textContent = m.scoreAway;
    document.getElementById('match-phase-label').textContent = 'FIN DEL PARTIDO';
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    document.getElementById('phase-actions').innerHTML = '';
    
    document.getElementById('setup-modal').style.display = 'none';
    if (typeof renderPlayers === 'function') renderPlayers();
    
    if (typeof showToast === 'function') showToast('📋 Partido cargado: ' + m.home + ' ' + m.scoreHome + '-' + m.scoreAway + ' ' + m.away, 4000);
}
window.showFinishedMatches = showFinishedMatches;
window.loadFinishedMatch = loadFinishedMatch;

function changeGoals(amount) {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (p) {
        const prevGoals = p.goals || 0;
        p.goals = Math.max(0, prevGoals + amount);
        if (amount > 0 && p.goals > prevGoals) {
            logEvent(p, `GOL (${p.goals}º)`);
        }
        document.getElementById('action-player-goals').textContent = `${p.goals} ⚽`;
        syncScoreFromPlayers(p.team);
        renderPlayers();
        liveSyncOnAction();
    }
}

function syncScoreFromPlayers(team) {
    const total = players.filter(x => x.team === team).reduce((sum, x) => sum + (x.goals || 0), 0);
    document.getElementById(`score-${team}`).textContent = total;
}

function clearPlayerActions() {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (p) {
        p.goals = 0; p.cards = 'ninguna'; p.injured = false;
        document.getElementById('action-player-goals').textContent = `${p.goals} ⚽`;
        syncScoreFromPlayers(p.team);
        closePlayerActionModal();
        renderPlayers();
    }
}

function editNameFromModal() {
    if (!activeActionPlayerId) return;
    const player = players.find(p => p.id === activeActionPlayerId);
    const newName = prompt(`Editar nombre para dorsal ${player.number}:`, player.name);
    if (newName !== null && newName.trim() !== "") {
        player.name = newName.trim();
        document.getElementById('action-player-name').innerHTML = `${player.name} <span style="font-size:0.8rem">✏️</span>`;
        renderPlayers();
    }
}

function editNumberFromModal() {
    if (!activeActionPlayerId) return;
    const player = players.find(p => p.id === activeActionPlayerId);
    const newNum = prompt(`Editar dorsal para ${player.name}:`, player.number);
    if (newNum !== null && !isNaN(newNum)) {
        player.number = newNum;
        document.getElementById('action-player-number').innerHTML = `Dorsal ${player.number} <span style="font-size:0.8rem">✏️</span>`;
        renderPlayers();
    }
}

function selectForSubstitution(benchPlayer) {
    pendingSubstitution = { player: benchPlayer };
    closeDrawers();
    document.querySelectorAll('.player-chip').forEach(c => c.classList.remove('sub-selected', 'sub-target'));
    const selectedChip = document.getElementById(`player-${benchPlayer.id}`);
    if (selectedChip) selectedChip.classList.add('sub-selected');
    players.filter(p => p.team === benchPlayer.team && p.status === 'field').forEach(p => {
        const chip = document.getElementById(`player-${p.id}`);
        if (chip) chip.classList.add('sub-target');
    });
    const actionsEl = document.getElementById('phase-actions');
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'btn-cancel-sub';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = '✕ Cancelar cambio';
    cancelBtn.style.cssText = 'background:var(--glass);color:var(--danger);font-size:0.7rem;';
    cancelBtn.onclick = cancelPendingSubstitution;
    if (!document.getElementById('btn-cancel-sub')) actionsEl.appendChild(cancelBtn);
}

function confirmSubstitutionWith(fieldPlayer) {
    if (!pendingSubstitution) return;
    handleSmartSwap(pendingSubstitution.player, fieldPlayer);
    cancelPendingSubstitution();
    renderPlayers();
    liveSyncOnAction();
}

function cancelPendingSubstitution() {
    pendingSubstitution = null;
    document.querySelectorAll('.player-chip').forEach(c => c.classList.remove('sub-selected', 'sub-target'));
    const cancelBtn = document.getElementById('btn-cancel-sub');
    if (cancelBtn) cancelBtn.remove();
    updateMasterUI();
}

// --- CORE FUNCTIONS ---

// ══════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN Y ENVÍO DE EMAIL (EmailJS)
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  MODO DEMO
// ══════════════════════════════════════════════════════════════════

function startDemo() {
    if (!confirm('Se cargará un partido de demostración con jugadores de ejemplo.\n\nLos datos actuales NO se modificarán.\n\n¿Continuar?')) return;

    // Configurar modo demo
    currentMode   = 'f11';
    analyzeAway   = false;
    selectedFormationOnStart = '433';

    TEAM_NAMES.home = 'ATLÉTICO';
    TEAM_NAMES.away = 'VISITANTE';
    COLORS.home = { primary: '#58a6ff', secondary: '#f0883e', shorts: '#0a0e14', text: '#ffffff' };
    COLORS.away = { primary: '#ff5858', secondary: '#f0883e', shorts: '#ffffff', text: '#ffffff' };

    document.getElementById('team-a-name').textContent = TEAM_NAMES.home;
    document.getElementById('team-b-name').textContent = TEAM_NAMES.away;
    document.body.classList.remove('hide-visitor');
    document.body.classList.toggle('mode-f11', true);

    half1MaxTime = 45 * 60;
    half2MaxTime = 45 * 60;

    // Jugadores demo
    const demoPlayers = [
        { number:1,  name:'MOLINA',    status:'field' },
        { number:2,  name:'NAHUEL',    status:'field' },
        { number:3,  name:'LE NORMAND',status:'field' },
        { number:4,  name:'WITSEL',    status:'field' },
        { number:5,  name:'REINILDO',  status:'field' },
        { number:6,  name:'KOKE',      status:'field' },
        { number:8,  name:'SAÚL',      status:'field' },
        { number:10, name:'GRIEZMANN', status:'field' },
        { number:7,  name:'CORREA',    status:'field' },
        { number:9,  name:'MORATA',    status:'field' },
        { number:11, name:'LLORENTE',  status:'field' },
        { number:13, name:'OBLAK',     status:'bench' },
        { number:14, name:'HERMOSO',   status:'bench' },
        { number:17, name:'DE PAUL',   status:'bench' },
        { number:19, name:'ÁLVAREZ',   status:'bench' },
        { number:20, name:'BARRIOS',   status:'bench' },
        { number:22, name:'GALLAGHER', status:'bench' },
        { number:23, name:'RIQUELME',  status:'bench' },
    ];

    players = demoPlayers.map((p, i) => ({
        id: i + 1,
        number: p.number,
        name: p.name,
        team: 'home',
        status: p.status,
        time: p.status === 'field' ? Math.floor(Math.random() * 900) : 0,
        color: COLORS.home.primary,
        shortsColor: COLORS.home.shorts,
        textColor: COLORS.home.text,
        history: [], goals: 0, cards: 'ninguna', x: 0, y: 0
    }));

    document.body.classList.remove('setup-mode', 'hide-visitor');
    document.getElementById('main-header').style.display    = 'flex';
    document.getElementById('main-container').style.display = 'flex';
    document.getElementById('setup-modal').style.display    = 'none';

    renderPlayers();
    applyFormationPreset('433');

    // Marcar visualmente que es demo
    const badge = document.createElement('div');
    badge.id = 'demo-badge';
    badge.textContent = '🎮 MODO DEMO';
    badge.style.cssText =
        'position:fixed;top:8px;left:50%;transform:translateX(-50%);' +
        'background:rgba(88,166,255,0.2);border:1px solid rgba(88,166,255,0.5);' +
        'color:#58a6ff;font-size:0.7rem;font-weight:700;padding:3px 12px;' +
        'border-radius:20px;z-index:9998;pointer-events:none;letter-spacing:1px;';
    document.body.appendChild(badge);

    injectBenchScrollButtons('bench-list');
    const pitch = document.getElementById('football-pitch');
    pitch.addEventListener('click',      () => closeDrawers());
    pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });

    // Mostrar toast de bienvenida al demo
    setTimeout(() => {
        const toast = document.createElement('div');
        toast.innerHTML = '🎮 <strong>Modo Demo</strong> — Explora todas las funciones libremente.<br>' +
            '<span style="font-size:0.75rem;opacity:0.8;">Pulsa ← INICIO para volver a la configuración real</span>';
        toast.style.cssText =
            'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);' +
            'background:#0d2137;border:1px solid rgba(88,166,255,0.4);color:#cdd9e5;' +
            'padding:12px 20px;border-radius:10px;font-size:0.82rem;z-index:9999;' +
            'box-shadow:0 4px 16px rgba(0,0,0,0.5);text-align:center;max-width:90vw;';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 6000);
    }, 500);
}

// ══════════════════════════════════════════════════════════════════
//  TUTORIAL INTERACTIVO
// ══════════════════════════════════════════════════════════════════

const TUTORIAL_STEPS = [
    {
        title: '👋 Bienvenido a Cronos Fútbol',
        text:  'Este tutorial te enseñará a usar todas las funciones de la app en menos de 2 minutos. Puedes cerrarlo en cualquier momento y volver cuando quieras.',
        target: null,
        position: 'center'
    },
    {
        title: '⚙️ Configuración del partido',
        text:  'Aquí introduces los nombres de los equipos, los colores de las equipaciones, la modalidad (Fútbol 7 o Fútbol 11) y el sistema táctico inicial.',
        target: 'setup-modal',
        position: 'center'
    },
    {
        title: '👥 Gestionar Plantilla',
        text:  'Antes de empezar, introduce aquí los nombres y dorsales de tus jugadores. Solo tienes que hacerlo una vez — se guardan automáticamente.',
        target: null,
        position: 'center'
    },
    {
        title: '📋 Convocatoria',
        text:  'Al pulsar "Continuar al partido", seleccionas los jugadores convocados para ese encuentro. Los primeros 11 (o 7 en Fútbol 7) serán titulares; el resto, suplentes.',
        target: null,
        position: 'center'
    },
    {
        title: '⏱️ Cronómetro',
        text:  'Pulsa EMPEZAR para iniciar el tiempo. Los cronómetros de cada jugador arrancan automáticamente. Puedes pausar, reanudar y editar el tiempo tocando los marcadores.',
        target: null,
        position: 'center'
    },
    {
        title: '🔄 Realizar un cambio',
        text:  'Toca un jugador en el campo para ver sus opciones. Puedes sustituirlo arrastrándolo al banquillo o usando el menú de acciones. El tiempo se registra automáticamente.',
        target: null,
        position: 'center'
    },
    {
        title: '💾 Guardar equipo',
        text:  'Con el botón GUARDAR puedes salvar la convocatoria, los colores, el sistema y las posiciones. La próxima vez, cárgalo desde el desplegable y todo estará listo.',
        target: null,
        position: 'center'
    },
    {
        title: '📊 Exportar informe',
        text:  'Al pulsar DESCARGAR se genera un informe con los tiempos de cada jugador, goles y tarjetas. Se descarga en tu dispositivo y se envía automáticamente al Director Deportivo si tienes el email configurado.',
        target: null,
        position: 'center'
    },
    {
        title: '📧 Configurar email y WhatsApp',
        text:  'En el botón EMAIL (pantalla de configuración) introduces el correo del Director Deportivo y su WhatsApp. Cada informe llegará automáticamente al exportar.',
        target: null,
        position: 'center'
    },
    {
        title: '🎮 Prueba el Modo Demo',
        text:  'Usa el botón DEMO para explorar la app con un partido de ejemplo sin tocar tus datos reales. Ideal para practicar antes del primer partido.',
        target: null,
        position: 'center'
    },
    {
        title: '✅ ¡Ya estás listo!',
        text:  'Eso es todo. Recuerda que puedes volver a este tutorial cuando quieras desde el botón ❓ TUTORIAL en la pantalla de configuración. ¡Mucho éxito en los partidos!',
        target: null,
        position: 'center'
    }
];

let tutorialStep = 0;

function startTutorial() {
    tutorialStep = 0;
    renderTutorialStep();
}

function renderTutorialStep() {
    // Eliminar overlay anterior si existe
    const prev = document.getElementById('tutorial-overlay');
    if (prev) prev.remove();

    if (tutorialStep >= TUTORIAL_STEPS.length) {
        // Tutorial completado
        cloudSet('cronos_tutorial_done', '1');
        return;
    }

    const step = TUTORIAL_STEPS[tutorialStep];
    const total = TUTORIAL_STEPS.length;
    const isFirst = tutorialStep === 0;
    const isLast  = tutorialStep === total - 1;

    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;' +
        'display:flex;align-items:center;justify-content:center;padding:1rem;' +
        'backdrop-filter:blur(3px);';

    overlay.innerHTML = `
        <div style="background:#0d1117;border:1px solid rgba(88,166,255,0.4);
                    border-radius:16px;padding:1.8rem;width:min(92vw,440px);
                    box-shadow:0 8px 32px rgba(0,0,0,0.6);">

            <!-- Progreso -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <span style="font-size:0.72rem;color:#7d8590;">
                    Paso ${tutorialStep + 1} de ${total}
                </span>
                <div style="display:flex;gap:4px;">
                    ${Array.from({length: total}, (_, i) =>
                        `<div style="width:${i === tutorialStep ? 18 : 6}px;height:6px;border-radius:3px;
                            background:${i === tutorialStep ? '#58a6ff' : i < tutorialStep ? 'rgba(88,166,255,0.4)' : 'rgba(255,255,255,0.1)'};
                            transition:all 0.3s;"></div>`
                    ).join('')}
                </div>
                <button onclick="closeTutorial()"
                    style="background:none;border:none;color:#7d8590;cursor:pointer;
                           font-size:1.1rem;padding:0;line-height:1;">✕</button>
            </div>

            <!-- Contenido -->
            <h3 style="color:#cdd9e5;font-size:1.1rem;margin:0 0 0.7rem;font-family:'Outfit',sans-serif;">
                ${step.title}
            </h3>
            <p style="color:#7d8590;font-size:0.88rem;line-height:1.6;margin:0 0 1.5rem;">
                ${step.text}
            </p>

            <!-- Botones de navegación -->
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.6rem;">
                <button onclick="tutorialPrev()"
                    style="flex:1;padding:0.65rem;background:var(--glass);border:1px solid var(--glass-border);
                           border-radius:8px;color:#7d8590;cursor:pointer;font-size:0.85rem;
                           ${isFirst ? 'visibility:hidden;' : ''}">
                    ← Anterior
                </button>
                ${isLast
                    ? `<button onclick="closeTutorial()"
                           style="flex:2;padding:0.65rem;background:#58a6ff;border:none;
                                  border-radius:8px;color:#0a0e14;font-weight:700;
                                  cursor:pointer;font-size:0.9rem;">
                           ✅ ¡Listo!
                       </button>`
                    : `<button onclick="tutorialNext()"
                           style="flex:2;padding:0.65rem;background:#58a6ff;border:none;
                                  border-radius:8px;color:#0a0e14;font-weight:700;
                                  cursor:pointer;font-size:0.9rem;">
                           Siguiente →
                       </button>`
                }
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
}

function tutorialNext() {
    tutorialStep++;
    renderTutorialStep();
}

function tutorialPrev() {
    if (tutorialStep > 0) {
        tutorialStep--;
        renderTutorialStep();
    }
}

function closeTutorial() {
    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) overlay.remove();
}

// ══════════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN EN VIVO — Firestore
// ══════════════════════════════════════════════════════════════════

async function cleanupStaleMatches() {
    try {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) return;
        const { collection, query, where, getDocs,
                updateDoc, deleteDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // Obtener todos los partidos
        const snap = await getDocs(collection(fa.db, 'live_matches'));

        let closed = 0, deleted = 0;
        const promises = [];

        snap.forEach(d => {
            const data    = d.data();
            const updated = data.updatedAt?.toDate?.() || new Date(0);

            if (updated < sevenDaysAgo) {
                // Más de 7 días → borrar definitivamente
                promises.push(
                    deleteDoc(doc(fa.db, 'live_matches', d.id))
                        .then(() => deleted++)
                        .catch(() => {})
                );
            } else if (data.status === 'active' && updated < fourHoursAgo) {
                // Más de 4 horas sin actualizar → cerrar como finalizado
                promises.push(
                    updateDoc(doc(fa.db, 'live_matches', d.id), { status: 'finished' })
                        .then(() => closed++)
                        .catch(() => {})
                );
            }
        });

        await Promise.all(promises);

        if (closed > 0)   console.log('Partidos zombis cerrados:', closed);
        if (deleted > 0)  console.log('Partidos antiguos borrados:', deleted);

    } catch(e) { console.warn('cleanupStaleMatches:', e.message); }
}

async function startLiveSync() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) return;

    // Generar ID legible: nombre-equipo-fecha  (ej: atletico-20032026-a3f)
    // Así en el historial y en los enlaces se identifica el equipo de un vistazo
    const slugify = (str) => (str || 'equipo')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
        .replace(/[^a-z0-9]+/g, '-')                        // solo letras y números
        .replace(/^-+|-+$/g, '')                            // sin guiones al inicio/fin
        .substring(0, 20);                                   // máximo 20 chars

    const teamSlug = slugify(TEAM_NAMES.home);
    const now      = new Date();
    const dateSlug = String(now.getDate()).padStart(2,'0') +
                     String(now.getMonth()+1).padStart(2,'0') +
                     now.getFullYear();
    const randSlug = Math.random().toString(36).substr(2,4);
    liveMatchId    = `${teamSlug}-${dateSlug}-${randSlug}`;
    liveIsActive = true;

    // Guardar el snapshot inicial
    await pushLiveSnapshot('active');

    // Sincronizar el cronómetro cada 5 segundos (antes era 15s)
    liveSyncTimer = setInterval(() => {
        if (liveIsActive && isRunning) pushLiveSnapshot('active');
    }, 5000);

    // Mostrar botón de compartir en el header
    updateLiveButton(true);
    console.log('🔴 Live sync iniciado:', liveMatchId);
}

async function pushLiveSnapshot(status = 'active') {
    const fa = window._cronos_auth;
    if (!fa || !fa.db || !liveMatchId) return;

    try {
        const { setDoc, doc, serverTimestamp } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const scoreHome = document.getElementById('score-home')?.textContent || '0';
        const scoreAway = document.getElementById('score-away')?.textContent || '0';

        const snapshot = {
            id:          liveMatchId,
            status:      status,          // 'active' | 'finished'
            updatedAt:   serverTimestamp(),
            createdBy:   window._cronosCurrentUser?.uid   || '',
            coachEmail:  window._cronosCurrentUser?.email || '',

            // Partido
            mode:        currentMode,
            phase:       matchPhase,
            isRunning:   isRunning,
            timeH1:      masterTimeH1,
            timeH2:      masterTimeH2,
            formation:   activeFormationKey || '',

            // Equipos
            homeTeam: {
                name:     TEAM_NAMES.home,
                score:    parseInt(scoreHome) || 0,
                color:    COLORS.home.primary,
                shorts:   COLORS.home.shorts,
                textColor:COLORS.home.text
            },
            awayTeam: {
                name:     TEAM_NAMES.away,
                score:    parseInt(scoreAway) || 0,
                color:    COLORS.away.primary,
                shorts:   COLORS.away.shorts,
                textColor:COLORS.away.text
            },

            // Jugadores (campo + banquillo)
            players: players.map(p => ({
                id:      p.id,
                number:  p.number,
                name:    p.name,
                team:    p.team,
                status:  p.status,    // 'field' | 'bench'
                time:    p.time,
                goals:   p.goals   || 0,
                cards:   p.cards   || 'ninguna',
                injured: p.injured || false,
                x:       p.x       || 0,
                y:       p.y       || 0
            }))
        };

        await setDoc(doc(fa.db, 'live_matches', liveMatchId), snapshot);
    } catch (err) {
        console.warn('Error sync live:', err.message);
    }
}

async function stopLiveSync() {
    if (!liveIsActive) return;
    liveIsActive = false;
    if (liveSyncTimer) { clearInterval(liveSyncTimer); liveSyncTimer = null; }
    await pushLiveSnapshot('finished');
    updateLiveButton(false);
    console.log('⏹ Live sync detenido');
}

function updateLiveButton(active) {
    let btn = document.getElementById('btn-live-share');
    if (!btn) {
        // Crear el botón si no existe e insertarlo en header-actions
        btn = document.createElement('button');
        btn.id = 'btn-live-share';
        btn.title = 'Compartir partido en vivo';
        btn.style.cssText =
            'font-size:0.65rem; padding:0.3rem 0.6rem; border-radius:6px; cursor:pointer;';
        btn.onclick = showLiveShareModal;
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) headerActions.insertBefore(btn, headerActions.firstChild);
    }
    if (active) {
        btn.textContent   = '🔴 EN VIVO';
        btn.style.background = 'rgba(255,88,88,0.2)';
        btn.style.border     = '1px solid rgba(255,88,88,0.6)';
        btn.style.color      = '#ff5858';
        btn.style.animation  = 'livePulse 1.5s ease-in-out infinite';
        // Añadir keyframe si no existe
        if (!document.getElementById('live-pulse-style')) {
            const s = document.createElement('style');
            s.id = 'live-pulse-style';
            s.textContent = '@keyframes livePulse{0%,100%{opacity:1}50%{opacity:0.5}}';
            document.head.appendChild(s);
        }
    } else {
        btn.textContent      = '📡 INICIAR VIVO';
        btn.style.background = 'rgba(88,166,255,0.1)';
        btn.style.border     = '1px solid rgba(88,166,255,0.3)';
        btn.style.color      = '#58a6ff';
        btn.style.animation  = 'none';
    }
}

function openLiveView() {
    // Abrir la pantalla de partidos en vivo en una nueva pestaña
    const liveUrl = location.origin + location.pathname.replace('index.html','') + 'live.html';
    window.open(liveUrl, '_blank');
}

function showLiveShareModal() {
    if (!liveMatchId) {
        // No hay partido activo — preguntar si quiere iniciarlo
        if (confirm('¿Iniciar la transmisión en vivo para que el Director Deportivo pueda seguir el partido?')) {
            startLiveSync();
        }
        return;
    }

    const liveUrl = `${location.origin}${location.pathname.replace('index.html','')}live.html?match=${liveMatchId}`;

    // Recoger contactos con acceso EN VIVO (staff + padres ya se envían por Firestore)
    const liveContacts = (emailConfig.contacts || []).filter(c => c.tags && c.tags.includes('live'));
    const liveCount    = liveContacts.length;

    const liveContactsHtml = liveCount > 0
        ? `<div style="background:rgba(255,88,88,0.06);border:1px solid rgba(255,88,88,0.2);
                        border-radius:8px;padding:0.7rem 0.9rem;margin-bottom:1rem;">
               <p style="font-size:0.7rem;color:#ff5858;font-weight:700;margin:0 0 0.5rem;">
                   📡 ACCESO EN VIVO AUTORIZADO (${liveCount})
               </p>
               <div style="display:flex;flex-direction:column;gap:0.3rem;">
                   ${liveContacts.map(c => `
                   <div style="display:flex;align-items:center;justify-content:space-between;
                               font-size:0.75rem;color:var(--text-muted);">
                       <span>✅ ${c.name || c.email}</span>
                       <span style="display:flex;gap:0.3rem;">
                           ${c.phone ? `<a href="https://wa.me/${c.phone}?text=${encodeURIComponent('⚽ Partido en vivo: ' + liveUrl)}" target="_blank"
                               style="padding:2px 8px;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.4);
                                      border-radius:5px;color:#25d366;text-decoration:none;font-size:0.68rem;font-weight:700;">
                               📱 WA</a>` : ''}
                           ${c.email ? `<a href="mailto:${c.email}?subject=${encodeURIComponent('⚽ Partido en Vivo — ' + TEAM_NAMES.home + ' vs ' + TEAM_NAMES.away)}&body=${encodeURIComponent('Sigue el partido en tiempo real:\n' + liveUrl)}" target="_blank"
                               style="padding:2px 8px;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                                      border-radius:5px;color:#58a6ff;text-decoration:none;font-size:0.68rem;font-weight:700;">
                               📧</a>` : ''}
                       </span>
                   </div>`).join('')}
               </div>
               <button onclick="notifyAllLiveContacts('${liveUrl}')"
                   style="margin-top:0.7rem;width:100%;padding:0.55rem;
                          background:rgba(255,88,88,0.2);border:1px solid rgba(255,88,88,0.5);
                          border-radius:7px;color:#ff5858;font-weight:700;
                          font-size:0.8rem;cursor:pointer;">
                   📡 Notificar a todos por WhatsApp
               </button>
           </div>`
        : `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
                        border-radius:8px;padding:0.6rem 0.9rem;margin-bottom:1rem;
                        font-size:0.73rem;color:var(--text-muted);text-align:center;">
               📡 Sin contactos con acceso EN VIVO configurados.<br>
               <span style="font-size:0.68rem;">Ve a <strong>Comunicaciones → Gestión de Contactos</strong>
               y activa la casilla 📡 EN VIVO en quien quieras.</span>
           </div>`;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(95vw,500px);">
            <h2 style="margin:0 0 0.3rem; text-align:center;">🔴 Partido en Vivo</h2>
            <p style="color:var(--text-muted); font-size:0.8rem; text-align:center; margin-bottom:1.2rem;">
                Comparte este enlace con el Director Deportivo para que siga el partido en tiempo real.
                Solo usuarios registrados y autorizados pueden verlo.
            </p>

            <!-- URL -->
            <div style="background:rgba(255,88,88,0.08); border:1px solid rgba(255,88,88,0.3);
                        border-radius:10px; padding:0.9rem; margin-bottom:1rem;">
                <p style="font-size:0.7rem; color:#7d8590; margin:0 0 0.4rem;">🔗 Enlace del partido</p>
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <input id="live-url-input" type="text" value="${liveUrl}" readonly
                        style="flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                               border-radius:6px; padding:0.5rem 0.7rem; color:#cdd9e5;
                               font-size:0.75rem; font-family:monospace; outline:none;">
                    <button onclick="copyLiveUrl()"
                        style="padding:0.5rem 0.8rem; background:#58a6ff; border:none;
                               border-radius:6px; color:#0a0e14; font-weight:700;
                               font-size:0.75rem; cursor:pointer; white-space:nowrap;">
                        📋 Copiar
                    </button>
                </div>
            </div>

            <!-- Contactos EN VIVO -->
            ${liveContactsHtml}

            <!-- Botones de compartir manual -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-bottom:1rem;">
                <button onclick="shareLiveWhatsApp('${liveUrl}')"
                    style="padding:0.7rem; background:rgba(37,211,102,0.12);
                           border:1px solid rgba(37,211,102,0.4); border-radius:8px;
                           color:#25d366; font-weight:700; font-size:0.85rem; cursor:pointer;">
                    📱 WhatsApp
                </button>
                <button onclick="shareLiveEmail('${liveUrl}')"
                    style="padding:0.7rem; background:rgba(88,166,255,0.1);
                           border:1px solid rgba(88,166,255,0.3); border-radius:8px;
                           color:#58a6ff; font-weight:700; font-size:0.85rem; cursor:pointer;">
                    📧 Email
                </button>
            </div>

            <div style="display:flex; justify-content:space-between; gap:0.6rem;">
                <button class="btn danger" onclick="confirmStopLive()"
                    style="font-size:0.82rem;">
                    ⏹ Finalizar transmisión
                </button>
                <button class="btn primary" onclick="document.getElementById('setup-modal').style.display='none'">
                    ✕ Cerrar
                </button>
            </div>
        </div>`;
}

function copyLiveUrl() {
    const input = document.getElementById('live-url-input');
    if (!input) return;
    navigator.clipboard.writeText(input.value).then(() => {
        const btn = input.nextElementSibling;
        btn.textContent = '✅ Copiado';
        setTimeout(() => btn.textContent = '📋 Copiar', 2000);
    }).catch(() => { input.select(); document.execCommand('copy'); });
}

function shareLiveWhatsApp(url) {
    const date = new Date().toLocaleDateString('es-ES');
    const msg  = encodeURIComponent(
        `⚽ *CRONOS FÚTBOL — Partido en Vivo*\n` +
        `${TEAM_NAMES.home} vs ${TEAM_NAMES.away} · ${date}\n\n` +
        `Sigue el partido en tiempo real:\n${url}\n\n` +
        `_(Necesitas estar registrado en la app para verlo)_`);
    const num = emailConfig?.whatsappNumber;
    window.open(num ? `https://wa.me/${num}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank');
}

function shareLiveEmail(url) {
    const date    = new Date().toLocaleDateString('es-ES');
    const subject = encodeURIComponent(`⚽ Partido en Vivo — ${TEAM_NAMES.home} vs ${TEAM_NAMES.away}`);
    const body    = encodeURIComponent(
        `Hola,\n\n` +
        `Puedes seguir el partido en tiempo real desde este enlace:\n${url}\n\n` +
        `${TEAM_NAMES.home} vs ${TEAM_NAMES.away} · ${date}\n\n` +
        `Necesitas estar registrado y autorizado en Cronos Fútbol para acceder.\n\n` +
        `Cronos Fútbol — Coach Assistant`);
    const to = emailConfig?.directorEmail || '';
    window.open(`mailto:${to}?subject=${subject}&body=${body}`);
}

// ── Notificar a todos los contactos con acceso EN VIVO ──────────────
window.notifyAllLiveContacts = function(url) {
    const liveContacts = (emailConfig.contacts || []).filter(c => c.tags && c.tags.includes('live') && c.phone);
    if (!liveContacts.length) {
        showToast('⚠️ Ningún contacto tiene WhatsApp configurado para EN VIVO', 4000);
        return;
    }
    const date    = new Date().toLocaleDateString('es-ES');
    const msg     = encodeURIComponent(
        `⚽ *PARTIDO EN VIVO — ${TEAM_NAMES.home} vs ${TEAM_NAMES.away}*\n` +
        `📅 ${date}\n\n` +
        `Sigue el partido en tiempo real aquí:\n${url}\n\n` +
        `_Cronos Fútbol_`);
    let opened = 0;
    liveContacts.forEach((c, i) => {
        // Abrimos ventanas escalonadas para no bloquear pop-ups
        setTimeout(() => {
            window.open(`https://wa.me/${c.phone}?text=${msg}`, '_blank');
        }, i * 600);
        opened++;
    });
    showToast(`📡 WhatsApp abierto para ${opened} contacto${opened > 1 ? 's' : ''} con acceso EN VIVO`, 4000);
};

function confirmStopLive() {
    if (confirm('¿Finalizar la transmisión en vivo?\n\nEl enlace quedará guardado como historial.')) {
        stopLiveSync();
        document.getElementById('setup-modal').style.display = 'none';
    }
}

// Llamar a pushLiveSnapshot en cada acción relevante del partido
function liveSyncOnAction() {
    if (liveIsActive) pushLiveSnapshot('active');
}

// ══════════════════════════════════════════════════════════════════
//  CAPA DE ALMACENAMIENTO EN LA NUBE (Firestore)
//  Sustituye localStorage de forma transparente.
//  El resto del código no cambia — solo se llaman estas funciones.
// ══════════════════════════════════════════════════════════════════

// ── Referencia al doc de settings del usuario actual ─────────────
function _userRef() {
    const fa  = window._cronos_auth;
    const uid = window._cronosCurrentUser?.uid;
    if (!fa || !uid) return null;
    return fa.doc(fa.db, 'users', uid);
}

// ── Guardar un campo en el subdocumento 'data' del usuario ────────
async function cloudSet(key, value) {
    try {
        const fa  = window._cronos_auth;
        const uid = window._cronosCurrentUser?.uid;
        if (!fa || !uid) {
            // Sin sesión: fallback a localStorage
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            return;
        }
        const { setDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await setDoc(
            doc(fa.db, 'users', uid, 'cronos_data', 'main'),
            { [key]: typeof value === 'string' ? value : JSON.stringify(value) },
            { merge: true }
        );
        // También en localStorage como caché local
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch(e) {
        console.warn('cloudSet error, usando localStorage:', e.message);
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
}

// ── Leer un campo (primero localStorage como caché, luego Firestore) ─
async function cloudGet(key, defaultValue) {
    // Devolver caché local inmediatamente para no bloquear la UI
    const cached = localStorage.getItem(key);
    if (cached !== null) return cached;
    // Si no hay caché, intentar Firestore
    try {
        const fa  = window._cronos_auth;
        const uid = window._cronosCurrentUser?.uid;
        if (!fa || !uid) return defaultValue ?? null;
        const { getDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await getDoc(doc(fa.db, 'users', uid, 'cronos_data', 'main'));
        if (snap.exists()) {
            const val = snap.data()[key];
            if (val !== undefined) {
                localStorage.setItem(key, val); // poblar caché
                return val;
            }
        }
    } catch(e) {
        console.warn('cloudGet error:', e.message);
    }
    return defaultValue ?? null;
}

// ── Sincronización inicial: cargar TODO desde Firestore al entrar ──
async function syncFromCloud() {
    // Lectura única — usada solo en la migración inicial
    try {
        const fa  = window._cronos_auth;
        const uid = window._cronosCurrentUser?.uid;
        if (!fa || !uid) return;
        const { getDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await getDoc(doc(fa.db, 'users', uid, 'cronos_data', 'main'));
        if (snap.exists()) {
            const data = snap.data();
            Object.entries(data).forEach(([k, v]) => {
                if (k.startsWith('cronos_')) localStorage.setItem(k, v);
            });
            console.log('☁️ Datos sincronizados desde Firestore');
        }
    } catch(e) {
        console.warn('syncFromCloud error:', e.message);
    }
}

// ── Listener en tiempo real: cualquier cambio en Firestore ────────
// se aplica automáticamente en este dispositivo al instante
let _realtimeUnsubscribe = null;

async function startRealtimeSync() {
    const fa  = window._cronos_auth;
    const uid = window._cronosCurrentUser?.uid;
    if (!fa || !uid) return;

    // Cancelar listener anterior si existía
    if (_realtimeUnsubscribe) { _realtimeUnsubscribe(); _realtimeUnsubscribe = null; }

    try {
        const { onSnapshot, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const docRef = doc(fa.db, 'users', uid, 'cronos_data', 'main');

        _realtimeUnsubscribe = onSnapshot(docRef, (snap) => {
            if (!snap.exists()) return;
            if (snap.metadata.hasPendingWrites) return; // ignorar escrituras propias

            const data     = snap.data();
            let   changed  = false;

            Object.entries(data).forEach(([k, v]) => {
                if (!k.startsWith('cronos_')) return;
                const current = localStorage.getItem(k);
                if (current !== v) {
                    localStorage.setItem(k, v);
                    changed = true;
                }
            });

            if (changed) {
                console.log('🔄 Datos actualizados desde otro dispositivo');
                // Recargar configuraciones en memoria
                loadEmailConfig();
                loadStaffConfig();

                // Si estamos en la pantalla de configuración, recargar equipos guardados
                const setupModal = document.getElementById('setup-modal');
                if (setupModal && setupModal.style.display !== 'none') {
                    populateSavedTeams('home');
                    populateSavedTeams('away');
                }

                // Toast discreto para informar al usuario
                showToast('🔄 Datos actualizados desde otro dispositivo');
            }
        }, (err) => {
            console.warn('Realtime sync error:', err.message);
        });

        console.log('✅ Sincronización en tiempo real activa');
    } catch(e) {
        console.warn('startRealtimeSync error:', e.message);
    }
}

function stopRealtimeSync() {
    if (_realtimeUnsubscribe) {
        _realtimeUnsubscribe();
        _realtimeUnsubscribe = null;
        console.log('⏹ Sincronización en tiempo real detenida');
    }
}

// ── Migración: subir datos locales existentes a Firestore ─────────
async function migrateLocalToCloud() {
    const keys = [
        'cronos_master_roster', 'cronos_teams',
        'cronos_staff', 'cronos_email_config', 'cronos_tutorial_done'
    ];
    const fa  = window._cronos_auth;
    const uid = window._cronosCurrentUser?.uid;
    if (!fa || !uid) return;

    try {
        const { setDoc, doc, getDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // Comprobar si ya hay datos en Firestore
        const snap = await getDoc(doc(fa.db, 'users', uid, 'cronos_data', 'main'));
        if (snap.exists() && snap.data().cronos_master_roster) {
            // Ya tiene datos en la nube — sincronizar hacia local
            await syncFromCloud();
            return;
        }

        // Primera vez: subir datos locales a Firestore
        const payload = {};
        let hasData = false;
        keys.forEach(k => {
            const val = localStorage.getItem(k);
            if (val) { payload[k] = val; hasData = true; }
        });

        if (hasData) {
            await setDoc(
                doc(fa.db, 'users', uid, 'cronos_data', 'main'),
                payload,
                { merge: true }
            );
            console.log('☁️ Datos locales migrados a Firestore');
            showToast('☁️ Datos guardados en la nube');
        }
    } catch(e) {
        console.warn('migrateLocalToCloud error:', e.message);
    }
}

function loadEmailConfig() {
    const saved = localStorage.getItem('cronos_email_config');
    if (saved) {
        try { emailConfig = { ...emailConfig, ...JSON.parse(saved) }; } catch(e) {}
    }
    initEmailJS();
}

function initEmailJS() {
    if (emailConfig.emailjsPublicKey && typeof emailjs !== 'undefined') {
        emailjs.init(emailConfig.emailjsPublicKey);
        window._emailjsReady = true;
    }
}


function testWhatsApp() {
    loadEmailConfig();
    const num = (document.getElementById('cfg-whatsapp')?.value || emailConfig.whatsappNumber || '').replace(/[^0-9]/g,'');
    if (!num) { alert('Introduce primero el número de WhatsApp.'); return; }
    const msg = encodeURIComponent('✅ Prueba Cronos Fútbol\nSi recibes esto, el envío automático está listo. ⚽');
    window.open('https://wa.me/' + num + '?text=' + msg, '_blank');
}


async function sendReportByEmail(matchInfo, reportHtml) {
    if (!emailConfig.contacts || emailConfig.contacts.length === 0) {
        // Fallback para legacy
        if (!emailConfig.directorEmail) return;
        emailConfig.contacts = [{ name: 'Director', email: emailConfig.directorEmail, tags: ['reports'] }];
    }

    const recipients = emailConfig.contacts.filter(c => c.tags.includes('reports') && c.email);
    if (recipients.length === 0) return;

    if (!emailConfig.emailjsServiceId || !emailConfig.emailjsTemplateId || !emailConfig.emailjsPublicKey) return;

    if (!window._emailjsReady) {
        initEmailJS();
        if (!window._emailjsReady) return;
    }

    const date = new Date().toLocaleDateString('es-ES');
    let successCount = 0;

    for (const contact of recipients) {
        try {
            await emailjs.send(
                emailConfig.emailjsServiceId,
                emailConfig.emailjsTemplateId,
                {
                    to_name:     contact.name,
                    to_email:    contact.email,
                    coach_email: emailConfig.coachEmail || '',
                    subject:     `📊 Informe de Partido — ${matchInfo} — ${date}`,
                    match_info:  matchInfo,
                    report_body: reportHtml
                }
            );
            successCount++;
            console.log(`✅ Informe enviado a ${contact.name} (${contact.email})`);
        } catch(err) {
            console.error(`Error enviando email a ${contact.email}:`, err);
        }
    }

    if (successCount === 0) {
        const toast = document.createElement('div');
        toast.textContent = '⚠️ El informe se descargó, pero no pudo enviarse por email.';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
            'background:#c0392b;color:#fff;padding:10px 20px;border-radius:8px;' +
            'font-size:0.82rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }
}

function init(role) {
    loadEmailConfig();    // carga correos (desde localStorage/caché)
    loadStaffConfig();    // carga cuerpo técnico (desde localStorage/cacché)
    setupEventListeners();
    
    // Solo abrir configuración de partido si es entrenador/usuario
    if (!['director', 'coordinator', 'club_admin'].includes(role)) {
        openSetupModal();
    }
    registerServiceWorker();
    // Sincronizar con Firestore en segundo plano
    migrateLocalToCloud().then(() => {
        loadEmailConfig();
        loadStaffConfig();
        startRealtimeSync();
        cleanupStaleMatches();
    });
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(reg => {
            console.log('Cronos PWA Ready');

            // Comprobar si hay actualización disponible cada vez que se abre la app
            reg.update().catch(() => {});

            reg.onupdatefound = () => {
                const newWorker = reg.installing;
                newWorker.onstatechange = () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // Nueva versión lista → guardar sesión y recargar automáticamente
                        sessionStorage.setItem('cronos_post_update', '1');
                        const toast = document.createElement('div');
                        toast.innerHTML = '🔄 Actualizando Cronos Fútbol…';
                        toast.style.cssText =
                            'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
                            'background:#1a7a3e;color:#fff;padding:10px 24px;border-radius:8px;' +
                            'font-size:0.88rem;font-weight:bold;z-index:99999;' +
                            'box-shadow:0 4px 16px rgba(0,0,0,0.5);';
                        document.body.appendChild(toast);
                        // Recargar tras 1.5 s para que el toast sea visible
                        setTimeout(() => window.location.reload(), 1500);
                    }
                };
            };
        })
        .catch(err => console.log('SW Error:', err));

    // Si el SW toma el control mientras la página está abierta → recargar también
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    });
}

async function forceUpdate() {
    if (confirm('Esto forzará la descarga de la última versión. ¿Continuar?')) {
        // Marcar que venimos de una actualización para restaurar la sesión al volver
        sessionStorage.setItem('cronos_post_update', '1');

        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let registration of registrations) await registration.unregister();
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            for (let key of keys) await caches.delete(key);
        }
        window.location.href = window.location.pathname + '?v=' + Date.now();
    }
}

function openSetupModal() {
    document.body.classList.add('setup-mode');
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:860px; max-width:98vw;">
            <!-- Cabecera con título y botón de cerrar sesión -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.2rem;">
                <div style="display:flex;align-items:center;"><img src="data:image/png;base64,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KxRLo8FVwA2rl+GaFcPB5ZEnPuUJLTxpQk8Yx1iLbg4UGm1I4eWOu9N63u/bsZ6ZmMx+id5qCGLsGF+tP07yiiFUVjil0lkV+YU4TQfjWN3oG5ybG/w5KbDPGoSOhPVDIPRhZOSFIgy2y9HhJ371z6nGSUtkzxm8YShyrml3Gld22/azVqEFICk0Ii1QUgqPdhWes8CkAUZ8DyOlAIUrIeACoe/Dd30YpNBGiVYM9fgCNgO9xVv7ElqcxIFdVHvX1i4lzmcCZ3+ogk8uL7mfiUr+TTKQRqFo5Lp4ydX2WgFhQgfS9zxABMIaE2tjHqjH+eGpunr66S4eB4Aj3jw8oa4LcJ6UuDkElg+W0FIJruvGuDwDTCghNYDc4kFrUVfAQB3403Jgz/IoKjkR7FQ9iWPgagvIfcATQ4C3voS7yg6yLMH6QuPawMf9paHgmYdq2SN4c9FVJljEBIvomJOT3rpQ2LRp3FiLN2esHN2N9ml1LB8H3CcFVH/zrwEuDSIElQjDroMbHQkURu7IC/N8olH6extbjziQU3JgJ2L+2smouC3FR99bosvXAes1sHcvML0GOCsARv8DbH/77s6+bQht+RKclxYfRb2XCe0GwNliYZYqfeuAyuoQHzQ+8sIDrID2DFwPQOS58AVsI4PfSNX+FxIcfLPKBzk2fnLaXq1W5a5du8TExMS7uIkRixHcd86FQHXjxt513LTJLAYcOz9igkX0XsdrtS9uN/UNHKZvwcfFeUmnYy8tltrfX6l4pwrYaXRMvfZXew0a6z2mshvfbtHixd+d7LZbQIxVIfo37+7PRJeqfrsAcfFRtuM0ON9vxMq7SZCW4mUXICbegwpu9YhrvxQT/d8dGR9vMW/QvtV/vD++Fo/HgJUrYoJFREdBVhcHwyFA4gpg9zbYTywOqKfgMeD/Q5+2lFvZvs/v9/MoqkfRX5/GNxZERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERET0fvVf00osqQkrR9sAAAAASUVORK5CYII=" alt="Chronos Fútbol" style="height:90px;width:auto;object-fit:contain;display:block;"></div>
                <button onclick="cerrarSesion()"
                    title="Cerrar sesión y salir de la app"
                    style="display:flex;align-items:center;gap:0.4rem;
                           background:none; border:1px solid rgba(255,88,88,0.3);
                           color:rgba(255,88,88,0.7); font-size:0.75rem;
                           padding:0.35rem 0.8rem; border-radius:6px; cursor:pointer;">
                    ⏻ Salir
                </button>
            </div>

            <!-- FILA: Local | Visitante -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; margin-bottom:1rem;">

                <!-- LOCAL -->
                <div style="border:1px solid var(--glass-border); border-radius:10px; padding:1rem;">
                    <h3 style="margin:0 0 0.8rem; color:#58a6ff; text-align:center; border-bottom:2px solid #58a6ff; padding-bottom:6px;">Equipo Local</h3>
                    <div class="form-group">
                        <label>Cargar Guardado</label>
                        <select id="saved-teams-home" onchange="loadTeamFromDropdown('home')">
                            <option value="">-- Cargar --</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Nombre</label>
                        <input type="text" id="setup-home-name" value="LOCAL">
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.6rem; margin-top:0.4rem;">
                        <div class="form-group">
                            <label>Camiseta</label>
                            <input type="color" id="setup-home-color" value="#58a6ff"
                                style="width:100%;height:42px;border-radius:8px;border:2px solid var(--glass-border);cursor:pointer;padding:3px;background:none;">
                        </div>
                        <div class="form-group">
                            <label>Pantalón</label>
                            <input type="color" id="setup-home-shorts" value="#ffffff"
                                style="width:100%;height:42px;border-radius:8px;border:2px solid var(--glass-border);cursor:pointer;padding:3px;background:none;">
                        </div>
                        <div class="form-group">
                            <label>Dorsal</label>
                            <input type="color" id="setup-home-text" value="#ffffff"
                                style="width:100%;height:42px;border-radius:8px;border:2px solid var(--glass-border);cursor:pointer;padding:3px;background:none;">
                        </div>
                    </div>
                </div>

                <!-- VISITANTE -->
                <div style="border:1px solid var(--glass-border); border-radius:10px; padding:1rem;">
                    <h3 style="margin:0 0 0.8rem; color:#ff5858; text-align:center; border-bottom:2px solid #ff5858; padding-bottom:6px;">Equipo Visitante</h3>
                    <div class="form-group">
                        <label>Cargar Guardado</label>
                        <select id="saved-teams-away" onchange="loadTeamFromDropdown('away')">
                            <option value="">-- Cargar --</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Nombre</label>
                        <input type="text" id="setup-away-name" value="VISITANTE">
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.6rem; margin-top:0.4rem;">
                        <div class="form-group">
                            <label>Camiseta</label>
                            <input type="color" id="setup-away-color" value="#ff5858"
                                style="width:100%;height:42px;border-radius:8px;border:2px solid var(--glass-border);cursor:pointer;padding:3px;background:none;">
                        </div>
                        <div class="form-group">
                            <label>Pantalón</label>
                            <input type="color" id="setup-away-shorts" value="#000000"
                                style="width:100%;height:42px;border-radius:8px;border:2px solid var(--glass-border);cursor:pointer;padding:3px;background:none;">
                        </div>
                        <div class="form-group">
                            <label>Dorsal</label>
                            <input type="color" id="setup-away-text" value="#ffffff"
                                style="width:100%;height:42px;border-radius:8px;border:2px solid var(--glass-border);cursor:pointer;padding:3px;background:none;">
                        </div>
                    </div>
                </div>
            </div>

            <!-- FILA: Modalidad | Sistema | Analizar -->
            <div style="display:grid; grid-template-columns:1fr 1fr auto; gap:1rem; align-items:end;
                        background:var(--glass); border-radius:10px; padding:0.8rem 1rem; margin-bottom:1rem;">
                <div class="form-group" style="margin:0;">
                    <label>Modalidad</label>
                    <select id="setup-mode" onchange="updateFormationOptions()">
                        <option value="f7">Fútbol 7 (2T x 30')</option>
                        <option value="f11">Fútbol 11 (2T x 40')</option>
                    </select>
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Sistema táctico inicial</label>
                    <select id="setup-formation" style="font-weight:600;">
                        <option value="">-- Sin formación predefinida --</option>
                    </select>
                </div>
                <div style="display:flex; align-items:center; gap:8px; padding-bottom:2px;">
                    <input type="checkbox" id="setup-analyze-away" style="width:18px;height:18px;flex-shrink:0;">
                    <label for="setup-analyze-away" style="margin:0;cursor:pointer;white-space:nowrap;">Analizar Visitante</label>
                </div>
            </div>

            <!-- BOTONES -->
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; gap:0.6rem; align-items:center;">
                    <button class="btn" onclick="openRosterManager()"
                        style="background:var(--glass);color:var(--primary);font-size:0.82rem;">
                        GESTIONAR PLANTILLA
                    </button>
                    <button class="btn" onclick="openContactManager()"
                        title="Configurar teléfonos de padres y emails del club"
                        style="background:var(--glass);color:var(--secondary);font-size:0.82rem;border:1px solid var(--secondary);">
                        📱 CONTACTOS
                    </button>
                    <button class="btn" onclick="openConvocationModal()"
                        title="Gestionar convocatoria del partido"
                        style="background:rgba(88,166,255,0.12);color:#58a6ff;font-size:0.82rem;border:1px solid rgba(88,166,255,0.4);">
                        📋 CONVOCATORIA
                    </button>
                    <button class="btn" onclick="openTrainingPanel()"
                        title="Gestionar entrenamientos"
                        style="background:rgba(63,185,80,0.12);color:#3fb950;font-size:0.82rem;border:1px solid rgba(63,185,80,0.4);">
                        🏃 ENTRENAMIENTO
                    </button>
                    ${(['admin','superadmin'].includes(window._cronosCurrentUser?.role) && !['user','coach','individual'].includes(window._cronosCurrentUser?._activeRole)) ? `
                    <button onclick="openAdminPanel()"
                        style="background:rgba(255,165,0,0.15); border:1px solid rgba(255,165,0,0.5);
                               color:#ffa500; font-size:0.82rem; padding:0.45rem 0.9rem;
                               border-radius:8px; cursor:pointer; font-weight:700;">
                        ⚙ ADMIN
                    </button>` : ''}
                    
                    
                    ${window._cronosCurrentUser?.role === 'club_admin' ? `
                    <button onclick="openClubAdminPanel()"
                        style="background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.4);
                               color:var(--primary); font-size:0.82rem; padding:0.45rem 0.9rem;
                               border-radius:8px; cursor:pointer; font-weight:700;">
                        🏟️ MI CLUB
                    </button>` : ''}

                </div>
                <button class="btn primary" onclick="confirmSetup()" style="padding:0.65rem 1.8rem;">
                    CONTINUAR AL PARTIDO
                </button>
            </div>
        </div>
    `;
    populateSavedTeams('home');
    populateSavedTeams('away');
    updateFormationOptions();
}

function confirmSetup() {
    TEAM_NAMES.home = document.getElementById('setup-home-name').value.toUpperCase() || 'LOCAL';
    COLORS.home.primary = document.getElementById('setup-home-color').value;
    COLORS.home.shorts = document.getElementById('setup-home-shorts').value;
    COLORS.home.text = document.getElementById('setup-home-text').value;

    TEAM_NAMES.away = document.getElementById('setup-away-name').value.toUpperCase() || 'VISITANTE';
    COLORS.away.primary = document.getElementById('setup-away-color').value;
    COLORS.away.shorts = document.getElementById('setup-away-shorts').value;
    COLORS.away.text = document.getElementById('setup-away-text').value;

    currentMode = document.getElementById('setup-mode').value;
    analyzeAway = document.getElementById('setup-analyze-away').checked;
    selectedFormationOnStart = document.getElementById('setup-formation')?.value || '';

    document.getElementById('team-a-name').textContent = TEAM_NAMES.home;
    document.getElementById('team-b-name').textContent = TEAM_NAMES.away;

    if (!analyzeAway) {
        document.body.classList.add('hide-visitor');
    } else {
        document.body.classList.remove('hide-visitor');
    }

    document.body.classList.toggle('mode-f11', currentMode === 'f11');

    const defaultTime = currentMode === 'f7' ? 30 : 40;
    half1MaxTime = defaultTime * 60;
    half2MaxTime = defaultTime * 60;

    openConvocationModal();
}

// ══════════════════════════════════════════════════════════════════
//  PANEL DE ENTRENAMIENTO — Planificación Semanal
// ══════════════════════════════════════════════════════════════════
window._trWeekOffset = window._trWeekOffset || 0;

function openTrainingPanel() {
    const isMobile = window.innerWidth < 640;
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    renderTrainingWeek();
}

function _getWeekMonday(offset) {
    const now = new Date();
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + (offset || 0) * 7);
    mon.setHours(0,0,0,0);
    return mon;
}

function renderTrainingWeek() {
    const isMobile = window.innerWidth < 640;
    const modal = document.getElementById('setup-modal');
    const offset = window._trWeekOffset || 0;
    const monday = _getWeekMonday(offset);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

    const DAYS = ['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO','DOMINGO'];
    const DAYS_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
    const dayDates = [];
    for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); dayDates.push(d); }

    const fmtD = d => d.toLocaleDateString('es-ES', {day:'numeric',month:'short'});
    const fmtDD = d => d.getDate().toString().padStart(2,'0') + '/' + (d.getMonth()+1).toString().padStart(2,'0');
    const weekKey = monday.toISOString().substring(0, 10);

    const allWeeks = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    const weekData = allWeeks[weekKey] || {};

    const typeOpts = ['','entrenamiento','partido liga','partido amistoso'];

    modal.innerHTML = `
        <div class="modal-content" style="width:min(98vw,1150px); max-height:94vh; display:flex; flex-direction:column; overflow-y:auto; padding:${isMobile ? '0.6rem' : '1.5rem'};">
            <div style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem; flex-wrap:wrap; gap:0.5rem;">
                <div>
                    <h2 style="margin:0 0 0.05rem; font-size:${isMobile ? '1rem' : '1.35rem'};">🏃 Planificación Semanal</h2>
                    <p style="font-size:0.72rem; color:var(--text-muted);">Entrenamientos y partidos de la semana</p>
                </div>
                <div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
                    <button class="btn" onclick="window._trWeekOffset=(window._trWeekOffset||0)-1; renderTrainingWeek();" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">◀</button>
                    <span style="font-size:0.82rem; font-weight:700; color:white; min-width:${isMobile?'140px':'200px'}; text-align:center;">
                        ${fmtD(monday)} — ${fmtD(sunday)}
                    </span>
                    <button class="btn" onclick="window._trWeekOffset=(window._trWeekOffset||0)+1; renderTrainingWeek();" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">▶</button>
                    <button class="btn" onclick="window._trWeekOffset=0; renderTrainingWeek();" style="padding:0.35rem 0.7rem; font-size:0.68rem; background:rgba(88,166,255,0.12); border-color:rgba(88,166,255,0.3); color:#58a6ff;">HOY</button>
                    <button class="btn" onclick="openSetupModal()" style="padding:0.35rem 0.7rem; font-size:0.68rem;">← VOLVER</button>
                </div>
            </div>

            <div style="flex:1; overflow-x:auto; border:1px solid rgba(63,185,80,0.15); border-radius:12px;">
                <table style="width:100%; border-collapse:collapse; font-size:${isMobile ? '0.7rem' : '0.8rem'};">
                    <thead>
                        <tr style="background:rgba(63,185,80,0.08);">
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">DÍA</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">🏟️ LUGAR</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">👕 EQUIPACIONES</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">📋 TIPO</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">🕐 HORA</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">⏱️ DURACIÓN</th>
                        </tr>
                    </thead>
                    <tbody>${DAYS.map((dayName, i) => {
                        const ds = dayDates[i].toISOString().substring(0, 10);
                        const dd = weekData[ds] || {};
                        const isWE = i >= 5;
                        const today = new Date(); today.setHours(0,0,0,0);
                        const isToday = dayDates[i].getTime() === today.getTime();
                        const rowBg = isToday ? 'background:rgba(88,166,255,0.06);' : (isWE ? 'background:rgba(240,136,62,0.03);' : '');
                        const optSel = (v) => typeOpts.map(o => `<option value="${o}" ${dd.tipo===o?'selected':''} style="background:#161b22;">${o ? o.charAt(0).toUpperCase()+o.slice(1) : '— Seleccionar —'}</option>`).join('');
                        return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04); ${rowBg}">
                            <td style="padding:0.45rem 0.4rem; white-space:nowrap; vertical-align:middle;">
                                <div style="font-weight:700; color:${isToday?'#58a6ff':(isWE?'#f0883e':'white')}; font-size:0.82rem;">${isMobile?DAYS_SHORT[i]:dayName} ${isToday?'●':''}</div>
                                <div style="font-size:0.68rem; color:var(--text-muted);">${fmtDD(dayDates[i])}</div>
                            </td>
                            <td style="padding:0.3rem 0.25rem;"><input type="text" class="conv-input" data-day="${ds}" data-field="lugar" value="${dd.lugar||''}" placeholder="Campo / Instalación" style="width:100%; min-width:${isMobile?'80px':'130px'}; padding:0.35rem 0.45rem; font-size:0.76rem;"></td>
                            <td style="padding:0.3rem 0.25rem;"><input type="text" class="conv-input" data-day="${ds}" data-field="equipaciones" value="${dd.equipaciones||''}" placeholder="1a / 2a equipación" style="width:100%; min-width:${isMobile?'80px':'130px'}; padding:0.35rem 0.45rem; font-size:0.76rem;"></td>
                            <td style="padding:0.3rem 0.25rem;"><select class="conv-input" data-day="${ds}" data-field="tipo" style="width:100%; min-width:${isMobile?'90px':'140px'}; padding:0.35rem 0.45rem; font-size:0.76rem; background:var(--glass); color:white; border:1px solid var(--glass-border); border-radius:6px;">${optSel()}</select></td>
                            <td style="padding:0.3rem 0.25rem;"><input type="time" class="conv-input" data-day="${ds}" data-field="hora" value="${dd.hora||''}" style="width:100%; min-width:${isMobile?'75px':'100px'}; padding:0.35rem 0.45rem; font-size:0.76rem;"></td>
                            <td style="padding:0.3rem 0.25rem;"><input type="text" class="conv-input" data-day="${ds}" data-field="duracion" value="${dd.duracion||''}" placeholder="90 min" style="width:100%; min-width:${isMobile?'70px':'90px'}; padding:0.35rem 0.45rem; font-size:0.76rem;"></td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>

            <div style="margin-top:0.8rem; display:flex; gap:0.5rem; justify-content:flex-end; flex-wrap:wrap;">
                <button class="btn" onclick="openTrainingSendPanel('directors')" style="padding:0.45rem 0.9rem; font-size:0.72rem; background:rgba(88,166,255,0.1); border:1px solid rgba(88,166,255,0.3); color:var(--primary); font-weight:700;">📋 DIRECTORES</button>
                <button class="btn" onclick="openTrainingSendPanel('coordinators')" style="padding:0.45rem 0.9rem; font-size:0.72rem; background:rgba(240,136,62,0.1); border:1px solid rgba(240,136,62,0.3); color:#f0883e; font-weight:700;">🎯 COORDINADORES</button>
                <button class="btn" onclick="openTrainingSendPanel('parents')" style="padding:0.45rem 0.9rem; font-size:0.72rem; background:rgba(63,185,80,0.1); border:1px solid rgba(63,185,80,0.3); color:#3fb950; font-weight:700;">👨‍👩‍👧 PADRES</button>
                <button class="btn" onclick="clearTrainingWeek()" style="padding:0.45rem 0.9rem; font-size:0.76rem; background:rgba(255,88,88,0.08); border:1px solid rgba(255,88,88,0.25); color:#ff5858;">🗑️ LIMPIAR</button>
                <button class="btn" onclick="saveTrainingWeek()" style="padding:0.45rem 1.1rem; font-size:0.76rem; background:rgba(63,185,80,0.15); border:1px solid rgba(63,185,80,0.4); color:#3fb950; font-weight:700;">💾 GUARDAR</button>
            </div>
        </div>`;
}

function saveTrainingWeek() {
    const offset = window._trWeekOffset || 0;
    const monday = _getWeekMonday(offset);
    const weekKey = monday.toISOString().substring(0, 10);
    const inputs = document.querySelectorAll('[data-day][data-field]');
    const weekData = {};
    inputs.forEach(inp => {
        const day = inp.dataset.day;
        const field = inp.dataset.field;
        const val = inp.value.trim();
        if (val) { if (!weekData[day]) weekData[day] = {}; weekData[day][field] = val; }
    });
    const allWeeks = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    allWeeks[weekKey] = weekData;
    localStorage.setItem('cronos_training_weeks', JSON.stringify(allWeeks));
    if (typeof showToast === 'function') showToast('✅ Semana guardada correctamente', 3000);
}

function clearTrainingWeek() {
    if (!confirm('¿Limpiar todos los datos de esta semana?')) return;
    const offset = window._trWeekOffset || 0;
    const monday = _getWeekMonday(offset);
    const weekKey = monday.toISOString().substring(0, 10);
    const allWeeks = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    delete allWeeks[weekKey];
    localStorage.setItem('cronos_training_weeks', JSON.stringify(allWeeks));
    renderTrainingWeek();
    if (typeof showToast === 'function') showToast('🗑️ Semana limpiada', 3000);
}

// ══════════════════════════════════════════════════════════════════
//  ENVIAR ENTRENAMIENTO POR WHATSAPP / EMAIL
// ══════════════════════════════════════════════════════════════════

function _getTrainingWeekText() {
    const offset = window._trWeekOffset || 0;
    const monday = _getWeekMonday(offset);
    const weekKey = monday.toISOString().substring(0, 10);
    const allWeeks = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    const weekData = allWeeks[weekKey] || {};
    if (Object.keys(weekData).length === 0) return null;

    const DAYS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
    const fmtD = d => {
        const date = new Date(d + 'T12:00:00');
        return date.toLocaleDateString('es-ES', {day:'numeric', month:'short'});
    };
    const fmtDD = d => d;

    let text = '';
    Object.keys(weekData).sort().forEach(ds => {
        const dd = weekData[ds];
        const dayIdx = new Date(ds + 'T12:00:00').getDay();
        const dayNum = dayIdx === 0 ? 6 : dayIdx - 1;
        const dayName = DAYS[dayNum];
        text += `📅 *${dayName} ${fmtD(ds)}*\n`;
        if (dd.tipo)    text += `📋 ${dd.tipo}\n`;
        if (dd.hora)    text += `🕐 ${dd.hora}\n`;
        if (dd.duracion) text += `⏱️ ${dd.duracion}\n`;
        if (dd.lugar)   text += `🏟️ ${dd.lugar}\n`;
        if (dd.equipaciones) text += `👕 ${dd.equipaciones}\n`;
        text += '\n';
    });
    return text.trim();
}

function openTrainingSendPanel(target) {
    const weekText = _getTrainingWeekText();
    if (!weekText) {
        if (typeof showToast === 'function') showToast('⚠️ No hay entrenamientos para enviar esta semana', 3000);
        return;
    }

    const isParents = target === 'parents';
    const isCoordinators = target === 'coordinators';
    window._trTarget = target;

    const hour = new Date().getHours();
    const greeting = hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';

    let title;
    if (isParents) title = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Enviar Entrenamiento a Padres';
    else if (isCoordinators) title = '\u{1F3AF} Enviar Entrenamiento a Coordinadores';
    else title = '\u{1F4CB} Enviar Entrenamiento a Directores';

    const saved = JSON.parse(localStorage.getItem('cronos_conv_config') || '{}');

    // Build preview message
    const fullMessage = isParents
        ? `${greeting} familia! 👋\n\n🏃 *PLANIFICACIÓN SEMANAL*\n\n${weekText}\n_Cronos Fútbol_ ⚽`
        : `${greeting}! 👋\n\n🏃 *PLANIFICACIÓN SEMANAL*\n\n${weekText}\n_Cronos Fútbol_ ⚽`;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,680px);max-height:94vh;
             display:flex;flex-direction:column;overflow:hidden;padding:1.5rem;">

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <h2 style="margin:0;font-size:1.1rem;">${title}</h2>
                <button onclick="renderTrainingWeek()"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
            </div>

            <!-- Saludo -->
            <div style="margin-bottom:0.8rem;">
                <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Saludo inicial</label>
                <select id="tr-greeting" class="conv-input" onchange="updateTrainingPreview()">
                    <option value="Buenos días" ${greeting==='Buenos días'?'selected':''}>Buenos días ☀️</option>
                    <option value="Buenas tardes" ${greeting==='Buenas tardes'?'selected':''}>Buenas tardes 🌤️</option>
                    <option value="Buenas noches" ${greeting==='Buenas noches'?'selected':''}>Buenas noches 🌙</option>
                    <option value="Hola" ${greeting==='Hola'?'selected':''}>Hola 👋</option>
                </select>
            </div>

            <!-- Mensaje extra -->
            <div style="margin-bottom:0.8rem;">
                <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">💬 Mensaje extra (opcional)</label>
                <textarea id="tr-extra" class="conv-input" rows="2" placeholder="ej: Recordad traer botellas de agua 💧"
                    oninput="updateTrainingPreview()"></textarea>
            </div>

            <!-- Vista previa -->
            <div style="background:rgba(63,185,80,0.05);border:1px solid rgba(63,185,80,0.2);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;flex:1;overflow-y:auto;">
                <div style="font-size:0.78rem;font-weight:700;color:#3fb950;margin-bottom:0.5rem;">👁️ Vista previa</div>
                <pre id="tr-preview" style="font-family:inherit;font-size:0.82rem;white-space:pre-wrap;
                     color:var(--text);margin:0;line-height:1.5;">${fullMessage}</pre>
            </div>

            <!-- Destinatarios -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);margin-bottom:0.5rem;">📤 ENVIAR A</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.55rem;">
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">📱 WhatsApp</label>
                        <input id="tr-wa" type="tel" class="conv-input" placeholder="34612345678"
                            value="${saved.wa || emailConfig?.whatsappNumber || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">📧 Email</label>
                        <input id="tr-email" type="email" class="conv-input" placeholder="directores@club.com"
                            value="${saved.email || emailConfig?.directorEmail || ''}">
                    </div>
                </div>
            </div>

            <!-- Botones -->
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;padding-top:0.8rem;
                        border-top:1px solid var(--glass-border);">
                <button onclick="renderTrainingWeek()" class="btn" style="color:var(--text-muted);">← Volver</button>
                <button onclick="sendTrainingWA()" class="btn"
                    style="background:rgba(63,185,80,0.15);border-color:rgba(63,185,80,0.4);
                           color:#3fb950;font-weight:700;flex:1;">📱 WhatsApp</button>
                <button onclick="sendTrainingEmail()" class="btn"
                    style="background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.4);
                           color:var(--primary);font-weight:700;flex:1;">📧 Email</button>
            </div>
        </div>
        <style>
        .conv-input {
            width:100%;padding:0.42rem 0.6rem;
            background:rgba(255,255,255,0.06);
            border:1px solid var(--glass-border);
            border-radius:7px;color:var(--text);font-size:0.85rem;box-sizing:border-box;
        }
        .conv-input:focus { outline:none;border-color:rgba(88,166,255,0.5); }
        </style>
    `;
}

function updateTrainingPreview() {
    const preview = document.getElementById('tr-preview');
    if (!preview) return;
    const greeting = document.getElementById('tr-greeting')?.value || 'Hola';
    const extra = document.getElementById('tr-extra')?.value.trim();
    const weekText = _getTrainingWeekText() || 'No hay entrenamientos';

    const isParents = window._trTarget === 'parents';
    const audience = isParents ? 'familia! 👋' : '! 👋';
    let msg = `${greeting} ${audience}\n\n🏃 *PLANIFICACIÓN SEMANAL*\n\n${weekText}`;
    if (extra) msg += `\n💬 ${extra}\n`;
    msg += `\n_Cronos Fútbol_ ⚽`;
    preview.textContent = msg;
}

function sendTrainingWA() {
    const preview = document.getElementById('tr-preview');
    const wa = document.getElementById('tr-wa')?.value.trim();
    if (!preview || !wa) {
        if (typeof showToast === 'function') showToast('⚠️ Introduce un número de WhatsApp', 3000);
        return;
    }
    const text = encodeURIComponent(preview.textContent);
    window.open('https://wa.me/' + wa.replace(/[^0-9]/g, '') + '?text=' + text, '_blank');
}

function sendTrainingEmail() {
    const preview = document.getElementById('tr-preview');
    const email = document.getElementById('tr-email')?.value.trim();
    if (!preview || !email) {
        if (typeof showToast === 'function') showToast('⚠️ Introduce un email', 3000);
        return;
    }
    const subject = encodeURIComponent('Planificación Semanal - Entrenamiento');
    const body = encodeURIComponent(preview.textContent);
    window.open('mailto:' + email + '?subject=' + subject + '&body=' + body, '_blank');
}

// ══════════════════════════════════════════════════════════════════
//  CUERPO TÉCNICO
// ══════════════════════════════════════════════════════════════════

function loadStaffConfig() {
    const saved = localStorage.getItem('cronos_staff');
    if (saved) {
        try { staffConfig = { ...staffConfig, ...JSON.parse(saved) }; }
        catch(e) {}
    }
}

function saveStaffConfig() {
    staffConfig.coach1        = (document.getElementById('staff-coach1')?.value       || '').trim();
    staffConfig.coach2        = (document.getElementById('staff-coach2')?.value       || '').trim();
    staffConfig.delegate      = (document.getElementById('staff-delegate')?.value     || '').trim();
    staffConfig.fieldDelegate = (document.getElementById('staff-field-delegate')?.value || '').trim();
    cloudSet('cronos_staff', JSON.stringify(staffConfig));
}

function renderStaffInBench() {
    // Recargar siempre desde localStorage
    loadStaffConfig();

    // Eliminar card anterior si existe
    const existing = document.getElementById('staff-bench-card');
    if (existing) existing.remove();

    const staff = staffConfig;
    const hasAny = staff.coach1 || staff.coach2 || staff.delegate || staff.fieldDelegate;
    if (!hasAny) return;

    // El card va DENTRO de bench-list para que sea scrollable junto a los suplentes
    const benchList = document.getElementById('bench-list');
    if (!benchList) return;

    const card = document.createElement('div');
    card.id = 'staff-bench-card';
    // grid-column: 1/-1 para que ocupe las dos columnas del grid del bench-container
    card.style.cssText =
        'grid-column:1/-1; width:100%; margin-top:6px; padding:7px 8px;' +
        'border-top:1px solid rgba(255,255,255,0.12); border-radius:6px;' +
        'background:rgba(88,166,255,0.05); box-sizing:border-box;' +
        'pointer-events:auto;';

    const extras = [];
    if (staff.coach2)        extras.push({ tag:'2DO', name:staff.coach2,        bg:'rgba(88,166,255,0.2)',  color:'#58a6ff' });
    if (staff.delegate)      extras.push({ tag:'DEL', name:staff.delegate,      bg:'rgba(240,136,62,0.2)', color:'#f0883e' });
    if (staff.fieldDelegate) extras.push({ tag:'CAM', name:staff.fieldDelegate, bg:'rgba(63,185,80,0.2)',  color:'#3fb950' });

    let html = '<div style="font-size:0.6rem;color:#7d8590;font-weight:700;letter-spacing:0.5px;margin-bottom:5px;">👨‍💼 CUERPO TÉCNICO</div>';

    if (staff.coach1) {
        html += `<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">
            <span style="font-size:0.6rem;background:rgba(88,166,255,0.25);color:#58a6ff;
                         border-radius:3px;padding:1px 5px;flex-shrink:0;font-weight:700;">1ER</span>
            <span style="font-size:0.73rem;font-weight:700;color:#cdd9e5;
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${staff.coach1}</span>
        </div>`;
    }

    if (extras.length > 0) {
        html += `<details>
            <summary style="cursor:pointer;color:#7d8590;font-size:0.65rem;
                            list-style:none;display:flex;align-items:center;
                            gap:4px;margin-top:2px;user-select:none;">
                <span>▾</span> ${extras.length} más
            </summary>
            <div style="margin-top:5px;display:flex;flex-direction:column;gap:4px;">
                ${extras.map(e =>
                    `<div style="display:flex;align-items:center;gap:5px;">
                        <span style="font-size:0.6rem;background:${e.bg};color:${e.color};
                                     border-radius:3px;padding:1px 5px;flex-shrink:0;font-weight:700;">${e.tag}</span>
                        <span style="font-size:0.72rem;color:#cdd9e5;white-space:nowrap;
                                     overflow:hidden;text-overflow:ellipsis;">${e.name}</span>
                    </div>`
                ).join('')}
            </div>
        </details>`;
    }

    card.innerHTML = html;
    benchList.appendChild(card);
}

function openRosterManager() {
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const mode = document.getElementById('setup-mode').value;
    const limit = mode === 'f7' ? 18 : 25;

    if (roster[mode].length < limit) {
        for (let i = roster[mode].length; i < limit; i++) {
            roster[mode].push({ number: i + 1, name: '', surname: '', alias: '' });
        }
    }

    const modal = document.getElementById('setup-modal');
    modal.innerHTML = `
        <div class="modal-content" style="width: 800px; max-width: 95%;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.3rem;">
                <div style="display:flex; align-items:center; gap:0.8rem; flex-wrap:wrap;">
                    <button onclick="openSetupModal()"
                        title="Volver a la configuración del partido"
                        style="display:flex; align-items:center; gap:0.4rem; padding:0.45rem 0.9rem;
                               background:var(--glass); border:1px solid var(--glass-border);
                               border-radius:8px; color:var(--text-muted); font-size:0.85rem;
                               font-weight:600; cursor:pointer; white-space:nowrap;">
                        ← Volver
                    </button>
                    <h2 style="margin:0;">Gestionar Plantilla - ${mode === 'f7' ? 'Fútbol 7' : 'Fútbol 11'}</h2>
                </div>
                <button onclick="triggerRosterPhoto()"
                    title="Haz una foto a la lista de jugadores y la IA la importa automáticamente"
                    style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem 1rem;
                           background:rgba(240,136,62,0.15); border:1px solid rgba(240,136,62,0.5);
                           border-radius:8px; color:var(--secondary); font-size:0.85rem;
                           font-weight:700; cursor:pointer; white-space:nowrap;">
                    📷 IMPORTAR CON IA
                </button>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom:0.8rem;">
                Completa los datos de tus ${limit} jugadores · El Alias es el nombre que aparecerá en la ficha ·
                <span style="color:var(--secondary);">📷 Haz una foto a la lista y la IA la importa sola</span>
            </p>
            <!-- Input oculto para seleccionar imagen -->
            <input type="file" id="roster-photo-input" accept="image/*" capture="environment"
                style="display:none;" onchange="processRosterPhoto(this)">
            <div style="overflow-x: auto;">
                <table class="roster-table">
                    <thead>
                        <tr>
                            <th style="width:44px;">#</th>
                            <th>Nombre</th>
                            <th>Apellidos</th>
                            <th style="color:var(--primary);">★ Alias <span style="font-size:0.65rem;font-weight:400;color:var(--text-muted);">(aparece en la ficha)</span></th>
                        </tr>
                    </thead>
                    <tbody id="roster-tbody">
                        ${roster[mode].map((p, i) => `
                            <tr>
                                <td><input type="number" class="r-num" value="${p.number}" style="width: 40px;"></td>
                                <td><input type="text" class="r-name" value="${p.name}"></td>
                                <td><input type="text" class="r-surname" value="${p.surname}"></td>
                                <td><input type="text" class="r-alias" value="${p.alias}"></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <!-- CUERPO TÉCNICO -->
            <div style="margin-top:1.2rem; padding:1rem; background:var(--glass);
                        border-radius:10px; border:1px solid var(--glass-border);">
                <h3 style="font-size:0.85rem; color:var(--primary); margin:0 0 0.8rem;
                           display:flex; align-items:center; gap:0.5rem;">
                    👨‍💼 Cuerpo Técnico
                    <span style="font-size:0.7rem; color:var(--text-muted); font-weight:400;">
                        — aparecerá en el banquillo durante el partido
                    </span>
                </h3>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem;">
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">1er Entrenador</label>
                        <input type="text" id="staff-coach1" value="${staffConfig.coach1}"
                               placeholder="Nombre del entrenador"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">2º Entrenador</label>
                        <input type="text" id="staff-coach2" value="${staffConfig.coach2}"
                               placeholder="Nombre del 2º entrenador"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">Delegado de Equipo</label>
                        <input type="text" id="staff-delegate" value="${staffConfig.delegate}"
                               placeholder="Nombre del delegado"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">
                            Delegado de Campo
                            <span style="color:var(--text-muted);font-size:0.68rem;">(solo en casa, opcional)</span>
                        </label>
                        <input type="text" id="staff-field-delegate" value="${staffConfig.fieldDelegate}"
                               placeholder="Dejar vacío si se juega fuera"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                </div>
            </div>

            <div style="margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 1rem;">
                <button class="btn" onclick="openSetupModal()">CANCELAR</button>
                <button class="btn primary" onclick="saveMasterRoster('${mode}')">GUARDAR PLANTILLA</button>
            </div>
        </div>
    `;
}

// ══════════════════════════════════════════════════════════════════
//  IMPORTACIÓN DE PLANTILLA CON IA (foto → jugadores)
// ══════════════════════════════════════════════════════════════════

function triggerRosterPhoto() {
    const input = document.getElementById('roster-photo-input');
    if (input) input.click();
}

// ── OCR con Tesseract.js (100% local, sin API, sin coste) ───────────
// Carga la librería solo cuando se necesita (lazy load)
// ══════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Importación de plantilla con IA (Gemini Vision)
//  Motor: Google Gemini 1.5 Flash (gratis hasta 1500 imgs/día)
//  Fallback: Tesseract.js (100% local, sin límite)
// ══════════════════════════════════════════════════════════════════

async function processRosterPhoto(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;

    // ── Spinner con barra de progreso ─────────────────────────────
    const modal = document.getElementById('setup-modal');
    const existingContent = modal.querySelector('.modal-content');
    const spinnerOverlay = document.createElement('div');
    spinnerOverlay.id = 'ocr-spinner';
    spinnerOverlay.style.cssText =
        'position:absolute;inset:0;background:rgba(10,14,20,0.92);border-radius:16px;' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'z-index:100;gap:0.9rem;padding:2rem;';
    spinnerOverlay.innerHTML = `
        <div style="font-size:3rem;animation:spin 1.2s linear infinite;">📷</div>
        <p id="ocr-status-title" style="color:#58a6ff;font-weight:700;font-size:1.05rem;margin:0;text-align:center;">
            Analizando imagen con IA…
        </p>
        <p id="ocr-status-sub" style="color:#7d8590;font-size:0.82rem;margin:0;text-align:center;">
            Gemini Vision reconociendo jugadores
        </p>
        <div style="width:240px;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
            <div id="ocr-progress" style="height:100%;width:10%;background:#58a6ff;
                 border-radius:3px;transition:width 0.4s ease;"></div>
        </div>
        <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>`;
    if (existingContent) existingContent.style.position = 'relative';
    existingContent?.appendChild(spinnerOverlay);

    const setStatus = (title, sub, pct) => {
        const t = document.getElementById('ocr-status-title');
        const s = document.getElementById('ocr-status-sub');
        const p = document.getElementById('ocr-progress');
        if (t && title) t.textContent = title;
        if (s && sub)   s.textContent = sub;
        if (p && pct !== undefined) p.style.width = pct + '%';
    };

    try {
        // ── 1. Comprimir imagen ────────────────────────────────────
        setStatus('Preparando imagen…', 'Optimizando para análisis', 15);
        const base64 = await compressImageToBase64(file, 1600, 0.88);

        // ── 2. Intentar Gemini Vision (principal) ─────────────────
        setStatus('Analizando con IA…', 'Gemini Vision reconociendo texto', 35);
        let players = null;
        let engine  = 'gemini';

        try {
            players = await callGeminiVision(base64);
        } catch (geminiErr) {
            console.warn('[OCR] Gemini falló:', geminiErr.message, '→ usando Tesseract fallback');
            setStatus('Cambiando a modo local…', 'Tesseract.js procesando en tu dispositivo', 40);
            engine = 'tesseract';
            players = await callTesseract(base64, setStatus);
        }

        setStatus('Extrayendo jugadores…', `Motor: ${engine === 'gemini' ? 'Gemini IA ✓' : 'Tesseract local ✓'}`, 95);

        if (!players || players.length === 0) {
            throw new Error('No se encontraron jugadores. Prueba con una imagen más nítida y bien iluminada.');
        }

        // ── 3. Actualizar contador (no bloquea) ───────────────────
        updateUsageCounter(engine).catch(() => {});

        spinnerOverlay.remove();
        showRosterPreview(players);

    } catch (err) {
        spinnerOverlay.remove();
        showOCRError(err.message);
    }

    inputEl.value = '';
}

// ── Comprimir imagen a base64 ────────────────────────────────────────
function compressImageToBase64(file, maxPx, quality) {
    return new Promise((res, rej) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > maxPx || h > maxPx) {
                if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
                else       { w = Math.round(w * maxPx / h); h = maxPx; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.filter = 'contrast(1.2) brightness(1.05)'; // mejora legibilidad
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            res(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
        };
        img.onerror = () => rej(new Error('No se pudo procesar la imagen.'));
        img.src = url;
    });
}

// ── Gemini Vision API via Cloudflare Worker ──────────────────────────
async function callGeminiVision(base64) {
    const PROXY = 'https://cronos-prox.jarg7435.workers.dev/gemini';

    const prompt = `Extrae la lista de jugadores de esta imagen. Devuelve SOLO un array JSON sin texto adicional:
[{"number":1,"name":"NOMBRE","surname":"APELLIDOS","alias":"ALIAS"}]
Reglas:
- number: dorsal si aparece, si no 1,2,3...
- name: nombre de pila en MAYÚSCULAS (puede estar vacío)
- surname: apellidos en MAYÚSCULAS (puede estar vacío)
- alias: apodo o primer apellido, NUNCA vacío
- Si solo hay un nombre/apodo por línea: va en alias y surname
- Devuelve ÚNICAMENTE el JSON array, nada más`;

    const response = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, prompt, provider: 'gemini' })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'Error en Gemini API');
    }

    const data = await response.json();
    const text = data.text || '';

    // Extraer JSON de la respuesta
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) throw new Error('Gemini no devolvió JSON válido');

    const players = JSON.parse(match[0]);
    if (!Array.isArray(players) || players.length === 0) {
        throw new Error('No se detectaron jugadores en la imagen');
    }
    return players;
}

// ── Tesseract.js fallback (100% local) ──────────────────────────────
let _tesseractLoaded = false;
async function callTesseract(base64, setStatus) {
    if (!_tesseractLoaded) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
        _tesseractLoaded = true;
    }

    const imgDataUrl = 'data:image/jpeg;base64,' + base64;
    const worker = await Tesseract.createWorker('spa+eng', 1, {
        logger: m => {
            if (m.status === 'recognizing text') {
                const pct = 40 + Math.round(m.progress * 50);
                if (setStatus) setStatus(
                    `Reconociendo… ${Math.round(m.progress * 100)}%`,
                    'Tesseract.js procesando localmente',
                    pct
                );
            }
        }
    });
    const { data } = await worker.recognize(imgDataUrl);
    await worker.terminate();

    const text = data.text || '';
    if (!text.trim()) throw new Error('No se detectó texto en la imagen.');
    return parsePlayersFromText(text);
}

// ── Parser de texto plano → jugadores ───────────────────────────────
function parsePlayersFromText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    const players = [];
    let autoNum = 1;
    const SKIP = /^(nº|num|n\.|número|nombre|apellido|jugador|player|lista|plantilla|equipo|team|pos|posición|#|dorsal)$/i;

    for (const line of lines) {
        if (SKIP.test(line) || /^\d+$/.test(line)) continue;

        let number = null, rest = line;

        const startNum = rest.match(/^[\(\[]?(\d{1,2})[\)\]\s.\-:)]+(.+)/);
        if (startNum) { number = parseInt(startNum[1]); rest = startNum[2].trim(); }
        else {
            const endNum = rest.match(/^(.+?)\s+(\d{1,2})$/);
            if (endNum) { number = parseInt(endNum[2]); rest = endNum[1].trim(); }
        }

        rest = rest.replace(/[|\\/_@\[\]()]/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (rest.length < 2) continue;

        const words = rest.toUpperCase().split(/\s+/).filter(w => w.length > 0);
        if (!words.length) continue;

        let name = '', surname = '', alias = '';
        if (words.length === 1)      { alias = surname = words[0]; }
        else if (words.length === 2) { name = words[0]; surname = words[1]; alias = words[1]; }
        else                         { name = words[0]; surname = words.slice(1).join(' '); alias = words[1]; }

        if (!number) number = autoNum;
        autoNum = number + 1;
        players.push({ number, name, surname, alias: alias || name || surname || String(number) });
    }

    const seen = new Set();
    return players
        .filter(p => { if (seen.has(p.number)) return false; seen.add(p.number); return true; })
        .sort((a, b) => a.number - b.number)
        .slice(0, 30);
}

// ── Contador de uso en Firestore (informativo) ───────────────────────
async function updateUsageCounter(engine) {
    try {
        const db2 = window._cronos_db;
        if (!db2) return;
        const { doc: _doc, getDoc: _getDoc, setDoc: _setDoc } =
            await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const now      = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const ref      = _doc(db2, 'app_stats', 'ocr_usage');
        const snap     = await _getDoc(ref);
        let u = snap.exists() ? snap.data() : { gemini:0, tesseract:0, month: monthKey };
        if (u.month !== monthKey) u = { gemini:0, tesseract:0, month: monthKey };
        u[engine] = (u[engine] || 0) + 1;
        u.month   = monthKey;
        u.lastUsed = now.toISOString();
        await _setDoc(ref, u);
        // Avisos (Gemini: 1500/día gratis → aviso a 1000 y 1300)
        if (engine === 'gemini') {
            if (u.gemini === 1000) showToast('📊 1.000 análisis con Gemini este mes. Perfecto.', 4000);
            if (u.gemini === 1300) showToast('⚠️ 1.300 análisis Gemini/mes. Cerca del límite diario (1.500). Considera ampliar.', 7000);
        }
    } catch(e) { /* no bloquear */ }
}

// ── Toast de error visible ───────────────────────────────────────────
function showOCRError(msg) {
    const toast = document.createElement('div');
    toast.innerHTML = `❌ <strong>No se pudo analizar la imagen</strong><br>
        <span style="font-size:0.78rem;">${msg}</span><br>
        <span style="font-size:0.72rem;color:#ffaaaa;">Consejo: usa buena iluminación y que el texto sea legible</span>`;
    toast.style.cssText =
        'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
        'background:#3d1a1a;border:1px solid #c0392b;color:#ff7b7b;' +
        'padding:14px 22px;border-radius:12px;font-size:0.85rem;' +
        'z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.6);text-align:center;max-width:92vw;line-height:1.5;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
}


function showRosterPreview(players) {
    const mode  = document.getElementById('setup-mode')?.value || 'f11';
    const limit = mode === 'f7' ? 18 : 25;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(95vw,820px); max-height:92vh;
             display:flex; flex-direction:column; overflow:hidden;">

            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                <h2 style="margin:0;">✅ Jugadores detectados</h2>
                <span style="background:rgba(88,166,255,0.15); color:#58a6ff;
                       border:1px solid rgba(88,166,255,0.3); border-radius:20px;
                       padding:3px 12px; font-size:0.78rem; font-weight:700;">
                    ${players.length} jugadores
                </span>
            </div>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.8rem;">
                Revisa y corrige si es necesario antes de cargar en la plantilla.
            </p>

            <!-- Indicación de campos -->
            <div style="background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.2);
                        border-radius:8px;padding:8px 12px;margin-bottom:0.6rem;font-size:0.78rem;color:var(--text-muted);">
                💡 <strong style="color:var(--primary);">Alias</strong> = nombre que aparece en la ficha del jugador durante el partido.
                Revisa que cada jugador tenga un alias claro y corto.
            </div>

            <!-- Tabla editable -->
            <div style="overflow-y:auto; flex:1;">
                <table class="roster-table" style="width:100%;">
                    <thead>
                        <tr>
                            <th style="width:44px;">#</th>
                            <th>Nombre</th>
                            <th>Apellidos</th>
                            <th style="color:var(--primary);">★ Alias (Ficha)</th>
                            <th style="width:36px;"></th>
                        </tr>
                    </thead>
                    <tbody id="preview-tbody">
                        ${players.map((p, i) => `
                            <tr id="preview-row-${i}">
                                <td><input type="number" class="p-num" value="${p.number || i+1}"
                                    style="width:44px;"></td>
                                <td><input type="text" class="p-name" value="${p.name || ''}"></td>
                                <td><input type="text" class="p-surname" value="${p.surname || ''}"></td>
                                <td><input type="text" class="p-alias" value="${p.alias || ''}"></td>
                                <td>
                                    <button onclick="document.getElementById('preview-row-${i}').remove()"
                                        style="background:none; border:none; color:#ff5858;
                                               cursor:pointer; font-size:1rem; padding:2px 6px;"
                                        title="Eliminar fila">✕</button>
                                </td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>

            <!-- Acciones -->
            <div style="margin-top:0.8rem; padding-top:0.8rem;
                        border-top:1px solid var(--glass-border);
                        display:flex; justify-content:space-between; align-items:center; flex-shrink:0; gap:0.6rem; flex-wrap:wrap;">
                <button class="btn" onclick="openRosterManager()"
                    style="color:var(--text-muted);">
                    ← Volver sin importar
                </button>
                <div style="display:flex; gap:0.6rem;">
                    <button class="btn" onclick="triggerRosterPhoto()"
                        style="background:rgba(240,136,62,0.12); color:var(--secondary);
                               border:1px solid rgba(240,136,62,0.4);">
                        📷 Nueva foto
                    </button>
                    <button class="btn primary" onclick="confirmRosterImport('${mode}')">
                        ✅ CARGAR EN PLANTILLA
                    </button>
                </div>
            </div>
        </div>
        <!-- Input oculto para nueva foto desde preview -->
        <input type="file" id="roster-photo-input" accept="image/*" capture="environment"
            style="display:none;" onchange="processRosterPhoto(this)">
    `;
}

function confirmRosterImport(mode) {
    const rows = document.querySelectorAll('#preview-tbody tr');
    if (rows.length === 0) { alert('No hay jugadores para importar.'); return; }

    const imported = Array.from(rows).map(row => ({
        number:  row.querySelector('.p-num')?.value     || '',
        name:    row.querySelector('.p-name')?.value    || '',
        surname: row.querySelector('.p-surname')?.value || '',
        alias:   row.querySelector('.p-alias')?.value   || ''
    })).filter(p => p.name || p.surname || p.alias);

    // Cargar en la plantilla existente: rellenar desde el principio
    const limit = mode === 'f7' ? 18 : 25;
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');

    // Asegurar que hay suficientes filas
    while (roster[mode].length < limit) {
        roster[mode].push({ number: roster[mode].length + 1, name: '', surname: '', alias: '' });
    }

    // Escribir los jugadores importados
    imported.forEach((p, i) => {
        if (i < limit) {
            roster[mode][i] = {
                number:  p.number || (i + 1),
                name:    p.name,
                surname: p.surname,
                alias:   p.alias
            };
        }
    });

    showSpinner('Importando jugadores…');
    setTimeout(() => {
        cloudSet('cronos_master_roster', JSON.stringify(roster));
        hideSpinner();
        showToast('✅ ' + imported.length + ' jugadores importados correctamente');
        openRosterManager();
    }, 400);
}

function saveMasterRoster(mode) {
    showSpinner('Guardando plantilla…');
    setTimeout(() => {
        const rows = document.querySelectorAll('#roster-tbody tr');
        const playersData = Array.from(rows).map(row => {
            const number  = row.querySelector('.r-num').value;
            const name    = (row.querySelector('.r-name').value || '').trim();
            const surname = (row.querySelector('.r-surname').value || '').trim();
            let   alias   = (row.querySelector('.r-alias').value || '').trim();
            // Auto-rellenar alias si está vacío: primer apellido o nombre
            if (!alias && surname) alias = surname.split(' ')[0];
            if (!alias && name)    alias = name.split(' ')[0];
            return { number, name, surname, alias };
        });
        const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
        roster[mode] = playersData;
        cloudSet('cronos_master_roster', JSON.stringify(roster));
        saveStaffConfig();
        hideSpinner();
        // Toast en lugar de alert
        showToast('✅ Plantilla y cuerpo técnico guardados');
        openSetupModal();
    }, 300);
}

function openConvocationModal() {
    document.body.classList.add('setup-mode');
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const maxConvoked = currentMode === 'f7' ? 14 : 18;
    const minForMatch = currentMode === 'f7' ? 5 : 7;

    const isMobile = window.innerWidth < 640;
    const cols = isMobile ? 2 : (currentMode === 'f7' ? 3 : 5);

    // Restore saved convocation data
    const savedConv = JSON.parse(localStorage.getItem('cronos_conv_data') || '{}');

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,860px); max-height:94vh; display:flex; flex-direction:column; overflow-y:auto; padding:${isMobile ? '1rem 0.8rem' : '1.5rem'};">

            <div style="flex-shrink:0;">
                <h2 style="margin:0 0 0.1rem; font-size:${isMobile ? '1.1rem' : '1.4rem'};">\u{1F4CB} Convocatoria \u2014 ${TEAM_NAMES.home}</h2>
                <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.6rem;">
                    1\u00ba click: <span style="color:var(--primary);font-weight:700;">Convocado</span> \u00b7 2\u00ba click: <span style="color:#f0883e;font-weight:900;background:rgba(240,136,62,0.15);padding:2px 8px;border-radius:4px;">TITULAR</span> \u00b7 3\u00ba click: Quitar \u00b7 M&iacute;n <span style="color:#f0883e;font-weight:700;">${minForMatch}</span> titulares para partido
                </p>
            </div>

            <!-- \u2500\u2500 DATOS DEL PARTIDO \u2500\u2500 -->
            <div style="background:rgba(88,166,255,0.06); border:1px solid rgba(88,166,255,0.2);
                        border-radius:10px; padding:0.8rem 1rem; margin-bottom:0.8rem;">
                <div style="font-size:0.78rem; font-weight:700; color:var(--primary);
                            margin-bottom:0.5rem; letter-spacing:0.5px;">\u26BD DATOS DEL PARTIDO</div>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:0.5rem;">
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F4C5} Fecha</label>
                        <input type="date" id="conv-date" class="conv-input"
                            value="${savedConv.date || new Date().toISOString().substring(0,10)}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F552} Hora del partido</label>
                        <input type="time" id="conv-time" class="conv-input"
                            value="${savedConv.time || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F3DF}\uFE0F Lugar / Campo</label>
                        <input type="text" id="conv-venue" class="conv-input"
                            placeholder="Nombre del campo o direcci\u00f3n"
                            value="${typeof escapeHtml==='function'? escapeHtml(savedConv.venue||''): savedConv.venue||''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F19A} Rival</label>
                        <input type="text" id="conv-rival" class="conv-input"
                            placeholder="Equipo rival"
                            value="${typeof escapeHtml==='function'? escapeHtml(savedConv.rival||TEAM_NAMES.away||''): savedConv.rival||TEAM_NAMES.away||''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F3C6} Tipo de partido</label>
                        <select id="conv-type" class="conv-input">
                            <option value="liga" ${savedConv.type==='liga'?'selected':''}>Liga</option>
                            <option value="copa" ${savedConv.type==='copa'?'selected':''}>Copa</option>
                            <option value="amistoso" ${(savedConv.type||'amistoso')==='amistoso'?'selected':''}>Amistoso</option>
                            <option value="torneo" ${savedConv.type==='torneo'?'selected':''}>Torneo</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F4DD} Hora presentaci\u00f3n</label>
                        <input type="time" id="conv-meettime" class="conv-input"
                            value="${savedConv.meettime || ''}">
                    </div>
                </div>
            </div>

            <!-- \u2500\u2500 LISTADO DE JUGADORES \u2500\u2500 -->
            <div style="display:grid; grid-template-columns:repeat(${cols}, 1fr); gap:6px; margin-bottom:0.8rem;" id="conv-grid-container">
                ${myPlayers.length > 0 ? myPlayers.map((p, i) => `
                    <div class="conv-row" data-index="${i}" data-state="none"
                        style="background:var(--glass); border:2px solid transparent; border-radius:8px;
                               padding:${isMobile ? '6px 8px' : '8px 10px'}; display:flex; align-items:center; gap:8px;
                               cursor:pointer; transition:all 0.1s; user-select:none;">
                        <span class="conv-dot" style="width:16px;height:16px;border-radius:50%;
                              background:rgba(255,255,255,0.1); border:2px solid rgba(255,255,255,0.25);
                              display:flex;align-items:center;justify-content:center;
                              font-size:0.55rem;flex-shrink:0;color:transparent;">\u2713</span>
                        <span style="font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            <span style="color:var(--primary);font-weight:bold;">${p.number}</span>
                            ${typeof escapeHtml==='function'? escapeHtml(p.alias||p.name||'J'+(i+1)): (p.alias||p.name||'J'+(i+1))}
                        </span>
                        <span class="conv-status-badge" style="font-size:0.5rem;font-weight:bold;padding:2px 5px;
                            border-radius:3px;display:none;margin-left:auto;flex-shrink:0;"></span>
                    </div>
                `).join('') : '<p style="grid-column:1/-1; color:var(--text-muted); font-size:0.8rem; text-align:center; padding:2rem;">No hay jugadores en la plantilla. Ve a GESTIONAR PLANTILLA para a\u00f1adirlos.</p>'}
            </div>

            <!-- \u2500\u2500 BOTONES \u2500\u2500 -->
            <div style="margin-top:auto; padding-top:1rem; border-top:1px solid var(--glass-border);
                        display:flex; flex-direction:column; gap:0.5rem;">

                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div id="conv-count" style="font-size:0.95rem; font-weight:bold; color:var(--primary);">0 convocados · 0 titulares</div>
                    <button class="btn" onclick="openSetupModal()" style="padding:0.4rem 0.8rem; font-size:0.7rem;">\u2190 VOLVER</button>
                </div>

                <div style="display:flex; gap:0.4rem;">
                    <button class="btn" onclick="saveConvData(); saveConvPlayers(); openConvocationMessage('directors')"
                        style="flex:1; background:rgba(88,166,255,0.1); border:1px solid rgba(88,166,255,0.3);
                               color:var(--primary); font-weight:700; font-size:0.72rem;">
                        \u{1F4CB} DIRECTORES
                    </button>
                    <button class="btn" onclick="saveConvData(); saveConvPlayers(); openConvocationMessage('coordinators')"
                        style="flex:1; background:rgba(240,136,62,0.1); border:1px solid rgba(240,136,62,0.3);
                               color:#f0883e; font-weight:700; font-size:0.72rem;">
                        \u{1F3AF} COORDINADORES
                    </button>
                    <button class="btn" onclick="saveConvData(); saveConvPlayers(); openConvocationMessage('parents')"
                        style="flex:1; background:rgba(63,185,80,0.1); border:1px solid rgba(63,185,80,0.3);
                               color:#3fb950; font-weight:700; font-size:0.72rem;">
                        \u{1F468}\u200D\u{1F469}\u200D\u{1F467} PADRES
                    </button>
                </div>

                <button class="btn primary" id="btn-go-titulares" onclick="goToTitularSelection()" disabled
                    style="width:100%; font-weight:900; letter-spacing:1px; padding:0.6rem;">
                    \u26BD IR AL PARTIDO
                </button>
            </div>
        </div>
    `;

    const countEl = document.getElementById('conv-count');
    const goBtn   = document.getElementById('btn-go-titulares');
    const maxTitulares = currentMode === 'f7' ? 7 : 11;
    const minTitulares = currentMode === 'f7' ? 5 : 7;
    let convocados = 0;
    let titulares = 0;

    // \u2500\u2500 Pre-restaurar desde equipo cargado \u2500\u2500
    const loadedTeam = window.loadedTeamPlayers?.['home'];
    if (loadedTeam) {
        myPlayers.forEach((p, i) => {
            const savedPlayer = loadedTeam.find(lp => lp.number == p.number);
            const row = document.querySelector(`.conv-row[data-index="${i}"]`);
            if (row && savedPlayer) {
                const isField = savedPlayer.status === 'field';
                row.dataset.state = isField ? 'titular' : 'convocado';
                row.classList.add('conv-selected');
                if (isField) {
                    row.style.borderColor = '#f0883e';
                    row.style.background  = 'rgba(240,136,62,0.25)';
                    row.style.boxShadow = '0 0 12px rgba(240,136,62,0.3)';
                    const dot = row.querySelector('.conv-dot');
                    dot.style.background  = '#f0883e';
                    dot.style.borderColor = '#f0883e';
                    dot.style.color = '#0a0e14';
                    dot.textContent = 'T';
                    dot.style.fontWeight = '900';
                    const badge = row.querySelector('.conv-status-badge');
                    badge.textContent = 'TITULAR';
                    badge.style.background = '#f0883e';
                    badge.style.color = '#0a0e14';
                    badge.style.display = 'inline';
                    badge.style.fontWeight = '900';
                    titulares++;
                } else {
                    row.style.borderColor = 'var(--primary)';
                    row.style.background  = 'rgba(88,166,255,0.12)';
                    const dot = row.querySelector('.conv-dot');
                    dot.style.background  = 'var(--primary)';
                    dot.style.borderColor = 'var(--primary)';
                    dot.style.color = '#0a0e14';
                    const badge = row.querySelector('.conv-status-badge');
                    badge.textContent = 'CONV';
                    badge.style.background = 'var(--primary)';
                    badge.style.color = '#0a0e14';
                    badge.style.display = 'inline';
                }
                convocados++;
            }
        });
        countEl.innerHTML = '<span style="color:var(--primary)">' + convocados + ' convocados</span> \u00b7 <span style="color:#f0883e;font-weight:700;">' + titulares + ' titulares</span>';
        goBtn.disabled = titulares < minTitulares;
    }

    // \u2500\u2500 Click handler: 3 estados (none \u2192 convocado \u2192 titular \u2192 none) \u2500\u2500
    document.querySelectorAll('.conv-row').forEach(row => {
        row.addEventListener('click', () => {
            const state = row.dataset.state;
            const dot = row.querySelector('.conv-dot');
            const badge = row.querySelector('.conv-status-badge');

            if (state === 'none') {
                // Estado 1: Seleccionar como CONVOCADO (azul)
                row.dataset.state = 'convocado';
                row.classList.add('conv-selected');
                row.style.borderColor = 'var(--primary)';
                row.style.background  = 'rgba(88,166,255,0.12)';
                dot.style.background  = 'var(--primary)';
                dot.style.borderColor = 'var(--primary)';
                dot.style.color = '#0a0e14';
                dot.textContent = '\u2713';
                badge.textContent = 'CONV';
                badge.style.background = 'var(--primary)';
                badge.style.color = '#0a0e14';
                badge.style.display = 'inline';
                convocados++;
            } else if (state === 'convocado') {
                // Estado 2: Promocionar a TITULAR (naranja)
                if (titulares >= maxTitulares) {
                    showToast('\u26A0\ufe0f M\u00e1ximo ' + maxTitulares + ' titulares', 2500);
                    return;
                }
                row.dataset.state = 'titular';
                row.style.borderColor = '#f0883e';
                row.style.background  = 'rgba(240,136,62,0.25)';
                row.style.boxShadow = '0 0 12px rgba(240,136,62,0.3)';
                dot.style.background  = '#f0883e';
                dot.style.borderColor = '#f0883e';
                dot.style.color = '#0a0e14';
                dot.textContent = 'T';
                dot.style.fontWeight = '900';
                badge.textContent = 'TITULAR';
                badge.style.background = '#f0883e';
                badge.style.color = '#0a0e14';
                badge.style.display = 'inline';
                badge.style.fontWeight = '900';
                titulares++;
            } else {
                // Estado 3: Deseleccionar (volver a none)
                row.dataset.state = 'none';
                row.classList.remove('conv-selected');
                row.style.borderColor = 'transparent';
                row.style.background  = 'var(--glass)';
                dot.style.background  = 'rgba(255,255,255,0.1)';
                dot.style.borderColor = 'rgba(255,255,255,0.25)';
                dot.style.color = 'transparent';
                dot.textContent = '\u2713';
                badge.style.display = 'none';
                titulares--;
                convocados--;
            }

            countEl.innerHTML = '<span style="color:var(--primary)">' + convocados + ' convocados</span> \u00b7 <span style="color:#f0883e;font-weight:700;">' + titulares + ' titulares</span>';
            const isValid = titulares >= minTitulares;
            countEl.style.color = isValid ? '#f0883e' : 'var(--primary)';
            goBtn.disabled = !isValid;
        });
    });
}

// \u2500\u2500 Guardar datos de la convocatoria (fecha, hora, lugar, rival, tipo) \u2500\u2500
function saveConvData() {
    const data = {
        date:     document.getElementById('conv-date')?.value     || '',
        time:     document.getElementById('conv-time')?.value     || '',
        venue:    document.getElementById('conv-venue')?.value.trim() || '',
        rival:    document.getElementById('conv-rival')?.value.trim() || '',
        type:     document.getElementById('conv-type')?.value     || 'amistoso',
        meettime: document.getElementById('conv-meettime')?.value || ''
    };
    localStorage.setItem('cronos_conv_data', JSON.stringify(data));
    return data;
}

// ── Guardar jugadores convocados (para el panel de envío) ──
function saveConvPlayers() {
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const convRows = document.querySelectorAll('#conv-grid-container .conv-row[data-state="convocado"], #conv-grid-container .conv-row[data-state="titular"]');
    window._savedConvokedPlayers = Array.from(convRows).map(r => {
        const p = myPlayers[parseInt(r.dataset.index)];
        return p ? { ...p, initialStatus: r.dataset.state === 'titular' ? 'field' : 'bench' } : null;
    }).filter(Boolean);
}

// ── IR AL PARTIDO (desde convocatoria con 3 estados: convocado/titular) ──
function goToTitularSelection() {
    saveConvData();
    saveConvPlayers();

    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const maxTitulares = currentMode === 'f7' ? 7 : 11;

    // Obtener todos los jugadores seleccionados (convocado o titular)
    const allRows = document.querySelectorAll('#conv-grid-container .conv-row[data-state="convocado"], #conv-grid-container .conv-row[data-state="titular"]');
    const matchPlayers = Array.from(allRows).map(r => {
        const p = myPlayers[parseInt(r.dataset.index)];
        return p ? { ...p, initialStatus: r.dataset.state === 'titular' ? 'field' : 'bench' } : null;
    }).filter(Boolean);

    const titularCount = matchPlayers.filter(p => p.initialStatus === 'field').length;

    const minTitulares = currentMode === 'f7' ? 5 : 7;
    const maxConvocados = currentMode === 'f7' ? 14 : 18;
    if (titularCount < minTitulares) {
        alert('Necesitas al menos ' + minTitulares + ' titulares (naranja) para iniciar el partido.\nActualmente tienes ' + titularCount + ' titulares de ' + matchPlayers.length + ' convocados.');
        return;
    }
    if (matchPlayers.length > maxConvocados) {
        alert('Máximo ' + maxConvocados + ' convocados para Fútbol ' + (currentMode === 'f7' ? '7' : '11') + '.\nActualmente tienes ' + matchPlayers.length + ' convocados.\nElimina jugadores de la convocatoria antes de iniciar.');
        return;
    }

    window.activeConvocation = matchPlayers;
    window._convokedPlayers = matchPlayers;

    document.body.classList.remove('setup-mode');
    spawnInitialPlayers();

    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-container').style.display = 'flex';

    renderPlayers();

    // Aplicar formaci\u00f3n inicial solo si no hay posiciones guardadas
    const hasLoadedPositions = window.loadedTeamPlayers?.['home']?.some(p => p.x || p.y);
    if (selectedFormationOnStart && !hasLoadedPositions) {
        applyFormationPreset(selectedFormationOnStart);
    }
    window.loadedTeamPlayers = {};

    // Iniciar transmisi\u00f3n en vivo
    setTimeout(() => startLiveSync(), 800);

    document.getElementById('setup-modal').style.display = 'none';

    // Inyectar botones de scroll en banquillos
    injectBenchScrollButtons('bench-list');
    if (analyzeAway) injectBenchScrollButtons('bench-list-away');
    renderStaffInBench();

    const pitch = document.getElementById('football-pitch');
    pitch.addEventListener('click', () => closeDrawers());
    pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });
}

// ── INICIAR PARTIDO desde selecci\u00f3n de titulares (compatibilidad) ──
function startMatchFromTitularSelection() {
    goToTitularSelection();
}


function startMatchWithConvocation() {
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const rows = document.querySelectorAll('.conv-row.conv-selected');
    
    // Guardar selección con el estatus (titular/suplente)
    const selectedPlayers = Array.from(rows).map(r => {
        const p = myPlayers[r.dataset.index];
        return { 
            ...p, 
            initialStatus: r.dataset.status || 'bench' 
        };
    });
    
    window.activeConvocation = selectedPlayers.length > 0 ? selectedPlayers : null;

    document.body.classList.remove('setup-mode');
    spawnInitialPlayers();

    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-container').style.display = 'flex';

    renderPlayers();

    // Aplicar formación inicial SOLO si no hay posiciones guardadas de un equipo cargado.
    // Si el equipo fue cargado, sus posiciones (x,y) ya fueron restauradas por spawnInitialPlayers
    // y aplicar la formación las sobreescribiría incorrectamente.
    const hasLoadedPositions = window.loadedTeamPlayers?.['home']?.some(p => p.x || p.y);
    if (selectedFormationOnStart && !hasLoadedPositions) {
        applyFormationPreset(selectedFormationOnStart);
    }
    // Limpiar datos de equipo cargado ya aplicados
    window.loadedTeamPlayers = {};

    // Iniciar transmisión en vivo automáticamente (el director puede conectarse cuando quiera)
    setTimeout(() => startLiveSync(), 800);

    document.getElementById('setup-modal').style.display = 'none';

    // Inyectar botones de scroll en ambos banquillos
    injectBenchScrollButtons('bench-list');
    if (analyzeAway) injectBenchScrollButtons('bench-list-away');
    // Mostrar cuerpo técnico en el banquillo
    renderStaffInBench();

    const pitch = document.getElementById('football-pitch');
    pitch.addEventListener('click', () => closeDrawers());
    pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });
}

// --- BOTONES DE SCROLL EN BANQUILLO ---
function injectBenchScrollButtons(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const section = container.closest('.bench-section');
    if (!section || section.querySelector('.bench-scroll-btn')) return;

    const STEP = 120; // px por pulsación

    // Botón ▲ arriba
    const btnUp = document.createElement('button');
    btnUp.className = 'bench-scroll-btn';
    btnUp.innerHTML = '▲ subir';
    btnUp.title = 'Scroll arriba';

    // Scroll continuo al mantener pulsado
    let scrollInterval = null;
    const startScroll = (dir) => {
        container.scrollBy({ top: dir * STEP, behavior: 'smooth' });
        scrollInterval = setInterval(() => {
            container.scrollBy({ top: dir * STEP, behavior: 'auto' });
        }, 300);
    };
    const stopScroll = () => clearInterval(scrollInterval);

    btnUp.addEventListener('pointerdown', (e) => { e.preventDefault(); startScroll(-1); });
    btnUp.addEventListener('pointerup',   stopScroll);
    btnUp.addEventListener('pointerleave', stopScroll);
    btnUp.addEventListener('click', () => container.scrollBy({ top: -STEP, behavior: 'smooth' }));

    // Botón ▼ abajo
    const btnDown = document.createElement('button');
    btnDown.className = 'bench-scroll-btn bottom';
    btnDown.innerHTML = '▼ bajar';
    btnDown.title = 'Scroll abajo';

    btnDown.addEventListener('pointerdown', (e) => { e.preventDefault(); startScroll(1); });
    btnDown.addEventListener('pointerup',   stopScroll);
    btnDown.addEventListener('pointerleave', stopScroll);
    btnDown.addEventListener('click', () => container.scrollBy({ top: STEP, behavior: 'smooth' }));

    // Insertar: ▲ antes del container, ▼ después
    section.insertBefore(btnUp, container);
    section.appendChild(btnDown);
}

// --- PERSISTENCE ---

function populateSavedTeams(teamKey) {
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    if (!dropdown) return;
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

        // Restaurar color secundario si existe
        if (team.secondaryColor) {
            const secEl = document.getElementById(`setup-${teamKey}-secondary`);
            if (secEl) secEl.value = team.secondaryColor;
            // Guardarlo también en COLORS para que esté disponible al iniciar
            if (COLORS[teamKey]) COLORS[teamKey].secondary = team.secondaryColor;
        }

        // Cargar modalidad y formación si están guardadas
        if (team.mode) {
            document.getElementById('setup-mode').value = team.mode;
            updateFormationOptions();
        }
        if (team.formation) {
            document.getElementById('setup-formation').value = team.formation;
        }

        // Guardar los jugadores de este equipo para restaurar convocatoria, titulares y suplentes
        if (!window.loadedTeamPlayers) window.loadedTeamPlayers = {};
        window.loadedTeamPlayers[teamKey] = team.players;
    }
}

function saveCurrentTeam() {
    const choice = prompt("¿Qué equipo quieres guardar?\nEscribe '1' para Local\nEscribe '2' para Visitante");
    if (!choice) return;
    let teamKey = '';
    if (choice === '1' || choice.toLowerCase() === 'local') teamKey = 'home';
    else if (choice === '2' || choice.toLowerCase() === 'visitante') teamKey = 'away';
    else return;

    const teamName = TEAM_NAMES[teamKey];
    // Guardar jugadores: número, nombre, alias, status (titular=field / suplente=bench) y posición en campo
    const currentPlayers = players.filter(p => p.team === teamKey).map(p => ({
        id: p.id,
        number: p.number,
        name: p.name,
        status: p.status,   // 'field' = titular  |  'bench' = suplente
        x: p.x,
        y: p.y
    }));
    const newTeam = {
        name: teamName,
        color: COLORS[teamKey].primary,
        secondaryColor: COLORS[teamKey].secondary,
        shortsColor: COLORS[teamKey].shorts,
        textColor: COLORS[teamKey].text,
        players: currentPlayers,          // convocatoria completa con titulares y suplentes
        mode: currentMode,                // 'f7' o 'f11'
        formation: activeFormationKey     // sistema de juego activo
    };
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const existingIndex = teams.findIndex(t => t.name === teamName);
    if (existingIndex >= 0) {
        if (confirm(`¿Sobrescribir equipo "${teamName}"?`)) teams[existingIndex] = newTeam;
        else return;
    } else {
        if (teams.length >= 20) { alert('Memoria llena (20 equipos).'); return; }
        teams.push(newTeam);
    }
    showSpinner('Guardando equipo…');
    setTimeout(() => {
        cloudSet('cronos_teams', JSON.stringify(teams));
        const titulares = currentPlayers.filter(p => p.status === 'field').length;
        const suplentes = currentPlayers.filter(p => p.status === 'bench').length;
        const formationDisplay = activeFormationKey ? '1-' + activeFormationKey : 'sin definir';
        hideSpinner();
        showToast('✅ ' + teamName + ' guardado · ' + (currentMode === 'f7' ? 'F7' : 'F11') + ' · ' + formationDisplay + ' · ' + titulares + 'T + ' + suplentes + 'S');
    }, 300);
}

function setupEventListeners() {
    document.getElementById('btn-play-pause').addEventListener('click', toggleGame);
    document.getElementById('btn-reset').addEventListener('click', resetMatch);
    document.getElementById('btn-save-team').addEventListener('click', saveCurrentTeam);
    document.getElementById('btn-export').addEventListener('click', exportData);

    window.endFirstHalf = () => {
        if (!confirm("¿Finalizar 1ª Parte?")) return;
        isRunning = false;
        clearInterval(timerInterval);
        const timestamp1 = formatTime(masterTimeH1);
        players.filter(p => p.status === 'field').forEach(p => {
            p.history.push(`Sale a las ${timestamp1} (DESCANSO)`);
        });
        matchPhase = 'break';
        document.getElementById('btn-play-pause').textContent = 'REANUDAR';
        document.getElementById('btn-play-pause').classList.remove('danger');
        updateMasterUI();
        alert("1ª Parte finalizada. Realice los cambios necesarios durante el descanso.");
    };

    window.startSecondHalf = () => {
        matchPhase = '2nd_half';
        const timestamp2 = formatTime(masterTimeH1);
        players.filter(p => p.status === 'field').forEach(p => {
            p.history.push(`Entra a las ${timestamp2} (2ªP)`);
        });
        lastTickTime = Date.now();
        if (!isRunning) toggleGame();
        updateMasterUI();
    };

    const dropZones = ['.sidebar', '.field-area'];
    dropZones.forEach(selector => {
        const el = document.querySelector(selector);
        if (!el) return;
        el.addEventListener('dragenter', () => el.classList.add('drop-hover'));
        el.addEventListener('dragleave', (e) => {
            if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hover');
        });
        el.addEventListener('drop', () => el.classList.remove('drop-hover'));
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isRunning) tick();
    });
}

function spawnInitialPlayers() {
    players = [];
    const defaultStartersLimit = currentMode === 'f7' ? 7 : 11;
    const defaultTotalCount = currentMode === 'f7' ? 14 : 18;
    const homeColors = COLORS.home;
    const homeConvocation = window.activeConvocation;
    const loadedHome = window.loadedTeamPlayers?.['home'];

    if (homeConvocation) {
        homeConvocation.forEach((pData, index) => {
            const playerObj = {
                id: (index + 1),
                number: pData.number,
                name: pData.alias || pData.name || `J${pData.number}`,
                team: 'home',
                // STATUS PRIORITIES: 
                // 1. Convocation choice (Field if 'field', else 'bench')
                // 2. Default F7/F11 limit as fallback
                status: pData.initialStatus === 'field' ? 'field' : 'bench',
                time: 0,
                color: homeColors.primary,
                shortsColor: homeColors.shorts,
                textColor: homeColors.text,
                history: [], goals: 0, cards: 'ninguna', x: 0, y: 0
            };

            // Restaurar estado (titular/suplente) y posición (X,Y) si coincide el dorsal
            if (loadedHome) {
                const saved = loadedHome.find(lp => lp.number == pData.number);
                if (saved) {
                    playerObj.status = saved.status || playerObj.status;
                    playerObj.x = saved.x !== undefined ? saved.x : 0;
                    playerObj.y = saved.y !== undefined ? saved.y : 0;
                }
            }
            players.push(playerObj);
        });
    } else {
        for (let i = 1; i <= defaultTotalCount; i++) {
            players.push({
                id: i, number: i, name: `Jugador ${i}`, team: 'home',
                status: i <= startersCount ? 'field' : 'bench',
                time: 0, color: homeColors.primary, shortsColor: homeColors.shorts,
                textColor: homeColors.text, history: [], goals: 0, cards: 'ninguna', x: 0, y: 0
            });
        }
    }

    if (analyzeAway) {
        const awayColors = COLORS.away;
        for (let i = 1; i <= defaultTotalCount; i++) {
            players.push({
                id: 100 + i, number: i, name: `Rival ${i}`, team: 'away',
                status: i <= startersCount ? 'field' : 'bench',
                time: 0, color: awayColors.primary, shortsColor: awayColors.shorts,
                textColor: awayColors.text, history: [], goals: 0, cards: 'ninguna', x: 0, y: 0
            });
        }
    }

    window.activeConvocation = null;
}

function toggleGame() {
    isRunning = !isRunning;
    const btn = document.getElementById('btn-play-pause');
    if (isRunning) {
        btn.textContent = 'PAUSAR';
        btn.classList.add('danger');
        lastTickTime = Date.now();
        timerInterval = setInterval(tick, 1000);
    } else {
        btn.textContent = 'REANUDAR';
        btn.classList.remove('danger');
        clearInterval(timerInterval);
    }
}

function tick() {
    const now = Date.now();
    const deltaMs = now - lastTickTime;
    const deltaSec = Math.floor(deltaMs / 1000);
    if (deltaSec >= 1) {
        lastTickTime += deltaSec * 1000;
        if (matchPhase === '1st_half') masterTimeH1 += deltaSec;
        else if (matchPhase === '2nd_half') masterTimeH2 += deltaSec;
        updateMasterUI();
        players.forEach(p => {
            if (p.status === 'field') { p.time += deltaSec; updatePlayerUI(p); }
        });
    }
}

function updateMasterUI() {
    const timerH1El = document.getElementById('timer-h1');
    const timerH2El = document.getElementById('timer-h2');
    const containerH1 = document.getElementById('timer-h1-container');
    const containerH2 = document.getElementById('timer-h2-container');
    const phaseLabel = document.getElementById('match-phase-label');
    const actionsEl = document.getElementById('phase-actions');

    const h1Display = masterTimeH1 <= half1MaxTime ? (half1MaxTime - masterTimeH1) : (masterTimeH1 - half1MaxTime);
    timerH1El.textContent = formatTime(h1Display);
    containerH1.classList.toggle('added', masterTimeH1 > half1MaxTime && matchPhase === '1st_half');
    containerH1.classList.toggle('active', matchPhase === '1st_half');

    const h2Display = masterTimeH2 <= half2MaxTime ? (half2MaxTime - masterTimeH2) : (masterTimeH2 - half2MaxTime);
    timerH2El.textContent = formatTime(h2Display);
    containerH2.classList.toggle('added', masterTimeH2 > half2MaxTime);
    containerH2.classList.toggle('active', matchPhase === '2nd_half');

    if (matchPhase === '1st_half') phaseLabel.textContent = masterTimeH1 > half1MaxTime ? '1ª PARTE (AÑADIDO)' : '1ª PARTE';
    else if (matchPhase === 'break') phaseLabel.textContent = 'DESCANSO';
    else if (matchPhase === '2nd_half') phaseLabel.textContent = masterTimeH2 > half2MaxTime ? '2ª PARTE (AÑADIDO)' : '2ª PARTE';
    else if (matchPhase === 'finished') phaseLabel.textContent = 'FIN DEL PARTIDO';

    const prev = document.getElementById('btn-inline-phase');
    if (prev) prev.remove();

    if (matchPhase !== 'finished') {
        const btn = document.createElement('button');
        btn.id = 'btn-inline-phase';
        btn.style.cssText = 'font-size:1.1rem;padding:3px 6px;border-radius:6px;border:none;cursor:pointer;line-height:1;flex-shrink:0;';
        if (matchPhase === '1st_half') {
            btn.textContent = '🏁'; btn.title = 'Finalizar 1ª Parte';
            btn.style.background = '#b8860b';
            btn.onclick = (e) => { e.stopPropagation(); endFirstHalf(); };
            containerH1.insertAdjacentElement('afterend', btn);
        } else if (matchPhase === 'break') {
            btn.textContent = '▶️'; btn.title = 'Iniciar 2ª Parte';
            btn.style.background = '#1a5e8a';
            btn.onclick = (e) => { e.stopPropagation(); startSecondHalf(); };
            containerH2.insertAdjacentElement('beforebegin', btn);
        } else if (matchPhase === '2nd_half') {
            btn.textContent = '🏁'; btn.title = 'Finalizar Partido';
            btn.style.background = '#8b0000';
            btn.onclick = (e) => { e.stopPropagation(); endMatch(); };
            containerH2.insertAdjacentElement('afterend', btn);
        }
    }

    const cancelSubBtn = document.getElementById('btn-cancel-sub');
    actionsEl.innerHTML = '';
    if (cancelSubBtn) actionsEl.appendChild(cancelSubBtn);
}

function editTimer(half) {
    const currentMin = Math.floor((half === 1 ? half1MaxTime : half2MaxTime) / 60);
    const newMin = prompt(`Minutos para la ${half}ª parte:`, currentMin);
    if (newMin !== null && !isNaN(newMin) && newMin > 0) {
        if (half === 1) half1MaxTime = parseInt(newMin) * 60;
        else half2MaxTime = parseInt(newMin) * 60;
        updateMasterUI();
    }
}

// ── SPINNER DE CARGA ──────────────────────────────────────────────
function showSpinner(msg) {
    msg = msg || 'Guardando…';
    let overlay = document.getElementById('cronos-spinner');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cronos-spinner';
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(10,14,20,0.75);z-index:99999;' +
            'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;' +
            'backdrop-filter:blur(3px);';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML =
        '<div style="width:44px;height:44px;border-radius:50%;' +
        'border:4px solid rgba(88,166,255,0.2);border-top-color:#58a6ff;' +
        'animation:spinnerRotate 0.8s linear infinite;"></div>' +
        '<p style="color:#cdd9e5;font-size:0.9rem;font-weight:700;margin:0;">' + msg + '</p>' +
        '<style>@keyframes spinnerRotate{to{transform:rotate(360deg)}}</style>';
    overlay.style.display = 'flex';
}

function hideSpinner() {
    const overlay = document.getElementById('cronos-spinner');
    if (overlay) overlay.style.display = 'none';
}

function showToast(msg, duration) {
    duration = duration || 3000;
    const existing = document.getElementById('cronos-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'cronos-toast';
    toast.textContent = msg;
    toast.style.cssText =
        'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
        'background:#1a7a3e;color:#fff;padding:10px 22px;border-radius:8px;' +
        'font-size:0.85rem;font-weight:700;z-index:99998;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.4);white-space:nowrap;' +
        'animation:toastIn 0.2s ease;';
    const style = document.createElement('style');
    style.textContent = '@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(style);
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, duration);
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- RENDER ---

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

// --- FORMACIONES HEREDADAS (para posicionamiento inicial si no se usa preset) ---
const FORMATIONS = {
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

const FORMATIONS_FULL = {
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

// --- DRAG & DROP ---

function allowDrop(e) { e.preventDefault(); }

function resolveOverlaps(ox, oy, excludeId) {
    const PUSH_DIST = 10;
    players.forEach(p => {
        if (p.status !== 'field' || p.id == excludeId) return;
        let dx = p.x - ox;
        let dy = p.y - oy;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PUSH_DIST) {
            if (dist === 0) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; dist = 0.05; }
            const pushFactor = (PUSH_DIST - dist) / dist;
            const newX = p.x + dx * pushFactor * 0.4;
            const newY = p.y + dy * pushFactor * 0.4;
            const clamped = clampToField(newX, newY);
            p.x = clamped.x; p.y = clamped.y;
        }
    });
}

function toggleBench(team) {
    const selector = team === 'home' ? '.sidebar' : '.sidebar-right';
    const otherSelector = team === 'home' ? '.sidebar-right' : '.sidebar';
    const drawer = document.querySelector(selector);
    const otherDrawer = document.querySelector(otherSelector);
    if (otherDrawer) otherDrawer.classList.remove('open');
    if (drawer) drawer.classList.toggle('open');
}

function closeDrawers() {
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.sidebar-right')?.classList.remove('open');
}

function dropToField(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId') || touchData.draggedPlayerId;
    const player = players.find(p => p.id == playerId);
    if (!player) return;

    const pitch = document.getElementById('football-pitch');
    const rect = pitch.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    // Calcular porcentajes ANTES del clamp
    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = ((clientY - rect.top) / rect.height) * 100;
    // Clamp para que nombre y crono nunca salgan del campo
    const clamped = clampToField(rawX, rawY);
    const xPct = clamped.x;
    const yPct = clamped.y;

    const teamFieldPlayers = players.filter(p => p.team === player.team && p.status === 'field');
    const fieldLimit = currentMode === 'f7' ? 7 : 11;

    // Buscar swap con jugador del mismo equipo cercano
    let targetPlayer = null;
    let minDistance = 8;
    teamFieldPlayers.forEach(p => {
        if (p.id == player.id) return;
        const dx = xPct - p.x;
        const dy = yPct - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDistance) { minDistance = dist; targetPlayer = p; }
    });

    if (!targetPlayer && player.status === 'bench' && teamFieldPlayers.length >= fieldLimit) {
        let absMinDist = 999;
        teamFieldPlayers.forEach(p => {
            const dx = xPct - p.x;
            const dy = yPct - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < absMinDist) { absMinDist = dist; targetPlayer = p; }
        });
    }

    if (targetPlayer) {
        handleSmartSwap(player, targetPlayer);
    } else {
        const currentFieldPlayers = players.filter(p => p.team === player.team && p.status === 'field');
        if (player.status === 'field' || currentFieldPlayers.length < fieldLimit) {
            resolveOverlaps(xPct, yPct, player.id);
            player.status = 'field';
            player.x = xPct;
            player.y = yPct;
            if (player.history.length === 0 || !player.history[player.history.length - 1].includes('Entra')) {
                logMovement(player);
            }
        }
    }

    renderPlayers();
}

function dropToBench(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId');
    const actualId = playerId || touchData.draggedPlayerId;
    const player = players.find(p => p.id == actualId);
    if (!player || player.team !== 'home') return;
    handleBenchDrop(e, player);
}

function dropToAwayBench(e) {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId');
    const actualId = playerId || touchData.draggedPlayerId;
    const player = players.find(p => p.id == actualId);
    if (!player || player.team !== 'away') return;
    handleBenchDrop(e, player);
}

function handleBenchDrop(e, player) {
    const clientX = e.clientX;
    const clientY = e.clientY;
    const potentialTargets = players.filter(p => p.team === player.team && p.status === 'bench' && p.id !== player.id);

    if (player.cards === 'roja' && player.status === 'field') {
        player.status = 'bench'; player.x = 0; player.y = 0;
        if (isRunning) logMovement(player);
        renderPlayers(); sortBenchUI(player.team); return;
    }

    if (potentialTargets.length === 0) {
        if (player.status !== 'bench' || player.cards === 'roja') {
            player.status = 'bench'; player.x = 0; player.y = 0;
            if (isRunning) logMovement(player);
        }
        renderPlayers(); return;
    }

    let targetPlayer = null;
    let minDistance = 9999;
    const directHitMargin = 40;

    potentialTargets.forEach(tp => {
        const chip = document.getElementById(`player-${tp.id}`);
        if (chip) {
            const rect = chip.getBoundingClientRect();
            const isInside = (
                clientX >= rect.left - directHitMargin && clientX <= rect.right + directHitMargin &&
                clientY >= rect.top - directHitMargin && clientY <= rect.bottom + directHitMargin
            );
            if (isInside) {
                const dx = clientX - (rect.left + rect.width / 2);
                const dy = clientY - (rect.top + rect.height / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDistance) { minDistance = dist; targetPlayer = tp; }
            }
        }
    });

    if (!targetPlayer && player.status === 'field') {
        minDistance = 9999;
        potentialTargets.forEach(tp => {
            const chip = document.getElementById(`player-${tp.id}`);
            if (chip) {
                const rect = chip.getBoundingClientRect();
                const dx = clientX - (rect.left + rect.width / 2);
                const dy = clientY - (rect.top + rect.height / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDistance) { minDistance = dist; targetPlayer = tp; }
            }
        });
    }

    if (targetPlayer) {
        handleSmartSwap(player, targetPlayer);
    } else {
        if (player.status !== 'bench') {
            const teamBench = players.filter(p => p.team === player.team && p.status === 'bench').sort((a, b) => (a.benchOrder || 0) - (b.benchOrder || 0));
            player.status = 'bench'; player.x = 0; player.y = 0;
            teamBench.push(player);
            teamBench.forEach((p, i) => p.benchOrder = i);
            if (isRunning) logMovement(player);
        }
    }

    renderPlayers();
}

function handleSmartSwap(dragged, target) {
    if (dragged.cards === 'roja') {
        if (target.status === 'bench') {
            dragged.status = 'bench'; dragged.x = 0; dragged.y = 0;
            if (isRunning) logMovement(dragged);
            renderPlayers(); sortBenchUI(dragged.team); return;
        } else {
            alert("Un jugador expulsado no puede volver al campo."); return;
        }
    }
    if (target.cards === 'roja') { alert("No se puede realizar cambios con un jugador expulsado."); return; }

    const oldDraggedStatus = dragged.status;
    const oldDraggedX = dragged.x;
    const oldDraggedY = dragged.y;
    const oldDraggedOrder = dragged.benchOrder;

    dragged.status = target.status;
    dragged.x = target.x; dragged.y = target.y;
    dragged.benchOrder = target.benchOrder;

    target.status = oldDraggedStatus;
    target.x = oldDraggedX; target.y = oldDraggedY;
    target.benchOrder = oldDraggedOrder;

    if (dragged.status === 'bench') { dragged.x = 0; dragged.y = 0; }
    if (target.status === 'bench') { target.x = 0; target.y = 0; }

    // Clamp posiciones en campo
    if (dragged.status === 'field') { const c = clampToField(dragged.x, dragged.y); dragged.x = c.x; dragged.y = c.y; }
    if (target.status === 'field') { const c = clampToField(target.x, target.y); target.x = c.x; target.y = c.y; }

    if (isRunning) {
        // Generar ID de sustitución compartido para emparejar los dos jugadores
        const subId = Date.now();
        logMovement(dragged, subId);
        logMovement(target,  subId);
    }
    if (dragged.status === 'bench' || target.status === 'bench') sortBenchUI(dragged.team);
}

function logMovement(player, subId) {
    const elapsed = matchPhase === '2nd_half' ? (masterTimeH1 + masterTimeH2) : masterTimeH1;
    const timestamp = formatTime(elapsed);
    const halfLabel = matchPhase === '1st_half' ? '1ªP' : matchPhase === '2nd_half' ? '2ªP' : 'DESC';
    const action = player.status === 'field' ? 'Entra' : 'Sale';
    // subId permite emparejar la entrada con la salida en el informe
    player.history.push(`${action} a las ${timestamp} (${halfLabel})${subId ? ' #' + subId : ''}`);
}

function logEvent(player, eventType) {
    // Registra gol, tarjeta o lesión con el minuto exacto
    const elapsed = matchPhase === '2nd_half' ? (masterTimeH1 + masterTimeH2) : masterTimeH1;
    const timestamp = formatTime(elapsed);
    const halfLabel = matchPhase === '1st_half' ? '1ªP' : matchPhase === '2nd_half' ? '2ªP' : 'DESC';
    player.history.push(`${eventType} a las ${timestamp} (${halfLabel})`);
}

function resetMatch() {
    if (!confirm("¿Reiniciar partido? Se perderá el tiempo y las estadísticas, pero se mantendrán los jugadores.")) return;
    isRunning = false;
    clearInterval(timerInterval);
    masterTimeH1 = 0; masterTimeH2 = 0;
    lastTickTime = 0; matchPhase = '1st_half';
    updateMasterUI();
    const btn = document.getElementById('btn-play-pause');
    btn.textContent = 'EMPEZAR'; btn.classList.remove('danger');
    const startersCount = currentMode === 'f7' ? 7 : 11;
    let homeCount = 0, awayCount = 0;
    players.forEach((p) => {
        p.time = 0; p.history = []; p.x = 0; p.y = 0;
        if (p.team === 'home') { homeCount++; p.status = homeCount <= startersCount ? 'field' : 'bench'; }
        else { awayCount++; p.status = awayCount <= startersCount ? 'field' : 'bench'; }
    });
    activeFormationKey = null;
    document.querySelectorAll('.formation-btn').forEach(b => b.classList.remove('active'));
    renderPlayers();
}

function goBackToSetup() {
    if (isRunning) {
        isRunning = false; clearInterval(timerInterval);
        document.getElementById('btn-play-pause').textContent = 'REANUDAR';
        document.getElementById('btn-play-pause').classList.remove('danger');
    }
    // Finalizar transmisión en vivo al volver al inicio
    stopLiveSync();
    // Ocultar card de staff al volver al setup
    const staffCard = document.getElementById('staff-bench-card');
    if (staffCard) { staffCard.style.display = 'none'; staffCard.innerHTML = ''; }
    openSetupModal();
}

function changeScore(team, delta) {
    const el = document.getElementById(`score-${team}`);
    const current = parseInt(el.textContent) || 0;
    const next = Math.max(0, current + delta);
    if (delta > 0) {
        const teamPlayers = players.filter(p => p.team === team);
        if (teamPlayers.length > 0) {
            const listLines = teamPlayers.map((p, i) =>
                `${i + 1}. [${p.status === 'field' ? 'CAMPO' : 'BAN'}] ${p.number} - ${p.name}`
            ).join('\n');
            const answer = prompt(
                `⚽ GOL de ${team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away}\n¿Quién ha marcado? (escribe el número de la lista)\n\n${listLines}`, ''
            );
            const idx = parseInt(answer) - 1;
            if (!isNaN(idx) && idx >= 0 && idx < teamPlayers.length) {
                teamPlayers[idx].goals = (teamPlayers[idx].goals || 0) + 1;
                renderPlayers();
            }
            syncScoreFromPlayers(team);
        } else {
            el.textContent = next;
        }
    } else {
        el.textContent = next;
    }
}

async function exportData() {
    const allPlayers = [...players];
    const processedPlayers = allPlayers.map(p => {
        const shiftsH1 = [], shiftsH2 = [];
        let descanso = "", currentEntry = null, currentHalf = "";
        const hasImplicitStart = (p.history.length > 0 && p.history[0].includes('Sale')) ||
            (p.history.length === 0 && (p.time > 0 || p.status === 'field'));
        if (hasImplicitStart) { currentEntry = "00:00"; currentHalf = "1ªP"; }
        p.history.forEach(h => {
            const timeMatch = h.match(/(\d{2}:\d{2})/);
            const halfMatch = h.match(/\(([^)]+)\)/);
            const timestamp = timeMatch ? timeMatch[1] : "";
            const halfLabel = halfMatch ? halfMatch[1] : "";
            if (h.includes('Entra')) { currentEntry = timestamp; currentHalf = halfLabel; }
            else if (h.includes('Sale')) {
                if (halfLabel === 'DESCANSO') {
                    descanso = timestamp;
                    shiftsH1.push({ in: currentEntry || "00:00", out: timestamp });
                    currentEntry = null; currentHalf = "";
                } else if (currentHalf === '2ªP' || halfLabel === '2ªP') {
                    if (currentEntry) { shiftsH2.push({ in: currentEntry, out: timestamp }); currentEntry = null; currentHalf = ""; }
                } else {
                    if (currentEntry) { shiftsH1.push({ in: currentEntry, out: timestamp }); currentEntry = null; currentHalf = ""; }
                }
            }
        });
        if (currentEntry) {
            if (currentHalf === '2ªP') shiftsH2.push({ in: currentEntry, out: "" });
            else shiftsH1.push({ in: currentEntry, out: "" });
        }
        // Extraer eventos del historial (goles, tarjetas, lesión) con minuto
        const events = [];
        p.history.forEach(h => {
            const timeMatch = h.match(/(\d{2}:\d{2})/);
            const halfMatch = h.match(/\(([^)]+)\)/);
            const t = timeMatch ? timeMatch[1] : '';
            const half = halfMatch ? halfMatch[1] : '';
            if (h.includes('GOL'))             events.push({ type: 'GOL',      time: t, half });
            if (h.includes('AMARILLA'))        events.push({ type: 'AMARILLA', time: t, half });
            if (h.includes('ROJA'))            events.push({ type: 'ROJA',     time: t, half });
            if (h.includes('LESIÓN'))          events.push({ type: 'LESIÓN',   time: t, half });
        });
        return { ...p, shiftsH1, shiftsH2, descanso, events };
    });

    // ── Construir mapa de colores para sustituciones emparejadas ──────────
    // Paleta de 10 colores distinguibles (fondo claro para texto negro)
    const SUB_COLORS = [
        '#FFD700','#90EE90','#87CEEB','#FFB6C1','#DDA0DD',
        '#F0E68C','#98FB98','#ADD8E6','#FFA07A','#B0C4DE'
    ];
    const subColorMap = {}; // subId → color
    let subColorIdx   = 0;

    // Recorrer historial de todos los jugadores para asignar color por subId
    processedPlayers.forEach(p => {
        p.history.forEach(h => {
            const subMatch = h.match(/#(\d+)/);
            if (subMatch) {
                const sid = subMatch[1];
                if (!subColorMap[sid]) {
                    subColorMap[sid] = SUB_COLORS[subColorIdx % SUB_COLORS.length];
                    subColorIdx++;
                }
            }
        });
    });

    // Añadir color a cada shift del jugador
    processedPlayers.forEach(p => {
        // Buscar subIds en el historial y asociarlos a los shifts
        let h1idx = 0, h2idx = 0;
        p.history.forEach(h => {
            const subMatch = h.match(/#(\d+)/);
            const color    = subMatch ? subColorMap[subMatch[1]] : null;
            const half     = h.match(/\(([^)]+)\)/)?.[1] || '';
            if (h.includes('Entra') || h.includes('Sale')) {
                if (half === '2ªP') {
                    if (p.shiftsH2[h2idx]) { p.shiftsH2[h2idx].color = color; h2idx++; }
                } else {
                    if (p.shiftsH1[h1idx]) { p.shiftsH1[h1idx].color = color; h1idx++; }
                }
            }
        });
    });

    const maxH1 = Math.max(...processedPlayers.map(p => p.shiftsH1.length), 1);
    const maxH2 = Math.max(...processedPlayers.map(p => p.shiftsH2.length), 1);
    const totalCols = 5 + (maxH1 * 2) + 1 + (maxH2 * 2) + 1;
    const q = (v) => `"${(v || "").toString().replace(/"/g, '""')}"`;
    const makeRow = (cells) => { const r = [...cells]; while (r.length < totalCols) r.push(""); return r.map(q).join(";") + "\n"; };

    let csvContent = "sep=;\n";
    const date = new Date().toLocaleDateString();
    const mode = currentMode === 'f7' ? 'Futbol 7' : 'Futbol 11';
    const homeName = TEAM_NAMES.home, awayName = TEAM_NAMES.away;
    const scoreHome = document.getElementById('score-home').textContent;
    const scoreAway = document.getElementById('score-away').textContent;
    const totalElapsed = masterTimeH1 + masterTimeH2;

    csvContent += makeRow(["FECHA", date]);
    csvContent += makeRow(["MODO", mode]);
    csvContent += makeRow(["ENCUENTRO", `${homeName} vs ${awayName}`]);
    csvContent += makeRow(["RESULTADO", `${scoreHome} - ${scoreAway}`]);
    csvContent += makeRow(["TIEMPO GLOBAL", formatTime(totalElapsed)]);
    csvContent += makeRow([]);

    const sectionRow = ["","","","",""];
    sectionRow.push("=== 1ª PARTE ===");
    for (let i = 1; i < maxH1 * 2; i++) sectionRow.push("");
    sectionRow.push("=== DESCANSO ===");
    sectionRow.push("=== 2ª PARTE ===");
    for (let i = 1; i < maxH2 * 2; i++) sectionRow.push("");
    sectionRow.push("");
    csvContent += makeRow(sectionRow);

    const headers = ["EQUIPO","DORSAL","NOMBRE","GOLES","TARJETAS","LESION",
                      "EVENTOS (minuto - tipo)"];
    for (let i = 1; i <= maxH1; i++) headers.push(`ENTRADA ${i}`, `SALIDA ${i}`);
    headers.push("MIN. DESCANSO");
    for (let i = 1; i <= maxH2; i++) headers.push(`ENTRADA ${i}`, `SALIDA ${i}`);
    headers.push("TIEMPO TOTAL");
    csvContent += makeRow(headers);

    const sortedPlayers = [...processedPlayers].sort((a, b) => {
        if (a.team !== b.team) return a.team === 'home' ? -1 : 1;
        return a.number - b.number;
    });

    sortedPlayers.forEach(p => {
        const teamName = p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away;
        const cardDisplay = p.cards === 'ninguna' ? "" : (p.cards === 'amarilla' ? "AMARILLA" : "ROJA");
        const injuryDisplay = p.injured ? 'SI' : '';
        const eventsDisplay = (p.events || [])
            .map(e => e.time + ' (' + e.half + ') ' + e.type)
            .join(' | ');
        const rowCells = [teamName, p.number, p.name, p.goals || 0, cardDisplay,
                          injuryDisplay, eventsDisplay];
        // Añadir número de cambio (C1, C2...) junto al minuto para identificar pares
        const getShiftLabel = (s) => {
            if (!s) return ['', ''];
            const changeNum = s.color ? ' (C' + (Object.values(subColorMap).indexOf(s.color) + 1) + ')' : '';
            return [s.in ? s.in + changeNum : '', s.out ? s.out + changeNum : ''];
        };
        for (let i = 0; i < maxH1; i++) { const sl = getShiftLabel(p.shiftsH1[i]); rowCells.push(sl[0], sl[1]); }
        rowCells.push(p.descanso || '');
        for (let i = 0; i < maxH2; i++) { const sl = getShiftLabel(p.shiftsH2[i]); rowCells.push(sl[0], sl[1]); }
        rowCells.push(formatTime(p.time));
        csvContent += makeRow(rowCells);
    });

    // Añadir leyenda de cambios al final del CSV
    if (Object.keys(subColorMap).length > 0) {
        csvContent += makeRow([]);
        csvContent += makeRow(['=== LEYENDA DE CAMBIOS ===']);
        csvContent += makeRow(['CAMBIO', 'JUGADOR QUE SALE', 'JUGADOR QUE ENTRA', 'MINUTO']);
        Object.entries(subColorMap).forEach(([sid, color], idx) => {
            const paired = processedPlayers.filter(p =>
                p.history.some(h => h.includes('#' + sid))
            );
            const salida  = paired.find(p => p.history.some(h => h.includes('#' + sid) && h.includes('Sale')));
            const entrada = paired.find(p => p.history.some(h => h.includes('#' + sid) && h.includes('Entra')));
            const timeMatch = (salida || entrada)?.history
                .find(h => h.includes('#' + sid))?.match(/(\d{2}:\d{2})/);
            csvContent += makeRow([
                'C' + (idx + 1),
                salida  ? salida.number  + ' ' + salida.name  : '',
                entrada ? entrada.number + ' ' + entrada.name : '',
                timeMatch ? timeMatch[1] : ''
            ]);
        });
    }

    const metaEl = document.getElementById('report-metadata');
    const bodyEl = document.getElementById('report-players-body');
    metaEl.innerHTML = `
        <div><strong>Fecha:</strong> ${date}</div>
        <div><strong>Partido:</strong> ${homeName} vs ${awayName}</div>
        <div><strong>Resultado:</strong> ${scoreHome} - ${scoreAway}</div>
        <div><strong>Competición:</strong> ${mode}</div>
        <div><strong>Tiempo Global:</strong> ${formatTime(totalElapsed)}</div>
    `;
    bodyEl.innerHTML = sortedPlayers.map(p => {
        const teamName = p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away;
        const cardDisplay = p.cards === 'ninguna' ? "" : (p.cards === 'amarilla' ? "🟨 AMARILLA" : "🟥 ROJA");
        // Generar celdas de entrada/salida con colores de sustitución
        const makeShiftCells = (shifts) => shifts.map(s => {
            const bg    = s && s.color ? s.color : 'transparent';
            const style = `border:1px solid #ddd;padding:6px 8px;text-align:center;background:${bg};font-weight:${s&&s.color?'700':'400'};font-size:0.82rem;`;
            const inVal  = s ? s.in  : '';
            const outVal = s ? s.out : '';
            return `<td style="${style}">${inVal}</td><td style="${style}">${outVal}</td>`;
        }).join('');

        return `<tr>
            <td style="border:1px solid #ddd;padding:8px;">${teamName}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:700;">${p.number}</td>
            <td style="border:1px solid #ddd;padding:8px;">${p.name}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${p.goals || 0}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${cardDisplay}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${p.injured ? '🚑' : '-'}</td>
            <td style="border:1px solid #ddd;padding:8px;font-size:0.8rem;color:#333;">
                ${(p.events||[]).map(e =>
                    e.time + '(' + e.half + ') ' +
                    (e.type==='GOL' ? '⚽' : e.type==='AMARILLA' ? '🟨' : e.type==='ROJA' ? '🟥' : '🚑')
                ).join('  ')}
            </td>
            ${makeShiftCells(p.shiftsH1.concat(Array(maxH1 - p.shiftsH1.length).fill(null)))}
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${p.descanso||''}</td>
            ${makeShiftCells(p.shiftsH2.concat(Array(maxH2 - p.shiftsH2.length).fill(null)))}
            <td style="border:1px solid #ddd;padding:8px;text-align:right;">${formatTime(p.time)}</td>
        </tr>`;
    }).join('');

    // Añadir leyenda de colores de sustituciones al informe imprimible
    const legendEl = document.getElementById('report-sub-legend');
    if (legendEl) {
        const usedColors = Object.entries(subColorMap);
        if (usedColors.length > 0) {
            // Encontrar qué jugadores comparten cada color
            const pairsByColor = {};
            usedColors.forEach(([sid, color]) => {
                const paired = processedPlayers.filter(p =>
                    p.history.some(h => h.includes('#' + sid))
                ).map(p => p.number + ' ' + p.name);
                pairsByColor[color] = paired;
            });
            legendEl.innerHTML = '<strong style="font-size:0.85rem;">🔄 Leyenda de sustituciones:</strong><br>' +
                Object.entries(pairsByColor).map(([color, names]) =>
                    `<span style="display:inline-flex;align-items:center;gap:5px;
                                  margin:3px 8px 3px 0;padding:3px 8px;
                                  background:${color};border-radius:4px;
                                  font-size:0.78rem;font-weight:700;color:#000;">
                        ${names.join(' ⇄ ')}
                    </span>`
                ).join('');
        } else {
            legendEl.innerHTML = '';
        }
    }

    window.print();

    // --- DESCARGA LOCAL (copia para el entrenador) ---
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cronos_${homeName}_vs_${awayName}_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // ── WHATSAPP: automático, principal ────────────────────────────
    const waNumbers = [emailConfig.whatsappNumber, emailConfig.whatsappNumber2]
        .filter(n => n && n.length > 5);

    const waLines = sortedPlayers.filter(p => p.team === 'home').map(p => {
        const card    = p.cards === 'amarilla' ? ' 🟨' : p.cards === 'roja' ? ' 🟥' : '';
        const goals   = p.goals > 0 ? ' ⚽×' + p.goals : '';
        const injured = p.injured ? ' 🚑' : '';
        const evts    = (p.events||[]).map(e =>
            e.time + '(' + e.half + ')' +
            (e.type==='GOL'?'⚽':e.type==='AMARILLA'?'🟨':e.type==='ROJA'?'🟥':'🚑')
        ).join(' ');
        return p.number + '. ' + p.name + ' — ' + formatTime(p.time) +
               goals + card + injured + (evts ? ' [' + evts + ']' : '');
    });

    const waMsg = '📊 *INFORME — Cronos Fútbol*\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        '📅 ' + date + '  |  ' + mode + '\n' +
        '⚽ *' + homeName + ' ' + scoreHome + ' - ' + scoreAway + ' ' + awayName + '*\n' +
        '⏱️ ' + formatTime(totalElapsed) + '\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        waLines.join('\n') + '\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        '_Cronos Fútbol_';

    if (waNumbers.length > 0) {
        const encoded = encodeURIComponent(waMsg);
        waNumbers.forEach((num, i) => {
            setTimeout(() => {
                window.open('https://wa.me/' + num + '?text=' + encoded, '_blank');
            }, i * 1200);
        });
        showToast('📱 WhatsApp abierto — pulsa Enviar para confirmar');
    } else {
        showToast('✅ Informe descargado');
    }

    // ── EMAIL: alternativo con mailto (correo personal, sin cuentas extra) ──
    const emailRecipients = [emailConfig.directorEmail, emailConfig.directorEmail2]
        .filter(e => e && e.includes('@')).join(',');
    if (emailRecipients) {
        const subj = encodeURIComponent('📊 Informe ' + homeName + ' ' + scoreHome +
                     '-' + scoreAway + ' ' + awayName + ' · ' + date);
        const body = encodeURIComponent(waMsg.replace(/[*_]/g, ''));
        setTimeout(() => {
            window.open('mailto:' + emailRecipients + '?subject=' + subj + '&body=' + body);
        }, waNumbers.length > 0 ? 1500 : 0);
    }

}




// ══════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Panel SuperAdmin v3

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ✏️  DATOS DEL SUPERADMINISTRADOR — Rellenar antes de publicar
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SA_CONFIG = {
    nombre:      'TU_NOMBRE_O_NOMBRE_COMERCIAL',   // ej: "José · Cronos Fútbol"
    bizum:       'TU_NUMERO_BIZUM',                // ej: "612 345 678"
    iban:        'TU_IBAN',                        // ej: "ES12 3456 7890 1234 5678 9012"
    whatsapp:    'TU_NUMERO_WHATSAPP',             // ej: "34612345678" (sin + ni espacios)
    email:       'TU_EMAIL_COMERCIAL',             // ej: "cronos@tudominio.com"
    appUrl:      'https://jarg7435.github.io/cronos-futbol/',
};
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tarjetas expandibles · Notificaciones · Usuarios individuales
// ══════════════════════════════════════════════════════════════════

const LIVE_ROLES  = ['superadmin','admin','club_admin','director','coordinator'];
const ROLE_META   = {
    superadmin:  { label:'👑 SuperAdmin',    color:'#ffd700' },
    admin:       { label:'👑 SuperAdmin',    color:'#ffd700' },
    club_admin:  { label:'🏟️ Admin Club',   color:'#58a6ff' },
    director:    { label:'📋 Director Dep.', color:'#f0883e' },
    coordinator: { label:'🎯 Coordinador',  color:'#d2a8ff' },
    user:        { label:'⚽ Entrenador',   color:'#3fb950' },
    individual:  { label:'👤 Individual',   color:'#79c0ff' },
};
const PLAN_META   = {
    free:     { label:'🆓 Gratis',   color:'#7d8590' },
    trial:    { label:'⏳ Prueba',   color:'#f0883e' },
    basic:    { label:'📦 Básico',   color:'#58a6ff' },
    pro:      { label:'🚀 Pro',      color:'#3fb950' },
    premium:  { label:'💎 Premium',  color:'#ffd700' },
    custom:   { label:'⚙️ Custom',   color:'#d2a8ff' },
    monthly:  { label:'📅 Mensual',  color:'#58a6ff' },
    annual:   { label:'📆 Anual',    color:'#3fb950' },
};
const STATUS_META = {
    active:   { label:'✅ Activo',    color:'#3fb950' },
    trial:    { label:'⏳ Prueba',    color:'#f0883e' },
    overdue:  { label:'⚠️ Vencido',  color:'#ffa500' },
    blocked:  { label:'🔒 Bloqueado', color:'#ff5858' },
};

// ── Estilos del panel ────────────────────────────────────────────────
const SA_CSS = `
<style id="sa-styles">
.sa-modal{width:1060px;max-width:99vw;max-height:96vh;overflow:hidden;
  display:flex;flex-direction:column;padding:0;}
.sa-topbar{display:flex;justify-content:space-between;align-items:center;
  padding:1rem 1.4rem;border-bottom:1px solid var(--glass-border);flex-shrink:0;}
.sa-tabs{display:flex;gap:0.3rem;padding:0.6rem 1.4rem;
  border-bottom:1px solid var(--glass-border);flex-shrink:0;flex-wrap:wrap;}
.sa-tab{padding:0.42rem 1rem;background:var(--glass);border:1px solid var(--glass-border);
  border-radius:8px;color:var(--text-muted);font-size:0.82rem;cursor:pointer;
  transition:all 0.15s;}
.sa-tab:hover{border-color:rgba(88,166,255,0.4);color:var(--primary);}
.sa-tab.active{background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.5);
  color:var(--primary);font-weight:700;}
.sa-body{flex:1;overflow-y:auto;padding:1.2rem 1.4rem;}
.sa-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));
  gap:0.6rem;margin-bottom:1.4rem;}
.sa-stat{background:var(--glass);border:1px solid var(--glass-border);
  border-radius:10px;padding:0.8rem 1rem;text-align:center;}
.sa-stat-n{font-size:1.8rem;font-weight:700;line-height:1;}
.sa-stat-l{font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;}

/* ─ Tarjeta expandible ─ */
.sa-card{background:var(--glass);border:1px solid var(--glass-border);
  border-radius:11px;margin-bottom:0.65rem;overflow:hidden;transition:border-color 0.2s;}
.sa-card:hover{border-color:rgba(88,166,255,0.35);}
.sa-card.blocked{border-color:rgba(255,88,88,0.4);background:rgba(255,88,88,0.03);}
.sa-card.overdue{border-color:rgba(255,165,0,0.45);}
.sa-card.expanded{border-color:rgba(88,166,255,0.45);}
.sa-card-head{display:flex;justify-content:space-between;align-items:center;
  padding:0.85rem 1.1rem;cursor:pointer;user-select:none;flex-wrap:wrap;gap:0.4rem;}
.sa-card-head:hover{background:rgba(255,255,255,0.02);}
.sa-card-title{font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:0.5rem;}
.sa-card-meta{display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;}
.sa-card-body{display:none;padding:0 1.1rem 1rem;border-top:1px solid var(--glass-border);}
.sa-card.expanded .sa-card-body{display:block;}
.sa-chevron{font-size:0.75rem;transition:transform 0.2s;color:var(--text-muted);}
.sa-card.expanded .sa-chevron{transform:rotate(180deg);}

/* ─ Badge ─ */
.sa-badge{display:inline-block;padding:0.14rem 0.55rem;border-radius:4px;
  font-size:0.7rem;font-weight:700;white-space:nowrap;}

/* ─ User row inside card ─ */
.sa-urow{display:flex;justify-content:space-between;align-items:center;
  padding:0.45rem 0.5rem;border-radius:7px;margin-bottom:0.3rem;
  background:rgba(255,255,255,0.03);}
.sa-urow:hover{background:rgba(255,255,255,0.06);}

/* ─ Botones ─ */
.sa-btn{padding:0.3rem 0.7rem;border-radius:6px;font-size:0.76rem;
  cursor:pointer;border:1px solid;font-weight:600;white-space:nowrap;}

/* ─ Input / Select ─ */
.sa-input{width:100%;padding:0.45rem 0.65rem;background:rgba(255,255,255,0.06);
  border:1px solid var(--glass-border);border-radius:7px;
  color:var(--text);font-size:0.85rem;}
.sa-label{font-size:0.73rem;color:var(--text-muted);margin-bottom:0.22rem;display:block;}

/* ─ Grid ─ */
.sa-g2{display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;}
.sa-g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.7rem;}
.sa-g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0.7rem;}

/* ─ Notificación banner ─ */
.sa-notif{padding:0.65rem 1rem;border-radius:8px;font-size:0.82rem;
  margin-bottom:0.5rem;display:flex;align-items:center;gap:0.6rem;}

/* ─ Slot bar ─ */
.sa-slotbar{height:5px;background:rgba(255,255,255,0.08);
  border-radius:3px;overflow:hidden;margin-top:0.2rem;}
.sa-slotfill{height:100%;border-radius:3px;transition:width 0.3s;}

/* ─ Flag toggle ─ */
.sa-flag{display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.65rem;
  background:var(--glass);border:1px solid var(--glass-border);
  border-radius:6px;cursor:pointer;font-size:0.82rem;transition:all 0.15s;}
.sa-flag.on{border-color:rgba(63,185,80,0.5);background:rgba(63,185,80,0.08);}
.sa-flag.off{opacity:0.5;}

/* ─ Tabla de pagos ─ */
.sa-table{width:100%;border-collapse:collapse;font-size:0.82rem;}
.sa-table th{text-align:left;padding:0.5rem 0.7rem;color:var(--text-muted);
  border-bottom:1px solid var(--glass-border);font-weight:600;}
.sa-table td{padding:0.5rem 0.7rem;border-bottom:1px solid rgba(255,255,255,0.04);}
.sa-table tr:hover td{background:rgba(255,255,255,0.02);}

/* ─ Scrollbar ─ */
.sa-body::-webkit-scrollbar{width:5px;}
.sa-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}
</style>`;

// ── Entrada al panel ─────────────────────────────────────────────────
function openAdminPanel() {
    const role = window._cronosCurrentUser?.role;
    if (['superadmin','admin'].includes(role)) openSuperAdminPanel();
    else if (role === 'club_admin')            openClubAdminPanel();
    else showToast('⛔ Sin permisos de administración', 3000);
}
window.openAdminPanel = openAdminPanel;

// ════════════════════════════════════════════════════════════════════
//  SUPERADMIN PANEL
// ════════════════════════════════════════════════════════════════════
async function openSuperAdminPanel() {
    // Use dedicated superadmin modal (independent of setup-modal)
    let modal = document.getElementById('sa-root-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sa-root-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);'  +
            'display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem;';
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    modal.innerHTML = SA_CSS + `
    <div class="modal-content sa-modal">
      <div class="sa-topbar">
        <div>
          <div style="font-size:1.2rem;font-weight:700;">⚙️ SuperAdmin · Cronos Fútbol</div>
          <div id="sa-subtitle" style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">
            Cargando…</div>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <button onclick="openSuperAdminPanel()"
            style="padding:0.3rem 0.7rem;background:rgba(88,166,255,0.1);
                   border:1px solid rgba(88,166,255,0.3);border-radius:6px;
                   color:var(--primary);font-size:0.78rem;cursor:pointer;">🔄</button>
          <button onclick="document.getElementById('sa-root-modal').style.display='none'"
            style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;
                   cursor:pointer;line-height:1;padding:0 0.3rem;">✕</button>
        </div>
      </div>
      <div class="sa-tabs">
        <button class="sa-tab active" onclick="saTab('overview')">📊 Resumen</button>
        <button class="sa-tab" onclick="saTab('clubs')">🏟️ Clubes</button>
        <button class="sa-tab" onclick="saTab('individual')">👤 Individuales</button>
        <button class="sa-tab" onclick="saTab('payments')">💳 Pagos</button>
        <button class="sa-tab" onclick="saTab('requests')">📋 Solicitudes</button>
        <button class="sa-tab" onclick="saTab('newclub')">➕ Nuevo Club</button>
      </div>
      <div class="sa-body" id="sa-body">
        <p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando…</p>
      </div>
    </div>`;

    window.saTab = (tab) => {
        document.querySelectorAll('.sa-tab').forEach(b => b.classList.remove('active'));
        const idx = ['overview','clubs','individual','payments','requests','newclub'].indexOf(tab);
        document.querySelectorAll('.sa-tab')[idx]?.classList.add('active');
        document.getElementById('sa-body').innerHTML =
            '<p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando…</p>';
        ({overview:saOverview, clubs:saClubs, individual:saIndividual,
          payments:saPayments, requests:saRequests, newclub:saNewClub})[tab]?.();
    };
    saOverview();
}
window.openSuperAdminPanel = openSuperAdminPanel;

// ── Helpers Firestore ────────────────────────────────────────────────
async function saFS() {
    const fa = window._cronos_auth;
    const m  = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { fa, db: fa.db, ...m };
}
async function saGetAll(col) {
    const { db, collection, getDocs } = await saFS();
    const snap = await getDocs(collection(db, col));
    const docs = [];
    snap.forEach(d => docs.push({ _id: d.id, ...d.data() }));
    return docs;
}
async function saWrite(col, id, data, merge=true) {
    const { db, doc, setDoc } = await saFS();
    await setDoc(doc(db, col, id), data, merge ? { merge:true } : {});
}
async function saUpd(col, id, data) {
    const { db, doc, updateDoc } = await saFS();
    await updateDoc(doc(db, col, id), data);
}
async function saGet(col, id) {
    const { db, doc, getDoc } = await saFS();
    const s = await getDoc(doc(db, col, id));
    return s.exists() ? { _id: s.id, ...s.data() } : null;
}

// ── HELPERS DE RENDER ────────────────────────────────────────────────
function saBadge(text, color) {
    return `<span class="sa-badge" style="background:${color}22;color:${color};">${text}</span>`;
}
function saSlotBar(used, max) {
    if (max === -1 || max === undefined)
        return `<span style="font-size:0.7rem;color:#3fb950;">∞</span>`;
    const pct = Math.min(100, Math.round(used / max * 100));
    const col = pct >= 90 ? '#ff5858' : pct >= 70 ? '#ffa500' : '#3fb950';
    return `<span style="font-size:0.73rem;">${used}/${max}</span>
        <div class="sa-slotbar" style="width:60px;display:inline-block;vertical-align:middle;margin-left:4px;">
            <div class="sa-slotfill" style="width:${pct}%;background:${col};"></div></div>`;
}
function saExpireLabel(expiresAt) {
    if (!expiresAt) return '';
    const d    = new Date(expiresAt);
    const days = Math.ceil((d - new Date()) / 86400000);
    const str  = d.toLocaleDateString('es-ES');
    if (days < 0)  return `<span style="color:#ff5858;font-size:0.72rem;">⚠️ Vencido ${str}</span>`;
    if (days <= 7) return `<span style="color:#ffa500;font-size:0.72rem;">⏳ Vence en ${days}d (${str})</span>`;
    return `<span style="color:var(--text-muted);font-size:0.72rem;">⏳ ${str}</span>`;
}

// ════════════════════════════════════════════════════════════════════
//  TAB: RESUMEN
// ════════════════════════════════════════════════════════════════════
async function saOverview() {
    const [clubs, users, reqs] = await Promise.all([
        saGetAll('clubs'), saGetAll('users'), saGetAll('deletion_requests')
    ]);

    const totalClubs   = clubs.length;
    const activeClubs  = clubs.filter(c => c.status !== 'blocked').length;
    const totalUsers   = users.filter(u => !['superadmin','admin'].includes(u.role)).length;
    const indivUsers   = users.filter(u => u.role === 'individual').length;
    const pendReqs     = reqs.filter(r => r.status === 'pending').length;

    // Notifications
    const now = new Date();
    const alerts = [];
    clubs.forEach(c => {
        if (!c.expiresAt) return;
        const d = new Date(c.expiresAt);
        const days = Math.ceil((d - now) / 86400000);
        if (days < 0 && c.status !== 'blocked')
            alerts.push({ type:'danger', msg:`🔴 <strong>${c.name}</strong> — pago vencido hace ${Math.abs(days)} días` });
        else if (days <= 7 && days >= 0)
            alerts.push({ type:'warn', msg:`🟡 <strong>${c.name}</strong> — vence en ${days} día${days!==1?'s':''}` });
    });
    if (pendReqs > 0)
        alerts.push({ type:'info', msg:`📋 ${pendReqs} solicitud${pendReqs>1?'es':''} de baja pendiente${pendReqs>1?'s':''}` });

    // Update subtitle
    const sub = document.getElementById('sa-subtitle');
    if (sub) sub.textContent = `${totalClubs} clubes · ${totalUsers} usuarios · ${pendReqs} pendientes`;

    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <!-- Alertas -->
        ${alerts.length ? alerts.map(a => `
            <div class="sa-notif" style="background:${a.type==='danger'?'rgba(255,88,88,0.1)':a.type==='warn'?'rgba(255,165,0,0.1)':'rgba(88,166,255,0.1)'};
                border:1px solid ${a.type==='danger'?'rgba(255,88,88,0.35)':a.type==='warn'?'rgba(255,165,0,0.35)':'rgba(88,166,255,0.3)'};">
                ${a.msg}
            </div>`).join('') : `
            <div class="sa-notif" style="background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.3);">
                ✅ Todo en orden — sin alertas activas</div>`}

        <!-- Stats -->
        <div class="sa-stats">
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:#58a6ff;">${totalClubs}</div>
                <div class="sa-stat-l">🏟️ Clubes</div>
            </div>
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:#3fb950;">${activeClubs}</div>
                <div class="sa-stat-l">✅ Activos</div>
            </div>
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:#f0883e;">${totalUsers}</div>
                <div class="sa-stat-l">👥 Usuarios</div>
            </div>
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:#79c0ff;">${indivUsers}</div>
                <div class="sa-stat-l">👤 Individuales</div>
            </div>
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:${pendReqs>0?'#ffa500':'var(--text)'};">${pendReqs}</div>
                <div class="sa-stat-l">📋 Pendientes</div>
            </div>
        </div>

        <!-- Acceso rápido -->
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="sa-btn" onclick="saTab('clubs')"
                style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.08);">
                🏟️ Ver Clubes</button>
            <button class="sa-btn" onclick="saTab('payments')"
                style="color:#f0883e;border-color:rgba(240,136,62,0.3);background:rgba(240,136,62,0.08);">
                💳 Pagos</button>
            <button class="sa-btn" onclick="saTab('requests')"
                style="color:${pendReqs>0?'#ffa500':'var(--text-muted)'};
                       border-color:${pendReqs>0?'rgba(255,165,0,0.35)':'var(--glass-border)'};
                       background:${pendReqs>0?'rgba(255,165,0,0.08)':'var(--glass)'};">
                📋 Solicitudes ${pendReqs>0?`<strong>(${pendReqs})</strong>`:''}
            </button>
            <button class="sa-btn" onclick="saTab('newclub')"
                style="color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.08);">
                ➕ Nuevo Club</button>
            <button class="sa-btn"
                onclick="document.getElementById('sa-root-modal').style.display='none';openSetupModal();"
                style="color:var(--secondary);border-color:rgba(240,136,62,0.3);background:rgba(240,136,62,0.08);">
                ⚽ Ir a mi App</button>
        </div>`;
}

// ════════════════════════════════════════════════════════════════════
//  TAB: CLUBES — tarjetas expandibles
// ════════════════════════════════════════════════════════════════════
async function saClubs() {
    const [clubs, users] = await Promise.all([saGetAll('clubs'), saGetAll('users')]);
    clubs.sort((a,b) => (a.name||'').localeCompare(b.name||''));

    const body = document.getElementById('sa-body');
    if (!clubs.length) {
        body.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:3rem;">
            No hay clubes. <button class="sa-btn" onclick="saTab('newclub')"
            style="color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.08);">
            ➕ Crear primero</button></p>`;
        return;
    }

    body.innerHTML = clubs.map(cl => {
        const clubUsers = users.filter(u => u.clubId === cl._id);
        const dirs   = clubUsers.filter(u => u.role === 'director');
        const coords = clubUsers.filter(u => u.role === 'coordinator');
        const trainers = clubUsers.filter(u => u.role === 'user');
        const st     = STATUS_META[cl.status||'active'];
        const pl     = PLAN_META[cl.plan||'free'];
        const maxU   = cl.slots?.users ?? -1;
        const maxD   = cl.slots?.directors ?? -1;
        const maxC   = cl.slots?.coordinators ?? -1;

        const userRows = (list, label) => list.length ? list.map(u =>
            `<div class="sa-urow">
                <div>
                    <span style="font-size:0.83rem;">${u.email||u._id}</span>
                    ${u.displayName?`<span style="color:var(--text-muted);font-size:0.74rem;"> · ${u.displayName}</span>`:''}
                    ${!u.isAuthorized?'<span class="sa-badge" style="margin-left:0.3rem;background:#ff585822;color:#ff5858;">🔒</span>':''}
                </div>
                <div style="display:flex;gap:0.3rem;">
                    <button class="sa-btn" onclick="saDeleteUser('${u._id}','${u.email||u._id}' )"
                        style="font-size:0.7rem;color:#ff5858;
                               border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);">🗑️</button>
                    <button class="sa-btn" onclick="saToggleUser('${u._id}',${!!u.isAuthorized})"
                        style="font-size:0.7rem;color:${u.isAuthorized?'#ff5858':'#3fb950'};
                               border-color:${u.isAuthorized?'rgba(255,88,88,0.3)':'rgba(63,185,80,0.3)'};
                               background:${u.isAuthorized?'rgba(255,88,88,0.07)':'rgba(63,185,80,0.07)'};">
                        ${u.isAuthorized?'🔒':'✅'}</button>
                </div>
            </div>`).join('') : `<p style="color:var(--text-muted);font-size:0.78rem;margin:0.3rem 0;">Sin ${label}</p>`;

        return `
        <div class="sa-card ${cl.status==='blocked'?'blocked':''}" id="card-${cl._id}">
          <div class="sa-card-head" onclick="saToggleCard('${cl._id}')">
            <div class="sa-card-title">
                <span class="sa-chevron">▼</span>
                ${cl.name||'Sin nombre'}
                ${saBadge(pl.label, pl.color)}
                ${saBadge(st.label, st.color)}
                ${saExpireLabel(cl.expiresAt)}
            </div>
            <div class="sa-card-meta">
                <span style="font-size:0.76rem;color:var(--text-muted);">
                    👤 ${cl.adminEmail||'—'}
                </span>
                <span style="font-size:0.76rem;color:var(--text-muted);">
                    👥 ${clubUsers.length} usuarios
                </span>
                <div style="display:flex;gap:0.3rem;">
                    <button class="sa-btn" onclick="event.stopPropagation();saEditClub('${cl._id}')"
                        style="font-size:0.73rem;color:var(--primary);
                               border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">✏️</button>
                    <button class="sa-btn" onclick="event.stopPropagation();saDeleteClub('${cl._id}','${cl.name||cl._id}' )"
                        style="font-size:0.73rem;color:#ff5858;
                               border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);">🗑️</button>
                    <button class="sa-btn" onclick="event.stopPropagation();saBlockClub('${cl._id}',${cl.status!=='blocked'})"
                        style="font-size:0.73rem;color:${cl.status==='blocked'?'#3fb950':'#ff5858'};
                               border-color:${cl.status==='blocked'?'rgba(63,185,80,0.3)':'rgba(255,88,88,0.3)'};
                               background:${cl.status==='blocked'?'rgba(63,185,80,0.07)':'rgba(255,88,88,0.07)'};">
                        ${cl.status==='blocked'?'✅':'🔒'}</button>
                </div>
            </div>
          </div>
          <div class="sa-card-body">
            <!-- Slots -->
            <div class="sa-g3" style="margin:0.7rem 0;">
                <div style="font-size:0.76rem;color:var(--text-muted);">
                    📋 Directores: ${saSlotBar(dirs.length, maxD)}</div>
                <div style="font-size:0.76rem;color:var(--text-muted);">
                    🎯 Coordinadores: ${saSlotBar(coords.length, maxC)}</div>
                <div style="font-size:0.76rem;color:var(--text-muted);">
                    ⚽ Entrenadores: ${saSlotBar(trainers.length, maxU)}</div>
            </div>
            <!-- Usuarios por sección -->
            ${dirs.length || maxD !== 0 ? `
            <div style="margin-bottom:0.7rem;">
                <div style="font-size:0.76rem;font-weight:700;color:#f0883e;margin-bottom:0.3rem;">
                    📋 DIRECTORES DEPORTIVOS (${dirs.length})</div>
                ${userRows(dirs,'directores')}
            </div>` : ''}
            ${`<div style="margin-bottom:0.7rem;">
                <div style="font-size:0.76rem;font-weight:700;color:#d2a8ff;margin-bottom:0.3rem;">
                    🎯 COORDINADORES (${coords.length})</div>
                ${userRows(coords,'coordinadores')}
            </div>`}
            <div style="margin-bottom:0.5rem;">
                <div style="font-size:0.76rem;font-weight:700;color:#3fb950;margin-bottom:0.3rem;">
                    ⚽ ENTRENADORES (${trainers.length})</div>
                ${userRows(trainers,'entrenadores')}
            </div>
            ${cl.notes ? `<div style="font-size:0.75rem;color:var(--text-muted);
                padding:0.4rem 0.6rem;background:rgba(255,255,255,0.03);
                border-radius:6px;margin-top:0.4rem;">📝 ${cl.notes}</div>` : ''}
          </div>
        </div>`;
    }).join('');

    // Bind
    window.saToggleCard = (id) => {
        const c = document.getElementById(`card-${id}`);
        c.classList.toggle('expanded');
    };
    window.saBlockClub = async (id, block) => {
        if (!confirm(block ? '⚠️ Bloquear este club. Todos sus usuarios perderán acceso.' : '¿Activar club?')) return;
        await saUpd('clubs', id, { status: block ? 'blocked' : 'active' });
        showToast(block ? '🔒 Club bloqueado' : '✅ Club activado', 3000);
        saClubs();
    };
    window.saToggleUser = async (uid, currentlyActive) => {
        await saUpd('users', uid, { isAuthorized: !currentlyActive });
        showToast(!currentlyActive ? '✅ Usuario activado' : '🔒 Usuario bloqueado', 2000);
        saClubs();
    };
    window.saEditClub = (id) => saOpenEditor(id);

    window.saDeleteClub = async (id, name) => {
        if (!confirm(`⚠️ ELIMINAR CLUB: "${name}"\n\nEsto eliminará el club permanentemente.\nLos usuarios del club quedarán sin club asignado.\n\n¿Confirmar eliminación?`)) return;
        const second = prompt(`Para confirmar, escribe exactamente el nombre del club:\n"${name}"`);
        if (second !== name) { showToast('❌ Nombre incorrecto. Club NO eliminado.', 4000); return; }
        try {
            const { fa, doc, deleteDoc, collection, getDocs, query, where, updateDoc } = await saFS();
            // Remove club reference from all its users
            const usersSnap = await getDocs(query(collection(fa.db,'users'), where('clubId','==',id)));
            const promises  = [];
            usersSnap.forEach(d => promises.push(updateDoc(doc(fa.db,'users',d.id), { clubId: null, status:'removed' })));
            await Promise.all(promises);
            // Delete club document
            await deleteDoc(doc(fa.db,'clubs',id));
            showToast(`🗑️ Club "${name}" eliminado`, 4000);
            saTab('clubs');
        } catch(e) {
            showToast('⚠️ Error: ' + e.message, 4000);
        }
    };
}

// ── Editor de club ───────────────────────────────────────────────────
async function saOpenEditor(clubId) {
    const cl = await saGet('clubs', clubId);
    if (!cl) return;
    const f  = cl.features || {};
    const FEATURES = [
        { id:'live_view',       icon:'📡', label:'Ver EN VIVO',          desc:'Coordinadores/directores ven partidos' },
        { id:'ai_import',       icon:'🤖', label:'Importar con IA',       desc:'OCR con Gemini para plantillas' },
        { id:'advanced_stats',  icon:'📊', label:'Estadísticas avanzadas',desc:'Próximamente' },
        { id:'custom_branding', icon:'🎨', label:'Marca personalizada',   desc:'Próximamente' },
    ];
    window._editF = { ...f };
    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <div style="max-width:600px;">
          <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1rem;">
            <button onclick="saTab('clubs')" class="sa-btn"
                style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                ← Volver</button>
            <h3 style="margin:0;font-size:1rem;">✏️ ${cl.name||clubId}</h3>
          </div>
          <div class="sa-g2" style="margin-bottom:0.9rem;">
            <div><label class="sa-label">Nombre del club</label>
                <input class="sa-input" id="ec-name" value="${cl.name||''}"></div>
            <div><label class="sa-label">Email admin (único)</label>
                <input class="sa-input" id="ec-admin" type="email" value="${cl.adminEmail||''}"></div>
          </div>
          <div class="sa-g4" style="margin-bottom:0.9rem;">
            <div><label class="sa-label">Slots Directores (-1=∞)</label>
                <input class="sa-input" id="ec-dir" type="number" value="${cl.slots?.directors??-1}"></div>
            <div><label class="sa-label">Slots Coord. (-1=∞)</label>
                <input class="sa-input" id="ec-coord" type="number" value="${cl.slots?.coordinators??-1}"></div>
            <div><label class="sa-label">Slots Entren. (-1=∞)</label>
                <input class="sa-input" id="ec-users" type="number" value="${cl.slots?.users??-1}"></div>
            <div><label class="sa-label">Expira (vacío=sin límite)</label>
                <input class="sa-input" id="ec-exp" type="date" value="${cl.expiresAt?cl.expiresAt.substring(0,10):''}"></div>
          </div>
          <div class="sa-g2" style="margin-bottom:0.9rem;">
            <div><label class="sa-label">Plan</label>
                <select class="sa-input" id="ec-plan">
                    ${Object.entries(PLAN_META).filter(([k])=>!['monthly','annual'].includes(k))
                      .map(([k,v])=>`<option value="${k}" ${cl.plan===k?'selected':''}>${v.label}</option>`).join('')}
                </select></div>
            <div><label class="sa-label">Estado</label>
                <select class="sa-input" id="ec-status">
                    ${Object.entries(STATUS_META).map(([k,v])=>
                      `<option value="${k}" ${(cl.status||'active')===k?'selected':''}>${v.label}</option>`).join('')}
                </select></div>
          </div>
          <div style="margin-bottom:0.9rem;">
            <label class="sa-label" style="margin-bottom:0.4rem;">🔧 Funcionalidades</label>
            <div style="display:flex;flex-direction:column;gap:0.35rem;">
                ${FEATURES.map(ft => `
                <div class="sa-flag ${f[ft.id]?'on':'off'}" id="fl-${ft.id}" onclick="saFlip('${ft.id}')">
                    <span>${f[ft.id]?'✅':'⬜'}</span>
                    <strong>${ft.icon} ${ft.label}</strong>
                    <span style="color:var(--text-muted);font-size:0.74rem;">— ${ft.desc}</span>
                </div>`).join('')}
            </div>
          </div>
          <div style="margin-bottom:0.9rem;"><label class="sa-label">Precio/mes (€)</label>
            <input class="sa-input" id="ec-price" type="number" placeholder="0" value="${cl.price||''}"></div>
          <div style="margin-bottom:0.9rem;"><label class="sa-label">Notas internas</label>
            <textarea class="sa-input" id="ec-notes" rows="2" style="resize:vertical;">${cl.notes||''}</textarea>
          </div>
          <div style="display:flex;gap:0.6rem;">
            <button onclick="saTab('clubs')" class="sa-btn"
                style="color:var(--text-muted);border-color:var(--glass-border);background:var(--glass);">
                Cancelar</button>
            <button onclick="saSaveClub('${clubId}')" class="sa-btn"
                style="flex:1;padding:0.55rem;color:#3fb950;border-color:rgba(63,185,80,0.4);
                       background:rgba(63,185,80,0.1);font-weight:700;font-size:0.88rem;">
                💾 Guardar cambios</button>
          </div>
          <div id="ec-msg" style="font-size:0.8rem;margin-top:0.5rem;text-align:center;min-height:1rem;"></div>
        </div>`;

    window.saFlip = (fid) => {
        window._editF[fid] = !window._editF[fid];
        const el = document.getElementById(`fl-${fid}`);
        const on = window._editF[fid];
        el.classList.toggle('on', on); el.classList.toggle('off', !on);
        el.querySelector('span').textContent = on ? '✅' : '⬜';
    };
    window.saSaveClub = async (id) => {
        const msg = document.getElementById('ec-msg');
        msg.style.color = 'var(--primary)'; msg.textContent = 'Guardando…';
        try {
            await saWrite('clubs', id, {
                name:        document.getElementById('ec-name').value.trim(),
                adminEmail:  document.getElementById('ec-admin').value.trim(),
                slots: {
                    directors:    +document.getElementById('ec-dir').value   || -1,
                    coordinators: +document.getElementById('ec-coord').value || -1,
                    users:        +document.getElementById('ec-users').value || -1,
                },
                plan:      document.getElementById('ec-plan').value,
                status:    document.getElementById('ec-status').value,
                expiresAt: document.getElementById('ec-exp').value || null,
                price:     parseFloat(document.getElementById('ec-price').value) || null,
                notes:     document.getElementById('ec-notes').value.trim(),
                features:  window._editF,
            });
            msg.style.color = '#3fb950'; msg.textContent = '✅ Guardado';
            setTimeout(() => saTab('clubs'), 1000);
        } catch(e) {
            msg.style.color = '#ff5858'; msg.textContent = '⚠️ ' + e.message;
        }
    };
}

// ════════════════════════════════════════════════════════════════════
//  TAB: USUARIOS INDIVIDUALES
// ════════════════════════════════════════════════════════════════════
async function saIndividual() {
    const users = (await saGetAll('users')).filter(u => u.role === 'individual' || u.isIndividual);
    const body  = document.getElementById('sa-body');

    const planInfo = `
    <div class="sa-card" style="margin-bottom:1rem;border-color:rgba(121,192,255,0.3);background:rgba(121,192,255,0.04);">
        <div style="font-weight:700;margin-bottom:0.5rem;">👤 Plan Individual — Usuarios sin club</div>
        <div style="font-size:0.81rem;color:var(--text-muted);line-height:1.6;">
            Usuarios que compran o alquilan la app de forma independiente.<br>
            Tienen acceso a las funciones básicas (crear equipos, gestionar plantillas, partidos).<br>
            Sin acceso a EN VIVO ni coordinadores. Precio: <strong style="color:var(--text);">libre (tú defines)</strong>
        </div>
        <div style="margin-top:0.7rem;display:flex;gap:0.5rem;">
            <button class="sa-btn" onclick="saAddIndividual()"
                style="color:#79c0ff;border-color:rgba(121,192,255,0.35);background:rgba(121,192,255,0.08);">
                ➕ Añadir usuario individual</button>
        </div>
    </div>`;

    if (!users.length) {
        body.innerHTML = planInfo + `
            <p style="color:var(--text-muted);text-align:center;padding:2rem;">
                Sin usuarios individuales aún.</p>`;
        return;
    }

    body.innerHTML = planInfo + users.map(u => {
        const pl = PLAN_META[u.plan||'monthly'];
        const st = STATUS_META[u.status||'active'];
        return `
        <div class="sa-card" id="icard-${u._id}">
          <div class="sa-card-head" onclick="saToggleICard('${u._id}')">
            <div class="sa-card-title">
                <span class="sa-chevron">▼</span>
                ${u.email||u._id}
                ${u.displayName?`<span style="font-weight:400;color:var(--text-muted);font-size:0.83rem;"> · ${u.displayName}</span>`:''}
                ${saBadge(pl.label, pl.color)}
                ${saBadge(st.label, st.color)}
            </div>
            <div class="sa-card-meta">
                ${saExpireLabel(u.expiresAt)}
                <button class="sa-btn" onclick="event.stopPropagation();saEditIndividual('${u._id}')"
                    style="font-size:0.73rem;color:var(--primary);
                           border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">✏️</button>
                <button class="sa-btn" onclick="event.stopPropagation();saToggleUser('${u._id}',${!!u.isAuthorized})"
                    style="font-size:0.73rem;color:${u.isAuthorized?'#ff5858':'#3fb950'};
                           border-color:${u.isAuthorized?'rgba(255,88,88,0.3)':'rgba(63,185,80,0.3)'};
                           background:${u.isAuthorized?'rgba(255,88,88,0.07)':'rgba(63,185,80,0.07)'};">
                    ${u.isAuthorized?'🔒':'✅'}</button>
            </div>
          </div>
          <div class="sa-card-body">
            <div class="sa-g2" style="margin-top:0.6rem;font-size:0.8rem;color:var(--text-muted);">
                <div>📅 Registrado: ${u.createdAt?new Date(u.createdAt).toLocaleDateString('es-ES'):'—'}</div>
                <div>⏳ Expira: ${u.expiresAt?new Date(u.expiresAt).toLocaleDateString('es-ES'):'—'}</div>
                <div>💳 Plan: ${pl.label}</div>
                <div>💰 Precio: ${u.price?u.price+'€':u.price===0?'Gratis':'—'}</div>
            </div>
            ${u.notes?`<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem;
                padding:0.4rem 0.6rem;background:rgba(255,255,255,0.03);border-radius:6px;">
                📝 ${u.notes}</div>`:''}
          </div>
        </div>`;
    }).join('');

    window.saToggleICard = (id) => {
        document.getElementById(`icard-${id}`)?.classList.toggle('expanded');
    };
    window.saDeleteUser = async (uid, email) => {
        if (!confirm('⚠️ ELIMINAR usuario ' + email + '\n\nEsta acción es permanente. ¿Confirmar?')) return;
        try {
            const { fa, doc, deleteDoc, getDoc, updateDoc } = await saFS();
            const snap = await getDoc(doc(fa.db,'users',uid));
            if (snap.exists()) {
                const ud = snap.data();
                if (ud.clubId) {
                    const k = ud.role==='director'?'directors':ud.role==='coordinator'?'coordinators':'users';
                    const cs = await getDoc(doc(fa.db,'clubs',ud.clubId)).catch(()=>null);
                    if (cs?.exists()) {
                        const cur = cs.data().usedSlots?.[k] || 0;
                        await updateDoc(doc(fa.db,'clubs',ud.clubId), { ['usedSlots.'+k]: Math.max(0,cur-1) });
                    }
                }
            }
            await deleteDoc(doc(fa.db,'users',uid));
            showToast('🗑️ Usuario eliminado', 3000);
            saLoadUsers();
        } catch(e) { showToast('⚠️ Error: '+e.message, 4000); }
    };
    window.saToggleUser = async (uid, cur) => {
        await saUpd('users', uid, { isAuthorized: !cur });
        showToast(!cur ? '✅ Activado' : '🔒 Bloqueado', 2000);
        saIndividual();
    };
    window.saEditIndividual = (uid) => saOpenIndividualEditor(uid);
    window.saAddIndividual  = ()    => saOpenIndividualEditor(null);
}

async function saOpenIndividualEditor(uid) {
    const u    = uid ? await saGet('users', uid) : {};
    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <div style="max-width:520px;">
          <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1rem;">
            <button onclick="saTab('individual')" class="sa-btn"
                style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                ← Volver</button>
            <h3 style="margin:0;font-size:1rem;">${uid ? '✏️ Editar usuario individual' : '➕ Nuevo usuario individual'}</h3>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.7rem;">
            <div><label class="sa-label">Email *</label>
                <input class="sa-input" id="iu-email" type="email" value="${u.email||''}"></div>
            <div><label class="sa-label">Nombre</label>
                <input class="sa-input" id="iu-name" value="${u.displayName||''}"></div>
            <div class="sa-g2">
                <div><label class="sa-label">Plan</label>
                    <select class="sa-input" id="iu-plan">
                        <option value="monthly" ${u.plan==='monthly'?'selected':''}>📅 Mensual</option>
                        <option value="annual"  ${u.plan==='annual'?'selected':''}>📆 Anual</option>
                        <option value="free"    ${u.plan==='free'?'selected':''}>🆓 Gratis</option>
                        <option value="custom"  ${u.plan==='custom'?'selected':''}>⚙️ Custom</option>
                    </select></div>
                <div><label class="sa-label">Precio (€)</label>
                    <input class="sa-input" id="iu-price" type="number" value="${u.price??''}"></div>
            </div>
            <div><label class="sa-label">Fecha de expiración</label>
                <input class="sa-input" id="iu-exp" type="date" value="${u.expiresAt?u.expiresAt.substring(0,10):''}"></div>
            <div><label class="sa-label">Estado</label>
                <select class="sa-input" id="iu-status">
                    ${Object.entries(STATUS_META).map(([k,v])=>
                      `<option value="${k}" ${(u.status||'active')===k?'selected':''}>${v.label}</option>`).join('')}
                </select></div>
            <div><label class="sa-label">Notas</label>
                <textarea class="sa-input" id="iu-notes" rows="2" style="resize:vertical;">${u.notes||''}</textarea></div>
            <button onclick="saSaveIndividual('${uid||''}')" class="sa-btn"
                style="padding:0.6rem;color:#79c0ff;border-color:rgba(121,192,255,0.4);
                       background:rgba(121,192,255,0.1);font-weight:700;font-size:0.88rem;">
                💾 Guardar</button>
            <div id="iu-msg" style="font-size:0.8rem;text-align:center;min-height:1rem;"></div>
          </div>
        </div>`;

    window.saSaveIndividual = async (existingUid) => {
        const msg   = document.getElementById('iu-msg');
        const email = document.getElementById('iu-email').value.trim();
        if (!email) { msg.style.color='#ff5858'; msg.textContent='⚠️ Email obligatorio'; return; }
        msg.style.color='var(--primary)'; msg.textContent='Guardando…';
        const id = existingUid || ('ind_'+Date.now().toString(36));
        await saWrite('users', id, {
            email, displayName: document.getElementById('iu-name').value.trim(),
            role:        'individual',
            isIndividual: true,
            isAuthorized: true,
            plan:        document.getElementById('iu-plan').value,
            price:       parseFloat(document.getElementById('iu-price').value)||0,
            expiresAt:   document.getElementById('iu-exp').value||null,
            status:      document.getElementById('iu-status').value,
            notes:       document.getElementById('iu-notes').value.trim(),
            createdAt:   u.createdAt || new Date().toISOString(),
        });
        msg.style.color='#3fb950'; msg.textContent='✅ Guardado';
        setTimeout(() => saTab('individual'), 1000);
    };
}

// ════════════════════════════════════════════════════════════════════
//  TAB: PAGOS — Registro manual (Bizum / Transferencia / Efectivo)
// ════════════════════════════════════════════════════════════════════
async function saPayments() {
    const [clubs, individuals] = await Promise.all([
        saGetAll('clubs'),
        saGetAll('users').then(u => u.filter(x => x.isIndividual || x.role === 'individual'))
    ]);
    clubs.sort((a,b) => (a.name||'').localeCompare(b.name||''));
    const body = document.getElementById('sa-body');
    const now  = new Date();

    // ── Alertas de vencimiento ──
    const alerts = [];
    [...clubs, ...individuals].forEach(x => {
        if (!x.expiresAt) return;
        const d    = new Date(x.expiresAt);
        const days = Math.ceil((d - now) / 86400000);
        const name = x.name || x.email || x._id;
        if (days < 0)
            alerts.push(`🔴 <strong>${name}</strong> — vencido hace ${Math.abs(days)} día${Math.abs(days)!==1?'s':''}`);
        else if (days <= 7)
            alerts.push(`🟡 <strong>${name}</strong> — vence en ${days} día${days!==1?'s':''}`);
    });

    body.innerHTML = `
        ${alerts.length ? `
        <div style="background:rgba(255,165,0,0.08);border:1px solid rgba(255,165,0,0.35);
                    border-radius:8px;padding:0.7rem 1rem;margin-bottom:1rem;font-size:0.82rem;line-height:1.8;">
            ⚠️ <strong>Avisos de vencimiento:</strong><br>${alerts.join('<br>')}
        </div>` : `
        <div style="background:rgba(63,185,80,0.07);border:1px solid rgba(63,185,80,0.3);
                    border-radius:8px;padding:0.6rem 1rem;margin-bottom:1rem;font-size:0.82rem;">
            ✅ Todos los pagos al día
        </div>`}

        <!-- CLUBES -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <h3 style="font-size:0.9rem;margin:0;">🏟️ Clubes</h3>
            <span style="font-size:0.75rem;color:var(--text-muted);">${clubs.length} club${clubs.length!==1?'s':''}</span>
        </div>
        ${clubs.map(cl => saPaymentCard(cl, 'club')).join('')}

        ${individuals.length ? `
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin:1.2rem 0 0.5rem;">
            <h3 style="font-size:0.9rem;margin:0;">👤 Usuarios individuales</h3>
            <span style="font-size:0.75rem;color:var(--text-muted);">${individuals.length}</span>
        </div>
        ${individuals.map(u => saPaymentCard(u, 'individual')).join('')}
        ` : ''}
    `;

    // Bind actions
    window.saRegisterPayment = (id, type) => saOpenPaymentForm(id, type);
    window.saViewHistory     = (id, type) => saOpenPaymentHistory(id, type);
}

function saPaymentCard(item, type) {
    const pl      = PLAN_META[item.plan||'free'];
    const now     = new Date();
    const expired = item.expiresAt && new Date(item.expiresAt) < now;
    const days    = item.expiresAt
        ? Math.ceil((new Date(item.expiresAt) - now) / 86400000) : null;
    const name    = item.name || item.email || item._id;

    // Last payment info
    const lastPay = item.lastPayment;
    const lastPayStr = lastPay
        ? `${lastPay.method === 'bizum' ? '📱 Bizum' : lastPay.method === 'transfer' ? '🏦 Transferencia' : '💵 Efectivo'} · ${new Date(lastPay.date).toLocaleDateString('es-ES')} · ${lastPay.amount||'—'}€`
        : 'Sin pagos registrados';

    const statusColor = expired ? '#ff5858' : days !== null && days <= 7 ? '#ffa500' : '#3fb950';
    const statusText  = expired
        ? `⚠️ Vencido hace ${Math.abs(days)}d`
        : days === null ? '∞ Sin límite'
        : days <= 7 ? `⏳ Vence en ${days}d`
        : `✅ Válido hasta ${new Date(item.expiresAt).toLocaleDateString('es-ES')}`;

    return `
    <div class="sa-card" style="border-color:${expired?'rgba(255,88,88,0.4)':days!==null&&days<=7?'rgba(255,165,0,0.4)':'var(--glass-border)'};
                                margin-bottom:0.6rem;">
        <div class="sa-row">
            <div>
                <span style="font-weight:700;">${name}</span>
                ${saBadge(pl.label, pl.color)}
                <span style="font-size:0.75rem;color:${statusColor};margin-left:0.4rem;">${statusText}</span>
            </div>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <button class="sa-btn" onclick="saSendPaymentEmail('${item._id}','${type}')"
                    style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);font-weight:700;">
                    📧 Enviar aviso</button>
                <button class="sa-btn" onclick="saRegisterPayment('${item._id}','${type}')"
                    style="color:#3fb950;border-color:rgba(63,185,80,0.4);background:rgba(63,185,80,0.08);font-weight:700;">
                    💳 Registrar pago</button>
                <button class="sa-btn" onclick="saViewHistory('${item._id}','${type}')"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                    📋 Historial</button>
            </div>
        </div>
        <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.4rem;display:flex;gap:1.5rem;flex-wrap:wrap;">
            <span>💰 Precio: <strong style="color:var(--text);">${item.price?item.price+'€/mes':'—'}</strong></span>
            <span>🕐 Último pago: <strong style="color:var(--text);">${lastPayStr}</strong></span>
            ${type==='club'?`<span>👤 Admin: <strong style="color:var(--text);">${item.adminEmail||'—'}</strong></span>`:''}
        </div>
    </div>`;
}

// ── Formulario registrar pago ─────────────────────────────────────────
async function saOpenPaymentForm(id, type) {
    const item = await saGet(type === 'club' ? 'clubs' : 'users', id);
    if (!item) return;
    const name = item.name || item.email || id;
    const body = document.getElementById('sa-body');

    // Calculate suggested next expiry (1 month from today or from current expiry)
    const base = item.expiresAt && new Date(item.expiresAt) > new Date()
        ? new Date(item.expiresAt)
        : new Date();
    const suggested = new Date(base);
    suggested.setMonth(suggested.getMonth() + 1);
    const suggestedStr = suggested.toISOString().substring(0, 10);

    body.innerHTML = `
        <div style="max-width:480px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.2rem;">
                <button onclick="saTab('payments')" class="sa-btn"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                    ← Volver</button>
                <h3 style="margin:0;font-size:1rem;">💳 Registrar pago — ${name}</h3>
            </div>

            <!-- Resumen actual -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:8px;padding:0.8rem 1rem;margin-bottom:1.2rem;font-size:0.82rem;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;color:var(--text-muted);">
                    <div>Plan actual: <strong style="color:var(--text);">${PLAN_META[item.plan||'free']?.label||'—'}</strong></div>
                    <div>Precio/mes: <strong style="color:var(--text);">${item.price?item.price+'€':'—'}</strong></div>
                    <div>Vencimiento actual: <strong style="color:var(--text);">${item.expiresAt?new Date(item.expiresAt).toLocaleDateString('es-ES'):'Sin límite'}</strong></div>
                    <div>Estado: <strong style="color:var(--text);">${STATUS_META[item.status||'active']?.label||'—'}</strong></div>
                </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.8rem;">

                <!-- Método de pago -->
                <div>
                    <label class="sa-label">Método de pago *</label>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;" id="pay-method-btns">
                        <div class="pay-method-btn active" id="pm-bizum" onclick="selectPayMethod('bizum')"
                            style="padding:0.7rem;background:rgba(63,185,80,0.15);border:2px solid rgba(63,185,80,0.5);
                                   border-radius:8px;cursor:pointer;text-align:center;transition:all 0.15s;">
                            <div style="font-size:1.3rem;">📱</div>
                            <div style="font-size:0.8rem;font-weight:700;color:#3fb950;margin-top:0.2rem;">Bizum</div>
                        </div>
                        <div class="pay-method-btn" id="pm-transfer" onclick="selectPayMethod('transfer')"
                            style="padding:0.7rem;background:var(--glass);border:2px solid var(--glass-border);
                                   border-radius:8px;cursor:pointer;text-align:center;transition:all 0.15s;">
                            <div style="font-size:1.3rem;">🏦</div>
                            <div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);margin-top:0.2rem;">Transferencia</div>
                        </div>
                        <div class="pay-method-btn" id="pm-cash" onclick="selectPayMethod('cash')"
                            style="padding:0.7rem;background:var(--glass);border:2px solid var(--glass-border);
                                   border-radius:8px;cursor:pointer;text-align:center;transition:all 0.15s;">
                            <div style="font-size:1.3rem;">💵</div>
                            <div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);margin-top:0.2rem;">Efectivo</div>
                        </div>
                    </div>
                    <input type="hidden" id="pay-method" value="bizum">
                </div>

                <!-- Importe y fecha -->
                <div class="sa-g2">
                    <div>
                        <label class="sa-label">Importe recibido (€) *</label>
                        <input class="sa-input" id="pay-amount" type="number"
                            placeholder="${item.price||''}" value="${item.price||''}">
                    </div>
                    <div>
                        <label class="sa-label">Fecha del pago *</label>
                        <input class="sa-input" id="pay-date" type="date"
                            value="${new Date().toISOString().substring(0,10)}">
                    </div>
                </div>

                <!-- Nuevo vencimiento -->
                <div>
                    <label class="sa-label">Nuevo vencimiento (se calcula automáticamente +1 mes)</label>
                    <input class="sa-input" id="pay-expires" type="date" value="${suggestedStr}">
                </div>

                <!-- Nuevo plan (opcional) -->
                <div>
                    <label class="sa-label">Plan (opcional — cambiar si procede)</label>
                    <select class="sa-input" id="pay-plan">
                        ${Object.entries(PLAN_META)
                            .filter(([k]) => !['monthly','annual'].includes(k))
                            .map(([k,v]) => `<option value="${k}" ${(item.plan||'free')===k?'selected':''}>${v.label}</option>`)
                            .join('')}
                    </select>
                </div>

                <!-- Notas -->
                <div>
                    <label class="sa-label">Notas (referencia Bizum, nº transferencia, etc.)</label>
                    <input class="sa-input" id="pay-notes" placeholder="ej: Bizum ref. 12345 / Transf. ES12...">
                </div>

                <button onclick="saDoRegisterPayment('${id}','${type}')" class="sa-btn"
                    style="padding:0.65rem;color:#3fb950;border-color:rgba(63,185,80,0.4);
                           background:rgba(63,185,80,0.1);font-weight:700;font-size:0.9rem;">
                    ✅ Confirmar pago recibido</button>

                <div id="pay-msg" style="font-size:0.82rem;text-align:center;min-height:1rem;"></div>
            </div>
        </div>`;

    window._payMethod = 'bizum';
    window.selectPayMethod = (method) => {
        window._payMethod = method;
        document.getElementById('pay-method').value = method;
        ['bizum','transfer','cash'].forEach(m => {
            const el = document.getElementById(`pm-${m}`);
            if (!el) return;
            const active = m === method;
            const colors = { bizum:'#3fb950', transfer:'#58a6ff', cash:'#f0883e' };
            const col = colors[m];
            el.style.background    = active ? `rgba(${m==='bizum'?'63,185,80':m==='transfer'?'88,166,255':'240,136,62'},0.15)` : 'var(--glass)';
            el.style.borderColor   = active ? col : 'var(--glass-border)';
            el.querySelector('div:last-child').style.color = active ? col : 'var(--text-muted)';
        });
    };

    window.saDoRegisterPayment = async (id, type) => {
        const msg    = document.getElementById('pay-msg');
        const amount = parseFloat(document.getElementById('pay-amount').value);
        const date   = document.getElementById('pay-date').value;
        const exp    = document.getElementById('pay-expires').value;
        const plan   = document.getElementById('pay-plan').value;
        const notes  = document.getElementById('pay-notes').value.trim();
        const method = window._payMethod || 'bizum';

        if (!amount || !date) {
            msg.style.color = '#ff5858'; msg.textContent = '⚠️ Importe y fecha son obligatorios.'; return;
        }
        msg.style.color = 'var(--primary)'; msg.textContent = 'Guardando…';

        const col     = type === 'club' ? 'clubs' : 'users';
        const payEntry = { method, amount, date, notes, registeredAt: new Date().toISOString() };

        // Get existing history
        const current = await saGet(col, id);
        const history = current?.paymentHistory || [];
        history.unshift(payEntry); // newest first

        await saWrite(col, id, {
            plan,
            status:         'active',
            expiresAt:      exp || null,
            price:          amount,
            lastPayment:    payEntry,
            paymentHistory: history.slice(0, 24), // keep last 24 entries
        });

        msg.style.color = '#3fb950';
        msg.textContent = `✅ Pago de ${amount}€ registrado correctamente.`;
        showToast(`✅ Pago registrado — ${name}`, 3000);
        setTimeout(() => saTab('payments'), 1500);
    };
}

// ── Historial de pagos ────────────────────────────────────────────────
async function saOpenPaymentHistory(id, type) {
    const item = await saGet(type === 'club' ? 'clubs' : 'users', id);
    if (!item) return;
    const name    = item.name || item.email || id;
    const history = item.paymentHistory || [];
    const body    = document.getElementById('sa-body');

    const METHOD_LABELS = {
        bizum:    '📱 Bizum',
        transfer: '🏦 Transferencia',
        cash:     '💵 Efectivo',
    };

    // Total cobrado
    const total = history.reduce((s, p) => s + (parseFloat(p.amount)||0), 0);

    body.innerHTML = `
        <div style="max-width:600px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.2rem;">
                <button onclick="saTab('payments')" class="sa-btn"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                    ← Volver</button>
                <h3 style="margin:0;font-size:1rem;">📋 Historial de pagos — ${name}</h3>
            </div>

            <!-- Resumen -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;margin-bottom:1.2rem;">
                <div class="sa-stat">
                    <div class="sa-stat-n" style="color:#3fb950;">${history.length}</div>
                    <div class="sa-stat-l">Pagos registrados</div>
                </div>
                <div class="sa-stat">
                    <div class="sa-stat-n" style="color:#58a6ff;">${total.toFixed(0)}€</div>
                    <div class="sa-stat-l">Total cobrado</div>
                </div>
                <div class="sa-stat">
                    <div class="sa-stat-n" style="color:#f0883e;">${item.price||'—'}€</div>
                    <div class="sa-stat-l">Precio/mes actual</div>
                </div>
            </div>

            ${history.length === 0 ? `
                <p style="color:var(--text-muted);text-align:center;padding:2rem;">
                    Sin pagos registrados aún.</p>` :
                history.map((p, i) => `
                <div class="sa-card" style="padding:0.7rem 1rem;margin-bottom:0.4rem;">
                    <div class="sa-row">
                        <div>
                            <span style="font-weight:700;font-size:0.92rem;">${METHOD_LABELS[p.method]||p.method}</span>
                            <span style="margin-left:0.6rem;font-size:0.88rem;color:#3fb950;font-weight:700;">
                                ${p.amount}€</span>
                            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;">
                                📅 ${new Date(p.date).toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'})}
                                ${p.notes?` · 📝 ${p.notes}`:''}
                            </div>
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">
                            #${history.length - i}
                        </div>
                    </div>
                </div>`).join('')
            }
        </div>`;
}

// ════════════════════════════════════════════════════════════════════
//  TAB: SOLICITUDES DE BAJA
// ════════════════════════════════════════════════════════════════════
async function saRequests() {
    const { db, collection, getDocs, query, where, doc, updateDoc, getDoc } = await saFS();
    const snap = await getDocs(query(collection(db,'deletion_requests'), where('status','==','pending')));
    const reqs = [];
    snap.forEach(d => reqs.push({ _id: d.id, ...d.data() }));

    const body = document.getElementById('sa-body');
    if (!reqs.length) {
        body.innerHTML = `<div class="sa-notif"
            style="background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.3);">
            ✅ No hay solicitudes pendientes</div>`;
        return;
    }

    body.innerHTML = `<div style="margin-bottom:0.6rem;color:#ffa500;font-size:0.83rem;font-weight:600;">
        ⚠️ ${reqs.length} solicitud${reqs.length>1?'es':''} pendiente${reqs.length>1?'s':''}
    </div>` + reqs.map(r => `
        <div class="sa-card" style="border-color:rgba(255,165,0,0.4);">
            <div style="font-weight:700;margin-bottom:0.4rem;">📋 Solicitud de baja</div>
            <div style="font-size:0.82rem;color:var(--text-muted);line-height:1.8;">
                Usuario: <strong style="color:var(--text);">${r.userEmail||r.userId}</strong><br>
                Solicitado por: ${r.requestedByEmail||r.requestedBy}<br>
                Motivo: ${r.reason||'—'}<br>
                Fecha: ${r.createdAt?new Date(r.createdAt).toLocaleDateString('es-ES'):'—'}
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.7rem;">
                <button class="sa-btn" onclick="saResolve('${r._id}','${r.userId}','${r.clubId||''}',true)"
                    style="color:#3fb950;border-color:rgba(63,185,80,0.4);background:rgba(63,185,80,0.08);font-weight:700;">
                    ✅ Aprobar baja</button>
                <button class="sa-btn" onclick="saResolve('${r._id}','${r.userId}','${r.clubId||''}',false)"
                    style="color:#ff5858;border-color:rgba(255,88,88,0.4);background:rgba(255,88,88,0.08);font-weight:700;">
                    ❌ Rechazar</button>
            </div>
        </div>`).join('');

    window.saResolve = async (reqId, userId, clubId, approve) => {
        await updateDoc(doc(db,'deletion_requests',reqId), {
            status: approve?'approved':'rejected', resolvedAt: new Date().toISOString()
        });
        if (approve) {
            await updateDoc(doc(db,'users',userId), {
                isAuthorized:false, status:'removed', removedAt:new Date().toISOString()
            });
            if (clubId) {
                const cs = await getDoc(doc(db,'clubs',clubId));
                if (cs.exists()) {
                    const ud = cs.data().usedSlots||{};
                    const ur = (await getDoc(doc(db,'users',userId))).data()?.role||'user';
                    const k  = ur==='director'?'directors':ur==='coordinator'?'coordinators':'users';
                    await updateDoc(doc(db,'clubs',clubId), { [`usedSlots.${k}`]: Math.max(0,(ud[k]||1)-1) });
                }
            }
        }
        showToast(approve?'✅ Baja aprobada':'❌ Rechazada', 3000);
        saRequests();
    };
}

// ════════════════════════════════════════════════════════════════════
//  TAB: NUEVO CLUB
// ════════════════════════════════════════════════════════════════════
function saNewClub() {
    document.getElementById('sa-body').innerHTML = `
        <div style="max-width:540px;">
          <h3 style="margin:0 0 1rem;font-size:1rem;">➕ Crear nuevo club</h3>
          <div style="display:flex;flex-direction:column;gap:0.7rem;">
            <div><label class="sa-label">Nombre del club *</label>
                <input class="sa-input" id="nc-name" placeholder="ej: CD Deportivo Ejemplo"></div>
            <div><label class="sa-label">Email del administrador (1 único, contacto directo) *</label>
                <input class="sa-input" id="nc-admin" type="email" placeholder="admin@club.com"></div>
            <div class="sa-g3">
                <div><label class="sa-label">Slots Directores (-1=∞)</label>
                    <input class="sa-input" id="nc-dir" type="number" value="-1"></div>
                <div><label class="sa-label">Slots Coordinadores (-1=∞)</label>
                    <input class="sa-input" id="nc-coord" type="number" value="-1"></div>
                <div><label class="sa-label">Slots Entrenadores (-1=∞)</label>
                    <input class="sa-input" id="nc-users" type="number" value="-1"></div>
            </div>
            <div class="sa-g3">
                <div><label class="sa-label">Plan inicial</label>
                    <select class="sa-input" id="nc-plan">
                        ${Object.entries(PLAN_META).filter(([k])=>!['monthly','annual'].includes(k))
                          .map(([k,v])=>`<option value="${k}" ${k==='trial'?'selected':''}>${v.label}</option>`).join('')}
                    </select></div>
                <div><label class="sa-label">Precio €/mes</label>
                    <input class="sa-input" id="nc-price" type="number" placeholder="0"></div>
                <div><label class="sa-label">Expira (vacío=sin límite)</label>
                    <input class="sa-input" id="nc-exp" type="date"></div>
            </div>
            <div><label class="sa-label">Notas internas</label>
                <textarea class="sa-input" id="nc-notes" rows="2" style="resize:vertical;"
                    placeholder="Plan acordado, observaciones…"></textarea></div>
            <div style="background:rgba(88,166,255,0.05);border:1px solid rgba(88,166,255,0.2);
                        border-radius:8px;padding:0.7rem 1rem;font-size:0.79rem;color:var(--text-muted);">
                💡 Al crear el club, el admin deberá registrarse en la app con ese email.
                Tendrá rol <strong>club_admin</strong> y podrá dar de alta a sus usuarios.
            </div>
            <button onclick="saDoCreateClub()" class="sa-btn"
                style="padding:0.65rem;color:#3fb950;border-color:rgba(63,185,80,0.4);
                       background:rgba(63,185,80,0.1);font-weight:700;font-size:0.9rem;">
                ➕ Crear Club</button>
            <div id="nc-msg" style="font-size:0.82rem;text-align:center;min-height:1rem;"></div>
          </div>
        </div>`;

    window.saDoCreateClub = async () => {
        const msg  = document.getElementById('nc-msg');
        const name = document.getElementById('nc-name').value.trim();
        const adm  = document.getElementById('nc-admin').value.trim();
        if (!name||!adm) { msg.style.color='#ff5858'; msg.textContent='⚠️ Nombre y email obligatorios.'; return; }
        msg.style.color='var(--primary)'; msg.textContent='Creando…';
        const id = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
            .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').substring(0,28)
            + '-' + Date.now().toString(36).slice(-4);
        await saWrite('clubs', id, {
            name, adminEmail: adm, status:'active',
            plan:   document.getElementById('nc-plan').value,
            price:  parseFloat(document.getElementById('nc-price').value)||null,
            slots: {
                directors:    +document.getElementById('nc-dir').value   || -1,
                coordinators: +document.getElementById('nc-coord').value || -1,
                users:        +document.getElementById('nc-users').value || -1,
            },
            usedSlots: { directors:0, coordinators:0, users:0 },
            expiresAt: document.getElementById('nc-exp').value||null,
            notes:     document.getElementById('nc-notes').value.trim(),
            features:  { live_view:true, ai_import:true },
            createdAt: new Date().toISOString(),
        }, false);
        msg.style.color='#3fb950'; msg.textContent=`✅ Club "${name}" creado (ID: ${id})`;
        showToast(`✅ Club "${name}" creado`, 4000);
        ['nc-name','nc-admin','nc-exp','nc-notes'].forEach(i => {
            const el=document.getElementById(i); if(el) el.value='';
        });
    };
}

// Código de Gestión de Club movido a js/17_club_admin.js

// ── Verificar acceso al club al iniciar sesión ───────────────────────
async function checkClubAccess(userData) {
    if (!userData?.clubId) return true;
    try {
        const cl = await saGet('clubs', userData.clubId);
        if (!cl) return true;
        if (cl.status === 'blocked') {
            const { signOut } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
            await signOut(window._cronos_auth?.auth);
            showToast('🔒 Club suspendido. Contacta con el administrador.', 8000);
            return false;
        }
        if (cl.expiresAt && new Date(cl.expiresAt) < new Date() && cl.status !== 'blocked') {
            showToast('⚠️ El plan de tu club ha vencido. Contacta con el administrador.', 6000);
        }
    } catch(e) { /* no bloquear */ }
    return true;
}
window.checkClubAccess = checkClubAccess;

// ════════════════════════════════════════════════════════════════════
//  ENVÍO DE AVISO DE PAGO — Email + WhatsApp
// ════════════════════════════════════════════════════════════════════

async function saSendPaymentEmail(id, type) {
    const item = await saGet(type === 'club' ? 'clubs' : 'users', id);
    if (!item) return;

    const name      = item.name || item.email || id;
    const adminEmail= item.adminEmail || item.email || '';
    const plan      = PLAN_META[item.plan || 'free'];
    const price     = item.price ? item.price + '€/mes' : 'a convenir';
    const expires   = item.expiresAt
        ? new Date(item.expiresAt).toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })
        : 'sin límite';

    // ── Contenido del email ──────────────────────────────────────
    const subject = encodeURIComponent(
        `Cronos Fútbol — Aviso de renovación · ${name}`
    );

    const body = encodeURIComponent(
`Hola,

Te contacto en relación a tu plan de Cronos Fútbol para el club "${name}".

━━━━━━━━━━━━━━━━━━━━━━━━━━
  DETALLES DEL PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━
  Plan:         ${plan.label}
  Importe:      ${price}
  Vencimiento:  ${expires}

━━━━━━━━━━━━━━━━━━━━━━━━━━
  FORMAS DE PAGO
━━━━━━━━━━━━━━━━━━━━━━━━━━
  📱 Bizum:          ${SA_CONFIG.bizum}
  🏦 Transferencia:  ${SA_CONFIG.iban}

Una vez realizado el pago, envíame el justificante:
  • Respondiendo a este email, o
  • Por WhatsApp al ${SA_CONFIG.whatsapp}

━━━━━━━━━━━━━━━━━━━━━━━━━━
  CONDICIONES
━━━━━━━━━━━━━━━━━━━━━━━━━━
  • El acceso se mantiene activo hasta la fecha de vencimiento.
  • En caso de impago, el acceso quedará suspendido automáticamente.
  • Al realizar el pago aceptas las condiciones del servicio.

Puedes acceder a la app en: ${SA_CONFIG.appUrl}

Gracias,
${SA_CONFIG.nombre}
${SA_CONFIG.email}
`
    );

    // ── Contenido de WhatsApp ────────────────────────────────────
    const waText = encodeURIComponent(
`Hola 👋 te escribo desde Cronos Fútbol.

📋 *Aviso de renovación — ${name}*
• Plan: ${plan.label}
• Importe: ${price}
• Vencimiento: ${expires}

💳 *Formas de pago:*
📱 Bizum: ${SA_CONFIG.bizum}
🏦 Transferencia: ${SA_CONFIG.iban}

Tras el pago, envíame el justificante por aquí o a ${SA_CONFIG.email} ✅

Gracias! ${SA_CONFIG.nombre}`
    );

    const waUrl    = `https://wa.me/${SA_CONFIG.whatsapp}?text=${waText}`;
    const emailUrl = `mailto:${adminEmail}?subject=${subject}&body=${body}`;

    // ── Modal de envío ───────────────────────────────────────────
    const body_el = document.getElementById('sa-body');
    body_el.innerHTML = `
        <div style="max-width:520px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.2rem;">
                <button onclick="saTab('payments')" class="sa-btn"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                    ← Volver</button>
                <h3 style="margin:0;font-size:1rem;">📧 Enviar aviso de pago — ${name}</h3>
            </div>

            <!-- Preview del mensaje -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:10px;padding:1rem;margin-bottom:1.2rem;
                        font-size:0.79rem;color:var(--text-muted);line-height:1.8;
                        white-space:pre-wrap;font-family:monospace;max-height:260px;overflow-y:auto;">
Plan: ${plan.label}
Importe: ${price}
Vencimiento: ${expires}
Destinatario: ${adminEmail || '⚠️ Sin email de admin definido'}

📱 Bizum: ${SA_CONFIG.bizum}
🏦 IBAN: ${SA_CONFIG.iban}
📞 WhatsApp: ${SA_CONFIG.whatsapp}
            </div>

            ${SA_CONFIG.bizum === 'TU_NUMERO_BIZUM' ? `
            <div style="background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.4);
                        border-radius:8px;padding:0.7rem 1rem;margin-bottom:1rem;
                        font-size:0.8rem;color:#ffa500;">
                ⚠️ Recuerda rellenar tus datos en <strong>SA_CONFIG</strong> dentro de app.js
                antes de enviar avisos reales.
            </div>` : ''}

            <!-- Botones de envío -->
            <div style="display:flex;flex-direction:column;gap:0.7rem;">

                ${adminEmail ? `
                <a href="${emailUrl}" target="_blank" style="text-decoration:none;">
                    <button class="sa-btn" style="width:100%;padding:0.7rem;
                        color:#58a6ff;border-color:rgba(88,166,255,0.4);
                        background:rgba(88,166,255,0.1);font-weight:700;font-size:0.9rem;
                        cursor:pointer;">
                        📧 Abrir en tu cliente de email
                        <div style="font-size:0.72rem;font-weight:400;color:var(--text-muted);margin-top:0.2rem;">
                            Para: ${adminEmail}
                        </div>
                    </button>
                </a>` : `
                <div style="background:rgba(255,88,88,0.08);border:1px solid rgba(255,88,88,0.3);
                            border-radius:8px;padding:0.7rem 1rem;font-size:0.8rem;color:#ff5858;">
                    ⚠️ Este club no tiene email de administrador definido.
                    Edita el club y añade el email del admin.
                </div>`}

                <a href="${waUrl}" target="_blank" style="text-decoration:none;">
                    <button class="sa-btn" style="width:100%;padding:0.7rem;
                        color:#3fb950;border-color:rgba(63,185,80,0.4);
                        background:rgba(63,185,80,0.1);font-weight:700;font-size:0.9rem;
                        cursor:pointer;">
                        📱 Enviar por WhatsApp
                        <div style="font-size:0.72rem;font-weight:400;color:var(--text-muted);margin-top:0.2rem;">
                            Se abre WhatsApp con el mensaje listo para enviar
                        </div>
                    </button>
                </a>

                <!-- Registrar aviso enviado -->
                <button onclick="saMarkNoticeSent('${id}','${type}')" class="sa-btn"
                    style="padding:0.6rem;color:var(--text-muted);border-color:var(--glass-border);
                           background:var(--glass);font-size:0.83rem;cursor:pointer;">
                    ✅ Marcar como "Aviso enviado"
                </button>
                <div style="font-size:0.74rem;color:var(--text-muted);text-align:center;">
                    Pulsa esto después de enviar el email o WhatsApp para registrar la fecha del aviso.
                </div>
            </div>
        </div>`;

    window.saMarkNoticeSent = async (id, type) => {
        const col = type === 'club' ? 'clubs' : 'users';
        await saWrite(col, id, {
            lastNotice: {
                date: new Date().toISOString(),
                sentBy: window._cronosCurrentUser?.email || 'superadmin'
            }
        });
        showToast('✅ Aviso registrado correctamente', 3000);
        saTab('payments');
    };
}
window.saSendPaymentEmail = saSendPaymentEmail;

// ══════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Envío de convocatoria por WhatsApp / Email
// ══════════════════════════════════════════════════════════════════

function openConvocationMessage(target) {
    // Obtener jugadores convocados guardados (se guardan antes de abrir este panel)
    const selectedPlayers = window._savedConvokedPlayers || [];
    const isParents = target === 'parents';
    const isCoordinators = target === 'coordinators';

    // Pre-llenar con datos guardados de la convocatoria
    const convData = JSON.parse(localStorage.getItem('cronos_conv_data') || '{}');
    const saved = JSON.parse(localStorage.getItem('cronos_conv_config') || '{}');

    // Greeting based on current time
    const hour = new Date().getHours();
    const defaultGreeting = hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';

    let title;
    if (isParents) title = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Enviar Convocatoria a Padres';
    else if (isCoordinators) title = '\u{1F3AF} Enviar Convocatoria a Coordinadores';
    else title = '\u{1F4CB} Enviar Convocatoria a Directores';

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,680px);max-height:94vh;
             display:flex;flex-direction:column;overflow:hidden;">

            <!-- Header -->
            <div style="display:flex;justify-content:space-between;align-items:center;
                        margin-bottom:0.8rem;flex-shrink:0;">
                <h2 style="margin:0;font-size:1.1rem;">${title}</h2>
                <button onclick="openConvocationModal()"
                    style="background:none;border:none;color:var(--text-muted);
                           font-size:1.3rem;cursor:pointer;">✕</button>
            </div>

            <div style="overflow-y:auto;flex:1;padding-right:0.2rem;">

            <!-- ── DATOS DEL PARTIDO ─────────────────────────── -->
            <div style="background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.2);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:var(--primary);
                            margin-bottom:0.7rem;letter-spacing:0.5px;">⚽ DATOS DEL PARTIDO</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.55rem;">
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Saludo inicial</label>
                        <select id="cv-greeting" class="conv-input">
                            <option value="Buenos días" ${(saved.greeting||defaultGreeting)==='Buenos días'?'selected':''}>Buenos días ☀️</option>
                            <option value="Buenas tardes" ${(saved.greeting||defaultGreeting)==='Buenas tardes'?'selected':''}>Buenas tardes 🌤️</option>
                            <option value="Buenas noches" ${(saved.greeting||defaultGreeting)==='Buenas noches'?'selected':''}>Buenas noches 🌙</option>
                            <option value="Hola" ${(saved.greeting||defaultGreeting)==='Hola'?'selected':''}>Hola 👋</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Tipo de partido</label>
                        <select id="cv-type" class="conv-input">
                            <option value="amistoso" ${(convData.type || saved.type || 'amistoso')==='amistoso'?'selected':''}>⚽ Amistoso</option>
                            <option value="liga" ${(convData.type || saved.type || 'liga')==='liga'?'selected':''}>🏆 Liga</option>
                            <option value="copa" ${(convData.type || saved.type || '')==='copa'?'selected':''}>🏅 Copa</option>
                            <option value="torneo" ${(convData.type || saved.type || '')==='torneo'?'selected':''}>🎖️ Torneo</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Fecha del partido</label>
                        <input id="cv-date" type="date" class="conv-input"
                            value="${convData.date || saved.date || new Date().toISOString().substring(0,10)}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Rival</label>
                        <input id="cv-rival" type="text" class="conv-input"
                            placeholder="Nombre del equipo rival"
                            value="${convData.rival || saved.rival || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Hora de presentación</label>
                        <input id="cv-meettime" type="time" class="conv-input"
                            value="${convData.meettime || saved.meettime || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Hora de inicio del partido</label>
                        <input id="cv-kickoff" type="time" class="conv-input"
                            value="${convData.time || saved.kickoff || ''}">
                    </div>
                    <div style="grid-column:1/-1;">
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Campo / Lugar</label>
                        <input id="cv-venue" type="text" class="conv-input"
                            placeholder="Nombre del campo o dirección"
                            value="${convData.venue || saved.venue || ''}">
                    </div>
                </div>
            </div>

            <!-- ── LISTA DE CONVOCADOS ──────────────────────── -->
            <div style="background:rgba(63,185,80,0.05);border:1px solid rgba(63,185,80,0.2);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:#3fb950;
                            margin-bottom:0.7rem;letter-spacing:0.5px;">
                    👥 CONVOCADOS (${selectedPlayers.length} seleccionados)
                </div>
                ${selectedPlayers.length === 0 ? `
                    <p style="color:var(--text-muted);font-size:0.82rem;margin:0;">
                        ⚠️ No has seleccionado jugadores. Vuelve atrás y selecciónalos primero.
                    </p>` : `
                    <div id="cv-players-list" style="display:flex;flex-direction:column;gap:0.3rem;">
                        ${selectedPlayers.map((p, i) => `
                        <div style="display:flex;align-items:center;gap:0.5rem;">
                            <span style="font-size:0.72rem;color:var(--primary);font-weight:700;
                                         width:18px;text-align:right;">${i+1}.</span>
                            <input type="text" class="conv-player-name conv-input"
                                data-idx="${i}"
                                value="${p.alias || p.name || 'Jugador ' + (i+1)}"
                                style="flex:1;padding:0.3rem 0.5rem;font-size:0.82rem;">
                        </div>`).join('')}
                    </div>
                    <p style="font-size:0.72rem;color:var(--text-muted);margin:0.5rem 0 0;">
                        💡 Puedes editar los nombres antes de enviar
                    </p>`}
            </div>

            <!-- ── MENSAJE ADICIONAL ────────────────────────── -->
            <div style="background:rgba(240,136,62,0.05);border:1px solid rgba(240,136,62,0.2);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:var(--secondary);
                            margin-bottom:0.7rem;letter-spacing:0.5px;">💬 MENSAJE EXTRA (opcional)</div>
                <textarea id="cv-extra" class="conv-input" rows="3"
                    placeholder="ej: ¡Vamos equipo! Estamos preparados para este partido. Recordad traer el equipaje completo. 💪"
                    style="resize:vertical;">${saved.extra || ''}</textarea>
            </div>

            <!-- ── ENVÍO ────────────────────────────────────── -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);
                            margin-bottom:0.7rem;letter-spacing:0.5px;">📤 ENVIAR A</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.55rem;">
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">
                            📱 WhatsApp (número o grupo)
                        </label>
                        <input id="cv-wa" type="tel" class="conv-input"
                            placeholder="34612345678"
                            value="${saved.wa || emailConfig?.whatsappNumber || ''}">
                        <p style="font-size:0.68rem;color:var(--text-muted);margin:0.2rem 0 0;">
                            Sin + ni espacios. Ej: 34612345678
                        </p>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">
                            📧 Email
                        </label>
                        <input id="cv-email" type="email" class="conv-input"
                            placeholder="padres@equipo.com"
                            value="${saved.email || emailConfig?.directorEmail || ''}">
                    </div>
                </div>
            </div>

            </div><!-- end scroll -->

            <!-- ── BOTONES ──────────────────────────────────── -->
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;padding-top:0.8rem;
                        border-top:1px solid var(--glass-border);flex-shrink:0;margin-top:0.4rem;">
                <button onclick="openConvocationModal()" class="btn"
                    style="color:var(--text-muted);">← Volver</button>
                <button onclick="previewConvocationMsg()" class="btn"
                    style="background:rgba(88,166,255,0.1);border-color:rgba(88,166,255,0.3);
                           color:var(--primary);flex:1;">
                    👁️ Vista previa</button>
                <button onclick="sendConvocationWA()" class="btn"
                    style="background:rgba(63,185,80,0.15);border-color:rgba(63,185,80,0.4);
                           color:#3fb950;font-weight:700;">
                    📱 WhatsApp</button>
                <button onclick="sendConvocationEmail()" class="btn"
                    style="background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.4);
                           color:var(--primary);font-weight:700;">
                    📧 Email</button>
            </div>
        </div>
        <style>
        .conv-input {
            width:100%;padding:0.42rem 0.6rem;
            background:rgba(255,255,255,0.06);
            border:1px solid var(--glass-border);
            border-radius:7px;color:var(--text);font-size:0.85rem;
            box-sizing:border-box;
        }
        .conv-input:focus { outline:none;border-color:rgba(88,166,255,0.5); }
        </style>
    `;
}

// ── Construir el mensaje de convocatoria ─────────────────────────────
function buildConvocationText() {
    const greeting  = document.getElementById('cv-greeting')?.value || 'Hola';
    const type      = document.getElementById('cv-type')?.value || 'liga';
    const dateVal   = document.getElementById('cv-date')?.value || '';
    const rival     = document.getElementById('cv-rival')?.value.trim() || '—';
    const meettime  = document.getElementById('cv-meettime')?.value || '';
    const kickoff   = document.getElementById('cv-kickoff')?.value || '';
    const venue     = document.getElementById('cv-venue')?.value.trim() || '';
    const extra     = document.getElementById('cv-extra')?.value.trim() || '';

    // Format date
    const dateStr = dateVal
        ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES', {
            weekday:'long', day:'numeric', month:'long'})
        : '—';

    // Player names
    const playerInputs = document.querySelectorAll('.conv-player-name');
    const playerLines  = Array.from(playerInputs)
        .map((el, i) => `${i + 1}. ${el.value.trim() || '—'}`)
        .join('\n');

    const typeLabels = {
        amistoso:'amistoso', liga:'de liga', copa:'de copa', torneo:'de torneo'
    };
    const typeLabel = typeLabels[type] || type;

    // Build message
    let msg = `${greeting} familia! 👋\n\n`;
    msg += `📋 *CONVOCATORIA*\n`;
    msg += `Partido ${typeLabel}\n`;
    msg += `📅 ${dateStr}\n`;
    msg += `🆚 vs ${rival}\n\n`;
    msg += `👥 *CONVOCADOS:*\n${playerLines}\n\n`;

    if (venue || meettime || kickoff) {
        msg += `📍 *CONCENTRACIÓN:*\n`;
        if (venue)    msg += `🏟️ Campo: ${venue}\n`;
        if (meettime) msg += `🕐 Presentarse: ${meettime}h\n`;
        if (kickoff)  msg += `⚽ Inicio del partido: ${kickoff}h\n`;
        msg += '\n';
    }

    if (extra) {
        msg += `💬 ${extra}\n\n`;
    }

    msg += `_Cronos Fútbol_ ⚽`;
    return msg;
}

// ── Guardar configuración ───────────────────────────────────────────
function saveConvConfig() {
    const cfg = {
        greeting:  document.getElementById('cv-greeting')?.value,
        type:      document.getElementById('cv-type')?.value,
        date:      document.getElementById('cv-date')?.value,
        rival:     document.getElementById('cv-rival')?.value,
        meettime:  document.getElementById('cv-meettime')?.value,
        kickoff:   document.getElementById('cv-kickoff')?.value,
        venue:     document.getElementById('cv-venue')?.value,
        extra:     document.getElementById('cv-extra')?.value,
        wa:        document.getElementById('cv-wa')?.value,
        email:     document.getElementById('cv-email')?.value,
    };
    localStorage.setItem('cronos_conv_config', JSON.stringify(cfg));
}

// ── Vista previa ────────────────────────────────────────────────────
function previewConvocationMsg() {
    saveConvConfig();
    const msg = buildConvocationText();
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,560px);max-height:90vh;
             display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;align-items:center;
                        margin-bottom:0.8rem;flex-shrink:0;">
                <h3 style="margin:0;font-size:1rem;">👁️ Vista previa del mensaje</h3>
                <button onclick="openConvocationMessage()"
                    style="background:none;border:none;color:var(--text-muted);
                           font-size:1.3rem;cursor:pointer;">✕</button>
            </div>
            <div style="background:#111;border:1px solid var(--glass-border);border-radius:10px;
                        padding:1rem;overflow-y:auto;flex:1;
                        white-space:pre-wrap;font-size:0.85rem;line-height:1.6;
                        color:var(--text);font-family:inherit;">
${msg.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\*(.*?)\*/g,'<strong>$1</strong>')}
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.8rem;flex-shrink:0;">
                <button onclick="openConvocationMessage()" class="btn"
                    style="color:var(--text-muted);flex:1;">← Editar</button>
                <button onclick="sendConvocationWA()" class="btn"
                    style="background:rgba(63,185,80,0.15);border-color:rgba(63,185,80,0.4);
                           color:#3fb950;font-weight:700;flex:1;">
                    📱 WhatsApp</button>
                <button onclick="sendConvocationEmail()" class="btn"
                    style="background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.4);
                           color:var(--primary);font-weight:700;flex:1;">
                    📧 Email</button>
            </div>
        </div>`;
}

// ── Enviar por WhatsApp ─────────────────────────────────────────────
function sendConvocationWA() {
    saveConvConfig();
    const num = document.getElementById('cv-wa')?.value.trim()
             || JSON.parse(localStorage.getItem('cronos_conv_config')||'{}').wa || '';
    const msg = buildConvocationText();
    const encoded = encodeURIComponent(msg);
    if (num) {
        window.open(`https://wa.me/${num}?text=${encoded}`, '_blank');
    } else {
        // Open WhatsApp without number (user selects contact manually)
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    }
    showToast('📱 WhatsApp abierto — selecciona el contacto o grupo', 4000);
}

// ── Enviar por Email ────────────────────────────────────────────────
function sendConvocationEmail() {
    saveConvConfig();
    const to      = document.getElementById('cv-email')?.value.trim()
                 || JSON.parse(localStorage.getItem('cronos_conv_config')||'{}').email || '';
    const rival   = document.getElementById('cv-rival')?.value.trim() || '';
    const dateVal = document.getElementById('cv-date')?.value || '';
    const dateStr = dateVal
        ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long'})
        : '';
    const subject = encodeURIComponent(
        `⚽ Convocatoria ${dateStr ? '— ' + dateStr : ''}${rival ? ' vs ' + rival : ''}`
    );
    const body = encodeURIComponent(buildConvocationText().replace(/[*_]/g,''));
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank');
    showToast('📧 Email abierto en tu cliente de correo', 3000);
}

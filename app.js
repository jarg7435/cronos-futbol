// --- SECURITY & INITIALIZATION ---
const ACCESS_CODE = '1234';

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
    document.getElementById('player-action-modal').style.display = 'flex';
}

function closePlayerActionModal() {
    activeActionPlayerId = null;
    document.getElementById('player-action-modal').style.display = 'none';
}

function assignCard(type) {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (p) {
        p.cards = type;
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
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    alert(`🏁 PARTIDO FINALIZADO: ${reason}\nResultado final: ${TEAM_NAMES.home} ${document.getElementById('score-home').textContent} - ${document.getElementById('score-away').textContent} ${TEAM_NAMES.away}`);
}

function endMatch() {
    if (!confirm('¿Finalizar el partido? Esta acción detiene el reloj y cierra el encuentro.')) return;
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    document.getElementById('phase-actions').innerHTML = '';
    document.getElementById('match-phase-label').textContent = 'FIN DEL PARTIDO';
    const scoreHome = document.getElementById('score-home').textContent;
    const scoreAway = document.getElementById('score-away').textContent;
    alert(`🏁 PARTIDO FINALIZADO\n${TEAM_NAMES.home} ${scoreHome} - ${scoreAway} ${TEAM_NAMES.away}`);
}

function changeGoals(amount) {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (p) {
        p.goals = Math.max(0, (p.goals || 0) + amount);
        document.getElementById('action-player-goals').textContent = `${p.goals} ⚽`;
        syncScoreFromPlayers(p.team);
        renderPlayers();
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
        p.goals = 0; p.cards = 'ninguna';
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

function openEmailSettings() {
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(95vw,580px); max-height:92vh; overflow-y:auto;">
            <h2 style="text-align:center; margin-bottom:0.3rem;">📧 Configuración de Envío de Informes</h2>
            <p style="font-size:0.78rem; color:var(--text-muted); text-align:center; margin-bottom:1.2rem;">
                Al exportar un informe, se descargará automáticamente <strong>Y</strong> se enviará por email.
            </p>

            <!-- CORREOS -->
            <div style="background:var(--glass); border-radius:10px; padding:1rem; margin-bottom:1rem;">
                <h3 style="margin:0 0 0.8rem; color:var(--primary); font-size:0.9rem;">📬 Destinatarios</h3>
                <div class="form-group">
                    <label>Tu correo (Entrenador) — recibirás una copia</label>
                    <input type="email" id="cfg-coach-email" placeholder="entrenador@ejemplo.com"
                        value="${emailConfig.coachEmail}"
                        style="width:100%; padding:0.5rem 0.7rem; border-radius:8px;
                               border:1px solid var(--glass-border); background:var(--bg);
                               color:var(--text); font-size:0.9rem;">
                </div>
                <div class="form-group" style="margin-top:0.6rem;">
                    <label>Correo del Director Deportivo — destinatario principal</label>
                    <input type="email" id="cfg-director-email" placeholder="director@club.com"
                        value="${emailConfig.directorEmail}"
                        style="width:100%; padding:0.5rem 0.7rem; border-radius:8px;
                               border:1px solid var(--glass-border); background:var(--bg);
                               color:var(--text); font-size:0.9rem;">
                </div>
                <div class="form-group" style="margin-top:0.6rem;">
                    <label>📱 WhatsApp del Director Deportivo — con prefijo de país, sin + ni espacios</label>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <span style="color:var(--text-muted); font-size:0.85rem; white-space:nowrap;">+</span>
                        <input type="tel" id="cfg-whatsapp" placeholder="34612345678"
                            value="${emailConfig.whatsappNumber}"
                            style="width:100%; padding:0.5rem 0.7rem; border-radius:8px;
                                   border:1px solid var(--glass-border); background:var(--bg);
                                   color:var(--text); font-size:0.9rem; font-family:monospace;">
                    </div>
                    <span style="font-size:0.7rem; color:var(--text-muted);">
                        España: 34 + 9 dígitos (ej: 34612345678) · Al exportar, WhatsApp se abrirá listo para enviar con 1 toque.
                    </span>
                </div>
            </div>

            <!-- EMAILJS -->
            <div style="background:var(--glass); border-radius:10px; padding:1rem; margin-bottom:1rem;">
                <h3 style="margin:0 0 0.4rem; color:var(--primary); font-size:0.9rem;">⚙️ Credenciales EmailJS</h3>
                <p style="font-size:0.72rem; color:var(--text-muted); margin-bottom:0.8rem;">
                    Servicio <strong>gratuito</strong> (hasta 200 emails/mes). Regístrate en
                    <a href="https://www.emailjs.com" target="_blank" style="color:var(--primary);">emailjs.com</a>
                    → conecta tu Gmail → crea una plantilla → copia los 3 datos aquí.
                </p>
                <div class="form-group">
                    <label>Service ID</label>
                    <input type="text" id="cfg-service-id" placeholder="service_xxxxxxx"
                        value="${emailConfig.emailjsServiceId}"
                        style="width:100%; padding:0.5rem 0.7rem; border-radius:8px;
                               border:1px solid var(--glass-border); background:var(--bg);
                               color:var(--text); font-size:0.85rem; font-family:monospace;">
                </div>
                <div class="form-group" style="margin-top:0.6rem;">
                    <label>Template ID</label>
                    <input type="text" id="cfg-template-id" placeholder="template_xxxxxxx"
                        value="${emailConfig.emailjsTemplateId}"
                        style="width:100%; padding:0.5rem 0.7rem; border-radius:8px;
                               border:1px solid var(--glass-border); background:var(--bg);
                               color:var(--text); font-size:0.85rem; font-family:monospace;">
                </div>
                <div class="form-group" style="margin-top:0.6rem;">
                    <label>Public Key</label>
                    <input type="text" id="cfg-public-key" placeholder="xxxxxxxxxxxxxxxxxxxxxx"
                        value="${emailConfig.emailjsPublicKey}"
                        style="width:100%; padding:0.5rem 0.7rem; border-radius:8px;
                               border:1px solid var(--glass-border); background:var(--bg);
                               color:var(--text); font-size:0.85rem; font-family:monospace;">
                </div>
            </div>

            <!-- INSTRUCCIONES -->
            <details style="margin-bottom:1rem;">
                <summary style="cursor:pointer; color:var(--primary); font-size:0.82rem; font-weight:bold;">
                    📋 Cómo configurar EmailJS paso a paso
                </summary>
                <ol style="font-size:0.78rem; color:var(--text-muted); margin-top:0.6rem; padding-left:1.2rem; line-height:1.7;">
                    <li>Entra en <strong>emailjs.com</strong> y crea una cuenta gratuita</li>
                    <li>Ve a <strong>Email Services</strong> → Add New Service → elige Gmail (o el tuyo)</li>
                    <li>Anota el <strong>Service ID</strong> (ej: service_abc123)</li>
                    <li>Ve a <strong>Email Templates</strong> → Create New Template</li>
                    <li>En el template usa estas variables: <code>{{to_email}}</code>, <code>{{coach_email}}</code>, <code>{{subject}}</code>, <code>{{match_info}}</code>, <code>{{report_body}}</code></li>
                    <li>Anota el <strong>Template ID</strong> (ej: template_xyz789)</li>
                    <li>Ve a <strong>Account → General</strong> → anota tu <strong>Public Key</strong></li>
                </ol>
            </details>

            <div style="display:flex; justify-content:space-between; align-items:center;">
                <button class="btn" onclick="openSetupModal()">VOLVER</button>
                <div style="display:flex; gap:0.6rem;">
                    <button class="btn" onclick="testEmailConfig()"
                        style="background:rgba(88,166,255,0.15); color:var(--primary); border:1px solid var(--primary);">
                        PROBAR ENVÍO
                    </button>
                    <button class="btn primary" onclick="saveEmailSettings()">GUARDAR</button>
                </div>
            </div>
        </div>
    `;
}

function saveEmailSettings() {
    emailConfig.coachEmail      = document.getElementById('cfg-coach-email').value.trim();
    emailConfig.directorEmail   = document.getElementById('cfg-director-email').value.trim();
    emailConfig.whatsappNumber  = document.getElementById('cfg-whatsapp').value.replace(/[^0-9]/g, '');
    emailConfig.emailjsServiceId  = document.getElementById('cfg-service-id').value.trim();
    emailConfig.emailjsTemplateId = document.getElementById('cfg-template-id').value.trim();
    emailConfig.emailjsPublicKey  = document.getElementById('cfg-public-key').value.trim();

    localStorage.setItem('cronos_email_config', JSON.stringify(emailConfig));
    initEmailJS();

    const channels = [];
    if (emailConfig.directorEmail) channels.push('📧 Email');
    if (emailConfig.whatsappNumber) channels.push('📱 WhatsApp');
    const channelText = channels.length ? channels.join(' + ') : 'ningún canal configurado';
    alert(`✅ Configuración guardada.\n\nAl exportar un informe se enviará por: ${channelText}`);
    openSetupModal();
}

async function testEmailConfig() {
    if (!window._emailjsReady) {
        // Intentar inicializar con los valores del formulario sin guardar
        const pubKey = document.getElementById('cfg-public-key')?.value.trim();
        if (pubKey && typeof emailjs !== 'undefined') {
            emailjs.init(pubKey);
        } else {
            alert('❌ EmailJS no está disponible. Completa los datos y guarda primero.');
            return;
        }
    }
    const svcId = document.getElementById('cfg-service-id')?.value.trim() || emailConfig.emailjsServiceId;
    const tplId = document.getElementById('cfg-template-id')?.value.trim() || emailConfig.emailjsTemplateId;
    const toEmail = document.getElementById('cfg-director-email')?.value.trim() || emailConfig.directorEmail;
    const coachEmail = document.getElementById('cfg-coach-email')?.value.trim() || emailConfig.coachEmail;

    if (!svcId || !tplId || !toEmail) {
        alert('Rellena primero Service ID, Template ID y el correo del Director.');
        return;
    }

    try {
        await emailjs.send(svcId, tplId, {
            to_email:    toEmail,
            coach_email: coachEmail,
            subject:     '✅ PRUEBA — Cronos Fútbol',
            match_info:  'Este es un email de prueba desde Cronos Fútbol.',
            report_body: 'Si recibes este mensaje, el envío automático de informes está correctamente configurado.'
        });
        alert('✅ Email de prueba enviado correctamente a:\n' + toEmail);
    } catch(err) {
        alert('❌ Error al enviar:\n' + (err.text || JSON.stringify(err)) + '\n\nRevisa que los IDs y la clave pública sean correctos.');
    }

    // Prueba de WhatsApp
    const waNum = document.getElementById('cfg-whatsapp')?.value.replace(/[^0-9]/g, '') || emailConfig.whatsappNumber;
    if (waNum) {
        if (confirm(`¿Abrir WhatsApp para probar el envío al número +${waNum}?`)) {
            const testMsg = encodeURIComponent('✅ PRUEBA — Cronos Fútbol\nSi recibes este mensaje, los informes de partido llegarán correctamente a tu WhatsApp.');
            window.open(`https://wa.me/${waNum}?text=${testMsg}`, '_blank');
        }
    }
}

function sendReportByWhatsApp(matchSummary) {
    if (!emailConfig.whatsappNumber) return;
    const num = emailConfig.whatsappNumber.replace(/[^0-9]/g, '');
    if (!num) return;
    const msg = encodeURIComponent(matchSummary);
    // En móvil abre la app de WhatsApp directamente; en PC abre WhatsApp Web
    window.open(`https://wa.me/${num}?text=${msg}`, '_blank');
}

async function sendReportByEmail(matchInfo, reportHtml) {
    if (!emailConfig.directorEmail) return; // sin configuración, no enviar
    if (!emailConfig.emailjsServiceId || !emailConfig.emailjsTemplateId || !emailConfig.emailjsPublicKey) return;

    if (!window._emailjsReady) {
        initEmailJS();
        if (!window._emailjsReady) return;
    }

    const date = new Date().toLocaleDateString('es-ES');
    try {
        await emailjs.send(
            emailConfig.emailjsServiceId,
            emailConfig.emailjsTemplateId,
            {
                to_email:    emailConfig.directorEmail,
                coach_email: emailConfig.coachEmail,
                subject:     `📊 Informe de Partido — ${matchInfo} — ${date}`,
                match_info:  matchInfo,
                report_body: reportHtml
            }
        );
        console.log('✅ Informe enviado a', emailConfig.directorEmail);
    } catch(err) {
        console.error('Error enviando email:', err);
        // Notificación no intrusiva — no bloquea al entrenador
        const toast = document.createElement('div');
        toast.textContent = '⚠️ El informe se descargó, pero el email no pudo enviarse.';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
            'background:#c0392b;color:#fff;padding:10px 20px;border-radius:8px;' +
            'font-size:0.82rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }
}

function init() {
    loadEmailConfig();    // carga correos y credenciales EmailJS guardadas
    setupEventListeners();
    openSetupModal();
    registerServiceWorker();
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
                        // Nueva versión lista → mostrar aviso y recargar automáticamente
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
            <h2 style="text-align:center; margin-bottom:1.2rem;">Configuración del Encuentro</h2>

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
                    <button class="btn" onclick="openEmailSettings()"
                        title="Configurar envío automático de informes por email"
                        style="background:var(--glass);color:var(--secondary);font-size:0.82rem;border:1px solid var(--secondary);">
                        📧 EMAIL
                    </button>
                    ${window._cronosCurrentUser?.role === 'admin' ? `
                    <button onclick="openAdminPanel()"
                        style="background:rgba(255,165,0,0.15); border:1px solid rgba(255,165,0,0.5);
                               color:#ffa500; font-size:0.82rem; padding:0.45rem 0.9rem;
                               border-radius:8px; cursor:pointer; font-weight:700;">
                        ⚙ ADMIN
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
            <h2>Gestionar Plantilla - ${mode === 'f7' ? 'Fútbol 7' : 'Fútbol 11'}</h2>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Completa los datos de tus ${limit} jugadores. El Alias es el nombre que aparecerá en la ficha.</p>
            <div style="overflow-x: auto;">
                <table class="roster-table">
                    <thead>
                        <tr>
                            <th style="width: 50px;">#</th>
                            <th>Nombre</th>
                            <th>Apellidos</th>
                            <th>Alias (Ficha)</th>
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
            <div style="margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 1rem;">
                <button class="btn" onclick="openSetupModal()">CANCELAR</button>
                <button class="btn primary" onclick="saveMasterRoster('${mode}')">GUARDAR PLANTILLA</button>
            </div>
        </div>
    `;
}

function saveMasterRoster(mode) {
    const rows = document.querySelectorAll('#roster-tbody tr');
    const playersData = Array.from(rows).map(row => ({
        number: row.querySelector('.r-num').value,
        name: row.querySelector('.r-name').value,
        surname: row.querySelector('.r-surname').value,
        alias: row.querySelector('.r-alias').value
    }));
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    roster[mode] = playersData;
    localStorage.setItem('cronos_master_roster', JSON.stringify(roster));
    alert('Plantilla guardada correctamente.');
    openSetupModal();
}

function openConvocationModal() {
    document.body.classList.add('setup-mode');
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const minLimit = currentMode === 'f7' ? 6 : 7;
    const maxLimit = currentMode === 'f7' ? 14 : 18;
    // Columnas: f7→3 cols (18 jugadores), f11→5 cols (25 jugadores)
    const cols = currentMode === 'f7' ? 3 : 5;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(95vw,800px); max-height:92vh; display:flex; flex-direction:column; overflow:hidden;">
            <h2 style="margin-bottom:0.2rem;">Convocatoria — ${TEAM_NAMES.home}</h2>
            <p style="font-size:0.78rem; color:var(--text-muted); margin-bottom:0.8rem;">
                Toca cualquier jugador para seleccionarlo · Mínimo <strong>${minLimit}</strong>, Máximo <strong>${maxLimit}</strong>
            </p>

            <div style="display:grid; grid-template-columns:repeat(${cols}, 1fr); gap:6px; overflow-y:auto; flex:1;">
                ${myPlayers.length > 0 ? myPlayers.map((p, i) => `
                    <div class="conv-row" data-index="${i}"
                        style="background:var(--glass); border:2px solid transparent; border-radius:8px;
                               padding:8px 10px; display:flex; align-items:center; gap:8px;
                               cursor:pointer; transition:all 0.15s; user-select:none;">
                        <span class="conv-dot" style="width:18px;height:18px;border-radius:50%;
                              background:rgba(255,255,255,0.1); border:2px solid rgba(255,255,255,0.25);
                              display:flex;align-items:center;justify-content:center;
                              font-size:0.6rem;flex-shrink:0;">✓</span>
                        <span style="font-size:0.82rem;">
                            <span style="color:var(--primary);font-weight:bold;">${p.number}</span>
                            ${p.alias || p.name || 'J' + (i + 1)}
                        </span>
                    </div>
                `).join('') : '<p style="grid-column:1/-1;">No tienes jugadores. Se usarán dorsales por defecto.</p>'}
            </div>

            <div style="margin-top:0.8rem; padding-top:0.8rem; border-top:1px solid var(--glass-border);
                        display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <span id="conv-count" style="font-size:1rem; font-weight:bold; color:var(--primary);">0</span>
                <div style="display:flex; gap:0.8rem;">
                    <button class="btn" onclick="openSetupModal()">ATRÁS</button>
                    <button class="btn primary" id="btn-start-match" onclick="startMatchWithConvocation()" disabled>
                        INICIAR PARTIDO
                    </button>
                </div>
            </div>
        </div>
    `;

    const countEl = document.getElementById('conv-count');
    const startBtn = document.getElementById('btn-start-match');

    if (myPlayers.length === 0) {
        startBtn.disabled = false;
        countEl.style.display = 'none';
        return;
    }

    let selected = 0;

    // --- PRE-SELECCIÓN DE EQUIPO CARGADO ---
    // Titulares  → borde naranja (--secondary) + badge "T"
    // Suplentes  → borde azul   (--primary)   + badge "S"
    const loadedTeam = window.loadedTeamPlayers?.['home'];
    if (loadedTeam) {
        myPlayers.forEach((p, i) => {
            const savedPlayer = loadedTeam.find(lp => lp.number == p.number);
            if (savedPlayer) {
                const row = document.querySelector(`.conv-row[data-index="${i}"]`);
                if (row) {
                    const isTitular = savedPlayer.status === 'field';
                    const borderColor = isTitular ? 'var(--secondary)' : 'var(--primary)';
                    const bgColor     = isTitular ? 'rgba(240,136,62,0.15)' : 'rgba(88,166,255,0.12)';
                    row.classList.add('conv-selected');
                    row.style.borderColor = borderColor;
                    row.style.background  = bgColor;
                    row.querySelector('.conv-dot').style.background  = borderColor;
                    row.querySelector('.conv-dot').style.borderColor = borderColor;
                    row.querySelector('.conv-dot').style.color = '#0a0e14';
                    row.querySelector('.conv-dot').textContent = isTitular ? 'T' : 'S';
                    // Badge titular/suplente
                    const badge = document.createElement('span');
                    badge.className = 'conv-status-badge';
                    badge.textContent = isTitular ? 'TITULAR' : 'SUP';
                    badge.style.cssText = `font-size:0.55rem;font-weight:bold;padding:2px 5px;
                        border-radius:3px;background:${borderColor};color:#0a0e14;
                        margin-left:auto;flex-shrink:0;`;
                    row.appendChild(badge);
                    selected++;
                }
            }
        });
        countEl.textContent = `${selected}`;
        const isValid = (selected >= minLimit && selected <= maxLimit);
        countEl.style.color = isValid ? 'var(--secondary)' : 'var(--primary)';
        startBtn.disabled = !isValid;
    }

    document.querySelectorAll('.conv-row').forEach(row => {
        row.addEventListener('click', () => {
            const isSelected = row.classList.contains('conv-selected');

            if (!isSelected && selected >= maxLimit) return; // límite máximo alcanzado

            if (isSelected) {
                row.classList.remove('conv-selected');
                row.style.borderColor = 'transparent';
                row.style.background  = 'var(--glass)';
                row.querySelector('.conv-dot').style.background = 'rgba(255,255,255,0.1)';
                row.querySelector('.conv-dot').style.borderColor = 'rgba(255,255,255,0.25)';
                row.querySelector('.conv-dot').style.color = 'transparent';
                row.querySelector('.conv-dot').textContent = '✓';
                // Quitar badge si existe
                const badge = row.querySelector('.conv-status-badge');
                if (badge) badge.remove();
                selected--;
            } else {
                row.classList.add('conv-selected');
                row.style.borderColor = 'var(--primary)';
                row.style.background  = 'rgba(88,166,255,0.12)';
                row.querySelector('.conv-dot').style.background  = 'var(--primary)';
                row.querySelector('.conv-dot').style.borderColor = 'var(--primary)';
                row.querySelector('.conv-dot').style.color = '#0a0e14';
                row.querySelector('.conv-dot').textContent = '✓';
                selected++;
            }

            countEl.textContent = `${selected}`;
            const isValid = (selected >= minLimit && selected <= maxLimit);
            countEl.style.color = isValid ? 'var(--secondary)' : 'var(--primary)';
            startBtn.disabled = !isValid;
        });
    });
}

function startMatchWithConvocation() {
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const rows = document.querySelectorAll('.conv-row.conv-selected');
    const selectedPlayers = Array.from(rows).map(r => myPlayers[r.dataset.index]);
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

    document.getElementById('setup-modal').style.display = 'none';

    // Inyectar botones de scroll en ambos banquillos
    injectBenchScrollButtons('bench-list');
    if (analyzeAway) injectBenchScrollButtons('bench-list-away');

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
    localStorage.setItem('cronos_teams', JSON.stringify(teams));
    const titulares = currentPlayers.filter(p => p.status === 'field').length;
    const suplentes = currentPlayers.filter(p => p.status === 'bench').length;
    const formationDisplay = activeFormationKey ? '1-' + activeFormationKey : 'sin definir';
    alert(`✅ Equipo "${teamName}" guardado.\n\nModalidad: ${currentMode === 'f7' ? 'Fútbol 7' : 'Fútbol 11'}\nSistema: ${formationDisplay}\nTitulares: ${titulares} · Suplentes: ${suplentes}`);
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
    const startersCount = currentMode === 'f7' ? 7 : 11;
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
                status: index < startersCount ? 'field' : 'bench',
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
    if (player.goals > 0) indicatorsHTML += `<div class="player-goal-indicator">${player.goals} ⚽</div>`;
    if (player.cards === 'amarilla') indicatorsHTML += `<div class="player-card-indicator amarilla"></div>`;
    else if (player.cards === 'roja') indicatorsHTML += `<div class="player-card-indicator roja"></div>`;

    div.innerHTML = `
        <div class="player-timer ${player.status === 'field' ? 'timer-active' : 'timer-bench'}">${formatTime(player.time)}</div>
        <div class="player-number" style="color: ${player.textColor || '#ffffff'}; pointer-events: none;">${player.number}</div>
        <div class="player-name" style="pointer-events: none;">${player.name}</div>
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

    if (isRunning) { logMovement(dragged); logMovement(target); }
    if (dragged.status === 'bench' || target.status === 'bench') sortBenchUI(dragged.team);
}

function logMovement(player) {
    const elapsed = matchPhase === '2nd_half' ? (masterTimeH1 + masterTimeH2) : masterTimeH1;
    const timestamp = formatTime(elapsed);
    const halfLabel = matchPhase === '1st_half' ? '1ªP' : matchPhase === '2nd_half' ? '2ªP' : 'DESC';
    player.history.push(`${player.status === 'field' ? 'Entra' : 'Sale'} a las ${timestamp} (${halfLabel})`);
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
        return { ...p, shiftsH1, shiftsH2, descanso };
    });

    const maxH1 = Math.max(...processedPlayers.map(p => p.shiftsH1.length), 1);
    const maxH2 = Math.max(...processedPlayers.map(p => p.shiftsH2.length), 1);
    const totalCols = 5 + (maxH1 * 2) + 1 + (maxH2 * 2) + 1;
    const q = (v) => `"${(v || "").toString().replace(/"/g, '""')}"`;
    const makeRow = (cells) => { const r = [...cells]; while (r.length < totalCols) r.push(""); return r.map(q).join(";") + "\n"; };

    let csvContent = "sep=;\n";
    const date = new Date().toLocaleDateString();
    const mode = currentMode === 'f7' ? 'Fútbol 7' : 'Fútbol 11';
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

    const headers = ["EQUIPO","DORSAL","NOMBRE","GOLES","TARJETAS"];
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
        const rowCells = [teamName, p.number, p.name, p.goals || 0, cardDisplay];
        for (let i = 0; i < maxH1; i++) { const s = p.shiftsH1[i]; rowCells.push(s ? s.in : "", s ? s.out : ""); }
        rowCells.push(p.descanso || "");
        for (let i = 0; i < maxH2; i++) { const s = p.shiftsH2[i]; rowCells.push(s ? s.in : "", s ? s.out : ""); }
        rowCells.push(formatTime(p.time));
        csvContent += makeRow(rowCells);
    });

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
        return `<tr>
            <td style="border:1px solid #ddd;padding:8px;">${teamName}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${p.number}</td>
            <td style="border:1px solid #ddd;padding:8px;">${p.name}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${p.goals || 0}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${cardDisplay}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:right;">${formatTime(p.time)}</td>
        </tr>`;
    }).join('');

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

    // --- ENVÍO AUTOMÁTICO POR EMAIL (al director deportivo) ---
    if (emailConfig.directorEmail) {
        // Construir HTML del informe para incluir en el email
        const reportHtmlForEmail = `
<h2 style="color:#333;">📊 Informe de Partido</h2>
<table style="border-collapse:collapse; font-size:13px;">
  <tr><td style="padding:4px 10px;"><strong>Fecha:</strong></td><td>${date}</td></tr>
  <tr><td style="padding:4px 10px;"><strong>Partido:</strong></td><td>${homeName} vs ${awayName}</td></tr>
  <tr><td style="padding:4px 10px;"><strong>Resultado:</strong></td><td><strong>${scoreHome} - ${scoreAway}</strong></td></tr>
  <tr><td style="padding:4px 10px;"><strong>Modalidad:</strong></td><td>${mode}</td></tr>
  <tr><td style="padding:4px 10px;"><strong>Tiempo:</strong></td><td>${formatTime(totalElapsed)}</td></tr>
</table>
<br>
<table style="border-collapse:collapse; width:100%; font-size:12px;">
  <thead>
    <tr style="background:#1a1a2e; color:#fff;">
      <th style="padding:6px 8px; border:1px solid #ccc;">Equipo</th>
      <th style="padding:6px 8px; border:1px solid #ccc;">Nº</th>
      <th style="padding:6px 8px; border:1px solid #ccc;">Nombre</th>
      <th style="padding:6px 8px; border:1px solid #ccc;">Goles</th>
      <th style="padding:6px 8px; border:1px solid #ccc;">Tarjeta</th>
      <th style="padding:6px 8px; border:1px solid #ccc;">Tiempo</th>
    </tr>
  </thead>
  <tbody>
    ${sortedPlayers.map(p => {
        const tName = p.team === 'home' ? homeName : awayName;
        const card  = p.cards === 'ninguna' ? '' : (p.cards === 'amarilla' ? '🟨 AMARILLA' : '🟥 ROJA');
        return '<tr>' +
          '<td style="padding:5px 8px;border:1px solid #ccc;">' + tName + '</td>' +
          '<td style="padding:5px 8px;border:1px solid #ccc;text-align:center;">' + p.number + '</td>' +
          '<td style="padding:5px 8px;border:1px solid #ccc;">' + p.name + '</td>' +
          '<td style="padding:5px 8px;border:1px solid #ccc;text-align:center;">' + (p.goals||0) + '</td>' +
          '<td style="padding:5px 8px;border:1px solid #ccc;text-align:center;">' + card + '</td>' +
          '<td style="padding:5px 8px;border:1px solid #ccc;text-align:right;">' + formatTime(p.time) + '</td>' +
        '</tr>';
    }).join('')}
  </tbody>
</table>
<p style="font-size:11px; color:#888; margin-top:12px;">
  Informe generado automáticamente por Cronos Fútbol · ${date}
</p>`;

        const matchInfo = `${homeName} ${scoreHome}-${scoreAway} ${awayName}`;

        // --- ENVÍO EMAIL ---
        sendReportByEmail(matchInfo, reportHtmlForEmail);

        // --- ENVÍO WHATSAPP (abre con 1 toque) ---
        if (emailConfig.whatsappNumber) {
            const waMsg =
`📊 *INFORME DE PARTIDO — Cronos Fútbol*
━━━━━━━━━━━━━━━━━━━━
📅 Fecha: ${date}
⚽ Partido: *${homeName} ${scoreHome} - ${scoreAway} ${awayName}*
🏟️ Modalidad: ${mode}
⏱️ Tiempo jugado: ${formatTime(totalElapsed)}
━━━━━━━━━━━━━━━━━━━━
👥 *JUGADORES*
${sortedPlayers.map(p => {
    const tName = p.team === 'home' ? homeName : awayName;
    const status = p.status === 'field' ? '🟢' : '🔵';
    const card = p.cards === 'amarilla' ? ' 🟨' : p.cards === 'roja' ? ' 🟥' : '';
    const goals = p.goals > 0 ? ` ⚽×${p.goals}` : '';
    return `${status} [${tName}] ${p.number}. ${p.name} — ${formatTime(p.time)}${goals}${card}`;
}).join('\n')}
━━━━━━━━━━━━━━━━━━━━
_Generado por Cronos Fútbol_`;
            // Pequeño delay para que el CSV se descargue primero
            setTimeout(() => sendReportByWhatsApp(waMsg), 800);
        }

        // --- TOAST DE CONFIRMACIÓN ---
        const channels = [];
        if (emailConfig.directorEmail) channels.push('📧 email');
        if (emailConfig.whatsappNumber) channels.push('📱 WhatsApp');
        const toast = document.createElement('div');
        toast.textContent = channels.length
            ? `✅ Informe enviado por ${channels.join(' + ')} al Director Deportivo`
            : '✅ Informe descargado';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
            'background:#1a7a3e;color:#fff;padding:10px 22px;border-radius:8px;' +
            'font-size:0.82rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);white-space:nowrap;';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }
}

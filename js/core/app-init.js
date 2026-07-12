window._CRONOS_DEBUG = false; // Activar solo en desarrollo
// SECURITY: Guaranteed escapeHtml & escapeAttr — prevents XSS if script load order fails
// These polyfills MUST be at the very top of this file so they execute before anything else.
// They only activate if the full implementations below haven't loaded yet.
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function(s) {
        if (s == null) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;').replace(/\//g,'&#x2F;');
    };
}
if (typeof window.escapeAttr !== 'function') {
    window.escapeAttr = function(s) {
        if (s == null) return '';
        return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#039;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    };
}

// --- XSS PREVENTION (global) ---
// NOTE: Assigned to window so it overwrites the polyfill above
//       and is guaranteed available to all modules.
window.escapeHtml = function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
    return s.replace(/[&<>"'/]/g, c => map[c]);
};
window.escapeAttr = function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

// --- SECURITY & INITIALIZATION ---
var ACCESS_CODE = ''; // Cargado dinámicamente desde Firestore (cronos_config/access)

// ── Cargar ACCESS_CODE desde Firestore ──
let _accessCodeLoaded = false;
async function loadAccessCode() {
    try {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) { setTimeout(loadAccessCode, 1000); return; }
        const snap = await fa.getDoc(fa.doc(fa.db, 'cronos_config', 'access'));
        if (snap.exists()) {
            const data = snap.data();
            ACCESS_CODE = data.code || '';
            _accessCodeLoaded = true;
        } else {
            console.warn('[Chronos] No se encontró cronos_config/access en Firestore — usando código vacío');
            _accessCodeLoaded = true;
        }
    } catch(e) {
        // Si falla por permisos es comportamiento esperado (usuario no autenticado aún).
        // El reintento se produce automáticamente tras login vía _retryAccessCodeLoad().
        if (e.code !== 'permission-denied' && !(e.message && e.message.includes('permission'))) {
            console.error('[Chronos] Error cargando ACCESS_CODE:', e);
        }
    }
}
loadAccessCode();

// ── Reintentar carga de ACCESS_CODE tras autenticación ──
window._retryAccessCodeLoad = function() {
    if (!_accessCodeLoaded) loadAccessCode();
};

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
var players = [];
var isRunning = false;
var timerInterval = null;
var lastTickTime = 0;
var currentMode = 'f7';
var matchPhase = '1st_half';
var analyzeAway = false;
var activeFormationKey = null;
var selectedFormationOnStart = '';

var half1MaxTime = 30 * 60;
var half2MaxTime = 30 * 60;
var masterTimeH1 = 0;
var masterTimeH2 = 0;

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

var COLORS = {
    home: { primary: '#58a6ff', secondary: '#f0883e', shorts: '#ffffff', text: '#ffffff' },
    away: { primary: '#ff5858', secondary: '#f0883e', shorts: '#000000', text: '#ffffff' }
};

var TEAM_NAMES = { home: 'LOCAL', away: 'VISITANTE' };

// ══════════════════════════════════════════════════════════════════
//  FORMACIONES PREDEFINIDAS
//  El campo es HORIZONTAL (aspect-ratio 3:2).
//  x = izquierda→derecha (%), y = arriba→abajo (%)
//  LOCAL ocupa el LADO IZQUIERDO (x: 5-46) en modo ambos equipos.
//  VISITANTE ocupa el LADO DERECHO (x: 54-95), espejo del local.
//  FULL = local solo, ocupa campo completo (x: 5-92).
// ══════════════════════════════════════════════════════════════════
var FORMATION_PRESETS = {
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

    let homeIdx = 0, awayIdx = 0;
    sortedPlayers.forEach(p => {
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

// --- PLAYER ACTION MODAL ---
let activeActionPlayerId = null;

function openPlayerActionModal(player) {
    activeActionPlayerId = player.id;
    document.getElementById('action-player-name').innerHTML = `${escapeHtml(player.name)} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-number').innerHTML = `Dorsal ${escapeHtml(player.number)} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-goals').textContent = `${player.goals || 0} ⚽`;
    // Resaltar botón de tarjeta activa
    const btnAmarilla = document.querySelector('#player-action-modal .btn[onclick*="amarilla"]');
    const btnRoja     = document.querySelector('#player-action-modal .btn[onclick*="roja"]');

    if (btnAmarilla) {
        // Limpiar badges previos
        const oldBadge = btnAmarilla.querySelector('.cronos-ynum');
        if (oldBadge) oldBadge.remove();
        btnAmarilla.style.outline   = '';
        btnAmarilla.style.boxShadow = '';

        if (player.cards === 'amarilla' && (player.yellowCards || 0) >= 1) {
            // Tiene 1ª amarilla → avisar que la siguiente expulsa
            btnAmarilla.style.outline   = '3px solid #f39c12';
            btnAmarilla.style.boxShadow = '0 0 10px rgba(243,156,18,0.9)';
            const badge = document.createElement('span');
            badge.className   = 'cronos-ynum';
            badge.textContent = '1ª ⚠️';
            badge.style.cssText = 'font-size:0.6rem;font-weight:900;margin-left:5px;' +
                'background:#e67e22;color:#fff;padding:1px 4px;border-radius:3px;vertical-align:middle;';
            badge.title = 'Ya tiene 1ª amarilla — la siguiente = EXPULSIÓN';
            btnAmarilla.appendChild(badge);
        }
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

// toggleInjury() → player-actions.js

function assignCard(type) {
    if (!activeActionPlayerId) return;
    const p = players.find(x => x.id === activeActionPlayerId);
    if (!p) return;

    // Inicializar contador de amarillas (retrocompatibilidad)
    if (typeof p.yellowCards !== 'number') p.yellowCards = 0;

    // ── Jugador ya expulsado ──────────────────────────────────────────
    if (p.cards === 'roja') {
        alert(`⛔ ${p.name} ya está expulsado.`);
        closePlayerActionModal();
        return;
    }

    // ── TARJETA ROJA DIRECTA ─────────────────────────────────────────
    if (type === 'roja') {
        p.cards = 'roja';
        p.yellowCards = 0;
        logEvent(p, 'TARJETA ROJA');
        liveSyncOnAction();
        const limit = currentMode === 'f7' ? 3 : 5;
        if (p.status === 'field') {
            p.status = 'bench'; p.x = 0; p.y = 0;
            if (isRunning) logMovement(p);
        }
        const teamReds = players.filter(x => x.team === p.team && x.cards === 'roja').length;
        if (teamReds >= limit) {
            terminateMatch(`LÍMITE DE EXPULSIONES ALCANZADO (${limit} en ${p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away})`);
        } else {
            alert(`🟥 TARJETA ROJA: ${p.name} ha sido expulsado y retirado al banquillo automáticamente.`);
        }
        closePlayerActionModal();
        renderPlayers();
        return;
    }

    // ── TARJETA AMARILLA ─────────────────────────────────────────────
    if (type === 'amarilla') {

        // Toggle: quitar amarilla si ya la tiene Y no tiene segunda
        // (solo si yellowCards = 0, es decir se puso por error)
        if (p.cards === 'amarilla' && p.yellowCards <= 1) {
            // Segunda pulsación = SEGUNDA AMARILLA → EXPULSIÓN
            p.cards       = 'roja';
            p.yellowCards = 2;
            logEvent(p, 'DOBLE AMARILLA → EXPULSADO');
            liveSyncOnAction();
            if (p.status === 'field') {
                p.status = 'bench'; p.x = 0; p.y = 0;
                if (isRunning) logMovement(p);
            }
            alert(`🟨🟨 DOBLE AMARILLA: ${p.name} queda EXPULSADO automáticamente.`);
            closePlayerActionModal();
            renderPlayers();
            return;
        }

        // Primera amarilla → mantener modal abierto con aviso
        p.cards       = 'amarilla';
        p.yellowCards = 1;
        logEvent(p, 'TARJETA AMARILLA');
        liveSyncOnAction();
        renderPlayers();
        // NO cerrar modal - mostrar aviso de que la siguiente = expulsión
        const btnAm = document.querySelector('#player-action-modal .btn[onclick*="amarilla"]');
        if (btnAm) {
            const old2 = btnAm.querySelector('.cronos-ynum');
            if (old2) old2.remove();
            const badge = document.createElement('span');
            badge.className = 'cronos-ynum';
            badge.textContent = '1ª 🟨 → pulsa de nuevo para EXPULSAR';
            badge.style.cssText = 'display:block;margin-top:4px;font-size:0.65rem;font-weight:800;' +
                'background:#e67e22;color:#fff;padding:3px 6px;border-radius:4px;text-align:center;';
            btnAm.parentNode.insertBefore(badge, btnAm.nextSibling);
            btnAm.style.outline = '3px solid #f39c12';
            btnAm.style.boxShadow = '0 0 12px rgba(243,156,18,0.9)';
        }
        return;
    }

    // Cualquier otro tipo: flujo original
    p.cards = type;
    logEvent(p, type);
    liveSyncOnAction();
    closePlayerActionModal();
    renderPlayers();
}

function terminateMatch(reason) {
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    // Punto 2: limpiar el estado persistido para que el partido no quede
    // recuperable tras finalizar por expulsiones (misma corrección que endMatch).
    try {
        localStorage.removeItem('cronos_active_match_v2');
        localStorage.setItem('cronos_active_match_v2_finished', Date.now().toString());
    } catch (e) {}
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    stopLiveSync(); // marcar partido como finalizado en Firestore
    alert(`🏁 PARTIDO FINALIZADO: ${reason}\nResultado final: ${TEAM_NAMES.home} ${document.getElementById('score-home').textContent} - ${document.getElementById('score-away').textContent} ${TEAM_NAMES.away}`);
}

// ════════════════════════════════════════════════════════════════════
//  PERSISTENCIA DE PARTIDO EN CURSO
//  Guarda el estado completo cada 15 segundos y al abandonar la app.
//  Al reabrir, si hay un partido en curso, ofrece retomarlo.
// ════════════════════════════════════════════════════════════════════
const _ACTIVE_MATCH_KEY = 'cronos_active_match_v2';

function _saveMatchStateToStorage() {
    if (matchPhase === 'finished' || matchPhase === 'idle') return;
    try {
        const existingRaw = localStorage.getItem(_ACTIVE_MATCH_KEY);
        let createdAt = new Date().toISOString();
        if (existingRaw) {
            try {
                const parsed = JSON.parse(existingRaw);
                if (parsed && parsed.createdAt) createdAt = parsed.createdAt;
            } catch(e) {}
        }

        const state = {
            savedAt:      new Date().toISOString(),
            createdAt,
            matchPhase,
            isRunning,
            masterTimeH1: typeof masterTimeH1 !== 'undefined' ? masterTimeH1 : 0,
            masterTimeH2: typeof masterTimeH2 !== 'undefined' ? masterTimeH2 : 0,
            half1MaxTime: typeof half1MaxTime !== 'undefined' ? half1MaxTime : 1800,
            half2MaxTime: typeof half2MaxTime !== 'undefined' ? half2MaxTime : 1800,
            scoreHome:    document.getElementById('score-home')?.textContent || '0',
            scoreAway:    document.getElementById('score-away')?.textContent || '0',
            teamNames:    typeof TEAM_NAMES !== 'undefined' ? TEAM_NAMES : {},
            currentMode:  typeof currentMode !== 'undefined' ? currentMode : 'f7',
            liveMatchId:  typeof liveMatchId !== 'undefined' ? liveMatchId : null,
            players:      JSON.parse(JSON.stringify(window.players || [])),
            COLORS:       typeof COLORS !== 'undefined' ? COLORS : {},
            category:     document.getElementById('match-category')?.value || window._currentMatchCategory || '',
            extraGoals:   window._cronosExtraGoals || { home: 0, away: 0 },
        };
        localStorage.setItem(_ACTIVE_MATCH_KEY, JSON.stringify(state));
    } catch(e) { /* silencioso */ }
}
window._saveMatchStateToStorage = _saveMatchStateToStorage;

// Auto-guardar cada 5 segundos cuando hay partido activo
let autoSaveInterval = setInterval(() => {
    if (matchPhase !== 'finished' && matchPhase !== 'idle' && typeof players !== 'undefined' && players.length > 0) {
        _saveMatchStateToStorage();
    }
}, 5000);

function _checkActiveMatch() {
    if (localStorage.getItem('cronos_active_match_v2_finished')) {
        localStorage.removeItem(_ACTIVE_MATCH_KEY);
        localStorage.removeItem('cronos_active_match_v2_finished');
        return false;
    }
    try {
        const raw = localStorage.getItem(_ACTIVE_MATCH_KEY);
        if (!raw) return false;
        const state = JSON.parse(raw);
        if (!state || !state.savedAt) return false;
        if (state.matchPhase === 'finished') {
            localStorage.removeItem(_ACTIVE_MATCH_KEY);
            return false;
        }

        // Calcular límite dinámico según modalidad y categoría
        const mode = state.currentMode || 'f7';
        const cat = (state.category || '').toLowerCase();
        let limitMins = 80; // Fútbol 7 por defecto: 30 + 30 + 20 = 80 min

        if (mode === 'f11') {
            if (cat.includes('juvenil') || cat.includes('regional') || cat.includes('senior') || cat.includes('aficionado') || cat.includes('preferente') || cat.includes('primera') || cat.includes('segunda')) {
                limitMins = 120; // 45 + 45 + 30 = 120 min
            } else if (cat.includes('cadete') || cat.includes('infantil')) {
                limitMins = 110; // 40 + 40 + 30 = 110 min
            } else {
                limitMins = 120; // Default F-11: 45 + 45 + 30 = 120 min
            }
        } else {
            limitMins = 80; // F-7 / F-8: 30 + 30 + 20 = 80 min
        }

        const LIMIT_SEC = limitMins * 60;
        const startTimestamp = state.createdAt ? new Date(state.createdAt).getTime() : new Date(state.savedAt).getTime();
        const elapsedSec = (Date.now() - startTimestamp) / 1000;

        if (elapsedSec > LIMIT_SEC) {
            // Expiró el tiempo reglamentario de validez → cancelar
            _cancelInterruptedMatch(state);
            localStorage.removeItem(_ACTIVE_MATCH_KEY);
            return false;
        }

        // Hay partido recuperable — mostrar banner
        _showRestoreMatchBanner(state, elapsedSec, LIMIT_SEC);
        return true; // indica que se encontró partido activo

    } catch(e) { return false; }
}

function _cancelInterruptedMatch(state) {
    // Cortar retransmisión en vivo en Firestore
    try {
        const fa = window._cronos_auth;
        if (fa && fa.db && state.liveMatchId) {
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
                .then(({ doc, updateDoc }) => {
                    updateDoc(doc(fa.db, 'live_matches', state.liveMatchId), {
                        status:      'cancelled',
                        cancelledAt: new Date().toISOString(),
                        cancelReason: 'timeout_match_limit',
                    }).catch(() => {});
                });
        }
    } catch(e) { /* silencioso */ }
}

function _showRestoreMatchBanner(state, elapsedSec, limitSec) {
    // Quitar banner anterior si existe
    document.getElementById('cronos-restore-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'cronos-restore-banner';
    const mins    = Math.floor((state.masterTimeH1 + (state.masterTimeH2 || 0)) / 60);
    const secs    = (state.masterTimeH1 + (state.masterTimeH2 || 0)) % 60;
    const home    = state.teamNames?.home || 'Local';
    const away    = state.teamNames?.away || 'Visitante';
    const phase   = state.matchPhase === '1st_half' ? '1ª Parte' :
                    state.matchPhase === 'break'    ? 'Descanso' :
                    state.matchPhase === '2nd_half' ? '2ª Parte' : state.matchPhase;
    const remainSec = Math.max(0, limitSec - Math.floor(elapsedSec));
    const remMins   = Math.floor(remainSec / 60);
    const remSecs   = remainSec % 60;
    const elapsed   = Math.floor(elapsedSec / 60);

    banner.innerHTML = `
    <div style="position:fixed;top:0;left:0;right:0;z-index:99999;
                background:linear-gradient(135deg,#1a1200,#0d1117);
                border-bottom:3px solid #f0883e;
                padding:1rem 1.4rem;box-shadow:0 4px 24px rgba(240,136,62,0.3);">
        <div style="max-width:700px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;">
            <div style="display:flex;align-items:center;gap:0.8rem;">
                <span style="font-size:2rem;">🔄</span>
                <div>
                    <div style="font-size:1rem;font-weight:800;color:#f0883e;">
                        Partido interrumpido
                    </div>
                    <div style="font-size:0.82rem;color:white;font-weight:600;margin:1px 0;">
                        ${escapeHtml(home)} vs ${escapeHtml(away)} · ${escapeHtml(state.scoreHome||0)}–${escapeHtml(state.scoreAway||0)} · ${escapeHtml(phase)}
                    </div>
                    <div style="font-size:0.72rem;color:rgba(255,255,255,0.6);">
                        ⏱ ${mins}:${String(secs).padStart(2,'0')} jugados · cerrado hace ${elapsed} min
                        · <span id="cronos-restore-countdown" style="color:#f0883e;font-weight:700;">
                            ${remMins}:${String(remSecs).padStart(2,'0')} para cancelar
                          </span>
                    </div>
                </div>
            </div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                <button onclick="window._restoreActiveMatch()"
                    style="background:#f0883e;color:#000;border:none;border-radius:8px;
                           padding:0.6rem 1.4rem;font-weight:800;font-size:0.9rem;cursor:pointer;
                           box-shadow:0 2px 8px rgba(240,136,62,0.4);">
                    ▶ Retomar partido
                </button>
                <button onclick="window._discardActiveMatch()"
                    style="background:rgba(255,88,88,0.15);color:#ff5858;border:1px solid rgba(255,88,88,0.4);
                           border-radius:8px;padding:0.6rem 1.2rem;font-size:0.85rem;cursor:pointer;font-weight:700;">
                    ✕ Cancelar partido
                </button>
            </div>
        </div>
    </div>`;

    document.body.appendChild(banner);

    // Contador regresivo hasta que expire el tiempo de validez del partido
    const startTimestamp = state.createdAt ? new Date(state.createdAt).getTime() : new Date(state.savedAt).getTime();
    const endTime = startTimestamp + limitSec * 1000;
    const countdownEl = () => document.getElementById('cronos-restore-countdown');
    const tick = setInterval(() => {
        const rem = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        const el = countdownEl();
        if (!el) { clearInterval(tick); return; }
        if (rem <= 0) {
            clearInterval(tick);
            _cancelInterruptedMatch(state);
            localStorage.removeItem(_ACTIVE_MATCH_KEY);
            document.getElementById('cronos-restore-banner')?.remove();
            openSetupModal();
            if (typeof showToast === 'function')
                showToast('⏱ Partido cancelado automáticamente (Expiró validez reglamentaria)', 4000);
            return;
        }
        el.textContent = `${Math.floor(rem/60)}:${String(rem%60).padStart(2,'0')} para cancelar`;
    }, 1000);
}

window._discardActiveMatch = function() {
    const raw = localStorage.getItem(_ACTIVE_MATCH_KEY);
    if (raw) {
        try { _cancelInterruptedMatch(JSON.parse(raw)); } catch(e) {}
    }
    localStorage.removeItem(_ACTIVE_MATCH_KEY);
    document.getElementById('cronos-restore-banner')?.remove();
    // Solo abrir el panel de entrenador si no hay otro panel/modal ya abierto.
    // Evita cerrar el panel de Admin Individual, Club Admin o SA al cancelar un partido.
    const modal = document.getElementById('setup-modal');
    const modalVisible = modal && modal.style.display !== 'none' && modal.style.display !== '';
    if (!modalVisible) {
        openSetupModal();
    }
};

window._restoreActiveMatch = function() {
    try {
        const raw = localStorage.getItem(_ACTIVE_MATCH_KEY);
        if (!raw) return;
        const state = JSON.parse(raw);
        document.getElementById('cronos-restore-banner')?.remove();

        // Calcular tiempo real transcurrido si el partido estaba en curso
        let elapsedSec = 0;
        if (state.isRunning && state.savedAt) {
            elapsedSec = Math.max(0, Math.floor((Date.now() - new Date(state.savedAt).getTime()) / 1000));
        }

        matchPhase = state.matchPhase || '1st_half';

        if (typeof half1MaxTime !== 'undefined') half1MaxTime = state.half1MaxTime || 1800;
        if (typeof half2MaxTime !== 'undefined') half2MaxTime = state.half2MaxTime || 1800;

        let activeAddedSec = 0;
        let shouldAutoEndFirstHalf = false;
        let shouldAutoEndMatch = false;

        if (elapsedSec > 0) {
            if (matchPhase === '1st_half') {
                const limit1 = half1MaxTime + 900; // Reglamentario + 15 min de añadido
                const remaining = Math.max(0, limit1 - (state.masterTimeH1 || 0));
                activeAddedSec = Math.min(elapsedSec, remaining);
                if (elapsedSec >= remaining) {
                    shouldAutoEndFirstHalf = true;
                }
            } else if (matchPhase === '2nd_half') {
                const limit2 = half2MaxTime + 900; // Reglamentario + 15 min de añadido
                const remaining = Math.max(0, limit2 - (state.masterTimeH2 || 0));
                activeAddedSec = Math.min(elapsedSec, remaining);
                if (elapsedSec >= remaining) {
                    shouldAutoEndMatch = true;
                }
            }
        }

        // Restaurar variables globales y sumar tiempo transcurrido a los jugadores de campo
        if (typeof TEAM_NAMES !== 'undefined') {
            TEAM_NAMES.home = state.teamNames?.home;
            TEAM_NAMES.away = state.teamNames?.away;
        }

        const rawPlayers = state.players || [];
        window.players = rawPlayers.map(p => {
            if (activeAddedSec > 0 && p.status === 'field') {
                return { ...p, time: (p.time || 0) + activeAddedSec };
            }
            return p;
        });

        // Sumar el tiempo transcurrido al cronómetro correspondiente
        if (typeof masterTimeH1 !== 'undefined') {
            masterTimeH1 = state.masterTimeH1 || 0;
            masterTimeH2 = state.masterTimeH2 || 0;

            if (activeAddedSec > 0) {
                if (matchPhase === '1st_half') {
                    masterTimeH1 += activeAddedSec;
                } else if (matchPhase === '2nd_half') {
                    masterTimeH2 += activeAddedSec;
                }
            }
        }
        if (typeof half2MaxTime !== 'undefined') half2MaxTime = state.half2MaxTime || 1800;
        if (typeof liveMatchId  !== 'undefined') liveMatchId  = state.liveMatchId;
        if (typeof currentMode  !== 'undefined' && state.currentMode) currentMode = state.currentMode;

        // Restaurar categoría
        if (state.category) {
            window._currentMatchCategory = state.category;
            const catSelect = document.getElementById('match-category');
            if (catSelect) catSelect.value = state.category;
        }

        // Restaurar goles extra (No asignados)
        if (state.extraGoals) window._cronosExtraGoals = state.extraGoals;

        // Restaurar marcador
        const sh = document.getElementById('score-home');
        const sa = document.getElementById('score-away');
        if (sh) sh.textContent = state.scoreHome || '0';
        if (sa) sa.textContent = state.scoreAway || '0';

        // Mostrar el campo de partido (ocultar setup si estuviera abierto)
        const setupModal = document.getElementById('setup-modal');
        if (setupModal) setupModal.style.display = 'none';
        const mainContainer = document.getElementById('main-container');
        const mainHeader    = document.getElementById('main-header');
        if (mainContainer) mainContainer.style.display = 'flex';
        if (mainHeader)    mainHeader.style.display    = 'flex';

        // Re-renderizar jugadores
        if (typeof renderPlayers === 'function') renderPlayers();
        if (typeof updateTimerDisplay === 'function') updateTimerDisplay();

        // Reanudar el reloj o disparar auto-finalización
        if (shouldAutoEndFirstHalf) {
            if (typeof window.endFirstHalf === 'function') {
                window.endFirstHalf(true);
            }
        } else if (shouldAutoEndMatch) {
            if (typeof window.endMatch === 'function') {
                window.endMatch(true);
            }
        } else {
            // Si el partido estaba en una fase activa (1ª o 2ª parte), SIEMPRE reanudar.
            // El timer se puede haber parado por: INICIO, cambio de pestaña, cierre del navegador.
            // En todos los casos, "Retomar partido" debe continuar el cronómetro automáticamente.
            const shouldResume = (matchPhase === '1st_half' || matchPhase === '2nd_half');
            if (shouldResume) {
                isRunning = true;
                const btn = document.getElementById('btn-play-pause');
                if (btn) {
                    btn.textContent = 'PAUSAR';
                    btn.classList.add('danger');
                }
                lastTickTime = Date.now();
                clearInterval(timerInterval);
                timerInterval = setInterval(tick, 1000);
            } else {
                // Descanso u otro estado: no arrancar automáticamente
                isRunning = false;
                const btn = document.getElementById('btn-play-pause');
                if (btn) {
                    btn.textContent = 'REANUDAR';
                    btn.classList.remove('danger');
                }
                clearInterval(timerInterval);
            }
        }

        // Guardar estado local de inmediato
        _saveMatchStateToStorage();

        // ── Reactivar live sync si el partido tenía ID de transmisión ──
        if (state.liveMatchId && matchPhase !== 'finished') {
            liveMatchId  = state.liveMatchId;
            liveIsActive = true;
            if (liveSyncTimer) clearInterval(liveSyncTimer);
            liveSyncTimer = setInterval(() => {
                if (liveIsActive) pushLiveSnapshot('active');
            }, 5000);
            // Push inmediato para que live.html reciba el estado restaurado
            pushLiveSnapshot('active').catch(() => {});
            updateLiveButton(true);
        }

        if (typeof showToast === 'function') {
            if (shouldAutoEndFirstHalf) {
                showToast(`⚠️ La 1ª Parte ha finalizado automáticamente por tiempo transcurrido fuera`, 5000);
            } else if (shouldAutoEndMatch) {
                showToast(`🏁 El partido ha finalizado automáticamente por tiempo transcurrido fuera`, 5000);
            } else if (activeAddedSec > 0) {
                const mins = Math.floor(activeAddedSec / 60);
                const secs = activeAddedSec % 60;
                showToast(`✅ Partido retomado: +${mins}m ${secs}s transcurridos en tiempo real`, 5000);
            } else {
                showToast(`✅ Partido retomado exactamente en el minuto en que quedó`, 4000);
            }
        }

    } catch(e) {
        if (typeof showToast === 'function') showToast('⚠️ No se pudo retomar: ' + e.message, 4000);
        openSetupModal();
    }
};


function showPostMatchOptions(scoreHome, scoreAway) {
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(95vw,460px);padding:1.2rem;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">🏁</div>
        <h2 style="margin:0 0 0.2rem;color:white;font-size:1.1rem;">PARTIDO FINALIZADO</h2>
        <p style="font-size:1.2rem;color:#f0883e;font-weight:800;margin:0.5rem 0;">
            ${escapeHtml(TEAM_NAMES.home)} ${escapeHtml(scoreHome)} - ${escapeHtml(scoreAway)} ${escapeHtml(TEAM_NAMES.away)}
        </p>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.9rem;">
            ${new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
        </p>
        <!-- Fila 1: Enviar informes + Informes colectivos -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">
            <button onclick="document.getElementById('setup-modal').style.display='none'; if(typeof openUnifiedCommsMenu==='function') openUnifiedCommsMenu();"
                style="padding:0.65rem 0.4rem;background:rgba(210,168,255,0.12);border:1px solid rgba(210,168,255,0.3);
                       border-radius:10px;color:#d2a8ff;font-weight:700;cursor:pointer;font-size:0.75rem;line-height:1.4;">
                📊 ENVIAR<br>INFORMES
            </button>
            <button onclick="document.getElementById('setup-modal').style.display='none'; if(typeof openMisInformesColectivos==='function') openMisInformesColectivos();"
                style="padding:0.65rem 0.4rem;background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.3);
                       border-radius:10px;color:#58a6ff;font-weight:700;cursor:pointer;font-size:0.75rem;line-height:1.4;">
                📋 INFORMES<br>COLECTIVOS
            </button>
        </div>

        <!-- Fila 2: Informes individuales + Inicio -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">
            <button onclick="document.getElementById('setup-modal').style.display='none'; if(typeof openMisInformes==='function') openMisInformes();"
                style="padding:0.65rem 0.4rem;background:rgba(255,165,0,0.12);border:1px solid rgba(255,165,0,0.35);
                       border-radius:10px;color:#ffa500;font-weight:700;cursor:pointer;font-size:0.75rem;line-height:1.4;">
                📋 INFORMES<br>INDIVIDUALES
            </button>
            <button onclick="document.getElementById('setup-modal').style.display='none'; openSetupModal();"
                style="padding:0.65rem 0.4rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
                       border-radius:10px;color:var(--text-muted);font-weight:600;cursor:pointer;font-size:0.75rem;line-height:1.4;">
                🏠<br>INICIO
            </button>
        </div>

        <!-- Fila 3: Continuar partido — ancho completo -->
        <button onclick="document.getElementById('setup-modal').style.display='none';"
            style="width:100%;padding:0.75rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);
                   border-radius:10px;color:#3fb950;font-weight:700;cursor:pointer;font-size:0.9rem;">
            ⚽ CONTINUAR PARTIDO
        </button>

    </div>`;
}

// ── Ver partidos terminados ──
function deleteFinishedMatch(index) {
    if (!confirm('¿Estás seguro de que quieres eliminar este partido del historial?')) return;
    let saved = JSON.parse(localStorage.getItem('cronos_finished_matches') || '[]');
    saved.splice(index, 1);
    localStorage.setItem('cronos_finished_matches', JSON.stringify(saved));
    if (typeof showToast === 'function') showToast('🗑️ Partido eliminado', 3000);
    showFinishedMatches();
}
window.deleteFinishedMatch = deleteFinishedMatch;

function showFinishedMatches() {
    let saved = JSON.parse(localStorage.getItem('cronos_finished_matches') || '[]');
    
    // Auto-limpieza: mantener máximo 40 partidos por temporada
    if (saved.length > 40) {
        saved = saved.slice(0, 40);
        localStorage.setItem('cronos_finished_matches', JSON.stringify(saved));
    }

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    
    const listHtml = saved.length === 0
        ? '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No hay partidos terminados guardados.</p>'
        : saved.map((m, i) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.7rem 0.8rem;
                        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:0.5rem;">
                <div style="text-align:left;">
                    <div style="font-weight:700;color:white;font-size:0.9rem;">${escapeHtml(m.home)} ${escapeHtml(m.scoreHome)} - ${escapeHtml(m.scoreAway)} ${escapeHtml(m.away)}</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);">${new Date(m.date).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})} · ${escapeHtml(String(m.mode||'').toUpperCase())}</div>
                </div>
                <div style="display:flex; gap:0.4rem;">
                    <button onclick="loadFinishedMatch(${i});"
                        style="padding:0.35rem 0.8rem;background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.3);
                               border-radius:7px;color:#58a6ff;font-size:0.75rem;cursor:pointer;font-weight:700;">
                        VER
                    </button>
                    <button onclick="deleteFinishedMatch(${i});"
                        style="padding:0.35rem 0.6rem;background:rgba(255,88,88,0.12);border:1px solid rgba(255,88,88,0.3);
                               border-radius:7px;color:#ff5858;font-size:0.75rem;cursor:pointer;font-weight:700;">
                        🗑️
                    </button>
                </div>
            </div>`).join('');

    modal.innerHTML = `
    <div class="modal-content" style="width:min(95vw,480px);max-height:90vh;display:flex;flex-direction:column;padding:1.2rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
            <h2 style="margin:0;color:white;font-size:1.1rem;">📋 Partidos Terminados (Max 40)</h2>
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
    const extra = window._cronosExtraGoals ? (window._cronosExtraGoals[team] || 0) : 0;
    document.getElementById(`score-${team}`).textContent = total + extra;
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
        document.getElementById('action-player-name').innerHTML = `${escapeHtml(player.name)} <span style="font-size:0.8rem">✏️</span>`;
        renderPlayers();
    }
}

function editNumberFromModal() {
    if (!activeActionPlayerId) return;
    const player = players.find(p => p.id === activeActionPlayerId);
    const newNum = prompt(`Editar dorsal para ${player.name}:`, player.number);
    if (newNum !== null && !isNaN(newNum)) {
        player.number = newNum;
        document.getElementById('action-player-number').innerHTML = `Dorsal ${escapeHtml(player.number)} <span style="font-size:0.8rem">✏️</span>`;
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

// startDemo() → demo-tutorial.js

// ══════════════════════════════════════════════════════════════════
//  TUTORIAL INTERACTIVO
// ══════════════════════════════════════════════════════════════════

const TUTORIAL_STEPS = [
    {
        title: '👋 Bienvenido a Chronos Fútbol',
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

// startTutorial() → demo-tutorial.js

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


    } catch(e) { console.warn('cleanupStaleMatches:', e.message); }
}

// startLiveSync() / pushLiveSnapshot() / stopLiveSync() → js/match/live/sync.js
// v276 (unificación): estas 3 copias legacy estaban muertas por shadowing
// (firestore-sync.js las redefinía después). Eliminadas. Fuente única de
// verdad: js/match/live/sync.js (emite phaseStartedAt, timerThresholds,
// createdBy/coachEmail y colores por jugador; late 5000ms con guard).

function updateLiveButton(active) {
    let indicator = document.getElementById('live-status-indicator');
    if (!indicator) {
        // Crear el contenedor del indicador si no existe
        indicator = document.createElement('div');
        indicator.id = 'live-status-indicator';
        indicator.style.cssText =
            'display:none; align-items:center; gap:8px; padding:0.4rem 0.8rem; ' +
            'background:rgba(255,88,88,0.1); border:1px solid rgba(255,88,88,0.3); ' +
            'border-radius:20px; color:#ff5858; font-size:0.7rem; font-weight:800; ' +
            'letter-spacing:0.5px; transition:all 0.3s; margin-right: 8px;';
        
        // Insertar en la zona de acciones del header
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) headerActions.insertBefore(indicator, headerActions.firstChild);
        
        // Añadir estilos de animación si no existen
        if (!document.getElementById('live-pulse-style')) {
            const s = document.createElement('style');
            s.id = 'live-pulse-style';
            s.textContent = `
                @keyframes liveDotPulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.3); opacity: 0.5; }
                    100% { transform: scale(1); opacity: 1; }
                }
            `;
            document.head.appendChild(s);
        }
    }

    if (active) {
        indicator.style.display = 'inline-flex';
        indicator.innerHTML = `
            <span style="width:8px; height:8px; background:#ff5858; border-radius:50%; 
                         box-shadow:0 0 8px #ff5858; animation: liveDotPulse 1.5s ease-in-out infinite;"></span>
            EN VIVO
        `;
    } else {
        indicator.style.display = 'none';
    }

    // ELIMINAR el antiguo botón de compartir si existiera para no duplicar
    const oldBtn = document.getElementById('btn-live-share');
    if (oldBtn) oldBtn.remove();
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
                       <span>✅ ${escapeHtml(c.name || c.email)}</span>
                       <span style="display:flex;gap:0.3rem;">
                           ${c.phone ? `<a href="https://wa.me/${encodeURIComponent(c.phone)}?text=${encodeURIComponent('⚽ Partido en vivo: ' + liveUrl)}" target="_blank"
                               style="padding:2px 8px;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.4);
                                      border-radius:5px;color:#25d366;text-decoration:none;font-size:0.68rem;font-weight:700;">
                               📱 WA</a>` : ''}
                           ${c.email ? `<a href="mailto:${escapeAttr(c.email)}?subject=${encodeURIComponent('⚽ Partido en Vivo — ' + TEAM_NAMES.home + ' vs ' + TEAM_NAMES.away)}&body=${encodeURIComponent('Sigue el partido en tiempo real:\n' + liveUrl)}" target="_blank"
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

            <!-- Botones de compartir -->
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
        `⚽ *CHRONOS FÚTBOL — Partido en Vivo*\n` +
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
        `Necesitas estar registrado y autorizado en Chronos Fútbol para acceder.\n\n` +
        `Chronos Fútbol — Coach Assistant`);
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
        `_Chronos Fútbol_`);
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

// Llamar a pushLiveSnapshot en cada acción relevante del partido.
// NOTA: la versión con throttle (leading + trailing) vive en
// js/match/live/sync.js, que se carga DESPUÉS y sobrescribe esta.
// Esta copia conserva el comportamiento básico por si el orden de carga
// cambia, pero la activa en producción es la de sync.js.
function liveSyncOnAction() {
    if (liveIsActive) pushLiveSnapshot('active');
}
// _userRef() → firestore-storage.js

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

    } catch(e) {
        console.warn('startRealtimeSync error:', e.message);
    }
}

// stopRealtimeSync() → firestore-storage.js

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


// testWhatsApp() → firestore-storage.js


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
    loadEmailConfig();
    loadStaffConfig();
    setupEventListeners();

    if (!['director', 'coordinator', 'club_admin'].includes(role)) {
        // [P14] Banner flotante "Partido interrumpido" eliminado: la recuperacion
        // de partidos ya esta disponible dentro de openSetupModal() (boton
        // "RECUPERAR PARTIDO"), por lo que _checkActiveMatch() era redundante.
        // Las funciones _checkActiveMatch / _showRestoreMatchBanner se conservan,
        // solo se deja de invocarlas aqui.
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

            // Comprobar si hay actualización disponible cada vez que se abre la app
            reg.update().catch(() => {});

            reg.onupdatefound = () => {
                const newWorker = reg.installing;
                newWorker.onstatechange = () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // Nueva versión lista → guardar sesión y recargar automáticamente
                        sessionStorage.setItem('cronos_post_update', '1');
                        const toast = document.createElement('div');
                        toast.innerHTML = '🔄 Actualizando Chronos Fútbol…';
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
        .catch(err => { if (window._CRONOS_DEBUG) console.warn('SW Error:', err); });

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

// [v77-FIX] openSetupModal() eliminada — la versión canónica (con CONVOCATORIA,
// ENTRENAMIENTO, MIS INFORMES, RECUPERAR PARTIDO) está en setup-modal.js



// ══════════════════════════════════════════════════════════════════
//  PANEL DE ENTRENAMIENTO — Planificación Semanal
// ══════════════════════════════════════════════════════════════════
window._trWeekOffset = window._trWeekOffset || 0;

// openTrainingPanel() → training_panel.js

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
                <button class="btn" onclick="typeof openTrainingNotification==='function'?openTrainingNotification():null" style="padding:0.45rem 1.1rem; font-size:0.76rem; background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.4); color:var(--primary); font-weight:700;">📲 ENVIAR</button>
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

// openTrainingSendPanel() → training_panel.js

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
    msg += `\n_Chronos Fútbol_ ⚽`;
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
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(staff.coach1)}</span>
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
                                     overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.name)}</span>
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
                                <td><input type="number" class="r-num" value="${escapeAttr(p.number)}" style="width: 40px;"></td>
                                <td><input type="text" class="r-name" value="${escapeAttr(p.name)}"></td>
                                <td><input type="text" class="r-surname" value="${escapeAttr(p.surname)}"></td>
                                <td><input type="text" class="r-alias" value="${escapeAttr(p.alias)}"></td>
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
                        <input type="text" id="staff-coach1" value="${escapeAttr(staffConfig.coach1)}"
                               placeholder="Nombre del entrenador"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">2º Entrenador</label>
                        <input type="text" id="staff-coach2" value="${escapeAttr(staffConfig.coach2)}"
                               placeholder="Nombre del 2º entrenador"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">Delegado de Equipo</label>
                        <input type="text" id="staff-delegate" value="${escapeAttr(staffConfig.delegate)}"
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
                        <input type="text" id="staff-field-delegate" value="${escapeAttr(staffConfig.fieldDelegate)}"
                               placeholder="Dejar vacío si se juega fuera"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                </div>
            </div>

            <div style="margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 1rem;">
                <button class="btn" onclick="clearMasterRoster('${mode}')" style="background:rgba(255,88,88,0.15);color:#ff5858;border:1px solid rgba(255,88,88,0.5);margin-right:auto;">🗑️ BORRAR PLANTILLA</button>
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
//  CHRONOS FÚTBOL — Importación de plantilla con IA (Gemini Vision)
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
                                <td><input type="number" class="p-num" value="${escapeAttr(p.number || i+1)}"
                                    style="width:44px;"></td>
                                <td><input type="text" class="p-name" value="${escapeAttr(p.name || '')}"></td>
                                <td><input type="text" class="p-surname" value="${escapeAttr(p.surname || '')}"></td>
                                <td><input type="text" class="p-alias" value="${escapeAttr(p.alias || '')}"></td>
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

function clearMasterRoster(mode) {
    if (!confirm('¿Seguro que quieres borrar a TODOS los jugadores de la plantilla actual (' + (mode==='f7'?'F7':'F11') + ')?')) return;
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    roster[mode] = [];
    localStorage.setItem('cronos_master_roster', JSON.stringify(roster));
    if (typeof cloudSet === 'function') cloudSet('cronos_master_roster', JSON.stringify(roster));
    showToast('🗑️ Plantilla borrada');
    openRosterManager();
}

function openConvocationModal() {
    // Sincronizar currentMode desde el DOM por si se cambió en el setup sin confirmar
    const modeEl = document.getElementById('setup-mode');
    if (modeEl) currentMode = modeEl.value;

    document.body.classList.add('setup-mode');
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const maxConvoked = currentMode === 'f7' ? 14 : 18;
    const maxTitulares = currentMode === 'f7' ? 7 : 11;
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
                <h2 style="margin:0 0 0.1rem; font-size:${isMobile ? '1.1rem' : '1.4rem'};">\u{1F4CB} Convocatoria \u2014 ${escapeHtml(TEAM_NAMES.home)}</h2>
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
                            value="${escapeHtml(savedConv.venue||'')}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F19A} Rival</label>
                        <input type="text" id="conv-rival" class="conv-input"
                            placeholder="Equipo rival"
                            value="${escapeHtml(savedConv.rival||TEAM_NAMES.away||'')}">
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

            <!-- \u2500\u2500 CONTADORES EN TIEMPO REAL \u2500\u2500 -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-bottom:0.8rem;">
                <div id="conv-counter-conv" style="background:rgba(88,166,255,0.1); border:2px solid rgba(88,166,255,0.35);
                            border-radius:10px; padding:0.7rem 1rem; text-align:center;">
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:2px;">Convocados</div>
                    <div id="conv-num-conv" style="font-size:2.2rem; font-weight:900; color:var(--primary); line-height:1;">0</div>
                    <div style="font-size:0.6rem; color:var(--text-muted);">de ${maxConvoked} max</div>
                </div>
                <div id="conv-counter-tit" style="background:rgba(240,136,62,0.1); border:2px solid rgba(240,136,62,0.35);
                            border-radius:10px; padding:0.7rem 1rem; text-align:center;">
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:2px;">Titulares</div>
                    <div id="conv-num-tit" style="font-size:2.2rem; font-weight:900; color:#f0883e; line-height:1;">0</div>
                    <div style="font-size:0.6rem; color:var(--text-muted);">min ${minForMatch} · max ${maxTitulares}</div>
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
                            ${escapeHtml(p.alias||p.name||'J'+(i+1))}
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
                    <div style="display:flex; gap:0.4rem;">
                        <button class="btn" onclick="resetConvocationToZero()" title="Vacía la selección y borra el guardado. La próxima vez empieza desde cero."
                            style="padding:0.4rem 0.8rem; font-size:0.7rem; background:rgba(255,88,88,0.15); color:#ff5858; border:1px solid rgba(255,88,88,0.5); font-weight:700;">
                            ↺ PONER A CERO
                        </button>
                        <button class="btn" onclick="openSetupModal()" style="padding:0.4rem 0.8rem; font-size:0.7rem;">\u2190 VOLVER</button>
                    </div>
                </div>

                <div style="display:flex; gap:0.4rem;">
                    <button class="btn" onclick="saveConvData(); saveConvPlayers(); openConvocationMessage()"
                        style="flex:1; background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.4);
                               color:var(--primary); font-weight:700; font-size:0.8rem;">
                        📲 ENVIAR CONVOCATORIA
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
    const numConvEl = document.getElementById('conv-num-conv');
    const numTitEl  = document.getElementById('conv-num-tit');
    const counterConvBox = document.getElementById('conv-counter-conv');
    const counterTitBox  = document.getElementById('conv-counter-tit');
    const minTitulares = minForMatch; // Usar el valor definido arriba
    let convocados = 0;
    let titulares = 0;
    window._titularSelectionOrder = [];

    window.clearConvocation = () => {
        if (!confirm('¿Vaciar toda la selección de la convocatoria?')) return;
        convocados = 0;
        titulares = 0;
        window._titularSelectionOrder = [];
        document.querySelectorAll('.conv-row').forEach(row => {
            row.dataset.state = 'none';
            row.classList.remove('conv-selected');
            row.style.borderColor = 'transparent';
            row.style.background  = 'var(--glass)';
            row.style.boxShadow = 'none';
            const dot = row.querySelector('.conv-dot');
            if (dot) {
                dot.style.background  = 'rgba(255,255,255,0.1)';
                dot.style.borderColor = 'rgba(255,255,255,0.25)';
                dot.style.color = 'transparent';
                dot.textContent = '✓';
            }
            const badge = row.querySelector('.conv-status-badge');
            if (badge) badge.style.display = 'none';
        });
        updateConvCounters();
    };

    // ── Resetear convocatoria a cero + borrar el guardado ─────────────────────────
    window.resetConvocationToZero = () => {
        if (!confirm('\u00bfBorrar toda la convocatoria y empezar desde cero?\nEsto tambi\u00e9n eliminar\u00e1 la convocatoria guardada del \u00faltimo partido.')) return;
        localStorage.removeItem('cronos_last_conv');
        convocados = 0;
        titulares = 0;
        window._titularSelectionOrder = [];
        document.querySelectorAll('.conv-row').forEach(row => {
            row.dataset.state = 'none';
            row.classList.remove('conv-selected');
            row.style.borderColor = 'transparent';
            row.style.background  = 'var(--glass)';
            row.style.boxShadow   = 'none';
            const dot = row.querySelector('.conv-dot');
            if (dot) {
                dot.style.background  = 'rgba(255,255,255,0.1)';
                dot.style.borderColor = 'rgba(255,255,255,0.25)';
                dot.style.color       = 'transparent';
                dot.textContent       = '\u2713';
            }
            const badge = row.querySelector('.conv-status-badge');
            if (badge) badge.style.display = 'none';
        });
        updateConvCounters();
        if (typeof showToast === 'function') showToast('\u21ba Convocatoria puesta a cero', 2000);
    };

    // Función auxiliar para actualizar los contadores visuales
    function updateConvCounters() {
        if (numConvEl) numConvEl.textContent = convocados;
        if (numTitEl) numTitEl.textContent = titulares;
        // Color de fondo dinámico según estado
        if (counterConvBox) {
            counterConvBox.style.background = convocados > 0 ? 'rgba(88,166,255,0.2)' : 'rgba(88,166,255,0.1)';
        }
        if (counterTitBox) {
            const isValid = titulares >= minTitulares;
            counterTitBox.style.background = isValid ? 'rgba(240,136,62,0.2)' : 'rgba(240,136,62,0.1)';
            counterTitBox.style.borderColor = isValid ? 'rgba(240,136,62,0.6)' : 'rgba(240,136,62,0.35)';
        }
        // Mantener también el contador de texto plano
        if (countEl) {
            countEl.innerHTML = '<span style="color:var(--primary)">' + convocados + ' convocados</span> \u00b7 <span style="color:#f0883e;font-weight:700;">' + titulares + ' titulares</span>';
        }
        goBtn.disabled = titulares < minTitulares;
    }

    // ── Restaurar desde ÚLTIMA CONVOCATORIA GUARDADA (cronos_last_conv) ──────────────
    // Primera vez (sin datos): 0 convocados / 0 titulares — el entrenador empieza desde cero.
    // Después de IR AL PARTIDO o enviar mensajes: restaura la última selección guardada.
    // El botón "PONER A CERO" borra cronos_last_conv para empezar desde cero la próxima vez.
    const lastConv = JSON.parse(localStorage.getItem('cronos_last_conv') || 'null');
    if (lastConv && lastConv.mode === currentMode && Array.isArray(lastConv.players) && lastConv.players.length > 0) {
        myPlayers.forEach((p, i) => {
            const saved = lastConv.players.find(lp => lp.number == p.number);
            if (!saved || saved.convState === 'none') return;
            const row = document.querySelector(`.conv-row[data-index="${i}"]`);
            if (!row) return;

            let targetState = 'none';
            if (saved.convState === 'titular' && titulares < maxTitulares) {
                targetState = 'titular';
            } else if (saved.convState !== 'none' && convocados < maxConvoked) {
                targetState = 'convocado';
            }
            if (targetState === 'none') return;

            row.dataset.state = targetState;
            row.classList.add('conv-selected');
            const dot = row.querySelector('.conv-dot');
            const badge = row.querySelector('.conv-status-badge');

            if (targetState === 'titular') {
                row.style.borderColor = '#f0883e';
                row.style.background  = 'rgba(240,136,62,0.25)';
                row.style.boxShadow   = '0 0 12px rgba(240,136,62,0.3)';
                dot.style.background  = '#f0883e';
                dot.style.borderColor = '#f0883e';
                dot.style.color       = '#0a0e14';
                dot.textContent       = 'T';
                dot.style.fontWeight  = '900';
                badge.textContent     = 'TITULAR';
                badge.style.background = '#f0883e';
                badge.style.color     = '#0a0e14';
                badge.style.display   = 'inline';
                badge.style.fontWeight = '900';
                titulares++;
                window._titularSelectionOrder.push(i);
            } else {
                row.style.borderColor = 'var(--primary)';
                row.style.background  = 'rgba(88,166,255,0.12)';
                dot.style.background  = 'var(--primary)';
                dot.style.borderColor = 'var(--primary)';
                dot.style.color       = '#0a0e14';
                badge.textContent     = 'CONV';
                badge.style.background = 'var(--primary)';
                badge.style.color     = '#0a0e14';
                badge.style.display   = 'inline';
            }
            convocados++;
        });
        updateConvCounters();
    }

    // \u2500\u2500 Click handler: 3 estados (none \u2192 convocado \u2192 titular \u2192 none) \u2500\u2500
    document.querySelectorAll('.conv-row').forEach(row => {
        row.addEventListener('click', () => {
            const state = row.dataset.state;
            const dot = row.querySelector('.conv-dot');
            const badge = row.querySelector('.conv-status-badge');

            if (state === 'none') {
                // Estado 1: Seleccionar como CONVOCADO (azul)
                if (convocados >= maxConvoked) {
                    showToast('⚠️ Máximo ' + maxConvoked + ' convocados para Fútbol ' + (currentMode === 'f7' ? '7' : '11'), 2500);
                    return;
                }
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
                window._titularSelectionOrder.push(parseInt(row.dataset.index));
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
                const idx = parseInt(row.dataset.index);
                window._titularSelectionOrder = window._titularSelectionOrder.filter(i => i !== idx);
            }

            updateConvCounters();
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

    // Guardar snapshot completo de la convocatoria para restaurar en la próxima apertura
    const allRows = document.querySelectorAll('#conv-grid-container .conv-row');
    if (allRows.length > 0) {
        const convSnapshot = Array.from(allRows).map(row => {
            const p = myPlayers[parseInt(row.dataset.index)];
            return p ? { number: p.number, convState: row.dataset.state || 'none' } : null;
        }).filter(Boolean);
        localStorage.setItem('cronos_last_conv', JSON.stringify({
            mode: currentMode,
            players: convSnapshot,
            savedAt: Date.now()
        }));
    }
}

// ── IR AL PARTIDO (desde convocatoria con 3 estados: convocado/titular) ──
// ── Guard anti-reinicio: si hay un partido EN CURSO (descanso o parte
//    activa) guardado, evita que el flujo de "iniciar partido" lo borre
//    (marcador a 0-0, cronómetro a cero). Devuelve true si se debe ABORTAR
//    el inicio de un partido nuevo (porque el usuario eligió reanudar el
//    que ya estaba en marcha). Causa raíz del bug de "2ª parte se reinicia":
//    el técnico volvía a Configuración durante el descanso para hacer cambios
//    y al re-confirmar la convocatoria se ejecutaba el RESET GLOBAL.
function _guardAgainstMatchReset() {
    try {
        const raw = localStorage.getItem('cronos_active_match_v2');
        if (!raw) return false;
        const st = JSON.parse(raw);
        if (!st || !st.matchPhase) return false;
        const inProgress = (st.matchPhase === '1st_half' || st.matchPhase === 'break' || st.matchPhase === '2nd_half');
        if (!inProgress) return false;
        const hasProgress = (st.masterTimeH1 > 0) || (st.masterTimeH2 > 0) ||
                            (parseInt(st.scoreHome) > 0) || (parseInt(st.scoreAway) > 0) ||
                            (st.matchPhase === 'break') || (st.matchPhase === '2nd_half');
        if (!hasProgress) return false;
        const phaseTxt = st.matchPhase === 'break' ? 'DESCANSO' :
                         st.matchPhase === '2nd_half' ? '2ª PARTE' : '1ª PARTE';
        const sH = parseInt(st.scoreHome) || 0, sA = parseInt(st.scoreAway) || 0;
        const resume = confirm(
            '⚠️ Hay un PARTIDO EN CURSO sin finalizar (' + phaseTxt + ', ' + sH + '-' + sA + ').\n\n' +
            'Pulsa ACEPTAR para REANUDARLO conservando el marcador y el cronómetro.\n' +
            'Pulsa CANCELAR para EMPEZAR UN PARTIDO NUEVO (se perderá el marcador y el tiempo actuales).'
        );
        if (resume) {
            if (typeof window._restoreActiveMatch === 'function') window._restoreActiveMatch();
            return true; // abortar inicio de partido nuevo
        }
        return false; // el usuario aceptó empezar de cero
    } catch (e) {
        return false;
    }
}
window._guardAgainstMatchReset = _guardAgainstMatchReset;

function goToTitularSelection() {
    if (_guardAgainstMatchReset()) return;
    // ══ CRÍTICO: Quitar setup-mode PRIMERO que todo ══
    // Esto garantiza que aunque algo falle después, la pantalla no sea negra.
    document.body.classList.remove('setup-mode');

    try {
        saveConvData();
        saveConvPlayers();
    } catch(e) {
        console.warn('[goToTitularSelection] Error guardando datos de convocatoria:', e);
    }

    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const maxTitulares = currentMode === 'f7' ? 7 : 11;

    // Obtener todos los jugadores seleccionados (convocado o titular)
    const allRows = document.querySelectorAll('#conv-grid-container .conv-row[data-state="convocado"], #conv-grid-container .conv-row[data-state="titular"]');
    const matchPlayers = Array.from(allRows).map(r => {
        const p = myPlayers[parseInt(r.dataset.index)];
        const isTitular = r.dataset.state === 'titular';
        return p ? { 
            ...p, 
            initialStatus: isTitular ? 'field' : 'bench',
            titularOrder: isTitular ? window._titularSelectionOrder.indexOf(parseInt(r.dataset.index)) : 999
        } : null;
    }).filter(Boolean);

    const titularCount = matchPlayers.filter(p => p.initialStatus === 'field').length;

    const minTitulares = currentMode === 'f7' ? 5 : 7;
    const maxConvocados = currentMode === 'f7' ? 14 : 18;
    const minConvocados = currentMode === 'f7' ? 5 : 7;

    if (matchPlayers.length < minConvocados) {
        alert('Necesitas al menos ' + minConvocados + ' jugadores convocados para Fútbol ' + (currentMode === 'f7' ? '7' : '11') + '.\nActualmente tienes ' + matchPlayers.length + '.');
        return;
    }
    if (titularCount < minTitulares) {
        alert('Necesitas al menos ' + minTitulares + ' titulares (naranja) para iniciar el partido.\nActualmente tienes ' + titularCount + ' titulares.');
        return;
    }
    if (matchPlayers.length > maxConvocados) {
        alert('Máximo ' + maxConvocados + ' convocados para Fútbol ' + (currentMode === 'f7' ? '7' : '11') + '.\nActualmente tienes ' + matchPlayers.length + '.');
        return;
    }

    window.activeConvocation = matchPlayers;
    window._convokedPlayers = matchPlayers;

    // Guardar snapshot de la convocatoria para restaurarla en el próximo partido
    try {
        const rosterSnap = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
        const playersSnap = rosterSnap[currentMode] || [];
        const allConvRowsSnap = document.querySelectorAll('#conv-grid-container .conv-row');
        if (allConvRowsSnap.length > 0) {
            const convSnapshot = Array.from(allConvRowsSnap).map(row => {
                const p = playersSnap[parseInt(row.dataset.index)];
                return p ? { number: p.number, convState: row.dataset.state || 'none' } : null;
            }).filter(Boolean);
            localStorage.setItem('cronos_last_conv', JSON.stringify({
                mode: currentMode,
                players: convSnapshot,
                savedAt: Date.now()
            }));
        }
    } catch(e) {
        console.warn('[goToTitularSelection] Error guardando snapshot:', e);
    }

    // Asegurar que setup-mode está quitado (doble check)
    document.body.classList.remove('setup-mode');

    try {
        spawnInitialPlayers();
    } catch(e) {
        console.error('[goToTitularSelection] Error en spawnInitialPlayers:', e);
    }

    // Asegurar que la UI de partido es visible
    const mainHeader    = document.getElementById('main-header');
    const mainContainer = document.getElementById('main-container');
    const setupModal    = document.getElementById('setup-modal');
    if (mainHeader)    mainHeader.style.display    = 'flex';
    if (mainContainer) mainContainer.style.display = 'flex';
    if (setupModal)    setupModal.style.display    = 'none';

    // CRÍTICO: Aplicar formación ANTES de renderizar
    try {
        if (selectedFormationOnStart) {
            applyFormationPreset(selectedFormationOnStart);
        } else {
            console.warn('[FORMACIÓN] selectedFormationOnStart está vacío — no se aplica formación');
        }
    } catch(e) {
        console.error('[goToTitularSelection] Error aplicando formación:', e);
    }
    window.loadedTeamPlayers = {};

    // Renderizar jugadores
    try {
        renderPlayers();
    } catch(e) {
        console.error('[goToTitularSelection] Error en renderPlayers:', e);
    }
    
    // SINCRONIZAR UI DE TIEMPOS
    try {
        if (typeof updateMasterUI === 'function') {
            updateMasterUI();
        }
    } catch(e) {
        console.warn('[goToTitularSelection] Error en updateMasterUI:', e);
    }

    // Iniciar transmisión en vivo
    setTimeout(() => { try { startLiveSync(); } catch(e) { console.warn('[goToTitularSelection] Error en startLiveSync:', e); } }, 800);

    // Inyectar botones de scroll en banquillos
    try {
        injectBenchScrollButtons('bench-list');
        if (analyzeAway) injectBenchScrollButtons('bench-list-away');
    } catch(e) {
        console.warn('[goToTitularSelection] Error inyectando botones de scroll:', e);
    }
    
    try {
        renderStaffInBench();
    } catch(e) {
        console.warn('[goToTitularSelection] Error en renderStaffInBench:', e);
    }

    const pitch = document.getElementById('football-pitch');
    if (pitch) {
        pitch.addEventListener('click', () => closeDrawers());
        pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });
    }

    // ── Verificación final: si no hay jugadores, crear fallback ──
    if (!players || players.length === 0) {
        console.error('[goToTitularSelection] No se crearon jugadores — intentando fallback');
        const defaultCount = currentMode === 'f7' ? 7 : 11;
        const homeColors = typeof COLORS !== 'undefined' ? COLORS.home : { primary: '#58a6ff', shorts: '#ffffff', text: '#000000' };
        for (let i = 1; i <= defaultCount; i++) {
            players.push({
                id: i, number: i, name: 'Jugador ' + i,
                team: 'home', status: 'field',
                time: 0, color: homeColors.primary,
                shortsColor: homeColors.shorts,
                textColor: homeColors.text,
                history: [], goals: 0, cards: 'ninguna', x: 0, y: 0
            });
        }
        try { renderPlayers(); } catch(e2) { console.error('[goToTitularSelection] Error en renderPlayers fallback:', e2); }
    }

    // Triple check: setup-mode DEBE estar quitado
    document.body.classList.remove('setup-mode');
}
// startMatchFromTitularSelection() → import.js


function startMatchWithConvocation() {
    if (_guardAgainstMatchReset()) return;
    const _clubId = window._cronosCurrentUser?.clubId;
    if (_clubId) {
        Promise.resolve().then(async () => {
            try {
                const { db } = window._cronos_auth || {};
                const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                const snap = await getDoc(doc(db, 'clubs', _clubId));
                if (snap.exists()) {
                    const thresh = snap.data().timerThresholds;
                    if (thresh) window._clubTimerThresholds = thresh;
                }
            } catch(e) { /* no bloquear inicio de partido */ }
        });
    }
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

    // --- RESET GLOBAL MATCH STATE ---
    const scoreHomeEl = document.getElementById('score-home');
    const scoreAwayEl = document.getElementById('score-away');
    if (scoreHomeEl) scoreHomeEl.textContent = '0';
    if (scoreAwayEl) scoreAwayEl.textContent = '0';
    masterTimeH1 = 0;
    masterTimeH2 = 0;
    lastTickTime = Date.now(); // FIX: era 0, causaba deltaMs = ~1.7 billones en primer tick → congelamiento
    matchPhase = '1st_half';
    if (typeof window.matchEvents !== 'undefined') window.matchEvents = [];
    isRunning = false;
    if (typeof timerInterval !== 'undefined') clearInterval(timerInterval);
    const btnPlayPause = document.getElementById('btn-play-pause');
    if (btnPlayPause) {
        btnPlayPause.textContent = 'EMPEZAR';
        btnPlayPause.classList.remove('danger');
    }
    const phaseLabel = document.getElementById('match-phase-label');
    if (phaseLabel) {
        phaseLabel.textContent = '1ª PARTE';
    }
    // Clean lingering active match if it got stuck
    localStorage.removeItem('cronos_active_match_v2');
    // Limpiar la marca de finalización del partido anterior; si no, al recargar
    // _checkActiveMatch() borraría el snapshot de este partido nuevo (regresión).
    localStorage.removeItem('cronos_active_match_v2_finished');
    // Limpiar guards de informes de partidos anteriores
    Object.keys(localStorage)
        .filter(k => k.startsWith('cronos_reports_sent_'))
        .forEach(k => localStorage.removeItem(k));
    if (typeof liveMatchId !== 'undefined') liveMatchId = null;
    if (typeof liveIsActive !== 'undefined') liveIsActive = false;
    window._cronosLastDispatchedMatch = null;
    // --- END RESET ---

    document.body.classList.remove('setup-mode');
    spawnInitialPlayers();

    const mainHeader = document.getElementById('main-header');
    const mainContainer = document.getElementById('main-container');
    if (mainHeader) mainHeader.style.display = 'flex';
    if (mainContainer) mainContainer.style.display = 'flex';

    // CRÍTICO: Aplicar formación ANTES de renderizar
    if (selectedFormationOnStart) {
        applyFormationPreset(selectedFormationOnStart);
    }
    // Limpiar datos de equipo cargado ya aplicados
    window.loadedTeamPlayers = {};

    // Renderizar jugadores (las posiciones ya están asignadas por applyFormationPreset)
    renderPlayers();

    // Iniciar transmisión en vivo automáticamente (el director puede conectarse cuando quiera)
    setTimeout(() => startLiveSync(), 800);

    const setupModal = document.getElementById('setup-modal');
    if (setupModal) setupModal.style.display = 'none';

    // Inyectar botones de scroll en ambos banquillos
    injectBenchScrollButtons('bench-list');
    if (analyzeAway) injectBenchScrollButtons('bench-list-away');
    // Mostrar cuerpo técnico en el banquillo
    renderStaffInBench();

    const pitch = document.getElementById('football-pitch');
    if (pitch) {
        pitch.addEventListener('click', () => closeDrawers());
        pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });
    }
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

        // Cargar modalidad y actualizar formaciones/categorías con el modo correcto
        const teamMode = team.mode || 'f7';
        const modeEl = document.getElementById('setup-mode');
        if (modeEl) {
            modeEl.value = teamMode;
            currentMode = teamMode;
        }
        // Actualizar formaciones Y categorías con el modo del equipo guardado
        updateFormationOptions(teamMode);
        if (typeof updateCategoryOptions === 'function') updateCategoryOptions(teamMode);

        // Restaurar categoría guardada con el equipo
        if (team.category) {
            const catEl = document.getElementById('match-category');
            if (catEl) catEl.value = team.category;
        }

        if (team.formation) {
            const formEl = document.getElementById('setup-formation');
            if (formEl) formEl.value = team.formation;
        }

        // Guardar los jugadores de este equipo para restaurar convocatoria, titulares y suplentes
        // Guardar el objeto equipo completo (con flag hasMatchData)
        if (!window.loadedTeamPlayers) window.loadedTeamPlayers = {};
        window.loadedTeamPlayers[teamKey] = team;
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
        formation: activeFormationKey,    // sistema de juego activo
        hasMatchData: true                // Indica que esta es una convocatoria guardada
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

// ═══════════════════════════════════════════════════════════════════
// saveTeamSetup(teamKey) — Guardar equipo desde el panel de configuración
// ═══════════════════════════════════════════════════════════════════
function saveTeamSetup(teamKey) {
    const nameEl = document.getElementById('setup-' + teamKey + '-name');
    const colorEl = document.getElementById('setup-' + teamKey + '-color');
    const shortsEl = document.getElementById('setup-' + teamKey + '-shorts');
    const textEl = document.getElementById('setup-' + teamKey + '-text');
    if (!nameEl) return;

    const teamName = (nameEl.value || '').trim();
    if (!teamName || teamName === 'LOCAL' || teamName === 'VISITANTE') {
        showToast('⚠️ Escribe un nombre para el equipo antes de guardar.', 3000);
        nameEl.focus();
        return;
    }

    const newTeam = {
        name:         teamName,
        color:        colorEl ? colorEl.value : '#58a6ff',
        shortsColor:  shortsEl ? shortsEl.value : '#ffffff',
        textColor:    textEl ? textEl.value : '#ffffff',
        mode:         (typeof currentMode !== 'undefined') ? currentMode : 'f7',
        category:     document.getElementById('match-category')?.value || '',
        players:      [],
        savedAt:      new Date().toISOString(),
    };

    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const existingIdx = teams.findIndex(t => t.name === teamName);

    if (existingIdx >= 0) {
        if (!confirm('Ya existe el equipo «' + teamName + '». ¿Sobrescribir?')) return;
        teams[existingIdx] = { ...teams[existingIdx], ...newTeam };
    } else {
        if (teams.length >= 20) { showToast('⚠️ Límite de 20 equipos guardados.', 3000); return; }
        teams.push(newTeam);
    }

    cloudSet('cronos_teams', JSON.stringify(teams));
    populateSavedTeams('home');
    populateSavedTeams('away');
    showToast('✅ Equipo «' + teamName + '» guardado correctamente.', 3000);
}

// ═══════════════════════════════════════════════════════════════════
// deleteTeamSetup(teamKey) — Eliminar el equipo actualmente cargado
// ═══════════════════════════════════════════════════════════════════
function deleteTeamSetup(teamKey) {
    const nameEl = document.getElementById('setup-' + teamKey + '-name');
    const teamName = (nameEl ? nameEl.value : '').trim();
    if (!teamName || teamName === 'LOCAL' || teamName === 'VISITANTE') {
        showToast('⚠️ Primero carga un equipo guardado para poder eliminarlo.', 3000);
        return;
    }
    if (!confirm('¿Eliminar el equipo «' + teamName + '» de los equipos guardados?')) return;

    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const idx = teams.findIndex(t => t.name === teamName);
    if (idx < 0) { showToast('⚠️ Equipo no encontrado en los guardados.', 3000); return; }

    teams.splice(idx, 1);
    cloudSet('cronos_teams', JSON.stringify(teams));
    populateSavedTeams('home');
    populateSavedTeams('away');

    // Limpiar el campo nombre
    if (nameEl) nameEl.value = teamKey === 'home' ? 'LOCAL' : 'VISITANTE';
    showToast('🗑️ Equipo «' + teamName + '» eliminado.', 3000);
}

// ═══════════════════════════════════════════════════════════════════
// deleteTeamFromDropdown(teamKey) — Eliminar el equipo seleccionado
//   en el desplegable "Cargar Guardado" (botón ✕ junto al select)
// ═══════════════════════════════════════════════════════════════════
function deleteTeamFromDropdown(teamKey) {
    const dropdown = document.getElementById('saved-teams-' + teamKey);
    if (!dropdown || dropdown.value === '') {
        showToast('⚠️ Selecciona un equipo del desplegable para eliminarlo.', 3000);
        return;
    }
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const idx = parseInt(dropdown.value);
    if (isNaN(idx) || !teams[idx]) { showToast('⚠️ Equipo no encontrado.', 3000); return; }

    const teamName = teams[idx].name;
    if (!confirm('¿Eliminar el equipo «' + teamName + '»?')) return;

    teams.splice(idx, 1);
    cloudSet('cronos_teams', JSON.stringify(teams));
    populateSavedTeams('home');
    populateSavedTeams('away');
    showToast('🗑️ Equipo «' + teamName + '» eliminado.', 3000);
}

// -- setupEventListeners y spawnInitialPlayers ELIMINADAS --------
// C-19/C-20: definidas CANONICAMENTE en js/core/event-listeners.js.
// Esa version (la ultima en cargarse) contiene todos los FIX:
// recuperacion de drift con guardas de lastTickTime, handlers
// pagehide/beforeunload, _saveMatchStateToStorage y el reseteo de
// window._cronosExtraGoals. Se elimina la copia obsoleta de aqui
// para que exista UNA sola definicion y el comportamiento NO
// dependa del orden de los <script>.
// -----------------------------------------------------------------


// ── FUNCIONES DE TIMER/UI ELIMINADAS ──────────────────────────────
// updateMasterUI, showSpinner, hideSpinner, showToast, formatTime
// — Definidas CANÓNICAMENTE en js/match/timer/core.js (con sync server
//   cada 5s y RenderOptimizer). Carga DESPUÉS de app-init.js, por lo
//   que sus versiones mejoradas sobrescriben estas.
//   Se eliminan para evitar confusión de mantenimiento y asegurar que
//   solo existe UNA definición de cada función.
// ───────────────────────────────────────────────────────────────────

// --- RENDER ---

function renderPlayers() {
    const pitch = document.getElementById('football-pitch');
    const benchHome = document.getElementById('bench-list');
    const benchAway = document.getElementById('bench-list-away');

    if (!pitch || !benchHome) return;

    pitch.querySelectorAll('.player-chip').forEach(c => c.remove());
    benchHome.innerHTML = '';
    if (benchAway) benchAway.innerHTML = '';

    players.forEach(p => {
        const chip = createPlayerChip(p);
        if (p.status === 'field') {
            pitch.appendChild(chip);
            placeOnField(chip, p);
        } else {
            if (p.team === 'home') benchHome.appendChild(chip);
            else if (benchAway) benchAway.appendChild(chip);
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
    if (player.cards === 'amarilla') {
        const yNum = (player.yellowCards || 1);
        indicatorsHTML += `<div class="player-card-indicator amarilla" style="position:relative;">` +
            `<span style="position:absolute;top:-5px;right:-5px;background:#e67e22;color:#fff;` +
            `border-radius:50%;font-size:0.5rem;font-weight:900;width:13px;height:13px;` +
            `line-height:13px;text-align:center;border:1px solid #fff;">${yNum}</span></div>`;
    } else if (player.cards === 'roja') {
        const expReason = (player.yellowCards === 2) ? '2🟨' : '🟥';
        indicatorsHTML += `<div class="player-card-indicator roja" style="position:relative;">` +
            `<span style="position:absolute;top:-5px;right:-5px;background:#c0392b;color:#fff;` +
            `border-radius:50%;font-size:0.45rem;font-weight:900;width:13px;height:13px;` +
            `line-height:13px;text-align:center;border:1px solid #fff;">${expReason}</span></div>`;
    }

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
        <div class="player-number" style="color: ${escapeAttr(player.textColor || '#ffffff')}; pointer-events: none;">${escapeHtml(player.number)}</div>
        <div class="player-name" style="pointer-events: none;">${escapeHtml(player.name)}${injuredLabel}</div>
        ${indicatorsHTML}
    `;

    // Aplicar color semáforo al cronómetro desde el primer render
    const _timerEl = div.querySelector('.player-timer');
    if (_timerEl && typeof getTimerColor === 'function') {
        const _col = getTimerColor(player.time || 0);
        _timerEl.style.background = _col.bg;
        _timerEl.style.color      = _col.text;
        _timerEl.style.fontWeight = '800';
        _timerEl.style.fontSize   = _col.fontSize || '0.8rem';
        _timerEl.style.minWidth   = '46px';
        _timerEl.style.padding    = '1px 4px';
        _timerEl.style.borderRadius = '4px';
    }

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
        // CRÍTICO: Ordenar por selección o dorsal para asignar posiciones correctas de la formación.
        const fieldPlayers = players
            .filter(p => p.status === 'field' && p.team === player.team)
            .sort((a, b) => {
                if (a.titularOrder !== undefined && b.titularOrder !== undefined) return a.titularOrder - b.titularOrder;
                return (a.number || 0) - (b.number || 0);
            });
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
        if (timerDiv) {
            timerDiv.textContent = formatTime(player.time);
            // Aplicar color semáforo al cronómetro
            const col = getTimerColor(player.time);
            timerDiv.style.background    = col.bg;
            timerDiv.style.color         = col.text;
            timerDiv.style.fontWeight    = '800';
            timerDiv.style.fontSize      = col.fontSize || '0.8rem';
            timerDiv.style.minWidth      = '46px';
            timerDiv.style.padding       = '1px 4px';
            timerDiv.style.borderRadius  = '4px';
            timerDiv.style.textAlign     = 'center';
        }
    }
}

// ── Semáforo de tiempo jugado ─────────────────────────────────────────
// Verde  → jugador ha superado la mitad del partido
// Amarillo → ha superado 1/3 pero no la mitad
// Rojo   → no ha llegado al tercio mínimo
// Los umbrales se calculan desde half1MaxTime + half2MaxTime (segundos)
function getTimerColor(timeSec) {
    // v220: fallback consistente con live.html. Antes el coach siempre caia
    // a 1800+1800=3600 aunque el modo fuese F11 (deberia ser 2400+2400=4800).
    // Esto causaba que un jugador con, p.ej., 1800s saliese VERDE en el
    // coach (>=50% de 3600) pero AMARILLO en el live (>=33% pero <50% de 4800).
    const _f7Default  = 1800;
    const _f11Default = 2400;
    const _isF11 = (typeof currentMode !== 'undefined' && currentMode === 'f11');
    const _def = _isF11 ? _f11Default : _f7Default;
    const totalSec  = (half1MaxTime || _def) + (half2MaxTime || _def);
    const t = window._clubTimerThresholds || {};
    const redSec    = totalSec * ((t.red    ?? 33) / 100);
    const yellowSec = totalSec * ((t.yellow ?? 50) / 100);
    if (timeSec >= yellowSec) {
        return { bg: '#2ea043', text: '#000000', fontSize: '0.8rem' };
    } else if (timeSec >= redSec) {
        return { bg: '#e3b341', text: '#000000', fontSize: '0.8rem' };
    } else {
        return { bg: '#da3633', text: '#ffffff', fontSize: '0.8rem' };
    }
}

// allowDrop() → drag-drop.js

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

// toggleBench() → drag-drop.js

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

// handleSmartSwap() → js/ui/drag-drop.js (fuente canónica)
// logMovement()     → js/ui/drag-drop.js (fuente canónica)
// Auditoría Parte 2: estas dos copias estaban MUERTAS por shadowing
// (drag-drop.js carga después en index.html y siempre gana). La versión de
// drag-drop.js soporta el 3er argumento forcedSubId (cambio grupal desde
// render.js) y registra los eventos sub_in/sub_out en Firestore (v230/v240),
// cosas que estas copias NO hacían. Eliminadas para evitar que un
// reordenamiento de <script> reactivara la versión vieja e incompleta.

function logEvent(player, eventType) {
    // Registra gol, tarjeta o lesión con el minuto exacto
    const elapsed = matchPhase === '2nd_half' ? (masterTimeH1 + masterTimeH2) : masterTimeH1;
    const timestamp = formatTime(elapsed);
    const halfLabel = matchPhase === '1st_half' ? '1ªP' : matchPhase === '2nd_half' ? '2ªP' : 'DESC';
    player.history.push(`${eventType} a las ${timestamp} (${halfLabel})`);
}

// exportData() → movement-log.js




// ══════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — Panel SuperAdmin v3

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ✏️  DATOS DEL SUPERADMINISTRADOR — Rellenar antes de publicar
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SA_CONFIG = {
    nombre:      'TU_NOMBRE_O_NOMBRE_COMERCIAL',   // ej: "José · Chronos Fútbol"
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
          <div style="font-size:1.2rem;font-weight:700;">⚙️ SuperAdmin · Chronos Fútbol</div>
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
        <button class="sa-tab" onclick="saBilling()" style="color:#3fb950;background:rgba(63,185,80,0.08);border-color:rgba(63,185,80,0.3);">💰 Facturación</button>
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
                border-radius:6px;margin-top:0.4rem;">📝 ${escapeHtml(cl.notes)}</div>` : ''}
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
            <h3 style="margin:0;font-size:1rem;">✏️ ${escapeHtml(cl.name||clubId)}</h3>
          </div>
          <div class="sa-g2" style="margin-bottom:0.9rem;">
            <div><label class="sa-label">Nombre del club</label>
                <input class="sa-input" id="ec-name" value="${escapeHtml(cl.name||'')}"></div>
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
            <textarea class="sa-input" id="ec-notes" rows="2" style="resize:vertical;">${escapeHtml(cl.notes||'')}</textarea>
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
                ➕ Añadir administrador individual</button>
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
                ${(u.displayName||((u.firstName||'')+(u.lastName?' '+u.lastName:'')).trim())||u.email||u._id}
                <span style="font-weight:400;color:var(--text-muted);font-size:0.8rem;margin-left:0.3rem;">${u.email||''}</span>
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
                📝 ${escapeHtml(u.notes)}</div>`:''}
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
            <h3 style="margin:0;font-size:1rem;">${uid ? '✏️ Editar administrador individual' : '➕ Nuevo administrador individual'}</h3>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.7rem;">
            <div><label class="sa-label">Email *</label>
                <input class="sa-input" id="iu-email" type="email" value="${escapeHtml(u.email||'')}"></div>
            <div><label class="sa-label">Nombre</label>
                <input class="sa-input" id="iu-name" value="${escapeHtml(u.displayName||'')}"></div>
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
                <textarea class="sa-input" id="iu-notes" rows="2" style="resize:vertical;">${escapeHtml(u.notes||'')}</textarea></div>
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
        if (cl.timerThresholds) window._clubTimerThresholds = cl.timerThresholds; // ponytail: umbrales del director
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
        `Chronos Fútbol — Aviso de renovación · ${name}`
    );

    const body = encodeURIComponent(
`Hola,

Te contacto en relación a tu plan de Chronos Fútbol para el club "${name}".

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
`Hola 👋 te escribo desde Chronos Fútbol.

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
//  CHRONOS FÚTBOL — Envío de convocatoria por WhatsApp / Email
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

    msg += `_Chronos Fútbol_ ⚽`;
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

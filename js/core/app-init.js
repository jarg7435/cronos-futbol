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
// El estado lo declara js/core/staff-and-comms.js como window.staffConfig, que
// es quien lo lee y lo escribe de verdad. NO redeclararlo aqui con const/let:
// app-init.js carga el PRIMERO y una declaracion lexica de nivel superior vive
// en el registro DECLARATIVO del ambito global, que se resuelve ANTES que
// window; el resultado serian DOS objetos distintos y el de window se quedaria
// vacio para siempre. Guardado por scripts/test_admin_shared_constants.js.

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

// clampToField() -> js/roster/formations.js (fuente canonica)

// Actualiza el <select> de formación según la modalidad elegida
// updateFormationOptions() -> js/roster/formations.js (fuente canonica)

// updateCategoryOptions() -> js/roster/formations.js (fuente canonica)

// --- APLICAR FORMACIÓN ---
// applyFormationPreset() -> js/roster/formations.js (fuente canonica)

// --- PLAYER ACTION MODAL ---
let activeActionPlayerId = null;

// -- Copias muertas eliminadas el 2026-07-28 (Fase A del monolito #5):
//    las acciones de jugador viven en js/match/events/player-actions.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js


// toggleInjury() → player-actions.js



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

async function showFinishedMatches() {
    // Verificar extra partidos_terminados
    const _ptMe = window._cronosCurrentUser;
    const _ptExtras = (_ptMe && _ptMe.extras) || {};
    if (_ptExtras.partidos_terminados === false) {
        if (typeof showToast === 'function') showToast('🔒 Partidos Terminados no disponible en tu plan', 3500);
        else alert('No disponible en tu plan');
        return;
    }

    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(95vw,600px);max-height:90vh;display:flex;flex-direction:column;padding:1.2rem;background:#0d1117;color:white;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:0.8rem;">
            <h2 style="margin:0;color:white;font-size:1.1rem;display:flex;align-items:center;gap:0.5rem;">
                🎬 Partidos Terminados
            </h2>
            <button onclick="document.getElementById('setup-modal').style.display='none';"
                style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
        </div>
        <div id="finished-matches-modal-list" style="flex:1;overflow-y:auto;">
            <div style="text-align:center;padding:2rem;color:#7d8590;">⏳ Cargando partidos finalizados…</div>
        </div>
    </div>`;

    const listEl = document.getElementById('finished-matches-modal-list');
    const me = window._cronosCurrentUser;
    const clubId = me?.clubId;

    try {
        const { db, collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const _db = window._cronos_auth?.db || db;

        const finishedMap = new Map();

        // 1. Cargar desde live_matches
        try {
            const snapLive = await getDocs(collection(_db, 'live_matches'));
            snapLive.forEach(d => {
                const data = d.data() || {};
                const isMyMatch = !me || data.createdBy === me.uid || data.coachEmail === me.email || (!clubId || data.clubId === clubId);
                if (isMyMatch && (data.status === 'finished' || data.phase === 'finished' || data.matchPhase === 'finished')) {
                    finishedMap.set(d.id, { id: d.id, source: 'live_matches', ...data });
                }
            });
        } catch(e1) { console.warn('Error live_matches:', e1); }

        // 2. Cargar desde cronos_player_reports
        try {
            const snapReports = await getDocs(collection(_db, 'cronos_player_reports'));
            snapReports.forEach(d => {
                const data = d.data() || {};
                const isMyReport = !me || data.coachUid === me.uid || data.parentUid === me.uid || (!clubId || data.clubId === clubId);
                const isCollective = data.staffReport === true || data.type === 'collective_match_report' || data.reportType === 'collective';
                if (isMyReport && isCollective) {
                    const idKey = data.liveMatchId || d.id;
                    if (!finishedMap.has(idKey)) {
                        finishedMap.set(idKey, {
                            id: idKey,
                            docId: d.id,
                            source: 'cronos_player_reports',
                            homeTeam: { name: data.homeName || data.homeTeam || 'LOCAL', score: data.scoreHome ?? data.goalsHome ?? 0 },
                            awayTeam: { name: data.awayName || data.awayTeam || 'VISITANTE', score: data.scoreAway ?? data.goalsAway ?? 0 },
                            category: data.category || '',
                            subcategory: data.subcategory || '',
                            createdAt: data.createdAt || data.timestamp || 0,
                            events: data.events || data.timeline || [],
                            players: data.players || [],
                            mode: data.mode || 'f7',
                            ...data
                        });
                    }
                }
            });
        } catch(e2) { console.warn('Error cronos_player_reports:', e2); }

        let matches = Array.from(finishedMap.values());

        // ── ENRIQUECIMIENTO RETROACTIVO DE CATEGORÍAS ─────────────────────
        try {
            const coachCatMap = new Map();
            if (me) {
                const meCat = me.category || me._activeRoleData?.category || me.categoryLabel || '';
                const meSub = me.subcategory || me._activeRoleData?.subcategory || '';
                if (meCat || meSub) {
                    if (me.uid) coachCatMap.set(me.uid, { category: meCat, subcategory: meSub });
                    if (me.email) coachCatMap.set(me.email, { category: meCat, subcategory: meSub });
                }
            }
            const unassignedMatches = matches.filter(m => !m.category);
            if (unassignedMatches.length > 0) {
                const usersSnap = await getDocs(collection(_db, 'users')).catch(() => null);
                if (usersSnap) {
                    usersSnap.forEach(ud => {
                        const uData = ud.data() || {};
                        const cat = uData.category || uData._activeRoleData?.category || uData.categoryLabel || '';
                        const sub = uData.subcategory || uData._activeRoleData?.subcategory || '';
                        if (cat || sub) {
                            coachCatMap.set(ud.id, { category: cat, subcategory: sub });
                            if (uData.email) coachCatMap.set(uData.email, { category: cat, subcategory: sub });
                            if (uData.uid) coachCatMap.set(uData.uid, { category: cat, subcategory: sub });
                        }
                    });
                }
                const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                unassignedMatches.forEach(m => {
                    const info = coachCatMap.get(m.createdBy) || coachCatMap.get(m.coachUid) || coachCatMap.get(m.coachEmail);
                    if (info && (info.category || info.subcategory)) {
                        m.category = m.category || info.category;
                        m.subcategory = m.subcategory || info.subcategory;
                        const colName = m.source === 'live_matches' ? 'live_matches' : 'cronos_player_reports';
                        const targetId = m.docId || m.id;
                        if (targetId && updateDoc && doc) {
                            updateDoc(doc(_db, colName, targetId), {
                                category: m.category,
                                subcategory: m.subcategory
                            }).catch(() => {});
                        }
                    }
                });
            }
        } catch(e) { console.warn('Error enriquecimiento retroactivo modal:', e); }

        matches.sort((a, b) => {
            const tsA = typeof a.createdAt === 'number' ? a.createdAt : (a.createdAt?.toMillis?.() || 0);
            const tsB = typeof b.createdAt === 'number' ? b.createdAt : (b.createdAt?.toMillis?.() || 0);
            return tsB - tsA;
        });

        // ── Normalizadores ────────────────────────────────────────────────
        const _normCat = (c) => {
            if (!c) return '';
            let str = String(c).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (str.includes('prebenj')) return 'prebenjamin';
            if (str.includes('benj')) return 'benjamin';
            if (str.includes('alev')) return 'alevin';
            if (str.includes('infant')) return 'infantil';
            if (str.includes('cadet')) return 'cadete';
            if (str.includes('juven')) return 'juvenil';
            if (str.includes('region')) return 'regional';
            return str.replace(/_[abc]$/, '');
        };
        const _normSub = (s, c) => {
            let sub = String(s || '').trim().toUpperCase();
            if (!sub && c) {
                const m = String(c).match(/_([abc])$/i);
                if (m) sub = m[1].toUpperCase();
            }
            return sub;
        };

        const activeRole = me?._activeRole || me?.role;
        const isCoach = (activeRole === 'user' || activeRole === 'coach');

        if (isCoach) {
            const coachCat = _normCat(me?.category || me?._activeRoleData?.category || me?.categoryLabel);
            const coachSub = _normSub(me?.subcategory || me?._activeRoleData?.subcategory, me?.category);

            matches = matches.filter(m => {
                const isMyDoc = m.createdBy === me?.uid || m.coachUid === me?.uid || m.coachEmail === me?.email;
                if (isMyDoc) return true;
                const mCat = _normCat(m.category);
                const mSub = _normSub(m.subcategory, m.category);
                if (coachCat && mCat === coachCat) {
                    if (!coachSub || !mSub || mSub === coachSub) return true;
                }
                return false;
            });
        }

        if (matches.length === 0) {
            listEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No hay partidos terminados guardados para tu categoría.</p>';
            return;
        }

        const _renderItem = m => {
            const homeName = m.homeTeam?.name || m.homeName || (typeof m.homeTeam === 'string' ? m.homeTeam : 'LOCAL');
            const awayName = m.awayTeam?.name || m.awayName || (typeof m.awayTeam === 'string' ? m.awayTeam : 'VISITANTE');
            const scoreHome = m.homeTeam?.score ?? m.scoreHome ?? m.goalsHome ?? 0;
            const scoreAway = m.awayTeam?.score ?? m.scoreAway ?? m.goalsAway ?? 0;
            const cat = (m.category || 'Fútbol').toUpperCase();
            const sub = m.subcategory ? `Grupo ${m.subcategory}` : '';
            const eventsCount = Array.isArray(m.events) ? m.events.length : 0;
            const dateStr = m.matchDate || (m.createdAt ? (typeof m.createdAt === 'number' ? new Date(m.createdAt).toLocaleDateString('es-ES') : new Date(m.createdAt.seconds * 1000).toLocaleDateString('es-ES')) : '—');

            return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:0.8rem 1rem;background:rgba(255,255,255,0.03);border:1px solid rgba(121,192,255,0.2);border-radius:10px;margin-bottom:0.6rem;gap:1rem;">
                    <div>
                        <div style="font-weight:800;color:white;font-size:0.9rem;">${escapeHtml(homeName)} ${scoreHome} - ${scoreAway} ${escapeHtml(awayName)}</div>
                        <div style="font-size:0.72rem;color:#7d8590;margin-top:2px;">
                            ${escapeHtml(cat)} ${escapeHtml(sub)} · 📅 ${escapeHtml(dateStr)} ${eventsCount > 0 ? `· 📍 ${eventsCount} eventos` : ''}
                        </div>
                    </div>
                    <div style="display:flex; gap:0.4rem; align-items:center;">
                        <button onclick="document.getElementById('setup-modal').style.display='none'; window.openMatchReplay('${m.id}');"
                            style="padding:0.45rem 1rem;background:linear-gradient(135deg,#58a6ff,#1f6beb);border:none;border-radius:7px;color:white;font-size:0.8rem;cursor:pointer;font-weight:800;white-space:nowrap;box-shadow:0 3px 8px rgba(88,166,255,0.3);">
                            ▶️ Revivir
                        </button>
                        <button onclick="if(typeof openRetroactiveEventModal==='function') openRetroactiveEventModal('${m.id}');" title="Añadir evento retroactivo (batería/cobertura)"
                            style="padding:0.45rem 0.6rem;background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);border-radius:7px;color:#58a6ff;font-size:0.8rem;cursor:pointer;font-weight:700;">
                            ⏱️
                        </button>
                        <button onclick="deleteFinishedMatchFromCloud('${m.id}', '${m.docId || ''}', event);" title="Eliminar partido"
                            style="padding:0.45rem 0.6rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:7px;color:#ff5858;font-size:0.8rem;cursor:pointer;font-weight:700;">
                            🗑️
                        </button>
                    </div>
                </div>`;
        };

        listEl.innerHTML = matches.map(_renderItem).join('');

    } catch(e) {
        console.error('Error en showFinishedMatches:', e);
        listEl.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ Error al cargar partidos: ${escapeHtml(e.message)}</p>`;
    }
}

window.deleteFinishedMatchFromCloud = async function(matchId, docId, e) {
    if (e) e.stopPropagation();
    if (!confirm('¿Eliminar definitivamente este partido del historial?')) return;

    try {
        const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const fa = window._cronos_auth;
        if (fa && fa.db) {
            if (matchId) {
                await deleteDoc(doc(fa.db, 'live_matches', matchId)).catch(() => {});
            }
            if (docId) {
                await deleteDoc(doc(fa.db, 'cronos_player_reports', docId)).catch(() => {});
            }
        }
        if (typeof showToast === 'function') showToast('🗑️ Partido eliminado del historial', 3000);

        if (typeof _renderFinishedMatchesTab === 'function') {
            _renderFinishedMatchesTab();
        }
        if (typeof showFinishedMatches === 'function') {
            showFinishedMatches();
        }
    } catch(err) {
        console.error('[DeleteMatch] Error:', err);
        alert('Error al eliminar el partido: ' + err.message);
    }
};

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

// -- Copias muertas eliminadas el 2026-07-28 (Fase B del monolito #5):
//    las acciones de jugador viven en js/match/events/player-actions.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js








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

// -- Copias muertas eliminadas el 2026-07-28 (Fase B del monolito #5):
//    el tutorial vive en js/match/demo-tutorial.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js




// ══════════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN EN VIVO — Firestore
// ══════════════════════════════════════════════════════════════════

// -- Copias muertas eliminadas el 2026-07-28 (Fase B del monolito #5):
//    la transmision en vivo vive en js/match/live/sync.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js

// startLiveSync() / pushLiveSnapshot() / stopLiveSync() → js/match/live/sync.js
// v276 (unificación): estas 3 copias legacy estaban muertas por shadowing
// (firestore-sync.js las redefinía después). Eliminadas. Fuente única de
// verdad: js/match/live/sync.js (emite phaseStartedAt, timerThresholds,
// createdBy/coachEmail y colores por jugador; late 5000ms con guard).









// _userRef() → firestore-storage.js

// -- Copias muertas eliminadas el 2026-07-28 (Fase B del monolito #5):
//    el almacenamiento en la nube vive en js/services/firestore-storage.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js



// ── Listener en tiempo real: cualquier cambio en Firestore ────────
// se aplica automáticamente en este dispositivo al instante
let _realtimeUnsubscribe = null;


// stopRealtimeSync() → firestore-storage.js





// testWhatsApp() → firestore-storage.js



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



// [v77-FIX] openSetupModal() eliminada — la versión canónica (con CONVOCATORIA,
// ENTRENAMIENTO, MIS INFORMES, RECUPERAR PARTIDO) está en setup-modal.js



// ══════════════════════════════════════════════════════════════════
//  PANEL DE ENTRENAMIENTO — Planificación Semanal
// ══════════════════════════════════════════════════════════════════
window._trWeekOffset = window._trWeekOffset || 0;

// openTrainingPanel() → training_panel.js

// -- Copias muertas eliminadas el 2026-07-28 (Fase A del monolito #5):
//    el panel de entrenamiento vive en js/coach/training/panel.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js




// ══════════════════════════════════════════════════════════════════
//  ENVIAR ENTRENAMIENTO POR WHATSAPP / EMAIL
// ══════════════════════════════════════════════════════════════════


// openTrainingSendPanel() → training_panel.js




// ══════════════════════════════════════════════════════════════════
//  CUERPO TÉCNICO
// ══════════════════════════════════════════════════════════════════

// -- Copias muertas eliminadas el 2026-07-28 (Fase A del monolito #5):
//    el cuerpo tecnico vive en js/core/staff-and-comms.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js




// ══════════════════════════════════════════════════════════════════
//  IMPORTACIÓN DE PLANTILLA CON IA (foto → jugadores)
// ══════════════════════════════════════════════════════════════════

// -- Copias muertas eliminadas el 2026-07-28 (Fase A del monolito #5):
//    la importacion con IA vive en js/ai/import.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js

// ── OCR con Tesseract.js (100% local, sin API, sin coste) ───────────
// Carga la librería solo cuando se necesita (lazy load)
// ══════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — Importación de plantilla con IA (Gemini Vision)
//  Motor: Google Gemini 1.5 Flash (gratis hasta 1500 imgs/día)
//  Fallback: Tesseract.js (100% local, sin límite)
// ══════════════════════════════════════════════════════════════════




// ── Tesseract.js fallback (100% local) ──────────────────────────────
let _tesseractLoaded = false;





// -- Copias muertas eliminadas el 2026-07-28 (Fase B del monolito #5):
//    la importacion y la convocatoria viven en js/ai/import.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js







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

// startMatchFromTitularSelection() → import.js



// --- BOTONES DE SCROLL EN BANQUILLO ---
// injectBenchScrollButtons() -> js/ui/bench-scroll.js (fuente canonica)

// --- PERSISTENCE ---

// populateSavedTeams() -> js/ai/import.js (fuente canonica)

// loadTeamFromDropdown() -> js/ai/import.js (fuente canonica)

// saveCurrentTeam() -> js/ai/import.js (fuente canonica)

// ═══════════════════════════════════════════════════════════════════
// saveTeamSetup(teamKey) — Guardar equipo desde el panel de configuración
// ═══════════════════════════════════════════════════════════════════
// saveTeamSetup() -> js/match/persistence/team-persistence.js (fuente canonica)

// ═══════════════════════════════════════════════════════════════════
// deleteTeamSetup(teamKey) — Eliminar el equipo actualmente cargado
// ═══════════════════════════════════════════════════════════════════
// deleteTeamSetup() -> js/match/persistence/team-persistence.js (fuente canonica)

// ═══════════════════════════════════════════════════════════════════
// deleteTeamFromDropdown(teamKey) — Eliminar el equipo seleccionado
//   en el desplegable "Cargar Guardado" (botón ✕ junto al select)
// ═══════════════════════════════════════════════════════════════════
// deleteTeamFromDropdown() -> js/match/persistence/team-persistence.js (fuente canonica)

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

// renderPlayers() -> js/ui/render.js (fuente canonica)

// sortBenchUI() -> js/ui/render.js (fuente canonica)

// createPlayerChip() -> js/ui/render.js (fuente canonica)

let touchData = { draggedPlayerId: null, hasMoved: false, clone: null };
let lastTouchTime = 0;

// handleTouchStart() -> js/ui/render.js (fuente canonica)

// handleTouchMove() -> js/ui/render.js (fuente canonica)

// handleTouchEnd() -> js/ui/render.js (fuente canonica)

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

// placeOnField() -> js/roster/legacy-formations.js (fuente canonica)

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
function getTimerColor(timeSec, matchCategory, matchSubcategory) {
    const _me = window._cronosCurrentUser;
    const _extras = (_me && _me.extras) || {};
    if (_extras.semaforo === false) {
        return { bg: '#79c0ff', text: '#000000', fontSize: '0.8rem' };
    }

    const cat = matchCategory || window._currentMatchCategory || (typeof document !== 'undefined' ? document.getElementById('match-category')?.value : '') || '';
    const sub = matchSubcategory || window._currentMatchSubcategory || (typeof document !== 'undefined' ? document.getElementById('match-subcategory')?.value : '') || 'A';

    const getGroupFn = (typeof window.getCategoryGroupKey === 'function') ? window.getCategoryGroupKey : function(c,s) { return 'f7'; };
    const groupKey = getGroupFn(cat, sub);

    // Juvenil o Regional -> Sin semáforo -> Celeste
    if (groupKey === 'juvenil' || groupKey === 'regional') {
        return { bg: '#79c0ff', text: '#000000', fontSize: '0.8rem' };
    }

    const configs = window._clubCategoryConfigs || {};
    const groupCfg = configs[groupKey] || (window._clubTimerThresholds ? { semaforoActive: true, red: window._clubTimerThresholds.red, yellow: window._clubTimerThresholds.yellow } : { semaforoActive: true, red: 33, yellow: 50 });

    // Si el Director Deportivo desactivó el semáforo para este grupo -> Celeste
    if (groupCfg.semaforoActive === false) {
        return { bg: '#79c0ff', text: '#000000', fontSize: '0.8rem' };
    }

    const _f7Default  = 1800;
    const _f11Default = 2400;
    const _isF11 = (typeof currentMode !== 'undefined' && currentMode === 'f11') || groupKey !== 'f7';
    const _def = _isF11 ? _f11Default : _f7Default;
    const totalSec  = ((typeof half1MaxTime !== 'undefined' ? half1MaxTime : null) || _def) + ((typeof half2MaxTime !== 'undefined' ? half2MaxTime : null) || _def);

    const redPct    = groupCfg.red    ?? 33;
    const yellowPct = groupCfg.yellow ?? 50;

    const redSec    = totalSec * (redPct / 100);
    const yellowSec = totalSec * (yellowPct / 100);

    if (timeSec >= yellowSec) {
        return { bg: '#2ea043', text: '#000000', fontSize: '0.8rem' };
    } else if (timeSec >= redSec) {
        return { bg: '#e3b341', text: '#000000', fontSize: '0.8rem' };
    } else {
        return { bg: '#da3633', text: '#ffffff', fontSize: '0.8rem' };
    }
}

// allowDrop() → drag-drop.js

// resolveOverlaps() -> js/ui/drag-drop.js (fuente canonica)

// toggleBench() → drag-drop.js

// closeDrawers() -> js/ui/drag-drop.js (fuente canonica)

// dropToField() -> js/ui/drag-drop.js (fuente canonica)

// dropToBench() -> js/ui/drag-drop.js (fuente canonica)

// dropToAwayBench() -> js/ui/drag-drop.js (fuente canonica)

// handleBenchDrop() -> js/ui/drag-drop.js (fuente canonica)

// handleSmartSwap() → js/ui/drag-drop.js (fuente canónica)
// logMovement()     → js/ui/drag-drop.js (fuente canónica)
// Auditoría Parte 2: estas dos copias estaban MUERTAS por shadowing
// (drag-drop.js carga después en index.html y siempre gana). La versión de
// drag-drop.js soporta el 3er argumento forcedSubId (cambio grupal desde
// render.js) y registra los eventos sub_in/sub_out en Firestore (v230/v240),
// cosas que estas copias NO hacían. Eliminadas para evitar que un
// reordenamiento de <script> reactivara la versión vieja e incompleta.

// logEvent() -> js/match/events/movement-log.js (fuente canonica)

// exportData() → movement-log.js




// ══════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — Panel SuperAdmin v3

// -- Constantes del panel movidas a js/shared/admin-shared.js (2026-07-28):
//    SA_CONFIG, ROLE_META, PLAN_META, STATUS_META y SA_CSS.
//    Se leen por nombre pelado y resuelven contra window. NO redeclararlas
//    aqui con const/let: app-init.js carga el PRIMERO y las ensombreceria
//    en TODA la app sin que ninguna guarda `typeof window.X` lo note.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tarjetas expandibles · Notificaciones · Usuarios individuales
// ══════════════════════════════════════════════════════════════════

const LIVE_ROLES  = ['superadmin','admin','club_admin','director','coordinator'];


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
    const suggestedStr = _cronosLocalDateKey(suggested);

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
                            value="${_cronosLocalDateKey(new Date())}">
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
        if (cl.categoryConfigs) window._clubCategoryConfigs = cl.categoryConfigs;
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

// -- Copias muertas eliminadas el 2026-07-28 (Fase A del monolito #5):
//    el envio de convocatoria vive en js/shared/whatsapp-email.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js






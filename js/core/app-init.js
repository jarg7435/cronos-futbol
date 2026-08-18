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
// v465 · UNA RANURA POR PARTIDO, no una clave única para todos.
// La clave global `cronos_active_match_v2` la escribían TODAS las pestañas del
// mismo usuario (localStorage es compartido por origen), así que con dos
// partidos abiertos a la vez se pisaban entre ellas y terminar uno invalidaba
// el estado del otro. Todo el detalle, en js/core/match-slots.js.
// Ya no queda ninguna lectura ni escritura de la clave pelada en este fichero:
// todo pasa por `_cronosMatchSlots`, que es quien compone
// `cronos_active_match_v2::<matchId>`. La constante que había aquí se retiró
// para que nadie la reintroduzca por costumbre.
const _slots = () => window._cronosMatchSlots;

// ════════════════════════════════════════════════════════════════════
//  v557 · DE QUÉ EQUIPO ES EL PARTIDO QUE HAY EN MEMORIA
//
//  Desde v537 un entrenador lleva dos equipos y puede cambiar de uno a otro
//  SIN CERRAR SESIÓN (v540) — o sea, con un partido a medias en la pantalla.
//  A partir de ese instante "el equipo abierto en el panel" y "el equipo del
//  partido que hay en memoria" son cosas DISTINTAS, y confundirlas es lo que
//  hacía que el partido del Alevín se colara en el arranque del Regional.
//
//  🔑 ESTA VARIABLE ES EL DUEÑO DEL ESTADO EN MEMORIA. La fija el arranque de
//  un partido (`_cronosNuevoPartidoDeEquipo`) y la restauración de uno
//  guardado; el cambio de equipo NO la toca a propósito: el partido sigue
//  siendo del equipo con el que se empezó y su autoguardado tiene que seguir
//  cayendo en LA RANURA DE ESE EQUIPO. Así no se pierde nada al cambiar.
// ════════════════════════════════════════════════════════════════════
function _equipoDelPartidoEnMemoria() {
    if (window._cronosMatchTeamId) return String(window._cronosMatchTeamId);
    const S = _slots();
    return (S && typeof S.equipoActual === 'function') ? S.equipoActual() : '';
}

// El id con el que ESTA pestaña guarda su partido. Mientras `liveMatchId` no
// exista todavía (hay un hueco real entre "empieza el partido" y "startLiveSync
// fija el id"), se usa la identidad de la pestaña y la ranura se muda sola en
// cuanto llega el id definitivo.
// v557 · Y esa ranura provisional es la DEL EQUIPO DUEÑO, no la del equipo que
// el panel esté enseñando.
function _miSlotId() {
    const S = _slots();
    if (!S) return null;
    return S.slotIdActual(typeof liveMatchId !== 'undefined' ? liveMatchId : null,
                          _equipoDelPartidoEnMemoria());
}

function _saveMatchStateToStorage() {
    if (matchPhase === 'finished' || matchPhase === 'idle') return;
    try {
        const S = _slots();
        const slotId = _miSlotId();
        if (!S || !slotId) return;
        const _teamId = _equipoDelPartidoEnMemoria();
        const previo = S.leer(slotId);
        let createdAt = new Date().toISOString();
        if (previo && previo.createdAt) createdAt = previo.createdAt;

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
            // v557 · EL SELLO DE EQUIPO. Es lo que permite que el Alevín y el
            // Regional del mismo entrenador sean dos partidos separados
            // aunque compartan pestaña.
            teamId:       _teamId || '',
        };
        S.guardar(slotId, state);
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
    // v465 · Ya no hay bandera GLOBAL de "terminado" que consultar. Era el
    // corazón del fallo: al finalizar el Alevín se levantaba una bandera única
    // y la pestaña del Juvenil, al recargarse, la leía como suya, borraba su
    // estado y devolvía false — el partido que seguía en juego se quedaba sin
    // banner y sin emitir. Ahora la bandera es por partido y la comprueba
    // `_cronosMatchSlots.leer`, que devuelve null sólo para el partido que de
    // verdad terminó.
    try {
        const S = _slots();
        if (!S) return false;
        // 🔑 El de ESTA pestaña primero (sessionStorage). Es lo que hace que dos
        // pestañas recargadas recuperen cada una lo suyo en vez de robárselo.
        const elegido = S.elegir();
        if (!elegido) return false;
        const state = elegido.state;
        window._cronosRestoreSlotId = elegido.id;
        if (!state || !state.savedAt) return false;
        if (state.matchPhase === 'finished') {
            S.cerrar(elegido.id, false);
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
            // Expiró el tiempo reglamentario de validez → cancelar. Sólo ESTA
            // ranura: la caducidad de un partido no puede llevarse por delante
            // otro que siga en juego.
            _cancelInterruptedMatch(state);
            S.cerrar(elegido.id, false);
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
                .then(({ doc, updateDoc, setDoc }) => {
                    updateDoc(doc(fa.db, 'live_matches', state.liveMatchId), {
                        status:      'cancelled',
                        cancelledAt: new Date().toISOString(),
                        cancelReason: 'timeout_match_limit',
                    }).catch(() => {});
                    // v572 · P2 · El índice ligero se cancela con el partido, o
                    // su tarjeta seguiría "EN VIVO" en la lista para siempre: es
                    // el índice el que se filtra por `status`, no el partido.
                    // `setDoc` con merge porque el índice puede no existir.
                    setDoc(doc(fa.db, 'live_index', state.liveMatchId), {
                        status:      'cancelled',
                        cancelledAt: new Date().toISOString(),
                        cancelReason: 'timeout_match_limit',
                    }, { merge: true }).catch(() => {});
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
            _slots()?.cerrar(window._cronosRestoreSlotId || state.liveMatchId, false);
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
    // v465 · Descarta SÓLO el partido que el banner está ofreciendo. Antes
    // borraba la clave única, o sea el partido de quien fuera.
    const S = _slots();
    const slotId = window._cronosRestoreSlotId || (S && S.getTabMatchId());
    const state = (S && slotId) ? S.leer(slotId) : null;
    if (state) { try { _cancelInterruptedMatch(state); } catch(e) {} }
    if (S && slotId) S.cerrar(slotId, true);
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
        // v465 · Se retoma la ranura que el banner ofreció (la de esta pestaña
        // si la había). Y en cuanto se retoma, ESTA PESTAÑA LA RECLAMA: a
        // partir de aquí su autoguardado escribe en esa ranura y ninguna otra
        // pestaña se la puede llevar.
        const S = _slots();
        if (!S) return;
        const slotId = window._cronosRestoreSlotId || S.getTabMatchId();
        const state = slotId ? S.leer(slotId) : null;
        if (!state) return;
        // v557 · Se consume: es una petición puntual ("retoma ESTA tarjeta"),
        // no un estado. Dejarla puesta hacía que la siguiente restauración
        // —la del otro equipo— volviera a retomar la anterior.
        window._cronosRestoreSlotId = null;

        // ── v557 · RETOMAR UN PARTIDO ES VOLVER A SU EQUIPO ───────────────
        // El panel de "🔄 Recuperar Partido" enseña los partidos de LOS DOS
        // equipos a propósito (si no, el del otro sería irrecuperable). Pero
        // retomar el del Alevín estando abierto el Regional dejaría la app
        // partida en dos: la pantalla con el partido del Alevín y el panel
        // diciendo Regional — y a partir de ahí, cada módulo leyendo una cosa.
        // Así que se cambia el equipo activo ANTES de restaurar nada.
        const _eqPartido = state.teamId ? String(state.teamId) : '';
        window._cronosMatchTeamId = _eqPartido ||
            (typeof S.equipoActual === 'function' ? S.equipoActual() : '');
        if (_eqPartido && typeof window._cronosAplicarEquipoActivo === 'function') {
            window._cronosAplicarEquipoActivo(_eqPartido);
        }

        if (state.liveMatchId) S.setTabMatchId(state.liveMatchId, _eqPartido);
        else if (slotId) S.setTabMatchId(slotId, _eqPartido);
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
    // Pila de navegación (js/core/nav-stack.js): el post-partido es la OTRA
    // raiz del panel del Entrenador. Se registra CON el marcador para poder
    // repintarse identico cuando se vuelva aqui desde una subpantalla.
    if (typeof navRootScreen === 'function') navRootScreen('showPostMatchOptions', scoreHome, scoreAway);

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

    // Pila de navegación (js/core/nav-stack.js). Se registra AQUÍ y no en la
    // primera línea, a propósito: las dos salidas tempranas de arriba (plan sin
    // el extra `partidos_terminados`, y modal ausente) no pintan nada, y apilar
    // una pantalla que no se pinta haría que el siguiente navBack restaurase un
    // modal invisible. Y antes del primer await, por el invariante async.
    if (typeof navScreen === 'function') navScreen('showFinishedMatches');

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(95vw,600px);max-height:90vh;display:flex;flex-direction:column;padding:1.2rem;background:#0d1117;color:white;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:0.8rem;">
            <h2 style="margin:0;color:white;font-size:1.1rem;display:flex;align-items:center;gap:0.5rem;">
                🎬 Partidos Terminados
            </h2>
            <!-- LAS DOS VIAS DE SALIDA del requisito original: "Volver" deshace el
                 camino, la ✕ abandona el area. Antes solo habia ✕, y hacía lo que
                 le tocaba a "Volver". Si la ✕ fuera navBack() a secas (v402) te
                 dejaría igualmente DENTRO del partido, que es lo que el autor
                 reportó del menú de Comunicaciones: debajo está #main-container. -->
            <div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0;">
                <button onclick="navBack()"
                    style="font-size:0.75rem;padding:0.35rem 0.8rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.1);color:var(--text-muted);
                           border-radius:6px;cursor:pointer;">
                    ← Volver
                </button>
                <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;"
                    title="Salir al selector de roles">✕</button>
            </div>
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
                        // v434 · Mismo caso que en finished-matches-tab.js: no se
                        // persiste sobre un partido terminado. Se sigue usando en
                        // pantalla, pero editar un partido cerrado está prohibido
                        // y la regla lo denegaría en cada ficha, en silencio.
                        const _esPartido = colName === 'live_matches';
                        if (targetId && updateDoc && doc && !_esPartido) {
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
            // ⚠️ 'Regional FEM' CONTIENE 'region': las dos categorías FEM van
            // ANTES de la comprobación genérica (ver finished-matches-tab.js).
            if (str.includes('futurefem') || str.includes('future fem') || str.includes('future_fem')) return 'futurefem';
            if (str.includes('region') && str.includes('fem')) return 'regional_fem';
            if (str.includes('region')) return 'regional';
            return str.replace(/\s+[abc]$/, '').replace(/[\s-]+/g, '_').replace(/_[abc]$/, '');
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

            // ── v434/v435 · Estado de la ficha ────────────────────────────
            // Mismo criterio que finished-matches-tab.js, el listado gemelo:
            // los PARTIDOS se rigen por la inmutabilidad de v434 (2 h y luego
            // congelados), y los INFORMES son deportivos y los gestiona el
            // cuerpo técnico, así que se pueden borrar pero no admiten evento
            // retroactivo.
            const _lock = window.CronosMatchLock;
            const _esInforme = m.source === 'cronos_player_reports';
            const _congelado = _esInforme ? false : (!_lock || _lock.state(m) === 'frozen');
            const _restante = (!_esInforme && !_congelado && _lock) ? _lock.graceRemainingText(m) : '';

            return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:0.8rem 1rem;background:rgba(255,255,255,0.03);border:1px solid rgba(121,192,255,0.2);border-radius:10px;margin-bottom:0.6rem;gap:1rem;">
                    <div>
                        <div style="font-weight:800;color:white;font-size:0.9rem;">${escapeHtml(homeName)} ${scoreHome} - ${scoreAway} ${escapeHtml(awayName)}</div>
                        <div style="font-size:0.72rem;color:#7d8590;margin-top:2px;">
                            ${escapeHtml(cat)} ${escapeHtml(sub)} · 📅 ${escapeHtml(dateStr)} ${eventsCount > 0 ? `· 📍 ${eventsCount} eventos` : ''}
                            ${_esInforme ? ' · 📋 INFORME' : _congelado ? ' · 🔒 CERRADO' : ` · ✏️ ${escapeHtml(_restante)}`}
                        </div>
                    </div>
                    <div style="display:flex; gap:0.4rem; align-items:center;">
                        <!-- 🔑 v459 · ESTE BOTÓN YA NO OCULTA #setup-modal.
                             Ocultarlo no servía de nada —el reproductor es una
                             capa opaca a z-index 100000 que ya lo tapa entero— y
                             era la CAUSA de que al pulsar la ✕ apareciera el
                             campo vacío: debajo del reproductor no quedaba el
                             listado, sino #main-container. Ver la cabecera de
                             closeMatchReplay en replay-player.js. -->
                        <button onclick="window.openMatchReplay('${m.id}');"
                            style="padding:0.45rem 1rem;background:linear-gradient(135deg,#58a6ff,#1f6beb);border:none;border-radius:7px;color:white;font-size:0.8rem;cursor:pointer;font-weight:800;white-space:nowrap;box-shadow:0 3px 8px rgba(88,166,255,0.3);">
                            ▶️ Revivir
                        </button>
                        ${(_congelado || _esInforme) ? '' : `
                        <button onclick="if(typeof openRetroactiveEventModal==='function') openRetroactiveEventModal('${m.id}');" title="Añadir evento retroactivo (batería/cobertura) — quedan ${escapeHtml(_restante)}"
                            style="padding:0.45rem 0.6rem;background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);border-radius:7px;color:#58a6ff;font-size:0.8rem;cursor:pointer;font-weight:700;">
                            ⏱️
                        </button>`}
                        ${_congelado ? '' : `
                        <button onclick="deleteFinishedMatchFromCloud('${m.id}', '${m.docId || ''}', event);" title="${_esInforme ? 'Eliminar informe' : 'Eliminar partido'}"
                            style="padding:0.45rem 0.6rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:7px;color:#ff5858;font-size:0.8rem;cursor:pointer;font-weight:700;">
                            🗑️
                        </button>`}
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

    // ── v434 · PUERTA DE BORRADO ──────────────────────────────────────
    // Congelado es también NO BORRABLE. Si un partido incómodo se puede hacer
    // desaparecer, la inmutabilidad no sirve de nada: lo que no se puede editar
    // se falsificaría por omisión. El SuperAdmin conserva la válvula de escape.
    // Se relee el documento en vez de fiarse de la ficha pintada, que puede
    // llevar abierta más de las 2 h de la ventana.
    // ⚠️ v435 · EL CANDADO SOLO AFECTA AL PARTIDO, NUNCA AL INFORME.
    // Esta función recibe DOS cosas: el id de un partido de live_matches y el
    // de un informe de cronos_player_reports. En el listado, el `id` de una
    // ficha de informe es `data.liveMatchId || d.id`, así que puede ser el id de
    // un partido YA CONGELADO — y con la comprobación de v434 tal como estaba,
    // ese partido bloqueaba el borrado del INFORME, que se rige por otro
    // criterio (deportivo, gestionado por el cuerpo técnico) y debe poder
    // borrarse igual. Ahora el candado solo decide si se borra el partido.
    let _borrarPartido = !!matchId;
    try {
        const fa0 = window._cronos_auth;
        const esSA = window._cronosCurrentUser?.role === 'superadmin'
                  || window._cronosCurrentUser?.role === 'admin';
        if (matchId && fa0 && fa0.db && window.CronosMatchLock && !esSA) {
            const fs0 = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            const snap0 = await fs0.getDoc(fs0.doc(fa0.db, 'live_matches', matchId));
            if (snap0.exists() && !window.CronosMatchLock.canDelete({ id: snap0.id, ...snap0.data() }, false)) {
                _borrarPartido = false;
                // Si no había informe que borrar, no queda nada que hacer: se
                // avisa y se sale sin pedir confirmación de una acción vacía.
                if (!docId) {
                    const motivo = window.CronosMatchLock.lockReason({ id: snap0.id, ...snap0.data() });
                    if (typeof showToast === 'function') showToast('🔒 ' + motivo, 5000);
                    else alert(motivo);
                    return;
                }
            }
        }
    } catch (eLock) {
        // Un fallo de lectura NO abre la puerta por su cuenta: se sigue y es la
        // regla de firestore.rules la que decide. Aquí solo se pierde el aviso.
        console.warn('[v434] No se pudo comprobar el candado antes de borrar:', eLock && eLock.message);
    }

    // ══════════════════════════════════════════════════════════════════
    //  PURGA TOTAL (2026-08-13) — regla del autor
    // ══════════════════════════════════════════════════════════════════
    //  Antes esto borraba `live_matches/{matchId}` y UN SOLO documento de
    //  cronos_player_reports. Pero un partido tiene hasta cuatro informes POR
    //  JUGADOR con ids distintos, así que el resto sobrevivía y el ACUMULADO
    //  DE TEMPORADA seguía contándolos: el partido desaparecía del historial y
    //  sus datos se quedaban de fantasmas en la sumatoria del equipo.
    //
    //  La regla es: el borrado físico purga los acumulados correspondientes.
    //  Se usa la MISMA función que el botón 💣 del panel de Informes
    //  (js/coach/reports/match-purge.js) para que "purga total" signifique lo
    //  mismo se entre por donde se entre.
    //
    //  ⚠️ EL AVISO SE GRADÚA SEGÚN LO QUE HAYA EN JUEGO, y por eso se cuenta
    //  ANTES de preguntar: el registro de partido terminado es TEMPORAL (la
    //  ventana de 10 h) y borrarlo solo no merece fricción; borrar informes
    //  colectivos toca la temporada entera y sí la merece.
    // ══════════════════════════════════════════════════════════════════
    //  QUIÉN PUEDE DESTRUIR INFORMES: SÓLO EL DIRECTOR DEPORTIVO
    // ══════════════════════════════════════════════════════════════════
    //  Regla de producto (2026-08-13): entrenador y coordinador sólo OCULTAN;
    //  la purga física, que descuenta del acumulado del club, es del Director.
    //
    //  🔑 PERO EL REGISTRO DE PARTIDO TERMINADO ES OTRA COSA: es temporal (la
    //  ventana de 10 h) e independiente de los informes permanentes. Un
    //  entrenador puede seguir retirándolo de su historial; lo que no puede es
    //  llevarse por delante los informes. Por eso aquí no se corta en seco: se
    //  separan las dos acciones.
    const _esDirector = (typeof window._sdPuedePurgar === 'function')
                        && window._sdPuedePurgar(window._cronosCurrentUser);

    let _ids = [];
    if (_esDirector) {
        try {
            if (typeof window.cronosRecogerInformesDePartido === 'function') {
                _ids = await window.cronosRecogerInformesDePartido(matchId, docId ? [docId] : []);
            } else if (docId) {
                _ids = [docId];
            }
        } catch (eIds) {
            console.warn('[DeleteMatch] no se pudieron contar los informes:', eIds && eIds.message);
            if (docId) _ids = [docId];
        }
    } else if (docId && !_borrarPartido) {
        // Ficha de INFORME y quien mira no es director: no hay nada que pueda
        // hacer aquí. Se le manda a ocultar, que es su herramienta.
        const _aviso = '⛔ El borrado permanente de informes es exclusivo del Director Deportivo.\n\n' +
                       'Desde el panel de Informes puedes OCULTARLO de tu panel con 🗑️.';
        if (typeof showToast === 'function') showToast(_aviso, 6000); else alert(_aviso);
        return;
    }

    if (_ids.length) {
        if (!confirm(
            '⚠️ BORRADO PERMANENTE\n\n' +
            'Se eliminarán ' + _ids.length + ' informe' + (_ids.length === 1 ? '' : 's') +
            ' de este partido (entrenador, dirección y padres)' +
            (_borrarPartido ? ',\ny también su registro de partido terminado' : '') + '.\n\n' +
            'Sus datos se DESCONTARÁN del acumulado de temporada del equipo.\n' +
            'Desaparecerá para todos los roles.\n\n' +
            'ESTO NO SE PUEDE DESHACER. ¿Continuar?')) return;

        const _t = prompt('Confirmación final.\n\nEscribe la palabra BORRAR para purgar el partido:');
        if (String(_t || '').trim().toUpperCase() !== 'BORRAR') {
            if (typeof showToast === 'function') showToast('Cancelado · no se ha borrado nada', 2500);
            return;
        }
    } else {
        // Sólo el registro temporal. Un aviso simple basta.
        //
        // ⚠️ EL TEXTO SE ADAPTA A POR QUÉ NO HAY NADA QUE PURGAR. Para quien
        // no es director, `_ids` va vacío POR PERMISOS, no porque no existan
        // informes: decirle "no hay informes asociados" sería mentirle y le
        // haría creer que ha borrado el partido entero.
        if (!confirm(_esDirector
            ? '¿Eliminar este partido del historial?\n\n' +
              'Es el registro temporal del partido; no hay informes asociados.'
            : '¿Eliminar este partido de tu historial?\n\n' +
              'Se retira el registro temporal del partido.\n' +
              'Los informes colectivos NO se tocan: sólo el Director Deportivo puede eliminarlos.')) return;
    }

    try {
        if (typeof showSpinner === 'function') showSpinner('Purgando partido…');

        let r = { borrados: 0, denegados: 0, partidoBorrado: false };
        if (typeof window.cronosPurgarInformes === 'function') {
            r = await window.cronosPurgarInformes(_ids);
            if (matchId && _borrarPartido) {
                r.partidoBorrado = await window.cronosBorrarPartidoEnVivo(matchId);
            }
        }

        if (typeof hideSpinner === 'function') hideSpinner();

        const resumen = (typeof window.cronosResumenPurga === 'function')
            ? window.cronosResumenPurga(r)
            : '🗑️ Eliminado del historial';
        if (typeof showToast === 'function') showToast(resumen, 6000); else alert(resumen);

        // Se repinta SOLO el historial, que es esta pantalla. El acumulado de
        // temporada vive en la pestana de Informes —otra pantalla, que no se
        // ve a la vez— y se recalcula solo al abrirla, ya descontado.
        // ⚠️ La guarda va CON LLAVES: la aserción 1d de
        // test_finished_matches_module.js fija esa forma exacta.
        if (typeof _renderFinishedMatchesTab === 'function') {
            _renderFinishedMatchesTab();
        }
        if (typeof showFinishedMatches === 'function') {
            showFinishedMatches();
        }
    } catch(err) {
        if (typeof hideSpinner === 'function') hideSpinner();
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
        // v465 · ⚠️ SÓLO EL PARTIDO DE ESTA PESTAÑA. Con la clave única, abrir
        // un SEGUNDO partido en otra pestaña disparaba este aviso hablando del
        // PRIMERO ("hay un partido en curso, 2ª PARTE, 1-0"), y aceptar
        // reanudaba el ajeno encima del nuevo. Un partido de otra pestaña no
        // tiene por qué impedir empezar éste.
        //
        // 🚨 v557 · Y SÓLO EL PARTIDO DE ESTE EQUIPO (captura 9042). El mismo
        // daño, un eje más adentro: con el Alevín C en juego, cambiar al
        // Regional A en el MISMO panel y preparar su partido disparaba este
        // aviso con el marcador y la fase DEL ALEVÍN. `getTabMatchId()` mira
        // ahora el puntero del equipo abierto, así que aquí no hay nada que
        // reanudar cuando el partido de al lado es de otro equipo.
        const S = _slots();
        if (!S) return false;
        const propio = S.getTabMatchId();
        if (!propio) return false;
        const st = S.leer(propio);
        if (!st || !st.matchPhase) return false;
        // ⚠️ CINTURÓN Y TIRANTES, y no sobra: una ranura sin sello de equipo
        // (escrita antes de v557, o por un perfil sin club) pasa; una sellada
        // con OTRO equipo no puede bloquear el arranque de éste ni aunque el
        // puntero se hubiera quedado desfasado.
        const _eqAbierto = (typeof S.equipoActual === 'function') ? S.equipoActual() : '';
        if (_eqAbierto && st.teamId && String(st.teamId) !== _eqAbierto) return false;
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
            // ⚠️ v557 · SE DICE EXPLÍCITAMENTE QUÉ RANURA SE RETOMA. Sin esta
            // línea, `_restoreActiveMatch` empieza por `_cronosRestoreSlotId`,
            // que puede haber quedado apuntando a un partido de OTRO equipo
            // desde la última visita al panel de recuperación: el aviso
            // hablaría del Regional y se restauraría el Alevín.
            window._cronosRestoreSlotId = propio;
            if (typeof window._restoreActiveMatch === 'function') window._restoreActiveMatch();
            return true; // abortar inicio de partido nuevo
        }
        return false; // el usuario aceptó empezar de cero
    } catch (e) {
        return false;
    }
}
window._guardAgainstMatchReset = _guardAgainstMatchReset;

// ══════════════════════════════════════════════════════════════════
//  v557/v558 · EMPIEZA UN PARTIDO NUEVO: EL ANTERIOR NO SE HEREDA
//
//  Se llama desde los DOS caminos de arranque (goToTitularSelection y
//  startMatchWithConvocation, en js/ai/import.js), justo después del aviso
//  anti-reinicio y antes de tocar nada. Llegar aquí significa siempre "empieza
//  un partido NUEVO": si el usuario hubiera elegido REANUDAR, el aviso ya
//  habría devuelto true y no se llegaría.
//
//  🚨🚨🚨 v558 · EL SEGUNDO PARTIDO DE LA SESIÓN NO SE RETRANSMITÍA
//
//  Reportado por el autor (captura 9043, probando 7 partidos a la vez): el
//  partido del Cadete B "no aparece en vivo, ni creándolo de nuevo".
//
//  🔑🔑🔑 NADIE PONÍA EL ESTADO A CERO AL EMPEZAR. `spawnInitialPlayers()`
//  reconstruye la plantilla, pero las variables globales del partido son de
//  app-init.js y sólo las reiniciaba `resetMatch()` — un botón con su propio
//  confirm que aquí no pasa nunca. Así que el partido nuevo arrancaba con el
//  estado del anterior, y `matchPhase` seguía valiendo **'finished'**. A partir
//  de ahí, en cadena y SIN UN SOLO ERROR VISIBLE:
//
//    · `pushLiveSnapshot` reutilizaba el `liveMatchId` del partido terminado
//      (`_isNewMatch = !liveMatchId`) y escribía sobre SU documento… que las
//      reglas de v434 tienen CONGELADO (`lmIsLive()` es false en un partido
//      terminado). La escritura se DENIEGA, el `catch` la registra como un
//      warning y el partido no llega nunca a `live_matches`. Eso es
//      exactamente "no aparece entre los partidos activos";
//    · `_saveMatchStateToStorage` sale por su primera línea con
//      `matchPhase === 'finished'`: el partido nuevo tampoco se autoguardaba,
//      así que no había ni recuperación local;
//    · `tick()` sólo suma en '1st_half'/'2nd_half' (v448): el cronómetro no
//      habría corrido;
//    · y el marcador es DOM puro (`#score-home`), que nadie devuelve a 0: el
//      partido nuevo empezaba con el resultado del anterior en pantalla.
//
//  ⚠️ SE REINICIA SIEMPRE, no sólo tras un partido terminado. Con el estado ya
//  a cero es una operación nula, y ese es justo el punto: no depender de
//  adivinar en qué estado quedó lo anterior.
//
//  🔑🔑 `liveMatchId` SE SUELTA SÓLO SI HUBO PARTIDO DE VERDAD (terminado, con
//  tiempo jugado o con goles) O SI HA CAMBIADO EL EQUIPO. Si el entrenador
//  vuelve a Configuración a los diez segundos, sin nada jugado, y reconfirma la
//  convocatoria, eso es el MISMO partido: soltarlo dejaría un documento 0-0
//  huérfano en la lista de Partidos en Vivo.
//
//  Y SI HA CAMBIADO EL EQUIPO (v557), soltarlo es obligatorio: el partido del
//  Regional heredaría el identificador del Alevín y los dos escribirían en el
//  MISMO documento —marcador, alineación y sucesos—, con el visor del Alevín
//  llenándose de jugadores del Regional.
//
//  ⚠️ EL LATIDO ANTERIOR SE CORTA EN EL ACTO, y es síncrono a propósito: el
//  temporizador de 5 s de la retransmisión vieja sigue vivo, y entre
//  `spawnInitialPlayers()` y el `startLiveSync()` que va 800 ms detrás emitiría
//  la plantilla NUEVA al documento VIEJO.
// ══════════════════════════════════════════════════════════════════
function _cronosNuevoPartidoDeEquipo() {
    try {
        const S = _slots();
        const eq = (S && typeof S.equipoActual === 'function') ? S.equipoActual() : '';
        const anterior = window._cronosMatchTeamId || '';
        const cambiaDeEquipo = !!(eq && anterior && anterior !== eq);

        // ¿Lo que había era un partido DE VERDAD? Los tres rastros que no puede
        // dejar un partido que no llegó a empezar.
        const _num = (id) => parseInt(document.getElementById(id)?.textContent, 10) || 0;
        const huboPartido =
            (typeof matchPhase !== 'undefined' && matchPhase === 'finished') ||
            ((Number(typeof masterTimeH1 !== 'undefined' ? masterTimeH1 : 0) || 0) +
             (Number(typeof masterTimeH2 !== 'undefined' ? masterTimeH2 : 0) || 0)) > 0 ||
            _num('score-home') > 0 || _num('score-away') > 0;

        // ── 1 · el estado del partido, a cero ────────────────────────────
        if (typeof isRunning    !== 'undefined') isRunning = false;
        if (typeof timerInterval !== 'undefined' && timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (typeof matchPhase   !== 'undefined') matchPhase   = '1st_half';
        if (typeof masterTimeH1 !== 'undefined') masterTimeH1 = 0;
        if (typeof masterTimeH2 !== 'undefined') masterTimeH2 = 0;
        if (typeof lastTickTime !== 'undefined') lastTickTime = 0;
        window._cronosExtraGoals = { home: 0, away: 0 };
        // El marcador vive SÓLO en el DOM: si no se pone a cero aquí, no lo
        // hace nadie.
        const _sh = document.getElementById('score-home');
        const _sa = document.getElementById('score-away');
        if (_sh) _sh.textContent = '0';
        if (_sa) _sa.textContent = '0';
        // Y el botón vuelve a decir EMPEZAR (lo deja en 'PAUSAR' el partido
        // anterior si se terminó con el reloj corriendo).
        const _btn = document.getElementById('btn-play-pause');
        if (_btn) { _btn.textContent = 'EMPEZAR'; _btn.classList.remove('danger'); }
        if (typeof updateMasterUI === 'function') { try { updateMasterUI(); } catch (e) {} }

        // ── 2 · la retransmisión anterior, soltada ───────────────────────
        if (huboPartido || cambiaDeEquipo) {
            try {
                if (typeof liveIsActive !== 'undefined') liveIsActive = false;
                if (typeof liveSyncTimer !== 'undefined' && liveSyncTimer) {
                    clearInterval(liveSyncTimer);
                    liveSyncTimer = null;
                }
                if (typeof liveMatchId !== 'undefined') liveMatchId = null;
            } catch (e) { /* el arranque del partido nunca puede romperse aquí */ }
            // Cada partido lleva su propia cuenta de sucesos y su propio guard
            // de despacho de informes: heredarlos mezclaría dos partidos en el
            // mismo informe.
            window._cronosMatchEvents = [];
            window._cronosLastDispatchedMatch = null;
        }

        // ── 3 · el dueño del partido que nace ────────────────────────────
        // Es lo que hace que su autoguardado caiga en la ranura de ESE equipo
        // aunque el entrenador cambie de equipo en el panel a mitad de partido.
        window._cronosMatchTeamId = eq || '';
    } catch (e) { /* silencioso */ }
}
window._cronosNuevoPartidoDeEquipo = _cronosNuevoPartidoDeEquipo;

// startMatchFromTitularSelection() → import.js


// --- BOTONES DE SCROLL EN BANQUILLO ---
// injectBenchScrollButtons() -> js/ui/bench-scroll.js (fuente canonica)

// --- PERSISTENCE ---

// populateSavedTeams() -> js/match/persistence/team-persistence.js (fuente canonica)

// loadTeamFromDropdown() -> js/match/persistence/team-persistence.js (fuente canonica)

// saveCurrentTeam() -> js/match/persistence/team-persistence.js (fuente canonica)

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

    // 🚦 v559 · JUVENIL, REGIONAL Y REGIONAL FEM: CELESTE, TAJANTE.
    //
    // ⚠️ SE PREGUNTA POR TODAS LAS SEÑALES, no sólo por `cat`. Esta función se
    // llama con UN argumento desde `updatePlayerUI` y desde el coloreador de
    // js/core/patches.js —que repinta CADA jugador cada segundo—, así que todo
    // depende de la cascada de arriba; y si esa cascada se queda vacía,
    // `getCategoryGroupKey('')` devuelve **'infantil_a'**, que sí tiene
    // semáforo. Ése era el rojo del Regional de la captura 9056. Añadiendo la
    // categoría del PERFIL del entrenador, un hueco en el DOM ya no basta para
    // encenderlo: hay que fallar todas las señales a la vez.
    const _meCat = _me && (_me.category || (_me._activeRoleData && _me._activeRoleData.category) || _me.categoryLabel);
    if (typeof window.cronosCategoriaSinSemaforo === 'function' &&
        window.cronosCategoriaSinSemaforo(cat, _meCat)) {
        return { bg: '#79c0ff', text: '#000000', fontSize: '0.8rem' };
    }

    const getGroupFn = (typeof window.getCategoryGroupKey === 'function') ? window.getCategoryGroupKey : function(c,s) { return 'f7'; };
    const groupKey = getGroupFn(cat, sub);

    // Respaldo por grupo: si `cronosCategoriaSinSemaforo` no estuviera cargada
    // todavía, la regla sigue aplicándose por la vía de siempre.
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

// -- PANEL SUPERADMIN LEGACY v3 ELIMINADO (Fase D del monolito #5, 2026-07-28).
//    14 funciones / 762 lineas: openAdminPanel, saOverview, saClubs*, saOpenEditor,
//    saIndividual, saPayments*, saNewClub y sus ayudantes. Estaban INALCANZABLES:
//    todas colgaban de openSuperAdminPanel, que llevaba tiempo muerta porque
//    js/admin/superadmin/superadmin.panel.js la redeclara y carga despues.
//    El panel vivo es ese, con sus pestanyas en js/admin/superadmin/*.
//    De este bloque solo sobreviven saWrite, saOpenIndividualEditor y
//    checkClubAccess, que si tienen consumidores reales.
//    Guard: scripts/test_app_init_dead_duplicates.js (PARTE 7)


// openSuperAdminPanel() -> js/admin/superadmin/superadmin.panel.js (fuente canonica)

// ── Helpers Firestore ────────────────────────────────────────────────
// saFS() -> js/admin/superadmin/superadmin.panel.js (fuente canonica)
async function saWrite(col, id, data, merge=true) {
    const { db, doc, setDoc } = await saFS();
    await setDoc(doc(db, col, id), data, merge ? { merge:true } : {});
}
// saGet() -> js/admin/superadmin/superadmin.panel.js (fuente canonica)


// saClubs() -> js/admin/superadmin/clubs-tab.js (fuente canonica)


// ════════════════════════════════════════════════════════════════════
//  TAB: USUARIOS INDIVIDUALES
// ════════════════════════════════════════════════════════════════════

async function saOpenIndividualEditor(uid) {
    // Pila de navegacion (js/core/nav-stack.js) — primera sentencia, antes del
    // await (ver la nota del invariante async en superadmin.panel.js).
    //
    // 🐛 SEGUNDO BOTON "VOLVER" ROTO DEL PANEL SUPERADMIN, del mismo tipo que
    // el de saSendPaymentEmail: llamaba a saTab('individual'), EN SINGULAR, y
    // la pestaña se llama 'individuals'. Ninguna rama de saTab se cumplia, asi
    // que no repintaba nada y apagaba el subrayado de todas las pestañas: el
    // boton no hacia nada. Ahora vuelve con navBack().
    if (typeof navScreen === 'function') navScreen('saOpenIndividualEditor', uid);

    const u    = uid ? await saGet('users', uid) : {};
    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <div style="max-width:520px;">
          <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1rem;">
            <button onclick="navBack()" class="sa-btn"
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
        // Mismo singular roto que el boton Volver: tras guardar tampoco pasaba
        // nada y el usuario se quedaba en el editor con el "Guardado" puesto.
        setTimeout(() => { if (typeof navBack === 'function') navBack(); else saTab('individuals'); }, 1000);
    };
}


// saRequests() -> js/admin/superadmin/requests-tab.js (fuente canonica)

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

// saSendPaymentEmail() -> js/admin/billing/payments.js (fuente canonica)

// ══════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — Envío de convocatoria por WhatsApp / Email
// ══════════════════════════════════════════════════════════════════

// -- Copias muertas eliminadas el 2026-07-28 (Fase A del monolito #5):
//    el envio de convocatoria vive en js/shared/whatsapp-email.js
//    y ganaba siempre, porque app-init.js carga el PRIMERO y en scripts
//    clasicos la ULTIMA declaracion de funcion es la que queda.
//    Guard: scripts/test_app_init_dead_duplicates.js

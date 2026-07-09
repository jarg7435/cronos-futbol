// ════════════════════════════════════════════════════════════════
// utils.js — Funciones de utilidad y seguridad
// Chronos Fútbol — v5.1
// ════════════════════════════════════════════════════════════════

// ── SECURITY FIX (SEC-M04): Polyfills de escape HTML ──────────
// Previene XSS en todos los puntos donde se inyecta contenido
// dinámico en el DOM mediante innerHTML o construcción de HTML.

/**
 * Escapa caracteres especiales HTML para prevenir inyección XSS.
 * Usar SIEMPRE que se construya HTML con datos dinámicos.
 * @param {string} str - Texto a escapar
 * @returns {string} Texto con caracteres HTML escapados
 */
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
}

/**
 * Escapa caracteres para uso dentro de atributos HTML.
 * Variante más estricta de escapeHtml para atributos onclick, data-*, etc.
 * @param {string} str - Texto a escapar
 * @returns {string} Texto con caracteres de atributo escapados
 */
if (typeof window.escapeAttr !== 'function') {
    window.escapeAttr = function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\//g, '&#x2F;');
    };
}

// ── FIX (Problema 1): sufijo DETERMINISTA para liveMatchId ─────
// Antes, las 3 copias de startLiveSync (app-init.js, match/live/sync.js,
// services/firestore-sync.js) generaban el sufijo con Math.random(), por
// lo que cada re-inicio del live sync producía un liveMatchId distinto
// (futbol-7-12062026-eq1u → ...-x9k2). Como _stableMatchId deriva su
// resultado de liveMatchId, el matchId de los informes dejaba de ser
// estable y el dedup del panel del padre no podía colapsar los duplicados.
//
// Hash FNV-1a de 32 bits → 4 chars base36. Determinista para una misma
// entrada (equipo+fecha+rival+convocatoria), así que reiniciar el sync NO
// cambia el ID mientras se trate del mismo partido.
if (typeof window._cronosStableSlug !== 'function') {
    window._cronosStableSlug = function(input, len) {
        const str = String(input == null ? '' : input);
        let h = 0x811c9dc5; // FNV offset basis
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            // FNV prime 16777619, mantenido en 32 bits sin signo
            h = (h * 0x01000193) >>> 0;
        }
        const slug = h.toString(36);
        const n = len || 4;
        // Rellenar a la izquierda para longitud estable
        return (slug.length >= n ? slug.slice(-n) : ('0000' + slug).slice(-n));
    };
}

// Genera (o reutiliza) un liveMatchId DETERMINISTA y estable por partido.
// - Si ya hay un liveMatchId activo en `window`, lo reutiliza (idempotencia
//   real: reiniciar el sync NO cambia el ID).
// - Si no, deriva el sufijo de la identidad estable del partido en vez de
//   Math.random().
if (typeof window._cronosBuildLiveMatchId !== 'function') {
    window._cronosBuildLiveMatchId = function(opts) {
        opts = opts || {};
        // Reutilizar ID existente si seguimos en el mismo partido (idempotencia
        // real: reiniciar el sync NO cambia el ID). Se acepta tanto el valor
        // pasado explícitamente (binding léxico `liveMatchId` de los scripts
        // clásicos, que NO es window.liveMatchId) como window.liveMatchId.
        const existing = opts.existing || (typeof window.liveMatchId === 'string' ? window.liveMatchId : '');
        // v266: NUNCA reutilizar el ID existente. Siempre generar uno nuevo
        // con la hora actual para que cada partido tenga un ID Único.
        // Antes, si existing tenía valor, reutilizaba el ID del partido
        // anterior (sin hora), lo que mezclaba los eventos.
        const slugify = (str) => (str || 'equipo')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 20);
        const teamSlug = slugify(opts.teamName);
        const now = opts.date instanceof Date ? opts.date : new Date();
        const dateSlug = String(now.getDate()).padStart(2, '0') +
                         String(now.getMonth() + 1).padStart(2, '0') +
                         now.getFullYear();
        // Identidad estable del partido: uid + equipo + fecha + rival + huella de
        // la convocatoria (nº de jugadores + sus números/ids). SIN componente
        // aleatorio: el mismo partido produce SIEMPRE el mismo id.
        let convoFingerprint = '';
        try {
            const convo = opts.convocation || window.activeConvocation;
            if (Array.isArray(convo)) {
                convoFingerprint = convo
                    .map(p => (p && (p.number != null ? p.number : (p.playerId || p.id || ''))))
                    .join(',');
            }
        } catch (_) { /* sin convocatoria → huella vacía */ }
        const uid = opts.uid || (window._cronosCurrentUser && window._cronosCurrentUser.uid) || 'u';
        const seed = [uid, teamSlug, dateSlug, slugify(opts.rivalName || ''),
                      convoFingerprint, opts.extraSeed || ''].join('|');
        const randSlug = window._cronosStableSlug(seed, 4);
        return `${teamSlug}-${dateSlug}-${randSlug}`;
    };
}

// ── FIX (Problema 2): normalización de email/teléfono ──────────
// El emparejado de links padre↔jugador (autoDispatchMatchReports / FaseC)
// comparaba l.parentEmail === r.email y l.parentPhone === r.phone sin
// normalizar, así que un email con distinto case/espacios o un teléfono con
// prefijo +34/espacios devolvía link === undefined aunque existiera en
// Firestore.
if (typeof window._cronosNormEmail !== 'function') {
    window._cronosNormEmail = function(v) {
        return v == null ? '' : String(v).trim().toLowerCase();
    };
}
if (typeof window._cronosNormPhone !== 'function') {
    window._cronosNormPhone = function(v) {
        // Conserva solo dígitos. Los números nacionales españoles tienen 9
        // dígitos; con prefijo internacional son 34 + 9 = 11 (o 0034 + 9 = 13).
        // Quitamos el prefijo de país para que +34/0034 case con el número
        // nacional. Si tras quitarlo no quedan 9 dígitos, se deja el valor
        // original (evita romper números de otros países).
        let d = (v == null ? '' : String(v)).replace(/\D/g, '');
        if (d.length === 13 && d.startsWith('0034')) {
            d = d.slice(4);
        } else if (d.length === 11 && d.startsWith('34')) {
            d = d.slice(2);
        }
        return d;
    };
}

// ── Resolutor de staff por modalidad del partido (Pieza 2) ─────
// Dado un partido con su `category` (p.ej. 'f7_alevin', 'f11_cadete',
// 'Alevín A', etc.) determina qué miembros del staff deben recibir su
// informe colectivo:
//   • Director Deportivo  → SIEMPRE (no tiene coordinatorType).
//   • Coordinador         → solo si su coordinatorType encaja con la
//                            modalidad del partido (Fútbol 7 o Fútbol 11).
//                            'f711' (o sin tipo) recibe ambas.
//
// La modalidad se deriva del `currentMode`/prefijo de la categoría del
// partido. La Pieza 1 ya persiste `category` (y `subcategory`) en los
// docs cronos_player_reports, así que aquí solo necesitamos clasificar.

// _cronosMatchModality(category[, mode]) → 'f7' | 'f11' | ''
//   `mode` (opcional) es el currentMode del partido ('f7'|'f11'); si se
//   pasa, tiene prioridad porque es la fuente canónica de la modalidad.
//   Si no, se deriva de la categoría: prefijo f7_/f11_ o heurística por
//   nombre de categoría (prebenjamín/benjamín/alevín = F7;
//   infantil/cadete/juvenil/regional = F11).
if (typeof window._cronosMatchModality !== 'function') {
    window._cronosMatchModality = function(category, mode) {
        // 1) Modo explícito (fuente canónica).
        const m = (mode == null ? '' : String(mode)).trim().toLowerCase();
        if (m === 'f7' || m === 'f8') return 'f7';
        if (m === 'f11') return 'f11';

        // 2) Derivar de la categoría.
        const raw = (category == null ? '' : String(category)).trim().toLowerCase();
        if (!raw) return '';
        // 2a) Prefijo canónico f7_/f11_/f8_.
        if (raw.startsWith('f11_') || raw === 'f11') return 'f11';
        if (raw.startsWith('f7_') || raw.startsWith('f8_') ||
            raw === 'f7' || raw === 'f8') return 'f7';
        // 2b) Heurística por etiqueta legible (sin acentos).
        const norm = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (/(prebenjamin|benjamin|alevin|prebenj|chupete|querubin)/.test(norm)) return 'f7';
        if (/(infantil|cadete|juvenil|regional|senior|amateur|aficionado)/.test(norm)) return 'f11';
        return '';
    };
}

// _cronosStaffCoordinatorType(staff) → 'f7' | 'f11' | 'f711' | ''
//   Extrae el coordinatorType de un objeto staff resuelto por _cGetStaff.
//   Puede vivir en la raíz (usuario mono-rol) o dentro de allRoles[] (la
//   entrada de rol 'coordinator'). Devuelve '' si no aplica/ausente.
if (typeof window._cronosStaffCoordinatorType !== 'function') {
    window._cronosStaffCoordinatorType = function(staff) {
        if (!staff) return '';
        const norm = v => {
            const s = (v == null ? '' : String(v)).trim().toLowerCase();
            return (s === 'f7' || s === 'f11' || s === 'f711') ? s : '';
        };
        // 1) Campo raíz (mono-rol o ya promovido).
        let t = norm(staff.coordinatorType || staff.requestedCoordinatorType);
        if (t) return t;
        // 2) Entrada coordinator dentro de allRoles[].
        if (Array.isArray(staff.allRoles)) {
            const ce = staff.allRoles.find(r =>
                r && r.role === 'coordinator' &&
                (r.coordinatorType || r.requestedCoordinatorType));
            if (ce) {
                t = norm(ce.coordinatorType || ce.requestedCoordinatorType);
                if (t) return t;
            }
        }
        return '';
    };
}

// _cronosResolveStaffForMatch(staffList, category[, mode]) → staff[]
//   Filtra la lista de staff (salida de _cGetStaff) según la modalidad del
//   partido. Función PURA: no consulta Firestore ni el DOM.
//   Reglas:
//     • Directores y cualquier rol que no sea 'coordinator' → SIEMPRE.
//     • Coordinador con coordinatorType === modalidad del partido → SÍ.
//     • Coordinador con 'f711' o sin tipo (legacy) → SÍ (recibe ambas).
//     • Coordinador con tipo de la OTRA modalidad → NO.
//     • Si la modalidad no puede determinarse (category vacía/desconocida),
//       no se filtra a nadie (fail-open: mejor enviar de más que perder
//       un informe).
if (typeof window._cronosResolveStaffForMatch !== 'function') {
    window._cronosResolveStaffForMatch = function(staffList, category, mode) {
        const list = Array.isArray(staffList) ? staffList : [];
        const modality = window._cronosMatchModality(category, mode);
        if (!modality) return list.slice(); // fail-open: no se puede clasificar
        return list.filter(s => {
            if (!s || s.role !== 'coordinator') return true; // directores y otros
            const ct = window._cronosStaffCoordinatorType(s);
            if (!ct || ct === 'f711') return true;           // cubre ambas
            return ct === modality;                          // específico
        });
    };
}

// ── Exportación global ────────────────────────────────────────
// Este archivo se carga como <script> clásico (NO type="module"),
// por lo que NO se puede usar `export`. Las funciones ya quedan
// disponibles globalmente como window.escapeHtml / window.escapeAttr.
// Los módulos ES deben referenciarlas desde window.
// ════════════════════════════════════════════════════════════════
// utils.js — Funciones de utilidad y seguridad
// Cronos Fútbol — v5.1
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
        if (!opts.forceNew && existing) {
            return existing;
        }
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
        // Identidad estable del partido: equipo + fecha + rival + huella de la
        // convocatoria (nº de jugadores + sus números/ids). Si dos partidos del
        // mismo equipo ocurren el mismo día contra el mismo rival, la huella de
        // la convocatoria + la hora los diferencia.
        let convoFingerprint = '';
        try {
            const convo = opts.convocation || window.activeConvocation;
            if (Array.isArray(convo)) {
                convoFingerprint = convo
                    .map(p => (p && (p.number != null ? p.number : (p.playerId || p.id || ''))))
                    .join(',');
            }
        } catch (_) { /* sin convocatoria → huella vacía */ }
        const seed = [teamSlug, dateSlug, slugify(opts.rivalName || ''),
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

// ── Exportación global ────────────────────────────────────────
// Este archivo se carga como <script> clásico (NO type="module"),
// por lo que NO se puede usar `export`. Las funciones ya quedan
// disponibles globalmente como window.escapeHtml / window.escapeAttr.
// Los módulos ES deben referenciarlas desde window.
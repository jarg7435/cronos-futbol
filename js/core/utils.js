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

// ── FIX (zona horaria): clave de fecha LOCAL YYYY-MM-DD ───────
// BUG: en todo el flujo de planificación semanal se usaba
//   date.toISOString().substring(0,10)
// para derivar la clave de la semana / de cada día. `toISOString()`
// convierte SIEMPRE a UTC, pero los Date se construyen a medianoche
// LOCAL (mon.setHours(0,0,0,0)). En zonas UTC+ (p.ej. España, UTC+1/+2)
// la medianoche local del lunes cae en el día ANTERIOR en UTC, así que
// la clave retrocedía 1 día (lunes 13 → "2026-07-12"). Esto desincroniza
// el guardado, el envío y la lectura de la semana de entrenamiento.
//
// Este helper devuelve la fecha del calendario LOCAL sin conversión de
// huso, evitando el desplazamiento. Úsalo siempre que la clave deba
// coincidir con el día que ve el usuario.
if (typeof window._cronosLocalDateKey !== 'function') {
    window._cronosLocalDateKey = function(date) {
        const d = (date instanceof Date) ? date : new Date(date);
        if (isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
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

// ── Resolutor de grupo de categoría para Semáforo e Informes ───
// Grupos: 'f7', 'infantil_a', 'infantil_b', 'infantil_c', 'cadete_a', 'cadete_b', 'cadete_c', 'juvenil', 'regional'
if (typeof window.getCategoryGroupKey !== 'function') {
    window.getCategoryGroupKey = function(category, subcategory) {
        const cat = (category == null ? '' : String(category)).trim().toLowerCase();
        const normCat = cat.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const sub = (subcategory == null ? 'A' : String(subcategory)).trim().toUpperCase();

        if (cat.includes('f7') || cat.includes('f8') ||
            /(prebenjamin|benjamin|alevin|prebenj|chupete|querubin)/.test(normCat)) {
            return 'f7';
        }
        if (normCat.includes('infantil')) {
            if (sub === 'B') return 'infantil_b';
            if (sub === 'C') return 'infantil_c';
            return 'infantil_a';
        }
        if (normCat.includes('cadete')) {
            if (sub === 'B') return 'cadete_b';
            if (sub === 'C') return 'cadete_c';
            return 'cadete_a';
        }
        if (normCat.includes('juvenil')) {
            return 'juvenil';
        }
        if (normCat.includes('regional') || normCat.includes('senior') || normCat.includes('aficionado') || normCat.includes('amateur')) {
            return 'regional';
        }
        if (cat.startsWith('f7_')) return 'f7';
        return 'infantil_a';
    };
}

if (typeof window.isParentReportEnabledForCategory !== 'function') {
    window.isParentReportEnabledForCategory = function(category, subcategory) {
        const configs = window._clubCategoryConfigs || {};
        const groupKey = window.getCategoryGroupKey(category, subcategory);
        const groupCfg = configs[groupKey];
        if (groupCfg && typeof groupCfg.sendIndividualReports === 'boolean') {
            return groupCfg.sendIndividualReports;
        }
        return true; // por defecto activo
    };
}

// ── Chat interno (auditoría 2026-07-22): IDs de hilo ÚNICOS y COMPARTIDOS
// entre js/coach/comms/panel.js (lado entrenador) y
// js/coach/reports/club-reports.js (lado director/coordinador) ──────────
// ANTES: cada archivo calculaba el threadId con una fórmula DISTINTA para
// la MISMA relación entrenador<->staff (`{clubId}_{staffUid}` en un lado,
// `{clubId}_{coachUid}` en el otro), así que los mensajes de cada lado se
// guardaban en documentos de Firestore DIFERENTES que nunca se
// reconciliaban ("Error al cargar" / conversación vacía aunque el otro
// lado sí hubiera escrito). Además, la fórmula del lado entrenador no
// incluía el uid del propio entrenador, así que TODOS los entrenadores de
// un club que hablaran con el mismo director/coordinador compartían un
// único hilo. Con este helper ÚNICO (cargado antes que ambos paneles en
// index.html), da igual quién lo calcule: mismo par (entrenador, staff) =
// mismo id SIEMPRE.
// FIX (2ª ronda, tras prueba real): un mismo club puede tener UNA persona
// (mismo uid de Firebase Auth) desempeñando VARIOS roles a la vez (p.ej.
// admin del club que también es director Y coordinador Y entrenador Y
// padre — caso real confirmado por el usuario, no solo de test). Sin el
// parámetro `staffRole`, "coach habla con X-como-director" y "coach habla
// con X-como-coordinador" calculaban el MISMO id en cuanto X era la misma
// cuenta para ambos roles (coachUid+staffUid coincidían) — los mensajes de
// ambas conversaciones se mezclaban en un único hilo. `staffRole` desambigua
// aunque el uid coincida. Con roles/uids normales (una persona por rol) el
// id simplemente lleva un sufijo extra; no hay pérdida de compatibilidad
// hacia delante.
if (typeof window._cronosStaffChatThreadId !== 'function') {
    window._cronosStaffChatThreadId = function(clubId, coachUid, staffUid, staffRole) {
        const roleSlug = staffRole ? `_role_${staffRole}` : '';
        return clubId
            ? `${clubId}_coach_${coachUid}_staff_${staffUid}${roleSlug}`
            : `coach_${coachUid}_staff_${staffUid}${roleSlug}`;
    };
}

// Hilo entre DOS miembros del staff (director <-> coordinador): relación
// simétrica, así que el id se deriva del PAR ordenado — da igual quién de
// los dos lo calcule, siempre sale el mismo id.
if (typeof window._cronosPeerChatThreadId !== 'function') {
    window._cronosPeerChatThreadId = function(clubId, uidA, uidB) {
        const pair = [uidA, uidB].sort().join('_');
        return clubId ? `${clubId}_peer_${pair}` : `peer_${pair}`;
    };
}

// ════════════════════════════════════════════════════════════════
//  _cronosDedupeRecipients(lista) → lista fusionada, sin duplicados
//  ──────────────────────────────────────────────────────────────
//  UNA sola línea por FAMILIAR y CÓDIGO DE JUGADOR. La lista de
//  destinatarios de los informes se compone de hasta CUATRO orígenes que
//  no se conocen entre sí, y cada uno traía su propia copia de la misma
//  persona:
//    1. `emailConfig.contacts` guardados a mano;
//    2. el staff real de Firestore (`_cGetStaff`);
//    3. los vínculos `cronos_player_links`;
//    4. los usuarios con rol 'parent' registrados en el club.
//
//  Las comprobaciones de "¿ya existe?" de cada origen fallaban por dos
//  motivos concretos, y ninguno daba error:
//
//   🔑 EL FAMILIAR SIN `parentUid` NO TIENE IDENTIDAD ESTABLE. En
//     contact-manager.js el id sale de `l.parentUid || l.uid || l._id`, y
//     ese último respaldo es el ID DEL DOCUMENTO DEL VÍNCULO. Dos vínculos
//     del mismo familiar dan dos ids distintos, así que la comprobación no
//     los reconocía y se colaban dos líneas del mismo padre.
//
//   🔑 CADA ORIGEN COMPARA POR UN CAMPO DISTINTO. Uno mira `uid`, otro
//     `email`, otro `phone`. Si la copia A trae sólo el correo y la copia B
//     sólo el teléfono, NINGUNA comparación las une. Por eso aquí no se
//     compara por un campo elegido de antemano: dos entradas son la misma
//     persona si comparten CUALQUIER identificador.
//
//  ⚠️ EL CÓDIGO DEL JUGADOR FORMA PARTE DE LA IDENTIDAD, y es lo que
//  impide "arreglar" esto de más: un padre con DOS hijos convocados tiene
//  que seguir viendo DOS líneas, porque son dos informes distintos. Sin
//  esta parte de la clave, el segundo hijo desaparecería en silencio.
//
//  ⚠️ Y NO SE FUSIONA ENTRE ROLES: quien es a la vez staff y padre recibe
//  el resumen global Y el informe individual de su hijo. Son dos envíos
//  reales, no una duplicidad.
//
//  Fusionar, no descartar: la línea que sobrevive se queda con el correo,
//  el teléfono y el nombre más completos de todas sus copias, y con la
//  lista de ids en `_ids` para que una preselección guardada con el id de
//  una copia descartada siga marcando la casilla.
// ════════════════════════════════════════════════════════════════
if (typeof window._cronosRecipientKeyParts !== 'function') {
    window._cronosRecipientKeyParts = function(c) {
        const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
        // El teléfono se reduce a sus dígitos y se queda con los 9 últimos:
        // el mismo número aparece como '+34 600 11 22 33', '0034600112233'
        // y '600112233' según quién lo escribiera.
        const tel = String(c && c.phone != null ? c.phone : '').replace(/\D/g, '');
        return {
            uid:   norm(c && c.uid),
            email: norm(c && c.email),
            phone: tel.length > 9 ? tel.slice(-9) : tel,
            name:  norm((c && (c.name || c.label)) || '').replace(/\s+/g, ' '),
        };
    };
}

if (typeof window._cronosRecipientScope !== 'function') {
    window._cronosRecipientScope = function(c) {
        const tipo = String((c && c.type) || '').trim().toLowerCase() || 'staff';
        if (tipo !== 'parent') return tipo;   // el staff no se agrupa por jugador
        const pid = String((c && c.playerId) || '').trim().toLowerCase();
        const num = String((c && c.playerNumber) != null ? c.playerNumber : '').trim();
        // Sin código de jugador se cae al nombre del jugador; y si tampoco lo
        // hay, al ámbito vacío (todas las copias sin jugador se funden).
        const jugador = pid || (num ? '#' + num : '') ||
                        String((c && c.player) || '').trim().toLowerCase();
        return tipo + '|' + jugador;
    };
}

if (typeof window._cronosDedupeRecipients !== 'function') {
    window._cronosDedupeRecipients = function(lista) {
        if (!Array.isArray(lista)) return [];
        const partesDe = window._cronosRecipientKeyParts;
        const ambitoDe = window._cronosRecipientScope;

        const cubos = [];          // conserva el orden de aparición
        const porAmbito = new Map();

        const compartenIdentidad = (a, b) => (
            (!!a.uid   && a.uid   === b.uid) ||
            (!!a.email && a.email === b.email) ||
            (!!a.phone && a.phone === b.phone) ||
            // El nombre sólo vale cuando NINGUNA de las dos aporta un
            // identificador fuerte: dos "Padre/Tutor" distintos con correo
            // propio no pueden fundirse por llamarse igual.
            (!!a.name  && a.name  === b.name &&
             !a.uid && !b.uid && !a.email && !b.email && !a.phone && !b.phone)
        );

        lista.forEach((c) => {
            if (!c) return;
            const ambito = ambitoDe(c);
            const partes = partesDe(c);
            const candidatos = porAmbito.get(ambito) || [];
            const cubo = candidatos.find(b => compartenIdentidad(b._partes, partes));

            if (!cubo) {
                const nuevo = Object.assign({}, c, {
                    _partes: partes,
                    _ids: [c.id].filter(v => v != null && v !== ''),
                });
                cubos.push(nuevo);
                candidatos.push(nuevo);
                porAmbito.set(ambito, candidatos);
                return;
            }

            // ── Fusión: la línea superviviente se queda con lo más completo ──
            ['email', 'phone', 'uid', 'name', 'label', 'player', 'playerId',
             'playerNumber', 'sublabel', 'category', 'subcategory', 'role'
            ].forEach((campo) => {
                if (!cubo[campo] && c[campo]) cubo[campo] = c[campo];
            });
            if (Array.isArray(c.tags)) {
                const tags = new Set([].concat(cubo.tags || [], c.tags));
                cubo.tags = Array.from(tags);
            }
            if (c.defaultOn) cubo.defaultOn = true;
            if (c.id != null && c.id !== '' && cubo._ids.indexOf(c.id) === -1) {
                cubo._ids.push(c.id);
            }
            // Los identificadores recién incorporados pasan a contar para las
            // comparaciones siguientes: así una tercera copia que sólo traiga
            // el teléfono también reconoce a este cubo.
            cubo._partes = partesDe(cubo);
        });

        return cubos.map((b) => { const o = Object.assign({}, b); delete o._partes; return o; });
    };
}

// ── Exportación global ────────────────────────────────────────
// Este archivo se carga como <script> clásico (NO type="module"),
// por lo que NO se puede usar `export`. Las funciones ya quedan
// disponibles globalmente como window.escapeHtml / window.escapeAttr.
// Los módulos ES deben referenciarlas desde window.
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
        // 'futurefem' es F7 y 'regional_fem' F11 (éste ya entra por 'regional').
        if (/(prebenjamin|benjamin|alevin|prebenj|chupete|querubin)/.test(norm)) return 'f7';
        if (/(infantil|cadete|juvenil|regional|senior|amateur|aficionado|futurefem)/.test(norm)) return 'f11';
        return '';
    };
}

// ════════════════════════════════════════════════════════════════════
//  v537 · UN ENTRENADOR: COMO MUCHO DOS EQUIPOS, Y UNO DE CADA MODALIDAD
//
//  Regla de negocio del autor (2026-08-15): en un MISMO club un entrenador
//  puede llevar como máximo dos equipos, y obligatoriamente uno de Fútbol 7 y
//  otro de Fútbol 11. Dos de F7 o dos de F11 están PROHIBIDOS.
//
//  ⚠️ NO ESTABA IMPLEMENTADA EN NINGÚN SITIO. Medido por REST antes de escribir
//  nada: en producción existe un caso con esa forma —brunoromar2012 con
//  `juvenil B` y `cadete C`, ambos F11 en el mismo club— y nada lo impidió.
//
//  🔑 La modalidad NO se pregunta ni se guarda aparte: se deriva de la
//  categoría con `_cronosMatchModality`, que ya es la forma canónica del
//  proyecto. Un campo nuevo habría creado una segunda verdad que mantener.
//
//  ⚠️ SÓLO CUENTAN LOS ROLES VIVOS del MISMO club: un rol revocado
//  (`status:'removed'`) o no autorizado deja su plaza libre, y otro club es
//  otro asunto. Contar los muertos bloquearía altas legítimas.
//  ⚠️ Y SÓLO LOS ROLES QUE LLEVAN EQUIPO (ver `CRONOS_ROLES_CON_EQUIPO`):
//  coordinador, director o padre no ocupan equipo en este sentido.
//
//  Devuelve { ok, motivo, actuales }. `motivo` es el texto que se enseña.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  ⚽ v598 · QUÉ ROLES LLEVAN EQUIPO — UNA SOLA LISTA PARA TODO EL PROYECTO
//
//  Existía la MISMA idea escrita dos veces y con dos contenidos distintos:
//    · `cronosPuedeLlevarEquipo` (el candado de los dos equipos) → ['user']
//    · `cronosEquiposDeEntrenador` (el selector de equipo)       → ['user','coach']
//  O sea que un rol podía aparecer en el selector y ser invisible para el
//  candado, o al revés. Con el ente unificado ('individual') eso dejaba de ser
//  teórico: sin tocar las dos, o el candado no le cerraba o el selector no le
//  ofrecía sus equipos — y cada mitad parecería correcta por separado.
//
//  🔑 ES EL PATRÓN QUE ESTE PROYECTO LLEVA APRENDIENDO A GOLPES: la misma regla
//  en dos sitios diverge (v511 con las categorías FEM en 7 cascadas, v533 con
//  el badge 7 vs lista 4, v538 con FUTureFEM en cuatro clasificadores).
//
//  ⚠️ 'coach' es un alias histórico de 'user' que sólo leía el selector.
//  Al unificar entra también en el candado, que es lo correcto: una plaza de
//  entrenador ocupa equipo se llame como se llame.
// ════════════════════════════════════════════════════════════════════
if (!Array.isArray(window.CRONOS_ROLES_CON_EQUIPO)) {
    window.CRONOS_ROLES_CON_EQUIPO = ['user', 'coach', 'individual', 'admin_individual'];
}

if (typeof window.cronosPuedeLlevarEquipo !== 'function') {
    window.cronosPuedeLlevarEquipo = function (allRoles, nuevaCategoria, clubId, opciones) {
        const o = opciones || {};
        const modal = (c) => (typeof window._cronosMatchModality === 'function')
            ? window._cronosMatchModality(c) : '';
        const nueva = modal(nuevaCategoria);
        const roles = Array.isArray(allRoles) ? allRoles : [];
        const mismoClub = (r) => String((r && r.clubId) || '') === String(clubId || '');
        const vivo = (r) => r && r.status !== 'removed' && r.isAuthorized !== false;
        // ══════════════════════════════════════════════════════════════
        //  ⚽ v598 · EL ENTE UNIFICADO TAMBIÉN LLEVA EQUIPOS
        //
        //  Encargo del autor (2026-08-21): el Entrenador Administrador
        //  Individual «podrá registrarse y operar en dos categorías y dos
        //  subcategorías diferentes (por ejemplo, una de Fútbol 7 y otra de
        //  Fútbol 11), mientras que el resto se quedarán inhabilitadas».
        //
        //  🔑 ESO ES **EXACTAMENTE** LA REGLA QUE YA VIVÍA AQUÍ desde la v537:
        //  máximo dos equipos, y obligatoriamente uno de cada modalidad. No se
        //  ha escrito una regla nueva ni un segundo validador — habría sido la
        //  segunda fuente de verdad y el siguiente fallo. Sólo se amplía QUIÉN
        //  cuenta como entrenador.
        //
        //  🔴 Y HACÍA FALTA, porque el filtro era `r.role === 'user'` a secas:
        //  con el rol unificado escribiéndose como 'individual', el validador
        //  le contaba CERO equipos y le dejaba pasar cualquier cosa. El candado
        //  parecía puesto y no cerraba sobre él.
        //
        //  ⚠️ EL ANCLA SIGUE SIENDO `clubId` para los dos casos: en un ente
        //  individual, `clubId` guarda el id del ENTE (v583). Por eso `mismoClub`
        //  vale tal cual y no hay que tocarlo.
        // ══════════════════════════════════════════════════════════════
        const esEntrenador = (r) => !!r &&
            (window.CRONOS_ROLES_CON_EQUIPO || ['user']).indexOf(r.role) >= 0;

        // Los equipos que YA lleva en ese club. Se puede excluir uno: al MOVER
        // a alguien de equipo su plaza actual se libera, y sin esto un cambio
        // de F7 a F7 se rechazaría contra sí mismo.
        const actuales = roles.filter(function (r) {
            if (!esEntrenador(r) || !vivo(r) || !mismoClub(r) || !r.category) return false;
            if (o.excluyeCategoria && String(r.category) === String(o.excluyeCategoria)) return false;
            return true;
        });

        // Sin modalidad no se puede juzgar. NO se bloquea: impedir un alta
        // legítima por una categoría que no sepamos clasificar es peor que
        // dejar pasar un caso raro que un humano puede revisar.
        if (!nueva) return { ok: true, motivo: '', actuales: actuales };

        if (actuales.length >= 2) {
            return { ok: false, actuales: actuales,
                motivo: 'Ya lleva ' + actuales.length + ' equipos en este club, que es el máximo. ' +
                        'Un entrenador puede llevar como mucho dos: uno de Fútbol 7 y otro de Fútbol 11.' };
        }

        const choca = actuales.filter(function (r) { return modal(r.category) === nueva; })[0];
        if (choca) {
            return { ok: false, actuales: actuales,
                motivo: 'Ya lleva un equipo de ' + (nueva === 'f7' ? 'Fútbol 7' : 'Fútbol 11') +
                        ' en este club (' + String(choca.category) +
                        (choca.subcategory ? ' ' + choca.subcategory : '') + '). ' +
                        'El segundo equipo tiene que ser de ' +
                        (nueva === 'f7' ? 'Fútbol 11' : 'Fútbol 7') + '.' };
        }

        return { ok: true, motivo: '', actuales: actuales };
    };
}

// ════════════════════════════════════════════════════════════════════
//  v540 · LA UNIDAD ES LA PLAZA, NO EL ROL
//
//  v537 permitió que un entrenador lleve DOS equipos (un F7 y un F11) en el
//  mismo club. Eso significa DOS entradas `role:'user'` en el mismo
//  `allRoles`, y a partir de ahí cualquier
//      allRoles.find(r => r.role === 'user')
//  coge una al azar, y cualquier
//      allRoles.map(r => r.role === 'user' ? activar : r)
//  toca las DOS. El proyecto estaba lleno de las dos formas.
//
//  🔑🔑🔑 NO ES TEÓRICO. Medido por REST en producción (brunoromar2012):
//  su solicitud de `benjamin` figura `sa_approved` desde el 14/08 y en
//  `allRoles` NO EXISTE ninguna entrada de benjamin — el aprobar casó por
//  rol, reactivó las plazas viejas (juvenil, cadete) y nunca creó la nueva.
//  La persona se quedó sin el equipo que le habían concedido.
//
//  🔑 LA PLAZA de un entrenador es (rol, club, categoría, subcategoría).
//  Para los demás roles es sólo (rol, club): un padre o un director no
//  ocupan equipo, y meterles la categoría en la identidad haría que pudieran
//  pedir el mismo rol una y otra vez.
//
//  ⚠️ Se compara con `cronosTeamSlug`, la MISMA normalización con la que se
//  construye el teamId. Los datos reales traen "Alevín" y "alevin" para el
//  mismo equipo, y dos criterios distintos partirían el equipo en dos.
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosMismaPlaza !== 'function') {
    window.cronosMismaPlaza = function (a, b) {
        if (!a || !b) return false;
        const rolA = String(a.role || '');
        const rolB = String(b.role || '');
        if (!rolA || rolA !== rolB) return false;
        if (String(a.clubId || '') !== String(b.clubId || '')) return false;
        // Sólo el entrenador ocupa EQUIPO.
        if (rolA !== 'user' && rolA !== 'coach') return true;
        const slug = (typeof cronosTeamSlug === 'function')
            ? cronosTeamSlug
            : function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
        return slug(a.category || a.categoryLabel) === slug(b.category || b.categoryLabel) &&
               slug(a.subcategory) === slug(b.subcategory);
    };
}

// Nombre legible de una categoría cruda ('benjamin' → 'Benjamín'). Sirve para
// enseñar la plaza en el selector de equipo y en los avisos.
// ⚠️ LAS DOS FEM VAN DELANTE: 'regional_fem' contiene 'regional', y con el
// orden ingenuo una entrenadora de Regional FEM vería "Regional" a secas.
if (typeof window.cronosNombreCategoria !== 'function') {
    window.cronosNombreCategoria = function (category, subcategory) {
        const crudo = (category == null ? '' : String(category)).trim();
        if (!crudo) return '';
        // ⚠️ Los acentos se quitan POR CÓDIGO DE CARÁCTER, nunca con una clase
        // de regex: el bloque combinante escrito dentro de una expresión acaba
        // en el fichero como marcas sueltas invisibles y cualquier paso que
        // toque la codificación las destruye SIN ERROR (ver cronosTeamSlug).
        const n = (typeof _cronosNoEsAcento === 'function')
            ? crudo.normalize('NFD').split('').filter(_cronosNoEsAcento).join('').toLowerCase()
            : crudo.toLowerCase();
        let base = '';
        if (n.includes('futurefem'))                        base = 'FUTureFEM';
        else if (n.includes('regional') && n.includes('fem')) base = 'Regional FEM';
        else if (n.includes('prebenj'))                     base = 'Prebenjamín';
        else if (n.includes('benj'))                        base = 'Benjamín';
        else if (n.includes('alev'))                        base = 'Alevín';
        else if (n.includes('infant'))                      base = 'Infantil';
        else if (n.includes('cadet'))                       base = 'Cadete';
        else if (n.includes('juvenil'))                     base = 'Juvenil';
        else if (n.includes('regional'))                    base = 'Regional';
        else if (n.includes('senior'))                      base = 'Senior';
        else if (n.includes('amateur') || n.includes('aficionado')) base = 'Aficionado';
        else base = crudo.charAt(0).toUpperCase() + crudo.slice(1);
        const sub = (subcategory == null ? '' : String(subcategory)).trim();
        return sub ? base + ' ' + sub : base;
    };
}

// Equipos VIVOS que lleva un entrenador en un club. Es de donde lee el
// selector de doble modalidad del panel del entrenador (v540).
//
// ⚠️ FILTRO ESTRICTO, EL MISMO QUE showRoleSelection: sólo
// `isAuthorized === true` Y `status === 'active'`. Un equipo pendiente de
// aprobación o revocado no se puede elegir; enseñarlo dejaría entrar en un
// equipo que todavía —o ya— no es suyo.
if (typeof window.cronosEquiposDeEntrenador !== 'function') {
    window.cronosEquiposDeEntrenador = function (allRoles, clubId) {
        const roles = Array.isArray(allRoles) ? allRoles : [];
        const modal = (c) => (typeof window._cronosMatchModality === 'function')
            ? window._cronosMatchModality(c) : '';
        const out = [];
        roles.forEach(function (r) {
            // ⚽ v598 · La MISMA lista que usa el candado de los dos equipos
            //    (`CRONOS_ROLES_CON_EQUIPO`, arriba). Antes aquí decía
            //    ['user','coach'] a mano y allí ['user']: dos versiones de
            //    "quién lleva equipo" que ya no pueden separarse.
            if (!r || (window.CRONOS_ROLES_CON_EQUIPO || ['user', 'coach']).indexOf(r.role) < 0) return;
            if (r.isAuthorized !== true || r.status !== 'active') return;
            if (clubId && String(r.clubId || '') !== String(clubId)) return;
            const cat = r.category || r.categoryLabel || '';
            if (!cat) return;
            out.push({
                role:        r.role,
                clubId:      r.clubId || clubId || '',
                clubName:    r.clubName || '',
                category:    cat,
                subcategory: r.subcategory || '',
                modalidad:   modal(cat),
                etiqueta:    window.cronosNombreCategoria(cat, r.subcategory),
                teamId:      (typeof cronosTeamId === 'function')
                                ? cronosTeamId(r.clubId || clubId || '', cat, r.subcategory || '')
                                : '',
                _rol:        r,
            });
        });
        return out;
    };
}

// ════════════════════════════════════════════════════════════════════
//  v541 · ¿SE PUEDE RECARGAR LA PÁGINA AHORA MISMO?
//
//  La app se actualiza sola cuando hay versión nueva (ver el bloque de la
//  insignia en index.html). Pero esto es un CRONÓMETRO DE PARTIDOS EN VIVO:
//  una recarga a destiempo es peor que la caché vieja que venía a arreglar.
//
//  🔑🔑🔑 LOS FLAGS BUENOS SON `isRunning` y `matchPhase` (js/core/app-init.js,
//  `var` en script clásico → globales). En v540 escribí una guarda con
//  `window.matchStarted` / `window.isMatchRunning`: NINGUNA DE LAS DOS EXISTE
//  en este proyecto, así que la guarda nunca se activó. Un nombre inventado no
//  da error: da `undefined`, la condición sale falsa y el candado no cierra
//  jamás — en silencio.
//
//  ⚠️ `matchPhase` NACE en '1st_half' aunque no haya empezado nada, así que por
//  sí solo diría "hay partido" SIEMPRE.
//
// ════════════════════════════════════════════════════════════════════
//  🚨🚨🚨 v556 · ESTA FUNCIÓN MENTÍA SIEMPRE QUE SÍ, Y BLOQUEÓ EL SELECTOR
//
//  Reportado por el autor (captura 9039): al entrenador con dos equipos el
//  panel no le dejaba pulsar el segundo — le salía "Termina o cierra el
//  partido en curso antes de cambiar de equipo" SIN HABER EMPEZADO NINGUNO.
//
//  🔑🔑🔑 EL CAMPO SE PONE VISIBLE EN EL LOGIN, NO AL EMPEZAR EL PARTIDO.
//  `role-launch.js` hace `#main-container.style.display = 'flex'` para todo
//  rol de campo nada más entrar (línea 466), y `matchPhase` nace en
//  '1st_half' (app-init.js:110). O sea: las DOS condiciones de la versión
//  anterior estaban cumplidas desde el primer segundo de la sesión, con el
//  cronómetro a cero y sin un solo jugador en el campo. La función devolvía
//  `true` SIEMPRE, y el candado que colgaba de ella cerraba SIEMPRE.
//
//  🔑🔑 "EL CAMPO ESTÁ A LA VISTA" NO ERA MEDIBLE ASÍ: el panel de setup se
//  pinta ENCIMA (#setup-modal en 'flex'), sin ocultar el campo — es
//  deliberado, para no destruir el estado del partido que haya debajo
//  (team-persistence.js). Con el panel abierto, lo que se ve es el panel.
//
//  Lo que de verdad distingue un partido de una sesión recién abierta es que
//  HAYA CORRIDO EL RELOJ: `isRunning`, o tiempo acumulado en cualquiera de
//  las dos partes. Eso no se puede confundir con el estado inicial.
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosHayPartidoEnCurso !== 'function') {
    window.cronosHayPartidoEnCurso = function () {
        try {
            // 1) El cronómetro corriendo no admite discusión.
            if (window.isRunning === true) return true;

            // 2) El panel de configuración tapa el campo: si está abierto, lo
            //    que el usuario tiene delante es el panel, no un partido.
            const panel = document.getElementById('setup-modal');
            if (panel && panel.style && panel.style.display &&
                panel.style.display !== 'none') return false;

            // 3) El campo a la vista y sin terminar: cuenta también el
            //    DESCANSO y el partido en pausa.
            const campo = document.getElementById('main-container');
            const visible = !!campo && campo.style && campo.style.display !== 'none';
            if (!visible) return false;
            const fase = window.matchPhase;
            if (fase === 'finished' || fase === 'idle') return false;

            // 4) ⚠️ Y QUE EL RELOJ HAYA CORRIDO. Sin esto, la fase inicial
            //    '1st_half' bastaría para afirmar que hay partido nada más
            //    entrar — que es exactamente el defecto de v541.
            const jugado = (Number(window.masterTimeH1) || 0) +
                           (Number(window.masterTimeH2) || 0);
            return jugado > 0;
        } catch (_) {
            // Ante la duda, NO se afirma que haya partido: quien llama sólo
            // deja de recargar, y bloquear para siempre sería peor.
            return false;
        }
    };
}

// ⚠️⚠️ v544 · AQUÍ VIVÍA `cronosEsSeguroRecargar`, Y SE HA RETIRADO.
//
//  Servía a la recarga automática que metí en v541 para que una pestaña ya
//  abierta se enterase de las versiones nuevas. Esa recarga **causó el fallo
//  siguiente**: el autor veía *"el checkbox aparece un segundo y desaparece"*
//  porque, tras recargar, la aplicación arranca en modo LOGIN y ahí la casilla
//  del RGPD está oculta POR DISEÑO. No la ocultaba ningún script: se la llevaba
//  por delante mi recarga.
//
//  🔑 Producción (v539) NO TIENE NADA DE ESTO y al autor le funciona sin un
//  fallo — lo comprobó en A/B el 2026-08-16 (capturas 8953/8954 contra 8955).
//  Su instrucción: *"replica lo que ya sabemos que funciona"*. Retirado entero,
//  igual que se retiraron las cinco capas de v477→v500.
//
//  `cronosHayPartidoEnCurso` SÍ se queda: no tiene nada que ver con recargas
//  —la usa el selector de equipo de v540— y arregla una guarda que hasta ahora
//  no protegía nada porque miraba flags inexistentes.

// ════════════════════════════════════════════════════════════════════
//  🎛️ v590 · EL TABLERO DE BOTONES, EN UN SOLO SITIO
//
//  Petición del autor (2026-08-19): los paneles de Dirección, Coordinación y
//  Familias enseñaban sus árboles directamente en pestañas planas. Quiere que
//  entren por un TABLERO de botones grandes, como el del entrenador, y que
//  cada botón lleve a su vista.
//
//  🔑 UNA SOLA PIEZA PARA LOS TRES. Tres tableros copiados se irían separando
//  al primer retoque —es la historia de este proyecto: los contadores del
//  ente, las listas de grupos, la regla del semáforo en cuatro copias—. Aquí
//  se define el aspecto una vez y cada panel sólo aporta SUS opciones.
//
//  🔑 ES ADITIVO, NO SUSTITUTIVO: las pestañas siguen existiendo y siguen
//  funcionando. El tablero es la pantalla de entrada y un atajo; si algo
//  fallara en él, el panel de siempre está a un clic. Sustituir la navegación
//  entera de tres paneles a ciegas —sin poder verlos— habría sido temerario.
//
//  ⚠️ CADA OPCIÓN PUEDE IR BLOQUEADA (`bloqueado: 'motivo'`): un extra no
//  contratado se enseña apagado y DICE por qué, en vez de desaparecer. Que
//  una opción se esfume sin explicación es lo que hace pensar que la
//  aplicación está rota.
//
//  🔴 v598 · CADA OPCIÓN PUEDE LLEVAR AVISO (`badge: 3`)
//  Antes, quien tenía pendientes lo señalaba pegando ' · 3' al TÍTULO. Eso se
//  pinta con la misma tipografía, el mismo tamaño y el mismo color que el
//  resto del rótulo: es texto, no un aviso, y desde el tablero no se ve. El
//  autor lo reportó el 2026-08-21 ("que aparezca un badge o aviso visual
//  claro"). Ahora es una píldora roja con su número, arriba a la derecha de la
//  tarjeta, y el título vuelve a ser sólo el título.
//
//  ⚠️ EL BADGE NO SE PINTA SI LA OPCIÓN ESTÁ BLOQUEADA. Anunciar "3
//  pendientes" sobre una puerta cerrada con llave es prometer algo que no se
//  puede ir a ver. `badge` se ignora también cuando vale 0, '' o null: un
//  contador a cero no es una novedad, y una píldora con un 0 dentro llama la
//  atención exactamente igual que una con un 5.
//
//  Uso:
//    window.cronosTableroHtml({
//      titulo: '📋 Panel de Dirección',
//      subtitulo: 'Elige qué quieres consultar',
//      opciones: [{ icono:'📋', titulo:'Convocatorias', desc:'…',
//                   onclick:"switchStaffTab('convocatorias')",
//                   color:'#3fb950', bloqueado:'', badge:0 }]
//    })  →  string HTML
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosTableroHtml !== 'function') {
    window.cronosTableroHtml = function (cfg) {
        const c = cfg || {};
        const esc = (s) => (typeof escapeHtml === 'function')
            ? escapeHtml(s == null ? '' : s)
            : String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const opciones = Array.isArray(c.opciones) ? c.opciones : [];
        const tarjetas = opciones.map(function (o) {
            const color = o.color || '#58a6ff';
            const bloqueado = !!o.bloqueado;
            // 0, '', null y undefined NO son aviso. `Number(x) === 0` descarta
            // también el '0' que llega como cadena desde un `.length` formateado.
            const badge = (bloqueado || o.badge == null || o.badge === '' || Number(o.badge) === 0)
                ? '' : String(o.badge);
            // Un botón bloqueado no lleva onclick: apagarlo sólo con CSS deja
            // la acción viva para quien pulse igual (la lección de v548 —
            // `disabled` es cosmético).
            const accion = bloqueado ? '' : ' onclick="' + String(o.onclick || '') + '"';
            return '' +
            '<button type="button"' + accion +
            ' title="' + esc(bloqueado ? o.bloqueado : (o.desc || o.titulo)) + '"' +
            ' style="display:flex;flex-direction:column;align-items:flex-start;gap:0.35rem;' +
                    'padding:1.05rem 1.1rem;border-radius:14px;text-align:left;width:100%;' +
                    'background:' + (bloqueado ? 'rgba(255,255,255,0.03)' : 'rgba(' + _cronosHexRgb(color) + ',0.10)') + ';' +
                    'border:1px solid ' + (bloqueado ? 'rgba(255,255,255,0.08)' : 'rgba(' + _cronosHexRgb(color) + ',0.45)') + ';' +
                    'color:' + (bloqueado ? '#6b7280' : color) + ';' +
                    'cursor:' + (bloqueado ? 'not-allowed' : 'pointer') + ';' +
                    'transition:transform 0.12s ease, box-shadow 0.12s ease;"' +
            (bloqueado ? '' :
              ' onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 8px 22px rgba(0,0,0,0.35)\';"' +
              ' onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\';"') + '>' +
                // Fila del icono: el badge se ancla a la DERECHA de esta fila.
                // Va dentro del flujo (no `position:absolute`) para que no se
                // solape con el título cuando la tarjeta se estrecha en móvil.
                '<span style="display:flex;align-items:center;justify-content:space-between;' +
                      'width:100%;gap:0.5rem;">' +
                    '<span style="font-size:1.5rem;line-height:1;">' + (bloqueado ? '🔒' : esc(o.icono || '•')) + '</span>' +
                    (badge ? '<span style="flex:0 0 auto;background:#ff5858;color:white;' +
                                    'font-size:0.72rem;font-weight:800;line-height:1;' +
                                    'padding:0.25rem 0.5rem;border-radius:999px;min-width:1.25rem;' +
                                    'text-align:center;box-shadow:0 2px 8px rgba(255,88,88,0.45);">' +
                                esc(badge) + '</span>'
                            : '') +
                '</span>' +
                '<span style="font-size:0.95rem;font-weight:800;letter-spacing:0.2px;">' + esc(o.titulo || '') + '</span>' +
                '<span style="font-size:0.72rem;color:#8b949e;font-weight:500;line-height:1.35;">' +
                    esc(bloqueado ? o.bloqueado : (o.desc || '')) + '</span>' +
            '</button>';
        }).join('');

        return '' +
        '<div style="max-width:900px;margin:0 auto;">' +
            (c.titulo ? '<h3 style="margin:0 0 0.25rem;font-size:1.05rem;color:white;">' + esc(c.titulo) + '</h3>' : '') +
            (c.subtitulo ? '<p style="margin:0 0 1.2rem;font-size:0.8rem;color:#8b949e;">' + esc(c.subtitulo) + '</p>' : '') +
            '<div style="display:grid;gap:0.7rem;' +
                 'grid-template-columns:repeat(auto-fill,minmax(210px,1fr));">' +
                tarjetas +
            '</div>' +
        '</div>';
    };
    // '#58a6ff' → '88,166,255'. Sin esto no se puede componer un rgba() con
    // transparencia a partir del color de cada opción.
    function _cronosHexRgb(hex) {
        const h = String(hex || '').replace('#', '').trim();
        if (h.length !== 6) return '88,166,255';
        const n = parseInt(h, 16);
        if (isNaN(n)) return '88,166,255';
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
    }
    window._cronosHexRgb = _cronosHexRgb;
}

// ════════════════════════════════════════════════════════════════════
//  🔴🔴🔴 v583 · ¿ESTA PLAZA ES DE ESTE ENTE INDIVIDUAL?
//
//  Reporte del autor (2026-08-19): al crear un ente individual con un correo
//  que YA tenía plaza en un club (`brunoromar2012`, entrenador del Benjamín C
//  de CD DÍA), el panel enseñaba **dos plazas**: la de Administrador
//  Individual —correcta— y una de **Entrenador Individual que nadie había
//  creado**.
//
//  🔑🔑🔑 NO SE CREÓ NINGÚN ROL: se CONTÓ el de otro sitio. Medido en la base
//  el mismo día: su documento tiene UNA sola entrada de entrenador y dice
//  `clubId:'club_mqvr9m11_g9kj'` — CD DÍA. Los contadores del ente miraban
//  `allRoles.some(r => r.role === 'user' && r.isAuthorized)` **sin preguntar a
//  qué club o ente pertenecía esa entrada**, así que su equipo del club se
//  contaba como equipo del ente. Lo mismo hacía el árbol de "Ver usuarios".
//
//  🔑 LA REGLA, que es la que el autor lleva pidiendo desde el principio: los
//  datos y roles de clubes y entes distintos NO se cruzan. Una plaza pertenece
//  a UN sitio, y ese sitio está escrito en la propia entrada.
//
//  ⚠️ LA CLÁUSULA DE COMPATIBILIDAD ES ESTRECHA A PROPÓSITO: una entrada de un
//  rol EXPLÍCITAMENTE individual y sin ningún ancla se acepta como del ente
//  (las hay antiguas, y es el mismo criterio que ya usa el borrado de entes en
//  v566). `user` y `parent` NO entran ahí: sin ancla podrían ser de cualquier
//  club, y darlas por del ente es justo el cruce que esto viene a cerrar.
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosRolDelEnte !== 'function') {
    // Roles que sólo existen dentro de un ente individual.
    window.CRONOS_ROLES_INDIVIDUALES = ['individual', 'admin_individual',
        'parent_individual', 'entrenador_individual', 'padre_individual'];
    window.cronosRolDelEnte = function (r, entityId) {
        if (!r || !entityId) return false;
        const id = String(entityId);
        if (String(r.clubId || '')             === id) return true;
        if (String(r.individualEntityId || '') === id) return true;
        if (String(r.individualOwnerId || '')  === id) return true;
        // Legado: rol individual sin ningún ancla (ver el aviso de arriba).
        return window.CRONOS_ROLES_INDIVIDUALES.indexOf(r.role) >= 0 &&
               !r.clubId && !r.individualEntityId && !r.individualOwnerId;
    };
}

// ════════════════════════════════════════════════════════════════════
//  v553 · LAS PLAZAS OCUPADAS SE CUENTAN, NO SE GUARDAN
//
//  El panel del SuperAdmin enseñaba "5 / 10 entrenadores" leyendo
//  `clubs/{id}.usedSlots.users`, un contador que se incrementa y decrementa A
//  MANO en cada alta y cada baja. Basta con que una de esas operaciones falle,
//  se repita o se salte para que el número quede mintiendo **para siempre**:
//  medido en CD DÍA, `usedSlots.users` valía **-1**.
//
//  🔑 UN CONTADOR DERIVADO NO SE ALMACENA: SE CALCULA. La verdad está en
//  `allRoles`, y contarla cuesta un bucle sobre usuarios que el panel YA tiene
//  cargados. Así no hay nada que se pueda desincronizar.
//
//  🔑🔑 SE CUENTAN PLAZAS, NO PERSONAS. Desde v537 un entrenador puede llevar
//  dos equipos (un F7 y un F11): son DOS equipos que atender y ocupan DOS
//  plazas. El panel del club contaba PERSONAS (un Set de uid), así que a un
//  club con seis equipos y cinco entrenadores le decía "5" — que es
//  exactamente la incoherencia reportada.
//
//  ⚠️ Sólo cuentan las plazas VIVAS: `isAuthorized === true` y sin `removed`
//  ni `rejected`. Un rol revocado no ocupa sitio.
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosPlazasOcupadas !== 'function') {
    // ════════════════════════════════════════════════════════════════
    //  🔴🔴🔴 v582 · SE CUENTAN PLAZAS **DISTINTAS**, NO ENTRADAS
    //
    //  Reporte del autor (capturas 9263/9264): "9 entrenadores cuando
    //  deberían ser 7", y el panel del Club diciendo **11/10 · Límite
    //  alcanzado** — un club con 7 equipos que ya no admite ninguno más.
    //
    //  Medido por REST en CD DÍA: 5 documentos, 7 plazas de entrenador con
    //  equipo… y CUATRO entradas más, todas de la misma forma:
    //      { role:'user', clubId:'…', category:null, subcategory:null,
    //        isAuthorized:true, status:'active' }
    //  una por entrenador. 7 + 4 = 11. El número no se equivocaba: contaba
    //  fielmente unas entradas que no son equipos de nadie.
    //
    //  🔑🔑🔑 LA UNIDAD ES LA PLAZA (rol + club + categoría), no el renglón
    //  del array. Este bucle sumaba UNA POR ENTRADA, así que cualquier
    //  registro repetido o a medio escribir inflaba la cuota y podía llegar
    //  a cerrarle el club al autor. Dos reglas, las mismas que ya aplica el
    //  árbol de categorías desde v581:
    //
    //   1. La MISMA plaza escrita dos veces es UNA plaza.
    //   2. Para un rol CON equipo (entrenador), una entrada sin categoría
    //      no es un equipo: si esa persona ya tiene un equipo de ese rol en
    //      ese club, la entrada vacía es un resto y no ocupa plaza. Si es lo
    //      único que tiene, SÍ ocupa: es alguien real esperando asignación,
    //      y sale en el bloque "sin categoría" del panel.
    //
    //  ⚠️ La causa que FABRICABA esos restos se cierra aparte, en auth.js
    //  (v582): esto es la mitad que impide que los ya existentes sigan
    //  mintiendo, no un parche que los tape.
    //  ⚠️ Sólo cuentan las plazas VIVAS: `isAuthorized === true` y sin
    //  `removed` ni `rejected`. Un rol revocado no ocupa sitio.
    // ════════════════════════════════════════════════════════════════
    window.cronosPlazasOcupadas = function (users, role, clubId) {
        const lista = Array.isArray(users) ? users : [];
        const vivo = (r) => r && r.isAuthorized === true &&
                            r.status !== 'removed' && r.status !== 'rejected';
        const delClub = (r) => !clubId || String(r.clubId || '') === String(clubId) || !r.clubId;
        // Los roles que llevan equipo son los únicos donde la categoría forma
        // parte de la identidad de la plaza (mismo criterio que cronosMismaPlaza).
        const conEquipo = (role === 'user' || role === 'coach');
        // Una categoría escrita de dos formas ('Alevín' / 'alevin' / 'f7_alevin_c')
        // es la MISMA: se compara normalizada, o dos grafías contarían doble.
        const slug = (v) => (typeof window.ctNormCat === 'function')
            ? window.ctNormCat(v)
            : String(v == null ? '' : v).trim().toLowerCase();
        // ⚠️ Y LA SUBCATEGORÍA SE DERIVA DEL SUFIJO cuando no viene aparte
        //    ('f7_alevin_a' lleva dentro la A), exactamente igual que hace
        //    `_normSub` en el árbol de categorías. Sin esto, la misma plaza
        //    escrita de las dos maneras contaría DOS veces, que es el defecto
        //    que este recuento viene a cerrar.
        const slugSub = (r) => {
            const bruto = r.subcategory;
            let s = (typeof window.ctNormSubcat === 'function')
                ? window.ctNormSubcat(bruto)
                : String(bruto == null ? '' : bruto).trim().toUpperCase();
            if (!s) {
                const m = String(r.category == null ? '' : r.category).match(/_([abc])$/i);
                if (m) s = m[1].toUpperCase();
            }
            return s;
        };
        let n = 0;
        lista.forEach(function (u) {
            if (!u || u.status === 'removed' || u.status === 'blocked') return;
            const roles = Array.isArray(u.allRoles) ? u.allRoles : [];
            if (roles.length) {
                const vivas = roles.filter(r => r.role === role && vivo(r) && delClub(r));
                if (!vivas.length) return;
                const equipoDe = (r) => slug(r.category != null ? r.category : r.categoryLabel) +
                                        '|' + slugSub(r);
                const tieneEquipo = (r) => !!slug(r.category != null ? r.category : r.categoryLabel);
                const conCategoria = conEquipo ? vivas.filter(tieneEquipo) : vivas;
                // Regla 2: los restos sin categoría sólo cuentan si no hay equipo.
                const efectivas = (conEquipo && conCategoria.length) ? conCategoria : vivas;
                // Regla 1: plazas DISTINTAS.
                const unicas = new Set(efectivas.map(equipoDe));
                n += unicas.size;
            } else if (u.role === role && u.isAuthorized === true && u.status !== 'removed') {
                // Perfil antiguo sin allRoles: su rol raíz cuenta como una plaza.
                n++;
            }
        });
        return n;
    };
}

// ── EL VALOR QUE LE CORRESPONDE EN EL DESPLEGABLE (v548) ────────────
// 'benjamin' + 'f7' → 'f7_benjamin'. Es la clave con la que el desplegable de
// categorías del panel del entrenador identifica cada opción.
//
// 🔑 VIVE AQUÍ Y NO EN setup-modal.js porque la usan DOS sitios: el bloqueo
// visual del desplegable y la imposición de la categoría al confirmar el
// partido. Con una copia en cada uno, el día que cambie la cascada uno de los
// dos se quedaría atrás y el partido se montaría con una categoría distinta de
// la que enseña la pantalla.
//
// ⚠️ LAS DOS FEM VAN DELANTE: 'regional_fem' contiene 'regional'.
if (typeof window._cronosCategoriaValor !== 'function') {
    window._cronosCategoriaValor = function (categoria, modo) {
        const c = (categoria == null ? '' : String(categoria)).toLowerCase();
        const m = modo || 'f7';
        if (!c) return null;
        if (c.includes('futurefem'))                    return m + '_futurefem';
        if (c.includes('regional') && c.includes('fem')) return m + '_regional_fem';
        if (c.includes('prebenj'))                      return m + '_prebenjamin';
        if (c.includes('benj'))                         return m + '_benjamin';
        if (c.includes('alev'))                         return m + '_alevin';
        if (c.includes('infant'))                       return m + '_infantil';
        if (c.includes('cadet'))                        return m + '_cadete';
        if (c.includes('juvenil'))                      return m + '_juvenil';
        if (c.includes('regional'))                     return m + '_regional';
        return null;
    };
}

// ── QUÉ EQUIPO TIENE ABIERTO AHORA MISMO (v540) ─────────────────────
// Un entrenador con dos equipos entra a UNO de los dos, y tiene que poder
// cambiar sin cerrar sesión.
//
// ⚠️ VIVE EN sessionStorage, NO en localStorage. Es una elección de ESTA
// sesión: si se guardara para siempre, el día que le retiren ese equipo la
// aplicación seguiría intentando abrir uno que ya no es suyo. Al arrancar,
// la elección se valida siempre contra los equipos vivos.
if (typeof window.cronosEquipoElegido !== 'function') {
    window.cronosEquipoElegido = function () {
        try { return sessionStorage.getItem('cronos_equipo_activo') || ''; }
        catch (_) { return window._cronosEquipoActivo || ''; }
    };
    window.cronosFijarEquipoElegido = function (teamId) {
        window._cronosEquipoActivo = teamId || '';
        try {
            if (teamId) sessionStorage.setItem('cronos_equipo_activo', teamId);
            else sessionStorage.removeItem('cronos_equipo_activo');
        } catch (_) { /* modo privado: queda sólo en memoria */ }
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
        // 'futurefem' es F7 y 'regional_fem' F11 (éste ya entra por 'regional').
        if (/(prebenjamin|benjamin|alevin|prebenj|chupete|querubin)/.test(norm)) return 'f7';
        if (/(infantil|cadete|juvenil|regional|senior|amateur|aficionado|futurefem)/.test(norm)) return 'f11';
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

// ════════════════════════════════════════════════════════════════════
//  🎯 v593 · EL COORDINADOR TIENE MODALIDAD: F7, F11 o LAS DOS
//
//  Petición del autor (implementar.txt, 2026-08-20): el rol "Coordinador"
//  era GENÉRICO y en los clubes reales no lo es — hay coordinador de Fútbol
//  7, coordinador de Fútbol 11 y coordinador de ambas. Su panel debe recibir
//  SÓLO lo de su modalidad: equipos, informes colectivos, entrenamientos y
//  convocatorias.
//
//  🔑🔑🔑 UN SOLO PREDICADO PARA TODAS LAS PUERTAS. En este proyecto ya se
//  pagó cuatro veces el mismo defecto por tener la misma regla copiada en
//  varios ficheros (v551→v552: pérdida de roles en CUATRO sitios; v559: la
//  regla del semáforo en CUATRO copias). Convocatorias, Entrenamientos,
//  Asistencia, Informes y la lista de contactos del entrenador preguntan
//  todas AQUÍ. El día que cambie el criterio, cambia en un sitio.
//
//  🔑 SE MIRA EL ROL ACTIVO (`_activeRole`), no `role`: un mismo correo puede
//  ser director en un club y coordinador en otro (v540: la unidad es la
//  PLAZA). Filtrar por `role` le recortaría el panel al director.
//
//  ⚠️ FAIL-OPEN, Y ES DELIBERADO. Si no se puede clasificar la categoría —o
//  el coordinador no tiene tipo, que es el caso de TODOS los que ya existen
//  hoy— NO se oculta nada. Esconder por defecto convierte un dato sin
//  clasificar en un dato perdido, y eso parece una avería. Ocultar de menos
//  se ve y se corrige; ocultar de más no se ve.
//
//  ⚠️ EL COORDINADOR QUE HAY HOY EN LA APP ES DE F7 Y F11 (dicho por el autor):
//  sin `coordinatorType` el alcance es '' → lo ve todo, igual que antes. La
//  migración es, por tanto, no hacer nada.
// ════════════════════════════════════════════════════════════════════

// _cronosCoordScope(user) → 'f7' | 'f11' | ''
//   El ACOTAMIENTO por modalidad que se le aplica a este usuario:
//     • '' → sin acotar (director, club_admin, superadmin, entrenador,
//       coordinador de ambas, o coordinador legado sin tipo).
//     • 'f7' / 'f11' → sólo ve esa modalidad.
if (typeof window._cronosCoordScope !== 'function') {
    window._cronosCoordScope = function(user) {
        const me = user || window._cronosCurrentUser;
        if (!me) return '';
        const activo = me._activeRole || me.role;
        if (activo !== 'coordinator') return '';
        // 🔑 LA MODALIDAD ES DE LA PLAZA ACTIVA. _cronosStaffCoordinatorType
        // se conforma con la PRIMERA entrada 'coordinator' que encuentre en
        // allRoles, y quien coordina en dos clubes tiene dos: sin acotar por
        // clubId, la plaza de un club le recortaría el panel del otro (mismo
        // eje que la auditoría de aislamiento de v584).
        let fuente = me;
        if (me.clubId && Array.isArray(me.allRoles)) {
            const mismoClub = me.allRoles.filter(r => r && r.role === 'coordinator' &&
                String(r.clubId || '') === String(me.clubId));
            if (mismoClub.length) fuente = { coordinatorType: me.coordinatorType, allRoles: mismoClub };
        }
        const ct = (typeof window._cronosStaffCoordinatorType === 'function')
            ? window._cronosStaffCoordinatorType(fuente) : '';
        return (ct === 'f7' || ct === 'f11') ? ct : '';
    };
}

// _cronosVeCategoria(user, category[, mode]) → boolean
//   ¿Debe este usuario ver lo que pertenece a esta categoría?
//   Es la pregunta que hacen las pestañas del Panel de Coordinación.
if (typeof window._cronosVeCategoria !== 'function') {
    window._cronosVeCategoria = function(user, category, mode) {
        const scope = window._cronosCoordScope(user);
        if (!scope) return true;                       // sin acotar
        const modal = (typeof window._cronosMatchModality === 'function')
            ? window._cronosMatchModality(category, mode) : '';
        if (!modal) return true;                       // fail-open: sin clasificar, no se oculta
        return modal === scope;
    };
}

// _cronosCoordScopeLabel(scope) → texto legible del acotamiento
if (typeof window._cronosCoordScopeLabel !== 'function') {
    window._cronosCoordScopeLabel = function(scope) {
        const s = (scope == null ? '' : String(scope)).trim().toLowerCase();
        if (s === 'f7')   return 'Fútbol 7';
        if (s === 'f11')  return 'Fútbol 11';
        if (s === 'f711') return 'Fútbol 7 y Fútbol 11';
        return '';
    };
}

// _cronosParseRoleValue(valor) → { role, coordinatorType }
//   El desplegable de REGISTRARSE desglosa el coordinador en tres opciones
//   ('coordinator_f7' | 'coordinator_f11' | 'coordinator_f711'). Esta función
//   las parte en el rol de siempre + su tipo, para que NADA aguas abajo —las
//   solicitudes, las aprobaciones, las reglas, los recuentos de plazas— vea
//   un rol que no conoce.
//   El valor legado 'coordinator' a secas devuelve tipo vacío: quien lo use
//   tendrá que preguntarlo aparte, que es justo lo que hacía la app hasta hoy.
if (typeof window._cronosParseRoleValue !== 'function') {
    window._cronosParseRoleValue = function(valor) {
        const v = (valor == null ? '' : String(valor)).trim();
        if (!v.startsWith('coordinator')) return { role: v, coordinatorType: '' };
        if (v === 'coordinator') return { role: 'coordinator', coordinatorType: '' };
        const t = v.slice('coordinator'.length).replace(/^[_:-]/, '').toLowerCase();
        return { role: 'coordinator',
                 coordinatorType: (t === 'f7' || t === 'f11' || t === 'f711') ? t : '' };
    };
}

// ════════════════════════════════════════════════════════════════════
//  🔗 v594 · EL ENLACE DE INVITACIÓN, CONSTRUIDO EN UN SOLO SITIO
//
//  Se descubrió al abrir la Secretaría por el fallo de envío: el enlace
//  se fabricaba en DOS sitios y NO era el mismo.
//    · El cliente (secretary.js) ponía `?invite=true&email=…`
//    · La Cloud Function ponía `?register=true&email=…&role=…&clubName=…`
//
//  🔑 Y LA BUENA ES LA SEGUNDA. `index.html` acepta `invite` O `register`
//  para saltarse el onboarding, pero **sólo `register=true` cambia a la
//  pestaña REGISTRARSE**, y sólo con `role`/`clubName` llega el formulario
//  relleno. O sea: al invitado por WhatsApp —el único camino que hoy
//  funciona— se le mandaba el enlace flojo, que le deja en la pantalla de
//  acceso teniendo que buscar dónde se registra uno.
//
//  ⚠️ El destinatario NO ve ningún error: el enlace abre, la app carga y
//  simplemente no hace lo que debía. Por eso nadie lo había reportado.
//
//  Ahora lo construyen aquí el campo visible, el texto de WhatsApp y el
//  cuerpo del correo. La Cloud Function sigue construyendo el suyo con
//  ESTA MISMA forma (functions/index.js): no se acepta el del cliente,
//  porque un enlace que llega en el payload y se reenvía por correo es
//  una vía de suplantación.
// ════════════════════════════════════════════════════════════════════
if (typeof window.CRONOS_APP_URL !== 'string') {
    window.CRONOS_APP_URL = 'https://cronos-futbol-app.web.app';
}
if (typeof window.cronosInviteUrl !== 'function') {
    window.cronosInviteUrl = function(datos) {
        const d = datos || {};
        const p = new URLSearchParams();
        // `register=true` es lo que de verdad deja al invitado EN el
        // formulario de alta. No cambiar por `invite` sin leer la nota de
        // arriba: `invite` sólo quita el onboarding.
        p.set('register', 'true');
        const email = (d.email == null ? '' : String(d.email)).trim();
        if (email) p.set('email', email);
        const role = (d.role == null ? '' : String(d.role)).trim();
        if (role) p.set('role', role);
        const club = (d.clubName == null ? '' : String(d.clubName)).trim();
        if (club) p.set('clubName', club);
        return window.CRONOS_APP_URL + '/?' + p.toString();
    };
}

// ════════════════════════════════════════════════════════════════════
//  🎟️ SEC-INV (2026-08-26) · LA INVITACIÓN, CON TOKEN OPACO
//
//  `cronosInviteUrl` (arriba) mete el correo, el rol y el club EN CLARO en la
//  URL. Eso queda en el historial del navegador, en los registros del servidor
//  de correo y en la cabecera `Referer`. Y el enlace no caducaba ni se
//  consumía: valía para siempre y para quien lo reenviara.
//
//  Aquí los datos se guardan en `invites/{token}` y el enlace pasa a ser
//  `?invite=<token>`. El token es un id largo y aleatorio: **él es el
//  secreto**, y por eso su regla permite `get` sin autenticación (quien abre
//  la invitación aún no tiene cuenta) pero prohíbe `list`.
//
//  ⚠️ `cronosInviteUrl` SE QUEDA, y no es descuido: los enlaces ya enviados
//  con la forma antigua tienen que seguir funcionando. El resolutor de
//  invite-prefill.js acepta las dos.
//
//  ⚠️ NO SE LLAMA AL TECLEAR. Crear un documento por pulsación sería
//  inaceptable: la Secretaría lo invoca al ENVIAR o al COPIAR, y cachea el
//  resultado mientras no cambien correo, rol ni club.
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosCrearInvitacion !== 'function') {
    // Días que vive una invitación. Ni tan corto que caduque antes de que la
    // lean, ni tan largo que un enlace olvidado siga abriendo puertas.
    window.CRONOS_INVITE_DIAS = 14;

    window.cronosCrearInvitacion = async function (datos) {
        const d = datos || {};
        const fa = window._cronos_auth;
        if (!fa || !fa.db) throw new Error('Firebase no está listo.');
        const yo = (fa.auth && fa.auth.currentUser) || null;
        if (!yo) throw new Error('Hay que haber iniciado sesión para invitar.');

        const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // 🔑 EL TOKEN SALE DE `crypto.getRandomValues`, no de Math.random ni de
        //    la fecha: es lo único que protege la invitación, así que tiene que
        //    ser imposible de adivinar o de enumerar por fuerza bruta.
        //    32 caracteres hexadecimales = 128 bits.
        let token;
        if (window.crypto && window.crypto.getRandomValues) {
            const b = new Uint8Array(16);
            window.crypto.getRandomValues(b);
            token = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
        } else {
            // Respaldo para un navegador sin WebCrypto. Es peor, y por eso se
            // deja constancia: no se cambia el mecanismo en silencio.
            console.warn('[invitación] sin crypto.getRandomValues: token más débil');
            token = (Date.now().toString(36) + Math.random().toString(36).slice(2) +
                     Math.random().toString(36).slice(2)).slice(0, 32);
        }

        const ahora = Date.now();
        await m.setDoc(m.doc(fa.db, 'invites', token), {
            v: 1,
            email:     (d.email == null ? '' : String(d.email)).trim(),
            role:      (d.role == null ? '' : String(d.role)).trim(),
            clubName:  (d.clubName == null ? '' : String(d.clubName)).trim(),
            clubId:    (d.clubId == null ? '' : String(d.clubId)).trim(),
            createdBy: yo.uid,
            createdAt: new Date(ahora).toISOString(),
            // ⚠️ Timestamp de verdad, no una cadena: la regla lo compara con
            //    `request.time` y una cadena haría fallar la comparación.
            expiresAt: m.Timestamp.fromMillis(ahora + window.CRONOS_INVITE_DIAS * 86400000),
            usedAt: null,
            usedBy: null,
        });

        return { token: token, url: window.CRONOS_APP_URL + '/?invite=' + token };
    };
}

// Lee una invitación por su token. Devuelve {email, role, clubName, clubId} o
// null. NUNCA lanza: si el token no existe, caducó o ya se usó, la regla
// deniega la lectura y aquí se devuelve null — el alta sigue, sólo que a mano.
if (typeof window.cronosLeerInvitacion !== 'function') {
    window.cronosLeerInvitacion = async function (token) {
        try {
            const t = String(token || '').trim();
            if (!t || !/^[a-z0-9_-]{8,64}$/i.test(t)) return null;
            const fa = window._cronos_auth;
            if (!fa || !fa.db) return null;
            const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            const snap = await m.getDoc(m.doc(fa.db, 'invites', t));
            if (!snap.exists()) return null;
            const d = snap.data() || {};
            return { token: t, email: d.email || '', role: d.role || '',
                     clubName: d.clubName || '', clubId: d.clubId || '' };
        } catch (e) {
            if (window._CRONOS_DEBUG) console.warn('[invitación] no se pudo leer:', e && e.message);
            return null;
        }
    };
}

// Marca la invitación como consumida. Se llama DESPUÉS del alta, cuando ya hay
// sesión — antes no se puede, porque la regla exige que `usedBy` sea el uid de
// quien escribe. Un fallo aquí no puede tumbar un alta ya hecha.
if (typeof window.cronosConsumirInvitacion !== 'function') {
    window.cronosConsumirInvitacion = async function (token) {
        try {
            const t = String(token || '').trim();
            if (!t) return false;
            const fa = window._cronos_auth;
            const yo = fa && fa.auth && fa.auth.currentUser;
            if (!fa || !fa.db || !yo) return false;
            const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            await m.updateDoc(m.doc(fa.db, 'invites', t), {
                usedAt: new Date().toISOString(), usedBy: yo.uid,
            });
            return true;
        } catch (e) {
            if (window._CRONOS_DEBUG) console.warn('[invitación] no se pudo consumir:', e && e.message);
            return false;
        }
    };
}

// ── Resolutor de grupo de categoría para Semáforo e Informes ───
// Grupos: 'f7', 'infantil_a', 'infantil_b', 'infantil_c', 'cadete_a', 'cadete_b', 'cadete_c', 'juvenil', 'regional'
if (typeof window.getCategoryGroupKey !== 'function') {
    window.getCategoryGroupKey = function(category, subcategory) {
        const cat = (category == null ? '' : String(category)).trim().toLowerCase();
        const normCat = cat.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const sub = (subcategory == null ? 'A' : String(subcategory)).trim().toUpperCase();

        // 🔑 LAS DOS CATEGORÍAS FEM NO ESTRENAN GRUPO DE SEMÁFORO, HEREDAN:
        // FUTureFEM → grupo 'f7'; Regional FEM entra más abajo por
        // includes('regional') → grupo 'regional' (celeste, sin semáforo). Así
        // el Director sigue configurando 9 bloques y no hay claves huérfanas en
        // clubs/{id}.categoryConfigs.
        //
        // ⚠️⚠️ v538 · ESTE GRUPO SE QUEDA EN 'f7' A PROPÓSITO, aunque FUTureFEM
        // haya pasado a ser modalidad F11. Son DOS cosas distintas:
        //   · la MODALIDAD dice cuántos juegan (11) → `_cronosMatchModality`;
        //   · este GRUPO elige los umbrales del semáforo, que dependen de la
        //     DURACIÓN del partido, y FUTureFEM sigue jugando 2T x 35' = 70',
        //     igual que Benjamín y Alevín, no los 80' de Infantil/Cadete.
        // Moverlo aquí cambiaría los umbrales de partidos ya jugados y dejaría
        // huérfana la configuración que el Director ya tenga guardada.
        // Si el autor quiere también cambiar la duración, es otra decisión.
        // ══════════════════════════════════════════════════════════════
        //  🔴 v586 · LAS DOS FEM ESTRENAN GRUPO PROPIO
        //
        //  Petición expresa del autor (2026-08-19): FUTureFEM y Regional FEM
        //  deben tener su propio bloque en el panel de Configuración, con sus
        //  umbrales y su interruptor de informes a padres, "exactamente igual
        //  que el resto".
        //
        //  ⚠️ ESTO REVIERTE LA DECISIÓN DE v538, que las hacía HEREDAR de 'f7'
        //  y 'regional' precisamente para no dejar claves huérfanas. Se le ha
        //  advertido. Para que ningún club pierda lo que ya tenía configurado,
        //  el grupo nuevo HEREDA del antiguo mientras no se guarde el bloque
        //  nuevo (ver `cronosCfgGrupo`, más abajo): el comportamiento de hoy no
        //  cambia hasta que el Director toque el bloque a propósito.
        //
        //  ⚠️⚠️ VAN DELANTE, Y NO ES COSMÉTICO: 'regional_fem'.includes(
        //  'regional') es TRUE y 'futurefem' casaba con la rama de F7. Si estas
        //  dos comprobaciones no son las PRIMERAS, no se alcanzan nunca — es la
        //  trampa de v511, que costó siete cascadas.
        // ══════════════════════════════════════════════════════════════
        if (normCat.includes('futurefem') || normCat.includes('future_fem') ||
            normCat.includes('futurfem')) {
            return 'futurefem';
        }
        if (normCat.includes('regional') && normCat.includes('fem')) {
            return 'regional_fem';
        }
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

// ════════════════════════════════════════════════════════════════════
//  🔑 v586 · LA CONFIGURACIÓN DE UN GRUPO, CON HERENCIA
//
//  FUTureFEM y Regional FEM acaban de estrenar grupo propio. Los clubes que
//  llevan meses funcionando NO tienen esas claves en
//  `clubs/{id}.categoryConfigs`, así que una lectura directa devolvería
//  `undefined` y caería en los valores por defecto.
//
//  🚨 Y eso NO es inocuo: si un Director había DESACTIVADO los informes
//  individualizados a padres para F7, su FUTureFEM los tendría ACTIVOS otra
//  vez desde el primer minuto — un dato de un menor saliendo hacia su familia
//  porque hemos partido un grupo en dos. Un cambio de organización interna no
//  puede reabrir un permiso que alguien cerró.
//
//  Así que mientras el bloque nuevo no se guarde, el grupo hereda del que le
//  daba servicio hasta hoy. En cuanto el Director lo configure, manda el suyo.
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosCfgGrupo !== 'function') {
    window.CRONOS_GRUPO_HEREDA_DE = { futurefem: 'f7', regional_fem: 'regional' };
    window.cronosCfgGrupo = function (configs, groupKey) {
        const c = configs || {};
        if (c[groupKey]) return c[groupKey];
        const padre = window.CRONOS_GRUPO_HEREDA_DE[groupKey];
        return (padre && c[padre]) ? c[padre] : undefined;
    };
}

// ════════════════════════════════════════════════════════════════════
//  🚦 v559 · ¿ESTA CATEGORÍA LLEVA SEMÁFORO? — LA REGLA, EN UN SOLO SITIO
//
//  Reporte del autor (capturas 9056, 9059 y 9060): en el partido de Regional A
//  los círculos del cronómetro seguían saliendo en amarillo y rojo. Juvenil,
//  Regional y Regional FEM **no llevan semáforo**: son celeste y punto — lo
//  dice también su panel de configuración, donde esos dos grupos ni siquiera
//  tienen interruptor (`hasSemaforo: false`).
//
//  🔑🔑🔑 LA REGLA ESTABA ESCRITA CUATRO VECES —app-init.js, live.html,
//  replay-player.js y sync.js— y las cuatro la deducían de UN grupo calculado
//  con `getCategoryGroupKey`, a partir de UNA sola cascada de categoría. Y ahí
//  está el fallo: **cuando la cascada se queda vacía, el grupo por defecto SÍ
//  tiene semáforo** (`'infantil_a'` en utils.js, `'f7'` en la copia de
//  live.html — dos defectos distintos para la misma entrada). O sea: cualquier
//  hueco en la cadena de la categoría pinta un Regional de rojo.
//
//  Y los huecos existen. El visor decide con `data.category` —la categoría del
//  PERFIL del entrenador— e ignora `data.matchCategory`, que es la del partido
//  y la que el panel de creación fija siempre. Si el perfil viene vacío, el
//  visor clasifica una cadena vacía.
//
//  🔑 ASÍ QUE LA REGLA SE INVIERTE Y SE HACE TAJANTE: no se pregunta "¿en qué
//  grupo cae?" sino "¿ALGUNA de las señales que tengo dice Juvenil o Regional?".
//  Se le pasan TODAS —la del partido, la del perfil, la del rol activo— y con
//  que una lo diga, es celeste. Un hueco ya no puede encender el semáforo,
//  porque no hay que acertar el grupo: hay que fallar TODAS las señales.
//
//  ⚠️ NO SUSTITUYE a `getCategoryGroupKey`, que sigue eligiendo los UMBRALES de
//  los grupos que sí tienen semáforo. Sólo se le adelanta.
//
//  ⚠️ `live.html` NO CARGA ESTE FICHERO (es un visor independiente y meterle
//  utils.js entero es justo el riesgo que dejó la pantalla en negro en v454),
//  así que allí vive una copia mínima. La copia no puede divergir: el guard
//  scripts/test_semaforo_sin_juvenil_regional.js pasa la MISMA tabla de
//  entradas por las dos y exige idéntico resultado.
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosCategoriaSinSemaforo !== 'function') {
    window.cronosCategoriaSinSemaforo = function () {
        for (let i = 0; i < arguments.length; i++) {
            const crudo = arguments[i];
            if (crudo == null) continue;
            // Acentos fuera POR CÓDIGO DE CARÁCTER, nunca con una clase de
            // regex: el bloque combinante escrito dentro de una expresión acaba
            // en el fichero como marcas sueltas invisibles y cualquier paso que
            // toque la codificación las destruye SIN ERROR (ver cronosTeamSlug).
            const n = String(crudo).normalize('NFD')
                .split('').filter(_cronosNoEsAcento).join('').toLowerCase();
            if (!n) continue;
            // Regional FEM entra por 'regional'; no necesita mención aparte.
            if (n.indexOf('juvenil')    !== -1) return true;
            if (n.indexOf('regional')   !== -1) return true;
            if (n.indexOf('senior')     !== -1) return true;
            if (n.indexOf('aficionado') !== -1) return true;
            if (n.indexOf('amateur')    !== -1) return true;
        }
        return false;
    };
}

// ════════════════════════════════════════════════════════════════════
//  🪪 v561 · LA IDENTIDAD DEL PARTIDO — UN SOLO RESOLUTOR
//
//  Reporte del autor (captura 9075): en "Recuperar Partido en Curso" salía el
//  Alevín C DUPLICADO — arriba una tarjeta de F-11 con 18 jugadores y 24
//  minutos, abajo el partido real de F-7 con 14.
//
//  🔑🔑🔑 NO HABÍA NINGUNA RANURA FANTASMA. Medido en producción, las dos
//  tarjetas eran DOS PARTIDOS DE VERDAD del mismo entrenador:
//
//     f7   14j  30min   category=alevin   matchCategory=alevin     ← Alevín C
//     f11  18j  28min   category=alevin   matchCategory=regional   ← ¡Regional A!
//
//  El documento lleva DOS identidades y NO COINCIDEN:
//    · `matchCategory` es la categoría DEL PARTIDO, la que fijó el panel de
//      creación. Es la buena.
//    · `category` es la del PERFIL del entrenador cuando se escribió el
//      latido — y en un entrenador con dos equipos (v537) se queda con la del
//      otro equipo. También se sellaba así el `teamId`.
//  La tarjeta se etiquetaba con la del perfil, así que el partido del Regional
//  se presentaba como un segundo Alevín. De ahí la "duplicación": no sobraba
//  una tarjeta, sobraba una etiqueta equivocada. Descartarla habría sido peor
//  que el defecto — se habría perdido un partido en curso de verdad.
//
//  ⚠️ NO SE PUEDE DEDUCIR LA MODALIDAD DE LA CATEGORÍA A SECAS. El panel
//  ofrece "Juvenil (2T x 45')" TAMBIÉN en Fútbol 7: un Infantil o un Cadete
//  jugando F7 es legítimo y lo decide el club. Por eso, cuando la categoría
//  trae prefijo (`f7_`/`f11_`), ESE prefijo es la declaración; y la
//  comprobación de coherencia compara la modalidad DECLARADA con la que la
//  categoría permite, no con una tabla rígida.
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosIdentidadDelPartido !== 'function') {
    window.cronosIdentidadDelPartido = function (datos) {
        const d = datos || {};

        // 1 · La categoría DEL PARTIDO manda sobre la del perfil.
        const catPartido = d.matchCategory || d.category || '';
        const subPartido = (d.matchSubcategory != null && d.matchSubcategory !== '')
            ? d.matchSubcategory
            : (d.subcategory != null ? d.subcategory : '');

        // 2 · Modalidad: la declarada; si no hay, la que pide la categoría.
        const modalidadCat = (typeof window._cronosMatchModality === 'function')
            ? window._cronosMatchModality(catPartido) : '';
        const declarada = (d.mode === 'f11') ? 'f11' : (d.mode === 'f7' || d.mode === 'f8') ? 'f7' : '';
        const modalidad = declarada || modalidadCat || '';

        // 3 · Cuántos caben POR EQUIPO. Son los topes de convocatoria que ya
        //     impone el arranque del partido (js/ai/import.js).
        const maxPorEquipo = modalidad === 'f11' ? 18 : 14;

        // 4 · El equipo más numeroso. ⚠️ SE CUENTA POR EQUIPO, no en total:
        //     con "Analizar Contrario" el documento lleva las DOS plantillas y
        //     un tope sobre el total daría por corrupto un partido perfecto.
        let maxEnUnEquipo = null;
        if (Array.isArray(d.players)) {
            let home = 0, away = 0;
            d.players.forEach(p => { if (p && p.team === 'away') away++; else home++; });
            maxEnUnEquipo = Math.max(home, away);
        } else if (typeof d.playerCount === 'number') {
            // Sin el detalle por equipo sólo se puede juzgar el total, y para no
            // acusar en falso a un partido con el contrario analizado se admite
            // el doble.
            maxEnUnEquipo = (d.playerCount > maxPorEquipo * 2) ? d.playerCount : null;
        }

        // 5 · Coherencia.
        const motivos = [];
        if (declarada && modalidadCat && declarada !== modalidadCat) {
            motivos.push('se declara ' + declarada.toUpperCase() +
                         ' pero la categoría del partido pide ' + modalidadCat.toUpperCase());
        }
        if (maxEnUnEquipo != null && maxEnUnEquipo > maxPorEquipo) {
            motivos.push(maxEnUnEquipo + ' jugadores en un equipo, y en ' +
                         modalidad.toUpperCase() + ' caben ' + maxPorEquipo);
        }

        // 6 · ¿El sello de equipo del documento apunta a OTRO equipo? Es el
        //     defecto de origen, y quien lo lee tiene que poder saberlo.
        const catPerfil = d.category || '';
        const slug = (typeof cronosTeamSlug === 'function')
            ? cronosTeamSlug
            : (v) => String(v == null ? '' : v).trim().toLowerCase();
        const _sinPrefijo = (v) => String(v || '').replace(/^f(?:7|8|11)_/i, '');
        const selloAjeno = !!(catPerfil && catPartido &&
            slug(_sinPrefijo(catPerfil)) !== slug(_sinPrefijo(catPartido)));

        const etiqueta = (typeof window.cronosNombreCategoria === 'function')
            ? window.cronosNombreCategoria(catPartido, subPartido)
            : String(catPartido || '');

        return {
            category: catPartido, subcategory: subPartido,
            categoriaCruda: _sinPrefijo(catPartido),
            modalidad, modalidadDeLaCategoria: modalidadCat,
            maxPorEquipo, maxEnUnEquipo,
            etiqueta,
            modalidadLabel: modalidad === 'f11' ? 'F-11' : 'F-7',
            selloAjeno,
            coherente: motivos.length === 0,
            motivos,
        };
    };
}

// ════════════════════════════════════════════════════════════════════
//  🏷️ v562 · CATEGORÍA Y SUBCATEGORÍA VIAJAN JUNTAS O NO VIAJAN
//
//  Reporte del autor (capturas 9077/9078/9083): el entrenador tiene asignado
//  **Regional A** y el panel en vivo lo rotulaba **"Regional C"**.
//
//  🔑🔑🔑 MEDIDO EN LOS 10 PARTIDOS DEL RESPALDO: en los DIEZ,
//  `matchSubcategory` era IDÉNTICA a la `subcategory` del PERFIL. En tres de
//  ellos, en cambio, `matchCategory` sí difería de la del perfil:
//
//     category=alevin  sub=C   matchCategory=regional      matchSub=C  → "REGIONAL C"
//     category=alevin  sub=C   matchCategory=f11_infantil  matchSub=C  → "INFANTIL C"
//
//  O sea: **la categoría del PARTIDO llegaba al documento y la subcategoría
//  NO**. Cada una salía de un sitio distinto —la categoría de un desplegable
//  que se puede mover, la subcategoría clavada al perfil del entrenador— y en
//  cuanto las dos no describían el mismo equipo, la etiqueta mezclaba la
//  categoría de uno con la letra del otro. No hacía falta ningún error de
//  lectura: el visor pintaba fielmente un dato que ya nacía cruzado.
//
//  🔑 LA UNIDAD ES EL EQUIPO, y un equipo es categoría **y** subcategoría a la
//  vez. Este resolutor las devuelve SIEMPRE COMO PAREJA y de UNA SOLA fuente,
//  para que no puedan describir equipos distintos.
//
//  ⚠️ Sólo impone a quien TIENE equipo asignado. El director, el coordinador y
//  el SuperAdmin siguen eligiendo libremente en el panel: para ellos no hay un
//  equipo del que deducirlo, y devolver `null` es lo correcto.
// ════════════════════════════════════════════════════════════════════
if (typeof window.cronosParCategoriaDelPanel !== 'function') {
    window.cronosParCategoriaDelPanel = function (modo) {
        try {
            const me = window._cronosCurrentUser;
            if (!me) return null;

            // 1 · El equipo ABIERTO manda (el selector de v540). Es el único
            //     sitio donde categoría y subcategoría se fijaron juntas.
            let cat = '', sub = '';
            const elegido = (typeof window.cronosEquipoElegido === 'function')
                ? window.cronosEquipoElegido() : '';
            if (elegido && typeof window.cronosEquiposDeEntrenador === 'function') {
                const eq = (window.cronosEquiposDeEntrenador(me.allRoles, null) || [])
                    .filter(e => e.teamId === elegido)[0];
                if (eq && eq.category) { cat = eq.category; sub = eq.subcategory || ''; }
            }

            // 2 · Respaldo: el rol activo. También trae las dos juntas.
            if (!cat) {
                const rd = me._activeRoleData;
                if (rd && (rd.role === 'user' || rd.role === 'coach') && (rd.category || rd.categoryLabel)) {
                    cat = rd.category || rd.categoryLabel;
                    sub = rd.subcategory || '';
                }
            }

            // 3 · Último respaldo: la raíz del usuario.
            //     ⚠️ AQUÍ NACÍA EL CRUCE. Antes la categoría se resolvía por una
            //     cascada y la subcategoría por otra, así que podían acabar
            //     describiendo equipos distintos. Se toman de la MISMA rama o no
            //     se toma ninguna.
            if (!cat && (me.category || me.categoryLabel)) {
                cat = me.category || me.categoryLabel;
                sub = me.subcategory || '';
            }

            if (!cat) return null;   // sin equipo: que elija el panel

            const valor = (typeof window._cronosCategoriaValor === 'function')
                ? window._cronosCategoriaValor(cat, modo || 'f7') : null;

            return {
                category:     cat,                     // 'regional'
                valorPanel:   valor || '',             // 'f11_regional' (el <option>)
                subcategory:  String(sub || '').toUpperCase().trim(),
            };
        } catch (e) {
            console.warn('[v562] No se pudo resolver el par categoría/subcategoría:', e && e.message);
            return null;
        }
    };
}

// ════════════════════════════════════════════════════════════════════
//  👨‍👩‍👧 ¿EXISTE EL COLECTIVO DE FAMILIAS EN ESTA ENTIDAD?
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-08-24): cuando se anula el rol de padres/madres/
//  tutores en la configuración del club o del ente, la aplicación debe
//  IGNORAR POR COMPLETO todo rastro de ese colectivo.
//
//  🔑 UNA SOLA PUERTA. El interruptor `rol_padres` existía desde v596 pero
//  sólo lo miraba la pantalla de acceso, para bloquear la tarjeta de
//  Familias: el resto de la aplicación seguía ofreciendo padres, y el
//  despacho automático seguía mandándoles informes. Todo lo que hable de
//  familias pregunta ahora AQUÍ, para que no haya dos criterios.
//
//  ⚠️ El valor por defecto es SÍ. Un club al que todavía no se le ha escrito
//  el extra tiene familias, como hasta hoy: sólo la desactivación EXPRESA
//  (`=== false`) las apaga. Al revés, un `extras` que aún no ha bajado de
//  Firestore dejaría a un club entero sin familias durante unos segundos.
if (typeof window.cronosHayPadres !== 'function') {
    window.cronosHayPadres = function (usuario) {
        try {
            const me = usuario || window._getEffectiveUser?.() || window._cronosCurrentUser;
            const extras = (me && me.extras) || {};
            return extras.rol_padres !== false;
        } catch (e) { return true; }
    };
}

if (typeof window.isParentReportEnabledForCategory !== 'function') {
    window.isParentReportEnabledForCategory = function(category, subcategory) {
        // ⛔ Sin colectivo de familias no hay informe a familias que valga, y
        //    esto va ANTES que la configuración por categoría: el Director
        //    puede tener el interruptor de su categoría encendido de antes, y
        //    seguiría diciendo que sí sobre un rol que ya no existe.
        if (typeof window.cronosHayPadres === 'function' && !window.cronosHayPadres()) return false;
        const configs = window._clubCategoryConfigs || {};
        const groupKey = window.getCategoryGroupKey(category, subcategory);
        // v586 · con herencia: un grupo recién estrenado (las dos FEM) respeta
        // lo que el Director tuviera puesto en el grupo del que salió.
        const groupCfg = (typeof window.cronosCfgGrupo === 'function')
            ? window.cronosCfgGrupo(configs, groupKey)
            : configs[groupKey];
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

if (typeof window._cronosRecipientType !== 'function') {
    window._cronosRecipientType = function(c) {
        return String((c && c.type) || '').trim().toLowerCase() || 'staff';
    };
}

// ── Los ALIAS del hijo, no "el" código del hijo ───────────────────────
// 🔑🔑 LA PRIMERA VERSIÓN DE ESTO ESTABA MAL Y DEJABA PASAR DUPLICADOS.
// Agrupaba por UN código elegido con una cadena de respaldos
// (`playerId || '#'+dorsal || nombre`). Pero los cuatro orígenes escriben
// el hijo de forma DISTINTA para el mismo niño:
//    · contact-manager.js  → playerId: l.playerId || ('J' + l.playerNumber)
//    · match-reports-send  → playerId: l.playerId, crudo
//    · usuarios 'parent'   → playerId: u.playerId || '', a menudo VACÍO
// Así que 'J-01', 'J1', el dorsal 1 y "Marcos" son el MISMO hijo y caían en
// grupos distintos — y dentro de cada grupo nunca se comparaban entre sí.
// El mismo familiar salía dos veces.
//
// Ahora cada entrada aporta un CONJUNTO de alias y dos referencias son el
// mismo hijo si comparten cualquiera. El número se extrae de los dígitos,
// que es lo que 'J-01', 'J1' y el dorsal 1 tienen en común.
if (typeof window._cronosRecipientChildAliases !== 'function') {
    window._cronosRecipientChildAliases = function(c) {
        // Se devuelven por separado los CÓDIGOS (id y dorsal, que identifican
        // al jugador sin ambigüedad) y los NOMBRES, que son un indicio más
        // flojo. La distinción importa al decidir si dos referencias se
        // CONTRADICEN — ver hijosSeContradicen.
        const codigos = new Set();
        const nombres = new Set();
        if (!c) return { codigos, nombres };

        const pid = String(c.playerId == null ? '' : c.playerId).trim().toLowerCase();
        if (pid) {
            codigos.add('id:' + pid);
            // Los dígitos son lo que 'J-01', 'J1' y el dorsal 1 tienen en común.
            const digitos = pid.replace(/\D/g, '').replace(/^0+/, '');
            if (digitos) codigos.add('n:' + digitos);
        }
        const num = String(c.playerNumber == null ? '' : c.playerNumber).replace(/\D/g, '').replace(/^0+/, '');
        if (num) codigos.add('n:' + num);

        const nombre = String(c.player == null ? '' : c.player).trim().toLowerCase().replace(/\s+/g, ' ');
        // "Jugador" es el relleno que ponen los orígenes cuando no saben el
        // nombre: como alias no distingue a nadie.
        if (nombre && nombre !== 'jugador') nombres.add('p:' + nombre);

        return { codigos, nombres };
    };
}

// Nombres de relleno que los orígenes ponen cuando no saben cómo se llama el
// familiar. No identifican a nadie, así que no pueden fundir a dos personas.
if (typeof window._cronosGenericRecipientName !== 'function') {
    window._cronosGenericRecipientName = function(n) {
        const s = String(n == null ? '' : n).trim().toLowerCase().replace(/\s+/g, ' ');
        if (!s) return true;
        return /^(padre|madre|tutor|tutora|familiar|padre\/tutor|padre\/madre|padre\/madre\/tutor|padre o madre|sin nombre|staff|entrenador)$/.test(s);
    };
}

if (typeof window._cronosDedupeRecipients !== 'function') {
    window._cronosDedupeRecipients = function(lista) {
        if (!Array.isArray(lista)) return [];
        const partesDe = window._cronosRecipientKeyParts;
        const tipoDe   = window._cronosRecipientType;
        const aliasDe  = window._cronosRecipientChildAliases;

        const cubos = [];          // conserva el orden de aparición
        const porTipo = new Map();

        // ── ¿Hay CONTRADICCIÓN entre dos identificadores fuertes? ──────
        // Que los dos traigan correo y sean distintos es una contradicción;
        // que uno traiga correo y el otro sólo teléfono, no lo es.
        const seContradicen = (a, b) => (
            (!!a.uid   && !!b.uid   && a.uid   !== b.uid) ||
            (!!a.email && !!b.email && a.email !== b.email) ||
            (!!a.phone && !!b.phone && a.phone !== b.phone)
        );

        // ── ¿Es la MISMA PERSONA? ──────────────────────────────────────
        // Comparten CUALQUIER identificador: cada origen rellena uno distinto
        // (uid / email / teléfono), así que exigir uno concreto es justo lo
        // que dejaba pasar duplicados.
        // El NOMBRE vale como último recurso —una copia manual puede traer
        // sólo el teléfono y otra sólo el correo—, pero nunca si los
        // identificadores se contradicen, ni si el nombre es un relleno del
        // tipo "Padre/Tutor", que no identifica a nadie.
        const mismaPersona = (a, b) => {
            if (!!a.uid   && a.uid   === b.uid)   return true;
            if (!!a.email && a.email === b.email) return true;
            if (!!a.phone && a.phone === b.phone) return true;
            return !!a.name && a.name === b.name &&
                   !window._cronosGenericRecipientName(a.name) &&
                   !seContradicen(a, b);
        };

        // ── ¿Son hijos DISTINTOS? ──────────────────────────────────────
        // ⚠️ LA ASIMETRÍA QUE SOSTIENE LA REGLA DEL AUTOR: separar exige
        // CONTRADICCIÓN demostrada; ante la duda se funde. Que dos referencias
        // "no coincidan" no prueba nada — un origen dice 'J-01' y otro dice
        // "Marcos", y es el mismo niño.
        //   · dos CÓDIGOS que no se solapan → hijos distintos (J-02 vs J-05);
        //   · si sólo una de las dos trae código, no hay contradicción posible;
        //   · sin códigos por ninguna parte, decide el nombre del jugador
        //     ("Marcos" frente a "Sara" sí son hermanos distintos).
        const hijosSeContradicen = (A, B) => {
            if (A.codigos.size && B.codigos.size) {
                for (const k of A.codigos) if (B.codigos.has(k)) return false;
                return true;
            }
            if (!A.codigos.size && !B.codigos.size && A.nombres.size && B.nombres.size) {
                for (const k of A.nombres) if (B.nombres.has(k)) return false;
                return true;
            }
            return false;
        };

        lista.forEach((c) => {
            if (!c) return;
            const tipo   = tipoDe(c);
            const partes = partesDe(c);
            const alias  = aliasDe(c);
            const candidatos = porTipo.get(tipo) || [];
            // Se recorre en orden de aparición y gana el primer cubo
            // compatible, para que una tercera copia sin dato de hijo caiga
            // en la línea más antigua y no invente una nueva.
            const cubo = candidatos.find(b =>
                mismaPersona(b._partes, partes) && !hijosSeContradicen(b._alias, alias));

            if (!cubo) {
                const nuevo = Object.assign({}, c, {
                    _partes: partes,
                    _alias: alias,
                    _ids: [c.id].filter(v => v != null && v !== ''),
                });
                cubos.push(nuevo);
                candidatos.push(nuevo);
                porTipo.set(tipo, candidatos);
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
            // Y los alias del hijo se ACUMULAN: si esta copia aportaba el
            // dorsal y el cubo sólo tenía el nombre, a partir de ahora el cubo
            // responde por los dos. Sin esto, la cadena 'J-01' → dorsal 1 →
            // "Marcos" se rompía en el segundo salto.
            alias.codigos.forEach(a => cubo._alias.codigos.add(a));
            alias.nombres.forEach(a => cubo._alias.nombres.add(a));
        });

        return cubos.map((b) => {
            const o = Object.assign({}, b);
            delete o._partes; delete o._alias;
            return o;
        });
    };
}

// ══════════════════════════════════════════════════════════════
// IDENTIDAD DE EQUIPO — el dato pertenece al EQUIPO, no al entrenador
// ══════════════════════════════════════════════════════════════
// El sistema pasa a estar centrado en el Equipo/Categoría. Para eso hace
// falta una clave de equipo estable, y aquí está la decisión que evita una
// migración de datos:
//
// 🔑 cronosTeamId() es una FUNCIÓN PURA de (clubId, categoría, subcategoría).
//    No es un identificador aleatorio guardado en ninguna parte. Por eso el
//    histórico YA ESCRITO —que no tiene campo `teamId`— se reconoce igual:
//    se recalcula al vuelo desde su `category`+`subcategory`, que sí llevan
//    desde siempre. Un identificador aleatorio habría obligado a reescribir
//    todos los documentos de producción para no perderlos de vista.
//
// ⚠️ CONSECUENCIA A RESPETAR: si algún día esto deja de ser una función pura
//    (p.ej. se pasa a un id aleatorio por equipo), TODO el histórico anterior
//    deja de casar de golpe y hace falta el backfill que aquí se evita.
//
// ⚠️ La normalización tiene que ser ESTABLE frente a las variaciones con que
//    los datos reales llegan: acentos ("Alevín"/"Alevin"), mayúsculas,
//    espacios de más y separadores. Dos escrituras del mismo equipo tienen
//    que dar la MISMA clave o el equipo se parte en dos.
// ¿Este carácter NO es una marca diacrítica combinante?
//
// ⚠️ Se comprueba por CÓDIGO de carácter y no con una clase de regex a
//    propósito. El bloque combinante (U+0300..U+036F) escrito dentro de una
//    regex acaba en el fichero como marcas sueltas literales —caracteres
//    invisibles que se pegan al corchete anterior—, y ahí cualquier paso que
//    toque la codificación las destruye SIN ERROR: la regex sigue compilando,
//    deja de casar acentos, y "Alevín" y "Alevin" pasan a ser dos equipos
//    distintos. Escrito así, el fuente es ASCII puro y no puede degradarse.
function _cronosNoEsAcento(caracter) {
    const cod = caracter.charCodeAt(0);
    return cod < 0x300 || cod > 0x36f;
}

function cronosTeamSlug(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .normalize('NFD')                  // separa la letra de su acento…
        .split('').filter(_cronosNoEsAcento).join('')   // …y lo descarta
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')       // cualquier separador → guion
        .replace(/^-+|-+$/g, '');          // sin guiones sueltos en los bordes
}

// Clave canónica del equipo. Un equipo SIN subcategoría es legítimo (algunos
// clubes sólo usan categoría), y entonces la clave queda con el tramo vacío:
// eso es deliberado, para que "Alevín" y "Alevín/A" NO sean el mismo equipo.
function cronosTeamId(clubId, category, subcategory) {
    const c = cronosTeamSlug(clubId);
    const cat = cronosTeamSlug(category);
    const sub = cronosTeamSlug(subcategory);
    if (!c || !cat) return '';   // sin club o sin categoría no hay equipo
    return c + '__' + cat + '__' + sub;
}

// ════════════════════════════════════════════════════════════════════
//  👥 v580 · LA PLANTILLA ES DEL EQUIPO, NO DE LA MODALIDAD
// ════════════════════════════════════════════════════════════════════
//  EL DEFECTO. `cronos_master_roster` era `{f7:[…], f11:[…]}` en
//  `users/{uid}/cronos_data/main`: UNA lista por modalidad y por PERSONA,
//  común a todos sus equipos y a todos sus clubes. Con dos equipos de la
//  misma modalidad, la plantilla de uno **borra la del otro, en silencio**.
//
//  🔑 Y NO ERA SOLO TEÓRICO. `cronosPuedeLlevarEquipo` impide dos equipos de
//  la misma modalidad… pero su filtro es `mismoClub`: **sólo mira DENTRO de un
//  club**. Un entrenador con plaza en dos clubes, ambos de Fútbol 7, pasa la
//  regla y comparte una sola lista. Ese camino está abierto hoy.
//
//  LA FORMA NUEVA, calcada de lo que hizo v557 con las ranuras de partido:
//      { f7: […], f11: […],                    ← legado, se conserva
//        porEquipo: { "<teamId>": { f7: […], f11: […] } } }
//
//  🔑 EL LEGADO NO SE BORRA NUNCA. Se sigue escribiendo en paralelo por dos
//  motivos: cualquier código que aún lea la forma vieja sigue funcionando, y
//  una app antigua servida desde caché no se queda sin plantilla. Cuesta unos
//  kilobytes y evita la clase de pérdida silenciosa que esto viene a arreglar.
//
//  ⚠️ LA MIGRACIÓN SIEMBRA TODOS LOS EQUIPOS DESDE EL LEGADO, no sólo el
//  primero. Es deliberado: HOY los dos equipos comparten esa lista, así que
//  sembrarlos a los dos reproduce exactamente lo que el entrenador ve ahora
//  —no le desaparece nada— y a partir del primer cambio cada equipo va por su
//  lado. Sembrar sólo al primero dejaría al otro con la plantilla en blanco
//  después de una actualización, que es justo el susto que hay que evitar.
const _ROSTER_KEY = 'cronos_master_roster';

function _cronosRosterVacio() { return { f7: [], f11: [] }; }

// El equipo abierto ahora mismo. Se resuelve EN CALIENTE (nunca se cachea:
// cambiar de equipo en el panel tiene que cambiar de plantilla en el acto) y
// se apoya en el mismo resolutor que usan las ranuras de partido, que ya trae
// toda la cascada de respaldos. '' significa "sin equipo": entrenador
// individual sin club, o sesión a medio arrancar.
function cronosPlantillaEquipo() {
    try {
        if (window._cronosMatchSlots &&
            typeof window._cronosMatchSlots.equipoActual === 'function') {
            return String(window._cronosMatchSlots.equipoActual() || '');
        }
    } catch (e) { /* sin equipo: se usa el legado */ }
    return '';
}

// La raíz completa, siempre con una forma utilizable.
function cronosPlantillaRaiz() {
    var raiz;
    try { raiz = JSON.parse(localStorage.getItem(_ROSTER_KEY) || 'null'); }
    catch (e) { raiz = null; }
    if (!raiz || typeof raiz !== 'object') raiz = _cronosRosterVacio();
    if (!Array.isArray(raiz.f7))  raiz.f7  = [];
    if (!Array.isArray(raiz.f11)) raiz.f11 = [];
    if (!raiz.porEquipo || typeof raiz.porEquipo !== 'object') raiz.porEquipo = {};
    return raiz;
}

// ⚠️⚠️ LA SEMILLA: UNA FOTO CONGELADA DEL LEGADO, Y NO EL LEGADO VIVO.
//
// 🔑 Aquí había un fallo de diseño que cazó el guard, y merece quedar escrito
// porque es sutil. La primera versión hacía que un equipo todavía sin plantilla
// propia heredase de `raiz[m]`… que es la clave que TODO guardado sigue
// refrescando. Secuencia real: el equipo B guarda su plantilla → `raiz.f7` pasa
// a ser la de B → el equipo A, que aún no se había materializado, leía la de B.
// **Es exactamente el defecto original reintroducido por la puerta de atrás.**
//
// La foto se toma UNA vez, la primera que alguien toca la plantilla tras
// actualizar, y ya no cambia nunca. Un equipo sin lista propia hereda de ESA
// foto —lo que el entrenador veía antes de v580—, no de lo último que se haya
// guardado. Cuando todos los equipos se han materializado, deja de usarse.
function _cronosPlantillaSemilla(raiz) {
    if (raiz.migrado) return raiz;
    raiz.semilla = { f7: raiz.f7.slice(), f11: raiz.f11.slice() };
    raiz.migrado = true;
    try { localStorage.setItem(_ROSTER_KEY, JSON.stringify(raiz)); } catch (e) {}
    return raiz;
}

// La plantilla del equipo abierto, en la modalidad pedida.
function cronosPlantillaLeer(mode) {
    var m = (mode === 'f11') ? 'f11' : 'f7';
    var raiz = cronosPlantillaRaiz();
    var eq = cronosPlantillaEquipo();
    if (!eq) return raiz[m];                      // sin equipo: el legado ES su plantilla
    raiz = _cronosPlantillaSemilla(raiz);
    if (raiz.porEquipo[eq] && Array.isArray(raiz.porEquipo[eq][m])) {
        return raiz.porEquipo[eq][m];             // ya tiene la suya
    }
    // Aún sin materializar: hereda la FOTO, nunca lo último guardado por otro.
    return (raiz.semilla && Array.isArray(raiz.semilla[m])) ? raiz.semilla[m] : raiz[m];
}

// Escribe la plantilla del equipo abierto. `opciones.nube` sube a Firestore.
function cronosPlantillaGuardar(mode, lista, opciones) {
    var m = (mode === 'f11') ? 'f11' : 'f7';
    var o = opciones || {};
    var raiz = cronosPlantillaRaiz();
    var eq = cronosPlantillaEquipo();
    var arr = Array.isArray(lista) ? lista : [];

    // La foto del legado se toma ANTES de escribir encima: si el primer gesto
    // tras actualizar es un guardado, sin esto la semilla nacería ya con el
    // dato nuevo y los demás equipos heredarían de él.
    if (eq) raiz = _cronosPlantillaSemilla(raiz);

    if (eq) {
        if (!raiz.porEquipo[eq] || typeof raiz.porEquipo[eq] !== 'object') {
            raiz.porEquipo[eq] = {};
        }
        raiz.porEquipo[eq][m] = arr;
    }
    // 🔑 El legado se mantiene SIEMPRE al día con lo último guardado: es lo que
    // deja seguir funcionando a cualquier lector que no haya migrado y a una
    // app vieja servida desde caché.
    raiz[m] = arr;

    var texto = JSON.stringify(raiz);
    try { localStorage.setItem(_ROSTER_KEY, texto); } catch (e) { /* cuota/privado */ }
    if (o.nube !== false && typeof window.cloudSet === 'function') {
        // Se devuelve la promesa: quien necesite confirmar la subida antes de
        // decir "guardada" puede esperarla (la lección de v570).
        return window.cloudSet(_ROSTER_KEY, texto);
    }
    return Promise.resolve(true);
}

// Las DOS modalidades del equipo abierto, con la misma forma `{f7, f11}` que
// tenía la raíz. Existe para que los diez consumidores que sólo LEEN —fichas,
// informes, contactos, asistencia, invitados— no tengan que cambiar ni una
// línea de su cuerpo: siguen escribiendo `roster[mode]`, pero ahora `roster`
// es el de SU equipo. Cambiar la lectura sin tocar la lógica es lo que hace
// que esta migración sea revisable.
function cronosPlantillaAmbas() {
    return { f7: cronosPlantillaLeer('f7'), f11: cronosPlantillaLeer('f11') };
}

if (typeof window !== 'undefined') {
    window.cronosPlantillaEquipo  = cronosPlantillaEquipo;
    window.cronosPlantillaRaiz    = cronosPlantillaRaiz;
    window.cronosPlantillaLeer    = cronosPlantillaLeer;
    window.cronosPlantillaAmbas   = cronosPlantillaAmbas;
    window.cronosPlantillaGuardar = cronosPlantillaGuardar;
}

// Clave de equipo de un documento CUALQUIERA, venga de donde venga.
//
// 🔑 Este es el corazón de la "doble lectura": prefiere el campo `teamId` que
//    escriben los documentos NUEVOS y, si no está, lo deduce de
//    `category`+`subcategory` como hace el histórico. Ningún consumidor
//    necesita saber cuál de los dos casos tiene delante.
function cronosTeamIdOfDoc(datos, clubIdPorDefecto) {
    if (!datos) return '';
    if (datos.teamId) return String(datos.teamId);
    return cronosTeamId(
        datos.clubId || clubIdPorDefecto || '',
        datos.category || '',
        datos.subcategory || ''
    );
}

// ¿Este documento pertenece a alguno de los equipos indicados?
// `equipos` es un array de claves de equipo (las del entrenador asignado).
// Un array VACÍO significa "sin restricción de equipo" y devuelve true: así
// los roles que ven el club entero (director, coordinador, administrador) no
// necesitan un camino aparte.
function cronosDocEsDeEquipo(datos, equipos, clubIdPorDefecto) {
    if (!Array.isArray(equipos) || equipos.length === 0) return true;
    const propio = cronosTeamIdOfDoc(datos, clubIdPorDefecto);
    if (!propio) return false;
    return equipos.indexOf(propio) !== -1;
}

// ── EL EQUIPO DEL USUARIO QUE TIENE LA SESIÓN ABIERTA ────────────────
// Devuelve { clubId, category, subcategory, teamId } o null si quien mira no
// está al frente de ningún equipo (director, coordinador, padre, admin…).
//
// 🔑 EXISTE PARA QUE HAYA UNA SOLA CASCADA. Esta resolución —rol activo, si
//    no el primer rol de entrenador de allRoles, si no la raíz del usuario—
//    ya estaba escrita dentro de js/roster/team-rosters.js (_miEquipo) y hace
//    falta ahora también en el cuadrante semanal y en la asistencia. Tres
//    copias de la misma cascada acaban divergiendo, y el día que divergen un
//    módulo ESCRIBE en un equipo mientras otro LEE de otro: los dos "funcionan"
//    y el dato se parte en dos sin un solo error en consola.
//
// ⚠️ NO filtra por `removedAt` ni por `authorized` A PROPÓSITO: reproduce
//    exactamente la cascada con la que se publicaron las fichas de equipo
//    (clubs/{club}/team_rosters). Cambiar el criterio aquí movería el teamId
//    de usuarios reales y dejaría su plantilla publicada huérfana.
function cronosMyTeam() {
    const me = window._cronosCurrentUser;
    if (!me) return null;

    let clubId = me.clubId || '';
    let cat = '', sub = '';

    const rd = me._activeRoleData;
    if (rd && (rd.role === 'user' || rd.role === 'coach')) {
        cat    = rd.category || rd.categoryLabel || '';
        sub    = rd.subcategory || '';
        clubId = rd.clubId || clubId;
    }
    if (!cat && Array.isArray(me.allRoles)) {
        for (let i = 0; i < me.allRoles.length; i++) {
            const r = me.allRoles[i];
            if (r && (r.role === 'user' || r.role === 'coach') && (r.category || r.categoryLabel)) {
                cat    = r.category || r.categoryLabel;
                sub    = r.subcategory || '';
                clubId = r.clubId || clubId;
                break;
            }
        }
    }
    if (!cat) {
        cat = me.category || me.categoryLabel || '';
        sub = sub || me.subcategory || '';
    }
    if (!clubId || !cat) return null;

    const teamId = cronosTeamId(clubId, cat, sub || '');
    if (!teamId) return null;
    return { clubId: clubId, category: cat, subcategory: sub || '', teamId: teamId };
}

// Clave de equipo del usuario actual, o '' si no lleva equipo. Atajo para los
// llamadores que sólo necesitan la clave.
function cronosMyTeamId() {
    const eq = cronosMyTeam();
    return eq ? eq.teamId : '';
}

// ── ¿SALIÓ DE INICIO? (columna PT, 2026-08-13) ──────────────────────
// Recibe el objeto de jugador VIVO del partido (window.players), no un
// informe ya guardado.
//
// 🔑🔑 `status` NO SIRVE: es el estado AL TERMINAR. Un suplente que entró en
//    el minuto 30 acaba con status 'field', y contarlo como titular es
//    exactamente el error que ya se pagó en la barra de minutos (v425).
//
// 🔑 Los dos marcadores buenos son `initialStatus` —el que fija la
//    convocatoria— y `titularOrder`, que vale 0..N para los titulares y 999
//    para el banquillo. Se miran los dos porque hay DOS caminos de arranque:
//    goToTitularSelection() pone titularOrder, y startMatchWithConvocation()
//    sólo pone initialStatus.
//
// ⚠️ VIVE AQUÍ Y NO EN CADA ESCRITOR. Los informes de plantilla los escriben
//    TRES ficheros distintos (match-reports-auto, match-reports-send y
//    collective-report); con una copia en cada uno, el día que cambie el
//    criterio dos de ellos se quedarían atrás y el acumulado mezclaría
//    partidos contados con reglas distintas.
// ════════════════════════════════════════════════════════════════════
//  🧮 EL CUPO DE LA CONVOCATORIA (v659) · modalidad × tipo de partido
// ════════════════════════════════════════════════════════════════════
//  Regla de competición del autor (2026-09-02):
//
//      LIGA y COPA          F7 → 14 convocados · 7 titulares
//                           F11 → 18 convocados · 11 titulares
//      PARTIDO AMISTOSO     convocatoria ABIERTA (sin tope)
//                           pero el tope de TITULARES SE MANTIENE (7 / 11)
//
//  🔑 LA COPA VA CON LA LIGA, no con el amistoso, y no es un descuido de la
//     implementación: el tope de convocados lo fija el ACTA de la federación,
//     y una copa oficial tiene acta igual que la liga. Lo que distingue al
//     amistoso es que no la hay. La condición se escribe por eso en positivo
//     sobre `amistoso` y no como una lista de competiciones oficiales, que
//     habría que ir ampliando cada vez que aparezca un torneo nuevo.
//
//  🔑 EL TOPE DE TITULARES NO ES ADMINISTRATIVO, ES DE JUEGO: en el campo hay
//     siete u once, se juegue lo que se juegue. Por eso es lo único que el
//     amistoso NO relaja. El de convocados sí lo es —lo fija el acta de la
//     federación— y en un amistoso no hay acta.
//
//  ⚠️ SE DEVUELVE `null`, NO `Infinity`, PARA "SIN TOPE". Infinity sobrevive
//     mal a un JSON.stringify (sale `null` igualmente, pero por accidente) y
//     hace que un `>` compare contra algo que no es un número de verdad.
//     `null` obliga a quien llama a preguntarse si hay tope, que es la
//     pregunta correcta.
//
//  ⚠️⚠️ ESTA FUNCIÓN NACE COMO LA DEFINICIÓN ÚNICA, PERO NO ES LA ÚNICA COPIA
//     QUE HAY HOY EN EL REPOSITORIO. Los números 14/18 y 7/11 están además
//     escritos en línea en js/ai/import.js (la pantalla de convocatoria en
//     vivo, ×2), js/core/event-listeners.js y js/shared/whatsapp-email.js.
//     NO se han tocado en esta ronda a propósito: son el camino del partido en
//     directo, no se pueden probar sin navegador, y el encargo era el
//     formulario manual. 👉 Si algún día cambian los cupos, hay que mirar LOS
//     CINCO SITIOS — o, mejor, hacer que los otros cuatro llamen aquí. Queda
//     escrito para que no se descubra por sorpresa (lección de v551).
//
//  ⚠️ Y OJO: la pantalla de convocatoria EN VIVO aplica 14/18 SIEMPRE, sin
//     distinguir liga de amistoso. La distinción es nueva y hoy sólo la conoce
//     el informe manual.
function cronosCupoConvocatoria(modalidad, tipoPartido) {
    var f11 = String(modalidad || '').toLowerCase() === 'f11';
    var amistoso = String(tipoPartido || '').toLowerCase() === 'amistoso';
    return {
        modalidad:     f11 ? 'f11' : 'f7',
        tipo:          amistoso ? 'amistoso' : 'liga',
        maxConvocados: amistoso ? null : (f11 ? 18 : 14),   // null = sin tope
        maxTitulares:  f11 ? 11 : 7,
    };
}

function cronosFueTitular(p) {
    if (!p) return false;
    if (p.initialStatus === 'field') return true;
    if (p.initialStatus === 'bench') return false;
    if (typeof p.titularOrder === 'number') return p.titularOrder !== 999;
    return false;
}

window.cronosFueTitular   = cronosFueTitular;
window.cronosCupoConvocatoria = cronosCupoConvocatoria;
window.cronosTeamSlug     = cronosTeamSlug;
window.cronosTeamId       = cronosTeamId;
window.cronosTeamIdOfDoc  = cronosTeamIdOfDoc;
window.cronosDocEsDeEquipo = cronosDocEsDeEquipo;
window.cronosMyTeam       = cronosMyTeam;
window.cronosMyTeamId     = cronosMyTeamId;

// ── Exportación global ────────────────────────────────────────
// Este archivo se carga como <script> clásico (NO type="module"),
// por lo que NO se puede usar `export`. Las funciones ya quedan
// disponibles globalmente como window.escapeHtml / window.escapeAttr.
// Los módulos ES deben referenciarlas desde window.
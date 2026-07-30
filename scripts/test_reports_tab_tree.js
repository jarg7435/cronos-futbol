// ─────────────────────────────────────────────────────────────────────────
// test_reports_tab_tree.js · FASE 5 (parte 2 de 2): la pestaña INFORMES del
// panel de Dirección pasa a árbol Categoría → Subcategoría, y dentro de cada
// subcategoría pinta la TABLA RESUMEN ACUMULADA de temporada encima del
// listado de informes partido a partido (requisito del autor, 2026-07-30).
//
// ⚠️ APARTE de test_reports_tab_module.js (47 aserciones) por la misma razón que
// en events-tab: aquel monta su sandbox con un `window` pelado, SIN el módulo
// compartido, así que ejercita el camino plano y hay que dejarlo intacto. Aquí
// se carga el módulo real, que es el único sitio donde se ve el árbol.
//
// LO QUE FIJA:
//   1. 🔑 El ORDEN dentro de la subcategoría: primero la tabla resumen, después
//      los informes. Es literalmente lo que pidió el autor ("parte alta" /
//      "parte baja") y es invisible para cualquier aserción de presencia.
//   2. 🔑 La tabla acumula TODOS los partidos de esa rama, no el último.
//   3. 🔑 Cada rama acumula LO SUYO: los goles de un equipo no pueden aparecer
//      en el resumen de otro.
//   4. _sdMatchData se rellena para TODOS los partidos, por los dos caminos de
//      render — de él dependen sdToggleReport y sdDeleteReport.
//   5. Sin el módulo, lista plana de siempre.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('── Informes: árbol + tabla resumen (fase 5) ──\n');

const SRC_REPORTS = leer('js/coach/reports/reports-tab.js');
const SRC_MOD     = leer('js/admin/shared/category-tree.js');

const _s = SRC_REPORTS.indexOf('async function _sdLoadReports');
if (_s === -1) throw new Error('No se encontró _sdLoadReports');
const BLOCK = SRC_REPORTS.slice(_s);

const escHtml = (str) => {
    if (str === null || str === undefined) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
    return String(str).replace(/[&<>"'/]/g, c => map[c]);
};

function buildSandbox({ reports = {}, users = {}, me = { uid: 'u1', clubId: 'club1', email: 'dir@x.com' },
                        withModule = true } = {}) {
    const store = { cronos_player_reports: Object.assign({}, reports), users: Object.assign({}, users) };
    const els = {};
    const el = (id) => (els[id] || (els[id] = {
        id, innerHTML: '', style: {}, dataset: {}, removed: false,
        remove() { this.removed = true; }, querySelector: () => null,
    }));
    const container = el('staff-dashboard-content');
    container.querySelector = (sel) => (sel === 'h3' ? el('__h3') : null);

    const matches = (data, clauses) => (clauses || []).every(c => {
        if (!c || !c.__where) return true;
        if (c.op === 'array-contains') return Array.isArray(data[c.field]) && data[c.field].includes(c.value);
        return data[c.field] === c.value;
    });

    const fakeFS = {
        db: {},
        collection: (db, col) => ({ __col: col }),
        query: (ref, ...clauses) => ({ __col: ref.__col, __clauses: clauses }),
        where: (field, op, value) => ({ __where: true, field, op, value }),
        orderBy: (f, d) => ({ __orderBy: f, dir: d }),
        limit: (n) => ({ __limit: n }),
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async (ref) => {
            const d = (store[ref.__col] || {})[ref.__id];
            return { exists: () => d !== undefined, data: () => d };
        },
        getDocs: async (ref) => {
            const st = store[ref.__col] || {};
            const rows = Object.keys(st).filter(id => matches(st[id], ref.__clauses)).map(id => [id, st[id]]);
            return { forEach: (cb) => rows.forEach(r => cb({ id: r[0], data: () => r[1] })) };
        },
        updateDoc: async () => {},
        deleteDoc: async () => {},
        arrayUnion: (...items) => ({ __arrayUnion: items }),
    };

    const sandbox = {
        document: { getElementById: (id) => (els[id] !== undefined ? els[id] : null) },
        confirm: () => true,
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl, RegExp, isFinite,
        btoa, unescape, encodeURIComponent, parseInt,
        _sdFS: async () => fakeFS,
        escapeHtml: escHtml,
        showToast: () => {}, showSpinner: () => {}, hideSpinner: () => {},
        _RP: { build: () => '<b>INFORME</b>' },
    };

    if (withModule) {
        sandbox.window = sandbox;
        vm.createContext(sandbox);
        vm.runInContext(SRC_MOD, sandbox);
        sandbox._cronosCurrentUser = me;
        sandbox._cronos_auth = { db: fakeFS.db };
        sandbox._CRONOS_DEBUG = false;
    } else {
        sandbox.window = { _cronosCurrentUser: me, _cronos_auth: { db: fakeFS.db }, _CRONOS_DEBUG: false };
        vm.createContext(sandbox);
    }
    vm.runInContext(BLOCK, sandbox);

    return { g: sandbox, w: sandbox.window, store, container };
}

const marcado = (h) => String(h).replace(/<style>[\s\S]*?<\/style>/g, '');
const cuenta = (h, re) => (String(h).match(re) || []).length;

// Un documento de informe de staff, uno por jugador y partido.
const R = (over) => Object.assign({
    staffReport: true, type: 'staff_match_report', clubId: 'club1',
    matchDate: '2026-03-02', rival: 'Rival A', coachUid: 'c_ana',
    coachEmail: 'ana@x.com', createdAt: '2026-03-02T10:00:00Z',
    scoreHome: 2, scoreAway: 1, myTeamRole: 'home',
    category: 'alevin', subcategory: 'A',
    playerNumber: '7', playerAlias: 'Martín',
    goals: 0, cards: null, injured: false, minutesPlayed: '45:00', history: [],
}, over || {});

const USERS = {
    c_ana: { role: 'user', clubId: 'club1', category: 'alevin', subcategory: 'A' },
    c_bea: { role: 'user', clubId: 'club1', category: 'cadete', subcategory: 'B' },
};

(async () => {

// ═══════ PARTE 1 · el árbol y el orden de los dos bloques ═══════
console.log('── PARTE 1 · 🔑 tabla arriba, informes abajo ──');
{
    const t = buildSandbox({ users: USERS, reports: {
        m1_p7:  R({ playerNumber: '7',  playerAlias: 'Martín', goals: 2, minutesPlayed: '90:00' }),
        m1_p10: R({ playerNumber: '10', playerAlias: 'Lucas',  goals: 1, minutesPlayed: '60:00' }),
    } });
    await t.g._sdLoadReports();
    const h = t.container.innerHTML;

    ok('1a · pinta el árbol', /ct-tree-cat/.test(h));
    ok('1b · con las 7 categorías', cuenta(h, /class="ct-tree-cat"/g) === 7,
       cuenta(h, /class="ct-tree-cat"/g));
    ok('1c · y la tabla resumen dentro', /class="ct-stats"/.test(h));

    // 🔑 EL ORDEN, que es el requisito literal del autor.
    const iTabla   = h.indexOf('ct-stats-wrap');
    const iInforme = h.indexOf('sd-report-card');
    ok('1d · 🔑 la tabla resumen va ARRIBA y el listado de informes DEBAJO',
       iTabla > -1 && iInforme > -1 && iTabla < iInforme,
       { tabla: iTabla, informe: iInforme });

    ok('1e · la cabecera de la pestaña se conserva', /📊 Informes/.test(h));
    ok('1f · arranca plegado', !/ct-tree-open/.test(marcado(h)));
    ok('1g · la tabla trae las 6 columnas acumuladas',
       ['PJ', 'Min', 'Goles', 'Amarillas', 'Rojas', 'Lesiones'].every(c => h.includes(c)));
    ok('1h · y una fila por jugador, ordenada por dorsal',
       h.indexOf('Martín') < h.indexOf('Lucas'));
}

// ═══════ PARTE 2 · la tabla acumula de verdad ═══════
console.log('\n── PARTE 2 · 🔑 acumula TODOS los partidos de la rama ──');
{
    // Dos partidos distintos (rival y fecha distintos → key distinta), mismo
    // jugador. La tabla debe sumar, no mostrar el último.
    const t = buildSandbox({ users: USERS, reports: {
        a_p7: R({ rival: 'Uno', matchDate: '2026-03-01', createdAt: '2026-03-01T10:00:00Z',
                  goals: 2, minutesPlayed: '90:00', cards: 'amarilla',
                  history: [{ type: 'yellow', timeStr: '10:00' }] }),
        b_p7: R({ rival: 'Dos', matchDate: '2026-03-08', createdAt: '2026-03-08T10:00:00Z',
                  goals: 3, minutesPlayed: '45:00', injured: true }),
    } });
    await t.g._sdLoadReports();
    const h = t.container.innerHTML;

    // Fila del jugador 7: PJ=2, Min=135, Goles=5, Amarillas=1, Rojas=0, Lesiones=1
    const fila = (h.match(/<td class="ct-stats-name">[\s\S]*?<\/tr>/) || [''])[0];
    ok('2a · 🔑 dos partidos → PJ 2', />2</.test(fila), fila);
    ok('2b · 🔑 suma los minutos de los dos (90+45 = 135)', />135</.test(fila), fila);
    ok('2c · 🔑 y los goles (2+3 = 5)', />5</.test(fila), fila);
    ok('2d · la amarilla del primer partido cuenta', />1</.test(fila), fila);
    ok('2e · hay dos tarjetas de informe, una por partido',
       cuenta(h, /class="sd-report-card"/g) === 2, cuenta(h, /class="sd-report-card"/g));
    ok('2f · y una sola tabla resumen para la rama',
       cuenta(h, /class="ct-stats"/g) === 1, cuenta(h, /class="ct-stats"/g));
    ok('2g · con su fila de total de equipo', /Total equipo/.test(h));
}

// ═══════ PARTE 3 · cada rama lo suyo ═══════
console.log('\n── PARTE 3 · 🔑 no se mezclan los equipos ──');
{
    const t = buildSandbox({ users: USERS, reports: {
        al_p7: R({ category: 'alevin', subcategory: 'A', coachUid: 'c_ana',
                   playerAlias: 'Martín', goals: 2 }),
        ca_p9: R({ category: 'cadete', subcategory: 'B', coachUid: 'c_bea',
                   rival: 'Otro', matchDate: '2026-03-09', createdAt: '2026-03-09T10:00:00Z',
                   playerNumber: '9', playerAlias: 'Sergio', goals: 7 }),
    } });
    await t.g._sdLoadReports();
    const h = t.container.innerHTML;

    ok('3a · dos ramas con datos → dos tablas resumen',
       cuenta(h, /class="ct-stats"/g) === 2, cuenta(h, /class="ct-stats"/g));

    // Acotar la rama de Alevín: desde su tarjeta de categoría hasta la siguiente.
    const trozos = h.split('class="ct-tree-cat"');
    const ramaAlevin = trozos.find(s => /Alev[íi]n<\/span>/.test(s)) || '';
    const ramaCadete = trozos.find(s => /Cadete<\/span>/.test(s)) || '';
    ok('3b · 🔑 el resumen de Alevín tiene a Martín y NO a Sergio',
       /Martín/.test(ramaAlevin) && !/Sergio/.test(ramaAlevin));
    ok('3c · 🔑 y el de Cadete a Sergio y NO a Martín',
       /Sergio/.test(ramaCadete) && !/Martín/.test(ramaCadete));
    // ⚠️ La primera versión de esta aserción buscaba ">7<" en la rama de Alevín
    // para probar que los 7 goles de Sergio no se colaban. Era un FALSO
    // POSITIVO: ">7<" casa con el DORSAL de Martín, que es el 7. Se compara la
    // fila de totales entera, que además es mucho más estricta.
    // ⚠️ La celda de minutos del total es "-" desde el ajuste del autor
    // (2026-07-30): sumar los minutos de toda la plantilla no significaba nada.
    // Por eso el parser acepta [^<]* y no \d+.
    const totalDe = (rama) => ((rama.match(/Total equipo<\/td>((?:<td[^>]*>[^<]*<\/td>){6})/) || [])[1] || '')
        .replace(/<td[^>]*>/g, ' ').replace(/<\/td>/g, ' ').trim().replace(/\s+/g, ',');
    // Orden de columnas: PJ (partidos del EQUIPO), Min (-), Goles, Amarillas, Rojas, Lesiones.
    ok('3d · 🔑 el total de Alevín es el suyo (1 partido de equipo, 2 goles)',
       totalDe(ramaAlevin) === '1,-,2,0,0,0', totalDe(ramaAlevin));
    ok('3e · 🔑 y el de Cadete el suyo (7 goles), sin contaminar al otro',
       totalDe(ramaCadete) === '1,-,7,0,0,0', totalDe(ramaCadete));
}

// ═══════ PARTE 4 · la caché de partidos y el histórico ═══════
console.log('\n── PARTE 4 · _sdMatchData y el respaldo por autor ──');
{
    const t = buildSandbox({ users: USERS, reports: {
        m_p7: R({ playerAlias: 'Martín' }),
        // Informe histórico: subcategoría vacía, se completa por el autor.
        h_p7: R({ subcategory: '', coachUid: 'c_ana', rival: 'Viejo',
                  matchDate: '2026-02-01', createdAt: '2026-02-01T10:00:00Z' }),
    } });
    await t.g._sdLoadReports();
    const h = t.container.innerHTML;
    const md = Object.keys(t.w._sdMatchData || {});

    ok('4a · 🔑 _sdMatchData cachea LOS DOS partidos', md.length === 2, md);
    ok('4b · sdToggleReport sigue asignado', typeof t.w.sdToggleReport === 'function');
    ok('4c · y sdDeleteReport también', typeof t.w.sdDeleteReport === 'function');
    ok('4d · 🔑 el informe con subcategoría vacía se coloca por su autor, no en "Sin clasificar"',
       !/ct-tree-none/.test(marcado(h)), 'aparece Sin clasificar');
    ok('4e · los dos informes están en el marcado',
       cuenta(h, /class="sd-report-card"/g) === 2);

    // Un informe que NO se puede clasificar no desaparece.
    const t2 = buildSandbox({ users: USERS, reports: {
        x_p7: R({ category: '', subcategory: '', coachUid: 'c_desconocido' }),
    } });
    await t2.g._sdLoadReports();
    ok('4f · 🔑 lo no clasificable va a "Sin clasificar", NO se pierde',
       /ct-tree-none/.test(marcado(t2.container.innerHTML)) &&
       /class="sd-report-card"/.test(t2.container.innerHTML));
    // 🔑 "Sin clasificar" NO lleva tabla resumen, y es a propósito: en esa rama
    // conviven informes de equipos distintos (justo por eso no se han podido
    // clasificar), así que un "acumulado de temporada" ahí sumaría jugadores de
    // varios equipos en una sola tabla y sería un dato falso. Los informes sí se
    // listan, que es lo que importa para no perder nada.
    ok('4g · 🔑 "Sin clasificar" NO lleva tabla resumen (mezclaría equipos)',
       !/class="ct-stats"/.test(t2.container.innerHTML));
}

// ═══════ PARTE 5 · sin el módulo, lista plana ═══════
console.log('\n── PARTE 5 · respaldo si el módulo no cargó ──');
{
    const t = buildSandbox({ withModule: false, users: USERS, reports: {
        m1_p7: R({ playerAlias: 'Martín' }),
        m2_p7: R({ rival: 'Dos', matchDate: '2026-03-08', createdAt: '2026-03-08T10:00:00Z' }),
    } });
    await t.g._sdLoadReports();
    const h = t.container.innerHTML;

    // 🔑 Entorno EXACTO de test_reports_tab_module.js: si esto se rompe, aquel
    // guard entero se cae con él.
    ok('5a · 🔑 sin el módulo NO revienta y pinta la lista plana',
       cuenta(h, /class="sd-report-card"/g) === 2 && !/ct-tree-cat/.test(h),
       h.slice(0, 200));
    ok('5b · sin tabla resumen', !/ct-stats/.test(h));
    ok('5c · la cabecera sigue', /📊 Informes/.test(h));
    ok('5d · los handlers se asignan igual',
       typeof t.w.sdToggleReport === 'function' && typeof t.w.sdDeleteReport === 'function');
    ok('5e · y _sdMatchData también se rellena', Object.keys(t.w._sdMatchData || {}).length === 2,
       Object.keys(t.w._sdMatchData || {}));
}

// ═══════ PARTE 6 · censos de fuente ═══════
console.log('\n── PARTE 6 · el código ──');
{
    const sinCom = SRC_REPORTS.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');

    ok('6a · 🔑 el árbol se pide condicionado a que el módulo exista',
       /typeof window\.ctRenderTree === 'function'/.test(sinCom) &&
       /typeof window\.ctRenderStatsTable === 'function'/.test(sinCom));
    ok('6b · 🔑 la tabla va en renderSubHeader (por equipo), no en renderLeaf',
       /renderSubHeader:[\s\S]{0,160}ctRenderStatsTable/.test(sinCom));
    ok('6c · 🔑 la tarjeta se genera con UN solo helper',
       /_sdReportCard/.test(sinCom) && cuenta(sinCom, /class="sd-report-card"/g) === 1);
    ok('6d · 🔑 _sdMatchData se rellena en su propia pasada, no dentro del render',
       /sorted\.forEach\(m => \{ window\._sdMatchData\[_sdKey64\(m\)\] = m; \}\);/.test(sinCom));
    ok('6e · reutiliza los usuarios ya leídos, sin consulta nueva',
       /_sdUserDocs/.test(sinCom) &&
       cuenta(sinCom, /collection\(db, 'users'\)/g) === 2);
    ok('6f · usa el resolutor y el acumulador compartidos, no copias locales',
       /ctResolveCatSub/.test(sinCom) && /ctAccumulatePlayerStats/.test(sinCom) &&
       !/normalize\('NFD'\)/.test(sinCom));
    ok('6g · reports-tab.js sigue en el precache de sw.js',
       /js\/coach\/reports\/reports-tab\.js/.test(leer('sw.js')));
}

// ═══════ PARTE 7 · 🔑 un jugador, UNA vez por partido ═══════
// FALLO REAL VISTO EN PRODUCCIÓN (2026-07-30, reportado por el autor): las
// tarjetas mostraban "42 JUGADORES", "84 JUGADORES".
//
// CAUSA: DOS escritores distintos crean documentos con staffReport:true para el
// MISMO jugador y el MISMO partido, con ids distintos:
//     ${matchId}_staff_p${n}   · match-reports-auto.js y match-reports-send.js
//     ${matchId}_p${n}         · collective-report.js
// La deduplicación por id de documento que ya había no los ve —son ids
// distintos— y los dos caen en la misma clave de agrupación (fecha_rival_coach),
// así que cada jugador se contaba tantas veces como vías de envío se usaran.
//
// ⚠️ Y NO ERA SÓLO EL CONTADOR: el mismo doble conteo inflaba los goles y las
// lesiones de la tarjeta, y TODA la tabla resumen (un jugador con un partido
// aparecía con PJ 2 y el doble de minutos). Por eso la deduplicación va en la
// AGREGACIÓN y no en el badge: arreglar sólo el número habría dejado el resto
// mintiendo, que es peor porque ya no se nota a simple vista.
console.log('\n── PARTE 7 · 🔑 deduplicación de jugadores por partido ──');
{
    // Mismo jugador (dorsal 7) por las dos vías, mismo partido. Más un segundo
    // jugador con una sola vía, para comprobar que no se pierde a nadie.
    const dupes = {
        'm1_staff_p7': R({ playerNumber: '7', playerAlias: 'Martín', goals: 2,
                           injured: true, minutesPlayed: '90:00',
                           createdAt: '2026-03-02T10:00:00Z' }),
        'm1_p7':       R({ playerNumber: '7', playerAlias: 'Martín', goals: 2,
                           injured: true, minutesPlayed: '90:00',
                           createdAt: '2026-03-02T11:00:00Z' }),
        'm1_staff_p10': R({ playerNumber: '10', playerAlias: 'Lucas', goals: 1,
                            minutesPlayed: '45:00', createdAt: '2026-03-02T10:00:00Z' }),
    };

    const t = buildSandbox({ users: USERS, reports: dupes });
    await t.g._sdLoadReports();
    const h = t.container.innerHTML;

    // ⚠️ Se extrae del BADGE concreto, no de un "\d+ jugadores" suelto: la
    // <caption> de la tabla resumen también dice "N jugadores con informes", así
    // que una búsqueda laxa podía dar verde leyendo el número equivocado.
    const badge = (html) => ((String(html).match(/sd-badge[^>]*>(\d+) jugadores<\/span>/) || [])[1] || '(no aparece)');

    ok('7a · 🔑 el badge cuenta JUGADORES ÚNICOS, no documentos (2, no 3)',
       badge(h) === '2', badge(h));

    ok('7b · 🔑 los goles de la tarjeta tampoco se duplican (2+1 = 3, no 5)',
       /⚽ 3 gol/.test(h), (h.match(/⚽ \d+ gol\w*/) || ['(no aparece)'])[0]);

    ok('7c · 🔑 ni las lesiones (1, no 2)',
       /🩹 1 lesión/.test(h), (h.match(/🩹 \d+ lesi\w*/) || ['(no aparece)'])[0]);

    // La tabla resumen sale del mismo array de players: si no se deduplica ahí,
    // el jugador 7 aparece con PJ 2 y 180 minutos.
    const totales = (h.match(/Total equipo<\/td>((?:<td[^>]*>[^<]*<\/td>){6})/) || [])[1] || '';
    const t7 = totales.replace(/<td[^>]*>/g, ' ').replace(/<\/td>/g, ' ').trim().replace(/\s+/g, ',');
    // PJ = 1 partido de equipo · Min = "-" · 3 goles · 1 lesión (sin duplicar).
    ok('7d · 🔑 la tabla resumen tampoco se infla (1 partido, 3 goles, 1 lesión)',
       t7 === '1,-,3,0,0,1', t7);

    // ⚠️ Acotado al <tbody>: la fila de "Total equipo" del <tfoot> usa la MISMA
    // clase ct-stats-name, así que contarlas en todo el HTML daba 3 y la
    // aserción fallaba por la razón equivocada, con el código ya correcto.
    const filasCuerpo = (html) => (((String(html).match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '')
        .match(/<td class="ct-stats-name">/g) || []).length;
    ok('7e · sigue habiendo UNA fila por jugador en el cuerpo de la tabla',
       filasCuerpo(h) === 2, filasCuerpo(h));

    // 🔑 Que no se pase de frenada: dos partidos distintos del mismo jugador
    // SIGUEN contando como dos.
    const dosPartidos = buildSandbox({ users: USERS, reports: {
        a_staff_p7: R({ rival: 'Uno', matchDate: '2026-03-01', createdAt: '2026-03-01T10:00:00Z',
                        goals: 1, minutesPlayed: '90:00' }),
        b_staff_p7: R({ rival: 'Dos', matchDate: '2026-03-08', createdAt: '2026-03-08T10:00:00Z',
                        goals: 1, minutesPlayed: '90:00' }),
    } });
    await dosPartidos.g._sdLoadReports();
    const hd = dosPartidos.container.innerHTML;
    const td = ((hd.match(/Total equipo<\/td>((?:<td[^>]*>[^<]*<\/td>){6})/) || [])[1] || '')
        .replace(/<td[^>]*>/g, ' ').replace(/<\/td>/g, ' ').trim().replace(/\s+/g, ',');
    ok('7f · 🔑 NO deduplica de más: dos partidos distintos siguen contando 2',
       td === '2,-,2,0,0,0', td);
    // Y en la fila del jugador sí se ven sus 2 partidos y sus 180 minutos: es
    // ahí donde esos números significan algo.
    ok('7f-bis · el jugador conserva sus 2 partidos y 180 minutos',
       /<td>2<\/td><td>180<\/td>/.test(hd),
       (hd.match(/ct-stats-name[\s\S]{0,200}/) || [''])[0]);
    ok('7g · y son dos tarjetas de informe',
       (hd.match(/class="sd-report-card"/g) || []).length === 2);

    // Jugadores sin dorsal: se distinguen por alias y no se colapsan entre sí.
    const sinDorsal = buildSandbox({ users: USERS, reports: {
        x1: R({ playerNumber: '', playerAlias: 'Iván' }),
        x2: R({ playerNumber: '', playerAlias: 'Nico' }),
        x3: R({ playerNumber: '', playerAlias: 'Iván' }),   // duplicado real
    } });
    await sinDorsal.g._sdLoadReports();
    ok('7h · 🔑 sin dorsal se deduplica por alias, sin colapsar a jugadores distintos',
       badge(sinDorsal.container.innerHTML) === '2', badge(sinDorsal.container.innerHTML));

    // 🔑 El arreglo va en la agregación, así que tiene que valer TAMBIÉN en el
    // camino plano (sin el módulo cargado).
    const plano = buildSandbox({ withModule: false, users: USERS, reports: dupes });
    await plano.g._sdLoadReports();
    ok('7i · 🔑 también deduplica en la lista plana, sin el módulo',
       badge(plano.container.innerHTML) === '2', badge(plano.container.innerHTML));

    // 🔑 El índice de deduplicación es un ANDAMIO y tiene que desaparecer: estos
    // objetos se cachean en window._sdMatchData y de ahí van al motor de
    // informes _RP.build(). Un Map colado ahí no da error visible, que es
    // justamente por lo que hay que fijarlo. (Sin esta aserción, la mutación
    // "andamio-visible" pasaba el guard entero en verde.)
    ok('7k · 🔑 el índice de deduplicación no se cuela en _sdMatchData',
       Object.values(t.w._sdMatchData || {}).every(m => !('_byPlayer' in m)),
       Object.keys(Object.values(t.w._sdMatchData || {})[0] || {}).join(','));

    // Censo: la deduplicación existe en el fuente y no es un parche en el badge.
    const sinCom = SRC_REPORTS.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
    ok('7j · 🔑 se deduplica al AGRUPAR, no maquillando m.players.length',
       /_sdPlayerKey|_sdDedup/.test(sinCom) &&
       /\$\{m\.players\.length\} jugadores/.test(sinCom),
       'el badge debe seguir leyendo players.length, ya deduplicado');
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.log('FAIL excepción no capturada: ' + e.stack); process.exit(1); });

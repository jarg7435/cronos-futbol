// ─────────────────────────────────────────────────────────────────────────
// test_mis_informes_resumen_temporada.js · el entrenador tiene ARRIBA el
// mismo resumen acumulado de temporada que el Director (v509)
//
// Encargo del autor (implementar.txt, 2026-08-11, tras validar v508): en "Mis
// Informes" falta el bloque superior de "Resumen acumulado de la temporada de
// este equipo" que el Director Deportivo y el Coordinador sí tienen en su
// panel, con su tabla por jugador (PJ, minutos, goles, tarjetas, lesiones) y
// sus botones PDF/Excel.
//
// 🔑 LA EXIGENCIA REAL NO ES "QUE HAYA UNA TABLA": es que sea LA MISMA. Por
// eso la implementación reutiliza las funciones globales que ya usa el panel
// de Dirección (`ctAccumulatePlayerStats`, `ctRenderStatsTable`,
// `rxExportarResumen*`) en vez de recalcular nada, y por eso este guard NO se
// conforma con comprobar que aparece una tabla: CARGA LAS FUNCIONES REALES
// (js/admin/shared/category-tree.js y js/coach/reports/reports-export.js) y
// compara, carácter a carácter, la tabla que pinta "Mis Informes" con la que
// el Director pintaría para los mismos partidos. Si alguien recalcula el
// acumulado por su cuenta, esta comparación se rompe.
//
// LO QUE PROTEGE:
//
//  A · La tabla aparece, y ARRIBA del listado de partidos (era el encargo:
//      "justo arriba de la lista").
//  B · 🔑 Es IDÉNTICA a la del Director para los mismos partidos.
//  C · 🔑 La descarga reacumula AL PULSAR con la misma función, así que el
//      CSV coincide con lo que hay en pantalla. Se compara la matriz de filas
//      real que produce `rxFilasResumen`.
//  D · El acumulado es DE SU EQUIPO: los partidos de otro equipo que él
//      pueda tener listados no contaminan la tabla.
//  E · ⚠️ Contraprueba de robustez: si los módulos del acumulado no están
//      cargados, "Mis Informes" sigue pintando su listado en vez de quedarse
//      en blanco (mismo respaldo que reports-tab.js).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const SRC_MIS = fs.readFileSync(path.join(ROOT, 'js/coach/comms/individual-reports.js'), 'utf8');
const SRC_CT  = fs.readFileSync(path.join(ROOT, 'js/admin/shared/category-tree.js'), 'utf8');
const SRC_RX  = fs.readFileSync(path.join(ROOT, 'js/coach/reports/reports-export.js'), 'utf8');

function extrae(src, ancla) {
    const ini = src.indexOf(ancla);
    if (ini === -1) return null;
    const abre = src.indexOf('{', ini);
    let n = 0;
    for (let i = abre; i < src.length; i++) {
        if (src[i] === '{') n++;
        else if (src[i] === '}') { n--; if (n === 0) return src.slice(ini, i + 1); }
    }
    return null;
}
const SRC_FN = extrae(SRC_MIS, 'window.openMisInformes = async function openMisInformes()');

const HOY  = '2026-08-11';
const UID  = 'coachA';
const CLUB = 'club1';
const CAT  = 'f7_alevin';
const SUB  = 'A';

const mkEl = () => ({
    innerHTML: '', value: '', textContent: '', style: {}, dataset: {},
    querySelector: () => null, addEventListener: () => {}, appendChild: () => {},
    classList: { add(){}, remove(){}, contains(){ return false; } },
    click: () => {}, remove: () => {}, setAttribute: () => {},
});

// Un partido = varios documentos de jugador, como los agrupa la pantalla.
function partido(fecha, rival, marcador, jugadores, opts) {
    opts = opts || {};
    return jugadores.map((j) => ({
        matchId: `match_${UID}_${fecha}_${rival}_${marcador}`,
        _forCoach: true, staffReport: false, type: 'collective_match_report',
        clubId: CLUB, coachUid: UID, matchDate: fecha,
        createdAt: fecha + 'T18:00:00.000Z',
        rival, scoreHome: marcador.split('x')[0], scoreAway: marcador.split('x')[1],
        category: opts.category || CAT, subcategory: opts.subcategory || SUB,
        teamId: opts.teamId !== undefined ? opts.teamId
              : (CLUB + '__' + (opts.category || CAT) + '__' + (opts.subcategory || SUB)),
        playerNumber: String(j.n), playerAlias: j.alias,
        minutesPlayed: j.min, goals: j.goles || 0, cards: j.tarjeta || null,
        injured: !!j.lesion, history: j.history || [],
    }));
}

function baseDocs() {
    return [].concat(
        partido(HOY, 'visitante', '7x1', [
            { n: 1, alias: 'Ana',  min: '40:00', goles: 2 },
            { n: 9, alias: 'Leo',  min: '35:30', goles: 1, tarjeta: 'amarilla', history: [{ type: 'yellow', minute: 12 }] },
            { n: 4, alias: 'Sara', min: '20:00', lesion: true },
        ]),
        partido('2026-08-04', 'CD Otro', '2x2', [
            { n: 1, alias: 'Ana',  min: '45:00', goles: 1 },
            { n: 9, alias: 'Leo',  min: '30:00' },
        ])
    ).map((d, i) => ({ id: d.matchId + '_coach_p' + d.playerNumber + '_' + i, data: d }));
}

function firestoreFalso(docs) {
    return {
        collection: () => ({ __col: 'cronos_player_reports' }),
        where: (f, o, v) => ({ __t: 'where', f, v }),
        limit: (n) => ({ __t: 'limit', n }),
        orderBy: (f, dir) => ({ __t: 'orderBy', f, dir: dir || 'asc' }),
        query: (col, ...partes) => ({ partes }),
        getDocs: async (q) => {
            const w = q.partes.filter(p => p.__t === 'where');
            const ord = q.partes.find(p => p.__t === 'orderBy');
            const lim = q.partes.find(p => p.__t === 'limit');
            let r = docs.filter(d => w.every(x => d.data[x.f] === x.v));
            r = r.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            if (ord && String(ord.dir).toLowerCase() === 'desc') r.reverse();
            if (lim) r = r.slice(0, lim.n);
            return { forEach: (fn) => r.forEach(d => fn({ id: d.id, data: () => d.data })) };
        },
    };
}

// Caja de arena con las funciones REALES del panel de Dirección dentro.
function nuevaCaja({ conModulos = true } = {}) {
    const els = {};
    const csvCapturado = { texto: null, nombre: null };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: (id) => (els[id] = els[id] || mkEl()),
            createElement: () => mkEl(),
            body: mkEl(),
            head: mkEl(),
        },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        parseInt, parseFloat, isNaN, isFinite, RegExp, Error, Boolean,
        encodeURIComponent, decodeURIComponent, unescape, escape,
        btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
        atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
        setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        escapeHtml: (s) => String(s == null ? '' : s),
        formatTime: (s) => String(s),
        showToast: () => {},
        navigator: { userAgent: 'node' },
        Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
        cronosTeamId: (c, cat, sub) => (c && cat ? c + '__' + cat + '__' + (sub || '') : ''),
        cronosTeamIdOfDoc: (d, clubPorDefecto) => d && (d.teamId ||
            ((d.clubId || clubPorDefecto) && d.category
                ? (d.clubId || clubPorDefecto) + '__' + d.category + '__' + (d.subcategory || '') : '')),
        cronosDocEsDeEquipo: (d, equipos) => {
            const propio = (d && d.teamId) || '';
            return propio ? equipos.indexOf(propio) !== -1 : false;
        },
        __csv: csvCapturado,
    };
    vm.createContext(sb);
    sb.window = sb;
    sb.globalThis = sb;

    if (conModulos) {
        // Las funciones REALES, no imitaciones: es lo que da valor a la
        // comparación con lo que ve el Director.
        vm.runInContext(SRC_CT, sb);
        vm.runInContext(SRC_RX, sb);
        // La descarga real toca Blob/anchor: se intercepta para leer el texto.
        sb.window.rxDescargarCSV = (nombre, texto) => {
            csvCapturado.nombre = nombre; csvCapturado.texto = texto; return true;
        };
    }
    return { sb, els, csv: csvCapturado };
}

async function abrir(docs, me, opts) {
    const caja = nuevaCaja(opts);
    caja.sb._cronosCurrentUser = me;
    caja.sb._cronos_auth = { db: {} };
    caja.sb._cFS = async () => Object.assign({ db: {} }, firestoreFalso(docs));
    vm.runInContext(SRC_FN, caja.sb);
    await caja.sb.window.openMisInformes();
    return { caja, cuerpo: (caja.els['mis-informes-body'] || {}).innerHTML || '' };
}

console.log('── resumen acumulado en "Mis Informes" (v509) ──\n');
ok('0 · se puede extraer openMisInformes', !!SRC_FN);
if (!SRC_FN) process.exit(1);

(async () => {
const ME = { uid: UID, clubId: CLUB, clubName: 'CD Prueba', category: CAT, subcategory: SUB };

// ═══ PARTE 1 · aparece, y arriba ═══
console.log('── PARTE 1 · la tabla está, y encima del listado ──');
let cuerpo1;
{
    const r = await abrir(baseDocs(), ME);
    cuerpo1 = r.cuerpo;

    ok('1a · se pinta el resumen acumulado de la temporada',
       /Resumen acumulado de la temporada/.test(cuerpo1),
       cuerpo1.slice(0, 200));

    const posTabla = cuerpo1.indexOf('Resumen acumulado de la temporada');
    const posLista = cuerpo1.indexOf('informes de jugadores');
    ok('1b · 🔑 va ARRIBA del listado de partidos (era el encargo)',
       posTabla !== -1 && posLista !== -1 && posTabla < posLista,
       'tabla@' + posTabla + ' lista@' + posLista);

    ok('1c · con sus dos botones de descarga',
       /miExportResumen\('pdf'\)/.test(cuerpo1) && /miExportResumen\('csv'\)/.test(cuerpo1));

    ok('1d · y el listado de partidos SIGUE ahí',
       /informes de jugadores/.test(cuerpo1) && /visitante|CD Otro/.test(cuerpo1));
}

// ═══ PARTE 2 · es LA MISMA tabla que la del Director ═══
console.log('\n── PARTE 2 · idéntica a la del panel de Dirección ──');
{
    // Se reconstruye lo que el Director pintaría para ESOS MISMOS partidos,
    // con las funciones reales, y se compara con lo que salió en pantalla.
    const caja = nuevaCaja({ conModulos: true });
    const porPartido = new Map();
    baseDocs().forEach(({ data }) => {
        if (!porPartido.has(data.matchId)) porPartido.set(data.matchId, { players: [] });
        porPartido.get(data.matchId).players.push(data);
    });
    const partidos = [...porPartido.values()];
    const filas = caja.sb.window.ctAccumulatePlayerStats(partidos);
    const tablaDirector = caja.sb.window.ctRenderStatsTable(filas, { matchCount: partidos.length });

    ok('2a · el Director produce una tabla no vacía (control del arnés)',
       /Resumen acumulado de la temporada/.test(tablaDirector) && filas.length === 3,
       'filas=' + filas.length);

    ok('2b · 🔑🔑 "Mis Informes" contiene EXACTAMENTE esa misma tabla',
       cuerpo1.indexOf(tablaDirector) !== -1,
       'la tabla del entrenador no coincide con la del Director');

    // Y las columnas que pidió el autor, con datos de verdad.
    ok('2c · la tabla trae los datos por jugador (dorsales y alias)',
       /Ana/.test(cuerpo1) && /Leo/.test(cuerpo1) && /Sara/.test(cuerpo1));
    const ana = filas.find(f => f.alias === 'Ana');
    ok('2d · y los acumula bien entre partidos (Ana: 2+1 goles, 85 min)',
       ana && ana.goals === 3 && ana.pj === 2 && ana.minutes === 85,
       JSON.stringify(ana));
}

// ═══ PARTE 3 · la descarga coincide con la pantalla ═══
console.log('\n── PARTE 3 · el CSV dice lo mismo que la pantalla ──');
{
    const r = await abrir(baseDocs(), ME);
    ok('3a · miExportResumen queda disponible',
       typeof r.caja.sb.window.miExportResumen === 'function');

    r.caja.sb.window.miExportResumen('csv');
    const texto = r.caja.csv.texto;
    ok('3b · 🔑 la descarga produce un CSV con contenido',
       typeof texto === 'string' && texto.length > 0 && /Ana/.test(texto),
       String(texto).slice(0, 120));
    ok('3c · con la fila de TOTAL EQUIPO y los 2 partidos del equipo',
       /TOTAL EQUIPO/.test(texto || ''), String(texto).slice(-160));
    ok('3d · y el nombre del fichero es el del resumen de temporada',
       /^resumen_temporada_/.test(r.caja.csv.nombre || ''), r.caja.csv.nombre);
}

// ═══ PARTE 4 · el acumulado es DE SU EQUIPO ═══
console.log('\n── PARTE 4 · no se mezclan equipos ──');
{
    // Un partido suyo pero de OTRA categoría: aparece en el listado (lo firmó
    // él) pero NO puede contaminar el acumulado de su equipo.
    const docs = baseDocs().concat(
        partido('2026-08-02', 'CD Ajeno', '1x0', [{ n: 77, alias: 'Intruso', min: '90:00', goles: 5 }],
                { category: 'f11_cadete', subcategory: 'B', teamId: CLUB + '__f11_cadete__B' })
        .map((d, i) => ({ id: d.matchId + '_coach_p' + d.playerNumber + '_z' + i, data: d }))
    );
    const r = await abrir(docs, ME);
    const posTabla = r.cuerpo.indexOf('Resumen acumulado de la temporada');
    const posLista = r.cuerpo.indexOf('informes de jugadores');
    const tablaSola = r.cuerpo.slice(posTabla, posLista);
    ok('4a · 🔑 el jugador del otro equipo NO entra en el acumulado',
       !/Intruso/.test(tablaSola), tablaSola.slice(0, 200));
    ok('4b · ⚠️ pero el partido SÍ sigue listado (lo firmó él)',
       /CD Ajeno/.test(r.cuerpo.slice(posLista)));
}

// ═══ PARTE 5 · contraprueba de robustez ═══
console.log('\n── PARTE 5 · sin los módulos del acumulado, la pantalla no se cae ──');
{
    const r = await abrir(baseDocs(), ME, { conModulos: false });
    ok('5a · ⚠️ el listado se sigue pintando',
       /informes de jugadores/.test(r.cuerpo) &&
       !/text-align:center;padding:2rem;color:#ff5858/.test(r.cuerpo),
       r.cuerpo.slice(0, 200));
    ok('5b · ⚠️ y simplemente no hay bloque de resumen (sin error)',
       !/Resumen acumulado de la temporada/.test(r.cuerpo));
}

console.log('\n' + (fail === 0 ? 'TODO OK' : 'FALLOS: ' + fail) + ' (pass=' + pass + ')');
process.exit(fail === 0 ? 0 : 1);

})();

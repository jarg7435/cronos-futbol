// ─────────────────────────────────────────────────────────────────────────
// test_reports_export.js · DESCARGA en PDF y CSV desde la pestaña "Informes"
// del Panel de Dirección (encargo del autor, 2026-08-08).
//
// Cubre js/coach/reports/reports-export.js (el formateo) y el cableado de los
// botones en js/coach/reports/reports-tab.js (de dónde salen los datos).
//
// ── LO QUE FIJA, Y POR QUÉ NO BASTA UN REGEX ─────────────────────────────
//  1. 🔑 `print-color-adjust: exact`. Sin esa regla el navegador tira los
//     fondos al imprimir y el informe grupal —cuyos colores van EN LÍNEA y
//     pensados para fondo oscuro— sale blanco sobre blanco. NO da ningún
//     error: se descarga un PDF con páginas en blanco, que es justo el tipo de
//     fallo que nadie nota hasta que lo abre el destinatario.
//  2. 🔑 El motor de informes usa `var(--text-muted)`, que vive en style.css.
//     La ventana de impresión NO carga esa hoja, así que el documento tiene
//     que redefinir las variables por su cuenta.
//  3. 🔑🔑 EL CSV SE ESCRIBE EN UTF-16LE, y la aserción mira los BYTES.
//     La primera versión lo escribía en UTF-8 con BOM —lo del manual— y esta
//     misma parte daba VERDE mientras el autor abría el archivo con las tildes
//     rotas (`CompeticiÃ³n`): el guard comprobaba la CADENA de JavaScript sobre
//     un Blob simulado que nunca codificaba nada. El BOM estaba; su Excel lo
//     ignoró, que es lo que el de UTF-8 permite y el de UTF-16 no.
//     LECCIÓN: para hablar de codificaciones hay que mirar bytes, y el doble
//     tiene que codificar de verdad.
//  3-bis. Y el separador sigue siendo PUNTO Y COMA: en su captura las columnas
//     SÍ salían separadas, así que eso ya acertaba y no se toca.
//  3-ter. 🔑 Las incidencias van en español Y respetan los matices del informe:
//     un GOL ANULADO no se escribe "Gol", una segunda amarilla es una
//     expulsión, y el "Sale (DESCANSO)" que la app apunta sola a TODOS los del
//     campo no es una sustitución (en un F7 son 14 cambios falsos).
//  4. 🔑 El <a> se adjunta al DOM ANTES del click (Firefox ignora un click
//     sobre un <a> suelto). Ya se pagó en individual-reports.js.
//  5. 🔑 Los TOTALES del papel dicen lo mismo que los de la pantalla: PJ del
//     equipo (no la suma de participaciones) y minutos sin sumar. Un PDF que
//     contradiga al panel es peor que no tener PDF.
//  6. 🔑 El PDF de un informe grupal se genera AUNQUE la tarjeta nunca se haya
//     desplegado. Se ejecuta de verdad, con el motor simulado: un censo de
//     fuente vería la llamada, no si el camino la alcanza.
//  7. 🔑 El módulo NO puede nombrar `_RP` ni `_sdMatchData`: dos guards ajenos
//     (test_report_engine_module 1e y test_reports_tab_module 1d) mantienen
//     listas CERRADAS de quién puede nombrarlos. Se comprueba aquí para que el
//     motivo quede escrito donde se rompería.
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

console.log('── Descarga de informes en PDF / CSV ──\n');

const SRC_EXPORT  = leer('js/coach/reports/reports-export.js');
const SRC_REPORTS = leer('js/coach/reports/reports-tab.js');
const SRC_TREE    = leer('js/admin/shared/category-tree.js');

const _s = SRC_REPORTS.indexOf('async function _sdLoadReports');
if (_s === -1) throw new Error('No se encontró _sdLoadReports');
const BLOCK = SRC_REPORTS.slice(_s);

const escHtml = (str) => {
    if (str === null || str === undefined) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
    return String(str).replace(/[&<>"'/]/g, c => map[c]);
};

// ═══════════════════ Sandbox del módulo de exportación ═════════════════════
// Un navegador de mentira que REGISTRA lo que el módulo intenta hacer:
// descargas (Blob + <a>) y ventanas de impresión.
// ⚠️⚠️ AQUÍ VA EL `Blob` DE VERDAD, NO UNO DE MENTIRA. La primera versión de
// este guard montaba un FakeBlob que se limitaba a concatenar las cadenas que
// recibía, así que la asercion del BOM comprobaba la CADENA de JavaScript y
// nunca los BYTES del archivo. Daba verde con un fallo de codificación real
// delante. El Blob nativo de Node codifica igual que el del navegador, que es
// lo unico que sirve para hablar de codificaciones.
function exportSandbox({ popupBloqueado = false } = {}) {
    const descargas = [];   // { nombre, blob, mime, ordenDom }
    const ventanas  = [];   // { html }
    const toasts    = [];
    const dom       = [];   // traza de appendChild / click / removeChild

    let pendiente = null;
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        Blob, Uint8Array, setTimeout,
        URL: {
            createObjectURL: (b) => { pendiente = b; return 'blob:fake'; },
            revokeObjectURL: () => { dom.push('revoke'); },
        },
        document: {
            createElement: (tag) => ({
                tagName: tag, href: '', download: '',
                click() {
                    dom.push('click');
                    descargas.push({
                        nombre: this.download,
                        blob: pendiente,
                        mime: pendiente ? pendiente.type : '',
                        ordenDom: dom.slice(),
                    });
                },
            }),
            body: {
                appendChild: () => dom.push('append'),
                removeChild: () => dom.push('remove'),
            },
        },
        escapeHtml: escHtml,
        showToast: (m) => toasts.push(String(m)),
        Date, Math, JSON, Intl, String, Number, Object, Array, RegExp, isFinite, parseInt,
    };
    sandbox.window = sandbox;
    sandbox.open = (_url, _target) => {
        if (popupBloqueado) return null;
        const v = { html: '' };
        ventanas.push(v);
        return {
            document: {
                open() {}, close() {},
                write(h) { v.html += h; },
            },
        };
    };
    vm.createContext(sandbox);
    vm.runInContext(SRC_EXPORT, sandbox);
    return { w: sandbox, descargas, ventanas, toasts, dom };
}

// Los BYTES que de verdad se descargarían.
const bytesDe = async (d) => Buffer.from(await d.blob.arrayBuffer());
// Y su texto, decodificado como lo hará el lector: UTF-16LE.
const textoDe = async (d) => (await bytesDe(d)).toString('utf16le').replace(/^﻿/, '');

// Filas tal como las devuelve window.ctAccumulatePlayerStats.
const F = (over) => Object.assign(
    { number: '7', alias: 'Martín', called: 1, pj: 1, seconds: 2700, minutes: 45,
      goals: 0, yellow: 0, red: 0, injuries: 0 }, over || {});

// ═══════════════════ Sandbox de la pestaña (reports-tab) ═══════════════════
function tabSandbox({ reports = {}, users = {}, withModule = true, withExport = true,
                      me = { uid: 'u1', clubId: 'club1', clubName: 'CD Test', email: 'dir@x.com' } } = {}) {
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

    const rpCalls = [];
    const sandbox = {
        document: { getElementById: (id) => (els[id] !== undefined ? els[id] : null) },
        confirm: () => true,
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl, RegExp, isFinite,
        btoa, unescape, encodeURIComponent, parseInt,
        _sdFS: async () => fakeFS,
        escapeHtml: escHtml,
        showToast: () => {}, showSpinner: () => {}, hideSpinner: () => {},
        _RP: { build: (m) => { rpCalls.push(m && m.rival); return '<b>INFORME ' + (m && m.rival) + '</b>'; } },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    if (withModule) vm.runInContext(SRC_TREE, sandbox);
    if (withExport) {
        // Doble del módulo real: aquí interesa QUÉ datos le llegan, no el
        // formato (eso lo fijan las partes 2 a 6 contra el módulo de verdad).
        sandbox.rxExportarResumenCSV  = (b, meta) => { sandbox.__resumen = { fmt: 'csv', b, meta }; return true; };
        sandbox.rxExportarResumenPDF  = (b, meta) => { sandbox.__resumen = { fmt: 'pdf', b, meta }; return true; };
        sandbox.rxExportarInformeCSV  = (m) => { sandbox.__informe = { fmt: 'csv', m }; return true; };
        sandbox.rxExportarInformePDF  = (m, html, meta) => { sandbox.__informe = { fmt: 'pdf', m, html, meta }; return true; };
    }
    sandbox._cronosCurrentUser = me;
    sandbox._cronos_auth = { db: fakeFS.db };
    sandbox._CRONOS_DEBUG = false;
    vm.runInContext(BLOCK, sandbox);
    return { g: sandbox, w: sandbox, container, rpCalls };
}

const R = (over) => Object.assign({
    staffReport: true, clubId: 'club1',
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

const cuenta = (h, re) => (String(h).match(re) || []).length;
// Comentarios fuera: un censo no debe dar por bueno lo que sólo se menciona.
const sinCom = (src) => src.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');

(async () => {

// ═══════════ PARTE 1 · el módulo y su aislamiento ═══════════
console.log('── PARTE 1 · el módulo, y de qué NO puede depender ──');
{
    ok('1a · reports-export.js existe y compila', (() => {
        try { new vm.Script(SRC_EXPORT); return true; } catch (e) { return false; }
    })());

    const codigo = sinCom(SRC_EXPORT);
    // 🔑 test_report_engine_module.js (1e) mantiene la lista CERRADA de
    // consumidores de _RP. Si este módulo lo nombrase, ese guard se pondría
    // rojo por un cambio hecho en otro archivo.
    ok('1b · 🔑 NO nombra _RP: el informe visual se le pasa ya construido',
        !/\b_RP\b/.test(codigo));
    // 🔑 test_reports_tab_module.js (1d) exige fan-in EXTERNO = 0 sobre estos
    // cuatro nombres. El módulo recibe los datos por argumento.
    const prohibidos = ['_sdMatchData', 'sdToggleReport', 'sdDeleteReport', '_sdLoadReports']
        .filter(n => new RegExp('\\b' + n + '\\b').test(codigo));
    ok('1c · 🔑 NO nombra los globales del panel (fan-in externo = 0)',
        prohibidos.length === 0, prohibidos);

    ok('1d · todo lo público cuelga de window.rx*, sin globales sueltos',
        /^\(function \(\) \{/m.test(SRC_EXPORT) &&
        cuenta(codigo, /window\.rx[A-Z]/g) >= 8 &&
        !/^\s*(var|let|const)\s+rx/m.test(codigo));

    const idx = leer('index.html');
    ok('1e · registrado en index.html, en el precache del SW y en _check_syntax',
        /js\/coach\/reports\/reports-export\.js/.test(idx) &&
        /\.\/js\/coach\/reports\/reports-export\.js/.test(leer('sw.js')) &&
        /js\/coach\/reports\/reports-export\.js/.test(leer('scripts/_check_syntax.js')));
}

// ═══════════ PARTE 2 · CSV que Excel abre a la primera ═══════════
console.log('\n── PARTE 2 · 🔑 el CSV, tal y como Excel lo necesita ──');
{
    const t = exportSandbox();
    const csv = t.w.rxCsv([['a', 'b'], ['c "x"', 'd;e']]);

    ok('2a · 🔑 el separador es punto y coma (Excel en español)',
        csv.split('\r\n')[0] === '"a";"b"', csv.split('\r\n')[0]);
    ok('2b · toda celda va entrecomillada y las comillas internas se duplican',
        csv.indexOf('"c ""x"""') !== -1, csv);
    ok('2c · 🔑 un ";" dentro del dato no parte la fila',
        csv.split('\r\n')[1] === '"c ""x""";"d;e"', csv.split('\r\n')[1]);
    ok('2d · las filas se separan con CRLF', csv.indexOf('\r\n') !== -1 && !/[^\r]\n/.test(csv));

    // ⚠️⚠️ SOBRE LOS BYTES, NO SOBRE LA CADENA. La versión anterior de esta
    // aserción leía `contenido.charCodeAt(0)` de un Blob simulado que sólo
    // concatenaba cadenas: daba VERDE mientras el autor abría el archivo con
    // las tildes rotas. Una fixture que no puede fallar como falla producción
    // no es una aserción, es decoración.
    t.w.rxDescargarCSV('x.csv', 'Competición · ñ');
    const d = t.descargas[0];
    const b = await bytesDe(d);
    // 🔑 UTF-16LE: su BOM es OBLIGATORIO para leer el archivo, así que ningún
    // lector puede ignorarlo y caer a Windows-1252 (que es lo que hizo el
    // Excel del autor con el BOM de UTF-8, que sí es opcional).
    ok('2e · 🔑 el archivo empieza por el BOM de UTF-16LE (FF FE)',
        b[0] === 0xFF && b[1] === 0xFE, b.subarray(0, 4).toString('hex'));
    ok('2e-bis · 🔑 y los acentos se leen bien al decodificar UTF-16LE',
        b.toString('utf16le') === '﻿Competición · ñ',
        JSON.stringify(b.toString('utf16le')));
    ok('2e-ter · el Blob se declara con su codificación real',
        /utf-16le/.test(d.mime), d.mime);
    // 🔑 Un a.click() suelto NO descarga en Firefox.
    ok('2f · 🔑 el <a> se adjunta al DOM antes del click y se retira después',
        !!d && JSON.stringify(d.ordenDom) === JSON.stringify(['append', 'click']) &&
        t.dom.indexOf('remove') === 2, t.dom);
    // 🔑 La descarga que arranca el click es asíncrona: revocar la URL en la
    // misma vuelta del bucle puede dejarla a medias.
    ok('2f-bis · 🔑 la URL del blob NO se revoca en la misma vuelta del bucle',
        t.dom.indexOf('revoke') === -1, t.dom);
    // Windows rechaza \ / : * ? " < > | en un nombre de archivo: una descarga
    // con cualquiera de ellos falla sin decir por qué.
    ok('2g · el nombre de archivo se limpia de caracteres prohibidos',
        t.w.rxSlug('Alevín A / B: "C"') === 'Alevín_A_B_C' &&
        !/[\\/:*?"<>|]/.test(t.w.rxSlug('a/b:c*d?e"f<g>h|i')), t.w.rxSlug('Alevín A / B: "C"'));
}

// ═══════════ PARTE 3 · el resumen acumulado, fiel a la pantalla ═══════════
console.log('\n── PARTE 3 · 🔑 el papel dice lo mismo que el panel ──');
{
    const t = exportSandbox();
    const uno = [{ equipo: 'Alevín A', partidos: 3,
        filas: [F({ number: '7', alias: 'Martín', called: 3, pj: 3, minutes: 180, goals: 4, yellow: 1 }),
                F({ number: '10', alias: 'Lucas', called: 3, pj: 2, minutes: 90, goals: 1, injuries: 1 })] }];
    const fUno = t.w.rxFilasResumen(uno);

    ok('3a · un solo equipo: cabecera sin columna "Equipo"',
        fUno[0][0] === 'Dorsal' && fUno[0].indexOf('Equipo') === -1, fUno[0]);
    ok('3a-bis · y las diez columnas acumuladas (PT entre PJ y Min)',
        JSON.stringify(fUno[0]) === JSON.stringify(
            ['Dorsal', 'Jugador', 'Conv.', 'PJ', 'PT', 'Min', 'Goles', 'Amarillas', 'Rojas', 'Lesiones']), fUno[0]);

    const total = fUno[fUno.length - 1];
    // 🔑 Sumar los PJ de cada jugador daría 5 en un equipo que jugó 3: es la
    // suma de PARTICIPACIONES y bajo la columna "PJ" sólo confunde.
    ok('3b · 🔑 el TOTAL de PJ son los partidos del EQUIPO (3), no 5',
        total[3] === 3, total);
    // 🔑 11 jugadores x 90' = 990' por partido: sumarlos no significa nada.
    // 🔑 PT tampoco se suma en el total: la suma de titularidades de la
    // plantilla es el numero de alineaciones, no una magnitud del equipo.
    ok('3c-bis · 🔑 el TOTAL de PT va con guion, no sumado',
        total[4] === '-', total);
    ok('3c · 🔑 el TOTAL de minutos va con guion, no sumado',
        total[5] === '-', total);
    ok('3d · goles, tarjetas y lesiones sí se suman (5 goles, 1 amarilla, 1 lesión)',
        total[6] === 5 && total[7] === 1 && total[9] === 1, total);
    ok('3e · y las convocatorias también', total[2] === 6, total);

    const varios = [uno[0], { equipo: 'Cadete B', partidos: 1, filas: [F({ number: '9', alias: 'Sergio', goals: 7 })] }];
    const fVar = t.w.rxFilasResumen(varios);
    ok('3f · varios equipos: se antepone la columna "Equipo"',
        fVar[0][0] === 'Equipo' && fVar[0][1] === 'Dorsal', fVar[0]);
    ok('3g · 🔑 cada fila lleva SU equipo, sin mezclarse',
        fVar.filter(r => r[0] === 'Alevín A').length === 3 &&
        fVar.filter(r => r[0] === 'Cadete B').length === 2,
        fVar.map(r => r[0]));
    ok('3h · un bloque sin partidos conocidos deja PJ del total con guion',
        t.w.rxFilasResumen([{ equipo: 'X', filas: [F()] }])[2][3] === '-',
        t.w.rxFilasResumen([{ equipo: 'X', filas: [F()] }])[2]);
}

// ═══════════ PARTE 4 · la tabla de papel ═══════════
console.log('\n── PARTE 4 · la tabla del PDF ──');
{
    const t = exportSandbox();
    const html = t.w.rxTablaResumenHtml({ equipo: 'Alevín A', partidos: 2,
        filas: [F({ number: '7', alias: 'Martín', minutes: 180, goals: 2 }),
                F({ number: '', alias: '<img src=x>', goals: 0 })] });

    // ⚠️ Acotado al <tbody>: la fila "Total equipo" del <tfoot> abre igual, así
    // que contarlas en todo el HTML daba 3 y la aserción fallaba por la razón
    // equivocada, con la tabla ya correcta. (Mismo tropiezo que en
    // test_reports_tab_tree.js, aserción 7e.)
    const cuerpo = (html.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '';
    ok('4a · una fila por jugador en el cuerpo', cuenta(cuerpo, /<tr><td class="rx-l">/g) === 2, cuerpo.slice(0, 160));
    ok('4b · con dorsal y alias', /rx-dorsal">7<\/span> Martín/.test(html));
    ok('4c · 🔑 escapa el HTML del alias', !/<img src=x>/.test(html) && /&lt;img/.test(html));
    ok('4d · fila de total con los partidos del equipo',
        /Total equipo/.test(html) && /<td>2<\/td><td>-<\/td>/.test(html), html.slice(-400));

    const vacia = t.w.rxTablaResumenHtml({ equipo: 'Cadete C', filas: [] });
    ok('4e · un equipo sin filas da un mensaje, no una tabla vacía',
        /no hay acumulado de temporada/.test(vacia) && !/<table/.test(vacia));
}

// ═══════════ PARTE 5 · el documento imprimible ═══════════
console.log('\n── PARTE 5 · 🔑 el PDF, y las dos trampas que lo dejan en blanco ──');
{
    const t = exportSandbox();
    const okPdf = t.w.rxExportarResumenPDF(
        [{ equipo: 'Alevín A', partidos: 1, filas: [F()] }], { club: 'CD Test' });
    const doc = t.ventanas[0] ? t.ventanas[0].html : '';

    ok('5a · abre la ventana y escribe el documento', okPdf === true && doc.length > 500);
    // 🔑 Sin esto el navegador descarta los fondos al imprimir: la tarjeta
    // oscura del informe sale blanca con su texto blanco dentro.
    ok('5b · 🔑 print-color-adjust: exact (si no, el PDF sale en blanco)',
        /print-color-adjust:exact/.test(doc) && /-webkit-print-color-adjust:exact/.test(doc));
    // 🔑 El motor de informes usa var(--text-muted) y esta ventana no carga
    // style.css.
    ok('5c · 🔑 redefine las variables de :root que el motor da por hechas',
        /--text-muted:/.test(doc) && /--primary:/.test(doc));
    ok('5d · el resumen se imprime en vertical', /size: A4 portrait/.test(doc));
    ok('5e · lanza window.print() solo y deja un botón de respaldo',
        /window\.print\(\)/.test(doc) && /Guardar como PDF/.test(doc));
    ok('5f · el título del documento aparece en <title> y en la cabecera',
        /<title>Resumen acumulado de la temporada<\/title>/.test(doc));

    const t2 = exportSandbox();
    t2.w.rxExportarInformePDF({ rival: 'Rival A', matchDate: '2026-03-02', scoreHome: 2, scoreAway: 1 },
        '<b>GANTT</b>', { club: 'CD Test' });
    const doc2 = t2.ventanas[0] ? t2.ventanas[0].html : '';
    // 🔑 El HTML del motor trae los colores en línea y para fondo oscuro:
    // volcarlo en una hoja blanca lo deja ilegible.
    ok('5g · 🔑 el informe grupal viaja dentro del lienzo oscuro',
        /<div class="rx-lienzo"><b>GANTT<\/b><\/div>/.test(doc2), doc2.slice(-400));
    // 🔑 El Gantt es una línea temporal por jugador: en vertical se parte.
    ok('5h · 🔑 y en apaisado', /size: A4 landscape/.test(doc2));
    ok('5i · con el resultado en el subtítulo, según myTeamRole',
        /2 - 1 \(VICTORIA\)/.test(doc2), (doc2.match(/rx-sub">[^<]*/) || [''])[0]);

    const bloq = exportSandbox({ popupBloqueado: true });
    ok('5j · 🔑 ventana emergente bloqueada: devuelve false y AVISA',
        bloq.w.rxExportarResumenPDF([{ equipo: 'X', partidos: 1, filas: [F()] }], {}) === false &&
        bloq.toasts.some(m => /emergentes/.test(m)), bloq.toasts);

    const sinDatos = exportSandbox();
    ok('5k · sin bloques no abre ninguna ventana',
        sinDatos.w.rxExportarResumenPDF([], {}) === false && sinDatos.ventanas.length === 0);
    ok('5l · y el CSV vacío tampoco descarga nada',
        sinDatos.w.rxExportarResumenCSV([], {}) === false && sinDatos.descargas.length === 0);
}

// ═══════════ PARTE 6 · el informe grupal en CSV ═══════════
console.log('\n── PARTE 6 · el informe grupal, partido a partido ──');
{
    const t = exportSandbox();
    const m = {
        rival: 'Rival A', matchDate: '2026-03-02', matchTime: '11:30',
        competition: 'Liga', category: 'alevin', subcategory: 'A', venue: 'Municipal',
        myTeamRole: 'home', scoreHome: 2, scoreAway: 1, coachEmail: 'ana@x.com',
        players: [
            { playerNumber: '10', playerAlias: 'Lucas', minutesPlayed: '60:00', goals: 1,
              cards: 'amarilla', injured: false, history: ["12' GOL", "30' AMARILLA"] },
            { playerNumber: '7', playerAlias: 'Martín', minutesPlayed: '90:00', goals: 1,
              cards: 'ninguna', injured: true, history: [] },
        ],
    };
    const filas = t.w.rxFilasInforme(m);
    const iCab = filas.findIndex(f => f[0] === 'Dorsal');

    ok('6a · ficha del partido arriba, línea en blanco y luego la tabla',
        filas[0][0] === 'INFORME GRUPAL DE PARTIDO' && iCab > 5 && filas[iCab - 1].length === 0, iCab);
    ok('6b · la ficha lleva rival, resultado y localía',
        JSON.stringify(filas).indexOf('Rival A') !== -1 &&
        filas.some(f => f[0] === 'Resultado' && f[1] === '2 - 1 (VICTORIA)') &&
        filas.some(f => f[0] === 'Localía' && f[1] === 'Local'),
        filas.filter(f => f[0] === 'Resultado'));
    ok('6c · una fila por jugador, ordenada por dorsal (7 antes que 10)',
        filas.length === iCab + 3 && filas[iCab + 1][0] === '7' && filas[iCab + 2][0] === '10',
        filas.slice(iCab + 1).map(f => f[0]));
    // 🔑 El historial son varias líneas: en columnas dejaría una hoja con un
    // ancho distinto por jugador.
    ok('6d · 🔑 el historial va en UNA sola celda',
        filas[iCab + 2][6] === "12' GOL | 30' AMARILLA", filas[iCab + 2]);
    ok('6e · la lesión se escribe en claro', filas[iCab + 1][5] === 'sí', filas[iCab + 1]);

    // 🔑 Misma semántica que la tarjeta de pantalla: como visitante los goles
    // propios son scoreAway. Si divergiera, el archivo contradiría al panel.
    const visita = t.w.rxFilasInforme(Object.assign({}, m, { myTeamRole: 'away' }));
    ok('6f · 🔑 de visitante el mismo 2-1 es DERROTA',
        visita.some(f => f[0] === 'Resultado' && f[1] === '2 - 1 (DERROTA)') &&
        visita.some(f => f[0] === 'Localía' && f[1] === 'Visitante'),
        visita.filter(f => f[0] === 'Resultado' || f[0] === 'Localía'));
    // Los informes antiguos no llevan myTeamRole: la tarjeta cae a 'home'.
    const viejo = t.w.rxFilasInforme(Object.assign({}, m, { myTeamRole: undefined }));
    ok('6g · sin myTeamRole se cae a "home", igual que la tarjeta',
        viejo.some(f => f[0] === 'Resultado' && f[1] === '2 - 1 (VICTORIA)'));

    // ── Las incidencias, en español y sin mentir ──────────────────────
    const E = (t2, over) => Object.assign({ type: t2, timeStr: '12:00', minute: 12, second: 0 }, over || {});

    ok('6h · 🔑 nada de sub_out/goal/yellow: se traduce al español',
        t.w.rxEtiquetaSuceso(E('sub_out')) === 'Sale del campo' &&
        t.w.rxEtiquetaSuceso(E('sub_in'))  === 'Entra al campo' &&
        t.w.rxEtiquetaSuceso(E('goal'))    === 'Gol' &&
        t.w.rxEtiquetaSuceso(E('yellow'))  === 'Tarjeta amarilla' &&
        t.w.rxEtiquetaSuceso(E('red'))     === 'Tarjeta roja' &&
        t.w.rxEtiquetaSuceso(E('injury'))  === 'Lesión',
        ['sub_out', 'sub_in', 'goal', 'yellow', 'red', 'injury'].map(x => t.w.rxEtiquetaSuceso(E(x))));
    // 🔑 El vocabulario del CSV NO puede ser el de la pantalla: allí amarilla y
    // roja se distinguen por COLOR y aquí no hay color.
    ok('6i · 🔑 amarilla y roja se distinguen con palabras, no con color',
        t.w.rxEtiquetaSuceso(E('yellow')) !== t.w.rxEtiquetaSuceso(E('red')));

    // 🔑 v458: el parser tipa por TEXTO, así que un gol anulado llega como
    // 'goal'. Traducirlo a "Gol" escribiría en un documento que se imprime y se
    // reparte que hubo un gol que el árbitro anuló.
    ok('6j · 🔑 un GOL ANULADO no se escribe como "Gol"',
        t.w.rxEtiquetaSuceso(E('goal', { note: 'GOL ANULADO (Quedan: 1)' })) === 'Gol anulado');
    ok('6k · 🔑 una segunda amarilla es una EXPULSIÓN, no una amonestación',
        /expulsi/i.test(t.w.rxEtiquetaSuceso(E('yellow', { note: 'DOBLE AMARILLA → EXPULSADO' }))),
        t.w.rxEtiquetaSuceso(E('yellow', { note: 'DOBLE AMARILLA → EXPULSADO' })));
    ok('6l · 🔑 y una roja revertida tampoco es una expulsión',
        t.w.rxEtiquetaSuceso(E('red', { note: 'ROJA REVERTIDA' })) === 'Roja revertida');

    // 🔑 LA CONTABILIDAD DE FASE NO ES UNA SUSTITUCIÓN. La app apunta sola un
    // "Sale (DESCANSO)" a todos los del campo y un "Entra (2ªP)" a los que
    // salen a la segunda: en un F7 con 14 convocados son 14 cambios falsos.
    const conFase = {
        history: [
            E('sub_out', { timeStr: '25:00', minute: 25, note: 'Sale a las 25:00 (DESCANSO)' }),
            E('sub_in',  { timeStr: '25:00', minute: 25, note: 'Entra a las 25:00 (2ªP)' }),
            E('goal',    { timeStr: '30:00', minute: 30, note: 'Gol a las 30:00 (2ªP)' }),
            E('sub_out', { timeStr: '50:00', minute: 50, note: 'Sale a las 50:00 (FIN)' }),
        ],
    };
    ok('6m · 🔑 el paso por el DESCANSO y el FIN no salen como cambios',
        t.w.rxIncidencias(conFase) === '30:00 Gol', t.w.rxIncidencias(conFase));

    // 🔑 "(2ªP)" es AMBIGUA: la escribe el apunte automático Y un cambio real
    // de la segunda parte. Sin el "Sale (DESCANSO)" con su MISMO sello de
    // tiempo, el jugador estaba en el banquillo y su entrada es de verdad.
    const cambioReal2P = {
        history: [
            E('sub_in', { timeStr: '35:00', minute: 35, note: 'Entra a las 35:00 (2ªP)' }),
        ],
    };
    ok('6n · 🔑 pero un cambio REAL de la segunda parte NO se descarta',
        t.w.rxIncidencias(cambioReal2P) === '35:00 Entra al campo',
        t.w.rxIncidencias(cambioReal2P));

    ok('6o · varias incidencias van en una sola celda, separadas por " | "',
        t.w.rxIncidencias({ history: [E('goal', { timeStr: '10:00' }),
                                      E('yellow', { timeStr: '20:00' })] }) ===
        '10:00 Gol | 20:00 Tarjeta amarilla');
    // Historial antiguo: cadenas de logEvent, ya en español.
    ok('6p · el historial antiguo en crudo se conserva legible',
        t.w.rxIncidencias({ history: ['Gol a las 10:00 (1ªP)', 'Sale a las 25:00 (DESCANSO)'] }) ===
        'Gol a las 10:00 (1ªP)', t.w.rxIncidencias({ history: ['Gol a las 10:00 (1ªP)', 'Sale a las 25:00 (DESCANSO)'] }));

    // 🔑 EL CRITERIO ESTÁ DUPLICADO A PROPÓSITO (este módulo no puede nombrar
    // _RP), así que hay que vigilar que las dos copias no se separen: si
    // alguien cambia los marcadores en el motor y no aquí, esto se pone rojo.
    {
        // Se comparan los marcadores como TEXTO LITERAL, no con una regex de
        // una regex: aquello era ilegible y fallaba por su propio escapado.
        const motor = leer('js/coach/reports/report-engine.js');
        const marcas = [
            '\\((?:DESCANSO|FIN)\\)',   // qué apuntes son contabilidad de fase
            '2[ªº]\\s*P',               // la etiqueta AMBIGUA que se resuelve por pareja
            'ANULAD',                   // gol anulado
            'REVERTID|RECTIFIC',        // roja revertida
            'DOBLE\\s+AMARILLA',        // segunda amarilla = expulsión
        ];
        const faltan = marcas.filter(s => motor.indexOf(s) === -1 || SRC_EXPORT.indexOf(s) === -1);
        ok('6q · 🔑 el criterio de fase y los tres matices siguen siendo los MISMOS que en report-engine.js',
            faltan.length === 0, faltan);
    }

    t.w.rxExportarInformeCSV(m);
    ok('6r · el archivo se llama por el rival y la fecha',
        t.descargas[0] && t.descargas[0].nombre === 'informe_grupal_Rival_A_2026-03-02.csv',
        t.descargas[0] && t.descargas[0].nombre);
    ok('6s · un informe sin jugadores no descarga nada',
        t.w.rxExportarInformeCSV({ rival: 'X', players: [] }) === false && t.descargas.length === 1);
}

// ═══════════ PARTE 7 · los botones dentro de la pestaña ═══════════
console.log('\n── PARTE 7 · 🔑 de dónde salen los datos al pulsar ──');
{
    const t = tabSandbox({ users: USERS, reports: {
        al_p7:  R({ playerNumber: '7',  playerAlias: 'Martín', goals: 2, minutesPlayed: '90:00' }),
        al_p10: R({ playerNumber: '10', playerAlias: 'Lucas',  goals: 1, minutesPlayed: '60:00' }),
        ca_p9:  R({ category: 'cadete', subcategory: 'B', coachUid: 'c_bea', rival: 'Otro',
                    matchDate: '2026-03-09', createdAt: '2026-03-09T10:00:00Z',
                    playerNumber: '9', playerAlias: 'Sergio', goals: 7 }),
    } });
    await t.g._sdLoadReports();
    const h = t.container.innerHTML;

    ok('7a · el árbol pinta una barra de descarga por equipo y la global',
        cuenta(h, /sdExportResumen\('alevin\|A','pdf'\)/g) === 1 &&
        cuenta(h, /sdExportResumen\('cadete\|B','csv'\)/g) === 1 &&
        cuenta(h, /sdExportResumen\('\*','pdf'\)/g) === 1, h.slice(0, 200));
    ok('7b · y dos botones de descarga por tarjeta de informe',
        cuenta(h, /sdExportInforme\('[^']+','pdf'\)/g) === 2 &&
        cuenta(h, /sdExportInforme\('[^']+','csv'\)/g) === 2);
    ok('7c · publica los dos manejadores',
        typeof t.w.sdExportResumen === 'function' && typeof t.w.sdExportInforme === 'function');
    // 🔑 La tarjeta ENTERA lleva onclick="sdToggleReport(...)": un botón que no
    // detenga la propagación desplegaría el informe además de descargarlo.
    // Se comparan los DOS recuentos, no un número fijo: así la aserción sigue
    // valiendo cuando cambie el número de tarjetas del caso de prueba.
    ok('7d · 🔑 TODOS los botones de descarga detienen la propagación del click',
        cuenta(h, /sdExportInforme\(/g) === 4 &&
        cuenta(h, /event\.stopPropagation\(\); sdExportInforme\(/g) === cuenta(h, /sdExportInforme\(/g),
        { total: cuenta(h, /sdExportInforme\(/g),
          conStop: cuenta(h, /event\.stopPropagation\(\); sdExportInforme\(/g) });

    // 🔑 El resumen de un equipo sólo puede llevar a SUS jugadores.
    t.w.sdExportResumen('alevin|A', 'csv');
    const soloAlevin = t.g.__resumen;
    ok('7e · 🔑 el resumen de un equipo lleva sólo a sus jugadores',
        soloAlevin.fmt === 'csv' && soloAlevin.b.length === 1 &&
        soloAlevin.b[0].equipo === 'Alevín A' &&
        soloAlevin.b[0].filas.map(f => f.alias).sort().join(',') === 'Lucas,Martín',
        soloAlevin.b.map(x => [x.equipo, x.filas.map(f => f.alias)]));
    ok('7f · con los partidos de ESA rama (1), que es la celda PJ del total',
        soloAlevin.b[0].partidos === 1, soloAlevin.b[0].partidos);

    t.w.sdExportResumen('*', 'pdf');
    const todos = t.g.__resumen;
    ok('7g · 🔑 "*" junta todos los equipos, uno por bloque',
        todos.fmt === 'pdf' && todos.b.length === 2 &&
        todos.b.map(x => x.equipo).sort().join(' / ') === 'Alevín A / Cadete B',
        todos.b.map(x => x.equipo));
    ok('7h · y el ámbito y el club viajan en la meta',
        /Todos los equipos/.test(todos.meta.ambito) && todos.meta.club === 'CD Test', todos.meta);

    // 🔑 Descargar no obliga a haber desplegado antes la tarjeta: el informe
    // visual se construye en ese momento. Un censo de fuente no vería esto.
    const key64 = Object.keys(t.w._sdMatchData)[0];
    const antes = t.rpCalls.length;
    t.w.sdExportInforme(key64, 'pdf');
    ok('7i · 🔑 el PDF se genera aunque la tarjeta nunca se haya abierto',
        t.rpCalls.length === antes + 1 &&
        t.g.__informe.fmt === 'pdf' && /INFORME/.test(t.g.__informe.html),
        { antes, ahora: t.rpCalls.length });
    ok('7j · y el CSV no pasa por el motor de informes',
        (() => { const n = t.rpCalls.length; t.w.sdExportInforme(key64, 'csv');
                 return t.rpCalls.length === n && t.g.__informe.fmt === 'csv'; })());
    ok('7k · una clave desconocida no revienta ni llama al motor',
        (() => { const n = t.rpCalls.length; t.w.sdExportInforme('nada', 'pdf');
                 return t.rpCalls.length === n; })());
    ok('7l · un resumen de una rama inexistente tampoco',
        (() => { t.g.__resumen = null; t.w.sdExportResumen('juvenil|C', 'csv');
                 return t.g.__resumen === null; })());
}
{
    // 🔑 Sin el módulo de exportación cargado, ni un solo botón: uno que no
    // puede hacer nada es peor que no tenerlo.
    const t = tabSandbox({ users: USERS, withExport: false, reports: { al_p7: R() } });
    await t.g._sdLoadReports();
    const h = t.container.innerHTML;
    ok('7m · 🔑 sin el módulo de exportación NO se pinta ningún botón',
        !/sdExportInforme/.test(h) && !/sdExportResumen/.test(h) && /sd-report-card/.test(h));
}
{
    // La lista plana no tiene tabla resumen en pantalla, así que tampoco se
    // ofrece descargarla; los informes grupales sí se pueden bajar.
    const t = tabSandbox({ withModule: false, users: USERS, reports: { al_p7: R() } });
    await t.g._sdLoadReports();
    const h = t.container.innerHTML;
    ok('7n · en la lista plana no se ofrece el resumen (no existe en pantalla)',
        !/sdExportResumen/.test(h) && /sdExportInforme/.test(h));
    ok('7o · y sigue sin colarse marcado del árbol', !/ct-stats/.test(h) && !/ct-tree-cat/.test(h));
}
{
    // 🔑 Censo: la aserción 1c de test_reports_tab_module.js exige que
    // _RP.build aparezca UNA sola vez en reports-tab.js. Al añadir el PDF eran
    // dos los sitios que lo necesitaban, y por eso se extrajo _sdReportHtml.
    const codigo = sinCom(SRC_REPORTS);
    ok('7p · 🔑 _RP.build sigue llamándose en UN solo sitio de reports-tab.js',
        cuenta(codigo, /_RP\.build\(/g) === 1 && /_sdReportHtml/.test(codigo),
        cuenta(codigo, /_RP\.build\(/g));
    // 🔑 La tabla la sigue pintando el módulo compartido; los botones van
    // FUERA de ctRenderStatsTable, cuyo marcado fija test_category_tree.js.
    ok('7q · 🔑 los botones no se han metido dentro de ctRenderStatsTable',
        !/sdExportResumen/.test(SRC_TREE) && !/sd-exp-/.test(SRC_TREE));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.log('FAIL excepción no capturada: ' + e.stack); process.exit(1); });

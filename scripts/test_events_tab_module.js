// ─────────────────────────────────────────────────────────────────────────
// test_events_tab_module.js · Refactor de monolitos (auditoría 2026-07-22)
// MONOLITO #2 (js/coach/reports/club-reports.js), PASO 2 de 6: extracción de
// "TAB: Convocatorias / Entrenamientos" (_sdLoadEvents, con sus dos handlers
// anidados sdViewEventDetail / sdDeleteNotif) a
// js/coach/reports/events-tab.js.
//
// Escrito y ejecutado EN VERDE contra el código todavía SIN mover (Puerta 3).
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
//  · Toda la sección es UNA función. sdViewEventDetail y sdDeleteNotif se
//    asignan a window ANIDADOS dentro de ella, capturando por CIERRE las
//    locales `items`, `type` y `me`. Por eso el bloque es indivisible.
//  · _sdLoadEvents NO tiene línea de export explícita (a diferencia de
//    _renderDirectorConfig en el paso 1): depende de que una function
//    declaration de nivel superior pase a ser propiedad de window.
//  · FAN-IN = 3, todos en tiempo de llamada: switchStaffTab (que SE QUEDA)
//    con 'convocatoria' y 'planificacion_semanal'; una llamada RECURSIVA a sí
//    misma desde sdDeleteNotif para refrescar; y los dos onclick de su propio
//    HTML. Fan-in externo = 0 (parte 1d).
//  · FAN-OUT: _sdFS() ×6 (se queda en club-reports.js; ojo, la línea del
//    fallback de sdViewEventDetail lo invoca TRES veces en una sola
//    expresión), escapeHtml/escapeAttr
//    (app-init.js), showToast (aquí SÍ guardado con typeof), un import()
//    dinámico DIRECTO en el fallback de sdDeleteNotif, y DOM
//    (createElement/appendChild) para el overlay de detalle.
//
// ── ⚠️ LO QUE DE VERDAD HAY QUE PROTEGER: EL AUTO-PURGADO ──
// Con más de MAX_ITEMS (40) avisos, la sección BORRA de Firestore los más
// antiguos con deleteDoc — irreversible, fire-and-forget y con el error
// silenciado (.catch(()=>{})). Ocurre cada vez que un director abre la
// pestaña. La parte 3 fija el umbral exacto, el orden previo por createdAt
// descendente, y que se borre el excedente y SÓLO el excedente.
// Por contraste, sdDeleteNotif NO borra nada: hace arrayUnion(me.uid) sobre
// dismissedBy (descarte personal que no afecta a los demás roles) — el
// borrado lógico que pedía el hallazgo #6. La parte 6g lo fija.
//
// ── RAMA MUERTA PRESERVADA, NO CORREGIDA ──
// isConv = (type === 'convocatoria') e isPlan = (d.type ===
// 'planificacion_semanal'). Como las DOS consultas filtran por
// where('type','==',type), todo documento devuelto cumple d.type === type, así
// que desde la UI sólo se alcanzan dos combinaciones. La tercera rama (el
// "Entrenamiento" suelto con d.datetime) es INALCANZABLE en producción. Se
// mueve tal cual, como saActivateIndividual en su día; las partes 4i y 5h la
// ejercitan llamando directamente con otro type, documentando su
// comportamiento sin afirmar que se alcance.
//
// ── NOTA SOBRE EL SANDBOX (lección del paso 8 del monolito #1) ──
// En un vm, una function declaration de nivel superior queda en el objeto
// global del sandbox, NO en sandbox.window (que es sólo una propiedad más).
// Por eso _sdLoadEvents se invoca como g._sdLoadEvents(...) mientras los dos
// handlers, que sí se asignan a window explícitamente, se leen de w.*.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'reports', 'events-tab.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Convocatorias/Entrenamientos — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Extracción del bloque ═════════════════════════════
// OJO: es una sección INTERMEDIA. Sin extraer hay que acotar por los dos
// extremos; la siguiente sección es "MOTOR DE INFORMES VISUAL".
function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('async function _sdLoadEvents(type)');
    if (s === -1) throw new Error('No se encontró _sdLoadEvents en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    const e = src.indexOf('MOTOR DE INFORMES VISUAL', s);
    if (e === -1) throw new Error('No se encontró el final de la sección');
    const cut = src.slice(s, e);
    return cut.slice(0, cut.lastIndexOf('}') + 1);
}
const BLOCK = readBlock();

const FIRESTORE_IMPORT =
    /await import\(\s*'https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js'\s*\)/g;

// Réplicas EXACTAS de app-init.js:22 y :27 (la de escapeHtml también escapa "/").
const escHtml = (str) => {
    if (str === null || str === undefined) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
    return String(str).replace(/[&<>"'/]/g, c => map[c]);
};
const escAttr = (str) => {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

function buildSandbox({
    notifs = {},                  // {id: data}
    me = { uid: 'u1', clubId: 'club1' },
    noUser = false,               // simula window._cronosCurrentUser ausente
    failQuery = null,             // 'clubId' | 'parentUid' | 'both'
    deleteDocThrows = false,
    updateDocThrows = null,       // falla el primer intento (vía _sdFS)
    moduleUpdateThrows = null,    // falla también el fallback (vía import)
    getDocReturns = undefined,    // para el fallback de sdViewEventDetail
    confirmReturns = true,
} = {}) {
    const store = { cronos_notifications: Object.assign({}, notifs) };
    const deleted = [];
    const updated = [];
    const toasts = [];
    const appended = [];
    const container = { id: 'staff-dashboard-content', innerHTML: '' };
    const els = { 'staff-dashboard-content': container };

    const matches = (data, clauses) => (clauses || []).every(c => {
        if (!c || c.__where !== true) return true;
        return data[c.field] === c.value;
    });
    const clauseField = (ref, f) => (ref.__clauses || []).some(c => c && c.field === f);

    const mkFS = (isModule) => ({
        db: {},
        collection: (db, col) => ({ __col: col }),
        query: (ref, ...clauses) => ({ __col: ref.__col, __clauses: clauses }),
        where: (field, op, value) => ({ __where: true, field, op, value }),
        orderBy: (f) => ({ __orderBy: f }),
        limit: (n) => ({ __limit: n }),
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDocs: async (ref) => {
            if (failQuery === 'both'
                || (failQuery === 'clubId' && clauseField(ref, 'clubId'))
                || (failQuery === 'parentUid' && clauseField(ref, 'parentUid'))) {
                throw new Error('query falló');
            }
            const st = store[ref.__col] || {};
            const rows = Object.keys(st).filter(id => matches(st[id], ref.__clauses)).map(id => [id, st[id]]);
            return { forEach: (cb) => rows.forEach(r => cb({ id: r[0], data: () => r[1] })) };
        },
        getDoc: async (ref) => ({
            exists: () => getDocReturns !== undefined,
            data: () => getDocReturns,
        }),
        deleteDoc: async (ref) => {
            if (deleteDocThrows) throw new Error('deleteDoc falló');
            deleted.push(ref.__col + '/' + ref.__id);
            delete (store[ref.__col] || {})[ref.__id];
        },
        updateDoc: async (ref, data) => {
            const boom = isModule ? moduleUpdateThrows : updateDocThrows;
            if (boom) throw new Error(boom);
            updated.push({ via: isModule ? 'import' : 'sdFS', col: ref.__col, id: ref.__id, data });
        },
        arrayUnion: (...items) => ({ __arrayUnion: items }),
    });

    const fakeFS = mkFS(false);
    const fakeModule = mkFS(true);

    const sandbox = {
        window: { _cronosCurrentUser: noUser ? undefined : me },
        document: {
            getElementById: (id) => (els[id] !== undefined ? els[id] : null),
            createElement: () => ({ id: '', style: { cssText: '' }, innerHTML: '', remove() {} }),
            body: { appendChild: (el) => appended.push(el) },
        },
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        Promise, Set, Map, Array, Object, String, Number, Date, Math, JSON, Intl,
        _sdFS: async () => fakeFS,
        escapeHtml: escHtml,
        escapeAttr: escAttr,
        showToast: (m, ms) => toasts.push(String(m)),
        __fakeFirestoreModule: fakeModule,
    };
    vm.createContext(sandbox);
    vm.runInContext(BLOCK.replace(FIRESTORE_IMPORT, '__fakeFirestoreModule'), sandbox);

    return { g: sandbox, w: sandbox.window, store, deleted, updated, toasts, appended, container };
}

const idxOf = (s, sub) => s.indexOf(sub);
const iso = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
}

(async () => {
    // Las aserciones de texto-fuente miran BLOCK, NO el fichero completo
    // (lección del paso 1: sin extraer, club-reports.js tiene 2052 líneas y
    // otras secciones repiten los mismos patrones).

    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura y aislamiento ──');
    ok('1a · _sdLoadEvents es function declaration SIN export explícito',
        /^async function _sdLoadEvents\(type\)/m.test(BLOCK)
        && !/window\._sdLoadEvents\s*=/.test(BLOCK));
    ok('1b · los dos handlers se asignan a window ANIDADOS dentro de la función',
        /\n\s+window\.sdViewEventDetail\s*=\s*async \(id\) =>/.test(BLOCK)
        && /\n\s+window\.sdDeleteNotif\s*=\s*async \(id\) =>/.test(BLOCK));
    // 6 invocaciones, no 5: la línea del fallback de sdViewEventDetail llama
    // a _sdFS() TRES veces seguidas en una sola expresión.
    ok('1c · usa _sdFS() 6 veces y un import() dinámico directo',
        (BLOCK.match(/await _sdFS\(\)/g) || []).length === 6
        && (BLOCK.match(FIRESTORE_IMPORT) || []).length === 1,
        { sdFS: (BLOCK.match(/await _sdFS\(\)/g) || []).length,
          imports: (BLOCK.match(FIRESTORE_IMPORT) || []).length });
    ok('1d-pre · se llama a sí misma para refrescar tras descartar',
        (BLOCK.match(/await _sdLoadEvents\(type\)/g) || []).length === 2,
        (BLOCK.match(/await _sdLoadEvents\(type\)/g) || []).length);
    {
        const NAMES = ['_sdLoadEvents', 'sdViewEventDetail', 'sdDeleteNotif'];
        const skip = new Set([SOURCE, ORIGIN, path.join(ROOT, 'sw.js')].map(p => path.resolve(p)));
        const offenders = [];
        for (const f of walk(ROOT, [])) {
            const abs = path.resolve(f);
            if (skip.has(abs)) continue;
            if (path.relative(ROOT, f).replace(/\\/g, '/').startsWith('scripts/')) continue;
            const txt = fs.readFileSync(f, 'utf8');
            for (const n of NAMES) if (new RegExp('\\b' + n + '\\b').test(txt)) offenders.push(path.relative(ROOT, f) + ':' + n);
        }
        ok('1d · fan-in externo = 0', offenders.length === 0, offenders);
    }
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const origin = idxOf(idxHtml, 'js/coach/reports/club-reports.js');
        const target = idxOf(idxHtml, 'js/coach/reports/events-tab.js');
        ok('1e · events-tab.js se carga después de club-reports.js',
            target !== -1 && target > origin, { origin, target });
        ok('1f · events-tab.js está en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/reports/events-tab.js'));
        ok('1g · events-tab.js está en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/reports/events-tab.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · lectura: doble consulta, dedup y dismissedBy ──');
    ok('2a · consulta por clubId Y por parentUid, ambas filtradas por type',
        /where\('clubId','==',clubId\), where\('type','==',type\)/.test(BLOCK)
        && /where\('parentUid','==',me\.uid\), where\('type','==',type\)/.test(BLOCK));
    // Ancla al patrón de las DOS consultas. Hay un tercer .catch(()=>null) en
    // el fallback de sdViewEventDetail, que se cubre aparte (5j/5k).
    ok('2b · cada consulta tolera su propio fallo con .catch(()=>null)',
        (BLOCK.match(/where\('type','==',type\)\)\)\.catch\(\(\)=>null\)/g) || []).length === 2
        && (BLOCK.match(/\.catch\(\(\)=>null\)/g) || []).length === 3,
        (BLOCK.match(/\.catch\(\(\)=>null\)/g) || []).length);
    {
        const { g, container } = buildSandbox({
            notifs: {
                a: { clubId: 'club1', type: 'convocatoria', rival: 'PorClub', createdAt: iso(2) },
                b: { parentUid: 'u1', type: 'convocatoria', rival: 'PorParent', createdAt: iso(1) },
                c: { clubId: 'otro', type: 'convocatoria', rival: 'Ajeno', createdAt: iso(3) },
                d: { clubId: 'club1', type: 'planificacion_semanal', rival: 'OtroTipo', createdAt: iso(4) },
            },
        });
        await g._sdLoadEvents('convocatoria');
        const html = container.innerHTML;
        ok('2c · une resultados de ambas consultas', html.includes('PorClub') && html.includes('PorParent'));
        ok('2d · excluye otros clubes y otros tipos',
            !html.includes('Ajeno') && !html.includes('OtroTipo'));
    }
    {
        // el MISMO documento cumple las dos consultas: debe aparecer una sola vez
        const { g, container } = buildSandbox({
            notifs: { dup: { clubId: 'club1', parentUid: 'u1', type: 'convocatoria', rival: 'Unico', createdAt: iso(1) } },
        });
        await g._sdLoadEvents('convocatoria');
        ok('2e · deduplica por id de documento (Set)',
            (container.innerHTML.match(/Unico/g) || []).length === 1
            && container.innerHTML.includes('1 registros'),
            (container.innerHTML.match(/Unico/g) || []).length);
    }
    {
        const { g, container } = buildSandbox({
            notifs: {
                x: { clubId: 'club1', type: 'convocatoria', rival: 'Descartado', createdAt: iso(2), dismissedBy: ['otro', 'u1'] },
                y: { clubId: 'club1', type: 'convocatoria', rival: 'Visible', createdAt: iso(1), dismissedBy: ['otro'] },
            },
        });
        await g._sdLoadEvents('convocatoria');
        ok('2f · omite los que llevan me.uid en dismissedBy (descarte personal)',
            !container.innerHTML.includes('Descartado') && container.innerHTML.includes('Visible'));
    }
    {
        const { g, container } = buildSandbox({
            notifs: {
                v: { clubId: 'club1', type: 'convocatoria', rival: 'Viejo', createdAt: iso(1) },
                n: { clubId: 'club1', type: 'convocatoria', rival: 'Nuevo', createdAt: iso(9) },
                m: { clubId: 'club1', type: 'convocatoria', rival: 'Medio', createdAt: iso(5) },
            },
        });
        await g._sdLoadEvents('convocatoria');
        const h = container.innerHTML;
        ok('2g · ordena por createdAt DESCENDENTE',
            idxOf(h, 'Nuevo') < idxOf(h, 'Medio') && idxOf(h, 'Medio') < idxOf(h, 'Viejo'),
            { nuevo: idxOf(h, 'Nuevo'), medio: idxOf(h, 'Medio'), viejo: idxOf(h, 'Viejo') });
    }
    {
        const { g, container } = buildSandbox({ failQuery: 'clubId',
            notifs: { b: { parentUid: 'u1', type: 'convocatoria', rival: 'Sobrevive', createdAt: iso(1) } } });
        await g._sdLoadEvents('convocatoria');
        ok('2h · si falla UNA consulta, la otra sigue sirviendo resultados',
            container.innerHTML.includes('Sobrevive'));
    }
    {
        const { g, container } = buildSandbox({ failQuery: 'both', notifs: {} });
        await g._sdLoadEvents('convocatoria');
        ok('2i · si fallan AMBAS, muestra el vacío (no el error)',
            container.innerHTML.includes('Sin convocatorias recibidos aún.'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · ⚠️ AUTO-PURGADO DESTRUCTIVO (MAX_ITEMS = 40) ──');
    ok('3a · el umbral sigue siendo 40', /const MAX_ITEMS = 40;/.test(BLOCK));
    const manyNotifs = (n) => {
        const o = {};
        for (let i = 0; i < n; i++) o['n' + String(i).padStart(2, '0')] = {
            clubId: 'club1', type: 'convocatoria', rival: 'R' + String(i).padStart(2, '0'), createdAt: iso(i),
        };
        return o;
    };
    {
        const { g, deleted, container } = buildSandbox({ notifs: manyNotifs(40) });
        await g._sdLoadEvents('convocatoria');
        ok('3b · con exactamente 40 NO borra nada', deleted.length === 0, deleted);
        ok('3c · y los muestra todos', container.innerHTML.includes('40 registros'));
    }
    {
        const { g, deleted, container } = buildSandbox({ notifs: manyNotifs(45) });
        await g._sdLoadEvents('convocatoria');
        ok('3d · con 45 borra exactamente 5', deleted.length === 5, deleted);
        // Tras ordenar desc, los 5 últimos son los de createdAt más antiguo: n00..n04
        ok('3e · borra los 5 MÁS ANTIGUOS, no otros',
            deleted.slice().sort().join(',') === ['n00', 'n01', 'n02', 'n03', 'n04']
                .map(x => 'cronos_notifications/' + x).join(','),
            deleted.slice().sort());
        ok('3f · borra de la colección cronos_notifications',
            deleted.every(d => d.startsWith('cronos_notifications/')));
        ok('3g · renderiza los 40 que quedan', container.innerHTML.includes('40 registros'));
        ok('3h · el más reciente (n44) sobrevive y el más antiguo (n00) no se muestra',
            container.innerHTML.includes('R44') && !container.innerHTML.includes('R00'));
    }
    {
        const { g, container } = buildSandbox({ notifs: manyNotifs(45), deleteDocThrows: true });
        await g._sdLoadEvents('convocatoria');
        ok('3i · si el borrado falla, el error se silencia y el render continúa',
            container.innerHTML.includes('40 registros'), container.innerHTML.slice(0, 120));
    }
    ok('3j · el borrado es fire-and-forget con el error silenciado',
        /deleteDoc\(firestoreDoc\(db,'cronos_notifications',it\._id\)\)\.catch\(\(\)=>\{\}\)/.test(BLOCK));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · render de tarjetas ──');
    {
        const { g, container } = buildSandbox({
            notifs: {
                c1: { clubId: 'club1', type: 'convocatoria', rival: 'CD <Rival>', venue: 'Campo "A"',
                      players: ['Ana', 'Luis'], coachEmail: 'e@x.com', createdAt: iso(1) },
            },
        });
        await g._sdLoadEvents('convocatoria');
        const h = container.innerHTML;
        ok('4a · cabecera con nº de registros y el máximo',
            h.includes('1 registros') && h.includes('máx. 40'));
        ok('4b · etiqueta CONVOCATORIA con su icono', h.includes('📋 CONVOCATORIA'));
        ok('4c · título "vs rival" escapado con escapeHtml',
            h.includes('vs ' + escHtml('CD <Rival>')) && !h.includes('vs CD <Rival>'));
        ok('4d · venue en la subLínea, escapado', h.includes(escHtml('Campo "A"')));
        ok('4e · cuenta de convocados', h.includes('👥 2 convocados'));
        ok('4f · autor del envío', h.includes('Enviado por ' + escHtml('e@x.com')));
        ok('4g · los dos botones usan escapeAttr sobre el id',
            h.includes(`sdDeleteNotif('c1')`) && h.includes(`sdViewEventDetail('c1')`));
    }
    {
        // escapeAttr de verdad sobre un id con comilla
        const { g, container } = buildSandbox({
            notifs: { "a'b": { clubId: 'club1', type: 'convocatoria', rival: 'X', createdAt: iso(1) } },
        });
        await g._sdLoadEvents('convocatoria');
        ok('4h · un id con comilla se neutraliza en el onclick',
            container.innerHTML.includes(`sdDeleteNotif('a&#039;b')`),
            container.innerHTML.slice(idxOf(container.innerHTML, 'sdDeleteNotif'), idxOf(container.innerHTML, 'sdDeleteNotif') + 40));
    }
    {
        const { g, container } = buildSandbox({
            notifs: {
                p1: { clubId: 'club1', type: 'planificacion_semanal', weekStartDate: '2026-03-02',
                      days: [{ day: 'Lunes', time: '18:00', venue: 'Anexo' }, { day: 'Martes' }, { day: 'Jueves', time: '19:00' }],
                      createdAt: iso(1) },
            },
        });
        await g._sdLoadEvents('planificacion_semanal');
        const h = container.innerHTML;
        ok('4i · planificación: etiqueta ENTRENAMIENTO y título "Semana del …"',
            h.includes('📅 ENTRENAMIENTO') && h.includes('Semana del'));
        ok('4j · subLínea con los días que tienen datos, máx. 2, unidos por " | "',
            h.includes('Lunes: 18:00 Anexo') && h.includes('Jueves: 19:00')
            && h.includes('Lunes: 18:00 Anexo | Jueves: 19:00'), h.slice(idxOf(h, 'Lunes') - 20, idxOf(h, 'Lunes') + 90));
    }
    {
        // ⚠️ RAMA MUERTA: inalcanzable desde la UI (las consultas filtran por type)
        const { g, container } = buildSandbox({
            notifs: { t1: { clubId: 'club1', type: 'entrenamiento', datetime: '2026-03-02T18:00:00.000Z',
                            location: 'Pabellón', createdAt: iso(1) } },
        });
        await g._sdLoadEvents('entrenamiento');
        const h = container.innerHTML;
        ok('4k · ⚠️ rama muerta: type suelto usa d.datetime y d.location',
            h.includes('📅 ENTRENAMIENTO') && h.includes('Pabellón') && !h.includes('Semana del'));
    }
    {
        const { g, w, container } = buildSandbox({ notifs: {} });
        await g._sdLoadEvents('planificacion_semanal');
        ok('4l · sin resultados muestra el vacío con la etiqueta correcta',
            container.innerHTML.includes('Sin avisos de entrenamiento recibidos aún.'));
        ok('4m · y NO asigna los handlers (return antes de definirlos)',
            w.sdViewEventDetail === undefined && w.sdDeleteNotif === undefined);
    }
    {
        // me undefined => throw dentro del try => rama de error
        const { g, container } = buildSandbox({ noUser: true });
        await g._sdLoadEvents('convocatoria');
        ok('4n · un error inesperado se pinta escapado y no propaga',
            container.innerHTML.includes('⚠️') && container.innerHTML.includes('padding:2rem;color:#ff5858'),
            container.innerHTML.slice(0, 140));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · sdViewEventDetail (overlay de detalle) ──');
    {
        const { g, w, appended } = buildSandbox({
            notifs: {
                c1: { clubId: 'club1', type: 'convocatoria', matchDate: '02/03/2026', rival: 'CD Rival',
                      venue: 'Campo A', meettime: '17:00', kickoff: '18:00',
                      players: ['Ana', 'Luis'], extra: 'Traer agua', createdAt: iso(1) },
            },
        });
        await g._sdLoadEvents('convocatoria');
        await w.sdViewEventDetail('c1');
        ok('5a · crea un overlay con id sd-detail-overlay y lo cuelga del body',
            appended.length === 1 && appended[0].id === 'sd-detail-overlay', appended.length);
        const h = appended[0].innerHTML;
        ok('5b · cabecera CONVOCATORIA', h.includes('CONVOCATORIA') && h.includes('CRONOS FÚTBOL'));
        ok('5c · muestra fecha, rival, campo, presentación y hora de inicio',
            h.includes('02&#x2F;03&#x2F;2026') && h.includes('CD Rival')
            && h.includes('Campo A') && h.includes('17:00') && h.includes('18:00'));
        ok('5d · lista los convocados numerados', h.includes('1. Ana') && h.includes('2. Luis')
            && h.includes('CONVOCADOS (2)'));
        ok('5e · muestra las notas extra', h.includes('Traer agua'));
        ok('5f · incluye el botón de cerrar', h.includes('✕ Cerrar'));
    }
    {
        const { g, w, appended } = buildSandbox({
            notifs: {
                p1: { clubId: 'club1', type: 'planificacion_semanal', weekStartDate: '2026-03-02',
                      days: [{ day: 'Lunes', time: '18:00', venue: 'Anexo', note: 'Físico' }, { day: 'Martes' }],
                      notes: 'Semana de carga', createdAt: iso(1) },
            },
        });
        await g._sdLoadEvents('planificacion_semanal');
        await w.sdViewEventDetail('p1');
        const h = appended[0].innerHTML;
        ok('5g · planificación: tabla de días con hora, sitio y nota',
            h.includes('Lunes') && h.includes('🕐 18:00') && h.includes('📍 Anexo') && h.includes('📝 Físico'));
        ok('5h · los días sin datos se marcan como descanso', h.includes('_Descanso_'));
        ok('5i · muestra las notas de la semana', h.includes('Semana de carga'));
    }
    // ═══ Planificación semanal: tarjetas en HORIZONTAL y partidos en verde ═══
    // Rediseño pedido por el autor (2026-07-30): los días salían apilados en
    // vertical y apretados; ahora son tarjetas en fila con scroll horizontal, y
    // el día que tiene partido se destaca en verde.
    //
    // ⚠️ CÓMO SE SABE QUE UN DÍA TIENE PARTIDO, y es la limitación de esta
    // función: un día es { day, time, venue, note } y NO HAY NINGÚN CAMPO que lo
    // marque (lo escribe js/parent/panel.js leyendo tres inputs de texto). Así
    // que se detecta por el TEXTO de la nota o el sitio ("partido", "liga",
    // "amistoso"). Se respeta además un campo estructurado `kind` si algún día
    // se añade al compositor, que es la solución buena; mientras no exista, la
    // heurística es lo único que funciona sobre los datos ya guardados.
    {
        const { g, w, appended } = buildSandbox({
            notifs: {
                p2: { clubId: 'club1', type: 'planificacion_semanal', weekStartDate: '2026-03-02',
                      days: [
                          { day: 'Lunes',     time: '18:00', venue: 'Anexo',   note: 'Físico' },
                          { day: 'Martes' },
                          { day: 'Miércoles', time: '19:00', venue: 'Campo 1', note: 'Partido vs CD Rival' },
                          { day: 'Jueves',    time: '18:00', venue: 'Anexo',   note: 'Táctica' },
                          { day: 'Viernes',   time: '11:00', venue: 'Municipal', note: 'Amistoso' },
                          { day: 'Sábado',    time: '10:00', venue: 'Casa',    note: 'Jornada de Liga' },
                          { day: 'Domingo' },
                      ],
                      createdAt: iso(1) },
            },
        });
        await g._sdLoadEvents('planificacion_semanal');
        await w.sdViewEventDetail('p2');
        const h = appended[0].innerHTML;

        // — Layout horizontal —
        ok('5j · 🔑 los días van en fila con scroll horizontal',
            /overflow-x:\s*auto/.test(h) && /display:\s*flex/.test(h));
        ok('5k · una tarjeta por día (7)',
            (h.match(/data-day="/g) || []).length === 7,
            (h.match(/data-day="/g) || []).length);
        ok('5l · 🔑 las tarjetas no se encogen (flex-shrink:0), o el scroll no serviría',
            /flex-shrink:\s*0/.test(h) || /flex:\s*0 0/.test(h));

        // — Verde sólo en los días con partido —
        // ⚠️ Se localiza la tarjeta por su atributo data-day, NO partiendo el
        // HTML por 'class="wp-day': eso también casa con el wp-day-head de
        // dentro, y la primera versión de este helper daba rojo con el código ya
        // correcto. Se leen las CLASES de la tarjeta de ese día concreto.
        const clasesDe = (html, dia) => {
            const m = String(html).match(new RegExp('class="([^"]*)" data-day="' + dia + '"'));
            return m ? m[1] : '';
        };
        const tarjeta = (dia) => clasesDe(h, dia);
        ok('5m · 🔑 el día con "Partido vs …" se marca como partido',
            /wp-day-match/.test(tarjeta('Miércoles')), tarjeta('Miércoles').slice(0, 120));
        ok('5n · 🔑 y el "Amistoso" también', /wp-day-match/.test(tarjeta('Viernes')));
        ok('5o · 🔑 y la "Jornada de Liga" también', /wp-day-match/.test(tarjeta('Sábado')));
        ok('5p · 🔑 un entrenamiento normal NO se marca en verde',
            !/wp-day-match/.test(tarjeta('Lunes')) && !/wp-day-match/.test(tarjeta('Jueves')),
            tarjeta('Jueves').slice(0, 120));
        ok('5q · ni un día de descanso', !/wp-day-match/.test(tarjeta('Martes')));
        // ⚠️ Sin quitar el <style>, esto cuenta las REGLAS CSS .wp-day-match
        // además de las tarjetas y siempre da de más. Misma trampa ya pagada en
        // la PARTE 5 de test_category_tree.js.
        const soloMarcado = (html) => String(html).replace(/<style>[\s\S]*?<\/style>/g, '');
        ok('5r · exactamente 3 días marcados, ni uno más',
            (soloMarcado(h).match(/wp-day-match/g) || []).length === 3,
            (soloMarcado(h).match(/wp-day-match/g) || []).length);
        ok('5s · el verde del proyecto (#3fb950) está en el CSS del modal',
            /#3fb950/i.test(h));

        // — Se respeta un campo estructurado si existe —
        const { g: g3, w: w3, appended: ap3 } = buildSandbox({
            notifs: {
                p3: { clubId: 'club1', type: 'planificacion_semanal', weekStartDate: '2026-03-09',
                      days: [{ day: 'Lunes', time: '18:00', venue: 'Anexo', note: 'Sesión', kind: 'partido' },
                             { day: 'Martes', time: '18:00', venue: 'Anexo', note: 'Sesión' }],
                      createdAt: iso(1) },
            },
        });
        await g3._sdLoadEvents('planificacion_semanal');
        await w3.sdViewEventDetail('p3');
        const h3 = ap3[0].innerHTML;
        ok('5t · 🔑 un campo kind:"partido" manda aunque la nota no lo diga',
            (soloMarcado(h3).match(/wp-day-match/g) || []).length === 1,
            (soloMarcado(h3).match(/wp-day-match/g) || []).length);

        // — Escapado: la nota es texto libre del entrenador —
        const { g: g4, w: w4, appended: ap4 } = buildSandbox({
            notifs: {
                p4: { clubId: 'club1', type: 'planificacion_semanal', weekStartDate: '2026-03-16',
                      days: [{ day: 'Lunes', time: '18:00', venue: 'X', note: '<img src=x onerror=alert(1)> partido' }],
                      createdAt: iso(1) },
            },
        });
        await g4._sdLoadEvents('planificacion_semanal');
        await w4.sdViewEventDetail('p4');
        ok('5u · 🔑 la nota va escapada aunque active el verde',
            !/<img/.test(ap4[0].innerHTML) && /wp-day-match/.test(ap4[0].innerHTML));
    }
    {
        // id que no está en `items`: cae al fallback de Firestore
        const { g, w, appended } = buildSandbox({
            notifs: { c1: { clubId: 'club1', type: 'convocatoria', rival: 'Listado', createdAt: iso(1) } },
            getDocReturns: { type: 'convocatoria', rival: 'DesdeFirestore' },
        });
        await g._sdLoadEvents('convocatoria');
        await w.sdViewEventDetail('otro-id');
        ok('5j · un id ausente del listado se busca en Firestore',
            appended.length === 1 && appended[0].innerHTML.includes('DesdeFirestore'),
            appended.length);
    }
    {
        const { g, w, appended } = buildSandbox({
            notifs: { c1: { clubId: 'club1', type: 'convocatoria', rival: 'Listado', createdAt: iso(1) } },
            getDocReturns: undefined,   // el doc no existe
        });
        await g._sdLoadEvents('convocatoria');
        await w.sdViewEventDetail('inexistente');
        ok('5k · si tampoco existe en Firestore, no crea overlay', appended.length === 0, appended.length);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 6 · sdDeleteNotif (descarte personal, NO borrado) ──');
    const oneNotif = () => ({ c1: { clubId: 'club1', type: 'convocatoria', rival: 'X', createdAt: iso(1) } });
    {
        const { g, w, updated, deleted } = buildSandbox({ notifs: oneNotif(), confirmReturns: false });
        await g._sdLoadEvents('convocatoria');
        await w.sdDeleteNotif('c1');
        ok('6a · si el usuario cancela, no escribe ni borra',
            updated.length === 0 && deleted.length === 0, { updated, deleted });
    }
    {
        const { g, w, updated, deleted, toasts } = buildSandbox({ notifs: oneNotif() });
        await g._sdLoadEvents('convocatoria');
        await w.sdDeleteNotif('c1');
        ok('6b · marca dismissedBy con arrayUnion(me.uid)',
            updated.length === 1 && updated[0].col === 'cronos_notifications' && updated[0].id === 'c1'
            && updated[0].data.dismissedBy.__arrayUnion[0] === 'u1',
            updated);
        ok('6c · ⚠️ NUNCA llama deleteDoc (es descarte personal, no borrado)',
            deleted.length === 0, deleted);
        ok('6d · avisa con un toast', toasts.some(t => t.includes('Quitado de tu panel')), toasts);
        ok('6e · usa la vía normal (_sdFS), no el fallback', updated[0].via === 'sdFS', updated[0].via);
    }
    {
        const { g, w, updated, toasts } = buildSandbox({ notifs: oneNotif(), updateDocThrows: 'primer fallo' });
        await g._sdLoadEvents('convocatoria');
        await w.sdDeleteNotif('c1');
        ok('6f · si el primer intento falla, reintenta con el import() dinámico',
            updated.length === 1 && updated[0].via === 'import'
            && updated[0].data.dismissedBy.__arrayUnion[0] === 'u1',
            updated);
        ok('6g · y el fallback también avisa', toasts.some(t => t.includes('Quitado de tu panel')));
    }
    {
        const { g, w, updated, toasts } = buildSandbox({
            notifs: oneNotif(), updateDocThrows: 'primer fallo', moduleUpdateThrows: 'segundo fallo',
        });
        await g._sdLoadEvents('convocatoria');
        await w.sdDeleteNotif('c1');
        ok('6h · si fallan los dos intentos, avisa del error',
            updated.length === 0 && toasts.some(t => t.includes('Error: segundo fallo')),
            { updated, toasts });
    }
    ok('6i · el toast va guardado con typeof en las 3 salidas',
        (BLOCK.match(/if \(typeof showToast === 'function'\) showToast/g) || []).length === 3,
        (BLOCK.match(/if \(typeof showToast === 'function'\) showToast/g) || []).length);

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });

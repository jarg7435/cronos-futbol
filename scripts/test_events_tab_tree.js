// ─────────────────────────────────────────────────────────────────────────
// test_events_tab_tree.js · FASES 3 y 4 del árbol del panel de Dirección
// (implementar.txt, 2026-07-30): las pestañas ENTRENAMIENTOS (fase 3) y
// CONVOCATORIAS (fase 4) pasan de lista plana a árbol Categoría → Subcategoría.
//
// ⚠️ POR QUÉ ESTE GUARD ES APARTE de test_events_tab_module.js, que ya cubre
// esta función con 60+ aserciones: aquel monta su sandbox con
// `window = { _cronosCurrentUser: me }` y NADA MÁS — sin el módulo compartido.
// Si el render nuevo diera por hecho que window.ctRenderTree existe, aquel
// guard entero se caería. Así que el árbol es CONDICIONAL, aquel guard sigue
// ejercitando (y fijando) el camino plano, y aquí se monta el sandbox CON el
// módulo real cargado, que es el único sitio donde se ve el árbol.
//
// LO QUE FIJA:
//   1. Las DOS pestañas pintan el árbol. Convocatorias trae categoría y
//      subcategoría en el propio documento, pero necesita el mismo respaldo por
//      autor: whatsapp-email.js guarda `me.subcategory || … || null`, así que
//      hay convocatorias históricas con subcategoría nula.
//   2. 🔑 Si el módulo compartido no está cargado, se pinta la LISTA PLANA de
//      siempre. Un panel a medio cargar no puede quedarse en blanco.
//   3. La tarjeta de cada aviso es LA MISMA en el árbol y en la lista plana —
//      un solo helper la genera. Y los dos handlers (ver detalle, descartar)
//      siguen funcionando desde dentro de una hoja del árbol.
//   4. Nada se pierde: lo que no se puede clasificar sale en "Sin clasificar".
//   5. La cabecera con el recuento y el máximo sigue estando (es lo que fijan
//      las aserciones 3c/3g/4a del otro guard, y el autoborrado depende de ella
//      para ser visible).
//   6. 🔑 Si la consulta de usuarios falla, el árbol se pinta igual. Esa
//      consulta sólo alimenta el respaldo del histórico: los avisos nuevos ya
//      traen su categoría en el documento (fase 2).
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

console.log('── Entrenamientos: árbol de categorías (fase 3) ──\n');

const SRC_EVENTS = leer('js/coach/reports/events-tab.js');
const SRC_MOD    = leer('js/admin/shared/category-tree.js');

const _s = SRC_EVENTS.indexOf('async function _sdLoadEvents(type)');
if (_s === -1) throw new Error('No se encontró _sdLoadEvents');
const BLOCK = SRC_EVENTS.slice(_s);

const FIRESTORE_IMPORT =
    /await import\(\s*'https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js'\s*\)/g;

// Réplicas EXACTAS de app-init.js (igual que en test_events_tab_module.js).
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

// ── Sandbox ──────────────────────────────────────────────────────────────
// withModule=false reproduce EXACTAMENTE el entorno de test_events_tab_module.js
// (window pelado), que es el caso de "el módulo no cargó".
function buildSandbox({ notifs = {}, users = {}, me = { uid: 'u1', clubId: 'club1' },
                        withModule = true, failUsers = false } = {}) {
    const store = { cronos_notifications: Object.assign({}, notifs), users: Object.assign({}, users) };
    const deleted = [];
    const updated = [];
    const container = { id: 'staff-dashboard-content', innerHTML: '' };
    const els = { 'staff-dashboard-content': container };
    const queriedCols = [];

    const matches = (data, clauses) => (clauses || []).every(c => {
        if (!c || c.__where !== true) return true;
        return data[c.field] === c.value;
    });

    const fakeFS = {
        db: {},
        collection: (db, col) => ({ __col: col }),
        query: (ref, ...clauses) => ({ __col: ref.__col, __clauses: clauses }),
        where: (field, op, value) => ({ __where: true, field, op, value }),
        orderBy: (f) => ({ __orderBy: f }),
        limit: (n) => ({ __limit: n }),
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDocs: async (ref) => {
            queriedCols.push(ref.__col);
            if (failUsers && ref.__col === 'users') throw new Error('users query falló');
            const st = store[ref.__col] || {};
            const rows = Object.keys(st).filter(id => matches(st[id], ref.__clauses)).map(id => [id, st[id]]);
            return { forEach: (cb) => rows.forEach(r => cb({ id: r[0], data: () => r[1] })) };
        },
        getDoc: async () => ({ exists: () => false, data: () => undefined }),
        deleteDoc: async (ref) => { deleted.push(ref.__col + '/' + ref.__id); delete (store[ref.__col] || {})[ref.__id]; },
        updateDoc: async (ref, data) => { updated.push({ col: ref.__col, id: ref.__id, data }); },
        arrayUnion: (...items) => ({ __arrayUnion: items }),
    };

    const sandbox = {
        document: {
            getElementById: (id) => (els[id] !== undefined ? els[id] : null),
            createElement: () => ({ id: '', style: { cssText: '' }, innerHTML: '', remove() {} }),
            body: { appendChild() {} },
        },
        confirm: () => true,
        console: { log() {}, warn() {}, error() {} },
        Promise, Set, Map, Array, Object, String, Number, Date, Math, JSON, Intl, RegExp,
        _sdFS: async () => fakeFS,
        escapeHtml: escHtml,
        escapeAttr: escAttr,
        showToast: () => {},
        __fakeFirestoreModule: fakeFS,
    };

    if (withModule) {
        // El módulo publica sobre window, así que window debe ser el global
        // (igual que en test_category_tree.js).
        sandbox.window = sandbox;
        vm.createContext(sandbox);
        vm.runInContext(SRC_MOD, sandbox);
        sandbox._cronosCurrentUser = me;
    } else {
        sandbox.window = { _cronosCurrentUser: me };
        vm.createContext(sandbox);
    }
    vm.runInContext(BLOCK.replace(FIRESTORE_IMPORT, '__fakeFirestoreModule'), sandbox);

    return { g: sandbox, store, deleted, updated, container, queriedCols };
}

const iso = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
// Quita el <style> que viaja con el árbol: sin esto, buscar 'ct-tree-open' o
// 'ct-tree-none' encuentra el CSS y no el marcado (trampa ya pagada en la
// PARTE 5 de test_category_tree.js).
const marcado = (h) => String(h).replace(/<style>[\s\S]*?<\/style>/g, '');
const cuenta = (h, re) => (String(h).match(re) || []).length;

// Un entrenamiento tal como lo escribe training-notify.js tras la fase 2.
const TR = (over) => Object.assign({
    type: 'planificacion_semanal', clubId: 'club1', coachUid: 'c_ana',
    userId: 'p1', parentUid: 'p1', coachEmail: 'ana@x.com',
    datetime: '2026-02-03T18:00:00', location: 'Campo 1', notes: '',
    createdAt: iso(5),
}, over || {});

const CONV = (over) => Object.assign({
    type: 'convocatoria', clubId: 'club1', coachUid: 'c_ana',
    category: 'alevin', subcategory: 'A',
    rival: 'CD Rival', venue: 'Campo 1', players: ['Ana', 'Luis'],
    createdAt: iso(5),
}, over || {});

const USERS = {
    c_ana: { role: 'user', clubId: 'club1', category: 'alevin', subcategory: 'A' },
    c_bea: { role: 'user', clubId: 'club1', allRoles: [
        { role: 'user', clubId: 'club1', category: 'alevin', subcategory: 'B' },
        { role: 'user', clubId: 'club1', category: 'cadete', subcategory: 'A' },
    ] },
};

(async () => {

// ═══════ PARTE 1 · Entrenamientos se pinta como árbol ═══════
console.log('── PARTE 1 · el árbol aparece en Entrenamientos ──');
{
    const t = buildSandbox({ users: USERS, notifs: {
        t1: TR({ category: 'alevin', subcategory: 'A' }),
        t2: TR({ category: 'cadete', subcategory: 'A', coachUid: 'c_bea', createdAt: iso(6) }),
    } });
    await t.g._sdLoadEvents('planificacion_semanal');
    const h = t.container.innerHTML;

    ok('1a · 🔑 pinta el árbol, no una lista plana', /ct-tree-cat/.test(h));
    ok('1b · con las 9 categorías', cuenta(h, /class="ct-tree-cat"/g) === 9,
       cuenta(h, /class="ct-tree-cat"/g));
    ok('1c · y las 27 subcategorías', cuenta(h, /class="ct-tree-sub"/g) === 27);
    ok('1d · trae su propio CSS', /\.ct-tree-body\{display:none/.test(h));
    ok('1e · 🔑 arranca plegado', !/ct-tree-open/.test(marcado(h)));

    // 🔑 La cabecera de recuento es lo que fijan 3c/3g/4a del otro guard: el
    // autoborrado destructivo sólo es visible por ahí.
    ok('1f · 🔑 conserva la cabecera con el recuento y el máximo',
       /2 registros/.test(h) && /máx\. 40/.test(h));

    // Las dos hojas caen en ramas distintas y el recuento de cada rama lo dice.
    ok('1g · el aviso de Alevín cuenta en su categoría',
       /Alev[íi]n<\/span>[\s\S]{0,200}?ct-tree-count[^>]*>1</.test(h));
    ok('1h · y el de Cadete en la suya',
       /Cadete<\/span>[\s\S]{0,200}?ct-tree-count[^>]*>1</.test(h));
    ok('1i · las categorías sin avisos salen a 0, no se ocultan',
       /Juvenil<\/span>[\s\S]{0,200}?ct-tree-zero/.test(h));
}

// ═══════ PARTE 2 · la tarjeta es la misma, y sigue viva ═══════
console.log('\n── PARTE 2 · la tarjeta del aviso dentro de la hoja ──');
{
    const t = buildSandbox({ users: USERS, notifs: {
        t1: TR({ category: 'alevin', subcategory: 'A', notes: 'Series' }),
    } });
    await t.g._sdLoadEvents('planificacion_semanal');
    const h = t.container.innerHTML;

    ok('2a · la etiqueta ENTRENAMIENTO sigue ahí', /📅 ENTRENAMIENTO/.test(h));
    ok('2b · y la tarjeta sd-card', /class="sd-card"/.test(h));
    ok('2c · con el autor del envío', h.includes('Enviado por ' + escHtml('ana@x.com')));
    ok('2d · el sitio en la subLínea', h.includes(escHtml('Campo 1')));
    ok('2e · el botón de ver detalle', /sdViewEventDetail\('t1'\)/.test(h));
    ok('2f · y el de descartar', /sdDeleteNotif\('t1'\)/.test(h));

    // 🔑 Los handlers se asignan igual: el árbol no puede romper el cierre.
    ok('2g · 🔑 sdViewEventDetail sigue asignado', typeof t.g.window.sdViewEventDetail === 'function');
    ok('2h · 🔑 y sdDeleteNotif también', typeof t.g.window.sdDeleteNotif === 'function');

    // Descartar desde una hoja del árbol marca dismissedBy, no borra.
    await t.g.window.sdDeleteNotif('t1');
    ok('2i · 🔑 descartar desde el árbol marca dismissedBy, no borra',
       t.updated.length === 1 && t.updated[0].id === 't1' &&
       !!t.updated[0].data.dismissedBy && t.deleted.length === 0,
       { updated: t.updated, deleted: t.deleted });

    // Un id con comilla no puede escapar del onclick.
    const t2 = buildSandbox({ users: USERS, notifs: {
        "t'x": TR({ category: 'alevin', subcategory: 'A' }),
    } });
    await t2.g._sdLoadEvents('planificacion_semanal');
    ok('2j · un id con comilla se neutraliza dentro de la hoja',
       !/sdDeleteNotif\('t'x'\)/.test(t2.container.innerHTML) &&
       t2.container.innerHTML.includes('&#039;'));
}

// ═══════ PARTE 3 · nada se pierde ═══════
console.log('\n── PARTE 3 · "Sin clasificar" y el respaldo por autor ──');
{
    // t_amb: autor con DOS equipos y documento mudo → no se puede adivinar.
    // t_res: documento mudo pero autor de un solo equipo → se resuelve.
    // t_hue: ni categoría ni autor conocido.
    const t = buildSandbox({ users: USERS, notifs: {
        t_res: TR({ coachUid: 'c_ana', createdAt: iso(9) }),
        t_amb: TR({ coachUid: 'c_bea', createdAt: iso(8) }),
        t_hue: TR({ coachUid: 'c_fantasma', createdAt: iso(7) }),
    } });
    await t.g._sdLoadEvents('planificacion_semanal');
    const h = t.container.innerHTML;

    ok('3a · 🔑 consulta la colección users para el respaldo por autor',
       t.queriedCols.includes('users'), t.queriedCols);
    ok('3b · 🔑 el aviso sin categoría se resuelve por su autor de un solo equipo',
       /Alev[íi]n<\/span>[\s\S]{0,200}?ct-tree-count[^>]*>1</.test(h));
    ok('3c · 🔑 aparece el nodo "Sin clasificar"', /ct-tree-none/.test(marcado(h)));
    ok('3d · 🔑 con los DOS que no se pueden clasificar (el ambiguo y el huérfano)',
       /ct-tree-none[\s\S]{0,400}?ct-tree-count[^>]*>2</.test(h),
       (h.match(/ct-tree-none[\s\S]{0,400}?ct-tree-count[^>]*>(\d+)</) || [])[1]);
    ok('3e · y los tres siguen presentes en el marcado',
       /sdViewEventDetail\('t_res'\)/.test(h) &&
       /sdViewEventDetail\('t_amb'\)/.test(h) &&
       /sdViewEventDetail\('t_hue'\)/.test(h));
    ok('3f · la cabecera sigue contando los 3', /3 registros/.test(h));

    // 🔑 Si la consulta de usuarios falla, el árbol se pinta igual: los avisos
    // nuevos traen su categoría en el documento y no dependen del respaldo.
    const tf = buildSandbox({ users: USERS, failUsers: true, notifs: {
        t1: TR({ category: 'alevin', subcategory: 'A' }),
        t2: TR({ coachUid: 'c_ana', createdAt: iso(6) }),
    } });
    await tf.g._sdLoadEvents('planificacion_semanal');
    const hf = tf.container.innerHTML;
    ok('3g · 🔑 si la consulta de usuarios falla, el árbol se pinta igual',
       /ct-tree-cat/.test(hf) && /2 registros/.test(hf));
    ok('3h · el que traía su categoría en el documento se clasifica igual',
       /Alev[íi]n<\/span>[\s\S]{0,200}?ct-tree-count[^>]*>1</.test(hf));
    ok('3i · y el que dependía del respaldo va a "Sin clasificar", no se pierde',
       /ct-tree-none/.test(marcado(hf)) && /sdViewEventDetail\('t2'\)/.test(hf));
}

// ═══════ PARTE 4 · Convocatorias, también en árbol (fase 4) ═══════
// ⚠️ ESTA PARTE DECÍA LO CONTRARIO hasta la fase 4: fijaba que Convocatorias
// seguía PLANA, y era 4a/4b/4e —más la 7b— lo que declaraba el "pendiente".
// Se deja anotado porque en este proyecto ya ha pasado tres veces que una
// migración se diera por hecha sin buscar la aserción que la declaraba pendiente.
console.log('\n── PARTE 4 · Convocatorias también en árbol ──');
{
    const t = buildSandbox({ users: USERS, notifs: {
        c1: CONV(),                                                    // alevin/A
        c2: CONV({ category: 'cadete', subcategory: 'A', createdAt: iso(6) }),
    } });
    await t.g._sdLoadEvents('convocatoria');
    const h = t.container.innerHTML;

    ok('4a · 🔑 Convocatorias pinta el árbol', /ct-tree-cat/.test(h));
    ok('4b · con las 9 categorías', cuenta(h, /class="ct-tree-cat"/g) === 9,
       cuenta(h, /class="ct-tree-cat"/g));
    ok('4c · la etiqueta CONVOCATORIA sigue dentro de la hoja', /📋 CONVOCATORIA/.test(h));
    ok('4d · y su cuenta de convocados', /👥 2 convocados/.test(h));
    ok('4e · el título "vs rival" escapado', h.includes('vs ' + escHtml('CD Rival')));
    ok('4f · las dos tarjetas siguen ahí', cuenta(h, /class="sd-card"/g) === 2);
    ok('4g · la cabecera de recuento se conserva',
       /2 registros/.test(h) && /máx\. 40/.test(h));
    ok('4h · cada una en su rama',
       /Alev[íi]n<\/span>[\s\S]{0,200}?ct-tree-count[^>]*>1</.test(h) &&
       /Cadete<\/span>[\s\S]{0,200}?ct-tree-count[^>]*>1</.test(h));
    ok('4i · arranca plegado', !/ct-tree-open/.test(marcado(h)));

    // 🔑 Por qué Convocatorias TAMBIÉN necesita el índice de autores aunque el
    // documento traiga la categoría: whatsapp-email.js guarda
    // `me.subcategory || … || null`, así que hay convocatorias históricas con
    // subcategoría NULA. Sin el respaldo por autor irían a "Sin clasificar"
    // pudiendo recuperarse.
    ok('4j · 🔑 consulta usuarios para completar el histórico',
       t.queriedCols.includes('users'), t.queriedCols);

    const th = buildSandbox({ users: USERS, notifs: {
        c_hist: CONV({ category: 'Alevín', subcategory: null }),   // sin subcat
        c_amb:  CONV({ category: null, subcategory: null, coachUid: 'c_bea' }),
    } });
    await th.g._sdLoadEvents('convocatoria');
    const hh = th.container.innerHTML;
    ok('4k · 🔑 una convocatoria sin subcategoría se completa por su autor',
       /Alev[íi]n<\/span>[\s\S]{0,200}?ct-tree-count[^>]*>1</.test(hh));
    ok('4l · 🔑 y la que no se puede resolver va a "Sin clasificar", no se pierde',
       /ct-tree-none/.test(marcado(hh)) && /sdViewEventDetail\('c_amb'\)/.test(hh));
}

// ═══════ PARTE 5 · sin el módulo, lista plana ═══════
console.log('\n── PARTE 5 · respaldo si el módulo no cargó ──');
{
    const t = buildSandbox({ withModule: false, users: USERS, notifs: {
        t1: TR({ category: 'alevin', subcategory: 'A' }),
        t2: TR({ category: 'cadete', subcategory: 'A', createdAt: iso(6) }),
    } });
    await t.g._sdLoadEvents('planificacion_semanal');
    const h = t.container.innerHTML;

    // 🔑 Éste es el entorno EXACTO de test_events_tab_module.js. Si esto se
    // rompe, aquel guard entero se cae con él.
    ok('5a · 🔑 sin el módulo NO revienta y pinta la lista plana',
       cuenta(h, /class="sd-card"/g) === 2 && !/ct-tree-cat/.test(h), h.slice(0, 160));
    ok('5b · con la cabecera de recuento intacta', /2 registros/.test(h) && /máx\. 40/.test(h));
    ok('5c · y los handlers asignados igual',
       typeof t.g.window.sdViewEventDetail === 'function' &&
       typeof t.g.window.sdDeleteNotif === 'function');
    ok('5d · el vacío sigue funcionando sin el módulo', await (async () => {
        const v = buildSandbox({ withModule: false });
        await v.g._sdLoadEvents('planificacion_semanal');
        return /Sin avisos de entrenamiento/.test(v.container.innerHTML);
    })());
}

// ═══════ PARTE 6 · el autoborrado destructivo no cambia ═══════
console.log('\n── PARTE 6 · el autoborrado sigue igual (con árbol) ──');
{
    // ⚠️ Esta pestaña BORRA de Firestore los avisos por encima de 40. Meter el
    // árbol NO puede alterar ni el umbral ni cuáles se borran.
    const notifs = {};
    for (let i = 0; i < 45; i++) {
        notifs['n' + String(i).padStart(2, '0')] = TR({
            category: 'alevin', subcategory: 'A', createdAt: iso(i),
        });
    }
    const t = buildSandbox({ users: USERS, notifs });
    await t.g._sdLoadEvents('planificacion_semanal');

    ok('6a · 🔑 con 45 borra exactamente 5', t.deleted.length === 5, t.deleted);
    ok('6b · 🔑 y borra los 5 MÁS ANTIGUOS',
       ['n00', 'n01', 'n02', 'n03', 'n04'].every(id =>
           t.deleted.includes('cronos_notifications/' + id)), t.deleted);
    ok('6c · pinta los 40 que quedan en el árbol',
       /40 registros/.test(t.container.innerHTML) &&
       /ct-tree-cat/.test(t.container.innerHTML));
    ok('6d · el más antiguo ya no se muestra',
       !/sdViewEventDetail\('n00'\)/.test(t.container.innerHTML));
}

// ═══════ PARTE 7 · censos de fuente ═══════
console.log('\n── PARTE 7 · el código, no el render ──');
{
    const sinCom = SRC_EVENTS.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');

    ok('7a · 🔑 el árbol se pide condicionado a que el módulo exista',
       /typeof window\.ctRenderTree === 'function'/.test(sinCom));
    // Tras la fase 4 las DOS pestañas usan el árbol, así que ya no hay condición
    // por tipo: la única condición que queda —y la que importa— es que el módulo
    // esté cargado. Se comprueba que no haya vuelto a colarse un filtro por tipo
    // que dejaría una de las dos pestañas plana sin que nadie se enterase.
    ok('7b · 🔑 el árbol NO está restringido a un solo tipo de aviso',
       !/planificacion_semanal'\s*&&\s*typeof window\.ctRenderTree/.test(sinCom) &&
       /_sdUsaArbol/.test(sinCom), 'sigue habiendo una condición por tipo');
    ok('7c · 🔑 la tarjeta se genera con UN solo helper, no dos copias',
       cuenta(sinCom, /📅 ENTRENAMIENTO|CONVOCATORIA'\s*:/g) <= 2 &&
       /_sdEventCard/.test(sinCom), 'falta el helper _sdEventCard');
    ok('7d · usa el resolutor de la fase 2, no una normalización propia',
       /ctResolveCatSub/.test(sinCom) && /ctBuildCoachIndex/.test(sinCom));
    ok('7e · 🔑 la consulta de usuarios tolera su propio fallo',
       /users'\)[\s\S]{0,220}?catch/.test(sinCom) ||
       /_sdCoachIndex[\s\S]{0,400}?catch/.test(sinCom));
    ok('7f · el resolutor NO recibe userId/parentUid como autor',
       !/getAuthorUid[\s\S]{0,80}(userId|parentUid)/.test(sinCom));
    ok('7g · events-tab.js sigue en el precache de sw.js',
       /js\/coach\/reports\/events-tab\.js/.test(leer('sw.js')));
    ok('7h · el módulo compartido va antes que events-tab.js en index.html',
       (() => {
           const idx = leer('index.html');
           const a = idx.indexOf('js/admin/shared/category-tree.js');
           const b = idx.indexOf('js/coach/reports/events-tab.js');
           return a > -1 && b > a;
       })());
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.log('FAIL excepción no capturada: ' + e.stack); process.exit(1); });

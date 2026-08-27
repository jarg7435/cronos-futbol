// ─────────────────────────────────────────────────────────────────────────
// test_sa_clubs_module.js · Refactor de monolitos (auditoría 2026-07-22)
// PASO 9: extracción de la "Pestaña Clubes" (saClubs / saQuickApprove /
// setupClubsSyncListener) desde js/admin/superadmin/superadmin.panel.js a
// su propio archivo (js/admin/superadmin/clubs-tab.js).
//
// Coupling verificado antes de escribir este test:
//  · FAN-IN de saClubs: saTab('clubs') (se queda en superadmin.panel.js),
//    saQuickApprove y setupClubsSyncListener (se mueven con ella), y dos
//    llamadas externas en js/services/user-management.js:86,91 — ambas
//    guardadas con `typeof saClubs === 'function'`, resolución en tiempo de
//    ejecución, sin dependencia de orden de carga.
//  · FAN-IN de saQuickApprove: CERO llamadores fuera del HTML que genera
//    saClubs (onclick), acoplamiento cerrado -> se mueve con ella.
//  · FAN-IN de setupClubsSyncListener: solo openSuperAdminPanel() (se queda),
//    llamada "pelada" pero en tiempo de clic, no de carga.
//  · FAN-OUT: saFS, _saShowSpinner/_saHideSpinner/_saToast, window.ROLE_META,
//    window.renderCategoryTreeReadOnly (category-tree.js), escapeHtml/
//    escapeAttr (con guardas typeof), window._cronosCurrentUser,
//    window.saCountPendingRequests / saRequests / saIndividuals. Todo se
//    resuelve en tiempo de llamada; nada en tiempo de carga.
//
// ⚠️ RIESGO PRINCIPAL CUBIERTO POR ESTE TEST (parte 1c): js/core/app-init.js
// contiene un `async function saClubs()` LEGACY duplicado (panel SA antiguo).
// Hoy es inocuo solo porque app-init.js se carga ANTES que la definición
// buena. Si la nueva etiqueta <script> se colocara antes de app-init.js, la
// versión legacy ganaría y la pestaña Clubes se rompería en producción —
// exactamente el patrón "gana el último script" que ya causó un bug real con
// startMatchWithConvocation/endMatch. La aserción 1c lo blinda.
//
// Las tres funciones se llaman entre sí con el nombre "pelado" (sin
// window.), así que el arnés añade DESPUÉS del bloque unos delegadores
// (`var saClubs = function(){ return window.saClubs.apply(...) }`) en vez de
// una copia directa: replica mejor el navegador real (donde el nombre pelado
// resuelve contra window EN TIEMPO DE LLAMADA) y permite a los tests
// sustituir window.saClubs por un espía. Evolución de la técnica del paso 8.
//
// Cero solapamiento con el WIP sin commitear: los hunks de git diff caen en
// saSetClubUserStatus (~1448-1563) y Mensajería SA (~2054-2066, ~2206-2223);
// el único hunk cercano (1789-1794) son líneas en blanco DESPUÉS del `};` de
// cierre de setupClubsSyncListener, fuera del cuerpo de la función.
// Verificado con `git diff -U0` antes de escribir este test.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EXTRACTED = path.join(ROOT, 'js', 'admin', 'superadmin', 'clubs-tab.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED
    ? EXTRACTED
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Pestaña Clubes — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Infra: fakes de DOM ═══════════════════════════════
function makeEl(initial) {
    const el = Object.assign({
        tagName: 'DIV', value: '', innerHTML: '', textContent: '', children: [],
    }, initial);
    el.style = Object.assign({ cssText: '', display: '', borderBottomColor: '', color: '' }, (initial && initial.style) || {});
    el.children = (initial && initial.children) ? initial.children.slice() : [];
    el.appendChild = (c) => { c.__parent = el; el.children.push(c); return c; };
    el.querySelector = (sel) => el.children.find(c => String(c.tagName).toLowerCase() === String(sel).toLowerCase()) || null;
    el.remove = () => { if (el.__parent) el.__parent.children = el.__parent.children.filter(x => x !== el); };
    return el;
}

// saClubs hace `body.innerHTML=''; body.appendChild(...)`, así que el HTML
// final vive en los hijos, no en body.innerHTML. Se recompone recursivamente.
const fullHtml = (el) => !el ? '' : (el.innerHTML || '') + (el.children || []).map(fullHtml).join('');

// ═══════════════════════ Extracción del bloque a testear ═══════════════════
function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    if (IS_EXTRACTED) return src;
    const cut = (startMarker, endMarker) => {
        const s = src.indexOf(startMarker);
        if (s === -1) throw new Error('No se encontró "' + startMarker + '" en ' + SOURCE);
        const e = src.indexOf(endMarker, s);
        return e === -1 ? src.slice(s) : src.slice(s, e);
    };
    return [
        cut('window.saClubs = async function', '// PESTAÑA INDIVIDUALES'),
        cut('window.saQuickApprove = async function', 'window.saCountPendingRequests = async function'),
        cut('window.setupClubsSyncListener = async function', '// saDeleteClubComplete()'),
    ].join('\n');
}
const BLOCK = readBlock();

function buildSandbox({
    elements = {}, clubsStore = {}, usersStore = {},
    getDocsThrows = null, currentUserEmail = 'sa@cronos.app',
    confirmReturns = true, pendingCount = 0, countThrows = false,
} = {}) {
    const updateDocCalls = [];
    const toasts = [];
    const spinners = [];
    const treeCalls = [];
    const unsubCalls = [];
    const listeners = [];
    const timers = [];
    const vibrations = [];
    const createdEls = [];

    const els = {};
    for (const [id, init] of Object.entries(elements)) els[id] = makeEl(init);
    if (!els['sa-body']) els['sa-body'] = makeEl({});

    const fns = {
        db: {},
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async (ref) => {
            const store = ref.__col === 'clubs' ? clubsStore : usersStore;
            const data = store[ref.__id];
            return { exists: () => data !== undefined, data: () => data };
        },
        updateDoc: async (ref, data) => {
            updateDocCalls.push({ col: ref.__col, id: ref.__id, data });
            if (ref.__col === 'individuals') throw new Error('individuals-no-existe');
            const store = ref.__col === 'clubs' ? clubsStore : usersStore;
            if (store[ref.__id]) Object.assign(store[ref.__id], data);
        },
        collection: (db, col) => ({ __col: col }),
        query: (collRef, ...clauses) => ({ __col: collRef.__col, __clauses: clauses }),
        where: (field, op, value) => ({ field, op, value }),
        getDocs: async (collRef) => {
            if (getDocsThrows) throw new Error(getDocsThrows);
            const store = collRef.__col === 'clubs' ? clubsStore : usersStore;
            const entries = Object.entries(store);
            return { forEach: (cb) => entries.forEach(([id, data]) => cb({ id, data: () => data })) };
        },
        onSnapshot: (ref, cb) => {
            const unsub = () => unsubCalls.push(ref.__col);
            listeners.push({ col: ref.__col, clauses: ref.__clauses, cb, unsub });
            return unsub;
        },
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: currentUserEmail ? { email: currentUserEmail } : undefined,
            ROLE_META: {
                club_admin:  { icon: '🏅', color: '#58a6ff', label: 'Admin. de Club' },
                director:    { icon: '📋', color: '#f0883e', label: 'Director Deportivo' },
                coordinator: { icon: '🎯', color: '#d2a8ff', label: 'Coordinador' },
                user:        { icon: '⚙️', color: '#58a6ff', label: 'Entrenador' },
                parent:      { icon: '👨‍👩‍👧', color: '#79c0ff', label: 'Padre/Madre' },
            },
            renderCategoryTreeReadOnly: (users, opts) => {
                treeCalls.push({ users, opts });
                return '<div class="fake-tree">' + users.map(u => u.email).join(',') + '</div>';
            },
            saCountPendingRequests: async () => {
                if (countThrows) throw new Error('count-fail');
                return pendingCount;
            },
        },
        document: {
            getElementById: (id) => els[id] || null,
            createElement: (tag) => { const e = makeEl({ tagName: String(tag).toUpperCase() }); createdEls.push(e); return e; },
        },
        navigator: { vibrate: (p) => vibrations.push(p) },
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        setTimeout: (fn, ms) => { timers.push({ fn, ms, cancelled: false }); return timers.length; },
        clearTimeout: (id) => { if (id && timers[id - 1]) timers[id - 1].cancelled = true; },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON,
        saFS: async () => fns,
    };
    sandbox.window.saFS = sandbox.saFS;
    // ⏱️ v638 · `_saEsperarToken` / `_saConReintento` los define
    //    superadmin.panel.js, que en la app SIEMPRE carga antes que las
    //    pestañas (es quien publica `saFS`). Aquí se replica su contrato:
    //    ejecutar y, si deniegan por permisos, refrescar el token y reintentar.
    //    En el arnés no hay denegaciones, así que basta con ejecutar — pero
    //    tienen que EXISTIR, o la lectura revienta con "no es una función".
    sandbox.window._saEsperarToken = async () => {};
    sandbox.window._saConReintento = async (fn) => fn();
    vm.createContext(sandbox);

    const stubs = `
        var _saShowSpinner = function(msg) { __spinners.push({ on: true, msg: msg }); };
        var _saHideSpinner = function() { __spinners.push({ on: false }); };
        var _saToast = function(msg, ms) { __toasts.push(msg); };
        var escapeHtml = function(s) { return String(s == null ? '' : s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#039;'); };
        var escapeAttr = function(s) { return String(s == null ? '' : s)
            .replace(/'/g,'&#039;').replace(/"/g,'&quot;'); };
        var saFS = window.saFS;
    `;
    // Delegadores AL FINAL: los nombres "pelados" deben resolver contra window
    // en tiempo de llamada (como en un navegador real), para que los tests
    // puedan sustituir window.saClubs/saIndividuals/saRequests por espías.
    const forwards = `
        var saClubs       = function() { return window.saClubs.apply(null, arguments); };
        var saIndividuals = function() { return window.saIndividuals.apply(null, arguments); };
        var saRequests    = function() { return window.saRequests.apply(null, arguments); };
    `;
    sandbox.__spinners = spinners;
    sandbox.__toasts = toasts;
    vm.runInContext(stubs + BLOCK + forwards, sandbox);

    const flushTimers = async () => {
        const pending = timers.filter(t => !t.cancelled && !t.done);
        for (const t of pending) { t.done = true; await t.fn(); }
    };

    return {
        sandbox, els, clubsStore, usersStore, updateDocCalls, toasts, spinners,
        treeCalls, unsubCalls, listeners, timers, vibrations, createdEls, flushTimers,
    };
}

const makeSnap = (changes, size) => ({
    docChanges: () => changes,
    size: size !== undefined ? size : changes.length,
});

(async () => {
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');

    console.log('── PARTE 1 · estructura y orden de carga ──');
    ok('1a · saClubs existe', /window\.saClubs\s*=\s*async function/.test(rawSrc));
    ok('1b · saQuickApprove existe', /window\.saQuickApprove\s*=\s*async function/.test(rawSrc));
    ok('1c · setupClubsSyncListener existe', /window\.setupClubsSyncListener\s*=\s*async function/.test(rawSrc));
    {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const appInitPos = idxHtml.indexOf('js/core/app-init.js');
        const tag = IS_EXTRACTED ? 'js/admin/superadmin/clubs-tab.js' : 'js/admin/superadmin/superadmin.panel.js';
        const targetPos = idxHtml.indexOf(tag);
        ok('1d · la definición buena de saClubs se carga DESPUÉS de app-init.js (que tiene un saClubs legacy duplicado)',
            appInitPos !== -1 && targetPos !== -1 && targetPos > appInitPos,
            { appInitPos, tag, targetPos });
        if (IS_EXTRACTED) {
            const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
            ok('1e · clubs-tab.js está en el precache de sw.js', sw.includes('js/admin/superadmin/clubs-tab.js'));
        }
    }

    console.log('\n── PARTE 2 · saClubs() — barra de acciones y casos vacíos ──');
    {
        const { sandbox, els } = buildSandbox({});
        await sandbox.window.saClubs();
        const html = fullHtml(els['sa-body']);
        ok('2a · botón + Crear Club', /saShowCreateClub\(\)/.test(html) && /Crear Club/.test(html));
        ok('2b · botón + Crear Ente Individual', /saShowCreateIndividualEntity\(\)/.test(html));
        ok('2c · botón + Usuario Individual', /saShowCreateIndividual\(\)/.test(html));
        ok('2d · sin clubes -> mensaje "Sin clubes creados aún"', /Sin clubes creados aún/.test(html));
    }

    console.log('\n── PARTE 3 · saClubs() — filtrado de clubes y usuarios ──');
    {
        const { sandbox, els } = buildSandbox({
            clubsStore: {
                c1: { name: 'Club Real', plan: 'pro', slots: {} },
                ent1: { name: 'ZZZENTIDAD9', type: 'individual', slots: {} },
            },
            usersStore: {
                sa1: { email: 'sa@x.com', role: 'superadmin' },
                ad1: { email: 'ad@x.com', role: 'admin' },
                u1: { email: 'coach@x.com', role: 'user', clubId: 'c1', status: 'active' },
                i1: { email: 'indiv@x.com', role: 'user', clubId: 'ent1', status: 'active' },
                i2: { email: 'indivflag@x.com', role: 'user', isIndividual: true, status: 'active' },
                i3: { email: 'indivrole@x.com', role: 'parent_individual', status: 'active' },
                o1: { email: 'huerfano@x.com', role: 'parent', status: 'active' },
            },
        });
        await sandbox.window.saClubs();
        const html = fullHtml(els['sa-body']);
        ok('3a · muestra el club normal', /Club Real/.test(html));
        ok('3b · NO muestra el ente individual (type:individual)', !/ZZZENTIDAD9/.test(html));
        ok('3c · excluye superadmin/admin', !/sa@x\.com/.test(html) && !/ad@x\.com/.test(html));
        ok('3d · excluye usuarios cuyo clubId apunta a un ente individual', !/indiv@x\.com/.test(html));
        ok('3e · excluye usuarios con flag isIndividual', !/indivflag@x\.com/.test(html));
        ok('3f · excluye usuarios con rol *_individual', !/indivrole@x\.com/.test(html));
        ok('3g · el usuario sin club aparece en "Sin club asignado (1)"', /Sin club asignado \(1\)/.test(html) && /huerfano@x\.com/.test(html));
        ok('3h · cabecera del club: plan y total de usuarios', /Plan: pro · 1 usuarios totales/.test(html));
    }

    console.log('\n── PARTE 4 · saClubs() — contadores, slots y pendientes ──');
    {
        const { sandbox, els } = buildSandbox({
            clubsStore: { c1: { name: 'Club S', plan: 'free', slots: { directors: 2, coordinators: 1, users: 2, parents: 10 } } },
            usersStore: {
                a1: { email: 'admin@c.com', role: 'club_admin', clubId: 'c1', status: 'active' },
                d1: { email: 'dir@c.com', role: 'director', clubId: 'c1', status: 'active' },
                co1: { email: 'coord@c.com', role: 'coordinator', clubId: 'c1', status: 'active' },
                e1: { email: 'e1@c.com', role: 'user', clubId: 'c1', status: 'active' },
                e2: { email: 'e2@c.com', role: 'user', clubId: 'c1', status: 'active' },
                e3: { email: 'e3@c.com', role: 'user', clubId: 'c1', status: 'removed' },
                p1: { email: 'p1@c.com', role: 'parent', clubId: 'c1', status: 'pending' },
                p2: { email: 'p2@c.com', role: 'parent', clubId: 'c1', status: 'pending_club' },
            },
        });
        await sandbox.window.saClubs();
        const html = fullHtml(els['sa-body']);
        ok('4a · cuenta 2 pendientes (pending + pending_club)', /2 pendientes/.test(html));
        ok('4b · Administradores de Club: 1 / 1', /Administradores de Club[\s\S]{0,220}>1<[\s\S]{0,80}\/ 1/.test(html));
        ok('4c · Entrenadores 2/2 (el "removed" NO cuenta) y marca slot lleno', /Entrenadores[\s\S]{0,200}>2<[\s\S]{0,150}\/ 2/.test(html) && /#ff5858/.test(html));
        ok('4d · Directores Deportivos 1 / 2', /Directores Deportivos[\s\S]{0,220}>1<[\s\S]{0,150}\/ 2/.test(html));
        ok('4e · Padres 2 / 10', /Padres \/ Madres \/ Tutores[\s\S]{0,220}>2<[\s\S]{0,150}\/ 10/.test(html));
        ok('4f · botón editar slots con el id del club', /saEditClubSlots\('c1'/.test(html));
        ok('4g · botón borrar club completo con el id del club', /saDeleteClubComplete\('c1'/.test(html));
    }
    {
        const { sandbox, els } = buildSandbox({
            clubsStore: { c1: { name: 'Club Sin Slots' } },
            usersStore: { u1: { email: 'u@c.com', role: 'user', clubId: 'c1', status: 'active' } },
        });
        await sandbox.window.saClubs();
        const html = fullHtml(els['sa-body']);
        ok('4h · sin objeto slots -> máximo "∞"', /\/ ∞/.test(html));
    }
    {
        const { sandbox, els } = buildSandbox({
            clubsStore: { c1: { name: 'Club AR', slots: { users: 5 } } },
            usersStore: {
                u1: { email: 'multi@c.com', role: 'parent', clubId: 'c1', status: 'active',
                      allRoles: [{ role: 'user', clubId: 'c1', isAuthorized: true }] },
                u2: { email: 'noauth@c.com', role: 'parent', clubId: 'c1', status: 'active',
                      allRoles: [{ role: 'user', clubId: 'c1', isAuthorized: false }] },
            },
        });
        await sandbox.window.saClubs();
        const html = fullHtml(els['sa-body']);
        ok('4i · cuenta roles secundarios autorizados de allRoles (Entrenadores 1/5)', /Entrenadores[\s\S]{0,200}>1<[\s\S]{0,150}\/ 5/.test(html));
    }

    console.log('\n── PARTE 5 · saClubs() — árbol de categorías (renderCategoryTreeReadOnly) ──');
    {
        const { sandbox, els, treeCalls } = buildSandbox({
            clubsStore: { c1: { name: 'Club T', slots: {} } },
            usersStore: {
                u1: { email: 'a@c.com', role: 'user', clubId: 'c1', status: 'active', category: 'Infantil', subcategory: 'A' },
            },
        });
        await sandbox.window.saClubs();
        ok('5a · llama a renderCategoryTreeReadOnly con mode:"club"', treeCalls.length === 1 && treeCalls[0].opts && treeCalls[0].opts.mode === 'club');
        ok('5b · el usuario llega expandido con _activeRoleData', treeCalls[0].users.length === 1 && !!treeCalls[0].users[0]._activeRoleData);
        ok('5c · fallback: sin allRoles sintetiza el rol raíz con su category/subcategory',
            treeCalls[0].users[0]._activeRoleData.role === 'user'
            && treeCalls[0].users[0]._activeRoleData.category === 'Infantil'
            && treeCalls[0].users[0]._activeRoleData.subcategory === 'A');
        ok('5d · el resultado del árbol se inyecta en el HTML', /fake-tree/.test(fullHtml(els['sa-body'])));
        ok('5e · resumen "Ver usuarios (1)"', /Ver usuarios \(1\)/.test(fullHtml(els['sa-body'])));
    }
    {
        const { sandbox, treeCalls } = buildSandbox({
            clubsStore: { c1: { name: 'Club T2', slots: {} } },
            usersStore: {
                u1: { email: 'multi@c.com', role: 'user', clubId: 'c1', status: 'active',
                      category: 'Cadete', subcategory: 'B',
                      allRoles: [
                          { role: 'user', clubId: 'c1', isAuthorized: true },
                          { role: 'parent', clubId: 'c1', isAuthorized: true, category: 'Alevín', subcategory: 'C' },
                          { role: 'director', clubId: 'otro', isAuthorized: true },
                          { role: 'coordinator', clubId: 'c1', status: 'rejected' },
                      ] },
            },
        });
        await sandbox.window.saClubs();
        const roles = treeCalls[0].users.map(u => u._activeRoleData);
        ok('5f · una entrada por cada rol del club (2), excluye el de otro club y el rejected', roles.length === 2);
        ok('5g · rol sin category propia hereda la del usuario', roles.some(r => r.role === 'user' && r.category === 'Cadete' && r.subcategory === 'B'));
        ok('5h · rol con category propia la conserva', roles.some(r => r.role === 'parent' && r.category === 'Alevín' && r.subcategory === 'C'));
    }
    {
        const { sandbox, treeCalls } = buildSandbox({
            clubsStore: { c1: { name: 'Club T3', slots: {} } },
            usersStore: {
                u1: { email: 'quitado@c.com', role: 'user', clubId: 'c1', status: 'removed' },
                u2: { email: 'pend@c.com', role: 'user', requestedClubId: 'c1', clubId: 'c1', status: 'pending' },
            },
        });
        await sandbox.window.saClubs();
        const emails = treeCalls.length ? treeCalls[0].users.map(u => u.email) : [];
        ok('5i · usuarios "removed" NO llegan al árbol', !emails.includes('quitado@c.com'));
        ok('5j · usuarios pendientes SÍ llegan al árbol', emails.includes('pend@c.com'));
    }
    {
        const { sandbox, els, treeCalls } = buildSandbox({
            clubsStore: { c1: { name: 'Club Vacío', slots: {} } },
            usersStore: { u1: { email: 'x@c.com', role: 'user', clubId: 'c1', status: 'removed' } },
        });
        await sandbox.window.saClubs();
        ok('5k · club sin usuarios visibles -> "Sin usuarios asignados." y sin llamar al árbol',
            /Sin usuarios asignados\./.test(fullHtml(els['sa-body'])) && treeCalls.length === 0);
    }

    console.log('\n── PARTE 6 · saClubs() — filas de huérfanos, escapado y errores ──');
    {
        const { sandbox, els } = buildSandbox({
            usersStore: {
                o1: { email: 'pend@x.com', role: 'user', status: 'pending' },
                o2: { email: 'act@x.com', role: 'user', status: 'active' },
                o3: { email: 'blo@x.com', role: 'user', status: 'blocked' },
                o4: { email: 'rem@x.com', role: 'user', status: 'removed' },
            },
        });
        await sandbox.window.saClubs();
        const html = fullHtml(els['sa-body']);
        ok('6a · pendiente -> botón de aprobación rápida saQuickApprove', /saQuickApprove\('o1','pend@x\.com',''\)/.test(html));
        ok('6b · activo -> botón bloquear', /saSetClubUserStatus\('o2','act@x\.com','blocked'/.test(html));
        ok('6c · bloqueado -> botón reactivar', /saSetClubUserStatus\('o3','blo@x\.com','active'/.test(html));
        ok('6d · no-removed -> botón dar de baja', /saSetClubUserStatus\('o2','act@x\.com','removed'/.test(html));
        ok('6e · ya removed -> sin botón de baja para él', !/saSetClubUserStatus\('o4','rem@x\.com','removed'/.test(html));
        ok('6f · etiqueta de estado legible', /Pend\.SA/.test(html) && /Bloqueado/.test(html));
    }
    {
        const { sandbox, els } = buildSandbox({
            usersStore: { "o'1": { email: "o'brien@x.com", role: 'user', status: 'active' } },
        });
        await sandbox.window.saClubs();
        const html = fullHtml(els['sa-body']);
        ok('6g · comillas simples escapadas en los onclick (no rompen el HTML)', !/saSetClubUserStatus\('o'1'/.test(html));
    }
    {
        const { sandbox, els } = buildSandbox({
            clubsStore: { c1: { name: '<script>alert(1)</script>', slots: {} } },
            usersStore: {},
        });
        await sandbox.window.saClubs();
        const h6h = fullHtml(els['sa-body']);
        ok('6h · el nombre VISIBLE del club se escapa con escapeHtml', /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(h6h));
        ok('6h2 · las comillas del nombre no rompen los atributos onclick', /saEditClubSlots\('c1','&lt;script&gt;|saEditClubSlots\('c1','<script>/.test(h6h));
    }
    {
        const { sandbox, els } = buildSandbox({ getDocsThrows: 'permission-denied' });
        await sandbox.window.saClubs();
        ok('6i · error de carga -> mensaje capturado, sin excepción', /permission-denied/.test(fullHtml(els['sa-body'])));
    }
    {
        const { sandbox } = buildSandbox({});
        sandbox.document.getElementById = () => null;
        let threw = false;
        try { await sandbox.window.saClubs(); } catch (_) { threw = true; }
        ok('6j · sin #sa-body -> retorna sin reventar', !threw);
    }

    console.log('\n── PARTE 7 · saQuickApprove() — rama CLUB (2 pasos) ──');
    {
        const { sandbox, updateDocCalls, toasts, spinners } = buildSandbox({
            clubsStore: { c1: { name: 'Club' } },
            usersStore: { u1: { email: 'x@c.com', role: 'user', clubId: 'c1', status: 'pending' } },
        });
        await sandbox.window.saQuickApprove('u1', 'x@c.com', 'c1');
        const upd = updateDocCalls.find(c => c.col === 'users' && c.id === 'u1');
        ok('7a · pasa a pending_club (el club admin debe confirmar)', upd && upd.data.status === 'pending_club');
        ok('7b · marca approvedBySA + autor + fecha', upd && upd.data.approvedBySA === true && upd.data.approvedBySABy === 'sa@cronos.app' && !!upd.data.approvedBySAAt);
        ok('7c · NO activa isAuthorized en la rama club', upd && upd.data.isAuthorized === undefined);
        ok('7d · toast indica que el Club Admin debe confirmar', toasts.some(t => /Club Admin debe confirmar/i.test(t)));
        ok('7e · spinner mostrado y ocultado', spinners[0] && spinners[0].on === true && spinners[spinners.length - 1].on === false);
    }
    {
        const { sandbox, updateDocCalls, spinners } = buildSandbox({
            confirmReturns: false,
            usersStore: { u1: { email: 'x@c.com', role: 'user', clubId: 'c1', status: 'pending' } },
            clubsStore: { c1: { name: 'Club' } },
        });
        await sandbox.window.saQuickApprove('u1', 'x@c.com', 'c1');
        ok('7f · confirm cancelado -> ningún updateDoc y spinner oculto', updateDocCalls.length === 0 && spinners.some(s => s.on === false));
    }
    {
        const { sandbox, updateDocCalls, toasts } = buildSandbox({ usersStore: {} });
        await sandbox.window.saQuickApprove('no-existe', 'x@c.com', 'c1');
        ok('7g · usuario inexistente -> toast de aviso y ninguna escritura', updateDocCalls.length === 0 && toasts.some(t => /Usuario no encontrado/i.test(t)));
    }

    console.log('\n── PARTE 8 · saQuickApprove() — rama ENTIDAD INDIVIDUAL (directa) ──');
    {
        const { sandbox, updateDocCalls, toasts } = buildSandbox({
            clubsStore: { ent1: { name: 'Ente', type: 'individual', hasAdmin: false } },
            usersStore: { u1: { email: 'a@e.com', role: 'user', clubId: 'ent1', status: 'pending',
                                allRoles: [{ role: 'user', isAuthorized: false, status: 'pending' }] } },
        });
        await sandbox.window.saQuickApprove('u1', 'a@e.com', 'ent1');
        const upd = updateDocCalls.find(c => c.col === 'users' && c.id === 'u1');
        ok('8a · detecta entidad individual por clubs/{id}.type y activa directamente', upd && upd.data.isAuthorized === true && upd.data.status === 'active');
        ok('8b · autoriza todos los roles de allRoles', upd && upd.data.allRoles.every(r => r.isAuthorized === true && r.status === 'active'));
        ok('8c · rellena individualEntityId/individualOwnerId', upd && upd.data.individualEntityId === 'ent1' && upd.data.individualOwnerId === 'ent1');
        ok('8d · toast de activación inmediata', toasts.some(t => /activado directamente/i.test(t)));
    }
    {
        const { sandbox, updateDocCalls } = buildSandbox({
            clubsStore: { ent1: { name: 'Ente', hasAdmin: false } },
            usersStore: { u1: { email: 'adm@e.com', role: 'admin_individual', individualEntityId: 'ent1', status: 'pending',
                                displayName: 'Admin Real', allRoles: [{ role: 'admin_individual', isAuthorized: false }] } },
        });
        await sandbox.window.saQuickApprove('u1', 'adm@e.com', 'ent1');
        ok('8e · detecta entidad individual por individualEntityId (sin mirar el club)',
            updateDocCalls.some(c => c.col === 'users' && c.data.status === 'active'));
        const ent = updateDocCalls.find(c => c.col === 'clubs' && c.id === 'ent1');
        ok('8f · admin individual -> sincroniza hasAdmin/adminUid/adminEmail/adminName en la entidad',
            ent && ent.data.hasAdmin === true && ent.data.adminUid === 'u1' && ent.data.adminEmail === 'adm@e.com' && ent.data.adminName === 'Admin Real');
    }
    {
        // updateDoc sobre 'clubs' falla -> debe reintentar en la colección 'individuals'
        const { sandbox, updateDocCalls, toasts } = buildSandbox({
            clubsStore: {},
            usersStore: { u1: { email: 'adm@e.com', role: 'individual', individualOwnerId: 'entX', status: 'pending', allRoles: [] } },
        });
        const origUpdate = sandbox.saFS;
        sandbox.saFS = async () => {
            const f = await origUpdate();
            return Object.assign({}, f, {
                updateDoc: async (ref, data) => {
                    updateDocCalls.push({ col: ref.__col, id: ref.__id, data });
                    if (ref.__col === 'clubs') throw new Error('club-write-denied');
                },
            });
        };
        sandbox.window.saFS = sandbox.saFS;
        vm.runInContext('saFS = window.saFS;', sandbox);
        await sandbox.window.saQuickApprove('u1', 'adm@e.com', 'entX');
        ok('8g · si falla el hasAdmin en clubs -> reintenta en la colección individuals',
            updateDocCalls.some(c => c.col === 'individuals' && c.id === 'entX' && c.data.hasAdmin === true));
        ok('8h · el fallo del fallback no rompe el flujo (toast de éxito igualmente)', toasts.some(t => /activado directamente/i.test(t)));
    }
    {
        const { sandbox, spinners, toasts } = buildSandbox({
            getDocsThrows: null,
            usersStore: { u1: { email: 'x@c.com', role: 'user', clubId: 'c1', status: 'pending' } },
            clubsStore: { c1: { name: 'Club' } },
        });
        sandbox.saFS = async () => { throw new Error('sin-red'); };
        sandbox.window.saFS = sandbox.saFS;
        vm.runInContext('saFS = window.saFS;', sandbox);
        await sandbox.window.saQuickApprove('u1', 'x@c.com', 'c1');
        ok('8i · error inesperado -> oculta spinner y avisa por toast', spinners.some(s => s.on === false) && toasts.some(t => /sin-red/.test(t)));
    }
    {
        const { sandbox } = buildSandbox({
            clubsStore: { c1: { name: 'Club' } },
            usersStore: { u1: { email: 'x@c.com', role: 'user', clubId: 'c1', status: 'pending' } },
        });
        let refreshed = 0;
        sandbox.window.saClubs = async () => { refreshed++; };
        await sandbox.window.saQuickApprove('u1', 'x@c.com', 'c1');
        ok('8j · tras aprobar refresca la vista llamando a saClubs()', refreshed === 1);
    }

    console.log('\n── PARTE 9 · setupClubsSyncListener() — listener de usuarios ──');
    {
        const { sandbox, listeners, unsubCalls } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-requests': {} },
        });
        await sandbox.window.setupClubsSyncListener();
        ok('9a · registra listener sobre users y sobre platform_requests',
            listeners.some(l => l.col === 'users') && listeners.some(l => l.col === 'platform_requests'));
        ok('9b · guarda ambos unsubscribe en window',
            typeof sandbox.window._clubsSyncUnsubscribe === 'function' && typeof sandbox.window._requestsSyncUnsubscribe === 'function');
        ok('9c · el listener de solicitudes filtra por status == pending_sa',
            listeners.some(l => l.col === 'platform_requests' && (l.clauses || []).some(c => c.field === 'status' && c.op === '==' && c.value === 'pending_sa')));
        await sandbox.window.setupClubsSyncListener();
        ok('9d · segunda llamada -> desuscribe los listeners anteriores (idempotente)',
            unsubCalls.filter(c => c === 'users').length === 1 && unsubCalls.filter(c => c === 'platform_requests').length === 1);
    }
    {
        const { sandbox, listeners, timers, flushTimers } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-individuals': { style: { borderBottomColor: 'transparent' } }, 'sa-tab-requests': {} },
        });
        await sandbox.window.setupClubsSyncListener();
        let clubsCalls = 0, indivCalls = 0;
        sandbox.window.saClubs = async () => { clubsCalls++; };
        sandbox.window.saIndividuals = async () => { indivCalls++; };
        const usersCb = listeners.find(l => l.col === 'users').cb;

        usersCb(makeSnap([{ type: 'added' }]));
        ok('9e · solo cambios "added" -> no programa refresco', timers.length === 0);

        usersCb(makeSnap([{ type: 'modified' }]));
        ok('9f · cambio "modified" -> programa refresco con debounce de 700ms', timers.length === 1 && timers[0].ms === 700);
        await flushTimers();
        ok('9g · pestaña Clubes activa -> refresca saClubs()', clubsCalls === 1 && indivCalls === 0);

        usersCb(makeSnap([{ type: 'removed' }]));
        usersCb(makeSnap([{ type: 'removed' }]));
        ok('9h · dos eventos seguidos -> el primer temporizador se cancela (debounce real)',
            timers.filter(t => t.cancelled).length >= 1);
        await flushTimers();
        ok('9i · tras el debounce solo se refresca una vez más', clubsCalls === 2);
    }
    {
        const { sandbox, listeners, timers, flushTimers } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-individuals': { style: { borderBottomColor: 'rgb(88, 166, 255)' } }, 'sa-tab-requests': {} },
        });
        await sandbox.window.setupClubsSyncListener();
        let clubsCalls = 0, indivCalls = 0;
        sandbox.window.saClubs = async () => { clubsCalls++; };
        sandbox.window.saIndividuals = async () => { indivCalls++; };
        listeners.find(l => l.col === 'users').cb(makeSnap([{ type: 'modified' }]));
        await flushTimers();
        ok('9j · pestaña Individuales activa -> refresca saIndividuals(), no saClubs()', indivCalls === 1 && clubsCalls === 0);
    }
    {
        const { sandbox, listeners, timers } = buildSandbox({
            elements: { 'sa-panel': { style: { display: 'none' } }, 'sa-tab-requests': {} },
        });
        await sandbox.window.setupClubsSyncListener();
        listeners.find(l => l.col === 'users').cb(makeSnap([{ type: 'modified' }]));
        ok('9k · panel oculto -> no programa ningún refresco', timers.length === 0);
    }
    {
        const { sandbox, listeners } = buildSandbox({ elements: { 'sa-tab-requests': {} } });
        await sandbox.window.setupClubsSyncListener();
        let threw = false;
        try { listeners.find(l => l.col === 'users').cb(makeSnap([{ type: 'modified' }])); } catch (_) { threw = true; }
        ok('9l · sin #sa-panel -> no revienta', !threw);
    }
    {
        const { sandbox } = buildSandbox({ elements: { 'sa-panel': {} } });
        sandbox.saFS = async () => { throw new Error('boom'); };
        sandbox.window.saFS = sandbox.saFS;
        vm.runInContext('saFS = window.saFS;', sandbox);
        let threw = false;
        try { await sandbox.window.setupClubsSyncListener(); } catch (_) { threw = true; }
        ok('9m · fallo al inicializar -> capturado, no propaga', !threw);
    }

    console.log('\n── PARTE 10 · setupClubsSyncListener() — badge y avisos de solicitudes ──');
    {
        const { sandbox, listeners, els } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-requests': {} }, pendingCount: 3,
        });
        await sandbox.window.setupClubsSyncListener();
        const reqCb = listeners.find(l => l.col === 'platform_requests').cb;
        await reqCb(makeSnap([{ type: 'added' }], 1));
        const badge = els['sa-tab-requests'].querySelector('span');
        ok('10a · badge con el conteo COMPLETO de saCountPendingRequests (3), no el tamaño del snapshot (1)',
            badge && String(badge.textContent) === '3');
    }
    {
        const { sandbox, listeners, els } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-requests': {} }, countThrows: true,
        });
        await sandbox.window.setupClubsSyncListener();
        await listeners.find(l => l.col === 'platform_requests').cb(makeSnap([{ type: 'added' }], 7));
        const badge = els['sa-tab-requests'].querySelector('span');
        ok('10b · si saCountPendingRequests falla -> fallback a snap.size (7)', badge && String(badge.textContent) === '7');
    }
    {
        const { sandbox, listeners, els } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-requests': {} }, pendingCount: 0,
        });
        await sandbox.window.setupClubsSyncListener();
        const reqCb = listeners.find(l => l.col === 'platform_requests').cb;
        await reqCb(makeSnap([], 0));
        ok('10c · conteo 0 -> no pinta badge', els['sa-tab-requests'].querySelector('span') === null);
        await reqCb(makeSnap([], 0));
        ok('10d · llamadas repetidas -> no acumula badges duplicados', els['sa-tab-requests'].children.length === 0);
    }
    {
        const { sandbox, listeners, els } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-requests': {} }, pendingCount: 2,
        });
        await sandbox.window.setupClubsSyncListener();
        const reqCb = listeners.find(l => l.col === 'platform_requests').cb;
        await reqCb(makeSnap([], 2));
        await reqCb(makeSnap([], 2));
        ok('10e · badge se reemplaza, nunca se duplica', els['sa-tab-requests'].children.length === 1);
    }
    {
        const { sandbox, listeners, toasts, vibrations } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-requests': {} }, pendingCount: 1,
        });
        await sandbox.window.setupClubsSyncListener();
        const reqCb = listeners.find(l => l.col === 'platform_requests').cb;
        await reqCb(makeSnap([{ type: 'added', doc: { data: () => ({ requestedName: 'Ana' }) } }], 1));
        ok('10f · carga inicial -> NO avisa (sin toast ni vibración)', toasts.length === 0 && vibrations.length === 0);

        await reqCb(makeSnap([{ type: 'added', doc: { data: () => ({ requestedName: 'Ana', requestedRoleLabel: 'Entrenadora' }) } }], 2));
        ok('10g · solicitud NUEVA -> toast con nombre y rol', toasts.some(t => /Nueva solicitud: Ana \(Entrenadora\)/.test(t)));
        ok('10h · solicitud NUEVA -> vibración [200,100,200]', JSON.stringify(vibrations[0]) === '[200,100,200]');
    }
    {
        const { sandbox, listeners, toasts } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-requests': {} }, pendingCount: 1,
        });
        await sandbox.window.setupClubsSyncListener();
        const reqCb = listeners.find(l => l.col === 'platform_requests').cb;
        await reqCb(makeSnap([], 0));
        await reqCb(makeSnap([{ type: 'modified', doc: { data: () => ({ requestedName: 'Ana' }) } }], 1));
        ok('10i · cambios que no son "added" -> no avisan', toasts.length === 0);
    }
    {
        const { sandbox, listeners, timers, flushTimers } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-requests': { style: { borderBottomColor: 'rgb(88, 166, 255)' } } },
            pendingCount: 1,
        });
        await sandbox.window.setupClubsSyncListener();
        let reqRefresh = 0;
        sandbox.window.saRequests = async () => { reqRefresh++; };
        const reqCb = listeners.find(l => l.col === 'platform_requests').cb;
        await reqCb(makeSnap([], 0));
        await reqCb(makeSnap([{ type: 'added', doc: { data: () => ({ requestedEmail: 'x@x.com' }) } }], 1));
        const t = timers.find(x => x.ms === 500);
        ok('10j · con la pestaña Solicitudes activa -> programa auto-refresco a 500ms', !!t);
        await flushTimers();
        ok('10k · el auto-refresco llama a saRequests()', reqRefresh === 1);
    }
    {
        const { sandbox, listeners, timers } = buildSandbox({
            elements: { 'sa-panel': {}, 'sa-tab-requests': { style: { borderBottomColor: 'transparent' } } },
            pendingCount: 1,
        });
        await sandbox.window.setupClubsSyncListener();
        const reqCb = listeners.find(l => l.col === 'platform_requests').cb;
        await reqCb(makeSnap([], 0));
        await reqCb(makeSnap([{ type: 'added', doc: { data: () => ({ userEmail: 'x@x.com' }) } }], 1));
        ok('10l · con la pestaña Solicitudes inactiva -> NO auto-refresca', !timers.some(x => x.ms === 500));
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();

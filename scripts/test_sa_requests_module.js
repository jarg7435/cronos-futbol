// ─────────────────────────────────────────────────────────────────────────
// test_sa_requests_module.js · Refactor de monolitos (auditoría 2026-07-22)
// PASO 10: extracción de "Solicitudes/Aprobación" (saCountPendingRequests /
// saRequests / saApproveRequest) desde js/admin/superadmin/superadmin.panel.js
// a su propio archivo (js/admin/superadmin/requests-tab.js).
//
// ⚠️ CONTEXTO IMPRESCINDIBLE PARA LEER ESTE TEST ⚠️
// window.saRequests tiene TRES definiciones apiladas en esta app:
//   1. js/core/app-init.js  — panel SuperAdmin legacy (queda pisada).
//   2. superadmin.panel.js  — la que se mueve aquí (pisa a la anterior).
//   3. js/admin/superadmin/extras.js:217 `patchSaRequests()` — la REEMPLAZA
//      por completo ~600ms despues de DOMContentLoaded (via patchOpenSA,
//      setTimeout 600/1400). Captura `var orig = window.saRequests` pero
//      SOLO la usa como guarda (`if (!orig || orig._p25req) return;`);
//      NUNCA la invoca.
// Consecuencia: la saRequests de este archivo NO se ejecuta en produccion, y
// como los 8 onclick que llaman a saApproveRequest viven dentro del HTML que
// ella genera (y extras.js no menciona saApproveRequest ni una vez),
// saApproveRequest tampoco se ejecuta. ~800 de las 843 lineas son codigo
// muerto de facto.
//
// PERO ES CODIGO PORTANTE: si window.saRequests no existiese cuando corre
// patchSaRequests(), el parche aborta en su guarda y la pestana Solicitudes
// se queda SIN NINGUNA implementacion. Por eso se mueve tal cual, sin borrar
// nada — igual que saActivateIndividual en el paso 8. La parte 1 de este
// test fija ambas condiciones de orden de carga.
//
// saCountPendingRequests SI esta viva: la usan openSuperAdminPanel y
// clubs-tab.js (badge del tab Solicitudes).
//
// ── DOS BUGS LATENTES PREEXISTENTES, DOCUMENTADOS NO CORREGIDOS ──
// Se descubrieron leyendo el codigo para escribir este test. Ambos viven en
// las ramas muertas, asi que hoy no se manifiestan en produccion. El mandato
// de este refactor es cambio-cero de comportamiento, asi que el test fija el
// comportamiento REAL (con bug) para demostrar que el movimiento es
// mecanico. Ver partes 8a-8c.
//   BUG-1 (linea ~782): en la rama user_request/individual, `_indEntityId3`
//     se declara con const DENTRO del `if (uSnap3.exists())` pero se lee
//     FUERA, en el try de setCustomClaims -> ReferenceError capturado por
//     `catch (claimErr3)`. Efecto: a ese admin individual NUNCA se le
//     asignan custom claims (silenciosamente).
//   BUG-2 (lineas ~889-891): la rama user_request/"otros roles" usa
//     getDocs/query/collection/where, que NO estan en el destructuring de
//     saFS() de la linea 525 (si lo estan en otras ramas) ni existen como
//     globales -> ReferenceError capturado por el catch general. Efecto: el
//     usuario SI queda activado (updateDoc previo), pero las
//     platform_requests no se marcan aprobadas, se muestra un toast de error
//     en vez del de exito, y no se refresca la vista.
//
// Coupling verificado: FAN-IN de saCountPendingRequests = openSuperAdminPanel
// (se queda) + clubs-tab.js:374 (window.*, tiempo de llamada). FAN-IN de
// saRequests = saTab (se queda), clubs-tab.js:409, extras.js (guarda).
// FAN-IN de saApproveRequest = solo el HTML de la propia saRequests.
// FAN-OUT: saFS, _saToast/_saShowSpinner/_saHideSpinner, window.ROLE_META,
// window._cronosCurrentUser, saSetClubUserStatus (se queda, tiempo de click),
// httpsCallable(fa.functions,'setCustomClaims'/'deleteAuthUser') y un
// import() dinamico puntual. Todo en tiempo de llamada.
//
// Cero solapamiento con el WIP sin commitear: los hunks de git diff empiezan
// en la linea 1143 (saSetClubUserStatus) y siguen en Mensajeria SA; el bloque
// 255-1098 no tiene ninguno. Verificado con `git diff -U0` antes de escribir.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EXTRACTED = path.join(ROOT, 'js', 'admin', 'superadmin', 'requests-tab.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED
    ? EXTRACTED
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Solicitudes/Aprobación — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Extracción del bloque ═════════════════════════════
function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    if (IS_EXTRACTED) return src;
    const s = src.indexOf('window.saCountPendingRequests = async function');
    if (s === -1) throw new Error('No se encontró saCountPendingRequests en ' + SOURCE);
    const e = src.indexOf('// saSetClubUserStatus()', s);
    const cut = e === -1 ? src.slice(s) : src.slice(s, e);
    // recortar la cabecera de comentarios de la seccion siguiente
    return cut.slice(0, cut.lastIndexOf('};') + 2);
}
const BLOCK = readBlock();

function buildSandbox({
    users = {}, platformRequests = {}, successionRequests = {}, clubs = {},
    currentUserEmail = 'sa@cronos.app', confirmReturns = true,
    withFunctions = true, getDocsThrows = null, callableThrows = null,
} = {}) {
    const stores = { users, platform_requests: platformRequests, succession_requests: successionRequests, clubs };
    const writes = [];        // {op, col, id, data}
    const callables = [];     // {name, payload}
    const toasts = [];
    const spinners = [];
    const body = { innerHTML: '' };

    const matches = (data, clauses) => (clauses || []).every(c => {
        if (!c || c.__where !== true) return true;
        return data[c.field] === c.value;
    });

    const fns = {
        db: {},
        fa: { functions: withFunctions ? {} : null },
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async (ref) => {
            const d = (stores[ref.__col] || {})[ref.__id];
            return { exists: () => d !== undefined, data: () => d };
        },
        setDoc: async (ref, data) => {
            writes.push({ op: 'set', col: ref.__col, id: ref.__id, data });
            (stores[ref.__col] = stores[ref.__col] || {})[ref.__id] = Object.assign({}, data);
        },
        updateDoc: async (ref, data) => {
            writes.push({ op: 'update', col: ref.__col, id: ref.__id, data });
            const st = stores[ref.__col] || {};
            if (st[ref.__id]) Object.assign(st[ref.__id], data);
        },
        deleteDoc: async (ref) => {
            writes.push({ op: 'delete', col: ref.__col, id: ref.__id });
            if (stores[ref.__col]) delete stores[ref.__col][ref.__id];
        },
        collection: (db, col) => ({ __col: col }),
        query: (ref, ...clauses) => ({ __col: ref.__col, __clauses: clauses }),
        where: (field, op, value) => ({ __where: true, field, op, value }),
        getDocs: async (ref) => {
            if (getDocsThrows) throw new Error(getDocsThrows);
            const st = stores[ref.__col] || {};
            const rows = Object.entries(st).filter(([, d]) => matches(d, ref.__clauses));
            return { forEach: (cb) => rows.forEach(([id, d]) => cb({ id, data: () => d })) };
        },
        orderBy: (f) => ({ __orderBy: f }),
        onSnapshot: () => () => {},
        serverTimestamp: () => 'TS',
        httpsCallable: (functions, name) => async (payload) => {
            if (callableThrows) throw new Error(callableThrows);
            callables.push({ name, payload });
            return { data: {} };
        },
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: currentUserEmail ? { email: currentUserEmail } : undefined,
            ROLE_META: {
                club_admin:  { icon: '🏅', color: '#58a6ff', label: 'Admin. de Club' },
                individual:  { icon: '👤', color: '#79c0ff', label: 'Admin. Individual' },
                director:    { icon: '📋', color: '#f0883e', label: 'Director Deportivo' },
                coordinator: { icon: '🎯', color: '#d2a8ff', label: 'Coordinador' },
                user:        { icon: '⚙️', color: '#58a6ff', label: 'Entrenador' },
                parent:      { icon: '👨‍👩‍👧', color: '#79c0ff', label: 'Padre/Madre' },
            },
        },
        document: { getElementById: (id) => (id === 'sa-body' ? body : null) },
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        saFS: async () => fns,
        __fakeFirestoreModule: {
            collection: fns.collection, getDocs: fns.getDocs,
            query: fns.query, where: fns.where, updateDoc: fns.updateDoc,
        },
    };
    sandbox.window.saFS = sandbox.saFS;
    vm.createContext(sandbox);

    // OJO: NO se inyectan collection/getDocs/query/where como variables del
    // sandbox — hacerlo enmascararia BUG-2 y el test dejaria de describir lo
    // que hace el navegador de verdad.
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
    // Delegadores (tecnica del paso 9): los nombres "pelados" deben resolver
    // contra window EN TIEMPO DE LLAMADA, para poder espiarlos desde el test.
    const forwards = `
        var saRequests = function() { return window.saRequests.apply(null, arguments); };
        var saApproveRequest = function() { return window.saApproveRequest.apply(null, arguments); };
    `;
    sandbox.__spinners = spinners;
    sandbox.__toasts = toasts;

    const code = BLOCK.replace(
        /await import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js'\)/g,
        '__fakeFirestoreModule'
    );
    vm.runInContext(stubs + code + forwards, sandbox);

    return { sandbox, stores, writes, callables, toasts, spinners, body };
}

const wrote = (writes, col, id) => writes.filter(w => w.col === col && w.id === id);
const lastWrite = (writes, col, id) => wrote(writes, col, id).slice(-1)[0];

(async () => {
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');

    console.log('── PARTE 1 · estructura y orden de carga ──');
    ok('1a · saCountPendingRequests existe', /window\.saCountPendingRequests\s*=\s*async function/.test(rawSrc));
    ok('1b · saRequests existe', /window\.saRequests\s*=\s*async function/.test(rawSrc));
    ok('1c · saApproveRequest existe', /window\.saApproveRequest\s*=\s*async function/.test(rawSrc));
    {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const appInit = idxHtml.indexOf('js/core/app-init.js');
        const extras = idxHtml.indexOf('js/admin/superadmin/extras.js');
        const tag = IS_EXTRACTED ? 'js/admin/superadmin/requests-tab.js' : 'js/admin/superadmin/superadmin.panel.js';
        const target = idxHtml.indexOf(tag);
        ok('1d · saRequests se define DESPUÉS de app-init.js (que tiene una saRequests legacy)',
            appInit !== -1 && target !== -1 && target > appInit, { appInit, target });
        ok('1e · saRequests se define ANTES de extras.js (que la reemplaza y exige que exista)',
            extras !== -1 && target < extras, { target, extras });
    }
    {
        const ex = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'extras.js'), 'utf8');
        ok('1f · extras.js sigue reemplazando saRequests con la guarda documentada',
            /var orig = window\.saRequests;[\s\S]{0,80}if \(!orig \|\| orig\._p25req\) return;/.test(ex));
        const patchBody = ex.slice(ex.indexOf('function patchSaRequests'), ex.indexOf('_p25req = true'));
        // `orig` aparece 3 veces, TODAS en la guarda: `var orig = …`, `!orig`
        // y `orig._p25req`. Lo determinante es que nunca se invoque.
        ok('1g · el reemplazo NO delega en la original (orig nunca se invoca)',
            !/orig\s*\(|orig\.(apply|call|bind)\s*\(/.test(patchBody)
            && (patchBody.match(/\borig\b/g) || []).length === 3,
            (patchBody.match(/\borig\b/g) || []).length);
        if (IS_EXTRACTED) {
            const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
            ok('1h · requests-tab.js está en el precache de sw.js', sw.includes('js/admin/superadmin/requests-tab.js'));
        }
    }

    console.log('\n── PARTE 2 · saCountPendingRequests() — las 6 fuentes ──');
    {
        const { sandbox } = buildSandbox({
            users: {
                u1: { status: 'pending', email: 'a@x.com' },
                u2: { status: 'pending_sa', email: 'b@x.com' },
                u3: { status: 'pending_individual', email: 'c@x.com', isIndividual: true },
                u4: { status: 'pending_individual', email: 'd@x.com' },
                u5: { status: 'active', email: 'e@x.com' },
            },
            platformRequests: {
                p1: { status: 'pending_sa', type: 'ind_sub_registration', requestedRole: 'user' },
                p2: { status: 'pending_sa', type: 'self_registration', requestedRole: 'club_admin' },
                q1: { status: 'unread', type: 'quota_increase' },
            },
            successionRequests: { s1: { status: 'pending_sa' } },
        });
        const n = await sandbox.window.saCountPendingRequests();
        ok('2a · cuenta 6 (3 directos + 1 reenviada + 1 cuota + 1 sucesión; 1 duplicada excluida)', n === 6, n);
    }
    {
        const { sandbox } = buildSandbox({
            users: { u1: { status: 'pending', email: 'a@x.com' } },
        });
        const n = await sandbox.window.saCountPendingRequests();
        ok('2b · usuario pending simple -> 1', n === 1, n);
    }
    {
        // el mismo doc no puede contarse dos veces (dedup por id)
        const { sandbox } = buildSandbox({ users: { u1: { status: 'pending' } } });
        const n = await sandbox.window.saCountPendingRequests();
        ok('2c · deduplicación por id de documento', n === 1, n);
    }
    {
        const { sandbox } = buildSandbox({
            users: { u4: { status: 'pending_individual', email: 'd@x.com', role: 'user' } },
        });
        const n = await sandbox.window.saCountPendingRequests();
        ok('2d · pending_individual que NO es de ente individual -> no cuenta', n === 0, n);
    }
    {
        for (const marca of ['individualEntityId', 'individualOwnerId', 'isIndividual']) {
            const { sandbox } = buildSandbox({
                users: { u: Object.assign({ status: 'pending_individual' }, { [marca]: marca === 'isIndividual' ? true : 'ent1' }) },
            });
            const n = await sandbox.window.saCountPendingRequests();
            ok('2e · pending_individual marcado por ' + marca + ' -> cuenta', n === 1, n);
        }
        for (const rol of ['individual', 'admin_individual']) {
            const { sandbox } = buildSandbox({ users: { u: { status: 'pending_individual', role: rol } } });
            const n = await sandbox.window.saCountPendingRequests();
            ok('2f · pending_individual con rol ' + rol + ' -> cuenta', n === 1, n);
        }
    }
    {
        const { sandbox } = buildSandbox({
            platformRequests: {
                p1: { status: 'pending_sa', type: 'self_registration', requestedRole: 'club_admin' },
                p2: { status: 'pending_sa', type: 'ind_admin_registration', requestedRole: 'individual' },
                p3: { status: 'pending_sa', type: 'self_registration', requestedRole: 'user' },
            },
        });
        const n = await sandbox.window.saCountPendingRequests();
        ok('2g · excluye self/ind_admin_registration de club_admin/individual (ya contados como directos), no las demás', n === 1, n);
    }
    {
        const { sandbox } = buildSandbox({ getDocsThrows: 'permission-denied' });
        const n = await sandbox.window.saCountPendingRequests();
        ok('2h · fallo de todas las fuentes -> devuelve 0 sin lanzar', n === 0, n);
    }
    {
        const { sandbox } = buildSandbox({});
        sandbox.saFS = async () => { throw new Error('sin-red'); };
        sandbox.window.saFS = sandbox.saFS;
        vm.runInContext('saFS = window.saFS;', sandbox);
        const n = await sandbox.window.saCountPendingRequests();
        ok('2i · fallo global -> catch devuelve 0', n === 0, n);
    }

    console.log('\n── PARTE 3 · saRequests() — render de las cuatro secciones ──');
    {
        const { sandbox, body } = buildSandbox({});
        await sandbox.window.saRequests();
        ok('3a · sin nada pendiente -> "Sin solicitudes pendientes."', /Sin solicitudes pendientes\./.test(body.innerHTML));
    }
    {
        const { sandbox, body } = buildSandbox({
            users: { u1: { status: 'pending', email: 'coach@x.com', role: 'user', clubName: 'Club A', createdAt: '2026-07-01T10:00:00Z' } },
        });
        await sandbox.window.saRequests();
        const h = body.innerHTML;
        ok('3b · cabecera "Registros pendientes" con contador', /Registros pendientes de aprobación SA[\s\S]{0,200}>1</.test(h));
        ok('3c · muestra email y club', /coach@x\.com/.test(h) && /Club A/.test(h));
        ok('3d · botones cableados a direct_user', /saApproveRequest\('u1','direct_user',true\)/.test(h) && /saApproveRequest\('u1','direct_user',false\)/.test(h));
        ok('3e · rol no-admin -> "Registro — SA confirma"', /Registro — SA confirma/.test(h));
    }
    {
        const { sandbox, body } = buildSandbox({
            users: { u1: { status: 'pending', email: 'adm@x.com', role: 'club_admin', requestedQuotas: { directors: 2, coordinators: 3, coaches: 8, parents: 40 } } },
        });
        await sandbox.window.saRequests();
        const h = body.innerHTML;
        ok('3f · club_admin -> "Aprobación directa SA"', /Aprobación directa SA/.test(h));
        ok('3g · muestra las cuotas pedidas', /2 Dir\. · 3 Coord\. · 8 Entr\. · 40 Padres/.test(h));
    }
    {
        const { sandbox, body } = buildSandbox({
            platformRequests: { p1: { status: 'pending_sa', type: 'ind_sub_registration', requestedRole: 'user', requestedEmail: 'r@x.com', requestedName: 'Rita' } },
        });
        await sandbox.window.saRequests();
        const h = body.innerHTML;
        ok('3h · sección "Solicitudes reenviadas"', /Solicitudes reenviadas/.test(h));
        ok('3i · botones cableados a user_request', /saApproveRequest\('p1','user_request',true\)/.test(h));
        ok('3j · ind_sub_registration -> aviso de Admin Individual', /Admin Individual<\/strong> se activan directamente/.test(h));
    }
    {
        const { sandbox, body } = buildSandbox({
            platformRequests: { q1: { status: 'unread', type: 'quota_increase', role: 'user', clubName: 'Club Q', requestedExtra: 3, currentUsed: 8, currentMax: 10 } },
        });
        await sandbox.window.saRequests();
        const h = body.innerHTML;
        ok('3k · sección "Ampliaciones de cuota" con datos', /Ampliaciones de cuota/.test(h) && /Club Q/.test(h) && /8\/10/.test(h));
        ok('3l · botones cableados a quota_increase', /saApproveRequest\('q1','quota_increase',true\)/.test(h));
    }
    {
        const { sandbox, body } = buildSandbox({
            platformRequests: { q1: { status: 'unread', type: 'quota_increase', role: 'user', clubId: 'c1', currentMax: -1 } },
        });
        await sandbox.window.saRequests();
        ok('3m · cuota ilimitada se muestra como ∞', /\/∞/.test(body.innerHTML));
    }
    {
        const { sandbox, body } = buildSandbox({
            successionRequests: { s1: { status: 'pending_sa', clubName: 'Club S', successorType: 'existing', outgoingAdminEmail: 'old@x.com', successorEmail: 'new@x.com', successorName: 'Nuevo' } },
        });
        await sandbox.window.saRequests();
        const h = body.innerHTML;
        ok('3n · sección "Sucesiones de Admin de Club"', /Sucesiones de Admin de Club/.test(h));
        ok('3o · muestra admin saliente y entrante', /old@x\.com/.test(h) && /new@x\.com/.test(h));
        ok('3p · successorType existing -> "Miembro existente"', /Miembro existente/.test(h));
        ok('3q · botones cableados a club_admin_succession', /saApproveRequest\('s1','club_admin_succession',true\)/.test(h));
    }
    {
        const { sandbox, body } = buildSandbox({
            successionRequests: { s1: { status: 'pending_sa', successorType: 'new', successorEmail: 'n@x.com' } },
        });
        await sandbox.window.saRequests();
        ok('3r · successorType new -> "Persona nueva"', /Persona nueva/.test(body.innerHTML));
    }
    {
        const { sandbox, body } = buildSandbox({
            users: { u1: { status: 'pending_sa', email: 'x@x.com', role: 'user' } },
            platformRequests: { p1: { status: 'pending_sa', type: 'self_registration', requestedRole: 'club_admin', requestedEmail: 'dup@x.com' } },
        });
        await sandbox.window.saRequests();
        ok('3s · self_registration de club_admin no se duplica como reenviada', !/Solicitudes reenviadas/.test(body.innerHTML));
    }
    {
        const { sandbox, body } = buildSandbox({ getDocsThrows: null });
        sandbox.saFS = async () => { throw new Error('boom-fs'); };
        sandbox.window.saFS = sandbox.saFS;
        vm.runInContext('saFS = window.saFS;', sandbox);
        await sandbox.window.saRequests();
        ok('3t · error -> mensaje capturado, sin excepción', /boom-fs/.test(body.innerHTML));
    }
    {
        const { sandbox } = buildSandbox({});
        sandbox.document.getElementById = () => null;
        let threw = false;
        try { await sandbox.window.saRequests(); } catch (_) { threw = true; }
        ok('3u · sin #sa-body -> retorna sin reventar', !threw);
    }

    console.log('\n── PARTE 4 · saApproveRequest() — direct_user ──');
    {
        const { sandbox, writes } = buildSandbox({
            confirmReturns: false, users: { u1: { role: 'user', email: 'a@x.com' } },
        });
        await sandbox.window.saApproveRequest('u1', 'direct_user', true);
        ok('4a · confirm cancelado -> ninguna escritura', writes.length === 0);
    }
    {
        const { sandbox, writes, callables, toasts, stores } = buildSandbox({
            users: { u1: { role: 'club_admin', email: 'adm@x.com', requestedClubName: 'Nuevo CF', requestedQuotas: { directors: 3, coaches: 15 }, allRoles: [{ role: 'club_admin', isAuthorized: false }] } },
        });
        await sandbox.window.saApproveRequest('u1', 'direct_user', true);
        const clubId = Object.keys(stores.clubs)[0];
        const club = stores.clubs[clubId];
        ok('4b · club_admin -> crea el club con nombre y admin', !!club && club.name === 'Nuevo CF' && club.adminUid === 'u1');
        ok('4c · slots desde requestedQuotas, con defaults donde falten', club.slots.directors === 3 && club.slots.users === 15 && club.slots.coordinators === 2 && club.slots.parents === 20);
        const u = lastWrite(writes, 'users', 'u1');
        ok('4d · activa al usuario y le asigna el club', u.data.isAuthorized === true && u.data.status === 'active' && u.data.clubId === clubId);
        ok('4e · marca el rol club_admin de allRoles como activo', u.data.allRoles.some(r => r.role === 'club_admin' && r.isAuthorized === true && r.clubId === clubId));
        ok('4f · asigna custom claims de club_admin', callables.some(c => c.name === 'setCustomClaims' && c.payload.role === 'club_admin' && c.payload.clubId === clubId));
        ok('4g · toast de éxito con el nombre del club', toasts.some(t => /Nuevo CF/.test(t) && /Administrador/.test(t)));
    }
    {
        const { sandbox, callables, toasts } = buildSandbox({
            withFunctions: false,
            users: { u1: { role: 'club_admin', email: 'adm@x.com', requestedClubName: 'Sin Funcs', allRoles: [] } },
        });
        await sandbox.window.saApproveRequest('u1', 'direct_user', true);
        ok('4h · sin fa.functions -> no llama a claims pero completa la aprobación', callables.length === 0 && toasts.some(t => /Sin Funcs/.test(t)));
    }
    {
        const { sandbox, toasts } = buildSandbox({
            callableThrows: 'claims-down',
            users: { u1: { role: 'club_admin', email: 'adm@x.com', requestedClubName: 'Con Fallo', allRoles: [] } },
        });
        await sandbox.window.saApproveRequest('u1', 'direct_user', true);
        ok('4i · fallo de setCustomClaims no bloquea la aprobación', toasts.some(t => /Con Fallo/.test(t)));
    }
    {
        const { sandbox, writes, callables, toasts } = buildSandbox({
            users: { u1: { role: 'individual', email: 'ind@x.com', individualEntityId: 'ent1', displayName: 'Ind Uno', allRoles: [{ role: 'admin_individual', isAuthorized: false }] } },
            clubs: { ent1: { name: 'Ente', hasAdmin: false } },
            platformRequests: { pr1: { userUid: 'u1', status: 'pending_sa' } },
        });
        await sandbox.window.saApproveRequest('u1', 'direct_user', true);
        const u = wrote(writes, 'users', 'u1')[0];
        ok('4j · individual -> normaliza role a "individual" y activa', u.data.role === 'individual' && u.data.status === 'active');
        ok('4k · propaga entityId a clubId/individualEntityId/individualOwnerId', u.data.clubId === 'ent1' && u.data.individualOwnerId === 'ent1');
        ok('4l · marca hasAdmin en la entidad', !!lastWrite(writes, 'clubs', 'ent1') && lastWrite(writes, 'clubs', 'ent1').data.hasAdmin === true);
        ok('4m · asigna claims de individual', callables.some(c => c.payload.role === 'individual' && c.payload.clubId === 'ent1'));
        ok('4n · marca sus platform_requests como sa_approved (import dinámico)', !!lastWrite(writes, 'platform_requests', 'pr1') && lastWrite(writes, 'platform_requests', 'pr1').data.status === 'sa_approved');
        ok('4o · toast de Administrador Individual', toasts.some(t => /Administrador Individual/.test(t)));
    }
    {
        const { sandbox, writes, toasts } = buildSandbox({
            users: { u1: { role: 'user', email: 'sub@x.com', individualOwnerId: 'ent1', allRoles: [{ role: 'user', isAuthorized: false }] } },
        });
        await sandbox.window.saApproveRequest('u1', 'direct_user', true);
        const u = lastWrite(writes, 'users', 'u1');
        ok('4p · usuario bajo ente individual -> activación directa (no pending_club)', u.data.status === 'active' && u.data.isAuthorized === true);
        ok('4q · toast de activación directa', toasts.some(t => /activado directamente/.test(t)));
    }
    {
        const { sandbox, writes, toasts } = buildSandbox({
            users: { u1: { role: 'user', email: 'club@x.com', clubId: 'c1' } },
        });
        await sandbox.window.saApproveRequest('u1', 'direct_user', true);
        const u = lastWrite(writes, 'users', 'u1');
        ok('4r · usuario de club normal -> pending_club (el Club Admin confirma)', u.data.status === 'pending_club' && u.data.approvedBySA === true);
        ok('4s · toast indica confirmación del Club Admin', toasts.some(t => /Club Admin debe confirmar/.test(t)));
    }
    {
        const { sandbox, writes, toasts } = buildSandbox({ users: { u1: { role: 'user', email: 'r@x.com' } } });
        await sandbox.window.saApproveRequest('u1', 'direct_user', false);
        const u = lastWrite(writes, 'users', 'u1');
        ok('4t · rechazo -> status rejected + isAuthorized false', u.data.status === 'rejected' && u.data.isAuthorized === false);
        ok('4u · toast de rechazo', toasts.some(t => /rechazada/.test(t)));
    }
    {
        const { sandbox, toasts } = buildSandbox({ users: {} });
        await sandbox.window.saApproveRequest('no-existe', 'direct_user', true);
        ok('4v · usuario inexistente -> error capturado en toast', toasts.some(t => /Usuario no encontrado/.test(t)));
    }

    console.log('\n── PARTE 5 · saApproveRequest() — user_request ──');
    {
        const { sandbox, writes, callables, stores, toasts } = buildSandbox({
            platformRequests: { p1: { requestedRole: 'club_admin', requestedClubName: 'CF Reenviado', requestedEmail: 'ca@x.com', userUid: 'u9', requestedQuotas: {} } },
            users: { u9: { email: 'ca@x.com', allRoles: [{ role: 'club_admin', isAuthorized: false }] } },
        });
        await sandbox.window.saApproveRequest('p1', 'user_request', true);
        const clubId = Object.keys(stores.clubs)[0];
        ok('5a · crea el club solicitado', !!clubId && stores.clubs[clubId].name === 'CF Reenviado');
        ok('5b · activa al usuario existente con el nuevo clubId', lastWrite(writes, 'users', 'u9').data.clubId === clubId);
        ok('5c · marca la solicitud como sa_approved', lastWrite(writes, 'platform_requests', 'p1').data.status === 'sa_approved');
        ok('5d · asigna claims de club_admin', callables.some(c => c.payload.role === 'club_admin' && c.payload.uid === 'u9'));
        ok('5e · toast de éxito', toasts.some(t => /CF Reenviado/.test(t)));
    }
    {
        const { sandbox, writes, toasts } = buildSandbox({
            platformRequests: { p1: { requestedRole: 'individual', requestedEmail: 'i@x.com', userUid: 'u8' } },
            users: { u8: { email: 'i@x.com', individualEntityId: 'ent9', allRoles: [{ role: 'individual', isAuthorized: false }] } },
            clubs: { ent9: { name: 'Ente 9' } },
        });
        await sandbox.window.saApproveRequest('p1', 'user_request', true);
        const u = wrote(writes, 'users', 'u8')[0];
        ok('5f · individual vía solicitud -> normaliza y activa', u.data.role === 'individual' && u.data.status === 'active');
        ok('5g · marca hasAdmin en la entidad', !!lastWrite(writes, 'clubs', 'ent9') && lastWrite(writes, 'clubs', 'ent9').data.hasAdmin === true);
        ok('5h · marca la solicitud como sa_approved', lastWrite(writes, 'platform_requests', 'p1').data.status === 'sa_approved');
        ok('5i · toast de Administrador Individual', toasts.some(t => /Administrador Individual/.test(t)));
    }
    {
        const { sandbox, writes, toasts } = buildSandbox({
            platformRequests: { p1: { requestedRole: 'user', requestedEmail: 'nuevo@x.com', requestedName: 'Nuevo', userUid: 'u7', clubId: 'c1', clubName: 'Club C' } },
            users: {},
        });
        await sandbox.window.saApproveRequest('p1', 'user_request', true);
        const created = wrote(writes, 'users', 'u7').find(w => w.op === 'set');
        ok('5j · usuario inexistente -> crea el doc activo con setDoc', !!created && created.data.status === 'active' && created.data.isAuthorized === true);
        ok('5k · el doc creado lleva rol, club y allRoles coherentes', created.data.role === 'user' && created.data.clubId === 'c1' && created.data.allRoles[0].role === 'user');
        ok('5l · BUG-2 alcanza también a este sub-camino: la solicitud NO se marca sa_approved',
            !wrote(writes, 'platform_requests', 'p1').some(w => w.data && w.data.status === 'sa_approved'));
        ok('5m · BUG-2: termina en toast de error, no en el del rol ("Entrenador")',
            toasts.some(t => /^⚠️ Error: /.test(t)) && !toasts.some(t => /activado como Entrenador/.test(t)), toasts);
    }
    {
        const { sandbox, writes, toasts } = buildSandbox({
            platformRequests: { p1: { requestedRole: 'user', requestedEmail: 'x@x.com', userUid: 'u6', clubId: 'c1' } },
            users: { u6: { email: 'x@x.com', allRoles: [] } },
        });
        await sandbox.window.saApproveRequest('p1', 'user_request', true);
        const u = wrote(writes, 'users', 'u6')[0];
        ok('5n · usuario existente -> añade el rol aprobado a allRoles', !!u && u.data.allRoles.some(r => r.role === 'user' && r.isAuthorized === true));
        ok('5o · lo deja activo', u.data.status === 'active' && u.data.isAuthorized === true);
    }
    {
        const { sandbox, writes, toasts } = buildSandbox({
            platformRequests: { p1: { requestedRole: 'user', requestedEmail: 'x@x.com' } },
        });
        await sandbox.window.saApproveRequest('p1', 'user_request', true);
        ok('5p · solicitud sin userUid -> status error_no_uid + aviso', lastWrite(writes, 'platform_requests', 'p1').data.status === 'error_no_uid' && toasts.some(t => /sin userUid/.test(t)));
    }
    {
        const { sandbox, writes, toasts } = buildSandbox({
            platformRequests: { p1: { requestedRole: 'user', userUid: 'u5' } },
        });
        await sandbox.window.saApproveRequest('p1', 'user_request', false);
        ok('5q · rechazo -> status rejected', lastWrite(writes, 'platform_requests', 'p1').data.status === 'rejected' && toasts.some(t => /rechazada/.test(t)));
    }
    {
        const { sandbox, toasts } = buildSandbox({ platformRequests: {} });
        await sandbox.window.saApproveRequest('nope', 'user_request', true);
        ok('5r · solicitud inexistente -> error capturado', toasts.some(t => /Solicitud no encontrada/.test(t)));
    }

    console.log('\n── PARTE 6 · saApproveRequest() — quota_increase ──');
    {
        const { sandbox, writes, toasts } = buildSandbox({
            platformRequests: { q1: { type: 'quota_increase', role: 'user', clubId: 'c1', requestedExtra: 5 } },
            clubs: { c1: { slots: { users: 10, parents: 20 } } },
        });
        await sandbox.window.saApproveRequest('q1', 'quota_increase', true);
        const c = lastWrite(writes, 'clubs', 'c1');
        ok('6a · suma el extra al slot del rol correspondiente', c.data.slots.users === 15);
        ok('6b · no toca los demás slots', c.data.slots.parents === 20);
        ok('6c · marca la solicitud como approved', lastWrite(writes, 'platform_requests', 'q1').data.status === 'approved');
        ok('6d · toast con el número de plazas', toasts.some(t => /\+5 plaza/.test(t)));
    }
    {
        const { sandbox, writes } = buildSandbox({
            platformRequests: { q1: { type: 'quota_increase', role: 'director', clubId: 'c1' } },
            clubs: { c1: { slots: { directors: 1 } } },
        });
        await sandbox.window.saApproveRequest('q1', 'quota_increase', true);
        ok('6e · mapea director->directors y usa +1 por defecto', lastWrite(writes, 'clubs', 'c1').data.slots.directors === 2);
    }
    {
        const { sandbox, writes } = buildSandbox({
            platformRequests: { q1: { type: 'quota_increase', role: 'user', clubId: 'c1', requestedExtra: 3 } },
            clubs: { c1: { slots: { users: -1 } } },
        });
        await sandbox.window.saApproveRequest('q1', 'quota_increase', true);
        ok('6f · slot ilimitado (-1) no se modifica', lastWrite(writes, 'clubs', 'c1').data.slots.users === -1);
    }
    {
        const { sandbox, writes } = buildSandbox({
            platformRequests: { q1: { type: 'quota_increase', role: 'user', clubId: 'inexistente' } },
        });
        await sandbox.window.saApproveRequest('q1', 'quota_increase', true);
        ok('6g · club inexistente -> aun así marca la solicitud como approved', lastWrite(writes, 'platform_requests', 'q1').data.status === 'approved');
    }
    {
        const { sandbox, writes } = buildSandbox({
            platformRequests: { q1: { type: 'quota_increase', role: 'user', clubId: 'c1' } },
            clubs: { c1: { slots: { users: 10 } } },
        });
        await sandbox.window.saApproveRequest('q1', 'quota_increase', false);
        ok('6h · rechazo -> status rejected y NO toca los slots', lastWrite(writes, 'platform_requests', 'q1').data.status === 'rejected' && wrote(writes, 'clubs', 'c1').length === 0);
    }

    console.log('\n── PARTE 7 · saApproveRequest() — club_admin_succession ──');
    {
        const { sandbox, writes, callables, toasts } = buildSandbox({
            successionRequests: { s1: { clubId: 'c1', clubName: 'Club S', successorType: 'existing', successorUid: 'nuevo', successorEmail: 'new@x.com', outgoingAdminUid: 'viejo', outgoingAdminEmail: 'old@x.com' } },
            users: {
                nuevo: { email: 'new@x.com', displayName: 'Nuevo Admin', allRoles: [{ role: 'user', clubId: 'c1' }] },
                viejo: { email: 'old@x.com', role: 'club_admin' },
            },
            clubs: { c1: { name: 'Club S' } },
        });
        await sandbox.window.saApproveRequest('s1', 'club_admin_succession', true);
        const u = lastWrite(writes, 'users', 'nuevo');
        ok('7a · miembro existente -> pasa a club_admin activo', u.data.role === 'club_admin' && u.data.status === 'active' && u.data.clubId === 'c1');
        ok('7b · conserva sus roles previos y añade club_admin', u.data.allRoles.some(r => r.role === 'user') && u.data.allRoles.some(r => r.role === 'club_admin' && r.isAuthorized === true));
        const c = lastWrite(writes, 'clubs', 'c1');
        ok('7c · actualiza el club con el nuevo admin', c.data.adminUid === 'nuevo' && c.data.adminEmail === 'new@x.com' && c.data.adminName === 'Nuevo Admin');
        ok('7d · borra el doc del admin saliente', writes.some(w => w.op === 'delete' && w.col === 'users' && w.id === 'viejo'));
        ok('7e · llama a deleteAuthUser para el saliente', callables.some(c2 => c2.name === 'deleteAuthUser' && c2.payload.uid === 'viejo'));
        ok('7f · marca la sucesión como completed', lastWrite(writes, 'succession_requests', 's1').data.status === 'completed');
        ok('7g · toast con el nuevo admin y el club', toasts.some(t => /new@x\.com/.test(t) && /Club S/.test(t)));
    }
    {
        const { sandbox, writes, stores } = buildSandbox({
            successionRequests: { s1: { clubId: 'c1', clubName: 'Club N', successorType: 'new', successorEmail: 'alta@x.com', successorName: 'Alta Nueva' } },
            clubs: { c1: { name: 'Club N' } },
        });
        await sandbox.window.saApproveRequest('s1', 'club_admin_succession', true);
        const created = writes.find(w => w.op === 'set' && w.col === 'users');
        ok('7h · persona nueva -> crea doc pre-aprobado con id pre_*', !!created && /^pre_/.test(created.id));
        ok('7i · el doc nuevo es club_admin activo del club', created.data.role === 'club_admin' && created.data.status === 'active' && created.data.clubId === 'c1');
        ok('7j · queda marcado como aprobado por el SA', created.data.approvedBySA === true);
        ok('7k · el club apunta al nuevo uid', lastWrite(writes, 'clubs', 'c1').data.adminUid === created.id);
    }
    {
        const { sandbox, writes, callables } = buildSandbox({
            successionRequests: { s1: { clubId: 'c1', successorType: 'new', successorEmail: 'a@x.com' } },
            clubs: { c1: {} },
        });
        await sandbox.window.saApproveRequest('s1', 'club_admin_succession', true);
        ok('7l · sin admin saliente -> no borra ni llama a deleteAuthUser', !writes.some(w => w.op === 'delete') && !callables.some(c => c.name === 'deleteAuthUser'));
    }
    {
        const { sandbox, toasts } = buildSandbox({
            successionRequests: { s1: { clubId: 'c1', successorType: 'existing', successorUid: 'fantasma' } },
            users: {},
        });
        await sandbox.window.saApproveRequest('s1', 'club_admin_succession', true);
        ok('7m · sucesor inexistente -> error capturado', toasts.some(t => /Usuario sucesor no encontrado/.test(t)));
    }
    {
        const { sandbox, writes, toasts } = buildSandbox({
            successionRequests: { s1: { clubId: 'c1', successorEmail: 'a@x.com' } },
        });
        await sandbox.window.saApproveRequest('s1', 'club_admin_succession', false);
        ok('7n · rechazo -> status rejected', lastWrite(writes, 'succession_requests', 's1').data.status === 'rejected' && toasts.some(t => /sucesión rechazada/.test(t)));
    }
    {
        const { sandbox, toasts } = buildSandbox({ successionRequests: {} });
        await sandbox.window.saApproveRequest('nope', 'club_admin_succession', true);
        ok('7o · sucesión inexistente -> error capturado', toasts.some(t => /Solicitud de sucesión no encontrada/.test(t)));
    }

    console.log('\n── PARTE 8 · bugs latentes preexistentes (documentados, NO corregidos) ──');
    {
        // BUG-1: _indEntityId3 fuera de scope en el try de setCustomClaims.
        const { sandbox, callables, writes, toasts } = buildSandbox({
            platformRequests: { p1: { requestedRole: 'individual', requestedEmail: 'i@x.com', userUid: 'u1' } },
            users: { u1: { email: 'i@x.com', individualEntityId: 'ent1', allRoles: [] } },
            clubs: { ent1: { name: 'E' } },
        });
        await sandbox.window.saApproveRequest('p1', 'user_request', true);
        ok('8a · BUG-1: individual vía user_request NO recibe custom claims (ReferenceError silenciado)',
            !callables.some(c => c.name === 'setCustomClaims'), callables);
        ok('8b · BUG-1: pese al fallo, la aprobación se completa (solicitud aprobada + toast de éxito)',
            lastWrite(writes, 'platform_requests', 'p1').data.status === 'sa_approved' && toasts.some(t => /Administrador Individual/.test(t)));
    }
    {
        // BUG-2: getDocs/query/collection/where no destructurados en esa rama.
        const { sandbox, writes, toasts } = buildSandbox({
            platformRequests: { p1: { requestedRole: 'user', requestedEmail: 'x@x.com', userUid: 'u6', clubId: 'c1' } },
            users: { u6: { email: 'x@x.com', allRoles: [] } },
        });
        await sandbox.window.saApproveRequest('p1', 'user_request', true);
        ok('8c · BUG-2: la rama "otros roles" activa al usuario pero termina en toast de error',
            !!wrote(writes, 'users', 'u6').length && toasts.some(t => /^⚠️ Error: /.test(t)) && !toasts.some(t => /activado como Entrenador/.test(t)),
            toasts);
        ok('8d · BUG-2: por el fallo, la solicitud NO llega a marcarse sa_approved',
            !wrote(writes, 'platform_requests', 'p1').some(w => w.data && w.data.status === 'sa_approved'));
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();

// ─────────────────────────────────────────────────────────────────────────
// test_sa_create_direct_module.js · Refactor de monolitos (auditoría
// 2026-07-22) — PASO 5: extracción de "Crear club/individual directo"
// (saShowCreateClub / saCreateClubConfirm / saShowCreateIndividual /
// saCreateIndividualConfirm) desde js/admin/superadmin/superadmin.panel.js
// a su propio archivo.
//
// Sección autocontenida: solo usa helpers globales ya compartidos por otras
// extracciones (saFS(), saTab(), _saToast, _saShowSpinner/_saHideSpinner,
// window.ROLE_META, window._cronosCurrentUser). No depende de saClubs/
// saIndividuals ni de ninguna sección aún sin extraer.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.existsSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'create-direct.js'))
    ? path.join(ROOT, 'js', 'admin', 'superadmin', 'create-direct.js')
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Crear club/individual directo — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Infra: fakes de Firestore + DOM ═══════════════════════
function makeEl(initial) {
    return Object.assign({ value: '', checked: false, innerHTML: '' }, initial);
}

function buildSandbox({ elements = {}, usersStore = {}, currentUserEmail = 'sa@cronos.app', hasFunctions = true } = {}) {
    const setDocCalls = [];
    const updateDocCalls = [];
    const toasts = [];
    const saTabCalls = [];
    const httpsCallableCalls = [];
    const spinners = [];

    const els = {};
    for (const [id, init] of Object.entries(elements)) els[id] = makeEl(init);
    // 'sa-body' siempre presente para las funciones "Show" (renderizan HTML).
    if (!els['sa-body']) els['sa-body'] = makeEl({});

    const fns = {
        db: {},
        doc: (db, col, id) => ({ __col: col, __id: id }),
        setDoc: async (ref, data) => { setDocCalls.push({ col: ref.__col, id: ref.__id, data }); },
        updateDoc: async (ref, data) => {
            updateDocCalls.push({ col: ref.__col, id: ref.__id, data });
            if (ref.__col === 'users' && usersStore[ref.__id]) Object.assign(usersStore[ref.__id], data);
        },
        collection: (db, col) => ({ __col: col }),
        query: (collRef, ...clauses) => ({ __col: collRef.__col, __clauses: clauses }),
        where: (field, op, value) => ({ field, op, value }),
        getDocs: async (qOrColl) => {
            const col = qOrColl.__col;
            const store = col === 'users' ? usersStore : {};
            const clauses = qOrColl.__clauses || [];
            const entries = Object.entries(store).filter(([id, data]) =>
                clauses.every(c => data[c.field] === c.value));
            return {
                empty: entries.length === 0,
                docs: entries.map(([id, data]) => ({ id, data: () => data })),
            };
        },
        fa: { functions: hasFunctions ? {} : null },
        httpsCallable: (functionsRef, name) => {
            return async (payload) => { httpsCallableCalls.push({ name, payload }); return { data: {} }; };
        },
    };

    const sandbox = {
        window: {
            ROLE_META: {
                admin_individual: { label: 'Administrador Individual' },
                individual:        { label: 'Administrador Individual' },
                user:              { label: 'Entrenador Individual' },
                parent:            { label: 'Padre/Madre/Tutor' },
            },
            _cronosCurrentUser: currentUserEmail ? { email: currentUserEmail } : undefined,
        },
        document: {
            getElementById: (id) => els[id] || null,
        },
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Array, Object, String, Date, Math, parseInt, JSON,
        saFS: async () => fns,
        saTab: (tab) => { saTabCalls.push(tab); },
    };
    sandbox.window.saFS = sandbox.saFS;
    sandbox.window.saTab = sandbox.saTab;
    vm.createContext(sandbox);

    const src = fs.readFileSync(SOURCE, 'utf8');
    const start = src.indexOf('window.saShowCreateClub = function');
    if (start === -1) throw new Error('No se encontró saShowCreateClub en ' + SOURCE);
    const endMarker = 'EDITAR SLOTS Y PLAN DE UN CLUB';
    const endIdx = src.indexOf(endMarker);
    const block = endIdx !== -1 ? src.slice(start, endIdx) : src.slice(start);

    const stubs = `
        var _saShowSpinner = function(msg) { __spinners.push({on:true, msg}); };
        var _saHideSpinner = function() { __spinners.push({on:false}); };
        var _saToast = function(msg, ms) { __toasts.push(msg); };
        var saFS = window.saFS;
        var saTab = window.saTab;
    `;
    sandbox.__spinners = spinners;
    sandbox.__toasts = toasts;
    vm.runInContext(stubs + block, sandbox);

    return { sandbox, els, usersStore, setDocCalls, updateDocCalls, toasts, saTabCalls, httpsCallableCalls, spinners };
}

(async () => {
    console.log('── PARTE 1 · estructura ──');
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');
    ok('1a · saShowCreateClub existe', /window\.saShowCreateClub\s*=\s*function/.test(rawSrc));
    ok('1b · saCreateClubConfirm existe', /window\.saCreateClubConfirm\s*=\s*async function/.test(rawSrc));
    ok('1c · saShowCreateIndividual existe', /window\.saShowCreateIndividual\s*=\s*function/.test(rawSrc));
    ok('1d · saCreateIndividualConfirm existe', /window\.saCreateIndividualConfirm\s*=\s*async function/.test(rawSrc));

    console.log('\n── PARTE 2 · saShowCreateClub / saShowCreateIndividual (render) ──');
    {
        const { sandbox, els } = buildSandbox({});
        sandbox.window.saShowCreateClub();
        ok('2a · renderiza formulario de crear club', /Crear Nuevo Club/.test(els['sa-body'].innerHTML) && /cc-name/.test(els['sa-body'].innerHTML));

        sandbox.window.saShowCreateIndividual();
        ok('2b · renderiza formulario de crear individual', /Crear Usuario Individual/.test(els['sa-body'].innerHTML) && /ci-email/.test(els['sa-body'].innerHTML));
    }

    console.log('\n── PARTE 3 · saCreateClubConfirm — validación ──');
    {
        const { sandbox, setDocCalls, toasts } = buildSandbox({
            elements: { 'cc-name': { value: '' }, 'cc-email': { value: 'admin@club.com' } },
        });
        await sandbox.window.saCreateClubConfirm();
        ok('3a · sin nombre -> ningún setDoc', setDocCalls.length === 0);
        ok('3b · sin nombre -> toast de aviso', toasts.some(t => /nombre.*obligatorio/i.test(t)));
    }
    {
        const { sandbox, setDocCalls, toasts } = buildSandbox({
            elements: { 'cc-name': { value: 'CD Prueba' }, 'cc-email': { value: '' } },
        });
        await sandbox.window.saCreateClubConfirm();
        ok('3c · sin email -> ningún setDoc', setDocCalls.length === 0);
        ok('3d · sin email -> toast de aviso', toasts.some(t => /email.*obligatorio/i.test(t)));
    }

    console.log('\n── PARTE 4 · saCreateClubConfirm — happy path ──');
    {
        const { sandbox, setDocCalls, toasts, saTabCalls } = buildSandbox({
            elements: {
                'cc-name': { value: 'CD Prueba' }, 'cc-email': { value: 'admin@club.com' },
                'cc-dir': { value: '' }, 'cc-coord': { value: '' }, 'cc-coach': { value: '' }, 'cc-parents': { value: '' },
                'cc-plan': { value: 'pro' },
            },
        });
        await sandbox.window.saCreateClubConfirm();
        ok('4a · crea exactamente un club', setDocCalls.length === 1 && setDocCalls[0].col === 'clubs');
        const data = setDocCalls[0] && setDocCalls[0].data;
        ok('4b · nombre/email/plan correctos', data && data.name === 'CD Prueba' && data.adminEmail === 'admin@club.com' && data.plan === 'pro');
        ok('4c · adminUid null, status active', data && data.adminUid === null && data.status === 'active');
        ok('4d · slots por defecto cuando campos vacíos (1/2/10/50)',
           data && data.slots.directors === 1 && data.slots.coordinators === 2 && data.slots.users === 10 && data.slots.parents === 50);
        ok('4e · usedSlots todos a 0', data && Object.values(data.usedSlots).every(v => v === 0));
        ok('4f · createdBySA usa el email del usuario actual', data && data.createdBySA === 'sa@cronos.app');
        ok('4g · toast de éxito menciona el club', toasts.some(t => /CD Prueba/.test(t) && /creado/i.test(t)));
        ok('4h · vuelve a la pestaña clubs', saTabCalls.includes('clubs'));
    }

    console.log('\n── PARTE 5 · saCreateIndividualConfirm — validación ──');
    {
        const { sandbox, setDocCalls, updateDocCalls, toasts } = buildSandbox({
            elements: { 'ci-email': { value: '' } },
        });
        await sandbox.window.saCreateIndividualConfirm();
        ok('5a · sin email -> ningún write', setDocCalls.length === 0 && updateDocCalls.length === 0);
        ok('5b · sin email -> toast de aviso', toasts.some(t => /email.*obligatorio/i.test(t)));
    }

    console.log('\n── PARTE 6 · saCreateIndividualConfirm — usuario existente activo/pendiente ──');
    {
        const { sandbox, setDocCalls, updateDocCalls, toasts } = buildSandbox({
            elements: { 'ci-email': { value: 'ya@existe.com' }, 'ci-role': { value: 'user' }, 'ci-plan': { value: 'free' } },
            usersStore: { u1: { email: 'ya@existe.com', status: 'active' } },
        });
        await sandbox.window.saCreateIndividualConfirm();
        ok('6a · usuario activo existente -> ningún write', setDocCalls.length === 0 && updateDocCalls.length === 0);
        ok('6b · toast explica que ya existe', toasts.some(t => /ya existe/i.test(t)));
    }

    console.log('\n── PARTE 7 · saCreateIndividualConfirm — reactivar usuario removido/bloqueado ──');
    {
        const { sandbox, updateDocCalls, toasts, saTabCalls, httpsCallableCalls } = buildSandbox({
            elements: {
                'ci-email': { value: 'reactivar@x.com' }, 'ci-name': { value: 'Juan' },
                'ci-role': { value: 'user' }, 'ci-plan': { value: 'basic' }, 'ci-sendemail': { checked: true },
            },
            usersStore: { u2: { email: 'reactivar@x.com', status: 'removed', allRoles: [] } },
        });
        await sandbox.window.saCreateIndividualConfirm();
        ok('7a · reactivación -> exactamente un updateDoc sobre el mismo doc', updateDocCalls.length === 1 && updateDocCalls[0].id === 'u2');
        const d = updateDocCalls[0].data;
        ok('7b · status/isAuthorized reactivados', d.status === 'active' && d.isAuthorized === true);
        ok('7c · removedAt/blockedAt limpiados', d.removedAt === null && d.blockedAt === null);
        ok('7d · allRoles incluye el rol solicitado', d.allRoles.some(r => r.role === 'user' && r.isAuthorized === true));
        ok('7e · toast de reactivación con la etiqueta del rol', toasts.some(t => /reactivado/i.test(t) && /Entrenador Individual/.test(t)));
        ok('7f · vuelve a la pestaña individuals', saTabCalls.includes('individuals'));
        ok('7g · sendEmail marcado + fa.functions -> llama sendInviteEmail', httpsCallableCalls.some(c => c.name === 'sendInviteEmail' && c.payload.to === 'reactivar@x.com'));
    }

    console.log('\n── PARTE 8 · saCreateIndividualConfirm — usuario nuevo ──');
    {
        const { sandbox, setDocCalls, toasts, saTabCalls, httpsCallableCalls } = buildSandbox({
            elements: {
                'ci-email': { value: 'nuevo@x.com' }, 'ci-name': { value: 'Ana' },
                'ci-role': { value: 'parent' }, 'ci-plan': { value: 'free' }, 'ci-sendemail': { checked: false },
            },
            usersStore: {},
        });
        await sandbox.window.saCreateIndividualConfirm();
        ok('8a · crea exactamente un pre-usuario', setDocCalls.length === 1 && setDocCalls[0].col === 'users');
        ok('8b · id con prefijo individual_pre_', setDocCalls[0].id.startsWith('individual_pre_'));
        const data = setDocCalls[0].data;
        ok('8c · campos correctos', data.email === 'nuevo@x.com' && data.role === 'parent' && data.isAuthorized === true && data.status === 'active');
        ok('8d · approvedBySA true', data.approvedBySA === true);
        ok('8e · sendEmail desmarcado -> NO llama a sendInviteEmail', httpsCallableCalls.length === 0);
        ok('8f · toast de éxito', toasts.some(t => /creado/i.test(t) && /nuevo@x.com/.test(t)));
        ok('8g · vuelve a la pestaña individuals', saTabCalls.includes('individuals'));
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();

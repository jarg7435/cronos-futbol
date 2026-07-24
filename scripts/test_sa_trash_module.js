// ─────────────────────────────────────────────────────────────────────────
// test_sa_trash_module.js · Refactor de monolitos (auditoría 2026-07-22,
// hallazgo #9) — PASO 1: extracción de la pestaña Papelera del SuperAdmin
// (saTrash, saReactivateAsIndividual, saPurgeUser) desde
// js/admin/superadmin/superadmin.panel.js a su propio archivo.
//
// Este test se escribe ANTES de mover ninguna línea de código, ejecutando
// las 3 funciones REALES tal como existen hoy (extraídas del archivo fuente
// en un sandbox con fakes de Firestore/Auth/DOM), para fijar su
// comportamiento actual como red de seguridad. Tras la extracción, SOURCE
// solo cambia de ruta (ver abajo) — si este mismo test sigue en verde
// apuntando al nuevo archivo, la extracción fue puramente mecánica.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// Tras el paso 2 (mover el código), esta ruta pasa a ser el archivo nuevo.
const SOURCE = fs.existsSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'trash.js'))
    ? path.join(ROOT, 'js', 'admin', 'superadmin', 'trash.js')
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Papelera SuperAdmin (saTrash/saReactivateAsIndividual/saPurgeUser) — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Infra: fakes de Firestore/Auth/DOM ═══════════════
function makeFakeDb(usersStore, linksStore) {
    function docRef(col, id) {
        return {
            async get() {
                const store = col === 'users' ? usersStore : linksStore;
                const exists = Object.prototype.hasOwnProperty.call(store, id);
                return { exists: () => exists, data: () => (exists ? store[id] : undefined), id };
            },
        };
    }
    return { docRef };
}

function buildSandbox({ usersStore = {}, linksStore = {}, deleteAuthUserImpl = null, confirmReturns = true } = {}) {
    const updateDocCalls = [];
    const deleteDocCalls = [];
    const setDocCalls = [];
    const toasts = [];
    const spinners = [];
    let domHtml = '';

    const fakeDb = makeFakeDb(usersStore, linksStore);

    const fns = {
        db: {},
        doc: (db, col, id) => ({ __col: col, __id: id, ...fakeDb.docRef(col, id) }),
        getDoc: async (ref) => ref.get(),
        updateDoc: async (ref, data) => { updateDocCalls.push({ col: ref.__col, id: ref.__id, data }); if (ref.__col === 'users') Object.assign(usersStore[ref.__id] || (usersStore[ref.__id] = {}), data); },
        deleteDoc: async (ref) => { deleteDocCalls.push({ col: ref.__col, id: ref.__id }); if (ref.__col === 'users') delete usersStore[ref.__id]; if (ref.__col === 'cronos_player_links') delete linksStore[ref.__id]; },
        setDoc: async (ref, data) => { setDocCalls.push({ col: ref.__col, id: ref.__id, data }); },
        collection: (db, col) => ({ __col: col }),
        query: (collRef, ...clauses) => ({ __col: collRef.__col, __clauses: clauses }),
        where: (field, op, value) => ({ field, op, value }),
        getDocs: async (q) => {
            const store = q.__col === 'users' ? usersStore : linksStore;
            const results = Object.entries(store).filter(([id, data]) => {
                return q.__clauses.every(c => {
                    if (c.op === 'in') return (c.value || []).includes(data[c.field]);
                    return data[c.field] === c.value;
                });
            });
            return { forEach: (cb) => results.forEach(([id, data]) => cb({ id, data: () => data })) };
        },
        httpsCallable: (functions, name) => async (payload) => {
            if (name !== 'deleteAuthUser') throw new Error('CF inesperada: ' + name);
            if (deleteAuthUserImpl) return deleteAuthUserImpl(payload);
            return { success: true };
        },
        fa: { functions: {} },
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: { uid: 'sa-uid', email: 'superadmin@cronos.test' },
            ROLE_META: { director: { label: 'Director' }, coach: { label: 'Entrenador' } },
        },
        document: {
            getElementById: (id) => id === 'sa-body' ? {
                set innerHTML(v) { domHtml = v; },
                get innerHTML() { return domHtml; },
            } : null,
        },
        escapeHtml: (s) => String(s == null ? '' : s),
        escapeAttr: (s) => String(s == null ? '' : s),
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        Date,
        String, Object, Array,
        saFS: async () => fns,
        setTimeout,
    };
    sandbox.window.saFS = sandbox.saFS;
    vm.createContext(sandbox);

    const src = fs.readFileSync(SOURCE, 'utf8');
    // Extraer solo el bloque de la Papelera (mismas 3 funciones tanto si
    // viven en superadmin.panel.js como en el archivo nuevo ya extraído).
    const start = src.indexOf('window.saTrash = async function saTrash()');
    const end = src.indexOf('window.setupClubsSyncListener');
    const block = end !== -1 ? src.slice(start, end) : src.slice(start);
    if (start === -1) throw new Error('No se encontró saTrash en ' + SOURCE);

    // _saShowSpinner/_saHideSpinner/_saToast: stubs mínimos con registro de
    // llamadas, en vez de traer todo el "núcleo compartido" del panel.
    const stubs = `
        var _saShowSpinner = function(msg) { __spinners.push({on:true, msg}); };
        var _saHideSpinner = function() { __spinners.push({on:false}); };
        var _saToast = function(msg, ms) { __toasts.push(msg); };
        var saFS = window.saFS;
    `;
    sandbox.__spinners = spinners;
    sandbox.__toasts = toasts;
    vm.runInContext(stubs + block, sandbox);

    return {
        sandbox, usersStore, linksStore,
        updateDocCalls, deleteDocCalls, setDocCalls, toasts, spinners,
        getDomHtml: () => domHtml,
    };
}

(async () => {
    console.log('── PARTE 1 · estructura ──');
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');
    ok('1a · saTrash existe', /window\.saTrash\s*=\s*async function/.test(rawSrc));
    ok('1b · saReactivateAsIndividual existe', /window\.saReactivateAsIndividual\s*=\s*async function/.test(rawSrc));
    ok('1c · saPurgeUser existe', /window\.saPurgeUser\s*=\s*async function saPurgeUser/.test(rawSrc));

    console.log('\n── PARTE 2 · saTrash() ──');
    {
        const { sandbox, getDomHtml } = buildSandbox({ usersStore: {} });
        await sandbox.window.saTrash();
        ok('2a · sin usuarios en papelera -> mensaje "Sin rastros pendientes"',
           /Sin rastros pendientes/.test(getDomHtml()));
    }
    {
        const { sandbox, getDomHtml } = buildSandbox({
            usersStore: {
                u1: { email: 'baja@x.com', role: 'director', status: 'removed', removedAt: '2026-01-01T00:00:00.000Z' },
                u2: { email: 'bloq@x.com', role: 'coach', status: 'blocked', blockedAt: '2026-02-02T00:00:00.000Z' },
            },
        });
        await sandbox.window.saTrash();
        const html = getDomHtml();
        ok('2b · lista a los dados de baja bajo su sección', /Dados de baja \(1\)/.test(html) && /baja@x\.com/.test(html));
        ok('2c · lista a los bloqueados bajo su sección', /Bloqueados \(1\)/.test(html) && /bloq@x\.com/.test(html));
        ok('2d · el dado de baja tiene botones Reactivar y Limpiar', /Reactivar/.test(html) && /saPurgeUser/.test(html));
    }

    console.log('\n── PARTE 3 · saReactivateAsIndividual() ──');
    {
        // 3a: usuario cancela el confirm() -> no debe tocar nada.
        const { sandbox, updateDocCalls } = buildSandbox({
            usersStore: { u1: { email: 'x@x.com', role: 'coach', status: 'removed', allRoles: [] } },
            confirmReturns: false,
        });
        await sandbox.window.saReactivateAsIndividual('u1', 'x@x.com');
        ok('3a · confirm() cancelado -> ningún updateDoc', updateDocCalls.length === 0);
    }
    {
        // 3b: happy path -> reactiva, marca allRoles autorizados, limpia removedAt/blockedAt.
        const { sandbox, updateDocCalls, usersStore } = buildSandbox({
            usersStore: {
                u1: { email: 'x@x.com', role: 'coach', status: 'removed', removedAt: '2026-01-01', allRoles: [{ role: 'coach', isAuthorized: false, status: 'removed' }] },
            },
        });
        await sandbox.window.saReactivateAsIndividual('u1', 'x@x.com');
        ok('3b · exactamente 1 updateDoc sobre users/u1', updateDocCalls.length === 1 && updateDocCalls[0].id === 'u1');
        const data = updateDocCalls[0].data;
        ok('3c · isAuthorized true, status active', data.isAuthorized === true && data.status === 'active');
        ok('3d · limpia removedAt/blockedAt', data.removedAt === null && data.blockedAt === null);
        ok('3e · marca el rol existente como isAuthorized/active', data.allRoles[0].isAuthorized === true && data.allRoles[0].status === 'active');
        ok('3f · registra reactivatedAt/reactivatedBy', !!data.reactivatedAt && data.reactivatedBy === 'superadmin@cronos.test');
    }
    {
        // 3g: si el rol activo no está en allRoles, se añade.
        const { sandbox, updateDocCalls } = buildSandbox({
            usersStore: { u1: { email: 'x@x.com', role: 'parent', status: 'removed', allRoles: [] } },
        });
        await sandbox.window.saReactivateAsIndividual('u1', 'x@x.com');
        const roles = updateDocCalls[0].data.allRoles;
        ok('3g · añade el rol raíz si no estaba en allRoles vacío', roles.length === 1 && roles[0].role === 'parent' && roles[0].isAuthorized === true);
    }

    console.log('\n── PARTE 4 · saPurgeUser() ──');
    {
        // 4a: usuario cancela el confirm() -> no borra nada.
        const { sandbox, deleteDocCalls } = buildSandbox({
            usersStore: { u1: { email: 'x@x.com', uid: 'u1', allRoles: [] } },
            confirmReturns: false,
        });
        await sandbox.window.saPurgeUser('u1', 'x@x.com');
        ok('4a · confirm() cancelado -> ningún deleteDoc', deleteDocCalls.length === 0);
    }
    {
        // 4b: happy path -> borra doc primario, secundarios y enlaces de jugador.
        const { sandbox, deleteDocCalls, usersStore, linksStore } = buildSandbox({
            usersStore: {
                u1: { email: 'x@x.com', uid: 'u1', allRoles: [{ role: 'coach', clubId: 'CLUB_A' }] },
                'u1_coach_CLUB_A': { email: 'x@x.com' },
            },
            linksStore: {
                link1: { parentUid: 'u1', parentEmail: 'x@x.com' },
            },
        });
        await sandbox.window.saPurgeUser('u1', 'x@x.com');
        ok('4b · borra el documento primario', !usersStore.u1);
        ok('4c · borra el documento secundario del rol', !usersStore['u1_coach_CLUB_A']);
        ok('4d · borra el enlace de jugador asociado', !linksStore.link1);
    }
    {
        // 4e: la CF deleteAuthUser falla con un error DISTINTO de user-not-found
        // -> aborta la purga entera, NO debe borrar ningún documento.
        const { sandbox, deleteDocCalls, setDocCalls, usersStore } = buildSandbox({
            usersStore: { u1: { email: 'x@x.com', uid: 'u1', allRoles: [] } },
            deleteAuthUserImpl: async () => { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; },
        });
        await sandbox.window.saPurgeUser('u1', 'x@x.com');
        ok('4e · error de Auth no-"user-not-found" -> NINGÚN deleteDoc ejecutado', deleteDocCalls.length === 0, deleteDocCalls);
        ok('4f · el fallo queda registrado en auth_deletion_failures', setDocCalls.some(c => c.col === 'auth_deletion_failures'));
        ok('4g · el documento del usuario sigue existiendo (no se purgó)', !!usersStore.u1);
    }
    {
        // 4h: la CF falla con user-not-found (cuenta Auth ya no existe) ->
        // se considera "ya limpio" y la purga de documentos SÍ continúa.
        const { sandbox, deleteDocCalls } = buildSandbox({
            usersStore: { u1: { email: 'x@x.com', uid: 'u1', allRoles: [] } },
            deleteAuthUserImpl: async () => { const e = new Error('no existe'); e.code = 'auth/user-not-found'; throw e; },
        });
        await sandbox.window.saPurgeUser('u1', 'x@x.com');
        ok('4h · error "user-not-found" -> la purga de documentos SÍ continúa', deleteDocCalls.some(c => c.col === 'users' && c.id === 'u1'));
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();

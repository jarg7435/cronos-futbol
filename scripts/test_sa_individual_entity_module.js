// ─────────────────────────────────────────────────────────────────────────
// test_sa_individual_entity_module.js · Refactor de monolitos (auditoría
// 2026-07-22) — PASO 6: extracción de "Crear/editar ente individual"
// (saShowCreateIndividualEntity / saCreateIndividualEntityConfirm /
// saEditIndividualEntity / saEditIndividualEntityConfirm /
// saDeleteIndividualEntity / saShowEntityUsers /
// saShowCreateIndividualForEntity / saCreateIndividualForEntityConfirm)
// desde js/admin/superadmin/superadmin.panel.js a su propio archivo.
//
// Coupling verificado antes de escribir este test: la única entrada externa
// es "onclick" strings generadas por saIndividuals() (sección NO extraída
// todavía, líneas <711) — resolución en tiempo de click, sin dependencia de
// orden de carga. saShowEntityUsers llama a window.renderCategoryTreeReadOnly
// (definida en js/admin/shared/category-tree.js) también en tiempo de
// llamada. Ninguna de las 8 funciones llama de vuelta a saIndividuals/
// saClubs/saRequests — solo a saTab('individuals'), el conmutador de
// pestañas ya compartido. Cero solapamiento con el WIP sin commitear de
// saSetClubUserStatus (líneas ~2110-2226) ni con el de Mensajería SA
// (líneas ~3127-3340) — verificado con `git diff` antes de escribir este
// test: ninguno de sus hunks cae dentro de este bloque.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.existsSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'individual-entity.js'))
    ? path.join(ROOT, 'js', 'admin', 'superadmin', 'individual-entity.js')
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Crear/editar ente individual — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Infra: fakes de Firestore + DOM ═══════════════════════
function makeEl(initial) {
    return Object.assign({ value: '', checked: false, innerHTML: '' }, initial);
}

function buildSandbox({ elements = {}, clubsStore = {}, usersStore = {}, currentUserEmail = 'sa@cronos.app', confirmReturns = true, hasFunctions = true } = {}) {
    const setDocCalls = [];
    const updateDocCalls = [];
    const deleteDocCalls = [];
    const toasts = [];
    const saTabCalls = [];
    const httpsCallableCalls = [];
    const renderCategoryTreeCalls = [];

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
        setDoc: async (ref, data) => {
            setDocCalls.push({ col: ref.__col, id: ref.__id, data });
            const store = ref.__col === 'clubs' ? clubsStore : usersStore;
            store[ref.__id] = data;
        },
        updateDoc: async (ref, data) => {
            updateDocCalls.push({ col: ref.__col, id: ref.__id, data });
            const store = ref.__col === 'clubs' ? clubsStore : usersStore;
            if (store[ref.__id]) {
                for (const [k, v] of Object.entries(data)) {
                    if (k.startsWith('usedSlots.')) {
                        store[ref.__id].usedSlots = store[ref.__id].usedSlots || {};
                        store[ref.__id].usedSlots[k.split('.')[1]] = v;
                    } else {
                        store[ref.__id][k] = v;
                    }
                }
            }
        },
        deleteDoc: async (ref) => {
            deleteDocCalls.push({ col: ref.__col, id: ref.__id });
            const store = ref.__col === 'clubs' ? clubsStore : usersStore;
            delete store[ref.__id];
        },
        collection: (db, col) => ({ __col: col }),
        query: (collRef, ...clauses) => ({ __col: collRef.__col, __clauses: clauses }),
        where: (field, op, value) => ({ field, op, value }),
        getDocs: async (qOrColl) => {
            const col = qOrColl.__col;
            const store = col === 'users' ? usersStore : clubsStore;
            const clauses = qOrColl.__clauses || [];
            const entries = Object.entries(store).filter(([id, data]) =>
                clauses.every(c => data[c.field] === c.value));
            return {
                empty: entries.length === 0,
                docs: entries.map(([id, data]) => ({ id, data: () => data })),
                forEach: (cb) => entries.forEach(([id, data]) => cb({ id, data: () => data })),
            };
        },
        fa: { functions: hasFunctions ? {} : null },
        httpsCallable: (functionsRef, name) => {
            return async (payload) => { httpsCallableCalls.push({ name, payload }); return { data: {} }; };
        },
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: currentUserEmail ? { email: currentUserEmail } : undefined,
            renderCategoryTreeReadOnly: (users, opts) => {
                renderCategoryTreeCalls.push({ users, opts });
                return '<div class="fake-tree">' + users.length + ' usuarios</div>';
            },
        },
        document: { getElementById: (id) => els[id] || null },
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Array, Object, String, Date, Math, parseInt, JSON,
        saFS: async () => fns,
        saTab: (tab) => { saTabCalls.push(tab); },
    };
    sandbox.window.saFS = sandbox.saFS;
    sandbox.window.saTab = sandbox.saTab;
    sandbox.window.renderCategoryTreeReadOnly = sandbox.window.renderCategoryTreeReadOnly;
    vm.createContext(sandbox);

    const src = fs.readFileSync(SOURCE, 'utf8');
    const start = src.indexOf('window.saShowCreateIndividualEntity = function');
    if (start === -1) throw new Error('No se encontró saShowCreateIndividualEntity en ' + SOURCE);
    const endMarker = 'CREAR CLUB / USUARIO INDIVIDUAL directamente desde SA';
    const endIdx = src.indexOf(endMarker);
    const block = endIdx !== -1 ? src.slice(start, endIdx) : src.slice(start);

    const stubs = `
        var _saShowSpinner = function(msg) { __spinners.push({on:true, msg}); };
        var _saHideSpinner = function() { __spinners.push({on:false}); };
        var _saToast = function(msg, ms) { __toasts.push(msg); };
        var saFS = window.saFS;
        var saTab = window.saTab;
        var renderCategoryTreeReadOnly = window.renderCategoryTreeReadOnly;
    `;
    sandbox.__spinners = [];
    sandbox.__toasts = toasts;
    vm.runInContext(stubs + block, sandbox);

    return { sandbox, els, clubsStore, usersStore, setDocCalls, updateDocCalls, deleteDocCalls, toasts, saTabCalls, httpsCallableCalls, renderCategoryTreeCalls };
}

(async () => {
    console.log('── PARTE 1 · estructura ──');
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');
    ok('1a · saShowCreateIndividualEntity existe', /window\.saShowCreateIndividualEntity\s*=\s*function/.test(rawSrc));
    ok('1b · saCreateIndividualEntityConfirm existe', /window\.saCreateIndividualEntityConfirm\s*=\s*async function/.test(rawSrc));
    ok('1c · saEditIndividualEntity existe', /window\.saEditIndividualEntity\s*=\s*async function/.test(rawSrc));
    ok('1d · saEditIndividualEntityConfirm existe', /window\.saEditIndividualEntityConfirm\s*=\s*async function/.test(rawSrc));
    ok('1e · saDeleteIndividualEntity existe', /window\.saDeleteIndividualEntity\s*=\s*async function/.test(rawSrc));
    ok('1f · saShowEntityUsers existe', /window\.saShowEntityUsers\s*=\s*async function/.test(rawSrc));
    ok('1g · saShowCreateIndividualForEntity existe', /window\.saShowCreateIndividualForEntity\s*=\s*function/.test(rawSrc));
    ok('1h · saCreateIndividualForEntityConfirm existe', /window\.saCreateIndividualForEntityConfirm\s*=\s*async function/.test(rawSrc));

    console.log('\n── PARTE 2 · saShowCreateIndividualEntity (render) ──');
    {
        const { sandbox, els } = buildSandbox({});
        sandbox.window.saShowCreateIndividualEntity();
        ok('2a · renderiza formulario', /Crear Ente Individual/.test(els['sa-body'].innerHTML) && /cie-name/.test(els['sa-body'].innerHTML));
    }

    console.log('\n── PARTE 3 · saCreateIndividualEntityConfirm ──');
    {
        const { sandbox, setDocCalls, toasts } = buildSandbox({ elements: { 'cie-name': { value: '' } } });
        await sandbox.window.saCreateIndividualEntityConfirm();
        ok('3a · sin nombre -> ningún setDoc', setDocCalls.length === 0);
        ok('3b · sin nombre -> toast de aviso', toasts.some(t => /nombre.*obligatorio/i.test(t)));
    }
    {
        const { sandbox, setDocCalls, toasts, saTabCalls } = buildSandbox({
            elements: {
                'cie-name': { value: 'Entrenadores Libres' }, 'cie-admins': { value: '' },
                'cie-coaches': { value: '' }, 'cie-parents': { value: '' }, 'cie-plan': { value: 'basic' },
            },
        });
        await sandbox.window.saCreateIndividualEntityConfirm();
        ok('3c · crea exactamente un ente', setDocCalls.length === 1 && setDocCalls[0].col === 'clubs');
        const d = setDocCalls[0].data;
        ok('3d · type=individual, plan correcto', d.type === 'individual' && d.plan === 'basic' && d.status === 'active');
        ok('3e · slots por defecto (5/50/100)', d.slots.admins === 5 && d.slots.coaches === 50 && d.slots.parents === 100);
        ok('3f · hasAdmin false al crear', d.hasAdmin === false);
        ok('3g · toast de éxito + vuelve a individuals', toasts.some(t => /Entrenadores Libres/.test(t)) && saTabCalls.includes('individuals'));
    }

    console.log('\n── PARTE 4 · saEditIndividualEntity ──');
    {
        const { sandbox, toasts } = buildSandbox({ clubsStore: {} });
        await sandbox.window.saEditIndividualEntity('no-existe');
        ok('4a · ente no encontrado -> toast de error', toasts.some(t => /no encontrado/i.test(t)));
    }
    {
        const { sandbox, els } = buildSandbox({
            clubsStore: { ent1: { name: 'Ente X', slots: { admins: 3, coaches: 20, parents: 40 }, plan: 'pro' } },
        });
        await sandbox.window.saEditIndividualEntity('ent1');
        ok('4b · renderiza formulario con datos actuales', /Ente X/.test(els['sa-body'].innerHTML) && /value="3"/.test(els['sa-body'].innerHTML));
    }

    console.log('\n── PARTE 5 · saEditIndividualEntityConfirm ──');
    {
        const { sandbox, updateDocCalls, toasts } = buildSandbox({ elements: { 'eie-name': { value: '' } } });
        await sandbox.window.saEditIndividualEntityConfirm('ent1');
        ok('5a · sin nombre -> ningún updateDoc', updateDocCalls.length === 0);
        ok('5b · sin nombre -> toast de aviso', toasts.some(t => /obligatorio/i.test(t)));
    }
    {
        const { sandbox, updateDocCalls, toasts, saTabCalls } = buildSandbox({
            clubsStore: { ent1: { name: 'Vieja', slots: { admins: 1, coaches: 1, parents: 1 }, plan: 'free' } },
            elements: { 'eie-name': { value: 'Nueva' }, 'eie-admins': { value: '9' }, 'eie-coaches': { value: '9' }, 'eie-parents': { value: '9' }, 'eie-plan': { value: 'pro' } },
        });
        await sandbox.window.saEditIndividualEntityConfirm('ent1');
        ok('5c · actualiza exactamente el ente esperado', updateDocCalls.length === 1 && updateDocCalls[0].id === 'ent1');
        const d = updateDocCalls[0].data;
        ok('5d · nombre/plan/slots actualizados', d.name === 'Nueva' && d.plan === 'pro' && d.slots.admins === 9);
        ok('5e · toast de éxito + vuelve a individuals', toasts.some(t => /actualizado/i.test(t)) && saTabCalls.includes('individuals'));
    }

    console.log('\n── PARTE 6 · saDeleteIndividualEntity ──');
    {
        const { sandbox, deleteDocCalls } = buildSandbox({ confirmReturns: false, clubsStore: { ent1: { name: 'Ente X' } } });
        await sandbox.window.saDeleteIndividualEntity('ent1', 'Ente X');
        ok('6a · confirm cancelado -> ningún deleteDoc', deleteDocCalls.length === 0);
    }
    {
        const { sandbox, deleteDocCalls, toasts, saTabCalls } = buildSandbox({ confirmReturns: true, clubsStore: { ent1: { name: 'Ente X' } } });
        await sandbox.window.saDeleteIndividualEntity('ent1', 'Ente X');
        ok('6b · confirmado -> borra el ente', deleteDocCalls.some(c => c.col === 'clubs' && c.id === 'ent1'));
        ok('6c · toast de éxito + vuelve a individuals', toasts.some(t => /eliminado/i.test(t)) && saTabCalls.includes('individuals'));
    }

    console.log('\n── PARTE 7 · saShowEntityUsers ──');
    {
        const { sandbox, els, renderCategoryTreeCalls } = buildSandbox({ usersStore: {} });
        await sandbox.window.saShowEntityUsers('ent1');
        ok('7a · sin usuarios -> mensaje vacío, sin llamar al árbol', /Sin usuarios registrados/.test(els['sa-body'].innerHTML) && renderCategoryTreeCalls.length === 0);
    }
    {
        const { sandbox, els, renderCategoryTreeCalls } = buildSandbox({
            usersStore: {
                u1: { clubId: 'ent1', role: 'user', isAuthorized: true, status: 'active', allRoles: [] },
                u2: { individualEntityId: 'ent1', role: 'parent_individual', isAuthorized: true, status: 'active', allRoles: [] },
                u3: { individualOwnerId: 'ent1', role: 'admin_individual', isAuthorized: true, status: 'active', allRoles: [] },
                u4: { clubId: 'ent1', role: 'user', isAuthorized: true, status: 'removed', allRoles: [] },
                u5: { clubId: 'ent1', role: 'user', isAuthorized: false, status: 'active', allRoles: [] },
                u6: { clubId: 'otro-ente', role: 'user', isAuthorized: true, status: 'active', allRoles: [] },
            },
        });
        await sandbox.window.saShowEntityUsers('ent1');
        ok('7b · fusiona clubId + individualEntityId + individualOwnerId sin duplicados', renderCategoryTreeCalls.length === 1 && renderCategoryTreeCalls[0].users.length === 3);
        ok('7c · excluye usuarios "removed"', !renderCategoryTreeCalls[0].users.some(u => u.id === 'u4'));
        ok('7d · excluye usuarios no autorizados', !renderCategoryTreeCalls[0].users.some(u => u.id === 'u5'));
        ok('7e · excluye usuarios de OTRO ente', !renderCategoryTreeCalls[0].users.some(u => u.id === 'u6'));
        ok('7f · llama al árbol con mode:"individual"', renderCategoryTreeCalls[0].opts.mode === 'individual');
        // El título usa el conteo bruto fusionado (5: u1-u5, u6 excluido por ser de otro ente),
        // ANTES del filtro de removidos/no-autorizados que sí aplica la lista del árbol (3, parte 7b).
        ok('7g · título muestra el conteo bruto fusionado (antes de filtrar removidos/no-autorizados)', /Usuarios del Ente \(5\)/.test(els['sa-body'].innerHTML));
    }

    console.log('\n── PARTE 8 · saShowCreateIndividualForEntity (render) ──');
    {
        const { sandbox, els } = buildSandbox({});
        sandbox.window.saShowCreateIndividualForEntity('ent1');
        ok('8a · renderiza formulario', /A.adir Usuario al Ente/.test(els['sa-body'].innerHTML) && /cife-email/.test(els['sa-body'].innerHTML));
    }

    console.log('\n── PARTE 9 · saCreateIndividualForEntityConfirm — validación y bloqueo ──');
    {
        const { sandbox, setDocCalls, toasts } = buildSandbox({ elements: { 'cife-email': { value: '' } } });
        await sandbox.window.saCreateIndividualForEntityConfirm('ent1');
        ok('9a · sin email -> ningún write', setDocCalls.length === 0);
        ok('9b · sin email -> toast de aviso', toasts.some(t => /obligatorio/i.test(t)));
    }
    {
        const { sandbox, setDocCalls, updateDocCalls, toasts } = buildSandbox({
            elements: { 'cife-email': { value: 'activo@x.com' } },
            usersStore: { u1: { email: 'activo@x.com', status: 'active' } },
        });
        await sandbox.window.saCreateIndividualForEntityConfirm('ent1');
        ok('9c · usuario activo existente -> ningún write', setDocCalls.length === 0 && updateDocCalls.length === 0);
        ok('9d · toast explica que ya existe', toasts.some(t => /ya existe/i.test(t)));
    }

    console.log('\n── PARTE 10 · saCreateIndividualForEntityConfirm — reactivar y asignar al ente ──');
    {
        const { sandbox, updateDocCalls, toasts, saTabCalls } = buildSandbox({
            elements: { 'cife-email': { value: 'react@x.com' }, 'cife-role': { value: 'user' } },
            usersStore: { u2: { email: 'react@x.com', status: 'blocked', allRoles: [] } },
        });
        await sandbox.window.saCreateIndividualForEntityConfirm('ent1');
        ok('10a · reactivación -> updateDoc sobre el mismo doc con clubId=ente', updateDocCalls.length === 1 && updateDocCalls[0].data.clubId === 'ent1');
        ok('10b · status/isAuthorized reactivados', updateDocCalls[0].data.status === 'active' && updateDocCalls[0].data.isAuthorized === true);
        ok('10c · toast menciona el ente + vuelve a individuals', toasts.some(t => /reactivado.*asignado/i.test(t)) && saTabCalls.includes('individuals'));
    }

    console.log('\n── PARTE 11 · saCreateIndividualForEntityConfirm — usuario nuevo + slots ──');
    const slotCases = [
        ['admin_individual', 'admins', true],
        ['individual', 'admins', true],
        ['entrenador_individual', 'coaches', false],
        ['parent_individual', 'parents', false],
        ['user', 'coaches', false],
    ];
    for (const [role, expectedSlot, expectHasAdmin] of slotCases) {
        const { sandbox, setDocCalls, updateDocCalls } = buildSandbox({
            elements: { 'cife-email': { value: role + '@x.com' }, 'cife-name': { value: 'N' }, 'cife-role': { value: role }, 'cife-sendemail': { checked: false } },
            clubsStore: { ent1: { name: 'Ente', usedSlots: { admins: 0, coaches: 0, parents: 0 } } },
            usersStore: {},
        });
        await sandbox.window.saCreateIndividualForEntityConfirm('ent1');
        const preCreated = setDocCalls.find(c => c.col === 'users');
        ok(`11 · rol "${role}" -> crea con individualEntityId/individualOwnerId=ente`,
           preCreated && preCreated.data.individualEntityId === 'ent1' && preCreated.data.individualOwnerId === 'ent1' && preCreated.data.clubId === 'ent1');
        const slotUpdate = updateDocCalls.find(c => c.id === 'ent1');
        ok(`11 · rol "${role}" -> incrementa usedSlots.${expectedSlot}`, slotUpdate && slotUpdate.data['usedSlots.' + expectedSlot] === 1, slotUpdate && slotUpdate.data);
        if (expectHasAdmin) {
            ok(`11 · rol "${role}" -> marca hasAdmin/adminEmail del ente`, slotUpdate && slotUpdate.data.hasAdmin === true && slotUpdate.data.adminEmail === role + '@x.com');
        } else {
            ok(`11 · rol "${role}" -> NO marca hasAdmin`, slotUpdate && slotUpdate.data.hasAdmin === undefined);
        }
    }

    console.log('\n── PARTE 12 · saCreateIndividualForEntityConfirm — email de invitación ──');
    {
        const { sandbox, httpsCallableCalls } = buildSandbox({
            elements: { 'cife-email': { value: 'invite@x.com' }, 'cife-role': { value: 'user' }, 'cife-sendemail': { checked: true } },
            clubsStore: { ent1: { name: 'Ente', usedSlots: {} } },
            usersStore: {},
        });
        await sandbox.window.saCreateIndividualForEntityConfirm('ent1');
        ok('12a · sendEmail marcado + fa.functions -> llama sendInviteEmail', httpsCallableCalls.some(c => c.name === 'sendInviteEmail' && c.payload.to === 'invite@x.com'));
    }
    {
        const { sandbox, httpsCallableCalls } = buildSandbox({
            elements: { 'cife-email': { value: 'noinvite@x.com' }, 'cife-role': { value: 'user' }, 'cife-sendemail': { checked: false } },
            clubsStore: { ent1: { name: 'Ente', usedSlots: {} } },
            usersStore: {},
        });
        await sandbox.window.saCreateIndividualForEntityConfirm('ent1');
        ok('12b · sendEmail desmarcado -> NO llama a sendInviteEmail', httpsCallableCalls.length === 0);
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();

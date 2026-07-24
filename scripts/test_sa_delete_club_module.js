// ─────────────────────────────────────────────────────────────────────────
// test_sa_delete_club_module.js · Refactor de monolitos (auditoría
// 2026-07-22, hallazgo #9) — PASO 4: extracción de "Borrado completo de un
// club" (saDeleteClubComplete) desde js/admin/superadmin/superadmin.panel.js
// a su propio archivo.
//
// setupClubsSyncListener (justo al lado en el archivo original) se deja
// donde está: llama a saIndividuals/saClubs/saCountPendingRequests/
// saRequests, funciones de OTRAS secciones aún sin extraer — mayor
// acoplamiento que saDeleteClubComplete, que es autocontenido (solo
// Firestore + confirm + toast). Se extraerá junto a esas pestañas.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.existsSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'delete-club.js'))
    ? path.join(ROOT, 'js', 'admin', 'superadmin', 'delete-club.js')
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Borrado completo de club (saDeleteClubComplete) — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Infra: fakes de Firestore ═══════════════════════
function buildSandbox({ usersStore = {}, clubsStore = {}, requestsStore = {}, confirmReturns = true, deleteClubThrows = null } = {}) {
    const updateDocCalls = [];
    const deleteDocCalls = [];
    const toasts = [];
    const saTabCalls = [];

    const fns = {
        db: {},
        doc: (db, col, id) => ({ __col: col, __id: id }),
        deleteDoc: async (ref) => {
            deleteDocCalls.push({ col: ref.__col, id: ref.__id });
            if (ref.__col === 'clubs' && deleteClubThrows) throw new Error(deleteClubThrows);
            if (ref.__col === 'users') delete usersStore[ref.__id];
            if (ref.__col === 'clubs') delete clubsStore[ref.__id];
            if (ref.__col === 'platform_requests') delete requestsStore[ref.__id];
        },
        updateDoc: async (ref, data) => {
            updateDocCalls.push({ col: ref.__col, id: ref.__id, data });
            if (ref.__col === 'users') Object.assign(usersStore[ref.__id], data);
        },
        collection: (db, col) => ({ __col: col }),
        query: (collRef, ...clauses) => ({ __col: collRef.__col, __clauses: clauses }),
        where: (field, op, value) => ({ field, op, value }),
        getDocs: async (qOrColl) => {
            const col = qOrColl.__col;
            const store = col === 'users' ? usersStore : col === 'clubs' ? clubsStore : requestsStore;
            const clauses = qOrColl.__clauses || [];
            const entries = Object.entries(store).filter(([id, data]) =>
                clauses.every(c => data[c.field] === c.value));
            return {
                size: entries.length,
                forEach: (cb) => entries.forEach(([id, data]) => cb({ id, data: () => data })),
            };
        },
    };

    const sandbox = {
        window: {},
        document: {},
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Array, Object, String,
        saFS: async () => fns,
        saTab: (tab) => { saTabCalls.push(tab); },
    };
    sandbox.window.saFS = sandbox.saFS;
    sandbox.window.saTab = sandbox.saTab;
    vm.createContext(sandbox);

    const src = fs.readFileSync(SOURCE, 'utf8');
    const start = src.indexOf('window.saDeleteClubComplete = async function');
    const endMarker = src.indexOf('CREAR ENTE INDIVIDUAL') !== -1 ? 'CREAR ENTE INDIVIDUAL' : null;
    const end = endMarker ? src.indexOf(endMarker) : -1;
    const block = end !== -1 ? src.slice(start, end) : src.slice(start);
    if (start === -1) throw new Error('No se encontró saDeleteClubComplete en ' + SOURCE);

    const stubs = `
        var _saShowSpinner = function(msg) { __spinners.push({on:true, msg}); };
        var _saHideSpinner = function() { __spinners.push({on:false}); };
        var _saToast = function(msg, ms) { __toasts.push(msg); };
        var saFS = window.saFS;
        var saTab = window.saTab;
    `;
    sandbox.__spinners = [];
    sandbox.__toasts = toasts;
    vm.runInContext(stubs + block, sandbox);

    return { sandbox, usersStore, clubsStore, requestsStore, updateDocCalls, deleteDocCalls, toasts, saTabCalls };
}

(async () => {
    console.log('── PARTE 1 · estructura ──');
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');
    ok('1a · saDeleteClubComplete existe', /window\.saDeleteClubComplete\s*=\s*async function/.test(rawSrc));

    console.log('\n── PARTE 2 · confirm() cancelado ──');
    {
        const { sandbox, deleteDocCalls, updateDocCalls } = buildSandbox({ confirmReturns: false });
        await sandbox.window.saDeleteClubComplete('club-1', 'CD Prueba');
        ok('2a · cancelado -> ningún deleteDoc', deleteDocCalls.length === 0);
        ok('2b · cancelado -> ningún updateDoc', updateDocCalls.length === 0);
    }

    console.log('\n── PARTE 3 · borrado completo (happy path) ──');
    {
        const { sandbox, usersStore, updateDocCalls, deleteDocCalls, toasts, saTabCalls } = buildSandbox({
            clubsStore: { 'club-1': { name: 'CD Prueba' } },
            usersStore: {
                // Usuario normal, SOLO en este club, sin otros roles -> queda 'free'.
                u1: { clubId: 'club-1', clubName: 'CD Prueba', role: 'user', isAuthorized: true, allRoles: [{ role: 'user', clubId: 'club-1', isAuthorized: true }] },
                // Usuario multi-rol: pierde el rol de este club pero conserva otro activo en OTRO club.
                u2: { clubId: 'club-1', clubName: 'CD Prueba', role: 'coach', isAuthorized: true,
                      allRoles: [{ role: 'coach', clubId: 'club-1', isAuthorized: true }, { role: 'parent', clubId: 'club-2', isAuthorized: true }] },
                // SuperAdmin con un rol residual en allRoles para este club -> solo se limpia allRoles.
                u3: { clubId: null, role: 'superadmin', isAuthorized: true, allRoles: [{ role: 'director', clubId: 'club-1', isAuthorized: true }] },
                // Usuario de OTRO club, no afectado.
                u4: { clubId: 'club-9', clubName: 'Otro Club', role: 'user', isAuthorized: true, allRoles: [{ role: 'user', clubId: 'club-9', isAuthorized: true }] },
            },
            requestsStore: {
                r1: { clubId: 'club-1' },
                r2: { clubId: 'club-9' },
            },
        });

        await sandbox.window.saDeleteClubComplete('club-1', 'CD Prueba');

        const u1Update = updateDocCalls.find(c => c.id === 'u1');
        ok('3a · usuario mono-rol sin alternativa -> role/status null/free, isAuthorized false',
           u1Update && u1Update.data.role === null && u1Update.data.status === 'free' && u1Update.data.isAuthorized === false, u1Update);
        ok('3b · usuario mono-rol -> clubId/clubName limpiados', u1Update && u1Update.data.clubId === null && u1Update.data.clubName === null);
        ok('3c · usuario mono-rol -> allRoles queda sin la entrada de este club', u1Update && u1Update.data.allRoles.length === 0);

        const u2Update = updateDocCalls.find(c => c.id === 'u2');
        ok('3d · usuario multi-rol con otro rol activo -> role pasa al rol restante (parent)',
           u2Update && u2Update.data.role === 'parent' && u2Update.data.status === 'active' && u2Update.data.isAuthorized === true, u2Update);
        ok('3e · usuario multi-rol -> allRoles conserva SOLO el rol del otro club', u2Update && u2Update.data.allRoles.length === 1 && u2Update.data.allRoles[0].clubId === 'club-2');

        const u3Update = updateDocCalls.find(c => c.id === 'u3');
        ok('3f · [SuperAdmin] solo se toca allRoles, NO su rol/clubId/status', u3Update && Object.keys(u3Update.data).length === 1 && 'allRoles' in u3Update.data);
        ok('3g · [SuperAdmin] allRoles queda sin la entrada de este club', u3Update && u3Update.data.allRoles.length === 0);

        ok('3h · usuario de OTRO club NO recibe ningún updateDoc', !updateDocCalls.some(c => c.id === 'u4'));

        ok('3i · borra las platform_requests del club (no las de otros clubes)',
           deleteDocCalls.some(c => c.col === 'platform_requests' && c.id === 'r1') &&
           !deleteDocCalls.some(c => c.col === 'platform_requests' && c.id === 'r2'));

        ok('3j · borra el documento del club', deleteDocCalls.some(c => c.col === 'clubs' && c.id === 'club-1'));
        ok('3k · toast de éxito menciona el nombre del club', toasts.some(t => /CD Prueba/.test(t) && /borrado/.test(t)));
        ok('3l · vuelve a la pestaña clubs tras borrar', saTabCalls.includes('clubs'));
    }

    console.log('\n── PARTE 4 · error al borrar ──');
    {
        const { sandbox, toasts, saTabCalls } = buildSandbox({
            clubsStore: { 'club-1': { name: 'CD Prueba' } },
            usersStore: {},
            deleteClubThrows: 'permission-denied',
        });
        await sandbox.window.saDeleteClubComplete('club-1', 'CD Prueba');
        ok('4a · fallo al borrar el club -> toast de error', toasts.some(t => /Error al borrar/.test(t) && /permission-denied/.test(t)));
        ok('4b · fallo al borrar el club -> NO vuelve a la pestaña clubs', !saTabCalls.includes('clubs'));
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();

// ─────────────────────────────────────────────────────────────────────────
// test_sec_c1_clubid.js  ·  SEC-C1: cerrar auto-asignación de clubId
//
// Verifica el fix COMBINADO (Opción A + B) con el CÓDIGO REAL:
//   · La Cloud Function syncRootClubId (functions/index.js).
//   · El trigger autoSetClaimsOnApproval ampliado (functions/index.js).
//   · La regla `allow update` de users/{userId} endurecida (firestore.rules).
//   · Los 4 call-sites cliente de _cResolveClubId (ya no escriben clubId con
//     updateDoc directo; delegan la migración de la raíz en la CF
//     syncRootClubId). 2 en comms/panel.js + 2 en club-reports.js.
//     (auditoría 2026-07-22: se referenciaba también un 5º sitio en
//     club-reports.js, `sdSendBulkMsg` — esa función ya no existe en el
//     código: fue sustituida por el sistema de mensajería unificado
//     `_umState` (ver CORRECCIONES_ESTADO.md). No es un hueco real.)
//
// No reimplementa la lógica: carga functions/index.js en un sandbox con
// firebase-functions/firebase-admin MOCKEADOS, de modo que onCall/onWrite
// devuelven el handler REAL, y admin.firestore()/admin.auth() son fakes en
// memoria sobre los que se comprueban las escrituras.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

// ═══════════════════════ Infra: fakes de Firestore/Auth ═══════════════════
function makeFakeAdmin(store, authUsers) {
    const FieldValue = { serverTimestamp: () => ({ __ts: Date.now() }),
                         arrayUnion: (...v) => ({ __arrayUnion: v }) };
    function docRef(col, id) {
        return {
            async get() {
                const exists = store[col] && Object.prototype.hasOwnProperty.call(store[col], id);
                return { exists, data: () => (exists ? store[col][id] : undefined) };
            },
            async set(data, opts) {
                store[col] = store[col] || {};
                const cur = store[col][id] || {};
                store[col][id] = (opts && opts.merge) ? Object.assign({}, cur, data) : data;
            },
            async update(data) {
                store[col] = store[col] || {};
                store[col][id] = Object.assign({}, store[col][id] || {}, data);
            },
        };
    }
    return {
        initializeApp() {},
        firestore: Object.assign(
            () => ({ collection: (col) => ({ doc: (id) => docRef(col, id),
                                             add: async (d) => { store[col] = store[col] || {}; store[col]['_auto' + Math.random()] = d; } }) }),
            { FieldValue }
        ),
        auth: () => ({
            async getUser(uid) { return { customClaims: (authUsers[uid] || {}).customClaims || {} }; },
            async setCustomUserClaims(uid, claims) { authUsers[uid] = authUsers[uid] || {}; authUsers[uid].customClaims = claims; },
        }),
    };
}

// HttpsError real-ish: instanceof se comprueba en el código de la CF.
class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; this.name = 'HttpsError'; }
}

function loadFunctions(store, authUsers) {
    const captured = {}; // exports.<name> = handler
    const triggers = {};

    // Builder encadenable para .document().onWrite()/.onCreate()/.onUpdate()
    function fsBuilder(kind) {
        const b = {};
        b.document = () => b;
        b.onWrite = (fn) => { triggers.__last = { kind, event: 'onWrite', fn }; return triggers.__last; };
        b.onCreate = (fn) => { triggers.__last = { kind, event: 'onCreate', fn }; return triggers.__last; };
        b.onUpdate = (fn) => { triggers.__last = { kind, event: 'onUpdate', fn }; return triggers.__last; };
        return b;
    }
    const functionsMock = {
        https: {
            onCall: (fn) => ({ __onCall: fn }),
            HttpsError,
        },
        firestore: fsBuilder('firestore'),
        pubsub: { schedule: () => ({ onRun: (fn) => ({ __onRun: fn }) }) },
        auth: { user: () => ({ onDelete: (fn) => ({ __onDelete: fn }) }) },
        runWith: () => functionsMock, // .runWith({secrets}).https.onCall
    };
    const adminMock = makeFakeAdmin(store, authUsers);

    const src = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
    const sandboxModule = { exports: {} };
    const requireShim = (name) => {
        if (name === 'firebase-functions/v1' || name === 'firebase-functions') return functionsMock;
        if (name === 'firebase-admin') return adminMock;
        if (name === 'nodemailer') return { createTransport: () => ({ sendMail: async () => ({}) }) };
        return require(name);
    };
    const wrapper = Module.wrap(src);
    const compiled = vm.runInThisContext(wrapper, { filename: 'functions/index.js' });
    compiled.call(sandboxModule.exports, sandboxModule.exports, requireShim, sandboxModule, 'functions/index.js', path.join(ROOT, 'functions'));

    return { exports: sandboxModule.exports };
}

// ═══════════════════════ PARTE 1 · CF syncRootClubId ══════════════════════
console.log('\n── PARTE 1 · Cloud Function syncRootClubId (código real) ──');

async function callSync(userDoc, data, ctxAuth) {
    const store = { users: {} };
    if (userDoc) store.users['U1'] = userDoc;
    const authUsers = {};
    const { exports } = loadFunctions(store, authUsers);
    const cf = exports.syncRootClubId.__onCall;
    let error = null, result = null;
    // 🛡️ v646 · `app` va SIEMPRE, porque una llamada real siempre lo trae: desde
    // v646 las callable exigen App Check y `_exigirAppCheck` corta en la primera
    // linea si `context.app` falta. Sin esto, las seis aserciones de esta parte
    // se volvieron rojas de golpe — no porque la autorizacion fallara, sino
    // porque no llegaban a ejecutarla. 🔑 Lo que aqui se prueba es el permiso
    // por clubId; el cedazo de App Check lo cubre test_app_check.js (5d).
    try { result = await cf(data, {
        auth: ctxAuth === undefined ? { uid: 'U1' } : ctxAuth,
        app: { appId: '1:393110572633:web:test' },
    }); }
    catch (e) { error = e; }
    return { store, result, error };
}

(async () => {
    // ══════════════════════════════════════════════════════════════════
    //  🚨 SEC-F04 (2026-08-31) · 1a FIJABA LA VIA POR LA QUE SE ESCALABA
    //
    //  Decia: «clubId presente en allRoles autorizado → éxito, raíz poblada».
    //  Eso ERA el defecto. `allRoles` NO esta protegido por el `allow update`
    //  de `users/{userId}` —solo lo estan las claves de primer nivel—, asi
    //  que el propio usuario podia escribirse `{clubId:'CLUB_B',
    //  isAuthorized:true}`, llamar aqui, y esta funcion le escribia el
    //  `clubId` de la RAIZ con el Admin SDK. `isClubDirectorOf` lee esa raiz:
    //  director de un club ajeno.
    //
    //  🔑 El caso se INVIERTE, no se borra: lo que antes tenia que pasar es
    //  justo lo que ahora tiene que fallar. Y se conserva el camino legitimo
    //  (confirmar el club que la raiz ya dice), para que quede claro que la
    //  funcion sigue viva y no se ha desactivado por las bravas.
    //
    //  ⚠️ Medido en produccion antes de cambiarlo: las 10 plazas autorizadas
    //  tienen el mismo `clubId` que su raiz, o sea que nadie dependia de esta
    //  migracion. ⏳ Se recupera en el paso 3 con una rama corroborada por el
    //  DOCUMENTO DEL CLUB. ⛔ No devolverla mirando `allRoles`.
    // ══════════════════════════════════════════════════════════════════
    {
        const { result, error } = await callSync(
            { isAuthorized: true, status: 'active', allRoles: [{ role: 'director', clubId: 'CLUB_B', isAuthorized: true }] },
            { clubId: 'CLUB_B' });
        ok('1a · 🔑🔑 una plaza SOLO en allRoles ya NO mueve la raíz (escalada cross-club)',
           !!error && /no corresponde/i.test(error.message || ''),
           'el usuario se escribe esa entrada él mismo: ' + (error ? error.message : 'NO HUBO ERROR'));
    }
    // 1a2. El camino legítimo: confirmar el club que la raíz ya dice.
    {
        const { store, result, error } = await callSync(
            { isAuthorized: true, status: 'active', clubId: 'CLUB_A',
              allRoles: [{ role: 'director', clubId: 'CLUB_A', isAuthorized: true }] },
            { clubId: 'CLUB_A' });
        ok('1a2 · …pero confirmar el club que YA dice la raíz sigue funcionando',
           !error && result && result.success === true, error && error.message);
        ok('1a2 · y la raíz sigue en CLUB_A', store.users.U1.clubId === 'CLUB_A', JSON.stringify(store.users.U1));
    }

    // 1b. clubId AJENO (no está en allRoles ni en raíz) → permission-denied.
    {
        const { store, error } = await callSync(
            { isAuthorized: true, status: 'active', allRoles: [{ role: 'director', clubId: 'CLUB_A', isAuthorized: true }] },
            { clubId: 'CLUB_AJENO' });
        ok('1b · clubId ajeno → permission-denied', error && error.code === 'permission-denied', error && (error.code + ' ' + error.message));
        ok('1b · NO se escribió clubId ajeno en la raíz', !store.users.U1.clubId, JSON.stringify(store.users.U1));
    }

    // 1c. usuario isAuthorized:false → permission-denied (aunque el club sea suyo).
    {
        const { error } = await callSync(
            { isAuthorized: false, status: 'active', allRoles: [{ role: 'director', clubId: 'CLUB_A' }] },
            { clubId: 'CLUB_A' });
        ok('1c · isAuthorized:false → permission-denied', error && error.code === 'permission-denied', error && error.code);
    }

    // 1d. usuario status:'rejected' → permission-denied.
    {
        const { error } = await callSync(
            { isAuthorized: true, status: 'rejected', allRoles: [{ role: 'director', clubId: 'CLUB_A', isAuthorized: true }] },
            { clubId: 'CLUB_A' });
        ok('1d · status:rejected → permission-denied', error && error.code === 'permission-denied', error && error.code);
    }

    // 1e. rol dentro de allRoles con status:'removed' → no cuenta como respaldo.
    {
        const { error } = await callSync(
            { isAuthorized: true, status: 'active', allRoles: [{ role: 'director', clubId: 'CLUB_A', status: 'removed' }] },
            { clubId: 'CLUB_A' });
        ok('1e · allRoles[].status:removed no respalda el clubId → denied', error && error.code === 'permission-denied', error && error.code);
    }

    // 1f. sin auth → unauthenticated.
    {
        const { error } = await callSync({ isAuthorized: true, status: 'active', allRoles: [] }, { clubId: 'CLUB_A' }, null);
        ok('1f · sin context.auth → unauthenticated', error && error.code === 'unauthenticated', error && error.code);
    }

    // 1g. clubId ya poblado y coincide → idempotente (migrated:false).
    {
        const { result, error } = await callSync(
            { isAuthorized: true, status: 'active', clubId: 'CLUB_A', allRoles: [{ role: 'director', clubId: 'CLUB_A', isAuthorized: true }] },
            { clubId: 'CLUB_A' });
        ok('1g · clubId ya coincide → idempotente (migrated:false)', !error && result && result.migrated === false, error && error.message);
    }

    // 1h. data sin clubId → invalid-argument.
    {
        const { error } = await callSync({ isAuthorized: true, status: 'active', allRoles: [] }, {});
        ok('1h · data sin clubId → invalid-argument', error && error.code === 'invalid-argument', error && error.code);
    }

    // ═══════════════════ PARTE 2 · trigger autoSetClaimsOnApproval ═════════
    console.log('\n── PARTE 2 · trigger autoSetClaimsOnApproval (código real) ──');

    async function runTrigger(before, after, claims) {
        const store = { users: { U1: Object.assign({}, after) } };
        const authUsers = { U1: { customClaims: claims || {} } };
        const { exports } = loadFunctions(store, authUsers);
        const trig = exports.autoSetClaimsOnApproval;
        const fn = trig.fn;
        const change = {
            before: { exists: !!before, data: () => before },
            after:  { exists: !!after,  data: () => after },
        };
        await fn(change, { params: { userId: 'U1' } });
        return { store, authUsers };
    }

    // 2a. Aprobación de un rol nuevo (SA toca allRoles y root isAuthorized) con
    //     clubId SOLO en allRoles → el trigger puebla la raíz sin cliente.
    {
        const before = { role: 'director', isAuthorized: false, status: 'pending', allRoles: [{ role: 'director', clubId: 'CLUB_A', isAuthorized: false }] };
        const after  = { role: 'director', isAuthorized: true,  status: 'active',  allRoles: [{ role: 'director', clubId: 'CLUB_A', isAuthorized: true }] };
        const { store, authUsers } = await runTrigger(before, after, {});
        ok('2a · trigger puebla clubId raíz automáticamente', store.users.U1.clubId === 'CLUB_A', JSON.stringify(store.users.U1));
        ok('2a · trigger asigna custom claim clubId', authUsers.U1.customClaims.clubId === 'CLUB_A', JSON.stringify(authUsers.U1.customClaims));
    }

    // 2b. Claims YA correctos pero raíz vacía y solo cambió allRoles →
    //     el trigger igualmente migra la raíz (cierra la ventana de carrera).
    {
        const before = { role: 'director', isAuthorized: true, status: 'active', allRoles: [{ role: 'director', clubId: 'CLUB_A', isAuthorized: true }] };
        const after  = { role: 'director', isAuthorized: true, status: 'active', allRoles: [{ role: 'director', clubId: 'CLUB_A', isAuthorized: true }, { role: 'coach', clubId: 'CLUB_A', isAuthorized: true }] };
        const { store } = await runTrigger(before, after, { role: 'director', clubId: 'CLUB_A' });
        ok('2b · claims ya OK + allRoles cambia → raíz migrada igualmente', store.users.U1.clubId === 'CLUB_A', JSON.stringify(store.users.U1));
    }

    // 2c. Usuario removido → el trigger NO puebla clubId.
    {
        const before = { role: 'director', isAuthorized: true, status: 'active', allRoles: [{ role: 'director', clubId: 'CLUB_A' }] };
        const after  = { role: 'director', isAuthorized: true, status: 'removed', allRoles: [{ role: 'director', clubId: 'CLUB_A' }] };
        const { store } = await runTrigger(before, after, {});
        ok('2c · usuario removed → trigger NO puebla clubId', !store.users.U1.clubId, JSON.stringify(store.users.U1));
    }

    // ═══════════════════ PARTE 3 · regla allow update endurecida ═══════════
    console.log('\n── PARTE 3 · regla allow update de users/{userId} (firestore.rules) ──');

    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    // Extraer el bloque de la regla allow update dentro de match /users/{userId}.
    const usersBlock = rules.slice(rules.indexOf('match /users/{userId}'),
                                  rules.indexOf('allow delete: if isSuperAdmin();', rules.indexOf('match /users/{userId}')));
    const allowUpdate = usersBlock.slice(usersBlock.indexOf('allow update:'));

    // 3a. Ya NO existen las ramas hasOnly(['clubId', ...]) que permitían escribir clubId.
    ok('3a · sin rama hasOnly([\'clubId\', \'allRoles\'])', !allowUpdate.includes("hasOnly(['clubId', 'allRoles'])"), allowUpdate.slice(0, 200));
    ok('3b · sin rama hasOnly([\'clubId\'])', !allowUpdate.includes("hasOnly(['clubId'])"));

    // 3c. clubId está ahora en la lista PROHIBIDA de hasAny().
    ok('3c · clubId está en la lista prohibida de hasAny()',
       /hasAny\(\[[^\]]*'clubId'[^\]]*\]\)/.test(allowUpdate),
       allowUpdate.match(/hasAny\([^)]*\)/) && allowUpdate.match(/hasAny\([^)]*\)/)[0]);

    // 3d. Simulación de la regla: cliente intenta escribir clubId → DENY.
    //     Modela hasAny(prohibidos) sobre affectedKeys.
    const FORBIDDEN = ['role', 'isAuthorized', 'status', 'clubId', 'clubName', 'authorizedAt', 'authorizedBy', 'blockedAt'];
    function ruleAllowsUpdate(affectedKeys) {
        // isAuth && uid==userId && !affectedKeys.hasAny(FORBIDDEN)
        return !affectedKeys.some(k => FORBIDDEN.includes(k));
    }
    ok('3d · escribir solo {clubId} → DENY', ruleAllowsUpdate(['clubId']) === false);
    ok('3e · escribir {clubId, allRoles} → DENY', ruleAllowsUpdate(['clubId', 'allRoles']) === false);
    ok('3f · escribir {allRoles} (multi-rol legítimo) → ALLOW', ruleAllowsUpdate(['allRoles']) === true);
    ok('3g · escribir {playerAlias, inviteCode} (perfil) → ALLOW', ruleAllowsUpdate(['playerAlias', 'inviteCode']) === true);

    // ═══════════════════ PARTE 4 · call-sites cliente ═════════════════════
    console.log('\n── PARTE 4 · call-sites cliente (ya no escriben clubId directo) ──');

    // Los dos call-sites de _cResolveClubId de comms/panel.js vivían en el §8
    // de envío de informes, que se partió en dos al descomponer el monolito
    // (auditoría 2026-07-22, pasos 6a/6b, 2026-07-27): uno se fue al camino
    // MANUAL y otro al AUTOMÁTICO. Se leen todos y se cuentan juntos, para que
    // el recuento siga describiendo la misma superficie de código. Los que aún
    // no estén extraídos se ignoran.
    const panel = [
        'js/coach/comms/panel.js',
        'js/coach/comms/match-reports-send.js',
        'js/coach/comms/match-reports-auto.js',
    ].filter(f => fs.existsSync(path.join(ROOT, f)))
     .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    // El monolito club-reports.js se descompuso (auditoría 2026-07-22, paso 5
    // de 6 el 2026-07-26): uno de los dos call-sites de _cResolveClubId se
    // quedó en club-reports.js (openStaffDashboard) y el otro se fue a
    // reports-tab.js (_sdLoadReports). Se leen LOS DOS y se cuentan juntos.
    const creports = [
        ['js', 'coach', 'reports', 'club-reports.js'],
        ['js', 'coach', 'reports', 'reports-tab.js'],
    ].map(p => fs.readFileSync(path.join(ROOT, ...p), 'utf8')).join('\n');

    // 4a. _cResolveClubId ya NO hace updateDoc; usa la CF syncRootClubId.
    const resolveFn = panel.slice(panel.indexOf('async function _cResolveClubId'),
                                  panel.indexOf('window._cResolveClubId = _cResolveClubId'));
    ok('4a · _cResolveClubId no llama a fns.updateDoc', !/fns\.updateDoc/.test(resolveFn));
    ok('4b · _cResolveClubId invoca syncRootClubId (CF)', /syncRootClubId/.test(resolveFn), 'no se encontró syncRootClubId en _cResolveClubId');

    // 4c. Ningún call-site sigue pasando updateDoc a _cResolveClubId.
    const callSitesPassingUpdate =
        (panel.match(/_cResolveClubId\(db, me, \{ doc, getDoc, updateDoc \}\)/g) || []).length +
        (creports.match(/_cResolveClubId\(db, me, \{ doc, getDoc, updateDoc \}\)/g) || []).length;
    ok('4c · 0 call-sites pasan updateDoc a _cResolveClubId', callSitesPassingUpdate === 0, 'encontrados: ' + callSitesPassingUpdate);

    // 4d. Los 5 call-sites existen (2 en panel, 3 en club-reports).
    const totalCallsPanel = (panel.match(/_cResolveClubId\(db, me,/g) || []).length; // incluye definición? no: la def es "function _cResolveClubId(db, me, fns)"
    const callsPanel = (panel.match(/await _cResolveClubId\(db, me,/g) || []).length;
    const callsReports = (creports.match(/_cResolveClubId\(db, me,/g) || []).length;
    ok('4d · 2 llamadas en comms/panel.js', callsPanel === 2, 'encontradas: ' + callsPanel);
    ok('4e · 2 llamadas en club-reports.js', callsReports === 2, 'encontradas: ' + callsReports);

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass} passed)`);
    process.exit(fail ? 1 : 0);
})();

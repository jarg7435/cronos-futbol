// ─────────────────────────────────────────────────────────────────────────
//  test_reenvio_ente_al_sa_rules.js  ·  v687
//
//  Reportado por el autor (implementar.txt + capturas 10250-10251): en el
//  panel del Entrenador Administrador Individual, «📤 Reenviar al SA» sobre el
//  alta de un familiar → "Missing or insufficient permissions" en
//  indForwardToSA, y la solicitud se quedaba colgada en «Solicitudes».
//
//  🔑 CAUSA: el `allow update` de platform_requests pedia
//  `sameClubAsDoc(clubId)`, y las altas del ente (`ind_sub_registration`) NO
//  LLEVAN clubId —solo `individualOwnerId`—. Esa rama no podia cumplirse nunca
//  para ellas: solo pasaba el SuperAdmin. (El reenvio del CLUB no lo sufre
//  porque CREA una solicitud nueva `fwd_…`; el del ente ACTUALIZA la que hay.)
//
//  PARTE 1 · el reenvio real TIENE que pasar (el defecto: rojo con la regla
//            vieja — `node scripts/test_reenvio_ente_al_sa_rules.js <reglas>`).
//  PARTE 2 · lo que la rama nueva NO puede abrir: que el ente apruebe, que
//            un miembro cualquiera del ente reenvie, que se mude la solicitud
//            a otro ente o a un club ajeno, que se ascienda el rol...
//  PARTE 3 · el cliente y la regla hablan de LOS MISMOS campos: si alguien
//            anade un campo al reenvio y no a la regla, el reenvio vuelve a
//            morir con el mismo error y sin pista ninguna.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROJECT = 'cronos-futbol-app';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';
const P = `${DB}/platform_requests/ind_reg_prueba`;
// Para el red-check: se le puede pasar otro fichero de reglas (la version vieja).
const RULES = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'firestore.rules');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};

function getAccessToken(refreshToken) {
    const body = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    return new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            res => { const ch = []; res.on('data', c => ch.push(c));
                res.on('end', () => { const d = Buffer.concat(ch).toString('utf8');
                    try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); } catch (e) { reject(new Error(d.slice(0, 200))); } }); });
        req.on('error', reject); req.write(body); req.end();
    });
}
function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: {
            Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body) } },
            res => { const ch = []; res.on('data', c => ch.push(c));
                res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch).toString('utf8') })); });
        req.on('error', reject); req.write(body); req.end();
    });
}

const ENTE = 'individual_ente_prueba', OTRO_ENTE = 'individual_ente_ajeno', CLUB_AJENO = 'club_ajeno';
const ADMIN = 'uid_admin_ente';          // el Entrenador Administrador Individual
const ADMIN_AJENO = 'uid_admin_otro_ente';
const FAM = 'uid_familiar';              // quien se dio de alta
const MIEMBRO = 'uid_entrenador_del_ente';

// ⚠️ `isAdminOfClub` pasa por `isClubAdminOf` (exists/get de `clubs/{id}`) y
//    por `isClubDirectorOf` (get de `users/{uid}`). Sin sus dobles la
//    evaluacion REVIENTA y un error DENIEGA: los DENY saldrian verdes sin
//    probar nada. Por eso la `0d` trata `errorPosition` como fallo.
function mocks(uid, userDoc) {
    const u = `${DB}/users/${uid}`;
    const club = (id, datos) => ([
        { function: 'exists', args: [{ exactValue: `${DB}/clubs/${id}` }], result: { value: !!datos } },
        { function: 'get', args: [{ exactValue: `${DB}/clubs/${id}` }], result: { value: { data: datos || {} } } },
    ]);
    return [
        { function: 'exists', args: [{ exactValue: u }], result: { value: !!userDoc } },
        { function: 'get', args: [{ exactValue: u }], result: { value: { data: userDoc || {} } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
          result: { value: { data: { emails: ['sa@x.es'] } } } },
    ]
    .concat(club(ENTE, { type: 'individual', adminUid: ADMIN, adminEmail: ADMIN + '@x.es', status: 'active' }))
    .concat(club(OTRO_ENTE, { type: 'individual', adminUid: ADMIN_AJENO, adminEmail: ADMIN_AJENO + '@x.es' }))
    .concat(club(CLUB_AJENO, { adminUid: 'uid_admin_club_ajeno', adminEmail: 'club@x.es' }));
}
const DOC_ADMIN = { role: 'individual', clubId: ENTE, individualEntityId: ENTE, isAuthorized: true, status: 'active' };
const DOC_FAM = { role: 'parent', clubId: ENTE, isAuthorized: false, status: 'pending_individual' };
const DOC_MIEMBRO = { role: 'user', clubId: ENTE, isAuthorized: true, status: 'active' };

const auth = (uid, token) => ({ uid, token: Object.assign(
    { email: uid + '@x.es', firebase: { sign_in_provider: 'password' } }, token || {}) });
const TOKEN_ADMIN = { role: 'individual', clubId: ENTE };   // lo que pone approveIndividualAdmin

// La solicitud TAL COMO LA ESCRIBE el alta (js/services/auth.js, rama
// `isUnderIndiv && needsApproval`): individualOwnerId y NINGUN clubId.
const ANTES = {
    type: 'ind_sub_registration', individualOwnerId: ENTE, individualOwnerEmail: ADMIN + '@x.es',
    inviteCode: null, requestedEmail: 'familiar@x.es', requestedName: '',
    requestedRole: 'parent', requestedRoleLabel: 'Familiar / Jugador Individual',
    requestedModality: null, userUid: FAM, status: 'pending_individual',
    createdAt: '2026-09-10T13:00:00.000Z',
};
// Lo que escribe indForwardToSA (js/admin/individual/panel.js) sobre ella.
const REENVIO = {
    status: 'pending_sa', forwardedAt: '2026-09-10T13:06:00.000Z',
    forwardedBy: ADMIN, forwardedByEmail: ADMIN + '@x.es',
    clubId: ENTE, individualEntityId: ENTE,
};
const upd = (uid, token, antes, cambios, userDoc) => ({
    req: { auth: auth(uid, token), path: P, method: 'update',
           resource: { data: Object.assign({}, antes, cambios) } },
    resource: { data: antes },
    mocks: mocks(uid, userDoc),
});

function casos() {
    return [
        // ══ (1) EL REENVIO REAL — TIENE QUE PASAR ══
        Object.assign({ n: '1a · 🔑🔑 el admin del ente REENVIA el alta de un familiar (las capturas)',
          exp: 'ALLOW', nota: 'ESTE es el defecto: con la regla vieja sale DENY' },
          upd(ADMIN, TOKEN_ADMIN, ANTES, REENVIO, DOC_ADMIN)),

        Object.assign({ n: '1b · 🔑 reenvio con la modalidad traducida a su equipo (v685)', exp: 'ALLOW' },
          upd(ADMIN, TOKEN_ADMIN, Object.assign({}, ANTES, { requestedModality: 'f7' }),
              Object.assign({}, REENVIO, { requestedCategory: 'prebenjamin', requestedSubcategory: 'A',
                  requestedCategoryLabel: 'Prebenjamín A', resolvedFromModality: 'f7' }), DOC_ADMIN)),

        Object.assign({ n: '1c · 🔑 admin SIN claims todavia: le vale ser el adminUid del ente',
          exp: 'ALLOW', nota: 'respaldo de isClubAdminOf por clubs/{ente}.adminUid' },
          upd(ADMIN, {}, ANTES, REENVIO, DOC_ADMIN)),

        Object.assign({ n: '1d · 🔑 solicitud antigua sin `type` y con el rol mal puesto: el reenvio la endereza',
          exp: 'ALLOW' },
          upd(ADMIN, TOKEN_ADMIN,
              Object.assign({}, ANTES, { type: undefined, requestedRole: 'individual' }),
              Object.assign({}, REENVIO, { type: 'ind_sub_registration', requestedRole: 'parent',
                  requestedRoleLabel: 'Familiar / Jugador Individual' }), DOC_ADMIN)),

        Object.assign({ n: '1e · el SuperAdmin sigue pudiendo', exp: 'ALLOW' },
          upd('uid_sa', { role: 'superadmin', email: 'sa@x.es' }, ANTES,
              { status: 'sa_approved', approvedBy: 'sa@x.es' }, { role: 'superadmin' })),

        // ══ (2) LO QUE LA RAMA NUEVA NO PUEDE ABRIR ══
        Object.assign({ n: '2a · 🔴🔴 un ENTRENADOR del ente (mismo clubId en el token) NO reenvia',
          exp: 'DENY', nota: 'el claim clubId lo lleva CUALQUIER miembro: decidir altas es del admin' },
          upd(MIEMBRO, { role: 'user', clubId: ENTE }, ANTES,
              Object.assign({}, REENVIO, { forwardedBy: MIEMBRO }), DOC_MIEMBRO)),

        Object.assign({ n: '2b · 🔴🔴 el propio interesado NO se reenvia su alta (se saltaria al ente)',
          exp: 'DENY' },
          upd(FAM, { role: 'parent', clubId: ENTE }, ANTES,
              Object.assign({}, REENVIO, { forwardedBy: FAM }), DOC_FAM)),

        Object.assign({ n: '2c · 🔴 el admin de OTRO ente no toca la cola de este', exp: 'DENY' },
          upd(ADMIN_AJENO, { role: 'individual', clubId: OTRO_ENTE }, ANTES,
              Object.assign({}, REENVIO, { forwardedBy: ADMIN_AJENO }),
              { role: 'individual', clubId: OTRO_ENTE, isAuthorized: true, status: 'active' })),

        Object.assign({ n: '2d · 🔴🔴 el ente NO APRUEBA: `sa_approved` le esta vedado',
          exp: 'DENY', nota: 'el visto bueno final es del SuperAdmin' },
          upd(ADMIN, TOKEN_ADMIN, ANTES, Object.assign({}, REENVIO, { status: 'sa_approved' }), DOC_ADMIN)),

        Object.assign({ n: '2e · 🔴 ni `approved`', exp: 'DENY' },
          upd(ADMIN, TOKEN_ADMIN, ANTES, Object.assign({}, REENVIO, { status: 'approved' }), DOC_ADMIN)),

        Object.assign({ n: '2f · 🔴 no se muda la solicitud a OTRO ente', exp: 'DENY' },
          upd(ADMIN, TOKEN_ADMIN, ANTES, Object.assign({}, REENVIO, { individualOwnerId: OTRO_ENTE }), DOC_ADMIN)),

        Object.assign({ n: '2g · 🔴 no se cuelga de un CLUB ajeno', exp: 'DENY' },
          upd(ADMIN, TOKEN_ADMIN, ANTES, Object.assign({}, REENVIO, { clubId: CLUB_AJENO }), DOC_ADMIN)),

        Object.assign({ n: '2h · 🔴 ni por individualEntityId', exp: 'DENY' },
          upd(ADMIN, TOKEN_ADMIN, ANTES, Object.assign({}, REENVIO, { individualEntityId: OTRO_ENTE }), DOC_ADMIN)),

        Object.assign({ n: '2i · 🔴 no se asciende a nadie a administrador', exp: 'DENY' },
          upd(ADMIN, TOKEN_ADMIN, ANTES, Object.assign({}, REENVIO, { requestedRole: 'club_admin' }), DOC_ADMIN)),

        Object.assign({ n: '2j · 🔴 `forwardedBy` es quien firma, no otro', exp: 'DENY' },
          upd(ADMIN, TOKEN_ADMIN, ANTES, Object.assign({}, REENVIO, { forwardedBy: 'uid_de_otro' }), DOC_ADMIN)),

        Object.assign({ n: '2k · 🔴 solo se reenvia lo que esta PENDIENTE del ente', exp: 'DENY' },
          upd(ADMIN, TOKEN_ADMIN, Object.assign({}, ANTES, { status: 'rejected' }), REENVIO, DOC_ADMIN)),

        Object.assign({ n: '2l · 🔴 ningun campo fuera de los del reenvio', exp: 'DENY' },
          upd(ADMIN, TOKEN_ADMIN, ANTES, Object.assign({}, REENVIO, { userUid: 'uid_de_otro' }), DOC_ADMIN)),

        Object.assign({ n: '2m · 🔴 sin sesion, nada', exp: 'DENY' },
          { req: { auth: null, path: P, method: 'update', resource: { data: Object.assign({}, ANTES, REENVIO) } },
            resource: { data: ANTES }, mocks: mocks('nadie', null) }),
    ];
}

// JSON.stringify quita las claves `undefined` → asi se simula el campo ausente.
const limpio = o => JSON.parse(JSON.stringify(o));

// ═══ PARTE 3 · los campos del cliente ⊆ los campos de la regla ═══
function parte3(rulesText) {
    console.log('\n── PARTE 3 · el reenvio escribe lo que la regla admite ──');
    const panel = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'individual', 'panel.js'), 'utf8');
    const i0 = panel.indexOf('window.indForwardToSA = async function');
    const i1 = panel.indexOf('window.indRejectRequest', i0);
    ok('3a · se localiza indForwardToSA', i0 > 0 && i1 > i0);
    const cuerpo = panel.slice(i0, i1);
    const lit = (cuerpo.match(/const updateData = \{([\s\S]*?)\};/) || [])[1] || '';
    const cliente = new Set();
    lit.replace(/^\s*(\w+)\s*:/gm, (_, k) => cliente.add(k));
    cuerpo.replace(/updateData\.(\w+)\s*=/g, (_, k) => cliente.add(k));
    ok('3b · se leen los campos del reenvio (>= 10)', cliente.size >= 10, [...cliente]);

    const fn = (rulesText.match(/function esReenvioDelEnteAlSA\(\)[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/) || [])[1] || '';
    const regla = new Set((fn.match(/'(\w+)'/g) || []).map(s => s.slice(1, -1)));
    ok('3c · se lee la lista hasOnly de esReenvioDelEnteAlSA', regla.size >= 10, [...regla]);

    // `individualOwnerId` se queda FUERA A PROPOSITO: el cliente solo lo escribe
    // si falta, y sin el la regla no puede saber de que ente es la solicitud
    // (isAdminOfClub(null) = no). Ademas esa solicitud nunca llega a la lista
    // del ente, que se consulta POR ese campo. Dejarlo fuera es lo que impide
    // mudar una solicitud a otro ente.
    const fuera = [...cliente].filter(k => !regla.has(k) && k !== 'individualOwnerId');
    ok('3d · 🔑 todo campo que escribe el reenvio esta en la regla', fuera.length === 0,
       { faltan_en_la_regla: fuera });
    ok('3e · individualOwnerId NO es escribible por el ente', !regla.has('individualOwnerId'));
    ok('3f · el `allow update` de platform_requests usa la rama nueva',
       /match \/platform_requests\/\{reqId\}[\s\S]*?allow update:[\s\S]*?isAdminOfClub\(resource\.data\.get\('individualOwnerId', null\)\)\s*&& esReenvioDelEnteAlSA\(\)/.test(rulesText));
}

(async () => {
    console.log('── v687 · el ente individual reenvia sus altas al SuperAdmin ──');
    console.log('   reglas: ' + path.relative(ROOT, RULES) + '\n');
    const rulesText = fs.readFileSync(RULES, 'utf8');

    let token;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        token = await getAccessToken(cfg.tokens.refresh_token);
    } catch (e) {
        console.log('SKIP (partes 1-2) · sin sesion del CLI de Firebase (ejecuta `firebase login`).');
        console.log('       ' + e.message);
        parte3(rulesText);
        console.log('\nResultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
        process.exit(fail ? 1 : 0);
    }
    ok('0a · sesion del CLI valida', !!token);

    const cs = casos();
    const testCases = cs.map(c => ({
        expectation: c.exp,
        // ⚠️ `request.time` SIEMPRE (v434, v633): sin el, lo que lo use revienta.
        request: limpio(Object.assign({ time: new Date().toISOString() }, c.req)),
        resource: c.resource ? limpio(c.resource) : undefined,
        functionMocks: c.mocks || [], pathEncoding: 'PLAIN',
    }));

    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
        token, { source: { files: [{ name: 'firestore.rules', content: rulesText }] }, testSuite: { testCases } });
    if (r.status !== 200) {
        ok('0b · la Rules API responde 200', false, { status: r.status, body: r.body.slice(0, 400) });
        console.log('\nResultado: ' + pass + '/' + (pass + fail) + '  ❌');
        process.exit(1);
    }
    ok('0b · la Rules API responde 200', true);

    const res = JSON.parse(r.body);
    const graves = (res.issues || []).filter(i => i.severity === 'ERROR');
    ok('0c · las reglas COMPILAN sin errores', graves.length === 0, graves);

    const errores = (res.testResults || []).flatMap((t, i) =>
        (t.errorPosition ? [`${cs[i].n}: ${JSON.stringify(t.errorPosition)}`] : []));
    ok('0d · ninguna evaluacion dio error (un error deniega y falsea los DENY)',
       errores.length === 0, errores);

    (res.testResults || []).forEach((t, i) => {
        ok(cs[i].n + '  [espera ' + cs[i].exp + ']', t.state === 'SUCCESS',
           { estado: t.state, porque: cs[i].nota });
    });
    ok('9z · se evaluaron los ' + cs.length + ' casos',
       (res.testResults || []).length === cs.length, (res.testResults || []).length);

    parte3(rulesText);

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

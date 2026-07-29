// ─────────────────────────────────────────────────────────────────────────
// test_sec_c1_create_escalation.js
//
// SEC-C1 (create) · ESCALADA DE PRIVILEGIOS AL REGISTRARSE — cerrada 2026-07-29.
//
// EL DEFECTO, verificado ejecutandolo (no deducido): el `allow create` de
// `users/{userId}` NO restringia NINGUN campo. Un usuario recien registrado
// podia crear SU PROPIO documento con `isAuthorized: true`, `status: 'active'`
// y un `clubId` AJENO, y con eso:
//   · pasar isRegisteredUser()  -> LEER los partidos en vivo de otro club
//     (contienen PII de menores: nombres, dorsales, email del entrenador);
//   · pasar userDocClubId()     -> ESCRIBIR en esos partidos.
// No hacia falta usar la aplicacion: basta el SDK con el token de una cuenta
// nueva, antes de que exista su documento.
//
// ⚠️ POR QUE ESTUVO ABIERTO TANTO TIEMPO: CORRECCIONES_ESTADO.md lo daba por
// "riesgo residual BAJO" con este argumento — "fijar un clubId ajeno en el alta
// NO concede acceso efectivo por si solo: las reglas sensibles cruzan
// isAuthorized/status de la RAIZ, que el usuario NO puede escribir (siguen
// prohibidos en create+update)". Esa lista de campos prohibidos existe SOLO en
// `allow update`. El create no tenia ninguna. El argumento era correcto para el
// update y falso para el create, y nadie lo habia ejecutado porque el test de
// emulador estaba bloqueado por el JDK (ver test_sec_c3_live_matches_rules.js,
// que explica como se sortea eso con la Rules REST API).
//
// EL ARREGLO, en dos partes:
//   A) el create fija los VALORES permitidos (isAuthorized == false y status
//      != 'active') en vez de prohibir los campos. Asi el alta de usuarios
//      individuales —que escribe legitimamente clubId/role/status— sigue
//      funcionando; prohibir los campos ya se intento y se revirtio por eso.
//   B) userDocClubId() exige ademas isAuthorized == true, lo que cierra la
//      escalada por clubId ajeno en los 28 sitios donde se usa el predicado.
//
// LIMITE QUE NO CUBREN LAS REGLAS: una cuenta que YA tuviera isAuthorized:true
// grabado de antes sigue siendo valida a ojos de las reglas. Eso se revisa en
// los datos, no aqui.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROJECT = 'cronos-futbol-app';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';

let fail = 0, pass = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); if (x !== undefined) console.log('       ' + JSON.stringify(x).slice(0, 300)); } };

function getAccessToken(rt) {
    const body = new URLSearchParams({ refresh_token: rt,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    return new Promise((res, rej) => {
        const r = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { const j = JSON.parse(d); j.access_token ? res(j.access_token) : rej(new Error(d.slice(0, 200))); } catch (e) { rej(new Error(d.slice(0, 200))); } }); });
        r.on('error', rej); r.write(body); r.end();
    });
}
function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((res, rej) => {
        const r = https.request(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d })); });
        r.on('error', rej); r.write(body); r.end();
    });
}

const MALO = 'atacante_uid', BUENO = 'coach_ok_uid';
const authMalo = { uid: MALO, token: { email: 'malo@x.es', firebase: { sign_in_provider: 'password' } } };
const authBueno = { uid: BUENO, token: { email: 'coach@club.es', firebase: { sign_in_provider: 'password' } } };
const mocks = (uid, data) => [
    { function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: data !== null } },
    { function: 'get', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data: data || {} } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
    { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
];
const docSoloClub = { clubId: 'clubVICTIMA', isAuthorized: false, status: 'pending_individual' };
const docBueno = { clubId: 'clubOK', isAuthorized: true, status: 'active', role: 'user' };

const CASOS = [
    // ── ATAQUES
    { n: 'A1 · ⚠️ NO puede crear su doc con isAuthorized:true (era la escalada principal)', exp: 'DENY',
      req: { auth: authMalo, path: `${DB}/users/${MALO}`, method: 'create',
             resource: { data: { email: 'malo@x.es', clubId: 'clubVICTIMA', isAuthorized: true, status: 'active', role: 'director' } } },
      mocks: mocks(MALO, null) },
    { n: 'A1b · tampoco con status:active aunque isAuthorized sea false', exp: 'DENY',
      req: { auth: authMalo, path: `${DB}/users/${MALO}`, method: 'create',
             resource: { data: { email: 'malo@x.es', isAuthorized: false, status: 'active' } } },
      mocks: mocks(MALO, null) },
    { n: 'A2 · ⚠️ con clubId AJENO y cuenta NO autorizada, NO escribe en el partido de otro club', exp: 'DENY',
      req: { auth: authMalo, path: `${DB}/live_matches/M_V`, method: 'update',
             resource: { data: { clubId: 'clubVICTIMA', events: ['inyectado'] } } },
      mocks: mocks(MALO, docSoloClub), existing: { clubId: 'clubVICTIMA', createdBy: 'otro', coachEmail: 'otro@x.es' } },
    { n: 'A3 · ni lo lee', exp: 'DENY',
      req: { auth: authMalo, path: `${DB}/live_matches/M_V`, method: 'get' },
      mocks: mocks(MALO, docSoloClub), existing: { clubId: 'clubVICTIMA' } },
    { n: 'A4 · ni lo borra', exp: 'DENY',
      req: { auth: authMalo, path: `${DB}/live_matches/M_V`, method: 'delete' },
      mocks: mocks(MALO, docSoloClub), existing: { clubId: 'clubVICTIMA', createdBy: 'otro', coachEmail: 'otro@x.es' } },
    { n: 'A5 · sigue sin poder crear el doc de OTRO usuario', exp: 'DENY',
      req: { auth: authMalo, path: `${DB}/users/victima_uid`, method: 'create',
             resource: { data: { email: 'v@x.es', isAuthorized: false } } },
      mocks: mocks(MALO, null) },
    { n: 'A6 · sigue sin poder subirse isAuthorized por update', exp: 'DENY',
      req: { auth: authMalo, path: `${DB}/users/${MALO}`, method: 'update',
             resource: { data: { ...docSoloClub, isAuthorized: true } } },
      mocks: mocks(MALO, docSoloClub), existing: docSoloClub },

    // ── FLUJOS LEGITIMOS (lo que NO se puede romper)
    { n: 'L1 · el alta legitima sigue funcionando (isAuthorized:false, status pending, clubId de su entidad)', exp: 'ALLOW',
      req: { auth: authMalo, path: `${DB}/users/${MALO}`, method: 'create',
             resource: { data: { email: 'malo@x.es', role: 'parent_individual', status: 'pending_individual',
                                 isAuthorized: false, clubId: 'entidad1', clubName: null } } },
      mocks: mocks(MALO, null) },
    { n: 'L1b · y un alta que ni menciona isAuthorized/status tambien', exp: 'ALLOW',
      req: { auth: authMalo, path: `${DB}/users/${MALO}`, method: 'create',
             resource: { data: { email: 'malo@x.es', displayName: 'Nuevo' } } },
      mocks: mocks(MALO, null) },
    { n: 'L2 · el coach AUTORIZADO escribe en el partido de SU club', exp: 'ALLOW',
      req: { auth: authBueno, path: `${DB}/live_matches/M_OK`, method: 'update',
             resource: { data: { clubId: 'clubOK', events: ['x'] } } },
      mocks: mocks(BUENO, docBueno), existing: { clubId: 'clubOK', createdBy: 'o', coachEmail: 'o@x.es' } },
    { n: 'L3 · lo lee', exp: 'ALLOW',
      req: { auth: authBueno, path: `${DB}/live_matches/M_OK`, method: 'get' },
      mocks: mocks(BUENO, docBueno), existing: { clubId: 'clubOK' } },
    { n: 'L4 · y lo crea', exp: 'ALLOW',
      req: { auth: authBueno, path: `${DB}/live_matches/M_N`, method: 'create',
             resource: { data: { clubId: 'clubOK', createdBy: BUENO, events: [] } } },
      mocks: mocks(BUENO, docBueno) },
    { n: 'L5 · el usuario sigue pudiendo editar campos NO sensibles de su doc', exp: 'ALLOW',
      req: { auth: authBueno, path: `${DB}/users/${BUENO}`, method: 'update',
             resource: { data: { ...docBueno, displayName: 'Nombre nuevo' } } },
      mocks: mocks(BUENO, docBueno), existing: docBueno },
];

(async () => {
    console.log('── SEC-C1 (create) · escalada de privilegios al registrarse ──\n');
    let token;
    try {
        token = await getAccessToken(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token);
    } catch (e) {
        console.log('SKIP · sin sesion del CLI de Firebase (`firebase login`).');
        process.exit(0);
    }
    ok('0a · sesion del CLI valida', !!token);

    const source = { files: [{ name: 'firestore.rules', content: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }] };
    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, token, {
        source, testSuite: { testCases: CASOS.map(c => {
            const tc = { expectation: c.exp, request: c.req, functionMocks: c.mocks, pathEncoding: 'PLAIN' };
            if (c.existing) tc.resource = { data: c.existing };
            return tc; }) },
    });
    if (r.status !== 200) { ok('0b · la Rules API responde 200', false, { status: r.status, body: r.body.slice(0, 400) }); process.exit(1); }
    ok('0b · la Rules API responde 200', true);

    const res = JSON.parse(r.body);
    (res.testResults || []).forEach((t, i) => {
        ok(CASOS[i].n + '  [espera ' + CASOS[i].exp + ']', t.state === 'SUCCESS',
            t.state === 'FAILURE' ? 'la regla NO se comporto como se esperaba' : t.errorPosition);
    });
    ok('1z · se evaluaron los ' + CASOS.length + ' casos', (res.testResults || []).length === CASOS.length);

    // el arreglo tiene que seguir en el texto (si alguien lo revierte, rojo)
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    ok('2a · el create de users/{userId} sigue fijando isAuthorized == false',
        /request\.resource\.data\.get\('isAuthorized', false\) == false/.test(rules));
    ok('2b · y sigue vetando status == active',
        /request\.resource\.data\.get\('status', ''\) != 'active'/.test(rules));
    ok('2c · userDocClubId sigue exigiendo cuenta autorizada',
        /function userDocClubId[\s\S]{0,500}?get\('isAuthorized', false\) == true/.test(rules));

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

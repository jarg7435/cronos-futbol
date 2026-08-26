// ─────────────────────────────────────────────────────────────────────────
// test_sec_role_escalation.js
//
// SEC-C1b · ESCALADA A SUPERADMIN DECLARANDOSE EL ROL EN EL PROPIO ALTA
// Detectada en la auditoria de seguridad del 2026-08-25, con usuarios reales
// ya operando en produccion.
//
// ════════════════════════════════════════════════════════════════════
// EL DEFECTO — dos piezas correctas por separado que juntas abren la puerta
//
//  1. `users/{userId}` `allow create` fijaba los VALORES de `isAuthorized` y
//     `status` (eso fue SEC-C1, julio) pero NO decia nada de `role`. En el
//     `allow update` si esta prohibido; en el create, no.
//  2. La Cloud Function `setCustomClaims` decide quien es SuperAdmin leyendo
//     `users/{caller}.role` — el DOCUMENTO, no el token:
//         const callerRole = callerData?.role || context.auth.token.role;
//         if (callerRole !== 'superadmin') throw permission-denied;
//
//  Cadena completa, sin usar la aplicacion (una funcion onCall es invocable
//  por cualquiera que conozca el id del proyecto, y NO hay App Check):
//     alta publica -> setDoc de su propio doc con role:'superadmin'
//     -> setCustomClaims -> claim real -> isSuperAdmin() cierto EN LAS REGLAS.
//
// ════════════════════════════════════════════════════════════════════
// 🔑 POR QUE ESTE GUARD PRUEBA LAS REGLAS **DOS VECES**
//
//  Un caso cuyo resultado esperado es DENY no distingue una regla estricta de
//  una regla AVERIADA: en el lenguaje de reglas un error de evaluacion tambien
//  deniega. Y tampoco distingue "lo arregle" de "nunca estuvo roto".
//
//  Asi que cada caso se ejecuta contra DOS rulesets:
//    · VULNERABLE — el fichero real con la linea del parche QUITADA;
//    · PARCHEADO  — el fichero real tal cual esta hoy.
//  El ataque tiene que salir ALLOW en el primero y DENY en el segundo. Si el
//  parche desapareciera, el guard se pondria rojo por el lado del ataque; si
//  alguien "arreglara" de mas, se pondria rojo por el lado de las altas
//  legitimas, que se comprueban en los dos.
//
//  ⚠️ `errorPosition` se trata como FALLO aunque `state` sea SUCCESS: es la
//  unica forma de distinguir "denego" de "se averio" (ver
//  [[reference-rules-test-api]]).
//
// Se ejecuta contra el metodo :test de la Firebase Rules REST API — evalua en
// el servidor de Google SIN desplegar nada. Se salta con aviso si no hay
// sesion del CLI, para no romper CI.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs    = require('fs');
const https = require('https');
const os    = require('os');
const path  = require('path');

const ROOT    = path.join(__dirname, '..');
const PROJECT = 'cronos-futbol-app';
const CONFIG  = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB      = '/databases/(default)/documents';

let fail = 0, pass = 0;
const ok = (n, c, x) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (x !== undefined) console.log('      → ' + JSON.stringify(x).slice(0, 300)); }
};

// ⚠️ Buffers, no `d += chunk`: un caracter multibyte partido entre dos trozos
// se decodifica corrupto y ya provoco una falsa discrepancia (v-anterior).
function leerCuerpo(res, cb) {
    const trozos = [];
    res.on('data', c => trozos.push(c));
    res.on('end', () => cb(Buffer.concat(trozos).toString('utf8')));
}

function getAccessToken(rt) {
    const body = new URLSearchParams({
        refresh_token: rt,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
        grant_type: 'refresh_token',
    }).toString();
    return new Promise((res, rej) => {
        const r = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        }, x => leerCuerpo(x, d => {
            try { const j = JSON.parse(d); j.access_token ? res(j.access_token) : rej(new Error(d.slice(0, 200))); }
            catch (e) { rej(new Error(d.slice(0, 200))); }
        }));
        r.on('error', rej); r.write(body); r.end();
    });
}

function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((res, rej) => {
        const r = https.request(url, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
                       'Content-Length': Buffer.byteLength(body) },
        }, x => leerCuerpo(x, d => res({ status: x.statusCode, body: d })));
        r.on('error', rej); r.write(body); r.end();
    });
}

// ── Los dos rulesets ─────────────────────────────────────────────────
const REGLAS_HOY = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

// La linea EXACTA del parche. Se quita para reconstruir el ruleset vulnerable.
const LINEA_PARCHE =
    "         && !(request.resource.data.get('role', '') in ['superadmin', 'admin'])";

const REGLAS_VULNERABLES = REGLAS_HOY.replace('\n' + LINEA_PARCHE, '');

// ── Escenario ────────────────────────────────────────────────────────
const MALO = 'atacante_uid';
const SA   = 'sa_uid';
const authMalo = { uid: MALO, token: { email: 'malo@x.es', firebase: { sign_in_provider: 'password' } } };
const authSA   = { uid: SA,   token: { email: 'jarg7435@gmail.com', firebase: { sign_in_provider: 'password' } } };

// El atacante NO existe todavia; cronos_config/superadmins SI, y su correo no esta.
const mocksMalo = [
    { function: 'exists', args: [{ exactValue: `${DB}/users/${MALO}` }], result: { value: false } },
    { function: 'get',    args: [{ exactValue: `${DB}/users/${MALO}` }], result: { value: { data: {} } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
      result: { value: { data: { emails: ['jarg7435@gmail.com'] } } } },
];
// El SuperAdmin de verdad: su correo SI esta en la lista.
const mocksSA = [
    { function: 'exists', args: [{ exactValue: `${DB}/users/${SA}` }], result: { value: false } },
    { function: 'get',    args: [{ exactValue: `${DB}/users/${SA}` }], result: { value: { data: {} } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
      result: { value: { data: { emails: ['jarg7435@gmail.com'] } } } },
];

const alta = (rol, extra) => ({
    auth: authMalo, path: `${DB}/users/${MALO}`, method: 'create',
    resource: { data: Object.assign({
        email: 'malo@x.es', displayName: 'Nuevo', role: rol,
        isAuthorized: false, status: 'pending',
    }, extra || {}) },
});

// expVul / expParche: lo que debe pasar SIN el parche y CON el parche.
const CASOS = [
    // ── EL ATAQUE ────────────────────────────────────────────────────
    { n: '🔴 ATAQUE · se declara role:"superadmin" en su propia alta',
      req: alta('superadmin'), mocks: mocksMalo, expVul: 'ALLOW', expParche: 'DENY' },
    { n: '🔴 ATAQUE · y con role:"admin", que sendInviteEmail trata como SA',
      req: alta('admin'), mocks: mocksMalo, expVul: 'ALLOW', expParche: 'DENY' },
    { n: '🔴 ATAQUE · tampoco colandolo con un clubId ajeno',
      req: alta('superadmin', { clubId: 'club_victima' }), mocks: mocksMalo,
      expVul: 'ALLOW', expParche: 'DENY' },

    // ── ALTAS LEGITIMAS · los OCHO valores del desplegable real ──────
    ...['user', 'parent', 'director', 'coordinator', 'club_admin', 'individual']
        .map(r => ({ n: '✅ alta legitima · role:"' + r + '"',
                     req: alta(r), mocks: mocksMalo, expVul: 'ALLOW', expParche: 'ALLOW' })),
    // ── y los que escribe el alta BAJO UN ENTE ───────────────────────
    ...['parent_individual', 'entrenador_individual', 'admin_individual', 'coach']
        .map(r => ({ n: '✅ alta legitima bajo ente · role:"' + r + '"',
                     req: alta(r, { clubId: 'entidad1' }), mocks: mocksMalo,
                     expVul: 'ALLOW', expParche: 'ALLOW' })),
    { n: '✅ un alta que ni menciona `role` sigue pasando',
      req: { auth: authMalo, path: `${DB}/users/${MALO}`, method: 'create',
             resource: { data: { email: 'malo@x.es', displayName: 'Nuevo' } } },
      mocks: mocksMalo, expVul: 'ALLOW', expParche: 'ALLOW' },

    // ── EL SUPERADMIN DE VERDAD NO SE QUEDA FUERA ────────────────────
    { n: '🔑 el SuperAdmin real (correo en cronos_config) SI crea su doc con role:"superadmin"',
      req: { auth: authSA, path: `${DB}/users/${SA}`, method: 'create',
             resource: { data: { email: 'jarg7435@gmail.com', role: 'superadmin',
                                 isAuthorized: true, status: 'active' } } },
      mocks: mocksSA, expVul: 'ALLOW', expParche: 'ALLOW' },

    // ── SEC-C1 (julio) NO SE PUEDE HABER ROTO ────────────────────────
    { n: '⚠️ SEC-C1 · sigue sin poder crearse con isAuthorized:true',
      req: alta('user', { isAuthorized: true }), mocks: mocksMalo,
      expVul: 'DENY', expParche: 'DENY' },
    { n: '⚠️ SEC-C1 · ni con status:"active"',
      req: alta('user', { status: 'active' }), mocks: mocksMalo,
      expVul: 'DENY', expParche: 'DENY' },
    { n: '⚠️ SEC-C1 · ni crear el documento de OTRO usuario',
      req: { auth: authMalo, path: `${DB}/users/victima_uid`, method: 'create',
             resource: { data: { email: 'v@x.es', role: 'user', isAuthorized: false } } },
      mocks: mocksMalo, expVul: 'DENY', expParche: 'DENY' },
];

function testCase(c, esperado) {
    return {
        expectation: esperado,
        request: Object.assign({}, c.req, { time: new Date().toISOString() }),
        functionMocks: c.mocks,
        pathEncoding: 'PLAIN',
    };
}

async function evaluar(token, fuente, esperados) {
    const payload = {
        source: { files: [{ name: 'firestore.rules', content: fuente }] },
        testSuite: { testCases: CASOS.map((c, i) => testCase(c, esperados[i])) },
    };
    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, token, payload);
    if (r.status !== 200) throw new Error('HTTP ' + r.status + ' · ' + r.body.slice(0, 400));
    const j = JSON.parse(r.body);
    // ⚠️ SOLO los ERROR tumban el ensayo. Este fichero arrastra WARNINGs
    // conocidos —"Unused function: isTechStaffByDoc", "Invalid function name:
    // exists"— que tambien salen en cada `firebase deploy` y no impiden nada.
    // Tratarlos como fallo dejaria el guard rojo para siempre sin haber
    // probado una sola regla.
    const errores = (j.issues || []).filter(x => x.severity === 'ERROR');
    if (errores.length) {
        throw new Error('Las reglas no compilan: ' + JSON.stringify(errores).slice(0, 400));
    }
    return j.testResults || [];
}

(async () => {
    console.log('\n══ SEC-C1b · escalada a SuperAdmin declarandose el rol en el alta ══\n');

    let token;
    try {
        token = await getAccessToken(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token);
    } catch (e) {
        console.log('SKIP · sin sesion del CLI de Firebase (`firebase login`). ' +
                    'Este guard evalua las reglas EN EL SERVIDOR y necesita credenciales.');
        process.exit(0);
    }

    // 0 · el parche tiene que estar donde se cree que esta
    ok('0a · la linea del parche esta en firestore.rules', REGLAS_HOY.includes(LINEA_PARCHE));
    ok('0b · y el ruleset "vulnerable" se reconstruye quitandola exactamente',
       REGLAS_VULNERABLES !== REGLAS_HOY &&
       REGLAS_HOY.length - REGLAS_VULNERABLES.length === LINEA_PARCHE.length + 1,
       { hoy: REGLAS_HOY.length, vul: REGLAS_VULNERABLES.length });
    if (fail) { console.log('\n❌ El parche no esta como este guard espera. Abortando.'); process.exit(1); }

    // 1 · SIN el parche: el ataque DEBE pasar (si no, no habia nada que arreglar)
    console.log('\n1) 🔴 Reglas SIN el parche — se espera que el ataque PASE');
    const rVul = await evaluar(token, REGLAS_VULNERABLES, CASOS.map(c => c.expVul));
    CASOS.forEach((c, i) => {
        const t = rVul[i] || {};
        const bien = t.state === 'SUCCESS' && !(t.errorPosition);
        ok('[sin parche] ' + c.n + '  → se esperaba ' + c.expVul,
           bien, { state: t.state, errorPosition: t.errorPosition });
    });

    // 2 · CON el parche: el ataque DEBE morir y las altas seguir vivas
    console.log('\n2) 🟢 Reglas CON el parche — el ataque muere, las altas siguen');
    const rOk = await evaluar(token, REGLAS_HOY, CASOS.map(c => c.expParche));
    CASOS.forEach((c, i) => {
        const t = rOk[i] || {};
        const bien = t.state === 'SUCCESS' && !(t.errorPosition);
        ok('[con parche] ' + c.n + '  → se esperaba ' + c.expParche,
           bien, { state: t.state, errorPosition: t.errorPosition });
    });

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
    if (fail) { console.log('❌ ' + fail + ' asercion(es) en rojo'); process.exit(1); }
    console.log('✅ El ataque pasaba y ya no pasa · ninguna alta legitima se ha roto');
})().catch(e => { console.error('\n❌ Error ejecutando el guard:', e.message); process.exit(1); });

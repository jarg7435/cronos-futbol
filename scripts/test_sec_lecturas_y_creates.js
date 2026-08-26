// ─────────────────────────────────────────────────────────────────────────
// test_sec_lecturas_y_creates.js
//
// Puntos 2, 3 y 4 de la auditoria de seguridad del 2026-08-25:
//
//  · SEC-A1a · los registros privados del SuperAdmin salen de `users/{uid}`.
//    La v628 guardo ahi `saBajasLog` (bajas CON SU MOTIVO) y
//    `saDiagnosticoLog`. Y `users` tiene `allow read: if isAuth()`: el motivo
//    por el que se dio de baja a una persona lo leia cualquiera con cuenta.
//    Se mueven a `users/{uid}/sa_privado/{doc}`, que necesita regla PROPIA —
//    sin ella caeria en el catch-all y el registro dejaria de escribirse.
//
//  · SEC-M01 · tres colecciones aceptaban `create: if isAuth()` SIN validar
//    el contenido: avisos falsos a cualquiera, solicitudes de plazas a nombre
//    de otro club, y constancias de bajas que nadie hizo.
//
//  · SEC-M02 · `match /cronos_config/superadmins { read: if isSuperAdmin() }`
//    NO HACIA NADA. En Firestore las reglas SE SUMAN: una coincidencia mas
//    especifica no anula a la general, y el comodin de arriba decia
//    `read: if isAuth()`. La lista de correos del SuperAdmin —la raiz de
//    confianza de isSuperAdminEmail()— era legible por cualquier usuario.
//
// ════════════════════════════════════════════════════════════════════
// 🔑 CADA CASO SE EJECUTA CONTRA LOS DOS RULESETS, igual que en
// test_sec_role_escalation.js: el fichero real y una version con los parches
// REVERTIDOS. Un caso DENY no distingue por si solo una regla estricta de una
// averiada, ni "lo arregle" de "nunca estuvo roto".
//
// ⚠️ `errorPosition` se trata como FALLO aunque `state` sea SUCCESS.
//
// Usa el metodo :test de la Rules REST API — evalua en el servidor de Google
// SIN desplegar. Se salta con aviso si no hay sesion del CLI.
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

function leerCuerpo(res, cb) {
    const t = []; res.on('data', c => t.push(c));
    res.on('end', () => cb(Buffer.concat(t).toString('utf8')));
}
function getAccessToken(rt) {
    const body = new URLSearchParams({ refresh_token: rt,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    return new Promise((res, rej) => {
        const r = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            x => leerCuerpo(x, d => { try { const j = JSON.parse(d); j.access_token ? res(j.access_token) : rej(new Error(d.slice(0, 200))); } catch (e) { rej(new Error(d.slice(0, 200))); } }));
        r.on('error', rej); r.write(body); r.end();
    });
}
function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((res, rej) => {
        const r = https.request(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            x => leerCuerpo(x, d => res({ status: x.statusCode, body: d })));
        r.on('error', rej); r.write(body); r.end();
    });
}

// ── Los dos rulesets ─────────────────────────────────────────────────
const REGLAS_HOY = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

// Cada parche, y como se revierte para reconstruir el ruleset vulnerable.
const PARCHES = [
    { nombre: 'SEC-M02 · cronos_config',
      hoy: "      allow read: if isAuth() && configId != 'superadmins';",
      antes: '      allow read: if isAuth();' },
    { nombre: 'SEC-M01 · notifications',
      hoy: '      allow create: if isSuperAdmin();\n      allow update: if isAuth() && (\n        isSuperAdmin() ||\n        request.auth.uid == resource.data.get(\'userId\', null)\n      );\n      allow delete: if isSuperAdmin();',
      antes: '      allow create: if isAuth();\n      allow update: if isAuth() && (\n        isSuperAdmin() ||\n        request.auth.uid == resource.data.get(\'userId\', null)\n      );\n      allow delete: if isSuperAdmin();' },
    { nombre: 'SEC-M01 · deletion_requests',
      hoy: "      allow create: if isAuth() &&\n                       request.resource.data.get('requestedBy', null) == request.auth.uid;",
      antes: '      allow create: if isAuth();' },
    { nombre: 'SEC-M01 · slot_requests',
      hoy: "      allow create: if isAuth() && (\n        isSuperAdmin() ||\n        sameClub(request.resource.data.get('clubId', null)) ||\n        sameClubAsDoc(request.resource.data.get('clubId', null)) ||\n        userDocClubId(request.resource.data.get('clubId', null))\n      );",
      antes: '      allow create: if isAuth();' },
    { nombre: 'SEC-A1a · subcoleccion sa_privado',
      hoy: '    match /users/{userId}/sa_privado/{docId} {\n      allow read, write: if isAuth() && request.auth.uid == userId;\n    }',
      antes: '' },   // sin la regla, la subcoleccion cae en el catch-all
];

let REGLAS_VULNERABLES = REGLAS_HOY;
PARCHES.forEach(p => { REGLAS_VULNERABLES = REGLAS_VULNERABLES.replace(p.hoy, p.antes); });

// ── Escenario ────────────────────────────────────────────────────────
const SA = 'sa_uid', COACH = 'coach_uid', OTRO = 'otro_uid';
const CLUB_MIO = 'club_mio', CLUB_AJENO = 'club_ajeno';

const authSA    = { uid: SA,    token: { email: 'jarg7435@gmail.com', role: 'superadmin', firebase: { sign_in_provider: 'password' } } };
const authCoach = { uid: COACH, token: { email: 'coach@x.es', clubId: CLUB_MIO, role: 'user', firebase: { sign_in_provider: 'password' } } };
const authOtro  = { uid: OTRO,  token: { email: 'otro@x.es', firebase: { sign_in_provider: 'password' } } };

const docCoach = { clubId: CLUB_MIO, isAuthorized: true, status: 'active', role: 'user' };
const docOtro  = { clubId: CLUB_AJENO, isAuthorized: true, status: 'active', role: 'user' };
const docSA    = { role: 'superadmin', isAuthorized: true, status: 'active' };

const mocks = (uid, data) => [
    { function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: data !== null } },
    { function: 'get',    args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data: data || {} } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
      result: { value: { data: { emails: ['jarg7435@gmail.com'] } } } },
];

const CASOS = [
    // ── SEC-M02 · la lista de SuperAdmins ────────────────────────────
    { n: '🔴 SEC-M02 · un entrenador cualquiera lee cronos_config/superadmins',
      req: { auth: authCoach, path: `${DB}/cronos_config/superadmins`, method: 'get' },
      mocks: mocks(COACH, docCoach), existing: { emails: ['jarg7435@gmail.com'] },
      expVul: 'ALLOW', expParche: 'DENY' },
    { n: '✅ el SuperAdmin SI la sigue leyendo',
      req: { auth: authSA, path: `${DB}/cronos_config/superadmins`, method: 'get' },
      mocks: mocks(SA, docSA), existing: { emails: ['jarg7435@gmail.com'] },
      expVul: 'ALLOW', expParche: 'ALLOW' },
    { n: '✅ y cronos_config/access (el codigo de acceso) sigue abierto a todos',
      req: { auth: authCoach, path: `${DB}/cronos_config/access`, method: 'get' },
      mocks: mocks(COACH, docCoach), existing: { code: 'ABC' },
      expVul: 'ALLOW', expParche: 'ALLOW' },

    // ── SEC-M01 · notifications ──────────────────────────────────────
    { n: '🔴 SEC-M01 · un usuario cualquiera fabrica un aviso para OTRA persona',
      req: { auth: authOtro, path: `${DB}/notifications/falso1`, method: 'create',
             resource: { data: { type: 'user_deleted', userId: COACH, clubId: CLUB_MIO,
                                 email: 'victima@x.es' } } },
      mocks: mocks(OTRO, docOtro), expVul: 'ALLOW', expParche: 'DENY' },
    { n: '✅ el SuperAdmin conserva la via manual',
      req: { auth: authSA, path: `${DB}/notifications/ok1`, method: 'create',
             resource: { data: { type: 'aviso', userId: COACH } } },
      mocks: mocks(SA, docSA), expVul: 'ALLOW', expParche: 'ALLOW' },

    // ── SEC-M01 · slot_requests ──────────────────────────────────────
    { n: '🔴 SEC-M01 · se piden plazas A NOMBRE DE OTRO CLUB',
      req: { auth: authCoach, path: `${DB}/slot_requests/r1`, method: 'create',
             resource: { data: { clubId: CLUB_AJENO, requestedRole: 'user', quantity: 50,
                                 status: 'pending' } } },
      mocks: mocks(COACH, docCoach), expVul: 'ALLOW', expParche: 'DENY' },
    { n: '✅ pero para el club PROPIO sigue funcionando',
      req: { auth: authCoach, path: `${DB}/slot_requests/r2`, method: 'create',
             resource: { data: { clubId: CLUB_MIO, requestedRole: 'user', quantity: 2,
                                 status: 'pending' } } },
      mocks: mocks(COACH, docCoach), expVul: 'ALLOW', expParche: 'ALLOW' },

    // ── SEC-M01 · deletion_requests ──────────────────────────────────
    { n: '🔴 SEC-M01 · se deja constancia de una baja a nombre de OTRO',
      req: { auth: authOtro, path: `${DB}/deletion_requests/d1`, method: 'create',
             resource: { data: { userId: COACH, requestedBy: SA, action: 'revoke',
                                 reason: 'inventado' } } },
      mocks: mocks(OTRO, docOtro), expVul: 'ALLOW', expParche: 'DENY' },
    { n: '✅ y el flujo real (requestedBy = quien llama) sigue pasando',
      req: { auth: authCoach, path: `${DB}/deletion_requests/d2`, method: 'create',
             resource: { data: { userId: OTRO, requestedBy: COACH, action: 'revoke',
                                 reason: 'baja de temporada' } } },
      mocks: mocks(COACH, docCoach), expVul: 'ALLOW', expParche: 'ALLOW' },

    // ── SEC-A1a · el registro privado del SuperAdmin ─────────────────
    { n: '🔑 SEC-A1a · el SuperAdmin escribe su registro privado',
      req: { auth: authSA, path: `${DB}/users/${SA}/sa_privado/bajas`, method: 'create',
             resource: { data: { v: 1, entradas: [] } } },
      mocks: mocks(SA, docSA), expVul: 'DENY', expParche: 'ALLOW' },
    { n: '🔑 y lo lee',
      req: { auth: authSA, path: `${DB}/users/${SA}/sa_privado/bajas`, method: 'get' },
      mocks: mocks(SA, docSA), existing: { v: 1, entradas: [] },
      expVul: 'DENY', expParche: 'ALLOW' },
    { n: '🔴🔴 SEC-A1a · y NADIE MAS lo lee — ni con cuenta activa',
      req: { auth: authCoach, path: `${DB}/users/${SA}/sa_privado/bajas`, method: 'get' },
      mocks: mocks(COACH, docCoach), existing: { v: 1, entradas: [{ motivo: 'impago' }] },
      expVul: 'DENY', expParche: 'DENY' },
    { n: '⚠️ el motivo de una baja NO se puede leer en la subcoleccion de otro',
      req: { auth: authOtro, path: `${DB}/users/${SA}/sa_privado/diagnostico`, method: 'get' },
      mocks: mocks(OTRO, docOtro), existing: { v: 1, entradas: [] },
      expVul: 'DENY', expParche: 'DENY' },
    { n: '⚠️ ni escribirla',
      req: { auth: authCoach, path: `${DB}/users/${SA}/sa_privado/bajas`, method: 'create',
             resource: { data: { v: 1, entradas: [] } } },
      mocks: mocks(COACH, docCoach), expVul: 'DENY', expParche: 'DENY' },

    // ── Lo que NO se puede haber roto ────────────────────────────────
    { n: '⚠️ cronos_data sigue siendo solo de su duenyo',
      req: { auth: authCoach, path: `${DB}/users/${COACH}/cronos_data/main`, method: 'get' },
      mocks: mocks(COACH, docCoach), existing: { x: 1 }, expVul: 'ALLOW', expParche: 'ALLOW' },
    { n: '⚠️ y ajeno sigue denegado',
      req: { auth: authOtro, path: `${DB}/users/${COACH}/cronos_data/main`, method: 'get' },
      mocks: mocks(OTRO, docOtro), existing: { x: 1 }, expVul: 'DENY', expParche: 'DENY' },
];

function testCase(c, esperado) {
    const req = Object.assign({}, c.req, { time: new Date().toISOString() });
    const tc = { expectation: esperado, request: req, functionMocks: c.mocks, pathEncoding: 'PLAIN' };
    if (c.existing) tc.resource = { data: c.existing };
    return tc;
}

async function evaluar(token, fuente, esperados) {
    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, token, {
        source: { files: [{ name: 'firestore.rules', content: fuente }] },
        testSuite: { testCases: CASOS.map((c, i) => testCase(c, esperados[i])) },
    });
    if (r.status !== 200) throw new Error('HTTP ' + r.status + ' · ' + r.body.slice(0, 400));
    const j = JSON.parse(r.body);
    // Solo los ERROR tumban: este fichero arrastra WARNINGs conocidos que
    // tambien salen en cada `firebase deploy`.
    const errores = (j.issues || []).filter(x => x.severity === 'ERROR');
    if (errores.length) throw new Error('Las reglas no compilan: ' + JSON.stringify(errores).slice(0, 400));
    return j.testResults || [];
}

(async () => {
    console.log('\n══ Auditoria 2026-08-25 · puntos 2, 3 y 4 ══\n');

    let token;
    try {
        token = await getAccessToken(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token);
    } catch (e) {
        console.log('SKIP · sin sesion del CLI de Firebase (`firebase login`).');
        process.exit(0);
    }

    // 0 · los cinco parches tienen que estar donde se cree
    PARCHES.forEach(p => ok('0 · parche presente · ' + p.nombre, REGLAS_HOY.includes(p.hoy)));
    ok('0 · el ruleset "vulnerable" se reconstruye de verdad', REGLAS_VULNERABLES !== REGLAS_HOY);
    if (fail) { console.log('\n❌ Los parches no estan como este guard espera. Abortando.'); process.exit(1); }

    console.log('\n1) 🔴 Reglas SIN los parches — se espera que los ataques PASEN');
    const rVul = await evaluar(token, REGLAS_VULNERABLES, CASOS.map(c => c.expVul));
    CASOS.forEach((c, i) => {
        const t = rVul[i] || {};
        ok('[sin] ' + c.n + '  → ' + c.expVul,
           t.state === 'SUCCESS' && !t.errorPosition, { state: t.state, err: t.errorPosition });
    });

    console.log('\n2) 🟢 Reglas CON los parches');
    const rOk = await evaluar(token, REGLAS_HOY, CASOS.map(c => c.expParche));
    CASOS.forEach((c, i) => {
        const t = rOk[i] || {};
        ok('[con] ' + c.n + '  → ' + c.expParche,
           t.state === 'SUCCESS' && !t.errorPosition, { state: t.state, err: t.errorPosition });
    });

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
    if (fail) { console.log('❌ ' + fail + ' asercion(es) en rojo'); process.exit(1); }
    console.log('✅ Los tres agujeros se cierran y ningun flujo legitimo se rompe');
})().catch(e => { console.error('\n❌ Error ejecutando el guard:', e.message); process.exit(1); });

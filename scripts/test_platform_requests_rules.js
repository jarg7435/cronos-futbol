// ─────────────────────────────────────────────────────────────────────────
//  test_platform_requests_rules.js  ·  v636
//
//  `platform_requests` tenia `allow create: if isAuth()`. Cualquier usuario con
//  sesion podia fabricar una solicitud CON EL CONTENIDO QUE QUISIERA: a nombre
//  de otra persona, para un club ajeno, con el rol que le apeteciese. No
//  concede nada por si sola —quien aprueba decide— pero pone delante del
//  SuperAdmin una peticion que parece legitima y no lo es.
//
//  ════════════════════════════════════════════════════════════════════
//  🚨 EL PELIGRO DE ESTA REGLA NO ES DEJAR PASAR DE MAS: ES BLOQUEAR EL ALTA.
//
//  Quince sitios crean solicitudes. Si UNO se queda fuera, ese camino de
//  registro deja de funcionar — y el sintoma seria «no me puedo dar de alta»,
//  sin nada que apunte a esta regla. Por eso la PARTE 1 es la que importa:
//  recorre las formas REALES que escriben esos quince sitios.
//
//  🔑 CATORCE son el propio interesado (`userUid` o `requestedBy` = quien
//  escribe) y UNO es el REENVIO del administrador de club, que escribe la
//  solicitud de OTRA persona. Ese es el que impide que baste con
//  `userUid == request.auth.uid`.
//
//  ⚠️ Y casi se queda fuera del inventario: usa el alias `fSetDoc`, asi que
//  buscar `setDoc` NO LO ENCUENTRA. La primera pasada lo perdio.
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
const P = `${DB}/platform_requests/pr_prueba`;

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
            res => { let d = ''; res.on('data', c => d += c);
                res.on('end', () => { try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); } catch (e) { reject(new Error(d.slice(0, 200))); } }); });
        req.on('error', reject); req.write(body); req.end();
    });
}
function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: {
            Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body) } },
            res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
        req.on('error', reject); req.write(body); req.end();
    });
}

const CLUB = 'clubA', OTRO = 'clubB';
const NUEVO = 'uid_recien_registrado';
const ADMIN = 'uid_admin_club';

// ⚠️ HAY QUE SIMULAR TAMBIEN `clubs/{clubId}`. `isAdminOfClub` pasa por
//    `isClubAdminOf`, que hace `exists()`/`get()` sobre la coleccion `clubs`.
//    Sin esos dobles la evaluacion REVIENTA — y un error DENIEGA, asi que los
//    casos DENY salian en verde sin haber probado nada. Lo cazo la asercion
//    `0d`, que trata `errorPosition` como fallo: es la unica forma de
//    distinguir «la regla denego» de «la regla se averio».
function mocks(uid, data) {
    const p = `${DB}/users/${uid}`;
    const club = (id, datos) => ([
        { function: 'exists', args: [{ exactValue: `${DB}/clubs/${id}` }], result: { value: true } },
        { function: 'get', args: [{ exactValue: `${DB}/clubs/${id}` }], result: { value: { data: datos } } },
    ]);
    return [
        { function: 'exists', args: [{ exactValue: p }], result: { value: data !== null } },
        { function: 'get', args: [{ exactValue: p }], result: { value: { data: data || {} } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
          result: { value: { data: { emails: [] } } } },
    ]
    // clubA lo administra ADMIN; clubB es de otra persona.
    .concat(club(CLUB, { adminUid: ADMIN, adminEmail: ADMIN + '@x.es' }))
    .concat(club(OTRO, { adminUid: 'uid_admin_ajeno', adminEmail: 'ajeno@x.es' }));
}
const DOC_NUEVO = { clubId: CLUB, isAuthorized: false, status: 'pending_sa', role: 'user' };
const DOC_ADMIN = { clubId: CLUB, isAuthorized: true, status: 'active', role: 'club_admin' };

const auth = (uid, token) => ({ uid, token: Object.assign(
    { email: uid + '@x.es', firebase: { sign_in_provider: 'password' } }, token || {}) });

function casos() {
    return [
        // ══ (1) LAS QUINCE FORMAS REALES DE ALTA — TIENEN QUE SEGUIR PASANDO ══
        { n: '1a · 🔑 alta propia con clubId (self_registration)',
          exp: 'ALLOW',
          req: { auth: auth(NUEVO), path: P, method: 'create', resource: { data: {
              type: 'self_registration', clubId: CLUB, requestedRole: 'user',
              userUid: NUEVO, status: 'pending_club_admin' } } },
          mocks: mocks(NUEVO, DOC_NUEVO) },

        { n: '1b · 🔑 alta propia SIN clubId (auth.js:3189 sólo lleva userUid)',
          exp: 'ALLOW',
          req: { auth: auth(NUEVO), path: P, method: 'create', resource: { data: {
              type: 'self_registration', requestedRole: 'club_admin', userUid: NUEVO,
              status: 'pending_sa' } } },
          mocks: mocks(NUEVO, DOC_NUEVO),
          nota: 'si esta falla, el alta de administrador de club deja de funcionar' },

        { n: '1c · 🔑 alta bajo entidad individual (individualOwnerId, sin clubId)',
          exp: 'ALLOW',
          req: { auth: auth(NUEVO), path: P, method: 'create', resource: { data: {
              type: 'ind_sub_registration', individualOwnerId: 'ente1',
              requestedRole: 'user', userUid: NUEVO, status: 'pending_individual' } } },
          mocks: mocks(NUEVO, DOC_NUEVO) },

        { n: '1d · 🔑 el admin del club pide AMPLIACION DE CUOTA (requestedBy)',
          exp: 'ALLOW',
          req: { auth: auth(ADMIN, { role: 'club_admin', clubId: CLUB }), path: P, method: 'create',
                 resource: { data: { type: 'quota_increase', clubId: CLUB,
                     requestedBy: ADMIN, requestedExtra: 3, status: 'unread' } } },
          mocks: mocks(ADMIN, DOC_ADMIN) },

        { n: '1e · 🔑🔑 el admin REENVIA la solicitud de OTRA persona',
          exp: 'ALLOW',
          req: { auth: auth(ADMIN, { role: 'club_admin', clubId: CLUB }), path: P, method: 'create',
                 resource: { data: { type: 'self_registration', clubId: CLUB,
                     userUid: 'uid_de_otro', requestedRole: 'user',
                     forwardedBy: 'admin@x.es', status: 'pending_sa' } } },
          mocks: mocks(ADMIN, DOC_ADMIN),
          nota: 'ESTE es el que impide que baste con userUid == request.auth.uid' },

        // ══ (2) LO QUE LA REGLA VIENE A CORTAR ══
        { n: '2a · 🔴🔴 fabricar una solicitud A NOMBRE DE OTRO → DENEGADO',
          exp: 'DENY',
          req: { auth: auth(NUEVO), path: P, method: 'create', resource: { data: {
              type: 'self_registration', clubId: CLUB, userUid: 'victima_uid',
              requestedRole: 'club_admin', status: 'pending_sa' } } },
          mocks: mocks(NUEVO, DOC_NUEVO),
          nota: 'ponia ante el SuperAdmin una peticion que parece legitima y no lo es' },

        { n: '2b · 🔴 inyectar en la cola de un club AJENO → DENEGADO',
          exp: 'DENY',
          req: { auth: auth(NUEVO), path: P, method: 'create', resource: { data: {
              type: 'quota_increase', clubId: OTRO, requestedBy: 'otro_uid',
              status: 'unread' } } },
          mocks: mocks(NUEVO, DOC_NUEVO) },

        { n: '2c · 🔴 una solicitud SIN identidad ninguna → DENEGADO',
          exp: 'DENY',
          req: { auth: auth(NUEVO), path: P, method: 'create', resource: { data: {
              type: 'self_registration', requestedRole: 'club_admin', status: 'pending_sa' } } },
          mocks: mocks(NUEVO, DOC_NUEVO),
          nota: 'sin userUid ni requestedBy no hay a quien atribuirla' },

        { n: '2d · ⚠️ el admin de un club NO puede reenviar al club de otro',
          exp: 'DENY',
          req: { auth: auth(ADMIN, { role: 'club_admin', clubId: CLUB }), path: P, method: 'create',
                 resource: { data: { type: 'self_registration', clubId: OTRO,
                     userUid: 'uid_de_otro', status: 'pending_sa' } } },
          mocks: mocks(ADMIN, DOC_ADMIN) },

        { n: '2e · 🔴 sin sesión no se crea nada',
          exp: 'DENY',
          req: { auth: null, path: P, method: 'create', resource: { data: {
              type: 'self_registration', userUid: NUEVO, clubId: CLUB } } } },
    ];
}

(async () => {
    console.log('── v636 · quién puede CREAR una platform_request ──\n');

    let token;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        token = await getAccessToken(cfg.tokens.refresh_token);
    } catch (e) {
        console.log('SKIP · sin sesion del CLI de Firebase (ejecuta `firebase login`).');
        console.log('       ' + e.message);
        process.exit(0);
    }
    ok('0a · sesion del CLI valida', !!token);

    const source = { files: [{ name: 'firestore.rules',
        content: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }] };

    const cs = casos();
    const testCases = cs.map(c => ({
        expectation: c.exp,
        // ⚠️ `request.time` SIEMPRE: sin el, cualquier expresion que lo use
        //    revienta, y un error DENIEGA — los casos DENY saldrian en verde
        //    sin haber probado nada. Ya se pago dos veces (v434 y v633).
        request: Object.assign({ time: new Date().toISOString() }, c.req),
        functionMocks: c.mocks || [], pathEncoding: 'PLAIN',
    }));

    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
        token, { source, testSuite: { testCases } });
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

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

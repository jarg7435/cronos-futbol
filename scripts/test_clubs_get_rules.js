// ─────────────────────────────────────────────────────────────────────────
//  test_clubs_get_rules.js  ·  🔒 SEC-L05 (Fase 1b, 2026-09-22)
//
//  `clubs/{id}` tenia `allow get: if isAuth()`: CUALQUIER cuenta con sesion
//  —un familiar de otro club— que supiera un id se leia el documento entero,
//  con `adminEmail` dentro. Ahora el `get` exige pertenecer.
//
//  ⚠️⚠️ ESTE ES EL CAMBIO QUE MAS PUEDE DOLER DE TODA LA AUDITORIA. Acotar
//  una lectura que usan 26 sitios deja gente fuera si una sola rama falta, y
//  el sintoma no es un error bonito: es una pantalla vacia o un panel que no
//  carga. Por eso aqui NO se mide la forma del texto — se le pide a la Rules
//  API de Google que EVALUE cada persona real del producto.
//
//  🔑 LOS «ALLOW» SON EL GRUESO DEL GUARD, Y NO AL REVES. Lo facil es
//  comprobar que el intruso no entra; lo que de verdad hay que demostrar es
//  que **no se ha dejado fuera a nadie legitimo**, que es el fallo caro:
//    · el SuperAdmin
//    · el administrador del club POR CLAIM y POR DOCUMENTO (los dos caminos:
//      hay club_admin aprobados antes de que se asignaran claims)
//    · el entrenador con claim, y el entrenador SIN claim pero con su
//      documento de usuario
//    · el familiar de ese club
//    · el administrador del ente individual
//    · la ventana de gracia de `transitionalRead` (role-launch.js lee el club
//      al arrancar la sesion, y los claims pueden no haber llegado)
//
//  ⚠️ TRAMPA YA PAGADA EN ESTE REPO: `request.time` hay que aportarlo o la
//  evaluacion REVIENTA, y un error DENIEGA — con lo que los casos DENY salen
//  verdes sin haber probado nada. Por eso cada lote lleva su ALLOW.
//  `transitionalRead` ademas COMPARA TIEMPOS, asi que es el que lo destapa.
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

let fail = 0, pass = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};

function getAccessToken(refreshToken) {
    const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
    const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
    const body = new URLSearchParams({
        refresh_token: refreshToken, client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET, grant_type: 'refresh_token',
    }).toString();
    return new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); } catch (e) { reject(new Error(d.slice(0, 200))); } });
        });
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

const CLUB = 'clubA';
const P = `${DB}/clubs/${CLUB}`;
const DOC_CLUB = { name: 'CD Prueba', type: 'club', status: 'active',
                   adminEmail: 'admin@clubA.es', adminUid: 'admin_uid' };

// Mocks de los get()/exists(): users/{uid}, clubs/{id} (isClubAdminOf) y la
// lista de superadmins.
function mocks(uid, userDoc, opciones) {
    const o = opciones || {};
    const pu = `${DB}/users/${uid}`;
    return [
        { function: 'exists', args: [{ exactValue: pu }], result: { value: userDoc !== null } },
        { function: 'get', args: [{ exactValue: pu }], result: { value: { data: userDoc || {} } } },
        { function: 'exists', args: [{ exactValue: P }], result: { value: true } },
        { function: 'get', args: [{ exactValue: P }], result: { value: { data: DOC_CLUB } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
          result: { value: { data: { emails: o.sa || [] } } } },
    ];
}

const tok = (extra) => Object.assign({ firebase: { sign_in_provider: 'password' } }, extra || {});
const AHORA = new Date();
const HACE_2_MIN = new Date(AHORA.getTime() - 2 * 60000).toISOString();
const HACE_1_HORA = new Date(AHORA.getTime() - 3600000).toISOString();

function casos() {
    return [
        // ══ (a) QUIENES TIENEN QUE SEGUIR ENTRANDO ══════════════════════
        { n: 'a1 · 🔑 el SuperAdmin',
          exp: 'ALLOW',
          req: { auth: { uid: 'sa_uid', token: tok({ email: 'sa@chronos.es' }) }, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('sa_uid', { role: 'superadmin' }, { sa: ['sa@chronos.es'] }),
          nota: 'sus once pantallas leen clubes ajenos por diseño' },

        { n: 'a2 · 🔑 el administrador del club, POR CLAIM',
          exp: 'ALLOW',
          req: { auth: { uid: 'admin_uid', token: tok({ email: 'admin@clubA.es', role: 'club_admin', clubId: CLUB }) }, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('admin_uid', { role: 'club_admin', clubId: CLUB, isAuthorized: true, status: 'active' }) },

        { n: 'a3 · 🔑🔑 el administrador del club SIN claim, por el DOCUMENTO',
          exp: 'ALLOW',
          req: { auth: { uid: 'admin_uid', token: tok({ email: 'admin@clubA.es' }) }, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('admin_uid', { role: 'club_admin', clubId: CLUB, isAuthorized: true, status: 'active' }),
          nota: 'hay club_admin aprobados ANTES de que se asignaran claims (isClubAdminOf existe por eso)' },

        { n: 'a4 · 🔑 el entrenador de ese club, con claim',
          exp: 'ALLOW',
          req: { auth: { uid: 'coach_uid', token: tok({ email: 'coach@clubA.es', role: 'user', clubId: CLUB }) }, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('coach_uid', { role: 'user', clubId: CLUB, isAuthorized: true, status: 'active' }) },

        { n: 'a5 · 🔑🔑 el entrenador SIN claim pero con su documento autorizado',
          exp: 'ALLOW',
          req: { auth: { uid: 'coach_uid', token: tok({ email: 'coach@clubA.es' }) }, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('coach_uid', { role: 'user', clubId: CLUB, isAuthorized: true, status: 'active' }),
          nota: 'userDocClubId: cuatro pantallas de coach/ leen el club así' },

        { n: 'a6 · 🔑 el FAMILIAR de ese club (parent/panel.js:30)',
          exp: 'ALLOW',
          req: { auth: { uid: 'fam_uid', token: tok({ email: 'fam@clubA.es', role: 'parent', clubId: CLUB }) }, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('fam_uid', { role: 'parent', clubId: CLUB, isAuthorized: true, status: 'active' }),
          nota: 'el panel del familiar lee el club para su cabecera' },

        { n: 'a7 · 🔑🔑 la VENTANA DE GRACIA: recién creado, sin claims (role-launch.js)',
          exp: 'ALLOW',
          req: { auth: { uid: 'nuevo_uid', token: tok({ email: 'nuevo@clubA.es' }) }, path: P, method: 'get',
                 time: AHORA.toISOString() },
          existing: DOC_CLUB,
          mocks: mocks('nuevo_uid', { role: 'user', clubId: CLUB, isAuthorized: true, status: 'active',
                                      createdAt: HACE_2_MIN }),
          nota: 'los claims tardan en propagarse; sin esto el arranque de sesión falla' },

        // ══ (b) QUIENES NO ══════════════════════════════════════════════
        { n: 'b1 · 🔴🔴 un familiar de OTRO club ya no se lee este',
          exp: 'DENY',
          req: { auth: { uid: 'ajeno_uid', token: tok({ email: 'fam@clubB.es', role: 'parent', clubId: 'clubB' }) }, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('ajeno_uid', { role: 'parent', clubId: 'clubB', isAuthorized: true, status: 'active' }),
          nota: 'ÉSTE es el agujero que cierra la Fase 1b: se llevaba el adminEmail' },

        { n: 'b2 · 🔴 una cuenta huérfana (sin club) tampoco',
          exp: 'DENY',
          req: { auth: { uid: 'huerfano_uid', token: tok({ email: 'x@x.es' }) }, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('huerfano_uid', { role: 'user', isAuthorized: false, status: 'pending' }),
          nota: 'el alta es abierta: registrarse no puede dar acceso a los clubes' },

        { n: 'b3 · 🔴 sin sesión, nada',
          exp: 'DENY',
          req: { auth: null, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('nadie', null) },

        { n: 'b4 · 🔴 pertenecer pero NO estar autorizado no basta',
          exp: 'DENY',
          req: { auth: { uid: 'pend_uid', token: tok({ email: 'pend@clubA.es' }) }, path: P, method: 'get' },
          existing: DOC_CLUB,
          mocks: mocks('pend_uid', { role: 'user', clubId: CLUB, isAuthorized: false, status: 'pending' }),
          nota: 'userDocClubId exige isAuthorized: una solicitud pendiente no es pertenencia' },

        { n: 'b5 · 🔴🔴 la ventana de gracia CADUCA (createdAt de hace una hora)',
          exp: 'DENY',
          req: { auth: { uid: 'viejo_uid', token: tok({ email: 'viejo@clubB.es' }) }, path: P, method: 'get',
                 time: AHORA.toISOString() },
          existing: DOC_CLUB,
          mocks: mocks('viejo_uid', { role: 'user', clubId: 'clubB', isAuthorized: true, status: 'active',
                                      createdAt: HACE_1_HORA }),
          nota: 'y además su clubId es otro: la gracia nunca cruza de club' },

        { n: 'b6 · 🔴 el `list` sigue cerrado (no se ha aflojado con este cambio)',
          exp: 'DENY',
          req: { auth: { uid: 'coach_uid', token: tok({ email: 'coach@clubA.es', role: 'user', clubId: CLUB }) },
                 path: P, method: 'list' },
          existing: DOC_CLUB,
          mocks: mocks('coach_uid', { role: 'user', clubId: CLUB, isAuthorized: true, status: 'active' }),
          nota: 'SEC-L04 cerró el volcado; el `get` no puede reabrirlo por la puerta de atrás' },

        { n: 'b7 · 🔴 y escribir sigue sin poder el que no es admin',
          exp: 'DENY',
          req: { auth: { uid: 'coach_uid', token: tok({ email: 'coach@clubA.es', role: 'user', clubId: CLUB }) },
                 path: P, method: 'update', resource: { data: Object.assign({}, DOC_CLUB, { name: 'pisado' }) } },
          existing: DOC_CLUB,
          mocks: mocks('coach_uid', { role: 'user', clubId: CLUB, isAuthorized: true, status: 'active' }) },
    ];
}

(async () => {
    console.log('\n── 🔒 SEC-L05 · `clubs.get` exige pertenecer ──\n');

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
    const testCases = cs.map(c => {
        const tc = { expectation: c.exp,
                     request: Object.assign({ time: new Date().toISOString() }, c.req),
                     functionMocks: c.mocks || [], pathEncoding: 'PLAIN' };
        if (c.existing) tc.resource = { data: c.existing };
        return tc;
    });

    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
        token, { source, testSuite: { testCases } });

    if (r.status !== 200) {
        ok('0b · la Rules API responde 200', false, { status: r.status, body: r.body.slice(0, 500) });
        console.log('\nResultado: ' + pass + '/' + (pass + fail) + '  ❌');
        process.exit(1);
    }
    ok('0b · la Rules API responde 200', true);

    const res = JSON.parse(r.body);
    const graves = (res.issues || []).filter(i => i.severity === 'ERROR');
    ok('0c · las reglas COMPILAN sin errores', graves.length === 0, graves);

    const errores = (res.testResults || []).flatMap((t, i) =>
        (t.errorPosition ? [`${cs[i].n}: ${JSON.stringify(t.errorPosition)}`] : []));
    ok('0d · 🔑 ninguna evaluacion se AVERIO (un error denegaria y saldria verde)',
       errores.length === 0, errores);

    (res.testResults || []).forEach((t, i) => {
        ok(cs[i].n + '  [espera ' + cs[i].exp + ']', t.state === 'SUCCESS', {
            estado: t.state, porque: cs[i].nota,
            nota: t.state === 'FAILURE' ? 'la regla NO se comporto como se esperaba' : t.debugMessages,
        });
    });

    ok('zz · se evaluaron los ' + cs.length + ' casos',
       (res.testResults || []).length === cs.length, (res.testResults || []).length);

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

// ─────────────────────────────────────────────────────────────────────────
//  test_sec_r01_rules.js  ·  🔒 Fase 1 (2026-09-22) · COMPORTAMIENTO REAL
//
//  Dos blindajes de la Fase 1, y los dos son de COMPORTAMIENTO: una regex
//  sobre firestore.rules no distingue «la regla deniega» de «la regla se
//  avería», y en este fichero esa diferencia lo es todo. Se le pide a la
//  Rules API de Google que EVALÚE cada caso.
//
//  ════════════════════════════════════════════════════════════════════
//  🔴 SEC-R01 · `isStaffRoleByDoc()` ES AUTOAFIRMABLE
//
//  Da por staff a cualquiera que esté autorizado y tenga `allRoles` no vacío
//  —un familiar incluido—, y `allRoles` lo escribe el propio usuario: no está
//  en la lista prohibida del `allow update` de `users` y NO PUEDE ESTARLO,
//  porque el alta (auth.js:3420) y el canje del código de invitación
//  (parent/panel.js:1396) lo escriben de verdad.
//
//  🔑 Así que no se arregla quién entra, se arregla QUÉ PUEDE HACER. La rama
//  existe para que alguien se oculte un informe de SU panel; tal y como
//  estaba, el `hasOnly(['dismissedByStaff'])` dejaba REESCRIBIR la lista
//  entera de cualquier informe: borrar la ocultación de otros, o esconderle
//  un informe al Director metiendo su uid.
//
//  ════════════════════════════════════════════════════════════════════
//  🔴 SEC-R02 · LA VENTANA DE GRACIA QUE SÍ SE RENOVABA
//
//  `transitionalRead()` da 5 minutos a la cuenta sin claims, medidos contra
//  `users/{uid}.createdAt`… que el usuario podía escribirse. Su comentario la
//  llama «ventana de gracia NO renovable». Lo era todo menos eso.
//
//  ════════════════════════════════════════════════════════════════════
//  ⚠️⚠️ DOS TRAMPAS DE ESTE ARNÉS, YA PAGADAS EN ESTE REPO
//
//  1. `request.time` HAY QUE APORTARLO. Sin él, cualquier expresión que lo
//     use REVIENTA — y un error de evaluación DENIEGA, así que los casos que
//     esperan DENY salen verdes sin haber probado nada.
//  2. Por eso TODO LOTE DE DENY LLEVA AL MENOS UN ALLOW que recorre la misma
//     expresión. Si la regla se avería, el ALLOW es el que se pone rojo y
//     delata que los DENY no estaban midiendo nada. Aquí son 1a y 2a.
//
//  🔑 Y `errorPosition` se trata como FALLO aunque el `state` sea SUCCESS:
//  es la única forma de distinguir «denegó» de «se rompió».
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
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 500)); }
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

function mocksUsuario(uid, data, emailsSA) {
    const p = `${DB}/users/${uid}`;
    return [
        { function: 'exists', args: [{ exactValue: p }], result: { value: data !== null } },
        { function: 'get', args: [{ exactValue: p }], result: { value: { data: data || {} } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
          result: { value: { data: { emails: emailsSA || [] } } } },
    ];
}

// ── Los personajes ──────────────────────────────────────────────────
// El COLADO: un familiar del club B, AUTORIZADO (eso se lo da un admin) y con
// una entrada cualquiera en `allRoles`, que se la escribe él. Eso basta hoy
// para que `isStaffRoleByDoc()` diga que sí.
const COLADO = 'familiar_uid';
const DOC_COLADO = { clubId: 'clubB', isAuthorized: true, status: 'active',
                     role: 'parent', allRoles: [{ role: 'parent', clubId: 'clubB' }] };
// ⚠️ SIN `clubId` en el token: si lo llevara igual al del informe, entraría
//    por `sameClubAsDoc` y estaríamos midiendo otra rama distinta.
const AUTH_COLADO = { uid: COLADO, token: { email: 'fam@b.es', firebase: { sign_in_provider: 'password' } } };

// El DIRECTOR de verdad del club A, destinatario del informe.
const DIRECTOR = 'director_uid';
const DOC_DIRECTOR = { clubId: 'clubA', isAuthorized: true, status: 'active', role: 'director' };
const AUTH_DIRECTOR = { uid: DIRECTOR, token: { email: 'dir@a.es', firebase: { sign_in_provider: 'password' } } };

// El informe colectivo: sin coachUid ni parentUid del atacante, y de otro club.
const INFORME = { clubId: 'clubA', staffReport: true, staffUids: [DIRECTOR],
                  dismissedByStaff: [], titulo: 'Jornada 3' };
const INFORME_CON_DIR_OCULTO = { ...INFORME, dismissedByStaff: [DIRECTOR] };

const P_REP = `${DB}/cronos_player_reports/rep_0001`;
const P_USER = (uid) => `${DB}/users/${uid}`;

const AHORA = new Date().toISOString();
const HACE_1H = new Date(Date.now() - 3600 * 1000).toISOString();

function casos() {
    return [
        // ══════════════════════════════════════════════════════════════
        //  PARTE 1 · SEC-R01 · uno se oculta a sí mismo, y a nadie más
        // ══════════════════════════════════════════════════════════════

        // 🔑 EL ALLOW QUE SOSTIENE EL LOTE. Si la regla se avería, éste cae y
        //    delata que los DENY de abajo no están midiendo nada.
        { n: '1a · 🔑 EL DIRECTOR destinatario SIGUE pudiendo ocultarse el informe',
          exp: 'ALLOW',
          req: { auth: AUTH_DIRECTOR, path: P_REP, method: 'update',
                 resource: { data: { ...INFORME, dismissedByStaff: [DIRECTOR] } } },
          existing: INFORME,
          mocks: mocksUsuario(DIRECTOR, DOC_DIRECTOR),
          nota: 'es la función legítima que la rama existe para permitir' },

        { n: '1b · el COLADO puede ocultárselo A SÍ MISMO (la rama sigue viva)',
          exp: 'ALLOW',
          req: { auth: AUTH_COLADO, path: P_REP, method: 'update',
                 resource: { data: { ...INFORME, dismissedByStaff: [COLADO] } } },
          existing: INFORME,
          mocks: mocksUsuario(COLADO, DOC_COLADO),
          nota: 'no se le quita a nadie ocultarse cosas de su propio panel' },

        { n: '1c · 🔑🔑 …pero NO puede ocultárselo AL DIRECTOR',
          exp: 'DENY',
          req: { auth: AUTH_COLADO, path: P_REP, method: 'update',
                 resource: { data: { ...INFORME, dismissedByStaff: [DIRECTOR] } } },
          existing: INFORME,
          mocks: mocksUsuario(COLADO, DOC_COLADO),
          nota: 'ANTES SE PODÍA: esconderle a otro un informe de su propio panel' },

        { n: '1d · 🔑🔑 …ni BORRAR la ocultación que ya había puesto el Director',
          exp: 'DENY',
          req: { auth: AUTH_COLADO, path: P_REP, method: 'update',
                 resource: { data: { ...INFORME_CON_DIR_OCULTO, dismissedByStaff: [] } } },
          existing: INFORME_CON_DIR_OCULTO,
          mocks: mocksUsuario(COLADO, DOC_COLADO),
          nota: 'ANTES SE PODÍA: el hasOnly dejaba reescribir la lista entera' },

        { n: '1e · ni colarse a sí mismo Y a otro en la misma escritura',
          exp: 'DENY',
          req: { auth: AUTH_COLADO, path: P_REP, method: 'update',
                 resource: { data: { ...INFORME, dismissedByStaff: [COLADO, DIRECTOR] } } },
          existing: INFORME,
          mocks: mocksUsuario(COLADO, DOC_COLADO),
          nota: 'añadirse a uno mismo no puede servir de tapadera' },

        { n: '1f · 🔑 se admite la clave POR PLAZA (uid_rol), que es la que usa la app',
          exp: 'ALLOW',
          req: { auth: AUTH_DIRECTOR, path: P_REP, method: 'update',
                 resource: { data: { ...INFORME, dismissedByStaff: [DIRECTOR + '_director'] } } },
          existing: INFORME,
          mocks: mocksUsuario(DIRECTOR, DOC_DIRECTOR),
          nota: 'una cuenta puede ser Director Y Coordinador y oculta por separado' },

        { n: '1g · pero NO la clave por plaza DE OTRO',
          exp: 'DENY',
          req: { auth: AUTH_COLADO, path: P_REP, method: 'update',
                 resource: { data: { ...INFORME, dismissedByStaff: [DIRECTOR + '_director'] } } },
          existing: INFORME,
          mocks: mocksUsuario(COLADO, DOC_COLADO),
          nota: 'aceptar el sufijo no puede abrir la puerta por el otro lado' },

        { n: '1h · 🔑 y la rama sigue sin dejar tocar NADA MÁS del informe',
          exp: 'DENY',
          req: { auth: AUTH_COLADO, path: P_REP, method: 'update',
                 resource: { data: { ...INFORME, dismissedByStaff: [COLADO], titulo: 'pisado' } } },
          existing: INFORME,
          mocks: mocksUsuario(COLADO, DOC_COLADO),
          nota: 'el hasOnly de las claves afectadas no se ha aflojado' },

        // ══════════════════════════════════════════════════════════════
        //  PARTE 2 · SEC-R02 · `createdAt` ya no lo escribe su dueño
        // ══════════════════════════════════════════════════════════════

        // 🔑 EL ALLOW DE ESTE LOTE: el usuario sigue pudiendo editar lo suyo.
        { n: '2a · 🔑 el usuario SIGUE pudiendo editar sus campos normales',
          exp: 'ALLOW',
          req: { auth: AUTH_DIRECTOR, path: P_USER(DIRECTOR), method: 'update',
                 resource: { data: { ...DOC_DIRECTOR, createdAt: HACE_1H, firstName: 'Nuevo' } } },
          existing: { ...DOC_DIRECTOR, createdAt: HACE_1H },
          mocks: mocksUsuario(DIRECTOR, DOC_DIRECTOR),
          nota: 'si esto cayera, la lista prohibida se habría pasado de ancha' },

        { n: '2b · 🔑 …incluido `allRoles`, que el alta y el canje ESCRIBEN',
          exp: 'ALLOW',
          req: { auth: AUTH_COLADO, path: P_USER(COLADO), method: 'update',
                 resource: { data: { ...DOC_COLADO, createdAt: HACE_1H,
                                     allRoles: [{ role: 'parent', clubId: 'clubB', inviteCode: 'J7' }] } } },
          existing: { ...DOC_COLADO, createdAt: HACE_1H },
          mocks: mocksUsuario(COLADO, DOC_COLADO),
          nota: 'prohibir allRoles rompería auth.js:3420 y parent/panel.js:1396' },

        { n: '2c · 🔑🔑 pero YA NO puede reescribirse `createdAt`',
          exp: 'DENY',
          req: { auth: AUTH_DIRECTOR, path: P_USER(DIRECTOR), method: 'update',
                 resource: { data: { ...DOC_DIRECTOR, createdAt: AHORA } } },
          existing: { ...DOC_DIRECTOR, createdAt: HACE_1H },
          mocks: mocksUsuario(DIRECTOR, DOC_DIRECTOR),
          nota: 'ANTES SE PODÍA: renovaba a voluntad la ventana de transitionalRead' },

        { n: '2d · ni colarlo junto a un campo legítimo',
          exp: 'DENY',
          req: { auth: AUTH_DIRECTOR, path: P_USER(DIRECTOR), method: 'update',
                 resource: { data: { ...DOC_DIRECTOR, createdAt: AHORA, firstName: 'Nuevo' } } },
          existing: { ...DOC_DIRECTOR, createdAt: HACE_1H },
          mocks: mocksUsuario(DIRECTOR, DOC_DIRECTOR),
          nota: 'hasAny mira TODAS las claves tocadas, no sólo la primera' },

        // Y los que ya estaban protegidos siguen estándolo: si alguno de
        // éstos se pusiera verde, la lista se habría roto al editarla.
        { n: '2e · siguen prohibidos `role` e `isAuthorized` (no se ha roto la lista)',
          exp: 'DENY',
          req: { auth: AUTH_COLADO, path: P_USER(COLADO), method: 'update',
                 resource: { data: { ...DOC_COLADO, createdAt: HACE_1H, role: 'director' } } },
          existing: { ...DOC_COLADO, createdAt: HACE_1H },
          mocks: mocksUsuario(COLADO, DOC_COLADO),
          nota: 'la escalada clásica, cerrada en SEC-C1' },

        { n: '2f · y `clubId` tampoco (la escalada CROSS-CLUB de SEC-C1)',
          exp: 'DENY',
          req: { auth: AUTH_COLADO, path: P_USER(COLADO), method: 'update',
                 resource: { data: { ...DOC_COLADO, createdAt: HACE_1H, clubId: 'clubA' } } },
          existing: { ...DOC_COLADO, createdAt: HACE_1H },
          mocks: mocksUsuario(COLADO, DOC_COLADO),
          nota: 'era la que convertía a un familiar del club B en miembro del A' },
    ];
}

(async () => {
    console.log('\n── 🔒 Fase 1 · SEC-R01 y SEC-R02: comportamiento real de las reglas ──\n');

    let token;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        token = await getAccessToken(cfg.tokens.refresh_token);
    } catch (e) {
        console.log('SKIP · sin sesion del CLI de Firebase (ejecuta `firebase login`).');
        console.log('       ' + e.message);
        process.exit(0);
    }
    ok('0a · sesion del CLI valida (access_token obtenido)', !!token);

    const source = { files: [{ name: 'firestore.rules',
        content: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }] };

    const cs = casos();
    const testCases = cs.map(c => {
        const tc = { expectation: c.exp,
                     request: { time: new Date().toISOString(), ...c.req },
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
            estado: t.state,
            porque: cs[i].nota,
            nota: t.state === 'FAILURE' ? 'la regla NO se comporto como se esperaba' : t.debugMessages,
        });
    });

    ok('zz · se evaluaron los ' + cs.length + ' casos',
       (res.testResults || []).length === cs.length, (res.testResults || []).length);

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

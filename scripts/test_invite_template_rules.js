// ─────────────────────────────────────────────────────────────────────────
// test_invite_template_rules.js
//
// v594 · LA PLANTILLA DE INVITACIÓN DEL CLUB, probada CONTRA EL MOTOR REAL.
//
// POR QUÉ EXISTE
//   El autor pidió (implementar.txt, 2026-08-20) que el Director Deportivo
//   pueda redactar el mensaje de invitación de su club y GUARDARLO. Eso
//   obligó a añadir `inviteTemplate` al `hasOnly` de isClubConfigOnlyUpdate()
//   en firestore.rules — o sea, a AMPLIAR lo que un director puede escribir
//   en el documento de su club.
//
//   🔑 Un guard de regex sobre el texto de las reglas (el de
//   test_config_tab_director_only.js) comprueba que la lista es la que
//   esperamos, pero NO que el motor de Firestore se comporte como creemos.
//   Aquí se evalúa de verdad, con el método `:test` de la Rules REST API
//   (ver [[reference-rules-test-api]]): sin emulador y sin JDK, que en esta
//   máquina no están disponibles.
//
//   ⚠️ Y esto importa especialmente porque `deploy:staging` publica las
//   reglas en la MISMA base que producción: una regla mal razonada no tiene
//   un entorno intermedio donde fallar sin consecuencias.
//
// LO QUE FIJA
//   · el director de ESE club puede guardar su plantilla;
//   · el director de OTRO club no puede tocarla (la escalada cross-club de
//     v188 no vuelve por esta puerta);
//   · seguir sin poder colar `plan`, `status` ni `directorUids` en la misma
//     escritura — ni solos, ni acompañando a la plantilla, que es la forma
//     sutil de colarlos;
//   · un coordinador no puede guardarla (la Secretaría es del Director).
//
// SE SALTA CON AVISO si no hay sesión del CLI, igual que los otros dos
// tests de reglas, para no romper una ejecución en limpio.
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
const ok = (n, c, x) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (x !== undefined) console.log('       ' + JSON.stringify(x).slice(0, 300)); }
};

function getAccessToken(rt) {
    const body = new URLSearchParams({ refresh_token: rt,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    return new Promise((res, rej) => {
        const r = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            x => { const bufs = []; x.on('data', c => bufs.push(c)); x.on('end', () => {
                const d = Buffer.concat(bufs).toString('utf8');
                try { const j = JSON.parse(d); j.access_token ? res(j.access_token) : rej(new Error(d.slice(0, 200))); }
                catch (e) { rej(new Error(d.slice(0, 200))); } }); });
        r.on('error', rej); r.write(body); r.end();
    });
}
function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((res, rej) => {
        const r = https.request(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            // ⚠️ Buffers, no `d += chunk`: acumular en string parte los
            // caracteres multibyte que caen entre dos trozos (trampa ya
            // pagada, ver la nota de la referencia).
            x => { const bufs = []; x.on('data', c => bufs.push(c)); x.on('end', () => res({ status: x.statusCode, body: Buffer.concat(bufs).toString('utf8') })); });
        r.on('error', rej); r.write(body); r.end();
    });
}

const CLUB = 'clubA';
const uidDir   = 'dir_del_clubA';
const uidDirB  = 'dir_del_clubB';
const uidCoord = 'coord_del_clubA';

const auth = (uid, email) => ({ uid, token: { email, firebase: { sign_in_provider: 'password' } } });
const mocks = (uid, data) => [
    { function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data: data } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
    { function: 'get',    args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
    { function: 'exists', args: [{ exactValue: `${DB}/clubs/${CLUB}` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/clubs/${CLUB}` }], result: { value: { data: CLUB_DOC } } },
];

const docDir   = { role: 'director',    clubId: CLUB,    isAuthorized: true, status: 'active' };
const docDirB  = { role: 'director',    clubId: 'clubB', isAuthorized: true, status: 'active' };
const docCoord = { role: 'coordinator', clubId: CLUB,    isAuthorized: true, status: 'active' };

// El documento del club TAL Y COMO ESTÁ antes de la escritura.
const CLUB_DOC = { name: 'CD Prueba', adminUid: 'admin_uid', adminEmail: 'admin@x.es',
                   plan: 'pro', status: 'active', directorUids: ['dir_del_clubA'],
                   categoryConfigs: {}, timerThresholds: {}, features: { sendIndividualReports: true, live_view: true } };
const PLANTILLA = { email: 'Hola {nombre}, te invita {club}: {enlace}', whatsapp: 'Hola *{nombre}*' };

const CASOS = [
    { n: 'A · el DIRECTOR de este club guarda la plantilla', exp: 'ALLOW',
      auth: auth(uidDir, 'dir@x.es'), user: docDir,
      data: { ...CLUB_DOC, inviteTemplate: PLANTILLA } },

    { n: 'B · … y puede volver a cambiarla', exp: 'ALLOW',
      auth: auth(uidDir, 'dir@x.es'), user: docDir,
      data: { ...CLUB_DOC, inviteTemplate: { email: 'otra cosa' } } },

    { n: 'C · 🔑 el director de OTRO club NO puede tocarla (la escalada cross-club de v188 no vuelve)', exp: 'DENY',
      auth: auth(uidDirB, 'dirb@x.es'), user: docDirB,
      data: { ...CLUB_DOC, inviteTemplate: PLANTILLA } },

    { n: 'D · el COORDINADOR no puede guardarla (la Secretaría es del Director)', exp: 'DENY',
      auth: auth(uidCoord, 'coord@x.es'), user: docCoord,
      data: { ...CLUB_DOC, inviteTemplate: PLANTILLA } },

    { n: 'E · ⚠️ sigue sin poder cambiar el PLAN del club', exp: 'DENY',
      auth: auth(uidDir, 'dir@x.es'), user: docDir,
      data: { ...CLUB_DOC, plan: 'enterprise' } },

    { n: 'F · 🔑🔑 ni colarlo ACOMPAÑANDO a la plantilla (la forma sutil de colarlo)', exp: 'DENY',
      auth: auth(uidDir, 'dir@x.es'), user: docDir,
      data: { ...CLUB_DOC, inviteTemplate: PLANTILLA, plan: 'enterprise' } },

    { n: 'G · ni añadirse a directorUids junto con la plantilla', exp: 'DENY',
      auth: auth(uidDir, 'dir@x.es'), user: docDir,
      data: { ...CLUB_DOC, inviteTemplate: PLANTILLA, directorUids: ['dir_del_clubA', 'otro'] } },

    { n: 'H · ni tocar el status del club', exp: 'DENY',
      auth: auth(uidDir, 'dir@x.es'), user: docDir,
      data: { ...CLUB_DOC, inviteTemplate: PLANTILLA, status: 'suspended' } },

    { n: 'I · un director NO autorizado no guarda nada', exp: 'DENY',
      auth: auth(uidDir, 'dir@x.es'), user: { ...docDir, isAuthorized: false },
      data: { ...CLUB_DOC, inviteTemplate: PLANTILLA } },

    { n: 'J · la configuración deportiva de siempre sigue funcionando', exp: 'ALLOW',
      auth: auth(uidDir, 'dir@x.es'), user: docDir,
      data: { ...CLUB_DOC, categoryConfigs: { f7: { a: 1 } } } },
];

(async () => {
    console.log('\n── v594 · plantilla de invitación del club (Rules REST API) ──\n');

    if (!fs.existsSync(CONFIG)) {
        console.log('SKIP · no hay sesión del CLI de Firebase; no se pueden probar las reglas contra el servidor.');
        process.exit(0);
    }
    let rt = null;
    try { rt = (JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens || {}).refresh_token || null; } catch (_) { rt = null; }
    if (!rt) { console.log('SKIP · sin refresh_token en la configuración del CLI.'); process.exit(0); }

    let token;
    try { token = await getAccessToken(rt); }
    catch (e) { console.log('SKIP · no se pudo renovar el token: ' + e.message); process.exit(0); }

    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const testCases = CASOS.map(c => ({
        expectation: c.exp,
        request: {
            auth: c.auth,
            path: `${DB}/clubs/${CLUB}`,
            method: 'update',
            // ⚠️ `request.time` EXPLÍCITO. Sin él, cualquier expresión que lo
            // use LANZA, y como un error equivale a DENY todos los casos DENY
            // saldrían verdes por el motivo equivocado (trampa de v434).
            time: new Date().toISOString(),
            resource: { data: c.data },
        },
        resource: { data: CLUB_DOC },
        functionMocks: mocks(c.auth.uid, c.user),
        pathEncoding: 'PLAIN',
    }));

    const r = await post(
        `https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, token,
        { source: { files: [{ name: 'firestore.rules', content: rules }] }, testSuite: { testCases } });

    if (r.status !== 200) {
        console.log('FAIL · la API respondió ' + r.status + ': ' + r.body.slice(0, 400));
        process.exit(1);
    }
    const res = JSON.parse(r.body).testResults || [];
    CASOS.forEach((c, i) => {
        const tr = res[i] || {};
        // 🔑 `errorPosition` se trata como FALLO aunque el state sea SUCCESS:
        // es la única forma de distinguir "la regla denegó" de "la regla se
        // averió", que en un caso DENY son indistinguibles.
        const roto = !!(tr.errorPosition || (tr.debugMessages || []).some(m => /error/i.test(m)));
        ok(c.n, tr.state === 'SUCCESS' && !roto,
           { state: tr.state, errorPosition: tr.errorPosition, debug: (tr.debugMessages || []).slice(0, 2) });
    });

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();

// ─────────────────────────────────────────────────────────────────────────
//  test_purga_ente_rules.js  ·  v702
//
//  Reporte del autor (consola de las capturas 10300/10301): al borrar
//  definitivamente desde el panel del Administrador Entrenador Individual,
//  Firestore devolvia "Missing or insufficient permissions".
//
//  CAUSA EN LAS REGLAS: la rama del AUTOR exigia `staffReport != true`, y la
//  del informe compartido exigia `puedePurgarInformes(clubId)`, que solo
//  admite director/club_admin de un CLUB. En el ente no existe ninguno de los
//  dos, asi que su informe colectivo no lo podia borrar NADIE salvo el
//  SuperAdmin.
//
//  🚨 LO QUE MAS IMPORTA QUE ESTE GUARD VIGILE NO ES QUE EL ENTE PUEDA, SINO
//  QUE EL CLUB NO CAMBIE. La rama nueva se combina siempre con
//  `coachUid == request.auth.uid`: si alguien la relajara, un entrenador
//  cualquiera podria destruir el informe colectivo de su club, que es
//  exactamente la jerarquia que el autor quiere conservar.
//
//  Se prueba con el metodo :test de la Rules REST API (ver v631): evalua las
//  reglas en el servidor de Google, sin emulador ni JDK.
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
const P = `${DB}/cronos_player_reports/m1_staff_p7`;

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

const ENTE_COACH = 'uid_ente_coach';     // entrenador administrador individual
const CLUB_COACH = 'uid_club_coach';     // entrenador de un club
const OTRO_ENTE  = 'uid_otro_ente';      // otro usuario, tambien de un ente
const CLUB = 'clubA';

// users/{uid} de cada uno: es lo que mira la regla nueva.
const U_ENTE  = { role: 'individual', isIndividual: true, individualEntityId: 'ente1',
                  isAuthorized: true, status: 'active' };
const U_CLUB  = { role: 'user', clubId: CLUB, isAuthorized: true, status: 'active' };
const U_OTRO  = { role: 'individual', isIndividual: true, individualEntityId: 'ente2',
                  isAuthorized: true, status: 'active' };

function mocks(quien, datos) {
    const p = `${DB}/users/${quien}`;
    return [
        { function: 'exists', args: [{ exactValue: p }], result: { value: true } },
        { function: 'get', args: [{ exactValue: p }], result: { value: { data: datos } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
          result: { value: { data: { emails: [] } } } },
        { function: 'exists', args: [{ exactValue: `${DB}/clubs/${CLUB}` }], result: { value: true } },
        { function: 'get', args: [{ exactValue: `${DB}/clubs/${CLUB}` }],
          result: { value: { data: { adminUid: 'uid_admin_club', adminEmail: 'admin@x.es' } } } },
    ];
}

const auth = (uid) => ({ uid, token: { email: uid + '@x.es', firebase: { sign_in_provider: 'password' } } });

// El informe COLECTIVO del ente: lo escribio el propio entrenador del ente.
const COLECTIVO_ENTE = { staffReport: true, coachUid: ENTE_COACH, clubId: 'ente1',
                         matchId: 'm1', playerNumber: '7' };
// El informe COLECTIVO de un club, escrito por su entrenador.
const COLECTIVO_CLUB = { staffReport: true, coachUid: CLUB_COACH, clubId: CLUB,
                         matchId: 'm2', playerNumber: '7' };
// Una copia de FAMILIA del ente (lleva coachUid, como las escriben los tres despachos).
const FAMILIA_ENTE   = { staffReport: false, _forCoach: false, coachUid: ENTE_COACH,
                         parentUid: 'uid_familia', clubId: 'ente1', matchId: 'm1',
                         type: 'parent_player_report' };

function casos() {
    return [
        // ══ (1) EL ENCARGO: el ente borra SUS informes ══
        { n: '1a · 🔑 el ENTE borra su informe COLECTIVO (lo que fallaba)', exp: 'ALLOW',
          req: { auth: auth(ENTE_COACH), path: P, method: 'delete' },
          res: { data: COLECTIVO_ENTE }, mocks: mocks(ENTE_COACH, U_ENTE) },

        { n: '1b · 🔑 y la copia de FAMILIA de ese partido', exp: 'ALLOW',
          req: { auth: auth(ENTE_COACH), path: P, method: 'delete' },
          res: { data: FAMILIA_ENTE }, mocks: mocks(ENTE_COACH, U_ENTE),
          nota: 'si esta falla, quedan datos fantasma en el acumulado' },

        { n: '1c · 🔑 el ente puede LEER sus informes por coachUid (la consulta acotada)', exp: 'ALLOW',
          req: { auth: auth(ENTE_COACH), path: P, method: 'get' },
          res: { data: COLECTIVO_ENTE }, mocks: mocks(ENTE_COACH, U_ENTE) },

        // ══ (2) LA JERARQUIA DEL CLUB, INTACTA ══
        { n: '2a · 🚨 el ENTRENADOR DE CLUB sigue SIN poder borrar el colectivo', exp: 'DENY',
          req: { auth: auth(CLUB_COACH), path: P, method: 'delete' },
          res: { data: COLECTIVO_CLUB }, mocks: mocks(CLUB_COACH, U_CLUB),
          nota: 'la jerarquia del club es el limite que este cambio NO puede tocar' },

        { n: '2b · 🚨 ni aunque sea el autor del informe', exp: 'DENY',
          req: { auth: auth(CLUB_COACH), path: P, method: 'delete' },
          res: { data: Object.assign({}, COLECTIVO_CLUB, { coachUid: CLUB_COACH }) },
          mocks: mocks(CLUB_COACH, U_CLUB) },

        // ══ (3) LA FRONTERA ENTRE ENTES ══
        { n: '3a · 🚨 un usuario de OTRO ente no borra el informe ajeno', exp: 'DENY',
          req: { auth: auth(OTRO_ENTE), path: P, method: 'delete' },
          res: { data: COLECTIVO_ENTE }, mocks: mocks(OTRO_ENTE, U_OTRO),
          nota: 'la rama nueva exige ser el AUTOR, no solo estar en un ente' },

        { n: '3b · 🚨 sin sesion, nada', exp: 'DENY',
          req: { auth: null, path: P, method: 'delete' },
          res: { data: COLECTIVO_ENTE }, mocks: mocks(ENTE_COACH, U_ENTE) },
    ];
}

(async function () {
    let refresh;
    try { refresh = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token; }
    catch (e) { console.log('SKIP · sin credenciales del CLI de Firebase (' + e.message + ')'); process.exit(0); }

    const token = await getAccessToken(refresh);
    const source = { files: [{ name: 'firestore.rules', content: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }] };
    const lista = casos();
    const testCases = lista.map(c => ({
        expectation: c.exp,
        request: Object.assign({}, c.req),
        resource: c.res || undefined,
        functionMocks: c.mocks,
        pathEncoding: 'PLAIN',
    }));

    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, token,
                         { source, testSuite: { testCases } });
    if (r.status !== 200) { console.log('ERROR HTTP ' + r.status + ' ' + r.body.slice(0, 500)); process.exit(1); }
    const out = JSON.parse(r.body);
    const results = out.testResults || [];

    ok('0 · las reglas COMPILAN', !out.issues || out.issues.filter(i => i.severity === 'ERROR').length === 0,
       (out.issues || []).slice(0, 3));

    results.forEach((res, i) => {
        const c = lista[i];
        // ⚠️ `errorPosition` = la evaluacion REVIENTA, y un error DENIEGA: un
        // caso DENY saldria verde sin haber probado la regla.
        ok(c.n, res.state === 'SUCCESS' && !res.errorPosition,
           { estado: res.state, error: res.errorPosition, nota: c.nota });
    });

    console.log(`\n${pass}/${pass + fail} aserciones`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR ' + e.message); process.exit(1); });

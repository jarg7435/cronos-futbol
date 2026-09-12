// ─────────────────────────────────────────────────────────────────────────
//  test_session_lock_rules.js  ·  v699
//
//  La coleccion `cronos_role_sessions` guarda QUE APARATO tiene abierta cada
//  plaza (uid + rol + entidad + equipo). No concede ni quita permisos sobre
//  partidos ni paneles: solo coordina los aparatos del PROPIO usuario.
//
//  🚨 AUN ASI LLEVA DATOS PERSONALES: el uid, el rol, el equipo y el nombre
//  del aparato. Con un `allow read` a secas, CUALQUIER usuario con sesion
//  podria volcar la coleccion entera y saber quien esta conectado, con que
//  equipo y desde donde. Por eso `get` y `list` van separados y `list` esta
//  cerrado del todo — es la leccion de v633 (las invitaciones) y de v674 (el
//  403 del historial).
//
//  🚨 Y EL RIESGO CONTRARIO IMPORTA IGUAL: si la regla bloquea de mas, el
//  latido no puede refrescar la marca, la plaza caduca con el entrenador
//  dentro y otro aparato se la queda a mitad de partido. Por eso la PARTE 1
//  recorre las cuatro operaciones REALES que hace el modulo.
//
//  Se prueba con el metodo :test de la Rules REST API (ver la nota de v631):
//  evalua las reglas en el servidor de Google, sin emulador ni JDK.
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
const P = `${DB}/cronos_role_sessions/u1__user__clubA__eq1`;

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

const YO = 'uid_entrenador', OTRO = 'uid_curioso';
const auth = (uid) => ({ uid, token: { email: uid + '@x.es', firebase: { sign_in_provider: 'password' } } });

// La marca EXISTENTE, la que ya dejo el aparato del propio usuario.
const MARCA = { uid: YO, clave: 'u1__user__clubA__eq1', deviceId: 'dev_ipad',
                deviceName: 'iPad · Safari', rol: 'user', etiqueta: 'Entrenador · Alevín C',
                startedAt: 1757600000000, lastSeen: 1757600000000 };

// isSuperAdminEmail() consulta cronos_config/superadmins: sin este doble la
// evaluacion REVIENTA, y un error DENIEGA — los casos DENY saldrian verdes sin
// haber probado nada.
const mocks = [
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
    { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
      result: { value: { data: { emails: [] } } } },
];

function casos() {
    return [
        // ══ (1) LO QUE EL MODULO HACE DE VERDAD — TIENE QUE FUNCIONAR ══
        { n: '1a · 🔑 leer MI marca al entrar (getDoc)', exp: 'ALLOW',
          req: { auth: auth(YO), path: P, method: 'get' }, res: { data: MARCA } },

        { n: '1b · 🔑 crear la marca al reclamar la plaza', exp: 'ALLOW',
          req: { auth: auth(YO), path: P, method: 'create', resource: { data: MARCA } } },

        { n: '1c · 🔑 el LATIDO refresca la marca (update)', exp: 'ALLOW',
          req: { auth: auth(YO), path: P, method: 'update',
                 resource: { data: Object.assign({}, MARCA, { lastSeen: 1757600600000 }) } },
          res: { data: MARCA },
          nota: 'si esto se deniega, la plaza caduca con el entrenador dentro' },

        { n: '1d · 🔑 soltar la plaza al salir (delete)', exp: 'ALLOW',
          req: { auth: auth(YO), path: P, method: 'delete' }, res: { data: MARCA } },

        { n: '1e · 🔑 TOMAR EL CONTROL: sobrescribir mi propia marca desde otro aparato', exp: 'ALLOW',
          req: { auth: auth(YO), path: P, method: 'update',
                 resource: { data: Object.assign({}, MARCA, { deviceId: 'dev_movil', deviceName: 'Windows · Chrome' }) } },
          res: { data: MARCA } },

        // ══ (2) LO QUE NADIE MAS PUEDE HACER ══
        { n: '2a · 🚨 otro usuario NO lee mi marca', exp: 'DENY',
          req: { auth: auth(OTRO), path: P, method: 'get' }, res: { data: MARCA } },

        { n: '2b · 🚨 otro usuario NO me echa de la plaza (update)', exp: 'DENY',
          req: { auth: auth(OTRO), path: P, method: 'update',
                 resource: { data: Object.assign({}, MARCA, { deviceId: 'dev_intruso' }) } },
          res: { data: MARCA } },

        { n: '2c · 🚨 otro usuario NO borra mi marca', exp: 'DENY',
          req: { auth: auth(OTRO), path: P, method: 'delete' }, res: { data: MARCA } },

        { n: '2d · 🚨 nadie crea una marca A NOMBRE DE OTRO', exp: 'DENY',
          req: { auth: auth(OTRO), path: P, method: 'create', resource: { data: MARCA } },
          nota: 'fabricar la marca de otro le bloquearia la plaza sin que el supiera por que' },

        { n: '2e · 🚨 no se puede cambiar el dueño de una marca', exp: 'DENY',
          req: { auth: auth(YO), path: P, method: 'update',
                 resource: { data: Object.assign({}, MARCA, { uid: OTRO }) } },
          res: { data: MARCA } },

        { n: '2f · 🚨 sin sesion, nada', exp: 'DENY',
          req: { auth: null, path: P, method: 'get' }, res: { data: MARCA } },

        // ══ (3) EL VOLCADO DE LA COLECCION ══
        { n: '3a · 🚨🚨 NADIE puede LISTAR la coleccion (ni el propio usuario)', exp: 'DENY',
          req: { auth: auth(YO), path: `${DB}/cronos_role_sessions/{id}`, method: 'list' },
          nota: 'con `read` a secas, cualquiera sabria quien esta conectado y con que equipo' },
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
        functionMocks: mocks,
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
        // ⚠️ `errorPosition` = la evaluacion REVIENTA. Eso deniega, asi que un
        // caso DENY saldria verde sin haber probado la regla. Se trata como fallo.
        const reventado = !!(res.errorPosition || (res.functionCalls || []).length === -1);
        ok(c.n, res.state === 'SUCCESS' && !reventado,
           { estado: res.state, error: res.errorPosition, nota: c.nota });
    });

    console.log(`\n${pass}/${pass + fail} aserciones`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR ' + e.message); process.exit(1); });

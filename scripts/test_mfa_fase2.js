// ───────────────────────────────────────────────────────────
// test_mfa_fase2.js · v864 (PROPUESTA_MFA_SA.md, Fase 2)
//
// LOS PODERES DE SUPERADMIN EXIGEN UNA SESIÓN ABIERTA CON SEGUNDO FACTOR
//
// Desde v863 el SA no puede INICIAR sesión sin el código TOTP. La Fase 2
// protege los PODERES, no la puerta: reglas y functions sólo tratan a alguien
// como SuperAdmin si su token dice `firebase.sign_in_second_factor == 'totp'`.
// Eso cubre:
//   · una sesión antigua, abierta antes del alta del factor;
//   · un token de una sesión sin factor;
//   · y sobre todo OTRA cuenta que entre en la lista de SA (claim
//     `superadmin` o correo en `cronos_config/superadmins`) sin factor.
//
// Lo que NO debe cambiar: lo que una cuenta puede hacer como usuario normal
// (sin poderes de SA), y todo lo de las cuentas que no son SA.
//
// PARTE A · reglas reales contra la Rules REST API (`:test`).
// PARTE B · `_esSuperAdmin` de functions/index.js, EJECUTADA en un vm.
// PARTE C · las dos functions que decidían «es SA» por su cuenta.
//
// 🔑 Los demás guards de reglas pasan por `lib/rules_mock_suspension.js`, que
//    desde v864 añade el factor a todos los tokens de prueba (el SA real lo
//    tiene). Para probar «sin factor», el caso lleva `sinSegundoFactor: true`.
// ───────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const vm = require('vm');
const conSuspensionMock = require('./lib/rules_mock_suspension');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PROJECT = 'cronos-futbol-app';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';

let pass = 0, fail = 0;
const ok = (n, c, x) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (x !== undefined) console.log('       ' + JSON.stringify(x).slice(0, 400)); }
};

function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: {
            Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body) } },
            (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
        req.on('error', reject); req.write(body); req.end();
    });
}
function accessToken(refreshToken) {
    const body = new URLSearchParams({ refresh_token: refreshToken, grant_type: 'refresh_token',
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' }).toString();
    return new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => {
                try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); }
                catch (e) { reject(new Error(d.slice(0, 200))); } }); });
        req.on('error', reject); req.write(body); req.end();
    });
}

// ── Casos de reglas ──────────────────────────────────────────────────
const SA = 'uid_sa', SA_LISTA = 'uid_sa_por_correo', ADMIN = 'uid_admin_club';
const CORREO_SA = 'jefe@x.es';
const tok = (uid, extra, factor) => ({ uid, token: Object.assign({ email: uid + '@x.es',
    firebase: Object.assign({ sign_in_provider: 'password' }, factor ? { sign_in_second_factor: factor } : {}) }, extra || {}) });
const mocks = (uid, doc) => ([
    { function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: !!doc } },
    { function: 'get', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data: doc || {} } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
    { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [CORREO_SA] } } } },
]);
const DOC = (role) => ({ isAuthorized: true, status: 'active', role, clubId: 'clubA' });
const LOGS = `${DB}/audit_logs/l1`, ACCESS = `${DB}/cronos_config/access`;

function casos() {
    return [
        { n: 'A1 · 🔑 SA por claim CON factor TOTP lee audit_logs', exp: 'ALLOW',
          req: { auth: tok(SA, { role: 'superadmin' }, 'totp'), path: LOGS, method: 'get' }, mocks: mocks(SA, DOC('superadmin')) },
        { n: 'A2 · 🔴 SA por claim SIN factor NO lee audit_logs', exp: 'DENY', sinSegundoFactor: true,
          req: { auth: tok(SA, { role: 'superadmin' }), path: LOGS, method: 'get' }, mocks: mocks(SA, DOC('superadmin')),
          nota: 'una sesión sin segundo factor no conserva los poderes de SA' },
        { n: 'A3 · 🔑 SA por correo de la lista CON factor lee audit_logs', exp: 'ALLOW',
          req: { auth: Object.assign(tok(SA_LISTA, {}, 'totp'), { token: Object.assign(tok(SA_LISTA, {}, 'totp').token, { email: CORREO_SA }) }), path: LOGS, method: 'get' },
          mocks: mocks(SA_LISTA, DOC('user')) },
        { n: 'A4 · 🔴 SA por correo de la lista SIN factor NO lee audit_logs', exp: 'DENY', sinSegundoFactor: true,
          req: { auth: Object.assign(tok(SA_LISTA), { token: Object.assign(tok(SA_LISTA).token, { email: CORREO_SA }) }), path: LOGS, method: 'get' },
          mocks: mocks(SA_LISTA, DOC('user')), nota: 'las DOS vías de SA (claim y correo) piden el factor' },
        { n: 'A5 · 🔴 SA con un factor que no es TOTP (phone) NO lee audit_logs', exp: 'DENY', sinSegundoFactor: true,
          req: { auth: tok(SA, { role: 'superadmin' }, 'phone'), path: LOGS, method: 'get' }, mocks: mocks(SA, DOC('superadmin')),
          nota: 'el SMS está desactivado: sólo vale TOTP' },
        { n: 'A6 · 🔴 un Admin de club CON factor sigue sin leer audit_logs', exp: 'DENY',
          req: { auth: tok(ADMIN, { role: 'club_admin', clubId: 'clubA' }, 'totp'), path: LOGS, method: 'get' }, mocks: mocks(ADMIN, DOC('club_admin')),
          nota: 'el factor no concede nada por sí solo' },
        { n: 'A7 · 🔑 el SA SIN factor conserva lo de un usuario normal (cronos_config/access)', exp: 'ALLOW', sinSegundoFactor: true,
          req: { auth: tok(SA, { role: 'superadmin' }), path: ACCESS, method: 'get' }, mocks: mocks(SA, DOC('superadmin')) },
        { n: 'A8 · 🔑 un Admin de club SIN factor no nota nada (cronos_config/access)', exp: 'ALLOW', sinSegundoFactor: true,
          req: { auth: tok(ADMIN, { role: 'club_admin', clubId: 'clubA' }), path: ACCESS, method: 'get' }, mocks: mocks(ADMIN, DOC('club_admin')) },
        { n: 'A9 · 🔴 SA SIN factor NO escribe cronos_config/superadmins', exp: 'DENY', sinSegundoFactor: true,
          req: { auth: tok(SA, { role: 'superadmin' }), path: `${DB}/cronos_config/superadmins`, method: 'update',
                 resource: { data: { emails: [CORREO_SA, 'intruso@x.es'] } } },
          existing: { data: { emails: [CORREO_SA] } }, mocks: mocks(SA, DOC('superadmin')),
          nota: 'sin factor no puede meter otra cuenta en la lista de SA' },
        { n: 'A10 · 🔑 el ayudante común añade el factor si el caso no dice lo contrario', exp: 'ALLOW',
          req: { auth: tok(SA, { role: 'superadmin' }), path: LOGS, method: 'get' }, mocks: mocks(SA, DOC('superadmin')),
          nota: 'si falla, los 26 guards de reglas que pasan por el ayudante se pondrán en rojo con el SA' },
    ];
}

// ── PARTE B · _esSuperAdmin ejecutada ────────────────────────────────
const FN = leer('functions/index.js');
function extraer(nombre) {
    const m = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(').exec(FN);
    if (!m) throw new Error('no se encontró ' + nombre);
    let i = FN.indexOf('{', m.index), d = 0;
    for (let j = i; j < FN.length; j++) {
        if (FN[j] === '{') d++;
        else if (FN[j] === '}') { d--; if (d === 0) return FN.slice(m.index, j + 1); }
    }
    throw new Error('llaves sin cerrar en ' + nombre);
}
function sandbox(emails) {
    const sb = { console: { log() {}, warn() {}, error() {} }, Array, String, Object, Promise, Error,
        admin: { firestore: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ emails }) }) }) }) } };
    vm.createContext(sb);
    for (const f of ['_conSegundoFactor', '_esSuperAdmin']) { try { vm.runInContext(extraer(f), sb); } catch (_) { /* puede no existir aún */ } }
    return sb;
}
const ctx = (token) => ({ auth: { uid: 'u1', token } });
const fb = (f) => ({ firebase: Object.assign({ sign_in_provider: 'password' }, f ? { sign_in_second_factor: f } : {}) });

(async () => {
    console.log('\n══ Fase 2 · los poderes de SA exigen sesión con segundo factor ══\n');

    // ── PARTE A ──
    let token;
    try { token = await accessToken(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token); }
    catch (e) { console.log('SKIP PARTE A · sin sesión del CLI de Firebase (`firebase login`): ' + e.message); }
    if (token) {
        const RULES = leer('firestore.rules');
        const cuerpo = (n) => { const i = RULES.indexOf('function ' + n + '('); return i < 0 ? '' : RULES.slice(i, RULES.indexOf('\n    }', i)); };
        ok('A0a · existe `_conSegundoFactor()` en firestore.rules', /function _conSegundoFactor\(\)/.test(RULES));
        ok('A0b · `isSuperAdmin()` exige `_conSegundoFactor()`', /_conSegundoFactor\(\)/.test(cuerpo('isSuperAdmin')));
        ok('A0c · el factor se lee con valor por defecto (`.get(...)`): sin él, la evaluación no revienta',
           /sign_in_second_factor/.test(cuerpo('_conSegundoFactor')) && /\.get\(\s*'sign_in_second_factor'/.test(cuerpo('_conSegundoFactor')));
        const usosCorreo = (RULES.replace(/\/\/.*$/gm, '').match(/isSuperAdminEmail\(\)/g) || []).length;
        ok('A0d · `isSuperAdminEmail()` sólo se usa dentro de `isSuperAdmin()` (definición + 1 uso)', usosCorreo === 2, usosCorreo);

        const source = { files: [{ name: 'firestore.rules', content: fs.readFileSync(process.env.RULES_FILE || path.join(ROOT, 'firestore.rules'), 'utf8') }] };
        const cs = casos();
        const testCases = cs.map((c) => Object.assign({
            expectation: c.exp,
            request: Object.assign({ time: new Date().toISOString() }, c.req),
            functionMocks: c.mocks || [], pathEncoding: 'PLAIN',
        }, c.existing ? { resource: c.existing } : {}, c.sinSegundoFactor ? { sinSegundoFactor: true } : {}));
        // A10: el caso llega SIN factor en el token; el ayudante debe ponérselo.
        testCases[cs.length - 1].request.auth.token.firebase = { sign_in_provider: 'password' };
        const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, token,
            { source, testSuite: { testCases: conSuspensionMock(testCases) } });
        ok('A0e · la Rules API responde 200', r.status === 200, { status: r.status, body: r.body.slice(0, 300) });
        if (r.status === 200) {
            const res = JSON.parse(r.body);
            const graves = (res.issues || []).filter((i) => i.severity === 'ERROR');
            ok('A0f · las reglas COMPILAN', graves.length === 0, graves);
            const errores = (res.testResults || []).flatMap((t, i) => (t.errorPosition ? [cs[i].n + ': ' + JSON.stringify(t.errorPosition)] : []));
            ok('A0g · ninguna evaluación dio error (un error deniega y falsea los DENY)', errores.length === 0, errores);
            (res.testResults || []).forEach((t, i) => ok(cs[i].n + '  [espera ' + cs[i].exp + ']', t.state === 'SUCCESS', { estado: t.state, porque: cs[i].nota }));
        }
    }

    // ── PARTE B ──
    console.log('');
    const sb = sandbox([CORREO_SA]);
    const f = sb._esSuperAdmin;
    ok('B0 · existe `_conSegundoFactor` en functions/index.js', typeof sb._conSegundoFactor === 'function');
    ok('B1 · 🔑 claim superadmin + TOTP → SA', await f(ctx(Object.assign({ role: 'superadmin' }, fb('totp')))) === true);
    ok('B2 · 🔴 claim superadmin SIN factor → NO', await f(ctx(Object.assign({ role: 'superadmin' }, fb())) ) === false);
    ok('B3 · 🔑 correo de la lista + TOTP → SA', await f(ctx(Object.assign({ email: CORREO_SA }, fb('totp')))) === true);
    ok('B4 · 🔴 correo de la lista SIN factor → NO', await f(ctx(Object.assign({ email: CORREO_SA }, fb()))) === false);
    ok('B5 · 🔴 factor `phone` → NO', await f(ctx(Object.assign({ role: 'superadmin' }, fb('phone')))) === false);
    ok('B6 · 🔴 token sin `firebase` → NO (no revienta)', await f(ctx({ role: 'superadmin' })) === false);
    ok('B7 · 🔴 un correo ajeno con TOTP → NO', await f(ctx(Object.assign({ email: 'otro@x.es' }, fb('totp')))) === false);

    // ── PARTE C ──
    console.log('');
    const exportado = (n) => { const i = FN.indexOf('exports.' + n + ' ='); const j = FN.indexOf('\nexports.', i + 10); return i < 0 ? '' : FN.slice(i, j < 0 ? undefined : j); };
    const gm = exportado('getMatchForSpectator'), da = exportado('deleteAuthUser');
    ok('C1 · getMatchForSpectator decide «SA» con `_esSuperAdmin(context)`, no con `token.role`',
       /await _esSuperAdmin\(context\)/.test(gm) && !/viewerRole === 'superadmin'/.test(gm),
       'antes: `context.auth.token.role === superadmin` → datos sin seudonimizar sin pasar por el factor');
    ok('C2 · deleteAuthUser NO amplía la purga por el `role` del DOCUMENTO del llamante',
       !/\(callerDoc\.data\(\) \|\| \{\}\)\.role === 'superadmin'/.test(da),
       'antes: `callerDoc.role === superadmin` (lo escribe el propio usuario) decidía purgar todos los clubes');
    ok('C3 · deleteAuthUser resuelve `_esSuperAdmin` UNA vez y usa ese valor para el alcance de la purga',
       (da.match(/_esSuperAdmin\(context\)/g) || []).length === 1 && /const _esSA = await _esSuperAdmin\(context\)/.test(da) && /esSuperadmin = _esSA/.test(da));

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e && e.stack || e); process.exit(1); });

// ─────────────────────────────────────────────────────────────────────────
// test_suspension_usuario.js · ⏸️ v853 · BLOQUEO TEMPORAL DE USUARIO
//
// Encargo del autor (2026-11-11): el SA suspende temporalmente el acceso de
// una cuenta; no entra (y se le dice por qué), sus datos NO se tocan, y al
// reactivar todo vuelve igual.
//
//   PARTE A · forma: reglas, auth.js, index.html, paneles del SA.
//   PARTE B · js/shared/suspension.js ejecutado en un sandbox: qué escribe
//             (SÓLO cronos_suspensiones/{uid}, nunca users/), qué lee, y la
//             expulsión en vivo.
//   PARTE C · las REGLAS evaluadas por Google (Rules REST API `:test`).
//             Se salta con aviso si no hay sesión del CLI de Firebase.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let fail = 0, pass = 0;
const ok = (n, c, extra) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};

// ═══ PARTE A · forma ═════════════════════════════════════════════════════
const RULES = leer('firestore.rules');
ok('A1 · isAuth() exige noSuspendido()', /function isAuth\(\) \{\s*return _conSesion\(\) && noSuspendido\(\);/.test(RULES));
ok('A2 · noSuspendido() mira cronos_suspensiones/{uid}.activa',
   /function noSuspendido\(\)[\s\S]{0,400}cronos_suspensiones\/\$\(request\.auth\.uid\)[\s\S]{0,300}get\('activa', false\) != true/.test(RULES));
ok('A3 · isSuperAdmin/isSuperAdminEmail NO dependen de la suspensión (el SA siempre puede levantarla)',
   /function isSuperAdmin\(\) \{\s*return _conSesion\(\) &&/.test(RULES) && /function isSuperAdminEmail\(\) \{\s*return _conSesion\(\) &&/.test(RULES));
ok('A4 · isRegisteredUser incluye la suspensión', /function isRegisteredUser\(\) \{\s*return isAuth\(\)/.test(RULES));
ok('A5 · la marca nunca se borra (allow delete: if false)', /match \/cronos_suspensiones\/\{uid\} \{[\s\S]{0,900}allow delete: if false;/.test(RULES));

const AUTH = leer('js/services/auth.js');
const ca = AUTH.slice(AUTH.indexOf('export async function checkAuthorization'));
const iSusp = ca.indexOf('CronosSuspension.leerPropia(user.uid)');
const iUser = ca.indexOf('fa.getDoc(ref)');
ok('A6 · checkAuthorization comprueba la suspensión ANTES de leer users/{uid}', iSusp > 0 && iUser > 0 && iSusp < iUser, { iSusp, iUser });
ok('A7 · …si está suspendida cierra sesión y enseña el aviso',
   /if \(_susp\) \{[\s\S]{0,200}signOut[\s\S]{0,120}showAuthError\(window\.CronosSuspension\.MENSAJE\)/.test(ca));
ok('A8 · …y si no, deja la escucha EN VIVO puesta', /CronosSuspension\.vigilar\(user\.uid\)/.test(ca));

const IDX = leer('index.html');
const iMod = IDX.indexOf('js/shared/suspension.js'), iAuth = IDX.indexOf('js/services/auth.js?');
ok('A9 · index.html carga suspension.js (clásico) antes de auth.js', iMod > 0 && iAuth > 0 && iMod < iAuth);
ok('A10 · el SW lo precarga', /'\.\/js\/shared\/suspension\.js'/.test(leer('sw.js')));
ok('A11 · Diagnóstico del SA: insignia + botón en cada ficha y carga de suspensiones',
   /CronosSuspension\.insigniaHtml\(x\.id\)/.test(leer('js/admin/superadmin/diagnostico.js'))
   && /CronosSuspension\.botonHtml\(x\.id/.test(leer('js/admin/superadmin/diagnostico.js'))
   && /CronosSuspension\.cargarActivas\(\)/.test(leer('js/admin/superadmin/diagnostico.js')));
ok('A12 · Clubes del SA: botón en cada fila y carga de suspensiones',
   /CronosSuspension\.botonHtml\(u\.uid \|\| u\.id/.test(leer('js/admin/superadmin/clubs-tab.js'))
   && /CronosSuspension\.cargarActivas\(\)/.test(leer('js/admin/superadmin/clubs-tab.js')));

const SUSP = leer('js/shared/suspension.js');
ok('A13 · suspension.js no escribe NUNCA en users/ (los datos del usuario no se tocan)',
   !/['"]users['"]/.test(SUSP) && !/deleteDoc|updateDoc|deleteField/.test(SUSP));

// ═══ PARTE B · el módulo en un sandbox ═══════════════════════════════════
function sandbox(opts) {
    const o = opts || {};
    const escrituras = [], avisos = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: (f) => { try { f(); } catch (e) { /* nada */ } return 0; },
        alert: (m) => avisos.push(m), prompt: () => (o.prompt === undefined ? 'motivo de prueba' : o.prompt),
        confirm: () => o.confirm !== false, showToast: () => {},
        sessionStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
        location: { recargas: 0, reload() { this.recargas++; } },
        document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
        __escrituras: escrituras, __avisos: avisos,
    };
    sb.window = sb;
    sb._cronos_auth = { db: {}, auth: { yo: 1 } };
    sb._cronosCurrentUser = { uid: 'sa_uid', email: 'sa@x.com', role: 'superadmin' };
    sb.__fsFake = {
        doc: (db, col, id) => ({ col, id }),
        collection: (db, col) => ({ col }),
        query: (c) => c, where: () => ({}),
        arrayUnion: (x) => ({ __union: x }),
        serverTimestamp: () => '__ts__',
        getDoc: async (ref) => {
            if (o.getDocLanza) throw new Error('sin red');
            const d = (o.docs || {})[ref.col + '/' + ref.id];
            return { exists: () => !!d, data: () => d };
        },
        getDocs: async () => ({ forEach: (cb) => (o.activas || []).forEach(d => cb({ id: d.uid, data: () => d })) }),
        setDoc: async (ref, data, opc) => { escrituras.push({ ref, data, opc }); },
        onSnapshot: (ref, cb) => { sb.__snap = cb; return () => {}; },
    };
    sb.__authFake = { signOut: async () => { sb.__signOut = (sb.__signOut || 0) + 1; } };
    vm.createContext(sb);
    const codigo = SUSP
        .replace(/await import\(FS_URL\)/g, 'await __fsFake')
        .replace(/await import\(AUTH_URL\)/g, 'await __authFake');
    vm.runInContext(codigo, sb);
    return sb;
}

(async () => {
    {
        const sb = sandbox({ docs: { 'cronos_suspensiones/u1': { activa: true, motivo: 'x' } } });
        ok('B1 · leerPropia: suspensión ACTIVA → devuelve sus datos', !!(await sb.CronosSuspension.leerPropia('u1')));
        const sb2 = sandbox({ docs: { 'cronos_suspensiones/u1': { activa: false } } });
        ok('B2 · leerPropia: reactivada (activa:false) → null (entra)', (await sb2.CronosSuspension.leerPropia('u1')) === null);
        const sb3 = sandbox({ getDocLanza: true });
        ok('B3 · leerPropia: un fallo de lectura NO deja fuera a nadie (null)', (await sb3.CronosSuspension.leerPropia('u1')) === null);
    }
    {
        const sb = sandbox();
        const r = await sb.CronosSuspension.suspender('u1', 'u1@x.com');
        const e = sb.__escrituras;
        ok('B4 · suspender: UNA escritura, en cronos_suspensiones/u1, con merge', r === true && e.length === 1
           && e[0].ref.col === 'cronos_suspensiones' && e[0].ref.id === 'u1' && e[0].opc && e[0].opc.merge === true, e);
        ok('B5 · …con uid, email, activa:true, motivo y quién', e[0] && e[0].data.uid === 'u1' && e[0].data.email === 'u1@x.com'
           && e[0].data.activa === true && e[0].data.motivo === 'motivo de prueba' && e[0].data.por === 'sa@x.com');
        ok('B6 · …y deja constancia en el historial', e[0] && e[0].data.historial && e[0].data.historial.__union.accion === 'suspender');
        ok('B7 · la ficha pasa a mostrar «SUSPENDIDO» y el botón ▶️', /SUSPENDIDO/.test(sb.CronosSuspension.insigniaHtml('u1'))
           && /CronosSuspension\.reactivar/.test(sb.CronosSuspension.botonHtml('u1', 'u1@x.com', 'user')));
        sb.__escrituras.length = 0;
        const r2 = await sb.CronosSuspension.reactivar('u1', 'u1@x.com');
        const e2 = sb.__escrituras;
        ok('B8 · reactivar: activa:false en el MISMO documento (no se borra; historial)', r2 === true && e2.length === 1
           && e2[0].ref.col === 'cronos_suspensiones' && e2[0].data.activa === false && e2[0].data.historial.__union.accion === 'reactivar', e2);
        ok('B9 · …y la ficha vuelve a «sin suspender»', sb.CronosSuspension.insigniaHtml('u1') === ''
           && /CronosSuspension\.suspender/.test(sb.CronosSuspension.botonHtml('u1', 'u1@x.com', 'user')));
    }
    {
        const sb = sandbox({ prompt: null });
        ok('B10 · cancelar el motivo no escribe nada', (await sb.CronosSuspension.suspender('u1', 'a')) === false && sb.__escrituras.length === 0);
        const sb2 = sandbox();
        ok('B11 · el SA no puede suspenderse a sí mismo', (await sb2.CronosSuspension.suspender('sa_uid', 'sa@x.com')) === false && sb2.__escrituras.length === 0);
        ok('B12 · ningún botón sobre un SuperAdmin', sb2.CronosSuspension.botonHtml('x', 'x', 'superadmin') === '');
    }
    {
        const sb = sandbox({ activas: [{ uid: 'u9', activa: true, motivo: 'm' }] });
        await sb.CronosSuspension.cargarActivas();
        ok('B13 · cargarActivas: el SA ve quién está suspendido', sb.CronosSuspension.estaSuspendido('u9') && !sb.CronosSuspension.estaSuspendido('u1'));
    }
    {
        const sb = sandbox();
        await sb.CronosSuspension.vigilar('u1');
        ok('B14 · vigilar escucha la propia marca', typeof sb.__snap === 'function');
        sb.__snap({ exists: () => true, data: () => ({ activa: false }) });
        await new Promise(r => setImmediate(r));
        ok('B15 · sin suspensión activa, no pasa nada', !sb.__signOut && sb.location.recargas === 0);
        sb.__snap({ exists: () => true, data: () => ({ activa: true }) });
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        ok('B16 · suspendido con la app ABIERTA → sale al momento (signOut + recarga + aviso pendiente)',
           sb.__signOut === 1 && sb.location.recargas === 1 && sb.sessionStorage.getItem('cronos_aviso_suspension') === '1',
           { signOut: sb.__signOut, recargas: sb.location.recargas });
    }

    // ═══ PARTE C · reglas evaluadas por Google ═══════════════════════════
    const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    let refresh;
    try { refresh = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token; }
    catch (e) { console.log('SKIP C · sin credenciales del CLI de Firebase'); return fin(); }
    const http = (url, opts, body) => new Promise((res, rej) => {
        const rq = https.request(url, opts, (r) => { const b = []; r.on('data', c => b.push(c));
            r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(b).toString('utf8') })); });
        rq.on('error', rej); if (body) rq.write(body); rq.end();
    });
    const tb = new URLSearchParams({ refresh_token: refresh, grant_type: 'refresh_token',
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' }).toString();
    const tr = await http('https://oauth2.googleapis.com/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tb) } }, tb);
    const token = (JSON.parse(tr.body) || {}).access_token;
    if (!token) { console.log('SKIP C · no se obtuvo token'); return fin(); }

    const DB = '/databases/(default)/documents';
    const SA = { uid: 'sa_uid', token: { email: 'sa@x.com', email_verified: true } };
    const mSA = [
        { function: 'exists', args: [{ exactValue: DB + '/cronos_config/superadmins' }], result: { value: true } },
        { function: 'get', args: [{ exactValue: DB + '/cronos_config/superadmins' }], result: { value: { data: { emails: ['sa@x.com'] } } } },
    ];
    const mSusp = (uid, activa) => activa === undefined
        ? [{ function: 'exists', args: [{ exactValue: DB + '/cronos_suspensiones/' + uid }], result: { value: false } }]
        : [{ function: 'exists', args: [{ exactValue: DB + '/cronos_suspensiones/' + uid }], result: { value: true } },
           { function: 'get', args: [{ exactValue: DB + '/cronos_suspensiones/' + uid }], result: { value: { data: { uid, activa } } } }];
    const U = (uid) => ({ uid, token: { email: uid + '@x.com' } });
    const usuario = { data: { uid: 'u1', email: 'u1@x.com', role: 'user', isAuthorized: true, status: 'active' } };
    const CASOS = [
        ['C1 · sin suspensión: lee su propio perfil', 'ALLOW', { auth: U('u1'), path: DB + '/users/u1', method: 'get' }, usuario, mSusp('u1').concat(mSA)],
        ['C2 · 🔑 SUSPENDIDO: ya no lee ni su propio perfil', 'DENY', { auth: U('u1'), path: DB + '/users/u1', method: 'get' }, usuario, mSusp('u1', true).concat(mSA)],
        ['C3 · REACTIVADO (activa:false): vuelve a leerlo igual que antes', 'ALLOW', { auth: U('u1'), path: DB + '/users/u1', method: 'get' }, usuario, mSusp('u1', false).concat(mSA)],
        ['C4 · el suspendido SÍ lee su marca (para que el acceso diga por qué)', 'ALLOW', { auth: U('u1'), path: DB + '/cronos_suspensiones/u1', method: 'get' }, { data: { uid: 'u1', activa: true } }, mSusp('u1', true).concat(mSA)],
        ['C5 · otro usuario no lee la marca ajena', 'DENY', { auth: U('u2'), path: DB + '/cronos_suspensiones/u1', method: 'get' }, { data: { uid: 'u1', activa: true } }, mSusp('u2').concat(mSA)],
        ['C6 · el SA suspende', 'ALLOW', { auth: SA, path: DB + '/cronos_suspensiones/u1', method: 'create', resource: { data: { uid: 'u1', email: 'u1@x.com', activa: true } } }, null, mSA],
        ['C7 · el SA reactiva', 'ALLOW', { auth: SA, path: DB + '/cronos_suspensiones/u1', method: 'update', resource: { data: { uid: 'u1', email: 'u1@x.com', activa: false } } }, { data: { uid: 'u1', email: 'u1@x.com', activa: true } }, mSA],
        ['C8 · un usuario NO puede quitarse la suspensión', 'DENY', { auth: U('u1'), path: DB + '/cronos_suspensiones/u1', method: 'update', resource: { data: { uid: 'u1', email: 'u1@x.com', activa: false } } }, { data: { uid: 'u1', activa: true } }, mSusp('u1', true).concat(mSA)],
        ['C9 · nadie suspende a un SuperAdmin', 'DENY', { auth: SA, path: DB + '/cronos_suspensiones/sa2', method: 'create', resource: { data: { uid: 'sa2', email: 'sa@x.com', activa: true } } }, null, mSA],
        ['C10 · la marca no se borra (ni el SA)', 'DENY', { auth: SA, path: DB + '/cronos_suspensiones/u1', method: 'delete' }, { data: { uid: 'u1', activa: false } }, mSA],
        ['C11 · el uid del documento tiene que ser el del usuario', 'DENY', { auth: SA, path: DB + '/cronos_suspensiones/u1', method: 'create', resource: { data: { uid: 'otro', email: 'u1@x.com', activa: true } } }, null, mSA],
    ];
    const testCases = CASOS.map(([, exp, req, res, mocks]) => {
        const tc = { expectation: exp, request: req, functionMocks: mocks, pathEncoding: 'PLAIN' };
        if (res) tc.resource = res;
        return tc;
    });
    const body = JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: RULES }] }, testSuite: { testCases } });
    const r = await http('https://firebaserules.googleapis.com/v1/projects/cronos-futbol-app:test', { method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
    if (r.status !== 200) { ok('C0 · la Rules API responde', false, r.body.slice(0, 300)); return fin(); }
    const out = JSON.parse(r.body);
    (out.testResults || []).forEach((res, i) => {
        ok(CASOS[i][0], res.state === 'SUCCESS' && !res.errorPosition, { state: res.state, err: res.errorPosition, debug: (res.debugMessages || []).slice(0, 2) });
    });
    ok('C12 · se evaluaron todos los casos', (out.testResults || []).length === CASOS.length);
    fin();
})().catch(e => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });

function fin() {
    console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
}

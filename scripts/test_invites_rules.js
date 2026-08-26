// ─────────────────────────────────────────────────────────────────────────
//  test_invites_rules.js  ·  v633 · COMPORTAMIENTO REAL de `invites/{token}`
//
//  El enlace de invitación pasó a ser `?invite=<token>` y los datos —correo,
//  rol, club— viven en `invites/{token}`. Toda la protección de ese documento
//  está EN LAS REGLAS, así que una regex sobre el fichero no vale: aquí se le
//  pide a la Rules API de Google que EVALÚE cada caso.
//
//  ════════════════════════════════════════════════════════════════════
//  🔴 LO QUE ESTE GUARD EXISTE PARA IMPEDIR
//
//  1. 🔑🔑 `read` = `get` + `list`. El `get` va SIN autenticar a propósito:
//     quien abre la invitación todavía no tiene cuenta. Si eso se escribiera
//     como `allow read`, CUALQUIERA —sin sesión— podría vaciar la colección
//     entera con un `getDocs` y quedarse con todos los correos invitados.
//     Son los casos b1/b2.
//
//  2. La caducidad y el uso único tienen que FALLAR HACIA EL NO. Un documento
//     al que le falte `expiresAt` no puede ser eterno (caso a4).
//
//  3. El invitado marca la invitación como usada DESPUÉS de darse de alta, y
//     en esa escritura no puede tocar nada más: sin un `hasOnly`, podría
//     reescribirse el rol o el club de camino (casos d3/d4).
//
//  ⚠️ La Rules API evalúa operaciones sobre UN documento; no valida la
//  legalidad de una CONSULTA. Para `list` eso basta, porque aquí lo que se
//  mide es que la operación `list` esté denegada de plano.
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
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
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

// Mocks de los get()/exists() sobre users/{uid} y cronos_config/superadmins,
// que es lo que consultan isRegisteredUser() e isSuperAdmin().
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

const SEC = 'secretaria_uid';          // quien invita (director de un club)
const DOC_SEC = { clubId: 'clubA', isAuthorized: true, status: 'active', role: 'director' };
const NUEVO = 'invitado_uid';          // el que acaba de darse de alta
const DOC_NUEVO = { clubId: 'clubA', isAuthorized: false, status: 'pending_sa', role: 'user' };

const AUTH_SEC = { uid: SEC, token: { email: 'dir@clubA.es', firebase: { sign_in_provider: 'password' } } };
const AUTH_NUEVO = { uid: NUEVO, token: { email: 'ana@x.com', firebase: { sign_in_provider: 'password' } } };
const AUTH_SA = { uid: 'sa_uid', token: { email: 'sa@chronos.es', role: 'superadmin', firebase: { sign_in_provider: 'password' } } };

// Fechas como las escribe cronosCrearInvitacion: `expiresAt` es un Timestamp.
const EN_15_DIAS = new Date(Date.now() + 15 * 86400000).toISOString();
const HACE_1_DIA = new Date(Date.now() - 86400000).toISOString();

const VIVA = { email: 'ana@x.com', role: 'user', clubName: 'CD A', clubId: 'clubA',
               createdBy: SEC, expiresAt: EN_15_DIAS, usedAt: null, usedBy: null };
const CADUCADA = { ...VIVA, expiresAt: HACE_1_DIA };
const USADA = { ...VIVA, usedAt: HACE_1_DIA, usedBy: 'otro_uid' };
const SIN_CADUCIDAD = { email: 'ana@x.com', role: 'user', clubName: 'CD A', clubId: 'clubA',
                        createdBy: SEC, usedAt: null, usedBy: null };

function casos() {
    const P = `${DB}/invites/tok0123456789abcdef`;
    return [
        // ══ (a) LEER una invitación: el token ES el secreto ══
        { n: 'a1 · 🔑 quien tiene el enlace la lee SIN haber iniciado sesión',
          exp: 'ALLOW',
          req: { auth: null, path: P, method: 'get' },
          existing: VIVA,
          nota: 'el invitado todavía no tiene cuenta: si esto fallara, el alta nunca se rellenaría' },

        { n: 'a2 · ⚠️ una invitación CADUCADA no se puede leer',
          exp: 'DENY',
          req: { auth: null, path: P, method: 'get' },
          existing: CADUCADA },

        { n: 'a3 · ⚠️ una invitación YA USADA tampoco',
          exp: 'DENY',
          req: { auth: null, path: P, method: 'get' },
          existing: USADA,
          nota: 'un enlace reenviado no puede dar de alta a una segunda persona' },

        { n: 'a4 · 🔑🔑 sin `expiresAt` NO vale: la caducidad falla hacia el NO',
          exp: 'DENY',
          req: { auth: null, path: P, method: 'get' },
          existing: SIN_CADUCIDAD,
          nota: 'si el defecto fuera un futuro lejano, un documento incompleto sería eterno' },

        // ══ (b) ENUMERAR: la trampa del `read` ══
        // 🚨 LOS TRES LLEVAN UNA INVITACIÓN **VIVA** (`existing: VIVA`), Y NO ES
        //    DECORADO. Sin ella, `resource.data` va vacío: la caducidad por
        //    defecto (`request.time < request.time`) ya deniega sola, y estos
        //    casos salían en VERDE aunque la regla dijera `allow read`.
        //    O sea, no probaban lo único que vienen a probar.
        //    Detectado con un red-check: se colapsó `get`+`list` en un `read` y
        //    b1/b2 seguían pasando. Con una invitación viva delante, ese mismo
        //    red-check los pone rojos, que es lo que tiene que pasar.
        { n: 'b1 · 🔑🔑 NADIE sin sesión puede LISTAR la colección',
          exp: 'DENY',
          req: { auth: null, path: P, method: 'list' },
          existing: VIVA,
          nota: 'un `allow read` en vez de `allow get` habría dejado volcar TODOS los correos invitados' },

        { n: 'b2 · 🔑🔑 ni siquiera un usuario registrado normal',
          exp: 'DENY',
          req: { auth: AUTH_NUEVO, path: P, method: 'list' },
          existing: VIVA,
          mocks: mocksUsuario(NUEVO, DOC_NUEVO) },

        { n: 'b3 · el SuperAdmin sí, que es quien las administra',
          exp: 'ALLOW',
          req: { auth: AUTH_SA, path: P, method: 'list' },
          existing: VIVA,
          mocks: mocksUsuario('sa_uid', { role: 'superadmin', isAuthorized: true }, ['sa@chronos.es']) },

        // ══ (c) CREAR una invitación ══
        { n: 'c1 · quien invita (director de club, dado de alta) puede crearla',
          exp: 'ALLOW',
          req: { auth: AUTH_SEC, path: P, method: 'create', resource: { data: VIVA } },
          mocks: mocksUsuario(SEC, DOC_SEC) },

        { n: 'c2 · ⚠️ pero NO puede firmarla con el uid de otro',
          exp: 'DENY',
          req: { auth: AUTH_SEC, path: P, method: 'create',
                 resource: { data: { ...VIVA, createdBy: 'otro_uid' } } },
          mocks: mocksUsuario(SEC, DOC_SEC),
          nota: 'si no, no habría forma de saber quién invitó a quién' },

        { n: 'c3 · ⚠️ ni nacer YA usada (eso saltaría el uso único)',
          exp: 'DENY',
          req: { auth: AUTH_SEC, path: P, method: 'create',
                 resource: { data: { ...VIVA, usedAt: HACE_1_DIA } } },
          mocks: mocksUsuario(SEC, DOC_SEC) },

        { n: 'c4 · ⚠️ y sin sesión no se crea nada',
          exp: 'DENY',
          req: { auth: null, path: P, method: 'create', resource: { data: VIVA } } },

        { n: 'c5 · 🔑 una cuenta que aún no está dada de alta NO puede invitar',
          exp: 'DENY',
          req: { auth: AUTH_NUEVO, path: P, method: 'create',
                 resource: { data: { ...VIVA, createdBy: NUEVO } } },
          mocks: mocksUsuario(NUEVO, DOC_NUEVO),
          nota: 'si no, cualquiera que se registre podría fabricar invitaciones' },

        // ══ (d) CONSUMIRLA tras el alta ══
        { n: 'd1 · el invitado la marca como usada al terminar el alta',
          exp: 'ALLOW',
          req: { auth: AUTH_NUEVO, path: P, method: 'update',
                 resource: { data: { ...VIVA, usedAt: new Date().toISOString(), usedBy: NUEVO } } },
          existing: VIVA,
          mocks: mocksUsuario(NUEVO, DOC_NUEVO) },

        { n: 'd2 · ⚠️ una segunda vez, no',
          exp: 'DENY',
          req: { auth: AUTH_NUEVO, path: P, method: 'update',
                 resource: { data: { ...USADA, usedBy: NUEVO } } },
          existing: USADA,
          mocks: mocksUsuario(NUEVO, DOC_NUEVO) },

        { n: 'd3 · 🔑🔑 al consumirla NO puede cambiarse el ROL de camino',
          exp: 'DENY',
          req: { auth: AUTH_NUEVO, path: P, method: 'update',
                 resource: { data: { ...VIVA, role: 'club_admin',
                                     usedAt: new Date().toISOString(), usedBy: NUEVO } } },
          existing: VIVA,
          mocks: mocksUsuario(NUEVO, DOC_NUEVO),
          nota: 'sin el hasOnly, el invitado se ascendería a sí mismo antes de que el SA lo apruebe' },

        { n: 'd4 · ⚠️ ni el club',
          exp: 'DENY',
          req: { auth: AUTH_NUEVO, path: P, method: 'update',
                 resource: { data: { ...VIVA, clubId: 'clubB',
                                     usedAt: new Date().toISOString(), usedBy: NUEVO } } },
          existing: VIVA,
          mocks: mocksUsuario(NUEVO, DOC_NUEVO) },

        { n: 'd5 · ⚠️ ni marcarla a nombre de otro',
          exp: 'DENY',
          req: { auth: AUTH_NUEVO, path: P, method: 'update',
                 resource: { data: { ...VIVA, usedAt: new Date().toISOString(), usedBy: 'otro_uid' } } },
          existing: VIVA,
          mocks: mocksUsuario(NUEVO, DOC_NUEVO) },

        // ══ (e) BORRARLA ══
        { n: 'e1 · quien la creó puede retirarla',
          exp: 'ALLOW',
          req: { auth: AUTH_SEC, path: P, method: 'delete' },
          existing: VIVA,
          mocks: mocksUsuario(SEC, DOC_SEC) },

        { n: 'e2 · ⚠️ un tercero no',
          exp: 'DENY',
          req: { auth: AUTH_NUEVO, path: P, method: 'delete' },
          existing: VIVA,
          mocks: mocksUsuario(NUEVO, DOC_NUEVO) },
    ];
}

(async () => {
    console.log('── v633 · comportamiento real de las reglas de `invites` ──\n');

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
        // ⚠️🔑 `request.time` HAY QUE APORTARLO. La regla del `get` compara
        // `request.time < expiresAt`, y si la petición de prueba no lo trae, la
        // API no lo inventa: la evaluación REVIENTA.
        //
        // 🚨 Y ESO NO SE VE COMO UN FALLO, SE VE COMO UN APROBADO. Un error de
        // evaluación deniega, así que los casos que ESPERAN denegar —caducada,
        // sin `expiresAt`— salían en verde sin haber probado nada. Sólo el caso
        // que esperaba permitir delató el problema. Medido con una sonda
        // aparte antes de tocar la regla: con `time` puesto, los cuatro casos
        // se comportan como deben.
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
    // ⚠️ Sólo los ERROR cuentan: este proyecto arrastra WARNINGs conocidos.
    const graves = (res.issues || []).filter(i => i.severity === 'ERROR');
    ok('0c · las reglas COMPILAN sin errores', graves.length === 0, graves);

    const errores = (res.testResults || []).flatMap((t, i) =>
        (t.errorPosition ? [`${cs[i].n}: ${JSON.stringify(t.errorPosition)}`] : []));
    ok('0d · ninguna evaluacion dio error', errores.length === 0, errores);

    (res.testResults || []).forEach((t, i) => {
        ok(cs[i].n + '  [espera ' + cs[i].exp + ']', t.state === 'SUCCESS', {
            estado: t.state,
            porque: cs[i].nota,
            nota: t.state === 'FAILURE' ? 'la regla NO se comporto como se esperaba' : t.debugMessages,
        });
    });

    ok('1z · se evaluaron los ' + cs.length + ' casos',
       (res.testResults || []).length === cs.length, (res.testResults || []).length);

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

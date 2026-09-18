// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v739 · LAS REGLAS DEL CHAT COMÚN DEL CLUB
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-09-18): un canal por club para administrador,
//  director deportivo, coordinadores y entrenadores; el FAMILIAR queda fuera;
//  el ente individual no participa; el SuperAdmin no pertenece al canal pero
//  conserva supervisión; cada uno borra lo suyo; el administrador expulsa.
//
//  🚨🚨 POR QUÉ ESTE GUARD ES OBLIGATORIO Y NO OPCIONAL: en este proyecto
//  **las reglas no se pueden probar en testeo**. `cronos-futbol-test.web.app`
//  sirve el código de testeo pero habla con la base de datos Y LAS REGLAS de
//  producción ([[project_staging_usa_bd_produccion]]). O sea que la única forma
//  de saber si estas reglas hacen lo que dicen ANTES de soltarlas sobre clubes
//  reales es evaluarlas contra el servidor de Google con el método `:test` de
//  la Rules REST API. Eso es lo que hace este fichero.
//
//  ⚠️ TODO LOTE DE CASOS `DENY` NECESITA AL MENOS UN `ALLOW` QUE RECORRA LA
//  MISMA EXPRESIÓN. Un error de evaluación equivale a DENY, así que un lote
//  entero de DENY puede salir verde midiendo la avería en vez de la regla. Ya
//  se pagó dos veces (v434 y v633). Aquí cada bloque lleva su pareja ALLOW, y
//  además `errorPosition` se trata como FALLO aunque el estado sea SUCCESS.
//
//  ⚠️ Esto valida LA LÓGICA de las reglas, no la capa de datos: los
//  `get()`/`exists()` se sirven con `functionMocks`. Requiere sesión del CLI;
//  sin ella el guard se SALTA con aviso, para no romper la suite.
// ═══════════════════════════════════════════════════════════════════════════
const fs    = require('fs');
const https = require('https');
const os    = require('os');
const path  = require('path');

const ROOT    = path.join(__dirname, '..');
const PROJECT = 'cronos-futbol-app';
const CONFIG  = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB      = '/databases/(default)/documents';

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name);
           if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 400)); }
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
            headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                       'Content-Length': Buffer.byteLength(body) },
        }, res => {
            // ⚠️ Buffers, no `d += chunk`: acumulando como string se CORROMPEN
            // los caracteres multibyte partidos entre dos trozos.
            const ch = []; res.on('data', c => ch.push(c));
            res.on('end', () => {
                const d = Buffer.concat(ch).toString('utf8');
                try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); }
                catch (e) { reject(new Error(d.slice(0, 200))); }
            });
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
            res => { const ch = []; res.on('data', c => ch.push(c));
                     res.on('end', () => resolve({ status: res.statusCode,
                                                   body: Buffer.concat(ch).toString('utf8') })); });
        req.on('error', reject); req.write(body); req.end();
    });
}

const CLUB_A = 'clubA', CLUB_B = 'clubB';

// ── Los mocks: users/{uid}, la cabecera del canal y los clubes ─────────
//  `canal` = null → la cabecera NO existe (club que aún no ha escrito nada), que
//  es el caso que obliga al `exists()` de `ccNoExpulsado`: un `get()` sobre un
//  documento ausente LANZA, y un error equivale a DENY para la condición ENTERA.
function mocks(uid, docUsuario, canalDeA) {
    const pUser = `${DB}/users/${uid}`;
    const pCanalA = `${DB}/cronos_staff_channel/${CLUB_A}`;
    const pCanalB = `${DB}/cronos_staff_channel/${CLUB_B}`;
    const m = [
        { function: 'exists', args: [{ exactValue: pUser }], result: { value: docUsuario !== null } },
        { function: 'get',    args: [{ exactValue: pUser }], result: { value: { data: docUsuario || {} } } },
        // Nadie es SuperAdmin por correo en estas pruebas: quien lo sea, lo será
        // por el claim `role`.
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
        { function: 'get',    args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
        // `isClubAdminOf` mira clubs/{id}: se declara inexistente para que la
        // condición de administrador se decida SÓLO por el claim, que es lo que
        // aquí se quiere medir.
        { function: 'exists', args: [{ exactValue: `${DB}/clubs/${CLUB_A}` }], result: { value: false } },
        { function: 'exists', args: [{ exactValue: `${DB}/clubs/${CLUB_B}` }], result: { value: false } },
        { function: 'exists', args: [{ exactValue: pCanalB }], result: { value: false } },
    ];
    if (canalDeA === null || canalDeA === undefined) {
        m.push({ function: 'exists', args: [{ exactValue: pCanalA }], result: { value: false } });
    } else {
        m.push({ function: 'exists', args: [{ exactValue: pCanalA }], result: { value: true } });
        m.push({ function: 'get',    args: [{ exactValue: pCanalA }], result: { value: { data: canalDeA } } });
    }
    return m;
}

const tok = (extra) => Object.assign(
    { email: 'x@club.es', firebase: { sign_in_provider: 'password' } }, extra || {});

const MSG_A = { clubId: CLUB_A, senderUid: 'otroTecnico', senderName: 'Otro',
                senderRole: 'director', text: 'hola', createdAt: '2026-09-18T10:00:00.000Z' };

function casos() {
    const ENTRENADOR_USER  = { clubId: CLUB_A, isAuthorized: true, role: 'user' };
    const ENTRENADOR_COACH = { clubId: CLUB_A, isAuthorized: true, role: 'coach' };
    const DIRECTOR_A       = { clubId: CLUB_A, isAuthorized: true, role: 'director' };
    const COORDINADOR_A    = { clubId: CLUB_A, isAuthorized: true, role: 'coordinator' };
    const FAMILIAR_A       = { clubId: CLUB_A, isAuthorized: true, role: 'parent' };
    const ENTE             = { clubId: CLUB_A, isAuthorized: true, role: 'entrenador_individual' };
    const TECNICO_B        = { clubId: CLUB_B, isAuthorized: true, role: 'director' };
    const SIN_AUTORIZAR    = { clubId: CLUB_A, isAuthorized: false, role: 'user' };

    const leer = (uid, doc, canal) => ({
        req: { auth: { uid, token: tok() }, path: `${DB}/cronos_staff_messages/M1`, method: 'get' },
        mocks: mocks(uid, doc, canal), existing: MSG_A });

    const escribir = (uid, doc, canal, data) => ({
        req: { auth: { uid, token: tok() }, path: `${DB}/cronos_staff_messages/M_NUEVO`,
               method: 'create', resource: { data } },
        mocks: mocks(uid, doc, canal) });

    return [
        // ── 1. QUIÉN ENTRA. Cada DENY va emparejado con su ALLOW por la misma
        //       expresión, o el lote podría estar midiendo una avería.
        { n: '1a · ✅ el ENTRENADOR (rol «user») lee el canal de su club', exp: 'ALLOW',
          ...leer('u_coach', ENTRENADOR_USER, null) },
        { n: '1b · ✅ y el guardado como «coach» también (los dos son entrenador aquí)', exp: 'ALLOW',
          ...leer('u_coach2', ENTRENADOR_COACH, null) },
        { n: '1c · ✅ el DIRECTOR DEPORTIVO', exp: 'ALLOW',
          ...leer('u_dir', DIRECTOR_A, null) },
        { n: '1d · ✅ el COORDINADOR (F7 y F11 van al mismo canal)', exp: 'ALLOW',
          ...leer('u_coord', COORDINADOR_A, null) },
        { n: '1e · 🔑🔑 el FAMILIAR del mismo club NO entra (exclusión del encargo)', exp: 'DENY',
          ...leer('u_fam', FAMILIAR_A, null) },
        { n: '1f · 🔑 el ENTE INDIVIDUAL no participa', exp: 'DENY',
          ...leer('u_ente', ENTE, null) },
        { n: '1g · un técnico de OTRO club no lee este canal', exp: 'DENY',
          ...leer('u_b', TECNICO_B, null) },
        { n: '1h · un alta sin autorizar todavía tampoco', exp: 'DENY',
          ...leer('u_pend', SIN_AUTORIZAR, null) },

        // ── 2. EL SUPERADMIN: supervisa, pero NO habla.
        { n: '2a · ✅ el SuperAdmin LEE el canal (supervisión y diagnóstico)', exp: 'ALLOW',
          req: { auth: { uid: 'u_sa', token: tok({ role: 'superadmin' }) },
                 path: `${DB}/cronos_staff_messages/M1`, method: 'get' },
          mocks: mocks('u_sa', { isAuthorized: true, role: 'superadmin' }, null), existing: MSG_A },
        { n: '2b · 🚨🔑 pero NO PUEDE ESCRIBIR: «no pertenece al canal»', exp: 'DENY',
          ...escribir('u_sa', { isAuthorized: true, role: 'superadmin' }, null,
                      { clubId: CLUB_A, senderUid: 'u_sa', text: 'hola', createdAt: '2026-09-18T10:00:00.000Z' }) },

        // ── 3. ESCRIBIR: el remitente tiene que ser quien firma.
        { n: '3a · ✅ el director escribe un mensaje firmado por él', exp: 'ALLOW',
          ...escribir('u_dir', DIRECTOR_A, null,
                      { clubId: CLUB_A, senderUid: 'u_dir', senderRole: 'director',
                        text: 'reunión el jueves', createdAt: '2026-09-18T10:00:00.000Z' }) },
        { n: '3b · 🔑 SUPLANTACIÓN: no puede firmar como OTRO miembro', exp: 'DENY',
          ...escribir('u_dir', DIRECTOR_A, null,
                      { clubId: CLUB_A, senderUid: 'u_coach', senderRole: 'coach',
                        text: 'lo dijo el entrenador', createdAt: '2026-09-18T10:00:00.000Z' }) },
        { n: '3c · 🔑 ni escribir en el canal de OTRO club', exp: 'DENY',
          ...escribir('u_dir', DIRECTOR_A, null,
                      { clubId: CLUB_B, senderUid: 'u_dir', text: 'hola',
                        createdAt: '2026-09-18T10:00:00.000Z' }) },
        { n: '3d · 🔑 un mensaje enviado NO SE EDITA (nadie, nunca)', exp: 'DENY',
          req: { auth: { uid: 'u_dir', token: tok() }, path: `${DB}/cronos_staff_messages/M1`,
                 method: 'update', resource: { data: { ...MSG_A, text: 'ahora digo otra cosa' } } },
          mocks: mocks('u_dir', DIRECTOR_A, null), existing: MSG_A },

        // ── 4. LA EXPULSIÓN. El par ALLOW/DENY es el MISMO usuario: sólo cambia
        //      la lista de expulsados, así que mide la regla y no otra cosa.
        { n: '4a · ✅ con la cabecera creada pero sin él en la lista, entra', exp: 'ALLOW',
          ...leer('u_coach', ENTRENADOR_USER, { clubId: CLUB_A, expelledUids: ['otro_uid'] }) },
        { n: '4b · 🔑🔑 EXPULSADO: el mismo entrenador ya no lee', exp: 'DENY',
          ...leer('u_coach', ENTRENADOR_USER, { clubId: CLUB_A, expelledUids: ['u_coach'] }) },
        { n: '4c · 🔑 y tampoco escribe', exp: 'DENY',
          ...escribir('u_coach', ENTRENADOR_USER, { clubId: CLUB_A, expelledUids: ['u_coach'] },
                      { clubId: CLUB_A, senderUid: 'u_coach', text: 'sigo aquí',
                        createdAt: '2026-09-18T10:00:00.000Z' }) },
        { n: '4d · ⚠️ una cabecera SIN el campo `expelledUids` no rompe nada', exp: 'ALLOW',
          ...leer('u_coach', ENTRENADOR_USER, { clubId: CLUB_A }) },

        // ── 5. BORRADO: lo propio, y el administrador para el vaciado.
        { n: '5a · ✅ cada uno borra SU mensaje', exp: 'ALLOW',
          req: { auth: { uid: 'otroTecnico', token: tok() },
                 path: `${DB}/cronos_staff_messages/M1`, method: 'delete' },
          mocks: mocks('otroTecnico', DIRECTOR_A, null), existing: MSG_A },
        { n: '5b · 🔑 pero NO el de otro', exp: 'DENY',
          req: { auth: { uid: 'u_coach', token: tok() },
                 path: `${DB}/cronos_staff_messages/M1`, method: 'delete' },
          mocks: mocks('u_coach', ENTRENADOR_USER, null), existing: MSG_A },
        { n: '5c · ✅ el ADMINISTRADOR DEL CLUB sí (es quien vacía el histórico)', exp: 'ALLOW',
          req: { auth: { uid: 'u_admin', token: tok({ role: 'club_admin', clubId: CLUB_A }) },
                 path: `${DB}/cronos_staff_messages/M1`, method: 'delete' },
          mocks: mocks('u_admin', { clubId: CLUB_A, isAuthorized: true, role: 'club_admin' }, null),
          existing: MSG_A },

        // ── 6. LA CABECERA: expulsar es cosa del ADMINISTRADOR, y de nadie más.
        { n: '6a · ✅ el administrador del club escribe la lista de expulsados', exp: 'ALLOW',
          req: { auth: { uid: 'u_admin', token: tok({ role: 'club_admin', clubId: CLUB_A }) },
                 path: `${DB}/cronos_staff_channel/${CLUB_A}`, method: 'create',
                 resource: { data: { clubId: CLUB_A, expelledUids: ['u_coach'] } } },
          mocks: mocks('u_admin', { clubId: CLUB_A, isAuthorized: true, role: 'club_admin' }, null) },
        { n: '6b · 🔑🔑 el DIRECTOR no puede expulsar a nadie', exp: 'DENY',
          req: { auth: { uid: 'u_dir', token: tok({ clubId: CLUB_A }) },
                 path: `${DB}/cronos_staff_channel/${CLUB_A}`, method: 'create',
                 resource: { data: { clubId: CLUB_A, expelledUids: ['u_coach'] } } },
          mocks: mocks('u_dir', DIRECTOR_A, null) },
        { n: '6c · 🔑 ni el entrenador puede quitarse a sí mismo de la lista', exp: 'DENY',
          req: { auth: { uid: 'u_coach', token: tok({ clubId: CLUB_A }) },
                 path: `${DB}/cronos_staff_channel/${CLUB_A}`, method: 'update',
                 resource: { data: { clubId: CLUB_A, expelledUids: [] } } },
          mocks: mocks('u_coach', ENTRENADOR_USER, { clubId: CLUB_A, expelledUids: ['u_coach'] }),
          existing: { clubId: CLUB_A, expelledUids: ['u_coach'] } },
        { n: '6d · ✅ pero SÍ puede leer la cabecera de su canal', exp: 'ALLOW',
          req: { auth: { uid: 'u_coach', token: tok({ clubId: CLUB_A }) },
                 path: `${DB}/cronos_staff_channel/${CLUB_A}`, method: 'get' },
          mocks: mocks('u_coach', ENTRENADOR_USER, { clubId: CLUB_A, expelledUids: [] }),
          existing: { clubId: CLUB_A, expelledUids: [] } },
    ];
}

(async () => {
    console.log('\n══ v739 · reglas del chat común del club ══\n');

    let token;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        token = await getAccessToken(cfg.tokens.refresh_token);
    } catch (e) {
        console.log('  SKIP · sin sesión del CLI de Firebase (ejecuta `firebase login`).');
        console.log('         ' + e.message);
        process.exit(0);
    }
    ok('0a · sesión del CLI válida', !!token);

    const source = { files: [{ name: 'firestore.rules',
        content: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }] };

    const cs = casos();
    const testCases = cs.map(c => {
        const tc = { expectation: c.exp, request: { ...c.req },
                     functionMocks: c.mocks, pathEncoding: 'PLAIN' };
        if (c.existing) tc.resource = { data: c.existing };
        return tc;
    });

    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
        token, { source, testSuite: { testCases } });

    if (r.status !== 200) {
        ok('0b · la Rules API responde 200', false, { status: r.status, body: r.body.slice(0, 600) });
        console.log('\n' + pass + '/' + (pass + fail) + ' aserciones OK');
        process.exit(1);
    }
    ok('0b · la Rules API responde 200 (las reglas COMPILAN)', true);

    const res = JSON.parse(r.body);

    // 🚨 `errorPosition` SE TRATA COMO FALLO AUNQUE EL ESTADO SEA `SUCCESS`: es
    // la única forma de distinguir «la regla denegó» de «la regla se averió»,
    // que en un caso DENY son indistinguibles.
    const errores = (res.testResults || []).flatMap((t, i) =>
        (t.errorPosition ? [`${cs[i].n}: ${JSON.stringify(t.errorPosition)}`] : []));
    ok('0c · 🚨 ninguna evaluación se AVERIÓ (errorPosition vacío)', errores.length === 0, errores);

    (res.testResults || []).forEach((t, i) => {
        ok(cs[i].n, t.state === 'SUCCESS', {
            estado: t.state,
            nota: t.state === 'FAILURE' ? 'la regla hizo LO CONTRARIO de lo esperado' : t.debugMessages,
        });
    });

    ok('0d · se evaluaron los ' + cs.length + ' casos',
       (res.testResults || []).length === cs.length, (res.testResults || []).length);

    console.log('\n' + pass + '/' + (pass + fail) + ' aserciones OK');
    process.exit(fail ? 1 : 0);
})();

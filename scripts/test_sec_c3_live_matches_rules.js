// ─────────────────────────────────────────────────────────────────────────
// test_sec_c3_live_matches_rules.js
//
// SEC-C3 · TEST DE COMPORTAMIENTO de las reglas de `live_matches`.
//
// ⚠️ POR QUE ESTE ARCHIVO EXISTE Y POR QUE NO USA EL EMULADOR
// CORRECCIONES_ESTADO.md daba SEC-C3 por BLOQUEADO "por entorno": el emulador
// de Firestore exige JDK >= 21 y esta maquina solo tiene JDK 8, y ademas npm y
// adoptium.net son inalcanzables (HTTP 000), asi que no se puede instalar ni el
// JDK ni @firebase/rules-unit-testing.
//
// Las dos cosas siguen siendo ciertas — comprobadas el 2026-07-29 — pero la
// conclusion no: NO HACE FALTA EL EMULADOR. La Firebase Rules REST API tiene un
// metodo `projects/{p}:test` que evalua las reglas EN EL SERVIDOR de Google
// contra peticiones simuladas. Sin Java, sin emulador y sin npm; solo hace
// falta el refresh_token del CLI, que ya se usa en scripts/verify_sec_c1_prod.js
// para leer el ruleset desplegado. Los dominios de Google SI son alcanzables
// desde aqui (es como se despliega).
//
// QUE SE PRUEBA: los 5 casos que CORRECCIONES_ESTADO.md dejo escritos, MAS el
// "matiz" que quedaba por decidir — el spoof de creacion cross-club.
//
// ⚠️ ESTO NO SUSTITUYE a un test de emulador en todo: el emulador ejecuta
// tambien la capa de datos real. Aqui los `get()`/`exists()` sobre users/{uid}
// se sirven con functionMocks, asi que lo que se valida es LA LOGICA DE LAS
// REGLAS, que es exactamente lo que SEC-C3 pedia.
//
// Requiere sesion del CLI (`firebase login`). Si no la hay, el test se SALTA
// con aviso en vez de fallar, para no romper la suite en CI.
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

// ── mocks de los get()/exists() sobre users/{uid} que usan isRegisteredUser,
// userDocClubId, isSuperAdminEmail y isStaffRoleByDoc.
function mocksUsuario(uid, data) {
    const p = `${DB}/users/${uid}`;
    return [
        { function: 'exists', args: [{ exactValue: p }], result: { value: data !== null } },
        { function: 'get', args: [{ exactValue: p }], result: { value: { data: data || {} } } },
        // cronos_config/superadmins: por defecto no existe (nadie es SA por email)
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
    ];
}

const CLUB_A = 'clubA', CLUB_B = 'clubB';
const COACH_A = 'coachA_uid';

// Cada caso: nombre, expectativa, peticion y mocks.
function casos() {
    const partidoDeB = { clubId: CLUB_B, createdBy: 'otro_uid', coachEmail: 'otro@club.es', events: [] };
    const partidoDeA = { clubId: CLUB_A, createdBy: 'otro_uid', coachEmail: 'otro@club.es', events: [] };
    const partidoHuerfano = { clubId: null, createdBy: COACH_A, coachEmail: 'a@club.es', events: [] };
    const docCoachA = { clubId: CLUB_A, isAuthorized: true, role: 'user' };

    return [
        // ── (a) coach del club A -> update de un partido del club B -> DENY
        { n: 'a · coach del club A NO puede actualizar un partido del club B',
          exp: 'DENY',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_B`, method: 'update',
                 resource: { data: { ...partidoDeB, events: ['x'] } } },
          mocks: mocksUsuario(COACH_A, docCoachA),
          // el doc EXISTENTE es el del club B
          existing: partidoDeB },

        // ── (b) coach del club A -> su propio partido -> ALLOW
        { n: 'b · coach del club A SI puede actualizar un partido de su club',
          exp: 'ALLOW',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', clubId: CLUB_A, role: 'club_admin', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_A`, method: 'update',
                 resource: { data: { ...partidoDeA, events: ['x'] } } },
          mocks: mocksUsuario(COACH_A, docCoachA),
          existing: partidoDeA },

        // ── (c) coach SIN clubId en el token pero users/{uid}.clubId coincide -> ALLOW
        //     (es la rama userDocClubId, la que cubre el caso v268 del arrayUnion)
        { n: 'c · coach SIN claim de clubId pero con users/{uid}.clubId correcto SI puede',
          exp: 'ALLOW',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_A`, method: 'update',
                 resource: { data: { ...partidoDeA, events: ['x'] } } },
          mocks: mocksUsuario(COACH_A, docCoachA),
          existing: partidoDeA },

        // ── (d) partido legacy sin clubId, creado por el propio coach -> ALLOW
        { n: 'd · el coach SI puede actualizar su propio partido huerfano (createdBy == uid)',
          exp: 'ALLOW',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_H`, method: 'update',
                 resource: { data: { ...partidoHuerfano, events: ['x'] } } },
          mocks: mocksUsuario(COACH_A, docCoachA),
          existing: partidoHuerfano },

        // ── (e) superadmin -> ALLOW
        { n: 'e · el superadmin SI puede actualizar cualquier partido',
          exp: 'ALLOW',
          req: { auth: { uid: 'sa_uid', token: { email: 'sa@x.es', role: 'superadmin', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_B`, method: 'update',
                 resource: { data: { ...partidoDeB, events: ['x'] } } },
          mocks: mocksUsuario('sa_uid', { isAuthorized: true, role: 'superadmin' }),
          existing: partidoDeB },

        // ── (f) ⚠️ EL MATIZ QUE SEC-C3 DEJABA POR DECIDIR: spoof de creacion
        //     cross-club. Un coach del club A crea un partido con clubId=B
        //     poniendose a si mismo como createdBy. ANTES pasaba por la rama
        //     createdBy; hoy esa rama exige clubId == null, asi que debe DENEGAR.
        { n: 'f · ⚠️ SPOOF CROSS-CLUB: coach de A NO puede crear un partido con clubId=B poniendose de createdBy',
          exp: 'DENY',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_NUEVO`, method: 'create',
                 resource: { data: { clubId: CLUB_B, createdBy: COACH_A, coachEmail: 'a@club.es', events: [] } } },
          mocks: mocksUsuario(COACH_A, docCoachA) },

        // ── (g) el mismo spoof pero via coachEmail -> tambien DENY
        { n: 'g · ⚠️ SPOOF CROSS-CLUB via coachEmail: tampoco puede',
          exp: 'DENY',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_NUEVO`, method: 'create',
                 resource: { data: { clubId: CLUB_B, coachEmail: 'a@club.es', events: [] } } },
          mocks: mocksUsuario(COACH_A, docCoachA) },

        // ── (h) el caso LEGITIMO que esa rama debe seguir permitiendo: el
        //     bootstrap del coach, un doc SIN clubId creado por el mismo.
        { n: 'h · pero el bootstrap legitimo (partido SIN clubId, createdBy propio) SI se permite',
          exp: 'ALLOW',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_NUEVO`, method: 'create',
                 resource: { data: { createdBy: COACH_A, events: [] } } },
          mocks: mocksUsuario(COACH_A, docCoachA) },

        // ── (i) crear en el propio club por userDocClubId -> ALLOW
        { n: 'i · crear un partido de SU club (userDocClubId) si se permite',
          exp: 'ALLOW',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_NUEVO`, method: 'create',
                 resource: { data: { clubId: CLUB_A, createdBy: COACH_A, events: [] } } },
          mocks: mocksUsuario(COACH_A, docCoachA) },

        // ── (m/n) FIDELIDAD DE "REVIVIR" (2026-07-29): el snapshot que lleva la
        //     ALINEACION INICIAL (`initialPlayers`/`initialFormation`) tiene que
        //     pasar las reglas, o el campo no llegaria nunca y la repeticion
        //     seguiria arrancando desde el once FINAL.
        //     ⚠️ POR ESTO SE COMPRUEBA: el primer intento de guardarla iba en el
        //     setDoc de respaldo de startLiveSync, que escribe un doc SIN clubId
        //     ni createdBy — o sea el caso (h3) de aqui abajo, DENEGADO. Se
        //     habria perdido en silencio justo en los partidos nuevos. Ahora
        //     viaja con pushLiveSnapshot, que sí manda clubId/createdBy.
        { n: 'm · el snapshot con initialPlayers SI se puede crear (lleva clubId y createdBy)',
          exp: 'ALLOW',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_NUEVO`, method: 'create',
                 resource: { data: { clubId: CLUB_A, createdBy: COACH_A, coachEmail: 'a@club.es',
                                     players: [], initialPlayers: [{ id: 1, name: 'Alba', status: 'field' }],
                                     initialFormation: '1-3-3' } } },
          mocks: mocksUsuario(COACH_A, docCoachA) },

        { n: 'n · y tambien actualizarse (los latidos siguientes no la reescriben)',
          exp: 'ALLOW',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_A`, method: 'update',
                 resource: { data: { ...partidoDeA, initialPlayers: [{ id: 1, name: 'Alba', status: 'field' }] } } },
          mocks: mocksUsuario(COACH_A, docCoachA),
          existing: partidoDeA },

        // ── (j) SEC-C2, ya cerrado: nadie ajeno borra un partido huerfano
        { n: 'j · SEC-C2 sigue cerrado: un usuario ajeno NO puede borrar un partido sin clubId',
          exp: 'DENY',
          req: { auth: { uid: 'intruso_uid', token: { email: 'intruso@otro.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_H`, method: 'delete' },
          mocks: mocksUsuario('intruso_uid', { clubId: 'clubZ', isAuthorized: true }),
          existing: { clubId: null, createdBy: COACH_A, coachEmail: 'a@club.es' } },

        // ── (k) y el coach SI puede borrar el suyo
        { n: 'k · el coach SI puede borrar su propio partido huerfano',
          exp: 'ALLOW',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_H`, method: 'delete' },
          mocks: mocksUsuario(COACH_A, docCoachA),
          existing: { clubId: null, createdBy: COACH_A, coachEmail: 'a@club.es' } },

        // ── (h2) el mismo bootstrap pero con clubId EXPLICITAMENTE null. Este
        //     caso YA funcionaba: la diferencia con (h) es clave ausente vs
        //     valor null, y es exactamente lo que rompia la regla.
        { n: 'h2 · bootstrap con clubId explicitamente null tambien se permite',
          exp: 'ALLOW',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_NUEVO`, method: 'create',
                 resource: { data: { clubId: null, createdBy: COACH_A, events: [] } } },
          mocks: mocksUsuario(COACH_A, docCoachA) },

        // ── (h3) ⚠️ el doc que escribe match/events/player-actions.js cuando el
        //     partido no existe: SOLO `events`, sin clubId, sin createdBy y sin
        //     coachEmail. Se DENIEGA, y debe seguir denegandose: un documento
        //     sin club y sin duenyo no puede crearlo nadie. Queda anotado aqui
        //     porque explica un permission-denied legitimo si el doc del
        //     partido se borra a mitad (el camino normal lo crea
        //     pushLiveSnapshot con los datos completos).
        { n: 'h3 · un doc SOLO con events (sin club ni duenyo) NO se puede crear',
          exp: 'DENY',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_NUEVO`, method: 'create',
                 resource: { data: { events: [] } } },
          mocks: mocksUsuario(COACH_A, docCoachA) },

        // ── (h4) y un bootstrap sin clubId pero con el createdBy de OTRO -> DENY
        { n: 'h4 · bootstrap sin clubId con createdBy AJENO se deniega',
          exp: 'DENY',
          req: { auth: { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_NUEVO`, method: 'create',
                 resource: { data: { createdBy: 'otro_uid', events: [] } } },
          mocks: mocksUsuario(COACH_A, docCoachA) },

        // ── (l) lectura: exige usuario registrado y autorizado
        { n: 'l · un usuario NO autorizado no puede leer un partido en vivo',
          exp: 'DENY',
          req: { auth: { uid: 'pendiente_uid', token: { email: 'p@x.es', firebase: { sign_in_provider: 'password' } } },
                 path: `${DB}/live_matches/M_A`, method: 'get' },
          mocks: mocksUsuario('pendiente_uid', { isAuthorized: false }),
          existing: { clubId: CLUB_A } },
    ];
}

(async () => {
    console.log('── SEC-C3 · comportamiento de las reglas de live_matches ──\n');

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

    const source = { files: [{ name: 'firestore.rules', content: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }] };

    const cs = casos();
    const testCases = cs.map(c => {
        const req = { ...c.req };
        // en update/delete/get, el documento EXISTENTE va en request.resource
        // para `update` y ademas hace falta `data` previa: la API lo modela con
        // `request.resource.data` (entrante) y el doc actual se declara aparte.
        const tc = { expectation: c.exp, request: req, functionMocks: c.mocks, pathEncoding: 'PLAIN' };
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
    const errores = (res.testResults || []).flatMap((t, i) => (t.errorPosition ? [`${cs[i].n}: ${JSON.stringify(t.errorPosition)}`] : []));
    ok('0c · ninguna evaluacion dio error de compilacion', errores.length === 0, errores);

    (res.testResults || []).forEach((t, i) => {
        ok(cs[i].n + '  [espera ' + cs[i].exp + ']', t.state === 'SUCCESS', {
            estado: t.state,
            // en un FAILURE la regla dio lo contrario de lo esperado
            nota: t.state === 'FAILURE' ? 'la regla NO se comporto como se esperaba' : t.debugMessages,
        });
    });

    ok('1z · se evaluaron los ' + cs.length + ' casos', (res.testResults || []).length === cs.length,
        (res.testResults || []).length);

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

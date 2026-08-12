// ════════════════════════════════════════════════════════════════════
//  GUARD · REGLAS DE clubs/{clubId}/team_rosters (plazas de apoyo)
//  2026-08-12
// ════════════════════════════════════════════════════════════════════
//  Prueba el COMPORTAMIENTO de las reglas contra el servidor de Google con
//  el método :test de la Rules REST API (sin emulador ni JDK). Ver
//  scripts/test_sec_c1_create_escalation.js, de donde sale el patrón.
//
//  🔑 POR QUÉ EXISTE: el entrenador reportó un 400 al abrir el selector. Con
//  el SDK web, **una denegación de reglas se ve como HTTP 400 en la consola**,
//  no como un 403 legible, así que "400" y "permiso denegado" son
//  indistinguibles desde fuera. Esto lo separa.
//
//  🔑 EL CASO QUE IMPORTA ES EL `list`: el selector NO lee un documento
//  suelto, hace getDocs() sobre la colección. Una regla puede permitir `get`
//  y denegar `list`, y es un fallo que no se ve leyendo el fichero.
//
//  ⚠️ El token del ENTRENADOR normalmente NO lleva el claim 'clubId' (está
//  documentado en las propias reglas), así que su vía real es userDocClubId(),
//  que mira users/{uid}. Los casos de abajo lo reproducen tal cual.
// ════════════════════════════════════════════════════════════════════
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJECT = 'cronos-futbol-app';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';

let FALLOS = 0;
const ok = (t, c, extra) => {
    console.log((c ? 'PASS ' : 'FAIL ') + t + (c || extra === undefined ? '' : '   → ' + JSON.stringify(extra)));
    if (!c) FALLOS++;
};

function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
                       'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            // ⚠️ Buffer.concat y NO `d += chunk`: un multibyte partido entre dos
            // chunks se corrompe y produce falsas discrepancias.
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body); req.end();
    });
}

function getAccessToken(rt) {
    const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
    const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
    const body = new URLSearchParams({ refresh_token: rt, client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET, grant_type: 'refresh_token' }).toString();
    return new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const d = Buffer.concat(chunks).toString('utf8');
                try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : resolve(null); }
                catch (e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.write(body); req.end();
    });
}

const CLUB = 'club_x';
const COACH = 'uid_entrenador';
const RUTA_COL = DB + '/clubs/' + CLUB + '/team_rosters';
const RUTA_DOC = RUTA_COL + '/club-x__alevin__c';

// ⚠️⚠️ EL 'list' SE PIDE CONTRA LA RUTA DE **DOCUMENTO**, NO LA DE COLECCIÓN.
// Medido con una sonda de control el 2026-08-12: con `allow read: if true`,
// un caso {path: <colección>, method:'list'} sale FAILURE igualmente. O sea que
// pedirlo contra la colección da un ROJO POR LA RAZÓN EQUIVOCADA — yo llegué a
// creer que las reglas denegaban el listado del selector y no era cierto.
// La sonda: colección→FALLA, documento→OK, con la MISMA regla permisiva.

// Mocks: el entrenador está en users/, autorizado y de ese club; NO es
// superadmin ni administrador del club.
const M = (extra) => [
    { function: 'exists', args: [{ exactValue: DB + '/cronos_config/superadmins' }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: DB + '/cronos_config/superadmins' }],
      result: { value: { data: { emails: ['jefe@ejemplo.com'] } } } },
    { function: 'exists', args: [{ exactValue: DB + '/clubs/' + CLUB }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: DB + '/clubs/' + CLUB }],
      result: { value: { data: { adminUid: 'OTRO_UID', adminEmail: 'admin@ejemplo.com' } } } },
    { function: 'exists', args: [{ exactValue: DB + '/users/' + COACH }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: DB + '/users/' + COACH }],
      result: { value: { data: extra } } },
];

const AUTORIZADO = { clubId: CLUB, isAuthorized: true, role: 'user' };
const DE_OTRO    = { clubId: 'club_z', isAuthorized: true, role: 'user' };
const SIN_AUTORIZAR = { clubId: CLUB, isAuthorized: false, role: 'user' };

const CASOS = [
    { n: '1a · 🔑🔑 el ENTRENADOR del club LISTA la colección (lo que hace el selector)',
      exp: 'ALLOW', mocks: M(AUTORIZADO),
      req: { auth: { uid: COACH, token: { email: 'entre@ejemplo.com' } },
             path: RUTA_DOC, method: 'list', time: new Date().toISOString() } },

    { n: '1b · y también lee un documento suelto',
      exp: 'ALLOW', mocks: M(AUTORIZADO),
      req: { auth: { uid: COACH, token: { email: 'entre@ejemplo.com' } },
             path: RUTA_DOC, method: 'get', time: new Date().toISOString() } },

    { n: '2a · 🔑 un entrenador de OTRO club NO puede listarla',
      exp: 'DENY', mocks: M(DE_OTRO),
      req: { auth: { uid: COACH, token: { email: 'ajeno@ejemplo.com' } },
             path: RUTA_DOC, method: 'list', time: new Date().toISOString() } },

    { n: '2b · 🔑 ni un miembro del club SIN autorizar',
      exp: 'DENY', mocks: M(SIN_AUTORIZAR),
      req: { auth: { uid: COACH, token: { email: 'pendiente@ejemplo.com' } },
             path: RUTA_DOC, method: 'list', time: new Date().toISOString() } },

    // El Panel de Dirección lee TODAS las plantillas del club para listar en el
    // acumulado a quien aún no ha jugado (2026-08-12). Su vía es la misma que
    // la del entrenador: users/{uid}.clubId + isAuthorized.
    { n: '2c · 🔑 el DIRECTOR del club lista las plantillas (tabla acumulada)',
      exp: 'ALLOW', mocks: M({ clubId: CLUB, isAuthorized: true, role: 'director' }),
      req: { auth: { uid: COACH, token: { email: 'director@ejemplo.com' } },
             path: RUTA_DOC, method: 'list', time: new Date().toISOString() } },

    { n: '3a · 🔑 sólo el dueño escribe su ficha',
      exp: 'ALLOW', mocks: M(AUTORIZADO),
      req: { auth: { uid: COACH, token: { email: 'entre@ejemplo.com' } },
             path: RUTA_DOC, method: 'create', time: new Date().toISOString(),
             resource: { data: { coachUid: COACH, clubId: CLUB } } } },

    { n: '3b · 🔑🔑 otro entrenador NO puede crear la ficha de un equipo ajeno',
      exp: 'DENY', mocks: M(AUTORIZADO),
      req: { auth: { uid: 'OTRO_ENTRENADOR', token: { email: 'otro@ejemplo.com' } },
             path: RUTA_DOC, method: 'create', time: new Date().toISOString(),
             resource: { data: { coachUid: COACH, clubId: CLUB } } } },

    { n: '3c · 🔑🔑🔑 y NO puede reescribir la ajena poniéndose de coachUid',
      exp: 'DENY', mocks: M(AUTORIZADO), existing: { coachUid: COACH, clubId: CLUB },
      req: { auth: { uid: 'INTRUSO', token: { email: 'intruso@ejemplo.com' } },
             path: RUTA_DOC, method: 'update', time: new Date().toISOString(),
             resource: { data: { coachUid: 'INTRUSO', clubId: CLUB } } } },
];

(async () => {
    console.log('── REGLAS de clubs/{id}/team_rosters (' + PROJECT + ') ──\n');
    let rt = null;
    try { rt = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token; } catch (e) {}
    if (!rt) { console.log('SKIP · sin sesión del CLI de Firebase (`firebase login`).'); process.exit(0); }
    const token = await getAccessToken(rt);
    if (!token) { console.log('SKIP · no se pudo renovar el token del CLI.'); process.exit(0); }

    const source = { files: [{ name: 'firestore.rules',
        content: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }] };
    const r = await post('https://firebaserules.googleapis.com/v1/projects/' + PROJECT + ':test', token, {
        source, testSuite: { testCases: CASOS.map(c => {
            const tc = { expectation: c.exp, request: c.req, functionMocks: c.mocks, pathEncoding: 'PLAIN' };
            if (c.existing) tc.resource = { data: c.existing };
            return tc;
        }) },
    });

    if (r.status !== 200) {
        // ⚠️ La API da `internal_failure` transitorio: no culpar al cambio a la primera.
        ok('0 · la Rules API responde 200', false, { status: r.status, body: r.body.slice(0, 300) });
        process.exit(1);
    }
    const res = JSON.parse(r.body);
    (res.testResults || []).forEach((t, i) => {
        // 🔑 errorPosition se trata como FALLO aunque el state sea SUCCESS: en un
        // caso DENY, "la regla denegó" y "la regla se averió" son indistinguibles.
        const averia = !!t.errorPosition;
        ok(CASOS[i].n + '  [espera ' + CASOS[i].exp + ']',
           t.state === 'SUCCESS' && !averia,
           averia ? { averia: t.errorPosition } : t.state);
    });
    ok('9z · se evaluaron los ' + CASOS.length + ' casos',
       (res.testResults || []).length === CASOS.length);

    console.log('\n' + (FALLOS ? '❌ ' + FALLOS + ' FALLOS' : '✅ TODO VERDE'));
    process.exit(FALLOS ? 1 : 0);
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });

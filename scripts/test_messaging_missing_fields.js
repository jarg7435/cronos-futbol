// ─────────────────────────────────────────────────────────────────────────
// test_messaging_missing_fields.js · cronos_messages y el CAMPO AUSENTE (v437)
//
// QUE SE ARREGLA, Y CON QUE ALCANCE — medido, no supuesto.
//
// Leer una clave AUSENTE de un mapa LANZA. Lo que NO es cierto —y yo lo di por
// bueno tres veces (v435, v436 y el primer intento de v437)— es que ese error
// tumbe la condicion entera. Medido contra el servidor de Google:
//
//   · una rama lanza y OTRA devuelve true  -> PERMITE (el error no propaga)
//   · una rama lanza y NINGUNA da true     -> DENIEGA, que es lo que tocaba
//
// O sea: en un OR, el acceso directo a un campo ausente NO cambia el resultado
// de la autorizacion. Los hilos sin `participants` SI se leian, porque la rama
// de `coachUid` o la de `parentUid` devolvia true.
//
// ENTONCES, ¿PARA QUE ESTE CAMBIO? Por fragilidad, no por un fallo actual: hoy
// funciona porque SIEMPRE queda otra rama verdadera. El dia que alguien
// reordene, acote o elimine esa rama —cosa que ha pasado varias veces en este
// fichero— el error pasaria a decidir, y el sintoma seria un
// "Missing or insufficient permissions" imposible de atribuir a su causa. El
// arreglo quita esa mina y de paso deja de ensuciar los logs de evaluacion.
//
// Los casos de la PARTE 2 valen por tanto como NO REGRESION —confirman que el
// cambio no ha roto ninguna via de acceso— y no como demostracion de un bug
// arreglado. La PARTE 3 es la que ensena el riesgo real, con una regla donde el
// campo ausente es la UNICA via.
//
// ⚠️ EN UN CASO CUYO RESULTADO ESPERADO ES DENY, una regla ROTA y una regla
// ESTRICTA son indistinguibles: las dos deniegan. Por eso `errorPosition` se
// trata como FALLO aunque el estado sea SUCCESS.
//
// ⚠️ `request.time` hay que pasarlo explicitamente en cada testCase (ver v434).
// Se salta con aviso si no hay sesion del CLI.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const PROJECT = 'cronos-futbol-app';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

console.log('── cronos_messages: el campo ausente (v437) ──');

// ═══════════ PARTE 1 · censo, solo como apoyo ═══════════
console.log('\n── PARTE 1 · el bloque ya no accede directo ──');
{
    const i = RULES.indexOf('match /cronos_messages/');
    const fin = RULES.indexOf('match /', i + 10);
    const bloque = i === -1 ? '' : RULES.slice(i, fin === -1 ? i + 6000 : fin);

    ok('1a · el bloque de cronos_messages existe', bloque.length > 100);
    ['participants', 'coachUid', 'parentUid', 'staffUid', 'clubId'].forEach(campo => {
        ok('1b · ya no hay acceso directo a resource.data.' + campo,
           !new RegExp('resource\\.data\\.' + campo + '\\b').test(bloque),
           'un hilo sin ese campo hacia LANZAR la condicion entera');
    });
    ok('1c · y las cuatro operaciones siguen declaradas',
       /allow read:/.test(bloque) && /allow create:/.test(bloque)
       && /allow update:/.test(bloque) && /allow delete:/.test(bloque));
}

// ═══════════ PARTE 2 · evaluadas en el servidor ═══════════
console.log('\n── PARTE 2 · comportamiento real (Rules REST API) ──');

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
            const cs = []; res.on('data', c => cs.push(c));
            res.on('end', () => { const d = Buffer.concat(cs).toString('utf8');
                try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); }
                catch (e) { reject(new Error(d.slice(0, 200))); } });
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
            // Buffers y no `d += chunk`: acumular string corrompe los multibyte
            // partidos entre dos chunks (trampa pagada en v391).
            res => { const cs = []; res.on('data', c => cs.push(c));
                     res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(cs).toString('utf8') })); });
        req.on('error', reject); req.write(body); req.end();
    });
}
function mocks(uid, data) {
    const p = `${DB}/users/${uid}`;
    return [
        { function: 'exists', args: [{ exactValue: p }], result: { value: data !== null } },
        { function: 'get', args: [{ exactValue: p }], result: { value: { data: data || {} } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
    ];
}

const CLUB = 'clubA';
const iso = (ms) => new Date(ms).toISOString();
const AHORA = Date.now();

const docCoach  = { clubId: CLUB, isAuthorized: true, role: 'coach' };
const docPadre  = { clubId: CLUB, isAuthorized: true, role: 'parent' };
const docOtro   = { clubId: 'clubZ', isAuthorized: true, role: 'user' };

const authCoach = { uid: 'coach_uid', token: { email: 'c@club.es', firebase: { sign_in_provider: 'password' } } };
const authPadre = { uid: 'padre_uid', token: { email: 'p@club.es', firebase: { sign_in_provider: 'password' } } };
const authOtro  = { uid: 'otro_uid',  token: { email: 'x@otro.es', firebase: { sign_in_provider: 'password' } } };

// Los hilos MAL FORMADOS son el corazon del test: cada uno tiene un campo menos.
const hiloCompleto   = { clubId: CLUB, participants: ['coach_uid', 'padre_uid'],
                         coachUid: 'coach_uid', parentUid: 'padre_uid', staffUid: null };
const sinParticipants = { clubId: CLUB, coachUid: 'coach_uid', parentUid: 'padre_uid' };
const sinCoachUid     = { clubId: CLUB, participants: ['coach_uid', 'padre_uid'], parentUid: 'padre_uid' };
const sinClubId       = { participants: ['coach_uid', 'padre_uid'], coachUid: 'coach_uid' };
const soloParticipants = { participants: ['coach_uid', 'padre_uid'] };

function casos() {
    return [
        { n: '2a · hilo COMPLETO: el coach lo lee',
          exp: 'ALLOW', auth: authCoach, doc: docCoach, method: 'get', existing: hiloCompleto },

        { n: '2b · hilo SIN participants: el coach lo lee, y sin error de evaluacion',
          exp: 'ALLOW', auth: authCoach, doc: docCoach, method: 'get', existing: sinParticipants,
          why: 'ya se leia antes (otra rama daba true); lo que cambia es que ya no lanza' },

        { n: '2c · hilo SIN coachUid: el participante lo lee',
          exp: 'ALLOW', auth: authPadre, doc: docPadre, method: 'get', existing: sinCoachUid },

        { n: '2d · hilo SIN clubId: el participante lo lee',
          exp: 'ALLOW', auth: authCoach, doc: docCoach, method: 'get', existing: sinClubId },

        { n: '2e · hilo MINIMO (solo participants): se lee',
          exp: 'ALLOW', auth: authPadre, doc: docPadre, method: 'get', existing: soloParticipants },

        { n: '2f · y un extrano NO lo lee — por logica, no por averia',
          exp: 'DENY', auth: authOtro, doc: docOtro, method: 'get', existing: soloParticipants,
          why: 'antes denegaba CON error de evaluacion: el resultado correcto por el motivo equivocado' },

        { n: '2g · el extrano tampoco lee el hilo completo de otro club',
          exp: 'DENY', auth: authOtro, doc: docOtro, method: 'get', existing: hiloCompleto },

        { n: '2h · CREATE de un hilo minimo por un participante',
          exp: 'ALLOW', auth: authCoach, doc: docCoach, method: 'create',
          entrante: soloParticipants },

        { n: '2i · un extrano NO crea un hilo en el que no esta',
          exp: 'DENY', auth: authOtro, doc: docOtro, method: 'create',
          entrante: soloParticipants },

        { n: '2j · UPDATE de un hilo sin coachUid por un participante',
          exp: 'ALLOW', auth: authPadre, doc: docPadre, method: 'update',
          existing: sinCoachUid,
          entrante: Object.assign({}, sinCoachUid, { ultimo: 'hola' }) },

        { n: '2k · un extrano NO actualiza un hilo ajeno',
          exp: 'DENY', auth: authOtro, doc: docOtro, method: 'update',
          existing: soloParticipants,
          entrante: Object.assign({}, soloParticipants, { ultimo: 'intruso' }) },

        { n: '2l · DELETE de un hilo sin participants por el SuperAdmin (v436)',
          exp: 'ALLOW',
          auth: { uid: 'sa_uid', token: { email: 'sa@x.es', role: 'superadmin', firebase: { sign_in_provider: 'password' } } },
          doc: { isAuthorized: true, role: 'superadmin' },
          method: 'delete', existing: sinParticipants },

        { n: '2m · un extrano NO borra un hilo ajeno',
          exp: 'DENY', auth: authOtro, doc: docOtro, method: 'delete', existing: hiloCompleto },
    ];
}

(async () => {
    let refresh = null;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        refresh = cfg.tokens && cfg.tokens.refresh_token;
    } catch (e) { /* sin sesion */ }

    if (!refresh) {
        console.log('SKIP · sin sesion del CLI (firebase login): no se evaluan las reglas.');
        console.log('       ⚠️ Lo que este guard prueba de verdad queda SIN PROBAR.');
    } else {
        try {
            const token = await getAccessToken(refresh);
            const cs = casos();
            const testCases = cs.map(c => ({
                expectation: c.exp,
                request: {
                    auth: c.auth,
                    path: `${DB}/cronos_messages/T1`,
                    method: c.method,
                    time: iso(AHORA),
                    resource: c.entrante ? { data: c.entrante } : undefined,
                },
                // En un `create` no hay documento previo: `resource` se omite.
                resource: c.existing ? { data: c.existing } : undefined,
                functionMocks: mocks(c.auth.uid, c.doc),
                pathEncoding: 'PLAIN',
            }));

            const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
                                 token,
                                 { source: { files: [{ name: 'firestore.rules', content: RULES }] },
                                   testSuite: { testCases } });
            const j = JSON.parse(r.body);
            const res = j.testResults || [];
            if (!res.length) {
                ok('2· la API respondio con resultados', false, r.body.slice(0, 400));
            } else {
                cs.forEach((c, i) => {
                    const t = res[i] || {};
                    const rota = !!t.errorPosition;
                    ok(c.n, t.state === 'SUCCESS' && !rota,
                       rota ? ('LA REGLA LANZA: ' + JSON.stringify(t.debugMessages || t.errorPosition).slice(0, 220))
                            : (c.why ? c.why + ' | estado=' + t.state : 'estado=' + t.state));
                });
            }
        } catch (e) {
            ok('2· las reglas se pudieron evaluar', false, e.message);
        }

        // ═══════ PARTE 3 · el riesgo que el cambio quita de en medio ═══════
        // Aqui se ve por que el acceso directo es una mina aunque hoy no
        // explote: en cuanto el campo ausente es la UNICA via de acceso,
        // DENIEGA a quien tiene derecho. Hoy no pasa porque siempre queda otra
        // rama verdadera — pero eso es una propiedad del ORDEN Y NUMERO de
        // ramas, no de la regla, y en este fichero las ramas se han reordenado
        // y acotado varias veces.
        console.log('\n── PARTE 3 · por que importa, aunque hoy no rompa ──');
        try {
            const token = await getAccessToken(refresh);
            const REGLA = (acceso) => `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /t/{id} { allow get: if request.auth.uid in ${acceso}; }
  }
}`;
            const probar = async (acceso) => {
                const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
                    token,
                    { source: { files: [{ name: 'firestore.rules', content: REGLA(acceso) }] },
                      testSuite: { testCases: [{
                          expectation: 'DENY',
                          request: { auth: { uid: 'coach_uid', token: {} },
                                     path: `${DB}/t/X`, method: 'get', time: iso(AHORA) },
                          // El documento NO tiene `participants`.
                          resource: { data: { clubId: CLUB, coachUid: 'coach_uid' } },
                          pathEncoding: 'PLAIN' }] } });
                const j = JSON.parse(r.body);
                return (j.testResults || [])[0] || {};
            };

            const directo = await probar('resource.data.participants');
            ok('3a · con acceso DIRECTO y sin otra via, la regla LANZA',
               directo.state === 'SUCCESS' && !!directo.errorPosition,
               'estado=' + directo.state + ' error=' + !!directo.errorPosition);

            const seguro = await probar("resource.data.get('participants', [])");
            ok('3b · con .get() deniega igual pero SIN error: por logica, no por averia',
               seguro.state === 'SUCCESS' && !seguro.errorPosition,
               'estado=' + seguro.state + ' error=' + !!seguro.errorPosition);
        } catch (e) {
            ok('3· la parte 3 se pudo evaluar', false, e.message);
        }
    }

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();

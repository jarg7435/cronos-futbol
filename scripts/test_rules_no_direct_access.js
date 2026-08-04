// ─────────────────────────────────────────────────────────────────────────
// test_rules_no_direct_access.js · firestore.rules sin accesos directos (v438)
//
// En el lenguaje de reglas, leer una clave AUSENTE de un mapa LANZA. Medido
// contra el servidor (v437), eso NO cambia el veredicto mientras OTRA rama del
// mismo `||` devuelva true — pero SI lo cambia en cuanto el campo ausente es la
// UNICA via de acceso. Y de que haya o no otra rama que salve no responde nada:
// depende del orden y del numero de ramas, que en este fichero se han
// reordenado varias veces.
//
// v438 barrio los 135 accesos directos que quedaban a `.get(campo, default)`.
// La migracion se verifico comparando el veredicto de las reglas ANTES y
// DESPUES sobre 7920 casos (33 colecciones x 5 actores x 12 variantes de
// documento x 4 metodos): CERO cambios de comportamiento, y los errores de
// evaluacion pasaron de 356 a 0.
//
// LO QUE ESTE GUARD FIJA:
//  A · que no vuelva a colarse un acceso directo a resource.data /
//      request.resource.data (el censo, PARTE 1).
//  B · que los accesos a request.auth.token vayan siempre precedidos de su
//      `'campo' in request.auth.token` (PARTE 2). Tres no lo llevaban y en los
//      tres el claim ausente era la UNICA via: un club_admin sin el claim
//      propagado no podia crear su solicitud de sucesion ni ver la facturacion
//      de su club.
//  C · que el comportamiento siga siendo el correcto, evaluado en el servidor
//      (PARTE 3), con los casos del claim ausente que motivaron B.
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
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 400)); }
};

const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

// Sin comentarios: un acceso citado en un comentario no es codigo. Y
// `split(/\r?\n/)`, no `split('\n')`: el `.` de una regex no casa `\r` y en un
// fichero CRLF no se borraria ni un comentario (trampa pagada en v434).
const sinComs = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const CODE = sinComs(RULES);

console.log('── firestore.rules: nada de accesos directos (v438) ──');

// ═══════════ PARTE 1 · el censo ═══════════
console.log('\n── PARTE 1 · resource.data / request.resource.data ──');
{
    // Metodos, no campos: .get(), .diff(), .keys()...
    const METODOS = 'get|diff|keys|size|values|hasOnly|hasAll|hasAny|affectedKeys|toSet';
    const reRes = new RegExp('(?<!request\\.)resource\\.data\\.(?!(?:' + METODOS + ')\\b)([a-zA-Z_]\\w*)', 'g');
    const reReq = new RegExp('request\\.resource\\.data\\.(?!(?:' + METODOS + ')\\b)([a-zA-Z_]\\w*)', 'g');

    const dRes = [...CODE.matchAll(reRes)].map(m => m[0]);
    const dReq = [...CODE.matchAll(reReq)].map(m => m[0]);

    ok('1a · ningun acceso directo a resource.data.CAMPO',
       dRes.length === 0,
       dRes.length + ' encontrados: ' + [...new Set(dRes)].slice(0, 8).join(', '));
    ok('1b · ningun acceso directo a request.resource.data.CAMPO',
       dReq.length === 0,
       dReq.length + ' encontrados: ' + [...new Set(dReq)].slice(0, 8).join(', '));

    // Y que el barrido no se comio los metodos legitimos.
    ok('1c · los .get() estan puestos',
       (CODE.match(/resource\.data\.get\(/g) || []).length > 100);
    ok('1d · y los .diff() de las reglas acotadas siguen ahi',
       /request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)/.test(CODE),
       'son los hasOnly que acotan que campos se pueden tocar');
    ok('1e · `participants` usa lista vacia por defecto, no null',
       !/get\('participants', null\)/.test(CODE) && /get\('participants', \[\]\)/.test(CODE),
       'se usa con `in`: con null en vez de [] la comparacion lanzaria igual');
}

// ═══════════ PARTE 2 · los claims del token ═══════════
console.log('\n── PARTE 2 · request.auth.token siempre con su guarda ──');
{
    const lineas = CODE.split('\n');
    const sinGuarda = [];
    lineas.forEach((l, i) => {
        [...l.matchAll(/request\.auth\.token\.([a-zA-Z_]\w*)/g)].forEach(m => {
            const campo = m[1];
            // La condicion puede venir partida en varias lineas: se mira la
            // propia y las 3 anteriores.
            const ctx = lineas.slice(Math.max(0, i - 3), i + 1).join(' ');
            if (!ctx.includes("'" + campo + "' in request.auth.token")) {
                sinGuarda.push('linea ' + (i + 1) + ': ' + campo);
            }
        });
    });
    ok('2a · todo request.auth.token.CAMPO va precedido de su `in`',
       sinGuarda.length === 0,
       sinGuarda.length + ' sin guarda: ' + sinGuarda.slice(0, 6).join(' | '));
}

// ═══════════ PARTE 3 · comportamiento, en el servidor ═══════════
console.log('\n── PARTE 3 · los casos que motivaron la parte 2 ──');

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
            res => { const cs = []; res.on('data', c => cs.push(c));
                     res.on('end', () => resolve(Buffer.concat(cs).toString('utf8'))); });
        req.on('error', reject); req.write(body); req.end();
    });
}
const mocks = (uid, data) => [
    { function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: data !== null } },
    { function: 'get', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data: data || {} } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
    { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
];

const CLUB = 'clubA';
const iso = () => new Date().toISOString();

// El admin de club SIN el claim propagado: token con email pero sin `role` ni
// `clubId`. Es el caso real —token viejo, claims recien asignados— y el que
// hacia lanzar las tres condiciones sin guarda.
const adminSinClaims = { uid: 'admin_uid', token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } };
const adminConClaims = { uid: 'admin_uid', token: { email: 'a@club.es', role: 'club_admin', clubId: CLUB, firebase: { sign_in_provider: 'password' } } };
const docAdmin = { clubId: CLUB, isAuthorized: true, role: 'club_admin' };

function casos() {
    return [
        { n: '3a · sucesion: el club_admin CON claim la crea',
          col: 'succession_requests', exp: 'ALLOW', auth: adminConClaims, doc: docAdmin,
          method: 'create', entrante: { outgoingAdminUid: 'admin_uid' } },

        { n: '3b · [SIN GUARDA] sin el claim `role`, se deniega por logica y sin averia',
          col: 'succession_requests', exp: 'DENY', auth: adminSinClaims, doc: docAdmin,
          method: 'create', entrante: { outgoingAdminUid: 'admin_uid' },
          why: 'antes tambien denegaba, pero LANZANDO: el sintoma era indistinguible de un permiso mal puesto' },

        { n: '3c · facturacion: el admin CON claim ve la de su club',
          col: 'billing_invoices', exp: 'ALLOW', auth: adminConClaims, doc: docAdmin,
          method: 'get', existing: { entityId: CLUB, total: 10 } },

        { n: '3d · [SIN GUARDA] sin el claim `clubId` no la ve — pero sin averia',
          col: 'billing_invoices', exp: 'DENY', auth: adminSinClaims, doc: docAdmin,
          method: 'get', existing: { entityId: CLUB, total: 10 },
          why: 'el claim ausente era la UNICA via: la otra rama compara con el uid, no con el club' },

        { n: '3e · una factura propia (entityId == uid) se ve sin ningun claim',
          col: 'billing_invoices', exp: 'ALLOW', auth: adminSinClaims, doc: docAdmin,
          method: 'get', existing: { entityId: 'admin_uid', total: 10 } },

        // Y una muestra de que el barrido no rompio lo de siempre.
        { n: '3f · live_matches: el creador sigue pudiendo actualizar su partido',
          col: 'live_matches', exp: 'ALLOW', auth: adminSinClaims, doc: docAdmin,
          method: 'update',
          existing: { clubId: CLUB, createdBy: 'admin_uid', status: 'active', events: [] },
          entrante: { clubId: CLUB, createdBy: 'admin_uid', status: 'active', events: ['x'] } },

        { n: '3g · y un documento SIN clubId no revienta la evaluacion',
          col: 'live_matches', exp: 'ALLOW', auth: adminSinClaims, doc: docAdmin,
          method: 'update',
          existing: { createdBy: 'admin_uid', status: 'active', events: [] },
          entrante: { createdBy: 'admin_uid', status: 'active', events: ['x'] } },
    ];
}

(async () => {
    let refresh = null;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        refresh = cfg.tokens && cfg.tokens.refresh_token;
    } catch (e) { /* sin sesion */ }

    if (!refresh) {
        console.log('SKIP · sin sesion del CLI (firebase login): no se evalua el comportamiento.');
    } else {
        try {
            const token = await getAccessToken(refresh);
            const cs = casos();
            const testCases = cs.map(c => ({
                expectation: c.exp,
                request: {
                    auth: c.auth,
                    path: `${DB}/${c.col}/D1`,
                    method: c.method,
                    time: iso(),
                    resource: c.entrante ? { data: c.entrante } : undefined,
                },
                resource: c.existing ? { data: c.existing } : undefined,
                functionMocks: mocks(c.auth.uid, c.doc),
                pathEncoding: 'PLAIN',
            }));
            const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
                token, { source: { files: [{ name: 'firestore.rules', content: RULES }] },
                         testSuite: { testCases } });
            const j = JSON.parse(r);
            const res = j.testResults || [];
            if (!res.length) {
                ok('3· la API respondio con resultados', false, r.slice(0, 400));
            } else {
                cs.forEach((c, i) => {
                    const t = res[i] || {};
                    // errorPosition = la regla se AVERIO. En un DENY, averiada y
                    // estricta son indistinguibles si no se mira esto.
                    const rota = !!t.errorPosition;
                    ok(c.n, t.state === 'SUCCESS' && !rota,
                       rota ? ('LA REGLA LANZA: ' + JSON.stringify(t.debugMessages || t.errorPosition).slice(0, 200))
                            : (c.why ? c.why + ' | estado=' + t.state : 'estado=' + t.state));
                });
            }
        } catch (e) {
            ok('3· el comportamiento se pudo evaluar', false, e.message);
        }
    }

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();

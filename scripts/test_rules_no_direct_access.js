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

    // ⚠️⚠️ UNA EXCEPCION, Y SOLO UNA: el `allow list` de `clubs` (SEC-L04).
    //
    //  El motivo de esta asercion es que un acceso directo AVERIA la regla si
    //  el campo falta, y una regla averiada se lee como un permiso mal puesto.
    //  Pero el `list` acotado NO PUEDE usar `.data.get()`: el motor solo
    //  reconoce la comparacion como restriccion de la consulta en su forma
    //  directa, y con `.get()` dejaria de autorizar los `where` — volviendo al
    //  volcado de toda la coleccion, que es lo que SEC-L04 cierra.
    //
    //  🔑 La excepcion es segura porque se MIDIO: `adminEmail` y `adminUid`
    //  estan en los 5 documentos de `clubs` en produccion. Por eso la lista
    //  enumera los DOS campos concretos y no exime al bloque entero: cualquier
    //  OTRO campo directo, aqui o en otra regla, sigue poniendo esto rojo.
    const EXCEPCIONES = ['resource.data.adminEmail', 'resource.data.adminUid'];
    const dResReal = dRes.filter(x => !EXCEPCIONES.includes(x));

    ok('1a · ningun acceso directo a resource.data.CAMPO (salvo el list de clubs)',
       dResReal.length === 0,
       dResReal.length + ' encontrados: ' + [...new Set(dResReal)].slice(0, 8).join(', '));

    ok('1a2 · ⚠️ y las dos excepciones siguen siendo SOLO del `allow list` de clubs',
       (CODE.match(/resource\.data\.adminEmail/g) || []).length === 1 &&
       (CODE.match(/resource\.data\.adminUid/g) || []).length === 1,
       'si aparecen mas veces, alguien las ha usado fuera del list y puede averiar su regla');
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
// `saEmails` permite simular la lista de correos de SuperAdmin. Por defecto va
// VACIA (y `exists` en false), que es como estaba: asi ninguna asercion aprueba
// por la puerta del correo sin pedirlo. La PARTE 5 la usa para comprobar la
// resistencia de `isSuperAdmin()` con un token SIN el claim `role`.
const mocks = (uid, data, saEmails) => [
    { function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: data !== null } },
    { function: 'get', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data: data || {} } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: !!(saEmails && saEmails.length) } },
    { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: saEmails || [] } } } },
];

const CLUB = 'clubA';
const iso = () => new Date().toISOString();

// El admin de club SIN el claim propagado: token con email pero sin `role` ni
// `clubId`. Es el caso real —token viejo, claims recien asignados— y el que
// hacia lanzar las tres condiciones sin guarda.
const adminSinClaims = { uid: 'admin_uid', token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } };
const adminConClaims = { uid: 'admin_uid', token: { email: 'a@club.es', role: 'club_admin', clubId: CLUB, firebase: { sign_in_provider: 'password' } } };
const docAdmin = { clubId: CLUB, isAuthorized: true, role: 'club_admin' };

// SuperAdmin por las DOS vias de isSuperAdmin(): por claim y por correo. La
// segunda es la que sostiene al SA cuyo token todavia no trae el claim.
const sa = { uid: 'sa_uid', token: { email: 'sa@chronos.es', role: 'superadmin', firebase: { sign_in_provider: 'password' } } };
const saSinClaim = { uid: 'sa_uid', token: { email: 'sa@chronos.es', firebase: { sign_in_provider: 'password' } } };

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

        // ══════════════════════════════════════════════════════════════
        //  PARTE 4 · SEC-L01 (Paso 2, 2026-08-31) · `config` CERRADA
        //
        //  Tenia `read: if isAuth()`. `isAuth()` no mira `resource`, asi que
        //  no constrinye la consulta: cualquier cuenta se llevaba la
        //  coleccion entera con un `getDocs`. Se cerro del todo tras medir
        //  que esta MUERTA (0 referencias en el codigo, 0 documentos en
        //  produccion).
        //
        //  ⚠️ 4c NO ES DECORACION. `config` y `cronos_config` son vecinas y
        //  se parecen; `cronos_config/push` lo lee el aviso del SuperAdmin
        //  con cualquier sesion. Si el cierre se hubiera escrito sobre la
        //  coleccion equivocada, 4a/4b pasarian igual y el fallo saldria en
        //  4c — que es justo para lo que esta.
        // ══════════════════════════════════════════════════════════════
        { n: '4a · 🔒 `config`: un autenticado ya NO puede leerla',
          col: 'config', exp: 'DENY', auth: adminConClaims, doc: docAdmin,
          method: 'get', existing: { cualquiera: 1 },
          why: 'antes `read: if isAuth()` permitia volcar la coleccion entera' },

        { n: '4b · …ni escribir en ella',
          col: 'config', exp: 'DENY', auth: adminConClaims, doc: docAdmin,
          method: 'create', entrante: { cualquiera: 1 },
          why: 'esta muerta: 0 documentos en produccion y 0 lectores en el codigo' },

        // ⚠️ TESTIGO CAMBIADO (SEC-L03, el mismo dia). 4c usaba
        // `cronos_config/push`, que entonces leia cualquier sesion. SEC-L03 lo
        // restringio al SuperAdmin y esta asercion se puso roja: correcta al
        // escribirla, invalidada por MI PROPIO cambio una hora despues.
        // 🔑 Su PROPOSITO no cambia —comprobar que no se cerro la coleccion
        // VECINA por equivocacion al cerrar `config`—, solo el testigo: ahora
        // es `access`, que es el que tiene que seguir abierto a cualquier
        // sesion. Se REESCRIBE, no se borra.
        { n: '4c · ⚠️ y la VECINA `cronos_config/access` se sigue leyendo',
          col: 'cronos_config', docId: 'access', exp: 'ALLOW', auth: adminConClaims,
          doc: docAdmin, method: 'get', existing: { code: '1234' },
          why: 'lo lee app-init.js en el arranque: cerrar la vecina dejaria a todos fuera' },

        // ══════════════════════════════════════════════════════════════
        //  PARTE 5 · SEC-L02 · `billing_plans` solo para el SuperAdmin
        //
        //  Tenia `read: if isAuth()`: cualquier cuenta se llevaba el catalogo
        //  comercial entero con un `getDocs`. Se ESTRECHA al SA en vez de
        //  cerrarse —a diferencia de `config`— porque el panel de
        //  Facturacion la lee en cuatro sitios.
        //
        //  ⚠️ 5c ES LA IMPORTANTE. El SA con el TOKEN VIEJO (sin el claim
        //  `role`) es un caso REAL en este proyecto, y es el que motivo toda
        //  la PARTE 3. Si `billing_plans` dependiera solo del claim, ese SA
        //  se quedaria fuera de su propio panel — y en SILENCIO, porque las
        //  cuatro lecturas llevan `.catch(() => null)` y caen a los planes
        //  por defecto. Aqui pasa por el CORREO, que resuelve la regla.
        // ══════════════════════════════════════════════════════════════
        { n: '5a · el SuperAdmin sigue leyendo los planes',
          col: 'billing_plans', exp: 'ALLOW', auth: sa, doc: null,
          method: 'get', existing: { code: 'pro', precio: 10 } },

        { n: '5b · 🔒 un club_admin cualquiera ya NO puede volcarlos',
          col: 'billing_plans', exp: 'DENY', auth: adminConClaims, doc: docAdmin,
          method: 'get', existing: { code: 'pro', precio: 10 },
          why: 'antes `read: if isAuth()` se lo daba a cualquier cuenta registrada' },

        { n: '5c · ⚠️ y el SA con el TOKEN VIEJO entra por el correo',
          col: 'billing_plans', exp: 'ALLOW', auth: saSinClaim, doc: null,
          saEmails: ['sa@chronos.es'],
          method: 'get', existing: { code: 'pro', precio: 10 },
          why: 'sin esta via, un claim sin propagar dejaria al SA fuera de su panel y en silencio' },

        // ══════════════════════════════════════════════════════════════
        //  PARTE 6 · SEC-L03 · `cronos_config`, de lista NEGRA a BLANCA
        //
        //  SEC-M02 cerro `superadmins` excluyendo su id. Una lista negra
        //  concede todo lo que nadie se acordo de prohibir: cada documento
        //  nuevo nacia legible por cualquier cuenta. Ahora se enumera lo que
        //  SI hace falta —`access` para todos, `push` solo para el SA— y lo
        //  demas queda denegado por omision.
        //
        //  ⚠️ 6d ES LA PRUEBA DE QUE LA LISTA BLANCA FUNCIONA. `acces` (sin
        //  la segunda `s`) EXISTE en produccion junto al `access` bueno y no
        //  lo lee nadie. Con la lista negra era legible. Es el caso exacto
        //  que motivo darle la vuelta al criterio, y por eso se fija con un
        //  documento REAL y no inventado.
        //
        //  ⚠️ 6e: `superadmins` es la raiz de confianza de
        //  isSuperAdminEmail(). Tiene que seguir cerrado por ESTE comodin,
        //  porque las reglas SE SUMAN y el bloque especifico no lo anula.
        // ══════════════════════════════════════════════════════════════
        { n: '6a · `access` lo sigue leyendo cualquier sesion (codigo de acceso)',
          col: 'cronos_config', docId: 'access', exp: 'ALLOW', auth: adminConClaims,
          doc: docAdmin, method: 'get', existing: { code: '1234' },
          why: 'lo lee app-init.js en el arranque: cerrarlo dejaria a todos fuera' },

        { n: '6b · `push` SOLO el SuperAdmin',
          col: 'cronos_config', docId: 'push', exp: 'ALLOW', auth: sa, doc: null,
          method: 'get', existing: { vapidKey: 'x' } },

        { n: '6c · 🔒 …y un club_admin ya NO lo lee',
          col: 'cronos_config', docId: 'push', exp: 'DENY', auth: adminConClaims,
          doc: docAdmin, method: 'get', existing: { vapidKey: 'x' },
          why: 'solo se lee al abrir el panel del SA (superadmin.panel.js:372)' },

        // ⚠️ `acces` YA NO EXISTE: se borro de produccion el 2026-09-01 tras
        // comprobar que nadie lo leia y que su codigo no aparecia en el
        // codigo fuente. Era el primer intento (7 de mayo, con errata en el
        // id) y al dia siguiente se creo `access` bien escrito.
        // 🔑 EL CASO SE QUEDA, y no es nostalgia: el `:test` SIMULA, asi que
        // no necesita que el documento exista. Lo que fija es que un id
        // CUALQUIERA fuera de la lista blanca se deniega — y ese id concreto
        // es el ejemplo real de por que la lista negra no valia. Borrar la
        // asercion al borrar el dato dejaria sin vigilancia la regla.
        { n: '6d · 🔑 un id fuera de la lista blanca queda denegado (p.ej. el `acces` con errata)',
          col: 'cronos_config', docId: 'acces', exp: 'DENY', auth: adminConClaims,
          doc: docAdmin, method: 'get', existing: { basura: 1 },
          why: 'con la lista NEGRA era legible por cualquier cuenta: esto es lo que arregla la blanca' },

        { n: '6e · ⚠️ `superadmins` sigue cerrado por el comodin (las reglas SE SUMAN)',
          col: 'cronos_config', docId: 'superadmins', exp: 'DENY', auth: adminConClaims,
          doc: docAdmin, method: 'get', existing: { emails: ['sa@chronos.es'] },
          why: 'es la raiz de confianza de isSuperAdminEmail(): el agujero de SEC-M02' },

        // ══════════════════════════════════════════════════════════════
        //  PARTE 7 · SEC-L04 paso 2 · `clubs`: `get` intacto, `list` acotado
        //
        //  ⚠️⚠️ LO QUE ESTA PARTE **NO** PUEDE PROBAR: que el `list` quede
        //  acotado. El metodo `:test` evalua DOCUMENTOS, no CONSULTAS, asi
        //  que no hay forma de simular aqui un `getDocs` con o sin `where`.
        //  Eso se comprueba USANDO LA APP, y por eso el cliente se desplego y
        //  se probo antes que la regla.
        //
        //  🔑 LO QUE SI PRUEBA, que es el riesgo REAL del cambio: que al
        //  partir `read` en `get` + `list` no se haya perdido el `get`. Lo
        //  usan muchas pantallas para leer SU club por id, y si se hubiera
        //  caido el sintoma seria media aplicacion vacia sin un solo error.
        // ══════════════════════════════════════════════════════════════
        { n: '7a · 🔑 `clubs`: el `get` por id sigue abierto a cualquier sesion',
          col: 'clubs', exp: 'ALLOW', auth: adminConClaims, doc: docAdmin,
          method: 'get', existing: { name: 'CD X', adminEmail: 'otro@x.es' },
          why: 'hay que conocer el id: ahi no hay cosecha, y lo lee media aplicacion' },

        { n: '7b · …tambien para un club que NO es el suyo (no se ha colado un dueño)',
          col: 'clubs', exp: 'ALLOW', auth: adminConClaims, doc: docAdmin,
          method: 'get', existing: { name: 'CD Ajeno', adminEmail: 'nadie@x.es', adminUid: 'otro' },
          why: 'restringir el `get` es OTRA decision: aqui solo se cerro el volcado' },

        { n: '7c · ⚠️ y la regla NO se averia con un club sin `adminEmail`',
          col: 'clubs', exp: 'ALLOW', auth: adminConClaims, doc: docAdmin,
          method: 'get', existing: { name: 'CD Viejo' },
          why: 'documentos legacy sin el campo: una regla que LANZA se lee como permiso mal puesto' },

        { n: '7d · el SuperAdmin sigue pudiendo crear clubes',
          col: 'clubs', exp: 'ALLOW', auth: sa, doc: null,
          method: 'create', entrante: { name: 'CD Nuevo', adminEmail: 'a@x.es' } },

        { n: '7e · 🔒 …y un club_admin cualquiera sigue sin poder crearlos',
          col: 'clubs', exp: 'DENY', auth: adminConClaims, doc: docAdmin,
          method: 'create', entrante: { name: 'CD Falso', adminEmail: 'a@x.es' },
          why: 'el reparto de verbos no puede haber aflojado el create de rebote' },
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
                    // `docId` deja fijar el id cuando la regla depende de EL
                    // (p. ej. `configId != 'superadmins'`); por defecto, D1.
                    path: `${DB}/${c.col}/${c.docId || 'D1'}`,
                    method: c.method,
                    time: iso(),
                    resource: c.entrante ? { data: c.entrante } : undefined,
                },
                resource: c.existing ? { data: c.existing } : undefined,
                functionMocks: mocks(c.auth.uid, c.doc, c.saEmails),
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

// ─────────────────────────────────────────────────────────────────────────
// test_reject_request_rules.js
//
// v474 · "Error al rechazar: Missing or insufficient permissions."
//
// EL DEFECTO (verificado contra el servidor, no deducido): el Administrador
// de Club no podia RECHAZAR ni ELIMINAR una solicitud de registro pendiente
// desde su panel. Las dos escrituras que hace `caRejectRequest()`
// (js/admin/club/panel.js) estaban prohibidas por las reglas:
//
//   1. deleteDoc(platform_requests/self_reg_<uid>)
//      -> `allow delete: if isSuperAdmin();`  ← SOLO el SuperAdmin.
//   2. updateDoc(users/<uid>, {isAuthorized:false, status:'rejected', ...})
//      -> `allow update: if isSuperAdmin() || (uid propio && !hasAny([...
//         'isAuthorized','status'...]))`  ← nadie mas que el SA podia decidir
//         sobre el documento de OTRO usuario.
//
// Consecuencia real, reportada por el autor: damasorv@gmail.com se quedaba
// "colgado" en la seccion "Solicitudes de Registro" sin forma de retirarlo.
// El mismo bloqueo afectaba a AUTORIZAR (caApproveRequest / caConfirmClubAccess
// / caSetUserStatus), porque es la MISMA regla: son la misma decision.
//
// EL ARREGLO, acotado:
//   A) platform_requests.delete lo pueden hacer, ademas del SA, los
//      administradores de ESE club/entidad — por claim (isClubAdmin /
//      isIndividualAdmin) o por clubs/{id}.adminUid|adminEmail (isClubAdminOf).
//      ⚠️ NO se usa sameClubAsDoc(): ese predicado solo mira token.clubId, que
//      tiene CUALQUIER miembro autorizado del club (un entrenador incluido).
//   B) users.update gana una rama para el administrador del club AL QUE YA
//      PERTENECE el documento, limitada con hasOnly() a los campos de la
//      decision de pertenencia. 'role', 'clubId' y 'clubName' quedan FUERA:
//      sin ellos no hay escalada de rol ni traslado de un usuario a otro club.
//
// Metodo: Firebase Rules REST API (`:test`), sin emulador ni JDK. Ver
// scripts/test_sec_c3_live_matches_rules.js y la nota de reference-rules-test-api.
// ⚠️ `errorPosition` se trata como FALLO aunque el estado sea SUCCESS: en un
// caso DENY, "la regla denego" y "la regla se averio" son indistinguibles.
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
const ok = (n, c, x) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (x !== undefined) console.log('       ' + JSON.stringify(x).slice(0, 300)); }
};

function getAccessToken(rt) {
    const body = new URLSearchParams({ refresh_token: rt,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    return new Promise((res, rej) => {
        const r = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            x => { const b = []; x.on('data', c => b.push(c)); x.on('end', () => { const d = Buffer.concat(b).toString('utf8');
                try { const j = JSON.parse(d); j.access_token ? res(j.access_token) : rej(new Error(d.slice(0, 200))); } catch (e) { rej(new Error(d.slice(0, 200))); } }); });
        r.on('error', rej); r.write(body); r.end();
    });
}
function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((res, rej) => {
        const r = https.request(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            x => { const b = []; x.on('data', c => b.push(c)); x.on('end', () => res({ status: x.statusCode, body: Buffer.concat(b).toString('utf8') })); });
        r.on('error', rej); r.write(body); r.end();
    });
}

// ── Actores ──────────────────────────────────────────────────────────────
const P = (t) => ({ ...t, firebase: { sign_in_provider: 'password' } });
const CA_A     = { uid: 'ca_a',   token: P({ email: 'admin@a.es',  role: 'club_admin', clubId: 'CLUB_A' }) };
const CA_B     = { uid: 'ca_b',   token: P({ email: 'admin@b.es',  role: 'club_admin', clubId: 'CLUB_B' }) };
const CA_A_SIN = { uid: 'ca_a',   token: P({ email: 'admin@a.es' }) };            // admin real, aun SIN claims
const COACH_A  = { uid: 'coach',  token: P({ email: 'coach@a.es',  role: 'user',       clubId: 'CLUB_A' }) };
const IND_1    = { uid: 'ia_1',   token: P({ email: 'ind1@x.es',   role: 'individual', clubId: 'IND_1' }) };
const IND_2    = { uid: 'ia_2',   token: P({ email: 'ind2@x.es',   role: 'individual', clubId: 'IND_2' }) };
const SA       = { uid: 'sa',     token: P({ email: 'sa@x.es',     role: 'superadmin' }) };
const DAMASO   = { uid: 'u1',     token: P({ email: 'damasorv@gmail.com' }) };     // el solicitante pendiente

// ── Documentos ───────────────────────────────────────────────────────────
const PR_SELF = { type: 'self_registration', clubId: 'CLUB_A', clubName: 'Club A',
                  requestedEmail: 'damasorv@gmail.com', requestedRole: 'user',
                  userUid: 'u1', status: 'pending_club_admin' };
const PR_IND  = { type: 'ind_sub_registration', individualOwnerId: 'IND_1',
                  requestedEmail: 'x@x.es', requestedRole: 'user',
                  userUid: 'u2', status: 'pending_individual' };

const U_PEND  = { email: 'damasorv@gmail.com', role: 'user', clubId: 'CLUB_A',
                  isAuthorized: false, status: 'pending_club_admin' };
const U_OTRO  = { email: 'otro@b.es', role: 'user', clubId: 'CLUB_B',
                  isAuthorized: false, status: 'pending_club_admin' };
const U_SIN   = { email: 'huerfano@x.es', role: 'user', isAuthorized: false, status: 'pending' };
const U_IND   = { email: 'sub@ind.es', role: 'user', clubId: 'IND_1',
                  isAuthorized: false, status: 'pending_individual' };

const RECHAZO  = { isAuthorized: false, status: 'rejected',
                   rejectedAt: '2026-08-08T10:00:00.000Z', rejectedBy: 'ca_a' };
const APROBADO = { isAuthorized: true, status: 'active',
                   authorizedAt: '2026-08-08T10:00:00.000Z', authorizedBy: 'admin@a.es',
                   category: 'infantil', categoryLabel: 'infantil', subcategory: 'A',
                   allRoles: [{ role: 'user', clubId: 'CLUB_A', isAuthorized: true, status: 'active' }] };

// Mocks compartidos: cronos_config/superadmins (isSuperAdminEmail) y los clubs
// (isClubAdminOf). El SA de este test lo es por CLAIM, no por email, para que
// ninguna rama dependa de la lista.
const MOCKS = [
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: ['jarg7435@gmail.com'] } } } },
    { function: 'exists', args: [{ exactValue: `${DB}/clubs/CLUB_A` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/clubs/CLUB_A` }], result: { value: { data: { name: 'Club A', adminUid: 'ca_a', adminEmail: 'admin@a.es' } } } },
    { function: 'exists', args: [{ exactValue: `${DB}/clubs/CLUB_B` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/clubs/CLUB_B` }], result: { value: { data: { name: 'Club B', adminUid: 'ca_b', adminEmail: 'admin@b.es' } } } },
    { function: 'exists', args: [{ exactValue: `${DB}/clubs/IND_1` }], result: { value: false } },
    { function: 'get',    args: [{ exactValue: `${DB}/clubs/IND_1` }], result: { value: { data: {} } } },
    { function: 'exists', args: [{ exactValue: `${DB}/clubs/IND_2` }], result: { value: false } },
    { function: 'get',    args: [{ exactValue: `${DB}/clubs/IND_2` }], result: { value: { data: {} } } },
];

const del  = (auth, id, existing) => ({ auth, path: `${DB}/platform_requests/${id}`, method: 'delete', existing });
const upd  = (auth, uid, existing, cambios) => ({ auth, path: `${DB}/users/${uid}`, method: 'update',
                                                  resource: { data: { ...existing, ...cambios } }, existing });

const CASOS = [
    // ══ A) BORRAR LA SOLICITUD (platform_requests) ══════════════════════
    { n: 'A1 · 🐛 el ADMIN DEL CLUB borra la solicitud pendiente de SU club', exp: 'ALLOW',
      req: del(CA_A, 'self_reg_u1', PR_SELF) },
    { n: 'A2 · el admin del club SIN claims todavia (es adminUid del club) tambien', exp: 'ALLOW',
      req: del(CA_A_SIN, 'self_reg_u1', PR_SELF) },
    { n: 'A3 · el SuperAdmin sigue pudiendo', exp: 'ALLOW',
      req: del(SA, 'self_reg_u1', PR_SELF) },
    { n: 'A4 · el admin de OTRO club NO puede', exp: 'DENY',
      req: del(CA_B, 'self_reg_u1', PR_SELF) },
    { n: 'A5 · ⚠️ un ENTRENADOR del mismo club NO puede (tiene el claim clubId)', exp: 'DENY',
      req: del(COACH_A, 'self_reg_u1', PR_SELF) },
    { n: 'A6 · ni el propio solicitante', exp: 'DENY',
      req: del(DAMASO, 'self_reg_u1', PR_SELF) },
    { n: 'A7 · sin autenticar, tampoco', exp: 'DENY',
      req: { auth: null, path: `${DB}/platform_requests/self_reg_u1`, method: 'delete', existing: PR_SELF } },
    { n: 'A8 · el ADMIN INDIVIDUAL borra la solicitud de SU entidad (individualOwnerId, sin clubId)', exp: 'ALLOW',
      req: del(IND_1, 'ind_reg_1', PR_IND) },
    { n: 'A9 · otro admin individual NO', exp: 'DENY',
      req: del(IND_2, 'ind_reg_1', PR_IND) },

    // ══ A') LEER LA SOLICITUD (segundo reporte, captura 8569) ═══════════
    //  ⚠️ LIMITE DE ESTE METODO: la Rules API evalua documento a documento y
    //  NO modela los filtros de una CONSULTA. Que un `get` salga ALLOW no
    //  garantiza que un `list` pase: para eso la condicion debe quedar
    //  garantizada por los filtros de la consulta, y eso se protege en el
    //  cliente (scripts/test_rechazar_solicitud_registro.js, casos H e I).
    { n: "A'1 · el admin del club LEE la solicitud de su club", exp: 'ALLOW',
      req: { auth: CA_A, path: `${DB}/platform_requests/self_reg_u1`, method: 'get', existing: PR_SELF } },
    { n: "A'2 · el admin SIN claims (adminEmail del club) tambien la lee", exp: 'ALLOW',
      req: { auth: CA_A_SIN, path: `${DB}/platform_requests/self_reg_u1`, method: 'get', existing: PR_SELF } },
    { n: "A'3 · el propio solicitante lee SU solicitud (campo 'userUid', que es el real)", exp: 'ALLOW',
      req: { auth: DAMASO, path: `${DB}/platform_requests/self_reg_u1`, method: 'get', existing: PR_SELF } },
    { n: "A'4 · un admin de otro club NO la lee", exp: 'DENY',
      req: { auth: CA_B, path: `${DB}/platform_requests/self_reg_u1`, method: 'get', existing: PR_SELF } },

    // ══ B) MARCAR EL USUARIO COMO RECHAZADO (users) ═════════════════════
    { n: 'B1 · 🐛 el ADMIN DEL CLUB marca RECHAZADA la solicitud de un usuario de SU club', exp: 'ALLOW',
      req: upd(CA_A, 'u1', U_PEND, RECHAZO) },
    { n: 'B2 · y tambien puede AUTORIZARLA (misma decision, misma regla)', exp: 'ALLOW',
      req: upd(CA_A, 'u1', U_PEND, APROBADO) },
    { n: 'B3 · y BLOQUEAR a un miembro de su club', exp: 'ALLOW',
      req: upd(CA_A, 'u1', U_PEND, { isAuthorized: false, status: 'blocked', blockedAt: '2026-08-08T10:00:00.000Z', blockedBy: 'ca_a' }) },
    { n: 'B4 · el admin SIN claims (adminUid del club) tambien rechaza', exp: 'ALLOW',
      req: upd(CA_A_SIN, 'u1', U_PEND, RECHAZO) },
    { n: 'B5 · el ADMIN INDIVIDUAL rechaza a un usuario de SU entidad', exp: 'ALLOW',
      req: upd(IND_1, 'u3', U_IND, RECHAZO) },
    { n: 'B6 · el SuperAdmin sigue pudiendo', exp: 'ALLOW',
      req: upd(SA, 'u1', U_PEND, RECHAZO) },

    // ══ C) LO QUE EL ARREGLO NO PUEDE ABRIR ═════════════════════════════
    { n: 'C1 · el admin de OTRO club NO puede rechazar', exp: 'DENY',
      req: upd(CA_B, 'u1', U_PEND, RECHAZO) },
    { n: 'C2 · ⚠️ un ENTRENADOR del mismo club NO puede rechazar', exp: 'DENY',
      req: upd(COACH_A, 'u1', U_PEND, RECHAZO) },
    { n: 'C3 · el admin NO puede cambiar el ROL de un usuario (escalada)', exp: 'DENY',
      req: upd(CA_A, 'u1', U_PEND, { role: 'superadmin', isAuthorized: true, status: 'active' }) },
    { n: 'C4 · ni MOVERLO a otro club (clubId)', exp: 'DENY',
      req: upd(CA_A, 'u1', U_PEND, { clubId: 'CLUB_B', status: 'rejected' }) },
    { n: 'C5 · ni tocar el clubName', exp: 'DENY',
      req: upd(CA_A, 'u1', U_PEND, { clubName: 'Otro', status: 'rejected' }) },
    { n: 'C6 · ni tocar a un usuario de OTRO club', exp: 'DENY',
      req: upd(CA_A, 'u9', U_OTRO, RECHAZO) },
    { n: 'C7 · ⚠️ ni a un usuario SIN clubId (documento huerfano)', exp: 'DENY',
      req: upd(CA_A, 'u9', U_SIN, RECHAZO) },
    { n: 'C8 · ni el admin individual a un usuario de un club', exp: 'DENY',
      req: upd(IND_1, 'u1', U_PEND, RECHAZO) },
    { n: 'C9 · SEC-C1 · el usuario sigue sin poder autoautorizarse', exp: 'DENY',
      req: upd(DAMASO, 'u1', U_PEND, { isAuthorized: true, status: 'active' }) },
    { n: 'C10 · el usuario sigue editando campos NO sensibles de su doc', exp: 'ALLOW',
      req: upd(DAMASO, 'u1', U_PEND, { displayName: 'Damaso' }) },
];

(async () => {
    console.log('── v474 · permisos para rechazar/eliminar una solicitud de registro ──\n');
    let token;
    try {
        token = await getAccessToken(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token);
    } catch (e) {
        console.log('SKIP · sin sesion del CLI de Firebase (`firebase login`).');
        process.exit(0);
    }
    ok('0a · sesion del CLI valida', !!token);

    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, token, {
        source: { files: [{ name: 'firestore.rules', content: rules }] },
        testSuite: { testCases: CASOS.map(c => {
            const { existing, ...request } = c.req;
            const tc = { expectation: c.exp, request, functionMocks: MOCKS, pathEncoding: 'PLAIN' };
            if (existing) tc.resource = { data: existing };
            return tc;
        }) },
    });
    if (r.status !== 200) { ok('0b · la Rules API responde 200', false, { status: r.status, body: r.body.slice(0, 500) }); process.exit(1); }
    ok('0b · la Rules API responde 200', true);

    const res = JSON.parse(r.body);
    (res.testResults || []).forEach((t, i) => {
        // errorPosition = la evaluacion LANZO. En un caso DENY eso sale como
        // SUCCESS por el motivo equivocado, asi que cuenta como fallo.
        const averiada = !!t.errorPosition;
        ok(CASOS[i].n + '  [espera ' + CASOS[i].exp + ']', t.state === 'SUCCESS' && !averiada,
           averiada ? { evaluacion_averiada: t.errorPosition }
                    : 'la regla NO se comporto como se esperaba');
    });
    ok('Z1 · se evaluaron los ' + CASOS.length + ' casos', (res.testResults || []).length === CASOS.length);

    // Anclas de texto: si alguien revierte el arreglo, esto se pone rojo.
    ok('Z2 · platform_requests.delete ya no es exclusivo del SuperAdmin',
       /match \/platform_requests[\s\S]*?allow delete: if isSuperAdmin\(\) \|\|/.test(rules));
    ok('Z3 · users.update tiene la rama del administrador del club',
       /match \/users\/\{userId\}[\s\S]*?allow update: if isSuperAdmin\(\)[\s\S]{0,900}?isAdminOfClub\(resource\.data\.get\('clubId', null\)\) && isMembershipDecision\(\)/.test(rules));
    // ⚠️ El cuerpo se acota al `hasOnly([...])` de ESTA funcion. Un
    // `[\s\S]{0,700}` desde la cabecera se sale de la funcion y alcanza el
    // `'clubId'` del helper siguiente: daba rojo con el arreglo correcto puesto.
    const cuerpo = (rules.match(/function isMembershipDecision\(\)[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/) || [])[1];
    ok('Z4 · isMembershipDecision() existe y usa hasOnly()', !!cuerpo);
    ok("Z4b · esa rama NO deja escribir 'role', 'clubId' ni 'clubName'",
       !!cuerpo && !/'role'/.test(cuerpo) && !/'clubId'/.test(cuerpo) && !/'clubName'/.test(cuerpo), cuerpo);
    ok("Z4c · pero si los campos de la decision (isAuthorized/status/rejectedAt)",
       !!cuerpo && /'isAuthorized'/.test(cuerpo) && /'status'/.test(cuerpo) && /'rejectedAt'/.test(cuerpo));

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

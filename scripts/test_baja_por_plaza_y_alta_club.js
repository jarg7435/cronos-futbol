// ════════════════════════════════════════════════════════════════════════
//  test_baja_por_plaza_y_alta_club.js
//  🔴 DOS FALLOS REPORTADOS EL 2026-08-23 (implementar.txt)
// ════════════════════════════════════════════════════════════════════════
//
//  ── FALLO 1 · "LA BAJA SE LLEVÓ TODOS SUS ROLES" ────────────────────
//  «Al eliminar el correo damasorv@gmail.com de un club (CD Día), el sistema
//  ha borrado de golpe todos sus roles (incluyendo el de coordinador de
//  fútbol 11 que debía mantenerse)».
//
//  🔑 LA MAQUINARIA YA EXISTÍA Y FALLABA UNA LLAMADA. La lista del Panel de
//  Club se expande a UNA FILA POR PLAZA (`_activeRoleData`, v560) y
//  `caSetUserStatus` acepta desde v581 `targetRole` y `plaza` para acotar la
//  baja — el botón "Cambiar equipo" de la MISMA fila ya los pasaba. El botón
//  "🗑️ Baja" llamaba sin ninguno de los dos, y sin `targetRole` el filtro
//  `rolesRemovidos` se lleva TODAS las entradas de allRoles de ese club.
//
//  ── FALLO 2 · "MISSING OR INSUFFICIENT PERMISSIONS" AL CREAR UN CLUB ─
//  «Al intentar registrar un nuevo club (ESTRELLA CF) con el correo
//  damasorv@gmail.com … la app arroja Error: Missing or insufficient
//  permissions».
//
//  🔑 CAUSA MEDIDA CONTRA EL SERVIDOR DE REGLAS DE GOOGLE, no deducida
//  (Rules REST API, método :test — ver el guard SEC-C1 para el patrón):
//
//    1. La rama `primaryData.status === 'removed'` de auth.js borraba el
//       documento para RECREARLO, porque el `allow create` de users/{userId}
//       admite role/clubId/status y el `allow update` los PROHÍBE (SEC-C1).
//    2. Pero `allow delete: if isSuperAdmin()`: **el usuario no puede borrar
//       su propio documento**. Y el borrado iba en un `try {} catch(_) {}`,
//       así que fallaba EN SILENCIO.
//    3. El `setDoc` siguiente pasaba a ser un UPDATE con role/clubId/
//       clubName/isAuthorized/status → DENEGADO, y con él se perdía también
//       el rol nuevo: el alta no fallaba "un poco", fallaba entera.
//
//  ⚠️ EL ARREGLO NO ES RELAJAR LA REGLA. Esa lista de campos prohibidos es
//  el cierre de SEC-C1 (un usuario podía darse `isAuthorized:true` y leer y
//  escribir los partidos en vivo de otro club, con PII de menores). Se
//  escribe sólo lo que el dueño puede escribir, y la raíz la pone al día el
//  SuperAdmin al aprobar, que es de quien es ese trabajo.
//
//  ── FALLO 2b · EL CLUB SE HABRÍA LLAMADO "SOLICITUD DIRECTA" ────────
//  Descubierto al arreglar el 2: la solicitud que el alta manda al
//  SuperAdmin desde un correo YA EXISTENTE no llevaba `requestedClubName`
//  ni `requestedQuotas` (la de una cuenta nueva sí). `saExtApprove` crea el
//  club con `r.requestedClubName || clubName`, y la tarjeta cae en
//  'Solicitud Directa'. Aprobarla habría creado un club con ese nombre.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs    = require('fs');
const https = require('https');
const os    = require('os');
const path  = require('path');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle).slice(0, 300) : '')); }
}
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PANEL = leer('js/admin/club/panel.js');
const AUTH  = leer('js/services/auth.js');
const RULES = leer('firestore.rules');
const EXTRAS = leer('js/admin/superadmin/extras.js');

console.log('\n🔴 BAJA POR PLAZA · ALTA DE CLUB CON CORREO EXISTENTE\n');

// ════════════════════════════════════════════════════════════════════
console.log('1 · LA BAJA ES DE UNA PLAZA, NO DE LA PERSONA');
// ════════════════════════════════════════════════════════════════════
// El botón "🗑️ Baja" de la fila tiene que decir DE QUÉ plaza habla.
const _btnBaja = /🗑️ Baja<\/button>/.test(PANEL) &&
    /caSetUserStatus\('\$\{euid\}','\$\{email\}','removed','\$\{ecid\}','\$\{_rol\}',false,\{category:'\$\{_rcat\}',subcategory:'\$\{_rsub\}'\}\)/.test(PANEL);
ok('1a · el botón de Baja pasa el rol Y la plaza de su fila', _btnBaja);

// 🔑 Y esos datos salen de la FILA (_activeRoleData), no de la raíz del
// documento: la raíz describe UNA sola plaza y en este panel hay una fila por
// plaza. Leerla de la raíz volvería a apuntar a la casilla equivocada (v560).
ok('1b · el rol y la plaza salen de _activeRoleData, no de la raíz',
   /const _rd\s*=\s*u\._activeRoleData \|\| \{\};/.test(PANEL) &&
   /const _rol\s*=\s*_escA\(_rd\.role/.test(PANEL));

// La maquinaria que ya existía y que este arreglo por fin usa.
ok('1c · caSetUserStatus sigue aceptando targetRole y plaza',
   /caSetUserStatus\s*=\s*async\s*\(userId, userEmail, newStatus, cid, targetRole, sinConfirmar, plaza\)/.test(PANEL));
// ⚠️ Si esto desaparece, la baja vuelve a llevarse todos los roles del club.
ok('1d · sin targetRole el filtro NO descarta nada (por eso hay que pasarlo)',
   /if \(targetRole && r\.role !== targetRole\) return false;/.test(PANEL));
ok('1e · y la plaza acota además por categoría+subcategoría',
   /if \(!_esEstaPlaza\(r\)\) return false;/.test(PANEL));

// 🔴 Los roles que NO son de esta plaza tienen que sobrevivir.
ok('1f · rolesRestantes conserva lo que no casa',
   /var rolesRestantes = allRoles\.filter\(function\(r\) \{[\s\S]{0,320}?if \(targetRole && r\.role !== targetRole\) return true;/.test(PANEL));
// Y la cuenta sólo se cierra si no queda NINGUNO vivo.
ok('1g · la cuenta sólo cae si no queda ningún rol vivo',
   /var revocaTodosLosRoles = rolesRestantesVivos\.length === 0;/.test(PANEL));

// ⚠️ EL AVISO TIENE QUE DECIR QUÉ SE QUITA Y QUÉ SE CONSERVA. El susto del
// autor empieza aquí: un confirm que no distingue una plaza de todas.
ok('1h · el aviso nombra la casilla y promete que lo demás queda intacto',
   /Dar de baja la casilla de/.test(PANEL) && /CUALQUIER OTRO rol o equipo suyo/.test(PANEL));
ok('1i · y traduce el rol a nombre humano, no "user"',
   /_rl = \{ user:'Entrenador'/.test(PANEL));

// ════════════════════════════════════════════════════════════════════
console.log('\n2 · EL ALTA NO INTENTA LO QUE LAS REGLAS PROHÍBEN');
// ════════════════════════════════════════════════════════════════════
// La rama del re-registro, acotada para no mirar todo el fichero.
// ⚠️ La ventana llega hasta el `_permitido` Y su `merge`. Con 9000 se quedaba
// 200 caracteres corta y tres aserciones salían rojas sin que nada estuviera
// mal: un guard que recorta el trozo que va a mirar tiene que medirlo.
const _ini = AUTH.indexOf("if (primaryData.status === 'removed')");
const RAMA = _ini >= 0 ? AUTH.slice(_ini, _ini + 12000) : '';
ok('2a · la rama del re-registro existe', RAMA.length > 100);

// 🔴 El borrado imposible: `allow delete: if isSuperAdmin()`.
ok('2b · ya NO se intenta borrar el documento del usuario',
   !/deleteDoc\(\s*_mdel\.doc\(fa\.db, 'users'/.test(RAMA) &&
   !/deleteDoc\([^)]*'users'[^)]*cred\.user\.uid/.test(RAMA));
ok('2c · …y la regla que lo impide sigue en su sitio',
   /match \/users\/\{userId\}[\s\S]*?allow delete: if isSuperAdmin\(\);/.test(RULES));

// 🔴 Lo que se escribe no puede tocar los campos de raíz.
const _permIni = RAMA.indexOf('const _permitido = {');
const PERM = _permIni >= 0 ? RAMA.slice(_permIni, RAMA.indexOf('{ merge: true }', _permIni) + 20) : '';
ok('2d · el escrito va acotado a un objeto _permitido', PERM.length > 50);
['role', 'clubId', 'clubName', 'isAuthorized', 'status', 'authorizedAt', 'authorizedBy', 'blockedAt'].forEach(campo => {
    ok('2e · _permitido NO escribe "' + campo + '"',
       !new RegExp('(^|[\\s{,])' + campo + '\\s*:', 'm').test(PERM), PERM.slice(0, 200));
});
ok('2f · sí escribe allRoles (que es a lo que viene el alta)', /allRoles:\s*freshAllRoles/.test(PERM));
ok('2g · y se guarda con merge:true (no reemplaza el documento)', /\{ merge: true \}/.test(PERM));
// ⚠️ La lista prohibida de la regla es el cierre de SEC-C1: no se relaja.
ok('2h · la regla sigue prohibiendo esos campos al propio usuario',
   /hasAny\(\['role', 'isAuthorized', 'status', 'clubId', 'clubName', 'authorizedAt', 'authorizedBy', 'blockedAt'\]\)/.test(RULES));

// 🔑 v551 sigue vigente: los roles vivos se conservan y el nuevo se AÑADE.
ok('2i · los roles vivos previos se conservan (v551)',
   /_sobreviven = _rolesPrevios\.filter/.test(RAMA) && /freshAllRoles = _yaEsta \? _sobreviven\.slice\(\) : _sobreviven\.concat/.test(RAMA));

// ════════════════════════════════════════════════════════════════════
console.log('\n3 · LA SOLICITUD LLEGA AL SUPERADMIN Y LLEVA EL NOMBRE DEL CLUB');
// ════════════════════════════════════════════════════════════════════
// Desde que la raíz no se toca, ESTA solicitud es el único rastro del alta.
ok('3a · saExtApprove crea el club con requestedClubName',
   /var targetClubName = r\.requestedClubName \|\| clubName;/.test(EXTRAS));
// ⚠️ Si falta, la tarjeta cae en 'Solicitud Directa' y ése sería el NOMBRE del club.
ok('3b · sin él, la tarjeta dice "Solicitud Directa"',
   /r\.requestedClubName \|\| r\.clubName \|\| 'Solicitud Directa'/.test(EXTRAS));

// Se localizan por su apertura y se toma una ventana fija: buscar el `};` de
// cierre con un no-goloso se atasca en las llaves internas de requestedQuotas.
const _saReqs = ['const _saReqData = {', 'const _saReqData2 = {']
    .map(k => { const i = AUTH.indexOf(k); return i < 0 ? '' : AUTH.slice(i, i + 900); })
    .filter(Boolean);
ok('3c · hay dos solicitudes de alta desde cuenta existente', _saReqs.length === 2, _saReqs.length);
_saReqs.forEach((b, i) => {
    ok('3d · la solicitud #' + (i + 1) + ' lleva requestedClubName', /requestedClubName:/.test(b));
    ok('3e · la solicitud #' + (i + 1) + ' lleva requestedQuotas', /requestedQuotas:/.test(b));
});
// El panel del SA antepone platform_requests al documento de usuario.
ok('3f · el panel del SA lee las solicitudes con status pending_sa',
   /collection\(db,'platform_requests'\),where\('status','==','pending_sa'\)/.test(leer('js/admin/superadmin/requests-tab.js')));

// 🔴 Y su fallo ya no se traga: sin ella no hay alta, y hay que decirlo.
ok('3g · un fallo al crear la solicitud se le dice al usuario',
   /No se ha podido registrar la solicitud/.test(AUTH));
ok('3h · …y no se deja la sesión abierta a medias',
   /catch \(_ePr\)[\s\S]{0,400}?signOut\(fa\.auth\)/.test(AUTH));

// ════════════════════════════════════════════════════════════════════
//  4 · CONTRA EL SERVIDOR DE REGLAS DE GOOGLE (se ejecuta de verdad)
// ════════════════════════════════════════════════════════════════════
//  Un caso DENY no distingue "la regla denegó" de "la regla se averió", así
//  que `errorPosition` cuenta como fallo. Y `request.time` va explícito: sin
//  él cualquier expresión temporal LANZA y todos los DENY salen verdes por el
//  motivo equivocado (trampa pagada en v434).
const PROJECT = 'cronos-futbol-app';
const CONFIG  = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB      = '/databases/(default)/documents';

function getAccessToken(rt) {
    const body = new URLSearchParams({ refresh_token: rt,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    return new Promise((res, rej) => {
        const r = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            x => { const b = []; x.on('data', c => b.push(c)); x.on('end', () => { const d = Buffer.concat(b).toString('utf8'); try { const j = JSON.parse(d); j.access_token ? res(j.access_token) : rej(new Error(d.slice(0, 200))); } catch (e) { rej(new Error(d.slice(0, 200))); } }); });
        r.on('error', rej); r.write(body); r.end();
    });
}
function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((res, rej) => {
        const r = https.request(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            // Buffers, no `d += chunk`: partir un multibyte entre dos trozos lo corrompe.
            x => { const b = []; x.on('data', c => b.push(c)); x.on('end', () => res({ status: x.statusCode, body: Buffer.concat(b).toString('utf8') })); });
        r.on('error', rej); r.write(body); r.end();
    });
}

const UID  = 'damaso_uid';
const auth = { uid: UID, token: { email: 'damasorv@gmail.com', firebase: { sign_in_provider: 'password' } } };
const docRemovido = {
    email: 'damasorv@gmail.com', role: 'user', clubId: 'cd_dia', clubName: 'CD Dia',
    isAuthorized: false, status: 'removed',
    allRoles: [{ role: 'coordinator', clubId: 'cd_dia', isAuthorized: true, status: 'active' }],
};
const mocks = (data) => [
    { function: 'exists', args: [{ exactValue: `${DB}/users/${UID}` }], result: { value: data !== null } },
    { function: 'get',    args: [{ exactValue: `${DB}/users/${UID}` }], result: { value: { data: data || {} } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
    { function: 'get',    args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
];

const CASOS = [
    { n: '4a · el usuario NO puede borrar su propio doc (por eso el plan viejo no podía funcionar)', exp: 'DENY',
      req: { auth, path: `${DB}/users/${UID}`, method: 'delete' },
      mocks: mocks(docRemovido), existing: docRemovido },
    { n: '4b · el escrito VIEJO (role/clubId/status) se DENIEGA', exp: 'DENY',
      req: { auth, path: `${DB}/users/${UID}`, method: 'update',
             resource: { data: { ...docRemovido, role: 'club_admin', clubId: null, clubName: null, status: 'pending_sa' } } },
      mocks: mocks(docRemovido), existing: docRemovido },
    { n: '4c · 🔑 el escrito NUEVO (sólo allRoles y campos no sensibles) SÍ PASA', exp: 'ALLOW',
      req: { auth, path: `${DB}/users/${UID}`, method: 'update',
             resource: { data: { ...docRemovido,
                 allRoles: [{ role: 'coordinator', clubId: 'cd_dia', isAuthorized: true, status: 'active' },
                            { role: 'club_admin', clubId: null, isAuthorized: false, status: 'pending_sa' }],
                 requestedClubName: 'ESTRELLA CF',
                 requestedQuotas: { directors: 1, coordinators: 2, coaches: 10, parents: 50 } } } },
      mocks: mocks(docRemovido), existing: docRemovido },
    { n: '4d · y la solicitud al SuperAdmin se puede crear', exp: 'ALLOW',
      req: { auth, path: `${DB}/platform_requests/self_reg_${UID}_club_admin`, method: 'create',
             resource: { data: { type: 'self_registration', requestedEmail: 'damasorv@gmail.com',
                 requestedRole: 'club_admin', requestedClubName: 'ESTRELLA CF', userUid: UID, status: 'pending_sa' } } },
      mocks: mocks(docRemovido) },
    // ⚠️ Y LA PUERTA DE SEC-C1 SIGUE CERRADA: el arreglo no la abre por detrás.
    { n: '4e · ⛔ sigue sin poder darse isAuthorized:true', exp: 'DENY',
      req: { auth, path: `${DB}/users/${UID}`, method: 'update',
             resource: { data: { ...docRemovido, isAuthorized: true, status: 'active' } } },
      mocks: mocks(docRemovido), existing: docRemovido },
    { n: '4f · ⛔ ni fijarse un clubId ajeno', exp: 'DENY',
      req: { auth, path: `${DB}/users/${UID}`, method: 'update',
             resource: { data: { ...docRemovido, clubId: 'club_de_otro' } } },
      mocks: mocks(docRemovido), existing: docRemovido },
];

(async () => {
    console.log('\n4 · REGLAS REALES (Rules REST API)');
    let rt;
    try { rt = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token; }
    catch (e) {
        // Se SALTA con aviso, como los otros guards de reglas: sin sesión del
        // CLI no hay forma de preguntarle al servidor, y romper la suite por
        // eso escondería los fallos de verdad.
        console.log('  ⚠️ SALTADO: no hay sesión del CLI de Firebase (firebase login).');
        console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ TODO OK') + ' · ' + total + ' aserciones (parte 4 saltada)\n');
        process.exit(fallos ? 1 : 0);
    }
    try {
        const token = await getAccessToken(rt);
        const testCases = CASOS.map(c => ({
            expectation: c.exp,
            request: { ...c.req, time: new Date().toISOString() },
            resource: c.existing ? { data: c.existing } : undefined,
            functionMocks: c.mocks,
            pathEncoding: 'PLAIN',
        }));
        const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, token, {
            source: { files: [{ name: 'firestore.rules', content: RULES }] },
            testSuite: { testCases },
        });
        if (r.status !== 200) { ok('4 · la API de reglas responde', false, r.body.slice(0, 300)); }
        else {
            const res = JSON.parse(r.body).testResults || [];
            res.forEach((t, i) => {
                const err = t.errorPosition ? ' [LA REGLA SE AVERIÓ: ' + JSON.stringify(t.errorPosition) + ']' : '';
                ok(CASOS[i].n + ' (esperado ' + CASOS[i].exp + ')',
                   t.state === 'SUCCESS' && !t.errorPosition, (t.state || '') + err);
            });
        }
    } catch (e) {
        ok('4 · la parte de reglas se pudo ejecutar', false, e && e.message);
    }
    console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ TODO OK') + ' · ' + total + ' aserciones\n');
    process.exit(fallos ? 1 : 0);
})();

// test_fix_baja_403_y_purga.js
// Test unitario para verificar la corrección del error 403 en baja de roles
// y la purga completa de documentos del usuario al eliminar la cuenta.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let testCount = 0;
let passCount = 0;
let failCount = 0;

function ok(name, cond, details = '') {
    testCount++;
    if (cond) {
        passCount++;
        console.log(`  PASS  ${name}`);
    } else {
        failCount++;
        console.error(`  FAIL  ${name}${details ? ` -> ${details}` : ''}`);
    }
}

console.log('=== TEST: Corrección HTTP 403 en Baja de Roles y Purga Completa de Usuario ===\n');

// 1. Verificar firestore.rules
const rulesPath = path.join(__dirname, '../firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');

ok('1a · firestore.rules contiene la función isClubDirectorOf', rulesContent.includes('function isClubDirectorOf('));
ok('1b · firestore.rules contiene la función isClubCoordinatorOf', rulesContent.includes('function isClubCoordinatorOf('));

const isAdminOfClubBlock = (rulesContent.match(/function isAdminOfClub\(clubId\)[\s\S]*?\}/) || [])[0] || '';
ok('1c · isAdminOfClub incluye isClubDirectorOf(clubId)', isAdminOfClubBlock.includes('isClubDirectorOf(clubId)'));
ok('1d · isAdminOfClub incluye isClubCoordinatorOf(clubId)', isAdminOfClubBlock.includes('isClubCoordinatorOf(clubId)'));


// 2. Verificar functions/index.js
const fnPath = path.join(__dirname, '../functions/index.js');
const fnContent = fs.readFileSync(fnPath, 'utf8');

ok('2a · functions/index.js contiene _callerHasClubPermission', fnContent.includes('function _callerHasClubPermission('));

// Ejecutar _callerHasClubPermission en sandbox VM
const sandbox = { exports: {} };
vm.createContext(sandbox);
// ⚠️ SEC-C1c (2026-08-26): _callerHasClubPermission ya no decide sola sobre el
// rol de SuperAdmin —ese llega YA RESUELTO desde el token, en su tercer
// argumento— y exige cuenta habilitada, asi que hay que llevarse tambien
// _cuentaHabilitada al sandbox o la funcion revienta con ReferenceError.
const codeToRun = `
${fnContent.match(/function _cuentaHabilitada[\s\S]*?^\}/m)[0]}
${fnContent.match(/function _callerHasClubPermission[\s\S]*?^\}/m)[0]}
`;
vm.runInContext(codeToRun, sandbox);

const callerHasPerm = sandbox._callerHasClubPermission;

// El staff de verdad: cuenta habilitada. Es lo que distingue a un director
// real de una cuenta recien creada que se declara director.
const vivo = (d) => ({ exists: true, data: () => Object.assign({ isAuthorized: true, status: 'active' }, d) });

ok('2b · _callerHasClubPermission autoriza al superadmin (resuelto por token)', callerHasPerm(vivo({}), 'CLUB1', true) === true);
ok('2c · _callerHasClubPermission autoriza a director del mismo club', callerHasPerm(vivo({ role: 'director', clubId: 'CLUB1' }), 'CLUB1', false) === true);
ok('2d · _callerHasClubPermission autoriza a coordinator del mismo club', callerHasPerm(vivo({ role: 'coordinator', clubId: 'CLUB1' }), 'CLUB1', false) === true);
ok('2e · _callerHasClubPermission autoriza a club_admin del mismo club', callerHasPerm(vivo({ role: 'club_admin', clubId: 'CLUB1' }), 'CLUB1', false) === true);
ok('2f · _callerHasClubPermission rechaza rol en club distinto', callerHasPerm(vivo({ role: 'director', clubId: 'CLUB_OTRO' }), 'CLUB1', false) === false);
// 🛡️ SEC-C1c · el caso que abria la puerta: documento AUTO-CREADO, sin aprobar.
ok('2f2 · 🔴 rechaza una cuenta SIN HABILITAR que se declara club_admin del club',
   callerHasPerm({ exists: true, data: () => ({ role: 'club_admin', clubId: 'CLUB1', isAuthorized: false, status: 'pending' }) }, 'CLUB1', false) === false);
ok('2f3 · 🔴 y ya no basta con poner role:"superadmin" en el propio documento',
   callerHasPerm({ exists: true, data: () => ({ role: 'superadmin' }) }, 'CLUB1', false) === false);
ok('2g · _callerHasClubPermission evalúa allRoles para director/coordinador secundario', callerHasPerm({
    exists: true,
    data: () => ({
        role: 'coach',
        clubId: 'CLUB1',
        // 🛡️ SEC-C1c: el documento del LLAMANTE tiene que estar habilitado.
        isAuthorized: true, status: 'active',
        allRoles: [{ role: 'coordinator', clubId: 'CLUB1', status: 'active', isAuthorized: true }]
    })
}, 'CLUB1', false) === true);

// 2h-2l · EL PUNTO CIEGO: club del objetivo SIN RESOLVER.
//
// Los casos 2b-2g de arriba comprobaban club igual y club distinto, pero
// ninguno el caso "no sé de qué club es". La primera versión de esta función
// llevaba tres comodines (`!targetClubId || !callerClubId || !r.clubId`) que
// en ese caso devolvían TRUE: cualquier administrador de cualquier club
// quedaba autorizado a borrar la cuenta. Y no es un caso raro — NINGÚN cliente
// envía `clubId`, y el uid que llega puede ser el de un doc secundario que no
// existe en `users/{uid}`. Sin club resuelto la respuesta tiene que ser NO.
ok('2h · rechaza a director de otro club cuando el club del objetivo no se resuelve',
   callerHasPerm({ exists: true, data: () => ({ role: 'director', clubId: 'CLUB_OTRO' }) }, null) === false);
ok('2i · rechaza a club_admin cuando el club del objetivo no se resuelve',
   callerHasPerm({ exists: true, data: () => ({ role: 'club_admin', clubId: 'CLUB1' }) }, null) === false);
ok('2j · rechaza a un llamante SIN clubId propio frente a un objetivo con club',
   callerHasPerm({ exists: true, data: () => ({ role: 'club_admin' }) }, 'CLUB1') === false);
ok('2k · rechaza allRoles sin clubId frente a un objetivo con club',
   callerHasPerm({ exists: true, data: () => ({
       role: 'coach',
       allRoles: [{ role: 'coordinator', status: 'active', isAuthorized: true }]
   }) }, 'CLUB1') === false);
// ⚠️ ACTUALIZADA (SEC-C1c): el rol de SuperAdmin ya NO se deduce del
// documento —lo escribia el propio usuario— sino que llega resuelto desde el
// TOKEN en el tercer argumento. La intencion de 2l no cambia: con el club sin
// resolver, el SuperAdmin sigue pasando y nadie mas.
ok('2l · el superadmin sigue pasando aunque no haya club resuelto',
   callerHasPerm({ exists: true, data: () => ({}) }, null, true) === true);
ok('2l2 · 🔴 pero declararse superadmin en el propio documento ya no vale',
   callerHasPerm({ exists: true, data: () => ({ role: 'superadmin' }) }, null, false) === false);

// 2m · Y que la autorización no se alimente de lo que manda el cliente.
ok('2m · deleteAuthUser no autoriza con el clubId enviado por el cliente',
   !/let targetClubId = \(data && data\.clubId\)/.test(fnContent));
ok('2n · archiveAndDeleteCoach no cierra la cadena con el clubId del propio llamante',
   !/effectiveClubId = clubId \|\| target\.clubId \|\| \(data && data\.clubId\) \|\| callerDoc\.data\(\)\.clubId/.test(fnContent));

// 3. Verificar purga de Firestore en archiveAndDeleteCoach y deleteAuthUser
ok('3a · archiveAndDeleteCoach purga el documento primario users/{targetUid}',
   fnContent.includes("db.collection('users').doc(targetUid).delete()"));
ok('3b · deleteAuthUser purga el documento primario users/{uid}',
   fnContent.includes("admin.firestore().collection('users').doc(uid).delete()"));

console.log(`\n------------------------------------------------------------`);
console.log(`Resultado: ${passCount}/${testCount} pruebas superadas.`);

if (failCount > 0) {
    process.exit(1);
} else {
    process.exit(0);
}

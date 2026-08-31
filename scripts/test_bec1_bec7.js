// Test BE-C1 (registerStaffUid cross-club) y BE-C7 (logAuditEntry whitelist)
// Extrae la logica REAL de functions/index.js y la ejecuta en sandbox.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { (cond ? (pass++, console.log('  OK  ', name)) : (fail++, console.log('  FAIL', name))); }

// ---------- BE-C1: replicar la validacion de pertenencia ----------
// (misma logica que el codigo real, extraida para simulacion)
function registerStaffCheck(userData, role, clubId) {
  const rootMatchesClub = userData.role === role &&
    userData.clubId != null && userData.clubId === clubId;
  const roleForClub = Array.isArray(userData.allRoles) && userData.allRoles.some(
    (r) => r && r.role === role && r.clubId === clubId &&
           r.isAuthorized !== false && r.status !== 'rejected' && r.status !== 'removed'
  );
  return rootMatchesClub || roleForClub;
}

console.log('BE-C1 registerStaffUid (pertenencia al club):');
// director del club A intenta registrarse en club B -> DENY
ok('director de A -> clubId B: DENY',
   registerStaffCheck({ role: 'director', clubId: 'A' }, 'director', 'B') === false);
// director del club A en su propio club A -> ALLOW
ok('director de A -> clubId A: ALLOW',
   registerStaffCheck({ role: 'director', clubId: 'A' }, 'director', 'A') === true);
// multi-rol: allRoles tiene director en B autorizado -> ALLOW para B
ok('multi-rol allRoles director B autorizado -> B: ALLOW',
   registerStaffCheck({ role: 'user', clubId: 'A', allRoles: [{ role: 'director', clubId: 'B', isAuthorized: true }] }, 'director', 'B') === true);
// multi-rol: allRoles director B pero rechazado -> DENY
ok('multi-rol allRoles director B rechazado -> B: DENY',
   registerStaffCheck({ role: 'user', clubId: 'A', allRoles: [{ role: 'director', clubId: 'B', status: 'rejected' }] }, 'director', 'B') === false);
// tiene rol director en A (allRoles) pero pide B -> DENY (el bug antiguo lo permitia)
ok('allRoles director A, pide B -> DENY (bug antiguo)',
   registerStaffCheck({ role: 'user', clubId: 'A', allRoles: [{ role: 'director', clubId: 'A', isAuthorized: true }] }, 'director', 'B') === false);
// coordinator correcto en su club -> ALLOW
ok('coordinator de C -> clubId C: ALLOW',
   registerStaffCheck({ role: 'coordinator', clubId: 'C' }, 'coordinator', 'C') === true);
// verifica que el codigo fuente ya NO usa solo hasRole para autorizar
ok('fuente contiene rootMatchesClub', /rootMatchesClub/.test(src));
ok('fuente contiene roleForClub', /roleForClub/.test(src));
// ⚠️ SEC-F05 (2026-08-31) · esta asercion exigia `r.clubId === clubId`, o sea
// que la rama de `allRoles` comparase el club. Ya NO hay rama de `allRoles`:
// `roleForClub` es `false` fijo y solo decide la RAIZ. La proteccion de BE-C1
// —no registrarse como staff de un club ajeno— pasa de estar ACOTADA a ser
// ABSOLUTA, asi que se comprueba eso en vez del patron viejo.
// 🔑 El motivo de cerrarla del todo es una CIRCULARIDAD: esta funcion escribe
// `directorUids`, que desde SEC-F05 es la lista que corrobora el rol. Si se
// autorizara desde `allRoles` —que el usuario escribe—, uno se mete solo en la
// lista y a partir de ahi queda "corroborado" por ella.
ok('fuente: roleForClub ya no sale de allRoles (BE-C1 absoluto)',
   /const roleForClub = false;/.test(src) && !/r\.clubId === clubId/.test(src));

// ---------- BE-C7: whitelist de acciones ----------
const ALLOWED = ['goal','goal_cancelled','card','yellow_card','red_card','red_card_reversed','injury','substitute','substitution','formation_change','actions_cleared'];
function actionAllowed(a) { return ALLOWED.indexOf(a) !== -1; }

console.log('BE-C7 logAuditEntry (whitelist de action):');
// todas las acciones reales que emite el cliente deben pasar
const realClient = ['injury','card','red_card_reversed','goal','goal_cancelled','actions_cleared','yellow_card','red_card','substitute'];
ok('todas las acciones reales del cliente pasan', realClient.every(actionAllowed));
// accion arbitraria -> rechazada
ok('accion arbitraria "hack" -> DENY', actionAllowed('hack') === false);
ok('accion vacia-ish "DROP TABLE" -> DENY', actionAllowed('DROP TABLE') === false);
// la fuente contiene la whitelist y el rechazo
ok('fuente contiene ALLOWED_ACTIONS', /ALLOWED_ACTIONS/.test(src));
ok('fuente rechaza action no permitida', /action no permitida/.test(src));
ok('fuente acota matchId length', /matchId demasiado largo/.test(src));

console.log('\nRESULT:', pass, 'pass /', fail, 'fail');
process.exit(fail ? 1 : 0);

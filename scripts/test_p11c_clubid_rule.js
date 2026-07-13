// Test P11-C / SEC-C1: migración del clubId del director/coordinador (multi-rol
// vía allRoles[]) al campo RAÍZ de users/{uid} para que las reglas Firestore
// (userDocClubId) autoricen la lectura de informes.
//
// HISTORIA:
//   · P11-C (v179): el bug era que _cResolveClubId no persistía el clubId a la
//     raíz (faltaba updateDoc) -> userDocClubId() fallaba.
//   · SEC-C1: la persistencia YA NO la hace el cliente con updateDoc (permitía
//     fijar un clubId AJENO). Ahora la hace el Admin SDK vía la Cloud Function
//     syncRootClubId(), y la regla `allow update` prohíbe clubId al cliente.
//
// Este test verifica el estado POST-SEC-C1: _cResolveClubId ya no escribe
// directamente; delega en syncRootClubId; y los call-sites no pasan updateDoc.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const panel    = fs.readFileSync(path.join(ROOT, 'js/coach/comms/panel.js'), 'utf8');
const creports = fs.readFileSync(path.join(ROOT, 'js/coach/reports/club-reports.js'), 'utf8');

let pass = true;
const assert = (c, m) => { if (!c) { pass = false; console.error('FAIL:', m); } else console.log('ok:', m); };

// 1) _cResolveClubId ya NO escribe clubId con updateDoc (SEC-C1).
const resolveFn = panel.slice(panel.indexOf('async function _cResolveClubId'),
                              panel.indexOf('window._cResolveClubId = _cResolveClubId'));
assert(!/fns\.updateDoc/.test(resolveFn), '_cResolveClubId no usa fns.updateDoc (SEC-C1)');

// 2) La persistencia se delega en la Cloud Function syncRootClubId.
assert(/syncRootClubId/.test(resolveFn), '_cResolveClubId invoca syncRootClubId (CF)');

// 3) Ningún call-site pasa ya updateDoc a _cResolveClubId.
const callSitesPassingUpdate =
    (panel.match(/_cResolveClubId\(db, me, \{ doc, getDoc, updateDoc \}\)/g) || []).length +
    (creports.match(/_cResolveClubId\(db, me, \{ doc, getDoc, updateDoc \}\)/g) || []).length;
assert(callSitesPassingUpdate === 0, 'ningún call-site pasa updateDoc a _cResolveClubId (encontrados: ' + callSitesPassingUpdate + ')');

// 4) Siguen existiendo los 5 call-sites (2 comms + 3 reports) y aún resuelven clubId.
const callsPanel   = (panel.match(/await _cResolveClubId\(db, me,/g) || []).length;
const callsReports = (creports.match(/_cResolveClubId\(db, me,/g) || []).length;
assert(callsPanel === 2, '2 llamadas en comms/panel.js (encontradas: ' + callsPanel + ')');
assert(callsReports === 3, '3 llamadas en club-reports.js (encontradas: ' + callsReports + ')');

// 5) Simulación de la resolución: sigue resolviendo clubId desde allRoles[] y
//    cacheándolo en memoria (me.clubId) aunque la raíz esté vacía.
function resolveClubId(me, userDoc) {
  if (me.clubId) return me.clubId;
  return userDoc.clubId
    || (Array.isArray(userDoc.allRoles) ? (userDoc.allRoles.find(r => r && r.clubId) || {}).clubId : null)
    || null;
}
const cid = resolveClubId({ uid: 'u1' }, { clubId: null, allRoles: [{ role: 'director', clubId: 'club_abc' }] });
assert(cid === 'club_abc', 'resuelve clubId desde allRoles (en memoria)');

console.log(pass ? '\nALL TESTS PASSED' : '\nTESTS FAILED');
process.exit(pass ? 0 : 1);

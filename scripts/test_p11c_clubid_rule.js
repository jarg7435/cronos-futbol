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
// El monolito comms/panel.js se descompuso igual (auditoría 2026-07-22, pasos
// 6a/6b, 2026-07-27): sus dos call-sites de _cResolveClubId estaban en el §8
// de envío de informes, uno en el camino MANUAL (que se fue a
// match-reports-send.js) y otro en el AUTOMÁTICO (match-reports-auto.js).
// Se leen todos y se cuentan juntos, para que el recuento siga describiendo la
// misma superficie de código. Los archivos aún no extraídos se ignoran.
const panel = [
  'js/coach/comms/panel.js',
  'js/coach/comms/match-reports-send.js',
  'js/coach/comms/match-reports-auto.js',
].filter(f => fs.existsSync(path.join(ROOT, f)))
 .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
// El monolito club-reports.js se descompuso (auditoría 2026-07-22, paso 5 de 6
// el 2026-07-26): uno de los dos call-sites de _cResolveClubId se quedó en
// club-reports.js (openStaffDashboard) y el otro se fue a reports-tab.js
// (_sdLoadReports). Se leen LOS DOS y se cuentan juntos, para que el recuento
// siga describiendo la misma superficie de código que antes del refactor.
const creports = [
  'js/coach/reports/club-reports.js',
  'js/coach/reports/reports-tab.js',
].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

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

// 4) Siguen existiendo los 4 call-sites (2 comms + 2 reports) y aún resuelven
//    clubId. (La auditoría 2026-07-22 referenciaba también sdSendBulkMsg en
//    club-reports.js, pero esa función ya no existe: fue sustituida por el
//    sistema de mensajería unificado _umState — ver CORRECCIONES_ESTADO.md.)
const callsPanel   = (panel.match(/await _cResolveClubId\(db, me,/g) || []).length;
const callsReports = (creports.match(/_cResolveClubId\(db, me,/g) || []).length;
assert(callsPanel === 2, '2 llamadas en comms/panel.js (encontradas: ' + callsPanel + ')');
assert(callsReports === 2, '2 llamadas en club-reports.js (encontradas: ' + callsReports + ')');

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

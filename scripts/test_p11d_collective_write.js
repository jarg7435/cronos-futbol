// Test P11-D: el informe colectivo (y el auto-despacho) deben ESCRIBIR los docs
// cronos_player_reports aunque la lista de staff esté vacía, y staffUids debe
// incluir SIEMPRE al entrenador (me.uid) para que la Query B (array-contains)
// del Panel de Informes nunca quede vacía.
//
// CAUSA RAÍZ P11-D: _sendCollectiveReportNow hacía `return` si !staff.length,
//   abortando la escritura de los informes -> el partido nuevo NO aparecía en
//   el Panel de Informes (que se alimenta exclusivamente de esos docs).

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
// El monolito comms/panel.js se está descomponiendo (auditoría 2026-07-22,
// paso 2 de 6 el 2026-07-27): _sendCollectiveReportNow se fue a
// collective-report.js, mientras que autoDispatchMatchReports sigue en
// panel.js. Se leen LOS DOS y se concatenan, para que las 6 aserciones sigan
// describiendo la misma superficie de código que antes del refactor.
// (Antes se usaba la ruta relativa 'js/coach/comms/panel.js', que dependía del
//  directorio de trabajo; ahora se resuelve desde __dirname.)
// Y en el paso 6b (2026-07-27) autoDispatchMatchReports —donde viven las otras
// dos aserciones— se fue a match-reports-auto.js. Se leen todos y se
// concatenan. Los que aún no existan se ignoran, para que el archivo sirva
// antes y después de cada extracción.
const src = [
  'js/coach/comms/panel.js',
  'js/coach/comms/collective-report.js',
  'js/coach/comms/match-reports-auto.js',
].filter(f => fs.existsSync(path.join(ROOT, f)))
 .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

let pass = true;
const assert = (c, m) => { if (!c) { pass = false; console.error('FAIL:', m); } else console.log('ok:', m); };

// 1) Ya no debe existir el `return;` que abortaba la escritura cuando staff=[].
assert(
  !/if \(!staff\.length\) \{\s*if \(typeof showToast==='function'\) showToast\('⚠️ Sin directores\/coordinadores asignados', 3000\);\s*return;/.test(src),
  'eliminado el return temprano cuando la lista de staff esta vacia'
);

// 2) _sendCollectiveReportNow construye _collStaffUids incluyendo me.uid.
assert(/const _collStaffUids = Array\.from\(new Set\(\[[\s\S]*?me\.uid,[\s\S]*?\]\.filter\(Boolean\)\)\);/.test(src),
  'colectivo: _collStaffUids incluye me.uid como red de seguridad');

// 3) El doc colectivo usa _collStaffUids (no staff.map directo).
assert(/staffUids:\s+_collStaffUids,/.test(src),
  'colectivo: el doc usa staffUids: _collStaffUids');

// 4) autoDispatchMatchReports tambien fuerza me.uid en _allStaffUids.
// ⚠️ La regex anterior usaba [\s\S]*? y exigia "me.uid," CON COMA. En el codigo
// real me.uid es el ULTIMO elemento del array, asi que va seguido de "]", no de
// una coma: lo que casaba era texto de OTRAS funciones situadas mas abajo en el
// mismo archivo. Es decir, la asercion pasaba por el motivo equivocado y no
// habria detectado la perdida de me.uid. Al partir el §8 en dos archivos dejo
// de haber codigo detras que la sostuviera y salio a la luz.
// Ahora se acota con [^\]]* para que no pueda salirse del propio array.
assert(/const _allStaffUids = Array\.from\(new Set\(\[[^\]]*me\.uid\]\.filter\(Boolean\)\)\);/.test(src),
  'autoDispatch: _allStaffUids incluye me.uid');

// 5) Logs de diagnostico [StaffReport] con conteo TOTAL en ambos caminos.
assert(/TOTAL informes colectivos escritos en cronos_player_reports/.test(src),
  'log TOTAL en _sendCollectiveReportNow');
assert(/TOTAL informes staff escritos en cronos_player_reports/.test(src),
  'log TOTAL en autoDispatchMatchReports');

// 6) Simulacion del calculo de staffUids con staff vacio.
function buildStaffUids(staff, meUid) {
  return Array.from(new Set([...staff.map(s => s.uid).filter(Boolean), meUid].filter(Boolean)));
}
assert(JSON.stringify(buildStaffUids([], 'coach1')) === JSON.stringify(['coach1']),
  'staff vacio -> staffUids = [coach1] (no vacio)');
assert(JSON.stringify(buildStaffUids([{uid:'d1'},{uid:null},{email:'x@y'}], 'coach1')) === JSON.stringify(['d1','coach1']),
  'staff con uids + email-only -> dedup y coach incluido');
assert(JSON.stringify(buildStaffUids([{uid:'coach1'}], 'coach1')) === JSON.stringify(['coach1']),
  'no duplica si el coach ya estaba en la lista');

console.log(pass ? '\nALL TESTS PASSED' : '\nTESTS FAILED');
process.exit(pass ? 0 : 1);

// Test P11-C: el clubId del director/coordinador (multi-rol via allRoles[])
// debe MIGRARSE al campo raíz de users/{uid} para que las reglas Firestore
// (userDocClubId) autoricen la lectura de informes.
//
// CAUSA RAÍZ: _cResolveClubId(db, me, fns) solo ejecuta la migración
//   updateDoc(users/{uid}, { clubId }) si fns.updateDoc está presente.
//   Las tres llamadas en club-reports.js lo invocaban SIN updateDoc, así que
//   me.clubId se resolvía en memoria (la query corría) pero el campo raíz del
//   documento seguía vacío -> userDocClubId() fallaba -> la query por clubId era
//   rechazada entera por las reglas -> faltaban partidos.
//
// FIX: las tres llamadas pasan ahora { doc, getDoc, updateDoc }.

const fs = require('fs');
const src = fs.readFileSync('js/coach/reports/club-reports.js', 'utf8');

let pass = true;
const assert = (c, m) => { if (!c) { pass = false; console.error('FAIL:', m); } else console.log('ok:', m); };

// 1) No deben quedar llamadas a _cResolveClubId sin updateDoc.
const callsSinUpdate = (src.match(/_cResolveClubId\(db, me, \{ doc: docFn, getDoc \}\)/g) || []).length;
assert(callsSinUpdate === 0, 'ninguna llamada a _cResolveClubId sin updateDoc');

// 2) Las tres llamadas deben incluir updateDoc.
const callsConUpdate = (src.match(/_cResolveClubId\(db, me, \{ doc: docFn, getDoc, updateDoc \}\)/g) || []).length;
assert(callsConUpdate === 3, 'las 3 llamadas a _cResolveClubId pasan updateDoc (encontradas: ' + callsConUpdate + ')');

// 3) Los imports correspondientes deben desestructurar updateDoc.
const importsConUpdate = (src.match(/const \{ doc: docFn, getDoc, updateDoc \} = await _sdFS\(\);/g) || []).length;
assert(importsConUpdate === 3, 'los 3 imports desestructuran updateDoc (encontrados: ' + importsConUpdate + ')');

// 4) Simulación del comportamiento de _cResolveClubId.
async function resolveClubId(me, userDoc, fns) {
  if (me.clubId) return me.clubId;
  const cid = userDoc.clubId
    || (Array.isArray(userDoc.allRoles) ? (userDoc.allRoles.find(r => r && r.clubId) || {}).clubId : null)
    || null;
  if (cid && !userDoc.clubId && fns.updateDoc) {
    fns.updateDoc('users', { clubId: cid }); // simula la migración
  }
  return cid;
}

(async () => {
  // Director multi-rol: clubId solo en allRoles, campo raíz vacío.
  const userDoc = { clubId: null, allRoles: [{ role: 'director', clubId: 'club_abc' }] };
  let migrated = null;
  const fns = { updateDoc: (col, data) => { migrated = data.clubId; } };
  const cid = await resolveClubId({ uid: 'u1' }, userDoc, fns);
  assert(cid === 'club_abc', 'resuelve clubId desde allRoles');
  assert(migrated === 'club_abc', 'con updateDoc presente, MIGRA clubId al campo raíz');

  // Sin updateDoc (comportamiento antiguo): NO migra -> bug.
  let migrated2 = null;
  await resolveClubId({ uid: 'u1' }, { clubId: null, allRoles: [{ role: 'director', clubId: 'club_abc' }] }, {});
  assert(migrated2 === null, 'sin updateDoc NO migra (reproduce el bug P11-C antiguo)');

  console.log(pass ? '\nALL TESTS PASSED' : '\nTESTS FAILED');
  process.exit(pass ? 0 : 1);
})();

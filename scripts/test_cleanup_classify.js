/**
 * test_cleanup_classify.js  — verifica la LOGICA de clasificacion del cleanup
 * (mismo criterio que scripts/cleanup-contaminated-reports.js) SIN tocar Firestore.
 */
'use strict';

const SAFE_TYPE = 'parent_player_report';
const isNonEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// Replica exacta del criterio de clasificacion del script real.
function classify(docs, targetUid /* opcional */) {
  let legitParent = 0, noParentUid = 0;
  const contaminated = [];
  for (const { id, data } of docs) {
    const hasParent = isNonEmpty(data.parentUid);
    if (!hasParent) { noParentUid++; continue; }
    if (data.type === SAFE_TYPE) { legitParent++; continue; }
    if (targetUid && data.parentUid !== targetUid) continue;
    contaminated.push({ id, type: data.type, parentUid: data.parentUid });
  }
  return { legitParent, noParentUid, contaminated };
}

let passed = 0, failed = 0;
function assert(name, cond) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}

const MADRE = 'uid_madre';
const PADRE = 'uid_padre';

const docs = [
  // 14 colectivos contaminados con parentUid de la madre (el bug)
  ...Array.from({ length: 14 }, (_, i) => ({ id: 'col' + i, data: { type: 'collective_match_report', parentUid: MADRE, playerNumber: '7' } })),
  // 1 informe legitimo de la madre -> intacto
  { id: 'good_madre', data: { type: 'parent_player_report', parentUid: MADRE, playerNumber: '7' } },
  // informes legitimos de otro padre -> intactos
  { id: 'good_padre', data: { type: 'parent_player_report', parentUid: PADRE, playerNumber: '9' } },
  // colectivo SIN parentUid (informe staff normal) -> intacto
  { id: 'staff1', data: { type: 'collective_match_report', staffReport: true, playerNumber: '7' } },
  // colectivo del entrenador sin parentUid -> intacto
  { id: 'coach1', data: { type: 'collective_match_report', _forCoach: true, playerNumber: '7' } },
  // otro tipo contaminado con parentUid (defensivo) de la madre
  { id: 'otro', data: { type: 'some_other_report', parentUid: MADRE, playerNumber: '7' } },
  // parentUid vacio -> intacto
  { id: 'empty', data: { type: 'collective_match_report', parentUid: '', playerNumber: '7' } },
];

// --- Sin filtro: borra TODOS los contaminados (madre + cualquier padre) ---
const all = classify(docs);
assert('Sin filtro: 15 contaminados (14 col + 1 otro de la madre)', all.contaminated.length === 15);
assert('Sin filtro: 2 legitimos intactos (madre + padre)', all.legitParent === 2);
assert('Sin filtro: 3 sin parentUid intactos (staff, coach, empty)', all.noParentUid === 3);
assert('Sin filtro: NO borra ningun parent_player_report',
  all.contaminated.every(c => c.type !== SAFE_TYPE));

// --- Filtrado por la madre: solo sus contaminados ---
const onlyMadre = classify(docs, MADRE);
assert('Filtro madre: 15 contaminados (todos son de la madre aqui)', onlyMadre.contaminated.length === 15);
assert('Filtro madre: todos los borrados tienen parentUid de la madre',
  onlyMadre.contaminated.every(c => c.parentUid === MADRE));

// --- Filtrado por el padre: NO debe borrar nada (su unico doc es legitimo) ---
const onlyPadre = classify(docs, PADRE);
assert('Filtro padre: 0 contaminados (su unico doc es parent_player_report)',
  onlyPadre.contaminated.length === 0);

console.log('\n' + (failed === 0 ? 'OK' : 'FALLOS') + ': ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

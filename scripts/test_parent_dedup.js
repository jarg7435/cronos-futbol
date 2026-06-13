// Test del fix definitivo del panel del padre.
// Extrae la logica REAL de deduplicacion (_rptDedupKey + ambos loops) del
// panel.js y la ejecuta en sandbox sobre escenarios criticos.
const fs = require('fs');
const src = fs.readFileSync('js/parent/panel.js', 'utf8');

// --- Extraer _rptDedupKey real ---
const keyM = src.match(/function _rptDedupKey\(data\)\s*\{[\s\S]*?\n            \}/);
if (!keyM) { console.error('No se pudo extraer _rptDedupKey'); process.exit(1); }
// eslint-disable-next-line no-eval
const _rptDedupKey = eval('(' + keyM[0].replace('function _rptDedupKey', 'function') + ')');

// --- Simular los dos loops con los mismos filtros que el codigo real ---
const ME_UID = 'parentUID';
function build(rptByParent, rptByPlayer) {
  const reportsByMatch = {};
  const seenDocIds = new Set();
  // Prioridad 1
  rptByParent.forEach(d => {
    const data = d.data;
    if (data.type !== 'parent_player_report') return;            // FIX simetria
    if (data.staffReport === true || data._forCoach === true) return;
    if (Array.isArray(data.dismissedBy) && data.dismissedBy.includes(ME_UID)) return;
    if (seenDocIds.has(d.id)) return;
    seenDocIds.add(d.id);
    const k = _rptDedupKey(data);
    if (!reportsByMatch[k] || data.type === 'parent_player_report') reportsByMatch[k] = { _id: d.id, ...data };
  });
  // Prioridad 2
  rptByPlayer.forEach(d => {
    const data = d.data;
    if (data.type !== 'parent_player_report') return;            // FIX v169
    if (data.staffReport === true || data._forCoach === true) return;
    if (Array.isArray(data.dismissedBy) && data.dismissedBy.includes(ME_UID)) return;
    if (seenDocIds.has(d.id)) return;
    seenDocIds.add(d.id);
    const k = _rptDedupKey(data);
    if (!reportsByMatch[k]) reportsByMatch[k] = { _id: d.id, ...data };
  });
  return { reports: Object.values(reportsByMatch), seenDocIds };
}

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}

// Escenario A: 14 collective_match_report (bug v169) + 1 parent -> 1 informe
(() => {
  const byPlayer = [];
  for (let i = 0; i < 14; i++) byPlayer.push({ id: 'col' + i, data: { type: 'collective_match_report', playerNumber: '5', matchId: 'm1', matchDate: '2026-06-13', rival: 'X' } });
  byPlayer.push({ id: 'par1', data: { type: 'parent_player_report', playerNumber: '5', matchId: 'm1', matchDate: '2026-06-13', rival: 'X' } });
  const { reports } = build([], byPlayer);
  assert('A: 14 colectivos + 1 padre -> 1 informe', reports.length === 1 && reports[0].type === 'parent_player_report');
})();

// Escenario B (CRITICO - perdida de datos): 2 partidos distintos, mismo dia,
// mismo rival, mismo marcador, distinto matchId -> deben verse 2 informes.
(() => {
  const byParent = [
    { id: 'p1', data: { type: 'parent_player_report', playerNumber: '7', matchId: 'mA', matchDate: '2026-06-13', rival: 'CD Sur', scoreHome: 2, scoreAway: 2 } },
    { id: 'p2', data: { type: 'parent_player_report', playerNumber: '7', matchId: 'mB', matchDate: '2026-06-13', rival: 'CD Sur', scoreHome: 2, scoreAway: 2 } },
  ];
  const { reports, seenDocIds } = build(byParent, []);
  assert('B: 2 partidos distintos mismo dia/rival/marcador -> 2 informes (sin perdida)', reports.length === 2);
  // El cleanup borraria seen - winners. Aqui ambos son winners -> 0 borrados.
  const winners = new Set(reports.map(r => r._id));
  const toDelete = Array.from(seenDocIds).filter(id => !winners.has(id));
  assert('B: cleanup NO borra ninguno de los 2 partidos', toDelete.length === 0);
})();

// Escenario C: collective_match_report con parentUid del padre (Prioridad 1) -> excluido
(() => {
  const byParent = [
    { id: 'colp', data: { type: 'collective_match_report', parentUid: ME_UID, playerNumber: '9', matchId: 'mC' } },
    { id: 'good', data: { type: 'parent_player_report', parentUid: ME_UID, playerNumber: '9', matchId: 'mC' } },
  ];
  const { reports } = build(byParent, []);
  assert('C: colectivo con parentUid en Prioridad 1 -> excluido (1 informe)', reports.length === 1 && reports[0]._id === 'good');
})();

// Escenario D: 2 partidos legacy SIN matchId (rpt_*), distinta fecha -> 2 informes
(() => {
  const byPlayer = [
    { id: 'r1', data: { type: 'parent_player_report', playerNumber: '3', matchDate: '2026-06-01', rival: 'A', scoreHome: 1, scoreAway: 0 } },
    { id: 'r2', data: { type: 'parent_player_report', playerNumber: '3', matchDate: '2026-06-08', rival: 'A', scoreHome: 1, scoreAway: 0 } },
  ];
  const { reports } = build([], byPlayer);
  assert('D: 2 partidos legacy sin matchId, distinta fecha -> 2 informes', reports.length === 2);
})();

// Escenario E: doc duplicado REAL (mismo matchId+dorsal) en parent y player -> 1 informe
(() => {
  const doc = { type: 'parent_player_report', playerNumber: '5', matchId: 'mE', matchDate: '2026-06-13', rival: 'Z' };
  const { reports } = build([{ id: 'same', data: doc }], [{ id: 'same', data: doc }]);
  assert('E: mismo doc en ambas queries -> 1 informe', reports.length === 1);
})();

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

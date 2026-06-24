// -*- test for _purgeStaleLocalDataIfNeeded -*-
// Carga la función real desde firestore-storage.js en un sandbox mínimo.
const fs = require('fs');
const vm = require('vm');

// localStorage simulado: las claves de datos viven como propiedades enumerables
// para que Object.keys(localStorage) las devuelva, igual que el localStorage real.
function makeLS(init = {}) {
  const ls = {};
  Object.defineProperties(ls, {
    getItem:    { value: k => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null) },
    setItem:    { value: (k, v) => { ls[k] = String(v); } },
    removeItem: { value: k => { delete ls[k]; } },
  });
  for (const [k, v] of Object.entries(init)) ls[k] = String(v);
  return ls;
}

function loadPurgeFn(localStorage) {
  const src = fs.readFileSync('js/services/firestore-storage.js', 'utf8');
  // Extraer solo lo necesario hasta el final de _purgeStaleLocalDataIfNeeded.
  const sandbox = {
    localStorage,
    window: {},
    console: { log() {}, warn() {} },
    Object,
    Set,
  };
  vm.createContext(sandbox);
  // Ejecutamos las definiciones de KEEP keys, sweep y la función de purga.
  const slice = src.slice(0, src.indexOf('// ── Referencia al doc'));
  vm.runInContext(slice, sandbox);
  return sandbox._purgeStaleLocalDataIfNeeded;
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS:', name); }
  else { fail++; console.log('  FAIL:', name); }
}

// ── Escenario A: usuario pre-v199 (datos locales, SIN marcador) actualiza versión.
// Antes del fix: se borraba todo. Después del fix: se conservan los datos.
{
  const ls = makeLS({
    cronos_master_roster: '[{"id":1}]',
    cronos_training_weeks: '{"w1":[]}',
    cronos_conv_data: '{"titulares":[1,2,3]}',
    cronos_teams: '[{"name":"A"}]',
  });
  const purge = loadPurgeFn(ls);
  purge('coach-uid-123');           // primer login tras update (sin marcador)
  console.log('Escenario A (pre-v199, mismo usuario, update):');
  check('conserva cronos_master_roster', ls.getItem('cronos_master_roster') === '[{"id":1}]');
  check('conserva cronos_training_weeks (local-only)', ls.getItem('cronos_training_weeks') === '{"w1":[]}');
  check('conserva cronos_conv_data (local-only)', ls.getItem('cronos_conv_data') === '{"titulares":[1,2,3]}');
  check('establece el marcador owner_uid', ls.getItem('cronos_owner_uid') === 'coach-uid-123');
}

// ── Escenario B: segunda actualización (marcador YA = mismo uid). No debe tocar nada.
{
  const ls = makeLS({
    cronos_owner_uid: 'coach-uid-123',
    cronos_master_roster: '[{"id":1}]',
    cronos_training_weeks: '{"w1":[]}',
  });
  const purge = loadPurgeFn(ls);
  purge('coach-uid-123');
  console.log('Escenario B (mismo uid, update siguiente):');
  check('conserva roster', ls.getItem('cronos_master_roster') === '[{"id":1}]');
  check('conserva training_weeks', ls.getItem('cronos_training_weeks') === '{"w1":[]}');
}

// ── Escenario C: cambio de usuario REAL (marcador != uid entrante). DEBE purgar PII.
{
  const ls = makeLS({
    cronos_owner_uid: 'coach-OLD',
    cronos_master_roster: '[{"id":99}]',
    cronos_training_weeks: '{"secreto":true}',
    cronos_owner_uid_keep_check: 'x', // no empieza por cronos_ keep, se ignora? sí empieza, se borra
    cronos_live_muted: '1',           // KEEP list → debe sobrevivir
  });
  const purge = loadPurgeFn(ls);
  purge('coach-NEW');
  console.log('Escenario C (cambio de usuario real):');
  check('PURGA cronos_master_roster del anterior', ls.getItem('cronos_master_roster') === null);
  check('PURGA cronos_training_weeks del anterior', ls.getItem('cronos_training_weeks') === null);
  check('conserva cronos_live_muted (KEEP list)', ls.getItem('cronos_live_muted') === '1');
  check('actualiza marcador al nuevo uid', ls.getItem('cronos_owner_uid') === 'coach-NEW');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

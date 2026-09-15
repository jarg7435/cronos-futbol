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

// ── Escenario C: cambio de usuario REAL (marcador != uid entrante).
// ══════════════════════════════════════════════════════════════════════
//  ⚠️⚠️ v720 · INVERTIDO A PROPÓSITO: AQUÍ YA NO SE PURGA.
// ══════════════════════════════════════════════════════════════════════
//  Este escenario exigía, desde v199, que un cambio de uid BORRARA las claves
//  del usuario anterior. Era la única defensa que había contra heredar los
//  datos de otro en el mismo navegador… y con el tiempo se volvió el daño:
//
//  🔴 localStorage es del NAVEGADOR, no de la pestaña. Al entrar una segunda
//  cuenta en otra pestaña, ese barrido se llevaba TODAS las claves `cronos_*`
//  —incluida la RANURA DEL PARTIDO EN CURSO de la primera, y las plantillas,
//  convocatorias y planificaciones, que NO se restauran de Firestore—. Es lo
//  que el autor fotografió (capturas 10438-10440) al pedir que dos correos
//  pudieran convivir en dos pestañas.
//
//  v720 aísla en vez de borrar: cada cuenta lee y escribe en su propio espacio
//  (`cronos_teams@<uid>`, js/core/local-uid.js), así que la herencia que v199
//  venía a evitar ES IMPOSIBLE por construcción — la cuenta que entra no puede
//  ni leer las claves de la otra. La INTENCIÓN de v199 se conserva entera; lo
//  que cambia es el mecanismo, y con él el signo de estas dos aserciones.
//
//  ⚠️ Lo que este arnés NO puede probar: la migración de verdad. `makeLS` no
//  es un `Storage` con prototipo, así que la envoltura de v720 no se instala
//  aquí y `cronosMigraClavesLocales` no existe en este sandbox. El aislamiento
//  completo —dos cuentas, dos pestañas, un solo localStorage— se prueba en
//  **scripts/test_datos_locales_por_uid.js**, que monta el navegador entero.
//  Aquí se defiende lo que sí se ve: que el CASO 3 no destruye nada.
{
  const ls = makeLS({
    cronos_owner_uid: 'coach-OLD',
    cronos_master_roster: '[{"id":99}]',
    cronos_training_weeks: '{"secreto":true}',
    cronos_live_muted: '1',           // KEEP list → debe sobrevivir
  });
  const purge = loadPurgeFn(ls);
  purge('coach-NEW');
  console.log('Escenario C (cambio de usuario real · v720: aislar, no borrar):');
  check('NO purga cronos_master_roster del anterior (v720)', ls.getItem('cronos_master_roster') === '[{"id":99}]');
  check('NO purga cronos_training_weeks del anterior (v720)', ls.getItem('cronos_training_weeks') === '{"secreto":true}');
  check('conserva cronos_live_muted (KEEP list)', ls.getItem('cronos_live_muted') === '1');
  check('actualiza marcador al nuevo uid', ls.getItem('cronos_owner_uid') === 'coach-NEW');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

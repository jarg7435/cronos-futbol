// ════════════════════════════════════════════════════════════════════
//  Test Pieza 2 — Resolutor de staff por modalidad del partido
//  Extrae los helpers reales de js/core/utils.js y los ejecuta en sandbox
//  (mismo patrón que test_fixes_p1_p2.js / test_parent_report_targets.js).
//
//  Verifica:
//    • _cronosMatchModality: f7_/f11_, etiquetas legibles, currentMode.
//    • _cronosStaffCoordinatorType: raíz y allRoles[].
//    • _cronosResolveStaffForMatch: director siempre; coordinador f7/f11/f711.
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('js/core/utils.js', 'utf8');
const sandbox = { window: {}, module: { exports: {} } };
vm.createContext(sandbox);
// utils.js usa `window.` y `typeof window`; el global `window` del sandbox
// basta. Ejecutamos el archivo completo (las funciones de escape no molestan).
vm.runInContext(src, sandbox);

const { _cronosMatchModality, _cronosStaffCoordinatorType, _cronosResolveStaffForMatch } = sandbox.window;

let pass = 0, fail = 0;
function eq(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ FALLO: ' + name + '\n      got=' + JSON.stringify(got) + '\n      want=' + JSON.stringify(want)); }
}

console.log('\n── _cronosMatchModality ──');
eq('prefijo f7_alevin', _cronosMatchModality('f7_alevin'), 'f7');
eq('prefijo f11_cadete', _cronosMatchModality('f11_cadete'), 'f11');
eq('etiqueta Benjamín', _cronosMatchModality('Benjamín B'), 'f7');
eq('etiqueta Alevín', _cronosMatchModality('Alevín A'), 'f7');
eq('etiqueta Infantil', _cronosMatchModality('Infantil'), 'f11');
eq('etiqueta Juvenil', _cronosMatchModality('Juvenil A'), 'f11');
eq('mode tiene prioridad sobre cat', _cronosMatchModality('f7_alevin', 'f11'), 'f11');
eq('mode f7', _cronosMatchModality('', 'f7'), 'f7');
eq('mode f8 → f7', _cronosMatchModality('', 'f8'), 'f7');
eq('cat vacía sin mode → ""', _cronosMatchModality('', null), '');
eq('cat desconocida → ""', _cronosMatchModality('Veteranos XYZ', null), '');

console.log('\n── _cronosStaffCoordinatorType ──');
eq('raíz f7', _cronosStaffCoordinatorType({ coordinatorType: 'f7' }), 'f7');
eq('raíz f711', _cronosStaffCoordinatorType({ coordinatorType: 'f711' }), 'f711');
eq('requestedCoordinatorType', _cronosStaffCoordinatorType({ requestedCoordinatorType: 'f11' }), 'f11');
eq('desde allRoles', _cronosStaffCoordinatorType({ allRoles: [{ role: 'user' }, { role: 'coordinator', coordinatorType: 'f11' }] }), 'f11');
eq('raíz tiene prioridad sobre allRoles', _cronosStaffCoordinatorType({ coordinatorType: 'f7', allRoles: [{ role: 'coordinator', coordinatorType: 'f11' }] }), 'f7');
eq('valor inválido → ""', _cronosStaffCoordinatorType({ coordinatorType: 'xx' }), '');
eq('sin tipo → ""', _cronosStaffCoordinatorType({ role: 'coordinator' }), '');
eq('null → ""', _cronosStaffCoordinatorType(null), '');

console.log('\n── _cronosResolveStaffForMatch ──');
const staff = [
    { uid: 'd1', role: 'director' },                                  // siempre
    { uid: 'c7', role: 'coordinator', coordinatorType: 'f7' },        // solo F7
    { uid: 'c11', role: 'coordinator', coordinatorType: 'f11' },      // solo F11
    { uid: 'cb', role: 'coordinator', coordinatorType: 'f711' },      // ambas
    { uid: 'cn', role: 'coordinator' },                               // legacy sin tipo → ambas
    { uid: 'cml', role: 'coordinator', allRoles: [{ role: 'coordinator', coordinatorType: 'f11' }] }, // multi-rol F11
];
const uids = list => list.map(s => s.uid).sort();

// Partido F7 (categoría f7_alevin)
eq('F7 → director + coords f7/f711/sin-tipo (no f11)',
   uids(_cronosResolveStaffForMatch(staff, 'f7_alevin')),
   ['c7', 'cb', 'cn', 'd1'].sort());

// Partido F11 (categoría f11_cadete)
eq('F11 → director + coords f11/f711/sin-tipo + multirol-f11 (no f7)',
   uids(_cronosResolveStaffForMatch(staff, 'f11_cadete')),
   ['c11', 'cb', 'cml', 'cn', 'd1'].sort());

// Partido F11 vía etiqueta legible
eq('F11 etiqueta "Cadete A"',
   uids(_cronosResolveStaffForMatch(staff, 'Cadete A')),
   ['c11', 'cb', 'cml', 'cn', 'd1'].sort());

// Modalidad indeterminable → fail-open (todos)
eq('cat desconocida → fail-open (todos)',
   uids(_cronosResolveStaffForMatch(staff, 'CategoriaRara')),
   uids(staff));

// mode explícito sobreescribe categoría
eq('mode f7 fuerza F7 aunque cat sea f11',
   uids(_cronosResolveStaffForMatch(staff, 'f11_cadete', 'f7')),
   ['c7', 'cb', 'cn', 'd1'].sort());

// lista vacía / no-array
eq('lista vacía → []', _cronosResolveStaffForMatch([], 'f7_alevin'), []);
eq('no-array → []', _cronosResolveStaffForMatch(null, 'f7_alevin'), []);

// Director nunca se filtra aunque no haya modalidad coherente
eq('solo director → siempre',
   uids(_cronosResolveStaffForMatch([{ uid: 'd1', role: 'director' }], 'f7_alevin')),
   ['d1']);

console.log('\n' + (fail === 0 ? '✅ TODOS LOS TESTS OK (' + pass + ')' : '❌ ' + fail + ' FALLOS de ' + (pass + fail)));
process.exit(fail === 0 ? 0 : 1);

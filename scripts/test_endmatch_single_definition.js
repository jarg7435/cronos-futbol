// ─────────────────────────────────────────────────────────────────────────
// test_endmatch_single_definition.js · Deuda "endMatch duplicado"
// (AUDITORIA_GENERAL_2026-07-22.md, hallazgo #10).
//
// Había DOS asignaciones reales `window.endMatch = function endMatch(...)`:
// js/match/events/player-actions.js:511 y
// js/match/persistence/active-match.js:350. index.html carga active-match.js
// DESPUÉS de player-actions.js, así que la de active-match.js (más completa:
// limpia localStorage, empuja snapshot 'finished' a Firestore, triple
// silbato) siempre ganaba y la de player-actions.js quedaba muerta — pero
// SOLO por el orden de <script>, un supuesto implícito y frágil (el mismo
// patrón ya rompió una vez con startMatchWithConvocation, ver
// CORRECCIONES_ESTADO.md → "HOTFIX informes": ahí la versión que ganaba por
// orden de carga era la INCOMPLETA, y los informes de partido dejaron de
// enviarse a partir del 2º partido).
//
// Fix: eliminada la definición muerta de player-actions.js. Ahora solo
// existe una asignación real de window.endMatch (active-match.js); los
// wrappers de monkey-patch (patches.js, sprint3-init.js) siguen envolviendo
// esa única versión con `orig = window.endMatch; window.endMatch = ...`, lo
// cual es intencional y no cuenta como una "segunda definición".
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── endMatch: una sola definición real, sin depender del orden de <script> ──\n');

const playerActions = fs.readFileSync(path.join(ROOT, 'js', 'match', 'events', 'player-actions.js'), 'utf8');
const activeMatch    = fs.readFileSync(path.join(ROOT, 'js', 'match', 'persistence', 'active-match.js'), 'utf8');
const patches        = fs.readFileSync(path.join(ROOT, 'js', 'core', 'patches.js'), 'utf8');
const sprint3        = fs.readFileSync(path.join(ROOT, 'js', 'core', 'sprint3-init.js'), 'utf8');

// Patrón de una definición REAL "desde cero" (no un wrapper que captura `orig`).
const REAL_DEF = /window\.endMatch\s*=\s*function\s*(endMatch)?\s*\(/g;

ok('1a · [FIX] player-actions.js ya NO define window.endMatch',
   !REAL_DEF.test(playerActions));

REAL_DEF.lastIndex = 0;
ok('1b · active-match.js sigue siendo la única definición real',
   (activeMatch.match(REAL_DEF) || []).length === 1);

// Los wrappers de monkey-patch deben seguir presentes y seguir el patrón
// "capturar orig, envolver, delegar" — no una redefinición desde cero.
ok('2a · patches.js envuelve window.endMatch existente (no lo redefine desde cero)',
   /var orig = window\.endMatch;/.test(patches) && /window\.endMatch = function\(\)/.test(patches));
ok('2b · patches.js espera (polling) a que window.endMatch exista antes de envolver',
   /typeof window\.endMatch !== 'function'/.test(patches));
ok('2c · sprint3-init.js envuelve window.endMatch existente (no lo redefine desde cero)',
   /const origEndMatch = window\.endMatch/.test(sprint3));

// El comportamiento completo (localStorage, pushLiveSnapshot, silbato) sigue
// intacto en la única definición real que queda.
// v465 · ACTUALIZADA A PROPOSITO, y se refuerza en vez de relajarse.
// Antes exigia el literal `localStorage.removeItem('cronos_active_match_v2')`.
// Esa clave UNICA era el fallo que reporto el autor: con dos partidos abiertos,
// terminar uno borraba el estado del otro y lo dejaba sin emitir. Ahora hay una
// ranura por partido y endMatch cierra LA SUYA. La intencion original —"al
// finalizar se limpia el estado persistido, o reaparece el banner de retomar"—
// se sigue exigiendo, y ademas se prohibe volver a la clave pelada, que es como
// se reescribiria la regresion.
ok('3a · active-match.js: sigue limpiando el estado persistido al finalizar',
   /_cronosMatchSlots\?\.cerrar\(/.test(activeMatch));
ok('3a2 · ⚠️ y NO vuelve a la clave unica compartida entre pestanyas',
   !/localStorage\s*\.\s*(removeItem|setItem)\s*\(\s*'cronos_active_match_v2(_finished)?'/.test(activeMatch),
   'la clave pelada la escriben TODAS las pestanyas: terminar un partido apagaria el otro');
ok('3b · active-match.js: sigue empujando el snapshot \'finished\' a Firestore',
   /pushLiveSnapshot\('finished'\)/.test(activeMatch));
ok('3c · active-match.js: conserva el guard de idempotencia (matchPhase===\'finished\')',
   /if \(matchPhase === 'finished'\) return;/.test(activeMatch));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

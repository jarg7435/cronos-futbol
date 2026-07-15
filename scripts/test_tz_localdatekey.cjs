// ════════════════════════════════════════════════════════════════════
// Test de regresión: fix de zona horaria en las claves de fecha de la
// semana de entrenamiento (_cronosLocalDateKey en js/core/utils.js).
//
// BUG original: date.toISOString().substring(0,10) sobre un Date en
// medianoche LOCAL convierte a UTC y, en zonas UTC+ (España, UTC+1/+2),
// desplaza la clave -1 día (lunes 13 → "2026-07-12").
//
// Ejecuta:  node scripts/test_tz_localdatekey.cjs
// (para forzar la TZ de España:  set TZ=Europe/Madrid && node ...)
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');

// Cargar el helper REAL desde utils.js (sin arrastrar todo el archivo).
const src = fs.readFileSync('js/core/utils.js', 'utf8');
const m = src.match(/window\._cronosLocalDateKey = (function[\s\S]*?\n {4}\});/);
if (!m) { console.error('No se encontro _cronosLocalDateKey en utils.js'); process.exit(1); }
const _cronosLocalDateKey = eval('(' + m[1] + ')');

// Reproduce _getWeekMonday: lunes de la semana a medianoche LOCAL.
function getWeekMonday(offset) {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + (offset || 0) * 7);
  mon.setHours(0, 0, 0, 0);
  return mon;
}
const weekKeyBuggy = (d) => d.toISOString().substring(0, 10); // patrón antiguo

const monday = getWeekMonday(0);
const shownLocal = monday.getFullYear() + '-' +
  String(monday.getMonth() + 1).padStart(2, '0') + '-' +
  String(monday.getDate()).padStart(2, '0');
const fixed = _cronosLocalDateKey(monday);
const buggy = weekKeyBuggy(monday);
const tzMin = monday.getTimezoneOffset();

console.log('TZ (env):', process.env.TZ || '(sistema)');
console.log('getTimezoneOffset (min):', tzMin, tzMin < 0 ? '(UTC+, riesgo de bug)' : '(UTC/UTC-)');
console.log('Lunes local     :', monday.toString());
console.log('Mostrado (local):', shownLocal, '| FIXED:', fixed, '| BUGGY:', buggy);

let ok = true;
const assert = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) ok = false; };

assert('la clave FIXED coincide con el día mostrado', fixed === shownLocal);
if (tzMin < 0) {
  assert('en UTC+ la clave BUGGY se desplaza (bug reproducido)', buggy !== shownLocal);
  assert('FIXED corrige el desplazamiento del BUGGY', fixed !== buggy);
}
// Casos fijos deterministas (independientes de "hoy"):
assert('lunes 13-jul-2026 -> 2026-07-13', _cronosLocalDateKey(new Date(2026, 6, 13, 0, 0, 0, 0)) === '2026-07-13');
assert('domingo 1-mar-2026 -> 2026-03-01 (padding)', _cronosLocalDateKey(new Date(2026, 2, 1, 0, 0, 0, 0)) === '2026-03-01');
assert('fecha invalida -> cadena vacia', _cronosLocalDateKey('no-es-fecha') === '');

console.log(ok ? 'ALL_PASS' : 'SOME_FAIL');
process.exit(ok ? 0 : 1);

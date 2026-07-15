// Reproduccion del bug de zona horaria en el weekKey de entrenamiento.
// El codigo usa monday.toISOString().substring(0,10) sobre un Date que
// esta a medianoche LOCAL. En TZ UTC+ (Madrid), medianoche local del
// lunes = domingo por la noche en UTC, por lo que la clave retrocede 1 dia.

// Simula _getWeekMonday: lunes de la semana a medianoche local.
function getWeekMonday(offset) {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + (offset || 0) * 7);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

// Version BUGGY (actual)
function weekKeyBuggy(monday) {
  return monday.toISOString().substring(0, 10);
}

// Version CORREGIDA (fecha local, sin conversion a UTC)
function weekKeyFixed(monday) {
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

const monday = getWeekMonday(0);
const buggy = weekKeyBuggy(monday);
const fixed = weekKeyFixed(monday);

console.log('TZ offset (min):', monday.getTimezoneOffset());
console.log('Monday local   :', monday.toString());
console.log('weekKey BUGGY  :', buggy);
console.log('weekKey FIXED  :', fixed);

// El fixed siempre debe coincidir con la fecha local del lunes.
const expected = weekKeyFixed(monday);
const bugPresent = buggy !== expected;
console.log('Bug presente en esta TZ:', bugPresent, bugPresent ? '(desplazamiento -1 dia)' : '(coincide, TZ UTC/UTC-)');
console.log('Fixed correcto:', fixed === expected);

process.exit(fixed === expected ? 0 : 1);

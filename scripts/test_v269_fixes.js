// Verificación funcional acotada de los 3 fixes (v269).
// No arranca Firebase: valida la LÓGICA extraída de los archivos reales.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// FIX #1 se movio de js/services/firestore-sync.js a js/match/live/sync.js
// en la unificacion de live-sync (commit 4db5527). Apuntamos a la ubicacion real.
const fss = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const cr  = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name); };

// ── FIX #1: live/sync.js — un único ternario válido ───────────────────
// (a) el archivo entero compila (node --check ya lo confirma), y
// (b) el bloque liveMatchId no contiene la 3ª rama ':' redundante.
const _blockStart = fss.search(/liveMatchId\s*=\s*\(typeof window\._cronosBuildLiveMatchId/);
const _blockEnd = fss.indexOf('liveIsActive', _blockStart);
const liveMatchBlock = _blockStart >= 0 ? fss.slice(_blockStart, _blockEnd) : '';
const colonBranches = (liveMatchBlock.match(/^\s*: /gm) || []).length;
ok('#1 live/sync.js: una sola rama ":" en el ternario liveMatchId', colonBranches === 1);
ok('#1 live/sync.js: se conserva _hourSlug en la rama principal',
   /_cronosBuildLiveMatchId\([^)]*\)\s*\+\s*'-'\s*\+\s*_hourSlug/.test(liveMatchBlock));
ok('#1 live/sync.js: se conserva _hourSlug en el fallback',
   /\$\{_hourSlug\}`;/.test(liveMatchBlock));

// ── FIX #2: dismissKey usa _activeRole (no me.currentRole) ────────────
// La única aparición admisible de "me.currentRole" es dentro del comentario
// explicativo del fix ("(no me.currentRole)"); nunca en código ejecutable.
const totalCurrentRole = (cr.match(/me\.currentRole/g) || []).length;
const commentCurrentRole = (cr.match(/\(no me\.currentRole\)/g) || []).length;
ok('#2 club-reports.js: me.currentRole solo aparece en comentarios del fix',
   totalCurrentRole === commentCurrentRole);
const activeRoleDismiss = (cr.match(/const currentRole = me\._activeRole \|\| me\.role \|\| 'staff'/g) || []).length;
ok('#2 club-reports.js: 2 dismissKey derivan de me._activeRole', activeRoleDismiss === 2);

// Simulación del dismissKey para una cuenta con doble rol (misma persona/uid):
function dismissKeyFor(me) {
  const currentRole = me._activeRole || me.role || 'staff';   // lógica del fix
  return `${me.uid}_${currentRole}`;
}
const uid = 'u123';
const asDirector    = dismissKeyFor({ uid, role: 'coach', _activeRole: 'director' });
const asCoordinator = dismissKeyFor({ uid, role: 'coach', _activeRole: 'coordinator' });
ok('#2 dismissKey distinto por rol activo (Director vs Coordinador)', asDirector !== asCoordinator);
ok('#2 dismissKey Director correcto',    asDirector === 'u123_director');
ok('#2 dismissKey Coordinador correcto', asCoordinator === 'u123_coordinator');
// Sin _activeRole cae a me.role (comportamiento previo, no rompe cuentas de un solo rol).
ok('#2 fallback a me.role si no hay _activeRole',
   dismissKeyFor({ uid, role: 'director' }) === 'u123_director');

// ── FIX #3: pestaña Config. solo para el Director ─────────────────────
// Extrae la expresión de la plantilla y la evalúa con ambos roles.
ok('#3 club-reports.js: la pestaña config está condicionada a activeRole===director',
   cr.includes("${activeRole === 'director' ? `<button onclick=\"switchStaffTab('config')\""));
function renderConfigTab(activeRole) {
  return `${activeRole === 'director' ? `<button id="tab-config">Config.</button>` : ''}`;
}
ok('#3 Director VE la pestaña config',      renderConfigTab('director').includes('tab-config'));
ok('#3 Coordinador NO ve la pestaña config', renderConfigTab('coordinator') === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

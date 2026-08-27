// Verificación funcional acotada de los 3 fixes (v269).
// No arranca Firebase: valida la LÓGICA extraída de los archivos reales.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// FIX #1 se movio de js/services/firestore-sync.js a js/match/live/sync.js
// en la unificacion de live-sync (commit 4db5527). Apuntamos a la ubicacion real.
const fss = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
// ⚠️ IMPORTANTE: el monolito club-reports.js se descompuso (auditoría
// 2026-07-22, paso 5 de 6 el 2026-07-26) y el dismissKey del FIX #2 se fue a
// reports-tab.js. Si este test siguiera leyendo SOLO club-reports.js, su
// contador de me.currentRole bajaría a 0 y la aserción #2 se volvería VERDE
// sin que nada se hubiera arreglado: un falso verde que ocultaría la
// regresión. Se leen LOS DOS archivos para que siga describiendo la realidad.
const cr  = [
  ['js', 'coach', 'reports', 'club-reports.js'],
  ['js', 'coach', 'reports', 'reports-tab.js'],
].map(p => fs.readFileSync(path.join(ROOT, ...p), 'utf8')).join('\n');

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
//
// ⚠️ ANTES esto contaba una FRASE CONCRETA del comentario ("(no
//    me.currentRole)") y exigia que coincidiera con el total. Cualquiera que
//    reescribiera el comentario con otras palabras ponia el test en rojo sin
//    haber tocado el comportamiento — y eso es lo que lo mando a xfail.
//
// 🔑 Lo que de verdad importa es que NO QUEDE USO EJECUTABLE. Se quitan
//    comentarios y se mira lo que queda: mide la estructura, no la redaccion.
const _sinComentarios = cr
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
ok('#2 club-reports.js: me.currentRole no aparece en CODIGO EJECUTABLE',
   !/me\.currentRole/.test(_sinComentarios),
   'esa propiedad NO la escribe nadie en el proyecto: siempre es undefined, ' +
   'asi que cae a me.role (el rol de la RAIZ) y las cuentas multi-rol comparten dismissKey');
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
//
// ⚠️ AQUI HABIA TRES ASERCIONES Y SE RETIRAN, con motivo:
//
//  · Una buscaba una CADENA EXACTA del fuente
//    (`${activeRole === 'director' ? \`<button onclick="switchStaffTab('config')"`).
//    Esa plantilla ya no existe: la pestaña paso a ser un TABLERO construido
//    desde un array de opciones, y el permiso lo decide un PREDICADO UNICO
//    (`_sdCanSeeConfigTab`) que gobierna las DOS puertas —el boton y la ruta—
//    a proposito, para que no puedan divergir. La regla de producto sigue
//    viva; lo que murio fue la forma del codigo.
//
//  · Las otras dos evaluaban una REIMPLEMENTACION escrita aqui mismo
//    (`function renderConfigTab(activeRole) { ... }`). Eso no prueba nada del
//    producto: es el defecto que ya se pago en v620 —«mi test probaba una
//    copia de la logica escrita en el propio test»— y pasaba en verde
//    dijera lo que dijera club-reports.js.
//
// 🔑 LA COBERTURA NO SE PIERDE, MEJORA: `test_config_tab_director_only.js`
//    ejercita el predicado REAL con 34 aserciones (40/40 en verde), incluida
//    la ruta —no solo el boton—, que es justo lo que estas tres no miraban.
ok('#3 el permiso de "Config." lo decide un predicado UNICO, no la plantilla',
   /function _sdCanSeeConfigTab\(/.test(cr) && /window\._sdCanSeeConfigTab = _sdCanSeeConfigTab/.test(cr),
   'si esto cae, el boton y la ruta podrian calcular el permiso por separado y divergir');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// test_reglas_sustitucion.js
// ════════════════════════════════════════════════════════════════════
//  🟨 LÍMITES FEDERATIVOS DE SUSTITUCIÓN (v622)
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-08-24):
//   · F7, Infantil y FUTureFEM ......... cambios LIBRES
//   · Cadete ........................... 7 cambios · 3 ventanas · sin reingreso
//   · Juvenil, Regional, Regional FEM .. 5 cambios · 3 ventanas · sin reingreso
//   · El descanso da una ventana EXTRA, no consume ninguna de las tres.
//
//  🔑🔑 LO QUE MÁS IMPORTA AQUÍ ES EL ORDEN DE LAS CATEGORÍAS.
//  `'regionalfem'.includes('regional')` es TRUE y `'futurefem'` contiene
//  `fem`: este proyecto ya pagó ese fallo en SIETE cascadas (v511). La PARTE 1
//  fija que Regional FEM caiga en su grupo y que FUTureFEM siga libre pese a
//  ser F11 desde v538.
//
//  ⚠️ Y la PARTE 6 fija que el módulo NO lea el registro de movimientos. La
//  app apunta un «Sale (DESCANSO)» automático a todos los del campo: si eso
//  contara, un Cadete gastaría sus 7 cambios en el descanso sin hacer ninguno.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let n = 0, ok_ = 0, mal = 0;
function ok(nombre, cond, detalle) {
    n++;
    if (cond) { ok_++; console.log('  PASS  ' + nombre); }
    else { mal++; console.error('  FAIL  ' + nombre + (detalle ? ' -> ' + detalle : '')); }
}

const RAIZ = path.join(__dirname, '..');
const P_RULES = process.env.CRONOS_SUB_RULES || path.join(RAIZ, 'js/match/events/sub-rules.js');
const SRC_RULES  = fs.readFileSync(P_RULES, 'utf8');
const SRC_ACT    = fs.readFileSync(path.join(RAIZ, 'js/match/events/player-actions.js'), 'utf8');
const SRC_RENDER = fs.readFileSync(path.join(RAIZ, 'js/ui/render.js'), 'utf8');
const SRC_MOV    = fs.readFileSync(path.join(RAIZ, 'js/match/events/movement-log.js'), 'utf8');
const SRC_HTML   = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const SRC_SW     = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');

const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ACT = sinCom(SRC_ACT), RENDER = sinCom(SRC_RENDER), MOV = sinCom(SRC_MOV), RULES = sinCom(SRC_RULES);

// Carga el módulo con la categoría y la fase que se le indiquen.
function arranca(categoria, modalidad, fase, respuestaConfirm) {
    const confirms = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Math, JSON, String, Number, Object, Array, RegExp,
        confirm: (t) => { confirms.push(String(t)); return respuestaConfirm !== false; },
        document: { getElementById: () => null }
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC_RULES, sb);
    sb._currentMatchCategory = categoria;
    sb.currentMode = modalidad || 'f11';
    sb.matchPhase = fase || '1st_half';
    sb.CronosSubRules.reset();
    return { sb, R: sb.CronosSubRules, confirms };
}

console.log('=== TEST: limites federativos de sustitucion ===\n');

// ── PARTE 1 · 🔑 la clasificación, que es donde está la trampa ──────
console.log('PARTE 1 · a que grupo cae cada categoria');
const { R } = arranca('juvenil', 'f11');
const g = (cat, mod) => R.reglasDe(cat, mod).grupo;

ok('1a · Cadete',                g('cadete', 'f11') === 'cadete', g('cadete', 'f11'));
ok('1b · Juvenil',               g('juvenil', 'f11') === 'juvenil');
ok('1c · Regional',              g('regional', 'f11') === 'juvenil');
// ⚠️ LA TRAMPA: 'regionalfem' contiene 'regional'.
ok('1d · ⚠️ Regional FEM cae en su grupo, no en el de Regional por subcadena',
   g('regional_fem', 'f11') === 'juvenil' && g('Regional FEM A', 'f11') === 'juvenil');
// ⚠️ LA OTRA: 'futurefem' contiene 'fem' y es F11 desde v538, pero va LIBRE.
ok('1e · ⚠️ FUTureFEM sigue LIBRE aunque sea F11',
   g('futurefem', 'f11') === 'libre' && g('FUTureFEM A', 'f11') === 'libre');
ok('1f · Infantil, libre',       g('infantil', 'f11') === 'libre');
ok('1g · todo el Futbol 7, libre', g('cadete', 'f7') === 'libre' && g('juvenil', 'f7') === 'libre');
ok('1h · tildes y separadores no despistan',
   g('Cadete B', 'f11') === 'cadete' && g('juvenil_a', 'f11') === 'juvenil');
// ⚠️ Sin categoria legible NO se limita: un aviso falso es peor que ninguno.
ok('1i · ⚠️ una categoria que no se reconoce NO se limita',
   g('', 'f11') === 'libre' && g('lo que sea', 'f11') === 'libre');

// ── 1j/1k · ESTRUCTURALES, y se dice que lo son ─────────────────────
//  El red-check demostró que 1d y 1e pasan IGUAL si se borran las dos ramas
//  explícitas: Regional FEM comparte régimen con Regional, y FUTureFEM cae en
//  el LIBRE por defecto. O sea que el comportamiento no las necesita HOY. Se
//  fijan aparte, y como lo que son —estructura, no conducta—, para que el día
//  que uno de los dos cambie de régimen la red siga puesta y nadie la retire
//  creyendo que sobra.
ok('1j · [estructural] existe la rama explicita de Regional FEM, antes que la de Regional',
   RULES.indexOf("indexOf('regionalfem')") !== -1 &&
   RULES.indexOf("indexOf('regionalfem')") < RULES.indexOf("if (c.indexOf('regional') !== -1) return"),
   'hoy no cambia el resultado; el dia que difieran, si');
ok('1k · [estructural] FUTureFEM se resuelve explicitamente y no por el defecto',
   RULES.indexOf("indexOf('futurefem')") !== -1);

console.log('\nPARTE 2 · los topes de cada grupo');
ok('2a · Cadete: 7 cambios y 3 ventanas',
   R.reglasDe('cadete', 'f11').maxCambios === 7 && R.reglasDe('cadete', 'f11').maxVentanas === 3);
ok('2b · Juvenil: 5 cambios y 3 ventanas',
   R.reglasDe('juvenil', 'f11').maxCambios === 5 && R.reglasDe('juvenil', 'f11').maxVentanas === 3);
ok('2c · el grupo libre no tiene topes', R.reglasDe('infantil', 'f11').ilimitado === true);

// ── PARTE 3 · cambios y ventanas ────────────────────────────────────
console.log('\nPARTE 3 · cuantos cambios y cuantas ventanas');
{
    const t = arranca('juvenil', 'f11', '1st_half');
    // 3 cambios individuales = 3 ventanas (decision suya: cada uno la suya).
    t.R.registrar('home', ['s1'], ['e1']);
    t.R.registrar('home', ['s2'], ['e2']);
    t.R.registrar('home', ['s3'], ['e3']);
    const st = t.R.estado('home');
    ok('3a · tres cambios individuales gastan tres ventanas',
       st.cambios === 3 && st.ventanasEnJuego === 3, JSON.stringify(st));
    // La cuarta ventana en juego ya avisa.
    const v = t.R.evaluar('home', ['s4'], ['e4']);
    ok('3b · la cuarta ventana con el juego en marcha avisa',
       !v.ok && v.avisos.some(a => /ventanas/.test(a)), JSON.stringify(v.avisos));
}
{
    const t = arranca('cadete', 'f11', '1st_half');
    // Un GRUPAL de 3 es UNA ventana y TRES cambios.
    t.R.registrar('home', ['s1', 's2', 's3'], ['e1', 'e2', 'e3']);
    const st = t.R.estado('home');
    ok('3c · 🔑 un cambio grupal de tres es UNA ventana y TRES cambios',
       st.cambios === 3 && st.ventanasEnJuego === 1, JSON.stringify(st));
}
{
    const t = arranca('juvenil', 'f11', '1st_half');
    for (let i = 0; i < 5; i++) t.R.registrar('home', ['s' + i], ['e' + i], { descanso: true });
    const st = t.R.estado('home');
    ok('3d · 🔑 en el DESCANSO no se consume ninguna de las tres ventanas',
       st.ventanasEnJuego === 0 && st.ventanaDescansoUsada === true, JSON.stringify(st));
    ok('3e · …y aun asi los cambios cuentan', st.cambios === 5);
    // Con las 3 en juego gastadas, la del descanso sigue disponible.
    const t2 = arranca('cadete', 'f11', 'break');
    t2.R.registrar('home', ['a'], ['b'], { descanso: false });
    t2.R.registrar('home', ['c'], ['d'], { descanso: false });
    t2.R.registrar('home', ['e'], ['f'], { descanso: false });
    const v2 = t2.R.evaluar('home', ['g'], ['h'], { descanso: true });
    ok('3f · 🔑 gastadas las tres, la del descanso SIGUE disponible',
       v2.ok === true, JSON.stringify(v2.avisos));
}
{
    const t = arranca('juvenil', 'f11', '1st_half');
    for (let i = 0; i < 5; i++) t.R.registrar('home', ['s' + i], ['e' + i], { descanso: true });
    const v = t.R.evaluar('home', ['s9'], ['e9'], { descanso: true });
    ok('3g · el sexto cambio de un Juvenil avisa',
       !v.ok && v.avisos.some(a => /5 cambios/.test(a)), JSON.stringify(v.avisos));
}
{
    const t = arranca('infantil', 'f11', '1st_half');
    for (let i = 0; i < 20; i++) t.R.registrar('home', ['s' + i], ['e' + i]);
    ok('3h · en el grupo libre no se avisa nunca', t.R.evaluar('home', ['x'], ['y']).ok === true);
}
// ⚠️ Los dos equipos llevan cuentas SEPARADAS.
{
    const t = arranca('juvenil', 'f11', '1st_half');
    t.R.registrar('home', ['s1'], ['e1']);
    ok('3i · ⚠️ el rival lleva su propia cuenta',
       t.R.estado('away').cambios === 0 && t.R.estado('home').cambios === 1);
}

// ── PARTE 4 · el reingreso ──────────────────────────────────────────
console.log('\nPARTE 4 · quien sale no vuelve');
{
    const t = arranca('cadete', 'f11', '1st_half');
    t.R.registrar('home', ['JUAN'], ['PEDRO']);
    const v = t.R.evaluar('home', ['PEDRO'], ['JUAN'], { nombreDe: () => 'JUAN' });
    ok('4a · 🔑 el que salio no puede volver a entrar',
       !v.ok && v.avisos.some(a => /no puede volver a entrar/.test(a)), JSON.stringify(v.avisos));
    ok('4b · y se le dice por su nombre', v.avisos.some(a => /JUAN/.test(a)));
    const v2 = t.R.evaluar('home', ['OTRO'], ['NUEVO'], {});
    ok('4c · quien no ha salido entra sin aviso', v2.ok === true);
}
{
    const t = arranca('infantil', 'f11', '1st_half');
    t.R.registrar('home', ['JUAN'], ['PEDRO']);
    ok('4d · en el grupo libre SI puede volver', t.R.evaluar('home', ['PEDRO'], ['JUAN']).ok === true);
}

// ── PARTE 5 · avisa, NO bloquea ─────────────────────────────────────
console.log('\nPARTE 5 · avisa y deja decidir (el arbitro manda)');
{
    const t = arranca('juvenil', 'f11', '1st_half');
    for (let i = 0; i < 5; i++) t.R.registrar('home', ['s' + i], ['e' + i], { descanso: true });
    const sigue = t.R.confirmarYRegistrar('home', ['x'], ['y'], () => 'X');
    ok('5a · 🔑 si el usuario acepta, el cambio SE HACE', sigue === true);
    ok('5b · …y se le ha avisado', t.confirms.length === 1 && /Normativa/.test(t.confirms[0]));
    ok('5c · ⚠️ y el cambio de mas SE REGISTRA igual (el acta refleja lo que paso)',
       t.R.estado('home').cambios === 6, JSON.stringify(t.R.estado('home')));
}
{
    const t = arranca('juvenil', 'f11', '1st_half', false);   // el usuario cancela
    for (let i = 0; i < 5; i++) t.R.registrar('home', ['s' + i], ['e' + i], { descanso: true });
    const sigue = t.R.confirmarYRegistrar('home', ['x'], ['y'], () => 'X');
    ok('5d · si cancela, el cambio NO se hace', sigue === false);
    ok('5e · …y no se apunta nada', t.R.estado('home').cambios === 5);
}
{
    const t = arranca('infantil', 'f11', '1st_half');
    const sigue = t.R.confirmarYRegistrar('home', ['x'], ['y'], () => 'X');
    ok('5f · en el grupo libre no se pregunta nada', sigue === true && t.confirms.length === 0);
}

// ── PARTE 6 · ⚠️ lo que NO cuenta, y donde se engancha ──────────────
console.log('\nPARTE 6 · el cableado y lo que NO debe contar');
// 🔑 El modulo NO lee el historial de movimientos: si lo leyera, los
//    «Sale (DESCANSO)» automaticos gastarian el cupo sin que nadie sustituyera.
ok('6a · ⚠️ el modulo NO lee el registro de movimientos',
   !/\.history\b/.test(RULES) && !/logMovement/.test(RULES),
   'contaria los Sale (DESCANSO) automaticos como cambios');
ok('6b · el cambio individual lo consulta',
   /confirmSubstitutionWith[\s\S]{0,600}CronosSubRules\.confirmarYRegistrar/.test(ACT));
ok('6c · el cambio grupal lo consulta',
   /executeGroupSubstitution[\s\S]{0,900}CronosSubRules\.confirmarYRegistrar/.test(RENDER));
// ⚠️ Si se cancela, no puede quedarse a medias.
ok('6d · ⚠️ al cancelar el grupal no se ejecuta ningun swap',
   /confirmarYRegistrar[\s\S]{0,500}return;[\s\S]{0,300}handleSmartSwap/.test(RENDER),
   'el return tiene que ir ANTES del bucle de swaps');
ok('6e · reiniciar el partido pone el cupo a cero',
   /CronosSubRules\.reset\(\)/.test(MOV), 'si no, la jornada siguiente arranca sin cambios');
ok('6f · el modulo se carga en index.html', /js\/match\/events\/sub-rules\.js/.test(SRC_HTML));
// ⚠️ Se comparan las posiciones de las ETIQUETAS <script>, no de la cadena
//    suelta: MI PROPIO COMENTARIO encima del tag nombra player-actions.js
//    para explicar por que va antes, y eso ponia la asercion en rojo con el
//    orden correcto. Enesima vez que un comentario propio falsea una medida.
const _posTag = (f) => SRC_HTML.search(new RegExp('<script src="js/[^"]*' + f.replace('.', '\\.')));
ok('6g · …antes que player-actions.js',
   _posTag('sub-rules.js') !== -1 && _posTag('player-actions.js') !== -1 &&
   _posTag('sub-rules.js') < _posTag('player-actions.js'),
   'sub-rules@' + _posTag('sub-rules.js') + ' player-actions@' + _posTag('player-actions.js'));
ok('6h · y esta en el precache del Service Worker',
   /'\.\/js\/match\/events\/sub-rules\.js'/.test(SRC_SW));
// Las dos puertas lo llaman con guarda: sin el modulo, la app sigue igual.
ok('6i · ⚠️ las dos puertas usan guarda typeof (sin el modulo no se rompe nada)',
   /typeof window\.CronosSubRules\.confirmarYRegistrar === 'function'/.test(ACT) &&
   /typeof window\.CronosSubRules\.confirmarYRegistrar === 'function'/.test(RENDER));

console.log('\n------------------------------------------------------------');
console.log('Resultado: ' + ok_ + '/' + n + ' pruebas superadas.');
process.exit(mal > 0 ? 1 : 0);

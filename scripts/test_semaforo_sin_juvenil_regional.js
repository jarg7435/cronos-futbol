// ─────────────────────────────────────────────────────────────────────────
// test_semaforo_sin_juvenil_regional.js · Juvenil, Regional y Regional FEM
// SIEMPRE en celeste, en todas las vistas (v559)
//
// Reporte del autor (capturas 9056, 9059 y 9060): en el partido de Regional A
// los círculos del cronómetro seguían saliendo en amarillo y rojo. Juvenil,
// Regional y Regional FEM no llevan semáforo — lo dice hasta su panel de
// configuración, donde esos dos grupos ni siquiera tienen interruptor
// (`hasSemaforo: false` en js/coach/reports/director-config.js).
//
// 🔑🔑🔑 LA REGLA ESTABA ESCRITA CUATRO VECES —app-init.js, live.html,
// replay-player.js y sync.js— y las cuatro la deducían de UN grupo calculado
// con `getCategoryGroupKey` a partir de UNA sola cascada de categoría. Ahí está
// el fallo: **cuando la cascada se queda vacía, el grupo por defecto SÍ tiene
// semáforo** — `'infantil_a'` en utils.js y `'f7'` en la copia de live.html:
// dos defectos distintos para la misma entrada. Cualquier hueco en la cadena
// pintaba un Regional de rojo.
//
// Y los huecos existen: el visor decidía con `data.category` (la categoría del
// PERFIL del entrenador) e ignoraba `data.matchCategory`, que es la del PARTIDO
// y la que el panel de creación fija siempre.
//
// LO QUE FIJA ESTE GUARD:
//   A · la regla va AL REVÉS y es tajante: no "¿en qué grupo cae?" sino
//       "¿alguna señal dice Juvenil o Regional?". Un hueco ya no enciende el
//       semáforo: habría que fallar TODAS las señales.
//   B · ⚠️ VERIFICACIÓN POR EQUIVALENCIA entre las DOS implementaciones (la de
//       utils.js y la copia de live.html, que no puede cargar utils.js). Misma
//       tabla de entradas, mismo resultado. Es lo único que impide que la copia
//       se quede atrás.
//   C · y que la regla llega de verdad al color en las TRES vistas: el campo
//       del entrenador, el visor en vivo y la repetición.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const UTILS   = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');
const APPINIT = fs.readFileSync(path.join(ROOT, 'js', 'core', 'app-init.js'), 'utf8');
const LIVE    = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const REPLAY  = fs.readFileSync(path.join(ROOT, 'js', 'match', 'replay', 'replay-player.js'), 'utf8');
const SYNC    = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const DIRCFG  = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'reports', 'director-config.js'), 'utf8');

const CELESTE = '#79c0ff';

console.log('── Juvenil, Regional y Regional FEM: celeste SIEMPRE (v559) ──\n');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 1 · la regla canónica, ejecutada
// ═══════════════════════════════════════════════════════════════════════
console.log('── PARTE 1 · la regla, ejecutada ──');

// utils.js entero no se puede evaluar sin DOM; se extrae la función canónica
// junto a la ayuda de acentos de la que depende.
function _fnDe(src, cabecera, cierre) {
    const i = src.indexOf(cabecera);
    if (i < 0) throw new Error('No se encontró ' + cabecera);
    const j = src.indexOf(cierre, i);
    if (j < 0) throw new Error('No se encontró el cierre de ' + cabecera);
    return src.slice(i, j + cierre.length);
}

const FUENTE_CANONICA =
    _fnDe(UTILS, 'function _cronosNoEsAcento(caracter) {', '\n}') + '\n' +
    _fnDe(UTILS, "if (typeof window.cronosCategoriaSinSemaforo !== 'function') {", '\n}\n');

const FUENTE_LIVE = _fnDe(LIVE, 'function _sinSemaforoLive() {', '\n}');

function montar(fuente, nombre) {
    const sb = { console: { log() {}, warn() {} }, String, Number };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(fuente, sb);
    const fn = sb.window[nombre] || sb[nombre];
    if (typeof fn !== 'function') throw new Error('No quedó definida ' + nombre);
    return fn;
}

const sinSemCanonica = montar(FUENTE_CANONICA, 'cronosCategoriaSinSemaforo');
const sinSemLive     = montar(FUENTE_LIVE, '_sinSemaforoLive');

// ⚠️ LA TABLA ES EL CONTRATO. Recoge las formas REALES con las que la categoría
// llega en este proyecto: la del perfil ('regional'), la del panel de creación
// ('f11_regional', que lleva el prefijo de modalidad), con acento, en
// mayúsculas y las dos femeninas.
const TABLA = [
    // [entradas, sinSemaforo, por qué]
    [['regional'],                 true,  'la categoría del perfil'],
    [['f11_regional'],             true,  'la del panel de creación, con prefijo de modalidad'],
    [['f7_regional'],              true,  'Regional en Fútbol 7 tampoco lleva semáforo'],
    [['Regional'],                 true,  'mayúsculas'],
    [['regional_fem'],             true,  '🩷 Regional FEM entra por "regional"'],
    [['f11_regional_fem'],         true,  'Regional FEM del panel'],
    [['juvenil'],                  true,  'Juvenil'],
    [['f11_juvenil'],              true,  'Juvenil del panel'],
    [['Juvenil B'],                true,  'con subcategoría pegada'],
    [['senior'],                   true,  'Senior comparte grupo con Regional'],
    [['aficionado'],               true,  'Aficionado, igual'],
    [['amateur'],                  true,  'Amateur, igual'],
    [['alevin'],                   false, 'Alevín SÍ lleva semáforo'],
    [['f7_alevin'],                false, 'Alevín del panel'],
    [['infantil'],                 false, 'Infantil SÍ'],
    [['f11_cadete'],               false, 'Cadete SÍ'],
    [['futurefem'],                false, '⚠️ FUTureFEM SÍ lleva (grupo f7), no confundir con Regional FEM'],
    [['prebenjamín'],              false, 'con acento'],
    [[''],                         false, 'vacío: no se puede afirmar que sea Juvenil/Regional'],
    [[null],                       false, 'nulo'],
    [[undefined, null, ''],        false, 'todo vacío'],
    // 🔑 EL CASO DEL REPORTE: el perfil viene vacío y sólo la categoría del
    // PARTIDO dice la verdad. Antes de v559 esto acababa en rojo.
    [['f11_regional', ''],         true,  '🔑 perfil vacío, pero el partido dice Regional'],
    [['', 'regional'],             true,  '🔑 y al revés: partido vacío, perfil Regional'],
    [['f11_infantil', 'regional'], true,  '⚠️ con que UNA señal lo diga, es celeste'],
    [['f7_alevin', ''],            false, 'y un Alevín no se vuelve celeste por tener huecos'],
];

let equivalentes = true, correctas = true;
const desviaciones = [];
TABLA.forEach(([entradas, esperado, motivo]) => {
    const a = sinSemCanonica.apply(null, entradas);
    const b = sinSemLive.apply(null, entradas);
    if (a !== b) { equivalentes = false; desviaciones.push('DIVERGEN ' + JSON.stringify(entradas) + ': utils=' + a + ' live=' + b); }
    if (a !== esperado) { correctas = false; desviaciones.push('MAL ' + JSON.stringify(entradas) + ' → ' + a + ' (se esperaba ' + esperado + ': ' + motivo + ')'); }
});

ok('1a · 🔑 la regla acierta en las ' + TABLA.length + ' formas reales de la categoría',
   correctas, desviaciones.join('\n       '));
ok('1b · ⚠️⚠️ VERIFICACIÓN POR EQUIVALENCIA: utils.js y la copia de live.html dicen LO MISMO',
   equivalentes,
   'live.html no puede cargar utils.js (v454); si las dos divergen, el visor pinta otra cosa que el campo');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 2 · el color, en las tres vistas
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · el color que sale de verdad ──');

// ── 2.1 · el campo del entrenador (getTimerColor, app-init.js) ──
{
    const FUENTE = _fnDe(APPINIT, 'function getTimerColor(timeSec, matchCategory, matchSubcategory) {', '\n}');

    function color(opts) {
        const sb = {
            console: { log() {}, warn() {} }, Number, String, isNaN, parseInt,
            document: { getElementById: (id) => (opts.dom && opts.dom[id]) ? { value: opts.dom[id] } : null },
        };
        sb.window = sb;
        sb.window._cronosCurrentUser = opts.me || {};
        sb.window._currentMatchCategory = opts.currentCat || '';
        sb.window._clubCategoryConfigs = opts.configs || {};
        vm.createContext(sb);
        vm.runInContext(FUENTE_CANONICA + '\n' +
                        (opts.sinGroupKey ? '' : _fnDe(UTILS, "if (typeof window.getCategoryGroupKey !== 'function') {", '\n}\n')) + '\n' +
                        'var currentMode = "f11"; var half1MaxTime = 2700, half2MaxTime = 2700;\n' +
                        FUENTE, sb);
        return vm.runInContext('getTimerColor(' + Number(opts.t || 60) + ')', sb);
    }

    // El caso del reporte: Regional A, el jugador lleva 1 minuto (rojo si hay
    // semáforo).
    ok('2a · 🔑🔑🔑 Regional en el campo del entrenador → CELESTE (captura 9056)',
       color({ currentCat: 'f11_regional', me: { category: 'regional' } }).bg === CELESTE,
       JSON.stringify(color({ currentCat: 'f11_regional', me: { category: 'regional' } })));

    ok('2b · Juvenil, igual (captura 9059)',
       color({ currentCat: 'f11_juvenil', me: { category: 'juvenil' } }).bg === CELESTE);

    ok('2c · Regional FEM, igual',
       color({ currentCat: 'f11_regional_fem', me: { category: 'regional_fem' } }).bg === CELESTE);

    // 🔑 EL HUECO QUE PRODUCÍA EL ROJO: sin categoría de partido resuelta,
    // `getCategoryGroupKey('')` devuelve 'infantil_a', que SÍ tiene semáforo.
    ok('2d · 🔑 con la categoría del PARTIDO vacía, la del perfil salva el celeste',
       color({ currentCat: '', me: { category: 'regional' } }).bg === CELESTE,
       'antes caía en el grupo por defecto "infantil_a" y salía rojo');

    ok('2e · ⚠️ y un Alevín SIGUE con semáforo (no se ha apagado de más)',
       color({ currentCat: 'f7_alevin', me: { category: 'alevin' }, t: 60 }).bg !== CELESTE,
       JSON.stringify(color({ currentCat: 'f7_alevin', me: { category: 'alevin' }, t: 60 })));
}

// ── 2.2 · el visor en vivo (_timerColorFor, live.html) ──
{
    const FUENTE = _fnDe(LIVE, 'function _timerColorFor(timeSec, data) {', '\n}');

    function colorLive(data, t) {
        const sb = { console: { log() {}, warn() {} }, String, Number, isNaN };
        sb.window = sb;
        vm.createContext(sb);
        vm.runInContext(FUENTE_LIVE + '\n' + FUENTE, sb);
        return vm.runInContext('_timerColorFor(' + Number(t || 60) + ', ' + JSON.stringify(data) + ')', sb);
    }

    ok('2f · 🔑🔑🔑 Regional en el VISOR → celeste',
       colorLive({ category: 'regional', mode: 'f11' }).bg === CELESTE);
    ok('2g · Juvenil y Regional FEM, igual',
       colorLive({ category: 'juvenil', mode: 'f11' }).bg === CELESTE &&
       colorLive({ category: 'regional_fem', mode: 'f11' }).bg === CELESTE);

    // 🔑 EL HUECO REAL DEL VISOR: sólo miraba `category`. Con el perfil vacío,
    // su respaldo local devolvía 'f7' — un grupo CON semáforo.
    ok('2h · 🔑🔑🔑 con `category` vacía, manda `matchCategory` (era el rojo del Regional A)',
       colorLive({ category: '', matchCategory: 'f11_regional', mode: 'f11' }).bg === CELESTE,
       JSON.stringify(colorLive({ category: '', matchCategory: 'f11_regional', mode: 'f11' })));

    ok('2i · la bandera `semaforoActive:false` del documento sigue mandando',
       colorLive({ category: 'alevin', semaforoActive: false, mode: 'f7' }).bg === CELESTE);

    ok('2j · ⚠️ y un Alevín del visor SIGUE con semáforo',
       colorLive({ category: 'alevin', mode: 'f7', half1MaxTime: 2100, half2MaxTime: 2100 }, 60).bg !== CELESTE);
}

// ── 2.3 · la repetición ──
ok('2k · la REPETICIÓN aplica la misma regla, y por los DOS orígenes',
   /window\.cronosCategoriaSinSemaforo \|\| window\._sinSemaforoLive/.test(REPLAY) &&
   /_sinSem\(data\.matchCategory, cat\)/.test(REPLAY),
   'se carga en index.html (utils.js) y dentro de live.html (que publica su copia)');

ok('2l · ⚠️ y va DELANTE de `semaforoActive === true`',
   REPLAY.indexOf('_sinSem(data.matchCategory, cat)') <
   REPLAY.indexOf('else if (data.semaforoActive === true)'),
   'los partidos grabados antes de v559 pudieron persistir ese flag mal');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 3 · el flag que viaja en el documento
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · lo que se persiste con el partido ──');

ok('3a · 🔑 `semaforoActive` se calcula con las DOS categorías, no sólo con la del perfil',
   /cronosCategoriaSinSemaforo\(_matchCat, snapCat\)/.test(SYNC),
   'es la primera puerta que mira el visor: acertar aquí deja el partido celeste en todas las pantallas');

ok('3b · el documento lleva su `teamId` (club + categoría + subcategoría)',
   /teamId: \(typeof cronosTeamId === 'function'\)/.test(SYNC),
   'deja escrita la pertenencia del partido en el propio dato');

ok('3c · ⚠️ y nunca como `undefined` (un undefined en un payload de Firestore LANZA)',
   /cronosTeamId\([\s\S]{0,400}\) \|\| null\)/.test(SYNC) && /: null,/.test(SYNC));

// El panel del Director ya declaraba la regla: los dos grupos sin interruptor.
ok('3d · el panel del Director sigue declarando Juvenil y Regional SIN semáforo',
   /key: 'juvenil',[^\n]*hasSemaforo: false/.test(DIRCFG) &&
   /key: 'regional',[^\n]*hasSemaforo: false/.test(DIRCFG),
   'es la misma regla que el autor ve en la captura 9060');

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

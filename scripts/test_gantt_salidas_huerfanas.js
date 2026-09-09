// ═══════════════════════════════════════════════════════════════════════════
// GUARD · implementar.txt del 2026-09-09 — el Gantt de los informes individuales
// ═══════════════════════════════════════════════════════════════════════════
//   «En varias líneas de tiempo aparece una marca roja de "Sale" aislada, sin
//    una entrada correspondiente o al final de periodos (descanso, fin de
//    partido), lo que deja una línea vertical roja flotando incorrectamente.»
//
//   Requisito: una marca de salida SÓLO se pinta si cierra un bloque azul de
//   juego. Ninguna línea roja suelta, sin su delimitador de bloque.
//
// 🔑 LA CAUSA no es de pintado, es de RECONSTRUCCIÓN: `_buildTimeline`
// (js/parent/panel.js) arranca con `inField = false` SIEMPRE, así que a un
// TITULAR —cuyo historial no lleva ningún apunte de entrada, porque nadie
// escribe 'starter' en toda la app— su única salida no le cierra nada: no hay
// barra azul, la marca roja queda flotando sobre el banquillo y encima la
// tarjeta dice «23'55" tiempo jugado» con la línea entera en gris.
//
// El motor del entrenador (js/coach/reports/report-engine.js, buildIvs) ya lo
// resolvió en v425 con la regla AIRTIGHT: si la PRIMERA transición registrada
// es una SALIDA, forzosamente estabas en el campo. Este guard exige la misma
// regla en el panel de familias, y comprueba el resultado EJECUTANDO el
// generador real y midiendo el SVG que pinta.
//
// Se mide sobre los cuatro partidos de las capturas 10204-10207 (los tiempos
// jugados de las tarjetas cuadran al segundo con los intervalos que salen de
// aplicar la regla, y ésa es la prueba de que la regla es la correcta).
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');

let fallos = 0, total = 0;
function ok(nombre, cond, extra) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); if (extra !== undefined) console.log('      ' + extra); fallos++; }
}

const PANEL = leer('js/parent/panel.js');

// ── Cargar el generador real ────────────────────────────────────────────────
// `_buildTimeline` es un `const` dentro de la función del panel: no se expone
// en window. Se extrae el bloque de ayudantes de tiempo + la función y se
// ejecuta en un sandbox, igual que test_v426_informes.js hace con buildIvs.
function cargarBuildTimeline() {
    const ini = PANEL.indexOf('const _mmssToSec = (str) =>');
    const marca = PANEL.indexOf('return { svg, events, periods, playedSec };', ini);
    if (ini < 0 || marca < 0) throw new Error('no se encuentra _buildTimeline en js/parent/panel.js');
    const fin = PANEL.indexOf('\n            };', marca) + '\n            };'.length;
    const sb = { Math, Array, Object, String, Number, JSON, Date, Map, Set, parseInt, parseFloat, isNaN, isFinite, console };
    vm.createContext(sb);
    // El bloque arrastra las estadísticas acumuladas, que leen `reports`.
    vm.runInContext('const reports = [];\n' + PANEL.slice(ini, fin) + '\nthis.__bt = _buildTimeline;', sb);
    return sb.__bt;
}

let buildTimeline;
console.log('\n── PARTE 0 · carga ──');
{
    let bien = true;
    try { new vm.Script(PANEL); } catch (e) { bien = false; console.log('      ' + e.message); }
    ok('0a · js/parent/panel.js parsea', bien);
    try { buildTimeline = cargarBuildTimeline(); } catch (e) { console.log('      ' + e.message); }
    ok('0b · _buildTimeline se puede ejecutar', typeof buildTimeline === 'function');
}
if (typeof buildTimeline !== 'function') { console.log('\n💥 sin generador, no se puede medir\n'); process.exit(1); }

// ── Lectura del SVG que se pinta ────────────────────────────────────────────
const AZUL = '#58a6ff', VERDE = '#3fb950', ROJO = '#ff5858';

// Bloques de juego pintados (rect azul) → [{x, x2}]
function bloques(svg) {
    const out = [];
    const re = /<rect x="([-\d.]+)"[^>]*?width="([-\d.]+)"[^>]*?fill="#58a6ff"/g;
    let m;
    while ((m = re.exec(svg))) out.push({ x: parseFloat(m[1]), x2: parseFloat(m[1]) + parseFloat(m[2]) });
    return out;
}
// Marcas verticales de sustitución → [{x, col}]
function marcas(svg) {
    const out = [];
    const re = /<line x1="([-\d.]+)"[^>]*?stroke="(#3fb950|#ff5858)"/g;
    let m;
    while ((m = re.exec(svg))) out.push({ x: parseFloat(m[1]), col: m[2] });
    return out;
}
const cerca = (a, b) => Math.abs(a - b) < 0.6;   // el SVG redondea a 1 decimal

// Toda marca roja tiene que caer en el BORDE DERECHO de un bloque azul, y toda
// verde en el izquierdo. Es la definición literal de «no hay líneas huérfanas».
function huerfanas(svg) {
    const bl = bloques(svg);
    return marcas(svg).filter(mk => mk.col === ROJO
        ? !bl.some(b => cerca(mk.x, b.x2))
        : !bl.some(b => cerca(mk.x, b.x)));
}
const dur = ps => ps.reduce((s, p) => s + (p.endSec - p.startSec), 0);
const ev = (type, mmss, note) => {
    const [m, s] = String(mmss).split(':').map(Number);
    return { type, minute: m, second: s || 0, note: note || '' };
};

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · 🔑 el TITULAR sin apunte de entrada (capturas 10205 y 10206) ──');
// ═══════════════════════════════════════════════════════════════════════════
// Captura 10206 · «vs VISITANTE 4-1» · 23'55" tiempo jugado · un solo suceso:
//   23'55" ▲ CAMBIO·Sale — «Sale a las 23:55 (1ªP)»
// Hoy: cero bloques azules, línea roja flotando sobre BANQUILLO y la tarjeta
// diciendo que jugó 23'55". Debe ser un bloque 0'→23'55" cerrado por la salida.
{
    const r = { _id: 'cap10206', minutesPlayed: '23:55',
                history: [ev('sub_out', '23:55', 'Sale a las 23:55 (1ªP)')] };
    const t = buildTimeline(r);
    ok('1a · la salida cierra un bloque de juego', t.periods.length === 1,
        'periods=' + JSON.stringify(t.periods));
    ok('1b · el bloque arranca en el minuto 0 (era titular)',
        t.periods.length === 1 && t.periods[0].startSec === 0, JSON.stringify(t.periods));
    ok('1c · el bloque dura lo que dice la tarjeta (23\'55")',
        dur(t.periods) === 1435, 'duración=' + dur(t.periods));
    ok('1d · ninguna línea roja suelta', huerfanas(t.svg).length === 0,
        JSON.stringify(huerfanas(t.svg)) + ' bloques=' + JSON.stringify(bloques(t.svg)));
    ok('1e · el suceso sigue en la lista cronológica', t.events.length === 1);
}
// Captura 10205 · «vs VISITANTE 2-1» · 3'17" · un solo «Sale a las 03:17 (1ªP)».
{
    const r = { _id: 'cap10205', minutesPlayed: '3:17',
                history: [ev('sub_out', '3:17', 'Sale a las 03:17 (1ªP) #C4')] };
    const t = buildTimeline(r);
    ok('1f · 10205 · bloque 0\'→3\'17" y sin marcas huérfanas',
        dur(t.periods) === 197 && huerfanas(t.svg).length === 0,
        'periods=' + JSON.stringify(t.periods) + ' huérfanas=' + JSON.stringify(huerfanas(t.svg)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · el titular que vuelve a entrar (captura 10204) ──');
// ═══════════════════════════════════════════════════════════════════════════
// «vs VISITANTE 2-2» · 4'57" tiempo jugado:
//   3'22" Sale (1ªP) · 9'10" Entra (2ªP) · 10'31" GOL · 10'45" Sale (FIN)
// 0'→3'22" (202s) + 9'10"→10'45" (95s) = 297s = 4'57" EXACTOS. Que el total
// cuadre al segundo con la tarjeta es la prueba de que la regla es la buena.
{
    const r = { _id: 'cap10204', minutesPlayed: '4:57', history: [
        ev('sub_out', '3:22',  'Sale a las 03:22 (1ªP)'),
        ev('sub_in',  '9:10',  'Entra a las 09:10 (2ªP) #C6'),
        ev('goal',    '10:31', 'GOL (1º) a las 10:31 (2ªP)'),
        ev('sub_out', '10:45', 'Sale a las 10:45 (FIN)'),
    ] };
    const t = buildTimeline(r);
    ok('2a · dos bloques de juego', t.periods.length === 2, JSON.stringify(t.periods));
    ok('2b · el total cuadra con el tiempo jugado de la tarjeta (4\'57")',
        dur(t.periods) === 297, 'duración=' + dur(t.periods));
    ok('2c · ninguna marca suelta', huerfanas(t.svg).length === 0,
        JSON.stringify(huerfanas(t.svg)));
    ok('2d · la lista cronológica conserva los 4 sucesos', t.events.length === 4);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · el paso por el DESCANSO no parte el bloque ──');
// ═══════════════════════════════════════════════════════════════════════════
// Captura 10205 (primera tarjeta) · 2'29":
//   2'33" Entra · 4'15" Sale (DESCANSO) · 4'15" Entra (2ªP) · 5'02" Sale (FIN)
// El «Sale (DESCANSO)» y el «Entra (2ªP)» llevan el MISMO sello de tiempo (los
// dos salen de masterTimeH1): son contabilidad de fase, no un cambio. Pintarlos
// mete una raya roja EN MEDIO del bloque azul, que es el otro caso que señala
// el encargo («al final de periodos, como descanso o final de partido»).
{
    const r = { _id: 'descanso', minutesPlayed: '2:29', history: [
        ev('sub_in',  '2:33', 'Entra a las 02:33 (1ªP)'),
        ev('sub_out', '4:15', 'Sale a las 04:15 (DESCANSO)'),
        ev('sub_in',  '4:15', 'Entra a las 04:15 (2ªP)'),
        ev('sub_out', '5:02', 'Sale a las 05:02 (FIN)'),
    ] };
    const t = buildTimeline(r);
    ok('3a · un solo bloque continuo 2\'33"→5\'02"', t.periods.length === 1,
        JSON.stringify(t.periods));
    ok('3b · el total cuadra con la tarjeta (2\'29")', dur(t.periods) === 149,
        'duración=' + dur(t.periods));
    ok('3c · sólo se pintan las dos marcas que delimitan el bloque',
        marcas(t.svg).length === 2, JSON.stringify(marcas(t.svg)));
    ok('3d · ninguna marca suelta', huerfanas(t.svg).length === 0,
        JSON.stringify(huerfanas(t.svg)));
    ok('3e · la lista cronológica conserva los 4 sucesos', t.events.length === 4);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · la salida que de verdad no cierra nada ──');
// ═══════════════════════════════════════════════════════════════════════════
// Dos salidas seguidas: la segunda no cierra ningún bloque. Se conserva en la
// lista (es el registro de lo ocurrido) pero NO se pinta.
{
    const r = { _id: 'doble-salida', minutesPlayed: '1:00', history: [
        ev('sub_in',  '5:00', 'Entra a las 05:00 (1ªP)'),
        ev('sub_out', '6:00', 'Sale a las 06:00 (1ªP)'),
        ev('sub_out', '7:00', 'Sale a las 07:00 (FIN)'),
    ] };
    const t = buildTimeline(r);
    ok('4a · un solo bloque', t.periods.length === 1, JSON.stringify(t.periods));
    ok('4b · sólo dos marcas pintadas (entrada y su salida)',
        marcas(t.svg).length === 2, JSON.stringify(marcas(t.svg)));
    ok('4c · ninguna línea roja huérfana', huerfanas(t.svg).length === 0,
        JSON.stringify(huerfanas(t.svg)));
    ok('4d · la salida huérfana sigue en la lista cronológica',
        t.events.filter(e => e.type === 'sub_out').length === 2);
    ok('4e · va marcada como huérfana para que el SVG la salte',
        t.events.filter(e => e.type === 'sub_out' && e.orphan).length === 1,
        JSON.stringify(t.events));
}
// Y la entrada redundante (ya estaba en el campo) tampoco puede pintarse ni
// mover el arranque del bloque hacia adelante: eso ACORTABA la barra azul.
{
    const r = { _id: 'doble-entrada', minutesPlayed: '10:00', history: [
        ev('sub_in', '5:00',  'Entra a las 05:00 (1ªP)'),
        ev('sub_in', '8:00',  'Entra a las 08:00 (2ªP)'),
        ev('sub_out', '15:00', 'Sale a las 15:00 (FIN)'),
    ] };
    const t = buildTimeline(r);
    ok('4f · el bloque arranca en la PRIMERA entrada, no en la segunda',
        t.periods.length === 1 && t.periods[0].startSec === 300, JSON.stringify(t.periods));
    ok('4g · ninguna marca suelta', huerfanas(t.svg).length === 0,
        JSON.stringify(huerfanas(t.svg)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · jugó pero su historial no tiene transiciones ──');
// ═══════════════════════════════════════════════════════════════════════════
// Un titular que no fue sustituido nunca: su historial sólo trae el gol. Antes
// caía en la rama de historial NO vacío y se quedaba sin un solo bloque azul,
// con la tarjeta diciendo que jugó el partido entero.
{
    const r = { _id: 'solo-gol', minutesPlayed: '30:00',
                history: [ev('goal', '12:00', 'GOL (1º) a las 12:00 (1ªP)')] };
    const t = buildTimeline(r);
    ok('5a · barra de juego completa', dur(t.periods) === 1800,
        JSON.stringify(t.periods));
    ok('5b · sin marcas de sustitución', marcas(t.svg).length === 0);
}
// Sin historial ninguno (comportamiento previo, no debe cambiar).
{
    const t = buildTimeline({ _id: 'sin-hist', minutesPlayed: '20:00', history: [] });
    ok('5c · sin historial se sigue asumiendo 0\'→tiempo jugado',
        t.periods.length === 1 && t.periods[0].startSec === 0 && t.periods[0].endSec === 1200,
        JSON.stringify(t.periods));
}
// Y quien no jugó nada sigue con la línea entera en el banquillo.
{
    const t = buildTimeline({ _id: 'cero', minutesPlayed: '0:00', history: [] });
    ok('5d · sin minutos no se pinta ningún bloque', t.periods.length === 0 &&
        bloques(t.svg).length === 0, JSON.stringify(t.periods));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 6 · nada se sale del lienzo (captura 10207) ──');
// ═══════════════════════════════════════════════════════════════════════════
// El eje se calculaba con `Math.max(tiempo jugado, 30min)` a secas, así que un
// suceso posterior al tiempo JUGADO (entrar en el 44' y jugar 20 minutos) caía
// fuera del ancho del SVG —que además pinta con overflow:visible— y su marca
// aparecía flotando fuera de la barra.
{
    const r = { _id: 'fuera-de-eje', minutesPlayed: '20:00', history: [
        ev('sub_in',  '44:00', 'Entra a las 44:00 (2ªP)'),
        ev('sub_out', '64:00', 'Sale a las 64:00 (FIN)'),
    ] };
    const t = buildTimeline(r);
    const W = 500;
    const fuera = marcas(t.svg).filter(m => m.x < -0.5 || m.x > W + 0.5)
        .concat(bloques(t.svg).filter(b => b.x2 > W + 0.5).map(b => ({ x: b.x2, col: 'rect' })));
    ok('6a · el bloque y sus marcas caben en el lienzo', fuera.length === 0,
        JSON.stringify(fuera) + ' marcas=' + JSON.stringify(marcas(t.svg)));
    ok('6b · el bloque dura los 20 minutos jugados', dur(t.periods) === 1200,
        JSON.stringify(t.periods));
    ok('6c · ninguna marca suelta', huerfanas(t.svg).length === 0,
        JSON.stringify(huerfanas(t.svg)));
}

// ───────────────────────────────────────────────────────────────────────────
console.log(`\n${fallos ? '💥' : '✅'} ${total - fallos}/${total} aserciones\n`);
process.exit(fallos ? 1 : 0);

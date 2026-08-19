// ════════════════════════════════════════════════════════════════════════
//  test_grupos_fem_y_tope_subcategoria.js
//  LAS DOS FEM ESTRENAN GRUPO · Y EL TOPE ES DE CADA SUBCATEGORÍA — v586
// ════════════════════════════════════════════════════════════════════════
//  Dos peticiones del autor (implementar.txt + capturas 9283/9284/9285):
//
//   1. El tope de registros ("máx. 40") era GLOBAL para todo el árbol. Con 9
//      categorías × 3 subcategorías eso son hasta 27 equipos compartiendo 40
//      huecos: un equipo activo borraba de Firestore, para siempre, las
//      convocatorias de los demás. Pasa a ser de 50 POR SUBCATEGORÍA.
//      (El purgado en sí lo ejercitan test_events_tab_tree.js parte 6 y
//      test_events_tab_module.js parte 3; aquí se fija la regla de reparto.)
//
//   2. Faltaban los bloques de configuración de **FUTureFEM** y
//      **Regional FEM**. Estaban escondidas dentro de 'f7' y 'regional'.
//
//  ⚠️⚠️ ESTO REVIERTE UNA DECISIÓN DELIBERADA DE v538, que las hacía heredar
//  precisamente para no dejar claves huérfanas ni cambiar los umbrales de
//  partidos ya jugados. Se le advirtió al autor y lo pidió igual. La
//  preocupación de v538 NO se abandona: se traslada a la HERENCIA
//  (`cronosCfgGrupo`), que mantiene el comportamiento actual hasta que el
//  Director configure el bloque nuevo a propósito.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const UTILS  = leer('js/core/utils.js');
const CFG    = leer('js/coach/reports/director-config.js');
const EVENTS = leer('js/coach/reports/events-tab.js');
const APPINIT= leer('js/core/app-init.js');
const SYNC   = leer('js/match/live/sync.js');
const REPLAY = leer('js/match/replay/replay-player.js');
const LIVE   = leer('live.html');

function trozo(src, cab, cierre) {
    const i = src.indexOf(cab); if (i < 0) throw new Error('No se encontró ' + cab);
    const j = src.indexOf(cierre, i); if (j < 0) throw new Error('Sin cierre de ' + cab);
    return src.slice(i, j + cierre.length);
}

// ── Los resolutores REALES, ejecutados ─────────────────────────────────
const sb = { console: { log() {}, warn() {} }, String, Set, Array, Object, Number };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(trozo(UTILS, "if (typeof window.getCategoryGroupKey !== 'function') {", '\n}'), sb);
vm.runInContext(trozo(UTILS, "if (typeof window.cronosCfgGrupo !== 'function') {", '\n}'), sb);
const grupo = sb.window.getCategoryGroupKey;
const cfgGrupo = sb.window.cronosCfgGrupo;

console.log('\n── 1 · cada FEM cae en SU grupo, y no en el del vecino ──');
{
    ok('1a · 🔑🔑🔑 FUTureFEM ya no cae en "f7"', grupo('FUTureFEM', 'A') === 'futurefem', grupo('FUTureFEM','A'));
    ok('1b · 🔑🔑🔑 Regional FEM ya no cae en "regional"',
       grupo('Regional FEM', 'A') === 'regional_fem', grupo('Regional FEM','A'));
    ok('1c · ⚠️ y Regional a secas SIGUE siendo "regional"',
       grupo('Regional', 'A') === 'regional', grupo('Regional','A'));
    ok('1d · con acentos y grafías sueltas: futurefem se reconoce igual',
       grupo('futurefem', 'B') === 'futurefem' && grupo('f11_futurefem', 'A') === 'futurefem',
       [grupo('futurefem','B'), grupo('f11_futurefem','A')]);
    ok('1e · y "regional_fem" con guion bajo también',
       grupo('regional_fem', 'C') === 'regional_fem', grupo('regional_fem','C'));
    ok('1f · ⚠️ lo demás NO se mueve: Alevín sigue en f7, Cadete B en cadete_b',
       grupo('Alevín', 'C') === 'f7' && grupo('Cadete', 'B') === 'cadete_b' &&
       grupo('Juvenil', 'A') === 'juvenil' && grupo('Infantil', 'A') === 'infantil_a',
       [grupo('Alevín','C'), grupo('Cadete','B'), grupo('Juvenil','A'), grupo('Infantil','A')]);
}

console.log('\n── 2 · nadie pierde lo que ya tenía configurado ──');
{
    // Un club que DESACTIVÓ los informes a padres en F7 y personalizó umbrales.
    const guardado = {
        f7:       { semaforoActive: true, red: 25, yellow: 45, sendIndividualReports: false },
        regional: { semaforoActive: false, red: 33, yellow: 50, sendIndividualReports: false },
    };
    ok('2a · 🚨🚨🚨 FUTureFEM HEREDA de f7: los informes a padres siguen DESACTIVADOS',
       cfgGrupo(guardado, 'futurefem').sendIndividualReports === false,
       cfgGrupo(guardado, 'futurefem'));
    ok('2b · y hereda también sus umbrales (los de un partido de 70 minutos)',
       cfgGrupo(guardado, 'futurefem').red === 25 && cfgGrupo(guardado, 'futurefem').yellow === 45);
    ok('2c · 🚨 Regional FEM hereda de regional igual',
       cfgGrupo(guardado, 'regional_fem').sendIndividualReports === false);
    // Y en cuanto se configura el bloque nuevo, manda el suyo.
    const conPropio = Object.assign({}, guardado, {
        futurefem: { semaforoActive: true, red: 40, yellow: 60, sendIndividualReports: true },
    });
    ok('2d · 🔑 en cuanto el Director guarda el bloque nuevo, manda el suyo',
       cfgGrupo(conPropio, 'futurefem').red === 40 &&
       cfgGrupo(conPropio, 'futurefem').sendIndividualReports === true);
    ok('2e · ⚠️ un grupo de siempre no hereda de nadie: si no está, no está',
       cfgGrupo({}, 'cadete_b') === undefined, cfgGrupo({}, 'cadete_b'));
    ok('2f · y sin configuración alguna, la FEM tampoco inventa nada',
       cfgGrupo({}, 'futurefem') === undefined);
}

console.log('\n── 3 · Regional FEM NO puede perder el celeste (regla de v559) ──');
{
    // 🔑 El celeste se decide en CUATRO sitios por la clave de grupo. Partir
    //    'regional' en dos sin tocarlos le encendería el semáforo a Regional
    //    FEM — justo el defecto que cerró v559.
    const sitios = [
        ['app-init.js',        APPINIT],
        ['live.html',          LIVE],
        ['sync.js',            SYNC],
        ['replay-player.js',   REPLAY],
    ];
    sitios.forEach(([nombre, src]) => {
        ok('3 · ' + nombre + ' trata regional_fem como celeste',
           /groupKey === 'juvenil' \|\| groupKey === 'regional' \|\| groupKey === 'regional_fem'/.test(src),
           'a Regional FEM se le encendería el semáforo');
    });
    // Y la regla POR TEXTO (la buena, la de v559) sigue cubriéndolo.
    vm.runInContext(trozo(UTILS, 'function _cronosNoEsAcento', '\n}'), sb);
    vm.runInContext(trozo(UTILS, "if (typeof window.cronosCategoriaSinSemaforo !== 'function') {", '\n}'), sb);
    ok('3e · 🔑 y la regla por TEXTO sigue diciendo que Regional FEM es celeste',
       sb.window.cronosCategoriaSinSemaforo('Regional FEM') === true);
    ok('3f · ⚠️ FUTureFEM NO es celeste: sí lleva semáforo',
       sb.window.cronosCategoriaSinSemaforo('FUTureFEM') === false);
}

console.log('\n── 4 · los dos bloques nuevos existen Y se guardan ──');
{
    ok('4a · el panel declara el bloque de FUTureFEM, con semáforo',
       /key: 'futurefem'[\s\S]{0,200}hasSemaforo: true/.test(CFG));
    ok('4b · y el de Regional FEM, SIN semáforo (regla de v559)',
       /key: 'regional_fem'[\s\S]{0,200}hasSemaforo: false/.test(CFG));
    ok('4c · ⚠️ los subtítulos de f7 y regional ya no se atribuyen las FEM',
       !/sub: 'Prebenjamín, Benjamín, Alevín y FUTureFEM'/.test(CFG) &&
       !/sub: 'Regional y Regional FEM/.test(CFG));
    // 🔑🔑🔑 EL DEFECTO QUE CASI SE COLA: el guardado tenía SU PROPIA lista de
    //    9 claves. Los bloques nuevos se habrían pintado y NO se habrían
    //    guardado, sin un solo error.
    ok('4d · 🔑🔑🔑 el guardado consume la lista del render, no una copia suya',
       /window\.CRONOS_GRUPOS_CONFIG\s*=\s*GROUPS\.map/.test(CFG) &&
       /GROUPS = \(Array\.isArray\(window\.CRONOS_GRUPOS_CONFIG\)/.test(CFG),
       'los interruptores nuevos no guardarían nada');
    ok('4e · y su respaldo literal incluye las dos FEM',
       /'futurefem', 'juvenil', 'regional', 'regional_fem'/.test(CFG));
    ok('4f · 🔑 el formulario enseña la configuración HEREDADA, no unos valores inventados',
       /cronosCfgGrupo\(categoryConfigs, g\.key\)/.test(CFG),
       'el Director guardaría creyendo que no cambia nada');
}

console.log('\n── 5 · el tope de registros es de cada subcategoría ──');
{
    ok('5a · 🔑 el tope vale 50 y se llama por lo que es',
       /const MAX_POR_SUBCAT = 50;/.test(EVENTS));
    ok('5b · ⚠️ no queda ningún tope global', !/MAX_ITEMS/.test(EVENTS));
    ok('5c · 🔑 se agrupa por categoría|subcategoría antes de purgar',
       /String\(x\.r\.cat \|\| '\?'\) \+ '\|' \+ String\(x\.r\.sub \|\| '\?'\)/.test(EVENTS));
    ok('5d · 🔑🔑🔑 sin clasificación NO se borra nada (el borrado es irreversible)',
       /if \(_sdResueltos\) \{[\s\S]{0,900}deleteDoc/.test(EVENTS) &&
       /let _sdResueltos = null;/.test(EVENTS),
       'sin saber de qué equipo es cada registro, purgar destruye al que menos publica');
    ok('5e · la clasificación se calcula UNA vez y el árbol la reutiliza',
       (EVENTS.match(/ctResolveCatSub/g) || []).length === 2,
       'dos consultas de usuarios por apertura de pestaña: las lecturas se facturan');
    ok('5f · la cabecera nombra el tipo y el tope por subcategoría',
       /máx\. \$\{MAX_POR_SUBCAT\} por subcategoría/.test(EVENTS));
    ok('5g · 🔑 y avisa de qué subcategoría se acerca al tope',
       /Cerca del tope/.test(EVENTS),
       'es la única información accionable: qué equipo va a empezar a perder registros');
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos === 0) console.log('✅ Las dos FEM, con bloque propio; y cada subcategoría, con su cupo');
else console.log('❌ ' + fallos + ' aserción(es) en rojo');
process.exit(fallos === 0 ? 0 : 1);

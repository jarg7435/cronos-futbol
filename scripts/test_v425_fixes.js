// ═══════════════════════════════════════════════════════════════════════════
// GUARD · implementar.txt del 2026-08-03 (v425)
// ═══════════════════════════════════════════════════════════════════════════
//   1. Falsos "ENTRA" al recolocar jugadores DENTRO del campo.
//   2. El panel "Partidos en Vivo" no se registraba en la pila de navegación.
//   3. Cronograma: la barra de un suplente ocupaba el partido entero, y las
//      etiquetas de cambio se pisaban con las horas de los eventos.
//
// Los puntos 1 y 3 son el MISMO defecto de raíz visto en dos sitios: "Entra" y
// "Sale" describen una TRANSICIÓN, y el código las deducía de un estado suelto
// (el final). Las cadenas falsas que eso generaba no se quedan en el visor: las
// convierte en sub_in/sub_out _parseHistoryForFirestore, y con ellas el
// cronograma cree que el jugador entró al campo en ese minuto.
//
// Las partes 1 y 3 EJECUTAN el código real en un sandbox en vez de mirarlo:
// un no-movimiento registrado de más es un fallo de comportamiento, y una
// aserción de regex lo daría por bueno mientras la llamada exista.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

let fallos = 0, total = 0;
function ok(nombre, cond, extra) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); if (extra !== undefined) console.log('      ' + extra); fallos++; }
}

const DRAG  = leer('js/ui/drag-drop.js');
const SETUP = leer('js/core/setup-modal.js');
const REPO  = leer('js/coach/reports/report-engine.js');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 0 · los ficheros parsean ──');
// ───────────────────────────────────────────────────────────────────────────
['js/ui/drag-drop.js', 'js/core/setup-modal.js', 'js/coach/reports/report-engine.js']
    .forEach(f => {
        let bien = true;
        try { new vm.Script(leer(f)); } catch (e) { bien = false; console.log('      ' + e.message); }
        ok(`0 · ${f} parsea`, bien);
    });

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · 🔑 "ENTRA" sólo desde el banquillo (ejecutado) ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // Se ejecuta el logMovement REAL con un stub de _registerSubHalf que apunta
    // qué se registró. Así se comprueba el COMPORTAMIENTO, no el texto.
    const ini = DRAG.indexOf('function logMovement(');
    const fin = DRAG.indexOf('// ═══', ini);
    const cuerpo = DRAG.slice(ini, fin > ini ? fin : DRAG.length);

    const registrados = [];
    const sb = {
        matchPhase: '1st_half', masterTimeH1: 600, masterTimeH2: 0,
        formatTime: s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'),
        console,
        window: { _registerSubHalf: (p, subId, action) => registrados.push({ n: p.name, action, subId }) },
    };
    vm.createContext(sb);
    vm.runInContext(cuerpo + '\nthis.__log = logMovement;', sb);
    const logMovement = sb.__log;

    const jug = (name, status) => ({ name, status, history: [] });

    // 🔑 EL CASO DEL AUTOR: un titular al que se recoloca dentro del campo.
    registrados.length = 0;
    const bruno = jug('BRUNO', 'field');
    logMovement(bruno, undefined, 'field');    // seguía en el campo
    ok('1a · 🔑 recolocar dentro del campo NO registra nada',
       registrados.length === 0 && bruno.history.length === 0,
       JSON.stringify(registrados));

    // La entrada de verdad sí se registra.
    registrados.length = 0;
    const luis = jug('LUIS', 'field');
    logMovement(luis, undefined, 'bench');     // venía del banquillo
    ok('1b · 🔑 una entrada de verdad (banquillo → campo) SÍ se registra',
       registrados.length === 1 && registrados[0].action === 'Entra',
       JSON.stringify(registrados));

    // Y la salida.
    registrados.length = 0;
    const ana = jug('ANA', 'bench');
    logMovement(ana, undefined, 'field');
    ok('1c · una salida de verdad (campo → banquillo) SÍ se registra',
       registrados.length === 1 && registrados[0].action === 'Sale',
       JSON.stringify(registrados));

    // Reordenar la banca tampoco es un movimiento.
    registrados.length = 0;
    logMovement(jug('PEPE', 'bench'), undefined, 'bench');
    ok('1d · reordenar dentro del banquillo NO registra nada', registrados.length === 0);

    // Sin estado previo, se conserva el comportamiento de siempre (compatibilidad
    // con los sitios que aún no lo pasan): no se rompe nada.
    registrados.length = 0;
    logMovement(jug('X', 'field'), undefined, undefined);
    ok('1e · sin estado previo se comporta como siempre (compatibilidad)',
       registrados.length === 1 && registrados[0].action === 'Entra');
}

// ── Y que los llamantes lo usen ────────────────────────────────────────────
{
    const d = sinCom(DRAG);
    ok('1f · 🔑 se retiró la heurística sobre el TEXTO del historial',
       !/history\[player\.history\.length - 1\]\.includes\('Entra'\)/.test(d),
       'esa heurística fallaba justo con los titulares, que tienen history vacío');
    ok('1g · dropToField sólo registra si el jugador NO estaba ya en el campo',
       /const estabaEnCampo = \(player\.status === 'field'\)/.test(d) &&
       /if \(isRunning && !estabaEnCampo\)/.test(d));
    ok('1h · 🔑 permutar dos jugadores del CAMPO no se registra como cambio',
       /permutaEnCampo\s*=\s*\(oldDraggedStatus === 'field'\s*&&\s*dragged\.status === 'field'\)/.test(d) &&
       /if \(!permutaEnCampo && !permutaEnBanca\)/.test(d));
    ok('1i · ni permutar dos del banquillo', /permutaEnBanca/.test(d));
    // Ninguna llamada debe quedarse sin el estado previo. Se cuenta para que una
    // llamada nueva sin él salte a la vista en cuanto se añada.
    // ⚠️ Se excluye la DEFINICIÓN (`function logMovement(`), que si no se cuela
    // en el censo y descuadra el total — la primera versión de esta aserción dio
    // "8 de 7" por eso.
    const llamadas = (d.match(/(?<!function )logMovement\([^;]*?\);/g) || []);
    const conPrev  = llamadas.filter(l => (l.match(/,/g) || []).length >= 2);
    ok('1j · todas las llamadas de drag-drop pasan el estado previo',
       llamadas.length >= 6 && conPrev.length === llamadas.length,
       `con estado previo: ${conPrev.length} de ${llamadas.length}` +
       (conPrev.length === llamadas.length ? '' :
        ' — sin él: ' + JSON.stringify(llamadas.filter(l => !conPrev.includes(l)))));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · el panel "Partidos en Vivo" entra en la pila ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const s = sinCom(SETUP);
    ok('2a · 🔑 _cronosOpenLiveMatchesPanel se registra en la pila',
       /_cronosOpenLiveMatchesPanel = async function\(\)\s*\{[\s\S]{0,400}?navScreen\('_cronosOpenLiveMatchesPanel'\)/.test(s),
       'sin esto, su navBack() desapila la pantalla que lo ABRIÓ y vuelve un nivel de más');

    // El registro tiene que ir ANTES del primer await (invariante del módulo).
    const bloque = (s.match(/_cronosOpenLiveMatchesPanel = async function\(\)[\s\S]*?\n\};/) || [''])[0];
    const iNav = bloque.indexOf("navScreen('_cronosOpenLiveMatchesPanel')");
    const iAwait = bloque.indexOf('await ');
    ok('2b · 🔑 y ANTES del primer await',
       iNav > -1 && (iAwait === -1 || iNav < iAwait),
       `navScreen en ${iNav}, primer await en ${iAwait}`);

    ok('2c · su pie sigue usando navBack (ahora ya coherente con la pila)',
       /onclick="navBack\(\)"/.test(bloque));

    // Censo: ninguna pantalla que pinte el panel completo puede saltarse el
    // registro. Se comprueba sobre las que llevan navBack en su propio marcado.
    const funcs = [...SETUP.matchAll(/window\.(\w+)\s*=\s*(?:async\s+)?function\s*\([^)]*\)\s*\{/g)];
    const sinRegistrar = [];
    funcs.forEach((m, i) => {
        const desde = m.index;
        const hasta = (i + 1 < funcs.length) ? funcs[i + 1].index : SETUP.length;
        const cuerpo = SETUP.slice(desde, hasta);
        if (!/modal\.innerHTML\s*=/.test(cuerpo)) return;      // no pinta pantalla
        if (!/navBack\(\)/.test(cuerpo)) return;               // no ofrece "volver"
        if (!/nav(?:Root)?Screen\(/.test(cuerpo)) sinRegistrar.push(m[1]);
    });
    ok('2d · 🔑 ninguna pantalla de setup-modal con "Volver" se salta el registro',
       sinRegistrar.length === 0, 'sin registrar: ' + JSON.stringify(sinRegistrar));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · cronograma: barra exacta y sin solapes (ejecutado) ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // Se ejecuta buildIvs de verdad, extrayéndolo del módulo.
    // ⚠️ El corte empieza en los ayudantes de fase, no en buildIvs: desde v426
    // buildIvs se apoya en ellos, y recortarlos fuera dejaba el trozo extraído
    // llamando a funciones que no existían (ReferenceError, no un fallo de
    // aserción — el test entero se caía sin decir qué se había roto).
    // Si este anclaje deja de encontrarse, `indexOf` devuelve -1 y el slice sale
    // vacío, así que se comprueba explícitamente en vez de fallar en cascada.
    const ini = REPO.indexOf('const _claveT = e =>');
    const fin = REPO.indexOf('const calcTot', ini);
    ok('3-ancla · el corte de buildIvs sigue encontrando sus dependencias',
       ini > -1 && fin > ini, `ini=${ini}, fin=${fin}`);
    const sb = { console };
    vm.createContext(sb);
    vm.runInContext(REPO.slice(ini, fin) + '\nthis.__b = buildIvs;', sb);
    const buildIvs = sb.__b;

    const ev = (type, minute) => ({ type, minute, second: 0 });

    // 🔑 EL BUG: suplente que entra en el 30 y ACABA jugando (status 'field').
    const suplente = { status: 'field', history: [ev('sub_in', 30)] };
    const ivsSup = buildIvs(suplente, 90);
    ok('3a · 🔑 un suplente que entró en el 30 NO ocupa el partido entero',
       ivsSup.length === 1 && Math.abs(ivsSup[0][0] - 30) < 0.01,
       JSON.stringify(ivsSup) + ' (antes salía [[0,90]]: la barra decía 90 minutos)');
    ok('3b · y su barra acaba al final del partido',
       ivsSup.length === 1 && Math.abs(ivsSup[0][1] - 90) < 0.01, JSON.stringify(ivsSup));

    // El titular que sale en el 60 sigue bien.
    const titular = { status: 'bench', history: [ev('sub_out', 60)] };
    ok('3c · un titular que salió en el 60 juega de 0 a 60',
       JSON.stringify(buildIvs(titular, 90)) === JSON.stringify([[0, 60]]),
       JSON.stringify(buildIvs(titular, 90)));

    // Entra y vuelve a salir.
    const ida = { status: 'bench', history: [ev('sub_in', 20), ev('sub_out', 70)] };
    ok('3d · entra en el 20 y sale en el 70 → un solo tramo 20-70',
       JSON.stringify(buildIvs(ida, 90)) === JSON.stringify([[20, 70]]),
       JSON.stringify(buildIvs(ida, 90)));

    // Dos tramos.
    const dos = { status: 'field', history: [ev('sub_out', 30), ev('sub_in', 60)] };
    ok('3e · titular que sale en el 30 y vuelve en el 60 → dos tramos',
       JSON.stringify(buildIvs(dos, 90)) === JSON.stringify([[0, 30], [60, 90]]),
       JSON.stringify(buildIvs(dos, 90)));

    // Sin historial se conserva el comportamiento de siempre.
    ok('3f · sin historial, un titular sigue ocupando todo el partido',
       JSON.stringify(buildIvs({ titular: true, history: [] }, 90)) === JSON.stringify([[0, 90]]));
    ok('3g · y un no convocado sigue sin barra',
       JSON.stringify(buildIvs({ status: 'bench', history: [] }, 90)) === JSON.stringify([]));

    // Se anulan los sub_in+sub_out simultáneos (permuta de posición): esa
    // criba ya existía y no se puede perder.
    const permuta = { status: 'field', history: [ev('sub_in', 40), ev('sub_out', 40)] };
    ok('3h · un sub_in y un sub_out en el MISMO minuto se anulan (permuta)',
       JSON.stringify(buildIvs(permuta, 90)) === JSON.stringify([[0, 90]]),
       JSON.stringify(buildIvs(permuta, 90)));
}

// ── Colisiones de etiquetas ────────────────────────────────────────────────
{
    const r = sinCom(REPO);
    ok('3i · 🔑 las horas de los eventos entran en el MISMO reparto de carriles',
       /eventos\.forEach\(e => \{\s*arriba\.push\(/.test(r),
       'antes se pintaban a TRACK_Y-8, a UN píxel de las etiquetas de cambio');
    ok('3j · 🔑 y ya no se pintan aparte en una y fija',
       !/text x="\$\{ex\.toFixed\(1\)\}" y="\$\{TRACK_Y-8\}"/.test(r));
    ok('3k · el ancho se estima con el tamaño de fuente REAL de cada etiqueta',
       /const fs = it\.fs \|\| 7;/.test(r) && /it\.txt\.length \* fs \* 0\.53/.test(r),
       'con un factor único, las de 5.5 y las de 7 no se pueden medir igual');
    ok('3l · se reparten de izquierda a derecha',
       /items\.slice\(\)\.sort\(\(a, b\) => a\.x - b\.x\)/.test(r));
    ok('3m · 🔑 los iconos se reservan una banda POR ENCIMA de todo el texto',
       /const ALTO_ICONOS = eventos\.length \? 13 : 0;/.test(r) &&
       /TRACK_Y = 20 \+ Math\.max\(0, nArriba - 1\) \* LANE_H \+ ALTO_ICONOS/.test(r),
       'no se pueden repartir en carriles: van sobre su minuto exacto');
    ok('3n · y su altura se calcula desde el carril de texto más alto',
       /TOP_LBL_Y = TRACK_Y - 7 - Math\.max\(0, nArriba - 1\) \* LANE_H/.test(r) &&
       /EVT_Y   = Math\.max\(7, TOP_LBL_Y - 11\)/.test(r));
    ok('3o · el anchor "middle" se tiene en cuenta al medir la caja',
       /it\.anchor === 'middle' \? it\.x - w \/ 2/.test(r));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) { console.log(`❌ ${fallos} aserción(es) en rojo`); process.exit(1); }
console.log('✅ v425: todas las aserciones en verde');

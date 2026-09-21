// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v748 · LOS TIEMPOS OFICIALES POR CATEGORÍA (Y LA LIBERTAD MANUAL)
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-20, capturas 10644-10645):
//
//    Prebenjamín y Benjamín ........ 30' por mitad (60') · añadido 10'
//    Alevín ........................ 35' por mitad (70') · añadido 10'
//    Infantil, FUTureFEM y Cadete .. 40' por mitad (80') · añadido 15'
//    Juvenil, Regional y Nacional .. 45' por mitad (90') · añadido 15'
//
//  …y, con sus palabras, lo IMPRESCINDIBLE: «la opción que permite modificar
//  manualmente los cronos debe seguir totalmente vigente». La parte 5 es la
//  que cuida eso, y es la razón de ser de este guard: una tabla por defecto
//  que se imponga por encima del entrenador rompería el encargo aunque todos
//  los números fueran correctos.
//
//  📏 SU CAPTURA 10644 ES LA MEDIDA DE PARTIDA: un partido de REGIONAL B con
//  los cronómetros a 30:00. La cascada del cronómetro tenía su propia tabla
//  —una de SIETE copias— y no conocía a Nacional, así que caía en el respaldo
//  de F11 (40'). La parte 6 fija que esa copia ya no existe.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const sinCom = s => s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const UTILS  = leer('js/core/utils.js');
const SETUP  = leer('js/core/setup-modal.js');
const TIMER  = leer('js/match/timer/core.js');
const APPIN  = leer('js/core/app-init.js');
const EVL    = leer('js/core/event-listeners.js');
const FORM   = leer('js/roster/formations.js');
const ENGINE = leer('js/coach/reports/report-engine.js');
const MANUAL = leer('js/coach/comms/manual-report.js');

function extraeFn(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return null;
    const abre = src.indexOf('{', ini);
    if (abre === -1) return null;
    let n = 0;
    for (let i = abre; i < src.length; i++) {
        if (src[i] === '{') n++;
        else if (src[i] === '}') { n--; if (n === 0) return src.slice(ini, i + 1); }
    }
    return null;
}

console.log('\n══ v748 · tiempos oficiales por categoría ══');

//  La tabla, extraída y ejecutada sola.
const SRC = extraeFn(UTILS, 'cronosTiemposCategoria');
let T = null;
{
    ok('0a · la tabla se puede extraer y correr sola',
       !!SRC, 'sin ella este guard no mide nada');
    if (!SRC) { console.log('\n0/1 aserciones OK'); process.exit(1); }
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(SRC + '; this.T = cronosTiemposCategoria;', sb);
    T = sb.T;
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n1) 🔑🔑 LA TABLA DEL ENCARGO, EJECUTADA');
{
    //  [categoría, minutos por mitad, añadido]
    const OFICIAL = [
        ['prebenjamin', 30, 10], ['benjamin', 30, 10],
        ['alevin', 35, 10],
        ['infantil', 40, 15], ['futurefem', 40, 15], ['cadete', 40, 15],
        ['juvenil', 45, 15], ['regional', 45, 15], ['nacional', 45, 15],
    ];
    const malos = OFICIAL.filter(([c, m, a]) => {
        const r = T(c, 'f11');
        return r.mitad !== m || r.anadido !== a;
    }).map(([c, m, a]) => c + ': ' + JSON.stringify(T(c, 'f11')) + ' (esperado ' + m + '/' + a + ')');
    ok('1a · 🔑 las nueve categorías del encargo dan sus minutos y su añadido',
       malos.length === 0, JSON.stringify(malos));

    ok('1b · el total es 2 × la mitad',
       T('regional', 'f11').totalMin === 90 && T('prebenjamin', 'f7').totalMin === 60 &&
       T('alevin', 'f7').totalMin === 70 && T('cadete', 'f11').totalMin === 80);
    ok('1c · y los segundos cuadran con los minutos',
       T('juvenil', 'f11').mitadSec === 2700 && T('juvenil', 'f11').anadidoSec === 900 &&
       T('alevin', 'f7').anadidoSec === 600);

    // ── Lo que CAMBIA respecto a lo que había ────────────────────────
    ok('1d · 🆕 BENJAMÍN baja de 35 a 30 por mitad',
       T('benjamin', 'f7').mitad === 30, T('benjamin', 'f7').mitad);
    ok('1e · 🆕 FUTUREFEM sube de 35 a 40 (el autor lo agrupa con Infantil y Cadete)',
       T('futurefem', 'f11').mitad === 40 && T('futurefem', 'f11').anadido === 15,
       JSON.stringify(T('futurefem', 'f11')));
    ok('1f · 🔴 NACIONAL son 45, no los 40 del respaldo de F11',
       T('nacional', 'f11').mitad === 45,
       'era el hueco de v747: la cascada del cronómetro no la conocía. Dio ' + T('nacional', 'f11').mitad);
    ok('1g · 🆕 el añadido depende de la CATEGORÍA, no de la modalidad',
       T('infantil', 'f7').anadido === 15 && T('alevin', 'f11').anadido === 10,
       'un Infantil de F7 se quedaba en 10 minutos de añadido');

    // ── 🚨 Las trampas de subcadena (v511) ───────────────────────────
    ok('1h · 🚨 «regional_fem» no se cuela como otra cosa: 45, como Regional',
       T('regional_fem', 'f11').mitad === 45 && T('Regional FEM B', 'f11').mitad === 45);
    ok('1i · 🚨 «prebenjamin» CONTIENE «benjamin» y se resuelve solo',
       T('prebenjamin', 'f7').mitad === 30 && T('f7_prebenjamín', 'f7').mitad === 30);
    ok('1j · 🔑 con prefijo, con tilde y con subcategoría: mismo resultado',
       T('f11_nacional', 'f11').mitad === 45 &&
       T('Nacional A', 'f11').mitad === 45 &&
       T('Alevín C', 'f7').mitad === 35);

    // ⚠️ Categoría desconocida: se conserva el respaldo de siempre.
    ok('1k · ⚠️ una categoría que no se sabe leer cae al respaldo de siempre',
       T('veteranos', 'f11').mitad === 40 && T('', 'f7').mitad === 30,
       'no se inventa un partido más largo de lo que nadie pidió');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n2) EL CRONÓMETRO NACE CON LOS MINUTOS DE SU CATEGORÍA');
{
    //  📏 La captura 10644: Regional B con 30:00 en los dos relojes.
    ok('2a · 🔴 el montaje del partido pide los minutos a la tabla',
       /cronosTiemposCategoria\(category, currentMode\)\.mitad/.test(SETUP),
       'aquí vivía una cascada propia que no conocía a Nacional');
    ok('2b · y los escribe en las DOS mitades',
       /half1MaxTime = defaultTime \* 60;/.test(SETUP) &&
       /half2MaxTime = defaultTime \* 60;/.test(SETUP));
    ok('2c · ⚠️ con respaldo estricto si utils.js no hubiera cargado',
       /defaultTime = \(currentMode === 'f11'\) \? 40 : 30;/.test(SETUP));
    //  🚨 Y NO QUEDA NINGUNA SEGUNDA TABLA EN EL MONTAJE.
    ok('2d · 🚨 ya no hay una cascada de minutos escrita a mano en setup-modal',
       !/defaultTime = 35;/.test(sinCom(SETUP)) && !/defaultTime = 45;/.test(sinCom(SETUP)),
       'dos tablas divergen, y el día que divergen nadie sabe cuál manda');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n3) EL AÑADIDO, TAMBIÉN POR CATEGORÍA');
{
    ok('3a · el reloj del partido lo pide a la tabla',
       /cronosAnadidoSegundos\(\)/.test(TIMER));
    ok('3b · la recuperación de un partido guardado, también',
       /cronosAnadidoSegundos\(currentMode\)/.test(SETUP));
    ok('3c · el arranque tras cerrar la pestaña, también',
       /cronosAnadidoSegundos\(\)/.test(APPIN));
    ok('3d · y la recuperación del tiempo perdido en segundo plano',
       /cronosAnadidoSegundos\(\)/.test(EVL));
    //  ⚠️ Los respaldos siguen siendo los de siempre: este reloj corre en el
    //  camino crítico del partido y no puede depender de una carga.
    ok('3e · ⚠️ los cuatro conservan su respaldo por modalidad',
       /\? 900 : 600/.test(TIMER) && /\? 900 : 600/.test(SETUP) &&
       /: 900;/.test(APPIN) && /: 900;/.test(EVL));
    //  🔑 La categoría se resuelve con la cascada que ya existía.
    ok('3f · 🔑 y la categoría sale de la MISMA cascada que el semáforo',
       /CronosSubRules[\s\S]{0,120}categoriaActual\(\)/.test(extraeFn(UTILS, 'cronosAnadidoSegundos') || ''),
       'dos cascadas para el mismo dato ya produjeron un fallo en v562');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n4) EL DESPLEGABLE ANUNCIA LO QUE EL RELOJ VA A CONTAR');
{
    ok('4a · 🔑 los minutos de cada opción salen de la tabla, no a mano',
       /cronosTiemposCategoria\(clave, mode\)\.mitad/.test(FORM),
       'el rótulo prometía 35 en Benjamín y el reloj iba a contar 30');
    ok('4b · ⚠️ y el `value` NO cambia (es la clave de los partidos ya guardados)',
       /mode \+ '_' \+ clave/.test(FORM) && /'prebenjamín'/.test(FORM));
    ok('4c · están las diez categorías del catálogo',
       (FORM.match(/\['[a-zá-ú_]+',\s*'/g) || []).length === 10,
       (FORM.match(/\['[a-zá-ú_]+',\s*'/g) || []).length);
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n5) 🔑🔑 LA LIBERTAD MANUAL SIGUE INTACTA (lo imprescindible)');
{
    //  «El entrenador debe conservar la total libertad de modificar la
    //  duración de cada mitad de forma manual» — implementar.txt.
    ok('5a · 🔑 el editor manual de cada mitad sigue existiendo',
       /function editTimer\(half\)/.test(TIMER) &&
       /Minutos para la \$\{half\}ª parte/.test(TIMER));
    ok('5b · 🔑 y escribe la duración que diga el entrenador, sin pasar por la tabla',
       /if \(half === 1\) half1MaxTime = nuevoMax; else half2MaxTime = nuevoMax;/.test(TIMER),
       'si la tabla se aplicara después, el cambio manual duraría un segundo');
    //  🚨 Y AL RECUPERAR UN PARTIDO MANDA LO GUARDADO, NO LA CATEGORÍA: es lo
    //  que permite que un amistoso de 25 minutos sobreviva a una recarga.
    ok('5c · 🚨 al recuperar un partido mandan los tiempos GUARDADOS',
       /half1MaxTime = m\.half1MaxTime \|\| 1800;/.test(SETUP) &&
       /no recalcular desde categoría/.test(SETUP));
    ok('5d · y el cambio manual se guarda y se empuja al visor',
       /_saveMatchStateToStorage/.test(extraeFn(TIMER, 'editTimer') || ''),
       'lo que no se guarda no sobrevive a un F5');
    //  ⚠️ El informe respeta lo que se jugó de verdad.
    ok('5e · ⚠️ el informe sigue prefiriendo `m.duration` a la tabla',
       /if \(m\.duration\) return parseInt\(m\.duration\) \|\| 60;/.test(ENGINE),
       'los minutos reales de un partido con tiempos especiales no se corrigen a posteriori');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n6) LAS COPIAS QUE QUEDAN DICEN LO MISMO');
{
    //  🚨 El motor de informes es un módulo PURO (cero `window`), así que NO
    //  puede llamar a la tabla: el guard 1c de test_report_engine_module.js lo
    //  tumba. Su cascada se queda escrita, y lo que impide que diverja es
    //  esto: se ejecutan las DOS y se comparan categoría a categoría.
    const SRC_ENG = extraeFn(ENGINE, 'buildReport') || ENGINE;
    const m = ENGINE.match(/const getTotMin = m => \{[\s\S]*?\n    \};/);
    ok('6a · se puede extraer la tabla del motor de informes', !!m);
    if (m) {
        const sb = {};
        vm.createContext(sb);
        vm.runInContext(m[0] + '\n this.G = getTotMin;', sb);
        const G = sb.G;
        const CATS = ['prebenjamin', 'benjamin', 'alevin', 'infantil', 'futurefem',
                      'cadete', 'juvenil', 'regional', 'regional_fem', 'nacional'];
        const dispares = CATS.filter(c => G({ category: c }) !== T(c, 'f11').totalMin)
                             .map(c => c + ': informe=' + G({ category: c }) +
                                       ' tabla=' + T(c, 'f11').totalMin);
        ok('6b · 🔑🔑 el motor de informes dice lo MISMO que la tabla, categoría a categoría',
           dispares.length === 0, JSON.stringify(dispares));
        ok('6c · ⚠️ y sigue siendo PURO: ni una mención a window',
           !/window/.test(m[0]),
           'llamar a la tabla le costaría poder correr en un sandbox desnudo (guard 1c del motor)');
    }
    //  El informe manual sí puede llamarla (no es puro).
    ok('6d · el informe manual pide la duración a la tabla',
       /cronosTiemposCategoria\(cat, ''\)\.totalMin/.test(MANUAL));
}

// ═════════════════════════════════════════════════════════════════════
//  🔴🔴 v749 · NADIE GUARDA UN CRONO PARA IMPONERLO DESPUÉS
// ═════════════════════════════════════════════════════════════════════
//  Reporte del autor (capturas 10653-10657, ya con v748 puesta): ALEVÍN
//  arrancaba con 45:00 y FUTUREFEM con 30:00.
//
//  📏 LOS DOS NÚMEROS ERAN LA PRUEBA: 45 es lo que quedaba del partido de
//  Regional montado antes en esa sesión y 30 es el valor con el que NACE
//  `half1MaxTime` en app-init.js. Ninguno salía de una categoría mal leída:
//  salían de que el parche de patches.js leía el crono JUSTO DESPUÉS de
//  llamar a `confirmSetup()`… que desde el candado de sesión sólo LANZA el
//  trabajo y vuelve. Guardaba el valor caducado y lo re-imponía al pulsar IR
//  AL PARTIDO, por encima del que acababa de fijar la categoría.
//
//  🔑 LA PARTE 7 EJECUTA ESE ORDEN. Medir el texto no habría bastado: el
//  defecto no está en lo que el parche escribe, sino en CUÁNDO lo lee.
// ═════════════════════════════════════════════════════════════════════
console.log('\n7) 🔴🔴 v749 · EL CRONO NO SE CAPTURA ANTES DE TIEMPO');
{
    const PATCHES = leer('js/core/patches.js');

    //  ── 7a. La forma real del arranque: confirmSetup es ASÍNCRONA ──
    const SETUP_CONFIRM = extraeFn(SETUP, 'confirmSetup') || '';
    ok('7a · 📏 `confirmSetup` hace el trabajo en un `.then()`, no en el acto',
       /Promise\.resolve\(window\.cronosSesionAlAbrirPartido\(\)\)[\s\S]{0,200}_confirmSetupAhora\(\)/.test(SETUP_CONFIRM),
       'de aquí nace todo: quien lea el crono justo después lee el del partido anterior');

    //  ── 7b. Se reproduce el defecto con la forma exacta de los dos ──
    //  Un arranque de ALEVÍN (35') sobre un estado que viene de un REGIONAL
    //  (45'), con la captura eager que tenía el parche.
    {
        let h1 = 45 * 60;
        let capturado = null;
        const confirmSetupAsync = () => Promise.resolve(true).then(() => { h1 = 35 * 60; });
        // …tal y como estaba escrito antes de v749:
        (function parcheViejo() { confirmSetupAsync(); capturado = h1 > 0 ? h1 : null; })();
        await0();
        function await0() { /* el .then() se resuelve en la microcola */ }
        ok('7b · 🔴 con la captura eager, lo guardado son los 45\' del partido anterior',
           capturado === 45 * 60,
           'capturado=' + (capturado / 60) + '  (el Alevín de su captura enseñaba 45:00)');
    }

    //  ── 7c-7e. El parche de hoy: ejecutado ──────────────────────────
    //  Se extraen las dos piezas y se corren con globales de mentira.
    const SRC_PINTA = extraeFn(PATCHES, '_pintarRelojesDesdeEstado');
    const SRC_GOTO  = extraeFn(PATCHES, 'patchGoToTitularTimer');
    ok('7c · las piezas del parche se pueden extraer y correr', !!SRC_PINTA && !!SRC_GOTO);
    if (SRC_PINTA && SRC_GOTO) {
        const pintados = {};
        const sb = {
            console: { log() {}, warn() {}, error() {} },
            setTimeout: () => 0,
            document: {
                getElementById: (id) => (id === 'timer-h1' || id === 'timer-h2')
                    ? { set textContent(v) { pintados[id] = v; }, get textContent() { return pintados[id]; } }
                    : null,
            },
            //  El estado del partido que acaba de montar `_confirmSetupAhora`:
            //  ALEVÍN, 35 minutos por mitad.
            half1MaxTime: 35 * 60,
            half2MaxTime: 35 * 60,
            updateMasterUI: function () {},
        };
        sb.window = sb;
        sb.goToTitularSelection = function () { return true; };
        vm.createContext(sb);
        vm.runInContext(
            'var _fmtTime = ' + (extraeFn(PATCHES, '_fmtTime') || 'function(){return "";}') + ';\n' +
            SRC_PINTA + '\n' + SRC_GOTO + '\n patchGoToTitularTimer();', sb);

        sb.window.goToTitularSelection();
        ok('7d · 🔑🔑 IR AL PARTIDO ya NO reescribe la duración de la categoría',
           sb.half1MaxTime === 35 * 60 && sb.half2MaxTime === 35 * 60,
           'quedó en ' + (sb.half1MaxTime / 60) + ' min');
        ok('7e · y repinta los relojes con lo que hay AHORA',
           pintados['timer-h1'] === '35:00' && pintados['timer-h2'] === '35:00',
           JSON.stringify(pintados));

        //  🔑 Y lo mismo si el entrenador lo cambió A MANO: 25 minutos de un
        //  amistoso tienen que sobrevivir al botón.
        sb.half1MaxTime = 25 * 60; sb.half2MaxTime = 25 * 60;
        sb.window.goToTitularSelection();
        ok('7f · 🔑 un cambio manual (25\') también sobrevive a IR AL PARTIDO',
           sb.half1MaxTime === 25 * 60 && pintados['timer-h1'] === '25:00',
           (sb.half1MaxTime / 60) + ' min · ' + pintados['timer-h1']);
    }

    //  ── 7g. Y la captura caducada no puede volver ───────────────────
    ok('7g · 🚨 no queda ninguna variable que recuerde un crono entre pantallas',
       !/_cronosCorrectHalfTime\s*=/.test(sinCom(PATCHES)),
       'se llamaba «el correcto» y era el caducado: recordarlo es el defecto');
    ok('7h · 🚨 y el parche NO envuelve ya a confirmSetup para leerle el crono',
       !/window\.confirmSetup = function/.test(sinCom(PATCHES)),
       'envolver una función asíncrona para leer lo que deja es leer lo de antes');
}

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);

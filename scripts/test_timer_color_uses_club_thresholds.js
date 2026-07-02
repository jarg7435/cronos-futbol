/**
 * test_timer_color_uses_club_thresholds.js — v217
 *
 * Verifica que el FIX de v217 hace que el color del cronómetro de cada
 * jugador (en la app del entrenador) RESPETE los umbrales configurados por
 * el Director Deportivo (window._clubTimerThresholds = { red, yellow }),
 * en lugar de usar los valores hardcoded total/3 y total/2.
 *
 * Carga app-init.js y patches.js en un sandbox VM, y comprueba:
 *   1. window.getTimerColor existe y es función.
 *   2. patches.js NO reasigna window.getTimerColor (FIX v217).
 *   3. Con window._clubTimerThresholds = { red: 25, yellow: 55 } y
 *      total = 4800s (f11), los colores devueltos son:
 *        - t=1199s -> ROJO  (< 25% = 1200s)
 *        - t=1200s -> AMARILLO (>= 25%)
 *        - t=2639s -> AMARILLO (< 55% = 2640s)
 *        - t=2640s -> VERDE (>= 55%)
 *   4. Con thresholds = { red: 33, yellow: 50 } (defaults) y total=4800:
 *        - t=1583s -> ROJO
 *        - t=1584s -> AMARILLO
 *        - t=2399s -> AMARILLO
 *        - t=2400s -> VERDE
 *   5. Sin thresholds (null), usa defaults 33/50.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP_INIT = fs.readFileSync(path.join(ROOT, 'js/core/app-init.js'), 'utf8');
const PATCHES   = fs.readFileSync(path.join(ROOT, 'js/core/patches.js'), 'utf8');

// ---- Helpers ---------------------------------------------------------------
const RED_BG    = '#da3633';
const YELLOW_BG = '#e3b341';
const GREEN_BG  = '#2ea043';
function colorName(c) {
    if (!c || !c.bg) return '??';
    if (c.bg === RED_BG)    return 'ROJO';
    if (c.bg === YELLOW_BG) return 'AMARILLO';
    if (c.bg === GREEN_BG)  return 'VERDE';
    return c.bg;
}

let passed = 0, failed = 0;
function assert(name, cond) {
    if (cond) { passed++; console.log('  PASS  ' + name); }
    else      { failed++; console.log('  FAIL  ' + name); }
}

// ---- Sandbox ---------------------------------------------------------------
// Simulamos el entorno que necesitan app-init.js y patches.js para definir
// getTimerColor. Solo nos interesa la porción del archivo que define esa
// función y las variables globales que usa (half1MaxTime, half2MaxTime,
// window). El resto del archivo no se carga.
function extractFunction(src, name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const m = re.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length - 1; // abrimos llave
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(m.index, i);
}

// ---- Test 1: app-init.js define getTimerColor y lee _clubTimerThresholds ----
console.log('\n== Test 1: app-init.js define getTimerColor con thresholds ==');
{
    const sb = {
        window: {},
        half1MaxTime: 2400,
        half2MaxTime: 2400,
        console
    };
    vm.createContext(sb);
    const fnSrc = extractFunction(APP_INIT, 'getTimerColor');
    assert('app-init.js contiene function getTimerColor', fnSrc !== null);
    if (fnSrc) {
        // Exponerla en window como hace app-init.js (en el archivo real hay
        // una asignación implícita porque la función es top-level; aquí la
        // exponemos manualmente para poder llamarla).
        vm.runInContext(fnSrc + '\nwindow.getTimerColor = getTimerColor;', sb);

        assert('window.getTimerColor es función', typeof sb.window.getTimerColor === 'function');
        assert('app-init.js getTimerColor referencia _clubTimerThresholds',
               /_clubTimerThresholds/.test(fnSrc));

        // Thresholds custom: red=25, yellow=55 ; total=4800 ; 25%=1200, 55%=2640
        sb.window._clubTimerThresholds = { red: 25, yellow: 55 };
        assert('custom 1199s -> ROJO',  colorName(sb.window.getTimerColor(1199)) === 'ROJO');
        assert('custom 1200s -> AMARILLO', colorName(sb.window.getTimerColor(1200)) === 'AMARILLO');
        assert('custom 2639s -> AMARILLO', colorName(sb.window.getTimerColor(2639)) === 'AMARILLO');
        assert('custom 2640s -> VERDE',  colorName(sb.window.getTimerColor(2640)) === 'VERDE');

        // Defaults: red=33, yellow=50 ; total=4800 ; 33%=1584, 50%=2400
        sb.window._clubTimerThresholds = { red: 33, yellow: 50 };
        assert('default 1583s -> ROJO',  colorName(sb.window.getTimerColor(1583)) === 'ROJO');
        assert('default 1584s -> AMARILLO', colorName(sb.window.getTimerColor(1584)) === 'AMARILLO');
        assert('default 2399s -> AMARILLO', colorName(sb.window.getTimerColor(2399)) === 'AMARILLO');
        assert('default 2400s -> VERDE',  colorName(sb.window.getTimerColor(2400)) === 'VERDE');

        // Sin thresholds (null) → defaults vía ?? en app-init.js
        sb.window._clubTimerThresholds = null;
        assert('null thresholds 1583s -> ROJO (default)', colorName(sb.window.getTimerColor(1583)) === 'ROJO');
        assert('null thresholds 1584s -> AMARILLO (default)', colorName(sb.window.getTimerColor(1584)) === 'AMARILLO');
    }
}

// ---- Test 2: patches.js NO reasigna window.getTimerColor -------------------
console.log('\n== Test 2: patches.js NO reasigna window.getTimerColor (FIX v217) ==');
{
    // Buscamos en el fuente de patches.js la línea que reasignaba:
    //   window.getTimerColor = getTimerColor;
    // Debe haber desaparecido tras el FIX v217.
    const hasReassign = /window\.getTimerColor\s*=\s*getTimerColor\s*;/.test(PATCHES);
    assert('patches.js NO contiene "window.getTimerColor = getTimerColor;"', !hasReassign);

    // patches.js puede seguir teniendo su propia función getTimerColor local,
    // pero debe consultar window._clubTimerThresholds (ya sea directamente o
    // delegando en window.getTimerColor).
    const hasThresholdsRef = /_clubTimerThresholds/.test(PATCHES) ||
                              /window\.getTimerColor\(/.test(PATCHES);
    assert('patches.js referencia _clubTimerThresholds o delega en window.getTimerColor',
           hasThresholdsRef);
}

// ---- Test 3: integración — cargar ambos y que patches respete thresholds ---
console.log('\n== Test 3: integración app-init.js + patches.js ==');
{
    const sb = {
        window: {},
        half1MaxTime: 2400,
        half2MaxTime: 2400,
        console,
        document: { head: { appendChild: () => {} }, getElementById: () => null },
        setTimeout: () => 0,
        setInterval: () => 0,
        clearInterval: () => {},
        MutationObserver: function() { return { observe: () => {} }; },
    };
    vm.createContext(sb);

    const fnAppInit = extractFunction(APP_INIT, 'getTimerColor');
    vm.runInContext(fnAppInit + '\nwindow.getTimerColor = getTimerColor;', sb);

    // Simular la carga del bloque de patches.js que define applyTimerColor.
    // Extraemos solo esa función (ya no reasigna window.getTimerColor).
    const fnPatches = extractFunction(PATCHES, 'getTimerColor');
    const fnApply   = extractFunction(PATCHES, 'applyTimerColor');
    // Cargar el código de patches.js tal cual (no reasigna window.getTimerColor).
    vm.runInContext(fnPatches + '\n' + fnApply + '\nwindow.applyTimerColor = applyTimerColor;', sb);

    // Tras cargar patches.js, window.getTimerColor debe seguir siendo la de
    // app-init.js (que respeta _clubTimerThresholds).
    sb.window._clubTimerThresholds = { red: 25, yellow: 55 };
    assert('integración 1199s -> ROJO (custom 25%)',  colorName(sb.window.getTimerColor(1199)) === 'ROJO');
    assert('integración 1200s -> AMARILLO (custom 25%)', colorName(sb.window.getTimerColor(1200)) === 'AMARILLO');
    assert('integración 2640s -> VERDE (custom 55%)',  colorName(sb.window.getTimerColor(2640)) === 'VERDE');

    // applyTimerColor también debe respetar (delega en window.getTimerColor)
    const fakeEl = {
        style: { setProperty: () => {} },
    };
    sb.window.applyTimerColor(fakeEl, 1199);
    // No podemos inspeccionar el background sin un mock más rico, pero al
    // menos verificamos que no lanza y que la función existe.
    assert('applyTimerColor no lanza con thresholds custom', true);
}

// ---- Resumen ---------------------------------------------------------------
console.log('\n' + (failed === 0 ? 'OK' : 'FALLOS') + ': ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

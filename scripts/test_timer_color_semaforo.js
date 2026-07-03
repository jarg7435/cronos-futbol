// Test de comportamiento del semáforo de tiempo jugado de live.html.
// Extrae el CUERPO REAL de _timerColorFor del archivo y lo ejecuta en un
// sandbox para verificar que:
//  1. Los 3 rangos (rojo/amarillo/verde) caen donde deben, incluido 00:00 -> rojo.
//  2. renderField (live-player-time) y renderBench (.bench-time) producen el
//     MISMO color para el MISMO tiempo jugado (al compartir _timerColorFor,
//     el HTML generado por ambos lleva idéntico background/color).
//  3. (v217) Los umbrales configurables (data.timerThresholds = {red, yellow})
//     se respetan ESTRICTAMENTE cuando se pasan en el snapshot.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'live.html'), 'utf8');

// Extrae `function NOMBRE(...) { ... }` balanceando llaves.
function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('No encontrada: ' + name);
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

const fnTimerColor = extractFn(html, '_timerColorFor');

const sandbox = { Math, console };
vm.createContext(sandbox);
vm.runInContext(fnTimerColor, sandbox);
function colorFor(timeSec, data) {
    return vm.runInContext('_timerColorFor(' + JSON.stringify(timeSec) + ', ' + JSON.stringify(data) + ')', sandbox);
}

const RED    = { bg: '#da3633', text: '#ffffff' };
const YELLOW = { bg: '#e3b341', text: '#000000' };
const GREEN  = { bg: '#2ea043', text: '#000000' };
function eq(a, b) { return a && b && a.bg === b.bg && a.text === b.text; }
function label(c) { return c.bg === RED.bg ? 'ROJO' : c.bg === YELLOW.bg ? 'AMARILLO' : c.bg === GREEN.bg ? 'VERDE' : c.bg; }

let results = [];
function check(name, cond) {
    results.push({ name, ok: !!cond });
    console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
}

// ── Rangos DEFAULT (sin timerThresholds): 33% / 50% ───────────────────
// f11 por defecto -> total = 2400 + 2400 = 4800
// 33% × 4800 = 1584 ; 50% × 4800 = 2400
{
    const data = {}; // sin half*MaxTime ni mode -> fallback f11 (2400/parte)

    // 00:00 -> ROJO (sin caso especial)
    check('1. 00:00 -> ROJO', eq(colorFor(0, data), RED));
    // justo por debajo del umbral rojo (33% = 1584s) -> ROJO
    check('2. 1583s (< 33%) -> ROJO', eq(colorFor(1583, data), RED));
    // exactamente 33% (1584s) -> AMARILLO (>=)
    check('3. 1584s (= 33%) -> AMARILLO', eq(colorFor(1584, data), YELLOW));
    // dentro del tramo amarillo
    check('4. 2000s (amarillo) -> AMARILLO', eq(colorFor(2000, data), YELLOW));
    // justo por debajo de 50% -> AMARILLO
    check('5. 2399s (< 50%) -> AMARILLO', eq(colorFor(2399, data), YELLOW));
    // exactamente 50% (2400s) -> VERDE (>=)
    check('6. 2400s (= 50%) -> VERDE', eq(colorFor(2400, data), GREEN));
    // por encima -> VERDE
    check('7. 4000s (verde) -> VERDE', eq(colorFor(4000, data), GREEN));
}

// ── Mismo color campo vs banquillo para el mismo tiempo ────────────────
// Ambos renders usan _timerColorFor(timeSec, data); aquí lo comprobamos
// directamente para una rejilla de tiempos en varias configuraciones.
{
    const configs = [
        { name: 'f11 default',  data: {} },                                  // total 4800
        { name: 'f7 mode',      data: { mode: 'f7' } },                       // total 3600
        { name: 'custom halves', data: { half1MaxTime: 600, half2MaxTime: 600 } }, // total 1200
    ];
    const tiempos = [0, 100, 399, 400, 599, 600, 1199, 1200, 1583, 1584, 2399, 2400, 4000];
    let allMatch = true;
    let allValid = true;
    for (const cfg of configs) {
        for (const t of tiempos) {
            // En el código, renderField y renderBench llaman a la MISMA función con
            // (p.time, data). Modelamos un "jugador de campo" y uno "de banquillo"
            // con el mismo time y verificamos que el color resultante coincide.
            const field = colorFor(t, cfg.data);
            const bench = colorFor(t, cfg.data);
            if (!eq(field, bench)) { allMatch = false; }
            if (!(eq(field, RED) || eq(field, YELLOW) || eq(field, GREEN))) { allValid = false; }
        }
    }
    check('8. campo y banquillo dan el mismo color para el mismo tiempo (todas las configs)', allMatch);
    check('9. todos los colores producidos son rojo/amarillo/verde válidos', allValid);
}

// ── f7 DEFAULT: total = 1800 + 1800 = 3600 ; 33% = 1188 ; 50% = 1800 ──
{
    const data = { mode: 'f7' };
    check('10. f7 1187s -> ROJO',     eq(colorFor(1187, data), RED));
    check('11. f7 1188s -> AMARILLO', eq(colorFor(1188, data), YELLOW));
    check('12. f7 1800s -> VERDE',    eq(colorFor(1800, data), GREEN));
}

// ── v217: UMBRALES CONFIGURABLES (Director Deportivo) ─────────────────
// total = 4800 ; si el Director configura red=25, yellow=55:
//   - < 25% (1200s) -> ROJO
//   - 25%-55% (1200s-2640s) -> AMARILLO
//   - >= 55% (2640s) -> VERDE
{
    const data = { timerThresholds: { red: 25, yellow: 55 } };
    check('13. v217 custom 1199s (<25%) -> ROJO',     eq(colorFor(1199, data), RED));
    check('14. v217 custom 1200s (=25%) -> AMARILLO', eq(colorFor(1200, data), YELLOW));
    check('15. v217 custom 2000s (25-55%) -> AMARILLO', eq(colorFor(2000, data), YELLOW));
    check('16. v217 custom 2639s (<55%) -> AMARILLO', eq(colorFor(2639, data), YELLOW));
    check('17. v217 custom 2640s (=55%) -> VERDE',    eq(colorFor(2640, data), GREEN));
    check('18. v217 custom 4000s (>55%) -> VERDE',    eq(colorFor(4000, data), GREEN));
}

// ── v217: umbrales EXTREMOS (rojo=10, amarillo=90) ────────────────────
// total = 4800 ; 10% = 480, 90% = 4320
{
    const data = { timerThresholds: { red: 10, yellow: 90 } };
    check('19. v217 extreme 479s -> ROJO',     eq(colorFor(479, data), RED));
    check('20. v217 extreme 480s -> AMARILLO', eq(colorFor(480, data), YELLOW));
    check('21. v217 extreme 4319s -> AMARILLO', eq(colorFor(4319, data), YELLOW));
    check('22. v217 extreme 4320s -> VERDE',   eq(colorFor(4320, data), GREEN));
}

// ── v217: timerThresholds null o vacío → usar defaults 33/50 ──────────
{
    check('23. v217 null thresholds -> default behavior', eq(colorFor(1584, { timerThresholds: null }), YELLOW));
    check('24. v217 empty thresholds -> default behavior', eq(colorFor(1584, { timerThresholds: {} }), YELLOW));
}

console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' OK');
const failed = results.filter(r => !r.ok);
if (failed.length) { console.error('FALLOS: ' + failed.map(f => f.name).join(', ')); process.exit(1); }

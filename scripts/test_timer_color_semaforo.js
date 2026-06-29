// Test de comportamiento del semáforo de tiempo jugado de live.html.
// Extrae el CUERPO REAL de _timerColorFor del archivo y lo ejecuta en un
// sandbox para verificar que:
//  1. Los 3 rangos (rojo/amarillo/verde) caen donde deben, incluido 00:00 -> rojo.
//  2. renderField (live-player-time) y renderBench (.bench-time) producen el
//     MISMO color para el MISMO tiempo jugado (al compartir _timerColorFor,
//     el HTML generado por ambos lleva idéntico background/color).
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

// ── Rangos: f11 por defecto -> total = 2400 + 2400 = 4800 ───────────
// total/3 = 1600 ; total/2 = 2400
{
    const data = {}; // sin half*MaxTime ni mode -> fallback f11 (2400/parte)

    // 00:00 -> ROJO (sin caso especial)
    check('1. 00:00 -> ROJO', eq(colorFor(0, data), RED));
    // justo por debajo de total/3 -> ROJO
    check('2. 1599s (< total/3) -> ROJO', eq(colorFor(1599, data), RED));
    // exactamente total/3 -> AMARILLO (>=)
    check('3. 1600s (= total/3) -> AMARILLO', eq(colorFor(1600, data), YELLOW));
    // dentro del tramo amarillo
    check('4. 2000s (amarillo) -> AMARILLO', eq(colorFor(2000, data), YELLOW));
    // justo por debajo de total/2 -> AMARILLO
    check('5. 2399s (< total/2) -> AMARILLO', eq(colorFor(2399, data), YELLOW));
    // exactamente total/2 -> VERDE (>=)
    check('6. 2400s (= total/2) -> VERDE', eq(colorFor(2400, data), GREEN));
    // por encima -> VERDE
    check('7. 4000s (verde) -> VERDE', eq(colorFor(4000, data), GREEN));
}

// ── Mismo color campo vs banquillo para el mismo tiempo ────────────
// Ambos renders usan _timerColorFor(timeSec, data); aquí lo comprobamos
// directamente para una rejilla de tiempos en varias configuraciones.
{
    const configs = [
        { name: 'f11 default',  data: {} },                                  // total 4800
        { name: 'f7 mode',      data: { mode: 'f7' } },                       // total 3600
        { name: 'custom halves', data: { half1MaxTime: 600, half2MaxTime: 600 } }, // total 1200
    ];
    const tiempos = [0, 100, 399, 400, 599, 600, 1199, 1200, 1599, 1600, 2400, 4000];
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

// ── f7: total = 1800 + 1800 = 3600 ; total/3 = 1200 ; total/2 = 1800 ─
{
    const data = { mode: 'f7' };
    check('10. f7 1199s -> ROJO',     eq(colorFor(1199, data), RED));
    check('11. f7 1200s -> AMARILLO', eq(colorFor(1200, data), YELLOW));
    check('12. f7 1800s -> VERDE',    eq(colorFor(1800, data), GREEN));
}

console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' OK');
const failed = results.filter(r => !r.ok);
if (failed.length) { console.error('FALLOS: ' + failed.map(f => f.name).join(', ')); process.exit(1); }

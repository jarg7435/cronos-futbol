// Test de EMISIÓN DOM del semáforo de tiempo jugado de live.html.
//
// A diferencia de test_timer_color_semaforo.js (que prueba _timerColorFor de
// forma aislada), este test extrae los CUERPOS REALES de renderField y
// renderBench del archivo y los ejecuta en un sandbox con un DOM mockeado
// (mismo patrón riguroso que test_live_phase_transition.js). Luego parsea el
// HTML que cada uno deja en innerHTML y verifica que el background/color de la
// etiqueta de tiempo coincide:
//   - campo:     <div class="live-player-time" ... style="background:..;color:..">
//   - banquillo: <div class="bench-time"        style="background:..;color:..">
// No solo que ambos llaman a la misma función, sino que el RESULTADO FINAL en
// el DOM es idéntico para el mismo `time`.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'live.html'), 'utf8');

// Extrae `function NOMBRE(...) { ... }` balanceando llaves (real, no reimplementado).
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

// Dependencias reales que usan renderField/renderBench: las extraemos del
// propio archivo en vez de reimplementarlas, para que el test rompa si cambian.
const SOURCES = [
    'formatTime',
    'escapeHtml',
    'safeColor',
    '_timerColorFor',
    'renderField',
    'renderBench',
].map(n => extractFn(html, n)).join('\n\n');

// ── DOM mockeado: getElementById devuelve elementos que capturan innerHTML ──
function makeDocument() {
    const els = {};
    function get(id) {
        if (!els[id]) els[id] = { id, innerHTML: '', querySelectorAll: () => [] };
        return els[id];
    }
    return { getElementById: get, _els: els };
}

const sandbox = { document: makeDocument(), Math, console };
vm.createContext(sandbox);
vm.runInContext(SOURCES, sandbox);

// Extrae {bg,text} del style de la primera etiqueta con la clase dada.
function parseStyle(htmlStr, cls) {
    const re = new RegExp('class="' + cls + '"[^>]*style="background:\\s*([^;]+);\\s*color:\\s*([^;"]+);?\\s*"');
    const m = htmlStr.match(re);
    return m ? { bg: m[1].trim(), text: m[2].trim() } : null;
}

// Renderiza campo + banquillo para un mismo `time` y devuelve el {bg,text} que
// cada uno deja realmente en el DOM.
function emit(time, cfg) {
    const data = Object.assign({
        homeTeam: {}, awayTeam: {},
        players: [
            { team: 'home', status: 'field', number: '7', name: 'Campo',     time },
            { team: 'home', status: 'bench', number: '9', name: 'Banquillo', time },
        ],
    }, cfg || {});
    vm.runInContext(
        'renderField(' + JSON.stringify(data) + '); renderBench(' + JSON.stringify(data) + ');',
        sandbox
    );
    const fieldHTML = sandbox.document._els['live-pitch'].innerHTML;
    const benchHTML = sandbox.document._els['bench-home'].innerHTML;
    return {
        field: parseStyle(fieldHTML, 'live-player-time'),
        bench: parseStyle(benchHTML, 'bench-time'),
        fieldHTML, benchHTML,
    };
}

const RED    = { bg: '#da3633', text: '#ffffff' };
const YELLOW = { bg: '#e3b341', text: '#000000' };
const GREEN  = { bg: '#2ea043', text: '#000000' };
function eq(a, b) { return !!a && !!b && a.bg === b.bg && a.text === b.text; }

let results = [];
function check(name, cond) {
    results.push({ name, ok: !!cond });
    console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
}

// ── Smoke: que el parseo realmente encuentra las etiquetas ─────────
{
    const r = emit(0, {});
    check('0a. renderField emite etiqueta live-player-time parseable', r.field !== null);
    check('0b. renderBench emite etiqueta bench-time parseable',       r.bench !== null);
}

// ── 3 rangos verificados sobre el DOM real, campo y banquillo ──────
// f11 por defecto -> total 4800 ; total/3=1600 ; total/2=2400
{
    const casos = [
        { t: 0,    exp: RED,    etq: '00:00 -> ROJO' },
        { t: 1599, exp: RED,    etq: '1599s (< total/3) -> ROJO' },
        { t: 1600, exp: YELLOW, etq: '1600s (= total/3) -> AMARILLO' },
        { t: 2399, exp: YELLOW, etq: '2399s (< total/2) -> AMARILLO' },
        { t: 2400, exp: GREEN,  etq: '2400s (= total/2) -> VERDE' },
        { t: 4000, exp: GREEN,  etq: '4000s -> VERDE' },
    ];
    let n = 1;
    for (const c of casos) {
        const r = emit(c.t, {});
        check((n++) + 'a. campo '     + c.etq, eq(r.field, c.exp));
        check((n - 1) + 'b. banquillo ' + c.etq, eq(r.bench, c.exp));
    }
}

// ── Igualdad campo==banquillo en el DOM, varias configuraciones ────
{
    const configs = [
        { name: 'f11 default',   cfg: {} },
        { name: 'f7 mode',       cfg: { mode: 'f7' } },
        { name: 'custom halves', cfg: { half1MaxTime: 600, half2MaxTime: 600 } },
    ];
    const tiempos = [0, 100, 399, 400, 599, 600, 1199, 1200, 1599, 1600, 1800, 2400, 4000];
    let allMatch = true, allValid = true, firstFail = null;
    for (const c of configs) {
        for (const t of tiempos) {
            const r = emit(t, c.cfg);
            if (!eq(r.field, r.bench)) {
                allMatch = false;
                if (!firstFail) firstFail = c.name + ' t=' + t + ' field=' + JSON.stringify(r.field) + ' bench=' + JSON.stringify(r.bench);
            }
            const ok = eq(r.field, RED) || eq(r.field, YELLOW) || eq(r.field, GREEN);
            if (!ok) allValid = false;
        }
    }
    if (firstFail) console.log('  primer desajuste: ' + firstFail);
    check('8. DOM: campo y banquillo emiten el MISMO background/color para el mismo time (todas las configs)', allMatch);
    check('9. DOM: todos los colores emitidos son rojo/amarillo/verde válidos', allValid);
}

// ── Comprobación textual extra: el style real contiene el hex esperado ──
{
    const r = emit(2400, {}); // verde
    check('10. el HTML de campo contiene background:#2ea043',     /background:\s*#2ea043/.test(r.fieldHTML));
    check('11. el HTML de banquillo contiene background:#2ea043', /background:\s*#2ea043/.test(r.benchHTML));
}

console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' OK');
const failed = results.filter(r => !r.ok);
if (failed.length) { console.error('FALLOS: ' + failed.map(f => f.name).join(', ')); process.exit(1); }

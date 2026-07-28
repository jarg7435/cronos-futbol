// ─────────────────────────────────────────────────────────────────────────
// test_app_init_dead_duplicates.js · Refactor de monolitos (auditoria 2026-07-22)
//
// GUARD DE LA FASE A del monolito #5 (js/core/app-init.js).
//
// EL HALLAZGO QUE ORIGINA ESTA FASE (inventario del 2026-07-28): app-init.js
// no es un monolito que haya que descomponer, es una CAPA FOSIL. 102 de sus
// 133 funciones de nivel superior estan MUERTAS porque un script POSTERIOR
// declara el mismo nombre y gana: todos los scripts clasicos comparten el
// ambito global y la ultima declaracion de funcion es la que queda. Los
// "extractos" de epocas anteriores se hicieron COPIANDO, no moviendo, y como
// app-init.js es el PRIMER script de index.html su copia siempre pierde.
//
// Lo peligroso no es el peso muerto, es que 62 de esas copias han DIVERGIDO:
// app-init.js contiene versiones viejas y distintas de codigo que parece vivo
// (p.ej. su assignCard tenia 88 lineas y la que se ejecuta, en
// match/events/player-actions.js, tiene 158). Cualquiera que lea o edite ahi
// esta tocando codigo que no se ejecuta nunca.
//
// QUE FIJA ESTE ARCHIVO: que cada nombre borrado tiene UNA SOLA declaracion de
// nivel superior en toda la cadena de scripts clasicos, y que esta en el
// archivo que se espera. Mientras eso se cumpla no hay ambiguedad posible: no
// existe una segunda copia que pueda ganar o perder segun el orden de carga.
//
// ⚠️ POR QUE SE BORRA FUNCION A FUNCION Y NUNCA POR RANGOS DE LINEAS: dentro
// de las secciones borradas sobreviven declaraciones de estado que SI son
// load-bearing y cuya desaparicion seria un ReferenceError en produccion. La
// PARTE 4 las fija una a una. Un borrado por rangos se las habria llevado.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};
const rd = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('── Duplicados muertos de app-init.js (Fase A) ──\n');

const AI = 'js/core/app-init.js';
const idxHtml = rd('index.html');
const ORDER = [...idxHtml.matchAll(/<script src="(js\/[^"?]+)/g)]
    .map(m => m[1]).filter(f => fs.existsSync(path.join(ROOT, f)));

// Las 30 funciones borradas en la Fase A, con el archivo que se queda como
// unico duenyo. Agrupadas por la seccion de app-init.js de la que salieron.
const BORRADAS = {
    'js/match/events/player-actions.js': [       // §3 acciones de jugador
        'openPlayerActionModal', 'closePlayerActionModal', 'assignCard', 'terminateMatch'],
    'js/coach/training/panel.js': [              // §8 entrenamiento semanal
        '_getWeekMonday', 'renderTrainingWeek', 'saveTrainingWeek', 'clearTrainingWeek',
        '_getTrainingWeekText', 'updateTrainingPreview', 'sendTrainingWA', 'sendTrainingEmail'],
    'js/core/staff-and-comms.js': [              // §9 cuerpo tecnico
        'loadStaffConfig', 'saveStaffConfig', 'renderStaffInBench', 'openRosterManager'],
    'js/ai/import.js': [                         // §10 importacion de plantilla con IA
        'triggerRosterPhoto', 'processRosterPhoto', 'compressImageToBase64', 'callGeminiVision',
        'callTesseract', 'parsePlayersFromText', 'updateUsageCounter', 'showOCRError'],
    'js/shared/whatsapp-email.js': [             // §15 envio de convocatoria
        'openConvocationMessage', 'buildConvocationText', 'saveConvConfig',
        'previewConvocationMsg', 'sendConvocationWA', 'sendConvocationEmail'],
};
const TODAS = Object.entries(BORRADAS).flatMap(([f, ns]) => ns.map(n => [n, f]));

// Declaraciones de nivel superior (columna 0 = incondicional; una asignacion
// indentada podria estar dentro de un `if` y no cuenta como duenyo).
function declaraciones(src) {
    const out = new Map();
    src.split(/\r?\n/).forEach((l, i) => {
        let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
            || l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/);
        if (m && !out.has(m[1])) out.set(m[1], i + 1);
    });
    return out;
}
const decl = {};
ORDER.forEach(f => { decl[f] = declaraciones(rd(f)); });

// ────────── PARTE 1 · una sola declaracion, y en el archivo esperado ──────────
{
    const duplicados = [], huerfanas = [], mal = [];
    TODAS.forEach(([nombre, duenyo]) => {
        const donde = ORDER.filter(f => decl[f].has(nombre));
        if (donde.length === 0) huerfanas.push(nombre);
        else if (donde.length > 1) duplicados.push(nombre + ' -> ' + donde.join(', '));
        else if (donde[0] !== duenyo) mal.push(nombre + ' esperado en ' + duenyo + ' pero esta en ' + donde[0]);
    });
    ok('1a · ninguna de las 30 se quedo sin declaracion (seria un ReferenceError)', huerfanas.length === 0, huerfanas);
    ok('1b · ⚠️ ninguna conserva DOS declaraciones (la copia muerta se fue)', duplicados.length === 0, duplicados);
    ok('1c · cada una vive en el archivo que se espera', mal.length === 0, mal);
    ok('1d · el recuento cuadra: 30 funciones', TODAS.length === 30, TODAS.length);
}

// ────────── PARTE 2 · app-init.js ya no las declara ──────────
{
    const aiDecl = declaraciones(rd(AI));
    const quedan = TODAS.map(([n]) => n).filter(n => aiDecl.has(n));
    ok('2a · ⚠️ app-init.js no declara ninguna de las 30', quedan.length === 0, quedan);

    // y sigue cargando el PRIMERO, que es lo que hacia perder a sus copias
    ok('2b · app-init.js sigue siendo el primer script clasico', ORDER[0] === AI, ORDER[0]);

    // los duenyos tienen que cargar DESPUES (si alguien reordena las etiquetas
    // <script>, la copia superviviente podria dejar de ganar)
    const antes = Object.keys(BORRADAS).filter(f => ORDER.indexOf(f) < ORDER.indexOf(AI));
    ok('2c · los cinco archivos duenyos se cargan despues de app-init.js', antes.length === 0, antes);
}

// ────────── PARTE 3 · autotest del detector ──────────
// Si el detector dejase de ver las declaraciones, la PARTE 1 daria verde por
// no encontrar nada. Se comprueba contra codigo sintetico.
{
    const d1 = declaraciones('function foo(a) {\n}\nwindow.bar = function bar() {\n};\n');
    ok('3a · el detector ve `function X(` y `window.X = function`', d1.has('foo') && d1.has('bar'), [...d1.keys()]);
    const d2 = declaraciones('    function indentada() {\n    }\n    window.tambien = function () {\n    };\n');
    ok('3b · el detector IGNORA las declaraciones indentadas (podrian ser condicionales)', d2.size === 0, [...d2.keys()]);
    // 3c · reproduccion sintetica del estado ANTERIOR: la PARTE 1 tiene que
    // saber ver DOS copias del mismo nombre en dos archivos distintos. Se hace
    // con codigo sintetico y no con un nombre real del repo, porque cualquier
    // ejemplo real puede dejar de serlo (mi primer intento uso escapeHtml, que
    // en core/utils.js esta INDENTADO dentro de una guarda y por tanto el
    // detector lo ignora, con razon: da verde por la razon equivocada).
    const falso = {
        'a.js': 'function assignCard() {\n}\n',
        'b.js': 'function assignCard() {\n}\n',
    };
    const donde = ['a.js', 'b.js'].filter(f => declaraciones(falso[f]).has('assignCard'));
    ok('3c · el detector ve la MISMA funcion declarada en dos archivos', donde.length === 2, donde);
}

// ────────── PARTE 4 · ⚠️ el estado que SOBREVIVE dentro de las secciones ──────────
// Estas declaraciones estan dentro de los rangos borrados pero NO se borran:
// otro archivo las lee por nombre pelado y no las declara. Borrarlas seria un
// ReferenceError en produccion. Por eso la Fase A borra funcion a funcion.
{
    const aiSrc = rd(AI);
    const lex = n => new RegExp('^\\s*(?:const|let|var)\\s+' + n + '\\s*=', 'm').test(aiSrc);

    // activeActionPlayerId: lo usa js/match/events/player-actions.js (17 veces)
    // y NO lo declara en ningun sitio.
    ok('4a · ⚠️ app-init.js CONSERVA `activeActionPlayerId` (player-actions.js lo lee y no lo declara)',
        lex('activeActionPlayerId'));
    const declaraAAP = ORDER.filter(f => new RegExp('^\\s*(?:const|let|var)\\s+activeActionPlayerId\\s*=', 'm').test(rd(f)));
    ok('4b · `activeActionPlayerId` sigue teniendo UN solo declarante', declaraAAP.length === 1, declaraAAP);

    // _tesseractLoaded: js/ai/import.js lo usa en callTesseract y su propio
    // comentario de L159 dice "ya declarado en app.js".
    ok('4c · ⚠️ app-init.js CONSERVA `_tesseractLoaded` (ai/import.js depende de el)',
        lex('_tesseractLoaded'));
    ok('4d · ai/import.js sigue SIN declararlo (por eso no se puede borrar)',
        !/^\s*(?:const|let|var)\s+_tesseractLoaded\s*=/m.test(rd('js/ai/import.js')));
    ok('4e · ai/import.js lo sigue usando', /_tesseractLoaded/.test(rd('js/ai/import.js')));

    // window._trWeekOffset: inicializacion del panel de entrenamiento
    ok('4f · app-init.js CONSERVA la inicializacion de window._trWeekOffset',
        /^window\._trWeekOffset\s*=/m.test(aiSrc));
}

// ────────── PARTE 5 · app-init.js sigue cargando sin lanzar ──────────
{
    const sb = {};
    vm.createContext(sb);
    sb.window = sb;
    sb.document = { addEventListener() {}, getElementById: () => null, querySelector: () => null,
        createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }) };
    sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    sb.navigator = { userAgent: 'node', serviceWorker: { register: () => Promise.resolve() } };
    sb.location = { href: 'https://x/', hostname: 'x' };
    sb.setTimeout = () => 0; sb.setInterval = () => 0; sb.clearInterval = () => {};
    sb.console = { log() {}, warn() {}, error() {} };
    sb.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });

    let err = '';
    try { vm.runInContext(rd(AI), sb, { timeout: 15000 }); } catch (e) { err = e.message; }
    ok('5a · app-init.js evalua sin lanzar tras el borrado', !err, err);
    // el estado global compartido sigue publicado
    ['players', 'isRunning', 'currentMode', 'matchPhase', 'liveMatchId', 'COLORS', 'TEAM_NAMES']
        .forEach((n, k) => {
            const v = (() => { try { return vm.runInContext('typeof ' + n, sb); } catch (_) { return 'ERROR'; } })();
            ok('5' + 'bcdefgh'[k] + ' · el estado global `' + n + '` sigue declarado', v !== 'undefined' && v !== 'ERROR', v);
        });
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);

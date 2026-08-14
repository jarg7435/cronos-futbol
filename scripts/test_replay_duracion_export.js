// ─────────────────────────────────────────────────────────────────────────
// test_replay_duracion_export.js · duración real del partido y exportación de
// vídeo fiel (v446)
//
// Dos reportes del autor sobre partidos terminados y sus descargas:
//   · sólo se contaba el tiempo REGLAMENTARIO: el descuento jugado en directo
//     no se reflejaba ni en la duración ni en la barra del reproductor;
//   · el vídeo descargado no mostraba los suplentes, mezclaba los colores de
//     los equipos y no pintaba los sucesos sobre las fichas.
//
// LO QUE PROTEGE, y por qué cada cosa se rompe sola si nadie la vigila:
//
//  A · EL DESCUENTO NO ES UN CAMPO, ESTÁ EN EL CRONÓMETRO. `half1MaxTime` es el
//      reglamento CONFIGURADO; lo jugado de verdad son `timeH1`/`timeH2`, que
//      la app deja crecer más allá del reglamento (es el "+MM:SS" del visor).
//      Con el reglamento como tope, la barra acababa antes que el partido.
//
//  B · 🔑 NINGÚN SUCESO PUEDE CAER FUERA DE LA BARRA. Ya pasó en v394 por otro
//      motivo (el desplazamiento de la 2ª parte) y media segunda parte no se
//      reproducía JAMÁS, sin ningún error. Por eso la duración se estira
//      también hasta el último evento.
//
//  C · 🔑🔑 CANVAS NO ENTIENDE UN GRADIENTE EN CADENA. El exportador hacía
//      `ctx.fillStyle = chip.style.background`, que es
//      `linear-gradient(to bottom, …)`. Canvas DESCARTA ese valor en silencio y
//      sigue pintando con el color anterior: por eso los equipos salían
//      MEZCLADOS en el vídeo. Es la misma lección de v427 —leer la presentación
//      para reconstruir datos se rompe sin avisar— y por eso ahora los colores
//      viajan en atributos `data-*`.
//
//  D · EL VÍDEO TIENE QUE ENSEÑAR LO MISMO QUE LA PANTALLA: suplentes, colores
//      de cada equipo y los sucesos (gol, tarjeta, lesión) sobre la ficha.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 240)); }
};

const SRC = fs.readFileSync(path.join(ROOT, 'js/match/replay/replay-player.js'), 'utf8');
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const S = sinCom(SRC);

console.log('── duración real y exportación fiel (v446) ──\n');

// ═══════════ PARTE 1 · [DEFECTO A y B] la duración, EJECUTADA ═══════════
console.log('── PARTE 1 · la duración cuenta el descuento ──');
{
    const ini = SRC.indexOf('function _reglamentarioSec(data)');
    const fin = SRC.indexOf('// ── Hoja de estilos del reproductor');
    ok('1a · el bloque de duración sigue en el módulo', ini !== -1 && fin > ini);

    const sb = { console: { log() {}, warn() {} } };
    vm.createContext(sb);
    vm.runInContext(SRC.slice(ini, fin) +
        '\n;globalThis.maxT = _calculateMaxTime;' +
        '\n;globalThis.finP1 = _finPrimeraParteSec;' +
        '\n;globalThis.regl = _reglamentarioSec;', sb);
    const { maxT, finP1, regl } = sb;

    // Partido F-7 de 2×30 que se alargó: 32:10 la 1ª y 31:40 la 2ª.
    const conDescuento = { mode: 'f7', half1MaxTime: 1800, half2MaxTime: 1800,
                           timeH1: 1930, timeH2: 1900 };
    ok('1b · [DEFECTO A] 🔑 la duración cuenta lo JUGADO, no el reglamento',
       maxT(conDescuento, []) === 3830,
       maxT(conDescuento, []) + 's (reglamento sería 3600)');
    ok('1c · el reglamento sigue calculándose bien por su lado',
       regl(conDescuento) === 3600);

    // Partido corto (LNFS 2×10) alargado.
    const corto = { mode: 'f7', half1MaxTime: 600, half2MaxTime: 600, timeH1: 640, timeH2: 615 };
    ok('1d · [DEFECTO A] también en partidos cortos',
       maxT(corto, []) === 1255, maxT(corto, []));

    // Documento antiguo sin cronómetros: se cae al reglamento.
    ok('1e · sin `timeH1/timeH2` (documento antiguo) se usa el reglamento',
       maxT({ mode: 'f11', half1MaxTime: 2400, half2MaxTime: 2400 }, []) === 4800);
    ok('1f · y sin nada, el valor por defecto de la modalidad',
       maxT({ mode: 'f7' }, []) === 3600 && maxT({ mode: 'f11' }, []) === 4800);

    // [DEFECTO B] ningún evento fuera de la barra.
    ok('1g · [DEFECTO B] 🔑 la barra se estira hasta el ÚLTIMO suceso',
       maxT(conDescuento, [{ timeSec: 100 }, { timeSec: 4000 }]) === 4000,
       'un gol en el descuento no puede quedar fuera de la reproducción');
    ok('1h · y un evento corrupto no la rompe',
       maxT(conDescuento, [{ timeSec: NaN }, {}, null]) === 3830);
    // ⚠️ El suelo de 1 s es DEFENSIVO y hoy es inalcanzable: los fallbacks por
    // modalidad impiden que `total` llegue a 0. Se fija en el fuente, que es lo
    // honesto, en vez de fingir una prueba de comportamiento que no puede
    // fallar (la mutación M5 del red-check salía verde contra la versión de
    // ejecución).
    ok('1i · hay suelo defensivo: la barra nunca puede quedar en 0',
       /return Math\.max\(1, Math\.round\(total\)\);/.test(S));

    // El final de la 1ª parte manda sobre el rótulo de fase.
    ok('1j · 🔑 la 1ª parte acaba cuando acabó DE VERDAD',
       finP1(conDescuento) === 1930,
       'con el reglamento, el rótulo decía "2ª PARTE" durante el descuento de la 1ª');
    ok('1k · y sin dato real, el reglamento',
       finP1({ mode: 'f7', half1MaxTime: 1800 }) === 1800);

    // 🔑 Y QUE ESTÉN CONECTADAS. Las tres funciones anteriores pueden ser
    // perfectas y no usarlas nadie: las mutaciones M3 y M4 del red-check
    // —devolver el rótulo de fase y el semáforo al reglamento— salían VERDES
    // porque sólo se probaban aisladas. Misma familia que el fallo de v443.
    ok('1l · 🔑 el rótulo de fase USA el final real de la 1ª parte',
       /const h1Max = _finPrimeraParteSec\(data\);/.test(S) &&
       /phaseTxt\.textContent = timeSec >= h1Max/.test(S),
       'si no, dice "2ª PARTE" durante el descuento de la primera');
    // ⚠️ REFINADO EL 2026-08-14, sin perder lo que esta aserción protegía.
    // v446 puso la base del semáforo en la duración REAL porque un partido
    // ALARGADO por descuento ponía a todos en verde antes de tiempo. Cierto,
    // pero el caso contrario destrozaba la lectura: en un partido de 35+35 del
    // que sólo se juegan 6 minutos, la base caía a 360 s y aparecían cambios
    // de color que NUNCA ocurrieron en vivo —donde getTimerColor usa el
    // reglamento—. El autor lo reportó con un partido real.
    //
    // La regla que cubre los dos casos es el MÁXIMO: la base nunca baja del
    // reglamento (no se inventan colores) y sigue creciendo cuando el partido
    // se alarga (v446 intacto). Lo detalla test_semaforo_replay_y_consolidacion.js.
    ok('1m · 🔑 el semáforo NUNCA baja del reglamento, y crece si el partido se alarga',
       /const totalSec = Math\.max\(_semReglamento, _semBarra\);/.test(S) &&
       /const _semBarra\s*=\s*_calculateMaxTime\(data, _replayState\.events\);/.test(S) &&
       /const _semReglamento\s*=\s*_reglamentarioSec\(data\);/.test(S),
       'con la base corta, un partido alargado ponía a todos en verde antes de tiempo; ' +
       'con la base sólo de lo jugado, un partido corto inventaba colores');
    ok('1n · 🔑 y la barra del reproductor se calcula con los eventos delante',
       /_replayState\.maxTimeSec = _calculateMaxTime\(data, _replayState\.events\);/.test(S));
}

// ═══════ PARTE 2 · [DEFECTO C] el color, EJECUTADO sobre un canvas falso ═══════
console.log('\n── PARTE 2 · los colores del vídeo ──');
{
    ok('2a · 🔑 el exportador YA NO lee el gradiente del CSS',
       !/fillStyle = (?:numEl|chip)\.style\.background/.test(S) &&
       !/const color = numEl \? numEl\.style\.background/.test(S),
       'canvas descarta un linear-gradient en cadena y sigue con el color anterior');
    ok('2b · 🔑 la ficha construye un gradiente DE CANVAS con las dos prendas',
       /ctx\.createLinearGradient\(0, cY - r, 0, cY \+ r\)/.test(S) &&
       /grad\.addColorStop\(0\.5, camiseta\)/.test(S) &&
       /grad\.addColorStop\(0\.5, pantalon\)/.test(S));
    ok('2c · y los datos viajan en atributos, no en el estilo',
       /data-shirt="\$\{escapeHtml\(color\)\}"/.test(SRC) &&
       /data-shorts="\$\{escapeHtml\(shortsColor\)\}"/.test(SRC) &&
       /data-text="\$\{escapeHtml\(textColor\)\}"/.test(SRC));
    ok('2d · el dorsal usa el color del club, no negro fijo',
       /ctx\.fillStyle = d\.text \|\| '#000000'/.test(S));

    // Se EJECUTA el dibujado contra un canvas de mentira que registra todo.
    const ini = SRC.indexOf('function dibujaFicha(cX, cY, r, d)');
    const fin = SRC.indexOf('function dibujaBanquillos(');
    ok('2e · las funciones de dibujo se pueden extraer', ini !== -1 && fin > ini);
    if (ini !== -1 && fin > ini) {
        const ordenes = [];
        const ctx = {
            _fill: null,
            set fillStyle(v) { this._fill = v; ordenes.push(['fillStyle', v]); },
            get fillStyle() { return this._fill; },
            strokeStyle: '', lineWidth: 0, font: '', textAlign: '',
            beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {},
            fill() { ordenes.push(['fill', this._fill]); },
            fillRect(...a) { ordenes.push(['fillRect', this._fill, a]); },
            strokeRect(...a) { ordenes.push(['strokeRect', this.strokeStyle, a]); },
            fillText(t, x, y) { ordenes.push(['text', String(t)]); },
            createLinearGradient(x0, y0, x1, y1) {
                const g = { _tipo: 'grad', paradas: [], addColorStop(p, c) { this.paradas.push([p, c]); } };
                ordenes.push(['grad', g, [x0, y0, x1, y1]]);
                return g;
            },
        };
        const sb2 = { ctx, console: { log() {}, warn() {} } };
        vm.createContext(sb2);
        vm.runInContext(SRC.slice(ini, fin) + '\n;globalThis.ficha = dibujaFicha;', sb2);

        // Un local con 2 goles, amarilla y lesión.
        ordenes.length = 0;
        sb2.ficha(100, 100, 18, { shirt: '#ff0000', shorts: '#0000ff', text: '#ffffff',
                                  num: '9', goals: '2', card: 'amarilla', injured: '1' });
        const grads = ordenes.filter(o => o[0] === 'grad');
        ok('2f · [DEFECTO C] 🔑 la ficha se rellena con un GRADIENTE de canvas',
           grads.length === 1 && ordenes.some(o => o[0] === 'fill' && o[1] && o[1]._tipo === 'grad'),
           JSON.stringify(ordenes.slice(0, 4)));
        ok('2g · 🔑 con la camiseta arriba y el pantalón abajo',
           JSON.stringify(grads[0][1].paradas) ===
           JSON.stringify([[0, '#ff0000'], [0.5, '#ff0000'], [0.5, '#0000ff'], [1, '#0000ff']]),
           JSON.stringify(grads[0][1].paradas));
        ok('2h · 🔑 y NUNCA se le pasa a fillStyle una cadena linear-gradient',
           !ordenes.some(o => typeof o[1] === 'string' && /linear-gradient/.test(o[1])));

        // [DEFECTO D] los sucesos, sobre la ficha.
        ok('2i · [DEFECTO D] 🔑 el GOL se dibuja, con su recuento',
           ordenes.some(o => o[0] === 'text' && o[1] === '2'),
           JSON.stringify(ordenes.filter(o => o[0] === 'text')));
        ok('2j · [DEFECTO D] 🔑 la TARJETA se dibuja con su color',
           ordenes.some(o => o[0] === 'fillRect' && o[1] === '#e3b341'),
           JSON.stringify(ordenes.filter(o => o[0] === 'fillRect')));
        ok('2k · [DEFECTO D] 🔑 y la LESIÓN',
           ordenes.some(o => o[0] === 'fill' && o[1] === '#e74c3c'));
        ok('2l · el dorsal se pinta con el color del club',
           ordenes.some(o => o[0] === 'fillStyle' && o[1] === '#ffffff'));

        // Una roja se distingue de una amarilla.
        ordenes.length = 0;
        sb2.ficha(50, 50, 18, { shirt: '#123456', num: '5', goals: '0', card: 'roja' });
        ok('2m · la tarjeta ROJA usa su propio color',
           ordenes.some(o => o[0] === 'fillRect' && o[1] === '#da3633'));
        ok('2n · sin sucesos no se pinta ninguno',
           (() => {
               ordenes.length = 0;
               sb2.ficha(50, 50, 18, { shirt: '#123456', num: '5', goals: '0', card: '' });
               return !ordenes.some(o => o[0] === 'fillRect');
           })());
        ok('2o · sin pantalón, la ficha usa el color de la camiseta (no negro)',
           (() => {
               ordenes.length = 0;
               sb2.ficha(50, 50, 18, { shirt: '#abcdef', num: '1' });
               const g = ordenes.find(o => o[0] === 'grad');
               return g && g[1].paradas.every(p => p[1] === '#abcdef');
           })());
    }
}

// ═══════ PARTE 3 · [DEFECTO D] los banquillos en el vídeo ═══════
console.log('\n── PARTE 3 · los suplentes salen en el vídeo ──');
{
    ok('3a · 🔑 existe el dibujado de banquillos', /function dibujaBanquillos\(/.test(S));
    ok('3b · y el fotograma lo invoca',
       /dibujaBanquillos\(pY \+ pH \+ 8, homeName, awayName, homeColor, awayColor\)/.test(S));
    ok('3c · ⚠️ los nombres y colores van por ARGUMENTO, no por cierre',
       /function dibujaBanquillos\(yTop, homeName, awayName, homeColor, awayColor\)/.test(S),
       'se declaran dentro de drawPitchFrame: sueltos serían ReferenceError y tumbarían la grabación');
    ok('3d · lee las filas de los DOS banquillos del DOM',
       /#replay-bench-home \.replay-bench-row/.test(S) &&
       /#replay-bench-away \.replay-bench-row/.test(S));
    ok('3e · y las filas del banquillo también llevan sus `data-*`',
       /<div class="replay-bench-row"\$\{datosFicha\}>/.test(SRC),
       'sin ellos el exportador volvería a leer el CSS');
    ok('3f · el lienzo reserva sitio para la franja',
       /const ALTO_BANQUILLOS = 150/.test(S) && /canvas\.height = 700/.test(S));
    ok('3g · 🔑 y el campo descuenta esa franja (si no, se solapan)',
       /pH = canvas\.height - 90 - ALTO_BANQUILLOS/.test(S));
    // ⚠️ ACOTADO POR LA FUNCIÓN, NO POR UN NÚMERO DE CARACTERES. La primera
    // versión usaba una ventana de 200 y la distancia real eran 235: rojo por
    // la razón equivocada. Es la trampa que ya documentó la ronda 2 del
    // nav-stack — acotar por el siguiente límite estructural, nunca a ojo.
    const cuerpoBanq = (() => {
        const i = S.indexOf('function dibujaBanquillos(');
        if (i === -1) return '';
        const j = S.indexOf('\n            }', i);
        return j === -1 ? S.slice(i) : S.slice(i, j);
    })();
    ok('3h · un banquillo vacío se rotula, no se deja en blanco',
       /if \(!lista\.length\)/.test(cuerpoBanq) && /'Vacío'/.test(cuerpoBanq),
       cuerpoBanq.length + ' chars de cuerpo');
    ok('3i · ⚠️ hay tope de filas visibles (un banquillo largo no puede desbordar)',
       /if \(i >= porColumna \* 2\) return;/.test(S));
}

// ═══════ PARTE 4 · lo que NO debía cambiar ═══════
console.log('\n── PARTE 4 · la pantalla sigue igual ──');
{
    ok('4a · la ficha en pantalla conserva su gradiente CSS',
       /class="replay-player-chip" style="background:linear-gradient\(to bottom, \$\{color\} 50%, \$\{shortsColor\} 50%\)/.test(SRC));
    ok('4b · y sus insignias de gol, tarjeta y lesión',
       /replay-goal-badge/.test(SRC) && /replay-card-badge/.test(SRC) && /replay-injured-badge/.test(SRC));
    ok('4c · los banquillos en pantalla se siguen pintando',
       /benchHomeEl\.innerHTML = benchHomeHtml/.test(S) &&
       /benchAwayEl\.innerHTML = benchAwayHtml/.test(S));
    ok('4d · el exportador sigue leyendo la POSICIÓN del atributo style',
       /style\.match\(\/left:\\s\*\(\[\\d\\\.\]\+\)%\//.test(SRC) ||
       /left:\\s\*\(\[/.test(SRC),
       'left/top siguen siendo inline a propósito');
    ok('4e · y sigue buscando las fichas por CLASE, no por forma (v427)',
       /querySelectorAll\('\.replay-player'\)/.test(S));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);

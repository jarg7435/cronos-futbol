// ─────────────────────────────────────────────────────────────────────────
// test_play_pause_universal.js · el botón superior de tiempo funciona en TODAS
// las fases, también en el descanso (v448)
//
// Reporte del autor: "REANUDAR funciona al pausar y reanudar un partido en
// juego, pero se queda inactivo en el descanso y obliga a usar el play pequeño
// de la 2ª parte".
//
// LA CAUSA, y por qué no daba ningún error: el botón estaba enganchado
// DIRECTAMENTE a `toggleGame()`, que sólo levanta la bandera `isRunning` y
// arranca el intervalo. Pero `tick()` únicamente suma tiempo si la fase es
// '1st_half' o '2nd_half'. En 'break' el botón cambiaba a PAUSAR, el intervalo
// corría... y el cronómetro no se movía. Silencio absoluto.
//
// ESTE GUARD NO MIRA EL TEXTO DEL CÓDIGO: extrae los cuerpos reales de
// toggleGame, endFirstHalf, startSecondHalf y del manejador del clic, y los
// EJECUTA en un sandbox con un botón y un cronómetro falsos. Un guard estático
// aquí no valdría: el defecto no era una línea ausente, era un enrutado que
// faltaba, y el código "parecía" correcto.
//
// LO QUE PROTEGE:
//
//  A · EN EL DESCANSO, EL BOTÓN ARRANCA LA 2ª PARTE. Es el reporte.
//
//  B · EN LAS DEMÁS FASES NO CAMBIA NADA. Arrancar la 1ª, pausar y reanudar
//      tienen que seguir comportándose exactamente igual que antes.
//
//  C · 🔑 EL ENRUTADO VIVE EN EL MANEJADOR DEL CLIC, NO EN `toggleGame()`.
//      A toggleGame la llaman TAMBIÉN la recuperación de partido
//      (setup-modal.js, cuando el snapshot trae isRunning) y la propia
//      startSecondHalf(). Si el enrutado estuviera dentro:
//        · retomar un partido guardado en DESCANSO arrancaría la 2ª parte
//          SOLO, sin que nadie la pidiera — un cambio de fase fantasma que
//          además escribe "Entra (2ªP)" en el historial de cada jugador;
//        · y startSecondHalf() se llamaría a sí misma.
//      Por eso hay una prueba que llama a toggleGame() DIRECTAMENTE estando en
//      'break' y exige que NO cambie de fase.
//
//  D · IDEMPOTENCIA (E5). Dos pulsaciones seguidas no pueden duplicar el
//      "Entra (2ªP)" en el historial: es el mismo defecto que persiguió v424.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const EV_SRC   = fs.readFileSync(path.join(ROOT, 'js/core/event-listeners.js'), 'utf8');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'js/match/timer/core.js'), 'utf8');

// Extrae `function NOMBRE(...) {...}` balanceando llaves (mismo método que
// test_live_phase_transition.js).
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

console.log('── el botón superior de tiempo, en todas las fases (v448) ──\n');

// ═══════════ El banco de pruebas ═══════════
// Monta el trío real (toggleGame + endFirstHalf + startSecondHalf) y el
// manejador del clic, con un botón y unos jugadores de mentira.
function montar(faseInicial, opciones) {
    opciones = opciones || {};
    const boton = { textContent: 'EMPEZAR', _clases: new Set(), id: 'btn-play-pause' };
    boton.classList = {
        add: (c) => boton._clases.add(c),
        remove: (c) => boton._clases.delete(c),
        contains: (c) => boton._clases.has(c),
    };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Math, JSON,
        setInterval: (fn, ms) => { sb._intervalos++; return 'int-' + sb._intervalos; },
        clearInterval: () => { sb._limpiados++; },
        setTimeout: () => 0,
        alert: () => {},
        confirm: () => true,
        _intervalos: 0,
        _limpiados: 0,

        // Estado real del partido
        matchPhase: faseInicial,
        isRunning: !!opciones.isRunning,
        timerInterval: null,
        lastTickTime: 0,
        masterTimeH1: opciones.h1 || 0,
        masterTimeH2: 0,
        liveIsActive: false,
        players: [
            { id: 1, status: 'field', history: [], time: 0 },
            { id: 2, status: 'field', history: [], time: 0 },
            { id: 3, status: 'bench', history: [], time: 0 },
        ],

        // Dependencias externas, todas inertes
        document: {
            getElementById: (id) => (id === 'btn-play-pause' ? boton : null),
        },
        // `tick` la referencia toggleGame por nombre pelado al programar el
        // intervalo. Aquí es inerte a propósito: lo que se prueba es el
        // ENRUTADO del botón, no el conteo (que ya cubre test_live_timer_tick).
        tick: () => {},
        formatTime: (s) => String(s),
        updateMasterUI: () => { sb._renders = (sb._renders || 0) + 1; },
        pushLiveSnapshot: () => Promise.resolve(),
        _saveMatchStateToStorage: () => { sb._guardados = (sb._guardados || 0) + 1; },
        _cronosWhistle: (n, cb) => { sb._silbatos = (sb._silbatos || 0) + n; if (cb) cb(); },
        _cronosMatchMomentOverlay: (a, b, c, cb) => { if (cb) cb(); },
    };
    sb.window = sb;
    vm.createContext(sb);

    // toggleGame vive en match/timer/core.js; endFirstHalf, startSecondHalf y
    // el manejador del clic, dentro de setupEventListeners en event-listeners.js.
    const cuerpoSetup = extractFn(EV_SRC, 'setupEventListeners');
    const iniEFH = cuerpoSetup.indexOf('window.endFirstHalf');
    const finSSH = cuerpoSetup.indexOf('const dropZones');
    const iniClick = cuerpoSetup.indexOf('window.onPlayPauseClick');
    const finClick = cuerpoSetup.indexOf("document.getElementById('btn-play-pause')");

    if (iniEFH === -1 || finSSH === -1) throw new Error('No se localizan endFirstHalf/startSecondHalf');
    if (iniClick === -1 || finClick <= iniClick) {
        // Sin manejador propio, el botón sigue enganchado a toggleGame: se
        // simula así para que las pruebas describan el ESTADO ANTERIOR y el
        // guard se ponga rojo donde debe.
        vm.runInContext(extractFn(CORE_SRC, 'toggleGame') + '\n' +
                        cuerpoSetup.slice(iniEFH, finSSH) +
                        '\n;globalThis.onPlayPauseClick = toggleGame;', sb);
        return { sb, boton, sinManejador: true };
    }

    vm.runInContext(extractFn(CORE_SRC, 'toggleGame') + '\n' +
                    cuerpoSetup.slice(iniEFH, finSSH) + '\n' +
                    cuerpoSetup.slice(iniClick, finClick), sb);
    return { sb, boton, sinManejador: false };
}

const pulsar = (sb) => vm.runInContext('onPlayPauseClick()', sb);

// ═══════════ PARTE 1 · [DEFECTO] el descanso ═══════════
console.log('── PARTE 1 · [DEFECTO] pulsar REANUDAR en el DESCANSO ──');
{
    const { sb, boton } = montar('break', { h1: 1800 });

    ok('1a · de partida estamos en descanso y parados',
       sb.matchPhase === 'break' && sb.isRunning === false);

    pulsar(sb);

    ok('1b · 🔑 [DEFECTO] el botón ARRANCA la 2ª parte',
       sb.matchPhase === '2nd_half',
       'la fase quedó en: ' + sb.matchPhase);
    ok('1c · y pone el cronómetro en marcha',
       sb.isRunning === true && sb._intervalos === 1,
       'isRunning=' + sb.isRunning + ' intervalos=' + sb._intervalos);
    ok('1d · el botón pasa a PAUSAR',
       boton.textContent === 'PAUSAR' && boton._clases.has('danger'),
       boton.textContent);
    ok('1e · `lastTickTime` se siembra (si no, el primer tick salta miles de segundos)',
       sb.lastTickTime > 0);
    ok('1f · los jugadores EN CAMPO reciben su "Entra (2ªP)"',
       sb.players[0].history.length === 1 && /Entra .*\(2ªP\)/.test(sb.players[0].history[0]) &&
       sb.players[1].history.length === 1,
       JSON.stringify(sb.players.map(p => p.history)));
    ok('1g · y los del banquillo NO',
       sb.players[2].history.length === 0);
}

// ═══════════ PARTE 2 · [D] idempotencia ═══════════
console.log('\n── PARTE 2 · [D] dos pulsaciones no duplican el historial ──');
{
    const { sb } = montar('break', { h1: 1800 });
    pulsar(sb);
    pulsar(sb);

    ok('2a · sigue en 2ª parte', sb.matchPhase === '2nd_half');
    ok('2b · 🔑 el "Entra (2ªP)" NO se duplica',
       sb.players[0].history.length === 1,
       JSON.stringify(sb.players[0].history));
    // La 2ª pulsación ya es una pausa normal, que es lo correcto.
    ok('2c · la segunda pulsación pausa, como cualquier PAUSAR',
       sb.isRunning === false);
}

// ═══════════ PARTE 3 · [B] las demás fases, intactas ═══════════
console.log('\n── PARTE 3 · [B] el resto de fases no cambia ──');
{
    // Arranque de la 1ª parte.
    const a = montar('1st_half');
    pulsar(a.sb);
    ok('3a · 1ª parte: EMPEZAR arranca el reloj',
       a.sb.isRunning === true && a.sb._intervalos === 1 && a.sb.matchPhase === '1st_half');
    ok('3b · y no toca el historial de nadie',
       a.sb.players.every(p => p.history.length === 0));

    // Pausa y reanudación en juego (el caso que el autor dice que YA iba bien).
    pulsar(a.sb);
    ok('3c · 1ª parte: la 2ª pulsación PAUSA',
       a.sb.isRunning === false && a.boton.textContent === 'REANUDAR');
    pulsar(a.sb);
    ok('3d · 1ª parte: la 3ª REANUDA, sin cambiar de fase',
       a.sb.isRunning === true && a.sb.matchPhase === '1st_half' && a.boton.textContent === 'PAUSAR');

    // Lo mismo en la 2ª parte.
    const b = montar('2nd_half');
    pulsar(b.sb);
    ok('3e · 2ª parte: arranca sin tocar la fase ni el historial',
       b.sb.isRunning === true && b.sb.matchPhase === '2nd_half' &&
       b.sb.players.every(p => p.history.length === 0));
    pulsar(b.sb);
    ok('3f · 2ª parte: pausa correctamente', b.sb.isRunning === false);
}

// ═══════════ PARTE 4 · [C] el enrutado NO puede vivir en toggleGame ═══════════
console.log('\n── PARTE 4 · [C] 🔑 toggleGame() sigue siendo tonta ──');
{
    // Llamada DIRECTA a toggleGame estando en descanso: es lo que hace la
    // recuperación de partido de setup-modal.js cuando el snapshot trae
    // isRunning. Si algún día el enrutado se mueve dentro de toggleGame, esto
    // se pondría rojo — y con razón: retomar un partido en descanso arrancaría
    // la 2ª parte SOLO y escribiría "Entra (2ªP)" en todos los jugadores.
    const { sb } = montar('break', { h1: 1800 });
    vm.runInContext('toggleGame()', sb);

    ok('4a · 🔑 toggleGame() en descanso NO cambia de fase',
       sb.matchPhase === 'break',
       'la fase cambió a ' + sb.matchPhase + ': el enrutado se ha metido dentro de toggleGame');
    ok('4b · 🔑 y NO escribe nada en el historial',
       sb.players.every(p => p.history.length === 0),
       'retomar un partido en descanso estaría inventando la 2ª parte');

    // Y la comprobación estructural que lo acompaña.
    const cuerpoToggle = extractFn(CORE_SRC, 'toggleGame');
    ok('4c · toggleGame no menciona startSecondHalf',
       !/startSecondHalf/.test(cuerpoToggle));
    ok('4d · el manejador del clic existe y es quien enruta',
       /window\.onPlayPauseClick\s*=/.test(EV_SRC) &&
       /matchPhase\s*===\s*'break'/.test(EV_SRC));
    ok('4e · el botón está enganchado al manejador, no a toggleGame',
       /addEventListener\('click',\s*window\.onPlayPauseClick\)/.test(EV_SRC) &&
       !/addEventListener\('click',\s*toggleGame\)/.test(EV_SRC),
       'si vuelve a colgar de toggleGame, el descanso se queda muerto otra vez');
}

// ═══════════ PARTE 5 · la cadena completa de un partido ═══════════
console.log('\n── PARTE 5 · un partido entero, de principio a fin ──');
{
    const { sb, boton } = montar('1st_half');

    pulsar(sb);                                    // EMPEZAR
    ok('5a · arranca la 1ª parte', sb.isRunning === true && sb.matchPhase === '1st_half');

    sb.masterTimeH1 = 1800;
    vm.runInContext('endFirstHalf(true)', sb);     // 🏁 fin de la 1ª
    ok('5b · el descanso deja el botón en REANUDAR y el reloj parado',
       sb.matchPhase === 'break' && sb.isRunning === false &&
       boton.textContent === 'REANUDAR' && !boton._clases.has('danger'));
    ok('5c · los del campo tienen su "Sale (DESCANSO)"',
       sb.players[0].history.length === 1 && /Sale .*\(DESCANSO\)/.test(sb.players[0].history[0]));

    pulsar(sb);                                    // ▶ REANUDAR — el caso del reporte
    ok('5d · 🔑 desde el DESCANSO, REANUDAR mete al equipo en la 2ª parte',
       sb.matchPhase === '2nd_half' && sb.isRunning === true && boton.textContent === 'PAUSAR');
    ok('5e · sin perder el "Sale (DESCANSO)" anterior',
       sb.players[0].history.length === 2 &&
       /Sale/.test(sb.players[0].history[0]) && /Entra/.test(sb.players[0].history[1]),
       JSON.stringify(sb.players[0].history));
    ok('5f · el estado se persiste en cada transición',
       (sb._guardados || 0) >= 2, 'guardados: ' + sb._guardados);
}

// ═══════════ PARTE 6 · EL RELOJ AVANZA DE VERDAD ═══════════
// ⚠️ Esta es la aserción que de verdad describe el defecto, y la descubrió el
// red-check: sobre el código ANTERIOR, "el botón pasa a PAUSAR" y "arranca un
// intervalo" SEGUÍAN PASANDO. El botón no estaba muerto — cambiaba de aspecto y
// programaba su intervalo tan campante. Lo que no ocurría es que el CRONÓMETRO
// AVANZARA, porque `tick()` sólo suma en '1st_half' y '2nd_half' y la fase
// seguía siendo 'break'. De ahí que el autor lo viera como "no hace nada".
//
// Por eso aquí se carga el `tick` REAL y se comprueba el único hecho que no
// admite interpretación: después de pulsar, el tiempo de la 2ª parte sube.
console.log('\n── PARTE 6 · 🔑🔑 tras pulsar, el cronómetro AVANZA ──');
{
    const { sb } = montar('break', { h1: 1800 });

    // El tick real, con lo que necesita para contar.
    sb.half1MaxTime = 1800;
    sb.half2MaxTime = 1800;
    sb.currentMode = 'f7';
    sb.updatePlayerUI = () => {};
    sb.renderOptimizer = null;
    sb.syncTimerWithServer = () => {};
    sb.endFirstHalfAuto = () => {};
    // Estado de nivel superior de core.js que `tick` lee por nombre pelado.
    vm.runInContext('var _lastServerSync = 0; var _SERVER_SYNC_INTERVAL_MS = 5000;', sb);
    vm.runInContext(extractFn(CORE_SRC, 'tick') + '\n;globalThis.tick = tick;', sb);

    ok('6a · antes de pulsar, la 2ª parte está a cero', sb.masterTimeH2 === 0);

    pulsar(sb);

    // Dos segundos de reloj de pared.
    sb.lastTickTime = Date.now() - 2000;
    vm.runInContext('tick()', sb);

    ok('6b · 🔑🔑 el cronómetro de la 2ª parte AVANZA tras pulsar REANUDAR',
       sb.masterTimeH2 > 0,
       'masterTimeH2 = ' + sb.masterTimeH2 + ' · fase = ' + sb.matchPhase +
       ' — el botón puede decir PAUSAR y tener intervalo, y aun así no contar');
    ok('6c · y lo hace en la 2ª parte, no en la 1ª',
       sb.masterTimeH1 === 1800,
       'masterTimeH1 = ' + sb.masterTimeH1);
    ok('6d · los jugadores en campo también suman tiempo',
       sb.players[0].time > 0 && sb.players[2].time === 0,
       'campo=' + sb.players[0].time + ' banquillo=' + sb.players[2].time);
}

console.log('\n' + '─'.repeat(60));
console.log(`Resultado: ${pass} PASS · ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

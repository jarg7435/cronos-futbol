// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v716 · EL RELOJ TIENE UN SOLO DUEÑO Y EL BOTÓN NO MIENTE
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-14, IMG_0583/0584, iPad, v715):
//   1 · «el cronómetro sufre un comportamiento errático en bucle (retrocediendo
//       de dos en dos o desincronizándose)»;
//   2 · «el reloj puede estar corriendo en la interfaz táctica pero el sistema
//       detecta falsamente que está detenido… el estado del botón debe ir
//       estrictamente unificado y sincronizado con el estado real»;
//   3 · «la aplicación impide registrar goles… arrojando el aviso de que el
//       cronómetro está detenido».
//
//  📏 LA MEDICIÓN QUE LO EXPLICA (las dos capturas, mismo minuto): la cabecera
//  va por 04:42 de 05:00 —18 s jugados— y las fichas marcan 02:02. Entre una
//  captura y la otra el maestro avanza 2 s y los jugadores 27 s. Los dos
//  números los suma LA MISMA línea de `tick()` con el mismo delta, así que no
//  pueden separarse solos. Y el botón dice EMPEZAR: `isRunning === false`
//  mientras el reloj corre.
//
//  🔑🔑 LA CAUSA: `tick()` no miraba `isRunning`. Lo único que lo paraba era
//  apagar su `setInterval`, y ese intervalo tenía CUATRO creadores de los
//  cuales `toggleGame` NO limpiaba el anterior → dos intervalos vivos y una
//  sola variable donde guardarlos → al pausar se apaga el último y el otro
//  sigue latiendo con el partido en pausa. Desde ahí, en cascada: el latido en
//  vivo sólo emite `if (liveIsActive && isRunning)`, así que el documento se
//  queda con el tiempo viejo; el vigía de v638 lo lee y CORRIGE LA DERIVA
//  tirando del maestro hacia atrás cada 5 s (el «de dos en dos»: el umbral son
//  2 s); y los goles se bloquean por `!isRunning` con el partido en marcha.
//
//  LO QUE VIGILA:
//   A · `tick` NO SUMA SIN RELOJ EN MARCHA. Un huérfano deja de poder mover el
//       reloj aunque exista.
//   B · UN SOLO INTERVALO CON DUEÑO: se apaga antes de encender, en los cinco
//       sitios que lo tocan.
//   C · EL BOTÓN SALE DEL ESTADO (`cronosPintaBotonReloj`) y se repinta en cada
//       `updateMasterUI`, así que no puede quedarse atrás.
//   D · LA DERIVA NO TIRA DEL RELOJ HACIA ATRÁS con nuestro propio eco viejo,
//       pero SÍ deja ponerse al día (el caso de v638) y SÍ obedece un cambio
//       manual de duración.
//   E · UNA SOLA PREGUNTA para los tres bloqueos de goles/tarjetas.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 400));
        fallos++;
    }
}
function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    if (i < 0) return null;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}
const sinComentarios = (s) => String(s || '').replace(/^\s*\/\/.*$/gm, '');

const TIMER  = leer('js/match/timer/core.js');
const APPINI = leer('js/core/app-init.js');
const EVENTS = leer('js/core/event-listeners.js');
const SETUP  = leer('js/core/setup-modal.js');
const MOVLOG = leer('js/match/events/movement-log.js');
const ACTION = leer('js/match/events/player-actions.js');

// Monta el reloj real (las cinco piezas) sobre un DOM simulado.
function montarReloj(estado) {
    const e = estado || {};
    const intervalos = [], limpiados = [];
    const boton = { textContent: e.boton || 'EMPEZAR',
                    classList: { _c: {}, add(x) { this._c[x] = 1; }, remove(x) { delete this._c[x]; } } };
    const ctx = {
        console: { warn() {}, log() {} }, Date, Math, String, Number,
        isRunning:    e.isRunning === true,
        matchPhase:   e.matchPhase || '1st_half',
        masterTimeH1: e.h1 || 0,
        masterTimeH2: e.h2 || 0,
        half1MaxTime: 300, half2MaxTime: 300,   // los 5 minutos por parte del autor
        currentMode:  'f11',
        lastTickTime: e.lastTickTime || (Date.now() - 1000),
        timerInterval: e.timerInterval || null,
        liveIsActive: true, liveMatchId: 'p1',
        players: [{ id: 1, status: 'field', time: e.tJug || 0 }, { id: 2, status: 'bench', time: 0 }],
        setInterval:  (fn, ms) => { intervalos.push(ms); return 'int-' + intervalos.length; },
        clearInterval: (id) => { limpiados.push(id === undefined ? null : id); },
        updatePlayerUI: () => {},
        syncTimerWithServer: () => {},
        _arrancarVigiaReloj: () => {},
        pushLiveSnapshot: () => ({ catch() {} }),
    };
    ctx.document = { getElementById: (id) => (id === 'btn-play-pause' ? boton : null) };
    ctx.window = { _cronosUltimoToggleLocal: e.pulsado || 0, _CRONOS_DEBUG: false };
    ctx.updateMasterUI = () => { ctx._pintado = (ctx._pintado || 0) + 1; cronosLlama(ctx); };
    vm.createContext(ctx);
    const codigo = [
        // El tick consulta el reloj de sincronización: se declara como en el
        // fichero (v638) para poder ejecutarlo tal cual.
        'let _lastServerSync = 0;',
        'const _SERVER_SYNC_INTERVAL_MS = 5000;',
        trozo(TIMER, 'function _cronosArrancaReloj()'),
        trozo(TIMER, 'function _cronosParaReloj()'),
        trozo(TIMER, 'function cronosPintaBotonReloj()'),
        trozo(TIMER, 'function cronosPartidoEnJuego()'),
        trozo(TIMER, 'function toggleGame()'),
        trozo(TIMER, 'function tick()'),
        'this.__toggle = toggleGame; this.__tick = tick; this.__pinta = cronosPintaBotonReloj;' +
        'this.__enJuego = cronosPartidoEnJuego; this.__arranca = _cronosArrancaReloj;' +
        'this.__para = _cronosParaReloj;',
    ].join('\n');
    vm.runInContext(codigo, ctx);
    function cronosLlama(c) { try { c.__pinta(); } catch (err) {} }
    return { ctx, boton, intervalos, limpiados };
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [A] el tick no suma sin reloj en marcha ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const parado = montarReloj({ isRunning: false, h1: 18, tJug: 122 });
    parado.ctx.__tick();
    ok('1a · 🔑🔑 [A] con el reloj PARADO, el tick no suma NADA',
       parado.ctx.masterTimeH1 === 18 && parado.ctx.players[0].time === 122,
       'H1=' + parado.ctx.masterTimeH1 + ' ficha=' + parado.ctx.players[0].time);
    ok('1b · 🔑 es la diferencia exacta de la captura: la ficha ya no puede ' +
       'seguir subiendo con el partido en pausa',
       parado.ctx.players[0].time === 122);

    const enMarcha = montarReloj({ isRunning: true, h1: 18, tJug: 122 });
    enMarcha.ctx.__tick();
    ok('1c · en marcha, el tick suma a la vez al maestro y a la ficha',
       enMarcha.ctx.masterTimeH1 === 19 && enMarcha.ctx.players[0].time === 123,
       'H1=' + enMarcha.ctx.masterTimeH1 + ' ficha=' + enMarcha.ctx.players[0].time);
    ok('1d · y sólo a quien está EN CAMPO', enMarcha.ctx.players[1].time === 0);
    ok('1e · ⚠️ la guarda es del ESTADO, no del intervalo (un huérfano ya no ' +
       'puede mover el reloj aunque siga vivo)',
       /if \(typeof isRunning === 'undefined' \|\| !isRunning\) return;/
         .test(sinComentarios(trozo(TIMER, 'function tick()'))));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [B] un solo intervalo, con dueño ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const t = montarReloj({ isRunning: false, timerInterval: 'viejo' });
    t.ctx.__arranca();
    ok('2a · 🔑🔑 [B] arrancar el reloj APAGA el anterior antes de encender',
       t.limpiados.length === 1 && t.intervalos.length === 1,
       'limpiados=' + JSON.stringify(t.limpiados) + ' creados=' + t.intervalos.length);
    ok('2b · y re-ancla lastTickTime (si no, el primer tick suma el hueco entero)',
       t.ctx.lastTickTime > Date.now() - 500);

    // Dos arranques seguidos NO pueden dejar dos intervalos vivos.
    const d = montarReloj({ isRunning: true });
    d.ctx.__arranca(); d.ctx.__arranca();
    ok('2c · 🔑🔑 [B] dos arranques seguidos = dos apagados: NUNCA dos ' +
       'intervalos vivos (era el intervalo huérfano del reporte)',
       d.intervalos.length === 2 && d.limpiados.length === 2);

    const p = montarReloj({ isRunning: true, timerInterval: 'vivo' });
    p.ctx.__para();
    ok('2d · parar el reloj lo apaga y suelta la referencia',
       p.limpiados.length === 1 && p.ctx.timerInterval === null);

    // Y toggleGame ya no programa el intervalo a mano.
    const tg = sinComentarios(trozo(TIMER, 'function toggleGame()'));
    ok('2e · 🔑 `toggleGame` usa la puerta única y NO su propio setInterval',
       /_cronosArrancaReloj\(\)/.test(tg) && /_cronosParaReloj\(\)/.test(tg) &&
       !/setInterval\(/.test(tg),
       'era el único de los cuatro creadores que no limpiaba el anterior');

    // Los otros cuatro creadores, cada uno en su fichero.
    [['app-init (retomar partido)', APPINI], ['event-listeners (volver a la pestaña)', EVENTS],
     ['setup-modal (recuperar de la nube)', SETUP], ['movement-log (reiniciar)', MOVLOG],
    ].forEach(([nombre, src]) => {
        ok('2f · ' + nombre + ' pasa por la puerta única',
           /_cronosArrancaReloj|_cronosParaReloj/.test(sinComentarios(src)));
    });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · [C] el botón dice lo que el reloj ES ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const casos = [
        ['sin empezar (crono a 0, nadie ha pulsado)', { isRunning: false }, 'EMPEZAR'],
        ['en marcha', { isRunning: true, h1: 10 }, 'PAUSAR'],
        ['🔑 pausado con tiempo jugado', { isRunning: false, h1: 18 }, 'REANUDAR'],
        ['🔑 pausado en el segundo 0 pero YA pulsado', { isRunning: false, pulsado: Date.now() }, 'REANUDAR'],
        ['en el DESCANSO', { isRunning: false, matchPhase: 'break' }, 'REANUDAR'],
        ['partido terminado', { isRunning: false, matchPhase: 'finished', h1: 300 }, 'P. FINALIZADO'],
        ['2ª parte en marcha', { isRunning: true, matchPhase: '2nd_half', h2: 5 }, 'PAUSAR'],
    ];
    let bien = 0; const malos = [];
    casos.forEach(([etq, est, esperado]) => {
        const m = montarReloj(est);
        const r = m.ctx.__pinta();
        if (r === esperado && m.boton.textContent === esperado) bien++;
        else malos.push(etq + ': ' + r + ' (esperado ' + esperado + ')');
    });
    ok('3a · 🔑🔑 [C] el botón sale del estado en los ' + casos.length + ' casos',
       bien === casos.length, malos.join(' || '));

    const m = montarReloj({ isRunning: true, h1: 10 });
    m.ctx.__pinta();
    ok('3b · en marcha lleva la clase `danger` (rojo de PAUSAR)',
       m.boton.classList._c.danger === 1);
    m.ctx.isRunning = false;
    m.ctx.__pinta();
    ok('3c · y al pausar se la quita', m.boton.classList._c.danger === undefined);

    // 🔑 El repintado automático: `updateMasterUI` llama al pintor, así que
    // cualquier cambio de estado que repinte deja el botón al día.
    ok('3d · 🔑🔑 [C] `updateMasterUI` repinta el botón (por eso no puede ' +
       'quedarse atrás en ninguno de los ocho sitios que lo tocaban)',
       /cronosPintaBotonReloj\(\);/.test(sinComentarios(trozo(TIMER, 'function updateMasterUI()'))));

    // Y un partido reiniciado vuelve a decir EMPEZAR.
    ok('3e · 🔑 `resetMatch` borra la marca de «ya pulsado», o el pintor ' +
       'seguiría diciendo REANUDAR en un partido nuevo',
       /_cronosUltimoToggleLocal = 0/.test(sinComentarios(trozo(MOVLOG, 'function resetMatch()'))));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · [D] la deriva no tira del reloj hacia atrás ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fn = trozo(TIMER, 'async function syncTimerWithServer()');
    ok('4a · se encuentra el sincronizador', !!fn);

    const montar = (servidor, local) => {
        const ctx = {
            console: { warn() {}, log() {} }, Date, Math, String, Number,
            isRunning: local.isRunning, masterTimeH1: local.h1, masterTimeH2: local.h2 || 0,
            matchPhase: local.fase || '1st_half', lastTickTime: 0, timerInterval: null,
            liveMatchId: 'p1', liveIsActive: true,
            updateMasterUI: () => {}, setInterval: () => 1, clearInterval: () => {}, tick: () => {},
            document: { getElementById: () => ({ textContent: '', classList: { add() {}, remove() {} } }) },
        };
        ctx.window = { _cronos_auth: { db: {} }, _CRONOS_DEBUG: false,
                       renderOptimizer: null, _cronosUltimoToggleLocal: 0, _cronosUltimoLatidoOk: 0 };
        ctx.__imp = async () => ({ doc: () => ({}), getDoc: async () => ({ exists: () => true, data: () => servidor }) });
        vm.createContext(ctx);
        vm.runInContext(['let _lastServerSync = 0;', 'const _SERVER_SYNC_INTERVAL_MS = 5000;',
            TIMER.match(/let _maxDriftAllowed = \d+;/)[0], 'let _vigiaReloj = null;',
            'const _GRACIA_PULSACION_MS = 8000;',
            trozo(TIMER, 'function _mandaLaPulsacionLocal()'),
            trozo(TIMER, 'function _cronosArrancaReloj()'),
            trozo(TIMER, 'function _cronosParaReloj()'),
            trozo(TIMER, 'function cronosPintaBotonReloj()'),
            trozo(TIMER, 'function _arrancarVigiaReloj()'),
            trozo(TIMER, 'function _adoptarMarchaDelServidor(servidorCorre)'),
            fn, 'this.__sync = syncTimerWithServer;'].join('\n').replace(/\bimport\s*\(/g, '__imp('), ctx);
        return ctx;
    };

    (async () => {
        // 🔑 EL BUCLE DEL REPORTE: nuestro propio eco, 10 s por detrás.
        const eco = montar({ isRunning: true, timeH1: 18, timeH2: 0 },
                           { isRunning: true, h1: 28 });
        await eco.__sync();
        ok('4b · 🔑🔑 [D] con el reloj EN MARCHA, un servidor por detrás NO ' +
           'tira del reloj hacia atrás (era el «retrocediendo de dos en dos»)',
           eco.masterTimeH1 === 28, 'H1=' + eco.masterTimeH1);

        // ⚠️ v638 SIGUE EN PIE: ponerse al día con quien va por delante.
        const atrasado = montar({ isRunning: true, timeH1: 660, timeH2: 0 },
                                { isRunning: true, h1: 600 });
        await atrasado.__sync();
        ok('4c · ⚠️ [D] pero SÍ se pone al día con quien va por delante (v638)',
           atrasado.masterTimeH1 === 660, 'H1=' + atrasado.masterTimeH1);

        // Un cambio manual de duración sí manda, aunque sea hacia atrás.
        const manual = montar({ isRunning: true, timeH1: 60, timeH2: 0 },
                              { isRunning: true, h1: 600 });
        await manual.__sync();
        ok('4d · 🔑 un salto GRANDE hacia atrás sí se obedece: es un cambio ' +
           'manual de duración, no latencia',
           manual.masterTimeH1 === 60, 'H1=' + manual.masterTimeH1);

        // En pausa se adopta lo que diga el servidor, sin condiciones.
        const pausa = montar({ isRunning: false, timeH1: 18, timeH2: 0 },
                             { isRunning: false, h1: 28 });
        await pausa.__sync();
        ok('4e · en PAUSA se adopta sin condiciones (no hay nada corriendo)',
           pausa.masterTimeH1 === 18, 'H1=' + pausa.masterTimeH1);

        // Y la 2ª parte con la misma regla, sin pisar la 1ª.
        const seg = montar({ isRunning: true, timeH1: 300, timeH2: 20 },
                           { isRunning: true, h1: 300, h2: 40, fase: '2nd_half' });
        await seg.__sync();
        ok('4f · la misma regla en la 2ª parte, y sin tocar la 1ª',
           seg.masterTimeH2 === 40 && seg.masterTimeH1 === 300,
           'H1=' + seg.masterTimeH1 + ' H2=' + seg.masterTimeH2);

        // ═══════════════════════════════════════════════════════════════════
        console.log('\n── PARTE 5 · [E] una sola pregunta para los bloqueos ──');
        // ═══════════════════════════════════════════════════════════════════
        const enJuego = montarReloj({ isRunning: true, h1: 10 });
        ok('5a · con el partido en marcha, se pueden registrar sucesos',
           enJuego.ctx.__enJuego() === true);
        const parado = montarReloj({ isRunning: false, h1: 10 });
        ok('5b · en pausa, no', parado.ctx.__enJuego() === false);
        const fin = montarReloj({ isRunning: true, matchPhase: 'finished', h1: 300 });
        ok('5c · ⚠️ y un partido TERMINADO no acepta sucesos ni con el reloj ' +
           'en marcha', fin.ctx.__enJuego() === false);

        const tresSitios = [
            ['changeScore (marcador)',            trozo(MOVLOG, 'function changeScore(team, delta)')],
            ['changeGoals (ficha del jugador)',   trozo(ACTION, 'function changeGoals(amount)')],
            ['clearPlayerActions',                trozo(ACTION, 'function clearPlayerActions()')],
        ];
        let usan = 0; const sinUsar = [];
        tresSitios.forEach(([nombre, src]) => {
            if (src && /cronosPartidoEnJuego\(\)/.test(src)) usan++; else sinUsar.push(nombre);
        });
        ok('5d · 🔑🔑 [E] los TRES bloqueos preguntan por la misma puerta',
           usan === 3, 'sin usarla: ' + sinUsar.join(', '));
        ok('5e · ⚠️ y el aviso sigue existiendo (el bloqueo es correcto: lo que ' +
           'fallaba era la respuesta)',
           /cronómetro del partido detenido/.test(MOVLOG) &&
           /cronómetro del partido detenido/.test(ACTION));

        console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
        if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }
    })();
}

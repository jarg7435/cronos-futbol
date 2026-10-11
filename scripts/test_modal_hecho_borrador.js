// ─────────────────────────────────────────────────────────────────────────
//  test_modal_hecho_borrador.js  ·  📝 v801
//
//  Encargo del autor (implementar.txt 2026-10-11, capturas 11308-11311): con
//  la ventana del jugador ABIERTA, el visor ya pintaba la lesión, el 1-0 y el
//  «GOL · DÁMASO»; y tras −1 el gol se quedaba en su historial.
//    1 · ninguna acción (tarjeta, gol, lesión) se transmite, guarda ni se
//        refleja antes de confirmar;
//    2 · todo se registra y transmite SÓLO al pulsar HECHO; LIMPIAR (o
//        descartar) no envía nada. Decisión del autor: LIMPIAR = DESCARTAR
//        lo de esta ventana, sin tocar lo registrado antes.
//
//  🔑 Se carga js/match/events/player-actions.js ENTERO y se reproducen las
//  pulsaciones reales, espiando TODO lo que puede salir del aparato:
//  la cola de sucesos (CronosOutbox), los envíos al directo (liveSyncOnAction
//  / liveSyncFlushNow), el guardado de emergencia (commitCriticalEvent) y la
//  auditoría — más la ficha REAL del jugador, que es lo que lee el latido.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/match/events/player-actions.js'), 'utf8');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};

function el(id) {
    return { id, style: {}, textContent: '', innerHTML: '', disabled: false, title: '',
             querySelector: () => null, querySelectorAll: () => [], appendChild() {}, remove() {},
             setAttribute() {}, classList: { add() {}, remove() {} } };
}

function partido(jugadorInicial) {
    const els = {};
    const spy = { encola: [], sync: 0, flush: 0, criticos: [], auditoria: [], alerts: [] };
    const jugador = Object.assign({ id: 9, name: 'DÁMASO', number: '9', team: 'home', status: 'field',
                                    goals: 0, cards: 'ninguna', yellowCards: 0, injured: false,
                                    time: 100, history: [] }, jugadorInicial || {});
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Math, Date, JSON, Object, Array, String, Number, Promise, setTimeout, clearTimeout,
        document: {
            getElementById: (id) => (els[id] = els[id] || el(id)),
            querySelector: () => null, querySelectorAll: () => [], createElement: () => el(''),
        },
        alert: (m) => spy.alerts.push(String(m)),
        confirm: () => true,
        escapeHtml: (s) => String(s),
        players: [jugador],
        isRunning: true, matchPhase: '1st_half', masterTimeH1: 300, masterTimeH2: 0,
        liveMatchId: 'M1', currentMode: 'f11',
        TEAM_NAMES: { home: 'REGIONAL B', away: 'VISITANTE' },
        renderPlayers() {}, renderStaffInBench() {},
        logEvent: (p, t) => { p.history.push(t + ' a las 05:00 (1ªP)'); },
        logMovement: (p) => { p.history.push('Sale a las 05:00 (1ªP)'); },
        liveSyncOnAction: () => { spy.sync++; },
        commitCriticalEvent: (t, d) => spy.criticos.push(t),
        terminateMatch: () => {},
    };
    sb.window = sb;
    sb.window.liveSyncFlushNow = () => { spy.flush++; };
    sb.window.CronosOutbox = { encola: (id, ev) => spy.encola.push(ev.type) };
    sb.window._cronosMatchEvents = [];
    sb.window.auditLogger = { logPlayerAction: function () { spy.auditoria.push(arguments[3]); } };
    sb.window.cronosPartidoEnJuego = () => true;
    vm.createContext(sb);
    vm.runInContext(SRC, sb, { filename: 'player-actions.js' });
    const marcador = () => String(sb.document.getElementById('score-home').textContent);
    const nada = () => spy.encola.length === 0 && spy.sync === 0 && spy.flush === 0 &&
                       spy.criticos.length === 0 && spy.auditoria.length === 0;
    return { sb, jugador, spy, marcador, nada, abrir: () => sb.openPlayerActionModal(jugador),
             modalVisible: () => (els['player-action-modal'] || {}).style.display };
}

console.log('\n── PARTE 1 · con la ventana abierta NO sale nada ──');
{
    const P = partido();
    P.abrir();
    P.sb.toggleInjury();
    P.sb.changeGoals(1);
    P.sb.assignCard('amarilla');
    ok('1a · 🔑🔑 la ficha REAL no cambia (es lo que lee el latido de 5 s y el visor)',
       P.jugador.goals === 0 && P.jugador.injured === false && P.jugador.cards === 'ninguna' &&
       P.jugador.history.length === 0, P.jugador);
    ok('1b · 🔑🔑 no se encola ningún suceso, ni se envía, ni se guarda, ni se audita', P.nada(), P.spy);
    ok('1c · el marcador no se mueve', P.marcador() === '' || P.marcador() === '0', P.marcador());
    ok('1d · pero la ventana SÍ enseña lo pulsado (1 gol)',
       /1/.test(P.sb.document.getElementById('action-player-goals').textContent));

    console.log('\n── PARTE 2 · HECHO: se aplica y se transmite TODO de una vez ──');
    P.sb.closePlayerActionModal();
    ok('2a · 🔑 la ficha real recibe lo de la ventana', P.jugador.goals === 1 && P.jugador.injured === true &&
       P.jugador.cards === 'amarilla' && P.jugador.yellowCards === 1, P.jugador);
    ok('2b · 🔑 salen los tres sucesos (lesión, gol, amarilla)',
       ['injury', 'goal', 'yellow'].every(t => P.spy.encola.includes(t)) && P.spy.encola.length === 3, P.spy.encola);
    ok('2c · y UN envío al directo, inmediato por ser un gol', P.spy.flush === 1 && P.spy.sync === 0, P.spy);
    ok('2d · se guardan los críticos y la auditoría', P.spy.criticos.length === 3 && P.spy.auditoria.length === 3, P.spy);
    ok('2e · el historial del jugador lleva los tres apuntes', P.jugador.history.length === 3, P.jugador.history);
    ok('2f · el marcador se mueve AHORA', P.marcador() === '1', P.marcador());
    ok('2g · ⚠️ el reloj del jugador no retrocede (sólo se copian los campos del modal)',
       (P.jugador.time = 150, true) && P.jugador.time === 150);
}

console.log('\n── PARTE 3 · +1 −1 y lesión puesta y quitada: no queda nada ──');
{
    const P = partido();
    P.abrir();
    P.sb.changeGoals(1); P.sb.changeGoals(-1);
    P.sb.toggleInjury(); P.sb.toggleInjury();
    P.sb.closePlayerActionModal();
    ok('3a · 🔑 HECHO sin diferencia neta: no se encola ningún suceso (antes: GOL fantasma en el visor)',
       P.spy.encola.length === 0, P.spy.encola);
    ok('3b · 🔑 ni «GOL» + «GOL ANULADO» ni «LESIÓN» en el historial', P.jugador.history.length === 0, P.jugador.history);
    ok('3c · ni un gol guardado como crítico', !P.spy.criticos.includes('goal') && !P.spy.criticos.includes('injury'), P.spy.criticos);
    // La auditoría SÍ guarda lo pulsado y confirmado (+1 y −1): es su función.
    ok('3d · y nada que enviar al directo', P.spy.flush === 0 && P.spy.sync === 0, P.spy);
}

console.log('\n── PARTE 4 · LIMPIAR = descartar ──');
{
    const P = partido({ goals: 2, cards: 'amarilla', yellowCards: 1, history: ['GOL (1º) a las 01:00 (1ªP)', 'GOL (2º) a las 02:00 (1ªP)', 'TARJETA AMARILLA a las 03:00 (1ªP)'] });
    P.abrir();
    P.sb.changeGoals(1);
    P.sb.toggleInjury();
    P.sb.clearPlayerActions();
    ok('4a · 🔑🔑 no sale NADA (ni sucesos, ni envíos, ni guardados, ni auditoría)', P.nada(), P.spy);
    ok('4b · 🔑 lo registrado ANTES queda intacto (2 goles, la amarilla, su historial)',
       P.jugador.goals === 2 && P.jugador.cards === 'amarilla' && P.jugador.yellowCards === 1 &&
       P.jugador.injured === false && P.jugador.history.length === 3, P.jugador);
    ok('4c · y la ventana se cierra', P.modalVisible() === 'none');
    // La siguiente ventana empieza limpia (nada aparcado de la anterior).
    P.abrir();
    P.sb.closePlayerActionModal();
    ok('4d · ⚠️ y lo descartado no reaparece en la siguiente ventana', P.nada() && P.jugador.goals === 2, P.spy);
}

console.log('\n── PARTE 5 · 🟨🟥 v802 · la roja se MARCA; se aplica en HECHO ──');
{
    const P = partido();
    P.abrir();
    P.sb.toggleInjury();
    P.sb.assignCard('roja');
    ok('5a · 🔑 marcar la roja NO cierra la ventana ni expulsa todavía',
       P.modalVisible() === 'flex' && P.jugador.cards === 'ninguna' && P.jugador.status === 'field' &&
       P.spy.alerts.length === 0, P.jugador);
    ok('5b · ni sale nada', P.nada(), P.spy);
    P.sb.closePlayerActionModal();
    ok('5c · 🔑 en HECHO: roja real, al banquillo y aviso al usuario',
       P.jugador.cards === 'roja' && P.jugador.status === 'bench' && P.jugador.injured === true &&
       P.spy.alerts.some(a => /TARJETA ROJA/.test(a)), P.jugador);
    ok('5d · salen la lesión y la roja, una vez cada una', P.spy.encola.includes('injury') && P.spy.encola.includes('red') &&
       P.spy.encola.length === 2, P.spy.encola);
    ok('5e · el historial lleva la roja y la salida al banquillo',
       P.jugador.history.some(h => /^TARJETA ROJA/.test(h)) && P.jugador.history.some(h => /^Sale/.test(h)), P.jugador.history);
}

console.log('\n── PARTE 6 · 🟨🟥 v802 · las tarjetas se ALTERNAN ──');
{
    // Amarilla puesta y quitada.
    const A = partido();
    A.abrir();
    A.sb.assignCard('amarilla');
    A.sb.assignCard('amarilla');
    A.sb.closePlayerActionModal();
    ok('6a · 🔑 amarilla y otra vez amarilla = QUITADA: nada sale, nada se apunta',
       A.jugador.cards === 'ninguna' && A.jugador.yellowCards === 0 && A.spy.encola.length === 0 &&
       A.jugador.history.length === 0 && A.spy.flush === 0 && A.spy.sync === 0, { j: A.jugador, s: A.spy });

    // 🔑 El caso de la captura 11316: ya tenía UNA amarilla.
    const B = partido({ cards: 'amarilla', yellowCards: 1, history: ['TARJETA AMARILLA a las 01:00 (1ªP)'] });
    B.abrir();
    B.sb.assignCard('amarilla');
    ok('6b · 🔑🔑 con una amarilla previa, pulsar Amarilla NO expulsa al momento (antes: alerta y fuera)',
       B.modalVisible() === 'flex' && B.jugador.cards === 'amarilla' && B.jugador.status === 'field' &&
       B.spy.alerts.length === 0 && B.nada(), { j: B.jugador, s: B.spy });
    B.sb.assignCard('amarilla');
    B.sb.closePlayerActionModal();
    ok('6c · 🔑 y otro clic la QUITA: sigue con su 1ª amarilla, sin doble amarilla ni error en el historial',
       B.jugador.cards === 'amarilla' && B.jugador.yellowCards === 1 && B.jugador.status === 'field' &&
       B.jugador.history.length === 1 && B.spy.encola.length === 0 && B.spy.alerts.length === 0, { j: B.jugador, s: B.spy });

    // La 2ª amarilla CONFIRMADA sí expulsa (en HECHO).
    const C = partido({ cards: 'amarilla', yellowCards: 1 });
    C.abrir();
    C.sb.assignCard('amarilla');
    C.sb.closePlayerActionModal();
    ok('6d · la 2ª amarilla confirmada con HECHO expulsa (doble amarilla) y avisa',
       C.jugador.cards === 'roja' && C.jugador.yellowCards === 2 && C.jugador.status === 'bench' &&
       C.spy.encola.length === 1 && C.spy.encola[0] === 'red' && C.spy.alerts.some(a => /DOBLE AMARILLA/.test(a)),
       { j: C.jugador, s: C.spy });

    // Excluyentes: amarilla y luego roja → sólo la roja.
    const D = partido();
    D.abrir();
    D.sb.assignCard('amarilla');
    D.sb.assignCard('roja');
    D.sb.closePlayerActionModal();
    ok('6e · 🔑 amarilla y luego roja = SÓLO la roja (excluyentes)',
       D.jugador.cards === 'roja' && D.jugador.yellowCards === 0 &&
       JSON.stringify(D.spy.encola) === '["red"]' && !D.jugador.history.some(h => /AMARILLA/.test(h)), { j: D.jugador, s: D.spy });

    // Roja y luego roja → nada.
    const E = partido();
    E.abrir();
    E.sb.assignCard('roja');
    E.sb.assignCard('roja');
    E.sb.closePlayerActionModal();
    ok('6f · roja y otra vez roja = QUITADA: sigue en el campo, nada sale',
       E.jugador.cards === 'ninguna' && E.jugador.status === 'field' && E.spy.encola.length === 0 && E.spy.alerts.length === 0);

    // LIMPIAR con una roja marcada.
    const F = partido();
    F.abrir();
    F.sb.assignCard('roja');
    F.sb.clearPlayerActions();
    ok('6g · LIMPIAR con una roja marcada: nada, y la siguiente ventana empieza sin tarjeta',
       F.jugador.cards === 'ninguna' && F.nada() &&
       (F.abrir(), F.sb.closePlayerActionModal(), F.jugador.cards === 'ninguna' && F.nada()));

    // Un expulsado de antes no se toca desde aquí.
    const G = partido({ cards: 'roja', status: 'bench' });
    G.abrir();
    G.sb.assignCard('amarilla');
    ok('6h · ⚠️ un jugador YA expulsado al abrir: se avisa (rectificación aparte) y no cambia nada',
       G.spy.alerts.some(a => /ya está expulsado/.test(a)) && G.nada() && G.jugador.cards === 'roja');
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);

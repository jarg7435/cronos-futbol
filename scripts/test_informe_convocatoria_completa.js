// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v458 — El informe post-partido es EXHAUSTIVO
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt, capturas 8436/8437):
//   1. Que aparezcan TODOS los convocados —14 en F7, 18 en F11— y que quien no
//      participó figure explícitamente con 0 minutos.
//   2. Que se listen TODOS los sucesos del encuentro en orden cronológico:
//      goles, lesiones, tarjetas y cambios. Sin omitir ninguno.
//
// ⚠️ POR QUÉ ESTE GUARD NO USA FIXTURES CÓMODAS. El guard que ya existía
// (test_report_engine_module.js) da de alta a sus jugadores con `titular: true`
// y `convocado: true`… campos que NINGUNO de los tres escritores guarda en
// Firestore. Con esas fixtures el motor se comportaba bien y el informe REAL
// perdía jugadores. Aquí el jugador se construye al revés: se escribe el
// historial con las MISMAS cadenas que produce la app (logMovement / logEvent /
// los apuntes automáticos de fase), se pasa por el _parseHistoryForFirestore
// REAL y se arma el documento con EXACTAMENTE los campos que escribe
// collective-report.js. Si un día un escritor cambia lo que guarda, la PARTE 0
// se pone roja.
//
// Medido sobre el código anterior con esta misma simulación (F7, 14 convocados):
// aparecían 8 jugadores y faltaban el gol del minuto 10 y la amarilla del 15,
// mientras se colaban 14 filas de "CAMBIO" que eran apuntes de descanso y final.
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
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}

// ── El motor REAL, en un sandbox desnudo ───────────────────────────────────
// CRONOS_REPORT_ENGINE permite apuntar a una copia mutada (red-check) o a la
// versión anterior, sin tocar el fichero de verdad.
const SRC_MOTOR = process.env.CRONOS_REPORT_ENGINE
    ? fs.readFileSync(process.env.CRONOS_REPORT_ENGINE, 'utf8')
    : leer('js/coach/reports/report-engine.js');
function cargarRP() {
    const s = SRC_MOTOR.indexOf('const _RP = (() => {');
    const e = SRC_MOTOR.indexOf('\n})();', s);
    if (s < 0 || e < 0) throw new Error('No encuentro el IIFE de _RP');
    const sb = { Math, Array, Object, String, Number, JSON, Date, Map, Set, parseInt, parseFloat, isNaN, isFinite };
    vm.createContext(sb);
    vm.runInContext(SRC_MOTOR.slice(s, e + 6) + '\nthis.__rp = _RP;', sb);
    return sb.__rp;
}
// ── El parser REAL de historiales ──────────────────────────────────────────
const SRC_PANEL = leer('js/coach/comms/panel.js');
function cargarParser() {
    const corta = (nombre) => {
        const i = SRC_PANEL.indexOf('function ' + nombre + '(');
        if (i < 0) throw new Error('No encuentro ' + nombre);
        let j = SRC_PANEL.indexOf('{', i), prof = 0;
        for (; j < SRC_PANEL.length; j++) {
            if (SRC_PANEL[j] === '{') prof++;
            else if (SRC_PANEL[j] === '}') { prof--; if (prof === 0) { j++; break; } }
        }
        return SRC_PANEL.slice(i, j);
    };
    const sb = { Array, String, Object, Math, RegExp };
    vm.createContext(sb);
    vm.runInContext(corta('_horaRealDeNota') + '\n' + corta('_parseHistoryForFirestore') +
                    '\nthis.__p = _parseHistoryForFirestore;', sb);
    return sb.__p;
}
const RP = cargarRP();
const parse = cargarParser();

// ── El PARTIDO simulado, con las cadenas exactas de la app ─────────────────
const T = (m, s) => String(m).padStart(2, '0') + ':' + String(s || 0).padStart(2, '0');
const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

// Crea la plantilla y devuelve utilidades para escribir su historial igual que
// lo hacen logMovement (js/ui/drag-drop.js) y logEvent (movement-log.js).
function crearPlantilla(n) {
    const js = [];
    for (let i = 1; i <= n; i++) {
        js.push({ number: i, alias: 'Jugador ' + i, history: [],
                  goals: 0, cards: null, injured: false, time: 0 });
    }
    const J = i => js[i - 1];
    return {
        js, J,
        mov:    (i, accion, t, fase, sub) => J(i).history.push(
                    `${accion} a las ${t} (${fase})${sub ? ' #' + sub : ''} @18:44:00`),
        suceso: (i, texto, t, fase) => J(i).history.push(`${texto} a las ${t} (${fase}) @18:40:00`),
        fase:   (ids, texto, t) => ids.forEach(i => J(i).history.push(`${texto} a las ${t}`)),
        // El documento, con EXACTAMENTE los campos de collective-report.js.
        docs:   () => js.map(p => ({
                    playerNumber:  String(p.number || ''),
                    playerAlias:   p.alias || p.name || '',
                    position:      p.position || p.pos || '',
                    goals:         p.goals || 0,
                    cards:         p.cards || null,
                    injured:       p.injured || false,
                    minutesPlayed: fmt(p.time || 0),
                    history:       parse(p.history || []),
                })),
    };
}

// F7 · 14 convocados. Titulares 1-7. Nunca juegan 12, 13 y 14.
function partidoF7() {
    const P = crearPlantilla(14);
    P.suceso(4, 'GOL (1º)', T(10), '1ªP');          P.J(4).goals = 1;
    P.suceso(3, 'TARJETA AMARILLA', T(15), '1ªP');  P.J(3).cards = 'amarilla';
    P.mov(5, 'Sale', T(20), '1ªP', '1001'); P.mov(8, 'Entra', T(20), '1ªP', '1001');
    P.fase([1, 2, 3, 4, 6, 7, 8], 'Sale',  T(35) + ' (DESCANSO)'.replace(T(35), ''));
    // (las dos líneas de fase se escriben tal cual las escribe la app)
    P.js.forEach(() => {});
    return P;
}

// ── Construcción de los dos partidos (F7 y F11) ────────────────────────────
function construir(nConvocados, cat) {
    const P = crearPlantilla(nConvocados);
    const titulares = cat.startsWith('f7') ? 7 : 11;
    const finMin = cat.includes('alevin') ? 70 : 90;
    const mitad  = finMin / 2;

    // 1ª parte: gol de un titular que NO se mueve en todo el partido (el que se
    // perdía), y amarilla de otro igual.
    P.suceso(4, 'GOL (1º)', T(10), '1ªP');          P.J(4).goals = 1;
    P.suceso(3, 'TARJETA AMARILLA', T(15), '1ªP');  P.J(3).cards = 'amarilla';
    // un cambio real en la primera parte: sale 5, entra el primer suplente
    const sup1 = titulares + 1, sup2 = titulares + 2, sup3 = titulares + 3, sup4 = titulares + 4;
    P.mov(5, 'Sale', T(20), '1ªP', '1001'); P.mov(sup1, 'Entra', T(20), '1ªP', '1001');

    // Apuntes AUTOMÁTICOS de fase: la app los escribe a todos los que están en
    // el campo. No son cambios.
    const enCampo1 = [];
    for (let i = 1; i <= titulares; i++) if (i !== 5) enCampo1.push(i);
    enCampo1.push(sup1);
    enCampo1.forEach(i => P.J(i).history.push(`Sale a las ${T(mitad)} (DESCANSO)`));
    enCampo1.forEach(i => P.J(i).history.push(`Entra a las ${T(mitad)} (2ªP)`));

    // 2ª parte: lesión + cambio, gol del suplente, y un cambio grupal.
    P.suceso(2, 'LESIÓN', T(mitad + 15), '2ªP');    P.J(2).injured = true;
    P.mov(2, 'Sale', T(mitad + 15), '2ªP', '1002'); P.mov(sup2, 'Entra', T(mitad + 15), '2ªP', '1002');
    P.suceso(sup2, 'GOL (1º)', T(mitad + 23), '2ªP'); P.J(sup2).goals = 1;
    P.mov(6, 'Sale', T(mitad + 25), '2ªP'); P.mov(sup3, 'Entra', T(mitad + 25), '2ªP');
    P.mov(7, 'Sale', T(mitad + 25), '2ªP'); P.mov(sup4, 'Entra', T(mitad + 25), '2ªP');

    const enCampo2 = [];
    for (let i = 1; i <= titulares; i++) if (i !== 5 && i !== 2 && i !== 6 && i !== 7) enCampo2.push(i);
    [sup1, sup2, sup3, sup4].forEach(i => enCampo2.push(i));
    enCampo2.forEach(i => P.J(i).history.push(`Sale a las ${T(finMin)} (FIN)`));

    // Minutos del cronómetro
    const min = {};
    for (let i = 1; i <= nConvocados; i++) min[i] = 0;
    for (let i = 1; i <= titulares; i++) min[i] = finMin;
    min[5] = 20; min[2] = mitad + 15; min[6] = mitad + 25; min[7] = mitad + 25;
    min[sup1] = finMin - 20; min[sup2] = finMin - (mitad + 15);
    min[sup3] = finMin - (mitad + 25); min[sup4] = finMin - (mitad + 25);
    P.js.forEach(p => { p.time = (min[p.number] || 0) * 60; });

    const m = { players: P.docs(), rival: 'Rival CF', scoreHome: 2, scoreAway: 1,
                category: cat, matchDate: '2026-08-06' };
    return { P, m, titulares, finMin, mitad, sup1, sup2, sup3, sup4,
             noJugaron: Array.from({ length: nConvocados }, (_, k) => k + 1)
                             .filter(i => (min[i] || 0) === 0) };
}

// ── Lectura del HTML producido ─────────────────────────────────────────────
const filasSuceso = (html) => {
    const i = html.indexOf('Registro cronológico de incidencias');
    if (i < 0) return [];
    return [...html.slice(i).matchAll(/data-suceso="([a-z_]+)">\s*<span[^>]*>([0-9:]+)<\/span>([\s\S]*?)<\/div>/g)]
        .map(x => ({ tipo: x[1], t: x[2], txt: x[3].replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim() }));
};
const aSegundos = (t) => { const [a, b] = String(t).split(':').map(Number); return (a || 0) * 60 + (b || 0); };
// La fila de la tabla de tiempos de un jugador
const filaTiempo = (html, alias) => {
    const i = html.indexOf('⏱ Tiempo jugado por jugador');
    if (i < 0) return '';
    const bloque = html.slice(i);
    const j = bloque.indexOf('>' + alias + '<');
    if (j < 0) return '';
    const ini = bloque.lastIndexOf('<div style="display:flex;align-items:center;gap:8px;padding:5px 8px', j);
    return bloque.slice(ini, bloque.indexOf('</div>', j) + 6);
};
// La fila del cronograma de un jugador (para ver si tiene barra de "en campo").
// ⚠️ Ahí el nombre va precedido del dorsal ("7. Jugador 7"), no suelto: buscarlo
// como `>alias<` no encuentra NADA y la aserción sale roja sin que el motor
// tenga la culpa. Ya me pasó al escribir este guard.
const FILA_GANTT = '<div style="display:flex;align-items:center;gap:0;padding:2px 0;';
const filaGantt = (html, alias) => {
    const i = html.indexOf('Línea individual por jugador');
    const fin = html.indexOf('⏱ Tiempo jugado por jugador');
    if (i < 0) return '';
    const bloque = html.slice(i, fin > i ? fin : undefined);
    const j = bloque.indexOf('. ' + alias + '</span>');
    if (j < 0) return '';
    const ini = bloque.lastIndexOf(FILA_GANTT, j);
    const sig = bloque.indexOf(FILA_GANTT, j + 1);
    return bloque.slice(ini < 0 ? 0 : ini, sig > 0 ? sig : undefined);
};

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 0 · la simulación refleja lo que se guarda de verdad ──');
// ───────────────────────────────────────────────────────────────────────────
// 🔑 El filtro que borraba convocados se apoyaba en `p.convocado`, un campo que
// NO ESCRIBE NADIE. Si algún día un escritor empieza a guardarlo (o guarda
// titular/initialStatus), esta aserción avisa de que la simulación se quedó
// vieja y de que el motor podría volver a fiarse de un campo ausente.
const ESCRITORES = ['js/coach/comms/collective-report.js',
                    'js/coach/comms/match-reports-auto.js',
                    'js/coach/comms/match-reports-send.js'];
const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '')
                     .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
for (const f of ESCRITORES) {
    const src = sinCom(leer(f));
    ok(`0a · [${path.basename(f)}] no guarda convocado/titular/initialStatus`,
       !/\b(convocado|titular|initialStatus)\s*:/.test(src),
       'si empieza a guardarlo, revisar el motor y esta simulación');
    ok(`0b · [${path.basename(f)}] guarda minutesPlayed con formatTime (cadena "MM:SS")`,
       /minutesPlayed:\s*[^,]*formatTime/.test(src));
    ok(`0c · [${path.basename(f)}] escribe un documento por CADA jugador del equipo`,
       /players\s*\.?\s*\n?\s*\.?filter\(p => p\.team === _cMyTeamKey\(\)\)/.test(src) ||
       /filter\(p => p\.team === _cMyTeamKey\(\)\)/.test(src),
       'si filtrara por minutos, el dato se perdería antes de llegar al informe');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · F7: los 14 convocados, jugaran o no ──');
// ───────────────────────────────────────────────────────────────────────────
const F7 = construir(14, 'f7_alevin');
const html7 = RP.build(F7.m, { clubName: 'CD Test' });

ok('1a · el rótulo "convocados" dice 14 (antes decía sólo los que sobrevivían)',
   F7.m.participantsCount === 14, F7.m.participantsCount);
ok('1a2 · y se informa de cuántos jugaron', F7.m.playedCount === 11, F7.m.playedCount);
const ausentes7 = [];
for (let i = 1; i <= 14; i++) if (!filaTiempo(html7, 'Jugador ' + i)) ausentes7.push(i);
ok('1b · 🔑 los 14 aparecen en la tabla de tiempos',
   ausentes7.length === 0, 'faltan: ' + ausentes7.join(', '));
for (const i of F7.noJugaron) {
    const fila = filaTiempo(html7, 'Jugador ' + i);
    ok(`1c · [Jugador ${i}] el que no jugó figura con 00:00`, />00:00</.test(fila), fila.slice(0, 120));
    ok(`1c2 · [Jugador ${i}] y se dice EXPLÍCITAMENTE que no jugó`, fila.includes('no jugó'));
}
// 🔑 El otro grupo que desaparecía: quien jugó el partido ENTERO sin cambios.
// Sus únicos apuntes son los automáticos de fase, así que se quedaba sin
// intervalos y el filtro se lo llevaba por delante.
for (const i of [1, 3, 4]) {
    const fila = filaTiempo(html7, 'Jugador ' + i);
    ok(`1d · [Jugador ${i}] quien jugó los ${F7.finMin}' completos figura con su tiempo real`,
       fila.includes('>' + fmt(F7.finMin * 60) + '<'), fila.slice(0, 160));
    ok(`1d2 · [Jugador ${i}] y su cronograma tiene barra de "en campo"`,
       filaGantt(html7, 'Jugador ' + i).includes('fill="#58a6ff"'));
}
ok('1e · quien no jugó NO tiene barra de "en campo" (no se le regalan minutos)',
   !filaGantt(html7, 'Jugador ' + F7.noJugaron[0]).includes('fill="#58a6ff"'));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · F7: TODOS los sucesos, y sólo los sucesos ──');
// ───────────────────────────────────────────────────────────────────────────
const filas7 = filasSuceso(html7);
const sucesos7 = filas7.filter(f => f.tipo !== 'fase');
ok('2a · hay registro cronológico', filas7.length > 0);
ok('2b · 🔑 el gol del 10\' está (era de un titular sin cambios: se perdía)',
   sucesos7.some(f => f.t === '10:00' && f.tipo === 'goal' && f.txt.includes('Jugador 4')),
   JSON.stringify(sucesos7.slice(0, 3)));
ok('2c · 🔑 la amarilla del 15\' está (misma causa)',
   sucesos7.some(f => f.t === '15:00' && f.tipo === 'yellow' && f.txt.includes('Jugador 3')));
ok('2d · la lesión está', sucesos7.some(f => f.tipo === 'injury'));
ok('2e · el gol del suplente está', sucesos7.some(f => f.tipo === 'goal' && f.txt.includes('Jugador ' + F7.sup2)));
const cambios7 = sucesos7.filter(f => f.tipo === 'sub_in' || f.tipo === 'sub_out');
ok('2f · están los 4 cambios reales, con sus 8 apuntes', cambios7.length === 8, cambios7.length);
ok('2g · en total 12 sucesos: 2 goles + 1 amarilla + 1 lesión + 8 de cambio',
   sucesos7.length === 12, sucesos7.length + ' → ' + sucesos7.map(f => f.tipo).join(','));
// 🔑 Lo que SOBRABA: los apuntes automáticos de descanso y final salían como
// "CAMBIO". En un F7 con 14 convocados eran 14 filas falsas.
ok('2h · 🔑 ni un solo "cambio" en el minuto del descanso',
   !cambios7.some(f => f.t === fmt(F7.mitad * 60)), JSON.stringify(cambios7.map(f => f.t)));
ok('2h2 · 🔑 ni en el minuto final',
   !cambios7.some(f => f.t === fmt(F7.finMin * 60)));
ok('2i · el descanso y el final se muestran, pero como marcas de fase',
   filas7.some(f => f.tipo === 'fase' && f.txt.includes('DESCANSO')) &&
   filas7.some(f => f.tipo === 'fase' && f.txt.includes('FINAL')));
const tiempos7 = filas7.map(f => aSegundos(f.t));
ok('2j · el registro está ordenado cronológicamente',
   tiempos7.every((v, i) => i === 0 || v >= tiempos7[i - 1]), JSON.stringify(filas7.map(f => f.t)));
ok('2k · dentro del mismo minuto, primero quien SALE y después quien ENTRA',
   (() => {
       const m20 = filas7.filter(f => f.t === '20:00').map(f => f.tipo);
       return m20.indexOf('sub_out') >= 0 && m20.indexOf('sub_out') < m20.indexOf('sub_in');
   })());

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · F11: los 18 convocados y sus sucesos ──');
// ───────────────────────────────────────────────────────────────────────────
const F11 = construir(18, 'f11_juvenil');
const html11 = RP.build(F11.m, { clubName: 'CD Test' });
const ausentes11 = [];
for (let i = 1; i <= 18; i++) if (!filaTiempo(html11, 'Jugador ' + i)) ausentes11.push(i);
ok('3a · 🔑 los 18 convocados aparecen', ausentes11.length === 0, 'faltan: ' + ausentes11.join(', '));
ok('3a2 · el rótulo dice 18', F11.m.participantsCount === 18, F11.m.participantsCount);
ok('3b · los que no jugaron figuran con 00:00 y "no jugó"',
   F11.noJugaron.every(i => {
       const f = filaTiempo(html11, 'Jugador ' + i);
       return />00:00</.test(f) && f.includes('no jugó');
   }), F11.noJugaron.join(', '));
const sucesos11 = filasSuceso(html11).filter(f => f.tipo !== 'fase');
ok('3c · los 12 sucesos también están en F11', sucesos11.length === 12,
   sucesos11.length + ' → ' + sucesos11.map(f => f.tipo).join(','));
ok('3d · sin cambios falsos en el descanso ni en el final',
   !sucesos11.some(f => (f.tipo === 'sub_in' || f.tipo === 'sub_out') &&
                        (f.t === fmt(F11.mitad * 60) || f.t === fmt(F11.finMin * 60))));
ok('3e · la duración de F11 juvenil sigue siendo 90\'', F11.finMin === 90);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · integridad: ni omitir NI inventar ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // Un gol anulado, una roja revertida y una doble amarilla, con los textos
    // EXACTOS que escriben movement-log.js y player-actions.js.
    const P = crearPlantilla(8);
    P.suceso(1, 'GOL (1º)', T(10), '1ªP');                          P.J(1).goals = 1;
    P.suceso(1, 'GOL ANULADO (Quedan: 0)', T(12), '1ªP');           P.J(1).goals = 0;
    P.suceso(2, 'TARJETA ROJA', T(20), '1ªP');                      P.J(2).cards = 'roja';
    P.suceso(2, 'ROJA REVERTIDA (rectificación arbitral)', T(22), '1ªP');
    P.suceso(3, 'TARJETA AMARILLA', T(30), '1ªP');
    P.suceso(3, 'DOBLE AMARILLA → EXPULSADO', T(40), '2ªP');        P.J(3).cards = 'roja';
    P.js.forEach(p => { p.time = 60 * 60; });
    const m = { players: P.docs(), rival: 'R', scoreHome: 1, scoreAway: 0, category: 'f7_alevin' };
    const html = RP.build(m, { clubName: 'CD Test' });
    const fs_ = filasSuceso(html);

    ok('4a · 🔑 un gol ANULADO no se cuenta como gol en el registro',
       fs_.some(f => f.txt.includes('GOL ANULADO')) &&
       fs_.filter(f => f.tipo === 'goal' && !f.txt.includes('ANULADO')).length === 1,
       JSON.stringify(fs_.filter(f => f.tipo === 'goal').map(f => f.txt)));
    ok('4b · 🔑 una roja REVERTIDA no se enseña como expulsión',
       fs_.some(f => f.txt.includes('ROJA REVERTIDA')));
    ok('4c · la doble amarilla se dice como expulsión, no como amonestación',
       fs_.some(f => f.txt.includes('DOBLE AMARILLA') && f.txt.includes('Expulsión')));
    ok('4d · 🔑 el contador de tarjetas cuenta las amarillas (marcaba 0 SIEMPRE)',
       /<div style="font-size:1\.2rem;font-weight:700;"><span style="color:#eab308;">2<\/span>/.test(html),
       'contaba p.cards === "yellow" y la app escribe "amarilla"');
    ok('4d2 · y las rojas se cuentan de `cards`, que cubre la doble amarilla',
       /\+2R/.test(html), 'esperadas 2 rojas (una directa y una por doble amarilla)');
    ok('4e · ninguna fila del registro se queda sin tipo',
       fs_.every(f => f.tipo && f.txt.length > 0));
}
{
    // ⚠️ CASO CONSTRUIDO A PROPÓSITO PARA QUE EL ORDEN IMPORTE. En el partido
    // simulado de arriba, el que sale siempre lleva dorsal MENOR que el que
    // entra, así que el desempate por tipo daba igual y una mutación que lo
    // borrara pasaba desapercibida (lo cazó el red-check). Aquí el que ENTRA
    // lleva el dorsal 2 y el que SALE el 9, los dos en el mismo minuto: sin el
    // desempate por tipo, el registro diría que alguien entró antes de que
    // saliera su compañero.
    const doc = (alias, num, hist) => ({ playerNumber: num, playerAlias: alias, goals: 0,
                                         cards: null, injured: false, minutesPlayed: '30:00',
                                         history: hist });
    const m = { players: [
        doc('El Que Entra', '2', [{ type: 'sub_in',  minute: 30, second: 0, note: 'Entra a las 30:00 (1ªP) #77' }]),
        doc('El Que Sale',  '9', [{ type: 'sub_out', minute: 30, second: 0, note: 'Sale a las 30:00 (1ªP) #77' }]),
    ], rival: 'R', scoreHome: 0, scoreAway: 0, category: 'f7_alevin' };
    const filas = filasSuceso(RP.build(m, { clubName: 'CD Test' }));
    const tipos = filas.filter(f => f.tipo !== 'fase').map(f => f.tipo);
    ok('4f · 🔑 en el mismo minuto, SALE va antes que ENTRA aunque el dorsal diga lo contrario',
       tipos.join(',') === 'sub_out,sub_in', tipos.join(','));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · la deduplicación no puede fundir a dos personas ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const doc = (alias, num, hist) => ({ playerNumber: num, playerAlias: alias, goals: 0,
                                         cards: null, injured: false, minutesPlayed: '45:00',
                                         history: hist || [] });
    const m = { players: [doc('Sin Dorsal A', ''), doc('Sin Dorsal B', '')],
                rival: 'R', scoreHome: 0, scoreAway: 0, category: 'f7_alevin' };
    const html = RP.build(m, { clubName: 'CD Test' });
    ok('5a · 🔑 dos jugadores sin dorsal NO se funden en uno',
       html.includes('Sin Dorsal A') && html.includes('Sin Dorsal B'),
       'la clave era `playerNumber || "?"`: todos caían en la misma');
    ok('5a2 · y el contador los cuenta a los dos', m.participantsCount === 2, m.participantsCount);

    const largo = doc('Largo', '5', [{ type: 'sub_out', minute: 10, second: 0, note: 'Sale a las 10:00 (1ªP)' },
                                     { type: 'sub_in',  minute: 20, second: 0, note: 'Entra a las 20:00 (1ªP)' }]);
    const corto = doc('Corto', '5', []);
    const m2 = { players: [corto, largo], rival: 'R', scoreHome: 0, scoreAway: 0, category: 'f7_alevin' };
    const html2 = RP.build(m2, { clubName: 'CD Test' });
    ok('5b · sigue deduplicando por dorsal, quedándose con el historial más largo',
       html2.includes('Largo') && !html2.includes('Corto'));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ El informe post-partido es exhaustivo en F7 y en F11');

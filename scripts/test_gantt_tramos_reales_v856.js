// ═══════════════════════════════════════════════════════════════════════════
//  📊 v856 · EL CRONOGRAMA DE «MIS INFORMES» PINTA LOS TRAMOS REALES
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-11-20, capturas 11892-11894): en un
//  partido terminado con cambios, el Gantt de «Mis Informes de Partido» daba a
//  todos los que jugaron una barra continua de principio a fin, con un eje de
//  0' a 90' para un partido de 41'. Tres causas, las tres cubiertas aquí:
//
//   1. LA ESCALA era la duración REGLAMENTARIA de la categoría (Regional = 90'):
//      el campo `duration` del informe no lo escribe nadie. Todo el que acababa
//      en el campo se alargaba hasta el 90'. → se usa el «Sale (FIN)» real.
//   2. EL CAMBIO DE DESCANSO NO APUNTADO sólo dejaba el «Sale (DESCANSO)»
//      automático, que el motor tiraba siempre: sin ninguna transición, el
//      jugador recibía [0, fin]. → las marcas de fase anclan los tramos, y un
//      «Sale (DESCANSO)» sin su «Entra (2ªP)» es una salida real.
//   3. EL ORIGEN: soltar en el banquillo o en un hueco del campo con el reloj
//      PARADO (descanso, pausa) no se apuntaba (`if (isRunning)`). → se apunta
//      desde el saque inicial hasta el final.
//
//  Ejecuta el motor real (js/coach/reports/report-engine.js) en un sandbox
//  desnudo y LEE LAS BARRAS DEL SVG: posición y anchura de cada tramo azul.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 600)); }
};

// ── El motor, en un sandbox desnudo (como test_report_engine_module.js) ──
const SRC = leer('js/coach/reports/report-engine.js');
const ini = SRC.indexOf('const _RP = (() => {');
const fin = SRC.indexOf('\n})();', ini);
const sb = { Math, Array, Object, String, Number, JSON, Date, Map, Set, parseInt, parseFloat, isNaN };
vm.createContext(sb);
vm.runInContext(SRC.slice(ini, fin + 6) + '\nthis.__rp = _RP;', sb);
const RP = sb.__rp;

// ── El parseador real de historiales (el que usan los escritores de informes) ──
const PANEL = leer('js/coach/comms/panel.js');
const pIni = PANEL.indexOf('function _horaRealDeNota(');
const pFin = PANEL.indexOf('\n}\n', PANEL.indexOf('function _parseHistoryForFirestore(')) + 3;
const sbP = { window: {} };
vm.createContext(sbP);
vm.runInContext(PANEL.slice(pIni, pFin) + '\nthis.__parse = _parseHistoryForFirestore;', sbP);
const parse = sbP.__parse;

// ── El partido de las capturas, con su forma real ────────────────────────
//  1ª parte 20:46, final 41:17 (acumulado). Regional B (reglamento: 90').
const H1 = '20:46', FIN = '41:17';
const jug = (num, alias, min, historial) => ({
    playerNumber: String(num), playerAlias: alias, minutesPlayed: min,
    history: parse(historial), position: num === 1 ? 'POR' : 'MED',
});
const pasaDescanso = [`Sale a las ${H1} (DESCANSO)`, `Entra a las ${H1} (2ªP)`];
const m = {
    matchId: 'rc-victoria-regional-b', rival: 'REGIONAL B', category: 'Regional', subcategory: 'B',
    scoreHome: 1, scoreAway: 2, myTeamRole: 'home', duration: '', stoppageTime: 0,
    players: [
        // Titular de principio a fin: sus únicos apuntes son los de fase.
        jug(1,  'OMAR',      '41:17', [...pasaDescanso, `Sale a las ${FIN} (FIN)`]),
        // Cambio en juego, apuntado con su pareja (#5): sale en el 11:09.
        jug(2,  'TRUJILLO',  '11:09', ['Sale a las 11:09 (1ªP) #5 @18:11:09']),
        // 🔴 EL CASO DE LAS CAPTURAS: cambiado en el DESCANSO con el reloj parado,
        // sin apunte. Su única huella es el «Sale (DESCANSO)» automático.
        jug(6,  'TOLEDO',    '20:46', [`Sale a las ${H1} (DESCANSO)`]),
        // Sale en la 2ª parte, apuntado (#7).
        jug(11, 'CHRISTIAN', '31:52', [...pasaDescanso, 'Sale a las 31:52 (2ªP) #7 @18:42:00']),
        // Entra en la 2ª parte por CHRISTIAN.
        jug(12, 'FELO',      '09:25', ['Entra a las 31:52 (2ªP) #7 @18:42:00', `Sale a las ${FIN} (FIN)`]),
        // Entra en la 1ª por TRUJILLO y sigue hasta el final.
        jug(14, 'GABRI',     '30:08', ['Entra a las 11:09 (1ªP) #5 @18:11:09', ...pasaDescanso, `Sale a las ${FIN} (FIN)`]),
        // No juega.
        jug(15, 'SERGIO',    '00:00', []),
        // 🔴 Entra en el DESCANSO sin apunte: sólo su «Entra (2ªP)» automático.
        jug(18, 'ADRIÁN',    '20:31', [`Entra a las ${H1} (2ªP)`, `Sale a las ${FIN} (FIN)`]),
    ],
};

const html = RP.build(JSON.parse(JSON.stringify(m)), { clubName: 'RC VICTORIA' });

// ── Lectura de las barras ─────────────────────────────────────────────────
//  La sección «Línea individual por jugador»: un <svg viewBox="0 0 500 …"> por
//  jugador, en orden de dorsal. Cada tramo en el campo es un <rect fill="#58a6ff">.
const W = 500;
const iSec = html.indexOf('Línea individual por jugador');
const filas = html.slice(iSec).split('<svg viewBox="0 0 500 ').slice(1, m.players.length + 1);
const tramos = filas.map(f => {
    const svg = f.slice(0, f.indexOf('</svg>'));
    const out = [];
    const re = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"\s+height="[\d.]+" rx="3" fill="#58a6ff"/g;
    let r; while ((r = re.exec(svg))) out.push([+r[1], +r[1] + +r[2]]);
    return { svg, out };
});
const finMin = 41 + 17 / 60, h1Min = 20 + 46 / 60;
const x = (min) => min * W / finMin;
const cerca = (a, b) => Math.abs(a - b) <= 1.2;   // 1,2 px de 500 ≈ 6 s de partido
const tramoEs = (fila, esperado) =>
    fila.out.length === esperado.length &&
    esperado.every(([a, b], i) => cerca(fila.out[i][0], x(a)) && cerca(fila.out[i][1], x(b)));
const porDorsal = {};
m.players.forEach((p, i) => { porDorsal[p.playerNumber] = tramos[i]; });
const ver = (n) => ({ px: porDorsal[n].out.map(([a, b]) => [+a.toFixed(1), +b.toFixed(1)]) });

console.log('── PARTE 1 · la escala es la duración REAL, no la reglamentaria ──');
ok('1a · se encuentran las 8 filas del cronograma', filas.length === 8, filas.length);
ok('1b · 🔑 el eje termina en el 41\' real, no en el 90\' de Regional',
   /font-size="7.5"[^>]*text-anchor="end">41'<\/text>/.test(porDorsal['1'].svg) &&
   !/>90'<\/text>/.test(porDorsal['1'].svg));
ok('1c · la cabecera sigue mostrando la duración reglamentaria (90\')', /90'/.test(html.slice(0, iSec)));

console.log('\n── PARTE 2 · cada jugador, con SUS tramos ──');
ok('2a · OMAR (titular entero): una barra de 0\' al final, CONTINUA pese al descanso',
   tramoEs(porDorsal['1'], [[0, finMin]]), ver('1'));
ok('2b · 🔑 TRUJILLO (sale en el 11:09): barra de 0\' a 11:09, no hasta el final',
   tramoEs(porDorsal['2'], [[0, 11 + 9 / 60]]), ver('2'));
ok('2c · 🔑🔑 TOLEDO (cambiado en el descanso SIN apunte): sólo la 1ª parte',
   tramoEs(porDorsal['6'], [[0, h1Min]]), ver('6'));
ok('2d · CHRISTIAN (sale en el 31:52): de 0\' a 31:52',
   tramoEs(porDorsal['11'], [[0, 31 + 52 / 60]]), ver('11'));
ok('2e · FELO (entra en el 31:52): del 31:52 al final',
   tramoEs(porDorsal['12'], [[31 + 52 / 60, finMin]]), ver('12'));
ok('2f · 🔑 GABRI (entra en el 11:09 y sigue): del 11:09 al final, sin cortar en el descanso',
   tramoEs(porDorsal['14'], [[11 + 9 / 60, finMin]]), ver('14'));
ok('2g · SERGIO (no juega): ninguna barra, BANQUILLO', porDorsal['15'].out.length === 0 &&
   /BANQUILLO/.test(porDorsal['15'].svg));
ok('2h · 🔑🔑 ADRIÁN (entra en el descanso SIN apunte): sólo la 2ª parte',
   tramoEs(porDorsal['18'], [[h1Min, finMin]]), ver('18'));

console.log('\n── PARTE 3 · los totales cuadran con los tramos ──');
const minutos = (n) => porDorsal[n].out.reduce((s, [a, b]) => s + (b - a), 0) * finMin / W;
const mmss = (s) => { const [mm, ss] = s.split(':').map(Number); return mm + ss / 60; };
const casos = m.players.filter(p => p.minutesPlayed !== '00:00');
const desv = casos.map(p => [p.playerAlias, +(minutos(p.playerNumber) - mmss(p.minutesPlayed)).toFixed(2)]);
ok('3a · 🔑 para cada jugador, la suma de sus tramos = su tiempo del cronómetro (± 0,1\')',
   desv.every(([, d]) => Math.abs(d) <= 0.1), desv);
ok('3b · y el tiempo que enseña cada fila es el del cronómetro',
   casos.every(p => porDorsal[p.playerNumber].svg !== undefined) &&
   /41:17/.test(html) && /20:46/.test(html) && /09:25/.test(html));

console.log('\n── PARTE 4 · los cambios, tal como ocurrieron ──');
ok('4a · 🔑 TOLEDO sale en el descanso y le reemplaza ADRIÁN (antes: sin rastro del cambio)',
   /▲ SALE: TOLEDO \(entra ADRIÁN\) 20'/.test(porDorsal['6'].svg), porDorsal['6'].svg.match(/▲ SALE[^<]*/g));
ok('4b · y ADRIÁN entra por TOLEDO', /▼ ENTRA: ADRIÁN \(por TOLEDO\) 20'/.test(porDorsal['18'].svg),
   porDorsal['18'].svg.match(/▼ ENTRA[^<]*/g));
ok('4c · TRUJILLO ↔ GABRI en el 11\'',
   /▲ SALE: TRUJILLO \(entra GABRI\) 11'/.test(porDorsal['2'].svg) &&
   /▼ ENTRA: GABRI \(por TRUJILLO\) 11'/.test(porDorsal['14'].svg));
ok('4d · CHRISTIAN ↔ FELO en el 31\'',
   /▲ SALE: CHRISTIAN \(entra FELO\) 31'/.test(porDorsal['11'].svg) &&
   /▼ ENTRA: FELO \(por CHRISTIAN\) 31'/.test(porDorsal['12'].svg));
ok('4e · 🔑 pasar por el descanso NO es un cambio: OMAR y GABRI sin marca en el 20\'',
   !/SALE: OMAR|ENTRA: OMAR/.test(porDorsal['1'].svg) && !/SALE: GABRI/.test(porDorsal['14'].svg));
ok('4f · nadie queda «sin pareja» en este partido', !/sin pareja/.test(html));

console.log('\n── PARTE 5 · sin «Sale (FIN)» (informes antiguos) se usa la tabla ──');
{
    const viejo = JSON.parse(JSON.stringify(m));
    viejo.players.forEach(p => { p.history = p.history.filter(e => !/\(FIN\)/.test(e.note || '')); });
    const h = RP.build(viejo, { clubName: 'RC VICTORIA' });
    const fila1 = h.slice(h.indexOf('Línea individual por jugador')).split('<svg viewBox="0 0 500 ')[1] || '';
    ok('5a · el eje vuelve a la duración reglamentaria (90\')', /text-anchor="end">90'<\/text>/.test(fila1));
}

console.log('\n── PARTE 6 · el origen: los cambios con el reloj PARADO se apuntan ──');
{
    const DD = leer('js/ui/drag-drop.js');
    const sinCom = DD.replace(/\/\/[^\n]*/g, '');
    ok('6a · 🔑 ninguna ruta de drag-drop exige ya `isRunning` para apuntar un movimiento',
       !/if \(isRunning\) logMovement\(/.test(sinCom) && !/if \(isRunning && !estabaEnCampo\)/.test(sinCom));
    const a = DD.indexOf('function _cronosApuntaCambios()');
    const b = DD.indexOf('\n}\n', a) + 3;
    const prueba = (estado) => {
        const s = Object.assign({ window: {} }, estado);
        vm.createContext(s);
        vm.runInContext(DD.slice(a, b) + '\nthis.__f = _cronosApuntaCambios;', s);
        return s.__f();
    };
    ok('6b · con el reloj en marcha, se apunta', prueba({ isRunning: true, matchPhase: '1st_half', masterTimeH1: 300 }) === true);
    ok('6c · 🔑 en el DESCANSO (reloj parado), se apunta', prueba({ isRunning: false, matchPhase: 'break', masterTimeH1: 1246 }) === true);
    ok('6d · 🔑 en una PAUSA de la 1ª o de la 2ª, se apunta',
       prueba({ isRunning: false, matchPhase: '1st_half', masterTimeH1: 600 }) === true &&
       prueba({ isRunning: false, matchPhase: '2nd_half', masterTimeH1: 1246 }) === true);
    ok('6e · antes del saque inicial (alineación), NO', prueba({ isRunning: false, matchPhase: '1st_half', masterTimeH1: 0 }) === false);
    ok('6f · con el partido terminado, NO', prueba({ isRunning: false, matchPhase: 'finished', masterTimeH1: 1246 }) === false);
}

console.log('\n' + pass + '/' + (pass + fail) + ' OK');
process.exit(fail ? 1 : 0);

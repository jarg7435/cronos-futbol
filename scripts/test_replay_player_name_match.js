// ─────────────────────────────────────────────────────────────────────────
// test_replay_player_name_match.js  ·  Auditoria 2026-07-22, hallazgo #8
//
// js/match/replay/replay-player.js reconstruye goles/tarjetas/sustituciones/
// lesiones emparejando el jugador con `ev.text.includes(p.name)`. Los eventos
// solo llevan texto libre (p.ej. 'GOL · ' + p.name, ver
// js/match/events/player-actions.js `_registerMatchEvent`), sin playerId. Con
// `includes()`:
//   - un nombre que sea SUBCADENA de otro (p.ej. "Ana" dentro de "Anabel")
//     misatribuye el evento;
//   - el `forEach` sin `break` aplica el evento a TODOS los jugadores cuyo
//     nombre encaja, no solo a uno (tarjetas/entradas-salidas/lesiones).
//
// Fix: extraer el nombre EXACTO tras el separador ' · ' (recortando el
// sufijo entre parentesis, p.ej. "(doble amarilla)") y buscar por IGUALDAD
// normalizada, no por subcadena. Este test extrae las funciones REALES
// (_extractPlayerNameFromEventText / _findPlayerByEventText) del archivo y
// las ejecuta en sandbox.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── replay-player.js: emparejamiento de eventos por nombre EXACTO ──\n');

const src = fs.readFileSync(path.join(ROOT, 'js', 'match', 'replay', 'replay-player.js'), 'utf8');

// ═══════════════════ PARTE 1 · estructura del código real ══════════════════
console.log('── PARTE 1 · estructura ──');

ok('1a · existe _extractPlayerNameFromEventText', /function _extractPlayerNameFromEventText/.test(src));
ok('1b · existe _findPlayerByEventText', /function _findPlayerByEventText/.test(src));
const srcNoComments = src.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
ok('1c · [FIX] ya NO queda ningún `.includes(p.name)` (matching por subcadena) en código real',
   !/\.includes\(p\.name\)/.test(srcNoComments));
ok('1d · [FIX] goal/yellow/red/sub_in/sub_out/injury (6 tipos) usan _findPlayerByEventText',
   (src.match(/_findPlayerByEventText\(playersMap, ev\.text\)/g) || []).length === 6,
   'ocurrencias: ' + ((src.match(/_findPlayerByEventText\(playersMap, ev\.text\)/g) || []).length));

// ═══════════════════ PARTE 2 · ejecución REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecución de las funciones reales ──');

function extractFn(name) {
    const start = src.indexOf('function ' + name);
    const end = src.indexOf('\n    }', start);
    return src.slice(start, end + 6);
}

const sandbox = { console: { log(){}, warn(){} } };
vm.createContext(sandbox);
vm.runInContext(extractFn('_extractPlayerNameFromEventText') + '\n' + extractFn('_findPlayerByEventText'), sandbox);

const { _extractPlayerNameFromEventText: extractName, _findPlayerByEventText: findPlayer } = sandbox;

ok('2a · extrae el nombre tras el separador " · "',
   extractName('GOL · Anabel García') === 'Anabel García');
ok('2b · recorta el sufijo entre paréntesis (doble amarilla)',
   extractName('TARJETA ROJA · Juan Pérez (doble amarilla)') === 'Juan Pérez');
ok('2c · texto sin separador -> null (no arriesga un match falso)',
   extractName('algo sin separador') === null);

// Escenario CRÍTICO: dos jugadores cuyo nombre es subcadena uno del otro.
const playersMap = {
    p1: { id: 'p1', name: 'Ana',    team: 'home', goals: 0 },
    p2: { id: 'p2', name: 'Anabel', team: 'home', goals: 0 },
    p3: { id: 'p3', name: 'Carlos', team: 'away', goals: 0 },
};

ok('2d · [HUECO CERRADO] "GOL · Anabel" encuentra SOLO a Anabel, no a Ana',
   findPlayer(playersMap, 'GOL · Anabel')?.id === 'p2');
ok('2e · [HUECO CERRADO] "GOL · Ana" encuentra SOLO a Ana, no a Anabel',
   findPlayer(playersMap, 'GOL · Ana')?.id === 'p1');
ok('2f · jugador sin evento coincidente -> null',
   findPlayer(playersMap, 'GOL · Nadie De Este Equipo') === null);
ok('2g · formatos reales de _registerMatchEvent: tarjeta amarilla',
   findPlayer(playersMap, 'TARJETA AMARILLA · Carlos')?.id === 'p3');
ok('2h · formatos reales de _registerMatchEvent: cambio (sub_in)',
   findPlayer(playersMap, 'CAMBIO · Entra · Anabel')?.id === 'p2');
ok('2i · formatos reales de _registerMatchEvent: lesión',
   findPlayer(playersMap, 'LESIÓN · Ana')?.id === 'p1');

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

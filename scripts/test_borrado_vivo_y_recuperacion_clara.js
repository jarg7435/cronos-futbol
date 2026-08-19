// ════════════════════════════════════════════════════════════════════════
//  test_borrado_vivo_y_recuperacion_clara.js
//  EL FANTASMA IMBORRABLE · Y LA RECUPERACIÓN SIN JUGADORES — v588
// ════════════════════════════════════════════════════════════════════════
//  Dos incidencias del autor sobre v587:
//
//  1. "No se pudo eliminar el partido: Missing or insufficient permissions"
//     (captura 9292), con la tarjeta clavada en la lista.
//     🔑🔑🔑 MEDIDO POR REST: el partido que fallaba
//     (`local-19082026-rrh8-1529`) **ya no existía en `live_matches`**; seguía
//     sólo en `live_index`, que es de donde se pinta la lista desde v572. El
//     borrado de live.html sólo tocaba `live_matches`, así que la primera
//     pulsación dejaba el índice huérfano y las siguientes intentaban borrar un
//     documento inexistente — que en el lenguaje de reglas NO es "no
//     encontrado" sino **DENEGADO** (`resource.data` es null y la condición
//     revienta). De ahí un mensaje de permisos para algo que no era de
//     permisos, y una tarjeta imborrable para siempre. Trampa de v521→v524.
//
//  2. "Al recuperar, el partido se recuperó SIN los jugadores" (captura 9293),
//     y dos opciones ("nube" / "dispositivo") que no se entienden.
//     🔑 La fusión elegía la foto MÁS RECIENTE sin mirar nada más, y la más
//     reciente puede ser justo la que no tiene alineación: el estado se guarda
//     también en instantes en que `players` está vacío. Un segundo de
//     diferencia decidía entre recuperar el partido o un campo en blanco.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LIVE  = leer('live.html');
const SETUP = leer('js/core/setup-modal.js');

// ── La fusión REAL, ejecutada ──────────────────────────────────────────
function trozo(src, cab) {
    const i = src.indexOf(cab);
    if (i < 0) throw new Error('No se encontró ' + cab);
    let prof = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) {
        if (src[j] === '{') prof++;
        else if (src[j] === '}') { prof--; if (prof === 0) { j++; break; } }
    }
    return src.slice(i, j);
}
const sb = { console: { log() {}, warn() {} }, String, Map, Array, Object, Date, Number, isNaN };
sb.window = sb;
vm.createContext(sb);
['function _recoveryNorm(', 'function _recoveryTs(', 'function _recoveryClaves(',
 'function _fusionaCandidatosRecuperacion('].forEach(c => vm.runInContext(trozo(SETUP, c), sb));
const fusiona = vm.runInContext('_fusionaCandidatosRecuperacion', sb);

const jug = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: 'J' + i }));
const T = (min) => new Date(Date.UTC(2026, 7, 19, 15, min)).toISOString();

console.log('\n── 1 · una copia sin jugadores nunca gana a una que los tiene ──');
{
    // El caso del autor: la foto MÁS RECIENTE es la que NO trae alineación.
    const local = { isLocal: true, _slotId: 's1', liveMatchId: 'm1', savedAt: T(30),
                    homeTeam: { name: 'Regional FEM A' }, awayTeam: { name: 'Visitante' },
                    mode: 'f11', players: [] };
    const nube  = { _id: 'm1', savedAt: T(25),
                    homeTeam: { name: 'Regional FEM A' }, awayTeam: { name: 'Visitante' },
                    mode: 'f11', players: jug(14) };
    const r = fusiona(local, [nube]);
    ok('1a · 🔑 se fusionan en UNA sola entrada', r.length === 1, r.length);
    ok('1b · 🔑🔑🔑 se elige la copia CON los 14 jugadores, aunque sea más antigua',
       r[0].datos.players.length === 14, r[0].datos.players.length);
    ok('1c · ⚠️ y la entrada conserva el sello MÁS RECIENTE (ordena la lista)',
       r[0].ts === new Date(T(30)).getTime(), r[0].ts);
    ok('1d · sigue constando que hay copia local y copia en la nube',
       r[0].tieneLocal === true && r[0].idsNube.length === 1);
}
{
    // Al revés: la reciente SÍ tiene jugadores. Manda ella, como siempre.
    const local = { isLocal: true, _slotId: 's1', liveMatchId: 'm1', savedAt: T(30),
                    homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, mode: 'f11', players: jug(11) };
    const nube  = { _id: 'm1', savedAt: T(25),
                    homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, mode: 'f11', players: jug(14) };
    const r = fusiona(local, [nube]);
    ok('1e · ⚠️ entre dos CON jugadores manda la más reciente (no la más poblada)',
       r[0].datos.players.length === 11, r[0].datos.players.length);
}
{
    // Las dos vacías: no hay nada mejor que elegir, pero no se pierde la entrada.
    const local = { isLocal: true, _slotId: 's1', liveMatchId: 'm1', savedAt: T(30),
                    homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, mode: 'f11', players: [] };
    const nube  = { _id: 'm1', savedAt: T(25),
                    homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, mode: 'f11', players: [] };
    const r = fusiona(local, [nube]);
    ok('1f · si ninguna tiene alineación, se enseña igualmente la más reciente',
       r.length === 1 && r[0].datos.savedAt === T(30));
}
{
    // Dos partidos DISTINTOS no se fusionan por esta regla.
    const a = { isLocal: true, _slotId: 's1', liveMatchId: 'm1', savedAt: T(30),
                homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, mode: 'f11', players: jug(14) };
    const b = { _id: 'm2', savedAt: T(25),
                homeTeam: { name: 'C' }, awayTeam: { name: 'D' }, mode: 'f11', players: [] };
    const r = fusiona(a, [b]);
    ok('1g · ⚠️ dos partidos distintos siguen siendo DOS entradas', r.length === 2, r.length);
}

console.log('\n── 2 · las tarjetas explican qué implica cada opción ──');
{
    ok('2a · 🔑 cada tarjeta lleva una explicación en castellano, no sólo la etiqueta',
       /const origenExplica =/.test(SETUP) && /\$\{explicacion\}/.test(SETUP));
    ok('2b · dice que "sólo en este dispositivo" no se verá desde otro aparato',
       /no aparecer/.test(SETUP));
    ok('2c · y que "sólo en la nube" viene de OTRO dispositivo',
       /desde OTRO dispositivo/.test(SETUP));
    ok('2d · 🔑🔑 CERO jugadores es un AVISO, no un dato suelto',
       /Esta copia no tiene jugadores guardados/.test(SETUP) &&
       /el campo saldrá[\s\S]{0,60}vacío/.test(SETUP));
    ok('2e · y el contador se pinta en rojo cuando es cero',
       /playerCount === 0 \? 'color:#ff5858/.test(SETUP));
}

console.log('\n── 3 · borrar un partido en vivo se lleva SIEMPRE el índice ──');
{
    const i = LIVE.indexOf('let okIndice = false, okPartido = false;');
    ok('3a · 🔑 live.html borra también `live_index`', i > 0 && /live_index/.test(LIVE));
    const cuerpo = LIVE.slice(i, i + 1800);
    ok('3b · 🔑🔑🔑 el ÍNDICE va PRIMERO (es lo que el usuario ve)',
       cuerpo.indexOf("'live_index'") < cuerpo.indexOf("'live_matches'"),
       'si va después, un fallo del partido deja la tarjeta clavada para siempre');
    ok('3c · 🔑 cada borrado lleva su propio `catch`: uno no impide el otro',
       /catch \(eIdx\)/.test(cuerpo) && /catch \(ePar\)/.test(cuerpo));
    ok('3d · ⚠️ sólo se avisa de error si NO se pudo borrar ninguno de los dos',
       /if \(!okIndice && !okPartido\) \{/.test(cuerpo),
       'avisar cuando uno de los dos salió sería un falso error');
}
{
    // El mismo defecto estaba en el panel de recuperación.
    const i = SETUP.indexOf("await deleteDoc(doc(fa.db, 'live_index', matchId));");
    const j = SETUP.indexOf("await deleteDoc(doc(fa.db, 'live_matches', matchId));");
    ok('3e · 🔑 en el panel de recuperación el índice también va primero',
       i > 0 && j > 0 && i < j, { i, j });
    ok('3f · ⚠️ y el borrado del partido no puede tumbar el del índice',
       /catch \(ePar\)/.test(SETUP.slice(i, i + 900)),
       'v572 lo dejaba sin proteger: si el partido fallaba, el índice no se borraba nunca');
}

console.log('\n── 4 · v589 · a la vista, sólo la copia que sirve ──');
{
    // El separador REAL, ejecutado.
    vm.runInContext(trozo(SETUP, 'function _recuperacionSeparaDudosas('), sb);
    const separa = vm.runInContext('_recuperacionSeparaDudosas', sb);

    const buena  = { datos: { players: jug(18), timeH1: 117, mode: 'f11' } };
    const sinJug = { datos: { players: [],      timeH1: 0,   mode: 'f11' } };
    const r = separa([buena, sinJug]);
    ok('4a · 🔑🔑🔑 la copia con alineación es la única a la vista',
       r.fiables.length === 1 && r.fiables[0] === buena, r.fiables.length);
    ok('4b · y la que no tiene jugadores queda apartada',
       r.dudosas.length === 1 && r.dudosas[0] === sinJug);
    ok('4c · ⚠️⚠️ si TODAS son dudosas, se enseñan todas (esconder la única sería peor)',
       (() => { const s = separa([sinJug]); return s.fiables.length === 1 && s.dudosas.length === 0; })());
    ok('4d · sin entradas, no revienta',
       (() => { const s = separa([]); return s.fiables.length === 0 && s.dudosas.length === 0; })());
}
{
    // 🔑 El caso exacto de la captura 9296: tres tarjetas, una buena.
    ok('4e · 🔑 una ranura SIN NADA (0 jugadores, 0 tiempo, 0 goles) se descarta antes de llegar al panel',
       /if \(vacia\) \{/.test(SETUP) && /sin nada que recuperar/.test(SETUP));
    ok('4f · ⚠️ pero una entrada ROTA (sin objeto de datos) se ENSEÑA igualmente',
       /if \(!entrada \|\| !entrada\.datos \|\| typeof entrada\.datos !== 'object'\) return true;/.test(SETUP),
       'perder un partido por un fallo del propio filtro es peor que enseñar una tarjeta rara');
    ok('4g · 🔑 y una incoherente CON JUEGO no se descarta, se pliega',
       /no se descarta aqu/i.test(SETUP) && /_recuperacionSeparaDudosas/.test(SETUP));
}

console.log('\n── 5 · v589 · la tarjeta en vivo desaparece al instante ──');
{
    const i = LIVE.indexOf('window._liveBorrados.add(matchId);');
    ok('5a · 🔑 el id borrado se apunta en una lápida', i > 0);
    const cuerpo = LIVE.slice(i - 900, i + 900);
    ok('5b · 🔑🔑🔑 y la tarjeta se retira del DOM en el acto, sin esperar al servidor',
       /querySelectorAll\('\[data-match-id="' \+ matchId \+ '"\]'\)/.test(cuerpo) &&
       /el\.remove\(\)/.test(cuerpo));
    ok('5c · 🔑 ningún repintado la vuelve a dibujar mientras tanto',
       /allDocs = allDocs\.filter\(m => !window\._liveBorrados\.has\(m\.id\)\)/.test(LIVE),
       'la lista se repinta entera en cada latido: sin esto, la tarjeta vuelve sola');
    ok('5d · el Historial aplica la misma lápida',
       /allDocs2 = allDocs2\.filter\(m => !window\._liveBorrados\.has\(m\.id\)\)/.test(LIVE));
    ok('5e · ⚠️⚠️ la lápida CADUCA: un borrado que falló no puede esconder un partido vivo para siempre',
       /_liveBorrados\.delete\(matchId\)/.test(LIVE) && /60000/.test(cuerpo),
       'sin caducidad, un fallo de red escondería un partido en curso');
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos === 0) console.log('✅ Sin fantasmas imborrables, y la recuperación se explica');
else console.log('❌ ' + fallos + ' aserción(es) en rojo');
process.exit(fallos === 0 ? 0 : 1);

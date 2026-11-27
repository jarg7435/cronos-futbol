// ─────────────────────────────────────────────────────────────────────────
// test_recuperar_sin_perdida_offline.js · «Recuperar partido» NO puede tirar
// lo registrado sin red (v865)
//
// PRUEBA DE CAMPO DEL 26-11 (testeo v863, VALIDACION_E2E_Y_APPCHECK.md §4):
// partido `regional-b-26112026-pwx8-2320`. Con el iPad en modo avión se
// registraron 5 sucesos (min 13:04-13:14), se cerró la app y, al volver la
// red y entrar en «Recuperar partido», el partido volvió al estado de ANTES
// del corte: el documento quedó en 3-1 con 4-2 en sucesos.
//
// 🔑 LA CAUSA: la fusión de «Recuperar» elegía entre la ranura del aparato
// (`savedAt`, 23:36:10) y el documento de la nube por su `updatedAt`. Pero ese
// `updatedAt` lo sube TAMBIÉN la cola de sucesos (outbox.js) al vaciarse tras
// volver la red (≈ 23:40), sin tocar marcador ni alineación. La nube parecía
// más nueva, ganaba, y `_doResumeMatch` restauraba su foto VIEJA.
//
// EL ARREGLO: la foto de la nube lleva `estadoAt`, la hora (del aparato que
// la escribe) en que se tomó el ESTADO. Sólo la escribe el latido completo
// (pushLiveSnapshot); la cola de sucesos, el marcador rápido y los demás
// escritores NO la tocan. La fusión compara `estadoAt` con `savedAt`.
// Un documento anterior sin `estadoAt` sigue con la regla de siempre.
//
// ESTE GUARD EJECUTA la fusión real de js/core/setup-modal.js.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 240)); }
};
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const SM = fs.readFileSync(path.join(ROOT, 'js/core/setup-modal.js'), 'utf8');
const SY = sinCom(fs.readFileSync(path.join(ROOT, 'js/match/live/sync.js'), 'utf8'));
const OB = sinCom(fs.readFileSync(path.join(ROOT, 'js/match/live/outbox.js'), 'utf8'));

console.log('── Recuperar partido no tira lo registrado sin red (v865) ──\n');

const ini = SM.indexOf('function _recoveryNorm(');
const fin = SM.indexOf('window._fusionaCandidatosRecuperacion');
ok('0a · el bloque de fusión sigue en setup-modal.js', ini !== -1 && fin > ini);
if (ini === -1 || fin <= ini) { console.log('\n' + pass + ' PASS / ' + (fail + 1) + ' FAIL'); process.exit(1); }

const sandbox = { console: { log() {}, warn() {} }, window: {}, Map };
vm.createContext(sandbox);
vm.runInContext(SM.slice(ini, fin) + '\n;globalThis.fusiona = _fusionaCandidatosRecuperacion;', sandbox);
const { fusiona } = sandbox;

const ms = (iso) => new Date(iso).getTime();
const jugadores = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const ID = 'regional-b-26112026-pwx8-2320';

// La ranura del iPad: guardada sin red, con lo registrado sin red (4-2).
const local = (o) => Object.assign({
    _id: 'local_active', _slotId: ID, isLocal: true, liveMatchId: ID,
    savedAt: '2026-11-26T23:36:10.000Z',
    homeTeam: { name: 'REGIONAL B', score: 4 }, awayTeam: { name: 'VISITANTE', score: 2 },
    mode: 'f11', phase: '1st_half', timeH1: 796, players: jugadores(18),
}, o);
// El documento de la nube: foto de ANTES del corte (3-1), pero `updatedAt`
// subido por la cola de sucesos al volver la red.
const nube = (o) => Object.assign({
    _id: ID,
    updatedAt: { toMillis: () => ms('2026-11-26T23:40:05.000Z') },
    estadoAt: ms('2026-11-26T23:35:50.000Z'),
    homeTeam: { name: 'REGIONAL B', score: 3 }, awayTeam: { name: 'VISITANTE', score: 1 },
    mode: 'f11', phase: '1st_half', timeH1: 776, players: jugadores(18),
}, o);

console.log('── PARTE 1 · el caso del 26-11 ──');
{
    const e = fusiona([local()], [nube()]);
    ok('1a · una sola tarjeta para el partido', e.length === 1, e.length + ' entradas');
    ok('1b · 🔑 gana la RANURA DEL APARATO (lo registrado sin red), no la foto vieja de la nube',
       e[0] && e[0].datos && e[0].datos.isLocal === true,
       'eligió ' + (e[0] && e[0].datos && (e[0].datos.isLocal ? 'local' : 'nube')) +
       ' con marcador ' + (e[0] && e[0].datos && e[0].datos.homeTeam.score + '-' + e[0].datos.awayTeam.score));
    ok('1c · y se retoma con el marcador de 4-2',
       e[0] && e[0].datos && e[0].datos.homeTeam.score === 4 && e[0].datos.awayTeam.score === 2);
    ok('1d · la tarjeta sigue sabiendo que está en las dos fuentes (borrar se lleva las dos)',
       e[0] && e[0].tieneLocal === true && e[0].idsNube.length === 1);
    // El orden de llegada de las fuentes no puede cambiar la elección.
    const e2 = fusiona([], [nube()]).concat([]);
    ok('1e · sin ranura en el aparato, la nube se sigue ofreciendo', e2.length === 1 && e2[0].datos._id === ID);
}

console.log('\n── PARTE 2 · lo que NO puede romperse ──');
{
    // Partido seguido desde OTRO aparato: su foto es de verdad más nueva.
    let e = fusiona([local()], [nube({ estadoAt: ms('2026-11-26T23:38:00.000Z') })]);
    ok('2a · si la FOTO de la nube es más nueva (otro aparato siguió el partido), gana la nube',
       e[0] && e[0].datos && !e[0].datos.isLocal);
    // Documento anterior a v865 (sin estadoAt): la regla de siempre.
    e = fusiona([local()], [nube({ estadoAt: undefined })]);
    ok('2b · documento sin estadoAt (anterior a v865) → regla de siempre por updatedAt',
       e[0] && e[0].datos && !e[0].datos.isLocal);
    e = fusiona([local({ savedAt: '2026-11-26T23:41:00.000Z' })], [nube({ estadoAt: undefined })]);
    ok('2c · …y con la ranura más nueva que updatedAt, gana la ranura', e[0] && e[0].datos && e[0].datos.isLocal);
    // v588 · una foto sin jugadores nunca gana a una con jugadores.
    e = fusiona([local({ players: [] })], [nube()]);
    ok('2d · v588 intacto: una ranura SIN jugadores no gana a una nube con jugadores',
       e[0] && e[0].datos && !e[0].datos.isLocal);
    // Un estadoAt basura no puede colarse como "muy nuevo".
    e = fusiona([local()], [nube({ estadoAt: 'mañana' })]);
    ok('2e · estadoAt que no es número → se ignora (regla de siempre)', e[0] && e[0].datos && !e[0].datos.isLocal);
}

console.log('\n── PARTE 3 · quién escribe estadoAt ──');
{
    const iSnap = SY.indexOf('const snapshot = {');
    const fSnap = SY.indexOf('players: players.map(_mapPlayerForSnapshot)', iSnap);
    const bloque = (iSnap !== -1 && fSnap > iSnap) ? SY.slice(iSnap, fSnap) : '';
    ok('3a · la foto completa del latido (pushLiveSnapshot) lleva estadoAt', /\bestadoAt\s*:/.test(bloque));
    ok('3b · …con la hora del aparato en el momento de tomar la foto', /estadoAt\s*:[^,\n]*Date\.now\(\)/.test(bloque));
    ok('3c · la cola de sucesos (outbox.js) NO escribe estadoAt', !/estadoAt/.test(OB));
    const iM = SY.indexOf('_marcadorSeq = Math.max(Date.now(), _marcadorSeq + 1);');
    const fM = SY.indexOf('}, { merge: true });', iM);
    ok('3d · el marcador rápido (live_index) NO escribe estadoAt',
       iM !== -1 && fM > iM && !/estadoAt/.test(SY.slice(iM, fM)));
    const otros = ['js/match/events/player-actions.js', 'js/match/events/retroactive-modal.js', 'js/core/app-init.js']
        .filter(f => /estadoAt/.test(sinCom(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
    ok('3e · ningún otro escritor de live_matches toca estadoAt', otros.length === 0, otros.join(', '));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

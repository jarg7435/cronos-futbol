// ─────────────────────────────────────────────────────────────────────────
// test_replay_fidelity.js  ·  "Revivir" debe ser una copia FIEL del partido
//
// Requisito del autor (2026-07-29): al pulsar "Revivir" en Partidos
// Terminados, la repeticion tiene que reproducir el partido tal y como se
// retransmitio: once inicial, dorsales, colores, posiciones, cambios,
// tarjetas, lesiones, marcador y minutero.
//
// Este test carga el ARCHIVO REAL js/match/replay/replay-player.js en un
// sandbox con un DOM falso, le pasa un partido fabricado y comprueba el HTML
// que pinta en cada instante. No mira el codigo fuente: mira el resultado.
//
// LOS CUATRO DEFECTOS QUE FIJA (medidos antes de arreglarlos):
//
//  A · EL FRAME 0 MOSTRABA EL ONCE FINAL. `pushLiveSnapshot` (sync.js)
//      reescribe `players` en cada latido de 5 s, asi que el documento solo
//      guarda la ULTIMA foto. El visor la usaba como estado inicial (la
//      variable se llamaba `initialPlayers` pero contenia el estado final):
//      el que entro en el 60' aparecia en el campo desde el segundo 0 y los
//      cambios se aplicaban encima de un estado que ya los tenia aplicados.
//      Fix: persistir `initialPlayers` UNA sola vez al arrancar, y para los
//      partidos ya grabados reconstruir el once invirtiendo los cambios.
//
//  B · LOS EVENTOS DE LA 2a PARTE SE IBAN +30:00. `_registerMatchEvent`
//      guarda el minuto de la 2a parte YA ACUMULADO (h1+h2), y el visor le
//      sumaba otros 1800 s fijos. Como la barra llega solo hasta
//      half1MaxTime+half2MaxTime, casi toda la 2a parte caia FUERA y no se
//      reproducia nunca (en prebenjamin, 1 de cada 61 instantes era
//      visible). Ademas el 1800 estaba fijo, y las partes duran 30/35/40/45
//      min segun categoria (setup-modal.js).
//
//  C · SOLO SE MOVIA QUIEN FUE ARRASTRADO. `tactical_move` solo lo emite el
//      drag&drop; el resto se quedaba en su posicion FINAL toda la
//      repeticion. Se arregla solo con A (sembrar desde el once inicial).
//
//  D · LOS CAMBIOS RETROACTIVOS SE IGNORABAN. retroactive-modal.js registra
//      el tipo 'sub' (un solo evento con los dos jugadores en el texto), y
//      el visor solo entendia 'sub_in'/'sub_out'.
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

console.log('── replay-player.js: fidelidad de la repeticion ──\n');

const REPLAY = path.join(ROOT, 'js', 'match', 'replay', 'replay-player.js');
const src = fs.readFileSync(REPLAY, 'utf8');

// ═════════════════ DOM falso: solo lo que el archivo usa ═════════════════
// El visor escribe el modal entero en innerHTML y luego pinta las fichas en
// tres contenedores por id. Registramos esos tres para poder leer el HTML.
function makeEl(id) {
    return {
        id, innerHTML: '', textContent: '', value: '',
        style: {}, children: [],
        appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return ''; },
        querySelector() { return null; }, querySelectorAll() { return []; },
    };
}

function buildSandbox() {
    const registry = {};
    ['replay-pitch-players', 'replay-bench-home', 'replay-bench-away',
     'replay-score-home', 'replay-score-away',
     'replay-timer-display', 'replay-phase-display',
     'replay-seekbar', 'replay-seek-curr'].forEach(id => { registry[id] = makeEl(id); });

    const documentStub = {
        getElementById: (id) => registry[id] || null,
        createElement: () => makeEl(''),
        body: { appendChild(el) { if (el && el.id) registry[el.id] = el; } },
    };

    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document: documentStub,
        setInterval: () => 0,
        clearInterval: () => {},
        escapeHtml: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        _registry: registry,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox;
}

// ═════════════════ Partido fabricado ═════════════════
// Prebenjamin: 30 min por parte -> maxTime 3600 s.
// ONCE INICIAL: Alba, Carla y Diego en el campo; Bruno en el banquillo.
// En el minuto 35 (acumulado, o sea 5' de la 2a parte) Carla deja su sitio a
// Bruno. El ESTADO FINAL, por tanto, tiene a Bruno en el campo y a Carla en
// el banquillo — que es justo lo que guarda `players`.
const ONCE_INICIAL = [
    { id: 1, number: 1, name: 'Alba',  team: 'home', status: 'field', x: 15, y: 50 },
    { id: 2, number: 2, name: 'Bruno', team: 'home', status: 'bench', x: 0,  y: 0  },
    { id: 3, number: 3, name: 'Carla', team: 'home', status: 'field', x: 45, y: 30 },
    { id: 4, number: 4, name: 'Diego', team: 'home', status: 'field', x: 60, y: 70 },
];
const ESTADO_FINAL = [
    { id: 1, number: 1, name: 'Alba',  team: 'home', status: 'field', x: 20, y: 55 },
    { id: 2, number: 2, name: 'Bruno', team: 'home', status: 'field', x: 40, y: 30 },
    { id: 3, number: 3, name: 'Carla', team: 'home', status: 'bench', x: 45, y: 30 },
    { id: 4, number: 4, name: 'Diego', team: 'home', status: 'field', x: 60, y: 70 },
];

function partido(extra) {
    return Object.assign({
        id: 'test-match',
        mode: 'f7',
        half1MaxTime: 1800,
        half2MaxTime: 1800,
        homeTeam: { name: 'CRONOS', score: 2, color: '#112233', shorts: '#445566', textColor: '#ffffff' },
        awayTeam: { name: 'RIVAL',  score: 0, color: '#aabbcc', shorts: '#ddeeff', textColor: '#000000' },
        players: JSON.parse(JSON.stringify(ESTADO_FINAL)),
        events: [
            { type: 'goal',    text: 'GOL · Alba',                 matchTime: '1T 10:00' },
            { type: 'sub_out', text: 'CAMBIO · Sale · Carla',      matchTime: '2T 35:00' },
            { type: 'sub_in',  text: 'CAMBIO · Entra · Bruno',     matchTime: '2T 35:00' },
            { type: 'goal',    text: 'GOL · Bruno',                matchTime: '2T 40:00' },
        ],
    }, extra || {});
}

// Lee quien esta en el campo / en el banquillo en el instante `sec`.
async function frame(sandbox, data, sec) {
    await sandbox.window.openMatchReplay(data);
    sandbox.window._replaySeek(sec);
    const reg = sandbox._registry;
    const nombres = (html) => {
        const out = [];
        for (const n of ['Alba', 'Bruno', 'Carla', 'Diego']) {
            if (new RegExp('(^|[>\\s])' + n + '([<\\s]|$)').test(html)) out.push(n);
        }
        return out.sort();
    };
    return {
        campo:     nombres(reg['replay-pitch-players'].innerHTML),
        banquillo: nombres(reg['replay-bench-home'].innerHTML).sort(),
        pitchHtml: reg['replay-pitch-players'].innerHTML,
        marcador:  reg['replay-score-home'].textContent + '-' + reg['replay-score-away'].textContent,
    };
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {

// ═══════════ PARTE 1 · A: el frame 0 es el ONCE INICIAL, no el final ═══════════
console.log('── PARTE 1 · el minuto 0 muestra la alineacion INICIAL (defecto A) ──');
{
    const sb = buildSandbox();
    const f0 = await frame(sb, partido({ initialPlayers: JSON.parse(JSON.stringify(ONCE_INICIAL)) }), 0);
    ok('1a · en el minuto 0 estan en el campo los TITULARES (Alba, Carla, Diego)',
       eq(f0.campo, ['Alba', 'Carla', 'Diego']), 'campo: ' + JSON.stringify(f0.campo));
    ok('1b · y el suplente (Bruno) esta en el banquillo, NO en el campo',
       eq(f0.banquillo, ['Bruno']), 'banquillo: ' + JSON.stringify(f0.banquillo));
    ok('1c · las POSICIONES del minuto 0 son las iniciales, no las finales (defecto C)',
       /left:15%/.test(f0.pitchHtml) && /left:45%/.test(f0.pitchHtml),
       'se esperaba a Alba en x=15 y a Carla en x=45');
}

// ═══════════ PARTE 2 · A: el cambio ocurre en su minuto, ni antes ni despues ═══
console.log('\n── PARTE 2 · el cambio se aplica en su minuto exacto ──');
{
    const sb = buildSandbox();
    const data = partido({ initialPlayers: JSON.parse(JSON.stringify(ONCE_INICIAL)) });
    const antes = await frame(sb, data, 2099);   // 1 s antes del cambio (35:00 = 2100 s)
    ok('2a · justo ANTES del minuto 35 sigue Carla en el campo y Bruno en el banquillo',
       eq(antes.campo, ['Alba', 'Carla', 'Diego']) && eq(antes.banquillo, ['Bruno']),
       'campo: ' + JSON.stringify(antes.campo) + ' banquillo: ' + JSON.stringify(antes.banquillo));

    const sb2 = buildSandbox();
    const despues = await frame(sb2, data, 2100); // el minuto exacto del cambio
    ok('2b · EN el minuto 35 entra Bruno y sale Carla',
       eq(despues.campo, ['Alba', 'Bruno', 'Diego']) && eq(despues.banquillo, ['Carla']),
       'campo: ' + JSON.stringify(despues.campo) + ' banquillo: ' + JSON.stringify(despues.banquillo));
}

// ═══════════ PARTE 3 · B: el minutero de la 2a parte ═══════════════════════════
console.log('\n── PARTE 3 · minutero: la 2a parte NO se desplaza +30:00 (defecto B) ──');
{
    const sb = buildSandbox();
    const data = partido({ initialPlayers: JSON.parse(JSON.stringify(ONCE_INICIAL)) });

    const f10 = await frame(sb, data, 600);
    ok('3a · el gol del minuto 10 (1a parte) cuenta en el minuto 10', f10.marcador === '1-0',
       'marcador: ' + f10.marcador);

    const sb2 = buildSandbox();
    const f39 = await frame(sb2, data, 2399);
    ok('3b · el gol del minuto 40 NO cuenta todavia en el 39:59', f39.marcador === '1-0',
       'marcador: ' + f39.marcador);

    const sb3 = buildSandbox();
    const f40 = await frame(sb3, data, 2400);
    ok('3c · [DEFECTO B] el gol del minuto 40 (2a parte) SI cuenta en el minuto 40',
       f40.marcador === '2-0', 'marcador: ' + f40.marcador + ' (antes del fix se iba a 70:00 y no se veia nunca)');

    const sb4 = buildSandbox();
    const fin = await frame(sb4, data, 3600);
    ok('3d · al final de la repeticion el marcador coincide con el guardado (2-0)',
       fin.marcador === '2-0', 'marcador: ' + fin.marcador);
}

// ═══════════ PARTE 4 · B: partes que NO duran 30 min ═══════════════════════════
console.log('\n── PARTE 4 · categorias cuyas partes no duran 30 min (el 1800 fijo) ──');
{
    // Juvenil: 45 min por parte. Un gol a los 5' de la 2a parte se guarda como
    // "2T 50:00" (acumulado). Debe caer en 3000 s, no en 4800.
    const sb = buildSandbox();
    const data = partido({
        initialPlayers: JSON.parse(JSON.stringify(ONCE_INICIAL)),
        half1MaxTime: 2700, half2MaxTime: 2700,
        events: [{ type: 'goal', text: 'GOL · Alba', matchTime: '2T 50:00' }],
    });
    const antes = await frame(sb, data, 2999);
    const sb2 = buildSandbox();
    const justo = await frame(sb2, data, 3000);
    ok('4a · en juvenil (45 min/parte) el gol de "2T 50:00" cae en 50:00, no en 80:00',
       antes.marcador === '0-0' && justo.marcador === '1-0',
       '49:59 -> ' + antes.marcador + ' | 50:00 -> ' + justo.marcador);
}

// ═══════════ PARTE 5 · D: cambios retroactivos ════════════════════════════════
console.log('\n── PARTE 5 · el cambio retroactivo (tipo "sub") se reproduce (defecto D) ──');
{
    const sb = buildSandbox();
    const data = partido({
        initialPlayers: JSON.parse(JSON.stringify(ONCE_INICIAL)),
        events: [
            // Formato REAL de retroactive-modal.js:173
            { type: 'sub', text: 'CAMBIO · Sale Diego, Entra Bruno (Retroactivo)', matchTime: '2T 40:00' },
        ],
    });
    const antes = await frame(sb, data, 2399);
    ok('5a · antes del minuto 40 el cambio retroactivo aun no se ha aplicado',
       eq(antes.campo, ['Alba', 'Carla', 'Diego']), 'campo: ' + JSON.stringify(antes.campo));

    const sb2 = buildSandbox();
    const despues = await frame(sb2, data, 2400);
    ok('5b · [DEFECTO D] en el minuto 40 sale Diego y entra Bruno',
       eq(despues.campo, ['Alba', 'Bruno', 'Carla']) && eq(despues.banquillo, ['Diego']),
       'campo: ' + JSON.stringify(despues.campo) + ' banquillo: ' + JSON.stringify(despues.banquillo));
}

// ═══════════ PARTE 6 · retrocompatibilidad: partidos SIN initialPlayers ═══════
console.log('\n── PARTE 6 · partidos ya grabados (sin initialPlayers): reconstruccion ──');
{
    // Sin `initialPlayers`, el once se reconstruye invirtiendo los cambios
    // desde el estado final. Las posiciones exactas no se pueden recuperar,
    // pero SI quien era titular y quien suplente.
    const sb = buildSandbox();
    const f0 = await frame(sb, partido(), 0);   // partido() NO lleva initialPlayers
    ok('6a · sin initialPlayers, el minuto 0 reconstruye el once invirtiendo los cambios',
       eq(f0.campo, ['Alba', 'Carla', 'Diego']) && eq(f0.banquillo, ['Bruno']),
       'campo: ' + JSON.stringify(f0.campo) + ' banquillo: ' + JSON.stringify(f0.banquillo));

    const sb2 = buildSandbox();
    const fin = await frame(sb2, partido(), 3600);
    ok('6b · y al final se vuelve al estado final realmente guardado',
       eq(fin.campo, ['Alba', 'Bruno', 'Diego']) && eq(fin.banquillo, ['Carla']),
       'campo: ' + JSON.stringify(fin.campo) + ' banquillo: ' + JSON.stringify(fin.banquillo));
}

// ═══════════ PARTE 7 · estructura: que no vuelvan los defectos ═══════════════
console.log('\n── PARTE 7 · estructura (que no reaparezcan) ──');
{
    const limpio = src.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    ok('7a · ya no queda el desplazamiento fijo de 1800 s para la 2a parte',
       !/'2T'\s*\?\s*1800\s*:\s*0/.test(limpio));
    ok('7b · el visor lee data.initialPlayers (no solo una variable con ese nombre)',
       /data\.initialPlayers/.test(limpio));
    ok('7c · sync.js persiste la alineacion inicial',
       /initialPlayers/.test(fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8')));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

})();

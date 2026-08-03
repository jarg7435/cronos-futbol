// ─────────────────────────────────────────────────────────────────────────
// test_replay_visual_parity.js  ·  la REPETICION se ve como el partido EN VIVO
//
// Requisito del autor (2026-08-03, implementar.txt): al abrir "REPETICION DEL
// PARTIDO" la experiencia visual debe ser identica a la del panel en vivo y a
// la pantalla en directo del entrenador:
//   1. fichas y dorsales de tamano legible (eran circulos de 26 px),
//   2. cada ficha con su cajita de cronometro individual arriba, como en la
//      retransmision,
//   3. esa cajita coloreada segun el semaforo del partido ORIGINAL, o en
//      celeste si el semaforo estaba desactivado.
//
// LO QUE ESTE GUARD PROTEGE DE VERDAD (los tres sitios donde esto se rompe):
//
//  A · EL TIEMPO JUGADO NO SE PUEDE LEER, HAY QUE INTEGRARLO. `data.players`
//      es la ULTIMA foto de pushLiveSnapshot (la reescribe entera cada 5 s),
//      asi que sus `time` son los TOTALES al acabar. Si alguien "simplifica"
//      el codigo leyendo p.time, la repeticion pintara en el minuto 3 los 47'
//      finales de cada jugador. Las aserciones 2a-2d miden el cronometro en
//      instantes concretos, no miran el codigo.
//
//  B · EL SEMAFORO DEL PARTIDO NO ES EL DEL CLUB DE HOY. Desde v427 el
//      snapshot persiste `semaforoActive`; si existe, MANDA sobre la categoria
//      y sobre categoryConfigs, porque el Director puede haber apagado el
//      semaforo o movido los umbrales DESPUES del partido y la repeticion debe
//      seguir mostrando lo que se retransmitio.
//
//  C · EL EXPORTADOR DE VIDEO LEIA LA ESTRUCTURA POR POSICION. drawPitchFrame
//      seleccionaba `div[style*="position:absolute"]` y cogia el nombre con
//      `chip.children[1]`. Al pasar las fichas a clases, `position:absolute` se
//      lo lleva la hoja y el orden de hijos cambia: el selector no encuentra
//      NADA y el video sale con el campo vacio, sin ningun error. Es el mismo
//      patron que ya costo caro en v418-v421 (el TEXTO/la FORMA de un nodo no
//      puede ser el contrato de datos).
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

console.log('── replay-player.js: paridad visual con el directo ──\n');

const REPLAY = path.join(ROOT, 'js', 'match', 'replay', 'replay-player.js');
const src = fs.readFileSync(REPLAY, 'utf8');

// ═════════════════ DOM falso ═════════════════
// Igual que en test_replay_fidelity.js: solo lo que el archivo usa. `head` se
// deja a proposito con appendChild registrado, para poder leer la hoja que el
// modulo inyecta (no puede vivir en style.css: live.html no la carga).
function makeEl(id) {
    return {
        id, innerHTML: '', textContent: '', value: '',
        style: {}, children: [],
        appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return ''; },
        querySelector() { return null; }, querySelectorAll() { return []; },
    };
}

function buildSandbox(windowExtras) {
    const registry = {};
    ['replay-pitch-players', 'replay-bench-home', 'replay-bench-away',
     'replay-score-home', 'replay-score-away',
     'replay-timer-display', 'replay-phase-display',
     'replay-seekbar', 'replay-seek-curr'].forEach(id => { registry[id] = makeEl(id); });

    const injected = [];
    const documentStub = {
        getElementById: (id) => registry[id] || null,
        createElement: () => makeEl(''),
        head: { appendChild(el) { injected.push(el); } },
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
        _injected: injected,
    };
    Object.assign(sandbox, windowExtras || {});
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox;
}

// ═════════════════ Partido fabricado ═════════════════
// Prebenjamin: 30 min por parte -> total 3600 s (umbrales 33%/50% = 19:48 y
// 30:00). ONCE INICIAL: Alba, Carla y Diego en el campo; Bruno en el banquillo.
// En el minuto 35 (acumulado) Carla deja su sitio a Bruno.
const ONCE_INICIAL = [
    { id: 1, number: 1, name: 'Alba',  team: 'home', status: 'field', x: 15, y: 50 },
    { id: 2, number: 2, name: 'Bruno', team: 'home', status: 'bench', x: 0,  y: 0  },
    { id: 3, number: 3, name: 'Carla', team: 'home', status: 'field', x: 45, y: 30 },
    { id: 4, number: 4, name: 'Diego', team: 'home', status: 'field', x: 60, y: 70 },
];
const ESTADO_FINAL = [
    { id: 1, number: 1, name: 'Alba',  team: 'home', status: 'field', x: 20, y: 55, time: 3600 },
    { id: 2, number: 2, name: 'Bruno', team: 'home', status: 'field', x: 40, y: 30, time: 1500 },
    { id: 3, number: 3, name: 'Carla', team: 'home', status: 'bench', x: 45, y: 30, time: 2100 },
    { id: 4, number: 4, name: 'Diego', team: 'home', status: 'field', x: 60, y: 70, time: 3600 },
];

function partido(extra) {
    return Object.assign({
        id: 'test-match',
        mode: 'f7',
        category: 'Prebenjamin',
        subcategory: 'A',
        half1MaxTime: 1800,
        half2MaxTime: 1800,
        initialPlayers: JSON.parse(JSON.stringify(ONCE_INICIAL)),
        homeTeam: { name: 'CRONOS', score: 1, color: '#112233', shorts: '#445566', textColor: '#ffffff' },
        awayTeam: { name: 'RIVAL',  score: 0, color: '#aabbcc', shorts: '#ddeeff', textColor: '#000000' },
        players: JSON.parse(JSON.stringify(ESTADO_FINAL)),
        events: [
            { type: 'sub_out', text: 'CAMBIO · Sale · Carla',  matchTime: '2T 35:00' },
            { type: 'sub_in',  text: 'CAMBIO · Entra · Bruno', matchTime: '2T 35:00' },
        ],
    }, extra || {});
}

// Devuelve, para el instante `sec`, un mapa nombre -> { time, bg, color }
// leyendo el HTML realmente pintado (campo + banquillo local).
async function fichas(sandbox, data, sec) {
    await sandbox.window.openMatchReplay(data);
    sandbox.window._replaySeek(sec);
    const reg = sandbox._registry;
    const html = reg['replay-pitch-players'].innerHTML + reg['replay-bench-home'].innerHTML;

    const out = {};
    // Ficha de campo: <div class="replay-player" ...> tiempo, chip, label
    const reField = /<div class="replay-player"[\s\S]*?<div class="replay-player-time" style="background:([^;]+); color:([^;"]+);">([\d:]+)<\/div>[\s\S]*?<div class="replay-player-label">([^<]+)<\/div>/g;
    let m;
    while ((m = reField.exec(html)) !== null) {
        out[m[4].trim()] = { bg: m[1].trim(), color: m[2].trim(), time: m[3], zona: 'campo' };
    }
    // Fila de banquillo
    const reBench = /<span class="replay-bench-name">([^<]+)<\/span>\s*<span class="replay-bench-time" style="background:([^;]+); color:([^;"]+);">([\d:]+)<\/span>/g;
    while ((m = reBench.exec(html)) !== null) {
        const nombre = m[1].replace(/^\s*\d+\s*/, '').trim();
        out[nombre] = { bg: m[2].trim(), color: m[3].trim(), time: m[4], zona: 'banquillo' };
    }
    return out;
}

const CELESTE = '#79c0ff';
const VERDE   = '#2ea043';
const AMBAR   = '#e3b341';
const ROJO    = '#da3633';

(async () => {

// ═══════════ PARTE 1 · la cajita del cronometro EXISTE en cada ficha ═══════════
console.log('── PARTE 1 · cada ficha lleva su cronometro ──');
{
    const f = await fichas(buildSandbox(), partido(), 600);
    const nombres = Object.keys(f).sort();
    ok('1a · las cuatro fichas (campo y banquillo) se pintan',
       JSON.stringify(nombres) === JSON.stringify(['Alba', 'Bruno', 'Carla', 'Diego']),
       'encontradas: ' + JSON.stringify(nombres));
    ok('1b · todas llevan cajita de cronometro con formato MM:SS',
       nombres.every(n => /^\d{2}:\d{2}$/.test(f[n].time)),
       JSON.stringify(f));
    ok('1c · el suplente esta en el banquillo y tambien lleva cronometro',
       f.Bruno && f.Bruno.zona === 'banquillo' && /^\d{2}:\d{2}$/.test(f.Bruno.time),
       JSON.stringify(f.Bruno));
}

// ═══════════ PARTE 2 · el tiempo se INTEGRA, no se lee (defecto A) ═══════════
console.log('\n── PARTE 2 · minutos jugados reales en cada instante ──');
{
    const sb = buildSandbox();

    const f10 = await fichas(sb, partido(), 600);          // 10:00
    ok('2a · en el 10:00 la titular lleva 10:00, no su total final',
       f10.Alba.time === '10:00', 'Alba: ' + f10.Alba.time);
    ok('2b · y el suplente que aun no ha entrado lleva 00:00',
       f10.Bruno.time === '00:00', 'Bruno: ' + f10.Bruno.time);

    const f40 = await fichas(sb, partido(), 2400);         // 40:00
    ok('2c · tras el cambio del 35, el que ENTRO lleva 05:00',
       f40.Bruno.time === '05:00', 'Bruno: ' + f40.Bruno.time);
    ok('2d · y la que SALIO se queda congelada en 35:00',
       f40.Carla.time === '35:00', 'Carla: ' + f40.Carla.time);
    ok('2e · quien no fue sustituido sigue sumando (40:00)',
       f40.Diego.time === '40:00', 'Diego: ' + f40.Diego.time);

    // El regreso ATRAS en la barra debe recalcular, no acumular sobre lo ya
    // contado: _updateReplayFrame reconstruye el estado desde cero cada vez.
    const otraVez10 = await fichas(sb, partido(), 600);
    ok('2f · al retroceder la barra el cronometro NO arrastra lo ya contado',
       otraVez10.Alba.time === '10:00', 'Alba: ' + otraVez10.Alba.time);
}

// ═══════════ PARTE 3 · semaforo HABILITADO: verde/ambar/rojo ═══════════
console.log('\n── PARTE 3 · semaforo habilitado ──');
{
    const sb = buildSandbox();
    const p = () => partido({ semaforoActive: true });

    // total 3600 s -> rojo <1188 s (33%), ambar 1188-1800, verde >=1800 (50%)
    const f10 = await fichas(sb, p(), 600);
    ok('3a · con 10:00 jugados (<33%) el cronometro va en ROJO',
       f10.Alba.bg === ROJO, 'Alba bg=' + f10.Alba.bg);

    const f25 = await fichas(sb, p(), 1500);
    ok('3b · con 25:00 (entre 33% y 50%) va en AMBAR',
       f25.Alba.bg === AMBAR, 'Alba bg=' + f25.Alba.bg);

    const f40 = await fichas(sb, p(), 2400);
    ok('3c · con 40:00 (>=50%) va en VERDE',
       f40.Alba.bg === VERDE, 'Alba bg=' + f40.Alba.bg);
    ok('3d · en el MISMO frame, el que solo lleva 05:00 sigue en ROJO',
       f40.Bruno.bg === ROJO, 'Bruno bg=' + f40.Bruno.bg + ' t=' + f40.Bruno.time);
}

// ═══════════ PARTE 4 · semaforo DESHABILITADO: celeste ═══════════
console.log('\n── PARTE 4 · semaforo deshabilitado -> celeste ──');
{
    const sb = buildSandbox();
    const f = await fichas(sb, partido({ semaforoActive: false }), 2400);
    const todos = Object.keys(f);
    ok('4a · con semaforoActive:false TODAS las cajitas van en celeste',
       todos.every(n => f[n].bg === CELESTE),
       JSON.stringify(f));
    ok('4b · y el texto en negro, como en la retransmision',
       todos.every(n => f[n].color === '#000000'),
       JSON.stringify(f));
    ok('4c · el celeste tapa incluso a quien habria salido VERDE por tiempo',
       f.Alba.time === '40:00' && f.Alba.bg === CELESTE,
       'Alba: ' + JSON.stringify(f.Alba));
}

// ═══════════ PARTE 5 · la bandera del PARTIDO manda sobre el club de hoy ═══════════
console.log('\n── PARTE 5 · la configuracion del partido ORIGINAL manda (defecto B) ──');
{
    // El Director apago el semaforo del grupo DESPUES del partido. La
    // repeticion de un partido que SI lo llevaba debe seguir en colores.
    const sbApagadoHoy = buildSandbox({
        _clubCategoryConfigs: { f7: { semaforoActive: false, red: 33, yellow: 50 } },
    });
    const f = await fichas(sbApagadoHoy, partido({ semaforoActive: true }), 2400);
    ok('5a · si el partido guardo semaforoActive:true, el apagado POSTERIOR del club no le afecta',
       f.Alba.bg === VERDE, 'Alba bg=' + f.Alba.bg);

    // Partido ANTIGUO (sin la bandera): se reconstruye por la cascada.
    const sbCascada = buildSandbox({
        _clubCategoryConfigs: { f7: { semaforoActive: false, red: 33, yellow: 50 } },
    });
    const viejo = partido();
    delete viejo.semaforoActive;
    const f2 = await fichas(sbCascada, viejo, 2400);
    ok('5b · un partido SIN la bandera cae a la cascada (categoryConfigs lo apaga -> celeste)',
       f2.Alba.bg === CELESTE, 'Alba bg=' + f2.Alba.bg);

    // Juvenil y regional nunca llevan semaforo.
    const sbJuv = buildSandbox();
    const juvenil = partido({ category: 'Juvenil', half1MaxTime: 2700, half2MaxTime: 2700 });
    delete juvenil.semaforoActive;
    const f3 = await fichas(sbJuv, juvenil, 2400);
    ok('5c · juvenil sin bandera -> celeste (nunca lleva semaforo)',
       f3.Alba.bg === CELESTE, 'Alba bg=' + f3.Alba.bg);

    // extras.semaforo === false del club, para partidos antiguos.
    const sbExtras = buildSandbox({ _cronosCurrentUser: { extras: { semaforo: false } } });
    const viejo2 = partido();
    delete viejo2.semaforoActive;
    const f4 = await fichas(sbExtras, viejo2, 2400);
    ok('5d · extras.semaforo:false del club -> celeste en partidos sin bandera',
       f4.Alba.bg === CELESTE, 'Alba bg=' + f4.Alba.bg);

    // Umbrales personalizados del grupo: con yellow=20% el verde llega antes.
    const sbUmbrales = buildSandbox({
        _clubCategoryConfigs: { f7: { semaforoActive: true, red: 10, yellow: 20 } },
    });
    const viejo3 = partido();
    delete viejo3.semaforoActive;
    const f5 = await fichas(sbUmbrales, viejo3, 900);   // 15:00 de 60:00 = 25%
    ok('5e · se respetan los umbrales del grupo (20% -> VERDE con 15:00 de 60:00)',
       f5.Alba.bg === VERDE, 'Alba bg=' + f5.Alba.bg + ' t=' + f5.Alba.time);
}

// ═══════════ PARTE 6 · tamano de las fichas (hoja inyectada) ═══════════
console.log('\n── PARTE 6 · las fichas son legibles y la hoja viaja con el modulo ──');
{
    const sb = buildSandbox();
    await sb.window.openMatchReplay(partido());
    const hoja = (sb._injected[0] && sb._injected[0].textContent) || '';

    ok('6a · el modulo inyecta su propia hoja (live.html NO carga style.css)',
       hoja.includes('.replay-player-chip'), 'no se inyecto ninguna hoja');

    const mChip = hoja.match(/\.replay-player-chip\s*\{[^}]*width:\s*(\d+)px/);
    ok('6b · la ficha mide >= 44px (antes eran circulos de 26px)',
       mChip && parseInt(mChip[1], 10) >= 44, 'width=' + (mChip ? mChip[1] : 'no encontrado'));

    const mTime = hoja.match(/\.replay-player-time\s*\{[^}]*font-size:\s*([\d.]+)rem/);
    ok('6c · la cajita del cronometro tiene tamano legible (>= 0.7rem)',
       mTime && parseFloat(mTime[1]) >= 0.7, 'font-size=' + (mTime ? mTime[1] : 'no encontrado'));

    const mLabel = hoja.match(/\.replay-player-label\s*\{[^}]*font-size:\s*([\d.]+)rem/);
    ok('6d · el nombre tiene tamano legible (>= 0.7rem; antes 0.62rem)',
       mLabel && parseFloat(mLabel[1]) >= 0.7, 'font-size=' + (mLabel ? mLabel[1] : 'no encontrado'));

    ok('6e · hay bandas responsive para tablet y movil',
       /@media\s*\(max-width:\s*950px\)/.test(hoja) && /@media\s*\(max-width:\s*600px\)/.test(hoja),
       'faltan @media en la hoja del reproductor');

    ok('6f · no queda rastro del circulo de 26px inline',
       !/width:26px|width:\s*26px;\s*height:\s*26px/.test(src),
       'sigue habiendo fichas de 26px en el fuente');
}

// ═══════════ PARTE 7 · estructura: lo que no puede volver a romperse ═══════════
console.log('\n── PARTE 7 · estructura ──');
{
    // Las aserciones NEGATIVAS (que algo ya no aparezca) tienen que mirar el
    // CODIGO, no los comentarios: aqui mismo se documenta cual era el selector
    // fragil que se retiro, y una busqueda ingenua se encuentra ese texto y
    // declara la regresion. Misma trampa que ya se pago en el guard de CSS.
    const codigo = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

    // C: el exportador de video ya no selecciona por el style inline ni lee
    // los hijos por posicion.
    ok('7a · drawPitchFrame selecciona las fichas por CLASE, no por style inline',
       codigo.includes(".querySelectorAll('.replay-player')") &&
       !codigo.includes('div[style*="position:absolute"]'),
       'sigue el selector fragil por atributo style');
    ok('7b · y lee nombre/cronometro por su clase, no por chip.children[1]',
       codigo.includes(".querySelector('.replay-player-label')") &&
       codigo.includes(".querySelector('.replay-player-time')") &&
       !codigo.includes('chip.children[1]'),
       'sigue leyendo los hijos por posicion');

    // A: que nadie "simplifique" leyendo el total final del snapshot.
    ok('7c · el cronometro se acumula (timePlayed), no se lee de p.time',
       src.includes('timePlayed') && /_avanzarCronometros\s*\(/.test(src),
       'falta la integracion del tiempo jugado');

    // B: sync.js tiene que persistir la bandera.
    const SYNC = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
    ok('7d · sync.js PERSISTE semaforoActive en el snapshot (era variable muerta)',
       /semaforoActive:\s*_semaforoActive/.test(SYNC),
       'el snapshot no incluye semaforoActive');

    // La hoja debe inyectarse desde el modulo: si alguien la mueve a style.css,
    // la repeticion abierta desde live.html se quedaria sin estilos.
    ok('7e · la hoja se inyecta desde el propio modulo',
       /cronos-replay-styles/.test(src),
       'la hoja del reproductor ya no se inyecta desde el modulo');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);

})();

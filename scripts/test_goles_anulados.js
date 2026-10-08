// ─────────────────────────────────────────────────────────────────────────
// test_goles_anulados.js · ⚽❌ v789 · goles sólo en el campo, y un gol
// anulado no es un gol
//
// Encargo del autor (implementar.txt 2026-10-08, capturas 11249-11250):
//  1. El diálogo del marcador ofrecía también el BANQUILLO («[BAN] 4 -
//     SANTI») y SANTI acabó con un gol sin haber jugado.
//  2. Un gol puesto por error y luego quitado seguía apareciendo como gol:
//     el historial guarda «GOL (1º)» y «GOL ANULADO (Quedan: 0)», y el
//     registro pintaba el gol en verde Y la anulación; el cronograma, DOS
//     balones; la exportación del partido contaba la anulación como otro gol.
//  + Decisión del autor: al anular, el visor y las familias reciben un aviso
//    de GOL ANULADO (suceso `goal_cancelled`).
//
// Todo se EJECUTA: las funciones se extraen de su fichero y corren en un
// sandbox, igual que test_retroactivo_naranja.js.
// ─────────────────────────────────────────────────────────────────────────
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
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 500));
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

const UTILS  = leer('js/core/utils.js');
const ENGINE = leer('js/coach/reports/report-engine.js');
const MOVLOG = leer('js/match/events/movement-log.js');
const ACTION = leer('js/match/events/player-actions.js');
const FEED   = leer('js/shared/live-feed.js');
const LIVE   = leer('live.html');

const ev = (type, min, note, extra) => Object.assign(
    { type, minute: min, second: 0, timeStr: String(min).padStart(2, '0') + ':00', note }, extra || {});
const GOL  = (min, n) => ev('goal', min, `GOL (${n || 1}º) a las ${String(min).padStart(2, '0')}:00 (1ªP)`);
const ANUL = (min, q) => ev('goal', min, `GOL ANULADO (Quedan: ${q || 0}) a las ${String(min).padStart(2, '0')}:00 (1ªP)`);

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · la regla del emparejamiento, y el motor dice lo mismo ──');
let MARCA = null, INDICES = null, MOTOR = null;
{
    const f1 = trozo(UTILS, 'function cronosGolesAnulados(hist)');
    const f2 = trozo(UTILS, 'function cronosMarcaGolesAnulados(hist)');
    ok('1a · cronosGolesAnulados y cronosMarcaGolesAnulados existen en utils.js', !!(f1 && f2));
    if (f1 && f2) {
        const ctx = { console, String, Object, Array, Set };
        vm.createContext(ctx);
        vm.runInContext(f1 + '\n' + f2 + '\n;globalThis.m = cronosMarcaGolesAnulados; globalThis.i = cronosGolesAnulados;', ctx);
        MARCA = ctx.m; INDICES = ctx.i;
    }
    const fm = trozo(ENGINE, 'const _golesAnulados = (hist) => {');
    ok('1b · el motor de informes lleva su copia (_golesAnulados)', !!fm);
    if (fm) {
        const ctx = { console, String, Object, Array, Set, Map };
        vm.createContext(ctx);
        vm.runInContext(fm + ';\n;globalThis.f = _golesAnulados;', ctx);
        MOTOR = ctx.f;
    }
}
if (MARCA && MOTOR) {
    const resumen = (arr) => arr.map(e => (e.type === 'goal' ? (e.anulado ? 'X' : 'G') : e.type[0]) +
                                         (e.anuladoEn ? '@' + e.anuladoEn : '')).join(',');
    const casos = [
        ['🔑 un gol y su anulación → UN gol anulado, sin fila de anulación', [GOL(10), ANUL(12)], 'X@12:00'],
        ['dos goles y una anulación → se anula el ÚLTIMO', [GOL(10), GOL(20, 2), ANUL(25, 1)], 'G,X@25:00'],
        ['anular, volver a marcar → el nuevo vale', [GOL(10), ANUL(11), GOL(30)], 'X@11:00,G'],
        ['⚠️ anulación HUÉRFANA → gol anulado, nunca gol', [ANUL(5)], 'X'],
        ['las tarjetas y cambios no se tocan', [ev('yellow', 3, 'AMARILLA'), GOL(10), ANUL(12), ev('sub_out', 40, 'Sale')], 'y,X@12:00,s'],
        ['sin anulaciones, todo igual', [GOL(10), GOL(20, 2)], 'G,G'],
    ];
    let bien = 0, iguales = 0; const malos = [];
    casos.forEach(([etq, hist, esperado]) => {
        const a = resumen(MARCA(hist)), b = resumen(MOTOR(hist));
        if (a === esperado) bien++; else malos.push(etq + ' → ' + a);
        if (a === b) iguales++; else malos.push('DIFIEREN ' + etq + ': utils=' + a + ' motor=' + b);
    });
    ok('1c · 🔑 acierta en los ' + casos.length + ' casos', bien === casos.length, malos.join(' || '));
    ok('1d · 🔑🔑 la regla compartida y la del motor dan LO MISMO', iguales === casos.length, malos.join(' || '));

    const hist = [GOL(10), ANUL(12)];
    MARCA(hist);
    ok('1e · no muta el historial original', hist.length === 2 && hist[0].anulado === undefined);

    // Las cadenas crudas de logEvent (la exportación del partido las usa).
    const r = INDICES(['Entra a las 00:00 (1ªP)', 'GOL (1º) a las 10:00 (1ªP)', 'GOL ANULADO (Quedan: 0) a las 12:00 (1ªP)']);
    ok('1f · con cadenas crudas: el gol (1) anulado y la anulación (2) emparejada',
       r.anulados.has(1) && r.anulaciones.has(2) && r.anuladoEn[1] === '12:00',
       JSON.stringify({ a: [...r.anulados], b: [...r.anulaciones] }));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · el informe colectivo, EJECUTADO ──');
{
    const s = ENGINE.indexOf('const _RP = (() => {');
    const e = ENGINE.indexOf('\n})();', s);
    const BLOQUE = s >= 0 && e > s ? ENGINE.slice(s, e + 6) : null;
    ok('2a · se encuentra el motor _RP', !!BLOQUE);
    if (BLOQUE) {
        const sb = { Math, Array, Object, String, Number, JSON, Date, Map, Set, parseInt, parseFloat, isNaN };
        vm.createContext(sb);
        vm.runInContext(BLOQUE + '\nthis.__rp = _RP;', sb);
        const partido = {
            rival: 'RIVAL', matchDate: '2026-10-08', myTeamRole: 'home',
            scoreHome: 1, scoreAway: 0, category: 'f11_regional',
            players: [
                { playerAlias: 'DANI', playerNumber: '5', titular: true, goals: 1, history: [GOL(20)] },
                { playerAlias: 'SANTI', playerNumber: '4', titular: true, goals: 0, history: [GOL(30), ANUL(31)] },
            ],
        };
        const html = sb.__rp.build(partido, { clubName: 'ARINAGA' });
        const filas = html.split('data-suceso="').slice(1).map(t => t.slice(0, 900));
        const golesVerdes = filas.filter(f => /letter-spacing:0\.5px;">GOL<\/strong>/.test(f));
        const anulados    = filas.filter(f => /GOL ANULADO/.test(f));
        ok('2b · 🔑🔑 el gol de SANTI sale UNA vez y como GOL ANULADO',
           anulados.length === 1 && /SANTI/.test(anulados[0]), 'anulados=' + anulados.length);
        ok('2c · 🔑 y no hay ningún «GOL» válido de SANTI; el de DANI sigue',
           golesVerdes.length === 1 && /DANI/.test(golesVerdes[0]) && !golesVerdes.some(f => /SANTI/.test(f)),
           'verdes=' + golesVerdes.map(f => (f.match(/DANI|SANTI/) || [''])[0]).join(','));
        ok('2d · dice que no computa y cuándo se anuló', /no computa · anulado 31:00/.test(anulados[0] || ''));
        // El balón del cronograma (r=5.5, relleno blanco). La cabecera tiene
        // otro círculo verde (r=8) que no es un gol.
        const balonesVerdes = (html.match(/r="5\.5" fill="white" stroke="#3fb950"/g) || []).length;
        ok('2e · 🔑🔑 el cronograma: UN balón verde (DANI) y UNO hueco gris (SANTI), no tres',
           balonesVerdes === 1 && (html.match(/data-gol-anulado="1"/g) || []).length === 1,
           'verdes=' + balonesVerdes + ' huecos=' + (html.match(/data-gol-anulado="1"/g) || []).length);
    }
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · el marcador: sólo goleadores EN EL CAMPO ──');
function marcador({ respuestas, jugadores }) {
    const fn = trozo(MOVLOG, 'function changeScore(team, delta)');
    const aviso = trozo(MOVLOG, 'function _avisaGolDesdeMarcador(team, autor)');
    const avisoX = trozo(MOVLOG, 'function _avisaGolAnulado(team, autor)');
    const eventos = [], alertas = [], prompts = [];
    const els = { 'score-home': { textContent: '0' }, 'score-away': { textContent: '0' } };
    const sb = {
        players: jugadores, TEAM_NAMES: { home: 'ARINAGA', away: 'RIVAL' }, isRunning: true,
        window: { cronosPartidoEnJuego: () => true },
        document: { getElementById: (id) => els[id] },
        prompt: (m) => { prompts.push(m); return respuestas.shift(); },
        alert: (m) => alertas.push(m),
        logEvent: (p, t) => { p.history = p.history || []; p.history.push(t); },
        renderPlayers: () => {}, showToast: () => {}, liveSyncOnAction: () => {},
        syncScoreFromPlayers: () => {},
        _registerMatchEvent: (type, text) => eventos.push({ type, text }),
        parseInt, Math, String,
    };
    vm.createContext(sb);
    vm.runInContext(aviso + '\n' + avisoX + '\n' + fn + ';globalThis.cs = changeScore;', sb);
    return { cs: sb.cs, eventos, alertas, prompts, sb };
}
const plantilla = () => ([
    { id: 1, team: 'home', number: 1, name: 'OMAR',   status: 'bench', goals: 0 },
    { id: 2, team: 'home', number: 2, name: 'SERGIO', status: 'field', goals: 0 },
    { id: 4, team: 'home', number: 4, name: 'SANTI',  status: 'bench', goals: 0 },
    { id: 5, team: 'home', number: 5, name: 'DANI',   status: 'field', goals: 0 },
]);
{
    const j = plantilla();
    const t = marcador({ respuestas: ['2'], jugadores: j });
    t.cs('home', 1);
    const lista = t.prompts[0] || '';
    ok('3a · 🔑🔑 la lista NO ofrece a los del banquillo (OMAR, SANTI)',
       !/OMAR|SANTI|\[BAN\]/.test(lista) && /SERGIO/.test(lista) && /DANI/.test(lista), lista);
    ok('3b · el «2» de la lista es DANI (2º en el campo) y se le suma',
       j[3].goals === 1 && j[2].goals === 0 && t.eventos.some(e => e.type === 'goal' && /DANI/.test(e.text)));
    ok('3c · sigue existiendo «0. Gol No Asignado»', /0\. Gol No Asignado/.test(lista));
}
{
    const j = plantilla();
    const t = marcador({ respuestas: ['4'], jugadores: j });   // el «4» de antes era SANTI
    t.cs('home', 1);
    ok('3d · 🔑 un número fuera de la lista NO suma ningún gol y avisa',
       j.every(p => !p.goals) && t.alertas.some(a => /EN EL CAMPO/.test(a)) && !t.eventos.length,
       JSON.stringify(t.alertas));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · quitar un gol: se puede corregir y se AVISA ──');
{
    const j = plantilla(); j[2].goals = 1;   // el gol mal puesto a SANTI (banquillo)
    const t = marcador({ respuestas: [], jugadores: j });
    t.cs('home', -1);
    ok('4a · 🔑 se le puede QUITAR a un jugador del banquillo (es la vía de corrección)',
       j[2].goals === 0 && /GOL ANULADO/.test((j[2].history || [])[0] || ''));
    ok('4b · 🔑🔑 y se emite el aviso goal_cancelled con su nombre',
       t.eventos.length === 1 && t.eventos[0].type === 'goal_cancelled' && /GOL ANULADO · SANTI/.test(t.eventos[0].text),
       JSON.stringify(t.eventos));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · la ficha del jugador y el modal ──');
{
    ok('5a · changeGoals emite goal_cancelled al quitar',
       /_registerMatchEvent\('goal_cancelled', 'GOL ANULADO · ' \+ p\.name/.test(trozo(ACTION, 'function changeGoals(amount)') || ''));
    const fn = trozo(ACTION, 'function _confirmarEventosModal()');
    const run = (antes, despues, buffer) => {
        const emit = [];
        const sb = {
            _modalBuffer: buffer, _modalBaseline: { id: 7, goals: antes }, _modalStaging: true,
            players: [{ id: 7, goals: despues }],
            _registerMatchEvent: function () { emit.push(arguments[0]); },
        };
        vm.createContext(sb);
        vm.runInContext('var _modalBuffer=this._modalBuffer,_modalBaseline=this._modalBaseline,_modalStaging=true;\n' +
                        fn + ';_confirmarEventosModal();', sb);
        return emit;
    };
    const g = ['goal', 'GOL · X'], x = ['goal_cancelled', 'GOL ANULADO · X'];
    ok('5b · 🔑 +1 −1 dentro del modal: NO sale ningún aviso', run(0, 0, [g, x]).length === 0);
    ok('5c · 🔑 quitar un gol que ya tenía: sale UN aviso de anulado', JSON.stringify(run(1, 0, [x])) === '["goal_cancelled"]');
    ok('5d · y sumar sigue avisando del gol', JSON.stringify(run(0, 1, [g])) === '["goal"]');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 6 · el visor y el mini-feed lo entienden ──');
{
    const ctx = { window: {}, globalThis: {} };
    vm.createContext(ctx);
    let F = null;
    try { vm.runInContext(FEED.replace('(typeof window !== \'undefined\' ? window : this)', 'this'), ctx);
          F = ctx.cronosLiveFeed || (ctx.window && ctx.window.cronosLiveFeed); } catch (e) {}
    ok('6a · el mini-feed tiene icono propio para goal_cancelled', /goal_cancelled:\s*'❌'/.test(FEED));
    ok('6b · y lo nombra («Gol anulado · …»)', /'Gol anulado · '/.test(FEED));
    ok('6c · 🔑 el visor lo anuncia como GOL ANULADO (no como CAMBIO por defecto)',
       /goal_cancelled:\s*\{[^}]*title:\s*"GOL ANULADO"/.test(LIVE));
    ok('6d · y lo colorea en gris', /type === 'goal_cancelled' \? EVENT_KEYWORD_COLOR\.GOL_ANULADO/.test(LIVE));
}

console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }

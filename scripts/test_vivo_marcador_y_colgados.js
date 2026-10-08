// ─────────────────────────────────────────────────────────────────────────
// test_vivo_marcador_y_colgados.js · ⚽📡🧹 v790
//
// Encargo del autor (implementar.txt 2026-10-08, capturas 11257-11262):
//  1. «el directo marca 2-0 y el vivo 1-0»: el marcador llegaba tarde al
//     visor. Tres piezas:
//      · pushLiveSnapshot PERDÍA la petición que llegaba durante su 3ª pasada;
//      · el marcador sólo viajaba en el documento gordo, en fila;
//      → canal rápido en `live_index` con `marcadorSeq`, y el visor se queda
//        con el número mayor.
//  2. «Partidos en Vivo» enseñaba «Local 0-0 Visitante · En juego» para TODO
//     (leía campos que no existen) y no dejaba limpiar. Ahora dice la verdad,
//     marca COLGADO (≥30 min sin actualizarse, decisión del autor) y cada
//     entrenador puede eliminar los colgados de SU equipo.
//  + Un partido en PAUSA da señal de vida cada 5 min, para no parecer colgado.
//
// Todo se EJECUTA en sandbox con las funciones extraídas de su fichero.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const SYNC  = leer('js/match/live/sync.js');
const LIVE  = leer('live.html');
const SETUP = leer('js/core/setup-modal.js');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { console.log('  ✗ ' + nombre); if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 500)); fallos++; }
}
function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}
const espera = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · la petición pendiente ya no se pierde ──');
{
    const fn = trozo(SYNC, 'async function pushLiveSnapshot(status');
    ok('1a · se encuentra pushLiveSnapshot', !!fn);
    // Un latido lento que, DURANTE cada pasada, recibe otra petición (como un
    // gol marcado mientras se escribe). En la 3ª pasada llega la última.
    const sb = { setTimeout, console, emitidos: [] };
    vm.createContext(sb);
    vm.runInContext(`
        let _latidoEnVuelo = null, _latidoRepetir = false, _latidoStatusPend = null;
        let llamadasDurante = 3;
        async function _emiteLatido(s) {
            emitidos.push(s);
            await new Promise(r => setTimeout(r, 5));
            if (llamadasDurante-- > 0) pushLiveSnapshot('active');
        }
        ${fn}
        globalThis.go = () => pushLiveSnapshot('active');`, sb);
    await sb.go();
    await espera(80);
    ok('1b · 🔑🔑 la petición que llega en la 3ª pasada SALE (antes se quedaba en 3 envíos)',
       sb.emitidos.length === 4, 'envíos=' + sb.emitidos.length);
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · el canal rápido del marcador ──');
{
    const fn = trozo(SYNC, 'async function _pushMarcador()');
    ok('2a · existe _pushMarcador', !!fn);
    const escrituras = [];
    const els = { 'score-home': { textContent: '1' }, 'score-away': { textContent: '0' } };
    const sb = {
        console, Date, Math, parseInt, String,
        document: { getElementById: (id) => els[id] },
        window: { _cronos_auth: { db: {} }, _cronosMatchSlots: { getTabMatchId: () => 'M1' } },
        __import: async () => ({
            setDoc: async (ref, data, opts) => { escrituras.push({ ref, data, opts }); },
            doc: (db, col, id) => col + '/' + id,
            serverTimestamp: () => 'TS',
        }),
    };
    vm.createContext(sb);
    vm.runInContext(`var liveIsActive = true, liveMatchId = 'M1';
        let _marcadorSeq = 0, _marcadorEnviado = null;
        ${fn.replace(/await import\([^)]*\)/, 'await __import()')}
        globalThis.push = _pushMarcador;
        globalThis.setTab = (t) => { window._cronosMatchSlots.getTabMatchId = () => t; };`, sb);
    await sb.push();
    ok('2b · 🔑 escribe el marcador en live_index/M1, con merge y número de orden',
       escrituras.length === 1 && escrituras[0].ref === 'live_index/M1' &&
       escrituras[0].data.homeTeam.score === 1 && escrituras[0].data.awayTeam.score === 0 &&
       escrituras[0].data.marcadorSeq > 0 && escrituras[0].opts.merge === true,
       JSON.stringify(escrituras));
    await sb.push();
    ok('2c · si el marcador no cambió, no escribe otra vez', escrituras.length === 1);
    const seq1 = escrituras[0].data.marcadorSeq;
    els['score-home'].textContent = '2';
    await sb.push();
    ok('2d · 🔑 un gol nuevo escribe con número MAYOR', escrituras.length === 2 && escrituras[1].data.marcadorSeq > seq1);
    sb.setTab('OTRO');
    els['score-home'].textContent = '3';
    await sb.push();
    ok('2e · 🔒 si esta pestaña juega OTRO partido, no escribe (puerta de v469)', escrituras.length === 2);

    ok('2f · el volcado inmediato y el de acción mandan el marcador rápido',
       /function liveSyncFlushNow\(\)\s*\{\s*if \(!liveIsActive\) return;[\s\S]{0,200}_pushMarcador\(\);/.test(SYNC) &&
       /function liveSyncOnAction\(\)\s*\{\s*if \(!liveIsActive\) return;[\s\S]{0,200}_pushMarcador\(\);/.test(SYNC));
    ok('2g · 🔑 el documento gordo lleva el número de orden leído JUNTO al marcador',
       /const scoreAway = [^\n]*\n[\s\S]{0,700}const _seqMarcador = _marcadorSeq;/.test(SYNC) &&
       /marcadorSeq: _seqMarcador,/.test(SYNC) && /marcadorSeq: snapshot\.marcadorSeq \|\| 0/.test(SYNC));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · el visor se queda con el marcador más nuevo ──');
{
    const fn = trozo(LIVE, 'function _aplicaMarcador(data)');
    ok('3a · existe _aplicaMarcador en live.html', !!fn);
    const sb = { Object, Number };
    vm.createContext(sb);
    vm.runInContext('let _marcadorVivo = null;\n' + fn +
        '\nglobalThis.ap = _aplicaMarcador; globalThis.set = (m) => { _marcadorVivo = m; };', sb);
    const gordo = { marcadorSeq: 100, homeTeam: { name: 'A', score: 1 }, awayTeam: { name: 'B', score: 0 } };
    sb.set({ home: 2, away: 0, seq: 200 });
    const r1 = sb.ap(gordo);
    ok('3b · 🔑🔑 un gordo VIEJO (seq 100) no tapa el gol rápido (seq 200): 2-0',
       r1.homeTeam.score === 2 && r1.homeTeam.name === 'A' && gordo.homeTeam.score === 1);
    sb.set({ home: 2, away: 0, seq: 50 });
    ok('3c · y un marcador rápido más viejo que el gordo no lo pisa', sb.ap(gordo).homeTeam.score === 1);
    ok('3d · renderMatch aplica el marcador rápido', /function renderMatch\(data\) \{[\s\S]{0,200}data = _aplicaMarcador\(data\);/.test(LIVE));
    ok('3e · el oyente del índice lo recoge y lo limpia al cambiar de partido',
       /_marcadorVivo = \{ home: Number\(d\.homeTeam\.score\)/.test(LIVE) && /_marcadorVivo = null;\s+\/\/ v790/.test(LIVE));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · en pausa también hay señal de vida ──');
{
    const m = SYNC.match(/const _LATIDO_PAUSA_MS = (\d+) \* 60 \* 1000;/);
    ok('4a · cada 5 min, muy por debajo de los 30 del «colgado»', m && Number(m[1]) === 5);
    ok('4b · el latido la usa cuando no hay nada pendiente',
       /else if \(emitido && Date\.now\(\) - emitido > _LATIDO_PAUSA_MS\) pushLiveSnapshot\('active'\);/.test(SYNC));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · la lista de Partidos en Vivo ──');
{
    const ini = SETUP.indexOf('const _LM_COLGADO_MIN');
    const fin = SETUP.indexOf('// Borra UN partido colgado');
    ok('5a · se encuentra el bloque de la lista', ini > 0 && fin > ini);
    const ahora = Date.parse('2026-10-08T12:00:00Z');
    const hace = (min) => ({ toMillis: () => ahora - min * 60000 });
    const docs = [
        { id: 'VIVO', clubId: 'c1', status: 'active', phase: '1st_half', isRunning: true, updatedAt: hace(0),
          teamId: 'c1__regional__b', createdBy: 'otro', homeTeam: { name: 'CD PRUEBA', score: 2 }, awayTeam: { name: 'RIVAL', score: 0 },
          matchCategory: 'f11_regional', matchSubcategory: 'B' },
        { id: 'COLG_MIO', clubId: 'c1', status: 'active', phase: '1st_half', updatedAt: hace(120),
          teamId: 'c1__regional__b', createdBy: 'otro', homeTeam: { name: 'VIEJO', score: 0 }, awayTeam: { name: 'X', score: 0 } },
        { id: 'COLG_AJENO', clubId: 'c1', status: 'active', phase: '1st_half', updatedAt: hace(120),
          teamId: 'c1__alevin__a', createdBy: 'otro', homeTeam: { name: 'AJENO', score: 0 }, awayTeam: { name: 'Y', score: 0 } },
        { id: 'COLG_CREADO', clubId: 'c1', status: 'active', phase: '2nd_half', updatedAt: hace(45),
          teamId: 'c1__infantil__a', createdBy: 'yo', homeTeam: { name: 'MIO', score: 1 }, awayTeam: { name: 'Z', score: 1 } },
        { id: 'TERMINADO', clubId: 'c1', status: 'finished', phase: 'finished', updatedAt: hace(5), teamId: 'c1__regional__b' },
    ];
    const borrados = [], toasts = [], alertas = [];
    const body = { innerHTML: '' };
    const me = { uid: 'yo', clubId: 'c1', category: 'regional', subcategory: 'B' };
    const sb = {
        Date: { now: () => ahora, parse: Date.parse }, Math, String, Number, isNaN, Infinity, encodeURIComponent, decodeURIComponent,
        console, alert: (m) => alertas.push(m), confirm: () => true,
        showToast: (m) => toasts.push(m),
        document: { getElementById: (id) => (id === 'live-matches-body' ? body : null) },
        window: {
            _cronosCurrentUser: me, _cronos_auth: { db: {} },
            cronosTeamId: (c, cat, sub) => c + '__' + String(cat).toLowerCase() + '__' + String(sub).toLowerCase(),
            cronosTeamIdOfDoc: (d) => d.teamId,
            cronosBorrarPartidoEnVivo: async (id) => { borrados.push(id); return true; },
        },
        __import: async () => ({
            collection: () => 'live_matches', where: () => null, query: () => null,
            getDocs: async () => ({ forEach: (cb) => docs.forEach(d => cb({ id: d.id, data: () => d })) }),
        }),
    };
    vm.createContext(sb);
    const bloque = SETUP.slice(ini, SETUP.indexOf('\n};', SETUP.indexOf('window._cronosLimpiarColgados = async')) + 3)
        .replace(/await import\([^)]*\)/, 'await __import()');
    vm.runInContext('var liveMatchId = "VIVO";\n' + bloque, sb);
    await sb.window._cronosPintaPartidosEnVivo();
    const h = body.innerHTML;
    const tarjeta = (id) => { const i = h.indexOf('data-lm-id="' + id + '"'); return i < 0 ? '' : h.slice(i, h.indexOf('data-lm-id="', i + 5) > 0 ? h.indexOf('data-lm-id="', i + 5) : undefined); };
    ok('5b · 🔑🔑 enseña los nombres y el marcador REALES (antes «Local 0-0 Visitante»)',
       /CD PRUEBA/.test(tarjeta('VIVO')) && /2 - 0/.test(tarjeta('VIVO')) && /1ª parte/.test(tarjeta('VIVO')));
    ok('5c · los terminados no salen', !/data-lm-id="TERMINADO"/.test(h));
    ok('5d · 🔑 marca COLGADO lo que lleva ≥30 min sin actualizarse, y no lo que transmite',
       /data-lm-colgado/.test(tarjeta('COLG_MIO')) && /data-lm-colgado/.test(tarjeta('COLG_CREADO')) &&
       !/data-lm-colgado/.test(tarjeta('VIVO')));
    ok('5e · 🔑🔑 «Eliminar» sólo en los colgados de SU equipo o creados por él',
       /data-lm-borrar/.test(tarjeta('COLG_MIO')) && /data-lm-borrar/.test(tarjeta('COLG_CREADO')) &&
       !/data-lm-borrar/.test(tarjeta('COLG_AJENO')) && !/data-lm-borrar/.test(tarjeta('VIVO')));
    ok('5f · y el botón «Limpiar colgados» de arriba', /data-lm-limpiar/.test(h) && /2 partidos colgados de tu equipo/.test(h));

    await sb.window._cronosEliminarPartidoColgado('COLG_AJENO');
    ok('5g · 🔒 la puerta se mira también al ejecutar: el de otro equipo NO se borra',
       borrados.length === 0 && alertas.some(a => /categoría y subcategoría/.test(a)));
    await sb.window._cronosEliminarPartidoColgado('VIVO');
    ok('5h · 🔒 ni el que está transmitiendo', borrados.length === 0);
    await sb.window._cronosEliminarPartidoColgado('COLG_MIO');
    ok('5i · el colgado de su equipo sí', JSON.stringify(borrados) === '["COLG_MIO"]');
    borrados.length = 0;
    await sb.window._cronosLimpiarColgados();
    ok('5j · 🔑 «Limpiar colgados» borra exactamente los suyos', JSON.stringify(borrados.sort()) === '["COLG_CREADO","COLG_MIO"]',
       JSON.stringify(borrados));
    ok('5k · y la lista ya no lee los campos inexistentes',
       !/m\.homeName|m\.teamHome|m\.currentHalf/.test(SETUP));
}

console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }

})();

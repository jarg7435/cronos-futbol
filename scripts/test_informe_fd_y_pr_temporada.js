// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v821 · Informes colectivos: P/R colectivas en el acumulado de
//         temporada + bloque F-D (fortalezas y debilidades) en el informe
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt 16-10, capturas 11563 / 11564):
//   1. El «Resumen acumulado de la temporada» daba ▲R 0 / ▼P 0 en el total de
//      un equipo con 24 recuperaciones y 17 pérdidas, porque TODAS se habían
//      apuntado «del equipo» (sin jugador) y la tabla sólo sumaba dorsales.
//   2. El análisis F-D del directo, como bloque del informe del partido.
//
// ⚠️ SE EJECUTAN LOS MÓDULOS REALES: category-tree.js, report-engine.js
// (sandbox desnudo, igual que test_report_engine_module.js) y
// strengths-panel.js (el análisis que se le inyecta al motor).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};

// ── category-tree.js con el extra de P/R encendido ──────────────────────────
function cargarCT(extraActivo) {
    const win = {
        _cronosExtraEnabled: (k) => (k === 'registro_pr' ? extraActivo : true),
        CT_CATEGORIES: [], escapeHtml: (s) => String(s == null ? '' : s),
    };
    const ctx = {
        window: win, document: { getElementById: () => null, createElement: () => ({ style: {} }) },
        console: { log() {}, warn() {}, error() {} },
        Date, JSON, Object, Array, String, Number, Boolean, Math, Map, Set,
        RegExp, isNaN, parseInt, parseFloat, Error, localStorage: { getItem: () => null, setItem: () => {} },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(leer('js/admin/shared/category-tree.js'), ctx);
    return win;
}

// ── strengths-panel.js: sólo su análisis puro ───────────────────────────────
function cargarFD() {
    const el = () => ({ children: [], classList: { add() {}, remove() {}, contains: () => false },
                        appendChild(h) { return h; }, removeChild(h) { return h; }, addEventListener() {}, style: {} });
    const ctx = {
        document: { readyState: 'complete', body: el(), head: el(), createElement: el,
                    getElementById: () => null, addEventListener() {} },
        setInterval: () => 1, clearInterval() {}, Math, Object, String, Number, window: {}
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(leer('js/match/events/strengths-panel.js'), ctx, { filename: 'strengths-panel.js' });
    return ctx.window.cronosFDAnaliza;
}

// ── report-engine.js en sandbox desnudo (ni window ni document) ─────────────
function cargarRP() {
    const src = leer('js/coach/reports/report-engine.js');
    const sb = { Math, Array, Object, String, Number, JSON, Date, Map, Set, parseInt, parseFloat, isNaN };
    vm.createContext(sb);
    vm.runInContext(src + '\nthis.__rp = _RP;', sb);
    return sb.__rp;
}

const jug = (n, alias, extra) => Object.assign({
    playerNumber: String(n), playerAlias: alias, minutesPlayed: '90:00',
    goals: 0, cards: null, injured: false, history: []
}, extra || {});

// El partido de la captura: 17 pérdidas y 24 recuperaciones, TODAS sin jugador.
const items = [];
for (let i = 0; i < 17; i++) items.push({ kind: 'loss', number: '', matchTime: (i < 8 ? '1T ' : '2T ') + '10:00' });
for (let i = 0; i < 24; i++) items.push({ kind: 'recovery', number: '', matchTime: (i < 10 ? '1T ' : '2T ') + '10:00' });
const PR_COLECTIVO = {
    perdidas:       { total: 17, sinAsignar: 17, porDorsal: {} },
    recuperaciones: { total: 24, sinAsignar: 24, porDorsal: {} },
    items
};
// Otro partido con reparto mixto: 2 de jugador + 1 colectiva en cada lado.
const PR_MIXTO = {
    perdidas:       { total: 3, sinAsignar: 1, porDorsal: { '7': 2 } },
    recuperaciones: { total: 3, sinAsignar: 1, porDorsal: { '10': 2 } },
};

// ═══ 1 · ACUMULADO DE TEMPORADA ═════════════════════════════════════════════
{
    const W = cargarCT(true);
    const partidos = [
        // matchPR repetido en cada documento, y una copia VIEJA (menos completa)
        // en el primero: debe ganar la más completa.
        { matchId: 'm1', category: 'f11_regional', players: [
            jug(7, 'NANO', { matchPR: { perdidas: { total: 5, sinAsignar: 5, porDorsal: {} },
                                         recuperaciones: { total: 2, sinAsignar: 2, porDorsal: {} } } }),
            jug(10, 'BRUNO', { matchPR: PR_COLECTIVO })] },
        { matchId: 'm2', category: 'f11_regional', players: [
            jug(7, 'NANO', { matchPR: PR_MIXTO }), jug(10, 'BRUNO', { matchPR: PR_MIXTO })] },
        { matchId: 'm3', category: 'f11_regional', players: [jug(7, 'NANO')] },   // sin registro
    ];
    const t = W.ctAccumulateTeamPR(partidos);
    ok('1a · totales del equipo = suma de los totales de cada partido (17+3 / 24+3)',
       t.perdidas === 20 && t.recuperaciones === 27, t);
    ok('1b · reparto colectivo / de jugador (18 y 2 · 25 y 2)',
       t.colP === 18 && t.jugP === 2 && t.colR === 25 && t.jugR === 2, t);
    ok('1c · el partido sin registros no cuenta para la media', t.partidos === 2, t);
    ok('1d · de las copias repetidas gana la MÁS COMPLETA, no la primera', t.perdidas === 20);

    const filas = W.ctAccumulatePlayerStats(partidos);
    const html = W.ctRenderStatsTable(filas, { matchCount: 3, categoria: 'regional', teamPR: t });
    ok('1e · fila propia «Equipo · sin jugador asignado» con 25 ▲R y 18 ▼P',
       /Equipo · sin jugador asignado<\/td>(<td>-<\/td>){7}<td[^>]*>25<\/td><td[^>]*>18<\/td>/.test(html));
    const pie = html.slice(html.indexOf('<tfoot>'), html.indexOf('</tfoot>'));
    ok('1f · el «Total equipo» incluye lo colectivo (27 / 20)',
       /<td style="color:#3fb950;">27<\/td><td style="color:#f85149;">20<\/td>/.test(pie), pie);
    ok('1g · bloque resumen de temporada con totales, balance y medias',
       /data-pr-temporada="1"/.test(html) && /Pérdidas y recuperaciones del equipo · temporada/.test(html) &&
       />\+7</.test(html) && /media 13,5 \/ partido/.test(html) && /media 10 \/ partido/.test(html), html.slice(-900));
    ok('1h · dice cuántas son colectivas', /25 colectivas/.test(html) && /18 colectivas/.test(html));

    const sinTeam = W.ctRenderStatsTable(filas, { matchCount: 3, categoria: 'regional' });
    ok('1i · sin `teamPR`, la tabla es la de siempre', !/sin jugador asignado/.test(sinTeam) && !/data-pr-temporada/.test(sinTeam));

    const apagado = cargarCT(false);
    const hOff = apagado.ctRenderStatsTable(apagado.ctAccumulatePlayerStats(partidos),
        { matchCount: 3, categoria: 'regional', teamPR: apagado.ctAccumulateTeamPR(partidos) });
    ok('1j · con el extra APAGADO no sale nada de P/R', !/sin jugador asignado/.test(hOff) && !/data-pr-temporada/.test(hOff));
    const hBase = W.ctRenderStatsTable(filas, { matchCount: 3, categoria: 'alevin', teamPR: t });
    ok('1k · en categoría de BASE tampoco', !/sin jugador asignado/.test(hBase) && !/data-pr-temporada/.test(hBase));
}

// ═══ 2 · LAS DOS PANTALLAS PASAN `teamPR` ═══════════════════════════════════
{
    const tab = leer('js/coach/reports/reports-tab.js');
    const mis = leer('js/coach/comms/individual-reports.js');
    ok('2a · Dirección (reports-tab) pasa teamPR', /teamPR:\s*\(typeof window\.ctAccumulateTeamPR/.test(tab));
    ok('2b · Mis Informes (individual-reports) pasa teamPR', /teamPR:\s*\(typeof window\.ctAccumulateTeamPR/.test(mis));
    ok('2c · las tres llamadas al motor pasan el análisis F-D',
       (tab.match(/fdAnaliza: window\.cronosFDAnaliza/g) || []).length === 1 &&
       (mis.match(/fdAnaliza: window\.cronosFDAnaliza/g) || []).length === 2);
}

// ═══ 3 · BLOQUE F-D EN EL INFORME DEL PARTIDO ═══════════════════════════════
{
    const RP = cargarRP();
    const FD = cargarFD();
    const MS = {
        corners:   { favor: 6, contra: 1, detalle: [] },
        faltas:    { favor: 9, contra: 8, detalle: [] },
        centros:   { total: 5, detalle: [] },
        ocasiones: { favor: 16, contra: 5, detalle: [] },
        porDorsal: { '1': { oc: 1 } },
        sinAsignar: { cf: 6, cc: 1, ff: 9, fc: 8, ce: 5, of: 16, oc: 4 }
    };
    for (let i = 0; i < 10; i++) MS.ocasiones.detalle.push({ tipo: 'favor', minuto: '1T 05:00' });
    for (let i = 0; i < 6; i++)  MS.ocasiones.detalle.push({ tipo: 'favor', minuto: '2T 05:00' });
    for (let i = 0; i < 5; i++)  MS.ocasiones.detalle.push({ tipo: 'contra', minuto: '2T 05:00' });
    const m = { matchDate: '2026-10-16', rival: 'R', scoreHome: 3, scoreAway: 0, category: 'f11_regional', duration: 90,
                players: [jug(1, 'OMAR', { matchPR: PR_COLECTIVO, matchStats: MS }),
                          jug(2, 'CARLOS', { goals: 2, matchPR: PR_COLECTIVO, matchStats: MS }),
                          jug(3, 'D HNDEZ', { history: [{ type: 'yellow', minute: 74 }] })] };
    const h = RP.build(m, { clubName: 'CD' }, { fdAnaliza: FD });
    ok('3a · el informe lleva el bloque F-D, UNA vez', (h.match(/data-fd-informe="1"/g) || []).length === 1);
    ok('3b · va DESPUÉS de las avanzadas y ANTES del registro cronológico',
       h.indexOf('data-sav-informe') < h.indexOf('data-fd-informe') &&
       h.indexOf('data-fd-informe') < h.indexOf('Registro cronológico de incidencias'));
    ok('3c · balance general positivo', /BALANCE POSITIVO/.test(h));
    ok('3d · fortalezas: goles, ocasiones y córners',
       ['goles', 'ocasiones', 'corners'].every(k => new RegExp('data-fd-item="' + k + '" data-fd-estado="fortaleza"').test(h)));
    // +7 sobre 41 = 17 %, por debajo del ±20 % del directo: el mismo umbral.
    ok('3d2 · R/P +7 sobre 41 queda NEUTRO, igual que en el directo',
       /data-fd-item="rp" data-fd-estado="neutro"/.test(h) &&
       FD({ pr: { rec: 24, perd: 17 } }).items[0].estado === 'neutro');
    ok('3e · faltas 9/8 quedan neutras (en «Resto de apartados»)',
       /data-fd-item="faltas" data-fd-estado="neutro"/.test(h) && /Resto de apartados/.test(h));
    ok('3f · columnas Fortalezas y Puntos críticos', /💪 Fortalezas/.test(h) && /⚠️ Puntos críticos/.test(h));
    ok('3g · desglose por partes con el detalle guardado', /1\.ª parte:/.test(h) && /2\.ª parte:/.test(h));
    ok('3h · destaca el goleador (CARLOS, 2 goles)', /DESTACAN/.test(h) && /#2 CARLOS/.test(h));
    ok('3i · marcador desde MI lado: de visitante, 3-0 en contra es crítico',
       /data-fd-item="goles" data-fd-estado="critico"/.test(
           RP.build(Object.assign({}, m, { myTeamRole: 'away' }), { clubName: 'CD' }, { fdAnaliza: FD })));

    ok('3j · sin el análisis inyectado (motor solo), no sale el bloque', !/data-fd-informe/.test(RP.build(m, { clubName: 'CD' })));
    const sinExtras = { matchDate: '2026-10-16', rival: 'R', scoreHome: 1, scoreAway: 0, category: 'f11_regional',
                        players: [jug(1, 'OMAR')] };
    ok('3k · un partido sin R/P ni avanzadas no lleva bloque F-D',
       !/data-fd-informe/.test(RP.build(sinExtras, { clubName: 'CD' }, { fdAnaliza: FD })));
    const base = Object.assign({}, m, { category: 'Alevín C' });
    ok('3l · en categoría de BASE tampoco (ni P/R ni avanzadas)',
       !/data-fd-informe/.test(RP.build(base, { clubName: 'CD' }, { fdAnaliza: FD })));

    const src = leer('js/coach/reports/report-engine.js');
    const tramo = src.slice(src.indexOf('v821 · F-D · FORTALEZAS'), src.indexOf('v715 · Y EL COMENTARIO RETROACTIVO'));
    ok('3m · el motor sigue PURO: el bloque nuevo no nombra window ni document',
       tramo.length > 100 && !/\bwindow\./.test(tramo) && !/\bdocument\./.test(tramo));
}

console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

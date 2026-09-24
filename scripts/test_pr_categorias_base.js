// ─────────────────────────────────────────────────────────────────────────
//  test_pr_categorias_base.js  ·  🔴 v761 (2026-09-24, capturas 10862-10864)
//
//  Encargo: en las categorías base (Prebenjamín, Benjamín, Alevín, Infantil
//  —y FUTureFEM, de formación—) NO salen Pérdidas y Recuperaciones «bajo
//  ningún concepto», ni en el informe colectivo ni en los individuales.
//
//  📏 LO QUE SE MIDIÓ EN PRODUCCIÓN: ningún informe de Alevín traía P/R. El
//  Panel de Dirección agrupaba por fecha+rival+entrenador y FUNDÍA tres
//  partidos del 23-09 (Alevín 2-0, Regional B 2-2, Alevín 3-2, los tres
//  contra «Rival»): el Alevín enseñaba los P/R del Regional.
//
//  Se vigilan las dos cosas, EJECUTANDO el código real:
//   1. Una sola regla: utils.js, la copia privada del motor y la del árbol
//      dicen lo mismo en todo el catálogo.
//   2. Ningún camino deja P/R en una categoría base: motor, lectura para
//      TXT/PDF/CSV, despacho al guardar y panel de familias.
//   3. El Panel de Dirección agrupa por matchId.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UTILS = leer('js/core/utils.js');
const ENGINE = leer('js/coach/reports/report-engine.js');
const TREE = leer('js/admin/shared/category-tree.js');
const TRACKER = leer('js/match/events/possession-tracker.js');
const TAB = leer('js/coach/reports/reports-tab.js');
const PARENT = leer('js/parent/panel.js');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 400)); }
};
const hasta = (src, desde, fin) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No se encuentra: ' + desde);
    return src.slice(i, src.indexOf(fin, i) + fin.length);
};
// Desde `desde` hasta la llave que cierra la primera que se abre (y su `;`).
const bloque = (src, desde) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No se encuentra: ' + desde);
    let p = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) { if (src[j] === '{') p++; else if (src[j] === '}') { p--; if (!p) break; } }
    const k = src.indexOf(';', j);
    return src.slice(i, (k > j && k - j < 3) ? k + 1 : j + 1);
};

const PR = { perdidas: { total: 3, sinAsignar: 1, porDorsal: { '10': 1, '19': 1 } },
             recuperaciones: { total: 4, sinAsignar: 0, porDorsal: { '10': 2, '13': 2 } } };
const BASE = ['prebenjamin', 'benjamin', 'alevin', 'infantil', 'Alevín C', 'f7_alevin', 'INFANTIL', 'Prebenjamín A', 'futurefem', 'FUTureFEM'];
const CON  = ['cadete', 'juvenil', 'regional', 'regional_fem', 'Regional FEM', 'f11_regional', 'nacional', 'Cadete B'];

// ── Utils (la regla compartida) ─────────────────────────────────────────
const U = { console };
U.window = U;
vm.createContext(U);
vm.runInContext(hasta(UTILS, 'function _cronosNoEsAcento(', '\n}\n') + '\n' +
    hasta(UTILS, "if (typeof window.cronosCategoriaConRegistroPR !== 'function') {", '\n}\n') + '\n' +
    hasta(UTILS, 'function cronosPRPermitidoEnCategoria(', '\n}\n') + '\n' +
    hasta(UTILS, 'function cronosPRDelInforme(', '\n}\n') +
    '\nwindow.cronosPRPermitidoEnCategoria = cronosPRPermitidoEnCategoria; window.cronosPRDelInforme = cronosPRDelInforme;', U);

// ── Motor (copia privada) ───────────────────────────────────────────────
const M = { console };
vm.createContext(M);
vm.runInContext(bloque(ENGINE, 'const _prDelInforme = (mm) => {') + '\nglobalThis.f = _prDelInforme;', M);
const regMotor = (() => { const s = bloque(ENGINE, 'const _prCategoriaPermite = (cat) => {');
    const c = {}; vm.createContext(c); vm.runInContext(s + '\nglobalThis.f = _prCategoriaPermite;', c); return c.f; })();

// ── Árbol ───────────────────────────────────────────────────────────────
const T = { console: { log() {}, warn() {}, error() {} } };
T.window = T; vm.createContext(T); vm.runInContext(TREE, T);

console.log('\n══ 🔴 P/R fuera de las categorías base ══');

console.log('\n1) Una sola regla en los tres sitios');
{
    const cats = BASE.concat(CON).concat((T.CT_CATEGORIES || []).map((c) => c.id)).concat((T.CT_CATEGORIES || []).map((c) => c.label));
    const distintas = cats.filter((c) => {
        const a = U.cronosPRPermitidoEnCategoria(c), b = regMotor(c), t = T.ctCategoriaRegistraPR(c);
        return !(a === b && b === t);
    });
    ok('1a · 🔑 utils, motor y árbol coinciden en ' + cats.length + ' nombres de categoría', distintas.length === 0, distintas);
    ok('1b · las base NO llevan P/R', BASE.every((c) => U.cronosPRPermitidoEnCategoria(c) === false), BASE.filter((c) => U.cronosPRPermitidoEnCategoria(c)));
    ok('1c · de Cadete hacia arriba SÍ (incluida Nacional)', CON.every((c) => U.cronosPRPermitidoEnCategoria(c) === true), CON.filter((c) => !U.cronosPRPermitidoEnCategoria(c)));
    ok('1d · el directo usa la misma lista (Nacional ya registra)', U.cronosCategoriaConRegistroPR('nacional') === true && U.cronosCategoriaConRegistroPR('alevin') === false);
    ok('1e · sin categoría no se decide (no se esconden datos por no saber)', U.cronosPRPermitidoEnCategoria('') === true && regMotor('') === true);
}

console.log('\n2) Ningún camino deja P/R en una categoría base');
{
    const partido = (cat) => ({ category: cat, matchPR: PR, players: [{ category: cat, matchPR: PR, playerNumber: '10' }] });
    ok('2a · 🔑 informe del partido (motor): Alevín → sin P/R', M.f(partido('alevin')) === null);
    ok('2b · informe del partido (motor): Regional → con P/R', (M.f(partido('f11_regional')) || {}).perdidas.total === 3);
    ok('2c · TXT/PDF/CSV (cronosPRDelInforme): Infantil → sin P/R', U.cronosPRDelInforme(partido('infantil')) === null);
    ok('2d · TXT/PDF/CSV: Juvenil → con P/R', (U.cronosPRDelInforme(partido('juvenil')) || {}).recuperaciones.total === 4);
    ok('2e · la categoría sale del documento si el agregado no la trae',
       U.cronosPRDelInforme({ matchPR: PR, players: [{ category: 'benjamin', matchPR: PR }] }) === null);

    // Despacho: lo que se GUARDA. Memoria con P/R de un partido anterior.
    const D = { console, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
    D.window = D;
    D.document = { getElementById: () => null };
    D.cronosPRPermitidoEnCategoria = U.cronosPRPermitidoEnCategoria;
    D._cronosPR = { matchId: 'x', items: [{ kind: 'loss', playerId: 'p1', number: '10', name: 'A', createdAt: 1 },
                                         { kind: 'recovery', playerId: 'p2', number: '13', name: 'B', createdAt: 2 }] };
    vm.createContext(D);
    vm.runInContext(bloque(TRACKER, 'function _categoriaDelPartido()') + '\n' +
                    bloque(TRACKER, 'window.cronosPRDelPartido = function (items) {'), D);
    D._currentMatchCategory = 'alevin';
    const alevin = D.cronosPRDelPartido();
    ok('2f · 🔑 al GUARDAR un Alevín no viaja nada, aunque quede P/R en memoria',
       alevin.perdidas.total === 0 && alevin.recuperaciones.total === 0, alevin);
    D._currentMatchCategory = 'regional';
    const regional = D.cronosPRDelPartido();
    ok('2g · al guardar un Regional viaja lo registrado', regional.perdidas.total === 1 && regional.recuperaciones.total === 1, regional);
    D._currentMatchCategory = 'alevin';
    ok('2h · con lista explícita no se filtra (es un cálculo, no un despacho)', D.cronosPRDelPartido(D._cronosPR.items).perdidas.total === 1);

    // Panel de familias
    const F = { console, window: { cronosPRPermitidoEnCategoria: U.cronosPRPermitidoEnCategoria } };
    vm.createContext(F);
    vm.runInContext(bloque(PARENT, 'const _prDeInforme = (r) => {') + '\nglobalThis.f = _prDeInforme;', F);
    const fa = F.f({ category: 'alevin', prPropio: { perdidas: 2, recuperaciones: 3 } });
    ok('2i · familias: Alevín → sin P/R', fa.hay === false && fa.p === 0 && fa.r === 0, fa);
    const fr = F.f({ category: 'regional', prPropio: { perdidas: 2, recuperaciones: 3 } });
    ok('2j · familias: Regional → con P/R', fr.hay === true && fr.p === 2 && fr.r === 3, fr);
}

console.log('\n3) El Panel de Dirección no funde partidos');
{
    const linea = hasta(TAB, 'const key = r.matchId ?', ';');
    const clave = (r) => { const c = { r }; vm.createContext(c); vm.runInContext(linea + '\nglobalThis.k = key;', c); return c.k; };
    const base = { matchDate: '2026-09-23', rival: 'Rival', coachUid: 'Gky' };
    const ks = [Object.assign({ matchId: 'match_Gky_2026-09-23_rival_2x0' }, base),
                Object.assign({ matchId: 'match_Gky_2026-09-23_rival_2x2' }, base),
                Object.assign({ matchId: 'match_Gky_2026-09-23_rival_3x2' }, base)].map(clave);
    ok('3a · 🔑 los tres partidos del 23-09 contra «Rival» son TRES tarjetas', new Set(ks).size === 3, ks);
    ok('3b · un informe antiguo sin matchId conserva la clave de siempre', clave(base) === '2026-09-23_Rival_Gky', clave(base));
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

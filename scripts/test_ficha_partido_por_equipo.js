// ════════════════════════════════════════════════════════════════════
//  🪪 v793 · LA FICHA DEL PARTIDO NO LA MUEVE EL PANEL
//
//  Encargo del autor (implementar.txt 2026-10-09, capturas 11277-11280):
//  con un Regional B en juego volvió al panel con la pestaña «Alevín C» y
//  «Recuperar Partido» le ofreció «REGIONAL B · F-7 · Alevín · 18 jugadores
//  · ⚠️ Datos cruzados».
//
//  Causa medida en el código: el autoguardado de 5 s (app-init.js) tomaba la
//  categoría y la letra del DESPLEGABLE del panel y la modalidad de la global
//  `currentMode`, que el panel reescribe al cambiar de pestaña. El sello
//  `teamId` sí salía bien (Regional B): la ranura quedaba partida en dos.
//
//  Este guard EJECUTA el código real: utils.js entero, y `cronosFichaPartido`,
//  `_fichaEnMemoria` y `_saveMatchStateToStorage` de app-init.js.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ   = path.join(__dirname, '..');
const APP    = fs.readFileSync(path.join(RAIZ, 'js/core/app-init.js'), 'utf8');
const SETUP  = fs.readFileSync(path.join(RAIZ, 'js/core/setup-modal.js'), 'utf8');
const SYNC   = fs.readFileSync(path.join(RAIZ, 'js/match/live/sync.js'), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { console.log('  ✗ ' + nombre + (detalle !== undefined ? '\n      ' + String(detalle).slice(0, 300) : '')); fallos++; }
}
function trozo(src, desde, hasta) {
    const i = src.indexOf(desde), f = src.indexOf(hasta, i + 1);
    return (i < 0 || f < 0) ? '' : src.slice(i, f);
}

// ── utils.js de verdad (cronosTeamId, cronosTeamSlug, _cronosMatchModality…)
const sb = { console: { log() {}, warn() {}, error() {} }, document: { getElementById: () => null },
             localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
             sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
             navigator: {}, setTimeout: () => {} };
sb.window = sb;
vm.createContext(sb);
try { vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8'), sb); }
catch (e) { console.log('  (aviso al cargar utils.js: ' + e.message + ')'); }

const FICHA_SRC = trozo(APP, 'function cronosFichaPartido(', 'window.cronosFichaPartido = cronosFichaPartido;');
const MEM_SRC   = trozo(APP, 'function _fichaEnMemoria(', '// Para el latido a la nube');
const SAVE_SRC  = trozo(APP, 'function _saveMatchStateToStorage()', 'window._saveMatchStateToStorage = _saveMatchStateToStorage;');

console.log('\n── PARTE 1 · cronosFichaPartido (función pura, con utils.js real) ──');
ok('1a · se encuentra la ficha en app-init.js', FICHA_SRC.length > 400);
vm.runInContext(FICHA_SRC + '\n;globalThis.__ficha = cronosFichaPartido;', sb);
const ficha = sb.__ficha;

const CLUB = 'club_mqvr9m11_g9kj';
const REG_B = sb.cronosTeamId(CLUB, 'regional', 'B');
const ALE_C = sb.cronosTeamId(CLUB, 'alevin', 'C');
ok('1b · los sellos de equipo salen con el formato de las pestañas',
   REG_B === sb.cronosTeamSlug(CLUB) + '__regional__b' &&
   ALE_C === sb.cronosTeamSlug(CLUB) + '__alevin__c', REG_B + ' / ' + ALE_C);

// El caso de las capturas: ranura del Regional B escrita con el panel en Alevín C.
let f = ficha([{ category: 'f7_alevin', subcategory: 'C', mode: 'f7' }], REG_B);
ok('1c · 🔑🔑 [CAPTURAS] «Alevín C · F-7» dentro de un Regional B se corrige a Regional B · F-11',
   f.category === 'f11_regional' && f.subcategory === 'B' && f.mode === 'f11', JSON.stringify(f));

f = ficha([{ category: 'f7_alevin', subcategory: 'C', mode: 'f7' },
           { category: 'f11_regional', subcategory: 'B', mode: 'f7' }], REG_B);
ok('1d · de los candidatos manda el primero que CASA con el sello, no el primero a secas',
   f.category === 'f11_regional' && f.subcategory === 'B' && f.mode === 'f11', JSON.stringify(f));

f = ficha([{ category: 'f11_regional', subcategory: 'C', mode: 'f11' }], REG_B);
ok('1e · la letra la dicta el sello del equipo (B), no la que se escribiera (C)',
   f.subcategory === 'B', JSON.stringify(f));

f = ficha([{ category: 'f7_alevin', subcategory: 'C', mode: 'f11' }], ALE_C);
ok('1f · y al revés: un Alevín C escrito con modalidad F-11 vuelve a F-7',
   f.category === 'f7_alevin' && f.subcategory === 'C' && f.mode === 'f7', JSON.stringify(f));

f = ficha([{ category: 'f11_regional_fem', subcategory: 'A', mode: 'f11' }],
          sb.cronosTeamId(CLUB, 'regional_fem', 'A'));
ok('1g · Regional FEM casa con su sello (la trampa de v511 no vuelve)',
   f.category === 'f11_regional_fem' && f.mode === 'f11', JSON.stringify(f));

f = ficha([{ category: 'f11_juvenil', subcategory: 'A', mode: 'f11' }], '');
ok('1h · ⚠️ sin sello (entrenador sin club) no se descarta nada: manda el primero',
   f.category === 'f11_juvenil' && f.subcategory === 'A' && f.mode === 'f11', JSON.stringify(f));

f = ficha([{ category: '', subcategory: '', mode: 'f7' }], '');
ok('1i · ⚠️ sin categoría ni sello se conserva la modalidad declarada (comportamiento previo)',
   f.category === '' && f.mode === 'f7', JSON.stringify(f));

console.log('\n── PARTE 2 · el autoguardado REAL con el panel en el otro equipo ──');
ok('2a · se encuentran _fichaEnMemoria y el autoguardado', MEM_SRC.length > 200 && SAVE_SRC.length > 400);

function autoguardar(opc) {
    let escrito = null;
    const dom = { 'match-category': opc.domCat, 'match-subcategory': opc.domSub };
    const ctx = Object.assign(Object.create(null), {
        console, JSON, Date, Object, Array, String, Number,
        matchPhase: '1st_half', isRunning: true,
        masterTimeH1: 752, masterTimeH2: 0, half1MaxTime: 2700, half2MaxTime: 2700,
        TEAM_NAMES: { home: 'REGIONAL B', away: 'VISITANTE' }, COLORS: {},
        currentMode: opc.currentMode, liveMatchId: 'regional-b-09102026-ab12', analyzeAway: false,
        _slots: () => ({ leer: () => opc.previo || null, guardar: (id, st) => { escrito = st; } }),
        _miSlotId: () => 'regional-b-09102026-ab12',
        _equipoDelPartidoEnMemoria: () => opc.teamId,
        document: { getElementById: (id) => (id in dom) ? { value: dom[id] || '', textContent: '0' }
                                                         : { textContent: '1', value: '' } },
    });
    ctx.window = Object.assign(Object.create(null), {
        players: new Array(18).fill(0).map((_, i) => ({ id: i, team: 'home' })),
        _cronosExtraGoals: { home: 0, away: 0 }, _userTeamRole: 'home',
        _currentMatchCategory: opc.gCat, _currentMatchSubcategory: opc.gSub,
        _cronosFichaEnMemoria: opc.fichaPrevia || null,
        cronosTeamSlug: sb.cronosTeamSlug, cronosSinModalidad: sb.cronosSinModalidad,
        _cronosMatchModality: sb._cronosMatchModality,
    });
    vm.createContext(ctx);
    vm.runInContext(FICHA_SRC + '\n' + MEM_SRC + '\n' + SAVE_SRC +
                    '\n;globalThis.__guardar = _saveMatchStateToStorage;', ctx);
    ctx.__guardar();
    return escrito;
}

// Partido de Regional B confirmado (globales bien), y el panel ya en Alevín C.
let st = autoguardar({ teamId: REG_B, currentMode: 'f7', domCat: 'f7_alevin', domSub: 'C',
                       gCat: 'f11_regional', gSub: 'B' });
ok('2b · 🔑🔑 [CAPTURAS] con la pestaña Alevín C abierta, la ranura del Regional B sigue diciendo Regional B',
   st && st.category === 'f11_regional' && st.subcategory === 'B',
   JSON.stringify(st && { c: st.category, s: st.subcategory }));
ok('2c · 🔑🔑 y su modalidad sigue siendo F-11 aunque la global diga f7',
   st && st.currentMode === 'f11', st && st.currentMode);
ok('2d · el sello del equipo viaja intacto', st && st.teamId === REG_B);

// Una ranura vieja ya cruzada, y las globales también movidas: se repara desde el sello.
st = autoguardar({ teamId: REG_B, currentMode: 'f7', domCat: 'f7_alevin', domSub: 'C',
                   gCat: 'f7_alevin', gSub: 'C',
                   previo: { savedAt: 'x', createdAt: 'y', category: 'f7_alevin', subcategory: 'C', currentMode: 'f7' } });
ok('2e · 🔑 una ranura que YA nació cruzada se repara sola desde su sello',
   st && st.category === 'f11_regional' && st.subcategory === 'B' && st.currentMode === 'f11',
   JSON.stringify(st && { c: st.category, s: st.subcategory, m: st.currentMode }));

// Sin sello y con todo coherente: el comportamiento de siempre.
st = autoguardar({ teamId: '', currentMode: 'f7', domCat: 'f7_benjamin', domSub: 'A', gCat: '', gSub: '' });
ok('2f · ⚠️ sin equipo (individual) se guarda como antes', st && st.category === 'f7_benjamin' &&
   st.subcategory === 'A' && st.currentMode === 'f7', JSON.stringify(st && { c: st.category, m: st.currentMode }));

// Una ficha de OTRO equipo en memoria no se reutiliza.
st = autoguardar({ teamId: REG_B, currentMode: 'f11', domCat: '', domSub: '', gCat: 'f11_regional', gSub: 'B',
                   fichaPrevia: { teamId: ALE_C, category: 'f7_alevin', subcategory: 'C', mode: 'f7' } });
ok('2g · ⚠️ la ficha de otro equipo que quedara en memoria no se cuela', st &&
   st.category === 'f11_regional' && st.currentMode === 'f11', JSON.stringify(st && { c: st.category, m: st.currentMode }));

console.log('\n── PARTE 3 · los otros caminos usan la MISMA ficha ──');
ok('3a · nacer un partido tira la ficha anterior',
   /window\._cronosMatchTeamId = eq \|\| '';[\s\S]{0,200}?window\._cronosFichaEnMemoria = null;/.test(APP));
ok('3b · retomar del dispositivo corrige el estado con la ficha ANTES de restaurarlo',
   (function () {
       const r = trozo(APP, 'window._restoreActiveMatch = function', 'if (state.liveMatchId) S.setTabMatchId');
       return /cronosFichaPartido\(/.test(r) && /state\.currentMode = _fichaR\.mode/.test(r) &&
              /window\._cronosFichaEnMemoria = _fichaR/.test(r);
   })());
ok('3c · retomar de la nube usa la categoría DEL PARTIDO validada, y vuelve a SU equipo',
   (function () {
       const r = trozo(SETUP, 'async function _doResumeMatch(', 'let activeAddedSec = 0;');
       return /cronosFichaPartido\(\[\s*\{ category: m\.matchCategory/.test(r) &&
              /window\._cronosMatchTeamId = String\(m\.teamId\)/.test(r) &&
              r.indexOf('cronosFichaPartido(') < r.indexOf('currentMode = m.mode');
   })());
ok('3d · el latido a la nube manda la modalidad de la ficha, no la global',
   /mode:\s+\(_ficha && _ficha\.mode\) \|\| currentMode,/.test(SYNC));
ok('3e · y la categoría de la ficha va antes que la global y el desplegable',
   (function () {
       const i = SYNC.indexOf('} else if (_ficha && _ficha.category) {');
       const j = SYNC.indexOf('} else if (window._currentMatchCategory) {');
       return i > 0 && j > i;
   })());

console.log('\n── PARTE 4 · «Recuperar Partido» sólo enseña el equipo seleccionado ──');
// 🔄 v794 · la regla se endureció (cuenta + equipo exactos, siempre): el
// comportamiento lo EJECUTA test_aislamiento_cuenta_y_equipo.js.
ok('4a · las ranuras del dispositivo se listan filtradas por el equipo seleccionado (estricto, v794)',
   /_S \? _S\.listar\(_eqSel \|\| undefined, \{ estricto: true \}\)/.test(SETUP));
ok('4b · v794 · se filtra SIEMPRE que haya equipo, también con uno solo',
   /if \(_act\) \{\s*_eqSel = _act;/.test(SETUP) && !/_misEq\.length > 1 && _fichaEq/.test(SETUP));
ok('4c · los documentos de la nube de otra cuenta u otro equipo se saltan, sin borrarlos',
   /\} else if \(!_docEsMio\(data\)\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\} else \{/.test(SETUP));
ok('4d · el panel dice de qué equipo son los partidos y cómo ver los del otro',
   /Partidos de <strong/.test(SETUP) && /elígelo antes en «Mis equipos»/.test(SETUP));
ok('4e · las tarjetas de ranuras viejas se pintan con su ficha corregida',
   /let parsed = _ranura\.state;[\s\S]{0,400}?cronosFichaPartido\(/.test(SETUP));

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '' : '  ✅'));
process.exit(fallos ? 1 : 0);

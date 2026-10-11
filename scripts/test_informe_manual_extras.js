// ─────────────────────────────────────────────────────────────────────────
//  test_informe_manual_extras.js  ·  📈 v800
//
//  Encargo del autor (implementar.txt 2026-10-11, capturas 11300-11301): el
//  desplegable de sucesos de «Añadir informe de partido» tiene que ofrecer
//  pérdidas, recuperaciones y TODAS las métricas de estadísticas avanzadas,
//  «respetando estrictamente las mismas condiciones y restricciones que en
//  el partido en directo (categoría y extras contratados)».
//
//  🔑 SE EJECUTA LO DE VERDAD, NO MAQUETAS:
//    · manual-report.js entero;
//    · las puertas de categoría de js/core/utils.js (trozo extraído);
//    · advanced-stats-report.js (catálogo de métricas y sus puertas);
//    · possession-tracker.js y advanced-stats.js (los AGREGADORES del
//      directo), cargados con el DOM «aún cargando» para que no se monten.
//  Lo único simulado son los EXTRAS del club, que es justo la variable.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 500)); }
};

// Trozo de utils.js con las reglas de categoría (de la marca a la marca).
const UTILS = leer('js/core/utils.js');
const trozo = (src, desde, hasta) => {
    const i = src.indexOf(desde); const j = src.indexOf(hasta, i);
    return (i < 0 || j < 0) ? '' : src.slice(i, j);
};
const T_PR = trozo(UTILS, "if (typeof window.cronosCategoriaConRegistroPR !== 'function') {",
                   'window.cronosPRPermitidoEnCategoria = cronosPRPermitidoEnCategoria;') +
             'window.cronosPRPermitidoEnCategoria = cronosPRPermitidoEnCategoria;';
const T_ACENTO = trozo(UTILS, 'function _cronosNoEsAcento(caracter) {', 'function cronosTeamSlug(valor) {');

function entorno({ categoria, extras }) {
    const me = { uid: 'u1', clubId: 'clubA', extras: extras };
    const win = {
        _cronosCurrentUser: me,
        // Mismo contrato que setup-modal.js: ausente o true = activo.
        _cronosExtraEnabled: (k) => (me.extras || {})[k] !== false,
    };
    const sb = {
        window: win, console: { log() {}, warn() {}, error() {} },
        document: { readyState: 'loading', addEventListener() {}, getElementById: () => null,
                    body: { classList: { contains: () => true } } },
        setTimeout, clearTimeout, Date, Math, JSON, parseInt, parseFloat, isFinite,
        Array, Object, String, Number, Boolean, Map, Set, RegExp, Error, localStorage: { getItem() { return null; }, setItem() {} },
    };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(T_ACENTO + '\n' + T_PR, sb, { filename: 'utils(trozo).js' });
    vm.runInContext(leer('js/shared/advanced-stats-report.js'), sb, { filename: 'advanced-stats-report.js' });
    vm.runInContext(leer('js/match/events/possession-tracker.js'), sb, { filename: 'possession-tracker.js' });
    vm.runInContext(leer('js/match/events/advanced-stats.js'), sb, { filename: 'advanced-stats.js' });
    vm.runInContext(leer('js/coach/comms/manual-report.js'), sb, { filename: 'manual-report.js' });
    const I = win._mrInterno;
    const S = win._mrState = I.estadoNuevo();
    S.equipo = { clubId: 'clubA', category: categoria, subcategory: 'B' };
    S.duracion = 90;
    S.jugadores = [{ dorsal: '7', nombre: 'FEFO', alias: 'FEFO' }, { dorsal: '9', nombre: 'NANO', alias: 'NANO' }];
    S.conv = { '7': true, '9': true };
    S.tit = { '7': true, '9': true };
    return { win, I, S };
}
const ids = (I) => I.tiposDisponibles().map(t => t.id);

console.log('\n── PARTE 1 · las mismas puertas que el directo ──');
{
    const BASE = ['gol', 'amarilla', 'roja', 'lesion', 'cambio'];
    const R = entorno({ categoria: 'regional', extras: { modulo_stats_avanzadas: true } });
    const t = ids(R.I);
    ok('1a · los cinco de siempre siguen ahí, en su orden', JSON.stringify(t.slice(0, 5)) === JSON.stringify(BASE), t);
    ok('1b · 🔑 Regional con los dos extras: Pérdida y Recuperación', t.includes('perdida') && t.includes('recuperacion'));
    ok('1c · 🔑 y las SIETE de estadísticas avanzadas (córners ±, faltas ±, centros, ocasiones ±)',
       ['sav_corners_favor', 'sav_corners_contra', 'sav_faltas_favor', 'sav_faltas_contra',
        'sav_centros', 'sav_ocasiones_favor', 'sav_ocasiones_contra'].every(x => t.includes(x)), t);
    ok('1d · con el rótulo del catálogo único (Faltas · Recibidas / Cometidas)',
       R.I.tiposDisponibles().some(x => /Faltas · Recibidas/.test(x.etiqueta)) &&
       R.I.tiposDisponibles().some(x => /Faltas · Cometidas/.test(x.etiqueta)));

    const A = entorno({ categoria: 'alevin', extras: { modulo_stats_avanzadas: true } });
    ok('1e · 🔑🔑 Alevín (categoría base): NI R/P NI estadísticas, aunque el club los tenga',
       JSON.stringify(ids(A.I)) === JSON.stringify(BASE), ids(A.I));

    const C = entorno({ categoria: 'cadete', extras: { modulo_stats_avanzadas: true } });
    ok('1f · 🔑 Cadete: R/P SÍ, estadísticas NO (como en directo: Cadete queda fuera de las avanzadas)',
       ids(C.I).includes('perdida') && !ids(C.I).some(x => /^sav_/.test(x)), ids(C.I));

    const sinPR = entorno({ categoria: 'regional', extras: { registro_pr: false, modulo_stats_avanzadas: true } });
    ok('1g · 🔑 sin el extra registro_pr el club no ve R/P', !ids(sinPR.I).includes('perdida') &&
       ids(sinPR.I).some(x => /^sav_/.test(x)));

    const sinSAv = entorno({ categoria: 'regional', extras: {} });
    ok('1h · 🔑🔑 estadísticas avanzadas: AUSENTE = APAGADO (como en directo)',
       !ids(sinSAv.I).some(x => /^sav_/.test(x)) && ids(sinSAv.I).includes('perdida'), ids(sinSAv.I));

    const N = entorno({ categoria: 'nacional', extras: { modulo_stats_avanzadas: true } });
    ok('1i · Nacional: los dos extras', ids(N.I).includes('perdida') && ids(N.I).includes('sav_centros'));
}

console.log('\n── PARTE 2 · lo que se guarda tiene la forma del directo ──');
{
    const R = entorno({ categoria: 'regional', extras: { modulo_stats_avanzadas: true } });
    const S = R.S;
    S.sucesos = [
        { id: 'a', tipo: 'perdida',      minuto: 10, dorsal: '7', dorsalEntra: '' },
        { id: 'b', tipo: 'perdida',      minuto: 50, dorsal: '',  dorsalEntra: '' },
        { id: 'c', tipo: 'recuperacion', minuto: 20, dorsal: '9', dorsalEntra: '' },
        { id: 'd', tipo: 'sav_corners_favor',  minuto: 30, dorsal: '9', dorsalEntra: '' },
        { id: 'e', tipo: 'sav_faltas_contra',  minuto: 60, dorsal: '7', dorsalEntra: '' },
        { id: 'f', tipo: 'sav_centros',        minuto: 70, dorsal: '',  dorsalEntra: '' },
        { id: 'g', tipo: 'gol',                minuto: 80, dorsal: '9', dorsalEntra: '' },
    ];
    const pr = R.I.matchPR(S);
    ok('2a · 🔑 matchPR: 2 pérdidas (1 de FEFO, 1 del equipo) y 1 recuperación de NANO',
       pr && pr.perdidas.total === 2 && pr.perdidas.porDorsal['7'] === 1 && pr.perdidas.sinAsignar === 1 &&
       pr.recuperaciones.total === 1 && pr.recuperaciones.porDorsal['9'] === 1, pr);
    ok('2b · con el minuto en la forma del directo («1T 10:00», «2T 50:00»)',
       pr && pr.items.some(i => i.matchTime === '1T 10:00') && pr.items.some(i => i.matchTime === '2T 50:00'));
    ok('2c · y lo lee el lector de familias (cronosPRDeJugador)',
       R.win.cronosPRDeJugador(pr, '7').perdidas === 1 && R.win.cronosPRDeJugador(pr, '9').recuperaciones === 1);
    const st = R.I.matchStats(S);
    ok('2d · 🔑 matchStats: córner a favor de NANO, falta cometida de FEFO, centro del equipo',
       st && st.corners.favor === 1 && st.faltas.contra === 1 && st.centros.total === 1 &&
       st.porDorsal['9'].cf === 1 && st.porDorsal['7'].fc === 1 && st.sinAsignar.ce === 1, st);
    ok('2e · el gol NO se cuela en las estadísticas ni en R/P',
       st.corners.favor + st.faltas.favor + st.faltas.contra + st.centros.total === 3 && pr.items.length === 3);
    ok('2f · ⚠️ sin sucesos de extra, no se guarda un objeto vacío (null)',
       (S.sucesos = [S.sucesos[6]], R.I.matchPR(S) === null && R.I.matchStats(S) === null));

    // En una categoría base no sale NADA aunque el formulario lo traiga.
    const A = entorno({ categoria: 'alevin', extras: { modulo_stats_avanzadas: true } });
    A.S.sucesos = [{ id: 'x', tipo: 'perdida', minuto: 3, dorsal: '7', dorsalEntra: '' },
                   { id: 'y', tipo: 'sav_centros', minuto: 4, dorsal: '', dorsalEntra: '' }];
    ok('2g · 🔑🔑 categoría base: aunque llegara un suceso de extra, NO se guarda',
       A.I.matchPR(A.S) === null && A.I.matchStats(A.S) === null);
}

console.log('\n── PARTE 3 · formulario y guardado ──');
{
    const R = entorno({ categoria: 'regional', extras: { modulo_stats_avanzadas: true } });
    R.S.sucesos = [{ id: 'a', tipo: 'perdida', minuto: 10, dorsal: '', dorsalEntra: '' },
                   { id: 'b', tipo: 'gol',     minuto: 12, dorsal: '', dorsalEntra: '' }];
    const pb = R.I.problemas();
    ok('3a · 🔑 una pérdida SIN jugador es válida («del equipo», como en directo)',
       !pb.some(x => /suceso 1 no tiene jugador/.test(x)), pb);
    ok('3b · ⚠️ pero un gol sin jugador sigue bloqueando', pb.some(x => /suceso 2 no tiene jugador/.test(x)), pb);

    const SRC = leer('js/coach/comms/manual-report.js');
    ok('3c · el selector de jugador de un extra ofrece «del equipo (sin jugador)»',
       /_mrEsExtra\(s\.tipo\) \? '— del equipo \(sin jugador\) —'/.test(SRC));
    ok('3d · 🔑 staff y entrenador llevan matchPR y matchStats',
       (SRC.match(/staffReport: true,[\s\S]{0,200}matchPR: matchPR,\s*matchStats: matchStats,/g) || []).length === 1 &&
       (SRC.match(/_forCoach: true,\s*matchPR: matchPR,\s*matchStats: matchStats,/g) || []).length === 1);
    ok('3e · 🔑 la familia sólo lo de SU hijo (prPropio), nunca el desglose del equipo',
       /type: 'parent_player_report',[\s\S]{0,600}prPropio:/.test(SRC) &&
       !/type: 'parent_player_report',[\s\S]{0,600}matchStats/.test(SRC));
    ok('3f · las puertas son las del directo (no copias)',
       /cronosCategoriaConRegistroPR\(cat\)/.test(SRC) && /cronosSAvExtraActivo\(\)/.test(SRC) &&
       /cronosSAvCategoriaCaptura\(_mrCategoria\(\)\)/.test(SRC) && /_cronosExtraEnabled\('registro_pr'\)/.test(SRC));
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);

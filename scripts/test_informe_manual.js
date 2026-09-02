// ════════════════════════════════════════════════════════════════════
//  test_informe_manual.js · «Añadir informe» v659 · normativa v660 ·
//  el id invisible v661 · las filas de sucesos v662
// ════════════════════════════════════════════════════════════════════
//
//  QUÉ VIGILA. El informe manual sólo sirve si es INDISTINGUIBLE de uno
//  cronometrado para los seis lectores que ya existen. Este guard no mira la
//  pantalla: mide las tres cosas de las que depende esa equivalencia.
//
//   PARTE 1 · La lógica pura del formulario, EJECUTADA (minutos, historial,
//             tarjetas). Se carga el módulo en un sandbox con un `window` de
//             mentira y se corre de verdad: una comprobación de texto no
//             habría cazado ninguno de los casos de abajo.
//   PARTE 2 · 🔑 EL PUENTE CON EL PARSER REAL. El historial que fabrica el
//             formulario se pasa por `_parseHistoryForFirestore` (el de
//             comms/panel.js, extraído y ejecutado) y se comprueba que salgan
//             los `sub_in`/`sub_out`/`goal` esperados. Es la parte que impide
//             el fallo silencioso: una nota mal redactada —con «(DESCANSO)»
//             dentro, por ejemplo— haría que report-engine DESCARTARA los
//             cambios y el informe saldría vacío SIN UN SOLO ERROR.
//   PARTE 3 · 🔑 EL PUENTE CON EL ACUMULADO DE TEMPORADA. Los documentos que
//             se escribirían se pasan por `ctAccumulatePlayerStats` (el de
//             admin/shared/category-tree.js, el MISMO que pinta la tabla) y se
//             comprueba que Conv./PJ/PT/goles/tarjetas/minutos salgan exactos.
//             Es lo que pidió el autor: «con total precisión».
//   PARTE 5 · ⚖️ LA NORMATIVA DE COMPETICIÓN (v660): Liga / Amistoso × F7 /
//             F11. Se EXTRAE `cronosCupoConvocatoria` de core/utils.js y se
//             ejecuta, y después se comprueba que el formulario BLOQUEE de
//             verdad. La aserción que más importa es que el amistoso abra la
//             convocatoria pero NO relaje los titulares.
//   PARTE 7 · 🔴 CADA FILA DE SUCESOS, INDEPENDIENTE (v662). Se pinta contra
//             un DOM de juguete que CUENTA los repintados: el defecto no
//             estaba en el mapeo por id, sino en que la lista se reordenaba
//             por minuto y se repintaba entera en cada cambio.
//   PARTE 6 · 🔴 EL NOMBRE DEL DOCUMENTO (v661). Se simula la ventana de 500
//             ordenada por `__name__` desc: con el prefijo `manual_` el
//             informe se quedaba fuera y era invisible en «Mis Informes».
//   PARTE 4 · Los enganches: el botón en «Mis Informes», el <script> de
//             index.html, el precache del Service Worker y la ausencia de
//             reglas nuevas.
//
//  ⚠️ El ORDEN DE IMPRESIÓN no es 1-2-3-4-5-6-7: las partes 7, 6 y 5 van antes
//  que la 4 porque preparan datos que la 4 usa. Cada bloque dice qué mide.
//
//  ⚠️ CADA AUSENCIA VA CON UNA PRESENCIA AL LADO (lección de v654 y v651): si
//  el módulo no cargara, la batería tiene que decir QUÉ falta, no reventar con
//  un TypeError que se trague las pruebas de debajo.
// ════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const F_MANUAL = path.join(ROOT, 'js', 'coach', 'comms', 'manual-report.js');
const F_PANEL  = path.join(ROOT, 'js', 'coach', 'comms', 'panel.js');
const F_INDIV  = path.join(ROOT, 'js', 'coach', 'comms', 'individual-reports.js');
const F_CAL    = path.join(ROOT, 'js', 'coach', 'reports', 'calendario-temporada.js');
const F_TREE   = path.join(ROOT, 'js', 'admin', 'shared', 'category-tree.js');
const F_INDEX  = path.join(ROOT, 'index.html');
const F_SW     = path.join(ROOT, 'sw.js');
const F_RULES  = path.join(ROOT, 'firestore.rules');

let fallos = 0;
function ok(nombre, cond, detalle) {
    if (cond) { console.log('  ✅ ' + nombre); return; }
    fallos++;
    console.log('  ❌ ' + nombre + (detalle ? '\n       → ' + detalle : ''));
}
function leer(f) { return fs.readFileSync(f, 'utf8'); }

console.log('\n── «Añadir informe»: el partido no cronometrado (v659) ──\n');

// ════════════════════════════════════════════════════════════════════
//  SANDBOX · se carga el módulo con un `window` mínimo
// ════════════════════════════════════════════════════════════════════
const win = {};
const sandbox = {
    window: win, document: { getElementById: () => null }, console,
    setTimeout, clearTimeout, Date, Math, JSON, parseInt, parseFloat, isFinite,
    Array, Object, String, Number, Boolean, Map, Set, RegExp, Error,
};
sandbox.globalThis = sandbox;

let cargoElModulo = false;
try {
    vm.createContext(sandbox);
    vm.runInContext(leer(F_MANUAL), sandbox, { filename: 'manual-report.js' });
    cargoElModulo = true;
} catch (e) {
    console.log('  ⚠️ el módulo no se pudo cargar en el sandbox: ' + e.message);
}

// ── Las DOS reglas globales de las que depende el formulario ────────
//  🔑 SE INYECTAN LAS DE VERDAD, NO MAQUETAS. `cronosCupoConvocatoria` se
//     EXTRAE de js/core/utils.js y se ejecuta: si alguien cambiara los cupos
//     allí, este guard lo notaría en las partes 3 y 5 a la vez. Va aquí arriba
//     —y no en la parte 5— porque el formulario FALLA CERRADO sin ella, así
//     que sin inyectarla todas las validaciones de más abajo saldrían rojas
//     por el motivo equivocado.
let cupoReal = null;
try {
    const utils = leer(path.join(ROOT, 'js', 'core', 'utils.js'));
    const ini = utils.indexOf('function cronosCupoConvocatoria');
    const fin = utils.indexOf('function cronosFueTitular');
    if (ini > 0 && fin > ini) {
        const ctx = { String, Object, console };
        vm.createContext(ctx);
        vm.runInContext(utils.slice(ini, fin) + '\n;this.__cupo = cronosCupoConvocatoria;', ctx);
        cupoReal = ctx.__cupo;
    }
} catch (e) { /* se reporta en la parte 5 */ }
if (cupoReal) win.cronosCupoConvocatoria = cupoReal;
// La modalidad se deriva de la categoría; aquí basta con la misma cascada.
win._cronosMatchModality = function (cat) {
    return /juvenil|regional|infantil|cadete|senior|futurefem/.test(String(cat)) ? 'f11' : 'f7';
};

console.log('── PARTE 1 · la lógica del formulario, ejecutada ──');

// 🔑 PRESENCIA ANTES QUE AUSENCIA. Sin esto, un módulo que no cargue haría
// reventar todo lo de abajo con un TypeError ilegible.
ok('1a · el módulo carga y publica openAnadirInforme', cargoElModulo && typeof win.openAnadirInforme === 'function',
   'openAnadirInforme = ' + typeof (win.openAnadirInforme));
ok('1b · publica sus piezas internas para poder medirlas', !!(win._mrInterno && win._mrInterno.calcularMinutos));

const MR = win._mrInterno || {};

// Un estado de prueba: F11 de 90 minutos, 4 convocados.
function estadoDePrueba() {
    const S = MR.estadoNuevo();
    S.equipo = { clubId: 'CLUB1', category: 'juvenil', subcategory: 'A', teamId: 'CLUB1__juvenil__a' };
    S.duracion = 90;
    S.jugadores = [
        { ficha: 'F1', dorsal: '1',  nombre: 'Portero Uno',  alias: 'Uno' },
        { ficha: 'F7', dorsal: '7',  nombre: 'Extremo Siete', alias: 'Siete' },
        { ficha: 'F9', dorsal: '9',  nombre: 'Nueve Nueve',  alias: 'Nueve' },
        { ficha: 'F14', dorsal: '14', nombre: 'Catorce Sub', alias: 'Catorce' },
        { ficha: 'F20', dorsal: '20', nombre: 'Veinte Banco', alias: 'Veinte' },
    ];
    ['1', '7', '9', '14', '20'].forEach(d => { S.conv[d] = true; });
    ['1', '7', '9'].forEach(d => { S.tit[d] = true; });
    return S;
}

// ── Minutos ─────────────────────────────────────────────────────────
if (MR.calcularMinutos) {
    const S = estadoDePrueba();
    S.sucesos = [
        { id: 'a', tipo: 'gol',    minuto: 12, dorsal: '9', dorsalEntra: '' },
        { id: 'b', tipo: 'cambio', minuto: 60, dorsal: '9', dorsalEntra: '14' },
    ];
    const m = MR.calcularMinutos(S);
    ok('1c · el titular sin cambios se acredita el partido entero', m['7'] === 90, 'salió ' + m['7']);
    ok('1d · el sustituido se corta en el minuto del cambio',       m['9'] === 60, 'salió ' + m['9']);
    ok('1e · el que entra cuenta desde su entrada hasta el final',   m['14'] === 30, 'salió ' + m['14']);
    // 🔑 EL CONVOCADO QUE NO JUEGA NO DESAPARECE: existe con 0. Si aquí saliera
    //    `undefined` no se le escribiría documento y perdería la convocatoria
    //    en el acumulado de temporada.
    ok('1f · el convocado que no jugó existe con 0 minutos',        m['20'] === 0, 'salió ' + m['20']);

    // 🚨 LA ROJA CIERRA EL TIEMPO. Sin esto, el expulsado del minuto 30
    //    aparecería con los 90 en la temporada.
    const R = estadoDePrueba();
    R.sucesos = [{ id: 'r', tipo: 'roja', minuto: 30, dorsal: '7', dorsalEntra: '' }];
    const mr = MR.calcularMinutos(R);
    ok('1g · 🔑 la expulsión corta los minutos del expulsado', mr['7'] === 30, 'salió ' + mr['7']);
    ok('1h · y no toca a los demás',                           mr['9'] === 90, 'salió ' + mr['9']);

    // Dos cambios encadenados sobre el mismo dorsal (sale, vuelve a entrar).
    const D = estadoDePrueba();
    D.sucesos = [
        { id: 'x', tipo: 'cambio', minuto: 20, dorsal: '9',  dorsalEntra: '14' },
        { id: 'y', tipo: 'cambio', minuto: 70, dorsal: '14', dorsalEntra: '9' },
    ];
    const md = MR.calcularMinutos(D);
    ok('1i · un jugador que sale y vuelve suma sus dos tramos', md['9'] === 20 + 20, 'salió ' + md['9']);
    ok('1j · y el que le relevó suma el suyo',                  md['14'] === 50, 'salió ' + md['14']);

    // El minuto escrito a mano manda sobre el cálculo.
    const O = estadoDePrueba();
    O.minManual['7'] = 45;
    ok('1k · la corrección a mano gana al cálculo', MR.minutosFinales(O)['7'] === 45);
    ok('1l · y no contagia al resto',               MR.minutosFinales(O)['9'] === 90);
} else {
    ok('1c-1l · lógica de minutos disponible', false, 'no se pudo cargar el módulo');
}

// ── Tarjetas ────────────────────────────────────────────────────────
if (MR.cards) {
    ok('1m · sin tarjetas → "ninguna"', MR.cards({ amarillas: 0, roja: false }) === 'ninguna');
    ok('1n · una amarilla → "amarilla"', MR.cards({ amarillas: 1, roja: false }) === 'amarilla');
    ok('1o · roja directa → "roja"',     MR.cards({ amarillas: 0, roja: true }) === 'roja');
    // 🔑 El campo `cards` es UNA cadena; las amarillas se cuentan aparte desde
    //    el historial. Dos amarillas son una roja, y las dos siguen contadas.
    ok('1p · 🔑 dos amarillas → "roja"', MR.cards({ amarillas: 2, roja: false }) === 'roja');
}

// ── Duración por categoría (misma tabla que report-engine) ──────────
if (MR.duracionPorCategoria) {
    const D = MR.duracionPorCategoria;
    // 🚨 'prebenjamin' CONTIENE 'benjamin': el orden de las comprobaciones es
    //    el bug que report-engine ya pagó una vez.
    ok('1q · 🚨 prebenjamín son 60, no 70', D('prebenjamin') === 60, 'salió ' + D('prebenjamin'));
    ok('1r · benjamín 70',  D('benjamin') === 70);
    ok('1s · alevín 70',    D('alevin') === 70);
    ok('1t · infantil 80',  D('infantil') === 80);
    ok('1u · cadete 80',    D('cadete') === 80);
    ok('1v · juvenil 90',   D('juvenil') === 90);
    ok('1w · regional 90',  D('regional') === 90);
    ok('1x · FUTureFEM 70', D('futurefem') === 70);
}

// ── MM:SS, no un número ─────────────────────────────────────────────
if (MR.mmss) {
    // 🔑 `minutesPlayed` es una CADENA "MM:SS" en los tres escritores. Guardar
    //    aquí un entero rompería `_segundosJugados` del motor de informes.
    ok('1y · 🔑 los minutos se guardan como cadena MM:SS', MR.mmss(65) === '65:00', 'salió ' + MR.mmss(65));
    ok('1z · y el cero también',                           MR.mmss(0) === '00:00');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · 🔑 el historial pasa por el PARSER REAL ──');
// ════════════════════════════════════════════════════════════════════
//  Se extrae `_parseHistoryForFirestore` DE comms/panel.js —no una copia— y se
//  ejecuta sobre lo que fabrica el formulario. Si alguien cambia la redacción
//  de las notas y deja de ser reconocible, esto se pone rojo aquí y no en el
//  campo tres semanas después.

let parse = null;
try {
    const panel = leer(F_PANEL);
    const ini = panel.indexOf('function _horaRealDeNota');
    const fin = panel.indexOf('function _cronosExtractDorsal');
    if (ini > 0 && fin > ini) {
        const trozo = panel.slice(ini, fin);
        const ctx = { window: {}, console };
        vm.createContext(ctx);
        vm.runInContext(trozo + '\n;this.__parse = _parseHistoryForFirestore;', ctx);
        parse = ctx.__parse;
    }
} catch (e) { /* se reporta abajo */ }

ok('2a · se pudo extraer _parseHistoryForFirestore de panel.js', typeof parse === 'function');

if (parse && MR.historialPorDorsal) {
    const S = estadoDePrueba();
    S.sucesos = [
        { id: 'a', tipo: 'gol',      minuto: 12, dorsal: '9',  dorsalEntra: '' },
        { id: 'b', tipo: 'amarilla', minuto: 33, dorsal: '7',  dorsalEntra: '' },
        { id: 'c', tipo: 'cambio',   minuto: 60, dorsal: '9',  dorsalEntra: '14' },
        { id: 'd', tipo: 'lesion',   minuto: 75, dorsal: '14', dorsalEntra: '' },
        { id: 'e', tipo: 'roja',     minuto: 80, dorsal: '7',  dorsalEntra: '' },
    ];
    const H = MR.historialPorDorsal(S);
    const tipos = (d) => parse(H[d] || []).map(e => e.type);
    const evs   = (d) => parse(H[d] || []);

    ok('2b · el gol se reconoce como "goal"',           tipos('9').indexOf('goal') !== -1, JSON.stringify(tipos('9')));
    ok('2c · la amarilla como "yellow"',                tipos('7').indexOf('yellow') !== -1, JSON.stringify(tipos('7')));
    ok('2d · la roja como "red"',                       tipos('7').indexOf('red') !== -1, JSON.stringify(tipos('7')));
    ok('2e · la lesión como "injury"',                  tipos('14').indexOf('injury') !== -1, JSON.stringify(tipos('14')));
    // 🔑🔑 LOS DOS QUE SOSTIENEN EL GANTT. Si el cambio no se reconoce, la
    //      barra de minutos del informe sale entera para todos.
    ok('2f · 🔑 la salida del cambio como "sub_out"',   tipos('9').indexOf('sub_out') !== -1, JSON.stringify(tipos('9')));
    ok('2g · 🔑 la entrada del cambio como "sub_in"',   tipos('14').indexOf('sub_in') !== -1, JSON.stringify(tipos('14')));

    const salida9 = evs('9').filter(e => e.type === 'sub_out')[0] || {};
    const entra14 = evs('14').filter(e => e.type === 'sub_in')[0] || {};
    ok('2h · el minuto viaja bien (60)', salida9.minute === 60 && entra14.minute === 60,
       'sale=' + salida9.minute + ' entra=' + entra14.minute);
    // El emparejado exacto de dos cambios en el mismo minuto depende del
    // #subId compartido: sin él, report-engine cae al fallback por proximidad
    // y puede emparejar al jugador equivocado.
    ok('2i · 🔑 salida y entrada comparten subId',
       !!salida9.subId && salida9.subId === entra14.subId,
       'sale=' + salida9.subId + ' entra=' + entra14.subId);

    // 🔴 LA MARCA RETRO. Es lo que hace que el informe distinga en pantalla lo
    //    medido de lo recordado (report-engine, RETRO_COLOR).
    ok('2j · 🔴 todos los sucesos quedan marcados como retroactivos',
       evs('9').every(e => e.retro === true) && evs('7').every(e => e.retro === true));

    // 🚨🚨 LA TRAMPA DE LAS ETIQUETAS DE FASE. «(DESCANSO)» y «(FIN)» hacen que
    //      report-engine DESCARTE el apunte como contabilidad automática. Un
    //      cambio real etiquetado así desaparecería del informe sin ni un error.
    const todas = Object.keys(H).reduce((a, d) => a.concat(H[d]), []);
    ok('2k · 🚨 ninguna nota contiene «(DESCANSO)» ni «(FIN)»',
       !todas.some(t => /\((?:DESCANSO|FIN)\)/i.test(t)),
       todas.filter(t => /\((?:DESCANSO|FIN)\)/i.test(t)).join(' | '));
    ok('2l · 🚨 ningún apunte queda marcado como fase automática',
       Object.keys(H).every(d => parse(H[d]).every(e => e.phase !== true)));

    // El minuto se lee con /(\d{1,2}):(\d{2})/: un «100:00» daría minuto 0.
    const T = estadoDePrueba();
    T.duracion = 90;
    T.sucesos = [{ id: 'z', tipo: 'gol', minuto: 99, dorsal: '9', dorsalEntra: '' }];
    const alto = parse(MR.historialPorDorsal(T)['9'] || [])[0] || {};
    ok('2m · 🚨 un minuto alto no se lee del revés', alto.minute === 90 || alto.minute === 99,
       'salió ' + alto.minute);

    // Un jugador sin sucesos no tiene historial: es el caso del titular que
    // jugó el partido entero, y report-engine lo resuelve por minutesPlayed.
    ok('2n · el titular sin sucesos no lleva historial', !H['1'] || H['1'].length === 0);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · 🔑 el acumulado de temporada, con la función REAL ──');
// ════════════════════════════════════════════════════════════════════
//  Se carga `ctAccumulatePlayerStats` de category-tree.js —la MISMA que pinta
//  la tabla de «Mis Informes» y la del Panel de Dirección— y se le dan los
//  documentos que el formulario escribiría. Es la comprobación que pidió el
//  autor: que el informe retroactivo alimente el resumen «con total precisión».

let acumular = null;
try {
    const ctx = {
        window: {}, console, Math, JSON, Number, String, Array, Object, Map, Set,
        parseInt, parseFloat, isFinite, Date, RegExp, Boolean, Error,
        document: { getElementById: () => null },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(leer(F_TREE), ctx, { filename: 'category-tree.js' });
    acumular = ctx.window.ctAccumulatePlayerStats;
} catch (e) { /* se reporta abajo */ }

ok('3a · se pudo cargar ctAccumulatePlayerStats (la función real)', typeof acumular === 'function');

if (acumular && parse && MR.historialPorDorsal && MR.calcularMinutos) {
    const S = estadoDePrueba();
    S.sucesos = [
        { id: 'a', tipo: 'gol',      minuto: 12, dorsal: '9',  dorsalEntra: '' },
        { id: 'b', tipo: 'gol',      minuto: 40, dorsal: '9',  dorsalEntra: '' },
        { id: 'c', tipo: 'amarilla', minuto: 33, dorsal: '7',  dorsalEntra: '' },
        { id: 'd', tipo: 'cambio',   minuto: 60, dorsal: '9',  dorsalEntra: '14' },
        { id: 'e', tipo: 'lesion',   minuto: 75, dorsal: '14', dorsalEntra: '' },
    ];

    // Se construyen los documentos EXACTAMENTE como los escribe el guardado:
    // uno por CONVOCADO, con wasStarter explícito y minutesPlayed en MM:SS.
    const H = MR.historialPorDorsal(S);
    const min = MR.minutosFinales(S);
    const res = MR.resumenPorDorsal(S);
    const players = S.jugadores.filter(j => S.conv[j.dorsal]).map(j => ({
        playerNumber: j.dorsal,
        playerAlias: j.alias,
        goals: (res[j.dorsal] || {}).goles || 0,
        cards: MR.cards(res[j.dorsal]),
        injured: (res[j.dorsal] || {}).lesion === true,
        minutesPlayed: MR.mmss(min[j.dorsal] || 0),
        wasStarter: !!S.tit[j.dorsal],
        history: parse(H[j.dorsal] || []),
    }));

    const filas = acumular([{ players }]);
    const de = (n) => filas.filter(f => f.number === n)[0] || {};

    // 🔑 CONV. CUENTA CONVOCATORIAS, NO PARTIDOS JUGADOS. El 20 se quedó en el
    //    banquillo: suma convocatoria y NO suma partido.
    ok('3b · 🔑 los 5 convocados aparecen en la tabla', filas.length === 5, 'salieron ' + filas.length);
    ok('3c · 🔑 el que no jugó suma convocatoria…', de('20').called === 1, 'called=' + de('20').called);
    ok('3d · …pero NO suma partido jugado',          de('20').pj === 0, 'pj=' + de('20').pj);
    ok('3e · …ni titularidad',                       de('20').pt === 0, 'pt=' + de('20').pt);

    // 🔑 PT SALE DE `wasStarter`, LA MARCA EXPLÍCITA. Sin ella, la deducción
    //    «sin transiciones = empezó» daría titular a todo el que jugara.
    ok('3f · 🔑 el titular suma PT',                 de('7').pt === 1, 'pt=' + de('7').pt);
    ok('3g · 🔑 el suplente que entró NO suma PT',   de('14').pt === 0, 'pt=' + de('14').pt);
    ok('3h · pero sí suma partido jugado',           de('14').pj === 1, 'pj=' + de('14').pj);

    ok('3i · los goles llegan al acumulado',         de('9').goals === 2, 'goles=' + de('9').goals);
    // Las amarillas NO salen de `cards`: se cuentan del historial. Es el
    // camino que obliga a que el historial esté bien escrito.
    ok('3j · 🔑 la amarilla se cuenta desde el historial', de('7').yellow === 1, 'amarillas=' + de('7').yellow);
    ok('3k · la lesión se cuenta',                   de('14').injuries === 1, 'lesiones=' + de('14').injuries);
    ok('3l · los minutos llegan enteros',            de('7').minutes === 90, 'minutos=' + de('7').minutes);
    ok('3m · y los del sustituido, cortados',        de('9').minutes === 60, 'minutos=' + de('9').minutes);
    ok('3n · y los del que entró',                   de('14').minutes === 30, 'minutos=' + de('14').minutes);

    // La roja SÍ sale de `cards`.
    const R = estadoDePrueba();
    R.sucesos = [{ id: 'r', tipo: 'roja', minuto: 30, dorsal: '7', dorsalEntra: '' }];
    const HR = MR.historialPorDorsal(R), minR = MR.minutosFinales(R), resR = MR.resumenPorDorsal(R);
    const playersR = R.jugadores.filter(j => R.conv[j.dorsal]).map(j => ({
        playerNumber: j.dorsal, playerAlias: j.alias,
        goals: 0, cards: MR.cards(resR[j.dorsal]),
        injured: false, minutesPlayed: MR.mmss(minR[j.dorsal] || 0),
        wasStarter: !!R.tit[j.dorsal], history: parse(HR[j.dorsal] || []),
    }));
    const filasR = acumular([{ players: playersR }]);
    const siete = filasR.filter(f => f.number === '7')[0] || {};
    ok('3o · la roja llega al acumulado',            siete.red === 1, 'rojas=' + siete.red);
    ok('3p · 🔑 y el expulsado conserva su PT',      siete.pt === 1, 'pt=' + siete.pt);
    ok('3q · con los minutos recortados',            siete.minutes === 30, 'minutos=' + siete.minutes);
}

// ── El formulario no deja guardar sin convocatoria ni sin titulares ──
if (MR.problemas && MR.estadoNuevo) {
    const S = estadoDePrueba();
    S.manual = { fecha: '2026-09-01', rival: 'CD Rival', local: true, jornada: '3', hora: '', sede: '' };
    S.sel = -1;
    win._mrState = S;

    const conTodo = MR.problemas();
    ok('3r · con convocatoria y titulares completos, deja guardar', conTodo.length === 0, conTodo.join(' | '));

    const sinTit = estadoDePrueba();
    sinTit.manual = S.manual; sinTit.sel = -1; sinTit.tit = {};
    win._mrState = sinTit;
    // 🔑 `wasStarter:false` para todos NO es un hueco: es una afirmación, y la
    //    temporada registraría 0 titularidades en este partido para siempre.
    ok('3s · 🔑 sin ningún titular NO deja guardar', MR.problemas().length > 0);

    const sinConv = estadoDePrueba();
    sinConv.manual = S.manual; sinConv.sel = -1; sinConv.conv = {}; sinConv.tit = {};
    win._mrState = sinConv;
    ok('3t · sin ningún convocado NO deja guardar', MR.problemas().length > 0);

    const sinRival = estadoDePrueba();
    sinRival.sel = -1;
    sinRival.manual = { fecha: '2026-09-01', rival: '', local: true, jornada: '', hora: '', sede: '' };
    win._mrState = sinRival;
    ok('3u · sin rival NO deja guardar', MR.problemas().length > 0);

    const cambioCojo = estadoDePrueba();
    cambioCojo.sel = -1; cambioCojo.manual = S.manual;
    cambioCojo.sucesos = [{ id: 'c', tipo: 'cambio', minuto: 50, dorsal: '9', dorsalEntra: '' }];
    win._mrState = cambioCojo;
    ok('3v · un cambio sin quien entra NO deja guardar', MR.problemas().length > 0);

    // Titulares esperados por modalidad, DERIVADOS de la categoría (el
    // resolutor se inyectó arriba, con el resto de reglas globales).
    win._mrState = estadoDePrueba();
    ok('3w · en juvenil se esperan 11 titulares', MR.titularesEsperados() === 11);
    const alevin = estadoDePrueba();
    alevin.equipo = { clubId: 'C', category: 'alevin', subcategory: 'B', teamId: 't' };
    win._mrState = alevin;
    ok('3x · en alevín se esperan 7',             MR.titularesEsperados() === 7);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 9 · 🔀 el tipo de partido manda sobre el bloque 1 ──');
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-09-02): el TIPO se pregunta lo
//  primero y el resto del bloque reacciona.
//    🏆 LIGA     → desplegable del calendario oficial; elegirlo AUTOCOMPLETA
//                  rival, jornada, fecha y localía.
//    🏅 COPA     → sin desplegable; campos a mano; cupo de competición oficial.
//    🤝 AMISTOSO → sin desplegable; campos a mano; convocatoria abierta.

if (MR.estadoNuevo && MR.partidoElegido && cargoElModulo) {
    const conCalendario = (tipo) => {
        const S = MR.estadoNuevo();
        S.equipo = { clubId: 'C', category: 'alevin', subcategory: 'A', teamId: 't' };
        S.tipoPartido = tipo;
        S.partidos = [
            { fecha: '2026-08-30', jornada: 2, hora: '10:00', rival: 'CD Uno',  local: true,  sede: 'Campo A' },
            { fecha: '2026-09-06', jornada: 3, hora: '12:00', rival: 'CD Dos',  local: false, sede: 'Campo B' },
        ];
        win._mrState = S;
        return S;
    };

    // 🔑 LO QUE PIDIÓ: elegir del calendario AUTOCOMPLETA los cuatro campos.
    const S = conCalendario('liga');
    win._mrElegirPartido('1');
    let p = MR.partidoElegido(win._mrState);
    ok('9a · 🔑 elegir del calendario autocompleta el RIVAL',   p.rival === 'CD Dos', p.rival);
    ok('9b · 🔑 …la FECHA',                                     p.fecha === '2026-09-06', p.fecha);
    ok('9c · 🔑 …la JORNADA',                                   String(p.jornada) === '3', p.jornada);
    ok('9d · 🔑 …y la LOCALÍA',                                 p.local === false, String(p.local));

    // ⚠️ Y queda EDITABLE: corregir un dato del calendario tiene que valer.
    win._mrCampoManual('rival', 'CD Corregido');
    ok('9e · ⚠️ lo autocompletado se puede corregir',
       MR.partidoElegido(win._mrState).rival === 'CD Corregido');
    // 🔑 Y lo corregido es lo que se guarda: una sola fuente de verdad.
    ok('9f · 🔑 manda lo que hay en las casillas, no la fila del calendario',
       win._mrState.partidos[1].rival === 'CD Dos' &&
       MR.partidoElegido(win._mrState).rival === 'CD Corregido');

    // Cambiar a otro partido vuelve a rellenar.
    win._mrElegirPartido('0');
    p = MR.partidoElegido(win._mrState);
    ok('9g · elegir otro partido vuelve a rellenar', p.rival === 'CD Uno' && p.local === true);

    // «Otro partido (a mano)» NO borra lo escrito.
    win._mrElegirPartido('-1');
    ok('9h · ⚠️ «otro partido» conserva lo ya escrito (no castiga el cambio de idea)',
       MR.partidoElegido(win._mrState).rival === 'CD Uno' && win._mrState.sel === -1);

    // ── Copa y amistoso: sin calendario ──────────────────────────────
    conCalendario('liga');
    win._mrTipoPartido('copa');
    ok('9i · 🏅 copa: se suelta la fila del calendario', win._mrState.sel === -1);
    ok('9j · 🏅 y se retira la jornada (una copa va por rondas)',
       win._mrState.manual.jornada === '');
    ok('9k · 🏅 pero la copa MANTIENE el cupo de competición oficial',
       MR.cupo().maxConvocados === 14 && MR.cupo().maxTitulares === 7,
       JSON.stringify(MR.cupo()));

    conCalendario('liga');
    win._mrTipoPartido('amistoso');
    ok('9l · 🤝 amistoso: convocatoria abierta', MR.cupo().maxConvocados === null);
    ok('9m · 🤝 y el tope de titulares se mantiene', MR.cupo().maxTitulares === 7);

    // Un valor desconocido cae a liga, que es el estricto.
    conCalendario('liga');
    win._mrTipoPartido('lo-que-sea');
    ok('9n · ⚠️ un tipo desconocido cae a LIGA, el estricto',
       win._mrState.tipoPartido === 'liga' && MR.cupo().maxConvocados === 14);

    // Y al volver a liga sin calendario, el formulario no se queda inservible.
    const SinCal = MR.estadoNuevo();
    SinCal.equipo = { clubId: 'C', category: 'alevin', subcategory: 'A', teamId: 't' };
    SinCal.partidos = [];
    win._mrState = SinCal;
    ok('9o · ⚠️ liga SIN calendario importado no ofrece desplegable…',
       MR.usaCalendario() === false);
    ok('9p · …pero sigue habiendo campos a mano', typeof MR.partidoElegido(SinCal).rival === 'string');
}

// ── 🔴 v665 · EL FORMULARIO ABRE SOBRE EL CALENDARIO, NO EN «a mano» ─
//  Medido contra PRODUCCIÓN el 2026-09-02: el calendario real del Alevín C del
//  CD DÍA tiene 30 jornadas y la PRIMERA es el 12 de septiembre. La
//  preselección sólo miraba partidos con fecha <= hoy, así que a principio de
//  temporada no elegía ninguno: el desplegable nacía en «✍️ Otro partido (a
//  mano)», con la fecha de hoy y el rival vacío — indistinguible de «no hay
//  calendario importado», que es como lo vio el autor.
//
//  🔑 Las jornadas SIEMPRE estuvieron en la lista. Lo que fallaba era por cuál
//     se abría. Por eso las aserciones miran LA OPCIÓN SELECCIONADA, no si la
//     lista tiene elementos: eso último ya pasaba con el defecto puesto.
ok('9·-1 · el módulo expone la preselección real para poder ejecutarla',
   cargoElModulo && typeof MR.preseleccion === 'function',
   'sin ella el guard tendría que reimplementarla, que es como se pone verde con el defecto puesto');

if (MR.estadoNuevo && MR.aplicarDelCalendario && MR.pintarPartido && MR.preseleccion && cargoElModulo) {
    const els0 = {};
    const nodo0 = (id) => (els0[id] || (els0[id] = { id, innerHTML: '', value: '', style: {}, dataset: {} }));
    const docReal0 = sandbox.document;
    sandbox.document = { getElementById: nodo0, activeElement: null };

    // Las tres primeras jornadas REALES de producción (REST, 2026-09-02).
    const REALES = [
        { fecha: '2026-09-12', jornada: 1, hora: '11:00', rival: 'Maspalomas',   local: true,  sede: 'Cru. Arinaga' },
        { fecha: '2026-09-18', jornada: 2, hora: '21:00', rival: 'AD Huracán B', local: false, sede: 'Pepe Gonçalvez' },
        { fecha: '2026-09-26', jornada: 3, hora: '11:00', rival: 'San Fernando', local: true,  sede: 'Cru. Arinaga' },
    ];

    // 🔑 SE EJECUTA LA PRESELECCIÓN DEL PRODUCTO (`_mrPreseleccion`), no una
    //    copia escrita aquí: un test que reimplementa la regla que vigila se
    //    pone verde con el defecto puesto (v620).
    const abrir = (partidos, hoy) => {
        const S = MR.estadoNuevo();
        S.equipo = { clubId: 'club_mqvr9m11_g9kj', category: 'alevin', subcategory: 'C',
                     teamId: 'club-mqvr9m11-g9kj__alevin__c' };
        S.partidos = partidos;
        win._mrState = S;
        const elegido = MR.preseleccion(partidos, hoy);
        if (elegido >= 0) MR.aplicarDelCalendario(elegido);
        MR.pintarPartido();
        return nodo0('mr-partido').innerHTML;
    };
    const valor = (h, id) => (h.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"')) || ['', ''])[1];

    // 🚨 SU CASO REAL: temporada que aún no ha empezado.
    const h = abrir(REALES, '2026-09-02');
    ok('9·1 · 🚨 sin partidos pasados, NO abre en «otro partido (a mano)»',
       !/<option value="-1" selected/.test(h),
       'abría en la opción manual y parecía que no había calendario');
    ok('9·2 · 🔑 abre sobre el PRIMERO de la temporada', /<option value="0" selected/.test(h));
    ok('9·3 · con el rival ya puesto',   valor(h, 'mr-rival') === 'Maspalomas', valor(h, 'mr-rival'));
    ok('9·4 · la fecha del partido, no la de hoy', valor(h, 'mr-fecha') === '2026-09-12', valor(h, 'mr-fecha'));
    ok('9·5 · y la jornada',             valor(h, 'mr-jornada') === '1', valor(h, 'mr-jornada'));

    // Con partidos ya jugados manda el ÚLTIMO jugado, que es el que se registra.
    const conPasados = [{ fecha: '2026-08-20', jornada: 0, hora: '11:00', rival: 'Amistoso Viejo',
                          local: true, sede: 'X' }].concat(REALES);
    const h2 = abrir(conPasados, '2026-09-02');
    ok('9·6 · con partidos jugados abre sobre el ÚLTIMO jugado',
       valor(h2, 'mr-fecha') === '2026-08-20', valor(h2, 'mr-fecha'));

    // 📅 La cuenta visible: sin ella, un desplegable cerrado sobre la opción
    //    manual es indistinguible de «no hay calendario».
    ok('9·7 · 📅 se dice cuántos partidos trae el calendario',
       /3 partidos<\/strong>/.test(h), 'no aparece el recuento');

    // 🏠/✈️ · «en casa de Maspalomas» se leía como si jugara el rival en su casa.
    ok('9·8 · la localía se marca con 🏠 y ✈️, sin frases ambiguas',
       /🏠 Maspalomas/.test(h) && /✈️ AD Huracán B/.test(h) && h.indexOf('en casa de') === -1);

    // La opción manual SIGUE estando: «únicamente si se desea».
    ok('9·9 · la opción manual sigue disponible', /value="-1"/.test(h));

    sandbox.document = docReal0;
}

// ── Y ahora el BLOQUE PINTADO DE VERDAD ─────────────────────────────
//  🔑 Se mide el HTML que sale, no el fichero fuente: las opciones del
//     desplegable se CONSTRUYEN, así que buscar `value="copa"` en el código
//     daría rojo en falso aunque la opción exista en pantalla (pasó al
//     escribir este guard).
ok('9·0 · el módulo expone el pintado del bloque del partido',
   cargoElModulo && typeof MR.pintarPartido === 'function',
   'sin él las aserciones de marcado NO SE EJECUTAN');

if (MR.pintarPartido && MR.estadoNuevo) {
    const els = {};
    const nodo = (id) => (els[id] || (els[id] = { id, innerHTML: '', value: '', style: {}, dataset: {} }));
    const docReal = sandbox.document;
    sandbox.document = { getElementById: nodo, activeElement: null };

    const pinta = (tipo, conCal) => {
        const S = MR.estadoNuevo();
        S.equipo = { clubId: 'C', category: 'alevin', subcategory: 'A', teamId: 't' };
        S.tipoPartido = tipo;
        S.partidos = conCal
            ? [{ fecha: '2026-08-30', jornada: 2, hora: '10:00', rival: 'CD Uno', local: true, sede: 'Campo A' }]
            : [];
        win._mrState = S;
        MR.pintarPartido();
        return nodo('mr-partido').innerHTML;
    };

    const hLiga = pinta('liga', true);
    const posTipo = hLiga.indexOf('mr-tipo');
    const posCal  = hLiga.indexOf('mr-sel-partido');
    const posGF   = hLiga.indexOf('mr-gf');

    ok('9q · presencia: el bloque pinta el tipo, el calendario y el marcador',
       posTipo !== -1 && posCal !== -1 && posGF !== -1,
       'tipo=' + posTipo + ' cal=' + posCal + ' marcador=' + posGF);
    // 🔑 LO QUE PIDIÓ TEXTUALMENTE: «lo primero que se pregunte, arriba del todo».
    ok('9r · 🔑 el TIPO se pinta ANTES que el desplegable del calendario', posTipo < posCal);
    ok('9s · 🔑 y antes que el marcador',                                  posTipo < posGF);
    ok('9t · 🏅 las TRES opciones están en el desplegable de tipo',
       /value="liga"/.test(hLiga) && /value="copa"/.test(hLiga) && /value="amistoso"/.test(hLiga));
    ok('9u · 🏆 en liga con calendario se pinta la jornada',
       hLiga.indexOf('mr-jornada') !== -1);

    // 🏅 y 🤝: sin desplegable de calendario, y sin jornada.
    const hCopa = pinta('copa', true);
    ok('9v · 🏅 en copa NO se pinta el desplegable del calendario',
       hCopa.indexOf('mr-sel-partido') === -1);
    ok('9w · 🏅 ni la jornada',            hCopa.indexOf('mr-jornada') === -1);
    ok('9x · 🏅 pero sí el rival y la fecha a mano',
       hCopa.indexOf('mr-rival') !== -1 && hCopa.indexOf('mr-fecha') !== -1 &&
       hCopa.indexOf('mr-donde') !== -1);

    const hAmis = pinta('amistoso', true);
    ok('9y · 🤝 en amistoso tampoco hay calendario, y sí campos a mano',
       hAmis.indexOf('mr-sel-partido') === -1 && hAmis.indexOf('mr-rival') !== -1);

    // ⚠️ Liga SIN calendario: no puede quedarse sin formulario.
    const hSinCal = pinta('liga', false);
    ok('9z · ⚠️ liga sin calendario: aviso y campos a mano, nunca pantalla muerta',
       hSinCal.indexOf('mr-sel-partido') === -1 && hSinCal.indexOf('mr-rival') !== -1 &&
       /no tiene calendario oficial importado/.test(hSinCal));

    sandbox.document = docReal;
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 8 · ⚖️ el marcador no puede contradecir a los goleadores ──');
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-09-02): impedir la inversión local/visitante. Si
//  sus jugadores anotan 6 goles, el marcador no puede darle 5 al equipo y 6 al
//  rival.
//
//  🔑 LA ASIMETRÍA ES EL CORAZÓN DE ESTO, y por eso hay aserciones en los dos
//     sentidos: más goleadores que goles es IMPOSIBLE y bloquea; menos es
//     LEGÍTIMO (un gol en propia puerta del rival cuenta para nosotros y no
//     tiene goleador nuestro) y sólo avisa. Un guard que sólo mirase el primer
//     caso dejaría pasar un bloqueo que impediría registrar partidos reales.

ok('8·0 · el módulo expone la comprobación de congruencia',
   cargoElModulo && typeof MR.congruencia === 'function',
   'sin ella las aserciones de esta parte NO SE EJECUTAN');

if (MR.congruencia && MR.problemas) {
    // El estado del partido de su captura: CD DÍA vs vecindario, 6 goleadores.
    const conGoles = (propios, rival, nGoles) => {
        const S = MR.estadoNuevo();
        S.equipo = { clubId: 'C', category: 'alevin', subcategory: 'A', teamId: 't' };
        S.sel = -1;
        S.manual = { fecha: '2026-09-02', rival: 'vecindario', local: true, jornada: '3', hora: '', sede: '' };
        S.jugadores = [];
        for (let n = 1; n <= 14; n++) {
            S.jugadores.push({ ficha: 'F' + n, dorsal: String(n), nombre: 'Jugador ' + n, alias: 'J' + n });
            S.conv[String(n)] = true;
        }
        for (let n = 1; n <= 7; n++) S.tit[String(n)] = true;
        S.golesPropios = propios;
        S.golesRival = rival;
        S.sucesos = [];
        for (let i = 0; i < nGoles; i++) {
            S.sucesos.push({ id: 'g' + i, tipo: 'gol', minuto: 10 + i, dorsal: String(i + 1), dorsalEntra: '' });
        }
        win._mrState = S;
        return S;
    };
    const hayCongruencia = (probs) => probs.some(t => /goles anotados en los sucesos/.test(t));

    // ⛔ EL CASO DEL ENCARGO: 6 goleadores, marcador 5-6 (tecleado al revés).
    conGoles(5, 6, 6);
    let g = MR.congruencia();
    ok('8a · detecta que sobran goleadores',  g.sobran === 1, 'sobran=' + g.sobran);
    ok('8b · 🔄 y reconoce la firma del marcador AL REVÉS', g.invertido === true);
    ok('8c · ⛔ NO deja guardar', hayCongruencia(MR.problemas()), MR.problemas().join(' | '));
    ok('8d · el aviso dice que parece invertido',
       MR.problemas().some(t => /AL REV[ÉE]S/.test(t)), MR.problemas().join(' | '));

    // 🔄 Y al invertirlo, queda congruente y deja guardar.
    win._mrInvertirMarcador();
    const S2 = win._mrState;
    ok('8e · 🔄 invertir el marcador intercambia los dos valores',
       S2.golesPropios === 6 && S2.golesRival === 5,
       S2.golesPropios + '-' + S2.golesRival);
    ok('8f · y entonces SÍ deja guardar', MR.problemas().length === 0, MR.problemas().join(' | '));

    // ⛔ Sobran goleadores SIN que sea una inversión (6 goleadores, 5-2).
    conGoles(5, 2, 6);
    g = MR.congruencia();
    ok('8g · ⛔ más goleadores que goles bloquea aunque no sea inversión',
       g.sobran === 1 && g.invertido === false && hayCongruencia(MR.problemas()));
    ok('8h · …y ahí NO se ofrece invertir (sería adivinar)',
       !MR.problemas().some(t => /AL REV[ÉE]S/.test(t)));

    // ⚠️ MENOS GOLEADORES QUE GOLES: legítimo, NO puede bloquear.
    conGoles(6, 5, 4);
    g = MR.congruencia();
    ok('8i · ⚠️ 🔑 goles sin goleador anotado NO bloquean (gol en propia del rival)',
       g.sinAnotar === 2 && g.sobran === 0 && !hayCongruencia(MR.problemas()),
       MR.problemas().join(' | '));

    // ✅ Cuadrado: ni alarma ni aviso.
    conGoles(6, 5, 6);
    g = MR.congruencia();
    ok('8j · ✅ cuadrado: sin alarma y sin aviso',
       g.sobran === 0 && g.sinAnotar === 0 && MR.problemas().length === 0);

    // Un 0-0 sin goles tampoco puede dar alarma.
    conGoles(0, 0, 0);
    ok('8k · un 0-0 sin goles no dispara nada',
       MR.congruencia().sobran === 0 && MR.problemas().length === 0);

    // ⚠️ Un gol SIN jugador asignado no cuenta como goleador: si contara,
    //    añadir la fila y no haber elegido aún el jugador daría alarma falsa.
    const S3 = conGoles(1, 0, 0);
    S3.sucesos = [{ id: 'x', tipo: 'gol', minuto: 5, dorsal: '', dorsalEntra: '' }];
    win._mrState = S3;
    ok('8l · ⚠️ un gol a medio rellenar no cuenta como goleador',
       MR.congruencia().enSucesos === 0);

    // Las tarjetas y los cambios no son goles.
    const S4 = conGoles(0, 0, 0);
    S4.sucesos = [
        { id: 'a', tipo: 'amarilla', minuto: 5, dorsal: '1', dorsalEntra: '' },
        { id: 'c', tipo: 'cambio',   minuto: 6, dorsal: '1', dorsalEntra: '8' },
        { id: 'l', tipo: 'lesion',   minuto: 7, dorsal: '2', dorsalEntra: '' },
    ];
    win._mrState = S4;
    ok('8m · sólo cuentan los goles, no las tarjetas ni los cambios',
       MR.congruencia().enSucesos === 0);
}

// El panel y su botón de corrección tienen que existir en el marcado.
{
    const src = leer(F_MANUAL);
    ok('8n · hay panel de alarma en ROJO para la incongruencia',
       /El marcador contradice a los goleadores/.test(src) && /255,88,88/.test(src));
    ok('8o · 🔄 y botón para invertir el marcador',
       /_mrInvertirMarcador\(\)/.test(src) && /window\._mrInvertirMarcador\s*=/.test(src));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 7 · 🔴 cada fila de sucesos, independiente de las demás ──');
// ════════════════════════════════════════════════════════════════════
//  EL FALLO QUE ESTO IMPIDE (reportado con capturas el 2026-09-02): al añadir
//  un segundo suceso y tocar su minuto, «los valores se interfieren y el
//  minuto del primero se autoincrementa».
//
//  🔑 EL MAPEO POR `id` NUNCA ESTUVO MAL. Lo que engañaba era la PANTALLA:
//   1. la lista se pintaba ORDENADA POR MINUTO mientras el estado guardaba el
//      orden de alta, así que al escribir un minuto la fila SE MOVÍA de sitio;
//   2. cada cambio de minuto REPINTABA la lista entera y destruía el <input>
//      que se estaba usando (con las flechas del selector numérico, que
//      disparan `change` en cada clic, el campo desaparecía a mitad del gesto).
//
//  ⚠️ ESTO NO SE PUEDE MEDIR CON UNA REGEX: se pinta de verdad contra un DOM
//     de juguete y se cuenta cuántas veces se repinta.

// 🔑 PRESENCIA ANTES QUE AUSENCIA. Sin esto, quitar `pintarSucesos` de
//    `_mrInterno` haría que TODO este bloque se saltara en silencio y el guard
//    seguiría en verde con el defecto puesto (la forma de verde falso que ya
//    costó dos rondas).
ok('7·0 · el módulo expone el pintado de sucesos para poder medirlo',
   cargoElModulo && typeof MR.pintarSucesos === 'function',
   'sin él las 12 aserciones de esta parte NO SE EJECUTAN');

if (MR.pintarSucesos && MR.estadoNuevo && cargoElModulo) {
    // DOM de juguete: cada elemento cuenta las veces que le reescriben el HTML.
    const els = {};
    const nodo = (id) => {
        if (!els[id]) {
            els[id] = { id: id, _html: '', escrituras: 0, value: '', style: {}, dataset: {} };
            Object.defineProperty(els[id], 'innerHTML', {
                get() { return this._html; },
                set(v) { this._html = v; this.escrituras++; },
            });
        }
        return els[id];
    };
    const docReal = sandbox.document;
    sandbox.document = { getElementById: nodo, activeElement: null };

    const S = MR.estadoNuevo();
    S.equipo = { clubId: 'C', category: 'alevin', subcategory: 'A', teamId: 't' };
    S.jugadores = [
        { ficha: 'F5', dorsal: '5', nombre: 'Dani', alias: 'DANI' },
        { ficha: 'F6', dorsal: '6', nombre: 'Iván', alias: 'IVÁN' },
    ];
    S.conv['5'] = true; S.conv['6'] = true; S.tit['5'] = true;
    // A se añade PRIMERO pero con minuto MAYOR: si la lista se ordenara por
    // minuto, B saldría delante. Es exactamente la pareja de sus capturas.
    S.sucesos = [
        { id: 'A', tipo: 'gol', minuto: 5, dorsal: '6', dorsalEntra: '' },
        { id: 'B', tipo: 'gol', minuto: 1, dorsal: '5', dorsalEntra: '' },
    ];
    win._mrState = S;

    MR.pintarSucesos();
    const html = nodo('mr-sucesos').innerHTML;
    const posA = html.indexOf("'A','minuto'");
    const posB = html.indexOf("'B','minuto'");

    ok('7a · las dos filas se pintan, cada una con su propio id',
       posA !== -1 && posB !== -1, 'A=' + posA + ' B=' + posB);
    // 🚨 LA ASERCIÓN DEL FALLO. Con el `.sort()` por minuto esto era FALSO.
    ok('7b · 🚨 el orden es el de ALTA, no el del minuto',
       posA !== -1 && posB !== -1 && posA < posB,
       'la fila añadida primero (minuto 5) tiene que salir antes que la del minuto 1');

    // Cada input lleva SU valor, no el del vecino.
    ok('7c · cada fila pinta su propio minuto',
       /value="5"[^>]*_mrSuceso\('A','minuto'/.test(html.replace(/\s+/g, ' ')) ||
       html.indexOf('value="5"') < posA + 400,
       'el minuto 5 tiene que ir en la fila A');

    // 🔑🔑 LO QUE MÁS IMPORTA: escribir un minuto NO puede repintar la lista.
    const antes = nodo('mr-sucesos').escrituras;
    win._mrSuceso('B', 'minuto', '3');
    ok('7d · 🔑🔑 cambiar un minuto NO repinta la lista (no destruye el input)',
       nodo('mr-sucesos').escrituras === antes,
       'se repintó ' + (nodo('mr-sucesos').escrituras - antes) + ' vez/veces');
    ok('7e · …pero el estado sí se actualiza', S.sucesos.filter(s => s.id === 'B')[0].minuto === 3);
    ok('7f · …y no toca al otro suceso',       S.sucesos.filter(s => s.id === 'A')[0].minuto === 5);

    // Cambiar el TIPO sí tiene que repintar: la fila cambia de forma (un
    // «cambio» necesita el segundo desplegable, «Entra»).
    const antes2 = nodo('mr-sucesos').escrituras;
    win._mrSuceso('A', 'tipo', 'cambio');
    ok('7g · cambiar el TIPO sí repinta (la fila cambia de forma)',
       nodo('mr-sucesos').escrituras > antes2);
    ok('7h · y aparece el desplegable de quién entra',
       nodo('mr-sucesos').innerHTML.indexOf("'A','dorsalEntra'") !== -1);

    // Y el orden sigue siendo el de alta tras repintar.
    const html2 = nodo('mr-sucesos').innerHTML;
    ok('7i · 🚨 tras repintar, el orden de alta se mantiene',
       html2.indexOf("'A','minuto'") < html2.indexOf("'B','minuto'"));

    // ⚠️ La rueda del ratón sobre un número CON FOCO cambia el valor.
    ok('7j · ⚠️ los minutos sueltan el foco al girar la rueda',
       /onwheel="this\.blur\(\)"/.test(html2));

    sandbox.document = docReal;
}

// Y no sólo los de sucesos: TODOS los campos numéricos del formulario.
// 🚨 Se cuentan las dos cosas y se comparan. Buscar «hay algún onwheel» daría
//    verde en falso con uno solo puesto — que es la forma de verde falso que ya
//    se pagó en v651.
{
    const src = leer(F_MANUAL);
    const numericos = (src.match(/type=\\?"number\\?"/g) || []).length;
    const conRueda  = (src.match(/onwheel="this\.blur\(\)"/g) || []).length;
    ok('7k · presencia: el formulario tiene campos numéricos que medir', numericos > 0,
       'ninguno: la aserción de abajo no valdría nada');
    ok('7l · ⚠️ TODOS sueltan el foco al girar la rueda', conRueda >= numericos,
       numericos + ' campos numéricos y sólo ' + conRueda + ' con `onwheel`');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 6 · 🔴 el informe SALE en la lista de «Mis Informes» ──');
// ════════════════════════════════════════════════════════════════════
//  EL FALLO QUE ESTO IMPIDE (reportado con capturas el 2026-09-02): el informe
//  manual se guardaba bien, alimentaba el acumulado del Panel de Dirección…
//  y NO aparecía en la lista de «Mis Informes».
//
//  🔑 LA CAUSA ERA EL NOMBRE DEL DOCUMENTO. La consulta de esa pantalla es
//     `orderBy('__name__','desc') + limit(500)`, y eso equivale a «los más
//     recientes» SÓLO porque todos los informes se llaman
//     `match_{uid}_{AAAA-MM-DD}_…`. Los primeros ids manuales empezaban por
//     `manual_`, que ordena POR DEBAJO de `match_` ('n' < 't'), así que los
//     miles de `match_*` del club llenaban la ventana y nunca se llegaba a
//     ellos.
//
//  ⚠️ ESTO NO SE PUEDE COMPROBAR CON UNA REGEX. Se EJECUTA el constructor de
//     ids real y se ordena una lista como lo haría Firestore.

if (MR.matchId) {
    const UID = 'UID123';
    const idManual = MR.matchId(UID, '2026-09-02', 'vecindario');

    ok('6a · el id del partido manual empieza por «match_»', /^match_/.test(idManual), idManual);

    // 🚨 LA ASERCIÓN DEL FALLO. Con el prefijo viejo esto era FALSO.
    ok('6b · 🚨 ordena POR ENCIMA de un partido en directo anterior',
       idManual > ('match_' + UID + '_2026-08-31_visitante_1x1'), idManual);
    ok('6c · 🚨 y POR DEBAJO de uno posterior',
       idManual < ('match_' + UID + '_2026-09-03_visitante_1x1'), idManual);
    ok('6d · 🔑 el prefijo antiguo «manual_» SÍ caía por debajo de todo',
       ('manual_' + UID + '_2026-09-02_x') < ('match_' + UID + '_2020-01-01_x'),
       'si esto falla, la premisa del fallo ya no se sostiene y hay que releer el guard');

    // La simulación completa: la ventana de 500 ordenada por nombre DESC.
    // ⚠️ UN PARTIDO NO ES UN DOCUMENTO, SON ~14 (uno por convocado), y eso es
    //    justo lo que hace que la ventana de 500 se llene con unos 35 partidos.
    //    Con un documento por fecha la simulación no llegaba a 500 y el guard
    //    daba verde en falso: el fallo reportado no se reproducía.
    const corpus = [];
    for (let i = 0; i < 240; i++) {
        const d = new Date(2026, 0, 1 + i);
        const f = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                  '-' + String(d.getDate()).padStart(2, '0');
        if (f >= '2026-09-02') continue;
        for (let p = 1; p <= 14; p++) {
            corpus.push('match_' + UID + '_' + f + '_visitante_1x1_coach_p' + p);
        }
    }
    ok('6e0 · la simulación supera de verdad los 500 documentos', corpus.length > 500,
       'sólo ' + corpus.length + ': sin pasar de 500 la ventana no acota y el guard no prueba nada');
    const ventana = (ids) => ids.slice().sort().reverse().slice(0, 500);

    ok('6e · 🔑🔑 con el id nuevo, el informe ENTRA en la ventana de 500',
       ventana(corpus.concat([idManual + '_coach_p7'])).indexOf(idManual + '_coach_p7') !== -1);
    ok('6f · 🚨 y con el viejo se quedaba FUERA (el fallo reportado)',
       ventana(corpus.concat(['manual_' + UID + '_2026-09-02_vecindario_coach_p7']))
           .indexOf('manual_' + UID + '_2026-09-02_vecindario_coach_p7') === -1);

    // Idempotencia: el marcador NO entra en la clave, así que corregir un
    // resultado mal tecleado arregla el informe en vez de duplicarlo.
    ok('6g · el mismo partido da SIEMPRE el mismo id',
       MR.matchId(UID, '2026-09-02', 'vecindario') === idManual);
    ok('6h · rivales distintos dan ids distintos',
       MR.matchId(UID, '2026-09-02', 'otro club') !== idManual);

    // 🔑 Y NO PISA a un partido en directo del mismo día contra el mismo rival.
    ok('6i · 🔑 no colisiona con el id de un partido cronometrado',
       idManual !== ('match_' + UID + '_2026-09-02_vecindario_8x4'));
}

// La pantalla que lo lista tiene que seguir ordenando por nombre DESC: si
// alguien cambiara esa consulta, las aserciones de arriba dejarían de
// significar nada y hay que enterarse.
{
    const iv = leer(F_INDIV);
    ok('6j · ⚠️ «Mis Informes» sigue ordenando por __name__ desc (la premisa)',
       /orderBy\('__name__',\s*'desc'\)/.test(iv));
    ok('6k · ⚠️ y sigue acotando con limit(500)', /limit\(500\)/.test(iv));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · ⚖️ la normativa de competición (Liga / Amistoso) ──');
// ════════════════════════════════════════════════════════════════════
//  LIGA      · F7 14/7  · F11 18/11
//  AMISTOSO  · convocatoria ABIERTA, pero el tope de TITULARES se mantiene.
//
//  🔑 Se carga `cronosCupoConvocatoria` DE utils.js —la definición real— y se
//     ejecuta, en vez de leer los números del fichero del formulario. Si
//     alguien reescribiera la regla aquí en vez de allí, esto lo vería.

ok('5a · la regla vive en utils.js y se pudo ejecutar', typeof cupoReal === 'function');

if (cupoReal) {
    const L7 = cupoReal('f7', 'liga'), L11 = cupoReal('f11', 'liga');
    const A7 = cupoReal('f7', 'amistoso'), A11 = cupoReal('f11', 'amistoso');

    ok('5b · LIGA · F7 → 14 convocados',   L7.maxConvocados === 14, 'salió ' + L7.maxConvocados);
    ok('5c · LIGA · F7 → 7 titulares',     L7.maxTitulares === 7,   'salió ' + L7.maxTitulares);
    ok('5d · LIGA · F11 → 18 convocados',  L11.maxConvocados === 18, 'salió ' + L11.maxConvocados);
    ok('5e · LIGA · F11 → 11 titulares',   L11.maxTitulares === 11,  'salió ' + L11.maxTitulares);

    // 🔑 LO QUE DISTINGUE AL AMISTOSO, Y LO QUE NO.
    ok('5f · 🔑 AMISTOSO · F7 → convocatoria ABIERTA',  A7.maxConvocados === null, 'salió ' + A7.maxConvocados);
    ok('5g · 🔑 AMISTOSO · F11 → convocatoria ABIERTA', A11.maxConvocados === null, 'salió ' + A11.maxConvocados);
    // 🚨 LA MITAD QUE NO SE RELAJA. Si esto se cayera, un amistoso podría
    //    guardarse con 14 titulares y la columna PT de la temporada quedaría
    //    envenenada sin que saltara nada.
    ok('5h · 🚨 AMISTOSO · F7 MANTIENE el tope de 7 titulares',  A7.maxTitulares === 7,  'salió ' + A7.maxTitulares);
    ok('5i · 🚨 AMISTOSO · F11 MANTIENE el tope de 11 titulares', A11.maxTitulares === 11, 'salió ' + A11.maxTitulares);

    // ⚠️ «SIN TOPE» ES null, NO Infinity: obliga a preguntarse si hay tope.
    ok('5j · ⚠️ "sin tope" se expresa con null, no con Infinity',
       A7.maxConvocados === null && A7.maxConvocados !== Infinity);

    // Lo desconocido cae al lado ESTRICTO: un `!dato ||` en algo que autoriza
    // convierte «no sé» en SÍ (lección de v617).
    const X = cupoReal('', '');
    ok('5k · ⚠️ sin datos cae al cupo de LIGA/F7, el estricto',
       X.maxConvocados === 14 && X.maxTitulares === 7,
       JSON.stringify(X));
}

// ── Y ahora, aplicado en el formulario ──────────────────────────────
if (MR.problemas && MR.cupo && cargoElModulo && cupoReal) {
    // Un F7 (alevín) con 15 convocados y 7 titulares.
    const base = () => {
        const S = MR.estadoNuevo();
        S.equipo = { clubId: 'C', category: 'alevin', subcategory: 'A', teamId: 't' };
        S.sel = -1;
        S.manual = { fecha: '2026-09-01', rival: 'CD Rival', local: true, jornada: '3', hora: '', sede: '' };
        S.jugadores = [];
        for (let n = 1; n <= 15; n++) {
            S.jugadores.push({ ficha: 'F' + n, dorsal: String(n), nombre: 'Jugador ' + n, alias: 'J' + n });
        }
        S.jugadores.forEach(j => { S.conv[j.dorsal] = true; });
        for (let n = 1; n <= 7; n++) S.tit[String(n)] = true;
        return S;
    };

    const hayCupoConv = (probs) => probs.some(t => /convocados/.test(t));
    const hayCupoTit  = (probs) => probs.some(t => /titulares y tienes/.test(t));

    win._mrState = base();                       // 15 convocados, LIGA, F7
    ok('5l · ⛔ LIGA F7 con 15 convocados NO deja guardar', hayCupoConv(MR.problemas()),
       MR.problemas().join(' | '));

    const S14 = base(); delete S14.conv['15']; win._mrState = S14;
    ok('5m · con 14 sí deja guardar', MR.problemas().length === 0, MR.problemas().join(' | '));

    // 🔑 EL CASO QUE NINGÚN CLIC PUEDE FRENAR: convocatoria hecha como amistoso
    //    y luego cambiada a liga. Aquí no hubo casilla que bloquear, así que la
    //    única defensa es la validación de guardado.
    const Sam = base(); Sam.tipoPartido = 'amistoso'; win._mrState = Sam;
    ok('5n · 🔑 AMISTOSO F7 con 15 convocados SÍ deja guardar', MR.problemas().length === 0,
       MR.problemas().join(' | '));
    const Svuelta = base(); Svuelta.tipoPartido = 'amistoso';
    Svuelta.tipoPartido = 'liga';                // el cambio de tipo, sin tocar la convocatoria
    win._mrState = Svuelta;
    ok('5o · 🔑 y al cambiarlo a LIGA vuelve a bloquear', hayCupoConv(MR.problemas()));

    // El tope de titulares NO lo relaja el amistoso.
    const Stit = base(); Stit.tipoPartido = 'amistoso'; Stit.tit['8'] = true; win._mrState = Stit;
    ok('5p · 🚨 AMISTOSO con 8 titulares en F7 NO deja guardar', hayCupoTit(MR.problemas()),
       MR.problemas().join(' | '));

    // F11: 18 y 11.
    const S11 = base();
    S11.equipo = { clubId: 'C', category: 'juvenil', subcategory: 'A', teamId: 't' };
    for (let n = 16; n <= 19; n++) {
        S11.jugadores.push({ ficha: 'F' + n, dorsal: String(n), nombre: 'Jugador ' + n, alias: 'J' + n });
        S11.conv[String(n)] = true;
    }
    for (let n = 8; n <= 11; n++) S11.tit[String(n)] = true;
    win._mrState = S11;                          // 19 convocados, 11 titulares
    ok('5q · ⛔ LIGA F11 con 19 convocados NO deja guardar', hayCupoConv(MR.problemas()),
       MR.problemas().join(' | '));
    delete S11.conv['19']; win._mrState = S11;   // 18
    ok('5r · con 18 y 11 titulares sí deja guardar', MR.problemas().length === 0,
       MR.problemas().join(' | '));
    S11.tit['12'] = true; S11.jugadores.push({ ficha: 'F12b', dorsal: '12', nombre: 'Doce', alias: 'Doce' });
    S11.conv['12'] = true;
    win._mrState = S11;
    ok('5s · 🚨 con 12 titulares en F11 NO deja guardar', hayCupoTit(MR.problemas()),
       MR.problemas().join(' | '));

    ok('5t · el cupo del formulario coincide con el de utils.js',
       MR.cupo().maxTitulares === 11 && MR.cupo().maxConvocados === 18);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · los enganches ──');
// ════════════════════════════════════════════════════════════════════
const manual = leer(F_MANUAL);
const indiv  = leer(F_INDIV);
const index  = leer(F_INDEX);
const sw     = leer(F_SW);
const cal    = leer(F_CAL);

// ⚠️ EL CÓDIGO, NO LOS COMENTARIOS. Las dos aserciones de ausencia de abajo
//    («no reimplementa la ruta», «no fabrica objetos de historial») miden que
//    algo NO esté ESCRITO. Contra el fichero entero darían rojo en falso en
//    cuanto un comentario explique precisamente lo que no hay que hacer — que
//    es justo lo que hace la cabecera de este módulo.
const manualCodigo = manual.replace(/\/\/[^\n]*/g, '');

// 🚨 Se mide DENTRO del elemento, no en el fichero entero (lección de v651):
//    buscar 'openAnadirInforme' en todo individual-reports.js daría verde con
//    el botón puesto en cualquier sitio, incluso en un comentario.
const botones = indiv.match(/<button[^>]*openAnadirInforme[^>]*>[\s\S]*?<\/button>/g) || [];
ok('4a · «Mis Informes» tiene el botón de añadir informe', botones.length >= 1,
   'encontrados: ' + botones.length);
ok('4b · y también en la pantalla vacía (que es donde más falta hace)', botones.length >= 2,
   'encontrados: ' + botones.length);
ok('4c · el botón va con guarda typeof (no rompe si el módulo no cargó)',
   botones.every(b => /typeof\s+openAnadirInforme\s*===\s*'function'/.test(b)));

ok('4d · index.html carga el módulo',
   /<script[^>]+src="js\/coach\/comms\/manual-report\.js/.test(index));
ok('4e · el Service Worker lo precachea',
   /'\.\/js\/coach\/comms\/manual-report\.js'/.test(sw));
ok('4f · el CACHE_NAME subió (si no, nadie recibe el código nuevo)',
   /const\s+CACHE_NAME\s*=\s*'cronos-cache-v665'/.test(sw));

// 🔑 EL CALENDARIO SE LEE POR SU FUNCIÓN, NO COPIANDO SU ALMACÉN.
ok('4g · calendario-temporada.js exporta calPartidosDeEquipo',
   /window\.calPartidosDeEquipo\s*=/.test(cal));
ok('4h · 🔑 el formulario NO reimplementa la ruta del calendario',
   manualCodigo.indexOf('CALENDARIO__') === -1,
   'el módulo no puede conocer la forma del almacén: usa calPartidosDeEquipo()');
ok('4i · y llama a esa función con guarda typeof',
   /typeof\s+window\.calPartidosDeEquipo\s*===\s*'function'/.test(manual));

// 🔑 LOS TRES DOCUMENTOS QUE HACEN QUE EL INFORME SE INTEGRE.
ok('4j · escribe la copia del STAFF (informe colectivo)',
   /_staff_p'?\s*\+/.test(manual) && /staffReport:\s*true/.test(manual));
ok('4k · escribe la copia del ENTRENADOR («Mis Informes»)',
   /_coach_p'?\s*\+/.test(manual) && /_forCoach:\s*true/.test(manual));
ok('4l · escribe la copia de las FAMILIAS (informes individuales)',
   /_parent_'?\s*\+/.test(manual) && /parent_player_report/.test(manual));
ok('4m · y el índice ligero de partidos terminados (v639)',
   /_cronosIndexarPartidoTerminado/.test(manual));

// ⚠️ SIEMPRE me.uid en staffUids: sin él, la consulta array-contains del Panel
//    de Dirección se queda vacía en un club sin staff asignado (FIX P11-D).
ok('4n · ⚠️ staffUids incluye SIEMPRE al propio entrenador',
   /concat\(\[me\.uid\]\)/.test(manual) || /me\.uid\]\)\)/.test(manual));

// ⛔ El rol de familias se decide en el resolvedor único, no aquí (v623).
ok('4o · ⛔ las familias pasan por el resolvedor único',
   /_cronosResolveParentReportTargets/.test(manual));

// 🔑 El historial NO se fabrica a mano: se compone en texto y lo interpreta el
//    parser único. Dos definiciones del formato divergen (lección de v551).
ok('4p · 🔑 el historial se pasa por _parseHistoryForFirestore',
   /_parseHistoryForFirestore/.test(manual));
ok('4q · 🔑 y NO se construyen objetos {type:\'sub_in\'} a mano',
   !/type:\s*'sub_(in|out)'/.test(manualCodigo),
   'hay objetos de historial fabricados a mano fuera del parser');

// ⚠️ Cero reglas nuevas: en este proyecto testeo comparte reglas con
//    producción y no se pueden probar antes de desplegarlas.
const reglas = leer(F_RULES);
ok('4r · ⚠️ no hace falta ninguna colección nueva en firestore.rules',
   /match \/cronos_player_reports\/\{reportId\}/.test(reglas) &&
   /match \/finished_index\/\{matchId\}/.test(reglas) &&
   !/informes_manuales/.test(reglas));

// El sello de origen, para poder distinguir después lo medido de lo recordado.
ok('4s · los documentos van marcados con manualEntry', /manualEntry:\s*true/.test(manual));

// ⚖️ El tipo de partido: selector, dato guardado y vocabulario compartido.
// El desplegable de tipo se comprueba PINTADO en la parte 9 (sus opciones se
// construyen, no están escritas literalmente). Aquí sólo su manejador.
ok('4t · existe el manejador del tipo de partido', /window\._mrTipoPartido\s*=/.test(manual));
ok('4u · el tipo viaja en el documento como matchType',
   /matchType:\s*S\.tipoPartido/.test(manualCodigo));
// 🔑 MISMO VOCABULARIO QUE LA CONVOCATORIA EN VIVO ('liga'|'amistoso'), no uno
//    nuevo: whatsapp-email.js y ai/import.js ya hablan así.
ok('4v · 🔑 usa el vocabulario que ya existía en el proyecto',
   /'amistoso'/.test(manualCodigo) &&
   /amistoso/.test(leer(path.join(ROOT, 'js', 'shared', 'whatsapp-email.js'))));
// 🔑 LOS NÚMEROS NO SE REESCRIBEN EN EL FORMULARIO: se piden a utils.js.
// 🔑🔑 NI SIQUIERA COMO RESPALDO. Un `mod === 'f11' ? 18 : 14` «por si acaso»
//     es una SEGUNDA copia de la tabla, y las copias divergen (v551). Si la
//     regla no está cargada, el formulario devuelve cupo CERO y bloquea: «no
//     puedo validar» significa NO, no SÍ (v617).
ok('4w · 🔑 el formulario NO lleva su propia tabla de cupos, ni de respaldo',
   !/\?\s*18\s*:\s*14|\?\s*14\s*:\s*18|\?\s*11\s*:\s*7\b/.test(manualCodigo),
   'los topes tienen que salir de cronosCupoConvocatoria (core/utils.js)');
ok('4w2 · ⚠️ y sin la regla FALLA CERRADO (cupo 0 + aviso), no permisivo',
   /_sinRegla:\s*true/.test(manualCodigo) && /maxConvocados:\s*0/.test(manualCodigo) &&
   /cupo\._sinRegla/.test(manualCodigo));
ok('4x · y utils.js la exporta', /window\.cronosCupoConvocatoria\s*=/.test(
   leer(path.join(ROOT, 'js', 'core', 'utils.js'))));
// ⚠️ BLOQUEO EN ORIGEN (capa A de v506): la casilla que se pasaría del tope no
//    marca nada. Sin esto sólo quedaría el bloqueo del botón.
ok('4y · ⚠️ las casillas frenan en origen al pasarse del cupo',
   /_mrConvocados\(\)\.length >= cupo\.maxConvocados/.test(manualCodigo) &&
   /_mrTitulares\(\)\.length >= cupo\.maxTitulares/.test(manualCodigo));

// ════════════════════════════════════════════════════════════════════
console.log('\n' + (fallos === 0
    ? '✅ TODO EN VERDE — el informe manual alimenta colectivo, individuales y temporada.'
    : '❌ ' + fallos + ' comprobación(es) en rojo.'));
process.exit(fallos === 0 ? 0 : 1);

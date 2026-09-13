// ═══════════════════════════════════════════════════════════════════════════
// GUARD · Pérdidas y Recuperaciones en los informes acumulados — v705
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (capturas 10314-10317):
//   · Resumen ACUMULADO de la temporada: columnas con el total de
//     Recuperaciones (verde) y Pérdidas (rojo) por jugador.
//   · Informe INDIVIDUAL (Área de Familias): las mismas cifras del jugador.
//   · "Estrictamente condicional al extra: si está desactivado, estas columnas
//     e indicadores deben DESAPARECER POR COMPLETO de ambos paneles."
//
// ⚠️ SE EJECUTAN LAS FUNCIONES REALES (`ctAccumulatePlayerStats` y
// `ctRenderStatsTable`) con partidos de mentira. Un `grep` diría que el código
// existe; lo que hay que comprobar es CUÁNTO suma cada jugador y si las
// columnas se van del todo al apagar el extra.
//
// 🚨 DOS RIESGOS CONCRETOS QUE ESTE GUARD VIGILA:
//   · Doblar el dato: `matchPR` viaja REPETIDO en cada documento de jugador
//     del partido. Sumarlo por documento en vez de por dorsal multiplicaría
//     las pérdidas por el número de fichas.
//   · Partir la tabla: la fila de "colaboraciones" lleva un `colspan` fijo.
//     Con dos columnas más y el colspan viejo, esa fila se descuadra sin que
//     salte ningún error.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 300)); }
};

const SRC_CT     = fs.readFileSync(path.join(ROOT, 'js/admin/shared/category-tree.js'), 'utf8');
const SRC_PPANEL = fs.readFileSync(path.join(ROOT, 'js/parent/panel.js'), 'utf8');
const SRC_AUTO   = fs.readFileSync(path.join(ROOT, 'js/coach/comms/match-reports-auto.js'), 'utf8');
const SRC_SEND   = fs.readFileSync(path.join(ROOT, 'js/coach/comms/match-reports-send.js'), 'utf8');

// El módulo se carga con el extra ENCENDIDO o APAGADO según el caso.
function cargar(extraActivo) {
    const win = {
        _cronosExtraEnabled: (k) => (k === 'registro_pr' ? extraActivo : true),
        CT_CATEGORIES: [], escapeHtml: (s) => String(s == null ? '' : s),
    };
    const ctx = {
        window: win, document: { getElementById: () => null, createElement: () => ({ style: {} }) },
        console: { log(){}, warn(){}, error(){} },
        Date, JSON, Object, Array, String, Number, Boolean, Math, Map, Set,
        RegExp, isNaN, parseInt, parseFloat, Error, localStorage: { getItem: () => null, setItem: () => {} },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC_CT, ctx);
    return win;
}

// Dos partidos. En el primero, PR con desglose por dorsal; en el segundo otro.
// ⚠️ `matchPR` va repetido en CADA documento de jugador, igual que en
// producción: así el guard reproduce el riesgo de contarlo dos veces.
const PR1 = {
    perdidas:       { total: 4, sinAsignar: 1, porDorsal: { '7': 2, '10': 1 } },
    recuperaciones: { total: 3, sinAsignar: 0, porDorsal: { '7': 1, '10': 2 } },
};
const PR2 = {
    perdidas:       { total: 2, sinAsignar: 0, porDorsal: { '7': 2 } },
    recuperaciones: { total: 1, sinAsignar: 0, porDorsal: { '10': 1 } },
};
const jug = (n, alias, extra) => Object.assign({
    playerNumber: String(n), playerAlias: alias, minutesPlayed: '45:00',
    goals: 0, cards: null, injured: false, history: []
}, extra || {});

const PARTIDOS = [
    { matchId: 'm1', players: [jug(7, 'NANO', { matchPR: PR1 }), jug(10, 'BRUNO', { matchPR: PR1 })] },
    { matchId: 'm2', players: [jug(7, 'NANO', { matchPR: PR2 }), jug(10, 'BRUNO', { matchPR: PR2 })] },
];

// ═══ 1 · LA ACUMULACIÓN ════════════════════════════════════════════════════
{
    const W = cargar(true);
    ok('0 · las funciones del acumulado están cargadas',
       typeof W.ctAccumulatePlayerStats === 'function' && typeof W.ctRenderStatsTable === 'function');

    const filas = W.ctAccumulatePlayerStats(PARTIDOS);
    const f7  = filas.filter(f => f.number === '7')[0]  || {};
    const f10 = filas.filter(f => f.number === '10')[0] || {};

    // NANO: 2+2 pérdidas y 1+0 recuperaciones. BRUNO: 1+0 y 2+1.
    ok('1a · 🔑 suma las pérdidas de cada jugador a lo largo de los partidos',
       f7.prPerdidas === 4, { f7 });
    ok('1b · 🔑 y sus recuperaciones', f7.prRecuperaciones === 1, { f7 });
    ok('1c · …y las del otro jugador, sin mezclarlas',
       f10.prPerdidas === 1 && f10.prRecuperaciones === 3, { f10 });

    // 🚨 EL RIESGO DE DOBLAR, REPRODUCIDO DE VERDAD. Un partido puede traer
    // DOS documentos del mismo jugador (la copia del staff y la del
    // entrenador) si la deduplicación de aguas arriba fallara. `matchPR` es
    // del PARTIDO, así que sumarlo una vez por documento multiplicaría las
    // pérdidas de ese jugador por el número de copias.
    // ⚠️ La primera versión de esta aserción daba VERDE sin probar nada: el
    // escenario sólo tenía un documento por dorsal, así que no había nada que
    // doblar. Lo cazó el red-check.
    const dobles = W.ctAccumulatePlayerStats([
        { matchId: 'm1', players: [
            jug(7, 'NANO', { matchPR: PR1 }),
            jug(7, 'NANO', { matchPR: PR1 })   // la misma ficha, dos copias
        ] }
    ]);
    ok('1d · 🚨 NO dobla el dato aunque el jugador venga con dos copias en el partido',
       dobles[0].prPerdidas === 2 && dobles[0].prRecuperaciones === 1, { dobles });

    // CONTROL: lo de siempre sigue funcionando.
    ok('1e · CONTROL · el resto del acumulado no se toca',
       f7.pj === 2 && f7.goals === 0 && typeof f7.minutes === 'number');

    // Un partido sin P/R no ensucia el acumulado.
    const sinPR = W.ctAccumulatePlayerStats([{ matchId: 'm3', players: [jug(7, 'NANO')] }]);
    ok('1f · un partido sin P/R deja los contadores a cero',
       sinPR[0].prPerdidas === 0 && sinPR[0].prRecuperaciones === 0);
}

// ═══ 2 · LA TABLA, CON EL EXTRA ENCENDIDO ══════════════════════════════════
{
    const W = cargar(true);
    const filas = W.ctAccumulatePlayerStats(PARTIDOS);
    const html = W.ctRenderStatsTable(filas, { matchCount: 2 });

    ok('2a · aparecen las columnas de R y P en la cabecera',
       /Recuperaciones de balón/.test(html) && /Pérdidas de balón/.test(html));
    ok('2b · la R va en VERDE y la P en ROJO, como en el campo',
       /color:#3fb950;">&#9650; R/.test(html) && /color:#f85149;">&#9660; P/.test(html));
    ok('2c · las cifras del jugador salen en su fila',
       /color:#3fb950;font-weight:700;">1</.test(html) && /color:#f85149;font-weight:700;">4</.test(html));
    // Son magnitudes del equipo, como los goles: el total las suma.
    ok('2d · la fila de totales suma el equipo (5 pérdidas, 4 recuperaciones)',
       /<td style="color:#3fb950;">4<\/td><td style="color:#f85149;">5<\/td>/.test(html));

    // 🚨 El colspan de la fila de colaboraciones tiene que seguir a las
    // columnas: con P/R encendidas son 10.
    const conInvitados = W.ctRenderStatsTable(filas, {
        matchCount: 2,
        guestRows: [{ number: '99', alias: 'CEDIDO', pj: 1, pt: 0, minutes: 10, goals: 0,
                      yellow: 0, red: 0, injuries: 0, hosts: ['Juvenil A'] }]
    });
    ok('2e · 🚨 el colspan de «colaboraciones» sigue a las columnas (10)',
       /colspan="10"/.test(conInvitados));
}

// ═══ 3 · CON EL EXTRA APAGADO, DESAPARECEN ═════════════════════════════════
// El encargo es explícito: "deben desaparecer POR COMPLETO".
{
    const W = cargar(false);
    const filas = W.ctAccumulatePlayerStats(PARTIDOS);
    const html = W.ctRenderStatsTable(filas, { matchCount: 2 });

    ok('3a · 🔑 sin extra, NO hay columnas de R ni de P',
       !/Recuperaciones de balón/.test(html) && !/Pérdidas de balón/.test(html));
    ok('3b · …ni sus celdas de color en las filas',
       !/color:#3fb950;font-weight:700;/.test(html));
    ok('3c · y el colspan vuelve a 8',
       /colspan="8"/.test(W.ctRenderStatsTable(filas, {
           guestRows: [{ number: '99', alias: 'X', pj: 0, pt: 0, minutes: 0, goals: 0,
                         yellow: 0, red: 0, injuries: 0, hosts: [] }] })));
    // CONTROL · el resto de la tabla sale igual que siempre.
    ok('3d · CONTROL · la tabla sigue teniendo sus columnas de siempre',
       /Goles/.test(html) && /Lesiones/.test(html) && /Resumen acumulado de la temporada/.test(html));

    // 🔑 El acumulado SÍ se calcula aunque el extra esté apagado: si el club lo
    // reactiva, el histórico no puede haberse perdido. Lo que se apaga es la
    // VISTA, no el dato.
    ok('3e · 🔑 el dato se sigue acumulando (se apaga la vista, no el registro)',
       filas.filter(f => f.number === '7')[0].prPerdidas === 4);
}

// ═══ 4 · EL INFORME INDIVIDUAL (ÁREA DE FAMILIAS) ══════════════════════════
ok('4a · las familias reciben SU dato (`prPropio`), no el desglose del equipo',
   /prPropio:/.test(SRC_AUTO) && /prPropio:/.test(SRC_SEND) &&
   !/matchPR:\s*\(typeof window\.cronosPRDelPartido[\s\S]{0,200}parent_player_report/.test(SRC_AUTO));
ok('4b · 🚨 y ese dato sale de `cronosPRDeJugador`, acotado a su dorsal',
   /cronosPRDeJugador\(window\.cronosPRDelPartido\(\), dorsal\)/.test(SRC_AUTO) &&
   /cronosPRDeJugador\(window\.cronosPRDelPartido\(\), dorsal\)/.test(SRC_SEND));
ok('4c · el panel de Familias acumula pérdidas y recuperaciones',
   /const totalPerdidas = reports\.reduce/.test(SRC_PPANEL) &&
   /const totalRecup\s+= reports\.reduce/.test(SRC_PPANEL));
ok('4d · 🔑 sus tarjetas son condicionales al extra',
   /_prVisible \? \[/.test(SRC_PPANEL) &&
   /_cronosExtraEnabled\('registro_pr'\)/.test(SRC_PPANEL));
ok('4e · con los colores del encargo (R verde, P roja)',
   /'Recuperaciones', totalRecup,\s+'#3fb950'/.test(SRC_PPANEL) &&
   /'Pérdidas',\s+totalPerdidas, '#f85149'/.test(SRC_PPANEL));

console.log('\n' + (fail ? 'FALLOS: ' + fail : 'OK') + ': ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

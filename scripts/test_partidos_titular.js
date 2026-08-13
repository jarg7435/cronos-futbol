// ─────────────────────────────────────────────────────────────────────────
// test_partidos_titular.js · columna PT (Partidos como Titular) en el
// acumulado de temporada y en sus exportaciones (2026-08-13)
//
// 🔑🔑🔑 EL PUNTO DE PARTIDA, VERIFICADO CONTRA PRODUCCIÓN ANTES DE ESCRIBIR
// CÓDIGO: la titularidad NO estaba guardada en ningún sitio. Se leyeron los
// 300 documentos de cronos_player_reports por REST y NO existe ni
// `initialStatus`, ni `titular`, ni `status`, ni `titularOrder`. El
// entrenador la elegía en la convocatoria y se perdía por el camino, porque
// el objeto de jugador de event-listeners.js se construye con una LISTA FIJA
// de campos — la misma trampa que se pagó con las plazas de apoyo.
//
// De ahí las dos vías, y este guard vigila las dos:
//   · los informes NUEVOS llevan `wasStarter`, exacto;
//   · los ya guardados se DEDUCEN del historial, con la misma regla que
//     report-engine.js llama "airtight": si tu primera TRANSICIÓN es una
//     salida, estabas dentro; si es una entrada, estabas fuera.
//
// LO QUE PROTEGE:
//
//  A · la marca explícita manda sobre la deducción.
//  B · 🔑 la deducción mira sólo sub_in/sub_out. En los datos reales hay
//      jugadores con `goal,goal,goal,sub_out,…`: tomar "el primer suceso" a
//      secas los dejaba indeterminados.
//  C · 🔑 un convocado con CERO minutos NO suma PT. La regla "sin
//      transiciones = empezó" daría true para el suplente que no jugó, así
//      que el filtro por minutos tiene que ir DELANTE.
//  D · 🔑 cronosFueTitular NO puede mirar `status`: es el estado AL TERMINAR,
//      y un suplente que entró en el 30 acaba con status 'field'. Es
//      exactamente el error que ya se pagó en la barra de minutos (v425).
//  E · el jugador de APOYO tiene su PT en su línea.
//  F · la columna va JUNTO A PJ y NO se suma en la fila de totales (la suma
//      de titularidades es el número de alineaciones, no algo del equipo).
//  G · PT sale en el CSV y en el PDF, en la misma posición.
//  H · ⚠️ los TRES escritores de informes persisten wasStarter, y
//      event-listeners.js conserva initialStatus. Con uno que se quede atrás,
//      el acumulado mezcla partidos contados con reglas distintas.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (n, c, x) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (x !== undefined) console.log('       ' + String(x).slice(0, 300)); }
};

const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const SRC_TREE  = leer('js/admin/shared/category-tree.js');
const SRC_UTILS = leer('js/core/utils.js');
const SRC_EXP   = leer('js/coach/reports/reports-export.js');
const SRC_EV    = leer('js/core/event-listeners.js');

function build() {
    const sb = { console: { log() {}, warn() {}, error() {} }, JSON, Math, Date,
                 Object, Array, String, Number, Boolean, RegExp, isNaN, parseInt, parseFloat };
    sb.window = sb;
    sb.globalThis = sb;
    sb.document = { getElementById: () => null, createElement: () => ({ style: {} }) };
    sb.localStorage = { getItem: () => null, setItem: () => {} };
    vm.createContext(sb);
    vm.runInContext(SRC_UTILS, sb);
    vm.runInContext(SRC_TREE, sb);
    return sb;
}

// Documento de informe tal como lo escribe match-reports-auto.js.
const P = (over) => Object.assign({
    playerNumber: '7', playerAlias: 'Martín',
    goals: 0, cards: null, injured: false, minutesPlayed: '45:00', history: [],
}, over || {});
const EV = (type) => ({ type, minute: 0, second: 0, timeStr: '10:00' });

const sb = build();
const filasDe = (matches) => sb.ctAccumulatePlayerStats(matches);
const unaFila = (matches) => filasDe(matches)[0];

// ═════════════════════════════════════════════════════════════════════
// A · LA MARCA EXPLÍCITA MANDA
// ═════════════════════════════════════════════════════════════════════
{
    ok('A1 · wasStarter true suma PT',
       unaFila([{ players: [P({ wasStarter: true })] }]).pt === 1);
    ok('A2 · wasStarter false NO suma PT',
       unaFila([{ players: [P({ wasStarter: false })] }]).pt === 0);
    ok('A3 · 🔑 wasStarter:false gana a un historial que diría lo contrario',
       unaFila([{ players: [P({ wasStarter: false, history: [EV('sub_out')] })] }]).pt === 0,
       JSON.stringify(unaFila([{ players: [P({ wasStarter: false, history: [EV('sub_out')] })] }])));
    ok('A4 · initialStatus field también vale (informes del camino antiguo)',
       unaFila([{ players: [P({ initialStatus: 'field' })] }]).pt === 1);
}

// ═════════════════════════════════════════════════════════════════════
// B · DEDUCCIÓN POR LA PRIMERA TRANSICIÓN
// ═════════════════════════════════════════════════════════════════════
{
    ok('B1 · 🔑 primera transición = SALE -> era titular',
       unaFila([{ players: [P({ history: [EV('sub_out')] })] }]).pt === 1);
    ok('B2 · 🔑 primera transición = ENTRA -> era suplente',
       unaFila([{ players: [P({ history: [EV('sub_in')] })] }]).pt === 0);
    ok('B3 · 🔑 los GOLES por delante no confunden (caso real de producción)',
       unaFila([{ players: [P({ history: [EV('goal'), EV('goal'), EV('sub_out')] })] }]).pt === 1,
       JSON.stringify(unaFila([{ players: [P({ history: [EV('goal'), EV('goal'), EV('sub_out')] })] }])));
    ok('B4 · una amarilla por delante tampoco',
       unaFila([{ players: [P({ history: [EV('yellow'), EV('sub_in')] })] }]).pt === 0);
    ok('B5 · sin transiciones pero con minutos -> empezó',
       unaFila([{ players: [P({ history: [EV('goal')] })] }]).pt === 1);
    ok('B6 · entra y luego sale: cuenta la PRIMERA (suplente)',
       unaFila([{ players: [P({ history: [EV('sub_in'), EV('sub_out')] })] }]).pt === 0);
}

// ═════════════════════════════════════════════════════════════════════
// C · CERO MINUTOS NUNCA ES TITULAR
// ═════════════════════════════════════════════════════════════════════
{
    const f = unaFila([{ players: [P({ minutesPlayed: '00:00', history: [] })] }]);
    ok('C1 · 🔑 convocado con 00:00 no suma PT', f.pt === 0, JSON.stringify(f));
    ok('C2 · y tampoco suma PJ', f.pj === 0, JSON.stringify(f));
    ok('C3 · pero sí cuenta como convocado', f.called === 1, JSON.stringify(f));
    // El caso peligroso: 0 minutos y SIN historial, que es como está guardada
    // la mitad de los informes reales.
    ok('C4 · 🔑 0 minutos sin historial tampoco (es la mitad de los datos reales)',
       unaFila([{ players: [P({ minutesPlayed: '0', history: [] })] }]).pt === 0);

    // 🔑 EL CASO QUE DE VERDAD DEFIENDE EL FILTRO POR MINUTOS. Con 0 minutos y
    // sin historial la deducción ya devuelve false sola, así que C1 pasaría
    // igual sin el guard — pasaba en vacío. Lo que el guard impide es que un
    // jugador marcado TITULAR en la convocatoria que finalmente no disputó ni
    // un minuto sume PT: quedaría PT=1 con PJ=0, que es un imposible y además
    // haría que la columna contradijera a la de al lado.
    const f2 = unaFila([{ players: [P({ wasStarter: true, minutesPlayed: '00:00' })] }]);
    ok('C5 · 🔑 titular declarado que NO jugó: PT=0, nunca PT>PJ',
       f2.pt === 0 && f2.pj === 0, JSON.stringify(f2));
}

// ═════════════════════════════════════════════════════════════════════
// D · cronosFueTitular NO MIRA `status`
// ═════════════════════════════════════════════════════════════════════
{
    ok('D0 · la función existe y es única', typeof sb.cronosFueTitular === 'function');
    ok('D1 · 🔑 status "field" NO basta: es el estado al TERMINAR',
       sb.cronosFueTitular({ status: 'field' }) === false,
       'status field -> ' + sb.cronosFueTitular({ status: 'field' }));
    ok('D2 · initialStatus field sí', sb.cronosFueTitular({ initialStatus: 'field' }) === true);
    ok('D3 · titularOrder 0 es titular', sb.cronosFueTitular({ titularOrder: 0 }) === true);
    ok('D4 · titularOrder 999 es banquillo', sb.cronosFueTitular({ titularOrder: 999 }) === false);
    ok('D5 · initialStatus manda sobre titularOrder',
       sb.cronosFueTitular({ initialStatus: 'bench', titularOrder: 3 }) === false);

    // Censo de fuente: una segunda copia de este criterio es lo que haría
    // que dos escritores contaran distinto.
    const copias = [SRC_TREE, SRC_EXP].filter(s => /function cronosFueTitular/.test(s));
    ok('D6 · ⚠️ no hay una segunda definición de cronosFueTitular fuera de utils.js',
       copias.length === 0);
}

// ═════════════════════════════════════════════════════════════════════
// E · EL JUGADOR DE APOYO TIENE SU PT
// ═════════════════════════════════════════════════════════════════════
{
    const partidos = [{
        category: 'juvenil', subcategory: 'B',
        players: [P({ playerNumber: '19', playerAlias: 'Kevin', isGuest: true,
                      originPlayerId: 'CDA07', originCategory: 'cadete', originSubcategory: 'A',
                      wasStarter: true, minutesPlayed: '60:00' })]
    }];
    // ⚠️ La subcategoría va en MAYÚSCULA: ctNormSubcat normaliza a 'A'/'B'/'C',
    // y ctAccumulateGuestStats compara contra su salida. Pasando 'a' el filtro
    // no casa nunca y la lista sale vacía — pasó al escribir este guard.
    const inv = sb.ctAccumulateGuestStats(partidos, 'cadete', 'A');
    ok('E1 · la colaboración se contabiliza', inv.length === 1, JSON.stringify(inv));
    ok('E2 · 🔑 y trae su PT', inv[0] && inv[0].pt === 1, JSON.stringify(inv[0]));

    // En la tabla del equipo de acogida también sale con su PT.
    const fila = filasDe(partidos)[0];
    ok('E3 · en el equipo de acogida también', fila.pt === 1 && fila.isGuest === true,
       JSON.stringify(fila));
}

// ═════════════════════════════════════════════════════════════════════
// F · LA TABLA: PT JUNTO A PJ, Y SIN SUMAR EN EL TOTAL
// ═════════════════════════════════════════════════════════════════════
{
    const filas = filasDe([
        { players: [P({ playerNumber: '7',  playerAlias: 'Martín', wasStarter: true }),
                    P({ playerNumber: '10', playerAlias: 'Lucas',  wasStarter: false })] },
        { players: [P({ playerNumber: '7',  playerAlias: 'Martín', wasStarter: true })] },
    ]);
    const html = sb.ctRenderStatsTable(filas, { matchCount: 2 });

    const cabeceras = (html.match(/<th[^>]*>(?:<[^>]+>)?([^<]*)/g) || []).join('|');
    ok('F1 · 🔑 la cabecera PT existe y va justo DESPUÉS de PJ',
       /PJ<\/th>\s*<th[^>]*>PT<\/th>/.test(html), cabeceras.slice(0, 200));
    ok('F2 · y antes de Min', /PT<\/th>\s*<th[^>]*title="Minutos/.test(html));

    // Fila de Martín: 2 PJ y 2 PT.
    const filaMartin = (html.match(/Martín[\s\S]*?<\/tr>/) || [''])[0];
    const celdas = (filaMartin.match(/<td[^>]*>([^<]*)<\/td>/g) || [])
        .map(c => c.replace(/<[^>]+>/g, ''));
    ok('F3 · la fila del jugador lleva su PT (2 partidos, 2 de titular)',
       celdas[0] === '2' && celdas[1] === '2', JSON.stringify(celdas));

    const total = ((html.match(/Total equipo<\/td>((?:<td[^>]*>[^<]*<\/td>){7})/) || [])[1] || '')
        .replace(/<td[^>]*>/g, ' ').replace(/<\/td>/g, ' ').trim().replace(/\s+/g, ',');
    ok('F4 · 🔑 en el TOTAL, PT va con guion y no sumado',
       total.split(',')[1] === '-', total);
    ok('F5 · y PJ sigue siendo los partidos del equipo (2)',
       total.split(',')[0] === '2', total);

    // La cabecera de colaboraciones abarca TODAS las columnas.
    const conInv = sb.ctRenderStatsTable(filas, { matchCount: 2, guestRows: [
        { number: '', alias: 'Kevin', ficha: 'CDA07', called: 1, pj: 1, pt: 1,
          minutes: 60, goals: 0, yellow: 0, red: 0, injuries: 0, hosts: ['Juvenil B'] }] });
    ok('F6 · ⚠️ el colspan de "Colaboraciones" cubre las 8 columnas',
       /colspan="8"/.test(conInv), (conInv.match(/colspan="\d+"/) || [''])[0]);
}

// ═════════════════════════════════════════════════════════════════════
// G · EXPORTACIONES
// ═════════════════════════════════════════════════════════════════════
{
    const sbx = { console: { log() {}, warn() {}, error() {} }, JSON, Math, Date,
                  Object, Array, String, Number, Boolean, RegExp, isNaN, parseInt, parseFloat };
    sbx.window = sbx; sbx.globalThis = sbx;
    sbx.document = { getElementById: () => null, createElement: () => ({ style: {} }) };
    vm.createContext(sbx);
    vm.runInContext(SRC_EXP, sbx);

    const F = (o) => Object.assign({ number: '7', alias: 'Martín', called: 2, pj: 2, pt: 2,
        minutes: 90, goals: 1, yellow: 0, red: 0, injuries: 0 }, o || {});
    const bloques = [{ equipo: 'Alevín A', partidos: 2, filas: [F(), F({ number: '10', alias: 'Lucas', pt: 0 })] }];

    const filasCsv = sbx.rxFilasResumen(bloques);
    ok('G1 · 🔑 la cabecera del CSV lleva PT entre PJ y Min',
       filasCsv[0].indexOf('PT') === filasCsv[0].indexOf('PJ') + 1 &&
       filasCsv[0].indexOf('Min') === filasCsv[0].indexOf('PT') + 1, JSON.stringify(filasCsv[0]));
    ok('G2 · y la fila trae el valor en esa misma posición',
       filasCsv[1][filasCsv[0].indexOf('PT')] === 2, JSON.stringify(filasCsv[1]));
    const totalCsv = filasCsv[filasCsv.length - 1];
    ok('G3 · 🔑 el TOTAL del CSV lleva guion en PT',
       totalCsv[filasCsv[0].indexOf('PT')] === '-', JSON.stringify(totalCsv));

    const htmlPdf = sbx.rxTablaResumenHtml(bloques[0]);
    ok('G4 · 🔑 el PDF lleva la columna PT tras PJ',
       /<th>PJ<\/th><th>PT<\/th><th>Min<\/th>/.test(htmlPdf),
       (htmlPdf.match(/<thead>[\s\S]{0,200}/) || [''])[0]);
    ok('G5 · y su pie no suma PT',
       /<td>2<\/td><td>-<\/td><td>-<\/td>/.test(htmlPdf),
       (htmlPdf.match(/<tfoot>[\s\S]{0,200}/) || [''])[0]);
}

// ═════════════════════════════════════════════════════════════════════
// H · LA PERSISTENCIA, EN LOS TRES ESCRITORES
// ═════════════════════════════════════════════════════════════════════
{
    // ⚠️ Censo de fuente a propósito: estos escritores hablan con Firestore y
    // no se pueden ejecutar aquí. Lo que se vigila es que NINGUNO se quede
    // sin escribir el campo, que es como el acumulado acabaría mezclando
    // partidos contados con reglas distintas.
    const escritores = [
        ['match-reports-auto.js', leer('js/coach/comms/match-reports-auto.js'), 3],
        ['match-reports-send.js', leer('js/coach/comms/match-reports-send.js'), 2],
        ['collective-report.js',  leer('js/coach/comms/collective-report.js'),  1],
    ];
    escritores.forEach(([nombre, src, minimo]) => {
        const n = (src.match(/wasStarter:/g) || []).length;
        ok('H · ' + nombre + ' persiste wasStarter (' + n + ' >= ' + minimo + ')',
           n >= minimo, 'encontrados ' + n);
    });

    ok('H4 · 🔑 event-listeners.js CONSERVA initialStatus en el objeto del jugador',
       /initialStatus:\s*pData\.initialStatus === 'field'/.test(SRC_EV),
       'no se encontró la línea que preserva initialStatus');

    ok('H5 · ⚠️ y sigue conservando titularOrder (el otro camino de arranque)',
       /titularOrder:\s*pData\.titularOrder/.test(SRC_EV));
}

console.log('\n' + (fail === 0 ? 'OK' : 'FALLOS') + ': ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);

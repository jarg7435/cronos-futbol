// ─────────────────────────────────────────────────────────────────────────
// test_player_stats_accumulator.js · FASE 5 (parte 1 de 2) del árbol del
// panel de Dirección: la TABLA RESUMEN ACUMULADA de temporada que pide el
// autor (2026-07-30) en la parte alta de cada subcategoría.
//
// DE DÓNDE SALEN LOS DATOS, y por qué NO de la plantilla: la plantilla vive en
// users/{coachUid}/cronos_data/main y la regla de Firestore sólo la deja leer a
// su propio dueño (`request.auth.uid == userId`); además ese mismo documento
// contiene cronos_email_config, o sea los emails y teléfonos de TODOS los
// padres. Abrirlo a la dirección para sacar 18 nombres habría sido una
// ampliación de acceso a datos personales. DECISIÓN DEL AUTOR (2026-07-30): la
// tabla se construye con los jugadores que aparecen en los informes. Un jugador
// que nunca fue convocado no figura, y eso es aceptado a cambio de no tocar
// permisos y de cubrir todo el histórico.
//
// 🔑 LAS TRES TRAMPAS DE LOS DATOS, que son lo que de verdad fija este guard:
//
//  1. `minutesPlayed` NO ES UN NÚMERO. Se guarda con formatTime(), o sea la
//     cadena "MM:SS". Sumarlas como números daría 0, o peor, concatenaciones.
//     Y los documentos escritos cuando formatTime no estaba cargado traen
//     String(p.time), que son SEGUNDOS en crudo. Hay que aceptar las dos formas.
//
//  2. `cards` ES LOSSY PARA LAS AMARILLAS. Es un solo campo: la segunda
//     amarilla lo sobrescribe a 'roja' (player-actions.js), así que contando
//     amarillas por ahí un expulsado por doble amarilla aparecería con CERO
//     amarillas. Se cuentan desde `history`, donde sí quedan las dos: la
//     entrada 'DOBLE AMARILLA → EXPULSADO' se tipa como 'yellow' porque el
//     parser de comms/panel.js comprueba 'amarilla' ANTES que 'roja'.
//
//  3. Y POR ESO MISMO, las rojas NO se pueden contar de `history`: en una doble
//     amarilla no hay ninguna entrada 'red', y en una roja directa sí. Se
//     cuentan de `cards === 'roja'`, que cubre los dos casos exactamente una
//     vez. Contar de las dos fuentes duplicaría las rojas directas.
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
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');

console.log('── Acumulador de estadísticas por jugador (fase 5) ──\n');

const MOD = 'js/admin/shared/category-tree.js';
const src = leer(MOD);

function build() {
    const sb = { console: { log() {}, warn() {}, error() {} } };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(src, sb);
    return sb;
}

// Comprobación previa, por la misma razón de siempre: sin la API las partes
// siguientes lanzarían y el guard moriría sin imprimir el total.
const API = ['ctAccumulatePlayerStats', 'ctRenderStatsTable'];
const _sbApi = build();
const _faltan = API.filter(k => typeof _sbApi[k] !== 'function');
const API_OK = _faltan.length === 0;
ok('0 · el módulo expone el acumulador y su tabla', API_OK, 'faltan: ' + _faltan.join(', '));

// Un documento de informe por jugador, tal como lo escribe match-reports-auto.js.
const P = (over) => Object.assign({
    playerNumber: '7', playerAlias: 'Martín', position: 'DEL',
    goals: 0, cards: null, injured: false, minutesPlayed: '45:00', history: [],
}, over || {});
// history ya parseado por _parseHistoryForFirestore (objetos con type).
const EV = (type, timeStr) => ({ type, minute: 0, second: 0, timeStr: timeStr || '10:00', subId: null, note: '' });

// ═══════ PARTE 1 · minutos: la cadena "MM:SS" ═══════
console.log('── PARTE 1 · 🔑 minutos, que vienen como "MM:SS" ──');
if (!API_OK) { ok('1 · omitida: falta la API', false); } else {
    const sb = build();
    const filas = (matches) => sb.ctAccumulatePlayerStats(matches);

    const r1 = filas([{ players: [P({ minutesPlayed: '45:30' })] }])[0];
    ok('1a · 🔑 "45:30" son 45 minutos, no 45 ni NaN', r1.minutes === 45,
       'minutes=' + r1.minutes + ' seconds=' + r1.seconds);
    ok('1b · y guarda los segundos exactos para poder sumar sin perder resto',
       r1.seconds === 45 * 60 + 30, r1.seconds);

    // Dos partidos: 45:30 + 44:40 = 90:10 → 90 minutos. Redondear cada partido
    // por separado daría 89.
    const r2 = filas([
        { players: [P({ minutesPlayed: '45:30' })] },
        { players: [P({ minutesPlayed: '44:40' })] },
    ])[0];
    ok('1c · 🔑 suma en segundos y redondea AL FINAL (45:30+44:40 = 90, no 89)',
       r2.minutes === 90, 'minutes=' + r2.minutes + ' seconds=' + r2.seconds);

    // Documentos viejos: String(p.time) = segundos en crudo.
    const r3 = filas([{ players: [P({ minutesPlayed: '2730' })] }])[0];
    ok('1d · 🔑 acepta también los segundos en crudo de los docs antiguos',
       r3.seconds === 2730 && r3.minutes === 45, JSON.stringify(r3));

    const r4 = filas([{ players: [P({ minutesPlayed: undefined })] }])[0];
    ok('1e · sin el campo cuenta 0, no NaN', r4.seconds === 0 && r4.minutes === 0,
       JSON.stringify(r4));
    const r5 = filas([{ players: [P({ minutesPlayed: 'basura' })] }])[0];
    ok('1f · una cadena sin números cuenta 0', r5.seconds === 0, JSON.stringify(r5));
    const r6 = filas([{ players: [P({ minutesPlayed: 2730 })] }])[0];
    ok('1g · y un número de verdad también vale', r6.seconds === 2730, JSON.stringify(r6));
}

// ═══════ PARTE 2 · partidos, goles y lesiones ═══════
console.log('\n── PARTE 2 · partidos jugados, goles y lesiones ──');
if (!API_OK) { ok('2 · omitida: falta la API', false); } else {
    const sb = build();
    const filas = sb.ctAccumulatePlayerStats([
        { players: [P({ goals: 2, injured: false, minutesPlayed: '60:00' })] },
        { players: [P({ goals: 1, injured: true,  minutesPlayed: '30:00' })] },
        { players: [P({ goals: 0, injured: false, minutesPlayed: '00:00' })] },  // convocado, no jugó
    ]);
    const r = filas[0];
    ok('2a · 🔑 partidos jugados NO cuenta al convocado que no jugó', r.pj === 2,
       'pj=' + r.pj);
    ok('2b · pero sí lo cuenta como convocado, sin perderlo', r.called === 3,
       'called=' + r.called);
    ok('2c · suma los goles', r.goals === 3, r.goals);
    ok('2d · cuenta los partidos con lesión', r.injuries === 1, r.injuries);
    ok('2e · y los minutos totales', r.minutes === 90, r.minutes);

    ok('2f · lista vacía → sin filas, sin lanzar', (() => {
        try { return sb.ctAccumulatePlayerStats([]).length === 0 &&
                     sb.ctAccumulatePlayerStats(null).length === 0; }
        catch (_) { return false; }
    })());
    ok('2g · un partido sin players no rompe', (() => {
        try { return sb.ctAccumulatePlayerStats([{}, { players: null }]).length === 0; }
        catch (_) { return false; }
    })());
}

// ═══════ PARTE 3 · 🔑 las tarjetas, que es donde está la trampa ═══════
console.log('\n── PARTE 3 · 🔑 amarillas de history, rojas de cards ──');
if (!API_OK) { ok('3 · omitida: falta la API', false); } else {
    const sb = build();
    const una = (over) => sb.ctAccumulatePlayerStats([{ players: [P(over)] }])[0];

    // Una amarilla normal.
    const y1 = una({ cards: 'amarilla', history: [EV('yellow')] });
    ok('3a · una amarilla cuenta 1 y 0 rojas', y1.yellow === 1 && y1.red === 0,
       JSON.stringify(y1));

    // 🔑 DOBLE AMARILLA: cards quedó en 'roja' y las dos amarillas sólo están en
    // history. Contando por cards saldría yellow=0, que es el bug que esto evita.
    const y2 = una({ cards: 'roja', history: [EV('yellow', '12:00'), EV('yellow', '70:00')] });
    ok('3b · 🔑 doble amarilla → 2 amarillas Y 1 roja', y2.yellow === 2 && y2.red === 1,
       JSON.stringify(y2));

    // 🔑 ROJA DIRECTA: history trae un 'red' y cards también dice 'roja'. Si se
    // contara de las dos fuentes saldrían 2.
    const r1 = una({ cards: 'roja', history: [EV('red', '55:00')] });
    ok('3c · 🔑 roja directa cuenta 1, no 2 (no se suma history + cards)',
       r1.red === 1 && r1.yellow === 0, JSON.stringify(r1));

    // Sin tarjetas.
    const n1 = una({ cards: 'ninguna', history: [EV('goal')] });
    ok('3d · sin tarjetas, 0 y 0', n1.yellow === 0 && n1.red === 0, JSON.stringify(n1));

    // Sinónimos en inglés que aparecen en el código (collective-report.js los trata).
    const en = una({ cards: 'red', history: [] });
    ok('3e · acepta el sinónimo "red"', en.red === 1, JSON.stringify(en));

    // history todavía en crudo (cadenas), por si algún doc viejo no pasó por el parser.
    const raw = una({ cards: 'roja',
        history: ['TARJETA AMARILLA a las 12:00 (1ªP)', 'DOBLE AMARILLA → EXPULSADO a las 70:00 (2ªP)'] });
    ok('3f · 🔑 también cuenta si history son cadenas sin parsear',
       raw.yellow === 2 && raw.red === 1, JSON.stringify(raw));

    // Acumulación entre partidos.
    const dos = sb.ctAccumulatePlayerStats([
        { players: [P({ cards: 'amarilla', history: [EV('yellow')] })] },
        { players: [P({ cards: 'roja', history: [EV('yellow'), EV('yellow')] })] },
    ])[0];
    ok('3g · acumula tarjetas entre partidos', dos.yellow === 3 && dos.red === 1,
       JSON.stringify(dos));
}

// ═══════ PARTE 4 · identidad del jugador y orden ═══════
console.log('\n── PARTE 4 · un jugador es un jugador ──');
if (!API_OK) { ok('4 · omitida: falta la API', false); } else {
    const sb = build();
    const filas = sb.ctAccumulatePlayerStats([
        { players: [P({ playerNumber: '10', playerAlias: 'Lucas', goals: 1 }),
                    P({ playerNumber: '7',  playerAlias: 'Martín', goals: 2 })] },
        { players: [P({ playerNumber: '10', playerAlias: 'Lucas', goals: 3 })] },
    ]);
    ok('4a · agrupa el mismo dorsal entre partidos', filas.length === 2, filas.length);
    ok('4b · 🔑 ordenado por dorsal numérico (7 antes que 10, no "10" antes que "7")',
       filas[0].number === '7' && filas[1].number === '10',
       filas.map(f => f.number).join(','));
    ok('4c · y suma sus goles', filas[1].goals === 4, filas[1].goals);

    // Sin dorsal → se identifica por el alias, y no se mezcla con otro.
    const sinD = sb.ctAccumulatePlayerStats([
        { players: [P({ playerNumber: '', playerAlias: 'Iván' }),
                    P({ playerNumber: '', playerAlias: 'Nico' })] },
    ]);
    ok('4d · sin dorsal se agrupa por alias, sin mezclarlos', sinD.length === 2,
       JSON.stringify(sinD.map(f => f.alias)));
    ok('4e · los que no tienen dorsal van al final', (() => {
        const mix = sb.ctAccumulatePlayerStats([
            { players: [P({ playerNumber: '', playerAlias: 'Zeta' }),
                        P({ playerNumber: '9', playerAlias: 'Nueve' })] },
        ]);
        return mix[0].number === '9';
    })());
    ok('4f · conserva el alias más reciente que no esté vacío', (() => {
        const a = sb.ctAccumulatePlayerStats([
            { players: [P({ playerNumber: '5', playerAlias: '' })] },
            { players: [P({ playerNumber: '5', playerAlias: 'Cinco' })] },
        ]);
        return a[0].alias === 'Cinco';
    })());
}

// ═══════ PARTE 5 · la tabla ═══════
console.log('\n── PARTE 5 · ctRenderStatsTable ──');
if (!API_OK) { ok('5 · omitida: falta la API', false); } else {
    const sb = build();
    const filas = sb.ctAccumulatePlayerStats([
        { players: [P({ playerNumber: '7', playerAlias: 'Martín', goals: 9,
                        minutesPlayed: '90:00', cards: 'amarilla', history: [EV('yellow')] })] },
    ]);
    const html = sb.ctRenderStatsTable(filas);

    ok('5a · es una tabla', /<table/.test(html));
    ok('5b · 🔑 con las 6 columnas acumuladas que pidió el autor, más el jugador',
       ['Jugador', 'PJ', 'Min', 'Gol', 'Amarilla', 'Roja', 'Lesion']
           .every(t => new RegExp(t, 'i').test(html)),
       html.slice(0, 400));
    ok('5c · el nombre del jugador con su dorsal', /7/.test(html) && /Martín/.test(html));
    ok('5d · los valores acumulados', /\b90\b/.test(html) && /\b9\b/.test(html));
    ok('5e · trae su propio CSS (el panel del Director no inyecta SA_CSS)',
       /<style>/.test(html));
    ok('5f · y no usa las clases .sa-card del Admin de Club', !/sa-card/.test(html));

    // 🔑 Escapado: el alias viene de un formulario del entrenador.
    const malo = sb.ctRenderStatsTable(sb.ctAccumulatePlayerStats([
        { players: [P({ playerAlias: '<img src=x onerror=alert(1)>' })] },
    ]));
    ok('5g · 🔑 el alias va escapado', !/<img/.test(malo) && /&lt;img/.test(malo),
       malo.slice(0, 300));

    ok('5h · sin filas devuelve un aviso, no una tabla vacía',
       /\w/.test(sb.ctRenderStatsTable([])) && !/<tbody>\s*<\/tbody>/.test(sb.ctRenderStatsTable([])));
    ok('5i · no revienta con null', (() => {
        try { sb.ctRenderStatsTable(null); return true; } catch (_) { return false; }
    })());
    ok('5j · incluye una fila de totales del equipo',
       /total/i.test(html));

    // ── 🔑 LA FILA DE TOTALES NO SUMA LO QUE NO SE PUEDE SUMAR ──────────
    // Ajuste pedido por el autor (2026-07-30) tras verlo en producción: sumar
    // los PJ de cada jugador daba 71 en un equipo que habia jugado 14 partidos,
    // y sumar los minutos de toda la plantilla da un numero sin significado.
    // Goles, tarjetas y lesiones SI son magnitudes del equipo y se siguen
    // sumando.
    // ⚠️ `<td[^>]*>` y no `<td>`: las celdas de PJ y minutos del total llevan un
    // atributo title que explica por qué no se suman. Con el regex estricto el
    // parser no casaba NADA y fallaban hasta las aserciones de goles, que sí
    // estaban bien — rojo por la razón equivocada.
    const celdasTotal = (h) => {
        const m = String(h).match(/Total equipo<\/td>((?:<td[^>]*>[^<]*<\/td>){6})/);
        return m ? m[1].replace(/<td[^>]*>/g, ' ').replace(/<\/td>/g, ' ').trim().split(/\s+/) : [];
    };

    const filas2 = sb.ctAccumulatePlayerStats([
        { players: [P({ playerNumber: '7',  playerAlias: 'Martín', goals: 2, minutesPlayed: '90:00',
                        cards: 'amarilla', history: [EV('yellow')], injured: true }),
                    P({ playerNumber: '10', playerAlias: 'Lucas',  goals: 1, minutesPlayed: '45:00' })] },
        { players: [P({ playerNumber: '7',  playerAlias: 'Martín', goals: 3, minutesPlayed: '90:00' })] },
    ]);
    // Dos jugadores, 3 participaciones, 2 partidos de equipo.
    const conCuenta = celdasTotal(sb.ctRenderStatsTable(filas2, { matchCount: 2 }));
    ok('5k · 🔑 PJ del total = partidos del EQUIPO (2), no la suma de PJ (3)',
       conCuenta[0] === '2', JSON.stringify(conCuenta));
    ok('5l · 🔑 los minutos del total NO se suman: celda con guion',
       conCuenta[1] === '-', JSON.stringify(conCuenta));
    ok('5m · 🔑 los goles SI se suman (2+1+3 = 6)', conCuenta[2] === '6',
       JSON.stringify(conCuenta));
    ok('5n · y las amarillas, rojas y lesiones también',
       conCuenta[3] === '1' && conCuenta[4] === '0' && conCuenta[5] === '1',
       JSON.stringify(conCuenta));

    // Sin saber los partidos del equipo, la celda queda con guion — nunca con
    // la suma, que es justo el numero confuso que habia que quitar.
    const sinCuenta = celdasTotal(sb.ctRenderStatsTable(filas2));
    ok('5o · 🔑 sin matchCount, PJ del total es "-" y NUNCA la suma',
       sinCuenta[0] === '-', JSON.stringify(sinCuenta));
    ok('5p · y los goles se siguen sumando igual', sinCuenta[2] === '6',
       JSON.stringify(sinCuenta));

    // Las filas de cada jugador NO cambian: ahí PJ y minutos sí significan algo.
    ok('5q · 🔑 la fila de cada jugador conserva SUS partidos y SUS minutos',
       /<td class="ct-stats-name">[\s\S]*?Martín[\s\S]*?<td>2<\/td><td>180<\/td><td>5<\/td>/.test(
           sb.ctRenderStatsTable(filas2, { matchCount: 2 })),
       (sb.ctRenderStatsTable(filas2, { matchCount: 2 })
           .match(/Martín[\s\S]{0,160}/) || [''])[0]);
}

// ═══════ PARTE 6 · el módulo sigue limpio ═══════
console.log('\n── PARTE 6 · censos ──');
{
    const m = sinCom(src);
    ok('6a · 🔑 el módulo sigue sin tocar Firestore',
       !/firebasejs|getDocs|collection\(/.test(m));
    ok('6b · 🔑 sigue habiendo UNA sola normalización de tildes',
       (m.match(/normalize\('NFD'\)/g) || []).length === 1,
       'aparece ' + (m.match(/normalize\('NFD'\)/g) || []).length + ' veces');
    ok('6c · el acumulador no cuenta rojas desde history',
       !/type === 'red'/.test(m) || /cards/.test(m));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

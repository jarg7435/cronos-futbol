// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v713 · LOS TXT DESCARGADOS: SIN [object Object] Y CON P/R
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-14, capturas 10401-10403):
//
//   1 · INFORME INDIVIDUAL (.txt, Área de Familias): «añadir de forma
//       explícita y limpia el recuento de Pérdidas y Recuperaciones del
//       jugador en el bloque de rendimiento, de modo que coincida con lo que
//       ya se visualiza en la interfaz gráfica». La tarjeta de la captura
//       10401 enseña «▲ 2 recuperaciones · ▼ 1 pérdidas» y el fichero que esa
//       misma tarjeta ofrece no las llevaba.
//
//   2 · INFORME COLECTIVO (.txt, Mis Informes del entrenador): «eliminar el
//       error [object Object]». Capturas 10402/10403: CINCO líneas seguidas de
//       «· [object Object]» bajo el jugador con más historial.
//
//   3 · «Formato claro y conciso… plena coherencia visual con la estructura
//       clara de los informes de la aplicación».
//
//  🔑🔑 LA CAUSA DEL [object Object]: el TXG volcaba `p.history` con una
//  interpolación de texto, y DESDE v531 esos apuntes son OBJETOS
//  (`{type, minute, second, timeStr, note}`). Interpolar un objeto da
//  «[object Object]» y NO LANZA NINGÚN ERROR: por eso llevaba meses así.
//
//  🔑 Y NO SE ARREGLA CON UN ROTULITO POR TIPO. La traducción correcta ya
//  existía en el módulo de descargas (`rxEtiquetaSuceso` + los sucesos reales,
//  del CSV, 2026-08-08) con las dos trampas resueltas:
//    · la CONTABILIDAD DE FASE no es una sustitución (el «Sale (DESCANSO)» que
//      la app apunta a todos los que están en el campo: en un F11 son 11
//      cambios falsos);
//    · hay sucesos QUE SE TIPAN COMO LO QUE NO SON — un «GOL ANULADO» se tipa
//      'goal' y una segunda amarilla se tipa 'yellow'. Un informe que se
//      imprime y se reparte no puede decir que hubo un gol que el árbitro
//      anuló.
//  Así que el TXT consume ESA función (`rxLineasIncidencias`, nueva, que
//  devuelve una línea por suceso y de la que `rxIncidencias` ahora es un
//  `join`) en vez de estrenar un tercer criterio.
//
//  LO QUE VIGILA ESTE FICHERO:
//   A · el TXT del entrenador se GENERA DE VERDAD (ejecutado, con un DOM y un
//       Blob simulados) y NO contiene «[object Object]» jamás;
//   B · las incidencias salen en español, una por línea, sin la contabilidad
//       de fase y con el matiz de gol anulado / doble amarilla;
//   C · las P/R salen en el resumen, en la ficha de cada jugador y en su
//       bloque de desglose, con los mismos números que la pantalla;
//   D · un partido SIN P/R no escribe ni una línea de P/R (ni ceros);
//   E · el TXT de la familia lleva las suyas, con LAS DOS PUERTAS de la
//       pantalla (extra encendido + ese partido trae el dato);
//   F · la regla de «de qué copia de matchPR me fío» es UNA
//       (`cronosPRDelInforme`), y da lo MISMO que la copia privada del motor
//       de informes, que no puede llamarla porque es autocontenido.
// ═══════════════════════════════════════════════════════════════════════════
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
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 400));
        fallos++;
    }
}

// Corta un trozo de código emparejando llaves desde el primer '{' tras `desde`.
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
const INDIV  = leer('js/coach/comms/individual-reports.js');
const PADRE  = leer('js/parent/panel.js');
const EXPORT = leer('js/coach/reports/reports-export.js');
const ENGINE = leer('js/coach/reports/report-engine.js');

// ── El partido de la captura 10402, reducido a lo que importa ──────────────
//  BRUNO (#10) es el jugador con las cinco «[object Object]» de la captura.
const ev = (type, min, sec, extra) =>
    Object.assign({ type: type, minute: min, second: sec || 0,
                    timeStr: String(min).padStart(2, '0') + ':' + String(sec || 0).padStart(2, '0') },
                  extra || {});

const PARTIDO = () => ({
    rival: 'MASPALOMAS', matchDate: '2026-09-14', myTeamRole: 'away',
    scoreHome: 1, scoreAway: 2, category: 'f11_regional', subcategory: '',
    coachEmail: 'arinagazone@gmail.com', participantsCount: 18, playedCount: 12,
    matchPR: {
        perdidas:       { total: 5, sinAsignar: 2, porDorsal: { '10': 1, '13': 1, '18': 1 } },
        recuperaciones: { total: 8, sinAsignar: 3, porDorsal: { '10': 2, '13': 1, '17': 1, '19': 1 } },
    },
    players: [
        { playerNumber: '10', playerAlias: 'BRUNO', minutesPlayed: '07:06', goals: 1,
          cards: 'ninguna', injured: true, history: [
            ev('sub_out', 0, 30, { note: 'Sale a las 00:30 (DESCANSO)' }),
            ev('sub_in',  0, 30, { note: 'Entra a las 00:30 (2ªP)' }),
            ev('injury',  0, 37, { note: 'LESIÓN a las 00:37 (2ªP)' }),
            ev('goal',    0, 38, { note: 'GOL (1º) a las 00:38 (2ªP)' }),
            ev('sub_out', 0, 55, { note: 'Sale a las 00:55 (FIN)' }),
          ] },
        { playerNumber: '14', playerAlias: 'BINGO', minutesPlayed: '07:06', goals: 0,
          cards: 'amarilla', injured: true, history: [
            ev('yellow', 0, 31, { note: 'AMARILLA a las 00:31' }),
          ] },
        { playerNumber: '2', playerAlias: 'PEDRO', minutesPlayed: '00:00', goals: 0,
          cards: 'ninguna', injured: false, history: [] },
    ],
});

// Ejecuta window.miDescargarInforme y devuelve el TXT que habría descargado.
function txtDelEntrenador(partido, opciones) {
    const fn = trozo(INDIV, 'window.miDescargarInforme = (key64) => {');
    if (!fn) return null;
    const o = opciones || {};
    let capturado = null;
    const ctx = {
        console, Date, String, Number, Array, Object, JSON, Math, RegExp, parseInt,
        escape: s => s, unescape: s => s, atob: s => s, decodeURIComponent: s => s,
        Blob: function (partes) { capturado = String(partes[0]); },
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
        document: {
            createElement: () => ({ click() {}, set href(v) {}, set download(v) {} }),
            body: { appendChild() {}, removeChild() {} },
        },
        showToast: () => {},
        me: { clubName: 'CD DÍA' },
    };
    ctx.window = {
        _misInformesData: { K: partido },
        cronosEnfrentamiento: o.sinEnfrentamiento ? undefined : function (d, mio) {
            const fuera = d.myTeamRole === 'away';
            const suyo = d.rival || 'Rival';
            return { fuera: fuera, local: fuera ? suyo : mio, visitante: fuera ? mio : suyo,
                     titulo: (fuera ? suyo : mio) + ' vs ' + (fuera ? mio : suyo),
                     marcador: d.scoreHome + '-' + d.scoreAway, veredicto: 'VICTORIA' };
        },
        cronosPRDelInforme: o.sinPRHelper ? undefined : PR_COMPARTIDA,
        rxLineasIncidencias: o.sinIncidencias ? undefined : RX_LINEAS,
    };
    vm.createContext(ctx);
    vm.runInContext(fn, ctx);
    ctx.window.miDescargarInforme('K');
    return capturado;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [F] la regla de P/R es UNA, y coincide con el motor ──');
// ═══════════════════════════════════════════════════════════════════════════
let PR_COMPARTIDA = null, PR_MOTOR = null;
{
    const fn = trozo(UTILS, 'function cronosPRDelInforme(datos)');
    ok('1a · se encuentra cronosPRDelInforme en js/core/utils.js', !!fn);
    ok('1b · se publica UNA sola vez',
       (UTILS.match(/window\.cronosPRDelInforme\s*=/g) || []).length === 1 &&
       (UTILS.match(/function cronosPRDelInforme\s*\(/g) || []).length === 1);
    if (fn) {
        const ctx = { console };
        vm.createContext(ctx);
        vm.runInContext(fn + ';\n;globalThis.f = cronosPRDelInforme;', ctx);
        PR_COMPARTIDA = ctx.f;
    }

    const fnMotor = trozo(ENGINE, 'const _prDelInforme = (mm) => {');
    ok('1c · se encuentra la copia privada del motor de informes', !!fnMotor);
    if (fnMotor) {
        const ctx2 = { console };
        vm.createContext(ctx2);
        vm.runInContext(fnMotor + ';\n;globalThis.f = _prDelInforme;', ctx2);
        PR_MOTOR = ctx2.f;
    }

    if (PR_COMPARTIDA && PR_MOTOR) {
        const flaco = { perdidas: { total: 0 }, recuperaciones: { total: 0 } };
        const gordo = { perdidas: { total: 5, porDorsal: { '10': 1 } },
                        recuperaciones: { total: 8, porDorsal: { '10': 2 } } };
        const casos = [
            ['al nivel del partido', { matchPR: gordo, players: [] }],
            ['repetido en cada jugador', { players: [{ matchPR: gordo }, { matchPR: gordo }] }],
            ['🔑 el ejemplar MÁS COMPLETO gana al vacío',
             { players: [{ matchPR: flaco }, { matchPR: gordo }, { matchPR: flaco }] }],
            ['sin dato ninguno', { players: [{}, {}] }],
            ['sin jugadores', {}],
        ];
        let iguales = 0; const malos = [];
        casos.forEach(([etq, m]) => {
            const a = PR_COMPARTIDA(m), b = PR_MOTOR(m);
            if (JSON.stringify(a || null) === JSON.stringify(b || null)) iguales++;
            else malos.push(etq);
        });
        ok('1d · 🔑🔑 [F] la compartida y la del motor dan LO MISMO en los ' +
           casos.length + ' casos', iguales === casos.length, malos.join(' || '));
        ok('1e · 🔑 y el ejemplar elegido es el que trae el desglose',
           (PR_COMPARTIDA({ players: [{ matchPR: flaco }, { matchPR: gordo }] }) || {}).perdidas.total === 5);
        ok('1f · sin dato devuelve nulo (no un objeto vacío que parezca un cero)',
           PR_COMPARTIDA({ players: [{}] }) == null);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [B] las incidencias, línea a línea y en español ──');
// ═══════════════════════════════════════════════════════════════════════════
let RX_LINEAS = null;
{
    // Se cargan las tres piezas del módulo de descargas que hacen falta.
    const piezas = ['const RX_SUCESO = {', 'function _rxNota(e)', 'function _rxFaseInequivoca(e)',
                    'function _rxEntraSegundaParte(e)', 'function _rxClaveT(e)',
                    'function _rxSucesosReales(hist)', 'window.rxEtiquetaSuceso = function (e)',
                    'window.rxLineasIncidencias = function (p)', 'window.rxIncidencias = function (p)']
        .map(a => trozo(EXPORT, a));
    ok('2a · se encuentran las piezas de incidencias de reports-export.js',
       piezas.every(Boolean), piezas.map((p, i) => p ? '' : i).filter(String));

    if (piezas.every(Boolean)) {
        const ctx = { console, window: {}, String, Set, RegExp, Number, Array, parseInt };
        vm.createContext(ctx);
        vm.runInContext(piezas.join(';\n') + ';', ctx);
        RX_LINEAS = ctx.window.rxLineasIncidencias;

        ok('2b · rxLineasIncidencias devuelve UNA LÍNEA POR SUCESO (no un objeto)',
           Array.isArray(RX_LINEAS(PARTIDO().players[0])) &&
           RX_LINEAS(PARTIDO().players[0]).every(l => typeof l === 'string'));

        const lineas = RX_LINEAS(PARTIDO().players[0]);
        ok('2c · 🔑🔑 ninguna línea es «[object Object]»',
           lineas.length > 0 && lineas.every(l => l.indexOf('[object Object]') < 0), lineas);
        ok('2d · 🔑 el gol y la lesión salen con su minuto y en español',
           lineas.indexOf('00:38 Gol') >= 0 && lineas.indexOf('00:37 Lesión') >= 0, lineas);
        ok('2e · 🔑 y la contabilidad de fase (DESCANSO / 2ªP / FIN) se queda fuera',
           lineas.length === 2, lineas);

        ok('2f · 🔑 un GOL ANULADO no se escribe como un gol',
           RX_LINEAS({ history: [ev('goal', 10, 0, { note: 'GOL ANULADO (Quedan: 1)' })] })[0]
             === '10:00 Gol anulado');
        ok('2g · 🔑 y una segunda amarilla se escribe como la expulsión que es',
           /expulsi/i.test(RX_LINEAS({ history: [ev('yellow', 10, 0, { note: 'DOBLE AMARILLA → EXPULSADO' })] })[0]));
        ok('2h · el historial ANTIGUO (cadenas) se respeta tal cual',
           RX_LINEAS({ history: ['Gol a las 10:00 (1ªP)'] })[0] === 'Gol a las 10:00 (1ªP)');
        ok('2i · ⚠️ rxIncidencias (la celda del CSV) es el MISMO dato, unido',
           ctx.window.rxIncidencias(PARTIDO().players[0]) === lineas.join(' | '),
           ctx.window.rxIncidencias(PARTIDO().players[0]));
        ok('2j · sin historial, ni una línea', RX_LINEAS({}).length === 0);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · [A][C] el TXT del entrenador, GENERADO DE VERDAD ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const txt = txtDelEntrenador(PARTIDO());
    ok('3a · se genera el fichero (no una excepción a media escritura)',
       !!txt && txt.length > 400, txt && txt.length);

    if (txt) {
        ok('3b · 🔑🔑 [A] NO aparece «[object Object]» en ninguna parte',
           txt.indexOf('[object Object]') < 0,
           (txt.split(/\r?\n/).filter(l => /object Object/.test(l))[0] || ''));
        ok('3c · la cabecera va en orden de localía (v712) y con el marcador',
           /Encuentro:\s+MASPALOMAS vs CD DÍA/.test(txt) &&
           /Resultado:\s+1 - 2\s+\(VICTORIA\)/.test(txt), txt.slice(0, 260));

        ok('3d · [C] hay un bloque RESUMEN con las cuatro cifras de la pantalla',
           /\nRESUMEN\r?\n/.test(txt) && /Convocados:\s+18\s+\(12 jugaron\)/.test(txt) &&
           /Goles:\s+1/.test(txt) && /Tarjetas:\s+1 amarilla/.test(txt) &&
           /Lesiones:\s+2/.test(txt),
           (txt.match(/RESUMEN[\s\S]{0,260}/) || [''])[0]);

        ok('3e · 🔑 las incidencias de cada jugador van en español y sangradas',
           /Incidencias:\r?\n\s+· 00:37 Lesión\r?\n\s+· 00:38 Gol/.test(txt),
           (txt.match(/#10[\s\S]{0,300}/) || [''])[0]);
        ok('3f · 🔑 y sin las falsas sustituciones del descanso',
           !/DESCANSO/.test(txt) && !/\(FIN\)/.test(txt),
           (txt.split(/\r?\n/).filter(l => /DESCANSO|\(FIN\)/.test(l))[0] || ''));

        ok('3g · 🔵🔴 [C] cada jugador lleva SUS pérdidas y recuperaciones',
           /#10 BRUNO[\s\S]{0,200}Pérdidas: 1 \| Recuperaciones: 2/.test(txt),
           (txt.match(/#10 BRUNO[\s\S]{0,200}/) || [''])[0]);
        ok('3h · 🔵🔴 y el jugador sin registro sale a cero, no en blanco',
           /# 2 PEDRO[\s\S]{0,200}Pérdidas: 0 \| Recuperaciones: 0/.test(txt),
           (txt.match(/# 2 PEDRO[\s\S]{0,160}/) || [''])[0]);

        ok('3i · 🔵🔴 [C] hay bloque de desglose con totales y balance',
           /PÉRDIDAS Y RECUPERACIONES/.test(txt) &&
           /Total: 5 pérdidas · 8 recuperaciones · balance \+3/.test(txt),
           (txt.match(/PÉRDIDAS Y RECUPERACIONES[\s\S]{0,320}/) || [''])[0]);
        ok('3j · 🔑 una fila por dorsal con registro, ordenada por dorsal',
           /#10 BRUNO  ·  1 pérdida  ·  2 recuperaciones/.test(txt) &&
           txt.indexOf('#10 BRUNO  ·') < txt.indexOf('#13  ·'),
           (txt.match(/Total: [\s\S]{0,320}/) || [''])[0]);
        // ⚠️ Concordancia: un informe oficial no puede decir «1 pérdidas». Y el
        // dorsal que no está entre los convocados se queda SOLO, sin una raya
        // de relleno ni un nombre inventado.
        ok('3j-bis · en singular se escribe «1 pérdida» y «1 recuperación»',
           /#13  ·  1 pérdida  ·  1 recuperación\b/.test(txt) &&
           !/1 pérdidas|1 recuperaciones/.test(txt),
           (txt.match(/#1[0-9][^\n]*/g) || []).join(' || '));
        ok('3k · 🔑 y los registros a nivel COLECTIVO no se pierden',
           /Registros a nivel colectivo \(sin jugador asignado\): 2 pérdidas · 3 recuperaciones/.test(txt),
           (txt.match(/Registros a nivel[\s\S]{0,140}/) || [''])[0]);
        ok('3l · el resumen también los trae, con su balance',
           /Pérdidas:\s+5\r?\n/.test(txt) && /Recuperaciones:\s+8\s+\(balance \+3\)/.test(txt));

        // [D] Un partido de antes del registro de P/R: ni una línea, ni ceros.
        const viejo = PARTIDO();
        delete viejo.matchPR;
        const txtViejo = txtDelEntrenador(viejo);
        ok('3m · ⚠️ [D] un partido SIN P/R no escribe el bloque…',
           !!txtViejo && !/PÉRDIDAS Y RECUPERACIONES/.test(txtViejo));
        ok('3n · ⚠️ [D] …ni una línea de P/R por jugador (ceros inventados)',
           !!txtViejo && !/Pérdidas:/.test(txtViejo),
           (txtViejo || '').split(/\r?\n/).filter(l => /érdidas/.test(l)).join(' | '));
        ok('3o · pero el resto del informe se escribe igual',
           !!txtViejo && /#10 BRUNO/.test(txtViejo) && /00:38 Gol/.test(txtViejo));

        // El TXT no puede depender de que el módulo de descargas esté cargado.
        const sinRx = txtDelEntrenador(PARTIDO(), { sinIncidencias: true });
        ok('3p · ⚠️ sin el módulo de descargas cargado se omiten las incidencias, ' +
           'pero NO vuelve el [object Object]',
           !!sinRx && sinRx.indexOf('[object Object]') < 0 && !/Incidencias:/.test(sinRx));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · [E] el TXT individual de la familia ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const zona = PADRE.slice(PADRE.indexOf('window._ppDownloadReport = (reportId) => {'),
                             PADRE.indexOf('CRONOLOGÍA'));
    ok('4a · se encuentra el generador del TXT de la familia', zona.length > 200);
    ok('4b · 🔵🔴 [E] escribe las pérdidas y las recuperaciones del jugador',
       /L\.push\(`Pérdidas:\s+\$\{_prTxt\.p\}`\)/.test(zona) &&
       /L\.push\(`Recuperaciones:\s*\$\{_prTxt\.r\}`\)/.test(zona), 'no las escribe');
    ok('4c · 🔑 con LAS DOS PUERTAS de la pantalla: el extra y que el partido traiga el dato',
       /if\s*\(_prVisible\s*&&\s*_prTxt\.hay\)/.test(zona),
       'sin la segunda puerta, un informe viejo saldría con ceros (v710)');
    ok('4d · 🔑 y del MISMO sitio que la tarjeta (_prDeInforme), no de una cuenta propia',
       /_prDeInforme\(r\)/.test(zona));
    ok('4e · el bloque sigue siendo el de RENDIMIENTO, junto a goles y tarjetas',
       zona.indexOf('RENDIMIENTO') < zona.indexOf('_prTxt'));
    ok('4f · y la cabecera del fichero mantiene el orden de localía (v712)',
       /Encuentro:\s+\$\{_enfTxt\.titulo\}/.test(zona));
}

console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }

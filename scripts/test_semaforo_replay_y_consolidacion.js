// ─────────────────────────────────────────────────────────────────────────
// test_semaforo_replay_y_consolidacion.js · las dos anomalías de la v524
// reportadas el 2026-08-14
//
// Las dos se diagnosticaron LEYENDO LOS PARTIDOS REALES por REST antes de
// tocar código, y las cifras de este guard son las de esos partidos.
//
// ══ A · SEMÁFORO DE LA REPETICIÓN ═══════════════════════════════════════
// Reporte: "en un partido configurado de 35+35 donde sólo jugamos 5-6
// minutos, la repetición muestra cambios de color que nunca ocurrieron".
//
// Medido en `local-14082026-5txs-0106`:
//     half1MaxTime + half2MaxTime = 4200 s   (el reglamento configurado)
//     timeH1 + timeH2             =  360 s   (lo que se jugó de verdad)
//     timerThresholds             = { red: 30, yellow: 50 }
//
// 🔑🔑🔑 EN VIVO el semáforo usa el REGLAMENTO (getTimerColor, app-init.js):
// umbrales en 1260 s y 2100 s → con 6 minutos NADIE los alcanza y el equipo
// entero se queda en rojo. La REPETICIÓN usaba _calculateMaxTime, que
// prefiere lo JUGADO: umbrales en 108 s y 180 s, y jugadores con 94, 141 o
// 266 s cruzaban a ámbar y a verde. Colores que nunca existieron.
//
// 🔑 _calculateMaxTime NO ESTABA MAL: es la base correcta para la BARRA de
// tiempo, que debe abarcar lo jugado para que ningún suceso quede fuera
// (v394/v446). Son dos preguntas distintas: la barra mide tiempo
// transcurrido, el semáforo mide qué parte del PARTIDO jugó cada uno.
//
// ⚠️ v446 SE CONSERVA. Aquel arreglo atendía el caso contrario —partido
// ALARGADO por descuento, donde el reglamento se queda corto y todos
// verdeaban antes de tiempo—. Por eso la base es max(reglamento, jugado) y
// no una vuelta al reglamento a secas.
//
// ══ B · PARTIDO QUE NO CONSOLIDA ════════════════════════════════════════
// Reporte: "hay un 2-0 en Partidos Terminados que no se ha sumado al
// acumulado del Director".
//
// Comprobado por REST: el partido de las 23:52 escribió sus 29 informes; el
// de las 00:12 no escribió NINGUNO, y tampoco generó notificación.
//
// 🔑🔑🔑 `window.liveMatchId` ES SIEMPRE `undefined`: liveMatchId se declara
// `let liveMatchId = null` en js/core/app-init.js:123, y una declaración
// LÉXICA de nivel superior no crea propiedad de window. El guard de
// idempotencia leía `window.liveMatchId || <respaldo>`, así que cogía
// SIEMPRE el respaldo: local_{uid}_{fecha}_{nombre}-{goles}-{goles}. Dos
// pruebas rápidas el mismo día con el mismo resultado comparten clave, y la
// segunda sale por el `return` sin escribir nada y sin un solo aviso.
//
// ⚠️ Y UN FALLO DEJABA LA CLAVE PUESTA PARA SIEMPRE: el catch sólo soltaba
// la huella EN MEMORIA. El "reintento manual" que prometía su comentario era
// inalcanzable, porque el guard de localStorage volvía a cortar.
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

const SRC_REPLAY = fs.readFileSync(path.join(ROOT, 'js/match/replay/replay-player.js'), 'utf8');
const SRC_AUTO   = fs.readFileSync(path.join(ROOT, 'js/coach/comms/match-reports-auto.js'), 'utf8');
const SRC_INIT   = fs.readFileSync(path.join(ROOT, 'js/core/app-init.js'), 'utf8');

// ═════════════════════════════════════════════════════════════════════
// A · EL SEMÁFORO DE LA REPETICIÓN
// ═════════════════════════════════════════════════════════════════════
// Se reimplementa la fórmula tal como queda en el fuente y se comprueba con
// las cifras reales. La función vive dentro de una IIFE enorme con
// dependencias de DOM; lo que importa —y lo que se rompió— es LA BASE.
{
    // El bloque del semáforo, tal cual está escrito.
    const bloque = SRC_REPLAY.slice(SRC_REPLAY.indexOf('// ── 2. Umbrales ──'),
                                    SRC_REPLAY.indexOf('// ── Construir la UI Modal'));

    ok('A1 · 🔑🔑 la base del semáforo NO es sólo _calculateMaxTime',
       !/const totalSec = _calculateMaxTime\(data, _replayState\.events\);/.test(bloque),
       'sigue usando la base de la BARRA, que es lo que inventaba colores');

    ok('A2 · 🔑 se toma el máximo entre reglamento y jugado',
       /Math\.max\(\s*_semReglamento\s*,\s*_semBarra\s*\)/.test(bloque),
       (bloque.match(/const totalSec[^;]*;/) || [''])[0]);

    ok('A3 · ⚠️ y el reglamento sale de _reglamentarioSec, no de un literal',
       /_reglamentarioSec\(data\)/.test(bloque));

    // ── La fórmula, con los números del partido real ──
    const base = (reglamento, jugado) => Math.max(reglamento, jugado);
    const color = (t, total, red, yellow) =>
        t >= total * (yellow / 100) ? 'verde'
      : t >= total * (red    / 100) ? 'ambar'
      : 'rojo';

    const REGLAMENTO = 2100 + 2100;   // 35+35 configurados
    const JUGADO     = 180 + 180;     // lo que duró de verdad
    const RED = 30, YELLOW = 50;

    // Antes: base = jugado (360) → umbrales 108 y 180.
    const antes = JUGADO;
    ok('A4 · 🔑 ANTES un jugador de 266 s salía VERDE (nunca pasó en vivo)',
       color(266, antes, RED, YELLOW) === 'verde');
    ok('A5 · 🔑 y uno de 141 s salía ÁMBAR',
       color(141, antes, RED, YELLOW) === 'ambar');

    // Ahora: base = max(4200, 360) = 4200 → umbrales 1260 y 2100.
    const ahora = base(REGLAMENTO, JUGADO);
    ok('A6 · 🔑🔑 AHORA la base es el reglamento (4200 s), no lo jugado',
       ahora === 4200, String(ahora));
    ok('A7 · 🔑🔑 y los tres jugadores se quedan en ROJO, como en vivo',
       color(266, ahora, RED, YELLOW) === 'rojo' &&
       color(141, ahora, RED, YELLOW) === 'rojo' &&
       color(94,  ahora, RED, YELLOW) === 'rojo');

    // ⚠️ v446 sigue en pie: partido ALARGADO por descuento.
    const alargado = base(4200, 4680);   // 70' de reglamento, 78' jugados
    ok('A8 · ⚠️ en un partido ALARGADO la base sigue creciendo (v446 intacto)',
       alargado === 4680, String(alargado));
    // ⚠️ Las cifras importan: con 2200 s el jugador cae JUSTO entre los dos
    // umbrales (reglamento 50% = 2100; alargado 50% = 2340). Es el caso que
    // demuestra v446; con 2400 s sale verde en los dos y no prueba nada — la
    // primera versión de esta aserción usaba 2400 y estaba mal calculada.
    ok('A9 · ⚠️ con la base ALARGADA, 2200 s es ÁMBAR y no verdea antes de tiempo',
       color(2200, alargado, RED, YELLOW) === 'ambar' &&
       color(2200, 4200,     RED, YELLOW) === 'verde',
       'alargado=' + color(2200, alargado, RED, YELLOW) + ' reglamento=' + color(2200, 4200, RED, YELLOW));

    // La barra de tiempo NO se toca: sigue usando lo jugado.
    ok('A10 · 🔑 la BARRA conserva su propia base (_calculateMaxTime existe y se usa)',
       /function _calculateMaxTime\(/.test(SRC_REPLAY) &&
       /_calculateMaxTime\(/.test(SRC_REPLAY.slice(0, SRC_REPLAY.indexOf('// ── 2. Umbrales ──'))),
       'la barra debe seguir abarcando lo jugado');
}

// ═════════════════════════════════════════════════════════════════════
// B · EL GUARD QUE IMPEDÍA CONSOLIDAR
// ═════════════════════════════════════════════════════════════════════
{
    ok('B0 · ⚠️ liveMatchId SIGUE siendo léxico (por eso window.liveMatchId no vale)',
       /^let liveMatchId\s*=/m.test(SRC_INIT),
       'si algún día pasa a ser window.*, esta aserción avisa de que el arreglo se puede simplificar');

    const bloque = SRC_AUTO.slice(SRC_AUTO.indexOf('async function saveAllMatchReportsInternal'),
                                  SRC_AUTO.indexOf('// ── E4: GUARD DE IDEMPOTENCIA'));
    // ⚠️ SIN COMENTARIOS. El propio arreglo EXPLICA el defecto nombrando
    // `window.liveMatchId`, así que medir sobre el texto crudo hace que el
    // guard se dispare con su propia documentación. Ya pasó una vez en esta
    // misma sesión con otro censo; es una trampa recurrente.
    const codigo = bloque.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

    ok('B1 · 🔑🔑🔑 el guard YA NO lee window.liveMatchId',
       !/window\.liveMatchId/.test(codigo),
       (codigo.match(/.{0,50}window\.liveMatchId.{0,50}/) || [''])[0]);

    ok('B2 · 🔑 lo lee con typeof, como el resto del fichero',
       /typeof liveMatchId !== 'undefined' && liveMatchId/.test(bloque),
       (bloque.match(/const _liveId[^;]*;/) || [''])[0]);

    ok('B3 · ⚠️ conserva el respaldo por fecha+marcador (sobrevivir a recargas)',
       /local_' \+/.test(bloque));

    ok('B4 · ⚠️ y ahora avisa en consola en vez de salir en silencio',
       /console\.warn\('\[AutoReport\] Informes ya despachados/.test(bloque),
       'un return mudo es lo que hizo que esto tardara semanas en verse');

    // ── La clave, simulada con los datos reales de los dos partidos ──
    const clave = (liveId, uid, fechaUTC, home, gh, ga) =>
        'cronos_reports_sent_' + (liveId || ('local_' + uid + '_' + fechaUTC + '_' + home + '-' + gh + '-' + ga));

    const UID = 'GkycFVeqFsWD9JODEjjE3JSMw2v1';
    // ANTES: liveId siempre '' porque window.liveMatchId era undefined.
    const antes1 = clave('', UID, '2026-08-14', 'LOCAL', '2', '0');
    const antes2 = clave('', UID, '2026-08-14', 'LOCAL', '2', '0');
    ok('B5 · 🔑🔑 ANTES: dos partidos distintos del mismo día con el mismo ' +
       'resultado compartían clave',
       antes1 === antes2, antes1);

    // AHORA: cada partido lleva su propio liveMatchId.
    const ahora1 = clave('local-14082026-5txs-0047', UID, '2026-08-13', 'LOCAL', '1', '0');
    const ahora2 = clave('local-14082026-5txs-0106', UID, '2026-08-14', 'LOCAL', '2', '0');
    ok('B6 · 🔑🔑 AHORA cada partido tiene la suya',
       ahora1 !== ahora2 &&
       ahora2 === 'cronos_reports_sent_local-14082026-5txs-0106',
       ahora1 + ' | ' + ahora2);

    // Y con el mismo resultado el mismo día, si son partidos distintos,
    // tampoco colisionan.
    const a = clave('local-14082026-aaaa-0001', UID, '2026-08-14', 'LOCAL', '2', '0');
    const b = clave('local-14082026-bbbb-0002', UID, '2026-08-14', 'LOCAL', '2', '0');
    ok('B7 · 🔑🔑🔑 dos pruebas rápidas 2-0 el mismo día YA NO se pisan',
       a !== b, a + ' vs ' + b);

    // ── El fallo ya no bloquea para siempre ──
    const catchBloque = SRC_AUTO.slice(SRC_AUTO.indexOf('// Si falló, liberar la huella'),
                                       SRC_AUTO.indexOf('// Si falló, liberar la huella') + 900);
    ok('B8 · 🔑🔑 un fallo suelta TAMBIÉN la clave persistente',
       /localStorage\.removeItem\(_guardKey\)/.test(catchBloque),
       catchBloque.slice(0, 250));
    ok('B9 · ⚠️ y sigue soltando la huella en memoria',
       /_cronosLastDispatchedMatch = null/.test(catchBloque));
}

console.log('\n' + (fail === 0 ? 'OK' : 'FALLOS') + ': ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);

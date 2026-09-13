// ─────────────────────────────────────────────────────────────────────────
// test_asistencia_retraso.js · Estado RETRASO en asistencia (v703)
//
// Encargo del autor: poder registrar que un jugador ASISTE pero LLEGA TARDE
// (trabajo, estudios…), con icono propio, marcable en el pase de lista diario,
// y reflejado en el parte mensual y en su desglose acumulado,
// "contabilizándolo correctamente de forma INDEPENDIENTE a las faltas o
// ausencias totales".
//
// 🚨🚨 LO QUE ESTE GUARD PROTEGE DE VERDAD: que un retraso NO se convierta en
// una falta por ningún camino. El control de asistencia se usa para decidir
// convocatorias; contar como ausente a un chaval que fue —aunque llegara
// tarde— es exactamente el daño que el encargo viene a evitar, y hay CINCO
// sitios que leen estas marcas (el parte, el pase de lista, el texto del
// informe, el panel de Familias y el resumen del club). Por eso aquí se
// EJECUTA el almacén real y se recorren los cinco.
//
// El caso simétrico también se vigila: que el retraso no desaparezca de los
// recuentos (si no sumara en `asistencias`, el porcentaje del equipo se
// calcularía sobre menos sesiones de las que hubo).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const SRC_UTILS = fs.readFileSync(path.join(ROOT, 'js/core/utils.js'), 'utf8');
const SRC_SYNC  = fs.readFileSync(path.join(ROOT, 'js/services/training-firestore-sync.js'), 'utf8');
const SRC_STORE = fs.readFileSync(path.join(ROOT, 'js/coach/attendance/attendance-store.js'), 'utf8');
const SRC_PANEL = fs.readFileSync(path.join(ROOT, 'js/coach/attendance/panel.js'), 'utf8');
const SRC_PPANEL= fs.readFileSync(path.join(ROOT, 'js/parent/panel.js'), 'utf8');
const SRC_CLUB  = fs.readFileSync(path.join(ROOT, 'js/coach/reports/club-reports.js'), 'utf8');

function nuevoEntorno() {
    const store = {};
    const localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    const win = {};
    const ctx = {
        window: win, localStorage,
        console: { log(){}, warn(){}, error(){}, debug(){} },
        setTimeout: () => 0, clearTimeout: () => {},
        Promise, Date, JSON, Object, Array, String, Number, Boolean, Math,
        RegExp, isNaN, parseInt, parseFloat, Error,
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
        navigator: { userAgent: 'node' }
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC_UTILS, ctx);
    vm.runInContext(SRC_SYNC, ctx);
    vm.runInContext(SRC_STORE, ctx);
    return { ctx, win, localStorage };
}

// Lunes y miércoles entrenamiento; sábado partido.
const SESIONES = [
    { fecha: '2026-08-10', tipo: 'entrenamiento', tipoRaw: 'entrenamiento', hora: '17:00' },
    { fecha: '2026-08-12', tipo: 'entrenamiento', tipoRaw: 'entrenamiento', hora: '17:00' },
    { fecha: '2026-08-15', tipo: 'partido',       tipoRaw: 'partido liga',  hora: '10:00' },
];
const PLANTEL = [
    { ficha: 'ALC01', dorsal: 1, alias: 'Ana',  nombre: 'Ana Ruiz' },
    { ficha: 'ALC02', dorsal: 2, alias: 'Beto', nombre: 'Beto Sanz' },
];

const { ctx, win } = nuevoEntorno();
const A = win.CronosAttendance;
ok('0 · el almacén está cargado', !!A && typeof A.resumenJugador === 'function');

// ═════════════════════════════════════════════════════════════════════
// 1 · EL VOCABULARIO ADMITE 'R'
// ═════════════════════════════════════════════════════════════════════
win._cronosCurrentUser = {
    uid: 'uid_1', clubId: 'clubA',
    allRoles: [{ role: 'user', clubId: 'clubA', category: 'alevin', subcategory: 'A', isAuthorized: true }]
};
ok('1a · marcar() acepta el estado RETRASO',
   A.marcar('2026-08-10', 'ALC01', 'R', null, SESIONES[0]) === true);
ok('1b · …y con causa (trabajo, estudios…)',
   A.marcar('2026-08-12', 'ALC01', 'R', 'trabajo', SESIONES[1]) === true);
ok('1c · CONTROL · un estado inventado se sigue rechazando',
   A.marcar('2026-08-10', 'ALC02', 'X', null, SESIONES[0]) === false);

// ═════════════════════════════════════════════════════════════════════
// 2 · LOS RECUENTOS: RETRASO ≠ FALTA
// ═════════════════════════════════════════════════════════════════════
// Ana: retraso, retraso con causa, presente.   Beto: presente, falta, falta.
const marks = {
    '2026-08-10': { ALC01: { s: 'R' },                 ALC02: { s: 'P' } },
    '2026-08-12': { ALC01: { s: 'R', m: 'trabajo' },   ALC02: { s: 'I' } },
    '2026-08-15': { ALC01: { s: 'P' },                 ALC02: { s: 'J', m: 'medico' } },
};
const rAna  = A.resumenJugador(marks, SESIONES, 'ALC01');
const rBeto = A.resumenJugador(marks, SESIONES, 'ALC02');

ok('2a · los retrasos se cuentan aparte', rAna.R === 2 && rAna.P === 1);
ok('2b · 🚨 y NO suman como falta', rAna.faltas === 0 && rAna.I === 0 && rAna.J === 0);
ok('2c · 🚨 ni en las faltas a entrenamiento / a partido',
   rAna.faltasEntreno === 0 && rAna.faltasPartido === 0);
ok('2d · 🚨 ni en el mapa de motivos de FALTA (el del desglose de faltas)',
   Object.keys(rAna.motivos).length === 0);
ok('2e · su causa va a un cajón propio', rAna.motivosRetraso.trabajo === 1);

// 🔑 El otro lado del riesgo: si el retraso no sumara en `asistencias`, el
// jugador que fue tarde contaría como no registrado y el % saldría inflado.
ok('2f · 🔑 el retraso SÍ es asistencia', rAna.asistencias === 3);
ok('2g · …así que el porcentaje de quien siempre fue es 100%', rAna.pct === 100);
ok('2h · CONTROL · las faltas de verdad siguen contando',
   rBeto.faltas === 2 && rBeto.asistencias === 1 && rBeto.pct === 33);
ok('2i · CONTROL · la falta a PARTIDO se sigue distinguiendo',
   rBeto.faltasPartido === 1 && rBeto.faltasEntreno === 1);

const rs = A.resumenSesion(marks, '2026-08-10', ['ALC01', 'ALC02']);
ok('2j · el resumen del día cuenta al retrasado entre los que fueron',
   rs.R === 1 && rs.P === 1 && rs.asistencias === 2 && rs.I === 0 && rs.J === 0);

// ═════════════════════════════════════════════════════════════════════
// 3 · EL PARTE MENSUAL, CONSTRUIDO DE VERDAD
// ═════════════════════════════════════════════════════════════════════
const html = A.parteMensualHtml({
    mes: '2026-08', sesiones: SESIONES, plantel: PLANTEL, marks: marks, equipo: 'Alevín A'
});

ok('3a · la rejilla pinta el reloj en la celda del retraso', /⏰/.test(html));
ok('3b · hay una COLUMNA propia de retrasos',
   /title="Retrasos"/.test(html));
ok('3c · el desglose del mes muestra los retrasos', /Retrasos: 2/.test(html));
// 🚨 LA ASERCIÓN QUE IMPORTA: el encargo pide que NO se mezcle con las faltas.
ok('3d · 🚨 «Total faltas» NO incluye los retrasos (2 faltas, no 4)',
   /Total faltas: <strong style="color:#ff5858;">2<\/strong>/.test(html));
ok('3e · 🚨 el desglose deja claro que asistieron',
   /no cuentan como falta/.test(html));
ok('3f · la causa del retraso sale en su renglón, no en el de faltas',
   /Retrasos: 2[\s\S]{0,400}Trabajo/.test(html));
// El total del día incluye a los retrasados: si sólo contara puntuales, la
// fila diría que faltó gente que sí fue.
ok('3g · el total del día suma a los retrasados',
   /2 puntuales \+ 0 con retraso|1 puntuales \+ 1 con retraso/.test(html));

// Un mes sin retrasos no gana una sección vacía.
const htmlSinR = A.parteMensualHtml({
    mes: '2026-08', sesiones: SESIONES, plantel: PLANTEL,
    marks: { '2026-08-10': { ALC01: { s: 'P' }, ALC02: { s: 'P' } } }, equipo: 'Alevín A'
});
ok('3h · sin retrasos, el parte sale como siempre (sin sección vacía)',
   !/Retrasos:/.test(htmlSinR));

// ═════════════════════════════════════════════════════════════════════
// 4 · LOS OTROS CUATRO SITIOS QUE LEEN ESTAS MARCAS
// ═════════════════════════════════════════════════════════════════════
// ⚠️ Cada uno tenía su propio `if (s === 'P') … else if …`: un estado nuevo
// que no se añada en todos cae en el `else` equivocado y se convierte en
// ausencia sin que salte ningún error.
// ⚠️ Esta aserción llevaba tres alternativas encadenadas con `||` y cualquiera
// de ellas la daba por buena: eso no mide, adivina. Se fija UNA forma —la
// llamada real que hay en el botón— y además el título, que es lo que el
// entrenador lee.
// ⚠️ v704 · Esta aserción exigía `_attMarcar(…,'R')`, y dejó de valer cuando
// el botón pasó a ser un INTERRUPTOR (`_attToggleRetraso`). Fijaba el cómo de
// ayer en vez de la propiedad: lo que importa es que el reloj esté y que su
// rótulo diga lo que va a pasar al pulsarlo.
ok('4a · PASE DE LISTA · hay botón de retraso, y su rótulo cambia según el estado',
   /_attToggleRetraso\(\\'/.test(SRC_PANEL) &&
   /Retraso \(asistió, pero llegó tarde\)/.test(SRC_PANEL) &&
   /Quitar el retraso/.test(SRC_PANEL));
ok('4b · PASE DE LISTA · la fila rotula el retraso',
   /⏰ Retraso/.test(SRC_PANEL));
ok('4c · PASE DE LISTA · el contador S/M usa `asistencias`, no sólo los puntuales',
   /asistencias \|\| 0/.test(SRC_PANEL));
ok('4d · 🚨 FAMILIAS · el retraso no entra en «ausencias registradas»',
   /s !== 'P' && days\[k\]\.s !== 'R'/.test(SRC_PPANEL));
ok('4e · FAMILIAS · y cuenta como asistencia',
   /const asistencias = P \+ R/.test(SRC_PPANEL));
ok('4f · 🚨 CLUB (Dirección) · el retraso cuenta en el resumen del equipo',
   /s === 'R'\) R\+\+/.test(SRC_CLUB));
ok('4g · TEXTO del informe colectivo · nombra los retrasos aparte',
   /con retraso/.test(SRC_STORE));

// ═════════════════════════════════════════════════════════════════════
// 5 · LO QUE NO PUEDE CAMBIAR
// ═════════════════════════════════════════════════════════════════════
// ⚠️ RGPD (regla del autor, v-2026-08-13): sigue sin existir "enfermedad" ni
// texto libre. El retraso REUTILIZA la lista de causas; no añade ninguna.
ok('5a · ⚠️ RGPD · las causas siguen siendo las mismas cuatro',
   A.MOTIVOS.length === 4 && !A.MOTIVOS.some(m => /enferm/i.test(m.id + m.label)));
ok('5b · un jugador SIN MARCAR sigue sin ser una falta',
   A.resumenJugador({}, SESIONES, 'ALC03').faltas === 0 &&
   A.resumenJugador({}, SESIONES, 'ALC03').sinMarcar === 3);

// ═════════════════════════════════════════════════════════════════════
// 6 · v704 · EXCLUSIVOS, Y EL RELOJ SE PUEDE QUITAR
// ═════════════════════════════════════════════════════════════════════
// Encargo del autor (captura 10312): falta y retraso son excluyentes, y el
// botón del reloj no puede quedarse bloqueado — tiene que poder desmarcarse
// para rectificar deprisa.
{
    const e2 = nuevoEntorno();
    const A2 = e2.win.CronosAttendance;
    e2.win._cronosCurrentUser = {
        uid: 'uid_1', clubId: 'clubA',
        allRoles: [{ role: 'user', clubId: 'clubA', category: 'alevin', subcategory: 'A', isAuthorized: true }]
    };
    // ⚠️ Se lee de la CACHÉ y no de un id compuesto a mano: el formato del id
    // lo decide el almacén (`docId(teamId, mes)`) y reconstruirlo aquí sería
    // adivinarlo — la primera versión de este guard lo adivinó mal y reventó.
    // Devuelve {} y no null para que una aserción fallida no tumbe el fichero.
    const leer = (f) => {
        let cache = {};
        try { cache = JSON.parse(e2.ctx.localStorage.getItem('cronos_attendance_cache') || '{}'); }
        catch (err) { cache = {}; }
        let out = null;
        Object.keys(cache).forEach(id => {
            const dia = ((cache[id] || {}).marks || {})['2026-08-10'] || {};
            if (dia[f]) out = dia[f];
        });
        return out || {};
    };

    // 🔑 Un jugador tiene UN estado. Al cambiarlo, el motivo del anterior no
    // puede sobrevivir: si lo hiciera, una falta justificada por "médico"
    // convertida en retraso arrastraría esa causa a la estadística nueva.
    A2.marcar('2026-08-10', 'ALC09', 'J', 'medico', SESIONES[0]);
    ok('6a · CONTROL · la falta justificada guarda su causa',
       leer('ALC09').s === 'J' && leer('ALC09').m === 'medico');

    A2.marcar('2026-08-10', 'ALC09', 'R', null, SESIONES[0]);
    ok('6b · 🚨 al pasar a RETRASO no queda rastro de la falta ni de su causa',
       leer('ALC09').s === 'R' && leer('ALC09').m === undefined);

    A2.marcar('2026-08-10', 'ALC09', 'R', 'trabajo', SESIONES[0]);
    A2.marcar('2026-08-10', 'ALC09', 'I', null, SESIONES[0]);
    ok('6c · 🚨 y al pasar a FALTA tampoco queda el motivo del retraso',
       leer('ALC09').s === 'I' && leer('ALC09').m === undefined);

    A2.marcar('2026-08-10', 'ALC09', 'P', null, SESIONES[0]);
    ok('6d · presente limpia cualquier marca anterior',
       leer('ALC09').s === 'P' && leer('ALC09').m === undefined);
}

// ── El interruptor del reloj, EJECUTADO ──────────────────────────────
// ⚠️ Se extrae la función y se corre con dobles: lo que importa no es que
// exista, sino QUÉ hace al pulsarla por segunda vez.
{
    const src = SRC_PANEL.slice(SRC_PANEL.indexOf('window._attToggleRetraso'));
    const cuerpo = src.slice(0, src.indexOf('\n};') + 3);
    const llamadas = [];
    const ctx2 = {
        window: {
            _attDayKey: '2026-08-10',
            _attMes: { marks: { '2026-08-10': { CONR: { s: 'R' }, CONP: { s: 'P' }, } } },
            _attDesmarcar: (f) => llamadas.push('desmarcar:' + f),
            _attMarcar: (f, s) => llamadas.push('marcar:' + f + ':' + s),
        },
        console
    };
    vm.createContext(ctx2);
    vm.runInContext(cuerpo, ctx2);

    ctx2.window._attToggleRetraso('CONR');
    ok('6e · 🔑 pulsar el reloj con el retraso YA puesto lo QUITA',
       llamadas[0] === 'desmarcar:CONR');
    ok('6f · …y cierra el selector de causa', ctx2.window._attMotivoFor === null);

    llamadas.length = 0;
    ctx2.window._attToggleRetraso('CONP');
    ok('6g · pulsarlo sobre un presente lo pasa a retraso',
       llamadas[0] === 'marcar:CONP:R');
    ok('6h · …y deja el selector en modo RETRASO', ctx2.window._attMotivoModo === 'R');

    llamadas.length = 0;
    ctx2.window._attToggleRetraso('SINMARCA');
    ok('6i · y sobre uno sin marcar, también lo marca',
       llamadas[0] === 'marcar:SINMARCA:R');
}

// 🚨 EL BLOQUEO QUE REPORTÓ: con un retraso puesto, pulsar ❌ tiene que abrir
// el selector en modo FALTA. Si el modo se dedujera del estado, sus causas
// volverían a marcar 'R' y no habría salida del retraso hacia una falta.
ok('6j · 🚨 el modo del selector lo fija el BOTÓN que lo abre, no el estado',
   /var _esRetraso = \(window\._attMotivoModo === 'R'\)/.test(SRC_PANEL) &&
   /_attMotivoModo = 'J';/.test(SRC_PANEL));
ok('6k · el botón del reloj llama al interruptor, no a marcar a secas',
   /_attToggleRetraso\(\\'/.test(SRC_PANEL));

console.log('\n' + (fail ? 'FALLOS: ' + fail : 'OK') + ': ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

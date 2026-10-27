// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v839 · El Parte Mensual de octubre se cortaba en el 23
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (27-10, capturas 11711-11718): con la semana del 26-10
// planificada, el parte de octubre llegaba sólo hasta el 23/10.
//
// 🔴 CAUSA: `sesionesDeMes` iba de lunes en lunes sumando 7×86400000 ms desde
//    las 00:00. El 25-10-2026 se retrasa la hora (25 h): lunes 19 + 168 h =
//    DOMINGO 25 a las 23:00 → se pedía la semana '2026-10-25', que no existe.
// 🔄 Además: el cuadrante local sólo se bajaba al arrancar (refreshWeeks) y
//    Dirección sólo veía los días ya marcados (_sdParteCuadrante).
// ⚠️ SE EJECUTAN attendance-store.js y training-firestore-sync.js REALES (vm)
//    con la zona horaria de Madrid.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
process.env.TZ = 'Europe/Madrid';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};
const clave = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// ═══ 0 · El entorno de verdad tiene el cambio de hora ═══════════════════════
const dst = new Date(2026, 9, 24, 12).getTimezoneOffset() !== new Date(2026, 9, 26, 12).getTimezoneOffset();
ok('0a · la zona Europe/Madrid está activa (25-10-2026 cambia la hora)', dst);
{
    // Red-check: el bucle VIEJO reproduce el fallo de la captura.
    const cur = new Date(2026, 9, 19, 0, 0, 0);
    const sig = new Date(cur.getTime() + 7 * 86400000);
    ok('0b · red-check: el algoritmo viejo caía en el domingo 25', clave(sig) === '2026-10-25', clave(sig));
}

// ═══ 1 · attendance-store.js real ═══════════════════════════════════════════
let semanaLocal = {};
const ctx = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date, JSON, Object, Array, String, Number, Math, Promise, parseInt, isNaN, setTimeout, clearTimeout,
};
ctx.window.window = ctx.window;
ctx.window._cronosLocalDateKey = clave;
ctx.window.TrainingSync = { readWeekDays: (wk) => semanaLocal[wk] || {} };
vm.createContext(ctx);
vm.runInContext(leer('js/coach/attendance/attendance-store.js'), ctx, { filename: 'attendance-store.js' });
const A = ctx.window.CronosAttendance;

const lunes = (arr) => JSON.stringify(Array.from(arr));
ok('1a · octubre 2026: las CINCO semanas, la del 26 incluida',
   lunes(A.semanasDeMes('2026-10')) === lunes(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']),
   A.semanasDeMes('2026-10'));
ok('1b · marzo 2026 (se adelanta la hora): todo lunes',
   A.semanasDeMes('2026-03').every(k => new Date(k + 'T12:00:00').getDay() === 1) &&
   A.semanasDeMes('2026-03').length === 6, A.semanasDeMes('2026-03'));
ok('1c · noviembre 2026 empieza en el lunes 26-10',
   A.semanasDeMes('2026-11')[0] === '2026-10-26', A.semanasDeMes('2026-11'));
{
    let todosLunes = true;
    for (let y = 2025; y <= 2028; y++) for (let m = 1; m <= 12; m++) {
        const mes = y + '-' + String(m).padStart(2, '0');
        A.semanasDeMes(mes).forEach(k => { if (new Date(k + 'T12:00:00').getDay() !== 1) todosLunes = false; });
    }
    ok('1d · 2025-2028, todos los meses: ninguna clave que no sea lunes', todosLunes);
}

// La semana de la captura 11718: L ent, M descanso, X ent, J descanso, V ent, S partido liga
semanaLocal = {
    '2026-10-19': { '2026-10-19': { tipo: 'entrenamiento' }, '2026-10-23': { tipo: 'partido liga' } },
    '2026-10-26': {
        '2026-10-26': { tipo: 'entrenamiento' }, '2026-10-27': { tipo: 'descanso' },
        '2026-10-28': { tipo: 'entrenamiento' }, '2026-10-29': { tipo: 'descanso' },
        '2026-10-30': { tipo: 'entrenamiento' }, '2026-10-31': { tipo: 'partido liga' },
        '2026-11-01': { tipo: 'entrenamiento' },
    },
};
{
    const f = Array.from(A.sesionesDeMes('2026-10')).map(s => s.fecha);
    ok('1e · el parte de octubre llega al 31 (26, 28, 30 y el partido del 31)',
       lunes(f) === lunes(['2026-10-19', '2026-10-23', '2026-10-26', '2026-10-28', '2026-10-30', '2026-10-31']), f);
    ok('1f · el 1-11 se queda en noviembre', Array.from(A.sesionesDeMes('2026-11')).some(s => s.fecha === '2026-11-01'));
}

// ═══ 2 · unirSesiones / sesionesDeDias ══════════════════════════════════════
{
    const u = Array.from(A.unirSesiones(
        [{ fecha: '2026-10-05', tipo: 'partido', tipoRaw: 'partido', hora: '10:00' }],
        [{ fecha: '2026-10-05', tipo: 'entrenamiento' }, { fecha: '2026-10-02', tipo: 'partido liga' },
         { fecha: '2026-10-03', tipo: 'descanso' }]));
    ok('2a · ordenadas, sin repetir fecha y manda la PRIMERA lista',
       u.length === 2 && u[0].fecha === '2026-10-02' && u[1].tipo === 'partido' && u[1].hora === '10:00', u);
    ok('2b · «partido liga» se normaliza a partido; el descanso no es sesión', u[0].tipo === 'partido');
    const d = Array.from(A.sesionesDeDias({ '2026-10-26': { tipo: 'entrenamiento' }, lastModified: 1, teams: {} }));
    ok('2c · sesionesDeDias ignora claves que no son fechas', d.length === 1 && d[0].fecha === '2026-10-26', d);
}

// ═══ 3 · TrainingSync.refreshWeeks real ═════════════════════════════════════
(async () => {
    const store = {
        cronos_training_weeks: JSON.stringify({
            '2026-10-19': { teams: { eq1: { '2026-10-19': { tipo: 'entrenamiento' } } } },
            '2026-10-12': { teams: { eq1: { '2026-10-12': { tipo: 'entrenamiento' } } } },
        }),
    };
    const remoto = {
        '2026-10-19': { teams: { eq1: { '2026-10-19': { tipo: 'entrenamiento' } } } },
        '2026-10-26': { teams: { eq1: { '2026-10-26': { tipo: 'entrenamiento' } }, eq2: {} } },
    };
    const c2 = {
        window: {}, console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem() {} },
        Date, JSON, Object, Array, String, Number, Math, Promise, parseInt, isNaN, setTimeout, clearTimeout,
    };
    c2.window.window = c2.window;
    c2.window.cronosMyTeamId = () => 'eq1';
    c2.window.saFS = async () => ({
        db: {},
        doc: (db, a, club, b, wk) => wk,
        getDoc: async (wk) => {
            await new Promise(r => setTimeout(r, wk === '2026-10-26' ? 5 : 15));   // respuestas desordenadas
            return { exists: () => !!remoto[wk], data: () => remoto[wk] };
        },
        getDocs: async () => ({ forEach() {} }),
    });
    vm.createContext(c2);
    vm.runInContext(leer('js/services/training-firestore-sync.js'), c2, { filename: 'training-firestore-sync.js' });
    const T = c2.window.TrainingSync;
    T.init('club1');
    const cambio = await T.refreshWeeks(['2026-10-12', '2026-10-19', '2026-10-26', 'CUADRANTE__x']);
    const todo = JSON.parse(store.cronos_training_weeks);
    ok('3a · refreshWeeks trae la semana nueva y avisa de que cambió', cambio === true && !!todo['2026-10-26'], cambio);
    ok('3b · todas las semanas sobreviven a las lecturas en paralelo (una sola escritura)',
       !!todo['2026-10-19'] && !!todo['2026-10-26'] && !!todo['2026-10-12']);
    ok('3c · una semana que no está en la nube NO borra la local', !!todo['2026-10-12'].teams.eq1['2026-10-12']);
    const otra = await T.refreshWeeks(['2026-10-19', '2026-10-26']);
    ok('3d · sin novedades → false (no se repinta por nada)', otra === false, otra);
    ok('3e · la clave que no es fecha no se pide', !todo['CUADRANTE__x']);

    // ═══ 4 · Cableado ═══════════════════════════════════════════════════════
    const panel = leer('js/coach/attendance/panel.js');
    const dir   = leer('js/coach/reports/club-reports.js');
    ok('4a · Parte del entrenador: refresca el mes y repinta sólo si sigue en él',
       /refrescarCuadranteMes\(mesCuadrante\)/.test(panel) && /navCurrent\(\) !== 'openAttendanceMonth'/.test(panel));
    ok('4b · Parte del entrenador: une cuadrante + días ya marcados',
       /unirSesiones\(\s*window\.CronosAttendance\.sesionesDeMes\(window\._attMonth\),\s*window\.CronosAttendance\.sesionesDeParte\(/.test(panel));
    ok('4c · Pasar lista: refresca la semana mostrada',
       /refrescarCuadranteSemanas\(\[weekKey\]\)/.test(panel) && /navCurrent\(\) !== 'openAttendancePanel'/.test(panel));
    ok('4d · Dirección: une el cuadrante del equipo (teams.<teamId>) al parte',
       /async function _sdParteCuadrante\(teamId, mes\)/.test(dir) && /\.teams \|\| \{\}\)\[teamId\]/.test(dir) &&
       /_sdParteCuadrante\(teamId, d\.mes\)/.test(dir));
    ok('4e · Dirección: el «sigue aquí» no depende del pie de periodos (un parte vacío también se repinta)',
       /data-sd-parte="1"/.test(dir) && /querySelector\('\[data-sd-parte\]'\)/.test(dir));
    ok('4f · sesionesDeMes ya no suma milisegundos', !/7 \* 86400000/.test(leer('js/coach/attendance/attendance-store.js')));

    console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();

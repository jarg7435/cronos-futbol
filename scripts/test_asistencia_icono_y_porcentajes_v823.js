// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v823 · Asistencia: icono de la causa en el botón de falta + % pre-
//         partido y % de temporada en el parte mensual
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt 17-10, capturas 11569 / 11570):
//   1. El botón de falta justificada pintaba SIEMPRE 🩹 (Estudios y Trabajo
//      salían con el icono de «Motivo médico / lesión»).
//   2. Parte mensual: % de los entrenamientos antes del último partido
//      (respuesta del autor: «semana previa» = entre el partido anterior y el
//      último) y % de lo que va de temporada (desde el 1 de julio).
// ⚠️ SE EJECUTA attendance-store.js REAL (vm) con un mes de mentira.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

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

const ctx = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date, JSON, Object, Array, String, Number, Math, Promise, parseInt, isNaN, setTimeout, clearTimeout,
};
ctx.window.window = ctx.window;
// La de utils.js (fecha LOCAL 'YYYY-MM-DD').
ctx.window._cronosLocalDateKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
vm.createContext(ctx);
vm.runInContext(leer('js/coach/attendance/attendance-store.js'), ctx, { filename: 'attendance-store.js' });
const A = ctx.window.CronosAttendance;

// ── Septiembre como el de la captura 11570 (⚽ 15, 17, 22, 24 · 🏃 el resto)
const S = (fecha, tipo) => ({ fecha, tipo, tipoRaw: tipo, hora: '', lugar: '' });
const sep = ['14', '16', '18', '21', '23', '25'].map(d => S('2026-09-' + d, 'entrenamiento'))
    .concat(['15', '17', '22', '24'].map(d => S('2026-09-' + d, 'partido')))
    .sort((a, b) => a.fecha < b.fecha ? -1 : 1);
const ago = [S('2026-08-20', 'entrenamiento'), S('2026-08-27', 'partido')];
const jun = [S('2026-06-10', 'entrenamiento')];   // temporada ANTERIOR: no cuenta
const mk = (pares) => { const o = {}; pares.forEach(([f, ficha, s, m]) => { o[f] = o[f] || {}; o[f][ficha] = m ? { s, m } : { s }; }); return o; };
// A1 (Ana): falta injustificada al 23/9 (el único entreno pre-partido), viene a todo lo demás
// B2 (Bea): justificada por estudios el 23/9; retraso el 21/9
const marksSep = mk([
    ['2026-09-14', 'A1', 'P'], ['2026-09-14', 'B2', 'P'],
    ['2026-09-21', 'A1', 'P'], ['2026-09-21', 'B2', 'R'],
    ['2026-09-22', 'A1', 'P'], ['2026-09-22', 'B2', 'P'],
    ['2026-09-23', 'A1', 'I'], ['2026-09-23', 'B2', 'J', 'estudios'],
    ['2026-09-24', 'A1', 'P'], ['2026-09-24', 'B2', 'P'],
]);
const marksAgo = mk([['2026-08-20', 'A1', 'P'], ['2026-08-20', 'B2', 'I'], ['2026-08-27', 'A1', 'P'], ['2026-08-27', 'B2', 'P']]);
const marksJun = mk([['2026-06-10', 'A1', 'I'], ['2026-06-10', 'B2', 'I']]);

// ═══ 1 · PERIODOS (función pura) ═════════════════════════════════════════════
{
    ok('1a · meses que se piden: de junio (mes anterior a la temporada) a septiembre',
       A.mesesHistorico('2026-09').join(',') === '2026-06,2026-07,2026-08,2026-09');
    ok('1b · en enero la temporada sigue siendo la que empezó en julio',
       A.mesesHistorico('2027-01')[0] === '2026-06' && A.mesesHistorico('2027-01').slice(-1)[0] === '2027-01');

    const ex = A.periodosExtra({ mes: '2026-09', hoy: '2026-10-17', porMes: {
        '2026-06': { sesiones: jun, marks: marksJun },
        '2026-08': { sesiones: ago, marks: marksAgo },
        '2026-09': { sesiones: sep, marks: marksSep } } });
    ok('1c · último partido = 24/9 y el anterior = 22/9', ex.pre.ultimoPartido === '2026-09-24' && ex.pre.partidoAnterior === '2026-09-22', ex.pre);
    ok('1d · «semana previa»: sólo el entreno del 23/9 (ni partidos ni el 25/9)',
       ex.pre.sesiones.map(s => s.fecha).join(',') === '2026-09-23', ex.pre.sesiones);
    ok('1e · temporada desde el 1/7 hasta el fin del mes mostrado (12 sesiones, junio fuera)',
       ex.temporada.desde === '2026-07-01' && ex.temporada.hasta === '2026-09-30' && ex.temporada.sesiones.length === 12,
       ex.temporada);

    const exHoy = A.periodosExtra({ mes: '2026-09', hoy: '2026-09-23', porMes: { '2026-09': { sesiones: sep, marks: marksSep } } });
    ok('1f · en el mes en curso no se pasa de hoy: último partido = 22/9 (el 24 aún no se ha jugado)',
       exHoy.pre.ultimoPartido === '2026-09-22' && exHoy.pre.partidoAnterior === '2026-09-17' &&
       exHoy.pre.sesiones.map(s => s.fecha).join(',') === '2026-09-18,2026-09-21' && exHoy.temporada.hasta === '2026-09-23',
       exHoy.pre);

    const sinAnt = A.periodosExtra({ mes: '2026-08', hoy: '2026-10-17', porMes: { '2026-08': { sesiones: ago, marks: marksAgo } } });
    ok('1g · sin partido anterior: 28 días antes del último (y se marca)',
       sinAnt.pre.ultimoPartido === '2026-08-27' && sinAnt.pre.partidoAnterior === null &&
       sinAnt.pre.sesiones.map(s => s.fecha).join(',') === '2026-08-20');
    const sinPartido = A.periodosExtra({ mes: '2026-07', hoy: '2026-10-17', porMes: { '2026-07': { sesiones: [S('2026-07-10', 'entrenamiento')], marks: {} } } });
    ok('1h · sin ningún partido todavía: pre = null', sinPartido.pre === null);
    const crudo = A.periodosExtra({ mes: '2026-09', hoy: '2026-10-17', porMes: { '2026-09': {
        sesiones: [S('2026-09-01', 'Partido de liga'), S('2026-09-02', 'Entrenamiento'), S('2026-09-03', 'descanso'), S('2026-09-04', 'partido')], marks: {} } } });
    ok('1i · tipos del parte sin normalizar («Partido de liga») se entienden; el descanso no cuenta',
       crudo.pre.partidoAnterior === '2026-09-01' && crudo.pre.sesiones.length === 1 && crudo.temporada.sesiones.length === 3);

    // ═══ 2 · EL PARTE MENSUAL ════════════════════════════════════════════════
    const plantel = [{ ficha: 'A1', dorsal: '1', alias: 'ANA' }, { ficha: 'B2', dorsal: '2', alias: 'BEA' }];
    const base = { mes: '2026-09', equipo: 'Regional B', sesiones: sep, plantel, marks: marksSep };
    const h = A.parteMensualHtml(Object.assign({ extra: ex }, base));
    const fila = (alias) => { const i = h.indexOf('</span> ' + alias); return h.slice(i, h.indexOf('</tr>', i)); };
    const celdas = (f) => (f.match(/<td[^>]*>([^<]*)<\/td>/g) || []).map(c => c.replace(/<[^>]+>/g, ''));
    const ana = celdas(fila('ANA')), bea = celdas(fila('BEA'));
    ok('2a · cabeceras «% PRE ⚽ 24/9» y «% TEMP.»', /% PRE ⚽<br>24\/9/.test(h) && /% TEMP\./.test(h));
    // ANA: sep 14 P, 21 P, 22 P, 23 I, 24 P (4/5) + ago 20 P, 27 P → 6/7
    ok('2b · ANA: falta al 23/9 → pre 0 %; temporada 6/7 → 86 %',
       ana[ana.length - 2] === '0%' && ana[ana.length - 1] === '86%', ana.slice(-3));
    // BEA: sep 14 P, 21 R, 22 P, 23 J, 24 P (4/5) + ago 20 I, 27 P → 5/7
    ok('2c · BEA: justificada el 23/9 → pre 0 %; temporada (retraso = asistencia) 5/7 → 71 %',
       bea[bea.length - 2] === '0%' && bea[bea.length - 1] === '71%', bea.slice(-3));
    const tot = celdas(h.slice(h.indexOf('TOTAL PRESENTES'), h.indexOf('</tr>', h.indexOf('TOTAL PRESENTES'))));
    ok('2d · fila de totales del equipo: pre 0 %, temporada 11/14 → 79 %', tot[tot.length - 2] === '0%' && tot[tot.length - 1] === '79%', tot.slice(-3));
    const exB = A.periodosExtra({ mes: '2026-09', hoy: '2026-09-23', porMes: { '2026-09': { sesiones: sep, marks: marksSep } } });
    const hB = A.parteMensualHtml(Object.assign({}, base, { extra: exB }));
    const anaB = celdas(hB.slice(hB.indexOf('</span> ANA'), hB.indexOf('</tr>', hB.indexOf('</span> ANA'))));
    ok('2d2 · con la semana del 18 y 21/9 (ANA presente en el 21, sin marca el 18) → pre 100 %',
       anaB[anaB.length - 2] === '100%', anaB.slice(-3));
    ok('2e · la leyenda dice de qué periodo habla cada %',
       /entre el partido del 22\/9 y el último partido \(24\/9\): 1 sesión/.test(h) && /desde el 1\/7 hasta el 30\/9: 12 sesiones/.test(h));
    const hc = A.parteMensualHtml(Object.assign({ extra: 'cargando' }, base));
    ok('2f · mientras carga: columnas con «…» y aviso', /data-att-col="pre"/.test(hc) && />…</.test(hc) && /Calculando/.test(hc));
    const hs = A.parteMensualHtml(base);
    ok('2g · sin `extra`, el parte es el de siempre', !/data-att-col/.test(hs) && !/data-att-periodos/.test(hs));
    ok('2h · el % del MES no cambia (ANA 4/5 → 80 %)', ana[ana.length - 3] === '80%', ana.slice(-3));
}

// ═══ 3 · ICONO DEL BOTÓN DE FALTA (panel.js) ═════════════════════════════════
{
    const panel = leer('js/coach/attendance/panel.js');
    const i = panel.indexOf('title="Falta"');
    const boton = panel.slice(i, panel.indexOf('</button>', i));
    ok('3a · el botón de falta justificada pinta el icono de SU causa (motivoIcon)',
       /estado === 'J' \? _attEsc\(window\.CronosAttendance\.motivoIcon\(m && m\.m\)\) : '❌'/.test(boton));
    ok('3b · ya no hay un 🩹 fijo en el botón', !/\(estado === 'J' \? '🩹' : '❌'\)/.test(panel));
    ok('3c · los iconos: estudios 📚, trabajo 💼, médico 🩹, otros 📝; sin causa 🩹',
       A.motivoIcon('estudios') === '📚' && A.motivoIcon('trabajo') === '💼' && A.motivoIcon('medico') === '🩹' &&
       A.motivoIcon('otros') === '📝' && A.motivoIcon(undefined) === '🩹');
}

// ═══ 4 · LAS DOS PANTALLAS LO USAN ═══════════════════════════════════════════
{
    const panel = leer('js/coach/attendance/panel.js');
    const cr = leer('js/coach/reports/club-reports.js');
    ok('4a · entrenador: carga el histórico y pasa `extra`',
       /CronosAttendance\.cargarHistorico\(mesPedido, eq\)/.test(panel) && /extra:\s+\(window\._attExtra/.test(panel));
    ok('4b · Dirección: lee los partes de los meses de atrás de ESE equipo y pasa `extra`',
       /CronosAttendance\.mesesHistorico\(mes\)/.test(cr) && /CronosAttendance\.docId\(teamId, m\)/.test(cr) &&
       /CronosAttendance\.periodosExtra\(\{ mes: mes, porMes: porMes \}\)/.test(cr) &&
       /_sdParteCargarHistorico\(teamId, d\.mes, parte\)/.test(cr) && /extra:\s+\(typeof window\.CronosAttendance\.periodosExtra/.test(cr));
}

console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

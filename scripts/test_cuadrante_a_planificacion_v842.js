// ════════════════════════════════════════════════════════════════════════
//  test_cuadrante_a_planificacion_v842.js
//  📥 EL CUADRANTE RELLENA TIPO Y HORA DE LA PLANIFICACIÓN SEMANAL — v842
// ════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-10-27, capturas 11736-11740):
//  al «Enviar a entrenadores», tipo y hora de inicio de cada casilla pasan a
//  la Planificación Semanal del equipo. Decisiones del autor:
//   1. Tipo y hora SOBRESCRIBEN; lugar, equipaciones y duración no se tocan.
//   2. Un día sin casilla en el cuadrante se queda como está.
//   3. Partido → «partido liga» (o «partido amistoso» si lo dice el rótulo);
//      «Otra actividad» sólo deja la hora.
//   4. Sólo los equipos elegidos; nunca las filas libres ni otros equipos.
//   5. Si el equipo aún vive en los días del legado (raíz), el nodo nace con
//      ellos: el entrenador no pierde lo que tenía.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const CQ = fs.readFileSync(path.join(ROOT, 'js/coach/reports/cuadrante-club.js'), 'utf8');

const sb = {
    console: { log() {}, warn() {}, error() {} },
    String, Array, Number, Object, Date, parseInt, parseFloat, isNaN, RegExp, Math, JSON, Set, Promise,
    document: { getElementById: () => null, body: { contains: () => false },
                addEventListener: () => {},
                querySelectorAll: () => [], createElement: () => ({ style: {}, addEventListener() {} }) },
    confirm: () => true,
};
sb.window = sb;
sb.globalThis = sb;
sb.cronosTeamIdNorm = (t) => String(t || '').replace('__f11-', '__');
vm.createContext(sb);
vm.runInContext(CQ + '\n;window.__probe = { _cqTipoPlanificacion, _cqVolcarEnPlanificacion };', sb);
const P = sb.window.__probe;

// Firestore de mentira: un documento, y registro de la última escritura.
function fsFalso(plan) {
    const r = { escrito: null, modo: '' };
    r.api = {
        db: {},
        doc: (...a) => a.slice(1).join('/'),
        getDoc: async () => ({ exists: () => !!plan, data: () => JSON.parse(JSON.stringify(plan)) }),
        updateDoc: async (ref, p) => { r.escrito = p; r.modo = 'update'; r.ref = ref; },
        setDoc: async (ref, p, o) => { r.escrito = p; r.modo = 'set'; r.opc = o; r.ref = ref; },
        serverTimestamp: () => 'TS',
    };
    return r;
}

const WK = '2026-10-26';
const RB = 'cd-dia__regional__b';
const AL = 'cd-dia__alevin__c';
const FILAS = [
    { id: RB, tipo: 'equipo', label: 'Regional B' },
    { id: AL, tipo: 'equipo', label: 'Alevín C' },
    { id: 'fisio', tipo: 'libre', label: 'FISIO' },
];
const CELDAS = {};
CELDAS[RB + '|2026-10-26'] = { tipo: 'entreno', ini: '18:15', fin: '19:15' };
CELDAS[RB + '|2026-10-28'] = { tipo: 'entreno', ini: '18:15', fin: '19:15' };
CELDAS[RB + '|2026-10-29'] = { tipo: 'entreno', ini: '18:15', fin: '19:15' };
CELDAS[RB + '|2026-10-31'] = { tipo: 'partido_casa', ini: '11:00', fin: '12:30', txt: 'J8 · La Oliva' };
CELDAS[AL + '|2026-10-27'] = { tipo: 'entreno', ini: '17:00' };
CELDAS['fisio|2026-10-27'] = { tipo: 'otro', ini: '19:00' };

(async () => {
    console.log('\n📥  CUADRANTE → PLANIFICACIÓN SEMANAL (v842)\n' + '─'.repeat(70));

    console.log('\n1) Traducción de tipos');
    ok('1a · entreno → «entrenamiento»', P._cqTipoPlanificacion({ tipo: 'entreno' }) === 'entrenamiento');
    ok('1b · partido en casa → «partido liga»', P._cqTipoPlanificacion({ tipo: 'partido_casa', txt: 'J8 · La Oliva' }) === 'partido liga');
    ok('1c · partido fuera → «partido liga»', P._cqTipoPlanificacion({ tipo: 'partido_fuera' }) === 'partido liga');
    ok('1d · «Amistoso» en el rótulo → «partido amistoso»', P._cqTipoPlanificacion({ tipo: 'partido_fuera', txt: 'Amistoso vs Tenerife' }) === 'partido amistoso');
    ok('1e · otra actividad → sin tipo', P._cqTipoPlanificacion({ tipo: 'otro' }) === '');
    const SRC = fs.readFileSync(path.join(ROOT, 'js/coach/training/panel.js'), 'utf8');
    ok('1f · los tres tipos existen en el desplegable de la Planificación',
       /'entrenamiento','partido liga','partido amistoso'/.test(SRC));

    console.log('\n2) Equipo con nodo propio: campo a campo, sin pisar lo demás');
    {
        const plan = { teams: {} };
        plan.teams[RB] = { '2026-10-29': { lugar: 'CAMPO DE M. ARINAG', tipo: 'partido liga', hora: '20:00', duracion: '90 MINUTOS' } };
        const f = fsFalso(plan);
        const n = await P._cqVolcarEnPlanificacion(f.api, 'cd-dia', WK, [RB], FILAS, CELDAS);
        const w = f.escrito || {};
        ok('2a · un equipo actualizado, por updateDoc', n === 1 && f.modo === 'update', { n, modo: f.modo });
        ok('2b · documento de la planificación: trainingPlans/cd-dia/weeks/' + WK, f.ref === 'trainingPlans/cd-dia/weeks/' + WK, f.ref);
        ok('2c · jueves: «Partido liga 20:00» pasa a «entrenamiento 18:15»',
           w['teams.' + RB + '.2026-10-29.tipo'] === 'entrenamiento' && w['teams.' + RB + '.2026-10-29.hora'] === '18:15');
        ok('2d · sábado: partido J8 a las 11:00', w['teams.' + RB + '.2026-10-31.tipo'] === 'partido liga' && w['teams.' + RB + '.2026-10-31.hora'] === '11:00');
        ok('2e · lugar, equipaciones y duración NO se escriben', !Object.keys(w).some(k => /\.(lugar|equipaciones|duracion)$/.test(k)));
        ok('2f · martes y viernes (sin casilla) NO se tocan', !Object.keys(w).some(k => /2026-10-(27|30)/.test(k)));
        ok('2g · el Alevín C (no elegido) y FISIO quedan fuera', !Object.keys(w).some(k => k.indexOf(AL) >= 0 || k.indexOf('fisio') >= 0));
        ok('2h · lastModified nuevo (el arranque del entrenador lo baja)', w.lastModified === 'TS');
    }

    console.log('\n3) Equipo aún en el legado (días sueltos en la raíz)');
    {
        const plan = { '2026-10-27': { lugar: 'ANEXO', tipo: 'entrenamiento', hora: '20:00' }, createdBy: 'x' };
        const f = fsFalso(plan);
        await P._cqVolcarEnPlanificacion(f.api, 'cd-dia', WK, [RB], FILAS, CELDAS);
        const nodo = (f.escrito || {})['teams.' + RB] || {};
        ok('3a · el nodo nace con los días que el entrenador ya veía', nodo['2026-10-27'] && nodo['2026-10-27'].lugar === 'ANEXO', nodo);
        ok('3b · y con tipo y hora del cuadrante encima', nodo['2026-10-26'] && nodo['2026-10-26'].tipo === 'entrenamiento' && nodo['2026-10-26'].hora === '18:15', nodo);
        ok('3c · sólo días: no se cuela `createdBy`', !('createdBy' in nodo));
    }

    console.log('\n4) Semana sin planificación todavía');
    {
        const f = fsFalso(null);
        await P._cqVolcarEnPlanificacion(f.api, 'cd-dia', WK, [RB, AL], FILAS, CELDAS);
        const w = f.escrito || {};
        ok('4a · se crea con setDoc+merge', f.modo === 'set' && f.opc && f.opc.merge === true);
        ok('4b · con los dos equipos elegidos', w.teams && w.teams[RB] && w.teams[AL] && w.teams[AL]['2026-10-27'].hora === '17:00', w.teams);
    }

    console.log('\n5) Casos que no escriben nada');
    {
        const f = fsFalso({});
        ok('5a · sólo una fila libre elegida → 0', await P._cqVolcarEnPlanificacion(f.api, 'cd-dia', WK, ['fisio'], FILAS, CELDAS) === 0 && !f.escrito);
        ok('5b · equipo sin casillas esa semana → 0', await P._cqVolcarEnPlanificacion(f.api, 'cd-dia', WK, [RB], FILAS, {}) === 0 && !f.escrito);
        const g = fsFalso({ teams: {} });
        const filasViejas = [{ id: 'cd-dia__f11-regional__b', tipo: 'equipo' }];
        const celdasViejas = { 'cd-dia__f11-regional__b|2026-10-26': { tipo: 'entreno', ini: '18:15' } };
        await P._cqVolcarEnPlanificacion(g.api, 'cd-dia', WK, [RB], filasViejas, celdasViejas);
        ok('5c · fila antigua con modalidad: se lee su casilla y se escribe en el id canónico',
           g.escrito && g.escrito['teams.' + RB] && g.escrito['teams.' + RB]['2026-10-26'].hora === '18:15', g.escrito);
    }

    console.log('\n6) Cableado');
    ok('6a · cqEnviar vuelca ANTES de publicar', CQ.indexOf('_cqVolcarEnPlanificacion(fs, clubId') > 0 &&
       CQ.indexOf('_cqVolcarEnPlanificacion(fs, clubId') < CQ.indexOf("await _cqGuardar(clubId, st.doc, { sellarPublicacion: true })"));
    ok('6b · el entrenador se trae la semana al ver un cuadrante nuevo', /if \(hay\) _cqTraerPlanificacion\(weekKey, info\)/.test(CQ));
    ok('6c · y sólo pone tipo y hora en pantalla', /\['tipo', 'hora'\]\.forEach/.test(CQ));

    console.log('\n' + '─'.repeat(70) + '\n' + (fallos ? '❌ ' + fallos + ' de ' + total + ' FALLAN' : '✅ ' + total + ' de ' + total + ' OK') + '\n');
    process.exit(fallos ? 1 : 0);
})();

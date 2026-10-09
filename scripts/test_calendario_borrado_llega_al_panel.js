// ════════════════════════════════════════════════════════════════════
//  📡 v795 · BORRAR EL CALENDARIO EN EL CUADRANTE LLEGA AL PANEL DEL ENTRENADOR
//
//  Encargo del autor (implementar.txt 2026-10-09, capturas 11289-11290): el
//  director borró el calendario de liga del Alevín C desde el cuadrante y el
//  entrenador seguía viendo J9…J27 en «Jornada · calendario oficial».
//
//  Dos causas:
//   · el panel (setup-modal.js) daba por buena TODA LA SESIÓN la lista leída
//     y no escuchaba `cronos:calendario-cambiado`;
//   · el ÍNDICE de la temporada se leía una vez y no se escuchaba.
//
//  Este guard EJECUTA calendario-temporada.js entero (con Firestore simulado)
//  y el oyente real del panel.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const CAL   = fs.readFileSync(path.join(RAIZ, 'js/coach/reports/calendario-temporada.js'), 'utf8');
const SETUP = fs.readFileSync(path.join(RAIZ, 'js/core/setup-modal.js'), 'utf8');

let fallos = 0, total = 0;
function ok(n, c, d) { total++; if (c) console.log('  ✓ ' + n);
    else { fallos++; console.log('  ✗ ' + n + (d !== undefined ? '\n      ' + String(d).slice(0, 300) : '')); } }

// ── Firestore simulado: documentos + escuchas que se pueden disparar ──
const CLUB = 'club-dia', ALE = 'club-dia__alevin__c', REG = 'club-dia__regional__b';
const docs = {
    'trainingPlans/club-dia/weeks/CALENDARIO__INDICE': { v: 1, equipos: {
        [ALE]: { meses: ['2026-11', '2026-12'] }, [REG]: { meses: ['2026-11'] } }, perfiles: {} },
    'trainingPlans/club-dia/weeks/CALENDARIO__2026-11': { partidos: {
        [ALE]: { '2026-11-06': { jornada: 9, hora: '21:00', rival: 'San Fernando', local: false },
                 '2026-11-14': { jornada: 10, hora: '11:00', rival: 'Las Palmas B', local: true } },
        [REG]: { '2026-11-08': { jornada: 9, hora: '12:00', rival: 'Arucas', local: true } } } },
    'trainingPlans/club-dia/weeks/CALENDARIO__2026-12': { partidos: {
        [ALE]: { '2026-12-12': { jornada: 13, hora: '11:00', rival: 'Veteranos', local: false } } } },
};
const escuchas = {};
const eventos = [];
const sb = {
    console: { log() {}, warn() {}, error() {} },
    Object, JSON, Date, Array, String, Number, Math, Promise, Set, parseInt,
    setTimeout: (f) => f(), clearTimeout() {},
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
};
const oyentes = {};
sb.document = {
    getElementById: () => null, querySelector: () => null, body: { appendChild() {} },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    addEventListener: (t, f) => { (oyentes[t] = oyentes[t] || []).push(f); },
    dispatchEvent: (e) => { eventos.push(e); (oyentes[e.type] || []).forEach(f => f(e)); return true; },
};
sb.window = sb;
sb.addEventListener = () => {};
sb.removeEventListener = () => {};
sb._sdFS = async () => ({
    db: {}, doc: (db, ...r) => r.join('/'),
    getDoc: async (ref) => ({ exists: () => !!docs[ref], data: () => JSON.parse(JSON.stringify(docs[ref] || {})) }),
    setDoc: async (ref, d) => { docs[ref] = JSON.parse(JSON.stringify(d)); },
});
sb.cronosEscuchaDocClub = (ruta, cb) => {
    const ref = ruta.join('/');
    escuchas[ref] = cb;
    cb(docs[ref] ? JSON.parse(JSON.stringify(docs[ref])) : null);   // la primera foto, como Firestore
    return () => {};
};
sb.CalParser = { temporadaDe: () => 2026 };
vm.createContext(sb);
let cargado = true;
try { vm.runInContext(CAL, sb); } catch (e) { cargado = false; console.log('  (al cargar: ' + e.message + ')'); }

// El director borra: el mismo efecto en Firestore que calBorrarEquipo, y el
// servidor avisa a las escuchas abiertas del ENTRENADOR.
function borraEnElServidor(filaId) {
    Object.keys(docs).forEach(ref => {
        if (/CALENDARIO__\d/.test(ref)) delete docs[ref].partidos[filaId];
    });
    delete docs['trainingPlans/club-dia/weeks/CALENDARIO__INDICE'].equipos[filaId];
    Object.keys(escuchas).forEach(ref => escuchas[ref](JSON.parse(JSON.stringify(docs[ref]))));
}

(async () => {
    console.log('\n── PARTE 1 · el almacén del calendario (calendario-temporada.js real) ──');
    ok('1a · el fichero real carga en el sandbox', cargado && typeof sb.calPartidosDeEquipo === 'function');

    let lista = await sb.calPartidosDeEquipo(CLUB, ALE);
    ok('1b · el entrenador del Alevín C ve sus 3 jornadas', lista.length === 3, JSON.stringify(lista.map(p => p.jornada)));
    ok('1c · 🔑 el índice queda ESCUCHADO (antes se leía una vez y no se escuchaba)',
       typeof escuchas['trainingPlans/club-dia/weeks/CALENDARIO__INDICE'] === 'function');

    eventos.length = 0;
    borraEnElServidor(ALE);
    ok('1d · 🔑 el borrado del director AVISA a las pantallas abiertas (cronos:calendario-cambiado)',
       eventos.some(e => e.type === 'cronos:calendario-cambiado'));
    ok('1e · y el aviso del índice viaja marcado como tal', eventos.some(e => e.detail && e.detail.indice === true));
    ok('1f · el índice en memoria ya no tiene al Alevín C',
       !(sb._calState.indice.equipos || {})[ALE] && !!(sb._calState.indice.equipos || {})[REG]);

    lista = await sb.calPartidosDeEquipo(CLUB, ALE);
    ok('1g · 🔑🔑 [CAPTURA 11290] releer da CERO jornadas para el Alevín C', lista.length === 0, JSON.stringify(lista));
    lista = await sb.calPartidosDeEquipo(CLUB, REG);
    ok('1h · ⚠️ el Regional B no pierde su calendario', lista.length === 1, JSON.stringify(lista));

    console.log('\n── PARTE 2 · el panel del entrenador atiende el aviso (setup-modal.js real) ──');
    const i = SETUP.indexOf('if (!window._setupCalOyenteListo');
    const f = SETUP.indexOf('function _setupPintarDatosPartido()', i);
    const BLOQUE = i >= 0 && f > i ? SETUP.slice(i, f) : '';
    ok('2a · se encuentra el oyente del panel', BLOQUE.length > 100);

    function panel(abierto) {
        const ol = {};
        const ctx = { window: {}, console };
        ctx.window = ctx;
        ctx._setupCal = { teamId: ALE, estado: 'ok', lista: [{ fecha: '2026-11-06' }] };
        ctx.relecturas = 0;
        ctx.document = {
            addEventListener: (t, fn) => { (ol[t] = ol[t] || []).push(fn); },
            getElementById: (id) => (abierto && (id === 'setup-cal-box' || id === 'setup-cal')) ? {} : null,
        };
        vm.createContext(ctx);
        vm.runInContext('function _setupDatosPartidoInit() { relecturas++; }\n' + BLOQUE, ctx);
        // Cargar el módulo dos veces no puede apuntar dos oyentes (v719).
        vm.runInContext(BLOQUE, ctx);
        const lanza = () => (ol['cronos:calendario-cambiado'] || []).forEach(fn => fn({}));
        return { ctx, ol, lanza };
    }
    let p = panel(true);
    ok('2b · una sola suscripción aunque el código se evalúe dos veces',
       (p.ol['cronos:calendario-cambiado'] || []).length === 1);
    p.lanza();
    ok('2c · 🔑🔑 con el panel abierto, el aviso TIRA la lista vieja y la vuelve a leer',
       p.ctx._setupCal === null && p.ctx.relecturas === 1, JSON.stringify({ cal: p.ctx._setupCal, r: p.ctx.relecturas }));
    p = panel(false);
    p.lanza();
    ok('2d · con el panel cerrado no relee, pero la lista vieja YA NO vale para la próxima apertura',
       p.ctx._setupCal === null && p.ctx.relecturas === 0);
    ok('2e · la apertura sólo reutiliza lo leído si sigue en estado «ok» (la lista anulada se relee)',
       /if \(c && c\.teamId === eq\.teamId && c\.estado === 'ok'\)/.test(SETUP));

    console.log('\n── PARTE 3 · sin calendario, el panel lo dice y libera la localía ──');
    ok('3a · lista vacía → «Sin calendario oficial importado»',
       /'Sin calendario oficial importado'/.test(SETUP));
    ok('3b · y sin partido se libera la localía (ya no la fija un calendario que no existe)',
       /\} else \{\s*_setupLiberarLocalia\(\);\s*\}/.test(SETUP));

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '' : '  ✅'));
    process.exit(fallos ? 1 : 0);
})();

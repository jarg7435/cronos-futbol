// ─────────────────────────────────────────────────────────────────────────
// test_cuadrante_por_equipo.js · el cuadrante semanal es de CADA EQUIPO,
// no del club entero (2026-08-13)
//
// 🔑🔑🔑 QUÉ ESTABA ROTO Y CÓMO SE SUPO. trainingPlans/{clubId}/weeks/{lunes}
// es UN SOLO documento por club y semana, y todos los entrenadores escribían
// sus días en la RAÍZ de ese documento con setDoc({merge:true}). Se comprobó
// leyendo producción por REST antes de tocar una línea: el club CD DÍA tiene
// cinco semanas creadas por DOS uid distintos. Mientras planifica una sola
// persona no se nota; en cuanto dos entrenadores tocan la misma semana sus
// días se funden y, si coinciden en fecha, el último guardado pisa al otro
// SIN ERROR. Y como la Planificación Semanal se envía a las familias, los
// padres del Alevín podían recibir los entrenamientos del Juvenil.
//
// Esto es además el cimiento del Control de Asistencia: si el cuadrante no
// sabe de qué equipo es cada día, la lista se pasa sobre las sesiones de otro.
//
// LO QUE PROTEGE:
//
//  A · 🔑 DOS ENTRENADORES DEL MISMO CLUB NO SE PISAN: lo que guarda uno no
//      aparece en el cuadrante del otro, y ninguno borra al otro.
//  B · 🔑 LA ESCRITURA VA POR RUTA PUNTEADA `teams.<teamId>`, no por un
//      merge en la raíz. Esta es la aserción que caza la regresión: un
//      setDoc con merge en la raíz volvería a fundir los equipos.
//      Y tiene que REEMPLAZAR el nodo, para que borrar un día lo borre.
//  C · 🔑 COMPATIBILIDAD HACIA ATRÁS: un documento con los días sueltos en la
//      raíz (todo lo que hay guardado hoy) se sigue leyendo. Si esto falla,
//      los entrenadores pierden su planificación al desplegar.
//  D · ⚠️ `createdBy` y `lastModified` NO SON DÍAS. Recorrer las claves del
//      documento crudo metía dos líneas de "📅 undefined Invalid Date" en el
//      mensaje que se manda a los padres. Se exige el filtro por formato.
//  E · ⚠️ LIMPIAR retira sólo el cuadrante propio. Antes hacía deleteDoc del
//      documento entero: un entrenador borraba al club completo.
//  F · ⚠️ Nadie vuelve a leer 'cronos_training_weeks' a pelo desde la
//      pantalla: dos copias de la forma del documento acaban divergiendo.
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
const SRC_PANEL = fs.readFileSync(path.join(ROOT, 'js/coach/training/panel.js'), 'utf8');

// ── Arnés: window + localStorage + un Firestore de mentira que APUNTA lo
//    que se le pide, que es lo único que permite afirmar POR DÓNDE escribe.
function nuevoEntorno() {
    const store = {};
    const localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    const calls = [];

    const win = {};
    const ctx = {
        window: win, localStorage,
        console: { log(){}, warn(){}, error(){}, debug(){} },
        setTimeout, clearTimeout, Promise, Date, JSON, Object, Array, String,
        Number, Boolean, Math, RegExp, isNaN, parseInt, parseFloat, Error,
        document: {
            getElementById: () => null,
            querySelectorAll: () => [],
            createElement: () => ({ style: {}, classList: { add(){}, remove(){} } }),
            addEventListener: () => {},
            body: { classList: { add(){}, remove(){} }, appendChild(){} }
        },
        navigator: { userAgent: 'node', onLine: true }
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);

    win.saFS = async () => ({
        db: {},
        doc: (...a) => ({ path: a.slice(1).join('/') }),
        getDoc: async () => ({ exists: () => false, data: () => ({}) }),
        setDoc: async (ref, data, opts) => { calls.push({ op: 'setDoc', path: ref.path, data, opts }); },
        updateDoc: async (ref, patch) => { calls.push({ op: 'updateDoc', path: ref.path, patch }); },
        deleteDoc: async (ref) => { calls.push({ op: 'deleteDoc', path: ref.path }); },
        collection: () => ({}),
        getDocs: async () => ({ forEach: () => {} }),
        serverTimestamp: () => '<<ts>>',
        deleteField: () => '<<deleteField>>'
    });

    vm.runInContext(SRC_UTILS, ctx);
    vm.runInContext(SRC_SYNC, ctx);

    return { ctx, win, store, calls, localStorage };
}

// Coloca en la sesión un entrenador de una categoría concreta.
function seEntra(win, clubId, category, subcategory) {
    win._cronosCurrentUser = {
        uid: 'uid_' + category + '_' + subcategory,
        clubId,
        allRoles: [{ role: 'user', clubId, category, subcategory, isAuthorized: true }]
    };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

(async () => {

// ═════════════════════════════════════════════════════════════════════
// A · DOS ENTRENADORES DEL MISMO CLUB NO SE PISAN
// ═════════════════════════════════════════════════════════════════════
{
    const { win, calls } = nuevoEntorno();
    const TS = win.TrainingSync;
    const CLUB = 'club_x';

    ok('A0 · cronosMyTeamId existe y es función',
       typeof win.cronosMyTeamId === 'function');

    seEntra(win, CLUB, 'alevin', 'C');
    const idAlevin = win.cronosMyTeamId();
    TS.saveWeek('2026-08-10', {
        '2026-08-10': { tipo: 'entrenamiento', hora: '17:00', lugar: 'Campo A' },
        '2026-08-12': { tipo: 'entrenamiento', hora: '17:00', lugar: 'Campo A' }
    });

    seEntra(win, CLUB, 'juvenil', 'B');
    const idJuvenil = win.cronosMyTeamId();
    TS.saveWeek('2026-08-10', {
        '2026-08-11': { tipo: 'entrenamiento', hora: '20:00', lugar: 'Campo B' },
        '2026-08-13': { tipo: 'partido liga',  hora: '20:00', lugar: 'Campo B' }
    });

    ok('A1 · los dos equipos dan claves distintas',
       !!idAlevin && !!idJuvenil && idAlevin !== idJuvenil,
       idAlevin + ' / ' + idJuvenil);

    // El juvenil (sesión actual) ve LO SUYO y sólo lo suyo
    const verJuvenil = TS.readWeekDays('2026-08-10');
    ok('A2 · el Juvenil ve sus 2 días',
       Object.keys(verJuvenil).length === 2 &&
       !!verJuvenil['2026-08-11'] && !!verJuvenil['2026-08-13'],
       JSON.stringify(verJuvenil));
    ok('A3 · 🔑 el Juvenil NO ve los días del Alevín',
       !verJuvenil['2026-08-10'] && !verJuvenil['2026-08-12'],
       JSON.stringify(verJuvenil));

    // Y el alevín conserva los suyos: el segundo guardado no los borró
    seEntra(win, CLUB, 'alevin', 'C');
    const verAlevin = TS.readWeekDays('2026-08-10');
    ok('A4 · 🔑 el Alevín conserva sus 2 días tras guardar el Juvenil',
       Object.keys(verAlevin).length === 2 &&
       verAlevin['2026-08-10'] && verAlevin['2026-08-10'].lugar === 'Campo A',
       JSON.stringify(verAlevin));

// ═════════════════════════════════════════════════════════════════════
// B · LA ESCRITURA VA POR RUTA PUNTEADA, NO POR MERGE EN LA RAÍZ
// ═════════════════════════════════════════════════════════════════════
    // Hasta aquí no hay init(), así que no se ha tocado Firestore.
    ok('B0 · sin init() no se escribe en Firestore', calls.length === 0,
       JSON.stringify(calls));

    win.TrainingSync.init(CLUB);
    await esperar(30);
    calls.length = 0;

    seEntra(win, CLUB, 'alevin', 'C');
    TS.saveWeek('2026-08-17', { '2026-08-17': { tipo: 'entrenamiento' } });
    await esperar(30);

    const escrituras = calls.filter(c => c.op === 'updateDoc' || c.op === 'setDoc');
    ok('B1 · se escribe una vez en la semana', escrituras.length === 1,
       JSON.stringify(calls));

    const w = escrituras[0];
    ok('B2 · 🔑 es updateDoc (reemplaza el nodo), no setDoc con merge',
       w && w.op === 'updateDoc', w && w.op);

    // ⚠️ La carga se mira SEA CUAL SEA la operación: un updateDoc la trae en
    // `patch` y un setDoc en `data`. Mirando sólo `patch`, la vuelta al
    // setDoc de la raíz dejaba B4 comparando una lista VACÍA y pasando en
    // vacío — un guard que defiende justo el defecto que persigue.
    const carga  = w ? (w.patch || w.data || {}) : {};
    const claves = Object.keys(carga);
    ok('B3 · 🔑 escribe en la ruta punteada teams.<teamId>',
       claves.indexOf('teams.' + idAlevin) !== -1, JSON.stringify(claves));

    ok('B4 · 🔑 NINGÚN día cuelga de la raíz del documento',
       claves.length > 0 && claves.every(k => !/^\d{4}-\d{2}-\d{2}$/.test(k)),
       JSON.stringify(claves));

    ok('B5 · el nodo escrito son los días, tal cual',
       w && w.patch['teams.' + idAlevin] &&
       w.patch['teams.' + idAlevin]['2026-08-17'] &&
       w.patch['teams.' + idAlevin]['2026-08-17'].tipo === 'entrenamiento',
       JSON.stringify(w && w.patch));
}

// ═════════════════════════════════════════════════════════════════════
// C · COMPATIBILIDAD HACIA ATRÁS con lo que hay guardado HOY
// ═════════════════════════════════════════════════════════════════════
{
    const { win, localStorage } = nuevoEntorno();
    const TS = win.TrainingSync;

    // Exactamente la forma que tiene producción ahora mismo: días sueltos en
    // la raíz, más los dos metadatos que escribe Firestore.
    localStorage.setItem('cronos_training_weeks', JSON.stringify({
        '2026-08-10': {
            '2026-08-10': { tipo: 'entrenamiento', hora: '20:00', lugar: 'CAMPO DE M. ARINAGA' },
            '2026-08-13': { tipo: 'partido liga',  hora: '20:00', lugar: 'CAMPO DE M. ARINAGA' },
            createdBy: 'GkycFVeqFsWD9JODEjjE3JSMw2v1',
            lastModified: { seconds: 1760000000, nanoseconds: 0 }
        }
    }));

    seEntra(win, 'club_x', 'alevin', 'C');
    const dias = TS.readWeekDays('2026-08-10');

    ok('C1 · 🔑 un documento legado (días en la raíz) se sigue leyendo',
       Object.keys(dias).length === 2 && !!dias['2026-08-10'] && !!dias['2026-08-13'],
       JSON.stringify(dias));

// ═════════════════════════════════════════════════════════════════════
// D · createdBy Y lastModified NO SON DÍAS
// ═════════════════════════════════════════════════════════════════════
    ok('D1 · ⚠️ createdBy no sale como día',   !('createdBy' in dias));
    ok('D2 · ⚠️ lastModified no sale como día', !('lastModified' in dias));
    ok('D3 · ⚠️ toda clave devuelta tiene formato YYYY-MM-DD',
       Object.keys(dias).every(k => /^\d{4}-\d{2}-\d{2}$/.test(k)),
       JSON.stringify(Object.keys(dias)));

    // Y tampoco el nodo `teams` se cuela como si fuera un día.
    localStorage.setItem('cronos_training_weeks', JSON.stringify({
        '2026-08-10': { teams: {}, createdBy: 'x', '2026-08-11': { tipo: 'entrenamiento' } }
    }));
    const dias2 = TS.readWeekDays('2026-08-10');
    ok('D4 · ⚠️ el nodo teams no sale como día',
       !('teams' in dias2) && !!dias2['2026-08-11'], JSON.stringify(dias2));
}

// ═════════════════════════════════════════════════════════════════════
// E · LIMPIAR RETIRA SÓLO EL CUADRANTE PROPIO
// ═════════════════════════════════════════════════════════════════════
{
    const { win, calls } = nuevoEntorno();
    const TS = win.TrainingSync;
    const CLUB = 'club_x';

    seEntra(win, CLUB, 'alevin', 'C');
    TS.saveWeek('2026-08-10', { '2026-08-10': { tipo: 'entrenamiento' } });
    seEntra(win, CLUB, 'juvenil', 'B');
    TS.saveWeek('2026-08-10', { '2026-08-11': { tipo: 'entrenamiento' } });

    win.TrainingSync.init(CLUB);
    await esperar(30);
    calls.length = 0;

    // El juvenil limpia SU semana
    TS.deleteWeek('2026-08-10');
    await esperar(30);

    ok('E1 · el Juvenil se queda sin días',
       Object.keys(TS.readWeekDays('2026-08-10')).length === 0,
       JSON.stringify(TS.readWeekDays('2026-08-10')));

    seEntra(win, CLUB, 'alevin', 'C');
    ok('E2 · 🔑 el Alevín CONSERVA los suyos',
       Object.keys(TS.readWeekDays('2026-08-10')).length === 1,
       JSON.stringify(TS.readWeekDays('2026-08-10')));

    ok('E3 · ⚠️ NO se borra el documento de la semana entera',
       calls.every(c => c.op !== 'deleteDoc'), JSON.stringify(calls));

    const del = calls.filter(c => c.op === 'updateDoc');
    ok('E4 · se retira el nodo con deleteField sobre teams.<teamId>',
       del.length === 1 &&
       Object.keys(del[0].patch).some(k => k.indexOf('teams.') === 0) &&
       Object.keys(del[0].patch).some(k => del[0].patch[k] === '<<deleteField>>'),
       JSON.stringify(del));
}

// ═════════════════════════════════════════════════════════════════════
// F · LA PANTALLA YA NO LEE localStorage POR SU CUENTA
// ═════════════════════════════════════════════════════════════════════
{
    // Censo de fuente: en panel.js no puede quedar ninguna lectura directa de
    // la clave. Si alguien reintroduce una, verá la forma antigua del
    // documento y pintará una semana vacía sin fallar.
    const lecturas = (SRC_PANEL.match(/getItem\(\s*'cronos_training_weeks'/g) || []).length;
    ok('F1 · ⚠️ panel.js no lee cronos_training_weeks a pelo', lecturas === 0,
       lecturas + ' lecturas directas encontradas');

    const escrituras = (SRC_PANEL.match(/setItem\(\s*'cronos_training_weeks'/g) || []).length;
    ok('F2 · ⚠️ panel.js tampoco lo escribe a pelo', escrituras === 0,
       escrituras + ' escrituras directas encontradas');

    ok('F3 · la pantalla pasa por el lector único',
       /_cronosLeerCuadrante\s*\(/.test(SRC_PANEL) &&
       /TrainingSync\.readWeekDays/.test(SRC_PANEL));

    // El texto que se envía a los padres tiene que salir del lector único:
    // era la vía por la que se colaban las líneas "Invalid Date".
    const bloqueTexto = SRC_PANEL.slice(SRC_PANEL.indexOf('function _getTrainingWeekText'),
                                        SRC_PANEL.indexOf('function openTrainingSendPanel'));
    ok('F4 · 🔑 el mensaje a los padres usa el lector único',
       /_cronosLeerCuadrante\s*\(/.test(bloqueTexto), bloqueTexto.slice(0, 200));
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n' + (fail === 0 ? 'OK' : 'FALLOS') + ': ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);

})().catch(e => { console.error('EXCEPCIÓN:', e && e.stack || e); process.exit(1); });

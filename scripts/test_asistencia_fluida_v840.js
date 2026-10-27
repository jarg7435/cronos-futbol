// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v840 · Navegar por Asistencia sin esperas
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt 27-10, capturas 11720-11722): al pasar
// de Pasar Lista al Parte Mensual (y vuelta) la pantalla se quedaba segundos
// sin reaccionar.
//
// 🔴 CAUSA MEDIDA: no era el pintado (el parte de 40 × 31 se genera en ~3 ms)
//    sino el `await cargarMes()` —una lectura de Firestore— ANTES de pintar.
// ✅ Ahora: se pinta con lo del aparato (`mesLocal`), la nube va por detrás
//    y una respuesta que llega DESPUÉS de un toque no lo pisa.
// ⚠️ Se ejecuta attendance-store.js REAL (vm) con una nube simulada lenta.
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
const clave = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// ── Store real con `import(FS_URL)` sustituido por un Firestore de mentira ──
const store = {};
let remoto = {};            // id → datos del documento
let pedidos = [];           // ids leídos
let retardo = 30;
const ctx = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem() {} },
    Date, JSON, Object, Array, String, Number, Math, Promise, parseInt, isNaN,
    setTimeout: (f, ms) => (ms >= 1000 ? 0 : setTimeout(f, ms)),   // sin publicaciones diferidas
    clearTimeout,
};
ctx.window.window = ctx.window;
ctx.window._cronosLocalDateKey = clave;
ctx.window.cronosMyTeam = () => ({ clubId: 'c1', teamId: 'c1__regional__b' });
ctx.window._cronos_auth = { db: {} };
ctx.window.__fsFalso = async () => ({
    doc: (db, a, club, b, id) => id,
    getDoc: (id) => new Promise(r => setTimeout(() => {
        pedidos.push(id);
        r({ exists: () => !!remoto[id], data: () => JSON.parse(JSON.stringify(remoto[id])) });
    }, retardo)),
    updateDoc: async () => {}, setDoc: async () => {}, serverTimestamp: () => 0, deleteField: () => null,
});
const fuente = leer('js/coach/attendance/attendance-store.js').split('import(FS_URL)').join('window.__fsFalso(FS_URL)');
vm.createContext(ctx);
vm.runInContext(fuente, ctx, { filename: 'attendance-store.js' });
const A = ctx.window.CronosAttendance;
const ID = 'c1__regional__b__2026-10';

(async () => {
    // ═══ 1 · mesLocal: al instante y sin red ═══════════════════════════════
    A.marcar('2026-10-26', 'F1', 'P', null, { tipo: 'entrenamiento' });
    pedidos = [];
    const loc = A.mesLocal('2026-10');
    ok('1a · mesLocal devuelve lo del aparato de forma SÍNCRONA (no es una promesa)',
       loc && typeof loc.then !== 'function' && loc.marks['2026-10-26'].F1.s === 'P', loc);
    ok('1b · y no toca la red', pedidos.length === 0, pedidos);

    // ═══ 2 · La nube por detrás no pisa un toque recién dado ═══════════════
    remoto[ID] = { sessions: {}, marks: { '2026-10-26': { F1: { s: 'P' } } } };   // aún sin F2
    const p = A.cargarMes('2026-10');
    A.marcar('2026-10-26', 'F2', 'I');            // el entrenador marca MIENTRAS llega
    const r = await p;
    ok('2a · la respuesta vieja NO borra la marca dada mientras llegaba',
       r.marks['2026-10-26'].F2 && r.marks['2026-10-26'].F2.s === 'I', r.marks);
    ok('2b · y la caché local sigue teniéndola', A.mesLocal('2026-10').marks['2026-10-26'].F2.s === 'I');

    // Red-check: el mismo escenario SIN el control de versión perdía el toque.
    {
        const sinGuard = fuente.replace("if ((_versionMarcas[id] || 0) !== version) return _mesLocal(id);", '');
        const c2 = Object.assign({}, ctx, { window: Object.assign({}, ctx.window) });
        c2.window.window = c2.window;
        const s2 = {};
        c2.localStorage = { getItem: (k) => (k in s2 ? s2[k] : null), setItem: (k, v) => { s2[k] = v; }, removeItem() {} };
        vm.createContext(c2);
        vm.runInContext(sinGuard, c2, { filename: 'sin-guard.js' });
        const B = c2.window.CronosAttendance;
        const p2 = B.cargarMes('2026-10');
        B.marcar('2026-10-26', 'F2', 'I');
        const r2 = await p2;
        ok('2c · red-check: sin el control, la respuesta vieja SÍ se comía la marca',
           !(r2.marks['2026-10-26'] || {}).F2, r2.marks);
    }

    // ═══ 3 · Sin toques en medio, la nube manda ════════════════════════════
    remoto[ID] = { sessions: {}, marks: { '2026-10-26': { F1: { s: 'P' }, F2: { s: 'I' }, F3: { s: 'R' } } } };
    const r3 = await A.cargarMes('2026-10');
    ok('3a · sin marcas en medio, lo de la nube se aplica y se guarda en local',
       r3.marks['2026-10-26'].F3.s === 'R' && A.mesLocal('2026-10').marks['2026-10-26'].F3.s === 'R');

    // ═══ 4 · El histórico pide también el mes mostrado ═════════════════════
    pedidos = [];
    await A.cargarHistorico('2026-10');
    ok('4a · cargarHistorico pide también el mes mostrado (la pantalla ya no lo espera)',
       pedidos.indexOf(ID) !== -1, pedidos);

    // ═══ 5 · El pintado nunca fue el cuello de botella ═════════════════════
    {
        const ses = [], pl = [], marks = {};
        for (let d = 1; d <= 31; d++) ses.push({ fecha: '2026-10-' + String(d).padStart(2, '0'), tipo: d % 7 ? 'entrenamiento' : 'partido', tipoRaw: '' });
        for (let i = 0; i < 40; i++) pl.push({ ficha: 'F' + i, dorsal: String(i), nombre: 'N' + i, alias: 'A' + i });
        ses.forEach(s => { marks[s.fecha] = {}; pl.forEach(q => { marks[s.fecha][q.ficha] = { s: 'P' }; }); });
        const t0 = process.hrtime.bigint();
        for (let k = 0; k < 20; k++) A.parteMensualHtml({ mes: '2026-10', sesiones: ses, plantel: pl, marks, extra: 'cargando' });
        const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
        ok('5a · el parte de 40 jugadores × 31 días se genera en < 50 ms (' + ms.toFixed(1) + ' ms)', ms < 50, ms);
    }

    // ═══ 6 · Cableado de las pantallas ═════════════════════════════════════
    const panel = leer('js/coach/attendance/panel.js');
    const cuerpo = (nombre) => {
        const i = panel.indexOf(nombre);
        const j = panel.indexOf('\n}', i);
        return i === -1 ? '' : panel.slice(i, j);
    };
    const abrirLista = cuerpo('async function openAttendancePanel()');
    const abrirMes   = cuerpo('async function openAttendanceMonth()');
    const elegirDia  = cuerpo('window._attElegirDia = ');
    ok('6a · Pasar Lista ya no espera a la nube antes de pintar',
       abrirLista && !/await\s+window\.CronosAttendance\.cargarMes/.test(abrirLista) && /_attAbrirMesSemana\(/.test(abrirLista));
    ok('6b · Parte Mensual ya no espera a la nube antes de pintar',
       abrirMes && !/await\s+window\.CronosAttendance\.cargarMes/.test(abrirMes) &&
       /mesLocal\(mesVisto, eq\)/.test(abrirMes) && /_attRefrescarMes\(mesVisto/.test(abrirMes));
    ok('6c · Cambiar de día (y de mes) tampoco espera', elegirDia && !/await/.test(elegirDia));
    ok('6d · ningún `await …cargarMes` queda en el panel del entrenador',
       !/await\s+window\.CronosAttendance\.cargarMes/.test(panel));
    const refrescar = cuerpo('function _attRefrescarMes(');
    ok('6e · el refresco descarta respuestas viejas, otra pantalla u otro mes, y datos iguales',
       /_attCargaToken !== token/.test(refrescar) && /navCurrent\(\) !== pantalla/.test(refrescar) &&
       /if \(!sigue\(\)\) return/.test(refrescar) && /JSON\.stringify\(datos\) === JSON\.stringify\(window\._attMes\)/.test(refrescar));
    ok('6f · el aviso «Actualizando…» no se queda colgado sin red', /setTimeout\(fin, 12000\)/.test(refrescar));
    const repintar = cuerpo('function _attRepintar(');
    ok('6g · repintar conserva el desplazamiento vertical y el horizontal de la tabla',
       /scrollTop = top/.test(repintar) && /scrollLeft = izq/.test(repintar));
    ok('6h · los dos pintados recolocan el aviso (cada innerHTML lo borra)',
       /_attPintarIndicador\(\);\n\}/.test(cuerpo('function _attRenderSemana(') + '\n}') &&
       /_attPintarIndicador\(\);\n\}/.test(cuerpo('function _attRenderMes(') + '\n}'));
    ok('6i · el aviso va en el subtítulo (no tapa VOLVER ni ✕)', /h2 \+ p/.test(cuerpo('function _attPintarIndicador(')));

    console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();

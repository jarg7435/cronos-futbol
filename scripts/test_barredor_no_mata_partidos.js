// ─────────────────────────────────────────────────────────────────────────
// test_barredor_no_mata_partidos.js · v568
//
// EL FALLO, MEDIDO EN DATOS REALES de la 2ª prueba de estrés (17/08/2026):
//   cadete-b-…-2204    status=finished  phase=1st_half  isRunning=true  autoClosed=true
//   local-…-2203       status=finished  phase=1st_half  isRunning=true  autoClosed=true
//   benjamin-c-…-2146  status=finished  phase=1st_half                  autoClosed=true
// Cerrados los tres en 133 MILISEGUNDOS, en plena primera parte, y uno de ellos
// un segundo después de crearse. El autor lo vivió como "he querido crear siete
// partidos, sólo tengo cinco y no puedo crear más": cada arranque de la app
// barría los partidos que ya estaban en marcha.
//
// 🔑🔑🔑 LA CAUSA: `data.updatedAt?.toDate?.() || new Date(0)`.
// `serverTimestamp()` es un CENTINELA: quien lee el documento antes de que el
// servidor lo confirme ve `updatedAt: null`. El `|| new Date(0)` convertía ese
// "no lo sé" en 1 de enero de 1970 → "abandonado hace 56 años" → cerrado.
//
// Es un guard de COMPORTAMIENTO: ejecuta la función real contra snapshots
// falsos que reproducen el escenario exacto.
// ─────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (n, c, extra) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (extra !== undefined) console.log('       ' + extra); }
};
const SYNC = fs.readFileSync(path.join(ROOT, 'js/match/live/sync.js'), 'utf8').replace(/\r\n/g, '\n');

// Recorta `async function cleanupStaleMatches() { … }` contando llaves.
function recorta(src, decl) {
    const i = src.indexOf(decl);
    if (i < 0) return null;
    let prof = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
        if (src[k] === '{') prof++;
        else if (src[k] === '}') { prof--; if (prof === 0) return src.slice(i, k + 1); }
    }
    return null;
}

console.log('── v568 · el barredor de abandonados no puede matar partidos vivos ──\n');

const fn = recorta(SYNC, 'async function cleanupStaleMatches()');
ok('0a · se recorta cleanupStaleMatches', !!fn);
if (!fn) { console.log('\n' + pass + ' PASS / ' + fail + ' FAIL'); process.exit(1); }

// ── Arnés: un Firestore de mentira que registra qué se cierra ──────────────
async function correr({ docs, fromCache = false, miPartido = null }) {
    const cerrados = [];
    const ts = (fecha) => fecha === null ? null : { toDate: () => fecha };
    const snap = {
        metadata: { fromCache },
        forEach: (cb) => docs.forEach(d => cb({
            id: d.id,
            data: () => ({ status: d.status, updatedAt: ts(d.updatedAt) }),
            metadata: { hasPendingWrites: !!d.pending }
        }))
    };
    const sandbox = {
        console: { warn(){}, log(){}, error(){} },
        window: {
            _cronos_auth: { db: {} },
            _cronosCurrentUser: { clubId: 'club_X' },
            _cronosMatchSlots: { getTabMatchId: () => miPartido },
            _CRONOS_DEBUG: false
        },
        // El `import(...)` dinámico del SDK, estabulado.
        __mods: {
            collection: () => ({}), query: (...a) => a, where: () => ({}),
            getDocs: async () => snap,
            doc: (_db, _col, id) => ({ id }),
            serverTimestamp: () => 'SENTINEL',
            updateDoc: async (ref, payload) => { cerrados.push({ id: ref.id, payload }); }
        }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    // Se sustituye el import dinámico por el stub, sin tocar el resto del cuerpo.
    const codigo = fn.replace(
        /await import\(\s*'https:\/\/www\.gstatic\.com\/firebasejs\/[^']+'\)/g,
        '(globalThis.__mods)');
    // ⚠️ HAY QUE ESPERARLA. `cleanupStaleMatches` es `async` y cierra dentro de
    // un `await Promise.all(...)`: mirar `cerrados` sin esperar daba una lista
    // vacía SIEMPRE, y con ella la PARTE 2 salía roja aunque el código cerrase
    // perfectamente. Un arnés que no espera mide el instante equivocado.
    await vm.runInContext(codigo + '\ncleanupStaleMatches();', sandbox);
    return cerrados;
}

const HORA = 60 * 60 * 1000;

(async () => {
const hace = (ms) => new Date(Date.now() - ms);

// ═══════════════════════════════════════════════════════════════════════════
console.log('── PARTE 1 · el escenario EXACTO del fallo ──');
{
    // Un partido recién creado cuyo serverTimestamp aún no ha resuelto:
    // updatedAt === null. Es lo que veía la caché local.
    const cerrados = await correr({ docs: [
        { id: 'cadete-b-2204', status: 'active', updatedAt: null }
    ]});
    ok('1a · 🔑🔑🔑 un partido con updatedAt SIN RESOLVER no se cierra',
       cerrados.length === 0,
       'se cerraron: ' + JSON.stringify(cerrados.map(c => c.id)));
}
{
    // Los tres del caso real, tal y como estaban.
    const cerrados = await correr({ docs: [
        { id: 'cadete-b-2204',   status: 'active', updatedAt: null },
        { id: 'local-2203',      status: 'active', updatedAt: null },
        { id: 'benjamin-c-2146', status: 'active', updatedAt: null }
    ]});
    ok('1b · 🔑 los TRES del caso real sobreviven',
       cerrados.length === 0, 'se cerraron: ' + JSON.stringify(cerrados.map(c => c.id)));
}
{
    // Escrituras locales sin confirmar: por definición, reciente.
    const cerrados = await correr({ docs: [
        { id: 'recien-escrito', status: 'active', updatedAt: hace(5 * HORA), pending: true }
    ]});
    ok('1c · 🔑 un documento con escrituras sin confirmar tampoco se cierra',
       cerrados.length === 0, JSON.stringify(cerrados.map(c => c.id)));
}
{
    const cerrados = await correr({
        docs: [{ id: 'el-mio', status: 'active', updatedAt: hace(5 * HORA) }],
        miPartido: 'el-mio'
    });
    ok('1d · 🔑 el partido que ESTA pestaña juega no se cierra nunca',
       cerrados.length === 0, JSON.stringify(cerrados.map(c => c.id)));
}
{
    const cerrados = await correr({
        docs: [{ id: 'viejo', status: 'active', updatedAt: hace(5 * HORA) }],
        fromCache: true
    });
    ok('1e · 🔑 con el resultado servido de CACHÉ no se cierra nada',
       cerrados.length === 0, JSON.stringify(cerrados.map(c => c.id)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · pero SIGUE cerrando lo que debe ──');
{
    // ⚠️ Un guard que sólo comprobara "no cierra" daría verde con la función
    // vacía. Esta parte es la que impide ese arreglo falso.
    const cerrados = await correr({ docs: [
        { id: 'abandonado', status: 'active', updatedAt: hace(5 * HORA) }
    ]});
    ok('2a · ⚠️ un partido de verdad abandonado (5 h) SÍ se cierra',
       cerrados.length === 1 && cerrados[0].id === 'abandonado',
       JSON.stringify(cerrados.map(c => c.id)));
    ok('2b · y se cierra sellando finishedAt y autoClosed',
       cerrados.length === 1 &&
       cerrados[0].payload.status === 'finished' &&
       cerrados[0].payload.autoClosed === true &&
       cerrados[0].payload.finishedAt === 'SENTINEL',
       JSON.stringify(cerrados[0] && cerrados[0].payload));
}
{
    const cerrados = await correr({ docs: [
        { id: 'reciente', status: 'active', updatedAt: hace(10 * 60 * 1000) }
    ]});
    ok('2c · uno actualizado hace 10 minutos NO se cierra',
       cerrados.length === 0, JSON.stringify(cerrados.map(c => c.id)));
}
{
    const cerrados = await correr({ docs: [
        { id: 'ya-terminado', status: 'finished', updatedAt: hace(9 * HORA) }
    ]});
    ok('2d · uno ya terminado no se vuelve a cerrar',
       cerrados.length === 0, JSON.stringify(cerrados.map(c => c.id)));
}
{
    const cerrados = await correr({ docs: [
        { id: 'abandonado-1', status: 'active',   updatedAt: hace(6 * HORA) },
        { id: 'fresco',       status: 'active',   updatedAt: null },
        { id: 'abandonado-2', status: 'active',   updatedAt: hace(7 * HORA) },
        { id: 'en-juego',     status: 'active',   updatedAt: hace(30 * 1000) }
    ]});
    ok('2e · 🔑 mezcla real: cierra sólo los dos abandonados',
       cerrados.length === 2 &&
       cerrados.every(c => c.id.startsWith('abandonado')),
       JSON.stringify(cerrados.map(c => c.id)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · lo que no puede volver ──');
{
    const sinCom = SYNC.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    const cuerpo = recorta(sinCom, 'async function cleanupStaleMatches()') || '';
    ok('3a · 🔑 no queda ningún `|| new Date(0)` en el barredor',
       !/\|\|\s*new Date\(0\)/.test(cuerpo),
       'ese valor por defecto es exactamente el fallo');
    ok('3b · la decisión exige un toDate() utilizable',
       /typeof data\.updatedAt\.toDate === 'function'/.test(cuerpo));
    ok('3c · y descarta la fecha inválida además de la ausente',
       /isNaN\(_ts\.getTime\(\)\)/.test(cuerpo));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
})();

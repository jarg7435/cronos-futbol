// ─────────────────────────────────────────────────────────────────────────
// test_startlivesync_idempotent.js  ·  Auditoria 2026-07-22, hallazgo #4
//
// v266B (commit 7b0a1f2) quito la reutilizacion del liveMatchId existente y
// paso a anadir un sufijo de HORA (_hourSlug) calculado con `new Date()` en
// CADA llamada a startLiveSync(). El builder (_cronosBuildLiveMatchId, en
// utils.js) sigue siendo determinista -y scripts/test_livematchid_idempotency.js
// ya lo verifica-, pero el LLAMADOR en js/match/live/sync.js volvia a romper
// la estabilidad: si startLiveSync() se invocaba dos veces para el MISMO
// partido (reconexion, doble disparo, o cualquier ruta futura de "resume"),
// el _hourSlug cambiaba entre llamadas y el liveMatchId resultante tambien,
// reabriendo el bug de informes duplicados al padre (P1 v167/v168).
//
// Este test carga el CODIGO REAL de startLiveSync (js/match/live/sync.js) en
// un sandbox con Firestore/window mockeados y lo ejecuta dos veces seguidas
// para el MISMO partido, verificando que produce el MISMO liveMatchId, y una
// tercera vez tras resetear liveMatchId=null (partido nuevo de verdad) para
// verificar que SI cambia.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── startLiveSync() idempotente para el mismo partido ──\n');

// ═══════════════════ PARTE 1 · estructura del codigo real ══════════════════
console.log('── PARTE 1 · estructura de js/match/live/sync.js ──');

const src = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const fnStart = src.indexOf('async function startLiveSync()');
ok('1a · existe async function startLiveSync()', fnStart !== -1);
// Aislar el cuerpo hasta la siguiente declaracion de funcion a nivel superior.
const nextFn = src.indexOf('\nasync function ', fnStart + 10);
const fnBody = src.slice(fnStart, nextFn === -1 ? undefined : nextFn);

ok('1b · [FIX] existe el guard _isNewMatch = !liveMatchId', /_isNewMatch\s*=\s*!liveMatchId/.test(fnBody));
ok('1c · [FIX] el calculo de _hourSlug queda DENTRO del guard if (_isNewMatch)',
   /if\s*\(_isNewMatch\)\s*\{[^}]*_hourSlug/s.test(fnBody));
ok('1d · [FIX] el borrado de events queda DENTRO del guard if (_isNewMatch)',
   /if\s*\(_isNewMatch\)\s*\{[^]*?_cronosMatchEvents\s*=\s*\[\]/.test(fnBody));
// normalizar CRLF->LF antes de partir por linea: sin esto, la linea queda
// con un \r colgando al final y `$` (sin flag multiline) nunca casa tras
// `.*`, asi que el comentario NUNCA se recorta (falso positivo).
const fnBodyNoComments = fnBody.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
ok('1e · sigue sin reintroducirse Math.random() en el id (código real, no en comentarios)',
   !/Math\.random\(\)/.test(fnBodyNoComments));

// ═══════════════════ PARTE 2 · ejecucion REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecucion del codigo real (mismo partido dos veces) ──');

function makeSandbox({ nowFn }) {
    const writes = [];
    const win = {
        _cronos_auth: { db: {} },
        _cronosCurrentUser: { uid: 'coachUID' },
        TEAM_NAMES: undefined,
        liveIsActive: false,
        liveSyncTimer: null,
        isRunning: false,
    };
    // TEAM_NAMES / liveSyncTimer / isRunning / liveIsActive son "globales"
    // clasicas (let a nivel de script) en el codigo real; se replican como
    // bindings del propio sandbox (no dentro de window) para que las
    // asignaciones sin `window.` dentro de la funcion las alcancen igual que
    // en el navegador (scripts clasicos comparten el scope global).
    const sandbox = {
        window: win,
        console: { log: () => {}, warn: () => {} }, // silenciar logs del propio codigo
        Date: makeFakeDate(nowFn),
        setInterval: () => 999,   // no hace falta un timer real para este test
        clearInterval: () => {},
        // Firestore mockeado: import() dinamico -> devuelve helpers fake.
        import: async () => ({
            doc: (_db, col, id) => ({ col, id }),
            updateDoc: async (ref, data) => { writes.push({ op: 'update', ref, data }); },
            setDoc: async (ref, data) => { writes.push({ op: 'set', ref, data }); },
        }),
        TEAM_NAMES: { home: 'Atlético', away: 'Rival CF' },
        liveMatchId: null,
        liveIsActive: false,
        liveSyncTimer: null,
        isRunning: false,
        updateLiveButton: () => {},
        // Helpers reales de utils.js (deterministas) para reproducir el
        // builder tal como lo usa el codigo de produccion.
        _cronosStableSlug: (seed, len) => {
            let h = 0x811c9dc5;
            for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
            return (h >>> 0).toString(36).padStart(len, '0').slice(-len);
        },
    };
    sandbox._cronosBuildLiveMatchId = function(opts) {
        const slugify = (str) => (str || 'equipo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 20);
        const teamSlug = slugify(opts.teamName);
        const now = opts.date instanceof sandbox.Date || opts.date instanceof Date ? opts.date : new sandbox.Date();
        const dateSlug = String(now.getDate()).padStart(2, '0') + String(now.getMonth() + 1).padStart(2, '0') + now.getFullYear();
        const seed = [opts.uid, teamSlug, dateSlug, slugify(opts.rivalName || '')].join('|');
        return `${teamSlug}-${dateSlug}-${sandbox._cronosStableSlug(seed, 4)}`;
    };
    return { sandbox, win, writes };
}

function makeFakeDate(nowFn) {
    class FakeDate extends Date {
        constructor(...args) {
            if (args.length === 0) { super(nowFn()); }
            else { super(...args); }
        }
    }
    return FakeDate;
}

// Extrae SOLO la funcion startLiveSync + pushLiveSnapshot (referenciada
// dentro) para poder ejecutarla; pushLiveSnapshot se stubea porque su unica
// tarea aqui es no explotar (depende de mas globals que no son objeto de
// este test).
// v572 · `startLiveSync` usa la constante de modulo LIVE_HEARTBEAT_MS (P1: el
// latido pasa de 5 s a 15 s), que queda FUERA del corte de arriba. Se extrae
// del fuente real en vez de escribir 15000 a mano: asi, si alguien renombra o
// borra la constante, este test se entera en lugar de correr sobre un valor
// inventado que ya no existe en el codigo.
const mHeartbeat = src.match(/const\s+LIVE_HEARTBEAT_MS\s*=\s*\d+\s*;/);
if (!mHeartbeat) {
    console.log('  FAIL · no se encuentra la declaracion de LIVE_HEARTBEAT_MS en sync.js');
    process.exit(1);
}

const runnable = `
${mHeartbeat[0]}
${fnBody}
async function pushLiveSnapshot(status) { return true; }
`;

async function run() {
    // Reloj: 10:00 en la 1a llamada, 10:07 en la 2a (mismo partido, distinto
    // minuto -> exactamente el escenario que rompia v266B), 10:15 en un
    // partido NUEVO tras resetear liveMatchId a null.
    let callNum = 0;
    const times = [
        new Date(2026, 6, 9, 10, 0),
        new Date(2026, 6, 9, 10, 7),
        new Date(2026, 6, 9, 10, 15),
    ];
    const { sandbox } = makeSandbox({ nowFn: () => times[Math.min(callNum, times.length - 1)].getTime() });
    vm.createContext(sandbox);
    vm.runInContext(runnable, sandbox, { filename: 'sync.js' });

    // 1a llamada: partido nuevo (liveMatchId arranca null en el sandbox).
    callNum = 0;
    await sandbox.startLiveSync();
    const idCall1 = sandbox.liveMatchId;
    ok('2a · 1a llamada genera un liveMatchId', typeof idCall1 === 'string' && idCall1.length > 0, idCall1);

    // 2a llamada: MISMO partido en curso (liveMatchId ya tiene valor), 7 min
    // despues -> con el bug (v266B) el _hourSlug cambiaria y el id tambien.
    callNum = 1;
    await sandbox.startLiveSync();
    const idCall2 = sandbox.liveMatchId;
    ok('2b · [FIX] 2a llamada (mismo partido, +7min) -> MISMO liveMatchId',
       idCall2 === idCall1, `1a=${idCall1} 2a=${idCall2}`);

    // 3a llamada: partido NUEVO de verdad (startMatchWithConvocation resetea
    // liveMatchId a null antes de llamar) -> debe generar un id DISTINTO.
    sandbox.liveMatchId = null;
    callNum = 2;
    await sandbox.startLiveSync();
    const idCall3 = sandbox.liveMatchId;
    ok('2c · partido nuevo (liveMatchId reseteado a null) -> liveMatchId DISTINTO',
       idCall3 !== idCall1, `1a=${idCall1} 3a(nuevo)=${idCall3}`);

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });

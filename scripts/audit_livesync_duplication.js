// ─────────────────────────────────────────────────────────────────────────
// audit_livesync_duplication.js  ·  Auditoría formal — Parte 1
//
// Duplicación de pushLiveSnapshot / startLiveSync / stopLiveSync.
//
// Hay TRES copias globales de cada función (funciones-declaración en scripts
// clásicos), cargadas en este orden por index.html:
//     1258  js/core/app-init.js
//     1289  js/match/live/sync.js
//     1292  js/services/firestore-sync.js   ← última ⇒ GANA
//
// Esta auditoría NO asume el ganador: lo DEMUESTRA. Las tres copias son
// `async function pushLiveSnapshot(){…}` en scripts CLÁSICOS a nivel global,
// así que el navegador aplica la semántica de "última declaración gana"
// (function-declaration hoisting con reasignación). Reproducimos exactamente
// eso: extraemos el TEXTO REAL de cada copia y las declaramos, en el mismo
// orden que index.html, en un único contexto; la que sobrevive es la que
// corre en producción. Después cotejamos los CAMPOS que emite contra los que
// live.html realmente CONSUME.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Orden REAL de <script> en index.html (los 3 que definen las funciones).
const LOAD_ORDER = [
    'js/core/app-init.js',
    'js/match/live/sync.js',
    'js/services/firestore-sync.js',
];

let fail = 0;
const ok = (name, cond, extra) => {
    if (!cond) { fail++; console.log('FAIL ' + name); if (extra) console.log('       ' + extra); }
    else console.log('PASS ' + name);
};

// Extrae el TEXTO de `async function NAME(...) { ... }` con conteo de llaves.
function extractFn(src, name) {
    const re = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
    const m = re.exec(src);
    if (!m) return null;
    const braceStart = src.indexOf('{', re.lastIndex);
    let depth = 0, i = braceStart;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(m.index, i);
}

// ── PARTE 1 · censo de definiciones ───────────────────────────────────────
console.log('\n── PARTE 1 · censo de definiciones ──');
const NAMES = ['startLiveSync', 'pushLiveSnapshot', 'stopLiveSync'];
const census = {};
for (const fn of NAMES) census[fn] = [];
for (const rel of LOAD_ORDER.concat(['js/ai/import.js'])) {
    const src = rd(rel);
    for (const fn of NAMES) {
        const re = new RegExp('function\\s+' + fn + '\\s*\\(', 'g');
        const n = (src.match(re) || []).length;
        if (n > 0) census[fn].push(`${rel}×${n}`);
    }
}
ok('1.1 · startLiveSync definida ≥3 veces', census.startLiveSync.length >= 3, census.startLiveSync.join(', '));
ok('1.2 · pushLiveSnapshot definida ≥3 veces', census.pushLiveSnapshot.length >= 3, census.pushLiveSnapshot.join(', '));
ok('1.3 · stopLiveSync definida ≥3 veces', census.stopLiveSync.length >= 3, census.stopLiveSync.join(', '));

// ── PARTE 2 · ganador en runtime (declaración-en-orden, no suposición) ────
console.log('\n── PARTE 2 · ganador en runtime (orden real de <script>) ──');

function buildSandbox() {
    const captured = { snapshot: null, mergeOpts: undefined, importUrls: [] };
    const domEl = { textContent: '0' };
    const win = {
        _cronos_auth: { db: {} },
        _cronosCurrentUser: { uid: 'coachUID', email: 'c@x.com', clubId: 'club1', clubName: 'CF Test' },
        _cronosBuildLiveMatchId: () => 'atletico-09072026-abcd',
        _cronosStableSlug: () => 'abcd',
        _userTeamRole: 'home',
        _clubTimerThresholds: { red: 40, yellow: 60 },
    };
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        window: win,
        document: { getElementById: () => domEl },
        setTimeout: (fn) => { if (fn) fn(); return 1; },
        clearInterval() {}, setInterval() { return 1; },
        Date,
        // stubs de estado global que las funciones leen (declarados en app.js real)
        liveMatchId: 'atletico-09072026-abcd', liveSyncTimer: null, liveIsActive: true,
        isRunning: true, currentMode: 'f7', matchPhase: '1st_half',
        masterTimeH1: 65, masterTimeH2: 0, half1MaxTime: 1800, half2MaxTime: 1800,
        lastTickTime: Date.now(), activeFormationKey: '1-3-3',
        TEAM_NAMES: { home: 'Atlético', away: 'Rival CF' },
        COLORS: { home: { primary: '#e11', shorts: '#fff', text: '#000' },
                  away: { primary: '#11e', shorts: '#000', text: '#fff' } },
        players: [{ id: 1, number: 7, name: 'A', team: 'home', status: 'field', time: 65,
                    goals: 1, cards: 'ninguna', injured: false, x: 10, y: 20,
                    color: '#e11', shortsColor: '#fff', textColor: '#000' }],
        updateLiveButton() {},
        // helpers internos de match/live/sync.js (stubbeados)
        _fetchClubTimerThresholds: async () => ({ red: 40, yellow: 60 }),
        _loadEventsFromFirestore: async () => {},
        _eventsLoadedFromFirestore: true,
        // import() dinámico interceptado
        __imp: async (url) => {
            captured.importUrls.push(url);
            return {
                serverTimestamp: () => '<<serverTimestamp>>',
                doc: () => ({}),
                setDoc: async (_ref, snap, opts) => { captured.snapshot = snap; captured.mergeOpts = opts; },
                updateDoc: async () => {}, getDoc: async () => ({ exists: () => false, data: () => ({}) }),
            };
        },
    };
    return { sandbox, captured };
}

// Declara las 3 copias de pushLiveSnapshot en orden (última gana), reescribiendo
// `import(` → `__imp(` para interceptar el setDoc. Las funciones-declaración se
// reasignan: exactamente lo que hace el navegador con 3 <script> clásicos.
function loadInOrder(name) {
    const { sandbox, captured } = buildSandbox();
    vm.createContext(sandbox);
    let bodies = '';
    for (const rel of LOAD_ORDER) {
        const fnText = extractFn(rd(rel), name);
        if (!fnText) continue;
        bodies += '\n' + fnText.replace(/\bimport\s*\(/g, '__imp(') + '\n';
    }
    vm.runInContext(bodies, sandbox, { filename: name + '.combined.js' });
    return { sandbox, captured };
}

const { sandbox, captured } = loadInOrder('pushLiveSnapshot');
const runner = vm.runInContext('(async () => { await pushLiveSnapshot("active"); })()', sandbox);

runner.then(() => {
    const snap = captured.snapshot;
    ok('2.1 · pushLiveSnapshot ganador produjo un snapshot', !!snap, 'no se capturó snapshot');

    const hasPhaseStarted = snap && ('phaseStartedAt' in snap);
    const hasThresholds   = snap && ('timerThresholds' in snap);
    const hasCreatedBy    = snap && ('createdBy' in snap);
    const hasClubName     = snap && ('clubName' in snap);
    const playerHasColor  = snap && snap.players && snap.players[0] && ('color' in snap.players[0]);
    const usesMerge       = captured.mergeOpts && captured.mergeOpts.merge === true;

    console.log('\n   → campos del snapshot GANADOR:');
    console.log('     phaseStartedAt :', hasPhaseStarted, '  (sí en match/live/sync.js)');
    console.log('     timerThresholds:', hasThresholds, '  (sí en match/live/sync.js)');
    console.log('     createdBy      :', hasCreatedBy);
    console.log('     clubName       :', hasClubName);
    console.log('     player.color   :', playerHasColor, '  (sí en firestore-sync.js)');
    console.log('     setDoc merge   :', usesMerge);

    // El ganador es firestore-sync.js: emite colores por jugador y merge:true,
    // pero NO phaseStartedAt ni timerThresholds ni createdBy/clubName.
    ok('2.2 · GANADOR = js/services/firestore-sync.js (última en <script>)',
       playerHasColor && usesMerge && !hasPhaseStarted && !hasThresholds && !hasCreatedBy,
       `phaseStartedAt=${hasPhaseStarted} thresholds=${hasThresholds} createdBy=${hasCreatedBy} playerColor=${playerHasColor} merge=${usesMerge}`);

    // ── PARTE 3 · impacto: features que live.html consume y el ganador NO emite ──
    console.log('\n── PARTE 3 · impacto sobre live.html ──');
    const liveHtml = rd('live.html');
    const consumes = (needle) => liveHtml.includes(needle);

    ok('3.1 · live.html CONSUME data.phaseStartedAt (crono autónomo)', consumes('phaseStartedAt'));
    ok('3.2 · live.html CONSUME data.timerThresholds (semáforo del club)', consumes('timerThresholds'));
    const hasClubId       = snap && ('clubId' in snap);
    ok('3.3 · live.html CONSUME m.createdBy (permiso de vista del coach)', consumes('m.createdBy'));

    ok('3.4 · REGRESIÓN: crono autónomo roto — ganador NO emite phaseStartedAt',
       consumes('phaseStartedAt') && !hasPhaseStarted,
       'live.html cuenta el reloj de forma autónoma con phaseStartedAt; firestore-sync.js NO lo emite');
    ok('3.5 · REGRESIÓN: semáforo del club roto — ganador NO emite timerThresholds',
       consumes('timerThresholds') && !hasThresholds,
       'live.html pinta el semáforo con timerThresholds del club; firestore-sync.js NO lo emite → cae a defaults 33/50');
    // El permiso principal en _userCanFollow es m.clubId===userData.clubId, que el
    // ganador SÍ emite. createdBy/coachEmail son RUTAS DE RESPALDO (coach sin
    // clubId, o display del email para superadmin/admin) que quedan degradadas.
    ok('3.6 · MITIGADO: el permiso primario (clubId) SÍ lo emite el ganador',
       hasClubId, 'clubId presente → el staff del mismo club sigue viendo el partido');
    ok('3.7 · DEGRADACIÓN menor: rutas de respaldo createdBy/coachEmail perdidas',
       consumes('m.createdBy') && !hasCreatedBy && !hasClubName,
       'coach sin clubId, y el display del email para superadmin/admin, dejan de funcionar');

    // ── PARTE 4 · divergencias de startLiveSync entre las 3 copias ────────
    console.log('\n── PARTE 4 · startLiveSync: divergencias entre copias ──');
    const bodies = LOAD_ORDER.map(rel => ({ rel, body: extractFn(rd(rel), 'startLiveSync') || '' }));
    const winner = bodies[bodies.length - 1]; // firestore-sync.js (última)

    // 4.1 · el ganador NO tiene guard anti-doble-intervalo (app-init.js sí).
    const appInit = bodies.find(b => /app-init/.test(b.rel));
    ok('4.1 · app-init.js SÍ protege contra intervalos duplicados (clearInterval antes de setInterval)',
       /if\s*\(\s*liveSyncTimer\s*\)\s*clearInterval/.test(appInit.body));
    ok('4.2 · FUGA: el GANADOR (firestore-sync.js) NO limpia el intervalo previo → leak si se llama 2×',
       !/clearInterval\s*\(\s*liveSyncTimer\s*\)/.test(winner.body),
       'setInterval sin clearInterval previo: startLiveSync() dos veces deja timers huérfanos');

    // 4.3 · el ganador empuja cada 1s SOLO si isRunning; match/live/sync.js empuja
    // cada 5s SIEMPRE (incluso en pausa). Divergencia de comportamiento observable.
    const liveSync = bodies.find(b => /live\/sync/.test(b.rel));
    ok('4.3 · GANADOR: intervalo 1000ms y sólo si isRunning (no empuja en pausa)',
       /\}\s*,\s*1000\s*\)/.test(winner.body) && /liveIsActive\s*&&\s*isRunning/.test(winner.body));
    ok('4.4 · match/live/sync.js (copia perdedora): 5000ms y empuja aunque esté en pausa',
       /\}\s*,\s*5000\s*\)/.test(liveSync.body) && /if\s*\(\s*liveIsActive\s*\)\s*pushLiveSnapshot/.test(liveSync.body));

    // 4.5 · sólo match/live/sync.js resetea el array events del doc (v265). El
    // ganador NO lo hace → depende de que el matchId (con hora) sea nuevo.
    ok('4.5 · GANADOR no resetea el array events del doc (lógica v265 sólo en la copia perdedora)',
       !/events:\s*\[\]/.test(winner.body) && /events:\s*\[\]/.test(liveSync.body));

    // ── PARTE 5 · sanity del harness ──────────────────────────────────────
    console.log('\n── PARTE 5 · sanity del harness ──');
    ok('5.1 · el push usó import() dinámico de firebase-firestore',
       captured.importUrls.some(u => /firebase-firestore/.test(u)), captured.importUrls.join(', '));

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
    process.exit(fail ? 1 : 0);
}).catch(err => {
    console.log('ERROR ejecutando pushLiveSnapshot ganador:', err && err.stack || err);
    process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────
// audit_livesync_duplication.js  ·  Guard de regresión post-unificación (v276)
//
// HISTORIA: existían 3 copias globales de startLiveSync/pushLiveSnapshot/
// stopLiveSync (app-init.js, match/live/sync.js, firestore-sync.js). Por orden
// de <script>, ganaba silenciosamente firestore-sync.js, que NO emitía
// phaseStartedAt ni timerThresholds → degradaba features de live.html.
//
// La Parte 3 UNIFICÓ todo en js/match/live/sync.js (fuente única de verdad) y
// eliminó las copias de app-init.js y firestore-sync.js.
//
// Este script ahora GUARDA ese estado: falla si alguien reintroduce una copia
// duplicada o si la copia única deja de emitir los campos críticos. NO asume
// el ganador: extrae el texto REAL de la(s) copia(s) y ejecuta la superviviente
// con un import() de Firestore interceptado, igual que antes.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Todos los ficheros que HISTÓRICAMENTE definieron estas funciones. El guard
// verifica que solo UNO (la fuente única) las siga definiendo.
const CANDIDATE_FILES = [
    'js/core/app-init.js',
    'js/match/live/sync.js',
    'js/services/firestore-sync.js',
];
const SOURCE_OF_TRUTH = 'js/match/live/sync.js';

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

// ── PARTE 1 · una sola definición por función (fuente única) ───────────────
console.log('\n── PARTE 1 · fuente única (sin copias duplicadas) ──');
const NAMES = ['startLiveSync', 'pushLiveSnapshot', 'stopLiveSync'];
for (const fn of NAMES) {
    const owners = [];
    for (const rel of CANDIDATE_FILES) {
        const re = new RegExp('function\\s+' + fn + '\\s*\\(', 'g');
        const n = (rd(rel).match(re) || []).length;
        if (n > 0) owners.push(`${rel}×${n}`);
    }
    ok(`1.· ${fn} definida EXACTAMENTE 1 vez`, owners.length === 1 && /live\/sync/.test(owners[0]),
       'owners=' + (owners.join(', ') || 'ninguno'));
}
ok('1.4 · firestore-sync.js YA NO define ninguna de las 3',
   NAMES.every(fn => !new RegExp('function\\s+' + fn + '\\s*\\(').test(rd('js/services/firestore-sync.js'))));
ok('1.5 · app-init.js YA NO define ninguna de las 3',
   NAMES.every(fn => !new RegExp('function\\s+' + fn + '\\s*\\(').test(rd('js/core/app-init.js'))));

// ── PARTE 2 · la copia única emite los campos correctos ───────────────────
console.log('\n── PARTE 2 · snapshot de la fuente única ──');

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
        _fetchClubTimerThresholds: async () => ({ red: 40, yellow: 60 }),
        _loadEventsFromFirestore: async () => {},
        _eventsLoadedFromFirestore: true,
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

const { sandbox, captured } = buildSandbox();
vm.createContext(sandbox);
const pushText = extractFn(rd(SOURCE_OF_TRUTH), 'pushLiveSnapshot').replace(/\bimport\s*\(/g, '__imp(');
vm.runInContext(pushText, sandbox, { filename: 'pushLiveSnapshot.js' });
const runner = vm.runInContext('(async () => { await pushLiveSnapshot("active"); })()', sandbox);

runner.then(() => {
    const snap = captured.snapshot;
    ok('2.1 · pushLiveSnapshot produjo un snapshot', !!snap);

    const has = (k) => snap && (k in snap);
    const playerHasColor = snap && snap.players && snap.players[0] && ('color' in snap.players[0]);
    const usesMerge = captured.mergeOpts && captured.mergeOpts.merge === true;

    console.log('\n   → campos de la copia ÚNICA:');
    for (const k of ['phaseStartedAt', 'timerThresholds', 'createdBy', 'coachEmail', 'clubId'])
        console.log('     ' + k.padEnd(16), has(k));
    console.log('     player.color   ', playerHasColor);
    console.log('     setDoc merge   ', usesMerge);

    ok('2.2 · emite phaseStartedAt (crono autónomo en live.html)', has('phaseStartedAt'));
    ok('2.3 · emite timerThresholds (semáforo del club)', has('timerThresholds'));
    ok('2.4 · emite createdBy + coachEmail (permiso de vista)', has('createdBy') && has('coachEmail'));
    ok('2.5 · emite clubId (permiso primario)', has('clubId'));
    ok('2.6 · emite colores por jugador (portados desde firestore-sync.js)', playerHasColor);
    ok('2.7 · usa setDoc({ merge: true })', usesMerge);

    // ── PARTE 3 · live.html sigue consumiendo esos campos ─────────────────
    console.log('\n── PARTE 3 · compatibilidad con live.html ──');
    const liveHtml = rd('live.html');
    ok('3.1 · live.html consume phaseStartedAt', liveHtml.includes('phaseStartedAt'));
    ok('3.2 · live.html consume timerThresholds', liveHtml.includes('timerThresholds'));
    ok('3.3 · live.html consume m.createdBy', liveHtml.includes('m.createdBy'));

    // ── PARTE 4 · startLiveSync: 5000ms + isRunning + guard ───────────────
    console.log('\n── PARTE 4 · startLiveSync unificada ──');
    const body = extractFn(rd(SOURCE_OF_TRUTH), 'startLiveSync') || '';
    ok('4.1 · latido 5000ms', /\}\s*,\s*5000\s*\)/.test(body));
    ok('4.2 · empuja SOLO con liveIsActive && isRunning', /liveIsActive\s*&&\s*isRunning\s*\)\s*pushLiveSnapshot/.test(body));
    ok('4.3 · guard anti-doble-intervalo (clearInterval antes de setInterval)',
       /if\s*\(\s*liveSyncTimer\s*\)\s*clearInterval\s*\(\s*liveSyncTimer\s*\)/.test(body));

    // ── PARTE 5 · sanity ──────────────────────────────────────────────────
    console.log('\n── PARTE 5 · sanity del harness ──');
    ok('5.1 · el push usó import() dinámico de firebase-firestore',
       captured.importUrls.some(u => /firebase-firestore/.test(u)));

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
    process.exit(fail ? 1 : 0);
}).catch(err => {
    console.log('ERROR ejecutando pushLiveSnapshot:', err && err.stack || err);
    process.exit(1);
});

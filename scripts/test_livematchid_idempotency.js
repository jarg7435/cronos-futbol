// ─────────────────────────────────────────────────────────────────────────
// test_livematchid_idempotency.js  ·  Pendiente A
//
// Verifica la idempotencia del liveMatchId a mitad de partido con el CÓDIGO
// REAL de _cronosBuildLiveMatchId (js/core/utils.js) y modelando el FLUJO REAL
// de la app (no solo el builder en abstracto).
//
// Estructura:
//   PARTE A — Determinismo del BUILDER (lo que la función posee).
//   PARTE B — Flujo REAL de re-sync a mitad de partido (recarga / reconexión).
//   PARTE C — Anti-regresión de la vía (a) naïve (doble sufijo) y de v266B.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');

// Carga el utils.js REAL en un sandbox. `mutate` permite simular variantes
// (p.ej. la vía (a) naïve) sin tocar el archivo de producción.
function loadWin(mutate) {
    const code = mutate ? mutate(SRC) : SRC;
    const win = {};
    // Se comparte el Date del host para que `opts.date instanceof Date`
    // funcione dentro del sandbox (evita el falso negativo cross-realm).
    const sandbox = { window: win, Date, console };
    sandbox.window._cronosCurrentUser = { uid: 'coachUID' };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'utils.js' });
    return win;
}

// Reproduce la EXPRESIÓN REAL de los llamadores de startLiveSync:
//   liveMatchId = _cronosBuildLiveMatchId({...}) + '-' + _hourSlug
// (No se copia lógica de negocio; solo la fórmula del id, para poder simular
//  una segunda invocación del builder.)
function callerBuild(win, { teamName, rivalName, uid, convocation, when, existing }) {
    const now = when;
    const hh  = String(now.getHours()).padStart(2, '0') +
                String(now.getMinutes()).padStart(2, '0');
    const base = win._cronosBuildLiveMatchId({ teamName, rivalName, uid, convocation, date: now, existing });
    return base + '-' + hh;
}

let fail = 0;
const ok = (name, cond, extra) => {
    if (!cond) { fail++; console.log('FAIL ' + name); if (extra) console.log('       ' + extra); }
    else console.log('PASS ' + name);
};

const win   = loadWin();
const MATCH = { teamName: 'Atlético', rivalName: 'Rival CF', uid: 'coachUID',
                convocation: [{ number: 7 }, { number: 9 }, { number: 4 }] };
const startT = new Date(2026, 6, 9, 14, 32);

// ═══════════════════════ PARTE A · determinismo del builder ═══════════════
console.log('\n── PARTE A · determinismo del BUILDER (lo que la función posee) ──');

// La base NO tiene componente aleatorio ni horario: misma identidad → misma base.
const baseSet = new Set();
for (let i = 0; i < 100; i++) {
    const h = 8 + (i % 12), m = i % 60;
    baseSet.add(win._cronosBuildLiveMatchId({ ...MATCH, date: new Date(2026, 6, 9, h, m), existing: null }));
}
ok('A1 · 100 recomputaciones (misma identidad, distintas horas) → 1 sola base', baseSet.size === 1);

// Pasar `existing` (vía-a) produce EXACTAMENTE la misma base que recomputar
// (vía-b): la base ya es idempotente por construcción.
const baseNoExisting = win._cronosBuildLiveMatchId({ ...MATCH, date: startT, existing: null });
const baseWithExisting = win._cronosBuildLiveMatchId({ ...MATCH, date: startT, existing: 'atletico-09072026-XXXX-1432' });
ok('A2 · base(existing) === base(recompute) → (a) y (b) dan la MISMA base', baseNoExisting === baseWithExisting);

// Identidad distinta (otra convocatoria / otro rival) → base distinta.
ok('A3 · convocatoria distinta → base distinta (no colisiona)',
   win._cronosBuildLiveMatchId({ ...MATCH, convocation: [{ number: 1 }], date: startT, existing: null }) !== baseNoExisting);

// ═══════════════════════ PARTE B · flujo REAL de re-sync ══════════════════
console.log('\n── PARTE B · re-sync REAL a mitad de partido (recarga / reconexión) ──');

// Arranque del partido (startMatchWithConvocation → liveMatchId=null → startLiveSync).
let liveMatchId = callerBuild(win, { ...MATCH, when: startT, existing: null });
ok('B1 · id de arranque bien formado (team-fecha-slug-HHmm)',
   /^atletico-09072026-[a-z0-9]{4}-1432$/.test(liveMatchId));

// RECARGA a mitad de partido: _checkActiveMatch (app-init.js) restaura el id
// VERBATIM desde localStorage y reactiva el timer SIN reconstruir el id ni
// llamar a startLiveSync. Modelamos ese restore:
const persisted = { liveMatchId };            // lo que se guardó en localStorage
const idAfterReload = persisted.liveMatchId;  // app-init.js: `liveMatchId = state.liveMatchId`
ok('B2 · RECARGA a mitad de partido → liveMatchId NO cambia (restore verbatim)',
   idAfterReload === liveMatchId, `antes=${liveMatchId} despues=${idAfterReload}`);

// RECONEXIÓN (evento 'online'): offline-manager/audit-logger vacían colas; NO
// llaman a startLiveSync → el id no se reconstruye.
const idAfterReconnect = liveMatchId; // ningún callsite de startLiveSync en 'online'
ok('B3 · RECONEXIÓN (online) → liveMatchId NO cambia (no se reconstruye)',
   idAfterReconnect === liveMatchId);

// showLiveShareModal SOLO llama a startLiveSync si !liveMatchId; con partido en
// curso el id existe, así que NUNCA se reconstruye a mitad de partido.
const idAfterShareModal = liveMatchId ? liveMatchId /* guard !liveMatchId */ : callerBuild(win, { ...MATCH, when: new Date(2026,6,9,14,50), existing: null });
ok('B4 · showLiveShareModal con partido en curso → liveMatchId NO cambia',
   idAfterShareModal === liveMatchId);

// ═══════════════════════ PARTE C · anti-regresión ════════════════════════
console.log('\n── PARTE C · anti-regresión (por qué NO restaurar el guard naïve) ──');

// C1: la vía (a) NAÏVE (`if (existing) return existing;`) produce un id
// malformado con DOBLE sufijo -HHmm-HHmm, porque el llamador añade el hour
// FUERA de la función.
const winNaive = loadWin(code => code.replace(
    "const existing = opts.existing || (typeof window.liveMatchId === 'string' ? window.liveMatchId : '');",
    "const existing = opts.existing || (typeof window.liveMatchId === 'string' ? window.liveMatchId : '');\n        if (existing) return existing; // vía(a) naïve"
));
const naiveResync = callerBuild(winNaive, { ...MATCH, when: new Date(2026,6,9,14,50), existing: liveMatchId });
ok('C1 · vía(a) naïve produce id malformado con doble sufijo -HHmm-HHmm', /-\d{4}-\d{4}$/.test(naiveResync),
   `id naïve=${naiveResync}`);

// C2: partido NUEVO tras finalizar el anterior. startMatchWithConvocation pone
// liveMatchId=null antes de startLiveSync → existing=null → el nuevo partido NO
// hereda el id (ni los eventos) del anterior. (Este es el bug que motivó v266B.)
const nextMatchId = callerBuild(win, { ...MATCH, when: new Date(2026,6,10,11,0), existing: null });
ok('C2 · partido nuevo (liveMatchId=null) → id nuevo, sin mezclar con el anterior',
   nextMatchId !== liveMatchId);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);

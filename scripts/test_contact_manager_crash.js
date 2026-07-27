// ─────────────────────────────────────────────────────────────────────────
// test_contact_manager_crash.js  ·  "Cannot read properties of undefined
// (reading 'push')" al abrir el Gestor de Contactos (botón CONTACTOS)
//
// Causa: openContactManager() (js/coach/comms/panel.js) usaba en TODO su
// cuerpo la variable GLOBAL `emailConfig` (sin `window.`), declarada con
// `let emailConfig = {...}` en js/core/app-init.js SIN campo `contacts`.
// Los dos guards defensivos al principio de la función solo inicializaban
// `window.emailConfig` — una variable DISTINTA que el resto de la función
// nunca lee (son dos bindings distintos con el mismo nombre: `let` a nivel
// de script NO cuelga de `window`). La ganadora de las 3 copias de
// `loadEmailConfig` (js/services/firestore-storage.js) solo rellena
// `.contacts` si YA hay algo en localStorage — en cualquier navegador/cuenta
// que nunca haya guardado contactos antes, `emailConfig.contacts` es
// `undefined` y el primer `.push()` (al fusionar los usuarios del club)
// revienta.
//
// Este test carga el código REAL de openContactManager en un sandbox que
// reproduce exactamente esa condición (emailConfig SIN contacts, localStorage
// vacío) y confirma que ya no crashea.
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

console.log('── Crash del Gestor de Contactos (emailConfig.contacts undefined) ──\n');

// openContactManager se extrajo a js/coach/comms/contact-manager.js en el paso
// 4 del refactor del monolito #3 (auditoría 2026-07-22). Se lee de allí si el
// archivo existe. SIN esto, indexOf('async function openContactManager()')
// devolvería -1 y este test pasaría a fallar entero — y como está en XFAIL,
// la suite seguiría verde y el destrozo sería invisible. Las aserciones NO se
// tocan: siguen describiendo la señal original.
const _CM = path.join(ROOT, 'js', 'coach', 'comms', 'contact-manager.js');
const src = fs.readFileSync(
    fs.existsSync(_CM) ? _CM : path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

// ═══════════════════ PARTE 1 · estructura del código real ══════════════════
console.log('── PARTE 1 · estructura ──');
const fnStart = src.indexOf('async function openContactManager()');
ok('1a · existe openContactManager', fnStart !== -1);
const fnBody = src.slice(fnStart, src.indexOf('\nasync function ', fnStart + 10));

ok('1b · [FIX] asegura emailConfig (variable global, no window.emailConfig) antes de usarla',
   /if \(typeof emailConfig === 'undefined'\) emailConfig = \{ contacts: \[\] \};/.test(fnBody));
ok('1c · [FIX] asegura emailConfig.contacts como array antes del primer push',
   /if \(!emailConfig\.contacts\) emailConfig\.contacts = \[\];/.test(fnBody));

// El fix debe estar ANTES del primer uso real (el forEach que hace push).
const fixIdx   = fnBody.indexOf("if (!emailConfig.contacts) emailConfig.contacts = [];");
const firstUse = fnBody.indexOf('emailConfig.contacts.push');
ok('1d · el fix se aplica ANTES del primer emailConfig.contacts.push', fixIdx !== -1 && firstUse !== -1 && fixIdx < firstUse);

// ═══════════════════ PARTE 2 · ejecución REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecución del código real (condición exacta del crash) ──');

async function run() {
    const sandbox = {
        window: {
            _cronosCurrentUser: { uid: 'coachUID', email: 'coach@club.com', clubId: 'clubX' },
            _cronos_auth: { db: {} },
        },
        // Reproduce EXACTAMENTE la condición del bug: `let emailConfig` sin
        // `contacts`, y loadEmailConfig() que NO lo rellena porque no hay
        // nada en localStorage (cuenta/navegador nunca usado antes).
        emailConfig: { coachEmail: '', directorEmail: '', whatsappNumber: '' },
        loadEmailConfig: function() { /* localStorage vacío: no hace nada, como en producción */ },
        showSpinner: () => {}, hideSpinner: () => {}, showToast: () => {},
        console: { log(){}, warn(){}, error(){} },
        localStorage: { getItem: () => null, setItem: () => {} },
        document: {
            getElementById: () => ({ style: {}, innerHTML: '' }),
        },
        currentMode: 'f11',
        renderContactRowMarkup: () => '',
        renderParentRowMarkup: () => '',
        import: async () => ({
            collection: (_db, name) => ({ __col: name }),
            getDocs: async (q) => {
                // Simula: sin player links, pero SÍ hay usuarios del club
                // (director/coordinador/entrenador) — esto es lo que dispara
                // el primer emailConfig.contacts.push() en el bug original.
                if (q.__col === 'cronos_player_links') return { forEach: () => {} };
                if (q.__col === 'users') {
                    const docs = [
                        { id: 'directorUID', data: () => ({ displayName: 'Director', email: 'dir@club.com', role: 'director', clubId: 'clubX' }) },
                        { id: 'coordUID',    data: () => ({ displayName: 'Coordinador', email: 'coord@club.com', role: 'coordinator', clubId: 'clubX' }) },
                    ];
                    return { forEach: (cb) => docs.forEach(cb) };
                }
                return { forEach: () => {} };
            },
            query: (col, ...w) => ({ __col: col.__col }),
            where: () => ({}),
        }),
    };
    // La función usa `import(...)` real (dynámico) -> se sustituye por __imp,
    // igual que en el resto de tests del proyecto (audit_livesync_duplication.js).
    const patched = fnBody.replace(/\bimport\s*\(/g, '__imp(');
    sandbox.__imp = sandbox.import;

    vm.createContext(sandbox);
    vm.runInContext(patched, sandbox, { filename: 'openContactManager.js' });

    let threw = null;
    try {
        await sandbox.openContactManager();
    } catch (e) {
        threw = e;
    }

    ok('2a · openContactManager() NO lanza "Cannot read properties of undefined"',
       !threw, threw ? (threw.message || String(threw)) : undefined);
    ok('2b · emailConfig.contacts terminó siendo un array', Array.isArray(sandbox.emailConfig.contacts));
    ok('2c · el director y el coordinador del club se añadieron a los contactos',
       Array.isArray(sandbox.emailConfig.contacts) &&
       sandbox.emailConfig.contacts.some(c => c.uid === 'directorUID') &&
       sandbox.emailConfig.contacts.some(c => c.uid === 'coordUID'),
       JSON.stringify((sandbox.emailConfig.contacts || []).map(c => c.uid)));
}

run().then(() => {
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
}).catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });

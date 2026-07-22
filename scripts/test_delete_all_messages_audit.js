// ─────────────────────────────────────────────────────────────────────────
// test_delete_all_messages_audit.js  ·  Auditoria 2026-07-22, hallazgo #6
//
// coachDeleteAllMessages (js/coach/comms/panel.js) y ppDeleteAllMessages
// (js/parent/panel.js) vaciaban por completo un hilo de cronos_messages
// (incluidos los mensajes de la OTRA parte: familia<->entrenador de un
// menor) con un simple `updateDoc({ messages: [] })`, sin dejar rastro de
// quien lo hizo ni cuando, y sin posibilidad de recuperacion. Unica
// salvaguarda: un confirm() de cliente.
//
// Fix: antes de vaciar, se archiva el contenido en `deletedMessagesLog`
// (arrayUnion) con quien/cuando/cuantos mensajes -> borrado LOGICO, no
// destructivo, con auditoria minima.
//
// Este test carga el CODIGO REAL de ambas funciones en un sandbox con
// Firestore/confirm mockeados y verifica el payload real de updateDoc.
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

console.log('── borrado masivo de mensajes: auditoria + borrado logico ──\n');

// ═══════════════════ PARTE 1 · estructura del codigo real ══════════════════
console.log('── PARTE 1 · estructura ──');

const coachSrc  = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');
const parentSrc = fs.readFileSync(path.join(ROOT, 'js', 'parent', 'panel.js'), 'utf8');

function extractFn(src, marker) {
    const start = src.indexOf(marker);
    if (start === -1) return '';
    const end = src.indexOf('\n};', start);
    return src.slice(start, end === -1 ? undefined : end + 3);
}

const coachFn  = extractFn(coachSrc,  'window.coachDeleteAllMessages = async');
const parentFn = extractFn(parentSrc, 'window.ppDeleteAllMessages = async');

ok('1a · coachDeleteAllMessages existe', coachFn.length > 0);
ok('1b · ppDeleteAllMessages existe', parentFn.length > 0);
ok('1c · [FIX] coachDeleteAllMessages escribe deletedMessagesLog vía arrayUnion',
   /deletedMessagesLog:\s*arrayUnion\(/.test(coachFn));
ok('1d · [FIX] ppDeleteAllMessages escribe deletedMessagesLog vía arrayUnion',
   /deletedMessagesLog:\s*arrayUnion\(/.test(parentFn));
ok('1e · coachDeleteAllMessages registra deletedBy/deletedByEmail/deletedAt/messageCount',
   /deletedBy:/.test(coachFn) && /deletedByEmail:/.test(coachFn) && /deletedAt:/.test(coachFn) && /messageCount:/.test(coachFn));
ok('1f · ppDeleteAllMessages registra deletedBy/deletedByEmail/deletedAt/messageCount',
   /deletedBy:/.test(parentFn) && /deletedByEmail:/.test(parentFn) && /deletedAt:/.test(parentFn) && /messageCount:/.test(parentFn));
ok('1g · ambas siguen pidiendo confirm() antes de vaciar',
   /confirm\(/.test(coachFn) && /confirm\(/.test(parentFn));

// ═══════════════════ PARTE 2 · ejecucion REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecucion del código real (coachDeleteAllMessages) ──');

async function runCoach() {
    const updates = [];
    const existing = {
        messages: [
            { sender: 'coach', text: 'hola', timestamp: '2026-07-01T10:00:00.000Z' },
            { sender: 'parent', text: 'gracias', timestamp: '2026-07-01T10:05:00.000Z' },
        ],
    };
    const sandbox = {
        window: {
            _cronosCurrentUser: { uid: 'coachUID', email: 'coach@club.com' },
        },
        confirm: () => true,
        console: { log() {}, warn() {}, error() {} },
        showToast: () => {},
        _loadThreadMessages: async () => {},
        _cFS: async () => ({
            db: {},
            doc: (_db, col, id) => ({ col, id }),
            getDoc: async (ref) => ({ exists: () => true, data: () => existing }),
            updateDoc: async (ref, data) => { updates.push(data); },
            arrayUnion: (...vals) => ({ __arrayUnion: vals }),
        }),
    };
    vm.createContext(sandbox);
    vm.runInContext(coachFn, sandbox, { filename: 'coach-panel.js' });
    await sandbox.window.coachDeleteAllMessages('thread1', 'coach');

    ok('2a · updateDoc se llamó una vez', updates.length === 1);
    const payload = updates[0] || {};
    ok('2b · messages queda vacío en el hilo (limpieza de UI)',
       Array.isArray(payload.messages) && payload.messages.length === 0);
    const logEntry = payload.deletedMessagesLog && payload.deletedMessagesLog.__arrayUnion
        ? payload.deletedMessagesLog.__arrayUnion[0] : null;
    ok('2c · deletedMessagesLog archiva los 2 mensajes previos (borrado lógico, no destructivo)',
       !!logEntry && Array.isArray(logEntry.messages) && logEntry.messages.length === 2,
       JSON.stringify(logEntry));
    ok('2d · deletedMessagesLog identifica al autor del borrado (uid+email)',
       !!logEntry && logEntry.deletedBy === 'coachUID' && logEntry.deletedByEmail === 'coach@club.com');
    ok('2e · messageCount coincide con los mensajes archivados', !!logEntry && logEntry.messageCount === 2);
}

console.log('\n── PARTE 3 · ejecucion del código real (ppDeleteAllMessages) ──');

async function runParent() {
    const updates = [];
    const existing = { messages: [{ sender: 'parent', text: 'hola', timestamp: '2026-07-02T09:00:00.000Z' }] };
    const sandbox = {
        window: {
            _cronosCurrentUser: { uid: 'parentUID', email: 'parent@mail.com' },
            _cronos_auth: { db: {} },
        },
        confirm: () => true,
        console: { log() {}, warn() {}, error() {} },
        showToast: () => {},
        ppOpenChatThread: () => {},
        __imp: async () => ({
            doc: (_db, col, id) => ({ col, id }),
            getDoc: async (ref) => ({ exists: () => true, data: () => existing }),
            updateDoc: async (ref, data) => { updates.push(data); },
            arrayUnion: (...vals) => ({ __arrayUnion: vals }),
        }),
    };
    sandbox.window._cronos_auth = { db: {} };
    vm.createContext(sandbox);
    const parentFnPatched = parentFn.replace(/\bimport\s*\(/g, '__imp(');
    vm.runInContext(parentFnPatched, sandbox, { filename: 'parent-panel.js' });
    await sandbox.window.ppDeleteAllMessages('thread2', 'Entrenador');

    ok('3a · updateDoc se llamó una vez', updates.length === 1);
    const payload = updates[0] || {};
    const logEntry = payload.deletedMessagesLog && payload.deletedMessagesLog.__arrayUnion
        ? payload.deletedMessagesLog.__arrayUnion[0] : null;
    ok('3b · deletedMessagesLog archiva el mensaje previo', !!logEntry && logEntry.messageCount === 1);
    ok('3c · deletedMessagesLog identifica al padre como autor del borrado',
       !!logEntry && logEntry.deletedBy === 'parentUID' && logEntry.deletedByRole === 'parent');
}

(async () => {
    await runCoach();
    await runParent();
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });

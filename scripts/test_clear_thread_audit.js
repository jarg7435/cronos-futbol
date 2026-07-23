// ─────────────────────────────────────────────────────────────────────────
// test_clear_thread_audit.js · Regresion: borrado de hilo sin auditoria
//
// El fix commiteado 417118b (coachDeleteAllMessages/ppDeleteAllMessages)
// archivaba el contenido de un hilo en deletedMessagesLog (arrayUnion) ANTES
// de vaciarlo -- borrado LOGICO, no destructivo, con deletedBy/deletedByEmail/
// deletedByRole/deletedAt/messageCount. La reescritura del sistema de
// mensajeria unificado (js/coach/comms/panel.js: _umState/_clearUnifiedThread)
// sustituyo esas dos funciones por una unica compartida entre los 4 roles,
// pero sin conservar la auditoria: sobrescribia messages:[] directamente.
//
// Este test verifica que _clearUnifiedThread (la funcion activa que reemplazo
// a coachDeleteAllMessages/ppDeleteAllMessages) SI archiva el contenido antes
// de vaciar, igual que el fix original.
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

console.log('── _clearUnifiedThread: borrado logico con auditoria ──\n');

const commsSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

function extractFn(src, name) {
    const start = src.indexOf('async function ' + name + '(');
    if (start === -1) return '';
    const braceStart = src.indexOf('{', start);
    let depth = 0, i = braceStart;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

const fnSrc = extractFn(commsSrc, '_clearUnifiedThread');

console.log('── PARTE 1 · estructura del código real ──');
ok('1a · _clearUnifiedThread existe', fnSrc.length > 0);
ok('1b · sigue pidiendo confirm() antes de vaciar', /if \(!confirm\(/.test(fnSrc));
ok('1c · [FIX] lee el hilo (getDoc) antes de vaciarlo, para poder archivarlo', /await getDoc\(docRef\)/.test(fnSrc));
ok('1d · [FIX] escribe deletedMessagesLog vía arrayUnion', /deletedMessagesLog:\s*arrayUnion\(/.test(fnSrc));
ok('1e · registra deletedBy/deletedByEmail/deletedByRole/deletedAt/messageCount',
   /deletedBy:/.test(fnSrc) && /deletedByEmail:/.test(fnSrc) && /deletedByRole:/.test(fnSrc) &&
   /deletedAt:/.test(fnSrc) && /messageCount:/.test(fnSrc));
ok('1f · el payload de vaciado se reutiliza también en el fallback setDoc (no solo en updateDoc)',
   /await setDoc\(docRef,[\s\S]{0,200}\.\.\.clearPayload/.test(fnSrc));

// ═══════════ PARTE 2 · ejecución real de la construcción del log ═══════════
console.log('\n── PARTE 2 · ejecución real (sandbox) ──');

// Extraemos solo la construcción de clearPayload (sin I/O de Firestore/DOM)
// para probarla de forma aislada con datos de entrada controlados.
const payloadMatch = fnSrc.match(/const clearPayload = \{[\s\S]*?\n\s{8}\};/);
ok('2a · se pudo extraer la construcción de clearPayload del código real', !!payloadMatch);

const sandbox = {
    arrayUnion: (x) => ({ __arrayUnion: x }),
    me: { uid: 'coach-uid-1', email: 'coach@example.com' },
    window: { _umState: { role: 'coach' } },
    prevMessages: [
        { senderUid: 'parent-uid-1', text: 'Hola entrenador', timestamp: '2026-07-20T10:00:00.000Z' },
        { senderUid: 'coach-uid-1',  text: 'Hola, dime',       timestamp: '2026-07-20T10:05:00.000Z' },
    ],
    Date: Date,
    clearPayload: undefined,
};
vm.createContext(sandbox);
vm.runInContext(payloadMatch[0].replace('const clearPayload', 'var clearPayload'), sandbox);

const logEntry = sandbox.clearPayload && sandbox.clearPayload.deletedMessagesLog && sandbox.clearPayload.deletedMessagesLog.__arrayUnion;
ok('2b · messages: [] (el hilo se vacía)', Array.isArray(sandbox.clearPayload.messages) && sandbox.clearPayload.messages.length === 0);
ok('2c · deletedMessagesLog archiva TODOS los mensajes previos (ninguno se pierde)',
   !!logEntry && Array.isArray(logEntry.messages) && logEntry.messages.length === 2 &&
   logEntry.messages[0].senderUid === 'parent-uid-1' && logEntry.messages[1].senderUid === 'coach-uid-1',
   JSON.stringify(logEntry && logEntry.messages));
ok('2d · archiva quién borró (uid/email) y con qué rol', !!logEntry &&
   logEntry.deletedBy === 'coach-uid-1' && logEntry.deletedByEmail === 'coach@example.com' && logEntry.deletedByRole === 'coach');
ok('2e · messageCount coincide con los mensajes archivados', !!logEntry && logEntry.messageCount === 2);
ok('2f · deletedAt es un timestamp ISO', !!logEntry && /^\d{4}-\d{2}-\d{2}T/.test(logEntry.deletedAt));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

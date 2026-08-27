// ─────────────────────────────────────────────────────────────────────────
// test_delete_all_messages_audit.js  ·  Auditoria 2026-07-22, hallazgo #6
//
// Vaciar un hilo de cronos_messages borra TAMBIEN los mensajes de la OTRA
// parte (p.ej. familia<->entrenador de un menor). Antes se hacia con un
// simple updateDoc({ messages: [] }): sin rastro de quien lo hizo ni cuando,
// sin posibilidad de recuperacion y con un confirm() de cliente como unica
// salvaguarda.
//
// Fix: antes de vaciar se archiva el contenido en `deletedMessagesLog`
// (arrayUnion) con quien/cuando/cuantos mensajes -> borrado LOGICO, no
// destructivo, con auditoria minima.
//
// ══════════════════════════════════════════════════════════════════════════
//  ⚠️ 2026-08-27 · ERAN DOS FUNCIONES; AHORA ES UNA
//
//  coachDeleteAllMessages (js/coach/comms/panel.js) y ppDeleteAllMessages
//  (js/parent/panel.js) ya no existen: con la mensajeria unificada, el
//  entrenador, el padre, el director y el coordinador vacian su hilo por la
//  MISMA funcion, _clearUnifiedThread (js/coach/comms/panel.js). Este test
//  seguia buscando las dos viejas y llevaba un anno en xfail como "test
//  muerto".
//
//  🔑 De los ocho xfail de mensajeria este era el UNICO cuyas funciones de
//     verdad habian desaparecido — pero su invariante estaba vivo y sin
//     vigilancia: `deletedMessagesLog` lo escribe hoy _clearUnifiedThread. Se
//     reapunta, no se borra.
//
//  ⚠️ Y hay una pieza NUEVA que aquellas dos no tenian y que si conviene
//     cubrir: si el updateDoc falla (documento con id heredado que no
//     existe), cae a un setDoc con merge — y ese camino tiene que archivar
//     igual, o el borrado volveria a ser destructivo justo en los hilos peor
//     formados, que son los mas viejos.
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── vaciar un hilo: auditoria + borrado logico ──\n');

const src = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

function extractFn(name) {
    const start = src.search(new RegExp('(?:async )?function ' + name + '\\('));
    if (start === -1) throw new Error('No se encontro ' + name);
    let depth = 0, started = false, end = start;
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        if (src[i] === '}') { depth--; if (started && depth === 0) { end = i; break; } }
    }
    return src.slice(start, end + 1);
}

// ═══════════════════ PARTE 1 · estructura del codigo real ══════════════════
console.log('── PARTE 1 · estructura ──');

const fn = extractFn('_clearUnifiedThread');

ok('1a · existe _clearUnifiedThread (la unica via de vaciado, para TODOS los roles)', fn.length > 0);
ok('1b · las dos funciones viejas ya no estan en ningun sitio',
   !/coachDeleteAllMessages|ppDeleteAllMessages/.test(src) &&
   !/coachDeleteAllMessages|ppDeleteAllMessages/.test(fs.readFileSync(path.join(ROOT, 'js', 'parent', 'panel.js'), 'utf8')),
   'si reaparecen, hay DOS implementaciones del mismo borrado y una se quedara atras');
ok('1c · [FIX] escribe deletedMessagesLog via arrayUnion', /deletedMessagesLog:\s*arrayUnion\(/.test(fn));
ok('1d · registra deletedBy/deletedByEmail/deletedByRole/deletedAt/messageCount',
   /deletedBy:/.test(fn) && /deletedByEmail:/.test(fn) && /deletedByRole:/.test(fn) &&
   /deletedAt:/.test(fn) && /messageCount:/.test(fn));
ok('1e · sigue pidiendo confirm() antes de vaciar', /confirm\(/.test(fn));
ok('1f · el archivado se arma UNA vez y lo comparten updateDoc y el setDoc de respaldo',
   /const clearPayload = \{/.test(fn) &&
   /updateDoc\(docRef, clearPayload\)/.test(fn) &&
   /\.\.\.clearPayload/.test(fn),
   'si el respaldo armara su propio payload, podria quedarse sin el archivado');

// ═══════════════════ PARTE 2 · ejecucion REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecucion del codigo real ──');

const PREVIOS = [
    { senderRole: 'coach',  text: 'hola',    timestamp: '2026-07-01T10:00:00.000Z' },
    { senderRole: 'parent', text: 'gracias', timestamp: '2026-07-01T10:05:00.000Z' },
];

function montar(role, me, updateFalla) {
    const escrituras = { update: [], set: [] };
    const sandbox = {
        confirm: () => true,
        console: { log() {}, warn() {}, error() {} },
        showToast: () => {},
        _selectUnifiedContact: async () => {},
        _resolveThreadDoc: async () => ({ id: 'hilo1' }),
        _cFS: async () => ({
            db: {},
            doc: (_db, col, id) => ({ col, id }),
            getDoc: async () => ({ exists: () => true, data: () => ({ messages: PREVIOS }) }),
            updateDoc: async (ref, data) => {
                if (updateFalla) throw new Error('No document to update');
                escrituras.update.push({ id: ref.id, data });
            },
            setDoc: async (ref, data) => { escrituras.set.push({ id: ref.id, data }); },
            arrayUnion: (...vals) => ({ __arrayUnion: vals }),
        }),
        window: {
            _cronosCurrentUser: me,
            _umState: { role, activeTab: 'parents', selectedContact: { uid: 'otroUID', name: 'La otra parte' } },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(fn + '\nthis.__vaciar = _clearUnifiedThread;', sandbox, { filename: 'panel-vaciado.js' });
    return { sandbox, escrituras };
}

function archivado(payload) {
    return payload && payload.deletedMessagesLog && payload.deletedMessagesLog.__arrayUnion
        ? payload.deletedMessagesLog.__arrayUnion[0] : null;
}

async function run() {
    // 2a-2e · El entrenador vacia el hilo (camino normal).
    {
        const me = { uid: 'coachUID', email: 'coach@club.com', clubId: 'clubX' };
        const { sandbox, escrituras } = montar('coach', me, false);
        await sandbox.__vaciar('hilo1');

        ok('2a · updateDoc se llamo una vez', escrituras.update.length === 1 && escrituras.set.length === 0);
        const payload = escrituras.update[0] ? escrituras.update[0].data : {};
        ok('2b · messages queda vacio en el hilo (limpieza de la vista)',
           Array.isArray(payload.messages) && payload.messages.length === 0);
        const log = archivado(payload);
        ok('2c · deletedMessagesLog archiva los 2 mensajes previos (borrado LOGICO, no destructivo)',
           !!log && Array.isArray(log.messages) && log.messages.length === 2, JSON.stringify(log));
        ok('2d · identifica al autor del borrado (uid + email + ROL desde el que borro)',
           !!log && log.deletedBy === 'coachUID' && log.deletedByEmail === 'coach@club.com' && log.deletedByRole === 'coach');
        ok('2e · messageCount coincide con lo archivado', !!log && log.messageCount === 2);
    }

    // 2f-2g · El padre vacia el MISMO hilo: misma funcion, mismo archivado.
    {
        const me = { uid: 'padreUID', email: 'padre@mail.com', clubId: 'clubX' };
        const { sandbox, escrituras } = montar('parent', me, false);
        await sandbox.__vaciar('hilo1');
        const log = archivado(escrituras.update[0] ? escrituras.update[0].data : {});
        ok('2f · el padre borra por la MISMA via (antes era ppDeleteAllMessages, una copia aparte)',
           escrituras.update.length === 1);
        ok('2g · y queda registrado como padre, no como entrenador',
           !!log && log.deletedBy === 'padreUID' && log.deletedByRole === 'parent');
    }

    // 2h-2i · 🔑 Si el updateDoc falla, el respaldo setDoc TIENE que archivar igual.
    {
        const me = { uid: 'coachUID', email: 'coach@club.com', clubId: 'clubX' };
        const { sandbox, escrituras } = montar('coach', me, true);
        await sandbox.__vaciar('hilo1');
        ok('2h · con updateDoc caido, el respaldo escribe igualmente', escrituras.set.length === 1);
        const d = escrituras.set[0] ? escrituras.set[0].data : {};
        const log = archivado(d);
        ok('2i · 🔑 y el respaldo NO se salta el archivado (si no, el borrado volveria a ser destructivo)',
           !!log && log.messageCount === 2 && Array.isArray(d.participants) && d.participants.includes('otroUID'),
           JSON.stringify(Object.keys(d)));
    }
}

run().then(() => {
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
}).catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });

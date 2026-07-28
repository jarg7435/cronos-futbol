// ─────────────────────────────────────────────────────────────────────────
// test_sdsendreplytocoach_creates_thread.js  ·  3ª ronda tras pruebas del
// usuario: "al escribir y enviar mensajes desde los paneles de dirección y
// coordinación, estos ni siquiera se reflejan ni llegan al destinatario"
//
// Causa: window.sdSendReplyToCoach (js/coach/reports/club-reports.js) solo
// hacía updateDoc() cuando el hilo YA existía (snap.exists() === true). Si
// el director/coordinador era quien escribía PRIMERO en una conversación
// (hilo sin documento todavía — muy probable justo tras el fix de IDs por
// rol, que genera IDs nuevos sin historial), la función no hacía NADA: ni
// guardaba el mensaje, ni mostraba error. Se perdía en silencio.
//
// Fix: rama `else` que crea el documento con setDoc, igual que ya hace
// sdSendBulkMsg, distinguiendo hilo con-entrenador (`_coach_` en el id) de
// hilo staff<->staff (`_peer_` en el id).
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

console.log('── sdSendReplyToCoach crea el hilo si no existía ──\n');

const src = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js'), 'utf8');

// ═══════════════════ PARTE 1 · estructura ══════════════════
console.log('── PARTE 1 · estructura ──');
const fnStart = src.indexOf('window.sdSendReplyToCoach = async');
ok('1a · existe sdSendReplyToCoach', fnStart !== -1);
const fnBody = src.slice(fnStart, src.indexOf('\n        };', fnStart) + 11);

ok('1b · [FIX] tiene rama else con setDoc (crea el hilo si no existe)',
   /\} else \{[\s\S]*?setDoc\(doc2\(db2,'cronos_messages',threadId\), baseDoc\)/.test(fnBody));
ok('1c · distingue hilo-con-entrenador (_coach_) de hilo staff<->staff (_peer_)',
   /threadId\.includes\('_coach_'\)/.test(fnBody));
ok('1d · el nuevo doc incluye participants con ambos uids', /participants: \[me\.uid, coachUid\]/.test(fnBody));

// ═══════════════════ PARTE 2 · ejecución REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecución del código real (hilo SIN documento previo) ──');

async function run() {
    const writes = { set: [], update: [] };
    const sandbox = {
        window: { _cronosCurrentUser: { uid: 'directorUID', email: 'dir@club.com', clubId: 'clubX', _activeRole: 'director', role: 'director' } },
        document: { getElementById: (id) => (id === 'staff-reply-input' ? { value: 'Hola entrenador' } : null) },
        console: { log(){}, warn(){}, error(){} },
        showToast: () => {},
        _loadThreadMessages: async () => {},
        _sdFS: async () => ({
            db: {},
            doc: (_db, col, id) => ({ col, id }),
            getDoc: async (ref) => ({ exists: () => false, data: () => null }), // hilo SIN documento previo
            setDoc: async (ref, data) => { writes.set.push({ id: ref.id, data }); },
            updateDoc: async (ref, data) => { writes.update.push({ id: ref.id, data }); },
            arrayUnion: (...v) => ({ __arrayUnion: v }),
        }),
    };
    vm.createContext(sandbox);
    vm.runInContext(fnBody.replace('window.sdSendReplyToCoach', 'var _f'), sandbox, { filename: 'sdSendReplyToCoach.js' });

    // 2a. Hilo CON entrenador (id contiene "_coach_").
    await sandbox._f('clubX_coach_coachUID_staff_directorUID_role_director', 'coachUID', 'coach@club.com');
    ok('2a · crea el documento (antes se perdía en silencio)', writes.set.length === 1, JSON.stringify(writes.set));
    if (writes.set[0]) {
        const d = writes.set[0].data;
        ok('2b · recipientType correcto para hilo con entrenador', d.recipientType === 'staff');
        ok('2c · el mensaje va dentro de messages[0]', Array.isArray(d.messages) && d.messages.length === 1 && d.messages[0].text === 'Hola entrenador');
        ok('2d · sender/senderUid correctos (rol real, no "parent")', d.messages[0].sender === 'director' && d.messages[0].senderUid === 'directorUID');
        ok('2e · participants incluye a ambos', d.participants.includes('directorUID') && d.participants.includes('coachUID'));
    }

    // 2f. Hilo PEER (staff<->staff, id contiene "_peer_").
    writes.set = [];
    await sandbox._f('clubX_peer_coordinatorUID_directorUID', 'coordinatorUID', 'coord@club.com');
    ok('2f · crea el documento peer también', writes.set.length === 1);
    if (writes.set[0]) {
        ok('2g · recipientType correcto para hilo peer', writes.set[0].data.recipientType === 'peer');
    }
}

run().then(() => {
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
}).catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });

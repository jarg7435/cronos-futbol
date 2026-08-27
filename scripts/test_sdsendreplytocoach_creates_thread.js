// ─────────────────────────────────────────────────────────────────────────
// test_sdsendreplytocoach_creates_thread.js  ·  3ª ronda tras pruebas del
// usuario: "al escribir y enviar mensajes desde los paneles de dirección y
// coordinación, estos ni siquiera se reflejan ni llegan al destinatario"
//
// Causa: la función de envío del staff sólo hacía updateDoc() cuando el hilo
// YA existía (snap.exists() === true). Si el director/coordinador era quien
// escribía PRIMERO en una conversación —hilo sin documento todavía—, la
// función no hacía NADA: ni guardaba el mensaje, ni mostraba error. El primer
// mensaje de cada conversación se perdía EN SILENCIO.
//
// ══════════════════════════════════════════════════════════════════════════
//  ⚠️ 2026-08-27 · LA FUNCIÓN CAMBIÓ DE NOMBRE Y DE SITIO; EL HUECO NO
//
//  window.sdSendReplyToCoach (js/coach/reports/club-reports.js) ya no existe:
//  la mensajería del staff se unificó en _sendUnifiedMessage
//  (js/coach/comms/panel.js), la MISMA función que usan entrenador, padre,
//  director y coordinador. Este test seguía buscando la vieja y llevaba un
//  año en xfail como "test muerto".
//
//  🔑 Pero el invariante que vigila —el PRIMER mensaje de una conversación no
//     puede perderse— sigue siendo exactamente el mismo, y NINGÚN otro test
//     lo ejercitaba: test_role_thread_canonical.js comprueba QUÉ hilo se
//     calcula, no que se CREE cuando no existe. Así que se reapunta aquí,
//     contra la función viva.
//
//  ⚠️ Lo que sí desapareció de verdad es la distinción _coach_ / _peer_ en el
//     id: hoy el contexto lo pone _getCanonicalContext y el documento se
//     etiqueta con coachUid / parentUid / staffUid según el rol de cada
//     parte, que es lo que leen las reglas de firestore.rules. Se comprueba
//     eso en su lugar.
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

console.log('── El primer mensaje de una conversación crea el hilo ──\n');

const src = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

function extractFn(name) {
    const start = src.search(new RegExp('(?:async )?function ' + name + '\\('));
    if (start === -1) throw new Error('No se encontró ' + name);
    let depth = 0, started = false, end = start;
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        if (src[i] === '}') { depth--; if (started && depth === 0) { end = i; break; } }
    }
    return src.slice(start, end + 1);
}

// ═══════════════════ PARTE 1 · estructura ══════════════════
console.log('── PARTE 1 · estructura ──');
const fnBody = extractFn('_sendUnifiedMessage');

ok('1a · existe _sendUnifiedMessage (la única vía de envío del staff)', fnBody.length > 0);
ok('1b · [FIX] tiene rama else con setDoc: crea el hilo si no existe',
   /if \(snap\.exists\(\)\) \{[\s\S]*?\} else \{[\s\S]*?setDoc\(doc\(db, 'cronos_messages', threadId\)/.test(fnBody),
   'sin esta rama, el primer mensaje de cada conversación se pierde en silencio');
ok('1c · el documento nuevo lleva participants con ambos uids',
   /participants: \[me\.uid, recipientUid\]/.test(fnBody));
ok('1d · y las tres etiquetas que leen las reglas (coachUid/parentUid/staffUid)',
   /coachUid:/.test(fnBody) && /parentUid:/.test(fnBody) && /staffUid:/.test(fnBody));

// ═══════════════════ PARTE 2 · ejecución REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecución del código real (hilo SIN documento previo) ──');

function montar(role, activeTab, existe) {
    const escrituras = { set: [], update: [] };
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        showToast: () => {},
        document: { getElementById: (id) => (id === 'um-msg-input' ? { value: 'Hola entrenador' } : null) },
        _loadUnifiedThreadMessages: async () => {},
        _loadUnifiedContactList: () => {},
        _cFS: async () => ({
            db: {},
            doc: (_db, col, id) => ({ col, id }),
            getDoc: async () => ({
                exists: () => existe,
                id: 'hilo-existente',
                data: () => ({ messages: [], unreadByCoach: 0, unreadByParent: 0, unreadByStaff: 0 }),
            }),
            setDoc: async (ref, data) => { escrituras.set.push({ id: ref.id, data }); },
            updateDoc: async (ref, data) => { escrituras.update.push({ id: ref.id, data }); },
            arrayUnion: (...v) => ({ __arrayUnion: v }),
        }),
        window: {
            _cronosCurrentUser: { uid: 'directorUID', email: 'dir@club.com', clubId: 'clubX', role: 'director' },
            _umState: { role, activeTab, selectedContact: null, contacts: [], checkedUids: new Set() },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(
        extractFn('_getCanonicalContext') + '\n' +
        extractFn('_cThreadId') + '\n' +
        fnBody + '\n' +
        'this.__enviar = _sendUnifiedMessage;',
        sandbox, { filename: 'panel-envio.js' });
    return { sandbox, escrituras };
}

async function run() {
    // 2a-2e · El DIRECTOR escribe el primero a un entrenador: no hay documento.
    {
        const { sandbox, escrituras } = montar('director', 'coaches', false);
        await sandbox.__enviar('coachUID');

        ok('2a · [HUECO CERRADO] crea el documento (antes se perdía en silencio)',
           escrituras.set.length === 1 && escrituras.update.length === 0,
           'set=' + escrituras.set.length + ' update=' + escrituras.update.length);

        const d = escrituras.set[0] ? escrituras.set[0].data : {};
        ok('2b · el mensaje va dentro de messages[0]',
           Array.isArray(d.messages) && d.messages.length === 1 && d.messages[0].text === 'Hola entrenador');
        ok('2c · senderRole/senderUid son los reales (rol activo, no "parent")',
           !!d.messages && d.messages[0].senderRole === 'director' && d.messages[0].senderUid === 'directorUID');
        ok('2d · participants incluye a ambos',
           Array.isArray(d.participants) && d.participants.includes('directorUID') && d.participants.includes('coachUID'));
        ok('2e · el director queda como staffUid y el entrenador como coachUid (lo que leen las reglas)',
           d.staffUid === 'directorUID' && d.coachUid === 'coachUID');
        ok('2f · el destinatario arranca con el mensaje SIN leer',
           d.unreadByCoach === 1 && d.unreadByStaff === 0);
    }

    // 2g-2h · Con el hilo YA creado se actualiza, no se sobrescribe.
    {
        const { sandbox, escrituras } = montar('director', 'coaches', true);
        await sandbox.__enviar('coachUID');
        ok('2g · si el hilo ya existe, se actualiza (no se pisa con setDoc)',
           escrituras.update.length === 1 && escrituras.set.length === 0);
        const d = escrituras.update[0] ? escrituras.update[0].data : {};
        ok('2h · y el mensaje se AÑADE con arrayUnion (no reemplaza el historial)',
           !!d.messages && !!d.messages.__arrayUnion && d.messages.__arrayUnion.length === 1);
    }

    // 2i · Mismo camino para el padre: es la misma función para todos los roles.
    {
        const { sandbox, escrituras } = montar('parent', 'coach', false);
        sandbox.window._cronosCurrentUser = { uid: 'padreUID', email: 'p@mail.com', clubId: 'clubX', role: 'parent' };
        await sandbox.__enviar('coachUID');
        const d = escrituras.set[0] ? escrituras.set[0].data : {};
        ok('2i · el padre también crea su hilo, y queda como parentUid',
           escrituras.set.length === 1 && d.parentUid === 'padreUID' && d.coachUid === 'coachUID');
    }
}

run().then(() => {
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
}).catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });

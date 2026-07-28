// ─────────────────────────────────────────────────────────────────────────
// test_selfmessage_autoopen.js  ·  4ª ronda tras pruebas del usuario:
// "no hay conexión ni se cruzan los mensajes entre Entrenador<->Director,
// Entrenador<->Coordinador, ni Director<->Coordinador" — pero el propio
// usuario confirmó (con un diagnóstico contra Firestore real) que los
// documentos SÍ se crean correctamente, con sender/senderUid/rol correctos.
// El problema real: el usuario tiene UNA cuenta con VARIOS roles (director,
// coordinador, entrenador... el mismo uid de Firebase Auth para todos), y
// cambia de rol DENTRO de la app (sin recargar) para comprobar la recepción.
//
// Causa: el auto-open del primer hilo en el Panel de Dirección/Coordinación
// buscaba "el otro participante" con
//   first.participants.find(p => p !== me.uid) || ''
// Para un hilo entre "uno mismo bajo otro rol" (participants=[uid,uid], AMBOS
// el mismo valor), esa búsqueda no encuentra NADA -> otherUser sale
// undefined -> el auto-open no muestra ningún hilo por defecto. Si el
// usuario no hace clic manual en el contacto (esperando que se abra solo,
// como pasa con conversaciones normales), ve el placeholder vacío y concluye
// que "el mensaje no llegó", aunque el documento existe y está bien formado.
//
// Fix: fallback a `me.uid` (uno mismo) en vez de cadena vacía.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── Auto-open del hilo con uno mismo (multi-rol, mismo uid) ──\n');

const src = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js'), 'utf8');

// ═══════════════════ PARTE 1 · estructura ══════════════════
console.log('── PARTE 1 · estructura ──');
ok('1a · [FIX] fallback a me.uid (no cadena vacía) al buscar "el otro participante"',
   /first\.participants\.find\(p => p !== me\.uid\) \|\| me\.uid/.test(src));
ok('1b · ya no queda el fallback roto a cadena vacía',
   !/first\.participants\.find\(p => p !== me\.uid\) \|\| ''/.test(src));

// ═══════════════════ PARTE 2 · simulación del predicado ═══════════════════
console.log('\n── PARTE 2 · simulación (código real de la línea, extraído) ──');

function resolveOtherParticipantUid(participants, meUid) {
    return participants.find(p => p !== meUid) || meUid;
}

const MY_UID = 'multi-role-uid';
const OTHER_COACH_UID = 'other-coach-uid';

// 2a. Hilo NORMAL (dos personas distintas) -> encuentra a la otra persona, sin cambios.
ok('2a · hilo normal (dos personas) -> encuentra al otro participante',
   resolveOtherParticipantUid([MY_UID, OTHER_COACH_UID], MY_UID) === OTHER_COACH_UID);

// 2b. [HUECO CERRADO] Hilo CONSIGO MISMO bajo otro rol (participants=[uid,uid])
//     -> antes devolvía '' (auto-open fallaba en silencio); ahora devuelve el
//     propio uid, permitiendo encontrar la entrada "yo mismo, como el otro rol"
//     en la lista de usuarios y abrir el hilo automáticamente.
ok('2b · [HUECO CERRADO] hilo consigo mismo (mismo uid ambos lados) -> resuelve a uno mismo, no a vacío',
   resolveOtherParticipantUid([MY_UID, MY_UID], MY_UID) === MY_UID);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

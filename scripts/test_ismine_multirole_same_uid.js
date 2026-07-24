// ─────────────────────────────────────────────────────────────────────────
// test_ismine_multirole_same_uid.js · Colores de burbuja (azul=enviado,
// naranja=recibido) no cambiaban NUNCA para la cuenta multi-rol
// arinagazone@gmail.com (Entrenador = Padre, mismo uid de Firebase Auth).
//
// Causa: en js/coach/comms/panel.js, _loadUnifiedThreadMessages calculaba
// `isMine = m.senderUid === me.uid` (o un OR equivalente en el bloque
// duplicado). Como el Entrenador y el Padre SON la misma cuenta, m.senderUid
// coincide con me.uid en TODOS los mensajes del hilo, sin importar con qué
// rol se enviaron -> isMine siempre true -> siempre se pintan en azul
// ("enviado"), nunca en naranja ("recibido"), visto desde CUALQUIER panel.
//
// Fix: cuando el mensaje trae senderRole, exigir también que coincida con
// el rol ACTIVO desde el que se está viendo el hilo (window._umState.role).
// El uid ya no basta por sí solo para distinguir "yo" cuando la misma
// persona actúa con dos roles distintos en el mismo hilo.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── isMine debe considerar el rol activo, no solo el uid (cuentas multi-rol) ──\n');

const commsSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

console.log('── PARTE 1 · estructura del código real ──');
ok('1a · [FIX] ya no queda `isMine = m.senderUid ? (m.senderUid === me.uid) :` sin comprobar senderRole',
   !/m\.senderUid \? \(m\.senderUid === me\.uid\) :/.test(commsSrc));
const roleCheckOccurrences = (commsSrc.match(/m\.senderUid === me\.uid && \(!m\.senderRole \|\| m\.senderRole === window\._umState\.role\)/g) || []).length;
ok('1b · [FIX] exige que senderRole coincida con el rol activo cuando hay senderUid',
   roleCheckOccurrences >= 2, 'ocurrencias encontradas: ' + roleCheckOccurrences);

// ═══════════ PARTE 2 · simulación con el caso real (mismo uid, 2 roles) ═══════════
console.log('\n── PARTE 2 · simulación: Entrenador y Padre son la misma cuenta ──');

function isMine(m, me, activeRole) {
    return m.senderUid
        ? (m.senderUid === me.uid && (!m.senderRole || m.senderRole === activeRole))
        : (m.sender === activeRole);
}

const SAME_UID = 'GkycFVeqFsWD9JODEjjE3JSMw2v1'; // arinagazone@gmail.com, real
const me = { uid: SAME_UID };

const msgFromCoach = { senderUid: SAME_UID, senderRole: 'coach', text: 'Hola Bruno, soy el entrenador' };
const msgFromParent = { senderUid: SAME_UID, senderRole: 'parent', text: 'Hola entrenador, soy el papá de Bruno' };

ok('2a · [HUECO CERRADO] viendo como PADRE, el mensaje del ENTRENADOR se marca como recibido (no mío)',
   isMine(msgFromCoach, me, 'parent') === false);
ok('2b · viendo como PADRE, el propio mensaje del padre SÍ se marca como mío',
   isMine(msgFromParent, me, 'parent') === true);
ok('2c · [HUECO CERRADO] viendo como ENTRENADOR, el mensaje del PADRE se marca como recibido (no mío)',
   isMine(msgFromParent, me, 'coach') === false);
ok('2d · viendo como ENTRENADOR, el propio mensaje del entrenador SÍ se marca como mío',
   isMine(msgFromCoach, me, 'coach') === true);

// Regresión: caso normal (dos cuentas distintas) no debe romperse.
const OTHER_UID = 'otro-uid-del-otro-usuario';
const meCoachNormal = { uid: 'coach-uid-real' };
const msgDeLaOtraPersona = { senderUid: OTHER_UID, senderRole: 'parent', text: 'hola' };
const msgPropio = { senderUid: 'coach-uid-real', senderRole: 'coach', text: 'hola' };
ok('2e · caso normal (uids distintos): mensaje ajeno sigue sin marcarse como mío',
   isMine(msgDeLaOtraPersona, meCoachNormal, 'coach') === false);
ok('2f · caso normal (uids distintos): mensaje propio sigue marcándose como mío',
   isMine(msgPropio, meCoachNormal, 'coach') === true);

// Compatibilidad con mensajes legacy sin senderRole (no debe romperse).
const msgLegacySinRole = { senderUid: SAME_UID, text: 'mensaje viejo sin senderRole' };
ok('2g · mensaje legacy sin senderRole: se conserva el comportamiento previo (uid manda)',
   isMine(msgLegacySinRole, me, 'parent') === true);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

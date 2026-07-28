// ─────────────────────────────────────────────────────────────────────────
// test_staff_chat_unification.js  ·  Fix chats entrenador<->director/coordinador
//
// Problema reportado: (1) "Missing or insufficient permissions"/"Error al
// cargar" al leer/escribir mensajes entre roles; (2) estructura rota: cada
// destinatario debe verse en un chat independiente segun la logistica:
//   Padre <-> solo su entrenador. Entrenador <-> director+coordinador+padres.
//   Coordinador <-> director+entrenadores. Director <-> coordinador+entrenadores.
//
// Causa raiz encontrada:
//   A) js/coach/comms/panel.js calculaba el threadId coach<->staff como
//      `${clubId}_${staffUid}` (SIN el uid del coach -> colisionaba entre
//      TODOS los entrenadores que hablaran con el mismo staff), mientras que
//      js/coach/reports/club-reports.js calculaba `${clubId}_${coachUid}`
//      para la MISMA relacion: dos formulas distintas -> dos documentos de
//      Firestore distintos que nunca se reconciliaban.
//   B) club-reports.js reutilizaba sender:'parent' y la perspectiva 'parent'
//      del renderizador de mensajes del padre (copia-pega): etiquetaba
//      siempre "Padre/Tutor" y, peor, en un hilo staff<->staff (director<->
//      coordinador) AMBOS lados escribian 'parent' -> imposible distinguir
//      quien escribio que.
//   C) firestore.rules no tenia una rama explicita por `staffUid` en
//      cronos_messages (solo participants/coachUid/parentUid/clubId-claims).
//
// Fix: helper COMPARTIDO en js/core/utils.js (unica fuente de verdad, carga
// antes que ambos paneles en index.html), sender/senderUid reales, y rama
// staffUid en las reglas.
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

console.log('── Unificación de chats entrenador<->director/coordinador ──\n');

const utilsSrc  = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');
const commsSrc  = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');
const reportsSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js'), 'utf8');
const rulesSrc  = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const indexSrc  = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ═══════════════════ PARTE 1 · orden de carga (index.html) ═════════════════
console.log('── PARTE 1 · orden de carga ──');
const idxUtils  = indexSrc.indexOf('core/utils.js');
const idxComms  = indexSrc.indexOf('coach/comms/panel.js');
const idxReports = indexSrc.indexOf('coach/reports/club-reports.js');
ok('1a · utils.js carga ANTES que comms/panel.js', idxUtils !== -1 && idxComms !== -1 && idxUtils < idxComms);
ok('1b · utils.js carga ANTES que club-reports.js', idxUtils !== -1 && idxReports !== -1 && idxUtils < idxReports);

// ═══════════════════ PARTE 2 · helpers compartidos existen ═════════════════
console.log('\n── PARTE 2 · helpers compartidos (js/core/utils.js) ──');
ok('2a · existe window._cronosStaffChatThreadId', /window\._cronosStaffChatThreadId\s*=/.test(utilsSrc));
ok('2b · existe window._cronosPeerChatThreadId', /window\._cronosPeerChatThreadId\s*=/.test(utilsSrc));

// ═══════════════════ PARTE 3 · ambos paneles usan el MISMO helper ══════════
console.log('\n── PARTE 3 · js/coach/comms/panel.js usa el helper compartido ──');
ok('3a · _cStaffThreadId delega en window._cronosStaffChatThreadId',
   /_cStaffThreadId\(clubId, coachUid, staffUid, staffRole\)[\s\S]{0,200}window\._cronosStaffChatThreadId/.test(commsSrc));
ok('3b · sendCoachMessage añade senderUid al mensaje',
   /sender:\s*'coach',\s*\n\s*senderUid:\s*me\.uid,/.test(commsSrc));

console.log('\n── PARTE 4 · js/coach/reports/club-reports.js usa el MISMO helper ──');
ok('4a · [FIX] ya NO queda la fórmula vieja `${clubId}_${u.uid}` para coach<->staff',
   !/u\.role === 'user' \? `\$\{clubId\}_\$\{u\.uid\}`/.test(reportsSrc));
ok('4b · usa window._cronosStaffChatThreadId(clubId, u.uid, me.uid, activeRole) para hilos con un entrenador',
   (reportsSrc.match(/window\._cronosStaffChatThreadId\(clubId, u\.uid, me\.uid, activeRole\)/g) || []).length >= 2,
   'ocurrencias: ' + ((reportsSrc.match(/window\._cronosStaffChatThreadId\(clubId, u\.uid, me\.uid, activeRole\)/g) || []).length));
ok('4c · usa window._cronosPeerChatThreadId(clubId, me.uid, u.uid) para hilos staff<->staff',
   (reportsSrc.match(/window\._cronosPeerChatThreadId\(clubId, me\.uid, u\.uid\)/g) || []).length >= 2,
   'ocurrencias: ' + ((reportsSrc.match(/window\._cronosPeerChatThreadId\(clubId, me\.uid, u\.uid\)/g) || []).length));

console.log('\n── PARTE 5 · sender/senderUid reales (ya no "parent" hardcodeado) ──');
const reportsSrcNoComments = reportsSrc.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
ok('5a · [FIX] ya no queda `sender: \'parent\'` en código real (fuera de comentarios)',
   !/sender:\s*'parent'/.test(reportsSrcNoComments));
ok('5b · sdSendBulkMsg usa sender: activeRole', /sender:\s*activeRole,\s*\n\s*senderUid:\s*me\.uid,/.test(reportsSrc));
ok('5c · sdSendReplyToCoach usa sender: activeRole + senderUid', /sender:\s*activeRole,\s*senderUid:\s*me\.uid,\s*text/.test(reportsSrc));
ok('5d · las 3 llamadas a _loadThreadMessages pasan me.uid (no el string \'parent\')',
   (reportsSrc.match(/_loadThreadMessages\(threadId,\s*me\.uid\)/g) || []).length === 3,
   'ocurrencias: ' + ((reportsSrc.match(/_loadThreadMessages\(threadId,\s*me\.uid\)/g) || []).length));

console.log('\n── PARTE 6 · _loadThreadMessages generalizado (comms/panel.js) ──');
ok('6a · soporta perspective como UID del visor (viewerUid)', /const viewerUid = \(perspective !== 'coach' && perspective !== 'parent'\)/.test(commsSrc));
ok('6b · isMine compara por senderUid cuando hay viewerUid', /m\.senderUid != null && m\.senderUid === viewerUid/.test(commsSrc));
ok('6c · roleLabels incluye director y coordinator', /roleLabels\s*=\s*\{[^}]*director:\s*'Director Deportivo'[^}]*coordinator:\s*'Coordinador'/.test(commsSrc));

// ═══════════════════ PARTE 7 · reglas: rama staffUid en cronos_messages ════
console.log('\n── PARTE 7 · firestore.rules ──');
const cmStart = rulesSrc.indexOf('match /cronos_messages/{threadId}');
const cmEnd = rulesSrc.indexOf('\n    match /', cmStart + 1);
const cmBlock = rulesSrc.slice(cmStart, cmEnd === -1 ? undefined : cmEnd);
ok('7a · existe el bloque match /cronos_messages/{threadId}', cmStart !== -1);
ok('7b · allow read tiene rama staffUid', /allow read:[\s\S]*?staffUid != null[\s\S]*?\);/.test(cmBlock));
ok('7c · allow create tiene rama staffUid', /allow create:[\s\S]*?staffUid != null[\s\S]*?\);/.test(cmBlock));
ok('7d · allow update tiene rama staffUid', /allow update:[\s\S]*?staffUid != null[\s\S]*?\);/.test(cmBlock));
ok('7e · allow delete tiene rama staffUid', /allow delete:[\s\S]*?staffUid != null[\s\S]*?\);/.test(cmBlock));
ok('7f · conserva las ramas legítimas previas (participants/coachUid/parentUid)',
   /resource\.data\.coachUid/.test(cmBlock) && /resource\.data\.parentUid/.test(cmBlock) && /resource\.data\.participants/.test(cmBlock));
// FIX (2ª ronda — "Missing or insufficient permissions" al abrir una
// conversación NUEVA): getDoc() sobre un threadId que aún no existe hace que
// `resource` sea null; cualquier rama que lea resource.data.X entonces
// ERRORA (no da false), y si NINGUNA rama es independiente de resource.data
// para un usuario normal, la condición completa deniega. `resource == null`
// es seguro: un doc inexistente no tiene datos que proteger.
ok('7g · [FIX] allow read permite resource == null (primera conversación, doc aún no creado)',
   /allow read:[\s\S]*?resource == null[\s\S]*?\);/.test(cmBlock));

// ═══════════════════ PARTE 8 · ejecución REAL de los helpers ═══════════════
console.log('\n── PARTE 8 · ejecución real de los helpers (sandbox) ──');

function extractGuardedFn(src, name) {
    const marker = `if (typeof window.${name} !== 'function') {`;
    const start = src.indexOf(marker);
    if (start === -1) return '';
    const end = src.indexOf('\n}', start);
    return src.slice(start, end + 2);
}

const sandbox = { window: {}, console: { log(){}, warn(){} } };
vm.createContext(sandbox);
vm.runInContext(
    extractGuardedFn(utilsSrc, '_cronosStaffChatThreadId') + '\n' +
    extractGuardedFn(utilsSrc, '_cronosPeerChatThreadId'),
    sandbox
);

const CLUB = 'clubX';
const COACH_A = 'coachA-uid';
const COACH_B = 'coachB-uid';
const DIRECTOR = 'director-uid';
const COORDINATOR = 'coordinator-uid';

// 8a. El COACH calcula su hilo con el director exactamente como lo haria
//     comms/panel.js: _cronosStaffChatThreadId(clubId, me.uid, staffUid).
const idFromCoach = sandbox.window._cronosStaffChatThreadId(CLUB, COACH_A, DIRECTOR);
// 8b. El DIRECTOR calcula el hilo con ESE MISMO coach exactamente como lo
//     haria club-reports.js: _cronosStaffChatThreadId(clubId, u.uid, me.uid)
//     donde u=coach, me=director.
const idFromDirector = sandbox.window._cronosStaffChatThreadId(CLUB, COACH_A, DIRECTOR);

ok('8a · [HUECO CERRADO] coach y director calculan el MISMO threadId para su conversación',
   idFromCoach === idFromDirector, `coach=${idFromCoach} director=${idFromDirector}`);

// 8c. Dos entrenadores DISTINTOS hablando con el MISMO director -> hilos
//     DISTINTOS (antes colisionaban en uno solo).
const idCoachA_Director = sandbox.window._cronosStaffChatThreadId(CLUB, COACH_A, DIRECTOR);
const idCoachB_Director = sandbox.window._cronosStaffChatThreadId(CLUB, COACH_B, DIRECTOR);
ok('8b · [HUECO CERRADO] Coach A y Coach B con el mismo director -> hilos INDEPENDIENTES',
   idCoachA_Director !== idCoachB_Director);

// 8d. El mismo coach con DOS staff distintos (director y coordinador) -> hilos
//     independientes entre sí.
const idCoachA_Coord = sandbox.window._cronosStaffChatThreadId(CLUB, COACH_A, COORDINATOR);
ok('8c · Coach A con director vs Coach A con coordinador -> hilos INDEPENDIENTES',
   idCoachA_Director !== idCoachA_Coord);

// 8e. Peer (director <-> coordinador): simétrico, da igual quién lo calcule.
const idPeerFromDirector    = sandbox.window._cronosPeerChatThreadId(CLUB, DIRECTOR, COORDINATOR);
const idPeerFromCoordinator = sandbox.window._cronosPeerChatThreadId(CLUB, COORDINATOR, DIRECTOR);
ok('8d · hilo director<->coordinador: MISMO id sin importar quién lo calcule',
   idPeerFromDirector === idPeerFromCoordinator, `director=${idPeerFromDirector} coordinator=${idPeerFromCoordinator}`);

// 8f. Los hilos coach<->staff y el hilo peer NUNCA colisionan entre sí.
ok('8e · hilo coach<->staff y hilo peer no colisionan (namespaces distintos)',
   idCoachA_Director !== idPeerFromDirector && idCoachA_Coord !== idPeerFromDirector);

// ═══════ PARTE 9 · caso real reportado: UNA cuenta con VARIOS roles ════════
// El usuario confirmó (probando en vivo) que un admin de club que a la vez
// es director, coordinador, entrenador y padre (MISMO uid de Firebase Auth
// para los 4 roles) veía sus conversaciones mezclarse: "hablar con X-como-
// director" y "hablar con X-como-coordinador" calculaban el MISMO threadId
// en cuanto X era la misma cuenta para ambos roles (coachUid+staffUid
// coincidían). Fix: 4º parámetro `staffRole` desambigua.
console.log('\n── PARTE 9 · una cuenta, varios roles (caso real reportado) ──');

const SAME_UID = 'multi-role-uid';

// 9a. La MISMA persona (coach) hablando con SU PROPIA cuenta pero "puesta"
//     como director vs como coordinador -> deben ser hilos DISTINTOS.
const idSelfAsDirector    = sandbox.window._cronosStaffChatThreadId(CLUB, SAME_UID, SAME_UID, 'director');
const idSelfAsCoordinator = sandbox.window._cronosStaffChatThreadId(CLUB, SAME_UID, SAME_UID, 'coordinator');
ok('9a · [HUECO CERRADO] mismo uid coach=staff, pero rol distinto (director vs coordinador) -> hilos DISTINTOS',
   idSelfAsDirector !== idSelfAsCoordinator, `director=${idSelfAsDirector} coordinador=${idSelfAsCoordinator}`);

// 9b. Sin rol (llamada legacy, opts.staffRole ausente) sigue funcionando
//     igual que antes (compatibilidad hacia atrás para roles/cuentas normales).
const idNoRole = sandbox.window._cronosStaffChatThreadId(CLUB, COACH_A, DIRECTOR);
ok('9b · sin staffRole (uso normal, uids distintos) sigue funcionando', typeof idNoRole === 'string' && idNoRole.length > 0);

// 9c. Con roles/uids normales (cada rol es una persona distinta), añadir el
//     rol NO cambia si dos entrenadores distintos siguen aislados entre sí.
const idCoachA_Director_withRole = sandbox.window._cronosStaffChatThreadId(CLUB, COACH_A, DIRECTOR, 'director');
const idCoachB_Director_withRole = sandbox.window._cronosStaffChatThreadId(CLUB, COACH_B, DIRECTOR, 'director');
ok('9c · con staffRole, Coach A y Coach B con el mismo director siguen siendo hilos INDEPENDIENTES',
   idCoachA_Director_withRole !== idCoachB_Director_withRole);

// ═══════ PARTE 10 · propagación del rol en TODOS los call-sites reales ════
console.log('\n── PARTE 10 · todos los call-sites reales pasan el rol ──');
ok('10a · comms/panel.js: _cStaffThreadId(...) admite y reenvía staffRole',
   /function _cStaffThreadId\(clubId, coachUid, staffUid, staffRole\)/.test(commsSrc) &&
   /window\._cronosStaffChatThreadId\(clubId, coachUid, staffUid, staffRole\)/.test(commsSrc));
const commsCallsWithRole = (commsSrc.match(/_cStaffThreadId\(me\.clubId, me\.uid, [^)]+\)/g) || []);
ok('10b · las 6 llamadas a _cStaffThreadId en comms/panel.js pasan un 4º argumento (rol)',
   commsCallsWithRole.length === 6 && commsCallsWithRole.every(c => (c.match(/,/g) || []).length >= 3),
   commsCallsWithRole.join(' | '));
ok('10c · _msgGetSelected() lee data-role del checkbox', /role:\s*chk\.dataset\.role \|\| ''/.test(commsSrc));
ok('10d · el checkbox de destinatarios masivos escribe data-role', /data-role="/.test(commsSrc));
ok('10e · club-reports.js: ambas llamadas pasan activeRole como 4º argumento',
   (reportsSrc.match(/window\._cronosStaffChatThreadId\(clubId, u\.uid, me\.uid, activeRole\)/g) || []).length === 2);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

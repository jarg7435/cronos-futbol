// ─────────────────────────────────────────────────────────────────────────
// test_role_thread_canonical.js · Fix "los mensajes entre roles no llegan"
//
// Causa raíz (mensajes.txt, caso real arinagazone@gmail.com — 4 roles con el
// mismo uid en el club CD DÍA): _selectUnifiedContact / _loadUnifiedThreadMessages
// / _sendUnifiedMessage / _openUnifiedBulkComposer (js/coach/comms/panel.js)
// calculaban el threadId con la pestaña CRUDA del que mira (window._umState.activeTab),
// no con el contexto canónico (_getCanonicalContext). La misma relación se ve
// desde pestañas con nombres distintos según el rol (p.ej. el entrenador ve
// "director", el propio director ve "coaches" para hablar con entrenadores),
// así que cada lado escribía/leía un documento de Firestore DISTINTO para la
// MISMA conversación -> los mensajes se repartían entre 2-3 hilos y cada parte
// veía solo una porción (o ninguna).
//
// Fix: los 4 puntos activos ahora calculan el tabContext con
// _getCanonicalContext(role, tab) antes de pasarlo a _cThreadId.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── threadId canónico entre roles (comms/panel.js) ──\n');

const commsSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start === -1) return '';
    const braceStart = src.indexOf('{', start);
    let depth = 0, i = braceStart;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

// ═══════════ PARTE 1 · los 4 call-sites activos usan _getCanonicalContext ═══
console.log('── PARTE 1 · call-sites activos canonicalizan el tabContext ──');
ok('1a · _loadUnifiedContactList (preview de lista) canonicaliza',
   /_cThreadId\(me\.uid, c\.uid, _getCanonicalContext\(window\._umState\.role, tabId\)\)/.test(commsSrc));
ok('1b · _selectUnifiedContact (abrir hilo) canonicaliza',
   /_cThreadId\(me\.uid, contact\.uid, _getCanonicalContext\(window\._umState\.role, window\._umState\.activeTab\)\)/.test(commsSrc));
ok('1c · _sendUnifiedMessage canonicaliza antes de construir threadId',
   /const tabContext = _getCanonicalContext\(window\._umState\.role, window\._umState\.activeTab\);\s*\n\s*const threadId = _cThreadId\(me\.uid, recipientUid, tabContext\);/.test(commsSrc));
const bulkMatches = (commsSrc.match(/const tabContext = _getCanonicalContext\(window\._umState\.role, window\._umState\.activeTab\);/g) || []);
ok('1d · _sendUnifiedMessage Y _openUnifiedBulkComposer canonicalizan (2 ocurrencias)',
   bulkMatches.length === 2, 'ocurrencias: ' + bulkMatches.length);

// ═══════════ PARTE 2 · ejecución real de los helpers extraídos ═════════════
console.log('\n── PARTE 2 · ejecución real (sandbox) ──');
const code = extractFn(commsSrc, '_getCanonicalContext') + '\n' + extractFn(commsSrc, '_cThreadId');
ok('2a · ambas funciones se extrajeron del archivo real', code.includes('_getCanonicalContext') && code.includes('_cThreadId'));

// eslint-disable-next-line no-eval
eval(code);

// 2b. Entrenador C habla con Director U: cada lado mira una pestaña con
//     nombre distinto ('director' en el panel del coach, 'coaches' en el
//     panel del director) pero para la MISMA relación -> mismo id.
const coachSide = _cThreadId('C', 'U', _getCanonicalContext('coach', 'director'));
const directorSide = _cThreadId('U', 'C', _getCanonicalContext('director', 'coaches'));
ok('2b · [HUECO CERRADO] coach<->director: mismo threadId visto desde ambos lados',
   coachSide === directorSide, `coach=${coachSide} director=${directorSide}`);

// 2c. Entrenador C con Coordinador U: idem.
const coordFromCoach = _cThreadId('C', 'U', _getCanonicalContext('coach', 'coordinator'));
const coordFromCoord = _cThreadId('U', 'C', _getCanonicalContext('coordinator', 'coaches'));
ok('2c · [HUECO CERRADO] coach<->coordinador: mismo threadId visto desde ambos lados',
   coordFromCoach === coordFromCoord, `coach=${coordFromCoach} coordinador=${coordFromCoord}`);

// 2d. Director U con Coordinador U2: relación simétrica staff<->staff.
const peerFromDirector = _cThreadId('U', 'U2', _getCanonicalContext('director', 'coordinators'));
const peerFromCoordinator = _cThreadId('U2', 'U', _getCanonicalContext('coordinator', 'director'));
ok('2d · [HUECO CERRADO] director<->coordinador: mismo threadId visto desde ambos lados',
   peerFromDirector === peerFromCoordinator, `director=${peerFromDirector} coordinador=${peerFromCoordinator}`);

// 2e. Padre P con su entrenador C.
const parentSide = _cThreadId('P', 'C', _getCanonicalContext('parent', 'coach'));
const coachParentSide = _cThreadId('C', 'P', _getCanonicalContext('coach', 'parents'));
ok('2e · [HUECO CERRADO] padre<->entrenador: mismo threadId visto desde ambos lados',
   parentSide === coachParentSide, `padre=${parentSide} entrenador=${coachParentSide}`);

// 2f. Caso real reportado: UNA cuenta (mismo uid U) actuando de director Y de
//     coordinador con el MISMO entrenador C -> deben seguir siendo hilos
//     DISTINTOS (el contexto canónico codifica la relación, no solo el par de uids).
ok('2f · multi-rol (mismo uid director+coordinador): coach<->director != coach<->coordinador',
   coachSide !== coordFromCoach, `director=${coachSide} coordinador=${coordFromCoach}`);

// 2g. Dos entrenadores distintos hablando con el mismo director -> hilos independientes.
const coachB_side = _cThreadId('B', 'U', _getCanonicalContext('coach', 'director'));
ok('2g · Coach A y Coach B con el mismo director -> hilos independientes',
   coachSide !== coachB_side);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

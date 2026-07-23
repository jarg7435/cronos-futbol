// ─────────────────────────────────────────────────────────────────────────
// test_secondary_doc_exclusion.js · Bug real de producción: mensaje de un
// Padre a "su Entrenador" se desviaba (caso reportado en mensajes.txt,
// cuenta arinagazone@gmail.com con 4 roles en el mismo club).
//
// Causa raíz: js/services/auth.js, al añadir un rol adicional a una cuenta,
// escribe DOS documentos en 'users':
//   1. El documento PRIMARIO (id === uid real), con allRoles/category/
//      subcategory reales — la fuente de verdad.
//   2. Un documento "secundario" (id === `${uid}_${role}_${clubId}`, para
//      queries del club admin) SIN category/subcategory/allRoles, pero
//      con el campo uid apuntando al mismo uid real.
//
// js/coach/comms/panel.js (_loadUnifiedContactList) consultaba TODOS los
// docs de 'users' por clubId y los metía en clubUsers sin distinguir
// primario de secundario. El secundario con role:'user' pasaba el filtro
// isCoach, pero con category/subcategory VACÍOS. _catAndSubcatMatch trata
// una categoría vacía como comodín (no descarta), así que ese documento
// aparecía como "el entrenador" de CUALQUIER padre del club, sin importar
// su categoría/subcategoría real -> el mensaje podía enrutarse/mostrarse
// donde no correspondía.
//
// Fix: excluir de clubUsers cualquier doc cuyo `data.uid` no coincida con
// su propio id de documento (eso identifica un documento secundario).
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── Exclusión de documentos "secundarios" en clubUsers ──\n');

const commsSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');
const authSrc  = fs.readFileSync(path.join(ROOT, 'js', 'services', 'auth.js'), 'utf8');

console.log('── PARTE 1 · estructura del código real ──');
const guardOccurrences = (commsSrc.match(/if \(data\.uid && data\.uid !== d\.id\) return;/g) || []);
ok('1a · [FIX] clubUsers excluye documentos secundarios (uid !== id del doc)', guardOccurrences.length >= 1,
   'ocurrencias: ' + guardOccurrences.length);
ok('1b · confirmado en auth.js: los documentos secundarios usan un id compuesto uid_role_club',
   /const secondaryId = cred\.user\.uid \+ '_' \+ requestedRole \+ '_' \+/.test(authSrc));
ok('1c · [FIX] ya no queda ninguna llamada _loadUnifiedContactList(tabContext) (contexto canónico, no la pestaña real)',
   !/_loadUnifiedContactList\(tabContext\)/.test(commsSrc));

// ═══════════ PARTE 2 · ejecución real de la lógica de filtrado ═════════════
console.log('\n── PARTE 2 · simulación con datos reales del caso reportado ──');

// Simulamos exactamente el forEach real: documento primario + documento
// secundario del mismo uid, tal como los devolvería la query por clubId.
const docs = [
    // Documento PRIMARIO de arinagazone: id === su propio uid.
    { id: 'arinagazone-uid', data: () => ({
        uid: 'arinagazone-uid', email: 'arinagazone@gmail.com', clubId: 'club-cddia',
        role: 'director',
        allRoles: [
            { role: 'director' },
            { role: 'coordinator', coordinatorType: 'f711' },
            { role: 'user', category: 'alevin', subcategory: 'C' },
            { role: 'parent', category: 'alevin', subcategory: 'C' },
        ],
    }) },
    // Documento SECUNDARIO creado al añadir el rol 'user' (entrenador):
    // id compuesto, SIN category/subcategory/allRoles.
    { id: 'arinagazone-uid_user_club-cddia', data: () => ({
        uid: 'arinagazone-uid', email: 'arinagazone@gmail.com', clubId: 'club-cddia',
        role: 'user', status: 'active', isAuthorized: true,
    }) },
    // Otro entrenador normal del club, de una categoría DISTINTA (Juvenil B),
    // con su propio documento primario único.
    { id: 'otro-coach-uid', data: () => ({
        uid: 'otro-coach-uid', email: 'otro@club.com', clubId: 'club-cddia',
        role: 'user', category: 'juvenil', subcategory: 'B',
    }) },
];

function buildClubUsers(docs) {
    const clubUsers = [];
    docs.forEach(d => {
        const data = d.data();
        if (data.uid && data.uid !== d.id) return; // FIX real (misma condición que panel.js)
        clubUsers.push({ uid: d.id, ...data });
    });
    return clubUsers;
}

const clubUsers = buildClubUsers(docs);
ok('2a · el documento secundario NO entra en clubUsers', !clubUsers.some(u => u.uid === 'arinagazone-uid' && !u.allRoles));
ok('2b · el documento primario SÍ entra en clubUsers (con allRoles completo)',
   clubUsers.some(u => u.uid === 'arinagazone-uid' && Array.isArray(u.allRoles) && u.allRoles.length === 4));
ok('2c · el otro entrenador (documento único, primario) entra normalmente', clubUsers.some(u => u.uid === 'otro-coach-uid'));
ok('2d · exactamente 2 filas en clubUsers (no 3) — el secundario no duplica ni contamina', clubUsers.length === 2,
   'clubUsers: ' + clubUsers.map(u => u.uid).join(', '));

// ═══════ PARTE 3 · sin el fix, el secundario "ganaría" por comodín de categoría ═══
console.log('\n── PARTE 3 · contraste: qué pasaría SIN el fix (regresión reproducida) ──');

function _normCat(c) {
    if (!c) return '';
    return String(c).toLowerCase().trim();
}
function _catAndSubcatMatch(coachCat, coachSub, targetCat, targetSub) {
    const cc = _normCat(coachCat), tc = _normCat(targetCat);
    if (cc && tc && cc !== tc) return false;
    const cs = String(coachSub || '').toUpperCase(), ts = String(targetSub || '').toUpperCase();
    if (cs && ts && cs !== ts) return false;
    return true;
}

// Un padre de Juvenil B (categoría de "otro-coach-uid", NADA que ver con
// arinagazone) construyendo su lista SIN el fix (clubUsers sin filtrar,
// conservamos _docId solo para poder identificar la fila en el test).
const clubUsersWithoutFix = docs.map(d => ({ _docId: d.id, uid: d.id, ...d.data() }));
const parentCat = 'juvenil', parentSub = 'B';

const matchesWithoutFix = clubUsersWithoutFix.filter(u => {
    const isCoach = u.role === 'user' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r.role === 'user'));
    if (!isCoach) return false;
    const coachCat = u.category || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user') || {}).category : '');
    const coachSub = u.subcategory || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user') || {}).subcategory : '');
    return _catAndSubcatMatch(parentCat, parentSub, coachCat, coachSub);
});
ok('3a · [HUECO SIN EL FIX] el documento secundario (categoría vacía) coincide como comodín con un padre de OTRA categoría',
   matchesWithoutFix.some(u => u._docId === 'arinagazone-uid_user_club-cddia'),
   'coincidencias sin fix: ' + matchesWithoutFix.map(u => u._docId).join(', '));

const matchesWithFix = clubUsers.filter(u => {
    const isCoach = u.role === 'user' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r.role === 'user'));
    if (!isCoach) return false;
    const coachCat = u.category || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user') || {}).category : '');
    const coachSub = u.subcategory || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user') || {}).subcategory : '');
    return _catAndSubcatMatch(parentCat, parentSub, coachCat, coachSub);
});
ok('3b · [HUECO CERRADO] con el fix, ese padre de Juvenil B SOLO ve a su propio entrenador (otro-coach-uid)',
   matchesWithFix.length === 1 && matchesWithFix[0].uid === 'otro-coach-uid',
   'coincidencias con fix: ' + matchesWithFix.map(u => u.uid).join(', '));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────
// test_messaging_multiclubid.js · "Director→Entrenador" y "Coordinador→
// Entrenador" aparecían como SIN CONEXIÓN en las pruebas reportadas
// (mensajes.txt), mientras que "Director↔Coordinador" SÍ funcionaba.
//
// Causa: js/coach/comms/panel.js (_loadUnifiedContactList) consultaba
// 'users' con un único where(clubId == me.clubId). El clubId del
// entrenador y el del director/coordinador pueden ser DISTINTOS por
// inconsistencias históricas en users/{uid} — el MISMO problema ya
// identificado y corregido en _sdLoadReports (club-reports.js, v179) para
// la pestaña Informes, pero nunca aplicado a la lista de contactos de
// Mensajería. Con clubIds distintos, la query simple no encontraba a los
// entrenadores -> lista vacía -> "sin conexión". Director↔Coordinador
// "funcionaba" porque en el caso probado sus clubIds sí coincidían.
//
// Fix: misma estrategia de reconciliación multi-clubId (propio doc +
// allRoles + usuarios ya encontrados + búsqueda por email), consultando
// 'users' por CADA clubId descubierto y fusionando sin duplicar.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── Reconciliación multi-clubId en la lista de contactos de Mensajería ──\n');

const commsSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

console.log('── PARTE 1 · estructura del código real ──');
ok('1a · [FIX] resuelve clubId vía _cResolveClubId si me.clubId no está disponible',
   /if \(!clubId && me\.uid && typeof window\._cResolveClubId === 'function'\)/.test(commsSrc));
ok('1b · [FIX] descubre clubIds alternativos leyendo el propio doc de users/{uid}',
   /const _allClubIds = new Set\(\[clubId\]\);[\s\S]{0,300}getDoc\(doc\(db, 'users', me\.uid\)\)/.test(commsSrc));
ok('1c · [FIX] recorre allRoles del propio usuario para sumar sus clubIds',
   /myData\.allRoles\.forEach\(r => \{ if \(r && r\.clubId\) _allClubIds\.add\(r\.clubId\); \}\)/.test(commsSrc));
ok('1d · [FIX] _queryUsersForClub consulta \'users\' por cada clubId y fusiona sin duplicar (idempotente)',
   /const queriedClubIds = new Set\(\);/.test(commsSrc) && /if \(queriedClubIds\.has\(cid\)\) return;/.test(commsSrc));
ok('1e · [FIX] también descubre clubIds de los usuarios ya encontrados (2ª ronda)',
   (commsSrc.match(/await _queryUsersForClub\(cid\);/g) || []).length >= 2);
ok('1f · [FIX] búsqueda por email propio para cubrir el caso multi-rol con clubId distinto',
   /where\('email', '==', me\.email\)/.test(commsSrc));

// ═══════════ PARTE 2 · simulación del algoritmo de reconciliación ═══════════
console.log('\n── PARTE 2 · simulación del caso reportado (clubId distinto director/entrenador) ──');

// Reproduce el algoritmo real (misma lógica que panel.js) contra una base de
// datos simulada en memoria, sin depender del SDK de Firestore.
function simulateReconciliation(usersDb, me) {
    const _allClubIds = new Set([me.clubId].filter(Boolean));
    const myDoc = usersDb[me.uid];
    if (myDoc) {
        if (myDoc.clubId) _allClubIds.add(myDoc.clubId);
        if (Array.isArray(myDoc.allRoles)) myDoc.allRoles.forEach(r => { if (r && r.clubId) _allClubIds.add(r.clubId); });
    }

    const clubUsers = [];
    const seenUserIds = new Set();
    const queriedClubIds = new Set();
    const queryUsersForClub = (cid) => {
        if (queriedClubIds.has(cid)) return;
        queriedClubIds.add(cid);
        Object.entries(usersDb).forEach(([id, data]) => {
            if (data.clubId !== cid) return;
            if (seenUserIds.has(id)) return;
            seenUserIds.add(id);
            if (data.clubId) _allClubIds.add(data.clubId);
            if (Array.isArray(data.allRoles)) data.allRoles.forEach(r => { if (r && r.clubId) _allClubIds.add(r.clubId); });
            if (data.uid && data.uid !== id) return; // excluir documentos secundarios
            clubUsers.push({ uid: id, ...data });
        });
    };

    for (const cid of [..._allClubIds]) queryUsersForClub(cid);
    for (const cid of [..._allClubIds]) queryUsersForClub(cid);

    if (me.email) {
        Object.values(usersDb).forEach(data => {
            if (data.email === me.email && data.clubId) queryUsersForClub(data.clubId);
        });
    }
    return clubUsers;
}

// Base de datos simulada, reproduciendo el patrón real documentado en
// club-reports.js (v179): "el clubId del entrenador y el del director
// pueden ser DIFERENTES (p.ej. club_mq1hzm6o_1j6j vs club_mqlhzm6o_ij6j)
// porque el campo se asignó de forma inconsistente". El propio documento
// del Director conserva la referencia al clubId antiguo en su allRoles
// (p.ej. de cuando se le dio de alta como coordinador bajo ese club_B),
// aunque su clubId raíz actual sea club_A. El entrenador quedó registrado
// con clubId raíz = club_B. Una query ingenua por club_A (raíz del
// director) nunca encuentra al entrenador.
const usersDb = {
    'director-uid': {
        uid: 'director-uid', email: 'director@cddia.com', clubId: 'club_A',
        role: 'director',
        allRoles: [{ role: 'director', clubId: 'club_A' }, { role: 'coordinator', clubId: 'club_B' }],
    },
    'coach-uid': {
        uid: 'coach-uid', email: 'coach@cddia.com', clubId: 'club_B', // <- clubId DISTINTO del director
        role: 'user', category: 'alevin', subcategory: 'C',
        allRoles: [{ role: 'user', clubId: 'club_B', category: 'alevin', subcategory: 'C' }],
    },
};

const me = { uid: 'director-uid', email: 'director@cddia.com', clubId: 'club_A' };
const clubUsers = simulateReconciliation(usersDb, me);

ok('2a · [HUECO CERRADO] el entrenador con clubId distinto SÍ aparece en clubUsers del director',
   clubUsers.some(u => u.uid === 'coach-uid'),
   'clubUsers: ' + clubUsers.map(u => u.uid).join(', '));
ok('2b · el propio director también está presente (no se pierde a sí mismo)',
   clubUsers.some(u => u.uid === 'director-uid'));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

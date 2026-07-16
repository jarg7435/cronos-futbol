// ─────────────────────────────────────────────────────────────────────────
// test_sec_c2_live_delete.js  ·  SEC-C2: cerrar el borrado cruzado de
// live_matches huerfanos (clubId == null) por cualquier autenticado.
//
// El `allow delete` de match /live_matches/{matchId} tenia una rama standalone
// `resource.data.clubId == null` que autorizaba a CUALQUIER usuario autenticado
// a borrar un partido en vivo sin clubId. Esos docs contienen PII de menores
// (nombres, dorsales, colores), asi que un usuario del club B podia borrar el
// partido huerfano de un coach del club A.
//
// Este test NO usa el emulador (bloqueado por entorno: solo JDK 8, el emulador
// exige JDK >= 21). En su lugar:
//   PARTE 1 · valida ESTRUCTURALMENTE la fuente de firestore.rules: que la rama
//             standalone `clubId == null` YA NO exista en el allow delete de
//             live_matches, y que las ramas legitimas sigan presentes.
//   PARTE 2 · SIMULA el predicado del allow delete (modela exactamente la
//             expresion de la regla) sobre 8 escenarios y comprueba que el
//             hueco esta cerrado sin romper el flujo legitimo del coach.
//   PARTE 3 · comprueba que el flujo cliente de borrado (setup-modal.js /
//             sync.js) SIEMPRE escribe createdBy con el uid del coach, de modo
//             que la rama `createdBy == uid` cubre el borrado de su propio
//             partido huerfano.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

// ═══════════════════ PARTE 1 · estructura de firestore.rules ═══════════════
console.log('── SEC-C2 · borrado de live_matches huerfanos ──\n');
console.log('── PARTE 1 · estructura de firestore.rules ──');

const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

// Aislar el bloque match /live_matches/{matchId}.
const lmStart = rules.indexOf('match /live_matches/{matchId}');
ok('1a · existe el bloque match /live_matches/{matchId}', lmStart !== -1);
// El bloque termina en el cierre de su llave; basta cortar hasta la siguiente
// declaracion match a nivel de coleccion.
const lmEnd = rules.indexOf('match /', lmStart + 1);
const lmBlock = rules.slice(lmStart, lmEnd === -1 ? undefined : lmEnd);

// Extraer SOLO el allow delete (desde 'allow delete:' hasta su ';' de cierre,
// que es el primer ');' que cierra el parentesis de la condicion).
const delIdx = lmBlock.indexOf('allow delete:');
ok('1b · el bloque tiene un allow delete', delIdx !== -1);
const allowDelete = lmBlock.slice(delIdx, lmBlock.indexOf(');', delIdx) + 2);

// 1c. La rama standalone `clubId == null` YA NO existe en el allow delete.
//     (Cuidado: NO confundir con comentarios; el slice anterior arranca en
//      'allow delete:' que va DESPUES del bloque de comentarios, asi que aqui
//      solo hay codigo de la condicion.)
const hasStandaloneNull = /resource\.data\.clubId\s*==\s*null\s*\|\|/.test(allowDelete);
ok('1c · [FIX] sin rama standalone `resource.data.clubId == null ||` en allow delete',
   !hasStandaloneNull, allowDelete.replace(/\s+/g, ' '));

// 1d. Las ramas legitimas siguen presentes en el allow delete.
ok('1d · allow delete conserva isSuperAdmin()', /isSuperAdmin\(\)/.test(allowDelete));
ok('1e · allow delete conserva sameClub(resource.data.clubId)', /sameClub\(resource\.data\.clubId\)/.test(allowDelete));
ok('1f · allow delete conserva userDocClubId(resource.data.clubId)', /userDocClubId\(resource\.data\.clubId\)/.test(allowDelete));
ok('1g · allow delete conserva la rama createdBy == uid', /resource\.data\.createdBy\s*==\s*request\.auth\.uid/.test(allowDelete));
ok('1h · allow delete conserva la rama coachEmail == token.email', /resource\.data\.coachEmail\s*==\s*request\.auth\.token\.email/.test(allowDelete));

// 1i. El create/update NO deben re-introducir la rama standalone null como via
//     de borrado (sanity: siguen intactos, no es objetivo de este fix).
ok('1i · el bloque menciona SEC-C2 (documentado)', /SEC-C2/.test(lmBlock));

// ═══════════════════ PARTE 2 · simulacion del predicado ════════════════════
console.log('\n── PARTE 2 · simulacion del allow delete ──');

// Modela EXACTAMENTE la expresion de la regla endurecida:
//   isAuth() && (
//     isSuperAdmin() ||
//     sameClub(resource.data.clubId) ||
//     userDocClubId(resource.data.clubId) ||
//     (resource.data.createdBy != null && resource.data.createdBy == uid) ||
//     (resource.data.coachEmail != null && token.email != null &&
//      resource.data.coachEmail == token.email)
//   )
// donde:
//   sameClub(cid)      = (club_admin|individual_admin) && token.clubId == cid  (cid != null)
//   userDocClubId(cid) = users/{uid}.clubId == cid                            (cid != null)
function ruleAllowsDelete(req, doc, world) {
    if (!req.auth) return false; // isAuth()
    const uid = req.auth.uid;
    const token = req.auth.token || {};
    const isSuperAdmin = token.role === 'superadmin';
    const cid = doc.clubId; // resource.data.clubId (puede ser null)

    const sameClub =
        cid != null &&
        (token.role === 'club_admin' || token.role === 'individual_admin' ||
         token.role === 'admin_individual') &&
        token.clubId === cid;

    // userDocClubId lee server-side users/{uid}.clubId.
    const userDocClubId =
        cid != null &&
        world.users[uid] != null &&
        world.users[uid].clubId === cid;

    const byCreatedBy = doc.createdBy != null && doc.createdBy === uid;
    const byCoachEmail = doc.coachEmail != null && token.email != null &&
                         doc.coachEmail === token.email;

    return isSuperAdmin || sameClub || userDocClubId || byCreatedBy || byCoachEmail;
}

// Mundo: users/{uid}.clubId (para userDocClubId).
const world = {
    users: {
        coachA: { clubId: 'CLUB_A' },
        coachB: { clubId: 'CLUB_B' },
        coachNoClub: {},          // coach sin club (users doc sin clubId)
        randomUser: { clubId: 'CLUB_B' },
    },
};

// Doc huerfano SIN clubId, creado por coachNoClub.
const orphanDoc = { clubId: null, createdBy: 'coachNoClub', coachEmail: 'nc@x.com', players: ['MENOR'] };
// Doc huerfano legacy SIN createdBy/coachEmail (pre-v274).
const legacyOrphan = { clubId: null };
// Doc del club A (con clubId).
const clubADoc = { clubId: 'CLUB_A', createdBy: 'coachA', coachEmail: 'a@x.com' };

// (a) [HUECO CERRADO] usuario de otro club borra el partido huerfano ajeno → DENY
ok('2a · [FIX] usuario ajeno (CLUB_B) borra orphan de coachNoClub → DENY',
   ruleAllowsDelete({ auth: { uid: 'randomUser', token: { role: 'coach', clubId: 'CLUB_B', email: 'r@x.com' } } }, orphanDoc, world) === false);

// (b) [HUECO CERRADO] un coach cualquiera con email distinto borra el orphan ajeno → DENY
ok('2b · [FIX] coachB (email distinto) borra orphan de coachNoClub → DENY',
   ruleAllowsDelete({ auth: { uid: 'coachB', token: { role: 'coach', clubId: 'CLUB_B', email: 'b@x.com' } } }, orphanDoc, world) === false);

// (c) [LEGITIMO] el creador borra SU propio partido huerfano (createdBy) → ALLOW
ok('2c · el creador (coachNoClub) borra su propio orphan por createdBy → ALLOW',
   ruleAllowsDelete({ auth: { uid: 'coachNoClub', token: { role: 'coach', email: 'otro@x.com' } } }, orphanDoc, world) === true);

// (d) [LEGITIMO] el coach borra su orphan por coachEmail (aunque cambie de uid) → ALLOW
ok('2d · coach con email == coachEmail borra el orphan por coachEmail → ALLOW',
   ruleAllowsDelete({ auth: { uid: 'otroUid', token: { role: 'coach', email: 'nc@x.com' } } }, orphanDoc, world) === true);

// (e) [LEGITIMO] superadmin borra cualquier orphan → ALLOW
ok('2e · superadmin borra orphan legacy → ALLOW',
   ruleAllowsDelete({ auth: { uid: 'sa', token: { role: 'superadmin' } } }, legacyOrphan, world) === true);

// (f) [HUECO CERRADO] cualquier autenticado borra el orphan legacy (sin
//     createdBy/coachEmail) → DENY (antes: ALLOW por la rama null)
ok('2f · [FIX] usuario cualquiera borra orphan legacy (sin createdBy) → DENY',
   ruleAllowsDelete({ auth: { uid: 'randomUser', token: { role: 'coach', clubId: 'CLUB_B', email: 'r@x.com' } } }, legacyOrphan, world) === false);

// (g) [LEGITIMO] club_admin del mismo club borra el partido de su club → ALLOW
ok('2g · club_admin de CLUB_A borra partido de CLUB_A por sameClub → ALLOW',
   ruleAllowsDelete({ auth: { uid: 'adminA', token: { role: 'club_admin', clubId: 'CLUB_A', email: 'adm@x.com' } } }, clubADoc, world) === true);

// (h) [HUECO CERRADO] admin de otro club borra el partido de CLUB_A → DENY
ok('2h · club_admin de CLUB_B NO borra partido de CLUB_A → DENY',
   ruleAllowsDelete({ auth: { uid: 'adminB', token: { role: 'club_admin', clubId: 'CLUB_B', email: 'admb@x.com' } } }, clubADoc, world) === false);

// (i) sanity: sin auth → DENY (isAuth())
ok('2i · sin autenticacion → DENY',
   ruleAllowsDelete({ auth: null }, orphanDoc, world) === false);

// ═══════════════════ PARTE 3 · flujo cliente escribe createdBy ═════════════
console.log('\n── PARTE 3 · el cliente escribe createdBy (cubre el borrado legitimo) ──');

const sync = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const setupModal = fs.readFileSync(path.join(ROOT, 'js', 'core', 'setup-modal.js'), 'utf8');

// 3a. sync.js emite createdBy con el uid del coach en el snapshot.
ok('3a · sync.js escribe createdBy: window._cronosCurrentUser?.uid',
   /createdBy:\s*window\._cronosCurrentUser\?\.uid/.test(sync), 'no se encontro createdBy en sync.js');

// 3b. La query de recuperacion filtra por createdBy == me.uid (solo ve LOS SUYOS).
ok('3b · setup-modal.js filtra la recuperacion por createdBy == me.uid',
   /where\(\s*['"]createdBy['"]\s*,\s*['"]==['"]\s*,\s*me\.uid\s*\)/.test(setupModal),
   'no se encontro el where(createdBy==me.uid) en setup-modal.js');

// 3c. El borrado del panel (_doDeleteLiveMatch) borra por matchId (docs propios
//     que provienen de esa query filtrada por createdBy).
ok('3c · setup-modal.js borra live_matches por matchId (docs propios)',
   /deleteDoc\(\s*doc\(\s*fa\.db\s*,\s*['"]live_matches['"]\s*,\s*matchId\s*\)\s*\)/.test(setupModal));

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass} passed)`);
process.exit(fail ? 1 : 0);

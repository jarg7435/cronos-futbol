// ─────────────────────────────────────────────────────────────────────────
// test_sec_transitionalread_clubid.js  ·  Auditoria 2026-07-22, hallazgo #1
//
// transitionalRead(clubId) concede una ventana de gracia de 5 min a cuentas
// recien creadas sin custom claims todavia. La version reintroducida en el
// WIP del 2026-07-22 media la ventana desde users/{uid}.createdAt (arregla
// que fuera renovable con logout+login) pero NO comprobaba que el clubId del
// documento objetivo perteneciera al propio usuario: cualquier cuenta nueva
// (de cualquier club, o de ninguno) podia leer/escribir documentos de
// CUALQUIER OTRO club durante los 5 minutos, en las ~15 colecciones que usan
// esta rama (teams, players, trainings, matches, messages,
// cronos_player_links, individuals, etc).
//
// Fix aplicado: se anade `get(users/uid).data.clubId == clubId` a la funcion,
// igual que ya hace userDocClubId() para usuarios con claims. La ventana de
// gracia solo cubre el club al que el usuario dice pertenecer, nunca uno
// ajeno.
//
// Este test NO usa el emulador (bloqueado por entorno: solo JDK 8, el
// emulador de firebase-tools exige JDK >= 21; ver SEC-C3 en
// CORRECCIONES_ESTADO.md). En su lugar:
//   PARTE 1 · valida ESTRUCTURALMENTE la fuente de firestore.rules: que
//             transitionalRead() ahora exige clubId propio, y que el resto de
//             la logica (ventana de 5 min, fail-closed sobre createdAt, sin
//             claims) sigue intacta.
//   PARTE 2 · SIMULA el predicado (modela exactamente la expresion de la
//             regla) sobre 8 escenarios: cierra el hueco cross-club sin
//             romper el flujo legitimo de un usuario recien registrado.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── SEC-transitionalRead · fuga cross-club en la ventana de gracia ──\n');
console.log('── PARTE 1 · estructura de firestore.rules ──');

const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

const fnStart = rules.indexOf('function transitionalRead(clubId)');
ok('1a · existe function transitionalRead(clubId)', fnStart !== -1);
const fnEnd = rules.indexOf('\n    }', fnStart);
const fnBody = rules.slice(fnStart, fnEnd + 6);

// Tolerante a ambos estilos: acceso directo `.data.clubId` o el estilo
// defensivo null-safe `.data.get('clubId', default)` (aplicado externamente
// al archivo tras este fix) — lo que importa es la PROPIEDAD de seguridad
// (se compara contra el clubId del propio usuario), no la sintaxis exacta.
ok('1b · [FIX] exige que el clubId del documento coincida con users/{uid}.clubId',
   /users\/\$\(request\.auth\.uid\)\)\.data(?:\.clubId|\.get\(\s*'clubId'[^)]*\))\s*==\s*clubId/.test(fnBody),
   fnBody.replace(/\s+/g, ' '));
ok('1c · conserva isAuth() && !hasClaims()', /isAuth\(\)\s*&&\s*!hasClaims\(\)/.test(fnBody));
ok('1d · conserva el guard clubId != null', /clubId\s*!=\s*null/.test(fnBody));
ok('1e · conserva exists(users/{uid}) antes de leerlo', /exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)/.test(fnBody));
ok('1f · conserva fail-closed sobre createdAt is timestamp',
   /createdAt[\s\S]{0,25}is\s+timestamp/.test(fnBody));
ok('1g · conserva la ventana de 5 minutos', /duration\.value\(5,\s*'m'\)/.test(fnBody));
ok('1h · el fix quedo documentado en el comentario', /PROPIEDAD DE CLUB/.test(rules.slice(Math.max(0, fnStart - 2000), fnStart)));

// ═══════════════════ PARTE 2 · simulacion del predicado ════════════════════
console.log('\n── PARTE 2 · simulacion de transitionalRead(clubId) ──');

const FIVE_MIN = 5 * 60 * 1000;

// Modela EXACTAMENTE la expresion (post-fix) de transitionalRead(clubId):
//   isAuth() && !hasClaims() && clubId != null
//   && exists(users/uid) && get(users/uid).data.clubId == clubId
//   && get(users/uid).data.createdAt is timestamp
//   && (now - createdAt) < 5min
function transitionalReadSim({ auth, userDoc, createdAtIsTimestamp = true, now }, clubId) {
    const isAuth = !!auth;
    const hasClaims = isAuth && auth.token && ('role' in auth.token) && ('clubId' in auth.token);
    if (!isAuth || hasClaims || clubId == null) return false;
    if (!userDoc) return false;                         // exists(users/uid)
    if (userDoc.clubId !== clubId) return false;         // [FIX] propiedad de club
    if (!createdAtIsTimestamp) return false;              // fail-closed
    return (now - userDoc.createdAt) < FIVE_MIN;
}

const now = Date.now();
const freshUser = (clubId, ageMs) => ({
    auth: { uid: 'atacante-o-legit', token: {} },       // sin claims todavia
    userDoc: { clubId, createdAt: now - ageMs },
    now,
});

// a) EL HUECO ORIGINAL: cuenta nueva de un club X (o sin club) que intenta
//    leer/escribir un documento de un club AJENO Y, dentro de la ventana.
ok('2a · [HUECO CERRADO] cuenta del club A no accede a documento del club B',
   transitionalReadSim(freshUser('clubA', 60 * 1000), 'clubB') === false);

// b) Variante del hueco: cuenta SIN club propio (clubId null en su doc) no
//    accede a ningun club ajeno con solo "clubId != null" del documento.
ok('2b · [HUECO CERRADO] cuenta sin clubId propio no accede a documento con clubId de otro club',
   transitionalReadSim(freshUser(null, 60 * 1000), 'clubB') === false);

// c) Flujo LEGITIMO: cuenta recien creada (30s) del club A leyendo/escribiendo
//    SU PROPIO club A, dentro de la ventana de 5 min -> debe seguir permitido.
ok('2c · [FLUJO INTACTO] cuenta del club A SI accede a documento de su propio club A (30s)',
   transitionalReadSim(freshUser('clubA', 30 * 1000), 'clubA') === true);

// d) Ventana expirada (6 min) incluso para el propio club -> deniega.
ok('2d · ventana expirada (6 min) deniega incluso para el propio club',
   transitionalReadSim(freshUser('clubA', 6 * 60 * 1000), 'clubA') === false);

// e) Usuario YA con claims (aprobado) -> transitionalRead ya no aplica (la
//    cubren userDocClubId/sameClubAsDoc, fuera del alcance de este helper).
ok('2e · usuario con custom claims no depende de transitionalRead',
   transitionalReadSim({ auth: { uid: 'u', token: { role: 'user', clubId: 'clubA' } },
                         userDoc: { clubId: 'clubA', createdAt: now - 1000 }, now }, 'clubA') === false);

// f) users/{uid} no existe todavia (carrera alta) -> deniega (fail-closed).
ok('2f · sin users/{uid} todavia -> deniega',
   transitionalReadSim({ auth: { uid: 'u', token: {} }, userDoc: null, now }, 'clubA') === false);

// g) createdAt legacy (no timestamp) -> deniega (fail-closed, ya cubierto
//    antes del fix; se reconfirma que el fix no lo rompio).
ok('2g · createdAt legacy no-timestamp -> deniega',
   transitionalReadSim({ ...freshUser('clubA', 30 * 1000), createdAtIsTimestamp: false }, 'clubA') === false);

// h) clubId del documento es null -> deniega (nunca hubo caso de uso valido).
ok('2h · clubId del documento objetivo null -> deniega',
   transitionalReadSim(freshUser('clubA', 30 * 1000), null) === false);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

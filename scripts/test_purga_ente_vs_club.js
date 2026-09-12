// ═══════════════════════════════════════════════════════════════════════════
// GUARD · Quién puede BORRAR DEFINITIVAMENTE un informe — v701
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor:
//   · ENTORNO INDIVIDUAL: como no existe el Director Deportivo, el entrenador
//     administrador puede no sólo ocultar, sino BORRAR definitivamente.
//   · CLUBES: jerarquía intacta — entrenador y coordinador sólo ocultan, y el
//     borrado definitivo sigue siendo del Director (y del Admin. de Club).
//   · El borrado definitivo purga también el acumulado de la temporada.
//
// ⚠️ ESTE GUARD EJECUTA LA PUERTA con usuarios reales de cada tipo. Es una
// regla de PERMISOS: leer que existe un `if` no dice a quién deja pasar, y
// aquí los dos errores posibles son graves y opuestos —abrirle el borrado a un
// entrenador de club, o dejar al del ente sin poder borrar nada.
//
// 🔑 `_sdPuedePurgar` es la puerta ÚNICA: la consultan el panel de Dirección,
// Mis Informes, Partidos Terminados y los dos borrados masivos. Por eso se
// prueba la función, no cada pantalla.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); fallos++; }
}

let compila = true;
['js/coach/reports/club-reports.js', 'js/coach/comms/individual-reports.js'].forEach(f => {
    try { execFileSync(process.execPath, ['--check', path.join(RAIZ, f)], { stdio: 'pipe' }); }
    catch (e) { compila = false; }
});
ok('los ficheros tocados compilan (node --check)', compila);

// Extrae una `function nombre(...) {...}` emparejando llaves.
function extrae(src, nombre) {
    const start = src.indexOf('function ' + nombre + '(');
    if (start < 0) return null;
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

const club = leer('js/coach/reports/club-reports.js');
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(
    (extrae(club, '_sdEsEntornoIndividual') || '') + '\n' +
    (extrae(club, '_sdPuedePurgar') || '') + '\n' +
    'this.window.CRONOS_ROLES_INDIVIDUALES = ' +
    "['individual','admin_individual','parent_individual','entrenador_individual','padre_individual'];\n" +
    'this.puede = _sdPuedePurgar; this.esEnte = _sdEsEntornoIndividual;',
    ctx
);
const puede = ctx.puede, esEnte = ctx.esEnte;
ok('club-reports.js expone la puerta y el criterio de entorno',
   typeof puede === 'function' && typeof esEnte === 'function');

if (typeof puede === 'function') {
    // ═══ CLUBES · la jerarquía NO se toca ══════════════════════════════════
    const entrenadorClub  = { uid: 'u1', role: 'user', _activeRole: 'user', clubId: 'clubA' };
    const coordinadorClub = { uid: 'u2', role: 'coordinator', _activeRole: 'coordinator', clubId: 'clubA' };
    const directorClub    = { uid: 'u3', role: 'director', _activeRole: 'director', clubId: 'clubA' };
    const adminClub       = { uid: 'u4', role: 'club_admin', _activeRole: 'club_admin', clubId: 'clubA' };
    const sa              = { uid: 'u5', role: 'superadmin' };

    ok('🚨 CLUB · el ENTRENADOR sigue SIN poder borrar definitivamente', puede(entrenadorClub) === false);
    ok('🚨 CLUB · el COORDINADOR sigue SIN poder borrar definitivamente', puede(coordinadorClub) === false);
    ok('CLUB · el DIRECTOR sí puede', puede(directorClub) === true);
    ok('CLUB · el ADMINISTRADOR DE CLUB sí puede', puede(adminClub) === true);
    ok('el SuperAdmin puede', puede(sa) === true);

    // 🔑 Un multi-rol que ha entrado como COORDINADOR no puede, aunque su
    // documento diga director: manda el rol ACTIVO (regla del autor, v-2026-08-13).
    const directorEntrandoDeCoord = { uid: 'u6', role: 'director', _activeRole: 'coordinator', clubId: 'clubA' };
    ok('🔑 CLUB · un director que entró como COORDINADOR no puede borrar',
       puede(directorEntrandoDeCoord) === false);

    // ═══ ENTE · el encargo nuevo ═══════════════════════════════════════════
    const enteDueno   = { uid: 'e1', role: 'individual', _activeRole: 'individual',
                          individualEntityId: 'ente1', isIndividual: true };
    const enteAdmin   = { uid: 'e2', role: 'admin_individual', _activeRole: 'admin_individual',
                          individualEntityId: 'ente1' };
    const enteCoach   = { uid: 'e3', role: 'user', _activeRole: 'user',
                          _activeRoleData: { role: 'user', individualEntityId: 'ente1' } };
    const enteRaiz    = { uid: 'e4', role: 'user', _activeRole: 'user',
                          isIndividual: true, individualEntityId: 'ente1' };

    ok('🔑 ENTE · el Entrenador Administrador Individual SÍ puede borrar', puede(enteDueno) === true);
    ok('🔑 ENTE · también con el rol admin_individual', puede(enteAdmin) === true);
    ok('🔑 ENTE · un entrenador cuya PLAZA cuelga del ente también',
       puede(enteCoach) === true);
    ok('🔑 ENTE · y la marca en la raíz (isIndividual + entidad) también',
       puede(enteRaiz) === true);

    // ═══ LA FRONTERA · que el ente no se cuele en el club ══════════════════
    // 🚨 Lo más peligroso de este cambio sería que un entrenador de CLUB
    // entrara por la rama del ente. Se prueban las formas en que podría pasar.
    ok('🚨 FRONTERA · entrenador de club con `isIndividual` pero SIN entidad, NO',
       puede({ uid: 'x1', role: 'user', _activeRole: 'user', clubId: 'clubA', isIndividual: true }) === false);
    ok('🚨 FRONTERA · entrenador de club cuya plaza es de CLUB, NO',
       puede({ uid: 'x2', role: 'user', _activeRole: 'user',
               _activeRoleData: { role: 'user', clubId: 'clubA' } }) === false);
    ok('🚨 FRONTERA · un FAMILIAR de club tampoco',
       puede({ uid: 'x3', role: 'parent', _activeRole: 'parent', clubId: 'clubA' }) === false);
    ok('sin usuario, no', puede(null) === false);

    // El familiar del ENTE sí entra por el criterio de entorno (su rol es
    // individual), pero eso no le da acceso a "Mis Informes": esa pantalla es
    // del entrenador. Se deja constancia de que la puerta es de ENTORNO.
    ok('el criterio distingue entorno, no pantalla (familiar del ente = entorno individual)',
       esEnte({ uid: 'p1', role: 'parent_individual', _activeRole: 'parent_individual' }) === true);
}

// ═══════════════════════════════════════════════════════════════════════════
//  INTEGRACIÓN EN «MIS INFORMES»
// ═══════════════════════════════════════════════════════════════════════════
const ind = leer('js/coach/comms/individual-reports.js');

ok('existe el borrado definitivo por informe (miPurgarInforme)',
   /window\.miPurgarInforme\s*=/.test(ind));

// 🔑 LA PUERTA VA DENTRO DE LA FUNCIÓN, no sólo al pintar el botón: esto se
// llama desde la consola (lección de v596 y v679).
const cuerpo = (() => {
    const i = ind.indexOf('window.miPurgarInforme');
    return i < 0 ? '' : ind.slice(i, i + 4000);
})();
ok('🔑 miPurgarInforme comprueba el permiso ANTES de borrar nada',
   /_sdPuedePurgar\(/.test(cuerpo) &&
   cuerpo.indexOf('_sdPuedePurgar(') < cuerpo.indexOf('cronosPurgarPartido('));

ok('🔑 usa el motor ÚNICO de purga (match-purge.js), no un borrado propio',
   /cronosPurgarPartido\(/.test(cuerpo) && !/deleteDoc\(/.test(cuerpo));

// ⚠️ El ritual de teclear BORRAR es la última barrera de algo irreversible.
ok('pide confirmación y el ritual de teclear BORRAR',
   /confirm\(/.test(cuerpo) && /BORRAR/.test(cuerpo));

// 🔑 EL PUNTO 2 DEL ENCARGO: el acumulado no puede quedar con datos fantasma.
// El resumen se calcula con `ctAccumulatePlayerStats` sobre los informes que
// se acaban de cargar, así que basta con repintar el panel: el partido ya no
// está en la base y no vuelve a contarse.
ok('🔑 al terminar repinta el panel (el acumulado se recalcula sin el partido)',
   /openMisInformes\(\)/.test(cuerpo));
ok('…y el resumen de temporada se DERIVA de los informes cargados, no de un contador guardado',
   /ctAccumulatePlayerStats/.test(ind) && !/seasonTotals|acumuladoGuardado/.test(ind));

ok('el botón 💣 sólo se pinta si la puerta lo permite',
   /\$\{_miPuedePurgar \? `/.test(ind) && /miPurgarInforme\('\$\{key64\}'\)/.test(ind));

// El botón por informe no puede depender del motor de selección múltiple: sin
// él, el entrenador del ente seguiría sin poder borrar.
ok('el botón por informe NO depende de cronosMS (el masivo sí)',
   /const _miPuedePurgar = typeof window\._sdPuedePurgar/.test(ind) &&
   /_miPuedePurgarMasivo = _miHayMS && _miPuedePurgar/.test(ind));

// El aviso ya no puede decir "exclusivo del Director" a secas: en el ente no
// hay Director y quien lo leyera esperaría a alguien que no existe.
ok('el aviso de permiso denegado habla de CLUB, no promete un Director inexistente',
   /En un club, el borrado permanente es exclusivo del Director/.test(ind));

// Y lo que NO debe cambiar: ocultar sigue siendo para todos.
ok('ocultar de mi panel sigue disponible sin permisos especiales',
   /window\.miEliminarInforme\s*=/.test(ind) && /Ocultar de mi panel/.test(ind));

// ═══════════════════════════════════════════════════════════════════════════
//  v702 · LO QUE HACÍA QUE NO BORRARA NADA
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 La purga pide los documentos por `p._id` —así los carga el panel de
// Dirección— pero «Mis Informes» los guardaba sólo como `id`: `docIds` salía
// VACÍO y el borrado terminaba con "No se encontró ningún documento que
// borrar" sin tocar la base. Venía del borrado masivo de v669.
ok('🚨 los informes cargados llevan `_id` (es lo que la purga pide)',
   /reports\.push\(\{ id: d\.id, _id: d\.id,/.test(ind));

const purge = leer('js/coach/reports/match-purge.js');
// 🚨 La consulta ancha por matchId la DENIEGAN las reglas (son por documento):
// sin el reintento acotado al autor, la purga sólo alcanzaba lo que el panel
// tenía cargado y dejaba vivas las demás copias — datos fantasma.
ok('🚨 la recogida de copias reintenta acotada por coachUid si la ancha se deniega',
   /where\('matchId', '==', mid\),\s*\n?\s*mod\.where\('coachUid', '==', _uid\)/.test(purge) ||
   (/coachUid', '==', _uid/.test(purge) && /matchId\+coachUid/.test(purge)));

const reglas = leer('firestore.rules');
ok('las reglas reconocen el entorno individual',
   /function esDeEnteIndividual\(\)/.test(reglas));
// 🔑 La rama nueva SIEMPRE va unida a ser el autor: sin eso, cualquiera de un
// ente podría borrar informes ajenos.
ok('🔑 la rama del ente exige ser el AUTOR del informe',
   /request\.auth\.uid == resource\.data\.get\('coachUid', null\) &&\s*\n?\s*esDeEnteIndividual\(\)/.test(reglas));

console.log(`\n  ${total - fallos}/${total} aserciones`);
process.exit(fallos ? 1 : 0);

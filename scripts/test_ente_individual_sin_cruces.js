// ════════════════════════════════════════════════════════════════════════
//  test_ente_individual_sin_cruces.js
//  CLUB Y ENTE NO SE CRUZAN · Y EL HUÉRFANO TIENE SALIDA — v583
// ════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt + captura 9269, sobre v582):
//
//   1. Al crear un ente individual con `brunoromar2012` —que YA era entrenador
//      del Benjamín C de CD DÍA— aparecieron DOS plazas: Administrador
//      Individual (correcta) y **"una plaza de entrenador individual que yo no
//      había creado"**.
//   2. Borró el ente y quedó un residuo imposible de quitar:
//      "brunoromar2012@gmail.com · Administrador Individual · Activo · Sin
//      ente", en un bloque cuya única acción es "Asignar a un ente"… con CERO
//      entes en el desplegable.
//
//  🔑 MEDIDO POR REST (2026-08-19), no deducido: su documento tiene UNA sola
//  entrada de entrenador, y dice `clubId:'club_mqvr9m11_g9kj'` — CD DÍA. Nunca
//  se creó un rol de entrenador individual.
//
//  CUATRO DEFECTOS:
//   A · Los contadores del ente (individuals-tab.js) preguntaban
//       `allRoles.some(r => r.role === 'user' && r.isAuthorized)` SIN mirar a
//       qué club o ente pertenecía la entrada. El equipo del club se contaba
//       como equipo del ente. El árbol de "Ver usuarios" tenía el mismo
//       defecto, y ése además lleva botón de BORRAR.
//   B · `saAssignOrphanToEntity` reescribía `clubId: entityId` en TODA entrada
//       'user'/'parent': asignar a un ente ARRANCABA las plazas de club y se
//       las pegaba al ente. Cruce de ESCRITURA, permanente.
//   C · Borrar el ente limpiaba las referencias de la raíz pero dejaba
//       `role:'individual'` — el residuo. (Y ese mismo campo es lo que hacía
//       desaparecer su Benjamín C del panel del SA en v582: el residuo de hoy
//       ERA la causa del fallo de ayer.)
//   D · El bloque de huérfanos no ofrecía ninguna salida.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const UTILS = fs.readFileSync(path.join(ROOT, 'js/core/utils.js'), 'utf8');
const TABS  = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/individuals-tab.js'), 'utf8');
const ENTE  = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/individual-entity.js'), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
function trozo(src, cab, cierre) {
    const i = src.indexOf(cab); if (i < 0) throw new Error('No se encontró ' + cab);
    const j = src.indexOf(cierre, i); if (j < 0) throw new Error('Sin cierre de ' + cab);
    return src.slice(i, j + cierre.length);
}

// ── El resolutor REAL de "¿esta plaza es de este ente?" ────────────────
const sb = { console: { log() {}, warn() {} }, String, Set, Array, Object };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(trozo(UTILS, 'if (typeof window.cronosRolDelEnte !== \'function\') {', '\n}'), sb);
const delEnte = sb.window.cronosRolDelEnte;

const ENTE_ID = 'individual_mszx62ex_6o3m';
const CD_DIA  = 'club_mqvr9m11_g9kj';
// Los datos REALES de brunoromar2012, medidos por REST.
const PLAZA_CLUB = { role: 'user', clubId: CD_DIA, category: 'benjamin', subcategory: 'C',
                     isAuthorized: true, status: 'active' };
const PLAZA_ENTE = { role: 'individual', clubId: ENTE_ID, individualEntityId: ENTE_ID,
                     isAuthorized: true, status: 'active' };

console.log('\n── A · una plaza pertenece a UN sitio, y está escrito en ella ──');
{
    ok('A1 · 🔑🔑🔑 el Benjamín C de CD DÍA NO es del ente',
       delEnte(PLAZA_CLUB, ENTE_ID) === false);
    ok('A2 · y la plaza de Administrador Individual SÍ lo es',
       delEnte(PLAZA_ENTE, ENTE_ID) === true);
    ok('A3 · se reconoce el ancla por individualEntityId',
       delEnte({ role: 'user', individualEntityId: ENTE_ID }, ENTE_ID) === true);
    ok('A4 · y por individualOwnerId',
       delEnte({ role: 'parent', individualOwnerId: ENTE_ID }, ENTE_ID) === true);
    ok('A5 · ⚠️ legado: un rol EXPLÍCITAMENTE individual sin ancla cuenta como del ente',
       delEnte({ role: 'entrenador_individual' }, ENTE_ID) === true);
    ok('A6 · 🔑 pero un `user` SIN ancla NO: podría ser de cualquier club',
       delEnte({ role: 'user' }, ENTE_ID) === false);
    ok('A7 · una plaza de OTRO ente tampoco es de éste',
       delEnte({ role: 'individual', clubId: 'individual_otro' }, ENTE_ID) === false);
}

console.log('\n── A(bis) · el contador del ente deja de contar equipos de club ──');
{
    // Se reproduce la decisión de `slotBar` tal como queda en el fichero.
    const ROLES_DE_BARRA = {
        admin_individual: ['admin_individual', 'individual'],
        user:             ['user', 'entrenador_individual'],
        parent_individual:['parent', 'parent_individual'],
    };
    const cuenta = (entUsers, roleKey) => {
        const acepta = ROLES_DE_BARRA[roleKey];
        return entUsers.filter(u => {
            if (u.status === 'removed') return false;
            const roles = Array.isArray(u.allRoles) ? u.allRoles : [];
            const anclados = roles.filter(r => delEnte(r, ENTE_ID));
            if (anclados.length) return anclados.some(r => acepta.indexOf(r.role) >= 0 && r.isAuthorized);
            return acepta.indexOf(u.role) >= 0;
        }).length;
    };
    // El caso exacto del autor: bruno dentro del ente, con su equipo en CD DÍA.
    const bruno = { email: 'brunoromar2012@gmail.com', role: 'individual', status: 'active',
                    clubId: ENTE_ID, individualEntityId: ENTE_ID,
                    allRoles: [PLAZA_ENTE, PLAZA_CLUB] };
    ok('A8 · 🔑🔑🔑 el ente cuenta 1 Administrador Individual',
       cuenta([bruno], 'admin_individual') === 1, cuenta([bruno], 'admin_individual'));
    ok('A9 · 🔑🔑🔑 y CERO entrenadores individuales — el Benjamín C es del CLUB',
       cuenta([bruno], 'user') === 0, cuenta([bruno], 'user'));
    ok('A10 · ⚠️ un entrenador individual DE VERDAD sí se cuenta',
       cuenta([{ email: 'e@i.es', role: 'user', status: 'active', individualEntityId: ENTE_ID,
                 allRoles: [{ role: 'user', clubId: ENTE_ID, isAuthorized: true, status: 'active' }] }],
              'user') === 1);
    ok('A11 · compat: sin ninguna plaza anclada, manda el rol de la RAÍZ',
       cuenta([{ email: 'v@i.es', role: 'individual', status: 'active',
                 individualEntityId: ENTE_ID, allRoles: [] }], 'admin_individual') === 1);
}

console.log('\n── B · asignar a un ente NO puede tocar las plazas de club ──');
{
    // Reproduce el `map` tal como queda en el fichero.
    const ROLES_INDIV = ['individual','admin_individual','parent_individual','entrenador_individual','padre_individual'];
    const anclaAOtro = (r) => !!r && !!r.clubId && String(r.clubId) !== String(ENTE_ID);
    const reancla = (allRoles) => allRoles.map(r => {
        if (anclaAOtro(r)) return r;
        if (r.role === 'individual' || r.role === 'admin_individual') {
            return { ...r, clubId: ENTE_ID, individualEntityId: ENTE_ID, isAuthorized: true, status: 'active' };
        }
        if (ROLES_INDIV.indexOf(r.role) >= 0 || r.role === 'user' || r.role === 'parent') {
            return { ...r, clubId: ENTE_ID, individualEntityId: ENTE_ID };
        }
        return r;
    });
    const res = reancla([PLAZA_ENTE, PLAZA_CLUB]);
    ok('B1 · 🔑🔑🔑 el Benjamín C sigue siendo de CD DÍA después de asignar al ente',
       res[1].clubId === CD_DIA && res[1].category === 'benjamin', res[1]);
    ok('B2 · y la plaza individual sí queda anclada al ente',
       res[0].clubId === ENTE_ID && res[0].individualEntityId === ENTE_ID);
    ok('B3 · ⚠️ una entrada individual SIN ancla sí se reancla (para eso existe el botón)',
       reancla([{ role: 'entrenador_individual', isAuthorized: true }])[0].clubId === ENTE_ID);

    // ⚠️ Y la RAÍZ no se mueve si conserva club: el panel del club carga por
    //    `where('clubId','==',club)` sobre la raíz.
    const cuerpo = TABS.slice(TABS.indexOf('window.saAssignOrphanToEntity'), TABS.indexOf('window.saAssignOrphanToEntity') + 4200);
    ok('B4 · 🔑 la raíz sólo se muda al ente si NO le queda plaza de club',
       /const _plazaDeClub[\s\S]{0,400}if \(!_plazaDeClub\) \{[\s\S]{0,200}updateData\.clubId\s*=\s*entityId/.test(cuerpo));
    ok('B5 · ⚠️ y las referencias del ente viajan siempre (por ahí lo reconoce el ente)',
       /individualEntityId:\s*entityId/.test(cuerpo) && /individualOwnerId:\s*entityId/.test(cuerpo));
}

console.log('\n── C · borrar el ente no puede dejar un "Administrador sin ente" ──');
{
    const i = ENTE.indexOf('const _ROL_INDIV_RAIZ');
    ok('C1 · 🔑🔑🔑 el borrado del ente repara el `role` de la RAÍZ',
       i > 0 && /upd\.role\s*=\s*_plazaClub\.role/.test(ENTE.slice(i, i + 900)));
    ok('C2 · buscando una plaza de club de verdad, nunca otra individual',
       /ROLES_INDIV\.indexOf\(r\.role\) < 0/.test(ENTE.slice(i, i + 900)));
    ok('C3 · ⚠️ y si no le queda ninguna, NO se inventa un rol',
       !/upd\.role\s*=\s*(null|_BORRA)/.test(ENTE.slice(i, i + 900)));
    ok('C4 · 🚨 las solicitudes aprobadas del ente se retiran (si no, el login las resucita)',
       /status:\s*'entity_deleted'/.test(ENTE) && /platform_requests/.test(ENTE));
    ok('C5 · se marcan, no se borran: queda rastro de que aquel alta existió',
       /statusAnterior/.test(ENTE));
}

console.log('\n── D · el huérfano tiene salida ──');
{
    ok('D1 · 🔑 existe la acción de desvincular',
       /window\.saDesvincularHuerfanoIndividual\s*=/.test(TABS));
    ok('D2 · y el bloque de huérfanos ofrece su botón',
       /saDesvincularHuerfanoIndividual\('\$\{eid\}','\$\{em\}'\)/.test(TABS));
    const i = TABS.indexOf('window.saDesvincularHuerfanoIndividual');
    const cuerpo = TABS.slice(i, i + 4600);
    ok('D3 · 🔑🔑🔑 sólo retira lo individual sin ente vivo; la plaza de club se queda',
       /ROLES_INDIV\.indexOf\(r\.role\) >= 0\) return entesVivos\.has\(ancla\);/.test(cuerpo) &&
       /return true;\s*\/\/ plaza de club: intacta/.test(cuerpo));
    ok('D4 · devuelve la raíz al rol de su club',
       /upd\.role\s*=\s*plazaClub\.role/.test(cuerpo));
    ok('D5 · ⚠️ y si no le queda nada, lo dice y ofrece el borrado seguro (que archiva antes)',
       /cronosEliminarUsuarioSeguro/.test(cuerpo));
    ok('D6 · el ente se comprueba VIVO contra `clubs`, no se supone',
       /entesVivos/.test(cuerpo) && /c\.type === 'individual'/.test(cuerpo));
}

console.log('\n── E · el panel del ADMINISTRADOR DEL ENTE tampoco cruza (v584) ──');
{
    // ⚠️ Éste no lo ve el SuperAdmin: lo ve un USUARIO REAL. La pertenencia al
    //    ente ya estaba bien acotada (se consulta por individualOwnerId /
    //    individualEntityId / clubId), pero una vez dentro, los contadores y el
    //    árbol miraban TODAS las plazas de la persona.
    const IND = fs.readFileSync(path.join(ROOT, 'js/admin/individual/panel.js'), 'utf8');
    const i = IND.indexOf('const _delEsteEnte');
    ok('E1 · 🔑 existe el ancla al ente en el panel del administrador individual', i > 0);
    const cuerpo = IND.slice(i, i + 1800);
    ok('E2 · acepta el id del ente Y el uid del admin (hay altas antiguas con el uid)',
       /_queryId/.test(cuerpo) && /uid !== _queryId/.test(cuerpo));
    ok('E3 · 🔑🔑🔑 los contadores sólo miran las plazas ancladas a este ente',
       /const _rolesAqui[\s\S]{0,200}\.filter\(_delEsteEnte\)/.test(cuerpo) &&
       /coachCount\s*=\s*activeParents\.filter\(u => _tieneAqui\(u, \['user', 'entrenador_individual'\]\)\)/.test(IND));
    ok('E4 · y el padre igual',
       /parentCount\s*=\s*activeParents\.filter\(u => _tieneAqui\(u, \['parent', 'parent_individual'\]\)\)/.test(IND));
    ok('E5 · 🔑🔑🔑 el árbol sólo expande las plazas de este ente',
       /const _propias = uniqueRoles\.filter\(_delEsteEnte\);/.test(IND) &&
       /const rolesToExpand = _propias\.length \? _propias : uniqueRoles;/.test(IND));
    ok('E6 · ⚠️ sin ninguna plaza anclada NO se le vacía la fila (sería peor que el cruce)',
       /_propias\.length \? _propias : uniqueRoles/.test(IND));
    // La regla vive en UN sitio; los cuatro paneles la consumen.
    ok('E7 · 🔑 la regla es única: `cronosRolDelEnte` (utils.js), no una copia por panel',
       /window\.cronosRolDelEnte/.test(IND) &&
       /window\.cronosRolDelEnte/.test(TABS) &&
       /window\.cronosRolDelEnte/.test(ENTE) &&
       /window\.cronosRolDelEnte = function/.test(UTILS));
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos === 0) console.log('✅ Club y ente, aislados; y el huérfano se puede resolver');
else console.log('❌ ' + fallos + ' aserción(es) en rojo');
process.exit(fallos === 0 ? 0 : 1);

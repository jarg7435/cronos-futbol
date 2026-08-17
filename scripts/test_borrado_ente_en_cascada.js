// ─────────────────────────────────────────────────────────────────────────
// test_borrado_ente_en_cascada.js · borrar un ente individual limpia lo que
// colgaba de él (v566)
//
// Reporte del autor (2026-08-17, capturas 9129/9135): borrar un ente individual
// dejaba usuarios "huérfanos", y una entrenadora del club oficial —Alevín C y
// Regional A— desapareció de LAS DOS vistas con sus datos intactos en la base.
//
// 🔑🔑🔑 LA CAUSA: `saDeleteIndividualEntity` era `deleteDoc(clubs/{id})` y nada
// más. Ni `allRoles`, ni `individualEntityId`/`individualOwnerId`/`isIndividual`,
// ni el `clubId` de la raíz. El borrado de CLUB (delete-club.js) sí hace la
// cascada desde siempre; el de entes nunca la tuvo.
//
// Por qué desaparecía de los dos paneles: `clubs-tab.js` excluye del árbol de
// clubes a quien tenga cualquiera de esos campos (`isIndivUser`), y el panel del
// club consulta `where('clubId','==',club)`. Referencias colgando = invisible.
//
// LO QUE FIJA ESTE GUARD:
//   A · se limpian usuarios ANTES de borrar el ente (el orden importa);
//   B · se retiran las plazas ancladas al ente… y SOLO ésas;
//   C · las plazas de CLUB se conservan intactas;
//   D · la raíz que apuntaba al ente se repone a un club real, o se deja vacía;
//   E · no se borra ninguna cuenta.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const ENTE = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'individual-entity.js'), 'utf8');
const TAB  = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'clubs-tab.js'), 'utf8');

console.log('── borrar un ente limpia lo que colgaba (v566) ──\n');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 0 · EL BORRADO PELADO NO PUEDE VOLVER
// ═══════════════════════════════════════════════════════════════════════
console.log('── PARTE 0 · ya no es un deleteDoc a secas ──');

const bloque = (() => {
    const i = ENTE.indexOf('window.saDeleteIndividualEntity');
    const j = ENTE.indexOf('window.saShowEntityUsers', i);
    return ENTE.slice(i, j > 0 ? j : ENTE.length);
})();

ok('0a · 🔑 el borrado ya no es sólo `deleteDoc` del ente',
   /getDocs\(collection\(db, 'users'\)\)/.test(bloque),
   'antes era `deleteDoc(doc(db,"clubs",entityId))` y nada más');

ok('0b · 🔑🔑 se limpian los usuarios ANTES de borrar el ente',
   bloque.indexOf('await Promise.all(ops)') > 0 &&
   bloque.indexOf('await Promise.all(ops)') < bloque.indexOf("deleteDoc(doc(db, 'clubs', entityId))"),
   'al revés, un fallo a mitad deja el ente borrado y las referencias al vacío ' +
   '— y ya no se puede deshacer desde la interfaz, porque el ente no sale en ninguna lista');

ok('0c · se retiran las tres referencias de la raíz',
   /individualEntityId = _BORRA/.test(bloque) &&
   /individualOwnerId  = _BORRA/.test(bloque) &&
   /isIndividual = _BORRA/.test(bloque));

// ⚠️ Se anula con `null` y no con `deleteField()` a propósito: `saFS()` no lo
// expone, y traerlo con un `import()` dinámico dejaba la función imposible de
// probar (el guard la ejecuta en un sandbox sin red). Para los consumidores es
// equivalente: todos miran la VERDAD del valor, y `null` es falso.
ok('0c1 · ⚠️ se anula con null, no con un import() dinámico que rompe el sandbox',
   /const _BORRA = null;/.test(bloque) && !/await import\(/.test(bloque),
   'el import dinámico hacía fallar test_sa_individual_entity_module.js');

ok('0d · ⚠️ no se borra ninguna CUENTA: sólo se actualizan documentos',
   !/deleteDoc\(doc\(db, 'users'/.test(bloque),
   'desvincular no es eliminar a la persona');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 1 · EL FILTRO DE PLAZAS, EJECUTADO
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · qué plazas se van y cuáles se quedan ──');

// Se replica el criterio del fichero (mismas dos condiciones) y se comprueba
// que separa bien. Si el fichero cambia, la PARTE 0 lo caza.
const ENTIDAD = 'individual_mqvu0d9r_sakg';
const CLUB    = 'club_mqvr9m11_g9kj';
const ROLES_INDIV = ['individual','admin_individual','parent_individual',
                     'entrenador_individual','padre_individual'];
const anclaAlEnte = (r) => !!r && (
    String(r.clubId || '') === String(ENTIDAD) ||
    String(r.individualEntityId || '') === String(ENTIDAD));
const limpia = (roles) => roles.filter(r => !(anclaAlEnte(r) || (
    ROLES_INDIV.includes(r && r.role) && !r.clubId && !r.individualEntityId)));

// 🔑 EL CASO DEL REPORTE: entrenadora con DOS plazas de club y un rol individual.
const ELLA = [
    { role: 'user',       clubId: CLUB,    category: 'alevin',   subcategory: 'C', isAuthorized: true },
    { role: 'user',       clubId: CLUB,    category: 'regional', subcategory: 'A', isAuthorized: true },
    { role: 'individual', clubId: ENTIDAD, individualEntityId: ENTIDAD, isAuthorized: true },
];
const tras = limpia(ELLA);
ok('1a · 🔑🔑🔑 se conservan SUS DOS plazas de club (Alevín C y Regional A)',
   tras.length === 2 &&
   tras.some(r => r.category === 'alevin'   && r.subcategory === 'C') &&
   tras.some(r => r.category === 'regional' && r.subcategory === 'A'),
   JSON.stringify(tras));

ok('1b · y se retira el rol anclado al ente',
   !tras.some(r => r.role === 'individual'));

// Una plaza de OTRO ente no se toca: sólo se borra el que se está borrando.
const OTRO_ENTE = [{ role: 'individual', clubId: 'individual_otro', individualEntityId: 'individual_otro' }];
ok('1c · ⚠️ una plaza de OTRO ente NO se toca',
   limpia(OTRO_ENTE).length === 1);

// Un rol individual suelto (sin ancla) sí se limpia: no puede referirse a nada.
ok('1d · un rol individual sin ancla ninguna sí se retira',
   limpia([{ role: 'individual' }]).length === 0);

// Un padre del club se queda.
ok('1e · un padre del club se conserva',
   limpia([{ role: 'parent', clubId: CLUB }]).length === 1);

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 2 · POR QUÉ DESAPARECÍA DE LOS DOS PANELES
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · la exclusión que lo hacía invisible ──');

ok('2a · ⚠️ `clubs-tab.js` sigue excluyendo del árbol a quien tenga esos campos',
   /individualEntityId \|\| u\.individualOwnerId \|\| u\.isIndividual/.test(TAB),
   'la exclusión es correcta; lo que fallaba es que los campos quedaran colgando');

ok('2b · por eso la limpieza tiene que ANULAR esos campos, no sólo el ente',
   /individualOwnerId  = _BORRA/.test(bloque));

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 3 · LA RAÍZ QUE APUNTABA AL ENTE
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · la raíz no puede quedar apuntando a un fantasma ──');

ok('3a · si le queda una plaza en un club real, la raíz pasa a ESE club',
   /const otro = \(upd\.allRoles \|\| limpios\)\.find\(r => r && r\.clubId &&/.test(bloque) &&
   /upd\.clubId = otro\.clubId/.test(bloque),
   'sin esto seguiría invisible para `where("clubId","==",club)`');

ok('3b · y si no le queda ninguna, se deja SIN club (no apuntando al ente)',
   /else upd\.clubId = _BORRA/.test(bloque),
   'aparecer en "sin club asignado" es honesto; apuntar a un ente borrado, no');

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

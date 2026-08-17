// ─────────────────────────────────────────────────────────────────────────
// test_sincronia_raiz_plaza_exacta.js · el arranque de sesión sincroniza LA
// PLAZA de la raíz, no "un rol cualquiera de ese club" (v564)
//
// El bloque de `js/services/auth.js` que sincroniza la raíz del documento con
// `allRoles` buscaba así:
//
//     allRoles.find(r => r.role === data.role && r.clubId === data.clubId)
//
// rol y club, SIN CATEGORÍA. Con los dos equipos que v537 hizo legales (un F7
// y un F11 en el mismo club) eso son DOS entradas `role:'user'` con el mismo
// clubId, y de ahí dos daños distintos:
//
//   🔑🔑🔑 1 · Si la plaza de la raíz NO estaba todavía en `allRoles`, el
//        `find` encontraba LA OTRA, se daba por satisfecho y nunca la creaba.
//        El entrenador se quedaba sin el equipo que su propia raíz dice que
//        tiene. Es el mismo daño que v540 midió en producción con
//        brunoromar2012: aprobado un equipo, jamás creada la entrada.
//
//   🔑🔑 2 · El `map` de activación casaba con las DOS, así que entrar a la
//        aplicación activaba también la plaza que un administrador hubiera
//        dejado pendiente A PROPÓSITO.
//
// LO QUE FIJA ESTE GUARD:
//   A · se compara con `cronosMismaPlaza` (rol+club+categoría);
//   B · la plaza que falta SE CREA aunque haya otra del mismo rol y club;
//   C · se activa SÓLO esa plaza, nunca las dos;
//   D · una entrada antigua SIN categoría se adopta (no se duplica) y NO se le
//       estampa la categoría de la raíz, que va desfasada con frecuencia;
//   E · una baja deliberada (`status:'removed'`) sigue sin resucitar.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const AUTH  = fs.readFileSync(path.join(ROOT, 'js', 'services', 'auth.js'), 'utf8');
const UTILS = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');

function trozo(src, cabecera, cierre, desde) {
    const i = src.indexOf(cabecera, desde || 0);
    if (i < 0) throw new Error('No se encontró ' + cabecera);
    const j = src.indexOf(cierre, i);
    if (j < 0) throw new Error('No se encontró el cierre de ' + cabecera);
    return src.slice(i, j + cierre.length);
}

console.log('── la raíz sincroniza SU plaza, no una cualquiera (v564) ──\n');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 0 · LOS PREDICADOS QUE CAUSABAN EL FALLO NO PUEDEN VOLVER
// ═══════════════════════════════════════════════════════════════════════
console.log('── PARTE 0 · los predicados viejos no vuelven ──');

ok('0a · 🔑 ya no se busca la plaza con `find(r => r.role === data.role && clubId)`',
   !/allRoles\.find\(r => r\.role === data\.role && \(r\.clubId \|\| null\) === \(data\.clubId \|\| null\)\)/.test(AUTH),
   'ese find devolvía la plaza equivocada y dejaba sin crear la de la raíz');

ok('0b · 🔑 el map de activación ya no casa por rol+club',
   !/\(r\.role === data\.role && \(r\.clubId \|\| null\) === \(data\.clubId \|\| null\)\)\s*\n\s*\? \{ \.\.\.r, isAuthorized: true/.test(AUTH),
   'casaba con las DOS plazas del entrenador y activaba ambas');

ok('0c · se usa el criterio canónico `cronosMismaPlaza`',
   /_win\.cronosMismaPlaza\(r, _plazaRaiz\)/.test(AUTH));

// ⚠️ v553 · Los guards ejecutan estos bloques en un sandbox SIN `window`, y
// `typeof window.X` LANZA si `window` no está declarado. Se pregunta primero
// por `window` a secas. Sin esto, este cambio tumbaba
// test_baja_no_resucita_al_entrar.js entero.
// 🛡️ Este bloque era el ÚNICO del arranque sin `try`. Si lanzaba, se llevaba
// por delante el manejador de sesión entero: `_cronosCurrentUser` no se
// asignaba y la app quedaba VACÍA en todos los paneles a la vez. Un fallo de
// sincronización de roles no puede costar la sesión.
ok('0f · 🛡️ la sincronización va dentro de un `try`: no puede tumbar el login',
   /try \{\s*\n\s*const _rolRevocado = \(r\) => !!r && r\.status === 'removed';/.test(AUTH) &&
   /catch \(_syncErr\)/.test(AUTH),
   'sin esto, cualquier excepción aquí vacía la aplicación entera');

ok('0e · ⚠️ se consulta `typeof window` antes de tocar sus propiedades',
   /const _win = \(typeof window !== 'undefined'\) \? window : undefined;/.test(AUTH),
   'los guards corren en un sandbox sin window');

ok('0d · y la activación va por ÍNDICE, no por predicado',
   /allRoles\.map\(\(r, i\) =>\s*\n?\s*i === _idxPlaza \? \{ \.\.\.r, isAuthorized: true, status: 'active' \} : r/.test(AUTH));

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 1 · EL BLOQUE REAL, EJECUTADO
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · el bloque real de auth.js, ejecutado ──');

const BLOQUE = trozo(AUTH,
    "const _rolRevocado = (r) => !!r && r.status === 'removed';",
    'if (needsRoleSync) {');
// Se cierra el `if (data.isAuthorized && data.role) {` y se expone el resultado.
const PROGRAMA = BLOQUE.slice(0, BLOQUE.lastIndexOf('if (needsRoleSync) {')) +
                 '\n_out = { allRoles: allRoles, needsRoleSync: needsRoleSync };\n}';

// Las funciones REALES de utils.js, para comparar como compara la app.
// ⚠️ `cronosTeamSlug` quita los acentos con `_cronosNoEsAcento`, que vive
// aparte: sin él, el slug lanza y el guard no probaría nada.
const ACENTO = trozo(UTILS, 'function _cronosNoEsAcento(', '\n}\n');
const SLUG  = ACENTO + '\n' + trozo(UTILS, 'function cronosTeamSlug(', '\n}\n');
const PLAZA = trozo(UTILS, "if (typeof window.cronosMismaPlaza !== 'function') {", '\n}\n');

function sincroniza(raiz, roles) {
    const sb = { String, Object, Array, console: { warn() {} }, _out: undefined };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SLUG + '\nwindow.cronosTeamSlug = cronosTeamSlug;\n' + PLAZA, sb);
    sb.data = raiz;
    sb.allRoles = JSON.parse(JSON.stringify(roles));
    vm.runInContext('let _out; ' + PROGRAMA + '; _res = _out;', sb);
    return vm.runInContext('_res', sb) || { allRoles: sb.allRoles, needsRoleSync: false };
}

const CLUB = 'club_mqvr9m11_g9kj';
const RAIZ_ALEVIN = { isAuthorized: true, role: 'user', clubId: CLUB,
                      clubName: 'CD DÍA', category: 'alevin', subcategory: 'C' };

const P = (cat, sub, extra) => Object.assign(
    { role: 'user', clubId: CLUB, category: cat, subcategory: sub,
      isAuthorized: true, status: 'active' }, extra || {});

// 🔑🔑🔑 EL DAÑO PRINCIPAL: la plaza de la raíz no está y hay OTRA del mismo
// rol y club. Antes el `find` la daba por presente y nunca se creaba.
{
    const r = sincroniza(RAIZ_ALEVIN, [P('regional', 'A')]);
    const tieneAlevin = r.allRoles.some(x => x.category === 'alevin' && x.subcategory === 'C');
    ok('1a · 🔑🔑🔑 con sólo el Regional A presente, la plaza Alevín C SE CREA',
       tieneAlevin && r.allRoles.length === 2 && r.needsRoleSync === true,
       JSON.stringify(r.allRoles));
    ok('1b · y el Regional A no se toca',
       r.allRoles.some(x => x.category === 'regional' && x.subcategory === 'A'));
}

// 🔑🔑 EL SEGUNDO DAÑO: activar las dos de golpe.
{
    const r = sincroniza(RAIZ_ALEVIN, [
        P('regional', 'A', { isAuthorized: false, status: 'pending_club_admin' }),
        P('alevin',   'C', { isAuthorized: false, status: 'pending_club_admin' }),
    ]);
    const reg = r.allRoles.find(x => x.category === 'regional');
    const ale = r.allRoles.find(x => x.category === 'alevin');
    ok('1c · 🔑🔑 se activa SÓLO la plaza de la raíz (Alevín C)',
       ale.isAuthorized === true && ale.status === 'active',
       JSON.stringify(ale));
    ok('1d · 🔑🔑 y el Regional A SIGUE pendiente (lo dejó así un administrador)',
       reg.isAuthorized === false && reg.status === 'pending_club_admin',
       JSON.stringify(reg));
}

// La plaza exacta ya presente y activa: no se toca nada.
{
    const r = sincroniza(RAIZ_ALEVIN, [P('regional', 'A'), P('alevin', 'C')]);
    ok('1e · con las dos plazas ya activas no se escribe nada',
       r.needsRoleSync === false && r.allRoles.length === 2);
}

// ⚠️ La normalización es la del teamId: "Alevín" y "alevin" son el mismo equipo.
{
    const r = sincroniza(RAIZ_ALEVIN, [P('Alevín', 'c')]);
    ok('1f · ⚠️ "Alevín"/"c" y "alevin"/"C" son la MISMA plaza (no se duplica)',
       r.allRoles.length === 1 && r.needsRoleSync === false,
       JSON.stringify(r.allRoles));
}

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 2 · LA ENTRADA ANTIGUA SIN CATEGORÍA
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · la entrada legacy sin categoría se adopta ──');
{
    const legacy = { role: 'user', clubId: CLUB, isAuthorized: false, status: 'pending' };
    const r = sincroniza(RAIZ_ALEVIN, [legacy]);
    ok('2a · 🔑 NO se duplica: se adopta la entrada del mismo rol y club sin categoría',
       r.allRoles.length === 1,
       'comparar en estricto sin este respaldo crearía una plaza de más: ' + JSON.stringify(r.allRoles));
    ok('2b · y se activa esa misma entrada',
       r.allRoles[0].isAuthorized === true && r.allRoles[0].status === 'active');
    ok('2c · ⚠️⚠️ NO se le estampa la categoría de la raíz (va desfasada a menudo)',
       !r.allRoles[0].category,
       'v562/v563 midieron raíces que describían el equipo equivocado');
}

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 3 · LO QUE NO PUEDE CAMBIAR
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · lo que no puede cambiar ──');

// Una baja deliberada no resucita (v477/v478).
{
    const r = sincroniza(RAIZ_ALEVIN, [P('alevin', 'C', { isAuthorized: false, status: 'removed' })]);
    ok('3a · ⚠️ una plaza dada de BAJA no resucita al entrar',
       r.allRoles[0].status === 'removed' && r.allRoles[0].isAuthorized === false,
       JSON.stringify(r.allRoles[0]));
}

// 🔴🔴🔴 EL AGUJERO QUE ABRIÓ COMPARAR POR PLAZA, y que el `find` por rol+club
// tapaba sin querer: si la entrada revocada NO casa exactamente con la raíz, el
// bloque la daba por ausente y CREABA una plaza nueva y activa. La baja se
// deshacía por la puerta de al lado. Lo cazó test_baja_no_resucita_al_entrar.js;
// aquí queda como aserción propia para no depender de un guard ajeno.
{
    const raizSinCategoria = { isAuthorized: true, role: 'user', clubId: CLUB };
    const r = sincroniza(raizSinCategoria, [
        P('Alevín', 'C', { isAuthorized: false, status: 'removed' }),
    ]);
    ok('3a1 · 🔴🔴🔴 raíz SIN categoría + plaza revocada CON categoría: no se crea nada',
       r.allRoles.length === 1 && r.needsRoleSync === false,
       'creaba una plaza activa nueva y resucitaba la baja: ' + JSON.stringify(r.allRoles));
    ok('3a2 · y la revocada sigue intacta',
       r.allRoles[0].status === 'removed' && r.allRoles[0].isAuthorized === false);
}

// ⚠️ PERO SÓLO BLOQUEA CUANDO LA RAÍZ NO PUEDE DISTINGUIR. Con dos equipos
// distinguibles, tener uno de baja no puede impedir crear el otro.
{
    const r = sincroniza(RAIZ_ALEVIN, [
        P('regional', 'A', { isAuthorized: false, status: 'removed' }),
    ]);
    ok('3a3 · ⚠️ con el Regional A de BAJA, el Alevín C de la raíz SÍ se crea',
       r.allRoles.length === 2 &&
       r.allRoles.some(x => x.category === 'alevin' && x.isAuthorized === true),
       JSON.stringify(r.allRoles));
    ok('3a4 · y el Regional A sigue de baja',
       r.allRoles.find(x => x.category === 'regional').status === 'removed');
}

// Para un rol que no ocupa equipo, la plaza es sólo rol+club.
{
    const raizDir = { isAuthorized: true, role: 'director', clubId: CLUB, clubName: 'CD DÍA' };
    const r = sincroniza(raizDir, [{ role: 'director', clubId: CLUB, isAuthorized: false, status: 'pending' }]);
    ok('3b · un director casa por rol+club (no ocupa equipo) y se activa',
       r.allRoles.length === 1 && r.allRoles[0].isAuthorized === true);
}
{
    const raizDir = { isAuthorized: true, role: 'director', clubId: CLUB };
    const r = sincroniza(raizDir, []);
    ok('3c · y si no está, se crea SIN categoría (la categoría no le pertenece)',
       r.allRoles.length === 1 && !r.allRoles[0].category,
       JSON.stringify(r.allRoles));
}

// v560 · la plaza creada desde la raíz conserva su categoría.
{
    const r = sincroniza(RAIZ_ALEVIN, []);
    ok('3d · ⚠️ v560 sigue en pie: la plaza creada lleva la categoría de la raíz',
       r.allRoles.length === 1 && r.allRoles[0].category === 'alevin' && r.allRoles[0].subcategory === 'C',
       'un entrenador sin categoría es un entrenador SIN EQUIPO');
}

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

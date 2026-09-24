// ─────────────────────────────────────────────────────────────────────────
//  test_solicitud_no_resucita_plaza.js  ·  🔴 v759 (2026-09-24)
//
//  INCIDENTE: v758 corrigió un ReferenceError de auth.js (`_rolRevocado` fuera
//  de alcance desde v564). Ese error abortaba, sin que nadie lo supiera, el
//  bloque «Auto-activar roles aprobados por el SA» en su primera vuelta. Al
//  corregirlo, el bloque volvió a correr ENTERO, y su rama «añadir la plaza si
//  no existe» RECREÓ en producción dos plazas que el administrador de un club
//  había quitado (Juvenil C y Regional A), porque sus solicitudes siguen en
//  `sa_approved` para siempre. Testeo escribe en la BD de producción: bastó
//  con que el autor entrara en testeo.
//
//  🔑 POR QUÉ LA RAMA SOBRA: el SuperAdmin escribe la plaza en el usuario ANTES
//  de marcar la solicitud como aprobada (extras.js). Una solicitud aprobada
//  cuya plaza falta sólo puede significar que la plaza se QUITÓ después. La
//  defensa `_rolRevocado` no lo cubre: sólo ve plazas que siguen en la lista
//  con status 'removed', no las que se borraron enteras.
//
//  Aquí se EJECUTA el bloque real de auth.js (no se lee su forma) con los
//  datos del caso, sintéticos pero con la misma forma que los de producción.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'js', 'services', 'auth.js'), 'utf8');
const UTILS = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 500)); }
};

function trozo(src, cabecera, cierre) {
    const i = src.indexOf(cabecera);
    if (i < 0) throw new Error('No se encontró ' + cabecera);
    const j = src.indexOf(cierre, i);
    return src.slice(i, j + cierre.length);
}
// El forEach real, cerrado por conteo de llaves.
function bloqueAutoActivar() {
    const ini = AUTH.indexOf('approvedReqs.forEach(reqDoc => {');
    if (ini < 0) throw new Error('No se encuentra el forEach de auto-activación');
    let prof = 0, i = AUTH.indexOf('{', ini);
    for (; i < AUTH.length; i++) {
        if (AUTH[i] === '{') prof++;
        else if (AUTH[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return AUTH.slice(ini, AUTH.indexOf(';', i) + 1);
}
const BLOQUE = bloqueAutoActivar();
const DECL = trozo(AUTH, 'const _rolRevocado =', ';');
const CLAVE = trozo(AUTH, 'const _roleKey =', ';');
const ACENTO = trozo(UTILS, 'function _cronosNoEsAcento(', '\n}\n');
const SLUG = ACENTO + '\n' + trozo(UTILS, 'function cronosTeamSlug(', '\n}\n');
const PLAZA = trozo(UTILS, "if (typeof window.cronosMismaPlaza !== 'function') {", '\n}\n');

function corre(allRoles, solicitudes) {
    const sb = { String, Object, Array, JSON, console: { log() {}, warn() {} } };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SLUG + '\nwindow.cronosTeamSlug = cronosTeamSlug;\n' + PLAZA, sb);
    sb.updatedAllRoles = JSON.parse(JSON.stringify(allRoles));
    sb.approvedReqs = { forEach: (fn) => solicitudes.forEach((s) => fn({ data: () => s })) };
    vm.runInContext(DECL + '\n' + CLAVE + '\nvar _verifiedRoleKeys = new Set(); var needsUpdate = false;\n' +
        BLOQUE + '\n_out = { roles: updatedAllRoles, needsUpdate: needsUpdate, claves: [..._verifiedRoleKeys] };', sb);
    return sb._out;
}

const CLUB = 'club_x';
const plaza = (role, cat, sub, extra) => Object.assign({ role, clubId: CLUB, clubName: 'CLUB X',
    category: cat || null, subcategory: sub || null, isAuthorized: true, status: 'active' }, extra || {});
const sol = (role, cat, sub) => ({ status: 'sa_approved', requestedRole: role, clubId: CLUB, clubName: 'CLUB X',
    requestedCategory: cat || null, requestedSubcategory: sub || null });

console.log('\n══ 🔴 Una solicitud aprobada NO resucita una plaza quitada ══');

console.log('\n1) El caso de producción: dos plazas quitadas con su solicitud aún aprobada');
{
    const antes = [plaza('club_admin'), plaza('director'), plaza('coordinator'),
                   plaza('parent', 'alevin', 'C'), plaza('user', 'alevin', 'C'), plaza('user', 'regional', 'B')];
    // Mismo orden que devuelve Firestore (por id): coordinador el primero.
    const reqs = [sol('coordinator'), sol('director'), sol('parent', 'alevin', 'C'), sol('user', 'alevin', 'C'),
                  sol('user', 'alevin', 'C'), sol('user', 'juvenil', 'C'), sol('user', 'regional', 'A'), sol('user', 'regional', 'B')];
    let r, error = null;
    try { r = corre(antes, reqs); } catch (e) { error = e.message; }
    ok('1a · el bloque se ejecuta sin lanzar (el ReferenceError de v564 sigue corregido)', !error, error);
    if (r) {
        ok('1b · 🔑🔑 NO recrea Juvenil C ni Regional A', r.roles.length === 6,
           r.roles.map((x) => x.role + '/' + x.category + '/' + x.subcategory));
        ok('1c · y no marca nada para escribir', r.needsUpdate === false);
    }
}

console.log('\n2) Lo que el bloque SÍ debe seguir haciendo');
{
    const r = corre([plaza('user', 'regional', 'B', { isAuthorized: false, status: 'pending_sa' })],
                    [sol('user', 'regional', 'B')]);
    ok('2a · activa una plaza PENDIENTE que ya existe', r.roles[0].isAuthorized === true && r.roles[0].status === 'active', r.roles[0]);
    ok('2b · y la marca para escribir', r.needsUpdate === true);

    const r2 = corre([plaza('user', 'regional', 'B', { isAuthorized: false, status: 'removed' })],
                     [sol('user', 'regional', 'B')]);
    ok('2c · NO reactiva una plaza dada de BAJA (status removed)', r2.roles[0].status === 'removed' && r2.needsUpdate === false, r2.roles[0]);

    const r3 = corre([plaza('user', 'regional', 'B')], [sol('user', 'regional', 'B')]);
    ok('2d · verifica la clave de una plaza activa respaldada por solicitud', r3.claves.indexOf('user|' + CLUB) !== -1, r3.claves);
}

console.log('\n3) Ente individual: la solicitud sin clubId no fabrica una plaza gemela');
{
    const ENTE = 'individual_x';
    const r = corre([{ role: 'individual', clubId: ENTE, individualEntityId: ENTE, category: 'regional', subcategory: 'A',
                       isAuthorized: true, status: 'active' }],
                    [{ status: 'sa_approved', requestedRole: 'individual', individualOwnerId: ENTE }]);
    ok('3a · 🔑 no añade una plaza «individual» sin categoría', r.roles.length === 1, r.roles);
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────
// test_superadmin_ve_lo_mismo_que_el_club.js · el Panel del SuperAdmin refleja
// la MISMA realidad que el Panel de Administrador de Club (v563)
//
// Reporte del autor (comparativa de capturas 9094 y 9095): en el Panel de
// Administrador de Club los entrenadores y sus categorías se ven perfectamente
// guardados; en el Panel de SuperAdmin, el MISMO club sale con las categorías
// vacías. Él mismo descartó el borrado comparando los dos paneles: los datos
// están: lo que fallaba era la LECTURA.
//
// 🔑🔑🔑 LA CAUSA: `js/admin/superadmin/clubs-tab.js` repartía cada usuario a su
// club mirando SÓLO `u.clubId` —la raíz del documento—:
//
//      if (u.clubId && clubs[u.clubId]) clubs[u.clubId].users.push(u);
//      else orphans.push(u);
//
// mientras que el panel del club NO usa la raíz para esto: recorre `allRoles`
// (`r.clubId === clubId || !r.clubId`). Con la raíz vacía, obsoleta o apuntando
// a otro club, el SuperAdmin mandaba a la persona a "Sin club asignado" aunque
// sus plazas dijeran a qué club pertenece. Dos vistas del mismo dato con dos
// criterios distintos tenían que contradecirse.
//
// ⚠️ NO ERA SÓLO EL ÁRBOL: `c.users` alimenta `vis`, y de ahí salen los
// CONTADORES DE PLAZAS. Un entrenador invisible tampoco se contaba.
//
// LO QUE FIJA ESTE GUARD:
//   A · el reparto mira la raíz Y las plazas;
//   B · el multiequipo entra UNA vez por club, y el multiclub en todos;
//   C · equivalencia con el criterio del panel del club;
//   D · quien no tiene ningún destino válido sigue siendo huérfano.
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

const TAB = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'clubs-tab.js'), 'utf8');

console.log('── el SuperAdmin ve lo mismo que el club (v563) ──\n');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 0 · LA LÍNEA QUE CAUSÓ EL FALLO NO PUEDE VOLVER
// ═══════════════════════════════════════════════════════════════════════
console.log('── PARTE 0 · el reparto sólo-por-la-raíz no vuelve ──');

ok('0a · 🔑 ya no se reparte con `if (u.clubId && clubs[u.clubId]) ... else orphans`',
   !/if \(u\.clubId && clubs\[u\.clubId\]\) clubs\[u\.clubId\]\.users\.push\(u\);\s*\n\s*else orphans\.push\(u\);/.test(TAB),
   'ese if/else mandaba a "Sin club asignado" a quien tuviera la raíz desfasada');

ok('0b · el reparto consulta `allRoles`, no sólo la raíz',
   /_destinos/.test(TAB) && /\(u\.allRoles \|\| \[\]\)\.forEach/.test(TAB));

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 1 · EL REPARTO REAL, EJECUTADO
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · el reparto, ejecutado tal cual está en el fichero ──');

const iniBloque = TAB.indexOf('const _destinos = new Set();');
const finMarca  = '_destinos.forEach(cid => clubs[cid].users.push(u));';
const finBloque = TAB.indexOf(finMarca, iniBloque);
if (iniBloque < 0 || finBloque < 0) {
    console.log('FAIL · no se encontró el bloque de reparto en clubs-tab.js');
    process.exit(1);
}
const BLOQUE = TAB.slice(iniBloque, finBloque + finMarca.length);

// Reparte un usuario sobre un mapa de clubes, usando EL CÓDIGO REAL.
function reparte(u, clubIds) {
    const clubs = {};
    (clubIds || []).forEach(id => { clubs[id] = { id, users: [] }; });
    const orphans = [];
    const sb = { clubs, orphans, u, Set, Array };
    vm.createContext(sb);
    vm.runInContext('(function(){\n' + BLOQUE + '\n})();', sb);
    const destinos = Object.keys(clubs).filter(id => clubs[id].users.length > 0);
    return { destinos, huerfano: orphans.length > 0, clubs };
}

const CLUB = 'club_mqvr9m11_g9kj';
const OTRO = 'club_otro_xyz';

// 🔑 EL CASO DEL REPORTE: entrenadora con DOS equipos, raíz sin clubId.
const ELLA = {
    id: 'GkycFVeqFsWD9JODEjjE3JSMw2v1', email: 'arinagazone@gmail.com',
    role: 'user', clubId: null,
    allRoles: [
        { role: 'user', clubId: CLUB, category: 'alevin',   subcategory: 'C', isAuthorized: true, status: 'active' },
        { role: 'user', clubId: CLUB, category: 'regional', subcategory: 'A', isAuthorized: true, status: 'active' },
    ],
};
const r1 = reparte(ELLA, [CLUB, OTRO]);
ok('1a · 🔑🔑🔑 con la raíz VACÍA pero plazas en el club, YA NO es huérfana',
   !r1.huerfano && r1.destinos.length === 1 && r1.destinos[0] === CLUB,
   JSON.stringify(r1.destinos) + ' huerfano=' + r1.huerfano);

ok('1b · ⚠️ y entra UNA sola vez, aunque tenga DOS plazas en ese club',
   r1.clubs[CLUB].users.length === 1,
   'duplicarla inflaría los contadores de plazas: ' + r1.clubs[CLUB].users.length);

// Raíz obsoleta apuntando a un club que ya no existe.
const CON_RAIZ_MUERTA = {
    id: 'u2', role: 'user', clubId: 'club_borrado_hace_meses',
    allRoles: [{ role: 'user', clubId: CLUB, category: 'cadete', subcategory: 'B', isAuthorized: true }],
};
ok('1c · raíz apuntando a un club inexistente: manda la PLAZA',
   reparte(CON_RAIZ_MUERTA, [CLUB, OTRO]).destinos.join() === CLUB);

// Multiclub: aparece en LOS DOS, no en el primero que gane un if/else.
const MULTICLUB = {
    id: 'u3', role: 'user', clubId: CLUB,
    allRoles: [
        { role: 'user',      clubId: CLUB, category: 'alevin', subcategory: 'A', isAuthorized: true },
        { role: 'coordinator', clubId: OTRO, isAuthorized: true },
    ],
};
const r3 = reparte(MULTICLUB, [CLUB, OTRO]);
ok('1d · con roles en DOS clubes aparece en los dos',
   r3.destinos.length === 2 && r3.destinos.includes(CLUB) && r3.destinos.includes(OTRO),
   JSON.stringify(r3.destinos));

// La raíz sigue valiendo cuando es lo único que hay (usuario recién aprobado).
const SOLO_RAIZ = { id: 'u4', role: 'user', clubId: CLUB, allRoles: [] };
ok('1e · sin allRoles, la raíz sigue bastando (no se rompe el caso normal)',
   reparte(SOLO_RAIZ, [CLUB]).destinos.join() === CLUB);

// ⚠️ Sin ningún destino válido sigue siendo huérfano: ese apartado existe.
const HUERFANO = { id: 'u5', role: 'user', clubId: null, allRoles: [{ role: 'user', isAuthorized: true }] };
const r5 = reparte(HUERFANO, [CLUB]);
ok('1f · ⚠️ sin club ni en la raíz ni en las plazas, SIGUE siendo huérfano',
   r5.huerfano && r5.destinos.length === 0,
   'el apartado "Sin club asignado" tiene que seguir enseñando estos casos');

// Una plaza sin clubId no se puede atribuir a un club concreto por sí sola.
const PLAZA_SIN_CLUB = { id: 'u6', role: 'user', clubId: CLUB,
                         allRoles: [{ role: 'user', clubId: null, category: 'alevin', isAuthorized: true }] };
ok('1g · una plaza sin clubId se atribuye por la raíz, no a un club al azar',
   reparte(PLAZA_SIN_CLUB, [CLUB, OTRO]).destinos.join() === CLUB);

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 2 · EQUIVALENCIA CON EL PANEL DEL CLUB
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · equivalencia con el criterio del panel del club ──');

// El criterio del panel del club (js/admin/club/panel.js): la pertenencia sale
// de allRoles, con respaldo en la raíz. Se compara sobre plazas que llevan
// clubId explícito, que es donde los dos paneles TIENEN que coincidir.
const criterioClub = (u, clubId) =>
    String(u.clubId || '') === clubId ||
    (u.allRoles || []).some(r => String(r.clubId || '') === clubId);

const POBLACION = [ELLA, CON_RAIZ_MUERTA, MULTICLUB, SOLO_RAIZ, HUERFANO, PLAZA_SIN_CLUB];
let discrepancias = [];
for (const u of POBLACION) {
    for (const cid of [CLUB, OTRO]) {
        const veSA    = reparte(u, [CLUB, OTRO]).destinos.includes(cid);
        const veClub  = criterioClub(u, cid);
        if (veSA !== veClub) discrepancias.push(u.id + '@' + cid + ' SA=' + veSA + ' club=' + veClub);
    }
}
ok('2a · 🔑🔑 los dos paneles ven EXACTAMENTE la misma pertenencia',
   discrepancias.length === 0, discrepancias.join(' · '));

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 3 · LOS CONTADORES DE PLAZAS TAMBIÉN SE ARREGLAN
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · el contador de plazas deja de mentir ──');

ok('3a · ⚠️ `vis` (y con él los contadores) sale de `c.users`',
   /const vis\s*=\s*c\.users\.filter/.test(TAB),
   'por eso un entrenador mal repartido también descuadraba las plazas ocupadas');

ok('3b · los contadores siguen contando PLAZAS con cronosPlazasOcupadas',
   /cronosPlazasOcupadas\(vis, role, c\.id\)/.test(TAB));

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 4 · EL ÁRBOL SIGUE EXPANDIENDO POR PLAZA
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · una fila por PLAZA, no por persona ──');

ok('4a · `_expandClubUsers` recorre `allRoles` y emite una entrada por plaza',
   /roles\.forEach\(r =>/.test(TAB) && /_activeRoleData/.test(TAB));

ok('4b · una plaza sin categoría hereda la de la raíz (para que no caiga en "sin categoría")',
   /\(r\.category == null && r\.subcategory == null\)/.test(TAB));

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

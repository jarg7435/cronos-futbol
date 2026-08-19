// ════════════════════════════════════════════════════════════════════════
//  test_plazas_fantasma_y_sincronia_paneles.js
//  "9 ENTRENADORES DONDE HAY 7" Y EL BENJAMÍN C QUE DESAPARECÍA — v582
// ════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt + capturas 9263/9264, sobre v581): los
//  dos paneles NO coinciden. El del Club dice **11/10 · Límite alcanzado** y
//  el del SuperAdmin **9/10**, cuando CD DÍA tiene **7 entrenadores**. Además
//  "el entrenador del Benjamín C ha desaparecido de su sitio".
//
//  🔑 NO SE DIAGNOSTICÓ A OJO: se midieron los documentos reales por REST
//  (2026-08-19). CD DÍA tiene 5 documentos de usuario y:
//
//    · 7 plazas `role:'user'` CON categoría → los 7 entrenadores de verdad;
//    · 4 entradas más, una por entrenador, todas idénticas:
//        { role:'user', clubId:'club_mqvr9m11_g9kj',
//          category:null, subcategory:null, isAuthorized:true, status:'active' }
//
//  7 + 4 = 11. El contador no se equivocaba: contaba fielmente unas entradas
//  que no son el equipo de nadie. Y `brunoromar2012@gmail.com` —que lleva el
//  **benjamin/C**— tiene en la RAÍZ `role:'individual'`, así que el panel del
//  SuperAdmin lo descartaba entero: sus 2 entradas son, al carácter, el 11
//  contra 9, y su ausencia es el Benjamín vacío.
//
//  TRES DEFECTOS, TRES SITIOS:
//   A · auth.js FABRICABA esas entradas en cada inicio de sesión. La raíz de
//       esos cuatro no tiene categoría, y desde v564 —que comparó POR PLAZA, y
//       bien— esa raíz ya no casa con ninguna plaza real, así que el bloque
//       concluía que faltaba un rol y lo creaba. Por eso "ya se había
//       arreglado" y volvía: se corregía el síntoma, no quien lo escribía.
//   B · clubs-tab.js descartaba por la RAÍZ a quien tiene plazas en un club
//       real. Es el defecto de v563 un paso más arriba: allí se arregló el
//       reparto, pero el filtro que decide quién entra al reparto siguió
//       mirando la raíz, y ninguna corrección del reparto alcanza a quien ya
//       se ha descartado.
//   C · cronosPlazasOcupadas sumaba UNA POR ENTRADA en vez de contar plazas
//       DISTINTAS, así que cualquier resto inflaba la cuota — hasta cerrarle
//       el club al autor con "Límite alcanzado".
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const AUTH  = fs.readFileSync(path.join(ROOT, 'js/services/auth.js'), 'utf8');
const UTILS = fs.readFileSync(path.join(ROOT, 'js/core/utils.js'), 'utf8');
const TREE  = fs.readFileSync(path.join(ROOT, 'js/admin/shared/category-tree.js'), 'utf8');
const CLUBS = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/clubs-tab.js'), 'utf8');

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

// ── La función REAL de recuento, con su normalizador real ──────────────
const sbU = { console: { log() {}, warn() {} }, String, Set, Map, Array, Object, Number };
sbU.window = sbU;
vm.createContext(sbU);
vm.runInContext(trozo(TREE, 'window.ctNormCat = function (raw) {', '\n    };'), sbU);
vm.runInContext(trozo(TREE, 'window.ctNormSubcat = function (raw) {', '\n    };'), sbU);
vm.runInContext(trozo(UTILS, '    window.cronosPlazasOcupadas = function (users, role, clubId) {', '\n    };'), sbU);
const plazas = sbU.window.cronosPlazasOcupadas;

const CID = 'club_mqvr9m11_g9kj';
const P = (cat, sub) => ({ role: 'user', clubId: CID, category: cat, subcategory: sub,
                           isAuthorized: true, status: 'active' });
const VACIA = () => ({ role: 'user', clubId: CID, category: null, subcategory: null,
                       isAuthorized: true, status: 'active' });

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── C · el recuento: los datos REALES de CD DÍA dan 7, no 11 ──');
// ═══════════════════════════════════════════════════════════════════════
{
    // Copia literal de lo medido por REST el 2026-08-19.
    const CD_DIA = [
        { email: 'jose_arg027@hotmail.com', status: 'active', role: 'user', allRoles: [
            P('cadete', 'B'), P('prebenjamin', 'A'), VACIA() ] },
        { email: 'arinagazone@gmail.com', status: 'active', role: 'club_admin', allRoles: [
            { role: 'club_admin',  clubId: CID, isAuthorized: true, status: 'active' },
            { role: 'director',    clubId: CID, isAuthorized: true, status: 'active' },
            { role: 'coordinator', clubId: CID, isAuthorized: true, status: 'active' },
            { role: 'parent', clubId: CID, category: 'alevin', subcategory: 'C', isAuthorized: true, status: 'active' },
            P('alevin', 'C'), P('regional', 'A') ] },
        { email: 'jarg7435@icloud.com', status: 'active', role: 'user', allRoles: [
            P('infantil', 'A'), VACIA() ] },
        { email: 'brunoromar2012@gmail.com', status: 'active', role: 'individual', allRoles: [
            P('benjamin', 'C'), VACIA() ] },
        { email: 'damasorv@gmail.com', status: 'active', role: 'user', allRoles: [
            P('juvenil', 'B'), VACIA() ] },
    ];
    const n = plazas(CD_DIA, 'user', CID);
    ok('C1 · 🔑🔑🔑 CD DÍA cuenta 7 entrenadores (antes 11, y el club se quedaba sin cupo)',
       n === 7, n);
    ok('C2 · y los roles sin equipo no se mueven: 1 director, 1 coordinador, 1 padre',
       plazas(CD_DIA, 'director', CID) === 1 &&
       plazas(CD_DIA, 'coordinator', CID) === 1 &&
       plazas(CD_DIA, 'parent', CID) === 1,
       [plazas(CD_DIA, 'director', CID), plazas(CD_DIA, 'coordinator', CID), plazas(CD_DIA, 'parent', CID)]);
}
{
    // ⚠️ LO QUE NO PUEDE ROMPERSE: v537/v553 · dos equipos son DOS plazas.
    const dosEquipos = [{ email: 'a@b.c', status: 'active', allRoles: [P('prebenjamin', 'A'), P('cadete', 'B')] }];
    ok('C3 · ⚠️ un entrenador con F7 y F11 sigue ocupando DOS plazas (v537/v553)',
       plazas(dosEquipos, 'user', CID) === 2, plazas(dosEquipos, 'user', CID));
}
{
    // 🔑 Quien SÓLO tiene la entrada sin categoría es alguien real esperando
    //    asignación: ocupa plaza y sale en el bloque "sin categoría".
    const soloVacia = [{ email: 'a@b.c', status: 'active', allRoles: [VACIA()] }];
    ok('C4 · 🔑 sin categoría Y sin ningún equipo SÍ cuenta: es alguien real sin asignar',
       plazas(soloVacia, 'user', CID) === 1, plazas(soloVacia, 'user', CID));
}
{
    const repe = [{ email: 'a@b.c', status: 'active', allRoles: [P('Alevín', 'A'), P('alevin', 'a'), P('f7_alevin_a', null)] }];
    ok('C5 · ⚠️ la MISMA plaza en tres grafías es UNA plaza (se normaliza)',
       plazas(repe, 'user', CID) === 1, plazas(repe, 'user', CID));
}
{
    const revocado = [{ email: 'a@b.c', status: 'active', allRoles: [
        P('alevin', 'A'),
        { role: 'user', clubId: CID, category: 'cadete', subcategory: 'B', isAuthorized: false, status: 'removed' } ] }];
    ok('C6 · una plaza revocada no ocupa sitio (no se ha perdido la regla de v553)',
       plazas(revocado, 'user', CID) === 1, plazas(revocado, 'user', CID));
}
{
    const antiguo = [{ email: 'a@b.c', status: 'active', role: 'user', isAuthorized: true }];
    ok('C7 · el perfil antiguo SIN allRoles sigue contando su rol de raíz',
       plazas(antiguo, 'user', CID) === 1, plazas(antiguo, 'user', CID));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── A · la causa raíz: auth.js deja de fabricar plazas vacías ──');
// ═══════════════════════════════════════════════════════════════════════
// Se ejecuta el BLOQUE REAL de sincronización raíz↔allRoles, tal cual sale del
// fichero (misma técnica que test_baja_no_resucita_al_entrar.js): no se
// comprueba que exista un `if`, se comprueba el RESULTADO.
function bloqueSync() {
    const ini = AUTH.indexOf('const _rolRevocado =');
    if (ini === -1) throw new Error('No se encuentra _rolRevocado en auth.js');
    const marca = AUTH.indexOf('if (data.isAuthorized && data.role) {', ini);
    if (marca === -1) throw new Error('No se encuentra el bloque de sincronizacion');
    let prof = 0, i = marca;
    for (; i < AUTH.length; i++) {
        if (AUTH[i] === '{') prof++;
        else if (AUTH[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return AUTH.slice(ini, i);
}
const BLOQUE = bloqueSync();
function correrSync({ data, allRoles }) {
    const escrituras = [];
    const sandbox = {
        data,
        allRoles: allRoles.map(r => Object.assign({}, r)),
        ref: { __ref: 'users/u1' },
        fa: { setDoc: (r, d) => { escrituras.push(d); return Promise.resolve(); } },
        console: { log: () => {}, warn: () => {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(BLOQUE, sandbox);
    return { allRoles: sandbox.allRoles, escrituras };
}
{
    // EL CASO EXACTO DE JOSÉ, medido: raíz sin categoría, dos equipos de verdad.
    const r = correrSync({
        data: { isAuthorized: true, role: 'user', clubId: CID },   // category: ausente
        allRoles: [P('cadete', 'B'), P('prebenjamin', 'A')],
    });
    ok('A1 · 🔑🔑🔑 una raíz SIN categoría ya no inventa una plaza a quien tiene equipo',
       r.allRoles.length === 2, r.allRoles);
    ok('A2 · y no se escribe nada en la base (no hay nada que sincronizar)',
       r.escrituras.length === 0, r.escrituras);
    ok('A3 · sus dos equipos siguen intactos',
       r.allRoles[0].category === 'cadete' && r.allRoles[1].category === 'prebenjamin');
}
{
    // ⚠️ EL CASO LEGÍTIMO NO SE TOCA: sin ninguna plaza, la raíz sí estrena la
    //    suya. Es lo que hace visible a un entrenador recién aprobado.
    const r = correrSync({
        data: { isAuthorized: true, role: 'user', clubId: CID },
        allRoles: [],
    });
    ok('A4 · ⚠️ quien no tiene NINGUNA plaza sigue estrenando la suya desde la raíz',
       r.allRoles.length === 1 && r.allRoles[0].isAuthorized === true, r.allRoles);
}
{
    // Y si la raíz SÍ trae categoría, describe un equipo de verdad: se crea.
    const r = correrSync({
        data: { isAuthorized: true, role: 'user', clubId: CID, category: 'regional', subcategory: 'A' },
        allRoles: [P('cadete', 'B')],
    });
    ok('A5 · 🔑 una raíz CON categoría sí describe un equipo: su plaza se crea',
       r.allRoles.length === 2 && r.allRoles[1].category === 'regional', r.allRoles);
}
{
    // Un rol que no lleva equipo (director) no entra en la regla nueva.
    const r = correrSync({
        data: { isAuthorized: true, role: 'director', clubId: CID },
        allRoles: [P('cadete', 'B')],
    });
    ok('A6 · ⚠️ a un DIRECTOR la categoría no le pertenece: su rol se sigue creando',
       r.allRoles.length === 2 && r.allRoles[1].role === 'director', r.allRoles);
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── B · el reparto del SuperAdmin no descarta por la raíz ──');
// ═══════════════════════════════════════════════════════════════════════
{
    // Se reproduce el filtro tal como está escrito en el fichero, con los datos
    // reales de brunoromar2012 (raíz 'individual', plazas en un club de verdad).
    const clubs = { [CID]: { id: CID, users: [] } };
    const indiv = new Set(['club_ente_x']);
    const filtro = (u) => {
        const isIndivUser = u.role === 'individual' || u.role === 'admin_individual' || u.role === 'parent_individual'
            || !!(u.individualEntityId || u.individualOwnerId || u.isIndividual)
            || (u.clubId && indiv.has(u.clubId))
            || (u.allRoles || []).some(r => ['individual','admin_individual','parent_individual','entrenador_individual','padre_individual'].includes(r.role));
        const esClubReal = (cid) => !!(cid && clubs[cid]);
        const tienePlaza = esClubReal(u.clubId) ||
            (u.allRoles || []).some(r => r && (esClubReal(r.clubId) || esClubReal(r.requestedClubId)));
        return !(isIndivUser && !tienePlaza);   // true = entra al reparto
    };
    const bruno = { email: 'brunoromar2012@gmail.com', role: 'individual', clubId: CID,
                    allRoles: [P('benjamin', 'C'), VACIA()] };
    ok('B1 · 🔑🔑🔑 quien lleva el Benjamín C entra al reparto aunque su raíz diga "individual"',
       filtro(bruno) === true);

    const enteDeVerdad = { email: 'x@ente.es', role: 'individual', clubId: 'club_ente_x',
                           allRoles: [{ role: 'entrenador_individual', clubId: 'club_ente_x' }] };
    ok('B2 · ⚠️ y un usuario de ente individual DE VERDAD sigue fuera de la pestaña de Clubes',
       filtro(enteDeVerdad) === false);

    const sinNada = { email: 'y@ente.es', role: 'parent_individual', individualOwnerId: 'ente1', allRoles: [] };
    ok('B3 · igual que quien no tiene ninguna plaza en un club real',
       filtro(sinNada) === false);
}
{
    // El fichero tiene que llevar la regla escrita, no sólo pasarla de casualidad.
    const i = CLUBS.indexOf('const isIndivUser');
    // ⚠️ La ventana se MIDE (v581 ya dio un rojo falso por quedarse corta).
    const cuerpo = CLUBS.slice(i, i + 4000);
    ok('B4 · el descarte está condicionado a no tener plaza en un club real',
       /if \(isIndivUser && !_tienePlazaEnClubReal\) return;/.test(cuerpo));
    ok('B5 · ⚠️ y "club real" se resuelve contra `clubs`, que excluye los entes individuales',
       /_esClubReal\s*=\s*\(cid\)\s*=>\s*!!\(cid && clubs\[cid\]\)/.test(cuerpo));
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos === 0) console.log('✅ Los dos paneles cuentan lo mismo: 7 entrenadores, con su Benjamín C');
else console.log('❌ ' + fallos + ' aserción(es) en rojo');
process.exit(fallos === 0 ? 0 : 1);

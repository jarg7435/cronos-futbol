// ═══════════════════════════════════════════════════════════════════════════
//  EL ENTRENADOR ARRANCA EN SU EQUIPO, NO EN LA PLAZA DE AL LADO — v680
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt + capturas 10117-10121, 2026-09-07):
//  arinagazone@gmail.com es **Familiar en Alevín C** y **Entrenador en
//  Regional B** en CD DÍA. Al entrar por la tarjeta "Entrenador" el panel se
//  abría en **Alevín C**. Su consola lo dice todo en dos líneas seguidas:
//
//      [auth] entrenador category: alevin subcategory: C   ← role-launch.js
//      [v261] Modalidades permitidas: f11                  ← setup-modal.js
//
//  La categoría de un equipo y la modalidad de OTRO, en la misma pantalla, con
//  "Sin plantillas en esta modalidad" debajo.
//
//  🔑🔑 LA CAUSA ERA UNA ASIMETRÍA, NO UN DESCUIDO SUELTO. Las otras dos
//  superficies del arranque filtran las plazas —`showRoleSelection` sólo pinta
//  tarjetas de plazas VIVAS, y `cronosEquiposDeEntrenador` (utils.js, la lista
//  única desde v598) exige además categoría—. El `find` de `_launchWithRole`
//  no filtraba nada: cogía la PRIMERA entrada de `allRoles` cuyo rol casara,
//  aunque estuviera pendiente, revocada o vacía. Así el panel podía llenarse
//  con una plaza que su propio selector "MIS EQUIPOS" no ofrece.
//
//  ⚠️ ESTE GUARD **EJECUTA** `_launchWithRole` con el utils.js REAL cargado en
//  el mismo contexto — no lee el fichero fuente ni reimplementa el criterio.
//  Es la lección de v620 y de la ronda de v659-v665: un guard que reimplementa
//  lo que vigila da verde sobre el defecto.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}

const CLUB = 'club_cd_dia';

// ── Arnés: un contexto con el utils.js REAL y el role-launch.js REAL ───────
//  role-launch.js es un módulo ES: para el vm se le quita la palabra `export`
//  y se reescribe el `import()` dinámico del SDK. Es una transformación del
//  ARNÉS (la misma que hace test_role_launch_module.js), no del código.
function arrancar(me, { equipoElegido = '' } = {}) {
    const els = {}, logs = [];
    const mkEl = (id) => ({
        id, style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', attrs: {},
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
        addEventListener() {}, setAttribute(n, v) { this.attrs[n] = String(v); },
        getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
        removeAttribute(n) { delete this.attrs[n]; },
        appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
    });
    const get = (id) => (els[id] = els[id] || mkEl(id));

    const almacen = { cronos_equipo_activo: equipoElegido || '' };
    const sb = {
        _cronosCurrentUser: me,
        _cronos_auth: { db: {}, auth: {} },
        document: { getElementById: get, body: mkEl('body'), createElement: () => mkEl('new'),
                    querySelector: () => null, querySelectorAll: () => [] },
        console: { log: (...a) => logs.push(a.join(' ')),
                   warn: (...a) => logs.push(a.join(' ')),
                   error: (...a) => logs.push(a.join(' ')) },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON,
        parseInt, parseFloat, isNaN, RegExp, Error, Intl,
        setTimeout: (fn) => { try { fn(); } catch (e) { /* el panel no existe en el arnés */ } return 0; },
        clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
        navigator: { userAgent: 'node' },
        localStorage:   { getItem: () => null, setItem() {}, removeItem() {} },
        sessionStorage: { getItem: (k) => (k in almacen ? almacen[k] : null),
                          setItem: (k, v) => { almacen[k] = String(v); },
                          removeItem: (k) => { delete almacen[k]; } },
        showToast: () => {}, escapeHtml: (s) => String(s == null ? '' : s), init: () => {},
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.createContext(sb);

    // 1) utils.js REAL: de aquí salen cronosEquiposDeEntrenador, cronosTeamId,
    //    _cronosMatchModality y el par cronosEquipoElegido/cronosFijarEquipoElegido.
    try { vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8'), sb); }
    catch (e) { console.log('  (aviso al cargar utils.js: ' + e.message + ')'); }
    // 1b) category-tree.js REAL: de aquí sale `ctNormCat`, la normalización que
    //     v627 aplica a la categoría COMBINADA del ente ('regional_a').
    try { vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/admin/shared/category-tree.js'), 'utf8'), sb); }
    catch (e) { console.log('  (aviso al cargar category-tree.js: ' + e.message + ')'); }

    // 2) role-launch.js REAL, desde enterApp hasta el final.
    const src = fs.readFileSync(path.join(RAIZ, 'js/services/auth/role-launch.js'), 'utf8');
    const i = src.search(/export\s+(?:async\s+)?function\s+enterApp\(\)/);
    if (i === -1) throw new Error('No se encontró enterApp en role-launch.js');
    const runnable = src.slice(i)
        .replace(/^export\s+(?=(?:async\s+)?function\b)/gm, '')
        .replace(/\bimport\s*\(/g, '__imp(');
    sb.__imp = async () => ({
        collection: () => ({}), query: (c) => c, where: () => ({}),
        getDocs: async () => ({ forEach: () => {}, docs: [] }),
        doc: () => ({}), getDoc: async () => ({ exists: () => false, data: () => undefined }),
        setDoc: async () => {}, updateDoc: async () => {},
    });
    vm.runInContext(runnable, sb);

    sb._launchWithRole(me._activeRole || me.role);
    return { yo: sb._cronosCurrentUser, sb, logs, almacen };
}

const plaza = (extra) => Object.assign({ clubId: CLUB, isAuthorized: true, status: 'active' }, extra);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · el caso del encargo: Familiar en Alevín C, Entrenador en Regional B ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // Su documento, tal y como lo describen las capturas 10118 y 10121. La
    // plaza de entrenador de Alevín C va PRIMERA y NO está viva: es la que
    // cogía el `find` antiguo (la única forma de que la consola dijera
    // "alevin" mientras el panel sólo ofrecía un equipo de Fútbol 11).
    const me = {
        uid: 'GkycFVeqFswD9JODEjjE3JSMw2v1', email: 'arinagazone@gmail.com',
        role: 'parent', clubId: CLUB, category: 'alevin', subcategory: 'C',
        _activeRole: 'user',
        allRoles: [
            plaza({ role: 'user',   category: 'alevin',   subcategory: 'C', status: 'pending' }),
            plaza({ role: 'parent', category: 'alevin',   subcategory: 'C' }),
            plaza({ role: 'user',   category: 'regional', subcategory: 'B' }),
        ],
    };
    const { yo } = arrancar(me);
    ok('1a · 🔴 entra en REGIONAL, que es donde es entrenador',
       yo.category === 'regional', yo.category);
    ok('1b · 🔴 y en la subcategoría B',
       String(yo.subcategory || '').toUpperCase() === 'B', yo.subcategory);
    ok('1c · 🚨 NUNCA en el equipo de su plaza de Familiar (Alevín C)',
       yo.category !== 'alevin', yo.category + ' ' + yo.subcategory);
    ok('1d · la plaza activa anotada es la de ENTRENADOR',
       yo._activeRoleData && yo._activeRoleData.role === 'user',
       yo._activeRoleData && yo._activeRoleData.role);
}
{
    // La misma persona entrando por su tarjeta de Familiar: su categoría es la
    // del hijo y no la toca nadie.
    const me = {
        uid: 'u1', role: 'parent', clubId: CLUB, category: 'alevin', subcategory: 'C',
        _activeRole: 'parent',
        allRoles: [
            plaza({ role: 'parent', category: 'alevin', subcategory: 'C', inviteCode: 'J10' }),
            plaza({ role: 'user',   category: 'regional', subcategory: 'B' }),
        ],
    };
    const { yo } = arrancar(me);
    ok('1e · como Familiar sigue en Alevín C (no se cruza al revés)',
       yo.category === 'alevin' && yo.inviteCode === 'J10', yo.category + '/' + yo.inviteCode);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · el arranque y el selector "MIS EQUIPOS" no pueden discrepar ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // Dos equipos vivos (un F7 y un F11, v537): el panel enseña los dos y el
    // arranque tiene que caer en uno de ELLOS, con el equipo activo anotado.
    const me = {
        uid: 'u2', role: 'user', clubId: CLUB, _activeRole: 'user',
        allRoles: [
            plaza({ role: 'user', category: 'alevin',   subcategory: 'A' }),
            plaza({ role: 'user', category: 'regional', subcategory: 'B' }),
        ],
    };
    const { yo, sb, almacen } = arrancar(me);
    const equipos = sb.window.cronosEquiposDeEntrenador(me.allRoles, null);
    ok('2a · el selector le ofrece sus DOS equipos', equipos.length === 2, equipos.length);
    const abierto = equipos.filter(e => e.category === yo.category &&
        String(e.subcategory || '').toUpperCase() === String(yo.subcategory || '').toUpperCase())[0];
    ok('2b · 🔑 el equipo con el que arranca ES uno de los que ofrece el selector',
       !!abierto, yo.category + ' ' + yo.subcategory);
    ok('2c · y queda anotado como equipo activo, con el MISMO teamId que el selector',
       !!abierto && almacen.cronos_equipo_activo === abierto.teamId,
       almacen.cronos_equipo_activo);
}
{
    // Con una elección previa en la sesión, manda ella (v540).
    const me = {
        uid: 'u3', role: 'user', clubId: CLUB, _activeRole: 'user',
        allRoles: [
            plaza({ role: 'user', category: 'alevin',   subcategory: 'A' }),
            plaza({ role: 'user', category: 'regional', subcategory: 'B' }),
        ],
    };
    // teamId del SEGUNDO equipo, construido por la función real.
    const sbTmp = arrancar(me).sb;
    const idRegional = sbTmp.window.cronosEquiposDeEntrenador(me.allRoles, null)
        .filter(e => e.category === 'regional')[0].teamId;
    const { yo } = arrancar(Object.assign({}, me), { equipoElegido: idRegional });
    ok('2d · respeta el equipo elegido en la sesión (v540)',
       yo.category === 'regional', yo.category);
}
{
    // Y si la elección guardada ya no es suya, no arrastra al panel a un equipo
    // ajeno: se cae a los que sí tiene.
    const me = {
        uid: 'u4', role: 'user', clubId: CLUB, _activeRole: 'user',
        allRoles: [plaza({ role: 'user', category: 'cadete', subcategory: 'A' })],
    };
    const { yo } = arrancar(me, { equipoElegido: 'club_otro__juvenil__b' });
    ok('2e · una elección caducada NO se aplica',
       yo.category === 'cadete', yo.category);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · plazas muertas y perfiles de legado ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // Plaza revocada delante de la viva: la revocada no puede ganar.
    const me = {
        uid: 'u5', role: 'user', clubId: CLUB, _activeRole: 'user',
        allRoles: [
            plaza({ role: 'user', category: 'benjamin', subcategory: 'A', status: 'removed' }),
            plaza({ role: 'user', category: 'juvenil',  subcategory: 'A' }),
        ],
    };
    const { yo } = arrancar(me);
    ok('3a · una plaza REVOCADA no decide el equipo', yo.category === 'juvenil', yo.category);
}
{
    // "Resto" sin categoría (v582) delante del equipo de verdad.
    const me = {
        uid: 'u6', role: 'user', clubId: CLUB, _activeRole: 'user',
        allRoles: [
            plaza({ role: 'user', category: null, subcategory: null }),
            plaza({ role: 'user', category: 'infantil', subcategory: 'B' }),
        ],
    };
    const { yo } = arrancar(me);
    ok('3b · 🔑 una entrada VACÍA no gana al equipo de verdad',
       yo.category === 'infantil', yo.category);
}
{
    // Legado: la entrada no trae ni status ni isAuthorized. NO se le puede
    // dejar fuera del arranque — falla hacia el "sí".
    const me = {
        uid: 'u7', role: 'user', clubId: CLUB, category: 'cadete', subcategory: 'C',
        _activeRole: 'user',
        allRoles: [{ role: 'user', clubId: CLUB, category: 'cadete', subcategory: 'C' }],
    };
    const { yo } = arrancar(me);
    ok('3c · ⚠️ un perfil de LEGADO sin status/isAuthorized sigue arrancando',
       yo.category === 'cadete' && yo._activeRoleData, yo.category);
}
{
    // Legado del todo: la categoría vive SÓLO en la raíz, y la raíz es de
    // entrenador. Se respeta, como hasta ahora.
    const me = {
        uid: 'u8', role: 'user', clubId: CLUB, category: 'juvenil', subcategory: 'A',
        _activeRole: 'user',
        allRoles: [plaza({ role: 'user' })],
    };
    const { yo } = arrancar(me);
    ok('3d · si la RAÍZ es de entrenador, su categoría se conserva',
       yo.category === 'juvenil', yo.category);
}
{
    // Y el caso del encargo llevado al extremo: plaza de entrenador SIN
    // categoría y raíz de FAMILIA. Heredarla le metería en el equipo del hijo.
    const me = {
        uid: 'u9', role: 'parent', clubId: CLUB, category: 'alevin', subcategory: 'C',
        _activeRole: 'user',
        allRoles: [
            plaza({ role: 'parent', category: 'alevin', subcategory: 'C' }),
            plaza({ role: 'user' }),
        ],
    };
    const { yo } = arrancar(me);
    ok('3e · 🚨 la categoría de la RAÍZ no se hereda si la raíz es de otro rol',
       !yo.category, yo.category + ' ' + yo.subcategory);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · no se rompe el ente individual (v599-v627) ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // El dueño del ente entra como 'individual' y su equipo puede estar
    // guardado como plaza 'user' bajo el ente (v602): tiene que conservarlo.
    const ENTE = 'ind_ente_1';
    const me = {
        uid: 'u10', role: 'individual', clubId: ENTE, isIndividual: true,
        individualEntityId: ENTE, _activeRole: 'individual',
        allRoles: [
            { role: 'individual', clubId: ENTE, individualEntityId: ENTE, isAuthorized: true, status: 'active' },
            { role: 'user', clubId: ENTE, individualEntityId: ENTE, category: 'regional_a',
              isAuthorized: true, status: 'active' },
        ],
    };
    const { yo } = arrancar(me);
    ok('4a · el ente conserva equipo al entrar por su tarjeta',
       !!yo.category, yo.category + ' ' + yo.subcategory);
    ok('4b · 🔑 y en la forma canónica de v627 (categoría + subcategoría aparte)',
       yo.category === 'regional' && String(yo.subcategory || '').toUpperCase() === 'A',
       yo.category + ' / ' + yo.subcategory);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · los roles que NO llevan equipo, intactos ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const me = {
        uid: 'u11', role: 'user', clubId: 'VIEJO', _activeRole: 'director',
        allRoles: [
            { role: 'director', clubId: 'C_DIR', isAuthorized: true, status: 'active' },
        ],
    };
    const { yo } = arrancar(me);
    ok('5a · el director sigue arrancando en el club de SU plaza',
       yo.clubId === 'C_DIR', yo.clubId);
}
{
    // Coordinador con dos plazas: la muerta delante. El tipo (F7/F11) es de la
    // plaza (v593), así que elegir la plaza equivocada le acota el panel.
    const me = {
        uid: 'u12', role: 'coordinator', clubId: CLUB, _activeRole: 'coordinator',
        allRoles: [
            plaza({ role: 'coordinator', coordinatorType: 'f7', status: 'removed' }),
            plaza({ role: 'coordinator', coordinatorType: 'f711' }),
        ],
    };
    const { yo } = arrancar(me);
    ok('5b · el coordinador arranca con el tipo de su plaza VIVA',
       yo.coordinatorType === 'f711', yo.coordinatorType);
}

// ───────────────────────────────────────────────────────────────────────────
console.log(`\n${fallos === 0 ? '✅' : '❌'}  ${total - fallos}/${total} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);

// ════════════════════════════════════════════════════════════════════
// Una baja DEJA LA PLAZA VACANTE para el entrenador que la sustituya.
// ════════════════════════════════════════════════════════════════════
// El principio: al dar de baja a un entrenador, su categoría/subcategoría
// queda libre y otro entrenador (correo nuevo) puede ocuparla, heredando el
// histórico. El histórico ya se conserva; lo que faltaba era que la PLAZA se
// liberase de verdad.
//
// 🔑 De `slotOf()` depende el bloqueo "⛔ Cuota llena para este rol", que corta
//    el alta y la aprobación en 4 puntos del panel. Si alguien de baja sigue
//    contando, la plaza no se libera nunca y el sustituto no entra.
//
// ⚠️ El caso que más importa NO es el limpio. Hay documentos con status y
//    banderas descuadrados —los que reactivó el fallo de resurrección al
//    iniciar sesión, y los antiguos con el alias `authorized` sin el "is"—.
//    Contando solo `isAuthorized === true`, esas plazas se quedaban pilladas
//    sin forma de liberarlas desde la interfaz.
//
// Se ejecuta el `slotOf` REAL extraído del fichero, no una copia.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PANEL = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'club', 'panel.js'), 'utf8');

let fallos = 0;
const ok = (n, c, extra) => {
    if (c) console.log('  verde ' + n);
    else { fallos++; console.log('  ROJO  ' + n);
           if (extra !== undefined) console.log('        ' + JSON.stringify(extra)); }
};

// ── Extraer _rolOcupaPlaza + slotOf tal cual salen del fichero ──────
function extraer() {
    const ini = PANEL.indexOf('const _rolOcupaPlaza =');
    if (ini === -1) throw new Error('No se encuentra _rolOcupaPlaza en panel.js');
    const finMarca = PANEL.indexOf('const usedSlotKey', ini) !== -1
        ? PANEL.indexOf('const usedSlotKey', ini)
        : PANEL.indexOf('\n    const pendingFromPlatformReqs', ini);
    if (finMarca === -1) throw new Error('No se encuentra el final del bloque de plazas');
    return PANEL.slice(ini, finMarca);
}
const BLOQUE = extraer();

// Ejecuta slotOf con un censo de usuarios y un cupo dados.
function correr({ users, maxCoaches }) {
    const sandbox = {
        users,
        clubId: 'club1',
        club: { slots: { users: maxCoaches } },
        console: { log: () => {}, warn: () => {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(BLOQUE + '\n; globalThis.__r = slotOf("user");', sandbox);
    return sandbox.__r;
}

const entrenadorActivo = (id) => ({
    _id: id, role: 'user', isAuthorized: true, status: 'active',
    allRoles: [{ role: 'user', clubId: 'club1', isAuthorized: true, status: 'active',
                 category: 'Alevín', subcategory: 'C' }],
});

console.log('\n=== 1. Referencia: con la plaza ocupada, el cupo está lleno ===');
{
    const r = correr({ users: [entrenadorActivo('u1')], maxCoaches: 1 });
    ok('cuenta 1 plaza usada', r.used === 1, r);
    ok('el cupo está lleno (bloquearía el alta)', r.full === true, r);
}

console.log('\n=== 2. Baja limpia: la plaza queda VACANTE ===');
{
    // Como la deja caSetUserStatus: rol marcado y raíz desautorizada.
    const debaja = {
        _id: 'u1', role: 'user', isAuthorized: false, status: 'removed',
        allRoles: [{ role: 'user', clubId: 'club1', isAuthorized: false, authorized: false,
                     status: 'removed', category: 'Alevín', subcategory: 'C' }],
    };
    const r = correr({ users: [debaja], maxCoaches: 1 });
    ok('no cuenta ninguna plaza usada', r.used === 0, r);
    ok('el cupo NO está lleno: el sustituto puede entrar', r.full === false, r);
}

console.log('\n=== 3. Rol de baja con la RAÍZ todavía activa (el caso real) ===');
{
    // ⚠️ La raíz NO dice 'removed' a propósito. Pasa cuando se revoca un rol
    //    que no es el rol raíz, y también en los documentos que dejó
    //    descuadrados el fallo de resurrección (status 'removed' con
    //    isAuthorized true). El filtro de raíz `u.status === 'removed'` NO
    //    cubre este caso: la plaza sólo se libera si se mira el ROL.
    const danado = {
        _id: 'u1', role: 'parent', isAuthorized: true, status: 'active',
        allRoles: [
            { role: 'parent', clubId: 'club1', isAuthorized: true, status: 'active' },
            { role: 'user', clubId: 'club1', isAuthorized: true,
              status: 'removed', category: 'Alevín', subcategory: 'C' },
        ],
    };
    const r = correr({ users: [danado], maxCoaches: 1 });
    ok("'removed' manda sobre isAuthorized: no ocupa plaza de entrenador", r.used === 0, r);
    ok('la plaza de entrenador se puede reutilizar', r.full === false, r);
}

console.log('\n=== 4. El alias heredado `authorized` tampoco resucita la plaza ===');
{
    const conAlias = {
        _id: 'u1', role: 'user', isAuthorized: false, status: 'active',
        allRoles: [{ role: 'user', clubId: 'club1', authorized: true,
                     status: 'removed', category: 'Alevín', subcategory: 'C' }],
    };
    const r = correr({ users: [conAlias], maxCoaches: 1 });
    ok('un rol de baja con alias `authorized` no ocupa plaza', r.used === 0, r);
}

console.log('\n=== 5. No se libera de más: los que siguen activos SÍ cuentan ===');
{
    // Un entrenador de baja y otro en activo, cupo 2 → queda 1 libre, no 2.
    const debaja = {
        _id: 'u1', role: 'user', isAuthorized: false, status: 'removed',
        allRoles: [{ role: 'user', clubId: 'club1', isAuthorized: false, status: 'removed' }],
    };
    const r = correr({ users: [debaja, entrenadorActivo('u2')], maxCoaches: 2 });
    ok('cuenta exactamente 1 plaza usada', r.used === 1, r);
    ok('con cupo 2 no está lleno', r.full === false, r);

    const r2 = correr({ users: [debaja, entrenadorActivo('u2')], maxCoaches: 1 });
    ok('con cupo 1 SÍ está lleno (el activo ocupa)', r2.full === true, r2);
}

console.log('\n=== 6. El sustituto ocupa la plaza que dejó el anterior ===');
{
    const anterior = {
        _id: 'u1', role: 'user', isAuthorized: false, status: 'removed',
        allRoles: [{ role: 'user', clubId: 'club1', isAuthorized: false, status: 'removed',
                     category: 'Alevín', subcategory: 'C' }],
    };
    const sustituto = entrenadorActivo('u2');
    sustituto.allRoles[0].category = 'Alevín';
    sustituto.allRoles[0].subcategory = 'C';
    const r = correr({ users: [anterior, sustituto], maxCoaches: 1 });
    ok('el nuevo entrenador cabe en la misma categoría con cupo 1',
        r.used === 1 && r.full === true, r);
}

console.log('\n=== 7. Cupo ilimitado sigue siendo ilimitado ===');
{
    const r = correr({ users: [entrenadorActivo('u1')], maxCoaches: -1 });
    ok('unlimited y nunca full', r.unlimited === true && r.full === false, r);
}

console.log('\n' + (fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)'));
process.exit(fallos === 0 ? 0 : 1);

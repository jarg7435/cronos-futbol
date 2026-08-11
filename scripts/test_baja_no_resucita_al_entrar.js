// ════════════════════════════════════════════════════════════════════
// Una baja NO puede deshacerse sola al iniciar sesión.
// ════════════════════════════════════════════════════════════════════
// FALLO REPORTADO (capturas 8589/8590): el administrador daba de baja a un
// entrenador de una subcategoría, la pantalla confirmaba la baja, y al cerrar
// sesión y volver a entrar el entrenador REAPARECÍA en la misma categoría con
// sus roles intactos.
//
// La baja SÍ se guardaba. Lo que fallaba es que el arranque de sesión la
// deshacía, por DOS caminos independientes de js/services/auth.js:
//
//   1. "Sincronizar roles autorizados entre raíz y allRoles": veía la entrada
//      con isAuthorized:false, la tomaba por desincronizada y la reescribía a
//      isAuthorized:true / status:'active', persistiéndola con setDoc.
//
//   2. "Auto-activar roles aprobados por el SA": la platform_request que
//      aprobó a esa persona en su día queda 'approved' PARA SIEMPRE —nadie la
//      retira al darla de baja—, así que reactivaba el rol en cada entrada y
//      además reponía la RAÍZ a isAuthorized:true / status:'active'.
//
// Este test ejecuta el bloque (1) TAL CUAL sale del fichero, con entradas
// controladas. No comprueba que exista un `if`: comprueba el RESULTADO.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'js', 'services', 'auth.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'club', 'panel.js'), 'utf8');

let fallos = 0;
const ok = (nombre, cond, extra) => {
    if (cond) console.log('  verde ' + nombre);
    else { fallos++; console.log('  ROJO  ' + nombre);
           if (extra !== undefined) console.log('        ' + JSON.stringify(extra)); }
};

// ── Aislar el bloque de sincronización raíz↔allRoles ────────────────
function bloqueSync() {
    const ini = AUTH.indexOf('const _rolRevocado =');
    if (ini === -1) throw new Error('No se encuentra _rolRevocado en auth.js');
    const marca = AUTH.indexOf('if (data.isAuthorized && data.role) {', ini);
    if (marca === -1) throw new Error('No se encuentra el bloque de sincronizacion');
    // Cerrar por conteo de llaves desde el `if`.
    let prof = 0, i = marca;
    for (; i < AUTH.length; i++) {
        if (AUTH[i] === '{') prof++;
        else if (AUTH[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return AUTH.slice(ini, i);
}
const BLOQUE = bloqueSync();

// Ejecuta el bloque real con unos datos dados y devuelve qué pasó.
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

console.log('\n=== 1. El rol DADO DE BAJA no revive al entrar ===');
{
    // El caso reportado: entrenador de Alevín C dado de baja. La RAÍZ conserva
    // isAuthorized:true porque el documento no se borra (es una revocación).
    const r = correrSync({
        data: { isAuthorized: true, role: 'user', clubId: 'club1' },
        allRoles: [{ role: 'user', clubId: 'club1', isAuthorized: false,
                     status: 'removed', category: 'Alevín', subcategory: 'C' }],
    });
    const rol = r.allRoles[0];
    ok('sigue con isAuthorized:false', rol.isAuthorized === false, rol);
    ok('sigue con status "removed"', rol.status === 'removed', rol);
    ok('NO se persiste ninguna reactivación', r.escrituras.length === 0, r.escrituras);
    ok('conserva su categoría (no se reasigna sola)',
        rol.category === 'Alevín' && rol.subcategory === 'C', rol);
}

console.log('\n=== 2. Un rol PENDIENTE sí se sincroniza (no se rompe lo que servía) ===');
{
    // Para esto existía el bloque: un rol aún no activado en allRoles pero ya
    // autorizado en la raíz. Ese comportamiento debe seguir intacto.
    const r = correrSync({
        data: { isAuthorized: true, role: 'user', clubId: 'club1' },
        allRoles: [{ role: 'user', clubId: 'club1', isAuthorized: false, status: 'pending_club_admin' }],
    });
    ok('el rol pendiente SÍ se activa', r.allRoles[0].isAuthorized === true, r.allRoles[0]);
    ok('y se persiste', r.escrituras.length === 1, r.escrituras.length);
}

console.log('\n=== 3. Un rol ausente se sigue añadiendo desde la raíz ===');
{
    const r = correrSync({
        data: { isAuthorized: true, role: 'user', clubId: 'club1' },
        allRoles: [],
    });
    ok('se añade el rol de la raíz', r.allRoles.length === 1 && r.allRoles[0].isAuthorized === true,
        r.allRoles);
}

console.log('\n=== 4. La baja de OTRO club no se toca ===');
{
    const r = correrSync({
        data: { isAuthorized: true, role: 'user', clubId: 'club1' },
        allRoles: [
            { role: 'user', clubId: 'club1', isAuthorized: true, status: 'active' },
            { role: 'user', clubId: 'club2', isAuthorized: false, status: 'removed' },
        ],
    });
    ok('la baja del otro club sigue de baja',
        r.allRoles[1].status === 'removed' && r.allRoles[1].isAuthorized === false, r.allRoles[1]);
}

// ── 5. La segunda vía: auto-activación por platform_requests ─────────
console.log('\n=== 5. La platform_request antigua no puede reactivar una baja ===');
{
    // Aquí se comprueba sobre el FUENTE, porque el bloque depende de una
    // consulta a Firestore con importaciones dinámicas y no se puede ejecutar
    // aislado con la misma honestidad que el anterior.
    const iniAuto = AUTH.indexOf('Auto-activar roles aprobados por el SA');
    const finAuto = AUTH.indexOf('Limpiar roles huerfanos', iniAuto) !== -1
        ? AUTH.indexOf('Limpiar roles huerfanos', iniAuto)
        : AUTH.indexOf('Limpiar roles huérfanos', iniAuto);
    const auto = AUTH.slice(iniAuto, finAuto > iniAuto ? finAuto : iniAuto + 6000);

    ok('el rol revocado se salta la reactivación',
        /_rolRevocado\(updatedAllRoles\[existingIdx\]\)/.test(auto));
    ok('la RAÍZ solo se repone a activa si queda algún rol vivo',
        /_quedaAlgunRolVivo/.test(auto)
        && /_quedaAlgunRolVivo[\s\S]{0,220}isAuthorized: true, status: 'active'/.test(auto));
    ok('sin roles vivos NO se escribe isAuthorized/status en la raíz',
        /:\s*\{ allRoles: updatedAllRoles \}/.test(auto));
}

// ── 6. El panel desautoriza la RAÍZ al revocar el rol raíz ───────────
console.log('\n=== 6. Revocar el rol raíz desautoriza la raíz ===');
{
    const ini = PANEL.indexOf('window.caSetUserStatus = async');
    const cuerpo = PANEL.slice(ini, ini + 14000);
    ok('se calcula si lo revocado incluye el rol de la raíz',
        /var revocaRolRaiz\s*=/.test(cuerpo));
    ok('la raíz se desautoriza también en ese caso',
        /if \(revocaTodosLosRoles \|\| revocaRolRaiz\)/.test(cuerpo));
    ok('un rol sin clubId cuenta como de este club (igual que el listado)',
        /rc === ''/.test(cuerpo));
    ok('si no casa ningún rol, se avisa y NO se anuncia la baja',
        /No se encontró ningún rol activo/.test(cuerpo));
    ok('los roles ya revocados no sostienen la cuenta abierta',
        /rolesRestantesVivos/.test(cuerpo));
}

console.log('\n' + (fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)'));
process.exit(fallos === 0 ? 0 : 1);

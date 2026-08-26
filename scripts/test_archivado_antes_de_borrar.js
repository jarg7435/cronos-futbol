// ════════════════════════════════════════════════════════════════════
// PRESERVAR ANTES DE BORRAR: archiveAndDeleteCoach
// ════════════════════════════════════════════════════════════════════
// Encargo del autor: al eliminar a un entrenador debe liberarse su correo,
// pero su trabajo tiene que quedarse en la CATEGORÍA.
//
// 🔑 EL PELIGRO CONCRETO QUE ESTO VIGILA: `users/{uid}/cronos_data/main` —donde
//    vive la plantilla— es una SUBCOLECCIÓN. Firestore no la borra al borrar el
//    documento padre, y su regla es `request.auth.uid == userId` SIN rama de
//    SuperAdmin: en cuanto el uid deja de existir, no la puede leer NADIE.
//    Borrar la cuenta sin archivar antes destruye la plantilla EN SILENCIO.
//
// Por eso aquí se fija, sobre el código real de functions/index.js:
//   1. que `_teamId` de la Function da EXACTAMENTE lo mismo que
//      `cronosTeamId` de js/core/utils.js (si divergen, el archivo no casa
//      con el histórico y el entrenador entrante no lo encuentra);
//   2. que el ORDEN es copiar → verificar → borrar Auth → limpiar, y que
//      NADA irreversible ocurre antes de la verificación;
//   3. que si la verificación falla, se aborta SIN borrar.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
const UTILS = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8').replace(/\r\n/g, '\n');

let fallos = 0;
const ok = (n, c, extra) => {
    if (c) console.log('  verde ' + n);
    else { fallos++; console.log('  ROJO  ' + n);
           if (extra !== undefined) console.log('        ' + String(extra).slice(0, 300)); }
};

console.log('\n=== 1. La función existe y está protegida ===');
ok('existe archiveAndDeleteCoach', /exports\.archiveAndDeleteCoach\s*=/.test(FN));
{
    const i = FN.indexOf('exports.archiveAndDeleteCoach');
    const cuerpo = FN.slice(i, FN.indexOf('\n});', i));
    ok('exige autenticación', /context\.auth/.test(cuerpo));
    // ⚠️ ACTUALIZADA (SEC-C1c, 2026-08-26). Antes fijaba el literal de la
    // lista de roles leida del DOCUMENTO. Ese `if` cambio: el SuperAdmin se
    // resuelve por el TOKEN (no falsificable) y el resto de roles exigen
    // ademas CUENTA HABILITADA — sin eso, una cuenta recien creada podia
    // declararse 'club_admin' de un club ajeno y archivar a sus entrenadores.
    // La intencion no cambia; se refuerza.
    ok('exige rol de administrador',
        /\['club_admin', 'individual_admin', 'director', 'coordinator'\]\.includes/.test(cuerpo));
    ok('🛡️ y el SuperAdmin se resuelve por el TOKEN, no por el documento',
        /const _esSA = await _esSuperAdmin\(context\);/.test(cuerpo));
    ok('🛡️ y una cuenta sin habilitar NO autoriza',
        /!_cuentaHabilitada\(_cd\)/.test(cuerpo));
    // El club se resuelve del LLAMANTE, no de lo que mande el cliente.
    ok('el club_admin solo puede borrar en SU club',
        /callerDoc\.data\(\)\.clubId/.test(cuerpo) && /Solo puedes eliminar usuarios de tu club/.test(cuerpo));
}

console.log('\n=== 2. _teamId de la Function == cronosTeamId de utils.js ===');
{
    // 🔑 SE EJECUTAN LOS DOS, no se comparan sus fuentes: lo que importa es que
    //    den la misma cadena, no que se parezcan.
    const sandbox = {};
    const trozoFn = FN.match(/function _esMarcaDeAcento[\s\S]*?\nfunction _teamId\([\s\S]*?\n}\n/);
    ok('se extrae el bloque de la Function', !!trozoFn);

    const trozoUtils = UTILS.match(/function _cronosNoEsAcento[\s\S]*?\nfunction cronosTeamId\([\s\S]*?\n}\n/);
    ok('se extrae el bloque de utils.js', !!trozoUtils, UTILS.indexOf('_cronosNoEsAcento'));

    if (trozoFn && trozoUtils) {
        const f = new Function(trozoFn[0] + '\nreturn _teamId;')();
        const u = new Function(trozoUtils[0] + '\nreturn cronosTeamId;')();
        const casos = [
            ['club_mqvr9m11_g9kj', 'Alevín', 'C'],
            ['club_x', 'Benjamín', 'A'],
            ['c1', 'Cadete', ''],
            ['c1', 'ALEVÍN', 'c'],
            ['c1', 'Alev in', 'C-1'],
            ['c1', 'Ñandú', 'Ü'],
            ['', 'Alevín', 'C'],
            ['c1', '', 'C'],
        ];
        let iguales = 0;
        casos.forEach((c) => {
            const a = f(c[0], c[1], c[2]);
            const b = u(c[0], c[1], c[2]);
            if (a === b) iguales++;
            else console.log('        DIFIEREN ' + JSON.stringify(c) + ' → fn=' + JSON.stringify(a) + ' utils=' + JSON.stringify(b));
        });
        ok('las dos implementaciones coinciden en todos los casos', iguales === casos.length,
            iguales + '/' + casos.length);
        // Y que de verdad normaliza acentos (si no, "Alevín" y "Alevin" serían
        // equipos distintos y el archivo no lo encontraría nadie).
        ok('los acentos se normalizan', f('c1', 'Alevín', 'C') === f('c1', 'Alevin', 'C'),
            f('c1', 'Alevín', 'C') + ' vs ' + f('c1', 'Alevin', 'C'));
        ok('sin club o sin categoría no hay equipo', f('', 'Alevín', 'C') === '' && f('c1', '', 'C') === '');
    }
}

console.log('\n=== 3. EL ORDEN: nada irreversible antes de verificar ===');
{
    const i = FN.indexOf('exports.archiveAndDeleteCoach');
    const cuerpo = FN.slice(i, FN.indexOf('\n});', i));
    const pCopia   = cuerpo.indexOf('await archivoRef.set(');
    const pVerif   = cuerpo.indexOf('const comprobacion = await archivoRef.get()');
    const pAborta  = cuerpo.indexOf('El archivado no se pudo verificar');
    const pBorra   = cuerpo.indexOf('admin.auth().deleteUser');
    const pLimpia  = cuerpo.indexOf('d.ref.delete()');

    ok('1º copia',      pCopia  !== -1, pCopia);
    ok('2º verifica',   pVerif  !== -1 && pVerif > pCopia, pVerif);
    ok('3º borra Auth', pBorra  !== -1 && pBorra > pVerif, pBorra);
    ok('4º limpia la subcolección', pLimpia !== -1 && pLimpia > pBorra, pLimpia);
    // 🔑🔑 LA ASERCIÓN QUE DE VERDAD IMPORTA: el borrado de Auth NO puede estar
    //    antes de la verificación, pase lo que pase con el resto del orden.
    ok('el borrado de Auth va DESPUÉS de la verificación', pBorra > pVerif);
    ok('si la verificación falla, se ABORTA antes de borrar',
        pAborta !== -1 && pAborta < pBorra, pAborta + ' < ' + pBorra);
    ok('y la limpieza va DESPUÉS del borrado (nunca antes)', pLimpia > pBorra);
}

console.log('\n=== 4. No se archiva a medias ===');
{
    const i = FN.indexOf('exports.archiveAndDeleteCoach');
    const cuerpo = FN.slice(i, FN.indexOf('\n});', i));
    // Se archiva la subcolección ENTERA, no solo 'main': cloudSet escribe la
    // clave que le pidan y mañana puede haber otras.
    ok("recorre la subcolección entera, no solo 'main'",
        /collection\('cronos_data'\)\.get\(\)/.test(cuerpo) && !/doc\('main'\)/.test(cuerpo), cuerpo.slice(0, 200));
    ok('cuenta documentos Y claves para poder verificar',
        /clavesOrigen/.test(cuerpo) && /numDocumentos/.test(cuerpo));
    // Si no hay dónde archivar pero SÍ hay datos, no se borra.
    // ⚠️ SE ACOTA EL BLOQUE, no una ventana de N caracteres: al mejorar el
    //    mensaje de aborto el `{0,200}` se quedó corto y puso el guard en rojo
    //    sin que nada estuviera mal. Es la tercera vez que un ancla perezosa
    //    me da un falso rojo en este proyecto.
    {
        const iSin = cuerpo.indexOf('if (!teamId) {');
        const bloque = iSin === -1 ? '' : cuerpo.slice(iSin, cuerpo.indexOf('\n  }', iSin));
        ok('se localiza el caso "sin equipo"', bloque.length > 0);
        ok('sin equipo pero con datos → aborta',
            /origen\.size > 0/.test(bloque) && /failed-precondition/.test(bloque), bloque.slice(0, 200));
    }
    // merge:true — otra baja en la misma categoría no puede pisar la anterior.
    ok('acumula por uid en vez de pisar el archivo anterior',
        /coaches: \{\s*\[targetUid\]/.test(cuerpo) && /\{ merge: true \}/.test(cuerpo));
    ok('deja constancia en deletion_requests',
        /action: borrarCuenta \? 'archive_and_delete' : 'archive_slot'/.test(cuerpo) && /dataArchived/.test(cuerpo));
}

console.log('\n=== 5. El fuente no contiene marcas de acento literales ===');
{
    // ⚠️ Escribir una clase de regex con el rango de diacríticos ha acabado más
    //    de una vez como marcas literales en el fichero. Con charCodeAt el
    //    fuente es ASCII puro en esa zona y no hay nada que corromper.
    const i = FN.indexOf('function _esMarcaDeAcento');
    const zona = FN.slice(i, i + 600);
    let malos = 0;
    for (const ch of zona) { const c = ch.charCodeAt(0); if (c >= 0x300 && c <= 0x36f) malos++; }
    ok('sin diacríticos combinantes en el bloque del slug', malos === 0, malos + ' encontrados');
    ok('filtra por charCodeAt, no por clase de regex', /charCodeAt\(0\)/.test(zona));
}

console.log('\n=== 5b. La categoría sale de allRoles, NO de la raíz ===');
{
    // 🔑🔑 EL DEFECTO DE LA PRIMERA PRUEBA REAL. La raíz del documento puede
    //    ser la identidad `club_admin` de una cuenta con varios perfiles, y
    //    ahí `category` está vacía: la del entrenador vive en `allRoles[]`.
    //    La Function abortó (bien: no borró nada) por un defecto suyo.
    // 🔑 SE EJECUTA LA FUNCIÓN REAL contra la forma EXACTA del documento que
    //    falló en producción (leído por REST el 2026-08-10): cuenta con cinco
    //    roles cuya raíz es `club_admin` y NO tiene categoría.
    const trozo = FN.match(/function _esMarcaDeAcento[\s\S]*?\nfunction _resuelveEquipo\([\s\S]*?\n\}\n/);
    ok('se extrae _resuelveEquipo', !!trozo);
    if (trozo) {
        const resuelve = new Function(trozo[0] + '\nreturn _resuelveEquipo;')();
        const CLUB = 'club_mqvr9m11_g9kj';
        const real = {
            role: 'club_admin', clubId: CLUB, category: undefined, subcategory: undefined,
            allRoles: [
                { role: 'club_admin', clubId: CLUB, category: null, subcategory: null, status: 'active', isAuthorized: true },
                { role: 'director', clubId: CLUB, category: null, subcategory: null, status: 'active', isAuthorized: true },
                { role: 'user', clubId: CLUB, category: 'alevin', subcategory: 'C', status: 'removed',
                  isAuthorized: false, authorized: false, removedAt: '2026-08-10T20:01:42.491Z' },
                { role: 'coordinator', clubId: CLUB, category: null, subcategory: null, status: 'active', isAuthorized: true },
                { role: 'parent', clubId: CLUB, category: 'alevin', subcategory: 'C', status: 'active', isAuthorized: true },
            ],
        };
        // Con el rol que manda el panel.
        const conRol = resuelve(real, { clubId: CLUB, role: 'user' });
        ok('con el rol del panel resuelve alevin/C', conRol.category === 'alevin' && conRol.subcategory === 'C',
            JSON.stringify(conRol));
        ok('y produce un teamId no vacío', !!conRol.teamId, conRol.teamId);
        // Sin rol: tiene que caer en el revocado MÁS RECIENTE, no en el 'parent'.
        const sinRol = resuelve(real, { clubId: CLUB });
        ok('sin rol, elige el REVOCADO (no el rol activo con categoría)',
            sinRol.category === 'alevin' && sinRol.subcategory === 'C', JSON.stringify(sinRol));

        // ⚠️ CASO QUE DISTINGUE EL PASO 1 DEL PASO 2. Con el de arriba no se
        //    notaba si se rompía el paso 1: el respaldo daba la misma
        //    respuesta y la mutación pasaba en verde. Aquí el rol que nombra
        //    el panel y el revocado MÁS RECIENTE son EQUIPOS DISTINTOS.
        const ambiguo = {
            role: 'club_admin', clubId: CLUB,
            allRoles: [
                { role: 'user', clubId: CLUB, category: 'alevin', subcategory: 'C',
                  status: 'removed', removedAt: '2026-08-10T10:00:00.000Z' },
                { role: 'parent', clubId: CLUB, category: 'benjamin', subcategory: 'A',
                  status: 'removed', removedAt: '2026-08-10T23:59:00.000Z' },
            ],
        };
        const mandaElPanel = resuelve(ambiguo, { clubId: CLUB, role: 'user' });
        ok('el rol que manda el panel PESA MÁS que el revocado más reciente',
            mandaElPanel.category === 'alevin' && mandaElPanel.subcategory === 'C',
            JSON.stringify(mandaElPanel));
        // Antes del arreglo esto daba '' y abortaba: es la regresión a vigilar.
        ok('NO devuelve vacío por leer la raíz (el defecto de la 1ª prueba)',
            conRol.teamId !== '' && sinRol.teamId !== '');
        // Un entrenador normal, con la categoría en la raíz, sigue funcionando.
        const simple = resuelve({ role: 'user', clubId: CLUB, category: 'benjamin', subcategory: 'A', allRoles: [] },
                                { clubId: CLUB, role: 'user' });
        ok('el caso simple (categoría en la raíz) sigue igual',
            simple.category === 'benjamin' && !!simple.teamId, JSON.stringify(simple));
        // Y no se cuela un rol de OTRO club.
        const otroClub = resuelve({ role: 'club_admin', clubId: CLUB, allRoles: [
            { role: 'user', clubId: 'club_OTRO', category: 'cadete', subcategory: 'B', status: 'removed' },
        ] }, { clubId: CLUB, role: 'user' });
        ok('ignora los roles de otro club', otroClub.category === '', JSON.stringify(otroClub));
    }
    // El panel tiene que mandar el rol, o la señal más fiable se pierde.
    const PANEL2 = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'club', 'panel.js'), 'utf8');
    ok('el panel manda el rol a la Function',
        /archiveAndDeleteCoach'\)\(\{[\s\S]{0,160}role: targetRole/.test(PANEL2));
}

console.log('\n=== 5c. La cuenta sólo muere con su ÚLTIMO rol ===');
{
    // 🔑 LA REGLA DE NEGOCIO: el correo es de la PERSONA, la casilla (rol +
    //    categoría) es del CLUB. Revocar una casilla archiva su trabajo y la
    //    deja vacante; la cuenta sigue viva mientras le quede algún rol.
    //    SÓLO al revocar el ÚLTIMO se borra la cuenta y se libera el correo.
    const i = FN.indexOf('exports.archiveAndDeleteCoach');
    const cuerpo = FN.slice(i, FN.indexOf('\n});', i));

    ok('la decisión es explícita y por roles vivos',
        /const borrarCuenta = rolesVivos\.length === 0 && !esCuentaAdmin/.test(cuerpo));
    ok('un rol revocado NO cuenta como vivo', /r\.status !== 'removed'/.test(cuerpo));
    ok('y el alias heredado `authorized` también cuenta', /r\.authorized === true/.test(cuerpo));
    ok('ya NO se aborta por conservar otros roles',
        !/revoca primero esos roles/.test(cuerpo));

    // El borrado de Auth y la limpieza van CONDICIONADOS.
    ok('el borrado de Auth va dentro de `if (borrarCuenta)`',
        /if \(borrarCuenta\) \{[\s\S]{0,400}admin\.auth\(\)\.deleteUser/.test(cuerpo));
    // 🔑🔑 SI LA CUENTA VIVE, ARCHIVAR ES COPIAR, NO MOVER: su plantilla es de
    //    la cuenta y la necesita para sus otros equipos.
    ok('la subcolección SÓLO se limpia si la cuenta se ha borrado',
        /if \(deletedFromAuth \|\| alreadyAbsent\) \{[\s\S]{0,200}d\.ref\.delete\(\)/.test(cuerpo));

    // ⚠️ Salvaguarda que se queda: nunca se borra una cuenta administradora.
    ok('nunca borra una cuenta ADMINISTRADORA', /!esCuentaAdmin/.test(cuerpo));
    ok('contempla club_admin, superadmin e individual_admin',
        /rol === 'club_admin' \|\| rol === 'superadmin' \|\|\s*\n?\s*rol === 'individual_admin'/.test(cuerpo));

    // Se archiva SIEMPRE, pase lo que pase con la cuenta: es el objetivo.
    const pCopia = cuerpo.indexOf('await archivoRef.set(');
    const pDecide = cuerpo.indexOf('const borrarCuenta');
    const pBorra = cuerpo.indexOf('admin.auth().deleteUser');
    ok('se decide ANTES de archivar', pDecide !== -1 && pDecide < pCopia);
    ok('y se archiva ANTES de cualquier borrado', pCopia < pBorra);

    // El aborto por falta de categoría tiene que decir QUÉ falta.
    ok('el aborto explica si falta el club o la categoría',
        /const falta = !_teamSlug\(clubId\) \? 'el club' : 'la categoría'/.test(cuerpo));
    ok('y recuerda que no se ha borrado nada', /No se ha borrado nada/.test(cuerpo));

    // El resultado distingue los dos desenlaces, o el panel no puede decirle
    // al administrador qué ha pasado de verdad.
    ok('devuelve si la cuenta se borró', /cuentaBorrada: deletedFromAuth \|\| alreadyAbsent/.test(cuerpo));
    ok('y qué roles le quedan', /rolesRestantes: rolesVivos\.map/.test(cuerpo));
    ok('el registro distingue la acción',
        /action: borrarCuenta \? 'archive_and_delete' : 'archive_slot'/.test(cuerpo));
}

console.log('\n=== 6. El botón de la fila: revocar CASILLA, no borrar persona ===');
{
    const PANEL = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'club', 'panel.js'), 'utf8')
        .replace(/\r\n/g, '\n');
    // ⚠️⚠️ LO PRIMERO: desde las filas de equipo YA NO SE BORRAN CUENTAS.
    //    El borrado global es cosa del SuperAdministrador al cerrar temporada,
    //    y aquí ocurre sólo como CONSECUENCIA de revocar la última casilla.
    //    Un botón que borra cuentas junto a otro que quita un rol es un
    //    accidente esperando.
    const sinCom = PANEL.replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    ok('no queda NINGUNA llamada a caDeleteUserComplete',
        !/caDeleteUserComplete/.test(sinCom), (sinCom.match(/caDeleteUserComplete[^\n]{0,60}/) || [''])[0]);
    ok('los botones de fila llaman a caRevocarCasilla',
        (sinCom.match(/onclick="caRevocarCasilla\(/g) || []).length >= 2,
        (sinCom.match(/onclick="caRevocarCasilla\(/g) || []).length);

    const i = PANEL.indexOf('window.caRevocarCasilla');
    const cuerpo = i === -1 ? '' : PANEL.slice(i, PANEL.indexOf('\n    };', i));
    ok('existe caRevocarCasilla', cuerpo.length > 0);

    // Cuenta los roles que le quedarían, leyendo el DOCUMENTO (la fila puede
    // llevar minutos en pantalla).
    ok('lee el documento para saber si es el último rol', /getDoc\(doc\(db, 'users', userId\)\)/.test(cuerpo));
    ok('descuenta el rol que se está revocando', /r\.role === targetRole/.test(cuerpo));
    ok('un rol revocado no cuenta como vivo', /r\.status !== 'removed'/.test(cuerpo));

    // El aviso tiene que decir las tres consecuencias.
    ok('el aviso dice que el trabajo se archiva en la categoría', /Se archiva en la categoría/.test(cuerpo));
    ok('...que la casilla queda vacante', /Queda VACANTE/.test(cuerpo));
    ok('...y qué pasa con la cuenta', /QUÉ PASA CON SU CUENTA/.test(cuerpo));
    ok('avisa de lo irreversible SÓLO si es el último rol',
        /esUltimo[\s\S]{0,200}NO SE PUEDE DESHACER/.test(cuerpo));

    // 🔑 La segunda confirmación (teclear el correo) sólo cuando de verdad se
    //    va a borrar: pedirla siempre acaba en aceptar sin leer.
    ok('pide teclear el correo sólo si es el último rol',
        /if \(esUltimo\) \{[\s\S]{0,300}prompt\(/.test(cuerpo));
    ok('y compara con el correo real', /!==\s*String\(userEmail\)/.test(cuerpo));

    // Orden: revocar (libera la plaza) y luego archivar.
    const pRev = cuerpo.indexOf("caSetUserStatus(userId, userEmail, 'removed'");
    const pFn  = cuerpo.indexOf("'archiveAndDeleteCoach'");
    ok('revoca ANTES (es lo que libera la plaza)', pRev !== -1 && pRev < pFn);
    ok('y manda el rol a la Function', /role: targetRole \|\| null/.test(cuerpo));
    ok('no encadena un tercer confirm', /'removed', cid, targetRole, true\)/.test(cuerpo));

    // El resultado tiene que decir lo que REALMENTE pasó con la cuenta.
    ok('distingue si la cuenta se borró o sigue viva',
        /d\.cuentaBorrada[\s\S]{0,200}rolesRestantes/.test(cuerpo));
}

console.log('\n=== 7. Las reglas del archivo del equipo ===');
{
    const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
    const i = RULES.indexOf('match /clubs/{clubId}/team_archives/{teamId}');
    const bloque = i === -1 ? '' : RULES.slice(i, RULES.indexOf('\n    }', i));
    ok('existe el bloque de reglas', bloque.length > 0);
    // 🔑 Escritura CERRADA: sólo el Admin SDK, que no pasa por las reglas. Si
    //    el cliente pudiera escribir, cualquiera falsearía el histórico.
    ok('la escritura está cerrada al cliente', /allow write:\s*if false;/.test(bloque), bloque);
    ok('lo puede leer el club (el entrenador entrante lo necesita)',
        /allow read:/.test(bloque) && /sameClubAsDoc\(clubId\)/.test(bloque), bloque);
    ok('y el SuperAdmin', /isSuperAdmin\(\)/.test(bloque));
}

console.log('\n' + (fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)'));
process.exit(fallos === 0 ? 0 : 1);

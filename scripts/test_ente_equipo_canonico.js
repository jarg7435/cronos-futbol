// ─────────────────────────────────────────────────────────────────────────
//  test_ente_equipo_canonico.js  ·  v627
//
//  Encargo del autor (implementar.txt, 2026-08-25), dos síntomas:
//
//   1) «Desde el cuadrante del ente se envía la semana al entrenador del
//      Regional A, el sistema confirma el envío, pero el entrenamiento no
//      está llegando al panel de entrenamiento de dicho entrenador.»
//   2) «Al acceder a su panel de entrenador bajo el ente, la aplicación no
//      fija automáticamente su categoría y subcategoría (Regional A).»
//
//  ════════════════════════════════════════════════════════════════════
//  🔑🔑 SON DOS DEFECTOS DISTINTOS, Y NINGUNO ESTABA DONDE APUNTABA EL SÍNTOMA
//
//  A) LA PLAZA DEL ENTE ESTABA ESCRITA EN OTRA FORMA QUE LAS DEMÁS.
//     El alta de un entrenador de club guarda `category:'regional'` +
//     `subcategory:'A'` (index.html:492 → auth.js). `indAnadirMiEquipo`
//     (v598) guardaba la clave COMBINADA `category:'regional_a'`. Como
//     `cronosTeamId` hace slug de lo que le den, salían DOS claves para el
//     mismo equipo:
//         …__regional__a     ← lo que calcula el resto del proyecto
//         …__regional-a__a   ← lo que calculaba el ente
//     Por eso el envío "funcionaba" (se escribía y se sellaba) y aun así no
//     aparecía: `cronosCuadranteClubDeMiEquipo` busca su fila por teamId y
//     buscaba con la clave que no era. Mismo patrón que v562.
//
//  B) AL ENTE NO SE LE CARGABA SU PLAZA AL ENTRAR.
//     En `_launchWithRole` (role-launch.js), TODO el bloque que copia
//     categoría, subcategoría, `_activeRoleData` y equipo activo estaba
//     encerrado en `role === 'user' || role === 'coach'`. El ente entra con
//     rol 'individual': no se ejecutaba nada. `me.category` quedaba vacía, y
//     de ahí salen los DOS síntomas:
//       · `_forceCategorySelect` arranca con `if (!_me.category) return false`
//         → ni fijaba ni bloqueaba los desplegables (síntoma 2);
//       · `cronosMyTeam()` cae a `me.category` como último escalón de su
//         cascada (los anteriores sólo miran 'user'/'coach') → sin ella
//         devolvía null: el ente NO TENÍA teamId (agrava el síntoma 1).
//
//  Este guard EJECUTA los módulos reales (utils.js, category-tree.js,
//  cuadrante-club.js y admin/individual/panel.js) en un sandbox y compara las
//  dos claves que tenían que ser la misma. La aserción central es una
//  IGUALDAD entre dos cadenas calculadas por dos caminos independientes: es lo
//  único que demuestra que el cuadrante llega.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra) console.log('      → ' + extra); }
};

const LAUNCH = leer('js/services/auth/role-launch.js');
const IND    = leer('js/admin/individual/panel.js');
const SETUP  = leer('js/core/setup-modal.js');

const ENTE = 'ente_jose_x1';

// ── Sandbox con los módulos REALES ───────────────────────────────────
function montar() {
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
            addEventListener() {},
            body: { appendChild() {}, contains: () => true, classList: { add() {}, remove() {} } },
            createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {} }),
        },
        localStorage:   { getItem: () => null, setItem() {}, removeItem() {} },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        navigator: {}, location: { href: '' },
        setTimeout: () => {}, clearTimeout: () => {},
    };
    sb.window = sb;
    vm.createContext(sb);
    ['js/core/utils.js', 'js/admin/shared/category-tree.js',
     'js/coach/reports/cuadrante-club.js', 'js/admin/individual/panel.js'].forEach(f => {
        try { vm.runInContext(leer(f), sb); }
        catch (e) { console.log('  (aviso al cargar ' + f + ': ' + e.message + ')'); }
    });
    return sb;
}

// Un `users` de mentira: sólo responde a la consulta por clubId.
function fsFalso(docs, escrituras) {
    return {
        db: {},
        doc: (...a) => ({ _p: a }), collection: (...a) => ({ _p: a }),
        query: (...a) => ({ _p: a }), where: (...a) => ({ _p: a }),
        getDoc: async () => ({ exists: () => false, data: () => ({}) }),
        setDoc: async () => {},
        updateDoc: async (ref, datos) => { (escrituras || []).push(datos); },
        getDocs: async () => ({ forEach: (f) => docs.forEach(d => f({ id: d.id, data: () => d })) }),
        onSnapshot: () => () => {},
    };
}

console.log('\n══ v627 · El equipo del ente, con UNA sola clave ══');

const sb = montar();

// ════════════════════════════════════════════════════════════════════
console.log('\n0) Los módulos reales están en pie');
{
    ok('0a · utils.js: cronosTeamId / cronosMyTeam / cronosEquiposDeEntrenador',
       typeof sb.cronosTeamId === 'function' && typeof sb.cronosMyTeam === 'function' &&
       typeof sb.cronosEquiposDeEntrenador === 'function');
    ok('0b · category-tree.js: ctNormCat', typeof sb.ctNormCat === 'function');
    ok('0c · cuadrante-club.js: _cqFilasDePlazas', typeof sb._cqFilasDePlazas === 'function');
    ok('0d · individual/panel.js: la migración de plazas',
       typeof sb._indMigrarPlazasALaFormaCanonica === 'function');
    ok('0e · 🔑 y "individual" está en la lista única de quién lleva equipo',
       (sb.CRONOS_ROLES_CON_EQUIPO || []).indexOf('individual') >= 0);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🔴 EL DEFECTO MEDIDO: dos claves para el mismo equipo');
{
    // Tal y como lo escribía indAnadirMiEquipo hasta la v626.
    const viejo  = sb.cronosTeamId(ENTE, 'regional_a', 'A');
    // Tal y como lo calcula el resto del proyecto (y las filas del cuadrante).
    const bueno  = sb.cronosTeamId(ENTE, 'regional', 'A');

    ok('1a · 🔴🔴 la forma combinada daba una clave DISTINTA', viejo !== bueno,
       viejo + '  ≠  ' + bueno);
    ok('1b · y ésa es exactamente la que rompía la entrega',
       viejo === ENTE.replace(/_/g, '-') + '__regional-a__a' &&
       bueno === ENTE.replace(/_/g, '-') + '__regional__a',
       viejo + ' / ' + bueno);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔧 La migración endereza las plazas ya escritas (ejecutada)');
{
    const escrituras = [];
    const userData = {
        uid: 'u_jose', individualEntityId: ENTE, clubId: ENTE,
        allRoles: [
            // La plaza rota de la v598.
            { role: 'individual', clubId: ENTE, category: 'regional_a', subcategory: 'A',
              isAuthorized: true, status: 'active' },
            // Una que NO se puede tocar: la categoría femenina acaba en "_fem".
            { role: 'individual', clubId: ENTE, category: 'regional_fem', subcategory: 'B',
              isAuthorized: true, status: 'active' },
            // Ni una plaza de OTRA entidad, aunque sea del mismo correo.
            { role: 'user', clubId: 'club_ajeno', category: 'alevin_c', subcategory: 'C',
              isAuthorized: true, status: 'active' },
            // Ni un padre: no lleva equipo.
            { role: 'parent', clubId: ENTE, category: 'juvenil_b', subcategory: 'B',
              isAuthorized: true, status: 'active' },
        ],
    };
    sb._cronosCurrentUser = { uid: 'u_jose', clubId: ENTE, allRoles: userData.allRoles };

    let err = null;
    sb._indMigrarPlazasALaFormaCanonica(fsFalso([], escrituras), 'u_jose', userData, ENTE)
      .catch(e => { err = e; })
      .then(() => {
        ok('2a · la migración corre sin romperse', !err, err && err.message);
        ok('2b · 🔑 la plaza del ente pasa a la forma canónica',
           userData.allRoles[0].category === 'regional' &&
           userData.allRoles[0].subcategory === 'A',
           JSON.stringify(userData.allRoles[0]));
        ok('2c · ⚠️ Regional FEM NO se toca (no acaba en _a/_b/_c)',
           userData.allRoles[1].category === 'regional_fem');
        ok('2d · ⚠️⚠️ una plaza de OTRA entidad no se toca jamás',
           userData.allRoles[2].category === 'alevin_c',
           'la unidad es la PLAZA (v540/v583): tocar la de su club sería cruzar entidades');
        ok('2e · ⚠️ ni la de un padre, que no lleva equipo',
           userData.allRoles[3].category === 'juvenil_b');
        ok('2f · se escribe UNA sola vez, y sólo `allRoles`',
           escrituras.length === 1 && Object.keys(escrituras[0]).join(',') === 'allRoles');
        ok('2g · 🔑 y también en MEMORIA, para que el arreglo se vea HOY',
           sb._cronosCurrentUser.category === 'regional' &&
           sb._cronosCurrentUser.subcategory === 'A',
           '_launchWithRole ya leyó allRoles al entrar; sin esto habría que volver a iniciar sesión');

        // Segunda pasada: no debe escribir nada más.
        const esc2 = [];
        sb._indMigrarPlazasALaFormaCanonica(fsFalso([], esc2), 'u_jose', userData, ENTE)
          .then(() => {
            ok('2h · ⚠️ es IDEMPOTENTE: la segunda vez no escribe nada',
               esc2.length === 0,
               'el panel se abre muchas veces por sesión; escribir en cada apertura sería inaceptable');
            parte3();
          });
      });
}

// ════════════════════════════════════════════════════════════════════
function parte3() {
console.log('\n3) 🔑🔑 LA IGUALDAD QUE DEMUESTRA QUE EL CUADRANTE LLEGA');
{
    // El usuario tal y como queda tras entrar con la v627: `_launchWithRole`
    // le carga la plaza (rol 'individual') y deja la categoría en la raíz.
    sb._cronosCurrentUser = {
        uid: 'u_jose', clubId: ENTE,
        category: 'regional', subcategory: 'A',
        _activeRole: 'individual',
        _activeRoleData: { role: 'individual', clubId: ENTE, category: 'regional', subcategory: 'A' },
        allRoles: [{ role: 'individual', clubId: ENTE, category: 'regional', subcategory: 'A',
                     isAuthorized: true, status: 'active' }],
    };

    const miTeamId = sb.cronosMyTeamId();
    ok('3a · 🔑 el ente YA tiene teamId (antes cronosMyTeam devolvía null)',
       !!miTeamId, 'medido: "' + miTeamId + '"');

    // Y la fila que el cuadrante crea para él, por el camino real del módulo.
    sb._cqFS = async () => fsFalso([
        { id: 'u_jose', uid: 'u_jose', email: 'j@x.es', role: 'individual',
          clubId: ENTE, status: 'active', isAuthorized: true,
          allRoles: sb._cronosCurrentUser.allRoles },
    ]);

    sb._cqFilasDePlazas(ENTE).then(filas => {
        ok('3b · el cuadrante le crea su fila', filas.length === 1, JSON.stringify(filas));

        const idFila = filas[0] ? filas[0].id : '';
        ok('3c · 🔑🔑🔑 la fila del cuadrante y su teamId son LA MISMA CLAVE',
           !!idFila && idFila === miTeamId,
           'fila="' + idFila + '"  ·  cronosMyTeamId()="' + miTeamId + '"\n' +
           '      cronosCuadranteClubDeMiEquipo busca `filas.find(f => f.id === teamId)`: ' +
           'si difieren, el envío se confirma y NO se ve nada');

        // El selector de equipo del panel de partido tiene que decir lo mismo.
        const eqs = sb.cronosEquiposDeEntrenador(sb._cronosCurrentUser.allRoles, null) || [];
        ok('3d · 🔑 y el selector de equipo del panel de partido, también',
           eqs.length === 1 && eqs[0].teamId === miTeamId,
           JSON.stringify(eqs.map(e => e.teamId)));
        ok('3e · con su modalidad bien derivada (Regional es Fútbol 11)',
           eqs.length === 1 && eqs[0].modalidad === 'f11');

        // ── El contraste: con la plaza vieja, las claves se separaban ──
        const antes = Object.assign({}, sb._cronosCurrentUser, {
            category: 'regional_a',
            allRoles: [{ role: 'individual', clubId: ENTE, category: 'regional_a',
                         subcategory: 'A', isAuthorized: true, status: 'active' }],
        });
        const guardado = sb._cronosCurrentUser;
        sb._cronosCurrentUser = antes;
        const teamIdViejo = sb.cronosMyTeamId();
        sb._cronosCurrentUser = guardado;
        ok('3f · 🔴 y con la plaza vieja NO coincidían — el guard se pondría rojo',
           teamIdViejo !== idFila,
           'viejo="' + teamIdViejo + '" vs fila="' + idFila + '"');

        parte4();
    });
}
}

// ════════════════════════════════════════════════════════════════════
function parte4() {
console.log('\n4) 🚪 Al entrar, al ente SÍ se le carga su plaza');
{
    ok('4a · 🔑🔑 el bloque ya no está encerrado en user/coach',
       /const _esRolDeEquipo = _rolesConEquipo\.indexOf\(role\) >= 0;/.test(LAUNCH) &&
       /\/\/ ── Campos exclusivos de quien LLEVA EQUIPO ──[\s\S]{0,220}if \(_esRolDeEquipo\) \{/.test(LAUNCH),
       'era `if (role === \'user\' || role === \'coach\')`, y el ente entra como \'individual\'');

    ok('4b · ⚠️ y el criterio se pregunta a la lista única, no a mano',
       /window\.CRONOS_ROLES_CON_EQUIPO\s*\n?\s*\|\| \['user', 'coach', 'individual', 'admin_individual'\]/.test(LAUNCH));

    ok('4c · 🔑 el selector de equipo (dos equipos) también lo cubre',
       /if \(_esRolDeEquipo &&\s*\n\s*typeof window\.cronosEquipoElegido === 'function'/.test(LAUNCH),
       'sin esto, el segundo equipo del ente sería inalcanzable desde el panel de partido');

    ok('4d · ⚠️ la normalización NO toca la rama del entrenador de club',
       /if \(_catRol && role !== 'user' && role !== 'coach' &&/.test(LAUNCH),
       'utils.js avisa por escrito: mover ese criterio cambiaría el teamId de usuarios ' +
       'reales y dejaría su plantilla publicada huérfana');

    ok('4e · y si la plaza no traía subcategoría, se toma la letra del sufijo',
       /const _m = String\(_catRol\)\.match\(\/_\(\[abc\]\)\$\/i\);/.test(LAUNCH));

    // El consumidor del síntoma 2.
    ok('4f · 🔑 el bloqueo del panel de partido depende de me.category…',
       /var _me = window\._cronosCurrentUser;\s*\n\s*if \(!_me \|\| !_me\.category\) return false;/.test(SETUP),
       '…y por eso, con la categoría vacía, ni fijaba ni bloqueaba los desplegables');

    ok('4g · el resolutor sabe pintar "regional" en el desplegable',
       sb._cronosCategoriaValor('regional', 'f11') === 'f11_regional' &&
       sb._cronosCategoriaValor('regional_a', 'f11') === 'f11_regional');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n5) ✍️ Y la causa de raíz: el escritor ya no crea la forma vieja');
{
    ok('5a · 🔑 indAnadirMiEquipo guarda la categoría a secas',
       /category:      catId,\s*\n\s*subcategory:   subCat,/.test(IND),
       'era `category: catVal` (la clave combinada del desplegable)');

    ok('5b · ⚠️ la etiqueta legible se conserva aparte',
       /categoryLabel: label,/.test(IND));

    ok('5c · la migración se invoca al abrir el panel, antes de pintar nada',
       (() => {
           const iMig = IND.indexOf('await _indMigrarPlazasALaFormaCanonica(');
           const iEq  = IND.indexOf('const _misEquipos = (userData.allRoles || []).filter');
           return iMig > 0 && iEq > 0 && iMig < iEq;
       })());

    ok('5d · ⚠️ un fallo de escritura NO tumba el panel, pero se dice por qué',
       /no se pudieron enderezar las plazas:/.test(IND),
       'nada de catch mudo: es el fallo que este proyecto ya pagó en v583 y v610');
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
if (fail) { console.log('❌ ' + fail + ' aserción(es) en rojo'); process.exit(1); }
console.log('✅ Una sola clave de equipo — el cuadrante llega y la categoría se fija');
}

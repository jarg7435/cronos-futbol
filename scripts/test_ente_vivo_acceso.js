// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v706 · EL PANEL EN VIVO DEL ENTE INDIVIDUAL
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (capturas 10344-10348, producción v705), dos partes:
//
//   1 · «Al acceder como familiar en un entorno individual, el sistema deniega
//       el acceso con el error "No tienes permiso para ver partidos en vivo"».
//       🔑 LA CAUSA, medida contra producción (users/{uid} del reporte):
//          RAÍZ role = 'individual'   ·   clubId = individual_mt8l6zp8_whwd
//       y la lista blanca de `checkUserAccess` (live.html) sólo nombraba los
//       roles de CLUB. El ente individual se creó DESPUÉS de esa pantalla y
//       nadie volvió a mirarla: NINGUNA de sus cinco plazas podía entrar.
//       No era de reglas ni de datos — el `clubId` del ente ya casa con el de
//       sus partidos, así que con la puerta abierta el resto funciona solo.
//
//   2 · «El panel de seguimiento en vivo para familiares no está mostrando
//       los tres últimos sucesos… debe pintar la información detallada
//       exactamente igual que en el sistema de clubes».
//       🔑 «Exactamente igual» se consigue con UNA función, no copiando la de
//       live.html: js/shared/live-feed.js (ver test_live_card_feed.js).
//
//  LO QUE VIGILA ESTE FICHERO, y por qué cada cosa se rompe sola:
//
//   A · UNA LISTA BLANCA DE ROLES SE QUEDA VIEJA EN SILENCIO. Es exactamente
//       lo que pasó aquí: se añadió una familia de roles al producto y esta
//       puerta no se enteró. El fallo no da error de programación, da un
//       mensaje rojo de "no tienes permiso" — indistinguible de un permiso
//       mal puesto, y por eso costó llegar. Aquí se EJECUTA la puerta con los
//       cinco roles del ente.
//
//   B · SE JUZGA POR PLAZA, NO SÓLO POR EL ROL RAÍZ («la unidad es la PLAZA,
//       no el rol», v540/v547). La raíz de un perfil multi-plaza es sólo una
//       de sus plazas, y hay perfiles cuya raíz se quedó en un rol antiguo.
//
//   C · PERO UNA PLAZA REVOCADA NO ABRE NADA. Si `allRoles` entrara sin mirar
//       `status`/`isAuthorized`, una baja dejaría la puerta abierta: es el
//       defecto de v610 (la baja que no revocaba) por otra vía.
//
//   D · LA FAMILIA DEL ENTE SIGUE SIENDO FAMILIA. Los comentarios del cuerpo
//       técnico (v690) se ocultan comparando el rol con 'parent'. Al abrir el
//       visor al ente, 'parent_individual' NO es 'parent': sin arreglar esa
//       comparación, abrir la puerta le habría dado a las familias del ente
//       las notas tácticas del entrenador. Es la trampa de v668 — al renombrar
//       un valor, hay que buscar QUIÉN LO COMPARA.
//
//   E · EL DUEÑO DEL ENTE ES DESTINATARIO DE LOS PARTIDOS DE SU ENTE, como el
//       admin de un club de los suyos. Sin esa rama sólo le avisaban los
//       partidos creados por él mismo.
// ═══════════════════════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(nombre, cond, detalle) {
    if (cond) { console.log('PASS ' + nombre); pass++; }
    else { console.log('FAIL ' + nombre + (detalle ? '\n       ' + detalle : '')); fail++; }
}

const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const SHARED = fs.readFileSync(path.join(ROOT, 'js', 'shared', 'admin-shared.js'), 'utf8');

// ═══════════════════════════════════════════════════════════════════
//  PARTE 1 · la puerta de acceso, EJECUTADA
// ═══════════════════════════════════════════════════════════════════
console.log('── PARTE 1 · quién entra al visor ──');

// Se extrae el trozo de `checkUserAccess` que decide, y se ejecuta. No se mira
// el texto: una lista blanca puede parecer correcta y estar comparando otra
// cosa (es el "verde falso" de v679, que medía el ORDEN del texto).
const iniPuerta = LIVE.indexOf('const AUTHORIZED_ROLES = [');
const finPuerta = LIVE.indexOf('const _misRoles = _rolesDeLaCuenta(userData);');
ok('1a · se encuentra la puerta de acceso en live.html',
   iniPuerta !== -1 && finPuerta > iniPuerta);

let puerta = null;
if (iniPuerta !== -1 && finPuerta > iniPuerta) {
    const sandbox = { Array, String, console: { log() {}, warn() {} } };
    vm.createContext(sandbox);
    vm.runInContext(LIVE.slice(iniPuerta, finPuerta) +
        '\n;globalThis.puerta = (u) => _rolesDeLaCuenta(u)' +
        '\n    .some(r => AUTHORIZED_ROLES.includes(r));', sandbox);
    puerta = sandbox.puerta;
}

if (puerta) {
    // ── A · los roles del ente, uno por uno ──
    const DEL_ENTE = ['individual', 'admin_individual', 'entrenador_individual',
                      'parent_individual', 'padre_individual'];
    DEL_ENTE.forEach(rol => {
        ok('1b · [DEFECTO A] entra con rol raíz "' + rol + '"',
           puerta({ role: rol }) === true,
           'es el mensaje rojo de la captura 10344');
    });

    // El caso EXACTO del reporte, tal y como está el documento en producción.
    ok('1c · 🔑 el perfil del reporte (raíz individual + 4 plazas del ente) entra',
       puerta({
           role: 'individual',
           clubId: 'individual_mt8l6zp8_whwd',
           allRoles: [
               { role: 'individual', isAuthorized: true, status: 'active' },
               { role: 'individual', isAuthorized: true, status: 'active' },
               { role: 'parent',     isAuthorized: true, status: 'active' },
               { role: 'individual', isAuthorized: true, status: 'active' },
           ]
       }) === true);

    // ── los de club siguen entrando, que es lo que no se puede romper ──
    ['superadmin', 'admin', 'club_admin', 'director', 'coordinator',
     'user', 'parent'].forEach(rol => {
        ok('1d · sigue entrando el rol de club "' + rol + '"', puerta({ role: rol }) === true);
    });

    // ── B · por PLAZA, no sólo por la raíz ──
    ok('1e · [DEFECTO B] con la raíz en un rol desconocido, una PLAZA viva abre',
       puerta({ role: 'rol_que_ya_no_existe',
                allRoles: [{ role: 'parent_individual', isAuthorized: true, status: 'active' }] }) === true,
       'la unidad es la PLAZA, no el rol (v540/v547)');

    ok('1f · y una entrada de LEGADO sin status/isAuthorized también',
       puerta({ role: 'x', allRoles: [{ role: 'user' }] }) === true,
       'falla hacia el sí, como el arranque de la app: no se deja a nadie fuera sin decirle por qué');

    // ── C · lo que NO puede entrar ──
    ok('1g · [DEFECTO C] una plaza REVOCADA no abre la puerta',
       puerta({ role: 'nada',
                allRoles: [{ role: 'individual', isAuthorized: false, status: 'active' },
                           { role: 'user',       isAuthorized: true,  status: 'removed' },
                           { role: 'parent',     isAuthorized: true,  status: 'pending' }] }) === false,
       'una baja que no revoca es el defecto de v610 por otra puerta');

    ok('1h · un rol inventado sigue fuera',
       puerta({ role: 'periodista' }) === false);
    ok('1i · y una cuenta sin rol ni plazas tampoco entra',
       puerta({}) === false && puerta({ allRoles: [] }) === false);
}

// La lista blanca tiene que cubrir TODOS los roles que el producto sabe pintar:
// ROLE_META es la tabla de roles de la aplicación, y si aparece uno nuevo ahí
// sin entrar aquí, volvemos al mensaje rojo.
{
    const metaRoles = [];
    const re = /^\s*'?([a-z_]+)'?\s*:\s*\{\s*label:/gmi;
    const ini = SHARED.indexOf('window.ROLE_META = {');
    const fin = SHARED.indexOf('};', ini);
    let m;
    const bloque = SHARED.slice(ini, fin);
    while ((m = re.exec(bloque)) !== null) metaRoles.push(m[1]);
    ok('1j · se leen los roles de ROLE_META', metaRoles.length >= 10, metaRoles.join(','));
    if (puerta && metaRoles.length) {
        const fuera = metaRoles.filter(r => puerta({ role: r }) !== true);
        ok('1k · 🔑 TODO rol de ROLE_META puede usar el visor',
           fuera.length === 0,
           'se quedan fuera: ' + fuera.join(', '));
    }
}

// ═══════════════════════════════════════════════════════════════════
//  PARTE 2 · dentro del visor, el ente se comporta como su equivalente
// ═══════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · dentro del visor ──');

// ── D · la familia del ente NO ve los comentarios del cuerpo técnico ──
{
    const ini = LIVE.indexOf('const _ROLES_DE_FAMILIA');
    const fin = LIVE.indexOf('function _esEventoVisible');
    ok('2a · se encuentra la puerta de los comentarios', ini !== -1 && fin > ini);
    if (ini !== -1 && fin > ini) {
        const sandbox = { userData: null, console: { log() {}, warn() {} } };
        vm.createContext(sandbox);
        vm.runInContext(LIVE.slice(ini, fin) +
            '\n;globalThis.ve = (rol) => { userData = { role: rol }; return _veComentariosDePartido(); };',
            sandbox);
        const ve = sandbox.ve;
        ok('2b · [DEFECTO D] la familia de un ENTE tampoco ve los comentarios',
           ve('parent_individual') === false && ve('padre_individual') === false,
           'al abrir el visor al ente, "parent_individual" no es "parent": las notas del ' +
           'entrenador se le habrian colado en el historial');
        ok('2c · la familia de un club sigue sin verlos', ve('parent') === false);
        ok('2d · y el cuerpo técnico del ente SÍ los ve',
           ve('individual') === true && ve('entrenador_individual') === true &&
           ve('user') === true && ve('director') === true);
    }
}

// ── E · el dueño del ente es destinatario de los partidos de SU ente ──
{
    const ini = LIVE.indexOf('function _soyDestinatarioDe(m)');
    const fin = LIVE.indexOf('// ¿Este suceso puede avisarme AQUÍ Y AHORA?');
    ok('2e · se encuentra _soyDestinatarioDe', ini !== -1 && fin > ini);
    if (ini !== -1 && fin > ini) {
        const sandbox = { userData: null, window: {}, String,
                          console: { log() {}, warn() {} } };
        vm.createContext(sandbox);
        vm.runInContext(LIVE.slice(ini, fin) +
            '\n;globalThis.dest = (u, m) => { userData = u; return _soyDestinatarioDe(m); };',
            sandbox);
        const dest = sandbox.dest;
        const ENTE = 'individual_mt8l6zp8_whwd';
        // El partido lo lleva un entrenador del ente, NO el dueño.
        const partidoDelEnte = { clubId: ENTE, createdBy: 'otro_uid',
                                 coachEmail: 'entrena@ente.com' };
        ok('2f · [DEFECTO E] el dueño del ente recibe los partidos de su ente',
           dest({ role: 'individual', uid: 'yo', email: 'yo@x.com', clubId: ENTE },
                partidoDelEnte) === true,
           'sin esto solo le llegaban los partidos que creaba el mismo');
        ok('2g · y también el rol admin_individual',
           dest({ role: 'admin_individual', uid: 'yo', email: 'yo@x.com', clubId: ENTE },
                partidoDelEnte) === true);
        ok('2h · 🔑 pero NO los de otra entidad (el aislamiento no se toca)',
           dest({ role: 'individual', uid: 'yo', email: 'yo@x.com', clubId: ENTE },
                { clubId: 'otro_club', createdBy: 'x', coachEmail: 'y@z.com' }) === false);
        ok('2i · la familia del ente sigue recibiendo sólo lo suyo',
           dest({ role: 'parent_individual', uid: 'yo', email: 'yo@x.com', clubId: ENTE },
                partidoDelEnte) === false,
           'igual que la familia de un club: entra al partido de su jugador');
    }
}

// ── el botón de volver al listado: el ente lleva DOS equipos ──
{
    const m = LIVE.match(/const _LIVE_ROLES_MULTIPARTIDO = \[([\s\S]*?)\];/);
    ok('2j · se encuentra la lista de roles multipartido', !!m);
    if (m) {
        const lista = m[1];
        ['individual', 'admin_individual', 'entrenador_individual'].forEach(rol => {
            ok('2k · el ente puede volver al listado con "' + rol + '"',
               lista.includes("'" + rol + "'"),
               'el dueño del ente puede llevar DOS equipos: dos partidos a la vez');
        });
        ok('2l · 🔑 la familia NO (entra al partido de su jugador, como en un club)',
           !/'parent'/.test(lista) && !/'parent_individual'/.test(lista));
    }
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

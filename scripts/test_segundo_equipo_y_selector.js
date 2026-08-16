// ═══════════════════════════════════════════════════════════════════════════
//  EL SEGUNDO EQUIPO (F7 + F11): PEDIRLO, APROBARLO Y ELEGIRLO — v540
// ═══════════════════════════════════════════════════════════════════════════
//  Tres incidencias reales del autor (2026-08-15), y las tres son LA MISMA
//  pieza que falta: el sistema razona en "roles" cuando la unidad real es la
//  PLAZA — rol + club + categoría.
//
//  🔑🔑🔑 MEDIDO POR REST EN PRODUCCIÓN ANTES DE ESCRIBIR NADA
//  (brunoromar2012, uid lSx6EVF7lWUjHudHDV9O1bRkr5o1):
//    · Sus TRES entradas de entrenador en CD DÍA están `status:'removed'`.
//    · Y aun así el formulario le respondía "Ya tienes una solicitud de
//      entrenador en este club registrada": el buscador de duplicados NO
//      miraba el estado, pese a que su propio comentario decía
//      "(only if NOT removed)". Un rol REVOCADO le cerraba la puerta.
//    · Su solicitud `fwd_..._user` de **benjamin** figura `sa_approved`
//      desde el 14/08 21:37… y en `allRoles` NO EXISTE ninguna entrada de
//      benjamin. El aprobar casaba por `ar.role === role`, así que reactivó
//      las plazas viejas (juvenil, cadete) y nunca creó la nueva.
//
//  🔑 LA UNIDAD ES LA PLAZA, NO EL ROL. Un entrenador puede tener DOS
//  entradas `role:'user'` en el mismo club (un F7 y un F11, v537). Cualquier
//  `find(r => r.role === 'user')` coge una al azar y cualquier
//  `map(r => r.role === 'user' ? activar : r)` las toca las DOS.
//
//  ⚠️ ESTO NO AFLOJA LA REGLA DE v537: primero se comprueba que la
//  combinación es legal (un F7 y un F11) y sólo después si esa plaza
//  concreta ya existe. Las dos puertas, en ese orden.
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
const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '')
                     .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// utils.js de verdad, para probar los resolutores REALES.
const sb = { console: { log() {}, warn() {}, error() {} }, document: { getElementById: () => null },
             localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
             navigator: {}, setTimeout: () => {} };
sb.window = sb;
vm.createContext(sb);
try { vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8'), sb); }
catch (e) { console.log('  (aviso al cargar utils.js: ' + e.message + ')'); }

const CLUB = 'club_mqvr9m11_g9kj';
const rol = (category, extra) => Object.assign({ role: 'user', clubId: CLUB, category: category,
                                                 isAuthorized: true, status: 'active' }, extra || {});

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · la PLAZA es rol + club + categoría ──');
// ───────────────────────────────────────────────────────────────────────────
const mismaPlaza = sb.window.cronosMismaPlaza;
ok('1a · existe un resolutor único de plaza', typeof mismaPlaza === 'function',
   'sin él, cada punto de escritura se inventará su propia comparación');

if (typeof mismaPlaza === 'function') {
    ok('1b · 🔑 dos equipos del MISMO entrenador NO son la misma plaza',
       mismaPlaza(rol('benjamin'), { role: 'user', clubId: CLUB, category: 'cadete' }) === false,
       'es el fallo que bloqueaba F7+F11 en el registro');
    ok('1c · y la misma categoría SÍ lo es',
       mismaPlaza(rol('benjamin'), { role: 'user', clubId: CLUB, category: 'benjamin' }) === true);
    ok('1d · la comparación aguanta acentos y mayúsculas',
       mismaPlaza(rol('Alevín'), { role: 'user', clubId: CLUB, category: 'alevin' }) === true,
       'los datos reales llegan escritos de las dos formas');
    ok('1e · ⚠️ la SUBCATEGORÍA distingue: Cadete A y Cadete B son dos equipos',
       mismaPlaza(rol('cadete', { subcategory: 'A' }),
                  { role: 'user', clubId: CLUB, category: 'cadete', subcategory: 'B' }) === false);
    ok('1f · otro club es otra plaza',
       mismaPlaza(rol('benjamin'), { role: 'user', clubId: 'otro', category: 'benjamin' }) === false);
    ok('1g · ⚠️ para los roles SIN equipo la plaza es sólo rol+club',
       mismaPlaza({ role: 'parent', clubId: CLUB, category: 'juvenil' },
                  { role: 'parent', clubId: CLUB, category: 'cadete' }) === true,
       'un padre no ocupa categoría: si no, pediría el mismo rol una y otra vez');
    ok('1h · roles distintos nunca son la misma plaza',
       mismaPlaza(rol('benjamin'), { role: 'parent', clubId: CLUB, category: 'benjamin' }) === false);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · los equipos VIVOS de un entrenador ──');
// ───────────────────────────────────────────────────────────────────────────
const equipos = sb.window.cronosEquiposDeEntrenador;
ok('2a · existe el listado de equipos del entrenador', typeof equipos === 'function',
   'el selector de doble modalidad no tiene de dónde leer');

if (typeof equipos === 'function') {
    const dos = equipos([rol('benjamin', { subcategory: 'C' }), rol('cadete', { subcategory: 'A' })], CLUB);
    ok('2b · devuelve los DOS equipos', Array.isArray(dos) && dos.length === 2,
       JSON.stringify(dos));
    ok('2c · 🔑 con su modalidad derivada de la categoría',
       dos.length === 2 && dos[0].modalidad === 'f7' && dos[1].modalidad === 'f11',
       JSON.stringify(dos.map(e => e.modalidad)));
    ok('2d · y una etiqueta legible para enseñarla',
       dos.length === 2 && /C/.test(dos[0].etiqueta || '') && /Benj/i.test(dos[0].etiqueta || ''),
       JSON.stringify(dos.map(e => e.etiqueta)));
    ok('2e · ⚠️ los REVOCADOS no salen (es el caso real de producción)',
       equipos([rol('benjamin', { status: 'removed' }), rol('cadete')], CLUB).length === 1);
    ok('2f · ni los pendientes de aprobación',
       equipos([rol('benjamin', { isAuthorized: false, status: 'pending_club_admin' })], CLUB).length === 0,
       'entraría en un equipo que todavía no le han concedido');
    ok('2g · sólo el rol de entrenador ocupa equipo',
       equipos([rol('benjamin', { role: 'parent' }), rol('cadete', { role: 'coordinator' })], CLUB).length === 0);
    ok('2h · no revienta con datos ausentes',
       equipos(null, CLUB).length === 0 && equipos([], null).length === 0);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el REGISTRO deja pedir el segundo equipo ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const AUTH = sinCom(fs.readFileSync(path.join(RAIZ, 'js/services/auth.js'), 'utf8'));
    const iDup = AUTH.indexOf('let duplicate =');
    const bloqueDup = iDup === -1 ? '' : AUTH.slice(Math.max(0, iDup - 900), iDup + 1400);

    ok('3a · 🔑🔑🔑 el duplicado se decide por PLAZA, no por rol+club',
       /cronosMismaPlaza/.test(bloqueDup),
       'F7+F11 seguiría respondiendo "Ya tienes el rol de entrenador en este club"');
    ok('3b · 🔑🔑 un rol REVOCADO ya no cuenta como duplicado',
       /removed/.test(bloqueDup) && /rejected/.test(bloqueDup),
       'es literalmente lo que le pasó a brunoromar2012: 3 plazas removed le cerraban la puerta');
    ok('3c · ⚠️ pero una solicitud PENDIENTE sí sigue contando',
       !/status !== 'pending/.test(bloqueDup),
       'si no, cada intento crearía una solicitud nueva y el admin vería la lista duplicada');

    // 🔑 Sin esto, la solicitud del 2º equipo PISA la del 1º: mismo id.
    ok('3d · 🔑 la solicitud del segundo equipo no pisa la del primero',
       /self_reg_[\s\S]{0,220}_sufijoPlaza|_sufijoPlaza[\s\S]{0,120}self_reg_/.test(AUTH) ||
       /const _sufijoPlaza/.test(AUTH),
       'el id self_reg_<uid>_user_<club> es el MISMO para los dos equipos');
    ok('3e · y el documento secundario tampoco',
       /const secondaryId = [\s\S]{0,200}_sufijoPlaza/.test(AUTH),
       'users/<uid>_user_<club> se sobrescribiría con el segundo equipo');

    // ⚠️ La regla de v537 sigue delante: primero la legalidad, luego el duplicado.
    const iVal = AUTH.indexOf('cronosPuedeLlevarEquipo(');
    ok('3f · ⚠️ la regla de v537 se comprueba ANTES que el duplicado (no se afloja)',
       iVal !== -1 && iDup !== -1 && iVal < iDup,
       'dos F7 volverían a colarse por el formulario');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · aprobar toca UNA plaza, no todas ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const CLUBP  = sinCom(fs.readFileSync(path.join(RAIZ, 'js/admin/club/panel.js'), 'utf8'));
    const EXTRAS = sinCom(fs.readFileSync(path.join(RAIZ, 'js/admin/superadmin/extras.js'), 'utf8'));

    const iApr = CLUBP.indexOf('window.caApproveRequest');
    const bloqueApr = iApr === -1 ? '' : CLUBP.slice(iApr, iApr + 3200);
    ok('4a · 🔑 el aprobar del club identifica la plaza',
       /cronosMismaPlaza/.test(bloqueApr),
       'con dos entradas user, .find() coge una al azar y .map() activa las dos');
    ok('4b · ⚠️ y recibe la categoría de la SOLICITUD, no del primer rol que encuentre',
       /caApproveRequest = async \(uid, role, email, cat/.test(bloqueApr),
       'validaba la combinación contra la categoría equivocada');

    // ⚠️ VENTANA MEDIDA, NO ESTIMADA. Con 12000 caracteres la aserción 4c salía
    // VERDE con el defecto puesto: el `map` está 14.656 caracteres por debajo
    // del ancla y quedaba fuera del corte. Cuarta vez en el proyecto que una
    // ventana corta finge un verde — se mide con indexOf antes de fijarla.
    const iAp = EXTRAS.indexOf('saExtApprove = async function');
    const bloqueAp = iAp === -1 ? '' : EXTRAS.slice(iAp, iAp + 20000);
    ok('4c0 · (la ventana llega hasta el mapeo de roles)',
       /finalRoles/.test(bloqueAp), 'la ventana se queda corta y 4c mediría el vacío');
    ok('4c · 🔑🔑🔑 el aprobar del SA ya no casa por `ar.role === role` a secas',
       !/var isThisRole = \(ar\.role === role\);/.test(bloqueAp),
       'ESTE es el defecto que dejó la aprobación de benjamin sin crear la plaza');
    ok('4d · sino por plaza completa',
       /cronosMismaPlaza/.test(bloqueAp));
    ok('4e · 🔑 y si la plaza aprobada no existía todavía, la CREA',
       /_plazaExiste|_yaEstaLaPlaza/.test(bloqueAp),
       'la solicitud figuraba aprobada y el entrenador se quedaba sin equipo');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4b · la solicitud del 2º equipo LLEGA a la bandeja ──');
// ───────────────────────────────────────────────────────────────────────────
//  🔑🔑🔑 v547 · EL PUNTO QUE SE ESCAPÓ EN v540. El panel del club descarta
//  las solicitudes de quien "ya tiene ese rol", y lo comparaba SÓLO por `role`:
//  a un entrenador con un equipo se le tiraba a la basura la solicitud del
//  SEGUNDO. Medido con el caso real del autor (arinagazone, 2026-08-16): su
//  solicitud de `regional/A` EXISTÍA en la base de datos en
//  `pending_club_admin` y aun así no aparecía en el panel, porque ya tenía
//  `user` autorizado en `alevin/C`. La solicitud se creaba bien; el filtro la
//  ocultaba.
{
    const CLUBP = sinCom(fs.readFileSync(path.join(RAIZ, 'js/admin/club/panel.js'), 'utf8'));
    const i = CLUBP.indexOf('const pendingFromPlatformReqs');
    const bloque = i === -1 ? '' : CLUBP.slice(i, i + 3000);
    ok('4b1 · 🔑🔑🔑 el filtro de "ya autorizado" compara la PLAZA, no el rol',
       /cronosMismaPlaza/.test(bloque),
       'la solicitud del segundo equipo no llegaría nunca al administrador');
    ok('4b2 · ⚠️ ya no basta con que coincida `requestedRole` para descartarla',
       !/some\(r => r\.role === pr\.requestedRole && r\.isAuthorized/.test(bloque),
       'ése era exactamente el descarte que ocultaba la solicitud');
    ok('4b3 · y el filtro de "ya pendiente" usa el mismo criterio',
       (bloque.match(/_esMismaPlaza/g) || []).length >= 3,
       'si no, una plaza pendiente taparía la solicitud de OTRA plaza');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · el entrenador ELIGE entre sus dos equipos ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const LAUNCH = sinCom(fs.readFileSync(path.join(RAIZ, 'js/services/auth/role-launch.js'), 'utf8'));
    const SETUP  = sinCom(fs.readFileSync(path.join(RAIZ, 'js/core/setup-modal.js'), 'utf8'));

    ok('5a · 🔑 al arrancar se respeta el equipo elegido, no el primero de la lista',
       /cronosEquipoElegido|_cronosTeamChoice/.test(LAUNCH),
       'me.allRoles.find(...) devuelve siempre el mismo equipo');
    ok('5b · y la categoría/subcategoría se fijan SIEMPRE a las de ese equipo',
       /me\.category    = |me\.category = /.test(LAUNCH) &&
       !/if \(roleEntry\.category\)    me\.category    = roleEntry\.category;/.test(LAUNCH),
       'con `if (roleEntry.category)` se quedaba pegada la del equipo anterior');
    ok('5c · 🔑🔑 el panel del entrenador enseña un selector de equipo',
       /cronosSelectorEquipo|_cronosCambiarEquipo/.test(SETUP),
       'es el requisito 3 del autor: pestañas claras entre su F7 y su F11');
    ok('5d · ⚠️ y sólo cuando de verdad tiene más de uno',
       /length > 1|length >= 2/.test(SETUP),
       'un entrenador de un solo equipo no debe ver un selector inútil');
    ok('5e · el cambio de equipo re-sincroniza modalidad y categoría',
       /_cronosCambiarEquipo/.test(SETUP) && /openSetupModal\(\)/.test(SETUP));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 6 · el caso REAL de producción, con sus datos ──');
// ───────────────────────────────────────────────────────────────────────────
// 🔑 Copiado tal cual de `users/lSx6EVF7lWUjHudHDV9O1bRkr5o1` leído por REST
// el 2026-08-15. No es un ejemplo inventado: es el expediente que motivó las
// tres incidencias. Si algún día el resolutor cambia, esto dice si la persona
// del informe habría quedado bien atendida.
{
    const BRUNO = [
        { role: 'individual', clubId: 'individual_mqvu0d9r_sakg', category: 'juvenil', subcategory: null,
          isAuthorized: true, status: 'active' },
        { role: 'user', clubId: 'club_mqvr9m11_g9kj', category: 'juvenil', subcategory: 'B',
          isAuthorized: false, status: 'removed' },
        { role: 'parent', clubId: 'individual_mqvu0d9r_sakg', category: 'juvenil', subcategory: 'B',
          isAuthorized: true, status: 'active' },
        { role: 'user', clubId: 'club_mqvr9m11_g9kj', category: null, subcategory: null,
          isAuthorized: false, status: 'removed' },
        { role: 'parent', clubId: null, isAuthorized: true, status: 'active' },
        { role: 'user', clubId: 'club_mqvr9m11_g9kj', category: 'cadete', subcategory: 'C',
          isAuthorized: false, status: 'removed' },
    ];
    const CLUB_DIA = 'club_mqvr9m11_g9kj';
    const PEDIDA = { role: 'user', clubId: CLUB_DIA, category: 'benjamin', subcategory: null };

    // (a) La regla de v537 no debe estorbarle: sus tres plazas están revocadas.
    const puede = sb.window.cronosPuedeLlevarEquipo;
    ok('6a · con sus 3 plazas REVOCADAS, la regla de los dos equipos le deja pedir',
       typeof puede === 'function' && puede(BRUNO, 'benjamin', CLUB_DIA).ok === true,
       JSON.stringify(typeof puede === 'function' ? puede(BRUNO, 'benjamin', CLUB_DIA) : null));

    // (b) 🔑🔑🔑 Ninguna de sus entradas ES la plaza de benjamin: por eso el
    //     aprobar tiene que CREARLA. Con `ar.role === role` el `some` daba
    //     true y la plaza concedida no se creó nunca (defecto medido).
    const casa = BRUNO.filter(r => sb.window.cronosMismaPlaza(r, PEDIDA));
    ok('6b · 🔑🔑🔑 ninguna plaza suya es la de Benjamín → el aprobar la CREA',
       casa.length === 0, JSON.stringify(casa));
    ok('6c · ⚠️ y con el criterio VIEJO (sólo el rol) casaban TRES: por eso se aplastaban',
       BRUNO.filter(r => r.role === 'user').length === 3);

    // (d) Sus plazas revocadas no pueden contar como duplicado en el registro.
    const _plazaLibre = (r) => !r || r.status === 'removed' || r.status === 'rejected';
    ok('6d · 🔑🔑 el registro ya no encuentra duplicado (todas están removed)',
       BRUNO.filter(r => !_plazaLibre(r) && sb.window.cronosMismaPlaza(r, PEDIDA)).length === 0,
       'era el "Ya tienes una solicitud de entrenador registrada" que le salía');

    // (e) Y una vez concedido Benjamín (F7), pedir un F11 sigue siendo legal.
    const conBenjamin = BRUNO.concat([{ role: 'user', clubId: CLUB_DIA, category: 'benjamin',
                                        subcategory: null, isAuthorized: true, status: 'active' }]);
    ok('6e · ✅ ya con su F7 vivo, pedir un F11 se permite…',
       puede(conBenjamin, 'cadete', CLUB_DIA).ok === true);
    ok('6f · …y un segundo F7 se sigue rechazando',
       puede(conBenjamin, 'alevin', CLUB_DIA).ok === false);
    ok('6g · 🔑 con los dos vivos, el selector le ofrece DOS equipos',
       sb.window.cronosEquiposDeEntrenador(
           conBenjamin.concat([{ role: 'user', clubId: CLUB_DIA, category: 'cadete', subcategory: 'A',
                                 isAuthorized: true, status: 'active' }]), CLUB_DIA).length === 2);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 7 · la categoría del entrenador está BLOQUEADA ──');
// ───────────────────────────────────────────────────────────────────────────
//  🔒 v548 · Reportado por el autor (captura 8983): un entrenador de
//  Prebenjamín A tenía los desplegables de categoría y subcategoría ABIERTOS y
//  podía cambiarse de equipo a voluntad. El bloqueo existía, pero era
//  CONDICIONAL: la categoría sólo se cerraba si el valor construido casaba con
//  una opción del desplegable, y la subcategoría sólo si era 'A', 'B' o 'C'.
{
    const SM  = sinCom(fs.readFileSync(path.join(RAIZ, 'js/core/setup-modal.js'), 'utf8'));
    const UT2 = sinCom(fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8'));
    const iF  = SM.indexOf('function _forceCategorySelect');
    const bloqueF = iF === -1 ? '' : SM.slice(iF, iF + 2800);

    ok('7a · 🔒 el desplegable de CATEGORÍA se cierra siempre, case o no case',
       /catSel\.disabled = true;/.test(bloqueF) &&
       !/if \(opt\) \{[\s\S]{0,160}catSel\.disabled = true/.test(bloqueF),
       'si no se sabe pintar su categoría, dejarle elegir otra es peor');
    ok('7b · 🔒 y el de SUBCATEGORÍA también, sea cual sea su valor',
       /subSel\.disabled = true;/.test(bloqueF) &&
       !/includes\(userSub\)[\s\S]{0,160}subSel\.disabled = true/.test(bloqueF),
       "antes sólo se bloqueaba con 'A', 'B' o 'C'");
    ok('7c · ⚠️ los reintentos corren SIEMPRE (syncSetupMode repuebla el select)',
       !/if \(!_forceCategorySelect\(\)\) \{/.test(SM),
       'si sólo corren al fallar, el repintado borra el valor y nadie lo repone');
    ok('7d · 🔑🔑 al CONFIRMAR se impone su categoría (`disabled` es cosmético)',
       /_cronosCategoriaValor/.test(SM.slice(SM.indexOf('function confirmSetup'))),
       'quitar el disabled desde el inspector no puede cambiarle el equipo');
    ok('7e · ⚠️ y sólo se impone a quien TIENE equipo (el director sigue eligiendo)',
       /catEl\.disabled/.test(SM.slice(SM.indexOf('function confirmSetup'))));
    ok('7f · la cascada de categorías vive en UN solo sitio (utils.js)',
       /_cronosCategoriaValor/.test(UT2) &&
       (bloqueF.match(/includes\('prebenj'\)/g) || []).length === 0,
       'dos copias divergen y la pantalla acaba diciendo una cosa y el informe otra');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 8 · el panel del club lee del SERVIDOR ──');
// ───────────────────────────────────────────────────────────────────────────
//  🔑🔑🔑 v549 · El autor veía 5 categorías y sin Cadete **aunque hiciera
//  Ctrl+Shift+R**, y las 6 correctas en incógnito. Ese atajo vacía la caché
//  HTTP (ficheros), pero los datos salían de la caché PERSISTENTE de Firestore
//  —IndexedDB— que sobrevive a cualquier recarga. En incógnito no había
//  IndexedDB previo: por eso allí salía bien. La diferencia nunca estuvo en el
//  código.
{
    const CLUBP = sinCom(fs.readFileSync(path.join(RAIZ, 'js/admin/club/panel.js'), 'utf8'));
    const i = CLUBP.indexOf('let clubSnap, usersSnap');
    const bloque = i === -1 ? '' : CLUBP.slice(Math.max(0, i - 1800), i + 1400);
    ok('8a · 🔑🔑🔑 la carga del panel pide los datos al servidor',
       /getDocsFromServer/.test(bloque) && /getDocFromServer/.test(bloque),
       'con la caché en disco el administrador gestiona sobre datos viejos');
    ok('8b · ⚠️ con respaldo: sin cobertura no se queda sin abrir',
       /_delServidor/.test(bloque) && /respaldo/.test(bloque),
       '`*FromServer` LANZA sin red; sin catch el panel no abriría');
    // ⚠️ La caché NO se borra: live.html comparte el IndexedDB (lección v470).
    ok('8c · ⚠️ y NO se borra la caché de Firestore (se la comparte live.html)',
       !/clearIndexedDbPersistence|deleteDatabase/.test(CLUBP),
       'borrarla le mata el cliente al visor: es la emergencia de v470');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 9 · el catálogo de categorías se IMPONE ──');
// ───────────────────────────────────────────────────────────────────────────
//  🔑🔑🔑 v550 · El autor veía **5 categorías y sin Cadete** en la ventana
//  normal y las 9 en incógnito, y seguía igual DESPUÉS de borrar IndexedDB,
//  caché y cookies. No era el dato: era el VOCABULARIO con el que se pinta.
//  `window.CT_CATEGORIES = window.CT_CATEGORIES || CT_CATEGORIES` cedía ante
//  cualquier definición previa — basta con que el navegador evalúe una copia
//  ANTIGUA del fichero antes que la nueva para quedarse con el catálogo viejo
//  PARA SIEMPRE, y sin un solo error en consola.
{
    const CT = fs.readFileSync(path.join(RAIZ, 'js/admin/shared/category-tree.js'), 'utf8');
    // ⚠️ SIN COMENTARIOS: el fichero CITA el código viejo para explicar por qué
    // se retiró, y esta aserción salía roja midiendo esa cita. Es la misma
    // trampa del `switchTab(` en el guard del consentimiento y del
    // `position:sticky` en el de paridad. Tercera vez en la sesión.
    ok('9a · 🔑🔑🔑 el catálogo ya no cede ante una definición previa',
       !/window\.CT_CATEGORIES = window\.CT_CATEGORIES \|\| CT_CATEGORIES/.test(sinCom(CT)),
       'con el `||`, una copia antigua del fichero congela el vocabulario');
    ok('9b · se impone y además conserva lo que otro hubiera añadido',
       /window\.CT_CATEGORIES = CT_CATEGORIES\.concat\(extras\)/.test(CT));
    ok('9c · Cadete sigue en el catálogo (era la que faltaba)',
       /id: 'cadete'/.test(CT));
    // Se ejecuta de verdad, con un catálogo viejo puesto por delante.
    const sb = { console: { log() {}, warn() {} },
                 document: { getElementById: () => null, addEventListener() {},
                             createElement: () => ({ style: {}, addEventListener() {} }) },
                 localStorage: { getItem: () => null, setItem() {} }, setTimeout: () => {} };
    sb.window = sb;
    sb.CT_CATEGORIES = [{ id: 'prebenjamin' }, { id: 'benjamin' }, { id: 'alevin' },
                        { id: 'infantil' }, { id: 'juvenil' }];
    vm.createContext(sb);
    try { vm.runInContext(CT, sb); } catch (e) { /* el módulo toca DOM: da igual */ }
    const ids = (sb.window.CT_CATEGORIES || []).map(c => c.id);
    ok('9d · 🔑 con un catálogo VIEJO por delante, Cadete aparece igual',
       ids.indexOf('cadete') !== -1, JSON.stringify(ids));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 10 · ⭐ el SEGUNDO equipo se puede pulsar SIEMPRE (v556) ──');
// ───────────────────────────────────────────────────────────────────────────
//  🚨🚨🚨 Reportado por el autor (captura 9039): con Alevín C (F7) y Regional A
//  (F11) asignados, pulsar el segundo no hacía nada y salía
//  "Termina o cierra el partido en curso antes de cambiar de equipo" — SIN
//  haber empezado ningún partido. Quedaba obligado a jugar con el primero.
//
//  🔑🔑🔑 LA GUARDA NO FALLABA A VECES: CERRABA SIEMPRE. `role-launch.js` pone
//  #main-container en 'flex' EN EL LOGIN de cualquier rol de campo, y
//  `matchPhase` NACE en '1st_half' (app-init.js). Las dos condiciones de
//  `cronosHayPartidoEnCurso` estaban cumplidas desde el primer segundo.
{
    const SM = sinCom(fs.readFileSync(path.join(RAIZ, 'js/core/setup-modal.js'), 'utf8'));
    const iC = SM.indexOf('window._cronosCambiarEquipo');
    const bloqueC = iC === -1 ? '' : SM.slice(iC, iC + 2600);

    ok('10a · 🔑🔑🔑 cambiar de equipo ya no puede abortar por el partido',
       bloqueC !== '' && !/cronosHayPartidoEnCurso\(\)\s*\)\s*\{[\s\S]{0,300}return;/.test(bloqueC),
       'ese `return` es exactamente lo que dejaba el segundo equipo inalcanzable');
    ok('10b · y el aviso que bloqueaba ya no existe en ninguna parte',
       !/antes de cambiar de equipo/.test(SM),
       'mientras el texto siga, alguna rama lo puede seguir enseñando');
    // v557 · La re-sincronización se mudó a `_cronosAplicarEquipoActivo`, que
    // es la MISMA pieza que usa ahora `_restoreActiveMatch` al retomar el
    // partido del otro equipo (app-init.js). La aserción sigue exigiendo lo
    // mismo —categoría re-sincronizada, formulario pendiente tirado y panel
    // repintado—, sólo que mirando donde vive cada mitad. Con una copia en
    // cada sitio acabarían divergiendo, que es el fallo que se venía a evitar.
    const iA = SM.indexOf('window._cronosAplicarEquipoActivo');
    const bloqueA = iA === -1 ? '' : SM.slice(iA, iA + 1600);
    ok('10c · ⚠️ el cambio sigue re-sincronizando categoría y repintando',
       /_cronosAplicarEquipoActivo\(teamId\)/.test(bloqueC) && /openSetupModal\(\)/.test(bloqueC) &&
       bloqueA !== '' && /_pendingSetupState = null/.test(bloqueA) &&
       /category:\s*destino\.category/.test(bloqueA),
       'sin esto el panel diría Fútbol 11 con la categoría del equipo de Fútbol 7');

    // ── Y la función que mentía, medida DE VERDAD en el estado del login ──
    function sandbox(elems, estado) {
        const sb2 = Object.assign({
            console: { log() {}, warn() {}, error() {} },
            document: { getElementById: (id) => elems[id] || null },
            localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
            navigator: {}, setTimeout: () => {}
        }, estado || {});
        sb2.window = sb2;
        vm.createContext(sb2);
        try { vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8'), sb2); }
        catch (e) { /* utils toca DOM en otras piezas: aquí sólo interesa ésta */ }
        return sb2;
    }
    const campoVisible = { 'main-container': { style: { display: 'flex' } } };
    const panelAbierto = { 'main-container': { style: { display: 'flex' } },
                           'setup-modal':    { style: { display: 'flex' } } };

    const recienEntrado = sandbox(panelAbierto, { isRunning: false, matchPhase: '1st_half',
                                                  masterTimeH1: 0, masterTimeH2: 0 });
    ok('10d · 🔑🔑🔑 recién entrado (campo visible, fase 1ª, reloj a 0) NO hay partido',
       recienEntrado.window.cronosHayPartidoEnCurso() === false,
       'éste es EL estado del autor en la captura 9039: decía que sí');

    const conPanel = sandbox(panelAbierto, { isRunning: false, matchPhase: '2nd_half',
                                             masterTimeH1: 1800, masterTimeH2: 300 });
    ok('10e · con el PANEL abierto encima, lo que se ve es el panel',
       conPanel.window.cronosHayPartidoEnCurso() === false,
       '#setup-modal se pinta sin ocultar el campo, a propósito');

    const jugando = sandbox(campoVisible, { isRunning: true, matchPhase: '1st_half',
                                            masterTimeH1: 0, masterTimeH2: 0 });
    ok('10f · ✅ el cronómetro corriendo sí es un partido',
       jugando.window.cronosHayPartidoEnCurso() === true);

    const pausado = sandbox(campoVisible, { isRunning: false, matchPhase: 'break',
                                            masterTimeH1: 1500, masterTimeH2: 0 });
    ok('10g · ✅ y el DESCANSO con tiempo jugado también',
       pausado.window.cronosHayPartidoEnCurso() === true,
       'un partido en pausa no deja de ser un partido');

    const terminado = sandbox(campoVisible, { isRunning: false, matchPhase: 'finished',
                                              masterTimeH1: 1800, masterTimeH2: 1800 });
    ok('10h · el partido terminado no cuenta',
       terminado.window.cronosHayPartidoEnCurso() === false);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ Segundo equipo: se pide, se aprueba en su plaza y el entrenador lo elige');

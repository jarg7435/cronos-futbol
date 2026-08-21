// ═══════════════════════════════════════════════════════════════════════════
//  v598 · EL ENTRENADOR ADMINISTRADOR INDIVIDUAL — GUARD
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-08-21), cuatro puntos:
//   1. "Entrenador Individual" y "Administrador Individual" pasan a ser
//      OBLIGATORIAMENTE el mismo ente único, con un panel compartido para lo
//      administrativo y para los partidos.
//   2. Registro y SuperAdmin adaptados: al registrarse se le asigna ese rol
//      unificado, y debajo de él sólo cuelgan padres/tutores.
//   3. Botón de "Volver" en la creación de partidos, para no quedarse atrapado.
//   4. Puede operar en DOS categorías y DOS subcategorías (una F7 y otra F11);
//      el resto quedan inhabilitadas.
//
//  🔑🔑 LO QUE MÁS RIESGO TIENE AQUÍ, y por eso es el grueso del guard: la
//  regla de los dos equipos NO se ha reescrito, se ha AMPLIADO a quién alcanza.
//  `cronosPuedeLlevarEquipo` filtraba por `r.role === 'user'`; con el rol
//  unificado escribiéndose como 'individual' le contaba CERO equipos y le
//  dejaba pasar cualquier cosa. El candado parecía puesto y no cerraba sobre
//  él. Por eso las partes 3 y 4 EJECUTAN el validador real —no lo censan— y
//  miran la decisión con roles 'individual'.
//
//  🔑 Y la parte 2 vigila la otra mitad del mismo defecto: "quién lleva equipo"
//  estaba escrito DOS veces y con dos contenidos distintos (['user'] en el
//  candado, ['user','coach'] en el selector). Ahora es una sola lista. Si
//  alguien vuelve a escribir una a mano, esa parte se pone roja.
//
//  ⚠️ DECISIÓN DEL AUTOR QUE ESTE GUARD FIJA: las plazas de "Entrenador
//  Individual" que YA existan siguen vivas. Se cierra la puerta a altas nuevas
//  sin tocar un solo dato de producción. Por eso la parte 5 exige que el
//  SuperAdmin SIGA sabiendo pintarlas.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); fallos++; }
}

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// ⚠️ CRLF y comentarios de bloque: sin quitar los dos, una aserción casa con la
//    explicación del defecto en vez de con el código (mordió en la v597).
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
                       .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const sinComHtml = (t) => t.replace(/<!--[\s\S]*?-->/g, '');

const AUTH   = sinCom(leer('js/services/auth.js'));
const IND    = sinCom(leer('js/admin/individual/panel.js'));
const UTILS  = sinCom(leer('js/core/utils.js'));
const SETUP  = sinCom(leer('js/core/setup-modal.js'));
const SATAB  = sinCom(leer('js/admin/superadmin/individuals-tab.js'));
const INDEX  = sinComHtml(leer('index.html'));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · el registro ofrece el ente UNIFICADO, y sólo padres debajo ──');
// ───────────────────────────────────────────────────────────────────────────
ok('1a · el desplegable de rol lo llama "Entrenador Administrador Individual"',
   /<option value="individual">[^<]*Entrenador Administrador Individual/.test(INDEX));
// 🔑 EL VALOR NO CAMBIA. Inventar un rol nuevo habría obligado a que reglas,
//    recuentos, aprobaciones y documentos ya escritos coincidieran a la primera.
ok('1b · 🔑 pero el VALOR sigue siendo "individual" (no se inventa un rol nuevo)',
   /<option value="individual">/.test(INDEX) &&
   !/<option value="entrenador_admin_individual"/.test(INDEX));

{
    // Bajo un ente sólo pueden quedar DOS roles: él y los padres.
    const m = AUTH.match(/const ROLES_BAJO_ENTE = \[([^\]]*)\]/);
    const lista = m ? m[1].replace(/['"\s]/g, '').split(',').filter(Boolean).sort() : null;
    ok('1c · 🔑🔑 bajo un ente sólo se ofrecen parent + individual',
       !!lista && lista.join(',') === 'individual,parent', lista);
    ok('1d · 🔑 y "user" (Entrenador Individual) YA NO se ofrece',
       !!lista && lista.indexOf('user') < 0, lista);
}
// ⚠️ La trampa del repliegue: si al elegir un ente el formulario se queda en un
//    `<option disabled>`, el usuario no puede corregirlo sin tocar otra cosa.
ok('1e · ⚠️ el repliegue es a "parent", que SÍ está habilitado, no a "user"',
   /if \(!ROLES_BAJO_ENTE\.includes\(currentRole\)\) \{\s*roleSelect\.value = 'parent';/.test(AUTH));

// 🔑 Sin categoría en el alta, el candado F7/F11 no tendría contra qué comparar.
{
    const m = AUTH.match(/const needsCategory = \[([^\]]*)\]\.includes\(role\)/);
    const lista = m ? m[1].replace(/['"\s]/g, '').split(',').filter(Boolean).sort() : null;
    ok('1f · 🔑🔑 el ente unificado elige categoría al registrarse (es entrenador)',
       !!lista && lista.indexOf('individual') >= 0, lista);
}
// Y esa categoría tiene que llegar de verdad a la plaza que se escribe.
ok('1g · ⚠️ y esa categoría viaja a la plaza (allRoles[].category)',
   /category:\s*selectedCategory \|\| null/.test(AUTH) &&
   /subcategory:\s*selectedSubcat\s*\|\| null/.test(AUTH));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · 🔑 "quién lleva equipo" es UNA lista, no dos ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const m = UTILS.match(/window\.CRONOS_ROLES_CON_EQUIPO = \[([^\]]*)\]/);
    const lista = m ? m[1].replace(/['"\s]/g, '').split(',').filter(Boolean) : null;
    ok('2a · existe la lista única CRONOS_ROLES_CON_EQUIPO', !!lista, lista);
    ok('2b · 🔑 incluye el rol unificado', !!lista && lista.indexOf('individual') >= 0, lista);
    ok('2c · y conserva los de siempre (user y su alias coach)',
       !!lista && lista.indexOf('user') >= 0 && lista.indexOf('coach') >= 0, lista);
}
// ⚠️⚠️ LA ASERCIÓN QUE IMPIDE QUE VUELVA A HABER DOS VERDADES. Se cuentan los
//    filtros de rol escritos A MANO en las dos funciones. Si alguien reintroduce
//    un ['user','coach'] literal, aquí se ve — aunque la lista única siga ahí.
ok('2d · 🔑🔑 el candado de los dos equipos consulta la lista, no un literal',
   /const esEntrenador = \(r\) => !!r &&\s*\(window\.CRONOS_ROLES_CON_EQUIPO/.test(UTILS) &&
   !/r\.role === 'user'\s*;/.test(UTILS));
ok('2e · 🔑🔑 y el selector de equipo también',
   /\(window\.CRONOS_ROLES_CON_EQUIPO \|\| \['user', 'coach'\]\)\.indexOf\(r\.role\) < 0\) return;/.test(UTILS) &&
   !/r\.role !== 'user' && r\.role !== 'coach'/.test(UTILS));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · 🔑🔑 EJECUTANDO el validador real con el rol unificado ──');
// ───────────────────────────────────────────────────────────────────────────
//  Censar no distingue "la regla está escrita" de "la regla se aplica aquí".
//  Se carga utils.js de verdad y se le pregunta.
const sb = { console: { log() {}, warn() {}, error() {} },
             document: { getElementById: () => null },
             localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
             navigator: {}, setTimeout: () => {} };
sb.window = sb;
vm.createContext(sb);
try { vm.runInContext(leer('js/core/utils.js'), sb); }
catch (e) { console.log('  (aviso al cargar utils.js: ' + e.message + ')'); }

const puede   = sb.window.cronosPuedeLlevarEquipo;
const equipos = sb.window.cronosEquiposDeEntrenador;
const ENTE = 'ind_test_9f3';
// La plaza tal y como la escribe indAnadirMiEquipo: rol 'individual', anclada
// al ente por clubId (en un ente, clubId GUARDA el id del ente — v583).
const plaza = (category, extra) => Object.assign(
    { role: 'individual', clubId: ENTE, category: category,
      isAuthorized: true, status: 'active' }, extra || {});

ok('3a · el validador está cargado', typeof puede === 'function');
if (typeof puede === 'function') {
    ok('3b · 🔑🔑🔑 su primer equipo entra',
       puede([], 'alevin', ENTE).ok === true);
    ok('3c · 🔑🔑🔑 un F7 y un F11 SÍ (es justo lo que pidió el autor)',
       puede([plaza('alevin')], 'cadete', ENTE).ok === true,
       puede([plaza('alevin')], 'cadete', ENTE));
    // 🔴 ESTA ES LA QUE ANTES PASABA EN VERDE SIENDO FALSA: con el filtro
    //    `role === 'user'`, sus plazas 'individual' no se contaban y dos F7
    //    colaban sin que nada dijera nada.
    ok('3d · 🔴🔴 dos de Fútbol 7 se RECHAZA (antes colaba: no le contaba las plazas)',
       puede([plaza('prebenjamin')], 'benjamin', ENTE).ok === false,
       puede([plaza('prebenjamin')], 'benjamin', ENTE));
    ok('3e · 🔴🔴 dos de Fútbol 11 también se RECHAZA',
       puede([plaza('juvenil')], 'cadete', ENTE).ok === false);
    ok('3f · un TERCER equipo se rechaza aunque las modalidades cuadraran',
       puede([plaza('alevin'), plaza('cadete')], 'infantil', ENTE).ok === false);
    // ⚠️ El ancla importa: un equipo de OTRO sitio no le ocupa plaza aquí.
    ok('3g · ⚠️ una plaza de OTRO ente/club no le bloquea (no se cruzan)',
       puede([plaza('alevin', { clubId: 'club_ajeno' })], 'benjamin', ENTE).ok === true);
    // ⚠️ Una plaza revocada libera equipo; contarla bloquearía altas legítimas.
    ok('3h · ⚠️ una plaza revocada NO ocupa equipo',
       puede([plaza('alevin', { status: 'removed' })], 'benjamin', ENTE).ok === true);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · 🔑 y el selector de equipo del partido SÍ le ve ──');
// ───────────────────────────────────────────────────────────────────────────
//  La otra mitad. De nada sirve que el candado le cuente los equipos si al ir a
//  crear el partido el selector no se los ofrece: tendría dos equipos y sólo
//  podría cronometrar uno.
ok('4a · el selector está cargado', typeof equipos === 'function');
if (typeof equipos === 'function') {
    const res = equipos([plaza('alevin', { subcategory: 'A' }),
                         plaza('cadete', { subcategory: 'B' })], ENTE);
    ok('4b · 🔑🔑 le devuelve sus DOS equipos', Array.isArray(res) && res.length === 2,
       Array.isArray(res) ? res.map(e => e.category + '/' + e.modalidad) : res);
    ok('4c · 🔑 y con la modalidad bien derivada de cada categoría',
       Array.isArray(res) && res.length === 2 &&
       res.filter(e => e.modalidad === 'f7').length === 1 &&
       res.filter(e => e.modalidad === 'f11').length === 1,
       Array.isArray(res) ? res.map(e => e.category + '=' + e.modalidad) : res);
    ok('4d · ⚠️ una plaza sin categoría no se ofrece como equipo',
       equipos([plaza(null)], ENTE).length === 0);
    ok('4e · ⚠️ ni una que no esté activa',
       equipos([plaza('alevin', { status: 'pending_sa', isAuthorized: false })], ENTE).length === 0);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · el SuperAdmin: rótulo nuevo, legado que no se pierde ──');
// ───────────────────────────────────────────────────────────────────────────
ok('5a · el ente se rotula como "Entrenador Administrador Individual"',
   /label:'Entrenador Administrador Individual'/.test(SATAB.replace(/\s+/g, ' ').replace(/label: /g, "label:")));
// ⚠️⚠️ LA MITAD QUE IMPIDE QUE "limpiar" SEA "perder". Las plazas antiguas
//     siguen vivas por decisión del autor; si el SuperAdmin dejara de saber
//     pintarlas, un cupo ocupado se volvería invisible y las cuentas no
//     cuadrarían — peor que una barra de más.
ok('5b · 🔑🔑 pero el legado "Entrenador Individual" SIGUE sabiéndose pintar',
   /Entrenadores Individuales \(legado\)/.test(SATAB) &&
   /user:\s*\{/.test(SATAB));
ok('5c · ⚠️ y su barra sólo se pinta si queda alguna plaza real',
   /_usadasEnBarra\('user'\) > 0 \? slotBar\('user'\) : ''/.test(SATAB));
// 🔑 Un solo recuento para la barra y para la decisión de pintarla: dos
//    implementaciones de "cuántos hay" divergen (v533, badge 7 vs lista 4).
ok('5d · 🔑 el recuento es UNO solo, compartido por la barra y por su condición',
   (SATAB.match(/const _usadasEnBarra = /g) || []).length === 1 &&
   /const used = _usadasEnBarra\(roleKey\);/.test(SATAB));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 6 · el botón de Volver en la creación de partidos ──');
// ───────────────────────────────────────────────────────────────────────────
//  🔑 POR QUÉ NO PODÍA SER `navBack()`: openSetupModal se declara RAÍZ, y
//  declararse raíz VACÍA la pila. Cuando esta pantalla se pinta ya no queda
//  ninguna anterior a la que volver, así que hay que invocar el panel.
ok('6a · openSetupModal sigue declarándose RAÍZ (por eso navBack no sirve aquí)',
   /navRootScreen\('openSetupModal'\)/.test(SETUP));
ok('6b · 🔑 hay un "Volver al Panel" que invoca el panel directamente',
   /openIndividualAdminPanel\(\)/.test(SETUP) && /← Volver al Panel/.test(SETUP));
ok('6c · y se pinta dentro de la cabecera de la modal',
   /\$\{_volverAlPanelHTML\}/.test(SETUP));
// ⚠️ Sólo para quien tiene panel detrás: a un entrenador de club el panel le
//    responde "⛔ Sin permisos", y un botón que sólo sabe dar un error no se
//    le enseña a nadie.
ok('6d · ⚠️ SÓLO para el rol individual, y mirando _activeRole (cuentas multi-rol)',
   /_rolActivo === 'individual' && typeof window\.openIndividualAdminPanel === 'function'/.test(SETUP) &&
   /_activeRole \|\| _yo\.role/.test(SETUP));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 7 · "Mis Equipos" en el panel: enseña el límite y lo aplica ──');
// ───────────────────────────────────────────────────────────────────────────
ok('7a · el panel tiene su sección y su tarjeta en el tablero',
   /equipos:\s*\{ titulo: '⚽ Mis Equipos'/.test(IND) && /indTab\('equipos'\)/.test(IND));
// 🔑 Que la limitación se VEA: las categorías prohibidas salen deshabilitadas
//    y DICEN por qué, en vez de desaparecer sin explicación.
ok('7b · 🔑 las categorías prohibidas salen deshabilitadas y dicen el motivo',
   /\(bloq \? ' disabled' : ''\)/.test(IND) &&
   /ya llevas un equipo de/.test(IND) && /ya es tuyo/.test(IND));
// ⚠️⚠️ `disabled` ES COSMÉTICO (la lección de la v548): quien toque el DOM se
//     salta el desplegable. El candado de verdad está al guardar.
ok('7c · ⚠️⚠️ y AUN ASÍ se valida al guardar, con la MISMA función compartida',
   /window\.cronosPuedeLlevarEquipo\(userData\.allRoles \|\| \[\], catVal, enteId\)/.test(IND));
ok('7d · ⚠️ y se rechaza además el mismo equipo dos veces (eso el validador no lo mira)',
   /Ya llevas ese equipo/.test(IND));
// 🔑 Se guarda como PLAZA, no como un campo suelto: es lo que hace que el
//    selector del partido, la plantilla y los informes la vean sin tocar nada.
ok('7e · 🔑🔑 el equipo nuevo se guarda como PLAZA en allRoles, no en un campo aparte',
   /allRoles: \(userData\.allRoles \|\| \[\]\)\.concat\(\[nueva\]\)/.test(IND) &&
   !/category2/.test(IND));
// ⚠️⚠️ Una escritura denegada por reglas que se traga un catch vacío es el
//     fallo "no se guarda y no da error" que este proyecto ya pagó (v583).
{
    const m = IND.match(/window\.indAnadirMiEquipo[\s\S]*?\n\};/);
    const cuerpo = m ? m[0] : '';
    ok('7f · ⚠️⚠️ y si Firestore deniega, SE VE el motivo (nada de catch mudo)',
       cuerpo.length > 0 && /catch \(e\) \{/.test(cuerpo) &&
       /No se pudo guardar: /.test(cuerpo) && !/catch\s*\([^)]*\)\s*\{\s*\}/.test(cuerpo));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 8 · v600 · aterriza en SU PANEL, no en la pantalla de partido ──');
// ───────────────────────────────────────────────────────────────────────────
//  Reportado por el autor tras probar la v599 (capturas 9388/9389): al entrar
//  «me abre primero la configuración de partidos y luego me obliga a ir al
//  panel». Debe ser al revés.
//
//  🔑 NO ERA UNA PREFERENCIA MAL ELEGIDA, ERA UNA CARRERA: `init()` pintaba la
//  pantalla de partido y `role-launch.js` abría el panel ENCIMA 300 ms después.
//  Siempre ganaba la pantalla equivocada, porque salía primero.
{
    const APPINIT = sinCom(leer('js/core/app-init.js'));
    const LAUNCH  = sinCom(leer('js/services/auth/role-launch.js'));

    // 8a · init() ya no le pinta el formulario de partido por su cuenta.
    const m = APPINIT.match(/if \(!\[([^\]]*)\]\.includes\(role\)\) \{[\s\S]{0,400}?openSetupModal\(\);/);
    const excluidos = m ? m[1].replace(/['"\s]/g, '').split(',').filter(Boolean) : null;
    ok('8a · 🔑 init() NO abre la pantalla de partido para el ente individual',
       !!excluidos && excluidos.indexOf('individual') >= 0, excluidos);
    // ⚠️ Pero init() SÍ se sigue llamando: es entrenador y necesita listeners,
    //    service worker y sincronización para cuando cronometre.
    ok('8b · ⚠️ pero init() SE SIGUE LLAMANDO para él (lo necesita al cronometrar)',
       /activeRole === 'individual'[\s\S]{0,1200}?if \(typeof init === 'function'\) init\(activeRole\);/.test(LAUNCH));

    // 8c · 🔑 EL setTimeout ERA LA CARRERA. Una espera a ciegas enseña la
    //      pantalla equivocada en un móvil lento, y para siempre si algo tarda.
    {
        // ⚠️ SE ANCLA EN `} else if (…)`, NO en `activeRole === 'individual'` a
        //    secas: esa cadena aparece ANTES en este fichero (el botón
        //    🛡️ ADMIN de la cabecera), y una ventana abierta ahí examinaba un
        //    bloque que no es el del arranque. Se ponía roja por el motivo
        //    equivocado, que es una forma de estar rota aunque el color acierte.
        const rama = (LAUNCH.match(/\} else if \(activeRole === 'individual'\) \{[\s\S]*?\n    \} else \{/) || [''])[0];
        ok('8c0 · ⚠️ la rama de arranque del ente se localiza', rama.length > 0);
        ok('8c · 🔑🔑 el panel se abre YA, sin setTimeout que lo haga carrera',
           rama.length > 0 && /openIndividualAdminPanel\(\)/.test(rama) && !/setTimeout/.test(rama),
           rama.length ? rama.replace(/\s+/g, ' ').slice(0, 220) : 'no se localizó la rama');
    }
    // ⚠️ Y el orden importa: init() ANTES que el panel, para que el panel se
    //    pinte el ÚLTIMO y quede encima.
    ok('8d · ⚠️ y se llama a init() ANTES que al panel (el panel pinta el último)',
       LAUNCH.indexOf("if (typeof init === 'function') init(activeRole);\n        if (typeof openIndividualAdminPanel") >= 0);
    // 🔑 La vuelta desde partidos tiene que devolverle a ESE panel.
    ok('8e · 🔑 y el "Volver al Panel" de partidos regresa a ese mismo panel',
       /openIndividualAdminPanel\(\)/.test(SETUP));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 9 · v600 · el ente y su dueño son UNA fila en el SuperAdmin ──');
// ───────────────────────────────────────────────────────────────────────────
//  El autor (captura 9387): «todavía se ven los roles separados». La tarjeta
//  apilaba dos barras de cupo como iguales —el admin y los padres—, que
//  describe el modelo VIEJO de tres roles colgando de un contenedor. Tras la
//  unificación el entrenador administrador ES el ente, no un miembro suyo.
{
    // ⚠️ Se quitan también los comentarios HTML: si no, estas aserciones casan
    //    con la explicación de lo que se retiró en vez de con el código.
    const SA = sinComHtml(SATAB);
    ok('9a · 🔑🔑 su barra de cupo ya no se pinta',
       !/\$\{slotBar\('admin_individual'\)\}/.test(SA));
    ok('9b · 🔑 y su identidad sube a la cabecera del ente',
       /\$\{_duenoHtml\}/.test(SA) && /const _duenos = _usuariosDeBarra\('admin_individual'\)/.test(SA));
    // ⚠️ Sin dueño hay que DECIRLO: un ente sin administrador es un problema,
    //    y antes se leía como un "0 / 1" que no llamaba la atención.
    ok('9c · ⚠️ un ente SIN dueño lo dice en palabras',
       /Sin Entrenador Administrador asignado/.test(SA));
    // ⚠️ Y el caso imposible —dos dueños— deja de disimularse en un "2 / 1".
    ok('9d · ⚠️ y un ente con DOS dueños se señala en rojo, no se disimula',
       /administradores\. Debería tener uno/.test(SA));
    // 🔑 El dueño sale del recuento de miembros, pero NO de la lista: sacarlo
    //    de la cuenta no puede ser esconderlo.
    ok('9e · 🔑🔑 los miembros se cuentan sin él, pero "Ver usuarios" los ofrece a todos',
       /const _miembros = Math\.max\(0, entUsers\.length - _duenos\.length\)/.test(SA) &&
       /Ver usuarios \(\$\{entUsers\.length\}\)/.test(SA));
    // ⚠️⚠️ UNA sola implementación de "quiénes hay". Contar es un caso
    //     particular de listar; al revés obliga a duplicar el filtro.
    ok('9f · ⚠️⚠️ y sigue habiendo UN solo filtro de pertenencia, no varios',
       (SA.match(/const _usuariosDeBarra = /g) || []).length === 1 &&
       /const _usadasEnBarra = \(roleKey\) => _usuariosDeBarra\(roleKey\)\.length;/.test(SA) &&
       /const used = _usadasEnBarra\(roleKey\);/.test(SA));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════');
console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '  ❌ ' + fallos + ' FALLOS' : '  ✅'));
process.exit(fallos ? 1 : 0);

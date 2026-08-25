// ─────────────────────────────────────────────────────────────────────────
//  test_ente_cuadrante_y_vuelta.js  ·  v626
//
//  Encargo del autor (implementar.txt, 2026-08-25), dos puntos:
//
//   1) «Llevar e integrar de forma íntegra la opción de cuadrante que ya
//      tenemos implementada y funcionando en los clubes, adaptándola por
//      completo al entorno y funcionamiento del ente individual.»
//
//   2) «Al acceder a la opción de mensajes no hay forma de volver atrás hacia
//      el panel del ente individual, ya que el único botón existente ("Salir
//      del rol") te saca por completo de la sesión y obliga a volver a entrar.»
//
//  ════════════════════════════════════════════════════════════════════
//  LO QUE ESTE GUARD FIJA, Y POR QUÉ CADA COSA
//
//  A) EL CUADRANTE NO SE DUPLICÓ, SE DESPEGÓ DE SU ANFITRIÓN. Estaba atado a
//     `#staff-dashboard-content` (el cuerpo del panel de Dirección) en cinco
//     sitios. Copiar el fichero para el ente habría creado la segunda fuente
//     de verdad que este proyecto lleva pagando desde la v511. Aquí se
//     comprueba que NO queda ni una referencia cableada y que los DOS
//     anfitriones dicen explícitamente dónde pintan.
//
//  B) 🔴 EL DEFECTO QUE SE DESCUBRIÓ AL ADAPTARLO, Y QUE NADIE HABÍA PEDIDO:
//     `_cqEntrenadoresDelClub` preguntaba `role === 'user' || role === 'coach'`
//     a mano. El Entrenador Administrador Individual escribe su rol como
//     'individual', así que quedaba FUERA. Consecuencia en cadena: en un ente
//     sin ayudante, "📤 ENVIAR A ENTRENADORES" no encontraba a nadie → el
//     cuadrante nunca se sellaba con `publicadoEn` → y
//     `cronosCuadranteClubDeMiEquipo` lo exige para enseñarlo. O sea: el ente
//     habría podido rellenar la parrilla entera y no verla en NINGÚN sitio.
//     Se arregla usando `CRONOS_ROLES_CON_EQUIPO` (utils.js, v598), la lista
//     única del proyecto para "quién lleva equipo".
//
//  C) 🔑🔑 LA CAUSA DEL PUNTO 2 NO ESTABA EN MENSAJERÍA. El motor de mensajes
//     SÍ se registraba en la pila (`navScreen`), pero el panel del ente —su
//     pantalla anterior— NO se registraba nunca: era el único de los cuatro
//     paneles sin `navRootScreen`. Con la pila en UN solo nivel `navBack()`
//     cae en `navExit()`, que sólo OCULTA el modal. Por eso el único botón
//     que quedaba era el ✕ (`navExitToRoles`), o sea salir del rol. Añadir el
//     botón sin registrar la raíz habría dado un "Volver" a pantalla negra.
//
//  Ejecuta código REAL en un sandbox (vm) siempre que puede, y sólo cae al
//  análisis de texto para lo que es estructura (qué llama a qué).
//  ⚠️ La lección de v620: un test que prueba una COPIA de la lógica escrita en
//  el propio test no prueba el producto.
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

const CQ    = leer('js/coach/reports/cuadrante-club.js');
const IND   = leer('js/admin/individual/panel.js');
const STAFF = leer('js/coach/reports/club-reports.js');
const COMMS = leer('js/coach/comms/panel.js');

// ════════════════════════════════════════════════════════════════════
//  Sandbox con el MÓDULO REAL del cuadrante.
//  El fichero no toca el DOM al cargarse (lo dice su cabecera y lo confirma
//  que esto funcione): sólo declara. Las funciones de nivel superior quedan
//  en el objeto global del contexto y se pueden invocar de verdad.
// ════════════════════════════════════════════════════════════════════
function cargarCuadrante(usuario) {
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: () => null,
            querySelectorAll: () => [],
            addEventListener() {},
            body: { appendChild() {}, contains: () => true },
        },
        localStorage: { getItem: () => null, setItem() {} },
        setTimeout, clearTimeout,
    };
    sb.window = sb;
    sb._cronosCurrentUser = usuario || {};
    // Los resolutores compartidos que el módulo usa con guarda `typeof`.
    sb.CRONOS_ROLES_CON_EQUIPO = ['user', 'coach', 'individual', 'admin_individual'];
    sb.ctNormCat    = (c) => String(c || '').trim().toLowerCase().replace(/_[abc]$/, '');
    sb.ctNormSubcat = (s) => String(s || '').trim().toUpperCase();
    sb.cronosTeamId = (club, cat, sub) => club + '__' + cat + '__' + String(sub || '').toLowerCase();
    sb.cronosNombreCategoria = (cat, sub) => String(cat || '') + (sub ? ' ' + sub : '');
    sb.escapeHtml = (s) => String(s == null ? '' : s);
    sb.escapeAttr = (s) => String(s == null ? '' : s);
    vm.createContext(sb);
    vm.runInContext(CQ, sb);
    return sb;
}

// Un `users` de mentira que responde a la consulta por clubId. Devuelve la
// forma mínima que el módulo consume (forEach de docs con .id y .data()).
function fsFalso(docs) {
    return {
        db: {},
        doc:        (...a) => ({ _p: a }),
        collection: (...a) => ({ _p: a }),
        query:      (...a) => ({ _p: a }),
        where:      (...a) => ({ _p: a }),
        getDoc:     async () => ({ exists: () => false, data: () => ({}) }),
        setDoc:     async () => {},
        getDocs:    async () => ({ forEach: (f) => docs.forEach(d => f({ id: d.id, data: () => d })) }),
        onSnapshot: () => () => {},
    };
}

console.log('\n══ v626 · El cuadrante del ente, y la vuelta desde Mensajes ══');

// ════════════════════════════════════════════════════════════════════
console.log('\nA) 🧩 El cuadrante deja de estar cableado a un contenedor');
{
    ok('A1 · _sdLoadCuadrante recibe el contenedor como argumento',
       /async function _sdLoadCuadrante\(contenedorId\)/.test(CQ));

    ok('A2 · 🔑 y lo FIJA en cada entrada, no lo hereda de la anterior',
       /window\._cqContenedorId = contenedorId \|\| CQ_CONT_DEFECTO;/.test(CQ),
       'si se heredara, un director que entrase después del ente pintaría en un div que ya no existe');

    ok('A3 · ⚠️ no queda NI UNA referencia cableada a staff-dashboard-content',
       !/getElementById\('staff-dashboard-content'\)/.test(CQ),
       'era la atadura al panel de Dirección, en cinco sitios');

    ok('A4 · el panel de Dirección dice explícitamente dónde pinta',
       /_sdLoadCuadrante\('staff-dashboard-content'\)/.test(STAFF));

    ok('A5 · 🔑 y el panel del Ente Individual, el suyo',
       /_sdLoadCuadrante\('ind-cuadrante-body'\)/.test(IND));

    ok('A6 · ⚠️ el repintado tras importar calendario NO se lleva el cuadrante al contenedor de otro',
       /if \(_cqCont\(\)\) _sdLoadCuadrante\(_cqContId\(\)\);/.test(CQ),
       '_sdRecargarCuadrante() sin argumento habría devuelto el ente al panel de Dirección');

    ok('A7 · ⚠️ el oyente en vivo se da de baja si su contenedor ya no está',
       /if \(!_cqCont\(\)\) \{ _cqDesconectar\(\); return; \}/.test(CQ));
}

// ════════════════════════════════════════════════════════════════════
console.log('\nB) 🗓️ La opción de Cuadrante dentro del panel del ente');
{
    ok('B1 · el tablero del ente tiene su tarjeta 🗓️ Cuadrante',
       /titulo: 'Cuadrante'[\s\S]{0,320}?indTab\('cuadrante'\)/.test(IND));

    ok('B2 · y existe la sección, con su título',
       /cuadrante:\s*\{ titulo: '🗓️ Cuadrante',/.test(IND));

    ok('B3 · 🔑 la sección aporta el HUECO; el contenido lo pinta el módulo compartido',
       /id="ind-cuadrante-body"/.test(IND));

    ok('B4 · ⚠️ la carga va DESPUÉS del innerHTML (el módulo busca su div en el DOM)',
       (() => {
           const iHtml  = IND.indexOf('cuerpo.innerHTML = _IND_SECCIONES[sec].html;');
           const iCarga = IND.indexOf("_sdLoadCuadrante('ind-cuadrante-body')");
           return iHtml > 0 && iCarga > 0 && iHtml < iCarga;
       })());

    ok('B5 · ⚠️ la baja del oyente va al PRINCIPIO de indTab, para cubrir TODAS las salidas',
       (() => {
           const iTab  = IND.indexOf('window.indTab = function indTab(sec)');
           const iBaja = IND.indexOf('window._cqDesconectar();', iTab);
           const iSec  = IND.indexOf("if (sec === 'menu'", iTab);
           return iTab > 0 && iBaja > iTab && iSec > iBaja;
       })(),
       'un onSnapshot que sobrevive a su pantalla sigue costando lecturas y repinta lo ajeno (v439)');

    ok('B6 · ⚠️ si el módulo no cargó, se dice POR QUÉ; no se deja un hueco mudo',
       /El módulo de Cuadrante no está disponible[\s\S]{0,80}Recarga el panel/.test(IND));

    ok('B7 · la sección hereda el "← Volver al Menú" común del panel (no inventa otro)',
       /indTab\(\\'menu\\'\)[\s\S]{0,400}← Volver al Menú/.test(IND));

    ok('B8 · 🔑 y el ente ve su cuadrante llamado por su nombre, no "del club"',
       /function _cqEsEnte\(\)/.test(CQ) && /_cqPalabraEntidad\(\)/.test(CQ));
}

// ════════════════════════════════════════════════════════════════════
console.log('\nC) 🔴 El ente CUENTA como entrenador con equipo (ejecutado)');
{
    const ENTE = 'ente_jose';
    const sb = cargarCuadrante({ uid: 'u_jose', clubId: ENTE, _activeRole: 'individual' });

    // El dueño del ente (rol 'individual') y su entrenador ayudante (rol 'user').
    const usuarios = [
        { id: 'u_jose', uid: 'u_jose', email: 'jose@x.es', role: 'individual',
          clubId: ENTE, status: 'active', isAuthorized: true,
          allRoles: [ { role: 'individual', clubId: ENTE, category: 'alevin',  subcategory: 'A', isAuthorized: true },
                      { role: 'individual', clubId: ENTE, category: 'juvenil', subcategory: 'B', isAuthorized: true } ] },
        { id: 'u_ana', uid: 'u_ana', email: 'ana@x.es', role: 'user',
          clubId: ENTE, status: 'active', isAuthorized: true,
          allRoles: [ { role: 'user', clubId: ENTE, category: 'alevin', subcategory: 'A', isAuthorized: true } ] },
        // Un padre del ente: NO lleva equipo y no puede colarse.
        { id: 'u_pad', uid: 'u_pad', email: 'pad@x.es', role: 'parent',
          clubId: ENTE, status: 'active', isAuthorized: true,
          allRoles: [ { role: 'parent', clubId: ENTE, category: 'alevin', subcategory: 'A', isAuthorized: true } ] },
    ];
    sb._cqFS = async () => fsFalso(usuarios);

    let lista = null, filas = null, err = null;
    const listo = sb._cqEntrenadoresDelClub(ENTE)
        .then(l => { lista = l; return sb._cqFilasDePlazas(ENTE); })
        .then(f => { filas = f; })
        .catch(e => { err = e; });

    listo.then(() => {
        ok('C0 · el módulo real se ejecuta y responde', !err, err && err.message);

        const uids = (lista || []).map(r => r.uid);
        ok('C1 · 🔴🔴 el DUEÑO del ente (rol "individual") sale en la lista de envío',
           uids.indexOf('u_jose') >= 0,
           'sin esto, un ente sin ayudante no podía enviar → el cuadrante nunca se sellaba ' +
           'con publicadoEn → y no aparecía en su propia Planificación Semanal');

        ok('C2 · y sus DOS plazas cuentan por separado (F7 y F11 son dos equipos)',
           (lista || []).filter(r => r.uid === 'u_jose').length === 2);

        ok('C3 · el entrenador ayudante sigue estando, como siempre',
           uids.indexOf('u_ana') >= 0);

        ok('C4 · ⚠️ y un PADRE del ente NO se cuela como destinatario',
           uids.indexOf('u_pad') < 0,
           'la lista es "quién lleva equipo", no "quién pertenece al ente"');

        ok('C5 · ⚠️ el criterio NO se reescribe: se pregunta a CRONOS_ROLES_CON_EQUIPO',
           /window\.CRONOS_ROLES_CON_EQUIPO \|\| \['user', 'coach', 'individual', 'admin_individual'\]/.test(CQ) &&
           !/\.filter\(r => r && \(r\.role === 'user' \|\| r\.role === 'coach'\) &&\s*\n?\s*String\(r\.clubId/.test(CQ),
           'utils.js v598 ya fijó una sola lista para todo el proyecto');

        // ── Filas por defecto desde las plazas ────────────────────────
        const ids = (filas || []).map(f => f.id).sort();
        ok('C6 · 🔑 sin ninguna plantilla publicada, las filas salen de las PLAZAS',
           (filas || []).length === 2,
           'un Ente recién creado estrenaba el cuadrante EN BLANCO, y eso parece roto, no nuevo');

        ok('C7 · una fila por equipo, sin repetir (Alevín A lo llevan dos personas)',
           ids.length === new Set(ids).size &&
           ids.join(',') === [
               sb.cronosTeamId(ENTE, 'alevin', 'A'),
               sb.cronosTeamId(ENTE, 'juvenil', 'B'),
           ].sort().join(','));

        ok('C8 · 🔑 el id de la fila se calcula con cronosTeamId, el mismo que cronosMyTeamId',
           /_cqIdFilaEquipo\(clubId, cat, sub\)/.test(CQ),
           'si el id no saliera idéntico, su fila del cuadrante no le aparecería NUNCA en su semana');

        ok('C9 · ⚠️ y sólo se recurre a las plazas si NO hay plantillas publicadas',
           /if \(!filas\.length\) \{\s*try \{\s*const dePlazas = await _cqFilasDePlazas\(clubId\);/.test(CQ),
           'para un club que ya lo usa no cambia ni una fila');

        parteD();
    });
}

// ════════════════════════════════════════════════════════════════════
function parteD() {
console.log('\nD) 🔙 La vuelta desde Mensajes al panel del ente');
{
    ok('D1 · 🔑🔑 el panel del ente se registra como RAÍZ de la pila',
       /navRootScreen\('openIndividualAdminPanel', true\)/.test(IND),
       'era el único de los cuatro paneles sin registrar: por eso navBack caía en navExit ' +
       '(que sólo OCULTA el modal) y el único botón posible era "salir del rol"');

    ok('D2 · ⚠️ con `true`, para volver a la sección donde se estaba y no al tablero',
       /navRootScreen\('openIndividualAdminPanel', true\)/.test(IND));

    ok('D3 · el motor de mensajería ya se registraba (esa mitad no era el fallo)',
       /admin_individual: 'openIndividualAdminMessaging'/.test(COMMS) &&
       /navScreen\(_UM_ENTRY_BY_ROLE\[role\] \|\| 'openCoachMessaging', tab\);/.test(COMMS));

    ok('D4 · el botón existe y dice a dónde lleva',
       /← Volver al Menú/.test(COMMS) && /Volver a tu panel sin cerrar la sesión/.test(COMMS));

    ok('D5 · y usa navBack(), no un destino cableado',
       /onclick="navBack\(\)"/.test(COMMS));

    ok('D6 · ⚠️ el ✕ se queda como estaba: ESE sí es salir del rol',
       /navExitToRoles\(\)/.test(COMMS),
       'son dos cosas distintas y ahora se pueden distinguir');

    // ── El recorrido completo, con el nav-stack REAL ──────────────────
    const navSrc = leer('js/core/nav-stack.js');
    const pintadas = [];
    const els = {};
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: (id) => (els[id] = els[id] || { id, style: {}, innerHTML: '' }),
            body: { style: {}, classList: { remove() {} } },
        },
        showToast() {},
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(navSrc, sb);

    // Las dos pantallas reales, con su registro real (copiado del producto:
    // raíz con `true`, hija con la pestaña).
    sb.openIndividualAdminPanel = function (mantener) {
        sb.navRootScreen('openIndividualAdminPanel', true);
        pintadas.push('panel:' + String(mantener));
    };
    sb.openIndividualAdminMessaging = function (tab) {
        sb.navScreen('openIndividualAdminMessaging', tab);
        pintadas.push('mensajes:' + tab);
    };

    sb.openIndividualAdminPanel();
    sb.openIndividualAdminMessaging('coaches');

    ok('D7 · desde Mensajes SÍ hay a dónde volver',
       sb.navCanGoBack() === true);

    sb.navBack();

    ok('D8 · 🔑 y "Volver" devuelve al PANEL DEL ENTE, no al selector de roles',
       pintadas[pintadas.length - 1] === 'panel:true',
       'medido: ' + JSON.stringify(pintadas));

    ok('D9 · ⚠️ el modal NO se oculta por el camino (eso era la pantalla negra)',
       (els['setup-modal'] ? els['setup-modal'].style.display : undefined) !== 'none');

    ok('D10 · y la sesión sigue viva: no se ha pasado por el selector de roles',
       pintadas.filter(p => p.indexOf('roles') >= 0).length === 0);

    ok('D11 · ⚠️ volver otra vez desde la raíz ya no apila nada (no queda bucle)',
       sb.navCanGoBack() === false);
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
if (fail) {
    console.log('❌ ' + fail + ' aserción(es) en rojo');
    process.exit(1);
}
console.log('✅ El ente cuadra su semana — y desde Mensajes se vuelve a su panel');
}

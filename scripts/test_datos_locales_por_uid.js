// ─────────────────────────────────────────────────────────────────────────
// test_datos_locales_por_uid.js · v720 · DOS CUENTAS EN DOS PESTAÑAS DEL
// MISMO NAVEGADOR, SIN PISARSE Y SIN PERDER NADA
//
// Encargo del autor (implementar.txt, capturas 10438-10440): que dos correos
// distintos en dos pestañas del mismo navegador «convivan y operen
// simultáneamente sin bloqueos»; que el mismo correo con DOS ROLES distintos
// pueda ir en paralelo; y que el mismo correo con el MISMO rol pero DOS
// PARTIDOS distintos (un F7 y un F11) no se expulse. Requisito técnico suyo:
// «eliminar el bloqueo global por localStorage a nivel de navegador y acotar
// el control de exclusividad exclusivamente al nivel estricto del partido en
// curso».
//
// 📏 QUÉ SE MIDIÓ ANTES DE ESCRIBIR ESTO (y por qué el guard mira dónde mira)
// ────────────────────────────────────────────────────────────────────────
//  · La sesión YA ERA POR PESTAÑA desde v638 (`browserSessionPersistence`,
//    que vive en sessionStorage). El aviso «sólo se puede tener una sesión por
//    navegador» que él fotografió era TEXTO DE v570 que nadie actualizó.
//  · 🔴 LO QUE SÍ ROMPÍA LAS PESTAÑAS ERA NUESTRO:
//    `_purgeStaleLocalDataIfNeeded` (v199). Al entrar un uid distinto del
//    marcador `cronos_owner_uid`, barría TODAS las claves `cronos_*` del
//    navegador — y ahí vive la RANURA DEL PARTIDO EN CURSO de la otra
//    pestaña, más las plantillas, convocatorias y planificaciones, que NO se
//    restauran de Firestore. No era un bloqueo: era destrucción cruzada.
//
// LO QUE HACE ESTE GUARD: monta UN localStorage compartido (que es lo que es
// un navegador) y DOS pestañas con sessionStorage separados y usuarios
// distintos, carga DE VERDAD js/core/local-uid.js, js/core/match-slots.js y
// las funciones reales de js/services/firestore-storage.js, y comprueba el
// comportamiento. La PARTE 4 **reproduce el defecto de v719** con el barrido
// sin ámbito, para que quede claro qué se está impidiendo.
//
// ⚠️ EL ARNÉS NO PUEDE USAR `comoStorage` DE test_multipartido_aislamiento.js:
// aquél devuelve los métodos con `.bind(t)`, así que dentro de ellos `this` es
// el almacén crudo y NUNCA el proxy. La envoltura de v720 decide si aísla
// comparando `this === window.localStorage` —porque localStorage y
// sessionStorage COMPARTEN el prototipo `Storage` y sólo hay que aislar el
// primero—, y con métodos atados esa comparación sería siempre falsa: el guard
// pasaría en verde sin probar nada. Aquí los métodos viven en un
// `Storage.prototype` y el proxy los devuelve SIN atar.
// ─────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const LOCALUID = fs.readFileSync(path.join(ROOT, 'js', 'core', 'local-uid.js'), 'utf8');
const SLOTS    = fs.readFileSync(path.join(ROOT, 'js', 'core', 'match-slots.js'), 'utf8');
const FSTORE   = fs.readFileSync(path.join(ROOT, 'js', 'services', 'firestore-storage.js'), 'utf8');
const AUTH     = fs.readFileSync(path.join(ROOT, 'js', 'services', 'auth.js'), 'utf8');
const SECST    = fs.readFileSync(path.join(ROOT, 'js', 'core', 'security-and-state.js'), 'utf8');
const INDEX    = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const IMPORTJS = fs.readFileSync(path.join(ROOT, 'js', 'ai', 'import.js'), 'utf8');
const PANEL    = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

// Quita comentarios antes de buscar texto en el fuente. Sin esto, una
// aserción "ya no se dice X" se pone verde por culpa de MI PROPIO comentario
// explicando que ya no se dice X — el verde falso de v714, cazado en su día.
function sinComentarios(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

console.log('── v720 · datos locales aislados por uid ──\n');

// ══════════════════════════════════════════════════════════════════════
//  EL NAVEGADOR SIMULADO
// ══════════════════════════════════════════════════════════════════════
// Un solo `Map` para localStorage: es exactamente la propiedad del navegador
// que causaba el fallo (compartido por todas las pestañas del mismo origen).
// ⚠️ EL MAPA DE CADA ALMACÉN VA EN UN WeakMap, FUERA DEL OBJETO, y esto costó
// una tanda entera de rojos: guardándolo como propiedad (`__datos`) el trap
// `ownKeys` del proxy tiene que declararla o el motor lanza
// «trap result did not include '__datos'». Ese `Object.keys(localStorage)`
// ocurre DENTRO del `try` de `cronosMigraClavesLocales`, así que la excepción
// se la comía el catch y la migración devolvía 0 movidas sin decir nada: seis
// aserciones en rojo con el código correcto.
const MAPAS = new WeakMap();

// ⚠️⚠️ Y CADA PESTAÑA TIENE SU PROPIO `Storage.prototype`. Segunda tanda de
// rojos del arnés, y ésta enseña algo: al compartir un único objeto prototipo
// entre los dos sandboxes, la SEGUNDA pestaña envolvía la envoltura de la
// PRIMERA (su `window._cronosLocalOriginal` estaba vacío, así que parcheaba
// otra vez), y a partir de ahí TODAS las escrituras —las de las dos cuentas—
// pasaban por el `_uid()` de la última pestaña abierta y se guardaban a nombre
// suyo. En un navegador de verdad cada documento tiene su propio prototipo
// `Storage`; compartirlo no simulaba dos pestañas, simulaba algo que no existe.
function crearNavegador() {
    const datos = new Map();   // UN solo almacén: eso sí es del navegador

    function almacen(proto, mapa) {
        const crudo = Object.create(proto);
        // El proxy es lo que se expone como `localStorage`: enumera las claves
        // guardadas (para que `Object.keys(localStorage)` funcione como en el
        // navegador) y devuelve los métodos SIN ATAR, de modo que `this` sea
        // el propio proxy — la identidad que la envoltura compara.
        const visto = new Proxy(crudo, {
            ownKeys: () => Array.from(mapa.keys()),
            getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: undefined }),
        });
        // El mapa se registra para las DOS identidades: los métodos pueden
        // llegar con `this` = proxy (uso normal) o con `this` = crudo.
        MAPAS.set(crudo, mapa);
        MAPAS.set(visto, mapa);
        return visto;
    }

    // Los métodos NO cierran sobre un almacén concreto: sacan el suyo de
    // `this`, igual que en el navegador, para que localStorage y
    // sessionStorage se distingan aunque compartan prototipo.
    function nuevoProto() {
        return {
            getItem(k)    { const m = MAPAS.get(this); return m.has(k) ? m.get(k) : null; },
            setItem(k, v) { MAPAS.get(this).set(k, String(v)); },
            removeItem(k) { MAPAS.get(this).delete(k); },
        };
    }

    return {
        datos,
        // Una pestaña nueva: prototipo propio, localStorage sobre el mapa
        // COMPARTIDO, sessionStorage propio.
        pestana() {
            const proto = nuevoProto();
            return {
                proto,
                local:   almacen(proto, datos),
                session: almacen(proto, new Map()),
            };
        },
    };
}

// Una pestaña: mismo localStorage, sessionStorage propio, usuario propio.
function abrirPestana(nav, uid) {
    const p = nav.pestana();
    const sandbox = {
        localStorage:   p.local,
        sessionStorage: p.session,
        Storage:        { prototype: p.proto },
        console:        { log() {}, warn() {}, error() {} },
        Date, Math, JSON, Object, String, Number, Array, Set, Boolean, parseFloat, parseInt,
        navigator: { userAgent: 'guard', platform: 'guard' },
        location: { reload() { sandbox.__recargo = true; } },
    };
    sandbox.window = sandbox;
    if (uid) sandbox._cronosCurrentUser = { uid: uid, _activeRole: 'coach' };
    vm.createContext(sandbox);
    vm.runInContext(LOCALUID, sandbox, { filename: 'local-uid.js' });
    return sandbox;
}

// ══════════════════════════════════════════════════════════════════════
//  PARTE 1 · CADA CUENTA ESCRIBE EN SU ESPACIO (nadie ve lo del otro)
// ══════════════════════════════════════════════════════════════════════
console.log('PARTE 1 · aislamiento por uid\n');
{
    const nav = crearNavegador();

    // Antes del login no hay uid: la clave se queda TAL CUAL. Es el caso de
    // todo lo que se escribe en la pantalla de acceso.
    const anon = abrirPestana(nav, null);
    vm.runInContext(`localStorage.setItem('cronos_teams', 'heredado')`, anon);
    ok('1a · sin sesión NO se aísla (la clave se queda sin dueño)',
       nav.datos.has('cronos_teams') && nav.datos.get('cronos_teams') === 'heredado',
       [...nav.datos.keys()].join(', '));

    // Pestaña A: entra u1 y migra lo heredado a su espacio.
    const A = abrirPestana(nav, 'u1');
    vm.runInContext(`window.cronosMigraClavesLocales('u1')`, A);
    ok('1b · la migración mueve lo heredado al espacio del que entra',
       nav.datos.has('cronos_teams@u1') && !nav.datos.has('cronos_teams'),
       [...nav.datos.keys()].join(', '));
    ok('1c · y u1 lo sigue leyendo con su nombre lógico (nadie pierde datos)',
       vm.runInContext(`localStorage.getItem('cronos_teams')`, A) === 'heredado');

    vm.runInContext(`localStorage.setItem('cronos_teams', 'plantilla de u1')`, A);
    ok('1d · u1 escribe en cronos_teams@u1',
       nav.datos.get('cronos_teams@u1') === 'plantilla de u1');

    // Pestaña B: OTRO correo, en el MISMO navegador y a la vez.
    const B = abrirPestana(nav, 'u2');
    ok('1e · 🔐 u2 NO ve la plantilla de u1',
       vm.runInContext(`localStorage.getItem('cronos_teams')`, B) === null,
       'leído: ' + vm.runInContext(`String(localStorage.getItem('cronos_teams'))`, B));

    vm.runInContext(`localStorage.setItem('cronos_teams', 'plantilla de u2')`, B);
    ok('1f · 🔑 y al escribir NO pisa la de u1 (las dos conviven)',
       nav.datos.get('cronos_teams@u1') === 'plantilla de u1' &&
       nav.datos.get('cronos_teams@u2') === 'plantilla de u2',
       [...nav.datos.keys()].join(', '));

    // Borrar es borrar, pero sólo lo mío.
    vm.runInContext(`localStorage.removeItem('cronos_teams')`, B);
    ok('1g · u2 borra lo suyo y lo de u1 sigue ahí',
       !nav.datos.has('cronos_teams@u2') && nav.datos.get('cronos_teams@u1') === 'plantilla de u1');

    // Las claves DEL DISPOSITIVO no se aíslan: son de la máquina, no de nadie.
    vm.runInContext(`localStorage.setItem('cronos_live_muted', '1')`, A);
    ok('1h · las claves del dispositivo NO se aíslan (mute, banner, tutorial)',
       nav.datos.get('cronos_live_muted') === '1' && !nav.datos.has('cronos_live_muted@u1'));
    ok('1i · y las ve cualquier cuenta del aparato',
       vm.runInContext(`localStorage.getItem('cronos_live_muted')`, B) === '1');

    // sessionStorage comparte el prototipo Storage y NO debe aislarse: ahí
    // viven la sesión (v638) y la pertenencia de pestaña (v465), que ya son
    // por pestaña por definición.
    vm.runInContext(`sessionStorage.setItem('cronos_tab_match', 'p1')`, A);
    ok('1j · ⚠️ sessionStorage NO se toca (comparte prototipo con localStorage)',
       vm.runInContext(`sessionStorage.getItem('cronos_tab_match')`, A) === 'p1' &&
       vm.runInContext(`sessionStorage.getItem('cronos_tab_match@u1')`, A) === null);

    // La migración con OTRO propietario previo: lo heredado es de AQUÉL.
    const nav2 = crearNavegador();
    const viejo = abrirPestana(nav2, null);
    vm.runInContext(`localStorage.setItem('cronos_conv_data', 'de u1')`, viejo);
    vm.runInContext(`localStorage.setItem('cronos_owner_uid', 'u1')`, viejo);
    const nuevo = abrirPestana(nav2, 'u2');
    vm.runInContext(`window.cronosMigraClavesLocales('u2')`, nuevo);
    ok('1k · 🔑 lo heredado se guarda a nombre del propietario ANTERIOR, no del que entra',
       nav2.datos.get('cronos_conv_data@u1') === 'de u1' && !nav2.datos.has('cronos_conv_data@u2'),
       [...nav2.datos.keys()].join(', '));
    ok('1l · y el marcador pasa a ser del que entra',
       nav2.datos.get('cronos_owner_uid') === 'u2');

    // Idempotencia: correr la migración dos veces no duplica sufijos.
    vm.runInContext(`window.cronosMigraClavesLocales('u2')`, nuevo);
    ok('1m · la migración es idempotente (no pega el uid dos veces)',
       ![...nav2.datos.keys()].some(k => (k.match(/@/g) || []).length > 1),
       [...nav2.datos.keys()].join(', '));
}

// ══════════════════════════════════════════════════════════════════════
//  PARTE 2 · ENUMERAR: `cronosClavesLocales` devuelve SÓLO lo mío
// ══════════════════════════════════════════════════════════════════════
console.log('\nPARTE 2 · enumeración acotada\n');
{
    const nav = crearNavegador();
    const A = abrirPestana(nav, 'u1');
    const B = abrirPestana(nav, 'u2');
    vm.runInContext(`localStorage.setItem('cronos_reports_sent_M1', '1')`, A);
    vm.runInContext(`localStorage.setItem('cronos_reports_sent_M2', '1')`, B);

    const deA = vm.runInContext(`JSON.stringify(window.cronosClavesLocales('cronos_reports_sent_'))`, A);
    ok('2a · u1 sólo enumera sus guards, y con el nombre LÓGICO',
       deA === JSON.stringify(['cronos_reports_sent_M1']), deA);

    const deB = vm.runInContext(`JSON.stringify(window.cronosClavesLocales('cronos_reports_sent_'))`, B);
    ok('2b · u2 sólo enumera los suyos', deB === JSON.stringify(['cronos_reports_sent_M2']), deB);

    // 🔴 EL DAÑO QUE ESTO EVITA: el arranque de un partido nuevo libera los
    // guards de despacho. Con `Object.keys` a pelo liberaba también los de la
    // otra cuenta, que volvería a enviar informes ya enviados.
    const aPelo = vm.runInContext(
        `Object.keys(localStorage).filter(k => k.indexOf('cronos_reports_sent_') === 0).length`, A);
    ok('2c · 🔴 y a pelo se verían LOS DOS (el defecto que se evita)', aPelo === 2, 'vistos: ' + aPelo);

    // Lo heredado sin dueño sí se ve: un navegador a medio migrar tiene que
    // seguir encontrando su partido en curso.
    const anon = abrirPestana(nav, null);
    vm.runInContext(`localStorage.setItem('cronos_reports_sent_M0', '1')`, anon);
    const conHeredado = vm.runInContext(`JSON.stringify(window.cronosClavesLocales('cronos_reports_sent_'))`, A);
    ok('2d · lo heredado sin dueño también se enumera (navegador a medio migrar)',
       JSON.parse(conHeredado).indexOf('cronos_reports_sent_M0') >= 0, conHeredado);
}

// ══════════════════════════════════════════════════════════════════════
//  PARTE 3 · LAS RANURAS DE PARTIDO: el F7 de una cuenta y el F11 de otra
// ══════════════════════════════════════════════════════════════════════
console.log('\nPARTE 3 · match-slots.js con dos cuentas\n');
{
    const nav = crearNavegador();
    const A = abrirPestana(nav, 'u1');
    const B = abrirPestana(nav, 'u2');
    vm.runInContext(SLOTS, A, { filename: 'match-slots.js' });
    vm.runInContext(SLOTS, B, { filename: 'match-slots.js' });

    const ahora = new Date().toISOString();
    vm.runInContext(`window._cronosMatchSlots.guardar('F7_u1', { teamId: 'f7', savedAt: '${ahora}' })`, A);
    vm.runInContext(`window._cronosMatchSlots.guardar('F11_u2', { teamId: 'f11', savedAt: '${ahora}' })`, B);

    const listaA = JSON.parse(vm.runInContext(
        `JSON.stringify(window._cronosMatchSlots.listar().map(function (r) { return r.id; }))`, A));
    ok('3a · u1 sólo ve SU partido en "Recuperar Partido"',
       listaA.length === 1 && listaA[0] === 'F7_u1', JSON.stringify(listaA));

    const listaB = JSON.parse(vm.runInContext(
        `JSON.stringify(window._cronosMatchSlots.listar().map(function (r) { return r.id; }))`, B));
    ok('3b · u2 sólo ve el suyo', listaB.length === 1 && listaB[0] === 'F11_u2', JSON.stringify(listaB));

    // 🔴 EL BARRIDO DE RANURAS CADUCADAS ERA OTRA VÍA DE DESTRUCCIÓN CRUZADA:
    // recorría todo el almacén, así que el de una cuenta podía llevarse el
    // partido EN CURSO de la otra.
    vm.runInContext(`window._cronosMatchSlots.barrer(6)`, A);
    ok('3c · 🔑 el barrido de u1 NO toca la ranura de u2',
       nav.datos.has('cronos_active_match_v2::F11_u2@u2'),
       [...nav.datos.keys()].join(', '));
    ok('3d · y la suya, viva, tampoco (no barre lo que no toca)',
       nav.datos.has('cronos_active_match_v2::F7_u1@u1'));

    // Y el barrido sí hace su trabajo con lo caducado PROPIO.
    const viejo = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
    vm.runInContext(`window._cronosMatchSlots.guardar('VIEJO', { teamId: 'f7', savedAt: '${viejo}' })`, A);
    vm.runInContext(`window._cronosMatchSlots.barrer(6)`, A);
    ok('3e · el barrido sigue limpiando lo caducado propio',
       !nav.datos.has('cronos_active_match_v2::VIEJO@u1'));

    // El respaldo del arnés: match-slots suelto, sin local-uid.js cargado,
    // tiene que seguir funcionando (es como lo cargan otros guards).
    const pSuelta = nav.pestana();
    const suelto = {
        localStorage: pSuelta.local, sessionStorage: pSuelta.session,
        console: { log() {}, warn() {} }, Date, Math, JSON, Object, String, Number, Array,
    };
    suelto.window = suelto;
    vm.createContext(suelto);
    vm.runInContext(SLOTS, suelto, { filename: 'match-slots.js' });
    const sueltoLista = vm.runInContext(`window._cronosMatchSlots.listar().length`, suelto);
    ok('3f · sin local-uid.js cargado, match-slots.js sigue enumerando (respaldo)',
       sueltoLista >= 2, 'vistas: ' + sueltoLista);
}

// ══════════════════════════════════════════════════════════════════════
//  PARTE 4 · 🔴🔴 EL DEFECTO DE v719: EL BARRIDO SIN ÁMBITO
// ══════════════════════════════════════════════════════════════════════
console.log('\nPARTE 4 · la purga, acotada al que sale\n');

// Se extraen las funciones REALES de firestore-storage.js: la lista blanca, el
// barrido y las dos puertas (login y logout). No se copia la lógica aquí — el
// error de v620 fue justo ése: un test que probaba una copia escrita en el test.
function cargarPurga(sandbox) {
    // ⚠️ EL CORTE TERMINA EXACTAMENTE EN EL MARCADOR, no en "el marcador + un
    // puñado de caracteres a ojo". Un `+200` se colaba dentro de la sentencia
    // siguiente y el trozo no compilaba ("Unexpected end of input"): es el
    // mismo fallo de arnés que costó dos rojos en v719.
    const FIN   = 'window._cronosPurgeAllLocalPII      = _cronosPurgeAllLocalPII;';
    const desde = FSTORE.indexOf('const _CRONOS_LOCAL_KEEP_KEYS');
    const hasta = FSTORE.indexOf(FIN);
    if (desde < 0 || hasta < 0) throw new Error('no se localiza el bloque de purga en firestore-storage.js');
    const trozo = FSTORE.slice(desde, hasta + FIN.length);
    vm.runInContext(trozo, sandbox, { filename: 'firestore-storage.js (trozo)' });
    return trozo;
}

{
    const nav = crearNavegador();
    const A = abrirPestana(nav, 'u1');
    const B = abrirPestana(nav, 'u2');
    const trozo = cargarPurga(B);
    cargarPurga(A);

    ok('4a · el trozo extraído trae las cuatro piezas reales',
       /_CRONOS_LOCAL_KEEP_KEYS/.test(trozo) && /_cronosSweepLocalPII/.test(trozo) &&
       /_purgeStaleLocalDataIfNeeded/.test(trozo) && /_cronosPurgeAllLocalPII/.test(trozo));

    // El escenario de la captura: u1 con su partido y sus plantillas abiertas
    // en una pestaña, y u2 entrando en otra.
    vm.runInContext(`localStorage.setItem('cronos_teams', 'plantillas de u1')`, A);
    vm.runInContext(`localStorage.setItem('cronos_active_match_v2::EN_JUEGO', '{}')`, A);
    vm.runInContext(`localStorage.setItem('cronos_owner_uid', 'u1')`, A);

    vm.runInContext(`window._purgeStaleLocalDataIfNeeded('u2')`, B);

    ok('4b · 🔑🔑 al entrar u2, el partido EN CURSO de u1 sigue vivo',
       nav.datos.get('cronos_active_match_v2::EN_JUEGO@u1') === '{}',
       [...nav.datos.keys()].join(', '));
    ok('4c · 🔑 y sus plantillas también (sólo viven en localStorage)',
       nav.datos.get('cronos_teams@u1') === 'plantillas de u1');
    ok('4d · el marcador del navegador pasa a u2',
       nav.datos.get('cronos_owner_uid') === 'u2');
    ok('4e · ⚠️ y el login de u2 NO recarga la página (la recarga de v719 no limpiaba nada: '
       + '_cronosClearFirestoreCache es un no-op desde v470)',
       B.__recargo !== true && A.__recargo !== true);

    // LOGOUT: u2 se va. Se lleva LO SUYO y nada más.
    vm.runInContext(`localStorage.setItem('cronos_teams', 'plantillas de u2')`, B);
    vm.runInContext(`window._cronosPurgeAllLocalPII('u2')`, B);
    ok('4f · 🔑 el logout de u2 se lleva lo de u2…',
       !nav.datos.has('cronos_teams@u2'));
    ok('4g · …y NO lo de u1, que sigue trabajando en la otra pestaña',
       nav.datos.get('cronos_teams@u1') === 'plantillas de u1' &&
       nav.datos.has('cronos_active_match_v2::EN_JUEGO@u1'),
       [...nav.datos.keys()].join(', '));
    ok('4h · el marcador se borra porque era de quien salía',
       !nav.datos.has('cronos_owner_uid'));

    // 🔴 LA REPRODUCCIÓN DEL DEFECTO: el mismo barrido SIN uid arrasa. Es lo
    // que hacía v719 en cada cambio de cuenta, y lo que él fotografió.
    const purgadas = vm.runInContext(`_cronosSweepLocalPII().length`, B);
    ok('4i · 🔴 el barrido SIN uid arrasa con todo (el defecto reproducido)',
       purgadas >= 2 && !nav.datos.has('cronos_teams@u1') &&
       !nav.datos.has('cronos_active_match_v2::EN_JUEGO@u1'),
       'purgadas: ' + purgadas);
    ok('4j · …pero ni sin uid toca las claves del dispositivo',
       true === (vm.runInContext(`_CRONOS_LOCAL_KEEP_KEYS.has('cronos_live_muted')`, B)));
}

// ══════════════════════════════════════════════════════════════════════
//  PARTE 5 · EL FUENTE: que no vuelva ninguna de las dos trampas
// ══════════════════════════════════════════════════════════════════════
console.log('\nPARTE 5 · el fuente\n');
{
    const FS_LIMPIO = sinComentarios(FSTORE);

    // El barrido sin argumento dentro del login es EXACTAMENTE el defecto.
    const bloqueLogin = FS_LIMPIO.slice(
        FS_LIMPIO.indexOf('function _purgeStaleLocalDataIfNeeded'),
        FS_LIMPIO.indexOf('function _cronosPurgeAllLocalPII'));
    ok('5a · el login ya NO barre',
       !/_cronosSweepLocalPII\s*\(/.test(bloqueLogin), bloqueLogin.slice(0, 200));
    ok('5b · el login ya NO recarga la página',
       !/location\.reload/.test(bloqueLogin));
    ok('5c · y sí migra',
       /cronosMigraClavesLocales/.test(bloqueLogin));

    // El logout tiene que barrer CON ámbito.
    const bloqueLogout = FS_LIMPIO.slice(FS_LIMPIO.indexOf('function _cronosPurgeAllLocalPII'),
                                         FS_LIMPIO.indexOf('window._purgeStaleLocalDataIfNeeded ='));
    ok('5d · el logout barre pasando el uid del que sale',
       /_cronosSweepLocalPII\(\s*_uid\s*\)/.test(bloqueLogout), bloqueLogout.slice(0, 300));

    // Los tres llamadores del logout tienen que capturar el uid ANTES de
    // anular la sesión. security-and-state.js la anulaba tres líneas antes.
    const SEC_LIMPIO = sinComentarios(SECST);
    const iCapta = SEC_LIMPIO.indexOf('_uidSaliente');
    const iAnula = SEC_LIMPIO.indexOf('window._cronosCurrentUser = null');
    ok('5e · 🔑 cerrarSesion() captura el uid ANTES de anular la sesión',
       iCapta > 0 && iAnula > 0 && iCapta < iAnula, 'captura@' + iCapta + ' anula@' + iAnula);
    ok('5f · y lo pasa a la purga',
       /_cronosPurgeAllLocalPII\(_uidSaliente\)/.test(SEC_LIMPIO));
    ok('5g · logoutUser() (auth.js) también',
       /_cronosPurgeAllLocalPII\(_uidSaliente\)/.test(sinComentarios(AUTH)));
    ok('5h · y el stub de index.html no se queda sin uid',
       /_cronosPurgeAllLocalPII\(_u\)/.test(sinComentarios(INDEX)));

    // El aviso obsoleto de v570: dijo dos versiones mayores que sólo se podía
    // tener una sesión por navegador, y desde v638 es MENTIRA.
    const AUTH_LIMPIO = sinComentarios(AUTH);
    ok('5i · 🚨 ya no se le dice que sólo cabe una sesión por navegador',
       !/una sesi[oó]n por\s*'?\s*\+?\s*'?\s*navegador/.test(AUTH_LIMPIO) &&
       !/s[oó]lo se admite una cuenta por navegador/.test(AUTH_LIMPIO));
    ok('5j · y el aviso nuevo dice que otras pestañas no molestan',
       /otras\s*'?\s*\+?\s*'?\s*cuentas abiertas en otras pesta[ñn]as/.test(AUTH_LIMPIO) ||
       /No hace falta cerrar las dem[aá]s pesta[ñn]as/.test(AUTH_LIMPIO));

    // Los enumeradores medidos: los cinco tienen que pasar por el ayudante.
    ok('5k · import.js enumera por cronosClavesLocales',
       /cronosClavesLocales\('cronos_reports_sent_'\)/.test(sinComentarios(IMPORTJS)));
    ok('5l · panel.js (_cronosForceRedispatch) también',
       /cronosClavesLocales\('cronos_reports_sent_'\)/.test(sinComentarios(PANEL)));
    const SLOTS_LIMPIO = sinComentarios(SLOTS);
    ok('5m · match-slots.js no vuelve a enumerar a pelo',
       !/Object\.keys\(localStorage\)/.test(
           SLOTS_LIMPIO.slice(SLOTS_LIMPIO.indexOf('function listar'))),
       'quedan enumeraciones a pelo tras listar()');

    // 🔑 EL ORDEN DE CARGA ES PARTE DEL ARREGLO: si local-uid.js se cargara
    // después de match-slots.js, la mudanza de v464 correría fuera del
    // aislamiento.
    const iUid   = INDEX.indexOf('js/core/local-uid.js');
    const iSlots = INDEX.indexOf('js/core/match-slots.js');
    ok('5n · 🔑 index.html carga local-uid.js ANTES que match-slots.js',
       iUid > 0 && iSlots > 0 && iUid < iSlots, 'local-uid@' + iUid + ' slots@' + iSlots);

    // live.html no carga el módulo (no conoce al usuario de la app): trabaja
    // con claves reales y tiene que quitar el sufijo para comparar el id.
    const LIVE = sinComentarios(fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8'));
    ok('5o · live.html compara el id del partido sin el sufijo del dueño',
       /lastIndexOf\('@'\)/.test(LIVE) && /idSolo === matchId/.test(LIVE));
}

console.log('\n── ' + pass + ' PASS · ' + fail + ' FAIL ──');
process.exit(fail ? 1 : 0);

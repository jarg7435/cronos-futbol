// ─────────────────────────────────────────────────────────────────────────
// test_offline_resilience.js · la app sin cobertura (Piezas A, B, C y D)
//
// El autor preguntó qué pasa si se queda sin cobertura en el campo. La
// respuesta era mala en tres frentes distintos, y este guard fija los cuatro
// arreglos para que ninguno se deshaga solo.
//
// LO QUE PROTEGE, y por qué cada cosa se rompe sola si nadie la vigila:
//
//  A · 🔑🔑 `await setDoc(...)` NO RESUELVE SIN COBERTURA. No lanza, no da
//      error: se queda pendiente PARA SIEMPRE, porque la promesa espera el
//      ACK del servidor. Todo lo que hubiera después del `await` no se
//      ejecuta nunca. En `cloudSet` eso dejaba el `localStorage.setItem`
//      detrás del `await`, así que guardar una plantilla sin red la perdía
//      —y el llamador ya había enseñado "✅ guardado"—. Esta trampa NO la
//      arregla la caché en disco de la Pieza B: la promesa sigue esperando
//      al servidor haya o no persistencia. Por eso el orden es lo que
//      cambia, y por eso no se espera el ACK.
//
//  B · LA CACHÉ EN DISCO NECESITA GESTOR MULTIPESTAÑA. El visor `live.html`
//      se abre con `window.open`: es OTRO documento con SU PROPIA instancia
//      de Firestore, y lo normal es tener los dos abiertos a la vez. Con el
//      gestor por defecto (una sola pestaña), el segundo documento se queda
//      SIN persistencia, que es justo el caso de uso real.
//
//  B2 · ⚠️ PRIVACIDAD: las lecturas desde la caché en disco NO PASAN POR LAS
//      REGLAS. Es la lección de v199 otra vez: sin borrarla al salir, el
//      siguiente usuario del dispositivo puede leer documentos cacheados del
//      anterior. El borrado va enganchado al purgado de PII que ya existía.
//
//  C · 🔑🔑 CON CACHÉ EN DISCO, UNA LECTURA SIN RED NO LANZA: DEVUELVE UN
//      SNAPSHOT VACÍO. `snap.exists()` pasa a ser false porque el documento
//      no está cacheado, no porque no exista. Sin guarda, el usuario sin
//      cobertura caía en la rama de "tu cuenta no está registrada", que le
//      CIERRA LA SESIÓN y le invita a registrarse de nuevo. La misma trampa,
//      en la limpieza de roles huérfanos, llegaba a ESCRIBIR en Firestore un
//      `allRoles` recortado con lo poco que hubiera en caché: pérdida de
//      roles permanente en cuanto volviera la red.
//
//  C2 · UN FALLO DE RED NO PUEDE CERRAR LA SESIÓN. `getIdToken(true)` fuerza
//      ida al servidor y sin red lanza siempre. El refresco forzado sigue
//      siendo obligatorio CON red (SEC-M01, detecta un token revocado), pero
//      sin ella no puede costar la sesión. Y no se reabre SEC-M08: nadie
//      entra sin datos verificados, sólo se conserva la sesión para reintentar.
//
//  D · SIN EL SDK NO HAY NADA QUE SALVAR. El service worker excluía
//      `gstatic.com` a propósito, así que los cuatro módulos de Firebase
//      dependían del caché HTTP del navegador. Si éste los suelta, la app no
//      arranca sin red y las Piezas B y C dan igual. Lo que NO se puede
//      cachear es `googleapis.com`: ése es el canal vivo de Firestore.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Quita comentarios: una aserción que casa con un comentario da VERDE con el
// código borrado (ya pasó en v429).
//
// ⚠️ v453 · EL ORDEN IMPORTA: primero los de LÍNEA y después los de BLOQUE. Al
// revés, un `/*` que viva DENTRO de un comentario de línea —sw.js tiene
// `js/admin/superadmin/*` en su changelog de v390— abre un bloque que se traga
// todo hasta el primer `*/` del fichero. Mientras sw.js no tuvo ningún `*/` no
// pasó nada; en cuanto se añadió uno, este limpiador dejó ciegas 1100 líneas y
// puso en rojo 9 aserciones de la parte 6 sin que nada estuviera roto.
const sinCom = (t) => t
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const STORAGE_SRC = read('js/services/firestore-storage.js');
const INIT_SRC    = read('js/services/firebase-init.js');
const AUTH_SRC    = read('js/services/auth.js');
const LIVE_SRC    = read('live.html');
const SW_SRC      = read('sw.js');

const STORAGE = sinCom(STORAGE_SRC);
const INIT    = sinCom(INIT_SRC);
const AUTH    = sinCom(AUTH_SRC);
const LIVE    = sinCom(LIVE_SRC);
const SW      = sinCom(SW_SRC);

console.log('── la app sin cobertura: Piezas A, B, C y D ──\n');

// ═══════════ PARTE 1 · PIEZA A — cloudSet, EJECUTADO ═══════════
// No basta con mirar el orden en el texto: se ejecuta la función real contra
// un `setDoc` que NO RESUELVE NUNCA, que es exactamente lo que hace el SDK
// sin cobertura. Si la función volviera a esperar el ACK, este bloque cuelga
// y el test lo caza por timeout de la aserción.
console.log('── PARTE 1 · PIEZA A · cloudSet sin cobertura ──');
{
    const ini = STORAGE_SRC.indexOf('async function cloudSet(');
    const fin = STORAGE_SRC.indexOf('async function cloudGet(');
    ok('1a · cloudSet sigue en firestore-storage.js', ini !== -1 && fin > ini);

    if (ini !== -1 && fin > ini) {
        // El `import()` dinámico es sintaxis, no una función: no se puede
        // sustituir con un global desde el sandbox. Se reescribe a una llamada
        // normal ANTES de ejecutar, y el sandbox provee el módulo falso.
        const fuente = STORAGE_SRC.slice(ini, fin)
            .replace(/await import\(\s*[\s\S]*?firebase-firestore\.js'\s*\)/g, 'await __fsmod()');

        const store = new Map();
        let entregadaALaNube = false;
        const sb = {
            console: { log() {}, warn() {}, error() {} },
            localStorage: {
                setItem: (k, v) => store.set(k, String(v)),
                getItem: (k) => (store.has(k) ? store.get(k) : null),
            },
            window: {
                _cronos_auth: { db: {} },
                _cronosCurrentUser: { uid: 'uid-entrenador' },
            },
            // setDoc que NUNCA resuelve: el SDK sin cobertura, literal.
            __fsmod: async () => ({
                doc: () => ({}),
                setDoc: () => { entregadaALaNube = true; return new Promise(() => {}); },
            }),
        };
        vm.createContext(sb);
        vm.runInContext(fuente + '\n;globalThis.__cloudSet = cloudSet;', sb);

        // Carrera contra un temporizador: si cloudSet vuelve a esperar el ACK,
        // gana el temporizador y la aserción falla en vez de colgar el guard.
        const resuelta = Promise.race([
            sb.__cloudSet('cronos_teams', '[{"name":"Alevin A"}]').then(() => 'resuelta'),
            new Promise(r => setTimeout(() => r('COLGADA'), 1500)),
        ]);

        return resuelta.then((veredicto) => {
            ok('1b · [PIEZA A] 🔑🔑 cloudSet NO se cuelga esperando el ACK del servidor',
               veredicto === 'resuelta',
               'la promesa se quedó pendiente: sin cobertura el llamador no sigue nunca');
            ok('1c · [PIEZA A] 🔑 el dato queda en localStorage AUNQUE la nube no conteste',
               store.get('cronos_teams') === '[{"name":"Alevin A"}]',
               'guardado local: ' + store.get('cronos_teams'));
            ok('1d · la escritura SÍ se entrega al SDK (que la reenviará solo)',
               entregadaALaNube === true);
            resto();
        });
    }
    resto();
}

function resto() {

// ═══════════ PARTE 2 · PIEZA A — el orden, en el texto ═══════════
console.log('\n── PARTE 2 · PIEZA A · el orden es el contrato ──');
{
    const ini = STORAGE.indexOf('async function cloudSet(');
    const fin = STORAGE.indexOf('async function cloudGet(');
    const cuerpo = ini !== -1 && fin > ini ? STORAGE.slice(ini, fin) : '';

    const posLocal = cuerpo.indexOf('localStorage.setItem');
    const posImport = cuerpo.indexOf('await import');
    ok('2a · [PIEZA A] localStorage.setItem va ANTES del primer await',
       posLocal !== -1 && posImport !== -1 && posLocal < posImport,
       'local en ' + posLocal + ', primer await en ' + posImport);

    ok('2b · [PIEZA A] no queda ningún `await setDoc` en cloudSet',
       !/await\s+setDoc\s*\(/.test(cuerpo),
       'un await sobre setDoc vuelve a colgar la función sin cobertura');

    ok('2c · [PIEZA A] el fallo de permisos se sigue avisando',
       /\.catch\s*\(/.test(cuerpo) && /permission/.test(cuerpo),
       'sin esto se pierde el aviso que el llamador ya no puede recibir');
}

// ═══════════ PARTE 3 · PIEZA B — caché en disco en LOS DOS documentos ═══════════
console.log('\n── PARTE 3 · PIEZA B · persistencia en disco ──');
{
    for (const [etq, SRC] of [['firebase-init.js', INIT], ['live.html', LIVE]]) {
        ok('3a · [PIEZA B] ' + etq + ' inicializa Firestore con initializeFirestore',
           /initializeFirestore\s*\(\s*app\s*,/.test(SRC));
        ok('3b · [PIEZA B] ' + etq + ' pide caché persistente',
           /persistentLocalCache\s*\(/.test(SRC));
        ok('3c · [PIEZA B] 🔑 ' + etq + ' usa el gestor MULTIPESTAÑA',
           /persistentMultipleTabManager\s*\(\s*\)/.test(SRC),
           'sin él, el segundo documento abierto se queda sin persistencia');
        ok('3d · ' + etq + ' conserva getFirestore como respaldo',
           /getFirestore\s*\(\s*app\s*\)/.test(SRC),
           'si el navegador no admite persistencia hay que seguir arrancando');
        ok('3e · ' + etq + ' importa lo que usa',
           /persistentLocalCache/.test(SRC.slice(0, SRC.indexOf('firebaseConfig'))) ||
           /import[\s\S]{0,400}persistentLocalCache/.test(SRC),
           'un import que falta es un ReferenceError en el arranque');
    }
}

// ═══════════ PARTE 4 · PIEZA B2 — privacidad: borrar la caché al salir ═══════════
console.log('\n── PARTE 4 · PIEZA B2 · la caché en disco y la PII ──');
{
    ok('4a · [PIEZA B2] existe el borrador de la caché de Firestore',
       /_cronosClearFirestoreCache\s*=/.test(INIT));
    // ⚠️⚠️ v468 · INVERTIDA A PROPOSITO. Esta asercion exigia
    // `terminate(...)` + `clearIndexedDbPersistence(...)`, y ESO ES
    // EXACTAMENTE LO QUE PROVOCO UN BLOQUEO TOTAL DE ACCESO en produccion
    // (v467): no existe la "instancia temporal" —`initializeFirestore` crea LA
    // de la app—, asi que terminar para poder borrar dejaba a la aplicacion
    // corriendo sobre un cliente muerto y no se podia ni iniciar sesion.
    //
    // La INTENCION original se conserva entera y se sigue exigiendo: la cache
    // en disco SE BORRA (4a, 4c, 4d, 4e). Lo que cambia es el COMO: por
    // IndexedDB, que no necesita ninguna instancia de Firestore. Y se anyade la
    // prohibicion, porque asi es como se reescribiria el corte.
    ok('4b · [PIEZA B2] 🔑 la cache se borra por IndexedDB, SIN terminar el cliente',
       /indexedDB\.deleteDatabase\s*\(/.test(INIT),
       'sin instancia de por medio: es lo unico que no deja a la app sin cliente');
    ok('4b2 · [PIEZA B2] ⚠️ y NO se termina ninguna instancia (bloqueo de acceso de v467)',
       !/\bterminate\s*\(/.test(INIT.replace(/\/\/[^\n]*/g, '')) &&
       !/\bclearIndexedDbPersistence\s*\(/.test(INIT.replace(/\/\/[^\n]*/g, '')),
       'terminar la instancia que la app usa fue el corte total de v467');

    // ⚠️ Hay que exigir la LLAMADA, no que el nombre aparezca: la guarda
    // `typeof window._cronosClearFirestoreCache === 'function'` ya contiene el
    // nombre, así que una regex sobre el nombre pelado seguía dando VERDE con
    // la llamada borrada. Lo cazó el red-check; es la misma clase de aserción
    // que en v417 defendía el propio bug.
    const _llama = (src) => /_cronosClearFirestoreCache\s*\(/.test(src);

    const CORE = sinCom(read('js/core/security-and-state.js'));
    ok('4c · [PIEZA B2] 🔑 el logout de security-and-state.js borra la caché',
       _llama(CORE));
    ok('4d · [PIEZA B2] 🔑 el logout de auth.js borra la caché',
       _llama(AUTH));
    ok('4e · [PIEZA B2] el cambio de usuario (CASO 3) también la borra',
       _llama(STORAGE),
       'es el escenario exacto de v199: otro usuario en el mismo dispositivo');

    // v204: la purga NO puede volver a dispararse por falta de marcador.
    ok('4f · v204 intacto: sin marcador previo se ADOPTA el uid, no se purga',
       /if\s*\(\s*!ownerUid\s*\)/.test(STORAGE) &&
       STORAGE.indexOf("localStorage.setItem('cronos_owner_uid', incomingUid)") !== -1);
}

// ═══════════ PARTE 5 · PIEZA C — entrar sin cobertura ═══════════
console.log('\n── PARTE 5 · PIEZA C · la puerta de entrada ──');
{
    ok('5a · [PIEZA C2] el refresco del token ya no es forzado a ciegas',
       !/await\s+user\.getIdToken\(\s*true\s*\)/.test(INIT),
       'getIdToken(true) exige ida al servidor: sin red lanza siempre');
    ok('5b · [PIEZA C2] 🔑 un fallo de RED no cierra la sesión',
       /network-request-failed/.test(INIT),
       'hay que distinguir "sin red" de "token revocado"');
    ok('5c · [PIEZA C2] con red, el refresco forzado SIGUE haciéndose (SEC-M01)',
       /navigator\.onLine/.test(INIT) && /getIdToken\(/.test(INIT));

    // ⚠️ Las anclas de estas tres aserciones tienen que ser CÓDIGO, no texto de
    // comentario: este guard borra los comentarios antes de buscar, así que un
    // ancla comentada no se encuentra jamás (y con la lógica invertida daría un
    // falso verde en cuanto alguien reescribiera el comentario).
    ok('5d · [PIEZA C] 🔑🔑 CASO 1 distingue "no existe" de "no está en caché"',
       (() => {
           const i = AUTH.indexOf('if (!snap.exists())');
           if (i === -1) return false;
           // La guarda de caché tiene que ir ANTES de la rama que expulsa,
           // y en el bloque inmediatamente anterior (no en cualquier sitio).
           return /snap\.metadata[\s\S]{0,40}fromCache/.test(AUTH.slice(Math.max(0, i - 1000), i));
       })(),
       'sin esta guarda, sin cobertura te dice que tu cuenta no está registrada y te expulsa');

    ok('5e · [PIEZA C] 🔑 la limpieza de roles huérfanos se salta si el dato es de caché',
       (() => {
           const i = AUTH.indexOf('Timeout clubs (cleanup)');
           if (i === -1) return false;
           const bloque = AUTH.slice(i, i + 900);
           // Y tiene que cortar ANTES de construir validClubIds.
           const j = bloque.indexOf('validClubIds');
           return /clubsSnap\.metadata[\s\S]{0,40}fromCache/.test(bloque) &&
                  bloque.indexOf('fromCache') < (j === -1 ? Infinity : j);
       })(),
       'escribía un allRoles recortado: pérdida de roles al volver la red');

    ok('5f · [PIEZA C] la verificación de roles cae en FAIL-OPEN si el dato es de caché',
       /_verificationLoaded\s*=\s*[^;]*fromCache/.test(AUTH) &&
       !/_verificationLoaded\s*=\s*true\s*;/.test(AUTH),
       'con la caché vacía se filtrarían todos los roles secundarios');

    ok('5g · [PIEZA C] 🔑 el lastLogin ya no bloquea la entrada',
       !/await\s+fa\.setDoc\(ref,\s*\{\s*lastLogin/.test(AUTH),
       'ese await es lo último antes de enterApp(): sin cobertura no se entra nunca');

    ok('5h · [PIEZA C] un error de red no dispara el signOut del catch final',
       (() => {
           const i = AUTH.indexOf('Auth verify error');
           if (i === -1) return false;
           const bloque = AUTH.slice(i, i + 1800);
           return /unavailable|offline|navigator\.onLine|network/.test(bloque);
       })(),
       'hoy cualquier fallo de red te devuelve al login y borra la sesión');

    ok('5i · SEC-M08 sigue en pie: el catch final NO llama a enterApp()',
       (() => {
           const i = AUTH.indexOf('Auth verify error');
           if (i === -1) return false;
           return !/enterApp\s*\(\s*\)/.test(AUTH.slice(i, i + 1800));
       })(),
       'entrar sin datos verificados es justo lo que quitó SEC-M08');

    ok('5j · [PIEZA C] al recuperar la red se revalida la autorización',
       /addEventListener\(\s*'online'/.test(INIT),
       'quien entró desde caché puede haber dejado de estar autorizado');
}

// ═══════════ PARTE 6 · PIEZA D — el SDK en el service worker ═══════════
console.log('\n── PARTE 6 · PIEZA D · REVERTIDA en v454 ──');
{
    // ⚠️⚠️ ESTA PARTE ESTÁ INVERTIDA A PROPÓSITO. Fijaba la "Pieza D" de v447
    // —precachear el SDK de Firebase y servirlo cache-first— y esa decisión
    // ROMPIÓ LA APLICACIÓN en móvil y en iPad: `live.html` importa el SDK con
    // `import` ESTÁTICOS, así que en cuanto una de esas peticiones devolvía
    // algo que no fuera JavaScript válido (una respuesta de error nuestra, o
    // una entrada de caché envenenada) el módulo ENTERO no se evaluaba y la
    // página se quedaba EN BLANCO, sin mensaje.
    //
    // Se invierten en vez de borrarse, como los cuatro guards de v440: lo que
    // hay que defender ahora es justo lo contrario, y con la misma firmeza.
    // 🔑 La regla que queda: el Service Worker NO intercepta peticiones de
    // otro origen que alimenten `import` de módulos.
    for (const m of ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-functions.js']) {
        ok('6a · [REVERTIDO] el SW ya NO precachea ' + m,
           !new RegExp("'https://www\\.gstatic\\.com/firebasejs/[0-9.]+/" + m.replace('.', '\\.') + "'").test(SW),
           'precachearlo es inútil si no se sirve de caché, y `cache.addAll` sobre ' +
           'otro origen falla en iOS');
    }
    // El criterio de "no cachear" y el de "cache-first" tienen que ser dos
    // funciones con nombre: si se mezclan en una condición suelta, basta con
    // que gstatic aparezca en cualquier sitio para que una regex dé verde.
    const cuerpoDe = (nombre) => {
        const i = SW.indexOf('function ' + nombre + '(');
        return i === -1 ? '' : SW.slice(i, SW.indexOf('}', i) + 1);
    };
    const CANAL_VIVO = cuerpoDe('_esCanalVivo');

    ok('6b · [REVERTIDO] 🔑🔑 gstatic.com NO se intercepta: lo sirve el navegador',
       CANAL_VIVO !== '' && /gstatic/.test(CANAL_VIVO),
       'interceptar imports de módulos de otro origen dejó live.html EN BLANCO · ' + CANAL_VIVO);
    ok('6c · ⚠️ googleapis.com sigue sin interceptarse (canal vivo de datos)',
       /googleapis\.com/.test(CANAL_VIVO),
       'cachearlo serviría un marcador muerto');
    ok('6d · [REVERTIDO] ya no existe la función que enrutaba el SDK a cache-first',
       !/_esSdkFirebase/.test(SW),
       'su sola existencia invita a volver a interceptar gstatic');
    ok('6e · 🔑 el manejador `fetch` no menciona gstatic salvo para NO tocarlo',
       (() => {
           const f = SW.slice(SW.indexOf("addEventListener('fetch'"));
           return !/gstatic/.test(f);
       })(),
       'la única mención permitida está en _esCanalVivo, fuera del manejador');
    ok('6e2 · la instalación no puede fallar por un recurso de otro origen',
       !/cache\.addAll\(FIREBASE_SDK\)/.test(SW) && !/const FIREBASE_SDK\s*=/.test(SW),
       'un install que falla deja mandando al Service Worker VIEJO');

    // El bump es lo que hace que un despliegue de hosting llegue de verdad.
    const cacheName = (SW.match(/const CACHE_NAME = '([^']+)'/) || [])[1] || '';
    ok('6f · CACHE_NAME bumpeado por encima de v446',
       (() => {
           const n = parseInt((cacheName.match(/v(\d+)$/) || [])[1] || '0', 10);
           return n > 446;
       })(),
       'CACHE_NAME actual: ' + cacheName);
}

console.log('\n' + '─'.repeat(60));
console.log(`Resultado: ${pass} PASS · ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

}

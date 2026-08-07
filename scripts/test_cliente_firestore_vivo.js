// ─────────────────────────────────────────────────────────────────────────
// test_cliente_firestore_vivo.js  ·  nunca se termina el cliente que la app
// esta usando, y uno muerto se recupera sin bucle (v467)
//
// EMERGENCIA reportada por el autor sobre v466 (capturas 8484/8485/8487/8488):
// bucles masivos de `The client has already been terminated` y de
// `failed-precondition` al guardar sucesos. Nada se sincronizaba ni se
// guardaba, en F7 y en F11.
//
// ⚠️ LA CAUSA, y por que estaba escrita en el codigo desde antes:
// `_purgeStaleLocalDataIfNeeded` salta en el LOGIN cuando el uid entrante no
// es el ultimo que uso el dispositivo — o sea CADA VEZ QUE SE CAMBIA DE CUENTA
// en el mismo navegador, que en una demo es constante. Ahi llamaba a
// `_cronosClearFirestoreCache()`, que hacia:
//
//      await terminate(db);                  // ← LA INSTANCIA VIVA
//      await clearIndexedDbPersistence(db);
//      ... y solo entonces location.reload()
//
// El cliente moria en el acto, pero la recarga iba DESPUES de
// `clearIndexedDbPersistence`, que **rechaza o se queda colgada mientras otra
// pestaña tenga la persistencia abierta** — lo habitual con el gestor
// multipestaña (live.html abierto, o los dos partidos simultaneos que v465
// hizo posibles). En esa ventana la app seguia viva sobre un cliente muerto:
// el latido de 5 s y cada escritura de suceso fallaban una y otra vez.
//
// LO QUE PROTEGE:
//
//  A · 🔑🔑 NADIE TERMINA EL CLIENTE QUE LA APP ESTA USANDO. `terminate` y
//      `clearIndexedDbPersistence` solo pueden aparecer en el ARRANQUE, antes
//      de que exista la instancia que usara la app. Es la regla que se rompio.
//
//  B · La limpieza NO SE PIERDE: se deja una marca y se hace en el arranque
//      siguiente. Es privacidad —las lecturas de la cache no pasan por las
//      reglas—, asi que "no borrar" no es una opcion aceptable.
//
//  C · LA MARCA SE RETIRA ANTES DE INTENTARLO. Si el borrado falla (otra
//      pestaña con la persistencia abierta), una marca pegada repetiria el
//      intento en CADA arranque para siempre.
//
//  D · LA MARCA SOBREVIVE AL BARRIDO DE PII, que corre justo antes de dejarla.
//
//  E · UN CLIENTE MUERTO SE RECUPERA, Y CON TOPE. No se recupera solo: hay que
//      recargar. Pero una recarga en bucle seria PEOR que el fallo — dejaria la
//      app inservible y sin poder leer el aviso. Un intento por sesion.
//
//  F · Y SE ENGANCHA DONDE DE VERDAD DOLIA: el latido de `pushLiveSnapshot` y
//      la escritura de sucesos de `_registerMatchEvent`, que son los dos que
//      salian en bucle en las capturas.
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

const INIT   = fs.readFileSync(path.join(ROOT, 'js', 'services', 'firebase-init.js'), 'utf8');
const STORE  = fs.readFileSync(path.join(ROOT, 'js', 'services', 'firestore-storage.js'), 'utf8');
const SYNC   = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const ACTS   = fs.readFileSync(path.join(ROOT, 'js', 'match', 'events', 'player-actions.js'), 'utf8');

console.log('── el cliente de Firestore no se queda muerto (v467) ──\n');

// ⚠️ CENSO SOBRE CÓDIGO, NO SOBRE COMENTARIOS. La primera versión de este guard
// daba ROJO en 1c contando las veces que los COMENTARIOS de este mismo arreglo
// nombran `terminate(db)` para explicar el fallo. Un censo por regex sobre el
// fuente crudo no distingue una llamada de una explicación.
// Se recorre carácter a carácter porque un `.replace` ingenuo destroza las URLs
// de los `import('https://...')`: el `//` del protocolo va dentro de una cadena.
function sinComentarios(src) {
    let out = '', i = 0, n = src.length;
    let enCadena = null, enPlantilla = 0;
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (enCadena) {
            out += c;
            if (c === '\\') { out += (d || ''); i += 2; continue; }
            if (c === enCadena) enCadena = null;
            i++; continue;
        }
        if (enPlantilla) {
            out += c;
            if (c === '\\') { out += (d || ''); i += 2; continue; }
            if (c === '`') enPlantilla--;
            i++; continue;
        }
        if (c === '"' || c === "'") { enCadena = c; out += c; i++; continue; }
        if (c === '`') { enPlantilla++; out += c; i++; continue; }
        if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        out += c; i++;
    }
    return out;
}
// Comprobación del propio arnés: si el limpiador se comiera las URLs o dejara
// pasar los comentarios, todo lo de abajo mediría otra cosa.
{
    const m = sinComentarios("a; // terminate(x)\nimport('https://u'); /* terminate(y) */ terminate(z);");
    ok('· (arnés) el limpiador quita comentarios y respeta las URLs',
       (m.match(/terminate\s*\(/g) || []).length === 1 && m.includes('https://u'), m.trim());
}

// ═══════════ PARTE 1 · ⚠️ nadie termina el cliente vivo ═══════════
console.log('── PARTE 1 · ⚠️ nadie termina el cliente que la app usa ──');
{
    // A · `terminate(` y `clearIndexedDbPersistence(` SOLO pueden estar en el
    // bloque de arranque, que es el trozo ANTERIOR a la creacion del `db` que
    // usara la app. Se localiza por esa creacion, no por un numero de linea.
    const INIT_COD = sinComentarios(INIT);
    const corte = INIT_COD.indexOf('let db;');
    ok('1a · se localiza dónde nace el `db` que usa la app', corte !== -1);

    const antes   = INIT_COD.slice(0, corte);
    const despues = INIT_COD.slice(corte);

    const usos = (txt, re) => (txt.match(re) || []).length;
    const reTerm  = /\bterminate\s*\(/g;
    const reClear = /\bclearIndexedDbPersistence\s*\(/g;

    // ⚠️⚠️ v468 · REESCRITA, Y ES LA ASERCIÓN CENTRAL DEL FICHERO.
    // La versión de v467 decía "el arranque SÍ puede terminar (una instancia
    // temporal)". ESO ERA FALSO Y CAUSÓ UN BLOQUEO TOTAL DE ACCESO en
    // producción: `initializeFirestore` NO crea instancias temporales, crea LA
    // instancia de la app. Terminar "la temporal" era terminar la única que
    // habría, y la segunda `initializeFirestore` —la que lleva `localCache`—
    // lanzaba, caía al `catch` y `getFirestore(app)` devolvía la instancia YA
    // TERMINADA. La app entera arrancaba sobre un cliente muerto.
    //
    // La invariante correcta no admite matices: en el producto NO SE TERMINA
    // NINGUNA INSTANCIA, NUNCA, EN NINGÚN SITIO. La caché se borra por
    // IndexedDB, que no necesita cliente.
    ok('1b · ⚠️🔑 `terminate` NO aparece en NINGÚN punto del arranque',
       usos(antes, reTerm) === 0 && usos(despues, reTerm) === 0,
       'antes=' + usos(antes, reTerm) + ' después=' + usos(despues, reTerm) +
       ' — no existe la "instancia temporal": initializeFirestore crea LA de la app');

    ok('1c · ⚠️🔑 `clearIndexedDbPersistence` tampoco (exige terminar para poder usarse)',
       usos(antes, reClear) === 0 && usos(despues, reClear) === 0,
       'antes=' + usos(antes, reClear) + ' después=' + usos(despues, reClear));

    // Y ni siquiera se importan: con ellas a mano, la vía se vuelve a tomar.
    ok('1b2 · ⚠️ ni se IMPORTAN desde el SDK (la barrera de verdad)',
       !/\bterminate\s*,/.test(antes) && !/\bclearIndexedDbPersistence\s*,/.test(antes),
       'estaban importadas cuando se cometió el fallo de v467');

    // 🔑 Y exactamente UNA creación de instancia. Dos = la segunda lanza y la
    // app se queda con la primera, que es como se rompió el acceso.
    const nInit = usos(INIT_COD, /\binitializeFirestore\s*\(/g);
    ok('1b3 · ⚠️🔑 `initializeFirestore` se llama UNA sola vez en todo el fichero',
       nInit === 1, 'llamadas=' + nInit +
       ' — la segunda lanza y deja a la app con la primera (bloqueo de acceso de v467)');

    // Y en ningún otro fichero del producto.
    const otros = [['firestore-storage.js', STORE], ['sync.js', SYNC], ['player-actions.js', ACTS]];
    const culpables = otros.filter(([, src]) => {
        const cod = sinComentarios(src);
        return /\bterminate\s*\(/.test(cod) || /\bclearIndexedDbPersistence\s*\(/.test(cod);
    }).map(([n]) => n);
    ok('1d · ningún otro módulo termina el cliente por su cuenta', culpables.length === 0, culpables.join(', '));
}

// ═══════════ PARTE 2 · la limpieza no se pierde, se aplaza ═══════════
console.log('\n── PARTE 2 · la limpieza se aplaza al arranque, no se pierde ──');
{
    // B · `_cronosClearFirestoreCache` deja marca y NO termina nada. Se ejecuta.
    const ini = INIT.indexOf('window._cronosClearFirestoreCache = async function');
    ok('2a · existe _cronosClearFirestoreCache', ini !== -1);
    const fin = INIT.indexOf('};', INIT.indexOf('return false;', ini)) + 2;
    const fuente = INIT.slice(ini, fin);

    const almacen = () => {
        const m = new Map();
        return { getItem: k => (m.has(k) ? m.get(k) : null),
                 setItem: (k, v) => m.set(k, String(v)),
                 removeItem: k => m.delete(k), _m: m };
    };
    const ls = almacen();
    const sandbox = { localStorage: ls, console: { log() {}, warn() {} } };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fuente, sandbox);

    let devuelto = null;
    // Es async: se resuelve de inmediato porque ya no espera a Firestore.
    sandbox.window._cronosClearFirestoreCache().then(v => { devuelto = v; });
    // microtask
    return void Promise.resolve().then(() => {
        ok('2b · 🔑 deja la MARCA de limpieza pendiente',
           ls.getItem('cronos_pending_cache_clear') !== null);
        ok('2c · y dice que sí al llamador (la limpieza está garantizada, cambia el CUÁNDO)',
           devuelto === true, String(devuelto));
        ok('2d · ⚠️ y NO termina nada (es lo que mataba la sincronización)',
           !/terminate\s*\(/.test(fuente) && !/clearIndexedDbPersistence\s*\(/.test(fuente));
        seguir(ls);
    });
}

function seguir(lsPrevio) {

// ═══════════ PARTE 3 · el arranque consume la marca ═══════════
console.log('\n── PARTE 3 · el arranque consume la marca ──');
{
    const bloque = INIT.slice(INIT.indexOf("const _MARCA_LIMPIEZA"), INIT.indexOf('let db;'));

    ok('3a · el arranque lee la marca', /localStorage\.getItem\(_MARCA_LIMPIEZA\)/.test(bloque));
    // C · se retira ANTES de intentarlo.
    const iQuita = bloque.indexOf('removeItem(_MARCA_LIMPIEZA)');
    const iBorra = bloque.indexOf('deleteDatabase(');
    ok('3b · ⚠️🔑 la marca se retira ANTES de intentar el borrado',
       iQuita !== -1 && iBorra !== -1 && iQuita < iBorra,
       'si el borrado falla —otra pestaña con la base abierta— una marca pegada repetiría el intento en CADA arranque');
    // 🔑 v468 · el borrado va por IndexedDB, que NO necesita cliente. Es lo que
    // permite cumplir "no se termina el cliente" sin quedarse sin cliente.
    ok('3c · 🔑 el borrado va por IndexedDB, sin crear ni terminar ninguna instancia',
       /indexedDB\.deleteDatabase\(/.test(bloque) &&
       !/initializeFirestore/.test(bloque) && !/terminate\(/.test(bloque),
       'crear una instancia "temporal" aquí fue el bloqueo total de acceso de v467');
    ok('3c2 · y sabe el nombre canónico por si el navegador no deja enumerar (Firefox)',
       /firestore\/\[DEFAULT\]\/' \+ firebaseConfig\.projectId \+ '\/main/.test(bloque));
    ok('3c3 · ⚠️ no se queda esperando si otra pestaña tiene la base abierta',
       /onblocked/.test(bloque) && /setTimeout\(res, \d+\)/.test(bloque),
       'un `blocked` sin salida colgaría el arranque de la app para siempre');
    ok('3d · y nunca bloquea el arranque (va en try/catch)',
       /catch \(e\) \{[\s\S]{0,220}?No se pudo borrar la caché en el arranque/.test(bloque));

    // D · la marca sobrevive al barrido de PII.
    ok('3e · ⚠️ la marca está en la lista blanca del barrido de PII',
       /'cronos_pending_cache_clear',/.test(STORE),
       'el barrido corre JUSTO ANTES de dejarla: sin lista blanca se la llevaría y la caché del usuario anterior no se borraría');
}

// ═══════════ PARTE 4 · 🔑 recuperación sin bucle ═══════════
console.log('\n── PARTE 4 · 🔑 un cliente muerto se recupera, y con tope ──');
{
    const ini = INIT.indexOf("const _CLAVE_RECARGA");
    const fin = INIT.indexOf('// ── Función checkAuthorization');
    ok('4a · el bloque de recuperación existe y se puede ejecutar', ini !== -1 && fin > ini);

    const ss = (() => { const m = new Map(); return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
    let recargas = 0, avisos = [], esperas = [];
    const sandbox = {
        sessionStorage: ss,
        console: { log() {}, warn() {}, error() {} },
        location: { reload: () => { recargas++; } },
        showToast: (t) => avisos.push(t),
        setTimeout: (fn, ms) => { esperas.push(ms); fn(); return 0; },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(INIT.slice(ini, fin), sandbox);
    const muerto = sandbox.window._cronosClienteTerminado;
    const recupera = sandbox.window._cronosRecuperaSiClienteMuerto;

    // Los mensajes REALES de las capturas del autor.
    ok('4b · reconoce "The client has already been terminated"',
       muerto(new Error('The client has already been terminated')) === true);
    ok('4c · reconoce el que sale al guardar un suceso (failed-precondition)',
       muerto({ code: 'failed-precondition', message: 'The client has already been terminated' }) === true);
    ok('4d · y NO confunde un fallo de red normal con un cliente muerto',
       muerto(new Error('Failed to get document because the client is offline')) === false &&
       muerto({ code: 'permission-denied', message: 'Missing or insufficient permissions' }) === false,
       'recargar por un corte de cobertura sería peor que el fallo');
    ok('4e · ni un error vacío', muerto(null) === false && muerto(undefined) === false);

    // E · recupera UNA vez.
    const r1 = recupera(new Error('The client has already been terminated'), 'test');
    ok('4f · 🔑 la primera vez recarga (es la única salida de un cliente muerto)',
       r1 === true && recargas === 1, 'recargas=' + recargas);
    ok('4g · y avisa al usuario antes de recargar', avisos.length === 1, JSON.stringify(avisos));
    ok('4h · con un respiro, no en el mismo tick', esperas[0] >= 500, 'espera=' + esperas[0]);

    // ⚠️ y NO vuelve a recargar: el bucle sería peor que el fallo.
    const r2 = recupera(new Error('The client has already been terminated'), 'test');
    ok('4i · ⚠️🔑 la SEGUNDA vez NO recarga (un bucle de recargas deja la app inservible)',
       r2 === true && recargas === 1, 'recargas=' + recargas);
    ok('4j · y ahí sí explica qué hacer, en vez de recargar en vano',
       avisos.length === 2 && /pestañas/i.test(avisos[1]), JSON.stringify(avisos[1]));

    // Un error normal no dispara nada.
    const r3 = recupera(new Error('offline'), 'test');
    ok('4k · un error corriente no dispara recuperación', r3 === false && recargas === 1);
}

// ═══════════ PARTE 5 · enganchado donde dolía ═══════════
console.log('\n── PARTE 5 · enganchado en los dos puntos de las capturas ──');
{
    // F · el latido y la escritura de sucesos: los dos que salían en bucle.
    const iSync = SYNC.indexOf("console.warn('Error sync live:'");
    ok('5a · el latido en vivo comprueba el cliente muerto',
       iSync !== -1 && /_cronosRecuperaSiClienteMuerto\(err, 'pushLiveSnapshot'\)/
           .test(SYNC.slice(iSync, iSync + 900)),
       'sin esto, el latido repite el error cada 5 s para siempre');

    const iAct = ACTS.indexOf("ERROR guardando evento:");
    ok('5b · la escritura de sucesos también',
       iAct !== -1 && /_cronosRecuperaSiClienteMuerto\(err, '_registerMatchEvent'\)/
           .test(ACTS.slice(iAct, iAct + 900)),
       'es el segundo error en bucle de las capturas');
}

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

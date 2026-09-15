// ════════════════════════════════════════════════════════════════════════
//  🔴🔴🔴 v721 · UNA CUENTA POR CACHÉ DE FIRESTORE
// ════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-15, sobre v720): con tres
//  partidos simultáneos, FUTureFEM C dejó de transmitir por completo («terminé
//  el partido y el visor siguió EN VIVO»), Regional B se quedó clavado en el
//  descanso y el visor dejó de avisar.
//
//  📏 LO QUE LOS UNE (confirmado con él): DOS CUENTAS DISTINTAS en el mismo
//  navegador —Chrome del PC y Safari del iPad—. Y la causa está en el SDK de
//  Firestore (4.6.3, leído en su fuente): con `persistentMultipleTabManager`
//  la pestaña primaria sólo envía las escrituras de SU usuario («Ignoring
//  mutation for non-active user») y ejecuta los oyentes de las demás con SUS
//  credenciales. La otra cuenta transmitía al vacío sin un solo error.
//
//  Este guard EJECUTA js/shared/fs-cache-mode.js en dos pestañas simuladas que
//  comparten UN localStorage (como en un navegador) y tienen sessionStorage
//  propio (como en un navegador), y comprueba el cableado en los dos
//  documentos, la puerta de fase del reloj y el vigilante del visor.
// ════════════════════════════════════════════════════════════════════════
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function ok(nombre, cond, detalle) {
    if (cond) { pass++; console.log('PASS ' + nombre); }
    else { fail++; console.log('FAIL ' + nombre + (detalle ? '\n     → ' + detalle : '')); }
}
const sinComentarios = (s) => String(s || '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    if (i < 0) return null;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}

const MODULO = leer('js/shared/fs-cache-mode.js');
const INIT   = leer('js/services/firebase-init.js');
const LIVE   = leer('live.html');
const INDEX  = leer('index.html');
const SW     = leer('sw.js');
const TIMER  = leer('js/match/timer/core.js');
const EVENTS = leer('js/core/event-listeners.js');

// ── Un navegador: UN localStorage compartido, un reloj y un bus de `storage` ──
function navegador() {
    const almacen = new Map();
    const pestanas = [];
    const reloj = { t: 1789480000000 };
    function storage(mapa, origen) {
        // Proxy para que `Object.keys(localStorage)` devuelva las claves, como
        // en el navegador. ⚠️ El mapa NO va como propiedad del objeto: el trap
        // `ownKeys` no la declararía (trampa medida en v720).
        const metodos = {
            getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
            setItem: (k, v) => { mapa.set(k, String(v)); if (origen) origen.avisa(k); },
            removeItem: (k) => { const habia = mapa.delete(k); if (habia && origen) origen.avisa(k); },
            key: (i) => Array.from(mapa.keys())[i] || null,
        };
        return new Proxy({}, {
            get: (_t, p) => (p === 'length' ? mapa.size : (p in metodos ? metodos[p] : mapa.get(p))),
            ownKeys: () => Array.from(mapa.keys()),
            getOwnPropertyDescriptor: (_t, p) => (mapa.has(p)
                ? { value: mapa.get(p), enumerable: true, configurable: true, writable: true } : undefined),
        });
    }
    function abre(uidSesion) {
        const oyentes = {};
        const pest = { recargas: 0, oyentes };
        const sesion = new Map();
        if (uidSesion) sesion.set('firebase:authUser:AIzaTEST:[DEFAULT]', JSON.stringify({ uid: uidSesion }));
        pest.avisa = (clave) => pestanas.forEach(o => {
            if (o !== pest && !o.cerrada) (o.oyentes.storage || []).forEach(fn => fn({ key: clave }));
        });
        const win = {
            console: { log() {}, warn() {}, info() {}, error() {} },
            Date: { now: () => reloj.t }, Math, JSON, Object, String, Number, Array, Proxy,
            setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1,
            location: { pathname: '/index.html', reload: () => { pest.recargas++; } },
            addEventListener: (ev, fn) => { (oyentes[ev] = oyentes[ev] || []).push(fn); },
        };
        win.window = win;
        win.localStorage = storage(almacen, pest);
        win.sessionStorage = storage(sesion, null);
        win.document = { visibilityState: 'visible',
                         addEventListener: (ev, fn) => { (oyentes['doc:' + ev] = oyentes['doc:' + ev] || []).push(fn); } };
        vm.createContext(win);
        vm.runInContext(MODULO, win);
        win.cronosFsModo._recarga = () => { pest.recargas++; };
        pest.win = win;
        pest.modo = () => win.cronosFsModo.estado().modo;
        pest.dispara = (ev, dato) => (oyentes[ev] || []).forEach(fn => fn(dato || {}));
        pest.cierra = () => { pest.dispara('pagehide'); pest.cerrada = true; };
        pestanas.push(pest);
        return pest;
    }
    return { abre, reloj, almacen };
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · el módulo, en dos pestañas del mismo navegador ──');
// ═══════════════════════════════════════════════════════════════════════
{
    // 1a · EL CASO NORMAL NO CAMBIA: una cuenta, app + visor.
    {
        const n = navegador();
        const app = n.abre('U_ENTRENADOR'); app.win.cronosFsModo.decide();
        const visor = n.abre('U_ENTRENADOR'); visor.win.cronosFsModo.decide();
        ok('1a · una sola cuenta en el navegador (app + visor) → las dos con caché EN DISCO, como antes',
           app.modo() === 'persistente' && visor.modo() === 'persistente',
           app.modo() + ' / ' + visor.modo());
    }

    // 1b · 🔴🔴 EL DEFECTO DEL REPORTE.
    {
        const n = navegador();
        const visor = n.abre('U_SUPERADMIN'); visor.win.cronosFsModo.decide();
        const futurefem = n.abre('U_ENTRENADOR_FUTUREFEM'); futurefem.win.cronosFsModo.decide();
        ok('1b · 🔴🔴 EL DEFECTO DEL REPORTE: otra cuenta en otra pestaña (PC: visor + FUTureFEM) ' +
           '→ la segunda va con caché en MEMORIA, que tiene conexión y credenciales propias',
           visor.modo() === 'persistente' && futurefem.modo() === 'memoria',
           visor.modo() + ' / ' + futurefem.modo() + ' — con el caché compartido sus escrituras no salían nunca');
        // ⚠️ Se mira LA CLAVE DE ESA PESTAÑA y que nadie haya recargado, no el
        // total del registro. Medido en el red-check: con la decisión rota, el
        // segundo seguro (`storage` → `revisa`) resolvía el choque recargando
        // una de las dos y el total seguía dando 1 — verde sin probar la regla.
        ok('1c · la pestaña en memoria NO se apunta en el registro (no compite por el caché) y nadie recarga',
           !n.almacen.has('cronos-fs::pestana::' + futurefem.win.cronosFsModo.estado().tab) &&
           visor.recargas === 0 && futurefem.recargas === 0);
        futurefem.win.cronosFsModo.usuario('U_ENTRENADOR_FUTUREFEM');
        ok('1d · y no recarga nunca: no hay nada que ceder', futurefem.recargas === 0 && visor.recargas === 0);
    }

    // 1e · iPad: Prebenjamín A y Regional B.
    {
        const n = navegador();
        const pre = n.abre('U_BRUNO'); pre.win.cronosFsModo.decide();
        const reg = n.abre('U_ARINAGA'); reg.win.cronosFsModo.decide();
        ok('1e · 🔴 el iPad del reporte (Prebenjamín A + Regional B, dos cuentas) → uno en disco y otro en memoria',
           pre.modo() === 'persistente' && reg.modo() === 'memoria');
    }

    // 1f · Pantalla de acceso con otra pestaña viva.
    {
        const n = navegador();
        const a = n.abre('U_A'); a.win.cronosFsModo.decide();
        const login = n.abre(''); login.win.cronosFsModo.decide();
        ok('1f · pestaña en la pantalla de ACCESO con otra viva → memoria (aún no se sabe quién entrará)',
           login.modo() === 'memoria');
        login.win.cronosFsModo.usuario('U_A');
        ok('1g · …y entrar con la MISMA cuenta en memoria no recarga (funciona igual)',
           login.recargas === 0 && login.modo() === 'memoria');
    }

    // 1h · Sola en el navegador y todavía sin sesión.
    {
        const n = navegador();
        const sola = n.abre(''); sola.win.cronosFsModo.decide();
        sola.win.cronosFsModo.usuario('U_A');
        const reg = JSON.parse(n.almacen.get('cronos-fs::pestana::' + sola.win.cronosFsModo.estado().tab) || '{}');
        ok('1h · sola y sin sesión → disco; al entrar apunta su cuenta en el registro',
           sola.modo() === 'persistente' && reg.uid === 'U_A' && sola.recargas === 0,
           JSON.stringify(reg));
    }

    // 1i · 🔑 La carrera en la pantalla de acceso: cede la que llega TARDE a su cuenta.
    {
        const n = navegador();
        const t1 = n.abre(''); t1.win.cronosFsModo.decide();              // sola, sin sesión → disco
        n.reloj.t += 1000;
        const t2 = n.abre('U_B'); t2.win.cronosFsModo.decide();           // la otra aún no es de nadie → disco
        n.reloj.t += 5000;
        t1.win.cronosFsModo.usuario('U_A');                               // entra con OTRA cuenta
        ok('1i · 🔑 dos pestañas en disco con cuentas distintas → CEDE la que llegó más tarde a su cuenta',
           t2.modo() === 'persistente' && t1.recargas === 1 && t2.recargas === 0,
           't1 recargas=' + t1.recargas + ' t2 recargas=' + t2.recargas + ' t2=' + t2.modo());
        ok('1j · y al ceder se BORRA del registro (si no, la otra seguiría viéndola y no habría paz)',
           !n.almacen.has('cronos-fs::pestana::' + t1.win.cronosFsModo.estado().tab));
    }

    // 1k · iOS: una pestaña congelada más de 30 min se despierta.
    {
        const n = navegador();
        const vieja = n.abre('U_A'); vieja.win.cronosFsModo.decide();
        n.reloj.t += 31 * 60 * 1000;                                      // sin latir: congelada
        const nueva = n.abre('U_B'); nueva.win.cronosFsModo.decide();
        ok('1k · una pestaña sin latir más de 30 min no bloquea a otra cuenta (se da por muerta)',
           nueva.modo() === 'persistente');
        n.reloj.t += 2000;
        vieja.dispara('doc:visibilitychange');                            // se despierta y late
        ok('1l · 🔑 al despertar, choque → cede UNA sola, la recién llegada (sin ping-pong)',
           vieja.recargas === 0 && nueva.recargas === 1,
           'vieja=' + vieja.recargas + ' nueva=' + nueva.recargas);
    }

    // 1m · Cerrar la pestaña libera el caché al momento.
    {
        const n = navegador();
        const a = n.abre('U_A'); a.win.cronosFsModo.decide();
        a.cierra();
        const b = n.abre('U_B'); b.win.cronosFsModo.decide();
        ok('1m · al cerrar (pagehide) se desapunta: la otra cuenta ya puede usar el disco',
           b.modo() === 'persistente');
    }

    // 1n · El id no puede viajar con el sessionStorage heredado por window.open.
    ok('1n · ⚠️ el id de pestaña vive en MEMORIA, no en sessionStorage (window.open lo copiaría)',
       !/sessionStorage\.setItem\([^)]*tab/i.test(MODULO) && /var tabId\s*=\s*Date\.now\(\)/.test(MODULO));
    ok('1o · ⚠️ el registro NO empieza por `cronos_`: ni lo aísla v720 por usuario ni lo barre la purga',
       /var PREFIJO\s*=\s*'cronos-fs::/.test(MODULO));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · el cableado en los dos documentos ──');
// ═══════════════════════════════════════════════════════════════════════
{
    const ini = sinComentarios(INIT);
    const iDecide = ini.indexOf('window.cronosFsModo.decide()');
    const iAuth   = ini.indexOf('const auth = getAuth(app);');
    const iInit   = ini.indexOf('initializeFirestore(app,');
    ok('2a · firebase-init.js decide el caché ANTES de crear la instancia (y antes de `getAuth`, v469)',
       iDecide > 0 && iDecide < iAuth && iAuth < iInit, [iDecide, iAuth, iInit].join(' < '));
    ok('2b · …y con «memoria» crea la instancia con `memoryLocalCache()`',
       /memoryLocalCache,/.test(ini) &&
       /_modoCache === 'memoria'\s*\?\s*memoryLocalCache\(\)\s*:\s*persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/.test(ini));
    ok('2c · firebase-init.js le dice al módulo quién es la pestaña en CADA cambio de sesión',
       /onAuthStateChanged\(auth, \(u\) => \{[\s\S]{0,200}cronosFsModo\.usuario\(u \? u\.uid : ''\)/.test(ini));
    ok('2d · ⚠️ `initializeFirestore` sigue llamándose UNA sola vez (la segunda lanza: v467)',
       (ini.match(/\binitializeFirestore\s*\(/g) || []).length === 1);

    const lv = sinComentarios(LIVE);
    const lDecide = lv.indexOf('window.cronosFsModo.decide()');
    const lAuth   = lv.indexOf('const auth = getAuth(app);');
    const lInit   = lv.indexOf('initializeFirestore(app,');
    ok('2e · 🔑 live.html decide con la MISMA regla y antes de crear la suya (el visor comparte el caché)',
       lDecide > 0 && lDecide < lAuth && lAuth < lInit &&
       /_modoCache === 'memoria'\s*\?\s*memoryLocalCache\(\)/.test(lv) && /memoryLocalCache, doc/.test(lv));
    ok('2f · live.html informa de la sesión al módulo',
       /onAuthStateChanged\(auth, async \(user\) => \{\s*try \{ if \(window\.cronosFsModo\) window\.cronosFsModo\.usuario\(user \? user\.uid : ''\)/.test(lv));

    const idx = sinComentarios(INDEX);
    const tModulo = idx.indexOf('<script src="js/shared/fs-cache-mode.js');
    const tInit   = idx.indexOf('<script type="module" src="js/services/firebase-init.js');
    ok('2g · index.html carga el módulo como script CLÁSICO antes del de Firebase (que es diferido)',
       tModulo > 0 && tModulo < tInit);
    const lModulo = lv.indexOf('<script src="js/shared/fs-cache-mode.js');
    const lFire   = lv.indexOf('<script type="module">');
    ok('2h · live.html también, antes de su módulo de Firebase', lModulo > 0 && lModulo < lFire);
    ok('2i · el fichero está en el precache del SW (sin él, arrancar sin cobertura volvería al compartido)',
       /'\.\/js\/shared\/fs-cache-mode\.js',/.test(SW) && fs.existsSync(path.join(ROOT, 'js/shared/fs-cache-mode.js')));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · el reloj no adopta un documento de OTRA fase ──');
// ═══════════════════════════════════════════════════════════════════════
const esperas = [];
{
    const fn = trozo(TIMER, 'async function syncTimerWithServer()');
    ok('3a · se encuentra el sincronizador', !!fn);
    const montar = (servidor, local) => {
        const ctx = {
            console: { warn() {}, log() {} }, Date, Math, String, Number,
            isRunning: local.isRunning, masterTimeH1: local.h1 || 0, masterTimeH2: local.h2 || 0,
            matchPhase: local.fase, lastTickTime: 0, timerInterval: null,
            liveMatchId: 'p1', liveIsActive: true, half1MaxTime: 2700, half2MaxTime: 2700,
            updateMasterUI: () => {}, setInterval: () => 1, clearInterval: () => {}, tick: () => {},
            document: { getElementById: () => ({ textContent: '', classList: { add() {}, remove() {} } }) },
        };
        ctx.window = { _cronos_auth: { db: {} }, _CRONOS_DEBUG: false, renderOptimizer: null,
                       _cronosUltimoToggleLocal: 0, _cronosUltimoLatidoOk: 0 };
        ctx.__imp = async () => ({ doc: () => ({}), getDoc: async () => ({ exists: () => true, data: () => servidor }) });
        vm.createContext(ctx);
        vm.runInContext(['let _lastServerSync = 0;', 'const _SERVER_SYNC_INTERVAL_MS = 5000;',
            TIMER.match(/let _maxDriftAllowed = \d+;/)[0], 'let _vigiaReloj = null;',
            'const _GRACIA_PULSACION_MS = 8000;',
            trozo(TIMER, 'function _mandaLaPulsacionLocal()'),
            trozo(TIMER, 'function _cronosArrancaReloj()'),
            trozo(TIMER, 'function _cronosParaReloj()'),
            trozo(TIMER, 'function cronosPintaBotonReloj()'),
            trozo(TIMER, 'function _arrancarVigiaReloj()'),
            trozo(TIMER, 'function _adoptarMarchaDelServidor(servidorCorre)'),
            fn, 'this.__sync = syncTimerWithServer;'].join('\n').replace(/\bimport\s*\(/g, '__imp('), ctx);
        return ctx;
    };
    esperas.push((async () => {
        // Regional B: la 2ª parte recién arrancada, y el documento todavía dice DESCANSO.
        const segunda = montar({ phase: 'break', isRunning: false, timeH1: 1318, timeH2: 0 },
                               { fase: '2nd_half', isRunning: true, h1: 1318, h2: 40 });
        await segunda.__sync();
        ok('3b · 🔴🔴 un documento que aún dice DESCANSO no le quita la marcha a la 2ª parte recién empezada',
           segunda.isRunning === true && segunda.masterTimeH2 === 40,
           'isRunning=' + segunda.isRunning + ' H2=' + segunda.masterTimeH2);

        // En pausa la adopción era sin condiciones: le ponía la 2ª parte a cero.
        const pausa = montar({ phase: 'break', isRunning: false, timeH1: 1318, timeH2: 0 },
                             { fase: '2nd_half', isRunning: false, h1: 1318, h2: 40 });
        await pausa.__sync();
        ok('3c · 🔴 …ni, en pausa, le pone la 2ª parte a CERO', pausa.masterTimeH2 === 40, 'H2=' + pausa.masterTimeH2);

        // La lectura que salió en la 1ª parte y vuelve ya en el descanso.
        const descanso = montar({ phase: '1st_half', isRunning: true, timeH1: 1310, timeH2: 0 },
                                { fase: 'break', isRunning: false, h1: 1318 });
        await descanso.__sync();
        ok('3d · 🔴 una lectura de la 1ª parte no le devuelve la marcha al DESCANSO',
           descanso.isRunning === false, 'isRunning=' + descanso.isRunning);

        // ⚠️ Dentro de la MISMA fase, v638 sigue mandando.
        const misma = montar({ phase: '2nd_half', isRunning: false, timeH1: 1318, timeH2: 40 },
                             { fase: '2nd_half', isRunning: true, h1: 1318, h2: 40 });
        misma.window._cronosUltimoLatidoOk = 1;
        await misma.__sync();
        ok('3e · ⚠️ en la MISMA fase se sigue adoptando la marcha del servidor (v638 intacto)',
           misma.isRunning === false, 'isRunning=' + misma.isRunning);

        // ⚠️ Sin `phase` (documentos anteriores) todo sigue como siempre.
        const legado = montar({ isRunning: false, timeH1: 18, timeH2: 0 }, { fase: '1st_half', isRunning: false, h1: 28 });
        await legado.__sync();
        ok('3f · ⚠️ un documento SIN fase se trata como siempre (no se sabe de qué momento habla)',
           legado.masterTimeH1 === 18, 'H1=' + legado.masterTimeH1);
    })());

    const fin = sinComentarios(trozo(EVENTS, 'window.endFirstHalf = function endFirstHalf(skipConfirm)'));
    ok('3g · 📡 el final de la 1ª parte se emite COMPROBADO (cronosEmiteEstadoAhora), como pausar/reanudar',
       /cronosEmiteEstadoAhora\('active'\)/.test(fin));
    ok('3h · y se sella como decisión sobre la marcha (el latido de pausa lo reintenta hasta que llegue)',
       /window\._cronosUltimoToggleLocal = Date\.now\(\);/.test(fin) &&
       fin.indexOf("matchPhase = 'break'") < fin.indexOf('window._cronosUltimoToggleLocal = Date.now();'));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · el visor: un vigilante caído se reengancha ──');
// ═══════════════════════════════════════════════════════════════════════
{
    const fnVig = trozo(LIVE, 'function _vigilaConRespaldo(matchId, alRecibir, alMorir)');
    ok('4a · se encuentra el vigilante con su tercer argumento', !!fnVig);
    if (fnVig) {
        // Se ejecuta con un onSnapshot falso que deja disparar el error a mano.
        const oyentes = [];
        const ctx = { console: { warn() {}, log() {} }, _COL_INDICE: 'live_index',
                      doc: (_db, col, id) => ({ col, id }), db: {},
                      onSnapshot: (ref, bien, mal) => { const o = { ref, bien, mal, baja: 0 }; oyentes.push(o); return () => { o.baja++; }; } };
        vm.createContext(ctx);
        vm.runInContext(fnVig + '\nthis.__vig = _vigilaConRespaldo;', ctx);
        let muertes = 0;
        ctx.__vig('M1', () => {}, () => { muertes++; });
        oyentes[0].mal({ code: 'permission-denied' });                  // el índice falla → al gordo
        ok('4b · un fallo del ÍNDICE sigue degradando al documento del partido (no es una muerte)',
           oyentes.length === 2 && oyentes[1].ref.col === 'live_matches' && muertes === 0);
        oyentes[1].mal({ code: 'permission-denied' });                  // y ahora cae el gordo
        ok('4c · 🔴 si cae el documento del partido, AVISA (antes el error iba a la nada y quedaba muerto)',
           muertes === 1 && oyentes[1].baja === 1, 'muertes=' + muertes + ' baja=' + oyentes[1].baja);
    }
    const refresco = sinComentarios(trozo(LIVE, 'async function refreshBackgroundWatchers()'));
    ok('4d · 🔑 y el refresco lo DESAPUNTA, así que la pasada de 30 s lo vuelve a crear',
       /_vigilaConRespaldo\(m\.id, \(s2\) => \{[\s\S]*\}, \(\) => \{\s*delete _bgWatchers\[m\.id\];\s*\}\);/.test(refresco));
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · el latido tiene UNA sola puerta ──');
// ═══════════════════════════════════════════════════════════════════════
//  Hallazgo de v721, corregido a petición del autor: «Recuperar Partido» desde
//  la nube latía cada 1 SEGUNDO (y en pausa no creaba latido), y retomar desde
//  el dispositivo latía cada 5 s también en pausa. Sólo `startLiveSync`
//  respetaba los 15 s de v572 y la regla de pausa de v718.
{
    const SYNC  = leer('js/match/live/sync.js');
    const SETUP = leer('js/core/setup-modal.js');
    const APPI  = leer('js/core/app-init.js');

    // 5a · nadie más crea el intervalo del latido.
    const productos = [];
    (function recorre(dir) {
        fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(e => {
            const rel = dir + '/' + e.name;
            if (e.isDirectory()) { if (e.name !== 'vendor') recorre(rel); }
            else if (/\.js$/.test(e.name)) productos.push(rel);
        });
    })('js');
    const creadores = productos.concat(['index.html', 'live.html']).filter(f =>
        /liveSyncTimer\s*=\s*setInterval\(/.test(sinComentarios(leer(f))));
    ok('5a · 🔑🔑 `liveSyncTimer = setInterval(` existe en UN solo fichero: sync.js',
       creadores.length === 1 && creadores[0] === 'js/match/live/sync.js', JSON.stringify(creadores));

    const puerta = trozo(SYNC, 'function cronosArrancaLatido()');
    ok('5b · la puerta única existe y se publica', !!puerta &&
       /window\.cronosArrancaLatido = cronosArrancaLatido/.test(SYNC));
    ok('5c · startLiveSync late por ella', /cronosArrancaLatido\(\);/.test(sinComentarios(trozo(SYNC, 'async function startLiveSync()'))));

    // 5d · SE EJECUTA: ritmo, marcha, pausa y apagado del anterior.
    if (puerta) {
        const montar = (est) => {
            const c = { LIVE_HEARTBEAT_MS: 15000, liveIsActive: true, isRunning: !!est.corre,
                        liveSyncTimer: est.previo || null, _envios: 0, _ms: 0, _limpiado: null,
                        setInterval: (f, ms) => { c._cb = f; c._ms = ms; return 'nuevo'; },
                        clearInterval: (id) => { c._limpiado = id; } };
            c.pushLiveSnapshot = () => { c._envios++; };
            c.window = { _cronosUltimoToggleLocal: est.pulsado || 0, _cronosUltimoLatidoOk: est.emitido || 0 };
            vm.createContext(c);
            vm.runInContext(puerta + '\nthis.__arranca = cronosArrancaLatido;', c);
            c.__arranca();
            return c;
        };
        const real = Number((SYNC.match(/const\s+LIVE_HEARTBEAT_MS\s*=\s*(\d+)\s*;/) || [])[1]);
        const enMarcha = montar({ corre: true, previo: 'viejo' });
        enMarcha._cb();
        ok('5d · 🔴 late al ritmo de LIVE_HEARTBEAT_MS (no a 1 s ni a 5 s) y apaga el anterior',
           real === 15000 && enMarcha._ms === 15000 && enMarcha._limpiado === 'viejo' && enMarcha._envios === 1,
           'ms=' + enMarcha._ms + ' limpiado=' + enMarcha._limpiado);
        const pausa = montar({ corre: false, pulsado: 1000, emitido: 2000 });
        pausa._cb(); pausa._cb();
        const pendiente = montar({ corre: false, pulsado: 2000, emitido: 1000 });
        pendiente._cb();
        ok('5e · 🔴 en pausa con el cambio emitido NO escribe; con el cambio pendiente, reintenta (v718)',
           pausa._envios === 0 && pendiente._envios === 1, pausa._envios + ' / ' + pendiente._envios);
    }

    // 5f · Recuperar Partido desde la NUBE: por la puerta, en las dos ramas.
    const sm = sinComentarios(SETUP);
    const iRama = sm.indexOf('const shouldRun = shouldRunAutonomous || m.isRunning;');
    const iLat  = sm.indexOf('window.cronosArrancaLatido()');
    const iBtn  = sm.indexOf("if (typeof updateLiveButton === 'function') updateLiveButton(true);", iRama);
    ok('5f · 🔴🔴 «Recuperar Partido» (nube) late por la puerta DESPUÉS de decidir la marcha, ' +
       'o sea también recuperado EN PAUSA',
       iRama > 0 && iLat > iRama && iLat < iBtn && !/\},\s*1000\);/.test(sm.slice(iRama, iBtn)),
       [iRama, iLat, iBtn].join(' < '));
    ok('5g · …y sólo si este aparato escribe (otro controlándolo, o partido terminado → no)',
       /if \(!anotherDeviceActive && liveIsActive &&\s*typeof matchPhase !== 'undefined' && matchPhase !== 'finished'\) \{\s*if \(typeof window\.cronosArrancaLatido === 'function'\) window\.cronosArrancaLatido\(\);/.test(sm));

    // 5h · Retomar desde el DISPOSITIVO.
    const ai = sinComentarios(APPI);
    const bloque = ai.slice(ai.indexOf("if (state.liveMatchId && matchPhase !== 'finished') {"),
                            ai.indexOf("if (typeof showToast === 'function') {", ai.indexOf("if (state.liveMatchId && matchPhase !== 'finished') {")));
    ok('5h · 🔴 retomar desde el dispositivo late por la puerta y sin copia del ritmo',
       /window\.cronosArrancaLatido\(\)/.test(bloque) && !/setInterval\(/.test(bloque), bloque.slice(0, 120));
}

Promise.all(esperas).then(() => {
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
});

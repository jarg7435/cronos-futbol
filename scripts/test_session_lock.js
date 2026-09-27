// ═══════════════════════════════════════════════════════════════════════════
// GUARD · Una plaza, un dispositivo — v699
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor: si una cuenta entra con un rol, otro aparato no debe
// poder abrir ESE MISMO rol a la vez; con roles distintos sí puede repartirse.
// Decisiones suyas: la unidad es la PLAZA (mismo rol Y mismo equipo), y en el
// conflicto el segundo aparato ve quién está dentro y elige entre cancelar o
// TOMAR EL CONTROL.
//
// ⚠️ ESTE GUARD EJECUTA EL MÓDULO con un Firestore de mentira y dos aparatos
// simulados. Comprobar por texto que existe un `if` no dice nada: lo que
// importa es si el segundo entra o no, y si al primero se le avisa.
//
// 🚨 LO MÁS IMPORTANTE QUE VIGILA: que NO se bloquee de más. Un falso positivo
// aquí deja a un entrenador fuera de su propio partido, que es mucho peor que
// el problema que se quiere evitar. De ahí los casos de fail-open (sin red),
// de caducidad y de roles/equipos distintos.
//
// ═══════════════════════════════════════════════════════════════════════════
//  🚪 2026-09-17 · v730 · LA PUERTA SE MUDA, LA MECÁNICA SE QUEDA
// ═══════════════════════════════════════════════════════════════════════════
//  El autor revoca una parte de v699 (implementar.txt 2026-09-17, capturas
//  10513-10514): el candado ya NO se pide al entrar en la aplicación, sino al
//  entrar en el PARTIDO, y sólo para los roles que lo dirigen. Por eso todo lo
//  de abajo ejercita ahora `cronosSesionAlAbrirPartido()` en vez de
//  `cronosSesionAlEntrar()`.
//
//  ⚠️ NO ES UN GUARD DEBILITADO: las 27 comprobaciones de mecánica —conflicto,
//  toma de control, desalojo, caducidad, fail-open, latido, extra apagado— son
//  las mismas y siguen exigiéndose. Lo único que cambia es POR QUÉ PUERTA se
//  entra. Y la PARTE 12, nueva, fija lo que el autor pidió a cambio: que
//  consultar no bloquee y que cambiar de equipo suelte la plaza anterior.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); fallos++; }
}

// ── 0. Sintaxis ─────────────────────────────────────────────────────────────
let compila = true;
['js/services/auth/session-lock.js', 'js/services/auth/role-launch.js',
 'js/core/nav-stack.js', 'js/core/security-and-state.js'].forEach(f => {
    try { execFileSync(process.execPath, ['--check', path.join(RAIZ, f)], { stdio: 'pipe' }); }
    catch (e) { compila = false; }
});
ok('los ficheros tocados compilan (node --check)', compila);

const fuente = leer('js/services/auth/session-lock.js');

// ═══════════════════════════════════════════════════════════════════════════
//  UN MUNDO CON DOS APARATOS Y UN FIRESTORE COMPARTIDO
// ═══════════════════════════════════════════════════════════════════════════
//  v773 · `reglasReales`: como las reglas DE VERDAD de la colección
//  (`resource.data.get('uid','') == uid`), leer una marca que NO EXISTE da
//  permission-denied. El doble de antes contestaba «no existe» tan tranquilo,
//  y por eso ningún caso veía el fallo de v771/v772.
//  `cacheVieja[id]`: lo que la CACHÉ LOCAL de ese aparato guarda de la marca;
//  el SDK real lo entrega como PRIMERA foto del `onSnapshot` (fromCache).
function crearNube(op) {
    const o = op || {};
    const docs = {};            // la "base de datos" compartida
    const escuchas = [];        // onSnapshot registrados
    const cacheVieja = {};
    const avisa = (id) => escuchas.filter(e => e.id === id)
                                  .forEach(e => e.fn({ exists: () => !!docs[id], data: () => docs[id],
                                                       metadata: { fromCache: false } }));
    const denegado = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; };
    return {
        docs, escuchas, avisa, cacheVieja,
        api: {
            m: {
                doc: (db, col, id) => ({ _id: id }),
                getDoc: async (ref) => {
                    if (o.reglasReales && !docs[ref._id]) throw denegado();
                    return { exists: () => !!docs[ref._id], data: () => docs[ref._id] };
                },
                setDoc: async (ref, data, op) => {
                    docs[ref._id] = (op && op.merge) ? Object.assign({}, docs[ref._id] || {}, data) : data;
                    avisa(ref._id);
                },
                deleteDoc: async (ref) => { delete docs[ref._id]; avisa(ref._id); },
                onSnapshot: (ref, fn) => {
                    const e = { id: ref._id, fn };
                    escuchas.push(e);
                    // Primera foto desde la caché local, como el SDK real.
                    if (cacheVieja[ref._id]) {
                        const vieja = cacheVieja[ref._id];
                        fn({ exists: () => true, data: () => vieja, metadata: { fromCache: true } });
                    }
                    return () => { const i = escuchas.indexOf(e); if (i >= 0) escuchas.splice(i, 1); };
                }
            },
            db: {}
        }
    };
}

// Un "aparato": su propio localStorage y su propio window, la nube compartida.
function aparato(nube, op) {
    const o = Object.assign({ uid: 'u1', rol: 'user', club: 'clubA', equipo: 'eq_alevin_c',
                              nombre: 'iPad', sinNube: false }, op || {});
    //  `aparatoDe` = otro "aparato" cuyo localStorage se comparte → otra
    //  PESTAÑA del mismo navegador. `sesionDe` = la MISMA pestaña (p. ej. tras
    //  recargar). Sin pasar nada, es un aparato nuevo y aislado, como antes.
    const almacen = o.aparatoDe ? o.aparatoDe._almacen : {};
    const sesion  = o.sesionDe  ? o.sesionDe._sesion  : {};
    const avisos = { conflicto: null, desalojo: null, respuestaConflicto: false };
    const temporizadores = [];
    const oyentesVentana = {}, oyentesDoc = {};

    const ctx = {
        console: { log(){}, warn(){}, error(){} },
        Date, Math, JSON, String, Number, Promise, Object, Array,
        // v731 · El ENTORNO forma parte de la clave: testeo y producción
        // comparten base de datos y no pueden pisarse las marcas.
        location: { hostname: o.host || 'cronos-futbol-app.web.app' },
        setInterval: (fn) => { temporizadores.push(fn); return temporizadores.length; },
        clearInterval: () => {},
        navigator: { userAgent: o.nombre === 'iPad' ? 'iPad; CPU OS 17 Safari' : 'Windows NT 10.0 Chrome',
                     maxTouchPoints: o.nombre === 'iPad' ? 5 : 0 },
        localStorage: {
            getItem: k => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); },
            removeItem: k => { delete almacen[k]; }
        },
        // 🪟 v733 · El navegador de verdad tiene DOS almacenes: `localStorage`
        // es del APARATO (lo comparten todas las pestañas) y `sessionStorage`
        // es de la PESTAÑA, y sobrevive a la recarga. Sin los dos, este arnés
        // no puede representar el caso que reportó el autor —dos ventanas del
        // mismo PC— ni el que NO debe romperse: recargar con F5.
        sessionStorage: {
            getItem: k => (k in sesion ? sesion[k] : null),
            setItem: (k, v) => { sesion[k] = String(v); },
            removeItem: k => { delete sesion[k]; }
        },
        document: {
            createElement: () => ({ style: {}, _html: '', set innerHTML(v) { this._html = v; },
                                    get innerHTML() { return this._html; },
                                    querySelector: () => ({ addEventListener: () => {} }),
                                    remove: () => {}, addEventListener: () => {} }),
            body: { appendChild: () => {} },
            // v771 · La pestaña se oculta y vuelve: el guard dispara el evento
            // real que el módulo escucha, no llama a la función por su nombre.
            visibilityState: 'visible',
            addEventListener: (t, fn) => { oyentesDoc[t] = fn; }
        },
        // v771 · `fetch` sólo existe si el caso lo pide: así los casos de
        // siempre prueban el camino del SDK y el de la API REST va aparte.
        fetch: o.fetch,
        _temporizadores: temporizadores,
        _avisos: avisos
    };
    ctx.window = {
        _cronosCurrentUser: { uid: o.uid, _activeRole: o.rol, clubId: o.club },
        // v700 · La lectura única de extras del proyecto, con su regla real
        // `!== false`: sin mapa, todo activo.
        _cronosExtraEnabled: (k) => (o.extras ? o.extras[k] !== false : true),
        cronosMyTeamId: () => o.equipo,
        cronosMyTeam: () => ({ teamId: o.equipo, categoryLabel: 'Alevín', subcategory: 'C' }),
        addEventListener: (t, fn) => { oyentesVentana[t] = fn; },
        escapeHtml: s => String(s),
        // Firestore doble (o ninguno, para el caso "sin cobertura").
        cronosSesionFS: o.sinNube ? undefined : (async () => nube.api)
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(fuente, ctx, { filename: 'session-lock.js' });

    // El módulo pregunta por el conflicto y avisa del desalojo: se sustituyen
    // por dobles para poder decidir desde el guard y observar qué pasó.
    ctx.window.cronosSesionPreguntaConflicto = async (info) => {
        avisos.conflicto = info;
        return avisos.respuestaConflicto;
    };
    ctx.window.cronosSesionDesalojado = (info) => { avisos.desalojo = info; };

    // `_almacen` y `_sesion` se devuelven para poder montar otra pestaña del
    // mismo navegador (v733), no para leerlos desde las aserciones.
    return { ctx, w: ctx.window, avisos, temporizadores, oyentesVentana, oyentesDoc,
             _almacen: almacen, _sesion: sesion };
}

// v771 · Las escrituras «sin esperar» van por promesas encadenadas: se dejan
// correr unas vueltas del bucle antes de mirar la nube.
const vueltas = async (n) => { for (let i = 0; i < (n || 5); i++) await new Promise(r => setImmediate(r)); };

(async function () {
    // ═══ 1. CONTROL: un solo aparato entra sin problema ════════════════════
    {
        const nube = crearNube();
        const a = aparato(nube);
        const entro = await a.w.cronosSesionAlAbrirPartido();
        ok('CONTROL · el primer aparato entra y deja su marca',
           entro === true && Object.keys(nube.docs).length === 1);

        const clave = Object.keys(nube.docs)[0];
        ok('la marca guarda uid, aparato y hora', !!nube.docs[clave].uid &&
           !!nube.docs[clave].deviceId && !!nube.docs[clave].lastSeen);
    }

    // ═══ 2. EL ENCARGO: misma plaza en dos aparatos ════════════════════════
    {
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();

        const movil = aparato(nube, { nombre: 'Windows' });
        movil.avisos.respuestaConflicto = false;            // el usuario CANCELA
        const entro = await movil.w.cronosSesionAlAbrirPartido();

        ok('🔑 el segundo aparato con la MISMA plaza NO entra si cancela', entro === false);
        ok('…y se le dice QUÉ aparato la tiene y desde cuándo',
           !!movil.avisos.conflicto && /iPad/.test(movil.avisos.conflicto.deviceName || '') &&
           !!movil.avisos.conflicto.startedAt);
        ok('…sin pisar la marca del primero',
           nube.docs[Object.keys(nube.docs)[0]].deviceName === 'iPad · Safari');
    }

    // ═══ 3. TOMAR EL CONTROL ═══════════════════════════════════════════════
    {
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();

        const movil = aparato(nube, { nombre: 'Windows' });
        movil.avisos.respuestaConflicto = true;             // el usuario TOMA EL CONTROL
        const entro = await movil.w.cronosSesionAlAbrirPartido();

        ok('tomando el control, el segundo entra', entro === true);
        ok('…y la plaza pasa a ser suya',
           /Windows/.test(nube.docs[Object.keys(nube.docs)[0]].deviceName || ''));
        // 🔑 La otra mitad del encargo: el PRIMERO tiene que enterarse, o
        // seguiría escribiendo el partido creyendo que manda.
        ok('🔑 al primer aparato se le avisa de que ha perdido la plaza',
           !!ipad.avisos.desalojo && /Windows/.test(ipad.avisos.desalojo.deviceName || ''));
    }

    // ═══ 4. LO QUE NO SE DEBE BLOQUEAR ═════════════════════════════════════
    {
        const nube = crearNube();
        const pc = aparato(nube, { rol: 'director', equipo: '' });
        const entroDir = await pc.w.cronosSesionAlAbrirPartido();
        const movil = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        const entro = await movil.w.cronosSesionAlAbrirPartido();
        ok('🔑 ROLES DISTINTOS a la vez: Director en el PC y Entrenador en el móvil',
           entro === true && entroDir === true && movil.avisos.conflicto === null);
        // v730 · Y el director NI SIQUIERA DEJA MARCA: no dirige ningún
        // partido, así que no ocupa plaza de nadie ni puede ser desalojado.
        ok('🔑 v730 · el DIRECTOR no reserva plaza (sólo la ocupa quien dirige)',
           Object.keys(nube.docs).length === 1);
    }
    {
        // Decisión del autor: la unidad es la PLAZA. Un entrenador con dos
        // equipos puede llevar uno en cada aparato: son partidos distintos.
        const nube = crearNube();
        const ipad = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const movil = aparato(nube, { rol: 'user', equipo: 'eq_regional_a' });
        const entro = await movil.w.cronosSesionAlAbrirPartido();
        ok('🔑 MISMO rol y EQUIPOS distintos: los dos entran (la unidad es la plaza)',
           entro === true && movil.avisos.conflicto === null &&
           Object.keys(nube.docs).length === 2);
    }
    {
        // Usuarios distintos nunca se estorban.
        const nube = crearNube();
        const a = aparato(nube, { uid: 'u1' });
        await a.w.cronosSesionAlAbrirPartido();
        const b = aparato(nube, { uid: 'u2' });
        const entro = await b.w.cronosSesionAlAbrirPartido();
        ok('dos USUARIOS distintos con el mismo rol no se estorban', entro === true);
    }

    // ═══ 5. NO DEJAR A NADIE TIRADO ════════════════════════════════════════
    {
        // 🚨 Sin cobertura —lo normal en un campo de fútbol— se ENTRA. Dejar
        // fuera a un entrenador por no tener red sería peor que el problema.
        const nube = crearNube();
        const solo = aparato(nube, { sinNube: true });
        const entro = await solo.w.cronosSesionAlAbrirPartido();
        ok('🚨 sin conexión se ENTRA igual (fail-open deliberado)',
           entro === true && solo.avisos.conflicto === null);
    }
    {
        // La marca caduca sola: un móvil sin batería no bloquea la plaza para
        // siempre.
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        nube.docs[clave].lastSeen = Date.now() - (10 * 60 * 1000);   // 10 minutos sin señal
        const movil = aparato(nube, { nombre: 'Windows' });
        const entro = await movil.w.cronosSesionAlAbrirPartido();
        ok('🚨 una marca CADUCADA no bloquea: el segundo entra sin preguntar nada',
           entro === true && movil.avisos.conflicto === null);
    }
    {
        // El mismo aparato volviendo a entrar no se bloquea a sí mismo.
        const nube = crearNube();
        const a = aparato(nube);
        await a.w.cronosSesionAlAbrirPartido();
        const entro = await a.w.cronosSesionAlAbrirPartido();
        ok('el MISMO aparato reentrando no se bloquea a sí mismo',
           entro === true && a.avisos.conflicto === null);
    }

    // ═══ 6. SOLTAR LA PLAZA ════════════════════════════════════════════════
    {
        const nube = crearNube();
        const a = aparato(nube, { nombre: 'iPad' });
        await a.w.cronosSesionAlAbrirPartido();
        await a.w.cronosSesionLibera();
        // v773 · Se MARCA liberada, ya no se borra: un documento borrado no
        // lo puede leer nadie con estas reglas y el siguiente aparato entraba
        // sin marca y se desalojaba a sí mismo (ver la PARTE 17).
        const _m6 = nube.docs[Object.keys(nube.docs)[0]] || {};
        ok('al salir, la marca queda LIBERADA (no se borra) y la plaza libre',
           Object.keys(nube.docs).length === 1 && _m6.liberada === true && _m6.lastSeen === 0);

        const b = aparato(nube, { nombre: 'Windows' });
        const entro = await b.w.cronosSesionAlAbrirPartido();
        ok('…y otro aparato entra sin preguntar', entro === true && b.avisos.conflicto === null);
    }
    {
        // 🔑 Si otro tomó el control, MI salida no puede borrar SU marca: le
        // dejaría la plaza libre a un tercero sin que él se entere.
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const movil = aparato(nube, { nombre: 'Windows' });
        movil.avisos.respuestaConflicto = true;
        await movil.w.cronosSesionAlAbrirPartido();
        await ipad.w.cronosSesionLibera();
        ok('🔑 quien perdió la plaza NO borra la marca del que la tiene',
           Object.keys(nube.docs).length === 1 &&
           /Windows/.test(nube.docs[Object.keys(nube.docs)[0]].deviceName || ''));
    }
    {
        // Cambiar de plaza en el mismo aparato suelta la anterior.
        const nube = crearNube();
        const a = aparato(nube, { equipo: 'eq_alevin_c' });
        await a.w.cronosSesionAlAbrirPartido();
        a.w._cronosCurrentUser = { uid: 'u1', _activeRole: 'user', clubId: 'clubA' };
        a.w.cronosMyTeamId = () => 'eq_regional_a';
        await a.w.cronosSesionAlAbrirPartido();
        // v773 · La anterior queda LIBERADA (ya no se borra) y la nueva, viva.
        const _ids = Object.keys(nube.docs);
        const _vieja = _ids.find(k => /eq_alevin_c/.test(k));
        const _nueva = _ids.find(k => /eq_regional_a/.test(k));
        ok('cambiar de equipo en el mismo aparato suelta la plaza anterior',
           !!_vieja && nube.docs[_vieja].liberada === true &&
           !!_nueva && nube.docs[_nueva].liberada !== true);
    }

    // ═══ 7. EL LATIDO MANTIENE VIVA LA PLAZA ═══════════════════════════════
    {
        const nube = crearNube();
        const a = aparato(nube);
        await a.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        nube.docs[clave].lastSeen = Date.now() - 60000;
        const antes = nube.docs[clave].lastSeen;
        for (const t of a.temporizadores) await t();      // un latido
        ok('el latido refresca la marca mientras se usa la plaza',
           nube.docs[clave].lastSeen > antes);
        // ⚠️ y lleva el uid, que es lo que la regla exige si tuviera que crearla
        ok('…y el latido lleva el uid (la regla de alta lo exige)',
           nube.docs[clave].uid === 'u1');
    }

    // ═══ 7 bis. v700 · EL INTERRUPTOR DE EMERGENCIA POR CLUB ═══════════════
    {
        // Apagado el extra, el módulo queda INERTE: el segundo aparato entra
        // con la misma plaza, como antes de v699.
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad', extras: { sesion_unica: false } });
        const entro1 = await ipad.w.cronosSesionAlAbrirPartido();
        const movil = aparato(nube, { nombre: 'Windows', extras: { sesion_unica: false } });
        const entro2 = await movil.w.cronosSesionAlAbrirPartido();
        ok('🔧 con el extra APAGADO, dos aparatos comparten la misma plaza',
           entro1 === true && entro2 === true && movil.avisos.conflicto === null);
        // 🔑 Y no sólo "no pregunta": no deja marca ninguna. Si la dejara, al
        // volver a encender el extra el club se encontraría plazas ocupadas
        // por aparatos que ya no están.
        ok('…y no deja ninguna marca (queda inerte, no sólo silencioso)',
           Object.keys(nube.docs).length === 0);
    }
    {
        // ⚠️ La cara POSITIVA de la regla `!== false`, que es la que se olvida:
        // un club sin el campo tiene el control ACTIVO, que es como está
        // desplegado hoy. Con `=== true` se habría apagado para todos.
        const nube = crearNube();
        const a = aparato(nube, { extras: { otra_cosa: true } });
        await a.w.cronosSesionAlAbrirPartido();
        const b = aparato(nube, { nombre: 'Windows', extras: { otra_cosa: true } });
        const entro = await b.w.cronosSesionAlAbrirPartido();
        ok('🔑 extra AUSENTE = control ACTIVO (regla `!== false`)',
           entro === false && !!b.avisos.conflicto);
    }
    ok('el extra está declarado en el panel del SuperAdmin',
       /key:\s*'sesion_unica'/.test(leer('js/admin/superadmin/extras-toggle.js')));

    // ═══════════════════════════════════════════════════════════════════════
    //  12. v730 · LOS FALSOS POSITIVOS QUE ÉL REPORTÓ (capturas 10513-10514)
    // ═══════════════════════════════════════════════════════════════════════
    {
        // El entrenador dirige el Alevín C en el iPad. El director abre su
        // panel en el PC: no puede quedarse fuera por eso.
        const nube = crearNube();
        const ipad = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const pc = aparato(nube, { uid: 'uid_dir', rol: 'director', equipo: '' });
        const entro = await pc.w.cronosSesionAlAbrirPartido();
        ok('12a · 🔑 el DIRECTOR consulta mientras el entrenador dirige',
           entro === true && pc.avisos.conflicto === null);
    }
    {
        // Familiar: igual. Ni marca, ni bloqueo, ni desalojo posible.
        const nube = crearNube();
        const ipad = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const movil = aparato(nube, { uid: 'uid_fam', rol: 'parent', equipo: '' });
        const entro = await movil.w.cronosSesionAlAbrirPartido();
        ok('12b · 🔑 el FAMILIAR tampoco se bloquea', entro === true);
        ok('12c · …y no deja marca en la nube', Object.keys(nube.docs).length === 1);
    }
    {
        // ENTRAR EN LA APLICACIÓN no reclama nada: aunque su equipo esté
        // tomado en otro aparato, aquí se puede gestionar plantilla,
        // asistencia y convocatoria. Lo que se cierra es la puerta del partido.
        const nube = crearNube();
        const ipad = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const pc = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        const entroApp = await pc.w.cronosSesionAlEntrar();
        ok('12d · 🔑 entrar en la APLICACIÓN nunca se bloquea',
           entroApp === true && pc.avisos.conflicto === null);
        pc.avisos.respuestaConflicto = false;
        const entroPartido = await pc.w.cronosSesionAlAbrirPartido();
        ok('12e · …pero el PARTIDO del mismo equipo sí avisa',
           entroPartido === false && !!pc.avisos.conflicto);
    }
    {
        // 🔑🔑 EL FALSO POSITIVO DE LA CAPTURA 10513, reproducido:
        // el PC dirige el Alevín C, cambia al Regional B y el iPad abre el
        // Alevín que el PC acaba de dejar. El PC NO puede ser desalojado: ya
        // no está ahí.
        const nube = crearNube();
        const pc = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await pc.w.cronosSesionAlAbrirPartido();

        pc.w.cronosMyTeamId = () => 'eq_regional_b';        // pulsa MIS EQUIPOS
        await pc.w.cronosSesionSincroniza();                // v730: suelta la anterior
        await pc.w.cronosSesionAlAbrirPartido();            // y entra al partido del nuevo

        const ipad = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        const entroIpad = await ipad.w.cronosSesionAlAbrirPartido();
        nube.avisa(Object.keys(nube.docs).filter(k => /alevin/.test(k))[0]);

        ok('12f · 🔑🔑 el iPad entra en el equipo que el PC dejó (estaba libre)',
           entroIpad === true && ipad.avisos.conflicto === null);
        ok('12g · 🔑🔑 y al PC NO se le cierra la sesión: está en OTRO equipo',
           pc.avisos.desalojo === null);
        ok('12h · los dos equipos quedan ocupados, uno por cada aparato',
           Object.keys(nube.docs).length === 2);
    }
    {
        // 🔴 DOS APERTURAS SEGUIDAS, sin esperar a la primera: es lo que pasa
        //  al cambiar de equipo con el rol recién arrancado.
        //
        //  ⚠️ HONESTIDAD SOBRE LO QUE ESTO MIDE Y LO QUE NO: se probó a mutar
        //  el cierre de la escucha adelantada (`if (mia !== _generacion) baja()`
        //  en session-lock.js) y estas dos aserciones SIGUIERON EN VERDE —el
        //  arnés no llega a solapar los `await` internos—. O sea que NO cazan
        //  el oyente huérfano; se quedan porque fijan el resultado que importa
        //  (una escucha viva y ningún desalojo) y porque un verde que se
        //  presenta como lo que no es acaba costando una ronda entera.
        //  Lo que de verdad impide el desalojo espurio es la comprobación de
        //  generación DENTRO del callback; el cierre de la baja adelantada es
        //  higiene: evita una suscripción colgada gastando lecturas.
        const nube = crearNube();
        const pc = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        const p1 = pc.w.cronosSesionAlAbrirPartido();
        pc.w.cronosMyTeamId = () => 'eq_regional_b';
        const p2 = pc.w.cronosSesionAlAbrirPartido();
        await p1; await p2;

        ok('12k · tras dos aperturas seguidas queda UNA sola escucha viva',
           nube.escuchas.length === 1);
        // Otro aparato toma la plaza vieja: el PC no puede enterarse siquiera.
        const claveVieja = Object.keys(nube.docs).filter(k => /alevin/.test(k))[0];
        if (claveVieja) {
            nube.docs[claveVieja] = { uid: 'uid_1', deviceId: 'otro_aparato',
                                      deviceName: 'iPad', lastSeen: Date.now() };
            nube.avisa(claveVieja);
        }
        ok('12l · 🔑 y nadie le cierra la sesión por una plaza que ya soltó',
           pc.avisos.desalojo === null);
    }
    {
        // ⏳ Marca con el reloj MUY adelantado: no puede bloquear para siempre.
        const nube = crearNube();
        const a = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await a.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        nube.docs[clave].lastSeen = Date.now() + 3600000;   // +1 hora
        const b = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        const entro = await b.w.cronosSesionAlAbrirPartido();
        ok('12i · ⏳ una marca "del futuro" (reloj desajustado) no bloquea',
           entro === true && b.avisos.conflicto === null);
    }
    {
        // …pero una deriva pequeña SÍ se respeta: es un reloj normal.
        const nube = crearNube();
        const a = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await a.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        nube.docs[clave].lastSeen = Date.now() + 5000;      // +5 s
        const b = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        b.avisos.respuestaConflicto = false;
        const entro = await b.w.cronosSesionAlAbrirPartido();
        ok('12j · ⚠️ una deriva de segundos sigue contando como viva',
           entro === false && !!b.avisos.conflicto);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  13. v731 · LA CLAVE ES EL RECURSO (captura 10518)
    // ═══════════════════════════════════════════════════════════════════════
    {
        // 🔑 EL CASO DEL ENCARGO: los dos equipos del mismo entrenador, en el
        //  MISMO PC y el mismo navegador. Nunca pueden estorbarse.
        const nube = crearNube();
        const alevin = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await alevin.w.cronosSesionAlAbrirPartido();
        const regional = aparato(nube, { rol: 'user', equipo: 'eq_regional_b', nombre: 'Windows' });
        const entro = await regional.w.cronosSesionAlAbrirPartido();
        ok('13a · 🔑🔑 Alevín C y Regional B a la vez: ninguno bloquea al otro',
           entro === true && regional.avisos.conflicto === null &&
           Object.keys(nube.docs).length === 2);
    }
    {
        // 🚨 TESTEO Y PRODUCCIÓN COMPARTEN BASE DE DATOS. Antes de v731, la
        //  pestaña de producción bloqueaba a la de testeo presentándose como
        //  «otro dispositivo», y una prueba podía desalojar a un club real.
        const nube = crearNube();
        const prod = aparato(nube, { equipo: 'eq_regional_b', host: 'cronos-futbol-app.web.app' });
        await prod.w.cronosSesionAlAbrirPartido();
        const test = aparato(nube, { equipo: 'eq_regional_b', host: 'cronos-futbol-test.web.app' });
        const entro = await test.w.cronosSesionAlAbrirPartido();
        ok('13b · 🚨 TESTEO no bloquea a PRODUCCIÓN aunque compartan la BD',
           entro === true && test.avisos.conflicto === null &&
           Object.keys(nube.docs).length === 2,
           JSON.stringify(Object.keys(nube.docs)));
        ok('13c · …y se distingue en la propia clave',
           Object.keys(nube.docs).some(k => k.indexOf('test__') === 0) &&
           Object.keys(nube.docs).some(k => k.indexOf('prod__') === 0),
           JSON.stringify(Object.keys(nube.docs)));
    }
    {
        // El ROL ya no parte la clave: el mismo equipo es el mismo partido,
        // se entre como 'user' o como 'individual'.
        const nube = crearNube();
        const a = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await a.w.cronosSesionAlAbrirPartido();
        const b = aparato(nube, { rol: 'individual', equipo: 'eq_alevin_c', nombre: 'Windows' });
        b.avisos.respuestaConflicto = false;
        const entro = await b.w.cronosSesionAlAbrirPartido();
        ok('13d · 🔑 el MISMO equipo es el mismo partido aunque cambie el rol',
           entro === false && !!b.avisos.conflicto);
    }
    {
        // Sin equipo no hay recurso que reservar: vía libre y sin marca.
        const nube = crearNube();
        const a = aparato(nube, { rol: 'user', equipo: '' });
        const entro = await a.w.cronosSesionAlAbrirPartido();
        ok('13e · sin equipo no se reserva nada (ni marca ni bloqueo)',
           entro === true && Object.keys(nube.docs).length === 0);
    }
    {
        // La marca guarda el recurso, para poder diagnosticar un bloqueo.
        const nube = crearNube();
        const a = aparato(nube, { equipo: 'eq_alevin_c' });
        await a.w.cronosSesionAlAbrirPartido();
        const d = nube.docs[Object.keys(nube.docs)[0]];
        ok('13f · la marca dice equipo, categoría, subcategoría y entorno',
           !!d.teamId && !!d.category && !!d.subcategory && d.entorno === 'prod',
           JSON.stringify(d));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  14. v733 · DOS VENTANAS DEL MISMO NAVEGADOR (captura 10532)
    // ═══════════════════════════════════════════════════════════════════════
    //  El autor puso DOS partidos del Alevín C en marcha a la vez con dos
    //  ventanas del mismo PC. El candado los daba por «el mismo aparato»
    //  —comparten `localStorage`— y la regla de v699 dejaba reentrar. La
    //  unidad pasa a ser la PESTAÑA… sin romper la recarga, que es la razón
    //  por la que aquella regla existía.
    {
        const nube = crearNube();
        const v1 = aparato(nube, { equipo: 'eq_alevin_c', nombre: 'Windows' });
        await v1.w.cronosSesionAlAbrirPartido();
        const v2 = aparato(nube, { equipo: 'eq_alevin_c', nombre: 'Windows', aparatoDe: v1 });
        v2.avisos.respuestaConflicto = false;
        const entro = await v2.w.cronosSesionAlAbrirPartido();
        ok('14a · 🔑🔑 la SEGUNDA VENTANA del mismo PC no entra en el mismo equipo',
           entro === false && !!v2.avisos.conflicto,
           'es la captura 10532: dos partidos del Alevín C a la vez');
        ok('14b · …y la plaza sigue siendo de la primera ventana',
           Object.keys(nube.docs).length === 1);
    }
    {
        // ⚠️ LO QUE NO SE PUEDE ROMPER: recargar con F5. Misma pestaña =
        // mismo sessionStorage = mismo tabId, aunque el módulo se cargue de
        // cero y pierda su estado en memoria.
        const nube = crearNube();
        const antes = aparato(nube, { equipo: 'eq_alevin_c', nombre: 'Windows' });
        await antes.w.cronosSesionAlAbrirPartido();
        const tras = aparato(nube, { equipo: 'eq_alevin_c', nombre: 'Windows',
                                     aparatoDe: antes, sesionDe: antes });
        tras.avisos.respuestaConflicto = false;
        const entro = await tras.w.cronosSesionAlAbrirPartido();
        ok('14c · 🔑 recargar la MISMA pestaña no se bloquea a sí misma',
           entro === true && tras.avisos.conflicto === null,
           'bloquear aquí dejaría al entrenador fuera de su partido tras un F5');
    }
    {
        // Y la multigestión sigue: dos ventanas, dos EQUIPOS distintos.
        const nube = crearNube();
        const v1 = aparato(nube, { equipo: 'eq_alevin_c', nombre: 'Windows' });
        await v1.w.cronosSesionAlAbrirPartido();
        const v2 = aparato(nube, { equipo: 'eq_regional_b', nombre: 'Windows', aparatoDe: v1 });
        const entro = await v2.w.cronosSesionAlAbrirPartido();
        ok('14d · 🔑 dos ventanas con equipos DISTINTOS: las dos entran',
           entro === true && v2.avisos.conflicto === null &&
           Object.keys(nube.docs).length === 2);
    }
    {
        // Cerrar una ventana no puede soltar la plaza que usa la otra.
        const nube = crearNube();
        const v1 = aparato(nube, { equipo: 'eq_alevin_c', nombre: 'Windows' });
        await v1.w.cronosSesionAlAbrirPartido();
        const v2 = aparato(nube, { equipo: 'eq_alevin_c', nombre: 'Windows', aparatoDe: v1 });
        v2.avisos.respuestaConflicto = true;                 // retira la prioridad
        await v2.w.cronosSesionAlAbrirPartido();
        await v1.w.cronosSesionLibera();                     // la primera se cierra
        ok('14e · ⚠️ al cerrarse, la ventana desalojada NO borra la marca de la otra',
           Object.keys(nube.docs).length === 1,
           JSON.stringify(nube.docs));
    }
    {
        // El desalojo llega a la ventana correcta.
        const nube = crearNube();
        const v1 = aparato(nube, { equipo: 'eq_alevin_c', nombre: 'Windows' });
        await v1.w.cronosSesionAlAbrirPartido();
        const v2 = aparato(nube, { equipo: 'eq_alevin_c', nombre: 'Windows', aparatoDe: v1 });
        v2.avisos.respuestaConflicto = true;
        await v2.w.cronosSesionAlAbrirPartido();
        ok('14f · 🔑 a la primera ventana se le avisa de que ha perdido el equipo',
           !!v1.avisos.desalojo);
    }
    ok('14g · el aviso distingue «otra ventana» de «otro dispositivo»',
       /_mismoAparato/.test(fuente) && /en otra ventana de este dispositivo/.test(fuente),
       'decir «otro dispositivo» mandaría a buscar un aparato que no existe');

    // ═══ 15. v771 · SOLTAR LA PLAZA AL MOMENTO ══════════════════════════════
    //  Encargo del autor (implementar.txt 2026-09-27, IMG_0618/IMG_0620): al
    //  cerrar la ventana, salir del partido o cambiar de equipo, el otro
    //  aparato tardaba demasiado en poder entrar (latido 25 s, TTL 75 s, y un
    //  `pagehide` que leía-y-borraba y nunca llegaba a salir).
    //  🚨 Y SIN BLOQUEAR DE MÁS NI DE MENOS: una plaza activa sigue
    //  protegida, y quien perdió la plaza no se la roba al volver.
    {
        const T = (aparato(crearNube()).w.CRONOS_SESION_TIEMPOS) || {};
        ok('15a · latido 10 s, caducidad 30 s y gracia de pestaña oculta 5 s',
           T.latido === 10000 && T.ttl === 30000 && T.oculta === 5000);
    }
    {
        // Caducidad nueva: a los 35 s sin señal, libre; a los 20 s, protegida.
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        nube.docs[clave].lastSeen = Date.now() - 20000;
        const pc1 = aparato(nube, { nombre: 'Windows' });
        const entro1 = await pc1.w.cronosSesionAlAbrirPartido();
        ok('15b · 🚨 CONTROL · con 20 s sin señal la plaza SIGUE protegida (pregunta)',
           entro1 === false && !!pc1.avisos.conflicto);
        nube.docs[clave].lastSeen = Date.now() - 35000;
        const pc2 = aparato(nube, { nombre: 'Windows' });
        const entro2 = await pc2.w.cronosSesionAlAbrirPartido();
        ok('15c · con 35 s sin señal ya está libre (antes hacían falta 75 s)',
           entro2 === true && pc2.avisos.conflicto === null);
    }
    {
        // CERRAR LA VENTANA, por el evento real `pagehide`.
        const nube = crearNube();
        const pc = aparato(nube, { nombre: 'Windows' });
        await pc.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        const tabPc = nube.docs[clave].tabId;
        ok('15d · el módulo escucha `pagehide`', typeof pc.oyentesVentana.pagehide === 'function');
        pc.oyentesVentana.pagehide({ persisted: false });
        await vueltas();
        ok('15e · 🔑 al cerrar la ventana la marca queda LIBERADA al momento',
           nube.docs[clave].liberada === true && nube.docs[clave].lastSeen === 0);
        ok('15f · …sin tocar de quién es (no se reescribe tabId) y con el uid que exige la regla',
           nube.docs[clave].tabId === tabPc && nube.docs[clave].uid === 'u1');
        const ipad = aparato(nube, { nombre: 'iPad' });
        const entro = await ipad.w.cronosSesionAlAbrirPartido();
        ok('15g · 🔑 y el iPad entra SIN esperar y sin preguntar',
           entro === true && ipad.avisos.conflicto === null);
        ok('15h · …y el PC, que ya se fue, no recibe ningún desalojo',
           pc.avisos.desalojo === null);
    }
    {
        // bfcache: `pagehide` con `persisted` puede VOLVER; no es un cierre.
        const nube = crearNube();
        const pc = aparato(nube, { nombre: 'Windows' });
        await pc.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        pc.oyentesVentana.pagehide({ persisted: true });
        await vueltas();
        ok('15i · `pagehide` hacia la caché de atrás/adelante marca OCULTA, no liberada',
           nube.docs[clave].oculta === true && nube.docs[clave].liberada !== true);
    }
    {
        // OCULTAR (iPad bloqueado / cerrar la app desde la multitarea).
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        ipad.ctx.document.visibilityState = 'hidden';
        ok('15j · el módulo escucha `visibilitychange`', typeof ipad.oyentesDoc.visibilitychange === 'function');
        ipad.oyentesDoc.visibilitychange();
        await vueltas();
        ok('15k · al ocultarse, la marca dice OCULTA', nube.docs[clave].oculta === true);

        const pc1 = aparato(nube, { nombre: 'Windows' });
        const entro1 = await pc1.w.cronosSesionAlAbrirPartido();
        ok('15l · 🚨 CONTROL · recién oculta (un parpadeo) todavía pregunta',
           entro1 === false && !!pc1.avisos.conflicto);

        nube.docs[clave].lastSeen = Date.now() - 6000;
        // Con la pantalla bloqueada el iPad no recibe nada: su oyente está
        // dormido. Se quita para que sea `AlVolver`, y no el oyente, quien
        // tenga que darse cuenta al despertar.
        nube.escuchas.length = 0;
        const pc2 = aparato(nube, { nombre: 'Windows' });
        pc2.avisos.respuestaConflicto = false;
        const entro2 = await pc2.w.cronosSesionAlAbrirPartido();
        const tabPc2 = nube.docs[clave].tabId;
        ok('15m · 🔑 oculta más de 5 s → el PC entra sin esperar los 30 s',
           entro2 === true && pc2.avisos.conflicto === null);

        // El iPad vuelve: la plaza ya es del PC → se retira, NO la roba.
        ipad.ctx.document.visibilityState = 'visible';
        ipad.oyentesDoc.visibilitychange();
        await vueltas(10);
        ok('15n · 🔑 al volver, el iPad ve que la plaza es de otro y se retira',
           !!ipad.avisos.desalojo);
        ok('15o · 🚨 …y NO se la roba con un latido a ciegas',
           /Windows/.test(nube.docs[clave].deviceName || '') &&
           nube.docs[clave].tabId === tabPc2 && nube.docs[clave].oculta !== true);
    }
    {
        // Volver cuando nadie la tomó: sigue siendo suya y deja de estar oculta.
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        ipad.ctx.document.visibilityState = 'hidden';
        ipad.oyentesDoc.visibilitychange();
        await vueltas();
        ipad.ctx.document.visibilityState = 'visible';
        const r = await ipad.w.cronosSesionAlVolver();
        ok('15p · al volver sin que nadie la tomara, sigue y deja de estar oculta',
           r === 'sigue' && nube.docs[clave].oculta === false && ipad.avisos.desalojo === null);
    }
    {
        // Quien PERDIÓ la plaza no puede «liberar» la del nuevo dueño al cerrar.
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const pc = aparato(nube, { nombre: 'Windows' });
        pc.avisos.respuestaConflicto = true;                 // retira la prioridad
        await pc.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        const enviado = ipad.w.cronosSesionAlCerrar();
        await vueltas();
        ok('15q · 🚨 el aparato desalojado NO marca liberada la plaza del nuevo dueño',
           enviado === false && nube.docs[clave].liberada !== true &&
           /Windows/.test(nube.docs[clave].deviceName || ''));
    }
    {
        // El camino que sobrevive al cierre: `fetch` keepalive a la API REST.
        const peticiones = [];
        const nube = crearNube();
        nube.api.db = { app: { options: { projectId: 'cronos-futbol-test' } } };
        nube.api.auth = { currentUser: { uid: 'u1', getIdToken: async () => 'TOKEN_ID' } };
        const pc = aparato(nube, { nombre: 'Windows',
                                   fetch: (url, op) => { peticiones.push({ url, op }); return Promise.resolve({}); } });
        pc.w._cronosAppCheckToken = async () => 'TOKEN_AC';
        await pc.w.cronosSesionAlAbrirPartido();
        await vueltas();                                     // tokens guardados de antemano
        pc.oyentesVentana.pagehide({ persisted: false });
        const p = peticiones[0] || { url: '', op: {} };
        const cab = p.op.headers || {};
        ok('15r · 🔑 al cerrar sale un `fetch` con keepalive (sobrevive a la página)',
           peticiones.length === 1 && p.op.keepalive === true && p.op.method === 'PATCH');
        ok('15s · …contra la marca de ESTA plaza en el proyecto del entorno',
           /projects\/cronos-futbol-test\/databases\/\(default\)\/documents\/cronos_role_sessions\//.test(p.url));
        ok('15t · …tocando sólo lastSeen y liberada, y sin crear la marca si ya no existe',
           /updateMask\.fieldPaths=lastSeen/.test(p.url) && /updateMask\.fieldPaths=liberada/.test(p.url) &&
           !/fieldPaths=tabId/.test(p.url) && /currentDocument\.exists=true/.test(p.url));
        ok('15u · …con el token del usuario y el de App Check (obligatorio en el proyecto)',
           cab.Authorization === 'Bearer TOKEN_ID' && cab['X-Firebase-AppCheck'] === 'TOKEN_AC');
        const cuerpo = JSON.parse(p.op.body || '{}');
        ok('15v · …y el cuerpo dice liberada=true y lastSeen=0',
           cuerpo.fields && cuerpo.fields.liberada && cuerpo.fields.liberada.booleanValue === true &&
           cuerpo.fields.lastSeen && cuerpo.fields.lastSeen.integerValue === '0');
    }
    {
        // SALIR DEL PARTIDO con «← INICIO»: se ejecuta goBackToSetup de verdad.
        const ml = leer('js/match/events/movement-log.js');
        const i = ml.indexOf('function goBackToSetup()');
        let j = ml.indexOf('{', i), prof = 0;
        for (; j < ml.length; j++) {
            if (ml[j] === '{') prof++;
            else if (ml[j] === '}') { prof--; if (prof === 0) { j++; break; } }
        }
        const llamadas = [];
        const sb = {
            matchPhase: '2nd_half', _saveMatchStateToStorage: () => llamadas.push('guarda'),
            stopLiveSync: () => llamadas.push('stopLive'), openSetupModal: () => llamadas.push('setup'),
            document: { getElementById: () => null },
            window: { cronosSesionLibera: () => { llamadas.push('libera'); return Promise.resolve(); } }
        };
        vm.createContext(sb);
        vm.runInContext(ml.slice(i, j) + '\ngoBackToSetup();', sb);
        ok('15w · 🔑 «← INICIO» (salir del partido) SUELTA la plaza',
           llamadas.indexOf('libera') >= 0);
        ok('15x · …después de cortar el directo y antes de abrir la configuración',
           llamadas.indexOf('stopLive') < llamadas.indexOf('libera') &&
           llamadas.indexOf('libera') < llamadas.indexOf('setup'));
    }

    // ═══ 16. v772 · UNA PLAZA RETENIDA SE PUEDE SOLTAR AL 100 % ═════════════
    //  Reporte del autor tras probar v771: «sin ningún otro dispositivo
    //  abierto, sigue saliendo que está abierto en iPhone · Safari».
    {
        // El FANTASMA: un aparato cuyo oyente murió (v717 se rinde tras 3
        // reintentos) o está dormido sigue latiendo. Antes su latido escribía
        // su tabId a ciegas y le ROBABA la plaza de vuelta a quien la liberó.
        const nube = crearNube();
        const iphone = aparato(nube, { nombre: 'iPhone' });
        await iphone.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        nube.escuchas.length = 0;                        // su oyente, muerto
        const pc = aparato(nube, { nombre: 'Windows' });
        pc.avisos.respuestaConflicto = true;             // 🔓 Liberar y entrar
        const entro = await pc.w.cronosSesionAlAbrirPartido();
        const tabPc = nube.docs[clave].tabId;
        for (const t of iphone.temporizadores) await t(); // el fantasma late
        ok('16a · 🔑🔑 tras «Liberar la sesión», el latido del fantasma NO recupera la plaza',
           entro === true && nube.docs[clave].tabId === tabPc &&
           /Windows/.test(nube.docs[clave].deviceName || ''));
        ok('16b · …y el fantasma se da cuenta y se retira con el aviso',
           !!iphone.avisos.desalojo);
    }
    {
        // Si el latido no puede leer, NO escribe (no sabe de quién es).
        const nube = crearNube();
        const a = aparato(nube);
        await a.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        nube.docs[clave].lastSeen = 12345;
        const getDocReal = nube.api.m.getDoc;
        nube.api.m.getDoc = async () => { throw new Error('sin red'); };
        for (const t of a.temporizadores) await t();
        nube.api.m.getDoc = getDocReal;
        ok('16c · si el latido no puede leer la marca, no escribe a ciegas',
           nube.docs[clave].lastSeen === 12345);
    }
    {
        // 🔴 Almacenamiento bloqueado (Safari «Bloquear todas las cookies»):
        // el tabId de match-slots cambiaba en CADA llamada y la pestaña no
        // reconocía su propia marca.
        const nube = crearNube();
        const iphone = aparato(nube, { nombre: 'iPhone' });
        let n = 0;
        iphone.w._cronosMatchSlots = { tabId: () => 'tab:cambia' + (n++) };
        await iphone.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        for (const t of iphone.temporizadores) await t();
        ok('16d · 🔑 con el id de pestaña inestable, la pestaña NO se desaloja a sí misma',
           iphone.avisos.desalojo === null);
        await iphone.w.cronosSesionLibera();
        ok('16e · …y al salir reconoce su marca como suya y la LIBERA',
           !!nube.docs[clave] && nube.docs[clave].liberada === true);
    }
    {
        // match-slots: sin sessionStorage, el id se recuerda en memoria.
        const ctxMs = { window: {}, console: { log(){}, warn(){}, error(){} },
                        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
                        sessionStorage: { getItem() { throw new Error('bloqueado'); },
                                          setItem() { throw new Error('bloqueado'); },
                                          removeItem() { throw new Error('bloqueado'); } } };
        ctxMs.window.window = ctxMs.window;
        vm.createContext(ctxMs);
        let ms = null;
        try {
            vm.runInContext(leer('js/core/match-slots.js'), ctxMs);
            ms = ctxMs.window._cronosMatchSlots;
        } catch (e) { ms = null; }
        const a1 = ms && ms.tabId(), a2 = ms && ms.tabId();
        ok('16f · 🔑 match-slots: con sessionStorage bloqueado, el id de pestaña es ESTABLE',
           !!a1 && a1 === a2);
    }
    ok('16g · 🔑 «Cerrar Sesión» (logoutUser) suelta la plaza ANTES de vaciar sessionStorage',
       /window\.logoutUser = async[\s\S]{0,1600}cronosSesionLibera\(\)[\s\S]{0,300}sessionStorage\.clear\(\)/
           .test(leer('js/services/auth.js')));
    // El aviso enseña la ÚLTIMA SEÑAL en segundos: distingue un aparato vivo
    // de una marca colgada.
    ok('16h · el aviso de conflicto muestra la «última señal hace N s»',
       /última señal hace/.test(fuente));

    // ═══ 17. v773 · SALIR LIMPIO NO PUEDE ECHAR AL SIGUIENTE ════════════════
    //  Reporte del autor tras v772: «al cerrar el partido en el PC e intentar
    //  abrirlo en el iPad (o viceversa), sigue saltando "Sesión cerrada en
    //  este dispositivo"». Es el aviso de DESALOJO, no el de «ya está abierto».
    //  La cadena: salir BORRABA la marca → con las reglas reales, leer una
    //  marca inexistente da permission-denied → el iPad entraba SIN escribir
    //  la suya → su oyente arrancaba con la CACHÉ LOCAL, donde seguía la del
    //  PC → «Sesión cerrada». Estos casos usan el doble con las reglas reales.
    {
        // 17a-c · EL REPORTE, TAL CUAL: PC sale limpio, el iPad entra.
        const nube = crearNube({ reglasReales: true });
        const pc = aparato(nube, { nombre: 'Windows' });
        await pc.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        // Lo que el iPad tenía en su caché de la vez anterior: la marca del PC.
        nube.cacheVieja[clave] = Object.assign({}, nube.docs[clave], { lastSeen: Date.now() - 3000 });
        await pc.w.cronosSesionLibera();                 // «← INICIO» en el PC
        ok('17a · 🔑 al salir, la marca SIGUE existiendo (liberada): así el siguiente la puede leer',
           !!nube.docs[clave] && nube.docs[clave].liberada === true);

        const ipad = aparato(nube, { nombre: 'iPad' });
        const entro = await ipad.w.cronosSesionAlAbrirPartido();
        await vueltas();                                 // que el oyente llegue a arrancar
        ok('17b · 🔑🔑 EL REPORTE: el iPad entra y NO recibe «Sesión cerrada en este dispositivo»',
           entro === true && ipad.avisos.desalojo === null && ipad.avisos.conflicto === null);
        ok('17c · …y la plaza pasa a ser del iPad, viva',
           /iPad/.test((nube.docs[clave] || {}).deviceName || '') && (nube.docs[clave] || {}).liberada === false);
    }
    {
        // 17d-e · La marca ya NO EXISTE (la borró una versión anterior): antes
        // se entraba sin escribirla; ahora permission-denied = «no hay marca».
        const nube = crearNube({ reglasReales: true });
        const ipad = aparato(nube, { nombre: 'iPad' });
        const clave = ipad.w.cronosClaveDePlaza(ipad.w._cronosCurrentUser);
        nube.cacheVieja[clave] = { uid: 'u1', tabId: 'tab:pc-viejo', deviceId: 'dev_pc',
                                   deviceName: 'Windows · Chrome', lastSeen: Date.now() - 2000 };
        const entro = await ipad.w.cronosSesionAlAbrirPartido();
        await vueltas();
        ok('17d · 🔑 con la marca inexistente (permission-denied) SE ESCRIBE la propia',
           entro === true && !!nube.docs[clave] && /iPad/.test(nube.docs[clave].deviceName || ''));
        ok('17e · 🔑 …y la foto VIEJA de la caché no desaloja a nadie',
           ipad.avisos.desalojo === null);
    }
    {
        // 17f · El oyente, con datos DEL SERVIDOR de una marca ajena MUERTA
        // (liberada): no es nadie tomando la plaza.
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        nube.docs[clave] = { uid: 'u1', tabId: 'tab:otro', deviceId: 'dev_x', deviceName: 'Windows · Chrome',
                             lastSeen: 0, liberada: true };
        await vueltas();                                 // el oyente ya está puesto
        ok('17f₀ · CONTROL · el oyente del iPad está escuchando', nube.escuchas.length > 0);
        nube.avisa(clave);
        ok('17f · una marca ajena LIBERADA que llega por el oyente no desaloja',
           ipad.avisos.desalojo === null);
        // 17g · …y el latido siguiente la ocupa con la nuestra.
        for (const t of ipad.temporizadores) await t();
        ok('17g · …y el latido la vuelve a ocupar con la nuestra',
           nube.docs[clave].tabId !== 'tab:otro' && nube.docs[clave].liberada === false &&
           /iPad/.test(nube.docs[clave].deviceName || ''));
    }
    {
        // 17h · CONTROL: una marca ajena VIVA por el oyente SÍ desaloja (si esto
        // fallara, los verdes de arriba no probarían nada).
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlAbrirPartido();
        const clave = Object.keys(nube.docs)[0];
        nube.docs[clave] = { uid: 'u1', tabId: 'tab:otro', deviceId: 'dev_x', deviceName: 'Windows · Chrome',
                             lastSeen: Date.now(), liberada: false };
        await vueltas();
        nube.avisa(clave);
        ok('17h · 🚨 CONTROL · una marca ajena VIVA del servidor SÍ desaloja',
           !!ipad.avisos.desalojo);
    }
    {
        // 17i · Ida y vuelta: PC → iPad → PC, saliendo limpio cada vez.
        const nube = crearNube({ reglasReales: true });
        const pc = aparato(nube, { nombre: 'Windows' });
        const ipad = aparato(nube, { nombre: 'iPad' });
        let limpio = true;
        for (let i = 0; i < 3; i++) {
            const clave = pc.w.cronosClaveDePlaza(pc.w._cronosCurrentUser);
            if (nube.docs[clave]) nube.cacheVieja[clave] = Object.assign({}, nube.docs[clave]);
            limpio = limpio && (await pc.w.cronosSesionAlAbrirPartido()) === true;
            await vueltas();
            await pc.w.cronosSesionLibera();
            if (nube.docs[clave]) nube.cacheVieja[clave] = Object.assign({}, nube.docs[clave], { liberada: false, lastSeen: Date.now() });
            limpio = limpio && (await ipad.w.cronosSesionAlAbrirPartido()) === true;
            await vueltas();
            await ipad.w.cronosSesionLibera();
        }
        ok('17i · 🔑 PC → iPad → PC tres veces seguidas: nadie es bloqueado ni desalojado',
           limpio && pc.avisos.desalojo === null && ipad.avisos.desalojo === null &&
           pc.avisos.conflicto === null && ipad.avisos.conflicto === null);
    }

    // ═══ 8. INTEGRACIÓN ════════════════════════════════════════════════════
    const roleLaunch = leer('js/services/auth/role-launch.js');
    const setupModal = leer('js/core/setup-modal.js');
    // 🚪 v730 · El arranque de rol ya sólo hace HIGIENE (soltar una plaza
    // vieja); quien pide el equipo son las dos puertas del partido. Antes esta
    // aserción exigía lo contrario, y dejarla habría dicho que el arreglo
    // pedido por el autor es una regresión.
    ok('el arranque de rol ya NO reclama plaza: sólo suelta la que sobre',
       /cronosSesionAlEntrar\(\)/.test(roleLaunch) &&
       !/cronosSesionAlAbrirPartido/.test(roleLaunch));
    ok('🔑 v730 · CONTINUAR AL PARTIDO pide el equipo',
       /function confirmSetup\(\)[\s\S]{0,1600}cronosSesionAlAbrirPartido\(\)/.test(setupModal));
    ok('🔑 v730 · RECUPERAR PARTIDO también',
       /openLiveMatchRecovery\(\)[\s\S]{0,600}cronosSesionAlAbrirPartido\(\)/.test(setupModal));
    ok('🔑 v730 · cambiar de equipo suelta la plaza del que se deja',
       /_cronosCambiarEquipo[\s\S]{0,3000}cronosSesionSincroniza\(\)/.test(setupModal));
    ok('salir a los roles suelta la plaza',
       /cronosSesionLibera/.test(leer('js/core/nav-stack.js')));
    ok('cerrar sesión suelta la plaza ANTES del signOut',
       /cronosSesionLibera[\s\S]{0,400}signOut/.test(leer('js/core/security-and-state.js')));
    ok('index.html carga el módulo',
       /session-lock\.js/.test(leer('index.html')));
    ok('las reglas declaran la colección con get y list SEPARADOS',
       /match \/cronos_role_sessions\/\{sessionId\}/.test(leer('firestore.rules')) &&
       /allow list:\s*if false/.test(leer('firestore.rules')));

    console.log(`\n  ${total - fallos}/${total} aserciones`);
    process.exit(fallos ? 1 : 0);
})();

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
function crearNube() {
    const docs = {};            // la "base de datos" compartida
    const escuchas = [];        // onSnapshot registrados
    const avisa = (id) => escuchas.filter(e => e.id === id)
                                  .forEach(e => e.fn({ exists: () => !!docs[id], data: () => docs[id] }));
    return {
        docs, escuchas, avisa,
        api: {
            m: {
                doc: (db, col, id) => ({ _id: id }),
                getDoc: async (ref) => ({ exists: () => !!docs[ref._id], data: () => docs[ref._id] }),
                setDoc: async (ref, data, op) => {
                    docs[ref._id] = (op && op.merge) ? Object.assign({}, docs[ref._id] || {}, data) : data;
                    avisa(ref._id);
                },
                deleteDoc: async (ref) => { delete docs[ref._id]; avisa(ref._id); },
                onSnapshot: (ref, fn) => {
                    const e = { id: ref._id, fn };
                    escuchas.push(e);
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
    const almacen = {};
    const avisos = { conflicto: null, desalojo: null, respuestaConflicto: false };
    const temporizadores = [];

    const ctx = {
        console: { log(){}, warn(){}, error(){} },
        Date, Math, JSON, String, Number, Promise, Object, Array,
        setInterval: (fn) => { temporizadores.push(fn); return temporizadores.length; },
        clearInterval: () => {},
        navigator: { userAgent: o.nombre === 'iPad' ? 'iPad; CPU OS 17 Safari' : 'Windows NT 10.0 Chrome',
                     maxTouchPoints: o.nombre === 'iPad' ? 5 : 0 },
        localStorage: {
            getItem: k => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); },
            removeItem: k => { delete almacen[k]; }
        },
        document: {
            createElement: () => ({ style: {}, _html: '', set innerHTML(v) { this._html = v; },
                                    get innerHTML() { return this._html; },
                                    querySelector: () => ({ addEventListener: () => {} }),
                                    remove: () => {}, addEventListener: () => {} }),
            body: { appendChild: () => {} }
        },
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
        addEventListener: () => {},
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

    return { ctx, w: ctx.window, avisos, temporizadores };
}

(async function () {
    // ═══ 1. CONTROL: un solo aparato entra sin problema ════════════════════
    {
        const nube = crearNube();
        const a = aparato(nube);
        const entro = await a.w.cronosSesionAlEntrar();
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
        await ipad.w.cronosSesionAlEntrar();

        const movil = aparato(nube, { nombre: 'Windows' });
        movil.avisos.respuestaConflicto = false;            // el usuario CANCELA
        const entro = await movil.w.cronosSesionAlEntrar();

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
        await ipad.w.cronosSesionAlEntrar();

        const movil = aparato(nube, { nombre: 'Windows' });
        movil.avisos.respuestaConflicto = true;             // el usuario TOMA EL CONTROL
        const entro = await movil.w.cronosSesionAlEntrar();

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
        await pc.w.cronosSesionAlEntrar();
        const movil = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        const entro = await movil.w.cronosSesionAlEntrar();
        ok('🔑 ROLES DISTINTOS a la vez: Director en el PC y Entrenador en el móvil',
           entro === true && movil.avisos.conflicto === null &&
           Object.keys(nube.docs).length === 2);
    }
    {
        // Decisión del autor: la unidad es la PLAZA. Un entrenador con dos
        // equipos puede llevar uno en cada aparato: son partidos distintos.
        const nube = crearNube();
        const ipad = aparato(nube, { rol: 'user', equipo: 'eq_alevin_c' });
        await ipad.w.cronosSesionAlEntrar();
        const movil = aparato(nube, { rol: 'user', equipo: 'eq_regional_a' });
        const entro = await movil.w.cronosSesionAlEntrar();
        ok('🔑 MISMO rol y EQUIPOS distintos: los dos entran (la unidad es la plaza)',
           entro === true && movil.avisos.conflicto === null &&
           Object.keys(nube.docs).length === 2);
    }
    {
        // Usuarios distintos nunca se estorban.
        const nube = crearNube();
        const a = aparato(nube, { uid: 'u1' });
        await a.w.cronosSesionAlEntrar();
        const b = aparato(nube, { uid: 'u2' });
        const entro = await b.w.cronosSesionAlEntrar();
        ok('dos USUARIOS distintos con el mismo rol no se estorban', entro === true);
    }

    // ═══ 5. NO DEJAR A NADIE TIRADO ════════════════════════════════════════
    {
        // 🚨 Sin cobertura —lo normal en un campo de fútbol— se ENTRA. Dejar
        // fuera a un entrenador por no tener red sería peor que el problema.
        const nube = crearNube();
        const solo = aparato(nube, { sinNube: true });
        const entro = await solo.w.cronosSesionAlEntrar();
        ok('🚨 sin conexión se ENTRA igual (fail-open deliberado)',
           entro === true && solo.avisos.conflicto === null);
    }
    {
        // La marca caduca sola: un móvil sin batería no bloquea la plaza para
        // siempre.
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlEntrar();
        const clave = Object.keys(nube.docs)[0];
        nube.docs[clave].lastSeen = Date.now() - (10 * 60 * 1000);   // 10 minutos sin señal
        const movil = aparato(nube, { nombre: 'Windows' });
        const entro = await movil.w.cronosSesionAlEntrar();
        ok('🚨 una marca CADUCADA no bloquea: el segundo entra sin preguntar nada',
           entro === true && movil.avisos.conflicto === null);
    }
    {
        // El mismo aparato volviendo a entrar no se bloquea a sí mismo.
        const nube = crearNube();
        const a = aparato(nube);
        await a.w.cronosSesionAlEntrar();
        const entro = await a.w.cronosSesionAlEntrar();
        ok('el MISMO aparato reentrando no se bloquea a sí mismo',
           entro === true && a.avisos.conflicto === null);
    }

    // ═══ 6. SOLTAR LA PLAZA ════════════════════════════════════════════════
    {
        const nube = crearNube();
        const a = aparato(nube, { nombre: 'iPad' });
        await a.w.cronosSesionAlEntrar();
        await a.w.cronosSesionLibera();
        ok('al salir, la marca se borra y la plaza queda libre',
           Object.keys(nube.docs).length === 0);

        const b = aparato(nube, { nombre: 'Windows' });
        const entro = await b.w.cronosSesionAlEntrar();
        ok('…y otro aparato entra sin preguntar', entro === true && b.avisos.conflicto === null);
    }
    {
        // 🔑 Si otro tomó el control, MI salida no puede borrar SU marca: le
        // dejaría la plaza libre a un tercero sin que él se entere.
        const nube = crearNube();
        const ipad = aparato(nube, { nombre: 'iPad' });
        await ipad.w.cronosSesionAlEntrar();
        const movil = aparato(nube, { nombre: 'Windows' });
        movil.avisos.respuestaConflicto = true;
        await movil.w.cronosSesionAlEntrar();
        await ipad.w.cronosSesionLibera();
        ok('🔑 quien perdió la plaza NO borra la marca del que la tiene',
           Object.keys(nube.docs).length === 1 &&
           /Windows/.test(nube.docs[Object.keys(nube.docs)[0]].deviceName || ''));
    }
    {
        // Cambiar de plaza en el mismo aparato suelta la anterior.
        const nube = crearNube();
        const a = aparato(nube, { equipo: 'eq_alevin_c' });
        await a.w.cronosSesionAlEntrar();
        a.w._cronosCurrentUser = { uid: 'u1', _activeRole: 'user', clubId: 'clubA' };
        a.w.cronosMyTeamId = () => 'eq_regional_a';
        await a.w.cronosSesionAlEntrar();
        ok('cambiar de equipo en el mismo aparato suelta la plaza anterior',
           Object.keys(nube.docs).length === 1 &&
           /eq_regional_a/.test(Object.keys(nube.docs)[0]));
    }

    // ═══ 7. EL LATIDO MANTIENE VIVA LA PLAZA ═══════════════════════════════
    {
        const nube = crearNube();
        const a = aparato(nube);
        await a.w.cronosSesionAlEntrar();
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
        const entro1 = await ipad.w.cronosSesionAlEntrar();
        const movil = aparato(nube, { nombre: 'Windows', extras: { sesion_unica: false } });
        const entro2 = await movil.w.cronosSesionAlEntrar();
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
        await a.w.cronosSesionAlEntrar();
        const b = aparato(nube, { nombre: 'Windows', extras: { otra_cosa: true } });
        const entro = await b.w.cronosSesionAlEntrar();
        ok('🔑 extra AUSENTE = control ACTIVO (regla `!== false`)',
           entro === false && !!b.avisos.conflicto);
    }
    ok('el extra está declarado en el panel del SuperAdmin',
       /key:\s*'sesion_unica'/.test(leer('js/admin/superadmin/extras-toggle.js')));

    // ═══ 8. INTEGRACIÓN ════════════════════════════════════════════════════
    const roleLaunch = leer('js/services/auth/role-launch.js');
    ok('el arranque de rol pide la plaza al final (cuando ya conoce el equipo)',
       /cronosSesionAlEntrar\(\)/.test(roleLaunch));
    ok('si el usuario cancela, se le devuelve al selector de roles',
       /navExitToRoles\(\)/.test(roleLaunch));
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

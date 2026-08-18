// ═══════════════════════════════════════════════════════════════════════════
//  v579 · EL TECHO DE ~100 OYENTES DE FIRESTORE
// ═══════════════════════════════════════════════════════════════════════════
//  Firestore corta a ~100 listeners simultaneos por cliente, y la aplicacion
//  abre UNO por partido vigilado (`_bgWatchers`). Un SuperAdmin sin filtro de
//  club seguia TODOS los partidos activos de la plataforma: con 7 clubes de 15
//  partidos son 105 y el panel deja de recibir datos.
//
//  🔑 Y NO FALLA CON UN ERROR: se queda mudo. Era el limite de escala real del
//  producto —el que marcaba cuantos clubes se podian vender— y por eso este
//  guard EJECUTA el codigo real en vez de leerlo: lo que hay que demostrar es
//  cuantos listeners se abren de verdad, no que haya un `limit` escrito.
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

const mTope = LIVE.match(/const\s+_MAX_VIGILANTES\s*=\s*(\d+)\s*;/);
ok('0a · existe el tope _MAX_VIGILANTES', !!mTope);
const TOPE = mTope ? parseInt(mTope[1], 10) : 0;

// El tope tiene que dejar sitio a los OTROS listeners que la pantalla mantiene
// a la vez: los de la lista, el del partido abierto y el de su indice.
ok('0b · 🔑 y deja holgura bajo el techo de ~100 (' + TOPE + ')',
   TOPE > 0 && TOPE <= 80,
   'sin holgura, los listeners de la lista y del detalle empujan por encima de 100');

const ini = LIVE.indexOf('async function refreshBackgroundWatchers()');
const fin = LIVE.indexOf('function startBackgroundWatch()');
ok('0c · se encuentra refreshBackgroundWatchers', ini !== -1 && fin > ini);

if (fail) { console.log('\n' + pass + ' PASS / ' + fail + ' FAIL'); process.exit(1); }

// ── Entorno de mentira: se cuenta cuantos vigilantes se abren ──────────────
function corre(nPartidos) {
    const abiertos = [];
    const env = {
        _MAX_VIGILANTES: TOPE,
        _bgWatchers: {},
        _matchPrevState: {}, _matchSeeded: {}, _matchSeedTs: {}, _matchLastTs: {},
        _matchSeenEvents: {}, _matchPrevPhase: {}, _matchLastData: {},
        _cronosDiag: null,
        window: {},
        console: { warn: () => {}, log: () => {} },
        // Todo lo que llega es seguible: aqui se mide el TOPE, no el criterio
        // de pertenencia (eso lo cubre test_live_list_filtered.js).
        _userCanFollow: () => true,
        _vigilaConRespaldo: (id) => { abiertos.push(id); return () => {}; },
        detectAndAlert: () => {},
        getDocs: async () => { throw new Error('no deberia hacer falta'); },
        collection: () => ({}),
        db: {},
        Set, Math, Date, Array, Object, JSON, String, Number,
    };
    // Candidatos con `updatedAt` CRECIENTE: el partido 0 es el mas viejo y el
    // ultimo el mas reciente. Asi se puede comprobar a quien se deja fuera.
    const candidatos = [];
    for (let i = 0; i < nPartidos; i++) {
        candidatos.push({ id: 'M' + i, status: 'active', updatedAt: { seconds: 1000 + i } });
    }
    env._fetchFollowableMatches = async () => candidatos;
    vm.createContext(env);
    vm.runInContext(LIVE.slice(ini, fin), env);
    return { env, abiertos, ejecuta: () => vm.runInContext('refreshBackgroundWatchers()', env) };
}

(async () => {
    // ═══════ PARTE 1 · por debajo del tope no se toca nada ═══════
    console.log('\n── PARTE 1 · una jornada normal no se recorta ──');
    {
        const c = corre(15);            // la jornada real del autor
        await c.ejecuta();
        ok('1a · con 15 partidos se vigilan los 15',
           c.abiertos.length === 15, 'se abrieron ' + c.abiertos.length);
        ok('1b · y no se avisa de ningun recorte',
           !c.env.window._cronosVigilantesRecortados,
           'un aviso falso asustaria sin motivo');
    }

    // ═══════ PARTE 2 · por encima del tope, se recorta ═══════
    console.log('\n── PARTE 2 · la plataforma entera (el caso del SuperAdmin) ──');
    {
        const c = corre(150);           // 10 clubes x 15 partidos
        await c.ejecuta();

        ok('2a · 🔑 NUNCA se abren mas listeners que el tope',
           c.abiertos.length === TOPE,
           'se abrieron ' + c.abiertos.length + ' y el techo de Firestore son ~100');

        // 🔑 Si hay que dejar partidos fuera, que sean los que llevan rato
        // quietos — no los que se estan jugando ahora mismo. Sin ordenar, "los
        // primeros N" serian arbitrarios: los que devolviera la consulta.
        const masReciente = 'M149';
        const masViejo    = 'M0';
        ok('2b · 🔑 se vigilan los de actividad MAS RECIENTE',
           c.abiertos.indexOf(masReciente) !== -1,
           'el partido que acaba de moverse tiene que estar dentro');
        ok('2c · y quedan fuera los que llevan mas tiempo quietos',
           c.abiertos.indexOf(masViejo) === -1,
           'dejar fuera al que se esta jugando seria lo contrario de lo que hace falta');

        // ⚠️ Un tope que recorta EN SILENCIO es indistinguible de un fallo: el
        // SuperAdmin creeria estar oyendo toda la plataforma.
        ok('2d · ⚠️ el recorte se publica, no se calla',
           c.env.window._cronosVigilantesRecortados === 150 - TOPE,
           'valor publicado: ' + c.env.window._cronosVigilantesRecortados);
    }

    // ═══════ PARTE 3 · el aviso llega a la pantalla ═══════
    console.log('\n── PARTE 3 · y el usuario se entera ──');
    {
        // Se ancla en la LECTURA de la lista (`const _fuera = ...`), no en la
        // variable a secas: su primera aparicion es la ESCRITURA, alla en
        // refreshBackgroundWatchers, y desde ahi no se alcanza el pintado.
        ok('3a · la lista pinta el aviso cuando hay recorte',
           /const _fuera = window\._cronosVigilantesRecortados[\s\S]{0,1200}?listEl\.appendChild\(aviso\)/.test(LIVE),
           'publicarlo sin pintarlo lo deja igual de invisible');
        ok('3b · y dice como verlos todos (filtrar por club)',
           /const _fuera = window\._cronosVigilantesRecortados[\s\S]{0,1200}?filtra por club/.test(LIVE),
           'un aviso sin salida solo genera desconfianza');
    }

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();

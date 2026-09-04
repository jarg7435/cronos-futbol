// ─────────────────────────────────────────────────────────────────────────
// test_live_list_filtered.js  ·  la lista de Partidos en Vivo deja de
// escanear la coleccion entera (v433)
//
// El ultimo escaneo completo que quedaba abierto. showLiveNow hacia
// onSnapshot(collection(db,'live_matches')) SIN un solo where y filtraba
// despues en el cliente — el mismo defecto que se corrigio en
// refreshBackgroundWatchers en v431, con los indices ya desplegados desde
// entonces. Cada espectador se bajaba TODOS los partidos de TODOS los clubes,
// y volvia a bajarse el documento entero en cada latido de 5 s de cualquiera.
//
// ESTE GUARD EJECUTA EL CODIGO. Extrae _followableQueries y el bloque de
// cableado de los listeners de live.html y los corre contra un Firestore de
// mentira, comprobando QUE CONSULTAS SE PIDEN y QUE SE PINTA. Un censo por
// regex no habria visto ninguno de los cuatro defectos de abajo.
//
// LO QUE PROTEGE:
//
//  A · UN MAPA POR CONSULTA, NO UNO COMPARTIDO. Firestore no sabe hacer OR
//      entre campos distintos, asi que son varios listeners que se fusionan
//      aqui. Con un mapa comun, un partido que SALE de una consulta (termina,
//      o cambia de club) se queda pegado en la lista para siempre: un snapshot
//      solo dice lo que HAY, nunca lo que se ha ido. El sintoma seria un
//      partido fantasma "EN VIVO" que no hay forma de quitar.
//
//  B · RESPALDO AL ESCANEO COMPLETO. Si faltara un indice compuesto la
//      consulta falla y la lista se queda VACIA — indistinguible de "no hay
//      partidos": ni error, ni sintoma. Caro, pero funcionando.
//
//  C · EL RESPALDO NO PUEDE RESUCITAR DESPUES DE SALIR. Un error que llegue
//      tras cancelar levantaria un listener sobre la coleccion entera que ya
//      nadie cancela: justo el defecto que se esta arreglando, pero ahora
//      invisible y permanente.
//
//  D · UN SOLO PUNTO donde se declara el criterio. Los dos consumidores
//      (_fetchFollowableMatches y la lista) tiran de _followableQueries. Dos
//      definiciones del mismo criterio acaban divergiendo — ya paso con
//      _userCanFollow.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');

console.log('── la lista de Partidos en Vivo, filtrada en servidor (v433) ──\n');

// ═══════════ Extraccion de las dos piezas ═══════════
const iniQ = LIVE.indexOf('function _followableQueries()');
const finQ = LIVE.indexOf('async function _fetchFollowableMatches()');
ok('0a · _followableQueries existe en live.html', iniQ !== -1 && finQ > iniQ);

const iniC = LIVE.indexOf('// ── Cableado de los listeners filtrados');
const finC = LIVE.indexOf('_liveListUnsubscribe = cancelarTodos;');
ok('0b · el bloque de cableado de la lista sigue ahi', iniC !== -1 && finC > iniC);

if (fail) { console.log('\n' + pass + ' PASS / ' + fail + ' FAIL'); process.exit(1); }

const SRC_Q = LIVE.slice(iniQ, finQ);
const SRC_C = LIVE.slice(iniC, finC);

// v572 · P2 · `_followableQueries` usa la constante de modulo `_COL_INDICE`,
// que queda FUERA del recorte de arriba. Se extrae del fuente real —no se
// escribe 'live_index' a mano— para que renombrarla o borrarla ponga rojo este
// test en lugar de dejarlo corriendo sobre un nombre inventado.
const mColIdx = LIVE.match(/const\s+_COL_INDICE\s*=\s*"([^"]+)"\s*;/);
ok('0c · existe la constante _COL_INDICE con la coleccion ligera',
   !!mColIdx, 'P2 la necesita para la lista y las alertas');
const COL_INDICE = mColIdx ? mColIdx[1] : 'live_index';

// v579 · el tope de vigilantes vive fuera del recorte. Se lee del fuente real
// —no se escribe a mano— para que este test mida el numero que se despliega de
// verdad y no uno inventado que ya no exista.
const mTope = LIVE.match(/const\s+_MAX_VIGILANTES\s*=\s*(\d+)\s*;/);
ok('0d · existe el tope _MAX_VIGILANTES', !!mTope,
   'sin el, el SuperAdmin sin filtro revienta el techo de ~100 oyentes');
const MAX_VIGILANTES = mTope ? parseInt(mTope[1], 10) : 60;

// Firestore de mentira: `query` devuelve la lista de condiciones tal cual, para
// poder mirar DESPUES por que se ha preguntado.
function nuevoEntorno(userData, saFilter) {
    const listeners = [];   // {cond, onNext, onErr, cancelado}
    const env = {
        userData,
        window: { _saClubFilter: saFilter || null },
        db: {},
        // v572 · el stub RECUERDA a que coleccion se pregunto. Antes devolvia
        // 'live_matches' fijo, asi que no habria notado que P2 movio la lista y
        // las alertas a `live_index` — ni lo habria notado si un dia volvieran
        // a la coleccion cara por error.
        collection: (_db, nombre) => ({ __col: nombre }),
        where: (campo, op, valor) => ({ campo, op, valor }),
        // v579 · el SuperAdmin sin filtro acota con orderBy+limit para no pasarse
        // del techo de ~100 oyentes de Firestore. Se estabulan devolviendo un
        // marcador que la consulta guarda, para poder comprobar DESPUES que la
        // acotacion se pidio de verdad.
        orderBy: (campo, dir) => ({ __orderBy: campo, dir: dir || 'asc' }),
        limit: (n) => ({ __limit: n }),
        query: (col, ...conds) => ({ __col: col.__col, conds }),
        onSnapshot: (q, onNext, onErr) => {
            const l = { q, onNext, onErr, cancelado: false };
            listeners.push(l);
            return () => { l.cancelado = true; };
        },
        console: { warn: () => {}, log: () => {} },
        pintados: [],
        _COL_INDICE: COL_INDICE,   // v572 · constante de modulo, ver arriba
        _MAX_VIGILANTES: MAX_VIGILANTES,  // v579 · idem
        Map, Array, Object, String, Number
    };
    env._repintarLista = (docs) => env.pintados.push(docs.map(d => d.id));
    vm.createContext(env);
    vm.runInContext(SRC_Q, env);
    return { env, listeners };
}

const cablear = (env) => vm.runInContext(SRC_C, env);
const condsDe = (l) => l.q.conds
    ? l.q.conds.map(c => c.campo + c.op + c.valor).sort().join(' & ')
    : '__COLECCION_ENTERA__';

// ═══════════ PARTE 1 · que consultas se piden ═══════════
console.log('\n── PARTE 1 · se pregunta solo por lo que el usuario puede ver ──');
{
    const { env } = nuevoEntorno({ role: 'coach', clubId: 'C1', uid: 'U1', email: 'a@b.c' });
    const qs = vm.runInContext('_followableQueries()', env);

    ok('1a · el entrenador lanza las TRES consultas, no un escaneo', qs.length === 3);

    const firmas = qs.map(q => q.conds.map(c => c.campo).sort().join('+')).sort();
    ok('1b · club, creador y email — las mismas condiciones que _userCanFollow',
       firmas.join(' | ') === 'clubId+status | coachEmail+status | createdBy+status',
       firmas.join(' | '));

    ok('1c · [DEFECTO CENTRAL] NINGUNA consulta va sin condiciones',
       qs.every(q => q.conds && q.conds.length >= 2),
       'una consulta sin where es el escaneo completo otra vez');

    ok('1d · todas acotan por status active',
       qs.every(q => q.conds.some(c => c.campo === 'status' && c.valor === 'active')),
       'sin acotar por estado se traen tambien los partidos terminados');

    // ══════════════════════════════════════════════════════════════
    //  🪶 v572 · P2 · Y SE PREGUNTA A LA COLECCION LIGERA
    // ══════════════════════════════════════════════════════════════
    //  Aqui esta TODO el ahorro de P2. Un espectador esta suscrito a todos los
    //  partidos activos de su club a la vez; preguntando a `live_matches` cada
    //  latido le entrega el documento entero de cada uno (10.625 B de media),
    //  y de ahi los 375 MB por manana que midio el autor. Preguntando al indice
    //  son ~1.000 B. Si alguien devolviera estas consultas a `live_matches` la
    //  aplicacion seguiria funcionando igual de bien —por eso hace falta un
    //  guard: el defecto no se ve, solo se paga.
    ok('1e · 🪶 las consultas van al INDICE ligero, no a los partidos enteros',
       qs.every(q => q.__col === COL_INDICE),
       'se pregunto a: ' + JSON.stringify(qs.map(q => q.__col)));
}
{
    const { env } = nuevoEntorno({ role: 'superadmin', uid: 'U9', email: 'sa@b.c' });
    const qs = vm.runInContext('_followableQueries()', env);
    // ══════════════════════════════════════════════════════════════
    //  🚦 v579 · Y SOBRE TODO: ACOTADO, O REVIENTA EL TECHO DE OYENTES
    // ══════════════════════════════════════════════════════════════
    //  Firestore corta a ~100 listeners simultaneos por cliente y la aplicacion
    //  abre UNO por partido vigilado. Un SuperAdmin sin filtro de club seguia
    //  TODOS los partidos activos de la plataforma: con 7 clubes de 15 partidos
    //  son 105 y el panel deja de recibir datos — sin error, en silencio. Era
    //  el limite de escala real del producto.
    ok('1e · el SuperAdmin sin filtro sigue acotando por estado ACTIVO',
       qs.length === 1 && qs[0].conds.some(c => c.campo === 'status' && c.valor === 'active'),
       JSON.stringify(qs[0] && qs[0].conds));

    const _lim = qs[0].conds.find(c => c.__limit !== undefined);
    ok('1e2 · 🔑 y acota CUANTOS, para no pasarse del techo de ~100 oyentes',
       !!_lim && _lim.__limit === MAX_VIGILANTES && MAX_VIGILANTES < 100,
       'limite pedido: ' + JSON.stringify(_lim) + ' · tope declarado: ' + MAX_VIGILANTES);

    // ⚠️⚠️ `limit` SIN `orderBy` NO da "los N mas relevantes": da los N primeros
    // en el orden interno de Firestore, que aqui empieza por el id — y el id
    // empieza por la FECHA. Seria una ventana sobre los partidos MAS VIEJOS,
    // justo el defecto que costo tres rondas en v508. Tiene que ir por
    // `updatedAt` DESCENDENTE para que los N vigilados sean los que acaban de
    // moverse.
    const _ord = qs[0].conds.find(c => c.__orderBy !== undefined);
    ok('1e3 · 🔑🔑 el limite va con orderBy(updatedAt, DESC), nunca solo',
       !!_ord && _ord.__orderBy === 'updatedAt' && _ord.dir === 'desc',
       'un limit sin orderBy abre la ventana en lo MAS VIEJO (v508): ' + JSON.stringify(_ord));
}
{
    const { env } = nuevoEntorno({ role: 'superadmin', uid: 'U9' }, 'CLUB7');
    const qs = vm.runInContext('_followableQueries()', env);
    ok('1f · con el filtro de club puesto, el SuperAdmin acota por ese club',
       qs.length === 1 && qs[0].conds.some(c => c.campo === 'clubId' && c.valor === 'CLUB7'));
}
{
    const { env } = nuevoEntorno({ role: 'parent' });
    const qs = vm.runInContext('_followableQueries()', env);
    ok('1g · sin clubId, sin uid y sin email no se pregunta nada', qs.length === 0);
}

// ═══════════ PARTE 2 · la fusion de los listeners ═══════════
console.log('\n── PARTE 2 · varios listeners, una sola lista ──');
{
    const { env, listeners } = nuevoEntorno({ role: 'coach', clubId: 'C1', uid: 'U1', email: 'a@b.c' });
    cablear(env);

    ok('2a · se levanta un listener por consulta', listeners.length === 3);
    ok('2b · y ninguno sobre la coleccion entera',
       listeners.every(l => condsDe(l) !== '__COLECCION_ENTERA__'),
       listeners.map(condsDe).join(' / '));

    // Si no hay listeners, las de abajo deben fallar LIMPIAS: reventar aqui con
    // un TypeError aborta el fichero entero y las partes 3 y 4 no llegan a
    // correr, dejando defectos reales sin cazar (visto en el red-check de v433).
    const L = (i) => listeners[i] || { onNext: () => {}, onErr: () => {}, cancelado: false, q: {} };

    // Llega el primer snapshot: dos partidos del club.
    L(0).onNext([{ id: 'M1', data: () => ({}) }, { id: 'M2', data: () => ({}) }]);
    const ultimo = () => (env.pintados[env.pintados.length - 1] || []).slice().sort().join(',');
    ok('2c · pinta lo que trae la primera consulta', ultimo() === 'M1,M2');

    // La segunda consulta trae uno repetido y uno nuevo.
    L(1).onNext([{ id: 'M2', data: () => ({}) }, { id: 'M3', data: () => ({}) }]);
    ok('2d · fusiona por id, sin duplicar el que sale en dos consultas',
       ultimo() === 'M1,M2,M3');

    // ⚠️ EL DEFECTO A. M1 termina y sale de la primera consulta.
    L(0).onNext([{ id: 'M2', data: () => ({}) }]);
    ok('2e · [DEFECTO A] el partido que SALE de una consulta desaparece',
       ultimo() === 'M2,M3',
       'con un mapa compartido se quedaria pegado como partido fantasma');
}
{
    const { env, listeners } = nuevoEntorno({ role: 'parent' });
    cablear(env);
    ok('2f · sin consultas no se abre ningun listener', listeners.length === 0);
    ok('2g · y la lista se pinta vacia, no se queda cargando para siempre',
       env.pintados.length === 1 && env.pintados[0].length === 0);
}

// ═══════════ PARTE 3 · el respaldo ═══════════
console.log('\n── PARTE 3 · respaldo si faltara un indice ──');
{
    const { env, listeners } = nuevoEntorno({ role: 'coach', clubId: 'C1', uid: 'U1', email: 'a@b.c' });
    cablear(env);

    (listeners[0] || { onErr: () => {} }).onErr({ code: 'failed-precondition', message: 'The query requires an index' });

    ok('3a · [DEFECTO B] al fallar la consulta se cae al escaneo completo',
       listeners.some(l => condsDe(l) === '__COLECCION_ENTERA__'),
       'sin respaldo la lista sale vacia, que parece "no hay partidos"');

    ok('3b · y los listeners filtrados se cancelan, no se quedan sumando',
       listeners.filter(l => condsDe(l) !== '__COLECCION_ENTERA__').every(l => l.cancelado));

    const respaldo = listeners.find(l => condsDe(l) === '__COLECCION_ENTERA__');
    if (respaldo) respaldo.onNext([{ id: 'M9', data: () => ({}) }]);
    ok('3c · el respaldo pinta de verdad',
       !!respaldo && (env.pintados[env.pintados.length - 1] || []).join(',') === 'M9');

    const antes = listeners.length;
    (listeners[1] || { onErr: () => {} }).onErr({ message: 'otro fallo' });
    ok('3d · un segundo error no abre un segundo escaneo completo',
       listeners.length === antes, 'se acumularian listeners duplicados sobre toda la coleccion');
}
{
    // ⚠️ EL DEFECTO C. Se sale de la pantalla y DESPUES llega el error.
    const { env, listeners } = nuevoEntorno({ role: 'coach', clubId: 'C1', uid: 'U1', email: 'a@b.c' });
    cablear(env);
    vm.runInContext('cancelarTodos();', env);

    ok('3e · al salir se cancelan todos los listeners', listeners.every(l => l.cancelado));

    (listeners[0] || { onErr: () => {} }).onErr({ message: 'llega tarde' });
    ok('3f · [DEFECTO C] un error que llega DESPUES de salir no levanta el escaneo',
       !listeners.some(l => condsDe(l) === '__COLECCION_ENTERA__'),
       'quedaria un listener sobre la coleccion entera que ya nadie puede cancelar');
}

// ═══════════ PARTE 4 · lo estructural ═══════════
console.log('\n── PARTE 4 · un solo criterio, un solo punto de cancelacion ──');
{
    ok('4a · [DEFECTO D] _fetchFollowableMatches reutiliza _followableQueries',
       /async function _fetchFollowableMatches\(\)[\s\S]{0,600}_followableQueries\(\)/.test(LIVE),
       'dos definiciones del mismo criterio acaban divergiendo');

    // ⚠️ Contra SRC_C —el bloque de cableado ya recortado— y NO contra LIVE
    // entero: _fetchFollowableMatches tiene una linea casi identica, y buscando
    // en todo el fichero esta asercion daba VERDE con la lista construyendo su
    // propio criterio. La caso en el red-check de v433.
    ok('4b · showLiveNow tambien tira de _followableQueries',
       /const consultas\s*=\s*_followableQueries\(\)/.test(SRC_C),
       'la lista volveria a tener su propio criterio, que acabaria divergiendo');

    ok('4c · showLiveNow ya no se suscribe a la coleccion pelada',
       !/onSnapshot\(collection\(db, 'live_matches'\), \(snap\) => \{\s*\n\s*const liveMatches/.test(LIVE),
       'ese era el escaneo completo de la lista');

    // El unico escaneo sin filtro que puede quedar es el del respaldo.
    const escaneos = (LIVE.match(/onSnapshot\(collection\(db, 'live_matches'\)/g) || []).length;
    ok('4d · solo queda UN onSnapshot sin filtro en todo live.html: el respaldo',
       escaneos === 1, 'encontrados: ' + escaneos);

    ok('4e · el respaldo esta dentro de activarRespaldo, no en el camino normal',
       /const activarRespaldo[\s\S]{0,900}onSnapshot\(collection\(db, 'live_matches'\)/.test(LIVE));

    ok('4f · _liveListUnsubscribe sigue siendo UNA funcion que cancela todo',
       /_liveListUnsubscribe = cancelarTodos;/.test(LIVE) &&
       /if \(_liveListUnsubscribe\) \{ _liveListUnsubscribe\(\);/.test(LIVE),
       'los puntos de cancelacion existentes llaman a una sola funcion');

    ok('4g · el filtro por jerarquia del cliente se conserva',
       /userData\.clubId && m\.clubId === userData\.clubId/.test(LIVE),
       'es la segunda barrera: si el respaldo trae de mas, aqui se corta igual');

    ok('4h · `where` y `query` siguen importados en live.html',
       /import \{[\s\S]{0,300}\bwhere\b[\s\S]{0,200}firebase-firestore\.js/.test(LIVE) &&
       /import \{[\s\S]{0,300}\bquery\b[\s\S]{0,200}firebase-firestore\.js/.test(LIVE),
       'sin importarlos la consulta lanza ReferenceError y el respaldo tapa el fallo SIN sintoma');
}

// ═══════════════════════════════════════════════════════════════════════
// PARTE 5 · v674 · EL HISTORIAL TAMPOCO PIDE LA COLECCION ENTERA
// ═══════════════════════════════════════════════════════════════════════
//  Reporte del autor (captura 10002, produccion v673): Director Deportivo y
//  Coordinador pulsan «Historial» y sale «Missing or insufficient permissions».
//
//  La lista en vivo se acoto en v433 (todo lo de arriba) y el HISTORIAL se
//  quedo con `getDocs(collection(db,'live_matches'))` sin un solo `where`. Con
//  la regla por documento de SEC-A2 (2026-08-25) eso es un 403 completo: en
//  Firestore una consulta se deniega entera si la regla no puede demostrar,
//  solo con los filtros, que todo lo que devuelve es legible.
//
//  🔑 Y SOLO LO SUFRE UN ROL ACOTADO: la regla tiene rama `isSuperAdmin()`, que
//  vale para cualquier documento, asi que al SuperAdmin la consulta sin filtros
//  SI le funciona. Por eso paso desapercibido. Es el patron de v635.
//
//  ⚠️ ESTE BLOQUE EJECUTA EL CODIGO. Un regex que buscara `where(` habria dado
//  verde con el filtro puesto en el campo equivocado, o con el `status` de la
//  lista en vivo copiado por error —que dejaria el Historial sin terminados,
//  un fallo mas silencioso que el 403 que se venia a arreglar—.
console.log('\n── PARTE 5 · el Historial, acotado igual que la lista (v674) ──');
{
    const iniH = LIVE.indexOf('function _historyQueries()');
    const finH = LIVE.indexOf('function _vigilaConRespaldo(');
    ok('5a · _historyQueries y _fetchHistoryMatches existen en live.html',
       iniH !== -1 && finH > iniH,
       'el Historial volveria a pedir la coleccion entera');

    if (iniH !== -1 && finH > iniH) {
        const SRC_H = LIVE.slice(iniH, finH);

        // Entorno con `getDocs` de mentira: recuerda por que se pregunto y
        // permite hacer fallar ramas concretas.
        function entornoHist(userData, saFilter, fallan) {
            const pedidas = [];
            const env = {
                userData,
                window: { _saClubFilter: saFilter || null },
                db: {},
                collection: (_db, nombre) => ({ __col: nombre }),
                where: (campo, op, valor) => ({ campo, op, valor }),
                query: (col, ...conds) => ({ __col: col.__col, conds }),
                getDocs: async (q) => {
                    const clave = q.conds && q.conds.length
                        ? q.conds.map(c => c.campo).sort().join('+')
                        : '__COLECCION_ENTERA__';
                    pedidas.push({ col: q.__col, clave, conds: q.conds || [] });
                    if (fallan && fallan.indexOf(clave) >= 0) {
                        const e = new Error('Missing or insufficient permissions.');
                        e.code = 'permission-denied';
                        throw e;
                    }
                    const docs = (q.conds || []).map((c, i) => ({
                        id: clave + '_' + i,
                        data: () => ({ clubId: 'C1' }),
                    }));
                    return { forEach: (fn) => docs.forEach(fn), empty: !docs.length };
                },
                console: { warn: () => {}, log: () => {} },
                Map, Array, Object, String, Number, Error, Promise,
            };
            vm.createContext(env);
            vm.runInContext(SRC_H, env);
            return { env, pedidas };
        }

        // ── Director Deportivo: el rol del reporte ──
        const dir = { uid: 'U1', role: 'director_deportivo', clubId: 'C1', email: 'd@x.com' };
        const h1 = entornoHist(dir);
        const q1 = vm.runInContext('_historyQueries()', h1.env);
        const claves1 = q1.map(q => q.conds.map(c => c.campo).sort().join('+')).sort();

        ok('5b · 🔴🔴 EL DEFECTO DEL REPORTE: NINGUNA consulta va sin filtros',
           q1.length > 0 && q1.every(q => q.conds && q.conds.length > 0),
           JSON.stringify(claves1));

        ok('5c · son las TRES ramas que autoriza la regla: club, creador y correo',
           claves1.join(' | ') === 'clubId | coachEmail | createdBy',
           claves1.join(' | '));

        ok('5d · y preguntan a live_matches, que es donde vive el historial',
           q1.every(q => q.__col === 'live_matches'),
           q1.map(q => q.__col).join(','));

        // 🔑 La diferencia deliberada con la lista en vivo. Si alguien copia
        //    `_followableQueries` tal cual, el Historial deja de traer los
        //    partidos TERMINADOS —que son su unica razon de ser—.
        ok('5e · ⚠️ NO filtra por `status`: el Historial trae tambien terminados',
           q1.every(q => q.conds.every(c => c.campo !== 'status')),
           'con status==active el Historial solo enseñaria lo que ya se ve en vivo');

        ok('5f · el filtro del club sale de users/{uid}, no del token',
           q1.some(q => q.conds.some(c => c.campo === 'clubId' && c.valor === 'C1')),
           'un director puede no llevar el claim clubId; la regla lo cubre con userDocClubId');

        // ── SuperAdmin: su rama de la regla vale para todo ──
        const sa = { uid: 'S1', role: 'superadmin', clubId: null, email: 's@x.com' };
        const q2 = vm.runInContext('_historyQueries()', entornoHist(sa).env);
        ok('5g · el SuperAdmin sigue viendo la plataforma entera',
           q2.length === 1 && q2[0].conds.length === 0);
        const q3 = vm.runInContext('_historyQueries()', entornoHist(sa, 'C9').env);
        ok('5h · …y su filtro de club se respeta si lo tiene puesto',
           q3.length === 1 && q3[0].conds.length === 1 &&
           q3[0].conds[0].campo === 'clubId' && q3[0].conds[0].valor === 'C9',
           JSON.stringify(q3));

        // ── Una rama denegada no puede tumbar a las demas ──
        (async () => {
            const hFallo = entornoHist(dir, null, ['coachEmail']);
            const res = await vm.runInContext('_fetchHistoryMatches()', hFallo.env);
            ok('5i · 🔑 si una rama se deniega, las otras SI pintan (no Promise.all)',
               Array.isArray(res) && res.length > 0,
               'con Promise.all el primer rechazo devuelve el mismo error rojo');

            const hTodas = entornoHist(dir, null, ['clubId', 'createdBy', 'coachEmail']);
            let lanzo = false;
            try { await vm.runInContext('_fetchHistoryMatches()', hTodas.env); }
            catch (e) { lanzo = true; }
            ok('5j · ⚠️ pero si fallan TODAS, se lanza: no se finge "no hay partidos"',
               lanzo, 'un historial vacio por permisos es peor que un error visible');

            const hSin = entornoHist({ uid: null, role: 'x', clubId: null, email: null });
            const vacio = await vm.runInContext('_fetchHistoryMatches()', hSin.env);
            ok('5k · sin datos de usuario no se pregunta nada (ni se lanza)',
               Array.isArray(vacio) && vacio.length === 0);

            console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
            process.exit(fail ? 1 : 0);
        })();
    } else {
        console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
        process.exit(fail ? 1 : 0);
    }
}

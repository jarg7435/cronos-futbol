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

// Firestore de mentira: `query` devuelve la lista de condiciones tal cual, para
// poder mirar DESPUES por que se ha preguntado.
function nuevoEntorno(userData, saFilter) {
    const listeners = [];   // {cond, onNext, onErr, cancelado}
    const env = {
        userData,
        window: { _saClubFilter: saFilter || null },
        db: {},
        collection: () => ({ __col: 'live_matches' }),
        where: (campo, op, valor) => ({ campo, op, valor }),
        query: (col, ...conds) => ({ __col: col.__col, conds }),
        onSnapshot: (q, onNext, onErr) => {
            const l = { q, onNext, onErr, cancelado: false };
            listeners.push(l);
            return () => { l.cancelado = true; };
        },
        console: { warn: () => {}, log: () => {} },
        pintados: [],
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
}
{
    const { env } = nuevoEntorno({ role: 'superadmin', uid: 'U9', email: 'sa@b.c' });
    const qs = vm.runInContext('_followableQueries()', env);
    ok('1e · el SuperAdmin sin filtro los ve todos, pero solo los ACTIVOS',
       qs.length === 1 && qs[0].conds.length === 1 && qs[0].conds[0].campo === 'status');
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

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

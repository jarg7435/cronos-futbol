// ═══════════════════════════════════════════════════════════════════════════
//  v575 · EL CAMINO CORTO DE LA PIZARRA (posiciones sueltas)
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (4 partidos, PC + iPad): el PRIMER arrastre se sincroniza
//  al instante; al mover fichas en los otros tres, el desfase sube a 8-9 s.
//  Goles, tarjetas, lesiones y cambios siguen inmediatos.
//
//  🔑🔑🔑 CAUSA: para mover una ficha veinte pixeles se enviaba el partido
//  ENTERO (8.668 B). Y las pestanas comparten UNA conexion
//  (`persistentMultipleTabManager`), asi que 4 partidos arrastrando son
//  ~68 KB/s por un solo canal: se forma cola. Un gol NO sufria eso porque
//  viaja por un paquete propio de ~300 B.
//
//  LA SOLUCION: darle a la pizarra su propio paquete pequeno (id, x, y,
//  estado). Este guard mide que de verdad lo sea y protege el invariante que
//  lo hace seguro.
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

const SYNC = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const DRAG = fs.readFileSync(path.join(ROOT, 'js', 'ui', 'drag-drop.js'), 'utf8');

const sinComentarios = (s) => s.split('\n')
    .map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// ═══════ PARTE 1 · el paquete corto es DE VERDAD corto ═══════
console.log('── PARTE 1 · cuanto se envia al mover una ficha ──');
{
    const ini = SYNC.indexOf('function _buildPositions');
    const fin = SYNC.indexOf('const _IDX_TIPOS_NO_VISIBLES');
    ok('1a · existe _buildPositions', ini !== -1 && fin > ini);

    if (ini !== -1 && fin > ini) {
        const sandbox = {};
        vm.createContext(sandbox);
        vm.runInContext(SYNC.slice(ini, fin), sandbox);

        // Los 18 jugadores completos, tal y como viajan hoy en el snapshot.
        const players = [];
        for (let i = 0; i < 18; i++) {
            players.push({
                id: 'p' + i, number: i + 1, name: 'Jugador Apellido ' + i,
                team: i < 9 ? 'home' : 'away',
                status: (i % 9) < 7 ? 'field' : 'bench',
                time: 1200 + i, goals: 0, cards: 'ninguna', injured: false,
                x: 10 + i, y: 20 + i,
                color: '#123456', shortsColor: '#654321', textColor: '#ffffff'
            });
        }
        const pos = sandbox._buildPositions(players);

        ok('1b · lleva un registro por jugador', pos.length === players.length);
        ok('1c · y SOLO id, x, y y estado',
           pos.every(p => Object.keys(p).sort().join(',') === 'i,s,x,y'),
           JSON.stringify(Object.keys(pos[0] || {})));

        const bytesPos  = JSON.stringify(pos).length;
        const bytesPlay = JSON.stringify(players).length;
        const SNAPSHOT_COMPLETO = 8668;   // medido en test_p1_p2_consumo.js
        const factor = SNAPSHOT_COMPLETO / bytesPos;
        console.log('       · snapshot completo: ' + SNAPSHOT_COMPLETO + ' B');
        console.log('       · solo players:      ' + bytesPlay + ' B');
        console.log('       · camino corto:      ' + bytesPos + ' B   (÷' + factor.toFixed(1) + ')');

        // 🔑 EL NUMERO QUE DECIDE SI EL DEFECTO VUELVE. Con 4 partidos
        // arrastrando por una sola conexion, el tamano del paquete ES la cola.
        ok('1d · 🔑 el paquete es al menos 10 veces menor que el snapshot (÷' +
           factor.toFixed(1) + ')',
           factor >= 10,
           'por debajo de eso la cola de 8-9 s con 4 partidos vuelve a formarse');
    }
}

// ═══════ PARTE 2 · el invariante que lo hace seguro ═══════
console.log('\n── PARTE 2 · `positions` nunca puede ser mas viejo que `players` ──');
{
    const S = sinComentarios(SYNC);

    // ⚠️ ESTE ES EL PUNTO DELICADO DE TODO EL CAMBIO. El visor vuelca
    // `positions` sobre `players` SIN comparar fechas. Eso solo es correcto si
    // cada escritura de `players` lleva su `positions` del MISMO array. Si
    // alguien manda `players` sin `positions`, el visor pintaria posiciones
    // ANTIGUAS sobre jugadores nuevos: fichas que "vuelven atras" solas.
    // ⚠️ v576 · EL INVARIANTE NO CAMBIA, PERO SE MUDA DE DOCUMENTO. `positions`
    // ya no va dentro del snapshot del partido: va en el INDICE LIGERO, porque
    // Firestore no envia deltas y tocar el documento gordo (17-23 KB medidos)
    // obligaba a cada espectador a bajarselo entero por cada movimiento.
    // Lo que se sigue exigiendo es lo mismo: que `positions` se escriba en la
    // MISMA operacion que `players` y del MISMO array, para que nunca pueda ser
    // mas viejo y el visor pueda volcarlo sin comparar fechas.
    ok('2a · 🔑 `positions` se construye en el mismo pushLiveSnapshot que `players`',
       /players:\s*players\.map\(_mapPlayerForSnapshot\)/.test(S) &&
       /positions:\s*_buildPositions\(players\)/.test(S),
       'sin esto, el volcado del visor pinta posiciones viejas sobre datos nuevos');

    ok('2b · y viaja en el INDICE LIGERO, no en el documento del partido',
       /_buildLiveIndexDoc[\s\S]{0,4000}?positions:\s*_buildPositions\(players\)/.test(S) &&
       !/const snapshot = \{[\s\S]{0,6000}?positions:\s*_buildPositions/.test(S),
       'en el gordo, cada movimiento hace bajar 23 KB a cada espectador');

    // El camino corto sella la hora o la guarda monotonica del visor (v567)
    // tiraria el snapshot entero por "no ser mas reciente".
    ok('2c · el camino corto escribe en live_index y sella `updatedAt`',
       /doc\(fa\.db, 'live_index', liveMatchId\), \{\s*positions:\s*_buildPositions\(_lista\),[\s\S]{0,300}?updatedAt:\s*serverTimestamp\(\)/.test(S),
       'sin sellar la hora, el visor descarta el movimiento (guarda de v567)');

    // Misma puerta estanca que el latido y los sucesos: escribir posiciones en
    // el documento de otro recolocaria las fichas de otro partido en directo.
    ok('2d · 🔒 respeta la puerta estanca por pestana (v469)',
       /async function _pushPositions[\s\S]{0,1400}?getTabMatchId\(\)[\s\S]{0,400}?return;/.test(S),
       'sin ella, una pestana podria recolocar las fichas del partido de otro');

    // Throttle propio: compartirlo con liveSyncOnAction haria que un arrastre
    // cancelase el volcado completo pendiente de un gol, o al reves.
    ok('2e · tiene throttle PROPIO, no comparte el de liveSyncOnAction',
       /_posThrottleTimer/.test(S) && /_liveSyncThrottleTimer/.test(S) &&
       !/_posThrottleTimer\s*=\s*_liveSyncThrottleTimer/.test(S),
       'compartir timer haria que una via cancelara a la otra');
}

// ═══════ PARTE 3 · un cambio de ESTADO no puede ir por el corto ═══════
console.log('\n── PARTE 3 · banquillo↔campo exige el volcado completo ──');
{
    const S = sinComentarios(SYNC);
    // El paquete corto lleva `s`, pero de `status` salen cosas que NO viajan en
    // el: los contadores onFieldHome/onFieldAway del indice ligero (los "N en
    // campo" de la tarjeta). Con el reloj en marcha lo cubre logMovement; en
    // PAUSA no, y el latido tampoco late (solo late con isRunning): la tarjeta
    // mentiria hasta que el entrenador reanudara.
    ok('3a · 🔑 se detecta el cambio de estado y se manda el completo',
       /_hayCambioDeEstado[\s\S]{0,200}?pushLiveSnapshot\('active'\)/.test(S),
       'en pausa no hay logMovement NI latido: los "N en campo" se quedarian mal');

    ok('3b · la referencia se sella tras un volcado completo con exito',
       /_ultimoEstadoEnviado\[p\.id\]\s*=\s*p\.status/.test(S));

    ok('3c · y se sella DESPUES de escribir, no antes',
       S.indexOf("setDoc(doc(fa.db, 'live_matches', liveMatchId), snapshot") <
       S.indexOf('_ultimoEstadoEnviado[p.id] = p.status'),
       'si la escritura falla, no se puede dar el estado por enviado');
}

// ═══════ PARTE 4 · el visor vuelca las posiciones ═══════
console.log('\n── PARTE 4 · el visor lo aplica en UN solo punto ──');
{
    const ini = LIVE.indexOf('function _aplicaPosiciones');
    const fin = LIVE.indexOf('let _resyncEnCurso');
    ok('4a · existe _aplicaPosiciones en live.html', ini !== -1 && fin > ini);

    if (ini !== -1 && fin > ini) {
        // v576 · `_posicionesVivas` guarda lo ultimo recibido por el listener
        // del indice ligero y vive fuera del recorte. Se aporta en null para
        // probar la rama de respaldo (`data.positions`, partidos de v575) y se
        // fija mas abajo para probar la rama nueva.
        const sandbox = { Map, Array, Object, String, _posicionesVivas: null };
        vm.createContext(sandbox);
        vm.runInContext(LIVE.slice(ini, fin), sandbox);

        const base = {
            players: [
                { id: 'p1', name: 'Ana',  x: 10, y: 10, status: 'field', goals: 2 },
                { id: 'p2', name: 'Bea',  x: 20, y: 20, status: 'field', goals: 0 }
            ],
            positions: [
                { i: 'p1', x: 77, y: 88, s: 'field' }
            ]
        };
        const r = sandbox._aplicaPosiciones(base);

        ok('4b · 🔑 la ficha movida toma la posicion nueva',
           r.players[0].x === 77 && r.players[0].y === 88,
           JSON.stringify({ x: r.players[0].x, y: r.players[0].y }));

        ok('4c · y NO pierde el resto de sus datos (nombre, goles)',
           r.players[0].name === 'Ana' && r.players[0].goals === 2,
           'el paquete corto solo trae posicion: lo demas sale de `players`');

        ok('4d · un jugador sin entrada en `positions` se queda igual',
           r.players[1].x === 20 && r.players[1].y === 20);

        // ⚠️ `data` lo comparten lastSnapshot y _matchLastData: mutarlo en su
        // sitio les dejaria un objeto que cambia bajo sus pies.
        ok('4e · no muta el documento original (copia superficial)',
           base.players[0].x === 10,
           'mutar `data` afecta a lastSnapshot y a _matchLastData');

        // Partidos anteriores a v575 y el respaldo por `liveSyncOnAction`
        // siguen trayendo la posicion DENTRO de `players`.
        const sinPos = { players: [{ id: 'p1', x: 5, y: 5, status: 'field' }] };
        const r2 = sandbox._aplicaPosiciones(sinPos);
        ok('4f · sin `positions` no toca nada (partidos de antes de v575)',
           r2.players[0].x === 5 && r2 === sinPos,
           'devolver el mismo objeto mantiene intacto el camino de siempre');

        // 🔑 v576 · LA VIA QUE USA EL VISOR DE VERDAD. Las posiciones ya no
        // vienen dentro del documento del partido: llegan por el listener del
        // indice ligero y se guardan en `_posicionesVivas`. Si esta rama se
        // rompiera, las fichas volverian a moverse solo con el latido.
        sandbox._posicionesVivas = [{ i: 'p1', x: 33, y: 44, s: 'field' }];
        const r3 = sandbox._aplicaPosiciones({
            players: [{ id: 'p1', name: 'Ana', x: 5, y: 5, status: 'field' }]
        });
        ok('4h · 🔑 aplica las posiciones que llegaron por el indice ligero',
           r3.players[0].x === 33 && r3.players[0].y === 44,
           'es el canal real desde v576: ' + JSON.stringify(r3.players[0]));

        // Y manda sobre lo que traiga el documento gordo, que siempre es igual
        // de viejo o mas (el indice se escribe en el mismo pushLiveSnapshot).
        const r4 = sandbox._aplicaPosiciones({
            players:   [{ id: 'p1', name: 'Ana', x: 5, y: 5, status: 'field' }],
            positions: [{ i: 'p1', x: 1, y: 1, s: 'field' }]
        });
        ok('4i · y mandan sobre las que viniesen dentro del partido',
           r4.players[0].x === 33,
           'el indice nunca es mas viejo que el gordo: debe ganar');
        sandbox._posicionesVivas = null;
    }

    // Los DOS puntos por los que entra el documento del partido en el visor.
    const entradas = (LIVE.match(/_aplicaPosiciones\(/g) || []).length - 1; // -1: la definicion
    ok('4g · se aplica en los dos puntos de entrada del documento (' + entradas + ')',
       entradas >= 2,
       'el onSnapshot del detalle Y la relectura de _resincronizaVista');
}

// ═══════ PARTE 5 · la pizarra usa el corto, con respaldo ═══════
console.log('\n── PARTE 5 · el cableado del arrastre ──');
{
    const D = sinComentarios(DRAG);
    ok('5a · la pizarra llama al camino corto',
       /liveSyncPositions\(\)/.test(D));

    // ⚠️ Si liveSyncPositions no existiera (sync.js viejo servido de cache), la
    // pizarra volveria a quedarse MUDA — el defecto de v574 — en vez de caer al
    // camino largo, que es lento pero correcto.
    ok('5b · 🔑 con respaldo al camino largo si no existiera',
       /typeof liveSyncPositions === 'function'\) liveSyncPositions\(\);\s*else if \(typeof liveSyncOnAction === 'function'\) liveSyncOnAction\(\);/.test(D),
       'sin respaldo, un sync.js viejo dejaria la pizarra muda otra vez');

    ok('5c · sigue sin usar el volcado inmediato por gesto',
       !/liveSyncFlushNow/.test(D),
       'arrastrar produce rafagas: un flush por gesto machacaria el documento');

    // ⛔ `tactical_move` NO se toca: lo consume la Repeticion para animar el
    // movimiento (replay-player.js:145 y :848). Se evaluo quitarlo como P3 y se
    // descarto porque rompe "Revivir".
    ok('5d · ⛔ el suceso tactical_move sigue registrandose (lo usa la Repeticion)',
       /_registerMatchEvent\('tactical_move'/.test(D),
       'quitarlo romperia la animacion de movimiento de Revivir');
    const REPLAY = fs.readFileSync(path.join(ROOT, 'js', 'match', 'replay', 'replay-player.js'), 'utf8');
    ok('5e · y la Repeticion sigue consumiendolo',
       /ev\.type === 'tactical_move'/.test(REPLAY));
}

// ═══════ PARTE 6 · los tacticos ya no escriben en caliente ═══════
console.log('\n── PARTE 6 · la SEGUNDA escritura por arrastre, agrupada ──');
{
    const ACTIONS = fs.readFileSync(path.join(ROOT, 'js', 'match', 'events', 'player-actions.js'), 'utf8');
    const A = sinComentarios(ACTIONS);
    const S = sinComentarios(SYNC);

    // 🔑 Cada arrastre hacia DOS escrituras al documento gordo: las posiciones
    // y el suceso `tactical_move` (75-90% de los sucesos, medido en los
    // partidos reales). Como Firestore no manda deltas, cada una obligaba a
    // bajar 17-23 KB a cada espectador. La primera ya se mudo al indice; esta
    // se agrupa y viaja con el latido.
    ok('6a · 🔑 los tactical_move se aparcan en vez de escribirse uno a uno',
       /if \(type === 'tactical_move'\)[\s\S]{0,300}?_cronosTacticalPending\.push\(eventEntry\)/.test(A),
       'escribirlos en caliente hace bajar el partido entero por cada arrastre');

    ok('6b · con tope de seguridad (en pausa no hay latido que los vacie)',
       /_cronosTacticalPending\.length <= \d+\)\s*return;/.test(A),
       'sin tope, con el reloj parado el aparcamiento crece sin fin');

    ok('6c · el latido los vacia en UNA escritura agrupada',
       /snapshot\.events = arrayUnion\.apply\(null, _tacticasPendientes\)/.test(S),
       'es gratis: aprovecha una escritura que ya se iba a hacer');

    // ⚠️ v246 prohibe mandar `events` desde el snapshot… con un ARRAY PLANO,
    // porque `setDoc merge` REEMPLAZA arrays y borraria el historial. Con
    // `arrayUnion` se ANADE. Si alguien lo cambia por un array plano, se lleva
    // por delante todos los sucesos del partido.
    ok('6d · 🔑 y con arrayUnion, NUNCA con un array plano',
       !/snapshot\.events\s*=\s*\[/.test(S),
       'un array plano en setDoc merge borraria el historial entero del partido');

    ok('6e · el vaciado ocurre DESPUES de escribir con exito',
       S.indexOf('await setDoc(doc(fa.db, \'live_matches\', liveMatchId), snapshot') <
       S.indexOf('window._cronosTacticalPending =\n'.trim()),
       'vaciar antes perderia los movimientos si la escritura falla');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

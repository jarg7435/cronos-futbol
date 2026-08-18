// ═══════════════════════════════════════════════════════════════════════════
//  v574 · LA PIZARRA SINCRONIZA AL INSTANTE, NO AL LATIDO
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor tras la prueba de campo con 4 partidos: "mover una ficha
//  o intercambiar dos tarda VARIOS SEGUNDOS; el resto de la app va inmediato".
//
//  🔑🔑🔑 `js/ui/drag-drop.js` no sincronizaba NUNCA: ni una llamada a
//  `liveSyncOnAction` en todo el fichero. La posicion de un jugador solo salia
//  al visor cuando pasaba el LATIDO y `pushLiveSnapshot` reenviaba `players`.
//
//  ⚠️⚠️ EL DEFECTO YA EXISTIA, pero P1 (latido 5 s -> 15 s) TRIPLICO la espera
//  y lo saco del umbral de lo tolerable. Es la leccion que vigila este fichero:
//  **una optimizacion puede convertir un defecto tolerado en uno visible**, y
//  por eso el guard ata las dos cosas — la sincronizacion de la pizarra Y su
//  relacion con el latido.
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

const DRAG = fs.readFileSync(path.join(ROOT, 'js', 'ui', 'drag-drop.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');

// Sin comentarios: un guard no puede darse por satisfecho con una mencion.
const codigo = DRAG.split('\n')
    .map(l => l.replace(/^\s*\/\/.*$/, ''))
    .filter(l => !/^\s*\/\/ /.test(l))
    .join('\n');

console.log('── PARTE 1 · la pizarra avisa al motor de sincronizacion ──');
{
    ok('1a · drag-drop.js llama a liveSyncOnAction',
       /liveSyncOnAction\(\)/.test(codigo),
       'sin esto, mover una ficha espera al siguiente latido');

    ok('1b · con guard typeof (este fichero puede cargar antes que sync.js)',
       /typeof liveSyncOnAction === 'function'/.test(codigo),
       'un ReferenceError aqui abortaria el drop y dejaria la ficha a medias');

    // ⚠️ NO se usa liveSyncFlushNow: arrastrar produce rafagas y un volcado por
    // gesto machacaria el documento (1 escritura sostenida/s por documento).
    ok('1c · usa el throttle (liveSyncOnAction), no un volcado por gesto',
       !/liveSyncFlushNow/.test(codigo),
       'un flush por arrastre se saltaria el limite sano de escrituras');
}

console.log('\n── PARTE 2 · NINGUNA salida se queda sin sincronizar ──');
{
    // 🔑 El defecto real no fue "falta una llamada", fue "faltan TODAS". Aqui se
    // comprueba que no queda ni un camino de mutacion que repinte sin avisar:
    // basta con que UNO se escape para que ese gesto vuelva a tardar 15 s.
    const cuerpo = codigo.slice(codigo.indexOf('function _repintaPizarra'));
    const defs = (codigo.match(/function _repintaPizarra\(\)/g) || []).length;
    ok('2a · existe el helper unico _repintaPizarra', defs === 1,
       'hay ' + defs + ' definiciones');

    // Dentro del helper SI tiene que estar el renderPlayers() de verdad.
    ok('2b · el helper repinta de verdad (y no se llama a si mismo)',
       /function _repintaPizarra\(\)\s*\{\s*renderPlayers\(\);/.test(codigo),
       'una recursion aqui revienta la pila en cada arrastre');

    // Fuera del helper no puede quedar ningun renderPlayers() suelto: seria una
    // salida que repinta la ficha en local y no la manda a ninguna parte.
    const sueltos = (cuerpo.match(/renderPlayers\(\)/g) || []).length - 1; // -1: el del propio helper
    ok('2c · 🔑 ninguna salida repinta sin sincronizar',
       sueltos === 0,
       'quedan ' + sueltos + ' renderPlayers() sueltos en caminos de arrastre');

    const salidas = (codigo.match(/_repintaPizarra\(\)/g) || []).length - 1; // -1: la definicion
    ok('2d · las salidas de arrastre pasan todas por el helper (' + salidas + ')',
       salidas >= 5,
       'dropToField, handleBenchDrop (x3) y handleSmartSwap');
}

console.log('\n── PARTE 3 · los dos casos que reporto el autor ──');
{
    // Se ejecuta el codigo REAL de handleSmartSwap para comprobar que una
    // PERMUTA EN CAMPO —el "intercambio de fichas" del reporte— ya no depende
    // de logMovement, que v425 excluye a proposito para no inventar un cambio.
    const ini = codigo.indexOf('function handleSmartSwap');
    const fin = codigo.indexOf('function logMovement');
    ok('3a · se encuentra handleSmartSwap', ini !== -1 && fin > ini);

    if (ini !== -1 && fin > ini) {
        let sincronizaciones = 0, movimientos = 0;
        const sandbox = {
            isRunning: true,
            players: [],
            liveSyncOnAction: () => { sincronizaciones++; },
            logMovement: () => { movimientos++; },
            logTacticalMove: () => {},
            clampToField: (x, y) => ({ x, y }),
            sortBenchUI: () => {},
            renderPlayers: () => {},
            alert: () => {},
            Date, Math, console: { warn(){}, log(){} }
        };
        // El helper vive fuera del recorte: se aporta con el mismo cuerpo.
        vm.createContext(sandbox);
        vm.runInContext(
            'function _repintaPizarra(){ renderPlayers();' +
            ' if (typeof liveSyncOnAction === "function") liveSyncOnAction(); }\n' +
            codigo.slice(ini, fin), sandbox);

        // Dos jugadores AMBOS en el campo: permuta pura, no es sustitucion.
        const a = { id: 1, team: 'home', status: 'field', x: 10, y: 10, cards: 'ninguna' };
        const b = { id: 2, team: 'home', status: 'field', x: 50, y: 50, cards: 'ninguna' };
        sandbox.players = [a, b];
        sandbox.handleSmartSwap(a, b);

        ok('3b · la permuta en campo intercambia de verdad las posiciones',
           a.x === 50 && b.x === 10, 'a.x=' + a.x + ' b.x=' + b.x);

        ok('3c · 🔑 y NO la registra como sustitucion (v425 sigue en pie)',
           movimientos === 0,
           'una permuta no es un cambio: nadie entra y nadie sale');

        // 🔑 EL NUCLEO DEL REPORTE. Antes de v574 este caso no avisaba a nadie:
        // ni logMovement (excluido arriba) ni la propia pizarra. La ficha se
        // quedaba esperando al latido — hasta 15 s desde P1.
        // handleSmartSwap no repinta en su camino normal; lo hace su llamador
        // dropToField, asi que la sincronizacion llega por _repintaPizarra.
        const llamadorSincroniza =
            /if \(targetPlayer\) \{\s*handleSmartSwap\([^)]*\);\s*\}[\s\S]{0,2000}?_repintaPizarra\(\);/.test(codigo);
        ok('3d · 🔑 tras la permuta, el llamador sincroniza sin esperar al latido',
           llamadorSincroniza,
           'dropToField tiene que terminar en _repintaPizarra() tambien cuando ' +
           'hubo swap, o el intercambio de fichas sigue tardando segundos');
    }
}

console.log('\n── PARTE 4 · el vinculo con P1 que causo el sintoma ──');
{
    // Este bloque existe para dejar constancia de POR QUE se noto ahora. Si
    // alguien vuelve a subir el latido, la espera de la pizarra crece con el —
    // salvo que la pizarra siga sincronizando por su cuenta, que es lo que
    // garantiza la PARTE 1.
    const m = SYNC.match(/const\s+LIVE_HEARTBEAT_MS\s*=\s*(\d+)\s*;/);
    const latido = m ? parseInt(m[1], 10) : 0;
    ok('4a · el latido sigue siendo el de P1 (' + latido + ' ms)', latido === 15000);

    ok('4b · 🔑 y la pizarra ya NO depende de el',
       /liveSyncOnAction\(\)/.test(codigo),
       'con el latido a 15 s, depender de el son 15 s de espera por gesto');

    // El throttle de liveSyncOnAction acota la espera real de la pizarra.
    const t = SYNC.match(/_liveSyncThrottleTimer = setTimeout\([\s\S]{0,220}?\},\s*(\d+)\)/);
    const espera = t ? parseInt(t[1], 10) : 0;
    ok('4c · la espera de la pizarra queda en ' + espera + ' ms, no en ' + latido,
       espera > 0 && espera <= 1000,
       'liveSyncOnAction tiene que agrupar rafagas sin llegar a notarse');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

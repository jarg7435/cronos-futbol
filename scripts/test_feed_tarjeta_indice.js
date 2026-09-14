// ═══════════════════════════════════════════════════════════════════════════
//  v578 · EL MINI-FEED DE LA TARJETA LEE DEL INDICE LIGERO
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (captura 9246): en el panel general, la seccion ULTIMOS
//  SUCESOS de cada tarjeta salia "Sin sucesos todavia" aunque el partido
//  llevara goles y fuera por la 2a parte. Los avisos flotantes SI sonaban.
//
//  🔑 ESA ASIMETRIA ERA EL DIAGNOSTICO: si los avisos funcionan, el dato SI
//  llega; lo que falla es quien lo lee. P2 (v572) mudo la lista a `live_index`
//  —que trae los sucesos en `lastEvents`—, `detectAndAlert` se adapto para
//  aceptar los dos nombres, y ESTE SEGUNDO CONSUMIDOR se quedo mirando un
//  `events` que en el indice no existe.
//
//  🔑 LA LECCION QUE VIGILA ESTE FICHERO: migrar una fuente de datos obliga a
//  repasar TODOS sus consumidores. Aqui se ejecuta el feed REAL contra un
//  documento de indice REAL (el que produce `_buildLiveIndexDoc`), que es la
//  unica forma de que no se vuelva a escapar uno.
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
const SYNC = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const ACTIONS = fs.readFileSync(path.join(ROOT, 'js', 'match', 'events', 'player-actions.js'), 'utf8');

// ═══════ PARTE 1 · el emisor mete los sucesos en el indice ═══════
console.log('── PARTE 1 · que forma tiene un suceso en el indice ──');
let recortado = null;
{
    const ini = SYNC.indexOf('function _recortaSuceso');
    const fin = SYNC.indexOf('const _IDX_TIPOS_NO_VISIBLES');
    ok('1a · existe _recortaSuceso', ini !== -1 && fin > ini);

    if (ini !== -1 && fin > ini) {
        const sandbox = { window: {} };
        vm.createContext(sandbox);
        vm.runInContext(SYNC.slice(ini, fin), sandbox);

        // Una SUSTITUCION, que es el caso que mas campos necesita.
        recortado = sandbox._recortaSuceso({
            eventId: 'ev1', matchId: 'M1', type: 'sub',
            text: 'ALEVIN C | ▲ SALE: Ana | ▼ ENTRA: Bea',
            icon: '🔄', matchTime: '2T 12:00', team: 'home',
            createdAt: 1000, subOutName: 'Ana', subInName: 'Bea',
            // ruido que NO debe viajar al indice
            realTime: '19:12:00', timestamp: '2026-08-18T17:12:00.000Z'
        }, 'M1');

        ok('1b · 🔑 lleva los nombres de la sustitucion',
           recortado.subOutName === 'Ana' && recortado.subInName === 'Bea',
           'sin ellos la tarjeta ensena el texto crudo en vez de "Sale X · Entra Y"');

        // ⚠️ El SDK de Firestore LANZA con un valor `undefined`, y este proyecto
        // no usa ignoreUndefinedProperties. Un solo campo opcional escrito
        // siempre reventaria la escritura del indice en cada suceso sin ellos.
        const conUndefined = Object.keys(recortado).filter(k => recortado[k] === undefined);
        ok('1c · ⚠️ ni un solo `undefined` en el objeto',
           conUndefined.length === 0,
           'Firestore LANZA con undefined: ' + conUndefined.join(', '));

        const simple = sandbox._recortaSuceso({ eventId: 'ev2', type: 'goal', text: 'GOL' }, 'M1');
        ok('1d · y los opcionales NO se inventan cuando no vienen',
           !('subInName' in simple) && !('playerName' in simple),
           Object.keys(simple).join(','));

        ok('1e · una sola definicion: player-actions la reutiliza, no la copia',
           /window\._cronosRecortaSuceso/.test(ACTIONS) &&
           !/lastEvents:\s*fs\.arrayUnion\(\{/.test(ACTIONS),
           'dos copias de la misma forma acaban divergiendo (v532)');
    }
}

// ═══════ PARTE 2 · el feed de la tarjeta lo lee ═══════
console.log('\n── PARTE 2 · la tarjeta pinta esos sucesos ──');
{
    // Se ejecuta el feed REAL. ⚠️ v706 · ya no se extrae de live.html: la
    // lógica se mudó a js/shared/live-feed.js para que el Área de Familias
    // pinte el MISMO bloque sin copiarlo (ver la nota de ese fichero). El
    // guard hace lo mismo que antes; sólo cambia de dónde lo carga.
    const FEED = fs.readFileSync(path.join(ROOT, 'js', 'shared', 'live-feed.js'), 'utf8');
    const _sbMod = { window: {}, console: { log() {}, warn() {} } };
    vm.createContext(_sbMod);
    vm.runInContext(FEED, _sbMod);
    const API = _sbMod.window.cronosLiveFeed;
    ok('2a · el módulo del feed se carga y expone la selección',
       !!API && typeof API.items === 'function');

    if (API && recortado) {
        const sandbox = {
            _liveFeedItems: API.items,
            _liveFeedTexto: API.texto,
        };

        const gol = {
            eventId: 'ev9', matchId: 'M1', type: 'goal',
            text: 'ALEVIN C · GOL · Carla', matchTime: '2T 20:00',
            team: 'home', createdAt: 2000
        };

        // 🔑 EL CASO DEL REPORTE: un documento de INDICE, con `lastEvents` y
        // SIN `events`. Antes de v578 esto devolvia [] y la tarjeta decia
        // "Sin sucesos todavia" con el partido lleno de goles.
        const docIndice = { idx: true, lastEvents: [recortado, gol],
                            homeTeam: { name: 'Alevin C' }, awayTeam: { name: 'Rival' } };
        const items = sandbox._liveFeedItems(docIndice, 3);
        ok('2b · 🔑 con un documento de INDICE, la tarjeta tiene sucesos',
           items.length === 2,
           'devolvio ' + items.length + ' — es el fallo de la captura 9246');

        ok('2c · y el mas reciente va primero',
           items[0] && items[0].eventId === 'ev9',
           JSON.stringify(items.map(i => i.eventId)));

        // El documento gordo sigue funcionando igual: el visor de detalle y el
        // respaldo por escaneo completo leen `events`.
        const docGordo = { events: [gol], players: [] };
        ok('2d · y con el documento del partido (`events`) sigue funcionando',
           sandbox._liveFeedItems(docGordo, 3).length === 1);

        // `tactical_move` no puede colarse: su `text` es un JSON de coordenadas.
        const conTactico = { lastEvents: [gol, { type: 'tactical_move', text: '{"x":1}', createdAt: 3000 }] };
        ok('2e · los movimientos tacticos siguen sin colarse en el feed',
           sandbox._liveFeedItems(conTactico, 3).every(e => e.type !== 'tactical_move'),
           'su texto es un JSON de coordenadas, no una frase');

        // Y la linea se pinta legible con lo que trae el indice.
        const linea = sandbox._liveFeedTexto(recortado);
        ok('2f · 🔑 la sustitucion se lee "Sale X · Entra Y", no el texto crudo',
           linea === 'Sale Ana · Entra Bea',
           'salio: ' + linea);
    }
}

// ═══════ PARTE 3 · los DOS consumidores del panel, alineados ═══════
console.log('\n── PARTE 3 · nadie mas se queda mirando `events` ──');
{
    // 🔑 El defecto fue que un consumidor se quedo atras al migrar la fuente.
    // Aqui se comprueba que los DOS que comen del panel general aceptan las dos
    // formas. Si manana aparece un tercero, que este guard lo obligue a entrar.
    ok('3a · los avisos flotantes aceptan `lastEvents`',
       /Array\.isArray\(matchData\.events\)[\s\S]{0,220}?matchData\.lastEvents/.test(LIVE),
       'detectAndAlert es el consumidor que SI funcionaba');

    // ⚠️ v706 · el mini-feed se mide en js/shared/live-feed.js, que es donde
    // vive desde que lo comparten live.html y el Area de Familias.
    const FEED2 = fs.readFileSync(path.join(ROOT, 'js', 'shared', 'live-feed.js'), 'utf8');
    ok('3b · 🔑 y el mini-feed de la tarjeta tambien',
       /Array\.isArray\(m && m\.events\)[\s\S]{0,260}?m\.lastEvents/.test(FEED2),
       'era el que se quedo atras: "Sin sucesos todavia" con el partido en juego');

    // 🔑 Y EL TERCER CONSUMIDOR, el que el reporte de v706 encontro a oscuras:
    // la tarjeta del Area de Familias. Que no vuelva a quedarse fuera.
    const PP2 = fs.readFileSync(path.join(ROOT, 'js', 'parent', 'panel.js'), 'utf8');
    ok('3c · 🔑 y la tarjeta del Area de Familias pinta con el MISMO modulo',
       /cronosLiveFeed\.html\(m\)/.test(PP2),
       'capturas 10347/10348: el panel de familias no ensenaba ningun suceso');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

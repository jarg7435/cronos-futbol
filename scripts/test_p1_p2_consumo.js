// ═══════════════════════════════════════════════════════════════════════════
//  v572 · P1 (latido 15 s) + P2 (indice ligero `live_index`)
// ═══════════════════════════════════════════════════════════════════════════
//  POR QUE ESTE TEST EXISTE. Estos dos cambios no tienen sintoma visible: si
//  alguien devuelve el latido a 5 s, o vuelve a meter `players` en el indice, o
//  reapunta la lista a `live_matches`, la aplicacion sigue funcionando
//  EXACTAMENTE igual. Solo cambia la factura y los megas del movil del
//  espectador. Un defecto que no se ve solo lo puede cazar un guard.
//
//  Medido antes de v572 (prueba de estres del 17/08/2026 y los 10 partidos del
//  respaldo): documento medio de 10.625 B entregado cada 5 s a cada espectador
//  por CADA partido activo de su club -> 375 MB por espectador en una manana de
//  15 partidos, y 74.000 lecturas en un dia de pruebas con 7.
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

const SYNC    = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const LIVE    = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const ACTIONS = fs.readFileSync(path.join(ROOT, 'js', 'match', 'events', 'player-actions.js'), 'utf8');
const FUNCS   = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
const RULES   = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const INDEXES = fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8');

// Quita los comentarios de linea para que ningun guard pueda darse por
// satisfecho con una mencion en un comentario en vez de con codigo real.
const sinComentarios = (s) => s.split('\n')
    .map(l => l.replace(/^\s*\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
    .join('\n');

// ═══════════════ PARTE 1 · P1, el latido ═══════════════
console.log('── PARTE 1 · P1: el latido pasa de 5 s a 15 s ──');
{
    const m = SYNC.match(/const\s+LIVE_HEARTBEAT_MS\s*=\s*(\d+)\s*;/);
    ok('1a · existe la constante LIVE_HEARTBEAT_MS', !!m);

    const latido = m ? parseInt(m[1], 10) : 0;
    ok('1b · el latido es de 15 s (÷3 de lecturas y de bytes)',
       latido === 15000, 'vale ' + latido + ' ms');

    // El setInterval tiene que USAR la constante. Con el 5000 escrito a mano la
    // constante seria decoracion y el latido seguiria siendo el de antes.
    ok('1c · el setInterval usa la constante, no un numero suelto',
       /setInterval\(\s*\(\)\s*=>\s*\{[\s\S]{0,160}?\},\s*LIVE_HEARTBEAT_MS\s*\)/.test(SYNC),
       'el intervalo del latido tiene que leer LIVE_HEARTBEAT_MS');

    ok('1d · el latido sigue latiendo SOLO con el reloj en marcha',
       /if\s*\(liveIsActive\s*&&\s*isRunning\)\s*pushLiveSnapshot/.test(SYNC),
       'en pausa y en el descanso no se paga nada: es la mitad del ahorro');

    // ⚠️ EL ACOPLAMIENTO QUE HABRIA ROTO P1 EN SILENCIO.
    // live.html da un canal por muerto si pasa demasiado tiempo sin snapshots y
    // entonces RELEE la vista entera (`_resincronizaVista` -> getDocs de todos
    // los partidos seguidos). Estaba en 25 s porque el latido era de 5 s. Con
    // 15 s de latido, 25 s se alcanzan con jitter de red normal: el watchdog se
    // dispararia en bucle en CADA espectador. Seria una tormenta de lecturas,
    // justo lo contrario de lo que P1 busca.
    const w = LIVE.match(/const\s+_MS_SIN_SNAPSHOT_SOSPECHOSO\s*=\s*(\d+)\s*;/);
    const umbral = w ? parseInt(w[1], 10) : 0;
    ok('1e · 🔑 el watchdog de canal muerto deja pasar al menos 3 latidos (' +
       umbral + ' ms vs ' + latido + ' ms)',
       !!w && latido > 0 && umbral >= latido * 3,
       'con el umbral por debajo de 3 latidos, un canal VIVO se declara muerto ' +
       'y se relee todo en bucle: una tormenta de lecturas');
}

// ═══════════════ PARTE 2 · P2, que lleva el indice ═══════════════
console.log('\n── PARTE 2 · P2: el indice ligero, medido ──');
{
    // Se ejecuta el constructor REAL sobre un partido realista y se mide.
    const ini = SYNC.indexOf('const _IDX_TIPOS_NO_VISIBLES');
    const fin = SYNC.indexOf('async function _pushLiveIndex');
    ok('2a · se encuentra el constructor _buildLiveIndexDoc', ini !== -1 && fin > ini);

    if (ini !== -1 && fin > ini) {
        const sandbox = { window: {}, console: { warn(){} } };
        vm.createContext(sandbox);
        vm.runInContext(SYNC.slice(ini, fin), sandbox);

        // Partido realista: 18 jugadores y 25 sucesos, el perfil del documento
        // MAYOR de los 10 del respaldo (16.144 B). De los 25 sucesos, 11 son
        // `tactical_move`, que es la proporcion medida (45%).
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
        const eventos = [];
        for (let i = 0; i < 25; i++) {
            eventos.push({
                eventId: 'ev_abcdefgh_' + i, matchId: 'partido-18082026-ab12-1030',
                type: (i % 25 < 11) ? 'tactical_move' : 'goal',
                text: 'GOL · Jugador Apellido ' + i + ' (dorsal ' + i + ')',
                icon: '⚽', realTime: '11:2' + (i % 10) + ':30', matchTime: '1T 2' + (i % 10) + ':00',
                timestamp: '2026-08-18T11:20:30.000Z', createdAt: 1755511230000 + i,
                team: i % 2 ? 'home' : 'away'
            });
        }
        sandbox.window._cronosMatchEvents = eventos;

        const snapshot = {
            id: 'partido-18082026-ab12-1030', status: 'active', updatedAt: 'SENTINEL',
            createdBy: 'uid_1234567890', coachEmail: 'entrenador@club.example',
            clubId: 'club_abc', clubName: 'Club Deportivo Ejemplo',
            teamId: 'club_abc__alevin__a',
            category: 'alevin', subcategory: 'a',
            matchCategory: 'f7_alevin', matchSubcategory: 'a',
            mode: 'f7', phase: '1st_half', isRunning: true,
            timeH1: 1200, timeH2: 0, half1MaxTime: 1800, half2MaxTime: 1800,
            phaseStartedAt: 1755511230000, semaforoActive: true,
            timerThresholds: { red: 33, yellow: 50 },
            formation: '2-3-1', myTeamRole: 'home',
            homeTeam: { name: 'Club Deportivo Ejemplo', score: 2, color: '#123456', shorts: '#654321', textColor: '#fff' },
            awayTeam: { name: 'Rival Futbol Club', score: 1, color: '#abcdef', shorts: '#fedcba', textColor: '#000' },
            players: players,
            initialPlayers: players,
            initialFormation: '2-3-1'
        };

        const idx = sandbox._buildLiveIndexDoc(snapshot, players);

        // ── Lo que NO puede llevar ────────────────────────────────────────
        // Aqui esta el ahorro entero. `players` son 3.330 B que viajaban en
        // CADA latido a CADA espectador solo para que la tarjeta pudiera contar
        // cuantos hay en campo; `events` crece sin tope y la lista ni lo mira.
        ok('2b · 🔑 el indice NO lleva `players` (3.330 B por latido)',
           idx.players === undefined,
           'si vuelve a entrar, P2 deja de ahorrar practicamente nada');
        ok('2c · 🔑 el indice NO lleva el historial `events` completo',
           idx.events === undefined,
           'crece sin tope durante el partido');
        ok('2d · ni la alineacion inicial (solo la usa la repeticion)',
           idx.initialPlayers === undefined && idx.initialFormation === undefined);

        // ── Lo que SI tiene que llevar ────────────────────────────────────
        // Si falta uno de estos, la lista pinta mal o las alertas no suenan.
        const necesarios = [
            'id', 'status', 'updatedAt',                        // identidad
            'clubId', 'createdBy', 'coachEmail',                // _followableQueries
            'phase', 'isRunning', 'timeH1', 'timeH2',           // reloj
            'half1MaxTime', 'half2MaxTime', 'phaseStartedAt',
            'mode', 'semaforoActive', 'timerThresholds',        // semaforo
            'matchCategory', 'matchSubcategory',                // etiqueta
            'homeTeam', 'awayTeam',                             // marcador
            'onFieldHome', 'onFieldAway',                       // los "N en campo"
            'lastEvents'                                        // alertas
        ];
        const faltan = necesarios.filter(k => idx[k] === undefined);
        ok('2e · lleva todo lo que consumen la lista y las alertas',
           faltan.length === 0, 'faltan: ' + faltan.join(', '));

        ok('2f · 🔑 los "N en campo" vienen ya contados, sin mandar `players`',
           idx.onFieldHome === 7 && idx.onFieldAway === 7,
           'home=' + idx.onFieldHome + ' away=' + idx.onFieldAway);

        ok('2g · la marca `idx` va puesta (corta la via delta en el visor)',
           idx.idx === true,
           'sin ella un indice sin sucesos caeria en la deteccion por delta, ' +
           'que compara `players` — y aqui no hay `players`');

        // ── Los sucesos, recortados ───────────────────────────────────────
        ok('2h · 🔑 `tactical_move` NO entra en el indice (45% de los sucesos)',
           idx.lastEvents.every(e => e.type !== 'tactical_move'),
           'no se anuncia nunca: pagar por el es tirar casi la mitad del tamano');

        ok('2i · solo viajan los ultimos sucesos, no los 25',
           idx.lastEvents.length > 0 && idx.lastEvents.length <= 3,
           'van ' + idx.lastEvents.length);

        ok('2j · cada suceso conserva lo que necesita el aviso',
           idx.lastEvents.every(e =>
               e.eventId !== undefined && e.type !== undefined &&
               e.text !== undefined && e.matchTime !== undefined &&
               e.team !== undefined),
           'sin eventId no hay dedup; sin team no hay chip de equipo');

        // ── LA MEDIDA ─────────────────────────────────────────────────────
        // No es exactamente la facturacion de Firestore (que mide por tipo de
        // campo, no por JSON), pero la proporcion entre los dos documentos —que
        // es lo que decide la factura y los megas— si es representativa.
        //
        // ⚠️ SE MIDE LO QUE EL ESPECTADOR RECIBE, NO LO QUE EL EMISOR MANDA.
        // `pushLiveSnapshot` NO envia `events` a proposito (los escribe
        // `_registerMatchEvent` con arrayUnion, para no pisar el array), pero el
        // documento ALMACENADO si los tiene, y un `onSnapshot` entrega el
        // documento ENTERO en cada latido. Medir el objeto del emisor dejaba
        // fuera los 25 sucesos —7.600 B, casi la mitad del peso real— y hacia
        // parecer a P2 mucho menos rentable de lo que es. El documento asi
        // medido (16 KB) coincide con el mayor de los 10 del respaldo.
        const docEntregado = Object.assign({}, snapshot, { events: eventos });
        const bytesGordo = JSON.stringify(docEntregado).length;
        const bytesIdx   = JSON.stringify(idx).length;
        const factor     = bytesGordo / bytesIdx;
        console.log('       · documento de partido: ' + bytesGordo + ' B');
        console.log('       · indice ligero:        ' + bytesIdx + ' B');
        console.log('       · reduccion:            ÷' + factor.toFixed(1));
        ok('2k · 🪶 el indice es al menos 8 veces mas pequeno (÷' + factor.toFixed(1) + ')',
           factor >= 8,
           'con ÷' + factor.toFixed(1) + ' P2 no compensa la escritura extra que cuesta');
    }
}

// ═══════════════ PARTE 3 · el indice no puede tumbar el partido ═══════════════
console.log('\n── PARTE 3 · un fallo del indice NO puede cortar el directo ──');
{
    const S = sinComentarios(SYNC);

    // ⚠️ ESTO ES LO MAS IMPORTANTE DE TODO EL FICHERO.
    // Si el indice se escribiera en el MISMO writeBatch que el partido, un fallo
    // suyo —reglas sin desplegar, un indice compuesto que falta, cuota— tumbaria
    // el latido del partido. Una optimizacion no puede poder cortar un directo.
    ok('3a · 🔑 el indice NO se escribe en un writeBatch con el partido',
       !/writeBatch/.test(S),
       'un batch es atomico: si cae el indice, cae el latido del partido');

    ok('3b · 🔑 la escritura del indice tiene su propio catch',
       /async function _pushLiveIndex[\s\S]{0,600}?catch\s*\(/.test(S),
       'sin catch propio, su error sube a pushLiveSnapshot y se lleva el latido');

    ok('3c · el indice se escribe DESPUES del documento del partido',
       S.indexOf("setDoc(doc(fa.db, 'live_matches', liveMatchId)") <
       S.indexOf('_pushLiveIndex(setDoc'),
       'primero lo que importa; si algo falla, que falle lo prescindible');

    // Que los lectores puedan seguir sin indice es lo que hace seguro desplegar:
    // los partidos que ya estuvieran en curso no tienen indice todavia.
    ok('3d · 🔑 el lector cae solo al documento gordo si no hay indice',
       /_vigilaConRespaldo/.test(LIVE) &&
       /!snap\.exists\(\)\s*&&\s*coleccion === _COL_INDICE/.test(LIVE),
       'sin degradacion, un partido ya en curso al desplegar se queda sin alertas');

    ok('3e · y tambien si el indice da error de permisos o de red',
       /yaDegradado\s*=\s*true;\s*\n\s*cancelaActual\s*=\s*suscribe\("live_matches"\)/.test(LIVE),
       'el callback de error tiene que degradar igual que la ausencia');

    ok('3f · la baja cancela el listener VIVO, no el que se cerro al degradar',
       /dadoDeBaja\s*=\s*true;[\s\S]{0,120}cancelaActual\s*&&\s*cancelaActual\(\)/.test(LIVE),
       'si no, cada partido degradado deja un listener huerfano sumando lecturas');
}

// ═══════════════ PARTE 4 · el indice sigue al partido en TODO su ciclo ═══════════════
console.log('\n── PARTE 4 · nace, se cierra y se borra CON el partido ──');
{
    // El indice es quien se filtra por `status`: si se queda 'active' cuando el
    // partido ya no lo esta, su tarjeta se queda en pantalla para siempre. Y si
    // no se borra, se acumula sin que nadie lo recoja.
    ok('4a · el suceso empuja el indice en el acto (o el aviso tardaria 15 s)',
       /live_index/.test(ACTIONS) && /lastEvents:\s*fs\.arrayUnion/.test(ACTIONS),
       'sin esto P1 seria una REGRESION: los avisos pasarian de 5 s a 15 s');

    ok('4b · y los `tactical_move` no gastan escritura en el indice',
       /if\s*\(type === 'tactical_move'\)\s*return;/.test(ACTIONS),
       'son el 45% de los sucesos y no se anuncian nunca');

    ok('4c · el barredor de la nube CIERRA el indice del abandonado',
       /loteA\.set\(db\.collection\('live_index'\)/.test(FUNCS),
       'un indice que siga active deja la tarjeta en pantalla indefinidamente');

    ok('4d · el barredor de la nube BORRA el indice del partido borrado',
       /loteB\.delete\(db\.collection\('live_index'\)/.test(FUNCS),
       'si no, los indices se acumulan y nadie los recoge jamas');

    ok('4e · el cierre por abandono del cliente tambien cierra el indice',
       /setDoc\(doc\(fa\.db, 'live_index', d\.id\)/.test(SYNC));

    const SETUP = fs.readFileSync(path.join(ROOT, 'js', 'core', 'setup-modal.js'), 'utf8');
    const PURGA = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'reports', 'match-purge.js'), 'utf8');
    const APPIN = fs.readFileSync(path.join(ROOT, 'js', 'core', 'app-init.js'), 'utf8');
    const DELCL = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'delete-club.js'), 'utf8');
    const SEASN = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'season-reset.js'), 'utf8');

    ok('4f · eliminar un partido desde recuperacion borra su indice',
       /deleteDoc\(doc\(fa\.db, 'live_index', matchId\)\)/.test(SETUP),
       'si no, la tarjeta reaparece en la lista despues de borrarlo');
    ok('4g · la purga total del partido borra su indice',
       /deleteDoc\(mod\.doc\(db, 'live_index', mid\)\)/.test(PURGA));
    ok('4h · el partido cancelado por tiempo cancela su indice',
       /live_index[\s\S]{0,200}cancelled/.test(APPIN));
    ok('4i · borrar un club se lleva sus indices',
       /_borrarPorClub\('live_index'\)/.test(DELCL));
    ok('4j · vaciar la temporada se lleva los indices con los partidos',
       /live_matches:\s*\['live_index'\]/.test(SEASN));
}

// ═══════════════ PARTE 5 · reglas e indices desplegables ═══════════════
console.log('\n── PARTE 5 · la coleccion nueva esta protegida y consultable ──');
{
    ok('5a · existe el bloque de reglas de live_index',
       /match \/live_index\/\{matchId\}/.test(RULES));

    // ⚠️ El indice lleva nombres de equipo y textos de suceso con NOMBRES DE
    // MENORES. Ser pequeno no lo hace publico: si esto se afloja se reabre P9
    // con los mismos datos y sin que se note.
    const bloque = RULES.slice(RULES.indexOf('match /live_index/{matchId}'));
    const cierre = bloque.indexOf('\n    }');
    const reglasIdx = bloque.slice(0, cierre === -1 ? 3000 : cierre);
    ok('5b · 🔑 la lectura exige usuario registrado (lleva PII de menores)',
       /allow read:\s*if isRegisteredUser\(\)/.test(reglasIdx),
       'ser pequeno no lo hace publico');
    ok('5c · no hay ningun `allow read: if true` en el bloque',
       !/allow read:\s*if true/.test(reglasIdx));
    ok('5d · la escritura exige pertenencia al club del partido',
       /allow create:[\s\S]{0,900}?sameClub\(/.test(reglasIdx) &&
       /allow update:[\s\S]{0,900}?sameClub\(/.test(reglasIdx),
       'sin esto cualquier autenticado inyecta tarjetas en la lista de otro club');
    ok('5e · un indice congelado no se puede reescribir',
       /lxFrozen\(\)/.test(reglasIdx),
       'o un partido terminado se podria hacer parecer en juego');

    // Sin los indices compuestos las consultas filtradas FALLAN y todo cae al
    // escaneo completo: la aplicacion funciona, pero pagando el precio antiguo.
    const idxJson = JSON.parse(INDEXES);
    const deLive = idxJson.indexes.filter(i => i.collectionGroup === 'live_index');
    const campos = deLive.map(i => i.fields.map(f => f.fieldPath).sort().join('+')).sort();
    ok('5f · los 4 indices compuestos de live_index estan declarados (' + deLive.length + ')',
       deLive.length >= 4, JSON.stringify(campos));
    ok('5g · cubren las mismas consultas que las de live_matches',
       campos.join(' | ') === 'clubId+status | coachEmail+status | createdBy+status | status+updatedAt',
       campos.join(' | '));
}

// ═══════════════ PARTE 6 · la siembra con DOS vistas del mismo partido ═══════════════
console.log('\n── PARTE 6 · 🚨 el embudo que introdujo P2 (v572b) ──');
{
    // ⚠️ ESTA ES LA REGRESION MAS SERIA QUE TRAJO P2, y no se ve en una prueba
    // con un partido tranquilo: es una CARRERA.
    //
    // Al abrir un partido, `detectAndAlert` recibe DOS vistas del mismo:
    //   · el vigilante de fondo -> `live_index.lastEvents` (VENTANA de 3)
    //   · el visor de detalle   -> `live_matches.events`   (historial ENTERO)
    // `loadMatch` reinicia la siembra, asi que siembra LA QUE LLEGUE PRIMERO.
    // Si sembraba la ventana de 3, el historial restante llegaba con la siembra
    // ya cerrada y se anunciaba entero: 22 avisos de golpe al entrar en un
    // partido avanzado. El "efecto embudo" de v567 por una causa nueva.
    //
    // Se ejecuta el bloque REAL de live.html, no una reimplementacion.
    const ini = LIVE.indexOf('    const _evArr   = Array.isArray(matchData.events)');
    const fin = LIVE.indexOf('    _matchSeeded[matchId] = true;');
    ok('6a · se encuentra el bloque de siembra en live.html', ini !== -1 && fin > ini);

    if (ini !== -1 && fin > ini) {
        const bloque = LIVE.slice(ini, fin + '    _matchSeeded[matchId] = true;'.length);

        // `_sets` vive en un closure y NO como propiedad del sandbox: dentro de
        // la VM `this` no apunta al sandbox, asi que un `this._sets` daria
        // undefined. Se reinicia con reset() entre escenarios.
        let _sets = {};
        const sandbox = {
            _matchSeeded: {}, _matchSeedTs: {},
            _seenSetFor: (id) => _sets[id] || (_sets[id] = new Set()),
            _eventBelongsTo: (ev, id) => !ev.matchId || ev.matchId === id,
            _esEventoVisible: (ev) => ev.type !== 'tactical_move',
            _eventKey: (ev) => ev.eventId || '',
            Array, Number, Set, console: { warn(){}, error(){} }
        };
        const reset = () => { sandbox._matchSeeded = {}; sandbox._matchSeedTs = {}; _sets = {}; };
        vm.createContext(sandbox);
        // El bloque usa `matchData`/`matchId` del ambito de detectAndAlert y
        // deja `_evNuevos`: se envuelve tal cual, sin tocar una linea.
        vm.runInContext(
            'function _siembraReal(matchId, matchData) {\n' + bloque +
            '\n  return _evNuevos; }', sandbox);

        // Partido avanzado: 25 sucesos, createdAt 1000..1024.
        const todos = [];
        for (let i = 0; i < 25; i++) {
            todos.push({ eventId: 'ev' + i, matchId: 'M1', type: 'goal',
                         text: 'GOL ' + i, createdAt: 1000 + i });
        }
        const ventana = todos.slice(-3);                       // lo que trae el indice
        const docLigero = { lastEvents: ventana };
        const docGordo  = { events: todos };

        // ── Escenario A · gana el INDICE la carrera (el caso que rompia) ──
        reset();
        const a1 = sandbox._siembraReal('M1', docLigero);
        const a2 = sandbox._siembraReal('M1', docGordo);
        ok('6b · siembra la ventana de 3: no anuncia nada', a1.length === 0);
        ok('6c · 🔑 y el historial que llega DESPUES tampoco se anuncia',
           a2.length === 0,
           'se anunciaron ' + a2.length + ' sucesos viejos — es el embudo');

        // ── Escenario B · gana el documento gordo ──
        reset();
        const b1 = sandbox._siembraReal('M1', docGordo);
        const b2 = sandbox._siembraReal('M1', docLigero);
        ok('6d · al reves da el MISMO resultado (la carrera deja de importar)',
           b1.length === 0 && b2.length === 0,
           'gordo=' + b1.length + ' ligero=' + b2.length);

        // ── Y lo que NO puede romperse: un suceso de verdad nuevo SI suena ──
        const nuevo = { eventId: 'evNuevo', matchId: 'M1', type: 'goal',
                        text: 'GOL nuevo', createdAt: 2000 };
        reset();
        sandbox._siembraReal('M1', docLigero);
        const c1 = sandbox._siembraReal('M1', { lastEvents: ventana.concat([nuevo]) });
        ok('6e · 🔑 un gol NUEVO posterior a la marca SI se anuncia',
           c1.length === 1 && c1[0].eventId === 'evNuevo',
           'la marca de agua no puede silenciar lo que si es nuevo: ' +
           JSON.stringify(c1.map(e => e.eventId)));

        // Un partido anterior a v572 no trae `createdAt`: el comportamiento
        // tiene que ser el de siempre (manda el Set de eventId), no un silencio.
        reset();
        const viejos = todos.map(e => ({ eventId: e.eventId, matchId: 'M1',
                                         type: 'goal', text: e.text }));
        sandbox._siembraReal('M1', { events: viejos.slice(0, 3) });
        const d1 = sandbox._siembraReal('M1', { events: viejos });
        ok('6f · sin `createdAt` (partidos viejos) sigue mandando el eventId',
           d1.length === viejos.length - 3,
           'no se puede inventar una marca: silenciaria sucesos legitimos');

        ok('6g · el indice ligero manda `createdAt` en cada suceso',
           /createdAt:\s*ev\.createdAt/.test(SYNC) &&
           /createdAt:\s*eventEntry\.createdAt/.test(ACTIONS),
           'sin esa marca en el dato, la correccion de arriba no tiene con que trabajar');
    }
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

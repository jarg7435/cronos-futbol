// ═══════════════════════════════════════════════════════════════════════════
//  📤 v724 · LA BANDEJA DE SALIDA DE SUCESOS (js/match/live/outbox.js)
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-16): «implementar una gestion de
//  reintentos inteligentes y limpieza de buferes locales para que, ante
//  cualquier latencia de red, la cola de sucesos nunca se detenga ni se
//  desincronice del cronometro».
//
//  📏 LO QUE MIDIERON LAS CAPTURAS, Y QUE ESTE GUARD DEFIENDE. Las cuatro del
//  visor (10538, 10539, 10542, 10543) llevan el MISMO «↻ 01:55:47» durante 18
//  minutos, y a las 02:13 el entrenador tiene 3-0 mientras el visor sigue en
//  2-0. No se congelo «el canal de sucesos»: se congelo el documento entero, y
//  el cronometro parecia vivo porque el visor lo deriva de `phaseStartedAt`
//  contra su propio reloj. En v723 NO habia reintento en ningun camino de
//  emision: un suceso que fallaba se perdia para siempre y en silencio.
//
//  ESTE GUARD EJECUTA EL MODULO DE VERDAD (no busca texto): le inyecta un
//  escritor que falla, que tarda, que vence el plazo y que duplica, y
//  comprueba las propiedades que sostienen el arreglo.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(nombre, cond, detalle) {
    if (cond) { console.log('PASS ' + nombre); pass++; }
    else { console.log('FAIL ' + nombre + (detalle ? '\n       ' + detalle : '')); fail++; }
}
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// ── Sandbox: `window` de mentira y un `localStorage` en memoria ─────────────
function nuevaCola() {
    const almacen = new Map();
    const ventana = {
        _cronos_auth: null,
        showToast: (t) => { ventana._avisos.push(t); },
        _avisos: [],
        _cronosRecortaSuceso: (ev, mid) => ({
            eventId: ev.eventId, matchId: mid, type: ev.type, text: ev.text
        })
    };
    const sandbox = {
        window: ventana,
        console: { warn: () => {}, log: () => {}, error: () => {} },
        setTimeout, clearTimeout, Date, Math, JSON, Promise, Error, Object, Array, String,
        localStorage: {
            _m: almacen,
            getItem:    (k) => (almacen.has(k) ? almacen.get(k) : null),
            setItem:    (k, v) => almacen.set(k, String(v)),
            removeItem: (k) => almacen.delete(k),
            get length() { return almacen.size; },
            key: (i) => Array.from(almacen.keys())[i] || null
        },
        module: { exports: {} }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/match/live/outbox.js'), 'utf8'),
                    sandbox, { filename: 'outbox.js' });
    return { API: sandbox.window.CronosOutbox, ventana, almacen };
}

let n = 0;
const suceso = (tipo, texto) => ({
    eventId: 'ev_' + (++n) + '_' + Math.random().toString(36).slice(2, 6),
    type: tipo || 'goal', text: texto || 'GOL · Jugador',
    icon: '⚽', realTime: '12:00:00', matchTime: '1T 10:00',
    timestamp: new Date().toISOString(), createdAt: Date.now()
});

(async () => {

// ═══════ PARTE 1 · el camino feliz ═══════
console.log('── PARTE 1 · un suceso encolado sale, agrupado y una sola vez ──');
{
    const { API } = nuevaCola();
    const escrituras = [];
    API._configura({
        escritor: (mid, lote) => { escrituras.push({ mid, lote: lote.slice() }); },
        tiempos: { ventanaUrgente: 20, ventanaTactica: 60, esperaBase: 20 }
    });

    API.encola('partido-A', suceso('goal'));
    API.encola('partido-A', suceso('yellow'));
    API.encola('partido-A', suceso('sub'));
    ok('1a · no se escribe en el acto (hay ventana de agrupacion)', escrituras.length === 0);

    await dormir(120);
    ok('1b · 🔑 los tres salen en UNA sola escritura, no en tres',
       escrituras.length === 1 && escrituras[0].lote.length === 3,
       escrituras.length + ' escrituras');
    ok('1c · y al partido que se dijo, no a ninguna global',
       escrituras[0].mid === 'partido-A');
    ok('1d · la cola queda vacia tras el acuse', API.pendientes('partido-A') === 0);
    ok('1e · y el contador de enviados lo refleja',
       API.estado('partido-A')['partido-A'].enviados === 3);
}

// ═══════ PARTE 2 · 🔴 EL DEFECTO DEL 16/09: un fallo NO pierde el suceso ═══════
console.log('\n── PARTE 2 · reintento: lo que v723 perdia para siempre ──');
{
    const { API } = nuevaCola();
    let intentos = 0;
    const llegaron = [];
    API._configura({
        escritor: (mid, lote) => {
            intentos++;
            // Los tres primeros intentos se caen, como una cobertura que va y
            // viene en un campo de futbol.
            if (intentos <= 3) return Promise.reject(new Error('unavailable'));
            lote.forEach(e => llegaron.push(e.eventId));
        },
        tiempos: { ventanaUrgente: 10, esperaBase: 15, esperaTope: 60 }
    });

    const gol = suceso('goal', 'GOL · MIMA');
    API.encola('partido-B', gol);

    await dormir(60);
    ok('2a · 🔑 tras fallar, el suceso SIGUE en la cola (no se da por enviado)',
       API.pendientes('partido-B') === 1 && llegaron.length === 0,
       'pendientes=' + API.pendientes('partido-B'));

    await dormir(500);
    ok('2b · 🔑🔑 y acaba llegando solo, sin que nadie lo reenvie a mano',
       llegaron.length === 1 && llegaron[0] === gol.eventId,
       'intentos=' + intentos + ' llegaron=' + llegaron.length);
    ok('2c · la cola queda limpia', API.pendientes('partido-B') === 0);
    ok('2d · hubo mas de un intento (hay reintento de verdad)', intentos >= 4,
       'intentos=' + intentos);
}

// ═══════ PARTE 3 · aislamiento total por matchId ═══════
console.log('\n── PARTE 3 · un partido atascado NO puede parar a los demas ──');
{
    const { API } = nuevaCola();
    const recibido = {};
    API._configura({
        escritor: (mid, lote) => {
            // El partido ATASCADO no responde NUNCA (promesa que no resuelve):
            // es el caso exacto de una escritura colgada sin plazo.
            if (mid === 'atascado') return new Promise(() => {});
            recibido[mid] = (recibido[mid] || 0) + lote.length;
        },
        tiempos: { ventanaUrgente: 10, plazoEscritura: 10000, esperaBase: 20 }
    });

    API.encola('atascado', suceso('goal'));
    API.encola('sano-1',  suceso('goal'));
    API.encola('sano-2',  suceso('sub'));
    API.encola('sano-3',  suceso('red'));

    await dormir(150);
    ok('3a · 🔑 los tres sanos emiten aunque uno este colgado',
       recibido['sano-1'] === 1 && recibido['sano-2'] === 1 && recibido['sano-3'] === 1,
       JSON.stringify(recibido));
    ok('3b · y el atascado se queda con lo suyo, sin contaminar a nadie',
       API.pendientes('atascado') === 1 &&
       API.pendientes('sano-1') === 0 && API.pendientes('sano-2') === 0);

    // Y el contrario: lo encolado para un partido NUNCA aparece en otro.
    const marcado = suceso('goal', 'GOL · DE OTRO PARTIDO');
    const vistos = [];
    API._configura({ escritor: (mid, lote) => {
        lote.forEach(e => vistos.push(mid + '|' + e.eventId));
    } });
    API.encola('sano-1', marcado);
    await dormir(80);
    ok('3c · 🔑 el suceso aparece SOLO en el documento de su partido',
       vistos.filter(v => v.endsWith('|' + marcado.eventId)).length === 1 &&
       vistos.some(v => v === 'sano-1|' + marcado.eventId),
       JSON.stringify(vistos));
}

// ═══════ PARTE 4 · el plazo: una escritura colgada no para la cola ═══════
console.log('\n── PARTE 4 · plazo de escritura (la que nunca responde) ──');
{
    const { API } = nuevaCola();
    let vuelta = 0;
    const llegaron = [];
    API._configura({
        escritor: (mid, lote) => {
            vuelta++;
            if (vuelta === 1) return new Promise(() => {});   // no responde JAMAS
            lote.forEach(e => llegaron.push(e.eventId));
        },
        tiempos: { ventanaUrgente: 10, plazoEscritura: 80, esperaBase: 20, esperaTope: 60 }
    });

    const ev = suceso('goal');
    API.encola('partido-C', ev);

    await dormir(50);
    ok('4a · mientras la escritura no responde, el suceso espera',
       API.pendientes('partido-C') === 1 && llegaron.length === 0);

    await dormir(400);
    ok('4b · 🔑 vencido el plazo se reintenta y el suceso LLEGA',
       llegaron.length === 1 && llegaron[0] === ev.eventId,
       'vueltas=' + vuelta + ' llegaron=' + llegaron.length);
    ok('4c · la cola no se quedo bloqueada para siempre',
       API.pendientes('partido-C') === 0);
}

// ═══════ PARTE 5 · nada se pierde con sucesos entrando durante el vuelo ═══════
console.log('\n── PARTE 5 · el defecto del slice(n): retirar por eventId ──');
{
    const { API } = nuevaCola();
    const llegaron = new Set();
    let enVueloResolver = null;
    API._configura({
        escritor: (mid, lote) => new Promise((res) => {
            // La primera escritura se queda en vuelo a proposito, para que
            // entren sucesos nuevos justo mientras.
            if (!enVueloResolver) {
                enVueloResolver = () => { lote.forEach(e => llegaron.add(e.eventId)); res(); };
                return;
            }
            lote.forEach(e => llegaron.add(e.eventId));
            res();
        }),
        tiempos: { ventanaUrgente: 10, esperaBase: 15 }
    });

    const a = suceso('goal'), b = suceso('yellow');
    API.encola('partido-D', a);
    API.encola('partido-D', b);
    await dormir(40);   // el lote [a,b] esta en vuelo

    const c = suceso('sub'), d = suceso('injury'), e = suceso('red');
    API.encola('partido-D', c);
    API.encola('partido-D', d);
    API.encola('partido-D', e);

    enVueloResolver();            // acusa el lote VIEJO, de 2
    await dormir(200);

    ok('5a · 🔑 los 5 llegan: el acuse del lote viejo no se lleva a los nuevos',
       [a, b, c, d, e].every(x => llegaron.has(x.eventId)),
       'llegaron ' + llegaron.size + ' de 5');
    ok('5b · y la cola queda vacia', API.pendientes('partido-D') === 0);
}

// ═══════ PARTE 6 · idempotencia y buferes locales ═══════
console.log('\n── PARTE 6 · sin duplicados, y la cola sobrevive a la recarga ──');
{
    const { API, almacen } = nuevaCola();
    API._configura({ escritor: () => new Promise(() => {}),   // nada acusa
                     tiempos: { ventanaUrgente: 10, plazoEscritura: 100000 } });

    const ev = suceso('goal');
    API.encola('partido-E', ev);
    API.encola('partido-E', ev);     // el mismo, dos veces (doble clic)
    ok('6a · 🔑 el mismo eventId no se encola dos veces',
       API.pendientes('partido-E') === 1);

    API.encola('partido-E', suceso('sub'));
    const clave = Array.from(almacen.keys()).find(k => k.indexOf('cronos_outbox::partido-E') === 0);
    ok('6b · 🔑 la cola se guarda en localStorage (sobrevive a la recarga)',
       !!clave, 'claves: ' + Array.from(almacen.keys()).join(','));
    if (clave) {
        const guardado = JSON.parse(almacen.get(clave));
        ok('6c · con los sucesos dentro y su sello de hora',
           Array.isArray(guardado.pendientes) && guardado.pendientes.length === 2 &&
           typeof guardado.actualizado === 'number');
    } else { ok('6c · con los sucesos dentro y su sello de hora', false); }

    // Y una cola nueva sobre el MISMO almacen los recupera.
    ok('6d · 🔑 `recupera` devuelve lo que quedo pendiente',
       API.recupera('partido-E') === 2);

    // El tope sacrifica tacticos antes que goles.
    const { API: API2 } = nuevaCola();
    API2._configura({ escritor: () => new Promise(() => {}),
                      tiempos: { ventanaUrgente: 5, topeCola: 10, plazoEscritura: 100000 } });
    for (let i = 0; i < 8; i++) API2.encola('partido-F', suceso('tactical_move', 'mov'));
    for (let i = 0; i < 6; i++) API2.encola('partido-F', suceso('goal', 'GOL'));
    const quedan = API2.pendientes('partido-F');
    ok('6e · el tope de la cola se respeta', quedan <= 10, 'quedan ' + quedan);
    ok('6f · 🔑 y sacrifica tacticos, NUNCA goles',
       API2.estado('partido-F')['partido-F'].descartados >= 4);

    // Cerrar una cola borra su rastro.
    API2.cierra('partido-F');
    ok('6g · cerrar un partido limpia su bufer local', API2.pendientes('partido-F') === 0);
}

// ═══════ PARTE 7 · el indice ligero, y que un fallo suyo no repita el gordo ═══════
console.log('\n── PARTE 7 · el suceso empuja el indice, y su fallo es mudo ──');
{
    const OUT = fs.readFileSync(path.join(ROOT, 'js/match/live/outbox.js'), 'utf8');
    const sinCom = OUT.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

    ok('7a · el gordo se escribe ANTES que el indice',
       sinCom.indexOf("fs.doc(fa.db, 'live_matches', matchId)") <
       sinCom.indexOf("fs.doc(fa.db, 'live_index', matchId)"),
       'si fallara el indice, el suceso ya esta a salvo en el documento bueno');

    ok('7b · 🔑 los tactical_move no gastan escritura en el indice (v572)',
       /NO_ANUNCIABLES\[e\.type\]\) return;/.test(sinCom));

    ok('7c · 🔑 el fallo del indice NO reintenta el lote entero (catch propio)',
       /live_index[\s\S]{0,700}?\.catch\(function \(e\) \{/.test(sinCom),
       'sin su catch, un indice caido reescribiria el gordo una y otra vez');

    ok('7d · la forma del suceso recortado sale de UN solo sitio (v578)',
       /window\._cronosRecortaSuceso/.test(sinCom) &&
       !/lastEvents:\s*fs\.arrayUnion\(\{/.test(sinCom));

    ok('7e · 🔑 el sello de hora viaja con el suceso (v567: sin el, no suena)',
       /events:\s*fs\.arrayUnion\.apply\(null, lote\),[\s\S]{0,80}?updatedAt:\s*fs\.serverTimestamp\(\)/.test(sinCom));

    ok('7f · y sigue siendo merge (no pisa el resto del documento)',
       /\{ merge: true \}/.test(sinCom));
}

// ═══════ PARTE 8 · el cableado: quien llama a la cola ═══════
console.log('\n── PARTE 8 · cableado en player-actions y sync ──');
{
    const ACTIONS = fs.readFileSync(path.join(ROOT, 'js/match/events/player-actions.js'), 'utf8');
    const SYNC    = fs.readFileSync(path.join(ROOT, 'js/match/live/sync.js'), 'utf8');
    const INDEX   = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    ok('8a · 🔑 `_registerMatchEvent` entrega el suceso a la cola de SU partido',
       /_cola\.encola\(_id, eventEntry\)/.test(ACTIONS),
       '`_id` es el que ya calcularon las puertas de v434/v469');

    ok('8b · con respaldo si el modulo no hubiera cargado',
       /else if \(fa && fa\.db && _id\)/.test(ACTIONS));

    ok('8c · 🔑 el encolado va DESPUES de la puerta estanca de v469',
       ACTIONS.indexOf('[v469] 🔒 Suceso BLOQUEADO') < ACTIONS.indexOf('_cola.encola(_id, eventEntry)'),
       'los tactical_move eran los unicos sucesos que se saltaban las puertas');

    // ⚠️ Sobre el CODIGO, no sobre los comentarios: la nota que explica por que
    // se retiro el aparcamiento tiene que poder nombrarlo.
    const SYNC_COD = SYNC.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    ok('8d · 🔑 el latido ya no acarrea sucesos ni toca el aparcamiento global',
       !/_cronosTacticalPending/.test(SYNC_COD) && !/snapshot\.events\s*=/.test(SYNC_COD));

    ok('8e · `startLiveSync` recupera la cola de su partido',
       /CronosOutbox\.recupera\(liveMatchId\)/.test(SYNC));

    ok('8f · 🔑 y el cierre drena antes de marcar el partido terminado',
       SYNC.indexOf('CronosOutbox.drenaYa(liveMatchId') <
       SYNC.indexOf('await pushLiveSnapshot(finalStatus)'),
       'marcar finished con la cola llena deja sucesos fuera del partido');

    ok('8g · el modulo se carga en index.html antes que sus dos clientes',
       INDEX.indexOf('js/match/live/outbox.js') > 0 &&
       INDEX.indexOf('js/match/live/outbox.js') < INDEX.indexOf('js/match/events/player-actions.js') &&
       INDEX.indexOf('js/match/live/outbox.js') < INDEX.indexOf('js/match/live/sync.js'));
}

// ═══════ PARTE 9 · v725 · EL CONCILIADOR: «¿de verdad llego?» ═══════
console.log('\n── PARTE 9 · conciliacion: lo que se escapo de la cola ──');
{
    const { API, ventana } = nuevaCola();
    const escritas = new Set();
    let servidor = {};        // lo que el servidor «tiene»
    API._configura({
        escritor: (mid, lote) => { lote.forEach(e => { escritas.add(e.eventId); servidor[e.eventId] = 1; }); },
        lector:   () => Object.assign({}, servidor),
        tiempos:  { ventanaUrgente: 10, esperaBase: 15 }
    });

    // 🔴 EL CASO: tres sucesos que NUNCA pasaron por la cola. Es lo que ocurre
    // con un suceso nacido antes de que existiera `liveMatchId`, con uno que
    // bloqueo la puerta de v469, o con el respaldo sin reintento.
    const fuera = [suceso('goal', 'GOL · nunca encolado'),
                   suceso('red',  'ROJA · nunca encolada'),
                   suceso('sub',  'CAMBIO · nunca encolado')];
    fuera.forEach(e => { e.matchId = 'partido-G'; });
    ventana._cronosMatchEvents = fuera.slice();

    const r = await API.concilia('partido-G');
    ok('9a · 🔑 el conciliador DETECTA lo que el servidor no tiene',
       r.leido === true && r.reparados === 3, JSON.stringify(r));

    await dormir(120);
    ok('9b · 🔑🔑 y lo REPARA: acaban escritos sin que nadie los reenvie',
       fuera.every(e => escritas.has(e.eventId)),
       escritas.size + ' escritos');

    // Segunda pasada: ya estan, no se duplica trabajo.
    const r2 = await API.concilia('partido-G');
    ok('9c · una segunda pasada no vuelve a encolar lo que ya esta',
       r2.reparados === 0, JSON.stringify(r2));

    // ⚠️ LA PROPIEDAD MAS IMPORTANTE: una lectura FALLIDA no es «el servidor no
    // tiene nada». Si se tratara asi, cada corte de red re-encolaria el partido
    // entero y el conciliador seria un amplificador de carga.
    API._configura({ lector: () => Promise.reject(new Error('unavailable')) });
    const r3 = await API.concilia('partido-G');
    ok('9d · 🔑 si la lectura falla, NO se repara nada (no sabemos, no tocamos)',
       r3.leido === false && r3.reparados === 0, JSON.stringify(r3));

    API._configura({ lector: () => null });
    const r4 = await API.concilia('partido-G');
    ok('9e · y un documento ilegible tampoco dispara reparaciones',
       r4.leido === false && r4.reparados === 0);

    // Lo que va de camino no cuenta como perdido.
    API._configura({ escritor: () => new Promise(() => {}), lector: () => ({}) });
    const enCamino = suceso('goal', 'GOL · en vuelo');
    enCamino.matchId = 'partido-H';
    ventana._cronosMatchEvents = [enCamino];
    API.encola('partido-H', enCamino);
    const r5 = await API.concilia('partido-H');
    ok('9f · 🔑 un suceso que sigue en la cola NO se cuenta como perdido',
       r5.reparados === 0 && API.pendientes('partido-H') === 1, JSON.stringify(r5));
}

// ═══════ PARTE 10 · v725 · la cola que sobrevive al partido ═══════
console.log('\n── PARTE 10 · recuperar TODAS las colas, y no tirar goles ──');
{
    const { API, almacen } = nuevaCola();
    API._configura({ escritor: () => new Promise(() => {}),
                     tiempos: { ventanaUrgente: 5, plazoEscritura: 100000 } });

    // Dos partidos terminados dejan cola; se simula «ayer» tocando el sello.
    API.encola('ayer-1', suceso('goal', 'GOL del partido de ayer'));
    API.encola('ayer-2', suceso('tactical_move', 'mov'));
    API._configura({ reinicia: true });     // como si la app se hubiera cerrado

    ok('10a · 🔑 `recuperaTodas` adopta las colas de OTROS partidos',
       API.recuperaTodas().sucesos === 2);

    // Y el barrido por antiguedad: lo tactico caduca, el gol NO.
    const viejo = (clave) => {
        const real = Array.from(almacen.keys()).find(k => k.indexOf(clave) === 0);
        const d = JSON.parse(almacen.get(real));
        d.actualizado = Date.now() - 72 * 3600 * 1000;
        almacen.set(real, JSON.stringify(d));
    };
    API._configura({ reinicia: true });
    viejo('cronos_outbox::ayer-1'); viejo('cronos_outbox::ayer-2');
    API.barre(24);

    const quedaGol = Array.from(almacen.keys()).some(k => k.indexOf('cronos_outbox::ayer-1') === 0);
    const quedaMov = Array.from(almacen.keys()).some(k => k.indexOf('cronos_outbox::ayer-2') === 0);
    ok('10b · 🔑🔑 un GOL sin entregar NO caduca por antiguedad', quedaGol);
    ok('10c · y lo tactico si (es pintura, y es el 75-90% del volumen)', !quedaMov);
}

// ═══════ PARTE 11 · v725 · el iPad que se va a segundo plano ═══════
console.log('\n── PARTE 11 · drenaje al ocultar la pagina ──');
{
    const { API } = nuevaCola();
    const escritas = [];
    API._configura({ escritor: (mid, lote) => { lote.forEach(e => escritas.push(e.eventId)); },
                     // Ventana LARGA: sin el vaciado forzado no saldria nada.
                     tiempos: { ventanaUrgente: 100000, ventanaTactica: 100000 } });

    API.encola('partido-I', suceso('goal'));
    API.encola('partido-J', suceso('red'));
    await dormir(30);
    ok('11a · con la ventana sin vencer, todavia no ha salido nada',
       escritas.length === 0 && API.pendientes('partido-I') === 1);

    API._vaciaTodasYa();
    await dormir(80);
    ok('11b · 🔑 al ocultarse la pagina se vacian TODAS las colas',
       escritas.length === 2 &&
       API.pendientes('partido-I') === 0 && API.pendientes('partido-J') === 0,
       'escritas=' + escritas.length);

    const OUT = fs.readFileSync(path.join(ROOT, 'js/match/live/outbox.js'), 'utf8');
    ok('11c · 🔑 y esta cableado a `pagehide` y `visibilitychange`',
       /addEventListener\('pagehide'/.test(OUT) &&
       /visibilityState === 'hidden'/.test(OUT),
       'en iOS `beforeunload` NO es fiable en una PWA instalada');
}

// ═══════ PARTE 12 · v725 · cableado del conciliador ═══════
console.log('\n── PARTE 12 · cableado en sync.js ──');
{
    const SYNC = fs.readFileSync(path.join(ROOT, 'js/match/live/sync.js'), 'utf8');

    ok('12a · `startLiveSync` recupera TODAS las colas, no solo la suya',
       /CronosOutbox\.recuperaTodas\(\)/.test(SYNC));

    ok('12b · 🔑 y deja el conciliador vigilando el partido',
       /CronosOutbox\.vigila\(liveMatchId\)/.test(SYNC));

    ok('12c · 🔑🔑 el cierre concilia ANTES de drenar y de marcar `finished`',
       SYNC.indexOf('CronosOutbox.concilia(liveMatchId)') <
       SYNC.indexOf('CronosOutbox.drenaYa(liveMatchId') &&
       SYNC.indexOf('CronosOutbox.drenaYa(liveMatchId') <
       SYNC.indexOf('await pushLiveSnapshot(finalStatus)'));

    ok('12d · y apaga el vigilante al cerrar (no deja intervalos huerfanos)',
       /CronosOutbox\.noVigiles\(liveMatchId\)/.test(SYNC));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('ERROR EN EL ARNES:', e); process.exit(1); });

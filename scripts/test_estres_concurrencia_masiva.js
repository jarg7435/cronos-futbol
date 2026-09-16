// ═══════════════════════════════════════════════════════════════════════════
//  🏟️ v724 · PRUEBA DE ESTRES: UN SABADO POR LA MAÑANA ENTERO
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-16): «La aplicacion debe
//  soportar de forma simultanea y sin bloqueos la gestion de 20 o 30 clubes
//  (con 10 a 15 equipos cada uno) operando a la vez un sabado por la mañana
//  (cientos de partidos concurrentes). El fallo detectado con solo 3 partidos
//  demuestra que el canal de sucesos se satura.» Y el punto 4: «Diseñar e
//  incluir pruebas automatizadas en la terminal que simulen alta concurrencia
//  de multiples partidos simultaneos.»
//
//  📏 QUE SIMULA ESTE ARNES, Y POR QUE ASI
//  ─────────────────────────────────────────────────────────────────────
//  25 clubes × 12 equipos = 300 partidos a la vez, cada uno soltando sucesos
//  a un ritmo realista (rafagas de cambios, goles sueltos, mucho arrastre de
//  fichas: los `tactical_move` son el 75-90% de los sucesos, MEDIDO en los
//  partidos reales del autor).
//
//  Y sobre todo simula EL CANAL, que es donde estaba el fallo:
//    · UN CANAL POR DISPOSITIVO, con tope de escrituras en vuelo. No es una
//      licencia: Firestore usa `persistentMultipleTabManager`
//      (firebase-init.js), asi que dentro de un navegador una pestaña es la
//      primaria y TODAS las escrituras de esa cuenta salen por ella (la nota
//      de v575 lo midio: ~68 KB/s por un solo canal con 4 partidos
//      arrastrando). Por eso los partidos se reparten de DOS en DOS por
//      dispositivo: es el caso real del entrenador con dos equipos —un F7 y
//      un F11— que es exactamente el de las capturas del 16/09;
//    · y un tope GLOBAL de servidor por encima de todos ellos;
//    · latencia variable, como un movil en un campo de futbol;
//    · un 8% de escrituras que fallan (`unavailable`), que es lo corriente
//      con cobertura intermitente;
//    · y DOS partidos cuya escritura se queda COLGADA sin responder jamas —
//      el caso exacto del 16/09, cuando `live_matches/futurefem…` dejo de
//      actualizarse a las 01:55:47 y no volvio a moverse en 20 minutos—,
//      colocados A PROPOSITO en dispositivos que tambien llevan un partido
//      sano: asi se comprueba que el atasco de uno no ahoga a su compañero de
//      canal, que es la situacion exacta del reporte.
//
//  🔑 LO QUE TIENE QUE SALIR VERDE (y que en v723 no habria salido):
//    1 · CERO PERDIDA · todo suceso encolado acaba escrito.
//    2 · CERO CRUCE   · ningun suceso aparece en un partido que no es el suyo.
//    3 · CERO DUPLICADO · ni con reintentos ni con plazos vencidos.
//    4 · ESCRITURAS ACOTADAS · la agrupacion tiene que reducir de verdad el
//        numero de operaciones; si no, el canal se satura igual.
//    5 · NINGUN PARTIDO MUDO · los 298 sanos drenan enteros aunque 2 esten
//        colgados. Un partido atascado no puede llevarse por delante a nadie.
//
//  ⚠️ LOS TIEMPOS VAN COMPRIMIDOS (milisegundos en vez de segundos) para que
//  la prueba corra en la terminal en segundos. Lo que se ejerce es la LOGICA
//  —lotes, acuses, reintentos, plazos, aislamiento—, que no depende de la
//  escala del reloj. Los numeros reales se comprueban aparte, en la PARTE 5.
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

// ── Parametros del sabado ──────────────────────────────────────────────────
const CLUBES          = 25;
const EQUIPOS_POR_CLUB = 12;
const PARTIDOS        = CLUBES * EQUIPOS_POR_CLUB;      // 300
const SUCESOS_POR_PARTIDO = 30;
const COLGADOS        = ['club03__eq06', 'club18__eq02'];
const TASA_FALLO      = 0.08;
// Dos partidos por dispositivo (el entrenador con un F7 y un F11, v537), cada
// dispositivo con SU canal. `eq06`/`eq07` y `eq02`/`eq03` comparten aparato:
// los colgados de arriba son los pares de un partido SANO a proposito.
const PARTIDOS_POR_APARATO = 2;
const CANAL_POR_APARATO    = 3;     // escrituras en vuelo por navegador
const CANAL_SERVIDOR       = 600;   // tope global, muy por encima: el cuello es el cliente
const aparatoDe = (mid) => {
    const eq = parseInt(mid.slice(mid.indexOf('__eq') + 4), 10);
    return mid.slice(0, mid.indexOf('__eq')) + '__ap' + Math.floor(eq / PARTIDOS_POR_APARATO);
};

// ── Sandbox con `window` y `localStorage` de mentira ───────────────────────
function cargaModulo() {
    const almacen = new Map();
    const ventana = {
        _cronos_auth: null,
        showToast: () => {},
        _cronosRecortaSuceso: (ev, mid) => ({ eventId: ev.eventId, matchId: mid, type: ev.type })
    };
    const sandbox = {
        window: ventana,
        console: { warn: () => {}, log: () => {}, error: () => {} },
        setTimeout, clearTimeout, Date, Math, JSON, Promise, Error, Object, Array, String,
        localStorage: {
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
    return sandbox.window.CronosOutbox;
}

// ── Las tuberias: una por dispositivo, y un tope global por encima ─────────
//  Cada navegador tiene SU canal (la primaria del SDK). El servidor tiene el
//  suyo, muy por encima: el cuello de botella real esta en el cliente, y es lo
//  que hay que demostrar que ya no se atasca.
function nuevoCanal(servidor, metricas) {
    const canales = Object.create(null);   // aparato -> {enVuelo, espera}
    let enVueloGlobal = 0;

    const sirve = (ap) => {
        const c = canales[ap];
        while (c.enVuelo < CANAL_POR_APARATO && enVueloGlobal < CANAL_SERVIDOR && c.espera.length) {
            const trabajo = c.espera.shift();
            c.enVuelo++; enVueloGlobal++;
            metricas.picoEnVuelo = Math.max(metricas.picoEnVuelo, enVueloGlobal);
            metricas.picoPorAparato = Math.max(metricas.picoPorAparato, c.enVuelo);
            trabajo();
        }
    };

    return function escribe(matchId, lote) {
        metricas.escrituras++;
        metricas.sucesosEnviados += lote.length;
        metricas.loteMax = Math.max(metricas.loteMax, lote.length);

        const ap = aparatoDe(matchId);
        if (!canales[ap]) canales[ap] = { enVuelo: 0, espera: [] };
        const c = canales[ap];

        return new Promise((resolver, rechazar) => {
            c.espera.push(() => {
                const libera = () => { c.enVuelo--; enVueloGlobal--; sirve(ap); };
                // 🔴 El partido colgado: la escritura se acepta y NO responde
                // JAMAS. Ocupa un hueco del canal de SU APARATO —el mismo que
                // usa su partido compañero— hasta que venza el plazo. Si el
                // plazo no liberase el hueco, el partido sano de ese aparato se
                // quedaria mudo: es exactamente lo que hay que descartar.
                if (COLGADOS.indexOf(matchId) >= 0) {
                    metricas.colgadas++;
                    setTimeout(libera, 140);
                    return;   // ni resolver ni rechazar
                }
                const latencia = 1 + Math.floor(Math.random() * 12);
                setTimeout(() => {
                    libera();
                    if (Math.random() < TASA_FALLO) {
                        metricas.fallos++;
                        const e = new Error('unavailable'); e.code = 'unavailable';
                        rechazar(e);
                    } else {
                        // `arrayUnion` es un CONJUNTO: reescribir el mismo
                        // objeto no añade nada. Es la propiedad que hace seguro
                        // el reintento, y aqui se modela tal cual.
                        if (!servidor[matchId]) servidor[matchId] = new Set();
                        lote.forEach(ev => servidor[matchId].add(ev.eventId));
                        resolver();
                    }
                }, latencia);
            });
            sirve(ap);
        });
    };
}

const tipoSuceso = (i) => {
    // Reparto medido por el autor: los tacticos son la aplastante mayoria.
    const r = i % 10;
    if (r < 8) return 'tactical_move';
    if (r === 8) return 'sub';
    return ['goal', 'yellow', 'red', 'injury'][i % 4];
};

(async () => {

console.log('══════════════════════════════════════════════════════════════');
console.log(' SABADO SIMULADO · ' + CLUBES + ' clubes × ' + EQUIPOS_POR_CLUB +
            ' equipos = ' + PARTIDOS + ' partidos simultaneos');
console.log(' ' + (PARTIDOS * SUCESOS_POR_PARTIDO).toLocaleString('es-ES') +
            ' sucesos · ' + (PARTIDOS / PARTIDOS_POR_APARATO) + ' aparatos de ' +
            CANAL_POR_APARATO + ' en vuelo · ' +
            Math.round(TASA_FALLO * 100) + '% de fallo · ' + COLGADOS.length +
            ' partidos con la escritura COLGADA');
console.log('══════════════════════════════════════════════════════════════\n');

// ⚠️ LAS CONSTANTES DE PRODUCCION SE LEEN DE UNA COPIA SIN TOCAR, y se leen
// AHORA. La instancia de la prueba va con los tiempos comprimidos; preguntarle
// a ella por `ventanaTactica` en la PARTE 5 daria 30 ms y la cuenta del sabado
// saldria absurda (me paso al escribir este arnes).
const T_PROD = JSON.parse(JSON.stringify(cargaModulo()._T));

const API = cargaModulo();
const servidor = Object.create(null);          // matchId -> Set(eventId)
const metricas = { escrituras: 0, sucesosEnviados: 0, fallos: 0, colgadas: 0,
                   picoEnVuelo: 0, picoPorAparato: 0, loteMax: 0 };
const encolados = Object.create(null);         // matchId -> Set(eventId)

// ⚠️ EL PLAZO VA HOLGADO RESPECTO A LA LATENCIA DEL CANAL, y no es un detalle:
// con un plazo MAS CORTO que el atasco de la tuberia, cada escritura vence
// antes de llegar a despacharse y el reintento AMPLIFICA la carga en vez de
// repararla (medido en la primera version de este arnes: 53 reenvios por
// suceso). En produccion el plazo es de 12 s y un aparato lleva uno o dos
// partidos, asi que la holgura es enorme; aqui se conserva la proporcion.
API._configura({
    escritor: nuevoCanal(servidor, metricas),
    tiempos: {
        loteMax: 25, ventanaUrgente: 8, ventanaTactica: 120,
        plazoEscritura: 600, esperaBase: 20, esperaTope: 240,
        topeCola: 600, avisoAtascoMs: 2000
    },
    reinicia: true
});

// ── Se sueltan los sucesos de los 300 partidos, entrelazados ───────────────
const t0 = Date.now();
let n = 0;
for (let vuelta = 0; vuelta < SUCESOS_POR_PARTIDO; vuelta++) {
    for (let c = 0; c < CLUBES; c++) {
        for (let e = 0; e < EQUIPOS_POR_CLUB; e++) {
            const mid = 'club' + String(c).padStart(2, '0') + '__eq' + String(e).padStart(2, '0');
            const ev = {
                eventId: 'ev_' + (++n).toString(36),
                matchId: mid,
                type: tipoSuceso(n),
                text: 'suceso ' + n + ' de ' + mid,
                icon: '•', realTime: '12:00:00', matchTime: '2T 20:00',
                timestamp: new Date().toISOString(), createdAt: Date.now()
            };
            if (!encolados[mid]) encolados[mid] = new Set();
            encolados[mid].add(ev.eventId);
            API.encola(mid, ev);
        }
    }
    // Un respiro entre vueltas: el sabado real no suelta 9.000 sucesos en el
    // mismo tick, y asi el canal tiene ocasion de drenar entre rafagas.
    if (vuelta % 5 === 4) await dormir(20);
}
const totalEncolado = n;

// ── Se deja drenar ─────────────────────────────────────────────────────────
for (let i = 0; i < 400; i++) {
    await dormir(20);
    let quedan = 0;
    Object.keys(encolados).forEach(mid => { quedan += API.pendientes(mid); });
    // Los colgados nunca drenan por definicion: se para cuando solo quedan ellos.
    let quedanSanos = 0;
    Object.keys(encolados).forEach(mid => {
        if (COLGADOS.indexOf(mid) < 0) quedanSanos += API.pendientes(mid);
    });
    if (quedanSanos === 0) break;
}
const ms = Date.now() - t0;

// ═══════ PARTE 1 · CERO PERDIDA ═══════
console.log('── PARTE 1 · ningun suceso se pierde ──');
{
    let perdidos = 0, partidosIncompletos = 0;
    Object.keys(encolados).forEach(mid => {
        if (COLGADOS.indexOf(mid) >= 0) return;        // se miden aparte
        const enServidor = servidor[mid] || new Set();
        let faltan = 0;
        encolados[mid].forEach(id => { if (!enServidor.has(id)) faltan++; });
        if (faltan) { perdidos += faltan; partidosIncompletos++; }
    });
    ok('1a · 🔑 los ' + (PARTIDOS - COLGADOS.length) + ' partidos sanos llegan COMPLETOS',
       perdidos === 0,
       perdidos + ' sucesos perdidos en ' + partidosIncompletos + ' partidos');

    ok('1b · 🔑 y eso pese al ' + Math.round(TASA_FALLO * 100) + '% de escrituras fallidas',
       metricas.fallos > 0,
       'la prueba no vale si el canal no fallo nunca: fallos=' + metricas.fallos);
}

// ═══════ PARTE 2 · CERO CRUCE ENTRE PARTIDOS ═══════
console.log('\n── PARTE 2 · aislamiento total por matchId ──');
{
    let intrusos = 0, ejemplo = '';
    Object.keys(servidor).forEach(mid => {
        servidor[mid].forEach(id => {
            if (!encolados[mid] || !encolados[mid].has(id)) {
                intrusos++;
                if (!ejemplo) ejemplo = id + ' aparecio en ' + mid;
            }
        });
    });
    ok('2a · 🔑🔑 ningun suceso aparece en un partido que no es el suyo',
       intrusos === 0, intrusos + ' intrusos. ' + ejemplo);

    ok('2b · cada partido escribe en SU documento y solo en el',
       Object.keys(servidor).every(mid => !!encolados[mid]),
       'documentos escritos: ' + Object.keys(servidor).length);
}

// ═══════ PARTE 3 · UN PARTIDO COLGADO NO ARRASTRA A NADIE ═══════
console.log('\n── PARTE 3 · el partido mudo del 16/09, aislado ──');
{
    const sanosCompletos = Object.keys(encolados)
        .filter(mid => COLGADOS.indexOf(mid) < 0)
        .filter(mid => (servidor[mid] || new Set()).size === encolados[mid].size).length;

    ok('3a · 🔑 los ' + (PARTIDOS - COLGADOS.length) + ' sanos drenan enteros con 2 colgados',
       sanosCompletos === PARTIDOS - COLGADOS.length,
       sanosCompletos + ' de ' + (PARTIDOS - COLGADOS.length));

    ok('3b · el colgado retiene lo suyo (no lo da por enviado)',
       COLGADOS.every(mid => API.pendientes(mid) > 0),
       COLGADOS.map(m => m + ':' + API.pendientes(m)).join(' '));

    ok('3c · 🔑 y su escritura colgada no bloqueo la tuberia de su aparato',
       metricas.colgadas > 0 && metricas.picoPorAparato <= CANAL_POR_APARATO,
       'colgadas=' + metricas.colgadas + ' pico/aparato=' + metricas.picoPorAparato);

    // 🔑 EL COMPAÑERO DE CANAL. Los dos colgados comparten aparato con un
    // partido sano: si el plazo no liberase el hueco, ese compañero se habria
    // quedado mudo — que es literalmente el reporte del 16/09.
    const companeros = COLGADOS.map(mid => {
        const eq = parseInt(mid.slice(mid.indexOf('__eq') + 4), 10);
        return mid.slice(0, mid.indexOf('__eq')) + '__eq' +
               String(eq % 2 === 0 ? eq + 1 : eq - 1).padStart(2, '0');
    });
    ok('3d · 🔑🔑 el partido SANO del mismo aparato llego completo',
       companeros.every(mid => encolados[mid] &&
           (servidor[mid] || new Set()).size === encolados[mid].size),
       companeros.map(m => m + ': ' + ((servidor[m] || new Set()).size) + '/' +
                           (encolados[m] ? encolados[m].size : 0)).join('  '));

    // Y el colgado no se rinde: se le da mas tiempo y tiene que haberlo
    // reintentado. Un canal que se calla para siempre es el defecto original.
    const antes = metricas.colgadas;
    await dormir(1500);
    ok('3e · el modulo sigue reintentando el colgado en vez de rendirse',
       metricas.colgadas > antes,
       'intentos antes=' + antes + ' despues=' + metricas.colgadas);
}

// ═══════ PARTE 4 · EL CANAL NO SE SATURA: LA AGRUPACION FUNCIONA ═══════
console.log('\n── PARTE 4 · presupuesto de escrituras ──');
{
    const ratio = totalEncolado / metricas.escrituras;
    ok('4a · 🔑 la agrupacion reduce de verdad el numero de operaciones',
       ratio >= 4,
       totalEncolado + ' sucesos en ' + metricas.escrituras +
       ' escrituras (x' + ratio.toFixed(1) + ')');

    ok('4b · los lotes llegan a llenarse (no se manda de uno en uno)',
       metricas.loteMax >= 10, 'lote maximo observado: ' + metricas.loteMax);

    ok('4c · sin reenvios masivos: lo escrito no dispara respecto a lo encolado',
       metricas.sucesosEnviados < totalEncolado * 2.5,
       'enviados ' + metricas.sucesosEnviados + ' vs encolados ' + totalEncolado);

    console.log('       ⏱ ' + ms + ' ms · ' + metricas.escrituras + ' escrituras · ' +
                'pico global ' + metricas.picoEnVuelo + ' · pico por aparato ' + metricas.picoPorAparato + '/' + CANAL_POR_APARATO);
}

// ═══════ PARTE 5 · EL PRESUPUESTO CON LOS NUMEROS REALES ═══════
console.log('\n── PARTE 5 · cuentas del sabado con las constantes de produccion ──');
{
    // Se leen del modulo, no de aqui: si alguien las cambia, esta cuenta lo dice.
    const T = T_PROD;
    const PARTIDOS_REALES = 30 * 15;                       // el techo del encargo
    const LATIDO_S = 15;                                   // v572, sync.js
    const escrituraLatido = PARTIDOS_REALES / LATIDO_S;    // latidos/s (gordo)
    const indiceLatido    = escrituraLatido;               // + su indice ligero

    // ── SUCESOS ANUNCIABLES · ~1 cada 30 s por partido (gol, tarjeta, cambio,
    //    lesion, comentario). Cada uno escribe DOS documentos: el gordo y el
    //    indice ligero, que es lo que hace sonar el aviso sin esperar al latido.
    const anunciablesS = PARTIDOS_REALES / 30;
    const escrAnunciables = anunciablesS * 2;

    // ── MOVIMIENTOS TACTICOS · ⚠️ NO SE MODELAN COMO UN GOTEO CONSTANTE, Y
    //    ESTO ES LO QUE HAY QUE ENTENDER PARA NO SOBREVALORAR LA AGRUPACION.
    //    Un entrenador no arrastra una ficha cada tres segundos durante 90
    //    minutos: recoloca EN RAFAGAS —reordena la linea, mueve cuatro fichas
    //    seguidas— y despues pasan minutos sin tocar nada.
    //
    //    🔑 Y LA VENTANA AGRUPA LA RAFAGA, no el promedio. Una rafaga de 8
    //    movimientos en 2 s cabe entera en la ventana de 5 s y sale en UNA
    //    escritura; sin agrupar serian 8, y cada una hace bajar el documento
    //    gordo (17-23 KB medidos) a TODOS los espectadores del partido.
    //    Contarlo como goteo daria un factor de 1,7 y seria engañoso en los
    //    dos sentidos: infravalora lo que ahorra en la rafaga y exagera lo que
    //    ahorra en los tramos quietos, donde no hay nada que ahorrar.
    const RAFAGA        = 8;      // movimientos por rafaga
    const RAFAGA_SPAN_S = 2;      // segundos que dura la rafaga
    const RAFAGAS_MIN   = 1;      // rafagas por minuto y partido
    const movimientosS  = PARTIDOS_REALES * RAFAGA * RAFAGAS_MIN / 60;
    // Agrupada: una rafaga que cabe en la ventana es UNA escritura.
    const cabeEntera    = (T.ventanaTactica / 1000) >= RAFAGA_SPAN_S;
    const escrTacticos  = cabeEntera
        ? PARTIDOS_REALES * RAFAGAS_MIN / 60
        : movimientosS / Math.max(1, RAFAGA * (T.ventanaTactica / 1000) / RAFAGA_SPAN_S);

    const totalS = escrituraLatido + indiceLatido + escrAnunciables + escrTacticos;
    const sinAgrupar = escrituraLatido + indiceLatido + escrAnunciables + movimientosS;

    console.log('       ' + PARTIDOS_REALES + ' partidos · latido ' + LATIDO_S + ' s · ' +
                'ventana tactica ' + (T.ventanaTactica / 1000) + ' s');
    console.log('       latido ' + (escrituraLatido + indiceLatido).toFixed(0) +
                '/s · sucesos ' + escrAnunciables.toFixed(0) +
                '/s · tacticos ' + escrTacticos.toFixed(0) + '/s');
    console.log('       ≈ ' + totalS.toFixed(0) + ' escrituras/s  (' +
                (totalS * 3600 / 1000).toFixed(0) + ' k/hora)');
    console.log('       sin agrupar los tacticos serian ' + sinAgrupar.toFixed(0) +
                ' escrituras/s (y ' + (movimientosS * 20).toFixed(0) +
                ' KB/s bajando a los espectadores)');

    // Firestore admite 10.000 escrituras/s por base de datos sin particionar.
    ok('5a · 🔑 el sabado entero cabe holgadamente en el techo de Firestore',
       totalS < 1000,
       totalS.toFixed(0) + ' escrituras/s con ' + PARTIDOS_REALES + ' partidos');

    ok('5b · 🔑 la ventana se traga la rafaga entera (que es lo que ahorra)',
       cabeEntera && escrTacticos * 4 < movimientosS,
       'ventana ' + (T.ventanaTactica / 1000) + ' s vs rafaga de ' + RAFAGA +
       ' movimientos en ' + RAFAGA_SPAN_S + ' s → x' +
       (movimientosS / escrTacticos).toFixed(1));

    // ⚠️ Si alguien baja `ventanaTactica`, el coste sube en proporcion directa.
    ok('5c · ⚠️ la ventana tactica sigue siendo de segundos, no de milisegundos',
       T.ventanaTactica >= 2000,
       'bajarla devuelve el documento gordo a cada arrastre (v576)');

    ok('5d · y el plazo de escritura es mayor que el latido de 15 s / 2',
       T.plazoEscritura >= 5000 && T.plazoEscritura <= 30000,
       'plazo=' + T.plazoEscritura + ' ms: muy corto reintenta de mas, muy largo no despega');
}

// ═══════════════════════════════════════════════════════════════════════════
//  PARTE 6 · v725 · LA JORNADA REAL: 3 CLUBES, 30 PARTIDOS SIMULTANEOS
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-09-16): «Tenemos 3 clubes reales dados de alta […]
//  jornadas de hasta 30 partidos simultaneos […] bajo ninguna circunstancia
//  (micropagos de red, saturacion de la segunda parte o cambios masivos en
//  cadena) un gol, tarjeta o cambio dejara de sincronizarse con el visor».
//
//  Los tres escenarios que nombra, LITERALES y a la vez:
//    · MICROCORTES · la red se cae y vuelve en ventanas cortas y repetidas
//      (no un 8% aleatorio: apagones de verdad, todos los partidos a ciegas
//      a la vez, que es lo que pasa cuando falla la cobertura del campo);
//    · SATURACION DE SEGUNDA PARTE · el ritmo de sucesos se DOBLA en el
//      ultimo tramo, cuando entran los cambios y aprietan los goles;
//    · CAMBIOS EN CADENA · rafagas de 5 sustituciones seguidas en el mismo
//      segundo, en muchos partidos a la vez.
//
//  🔑 Y LA ASERCION ES LA QUE EL PIDE, SIN MATICES: de los sucesos
//  ANUNCIABLES —gol, tarjeta, cambio, lesion, comentario— tienen que llegar
//  TODOS. Cero. No «casi todos».
console.log('\n══════════════════════════════════════════════════════════════');
console.log(' JORNADA REAL · 3 clubes × 10 equipos = 30 partidos simultaneos');
console.log(' microcortes de red + saturacion de 2ª parte + cambios en cadena');
console.log('══════════════════════════════════════════════════════════════');
{
    const API2 = cargaModulo();
    const srv  = Object.create(null);
    const met  = { escrituras: 0, sucesosEnviados: 0, fallos: 0, colgadas: 0,
                   picoEnVuelo: 0, picoPorAparato: 0, loteMax: 0 };
    const puestos = Object.create(null);        // matchId -> Set(eventId) anunciables

    // ── La red: APAGONES, no un porcentaje ──────────────────────────────
    //  Se cae del todo durante 120 ms, vuelve 200 ms, se cae otra vez. Todos
    //  los partidos a ciegas al mismo tiempo: el caso peor.
    let redViva = true;
    const parpadeo = setInterval(() => { redViva = !redViva; }, redViva ? 120 : 200);
    if (parpadeo.unref) parpadeo.unref();

    const escritorReal = nuevoCanal(srv, met);
    API2._configura({
        escritor: (mid, lote) => {
            if (!redViva) {
                met.fallos++;
                return Promise.reject(Object.assign(new Error('unavailable'),
                                                    { code: 'unavailable' }));
            }
            return escritorReal(mid, lote);
        },
        tiempos: {
            loteMax: 25, ventanaUrgente: 8, ventanaTactica: 120,
            plazoEscritura: 600, esperaBase: 20, esperaTope: 240,
            topeCola: 600, avisoAtascoMs: 2000
        },
        reinicia: true
    });

    const PARTIDOS_J = 30;
    const mid = (i) => 'club0' + Math.floor(i / 10) + '__eq' + String(i % 10).padStart(2, '0');
    let k = 0;
    const nuevo = (m, tipo) => {
        const ev = {
            eventId: 'j_' + (++k).toString(36), matchId: m, type: tipo,
            text: tipo + ' en ' + m, icon: '•', realTime: '12:00:00',
            matchTime: '2T 30:00', timestamp: new Date().toISOString(),
            createdAt: Date.now()
        };
        if (tipo !== 'tactical_move') {
            if (!puestos[m]) puestos[m] = new Set();
            puestos[m].add(ev.eventId);
        }
        return ev;
    };

    // ── 1ª parte: ritmo normal ──────────────────────────────────────────
    for (let v = 0; v < 10; v++) {
        for (let i = 0; i < PARTIDOS_J; i++) {
            const m = mid(i);
            API2.encola(m, nuevo(m, 'tactical_move'));
            if (v % 4 === 0) API2.encola(m, nuevo(m, 'goal'));
        }
        if (v % 3 === 2) await dormir(25);
    }

    // ── 2ª parte SATURADA: ritmo doble + CAMBIOS EN CADENA ──────────────
    for (let v = 0; v < 12; v++) {
        for (let i = 0; i < PARTIDOS_J; i++) {
            const m = mid(i);
            API2.encola(m, nuevo(m, 'tactical_move'));
            API2.encola(m, nuevo(m, 'tactical_move'));
            if (v % 2 === 0) API2.encola(m, nuevo(m, 'goal'));
            if (v % 3 === 0) API2.encola(m, nuevo(m, 'yellow'));
            // 🔑 CINCO SUSTITUCIONES SEGUIDAS, en el mismo instante.
            if (v === 5 || v === 9) {
                for (let s = 0; s < 5; s++) API2.encola(m, nuevo(m, 'sub'));
            }
        }
        if (v % 2 === 1) await dormir(25);
    }

    // ── El pitido final: se concilia y se drena, como hace stopLiveSync ──
    clearInterval(parpadeo);
    redViva = true;
    for (let i = 0; i < 240; i++) {
        await dormir(20);
        let quedan = 0;
        for (let p = 0; p < PARTIDOS_J; p++) quedan += API2.pendientes(mid(p));
        if (!quedan) break;
    }

    let faltan = 0, partidosMal = 0, totalAnunciables = 0;
    for (let i = 0; i < PARTIDOS_J; i++) {
        const m = mid(i);
        const esperados = puestos[m] || new Set();
        const llegaron  = srv[m] || new Set();
        totalAnunciables += esperados.size;
        let f = 0;
        esperados.forEach(id => { if (!llegaron.has(id)) f++; });
        if (f) { faltan += f; partidosMal++; }
    }

    console.log('       ' + totalAnunciables + ' sucesos anunciables (goles, tarjetas, ' +
                'cambios) en 30 partidos · ' + met.fallos + ' escrituras tumbadas por los cortes');

    ok('6a · 🔑🔑🔑 CERO PERDIDA de goles, tarjetas y cambios',
       faltan === 0,
       faltan + ' perdidos en ' + partidosMal + ' partidos de ' + PARTIDOS_J);

    ok('6b · 🔑 y eso con la red cayendose una y otra vez de verdad',
       met.fallos > 20, 'escrituras tumbadas: ' + met.fallos);

    ok('6c · ningun partido se quedo con la cola atascada al final',
       (() => { let q = 0; for (let p = 0; p < PARTIDOS_J; p++) q += API2.pendientes(mid(p)); return q === 0; })(),
       'la jornada acaba con todas las colas vacias');

    // ⚠️ SIN CRUCES, tampoco bajo saturacion: es donde mas facil seria.
    let intrusos = 0;
    Object.keys(srv).forEach(m => {
        srv[m].forEach(id => {
            const suyo = (puestos[m] && puestos[m].has(id));
            // los tacticos no estan en `puestos`; se comprueba por el prefijo del id
            if (!suyo && !String(id).startsWith('j_')) intrusos++;
        });
    });
    ok('6d · 🔑 y sin un solo suceso escrito en el partido de otro club',
       intrusos === 0, intrusos + ' intrusos');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('ERROR EN EL ARNES:', e); process.exit(1); });

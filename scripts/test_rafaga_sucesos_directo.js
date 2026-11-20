// ═══════════════════════════════════════════════════════════════════════════
//  🚀 v854 · UNA RÁFAGA DE SUCESOS LLEGA AL VISOR TAN RÁPIDO COMO EL PRIMERO
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-11-20): el primer suceso (gol, cambio, tarjeta…)
//  llegaba a live.html en 1-2 s, pero en una ráfaga el 2º y el 3º tardaban
//  3-4 s MÁS. Causa: los dos caminos de emisión iban en FILA INDIA esperando
//  acuses del servidor:
//   · la cola de sucesos (js/match/live/outbox.js): UNA escritura en vuelo por
//     partido, y el vuelo no acababa hasta DOS acuses (gordo + live_index);
//   · el latido (js/match/live/sync.js · pushLiveSnapshot): la pasada pedida
//     por el 2º suceso no se construía hasta los acuses de la anterior.
//
//  Este guard EJECUTA el código real con un servidor simulado que tarda en
//  acusar (latencia realista) y comprueba que en una ráfaga de 4 sucesos en
//  menos de 2 s ninguno queda retenido detrás del acuse del anterior, sin
//  perder la fila india cuando la red falla ni duplicar nada.
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

function nuevaCola() {
    const almacen = new Map();
    const ventana = { _cronos_auth: null, showToast: () => {}, _cronosRecortaSuceso: (e) => e };
    const sandbox = {
        window: ventana,
        console: { warn: () => {}, log: () => {}, error: () => {} },
        setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Error, Object, Array, String,
        localStorage: {
            getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
            setItem: (k, v) => almacen.set(k, String(v)),
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

let n = 0;
const suceso = (tipo) => ({ eventId: 'ev_' + (++n), type: tipo, text: tipo, createdAt: Date.now() });

(async () => {

// ═══════ PARTE 1 · la cola de sucesos con los tiempos de PRODUCCIÓN ═══════
console.log('── PARTE 1 · ráfaga gol + cambio + tarjeta + lesión en 1,2 s (acuse 900 ms) ──');
{
    const API = nuevaCola();
    const ACUSE_MS = 900;          // un servidor lento pero normal desde un campo
    const T = API._T;
    ok('1a · tiempos de producción intactos (ventana 350 ms, plazo 12 s)',
       T.ventanaUrgente === 350 && T.plazoEscritura === 12000 && T.ventanaTactica === 5000);

    const salida = {}, llegada = {}, veces = {};
    let enCurso = 0, picoEnCurso = 0, escrituras = 0;
    API._configura({
        escritor: (mid, lote) => {
            escrituras++; enCurso++; picoEnCurso = Math.max(picoEnCurso, enCurso);
            const t = Date.now();
            lote.forEach(e => { salida[e.eventId] = t; veces[e.eventId] = (veces[e.eventId] || 0) + 1; });
            return new Promise(res => setTimeout(() => {
                enCurso--;
                lote.forEach(e => { llegada[e.eventId] = Date.now(); });
                res();
            }, ACUSE_MS));
        }
    });

    const rafaga = [suceso('goal'), suceso('sub'), suceso('yellow'), suceso('injury')];
    const encolado = {};
    for (let i = 0; i < rafaga.length; i++) {
        encolado[rafaga[i].eventId] = Date.now();
        API.encola('partido-R', rafaga[i]);
        if (i < rafaga.length - 1) await dormir(400);   // 4 sucesos en 1,2 s
    }
    await dormir(ACUSE_MS + 900);

    const esperas = rafaga.map(e => salida[e.eventId] - encolado[e.eventId]);
    const totales = rafaga.map(e => llegada[e.eventId] - encolado[e.eventId]);
    ok('1b · 🔑 NINGÚN suceso espera al acuse del anterior para salir (< 600 ms cada uno)',
       esperas.every(ms => ms < 600), 'esperas hasta salir: ' + esperas.join(', ') + ' ms');
    ok('1c · 🔑 el 2º, 3º y 4º llegan tan rápido como el 1º (≤ ventana + acuse + 250 ms)',
       totales.every(ms => ms <= 350 + ACUSE_MS + 250), 'hasta el acuse: ' + totales.join(', ') + ' ms');
    ok('1d · todos llegan exactamente UNA vez', rafaga.every(e => veces[e.eventId] === 1),
       JSON.stringify(veces));
    ok('1e · la cola queda vacía y sin vuelos', API.pendientes('partido-R') === 0 &&
       API.estado('partido-R')['partido-R'].vuelos === 0);
    ok('1f · nunca más escrituras simultáneas que vuelosMax (' + T.vuelosMax + ')',
       picoEnCurso >= 2 && picoEnCurso <= T.vuelosMax, 'pico=' + picoEnCurso);
    ok('1g · sin escrituras de más: una por suceso como mucho', escrituras <= rafaga.length,
       escrituras + ' escrituras');
}

// ═══════ PARTE 2 · sucesos simultáneos se siguen agrupando ═══════
console.log('\n── PARTE 2 · tres sucesos en el mismo instante → UNA escritura ──');
{
    const API = nuevaCola();
    const lotes = [];
    API._configura({ escritor: (mid, lote) => { lotes.push(lote.length); return dormir(300); } });
    API.encola('partido-S', suceso('goal'));
    API.encola('partido-S', suceso('sub'));
    API.encola('partido-S', suceso('sub'));
    await dormir(900);
    ok('2a · 🔑 la ventana de 350 ms sigue agrupando lo simultáneo (ahorro de v724)',
       lotes.length === 1 && lotes[0] === 3, JSON.stringify(lotes));
}

// ═══════ PARTE 3 · con la red caída se vuelve a la fila india ═══════
console.log('\n── PARTE 3 · con fallos: una sola escritura a la vez y nada se pierde ──');
{
    const API = nuevaCola();
    let enCurso = 0, picoTrasFallo = 0, fallados = 0, huboFallo = false;
    const llegaron = new Set();
    API._configura({
        tiempos: { ventanaUrgente: 20, esperaBase: 40, esperaTope: 120 },
        escritor: (mid, lote) => {
            enCurso++;
            if (huboFallo) picoTrasFallo = Math.max(picoTrasFallo, enCurso);
            return dormir(60).then(() => {
                enCurso--;
                if (fallados < 4) { fallados++; huboFallo = true; throw new Error('unavailable'); }
                lote.forEach(e => llegaron.add(e.eventId));
            });
        }
    });
    const evs = [];
    for (let i = 0; i < 5; i++) { const e = suceso('goal'); evs.push(e); API.encola('partido-F', e); await dormir(30); }
    await dormir(2500);
    ok('3a · 🔑 tras un fallo nunca hay más de UNA escritura en curso (no se amplifica la carga)',
       picoTrasFallo <= 1 || picoTrasFallo === 0, 'pico tras fallo=' + picoTrasFallo);
    ok('3b · los 5 sucesos llegan pese a los 4 fallos', evs.every(e => llegaron.has(e.eventId)),
       llegaron.size + '/5');
    ok('3c · cola vacía al final', API.pendientes('partido-F') === 0);
}

// ═══════ PARTE 4 · drenaYa (fin de partido) espera a los vuelos en curso ═══════
console.log('\n── PARTE 4 · el fin de partido no se rinde si todo va ya en vuelo ──');
{
    const API = nuevaCola();
    API._configura({ tiempos: { ventanaUrgente: 10 }, escritor: () => dormir(200) });
    API.encola('partido-D', suceso('goal'));
    await dormir(40);                       // ya en vuelo
    const r = await API.drenaYa('partido-D', 1);
    ok('4a · 🔑 drenaYa resuelve true cuando el vuelo en curso acusa', r === true && API.pendientes('partido-D') === 0,
       'r=' + r);
}

// ═══════ PARTE 5 · el índice ligero no retiene el vuelo ═══════
console.log('\n── PARTE 5 · outbox.js: el acuse de live_index ya no se espera ──');
{
    const src = fs.readFileSync(path.join(ROOT, 'js/match/live/outbox.js'), 'utf8');
    const i = src.indexOf("fs.doc(fa.db, 'live_index', matchId)");
    const antes = src.slice(Math.max(0, i - 600), i);
    ok('5a · 🔑 la escritura de live_index no se devuelve (no forma parte del vuelo)',
       i > 0 && !/return\s+conPlazo\(\s*fs\.setDoc\(\s*$/.test(antes.trimEnd()) &&
       /\bconPlazo\(\s*fs\.setDoc\(\s*$/.test(antes.trimEnd()));
}

// ═══════ PARTE 6 · el latido real (pushLiveSnapshot) con un servidor lento ═══════
console.log('\n── PARTE 6 · sync.js: la pasada siguiente del latido no espera al acuse ──');
{
    const src = fs.readFileSync(path.join(ROOT, 'js/match/live/sync.js'), 'utf8');
    const ini = src.indexOf('const _PLAZO_LATIDO_MS');
    const fin = src.indexOf('async function _emiteLatido');
    ok('6a · se localiza el bloque de pushLiveSnapshot', ini > 0 && fin > ini);
    const ACUSE_MS = 900, CONSTRUYE_MS = 60;
    const construidas = [], acusadas = [];
    const sandbox = {
        setTimeout, clearTimeout, Promise, Date, console: { warn: () => {}, log: () => {} },
        _emiteLatido: async (status) => {
            await dormir(CONSTRUYE_MS);
            const k = construidas.length;
            construidas.push(Date.now());
            const acuse = dormir(ACUSE_MS).then(() => { acusadas[k] = Date.now(); });
            return { acuse };
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(src.slice(ini, fin) + '\nthis.pushLiveSnapshot = pushLiveSnapshot;', sandbox,
                    { filename: 'sync.js(pushLiveSnapshot)' });
    const t0 = Date.now();
    // Las tres en el MISMO turno: así el 2º y el 3º caen SIEMPRE dentro de la
    // construcción de la 1ª, aunque la máquina vaya cargada (con esperas de
    // 10 ms entre medias, bajo la suite completa a veces llegaban tarde y se
    // abría una 3ª pasada legítima: el test fallaba por el reloj, no por el código).
    const p1 = sandbox.pushLiveSnapshot('active');    // gol
    const p2 = sandbox.pushLiveSnapshot('active');    // cambio, en plena pasada
    const p3 = sandbox.pushLiveSnapshot('active');    // tarjeta
    let r1 = null; p1.then(() => { r1 = Date.now(); });
    await Promise.all([p1, p2, p3]);
    await dormir(50);
    ok('6b · 🔑 la 2ª pasada se construye SIN esperar el acuse de la 1ª (< 600 ms; esperándolo serían > 900)',
       construidas.length >= 2 && (construidas[1] - t0) < 600,
       'pasadas=' + construidas.length + ' 2ª a los ' + (construidas[1] - t0) + ' ms');
    ok('6c · las pasadas solapadas se FUSIONAN (2 escrituras para 3 peticiones, no 3)',
       construidas.length === 2, 'pasadas=' + construidas.length);
    ok('6d · pushLiveSnapshot sigue resolviendo DESPUÉS de los acuses (v718)',
       r1 !== null && acusadas.length === construidas.length && acusadas.every(t => t && t <= r1),
       'r1=' + (r1 - t0) + ' acuses=' + acusadas.map(t => t - t0).join(','));
    ok('6e · toda la ráfaga confirmada en < 1,5 s', (r1 - t0) < 1500, (r1 - t0) + ' ms');
}

console.log('\n' + pass + '/' + (pass + fail) + ' OK');
process.exit(fail ? 1 : 0);
})();

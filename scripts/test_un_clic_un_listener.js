// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v719 · UN CLIC, UN LISTENER (Y EL RELOJ NUEVO EMPIEZA EN CERO)
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-15, capturas 10429-10433, sobre
//  PRODUCCIÓN v718):
//   · «los botones de la barra superior (Empezar, Reanudar, Pausar) NO SIEMPRE
//     ejecutan la acción de forma inmediata al pulsarlos, quedando el
//     cronómetro estático»;
//   · «al iniciar el partido o al pasar de la primera a la segunda parte, el
//     cronómetro debe arrancar y responder al instante SIN OBLIGAR AL USUARIO
//     A SALIR AL PANEL DEL ENTRENADOR ni usar Recuperar Partido»;
//   · «revisar los listeners de eventos de la barra de control superior».
//
//  📏 LA MEDICIÓN QUE LO RESUELVE, y está en su propia frase. `init()` llama a
//  `setupEventListeners()`, e `init()` se invoca desde CUATRO sitios:
//  `unlockApp`, el arranque de rol (role-launch.js, dos veces), los informes
//  del Director y el diagnóstico. Cada pasada hacía
//  `window.onPlayPauseClick = function…` —una función NUEVA cada vez— y la
//  registraba con `addEventListener`. El navegador sólo ignora el registro
//  repetido cuando es LA MISMA referencia, y aquí nunca lo era.
//
//  🔑🔑 CON DOS LISTENERS, UN CLIC LLAMA DOS VECES A `toggleGame()`: la
//  bandera va false → true → false. El reloj NO arranca y el botón se queda
//  como estaba. Con TRES vuelve a ir. O sea que depende de la PARIDAD — y
//  salir a los roles y volver a entrar la cambia, que es EXACTAMENTE el apaño
//  que él describe como molestia («sin obligar a salir al panel»).
//
//  ⚠️ Y no era sólo el play/pause: se duplicaban REINICIAR (preguntaba dos
//  veces), GUARDAR, DESCARGAR y —lo que hace daño de verdad— el
//  `visibilitychange`, que al volver a la pestaña suma los segundos perdidos
//  por throttling: con dos copias los sumaba DOS VECES, y de ahí los «saltos».
//
//  📏 MEDICIÓN B (captura 10429): partido recién creado, todas las fichas a
//  00:00 y las dos partes a 05:00… y el botón decía **REANUDAR**. Es una
//  REGRESIÓN MÍA DE v716: `_cronosNuevoPartidoDeEquipo` escribía 'EMPEZAR' a
//  mano y dos líneas después llamaba a `updateMasterUI()`, que desde v716
//  repinta el botón DESDE EL ESTADO — y una de las señales del pintor, la
//  marca de «ya se pulsó» (`_cronosUltimoToggleLocal`, v714), es del NAVEGADOR
//  y sobrevive de un partido al siguiente.
//
//  LO QUE VIGILA:
//   A · el enganche de los cuatro botones DESENGANCHA antes de enganchar, así
//       que ni cuatro `init()` pueden duplicarlo;
//   B · los oyentes de documento/ventana se instalan UNA sola vez;
//   C · ejecutado: con el enganche nuevo, N pasadas de la instalación dejan UN
//       solo listener, y un clic arranca el reloj de verdad;
//   D · un partido nuevo arranca con el reloj en cero Y el botón diciendo
//       EMPEZAR (la marca de «ya se pulsó» se borra).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 400));
        fallos++;
    }
}
function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    if (i < 0) return null;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}
const sinComentarios = (s) => String(s || '').replace(/^\s*\/\/.*$/gm, '');

const EVENTS = leer('js/core/event-listeners.js');
const TIMER  = leer('js/match/timer/core.js');
const APPINI = leer('js/core/app-init.js');
const LAUNCH = leer('js/services/auth/role-launch.js');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [A] el enganche no puede duplicarse ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const EV = sinComentarios(EVENTS);
    ok('1a · 🔑 existe el enganche con desenganche previo',
       /const _engancha = \(id, fn, clave\) =>/.test(EV) &&
       /removeEventListener\('click', previo\)/.test(EV),
       'sin quitar el anterior, cada init() añade otro listener al mismo botón');
    ok('1b · 🔑🔑 [A] los CUATRO botones de la barra pasan por él',
       /_engancha\('btn-play-pause'/.test(EV) && /_engancha\('btn-reset'/.test(EV) &&
       /_engancha\('btn-save-team'/.test(EV) && /_engancha\('btn-export'/.test(EV));
    ok('1c · ⚠️ y ya no queda ningún addEventListener de clic suelto en la barra',
       !/getElementById\('btn-(play-pause|reset|save-team|export)'\)\.addEventListener/.test(EV),
       'un enganche suelto vuelve a duplicarse en la siguiente pasada');
    ok('1d · 📏 la razón medida sigue en pie: init() se llama desde varios sitios',
       (leer('js/services/auth/role-launch.js').match(/init\(activeRole\)/g) || []).length >= 2 &&
       /setupEventListeners\(\);/.test(sinComentarios(APPINI)),
       'si algún día init() se llamara una sola vez, esto seguiría siendo correcto');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [B] los oyentes globales, una sola vez ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const EV = sinComentarios(EVENTS);
    ok('2a · 🔑 hay bandera de instalación para los oyentes de documento/ventana',
       /if \(window\._cronosListenersGlobalesPuestos\) return;/.test(EV) &&
       /window\._cronosListenersGlobalesPuestos = true;/.test(EV));
    ok('2b · 🔑🔑 [B] y va ANTES del visibilitychange, que es el que hacía daño ' +
       '(sumaba los segundos perdidos dos veces)',
       EV.indexOf('_cronosListenersGlobalesPuestos = true') <
       EV.indexOf("document.addEventListener('visibilitychange'"),
       'con dos copias, al volver a la pestaña el reloj saltaba el doble');
    ok('2c · ⚠️ pero DESPUÉS de los botones: esos se rehacen sin daño en cada ' +
       'init() y el guard de play/pause extrae ese trozo y lo ejecuta suelto',
       EV.indexOf("_engancha('btn-play-pause'") <
       EV.indexOf('_cronosListenersGlobalesPuestos = true'),
       'un return ahí arriba lo dejaba con «Illegal return statement» (medido)');
    ok('2d · el pagehide y el beforeunload quedan también dentro de la bandera',
       EV.indexOf('_cronosListenersGlobalesPuestos = true') <
       EV.indexOf("window.addEventListener('pagehide'"));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · [C] EJECUTADO: cuatro instalaciones, un solo clic ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // Se ejecuta el enganche REAL tantas veces como `init()` puede correr, y
    // se cuenta qué pasa con UN clic.
    // ⚠️ El corte termina EN EL SALTO DE LÍNEA de la última llamada: con un
    // «+ 120 caracteres» a ojo se colaba el principio de la sentencia
    // siguiente (`window.endFirstHalf = f…`) y el trozo no compilaba (medido).
    const _iniB = EVENTS.indexOf('const _engancha = (id, fn, clave) =>');
    const _finB = EVENTS.indexOf('\n', EVENTS.indexOf("_engancha('btn-export'"));
    const bloque = (_iniB >= 0 && _finB > _iniB) ? EVENTS.slice(_iniB, _finB) : '';
    ok('3a · se encuentra el bloque de enganche', bloque.length > 200);

    if (bloque) {
        const boton = {
            _listeners: [],
            addEventListener(ev, fn) { if (ev === 'click') this._listeners.push(fn); },
            removeEventListener(ev, fn) {
                if (ev !== 'click') return;
                const i = this._listeners.indexOf(fn);
                if (i >= 0) this._listeners.splice(i, 1);
            },
        };
        const ctx = {
            console, isRunning: false, _toggles: 0,
            resetMatch: () => {}, saveCurrentTeam: () => {}, exportData: () => {},
        };
        ctx.document = { getElementById: (id) => (id === 'btn-play-pause' ? boton : null) };
        ctx.window = {};
        // El manejador real hace lo que hace el de verdad: enrutar y togglear.
        ctx.window.onPlayPauseClick = function () { ctx._toggles++; ctx.isRunning = !ctx.isRunning; };
        vm.createContext(ctx);
        // CUATRO pasadas, como los cuatro caminos que llaman a init().
        // ⚠️ Cada pasada va en su propio bloque `{…}`: en el producto esto vive
        // DENTRO de `setupEventListeners`, así que su `const _engancha` se
        // declara de nuevo en cada llamada. Sin las llaves, la segunda pasada
        // aquí choca con «Identifier '_engancha' has already been declared»
        // (medido) — un artefacto del arnés, no del código.
        for (let i = 0; i < 4; i++) vm.runInContext('{\n' + bloque + '\n}', ctx);

        ok('3b · 🔑🔑 [C] tras CUATRO instalaciones queda UN solo listener',
           boton._listeners.length === 1, 'listeners=' + boton._listeners.length);

        // Un clic: se disparan todos los listeners registrados.
        boton._listeners.forEach(fn => fn());
        ok('3c · 🔑🔑 [C] y UN clic arranca el reloj de verdad (una sola llamada)',
           ctx._toggles === 1 && ctx.isRunning === true,
           'toggles=' + ctx._toggles + ' isRunning=' + ctx.isRunning);

        // El defecto, para que quede medido: con dos listeners se anulaba.
        boton._listeners.push(ctx.window.onPlayPauseClick);
        ctx.isRunning = false; ctx._toggles = 0;
        boton._listeners.forEach(fn => fn());
        ok('3d · 📏 [C] con DOS listeners el clic se anula a sí mismo (el defecto ' +
           'del reporte, reproducido)',
           ctx._toggles === 2 && ctx.isRunning === false,
           'es la paridad: con 2 no arranca, con 3 sí — y salir a los roles la cambiaba');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · [D] el reloj de un partido NUEVO ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fn = trozo(TIMER, 'function cronosRelojNuevoPartido()');
    ok('4a · se encuentra el arranque de reloj para partido nuevo', !!fn);

    if (fn) {
        const ctx = {
            console: { warn() {}, log() {} }, Date,
            isRunning: true,                 // lo que dejó el partido anterior
            masterTimeH1: 1800, masterTimeH2: 900,
            lastTickTime: 123456, matchPhase: 'finished',
            half1MaxTime: 300, half2MaxTime: 300,
            timerInterval: 7,
            clearInterval: () => { ctx._limpiados = (ctx._limpiados || 0) + 1; },
            updateMasterUI: () => { ctx._pintadoMaster = (ctx._pintadoMaster || 0) + 1; },
        };
        const boton = { textContent: 'PAUSAR', classList: { _c: { danger: 1 }, add(x) { this._c[x] = 1; }, remove(x) { delete this._c[x]; } } };
        ctx.document = { getElementById: (id) => (id === 'btn-play-pause' ? boton : null) };
        ctx.window = { _cronosUltimoToggleLocal: Date.now(),   // ⚠️ la marca del partido ANTERIOR
                       _cronosParaReloj: () => { ctx.timerInterval = null; ctx._parado = true; } };
        vm.createContext(ctx);
        vm.runInContext(trozo(TIMER, 'function cronosPintaBotonReloj()') + '\n' + fn +
                        ';\n;globalThis.nuevo = cronosRelojNuevoPartido;', ctx);
        ctx.nuevo();

        ok('4b · 🔑 el reloj queda a cero y parado',
           ctx.masterTimeH1 === 0 && ctx.masterTimeH2 === 0 &&
           ctx.isRunning === false && ctx.lastTickTime === 0);
        ok('4c · 🔑 la fase vuelve a la 1ª parte', ctx.matchPhase === '1st_half');
        ok('4d · 🔑 el intervalo se apaga por la puerta única de v716', ctx._parado === true);
        ok('4e · 🔑🔑 [D] SE BORRA la marca de «ya se pulsó» (era del navegador, ' +
           'no del partido)',
           ctx.window._cronosUltimoToggleLocal === 0);
        ok('4f · 🔑🔑 [D] y el botón dice EMPEZAR, no REANUDAR (el defecto de la ' +
           'captura 10429)',
           boton.textContent === 'EMPEZAR', JSON.stringify(boton.textContent));
        ok('4g · y pierde el rojo de PAUSAR', boton.classList._c.danger === undefined);

        ok('4h · 🔑 el camino del partido nuevo la usa',
           /cronosRelojNuevoPartido\(\)/.test(sinComentarios(APPINI)),
           'era donde se pintaba EMPEZAR a mano y updateMasterUI lo pisaba');
        ok('4i · ⚠️ y ya no se escribe el texto del botón a mano en ese camino',
           !/_btn\.textContent = 'EMPEZAR'/.test(sinComentarios(APPINI)),
           'pintar a mano y repintar del estado es cómo nació la regresión de v716');
        ok('4j · ⚠️ el respaldo (sin el módulo del reloj) SÍ deja el botón bien',
           /_b\.textContent = 'EMPEZAR'/.test(sinComentarios(APPINI)));
    }
}

console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }

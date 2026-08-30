// ─────────────────────────────────────────────────────────────────────────
//  test_autoactualizacion_pwa.js  ·  v645
//
//  LA APP SE ACTUALIZA SOLA AL ABRIRLA DESDE EL ICONO — y no interrumpe.
//
//  🚨 POR QUE ESTE GUARD **EJECUTA** EL BLOQUE EN VEZ DE MIRARLO
//
//  Aqui hay dos fallos posibles y los DOS son mudos:
//    · que no se compruebe al reanudar → el usuario se queda en una version
//      vieja para siempre, sin ningun error, y el unico remedio es borrar el
//      icono de la pantalla de inicio (que es como se descubrio);
//    · que se recargue cuando no debe → se lleva por delante un partido en
//      vivo o un formulario a medio rellenar. Eso YA PASO: es la v542, donde
//      la casilla del RGPD "aparecia y desaparecia" y no habia ningun script
//      ocultandola — era la recarga automatica.
//
//  Un guard de regex no distingue "llama a reload()" de "llama a reload() EN
//  EL MOMENTO BUENO", que es justo lo unico que importa. Asi que se monta un
//  navegador de mentira, se carga el bloque REAL de index.html y se le
//  simulan las situaciones: abrir desde el icono, volver con partido en
//  curso, volver despues de haber tocado la pantalla.
//
//  ⚠️ El bloque se EXTRAE de index.html, no se copia aqui. Copiarlo seria
//  probar una copia de la logica escrita en el propio test — el defecto que
//  documenta project_cuatro_correcciones_v620.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT  = path.join(__dirname, '..');
const HTML  = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

console.log('\n══ v645 · autoactualizacion de la PWA al abrir desde el icono ══');

// ── Extraccion del bloque real ───────────────────────────────────────────
const MARCA = 'v645 · LA APP SE ACTUALIZA SOLA AL ABRIRLA DESDE EL ICONO';
const iMarca = HTML.indexOf(MARCA);
// ⚠️ `indexOf` sin comprobar es una bomba en un guard: el -1 no falla, MIENTE
//    —y miente en direccion "hay una regresion". Lo aprendio 1g-0 del guard de
//    paridad cuando App Check movio su marca de corte.
ok('0a · la marca del bloque de autoactualizacion sigue en index.html', iMarca >= 0,
   'si esto falla, todo lo de abajo estaria midiendo otro trozo del fichero');
if (iMarca < 0) { console.log('\nResultado: ' + pass + '/' + (pass + fail) + '  ❌'); process.exit(1); }

const iIni = HTML.indexOf('(function() {', iMarca);
const iFin = HTML.indexOf('})();', iIni);
ok('0b · se puede acotar el bloque entero', iIni > 0 && iFin > iIni);
const BLOQUE = HTML.slice(iIni, iFin + 5);

// ── El navegador de mentira ──────────────────────────────────────────────
function montar(opciones) {
    const o = opciones || {};
    const est = {
        recargas: 0, updates: 0, skipWaiting: 0,
        oyentes: { window: {}, document: {}, sw: {} },
        bannerVisible: false, intervalos: [],
    };
    const registro = {
        waiting: o.waiting || null,
        update: () => { est.updates++; return Promise.resolve(); },
        addEventListener: () => {},
    };
    if (registro.waiting) registro.waiting.postMessage = () => { est.skipWaiting++; };

    const banner = { style: { display: 'none' } };
    const doc = {
        visibilityState: 'visible',
        addEventListener: (t, h) => { est.oyentes.document[t] = h; },
        getElementById: (id) => (id === 'update-banner' ? banner : null),
    };
    const win = {
        _cronosCurrentUser: o.usuario || null,
        cronosHayPartidoEnCurso: () => !!o.partidoEnCurso,
        addEventListener: (t, h) => { est.oyentes.window[t] = h; },
        location: { reload: () => { est.recargas++; } },
    };
    const nav = {
        serviceWorker: {
            controller: {},
            addEventListener: (t, h) => { est.oyentes.sw[t] = h; },
            getRegistration: () => Promise.resolve(registro),
        },
    };
    const ctx = vm.createContext({
        window: win, document: doc, navigator: nav, console,
        Date, Promise, Object, Array, Number,
        setInterval: (fn, ms) => { est.intervalos.push({ fn, ms }); return 1; },
    });
    vm.runInContext(BLOQUE, ctx, { filename: 'index.html#autoactualizacion' });
    est.win = win; est.doc = doc; est.banner = banner; est.registro = registro;
    return est;
}
// Deja correr las microtareas de los `.then` internos.
const respirar = () => new Promise(r => setImmediate(r));

//  ⚠️ EL ARNES ATRAPA LO QUE LANCE. Si el bloque deja de registrar un oyente,
//  el arnes lo invoca y revienta con una traza de Node en vez de con una
//  asercion roja con nombre — y en rojo hay que salir DICIENDO QUE FALLA, que
//  es lo que alguien leera dentro de seis meses. (Comprobado en el red-check:
//  la mutacion "sin oyentes de reanudacion" salia sin linea de resultado.)
(async function () {
  try {

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🔑 SE COMPRUEBA AL VOLVER AL FRENTE — el hueco que se arregla');
{
    const e = montar({});
    await respirar();

    ok('1a · los tres momentos de "abrir la app" tienen oyente',
       typeof e.oyentes.document.visibilitychange === 'function' &&
       typeof e.oyentes.window.pageshow === 'function' &&
       typeof e.oyentes.window.focus === 'function',
       'ninguno de los tres lo dan todos los navegadores: por eso van los tres');

    const alCargar = e.updates;
    ok('1b · al cargar ya se pregunta por la version nueva', alCargar >= 1, 'updates=' + alCargar);

    // La app se va al fondo y vuelve DOS MINUTOS despues: eso ES abrir desde
    // el icono en una PWA suspendida.
    //
    // ⚠️ EL RELOJ HAY QUE ADELANTARLO DE VERDAD. La primera version de esta
    // asercion ocultaba y volvia en el mismo milisegundo, y salio roja: la
    // frenaba el estrangulador de 20 s — CORRECTAMENTE. Un test que no
    // reproduce el tiempo real del caso no prueba el caso, acusa al codigo.
    const real = Date.now;
    e.doc.visibilityState = 'hidden';  e.oyentes.document.visibilitychange();
    Date.now = () => real() + 120000;
    e.doc.visibilityState = 'visible'; e.oyentes.document.visibilitychange();
    Date.now = real;
    await respirar();
    ok('1c · 🔑🔑 al volver al frente se vuelve a preguntar (ESTO es lo que faltaba)',
       e.updates > alCargar,
       'sin esto la PWA suspendida no pregunta NUNCA: ni navega ni corren sus temporizadores');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔑🔑 LA MARCA DE INTERACCION SE REINICIA AL REANUDAR');
{
    //  Sin esto el arreglo entero no sirve: una PWA suspendida conserva el
    //  MISMO contexto de JavaScript, asi que la marca sigue puesta desde la
    //  sesion anterior y abrir desde el icono seria el unico caso que nunca
    //  se actualizaria. Se mide con reloj falso para no esperar un minuto.
    const e = montar({});
    await respirar();
    e.oyentes.window.pointerdown();          // el usuario trabajo ayer
    ok('2a · tocar la pantalla marca la interaccion',
       e.win._cronosHuboInteraccion === true);

    const real = Date.now;
    e.doc.visibilityState = 'hidden'; e.oyentes.document.visibilitychange();
    Date.now = () => real() + 120000;        // dos minutos fuera
    e.doc.visibilityState = 'visible'; e.oyentes.document.visibilitychange();
    Date.now = real;
    await respirar();
    ok('2b · 🔑🔑 tras una ausencia LARGA, la marca se reinicia',
       e.win._cronosHuboInteraccion === false,
       'si no, abrir desde el icono nunca recargaria — el caso que se arregla');
}
{
    const e = montar({});
    await respirar();
    e.oyentes.window.pointerdown();
    const real = Date.now;
    e.doc.visibilityState = 'hidden'; e.oyentes.document.visibilitychange();
    Date.now = () => real() + 5000;          // cinco segundos: NO es volver
    e.doc.visibilityState = 'visible'; e.oyentes.document.visibilitychange();
    Date.now = real;
    ok('2c · ⚠️ una ausencia CORTA no la reinicia (sigue en mitad de lo suyo)',
       e.win._cronosHuboInteraccion === true);
}
{
    const e = montar({});
    await respirar();
    e.oyentes.window.pointerdown();
    e.oyentes.window.focus();                // sin `hidden` previo
    ok('2d · 🔑 un `focus` SIN ausencia previa no borra la marca',
       e.win._cronosHuboInteraccion === true,
       'con Infinity ahi, volver a pulsar en la ventana tras escribir desprotegia');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 🔴 LA RECARGA Y SUS DOS FRENOS (el desastre de v542)');
{
    const e = montar({});
    await respirar();
    e.oyentes.sw.controllerchange();
    ok('3a · recien abierta y sin tocar nada: RECARGA sola',
       e.recargas === 1 && e.banner.style.display === 'none',
       'recargas=' + e.recargas);
}
{
    const e = montar({ partidoEnCurso: true });
    await respirar();
    e.oyentes.sw.controllerchange();
    ok('3b · 🔑🔑 CON PARTIDO EN CURSO no recarga: ofrece el banner',
       e.recargas === 0 && e.banner.style.display === 'flex',
       'esto es un cronometro de partidos en vivo; recargas=' + e.recargas);
}
{
    const e = montar({});
    await respirar();
    e.oyentes.window.keydown();              // esta escribiendo
    e.oyentes.sw.controllerchange();
    ok('3c · 🔑🔑 si el usuario YA TOCO algo no recarga: ofrece el banner',
       e.recargas === 0 && e.banner.style.display === 'flex',
       'es LITERALMENTE el fallo de v542: la recarga devolvia la app a LOGIN ' +
       'mientras el autor rellenaba el formulario del RGPD');
}
{
    //  Y en cuanto vuelve a ser seguro, se aplica sola: el usuario no tiene
    //  que pulsar nada. El latido de 60 s es el que lo recoge.
    const e = montar({ partidoEnCurso: true });
    await respirar();
    e.oyentes.sw.controllerchange();
    ok('3d · queda PENDIENTE, no se pierde', e.recargas === 0);
    e.win.cronosHayPartidoEnCurso = () => false;     // el partido termina
    e.intervalos.forEach(i => i.fn());
    ok('3e · 🔑 al terminar el partido se aplica sola, sin pulsar nada',
       e.recargas === 1, 'recargas=' + e.recargas);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) 🧯 DETALLES QUE YA MORDIERON ANTES');
{
    const e = montar({});
    await respirar();
    const antes = e.updates;
    e.oyentes.window.focus(); e.oyentes.window.focus(); e.oyentes.window.focus();
    await respirar();
    ok('4a · el estrangulador evita martillear al cambiar de pestana',
       e.updates === antes, 'updates ' + antes + ' → ' + e.updates);
}
{
    //  Un Service Worker que se quedo ESPERANDO se manda pasar al frente sin
    //  que nadie pulse el banner: eso es lo que hace la actualizacion
    //  automatica en vez de sugerida.
    const e = montar({ waiting: {} });
    await respirar();
    ok('4b · 🔑 a un SW en espera se le ordena pasar al frente solo',
       e.skipWaiting >= 1, 'skipWaiting=' + e.skipWaiting);
}
{
    //  El extra del SuperAdmin sigue mandando sobre el BANNER (v598), pero no
    //  puede impedir que la app se mantenga al dia.
    const e = montar({ partidoEnCurso: true, usuario: { extras: { actualizaciones: false } } });
    await respirar();
    e.oyentes.sw.controllerchange();
    ok('4c · con el extra desactivado no se pinta el banner',
       e.banner.style.display === 'none');
}
{
    const e = montar({});
    await respirar();
    ok('4d · el latido de 60 s sigue existiendo',
       e.intervalos.some(i => i.ms === 60000), JSON.stringify(e.intervalos.map(i => i.ms)));
}

  } catch (err) {
    fail++;
    console.log('  ✗ 🔴 el bloque de autoactualizacion reventó al ejercitarlo: ' +
                ((err && err.message) || String(err)));
    console.log('      → lo más probable: ha dejado de registrar alguno de los ' +
                'oyentes de reanudación (visibilitychange / pageshow / focus)');
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
  process.exit(fail ? 1 : 0);
})();

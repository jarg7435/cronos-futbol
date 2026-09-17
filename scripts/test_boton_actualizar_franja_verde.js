// ─────────────────────────────────────────────────────────────────────────
//  test_boton_actualizar_franja_verde.js  ·  v728
//
//  EL BOTÓN "ACTUALIZAR" DE LA FRANJA VERDE TIENE QUE ACTUALIZAR.
//
//  Reporte del autor (implementar.txt 2026-09-17, captura 10491, ya con
//  clubes reales en producción): en PC se pulsa "Actualizar" y el proceso se
//  congela; hay que forzar Ctrl + Shift + R.
//
//  🔑🔑 LA CAUSA ERA EL FRENO DE v645 DISPARÁNDOSE CONTRA QUIEN PULSA. La
//  franja aplicaba la versión nueva por `controllerchange`, y ese camino
//  pregunta `_esSeguroRecargar()`, que dice NO si el usuario "ha tocado algo".
//  Pulsar el botón ES tocar algo —`pointerdown` en captura, puesto ahí a
//  propósito en v645—, así que el único gesto que garantiza que la recarga no
//  molesta a nadie era justo el que la impedía. No se recargaba NUNCA.
//
//  🚨 POR QUÉ ESTE GUARD EJECUTA EL BLOQUE EN VEZ DE MIRARLO (igual que el de
//  v645): los dos fallos posibles son mudos. Que no recargue al pulsar deja al
//  club en la versión vieja sin un solo error en consola; y que recargue
//  cuando no debe es la v542, que se llevó por delante un formulario a medias.
//  Un regex no distingue "llama a reload()" de "llama a reload() EN EL
//  MOMENTO BUENO", que es lo único que importa aquí.
//
//  ⚠️ El bloque se EXTRAE de index.html, no se copia: copiarlo sería probar
//  una copia de la lógica escrita en el propio test.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT  = path.join(__dirname, '..');
const HTML  = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const LIVE  = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const SW    = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

console.log('\n══ v728 · el botón "Actualizar" de la franja verde ══');

// ── Extracción del bloque real ───────────────────────────────────────────
const MARCA = 'v645 · LA APP SE ACTUALIZA SOLA AL ABRIRLA DESDE EL ICONO';
const iMarca = HTML.indexOf(MARCA);
ok('0a · la marca del bloque de actualización sigue en index.html', iMarca >= 0,
   'si esto falla, todo lo de abajo estaría midiendo otro trozo del fichero');
if (iMarca < 0) { console.log('\nResultado: ' + pass + '/' + (pass + fail) + '  ❌'); process.exit(1); }
const iIni = HTML.indexOf('(function() {', iMarca);
const iFin = HTML.indexOf('})();', iIni);
ok('0b · se puede acotar el bloque entero', iIni > 0 && iFin > iIni);
const BLOQUE = HTML.slice(iIni, iFin + 5);

// ── El navegador de mentira ──────────────────────────────────────────────
//  El botón es un elemento de verdad (con `style`, `disabled` y `textContent`)
//  porque parte de lo que se arregla es el acuse de recibo: "se congela"
//  empieza por no saber si la pulsación ha entrado.
function montar(opciones) {
    const o = opciones || {};
    const est = {
        recargas: 0, updates: 0, skipWaiting: 0,
        oyentes: { window: {}, document: {}, sw: {} },
        temporizadores: [], intervalos: [],
    };
    const registro = {
        waiting: ('waiting' in o) ? o.waiting : { postMessage: () => { est.skipWaiting++; } },
        installing: o.installing || null,
        // ⚠️ El `update()` del ARRANQUE no cuenta: si la versión nueva
        // apareciera ya ahí, el escenario "la franja se quedó de una
        // comprobación vieja" no se estaría probando.
        update: () => {
            est.updates++;
            if (o.apareceWaitingTrasUpdate && est.updates >= 2) {
                registro.waiting = { postMessage: () => { est.skipWaiting++; } };
            }
            return Promise.resolve();
        },
        addEventListener: () => {},
    };

    const banner = { style: { display: 'none' } };
    const boton  = { id: 'update-now', style: {}, disabled: false, textContent: 'Actualizar' };
    const doc = {
        visibilityState: 'visible',
        addEventListener: (t, h) => { est.oyentes.document[t] = h; },
        getElementById: (id) => (id === 'update-banner' ? banner : (id === 'update-now' ? boton : null)),
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
            getRegistration: () => (o.sinRegistro ? Promise.resolve(null) : Promise.resolve(registro)),
        },
    };
    const ctx = vm.createContext({
        window: win, document: doc, navigator: nav, console,
        Date, Promise, Object, Array, Number,
        setInterval: (fn, ms) => { est.intervalos.push({ fn, ms }); return est.intervalos.length; },
        setTimeout: (fn, ms) => { est.temporizadores.push({ fn, ms }); return est.temporizadores.length; },
        clearTimeout: (id) => { if (id) est.temporizadores[id - 1] = null; },
    });
    vm.runInContext(BLOQUE, ctx, { filename: 'index.html#franja-verde' });
    est.win = win; est.doc = doc; est.banner = banner; est.boton = boton; est.registro = registro;
    // Pulsar el botón como lo pulsa una persona: primero el `pointerdown` que
    // marca la interacción (en captura, v645) y después el `click`.
    est.pulsarActualizar = () => {
        if (est.oyentes.window.pointerdown) est.oyentes.window.pointerdown();
        est.oyentes.document.click({ target: boton });
    };
    est.vencerPlazos = () => est.temporizadores.forEach(t => { if (t) t.fn(); });
    return est;
}
const respirar = () => new Promise(r => setImmediate(r));

(async function () {
  try {

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🔑 PULSAR "ACTUALIZAR" RECARGA — el fallo reportado');
{
    const e = montar({});
    await respirar();
    // El arranque ya le manda pasar al frente a un worker que estuviera
    // esperando (v645); lo que se mide aquí es lo que añade la PULSACIÓN.
    const ordenesAntes = e.skipWaiting;
    e.pulsarActualizar();
    await respirar();

    ok('1a · el botón acusa recibo en el acto (bloqueado y "Actualizando…")',
       e.boton.disabled === true && /Actualizando/.test(e.boton.textContent),
       'disabled=' + e.boton.disabled + ' texto=' + e.boton.textContent);
    ok('1b · se le ordena pasar al frente al Service Worker en espera',
       e.skipWaiting === ordenesAntes + 1, 'skipWaiting=' + e.skipWaiting);

    // Y ahora llega el cambio de Service Worker. ESTE es el punto exacto que
    // fallaba: el usuario acaba de tocar la pantalla (ha pulsado el botón).
    e.oyentes.sw.controllerchange();
    await respirar();
    ok('1c · 🔑🔑 la pestaña SE RECARGA aunque el usuario acabe de tocar',
       e.recargas === 1,
       'es el defecto reportado: el freno de v645 mataba la recarga que el ' +
       'propio usuario había pedido, y sólo salía con Ctrl+Shift+R');
    ok('1d · y la franja no se vuelve a ofrecer', e.banner.style.display !== 'flex');
}

console.log('\n2) ⏱️ EL PLAZO: nadie se queda esperando a un worker mudo');
{
    // Un `waiting` que no contesta: está `redundant`, otra pestaña se le
    // adelantó o el navegador no lo despierta. `postMessage` no da error.
    const e = montar({});
    await respirar();
    e.pulsarActualizar();
    await respirar();
    ok('2a · sin `controllerchange` todavía no se ha recargado', e.recargas === 0);
    e.vencerPlazos();
    ok('2b · 🔑 vencido el plazo, la pestaña se recarga igual', e.recargas === 1,
       'una recarga de más no rompe nada; una de menos deja al club en la ' +
       'versión vieja');
}
{
    const e = montar({});
    await respirar();
    e.pulsarActualizar();
    await respirar();
    e.oyentes.sw.controllerchange();
    e.vencerPlazos();
    await respirar();
    ok('2c · ⚠️ y no se recarga DOS veces si llegan las dos cosas', e.recargas === 1,
       'recargas=' + e.recargas);
}

console.log('\n3) LOS CAMINOS QUE NO ENCUENTRAN A NADIE ESPERANDO');
{
    const e = montar({ sinRegistro: true });
    await respirar();
    e.pulsarActualizar();
    await respirar();
    ok('3a · sin registro de Service Worker se recarga directamente', e.recargas === 1);
}
{
    // La franja pudo quedarse en pantalla de una comprobación vieja: no hay
    // nadie en espera, así que hay que ir a BUSCAR la versión nueva.
    const e = montar({ waiting: null, apareceWaitingTrasUpdate: true });
    await respirar();
    const antes = e.updates;
    e.pulsarActualizar();
    await respirar();
    ok('3b · sin worker en espera se busca la versión nueva', e.updates > antes,
       'updates=' + e.updates);
    ok('3c · …y si aparece, se le manda pasar al frente', e.skipWaiting === 1,
       'skipWaiting=' + e.skipWaiting);
}

console.log('\n4) ⚠️ v542 NO PUEDE VOLVER: los frenos automáticos siguen');
{
    // Nadie ha pulsado nada: el usuario está escribiendo en un formulario y
    // llega una versión nueva. Aquí NO se recarga, se ofrece.
    const e = montar({});
    await respirar();
    e.oyentes.window.pointerdown();          // el usuario toca la pantalla
    e.oyentes.sw.controllerchange();
    await respirar();
    ok('4a · 🔑 sin pulsar el botón, la interacción SIGUE frenando la recarga',
       e.recargas === 0, 'esto es exactamente el desastre de v542');
    ok('4b · y en su lugar se ofrece la franja', e.banner.style.display === 'flex');
}
{
    const e = montar({ partidoEnCurso: true });
    await respirar();
    e.oyentes.sw.controllerchange();
    await respirar();
    ok('4c · con PARTIDO EN CURSO tampoco se recarga sola', e.recargas === 0,
       'esto es un cronómetro de partidos en vivo');
}

console.log('\n5) EL VISOR (live.html) tiene la misma red de seguridad');
ok('5a · el clic pide el registro fresco en vez de fiarse del worker guardado',
   /function _actualizaAhora\(\)/.test(LIVE) &&
   /getRegistration\(\)[\s\S]{0,400}reg\.waiting\.postMessage/.test(LIVE));
ok('5b · y la recarga va con plazo', /_PLAZO_RECARGA/.test(LIVE) && /_recargaYa/.test(LIVE));
ok('5c · con una sola recarga garantizada', /_recargando/.test(LIVE));

console.log('\n6) ⚡ EL SERVICE WORKER INSTALA RÁPIDO');
{
    const iInstall = SW.indexOf("self.addEventListener('install'");
    const install = SW.slice(iInstall, iInstall + 400);
    ok('6a · 🔑 el install sólo espera al ARMAZÓN, no a los 99 ficheros',
       /_precargaArmazon\(\)/.test(install) && !/addAll\(ASSETS\)/.test(install),
       'un SW no pasa a `installed` hasta que su waitUntil termina: con 4,6 MB ' +
       'dentro, el botón de la franja no podía hacer nada más que esperar');
    ok('6b · el resto del respaldo offline se descarga detrás',
       /_precargaElResto\(\)/.test(install));
    ok('6c · sigue haciendo skipWaiting', /self\.skipWaiting\(\)/.test(install));
}
ok('6d · ⚠️ la precarga ya no es atómica: un 404 no tumba el respaldo entero',
   /_precargaElResto[\s\S]{0,400}cache\.add\(u\)/.test(SW) &&
   /Promise\.allSettled/.test(SW),
   'la lección de v452: `addAll` es atómico y una ruta mala deja el ' +
   'dispositivo sin respaldo offline');
ok('6e · el armazón lleva lo que hace falta para arrancar sin red',
   /const SHELL = \[[\s\S]{0,400}'\.\/index\.html'[\s\S]{0,400}'\.\/offline\.html'[\s\S]{0,400}'\.\/style\.css'/.test(SW));
ok('6f · …incluidos los dos que van PRIMEROS por diseño (v720 y v721)',
   /const SHELL = \[[\s\S]{0,500}local-uid\.js[\s\S]{0,200}fs-cache-mode\.js/.test(SW));
ok('6g · y la purga total tampoco retrasa ya el claim',
   /tocaPurgaTotal\) \{[\s\S]{0,600}await _precargaArmazon\(\)/.test(SW));

console.log('\n────────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + ' PASS · ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

  } catch (e) {
    console.log('\n✗ el arnés reventó: ' + (e && e.message));
    console.log('   (un guard en rojo tiene que DECIR que falla, no morir con una traza)');
    console.log('\nResultado: ' + pass + ' PASS · ' + (fail + 1) + ' FAIL');
    process.exit(1);
  }
})();

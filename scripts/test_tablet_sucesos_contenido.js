// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v456 — El cajón de SUCESOS se despliega CONTENIDO también en iPad
// ═══════════════════════════════════════════════════════════════════════════
// Reporte del autor (capturas IMG_0483 / IMG_0484): en un iPad, al pulsar la
// barra inferior de SUCESOS la página entera se desplazaba hacia abajo y el
// marcador desaparecía de la pantalla; en el móvil el mismo toque despliega el
// cajón sin mover nada y el campo se reajusta solo.
//
// 🔑 LA CAUSA NO ESTABA EN LA BARRA, sino en QUÉ MAQUETACIÓN le toca al iPad.
// live.html anclaba la vista al viewport (`height:100dvh` + `overflow:hidden`)
// en TRES bandas —móvil vertical, móvil apaisado y tablet vertical ≤950px— y
// dejaba fuera la cuarta: un iPad EN HORIZONTAL mide 1024-1194px y un iPad Pro
// 12.9" en vertical mide 1024px, así que ambos caen en la maquetación de PC,
// donde `body` sigue con `min-height:100vh` y sin `overflow:hidden`. En iOS
// `100vh` NO es lo que se ve —es el alto con las barras del navegador
// recogidas—, de modo que ahí SIEMPRE sobran ~60-90px de scroll y desplegar un
// cajón que crece hacia abajo hace que Safari se desplace hasta él.
//
// ⚠️ POR QUÉ ESTE GUARD NO ES UN REGEX MÁS. Una aserción de texto sólo puede
// decir "el fichero contiene esta regla"; no dice a QUÉ DISPOSITIVO le llega.
// Y el defecto era exactamente ese: las reglas correctas existían, pero su
// @media no cubría al iPad. Así que aquí se SIMULA LA CASCADA: se parsean los
// bloques <style>, se evalúa cada @media contra perfiles de dispositivo reales
// y se comprueba el valor GANADOR de cada propiedad en cada perfil.
//
// LO QUE ESTE GUARD *NO* PUEDE VER: el resultado visual y el comportamiento
// real de Safari. Eso solo lo confirma el navegador del autor.
//
// Red-check: `CRONOS_LIVE_HTML=<ruta>` permite apuntar a una copia mutada del
// fichero sin tocar el de verdad.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const RUTA_LIVE = process.env.CRONOS_LIVE_HTML || path.join(RAIZ, 'live.html');
const live = fs.readFileSync(RUTA_LIVE, 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle ? '  → ' + detalle : ''}`); fallos++; }
}

// ───────────────────────────────────────────────────────────────────────────
// 1 · EL SIMULADOR DE LA CASCADA (compartido)
// ───────────────────────────────────────────────────────────────────────────
// v457: el parser de CSS, el evaluador de @media y los perfiles de dispositivo
// se han movido a scripts/_css_cascade.js porque los usa también
// test_avisos_pila_scroll.js. Dos copias del mismo simulador acabarían
// divergiendo — la lección que ya costó el gol duplicado (v424) y la fila de
// sucesos escrita dos veces (v442).
const { simulador, bloquesDeEstilo, TACTILES, RATON } = require('./_css_cascade.js');

const SIM = simulador(live);
const { calcula, v, reglas } = SIM;
const bloquesStyle = bloquesDeEstilo(live);
const perfil = (nombre) => {
    const d = TACTILES.concat(RATON).find(p => p.n === nombre);
    if (!d) throw new Error('Perfil desconocido: ' + nombre);
    return d;
};

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 0 · el CSS se puede leer ──');
// ───────────────────────────────────────────────────────────────────────────
ok('0a · live.html trae bloques <style>', bloquesStyle.length > 0);
ok('0b · se han parseado reglas suficientes', reglas.length > 100, reglas.length + ' reglas');
const _medias = SIM.mediasEvaluables(TACTILES[0]);
ok('0c · todas las @media del fichero son evaluables por el guard', _medias.ok, _medias.error);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · en TÁCTIL la vista está anclada al viewport ──');
// ───────────────────────────────────────────────────────────────────────────
// Es la aserción que define el arreglo: si el `body` no puede desbordar, el
// cajón NO PUEDE empujar la página, y el marcador no se va de la pantalla
// haga lo que haga el usuario.
for (const d of TACTILES) {
    const alto     = calcula('body', d)['height'];
    const overflow = v('body', 'overflow', d);
    const minAlto  = v('body', 'min-height', d);
    ok(`1a · [${d.n}] el body se ancla al alto VISIBLE (dvh)`,
       !!alto && /dvh/.test(alto.valor), alto ? alto.valor : 'sin height');
    ok(`1a2 · [${d.n}] con respaldo en vh para navegadores sin dvh`,
       !!alto && alto.valores.some(x => /^100vh$/.test(x)),
       alto ? alto.valores.join(' → ') : 'sin height');
    ok(`1b · [${d.n}] 🔑 body overflow:hidden — la página no puede desplazarse`,
       overflow === 'hidden', String(overflow));
    ok(`1c · [${d.n}] y min-height:100vh queda anulado (en iOS 100vh > lo visible)`,
       minAlto === '0', String(minAlto));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · el alto del cajón sale del CAMPO, no de la página ──');
// ───────────────────────────────────────────────────────────────────────────
// Anclar el body sin esto sólo cambiaría el defecto de sitio: el campo se
// saldría por abajo y lo recortaría el overflow:hidden del #live-main. El
// campo tiene que poder ENCOGERSE.
for (const d of TACTILES) {
    ok(`2a · [${d.n}] el campo se acota al hueco disponible (max-height:100%)`,
       v('#live-pitch', 'max-height', d) === '100%', String(v('#live-pitch', 'max-height', d)));
    ok(`2b · [${d.n}] y puede encogerse (height:auto, sin alto impuesto)`,
       v('#live-pitch', 'height', d) === 'auto', String(v('#live-pitch', 'height', d)));
    ok(`2c · [${d.n}] el contenedor del campo no impone un mínimo`,
       v('#field-wrap', 'min-height', d) === '0', String(v('#field-wrap', 'min-height', d)));
    ok(`2d · [${d.n}] ni el contenedor principal`,
       v('#live-main', 'min-height', d) === '0', String(v('#live-main', 'min-height', d)));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el cajón es un acordeón, y sigue SIN tapar el campo ──');
// ───────────────────────────────────────────────────────────────────────────
// Por NOMBRE y no por índice: el orden de la lista compartida puede cambiar.
const dIpad = perfil('iPad 11" horizontal');
ok('3a · plegado, la lista mide 0 (sólo se ve la cabecera)',
   v('#match-events-bar.plegada #match-events-list', 'height', dIpad) === '0');
ok('3b · el despliegue se anima (transición de height, no display)',
   /height/.test(String(v('#match-events-list', 'transition', dIpad))),
   String(v('#match-events-list', 'transition', dIpad)));
for (const d of TACTILES) {
    const h = parseInt(String(v('#match-events-list', 'height', d)), 10);
    ok(`3c · [${d.n}] la lista es baja (≤110px): en táctil el alto es lo escaso`,
       h > 0 && h <= 110, h + 'px');
}
// 🔑 INVARIANTE DE v442, que este arreglo no puede romper: la barra vive en el
// FLUJO de la columna. Si alguien la pasara a `position:fixed`, volvería a ser
// la barra global de v440 y taparía el campo en vez de reajustarlo.
for (const d of TACTILES.concat(RATON)) {
    const pos = String(v('#match-events-bar', 'position', d) || 'static');
    ok(`3d · [${d.n}] la barra NO es fixed (v442: va en el flujo)`,
       pos !== 'fixed' && pos !== 'absolute', pos);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · [INVERTIDA v571] el PC se ancla IGUAL que el resto ──');
// ───────────────────────────────────────────────────────────────────────────
// 🔄🔄 ESTA PARTE ESTABA AL REVÉS Y SE INVIERTE A PROPÓSITO. NO ES AFLOJARLA.
//
// v456 arregló para el iPad exactamente el fallo que esta parte permitía en el
// PC, y dejó el escritorio fuera DELIBERADAMENTE: el comentario original decía
// que meterlo por ancho "habría cambiado la maquetación de PC en vísperas de
// una demo". Era una cautela de calendario, no una afirmación de que la
// maquetación de PC estuviera bien.
//
// 🔑 El 2026-08-18, con la prueba de 7 partidos, el autor reportó el MISMO
// síntoma en el ordenador del director (capturas 9213/9214): al desplegar el
// cajón de SUCESOS la página se desplazaba y desaparecían la cabecera y el
// marcador. En la 9214, con el cajón PLEGADO, la cabecera ya estaba fuera —
// prueba de que el defecto era del `min-height:100vh`, no del cajón.
//
// O sea: era la CUARTA banda que v456 dejó sin cubrir, y la demo ya pasó. Lo
// que aquí se protegía era un aplazamiento, y el aplazamiento ha vencido.
//
// Se conserva 4e: en PC hay alto de sobra y el cajón puede permitirse 116 px,
// mientras que en táctil el alto es lo escaso (PARTE 3). Esa distinción SÍ
// sigue viva y no la toca v571.
for (const d of RATON) {
    ok(`4a · [${d.n}] 🔄 el body YA NO puede crecer (fuera min-height:100vh)`,
       v('body', 'min-height', d) !== '100vh', String(v('body', 'min-height', d)));
    ok(`4b · [${d.n}] 🔄 el body no desborda: el scroll lo pone cada vista`,
       v('body', 'overflow', d) === 'hidden', String(v('body', 'overflow', d)));
    ok(`4c · [${d.n}] 🔄 el alto queda anclado al viewport visible`,
       String(v('body', 'height', d) || '') === '100dvh', String(v('body', 'height', d)));
    ok(`4d · [${d.n}] 🔄 y el campo se acota al hueco, como en táctil`,
       v('#live-pitch', 'max-height', d) === '100%', String(v('#live-pitch', 'max-height', d)));
    ok(`4e · [${d.n}] y la lista mantiene los 116px de PC (esto NO cambia)`,
       String(v('#match-events-list', 'height', d)) === '116px',
       String(v('#match-events-list', 'height', d)));
    // ⚠️ La contrapartida del anclaje: con el body sin scroll, el campo tiene
    // que poder ENCOGERSE de verdad o se saldría por abajo y lo recortaría el
    // overflow del #live-main. Es la misma comprobación que la PARTE 2 hace
    // para los táctiles, ahora exigida también en PC.
    ok(`4f · [${d.n}] 🔑 y puede encogerse (height:auto, sin alto impuesto)`,
       v('#live-pitch', 'height', d) === 'auto', String(v('#live-pitch', 'height', d)));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ El cajón de sucesos se despliega contenido en tablet y en móvil');

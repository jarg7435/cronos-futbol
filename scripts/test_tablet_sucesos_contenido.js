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
// 1 · PARSEO DEL CSS
// ───────────────────────────────────────────────────────────────────────────
// Sólo se parsea lo que hay DENTRO de <style>. Es deliberado: quitar los
// comentarios /* */ del fichero ENTERO es la trampa que costó v454 (un `/*`
// dentro de un comentario `//` de JavaScript dejó 1100 líneas ciegas). Dentro
// de <style> no hay comentarios de línea, así que el borrado es seguro.
const bloquesStyle = [...live.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);

function quitarComentarios(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Devuelve [{ media: 'condición' | null, selector, decls: {prop: {valor, importante}} }]
// en ORDEN DE FUENTE. Soporta un nivel de @media; cualquier otra at-rule con
// cuerpo (@keyframes, @supports, @font-face) se salta entera.
function parsearReglas(css, media, salida) {
    let i = 0;
    while (i < css.length) {
        const llave = css.indexOf('{', i);
        if (llave === -1) break;
        const prefacio = css.slice(i, llave).trim();

        // Cuerpo del bloque, contando llaves.
        let prof = 0, j = llave, fin = -1;
        for (; j < css.length; j++) {
            if (css[j] === '{') prof++;
            else if (css[j] === '}') { prof--; if (prof === 0) { fin = j; break; } }
        }
        if (fin === -1) break;                        // CSS truncado
        const cuerpo = css.slice(llave + 1, fin);

        if (prefacio.startsWith('@media')) {
            parsearReglas(cuerpo, prefacio.replace(/^@media\s*/, '').trim(), salida);
        } else if (prefacio.startsWith('@')) {
            /* @keyframes y compañía: no aportan declaraciones a estos selectores */
        } else {
            const decls = {};
            for (const trozo of cuerpo.split(';')) {
                const dosPuntos = trozo.indexOf(':');
                if (dosPuntos === -1) continue;
                const prop = trozo.slice(0, dosPuntos).trim().toLowerCase();
                let valor  = trozo.slice(dosPuntos + 1).trim();
                if (!prop || !valor) continue;
                const importante = /!important$/i.test(valor);
                if (importante) valor = valor.replace(/!important$/i, '').trim();
                // ⚠️ Una propiedad declarada DOS veces en la misma regla (el
                // patrón `height:100vh; height:100dvh` de este fichero): manda
                // la última, igual que en el navegador. Se guardan las dos para
                // poder afirmar que existe el respaldo en vh.
                if (!decls[prop]) decls[prop] = { valores: [], importante: false };
                decls[prop].valores.push(valor);
                decls[prop].importante = decls[prop].importante || importante;
            }
            for (const sel of prefacio.split(',')) {
                const s = sel.trim().replace(/\s+/g, ' ');
                if (s) salida.push({ media, selector: s, decls });
            }
        }
        i = fin + 1;
    }
    return salida;
}

const reglas = [];
for (const b of bloquesStyle) parsearReglas(quitarComentarios(b), null, reglas);

// ───────────────────────────────────────────────────────────────────────────
// 2 · EVALUADOR DE @media
// ───────────────────────────────────────────────────────────────────────────
// Sólo las características que usa live.html. Una desconocida LANZA: es
// preferible un guard que se rompe a un guard que ignora en silencio la
// condición que decide si el iPad entra o no en el bloque.
function casaCaracteristica(cond, disp) {
    const m = cond.match(/^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/i);
    if (!m) throw new Error('Condición @media no reconocida: ' + cond);
    const [, rasgo, valor] = [m[0], m[1].toLowerCase(), m[2].toLowerCase()];
    const px = v => parseFloat(String(v).replace('px', ''));
    switch (rasgo) {
        case 'min-width':   return disp.ancho >= px(valor);
        case 'max-width':   return disp.ancho <= px(valor);
        case 'min-height':  return disp.alto  >= px(valor);
        case 'max-height':  return disp.alto  <= px(valor);
        case 'orientation': return disp.orientacion === valor;
        case 'pointer':     return disp.puntero === valor;
        case 'hover':       return disp.hover === valor;
        default: throw new Error('Rasgo @media no soportado por el guard: ' + rasgo);
    }
}

function casaMedia(media, disp) {
    if (!media) return true;
    // Lista separada por comas = O lógico.
    return media.split(',').some(rama => {
        const partes = rama.trim().split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
        return partes.every(p => casaCaracteristica(p, disp));
    });
}

// Valor ganador de `prop` para `selector` en el dispositivo `disp`.
// Todos los selectores consultados aquí tienen la MISMA especificidad entre sí
// (un #id, o `body`), así que basta el orden de fuente + !important.
function calcula(selector, disp) {
    const out = {};
    for (const r of reglas) {
        if (r.selector !== selector) continue;
        if (!casaMedia(r.media, disp)) continue;
        for (const [prop, d] of Object.entries(r.decls)) {
            const previo = out[prop];
            if (previo && previo.importante && !d.importante) continue;
            out[prop] = { valores: d.valores, importante: d.importante,
                          valor: d.valores[d.valores.length - 1] };
        }
    }
    return out;
}
const v = (selector, prop, disp) => (calcula(selector, disp)[prop] || {}).valor;

// ───────────────────────────────────────────────────────────────────────────
// 3 · PERFILES DE DISPOSITIVO
// ───────────────────────────────────────────────────────────────────────────
const TACTILES = [
    // El caso reportado: iPad en HORIZONTAL. Los tres tamaños que existen.
    { n: 'iPad 11" horizontal',        ancho: 1194, alto: 834,  orientacion: 'landscape', puntero: 'coarse', hover: 'none' },
    { n: 'iPad 10.9" horizontal',      ancho: 1180, alto: 820,  orientacion: 'landscape', puntero: 'coarse', hover: 'none' },
    { n: 'iPad mini horizontal',       ancho: 1133, alto: 744,  orientacion: 'landscape', puntero: 'coarse', hover: 'none' },
    // Y el que también caía en la maquetación de PC estando en VERTICAL.
    { n: 'iPad Pro 12.9" vertical',    ancho: 1024, alto: 1366, orientacion: 'portrait',  puntero: 'coarse', hover: 'none' },
    // Los que ya estaban bien: no deben perder el anclaje.
    { n: 'iPad 11" vertical',          ancho: 834,  alto: 1194, orientacion: 'portrait',  puntero: 'coarse', hover: 'none' },
    { n: 'iPhone vertical',            ancho: 390,  alto: 844,  orientacion: 'portrait',  puntero: 'coarse', hover: 'none' },
    { n: 'iPhone horizontal',          ancho: 844,  alto: 390,  orientacion: 'landscape', puntero: 'coarse', hover: 'none' },
];
const RATON = [
    { n: 'PC 1920x1080',   ancho: 1920, alto: 1080, orientacion: 'landscape', puntero: 'fine', hover: 'hover' },
    { n: 'portátil 1366',  ancho: 1366, alto: 768,  orientacion: 'landscape', puntero: 'fine', hover: 'hover' },
    // Un portátil del MISMO ancho que el iPad: si el arreglo fuera por ancho en
    // vez de por tipo de puntero, este perfil cambiaría de comportamiento.
    { n: 'portátil 1194',  ancho: 1194, alto: 834,  orientacion: 'landscape', puntero: 'fine', hover: 'hover' },
];

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 0 · el CSS se puede leer ──');
// ───────────────────────────────────────────────────────────────────────────
ok('0a · live.html trae bloques <style>', bloquesStyle.length > 0);
ok('0b · se han parseado reglas suficientes', reglas.length > 100, reglas.length + ' reglas');
let mediasOk = true, errMedia = '';
try { for (const r of reglas) casaMedia(r.media, TACTILES[0]); }
catch (e) { mediasOk = false; errMedia = e.message; }
ok('0c · todas las @media del fichero son evaluables por el guard', mediasOk, errMedia);

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
const dIpad = TACTILES[0];
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
console.log('\n── PARTE 4 · el PC no cambia (el arreglo va por PUNTERO, no por ancho) ──');
// ───────────────────────────────────────────────────────────────────────────
// La contrapartida de la PARTE 1. Un `min-width:951px` a secas habría metido
// también a los portátiles —un iPad en horizontal tiene el mismo ancho— y
// habría cambiado la maquetación de PC en vísperas de una demo.
for (const d of RATON) {
    ok(`4a · [${d.n}] el body sigue con min-height:100vh`,
       v('body', 'min-height', d) === '100vh', String(v('body', 'min-height', d)));
    ok(`4b · [${d.n}] sin overflow:hidden en el body`,
       v('body', 'overflow', d) === undefined, String(v('body', 'overflow', d)));
    ok(`4c · [${d.n}] sin altura de viewport impuesta`,
       v('body', 'height', d) === undefined, String(v('body', 'height', d)));
    ok(`4d · [${d.n}] el campo conserva su tamaño de PC (sin max-height)`,
       v('#live-pitch', 'max-height', d) === undefined, String(v('#live-pitch', 'max-height', d)));
    ok(`4e · [${d.n}] y la lista mantiene los 116px de PC`,
       String(v('#match-events-list', 'height', d)) === '116px',
       String(v('#match-events-list', 'height', d)));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ El cajón de sucesos se despliega contenido en tablet y en móvil');

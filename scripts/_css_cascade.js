// ═══════════════════════════════════════════════════════════════════════════
// AYUDANTE DE GUARDS · Simulador de la cascada CSS de un HTML
// ═══════════════════════════════════════════════════════════════════════════
// No es un test: lo usan los guards que necesitan responder a la pregunta
// "¿QUÉ VALOR le llega a ESTE dispositivo?", que es distinta de "¿existe esta
// regla en el fichero?".
//
// 🔑 POR QUÉ EXISTE. Un guard de regex sólo puede afirmar que el fichero
// contiene un texto. En v456 el defecto era que las reglas correctas existían
// —bien escritas— pero su `@media` no cubría al iPad: cualquier aserción de
// texto habría dado VERDE sobre el código defectuoso. Para ver eso hay que
// evaluar las @media contra perfiles de dispositivo y resolver la cascada.
//
// LÍMITES CONOCIDOS (asumidos a propósito, y por eso `calcula` sólo se usa con
// selectores de la misma especificidad entre sí):
//   · no calcula especificidad: ordena por fuente + !important;
//   · casa el selector por texto EXACTO y normalizado (espacios colapsados);
//   · una característica @media desconocida LANZA, en vez de ignorarse en
//     silencio, que es como se cuela un falso verde.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

// Sólo se limpian comentarios /* */ y se hace SOBRE el contenido de <style>.
// Limpiar el fichero entero es la trampa de v454: un `/*` dentro de un
// comentario `//` de JavaScript dejó 1100 líneas ciegas.
function quitarComentarios(css) {
    return String(css).replace(/\/\*[\s\S]*?\*\//g, '');
}

function bloquesDeEstilo(html) {
    return [...String(html).matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
}

// Devuelve [{ media, selector, decls }] en ORDEN DE FUENTE. Soporta @media
// anidada; cualquier otra at-rule con cuerpo (@keyframes, @supports…) se salta.
function parsearReglas(css, media, salida) {
    let i = 0;
    while (i < css.length) {
        const llave = css.indexOf('{', i);
        if (llave === -1) break;
        const prefacio = css.slice(i, llave).trim();

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
            /* @keyframes y compañía no aportan declaraciones a estos selectores */
        } else {
            const decls = {};
            for (const trozo of partirDeclaraciones(cuerpo)) {
                const dosPuntos = trozo.indexOf(':');
                if (dosPuntos === -1) continue;
                const prop = trozo.slice(0, dosPuntos).trim().toLowerCase();
                let valor  = trozo.slice(dosPuntos + 1).trim();
                if (!prop || !valor) continue;
                const importante = /!important$/i.test(valor);
                if (importante) valor = valor.replace(/!important$/i, '').trim();
                // Una propiedad declarada DOS veces en la misma regla (el patrón
                // `height:100vh; height:100dvh` de este proyecto): manda la
                // última, igual que en el navegador. Se guardan todas para poder
                // afirmar que el respaldo existe.
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

// Parte por ';' respetando los paréntesis: `calc(100dvh - var(--x, 6rem))` no
// los lleva, pero `font-family` y los gradientes sí llevan comas y paréntesis y
// más vale no partir dentro de ellos.
function partirDeclaraciones(cuerpo) {
    const out = [];
    let prof = 0, ini = 0;
    for (let i = 0; i < cuerpo.length; i++) {
        const c = cuerpo[i];
        if (c === '(') prof++;
        else if (c === ')') prof--;
        else if (c === ';' && prof === 0) { out.push(cuerpo.slice(ini, i)); ini = i + 1; }
    }
    out.push(cuerpo.slice(ini));
    return out;
}

function casaCaracteristica(cond, disp) {
    const m = cond.match(/^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/i);
    if (!m) throw new Error('Condición @media no reconocida: ' + cond);
    const rasgo = m[1].toLowerCase();
    const valor = m[2].toLowerCase();
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
    return media.split(',').some(rama => {
        const partes = rama.trim().split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
        return partes.every(p => casaCaracteristica(p, disp));
    });
}

// Evalúa una expresión CSS de longitud (`calc(...)`, `100dvh`, `12px`, `1rem`)
// a píxeles, con el contexto del dispositivo. Sirve para comprobar ARITMÉTICA:
// que un tope de alto deja la caja DENTRO de la pantalla, por ejemplo.
function aPixeles(expr, ctx) {
    let s = String(expr || '').trim();
    if (!s) return NaN;
    s = s.replace(/calc\(/g, '(');
    s = s.replace(/var\(\s*--toast-top\s*(?:,[^)]*)?\)/g, '(' + Number(ctx.toastTop || 0) + ')');
    s = s.replace(/env\(\s*safe-area-inset-top\s*(?:,[^)]*)?\)/g, '(' + Number(ctx.safeTop || 0) + ')');
    s = s.replace(/env\(\s*safe-area-inset-bottom\s*(?:,[^)]*)?\)/g, '(' + Number(ctx.safeBottom || 0) + ')');
    s = s.replace(/(\d*\.?\d+)dvh/g, (_m, n) => '(' + (parseFloat(n) / 100 * Number(ctx.alto)) + ')');
    s = s.replace(/(\d*\.?\d+)vh/g,  (_m, n) => '(' + (parseFloat(n) / 100 * Number(ctx.altoVh || ctx.alto)) + ')');
    s = s.replace(/(\d*\.?\d+)dvw/g, (_m, n) => '(' + (parseFloat(n) / 100 * Number(ctx.ancho)) + ')');
    s = s.replace(/(\d*\.?\d+)vw/g,  (_m, n) => '(' + (parseFloat(n) / 100 * Number(ctx.ancho)) + ')');
    s = s.replace(/(\d*\.?\d+)rem/g, (_m, n) => '(' + (parseFloat(n) * 16) + ')');
    s = s.replace(/(\d*\.?\d+)px/g,  (_m, n) => '(' + parseFloat(n) + ')');
    // Sólo aritmética: si queda cualquier otra cosa, se prefiere LANZAR a
    // devolver un número inventado.
    if (!/^[\d\s+\-*/().]+$/.test(s)) throw new Error('No sé evaluar la longitud CSS: ' + expr);
    /* eslint-disable no-new-func */
    return Number(new Function('return (' + s + ')')());
}

// Crea el simulador para un HTML concreto.
function simulador(html) {
    const reglas = [];
    for (const b of bloquesDeEstilo(html)) parsearReglas(quitarComentarios(b), null, reglas);

    // Declaraciones ganadoras de `selector` en el dispositivo `disp`.
    function calcula(selector, disp) {
        const objetivo = String(selector).trim().replace(/\s+/g, ' ');
        const out = {};
        for (const r of reglas) {
            if (r.selector !== objetivo) continue;
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

    // Comprueba que TODAS las @media del fichero son evaluables. Se llama desde
    // los guards: una condición que el simulador no entienda invalidaría todo lo
    // demás en silencio.
    function mediasEvaluables(disp) {
        try { for (const r of reglas) casaMedia(r.media, disp); return { ok: true, error: '' }; }
        catch (e) { return { ok: false, error: e.message }; }
    }

    return { reglas, calcula, v, mediasEvaluables, aPixeles };
}

// ── PERFILES DE DISPOSITIVO ────────────────────────────────────────────────
// `alto` es el alto VISIBLE (lo que vale 100dvh) y `altoVh` el que devuelve
// `100vh`. En iOS no son el mismo número —100vh es el alto con las barras del
// navegador recogidas— y esa diferencia es justo lo que rompió v456: por eso
// los perfiles táctiles llevan los dos.
const TACTILES = [
    { n: 'iPhone vertical',         ancho: 390,  alto: 750,  altoVh: 844,  orientacion: 'portrait',  puntero: 'coarse', hover: 'none' },
    { n: 'iPhone SE vertical',      ancho: 375,  alto: 553,  altoVh: 667,  orientacion: 'portrait',  puntero: 'coarse', hover: 'none' },
    { n: 'iPhone horizontal',       ancho: 844,  alto: 330,  altoVh: 390,  orientacion: 'landscape', puntero: 'coarse', hover: 'none' },
    { n: 'iPad 11" vertical',       ancho: 834,  alto: 1100, altoVh: 1194, orientacion: 'portrait',  puntero: 'coarse', hover: 'none' },
    { n: 'iPad 11" horizontal',     ancho: 1194, alto: 745,  altoVh: 834,  orientacion: 'landscape', puntero: 'coarse', hover: 'none' },
    { n: 'iPad 10.9" horizontal',   ancho: 1180, alto: 730,  altoVh: 820,  orientacion: 'landscape', puntero: 'coarse', hover: 'none' },
    { n: 'iPad mini horizontal',    ancho: 1133, alto: 660,  altoVh: 744,  orientacion: 'landscape', puntero: 'coarse', hover: 'none' },
    { n: 'iPad Pro 12.9" vertical', ancho: 1024, alto: 1280, altoVh: 1366, orientacion: 'portrait',  puntero: 'coarse', hover: 'none' },
];
const RATON = [
    { n: 'PC 1920x1080',  ancho: 1920, alto: 1080, altoVh: 1080, orientacion: 'landscape', puntero: 'fine', hover: 'hover' },
    { n: 'portátil 1366', ancho: 1366, alto: 768,  altoVh: 768,  orientacion: 'landscape', puntero: 'fine', hover: 'hover' },
    // Un portátil del MISMO ancho que un iPad apaisado: fija que las reglas de
    // tablet van por TIPO DE PUNTERO y no por ancho.
    { n: 'portátil 1194', ancho: 1194, alto: 834,  altoVh: 834,  orientacion: 'landscape', puntero: 'fine', hover: 'hover' },
];

module.exports = { simulador, quitarComentarios, bloquesDeEstilo, casaMedia, aPixeles, TACTILES, RATON };

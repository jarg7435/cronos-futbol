// ════════════════════════════════════════════════════════════════════
// La pantalla de acceso: la de PRODUCCIÓN, y que se pueda recorrer entera.
// ════════════════════════════════════════════════════════════════════
// ⚠️⚠️⚠️ ESTE FICHERO NACIÓ DEFENDIENDO LO CONTRARIO, Y ESE FUE EL PROBLEMA.
//
// En v477 se reescribió `#auth-screen` "para que deslizara": `position:fixed`
// con inset 0, `z-index:900`, `justify-content:flex-start`, `padding` con
// env(safe-area-*), y se le quitó a la tarjeta el `margin:auto 0`. Este guard
// se escribió para fijar ESO — trece aserciones defendiendo un cambio que
// producción no tiene y que nunca se verificó en dispositivo.
//
// Aquel cambio se hizo la noche ANTERIOR al primer informe de que la casilla
// del RGPD no se veía en "Registrarse", y durante SIETE rondas se culpó al
// bloque de consentimiento —que estaba bien— en vez de al contenedor que lo
// enmarca. Cuando por fin se descargó producción y se diffeó la pantalla
// entera, esta etiqueta era la ÚNICA diferencia real que quedaba.
//
// 🔑 LA REGLA QUE IMPONE AHORA: la pantalla de acceso es la de producción.
//    Si hay que cambiarla, se cambia PRIMERO allí y se comprueba allí; aquí
//    solo se copia. Un guard nunca puede fijar una variante local no
//    verificada de algo que en producción funciona.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let fallos = 0;
const ok = (n, c, extra) => {
    if (c) console.log('  verde ' + n);
    else { fallos++; console.log('  ROJO  ' + n);
           if (extra !== undefined) console.log('        ' + String(extra).slice(0, 260)); }
};

const cont = (HTML.match(/<div id="auth-screen"[^>]*>/) || [''])[0];
// La tarjeta es el primer <div> después del contenedor.
const tarjeta = (HTML.slice(HTML.indexOf(cont) + cont.length)
                     .match(/<div style="width:100%; max-width:380px;[\s\S]*?>/) || [''])[0];

console.log('\n=== 1. El contenedor es el de producción ===');
ok('existe #auth-screen', cont.length > 0);
ok('está en FLUJO NORMAL, no fixed', !/position\s*:\s*fixed/.test(cont), cont);
ok('sin z-index propio', !/z-index/.test(cont), cont);
ok('altura por min-height:100dvh', /min-height\s*:\s*100dvh/.test(cont), cont);
ok('y tope por max-height:100dvh', /max-height\s*:\s*100dvh/.test(cont), cont);
ok('height:auto', /height\s*:\s*auto/.test(cont), cont);
ok('padding simple de 1rem (sin env(safe-area))',
    /padding\s*:\s*1rem/.test(cont) && !/env\(safe-area/.test(cont), cont);

console.log('\n=== 2. Se puede recorrer entera (que era la intención legítima) ===');
ok('overflow-y:auto', /overflow-y\s*:\s*auto/.test(cont), cont);
ok('deslizamiento por inercia en iOS', /-webkit-overflow-scrolling\s*:\s*touch/.test(cont), cont);
// `safe center` es lo que evita que un contenido más alto que el hueco quede
// recortado por arriba: sin `safe`, centrar deja la parte de arriba fuera.
ok('justify-content: safe center (como producción)',
    /justify-content\s*:\s*safe\s+center/.test(cont), cont);
ok('sin overscroll-behavior añadido', !/overscroll-behavior/.test(cont), cont);

console.log('\n=== 3. La tarjeta es la de producción ===');
ok('se localiza la tarjeta', tarjeta.length > 0);
ok('conserva margin:auto 0', /margin\s*:\s*auto\s+0/.test(tarjeta), tarjeta);
ok('mantiene flex-shrink:0 (no se comprime al crecer el formulario)',
    /flex-shrink\s*:\s*0/.test(tarjeta), tarjeta);
ok('sin margin-bottom añadido', !/margin-bottom/.test(tarjeta), tarjeta);

console.log('\n=== 4. Todo el formulario vive dentro de lo que desliza ===');
{
    const i = HTML.indexOf('<div id="auth-screen"');
    const j = HTML.indexOf('<!-- ══ PANTALLA DE SELECCIÓN DE ROL');
    const bloque = i === -1 ? '' : HTML.slice(i, j);
    ok('se acota el bloque de acceso', bloque.length > 0);
    ok('la casilla de consentimiento está dentro', bloque.includes('id="gdpr-consent-container"'));
    ok('el botón de envío está dentro', bloque.includes('id="auth-btn"'));
    ok('el mensaje de estado está dentro', bloque.includes('id="auth-error"'));
    ok('el botón va después de la casilla (es el final del formulario)',
        bloque.indexOf('id="auth-btn"') > bloque.indexOf('id="gdpr-consent-container"'));
    // Nada de alturas fijas en vh dentro: recortarían el recorrido.
    const sinCom = bloque.replace(/<!--[\s\S]*?-->/g, ' ');
    const altos = (sinCom.match(/(?:^|[^-])height\s*:\s*\d+vh/g) || []);
    ok('ningún alto fijo en vh dentro del bloque', altos.length === 0, altos.join(' | '));
}

console.log('\n' + (fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)'));
process.exit(fallos === 0 ? 0 : 1);

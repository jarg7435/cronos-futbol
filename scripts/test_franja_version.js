// ═══════════════════════════════════════════════════════════════════════════
//  LA FRANJA DE VERSIÓN — v526
// ═══════════════════════════════════════════════════════════════════════════
//  POR QUÉ EXISTE ESTE GUARD
//
//  El autor probó la v526 en su iPad y preguntó algo que no se podía responder:
//  "¿cómo sé que este iPad tiene de verdad la v526?". Y no se podía porque:
//
//   · la franja verde que él daba por acordada NO EXISTÍA en ningún sitio;
//   · sí existía `#cronos-version-badge`, una insignia minúscula abajo a la
//     derecha, en blanco al 30% de opacidad, con "v341" ESCRITO A MANO y que
//     no actualizaba nadie: 185 versiones mintiendo;
//   · y el sello bueno (`#build-version`) sólo se ve en la PANTALLA DE ACCESO,
//     así que desaparece justo cuando se empieza a probar.
//
//  🔑 Una prueba en un dispositivo del que no se sabe qué versión corre NO
//  PRUEBA NADA. Eso ya costó la saga de la caché (v477→v503, diez rondas).
//
//  🔑🔑 Este guard no se conforma con mirar el marcado: EJECUTA cache-bust.js
//  de verdad contra una copia con una versión inventada y comprueba que la
//  franja se mueve. Es la única forma de que no se vuelva a quedar clavada:
//  un sello que hay que acordarse de actualizar a mano miente antes o después.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}

const SW   = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
const VER  = (SW.match(/const\s+CACHE_NAME\s*=\s*'cronos-cache-(v\d+)'/) || [])[1];
const HTML = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · la franja existe, se ve y dice la verdad ──');
// ───────────────────────────────────────────────────────────────────────────
ok('1a · sw.js tiene un CACHE_NAME legible (es la fuente de verdad)', !!VER, VER);

const m = HTML.match(/<div id="cronos-version-badge"([\s\S]*?)>([\s\S]*?)<\/div>/);
ok('1b · existe la franja de versión en index.html', !!m);
const attrs = m ? m[1] : '';
const texto = m ? m[2].replace(/\s+/g, ' ').trim() : '';

ok('1c · 🔑 su data-version es el CACHE_NAME real, no un número a mano',
   !!VER && new RegExp('data-version="' + VER + '"').test(attrs),
   (attrs.match(/data-version="[^"]*"/) || ['(no lo lleva)'])[0]);
ok('1d · 🔑 y el TEXTO QUE SE VE dice lo mismo (el defecto era justo este: decía v341)',
   texto === 'CHRONOS ' + VER, texto || '(vacío)');

// ⚠️ LA TRAMPA DE v422, cuatro veces en este proyecto: una franja fija a todo
// el ancho se traga los toques de todo lo que tiene debajo. Aquí es fatal,
// porque va por encima de TODO, incluido el reproductor y su ✕.
ok('1e · 🔑🔑 no se traga los toques (pointer-events:none)',
   /pointer-events\s*:\s*none/.test(attrs), attrs.slice(0, 120));

// ⚠️⚠️ EL DEFECTO DE v527, reportado por él con captura (8882): la primera
// versión de esto era una franja FIJA ARRIBA Y A TODO EL ANCHO, y en el iPad y
// en el móvil se comía la fila de botones de la cabecera —entre ellos el
// "Descargar Vídeo" del reproductor—, dejando la app inusable.
// 🔑 Un indicador permanente NO PUEDE ROBAR ESPACIO: o es una esquina, o se va
// solo. Aquí se exigen las dos cosas: esquina discreta (PARTE 1) + aviso
// flotante que se retira (PARTE 5).
ok('1f · 🔑🔑 NO va fija en la parte superior (tapaba los botones de la cabecera)',
   !/top\s*:\s*0/.test(attrs) && !/\btop\s*:\s*calc/.test(attrs),
   attrs.slice(0, 160));
ok('1f2 · 🔑 ni ocupa todo el ancho',
   !/width\s*:\s*100%/.test(attrs) && !(/left\s*:\s*0/.test(attrs) && /right\s*:\s*0/.test(attrs)),
   attrs.slice(0, 160));
ok('1g · vive discreta ABAJO A LA DERECHA, como él pidió',
   /position\s*:\s*fixed/.test(attrs) && /bottom\s*:/.test(attrs) && /right\s*:/.test(attrs),
   attrs.slice(0, 160));
ok('1g2 · y es pequeña (no vuelve a comerse la pantalla)',
   (parseFloat((attrs.match(/font-size\s*:\s*([\d.]+)rem/) || [])[1]) || 9) <= 0.7,
   (attrs.match(/font-size\s*:\s*[^;]*/) || ['(sin tamaño)'])[0]);
ok('1h · se puede consultar por encima del reproductor',
   (Number((attrs.match(/z-index\s*:\s*(\d+)/) || [])[1]) || 0) > 100000,
   (attrs.match(/z-index\s*:\s*\d+/) || ['(sin z-index)'])[0]);
ok('1i · respeta la barra inferior del iPhone (safe-area)',
   /safe-area-inset-bottom/.test(attrs), attrs.slice(0, 160));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · 🔑🔑 no se puede quedar vieja: cache-bust la mueve ──');
// ───────────────────────────────────────────────────────────────────────────
// Se ejecuta cache-bust.js DE VERDAD sobre una copia con una versión que no
// existe. Si la franja no la sigue, es que volvemos a tener un número a mano.
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cronos-franja-'));
    try {
        // ⚠️ A LA CONSTANTE, NO AL PRIMER PARECIDO. sw.js menciona
        // "cronos-cache-v139" en un comentario 34 líneas ANTES del `const`, y
        // un replace ingenuo cambiaba el comentario y dejaba la constante
        // intacta: la PARTE 2 entera salía roja por un fallo del guard, no del
        // código. Es la misma trampa de leer fuente sin despojar de comentarios.
        fs.writeFileSync(path.join(tmp, 'sw.js'),
                         SW.replace(/(const\s+CACHE_NAME\s*=\s*'cronos-cache-)v\d+/,
                                    '$1v999'));
        fs.writeFileSync(path.join(tmp, 'index.html'), HTML);
        fs.writeFileSync(path.join(tmp, 'live.html'),
                         fs.readFileSync(path.join(RAIZ, 'live.html'), 'utf8'));

        execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'cache-bust.js')],
                     { cwd: tmp, stdio: 'pipe' });

        const nuevo = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
        const m2 = nuevo.match(/<div id="cronos-version-badge"([\s\S]*?)>([\s\S]*?)<\/div>/);
        const attrs2 = m2 ? m2[1] : '';
        const texto2 = m2 ? m2[2].replace(/\s+/g, ' ').trim() : '';

        ok('2a · 🔑 cache-bust.js reescribe el data-version de la franja',
           /data-version="v999"/.test(attrs2),
           (attrs2.match(/data-version="[^"]*"/) || ['(no lo tocó)'])[0]);
        ok('2b · 🔑 y también el texto visible (de nada sirve el atributo si se lee otra cosa)',
           texto2 === 'CHRONOS v999', texto2 || '(vacío)');
        ok('2c · sigue manteniendo el sello de la pantalla de acceso',
           /<span id="build-version" data-version="v999">v999<\/span>/.test(nuevo),
           (nuevo.match(/<span id="build-version"[^<]*<\/span>/) || ['(no está)'])[0]);
        ok('2d · y los sellos ?v= de los scripts (no se rompe lo que ya hacía)',
           (nuevo.match(/\?v=v999/g) || []).length > 50,
           (nuevo.match(/\?v=v999/g) || []).length + ' sellos');
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · ningún número de versión escrito a mano ──');
// ───────────────────────────────────────────────────────────────────────────
// El defecto original no fue poner mal el número: fue que hubiera un número
// que NADIE reescribía. Cualquier "CHRONOS vNNN" suelto en el documento es esa
// misma bomba de relojería otra vez.
{
    const sueltos = (HTML.match(/CHRONOS v\d+/g) || []);
    const malos = sueltos.filter(s => s !== 'CHRONOS ' + VER);
    ok('3a · 🔑 no hay ningún "CHRONOS vNNN" que no sea la versión actual',
       malos.length === 0, malos.join(', '));

    const versionados = (HTML.match(/data-version="v\d+"/g) || []);
    const desfasados = versionados.filter(s => s !== 'data-version="' + VER + '"');
    ok('3b · todos los data-version del documento van sincronizados',
       versionados.length >= 2 && desfasados.length === 0,
       versionados.length + ' encontrados; desfasados: ' + (desfasados.join(', ') || 'ninguno'));

    ok('3c · cache-bust.js conoce la franja por su id (si se renombra, esto avisa)',
       /cronos-version-badge/.test(fs.readFileSync(path.join(RAIZ, 'scripts', 'cache-bust.js'), 'utf8')));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · avisa cuando el dispositivo se ha quedado atrás ──');
// ───────────────────────────────────────────────────────────────────────────
// Que la franja diga "v525" ya es la respuesta que faltaba; pero el autor no
// tiene por qué saberse de memoria cuál es la última. Se compara contra el
// sw.js que sirve el servidor y se avisa en ámbar.
{
    ok('4a · el arranque compara su versión con la que sirve el servidor',
       /cache\s*:\s*['"]no-store['"]/.test(HTML) && /CACHE_NAME/.test(HTML),
       'no encuentro la comprobación contra sw.js');
    ok('4b · 🔑 y si no coinciden lo DICE, en vez de seguir mintiendo en verde',
       /hay\s+'\s*\+|hay '/.test(HTML) || /desactualiz/i.test(HTML),
       'no encuentro el aviso de versión desfasada');
    ok('4c · el aviso cambia el color de la franja (verde = al día)',
       /#9e6a03/i.test(HTML), 'no encuentro el ámbar del aviso');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · el saludo de bienvenida se va SOLO ──');
// ───────────────────────────────────────────────────────────────────────────
// Lo que él pidió tras el defecto de v527: "un aviso flotante inicial que nos
// informe de la nueva versión, que NO se quede fijo ocupando pantalla".
{
    ok('5a · al abrir la app se muestra un aviso de versión',
       /cronos-version-toast/.test(HTML), 'no encuentro el aviso de bienvenida');
    // 🔑 LA ASERCIÓN QUE DEFINE EL ARREGLO: sin retirada automática volvemos a
    // tener una franja permanente, que es justo lo que rompía el iPad.
    ok('5b · 🔑🔑 y SE RETIRA SOLO (setTimeout que lo quita)',
       /setTimeout\([\s\S]{0,400}?\.remove\(\)/.test(HTML),
       'no encuentro la retirada automática');
    ok('5c · tampoco él se traga los toques mientras se ve',
       /cronos-version-toast[\s\S]{0,600}?pointer-events\s*:\s*none/.test(HTML),
       'el aviso no lleva pointer-events:none');
    ok('5d · 🔑 su texto sale del data-version de la insignia, no de otro número a mano',
       /getAttribute\(['"]data-version['"]\)/.test(HTML),
       'el aviso no lee la versión de la insignia');
    ok('5e · el aviso es flotante y centrado, no una franja de lado a lado',
       /cronos-version-toast[\s\S]{0,600}?translateX\(-50%\)/.test(HTML) &&
       !/cronos-version-toast[\s\S]{0,600}?width\s*:\s*100%/.test(HTML),
       'el aviso vuelve a ocupar todo el ancho');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ La franja de versión existe, se ve y no puede quedarse vieja');

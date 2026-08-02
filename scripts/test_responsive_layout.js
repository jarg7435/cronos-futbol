// ═══════════════════════════════════════════════════════════════════════════
// GUARD · Diseño adaptativo (tablet + móvil) — v422
// ═══════════════════════════════════════════════════════════════════════════
// Cubre las tres áreas auditadas:
//   1. Mensajería (js/coach/comms/panel.js + style.css) — el split de dos
//      columnas pasa a maestro-detalle en pantallas estrechas.
//   2. live.html — cabecera compacta en vertical, banda de tablet en vertical,
//      y los avisos flotantes dejando de tragarse los toques.
//   3. El modal de acciones de jugador — "HECHO" cómodo y alcanzable al tacto.
//
// ⚠️ LO QUE ESTE GUARD *NO* PUEDE VER (léase antes de confiar en un verde):
//   Un guard de regex no comprueba que un fichero COMPILE. Por eso lo primero
//   que hace es un chequeo de sintaxis real de panel.js y un recuento de llaves
//   de cada bloque CSS: sin eso, un `}` de más dejaría media hoja muerta y todas
//   las aserciones de abajo seguirían en verde leyendo el texto del fichero.
//   Tampoco ve el resultado VISUAL: eso solo lo confirma el navegador.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}`); fallos++; }
}

const panel = leer('js/coach/comms/panel.js');
const css   = leer('style.css');
const live  = leer('live.html');
const index = leer('index.html');

// ⚠️ TRAMPA YA PAGADA: los comentarios /* */ de este proyecto CITAN el CSS viejo
// que se está sustituyendo ("antes esto era left: 0.5rem..."). Una aserción que
// busque un valor lo encontraría DENTRO del comentario y daría verde sin que el
// CSS real diga eso. Todas las aserciones de CSS trabajan sobre texto SIN
// comentarios; las de JS, sobre el fichero entero (allí los comentarios no
// contaminan porque se buscan estructuras de código, no valores sueltos).
const sinComentarios = t => t.replace(/\/\*[\s\S]*?\*\//g, '');
const cssLimpio = sinComentarios(css);
const liveCss   = sinComentarios(live);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 0 · el código compila y el CSS cierra sus llaves ──');
// ───────────────────────────────────────────────────────────────────────────

let compila = true;
try {
    execFileSync(process.execPath, ['--check', path.join(RAIZ, 'js/coach/comms/panel.js')],
                 { stdio: 'pipe' });
} catch (e) { compila = false; }
ok('0a · panel.js parsea (node --check)', compila);

// Recuento de llaves ignorando comentarios y cadenas. Un desbalance significa
// que a partir de ese punto el navegador descarta reglas en silencio.
function llavesBalanceadas(texto) {
    const limpio = texto
        .replace(/\/\*[\s\S]*?\*\//g, '')   // comentarios /* */
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    let n = 0;
    for (const ch of limpio) {
        if (ch === '{') n++;
        else if (ch === '}') { n--; if (n < 0) return false; }
    }
    return n === 0;
}
ok('0b · style.css tiene las llaves balanceadas', llavesBalanceadas(css));

const bloquesStyle = [...live.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
ok('0c · live.html trae bloques <style>', bloquesStyle.length > 0);
ok('0d · cada <style> de live.html tiene las llaves balanceadas',
   bloquesStyle.every(llavesBalanceadas));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · mensajería: maestro-detalle en pantallas estrechas ──');
// ───────────────────────────────────────────────────────────────────────────

// 1.1 · Los ganchos existen en el marcado. Si alguien renombra una clase aquí y
//       no en style.css, el móvil vuelve al split roto SIN ningún error.
ok('1a · el contenedor del split lleva id/clase um-split',
   /id="um-split"\s+class="um-split"/.test(panel));
ok('1b · la columna de contactos lleva la clase um-sidebar',
   /class="um-sidebar"/.test(panel));
ok('1c · la columna de chat lleva la clase um-chat',
   /id="um-chat-view"\s+class="um-chat"/.test(panel));
ok('1d · la barra de pestañas lleva la clase um-tabbar',
   /class="um-tabbar"/.test(panel));
ok('1e · cada pestaña lleva la clase um-tab',
   /id="um-tab-\$\{t\.id\}"\s+class="um-tab"/.test(panel));
ok('1f · el redactor lleva la clase um-input (para el antizoom de iOS)',
   /id="um-msg-input"\s+class="um-input"/.test(panel));

// 1.2 · Y el CSS los usa. Cada gancho tiene que aparecer también en style.css.
for (const gancho of ['um-split', 'um-sidebar', 'um-chat', 'um-tabbar', 'um-tab', 'um-input', 'um-back-btn']) {
    ok(`1g · style.css conoce el gancho .${gancho}`, cssLimpio.includes(`.${gancho}`));
}

// 1.3 · El punto CLAVE del arreglo: el min-width:260px inline es exactamente lo
//       que aplastaba el chat a ~130px en un móvil de 390px. Si la anulación
//       desaparece, el bug vuelve entero.
ok('1h · el split sigue teniendo el min-width:260px inline (es el que se anula)',
   /min-width:260px/.test(panel));
ok('1i · el CSS anula ese min-width con !important en la columna de contactos',
   /\.um-split\s*>\s*\.um-sidebar\s*\{[^}]*min-width:\s*0\s*!important/.test(cssLimpio));

// 1.4 · El intercambio propiamente dicho: las dos caras tienen que existir.
ok('1j · con chat abierto se esconde la lista',
   /\.um-split\.um-showing-chat\s*>\s*\.um-sidebar\s*\{\s*display:\s*none\s*!important/.test(cssLimpio));
ok('1k · sin chat abierto se esconde el panel de chat',
   /\.um-split:not\(\.um-showing-chat\)\s*>\s*\.um-chat\s*\{\s*display:\s*none\s*!important/.test(cssLimpio));

// 1.5 · Un solo punto de alta para la clase (la lección de la red de mensajes:
//       si se abre un segundo escritor, los dos se descoordinan).
const escrituresClase = (panel.match(/classList\.toggle\('um-showing-chat'/g) || []).length;
ok('1l · SOLO _umSetShowingChat toca la clase um-showing-chat', escrituresClase === 1);
ok('1m · _umSetShowingChat existe', /function _umSetShowingChat\(/.test(panel));

// 1.6 · Los tres puntos que deben llamarla, y que son los que la hacen usable.
ok('1n · abrir un contacto muestra el chat',
   /_umSetShowingChat\(true\)/.test(panel));
ok('1o · el botón "←" del hilo vuelve a la lista',
   /function _umBackToList\(\)\s*\{\s*_umSetShowingChat\(false\)/.test(panel));
ok('1p · cambiar de pestaña devuelve a la lista (si no, se queda sin salida)',
   /_umSetShowingChat\(false\);[\s\S]{0,200}Reset vista chat derecha/.test(panel));

// 1.7 · El botón "←" tiene que estar en el DOM del hilo, nacer oculto (para que
//       el PC no dependa de este CSS) y estar expuesto en window (onclick inline).
ok('1q · el hilo pinta el botón um-back-btn',
   /class="um-back-btn"\s+onclick="_umBackToList\(\)"/.test(panel));
ok('1r · nace con display:none inline (PC intacto aunque falle el CSS)',
   /class="um-back-btn"[\s\S]{0,220}style="display:none/.test(panel));
ok('1s · el CSS lo enciende solo en pantalla estrecha',
   /\.um-back-btn\s*\{\s*display:\s*inline-flex\s*!important/.test(cssLimpio));
ok('1t · _umBackToList está expuesto en window (el onclick es inline)',
   /window\._umBackToList\s*=\s*_umBackToList/.test(panel));

// 1.8 · Objetivo táctil y antizoom de iOS.
ok('1u · las pestañas tienen 44px de alto mínimo al tacto',
   /\.um-tab\s*\{[^}]*min-height:\s*44px\s*!important/.test(cssLimpio));
ok('1v · el redactor sube a 16px en punteros gruesos (iOS hace zoom por debajo)',
   /@media\s*\(pointer:\s*coarse\)\s*\{[^}]*\.um-input\s*\{\s*font-size:\s*16px\s*!important/.test(cssLimpio));

// 1.8b · Objetivos táctiles del resto del panel: se pintaban con paddings de
//        ratón (0.32rem ≈ 28px de alto) y con el dedo se falla.
ok('1u2 · los botones de acción del hilo llegan a 40px al tacto',
   /\.um-chat a\[href\]\s*\{[^}]*min-height:\s*40px/.test(cssLimpio));
ok('1u3 · "Enviar" llega a 44px',
   /\.um-chat \.btn\.primary\s*\{\s*min-height:\s*44px/.test(cssLimpio));
ok('1u4 · las casillas de selección múltiple suben a 20px',
   /\.um-sidebar input\[type="checkbox"\]\s*\{[^}]*width:\s*20px\s*!important/.test(cssLimpio));
ok('1u5 · la cabecera del panel puede envolver en pantallas de 360px',
   /\.um-root\s*>\s*div:first-child\s*\{[^}]*flex-wrap:\s*wrap/.test(cssLimpio));

// 1.9 · El panel en modo modal no puede desbordar la pantalla del móvil.
ok('1w · en modo modal el alto pasa a dvh (86vh + padding se salía)',
   /\.modal-content\.um-root\s*\{[^}]*100dvh/.test(cssLimpio));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · live.html: campo, avisos e historial ──');
// ───────────────────────────────────────────────────────────────────────────

// Extrae el cuerpo de una @media contando llaves (un `[\s\S]*?}` se corta en la
// primera regla interna y deja fuera casi todo el bloque).
function cuerpoMedia(texto, condicionRegex) {
    const m = texto.match(condicionRegex);
    if (!m) return '';
    let i = texto.indexOf('{', m.index);
    if (i < 0) return '';
    let n = 0, ini = i + 1;
    for (; i < texto.length; i++) {
        if (texto[i] === '{') n++;
        else if (texto[i] === '}') { n--; if (n === 0) return texto.slice(ini, i); }
    }
    return '';
}

// 2.1 · La banda de tablet en vertical (601-950px) ya no cae en el limbo entre
//       la maquetación de PC y las fichas de móvil.
const CONDICION_TABLET = /@media\s*\(orientation:\s*portrait\)\s*and\s*\(min-width:\s*601px\)\s*and\s*\(max-width:\s*950px\)/;
ok('2a · existe el bloque de tablet en vertical (601-950px)',
   CONDICION_TABLET.test(liveCss));

const bloqueTablet = cuerpoMedia(liveCss, CONDICION_TABLET);
ok('2a2 · y el bloque tiene contenido real (no se ha vaciado)', bloqueTablet.length > 500);
ok('2b · en tablet vertical el campo va arriba y el banquillo abajo (columna)',
   /#live-main\s*\{[^}]*flex-direction:\s*column/.test(bloqueTablet));
ok('2c · el campo conserva el 3:2 apaisado (aprovecha los ~768px de ancho)',
   /#live-pitch\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*2/.test(bloqueTablet));
ok('2d · las fichas suben a un tamaño intermedio (ni 36px de móvil ni 64px de PC)',
   /\.live-player-chip\s*\{\s*width:\s*48px/.test(bloqueTablet));
ok('2e · el banquillo pasa a franja horizontal con scroll',
   /#bench-panel\s*\{[^}]*overflow-x:\s*auto/.test(bloqueTablet));

// 2.2 · Los avisos flotantes ya no ocupan todo el ancho. Es el bug de TOQUES:
//       el contenedor lleva pointer-events:auto para poder deslizarse, así que
//       a ancho completo se tragaba los toques sobre el campo.
ok('2f · la pila de avisos ya no se estira a todo el ancho en móvil',
   !/#event-toast-stack\s*\{[^}]*left:\s*0\.5rem/.test(liveCss));
ok('2g · la pila de avisos tiene ancho acotado',
   /#event-toast-stack\s*\{[^}]*width:\s*min\(340px/.test(liveCss));
ok('2h · y sigue pudiendo deslizarse (pointer-events auto + overflow)',
   /#event-toast-stack\s*\{[^}]*pointer-events:\s*auto/.test(liveCss));

// 2.3 · Cabecera compacta en vertical: era el mayor ladrón de alto del campo.
ok('2i · el logo se encoge a 34px en móvil vertical',
   /#live-header \.logo img\s*\{\s*height:\s*34px\s*!important/.test(liveCss));
ok('2j · los botones de cabecera se encogen pero siguen siendo pulsables (32px)',
   /#live-header button\s*\{[^}]*min-height:\s*32px/.test(liveCss));

// 2.4 · El banquillo ya no desaparece en móviles pequeños apaisados.
ok('2k · se ha retirado el "#bench-panel { display: none }" de max-width:600px',
   !/@media\s*\(max-width:\s*600px\)\s*\{\s*#bench-panel\s*\{\s*display:\s*none/.test(liveCss));

// 2.5 · Lo que NO debía cambiar: la vista sigue teniendo su meta viewport con
//       zoom permitido (accesibilidad) y sus insets de notch.
ok('2l · live.html permite el zoom del usuario (sin user-scalable=no)',
   !/user-scalable\s*=\s*no/.test(live));
ok('2m · sigue respetando la notch (viewport-fit=cover + safe-area)',
   /viewport-fit=cover/.test(live) && /env\(safe-area-inset-top/.test(live));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · modal de eventos: "HECHO" al tacto ──');
// ───────────────────────────────────────────────────────────────────────────

// 3.1 · HECHO es la ÚNICA salida del modal (no hay ✕ ni cierre por fondo). Si
//       en móvil quedase fuera de alcance, el usuario se queda encerrado y los
//       eventos aparcados no se confirman NUNCA. De ahí todo lo de abajo.
ok('3a · HECHO sigue siendo el botón que confirma',
   /onclick="closePlayerActionModal\(\)"[^>]*>HECHO</.test(index));
ok('3b · el modal sigue sin ✕ propio (HECHO es la única salida)',
   !/id="player-action-modal"[\s\S]{0,2000}closePlayerActionModal\(\)"[^>]*>✕/.test(index));

ok('3c · HECHO tiene 52px de alto al tacto (el mayor del modal)',
   /#player-action-modal \.btn\.primary\s*\{[^}]*min-height:\s*52px/.test(cssLimpio));
ok('3d · el resto de botones del modal llegan a 46px',
   /#player-action-modal \.btn\s*\{[^}]*min-height:\s*46px/.test(cssLimpio));
ok('3e · los ±1 de goles suben a 44px (llevaban 0.5rem inline = ~36px)',
   /#player-action-modal \.btn\.danger[\s\S]{0,120}min-height:\s*44px\s*!important/.test(cssLimpio));
ok('3f · el botón de lesión también',
   /#player-action-modal #btn-injury\s*\{[^}]*min-height:\s*46px/.test(cssLimpio));
ok('3g · touch-action:manipulation quita el retardo de doble toque',
   (css.match(/#player-action-modal[^{]*\{[^}]*touch-action:\s*manipulation/g) || []).length >= 3);

// 3.2 · Móvil apaisado (el caso real en la banda): el modal se desplaza y el pie
//       con LIMPIAR/HECHO queda pegado abajo, siempre visible.
ok('3h · en pantallas bajas el modal se puede desplazar',
   /@media\s*\(max-height:\s*500px\)\s*\{[\s\S]{0,400}#player-action-modal \.modal-content\s*\{[^}]*overflow-y:\s*auto/.test(cssLimpio));
ok('3i · y el pie con HECHO queda fijado abajo (sticky)',
   /#player-action-modal \.modal-content\s*>\s*div:last-child\s*\{[^}]*position:\s*sticky/.test(cssLimpio));

// 3.3 · El pie sticky apunta al ÚLTIMO hijo del modal. Si alguien añade un
//       bloque después de la fila LIMPIAR/HECHO, el sticky se pega al bloque
//       equivocado y HECHO vuelve a poder quedar fuera de pantalla.
const modalPA = (index.match(/<div id="player-action-modal"[\s\S]*?\n    <\/div>/) || [''])[0];
const ultimoBloque = modalPA.lastIndexOf('<div style="display:flex;gap:10px;margin-top:0.5rem;">');
ok('3j · la fila LIMPIAR/HECHO sigue siendo el último hijo del modal',
   ultimoBloque > 0 && modalPA.indexOf('HECHO', ultimoBloque) > 0);

// 3.4 · El ancho fijo de 320px acotado al viewport (iPhone SE = 320px).
ok('3k · el ancho del modal se acota al viewport en táctil',
   /#player-action-modal \.modal-content\s*\{\s*width:\s*min\(320px,\s*95vw\)\s*!important/.test(cssLimpio));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ Diseño adaptativo: todas las aserciones en verde');

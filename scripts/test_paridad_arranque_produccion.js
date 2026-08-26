// ═══════════════════════════════════════════════════════════════════════════
//  LA PANTALLA DE ACCESO Y EL ARRANQUE SON LOS DE PRODUCCIÓN — v544
// ═══════════════════════════════════════════════════════════════════════════
//  Orden del autor (2026-08-16), tras el A/B que zanja la discusión:
//     capturas 8953/8954 → testeo v543: el checkbox parpadea y desaparece
//     captura  8955      → producción v539: se queda fijo, sin problemas
//  *"Haz una copia exacta del código de producción y deja de aplicar parches
//   experimentales en el arranque."*
//
//  Y tenía razón dos veces, porque **esto ya estaba escrito** desde v492:
//     🔑 si hay que tocar la pantalla de acceso, se toca PRIMERO en producción
//        y se comprueba allí; en testeo SÓLO SE COPIA.
//  Me la salté en v541/v542/v543 y volvió a pasar lo mismo que en v477→v500:
//  capas apiladas persiguiendo un fallo que producción no tiene.
//
//  ⚠️ VERIFICADO ANTES DE REVERTIR: `firebase-init.js`, `auth.js` y
//  `role-launch.js` del commit v539 (74e227c) son **byte a byte idénticos** a
//  lo que sirve cronos-futbol-app. Es decir, `git checkout HEAD -- …` ES
//  clonar producción. (Las únicas diferencias eran caracteres corruptos dentro
//  de COMENTARIOS **en producción**, sin efecto funcional.)
//
//  ESTE GUARD NO DEFIENDE UNA IDEA MÍA: fija la AUSENCIA de las capas que se
//  retiraron, una por una, igual que el guard de v501. Si alguna vuelve, se
//  pone rojo.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}

const HTML = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const INIT = fs.readFileSync(path.join(RAIZ, 'js/services/firebase-init.js'), 'utf8');
const AUTH = fs.readFileSync(path.join(RAIZ, 'js/services/auth.js'), 'utf8');
const UTILS = fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · las capas de v541-v543, RETIRADAS ──');
// ───────────────────────────────────────────────────────────────────────────
// Cada una causó o tapó el síntoma "el checkbox aparece y desaparece".
ok('1a · 🔑🔑🔑 no hay recarga automática por versión nueva',
   !/pideLaVersionNueva|_cronosRecargaSegura/.test(HTML),
   'ES LA QUE CAUSÓ EL PARPADEO: tras recargar, la app vuelve a modo LOGIN y ' +
   'ahí la casilla está oculta por diseño');
ok('1b · el `controllerchange` vuelve a ser el de producción',
   /addEventListener\('controllerchange',\s*function\s*\(\)\s*\{\s*window\.location\.reload\(\)/.test(HTML),
   'producción recarga sin condiciones y le funciona');
ok('1c · no se marca la interacción del usuario (era para la recarga)',
   !/_cronosHuboInteraccion/.test(HTML) && !/_cronosHuboInteraccion/.test(UTILS));
ok('1d · no queda el freno antibucle (sobra sin recarga automática)',
   !/_yaSeIntento|cronos_recarga_intentada/.test(HTML));
ok('1e · ⚠️ `cronosEsSeguroRecargar` retirado de utils.js',
   !/window\.cronosEsSeguroRecargar\s*=/.test(UTILS),
   'sólo servía a la recarga automática');

ok('1f · 🔑🔑 el arranque de Firebase NO reintenta ni envuelve los imports',
   !/_importaCDN|_cronosFirebaseReady|_cronosAvisaSinFirebase/.test(INIT),
   'los reintentos de v543 son un parche experimental que producción no tiene');
// ⚠️ SÓLO EL BLOQUE DE ARRANQUE. Contando sobre el fichero entero salían 5:
// el quinto es el de App Check y el sexto grupo son los de `saFS()` al final.
//
// 🔴 v634 · LA MARCA DE FIN CAMBIÓ, Y EL GUARD SE PUSO ROJO SIN QUE HUBIERA
// NINGUNA REGRESIÓN. Cortaba por la cadena 'App Check DESACTIVADO', que
// desapareció al reactivar App Check: `indexOf` devolvió **-1**, el `slice`
// se llevó casi el fichero entero y aparecieron imports de más.
//
// 🔑 Un `indexOf` sin comprobar es una bomba de relojería en un guard: el -1
// no falla, MIENTE — y miente en la dirección de "hay una regresión". Por eso
// ahora se corta por el inicio del bloque de App Check y **se verifica que la
// marca existe**: si alguien la vuelve a mover, el guard lo dice en vez de
// disfrazarlo de otra cosa.
{
    const ini = INIT.indexOf('const { initializeApp }');
    const fin = INIT.indexOf('🛡️ v634 · APP CHECK');
    ok('1g-0 · las marcas del bloque de arranque siguen existiendo',
       ini >= 0 && fin > ini,
       'si esto falla, 1g estaría midiendo un trozo equivocado del fichero');
    const arranque = INIT.slice(ini, fin > ini ? fin : undefined);
    ok('1g · los cuatro imports vuelven a ser los literales de producción',
       (arranque.match(/await import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\//g) || []).length === 4,
       'producción arranca con los cuatro import directos, sin envoltorio');
}
ok('1h · el desplegable de clubes vuelve al sondeo de producción',
   /for \(let i = 0; i < 8; i\+\+\)/.test(AUTH) &&
   !/auth-club-reintentar/.test(AUTH),
   'la espera a la señal y el botón de reintento eran míos, no de producción');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · y las CINCO capas de v477-v500 siguen fuera ──');
// ───────────────────────────────────────────────────────────────────────────
// Las retiró v501. Se vuelven a fijar aquí porque el fallo de esta ronda tenía
// exactamente la misma forma y la tentación de reponerlas es la misma.
ok('2a · sin clase `auth-modo-login` / `mode-login` en el <body>',
   !/auth-modo-login|mode-login|mode-register/.test(HTML));
ok('2b · sin banda `position:sticky` en el panel de acceso',
   !/position:\s*sticky/.test(HTML.slice(HTML.indexOf('id="auth-screen"'),
                                         HTML.indexOf('id="auth-screen"') + 12000)));
ok('2c · 🔑 ninguna hoja gobierna #gdpr-consent-container',
   !/#gdpr-consent-container/.test(fs.readFileSync(path.join(RAIZ, 'style.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')),
   'la casilla la mandan el marcado y los dos onclick, y nadie más');
ok('2d · la casilla sigue AL FINAL del formulario, pegada al botón',
   HTML.indexOf('id="gdpr-consent-container"') < HTML.indexOf('id="auth-btn"'));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2b · la TERCERA desviación deliberada (v545) ──');
// ───────────────────────────────────────────────────────────────────────────
//  Pedida por escrito por el autor el 2026-08-16: *"garantiza que al pulsar
//  REGISTRARSE el checkbox se pinte y se quede fijo sin desaparecer jamás"*.
//  Se declara aquí como las otras dos (sello de versión y respaldo del
//  onsubmit) para que quede EXPLÍCITO que testeo se aparta de producción en
//  este punto y por qué. La causa real medida: #auth-screen tiene
//  `max-height:100dvh; overflow-y:auto`, y al desplegarse los campos de
//  registro la tarjeta CRECE y la casilla —que va al final— se sale por debajo
//  del área visible. No es `display`: es que queda fuera de la pantalla.
{
    // ⚠️ VIVE EN UN FICHERO, NO EN LÍNEA. Escribirlo inline en index.html puso
    // ROJO a test_consentimiento_visible_en_registro.js, que prohíbe scripts
    // inline dentro del bloque de acceso — y tenía razón: cada uno de los que
    // hubo allí acabó siendo una de las capas que hubo que retirar.
    const RGPD = fs.existsSync(path.join(RAIZ, 'js/core/rgpd-visible.js'))
        ? fs.readFileSync(path.join(RAIZ, 'js/core/rgpd-visible.js'), 'utf8') : '';
    ok('2b1 · existe la garantía de visibilidad en modo registro',
       /cronos-aviso-rgpd/.test(RGPD),
       'es la desviación que pidió el autor');
    ok('2b1b · ⚠️ y va en fichero, no inline en el bloque de acceso',
       /rgpd-visible\.js/.test(HTML) && !/cronos-aviso-rgpd/.test(HTML),
       'un script inline ahí es lo que prohíbe el guard del consentimiento');
    // ⚠️ SIN COMENTARIOS, SIEMPRE. El fichero explica en su cabecera que "no
    // usa position:sticky, no recarga y no espera promesas" — y esas mismas
    // palabras hacían que la aserción 2b4 se midiera a sí misma y saliera roja
    // con el código correcto. Ya pasó en el guard del consentimiento con
    // `switchTab(`. Se barre el CÓDIGO, no la prosa.
    const bloque = RGPD.replace(/\/\*[\s\S]*?\*\//g, '')
                       .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    ok('2b2 · 🔑🔑 SÓLO repone visibilidad; no oculta la casilla en ningún caso',
       !/setProperty\('display',\s*'none'/.test(bloque),
       'un vigilante que además pudiera ocultar sería el defecto, no el arreglo');
    ok('2b3 · ⚠️ y sólo actúa con el REGISTRO a la vista',
       /function enRegistro\(\)/.test(bloque) &&
       /role-container/.test(bloque) && /auth-screen/.test(bloque),
       'en modo ENTRAR la casilla debe seguir oculta, como en producción');
    ok('2b4 · ⚠️ no usa `position:sticky` ni recarga ni promesas (capas retiradas)',
       !/position:\s*sticky/.test(bloque) && !/location\.reload/.test(bloque) &&
       !/import\(/.test(bloque));
    ok('2b5 · no mueve la casilla de sitio: sigue justo encima del botón',
       HTML.indexOf('id="gdpr-consent-container"') < HTML.indexOf('id="auth-btn"'));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · lo que SÍ se queda (y por qué no toca esta pantalla) ──');
// ───────────────────────────────────────────────────────────────────────────
// v540 es la funcionalidad que el autor pidió y quiere probar. No renderiza
// nada de la pantalla de acceso: vive en el panel del entrenador y en los
// paneles de administración.
ok('3a · el segundo equipo (F7+F11) sigue implementado',
   /cronosMismaPlaza/.test(UTILS) && /cronosEquiposDeEntrenador/.test(UTILS));
ok('3b · y su validación en el registro también',
   /cronosMismaPlaza/.test(AUTH) && /cronosPuedeLlevarEquipo/.test(AUTH));
ok('3c · `cronosHayPartidoEnCurso` se queda (no tiene que ver con recargas)',
   /window\.cronosHayPartidoEnCurso\s*=/.test(UTILS) &&
   /cronosHayPartidoEnCurso/.test(fs.readFileSync(path.join(RAIZ, 'js/core/setup-modal.js'), 'utf8')),
   'arregla una guarda que miraba flags inexistentes');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ Pantalla de acceso y arranque: idénticos a producción');

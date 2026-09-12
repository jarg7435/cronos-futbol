// ═══════════════════════════════════════════════════════════════════════════
// GUARD · Fichas compactas en F11 con los DOS equipos — v691
// ═══════════════════════════════════════════════════════════════════════════
// El encargo: en Fútbol 11, y SÓLO cuando local y visitante están a la vez
// sobre el campo, las fichas ocupan casi todo el terreno y no queda hueco para
// recolocarlas con el dedo (no pueden superponerse: taparían los cronos). En
// Fútbol 7 el tamaño actual va bien y NO debe cambiar.
//
// ⚠️ POR QUÉ ESTE GUARD NO ES UN `grep`:
//   Encontrar el texto "46px" en style.css no prueba NADA. La hoja tiene tres
//   reglas distintas que fijan el tamaño de `.player-chip` (60px base, 44px en
//   `body.mode-f11` bajo 950px, y 44px en el landscape móvil) y todas menos la
//   primera llevan `!important`. Lo que decide lo que se ve es la CASCADA:
//   media query aplicable + `!important` + especificidad + orden. Así que aquí
//   se RESUELVE la cascada para un viewport y un <body> concretos, y se
//   comprueba el valor GANADOR — que es lo que el usuario ve en el iPad.
//   El motor vive en scripts/lib/css-cascada.js (v692: lo comparte el guard
//   del visor, para que no haya dos copias que midan cosas distintas).
//
// LO QUE ESTE GUARD NO PUEDE VER: el resultado visual (si 46px es "bonito" o
// si los nombres siguen solapándose). Eso sólo lo confirma el navegador.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parsearCSS, resolver } = require('./lib/css-cascada');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); fallos++; }
}

// ── 0. Sintaxis real del fichero que marca la ficha ──────────────────────────
try {
    execFileSync(process.execPath, ['--check', path.join(RAIZ, 'js/ui/render.js')], { stdio: 'pipe' });
    ok('js/ui/render.js compila (node --check)', true);
} catch (e) {
    ok('js/ui/render.js compila (node --check)', false);
}

const css = leer('style.css');
ok('style.css tiene las llaves balanceadas',
   (css.match(/{/g) || []).length === (css.match(/}/g) || []).length);

const REGLAS = parsearCSS(css);
const valor = (prop, el, vp) => resolver(REGLAS, prop, el, vp);

// ── Fábrica de escenarios ────────────────────────────────────────────────────
// bodyClases: lo que setup-modal.js pone en <body> al arrancar el partido.
function chip({ bodyClases, enCampo, hijo }) {
    const ancestros = [
        { tag: 'body', clases: bodyClases },
        { tag: 'div', clases: enCampo ? ['pitch'] : ['bench-container'] }
    ];
    const elChip = {
        tag: 'div',
        clases: ['player-chip'].concat(enCampo ? ['chip-on-field'] : []),
        ancestros
    };
    if (!hijo) return elChip;
    // La etiqueta (nombre o crono) es HIJA del chip: su cadena de ancestros
    // incluye al propio chip, que es lo que el selector del recorte exige.
    return { tag: 'div', clases: [hijo], ancestros: ancestros.concat([elChip]) };
}

const IPAD    = { ancho: 1180, alto: 820 };   // iPad apaisado
const MOVIL_L = { ancho: 844,  alto: 390 };   // móvil apaisado (el caso real en banda)
const ESCRIT  = { ancho: 1920, alto: 1080 };

// ═══ 1. EL MOTOR SE VE ROJO PRIMERO ═════════════════════════════════════════
// Antes de creerse ningún verde: el motor tiene que reproducir los tamaños que
// YA existían en la hoja antes de este cambio. Si esto fallara, cualquier
// aserción de abajo sería humo.
const f7_ipad = chip({ bodyClases: ['mode-f7'], enCampo: true });
ok('CONTROL · F7 en iPad conserva la ficha de 60px',
   valor('width', f7_ipad, IPAD) === '60px');

ok('CONTROL · escritorio (1920) no se toca: 60px',
   valor('width', chip({ bodyClases: ['mode-f11'], enCampo: true }), ESCRIT) === '60px');

// ═══ 2. EL ENCARGO ══════════════════════════════════════════════════════════
const f11_dos_ipad  = chip({ bodyClases: ['mode-f11'], enCampo: true });
const f11_dos_movil = chip({ bodyClases: ['mode-f11'], enCampo: true });
// Con `hide-visitor` sólo está MI equipo sobre el campo → no se recorta.
const f11_solo_ipad = chip({ bodyClases: ['mode-f11', 'hide-visitor'], enCampo: true });

ok('F11 + los DOS equipos, en iPad → ficha compacta (46px)',
   valor('width', f11_dos_ipad, IPAD) === '46px');

ok('F11 + los DOS equipos, en móvil → ficha compacta (38px)',
   valor('width', f11_dos_movil, MOVIL_L) === '38px');

ok('F11 con UN SOLO equipo (hide-visitor) en iPad → NO se recorta (60px)',
   valor('width', f11_solo_ipad, IPAD) === '60px');

ok('F7 con los dos equipos en móvil → se queda como estaba (no 38px)',
   valor('width', chip({ bodyClases: ['mode-f7'], enCampo: true }), MOVIL_L) !== '38px');

ok('alto y ancho de la ficha compacta coinciden (círculo) en iPad',
   valor('height', f11_dos_ipad, IPAD) === valor('width', f11_dos_ipad, IPAD));

// ═══ 3. LO QUE NO SE DEBE LLEVAR POR DELANTE ════════════════════════════════
// El banquillo mantiene su tamaño: la saturación está en el campo, y encoger
// las fichas de la banca sólo dificultaría cogerlas con el dedo.
ok('BANQUILLO en iPad (F11, dos equipos) → NO se recorta a 46px',
   valor('width', chip({ bodyClases: ['mode-f11'], enCampo: false }), IPAD) !== '46px');

// ═══ 4. LAS ETIQUETAS, QUE SON LAS QUE DE VERDAD SATURAN ════════════════════
const etiqIpad = chip({ bodyClases: ['mode-f11'], enCampo: true, hijo: 'player-name' });
const etiqCtrl = chip({ bodyClases: ['mode-f7'],  enCampo: true, hijo: 'player-name' });

ok('CONTROL · el nombre en F7 conserva su ancho máximo (110px)',
   valor('max-width', etiqCtrl, IPAD) === '110px');

ok('el nombre se estrecha en F11 con los dos equipos (76px en iPad)',
   valor('max-width', etiqIpad, IPAD) === '76px');

ok('el crono también se estrecha en F11 con los dos equipos',
   valor('max-width', chip({ bodyClases: ['mode-f11'], enCampo: true, hijo: 'player-timer' }), IPAD) === '76px');

// ═══ 5. LA MARCA LA PONE EL JS, Y EL CLON LA HEREDA ═════════════════════════
// 🔑 El arrastre táctil clona la ficha y cuelga el clon de <body> (fuera del
// campo). Si el recorte dependiera del ancestro `.pitch`, el clon volvería a
// 60px justo al levantarlo. Por eso la marca va en la PROPIA ficha.
const render = leer('js/ui/render.js');
ok('render.js marca `chip-on-field` según el estado del jugador',
   /chip-on-field/.test(render) && /player\.status\s*===\s*'field'\s*\?\s*' chip-on-field'/.test(render));

ok('el CSS del recorte NO depende de un ancestro `.pitch` (el clon vive en <body>)',
   !/\.pitch\s+\.player-chip\.chip-on-field/.test(css));

ok('el clon del arrastre se sigue creando con cloneNode(true) (copia las clases)',
   /cloneNode\(true\)/.test(render));

// ═══════════════════════════════════════════════════════════════════════════
//  SONDA (`node scripts/test_fichas_f11_compactas.js --sonda`)
//  Imprime el tamaño GANADOR en cada escenario. Sirve para dos cosas: ajustar
//  los valores sin abrir el iPad, y comprobar que el motor de arriba resuelve
//  de verdad la cascada (si devolviera `null` en todas partes, media docena de
//  aserciones "distinto de" darían verde sin medir nada).
// ═══════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--sonda')) {
    console.log('\n  ── tamaño ganador de la ficha ──');
    [['iPad 1180', IPAD], ['móvil apaisado 844', MOVIL_L], ['escritorio 1920', ESCRIT]].forEach(([nombre, vp]) => {
        const f11dos  = valor('width', chip({ bodyClases: ['mode-f11'], enCampo: true }), vp);
        const f11solo = valor('width', chip({ bodyClases: ['mode-f11', 'hide-visitor'], enCampo: true }), vp);
        const f7      = valor('width', chip({ bodyClases: ['mode-f7'], enCampo: true }), vp);
        const banca   = valor('width', chip({ bodyClases: ['mode-f11'], enCampo: false }), vp);
        console.log(`  ${nombre.padEnd(20)} F11+2 equipos: ${String(f11dos).padEnd(6)} F11 solo yo: ${String(f11solo).padEnd(6)} F7: ${String(f7).padEnd(6)} banquillo: ${banca}`);
    });
}

console.log(`\n  ${total - fallos}/${total} aserciones`);
process.exit(fallos ? 1 : 0);

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
//
// LO QUE ESTE GUARD NO PUEDE VER: el resultado visual (si 46px es "bonito" o
// si los nombres siguen solapándose). Eso sólo lo confirma el navegador.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

// ═══════════════════════════════════════════════════════════════════════════
//  MINI-MOTOR DE CASCADA
//  Quita comentarios, aplana @media de un nivel, y para cada declaración
//  guarda: media query, selector, propiedad, valor, !important y el ORDEN.
// ═══════════════════════════════════════════════════════════════════════════
function parsearCSS(texto) {
    const limpio = texto.replace(/\/\*[\s\S]*?\*\//g, '');
    const reglas = [];
    let orden = 0;

    // Recorre el texto emparejando llaves para no romperse con los @media.
    function recorrer(fragmento, media) {
        const re = /([^{}]+)\{/g;
        let m;
        while ((m = re.exec(fragmento)) !== null) {
            const cabecera = m[1].trim();
            // Localizar el bloque que abre esta llave (emparejando llaves).
            let prof = 1, i = re.lastIndex;
            while (i < fragmento.length && prof > 0) {
                if (fragmento[i] === '{') prof++;
                else if (fragmento[i] === '}') prof--;
                i++;
            }
            const cuerpo = fragmento.slice(re.lastIndex, i - 1);
            re.lastIndex = i;

            if (cabecera.startsWith('@media')) {
                recorrer(cuerpo, media ? media + ' and ' + cabecera : cabecera);
            } else if (cabecera.startsWith('@')) {
                // @keyframes y demás: no participan en esta cascada.
            } else {
                cabecera.split(',').forEach(sel => {
                    sel = sel.trim();
                    if (!sel) return;
                    cuerpo.split(';').forEach(decl => {
                        const p = decl.indexOf(':');
                        if (p === -1) return;
                        const prop = decl.slice(0, p).trim().toLowerCase();
                        let val = decl.slice(p + 1).trim();
                        if (!prop || !val) return;
                        const bang = /!important$/i.test(val);
                        val = val.replace(/!important$/i, '').trim();
                        reglas.push({ media, sel, prop, val, bang, orden: orden++ });
                    });
                });
            }
        }
    }
    recorrer(limpio, null);
    return reglas;
}

// Especificidad (a,b,c) — sin ids en juego aquí, pero se cuentan igual.
function especificidad(sel) {
    const ids = (sel.match(/#[\w-]+/g) || []).length;
    const clases = (sel.match(/\.[\w-]+/g) || []).length +
                   (sel.match(/\[[^\]]+\]/g) || []).length +
                   (sel.match(/:(?!not\()[\w-]+/g) || []).length;
    // :not() no puntúa, pero su CONTENIDO sí.
    const dentroNot = (sel.match(/:not\(([^)]*)\)/g) || [])
        .map(x => x.replace(/^:not\(|\)$/g, ''))
        .reduce((n, x) => n + (x.match(/\.[\w-]+/g) || []).length, 0);
    const tipos = (sel.replace(/[.#:\[][^\s>+~]*/g, ' ').match(/\b[a-z][\w-]*\b/gi) || []).length;
    return [ids, clases + dentroNot, tipos];
}

function ganaEspecificidad(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
}

// ¿Aplica la media query a este viewport?
function mediaAplica(media, vp) {
    if (!media) return true;
    const cond = media.replace(/@media/g, '').trim();
    let aplica = true;
    const maxW = [...cond.matchAll(/max-width\s*:\s*(\d+)px/g)].map(m => +m[1]);
    const minW = [...cond.matchAll(/min-width\s*:\s*(\d+)px/g)].map(m => +m[1]);
    const maxH = [...cond.matchAll(/max-height\s*:\s*(\d+)px/g)].map(m => +m[1]);
    maxW.forEach(v => { if (!(vp.ancho <= v)) aplica = false; });
    minW.forEach(v => { if (!(vp.ancho >= v)) aplica = false; });
    maxH.forEach(v => { if (!(vp.alto <= v)) aplica = false; });
    if (/orientation\s*:\s*landscape/.test(cond) && !(vp.ancho > vp.alto)) aplica = false;
    if (/orientation\s*:\s*portrait/.test(cond)  && !(vp.ancho <= vp.alto)) aplica = false;
    return aplica;
}

// ¿Casa el selector con el elemento simulado?
// El modelo es deliberadamente estrecho: <body class=...> → .pitch → chip.
function casaSelector(sel, el) {
    if (/::/.test(sel)) return false;
    if (/,/.test(sel)) return false;
    const partes = sel.trim().split(/\s+/);
    const ultima = partes[partes.length - 1];

    // La última parte tiene que describir al propio chip (más su hijo, si lo hay).
    const objetivo = el.hijo ? el.hijo : el;
    if (!describe(ultima, objetivo)) return false;

    // Los ancestros: body (con sus clases) y el contenedor.
    const ancestros = partes.slice(0, -1);
    if (el.hijo && ancestros.length) {
        // El último ancestro debe describir al propio chip.
        if (!describe(ancestros[ancestros.length - 1], el)) return false;
        return ancestros.slice(0, -1).every(a => describeAncestro(a, el));
    }
    return ancestros.every(a => describeAncestro(a, el));
}

function describe(parte, obj) {
    if (parte === '*') return true;
    const clases = (parte.match(/\.[\w-]+/g) || []).map(c => c.slice(1));
    const tipo = (parte.match(/^[a-z][\w-]*/i) || [null])[0];
    if (tipo && tipo !== obj.tag) return false;
    if (/[#\[:]/.test(parte.replace(/:not\([^)]*\)/g, ''))) return false; // ids/atributos/pseudos: fuera del modelo
    return clases.every(c => obj.clases.includes(c));
}

function describeAncestro(parte, el) {
    if (parte === '>' || parte === '+' || parte === '~') return false; // combinadores: fuera del modelo
    const nots = [...parte.matchAll(/:not\(([^)]*)\)/g)].map(m => m[1]);
    const limpio = parte.replace(/:not\([^)]*\)/g, '');
    const clases = (limpio.match(/\.[\w-]+/g) || []).map(c => c.slice(1));
    const tipo = (limpio.match(/^[a-z][\w-]*/i) || [null])[0];

    const candidatos = el.ancestros;
    return candidatos.some(anc => {
        if (tipo && tipo !== anc.tag) return false;
        if (!clases.every(c => anc.clases.includes(c))) return false;
        return nots.every(n => {
            const cn = (n.match(/\.[\w-]+/g) || []).map(c => c.slice(1));
            return !cn.every(c => anc.clases.includes(c));
        });
    });
}

const REGLAS = parsearCSS(css);

// Devuelve el valor GANADOR de `prop` para el elemento `el` en el viewport `vp`.
function resolver(prop, el, vp) {
    let mejor = null;
    for (const r of REGLAS) {
        if (r.prop !== prop) continue;
        if (!mediaAplica(r.media, vp)) continue;
        if (!casaSelector(r.sel, el)) continue;
        if (!mejor) { mejor = r; continue; }
        if (r.bang !== mejor.bang) { if (r.bang) mejor = r; continue; }
        const eR = especificidad(r.sel), eM = especificidad(mejor.sel);
        if (ganaEspecificidad(eR, eM)) { mejor = r; continue; }
        if (!ganaEspecificidad(eM, eR) && r.orden > mejor.orden) mejor = r;
    }
    return mejor ? mejor.val : null;
}

// ── Fábrica de escenarios ────────────────────────────────────────────────────
// bodyClases: lo que setup-modal.js pone en <body> al arrancar el partido.
function chip({ bodyClases, enCampo, hijo }) {
    const ancestros = [
        { tag: 'body', clases: bodyClases },
        { tag: 'div', clases: enCampo ? ['pitch'] : ['bench-container'] }
    ];
    const el = {
        tag: 'div',
        clases: ['player-chip'].concat(enCampo ? ['chip-on-field'] : []),
        ancestros
    };
    if (hijo) el.hijo = { tag: 'div', clases: [hijo], ancestros };
    return el;
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
   resolver('width', f7_ipad, IPAD) === '60px');

ok('CONTROL · escritorio (1920) no se toca: 60px',
   resolver('width', chip({ bodyClases: ['mode-f11'], enCampo: true }), ESCRIT) === '60px');

// ═══ 2. EL ENCARGO ══════════════════════════════════════════════════════════
const f11_dos_ipad  = chip({ bodyClases: ['mode-f11'], enCampo: true });
const f11_dos_movil = chip({ bodyClases: ['mode-f11'], enCampo: true });
// Con `hide-visitor` sólo está MI equipo sobre el campo → no se recorta.
const f11_solo_ipad = chip({ bodyClases: ['mode-f11', 'hide-visitor'], enCampo: true });

ok('F11 + los DOS equipos, en iPad → ficha compacta (46px)',
   resolver('width', f11_dos_ipad, IPAD) === '46px');

ok('F11 + los DOS equipos, en móvil → ficha compacta (38px)',
   resolver('width', f11_dos_movil, MOVIL_L) === '38px');

ok('F11 con UN SOLO equipo (hide-visitor) en iPad → NO se recorta (60px)',
   resolver('width', f11_solo_ipad, IPAD) === '60px');

ok('F7 con los dos equipos en móvil → se queda como estaba (no 38px)',
   resolver('width', chip({ bodyClases: ['mode-f7'], enCampo: true }), MOVIL_L) !== '38px');

ok('alto y ancho de la ficha compacta coinciden (círculo) en iPad',
   resolver('height', f11_dos_ipad, IPAD) === resolver('width', f11_dos_ipad, IPAD));

// ═══ 3. LO QUE NO SE DEBE LLEVAR POR DELANTE ════════════════════════════════
// El banquillo mantiene su tamaño: la saturación está en el campo, y encoger
// las fichas de la banca sólo dificultaría cogerlas con el dedo.
ok('BANQUILLO en iPad (F11, dos equipos) → NO se recorta a 46px',
   resolver('width', chip({ bodyClases: ['mode-f11'], enCampo: false }), IPAD) !== '46px');

// ═══ 4. LAS ETIQUETAS, QUE SON LAS QUE DE VERDAD SATURAN ════════════════════
const etiqIpad = chip({ bodyClases: ['mode-f11'], enCampo: true, hijo: 'player-name' });
const etiqCtrl = chip({ bodyClases: ['mode-f7'],  enCampo: true, hijo: 'player-name' });

ok('CONTROL · el nombre en F7 conserva su ancho máximo (110px)',
   resolver('max-width', etiqCtrl, IPAD) === '110px');

ok('el nombre se estrecha en F11 con los dos equipos (76px en iPad)',
   resolver('max-width', etiqIpad, IPAD) === '76px');

ok('el crono también se estrecha en F11 con los dos equipos',
   resolver('max-width', chip({ bodyClases: ['mode-f11'], enCampo: true, hijo: 'player-timer' }), IPAD) === '76px');

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
        const f11dos  = resolver('width', chip({ bodyClases: ['mode-f11'], enCampo: true }), vp);
        const f11solo = resolver('width', chip({ bodyClases: ['mode-f11', 'hide-visitor'], enCampo: true }), vp);
        const f7      = resolver('width', chip({ bodyClases: ['mode-f7'], enCampo: true }), vp);
        const banca   = resolver('width', chip({ bodyClases: ['mode-f11'], enCampo: false }), vp);
        console.log(`  ${nombre.padEnd(20)} F11+2 equipos: ${String(f11dos).padEnd(6)} F11 solo yo: ${String(f11solo).padEnd(6)} F7: ${String(f7).padEnd(6)} banquillo: ${banca}`);
    });
}

console.log(`\n  ${total - fallos}/${total} aserciones`);
process.exit(fallos ? 1 : 0);

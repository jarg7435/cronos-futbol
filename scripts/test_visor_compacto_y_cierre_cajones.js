// ═══════════════════════════════════════════════════════════════════════════
// GUARD · Los dos ajustes de usabilidad de v692
// ═══════════════════════════════════════════════════════════════════════════
//   1. VISOR EN VIVO (live.html): escala compacta cuando los DOS equipos están
//      sobre el campo en Fútbol 11 — si no, los cronos y los nombres se pisan
//      (captura IMG_0534, iPad).
//   2. PANEL DEL ENTRENADOR: con un cajón de banquillo abierto, tocar zona
//      vacía del campo lo cierra, sin tener que abrir el del equipo contrario
//      (capturas IMG_4710/IMG_4711, móvil apaisado).
//
// ⚠️ LAS DOS MITADES SE MIDEN, NO SE LEEN:
//   · La 1 resuelve la CASCADA de la hoja embebida de live.html (cuatro juegos
//     de tamaños distintos para la misma ficha), con el motor compartido de
//     scripts/lib/css-cascada.js.
//   · La 2 EJECUTA drag-drop.js dentro de un `vm` con un DOM de mentira, y
//     dispara el gesto de verdad. Un `grep` de `addEventListener` habría dado
//     verde con el defecto que se está arreglando: los oyentes EXISTÍAN desde
//     hace versiones, pero sólo en dos de los caminos de arranque.
//
// LO QUE NO PUEDE VER: si los tamaños quedan BIEN a la vista, y el
// comportamiento real del navegador con gestos encadenados.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const vm   = require('vm');
const { execFileSync } = require('child_process');
const { parsearCSS, extraerStyle, resolver } = require('./lib/css-cascada');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); fallos++; }
}

const live = leer('live.html');

// ═══════════════════════════════════════════════════════════════════════════
//  0. SINTAXIS REAL (sin esto, cualquier aserción de texto es humo)
// ═══════════════════════════════════════════════════════════════════════════
const bloques = [...live.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc=/i.test(m[1]))
    .map(m => m[2]);
const bloqueRender = bloques.find(b => /function renderField\s*\(/.test(b));

ok('live.html · se localiza el bloque <script> que define renderField', !!bloqueRender);

if (bloqueRender) {
    const tmp = path.join(os.tmpdir(), 'live_render_check_' + Date.now() + '.mjs');
    fs.writeFileSync(tmp, bloqueRender, 'utf8');
    let compila = true;
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
    catch (e) { compila = false; }
    finally { try { fs.unlinkSync(tmp); } catch (e) {} }
    ok('live.html · ese bloque compila (node --check)', compila);
}

const cssLive = extraerStyle(live);
ok('live.html · la hoja embebida tiene las llaves balanceadas',
   (cssLive.match(/{/g) || []).length === (cssLive.match(/}/g) || []).length);

// ═══════════════════════════════════════════════════════════════════════════
//  1. LA ESCALA COMPACTA DEL VISOR
// ═══════════════════════════════════════════════════════════════════════════
const REGLAS = parsearCSS(cssLive);

// #live-pitch → .live-player → .live-player-chip / -label / -time
function ficha({ compacto, parte = 'live-player-chip' }) {
    const ancestros = [
        { tag: 'body', clases: [] },
        { tag: 'div', id: 'live-pitch', clases: compacto ? ['pitch-compacto'] : [] }
    ];
    const jugador = { tag: 'div', clases: ['live-player'], ancestros };
    if (parte === 'live-player') return jugador;
    return { tag: 'div', clases: [parte], ancestros: ancestros.concat([jugador]) };
}

const PC       = { ancho: 1440, alto: 900 };                 // PC / tablet apaisada
const TABLET_V = { ancho: 820,  alto: 1180 };                // tablet vertical
const MOVIL_L  = { ancho: 844,  alto: 390 };                 // móvil apaisado
const MOVIL_V  = { ancho: 390,  alto: 844 };                 // móvil vertical

const ancho = (compacto, vp, parte) => resolver(REGLAS, 'width', ficha({ compacto, parte }), vp);

// ── CONTROL: los cuatro tamaños que la hoja YA tenía ──
// Si esto no cuadrara, el motor no estaría leyendo la hoja de live.html y todo
// lo de abajo sería humo.
ok('CONTROL · sin la clase, la ficha mide 64px en pantalla ancha',  ancho(false, PC)       === '64px');
ok('CONTROL · sin la clase, 48px en tablet vertical',               ancho(false, TABLET_V) === '48px');
ok('CONTROL · sin la clase, 32px en móvil apaisado',                ancho(false, MOVIL_L)  === '32px');
ok('CONTROL · sin la clase, 32px en móvil vertical',                ancho(false, MOVIL_V)  === '32px');

// ── El recorte, en LOS CUATRO escalones ──
// 🔑 Declararlo sólo en uno era el error fácil: la hoja tiene cuatro juegos de
// tamaños y el que no se tocara se quedaría con la ficha grande.
ok('compacto · pantalla ancha: 64px → 44px',      ancho(true, PC)       === '44px');
ok('compacto · tablet vertical: 48px → 34px',     ancho(true, TABLET_V) === '34px');
ok('compacto · móvil apaisado: 32px → 24px',      ancho(true, MOVIL_L)  === '24px');
ok('compacto · móvil vertical: 32px → 24px',      ancho(true, MOVIL_V)  === '24px');

ok('compacto · la ficha sigue siendo un círculo (alto == ancho) en pantalla ancha',
   resolver(REGLAS, 'height', ficha({ compacto: true }), PC) === ancho(true, PC));

// ── Las etiquetas, que son las que de verdad se solapan ──
ok('CONTROL · sin la clase, el nombre puede ocupar 120px en pantalla ancha',
   resolver(REGLAS, 'max-width', ficha({ compacto: false, parte: 'live-player-label' }), PC) === '120px');

ok('compacto · el nombre se estrecha a 80px en pantalla ancha',
   resolver(REGLAS, 'max-width', ficha({ compacto: true, parte: 'live-player-label' }), PC) === '80px');

ok('compacto · el crono encoge su tipografía en pantalla ancha',
   resolver(REGLAS, 'font-size', ficha({ compacto: true, parte: 'live-player-time' }), PC) === '0.66rem');

// ═══════════════════════════════════════════════════════════════════════════
//  2. QUIÉN PONE LA CLASE — Y QUE NO PUEDA CONTRADECIR AL RÓTULO
// ═══════════════════════════════════════════════════════════════════════════
// 🔑 El visor no tiene `body.mode-f11` ni `hide-visitor` (eso vive en el panel
// del entrenador): aquí la única fuente es el snapshot.
const cuerpoRender = (bloqueRender || '').match(/function renderField[\s\S]*?\n\}/);
const rf = cuerpoRender ? cuerpoRender[0] : '';

ok('renderField decide la clase con el snapshot (toggle de `pitch-compacto`)',
   /classList\.toggle\(\s*'pitch-compacto'/.test(rf));

ok('…exige Fútbol 11 con el MISMO criterio que el rótulo del marcador (`mode !== \'f7\'`)',
   /data\.mode\s*!==\s*'f7'/.test(rf) && /data\.mode\s*===\s*'f7'\s*\?\s*'Fútbol 7'/.test(live));

ok('…exige jugadores de LOS DOS equipos, y sobre el CAMPO (no la plantilla)',
   /players\.some\(p\s*=>\s*p\.team\s*===\s*'home'\)/.test(rf) &&
   /players\.some\(p\s*=>\s*p\.team\s*===\s*'away'\)/.test(rf) &&
   /const players\s*=\s*\(data\.players \|\| \[\]\)\.filter\(p => p\.status === 'field'\)/.test(bloqueRender || ''));

// ⚠️ `pitch.innerHTML = ...` se ejecuta DESPUÉS del toggle y no debe borrar la
// clase: innerHTML sustituye los HIJOS, no los atributos del propio elemento.
// Se comprueba el orden para que un refactor no invierta las dos líneas.
// 🚨 Los dos índices tienen que EXISTIR: con `indexOf` a secas, un fichero sin
// el toggle daba -1 y "-1 < N" salía VERDE. Lo cazó el red-check contra HEAD.
const iToggle = rf.indexOf("classList.toggle('pitch-compacto'");
const iPinta  = rf.indexOf('pitch.innerHTML');
ok('el toggle va ANTES de repintar el campo',
   iToggle !== -1 && iPinta !== -1 && iToggle < iPinta);

// ═══════════════════════════════════════════════════════════════════════════
//  3. TOCAR EL CAMPO CIERRA EL CAJÓN — EJECUTADO, NO LEÍDO
// ═══════════════════════════════════════════════════════════════════════════
const dragDrop = leer('js/ui/drag-drop.js');

try {
    execFileSync(process.execPath, ['--check', path.join(RAIZ, 'js/ui/drag-drop.js')], { stdio: 'pipe' });
    ok('js/ui/drag-drop.js compila (node --check)', true);
} catch (e) {
    ok('js/ui/drag-drop.js compila (node --check)', false);
}

// ── DOM de mentira, lo justo para este gesto ──
function claseStub() {
    const s = new Set();
    return {
        _set: s,
        add:    c => s.add(c),
        remove: c => s.delete(c),
        contains: c => s.has(c),
        toggle: (c, on) => { if (on === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (on) s.add(c); else s.delete(c); }
    };
}

function montarDom() {
    const oyentes = [];
    const pitch = {
        classList: claseStub(),
        addEventListener: (tipo, fn) => oyentes.push({ tipo, fn })
    };
    const izq = { classList: claseStub() };
    const der = { classList: claseStub() };
    const doc = {
        readyState: 'complete',
        addEventListener: () => {},
        getElementById: id => (id === 'football-pitch' ? pitch : null),
        querySelector: sel => (sel === '.sidebar' ? izq : sel === '.sidebar-right' ? der : null),
        querySelectorAll: () => []
    };
    return { doc, pitch, izq, der, oyentes };
}

const dom = montarDom();
const ctx = {
    document: dom.doc,
    window: { addEventListener: () => {} },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, Date, Math, players: []
};
vm.createContext(ctx);
let cargaOk = true;
try { vm.runInContext(dragDrop, ctx, { filename: 'drag-drop.js' }); }
catch (e) { cargaOk = false; console.log('    (carga: ' + e.message + ')'); }

ok('drag-drop.js se carga sin reventar con el DOM mínimo', cargaOk);

// 🔑 LA ASERCIÓN QUE CAZA EL DEFECTO ORIGINAL: el oyente queda puesto por el
// SOLO HECHO de cargar el fichero. Antes dependía de haber entrado al partido
// desde la convocatoria, así que el gesto funcionaba o no según el camino.
const tipos = dom.oyentes.map(o => o.tipo);
ok('el campo queda escuchando SIN pasar por ningún camino de arranque',
   tipos.includes('click') && tipos.includes('touchstart'));

// ── El gesto, disparado de verdad ──
function abrirCajones() { dom.izq.classList.add('open'); dom.der.classList.add('open'); }
const disparar = (tipo, target) => dom.oyentes.filter(o => o.tipo === tipo).forEach(o => o.fn({ target }));
const vacio = { closest: () => null };
const sobreFicha = { closest: sel => (sel === '.player-chip' ? {} : null) };

abrirCajones();
disparar('click', vacio);
ok('tocar zona VACÍA del campo cierra los dos cajones',
   !dom.izq.classList.contains('open') && !dom.der.classList.contains('open'));

abrirCajones();
disparar('touchstart', vacio);
ok('también con el dedo (touchstart), que es el caso de las capturas',
   !dom.izq.classList.contains('open') && !dom.der.classList.contains('open'));

// ⚠️ Los toques de una ficha BURBUJEAN hasta el campo: sin el filtro, empezar a
// arrastrar a un jugador cerraría el cajón del que estás sacando al suplente.
// 🚨 Exige que el oyente EXISTA: sin esa mitad, un fichero que no escuchara
// nada pasaba esta aserción por no hacer nada. Lo cazó el red-check.
abrirCajones();
disparar('touchstart', sobreFicha);
ok('tocar una FICHA no cierra nada (el toque burbujea, pero no es zona vacía)',
   tipos.includes('touchstart') &&
   dom.izq.classList.contains('open') && dom.der.classList.contains('open'));

// ── Idempotencia MEDIDA (no leída): volver a llamar no duplica oyentes ──
// 🚨 En try/catch: si la función no existiera, el guard tiene que ponerse ROJO,
// no REVENTAR — un guard que casca deja de informar de las aserciones que
// vienen detrás (y este proyecto ya pagó esa lección en v681).
const antes = dom.oyentes.length;
let idempotente = false;
try {
    ctx.attachPitchCloseDrawers();
    ctx.attachPitchCloseDrawers();
    idempotente = (dom.oyentes.length === antes);
} catch (e) { idempotente = false; }
ok('llamarla de nuevo no añade más oyentes (los caminos de arranque la repiten)',
   idempotente);

// ── Y que no vuelvan a aparecer registros sueltos que diverjan ──
const importJs = leer('js/ai/import.js');
const demoJs   = leer('js/match/demo-tutorial.js');
// 🚨 `[^)]*` NO servía: el registro que se está retirando es
// `addEventListener('click', () => closeDrawers())` y la clase negada se corta
// en el paréntesis de la arrow, así que la regex no casaba y la aserción daba
// VERDE contra HEAD — con los registros sueltos delante. Lo cazó el red-check.
const sueltoRe = /addEventListener\([^;]*closeDrawers/;
ok('ya no quedan `addEventListener` sueltos de closeDrawers repartidos por los caminos',
   !sueltoRe.test(importJs) &&
   !sueltoRe.test(demoJs) &&
   !sueltoRe.test(leer('js/core/app-init.js')));

ok('los caminos de arranque llaman a la puerta única',
   /attachPitchCloseDrawers\(\)/.test(importJs) && /attachPitchCloseDrawers\(\)/.test(demoJs));

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n  ${total - fallos}/${total} aserciones`);
process.exit(fallos ? 1 : 0);

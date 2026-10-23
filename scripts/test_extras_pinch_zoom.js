// ═══════════════════════════════════════════════════════════════════════════
// GUARD · 🔍 v833 · el zoom de dos dedos no descoloca los extras
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt 23-10, IMG_0672/IMG_0673, iPad): al
// ampliar el campo con dos dedos, R/P, avanzados y F-D saltaban encima de las
// fichas. Con pinch-zoom `innerWidth/innerHeight` miden la ventana VISUAL
// (~590 px a 2×) mientras `position:fixed`, los @media y los rects siguen en
// la de MAQUETACIÓN (1180): el cálculo se creía en un móvil.
//
// ⚠️ EJECUTA el cálculo real (lección de v679).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const PR  = leer('js/match/events/possession-tracker.js');
const SAV = leer('js/match/events/advanced-stats.js');

// iPad Air apaisado: maquetación 1180×820. A 2× se ven 590×410.
function cargaVista(win) {
    const ini = PR.indexOf('window.cronosExtrasVista = function');
    const fin = PR.indexOf('window.cronosExtrasMideFila = function');
    const ctx = { window: win, document: { documentElement: { clientWidth: 1180, clientHeight: 820 } } };
    vm.createContext(ctx);
    vm.runInContext(PR.slice(ini, fin), ctx);
    return ctx.window.cronosExtrasVista;
}

console.log('\n── 1 · la medida de la ventana ──');
{
    const V = cargaVista({ innerWidth: 590, innerHeight: 410, visualViewport: { scale: 2 } });
    ok('possession-tracker.js expone cronosExtrasVista', typeof V === 'function');
    const r = V();
    ok('🔴 con zoom 2× mide la ventana de MAQUETACIÓN (1180×820), no la visual',
       r.ancho === 1180 && r.alto === 820, JSON.stringify(r));
}
{
    const r = cargaVista({ innerWidth: 1180, innerHeight: 790, visualViewport: { scale: 1 } })();
    ok('sin zoom, como siempre: innerWidth/innerHeight', r.ancho === 1180 && r.alto === 790, JSON.stringify(r));
}
{
    const r = cargaVista({ innerWidth: 1366, innerHeight: 900 })();
    ok('sin visualViewport (navegador viejo), como siempre', r.ancho === 1366 && r.alto === 900, JSON.stringify(r));
}

console.log('\n── 2 · el sitio de la barra R/P con zoom ──');
{
    const ini = PR.indexOf('window.cronosPRSitioBarra = function');
    const fin = PR.indexOf('function _rectVisible');
    const ctx = { window: {}, Math };
    vm.createContext(ctx);
    vm.runInContext(PR.slice(ini, fin), ctx);
    const S = ctx.window.cronosPRSitioBarra;
    const base = { alto: 820, seguro: 0, campo: { left: 221, right: 943, top: 145, bottom: 600 },
                   visit: null, barra: { w: 260, h: 44 } };
    const antes = S(Object.assign({}, base, { ancho: 590, alto: 410 }));
    ok('(red-check) con la medida visual se creía en un MÓVIL', antes && antes.modo === 'movil',
       JSON.stringify(antes));
    const ahora = S(Object.assign({}, base, { ancho: 1180 }));
    ok('🔴 con la medida de maquetación sigue en modo iPad', ahora && ahora.modo === 'tablet',
       JSON.stringify(ahora));
    ok('🔴 y queda BAJO el césped, sin pisar las fichas', ahora && ahora.top >= 600, 'top=' + (ahora && ahora.top));
}

console.log('\n── 3 · nadie coloca con innerWidth a pelo ──');
{
    const cuerpo = (src, desde) => {
        const i = src.indexOf(desde);
        return i < 0 ? '' : src.slice(i, src.indexOf('\n    }\n', i));
    };
    const prColoca  = cuerpo(PR,  'function _colocaBarra()');
    const savColoca = cuerpo(SAV, 'function _colocaBarra()');
    const mide      = cuerpo(PR,  'window.cronosExtrasMideFila = function');
    ok('R/P · _colocaBarra usa cronosExtrasVista', /cronosExtrasVista\(\)/.test(prColoca));
    ok('R/P · _colocaBarra sin window.innerWidth/innerHeight', !/window\.inner(Width|Height)/.test(prColoca));
    ok('fila iPad · cronosExtrasMideFila usa cronosExtrasVista', /cronosExtrasVista\(\)/.test(mide));
    ok('fila iPad · sin window.innerWidth/innerHeight', !/window\.inner(Width|Height)/.test(mide));
    ok('avanzados · _colocaBarra usa cronosExtrasVista', /cronosExtrasVista\(\)/.test(savColoca));
    ok('avanzados · innerWidth sólo como reserva si falta el ayudante',
       (savColoca.match(/window\.innerWidth/g) || []).length === 1 &&
       /typeof window\.cronosExtrasVista === 'function'/.test(savColoca));
}

console.log('\n' + (total - fallos) + '/' + total + ' aserciones');
if (fallos) process.exit(1);

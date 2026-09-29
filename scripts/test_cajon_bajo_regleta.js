// ═══════════════════════════════════════════════════════════════════════════
// GUARD · 📱 v777 · El cajón del banquillo empieza DEBAJO de la regleta
// ═══════════════════════════════════════════════════════════════════════════
// Reporte del autor (implementar.txt, IMG_4900/IMG_4901, móvil apaisado): al
// hacer scroll en el banquillo, los jugadores de arriba quedaban ocultos tras
// la regleta superior y no se podían seleccionar.
//
// Causa: el cajón es `position:fixed; top:0` (z-index 2000) y la cabecera va
// en flujo con z-index 2100: la franja alta del cajón quedaba SIEMPRE debajo.
// Arreglo: `top: var(--cronos-cajon-top)`, medida en vivo por drag-drop.js.
//
// ⚠️ EJECUTA la medición (lección de v679: medir la FORMA no prueba nada).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); fallos++; }
}

// ── 1 · CSS: el cajón móvil arranca en la variable, no en 0 ────────────────
console.log('\n── 1 · style.css ──');
const css = leer('style.css');
const iniMovil = css.indexOf('/* --- MOBILE DRAWER SYSTEM --- */');
const bloque = css.slice(iniMovil, css.indexOf('.sidebar.open,', iniMovil));
ok('el bloque de cajones móviles existe', iniMovil !== -1 && bloque.length > 0);
ok('🔴 `.sidebar`/`.sidebar-right` usan `top: var(--cronos-cajon-top, 0px)`',
   /top:\s*var\(--cronos-cajon-top,\s*0px\);/.test(bloque));
ok('…y ya NO `top: 0` a secas (lo que dejaba la franja alta bajo la regleta)',
   !/\n\s*top:\s*0;/.test(bloque));
ok('CONTROL · la regleta sigue por encima del cajón (z-index 2100 > 2000)',
   /header\s*\{[^}]*z-index:\s*2100/.test(css) && /z-index:\s*2000;/.test(bloque));

// ── 2 · La medición, EJECUTADA ────────────────────────────────────────────
console.log('\n── 2 · cronosAjustaCajones() ──');
const dd = leer('js/ui/drag-drop.js');
const ini = dd.indexOf('function cronosAjustaCajones()');
const fin = dd.indexOf('window.cronosAjustaCajones = cronosAjustaCajones;');
ok('drag-drop.js define y publica `cronosAjustaCajones`', ini !== -1 && fin > ini);

function entorno(cabecera) {
    const props = {};
    const header = cabecera && {
        offsetParent: cabecera.visible ? {} : null,
        getBoundingClientRect: () => ({ bottom: cabecera.bottom }),
        _display: cabecera.visible ? 'flex' : 'none'
    };
    const ctx = {
        Math, window: {},
        document: {
            getElementById: id => (id === 'main-header' ? header : null),
            documentElement: { style: {
                getPropertyValue: k => props[k] || '',
                setProperty: (k, v) => { props[k] = v; }
            } }
        },
        getComputedStyle: el => ({ display: el._display })
    };
    vm.createContext(ctx);
    vm.runInContext(dd.slice(ini, fin) + ';this.__f = cronosAjustaCajones;', ctx);
    return { f: ctx.__f, props };
}

{
    const e = entorno({ visible: true, bottom: 43.6 });
    e.f();
    ok('🔴 regleta visible de 43.6 px → el cajón empieza en 44px', e.props['--cronos-cajon-top'] === '44px');
}
{
    const e = entorno({ visible: false, bottom: 60 });
    e.f();
    ok('regleta oculta (setup-mode) → 0px, el cajón ocupa toda la altura', e.props['--cronos-cajon-top'] === '0px');
}
{
    const e = entorno(null);
    e.f();
    ok('sin regleta en la página → 0px, sin excepción', e.props['--cronos-cajon-top'] === '0px');
}
{
    const e = entorno({ visible: true, bottom: 80 });
    e.f();
    ok('regleta en dos filas (80 px) → 80px: se mide, no se supone', e.props['--cronos-cajon-top'] === '80px');
}

// ── 3 · Cableado ──────────────────────────────────────────────────────────
console.log('\n── 3 · cuándo se mide ──');
ok('al abrir un cajón (toggleBench)',
   /function toggleBench\(team\)\s*\{[\s\S]{0,600}cronosAjustaCajones\(\);[\s\S]{0,200}classList\.toggle\('open'\)/.test(dd));
ok('al girar o cambiar el tamaño de la ventana',
   /addEventListener\('resize', cronosAjustaCajones\)/.test(dd) && /orientationchange/.test(dd));
ok('cuando la regleta cambia de tamaño (ResizeObserver)',
   /new ResizeObserver\(cronosAjustaCajones\)\.observe\(h\)/.test(dd));

console.log(`\n${total - fallos}/${total} aserciones OK`);
process.exit(fallos ? 1 : 0);

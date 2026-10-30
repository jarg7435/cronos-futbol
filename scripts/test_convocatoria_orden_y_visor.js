// ═══════════════════════════════════════════════════════════════════════════
//  GUARD v845 · Convocatoria en papel ORDENADA POR DORSAL + visor del iPad
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 29-10, capturas 11756-11757 e IMG_0674):
//   1. El PDF de la convocatoria salía en el orden de la cuadrícula de
//      selección (18, 6, 5, 13…). Tiene que ir del dorsal más bajo al más alto.
//   2. En el iPad la barra del visor («Imprimir / Guardar como PDF», «Cerrar»)
//      quedaba bajo la barra de estado de iOS (`black-translucent` +
//      `viewport-fit=cover`) y por debajo de los modales de la app.
//
//  Parte A EJECUTA rxImprimirConvocatoria con rxImprimir simulado y lee el
//  orden de la tabla. Parte B EJECUTA _rxVisorEnLaApp con un DOM mínimo y
//  mira los estilos de la capa y la barra.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SRC_PATH = process.argv[2] || path.join(__dirname, '..', 'js', 'coach', 'reports', 'reports-export.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(nombre, cond, detalle) {
    if (cond) { pass++; console.log('  ✓ ' + nombre); }
    else { fail++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + detalle : '')); }
}

// ── DOM mínimo: sólo lo que tocan el módulo al cargar y el visor ──────────
function nodo(tag) {
    const n = {
        tagName: tag, style: { cssText: '' }, children: [], parentNode: null, innerHTML: '',
        appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
        removeChild(c) { n.children = n.children.filter(x => x !== c); c.parentNode = null; },
        querySelector() { return { onclick: null }; },
        addEventListener() {}, setAttribute() {},
    };
    if (tag === 'iframe') {
        const d = { open() {}, write(h) { d.html = (d.html || '') + h; }, close() {} };
        n.contentDocument = d; n.contentWindow = { document: d, focus() {}, print() {} };
    }
    return n;
}
const body = nodo('body');
const ctx = {
    console, setTimeout, clearTimeout,
    navigator: { maxTouchPoints: 5 },
    matchMedia: () => ({ matches: true }),
    document: {
        body, head: nodo('head'),
        createElement: nodo,
        getElementById: () => null,
        addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    },
};
ctx.window = ctx;
vm.createContext(ctx);
try { vm.runInContext(SRC, ctx, { filename: 'reports-export.js' }); }
catch (e) { ok('0 · el módulo carga', false, e.message); }
ok('0 · rxImprimirConvocatoria publicado', typeof ctx.rxImprimirConvocatoria === 'function');

// ── A · orden por dorsal ──────────────────────────────────────────────────
console.log('\nA · orden de la tabla de convocados');
let opts = null;
const imprimirReal = ctx.rxImprimir;
ctx.rxImprimir = function (o) { opts = o; return true; };
// El orden de la captura 11757, con los dos 7 y uno sin número.
ctx.rxImprimirConvocatoria({
    equipo: 'Regional A',
    jugadores: [
        { num: '18', name: 'ADRIÁN PORT' }, { num: '6', name: 'CARLOS' }, { num: '5', name: 'D HNDEZ' },
        { num: '13', name: 'DOMINGO' }, { num: '12', name: 'DAVID' }, { num: '7', name: 'RAÚL' },
        { num: '4', name: 'JAVITO' }, { num: '9', name: 'CHRISTIAN' }, { num: '8', name: 'GABRI' },
        { num: '3', name: 'CAMILO' }, { num: '10', name: 'FELO' }, { num: '11', name: 'SERGIO' },
        { num: '7', name: 'MARCOS' }, { num: '14', name: 'IRIOME' }, { num: 16, name: 'GAROÉ' },
        { num: '15', name: 'KEVIN' }, { num: '2', name: 'MÉNDEZ' }, { num: '1', name: 'OMAR' },
        { num: '', name: 'SIN DORSAL' },
    ],
});
const cuerpo = (opts && opts.cuerpo) || '';
const dorsales = [...cuerpo.matchAll(/<span class="rx-dorsal">([^<]*)<\/span>/g)].map(m => m[1]);
const nombres  = [...cuerpo.matchAll(/<td class="rx-l" style="font-weight:700;color:#111827;">([^<]*)/g)].map(m => m[1].trim());
ok('A1 · se pintan los 19', dorsales.length === 19, dorsales.length);
ok('A2 · de menor a mayor (1…18)',
    dorsales.slice(0, 18).join(',') === '1,2,3,4,5,6,7,7,8,9,10,11,12,13,14,15,16,18', dorsales.join(','));
ok('A3 · dorsal repetido desempata por nombre (MARCOS antes que RAÚL)',
    nombres.indexOf('MARCOS') >= 0 && nombres.indexOf('MARCOS') < nombres.indexOf('RAÚL'));
ok('A4 · el que no tiene dorsal va al final', nombres[nombres.length - 1] === 'SIN DORSAL', nombres[nombres.length - 1]);
ok('A5 · el total no cambia', /Convocados \(19\)/.test(cuerpo));

// ── B · visor del táctil ──────────────────────────────────────────────────
console.log('\nB · visor en la app (iPad)');
ctx.rxImprimir = imprimirReal;
ctx.rxAbrirDocumento({ titulo: 'Convocatoria', doc: '<p>x</p>' });
const ov = body.children.find(c => c.id === 'rx-visor');
ok('B0 · en táctil se abre el visor', !!ov);
if (ov) {
    const z = Number((ov.style.cssText.match(/z-index:(\d+)/) || [])[1]);
    ok('B1 · z-index por encima de los modales de la app (2147482100)', z > 2147482100, z);
    const barra = ov.children[0];
    ok('B2 · la barra baja con safe-area-inset-top',
        /padding:calc\([^;]*env\(safe-area-inset-top/.test(barra.style.cssText), barra.style.cssText);
    ok('B3 · botones de 44 px y opacos',
        (barra.innerHTML.match(/min-height:44px/g) || []).length === 2 && !/rgba\(248,81,73,0\.15\)/.test(barra.innerHTML));
    ok('B4 · siguen los dos botones', /id="rx-visor-print"/.test(barra.innerHTML) && /id="rx-visor-close"/.test(barra.innerHTML));
}

console.log('\n' + pass + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail ? 1 : 0);

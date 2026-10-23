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

// ── v834 · con zoom y DESPLAZÁNDOSE, las barras no se recolocan ──────────
// Reporte del autor tras v833: al moverse por el campo ampliado, los extras
// volvían a montarse sobre las fichas. Se EJECUTA `_colocaBarra` de las dos
// barras con un DOM falso cuyas medidas cambian en cada pasada (lo que da
// Safari al desplazarse con zoom) y se exige que la barra no se mueva.
function montaDom(win) {
    let paso = 0;
    const rect = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h });
    // Con zoom cada lectura «se desplaza» 137 px: si alguien mide, se nota.
    const des = () => (win.visualViewport && win.visualViewport.scale > 1.01) ? (++paso) * 137 : 0;
    const clases = (lista) => ({
        _s: new Set(lista),
        contains(c) { return this._s.has(c); }, add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }
    });
    const hijos = (anchos, h) => anchos.map(w => ({ classList: clases([]), getBoundingClientRect: () => rect(0, 0, w, h) }));
    const els = {
        'cronos-pr-bar':  { style: {}, classList: clases(['on']), children: hijos([62, 46, 62, 54], 44),
                            getBoundingClientRect: () => rect(0, 0, 236, 44) },
        'cronos-pr-assign': { style: {} },
        'cronos-sav-bar': { style: {}, classList: clases(['on']), children: hijos([90, 90, 48, 90, 40], 54),
                            getBoundingClientRect: () => rect(0, 0, 370, 54) },
        'cronos-sav-assign': { style: {} }
    };
    const pitch = { getBoundingClientRect: () => { const d = des(); return rect(221 - d, 145 - d, 722, 455); } };
    const doc = {
        documentElement: { clientWidth: 1180, clientHeight: 820 },
        getElementById: id => els[id] || null,
        querySelector: sel => sel === '.pitch' ? pitch : null,
        createElement: () => ({ style: {} }),
        body: { appendChild() {} }
    };
    return { doc, els };
}
function cargaColocadores(win, doc) {
    const ctx = { window: win, document: doc, Math, parseFloat,
                  getComputedStyle: () => ({ paddingBottom: '0px' }) };
    vm.createContext(ctx);
    const trozo = (src, desde, hasta) => src.slice(src.indexOf(desde), src.indexOf(hasta));
    vm.runInContext(trozo(PR, 'window.cronosPRSitioBarra = function', '    function _pintaBotones()') +
                    '\nwindow.__prColoca = _colocaBarra;', ctx);
    vm.runInContext(trozo(SAV, 'window.cronosSAvSitioBarra = function', '    function _pintaBotones()') +
                    '\nwindow.__savColoca = _colocaBarra;', ctx);
    return ctx.window;
}

console.log('\n── 4 · v834 · con zoom no se recoloca nada ──');
{
    const win = { innerWidth: 1180, innerHeight: 820, visualViewport: { scale: 1 } };
    const { doc, els } = montaDom(win);
    const W = cargaColocadores(win, doc);
    ok('se cargan los dos _colocaBarra', typeof W.__prColoca === 'function' && typeof W.__savColoca === 'function');
    W.__prColoca(); W.__savColoca();
    const pr0  = { left: els['cronos-pr-bar'].style.left,  top: els['cronos-pr-bar'].style.top };
    const sav0 = { left: els['cronos-sav-bar'].style.left, top: els['cronos-sav-bar'].style.top };
    ok('sin zoom: R/P colocada bajo el campo (fila de iPad)', pr0.left === '221px' && parseInt(pr0.top, 10) >= 600,
       JSON.stringify(pr0));
    ok('sin zoom: avanzados colocada bajo el campo', !!sav0.top && parseInt(sav0.top, 10) >= 600, JSON.stringify(sav0));

    // Zoom 2× y el vigía pasa varias veces mientras el dedo desplaza el campo.
    win.visualViewport.scale = 2; win.innerWidth = 590; win.innerHeight = 410;
    for (let i = 0; i < 5; i++) { W.__prColoca(); W.__savColoca(); }
    ok('🔴 con zoom y desplazándose, R/P NO se mueve',
       els['cronos-pr-bar'].style.left === pr0.left && els['cronos-pr-bar'].style.top === pr0.top,
       JSON.stringify({ left: els['cronos-pr-bar'].style.left, top: els['cronos-pr-bar'].style.top }));
    ok('🔴 con zoom y desplazándose, avanzados NO se mueve',
       els['cronos-sav-bar'].style.left === sav0.left && els['cronos-sav-bar'].style.top === sav0.top,
       JSON.stringify({ left: els['cronos-sav-bar'].style.left, top: els['cronos-sav-bar'].style.top }));

    // Se suelta el zoom: vuelve a colocarse como siempre.
    win.visualViewport.scale = 1; win.innerWidth = 1180; win.innerHeight = 820;
    W.__prColoca(); W.__savColoca();
    ok('al volver a 1× se recoloca en el mismo sitio',
       els['cronos-pr-bar'].style.top === pr0.top && els['cronos-sav-bar'].style.top === sav0.top);
}
{
    // Barra que se enciende YA con zoom (sin sitio previo): se coloca una vez.
    const win = { innerWidth: 590, innerHeight: 410, visualViewport: { scale: 2 } };
    const { doc, els } = montaDom(win);
    const W = cargaColocadores(win, doc);
    W.__prColoca();
    ok('encendida ya con zoom: se coloca una vez (no queda sin sitio)', !!els['cronos-pr-bar'].style.top,
       JSON.stringify(els['cronos-pr-bar'].style));
}
{
    const escucha = src => /visualViewport\.addEventListener\('resize', _colocaBarra\)/.test(src);
    ok('R/P se recoloca al soltar el zoom (visualViewport resize)', escucha(PR));
    ok('avanzados se recoloca al soltar el zoom (visualViewport resize)', escucha(SAV));
}

console.log('\n' + (total - fallos) + '/' + total + ' aserciones');
if (fallos) process.exit(1);

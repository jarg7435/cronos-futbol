// ═══════════════════════════════════════════════════════════════════════════
// GUARD · 💪 v819 · F-D · Fortalezas y debilidades en directo
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt 16-10, capturas 11560/11561): el panel
// de Basket adaptado al fútbol. Botón F-D en la barra de R/P (columna derecha
// en el móvil), balance que clasifica cada apartado y Destacan / Flojean.
//
// ⚠️ EJECUTA el análisis y la colocación del botón (lección de v679).
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

const SRC = leer('js/match/events/strengths-panel.js');

// DOM mínimo: elementos con hijos reales para ver dónde acaba el botón.
function elemento(id) {
    const s = new Set();
    const el = {
        id: id || '', children: [], parentNode: null, _html: '', style: {},
        classList: { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) },
        addEventListener: () => {},
        appendChild(h) {
            if (h.parentNode) h.parentNode.removeChild(h);
            el.children.push(h); h.parentNode = el; return h;
        },
        removeChild(h) { el.children = el.children.filter(x => x !== h); h.parentNode = null; return h; },
        querySelector: () => null
    };
    Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: v => { el._html = String(v); } });
    return el;
}
function monta(o) {
    o = o || {};
    const body = elemento('body'), head = elemento('head');
    const pr = elemento('cronos-pr-bar'), sv = elemento('cronos-sav-bar');
    body.appendChild(pr); body.appendChild(sv);
    const buscar = (raiz, id) => {
        if (raiz.id === id) return raiz;
        for (const h of raiz.children) { const r = buscar(h, id); if (r) return r; }
        return null;
    };
    const doc = {
        readyState: 'complete', body, head,
        createElement: () => elemento(''),
        getElementById: id => buscar(body, id) || buscar(head, id),
        addEventListener: () => {}
    };
    const ctx = {
        document: doc, setInterval: () => 1, clearInterval: () => {}, Math, Object, String, Number,
        escapeHtml: s => String(s), players: o.players || [], masterTimeH1: o.h1 || 0, masterTimeH2: o.h2 || 0,
        window: {}
    };
    ctx.window.window = ctx.window;
    body.classList.add('x');
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: 'strengths-panel.js' });
    return { ctx, W: ctx.window, pr, sv, body };
}

// ── 1 · Clasificación de apartados ──────────────────────────────────────────
console.log('\n── 1 · cronosFDAnaliza() ──');
{
    const { W } = monta();
    const A = W.cronosFDAnaliza;
    ok('el módulo expone el análisis', typeof A === 'function');

    const sav = {
        corners:   { favor: 6, contra: 1 },
        faltas:    { favor: 2, contra: 7 },
        centros:   { total: 2 },
        ocasiones: { favor: 3, contra: 3 },
        porDorsal: { '9': { of: 3, cf: 1 }, '4': { fc: 4 } }
    };
    const a = A({
        minutos: 30, goles: { favor: 2, contra: 0 },
        pr: { rec: 10, perd: 4, porDorsal: { '9': { rec: 2 }, '4': { perd: 3 }, '6': { rec: 1 } } },
        sav,
        jugadores: [
            { number: 9, name: 'Dámaso', goals: 2 },
            { number: 4, name: 'Pepe', cards: 'amarilla', yellowCards: 1 },
            { number: 6, name: 'Pedro' }
        ]
    });
    const est = id => (a.items.find(i => i.id === id) || {}).estado;
    ok('córners 6-1 → Fortaleza', est('corners') === 'fortaleza');
    ok('faltas 2 recibidas / 7 cometidas → Punto crítico', est('faltas') === 'critico');
    ok('ocasiones 3-3 → Neutro', est('ocasiones') === 'neutro');
    ok('balance R/P 10-4 → Fortaleza', est('rp') === 'fortaleza');
    ok('goles 2-0 → Fortaleza', est('goles') === 'fortaleza');
    ok('centros: 2 en 30\' (4 por parte) → neutro o crítico, nunca fortaleza',
       est('centros') === 'neutro' || est('centros') === 'critico', est('centros'));
    ok('🔴 ordenado de más fuerte a más débil: el primero es fortaleza y el crítico va detrás',
       a.items[0].estado === 'fortaleza' &&
       a.items.findIndex(i => i.estado === 'critico') > a.items.findIndex(i => i.estado === 'neutro'));
    ok('resumen: fortalezas y puntos críticos contados',
       a.fortalezas === 3 && a.criticos >= 1, a.fortalezas + '/' + a.criticos);
    ok('«Lo mejor» es la primera fortaleza', a.mejor === a.items[0].nombre);
    ok('⭐ Destacan: #9 (2 goles, 3 ocasiones, 2 recup.) el primero',
       a.destacan.length && a.destacan[0].number === '9' && /2 goles/.test(a.destacan[0].detalle),
       JSON.stringify(a.destacan));
    ok('⚠️ Flojean: #4 (3 pérd., 4 faltas cometidas, amarilla)',
       a.flojean.length && a.flojean[0].number === '4' && /🟨/.test(a.flojean[0].detalle),
       JSON.stringify(a.flojean));
    ok('#6 con una sola recuperación no destaca ni flojea',
       !a.destacan.some(j => j.number === '6') && !a.flojean.some(j => j.number === '6'));
}
{
    const { W } = monta();
    const a = W.cronosFDAnaliza({ minutos: 5, pr: { rec: 2, perd: 1 },
        sav: { corners: { favor: 1, contra: 0 }, faltas: {}, centros: { total: 0 }, ocasiones: {} }, jugadores: [] });
    ok('con pocos apuntes todo es «Muestra escasa» (sin juzgar)',
       a.items.every(i => i.estado === 'escasa') && a.fortalezas === 0 && a.criticos === 0);
    ok('…y nadie destaca ni flojea', !a.destacan.length && !a.flojean.length);
}
{
    const { W } = monta();
    const a = W.cronosFDAnaliza({ minutos: 20, jugadores: [] });
    ok('sin R/P ni avanzadas (extras apagados) no inventa apartados', a.items.length === 0);
}

// ── 2 · Dónde va el botón ──────────────────────────────────────────────────
console.log('\n── 2 · el botón F-D sigue a las barras ──');
{
    const e = monta();
    const btn = () => e.ctx.document.getElementById('cronos-fd-btn');
    e.W.cronosFDColocaBoton();
    ok('sin barras encendidas no hay botón', !btn());
    e.sv.classList.add('on');
    e.W.cronosFDColocaBoton();
    ok('sólo avanzadas → va en su barra', btn() && btn().parentNode === e.sv);
    e.pr.classList.add('on');
    e.W.cronosFDColocaBoton();
    ok('🔴 con R/P → va en la barra de R/P (columna derecha del móvil)', btn() && btn().parentNode === e.pr);
    ok('…detrás de P (último de la barra)', e.pr.children[e.pr.children.length - 1] === btn());
    e.W.cronosFDColocaBoton(); e.W.cronosFDColocaBoton();
    ok('colocarlo varias veces no lo duplica', e.pr.children.filter(h => h.id === 'cronos-fd-btn').length === 1);
    e.pr.classList.remove('on'); e.sv.classList.remove('on');
    e.W.cronosFDColocaBoton();
    ok('al apagarse las barras desaparece', !btn());
    e.pr.classList.add('on');
    e.W.cronosFDColocaBoton();
    ok('…y vuelve el MISMO botón al encenderse', btn() && e.pr.children.length === 1);
}

// ── 3 · Abrir la ventana despeja lo demás ───────────────────────────────────
console.log('\n── 3 · cronosFDAbre() ──');
{
    const e = monta({ players: [{ team: 'home', number: 9, name: 'Dámaso', goals: 1 }] });
    const log = [];
    e.W.closeDrawers = () => log.push('cajones');
    e.W.cronosPRCierraAsignar = () => log.push('pr');
    e.W.cronosSAvCierraAsignar = () => log.push('sav');
    e.W.cronosMiLado = () => 'home';
    e.W.cronosFDAbre();
    const panel = e.ctx.document.getElementById('cronos-fd-panel');
    ok('se abre la ventana', panel && panel.classList.contains('on'));
    ok('cierra banquillos y las dos ventanas «¿de quién?»',
       log.includes('cajones') && log.includes('pr') && log.includes('sav'));
    ok('pinta título, pestañas y Destacan/Flojean',
       /F-D · Fortalezas y debilidades/.test(panel.innerHTML) && /data-fd="1T"/.test(panel.innerHTML) &&
       /DESTACAN/.test(panel.innerHTML) && /FLOJEAN/.test(panel.innerHTML));
    e.W.cronosFDCierra();
    ok('se cierra', !panel.classList.contains('on'));
}

// ── 4 · Montaje y móvil ────────────────────────────────────────────────────
console.log('\n── 4 · index.html y CSS ──');
const INDEX = leer('index.html');
const iSav = INDEX.indexOf('js/match/events/advanced-stats.js');
const iFD = INDEX.indexOf('js/match/events/strengths-panel.js');
ok('index.html carga el módulo DESPUÉS de R/P y avanzadas', iFD > iSav && iSav > 0);
ok('en la columna del móvil el botón mide lo mismo que R y P (54px)',
   /#cronos-pr-bar \.cronos-fd-btn\{width:54px;/.test(SRC));
ok('la ventana cabe en el móvil apaisado (alto de pantalla menos margen, con scroll)',
   /max-height:calc\(100vh - 12px\)/.test(SRC) && /overflow-y:auto/.test(SRC));

console.log(`\n${total - fallos}/${total} OK`);
process.exit(fallos ? 1 : 0);

// ═══════════════════════════════════════════════════════════════════════════
// GUARD · 📱 v818 · Banquillos ocultos en el móvil y extras sin solaparse
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt 16-10, IMG_5041-IMG_5045, móvil
// apaisado, pantalla del entrenador):
//   1. Los banquillos van SIEMPRE ocultos por defecto, con uno o con dos
//      equipos; LOCAL abre sólo el local y VISIT. sólo el visitante.
//   2. Las columnas de extras (R/P y avanzados) y sus ventanas «¿de quién?»
//      no se mezclan con un banquillo abierto ni entre sí.
//
// Antes, con un solo equipo el banquillo era una columna FIJA de 170px y la
// columna de extras avanzados y su ventana quedaban montadas encima.
//
// ⚠️ EJECUTA la cascada y los cálculos (lección de v679).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { parsearCSS, resolver } = require('./lib/css-cascada');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 240));
        fallos++;
    }
}

const CSS = leer('style.css');
const REGLAS = parsearCSS(CSS);
const MOVIL = { ancho: 852, alto: 393 };   // IMG_5041, apaisado
const cuerpo = (clases) => ({ tag: 'body', clases: clases });
const lado = (clase, clasesBody, prop) => resolver(REGLAS, prop,
    { tag: 'div', clases: [clase], ancestros: [cuerpo(clasesBody)] }, MOVIL);
const tog = (clase, clasesBody) => resolver(REGLAS, 'display',
    { tag: 'button', clases: ['mobile-toggle', clase], ancestros: [cuerpo(clasesBody)] }, MOVIL);

// ── 1 · Un solo equipo: el banquillo es CAJÓN oculto, no columna fija ───────
console.log('\n── 1 · style.css (móvil apaisado) ──');
for (const [nombre, body, mia] of [
    ['en casa', ['hide-visitor'], 'sidebar'],
    ['de visitante', ['hide-visitor', 'role-away'], 'sidebar-right'],
    ['con dos equipos', [], 'sidebar']
]) {
    const pos = lado(mia, body, 'position');
    const tr  = lado(mia, body, 'transform');
    ok('🔴 ' + nombre + ': mi banquillo es cajón FIJO (no columna relativa)',
       pos === 'fixed', 'position=' + pos);
    ok('   …y empieza FUERA de la pantalla (oculto por defecto)',
       /translateX\(-?110%\)/.test(tr || ''), 'transform=' + tr);
}
ok('ya no queda la columna fija de 170px del modo un equipo',
   !/\.hide-visitor[^{]*\.sidebar[^{]*\{[^}]*position:\s*relative\s*!important[^}]*width:\s*170px/.test(CSS));

ok('en casa se ve LOCAL y sobra VISIT.',
   tog('home', ['hide-visitor']) !== 'none' && tog('away', ['hide-visitor']) === 'none');
ok('de visitante se ve VISIT. y sobra LOCAL',
   tog('away', ['hide-visitor', 'role-away']) !== 'none' &&
   tog('home', ['hide-visitor', 'role-away']) === 'none');
ok('con dos equipos se ven los dos',
   tog('home', []) !== 'none' && tog('away', []) !== 'none');

// ── 2 · toggleBench: abrir un banquillo cierra las ventanas «¿de quién?» ────
console.log('\n── 2 · toggleBench() ejecutado ──');
const dd = leer('js/ui/drag-drop.js');
function clases(abierta) {
    const s = new Set(abierta ? ['open'] : []);
    return { contains: c => s.has(c), add: c => s.add(c), remove: c => s.delete(c),
             toggle: c => (s.has(c) ? s.delete(c) : s.add(c)) };
}
function montaToggle() {
    const izq = { classList: clases(false) }, der = { classList: clases(false) };
    const log = [];
    const window = {
        cronosPRCierraAsignar: () => log.push('pr-cierra'),
        cronosSAvCierraAsignar: () => log.push('sav-cierra'),
        cronosPRColoca: () => log.push('pr-coloca'),
        cronosSAvColoca: () => log.push('sav-coloca')
    };
    const ctx = { window, cronosAjustaCajones: () => {},
        document: { querySelector: s => (s === '.sidebar' ? izq : s === '.sidebar-right' ? der : null) } };
    vm.createContext(ctx);
    const ini = dd.indexOf('function toggleBench(team)');
    const fin = dd.indexOf('let _pitchCierraCajonesPuesto');
    vm.runInContext(dd.slice(ini, fin), ctx);
    return { ctx, izq, der, log };
}
{
    const e = montaToggle();
    e.ctx.toggleBench('home');
    ok('LOCAL abre SÓLO el banquillo local',
       e.izq.classList.contains('open') && !e.der.classList.contains('open'));
    ok('🔴 …y cierra las dos ventanas «¿de quién?»',
       e.log.includes('pr-cierra') && e.log.includes('sav-cierra'), e.log.join(','));
    ok('…y recoloca las columnas de extras al momento',
       e.log.includes('pr-coloca') && e.log.includes('sav-coloca'));
    e.ctx.toggleBench('away');
    ok('VISIT. abre SÓLO el visitante (cierra el local)',
       e.der.classList.contains('open') && !e.izq.classList.contains('open'));
    e.log.length = 0;
    e.ctx.toggleBench('away');
    ok('cerrar un banquillo no toca las ventanas',
       !e.der.classList.contains('open') && !e.log.includes('pr-cierra'));
}

// ── 3 · Abrir una ventana «¿de quién?» cierra banquillo y la otra ventana ───
console.log('\n── 3 · _abreBarra ──');
const PR  = leer('js/match/events/possession-tracker.js');
const SAV = leer('js/match/events/advanced-stats.js');
for (const [nom, src, otra] of [['R/P', PR, 'cronosSAvCierraAsignar'], ['avanzados', SAV, 'cronosPRCierraAsignar']]) {
    const ini = src.indexOf('function _abreBarra(item)');
    const cuerpoF = src.slice(ini, src.indexOf('function _cierraBarraYa', ini));
    const iOn = cuerpoF.indexOf("cont.classList.add('on')");
    const antes = cuerpoF.slice(0, iOn);
    ok(nom + ': cierra los banquillos antes de enseñarse', /window\.closeDrawers\(\)/.test(antes));
    ok(nom + ': cierra la ventana del otro bloque', antes.indexOf(otra + '()') !== -1);
}
ok('R/P publica cerrar y colocar',
   /window\.cronosPRCierraAsignar = _cierraBarraYa;/.test(PR) && /window\.cronosPRColoca = _colocaBarra;/.test(PR));
ok('avanzados publica cerrar y colocar',
   /window\.cronosSAvCierraAsignar = _cierraBarraYa;/.test(SAV) && /window\.cronosSAvColoca = _colocaBarra;/.test(SAV));
ok('la columna R/P se aparta con el cajón de VISIT. abierto',
   /#cronos-pr-bar\.tapado\{display:none;\}/.test(PR) && /querySelector\('\.sidebar-right'\)/.test(PR));

// ── 4 · Las ventanas se paran antes de la columna del otro lado ─────────────
console.log('\n── 4 · anchos de las ventanas (cálculo real) ──');
function sitio(src, nombre) {
    const ini = src.indexOf('window.' + nombre + ' = function (m)');
    const fin = src.indexOf('\n    };', ini) + 7;
    const ctx = { window: {}, Math };
    vm.createContext(ctx);
    vm.runInContext(src.slice(ini, fin), ctx);
    return ctx.window[nombre];
}
const sPR = sitio(PR, 'cronosPRSitioBarra');
const sSAV = sitio(SAV, 'cronosSAvSitioBarra');
const campo = { left: 120, right: 730, top: 60, bottom: 380, width: 610, height: 320 };
const colSav = { left: 10, right: 72, top: 120, bottom: 330, width: 62, height: 210 };
const colPr  = { left: 784, right: 838, top: 170, bottom: 330, width: 54, height: 160 };
{
    const r = sPR({ ancho: 852, alto: 393, campo, visit: null, sav: colSav, barra: { w: 54, h: 160 } });
    const bordeIzq = (852 - r.asignar.right) - r.asignar.maxW;
    ok('🔴 la ventana de R/P no pisa la columna de avanzados',
       bordeIzq >= colSav.right + 8, 'borde izquierdo=' + bordeIzq);
    const r2 = sPR({ ancho: 852, alto: 393, campo, visit: null, barra: { w: 54, h: 160 } });
    ok('CONTROL · sin columna de avanzados conserva su ancho de siempre',
       r2.asignar.maxW === Math.round(r2.left - 18));
}
{
    const r = sSAV({ ancho: 852, alto: 393, campo, local: { left: 10, top: 340, width: 70, height: 40 },
                     pr: colPr, barra: { w: 62, h: 210 } });
    ok('🔴 la ventana de avanzados no pisa la columna R/P',
       r.asignar.left + r.asignar.maxW <= colPr.left - 8,
       'borde derecho=' + (r.asignar.left + r.asignar.maxW));
}

console.log(`\n${total - fallos}/${total} OK`);
process.exit(fallos ? 1 : 0);

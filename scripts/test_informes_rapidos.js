// ─────────────────────────────────────────────────────────────────────────
//  test_informes_rapidos.js  ·  ⚡ v800
//
//  Encargo del autor (implementar.txt 2026-10-11): «Mis Informes» y
//  «Informes» de Dirección/Coordinación tienen que cargar en menos de un
//  segundo en iPad y móvil.
//
//  📏 Lo medido en producción (CD DÍA, sólo lectura) y lo que se cambió:
//    · Mis Informes bajaba las copias del entrenador de TODO el club (2.050
//      docs, 8,9 MB, 5 páginas en serie) → ahora sólo sus equipos (29-178
//      docs), en paralelo, y el histórico sin sello en segundo plano.
//    · Dirección encadenaba 5 lecturas (mi doc → usuarios → correo →
//      informes → plantillas) → ahora salen a la vez.
//    · Dirección construía las ~60 ramas del árbol con su tabla de temporada
//      aunque nacen plegadas → ahora cada rama se construye al abrirla.
//
//  Este guard vigila que esas tres cosas SIGAN ASÍ, y ejecuta el árbol para
//  comprobar que sin la opción el marcado es el de siempre.
//  (El comportamiento completo de cada pantalla lo vigilan
//  test_mis_informes_ventana_reciente.js, test_mis_informes_resumen_temporada.js
//  y test_reports_tab_tree.js, ajustados en v800.)
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};

console.log('\n── PARTE 1 · Mis Informes: sólo mis equipos, a la vez ──');
{
    const S = sinCom(leer('js/coach/comms/individual-reports.js'));
    ok('1a · 🔑 se pide por el sello del equipo (`teamId in …`)',
       /where\('teamId', 'in', sellos\)/.test(S));
    ok('1b · 🔑 las dos consultas del camino rápido van en paralelo (Promise.all)',
       /const \[delEquipo, firmadoPorMi\] = await Promise\.all\(\[/.test(S));
    ok('1c · las variantes del sello cubren la forma vieja con modalidad y la sin subcategoría',
       /\[cat, 'f7-' \+ cat, 'f11-' \+ cat\]/.test(S) && /o\.add\(c \+ '__' \+ x \+ '__'\)/.test(S));
    ok('1d · el histórico SIN sello va en segundo plano (no se espera) y se recuerda si está vacío',
       /Promise\.resolve\(\)\.then\(async \(\) => \{/.test(S) && /localStorage\.setItem\(_miClaveLegado, '0'\)/.test(S));
    ok('1e · ⚠️ si lo rápido falla, la lectura completa de siempre sigue ahí',
       /if \(!_miRapido\) \{/.test(S) && /leerSoloEntrenador\(c\)/.test(S));
}

console.log('\n── PARTE 2 · Dirección: las lecturas a la vez ──');
{
    const S = sinCom(leer('js/coach/reports/reports-tab.js'));
    ok('2a · 🔑 mi doc, usuarios, correo e informes del club salen JUNTOS',
       /await Promise\.all\(\[_leeMiDoc\(\), _leeUsuarios\(clubId\), _leePorEmail\(\), _leeInformesClub\(clubId\)\]\)/.test(S));
    ok('2b · 🔑 las plantillas se lanzan ANTES de esa tanda y se recogen al pintar',
       S.indexOf('const _sdPlantillasP') > 0 &&
       S.indexOf('const _sdPlantillasP') < S.indexOf('await Promise.all([_leeMiDoc()') &&
       /_sdPlantillas = \(await _sdPlantillasP\) \|\| \{\}/.test(S));
    ok('2c · los clubIds alternativos (v179) siguen leyéndose, después',
       /const _alternativos = \[\.\.\._allClubIds\]\.filter\(c => c !== clubId\);/.test(S));
    ok('2d · 🔑 el árbol de Informes es PEREZOSO', /lazyBody: true,/.test(S));
    ok('2e · ⚠️ una ficha ya oculta/purgada no se pinta al abrir su rama después',
       /renderLeaf: \(x\) => \(window\._sdMatchData && window\._sdMatchData\[_sdKey64\(x\.m\)\]\)/.test(S));
}

console.log('\n── PARTE 3 · el árbol perezoso, EJECUTADO ──');
{
    const win = {
        CT_CATEGORIES: [{ id: 'alevin', label: 'Alevín' }, { id: 'cadete', label: 'Cadete' }],
        CT_SUBCATS: ['A', 'B'],
    };
    const sb = { window: win, console, document: { getElementById: () => null } };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(leer('js/admin/shared/category-tree.js'), sb, { filename: 'category-tree.js' });
    const items = [{ c: 'alevin', s: 'A', t: 'P1' }, { c: 'alevin', s: 'A', t: 'P2' }, { c: 'cadete', s: 'B', t: 'P3' }];
    let llamadas = 0;
    const opts = (lazy) => ({
        items, getCat: (x) => x.c, getSub: (x) => x.s,
        renderLeaf: (x) => { llamadas++; return '<i>' + x.t + '</i>'; },
        renderSubHeader: (arr) => '<table class="ct-stats">' + arr.length + '</table>',
        alwaysSubHeader: true, emptyText: 'vacío', lazyBody: lazy,
    });
    const normal = win.ctRenderTree(Object.assign(opts(false), { lazyBody: undefined }));
    llamadas = 0;
    const perezoso = win.ctRenderTree(opts(true));
    ok('3a · 🔑 perezoso: NO se construye ninguna ficha al pintar', llamadas === 0, llamadas);
    // ⚠️ El módulo impone su catálogo real (v550): hay más ramas que las dos
    // categorías de aquí. Lo que se exige es que TODAS sean perezosas.
    ok('3b · las cabeceras (con sus contadores) SÍ están, y TODAS las ramas son perezosas',
       (perezoso.match(/class="ct-tree-sub" data-ct-lazy="/g) || []).length ===
       (perezoso.match(/class="ct-tree-sub"/g) || []).length &&
       (perezoso.match(/class="ct-tree-sub"/g) || []).length > 0 &&
       /ct-tree-count">2</.test(perezoso));
    ok('3c · ⚠️ sin la opción, el marcado es el de siempre (con fichas y tablas)',
       /<i>P1<\/i><i>P2<\/i>/.test(normal) && !/data-ct-lazy/.test(normal) && /class="ct-stats"/.test(normal));

    // Abrir una rama: ctToggleNode la construye la primera vez.
    // La rama «Alevín · Subcategoría A», que es la que tiene P1 y P2.
    const bloqueAlevin = perezoso.split('<div class="ct-tree-cat">').filter(b => /<span>Alev/.test(b))[0] || '';
    const lid = (bloqueAlevin.match(/data-ct-lazy="([^"]+)"><div class="ct-tree-head"[^]*?Subcategoría A</) || [])[1];
    const cuerpo = { innerHTML: '', classList: { contains: (c) => c === 'ct-tree-body' } };
    let abierto = false;
    const nodo = {
        children: [{ classList: { contains: () => false } }, cuerpo],
        classList: { toggle() { abierto = !abierto; }, contains: (c) => c === 'ct-tree-open' && abierto },
        getAttribute: (k) => (k === 'data-ct-lazy' ? lid : null),
        removeAttribute() { this.getAttribute = () => null; },
    };
    win.ctToggleNode({ closest: () => nodo });
    ok('3d · 🔑 al abrir la rama se construye su contenido (tabla + fichas)',
       /<table class="ct-stats">2<\/table><i>P1<\/i><i>P2<\/i>/.test(cuerpo.innerHTML), cuerpo.innerHTML);
    const antes = cuerpo.innerHTML;
    win.ctToggleNode({ closest: () => nodo });   // cerrar
    win.ctToggleNode({ closest: () => nodo });   // abrir otra vez
    ok('3e · y se queda construida: reabrir no la rehace', cuerpo.innerHTML === antes);
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);

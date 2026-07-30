// ─────────────────────────────────────────────────────────────────────────
// test_category_tree.js · Árbol de Categorías/Subcategorías compartido
// FASE 1 del requisito del autor (implementar.txt, 2026-07-30): llevar al panel
// del Director Deportivo el mismo árbol jerárquico que ya tiene el Admin de Club.
//
// ⚠️ LO PRIMERO, PORQUE CONDICIONA TODO LO DEMÁS: js/admin/shared/category-tree.js
// YA EXISTÍA desde el 2026-07-23, ya estaba cargado en index.html y YA PUBLICABA
// window.CT_CATEGORIES / CT_SUBCATS. Al planificar la fase no lo vi —busqué
// dentro de club/panel.js en vez de listar js/admin/— y estuve a punto de crear
// un CUARTO fichero con un cuarto nombre para lo mismo. La fase 1 real es mucho
// más pequeña: el sitio compartido existe, sólo faltaba USARLO y añadirle la
// parte genérica.
//
// QUÉ FIJA ESTE GUARD:
//   1. El vocabulario (7 categorías × A/B/C) se declara UNA sola vez en todo el
//      repo. Había TRES copias literales: club/panel.js, individual/panel.js y
//      el propio módulo. Añadir una categoría obligaba a acordarse de tres sitios.
//   2. El orden de los <script>: individual/panel.js lee el vocabulario AL
//      CARGAR, así que si alguien lo reordena se queda con el respaldo vacío y
//      el panel muestra un árbol sin categorías, sin fallar a gritos.
//   3. La normalización nueva (ctNormCat) es EQUIVALENTE a _normCat del motor de
//      mensajería. Si se separan, el mismo informe caería en categorías
//      distintas según quién lo mire.
//   4. Lo no clasificable se AGRUPA APARTE, no se descarta (decisión del autor).
//
// LO QUE ESTA FASE **NO** HACE, a propósito: no toca el renderizado de ninguno
// de los tres paneles existentes. El árbol de usuarios del módulo
// (renderCategoryTreeReadOnly) y los de club/individual siguen exactamente igual;
// sólo se les quitó la copia del vocabulario.
//
// ESTADO POSTERIOR (no re-derivar): la API genérica (ctRenderTree) ya la consume
// js/coach/reports/events-tab.js en las DOS pestañas —Entrenamientos (fase 3) y
// Convocatorias (fase 4)—, con el resolutor de la fase 2. Sus guards son
// scripts/test_category_tree_resolver.js y scripts/test_events_tab_tree.js.
// Falta el listado de Informes Colectivos (reports-tab.js).
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n')
                       .replace(/<!--[\s\S]*?-->/g, '');

console.log('── Árbol de categorías compartido ──\n');

const MOD = 'js/admin/shared/category-tree.js';
const src = leer(MOD);

function build() {
    const sb = { console: { log() {}, warn() {}, error() {} } };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(src, sb);
    return sb;
}

// ⚠️ COMPROBACIÓN PREVIA. Sin la API genérica, las PARTES 3-5 lanzarían al
// llamar a ctNormCat y el guard MORIRÍA sin imprimir el total — y encima con
// exit 0, que parece que todo fue bien. Un guard tiene que dar ROJO, no
// reventar. (Mismo defecto ya corregido en test_nav_stack.js PARTE 21, y que
// volví a cometer aquí: lo destapó la prueba de rojo.)
const API = ['ctNormCat', 'ctNormSubcat', 'ctGroupByCatSub', 'ctCountInCat',
             'ctRenderTree', 'ctToggleNode'];
const _sbApi = build();
const _faltan = API.filter(k => typeof _sbApi[k] !== 'function');
const API_OK = _faltan.length === 0;
ok('0 · el módulo expone la API genérica', API_OK, 'faltan: ' + _faltan.join(', '));

// ═══════ PARTE 1 · una sola declaración del vocabulario ═══════
console.log('── PARTE 1 · fuente única del vocabulario ──');
{
    const sb = build();
    ok('1a · el módulo publica CT_CATEGORIES', Array.isArray(sb.CT_CATEGORIES));
    ok('1b · con las 7 categorías', sb.CT_CATEGORIES.length === 7,
       'son ' + (sb.CT_CATEGORIES || []).length);
    ok('1c · y A/B/C', JSON.stringify(sb.CT_SUBCATS) === '["A","B","C"]',
       JSON.stringify(sb.CT_SUBCATS));

    // 🔑 EL CENSO: la lista literal de las 7 categorías sólo puede aparecer una
    // vez en todo el repo. Se detecta por la primera y la última: un array que
    // contenga 'prebenjamin' Y 'regional' como ids.
    const FICHEROS = ['js/admin/shared/category-tree.js', 'js/admin/club/panel.js',
                      'js/admin/individual/panel.js', 'js/coach/reports/club-reports.js',
                      'js/coach/reports/events-tab.js', 'js/coach/reports/reports-tab.js'];
    const conLiteral = FICHEROS.filter(f =>
        /\{\s*id:\s*'prebenjamin'/.test(sinCom(leer(f))));
    ok('1d · 🔑 la lista literal existe en UN solo fichero',
       conLiteral.length === 1 && conLiteral[0] === MOD, conLiteral.join(', '));

    ok('1e · el Admin de Club consume la compartida',
       /window\.CT_CATEGORIES/.test(sinCom(leer('js/admin/club/panel.js'))));
    ok('1f · y el Admin Individual también',
       /window\.CT_CATEGORIES/.test(sinCom(leer('js/admin/individual/panel.js'))));

    // El fuente no puede depender de caracteres invisibles (ver 3c).
    const invisibles = [...src].filter(c => c.codePointAt(0) >= 0x300 && c.codePointAt(0) <= 0x36f);
    ok('1g · ningún diacrítico combinante suelto en el fuente', invisibles.length === 0,
       'encontrados: ' + invisibles.length);
}

// ═══════ PARTE 2 · orden de carga ═══════
console.log('\n── PARTE 2 · el orden de los <script> importa ──');
{
    const idx = leer('index.html');
    const iMod  = idx.indexOf('js/admin/shared/category-tree.js');
    const iClub = idx.indexOf('js/admin/club/panel.js');
    const iInd  = idx.indexOf('js/admin/individual/panel.js');
    const iDir  = idx.indexOf('js/coach/reports/club-reports.js');

    ok('2a · index.html carga el módulo', iMod > -1);
    ok('2b · con marcador ?v=', /js\/admin\/shared\/category-tree\.js\?v=v\d+/.test(idx));

    // 🔑 individual/panel.js lee el vocabulario en un `const` DE NIVEL SUPERIOR,
    // o sea AL CARGAR. Si el módulo fuese después, se quedaría con el respaldo
    // vacío y el panel pintaría un árbol sin categorías, sin error en consola.
    ok('2c · 🔑 el módulo va ANTES que el Admin Individual (que lo lee al cargar)',
       iMod > -1 && iInd > iMod, 'mod=' + iMod + ' individual=' + iInd);
    ok('2d · y antes del Admin de Club', iClub > iMod, 'club=' + iClub);
    ok('2e · y antes del panel de Dirección, que ya lo usa',
       iDir > iMod, 'dir=' + iDir);

    // Que el respaldo exista: si el módulo faltara, el panel no debe reventar.
    const ind = sinCom(leer('js/admin/individual/panel.js'));
    ok('2f · el Admin Individual conserva respaldo si el módulo no cargara',
       /window\.CT_CATEGORIES \|\| \[\]/.test(ind));
}

// ═══════ PARTE 3 · normalización equivalente a la del motor ═══════
console.log('\n── PARTE 3 · ctNormCat == _normCat ──');
if (!API_OK) { ok('3 · omitida: falta la API genérica', false); } else {
    const sb = build();

    // Se extraen los _normCat/_normSubcat REALES de comms/panel.js y se comparan
    // sobre las mismas entradas. Si alguien toca uno de los dos, esto salta.
    const comms = leer('js/coach/comms/panel.js');
    const trozo = comms.slice(comms.indexOf('function _normCat'),
                              comms.indexOf('function _catAndSubcatMatch'));
    const sb2 = { console };
    vm.createContext(sb2);
    vm.runInContext(trozo, sb2);

    const CASOS = ['Alevín', 'ALEVIN', 'alevin', 'F7_Alevin_A', 'F11_Infantil', 'Alevin B',
                   'Prebenjamín', 'prebenjamin', 'Infantil A', '  Cadete  ', 'Juvenil_C',
                   'Regional', '', null, undefined, 'Benjamín B'];
    const distintos = CASOS.filter(c => sb.ctNormCat(c) !== sb2._normCat(c))
                           .map(c => JSON.stringify(c) + ': mod=' + sb.ctNormCat(c) + ' motor=' + sb2._normCat(c));
    ok('3a · 🔑 idénticas en los ' + CASOS.length + ' casos', distintos.length === 0,
       distintos.join(' | '));

    const SUBS = ['A', 'b', ' C ', 'Alevin A', 'A1', '', null];
    const dSub = SUBS.filter(c => sb.ctNormSubcat(c) !== sb2._normSubcat(c));
    ok('3b · y las de subcategoría también', dSub.length === 0, JSON.stringify(dSub));

    // 🔑 POR QUÉ NO SE REUTILIZA LA _normCat QUE YA TENÍA EL MÓDULO: aquella
    // hace toLowerCase() pero NO quita tildes, así que "Alevín" no casaría con
    // el id 'alevin'. Vale para usuarios (su categoría viene de un formulario y
    // ya es un id), pero los informes guardan la del partido.
    ok('3c · 🔑 "Alevín" con tilde llega a "alevin"', sb.ctNormCat('Alevín') === 'alevin',
       sb.ctNormCat('Alevín'));
    ok('3d · 🔑 y "F7_Alevin_A" también', sb.ctNormCat('F7_Alevin_A') === 'alevin',
       sb.ctNormCat('F7_Alevin_A'));

    const malos = sb.CT_CATEGORIES.filter(c => sb.ctNormCat(c.id) !== c.id);
    ok('3e · cada id es su propia forma normalizada', malos.length === 0,
       malos.map(c => c.id).join(', '));
}

// ═══════ PARTE 4 · agrupado ═══════
console.log('\n── PARTE 4 · agrupado y "Sin clasificar" ──');
if (!API_OK) { ok('4 · omitida: falta la API genérica', false); } else {
    const sb = build();
    const items = [
        { id: 1, cat: 'Alevín',      sub: 'A' },
        { id: 2, cat: 'F7_Alevin_A', sub: 'A' },   // misma rama que el 1
        { id: 3, cat: 'alevin',      sub: 'B' },
        { id: 4, cat: 'Infantil',    sub: 'A' },
        { id: 5, cat: '',            sub: 'A' },   // sin categoría
        { id: 6, cat: 'Alevín',      sub: '' },    // sin subcategoría
        { id: 7, cat: 'Marciano',    sub: 'A' },   // categoría inexistente
    ];
    const g = sb.ctGroupByCatSub(items, i => i.cat, i => i.sub);

    ok('4a · agrupa por categoría normalizada',
       (g.byCatSub.get('alevin') || new Map()).get('A').length === 2);
    ok('4b · separa subcategorías', (g.byCatSub.get('alevin') || new Map()).get('B').length === 1);
    ok('4c · no mezcla categorías', (g.byCatSub.get('infantil') || new Map()).get('A').length === 1);

    ok('4d · 🔑 lo no clasificable va aparte, NO se descarta', g.sinClasificar.length === 3,
       'son ' + g.sinClasificar.length);
    const clasificados = [...g.byCatSub.values()]
        .reduce((n, m) => n + [...m.values()].reduce((k, a) => k + a.length, 0), 0);
    ok('4e · y la cuenta cuadra: no desaparece ningún elemento',
       clasificados + g.sinClasificar.length === items.length,
       clasificados + '+' + g.sinClasificar.length + ' de ' + items.length);

    ok('4f · contador por categoría', sb.ctCountInCat(g, 'alevin') === 3);
    ok('4g · y 0 en una vacía', sb.ctCountInCat(g, 'cadete') === 0);
    ok('4h · no revienta con lista vacía', (() => {
        const v = sb.ctGroupByCatSub([], i => i, i => i);
        return v.total === 0 && v.sinClasificar.length === 0;
    })());
}

// ═══════ PARTE 5 · render genérico ═══════
console.log('\n── PARTE 5 · ctRenderTree ──');
if (!API_OK) { ok('5 · omitida: falta la API genérica', false); } else {
    const sb = build();
    const items = [
        { cat: 'Alevín',   sub: 'A', txt: 'Informe uno' },
        { cat: 'Marciano', sub: 'A', txt: 'Huerfano' },
    ];
    const html = sb.ctRenderTree({
        items, getCat: i => i.cat, getSub: i => i.sub,
        renderLeaf: i => '<div class="hoja">' + i.txt + '</div>',
    });
    // ⚠️ El render devuelve CSS + marcado, y el CSS contiene literalmente
    // `.ct-tree-open` y `.ct-tree-none`. Sin quitar el <style>, las aserciones
    // 5d y 5f medían la HOJA DE ESTILOS en vez del marcado y daban rojo por la
    // razón equivocada — el árbol sí arrancaba plegado. Misma familia que las
    // trampas de acotado ya documentadas en test_nav_stack.js.
    const marcado = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, '');

    ok('5a · pinta las 7 categorías', (html.match(/class="ct-tree-cat"/g) || []).length === 7,
       'pintadas: ' + (html.match(/class="ct-tree-cat"/g) || []).length);
    ok('5b · 21 subcategorías (7×3)', (html.match(/class="ct-tree-sub"/g) || []).length === 21);
    ok('5c · la hoja sale del callback', /class="hoja">Informe uno</.test(html));
    ok('5d · 🔑 arranca TODO PLEGADO (decisión del autor)', !/ct-tree-open/.test(marcado(html)));
    ok('5e · el nodo "Sin clasificar" aparece si hay huérfanos',
       /ct-tree-none/.test(html) && /Huerfano/.test(html));

    const limpio = sb.ctRenderTree({
        items: [{ cat: 'Alevín', sub: 'A', txt: 'ok' }],
        getCat: i => i.cat, getSub: i => i.sub, renderLeaf: i => i.txt,
    });
    ok('5f · y NO aparece si no hay ninguno', !/ct-tree-none/.test(marcado(limpio)));

    ok('5g · hideEmpty oculta las categorías vacías',
       (sb.ctRenderTree({ items: [{ cat: 'Alevín', sub: 'A', txt: 'ok' }],
                          getCat: i => i.cat, getSub: i => i.sub,
                          renderLeaf: i => i.txt, hideEmpty: true })
         .match(/class="ct-tree-cat"/g) || []).length === 1);

    // El CSS viaja con el árbol: el panel del Director NO inyecta SA_CSS, así
    // que sin esto se vería siempre desplegado.
    ok('5h · el render incluye su propio CSS', /\.ct-tree-body\{display:none/.test(html));
    ok('5i · y no usa las clases .sa-card del Admin de Club', !/sa-card/.test(html));
    ok('5j · ctToggleNode está publicado', typeof sb.ctToggleNode === 'function');
    ok('5k · y los onclick lo invocan', /onclick="ctToggleNode\(this\)"/.test(html));

    // ── renderSubHeader (fase 5): un bloque por SUBCATEGORÍA, no por hoja ──
    // Lo pide la tabla resumen de temporada del panel del Director, que habla
    // del equipo entero y no de un informe.
    {
        const llamadas = [];
        const conCab = sb.ctRenderTree({
            items: [{ cat: 'Alevín', sub: 'A', txt: 'uno' }, { cat: 'Alevín', sub: 'A', txt: 'dos' }],
            getCat: i => i.cat, getSub: i => i.sub, renderLeaf: i => '<i>' + i.txt + '</i>',
            renderSubHeader: (arr, catId, subId) => {
                llamadas.push(catId + '/' + subId + ':' + arr.length);
                return '<div class="cabecera">RESUMEN</div>';
            },
        });
        ok('5n · renderSubHeader se llama UNA vez por subcategoría con algo',
           llamadas.length === 1 && llamadas[0] === 'alevin/A:2', llamadas.join(', '));
        ok('5o · 🔑 y su bloque va ANTES de las hojas',
           conCab.indexOf('RESUMEN') < conCab.indexOf('<i>uno</i>'));
        ok('5p · 🔑 NO se llama en las subcategorías vacías (21 ramas, 1 con datos)',
           (conCab.match(/RESUMEN/g) || []).length === 1,
           'apariciones: ' + (conCab.match(/RESUMEN/g) || []).length);
        // Sin el callback el árbol tiene que quedar EXACTAMENTE igual que antes.
        const sinCab = sb.ctRenderTree({
            items: [{ cat: 'Alevín', sub: 'A', txt: 'uno' }, { cat: 'Alevín', sub: 'A', txt: 'dos' }],
            getCat: i => i.cat, getSub: i => i.sub, renderLeaf: i => '<i>' + i.txt + '</i>',
        });
        ok('5q · 🔑 es opcional: sin él, el árbol es idéntico al de siempre',
           !/cabecera/.test(sinCab) && /<i>uno<\/i><i>dos<\/i>/.test(sinCab));
        ok('5r · si el callback devuelve vacío no se cuela un undefined',
           !/undefined/.test(sb.ctRenderTree({
               items: [{ cat: 'Alevín', sub: 'A', txt: 'x' }],
               getCat: i => i.cat, getSub: i => i.sub, renderLeaf: i => i.txt,
               renderSubHeader: () => undefined,
           })));
    }

    // ⚠️ NO SE TOCA el árbol de usuarios que ya existía: sigue en pie y con su
    // propia API. Si desapareciera, romperíamos el panel del SuperAdmin.
    ok('5l · renderCategoryTreeReadOnly sigue existiendo',
       typeof sb.renderCategoryTreeReadOnly === 'function');
    ok('5m · y sus consumidores del SuperAdmin siguen llamándolo',
       /window\.renderCategoryTreeReadOnly\(/.test(leer('js/admin/superadmin/clubs-tab.js')) &&
       /window\.renderCategoryTreeReadOnly\(/.test(leer('js/admin/superadmin/individual-entity.js')));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────
// test_arbol_categoria_acentos.js · "Alevín" tiene que caer en Alevín (v565)
//
// Reporte del autor (capturas 9112/9113): las categorías **Alevín** y
// **Regional** salían VACÍAS en los DOS paneles —SuperAdmin y Administrador de
// Club—, con los datos intactos en la base y sin arreglarse al reiniciar
// sesión ni al renovar el token.
//
// 🔑🔑🔑 Los dos paneles pintan con el MISMO componente
// (js/admin/shared/category-tree.js), y su `_normCat` no quitaba los acentos
// ni el prefijo de modalidad:
//
//     'Alevín'       -> 'alevín'        ✗  (el catálogo dice 'alevin')
//     'f11_regional' -> 'f11_regional'  ✗  (el catálogo dice 'regional')
//
// así que la persona caía en "Sin categoría/subcategoría asignada" y su
// tarjeta se pintaba vacía. Que fallaran SÓLO DOS categorías es la firma del
// defecto: justo las que se guardan con tilde o con prefijo.
//
// ⚠️ No era permisos (el aviso [v549] de `platform_requests` es ruido
// esperado) ni datos borrados ni el token.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const TREE = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'shared', 'category-tree.js'), 'utf8');

function trozo(src, cabecera, cierre) {
    const i = src.indexOf(cabecera);
    if (i < 0) throw new Error('No se encontró ' + cabecera);
    const j = src.indexOf(cierre, i);
    if (j < 0) throw new Error('No se encontró el cierre de ' + cabecera);
    return src.slice(i, j + cierre.length);
}

console.log('── el árbol clasifica "Alevín" como alevin (v565) ──\n');

// Las funciones REALES del componente, incluida la normalización canónica
// `ctNormCat` en la que `_normCat` delega.
const FUENTE =
    trozo(TREE, 'window.ctNormCat = function (raw) {', '\n    };') + '\n' +
    trozo(TREE, 'window.ctNormSubcat = function (raw) {', '\n    };') + '\n' +
    trozo(TREE, 'function _normCat(', '\n    }') + '\n' +
    trozo(TREE, 'function _normSub(', '\n    }');

const sb = { String, console: { warn() {} } };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(FUENTE + '\n_nc = _normCat; _ns = _normSub;', sb);
const normCat = vm.runInContext('_nc', sb);
const normSub = vm.runInContext('_ns', sb);

// El catálogo real del componente.
const VALIDAS = new Set(['prebenjamin','benjamin','alevin','infantil','cadete',
                         'juvenil','regional','regional_fem','futurefem']);
const SUBS = ['A','B','C'];
const clasifica = (r) => {
    const c = normCat(r), s = normSub(r);
    return (VALIDAS.has(c) && SUBS.includes(s)) ? (c + '|' + s) : 'SIN_CATEGORIA';
};

console.log('── PARTE 1 · los dos casos del reporte ──');

ok('1a · 🔑🔑🔑 "Alevín"/C cae en alevin|C (antes: sin categoría)',
   clasifica({ category: 'Alevín', subcategory: 'C' }) === 'alevin|C',
   clasifica({ category: 'Alevín', subcategory: 'C' }));

ok('1b · 🔑🔑🔑 "f11_regional"/A cae en regional|A (el prefijo es modalidad)',
   clasifica({ category: 'f11_regional', subcategory: 'A' }) === 'regional|A',
   clasifica({ category: 'f11_regional', subcategory: 'A' }));

console.log('\n── PARTE 2 · el resto de formas reales ──');

const casos = [
    ['alevin',          'C', 'alevin|C'],
    ['ALEVÍN',          'c', 'alevin|C'],
    ['Prebenjamín',     'A', 'prebenjamin|A'],
    ['f7_benjamin',     'B', 'benjamin|B'],
    ['f7_prebenjamín',  'A', 'prebenjamin|A'],
    ['Regional FEM',    'A', 'regional_fem|A'],
    ['regional-fem',    'B', 'regional_fem|B'],
    ['FUTureFEM',       'A', 'futurefem|A'],
    ['Infantil',        'B', 'infantil|B'],
    ['Cadete',          'B', 'cadete|B'],
    ['Juvenil',         'B', 'juvenil|B'],
];
let malos = [];
for (const [cat, sub, esperado] of casos) {
    const r = clasifica({ category: cat, subcategory: sub });
    if (r !== esperado) malos.push(cat + '/' + sub + ' -> ' + r + ' (esperaba ' + esperado + ')');
}
ok('2a · todas las formas reales de categoría clasifican en su tarjeta',
   malos.length === 0, malos.join(' · '));

// La subcategoría derivada del sufijo sigue funcionando.
ok('2b · la subcategoría derivada del sufijo sigue saliendo ("alevin_c")',
   clasifica({ category: 'alevin_c' }) === 'alevin|C',
   clasifica({ category: 'alevin_c' }));

ok('2c · y con tilde y sufijo a la vez ("Alevín_C")',
   clasifica({ category: 'Alevín_C' }) === 'alevin|C',
   clasifica({ category: 'Alevín_C' }));

console.log('\n── PARTE 3 · lo que NO puede pasar ──');

ok('3a · ⚠️ una categoría inventada SIGUE cayendo en "sin categoría"',
   clasifica({ category: 'senior_masculino', subcategory: 'A' }) === 'SIN_CATEGORIA',
   'el bloque de sin categoría tiene que seguir avisando de lo que no encaja');

ok('3b · ⚠️ sin subcategoría válida sigue cayendo en "sin categoría"',
   clasifica({ category: 'Alevín', subcategory: 'Z' }) === 'SIN_CATEGORIA');

ok('3c · vacío no inventa categoría',
   clasifica({}) === 'SIN_CATEGORIA');

ok('3d · ⚠️ "regional_fem" NO se confunde con "regional" (v511)',
   clasifica({ category: 'Regional FEM', subcategory: 'A' }) === 'regional_fem|A' &&
   clasifica({ category: 'Regional',     subcategory: 'A' }) === 'regional|A');

console.log('\n── PARTE 4 · UNA sola normalización, no una copia ──');

ok('4a · 🔑🔑 `_normCat` DELEGA en `ctNormCat`, no reimplementa la normalización',
   /function _normCat\(r\) \{[\s\S]{0,400}window\.ctNormCat\(crudo\)/.test(TREE),
   'el resolutor bueno ya existía en este mismo fichero; faltaba usarlo');

ok('4b · ⚠️ sigue habiendo UNA sola normalización de tildes en el fichero',
   (TREE.match(/normalize\('NFD'\)/g) || []).length === 1,
   'aparece ' + (TREE.match(/normalize\('NFD'\)/g) || []).length + ' veces; ' +
   'duplicarla es lo que cazaron test_player_stats_accumulator.js (6b) y ' +
   'test_category_tree_resolver.js (4f) en el primer intento');

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

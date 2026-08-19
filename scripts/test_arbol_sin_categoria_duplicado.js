// ═══════════════════════════════════════════════════════════════════════════
//  test_arbol_sin_categoria_duplicado.js
//  EL MISMO ENTRENADOR, ARRIBA "SIN CATEGORÍA" Y ABAJO EN SU EQUIPO — v581
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt, CD Días): el panel del SuperAdmin
//  contaba **11 entrenadores donde hay 7**. Cuatro (JOSÉ, Alberto, Bruno y
//  Dámaso) salían en el bloque "⚠️ Sin categoría/subcategoría asignada (4)" y
//  ADEMÁS, más abajo, correctamente colocados en su equipo — JOSÉ en
//  Prebenjamín · A. No eran ocho personas: eran cuatro contadas dos veces.
//
//  🔑🔑🔑 EL ÁRBOL NO RECIBE PERSONAS, RECIBE PLAZAS. Quien lo llama expande
//  `allRoles` a una fila por entrada, y ahí conviven la plaza buena (con
//  categoría) y restos incompletos de esa MISMA plaza —entradas nacidas del
//  flujo de solicitud, sin `category` y a veces sin `clubId` (v560)—. Mirado
//  por separado, cada resto no tiene equipo válido y caía en "sin categoría".
//  El dato estaba bien; fallaba leer dos registros de una plaza como si fueran
//  dos plazas.
//
//  🔑 LA REGLA QUE FIJA ESTE GUARD: "sin categoría" describe a una PERSONA, no
//  a un registro. Si esa persona ya lleva ese rol CON equipo en este árbol, no
//  está sin categoría — y hace falta un pase previo, porque la fila buena
//  puede llegar DESPUÉS de la incompleta.
//
//  ⚠️ LO QUE NO PUEDE COLAPSARSE: un entrenador con un F7 y un F11 tiene DOS
//  equipos de verdad (v537) y sigue saliendo dos veces, una en cada categoría.
//  Y quien de verdad no tiene equipo sigue apareciendo en el bloque: para eso
//  existe.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

const TREE = fs.readFileSync(path.join(ROOT, 'js/admin/shared/category-tree.js'), 'utf8');
const CLUBS_TAB = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/clubs-tab.js'), 'utf8');

// ── El componente REAL, ejecutado ──────────────────────────────────────────
const sb = {
    console: { log() {}, warn() {}, error() {} },
    String, Set, Map, Array, Object, JSON, Date, RegExp, Number, isNaN,
    ROLE_META: { user: { icon: '👤', color: '#fff', label: 'Entrenador' },
                 parent: { icon: '👨‍👩‍👧', color: '#fff', label: 'Padre' } },
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(TREE, sb);
const render = sb.window.renderCategoryTreeReadOnly;

// Cuenta las filas del bloque "Sin categoría/subcategoría asignada".
function sinCategoria(html) {
    const m = html.match(/Sin categoría\/subcategoría asignada \((\d+)\)/);
    return m ? Number(m[1]) : 0;
}
// ¿Sale este correo dentro del bloque de "sin categoría"?
//  ⚠️ El bloque de huérfanos se pinta ANTES del árbol y termina donde empieza
//     la primera tarjeta de categoría, que es la única que lleva `ct-ro-card`.
function estaEnSinCategoria(html, email) {
    const i = html.indexOf('Sin categoría/subcategoría asignada');
    if (i < 0) return false;
    const j = html.indexOf('ct-ro-card', i);
    const bloque = html.slice(i, j < 0 ? html.length : j);
    return bloque.indexOf(email) >= 0;
}
//  ⚠️ UNA FILA ESCRIBE EL CORREO DOS VECES (en el `title` y a la vista), así que
//     contar apariciones del correo cuenta el doble de filas. Se cuenta el
//     `title="..."`, que sale exactamente una vez por fila.
const cuantasFilas = (html, email) => html.split('title="' + email + '"').length - 1;

const fila = (id, email, rol, cat, sub, extra) =>
    Object.assign({ id: id, email: email, firstName: email.split('@')[0],
                    _activeRoleData: Object.assign({ role: rol, clubId: 'cd_dias',
                                                     category: cat, subcategory: sub }, extra || {}) });

console.log('\n── 1 · el caso del autor: CD Días, 11 donde hay 7 ──');
{
    // Cuatro entrenadores con su plaza buena Y un resto incompleto de la misma
    // plaza. Exactamente lo que se ve en el panel: cada uno, dos filas.
    const expandidos = [
        fila('u_jose',   'jose@cd.es',   'user', 'Prebenjamín', 'A'),
        fila('u_jose',   'jose@cd.es',   'user', null, null),
        fila('u_alb',    'alberto@cd.es','user', 'Benjamín', 'B'),
        fila('u_alb',    'alberto@cd.es','user', undefined, undefined),
        fila('u_bruno',  'bruno@cd.es',  'user', 'Alevín', 'A'),
        fila('u_bruno',  'bruno@cd.es',  'user', '', ''),
        fila('u_damaso', 'damaso@cd.es', 'user', 'Cadete', 'C'),
        fila('u_damaso', 'damaso@cd.es', 'user', null, null),
        fila('u_e5', 'quinto@cd.es',  'user', 'Infantil', 'A'),
        fila('u_e6', 'sexto@cd.es',    'user', 'Juvenil', 'B'),
        fila('u_e7', 'septimo@cd.es',  'user', 'Regional', 'A'),
    ];
    const html = render(expandidos, { mode: 'club' });

    ok('1a · 🔑🔑🔑 el bloque "Sin categoría" queda VACÍO: los cuatro tienen equipo',
       sinCategoria(html) === 0, 'contaba ' + sinCategoria(html));
    ['jose@cd.es', 'alberto@cd.es', 'bruno@cd.es', 'damaso@cd.es'].forEach(e => {
        ok('1b · ' + e + ' no sale como "sin categoría"', !estaEnSinCategoria(html, e));
    });
    ok('1c · 🔑 y cada uno aparece UNA sola vez en todo el árbol (7 entrenadores, no 11)',
       ['jose@cd.es','alberto@cd.es','bruno@cd.es','damaso@cd.es',
        'quinto@cd.es','sexto@cd.es','septimo@cd.es']
           .every(e => cuantasFilas(html, e) === 1),
       ['jose@cd.es','alberto@cd.es','bruno@cd.es','damaso@cd.es']
           .map(e => e + '=' + cuantasFilas(html, e)).join(' '));
    ok('1d · y JOSÉ sigue estando donde debe: en su categoría',
       html.indexOf('jose@cd.es') > 0 && html.indexOf('Prebenjamín') > 0);
}

console.log('\n── 2 · lo que NO puede colapsarse ──');
{
    // ⚠️ Un entrenador con un F7 y un F11 lleva DOS equipos de verdad (v537).
    //    Son dos plazas, y el árbol tiene que pintar las dos.
    const html = render([
        fila('u_dos', 'dos@cd.es', 'user', 'Prebenjamín', 'A'),
        fila('u_dos', 'dos@cd.es', 'user', 'Cadete', 'B'),
    ], { mode: 'club' });
    ok('2a · ⚠️ dos equipos reales = dos filas (no se deduplica la persona)',
       cuantasFilas(html, 'dos@cd.es') === 2, cuantasFilas(html, 'dos@cd.es'));
    ok('2b · y ninguna cae en "sin categoría"', sinCategoria(html) === 0);
}
{
    // Quien de verdad no tiene equipo SIGUE saliendo: el bloque no se ha
    // desactivado, se ha dejado de llenar con falsos positivos.
    const html = render([
        fila('u_ok',     'conequipo@cd.es', 'user', 'Alevín', 'A'),
        fila('u_huerf',  'huerfano@cd.es',  'user', null, null),
    ], { mode: 'club' });
    ok('2c · 🔑 un entrenador SIN ninguna plaza válida sigue apareciendo arriba',
       sinCategoria(html) === 1 && estaEnSinCategoria(html, 'huerfano@cd.es'),
       'contaba ' + sinCategoria(html));
    ok('2d · y no arrastra al que sí tiene equipo',
       !estaEnSinCategoria(html, 'conequipo@cd.es'));
}
{
    // Dos registros incompletos de la MISMA persona tampoco se cuentan dos
    // veces: el recuento del bloque describe personas-rol, no documentos.
    const html = render([
        fila('u_h', 'huerfano@cd.es', 'user', null, null),
        fila('u_h', 'huerfano@cd.es', 'user', '', ''),
    ], { mode: 'club' });
    ok('2e · dos restos incompletos de la misma persona = UNA fila',
       sinCategoria(html) === 1, 'contaba ' + sinCategoria(html));
}
{
    // Y la misma plaza repetida tal cual tampoco se pinta dos veces.
    const html = render([
        fila('u_r', 'repe@cd.es', 'user', 'Alevín', 'A'),
        fila('u_r', 'repe@cd.es', 'user', 'alevin', 'a'),   // misma plaza, otra grafía
    ], { mode: 'club' });
    ok('2f · ⚠️ la MISMA plaza escrita de dos formas es UNA sola fila',
       cuantasFilas(html, 'repe@cd.es') === 1, cuantasFilas(html, 'repe@cd.es'));
}
{
    // El rol también distingue: entrenador y padre son dos cosas.
    const html = render([
        fila('u_p', 'padre@cd.es', 'user',   'Alevín', 'A'),
        fila('u_p', 'padre@cd.es', 'parent', null, null),
    ], { mode: 'club' });
    ok('2g · 🔑 llevar equipo como ENTRENADOR no tapa un rol de PADRE sin asignar',
       sinCategoria(html) === 1, 'contaba ' + sinCategoria(html));
}

console.log('\n── 3 · el panel del SuperAdmin no repinta plazas ya revocadas ──');
{
    // ⚠️ Desde v477/v478 la baja MARCA el rol (status:'removed') en vez de
    //    borrarlo. El panel de Club ya lo descartaba; esta copia del SA no, y
    //    la plaza revocada volvía al árbol —sin categoría útil— inflando el
    //    recuento del club.
    const i = CLUBS_TAB.indexOf('const _expandClubUsers');
    const cuerpo = CLUBS_TAB.slice(i, i + 3000);
    ok('3a · 🔑 se excluyen explícitamente los roles con status "removed"',
       /notRemoved/.test(cuerpo) && /r\.status !== 'removed'/.test(cuerpo));
    ok('3b · y sigue excluyendo los rechazados (no se ha sustituido una cosa por otra)',
       /r\.status !== 'rejected'/.test(cuerpo));
    // ⚠️ Y NO se cuela un filtro por autorización: el SA quiere ver también a
    //    los pendientes (por eso este árbol pinta el reloj ⏳). La condición que
    //    decide es la del `if`, no los respaldos que hay más arriba.
    const cond = (cuerpo.match(/if \(matchClub[^)]*\)/) || [''])[0];
    ok('3c · ⚠️ sin dejar fuera a los PENDIENTES, que el SA sí quiere ver',
       !!cond && !/isAuthorized|isAuth/.test(cond), JSON.stringify(cond));
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + pass + '/' + (pass + fail));
if (fail === 0) console.log('✅ "Sin categoría" describe personas, no registros sueltos');
else console.log('❌ ' + fail + ' aserción(es) en rojo');
process.exit(fail === 0 ? 0 : 1);

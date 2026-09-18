// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v738 · LAS COLUMNAS ▲R / ▼P, SÓLO DE CADETE HACIA ARRIBA
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-18, captura 10566): en el resumen
//  acumulado de la temporada, las columnas de recuperaciones (▲R) y pérdidas
//  (▼P) «no deben mostrarse» en Prebenjamín, Benjamín, Alevín, Infantil y
//  FUTureFEM, «ya que no se aplican en estos niveles», y se mantienen
//  «únicamente para las categorías de Cadetes hacia arriba (Cadetes, Juveniles
//  y Regionales)».
//
//  🔑 LISTA BLANCA, NO LISTA DE EXCLUSIÓN, porque el encargo dice «únicamente».
//  Con una lista de exclusión, una categoría nueva en el catálogo estrenaría
//  las columnas sola y nadie se enteraría; con lista blanca entra sin ellas y
//  hay que apuntarla a propósito. La parte 1 fija que la partición cubre el
//  catálogo ENTERO: ninguna categoría se queda sin decidir.
//
//  🚨 LA TRAMPA DE v511, QUE AQUÍ MUERDE OTRA VEZ:
//  `'regional_fem'.includes('regional')` es TRUE. Una comprobación por
//  subcadena metería a Regional FEM y a FUTureFEM en el mismo saco que
//  Regional — y el encargo los separa: Regional FEM SÍ lleva las columnas (es
//  «Regionales») y FUTureFEM NO (está en su lista de ocultar). La parte 2
//  fija justo ese par.
//
//  ⚠️ Y LA SEGUNDA PUERTA NO SE PIERDE: el extra `registro_pr` sigue mandando.
//  La categoría no ENCIENDE nada, sólo puede apagar. Un club con el extra
//  apagado no ve las columnas ni en el Juvenil (parte 3).
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
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const TREE = leer('js/admin/shared/category-tree.js');
const TAB  = leer('js/coach/reports/reports-tab.js');
const MIS  = leer('js/coach/comms/individual-reports.js');

//  Carga el módulo entero en un sandbox, como hacen los demás guards de este
//  fichero. `extra` decide qué responde `_cronosExtraEnabled('registro_pr')`;
//  sin pasarlo, la función NO EXISTE — que es el estado de los guards viejos y
//  por eso ellos siguen viendo la tabla sin columnas de P/R.
function cargar(extra) {
    const sb = { console: { log() {}, warn() {}, error() {} } };
    sb.window = sb;
    if (extra !== undefined) sb._cronosExtraEnabled = () => extra;
    vm.createContext(sb);
    vm.runInContext(TREE, sb);
    return sb;
}

console.log('\n══ v738 · ▲R/▼P sólo de Cadete hacia arriba ══');

//  ⚠️ CADA PARTE VA EN SU PROPIO `try`, NO EL GUARD ENTERO EN UNO SOLO. El
//  red-check corre esto contra el código anterior, donde `ctCategoriaRegistraPR`
//  todavía no existe: con un único `try` el primer TypeError se llevaba por
//  delante las partes 3 y 4 —las que pintan la tabla y miran las pantallas— y
//  el rojo sólo contaba 2 aserciones en vez de enseñar todo lo que falta.
//  Un guard en rojo tiene que INFORMAR, y para eso tiene que llegar al final
//  (lección de v732 y v734, afinada aquí).
const parte = (fn) => {
    try { fn(); }
    catch (e) {
        console.log('  ✗ esta parte se detuvo: ' + (e && e.message));
        console.log('     (contra el código anterior a v738 es lo esperado: ' +
                    'ctCategoriaRegistraPR todavía no existía)');
        fallos++; total++;
    }
};

const w = cargar();

// ═════════════════════════════════════════════════════════════════════
console.log('\n1) 🔑 LA PARTICIÓN CUBRE EL CATÁLOGO ENTERO');
parte(() => {
    ok('1a · el módulo expone la regla',
       typeof w.ctCategoriaRegistraPR === 'function');

    const CON = ['cadete', 'juvenil', 'regional', 'regional_fem'];
    const SIN = ['prebenjamin', 'benjamin', 'alevin', 'infantil', 'futurefem'];

    ok('1b · 🔑 las cuatro de Cadete hacia arriba SÍ llevan P/R',
       CON.every(c => w.ctCategoriaRegistraPR(c) === true),
       CON.filter(c => !w.ctCategoriaRegistraPR(c)).join(', '));
    ok('1c · 🔑 las cinco que nombra el encargo NO las llevan',
       SIN.every(c => w.ctCategoriaRegistraPR(c) === false),
       SIN.filter(c => w.ctCategoriaRegistraPR(c)).join(', '));

    //  ⚠️ ESTA ES LA ASERCIÓN QUE IMPIDE EL OLVIDO. El catálogo de categorías
    //  vive en este mismo fichero; si mañana se añade una décima y nadie la
    //  clasifica, esto se pone rojo en vez de que la categoría nueva aparezca
    //  con columnas que su nivel no registra.
    const catalogo = (w.CT_CATEGORIES || []).map(c => c.id);
    const clasificadas = CON.concat(SIN).sort().join(',');
    ok('1d · 🚨 NINGUNA categoría del catálogo se queda sin decidir',
       catalogo.length === 9 && catalogo.slice().sort().join(',') === clasificadas,
       'catálogo: ' + catalogo.join(', '));

    ok('1e · la lista blanca está publicada y es la de la regla',
       Array.isArray(w.CT_CATS_CON_PR) &&
       w.CT_CATS_CON_PR.slice().sort().join(',') === CON.slice().sort().join(','),
       JSON.stringify(w.CT_CATS_CON_PR));
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n2) 🚨 LA TRAMPA DE v511 Y LAS MIL FORMAS DEL MISMO DATO');
parte(() => {
    ok('2a · 🔑🔑 Regional FEM SÍ y FUTureFEM NO (no se decide por subcadena)',
       w.ctCategoriaRegistraPR('regional_fem') === true &&
       w.ctCategoriaRegistraPR('futurefem') === false,
       'includes("regional") sobre "regional_fem" es TRUE: por eso se compara por IGUALDAD');
    ok('2b · ⚠️ y «fem» tampoco puede ser el criterio: separa a los dos',
       w.ctCategoriaRegistraPR('Regional FEM') !== w.ctCategoriaRegistraPR('FUTureFEM'));

    //  El dato llega escrito de mil maneras según de dónde salga (el informe,
    //  el perfil, la clave del equipo). La normalización es la ÚNICA del
    //  proyecto, `ctNormCat`, y aquí se comprueba que la regla la usa.
    ok('2c · con tilde y subcategoría: «Alevín C» no lleva P/R',
       w.ctCategoriaRegistraPR('Alevín C') === false);
    ok('2d · con prefijo de modalidad: «f11_regional» sí las lleva',
       w.ctCategoriaRegistraPR('f11_regional') === true);
    ok('2e · «Regional FEM B» sigue siendo Regional FEM',
       w.ctCategoriaRegistraPR('Regional FEM B') === true);
    ok('2f · «future_fem» es FUTureFEM (lo unifica ctNormCat)',
       w.ctCategoriaRegistraPR('future_fem') === false &&
       w.ctCategoriaRegistraPR('FUTureFEM') === false);

    //  ⚠️ SIN CATEGORÍA NO SE ESCONDE NADA. Quien no sabe de qué equipo es la
    //  tabla no puede decidir, y apagar columnas por no saber le quitaría
    //  datos reales a un Regional. La decisión de aplicar la regla es de quien
    //  llama, que es quien tiene (o no) la categoría.
    ok('2g · 🔑 sin categoría la regla NO se aplica',
       w.ctCategoriaRegistraPR('') === true &&
       w.ctCategoriaRegistraPR(null) === true &&
       w.ctCategoriaRegistraPR(undefined) === true);
    ok('2h · una categoría desconocida no cuela las columnas',
       w.ctCategoriaRegistraPR('veteranos') === false);
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n3) LA TABLA, GENERADA DE VERDAD');
parte(() => {
    //  Se pinta el resumen entero y se mira el HTML: es la única forma de
    //  saber que la regla llega a la pantalla del autor.
    const filas = [{
        number: '5', alias: 'DANI', pj: 2, pt: 1, minutes: 15, goals: 1,
        yellow: 0, red: 0, injuries: 1, prRecuperaciones: 7, prPerdidas: 3,
    }];
    const R = '&#9650; R', P = '&#9660; P';

    const wOn  = cargar(true);    // club con el extra `registro_pr` encendido
    const tAlevin = wOn.ctRenderStatsTable(filas, { matchCount: 2, categoria: 'alevin' });
    const tCadete = wOn.ctRenderStatsTable(filas, { matchCount: 2, categoria: 'cadete' });

    ok('3a · 🔑🔑 el ALEVÍN de su captura ya no enseña ▲R ni ▼P',
       !tAlevin.includes(R) && !tAlevin.includes(P),
       'con el extra ENCENDIDO: la categoría manda sobre el extra para apagar');
    ok('3b · 🔑 y el CADETE las sigue enseñando',
       tCadete.includes(R) && tCadete.includes(P));
    ok('3c · los números de P/R tampoco se cuelan en el cuerpo del Alevín',
       !/>7</.test(tAlevin) && !/>3</.test(tAlevin),
       'esconder sólo la cabecera dejaría las celdas descolocadas');
    ok('3d · el Cadete sí trae sus 7 recuperaciones y 3 pérdidas',
       />7</.test(tCadete) && />3</.test(tCadete));

    //  ⚠️ EL COLSPAN DE LAS COLABORACIONES SIGUE A LAS COLUMNAS. Con P/R son
    //  10 y sin ellas 8; dejarlo fijo parte la fila sin que salte ningún error
    //  (ya avisaba el comentario de v705 en ctRenderStatsTable).
    const inv = [{ ficha: 'X1', alias: 'INVITADO', pj: 1, pt: 0, minutes: 5,
                   goals: 0, yellow: 0, red: 0, injuries: 0, hosts: ['Juvenil A'] }];
    const cAlevin = wOn.ctRenderStatsTable(filas, { matchCount: 2, categoria: 'alevin', guestRows: inv });
    const cCadete = wOn.ctRenderStatsTable(filas, { matchCount: 2, categoria: 'cadete', guestRows: inv });
    ok('3e · ⚠️ el colspan de colaboraciones baja a 8 sin las columnas',
       /colspan="8"/.test(cAlevin) && !/colspan="10"/.test(cAlevin));
    ok('3f · y se queda en 10 con ellas',
       /colspan="10"/.test(cCadete));

    //  La otra puerta, intacta: la categoría sólo puede APAGAR.
    const wOff = cargar(false);   // club con el extra apagado
    const jOff = wOff.ctRenderStatsTable(filas, { matchCount: 2, categoria: 'juvenil' });
    ok('3g · 🔑 con el extra APAGADO, ni el Juvenil las ve',
       !jOff.includes(R) && !jOff.includes(P),
       'la categoría no enciende nada: las dos puertas se suman');
    ok('3h · y `mostrarPR:false` sigue mandando sobre todo',
       !wOn.ctRenderStatsTable(filas, { categoria: 'regional', mostrarPR: false }).includes(R));

    //  Sin `opts.categoria` la tabla sale EXACTAMENTE como antes de v738: es
    //  lo que mantiene verdes a los guards que ya existían.
    ok('3i · sin categoría, la tabla es la de siempre',
       wOn.ctRenderStatsTable(filas, { matchCount: 2 }).includes(R));
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n4) LAS DOS PANTALLAS QUE PINTAN ESE RESUMEN LA PASAN');
parte(() => {
    //  El componente es UNO y lo comparten el Panel de Dirección y «Mis
    //  Informes» del entrenador. Si sólo una pasara la categoría, el
    //  entrenador del Alevín seguiría viendo las columnas que su Director ya
    //  no ve — y ése es justo el tipo de divergencia que este proyecto paga
    //  caro (v735-v737: los DOS agregadores).
    ok('4a · 🔑 el Panel de Dirección pasa la categoría de la rama',
       /ctRenderStatsTable\([\s\S]{0,200}categoria:\s*catId/.test(TAB),
       'el árbol ya la tiene resuelta ahí mismo');
    ok('4b · 🔑 y «Mis Informes» del entrenador, la de su equipo',
       /ctRenderStatsTable\([\s\S]{0,200}categoria:\s*_miCatEquipo\(\)/.test(MIS));
    ok('4c · esa categoría sale de la clave del equipo abierto',
       /_miCatEquipo\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,300}_catMia/.test(MIS),
       'la misma clave que ya usan el acumulado y el candado');
    ok('4d · ⚠️ y devuelve vacío cuando no se sabe, en vez de inventar',
       /_miCatEquipo[\s\S]{0,400}me\.categoryLabel\s*\|\|\s*''/.test(MIS));
});

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);

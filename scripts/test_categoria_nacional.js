// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v747 · LA CATEGORÍA NACIONAL Y EL CUPO DE 20 CONVOCADOS
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-20):
//   1. Categoría NACIONAL nueva, «por encima de Regional», que envuelve a los
//      equipos de Tercera RFEF hacia arriba (hasta Primera División).
//   2. En REGIONAL, hasta 20 convocados (antes 18). En NACIONAL, también 20.
//      Los titulares siguen siendo 11 y los cambios, 5 en 3 ventanas más el
//      descanso.
//   3. Un mensaje orientativo ANTES de hacer la convocatoria que diga cuántos
//      se pueden convocar y cuántos salen de titulares.
//
//  Decisiones suyas, preguntadas antes de escribir (2026-09-20):
//   · Nacional va **al final** del listado, no intercalada encima de Regional:
//     así ninguna categoría existente cambia de sitio en las pantallas.
//   · El cupo de 20 es **sólo** para Regional y Nacional. **Regional FEM se
//     queda en 18**, aunque comparta el régimen de cambios con Regional.
//
//  🔑 LA PARTE 2 EJECUTA LA REGLA DEL CUPO, no la lee. Estos números viajan
//  por cinco pantallas y el defecto que este guard viene a evitar —que una
//  capa permita 20 y la siguiente rechace con «máximo 18»— no se ve en la
//  forma del código: se ve comparando lo que SALE para cada categoría.
//
//  🚨 Y LA TRAMPA DE v511 MUERDE AQUÍ OTRA VEZ, en su peor versión:
//  `'regional_fem'.includes('regional')` es TRUE. Si el cupo se decidiera por
//  esa subcadena, Regional FEM convocaría 20 contra la decisión expresa del
//  autor — y eso es un acta federativa inválida, no un detalle de pantalla.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
//  ⚠️ FINALES DE LÍNEA NORMALIZADOS: en CRLF, `//.*$` deja de quitar
//  comentarios y las aserciones de texto medirían lo que se escribe SOBRE el
//  código (lección del red-check de v740).
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
//  Sin comentarios: la palabra 'nacional' aparece muchas veces EXPLICANDO por
//  qué está donde está. Un censo que no los quite da verde midiendo prosa.
const sinCom = s => s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

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

const UTILS  = leer('js/core/utils.js');
const TREE   = leer('js/admin/shared/category-tree.js');
const SUBR   = leer('js/match/events/sub-rules.js');
const IMPORT = leer('js/ai/import.js');
const EVL    = leer('js/core/event-listeners.js');
const WAPP   = leer('js/shared/whatsapp-email.js');
const FORM   = leer('js/roster/formations.js');
const INDEX  = leer('index.html');
const LIVE   = leer('live.html');
const ENGINE = leer('js/coach/reports/report-engine.js');
const MANUAL = leer('js/coach/comms/manual-report.js');
const CQ     = leer('js/coach/reports/cuadrante-club.js');
const SETUP  = leer('js/core/setup-modal.js');
const CPANEL = leer('js/coach/comms/panel.js');

// Recorta una función del fuente por equilibrio de llaves, para EJECUTARLA.
function extraeFn(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return null;
    const abre = src.indexOf('{', ini);
    if (abre === -1) return null;
    let n = 0;
    for (let i = abre; i < src.length; i++) {
        if (src[i] === '{') n++;
        else if (src[i] === '}') { n--; if (n === 0) return src.slice(ini, i + 1); }
    }
    return null;
}

console.log('\n══ v747 · Nacional, y el cupo de 20 ══');

// ═════════════════════════════════════════════════════════════════════
console.log('\n1) EL CATÁLOGO CONOCE LA CATEGORÍA');
{
    const sb = { console: { log() {}, warn() {}, error() {} }, document: undefined };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(TREE, sb);

    const ids = (sb.CT_CATEGORIES || []).map(c => c.id);
    ok('1a · «nacional» está en el catálogo', ids.indexOf('nacional') !== -1, ids.join(', '));
    //  🔑 AL FINAL, que es lo que él eligió. Si un día se decide subirla
    //  encima de Regional, esta aserción es la que hay que cambiar a mano — y
    //  entonces el cuadrante y los demás listados tienen que ir con ella.
    ok('1b · 🔑 y va LA ÚLTIMA (decisión suya, 2026-09-20)',
       ids[ids.length - 1] === 'nacional', ids.join(', '));
    ok('1c · con su etiqueta legible',
       (sb.CT_CATEGORIES.find(c => c.id === 'nacional') || {}).label === 'Nacional');

    //  El dato llega escrito de mil formas según de dónde salga.
    ok('1d · 🔑 «f11_nacional» y «Nacional A» se resuelven a la misma clave',
       sb.ctNormCat('f11_nacional') === 'nacional' &&
       sb.ctNormCat('Nacional A') === 'nacional' &&
       sb.ctNormCat('NACIONAL') === 'nacional',
       sb.ctNormCat('f11_nacional') + ' / ' + sb.ctNormCat('Nacional A'));
    ok('1e · y la etiqueta sale del catálogo, no de un mapa nuevo',
       typeof sb.ctCategoriaLabel === 'function' &&
       sb.ctCategoriaLabel('f11_nacional') === 'Nacional' &&
       sb.ctCategoriaLabel('regional_fem') === 'Regional FEM');

    //  🚨 P/R: v738 dice «de Cadetes hacia arriba», y Nacional está por
    //  encima de Regional. La lista es BLANCA, así que entrar en el catálogo
    //  no basta: hay que apuntarla.
    ok('1f · 🚨 Nacional lleva las columnas ▲R/▼P (está por encima de Cadete)',
       sb.ctCategoriaRegistraPR('nacional') === true &&
       sb.ctCategoriaRegistraPR('f11_nacional') === true);
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n2) 🔑🔑 EL CUPO, EJECUTADO');
{
    const SRC = extraeFn(UTILS, 'cronosCupoConvocatoria');
    ok('2a · la regla se puede extraer y correr sola',
       !!SRC, 'sin ella el resto de la parte 2 no mide nada');
    if (SRC) {
        const sb = {};
        vm.createContext(sb);
        vm.runInContext(SRC + '; this.cupo = cronosCupoConvocatoria;', sb);
        const cupo = sb.cupo;
        const conv = (mod, tipo, cat) => cupo(mod, tipo, cat).maxConvocados;

        ok('2b · 🆕 REGIONAL en liga: 20 convocados (antes 18)',
           conv('f11', 'liga', 'regional') === 20, conv('f11', 'liga', 'regional'));
        ok('2c · 🆕 NACIONAL en liga: 20 convocados',
           conv('f11', 'liga', 'nacional') === 20, conv('f11', 'liga', 'nacional'));
        ok('2d · 🚨🚨 REGIONAL FEM se queda en 18 (decisión expresa del autor)',
           conv('f11', 'liga', 'regional_fem') === 18 &&
           conv('f11', 'liga', 'Regional FEM B') === 18,
           '«regional_fem» CONTIENE «regional»: decidirlo por subcadena daría 20 y sería un acta inválida. Dio ' +
           conv('f11', 'liga', 'regional_fem'));
        ok('2e · FUTureFEM tampoco amplía',
           conv('f11', 'liga', 'futurefem') === 18, conv('f11', 'liga', 'futurefem'));
        ok('2f · Juvenil, Cadete e Infantil siguen en 18',
           conv('f11', 'liga', 'juvenil') === 18 &&
           conv('f11', 'liga', 'cadete') === 18 &&
           conv('f11', 'liga', 'infantil') === 18);
        ok('2g · el Fútbol 7 no cambia: 14',
           conv('f7', 'liga', 'alevin') === 14 &&
           conv('f7', 'liga', 'regional') === 14,
           'el cupo ampliado es de once: en F7 no hay categoría que lo tenga');

        //  Las mil formas del mismo dato.
        ok('2h · 🔑 con prefijo, con tilde y con subcategoría: mismo cupo',
           conv('f11', 'liga', 'f11_nacional') === 20 &&
           conv('f11', 'liga', 'Nacional A') === 20 &&
           conv('f11', 'copa', 'f11_regional') === 20);

        //  ⚠️ «No sé» no puede significar «pueden ir veinte» (regla de v617).
        ok('2i · ⚠️ SIN categoría se devuelve el tope ESTRICTO, no el amplio',
           conv('f11', 'liga', '') === 18 &&
           conv('f11', 'liga', null) === 18 &&
           cupo('f11', 'liga').maxConvocados === 18,
           'el estricto sólo molesta; el amplio deja pasar un acta inválida');

        //  El amistoso no tiene acta: sigue sin tope, también en Nacional.
        ok('2j · el amistoso sigue SIN TOPE (no hay acta que lo acote)',
           cupo('f11', 'amistoso', 'nacional').maxConvocados === null &&
           cupo('f11', 'amistoso', 'regional').maxConvocados === null);

        //  🔑 LOS TITULARES NO LOS RELAJA NADIE: en el campo hay once.
        ok('2k · 🔑 los titulares se mantienen en 11 (y 7 en F7)',
           cupo('f11', 'liga', 'nacional').maxTitulares === 11 &&
           cupo('f11', 'amistoso', 'nacional').maxTitulares === 11 &&
           cupo('f7', 'liga', 'alevin').maxTitulares === 7);

        ok('2l · la respuesta dice si el cupo viene ampliado',
           cupo('f11', 'liga', 'nacional').ampliado === true &&
           cupo('f11', 'liga', 'juvenil').ampliado === false &&
           cupo('f7', 'liga', 'regional').ampliado === false);
    }
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n3) LOS CINCO SITIOS PIDEN EL CUPO A LA MISMA REGLA');
{
    //  La cabecera de `cronosCupoConvocatoria` avisaba desde v660 de que los
    //  números estaban escritos a mano en cinco sitios y de que el día que
    //  cambiaran habría que mirarlos todos. Este es ese día.
    ok('3a · 🔑 la pantalla de convocatoria la llama CON la categoría',
       /cronosCupoConvocatoria\(currentMode,\s*tipo,\s*_convCategoriaActual\(\)\)/.test(IMPORT));
    ok('3b · 🔑 y la puerta de IR AL PARTIDO también',
       /cronosCupoConvocatoria\(currentMode,\s*_tipo,\s*_cat\)/.test(IMPORT),
       'si no, se convoca a 20 y al arrancar salta «máximo 18»');
    ok('3c · las fichas que se crean sin convocatoria salen de la regla',
       /cronosCupoConvocatoria\(currentMode,\s*'liga',\s*_cat\)/.test(EVL),
       'un Regional que arranca sin convocatoria tiene que poder colocar a los veinte');
    ok('3d · y las plazas del mensaje de convocatoria, también',
       /cronosCupoConvocatoria\(mode,\s*'liga',\s*_cat\)/.test(WAPP));
    //  ⚠️ Lo que queda escrito a mano en esas cuatro líneas es el RESPALDO
    //  estricto por si utils.js no hubiera cargado, nunca el camino normal.
    ok('3e · ⚠️ sus respaldos siguen siendo el tope ESTRICTO',
       /let maxSlots = mode === 'f7' \? 14 : 18;/.test(WAPP) &&
       /let defaultTotalCount = currentMode === 'f7' \? 14 : 18;/.test(EVL),
       '«no sé» no puede significar «sin límite» (v617)');
    ok('3f · 🚨 y la categoría se resuelve con la cascada QUE YA EXISTE',
       /CronosSubRules[\s\S]{0,80}categoriaActual\(\)/.test(IMPORT) &&
       /CronosSubRules[\s\S]{0,80}categoriaActual\(\)/.test(EVL) &&
       /CronosSubRules[\s\S]{0,80}categoriaActual\(\)/.test(WAPP),
       'dos cascadas para el mismo dato ya produjeron un fallo en v562');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n4) LOS CAMBIOS DE NACIONAL: 5 EN 3 VENTANAS MÁS EL DESCANSO');
{
    const sb = { console: { log() {}, warn() {}, error() {} }, document: undefined };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SUBR, sb);
    const R = sb.CronosSubRules;

    const n = R.reglasDe('nacional', 'f11');
    ok('4a · 🔑 Nacional NO tiene cambios libres', n.ilimitado === false, JSON.stringify(n));
    ok('4b · 5 cambios y 3 ventanas, como Regional',
       n.maxCambios === 5 && n.maxVentanas === 3, JSON.stringify(n));
    ok('4c · sin reingreso', n.reingreso === false);
    ok('4d · 🔑 y es EL MISMO régimen que Regional y Juvenil (no una tabla nueva)',
       n.grupo === R.reglasDe('regional', 'f11').grupo &&
       n.grupo === R.reglasDe('juvenil', 'f11').grupo, n.grupo);
    ok('4e · con las mil formas del dato: «f11_nacional», «Nacional A»',
       R.reglasDe('f11_nacional', 'f11').maxCambios === 5 &&
       R.reglasDe('Nacional A', 'f11').maxCambios === 5);
    //  ⚠️ Y el descanso sigue dando ventana extra: son 3 «en juego» + la del
    //  descanso, que es literalmente lo que pide el encargo.
    ok('4f · ⚠️ el descanso NO consume una de las tres',
       /ventanaDescansoUsada/.test(SUBR) && /enDescanso/.test(SUBR));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n5) 📌 EL AVISO ORIENTATIVO, ANTES DE CONVOCAR');
{
    ok('5a · existe el hueco del aviso en la pantalla de convocatoria',
       /id="conv-aviso-cupo"/.test(IMPORT));
    //  🔑 ARRIBA DEL TODO: cuando el entrenador llega a los contadores ya ha
    //  empezado a elegir, y esto es lo que tiene que saber ANTES.
    ok('5b · 🔑 va ANTES de los datos del partido y de los contadores',
       IMPORT.indexOf('id="conv-aviso-cupo"') < IMPORT.indexOf('DATOS DEL PARTIDO') &&
       IMPORT.indexOf('id="conv-aviso-cupo"') < IMPORT.indexOf('id="conv-counter-conv"'),
       'el aviso tiene que llegar antes que la primera decisión');
    const AVISO = extraeFn(IMPORT, '_convPintarAviso') || '';
    ok('5c · lo rellena una función propia', AVISO.length > 200);
    ok('5d · 🔑 dice los CONVOCADOS y los TITULARES, que es lo que él pidió',
       /maxConvokedTxt/.test(AVISO) && /maxTitulares/.test(AVISO) &&
       /convocar/.test(AVISO) && /titulares/.test(AVISO));
    ok('5e · nombra la CATEGORÍA, desde el catálogo',
       /ctCategoriaLabel/.test(AVISO));
    ok('5f · 🔑 y los cambios los pregunta a la MISMA tabla que avisa en el campo',
       /CronosSubRules[\s\S]{0,60}reglasDe/.test(AVISO),
       'un cartel que diga una cosa y el partido otra es peor que no ponerlo');
    //  ⚠️ SE MIDE SOBRE EL TEXTO QUE VE EL ENTRENADOR, no sobre el fuente
    //  entero: fuera comentarios, fuera medidas de CSS y fuera los rótulos
    //  «Fútbol 7 / Fútbol 11», que llevan un número que no es un cupo.
    const _visible = AVISO.replace(/\/\/.*$/gm, '')
                          .replace(/F[úu]tbol\s*(7|11)/g, 'Fútbol')
                          .replace(/0?\.\d+rem|rgba\([^)]*\)|#[0-9a-f]{3,6}/g, '');
    ok('5g · 🚨 no escribe ningún número suyo (ni 18, ni 20, ni 11)',
       !/\b(18|20|11|14|7)\b/.test(_visible),
       'los números salen del cupo y de las reglas de cambio, o volverían a divergir');
    ok('5h · y se repinta al cambiar el tipo de partido',
       /_convPintarAviso\(\);/.test(IMPORT) &&
       IMPORT.indexOf('_convPintarAviso();') > IMPORT.indexOf('function _convRecalcularCupos'));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n6) NACIONAL EN EL RESTO DE LA APP');
{
    const _u = sinCom(UTILS), _s = sinCom(SETUP), _c = sinCom(CPANEL), _l = sinCom(LIVE);

    //  🚨 'nacional' NO contiene 'regional': toda cascada que clasifique por
    //  subcadena necesita su propia mención o Nacional cae en el genérico.
    ok('6a · 🚨 es F11 en las DOS copias del clasificador de utils.js',
       (_u.match(/regional\|nacional\|senior/g) || []).length === 2,
       'utils.js tiene el bloque duplicado: hay que cambiar los dos');
    ok('6b · y en el clasificador de los informes',
       /'futurefem', 'nacional'\]\.includes\(c\)\) return 'f11'/.test(_c));
    ok('6c · al entrenador de Nacional se le ofrece F11',
       /hasF11 = true/.test(_s) &&
       /nacional/.test((_s.match(/^.*hasF11 = true;.*$/m) || [''])[0]));
    //  ⚠️ SIN VENTANA DE N CARACTERES. La condición del grupo ocupa lo que
    //  ocupe —y crece cada vez que entra un alias—, así que se mide hasta la
    //  LLAVE del bloque: `[^{]*` no puede saltar a otro `if`. Medir distancias
    //  es lo que puso rojo el guard 4f de v743 con el código intacto.
    ok('6d · 🔑 comparte el grupo de semáforo de Regional (no estrena bloque)',
       /includes\('nacional'\)[^{]*\{\s*return 'regional';/.test(_u),
       'un grupo propio nacería SIN configuración del Director: la lección de v586');
    ok('6e · y live.html dice lo mismo (no comparte código con index.html)',
       /includes\('nacional'\)[\s\S]{0,80}return 'regional'/.test(_l));

    ok('6f · el desplegable del alta la ofrece', /value="nacional"/.test(INDEX));
    //  ⏱️ v748 · El desplegable ya no lleva los minutos escritos a mano: se
    //  generan desde `cronosTiemposCategoria`. Aquí se comprueba que Nacional
    //  está en la lista; que le tocan 45' lo mide test_tiempos_por_categoria.
    ok('6g · y el desplegable del partido la ofrece en las dos modalidades',
       /\['nacional',\s*'Nacional'\]/.test(FORM) &&
       /mode \+ '_' \+ clave/.test(FORM),
       'la etiqueta se genera; el value sigue siendo f7_/f11_ + clave');
    ok('6h · 🔑 el informe le da 90 minutos, no los 60 del genérico',
       /includes\('nacional'\)[\s\S]{0,40}return 90/.test(sinCom(ENGINE)) &&
       /indexOf\('nacional'\)[\s\S]{0,60}return 90/.test(sinCom(MANUAL)),
       'sin esto, el reparto de minutos de cada jugador se haría sobre un partido que no existe');
    ok('6i · el visor en vivo la rotula', /nacional:\s*'NACIONAL'/.test(LIVE));
    ok('6j · el cuadrante del club la ordena', /'prebenjamin','nacional'/.test(sinCom(CQ)));
    ok('6k · y los dorsales tienen prefijo propio',
       /includes\('nacional'\)\) prefix = 'NC'/.test(leer('js/core/staff-and-comms.js')));
}

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);

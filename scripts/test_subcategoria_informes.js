// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v711 · LA SUBCATEGORÍA DEL PARTIDO EN LOS INFORMES
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-14): las pérdidas y
//  recuperaciones «no llegan» al «Resumen acumulado de la temporada de este
//  equipo».
//
//  🔑🔑 SE MIDIÓ CONTRA PRODUCCIÓN ANTES DE TOCAR NADA
//  (`scripts/ops/inspect_pr_informes.js`), y la medición tumbó el diagnóstico
//  de v710, que era incompleto:
//
//     fecha        category        subcategory   teamId sellado        P/R
//     2026-09-12   regional        B             …__regional__b        (sin usar)
//     2026-09-13   f11_regional    (VACÍA)       …__f11-regional__     SÍ
//     2026-09-14   f11_regional    (VACÍA)       …__regional__         SÍ
//
//  El dato de P/R **estaba escrito en los informes** (P=16 R=23 con su
//  desglose por dorsal). Lo que fallaba: esos partidos se sellaron con la
//  clave de equipo INCOMPLETA —sin la letra— y el resumen del entrenador
//  filtra por la suya (`…__regional__b`), así que los tiraba… y con ellos TODO
//  lo de esos partidos: sus P/R, sus goles y sus minutos.
//
//  LO QUE VIGILA ESTE FICHERO:
//
//   A · QUE LA SUBCATEGORÍA SE RESUELVA. El resolutor comparaba la categoría
//       del PARTIDO ('f11_regional', la del desplegable) con la del PERFIL
//       ('regional') con un `===` a pelo: no casaban nunca y devolvía ''. Es
//       la misma familia de v707/v710 — la modalidad no es identidad.
//
//   B · QUE LA PAREJA CATEGORÍA+LETRA MANDE SOBRE EL PERFIL (v562): con la
//       categoría de un equipo y la letra de otro sale el híbrido «Regional C»
//       de un Regional A.
//
//   C · QUE NO SE ADIVINE CON DOS EQUIPOS. Un entrenador con Regional A y
//       Regional B no puede recibir una letra inventada (v675).
//
//   D · QUE LOS PARTIDOS YA ESCRITOS VUELVAN AL RESUMEN. Arreglar el escritor
//       sólo sirve para los nuevos; los cinco que ya están en producción
//       llevan la clave a medias para siempre. La regla que los rescata es la
//       de v507, que ya rige el listado: lo que él firmó no se le oculta.
//
//   E · Y QUE NO SE CUELE EL PARTIDO DE OTRO EQUIPO SUYO por la puerta que
//       abre D.
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
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 260));
        fallos++;
    }
}

const PANEL = leer('js/coach/comms/panel.js');
const IND   = leer('js/coach/comms/individual-reports.js');
const APP   = leer('js/core/app-init.js');
const UTILS = leer('js/core/utils.js');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [DEFECTO A] la subcategoría del partido, EJECUTADA ──');
// ═══════════════════════════════════════════════════════════════════════════
let sub = null;
{
    const ini = PANEL.indexOf('function _cMatchSubcatFor(me, cat)');
    const fin = PANEL.indexOf('async function _cGetStaff', ini);
    ok('1a · se encuentra el resolutor de subcategoría', ini > 0 && fin > ini);

    const ctx = { console, String, Array, window: {} };
    ctx.window.window = ctx.window;
    // La poda de modalidad REAL de utils.js (v710), que es la que usa.
    const iniU = UTILS.indexOf('function cronosSinModalidad(category)');
    const finU = UTILS.indexOf('function cronosTeamId(clubId, category, subcategory)');
    vm.createContext(ctx);
    vm.runInContext(UTILS.slice(iniU, finU) +
        '\n;window.cronosSinModalidad = cronosSinModalidad;', ctx);
    vm.runInContext(PANEL.slice(ini, fin) + '\n;globalThis.sub = _cMatchSubcatFor;', ctx);
    sub = ctx.sub;

    // ⚠️ EL FIXTURE LLEVA DOS PLAZAS A PROPÓSITO. Con una sola, el respaldo
    //    de «plaza única» (paso 3) devuelve la letra aunque la comparación de
    //    categorías siga rota: la aserción daría VERDE sin probar nada. Con
    //    dos, la letra sólo puede salir de emparejar bien la categoría.
    const yo = { subcategory: 'B', allRoles: [
        { role: 'user', category: 'regional', subcategory: 'B', clubId: 'c1' },
        { role: 'user', category: 'alevin',   subcategory: 'C', clubId: 'c1' } ] };

    ctx.window._currentMatchSubcategory = '';
    ok('1b · 🔑🔑 [EL DEFECTO] con la categoría del desplegable, SALE la letra',
       sub(yo, 'f11_regional') === 'B',
       'devolvió "' + sub(yo, 'f11_regional') + '" — con "" el informe se sella ' +
       'como club__regional__ y se cae del resumen');

    ok('1c · y con la del perfil sigue saliendo, como siempre',
       sub(yo, 'regional') === 'B');

    ok('1d · …con las tres formas del prefijo',
       sub(yo, 'f7_regional') === 'B' && sub(yo, 'f11-regional') === 'B' &&
       sub(yo, 'F11 Regional') === 'B');

    // ── [DEFECTO B] la pareja del PARTIDO manda ──
    ctx.window._currentMatchSubcategory = 'A';
    ok('1e · 🔑 [v562] la letra DEL PARTIDO manda sobre la del perfil',
       sub(yo, 'f11_regional') === 'A',
       'la pareja categoría+letra se toma de UNA sola fuente: ' + sub(yo, 'f11_regional'));
    ctx.window._currentMatchSubcategory = '';

    // ── [DEFECTO C] con dos equipos NO se adivina ──
    const dosEquipos = { subcategory: 'A', allRoles: [
        { role: 'user', category: 'regional', subcategory: 'A', clubId: 'c1' },
        { role: 'user', category: 'alevin',   subcategory: 'C', clubId: 'c1' } ] };
    ok('1f · con DOS equipos, cada categoría recibe SU letra',
       sub(dosEquipos, 'f11_regional') === 'A' && sub(dosEquipos, 'f7_alevin') === 'C');
    ok('1g · ⚠️ [v675] y una categoría que no es de ninguno NO se inventa',
       sub(dosEquipos, 'f11_cadete') === '',
       'devolvió "' + sub(dosEquipos, 'f11_cadete') + '": adivinar sellaría el informe ' +
       'en el equipo equivocado');

    // ── Plaza única: mejor su letra que dejar el informe huérfano ──
    const unaPlaza = { allRoles: [
        { role: 'user', category: 'regional', subcategory: 'B', clubId: 'c1' } ] };
    ok('1h · con UNA sola plaza con letra, se usa aunque la categoría no case',
       sub(unaPlaza, 'lo_que_sea') === 'B',
       'sin ambigüedad posible, es mejor que dejarlo sin equipo');

    ok('1i · sin plazas ni perfil, sigue devolviendo vacío',
       sub({ allRoles: [] }, 'f11_regional') === '' && sub(null, 'x') === '');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [DEFECTO D] los partidos ya escritos vuelven al resumen ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // Se corta ANTES del `_miDelEquipo`, que necesita el resto de la pantalla
    // (la bandera de si puede filtrar por equipo y la lista de partidos): lo
    // que se mide aquí es la REGLA, que es lo que decide quién entra.
    const ini = IND.indexOf('const _miCatDe = (clave)');
    const fin = IND.indexOf('// El acumulado es DE SU EQUIPO', ini);
    ok('2a · se encuentra la regla de «este partido es de mi equipo»',
       ini > 0 && fin > ini && /_esDeMiEquipo/.test(IND.slice(ini, fin)));

    ok('2a2 · …y es la que usa el filtro del resumen',
       /sorted\.filter\(_esDeMiEquipo\)/.test(IND));

    const MIO = 'club-mqvr9m11-g9kj__regional__b';
    const correr = (clave, coachUid) => {
        const ctx = {
            console, String, Array, Object,
            me: { uid: 'yo', clubId: 'club_mqvr9m11_g9kj' },
            equipoAsignado: MIO,
            // `_miEquipoDe` devuelve la clave del primer documento del partido.
            _miEquipoDe: () => clave,
            window: {},
        };
        vm.createContext(ctx);
        vm.runInContext(IND.slice(ini, fin) + '\n;globalThis.esMio = _esDeMiEquipo;', ctx);
        return ctx.esMio({ players: [{ coachUid: coachUid }] });
    };

    ok('2b · CONTROL · su equipo, con la clave completa, entra',
       correr(MIO, 'yo') === true);

    ok('2c · 🔑🔑 [DEFECTO D] su partido con la clave A MEDIAS también entra',
       correr('club-mqvr9m11-g9kj__regional__', 'yo') === true,
       'son los cinco partidos con P/R que ya están escritos en producción');

    ok('2d · …y uno suyo SIN clave resoluble (v507: lo que él firmó)',
       correr('', 'yo') === true);

    ok('2e · 🔑 [DEFECTO E] pero NO su OTRO equipo, que sí está clasificado',
       correr('club-mqvr9m11-g9kj__alevin__c', 'yo') === false,
       'la puerta se abre sólo para la clave incompleta de MI categoría');

    ok('2f · ni un partido a medias de OTRA categoría',
       correr('club-mqvr9m11-g9kj__alevin__', 'yo') === false);

    ok('2g · ni el partido de OTRO entrenador, aunque venga a medias',
       correr('club-mqvr9m11-g9kj__regional__', 'otro') === false,
       'la excepción es «lo que él firmó», no «todo lo que no se sabe clasificar»');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · la pareja viaja en la ranura del partido ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // El autoguardado escribía la categoría sola: al retomar un partido, la
    // letra se perdía y los informes volvían a salir sin ella.
    ok('3a · 🔑 la ranura guarda la subcategoría junto a la categoría',
       /subcategory:  document\.getElementById\('match-subcategory'\)\?\.value \|\|/.test(APP),
       'es la lección de v562 aplicada al guardado');

    ok('3b · y al retomar se restaura en la global y en el desplegable',
       /if \(state\.subcategory\) \{[\s\S]{0,220}?_currentMatchSubcategory = state\.subcategory/.test(APP) &&
       /subSelect\.value = state\.subcategory/.test(APP));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · el efecto: la clave de equipo sale COMPLETA ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const ctxU = { window: {}, console, Map, Set, String, Number, Array, Object, Math, JSON,
                   document: { createElement: () => ({ style: {} }) },
                   localStorage: { getItem: () => null, setItem() {} } };
    ctxU.window.window = ctxU.window;
    vm.createContext(ctxU);
    try { vm.runInContext(UTILS, ctxU); } catch (e) {}
    const U = ctxU.window;
    const CLUB = 'club_mqvr9m11_g9kj';
    const yo = { subcategory: 'B', allRoles: [
        { role: 'user', category: 'regional', subcategory: 'B', clubId: CLUB } ] };

    if (sub) {
        const sellada = U.cronosTeamId(CLUB, 'f11_regional', sub(yo, 'f11_regional'));
        const mia     = U.cronosTeamId(CLUB, 'regional', 'B');
        ok('4a · 🔑🔑 el informe de un partido «f11_regional» se sella con la clave del entrenador',
           sellada === mia && /__regional__b$/.test(sellada),
           'sellada=' + sellada + ' · mía=' + mia);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos ? 1 : 0);

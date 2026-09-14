// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v710 · LAS P/R EN EL ACUMULADO DEL ENTRENADOR Y EN EL INFORME
//                 INDIVIDUAL DEL JUGADOR
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-14, capturas 10378-10385):
//
//   1 · «las columnas de pérdidas y recuperaciones no muestran ni suman los
//       totales acumulados del equipo EN EL PANEL DEL ENTRENADOR, a diferencia
//       del comportamiento correcto que ya tienen en los visores del director
//       deportivo y coordinador»;
//   2 · «en la vista del informe individual de cada jugador no aparecen
//       reflejadas EN ABSOLUTO las pérdidas ni las recuperaciones»;
//   3 · «deben sumarse y acumularse en el resumen global de la temporada».
//
//  🔑🔑 EL 1 NO ERA LA SUMA, ERA LA IDENTIDAD DEL EQUIPO — y esto se MIDIÓ
//  antes de tocar nada, ejecutando `ctAccumulatePlayerStats` con documentos
//  como los suyos: la suma FUNCIONABA. Lo que fallaba es que esos partidos no
//  entraban en el resumen. La misma categoría llega escrita de dos formas:
//      del PERFIL del entrenador →  'regional'      → club__regional__b
//      del DESPLEGABLE del panel →  'f11_regional'  → club__f11-regional__b
//  Los informes sellan su `teamId` con la del panel y el filtro «mi equipo»
//  compara con la del perfil: no casaban, y los partidos recientes —los
//  únicos con P/R— quedaban fuera del acumulado (seguían en el listado porque
//  ahí rige la excepción de v507). El Director no lo sufría porque su árbol
//  normaliza con `ctNormCat`, que quita el prefijo desde el principio: esa
//  asimetría era el diagnóstico.
//
//  LO QUE VIGILA ESTE FICHERO:
//
//   A · LA CLAVE DE EQUIPO ES INMUNE A LA MODALIDAD, por los dos caminos: al
//       calcularla (`cronosTeamId`) y al leer una ya guardada
//       (`cronosTeamIdOfDoc` → `cronosTeamIdNorm`). Sin el segundo, el
//       histórico ya escrito seguiría fuera y el arreglo sólo valdría para los
//       partidos futuros.
//
//   B · Y NO SE MUEVE NADA DE SITIO. Las claves que se usan para GUARDAR
//       (plantillas `team_rosters/{teamId}`, cuadrante, ranuras de partido)
//       salen de la categoría del PERFIL: tienen que dar exactamente la misma
//       cadena que antes, o las plantillas publicadas se quedarían huérfanas.
//
//   C · CON LA IDENTIDAD ARREGLADA, LA SUMA SALE. Se ejecuta el acumulador
//       real con documentos de informe reales (con `matchPR` y su desglose
//       `porDorsal`).
//
//   D · EL INFORME INDIVIDUAL DEL JUGADOR ENSEÑA SUS P/R, y distingue «no hay
//       dato» de «hay dato y es cero»: el histórico anterior al registro no
//       lleva los campos y pintarle ceros sería inventar.
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

const UTILS = leer('js/core/utils.js');
const CT    = leer('js/admin/shared/category-tree.js');
const IND   = leer('js/coach/comms/individual-reports.js');
const PP    = leer('js/parent/panel.js');

// ── Las funciones de identidad de equipo, EJECUTADAS ──────────────────────
const ctxU = { window: {}, console, Map, Set, String, Number, Array, Object, Math, JSON,
               document: { createElement: () => ({ style: {} }) },
               localStorage: { getItem: () => null, setItem() {} } };
ctxU.window.window = ctxU.window;
vm.createContext(ctxU);
try { vm.runInContext(UTILS, ctxU); } catch (e) { /* utils toca DOM al final */ }
const U = ctxU.window;

const CLUB = 'club_mqvr9m11_g9kj';

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [DEFECTO A] la clave de equipo, inmune a la modalidad ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    ok('1a · utils expone las piezas nuevas',
       typeof U.cronosSinModalidad === 'function' &&
       typeof U.cronosTeamIdNorm === 'function' &&
       typeof U.cronosTeamId === 'function' &&
       typeof U.cronosTeamIdOfDoc === 'function');

    const perfil = U.cronosTeamId(CLUB, 'regional', 'B');
    const panel  = U.cronosTeamId(CLUB, 'f11_regional', 'B');
    ok('1b · 🔑🔑 la categoría del PANEL y la del PERFIL dan la MISMA clave',
       perfil === panel && !!perfil,
       'perfil=' + perfil + ' panel=' + panel);

    ok('1c · …con las tres formas del prefijo (f7_, f11-, «f11 »)',
       U.cronosTeamId(CLUB, 'f7_alevin', 'A') === U.cronosTeamId(CLUB, 'alevin', 'A') &&
       U.cronosTeamId(CLUB, 'f11-cadete', 'B') === U.cronosTeamId(CLUB, 'cadete', 'B') &&
       U.cronosTeamId(CLUB, 'f11 juvenil', '') === U.cronosTeamId(CLUB, 'juvenil', ''));

    // ⚠️ La trampa de v511: 'regional_fem' CONTIENE 'regional'. Quitar el
    // prefijo no puede convertir una categoría femenina en la masculina.
    ok('1d · ⚠️ Regional FEM sigue siendo OTRO equipo que Regional',
       U.cronosTeamId(CLUB, 'f11_regional_fem', 'A') !== U.cronosTeamId(CLUB, 'f11_regional', 'A') &&
       U.cronosTeamId(CLUB, 'f11_regional_fem', 'A') === U.cronosTeamId(CLUB, 'regional_fem', 'A'));

    // ── [DEFECTO B] lo que ya está guardado no puede cambiar de sitio ──
    ok('1e · 🔑 [DEFECTO B] la clave del PERFIL no cambia ni un carácter',
       U.cronosTeamId(CLUB, 'regional', 'B') === U.cronosTeamSlug(CLUB) + '__regional__b',
       'las plantillas publicadas viven en team_rosters/{teamId}: ' + perfil);
    ok('1f · una categoría que se llame «F7» a secas se respeta',
       U.cronosTeamId(CLUB, 'F7', '') === U.cronosTeamSlug(CLUB) + '__f7__',
       'la poda exige separador detrás: ' + U.cronosTeamId(CLUB, 'F7', ''));
    ok('1g · sin categoría no hay equipo (comportamiento de siempre)',
       U.cronosTeamId(CLUB, '', 'B') === '' && U.cronosTeamId('', 'regional', 'B') === '');

    // ── [DEFECTO A, 2ª mitad] el teamId YA GUARDADO se normaliza al leerlo ──
    const docViejo = { teamId: U.cronosTeamSlug(CLUB) + '__f11-regional__b', clubId: CLUB };
    ok('1h · 🔑🔑 un informe con el teamId sellado con la modalidad SÍ casa',
       U.cronosTeamIdOfDoc(docViejo, CLUB) === perfil,
       'leído: ' + U.cronosTeamIdOfDoc(docViejo, CLUB) + ' · esperado: ' + perfil);

    const docSinTeamId = { clubId: CLUB, category: 'f11_regional', subcategory: 'B' };
    ok('1i · …y uno SIN teamId, que se recalcula de su category, también',
       U.cronosTeamIdOfDoc(docSinTeamId, CLUB) === perfil);

    ok('1j · 🔑 y el filtro por equipo acepta a los dos',
       U.cronosDocEsDeEquipo(docViejo, [perfil], CLUB) === true &&
       U.cronosDocEsDeEquipo(docSinTeamId, [perfil], CLUB) === true,
       'es el filtro que dejaba fuera del acumulado los partidos recientes');

    ok('1k · pero NO al de otro equipo',
       U.cronosDocEsDeEquipo({ teamId: U.cronosTeamSlug(CLUB) + '__f11-alevin__a' }, [perfil], CLUB) === false);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [DEFECTO C] con la identidad arreglada, la suma sale ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const ctxC = { window: {}, console, Map, Set, String, Number, Array, Object, Math, JSON,
                   document: { createElement: () => ({ style: {} }) } };
    ctxC.window.window = ctxC.window;
    vm.createContext(ctxC);
    try { vm.runInContext(CT, ctxC); } catch (e) { /* el módulo pinta al final */ }
    const acum = ctxC.window.ctAccumulatePlayerStats;
    ok('2a · el acumulador compartido está disponible', typeof acum === 'function');

    const matchPR = {
        perdidas:       { total: 3, sinAsignar: 0, porDorsal: { '7': 1, '9': 1, '17': 1 } },
        recuperaciones: { total: 6, sinAsignar: 1, porDorsal: { '3': 1, '4': 1, '7': 1, '9': 1, '14': 1 } },
        items: []
    };
    const doc = (num, alias) => ({
        playerNumber: String(num), playerAlias: alias, minutesPlayed: '05:44',
        goals: 0, cards: null, injured: false, history: [], matchPR: matchPR,
        teamId: U.cronosTeamSlug(CLUB) + '__f11-regional__b', clubId: CLUB,
        category: 'f11_regional', subcategory: 'B', createdAt: '2026-09-13T20:00:00Z',
    });
    // Agrupado como lo agrupa «Mis Informes» (individual-reports.js): los
    // documentos CRUDOS dentro de `players`.
    const partido = {
        matchId: 'm1', matchDate: '2026-09-13', rival: 'Rival', myTeamRole: 'away',
        players: [doc(3, 'SANCHO'), doc(4, 'LALO'), doc(7, 'CARLOS'),
                  doc(9, 'JOSE'), doc(14, 'BINGO'), doc(17, 'PEDRO')]
    };

    if (typeof acum === 'function') {
        const filas = acum([partido]);
        const de = (n) => filas.filter(f => f.number === String(n))[0] || {};
        ok('2b · 🔑 cada jugador recibe SUS recuperaciones y SUS pérdidas',
           de(3).prRecuperaciones === 1 && de(3).prPerdidas === 0 &&
           de(7).prRecuperaciones === 1 && de(7).prPerdidas === 1 &&
           de(17).prRecuperaciones === 0 && de(17).prPerdidas === 1,
           JSON.stringify(filas.map(f => f.number + ':' + f.prRecuperaciones + '/' + f.prPerdidas)));

        const totR = filas.reduce((s, f) => s + (f.prRecuperaciones || 0), 0);
        const totP = filas.reduce((s, f) => s + (f.prPerdidas || 0), 0);
        ok('2c · y los totales del equipo cuadran con el desglose por dorsal',
           totR === 5 && totP === 3,
           'R=' + totR + ' P=' + totP + ' (la recuperación sin asignar no se atribuye a nadie)');

        // ⚠️ Dos documentos del MISMO dorsal en el mismo partido no pueden
        // doblar sus pérdidas (el registro `prYaSumado`).
        const conDuplicado = { matchId: 'm2', players: [doc(7, 'CARLOS'), doc(7, 'CARLOS')] };
        const f2 = acum([conDuplicado]).filter(f => f.number === '7')[0] || {};
        ok('2d · ⚠️ un dorsal repetido en el mismo partido no dobla su cuenta',
           f2.prPerdidas === 1 && f2.prRecuperaciones === 1,
           JSON.stringify(f2));
    }

    // Y el agrupador del entrenador sube el desglose al nivel del partido.
    ok('2e · «Mis Informes» propaga matchPR al partido agrupado',
       /if \(r\.matchPR\) \{/.test(IND) && /matches\[key\]\.matchPR = r\.matchPR/.test(IND),
       'el acumulador ya lo busca dentro de players, pero así está donde se espera');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · [DEFECTO D] el informe individual del jugador ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const ini = PP.indexOf('const _prDeInforme = (r) => {');
    const fin = PP.indexOf('const totalPerdidas', ini);
    ok('3a · se encuentra el lector de P/R del panel de familias', ini > 0 && fin > ini);

    const ctxP = { console, Number, String, Object };
    vm.createContext(ctxP);
    vm.runInContext(PP.slice(ini, fin) + '\n;globalThis.pr = _prDeInforme;', ctxP);
    const pr = ctxP.pr;

    ok('3b · con `prPropio` (el informe de la familia) lee lo SUYO',
       (() => { const x = pr({ prPropio: { perdidas: 2, recuperaciones: 5 } });
                return x.p === 2 && x.r === 5 && x.hay === true; })());

    ok('3c · con el desglose del equipo, busca SU dorsal (no el total)',
       (() => { const x = pr({ playerNumber: '7', matchPR: {
                    perdidas:       { total: 9, porDorsal: { '7': 1, '9': 8 } },
                    recuperaciones: { total: 4, porDorsal: { '7': 3 } } } });
                return x.p === 1 && x.r === 3 && x.hay === true; })());

    ok('3d · 🔑 [DEFECTO D] «hay dato y es cero» ≠ «no hay dato»',
       (() => { const cero = pr({ prPropio: { perdidas: 0, recuperaciones: 0 } });
                const nada = pr({ goals: 1 });
                return cero.hay === true && nada.hay === false &&
                       cero.p === 0 && nada.p === 0; })(),
       'el histórico anterior al registro no lleva los campos: pintarle ceros sería inventar');

    // Y el bloque se pinta en la tarjeta de cada partido, condicionado al extra.
    ok('3e · 🔑🔑 el desglose de cada partido pinta sus P/R',
       /_prVisible && _prDeInforme\(r\)\.hay/.test(PP) &&
       /Pérdidas y recuperaciones/.test(PP),
       'era lo que «no aparecía EN ABSOLUTO» en el informe individual');

    ok('3f · con la MISMA función que las tarjetas del acumulado (requisito 3)',
       /totalPerdidas = reports\.reduce\(\(s, r\) => s \+ _prDeInforme\(r\)\.p, 0\)/.test(PP) &&
       /totalRecup    = reports\.reduce\(\(s, r\) => s \+ _prDeInforme\(r\)\.r, 0\)/.test(PP),
       'dos lecturas distintas del mismo dato acabarían diciendo cosas distintas');

    ok('3g · y todo ello estrictamente condicional al extra `registro_pr`',
       /_cronosExtraEnabled\('registro_pr'\)/.test(PP));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · CONTROL · el Director sigue agrupando igual ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const ctxN = { window: {}, console, Map, Set, String, Number, Array, Object, Math, JSON,
                   document: { createElement: () => ({ style: {} }) } };
    ctxN.window.window = ctxN.window;
    vm.createContext(ctxN);
    try { vm.runInContext(CT, ctxN); } catch (e) {}
    const norm = ctxN.window.ctNormCat;
    ok('4a · ctNormCat sigue quitando el prefijo (era quien SÍ acertaba)',
       typeof norm === 'function' && norm('f11_regional') === 'regional' &&
       norm('F7_Alevin_A') === 'alevin');
    ok('4b · 🔑 y ahora la clave canónica dice lo mismo que el árbol',
       U.cronosTeamId(CLUB, 'f11_regional', 'B') === U.cronosTeamId(CLUB, norm('f11_regional'), 'B'),
       'mientras discreparan, cada pantalla agrupaba el mismo partido en un equipo distinto');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos ? 1 : 0);

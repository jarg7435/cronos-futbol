// ─────────────────────────────────────────────────────────────────────────
// test_subcategoria_del_equipo.js · categoría y subcategoría describen SIEMPRE
// el mismo equipo (v562)
//
// Reporte del autor (capturas 9077, 9078 y 9083): el entrenador tiene asignado
// **Regional A** y el panel en vivo lo rotulaba **"Regional C"**.
//
// 🔑🔑🔑 MEDIDO EN LOS 10 PARTIDOS DEL RESPALDO DE PRODUCCIÓN: en los DIEZ, la
// `matchSubcategory` era IDÉNTICA a la `subcategory` del PERFIL del entrenador.
// La `matchCategory`, en cambio, sí seguía al panel en tres de ellos:
//
//    category=alevin sub=C   matchCategory=regional      matchSub=C → "REGIONAL C"
//    category=alevin sub=C   matchCategory=f11_infantil  matchSub=C → "INFANTIL C"
//    category=alevin sub=C   matchCategory=f7_alevin     matchSub=C → "ALEVÍN C"
//
// O sea: **la categoría del partido llegaba al documento y la subcategoría no**.
// Cada mitad se resolvía por una cascada distinta —la categoría desde el
// desplegable, la subcategoría clavada al perfil— y en cuanto las dos dejaban
// de describir el mismo equipo salía el híbrido. El visor NO se equivocaba:
// pintaba fielmente un dato que ya nacía cruzado.
//
// LO QUE FIJA ESTE GUARD:
//   A · el resolutor devuelve la pareja de UNA sola rama, nunca media de cada;
//   B · el emisor elige la FUENTE primero y toma las dos de ella;
//   C · el respaldo al perfil es de la pareja entera, no de cada mitad;
//   D · reproducido el caso real: Regional A ya no puede salir como Regional C.
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

const UTILS = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');
const SETUP = fs.readFileSync(path.join(ROOT, 'js', 'core', 'setup-modal.js'), 'utf8');
const SYNC  = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');

function trozo(src, cabecera, cierre) {
    const i = src.indexOf(cabecera);
    if (i < 0) throw new Error('No se encontró ' + cabecera);
    const j = src.indexOf(cierre, i);
    if (j < 0) throw new Error('No se encontró el cierre de ' + cabecera);
    return src.slice(i, j + cierre.length);
}

console.log('── categoría y subcategoría, siempre del mismo equipo (v562) ──\n');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 1 · EL RESOLUTOR DEVUELVE LA PAREJA, NO MEDIA DE CADA
// ═══════════════════════════════════════════════════════════════════════
console.log('── PARTE 1 · el par sale de UNA sola rama ──');
{
    const FUENTE =
        trozo(UTILS, "if (typeof window._cronosCategoriaValor !== 'function') {", '\n}\n') + '\n' +
        trozo(UTILS, "if (typeof window.cronosParCategoriaDelPanel !== 'function') {", '\n}\n');

    function par(usuario, equipos, elegido, modo) {
        const sb = { console: { warn() {}, log() {} }, String, Object, Array };
        sb.window = sb;
        sb.window._cronosCurrentUser = usuario;
        sb.window.cronosEquipoElegido = () => elegido || '';
        sb.window.cronosEquiposDeEntrenador = () => equipos || [];
        vm.createContext(sb);
        vm.runInContext(FUENTE, sb);
        return sb.window.cronosParCategoriaDelPanel(modo || 'f11');
    }

    // 🔑 EL CASO EXACTO DEL REPORTE: la entrenadora lleva Alevín C (F7) y
    // Regional A (F11), y tiene ABIERTO el Regional A. La raíz de su documento
    // todavía dice alevin/C — que es de donde salía la "C".
    const EQUIPOS = [
        { teamId: 'club__alevin__c',   category: 'alevin',   subcategory: 'C' },
        { teamId: 'club__regional__a', category: 'regional', subcategory: 'A' },
    ];
    const ELLA = { category: 'alevin', subcategory: 'C', allRoles: [] };

    const conRegional = par(ELLA, EQUIPOS, 'club__regional__a', 'f11');
    ok('1a · 🔑🔑🔑 con el Regional A abierto, la pareja es regional + A (no + C)',
       conRegional && conRegional.category === 'regional' && conRegional.subcategory === 'A',
       JSON.stringify(conRegional));
    ok('1b · y el valor para el desplegable es el de su modalidad',
       conRegional.valorPanel === 'f11_regional', conRegional.valorPanel);

    const conAlevin = par(ELLA, EQUIPOS, 'club__alevin__c', 'f7');
    ok('1c · con el Alevín C abierto, la pareja es alevin + C',
       conAlevin.category === 'alevin' && conAlevin.subcategory === 'C',
       JSON.stringify(conAlevin));

    // Sin equipo elegido: manda el rol activo, y también entero.
    const porRolActivo = par(
        { category: 'alevin', subcategory: 'C',
          _activeRoleData: { role: 'user', category: 'juvenil', subcategory: 'B' }, allRoles: [] },
        [], '', 'f11');
    ok('1d · sin equipo elegido manda el ROL ACTIVO, con sus dos campos',
       porRolActivo.category === 'juvenil' && porRolActivo.subcategory === 'B',
       JSON.stringify(porRolActivo));

    // ⚠️ La raíz es el último respaldo, y también se toma ENTERA.
    const porRaiz = par({ category: 'cadete', subcategory: 'B', allRoles: [] }, [], '', 'f11');
    ok('1e · ⚠️ la raíz se toma entera: nunca su categoría con la letra de otra rama',
       porRaiz.category === 'cadete' && porRaiz.subcategory === 'B');

    // Un equipo sin subcategoría devuelve '' — NO la letra del perfil.
    const sinLetra = par(ELLA, [{ teamId: 'club__senior__', category: 'senior', subcategory: '' }],
                         'club__senior__', 'f11');
    ok('1f · 🔑 un equipo SIN subcategoría devuelve vacío, no hereda la "C" del perfil',
       sinLetra.category === 'senior' && sinLetra.subcategory === '',
       JSON.stringify(sinLetra));

    // Quien no tiene equipo (director, coordinador, SA) elige libremente.
    ok('1g · ⚠️ sin equipo asignado devuelve null: el panel sigue decidiendo',
       par({ allRoles: [] }, [], '', 'f11') === null);
}

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 2 · EL EMISOR NO PUEDE MEZCLAR FUENTES
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · el emisor toma las dos de la misma fuente ──');
{
    // Se extrae el bloque real que elige la fuente y se ejecuta.
    const i = SYNC.indexOf('        const _dom = (id) => {');
    const j = SYNC.indexOf('const _me = window._cronosCurrentUser;', i);
    const FUENTE = SYNC.slice(i, j);

    // v675 · El bloque real pasó a sellar la identidad POR `matchId` y a mirar
    // la ranura de ESE partido, así que el arnés tiene que ofrecerle las dos
    // cosas. Se le pasan como parámetros para poder ejercitar también el
    // escenario nuevo (global vacía + ranura con la categoría del partido).
    function resolver(dom, globales, opciones) {
        const o = opciones || {};
        const sb = { console: { warn() {} }, String, Object };
        sb.window = sb;
        sb.window._currentMatchCategory    = globales.cat;
        sb.window._currentMatchSubcategory = globales.sub;
        sb.document = { getElementById: (id) => (dom[id] !== undefined ? { value: dom[id] } : null) };
        sb.liveMatchId = o.matchId || 'partido-1';
        // Sello previo de otro latido del MISMO partido, si el caso lo pide.
        if (o.sello) sb.window._cronosIdPartido = { [sb.liveMatchId]: o.sello };
        // Ranura local: la fuente que sabe de QUÉ partido habla.
        sb.window._cronosMatchSlots = { leer: (id) => (o.ranuras && o.ranuras[id]) || null };
        vm.createContext(sb);
        vm.runInContext(FUENTE + '\n_res = { cat: _matchCat, sub: _matchSub };', sb);
        return vm.runInContext('_res', sb);
    }

    // 🔑 EL ESCENARIO DEL FALLO: la global trae el par bueno (Regional/A) y el
    // desplegable se quedó con la letra del equipo anterior.
    const r1 = resolver({ 'match-category': 'f11_regional', 'match-subcategory': 'C' },
                        { cat: 'f11_regional', sub: 'A' });
    ok('2a · 🔑🔑🔑 manda la PAREJA global; un desplegable desfasado ya no cuela su "C"',
       r1.cat === 'f11_regional' && r1.sub === 'A', JSON.stringify(r1));

    // Sin globales, se usa el DOM… pero las DOS del DOM.
    const r2 = resolver({ 'match-category': 'f7_alevin', 'match-subcategory': 'B' }, {});
    ok('2b · sin globales manda el DOM, y también entero',
       r2.cat === 'f7_alevin' && r2.sub === 'B', JSON.stringify(r2));

    // ⚠️ Categoría global y subcategoría SÓLO en el DOM: no se mezclan.
    const r3 = resolver({ 'match-subcategory': 'C' }, { cat: 'regional', sub: '' });
    ok('2c · ⚠️ con la categoría de la global, la letra NO se toma del DOM',
       r3.cat === 'regional' && r3.sub === '',
       'mezclar fuentes es exactamente lo que producía "Regional C"');

    const r4 = resolver({}, {});
    ok('2d · sin nada, las dos vacías (el respaldo al perfil va después)',
       r4.cat === '' && r4.sub === '');

    // ═══════════════════════════════════════════════════════════════════
    //  🔴 v675 · EL CASO REAL DE LAS CAPTURAS 9999 / 10003-10006
    // ═══════════════════════════════════════════════════════════════════
    //  Dos partidos a la vez, un entrenador con dos equipos. El panel ya se
    //  cerró (o la página se recargó), así que NO hay global ni desplegable:
    //  antes de v675 los dos caían al perfil (alevin/C) y quedaban con el
    //  mismo `matchCategory` y el mismo `teamId`.
    const RANURAS = {
        'arinaga-7-04092026':  { category: 'f7_alevin',   subcategory: 'C',
                                 teamId: 'club-x__alevin__c' },
        'arinaga-jv-04092026': { category: 'f11_juvenil', subcategory: 'C',
                                 teamId: 'club-x__juvenil__c' },
    };
    const rA = resolver({}, {}, { matchId: 'arinaga-7-04092026',  ranuras: RANURAS });
    const rB = resolver({}, {}, { matchId: 'arinaga-jv-04092026', ranuras: RANURAS });

    ok('2e · 🔴🔴 EL CASO DEL REPORTE: cada partido saca SU categoría de SU ranura',
       rA.cat === 'f7_alevin' && rB.cat === 'f11_juvenil',
       JSON.stringify({ arinaga7: rA, arinagaJV: rB }));

    ok('2f · 🔑 y no pueden volver a salir iguales (era el cruce medido)',
       rA.cat !== rB.cat,
       'los dos documentos reales tenían matchCategory "alevin" los dos');

    // ⚠️ Una global del OTRO partido no puede pisar al que ya está sellado.
    const rSellado = resolver({}, { cat: 'f7_alevin', sub: 'C' },
        { matchId: 'arinaga-jv-04092026',
          sello: { cat: 'f11_juvenil', sub: 'C' }, ranuras: RANURAS });
    ok('2g · ⚠️ sellado el partido, una global ajena ya NO lo reescribe',
       rSellado.cat === 'f11_juvenil' && rSellado.sub === 'C',
       JSON.stringify(rSellado));
}

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 3 · EL RESPALDO AL PERFIL ES DE LA PAREJA ENTERA
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · el respaldo al perfil, entero o nada ──');

// ═══════════════════════════════════════════════════════════════════════
//  🔄 v675 · SE REVOCA LA FORMA EXACTA DEL RESPALDO, NO SU REGLA
// ═══════════════════════════════════════════════════════════════════════
//  3a y 3b fijaban los literales `_matchCat || snapCat || null` y
//  `_matchCat ? (_matchSub || null) : (snapSub || null)`. La regla que
//  defendían —la pareja se toma ENTERA de una sola fuente— sigue viva y se
//  sigue exigiendo abajo. Lo que se revoca es que el respaldo al perfil sea
//  INCONDICIONAL.
//
//  🔴 POR QUÉ. Medido en producción (implementar.txt 2026-09-04, capturas
//  10003/10005): con DOS equipos, el perfil acierta en uno y falla en el otro
//  SIEMPRE. Los dos partidos simultáneos quedaron con `matchCategory: "alevin"`
//  y —lo grave— el MISMO `teamId`, que es la clave de la ranura local
//  (`cronos_tab_match::<teamId>` en match-slots.js): un partido le robaba la
//  ranura al otro y desaparecía del panel de recuperación.
//
//  🔑 Ahora el perfil sólo respalda cuando NO puede equivocarse: un entrenador
//  con UN único equipo. Con dos o más se deja en null y la tarjeta no pinta
//  etiqueta — regla D del guard de v463: si no se resuelve, no se inventa.
// ═══════════════════════════════════════════════════════════════════════
ok('3a · 🔑 con categoría de PARTIDO, la letra sale del partido aunque quede null',
   /matchSubcategory:\s*_matchCat \? \(_matchSub \|\| null\)\s*\n?\s*: \(_perfilUnico \? \(snapSub \|\| null\) : null\)/.test(SYNC),
   'con `_matchSub || snapSub` volvía a colarse la letra del perfil');

ok('3b · 🔴 el respaldo al perfil ya NO es incondicional: sólo con UN equipo',
   /matchCategory:\s+_matchCat \|\| \(_perfilUnico \? snapCat : null\) \|\| null,/.test(SYNC),
   'con dos equipos el perfil acierta en uno y falla en el otro SIEMPRE');

ok('3c · …y "un equipo" se mide con la lista real, no a ojo',
   /const _perfilUnico = /.test(SYNC) &&
   /cronosEquiposDeEntrenador\(_me\.allRoles, null\)/.test(SYNC) &&
   /_eq\.length === 1/.test(SYNC),
   '⚠️ la firma es (allRoles, clubId): pasarle el usuario devuelve [] en silencio');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 4 · EL CASO REAL, DE PUNTA A PUNTA
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · Regional A ya no puede salir como Regional C ──');
{
    // La etiqueta se compone como en live.html (_liveCategoriaEtiqueta).
    const ETQ = { prebenjamin:'PREBENJAMÍN', benjamin:'BENJAMÍN', alevin:'ALEVÍN',
                  infantil:'INFANTIL', cadete:'CADETE', juvenil:'JUVENIL',
                  regional:'REGIONAL', regional_fem:'REGIONAL FEM', futurefem:'FUTUREFEM' };
    const norm = s => String(s == null ? '' : s).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/^f\d+_/, '').replace(/[\s-]+/g, '_');
    function etiqueta(doc) {
        const n = norm(doc.matchCategory || doc.category || '');
        let nombre = '';
        for (const k of ['prebenjamin','benjamin','alevin','infantil','cadete',
                         'juvenil','futurefem','regional_fem','regional']) {
            if (n.includes(k)) { nombre = ETQ[k]; break; }
        }
        const bruta = (doc.matchSubcategory != null && String(doc.matchSubcategory).trim() !== '')
            ? doc.matchSubcategory : doc.subcategory;
        const s = String(bruta == null ? '' : bruta).trim().toUpperCase();
        const sub = /^[A-Z0-9]{1,2}$/.test(s) ? s : '';
        return sub ? (nombre + ' ' + sub) : nombre;
    }

    // ANTES (documento real del respaldo, local-16082026-213q-2018):
    const antes = { category: 'alevin', subcategory: 'C',
                    matchCategory: 'regional', matchSubcategory: 'C' };
    ok('4a · el documento REAL de la captura producía "REGIONAL C"',
       etiqueta(antes) === 'REGIONAL C', etiqueta(antes));

    // DESPUÉS: con la pareja resuelta a la vez, la letra es la del Regional.
    const despues = { category: 'alevin', subcategory: 'C',
                      matchCategory: 'regional', matchSubcategory: 'A' };
    ok('4b · 🔑🔑🔑 con el par bien resuelto sale "REGIONAL A"',
       etiqueta(despues) === 'REGIONAL A', etiqueta(despues));

    // Y el gemelo del mismo respaldo: Infantil A salía como INFANTIL C.
    ok('4c · el otro caso del respaldo (INFANTIL C ← Infantil A) también se cierra',
       etiqueta({ category:'alevin', subcategory:'C',
                  matchCategory:'f11_infantil', matchSubcategory:'C' }) === 'INFANTIL C' &&
       etiqueta({ category:'alevin', subcategory:'C',
                  matchCategory:'f11_infantil', matchSubcategory:'A' }) === 'INFANTIL A');
}

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 5 · EL CABLEADO
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · el cableado ──');

ok('5a · `confirmSetup` impone las dos con el resolutor único',
   /cronosParCategoriaDelPanel\(_modo\)/.test(SETUP) &&
   /_par && _par\.subcategory/.test(SETUP));

ok('5b · ⚠️ y las publica JUNTAS (antes la línea estaba duplicada y suelta)',
   /window\._currentMatchCategory = category;\s*\n\s*window\._currentMatchSubcategory =\s*\n?\s*_subImpuesta/.test(SETUP),
   'son el par que lee pushLiveSnapshot para sellar el partido');

ok('5c · la subcategoría del equipo se AÑADE al desplegable si no está',
   /_subEl\.querySelector\('option\[value="' \+ _miSub \+ '"\]'\)/.test(SETUP),
   'descartarla dejaba el desplegable enseñando otra letra');

ok('5d · el visor sigue prefiriendo `matchSubcategory` sobre la del perfil',
   /matchSubcategory != null && String\(m\.matchSubcategory\)\.trim\(\) !== ''/
       .test(fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8')));

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────
//  test_informes_familia_por_equipo.js  ·  🆔🔒 v764 (2026-09-24)
//
//  Encargo del autor: Alevín C y Regional B del mismo entrenador daban a sus
//  jugadores el MISMO código («ALC01…»). Midiéndolo apareció lo grave: el
//  envío de informes individuales emparejaba a la familia SÓLO por dorsal con
//  vínculos de todo el club, y la familia del dorsal 10 del Alevín C recibió
//  11 informes del dorsal 10 del Regional B —otro menor— (producción).
//
//  Se vigila, EJECUTANDO el código real:
//   1. El código del jugador sale del EQUIPO (ALC / RGB / RGA del ente).
//   2. Un informe sólo va a la familia del MISMO equipo que el partido; si no
//      se sabe su equipo, NO se envía y se avisa (opción A del autor).
//   3. La familia sabe de qué equipo es (su plaza), también con dos hijos.
//   4. Los tres despachos pasan el equipo y avisan; los vínculos lo guardan.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UTILS = leer('js/core/utils.js');
const PANEL = leer('js/coach/comms/panel.js');
const STAFF = leer('js/core/staff-and-comms.js');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 400)); }
};
const hasta = (src, desde, fin) => { const i = src.indexOf(desde); if (i < 0) throw new Error('No está: ' + desde); return src.slice(i, src.indexOf(fin, i) + fin.length); };
const funcion = (src, desde) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No está: ' + desde);
    let p = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) { if (src[j] === '{') p++; else if (src[j] === '}') { p--; if (!p) break; } }
    return src.slice(i, j + 1);
};

// ── Sandbox con las piezas reales de utils.js ───────────────────────────
const U = { console: { log() {}, warn() {} } };
U.window = U;
vm.createContext(U);
vm.runInContext([
    hasta(UTILS, 'function _cronosNoEsAcento(', '\n}\n'),
    hasta(UTILS, 'function cronosTeamSlug(', '\n}\n'),
    hasta(UTILS, 'function cronosSinModalidad(', '\n}\n'),
    hasta(UTILS, 'function cronosTeamId(', '\n}\n'),
    hasta(UTILS, 'function cronosPrefijoJugador(', '\n}\n'),
    hasta(UTILS, 'function cronosEquipoDeFamilia(', '\n}\n'),
    'window.cronosPrefijoJugador = cronosPrefijoJugador; window.cronosTeamId = cronosTeamId;',
    'window.cronosEquipoDeFamilia = cronosEquipoDeFamilia;',
    funcion(STAFF, 'window._cronosGeneratePlayerId = function(index, teamId) {') + ';',
].join('\n'), U);

const CLUB = 'club_mqvr9m11_g9kj';
const EQ_ALC = U.cronosTeamId(CLUB, 'alevin', 'C');
const EQ_RGB = U.cronosTeamId(CLUB, 'f11_regional', 'B');

console.log('\n══ 🆔🔒 Códigos por equipo e informes sólo a la familia de ese equipo ══');

console.log('\n1) El código del jugador sale del EQUIPO');
{
    const g = U._cronosGeneratePlayerId;
    ok('1a · 🔑 el mismo entrenador: Alevín C → ALC07 y Regional B → RGB07 (distintos)',
       g(6, EQ_ALC) === 'ALC07' && g(6, EQ_RGB) === 'RGB07', [g(6, EQ_ALC), g(6, EQ_RGB)]);
    ok('1b · 🔑 el Regional A de un ente → RGA01 (antes «JA01»)',
       g(0, U.cronosTeamId('individual_mtvek1ck_1590', 'regional', 'A')) === 'RGA01');
    const casos = [['prebenjamin', 'A', 'PRA'], ['benjamin', 'C', 'BJC'], ['infantil', 'A', 'IFA'], ['cadete', 'B', 'CDB'],
                   ['juvenil', 'C', 'JVC'], ['futurefem', 'C', 'FFC'], ['regional_fem', 'A', 'RFA'], ['nacional', 'A', 'NCA']];
    const malos = casos.filter(([c, s, p]) => U.cronosPrefijoJugador(U.cronosTeamId(CLUB, c, s)) !== p);
    ok('1c · cada categoría con su prefijo (Regional FEM ≠ Regional, trampa de v511)', malos.length === 0, malos);
    ok('1d · sin equipo reconocible, el genérico J', g(0, '') === 'J01');
    ok('1e · 🔑 ya no busca «la primera plaza de entrenador» del usuario',
       !/allRoles\.find/.test(funcion(STAFF, 'window._cronosGeneratePlayerId = function(index, teamId) {')));
}

console.log('\n2) El resolvedor: sólo la familia del equipo que jugó');
const R = { console: { log() {} }, window: {} };
vm.createContext(R);
vm.runInContext(funcion(PANEL, 'function _cronosExtractDorsal(') + '\n' +
                funcion(PANEL, 'function _cronosResolveParentReportTargets(') + '\nglobalThis.f = _cronosResolveParentReportTargets;', R);
{
    const res = R.f;
    const contacto = { id: 'c1', type: 'parent', uid: 'P1', playerId: 'ALC10', tags: ['rpt'] };
    const conv = [{ number: 10, name: 'JUGADOR 10' }];
    const vinc = (extra) => [Object.assign({ clubId: CLUB, playerNumber: '10', inviteCode: 'J10', parentUid: 'P1' }, extra)];

    const rB = res([contacto], vinc({ teamId: EQ_ALC }), conv, null, EQ_RGB);
    ok('2a · 🔑🔑 el caso de producción: familia del Alevín C, partido del Regional B → NO recibe', rB.length === 0, rB);
    const rA = res([contacto], vinc({ teamId: EQ_ALC }), conv, null, EQ_ALC);
    ok('2b · la misma familia, partido de SU Alevín C → recibe', rA.length === 1 && rA[0].parentUid === 'P1');
    const rMod = res([contacto], vinc({ teamId: U.cronosTeamId(CLUB, 'regional', 'B') }), conv, null, CLUB.replace(/_/g, '-') + '__f11-regional__b');
    ok('2c · la modalidad no rompe la identidad (f11-regional == regional)', rMod.length === 1);
    const rCatSub = res([contacto], vinc({ category: 'alevin', subcategory: 'C' }), conv, null, EQ_ALC);
    ok('2d · vale también un vínculo con categoría Y subcategoría (sin teamId)', rCatSub.length === 1);

    const rProd = res([contacto], vinc({ category: 'alevin' }), conv, null, EQ_ALC);
    ok('2e · 🔑 OPCIÓN A: el vínculo real de producción (alevin, sin subcategoría) → NO se envía',
       rProd.length === 0 && rProd.sinEquipo.length === 1 && rProd.sinEquipo[0].dorsal === '10', rProd.sinEquipo);
    const rSupuesto = res([Object.assign({}, contacto, { category: 'alevin', subcategory: 'C' })], vinc({}), conv, null, EQ_ALC);
    ok('2f · 🔑 NO se fía de la categoría del CONTACTO (se rellena con la del entrenador)',
       rSupuesto.length === 0 && rSupuesto.sinEquipo.length === 1);
    const rSinPartido = res([contacto], vinc({ teamId: EQ_ALC }), conv, null, '');
    ok('2g · sin equipo del PARTIDO tampoco se envía nada', rSinPartido.length === 0 && rSinPartido.sinEquipo.length === 1);
    const rNoConv = res([contacto], vinc({ category: 'alevin' }), [{ number: 7 }], null, EQ_ALC);
    ok('2h · no se avisa por una familia cuyo hijo ni siquiera jugó', rNoConv.length === 0 && rNoConv.sinEquipo.length === 0);
}

console.log('\n3) La familia sabe de qué equipo es');
{
    const yo = { allRoles: [{ role: 'parent', clubId: CLUB, category: 'alevin', subcategory: 'C', status: 'active' }] };
    const e1 = U.cronosEquipoDeFamilia(yo, CLUB, '10');
    ok('3a · una plaza de familiar → su equipo', e1.teamId === EQ_ALC, e1);
    const dos = { allRoles: [
        { role: 'parent', clubId: CLUB, category: 'alevin', subcategory: 'C', playerNumber: '10', status: 'active' },
        { role: 'parent', clubId: CLUB, category: 'regional', subcategory: 'B', playerNumber: '7', status: 'active' }] };
    ok('3b · dos hijos en equipos distintos: manda la plaza del DORSAL que se vincula',
       U.cronosEquipoDeFamilia(dos, CLUB, 'J7').teamId === U.cronosTeamId(CLUB, 'regional', 'B'));
    ok('3c · 🔑 y si no se puede decidir, vacío (→ no se envía)', U.cronosEquipoDeFamilia(dos, CLUB, '99').teamId === '');
    ok('3d · una plaza dada de baja no cuenta',
       U.cronosEquipoDeFamilia({ allRoles: [Object.assign({}, yo.allRoles[0], { status: 'removed' })] }, CLUB, '10').teamId === '');
}

console.log('\n4) Los despachos pasan el equipo y avisan; los vínculos lo guardan');
{
    const AUTO = leer('js/coach/comms/match-reports-auto.js');
    const SEND = leer('js/coach/comms/match-reports-send.js');
    const MAN = leer('js/coach/comms/manual-report.js');
    const PAR = leer('js/parent/panel.js');
    ok('4a · despacho automático', /_cronosResolveParentReportTargets\(contacts, links, homePlayers, preSelectionIds, _eqPartido\)/.test(AUTO) && /_cronosAvisaFamiliasSinEquipo\(_parentTargets\)/.test(AUTO));
    ok('4b · envío manual post-partido', /_manualAuthIds,\s*\(typeof window\.cronosEquipoAbierto/.test(SEND) && /_cronosAvisaFamiliasSinEquipo\(_parentTargetsManual\)/.test(SEND));
    ok('4c · informe manual (equipo del FORMULARIO)', /null, _eqManual\)/.test(MAN) && /cronosTeamId\(clubId, S\.equipo\.category, S\.equipo\.subcategory\)/.test(MAN));
    ok('4d · 🔑 los vínculos que escriben las familias llevan su equipo (auto y manual)',
       (PAR.match(/\.\.\._camposEquipo,/g) || []).length === 2 && (PAR.match(/\.\.\._camposEquipoM,/g) || []).length === 2);
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

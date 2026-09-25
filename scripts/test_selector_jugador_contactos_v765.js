// ─────────────────────────────────────────────────────────────────────────
//  test_selector_jugador_contactos_v765.js  ·  🔗 v765 (2026-09-25)
//
//  Encargo del autor: en Contactos, un desplegable por familia para elegir a
//  SU jugador de la plantilla («código · #dorsal · nombre», código de v764).
//  Esa elección es el enlace definitivo: la familia recibe sólo los informes
//  individuales de ese jugador.
//
//  Se vigila, EJECUTANDO el código real:
//   1. El desplegable sale de la plantilla, marca al elegido y avisa si falta.
//   2. El resolvedor empareja por CÓDIGO exacto: nunca da a otro jugador con
//      el mismo dorsal, y sigue exigiendo el equipo del partido (v764).
//   3. El guardado escribe playerCode + teamId del equipo abierto, y no
//      borra un enlace ya hecho si el desplegable se deja vacío.
//   4. Los convocados llevan su código de plantilla (`code`).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PANEL = leer('js/coach/comms/panel.js');
const CM = leer('js/coach/comms/contact-manager.js');
const EVL = leer('js/core/event-listeners.js');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 400)); }
};
const funcion = (src, desde) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No está: ' + desde);
    let p = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) { if (src[j] === '{') p++; else if (src[j] === '}') { p--; if (!p) break; } }
    return src.slice(i, j + 1);
};

const EQ_ALC = 'club-x__alevin__c';
const EQ_RGB = 'club-x__regional__b';

console.log('\n══ 🔗 v765 · el jugador elegido en Contactos es el enlace de los informes ══');

console.log('\n1) El desplegable');
{
    const S = { console: { log() {} } };
    S.window = S;
    vm.createContext(S);
    vm.runInContext(funcion(CM, 'function _cmSelectorJugador(') + '\nwindow.sel = _cmSelectorJugador;', S);
    S._cronos_squad_cache = [
        { id: 'ALC07', name: 'Ana', surname: 'Ruiz', alias: 'Ana', number: 7 },
        { id: 'ALC10', name: 'Leo', alias: 'Leo', number: 10 },
        { id: 'ALC11', number: 11 },                       // fila vacía de la plantilla
    ];
    const h = S.sel('contact-player', 'data-linkid="L1"', 'ALC10', null);
    ok('1a · cada opción: «código · #dorsal · nombre»', h.includes('ALC07 · #7 · Ana Ruiz') && h.includes('ALC10 · #10 · Leo'));
    ok('1b · no ofrece filas vacías de la plantilla', !h.includes('ALC11'));
    ok('1c · marca al jugador ya elegido y dice a quién le llegan los informes',
       /<option value="ALC10"[^>]*selected>/.test(h) && h.includes('✅ Recibe los informes de ALC10'));
    const hSug = S.sel('contact-player', '', '', '7');
    ok('1d · un vínculo antiguo (sólo dorsal, de este equipo) aparece ya sugerido', /<option value="ALC07"[^>]*selected>/.test(hSug));
    const hNo = S.sel('p-player', '', '', null);
    ok('1e · sin elegir, avisa: no recibe informes individuales', !/selected/.test(hNo) && hNo.includes('⚠️ Sin jugador'));
    ok('1f · el dorsal y el nombre viajan en data-*, no en el texto', /data-number="10" data-alias="Leo"/.test(h));
}

console.log('\n2) El resolvedor empareja por código');
const R = { console: { log() {} }, window: {} };
vm.createContext(R);
vm.runInContext(funcion(PANEL, 'function _cronosExtractDorsal(') + '\n' +
                funcion(PANEL, 'function _cronosResolveParentReportTargets(') + '\nglobalThis.f = _cronosResolveParentReportTargets;', R);
{
    const res = R.f;
    const contacto = { id: 'c1', type: 'parent', uid: 'P1', tags: ['rpt'] };
    const vinc = (extra) => [Object.assign({ clubId: 'club_x', playerNumber: '10', inviteCode: 'J10', parentUid: 'P1', teamId: EQ_ALC }, extra)];
    const conv = [{ number: 10, name: 'LEO', code: 'ALC10' }, { number: 7, name: 'ANA', code: 'ALC07' }];

    const r1 = res([contacto], vinc({ playerCode: 'ALC10' }), conv, null, EQ_ALC);
    ok('2a · el código elegido lleva a SU jugador', r1.length === 1 && String(r1[0].dorsal) === '10', r1);
    const r2 = res([contacto], vinc({ playerCode: 'ALC07', playerNumber: '10' }), conv, null, EQ_ALC);
    ok('2b · 🔑 manda el código, no el dorsal viejo del vínculo', r2.length === 1 && String(r2[0].dorsal) === '7', r2);
    const convOtro = [{ number: 10, name: 'OTRO', code: 'RGB10' }];
    const r3 = res([contacto], vinc({ playerCode: 'ALC10' }), convOtro, null, EQ_ALC);
    ok('2c · 🔑🔑 su jugador no está convocado → NO se da el informe de otro con su mismo dorsal', r3.length === 0, r3);
    const r4 = res([contacto], vinc({ playerCode: 'ALC10' }), conv, null, EQ_RGB);
    ok('2d · el código no salta la barrera del equipo del partido (v764)', r4.length === 0, r4);
    const r5 = res([contacto], vinc({ playerCode: 'ALC10' }), [{ number: 10, name: 'LEO' }], null, EQ_ALC);
    ok('2e · partido antiguo sin códigos: cae al dorsal del vínculo', r5.length === 1 && String(r5[0].dorsal) === '10', r5);
    const r6 = res([Object.assign({}, contacto, { playerId: 'ALC07' })], vinc({}), conv, null, EQ_ALC);
    ok('2f · el contacto manual con código (playerId) también manda', r6.length === 1 && String(r6[0].dorsal) === '7', r6);
}

console.log('\n3) El guardado');
{
    const save = funcion(CM, 'async function saveContactManagerData(');
    ok('3a · escribe playerCode y el teamId del equipo abierto en el vínculo',
       /updateData\.playerCode\s*=\s*jugEl\.value/.test(save) && /updateData\.teamId\s*=\s*eqAbierto/.test(save));
    ok('3b · 🔑 sólo si hay jugador elegido Y equipo abierto (vaciar no borra el enlace)',
       /if \(jugOpt && eqAbierto\)/.test(save));
    ok('3c · el contacto manual guarda también su equipo y dorsal',
       /teamId:\s*\(playerId &&/.test(save) && /playerNumber:\s*String\(_pDs\.number/.test(save));
    ok('3d · la tabla de familias enseña las del equipo abierto (y las aún sin equipo)',
       /_cmVinculosDelEquipo\(links\)/.test(CM));
}

console.log('\n4) Los convocados llevan su código');
ok('4a · spawnInitialPlayers copia el código de plantilla al jugador del partido',
   /code:\s*String\(pData\.id \|\| ''\)/.test(EVL));

console.log(`\nResultado: ${pass}/${pass + fail}  ${fail ? '❌ ' + fail + ' FALLOS' : '✅'}`);
process.exit(fail ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────
//  test_dorsales_por_jornada_v767.js  ·  🔢 v767 (2026-09-25)
//
//  Encargo del autor: que el entrenador elija entre dorsales FIJOS (los de la
//  plantilla toda la temporada) y dorsales POR JORNADA (los pone en cada
//  convocatoria), sin tocar el CÓDIGO del jugador que une sus informes con su
//  familia.
//
//  Con dorsales por jornada el dorsal deja de identificar al jugador fuera de
//  SU partido. Se vigila, EJECUTANDO el código real, que nada que cruce
//  partidos siga fiándose del dorsal:
//   1. La opción: por equipo, «fijo» por defecto, viaja en la raíz de la plantilla.
//   2. La convocatoria: el jugador juega con el dorsal de la jornada, conserva
//      código y dorsal de plantilla, y no se admite un dorsal repetido.
//   3. El acumulado de temporada agrupa por CÓDIGO (y traduce los informes
//      viejos sólo si es inequívoco).
//   4. El resolvedor: la familia enlazada sólo por dorsal recibe a SU hijo.
//   5. Los informes, el directo y la recuperación llevan el código.
//   6. El panel de la familia ya no se lleva informes de otra familia.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UTILS = leer('js/core/utils.js');
const IMPORT = leer('js/ai/import.js');
const PANEL = leer('js/coach/comms/panel.js');
const CT = leer('js/admin/shared/category-tree.js');
const TR = leer('js/roster/team-rosters.js');
const EVL = leer('js/core/event-listeners.js');
const SYNC = leer('js/match/live/sync.js');
const SETUP = leer('js/core/setup-modal.js');
const PARENT = leer('js/parent/panel.js');
const STAFF = leer('js/core/staff-and-comms.js');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 500)); }
};
const entre = (src, desde, hastaTxt) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No está: ' + desde);
    const j = src.indexOf(hastaTxt, i); if (j < 0) throw new Error('No está: ' + hastaTxt);
    return src.slice(i, j + hastaTxt.length);
};
const funcion = (src, desde) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No está: ' + desde);
    let p = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) { if (src[j] === '{') p++; else if (src[j] === '}') { p--; if (!p) break; } }
    return src.slice(i, j + 1);
};

console.log('\n══ 🔢 v767 · dorsales fijos o por jornada ══');

// ── 1) La opción ─────────────────────────────────────────────────────────
console.log('\n1) La opción, por equipo');
const almacen = {};
const U = {
    console: { log() {}, warn() {} },
    localStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); } },
    subidas: [],
    equipo: 'club__alevin__c',
};
U.window = U;
U.cloudSet = (k, v) => { U.subidas.push([k, v]); return Promise.resolve(true); };
U._cronosMatchSlots = { equipoActual: () => U.equipo };
vm.createContext(U);
vm.runInContext(entre(UTILS, 'const _ROSTER_KEY', 'window.cronosDorsalModoElegir       = cronosDorsalModoElegir;\n}'), U);
{
    ok('1a · un equipo que nunca la tocó: «fijo» (todo como antes)', U.cronosDorsalModo() === 'fijo');
    U.cronosDorsalModoGuardar('flexible');
    ok('1b · se guarda «flexible» para ESTE equipo', U.cronosDorsalModo() === 'flexible');
    ok('1c · y sube a la nube con la plantilla (cronos_master_roster)',
       U.subidas.length === 1 && U.subidas[0][0] === 'cronos_master_roster' && /"dorsalModo"/.test(U.subidas[0][1]));
    U.equipo = 'club__regional__b';
    ok('1d · 🔑 el otro equipo del mismo entrenador sigue en «fijo»', U.cronosDorsalModo() === 'fijo');
    U.equipo = 'club__alevin__c';
    U.cronosPlantillaGuardar('f7', [{ id: 'ALC07', number: 7, name: 'Ana' }]);
    ok('1e · 🔑 guardar la plantilla NO se come la opción', U.cronosDorsalModo() === 'flexible');
    U.cronosDorsalModoGuardar('cualquier-cosa');
    ok('1f · un valor raro cuenta como «fijo»', U.cronosDorsalModo() === 'fijo');
    U.cronosDorsalesRecordar([{ code: 'ALC07', number: 9 }, { id: 'ALC03', number: 7 }, { code: 'ALC05', number: 0 }]);
    ok('1g · recuerda el último dorsal de cada código para sugerirlo', U.cronosDorsalUltimo('ALC07') === 9 &&
       U.cronosDorsalUltimo('ALC03') === 7 && U.cronosDorsalUltimo('ALC05') === null);
    U.cronosDorsalModoGuardar('flexible');
    const h = U.cronosDorsalModoSelectorHTML();
    ok('1h · el selector: dos botones, el activo marcado, y avisa de que el código no cambia',
       /data-dorsal-modo="fijo"/.test(h) && /data-dorsal-modo="flexible"[^>]*>/.test(h) &&
       /aria-pressed="true" data-dorsal-modo="flexible"/.test(h) && /código del jugador no cambia/.test(h));
    ok('1i · el selector está en la convocatoria y en Gestionar Plantilla',
       /cronosDorsalModoSelectorHTML\(\)/.test(IMPORT) && /cronosDorsalModoSelectorHTML\(\)/.test(STAFF));
}

// ── 2) La convocatoria ───────────────────────────────────────────────────
console.log('\n2) La convocatoria');
{
    const modo = { v: 'flexible' };
    const inputs = [];
    const fila = (estado, valor) => {
        const inp = { value: String(valor), style: {} };
        inputs.push(inp);
        return { dataset: { state: estado }, querySelector: (s) => (s === '.conv-dorsal' ? inp : null), _inp: inp };
    };
    const filas = [fila('titular', 9), fila('convocado', 7), fila('convocado', 11)];
    const C = {
        console, alertas: [],
        document: {
            querySelectorAll: (s) => (/conv-dorsal/.test(s) ? inputs : (/data-state/.test(s) ? filas : [])),
            addEventListener() {},
        },
    };
    C.window = C;
    C.alert = (m) => C.alertas.push(m);
    C.cronosDorsalModo = () => modo.v;
    C.cronosDorsalUltimo = (c) => (c === 'ALC07' ? 9 : null);
    vm.createContext(C);
    vm.runInContext(entre(IMPORT, 'function _convModoFlexible()', 'window._convJugadorConDorsal = _convJugadorConDorsal;'), C);

    const ana = { id: 'ALC07', number: 7, name: 'Ana' };
    const j = C._convJugadorConDorsal(ana, filas[0]);
    ok('2a · 🔑 juega con el dorsal de la jornada y conserva código y dorsal de plantilla',
       j.number === 9 && j.id === 'ALC07' && j.rosterNumber === 7, j);
    ok('2b · la plantilla no se toca (se copia, no se muta)', ana.number === 7 && !('rosterNumber' in ana));
    ok('2c · sugiere el último dorsal que llevó (o el de plantilla)',
       C._convDorsalSugerido(ana) === 9 && C._convDorsalSugerido({ id: 'X', number: 4 }) === 4);
    ok('2d · dorsales distintos → se puede ir al partido', C._convDorsalesOk() === true && C.alertas.length === 0);
    filas[2]._inp.value = '9';
    ok('2e · 🔑 un dorsal repetido NO deja ir al partido y se marca en rojo',
       C._convDorsalesOk() === false && /repetido/.test(C.alertas[0] || '') &&
       filas[0]._inp.style.borderColor === '#f85149' && filas[2]._inp.style.borderColor === '#f85149');
    filas[2]._inp.value = '';
    ok('2f · un convocado sin dorsal tampoco', C._marca = C._convMarcaDorsales() !== '');
    modo.v = 'fijo';
    const jf = C._convJugadorConDorsal(ana, filas[0]);
    ok('2g · en «fijo» manda la plantilla aunque la casilla diga otra cosa, y no hay validación',
       jf.number === 7 && jf.rosterNumber === 7 && C._convMarcaDorsales() === '');
    const gtt = funcion(IMPORT, 'function goToTitularSelection()');
    ok('2h · «Ir al partido» usa el dorsal de la jornada y aborta (false) con dorsales malos',
       /_convJugadorConDorsal\(myPlayers\[parseInt\(r\.dataset\.index\)\], r\)/.test(gtt) &&
       /if \(!_convDorsalesOk\(\)\) return false;/.test(gtt));
    ok('2i · la convocatoria que se ENVÍA y el PDF llevan el dorsal de la jornada',
       /_convJugadorConDorsal/.test(funcion(IMPORT, 'function saveConvPlayers()')) &&
       /_convJugadorConDorsal/.test(funcion(IMPORT, 'function cronosImprimirConvocatoriaActual()')) &&
       /onclick="if \(!_convDorsalesOk\(\)\) return; saveConvData\(\)/.test(IMPORT));
    ok('2j · el clic en la casilla no marca/desmarca la ficha', /class="conv-dorsal"[\s\S]{0,400}onclick="event\.stopPropagation\(\)"/.test(IMPORT));
}

// ── 3) El acumulado de temporada ─────────────────────────────────────────
console.log('\n3) El acumulado agrupa por código');
{
    const S = { console: { log() {}, warn() {} } };
    S.window = S;
    S.ctNormCat = (x) => x; S.ctNormSubcat = (x) => x;
    vm.createContext(S);
    // Sólo las piezas que usa ctAccumulatePlayerStats.
    const cuerpo = funcion(CT, 'window.ctAccumulatePlayerStats = function (matches)');
    const ayudantes = ['function _ctToSeconds(', 'function _ctYellowsIn(', 'function _ctIsRed(',
                       'function _ctEmpezoDeTitular(', 'function _ctMatchPR(']
        .map(n => CT.indexOf(n) >= 0 ? funcion(CT, n) : '').join('\n');
    vm.runInContext(ayudantes + '\nfunction _ctTeamLabel(){return "";}\n' + cuerpo + ';', S);
    const doc = (o) => Object.assign({ minutesPlayed: '10:00', goals: 0, history: [] }, o);
    const partidos = [
        { players: [doc({ playerNumber: '7', playerAlias: 'Ana' })] },                                   // viejo, dorsal fijo
        { players: [doc({ playerNumber: '9', playerAlias: 'Ana', playerCode: 'ALC07', rosterNumber: '7', goals: 1 }),
                    doc({ playerNumber: '7', playerAlias: 'Leo', playerCode: 'ALC03', rosterNumber: '3' })] },
        { players: [doc({ playerNumber: '7', playerAlias: 'Ana', playerCode: 'ALC07', rosterNumber: '7' })] },
    ];
    const filas = S.ctAccumulatePlayerStats(partidos);
    const ana = filas.find(f => f.ficha === 'ALC07'), leo = filas.find(f => f.ficha === 'ALC03');
    ok('3a · 🔑🔑 Ana (con #7, #9 y #7) es UNA fila con sus 3 partidos y su gol',
       ana && ana.called === 3 && ana.goals === 1, filas);
    ok('3b · 🔑 Leo, que llevó el #7 una jornada, NO se suma a Ana', leo && leo.called === 1 && filas.length === 2, filas);
    ok('3c · la tabla enseña el dorsal de PLANTILLA', ana && ana.number === '7' && leo && leo.number === '3');
    const ambiguo = S.ctAccumulatePlayerStats([
        { players: [doc({ playerNumber: '7', playerAlias: 'Viejo' })] },
        { players: [doc({ playerNumber: '7', playerAlias: 'A', playerCode: 'ALC07', rosterNumber: '7' })] },
        { players: [doc({ playerNumber: '7', playerAlias: 'B', playerCode: 'ALC08', rosterNumber: '7' })] },
    ]);
    ok('3d · si la plantilla se renumeró (dos códigos para el #7), el informe viejo queda aparte: no se le suma a nadie',
       ambiguo.length === 3 && ambiguo.every(f => f.called === 1), ambiguo);
    const viejos = S.ctAccumulatePlayerStats([
        { players: [doc({ playerNumber: '7', playerAlias: 'Ana' })] },
        { players: [doc({ playerNumber: '7', playerAlias: 'Ana' })] },
    ]);
    ok('3e · sin ningún código, exactamente como antes (por dorsal)', viejos.length === 1 && viejos[0].called === 2);
}

// ── 4) El resolvedor ─────────────────────────────────────────────────────
console.log('\n4) La familia enlazada sólo por dorsal');
{
    const R = { console: { log() {} }, window: {} };
    vm.createContext(R);
    vm.runInContext(funcion(PANEL, 'function _cronosExtractDorsal(') + '\n' +
                    funcion(PANEL, 'function _cronosResolveParentReportTargets(') + '\nglobalThis.f = _cronosResolveParentReportTargets;', R);
    const EQ = 'club-x__alevin__c';
    const contacto = { id: 'c1', type: 'parent', uid: 'P1', tags: ['rpt'] };
    const vinc = [{ clubId: 'club_x', playerNumber: '7', inviteCode: 'J7', parentUid: 'P1', teamId: EQ }];
    const conv = [{ number: 9, code: 'ALC07', rosterNumber: 7, name: 'ANA' }, { number: 7, code: 'ALC03', rosterNumber: 3, name: 'LEO' }];
    const r = R.f([contacto], vinc, conv, null, EQ);
    ok('4a · 🔑🔑 recibe el de SU hijo (#9 hoy), no el del compañero que lleva hoy el #7',
       r.length === 1 && String(r[0].dorsal) === '9', r);
    const rFijo = R.f([contacto], vinc, [{ number: 7, name: 'ANA' }], null, EQ);
    ok('4b · partidos sin dorsal de plantilla (viejos): como antes', rFijo.length === 1 && String(rFijo[0].dorsal) === '7');
}

// ── 5) Informes, directo y recuperación ──────────────────────────────────
console.log('\n5) El código viaja con el jugador');
{
    const T = { console };
    T.window = T;
    vm.createContext(T);
    vm.runInContext(funcion(TR, 'window.cronosCodigoFields = function (p)') + ';', T);
    const f = T.cronosCodigoFields({ code: 'ALC07', rosterNumber: 7, number: 9 });
    ok('5a · cronosCodigoFields da playerCode y rosterNumber', f.playerCode === 'ALC07' && f.rosterNumber === '7');
    const vacio = T.cronosCodigoFields({ number: 3 });
    ok('5b · sin datos, {} (el documento sale como antes, nunca undefined)',
       Object.keys(vacio).length === 0 && Object.keys(T.cronosCodigoFields(null)).length === 0);
    const escritores = ['js/coach/comms/collective-report.js', 'js/coach/comms/match-reports-auto.js', 'js/coach/comms/match-reports-send.js'];
    const n = escritores.reduce((a, e) => a + (leer(e).match(/cronosCodigoFields\((p|player)\)/g) || []).length, 0);
    ok('5c · los escritores de informes (5 del equipo + 2 de familia) lo añaden', n === 7, n);
    ok('5d · el jugador del partido lleva `rosterNumber` además de `code`', /rosterNumber:\s*\(pData\.rosterNumber/.test(EVL));
    const snap = funcion(SYNC, 'function _mapPlayerForSnapshot(p)');
    ok('5e · la instantánea del directo lo guarda sin undefined', /code:\s*p\.code \|\| ''/.test(snap) && /rosterNumber:/.test(snap));
    ok('5f · y la recuperación desde la nube lo restaura', /code:\s*p\.code \|\| '',\s*\n\s*rosterNumber:/.test(SETUP));
}

// ── 6) El panel de la familia ────────────────────────────────────────────
console.log('\n6) El panel de la familia');
{
    const P = { console, window: {} };
    vm.createContext(P);
    // El filtro de la «Prioridad 2», tal cual, como función.
    const trozo = entre(PARENT, 'if (data.parentUid && data.parentUid !== me.uid) return;', 'if (_nt(data.teamId) !== _nt(link.teamId)) return;\n                }');
    vm.runInContext('globalThis.acepta = function (data, link, me) {\n' + trozo + '\nreturn true; };', P);
    const me = { uid: 'P1' };
    const link = { playerNumber: '7', playerCode: 'ALC07', teamId: 'club__alevin__c' };
    ok('6a · 🔑🔑 NO se lleva un informe dirigido a OTRA familia con el mismo dorsal',
       P.acepta({ parentUid: 'OTRA' }, link, me) !== true);
    ok('6b · NO se lleva el de otro código', P.acepta({ playerCode: 'RGB07' }, link, me) !== true);
    ok('6c · NO se lleva el de otro equipo', P.acepta({ teamId: 'club__regional__b' }, link, me) !== true);
    ok('6d · sí el suyo sin destinatario (de antes de vincularse)', P.acepta({ playerCode: 'ALC07', teamId: 'club__alevin__c' }, link, me) === true);
    ok('6e · con el mismo código vale aunque el dorsal de plantilla del vínculo esté desfasado',
       P.acepta({ playerCode: 'ALC07', rosterNumber: '4' }, link, me) === true);
    ok('6f · sin código, el dorsal de plantilla tiene que coincidir',
       P.acepta({ rosterNumber: '4' }, { playerNumber: '7' }, me) !== true && P.acepta({ rosterNumber: '7' }, { playerNumber: '7' }, me) === true);
}

console.log(`\nResultado: ${pass}/${pass + fail}  ${fail ? '❌ ' + fail + ' FALLOS' : '✅'}`);
process.exit(fail ? 1 : 0);

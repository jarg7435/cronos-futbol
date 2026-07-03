/**
 * test_parent_report_per_match_checkbox.js — v217
 *
 * Verifica que el FIX de v217 hace que el helper
 * _cronosResolveParentReportTargets respete ESTRICTAMENTE la pre-selección
 * por partido (cronos_match_rpt_selection), representada aquí como el 4o
 * argumento `authorizedIds`.
 *
 * Escenarios clave que antes fallaban y ahora deben pasar:
 *   A) Padre con tag 'rpt' ON pero SIN check en el partido → NO se envía.
 *   B) Padre con tag 'rpt' OFF pero CON check en el partido → SÍ se envía.
 *   C) authorizedIds = null → comportamiento legacy (tag 'rpt' global).
 *   D) authorizedIds = [] → comportamiento legacy (no se usa el modal).
 *   E) authorizedIds no-vacío → SOLO se envían los de dentro, sin importar
 *      el tag 'rpt' global.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '..', 'js/coach/comms/panel.js');
const code = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

// ── Extraer las funciones reales del fuente por nombre ──────────────────
function extractFn(name) {
    const startRe = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
    const m = startRe.exec(code);
    if (!m) throw new Error('No se encontró la función ' + name + ' en el fuente.');
    let i = code.indexOf('{', m.index);
    let depth = 0, end = -1;
    for (let j = i; j < code.length; j++) {
        if (code[j] === '{') depth++;
        else if (code[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    if (end === -1) throw new Error('No se pudo balancear llaves de ' + name);
    return code.slice(m.index, end);
}

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(extractFn('_cronosExtractDorsal'), sandbox);
vm.runInContext(extractFn('_cronosResolveParentReportTargets'), sandbox);
const resolve = sandbox._cronosResolveParentReportTargets;

let passed = 0, failed = 0;
function assert(name, cond) {
    if (cond) { passed++; console.log('  PASS  ' + name); }
    else      { failed++; console.log('  FAIL  ' + name); }
}

// ── Datos comunes ─────────────────────────────────────────────────────────
const homePlayers = [
    { number: 10, name: 'Hijo Diez',  alias: 'Diez',  goals: 0, time: 600 },
    { number: 7,  name: 'Hijo Siete', alias: 'Siete', goals: 0, time: 300 },
    { number: 5,  name: 'Hijo Cinco', alias: 'Cinco', goals: 0, time: 200 },
];

const links = [
    { _id: 'l10', parentUid: 'uid_p10', inviteCode: 'J10', playerNumber: 10, parentEmail: 'p10@mail.com' },
    { _id: 'l7',  parentUid: 'uid_p7',  inviteCode: 'J7',  playerNumber: 7,  parentEmail: 'p7@mail.com'  },
    { _id: 'l5',  parentUid: 'uid_p5',  inviteCode: 'J5',  playerNumber: 5,  parentEmail: 'p5@mail.com'  },
];

// ── Escenario A: tag 'rpt' ON pero SIN check en el partido → NO se envía ──
console.log('\n== Escenario A: tag rpt ON pero SIN check en el partido ==');
{
    const contacts = [
        // Padre 10 con tag rpt ON pero NO seleccionado en el partido.
        { id: 'p10', type: 'parent', name: 'Padre 10', uid: 'uid_p10', tags: ['rpt'] },
        // Padre 7 CON check en el partido (en authorizedIds) pero SIN tag rpt.
        { id: 'p7',  type: 'parent', name: 'Padre 7',  uid: 'uid_p7',  tags: [] },
    ];
    // Solo p7 está marcado en el partido.
    const out = resolve(contacts, links, homePlayers, ['p7']);
    assert('A: padre 10 (rpt ON, sin check) NO recibe', !out.some(t => t.parentUid === 'uid_p10'));
    assert('A: padre 7 (rpt OFF, con check) SI recibe',  out.some(t => t.parentUid === 'uid_p7'));
    assert('A: exactamente 1 informe', out.length === 1);
}

// ── Escenario B: tag 'rpt' OFF pero CON check en el partido → SÍ se envía ─
console.log('\n== Escenario B: tag rpt OFF pero CON check en el partido ==');
{
    const contacts = [
        { id: 'p10', type: 'parent', name: 'Padre 10', uid: 'uid_p10', tags: [] }, // sin rpt
        { id: 'p7',  type: 'parent', name: 'Padre 7',  uid: 'uid_p7',  tags: [] }, // sin rpt
        { id: 'p5',  type: 'parent', name: 'Padre 5',  uid: 'uid_p5',  tags: [] }, // sin rpt
    ];
    // Solo p10 y p5 están marcados en el partido.
    const out = resolve(contacts, links, homePlayers, ['p10', 'p5']);
    assert('B: padre 10 (sin rpt, con check) SI recibe',  out.some(t => t.parentUid === 'uid_p10'));
    assert('B: padre 5 (sin rpt, con check) SI recibe',   out.some(t => t.parentUid === 'uid_p5'));
    assert('B: padre 7 (sin rpt, sin check) NO recibe',  !out.some(t => t.parentUid === 'uid_p7'));
    assert('B: exactamente 2 informes', out.length === 2);
}

// ── Escenario C: authorizedIds = null → comportamiento legacy (tag rpt) ──
console.log('\n== Escenario C: authorizedIds = null (legacy) ==');
{
    const contacts = [
        { id: 'p10', type: 'parent', name: 'Padre 10', uid: 'uid_p10', tags: ['rpt'] },
        { id: 'p7',  type: 'parent', name: 'Padre 7',  uid: 'uid_p7',  tags: [] },     // sin rpt
        { id: 'p5',  type: 'parent', name: 'Padre 5',  uid: 'uid_p5',  tags: ['rpt'] },
    ];
    const out = resolve(contacts, links, homePlayers, null);
    assert('C: padre 10 (rpt) SI recibe',  out.some(t => t.parentUid === 'uid_p10'));
    assert('C: padre 5 (rpt) SI recibe',   out.some(t => t.parentUid === 'uid_p5'));
    assert('C: padre 7 (sin rpt) NO recibe', !out.some(t => t.parentUid === 'uid_p7'));
    assert('C: exactamente 2 informes', out.length === 2);
}

// ── Escenario D: authorizedIds = [] → también legacy (no se usó el modal) ─
console.log('\n== Escenario D: authorizedIds = [] (legacy) ==');
{
    const contacts = [
        { id: 'p10', type: 'parent', name: 'Padre 10', uid: 'uid_p10', tags: ['rpt'] },
        { id: 'p7',  type: 'parent', name: 'Padre 7',  uid: 'uid_p7',  tags: [] },
    ];
    const out = resolve(contacts, links, homePlayers, []);
    assert('D: padre 10 (rpt) SI recibe (legacy)',  out.some(t => t.parentUid === 'uid_p10'));
    assert('D: padre 7 (sin rpt) NO recibe (legacy)', !out.some(t => t.parentUid === 'uid_p7'));
    assert('D: exactamente 1 informe', out.length === 1);
}

// ── Escenario E: authorizedIds no-vacío → SOLO los de dentro, sin tag rpt ─
console.log('\n== Escenario E: authorizedIds excluye incluso con tag rpt ==');
{
    const contacts = [
        { id: 'p10', type: 'parent', name: 'Padre 10', uid: 'uid_p10', tags: ['rpt'] },
        { id: 'p7',  type: 'parent', name: 'Padre 7',  uid: 'uid_p7',  tags: ['rpt'] },
        { id: 'p5',  type: 'parent', name: 'Padre 5',  uid: 'uid_p5',  tags: ['rpt'] },
    ];
    // Solo p5 marcado en el partido.
    const out = resolve(contacts, links, homePlayers, ['p5']);
    assert('E: padre 10 (rpt, sin check) NO recibe', !out.some(t => t.parentUid === 'uid_p10'));
    assert('E: padre 7 (rpt, sin check) NO recibe',  !out.some(t => t.parentUid === 'uid_p7'));
    assert('E: padre 5 (rpt, con check) SI recibe',   out.some(t => t.parentUid === 'uid_p5'));
    assert('E: exactamente 1 informe', out.length === 1);
}

// ── Escenario F: authorizedIds con IDs que no existen → 0 informes ───────
console.log('\n== Escenario F: authorizedIds sin matches ==');
{
    const contacts = [
        { id: 'p10', type: 'parent', name: 'Padre 10', uid: 'uid_p10', tags: ['rpt'] },
    ];
    const out = resolve(contacts, links, homePlayers, ['inexistente']);
    assert('F: 0 informes cuando ningún id coincide', out.length === 0);
}

// ── Escenario G: hijo no convocado se omite aunque esté en authorizedIds ─
console.log('\n== Escenario G: hijo no convocado se omite aunque esté check ==');
{
    const contacts = [
        { id: 'p10', type: 'parent', name: 'Padre 10', uid: 'uid_p10', tags: [] },
        // Padre cuyo hijo NO está en homePlayers (dorsal 99)
        { id: 'p99', type: 'parent', name: 'Padre 99', uid: 'uid_p99', tags: [], playerId: 'J99' },
    ];
    const links99 = links.concat([
        { _id: 'l99', parentUid: 'uid_p99', inviteCode: 'J99', playerNumber: 99, parentEmail: 'p99@mail.com' },
    ]);
    const out = resolve(contacts, links99, homePlayers, ['p10', 'p99']);
    assert('G: padre 10 (convocado) SI recibe',  out.some(t => t.parentUid === 'uid_p10'));
    assert('G: padre 99 (no convocado) NO recibe', !out.some(t => t.parentUid === 'uid_p99'));
    assert('G: exactamente 1 informe', out.length === 1);
}

// ── Resumen ────────────────────────────────────────────────────────────────
console.log('\n' + (failed === 0 ? 'OK' : 'FALLOS') + ': ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

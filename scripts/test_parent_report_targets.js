/**
 * test_parent_report_targets.js — verifica el HELPER REAL de v171
 * (_cronosResolveParentReportTargets) extraído de js/coach/comms/panel.js,
 * sin tocar Firestore.
 *
 * Casos requeridos por la instrucción:
 *   1. Director/Coordinador SIEMPRE reciben (se verifica la lógica de _cGetStaff
 *      con Regla 1/2 — ver bloque STAFF abajo).
 *   2. Padre con hijo convocado y checkbox INF -> exactamente 1 informe.
 *   3. Padre con hijo NO convocado -> no recibe nada.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(process.cwd(), 'js/coach/comms/panel.js');
const code = fs.readFileSync(SRC, 'utf8');

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
const extractDorsal = sandbox._cronosExtractDorsal;

let passed = 0, failed = 0;
function assert(name, cond) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}

// ── Datos de prueba ─────────────────────────────────────────────────────
const homePlayers = [
  { number: 10, name: 'Hijo Diez',  alias: 'Diez',  goals: 1, time: 600 },
  { number: 7,  name: 'Hijo Siete', alias: 'Siete', goals: 0, time: 300 },
];

const links = [
  { _id: 'club_10', parentUid: 'uid_padre10', inviteCode: 'J10', playerNumber: 10, parentEmail: 'padre10@mail.com' },
  { _id: 'club_7',  parentUid: 'uid_padre7',  inviteCode: 'J7',  playerNumber: 7,  parentEmail: 'padre7@mail.com' },
  { _id: 'club_99', parentUid: 'uid_padre99', inviteCode: 'J99', playerNumber: 99, parentEmail: 'padre99@mail.com' },
];

// ── extractDorsal ────────────────────────────────────────────────────────
assert('extractDorsal J10 -> 10', extractDorsal('J10') === '10');
assert('extractDorsal J-7 -> 7',  extractDorsal('J-7') === '7');
assert('extractDorsal null -> null', extractDorsal(null) === null);
assert('extractDorsal "ABC" -> null', extractDorsal('ABC') === null);

// ── CASO 2: padre con hijo convocado + INF -> 1 informe ──────────────────
{
  const contacts = [
    { id: 'p1', type: 'parent', name: 'Padre 10', uid: 'uid_padre10', tags: ['rpt'] },
  ];
  const out = resolve(contacts, links, homePlayers);
  assert('CASO 2: hijo convocado + INF -> 1 informe', out.length === 1);
  assert('CASO 2: parentUid correcto', out[0] && out[0].parentUid === 'uid_padre10');
  assert('CASO 2: dorsal correcto', out[0] && out[0].dorsal === '10');
  assert('CASO 2: jugador correcto', out[0] && out[0].player.number === 10);
  assert('CASO 2: target incluye contact (Bug 2)', out[0] && out[0].contact && out[0].contact.id === 'p1');
}

// ── Bug 2: contacto manual con playerId 'J10' (sin uid) resuelve parentUid del link ──
{
  const contacts = [
    { id: 'cManual', type: 'parent', name: 'Bruna Martin Perez', playerId: 'J10', tags: ['rpt'] },
  ];
  const out = resolve(contacts, links, homePlayers);
  assert('Bug 2: playerId J10 (sin uid) -> resuelve parentUid del link',
    out.length === 1 && out[0].parentUid === 'uid_padre10' && out[0].dorsal === '10');
  assert('Bug 2: target.contact preservado', out[0] && out[0].contact && out[0].contact.id === 'cManual');
}

// ── Bug 2: emparejado robusto por dorsal con inviteCode 'J-10' en el link ──
{
  const linksGuion = [
    { _id: 'g10', parentUid: 'uid_guion', inviteCode: 'J-10', playerNumber: 10, parentEmail: 'g@mail.com' },
  ];
  const contacts = [
    { id: 'cg', type: 'parent', name: 'Manual guion', playerId: 'J10', tags: ['rpt'] },
  ];
  const out = resolve(contacts, linksGuion, homePlayers);
  assert('Bug 2: inviteCode J-10 empareja con playerId J10 (normalizado)',
    out.length === 1 && out[0].parentUid === 'uid_guion' && out[0].dorsal === '10');
}

// ── Bug 2: playerId convocado pero NINGÚN link aporta parentUid -> omitir ──
{
  const contacts = [
    { id: 'cNoLink', type: 'parent', name: 'Sin link', playerId: 'J7', tags: ['rpt'] },
  ];
  const sinLink7 = links.filter(l => l.playerNumber !== 7);
  assert('Bug 2: playerId J7 sin link con parentUid -> 0 informes',
    resolve(contacts, sinLink7, homePlayers).length === 0);
}

// ── CASO 3: padre con hijo NO convocado -> nada ──────────────────────────
{
  const contacts = [
    { id: 'p99', type: 'parent', name: 'Padre 99', uid: 'uid_padre99', tags: ['rpt'] },
  ];
  const out = resolve(contacts, links, homePlayers);
  assert('CASO 3: hijo NO convocado -> 0 informes', out.length === 0);
}

// ── Padre SIN checkbox INF -> nada ───────────────────────────────────────
{
  const contacts = [
    { id: 'p1', type: 'parent', name: 'Padre 10', uid: 'uid_padre10', tags: [] },
  ];
  assert('Sin INF -> 0 informes', resolve(contacts, links, homePlayers).length === 0);
}

// ── Padre sin inviteCode válido (sin link y sin playerId) -> omitir ──────
{
  const contacts = [
    { id: 'pX', type: 'parent', name: 'Padre X', uid: 'uid_desconocido', tags: ['rpt'] },
  ];
  assert('Sin inviteCode válido -> 0 informes (omitir silencioso)',
    resolve(contacts, links, homePlayers).length === 0);
}

// ── Padre sin parentUid registrado (playerId convocado pero sin link) -> omitir ──
{
  // J7 está convocado (dorsal 7) pero NO existe link con inviteCode J7b ni este id/uid,
  // así que no se puede resolver un parentUid real -> omitir en silencio.
  const linksSinPadre7 = links.filter(l => l.playerNumber !== 7);
  const contacts = [
    { id: 'pM', type: 'parent', name: 'Manual', playerId: 'J7', tags: ['rpt'] },
  ];
  // playerId J7 da dorsal 7 (convocado) pero sin link que aporte parentUid y sin c.uid -> omitir.
  assert('Sin parentUid (playerId convocado, sin link) -> 0 informes',
    resolve(contacts, linksSinPadre7, homePlayers).length === 0);
}

// ── NUNCA emparejar por nombre: contacto cuyo nombre contiene "Diez" pero dorsal 7 ──
{
  const contacts = [
    { id: 'p7', type: 'parent', name: 'Diez padre', uid: 'uid_padre7', tags: ['rpt'] },
  ];
  const out = resolve(contacts, links, homePlayers);
  // Debe emparejar por su inviteCode (J7 -> dorsal 7), NO por el nombre "Diez".
  assert('No empareja por nombre: usa dorsal del inviteCode (J7)',
    out.length === 1 && out[0].dorsal === '7' && out[0].parentUid === 'uid_padre7');
}

// ── 1 informe por padre aunque aparezca duplicado en contactos ───────────
{
  const contacts = [
    { id: 'p1a', type: 'parent', name: 'Padre 10', uid: 'uid_padre10', tags: ['rpt'] },
    { id: 'p1b', type: 'parent', name: 'Padre 10 dup', uid: 'uid_padre10', tags: ['rpt'] },
  ];
  assert('Dedup por parentUid -> 1 informe', resolve(contacts, links, homePlayers).length === 1);
}

// ── Varios padres: solo los convocados, 1 cada uno ───────────────────────
{
  const contacts = [
    { id: 'p10', type: 'parent', name: 'P10', uid: 'uid_padre10', tags: ['rpt'] },
    { id: 'p7',  type: 'parent', name: 'P7',  uid: 'uid_padre7',  tags: ['rpt'] },
    { id: 'p99', type: 'parent', name: 'P99', uid: 'uid_padre99', tags: ['rpt'] }, // no convocado
  ];
  const out = resolve(contacts, links, homePlayers);
  assert('Mix: 2 convocados reciben, 1 no convocado omitido', out.length === 2);
  const uids = out.map(o => o.parentUid).sort();
  assert('Mix: parentUids correctos', JSON.stringify(uids) === JSON.stringify(['uid_padre10', 'uid_padre7']));
}

// ── Emparejado por email cuando no hay uid (con link) ────────────────────
{
  const contacts = [
    { id: 'pe', type: 'parent', name: 'Por email', email: 'PADRE10@MAIL.COM', tags: ['rpt'] },
  ];
  const out = resolve(contacts, links, homePlayers);
  assert('Empareja por email (case-insensitive) y resuelve parentUid',
    out.length === 1 && out[0].parentUid === 'uid_padre10');
}

// ── CASO 1: Director/Coordinador SIEMPRE reciben (Regla 1 de _cGetStaff) ──
// Extraemos la función real _cGetStaff y la ejecutamos con Firestore stub
// (sin resultados), de modo que solo se ejerza la ruta de emailConfig.contacts.
async function testStaffAlwaysIncluded() {
  const staffSandbox = {
    window: {},
    console,
    JSON,
    Array,
    Map,
    // Firestore stubs: devuelven snapshots vacíos.
    cloudGet: async () => null,
  };
  // emailConfig con: director SIN tag rpt, coordinador SIN rpt, otro staff SIN rpt,
  // y un staff CON rpt. Reglas: director+coordinador SIEMPRE; staff solo con rpt.
  staffSandbox.emailConfig = {
    contacts: [
      { id: 's1', type: 'staff', uid: 'uid_dir',   role: 'director',     name: 'Dir',   tags: [] },
      { id: 's2', type: 'staff', uid: 'uid_coord', role: 'coordinator',  name: 'Coord', tags: [] },
      { id: 's3', type: 'staff', uid: 'uid_seg',   role: 'segundo',      name: 'Seg',   tags: [] },      // sin rpt -> NO
      { id: 's4', type: 'staff', uid: 'uid_seg2',  role: 'segundo',      name: 'Seg2',  tags: ['rpt'] },  // con rpt -> SI
      { id: 'p1', type: 'parent', uid: 'uid_padre10', name: 'Padre', tags: ['rpt'] },                     // padre -> nunca staff
    ],
  };
  vm.createContext(staffSandbox);
  vm.runInContext(extractFn('_cGetStaff'), staffSandbox);

  // fns con stubs que producen snapshots vacíos (forEach no itera).
  const emptySnap = { forEach() {}, size: 0 };
  const fns = {
    collection: () => ({}),
    getDocs: async () => emptySnap,
    query: () => ({}),
    where: () => ({}),
  };
  const staff = await staffSandbox._cGetStaff(/*db*/{}, 'club1', fns, ['director', 'coordinator']);
  const uids = staff.map(s => s.uid).sort();

  assert('CASO 1: director incluido (sin rpt)',     uids.includes('uid_dir'));
  assert('CASO 1: coordinador incluido (sin rpt)',  uids.includes('uid_coord'));
  assert('CASO 1: staff con rpt incluido',          uids.includes('uid_seg2'));
  assert('CASO 1: staff sin rpt NO incluido',       !uids.includes('uid_seg'));
  assert('CASO 1: padre nunca como staff',          !uids.includes('uid_padre10'));
}

// ── Bug 1: _cResolveClubId lee clubId de users/{uid} cuando me.clubId es null ──
async function testResolveClubId() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(extractFn('_cResolveClubId'), sb);
  const resolveClub = sb._cResolveClubId;

  // (a) me.clubId ya presente -> lo devuelve sin tocar Firestore.
  {
    const r = await resolveClub({}, { uid: 'u1', clubId: 'CLUB_X' }, null);
    assert('Bug 1: devuelve me.clubId si ya existe', r === 'CLUB_X');
  }

  // (b) me.clubId null pero users/{uid}.clubId presente.
  {
    const fns = {
      doc: () => ({}),
      getDoc: async () => ({ exists: () => true, data: () => ({ clubId: 'CLUB_FS' }) }),
    };
    sb.window._cronosCurrentUser = { uid: 'u2' };
    const r = await resolveClub({}, { uid: 'u2', clubId: null }, fns);
    assert('Bug 1: lee clubId de users/{uid}', r === 'CLUB_FS');
    assert('Bug 1: cachea en _cronosCurrentUser', sb.window._cronosCurrentUser.clubId === 'CLUB_FS');
  }

  // (c) me.clubId null y users/{uid} sin clubId pero con allRoles[].clubId.
  {
    const fns = {
      doc: () => ({}),
      getDoc: async () => ({ exists: () => true, data: () => ({ allRoles: [{ role: 'coach' }, { role: 'parent', clubId: 'CLUB_ROLE' }] }) }),
    };
    sb.window._cronosCurrentUser = { uid: 'u3' };
    const r = await resolveClub({}, { uid: 'u3', clubId: null }, fns);
    assert('Bug 1: fallback a allRoles[].clubId', r === 'CLUB_ROLE');
  }

  // (d) sin clubId en ningún sitio -> null (no empeora el comportamiento).
  {
    const fns = {
      doc: () => ({}),
      getDoc: async () => ({ exists: () => true, data: () => ({}) }),
    };
    sb.window._cronosCurrentUser = { uid: 'u4' };
    const r = await resolveClub({}, { uid: 'u4', clubId: null }, fns);
    assert('Bug 1: sin clubId en Firestore -> null', r === null);
  }
}

Promise.resolve()
  .then(testStaffAlwaysIncluded)
  .then(testResolveClubId)
  .then(() => {
    console.log('\n' + (failed === 0 ? 'OK' : 'FALLOS') + ': ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed === 0 ? 0 : 1);
  }).catch(err => {
    console.error('Error ejecutando tests async:', err);
    process.exit(1);
  });
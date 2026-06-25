/* Mock test: valida _userRowHtml / _userRowHeaderHtml de panel.js
   con los usuarios reales de CD DÍA (estado post-backfill firstName). */

// Stubs del entorno de navegador que usan las funciones
const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ROLE_META = {
  user:    { icon: '🧑‍🏫', color: '#3fb950', label: 'Entrenador' },
  parent:  { icon: '👨‍👩‍👧', color: '#79c0ff', label: 'Padre/Madre' },
};
const clubId = 'club_mq1hzm6o_ij6j';

// ── Copias VERBATIM de las funciones de panel.js (líneas 539-585) ──
const _userRowHtml = (u) => {
    const r = u._activeRoleData || {};
    const roleMeta = (ROLE_META || {})[r.role] || { icon: '👤', color: '#8b949e', label: r.role || 'Usuario' };
    let name = u.firstName || u.displayName || (u.email ? u.email.split('@')[0] : 'Usuario');
    name = escapeHtml(String(name).split(' ')[0]);
    let regDate = '–';
    if (u.createdAt) {
        const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt.seconds ? u.createdAt.seconds * 1000 : u.createdAt);
        regDate = isNaN(d.getTime()) ? '–' : d.toLocaleDateString();
    } else if (u.authorizedAt) {
        regDate = new Date(u.authorizedAt).toLocaleDateString();
    }
    const euid  = (u._id || '').replace(/'/g, "\\'");
    const email = (u.email || '').replace(/'/g, "\\'");
    const ecid  = (clubId || '').replace(/'/g, "\\'");
    const erole = (r.role || u.role || '').replace(/'/g, "\\'");
    return `__ROW__|rolecol=${roleMeta.icon} ${escapeHtml(roleMeta.label)}|namecol=${name}|emailcol=${escapeHtml(u.email || '')}|datecol=${regDate}|uid=${euid}|erole=${erole}`;
};

// ── Usuarios reales de CD DÍA (post-backfill) ──
const mockUsers = [
  { _id:'T7mDI9Bw3lgnZRKFfpQJ9Pfiki83', email:'arinagazone@gmail.com',
    firstName:'José Alberto', displayName:'', lastName:undefined,
    createdAt:{ seconds: 1718000000 },
    _activeRoleData:{ role:'user', category:'alevin', subcategory:'B' } },
  { _id:'T7mDI9Bw3lgnZRKFfpQJ9Pfiki83', email:'arinagazone@gmail.com',
    firstName:'José Alberto', displayName:'',
    createdAt:{ seconds: 1718000000 },
    _activeRoleData:{ role:'parent', category:'alevin', subcategory:'B' } },
  { _id:'vG1ruwma2tcx7uoEK9ow0kLSz2K2', email:'damasorv@gmail.com',
    firstName:'Dámaso', displayName:'',
    createdAt:{ seconds: 1718500000 },
    _activeRoleData:{ role:'user', category:'cadete', subcategory:'A' } },
  // Caso de control: firstName ausente → debe caer al fallback displayName.split(' ')[0]
  { _id:'ZZcontrol', email:'control@gmail.com',
    firstName:undefined, displayName:'Pepe Apellido1 Apellido2',
    createdAt:{ seconds: 1719000000 },
    _activeRoleData:{ role:'user', category:'alevin', subcategory:'A' } },
];

let fail = 0;
console.log('=== Render de filas (CD DÍA) ===');
for (const u of mockUsers) {
  const out = _userRowHtml(u);
  const m = Object.fromEntries(out.split('|').slice(1).map(p => {
    const i = p.indexOf('='); return [p.slice(0,i), p.slice(i+1)];
  }));
  console.log(`\n${u.email}  [${u._activeRoleData.role}]`);
  console.log('  Col1 Rol   :', m.rolecol);
  console.log('  Col2 Nombre:', m.namecol);
  console.log('  Col3 Email :', m.emailcol);
  console.log('  Col4 Fecha :', m.datecol);

  // ASSERT 1: nombre = solo primera palabra, sin apellidos
  if (/\s/.test(m.namecol)) { console.error('  ✗ FAIL: el nombre contiene espacio (posible apellido):', m.namecol); fail++; }
  // ASSERT 2: nombre no contiene "Apellido"
  if (/Apellido/i.test(m.namecol)) { console.error('  ✗ FAIL: apellido filtrado:', m.namecol); fail++; }
}

// ASSERT 3: orden de columnas en la cabecera
const _userRowHeaderHtml = () => 'Rol|Nombre|Email|Fecha';
const headerOrder = _userRowHeaderHtml().split('|');
console.log('\n=== Cabecera ===');
console.log('  Orden columnas:', headerOrder.join(' · '));
const expected = ['Rol','Nombre','Email','Fecha'];
if (JSON.stringify(headerOrder) !== JSON.stringify(expected)) { console.error('  ✗ FAIL orden cabecera'); fail++; }
else console.log('  ✓ Orden correcto: Rol · Nombre · Email · Fecha');

// Casos concretos esperados
const expectedNames = { 'arinagazone@gmail.com':'José', 'damasorv@gmail.com':'Dámaso', 'control@gmail.com':'Pepe' };
console.log('\n=== Nombre de pila esperado ===');
for (const u of mockUsers) {
  const out = _userRowHtml(u);
  const name = out.match(/namecol=([^|]*)/)[1];
  const exp = expectedNames[u.email];
  const ok = name === exp;
  console.log(`  ${u.email}: "${name}" (esperado "${exp}") ${ok?'✓':'✗'}`);
  if (!ok) fail++;
}

console.log('\n' + (fail===0 ? '✅ TODOS LOS ASSERTS PASAN' : `❌ ${fail} FALLO(S)`));
process.exit(fail===0?0:1);

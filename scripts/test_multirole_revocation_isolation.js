// test_multirole_revocation_isolation.js
// Verifica que al revocar un solo rol (ej: Entrenador) en una persona con múltiples roles
// (ej: Administrador + Coordinador + Entrenador), NO se desautorice la cuenta completa.

const fs = require('fs');
const path = require('path');

let testCount = 0;
let passCount = 0;
let failCount = 0;

function ok(name, cond, details = '') {
    testCount++;
    if (cond) {
        passCount++;
        console.log(`  PASS  ${name}`);
    } else {
        failCount++;
        console.error(`  FAIL  ${name}${details ? ` -> ${details}` : ''}`);
    }
}

console.log('=== TEST: Aislamiento de Revocación de Roles en Usuarios Multi-Rol ===\n');

const panelPath = path.join(__dirname, '../js/admin/club/panel.js');
const panelContent = fs.readFileSync(panelPath, 'utf8');

ok('1a · panel.js condiciona la desautorización de la raíz a revocaTodosLosRoles',
   panelContent.includes('if (revocaTodosLosRoles) {') &&
   !panelContent.includes('if (revocaTodosLosRoles || revocaRolRaiz) {'));

// Simulación de lógica de caSetUserStatus
function simularRevocacion(allRoles, targetRole, cid, plaza) {
    const _esDeEsteClub = (r) => String(r.clubId || '') === String(cid || '') || String(r.clubId || '') === '';
    const _plazaCat = (plaza && plaza.category || '').toLowerCase();
    const _plazaSub = (plaza && plaza.subcategory || '').toUpperCase();
    const _acotaPorPlaza = !!(_plazaCat && _plazaSub);
    const _esEstaPlaza = (r) => {
        if (!_acotaPorPlaza) return true;
        return String(r.category || '').toLowerCase() === _plazaCat &&
               String(r.subcategory || '').toUpperCase() === _plazaSub;
    };

    const rolesRemovidos = allRoles.filter(r => _esDeEsteClub(r) && (!targetRole || r.role === targetRole) && _esEstaPlaza(r));
    const rolesRestantes = allRoles.filter(r => !(_esDeEsteClub(r) && (!targetRole || r.role === targetRole) && _esEstaPlaza(r)));
    const rolesRestantesVivos = rolesRestantes.filter(r => r.status !== 'removed' && r.isAuthorized !== false);
    const revocaTodosLosRoles = rolesRestantesVivos.length === 0;

    return { rolesRemovidos, rolesRestantesVivos, revocaTodosLosRoles };
}

// Escenario A: Usuario con 3 roles (club_admin, coordinator, user)
const userMulti = [
    { role: 'club_admin', clubId: 'ESTRELLA_CF', status: 'active', isAuthorized: true },
    { role: 'coordinator', clubId: 'ESTRELLA_CF', status: 'active', isAuthorized: true },
    { role: 'user', clubId: 'ESTRELLA_CF', category: 'Juvenil', subcategory: 'B', status: 'active', isAuthorized: true }
];

const resA = simularRevocacion(userMulti, 'user', 'ESTRELLA_CF', { category: 'Juvenil', subcategory: 'B' });
ok('2a · Revocar rol user en usuario multi-rol coge únicamente la plaza de entrenador', resA.rolesRemovidos.length === 1 && resA.rolesRemovidos[0].role === 'user');
ok('2b · Conserva los 2 roles restantes vivos (club_admin y coordinator)', resA.rolesRestantesVivos.length === 2);
ok('2c · revocaTodosLosRoles es FALSE (la cuenta raíz permanece activa)', resA.revocaTodosLosRoles === false);

// Escenario B: Usuario con 1 solo rol (user)
const userSingle = [
    { role: 'user', clubId: 'ESTRELLA_CF', category: 'Juvenil', subcategory: 'B', status: 'active', isAuthorized: true }
];

const resB = simularRevocacion(userSingle, 'user', 'ESTRELLA_CF', { category: 'Juvenil', subcategory: 'B' });
ok('3a · Revocar el único rol de un usuario deja 0 roles vivos restantes', resB.rolesRestantesVivos.length === 0);
ok('3b · revocaTodosLosRoles es TRUE (se desautoriza la raíz y se elimina la cuenta)', resB.revocaTodosLosRoles === true);

console.log(`\n------------------------------------------------------------`);
console.log(`Resultado: ${passCount}/${testCount} pruebas superadas.`);

process.exit(failCount > 0 ? 1 : 0);

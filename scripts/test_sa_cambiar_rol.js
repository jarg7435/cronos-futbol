// ─────────────────────────────────────────────────────────────────────────
// test_sa_cambiar_rol.js
// El boton "Rol" del panel SuperAdmin devolvia al usuario a la PANTALLA DE
// LOGIN en vez de abrir el selector de roles.
//
// CAUSA: js/admin/superadmin/extras.js es un SCRIPT CLASICO y comprobaba
// `typeof _showMultiRolePicker === 'function'`. Esa funcion vive en el ambito
// de un MODULO ES (js/services/auth.js) y el ambito de modulo NO cuelga de
// window, asi que el typeof era SIEMPRE 'undefined'. La rama nunca corria y
// caia al else, que pone window._cronosCurrentUser = null y salta a
// 'auth-screen'.
//
// POR QUE NO SE RESUCITO _showMultiRolePicker: al elegir un rol, esa funcion
// reescribe window._cronosCurrentUser con un objeto MINIMO (uid, email, role,
// clubId, clubName, firstName, lastName, displayName) que PIERDE allRoles,
// isAuthorized y status. El showRoleSelection posterior no encuentra ningun
// rol confirmado y no pinta ningun panel: la pantalla se queda EN BLANCO.
// Comprobado ejecutando el codigo real de role-launch.js con ese objeto.
//
// ARREGLO: saCambiarRol delega en saGoBackToRoles (superadmin.panel.js), que
// ya cierra los paneles abiertos, restaura el body y abre el selector de roles
// real — el mismo que se usa en cada login.
//
// La clase de fallo (script clasico -> nombre de ambito de modulo) la vigila
// ademas, para todo el repositorio, la asercion 3c de
// scripts/test_extracted_modules_load.js.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EXTRAS = path.join(ROOT, 'js', 'admin', 'superadmin', 'extras.js');
const PANEL = path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Boton "Rol" del panel SuperAdmin ──\n');

const extrasSrc = fs.readFileSync(EXTRAS, 'utf8');
const panelSrc = fs.readFileSync(PANEL, 'utf8');

console.log('── PARTE 1 · el codigo ya no depende de nombres invisibles ──');
ok('1a · ⚠️ saCambiarRol ya NO comprueba typeof _showMultiRolePicker',
    !/typeof\s+_showMultiRolePicker/.test(extrasSrc));
ok('1b · ni deja al usuario sin sesion saltando a auth-screen',
    !/_cronosCurrentUser\s*=\s*null;\s*[\r\n\s]*showScreen\('auth-screen'\)/.test(extrasSrc));
ok('1c · delega en saGoBackToRoles, que es lo que el boton promete',
    /typeof window\.saGoBackToRoles === 'function'/.test(extrasSrc)
    && /window\.saGoBackToRoles\(\);/.test(extrasSrc));
ok('1d · conserva una reserva por el alias que SI esta publicado en window',
    /typeof window\.showRoleSelector === 'function'/.test(extrasSrc));
ok('1e · saGoBackToRoles tampoco usa ya el nombre de ambito de modulo',
    !/typeof showRoleSelection === 'function'/.test(panelSrc)
    && /typeof window\.showRoleSelector === 'function'/.test(panelSrc));

console.log('\n── PARTE 2 · ejecucion real de saCambiarRol ──');
function run({ me, conGoBack = true, conAlias = true }) {
    const llamadas = [];
    const els = {};
    const mk = (id) => ({ id, style: {}, dataset: {},
        querySelector: () => null, querySelectorAll: () => [],
        addEventListener() {}, appendChild() {}, insertBefore() {}, remove() {} });
    const sb = {
        _cronosCurrentUser: me,
        document: {
            getElementById: (id) => (els[id] = els[id] || mk(id)),
            querySelector: () => null, querySelectorAll: () => [],
            createElement: () => mk('n'), addEventListener() {}, body: mk('body'),
        },
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON,
        parseInt, isNaN, RegExp, Error,
        setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
        location: { reload: () => llamadas.push('reload') },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        alert: () => {}, confirm: () => false,
        // extras.js monta un MutationObserver al final de su IIFE para inyectar
        // los botones del header; sin este stub el modulo no llega a cargarse.
        MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    };
    vm.createContext(sb);
    sb.window = sb; sb.globalThis = sb;
    if (conGoBack) sb.saGoBackToRoles = () => llamadas.push('saGoBackToRoles');
    if (conAlias) sb.showRoleSelector = () => llamadas.push('showRoleSelector');
    vm.runInContext(extrasSrc, sb, { filename: 'extras.js' });
    sb.saCambiarRol();
    return { llamadas, sb, els };
}
{
    const me = { uid: 'sa1', email: 'sa@x.com', role: 'superadmin',
                 allRoles: [{ role: 'superadmin' }, { role: 'director', clubId: 'C1' }] };
    const t = run({ me });
    ok('2a · con sesion multi-rol abre el selector de roles',
        t.llamadas.join() === 'saGoBackToRoles', t.llamadas);
    ok('2b · ⚠️ y NO borra la sesion en memoria (era lo que rompia el flujo)',
        t.sb._cronosCurrentUser === me);
    ok('2c · no recarga la pagina', !t.llamadas.includes('reload'));
}
{
    // Un solo rol: el boton sigue llevando al selector, no al login.
    const t = run({ me: { uid: 'u1', email: 'u@x.com', role: 'director', allRoles: [{ role: 'director' }] } });
    ok('2d · con un solo rol tambien abre el selector, no la pantalla de login',
        t.llamadas.join() === 'saGoBackToRoles', t.llamadas);
}
{
    const t = run({ me: null });
    ok('2e · sin sesion recarga (comportamiento previo, intacto)',
        t.llamadas.join() === 'reload', t.llamadas);
}
{
    // Si saGoBackToRoles no estuviera cargado, la reserva por el alias.
    const t = run({ me: { uid: 'u1', email: 'u@x.com', role: 'director' }, conGoBack: false });
    ok('2f · sin saGoBackToRoles cae al alias window.showRoleSelector',
        t.llamadas.join() === 'showRoleSelector', t.llamadas);
}
{
    const t = run({ me: { uid: 'u1', email: 'u@x.com', role: 'director' }, conGoBack: false, conAlias: false });
    ok('2g · sin ninguno de los dos, recarga en vez de dejar la pantalla colgada',
        t.llamadas.join() === 'reload', t.llamadas);
}
{
    const t = run({ me: { uid: 'sa1', email: 'sa@x.com', role: 'superadmin' } });
    ok('2h · cierra la modal raiz del SuperAdmin antes de cambiar',
        t.els['sa-root-modal'] && t.els['sa-root-modal'].style.display === 'none');
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────
//  test_cambio_contrasena_todos.js  ·  🔒 v763 (implementar.txt, 2026-09-24)
//
//  El candado de «Cambiar contraseña» sólo estaba en la pantalla del
//  entrenador. Encargo: para TODOS los roles —administrador de club,
//  administrador individual, coordinador, director, entrenador y familia— y
//  un mecanismo de emergencia para el SuperAdmin.
//
//  Se vigila:
//   1. Cada cabecera pinta EL MISMO botón (cronosBotonContrasena), no una
//      copia propia; el entrenador conserva el suyo (abre el mismo modal).
//   2. El botón, ejecutado, abre openChangePasswordModal.
//   3. El modal, ejecutado con un DOM simulado: aviso de emergencia SÓLO para
//      el SuperAdmin; reautentica ANTES de cambiar; el aviso final dice lo
//      medido sobre las otras sesiones (se cierran en < 1 h), no «al instante».
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PWD = leer('js/services/auth/password.js');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 300)); }
};

console.log('\n══ 🔒 Cambio de contraseña para todos los roles ══');

console.log('\n1) Cada panel lo tiene en su cabecera, junto a «Salir»');
const PANELES = [
    ['Administrador de Club', 'js/admin/club/panel.js', '🚪 SALIR</button>'],
    ['Administrador Individual', 'js/admin/individual/panel.js', '🚪 SALIR</button>'],
    ['Director / Coordinador (Panel de Dirección)', 'js/coach/reports/club-reports.js', '⏻ Salir</button>'],
    ['Familiar / Jugador', 'js/parent/panel.js', '⏻ Salir</button>'],
    ['SuperAdmin', 'js/admin/superadmin/superadmin.panel.js', '⏻ Salir</button>'],
];
for (const [rol, f, salir] of PANELES) {
    const s = leer(f);
    const iBtn = s.indexOf('window.cronosBotonContrasena(');
    const iSalir = s.indexOf(salir);
    ok('1a · ' + rol + ': usa el botón común y va ANTES de «Salir» (misma cabecera)',
       iBtn !== -1 && iSalir !== -1 && iBtn < iSalir && iSalir - iBtn < 1500, { iBtn, iSalir });
}
ok('1b · Entrenador: conserva su botón, que abre el MISMO modal',
   /openChangePasswordModal\(\)/.test(leer('js/core/setup-modal.js')));

// ── Sandbox con un DOM mínimo ───────────────────────────────────────────
function montar({ rol, reauthFalla } = {}) {
    const creados = [], llamadas = [];
    const porId = {};
    const el = (id) => (porId[id] = porId[id] || { id, value: '', style: {}, disabled: false, innerHTML: '',
        addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, remove() {} });
    const sb = { console: { log() {}, warn() {} }, setTimeout: () => 0 };
    sb.window = sb;
    sb.document = {
        createElement: () => { const o = { style: {}, innerHTML: '', addEventListener() {}, remove() {},
            querySelector: () => null, querySelectorAll: () => [] }; return o; },
        body: { appendChild: (o) => { creados.push(o); if (o.id) porId[o.id] = o; } },
        getElementById: (id) => el(id),
        addEventListener() {}, removeEventListener() {},
    };
    sb.showToast = () => {};
    sb._cronosCurrentUser = { role: rol || 'user' };
    const user = { email: 'yo@ejemplo.com', providerData: [{ providerId: 'password' }] };
    sb._cronos_auth = {
        auth: { currentUser: user },
        EmailAuthProvider: { credential: (e, p) => ({ e, p }) },
        reauthenticateWithCredential: async (u, c) => { llamadas.push('reauth:' + c.p); if (reauthFalla) { const e = new Error('x'); e.code = 'auth/invalid-credential'; throw e; } },
        updatePassword: async (u, p) => { llamadas.push('update:' + p); },
    };
    vm.createContext(sb);
    vm.runInContext(PWD, sb);
    return { sb, creados, llamadas, el };
}

console.log('\n2) El botón común, ejecutado');
{
    const { sb } = montar();
    const html = sb.cronosBotonContrasena();
    ok('2a · pinta «🔒 Contraseña» y abre openChangePasswordModal',
       /🔒 Contraseña/.test(html) && /onclick="if\(typeof openChangePasswordModal==='function'\)openChangePasswordModal\(\);"/.test(html), html);
    ok('2b · admite estilo propio de cada cabecera sin cambiar lo que hace',
       /padding:9px/.test(sb.cronosBotonContrasena('padding:9px;')) && /openChangePasswordModal/.test(sb.cronosBotonContrasena('padding:9px;')));
}

console.log('\n3) El modal, ejecutado');
{
    const sa = montar({ rol: 'superadmin' });
    sa.sb.openChangePasswordModal();
    const htmlSA = (sa.creados[0] || {}).innerHTML || '';
    ok('3a · 🔑 SuperAdmin: ve el aviso de emergencia', /Cuenta de SuperAdmin/.test(htmlSA));
    ok('3b · y el enlace por correo por si no recuerda la actual', /cronosResetDesdePerfil/.test(htmlSA));
    const fam = montar({ rol: 'parent' });
    fam.sb.openChangePasswordModal();
    ok('3c · otro rol (familia): mismo modal, SIN el aviso del SuperAdmin',
       /Cambiar contraseña/.test((fam.creados[0] || {}).innerHTML || '') && !/Cuenta de SuperAdmin/.test((fam.creados[0] || {}).innerHTML || ''));
}
(async () => {
    const t = montar({ rol: 'superadmin' });
    t.el('pwd-actual').value = 'Vieja123*'; t.el('pwd-nueva').value = 'Nueva456*'; t.el('pwd-nueva2').value = 'Nueva456*';
    await t.sb.cronosSubmitPasswordChange();
    ok('3d · 🔑 reautentica con la ACTUAL y sólo después cambia',
       t.llamadas.join(',') === 'reauth:Vieja123*,update:Nueva456*', t.llamadas);
    const msg = t.el('cronos-pwd-modal-msg').innerHTML;
    ok('3e · el aviso final dice lo medido: otras sesiones en menos de una hora', /menos de una hora/.test(msg), msg);
    ok('3f · y no promete lo que no pasa («al instante»)', !/al instante|inmediatamente/i.test(msg));

    const f = montar({ rol: 'director', reauthFalla: true });
    f.el('pwd-actual').value = 'Mala000*'; f.el('pwd-nueva').value = 'Nueva456*'; f.el('pwd-nueva2').value = 'Nueva456*';
    await f.sb.cronosSubmitPasswordChange();
    ok('3g · 🔑 con la actual MAL, no se cambia nada', f.llamadas.indexOf('update:Nueva456*') === -1, f.llamadas);

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

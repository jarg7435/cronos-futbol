// ─────────────────────────────────────────────────────────────────────────
// test_password_recovery.js · recuperar y cambiar la contraseña (v451)
//
// Lo pedido en implementar.txt: "¿Has olvidado tu contraseña?" en el login con
// sendPasswordResetEmail, y cambio desde el perfil con updatePassword,
// "gestionando correctamente los avisos de seguridad si la sesión requiere
// reautenticación".
//
// Este guard NO mira el texto del código: carga js/services/auth/password.js en
// un sandbox con un DOM y un Firebase Auth de mentira, PULSA los botones y
// comprueba qué se llama y con qué. Un censo de regex aquí no valdría: lo que
// hay que defender es el COMPORTAMIENTO ante los errores, que es justo donde
// están las dos decisiones de seguridad.
//
// LO QUE PROTEGE:
//
//  A · 🔑 NO SE REVELA SI UN CORREO ESTÁ REGISTRADO. `sendPasswordResetEmail`
//      lanza `auth/user-not-found` cuando la cuenta no existe. Si eso se
//      contara, el formulario sería un comprobador de altas: cualquiera podría
//      averiguar qué familias están en el club escribiendo correos. La
//      respuesta tiene que ser IDÉNTICA exista o no la cuenta.
//
//  B · 🔑 SE REAUTENTICA SIEMPRE ANTES DE CAMBIARLA. `updatePassword` sólo
//      exige sesión RECIENTE: en una sesión recién iniciada dejaría cambiar la
//      contraseña SIN pedir la actual, así que un móvil desbloqueado encima de
//      la mesa bastaría para quedarse con la cuenta. Y el orden importa:
//      reautenticar DESPUÉS de actualizar no protege de nada.
//
//  C · LA POLÍTICA DE CONTRASEÑA ES LA MISMA QUE LA DEL ALTA. Si aquí se
//      aceptara una más floja, cambiar la contraseña sería la puerta de atrás
//      para saltarse la política del registro.
//
//  D · LOS PUNTOS DE ENTRADA EXISTEN Y ESTÁN DONDE TIENEN QUE ESTAR. El enlace
//      del login va DENTRO de #login-pwd-section, que switchTab ya oculta en
//      modo registro; si saliera de ahí, aparecería al registrarse.
//
//  E · EL FICHERO SE CARGA Y SE PRECACHEA. Es un script clásico nuevo: sin el
//      <script> en index.html no existe, y sin estar en ASSETS del service
//      worker no está disponible sin cobertura (ver v447).
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const PWD_SRC  = read('js/services/auth/password.js');
const INDEX    = read('index.html');
const SW       = read('sw.js');
const INIT     = sinCom(read('js/services/firebase-init.js'));
const SETUP    = sinCom(read('js/core/setup-modal.js'));

console.log('── recuperar y cambiar la contraseña (v451) ──\n');

// ═══════════ El banco de pruebas ═══════════
// DOM mínimo: sólo lo que el módulo toca de verdad.
function montar(opciones) {
    opciones = opciones || {};
    const registro = { reset: [], reauth: [], update: [], toasts: [] };

    function nuevoNodo(tag) {
        const n = {
            tag, id: '', innerHTML: '', value: '', style: { cssText: '' },
            children: [], _listeners: {},
            appendChild(c) { this.children.push(c); c._padre = this; },
            remove() { if (this._padre) this._padre.children = this._padre.children.filter(x => x !== this); },
            addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
            removeEventListener() {},
            focus() {},
            setAttribute() {}, getAttribute() { return null; },
            // Busca por id dentro del innerHTML ya pintado: el módulo escribe
            // HTML como cadena, así que se emula la búsqueda por id.
            querySelector(sel) { return _buscarEnHTML(this.innerHTML, sel); },
            querySelectorAll() { return []; },
        };
        return n;
    }

    // Índice de los <input id="..."> del HTML pintado, para poder "escribir".
    const campos = new Map();
    function _indexar(html) {
        const re = /id="([^"]+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            if (!campos.has(m[1])) {
                const nodo = nuevoNodo('input');
                nodo.id = m[1];
                nodo.value = (opciones.valores && opciones.valores[m[1]]) || '';
                campos.set(m[1], nodo);
            }
        }
    }
    function _buscarEnHTML() { return null; }

    const body = nuevoNodo('body');
    const bodyAppend = body.appendChild.bind(body);
    body.appendChild = (c) => { bodyAppend(c); _indexar(c.innerHTML); };

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Math, JSON, String, Object, Array, RegExp, Map, Set, Promise,
        setTimeout: (fn) => { if (opciones.correTimeouts) fn(); return 0; },
        document: {
            body,
            createElement: nuevoNodo,
            getElementById: (id) => campos.get(id) || null,
            addEventListener() {}, removeEventListener() {},
        },
        escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
        showToast: (m) => registro.toasts.push(m),
        validatePasswordStrength: (p) => {
            const r = { length: p.length >= 8, uppercase: /[A-Z]/.test(p), lowercase: /[a-z]/.test(p),
                        number: /[0-9]/.test(p), special: /[!@#$%^&*]/.test(p) };
            const score = Object.values(r).filter(Boolean).length;
            return { valid: score === 5, score, requirements: r };
        },
        setupPasswordValidator: () => {},
    };

    // ── Firebase Auth de mentira ──────────────────────────────────
    const user = opciones.sinSesion ? null : {
        email: opciones.email || 'entrenador@club.com',
        providerData: opciones.providerData || [{ providerId: 'password' }],
    };
    sb._cronos_auth = {
        auth: { currentUser: user },
        sendPasswordResetEmail: async (auth, email) => {
            registro.reset.push(email);
            if (opciones.errorReset) { const e = new Error('x'); e.code = opciones.errorReset; throw e; }
        },
        EmailAuthProvider: { credential: (email, pwd) => ({ email, pwd }) },
        reauthenticateWithCredential: async (u, cred) => {
            registro.reauth.push({ email: cred.email, pwd: cred.pwd, orden: registro.reauth.length + registro.update.length });
            if (opciones.errorReauth) { const e = new Error('x'); e.code = opciones.errorReauth; throw e; }
        },
        updatePassword: async (u, nueva) => {
            registro.update.push({ nueva, orden: registro.reauth.length + registro.update.length });
            if (opciones.errorUpdate) { const e = new Error('x'); e.code = opciones.errorUpdate; throw e; }
        },
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(PWD_SRC, sb);

    return { sb, registro, campos,
             escribir: (id, v) => { const c = campos.get(id); if (c) c.value = v; },
             mensaje: () => { const m = campos.get('cronos-pwd-modal-msg'); return m ? m.innerHTML : ''; } };
}

// ═══════════ PARTE 1 · [A] recuperación sin filtrar quién existe ═══════════
console.log('── PARTE 1 · [A] "¿Has olvidado tu contraseña?" ──');
{
    const t = montar({});
    ok('1a · expone openForgotPasswordModal', typeof t.sb.window.openForgotPasswordModal === 'function');
    ok('1b · expone el envío y el cierre',
       typeof t.sb.window.cronosSendPasswordReset === 'function' &&
       typeof t.sb.window.closePasswordModal === 'function');

    t.sb.window.openForgotPasswordModal();
    ok('1c · la ventana pinta el campo de correo', t.campos.has('pwd-reset-email'));
}

{
    // Cuenta que SÍ existe.
    const t = montar({});
    t.sb.window.openForgotPasswordModal();
    t.escribir('pwd-reset-email', 'padre@club.com');
    return t.sb.window.cronosSendPasswordReset().then(() => {
        ok('1d · llama a sendPasswordResetEmail con el correo escrito',
           t.registro.reset.length === 1 && t.registro.reset[0] === 'padre@club.com',
           JSON.stringify(t.registro.reset));
        const msgExiste = t.mensaje();
        ok('1e · confirma el envío', /✅/.test(msgExiste), msgExiste);

        // Cuenta que NO existe: Firebase lanza auth/user-not-found.
        const t2 = montar({ errorReset: 'auth/user-not-found' });
        t2.sb.window.openForgotPasswordModal();
        t2.escribir('pwd-reset-email', 'noexiste@club.com');
        return t2.sb.window.cronosSendPasswordReset().then(() => {
            const msgNoExiste = t2.mensaje();
            ok('1f · 🔑 [A] una cuenta INEXISTENTE responde lo MISMO',
               msgNoExiste.replace('noexiste@club.com', 'X') === msgExiste.replace('padre@club.com', 'X'),
               'existe: ' + msgExiste + '\n       no existe: ' + msgNoExiste);
            ok('1g · 🔑 [A] y no se le escapa ningún "no encontrado"',
               !/no existe|no encontrad|not.?found|no está registrad/i.test(msgNoExiste), msgNoExiste);
            resto();
        });
    });
}

function resto() {

// Errores que SÍ hay que contar (no filtran nada).
{
    const t = montar({ errorReset: 'auth/too-many-requests' });
    t.sb.window.openForgotPasswordModal();
    t.escribir('pwd-reset-email', 'padre@club.com');
    t.sb.window.cronosSendPasswordReset();
    // La promesa se resuelve en el mismo turno: se comprueba tras un tick.
    setImmediate(() => {
        ok('1h · un exceso de intentos SÍ se avisa',
           /Demasiados intentos/.test(t.mensaje()), t.mensaje());

        const t2 = montar({});
        t2.sb.window.openForgotPasswordModal();
        t2.escribir('pwd-reset-email', 'esto-no-es-un-correo');
        t2.sb.window.cronosSendPasswordReset();
        setImmediate(() => {
            ok('1i · un correo mal escrito se rechaza ANTES de llamar a Firebase',
               t2.registro.reset.length === 0 && /formato/.test(t2.mensaje()),
               t2.mensaje());
            parte2();
        });
    });
}
}

// ═══════════ PARTE 2 · [B y C] cambio con reautenticación ═══════════
function parte2() {
console.log('\n── PARTE 2 · [B y C] cambiar la contraseña ──');

const VALIDA = 'NuevaClave1!';

{
    const t = montar({});
    ok('2a · expone openChangePasswordModal', typeof t.sb.window.openChangePasswordModal === 'function');

    t.sb.window.openChangePasswordModal();
    ok('2b · pide la contraseña ACTUAL, la nueva y su repetición',
       t.campos.has('pwd-actual') && t.campos.has('pwd-nueva') && t.campos.has('pwd-nueva2'));
}

{
    // Camino feliz.
    const t = montar({ correTimeouts: false });
    t.sb.window.openChangePasswordModal();
    t.escribir('pwd-actual', 'ClaveVieja1!');
    t.escribir('pwd-nueva',  VALIDA);
    t.escribir('pwd-nueva2', VALIDA);
    t.sb.window.cronosSubmitPasswordChange().then(() => {
        ok('2c · 🔑 [B] REAUTENTICA con la contraseña actual',
           t.registro.reauth.length === 1 && t.registro.reauth[0].pwd === 'ClaveVieja1!',
           JSON.stringify(t.registro.reauth));
        ok('2d · y luego actualiza con la nueva',
           t.registro.update.length === 1 && t.registro.update[0].nueva === VALIDA,
           JSON.stringify(t.registro.update));
        // ⚠️ Sin las guardas, si la reautenticación desaparece esto lanza un
        // TypeError sobre `undefined.orden`, la cadena de promesas se corta y
        // las comprobaciones siguientes NO LLEGAN A EJECUTARSE — el guard
        // moría en vez de señalar. Lo destapó el red-check.
        ok('2e · 🔑 [B] EL ORDEN: reautenticar va ANTES de actualizar',
           !!t.registro.reauth[0] && !!t.registro.update[0] &&
           t.registro.reauth[0].orden < t.registro.update[0].orden,
           'reautenticar después no protege de nada · reauth=' +
           JSON.stringify(t.registro.reauth) + ' update=' + JSON.stringify(t.registro.update));
        ok('2f · confirma al usuario', /✅/.test(t.mensaje()) && t.registro.toasts.length === 1);
        parte2b();
    });
}
}

function parte2b() {
    const VALIDA = 'NuevaClave1!';

    // La contraseña actual es incorrecta → NO se toca la contraseña.
    const t = montar({ errorReauth: 'auth/wrong-password' });
    t.sb.window.openChangePasswordModal();
    t.escribir('pwd-actual', 'meLaInvento');
    t.escribir('pwd-nueva',  VALIDA);
    t.escribir('pwd-nueva2', VALIDA);
    t.sb.window.cronosSubmitPasswordChange().then(() => {
        ok('2g · 🔑 [B] con la actual incorrecta NO se actualiza nada',
           t.registro.update.length === 0,
           'se llamó a updatePassword ' + t.registro.update.length + ' vez/veces');
        ok('2h · y se explica en castellano, no con el código de Firebase',
           /contraseña actual no es correcta/i.test(t.mensaje()) && !/auth\//.test(t.mensaje()),
           t.mensaje());

        // requires-recent-login: no debería llegar (reautenticamos), pero si
        // llega hay que decir algo con sentido.
        const t2 = montar({ errorUpdate: 'auth/requires-recent-login' });
        t2.sb.window.openChangePasswordModal();
        t2.escribir('pwd-actual', 'ClaveVieja1!');
        t2.escribir('pwd-nueva',  VALIDA);
        t2.escribir('pwd-nueva2', VALIDA);
        t2.sb.window.cronosSubmitPasswordChange().then(() => {
            ok('2i · el aviso de "sesión no reciente" está contemplado',
               /vuelve a iniciar sesión/i.test(t2.mensaje()), t2.mensaje());
            parte2c();
        });
    });
}

function parte2c() {
    const casos = [
        ['2j · las dos nuevas deben coincidir', 'ClaveVieja1!', 'NuevaClave1!', 'OtraClave1!', /no coinciden/i],
        ['2k · [C] la nueva cumple la MISMA política que el alta', 'ClaveVieja1!', 'floja', 'floja', /requisitos/i],
        ['2l · la nueva no puede ser igual que la actual', 'NuevaClave1!', 'NuevaClave1!', 'NuevaClave1!', /distinta/i],
        ['2m · no se envía con campos vacíos', '', '', '', /Rellena/i],
    ];
    let i = 0;
    (function siguiente() {
        if (i >= casos.length) { parte3(); return; }
        const [etq, act, n1, n2, re] = casos[i++];
        const t = montar({});
        t.sb.window.openChangePasswordModal();
        t.escribir('pwd-actual', act);
        t.escribir('pwd-nueva', n1);
        t.escribir('pwd-nueva2', n2);
        Promise.resolve(t.sb.window.cronosSubmitPasswordChange()).then(() => {
            ok(etq, re.test(t.mensaje()) && t.registro.update.length === 0,
               t.mensaje() + ' · updates=' + t.registro.update.length);
            siguiente();
        });
    })();
}

// ═══════════ PARTE 3 · sesión, entradas y carga ═══════════
function parte3() {
console.log('\n── PARTE 3 · [D y E] sesión, puntos de entrada y carga ──');
{
    // ⚠️ En try/catch a propósito: si la guarda de sesión desapareciera, el
    // código seguiría hasta `user.email` y LANZARÍA. Sin capturarlo, el guard
    // se caía entero sin señalar nada — un guard que muere no informa. Ahora
    // una excepción cuenta como fallo de esta aserción, que es lo que es.
    const t = montar({ sinSesion: true });
    let reventó = false;
    try { t.sb.window.openChangePasswordModal(); }
    catch (e) { reventó = true; }
    ok('3a · sin sesión no se abre la ventana de cambio',
       !reventó && !t.campos.has('pwd-actual') && t.registro.toasts.length === 1,
       reventó ? 'lanzó una excepción: falta la guarda de sesión'
               : JSON.stringify(t.registro.toasts));
}

{
    const S = sinCom(INDEX);
    // [D] El enlace del login, DENTRO de la sección que switchTab oculta.
    const ini = S.indexOf('id="login-pwd-section"');
    const fin = S.indexOf('id="register-pwd-section"');
    ok('3b · [D] el enlace de recuperación está en el login',
       /openForgotPasswordModal\(\)/.test(S));
    ok('3c · [D] 🔑 y DENTRO de #login-pwd-section (se oculta solo al registrarse)',
       ini !== -1 && fin > ini &&
       S.slice(ini, fin).indexOf('openForgotPasswordModal') !== -1,
       'fuera de esa sección aparecería también en el formulario de registro');

    ok('3d · [D] "Cambiar contraseña" está en el landing de roles (lo ve todo rol)',
       /openChangePasswordModal\(\)/.test(S));
    ok('3e · [D] y también en la cabecera del entrenador',
       /openChangePasswordModal\(\)/.test(SETUP));

    // [E] Carga y precache.
    ok('3f · [E] index.html enlaza el script nuevo',
       /<script src="js\/services\/auth\/password\.js/.test(INDEX));
    ok('3g · [E] va DESPUÉS de auth-improvements.js (reutiliza su validador)',
       INDEX.indexOf('auth-improvements.js') < INDEX.indexOf('auth/password.js'));
    ok('3h · [E] 🔑 el service worker lo precachea',
       /'\.\/js\/services\/auth\/password\.js'/.test(SW),
       'sin esto no está disponible sin cobertura (ver v447)');

    // Las funciones de Firebase, publicadas para un script clásico.
    ['sendPasswordResetEmail', 'updatePassword', 'reauthenticateWithCredential', 'EmailAuthProvider']
        .forEach((f) => {
            ok('3i · firebase-init publica ' + f,
               new RegExp(f).test(INIT.slice(INIT.indexOf('window._cronos_auth = {'))),
               'un script clásico no puede importarlo por su cuenta (v383)');
        });

    // Y que el fichero no se haya vuelto un módulo por accidente.
    ok('3j · password.js sigue siendo un script CLÁSICO',
       !/^\s*(import|export)\s/m.test(sinCom(PWD_SRC)),
       'con import/export dejaría de cargarse con <script src> y moriría en silencio');
}

console.log('\n' + '─'.repeat(60));
console.log(`Resultado: ${pass} PASS · ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
}

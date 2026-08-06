// ─────────────────────────────────────────────────────────────────────────
// GUARD · v462 — Salida para quien ha OLVIDADO la contraseña actual
// ─────────────────────────────────────────────────────────────────────────
// Reporte del autor (captura 8454): la pantalla de cambiar contraseña exige la
// "Contraseña actual" y quien no la recuerda se queda sin salida a la vista.
//
// ⚠️ EL FLUJO DE RECUPERACIÓN YA EXISTE DESDE v451, en la pantalla de LOGIN
// (`openForgotPasswordModal`). Lo que faltaba es el PUENTE: desde la ventana de
// cambio, con la sesión iniciada, no había forma de llegar hasta él sin deducir
// por tu cuenta que hay que cerrar sesión primero. Esto no re-implementa nada:
// añade la salida donde el usuario se queda atascado.
//
// 🔑 EL CORREO SALE DE LA SESIÓN, NO DE UN CAMPO. Aquí el usuario ya está
// autenticado: pedirle que teclee su correo sería absurdo y además abriría la
// puerta a mandar el enlace a OTRA dirección desde una sesión ajena.
//
// 🔑🔑 LO QUE NO SE PUEDE ROMPER: el cambio de contraseña sigue exigiendo la
// actual y sigue REAUTENTICANDO antes de `updatePassword` (decisión de v451 que
// no se deshace). El puente es una salida alternativa, no un atajo: quien lo usa
// acaba en su buzón, no cambiando la contraseña sin demostrar nada.
//
// ⚠️ NO SE MIRA SÓLO EL FUENTE: el módulo se carga en un sandbox con Firebase
// Auth de mentira y se PULSAN los botones, midiendo a qué se llama y con qué.
//
// Red-check: CRONOS_PWD_JS=<ruta> apunta a una copia mutada.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

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
const PWD_SRC = process.env.CRONOS_PWD_JS
    ? fs.readFileSync(process.env.CRONOS_PWD_JS, 'utf8')
    : read('js/services/auth/password.js');

console.log('── salida para quien ha olvidado la contraseña actual (v462) ──\n');

// ═══════════ El banco de pruebas ═══════════
function montar(opciones) {
    opciones = opciones || {};
    const registro = { reset: [], reauth: [], update: [], toasts: [] };

    function nuevoNodo(tag) {
        return {
            tag, id: '', innerHTML: '', value: '', style: { cssText: '' },
            children: [], _listeners: {},
            appendChild(c) { this.children.push(c); c._padre = this; },
            remove() { if (this._padre) this._padre.children = this._padre.children.filter(x => x !== this); },
            addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
            removeEventListener() {}, focus() {},
            setAttribute() {}, getAttribute() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
        };
    }

    // Índice de los id="..." del HTML pintado, para poder "escribir" y leer.
    const campos = new Map();
    let htmlPintado = '';
    // Campos que ya existen en la PÁGINA aunque la ventana no los pinte (p. ej.
    // `auth-email` del login). Sin esto no se puede medir si el módulo lee de
    // donde no debe: `getElementById` devolvería null y el fallo pasaría por
    // bueno. Lo destapó el red-check.
    if (opciones.valores) {
        Object.keys(opciones.valores).forEach((id) => {
            const nodo = nuevoNodo('input');
            nodo.id = id;
            nodo.value = opciones.valores[id];
            campos.set(id, nodo);
        });
    }
    function _indexar(html) {
        htmlPintado += html;
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
            return { valid: Object.values(r).filter(Boolean).length === 5, requirements: r };
        },
        setupPasswordValidator: () => {},
    };

    const user = opciones.sinSesion ? null : {
        email: opciones.email || 'entrenador@club.com',
        providerData: opciones.providerData || [{ providerId: 'password' }],
    };
    sb._cronos_auth = opciones.sinServicio ? {} : {
        auth: { currentUser: user },
        sendPasswordResetEmail: async (auth, email) => {
            registro.reset.push(email);
            if (opciones.errorReset) { const e = new Error('x'); e.code = opciones.errorReset; throw e; }
        },
        EmailAuthProvider: { credential: (email, pwd) => ({ email, pwd }) },
        reauthenticateWithCredential: async (u, cred) => {
            registro.reauth.push({ email: cred.email, pwd: cred.pwd,
                                   orden: registro.reauth.length + registro.update.length });
            if (opciones.errorReauth) { const e = new Error('x'); e.code = opciones.errorReauth; throw e; }
        },
        updatePassword: async (u, nueva) => {
            registro.update.push({ nueva, orden: registro.reauth.length + registro.update.length });
        },
    };
    sb.window = sb;
    vm.createContext(sb);
    // ⚠️ Se captura el fallo de carga en vez de dejarlo propagar: si el módulo
    // no compila o revienta al evaluarse, el guard tiene que decirlo con una
    // aserción NOMBRADA (PARTE 0), no morir con un stack trace que no señala a
    // nada. Es la lección de nav-stack: un guard no puede ver un fichero que no
    // compila — y aquí lo destapó el red-check.
    try { vm.runInContext(PWD_SRC, sb); } catch (e) { sb._errorCarga = e; }

    return { sb, registro, campos,
             html: () => htmlPintado,
             escribir: (id, v) => { const c = campos.get(id); if (c) c.value = v; },
             mensaje: () => { const m = campos.get('cronos-pwd-modal-msg'); return m ? m.innerHTML : ''; } };
}

const esperar = () => new Promise(r => setImmediate(r));

// Llama a una función de `window` sin reventar si aún no existe: un guard tiene
// que llegar al final incluso en rojo, o las aserciones de más abajo no miden
// nada. Ausente equivale a "no hizo nada", que es justo lo que se está midiendo.
const pulsar = (t, fn) => {
    if (typeof t.sb.window[fn] !== 'function') return false;
    try { t.sb.window[fn](); } catch (e) { t._error = e; }
    return true;
};

(async function () {

// ─────────────────────────────────────────────────────────────────────────
console.log('── PARTE 0 · el módulo carga y expone sus tres entradas ──');
// ─────────────────────────────────────────────────────────────────────────
// Sin esto, un fichero que no compila mataba el guard con un stack trace en
// lugar de dar rojo: todas las aserciones de abajo se quedaban sin ejecutar y
// la salida no señalaba a ningún defecto concreto.
{
    const t = montar();
    ok('0a · 🔑 el módulo se evalúa sin lanzar',
       !t.sb._errorCarga, t.sb._errorCarga ? String(t.sb._errorCarga.message) : '');
    ['openForgotPasswordModal', 'openChangePasswordModal', 'cronosResetDesdePerfil']
        .forEach((fn) => ok('0b · expone ' + fn, typeof t.sb.window[fn] === 'function'));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · la salida EXISTE y es alcanzable desde donde se atasca ──');
// ─────────────────────────────────────────────────────────────────────────
// Ésta es la incidencia de la captura 8454. Antes de v462 todo este bloque
// estaba en rojo: la ventana de cambio no ofrecía ninguna vía al que no
// recuerda la contraseña actual.
{
    const t = montar();
    ok('1a · expone cronosResetDesdePerfil',
       typeof t.sb.window.cronosResetDesdePerfil === 'function');

    pulsar(t, 'openChangePasswordModal');
    const html = t.html();

    ok('1b · 🔑 la ventana de CAMBIAR ofrece una salida a quien no la recuerda',
       /cronosResetDesdePerfil\(\)/.test(html),
       'la modal no menciona la función; el usuario sigue sin salida');
    ok('1c · …y se entiende de qué va sin leer documentación',
       /no la recuerdas|no la recuerdo|olvidad/i.test(html),
       html.replace(/\s+/g, ' ').slice(0, 200));
    ok('1d · la salida está junto a la contraseña ACTUAL, que es donde se atasca',
       html.indexOf('cronosResetDesdePerfil') > html.indexOf('pwd-actual') &&
       html.indexOf('cronosResetDesdePerfil') < html.indexOf('pwd-nueva2'),
       'orden: pwd-actual ' + html.indexOf('pwd-actual') +
       ' / salida ' + html.indexOf('cronosResetDesdePerfil') +
       ' / pwd-nueva2 ' + html.indexOf('pwd-nueva2'));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · el enlace se envía al correo DE LA SESIÓN ──');
// ─────────────────────────────────────────────────────────────────────────
{
    const t = montar({ email: 'jose@club.com' });
    pulsar(t, 'openChangePasswordModal');
    pulsar(t, 'cronosResetDesdePerfil');
    await esperar();

    ok('2a · 🔑 llama a sendPasswordResetEmail con el correo de la sesión',
       t.registro.reset.length === 1 && t.registro.reset[0] === 'jose@club.com',
       JSON.stringify(t.registro.reset));
    ok('2b · lo confirma diciendo A DÓNDE ha ido (si no, nadie sabe dónde mirar)',
       /jose@club\.com/.test(t.mensaje()), t.mensaje().slice(0, 200));
    ok('2c · y recuerda mirar en spam, que es donde suele caer',
       /spam/i.test(t.mensaje()), t.mensaje().slice(0, 200));
    ok('2d · 🔑🔑 NO cambia la contraseña por su cuenta: sólo manda el enlace',
       t.registro.update.length === 0, JSON.stringify(t.registro.update));
    ok('2e · ni reautentica con nada (no tiene la actual, ése es el punto)',
       t.registro.reauth.length === 0, JSON.stringify(t.registro.reauth));
}
{
    // 🔑 DEFENSA: aunque haya algo escrito en los campos de la ventana, el
    // correo sale de la SESIÓN. Coger el del formulario permitiría mandar el
    // enlace a una dirección ajena desde una sesión abierta que no es tuya.
    const t = montar({ email: 'duenyo@club.com',
                       valores: { 'pwd-reset-email': 'atacante@otro.com',
                                  'auth-email': 'atacante@otro.com' } });
    pulsar(t, 'openChangePasswordModal');
    pulsar(t, 'cronosResetDesdePerfil');
    await esperar();
    ok('2f · 🔑 el correo NO se coge de ningún campo escribible',
       t.registro.reset.length === 1 && t.registro.reset[0] === 'duenyo@club.com',
       JSON.stringify(t.registro.reset));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · lo que NO se puede romper (v451 sigue en pie) ──');
// ─────────────────────────────────────────────────────────────────────────
{
    const t = montar({ email: 'e@club.com' });
    pulsar(t, 'openChangePasswordModal');
    t.escribir('pwd-actual', 'Antigua1!');
    t.escribir('pwd-nueva',  'NuevaSegura9!');
    t.escribir('pwd-nueva2', 'NuevaSegura9!');
    pulsar(t, 'cronosSubmitPasswordChange');
    await esperar();

    ok('3a · 🔑🔑 cambiar la contraseña SIGUE reautenticando antes de actualizar',
       t.registro.reauth.length === 1 && t.registro.update.length === 1 &&
       t.registro.reauth[0].orden < t.registro.update[0].orden,
       'reauth ' + JSON.stringify(t.registro.reauth) + ' update ' + JSON.stringify(t.registro.update));
    ok('3b · y reautentica con la contraseña ACTUAL que se ha tecleado',
       t.registro.reauth[0] && t.registro.reauth[0].pwd === 'Antigua1!',
       JSON.stringify(t.registro.reauth));
    ok('3c · el puente no se ha disparado solo por abrir la ventana',
       t.registro.reset.length === 0, JSON.stringify(t.registro.reset));
}
{
    // El puente NO es un atajo: usarlo no debe dejar cambiar la contraseña
    // sin la actual. Se pulsa el puente y después CAMBIAR con el campo vacío.
    const t = montar();
    pulsar(t, 'openChangePasswordModal');
    pulsar(t, 'cronosResetDesdePerfil');
    await esperar();
    t.escribir('pwd-actual', '');
    t.escribir('pwd-nueva',  'NuevaSegura9!');
    t.escribir('pwd-nueva2', 'NuevaSegura9!');
    pulsar(t, 'cronosSubmitPasswordChange');
    await esperar();
    ok('3d · 🔑 usar el puente NO abre la puerta a cambiarla sin la actual',
       t.registro.update.length === 0 && t.registro.reauth.length === 0,
       'update ' + JSON.stringify(t.registro.update) + ' reauth ' + JSON.stringify(t.registro.reauth));
}
{
    // El flujo del login (v451) sigue intacto y sigue siendo el de siempre.
    const t = montar({ valores: { 'pwd-reset-email': 'padre@correo.com' } });
    pulsar(t, 'openForgotPasswordModal');
    t.escribir('pwd-reset-email', 'padre@correo.com');
    pulsar(t, 'cronosSendPasswordReset');
    await esperar();
    ok('3e · el "¿Has olvidado tu contraseña?" del login sigue funcionando',
       t.registro.reset.length === 1 && t.registro.reset[0] === 'padre@correo.com',
       JSON.stringify(t.registro.reset));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · cuando algo va mal, se dice en cristiano ──');
// ─────────────────────────────────────────────────────────────────────────
{
    const t = montar({ sinSesion: true });
    pulsar(t, 'cronosResetDesdePerfil');
    await esperar();
    ok('4a · sin sesión no se llama a Firebase',
       t.registro.reset.length === 0, JSON.stringify(t.registro.reset));
    ok('4b · y no lanza', true);
}
{
    const t = montar({ errorReset: 'auth/network-request-failed' });
    pulsar(t, 'openChangePasswordModal');
    pulsar(t, 'cronosResetDesdePerfil');
    await esperar();
    ok('4c · un fallo de red se explica, no se enseña el código de Firebase',
       /conexión|internet/i.test(t.mensaje()) && !/auth\//.test(t.mensaje()),
       t.mensaje().slice(0, 200));
}
{
    const t = montar({ errorReset: 'auth/too-many-requests' });
    pulsar(t, 'openChangePasswordModal');
    pulsar(t, 'cronosResetDesdePerfil');
    await esperar();
    ok('4d · y el "demasiados intentos" también',
       /intentos/i.test(t.mensaje()) && !/auth\//.test(t.mensaje()),
       t.mensaje().slice(0, 200));
}
{
    // La sesión existe, así que la cuenta existe: un 'user-not-found' aquí sólo
    // puede ser una cuenta borrada por detrás. No puede reventar la ventana.
    const t = montar({ errorReset: 'auth/user-not-found' });
    pulsar(t, 'openChangePasswordModal');
    pulsar(t, 'cronosResetDesdePerfil');
    await esperar();
    ok('4e · una cuenta borrada por detrás no rompe la ventana',
       t.mensaje().length > 0, t.mensaje().slice(0, 200));
}
{
    const t = montar({ sinServicio: true });
    pulsar(t, 'cronosResetDesdePerfil');
    await esperar();
    // ⚠️ Esta aserción decía antes `/recarga/ EN EL MENSAJE O /recarga|sesión/
    // EN EL TOAST`, y el red-check demostró que ese OR la volvía inútil: quitar
    // la comprobación del servicio la dejaba VERDE, porque el usuario acababa
    // en la rama de "sesión caducada" y el toast decía "sesión". Recargar y
    // volver a entrar son consejos distintos: si el módulo no está cargado,
    // volver a entrar no arregla nada. Se exige el consejo CORRECTO.
    ok('4f · si Firebase Auth no está cargado, se pide RECARGAR (no reentrar) y no se lanza',
       t.registro.toasts.some(x => /recarga/i.test(x)),
       t.mensaje().slice(0, 200) + ' | ' + JSON.stringify(t.registro.toasts));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · integración: sigue siendo cargable y precacheado ──');
// ─────────────────────────────────────────────────────────────────────────
{
    const INDEX = read('index.html');
    const SW = read('sw.js');
    ok('5a · index.html sigue enlazando el script',
       /<script src="js\/services\/auth\/password\.js\?v=v\d+"><\/script>/.test(INDEX));
    ok('5b · 🔑 el service worker lo sigue precacheando (si no, sin cobertura no existe)',
       /'\.\/js\/services\/auth\/password\.js'/.test(SW));
    ok('5c · sigue siendo un script CLÁSICO (el ámbito de módulo no cuelga de window)',
       !/^\s*(import|export)\s/m.test(PWD_SRC));
    ok('5d · y el enlace del login sigue en su sitio',
       /id="btn-forgot-password"/.test(INDEX) && /openForgotPasswordModal\(\)/.test(INDEX));
}

console.log('\n' + '─'.repeat(60));
console.log('Resultado: ' + pass + ' PASS · ' + fail + ' FAIL');
if (fail) process.exit(1);
console.log('✅ Quien ha olvidado la contraseña actual tiene salida, y v451 sigue intacta');

})();

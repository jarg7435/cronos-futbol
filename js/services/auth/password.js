// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — CONTRASEÑAS (recuperación y cambio)   v451
// ══════════════════════════════════════════════════════════════════
//  Dos flujos, con su propia ventana y sin depender de ningún contenedor
//  de la app:
//
//   1. ¿HAS OLVIDADO TU CONTRASEÑA?  — desde la pantalla de login. Envía el
//      enlace seguro de Firebase (`sendPasswordResetEmail`). Quien no tenga
//      acceso al buzón no puede continuar, así que la propiedad del correo
//      queda comprobada sola.
//
//   2. CAMBIAR CONTRASEÑA — con la sesión ya iniciada. Pide la ACTUAL,
//      reautentica y sólo entonces llama a `updatePassword`.
//
//  ⚠️ ES UN SCRIPT CLÁSICO, NO UN MÓDULO. No puede usar `import`, y el
//  ámbito de un módulo ES no cuelga de window (trampa de v383): por eso las
//  funciones de Firebase Auth llegan por `window._cronos_auth`, publicadas
//  en firebase-init.js. Y por eso todo lo que expone va a `window.*`, que es
//  lo que pueden llamar los `onclick` del HTML.
//
//  🔑 DOS DECISIONES DE SEGURIDAD QUE NO SON NEGOCIABLES:
//
//   · NO SE REVELA SI UN CORREO ESTÁ REGISTRADO. `sendPasswordResetEmail`
//     lanza `auth/user-not-found` cuando la cuenta no existe. Contarlo
//     convertiría el formulario en un comprobador de altas: cualquiera
//     podría averiguar qué familias están en el club. Se responde SIEMPRE
//     lo mismo, exista o no.
//
//   · SE REAUTENTICA SIEMPRE ANTES DE CAMBIARLA. `updatePassword` sólo exige
//     sesión reciente (`auth/requires-recent-login`), así que en una sesión
//     recién iniciada dejaría cambiarla SIN pedir la actual. Un móvil
//     desbloqueado encima de la mesa bastaría para quedarse con la cuenta.
//     Pedir la contraseña actual y reautenticar cierra eso y, de paso, hace
//     imposible el `requires-recent-login`.
//
//  La contraseña nueva pasa por `validatePasswordStrength`, LA MISMA
//  comprobación que el registro (auth-improvements.js). Si aquí se aceptara
//  una más floja, el cambio de contraseña sería la puerta de atrás para
//  saltarse la política de alta.
// ══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const _ID = 'cronos-pwd-modal';

    const _esc = (s) => (typeof escapeHtml === 'function')
        ? escapeHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ── La ventana ────────────────────────────────────────────────
    // Se crea aquí y no se reutiliza `setup-modal` a propósito: el flujo 1
    // ocurre en la pantalla de LOGIN, donde esa modal no está disponible.
    function _abrir(titulo, subtitulo, cuerpoHTML, pieHTML) {
        _cerrar();
        const ov = document.createElement('div');
        ov.id = _ID;
        ov.style.cssText =
            'position:fixed;inset:0;background:rgba(3,6,10,0.82);z-index:100000;' +
            'display:flex;align-items:center;justify-content:center;padding:1rem;' +
            'backdrop-filter:blur(3px);';
        ov.innerHTML =
            '<div id="' + _ID + '-box" role="dialog" aria-modal="true" style="' +
                'width:min(94vw,420px);background:#0d1117;border:1px solid rgba(255,255,255,0.12);' +
                'border-radius:14px;padding:1.5rem;box-shadow:0 18px 50px rgba(0,0,0,0.6);">' +
                '<h3 style="margin:0 0 0.3rem;font-size:1.05rem;color:#58a6ff;">' + titulo + '</h3>' +
                '<p style="margin:0 0 1.2rem;font-size:0.78rem;color:#7d8590;line-height:1.45;">' +
                    subtitulo + '</p>' +
                cuerpoHTML +
                '<p id="' + _ID + '-msg" style="font-size:0.78rem;margin:0.9rem 0 0;' +
                    'text-align:center;min-height:1.1rem;line-height:1.4;"></p>' +
                '<div style="display:flex;gap:0.6rem;margin-top:1.1rem;">' + pieHTML + '</div>' +
            '</div>';
        document.body.appendChild(ov);

        // Cerrar tocando fuera, pero NO al soltar el ratón dentro de la caja.
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) _cerrar(); });
        document.addEventListener('keydown', _escListener);

        const primero = ov.querySelector('input');
        if (primero) setTimeout(() => primero.focus(), 30);
        return ov;
    }

    function _escListener(e) { if (e.key === 'Escape') _cerrar(); }

    function _cerrar() {
        const prev = document.getElementById(_ID);
        if (prev) prev.remove();
        document.removeEventListener('keydown', _escListener);
    }

    function _msg(texto, color) {
        const el = document.getElementById(_ID + '-msg');
        if (el) { el.innerHTML = texto; el.style.color = color || '#7d8590'; }
    }

    const _input = (id, tipo, ph, autoc) =>
        '<div style="margin-bottom:0.8rem;">' +
            '<input type="' + tipo + '" id="' + id + '" placeholder="' + ph + '" autocomplete="' + autoc + '"' +
            ' style="width:100%;padding:0.75rem;background:rgba(255,255,255,0.06);' +
            'border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;' +
            'font-size:0.95rem;box-sizing:border-box;outline:none;">' +
        '</div>';

    const _btnPrim = (txt, fn) =>
        '<button type="button" onclick="' + fn + '" style="flex:1.6;padding:0.8rem;background:#58a6ff;' +
        'border:none;border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.88rem;cursor:pointer;">' +
        txt + '</button>';

    const _btnSec = (txt) =>
        '<button type="button" onclick="window.closePasswordModal()" style="flex:1;padding:0.8rem;' +
        'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);' +
        'border-radius:8px;color:#7d8590;font-size:0.88rem;cursor:pointer;">' + txt + '</button>';

    // Enter envía; así el flujo se completa sin tocar el ratón.
    function _enterEnvia(ov, fnNombre) {
        ov.querySelectorAll('input').forEach((inp) => {
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); window[fnNombre](); }
            });
        });
    }

    // ── Traducción de los códigos de Firebase ─────────────────────
    // Sin esto el usuario ve "auth/invalid-credential" y no sabe qué hacer.
    function _errorLegible(err) {
        const code = (err && err.code) || '';
        switch (code) {
            case 'auth/invalid-email':
                return 'Ese correo no tiene un formato válido.';
            case 'auth/missing-email':
                return 'Escribe tu correo electrónico.';
            case 'auth/wrong-password':
            case 'auth/invalid-credential':
                return 'La contraseña actual no es correcta.';
            case 'auth/weak-password':
                return 'La contraseña nueva es demasiado débil.';
            case 'auth/too-many-requests':
                return 'Demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.';
            case 'auth/network-request-failed':
                return 'Sin conexión. Comprueba tu internet e inténtalo de nuevo.';
            case 'auth/requires-recent-login':
                return 'Por seguridad, vuelve a iniciar sesión antes de cambiar la contraseña.';
            case 'auth/user-disabled':
                return 'Esta cuenta está deshabilitada. Contacta con el administrador.';
            default:
                return 'No se ha podido completar la operación. ' +
                       ((err && err.message) ? _esc(err.message) : 'Inténtalo de nuevo.');
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  1 · ¿HAS OLVIDADO TU CONTRASEÑA?
    // ══════════════════════════════════════════════════════════════
    window.openForgotPasswordModal = function openForgotPasswordModal() {
        // Se arrastra lo que ya haya escrito en el login: casi siempre es su
        // correo y se ahorra volver a teclearlo.
        const yaEscrito = (document.getElementById('auth-email') || {}).value || '';
        const ov = _abrir(
            '🔑 Recuperar contraseña',
            'Escribe tu correo y te enviaremos un enlace para crear una nueva. ' +
            'El enlace llega a tu buzón, así que sólo puede usarlo quien tenga acceso a él.',
            '<div style="margin-bottom:0.2rem;">' +
                '<label style="font-size:0.75rem;color:#7d8590;display:block;margin-bottom:5px;">Correo electrónico</label>' +
                _input('pwd-reset-email', 'email', 'tu@email.com', 'email') +
            '</div>',
            _btnSec('Cancelar') + _btnPrim('ENVIAR ENLACE', 'window.cronosSendPasswordReset()')
        );
        const inp = document.getElementById('pwd-reset-email');
        if (inp && yaEscrito) inp.value = yaEscrito;
        _enterEnvia(ov, 'cronosSendPasswordReset');
    };

    window.cronosSendPasswordReset = async function cronosSendPasswordReset() {
        const fa = window._cronos_auth;
        const email = ((document.getElementById('pwd-reset-email') || {}).value || '').trim();

        if (!email) { _msg('Escribe tu correo electrónico.', '#ff5858'); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            _msg('Ese correo no tiene un formato válido.', '#ff5858'); return;
        }
        if (!fa || typeof fa.sendPasswordResetEmail !== 'function') {
            _msg('El servicio no está disponible. Recarga la página.', '#ff5858'); return;
        }

        _msg('⏳ Enviando…', '#7d8590');
        try {
            await fa.sendPasswordResetEmail(fa.auth, email);
            _exitoReset(email);
        } catch (err) {
            // 🔑 NO SE REVELA SI EL CORREO EXISTE. Un 'user-not-found' se
            // responde EXACTAMENTE igual que un envío correcto; de lo
            // contrario este formulario sería un comprobador de altas.
            const code = (err && err.code) || '';
            if (code === 'auth/user-not-found' || code === 'auth/invalid-recipient-email') {
                _exitoReset(email);
                return;
            }
            console.warn('[Cronos-Pwd] Error al enviar el restablecimiento:', code || err);
            _msg('⚠️ ' + _errorLegible(err), '#ff5858');
        }
    };

    function _exitoReset(email) {
        _msg('✅ Si <strong>' + _esc(email) + '</strong> corresponde a una cuenta registrada, ' +
             'recibirás un correo con el enlace en unos minutos.<br>' +
             '<span style="color:#7d8590;">Revisa también la carpeta de spam.</span>', '#3fb950');
        const box = document.getElementById(_ID + '-box');
        if (box) {
            const pie = box.querySelector('div[style*="display:flex"]');
            if (pie) {
                pie.innerHTML =
                    '<button type="button" onclick="window.closePasswordModal()" style="flex:1;' +
                    'padding:0.8rem;background:#58a6ff;border:none;border-radius:8px;color:#0a0e14;' +
                    'font-weight:700;font-size:0.88rem;cursor:pointer;">ENTENDIDO</button>';
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  2 · CAMBIAR LA CONTRASEÑA (sesión iniciada)
    // ══════════════════════════════════════════════════════════════
    window.openChangePasswordModal = function openChangePasswordModal() {
        const fa = window._cronos_auth;
        const user = fa && fa.auth ? fa.auth.currentUser : null;

        if (!user) {
            if (typeof showToast === 'function') {
                showToast('⚠️ Debes iniciar sesión para cambiar tu contraseña.', 4000);
            }
            return;
        }

        // Sólo tiene sentido para cuentas de correo y contraseña. Hoy son
        // todas, pero si algún día se añade otro proveedor esto evita un
        // error incomprensible.
        const porPassword = !Array.isArray(user.providerData) || !user.providerData.length ||
            user.providerData.some((p) => p && p.providerId === 'password');
        if (!porPassword) {
            _abrir('🔒 Cambiar contraseña',
                   'Tu cuenta no usa contraseña: entras con un proveedor externo, ' +
                   'así que la contraseña se gestiona allí.',
                   '', _btnSec('Cerrar'));
            return;
        }

        const ov = _abrir(
            '🔒 Cambiar contraseña',
            'Sesión de <strong>' + _esc(user.email || '') + '</strong>. Por seguridad te pedimos ' +
            'la contraseña actual antes de cambiarla.',
            '<label style="font-size:0.75rem;color:#7d8590;display:block;margin-bottom:5px;">Contraseña actual</label>' +
            _input('pwd-actual', 'password', '••••••••', 'current-password') +
            '<label style="font-size:0.75rem;color:#7d8590;display:block;margin-bottom:5px;">Contraseña nueva</label>' +
            _input('pwd-nueva', 'password', 'Mínimo 8 caracteres', 'new-password') +
            '<div id="pwd-nueva-feedback"></div>' +
            '<label style="font-size:0.75rem;color:#7d8590;display:block;margin:0.5rem 0 5px;">Repite la nueva</label>' +
            _input('pwd-nueva2', 'password', 'Repite la contraseña', 'new-password'),
            _btnSec('Cancelar') + _btnPrim('CAMBIAR', 'window.cronosSubmitPasswordChange()')
        );

        // El mismo medidor de fuerza que el registro, para que el usuario vea
        // qué le falta en vez de recibir un "no válida" seco.
        if (typeof setupPasswordValidator === 'function') {
            setupPasswordValidator('pwd-nueva', 'pwd-nueva-feedback');
        }
        _enterEnvia(ov, 'cronosSubmitPasswordChange');
    };

    window.cronosSubmitPasswordChange = async function cronosSubmitPasswordChange() {
        const fa = window._cronos_auth;
        const user = fa && fa.auth ? fa.auth.currentUser : null;
        if (!user) { _msg('La sesión ha caducado. Vuelve a entrar.', '#ff5858'); return; }

        const actual = (document.getElementById('pwd-actual') || {}).value || '';
        const nueva  = (document.getElementById('pwd-nueva')  || {}).value || '';
        const nueva2 = (document.getElementById('pwd-nueva2') || {}).value || '';

        if (!actual || !nueva || !nueva2) {
            _msg('Rellena los tres campos.', '#ff5858'); return;
        }
        if (nueva !== nueva2) {
            _msg('Las dos contraseñas nuevas no coinciden.', '#ff5858'); return;
        }
        if (nueva === actual) {
            _msg('La contraseña nueva tiene que ser distinta de la actual.', '#ff5858'); return;
        }
        // MISMA política que el alta: si aquí se aceptara una más floja, este
        // formulario sería la puerta de atrás para saltarse la del registro.
        if (typeof validatePasswordStrength === 'function') {
            const v = validatePasswordStrength(nueva);
            if (!v.valid) {
                _msg('La contraseña nueva no cumple los requisitos: 8 caracteres, ' +
                     'mayúscula, minúscula, número y símbolo (!@#$%^&amp;*).', '#ff5858');
                return;
            }
        } else if (nueva.length < 8) {
            _msg('La contraseña nueva debe tener al menos 8 caracteres.', '#ff5858'); return;
        }

        if (typeof fa.reauthenticateWithCredential !== 'function' ||
            !fa.EmailAuthProvider || typeof fa.updatePassword !== 'function') {
            _msg('El servicio no está disponible. Recarga la página.', '#ff5858'); return;
        }

        _msg('⏳ Comprobando…', '#7d8590');
        try {
            // 🔑 REAUTENTICAR SIEMPRE, no sólo cuando Firebase lo exija: es lo
            // que comprueba que quien cambia la contraseña conoce la actual.
            const cred = fa.EmailAuthProvider.credential(user.email, actual);
            await fa.reauthenticateWithCredential(user, cred);

            await fa.updatePassword(user, nueva);

            _msg('✅ Contraseña actualizada. La próxima vez entra con la nueva.', '#3fb950');
            if (typeof showToast === 'function') {
                showToast('✅ Contraseña actualizada correctamente', 4000);
            }
            setTimeout(_cerrar, 1800);
        } catch (err) {
            console.warn('[Cronos-Pwd] Error al cambiar la contraseña:', (err && err.code) || err);
            _msg('⚠️ ' + _errorLegible(err), '#ff5858');
        }
    };

    window.closePasswordModal = _cerrar;
})();

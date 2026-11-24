// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — SEGUNDO FACTOR (TOTP) DEL SUPERADMIN   v862
// ══════════════════════════════════════════════════════════════════
//  Propuesta aprobada: PROPUESTA_MFA_SA.md. TOTP = código de 6 dígitos de
//  una app del móvil (Google Authenticator, Microsoft Authenticator…).
//
//  Con un factor dado de alta, Firebase NO abre la sesión con la contraseña:
//  lanza `auth/multi-factor-auth-required`. Cada camino de acceso
//  (login, registro con correo existente, visor, cambio de contraseña y
//  credencial maestra del diagnóstico) hace:
//
//      if (window.CronosMFA && window.CronosMFA.esReto(e)) {
//          await window.CronosMFA.resolver(e, sdk);
//      }
//
//  Sin factor dado de alta esa rama NUNCA se ejecuta: para todas las demás
//  cuentas el acceso sigue exactamente igual.
//
//  ⚠️ SCRIPT CLÁSICO, NO MÓDULO (igual que password.js): el SDK llega como
//  parámetro (`window._cronos_auth` en la app, un objeto propio en
//  live.html), así que sirve para las dos páginas.
//
//  🔑 REGLAS QUE NO SE TOCAN:
//   · El código y la clave secreta NUNCA van a la consola.
//   · Sin QR de servicios externos: mandar la clave a un tercero para que
//     pinte el QR sería entregarle el segundo factor. Se enseña la clave en
//     texto y el enlace `otpauth://` (en el móvil abre la app directamente).
//   · El alta pide la contraseña y reautentica primero: Firebase exige
//     sesión reciente, y así un portátil abierto no basta para añadir un
//     aparato ajeno.
//   · Recuperación si se pierden los aparatos: scripts/ops/mfa_quitar_factor.js
//     (RECUPERACION.md).
// ══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const MAX_INTENTOS = 5;
    const EMISOR = 'Chronos Fútbol';
    const _ID = 'cronos-mfa-modal';

    const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function _err(code, mensaje) { const e = new Error(mensaje || code); e.code = code; return e; }

    function esReto(err) { return !!(err && err.code === 'auth/multi-factor-auth-required'); }

    function _limpia(raw) { return String(raw == null ? '' : raw).replace(/\s+/g, ''); }
    const _esCodigo = (c) => /^\d{6}$/.test(c);
    const _esCodigoMalo = (e) => !!(e && (e.code === 'auth/invalid-verification-code' || e.code === 'auth/missing-code'));

    function _esSuperAdmin() {
        const me = window._cronosCurrentUser || {};
        return me.role === 'superadmin' || me._activeRole === 'superadmin';
    }

    function legible(err) {
        switch ((err && err.code) || '') {
            case 'cronos/mfa-cancelado':           return 'Cancelado: hace falta el código de 6 dígitos de tu app de autenticación.';
            case 'cronos/mfa-sin-totp':            return 'Tu cuenta pide un segundo factor que esta aplicación no admite.';
            case 'cronos/mfa-no-disponible':       return 'El servicio de autenticación no está disponible. Recarga la página.';
            case 'cronos/mfa-correo-sin-verificar':
            case 'auth/unverified-email':          return 'Para activar la verificación en dos pasos tu correo tiene que estar verificado.';
            case 'auth/invalid-verification-code':
            case 'auth/missing-code':              return 'Código incorrecto. Comprueba que la hora del móvil es automática.';
            case 'auth/code-expired':              return 'El código ha caducado. Escribe el que se ve ahora.';
            case 'auth/invalid-credential':
            case 'auth/wrong-password':            return 'La contraseña no es correcta.';
            case 'auth/too-many-requests':         return 'Demasiados intentos seguidos. Espera unos minutos.';
            case 'auth/network-request-failed':    return 'Sin conexión. Comprueba tu internet.';
            case 'auth/maximum-second-factor-count-exceeded': return 'Sólo se admite un aparato de verificación por cuenta y ya tienes uno. ' +
                'Para tener otro de reserva hay que quitar el actual (procedimiento de recuperación) y, al darlo de alta otra vez, ' +
                'escribir la misma clave en los dos aparatos.';
            case 'auth/requires-recent-login':     return 'Por seguridad, cierra sesión, vuelve a entrar y repite el alta.';
            default:                               return 'No se ha podido completar. Inténtalo de nuevo.';
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  1 · COMPLETAR EL ACCESO (login y reautenticación)
    // ══════════════════════════════════════════════════════════════
    //  Devuelve la credencial de `resolveSignIn`. Si se cancela o se agotan
    //  los intentos, lanza un error con `code` (cronos/mfa-cancelado,
    //  auth/invalid-verification-code…) que el llamador trata como cualquier
    //  fallo de acceso. No cierra ninguna sesión: con el reto pendiente
    //  todavía no hay sesión abierta.
    async function resolver(err, sdk) {
        sdk = sdk || window._cronos_auth;
        if (!sdk || typeof sdk.getMultiFactorResolver !== 'function' || !sdk.TotpMultiFactorGenerator) {
            throw _err('cronos/mfa-no-disponible');
        }
        const TOTP = sdk.TotpMultiFactorGenerator;
        const r = sdk.getMultiFactorResolver(sdk.auth, err);
        const fid = TOTP.FACTOR_ID || 'totp';
        const pista = ((r && r.hints) || []).find((h) => h && h.factorId === fid);
        if (!pista) throw _err('cronos/mfa-sin-totp');

        let aviso = '';
        for (let i = 1; i <= MAX_INTENTOS; i++) {
            const raw = await api._ui.pedirCodigo({ intento: i, max: MAX_INTENTOS, error: aviso, aparato: pista.displayName || '' });
            if (raw == null) throw _err('cronos/mfa-cancelado');
            const codigo = _limpia(raw);
            if (!_esCodigo(codigo)) { aviso = 'El código son 6 números.'; continue; }
            try {
                return await r.resolveSignIn(TOTP.assertionForSignIn(pista.uid, codigo));
            } catch (e) {
                if (_esCodigoMalo(e) && i < MAX_INTENTOS) { aviso = legible(e); continue; }
                throw e;
            }
        }
        throw _err('auth/invalid-verification-code');
    }

    // ══════════════════════════════════════════════════════════════
    //  2 · DAR DE ALTA UN APARATO (sólo SuperAdmin)
    // ══════════════════════════════════════════════════════════════
    async function abrirAlta(sdk) {
        sdk = sdk || window._cronos_auth;
        const ui = api._ui;
        const sale = async (motivo, texto) => {
            await ui.aviso({ titulo: '🔐 Verificación en dos pasos', texto: texto || legible({ code: motivo }), tipo: 'error' });
            return { ok: false, motivo };
        };
        try {
            if (!_esSuperAdmin()) return await sale('cronos/mfa-solo-superadmin', 'La verificación en dos pasos sólo se activa en la cuenta de SuperAdmin.');
            if (!sdk || typeof sdk.multiFactor !== 'function' || !sdk.TotpMultiFactorGenerator ||
                typeof sdk.reauthenticateWithCredential !== 'function' || !sdk.EmailAuthProvider) {
                return await sale('cronos/mfa-no-disponible');
            }
            const user = sdk.auth && sdk.auth.currentUser;
            if (!user || !user.email) return await sale('cronos/mfa-no-disponible', 'La sesión ha caducado. Vuelve a entrar.');
            if (user.emailVerified === false) return await sale('cronos/mfa-correo-sin-verificar');

            const TOTP = sdk.TotpMultiFactorGenerator;
            const mf = sdk.multiFactor(user);
            const ya = (mf.enrolledFactors || []).filter((f) => f && f.factorId === (TOTP.FACTOR_ID || 'totp'));

            // 1 · Contraseña → reautenticar (y, si ya hay un aparato, su código).
            const pwd = await ui.pedirContrasena({ inscritos: ya.map((f) => f.displayName || 'sin nombre') });
            if (pwd == null) return { ok: false, motivo: 'cronos/mfa-cancelado' };
            try {
                await sdk.reauthenticateWithCredential(user, sdk.EmailAuthProvider.credential(user.email, pwd));
            } catch (e) {
                if (!esReto(e)) return await sale((e && e.code) || 'error');
                await resolver(e, sdk);
            }

            // 2 · Secreto nuevo, que se enseña UNA vez.
            const secreto = await TOTP.generateSecret(await mf.getSession());
            const url = secreto.generateQrCodeUrl(user.email, EMISOR);
            let aviso = '';
            for (let i = 1; i <= MAX_INTENTOS; i++) {
                const r = await ui.mostrarSecreto({
                    secretKey: secreto.secretKey, url, error: aviso,
                    nombre: ya.length ? 'Reserva' : 'Móvil', inscritos: ya.length,
                });
                if (!r) return { ok: false, motivo: 'cronos/mfa-cancelado' };
                const codigo = _limpia(r.codigo);
                if (!_esCodigo(codigo)) { aviso = 'El código son 6 números.'; continue; }
                const nombre = String(r.nombre || '').trim().slice(0, 40) || (ya.length ? 'Reserva' : 'Móvil');
                try {
                    await mf.enroll(TOTP.assertionForEnrollment(secreto, codigo), nombre);
                } catch (e) {
                    if (_esCodigoMalo(e) && i < MAX_INTENTOS) { aviso = legible(e); continue; }
                    return await sale((e && e.code) || 'error');
                }
                await ui.aviso({
                    titulo: '✅ Verificación en dos pasos activada',
                    texto: 'Aparato «' + nombre + '» dado de alta. A partir de ahora, al entrar te pediremos el código de 6 dígitos.' +
                        (ya.length ? '' : ' Te recomendamos dar de alta un SEGUNDO aparato de reserva (repite este paso): si pierdes el móvil, es tu forma de entrar.'),
                    tipo: 'ok',
                });
                return { ok: true };
            }
            return await sale('auth/invalid-verification-code');
        } catch (e) {
            return await sale((e && e.code) || 'error');
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  3 · INTERFAZ (ventanas propias, por encima de cualquier otra)
    // ══════════════════════════════════════════════════════════════
    //  z-index por encima de la credencial maestra del diagnóstico
    //  (2147483500) y de la ventana de contraseñas (100000), que pueden estar
    //  abiertas debajo cuando aparece el reto.
    function _abrir(html) {
        const viejo = document.getElementById(_ID);
        if (viejo && viejo.parentNode) viejo.parentNode.removeChild(viejo);
        const ov = document.createElement('div');
        ov.id = _ID;
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(3,6,10,0.86);' +
            'display:flex;align-items:center;justify-content:center;padding:1rem;';
        ov.innerHTML = '<div role="dialog" aria-modal="true" style="width:min(94vw,430px);background:#0d1117;' +
            'border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:1.4rem;color:#e6edf3;' +
            'box-shadow:0 18px 50px rgba(0,0,0,0.6);font-family:inherit;">' + html + '</div>';
        document.body.appendChild(ov);
        return { ov, cerrar: () => { if (ov.parentNode) ov.parentNode.removeChild(ov); } };
    }
    const _btn = (id, txt, prim) => '<button type="button" id="' + id + '" style="flex:1;padding:0.75rem;border-radius:8px;' +
        'cursor:pointer;font-size:0.86rem;font-weight:700;' + (prim
            ? 'background:#58a6ff;border:none;color:#0a0e14;'
            : 'background:transparent;border:1px solid rgba(255,255,255,0.18);color:#8b949e;') + '">' + txt + '</button>';
    const _campo = (id, tipo, ph, extra) => '<input id="' + id + '" type="' + tipo + '" placeholder="' + ph + '" ' + (extra || '') +
        ' style="width:100%;box-sizing:border-box;padding:0.7rem 0.8rem;background:rgba(255,255,255,0.06);' +
        'border:1px solid rgba(255,255,255,0.14);border-radius:8px;color:white;font-size:1rem;font-family:inherit;">';
    const _msg = (txt) => '<p style="color:#ff7b72;font-size:0.78rem;min-height:1.1rem;margin:0.6rem 0 0;">' + _esc(txt || '') + '</p>';

    // Ventana genérica con un formulario: resuelve con lo que devuelva
    // `leer()` al aceptar, o null al cancelar.
    function _formulario(html, idFoco, leer) {
        return new Promise((resolve) => {
            const v = _abrir(html + '<div style="display:flex;gap:0.6rem;margin-top:1rem;">' +
                _btn(_ID + '-no', 'Cancelar') + _btn(_ID + '-si', 'Continuar', true) + '</div>');
            const fin = (x) => { v.cerrar(); resolve(x); };
            document.getElementById(_ID + '-no').onclick = () => fin(null);
            document.getElementById(_ID + '-si').onclick = () => fin(leer());
            const foco = document.getElementById(idFoco);
            if (foco) {
                foco.focus();
                foco.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') fin(leer()); });
            }
        });
    }
    const _val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

    const ui = {
        pedirCodigo(o) {
            return _formulario(
                '<h3 style="margin:0 0 0.4rem;font-size:1.02rem;color:#58a6ff;">🔐 Código de verificación</h3>' +
                '<p style="margin:0 0 1rem;font-size:0.8rem;color:#8b949e;line-height:1.45;">Escribe el código de 6 dígitos ' +
                    'que muestra tu app de autenticación' + (o.aparato ? ' (' + _esc(o.aparato) + ')' : '') + '.' +
                    (o.intento > 1 ? ' Intento ' + o.intento + ' de ' + o.max + '.' : '') + '</p>' +
                _campo(_ID + '-cod', 'text', '123456', 'inputmode="numeric" autocomplete="one-time-code" maxlength="7"') +
                _msg(o.error),
                _ID + '-cod', () => _val(_ID + '-cod'));
        },
        pedirContrasena(o) {
            const lista = (o.inscritos || []).length
                ? '<p style="margin:0 0 0.8rem;font-size:0.78rem;color:#3fb950;">Ya tienes ' + o.inscritos.length +
                  ' aparato(s): ' + o.inscritos.map(_esc).join(', ') + '. Sólo se admite uno por cuenta: para tener reserva hay que ' +
                  'quitar el actual (procedimiento de recuperación) y darlo de alta con la misma clave en los dos aparatos.</p>'
                : '';
            return _formulario(
                '<h3 style="margin:0 0 0.4rem;font-size:1.02rem;color:#58a6ff;">🔐 Verificación en dos pasos</h3>' +
                '<p style="margin:0 0 0.8rem;font-size:0.8rem;color:#8b949e;line-height:1.45;">Al entrar en la cuenta de ' +
                    'SuperAdmin te pediremos, además de la contraseña, un código de 6 dígitos de una app del móvil ' +
                    '(Google Authenticator, Microsoft Authenticator…). Primero confirma tu contraseña.</p>' + lista +
                _campo(_ID + '-pwd', 'password', 'Tu contraseña actual', 'autocomplete="current-password"'),
                _ID + '-pwd', () => _val(_ID + '-pwd'));
        },
        mostrarSecreto(o) {
            const grupos = String(o.secretKey || '').replace(/(.{4})/g, '$1 ').trim();
            return _formulario(
                '<h3 style="margin:0 0 0.4rem;font-size:1.02rem;color:#58a6ff;">📱 Añade la cuenta a tu app</h3>' +
                '<p style="margin:0 0 0.6rem;font-size:0.8rem;color:#8b949e;line-height:1.45;">En la app de autenticación, ' +
                    'elige «Introducir clave de configuración» y escribe esta clave (tipo «basada en tiempo»). ' +
                    'No la compartas ni le hagas captura.</p>' +
                '<p style="margin:0 0 0.6rem;font-size:0.8rem;color:#d29922;line-height:1.45;">Sólo se admite un aparato por cuenta. ' +
                    'Para tener reserva, escribe ahora esta misma clave también en tu segundo aparato: los dos darán el mismo código.</p>' +
                '<div style="font-family:monospace;font-size:1.05rem;letter-spacing:1px;text-align:center;padding:0.7rem;' +
                    'background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.3);border-radius:8px;' +
                    'user-select:all;word-break:break-all;">' + _esc(grupos) + '</div>' +
                '<p style="margin:0.5rem 0 0.9rem;font-size:0.76rem;text-align:center;">' +
                    '<a href="' + _esc(o.url) + '" style="color:#58a6ff;">Si estás en el móvil de la app, toca aquí para añadirla</a></p>' +
                '<label style="font-size:0.75rem;color:#8b949e;">Nombre del aparato</label>' +
                _campo(_ID + '-nom', 'text', 'Móvil', 'maxlength="40" value="' + _esc(o.nombre || '') + '"') +
                '<label style="font-size:0.75rem;color:#8b949e;display:block;margin-top:0.6rem;">Código de 6 dígitos que muestra ahora la app</label>' +
                _campo(_ID + '-cod', 'text', '123456', 'inputmode="numeric" autocomplete="one-time-code" maxlength="7"') +
                _msg(o.error),
                _ID + '-cod', () => ({ codigo: _val(_ID + '-cod'), nombre: _val(_ID + '-nom') }));
        },
        aviso(o) {
            return new Promise((resolve) => {
                const v = _abrir(
                    '<h3 style="margin:0 0 0.5rem;font-size:1.02rem;color:' + (o.tipo === 'ok' ? '#3fb950' : '#ff7b72') + ';">' +
                        _esc(o.titulo) + '</h3>' +
                    '<p style="margin:0;font-size:0.82rem;color:#c9d1d9;line-height:1.5;">' + _esc(o.texto) + '</p>' +
                    '<div style="display:flex;margin-top:1.1rem;">' + _btn(_ID + '-ok', 'Entendido', true) + '</div>');
                document.getElementById(_ID + '-ok').onclick = () => { v.cerrar(); resolve(); };
            });
        },
    };

    const api = { VERSION: 'v863', esReto, resolver, abrirAlta, legible, _ui: ui };
    window.CronosMFA = api;
})();

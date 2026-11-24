// ══════════════════════════════════════════════════════════════════
//  test_mfa_superadmin.js · v862 · SEGUNDO FACTOR (TOTP) DEL SUPERADMIN
// ══════════════════════════════════════════════════════════════════
//  Propuesta: PROPUESTA_MFA_SA.md (T3). Con MFA activo, Firebase NO abre la
//  sesión con la contraseña: lanza `auth/multi-factor-auth-required` y hay
//  que completar con el código de 6 dígitos. Si un camino de acceso no lo
//  trata, el SuperAdmin se queda FUERA de ese camino.
//
//  A · comportamiento de js/services/auth/mfa.js, EJECUTADO con un SDK falso
//      (la interfaz `_ui` se sustituye: aquí no hay navegador).
//  B · los 5 caminos de acceso tratan el reto, y las piezas están cargadas
//      (firebase-init, live.html, index.html, sw.js).
//  C · el script de recuperación no escribe por defecto ni toca producción
//      sin un indicador aparte.
// ══════════════════════════════════════════════════════════════════
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
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; } };
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const MFA_SRC = read('js/services/auth/mfa.js');
const INIT    = sinCom(read('js/services/firebase-init.js'));
const AUTH    = sinCom(read('js/services/auth.js'));
const PWD     = sinCom(read('js/services/auth/password.js'));
const DIAG    = sinCom(read('js/admin/superadmin/diagnostico.js'));
const LIVE    = read('live.html');
const INDEX   = read('index.html');
const SW      = read('sw.js');
const RECUP   = read('scripts/ops/mfa_quitar_factor.js');

// ── Carga de mfa.js en un sandbox ───────────────────────────────────
const consola = [];
function cargar(me) {
    const win = {
        _cronosCurrentUser: me || { role: 'superadmin' },
        console: {
            log: (...a) => consola.push(a.join(' ')), warn: (...a) => consola.push(a.join(' ')),
            error: (...a) => consola.push(a.join(' ')), info: (...a) => consola.push(a.join(' ')),
        },
    };
    win.window = win;
    const ctx = vm.createContext(win);
    vm.runInContext(MFA_SRC, ctx, { filename: 'mfa.js' });
    return win.CronosMFA;
}
const errCode = (code) => { const e = new Error(code); e.code = code; return e; };

function sdkFalso(op) {
    op = op || {};
    const reg = { resolverArgs: null, assertSignIn: [], resolveCalls: 0, reauth: 0, enroll: null, assertEnroll: null, session: 0 };
    let fallos = op.fallosCodigo || 0;
    const hints = op.hints || [{ factorId: 'phone', uid: 'h-phone' }, { factorId: 'totp', uid: 'h-totp', displayName: 'Móvil' }];
    const user = { email: 'sa@ejemplo.test', emailVerified: op.emailVerified !== false };
    const secret = { secretKey: 'JBSWY3DPEHPK3PXP', generateQrCodeUrl: (cuenta, emisor) => 'otpauth://totp/' + emisor + ':' + cuenta + '?secret=JBSWY3DPEHPK3PXP' };
    const sdk = {
        auth: { currentUser: user },
        getMultiFactorResolver(auth, err) {
            reg.resolverArgs = [auth, err];
            return {
                hints,
                resolveSignIn: async (a) => {
                    reg.resolveCalls++;
                    if (fallos > 0) { fallos--; throw errCode('auth/invalid-verification-code'); }
                    return { user, assertion: a };
                },
            };
        },
        TotpMultiFactorGenerator: {
            FACTOR_ID: 'totp',
            assertionForSignIn: (uid, code) => { reg.assertSignIn.push([uid, code]); return { tipo: 'signin', uid, code }; },
            assertionForEnrollment: (s, code) => { reg.assertEnroll = [s, code]; return { tipo: 'enroll', code }; },
            generateSecret: async () => secret,
        },
        multiFactor: () => ({
            enrolledFactors: op.yaInscritos || [],
            getSession: async () => { reg.session++; return { s: 1 }; },
            enroll: async (a, nombre) => { reg.enroll = [a, nombre]; },
        }),
        EmailAuthProvider: { credential: (e, p) => ({ e, p }) },
        reauthenticateWithCredential: async () => {
            reg.reauth++;
            if (op.reauthConReto && reg.reauth === 1) throw errCode('auth/multi-factor-auth-required');
        },
    };
    return { sdk, reg, user, secret };
}
function uiFalsa(m, guion) {
    const g = Object.assign({ codigos: ['123456'], contrasena: 'clave', alta: [{ codigo: '654321', nombre: 'Móvil' }] }, guion || {});
    const log = { pedirCodigo: [], pedirContrasena: 0, mostrarSecreto: [], aviso: [] };
    m._ui = {
        pedirCodigo: async (o) => { log.pedirCodigo.push(o); return g.codigos.length ? g.codigos.shift() : null; },
        pedirContrasena: async () => { log.pedirContrasena++; return g.contrasena; },
        mostrarSecreto: async (o) => { log.mostrarSecreto.push(o); return g.alta.length ? g.alta.shift() : null; },
        aviso: async (o) => { log.aviso.push(o); },
    };
    return log;
}

(async () => {
    // ═════════════════════ A · mfa.js ejecutado ═════════════════════
    ok('A0 · existe js/services/auth/mfa.js', MFA_SRC.length > 0);
    let M = null;
    try { M = MFA_SRC ? cargar() : null; } catch (e) { ok('A0b · mfa.js se evalúa sin errores', false, e.message); }
    if (!M) {
        ok('A0c · publica window.CronosMFA', false, 'sin módulo no hay nada que probar');
    } else {
        ok('A1 · esReto reconoce SOLO auth/multi-factor-auth-required',
           M.esReto(errCode('auth/multi-factor-auth-required')) === true &&
           M.esReto(errCode('auth/invalid-credential')) === false && M.esReto(null) === false);

        // A2 · camino feliz
        {
            const { sdk, reg } = sdkFalso(); const log = uiFalsa(M);
            const reto = errCode('auth/multi-factor-auth-required');
            const cred = await M.resolver(reto, sdk);
            ok('A2 · getMultiFactorResolver(auth, error)', reg.resolverArgs && reg.resolverArgs[0] === sdk.auth && reg.resolverArgs[1] === reto);
            ok('A2b · elige la pista TOTP aunque haya otra delante',
               reg.assertSignIn.length === 1 && reg.assertSignIn[0][0] === 'h-totp' && reg.assertSignIn[0][1] === '123456');
            ok('A2c · completa con resolveSignIn y devuelve la credencial',
               reg.resolveCalls === 1 && cred && cred.assertion && cred.assertion.tipo === 'signin');
            ok('A2d · pide el código UNA vez', log.pedirCodigo.length === 1);
        }
        // A3 · un código erróneo y luego el bueno
        {
            const { sdk, reg } = sdkFalso({ fallosCodigo: 1 }); const log = uiFalsa(M, { codigos: ['111111', '123456'] });
            await M.resolver(errCode('auth/multi-factor-auth-required'), sdk);
            ok('A3 · código erróneo → lo vuelve a pedir con aviso y entra al segundo',
               log.pedirCodigo.length === 2 && !!log.pedirCodigo[1].error && reg.resolveCalls === 2);
        }
        // A4 · cancelar
        {
            const { sdk, reg } = sdkFalso(); uiFalsa(M, { codigos: [] });
            let e = null; try { await M.resolver(errCode('auth/multi-factor-auth-required'), sdk); } catch (x) { e = x; }
            ok('A4 · cancelar → error cronos/mfa-cancelado y NO se llama a resolveSignIn',
               e && e.code === 'cronos/mfa-cancelado' && reg.resolveCalls === 0);
        }
        // A5 · cinco erróneos
        {
            const { sdk, reg } = sdkFalso({ fallosCodigo: 99 });
            const log = uiFalsa(M, { codigos: ['111111', '222222', '333333', '444444', '555555', '666666'] });
            let e = null; try { await M.resolver(errCode('auth/multi-factor-auth-required'), sdk); } catch (x) { e = x; }
            ok('A5 · tope de 5 intentos y sale con auth/invalid-verification-code',
               e && e.code === 'auth/invalid-verification-code' && log.pedirCodigo.length === 5 && reg.resolveCalls === 5);
        }
        // A6 · sin pista TOTP
        {
            const { sdk, reg } = sdkFalso({ hints: [{ factorId: 'phone', uid: 'p' }] }); uiFalsa(M);
            let e = null; try { await M.resolver(errCode('auth/multi-factor-auth-required'), sdk); } catch (x) { e = x; }
            ok('A6 · sin factor TOTP → cronos/mfa-sin-totp, sin pedir código', e && e.code === 'cronos/mfa-sin-totp' && reg.resolveCalls === 0);
        }
        // A7 · limpieza del código
        {
            const { sdk, reg } = sdkFalso(); const log = uiFalsa(M, { codigos: ['12a45', ' 123 456 '] });
            await M.resolver(errCode('auth/multi-factor-auth-required'), sdk);
            ok('A7 · «12a45» no llega a Firebase; « 123 456 » se limpia a 123456',
               reg.resolveCalls === 1 && reg.assertSignIn[0][1] === '123456' && log.pedirCodigo.length === 2);
        }
        // A8 · alta del SuperAdmin
        {
            const { sdk, reg, secret } = sdkFalso(); const log = uiFalsa(M);
            const r = await M.abrirAlta(sdk);
            ok('A8 · alta: reautentica con la contraseña antes de pedir la sesión', reg.reauth === 1 && log.pedirContrasena === 1 && reg.session === 1);
            ok('A8b · enseña la clave y el enlace otpauth (sin servicios externos)',
               log.mostrarSecreto.length === 1 && log.mostrarSecreto[0].secretKey === secret.secretKey &&
               /^otpauth:\/\//.test(log.mostrarSecreto[0].url));
            ok('A8c · confirma con assertionForEnrollment(secret, código) y enroll(…, nombre)',
               reg.assertEnroll && reg.assertEnroll[0] === secret && reg.assertEnroll[1] === '654321' &&
               reg.enroll && reg.enroll[1] === 'Móvil' && r && r.ok === true);
        }
        // A9 · correo sin verificar
        {
            const { sdk, reg } = sdkFalso({ emailVerified: false }); const log = uiFalsa(M);
            const r = await M.abrirAlta(sdk);
            ok('A9 · correo sin verificar → se explica y no se pide sesión',
               r && r.ok === false && r.motivo === 'cronos/mfa-correo-sin-verificar' && reg.session === 0 && log.aviso.length === 1);
        }
        // A10 · quien no es SuperAdmin
        {
            const M2 = cargar({ role: 'coach' });
            const { sdk, reg } = sdkFalso(); uiFalsa(M2);
            const r = await M2.abrirAlta(sdk);
            ok('A10 · el alta se niega a quien no es SuperAdmin', r && r.ok === false && reg.session === 0 && reg.reauth === 0);
        }
        // A11 · ya tiene un factor: la reautenticación pide el código
        {
            const { sdk, reg } = sdkFalso({ reauthConReto: true, yaInscritos: [{ factorId: 'totp', displayName: 'Móvil' }] });
            const log = uiFalsa(M, { alta: [{ codigo: '654321', nombre: 'Reserva' }] });
            const r = await M.abrirAlta(sdk);
            ok('A11 · segundo aparato: la reautenticación pasa por el código y luego se da de alta',
               log.pedirCodigo.length === 1 && reg.resolveCalls === 1 && reg.enroll && reg.enroll[1] === 'Reserva' && r.ok === true);
        }
        ok('A12 · ni el código ni la clave secreta llegan a la consola',
           !consola.some((l) => /123456|654321|JBSWY3DPEHPK3PXP/.test(l)), consola.join(' | '));
    }

    // ═════════════════════ B · los caminos de acceso ═════════════════
    ok('B1 · mfa.js es un script CLÁSICO (sin import/export)', MFA_SRC && !/^\s*(import|export)\s/m.test(sinCom(MFA_SRC)));
    ok('B1b · su ventana queda por ENCIMA de la del diagnóstico (z-index 2147483500)',
       (() => { const m = MFA_SRC.match(/z-index:\s*(\d+)/); return m && Number(m[1]) > 2147483500; })());
    ['getMultiFactorResolver', 'TotpMultiFactorGenerator', 'multiFactor'].forEach((f) => {
        const imp = INIT.slice(0, INIT.indexOf("firebase-auth.js'"));
        ok('B2 · firebase-init importa ' + f, new RegExp('\\b' + f + '\\b').test(imp.slice(imp.lastIndexOf('const {'))));
        ok('B2b · firebase-init publica ' + f, new RegExp('\\b' + f + '\\b').test(INIT.slice(INIT.indexOf('window._cronos_auth = {'))));
    });

    // auth.js · inicio de sesión
    const iLogin = AUTH.indexOf('if (_isLoginMode) {');
    const login = iLogin >= 0 ? AUTH.slice(iLogin, AUTH.indexOf('return; // onAuthStateChanged', iLogin) + 40) : '';
    ok('B3 · auth.js (login) trata el reto con CronosMFA.resolver(…, fa)',
       /CronosMFA\.esReto\(/.test(login) && /CronosMFA\.resolver\([^)]*,\s*fa\)/.test(login));
    {
        const race = (login.match(/Promise\.race\(\[[\s\S]*?\]\)/) || [''])[0];
        ok('B3b · la espera del código va FUERA del tope de 6 s', race && !/CronosMFA/.test(race));
    }
    // auth.js · registro con correo existente
    const iReg = AUTH.indexOf("createErr.code === 'auth/email-already-in-use'");
    const reg = iReg >= 0 ? AUTH.slice(iReg, AUTH.indexOf('} catch (signInErr)', iReg)) : '';
    ok('B4 · auth.js (registro con correo existente) trata el reto', /CronosMFA\.esReto\(/.test(reg) && /CronosMFA\.resolver\(/.test(reg));

    // password.js · reautenticación y botón de alta
    const iSub = PWD.indexOf('window.cronosSubmitPasswordChange');
    const sub = iSub >= 0 ? PWD.slice(iSub, PWD.indexOf('fa.updatePassword(user, nueva)', iSub)) : '';
    ok('B5 · password.js reautentica pasando por el reto', /reauthenticateWithCredential/.test(sub) && /CronosMFA\.resolver\(/.test(sub));
    {
        const iAv = PWD.indexOf('const _avisoSA = _esSuperAdmin()');
        const av = iAv >= 0 ? PWD.slice(iAv, PWD.indexOf("        : '';", iAv)) : '';
        ok('B5b · el botón de alta sólo aparece en el aviso del SuperAdmin', /CronosMFA\.abrirAlta\(/.test(av));
        ok('B5c · y no aparece fuera de él', (PWD.match(/CronosMFA\.abrirAlta\(/g) || []).length === 1);
    }
    // diagnostico.js
    const iDg = DIAG.indexOf('function _pedirClaveMaestra');
    const dg = iDg >= 0 ? DIAG.slice(iDg, DIAG.indexOf('window._saEntrarDiagnostico', iDg)) : '';
    ok('B6 · diagnóstico (credencial maestra) trata el reto', /CronosMFA\.esReto\(/.test(dg) && /CronosMFA\.resolver\(/.test(dg));

    // live.html
    {
        const imp = (LIVE.match(/import \{[^}]*\}\s*from 'https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js'/) || [''])[0];
        ok('B7 · live.html importa getMultiFactorResolver y TotpMultiFactorGenerator',
           /getMultiFactorResolver/.test(imp) && /TotpMultiFactorGenerator/.test(imp));
        const iL = LIVE.indexOf('window.doLiveAuth');
        const la = iL >= 0 ? LIVE.slice(iL, LIVE.indexOf('};', iL)) : '';
        ok('B7b · el visor trata el reto', /CronosMFA\.esReto\(/.test(la) && /CronosMFA\.resolver\(/.test(la));
        ok('B7c · live.html carga mfa.js', /<script src="js\/services\/auth\/mfa\.js(\?v=[^"]*)?"><\/script>/.test(LIVE));
    }
    ok('B8 · index.html carga mfa.js', /<script src="js\/services\/auth\/mfa\.js(\?v=[^"]*)?"><\/script>/.test(INDEX));
    ok('B8b · el service worker lo precachea', /'\.\/js\/services\/auth\/mfa\.js'/.test(SW));

    // ═════════════════════ C · recuperación ══════════════════════════
    ok('C1 · existe scripts/ops/mfa_quitar_factor.js', RECUP.length > 0);
    ok('C2 · por defecto NO escribe (hace falta --quitar)', /--quitar/.test(RECUP) && /EN SECO/i.test(RECUP));
    ok('C3 · producción exige un indicador aparte', /--confirmo-produccion/.test(RECUP));
    ok('C4 · el proyecto se da explícito (prod|test)', /--proyecto/.test(RECUP) && /cronos-futbol-test/.test(RECUP));

    console.log('\n' + '─'.repeat(60));
    console.log(`Resultado: ${pass} PASS · ${fail} FAIL`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

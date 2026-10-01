// ════════════════════════════════════════════════════════════════════
//  scripts/test_invitacion_no_caduca_v779.js
//  🔴 v779 · «Este enlace de invitación ya no es válido» con una invitación
//  recién creada (CD Arinaga, 01-10). EJECUTA el código real contra dobles:
//   1. el lector ESPERA a Firebase en vez de devolver null al instante;
//   2. un fallo de red NO se presenta como «caducada»;
//   3. una sesión que YA estaba abierta NO consume la invitación al abrirla.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const UTILS = fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8');
const PREF = fs.readFileSync(path.join(RAIZ, 'js/services/auth/invite-prefill.js'), 'utf8');

let pass = 0, fail = 0;
function ok(nombre, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + nombre); }
    else { fail++; console.log('  ❌ ' + nombre + (extra ? '\n     → ' + extra : '')); }
}

// ── El lector, con el import() del SDK cambiado por un doble ──
function montarLector(modulo, auth) {
    const desde = UTILS.indexOf('if (typeof window.cronosLeerInvitacion');
    const hasta = UTILS.indexOf('if (typeof window.cronosConsumirInvitacion');
    const fuente = UTILS.slice(desde, hasta).replace(
        /await import\('https:\/\/www\.gstatic\.com[^']*'\)/g, '__mod');
    const sb = {
        console: { log() {}, warn() {} }, Date, Promise, String, RegExp, Object,
        // Esperas comprimidas: la prueba no tiene por qué tardar segundos.
        setTimeout: (f) => setTimeout(f, 1),
        __mod: modulo,
    };
    sb.window = sb;
    if (auth !== undefined) sb._cronos_auth = auth;
    vm.createContext(sb);
    vm.runInContext(fuente, sb);
    return sb;
}
const DOC_VIVO = { exists: () => true, data: () => ({ email: 'a@b.es', role: 'club_admin', clubName: 'CD ARINAGA' }) };
const TOKEN = '0123456789abcdef0123456789abcdef';

(async () => {
    console.log('\n1) ⏳ Firebase todavía no está: se ESPERA');
    {
        const sb = montarLector({ doc: () => ({}), getDoc: async () => DOC_VIVO }, null);
        // Firebase aparece «más tarde», como hace el módulo diferido.
        setTimeout(() => { sb._cronos_auth = { db: {} }; }, 30);
        const r = await sb.cronosResolverInvitacion(TOKEN);
        ok('1a · 🔑 una invitación viva con Firebase tardío sale VÁLIDA',
           r.estado === 'ok' && r.inv.clubName === 'CD ARINAGA', JSON.stringify(r));
        const inv = await sb.cronosLeerInvitacion(TOKEN);
        ok('1b · y el envoltorio de siempre devuelve sus datos', inv && inv.email === 'a@b.es');
    }

    console.log('\n2) 📶 Un fallo de red no es «caducada»');
    {
        let n = 0;
        const sb = montarLector({ doc: () => ({}), getDoc: async () => {
            if (++n < 3) { const e = new Error('offline'); e.code = 'unavailable'; throw e; }
            return DOC_VIVO;
        } }, { db: {} });
        const r = await sb.cronosResolverInvitacion(TOKEN);
        ok('2a · 🔑 dos fallos de red y luego respuesta → VÁLIDA (se reintenta)', r.estado === 'ok', JSON.stringify(r));

        const sb2 = montarLector({ doc: () => ({}), getDoc: async () => {
            const e = new Error('offline'); e.code = 'unavailable'; throw e;
        } }, { db: {} });
        const r2 = await sb2.cronosResolverInvitacion(TOKEN);
        ok('2b · 🔑 sin red persistente → «error», NO «invalida»', r2.estado === 'error', JSON.stringify(r2));

        let d = 0;
        const sb3 = montarLector({ doc: () => ({}), getDoc: async () => {
            d++; const e = new Error('Missing or insufficient permissions'); e.code = 'permission-denied'; throw e;
        } }, { db: {} });
        const r3 = await sb3.cronosResolverInvitacion(TOKEN);
        ok('2c · la regla la deniega de verdad (caducada/usada) → «invalida»', r3.estado === 'invalida', JSON.stringify(r3));
        ok('2d · …con UN reintento, por si App Check aún no tenía token', d === 2, 'intentos: ' + d);

        const sb4 = montarLector({ doc: () => ({}), getDoc: async () => ({ exists: () => false }) }, { db: {} });
        ok('2e · un token que no existe → «invalida»', (await sb4.cronosResolverInvitacion(TOKEN)).estado === 'invalida');
        ok('2f · un token con forma de ruta → «invalida» sin tocar la red',
           (await sb4.cronosResolverInvitacion('../../users/x')).estado === 'invalida');
    }

    console.log('\n3) 🔐 Una sesión que YA estaba no consume la invitación');
    {
        function montarPrefill() {
            let oyente = null;
            const consumidas = [];
            const notas = {};
            const sb = {
                console: { log() {}, warn() {}, error() {} },
                location: { search: '?invite=' + TOKEN },
                document: {
                    getElementById: (id) => notas[id] || (id === 'auth-email'
                        ? (notas[id] = { id, value: '', style: {}, parentNode: { insertBefore(n) { notas[n.id] = n; } }, nextSibling: null })
                        : null),
                    createElement: () => ({ id: '', style: {}, innerHTML: '' }),
                },
                URLSearchParams, Date, Promise, String, Number, Array, Object, RegExp, Math, JSON,
                Event: function () {},
                setTimeout: (f) => setTimeout(f, 0),
                _cronos_auth: { auth: { currentUser: null }, onAuthStateChanged: (a, cb) => { oyente = cb; } },
                cronosResolverInvitacion: async () => ({ estado: 'ok', inv: { token: TOKEN, email: 'a@b.es', role: '', clubName: '' } }),
                cronosConsumirInvitacion: (t) => { consumidas.push(t); },
            };
            sb.window = sb;
            vm.createContext(sb);
            vm.runInContext(PREF, sb);
            return { sb, consumidas, notas, avisar: (u) => oyente && oyente(u) };
        }
        const espera = () => new Promise((r) => setTimeout(r, 20));

        // a) El SuperAdmin (u otra cuenta) ya estaba dentro al abrir el enlace.
        const A = montarPrefill();
        await espera();
        A.avisar({ uid: 'uid_superadmin' });     // primer aviso: la sesión previa
        await A.sb.cronosAplicarInvitacion(new URLSearchParams('?invite=' + TOKEN));
        await espera();
        ok('3a · 🔴🔴 abrir el enlace con una sesión previa NO la marca usada',
           A.consumidas.length === 0, 'consumidas: ' + JSON.stringify(A.consumidas));
        ok('3b · y la pantalla dice que la invitación es válida',
           /Invitación válida/.test((A.notas['inv-nota-token'] || {}).innerHTML || ''));
        A.avisar({ uid: 'uid_nuevo_admin' });     // ahora sí: el alta crea su cuenta
        ok('3c · 🔑 cuando el invitado crea SU cuenta, se consume', A.consumidas.length === 1);
        A.avisar({ uid: 'uid_nuevo_admin' });
        ok('3d · y una sola vez', A.consumidas.length === 1);

        // b) Lectura lenta: la cuenta nueva aparece ANTES de que el token se resuelva.
        const B = montarPrefill();
        await espera();
        B.avisar(null);                            // nadie dentro al abrir
        B.avisar({ uid: 'uid_rapido' });           // se dio de alta muy deprisa
        await B.sb.cronosAplicarInvitacion(new URLSearchParams('?invite=' + TOKEN));
        ok('3e · 🔴 aunque el token llegue tarde, la invitación se consume igual',
           B.consumidas.length === 1, 'antes el vigilante miraba una vez a los 400 ms y se iba');
    }

    console.log('\n4) 💬 Los mensajes');
    {
        ok('4a · «sin red» tiene su propio aviso con «Reintentar»',
           /No hemos podido comprobar tu invitación[\s\S]*?Reintentar/.test(PREF));
        ok('4b · se avisa mientras se comprueba', /Comprobando tu invitación/.test(PREF));
    }

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

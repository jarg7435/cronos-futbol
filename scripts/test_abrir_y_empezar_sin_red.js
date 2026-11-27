// ─────────────────────────────────────────────────────────────────────────
// test_abrir_y_empezar_sin_red.js · La app instalada abre y empieza partidos
// SIN RED (v867, Fases 2b y 2c de la pérdida de red)
//
// PRUEBA DE CAMPO DEL 26-11 (VALIDACION §4): cerrada la app sin red, no dejaba
// entrar. La sesión vivía en sessionStorage (v638) y moría al cerrarla.
//
// 2b · DECISIÓN DEL TITULAR (27-11): sesión persistente SÓLO en la app
//      instalada (display-mode standalone), con límite de 12 h desde el último
//      inicio de sesión con contraseña, o hasta acabar el partido en curso.
//      En el navegador, como siempre (se cierra al salir). SuperAdmin
//      excluido. En el navegador Auth NI MIRA la sesión de la app instalada
//      (Android/PC comparten almacenamiento): no vuelve el «entra solo» de v638.
//
// 2c · ENCARGO DEL TITULAR: abrir con red, llegar al campo sin red y pulsar
//      crear/empezar partido no puede quedarse esperando a la red. La reserva
//      de plaza (session-lock.js) esperaba hasta 8 s POR ESCRITURA: con la
//      caché persistente un setDoc no termina hasta que el servidor confirma.
//      Sin red, el tope baja a lo que tarda leer de la caché; la escritura
//      queda en la cola local y sube sola.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 240)); }
};
const leer = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return ''; } };
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const H = 3600 * 1000;
const AHORA = Date.parse('2026-11-28T18:00:00Z');

console.log('── Abrir y empezar sin red (v867) ──\n');

// ═══════════ PARTE 1 · el módulo de la sesión de la app ═══════════
console.log('── PARTE 1 · js/services/auth/sesion-app.js ──');
const MOD = leer('js/services/auth/sesion-app.js');
ok('1a · el módulo existe', !!MOD);
let S = null;
if (MOD) {
    const win = {};
    const sb = { window: win, console: { log() {}, warn() {} }, Date, JSON, Number, String, Object, Array, isFinite };
    vm.createContext(sb);
    try { vm.runInContext(MOD, sb); S = win.cronosSesionApp; } catch (e) { console.log('       ' + e.message); }
}
ok('1b · publica window.cronosSesionApp', !!S);
if (S) {
    ok('1c · el límite es de 12 h', S.LIMITE_MS === 12 * H, S.LIMITE_MS);

    // ¿App instalada?
    const mm = (v) => () => ({ matches: v });
    ok('1d · display-mode standalone → app instalada', S.esAppInstalada({ matchMedia: mm(true), navigator: {} }) === true);
    ok('1e · iOS navigator.standalone → app instalada', S.esAppInstalada({ matchMedia: mm(false), navigator: { standalone: true } }) === true);
    ok('1f · pestaña del navegador → NO', S.esAppInstalada({ matchMedia: mm(false), navigator: {} }) === false);
    ok('1g · sin matchMedia ni nada → NO (falla hacia el navegador)', S.esAppInstalada({}) === false);

    // Caducidad
    const ini = (h) => new Date(AHORA - h * H).toUTCString();   // formato de user.metadata.lastSignInTime
    ok('1h · 11 h desde el inicio de sesión → vigente', S.caducada(ini(11), AHORA, false) === false);
    ok('1i · 13 h y sin partido → caducada', S.caducada(ini(13), AHORA, false) === true);
    ok('1j · 🔑 13 h CON partido en curso → vigente hasta que acabe', S.caducada(ini(13), AHORA, true) === false);
    ok('1k · sin hora de inicio de sesión → caducada (pide contraseña)', S.caducada('', AHORA, false) === true);
    ok('1l · hora basura → caducada', S.caducada('ayer', AHORA, false) === true);

    // SuperAdmin
    ok('1m · claim superadmin → excluido', S.esSuperAdmin({ role: 'superadmin' }) === true);
    ok('1n · entrenador → no', S.esSuperAdmin({ role: 'user' }) === false && S.esSuperAdmin(null) === false);

    // ¿Partido en curso de ESTA cuenta en el aparato?
    const slot = (o) => JSON.stringify(Object.assign({ savedAt: new Date(AHORA - 10 * 60000).toISOString(), matchPhase: '1st_half', ownerUid: 'UIDA' }, o));
    const alm = (obj) => ({ claves: () => Object.keys(obj), lee: (k) => (k in obj ? obj[k] : null) });
    ok('1o · ranura viva de la cuenta → hay partido',
       S.hayPartidoEnCurso('UIDA', alm({ 'cronos_active_match_v2::m1@UIDA': slot() }), AHORA) === true);
    ok('1p · ranura de OTRA cuenta → no cuenta',
       S.hayPartidoEnCurso('UIDA', alm({ 'cronos_active_match_v2::m1@UIDB': slot({ ownerUid: 'UIDB' }) }), AHORA) === false);
    ok('1q · partido terminado → no',
       S.hayPartidoEnCurso('UIDA', alm({ 'cronos_active_match_v2::m1@UIDA': slot({ matchPhase: 'finished' }) }), AHORA) === false);
    ok('1r · con la bandera de fin → no',
       S.hayPartidoEnCurso('UIDA', alm({ 'cronos_active_match_v2::m1@UIDA': slot(),
                                         'cronos_active_match_v2_finished::m1@UIDA': '1' }), AHORA) === false);
    ok('1s · ranura abandonada hace más de 3 h → no alarga la sesión',
       S.hayPartidoEnCurso('UIDA', alm({ 'cronos_active_match_v2::m1@UIDA': slot({ savedAt: new Date(AHORA - 4 * H).toISOString() }) }), AHORA) === false);
    ok('1t · sin uid → no', S.hayPartidoEnCurso('', alm({ 'cronos_active_match_v2::m1@UIDA': slot() }), AHORA) === false);
}

// ═══════════ PARTE 2 · firebase-init.js ═══════════
console.log('\n── PARTE 2 · firebase-init.js ──');
{
    const FI = sinCom(leer('js/services/firebase-init.js'));
    const iInit = FI.search(/initializeAuth\s*\(\s*app\s*,/);
    const iGet = FI.indexOf('const auth = getAuth(app);');
    ok('2a · Auth se inicializa con initializeAuth ANTES de getAuth', iInit !== -1 && iGet !== -1 && iInit < iGet);
    const trozo = iInit !== -1 ? FI.slice(Math.max(0, iInit - 1200), iGet) : '';
    ok('2b · en la app instalada: browserLocalPersistence primero',
       /esAppInstalada/.test(trozo) && /\[\s*browserLocalPersistence\s*,\s*browserSessionPersistence\s*\]/.test(trozo));
    ok('2c · 🔑 en el navegador: SÓLO browserSessionPersistence (no mira la sesión de la app)',
       /\[\s*browserSessionPersistence\s*\]/.test(trozo));
    ok('2d · el setPersistence(session) de v638 sólo en el navegador',
       /if\s*\(\s*!\s*_enAppInstalada\s*\)\s*setPersistence\(\s*auth\s*,\s*browserSessionPersistence\s*\)/.test(FI));
    const iObs = FI.indexOf('await checkAuthorization(user);');
    const obs = iObs !== -1 ? FI.slice(Math.max(0, iObs - 4000), iObs) : '';
    ok('2e · antes de autorizar, la app instalada comprueba la caducidad (12 h / partido)',
       /cronosSesionApp[\s\S]{0,200}caducada\s*\(/.test(obs) && /hayPartidoEnCurso\s*\(/.test(obs));
    ok('2f · caducada → signOut y pantalla de acceso', /caducada[\s\S]{0,600}signOut\(\s*auth\s*\)/.test(obs));
    ok('2g · SuperAdmin en la app instalada → la sesión vuelve a sessionStorage',
       /esSuperAdmin\s*\([\s\S]{0,300}setPersistence\(\s*auth\s*,\s*browserSessionPersistence\s*\)/.test(obs));
    ok('2h · también se revisa al volver la app al primer plano', /visibilitychange[\s\S]{0,800}caducada\s*\(/.test(FI));
}

// ═══════════ PARTE 3 · carga ═══════════
console.log('\n── PARTE 3 · carga del módulo ──');
{
    const IX = leer('index.html');
    const iMod = IX.indexOf('<script src="js/services/auth/sesion-app.js');
    const iFi = IX.indexOf('src="js/services/firebase-init.js');
    ok('3a · index.html carga sesion-app.js (clásico) antes de firebase-init.js', iMod !== -1 && iFi !== -1 && iMod < iFi);
    const SW = leer('sw.js');
    const iA = SW.indexOf('const ASSETS = [');
    ok('3b · sesion-app.js va al precache', SW.slice(iA, SW.indexOf('];', iA)).indexOf("'./js/services/auth/sesion-app.js'") !== -1);
}

// ═══════════ PARTE 4 · 2c · reserva de plaza sin red ═══════════
console.log('\n── PARTE 4 · empezar partido sin red: reserva de plaza ──');
{
    const SL = leer('js/services/auth/session-lock.js');
    const i = SL.indexOf('function _conTope(');
    const f = SL.indexOf('\n    }', i);
    const cuerpo = (i !== -1 && f > i) ? SL.slice(i, f + 6) : '';
    ok('4a · _conTope sigue existiendo', !!cuerpo);
    if (cuerpo) {
        // Se EJECUTA con relojes reales y cortos.
        const mk = (online) => {
            const sb = { navigator: { onLine: online }, setTimeout, clearTimeout, Promise, window: {} };
            vm.createContext(sb);
            const pre = /TOPE_SIN_RED_MS/.test(SL) ? (SL.match(/var\s+TOPE_SIN_RED_MS\s*=\s*\d+\s*;/) || [''])[0] : '';
            vm.runInContext('var TOPE_RED_MS = 8000;\n' + pre + '\n' + cuerpo + '\n;globalThis.ct = _conTope;', sb);
            return sb.ct;
        };
        const nunca = () => new Promise(() => {});
        const t0 = Date.now();
        mk(false)(nunca()).then(() => 'resuelve', (e) => e && e.code).then((r) => {
            const dt = Date.now() - t0;
            ok('4b · 🔑 SIN RED, una escritura que no termina se suelta en ≤ 2 s (antes 8 s)', r === 'cronos/tope' && dt <= 2100, r + ' en ' + dt + ' ms');
            const sinRedMs = Number(((SL.match(/var\s+TOPE_SIN_RED_MS\s*=\s*(\d+)/) || [])[1]) || 0);
            ok('4c · …pero da tiempo a leer de la caché (≥ 500 ms)', sinRedMs >= 500, sinRedMs);
            ok('4d · CON red el tope sigue en 8 s', /TOPE_RED_MS\s*=\s*8000/.test(SL) && /navigator\.onLine\s*===\s*false/.test(cuerpo));
            const lect = mk(false)(Promise.resolve('cache'));
            return lect.then((v) => ok('4e · sin red, una lectura de caché que responde sale bien', v === 'cache'));
        }).then(fin, (e) => { ok('4x · ejecución', false, e && e.message); fin(); });
    } else fin();
}

function fin() {
    // ═══════════ PARTE 5 · 2c · el resto del arranque del partido ═══════════
    console.log('\n── PARTE 5 · el resto del arranque no espera a la red ──');
    const IM = sinCom(leer('js/ai/import.js'));
    const iS = IM.indexOf('function startMatchWithConvocation()');
    const cuerpo = iS !== -1 ? IM.slice(iS, IM.indexOf('\nfunction ', iS + 10)) : '';
    ok('5a · startMatchWithConvocation no es async ni espera nada', iS !== -1 && !/^\s*async\s/.test(IM.slice(iS - 6, iS)) &&
       !/\n    await\s/.test(cuerpo));
    ok('5b · la lectura del club va en segundo plano (Promise.resolve().then)', /Promise\.resolve\(\)\.then\(async/.test(cuerpo));
    ok('5c · la transmisión arranca DETRÁS, sin bloquear la pantalla', /setTimeout\(\(\)\s*=>\s*startLiveSync\(\),\s*800\)/.test(cuerpo));
    const SM = sinCom(leer('js/core/setup-modal.js'));
    ok('5d · confirmSetup: si la reserva de plaza falla, el partido empieza igual',
       /cronosSesionAlAbrirPartido\(\)\)[\s\S]{0,200}\.catch\(function \(\)\s*\{\s*_confirmSetupAhora\(\);/.test(SM));

    // ═══════════ PARTE 6 · la caché en disco reconoce la sesión de la app ═══════════
    console.log('\n── PARTE 6 · fs-cache-mode.js ve la sesión de la app instalada ──');
    const FM = sinCom(leer('js/shared/fs-cache-mode.js'));
    const iU = FM.indexOf('function uidDeSesion()');
    const uCuerpo = iU !== -1 ? FM.slice(iU, FM.indexOf('\n    }', iU) + 6) : '';
    ok('6a · uidDeSesion mira localStorage SÓLO en la app instalada',
       /esAppInstalada\(\)[\s\S]{0,300}localStorage/.test(uCuerpo));
    ok('6b · y sigue mirando primero sessionStorage (navegador, v638)',
       uCuerpo.indexOf('sessionStorage') !== -1 && uCuerpo.indexOf('sessionStorage') < uCuerpo.indexOf('localStorage'));

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
}

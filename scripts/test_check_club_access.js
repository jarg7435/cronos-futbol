// Verifica el fix "checkClubAccess nunca se invocaba":
//  1) La ÚNICA definición de window.checkClubAccess (js/core/app-init.js)
//     carga cl.timerThresholds en window._clubTimerThresholds.
//  2) js/services/auth.js la INVOCA en _launchWithRole (antes solo estaba
//     definida, nunca llamada -> los umbrales no se cargaban al login).
//  3) js/admin/club/panel.js ya NO redefine checkClubAccess (eclipsaba la
//     versión completa con una incompleta sin umbrales).
//  4) startMatchWithConvocation (js/ai/import.js, versión ACTIVA) refresca
//     los umbrales al empezar partido.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const appInit = fs.readFileSync(path.join(root, 'js', 'core', 'app-init.js'), 'utf8');
const auth    = fs.readFileSync(path.join(root, 'js', 'services', 'auth.js'), 'utf8');
const panel   = fs.readFileSync(path.join(root, 'js', 'admin', 'club', 'panel.js'), 'utf8');
const importJs = fs.readFileSync(path.join(root, 'js', 'ai', 'import.js'), 'utf8');

function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('No encontrada: ' + name);
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}
// checkClubAccess es `async function` -> aceptar ese prefijo.
function extractAsyncFn(src, name) {
    const start = src.indexOf('async function ' + name + '(');
    if (start < 0) throw new Error('No encontrada async: ' + name);
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

const results = [];
function check(name, cond, extra) {
    results.push({ name, ok: !!cond });
    console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? '  ' + extra : ''));
}

// ── 1) checkClubAccess carga umbrales ──────────────────────────────
(async () => {
    const ccaSrc = extractAsyncFn(appInit, 'checkClubAccess');
    check('checkClubAccess incluye carga de timerThresholds',
        ccaSrc.includes('window._clubTimerThresholds = cl.timerThresholds'));

    // Sandbox: mock saGet -> club con umbrales.
    const sandbox = {
        window: {},
        showToast: () => {},
        console,
        saGet: async (col, id) => ({ _id: id, status: 'active', timerThresholds: { red: 25, yellow: 55 } }),
    };
    vm.createContext(sandbox);
    vm.runInContext(ccaSrc + '\nthis.__cca = checkClubAccess;', sandbox);
    const ok = await sandbox.__cca({ clubId: 'club_test' });
    check('checkClubAccess devuelve true para club activo', ok === true);
    check('checkClubAccess publica window._clubTimerThresholds',
        sandbox.window._clubTimerThresholds &&
        sandbox.window._clubTimerThresholds.red === 25 &&
        sandbox.window._clubTimerThresholds.yellow === 55,
        JSON.stringify(sandbox.window._clubTimerThresholds));

    // Club bloqueado -> false y no fija umbrales.
    const sb2 = {
        window: {}, showToast: () => {}, console,
        saGet: async () => ({ status: 'blocked' }),
    };
    // signOut se importa dinámicamente; interceptamos import fallando -> catch no bloquea.
    vm.createContext(sb2);
    vm.runInContext(ccaSrc + '\nthis.__cca = checkClubAccess;', sb2);
    const okBlocked = await sb2.__cca({ clubId: 'x' }).catch(() => 'threw');
    check('checkClubAccess maneja club bloqueado sin fijar umbrales',
        sb2.window._clubTimerThresholds === undefined, 'ret=' + okBlocked);

    // ── 2) auth.js INVOCA checkClubAccess ──────────────────────────
    const launchSrc = extractFn(auth, '_launchWithRole');
    check('_launchWithRole invoca window.checkClubAccess',
        launchSrc.includes('window.checkClubAccess(window._cronosCurrentUser)'));
    check('la invocacion es best-effort (.catch)',
        /window\.checkClubAccess\(window\._cronosCurrentUser\)\.catch/.test(launchSrc));

    // ── 3) panel.js ya no redefine checkClubAccess ─────────────────
    check('panel.js NO redefine checkClubAccess',
        !/function checkClubAccess\(/.test(panel));
    check('panel.js NO reasigna window.checkClubAccess',
        !/window\.checkClubAccess\s*=/.test(panel));

    // Solo debe existir UNA definicion global en toda la app (app-init.js).
    check('app-init.js define checkClubAccess una sola vez',
        (appInit.match(/async function checkClubAccess\(/g) || []).length === 1);
    check('app-init.js asigna window.checkClubAccess una sola vez',
        (appInit.match(/window\.checkClubAccess\s*=/g) || []).length === 1);

    // ── 4) startMatchWithConvocation (import.js) refresca umbrales ──
    const smSrc = extractFn(importJs, 'startMatchWithConvocation');
    check('startMatchWithConvocation refresca timerThresholds',
        smSrc.includes('window._clubTimerThresholds = thresh'));
    // Y NO se coló en goToTitularSelection.
    const gttSrc = extractFn(importJs, 'goToTitularSelection');
    check('goToTitularSelection NO contiene la carga de umbrales (limpio)',
        !gttSrc.includes('window._clubTimerThresholds = thresh'));

    console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' OK');
    const failed = results.filter(r => !r.ok);
    if (failed.length) { console.error('FALLOS: ' + failed.map(f => f.name).join(', ')); process.exit(1); }
})();

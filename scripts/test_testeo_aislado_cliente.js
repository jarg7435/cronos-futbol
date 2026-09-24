// ─────────────────────────────────────────────────────────────────────────
//  test_testeo_aislado_cliente.js  ·  🧪 v761, fase D (2026-09-24)
//
//  El cliente elige proyecto por el DOMINIO. La regla vive en TRES sitios
//  (firebase-init.js, live.html —visor autónomo— y utils.js para los
//  enlaces), así que se ejecuta cada una con cada dominio posible y se exige
//  que las tres digan lo mismo.
//
//  🔑 Lo que no puede pasar nunca: que producción caiga en testeo (la app
//  real se quedaría sin sus datos) ni que testeo caiga en producción (el
//  incidente que motivó todo esto).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INIT = fs.readFileSync(path.join(ROOT, 'js', 'services', 'firebase-init.js'), 'utf8');
const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const UTILS = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 300)); }
};
const tramo = (src, desde, hasta) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No se encuentra: ' + desde);
    const j = src.indexOf(hasta, i); if (j < 0) throw new Error('No se encuentra el final: ' + hasta);
    return src.slice(i, j + hasta.length);
};

const T_INIT = tramo(INIT, 'const _host  =', "window.CRONOS_ENTORNO = _esTesteo ? 'testeo' : 'produccion';") + '\n' +
               tramo(INIT, 'const _RECAPTCHA_SITE_KEY =', ';');
const T_LIVE = tramo(LIVE, 'const _vHost = location.hostname;', "appId:             '1:393110572633:web:27a7effed60975e690ab48'\n};");
const T_LIVE_KEY = tramo(LIVE, 'new ReCaptchaV3Provider(_vEsTesteo', ')');
const T_UTILS = tramo(UTILS, "if (typeof window.CRONOS_APP_URL !== 'string') {", "'https://cronos-futbol-app.web.app';\n}");

function corre(codigo, host, salida) {
    const sb = { location: { hostname: host }, window: {}, console: { log() {} } };
    vm.createContext(sb);
    vm.runInContext(codigo + '\n' + salida, sb);
    return sb._o;
}
const initDe = (h) => corre(T_INIT, h, '_o = { p: firebaseConfig.projectId, k: _RECAPTCHA_SITE_KEY, e: window.CRONOS_ENTORNO };');
const liveDe = (h) => corre(T_LIVE, h, '_o = { p: firebaseConfig.projectId, k: ' + T_LIVE_KEY.replace('new ReCaptchaV3Provider(', '').slice(0, -1) + ' };');
const urlDe = (h) => corre(T_UTILS, h, '_o = window.CRONOS_APP_URL;');

const PROD = 'cronos-futbol-app', TEST = 'cronos-futbol-test';
const K_PROD = '6Ld5cEQtAAAAAA0OCimDVsOORapoEKfsVmJmGI23', K_TEST = '6LcRkMwtAAAAAGc7AM7Z8B3euLhbrG5J94gAMNcw';
const CASOS = [
    ['cronos-futbol-app.web.app', PROD],
    ['cronos-futbol-app.firebaseapp.com', PROD],
    ['cronos-futbol-test.web.app', TEST],
    ['cronos-futbol-test.firebaseapp.com', TEST],
    ['localhost', TEST],
    ['127.0.0.1', TEST],
    ['🔑 un dominio desconocido (app.cronosfutbol.es)', PROD, 'app.cronosfutbol.es'],
    ['🔑 uno que se parece a testeo (cronos-futbol-test.web.app.evil.com)', PROD, 'cronos-futbol-test.web.app.evil.com'],
    ['🔑 sin dominio', PROD, ''],
];

console.log('\n══ 🧪 Cada dominio, su proyecto — en los tres sitios ══');
for (const [nombre, esperado, hostExplicito] of CASOS) {
    const h = hostExplicito !== undefined ? hostExplicito : nombre;
    let a, b, c, err = null;
    try { a = initDe(h); b = liveDe(h); c = urlDe(h); } catch (e) { err = e.message; }
    const urlEsperada = 'https://' + esperado + '.web.app';
    const claveEsperada = esperado === TEST ? K_TEST : K_PROD;
    ok(nombre + ' → ' + (esperado === TEST ? 'TESTEO' : 'PRODUCCIÓN'),
       !err && a.p === esperado && b.p === esperado && c === urlEsperada &&
       a.k === claveEsperada && b.k === claveEsperada && a.e === (esperado === TEST ? 'testeo' : 'produccion'),
       err || { app: a, visor: b, enlace: c });
}

console.log('\n══ La configuración de producción no ha cambiado ══');
{
    const p = corre(T_INIT, 'cronos-futbol-app.web.app', '_o = firebaseConfig;');
    ok('apiKey, appId y senderId de producción intactos',
       p.apiKey === 'AIzaSyAWPw-lE6ynYK1CkFpSbwCgRtitDzBpIb4' && p.appId === '1:393110572633:web:27a7effed60975e690ab48' &&
       p.messagingSenderId === '393110572633' && p.authDomain === 'cronos-futbol-app.firebaseapp.com', p);
    const t = corre(T_INIT, 'cronos-futbol-test.web.app', '_o = firebaseConfig;');
    ok('🔑 la de testeo no comparte NINGÚN identificador con producción',
       t.apiKey !== p.apiKey && t.appId !== p.appId && t.messagingSenderId !== p.messagingSenderId &&
       !/393110572633|cronos-futbol-app/.test(JSON.stringify(t)), t);
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

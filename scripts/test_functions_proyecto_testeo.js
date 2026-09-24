// ─────────────────────────────────────────────────────────────────────────
//  test_functions_proyecto_testeo.js  ·  🧪 v760 (testeo aislado, 2026-09-24)
//
//  Las functions se despliegan en producción Y en cronos-futbol-test. Se vigila:
//   1. Que el proyecto se detecta bien, EJECUTANDO el bloque real con cada
//      entorno posible, y que lo desconocido cae SIEMPRE en producción.
//   2. Que en testeo sendInviteEmail NO envía correo (decisión del autor):
//      la rama de testeo va ANTES de crear el transporte de nodemailer.
//   3. Que el enlace de la invitación sale del proyecto, no de una constante
//      de producción fija.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 300)); }
};

console.log('\n══ 🧪 Functions: producción y testeo desde el mismo código ══');

console.log('\n1) Detección del proyecto, ejecutada');
const ini = SRC.indexOf('const _PROYECTO =');
const fin = SRC.indexOf(';', SRC.indexOf('const _APP_URL_DEL_PROYECTO')) + 1;
ok('1a · existe el bloque de detección', ini !== -1 && fin > ini);
function detecta(env) {
    const sb = { process: { env }, JSON };
    vm.createContext(sb);
    vm.runInContext(SRC.slice(ini, fin) + '\n_o = { t: ES_TESTEO, u: _APP_URL_DEL_PROYECTO };', sb);
    return sb._o;
}
const PROD = 'https://cronos-futbol-app.web.app', TEST = 'https://cronos-futbol-test.web.app';
const casos = [
    ['GCLOUD_PROJECT = cronos-futbol-test', { GCLOUD_PROJECT: 'cronos-futbol-test' }, true, TEST],
    ['FIREBASE_CONFIG con projectId de testeo', { FIREBASE_CONFIG: '{"projectId":"cronos-futbol-test"}' }, true, TEST],
    ['GCLOUD_PROJECT = cronos-futbol-app', { GCLOUD_PROJECT: 'cronos-futbol-app' }, false, PROD],
    ['🔑 sin ninguna variable → producción', {}, false, PROD],
    ['🔑 un id parecido NO es testeo', { GCLOUD_PROJECT: 'cronos-futbol-test2' }, false, PROD],
    ['🔑 FIREBASE_CONFIG corrupto → producción', { FIREBASE_CONFIG: '{no es json' }, false, PROD],
];
for (const [n, env, t, u] of casos) {
    let r = null, e = null;
    try { r = detecta(env); } catch (x) { e = x.message; }
    ok('1b · ' + n, r && r.t === t && r.u === u, e || r);
}

console.log('\n2) En testeo no sale ningún correo');
{
    const iF = SRC.indexOf('exports.sendInviteEmail');
    const cuerpo = SRC.slice(iF, SRC.indexOf('\nexports.', iF + 10));
    const iTest = cuerpo.indexOf('if (ES_TESTEO) {');
    const iTrans = cuerpo.indexOf('nodemailer.createTransport(');
    const iSend = cuerpo.indexOf('.sendMail(');
    ok('2a · sendInviteEmail tiene la rama de testeo', iTest !== -1);
    ok('2b · 🔑 y va ANTES de crear el transporte y de enviar', iTest !== -1 && iTest < iTrans && iTest < iSend,
       { iTest, iTrans, iSend });
    const rama = cuerpo.slice(iTest, cuerpo.indexOf('}\n', cuerpo.indexOf('return {', iTest)) + 1);
    ok('2c · la rama termina en return (no sigue hacia el envío)', /return \{[\s\S]*testeo: true[\s\S]*\}/.test(rama), rama.slice(0, 200));
    ok('2d · nodemailer sólo se usa en sendInviteEmail (no hay otro envío que proteger)',
       (SRC.match(/nodemailer\.createTransport\(/g) || []).length === 1);
}

console.log('\n3) El enlace sale del proyecto');
ok('3a · APP_URL viene de _APP_URL_DEL_PROYECTO', /const APP_URL = _APP_URL_DEL_PROYECTO;/.test(SRC));
ok('3b · no queda la URL de producción fija como APP_URL',
   !/const APP_URL = 'https:\/\/cronos-futbol-app\.web\.app'/.test(SRC));

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

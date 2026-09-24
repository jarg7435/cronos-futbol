// ─────────────────────────────────────────────────────────────────────────
//  test_semilla_testeo.js  ·  🧪 fase C del testeo aislado (2026-09-24)
//
//  La semilla escribe con credenciales de OWNER, que también valen para
//  producción. Lo único que la separa de la BD real es su propio cerrojo, así
//  que se vigila: ejecutado, no leído.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'semilla_testeo.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

console.log('\n══ 🧪 La semilla sólo puede escribir en TESTEO ══');

console.log('\n1) El proyecto está fijado en el código');
ok('1a · PROYECTO = cronos-futbol-test', /const PROYECTO = 'cronos-futbol-test';/.test(SRC));
ok('1b · 🔑 no lo toma de argumentos ni del entorno', !/process\.env\.\w*PROJECT|--project/.test(SRC));

console.log('\n2) El cerrojo, ejecutado');
const ini = SRC.indexOf('const PROYECTO =');
const pro = SRC.slice(SRC.indexOf('const PROHIBIDO'), SRC.indexOf(';', SRC.indexOf('const PROHIBIDO')) + 1);
const fnIni = SRC.indexOf('function cerrojo(');
const fnFin = SRC.indexOf('\n}\n', fnIni) + 3;
const sb = {}; vm.createContext(sb);
vm.runInContext(SRC.slice(ini, SRC.indexOf(';', ini) + 1) + '\n' + pro + '\n' + SRC.slice(fnIni, fnFin) + '\n_c = cerrojo;', sb);
const lanza = (u) => { try { sb._c(u); return false; } catch (_) { return true; } };
ok('2a · 🔑 aborta con la BD de producción', lanza('https://firestore.googleapis.com/v1/projects/cronos-futbol-app/databases/(default)/documents:commit'));
ok('2b · 🔑 aborta con Auth de producción (por número de proyecto)', lanza('https://identitytoolkit.googleapis.com/v1/projects/393110572633/accounts'));
ok('2c · 🔑 aborta con una URL que no nombra testeo', lanza('https://identitytoolkit.googleapis.com/v1/accounts:update'));
ok('2d · deja pasar testeo', !lanza('https://firestore.googleapis.com/v1/projects/cronos-futbol-test/databases/(default)/documents:commit'));
ok('2e · todas las llamadas pasan por el cerrojo', /async function api\([\s\S]{0,80}cerrojo\(url\)/.test(SRC) &&
   (SRC.match(/await http\(/g) || []).length === 2);  // api() y el token de OAuth

console.log('\n3) Por defecto no escribe, y no enseña la contraseña');
ok('3a · sólo escribe con --escribir', /const ESCRIBIR = process\.argv\.includes\('--escribir'\);/.test(SRC) &&
   /if \(method !== 'GET' && !ESCRIBIR\) throw/.test(SRC));
ok('3b · 🔑 la contraseña nunca va a console', !/console\.(log|error|warn)\([^)]*\bclave\b(?!\s*\?)/.test(SRC.replace(/\(clave \? [^)]*\)/g, '')));
ok('3c · se guarda fuera del repo (carpeta del usuario)', /path\.join\(os\.homedir\(\), 'cronos_testeo', 'contrasena\.txt'\)/.test(SRC));

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

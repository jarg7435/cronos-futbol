// ─────────────────────────────────────────────────────────────────────────
//  test_registro_clubes_vigentes.js  ·  🔒 v760 (2026-09-24, capturas 10845-10847)
//
//  El autor vio en el registro un desplegable con clubes que ya no existen
//  (CF SEMANA, CF JOSE ALBERTO, CD TRIAL, ESTRELLA CF) y sin el recién creado
//  CD PRUEBA. Medido: NO salía de ninguna consulta. Era el historial de
//  formularios del NAVEGADOR sobre «Nombre de tu Club» —un campo de texto
//  libre para un club NUEVO—, que recordaba lo escrito en pruebas anteriores.
//  El selector de clubes EXISTENTES sí consulta la BD (`clubs_public`), y
//  estaba bien: 5 de 5 reales. Se endurece igualmente.
//
//  Se vigila:
//   1. Los campos de texto del registro no ofrecen historial ajeno.
//   2. El selector sólo lista lo VIGENTE de `clubs_public` (ejecutado).
//   3. Ya no mezcla la colección antigua `individuals`.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const AUTH = fs.readFileSync(path.join(ROOT, 'js', 'services', 'auth.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 300)); }
};
const input = (id) => { const m = HTML.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>')); return m ? m[0] : ''; };

console.log('\n══ 🔒 Registro: sólo clubes y entes vigentes ══');

console.log('\n1) Los campos de texto no ofrecen historial ajeno');
ok('1a · 🔑 «Nombre de tu Club» (club NUEVO) sin autocompletado', /autocomplete="off"/.test(input('auth-new-club-name')), input('auth-new-club-name'));
ok('1b · el correo del administrador del ente (OTRA persona) sin autocompletado', /autocomplete="off"/.test(input('individual-owner-email')), input('individual-owner-email'));
ok('1c · el nombre propio pide el nombre de quien se registra', /autocomplete="given-name"/.test(input('auth-firstname')), input('auth-firstname'));

console.log('\n2) El selector sólo lista lo vigente (ejecutado)');
const ini = AUTH.indexOf('const _esVigente =');
const fin = AUTH.indexOf(';', ini) + 1;
ok('2a · existe el filtro _esVigente', ini !== -1);
let esVigente = () => true;
if (ini !== -1) { const sb = {}; vm.createContext(sb); vm.runInContext(AUTH.slice(ini, fin) + '\n_f = _esVigente;', sb); esVigente = sb._f; }
const casos = [
    ['club activo', { name: 'CD PRUEBA', type: 'club', status: 'active' }, true],
    ['ente activo', { name: 'MÍSTER X', type: 'individual', status: 'active' }, true],
    ['espejo antiguo sin estado', { name: 'CD VIEJO' }, true],
    ['🔑 bloqueado', { name: 'CD B', status: 'blocked' }, false],
    ['🔑 cualquier otro estado (deleted, archived…)', { name: 'CD C', status: 'deleted' }, false],
    ['🔑 sin nombre (residuo)', { status: 'active' }, false],
    ['nulo', null, false],
];
for (const [n, c, esperado] of casos) ok('2b · ' + n + ' → ' + (esperado ? 'SE LISTA' : 'NO se lista'), esVigente(c) === esperado);

{
    const iSnap = AUTH.indexOf("m.getDocs(m.collection(fa.db, 'clubs_public'))");
    const tramo = AUTH.slice(iSnap, iSnap + 1500);
    ok('2c · el bucle usa el filtro', /if \(_esVigente\(club\)\)/.test(tramo));
}

console.log('\n3) Sin la colección antigua');
{
    const iF = AUTH.indexOf("m.getDocs(m.collection(fa.db, 'clubs_public'))");
    const iFin = AUTH.indexOf('// Construir HTML combinado', iF);
    const cargador = AUTH.slice(iF, iFin);
    ok('3a · el cargador del selector ya no lee `individuals`',
       iF !== -1 && iFin > iF && !/collection\(fa\.db, 'individuals'\)/.test(cargador));
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

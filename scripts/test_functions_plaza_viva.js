// ─────────────────────────────────────────────────────────────────────────
//  test_functions_plaza_viva.js  ·  SEC-F01 (Paso 3, 2026-08-31)
//
//  Cinco sitios de functions/index.js decidian con `r.isAuthorized !== false`.
//  Eso es FAIL-OPEN —la leccion de v617—: en algo que AUTORIZA, «no se» se
//  convierte en SI. Una entrada de `allRoles` sin el campo pasaba por plaza
//  autorizada.
//
//  🚨🚨 Y NO ERA TEORICO: el `allow update` de `users/{userId}` prohibe tocar
//  `role`, `isAuthorized`, `status` y `clubId`… pero **`allRoles` no esta en
//  esa lista**. La cadena que esto cierra:
//    1. Ser director AUTORIZADO del club A.
//    2. Anyadirse a mano `{ clubId: 'CLUB_B' }` sin `isAuthorized`.
//    3. Llamar a `syncRootClubId({ clubId: 'CLUB_B' })`.
//    4. La funcion escribe el `clubId` de la RAIZ con el Admin SDK, que no
//       pasa por las reglas — el campo que las reglas prohiben cambiarse.
//    5. `isClubDirectorOf('CLUB_B')` lee la raiz → director de un club ajeno.
//
//  ⚠️ POR QUE ESTE GUARD **EJECUTA** Y NO SOLO MIRA EL TEXTO: en esta misma
//  auditoria una asercion estatica dio verde sobre codigo que no hacia lo que
//  decia, y en v641 dieciseis aserciones verdes convivieron con la funcion
//  muerta. La PARTE 2 evalua `_plazaViva` de verdad, caso a caso.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
// ⚠️ Sin comentarios: las notas que EXPLICAN el arreglo citan la forma vieja
// literalmente, y contarian como si el defecto siguiera ahi. Ha pasado cinco
// veces en esta auditoria.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

console.log('\n══ SEC-F01 · una plaza viva se prueba, no se presume ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🔓 No queda ni un fail-open');
{
    const abiertos = (CODE.match(/isAuthorized\s*!==\s*false/g) || []).length;
    ok('1a · 🔑🔑 ningun `isAuthorized !== false` en el codigo',
       abiertos === 0,
       abiertos + ' encontrados: en algo que autoriza, «no se» pasaria por «si»');

    ok('1b · ⚠️ ni un `isAuthorized === false` como PUERTA de entrada',
       !/if\s*\(\s*userData\.isAuthorized\s*===\s*false/.test(CODE),
       'descartar el NO no es exigir el SI: la cuenta sin el campo pasaba');

    ok('1c · `syncRootClubId` usa la misma puerta que las otras dos',
       /_cuentaHabilitada\(userData\)/.test(CODE),
       'escribe el clubId de la RAIZ: es la funcion mas peligrosa del fichero');

    // Los cinco sitios + la definicion.
    // v647/SEC-F03 · eran cinco puntos + la definicion; `sendInviteEmail` dejo
    // de mirar `allRoles` por completo (la plaza sale de la raiz o del claim),
    // asi que quedan CUATRO + la definicion. Bajar este numero es deliberado:
    // significa que un consumidor ha dejado de fiarse de `allRoles`, que es la
    // direccion correcta. Subirlo, que alguien ha vuelto a fiarse.
    const usos = (CODE.match(/_plazaViva\(/g) || []).length;
    ok('1d · los puntos que aun miran `allRoles` pasan por el MISMO ayudante',
       usos === 5, 'apariciones de _plazaViva(): ' + usos + ' (esperadas 5)');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔬 Y `_plazaViva` se COMPORTA como dice');
{
    const m = SRC.match(/function _plazaViva\(r\) \{[\s\S]*?\n\}/);
    if (!m) { ok('2· se pudo extraer _plazaViva', false, 'no se encontro la funcion'); }
    else {
        const sb = {};
        vm.createContext(sb);
        vm.runInContext(m[0] + '\nthis.f = _plazaViva;', sb);
        const f = sb.f;

        const casos = [
            ['2a · 🔑 SIN el campo → NO es plaza viva', { role: 'director', clubId: 'B' }, false,
             'es exactamente la entrada que el propio usuario puede escribirse'],
            ['2b · isAuthorized:true → si',            { isAuthorized: true }, true],
            ['2c · isAuthorized:false → no',           { isAuthorized: false }, false],
            ['2d · ⚠️ el alias antiguo `authorized:true` sigue valiendo', { authorized: true }, true,
             'hay datos viejos que lo usan: exigir solo isAuthorized dejaria fuera plazas legitimas'],
            ['2e · autorizada pero RECHAZADA → no',    { isAuthorized: true, status: 'rejected' }, false],
            ['2f · autorizada pero RETIRADA → no',     { isAuthorized: true, status: 'removed' }, false],
            ['2g · null no revienta',                  null, false],
            ['2h · undefined tampoco',                 undefined, false],
        ];
        casos.forEach(([n, entrada, esperado, why]) => {
            let r;
            try { r = f(entrada); } catch (e) { r = 'LANZA: ' + e.message; }
            ok(n, r === esperado, why ? why + ' | devolvio ' + r : 'devolvio ' + r);
        });
    }
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

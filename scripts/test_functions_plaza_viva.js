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
    // 🔑 SEC-F04 · `_plazaViva` YA NO SE LLAMA DESDE NINGUN CONSUMIDOR: solo
    // desde `_plazaDeSuClub`, que le anyade el anclaje al club de la raiz. Que
    // aparezca 2 veces (su definicion y esa llamada) es la forma de comprobar
    // que nadie se ha saltado el ayudante nuevo para volver a la version
    // suelta, que no ata la plaza a ningun club.
    // Esperadas 3: la definicion, la llamada desde `_plazaDeSuClub`, y UNA
    // excepcion deliberada — el respaldo del trigger `autoSetClaimsOnApproval`.
    // ⚠️ Esa excepcion se intento quitar y hubo que devolverla:
    // `test_sec_c1_clubid.js` (2a/2b) documenta que el trigger PUEBLA la raiz
    // desde `allRoles`, y es la via de migracion de los multi-rol. Su riesgo
    // es bajo (solo se llega ahi cuando la raiz no tiene club, estado que la
    // aprobacion no produce) y se atara al documento del club en el paso 3.
    // 🔑 Que el numero sea EXACTO es lo que hace que una cuarta llamada suelta
    // —alguien saltandose `_plazaDeSuClub`— ponga esto rojo.
    const usosViva = (CODE.match(/_plazaViva\(/g) || []).length;
    ok('1d · 🔑🔑 `_plazaViva` no se usa suelto salvo la excepcion del trigger',
       usosViva === 3,
       'apariciones de _plazaViva(): ' + usosViva + ' (esperadas 3: definicion + _plazaDeSuClub + trigger)');

    ok('1e · y los consumidores de `allRoles` pasan por `_plazaDeSuClub`',
       (CODE.match(/_plazaDeSuClub\(/g) || []).length >= 3,
       'definicion + los dos puntos de registerStaffUid');

    ok('1f · 🚨 `syncRootClubId` ya NO mira `allRoles` para decidir el club',
       /const roleMatches = false;/.test(CODE),
       'era el arranque de la escalada cross-club: escribe el clubId de la RAIZ');
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

// ════════════════════════════════════════════════════════════════════
//  PARTE 3 · SEC-F04 · la plaza queda ATADA al club de la RAIZ
//
//  `_plazaViva` exige `isAuthorized === true`… pero ese `true` lo escribe el
//  propio usuario (`allRoles` no esta protegido por el `allow update`). Lo
//  que SI esta protegido es el `clubId` de la RAIZ, asi que atar la plaza a
//  el cierra la escalada CROSS-CLUB sin depender de ningun dato sembrado.
//
//  ⚠️ 3b ES LA ASERCION DEL HALLAZGO: una entrada perfectamente «viva» pero
//  de OTRO club no vale. Era la que convertia a un director del club A en
//  director del B por `syncRootClubId`.
// ════════════════════════════════════════════════════════════════════
console.log('\n3) 🔒 SEC-F04 · la plaza tiene que ser del club de la RAIZ');
{
    const mv = SRC.match(/function _plazaViva\(r\) \{[\s\S]*?\n\}/);
    const md = SRC.match(/function _plazaDeSuClub\(userData, r\) \{[\s\S]*?\n\}/);
    if (!mv || !md) { ok('3· se pudieron extraer los dos ayudantes', false); }
    else {
        const sb = {}; vm.createContext(sb);
        vm.runInContext(mv[0] + '\n' + md[0] + '\nthis.f = _plazaDeSuClub;', sb);
        const f = sb.f;
        const VIVA = { isAuthorized: true, status: 'active' };
        const casos = [
            ['3a · plaza viva EN el club de la raiz → si',
             { clubId: 'CLUB_A' }, Object.assign({ role: 'director', clubId: 'CLUB_A' }, VIVA), true],
            ['3b · 🔑🔑 plaza viva de OTRO club → NO (la escalada cross-club)',
             { clubId: 'CLUB_A' }, Object.assign({ role: 'director', clubId: 'CLUB_B' }, VIVA), false,
             'aunque el usuario se haya escrito isAuthorized:true, el club de la raiz no lo respalda'],
            ['3c · ⚠️ raiz SIN club → no vale ninguna (no hay con que contrastar)',
             { role: 'club_admin' }, Object.assign({ role: 'director', clubId: 'CLUB_B' }, VIVA), false],
            ['3d · entidad individual: vale `individualEntityId` como raiz',
             { individualEntityId: 'IND_1' }, Object.assign({ role: 'individual', clubId: 'IND_1' }, VIVA), true],
            ['3e · plaza revocada del propio club → no',
             { clubId: 'CLUB_A' }, { role: 'director', clubId: 'CLUB_A', isAuthorized: false }, false],
            ['3f · entrada sin clubId → no',
             { clubId: 'CLUB_A' }, Object.assign({ role: 'director' }, VIVA), false],
            ['3g · userData null no revienta', null, Object.assign({ clubId: 'CLUB_A' }, VIVA), false],
        ];
        casos.forEach(([n, ud, r, esperado, why]) => {
            let res; try { res = f(ud, r); } catch (e) { res = 'LANZA: ' + e.message; }
            ok(n, res === esperado, (why ? why + ' | ' : '') + 'devolvio ' + res);
        });
    }
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

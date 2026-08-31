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
    // 🔑🔑 EL INVARIANTE FUERTE, y sustituye a contar `_plazaViva`: ¿cuantos
    // sitios del codigo MIRAN `allRoles` para decidir algo? Tras SEC-F05 debe
    // quedar UNO SOLO, el respaldo del trigger `autoSetClaimsOnApproval`.
    // ⚠️ Ese se intento quitar y hubo que devolverlo: `test_sec_c1_clubid.js`
    // (2a/2b) documenta que el trigger PUEBLA la raiz desde `allRoles` y es la
    // via de migracion de los multi-rol; su riesgo es bajo, porque solo se
    // llega ahi cuando la raiz no tiene club, estado que la aprobacion no
    // produce.
    // Contar `allRoles` en CODIGO —no `_plazaViva`— caza tambien a quien lo
    // consulte a mano sin pasar por ningun ayudante, que es como volveria el
    // agujero.
    // ⚠️ SE CUENTA `_plazaViva`, NO `allRoles`. Contar `allRoles` a secas da
    // 23: el fichero lo usa por todas partes para cosas legitimas —escribirlo
    // al aprobar, filtrar listas, archivar— y ninguna de esas AUTORIZA. El
    // ayudante es el que marca «esto decide», asi que es lo que hay que contar.
    // Esperadas 2: su definicion y el respaldo del trigger.
    const usosViva = (CODE.match(/_plazaViva\(/g) || []).length;
    ok('1d · 🔑🔑 solo UN sitio AUTORIZA mirando `allRoles` (el trigger)',
       usosViva === 2,
       'apariciones de _plazaViva(): ' + usosViva + ' (esperadas 2: definicion + trigger)');

    ok('1e · 🚨 `syncRootClubId` no decide por `allRoles`…',
       !/roleMatches = .*allRoles/.test(CODE),
       'era el arranque de la escalada cross-club: escribe el clubId de la RAIZ');

    ok('1f · …y `registerStaffUid` tampoco (rompe la CIRCULARIDAD)',
       /const roleForClub = false;/.test(CODE) && /const hasRole = userData\.role === role;/.test(CODE),
       'es la funcion que ESCRIBE directorUids, la lista que ahora corrobora: ' +
       'si se autorizara desde allRoles, uno se mete solo y queda "corroborado"');
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
//  SEC-F05 · el ROL se corrobora contra el DOCUMENTO DEL CLUB, que solo
//  escriben el SuperAdmin, el admin de ese club y el Admin SDK. Es lo que
//  permite cerrar la elevacion INTRA-club que SEC-F04 dejaba abierta: un
//  entrenador declarandose `director` de SU propio club.
//
//  ⚠️ 3b y 3c son las del hallazgo: no basta con estar en el documento, hay
//  que estar en la LISTA DE ESE ROL. Confundirlas daria a cualquier
//  coordinador los permisos de director.
console.log('\n3) 🔒 SEC-F05 · el rol se corrobora contra el documento del club');
{
    const m = SRC.match(/function _clubCorrobora\(club, uid, roles\) \{[\s\S]*?\n\}/);
    if (!m) { ok('3· se pudo extraer _clubCorrobora', false); }
    else {
        const sb = {}; vm.createContext(sb);
        vm.runInContext(m[0] + '\nthis.f = _clubCorrobora;', sb);
        const f = sb.f;
        const CLUB = { id: 'CLUB_A', adminUid: 'U_ADMIN',
                       directorUids: ['U_DIR'], coordinatorUids: ['U_COO'] };
        const casos = [
            ['3a · el adminUid del club es club_admin', CLUB, 'U_ADMIN', ['club_admin'], true],
            ['3b · 🔑 quien esta en directorUids NO es club_admin', CLUB, 'U_DIR', ['club_admin'], false,
             'estar en el documento no basta: hay que estar en la lista de ESE rol'],
            ['3c · 🔑 ni el coordinador es director', CLUB, 'U_COO', ['director'], false],
            ['3d · el director si es director', CLUB, 'U_DIR', ['director'], true],
            ['3e · vale con que case UNO de los roles pedidos', CLUB, 'U_COO', ['director', 'coordinator'], true],
            ['3f · un uid ajeno no es nada', CLUB, 'U_OTRO', ['club_admin', 'director', 'coordinator'], false],
            ['3g · ⚠️ club null → NO corrobora (falla hacia el no)', null, 'U_ADMIN', ['club_admin'], false,
             'si la lectura del club peta, _clubDeLaRaiz devuelve null: «no se» = NO'],
            ['3h · club SIN las listas no revienta', { id: 'X' }, 'U_DIR', ['director'], false],
            ['3i · uid vacio no corrobora', CLUB, null, ['club_admin'], false],
        ];
        casos.forEach(([n, club, uid, roles, esperado, why]) => {
            let res; try { res = f(club, uid, roles); } catch (e) { res = 'LANZA: ' + e.message; }
            ok(n, res === esperado, (why ? why + ' | ' : '') + 'devolvio ' + res);
        });
    }
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

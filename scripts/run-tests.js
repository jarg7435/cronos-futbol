#!/usr/bin/env node
/**
 * run-tests.js — Loop de la suite de tests de CHRONOS FÚTBOL.
 *
 * Ejecuta CADA `scripts/test_*.{js,mjs,cjs}` como un proceso Node independiente.
 * Un test PASA con exit 0 y FALLA con exit != 0. El runner devuelve exit 1 si
 * cualquier test NO listado en XFAIL falla.
 *
 * XFAIL (expected-fail conocidos): tests que reflejan una REGRESIÓN REAL aún sin
 * corregir en el producto. Se ejecutan y se reportan (para que la regresión siga
 * VISIBLE), pero su fallo NO tumba CI. Si un XFAIL empieza a pasar, el runner lo
 * marca como "XPASS" y FALLA, para obligar a sacarlo de la lista.
 *   · 2026-08-27: LA LISTA ESTÁ VACÍA. Los once que arrastraba desde el
 *     2026-07-24 se auditaron uno por uno y se cerraron todos (ver la nota
 *     larga junto a XFAIL, más abajo). El gate de CI vuelve a servir para lo
 *     que se hizo: detectar regresiones NUEVAS.
 *
 * Se ejecuta desde la raíz del repo (varios tests leen ficheros con rutas
 * relativas a la raíz). No requiere emulador ni red: son tests puros de Node.
 *
 * Uso:  node scripts/run-tests.js
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const ROOT = path.join(__dirname, '..');

// Regresiones reales conocidas. No bloquean CI, pero deben corregirse y
// retirarse de aquí.
//
// ══════════════════════════════════════════════════════════════════════
//  🚨 2026-08-27 · LA LISTA ESTÁ VACÍA, Y LA NOTA QUE HABÍA AQUÍ ERA FALSA
//
//  Decía que estos once eran «tests muertos» que ejercitaban funciones que
//  «ya no existen». Se comprobó uno por uno y NO era cierto: eran tests
//  MAYORMENTE VIVOS con unas pocas aserciones desfasadas. Los once están
//  cerrados; el desglose, justo debajo.
// ══════════════════════════════════════════════════════════════════════
//
// EL DESGLOSE. Se midió cada uno y resultaron ser CUATRO cosas distintas,
// no una:
//
//  🔴 UN DEFECTO VIVO, escondido detrás de la etiqueta «test muerto»:
//     · test_v269_fixes — `reports-tab.js` usaba `me.currentRole`, que NADIE
//       escribe: siempre `undefined`, caía a `me.role` y las cuentas multi-rol
//       compartían `dismissKey`. Ocultar un informe como Director lo ocultaba
//       como Coordinador. Corregido (v637).
//
//  🟠 EL ARNÉS QUEDÁNDOSE ATRÁS (el producto estaba bien; el test miraba a un
//     sitio del que la lógica se había mudado):
//     · test_timer_color_dom / test_timer_color_semaforo — faltaba extraer
//       `_sinSemaforoLive` (v559) y un `window` en el sandbox. NO era
//       «incompatibilidad con Node 24», como decía la nota.
//     · test_contact_manager_crash — el alta del staff pasó a `_cGetStaff` +
//       `_cFS`, que el sandbox no ofrecía: la llamada moría en su `catch` y la
//       lista salía sin staff. El fallo PARECÍA del producto.
//     · test_parent_report_targets — su CASO 1 esperaba que `_cGetStaff`
//       leyera `emailConfig.contacts` filtrando por el tag 'rpt'. Esa fusión se
//       mudó a `openCollectiveReport`, y allí el tag dejó de ser requisito A
//       PROPÓSITO. Reapuntado a `_cGetStaff` con datos de verdad.
//
//  🟡 LA FORMA MURIÓ, EL INVARIANTE NO. Se reapuntan al código vivo:
//     · test_delete_all_messages_audit → `_clearUnifiedThread`
//       (coachDeleteAllMessages / ppDeleteAllMessages eran DOS copias; hoy es
//       una sola función para todos los roles).
//     · test_sdsendreplytocoach_creates_thread → `_sendUnifiedMessage`: el
//       primer mensaje de una conversación sigue sin poder perderse.
//     · test_stale_chat_pane_reset → hoy el hueco se cierra por CONSTRUCCIÓN
//       (el threadId ya no viaja en el marcado) en vez de por limpieza.
//     · test_staff_chat_unification → las ramas `staffUid` de firestore.rules
//       siguen ahí; v436/v437 las reescribió a `.get(campo, default)` y el
//       test buscaba la redacción antigua.
//     · test_cgetstaff_role_filter — buscaba una formulación literal del
//       filtro. Se mide la estructura, no la redacción.
//
//  🗑️ MUERTO DE VERDAD, retirado: test_selfmessage_autoopen.js. Vigilaba el
//     «auto-open del primer hilo» del Panel de Dirección, que no existe en la
//     arquitectura unificada; y sus otras dos aserciones evaluaban una
//     reimplementación escrita dentro del propio test (el defecto de v620), así
//     que pasaban dijera lo que dijera el producto.
//
//     ⚠️ PENDIENTE, NO OLVIDADO: la forma sobrevive en js/coach/comms/panel.js,
//     en el constructor de la lista de administradores —
//     `const otro = (t.participants || []).find(p => p && p !== me.uid);`—
//     SIN el `|| me.uid` que aquel arreglo introdujo. Con una cuenta multi-rol
//     (mismo uid) un hilo consigo mismo daría `undefined` y ese contacto no se
//     surfacearía. Es una decisión de producto, no un arreglo mecánico.
//
// ⚠️⚠️ MORALEJA, y es la cara: una etiqueta de «test muerto» sin verificar es
//    peor que un test rojo. De los once, UNO estaba muerto. Los otros diez
//    tenían algo que decir, y uno de ellos llevaba un mes señalando un bug de
//    producto que nadie leyó porque el runner lo pintaba de amarillo.
const XFAIL = new Set([]);

const testFiles = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => /^test_.*\.(js|mjs|cjs)$/.test(f))
    .sort();

console.log(`CHRONOS test suite — ${testFiles.length} test(s)` + (XFAIL.size ? `  (${XFAIL.size} xfail conocido)` : ''));
console.log('-'.repeat(60));

let passed = 0;
const failed = []; // fallos que SÍ bloquean
const xfailed = []; // xfail que falló como se esperaba (informativo)
const xpassed = []; // xfail que empezó a pasar → hay que retirarlo de XFAIL
const start = Date.now();

for (const f of testFiles) {
    const rel = path.join('scripts', f);
    const res = spawnSync(process.execPath, [rel], { cwd: ROOT, encoding: 'utf8' });
    const ok = res.status === 0;
    const isXfail = XFAIL.has(f);

    if (ok && !isXfail) {
        passed++;
        console.log(`  PASS   ${f}`);
    } else if (ok && isXfail) {
        xpassed.push(f);
        console.log(`  XPASS  ${f}  (xfail que ya pasa → retirar de XFAIL)`);
    } else if (!ok && isXfail) {
        xfailed.push(f);
        console.log(`  XFAIL  ${f}  (exit ${res.status}; regresión conocida, ver CORRECCIONES_ESTADO.md)`);
    } else {
        failed.push(f);
        console.log(`  FAIL   ${f}  (exit ${res.status})`);
        const tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').slice(-8);
        tail.forEach((l) => console.log('         ' + l));
    }
}

const secs = ((Date.now() - start) / 1000).toFixed(1);
console.log('-'.repeat(60));
console.log(
    `Resultado: ${passed}/${testFiles.length - XFAIL.size} activos OK en ${secs}s` +
        (xfailed.length ? `; ${xfailed.length} xfail (regresión conocida)` : '') +
        (xpassed.length ? `; ${xpassed.length} XPASS` : '')
);

if (xpassed.length) {
    console.log(`\nXPASS (retirar de XFAIL en scripts/run-tests.js): ${xpassed.join(', ')}`);
}
if (failed.length) {
    console.log(`\nFALLARON (${failed.length}): ${failed.join(', ')}`);
    process.exit(1);
}
if (xpassed.length) {
    // Un xfail que ya pasa es un fallo de mantenimiento del runner: forzar arreglo.
    process.exit(1);
}
console.log('\nTodos los tests activos pasaron.' + (xfailed.length ? ` (${xfailed.length} xfail documentado sigue rojo)` : ''));
process.exit(0);

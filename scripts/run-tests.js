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
 *   · (vacía) — P11-D (guard de staff vacío en el informe colectivo/auto-despacho)
 *     se corrigió el 2026-07-22; test_p11d_collective_write.js retirado de aquí
 *     tras confirmar que pasa. Ver CORRECCIONES_ESTADO.md.
 *   · 2026-07-24 (auditoría, hallazgo CI #15): se añaden 11 tests que ya
 *     fallaban antes de cualquier cambio de esta ronda — `npm test` estaba en
 *     rojo permanente sin que ninguno de ellos estuviera documentado aquí, lo
 *     que dejaba el gate de CI inútil para detectar regresiones NUEVAS.
 *     9 de ellos (test_cgetstaff_role_filter, test_contact_manager_crash,
 *     test_delete_all_messages_audit, test_parent_report_targets,
 *     test_sdsendreplytocoach_creates_thread, test_selfmessage_autoopen,
 *     test_staff_chat_unification, test_stale_chat_pane_reset,
 *     test_v269_fixes) referencian la arquitectura de mensajería POR PESTAÑAS
 *     anterior (`_msgGetSelected`, `_cStaffThreadId` con staffRole,
 *     `sdSendBulkMsg`, `sdSendReplyToCoach`, `coachDeleteAllMessages`,
 *     `ppDeleteAllMessages`, `_resetChatThreadPane`...) que ya NO existe en
 *     el código: fue sustituida por el sistema unificado `_umState`
 *     (js/coach/comms/panel.js). Ver CORRECCIONES_ESTADO.md. 2 de ellos
 *     (test_timer_color_dom, test_timer_color_semaforo) fallan por
 *     incompatibilidad del arnés de test con Node 24 (`ReferenceError:
 *     window is not defined` dentro de vm.runInContext), no por un bug de
 *     producto.
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

// Regresiones reales conocidas (documentadas en CORRECCIONES_ESTADO.md). No
// bloquean CI, pero deben corregirse y retirarse de aquí.
const XFAIL = new Set([
    // Arquitectura de mensajería por pestañas anterior, sustituida por el
    // sistema unificado _umState (js/coach/comms/panel.js). Las funciones que
    // estos tests ejercitan ya no existen en el código.
    'test_cgetstaff_role_filter.js',
    'test_contact_manager_crash.js',
    'test_delete_all_messages_audit.js',
    'test_parent_report_targets.js',
    'test_sdsendreplytocoach_creates_thread.js',
    'test_selfmessage_autoopen.js',
    'test_staff_chat_unification.js',
    'test_stale_chat_pane_reset.js',
    // Aserción desactualizada sobre el patrón EXACTO de código fuente de la
    // pestaña "config" en club-reports.js; el comportamiento real que prueba
    // (Director la ve, Coordinador no) sigue en verde.
    'test_v269_fixes.js',
    // Incompatibilidad del arnés de test con Node 24 (vm.runInContext no
    // expone `window`), no un bug de producto.
    'test_timer_color_dom.js',
    'test_timer_color_semaforo.js',
]);

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

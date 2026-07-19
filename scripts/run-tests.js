#!/usr/bin/env node
/**
 * run-tests.js — Loop de la suite de tests de CHRONOS FÚTBOL.
 *
 * Ejecuta CADA `scripts/test_*.{js,mjs,cjs}` como un proceso Node independiente
 * y devuelve exit 1 si CUALQUIERA falla (exit != 0). Sin cuarentena ni magia:
 * el resultado refleja el estado real del repo.
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

const testFiles = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => /^test_.*\.(js|mjs|cjs)$/.test(f))
    .sort();

console.log(`CHRONOS test suite — ${testFiles.length} test(s)`);
console.log('-'.repeat(60));

let passed = 0;
const failed = [];
const start = Date.now();

for (const f of testFiles) {
    const rel = path.join('scripts', f);
    const res = spawnSync(process.execPath, [rel], { cwd: ROOT, encoding: 'utf8' });
    if (res.status === 0) {
        passed++;
        console.log(`  PASS  ${f}`);
    } else {
        failed.push(f);
        console.log(`  FAIL  ${f}  (exit ${res.status})`);
        const tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').slice(-8);
        tail.forEach((l) => console.log('        ' + l));
    }
}

const secs = ((Date.now() - start) / 1000).toFixed(1);
console.log('-'.repeat(60));
console.log(`Resultado: ${passed}/${testFiles.length} OK en ${secs}s`);

if (failed.length) {
    console.log(`\nFALLARON (${failed.length}): ${failed.join(', ')}`);
    process.exit(1);
}
console.log('\nTodos los tests pasaron.');
process.exit(0);

// ─────────────────────────────────────────────────────────────────────────
//  test_artefacto_limpio.js  ·  🚨 incidente 2026-10-02
//
//  Los datos salen de esta carpeta por TRES puertas, y cada una tiene su
//  propia lista: git (.gitignore), el hosting (firebase.json → ignore) y el
//  paquete de entrega (scripts/empaqueta.js). Hasta v779 sólo se vigilaba la
//  primera, y por las otras dos salieron cinco respaldos reales —el export
//  de Auth con los hashes de contraseña incluido—: DESCARGABLES en producción
//  y metidos en el ZIP de la auditoría externa del 30-09.
//
//  1. HOSTING: se le pregunta a la MISMA función con la que firebase-tools
//     decide qué sube (`lib/listFiles`), sobre una carpeta trampa sembrada
//     de ficheros sensibles. Leer el `ignore` a ojo es como se coló esto.
//  2. DISCO: dentro del proyecto no puede haber volcados de datos, estén o
//     no ignorados: un compresor no lee .gitignore.
//  3. PAQUETE: la lista de prohibidos atrapa cada categoría, y el lector del
//     ZIP lee un ZIP de verdad.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 600)); }
};

const SENSIBLES = [
    'backups/auth_users_2026-01-01.json',
    'backups/cualquier_cosa.json',
    'sub/backups/x.json',
    'auth_users_suelto.json',
    'scripts/ops/backup_users_abc_123.json',
    'respaldo_live_matches.json',
    'js/respaldo_algo.json',
    '.claude/settings.local.json',
    '.env',
    'functions/.env.local',
    'serviceAccountKey.json',
    'firebase-adminsdk-xyz.json',
    'clave.pem',
    'CAPTURAS/c.png',
    'dist/cronos-futbol_abc.zip',
    'implementar.txt',
    'node_modules/x/index.js',
];
const LEGITIMOS = ['index.html', 'live.html', 'js/app.js', 'style.css', 'manifest.json'];

const sembrar = (dir, lista) => {
    for (const f of lista) {
        const p = path.join(dir, f);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, '{}');
    }
};

console.log('\n══ 🚨 Las tres puertas de salida de datos ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🌐 El hosting no publica nada sensible');
{
    let listFiles = null;
    try { listFiles = require(path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'listFiles')).listFiles; }
    catch (_) { /* se reporta abajo */ }
    const ignore = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8')).hosting.ignore;

    if (typeof listFiles !== 'function') {
        ok('1a · se puede medir con la función real de firebase-tools', false,
           'falta node_modules/firebase-tools: ejecuta `npm ci`. Un guard que no puede medir no aprueba');
    } else {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cronos_hosting_'));
        let subidos = [];
        try {
            sembrar(tmp, SENSIBLES.concat(LEGITIMOS));
            subidos = listFiles(tmp, ignore);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
        const fugas = SENSIBLES.filter((f) => subidos.includes(f));
        ok('1a · 🔑🔑 ninguno de los ' + SENSIBLES.length + ' ficheros trampa se subiría',
           fugas.length === 0, 'se publicarían: ' + fugas.join(', '));
        const faltan = LEGITIMOS.filter((f) => !subidos.includes(f));
        ok('1b · …y la app SÍ se sube (el ignore no es un «no subir nada»)',
           faltan.length === 0, 'no se subirían: ' + faltan.join(', '));
    }
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 💽 No hay volcados de datos dentro del proyecto');
{
    const RE = /^(auth_users_.*|backup_users_.*|respaldo_.*|usuarios_temp.*)\.json$|^\.env(\..*)?$|^(serviceaccount|service-account|firebase-adminsdk-).*|\.(pem|p12|pfx)$/i;
    const SALTAR = new Set(['node_modules', '.git', 'CAPTURAS', 'Presentación', 'Presentacion']);
    const hallados = [];
    const recorrer = (dir, rel) => {
        let ents;
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const e of ents) {
            if (SALTAR.has(e.name)) continue;
            const r = rel ? rel + '/' + e.name : e.name;
            if (e.isDirectory()) recorrer(path.join(dir, e.name), r);
            else if (RE.test(e.name)) hallados.push(r);
        }
    };
    recorrer(ROOT, '');
    const destino = require('./ruta_respaldos').DIR_RESPALDOS;
    ok('2a · 🔑🔑 ni un volcado (Auth, usuarios, respaldos, .env, claves) en la carpeta',
       hallados.length === 0, 'muévelos a ' + destino + ': ' + hallados.slice(0, 10).join(', '));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 📦 El paquete de entrega');
{
    const E = require('./empaqueta');
    const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^﻿/, ''));
    const s = PKG.scripts || {};

    ok('3a · `npm run package` y `package:verificar` existen',
       /empaqueta\.js/.test(s.package || '') && /empaqueta\.js --verificar/.test(s['package:verificar'] || ''));

    const sinAtrapar = SENSIBLES.filter((f) => E.rutasProhibidas([f]).length === 0);
    ok('3b · 🔑🔑 la lista de prohibidos atrapa cada fichero trampa',
       sinAtrapar.length === 0, 'se colarían: ' + sinAtrapar.join(', '));

    ok('3c · …y no atrapa el producto',
       E.rutasProhibidas(LEGITIMOS.concat(['scripts/empaqueta.js', 'functions/index.js', 'RECUPERACION.md'])).length === 0);

    const SRC = fs.readFileSync(path.join(__dirname, 'empaqueta.js'), 'utf8');
    ok('3d · se hace con `git archive` (sólo lo versionado), no comprimiendo la carpeta',
       /'archive', '--format=zip'/.test(SRC));
    ok('3e · se niega con cambios sin commitear (el paquete es un commit)',
       /--untracked-files=no/.test(SRC) && /commitea primero/.test(SRC));
    ok('3f · valida el ZIP PRODUCIDO, no la lista de git',
       /nombresDelZip\(zip\)/.test(SRC) && /rutasProhibidas\(enZip\)/.test(SRC));

    // El lector del ZIP, contra un ZIP de verdad (sólo con git disponible).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cronos_zip_'));
    try {
        const z = path.join(tmp, 'p.zip');
        const r = cp.spawnSync('git', ['archive', '--format=zip', '--prefix=p/', '-o', z, 'HEAD', 'package.json', 'firebase.json'],
                               { cwd: ROOT, encoding: 'utf8' });
        if (r.status === 0) {
            const n = E.nombresDelZip(z);
            ok('3g · el lector del ZIP lee los nombres reales', n.includes('p/package.json') && n.includes('p/firebase.json'), n.join(', '));
        } else {
            console.log('  ℹ️  3g omitida: sin checkout de git no hay ZIP de referencia');
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

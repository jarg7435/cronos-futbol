// ─────────────────────────────────────────────────────────────────────────
//  test_admin_compat.js  ·  🔧 Fase 3 (2026-09-22)
//
//  firebase-admin@14 BORRO `admin.firestore()`, `admin.auth()` y
//  `admin.credential`. En v633 eso tumbo el backend entero SIETE HORAS con el
//  despliegue diciendo «Successful»: es un fallo de EJECUCION, que ninguna
//  herramienta de empaquetado ni de despliegue ve.
//
//  Los cinco scripts de mantenimiento de la raiz usan exactamente esas tres
//  APIs, y son herramientas a las que se recurre DURANTE UN INCIDENTE. Al
//  subir la raiz a firebase-admin@14 (Fase 3) habrian muerto los cinco, en
//  silencio, hasta el dia que hicieran falta.
//
//  🔑 LO QUE VIGILA ESTE GUARD, Y POR QUE ASI:
//
//  1. Que el adaptador RESTITUYA de verdad las tres APIs. **Ejecutado**, no
//     por regex: aqui la diferencia entre «el fichero menciona getFirestore» y
//     «admin.firestore es una funcion» es todo el defecto.
//
//  2. Que NINGUN script de la raiz vuelva a pedir `firebase-admin` a pelo.
//     Barrido ESTRUCTURAL sobre scripts/: el sexto script que alguien escriba
//     manana no va a estar en ninguna lista escrita a mano — esa es la trampa
//     que ya pago `_check_syntax.js` en v596 con sus 18 ficheros.
//
//  3. Que el adaptador siga siendo CONDICIONAL. Si alguien quita los
//     `if (no existe)`, deja de funcionar con firebase-admin@13 y el problema
//     cambia de sitio en lugar de desaparecer.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 400)); }
};

const COMPAT = leer('scripts/_admin_compat.js');

console.log('\n══ 🔧 Fase 3 · firebase-admin: la API de espacio de nombres sobrevive ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🔑 EJECUTADO: el adaptador restituye lo que la v14 borró');
{
    const admin = require('./_admin_compat');

    ok('1a · 🔑🔑 `admin.firestore` es una FUNCIÓN',
       typeof admin.firestore === 'function',
       'typeof = ' + typeof admin.firestore);

    ok('1b · 🔑 …y arrastra FieldValue/Timestamp COLGANDO DE ELLA',
       typeof admin.firestore.FieldValue === 'function' &&
       typeof admin.firestore.Timestamp === 'function',
       'el código existente escribe admin.firestore.FieldValue.serverTimestamp()');

    ok('1c · 🔑🔑 `admin.auth` es una FUNCIÓN',
       typeof admin.auth === 'function', 'typeof = ' + typeof admin.auth);

    ok('1d · 🔑🔑 `admin.credential.cert` y `.refreshToken` existen',
       admin.credential && typeof admin.credential.cert === 'function' &&
       typeof admin.credential.refreshToken === 'function',
       'los cinco scripts inicializan con uno de los dos');

    ok('1e · y `initializeApp` sigue en su sitio',
       typeof admin.initializeApp === 'function');

    // 🔑 La prueba de que esto NO es decorativo: en la v14 el módulo crudo NO
    //    trae las tres APIs. Si algún día vuelven, esta aserción se pone roja y
    //    habrá que retirar el adaptador — que es justo cuándo hay que saberlo.
    //
    // 🚨 SE MIDE EN UN PROCESO LIMPIO, Y NO ES UN CAPRICHO. El adaptador MUTA
    //    el objeto del módulo, que node cachea y comparte: en cuanto se ha
    //    hecho `require('./_admin_compat')` —tres líneas más arriba—, un
    //    `require('firebase-admin')` en ESTE proceso devuelve el objeto YA
    //    PARCHEADO. Comprobarlo aquí daba un rojo en falso diciendo que la v14
    //    sí las traía. Lo cazó este guard contra sí mismo.
    const sonda = require('child_process').spawnSync(process.execPath,
        ['-e', "const a=require('firebase-admin');" +
               "console.log(JSON.stringify({v:a.SDK_VERSION,f:typeof a.firestore," +
               "au:typeof a.auth,c:typeof a.credential}));"],
        { cwd: ROOT, encoding: 'utf8' });
    let crudo = null;
    try { crudo = JSON.parse((sonda.stdout || '').trim()); } catch (e) { /* abajo */ }

    ok('1f · la sonda en proceso limpio ha respondido', !!crudo,
       (sonda.stdout || '') + (sonda.stderr || ''));

    if (crudo) {
        const mayor = parseInt(String(crudo.v || '0').split('.')[0], 10);
        if (mayor >= 14) {
            ok('1g · 🔑🔑 (v' + crudo.v + ') el módulo CRUDO no las trae: el adaptador HACE FALTA',
               crudo.f === 'undefined' && crudo.au === 'undefined' && crudo.c === 'undefined',
               JSON.stringify(crudo) + ' — si esto cae, la v14 las ha devuelto y el adaptador sobra');
        } else {
            ok('1g · (v' + crudo.v + ') con la v13 el adaptador es un no-op, como debe',
               crudo.f === 'function');
        }
    }
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🧹 Nadie pide `firebase-admin` a pelo (barrido estructural)');
{
    const encontrados = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.name.endsWith('.js')) continue;
            const rel = path.relative(ROOT, p).replace(/\\/g, '/');
            // ⚠️ DOS EXCLUSIONES, UNA A UNA Y CON MOTIVO — nunca por patrón,
            //    que es como una lista a mano se convierte en cobertura falsa:
            //    · el adaptador ES quien lo envuelve;
            //    · este guard necesita el módulo CRUDO para demostrar que la
            //      v14 no trae las tres APIs (aserción 1g).
            if (rel === 'scripts/_admin_compat.js') continue;
            if (rel === 'scripts/test_admin_compat.js') continue;
            const src = fs.readFileSync(p, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
            if (/require\(\s*'firebase-admin'\s*\)/.test(src)) encontrados.push(rel);
        }
    })(path.join(ROOT, 'scripts'));

    ok('2a · 🔑🔑 ningún script de scripts/ requiere `firebase-admin` directamente',
       encontrados.length === 0,
       encontrados.length ? ('lo hacen: ' + encontrados.join(', ') +
                             '  → cámbialos a _admin_compat') : 'ok');

    // Y que los cinco conocidos sigan enganchados (si alguien revierte uno).
    const esperados = [
        'scripts/audit-subCategory.js',
        'scripts/backfill-link-category.js',
        'scripts/cleanup-contaminated-reports.js',
        'scripts/ops/inspect_club_dia_users.js',
        'scripts/ops/investigate-ind.js',
    ];
    const sinEnganchar = esperados.filter((f) => !/_admin_compat/.test(leer(f)));
    ok('2b · los cinco scripts de mantenimiento pasan por el adaptador',
       sinEnganchar.length === 0, sinEnganchar.join(', '));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 🔀 El adaptador sirve para las DOS versiones');
{
    ok('3a · 🔑 cada parche va detrás de un `if (no existe)`',
       /if \(typeof admin\.firestore !== 'function'\)/.test(COMPAT) &&
       /if \(typeof admin\.auth !== 'function'\)/.test(COMPAT) &&
       /if \(!admin\.credential\)/.test(COMPAT),
       'sin la condición dejaría de funcionar con firebase-admin@13');

    ok('3b · reutiliza los `cert`/`refreshToken` de la raíz, no los reimplementa',
       /cert:\s*admin\.cert/.test(COMPAT) && /refreshToken:\s*admin\.refreshToken/.test(COMPAT));

    ok('3c · toma FieldValue y compañía de `firebase-admin/firestore`',
       /require\('firebase-admin\/firestore'\)/.test(COMPAT));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) 🛡️ Y el backend conserva SU propio apaño (v633)');
{
    // Mismo defecto, otro fichero. functions/ corre admin 14 desde v633 y
    // sobrevive gracias a su shim: si alguien lo quitara, vuelven las 7 horas.
    const FNS = leer('functions/index.js');
    ok('4a · 🔑 functions/index.js sigue restituyendo `admin.firestore`',
       /typeof admin\.firestore !== 'function'/.test(FNS) &&
       /getFirestore/.test(FNS),
       'sin esto el backend entero devuelve 500 y el despliegue dice «Successful»');
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

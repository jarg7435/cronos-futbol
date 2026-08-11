// ─────────────────────────────────────────────────────────────────────────
// test_deploy_targets_hosting.js · el despliegue va A DONDE DICE que va
//
// 🔑🔑🔑 EL FALLO QUE ORIGINA ESTE GUARD (2026-08-11, al subir v506):
// `firebase.json` tenia el sitio de hosting FIJADO A MANO
// (`"hosting": { "site": "cronos-futbol-test" }`). Con esa linea puesta,
// `--project cronos-futbol-app` cambia el PROYECTO pero el hosting sigue
// yendo al sitio de TESTEO. Resultado: `npm run deploy:prod` desplegaba el
// front-end en TESTEO y anunciaba "Deploying to 'cronos-futbol-app' …
// Deploy complete!" tan tranquilo. Un despliegue a produccion que no llega a
// produccion y que ademas te dice que si.
//
// ⚠️ Y EN LA DIRECCION CONTRARIA ES PEOR: si ese `site` se queda apuntando a
// `cronos-futbol-app`, entonces `npm run deploy:staging` PUBLICA EN
// PRODUCCION. La misma linea rompe en los dos sentidos segun como se quede.
//
// LA SOLUCION QUE SE PROTEGE AQUI: un unico `target` ("live") en
// firebase.json, sin `site`, y en `.firebaserc` ese mismo nombre resuelto a
// un sitio DISTINTO en cada proyecto. Asi **el destino lo decide SOLO el
// `--project`**, y no hay 145 renglones de configuracion duplicados que
// puedan divergir.
//
// LO QUE PROTEGE:
//
//  A · NO VUELVE EL `site` FIJADO. Es la linea que causo el fallo.
//  B · CADA PROYECTO RESUELVE `live` A SU PROPIO SITIO. Un copiar-pegar que
//      deje los dos apuntando a `cronos-futbol-app` convertiria
//      `deploy:staging` en un despliegue a produccion: se comprueba que los
//      dos sitios son DISTINTOS y que cada uno es el suyo.
//  C · ⚠️ NINGUN SCRIPT DE DESPLIEGUE SIN `--project`. Habia tres
//      (`deploy:hosting`, `deploy:functions`, `deploy:rules`) que caian en el
//      proyecto por defecto —produccion— sin que se viera por ningun lado.
//  D · 🔑 `deploy:prod` LLEVA `--only`. El comando original era
//      `firebase deploy --project cronos-futbol-app` a pelo: habria subido a
//      produccion las 18 Cloud Functions y las reglas de Firestore, ambas con
//      cientos de lineas sin commitear y sin probar, de propina con un
//      arreglo de front-end.
//  E · `deploy:prod` NO despliega functions. Las functions se despliegan
//      acotadas por nombre y a proposito (ver memoria del archivado de
//      entrenador), nunca de rebote.
//
// Aqui la verdad es la ESTRUCTURA de dos ficheros de configuracion, asi que
// el guard los parsea de verdad (no busca cadenas sueltas). La resolucion
// real se comprobo ademas con `firebase target --project <alias>` y con un
// `--dry-run` contra produccion.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

// ⚠️ package.json de este repo lleva BOM de UTF-8 y JSON.parse lo rechaza
// (npm y el CLI de firebase lo toleran, asi que no da la cara por ningun
// otro lado). Se retira antes de parsear.
const leerJson = (rel) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, ''));

const firebaseJson = leerJson('firebase.json');
const firebaserc   = leerJson('.firebaserc');
const pkg          = leerJson('package.json');

const SITIO_PROD = 'cronos-futbol-app';
const SITIO_TEST = 'cronos-futbol-test';
const TARGET     = 'live';

console.log('── el despliegue va a donde dice que va ──\n');

// ═══ PARTE A · firebase.json: target, y NUNCA un site fijado ═══
console.log('── PARTE A · firebase.json ──');
{
    const h = firebaseJson.hosting;
    ok('A1 · hay configuracion de hosting', !!h);

    // Puede ser objeto (un sitio) o array (varios). Se normaliza.
    const entradas = Array.isArray(h) ? h : [h];

    const conSite = entradas.filter(e => e && typeof e.site === 'string');
    ok('A2 · 🔑🔑🔑 NINGUNA entrada fija `site` (fue la causa del fallo)',
       conSite.length === 0,
       conSite.length ? 'site fijado a: ' + conSite.map(e => e.site).join(', ') : '');

    const sinTarget = entradas.filter(e => !e || typeof e.target !== 'string');
    ok('A3 · toda entrada declara `target`', sinTarget.length === 0,
       'entradas sin target: ' + sinTarget.length);

    ok('A4 · el target es "' + TARGET + '"',
       entradas.every(e => e.target === TARGET),
       entradas.map(e => e && e.target).join(', '));
}

// ═══ PARTE B · .firebaserc: cada proyecto, a SU sitio ═══
console.log('\n── PARTE B · .firebaserc ──');
{
    const proyectos = firebaserc.projects || {};
    ok('B1 · existen los alias staging y production',
       proyectos.staging === SITIO_TEST && proyectos.production === SITIO_PROD,
       JSON.stringify(proyectos));

    const t = firebaserc.targets || {};
    const destino = (proyecto) => {
        const lista = ((t[proyecto] || {}).hosting || {})[TARGET];
        return Array.isArray(lista) && lista.length === 1 ? lista[0] : null;
    };
    const dProd = destino(SITIO_PROD);
    const dTest = destino(SITIO_TEST);

    ok('B2 · el proyecto de PRODUCCION resuelve "' + TARGET + '" a su sitio',
       dProd === SITIO_PROD, 'resuelve a: ' + dProd);
    ok('B3 · el proyecto de TESTEO resuelve "' + TARGET + '" a su sitio',
       dTest === SITIO_TEST, 'resuelve a: ' + dTest);
    ok('B4 · ⚠️ y NO son el mismo sitio (un copiar-pegar aqui haria que ' +
       'deploy:staging publicase en PRODUCCION)',
       dProd !== null && dTest !== null && dProd !== dTest,
       'prod=' + dProd + ' test=' + dTest);
}

// ═══ PARTE C · package.json: ningun despliegue a ciegas ═══
console.log('\n── PARTE C · scripts de despliegue ──');
{
    const scripts = pkg.scripts || {};
    const despliegues = Object.keys(scripts)
        .filter(k => k.startsWith('deploy') && /\bfirebase\s+deploy\b/.test(scripts[k]));

    ok('C1 · hay scripts de despliegue que revisar', despliegues.length > 0,
       despliegues.join(', '));

    const sinProyecto = despliegues.filter(k => !/--project\s+\S/.test(scripts[k]));
    ok('C2 · ⚠️ TODOS declaran --project (ninguno cae en el proyecto por ' +
       'defecto, que es PRODUCCION)',
       sinProyecto.length === 0,
       sinProyecto.map(k => k + ': ' + scripts[k]).join(' | '));

    const sinOnly = despliegues.filter(k => !/--only\b/.test(scripts[k]));
    ok('C3 · 🔑 TODOS acotan con --only (un `firebase deploy` pelado arrastra ' +
       'functions y reglas)',
       sinOnly.length === 0,
       sinOnly.map(k => k + ': ' + scripts[k]).join(' | '));

    const prod = scripts['deploy:prod'] || '';
    ok('C4 · deploy:prod existe y apunta a produccion',
       /--project\s+(production|cronos-futbol-app)\b/.test(prod), prod);
    ok('C5 · deploy:prod despliega hosting por target',
       /--only\s+[^\s]*hosting:live/.test(prod), prod);
    ok('C6 · 🔑 deploy:prod NO despliega functions de rebote',
       !/\bfunctions\b/.test(prod), prod);

    const stg = scripts['deploy:staging'] || '';
    ok('C7 · deploy:staging apunta a staging',
       /--project\s+(staging|cronos-futbol-test)\b/.test(stg), stg);
    ok('C8 · deploy:staging despliega hosting por target',
       /--only\s+[^\s]*hosting:live/.test(stg), stg);
    ok('C9 · deploy:staging NO despliega functions (CLAUDE.md: sin costes)',
       !/\bfunctions\b/.test(stg), stg);
}

console.log('\n' + (fail === 0 ? 'TODO OK' : 'FALLOS: ' + fail) + ' (pass=' + pass + ')');
process.exit(fail === 0 ? 0 : 1);

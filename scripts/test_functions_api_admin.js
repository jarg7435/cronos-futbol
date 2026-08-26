// ─────────────────────────────────────────────────────────────────────────
//  test_functions_api_admin.js  ·  v633
//
//  🔴🔴 EL BACKEND ENTERO ESTUVO CAIDO EN PRODUCCION Y NADIE SE ENTERO.
//
//  Al subir `firebase-admin` a la v14 (v631) desaparecio la API con espacio de
//  nombres: `admin.firestore()`, `admin.auth()` y `admin.firestore.FieldValue`
//  ya no existen. El export de raiz solo trae initializeApp/getApp/cert.
//
//  🚨 LO QUE HACE QUE ESTO MEREZCA UN GUARD PROPIO: **el deploy dijo
//  "Successful update operation"**. Es un TypeError en tiempo de EJECUCION, no
//  un error de compilacion ni de empaquetado. Cada funcion que tocara Firestore
//  o Auth devolvia 500 al pulsar el boton, y ninguna herramienta de despliegue
//  lo menciono. Se descubrio 7 horas despues, y por casualidad: se estaba
//  probando el correo de invitacion, que no tenia nada que ver.
//
//  🔑 POR ESO ESTE GUARD **CARGA EL MODULO DE VERDAD**. Una regex sobre el
//  fuente habria visto `admin.firestore(...)` escrito y habria dado el visto
//  bueno: el fuente nunca estuvo mal — lo que cambio fue lo que la libreria
//  ofrece. Aqui se hace `require()` del index.js real, con la libreria real
//  instalada, y se comprueba que las llamadas que el codigo hace EXISTEN.
//
//  ⚠️ Requiere `functions/node_modules`. Si no estan, el test se salta con
//  aviso en vez de mentir: un verde sin dependencias no probaria nada.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FDIR = path.join(ROOT, 'functions');
const SRC = fs.readFileSync(path.join(FDIR, 'index.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

console.log('\n══ v633 · la API de firebase-admin que el codigo REALMENTE usa ══');

if (!fs.existsSync(path.join(FDIR, 'node_modules', 'firebase-admin'))) {
    console.log('\nSKIP · falta functions/node_modules (ejecuta `npm install` dentro de functions/).');
    console.log('       No se da por bueno sin dependencias: seria un verde que no prueba nada.');
    process.exit(0);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 📏 Que usa el codigo, contado sobre el fuente');
const usos = {
    'admin.firestore(':            (SRC.match(/admin\.firestore\(/g) || []).length,
    'admin.auth(':                 (SRC.match(/admin\.auth\(/g) || []).length,
    'admin.firestore.FieldValue':  (SRC.match(/admin\.firestore\.FieldValue/g) || []).length,
};
for (const [k, v] of Object.entries(usos)) console.log('     ' + k.padEnd(30) + v);
ok('1a · el codigo sigue usando la forma con espacio de nombres',
   usos['admin.firestore('] > 0 && usos['admin.auth('] > 0,
   'si algun dia se migran los 71 puntos de llamada, este guard hay que reescribirlo');

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔴 Lo que la libreria instalada ofrece por si sola');
{
    const admin = require(path.join(FDIR, 'node_modules', 'firebase-admin'));
    const ver = require(path.join(FDIR, 'node_modules', 'firebase-admin', 'package.json')).version;
    console.log('     firebase-admin instalado: ' + ver);
    // ⚠️ ESTO NO ES UN FALLO: es la constatacion de por que hace falta el
    //    adaptador. Si algun dia vuelve a existir, el adaptador no estorba
    //    (va detras de un `if (typeof ... !== 'function')`).
    const tieneNamespace = typeof admin.firestore === 'function';
    console.log('     admin.firestore de fabrica: ' + (tieneNamespace ? 'SI' : 'NO (v13+ la elimino)'));
    ok('2a · se ha podido cargar firebase-admin', !!ver);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 🔑 Y lo que hay DESPUES de cargar el index.js real');
{
    // Se evita el arranque real de las funciones: solo interesa el efecto del
    // adaptador sobre el objeto `admin`, que es un singleton del proceso.
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'cronos-futbol-app';
    process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG ||
        JSON.stringify({ projectId: 'cronos-futbol-app' });

    let cargado = true, motivo = '';
    try {
        require(path.join(FDIR, 'index.js'));
    } catch (e) {
        cargado = false; motivo = e && e.message;
    }
    ok('3a · 🔑 functions/index.js se carga sin reventar', cargado, motivo);

    const admin = require(path.join(FDIR, 'node_modules', 'firebase-admin'));

    ok('3b · 🔑🔑 `admin.firestore` es una FUNCION (40 llamadas dependen de ello)',
       typeof admin.firestore === 'function',
       'este es literalmente el TypeError que tumbo el backend: "admin.firestore is not a function"');

    ok('3c · 🔑🔑 y ADEMAS espacio de nombres: `admin.firestore.FieldValue` (21 usos)',
       !!(admin.firestore && admin.firestore.FieldValue),
       'una funcion pelada dejaria las 21 en undefined, y se veria igual de tarde');

    ok('3d · …con los metodos que el codigo llama de verdad',
       !!(admin.firestore && admin.firestore.FieldValue &&
          typeof admin.firestore.FieldValue.serverTimestamp === 'function' &&
          typeof admin.firestore.FieldValue.delete === 'function' &&
          typeof admin.firestore.FieldValue.arrayUnion === 'function'));

    ok('3e · 🔑 `admin.auth` es una FUNCION (10 llamadas)',
       typeof admin.auth === 'function');

    // ── Y que la llamada DEVUELVA algo utilizable, no solo que exista ──
    let db = null, dbErr = '';
    try { db = admin.firestore(); } catch (e) { dbErr = e && e.message; }
    ok('3f · 🔑 `admin.firestore()` devuelve un cliente con collection()/doc()',
       !!(db && typeof db.collection === 'function' && typeof db.doc === 'function'),
       dbErr || 'que exista la funcion no basta: tiene que devolver el cliente');

    let auth = null, authErr = '';
    try { auth = admin.auth(); } catch (e) { authErr = e && e.message; }
    ok('3g · `admin.auth()` devuelve un cliente con los metodos que se usan',
       !!(auth && typeof auth.setCustomUserClaims === 'function' &&
          typeof auth.deleteUser === 'function' && typeof auth.getUserByEmail === 'function'),
       authErr);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) ⚠️ El adaptador, tal y como esta escrito');
{
    ok('4a · va DETRAS de un `if`: si la API vuelve, no se pisa',
       /if \(typeof admin\.firestore !== 'function'\)/.test(SRC) &&
       /if \(typeof admin\.auth !== 'function'\)/.test(SRC));

    ok('4b · usa las puertas modulares, no un parche a mano',
       /require\('firebase-admin\/firestore'\)/.test(SRC) &&
       /require\('firebase-admin\/auth'\)/.test(SRC));

    ok('4c · 🔑 va DESPUES de initializeApp()',
       SRC.indexOf('admin.initializeApp()') < SRC.indexOf("require('firebase-admin/firestore')"),
       'getFirestore() sin app inicializada lanza');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n5) 🛠️ Los guiones de operacion manual (no se despliegan, nadie los prueba)');
{
    //  🚨 POR QUE ESTAN AQUI. `fix-sa-claim.js` y `backfill-clubs-public.js` no
    //  son Cloud Functions: se ejecutan a mano, sueltos, el dia que hacen falta.
    //  Se llevaron el MISMO golpe de la v14 y nadie se habria enterado hasta ese
    //  dia — que ademas es un dia malo: uno devuelve los claims al SuperAdmin y
    //  el otro rellena la lista de clubes del formulario de alta.
    //
    //  ⚠️ NO SE PUEDEN EJECUTAR PARA COMPROBARLO: el primero ESCRIBE claims de
    //  verdad. Asi que se extraen sus bloques de adaptador —el texto real de los
    //  ficheros— y se ejercitan en un proceso APARTE.
    //
    //  🔑 EL PROCESO APARTE NO ES CEREMONIA. `admin` es un singleton del
    //  proceso, y la parte 3 de arriba ya lo ha parcheado al cargar index.js:
    //  comprobarlo aqui mismo daria verde sin haber probado nada de estos dos
    //  ficheros. Es la misma trampa del aprobado falso que ya mordio hoy.
    const { execFileSync } = require('child_process');

    const guiones = [
        { f: path.join(FDIR, 'fix-sa-claim.js'),
          n: 'fix-sa-claim.js', necesita: 'auth',
          porque: 'devuelve los claims al SuperAdmin: se usa justo cuando algo ha ido mal' },
        { f: path.join(FDIR, 'scripts', 'backfill-clubs-public.js'),
          n: 'backfill-clubs-public.js', necesita: 'firestore',
          porque: 'rellena clubs_public, de donde el alta saca la lista de clubes' },
    ];

    for (const g of guiones) {
        const src = fs.readFileSync(g.f, 'utf8');

        // Bloque 1: el adaptador de la credencial (va ANTES de initializeApp).
        const mCred = src.match(/if \(!admin\.credential\) \{[\s\S]*?\n\}/);
        // Bloque 2: el que restaura firestore/auth (va DESPUES).
        const mApi = src.match(/const \{ get(?:Auth|Firestore)[\s\S]*?\n\}/);

        ok(g.n + ' · lleva el adaptador de la credencial', !!mCred,
           'admin.credential ya no existe en la v14');
        ok(g.n + ' · y el de ' + g.necesita, !!mApi);
        if (!mCred || !mApi) continue;

        const prueba = `
            const admin = require(${JSON.stringify(path.join(FDIR, 'node_modules', 'firebase-admin'))});
            if (typeof admin.credential !== 'undefined') { console.log('BASE_YA_EXISTE'); }
            ${mCred[0]}
            if (typeof admin.credential.applicationDefault !== 'function') throw new Error('sin applicationDefault');
            if (typeof admin.credential.refreshToken !== 'function') throw new Error('sin refreshToken');
            // Se inicializa SIN credencial real: solo interesa que haya app para
            // que getFirestore()/getAuth() puedan construirse.
            admin.initializeApp({ projectId: 'cronos-futbol-app' });
            ${mApi[0]}
            const api = admin.${g.necesita};
            if (typeof api !== 'function') throw new Error('admin.${g.necesita} no es funcion');
            const cli = api();
            if (!cli) throw new Error('admin.${g.necesita}() no devolvio cliente');
            console.log('OK');
        `;
        let salida = '', err = '';
        try {
            salida = execFileSync(process.execPath, ['-e', prueba],
                { cwd: FDIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) {
            err = String((e.stderr || '') + (e.message || '')).split('\n').filter(Boolean).slice(-3).join(' | ');
        }
        ok(g.n + ' · 🔑 EJECUTADO en proceso aparte: credencial + ' + g.necesita + ' funcionan',
           /OK/.test(salida), err || salida);
        ok(g.n + ' · ⚠️ y el proceso partia SIN el parche (la prueba es real)',
           !/BASE_YA_EXISTE/.test(salida),
           'si esto sale rojo, el aislamiento no funciona y el resto no prueba nada');
    }
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

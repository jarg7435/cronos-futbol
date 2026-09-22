// ═══════════════════════════════════════════════════════════════════════════
//  scripts/_admin_compat.js
//  firebase-admin, CON LA API DE ESPACIO DE NOMBRES, DA IGUAL LA VERSION
//
//  Uso:  const admin = require('./_admin_compat');      // desde scripts/
//        const admin = require('../_admin_compat');     // desde scripts/ops/
//
//  ═════════════════════════════════════════════════════════════════════
//  🔴🔴 POR QUE EXISTE: LA v14 BORRO `admin.firestore()`, `admin.auth()` Y
//      `admin.credential` (v633, 2026-08-26)
//
//  El export de raiz de firebase-admin@14 solo trae `initializeApp, getApp,
//  getApps, deleteApp, applicationDefault, cert, refreshToken, FirebaseError,
//  SDK_VERSION`. Todo lo demas se movio a subrutas (`firebase-admin/firestore`,
//  `firebase-admin/auth`).
//
//  🚨 Y LO QUE HAY QUE RECORDAR NO ES LA API, ES COMO SE MANIFESTO: el
//  backend estuvo SIETE HORAS caido en produccion con el despliegue diciendo
//  «Successful update operation» en las 18 funciones. Es un fallo de
//  EJECUCION: no se queja el empaquetado, ni el despliegue, ni ninguna
//  herramienta. Se descubrio por casualidad.
//
//  Los cinco scripts de mantenimiento de la raiz usan EXACTAMENTE las tres
//  APIs que desaparecieron, y son herramientas a las que se recurre DURANTE
//  UN INCIDENTE. Romperlas en silencio significa descubrirlo el peor dia.
//
//  🔑 ESTE FICHERO NO «MIGRA» NADA, ADAPTA. Cada parche va detras de un
//  `if (no existe)`, asi que:
//    · con firebase-admin@13 no hace absolutamente nada;
//    · con firebase-admin@14 restituye lo que falta.
//  Es a proposito: un adaptador que solo funciona con una version cambia el
//  problema de sitio en vez de quitarlo. Asi los scripts dejan de depender de
//  que mayor haya instalada.
//
//  ⚠️ NO SE REESCRIBEN LAS LLAMADAS DE LOS SCRIPTS. Es la misma decision que
//  tomo functions/index.js con sus 71 usos: adaptar en UN sitio en vez de
//  tocar setenta y uno. Cada llamada reescrita es una ocasion de equivocarse.
//
//  Guard: scripts/test_admin_compat.js
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

let admin;
try {
    admin = require('firebase-admin');
} catch (e) {
    console.error('firebase-admin no esta instalado. Ejecuta: npm install');
    process.exit(1);
}

// ── admin.firestore() y sus valores centinela ──────────────────────────
// ⚠️ `FieldValue`, `Timestamp`, `FieldPath` y `GeoPoint` cuelgan de la
//    FUNCION, no del modulo: el codigo existente escribe
//    `admin.firestore.FieldValue.serverTimestamp()`. Por eso `Object.assign`
//    sobre la funcion y no un objeto aparte.
if (typeof admin.firestore !== 'function') {
    const { getFirestore, FieldValue, Timestamp, FieldPath, GeoPoint } =
        require('firebase-admin/firestore');
    admin.firestore = Object.assign(() => getFirestore(),
        { FieldValue, Timestamp, FieldPath, GeoPoint });
}

// ── admin.auth() ───────────────────────────────────────────────────────
if (typeof admin.auth !== 'function') {
    const { getAuth } = require('firebase-admin/auth');
    admin.auth = () => getAuth();
}

// ── admin.credential.* ─────────────────────────────────────────────────
// En la v14 `cert`, `refreshToken` y `applicationDefault` SIGUEN EXISTIENDO,
// pero en la raiz del modulo: lo que desaparecio es el contenedor
// `admin.credential`. Se reconstruye apuntando a los de la raiz — no se
// reimplementa nada.
if (!admin.credential) {
    admin.credential = {
        cert:               admin.cert,
        refreshToken:       admin.refreshToken,
        applicationDefault: admin.applicationDefault,
    };
}

module.exports = admin;

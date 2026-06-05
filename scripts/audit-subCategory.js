/**
 * audit-subCategory.js  —  AUDITORIA READ-ONLY (no modifica nada)
 *
 * Cuenta cuantos documentos de la coleccion `users` tienen el campo legacy
 * `subCategory` (C MAYUSCULA) con valor NO NULO / NO VACIO.
 *
 * Es parte de la decision de la Fase 2b: solo se podran eliminar las 5
 * lecturas fallback de `subCategory` en panel.js cuando este script reporte 0.
 *
 * USO (desde la raiz del proyecto):
 *   1. Instalar firebase-admin (si no esta):
 *        npm install firebase-admin
 *   2. Colocar la credencial de servicio como sa-key.json en la raiz
 *      (o exportar SA_KEY_PATH apuntando a su ubicacion).
 *   3. Ejecutar:
 *        node scripts/audit-subCategory.js
 *
 * GARANTIA: este script SOLO usa operaciones de lectura (.get()).
 * No hay ningun set/update/delete. Es imposible que modifique datos.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const KEY_PATH = process.env.SA_KEY_PATH || path.resolve(process.cwd(), 'sa-key.json');

function fail(msg) {
  console.error('\n[AUDIT][ERROR] ' + msg + '\n');
  process.exit(1);
}

if (!fs.existsSync(KEY_PATH)) {
  fail('No se encontro la credencial de servicio en: ' + KEY_PATH +
       '\n  Coloca sa-key.json en la raiz o exporta SA_KEY_PATH=/ruta/a/key.json');
}

let admin;
try {
  admin = require('firebase-admin');
} catch (e) {
  fail('firebase-admin no esta instalado. Ejecuta: npm install firebase-admin');
}

const serviceAccount = require(KEY_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

(async function main() {
  console.log('\n========================================================');
  console.log(' AUDITORIA READ-ONLY: campo legacy "subCategory" en users');
  console.log(' Proyecto credencial : ' + (serviceAccount.project_id || '(desconocido)'));
  console.log(' Modo                : SOLO LECTURA (sin escrituras)');
  console.log('========================================================\n');

  let total = 0;            // total de docs en users
  let withSubCategory = 0;  // docs con subCategory presente y no nulo/no vacio
  let withNullEmpty = 0;    // docs con subCategory presente pero null/'' 
  const samples = [];       // hasta 20 ejemplos para inspeccion manual

  const snap = await db.collection('users').get();

  snap.forEach((docSnap) => {
    total++;
    const data = docSnap.data();
    if (Object.prototype.hasOwnProperty.call(data, 'subCategory')) {
      const v = data.subCategory;
      const isMeaningful = v !== null && v !== undefined && String(v).trim() !== '';
      if (isMeaningful) {
        withSubCategory++;
        if (samples.length < 20) {
          samples.push({
            uid: docSnap.id,
            email: data.email || '(sin email)',
            subCategory: v,
            subcategory_lower: Object.prototype.hasOwnProperty.call(data, 'subcategory')
              ? data.subcategory : '(ausente)',
          });
        }
      } else {
        withNullEmpty++;
      }
    }
  });

  console.log('--- RESULTADO ----------------------------------------');
  console.log(' Documentos en users                      : ' + total);
  console.log(' Con subCategory (mayus) NO nulo/no vacio  : ' + withSubCategory);
  console.log(' Con subCategory (mayus) presente pero null/"": ' + withNullEmpty);
  console.log('------------------------------------------------------\n');

  if (samples.length) {
    console.log('Ejemplos (max 20) con subCategory mayuscula con valor:');
    console.table(samples);
    console.log('');
  }

  if (withSubCategory === 0) {
    console.log('[AUDIT][OK] 0 documentos con subCategory mayuscula con valor.');
    console.log('            => SE PUEDE proceder con Fase 2b (eliminar lecturas fallback).\n');
  } else {
    console.log('[AUDIT][STOP] Hay ' + withSubCategory + ' documento(s) con subCategory mayuscula.');
    console.log('              => NO eliminar lecturas fallback aun. Requiere migracion de datos primero.\n');
  }

  // Cierre limpio (no deja la conexion abierta)
  await admin.app().delete();
  process.exit(0);
})().catch((e) => {
  fail('Fallo durante la auditoria: ' + (e && e.message ? e.message : e));
});

/**
 * audit-subCategory.js  —  AUDITORIA READ-ONLY (no modifica nada)
 *
 * Cuenta cuantos documentos de la coleccion `users` tienen el campo legacy
 * `subCategory` (C MAYUSCULA) con valor NO NULO / NO VACIO, tanto:
 *   (A) a nivel raiz del documento  -> data.subCategory
 *   (B) embebido en el array de roles -> data.allRoles[].subCategory
 *
 * Todos los usuarios (admins individuales, padres y sub-usuarios individuales)
 * viven en la coleccion raiz `users`, asi que un solo recorrido los cubre todos.
 *
 * Es parte de la decision de las Fases 2b/3b: solo se podran eliminar las
 * lecturas fallback de `subCategory` en los paneles cuando este script reporte
 * 0 en AMBAS ubicaciones (raiz + allRoles).
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
  let withSubCategory = 0;  // docs con subCategory RAIZ presente y no nulo/no vacio
  let withNullEmpty = 0;    // docs con subCategory RAIZ presente pero null/''
  let rolesScanned = 0;     // total de entradas allRoles[] inspeccionadas
  let withRoleSubCat = 0;   // entradas allRoles[] con subCategory no nulo/no vacio
  let docsWithRoleSubCat = 0; // docs distintos con al menos 1 rol con subCategory
  const samples = [];       // hasta 20 ejemplos (raiz) para inspeccion manual
  const roleSamples = [];   // hasta 20 ejemplos (allRoles) para inspeccion manual

  const isMeaningfulVal = (v) =>
    v !== null && v !== undefined && String(v).trim() !== '';

  const snap = await db.collection('users').get();

  snap.forEach((docSnap) => {
    total++;
    const data = docSnap.data();

    // (A) subCategory a nivel RAIZ del documento ----------------------
    if (Object.prototype.hasOwnProperty.call(data, 'subCategory')) {
      const v = data.subCategory;
      if (isMeaningfulVal(v)) {
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

    // (B) subCategory embebido en allRoles[] -------------------------
    if (Array.isArray(data.allRoles)) {
      let docHasRoleSubCat = false;
      data.allRoles.forEach((r, idx) => {
        if (!r || typeof r !== 'object') return;
        rolesScanned++;
        if (Object.prototype.hasOwnProperty.call(r, 'subCategory') &&
            isMeaningfulVal(r.subCategory)) {
          withRoleSubCat++;
          docHasRoleSubCat = true;
          if (roleSamples.length < 20) {
            roleSamples.push({
              uid: docSnap.id,
              email: data.email || '(sin email)',
              roleIdx: idx,
              role: r.role || '(sin role)',
              subCategory: r.subCategory,
              subcategory_lower: Object.prototype.hasOwnProperty.call(r, 'subcategory')
                ? r.subcategory : '(ausente)',
            });
          }
        }
      });
      if (docHasRoleSubCat) docsWithRoleSubCat++;
    }
  });

  console.log('--- RESULTADO ----------------------------------------');
  console.log(' Documentos en users                          : ' + total);
  console.log('');
  console.log(' (A) subCategory a nivel RAIZ del documento:');
  console.log('   Con valor NO nulo/no vacio                 : ' + withSubCategory);
  console.log('   Presente pero null/""                      : ' + withNullEmpty);
  console.log('');
  console.log(' (B) subCategory dentro de allRoles[]:');
  console.log('   Entradas allRoles[] inspeccionadas         : ' + rolesScanned);
  console.log('   Entradas con subCategory NO nulo/no vacio  : ' + withRoleSubCat);
  console.log('   Documentos distintos afectados             : ' + docsWithRoleSubCat);
  console.log('------------------------------------------------------\n');

  if (samples.length) {
    console.log('Ejemplos RAIZ (max 20) con subCategory mayuscula con valor:');
    console.table(samples);
    console.log('');
  }
  if (roleSamples.length) {
    console.log('Ejemplos allRoles[] (max 20) con subCategory mayuscula con valor:');
    console.table(roleSamples);
    console.log('');
  }

  const totalLegacy = withSubCategory + withRoleSubCat;
  if (totalLegacy === 0) {
    console.log('[AUDIT][OK] 0 ocurrencias de subCategory mayuscula con valor');
    console.log('            (ni en raiz ni en allRoles[]).');
    console.log('            => SE PUEDE proceder a eliminar lecturas fallback (Fase 3b).\n');
  } else {
    console.log('[AUDIT][STOP] Hay ' + totalLegacy + ' ocurrencia(s) de subCategory mayuscula:');
    console.log('              - raiz     : ' + withSubCategory);
    console.log('              - allRoles : ' + withRoleSubCat + ' (en ' + docsWithRoleSubCat + ' docs)');
    console.log('              => NO eliminar lecturas fallback aun. Migrar datos primero.\n');
  }

  // Cierre limpio (no deja la conexion abierta)
  await admin.app().delete();
  process.exit(0);
})().catch((e) => {
  fail('Fallo durante la auditoria: ' + (e && e.message ? e.message : e));
});

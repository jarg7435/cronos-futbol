// functions/scripts/backfill-clubs-public.js
// ====================================================================
// One-shot: copia name/type/status de cada doc de 'clubs' a 'clubs_public'.
//
// Contexto: la coleccion 'clubs' requiere autenticacion para lectura
// (SEC-008), por lo que el formulario de registro lee desde 'clubs_public'
// (espejo publico con solo 3 campos) mantenido por la Cloud Function
// syncClubPublic. Ese trigger solo crea/actualiza el espejo cuando un club
// se escribe, asi que los clubes YA EXISTENTES necesitan este backfill una vez.
//
// Uso:
//   node functions/scripts/backfill-clubs-public.js --dry   (no escribe nada)
//   node functions/scripts/backfill-clubs-public.js         (escribe el espejo)
//
// Requisitos de credenciales (una de estas opciones):
//   - GOOGLE_APPLICATION_CREDENTIALS apuntando a un service account JSON, o
//   - `gcloud auth application-default login` ejecutado previamente.
//
// El script es idempotente (usa set, no add) y NO borra nada.
// Usa los MISMOS defaults que la Cloud Function syncClubPublic para que
// backfill y trigger produzcan datos identicos.
// ====================================================================

const admin = require('firebase-admin');

/* ══════════════════════════════════════════════════════════════════════
   🔴 v633 · ADAPTADOR PARA firebase-admin 14 (mismo caso que index.js)

   La v14 borro la API con espacio de nombres: `admin.credential` y
   `admin.firestore` ya no existen. Las fabricas de credencial subieron a la
   raiz (`admin.applicationDefault`, `admin.cert`) y Firestore se pide por su
   propia puerta.

   ⚠️ VA PARTIDO EN DOS: la credencial hace falta ANTES de initializeApp y
   `getFirestore()` solo funciona DESPUES.

   🚨 Este guion NO se despliega, asi que nadie lo prueba. Y lo que hace es
   rellenar `clubs_public`, que es de donde el FORMULARIO DE ALTA saca la
   lista de clubes: si reventara, el sintoma seria un desplegable vacio en el
   registro, no un error hablando de este fichero.
   ══════════════════════════════════════════════════════════════════════ */
if (!admin.credential) {
  admin.credential = {
    applicationDefault: admin.applicationDefault,
    cert:               admin.cert,
    refreshToken:       admin.refreshToken,
  };
}

const DRY_RUN = process.argv.includes('--dry');

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const { getFirestore, FieldValue, Timestamp, FieldPath } = require('firebase-admin/firestore');
if (typeof admin.firestore !== 'function') {
  admin.firestore = Object.assign(() => getFirestore(), { FieldValue, Timestamp, FieldPath });
}

const db = admin.firestore();

(async () => {
  const snap = await db.collection('clubs').get();
  console.log('[backfill] clubs encontrados: ' + snap.size);

  let batch = db.batch();
  let ops = 0;
  let total = 0;

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const publicData = {
      name: d.name || null,
      type: d.type || 'club',
      status: d.status || 'active',
    };
    console.log('  ' + doc.id + ' -> ' + JSON.stringify(publicData));

    total++;
    if (!DRY_RUN) {
      batch.set(db.collection('clubs_public').doc(doc.id), publicData);
      ops++;
      if (ops === 500) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  }

  if (!DRY_RUN && ops > 0) await batch.commit();

  if (DRY_RUN) {
    console.log('[backfill] DRY-RUN: no se escribio nada. Docs que se escribirian: ' + total);
  } else {
    console.log('[backfill] Escritos en clubs_public: ' + total);
  }
  process.exit(0);
})().catch((e) => {
  console.error('[backfill] Error:', e);
  process.exit(1);
});

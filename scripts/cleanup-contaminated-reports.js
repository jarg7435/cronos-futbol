/**
 * cleanup-contaminated-reports.js
 *
 * LIMPIEZA de documentos CONTAMINADOS en `cronos_player_reports`.
 *
 * ─── CONTEXTO ────────────────────────────────────────────────────────────────
 * Un bug anterior escribia documentos de tipo `collective_match_report`
 * (y posiblemente otros tipos que NO son `parent_player_report`) con el campo
 * `parentUid` apuntando al padre/madre equivocado. Como la Query 1 del panel del
 * padre (`js/parent/panel.js`) buscaba por `where(parentUid == me.uid)`, esos
 * documentos contaminados se traian y el padre veia ~40 informes en vez de los
 * que le corresponden.
 *
 * El panel ya filtra por `type === 'parent_player_report'` (fix v169/v170), por
 * lo que la VISTA ya esta limpia. Este script BORRA los documentos contaminados
 * que siguen viviendo en Firestore para dejar la base de datos consistente.
 *
 * ─── QUE SE CONSIDERA CONTAMINADO ───────────────────────────────────────────
 * Un documento de `cronos_player_reports` es CONTAMINADO si:
 *   - Tiene el campo `parentUid` con un valor no vacio, Y
 *   - Su `type` NO es `parent_player_report`
 *     (p.ej. `collective_match_report`, o cualquier otro tipo de informe interno
 *      de staff/entrenador que nunca deberia llevar `parentUid`).
 *
 * Es decir: un informe que NO es para el padre pero que lleva el `parentUid` de
 * un padre. Esos son los unicos que se borran. Los informes legitimos
 * (`type === 'parent_player_report'`) NUNCA se tocan.
 *
 * ─── SEGURIDAD ──────────────────────────────────────────────────────────────
 *  1. Por defecto el script es READ-ONLY (modo auditoria). NO borra nada salvo
 *     que se pase explicitamente `--apply`.
 *  2. `--parent-email <email>` restringe el borrado SOLO a los documentos cuyo
 *     `parentUid` coincide con el UID de ese email (resuelto via Firebase Auth).
 *     Recomendado para la limpieza inicial: --parent-email arinagazone@gmail.com
 *  3. Antes de borrar imprime la lista completa de documentos afectados.
 *  4. Borrado en lotes (batched writes) con confirmacion explicita por flag.
 *
 * ─── USO ─────────────────────────────────────────────────────────────────────
 *   1. npm install   (firebase-admin)
 *   2. Coloca la credencial de servicio como sa-key.json en la raiz
 *      (o exporta SA_KEY_PATH=/ruta/a/key.json).
 *   3. AUDITORIA (no borra nada):
 *        node scripts/cleanup-contaminated-reports.js
 *      Acotada a un padre concreto:
 *        node scripts/cleanup-contaminated-reports.js --parent-email arinagazone@gmail.com
 *   4. BORRADO REAL (tras revisar la auditoria):
 *        node scripts/cleanup-contaminated-reports.js --parent-email arinagazone@gmail.com --apply
 *      Para TODOS los padres contaminados (mas agresivo, revisar antes):
 *        node scripts/cleanup-contaminated-reports.js --apply
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── Flags ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const emailIdx = argv.indexOf('--parent-email');
const PARENT_EMAIL = emailIdx !== -1 ? (argv[emailIdx + 1] || '').trim().toLowerCase() : null;

const COLLECTION = 'cronos_player_reports';
const SAFE_TYPE = 'parent_player_report'; // unico tipo que PUEDE llevar parentUid legitimamente

const KEY_PATH = process.env.SA_KEY_PATH || path.resolve(process.cwd(), 'sa-key.json');

function fail(msg) {
  console.error('\n[CLEANUP][ERROR] ' + msg + '\n');
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
  fail('firebase-admin no esta instalado. Ejecuta: npm install');
}

const serviceAccount = require(KEY_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const auth = admin.auth();

const isNonEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== '';

async function resolveParentUid(email) {
  try {
    const user = await auth.getUserByEmail(email);
    return user.uid;
  } catch (e) {
    fail('No se pudo resolver el UID del email "' + email + '": ' +
         (e && e.message ? e.message : e) +
         '\n  Comprueba el email o ejecuta sin --parent-email para auditar todos.');
  }
}

(async function main() {
  console.log('\n========================================================');
  console.log(' LIMPIEZA de documentos contaminados en ' + COLLECTION);
  console.log(' Proyecto credencial : ' + (serviceAccount.project_id || '(desconocido)'));
  console.log(' Modo                : ' + (APPLY ? '*** BORRADO REAL (--apply) ***' : 'AUDITORIA (solo lectura)'));
  console.log(' Filtro por padre    : ' + (PARENT_EMAIL || '(todos los padres contaminados)'));
  console.log('========================================================\n');

  let targetUid = null;
  if (PARENT_EMAIL) {
    targetUid = await resolveParentUid(PARENT_EMAIL);
    console.log('UID resuelto para ' + PARENT_EMAIL + ' : ' + targetUid + '\n');
  }

  // Recorremos toda la coleccion y detectamos contaminados en memoria.
  // (where(parentUid != null) no es fiable en Firestore para ausencia de campo,
  //  asi que filtramos en cliente; el read es seguro.)
  const snap = await db.collection(COLLECTION).get();

  let total = 0;
  let legitParent = 0;       // type==parent_player_report con parentUid (LEGITIMO, intacto)
  let noParentUid = 0;       // sin parentUid (intacto)
  const contaminated = [];   // {id, type, parentUid, playerNumber, matchId, matchDate, rival, createdAt}
  const byType = {};
  // PASO 2 + PASO 5: TODOS los docs con parentUid == targetUid (contaminados + legitimos),
  // para listar el detalle pedido y para contar los informes legitimos que QUEDAN.
  const targetAll = [];        // todos los docs con parentUid del padre objetivo
  const targetLegitMatches = new Set(); // matchId distintos de sus parent_player_report

  snap.forEach((d) => {
    total++;
    const data = d.data();
    const hasParent = isNonEmpty(data.parentUid);

    // PASO 2: recopilar TODOS los docs del padre objetivo (con o sin contaminacion)
    if (targetUid && data.parentUid === targetUid) {
      targetAll.push({
        id: d.id,
        type: data.type || '(sin type)',
        playerNumber: data.playerNumber || '',
        matchId: data.matchId || '',
        createdAt: data.createdAt || '',
      });
      if (data.type === SAFE_TYPE) {
        targetLegitMatches.add(data.matchId || ('id:' + d.id));
      }
    }

    if (!hasParent) { noParentUid++; return; }

    if (data.type === SAFE_TYPE) { legitParent++; return; }

    // A partir de aqui: tiene parentUid PERO no es parent_player_report -> CONTAMINADO
    // Si hay filtro por padre, solo contamos los de ese parentUid.
    if (targetUid && data.parentUid !== targetUid) return;

    byType[data.type || '(sin type)'] = (byType[data.type || '(sin type)'] || 0) + 1;
    contaminated.push({
      id: d.id,
      type: data.type || '(sin type)',
      parentUid: data.parentUid,
      playerNumber: data.playerNumber || '',
      matchId: data.matchId || '',
      matchDate: data.matchDate || '',
      rival: data.rival || '',
      createdAt: data.createdAt || '',
    });
  });

  // PASO 2: listado detallado de TODOS los documentos del padre objetivo.
  if (targetUid) {
    console.log('--- PASO 2: documentos en ' + COLLECTION + ' con parentUid == ' + targetUid +
                ' (' + targetAll.length + ') ---');
    console.table(targetAll.slice(0, 100).map((c) => ({
      id: c.id, type: c.type, dorsal: c.playerNumber, matchId: c.matchId, createdAt: c.createdAt,
    })));
    if (targetAll.length > 100) console.log('  (mostrados 100 de ' + targetAll.length + ')');
    console.log('');
  }

  console.log('--- RESUMEN ------------------------------------------');
  console.log(' Documentos totales en ' + COLLECTION + '        : ' + total);
  console.log(' Legitimos parent_player_report (intactos)      : ' + legitParent);
  console.log(' Sin parentUid (intactos)                       : ' + noParentUid);
  console.log(' CONTAMINADOS (parentUid + type != parent)      : ' + contaminated.length +
              (targetUid ? '  [acotado a ' + PARENT_EMAIL + ']' : ''));
  console.log('------------------------------------------------------');
  if (contaminated.length) {
    console.log(' Desglose por type:');
    Object.keys(byType).sort().forEach((t) => {
      console.log('   ' + t + ' : ' + byType[t]);
    });
    console.log('------------------------------------------------------\n');

    const preview = contaminated.slice(0, 50).map((c) => ({
      id: c.id, type: c.type, dorsal: c.playerNumber,
      matchDate: c.matchDate, rival: c.rival,
    }));
    console.log('Documentos a borrar (max 50 mostrados de ' + contaminated.length + '):');
    console.table(preview);
    console.log('');
  } else {
    console.log('\n[CLEANUP][OK] No hay documentos contaminados que coincidan. Nada que borrar.\n');
    await admin.app().delete();
    process.exit(0);
  }

  if (!APPLY) {
    if (targetUid) {
      console.log('[CLEANUP][DRY-RUN][PASO 5 previsto] Tras borrar, este padre quedaria con ~' +
                  targetLegitMatches.size + ' informe(s) parent_player_report (1 por partido jugado).');
    }
    console.log('[CLEANUP][DRY-RUN] Modo auditoria: NO se ha borrado nada.');
    console.log('  Para BORRAR estos ' + contaminated.length + ' documentos, repite el comando con --apply:');
    console.log('    node scripts/cleanup-contaminated-reports.js' +
                (PARENT_EMAIL ? ' --parent-email ' + PARENT_EMAIL : '') + ' --apply\n');
    await admin.app().delete();
    process.exit(0);
  }

  // ─── BORRADO REAL ──────────────────────────────────────────────────────
  console.log('[CLEANUP][APPLY] Borrando ' + contaminated.length + ' documentos contaminados...');
  let deleted = 0;
  const CHUNK = 400; // limite de batch de Firestore es 500; margen de seguridad
  for (let i = 0; i < contaminated.length; i += CHUNK) {
    const batch = db.batch();
    const slice = contaminated.slice(i, i + CHUNK);
    slice.forEach((c) => batch.delete(db.collection(COLLECTION).doc(c.id)));
    await batch.commit();
    deleted += slice.length;
    console.log('  Lote borrado: ' + deleted + '/' + contaminated.length);
  }

  console.log('\n[CLEANUP][DONE] ' + deleted + ' documentos contaminados borrados.');
  console.log('  Informes legitimos (parent_player_report) intactos: ' + legitParent + '\n');

  // ─── PASO 5: confirmar resultado tras la limpieza (re-lectura real) ──────
  if (targetUid) {
    const after = await db.collection(COLLECTION).where('parentUid', '==', targetUid).get();
    let afterParent = 0, afterOther = 0;
    const afterMatches = new Set();
    after.forEach((d) => {
      const data = d.data();
      if (data.type === SAFE_TYPE) { afterParent++; afterMatches.add(data.matchId || ('id:' + d.id)); }
      else afterOther++;
    });
    console.log('--- PASO 5: confirmacion tras limpieza (parentUid == ' + targetUid + ') ---');
    console.log('  Documentos restantes con su parentUid     : ' + after.size);
    console.log('  - parent_player_report (correctos)        : ' + afterParent);
    console.log('  - otros tipos (deberia ser 0)             : ' + afterOther);
    console.log('  Partidos distintos del hijo (matchId)     : ' + afterMatches.size);
    if (afterOther === 0) {
      console.log('  [OK] No queda ningun contaminado para este padre.');
      console.log('       El panel debe mostrar ~' + afterMatches.size + ' informes (1 por partido), no 40.\n');
    } else {
      console.log('  [AVISO] Aun quedan ' + afterOther + ' docs no-parent con su parentUid. Revisar.\n');
    }
  }

  await admin.app().delete();
  process.exit(0);
})().catch((e) => {
  fail('Fallo durante la limpieza: ' + (e && e.message ? e.message : e));
});

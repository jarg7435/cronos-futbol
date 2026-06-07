/**
 * backfill-link-category.js  —  rellena `category` en cronos_player_links
 *
 * FASE 4: el Panel del Entrenador filtra los contactos de padres por la
 * categoria del entrenador (me.category). Para que ese filtro funcione con
 * los vinculos YA existentes (creados antes de la Fase 4), este script
 * deriva la categoria de cada documento de `cronos_player_links` que aun no
 * la tenga y, si se ejecuta en modo escritura, la guarda.
 *
 * Origen de la categoria (en orden de preferencia):
 *   1. El doc del padre vinculado (users/{parentUid}):
 *        data.category | data.categoryLabel
 *        o allRoles[].category del rol parent/parent_individual
 *   2. El campo `teamName` del propio link (a veces guarda la categoria).
 *
 * MODOS:
 *   - DRY-RUN (por defecto): SOLO lee. Lista cuantos links se actualizarian
 *     y con que valor. No escribe nada.
 *   - WRITE: añade `node scripts/backfill-link-category.js --write` para
 *     persistir los cambios (solo escribe `category` en links sin categoria).
 *
 * USO (desde la raiz del proyecto):
 *   1. npm install firebase-admin   (si no esta)
 *   2. Coloca la credencial como sa-key.json en la raiz (o SA_KEY_PATH=/ruta).
 *   3. node scripts/backfill-link-category.js            (simulacion)
 *      node scripts/backfill-link-category.js --write    (aplica cambios)
 */

'use strict';

const path = require('path');
const fs = require('fs');

const WRITE = process.argv.includes('--write');
// Credencial: SA_KEY_PATH si se define; si no, se busca sa-key.json y, como
// fallback, sa_key.txt (nombre usado en este repo, ya en .gitignore).
function resolveKeyPath() {
  if (process.env.SA_KEY_PATH) return path.resolve(process.env.SA_KEY_PATH.trim());
  const candidates = ['sa-key.json', 'sa_key.json', 'sa-key.txt', 'sa_key.txt'];
  for (const c of candidates) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(process.cwd(), 'sa-key.json');
}
const KEY_PATH = resolveKeyPath();

function fail(msg) {
  console.error('\n[BACKFILL][ERROR] ' + msg + '\n');
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

// Cargar la credencial leyendo el fichero (soporta .json y .txt con JSON).
let serviceAccount;
try {
  serviceAccount = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
} catch (e) {
  fail('No se pudo leer/parsear la credencial en ' + KEY_PATH + ': ' + e.message);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const meaningful = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// Cache de docs de usuario para no leer el mismo parentUid varias veces.
const userCache = new Map();
async function getUser(uid) {
  if (!uid) return null;
  if (userCache.has(uid)) return userCache.get(uid);
  let data = null;
  try {
    const snap = await db.collection('users').doc(uid).get();
    data = snap.exists ? snap.data() : null;
  } catch (_) { data = null; }
  userCache.set(uid, data);
  return data;
}

function categoryFromUser(u) {
  if (!u) return '';
  if (meaningful(u.category)) return String(u.category).trim();
  if (meaningful(u.categoryLabel)) return String(u.categoryLabel).trim();
  if (Array.isArray(u.allRoles)) {
    const r = u.allRoles.find(x => x && (x.role === 'parent' || x.role === 'parent_individual'));
    if (r) {
      if (meaningful(r.category)) return String(r.category).trim();
      if (meaningful(r.categoryLabel)) return String(r.categoryLabel).trim();
    }
  }
  return '';
}

(async function main() {
  console.log('\n========================================================');
  console.log(' BACKFILL category en cronos_player_links (Fase 4)');
  console.log(' Proyecto credencial : ' + (serviceAccount.project_id || '(desconocido)'));
  console.log(' Modo                : ' + (WRITE ? 'ESCRITURA (--write)' : 'DRY-RUN (solo lectura)'));
  console.log('========================================================\n');

  let total = 0, alreadyHas = 0, resolved = 0, unresolved = 0, written = 0;
  const plan = [];

  const snap = await db.collection('cronos_player_links').get();

  for (const docSnap of snap.docs) {
    total++;
    const data = docSnap.data();

    if (meaningful(data.category)) { alreadyHas++; continue; }

    let cat = '';
    const u = await getUser(data.parentUid);
    cat = categoryFromUser(u);
    if (!cat && meaningful(data.teamName)) cat = String(data.teamName).trim();

    if (!cat) { unresolved++; continue; }

    resolved++;
    plan.push({ id: docSnap.id, player: data.playerAlias || data.playerName || '', category: cat });

    if (WRITE) {
      try {
        await docSnap.ref.update({ category: cat });
        written++;
      } catch (e) {
        console.error('  [WRITE-ERR] ' + docSnap.id + ': ' + e.message);
      }
    }
  }

  console.log('Links totales              : ' + total);
  console.log('Ya tenian category         : ' + alreadyHas);
  console.log('Resueltos (se rellenarian) : ' + resolved);
  console.log('Sin categoria derivable    : ' + unresolved);
  if (WRITE) console.log('Escritos correctamente     : ' + written);

  if (plan.length) {
    console.log('\nDetalle (hasta 30):');
    plan.slice(0, 30).forEach(p =>
      console.log(`  ${p.id}  ->  category="${p.category}"  (${p.player})`));
  }

  if (!WRITE && resolved > 0) {
    console.log('\n[DRY-RUN] No se escribio nada. Repite con --write para aplicar.');
  }

  console.log('');
  process.exit(0);
})().catch(e => fail(e.stack || e.message));

// ─────────────────────────────────────────────────────────────────────────
// verify_sec_c2_prod.js  ·  SEC-C2: verificación FINAL en PRODUCCIÓN
//
// Confirma que la regla `allow delete` de match /live_matches/{matchId}
// DESPLEGADA en el proyecto real (cronos-futbol-app) NO contiene ya la rama
// standalone `resource.data.clubId == null` (que permitía a cualquier
// autenticado borrar un partido en vivo huerfano con PII de menores), y que
// la fuente desplegada coincide byte a byte (normalizada) con el
// firestore.rules local. Descarga el ruleset ACTIVO vía la Firebase Security
// Rules REST API usando el token del CLI ya autenticado (no imprime credenciales).
//
// Uso:  node scripts/verify_sec_c2_prod.js
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const PROJECT = 'cronos-futbol-app';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Authorization: 'Bearer ' + token } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('parse: ' + d.slice(0, 300))); }
        } else reject(new Error('HTTP ' + res.statusCode + ': ' + d.slice(0, 300)));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function getAccessToken(refreshToken) {
  const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
  }).toString();
  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 300))); }
        catch (e) { reject(new Error('parse token: ' + d.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('── SEC-C2 · verificación en PRODUCCIÓN (' + PROJECT + ') ──\n');

  // 0. Token del CLI ya autenticado.
  let token;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const rt = cfg.tokens && cfg.tokens.refresh_token;
    ok('0 · CLI autenticado (refresh_token presente)', !!rt, 'ejecuta: firebase login');
    if (!rt) { console.log('\nNo hay sesión; abortando.'); process.exit(1); }
    token = await getAccessToken(rt);
    ok('0 · access_token obtenido', !!token);
  } catch (e) {
    console.log('FAIL 0 · no se pudo leer/renovar token: ' + e.message);
    process.exit(1);
  }

  // 1. Nombre del ruleset ACTIVO.
  let releaseName;
  try {
    const rel = await getJson(
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`, token);
    releaseName = rel.rulesetName;
    ok('1 · release cloud.firestore tiene ruleset activo', !!releaseName, JSON.stringify(rel).slice(0, 200));
    console.log('       ruleset: ' + releaseName + '  (updateTime: ' + (rel.updateTime || '?') + ')');
  } catch (e) {
    console.log('FAIL 1 · no se pudo leer el release: ' + e.message);
    process.exit(1);
  }

  // 2. Fuente del ruleset desplegado.
  let deployed;
  try {
    const rs = await getJson(`https://firebaserules.googleapis.com/v1/${releaseName}`, token);
    const files = (rs.source && rs.source.files) || [];
    deployed = files.map((f) => f.content).join('\n');
    ok('2 · fuente del ruleset descargada', deployed.length > 0, 'files: ' + files.length);
    console.log('       tamaño: ' + deployed.length + ' bytes, archivos: ' + files.map((f) => f.name).join(', '));
  } catch (e) {
    console.log('FAIL 2 · no se pudo descargar la fuente: ' + e.message);
    process.exit(1);
  }

  // 3. Extraer el bloque live_matches y su allow delete del ruleset DESPLEGADO.
  const lmStart = deployed.indexOf('match /live_matches/{matchId}');
  ok('3a · el ruleset desplegado tiene match /live_matches/{matchId}', lmStart !== -1);
  const lmEnd = deployed.indexOf('match /', lmStart + 1);
  const lmBlock = deployed.slice(lmStart, lmEnd === -1 ? undefined : lmEnd);
  const delIdx = lmBlock.indexOf('allow delete:');
  const allowDelete = lmBlock.slice(delIdx, lmBlock.indexOf(');', delIdx) + 2);

  // 3b. [PROD] la rama standalone `clubId == null ||` YA NO está en allow delete.
  ok('3b · [PROD] sin rama standalone `resource.data.clubId == null ||` en allow delete',
     !/resource\.data\.clubId\s*==\s*null\s*\|\|/.test(allowDelete),
     allowDelete.replace(/\s+/g, ' '));

  // 3c. [PROD] las ramas legítimas siguen presentes.
  ok('3c · [PROD] allow delete conserva createdBy == uid',
     /resource\.data\.createdBy\s*==\s*request\.auth\.uid/.test(allowDelete));
  ok('3d · [PROD] allow delete conserva coachEmail == token.email',
     /resource\.data\.coachEmail\s*==\s*request\.auth\.token\.email/.test(allowDelete));
  ok('3e · [PROD] allow delete conserva sameClub/userDocClubId',
     /sameClub\(resource\.data\.clubId\)/.test(allowDelete) &&
     /userDocClubId\(resource\.data\.clubId\)/.test(allowDelete));

  // 4. Coincidencia con el firestore.rules local (no hay cambios sin desplegar).
  const local = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const norm = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  ok('4a · [PROD == LOCAL] la fuente desplegada coincide con firestore.rules local',
     norm(deployed) === norm(local),
     'difieren: revisa si hay cambios locales sin desplegar (firebase deploy --only firestore:rules)');

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass} passed) · SEC-C2 cerrado en producción`);
  process.exit(fail ? 1 : 0);
})();

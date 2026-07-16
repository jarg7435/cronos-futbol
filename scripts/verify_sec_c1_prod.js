// ─────────────────────────────────────────────────────────────────────────
// verify_sec_c1_prod.js  ·  SEC-C1: verificación FINAL en PRODUCCIÓN
//
// Confirma que la regla `allow update` de users/{userId} DESPLEGADA en el
// proyecto real (cronos-futbol-app) contiene el cierre de SEC-C1: 'clubId'
// en la lista PROHIBIDA de hasAny(). Descarga el ruleset ACTIVO vía la
// Firebase Security Rules REST API usando el token del CLI ya autenticado
// (no imprime credenciales) y lo compara con el firestore.rules local.
//
// Uso:  node scripts/verify_sec_c1_prod.js
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

// Intercambia el refresh_token del CLI por un access_token (OAuth Google).
function getAccessToken(refreshToken) {
  // client_id/secret públicos del CLI de Firebase (los usa firebase-tools).
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
  console.log('── SEC-C1 · verificación en PRODUCCIÓN (' + PROJECT + ') ──\n');

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

  // 3. Extraer el bloque users/{userId} y su allow update del ruleset DESPLEGADO.
  const start = deployed.indexOf('match /users/{userId}');
  const block = deployed.slice(start, deployed.indexOf('allow delete: if isSuperAdmin();', start));
  const allowUpdate = block.slice(block.indexOf('allow update:'));

  ok('3a · el ruleset desplegado tiene match /users/{userId}', start !== -1);
  ok('3b · [PROD] clubId está en la lista PROHIBIDA de hasAny()',
     /hasAny\(\[[^\]]*'clubId'[^\]]*\]\)/.test(allowUpdate),
     (allowUpdate.match(/hasAny\([^)]*\)/) || ['(no encontrado)'])[0]);
  ok('3c · [PROD] no queda la rama v182 hasOnly([\'clubId\'])',
     !allowUpdate.includes("hasOnly(['clubId'])"));
  ok('3d · [PROD] no queda la rama hasOnly([\'clubId\', \'allRoles\'])',
     !allowUpdate.includes("hasOnly(['clubId', 'allRoles'])"));

  // 4. Coincidencia con el firestore.rules local (lo que se va a/desde deploy).
  const local = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const norm = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  ok('4a · [PROD == LOCAL] la fuente desplegada coincide con firestore.rules local',
     norm(deployed) === norm(local),
     'difieren: revisa si hay cambios locales sin desplegar (firebase deploy --only firestore:rules)');

  // 5. Estado del create (documentado como pendiente): informar, no fallar.
  const createBlock = block.slice(block.indexOf('allow create:'), block.indexOf('allow update:'));
  const createHardened = /clubId'?\s*(in|==)/.test(createBlock) &&
                         (createBlock.includes("'clubId' in request.resource.data") ||
                          createBlock.includes('request.resource.data.clubId == null'));
  console.log('\n── Estado del vector CREATE (documentado como pendiente) ──');
  console.log('  [PROD] create endurecido (bloquea clubId en el alta): ' + (createHardened ? 'SÍ' : 'NO (pendiente, según CORRECCIONES_ESTADO.md)'));

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass} passed) · UPDATE cerrado en producción`);
  process.exit(fail ? 1 : 0);
})();

// ════════════════════════════════════════════════════════════════════════
//  LIMPIAR LAS PLAZAS REVOCADAS de un documento de usuario (PRODUCCIÓN)
// ════════════════════════════════════════════════════════════════════════
//  Uso:
//    node scripts/ops/limpia_plazas_revocadas.js <email>            (SIMULACRO)
//    node scripts/ops/limpia_plazas_revocadas.js <email> --apply    (ESCRIBE)
//
//  Quita de `allRoles` las entradas con `status: 'removed'` o `'rejected'`.
//  NO toca ninguna otra cosa del documento: el PATCH lleva
//  `updateMask.fieldPaths=allRoles`, así que el resto de campos ni se envía.
//
//  ⚠️ SIEMPRE deja copia ANTES de escribir, en
//     scripts/ops/backup_users_<uid>_<ts>.json (el documento ENTERO, crudo).
//  ⚠️ Se conservan los VALORES REST originales de las entradas que se quedan
//     (no se reconstruyen desde JS): así ningún tipo —marcas de tiempo,
//     booleanos, números— puede cambiar de forma por el camino.
//  ⚠️ Las plazas revocadas NO ocupan cuota (cronosPlazasOcupadas las ignora):
//     esto es higiene, no libera nada. Y desde v680 tampoco pueden decidir el
//     equipo con el que se arranca.
// ════════════════════════════════════════════════════════════════════════
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const PROJECT = 'cronos-futbol-app';
const EMAIL   = process.argv[2];
const APPLY   = process.argv.includes('--apply');
if (!EMAIL) { console.error('Falta el correo. Uso: node scripts/ops/limpia_plazas_revocadas.js <email> [--apply]'); process.exit(1); }

const MUERTAS = new Set(['removed', 'rejected']);

const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
let refreshToken;
try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    refreshToken = config.tokens?.refresh_token || config.user?.tokens?.refresh_token;
    if (!refreshToken) throw new Error('No refresh_token (¿has entrado con `firebase login`?)');
} catch (e) { console.error('Error leyendo credenciales:', e.message); process.exit(1); }

function httpRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function getAccessToken() {
    const body = new URLSearchParams({
        client_id:     '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
        refresh_token: refreshToken,
        grant_type:    'refresh_token'
    }).toString();
    const res = await httpRequest({
        hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, body);
    const parsed = JSON.parse(res.body);
    if (!parsed.access_token) throw new Error('No access token: ' + res.body);
    return parsed.access_token;
}

async function buscarPorEmail(token, email) {
    const body = JSON.stringify({
        structuredQuery: {
            from: [{ collectionId: 'users' }],
            where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
            limit: 10
        }
    });
    const res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, body);
    return JSON.parse(res.body).filter(r => r.document).map(r => r.document);
}

const s = (m, k) => (m.fields && m.fields[k] && m.fields[k].stringValue) || '';
const b = (m, k) => (m.fields && m.fields[k] && m.fields[k].booleanValue);
const rotulo = (v, i) => {
    const m = v.mapValue || {};
    return '  [' + i + '] rol=' + s(m, 'role') +
           '  cat=' + (s(m, 'category') || 'null') + '/' + (s(m, 'subcategory') || 'null') +
           '  status=' + (s(m, 'status') || '-') + '  isAuthorized=' + b(m, 'isAuthorized');
};

(async () => {
    const token = await getAccessToken();
    const docs  = await buscarPorEmail(token, EMAIL);
    if (!docs.length) { console.log('SIN DOCUMENTO para ' + EMAIL); return; }
    if (docs.length > 1) { console.log('⛔ ' + docs.length + ' documentos con ese correo: se para. Revisar a mano.'); return; }

    const doc = docs[0];
    const uid = doc.name.split('/').pop();
    const valores = (doc.fields?.allRoles?.arrayValue?.values) || [];

    const seQuedan = valores.filter(v => !MUERTAS.has(s(v.mapValue || {}, 'status')));
    const seVan    = valores.filter(v =>  MUERTAS.has(s(v.mapValue || {}, 'status')));

    console.log('UID: ' + uid + '   (' + EMAIL + ')');
    console.log('\nSE QUEDAN (' + seQuedan.length + '):');
    seQuedan.forEach((v, i) => console.log(rotulo(v, i)));
    console.log('\nSE BORRAN (' + seVan.length + '):');
    seVan.forEach((v, i) => console.log(rotulo(v, i)));

    if (!seVan.length) { console.log('\nNada que limpiar.'); return; }
    if (!APPLY) { console.log('\n🔎 SIMULACRO: no se ha escrito nada. Repite con --apply para aplicarlo.'); return; }

    // ── Copia de seguridad del documento ENTERO, antes de escribir ──
    const destino = path.join(__dirname, 'backup_users_' + uid + '_' + Date.now() + '.json');
    fs.writeFileSync(destino, JSON.stringify(doc, null, 2), 'utf8');
    console.log('\n💾 Copia guardada en ' + path.relative(path.join(__dirname, '..', '..'), destino));

    const cuerpo = JSON.stringify({ fields: { allRoles: { arrayValue: { values: seQuedan } } } });
    const res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=allRoles`,
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) }
    }, cuerpo);
    if (res.status !== 200) { console.error('⛔ El PATCH falló (' + res.status + '): ' + res.body); process.exit(1); }

    // ── Verificación por LECTURA, no por el código de respuesta ──
    const despues = (await buscarPorEmail(token, EMAIL))[0];
    const quedan  = (despues.fields?.allRoles?.arrayValue?.values) || [];
    console.log('\n── RELEÍDO DE PRODUCCIÓN: ' + quedan.length + ' entradas ──');
    quedan.forEach((v, i) => console.log(rotulo(v, i)));
    const sobran = quedan.filter(v => MUERTAS.has(s(v.mapValue || {}, 'status'))).length;
    console.log('\n' + (quedan.length === seQuedan.length && sobran === 0
        ? '✅ LIMPIO: ninguna plaza revocada, y las vivas siguen todas.'
        : '❌ No cuadra: revisar con la copia de seguridad.'));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

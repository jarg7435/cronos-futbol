// ════════════════════════════════════════════════════════════════════════
//  v688 · REPARAR la cuenta del administrador del ente que quedó FUERA
//         (PRODUCCIÓN, a petición del autor el 2026-09-10)
// ════════════════════════════════════════════════════════════════════════
//  Uso:
//    node scripts/ops/repara_cuenta_admin_ente_v688.js <email> <categoria> <sub>           (SIMULACRO)
//    node scripts/ops/repara_cuenta_admin_ente_v688.js <email> <categoria> <sub> --apply   (ESCRIBE)
//
//  Estado medido (inspect_roles_por_email.js): RAÍZ role=parent,
//  status=rejected, isAuthorized=false — con sus dos equipos de administrador
//  vivos. Lo dejaron así las escrituras en la raíz que corrige la v688.
//
//  Lo que escribe:
//   · RAÍZ → role='individual', status='active', isAuthorized=true
//   · la plaza de FAMILIAR de su ente → category/subcategory/categoryLabel
//   · quita las plazas 'individual' SIN categoría (sedimento, como en v686)
//
//  🔒 Salvaguardas: un solo documento con ese correo; exactamente UNA plaza
//  de familiar en su ente; al menos un equipo de administrador vivo que se
//  queda; copia ENTERA antes de escribir; `updateMask` con sólo los 4 campos;
//  las entradas que se quedan conservan sus valores REST originales; lectura
//  por Buffer (un `d += chunk` parte las tildes y las REESCRIBIRÍA rotas); y
//  verificación RELEYENDO de producción.
// ════════════════════════════════════════════════════════════════════════
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const PROJECT = 'cronos-futbol-app';
const [EMAIL, CAT, SUB] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
if (!EMAIL || !CAT || !SUB || SUB.startsWith('--')) {
    console.error('Uso: node scripts/ops/repara_cuenta_admin_ente_v688.js <email> <categoria> <sub> [--apply]');
    process.exit(1);
}
const ETIQ = { prebenjamin: 'Prebenjamín', benjamin: 'Benjamín', alevin: 'Alevín', infantil: 'Infantil',
               cadete: 'Cadete', juvenil: 'Juvenil', regional: 'Regional', regional_fem: 'Regional FEM', futurefem: 'FUTureFEM' };
const cat = CAT.toLowerCase(), sub = SUB.toUpperCase();
if (!ETIQ[cat] || !/^[ABC]$/.test(sub)) { console.error('Categoría o grupo no válidos: ' + CAT + ' ' + SUB); process.exit(1); }
const etiqueta = ETIQ[cat] + ' ' + sub;

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const refreshToken = cfg.tokens?.refresh_token || cfg.user?.tokens?.refresh_token;

function httpRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            const ch = [];
            res.on('data', c => ch.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch).toString('utf8') }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}
async function getAccessToken() {
    const body = new URLSearchParams({ client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', refresh_token: refreshToken, grant_type: 'refresh_token' }).toString();
    const res = await httpRequest({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, body);
    const p = JSON.parse(res.body);
    if (!p.access_token) throw new Error('No access token');
    return p.access_token;
}
async function buscarPorEmail(token, email) {
    const body = JSON.stringify({ structuredQuery: { from: [{ collectionId: 'users' }],
        where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } }, limit: 10 } });
    const res = await httpRequest({ hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`, method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
    return JSON.parse(res.body).filter(r => r.document).map(r => r.document);
}

const s = (m, k) => (m.fields && m.fields[k] && m.fields[k].stringValue) || '';
const bo = (m, k) => (m.fields && m.fields[k] && m.fields[k].booleanValue);
const ancla = (m) => s(m, 'clubId') || s(m, 'individualEntityId') || s(m, 'individualOwnerId') || '';
const rotulo = (v, i) => { const m = v.mapValue || {};
    return '  [' + i + '] rol=' + (s(m, 'role') || '-') + '  cat=' + (s(m, 'category') || 'null') + '/' + (s(m, 'subcategory') || 'null') +
           '  club=' + (ancla(m) || 'null') + '  status=' + (s(m, 'status') || '-') + '  isAuthorized=' + bo(m, 'isAuthorized'); };
const raizTxt = (d) => 'RAÍZ role=' + s(d, 'role') + '  status=' + s(d, 'status') + '  isAuthorized=' + bo(d, 'isAuthorized');

(async () => {
    const token = await getAccessToken();
    const docs = await buscarPorEmail(token, EMAIL);
    if (docs.length !== 1) { console.log('⛔ ' + docs.length + ' documentos con ese correo: se para.'); return; }
    const doc = docs[0];
    const uid = doc.name.split('/').pop();
    const ente = s(doc, 'individualEntityId') || s(doc, 'clubId');
    const valores = (doc.fields?.allRoles?.arrayValue?.values) || [];
    console.log('UID ' + uid + '   ente ' + (ente || '-'));
    console.log('ANTES  ' + raizTxt(doc));
    valores.forEach((v, i) => console.log(rotulo(v, i)));

    if (!ente) { console.log('⛔ Sin ente en la raíz: se para.'); return; }
    if (['parent', 'individual'].indexOf(s(doc, 'role')) < 0) { console.log('⛔ Rol de raíz inesperado: se para.'); return; }

    const esFamiliar = (v) => { const m = v.mapValue || {}; return s(m, 'role') === 'parent' && ancla(m) === ente &&
                                                                   s(m, 'status') !== 'removed' && s(m, 'status') !== 'rejected'; };
    const esResto = (v) => { const m = v.mapValue || {}; return ['individual', 'admin_individual'].indexOf(s(m, 'role')) >= 0 &&
                                                               !s(m, 'category') && !s(m, 'categoryLabel'); };
    const esEquipoAdmin = (v) => { const m = v.mapValue || {}; return ['individual', 'admin_individual'].indexOf(s(m, 'role')) >= 0 &&
        !!s(m, 'category') && ancla(m) === ente && s(m, 'status') === 'active' && bo(m, 'isAuthorized') === true; };

    const familiares = valores.filter(esFamiliar);
    if (familiares.length !== 1) { console.log('⛔ Hay ' + familiares.length + ' plazas de familiar en su ente (se esperaba 1): se para.'); return; }
    const equipos = valores.filter(esEquipoAdmin);
    if (!equipos.length) { console.log('⛔ No tiene ningún equipo de administrador vivo: se para.'); return; }

    const nuevos = [];
    valores.forEach(v => {
        if (esResto(v)) return;
        if (esFamiliar(v)) {
            const f = Object.assign({}, v.mapValue.fields, {
                category:      { stringValue: cat },
                subcategory:   { stringValue: sub },
                categoryLabel: { stringValue: etiqueta },
            });
            nuevos.push({ mapValue: { fields: f } });
            return;
        }
        nuevos.push(v);   // valor REST original, intacto
    });

    console.log('\nDESPUÉS  RAÍZ role=individual  status=active  isAuthorized=true');
    nuevos.forEach((v, i) => console.log(rotulo(v, i)));
    console.log('  (familiar → ' + etiqueta + '; se quitan ' + valores.filter(esResto).length + ' restos sin categoría)');

    if (!APPLY) { console.log('\n🔎 SIMULACRO: no se ha escrito nada. Repite con --apply.'); return; }

    const destino = path.join(__dirname, 'backup_users_' + uid + '_' + Date.now() + '.json');
    fs.writeFileSync(destino, JSON.stringify(doc, null, 2), 'utf8');
    console.log('\n💾 Copia en ' + path.relative(path.join(__dirname, '..', '..'), destino));

    const cuerpo = JSON.stringify({ fields: {
        role: { stringValue: 'individual' }, status: { stringValue: 'active' },
        isAuthorized: { booleanValue: true }, allRoles: { arrayValue: { values: nuevos } } } });
    const mask = ['role', 'status', 'isAuthorized', 'allRoles'].map(f => 'updateMask.fieldPaths=' + f).join('&');
    const res = await httpRequest({ hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}?${mask}`, method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) } }, cuerpo);
    if (res.status !== 200) { console.error('⛔ El PATCH falló (' + res.status + '): ' + res.body.slice(0, 300)); process.exit(1); }

    const d2 = (await buscarPorEmail(token, EMAIL))[0];
    const v2 = (d2.fields?.allRoles?.arrayValue?.values) || [];
    console.log('\n── RELEÍDO DE PRODUCCIÓN ──\n' + raizTxt(d2));
    v2.forEach((v, i) => console.log(rotulo(v, i)));
    const fam = v2.filter(esFamiliar)[0];
    const okRaiz = s(d2, 'role') === 'individual' && s(d2, 'status') === 'active' && bo(d2, 'isAuthorized') === true;
    const okFam = fam && s(fam.mapValue, 'category') === cat && s(fam.mapValue, 'subcategory') === sub;
    const okEq = v2.filter(esEquipoAdmin).length === equipos.length;
    const okResto = v2.filter(esResto).length === 0;
    console.log('\n' + (okRaiz && okFam && okEq && okResto ? '✅ REPARADA' : '❌ No cuadra: revisar con la copia'),
                { okRaiz, okFam: !!okFam, okEq, okResto });
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

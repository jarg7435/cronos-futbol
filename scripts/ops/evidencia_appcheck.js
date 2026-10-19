// ═══════════════════════════════════════════════════════════════════════════
//  scripts/ops/evidencia_appcheck.js  ·  reauditoría del 19-10 (punto 3)
//
//  Uso:  node scripts/ops/evidencia_appcheck.js
//
//  EVIDENCIA, FECHADA Y REPRODUCIBLE, DE CÓMO ESTÁ APP CHECK EN FIREBASE REAL
//  (producción y testeo). El auditor no puede verlo desde el ZIP: «la
//  configuración es buena a nivel de código; falta verificar en Firebase real
//  que está en enforcement y que no quedan dominios de desarrollo ni tokens
//  de debug». Esto lo imprime:
//    1. modo de cada servicio (ENFORCED / UNENFORCED);
//    2. tokens de depuración dados de alta (sólo su NOMBRE, nunca el secreto);
//    3. configuración reCAPTCHA v3 (umbral, TTL);
//    4. dominios autorizados de Firebase Auth;
//    5. métricas de los últimos 7 días (VALID / MISSING / INVALID, ALLOW/DENY);
//    6. una sonda anónima SIN token de App Check, que tiene que dar 403.
//
//  🔒 SÓLO GET. No escribe nada en ningún proyecto (la sonda es una lectura
//  que se rechaza). Credenciales: la sesión de `firebase login` del
//  propietario, como scripts/lee_reglas_vivas.js.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const PROYECTOS = ['cronos-futbol-app', 'cronos-futbol-test'];
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

function peticion(url, opts, cuerpo) {
    // Cerrojo: el único POST permitido es el canje del token OAuth.
    if ((opts.method || 'GET') !== 'GET' && url !== 'https://oauth2.googleapis.com/token') {
        throw new Error('evidencia_appcheck.js sólo hace GET: ' + url);
    }
    return new Promise((res, rej) => {
        const r = https.request(url, opts, (x) => {
            const b = []; x.on('data', (c) => b.push(c));
            x.on('end', () => {
                const t = Buffer.concat(b).toString('utf8');
                let j = null; try { j = JSON.parse(t); } catch (_) { /* no JSON */ }
                res({ s: x.statusCode, j, t });
            });
        });
        r.on('error', rej);
        if (cuerpo) r.write(cuerpo);
        r.end();
    });
}

async function token() {
    const rt = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token;
    const body = new URLSearchParams({ refresh_token: rt, grant_type: 'refresh_token',
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' }).toString();
    const r = await peticion('https://oauth2.googleapis.com/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, body);
    if (!r.j || !r.j.access_token) throw new Error('sin token: ¿`firebase login`?');
    return r.j.access_token;
}

const get = (url, tk, p) => peticion(url, { method: 'GET',
    headers: tk ? { Authorization: 'Bearer ' + tk, 'x-goog-user-project': p } : {} });

(async () => {
    const tk = await token();
    const fin = new Date();
    const ini = new Date(fin.getTime() - 7 * 864e5);
    console.log('Evidencia App Check · ' + fin.toISOString());

    for (const p of PROYECTOS) {
        console.log('\n═══ ' + p);
        const sv = await get(`https://firebaseappcheck.googleapis.com/v1/projects/${p}/services?pageSize=50`, tk, p);
        ((sv.j && sv.j.services) || []).forEach((s) =>
            console.log('  servicio  ' + s.name.split('/').pop().padEnd(34) + (s.enforcementMode || 'UNENFORCED')));

        const apps = await get(`https://firebase.googleapis.com/v1beta1/projects/${p}/webApps`, tk, p);
        for (const a of ((apps.j && apps.j.apps) || [])) {
            const dt = await get(`https://firebaseappcheck.googleapis.com/v1/projects/${p}/apps/${a.appId}/debugTokens`, tk, p);
            const nombres = ((dt.j && dt.j.debugTokens) || []).map((d) => d.displayName);
            console.log('  webApp    ' + a.appId);
            console.log('    tokens de depuración: ' + (nombres.length ? '⚠️ ' + nombres.join(', ') : 'ninguno ✓'));
            const rc = await get(`https://firebaseappcheck.googleapis.com/v1/projects/${p}/apps/${a.appId}/recaptchaV3Config`, tk, p);
            if (rc.j) console.log('    reCAPTCHA v3: secreto=' + !!rc.j.siteSecretSet + ' · umbral=' + rc.j.minValidScore + ' · TTL=' + rc.j.tokenTtl);
        }

        const ac = await get(`https://identitytoolkit.googleapis.com/admin/v2/projects/${p}/config`, tk, p);
        const dom = (ac.j && ac.j.authorizedDomains) || [];
        console.log('  Auth, dominios autorizados: ' + dom.join(', ') +
            (dom.includes('localhost') ? '   ⚠️ incluye localhost' : ''));

        const q = new URLSearchParams({
            filter: 'metric.type="firebaseappcheck.googleapis.com/services/verification_count"',
            'interval.startTime': ini.toISOString(), 'interval.endTime': fin.toISOString(),
            'aggregation.alignmentPeriod': '604800s', 'aggregation.perSeriesAligner': 'ALIGN_SUM',
            'aggregation.crossSeriesReducer': 'REDUCE_SUM' });
        ['metric.label.security', 'metric.label.result'].forEach((f) => q.append('aggregation.groupByFields', f));
        const m = await get(`https://monitoring.googleapis.com/v3/projects/${p}/timeSeries?${q}`, tk, p);
        console.log('  verificaciones ' + ini.toISOString().slice(0, 10) + ' → ' + fin.toISOString().slice(0, 10) + ':');
        for (const s of ((m.j && m.j.timeSeries) || [])) {
            const n = (s.points || []).reduce((a, pt) => a + Number(pt.value.int64Value || 0), 0);
            console.log('    ' + (s.metric.labels.security || '').padEnd(26) + (s.metric.labels.result || '').padEnd(6) + n);
        }

        const sonda = await get(`https://firestore.googleapis.com/v1/projects/${p}/databases/(default)/documents/clubs_public?pageSize=1`, null, p);
        console.log('  sonda anónima sin App Check: HTTP ' + sonda.s + ' ' +
            ((sonda.j && sonda.j.error && sonda.j.error.status) || '') + (sonda.s === 403 ? '  ✓ rechazada' : '  ⚠️ NO rechazada'));
    }
})().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });

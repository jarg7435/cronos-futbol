// ═══════════════════════════════════════════════════════════════════════════
//  scripts/ops/alertas_crea.js
//  CREA (O COMPRUEBA) LAS ALERTAS AUTOMÁTICAS A1-A5 EN CLOUD MONITORING
//
//  Uso:
//    node scripts/ops/alertas_crea.js <proyecto> <host>            ← en seco: sólo enseña
//    node scripts/ops/alertas_crea.js <proyecto> <host> --crear    ← crea lo que falte
//  Producción:
//    node scripts/ops/alertas_crea.js cronos-futbol-app cronos-futbol-app.web.app
//
//  Idempotente: lo que ya existe (mismo nombre «Chronos · …», mismo host, misma
//  métrica, mismo correo) se salta. Usa la sesión del CLI de Firebase, como el resto
//  de scripts de ops; no lleva secretos. Documentación: RECUPERACION.md, Parte 6.
//
//  🚨 Trampas medidas el 2026-11-22 al montarlas:
//   · `result` en la métrica de App Check vale ALLOW / DENY (no VALID). Con
//     `result!="VALID"` se cuentan también las permitidas y A4 avisaría cada hora.
//   · Una alerta sobre una métrica de logs exige `resource.type` en el filtro.
//   · Una métrica de logs recién creada tarda hasta 10 min en poder usarse en una
//     alerta: la API responde 404. Basta con volver a lanzar el script.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [P, HOST] = process.argv.slice(2);
const CREAR = process.argv.includes('--crear');
const CORREO = 'jarg7435@gmail.com';
if (!P || !HOST || P.startsWith('--')) {
    console.error('uso: node scripts/ops/alertas_crea.js <proyecto> <host> [--crear]');
    process.exit(2);
}
const M = 'monitoring.googleapis.com';
const L = 'logging.googleapis.com';
const FUNC = '(resource.type="cloud_run_revision" OR resource.type="cloud_function")';
const doc = (t) => ({ content: t, mimeType: 'text/markdown' });

// ── Sesión del CLI ───────────────────────────────────────────────────────
const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const refreshToken = (cfg.tokens && cfg.tokens.refresh_token) || (cfg.user && cfg.user.tokens && cfg.user.tokens.refresh_token);
if (!refreshToken) { console.error('Sin sesión del CLI: `firebase login`.'); process.exit(1); }

function req(o, b) {
    return new Promise((s, j) => {
        const r = https.request(o, (x) => { let d = ''; x.on('data', (c) => { d += c; }); x.on('end', () => s({ st: x.statusCode, d })); });
        r.on('error', j); if (b) r.write(b); r.end();
    });
}
let _tk;
async function token() {
    if (_tk) return _tk;
    const b = new URLSearchParams({
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', refresh_token: refreshToken, grant_type: 'refresh_token' }).toString();
    const r = await req({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(b) } }, b);
    _tk = JSON.parse(r.d).access_token;
    if (!_tk) throw new Error('No se obtuvo token: ' + r.d.slice(0, 200));
    return _tk;
}
async function api(method, host, p, body) {
    const b = body ? JSON.stringify(body) : null;
    const h = { Authorization: 'Bearer ' + await token() };
    if (b) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(b); }
    const r = await req({ hostname: host, path: p, method, headers: h }, b);
    let j; try { j = JSON.parse(r.d); } catch (_) { j = r.d; }
    return { st: r.st, j };
}

async function lista(p, key) { const r = await api('GET', M, p); return r.j[key] || []; }
async function crea(desc, host, p, body) {
    if (!CREAR) { console.log('  (en seco) se crearía:', desc); return { name: '(en seco)' }; }
    const r = await api('POST', host, p, body);
    if (r.st !== 200) {
        console.log('  ✗', desc, r.st, JSON.stringify(r.j).slice(0, 300));
        if (r.st === 404) console.log('    (¿métrica recién creada? espera unos minutos y relanza)');
        process.exit(1);
    }
    console.log('  ✓', desc, '→', r.j.name);
    return r.j;
}

(async () => {
    console.log(`Proyecto ${P} · uptime ${HOST} · ${CREAR ? 'CREANDO' : 'EN SECO'}\n`);

    // Canal de correo
    let canal = (await lista(`/v3/projects/${P}/notificationChannels`, 'notificationChannels'))
        .find((c) => c.type === 'email' && c.labels && c.labels.email_address === CORREO);
    if (canal) console.log('  = canal ya existe', canal.name);
    else canal = await crea('canal de correo', M, `/v3/projects/${P}/notificationChannels`,
        { type: 'email', displayName: 'Chronos · aviso al titular', labels: { email_address: CORREO } });

    const pol = await lista(`/v3/projects/${P}/alertPolicies`, 'alertPolicies');
    const existe = (n) => pol.find((x) => x.displayName === n);
    const rate = { notificationRateLimit: { period: '300s' }, autoClose: '1800s' };
    async function politica(nombre, cuerpo) {
        if (existe(nombre)) { console.log('  = ya existe', nombre); return; }
        await crea(nombre, M, `/v3/projects/${P}/alertPolicies`,
            { displayName: nombre, combiner: 'OR', notificationChannels: [canal.name], ...cuerpo });
    }

    // A1 · purga / borrado incompletos (RGPD)
    await politica('Chronos · A1 · Purga o borrado incompletos', {
        documentation: doc('Una baja no se completó (`deleteUserData` PURGA INCOMPLETA o `archiveAndDeleteCoach` VERIFICACIÓN FALLIDA). Mirar `auth_deletion_failures` y el log. Es una supresión RGPD pendiente: abrir ficha en INCIDENTES.md si afecta a datos.'),
        conditions: [{ displayName: 'Log de purga incompleta', conditionMatchedLog: {
            filter: `${FUNC} AND severity>=ERROR AND ("PURGA INCOMPLETA" OR "VERIFICACIÓN FALLIDA")` } }],
        alertStrategy: rate });

    // A2 · correo
    await politica('Chronos · A2 · Fallo de correo (invitaciones)', {
        documentation: doc('`sendInviteEmail` no pudo enviar (Nodemailer). Las invitaciones no llegan. Revisar secretos EMAIL_* y el proveedor SMTP.'),
        conditions: [{ displayName: 'Log de error de Nodemailer', conditionMatchedLog: {
            filter: `${FUNC} AND severity>=ERROR AND "sendInviteEmail" AND "Error Nodemailer"` } }],
        alertStrategy: rate });

    // A3 · errores en funciones: métrica de logs + umbral
    const METRICA = 'chronos_funciones_errores';
    const met = await api('GET', L, `/v2/projects/${P}/metrics/${METRICA}`);
    if (met.st === 200) console.log('  = métrica ya existe', METRICA);
    else await crea('métrica de logs ' + METRICA, L, `/v2/projects/${P}/metrics`,
        { name: METRICA, description: 'Logs de nivel ERROR o superior de las Cloud Functions', filter: `${FUNC} AND severity>=ERROR` });
    await politica('Chronos · A3 · Errores en funciones (>5 en 10 min)', {
        documentation: doc('Más de 5 errores en 10 minutos en las Cloud Functions. Abrir Logs Explorer con severity>=ERROR y ver qué función falla.'),
        conditions: [{ displayName: 'Errores > 5 / 10 min', conditionThreshold: {
            filter: `metric.type="logging.googleapis.com/user/${METRICA}" AND resource.type="cloud_run_revision"`,
            aggregations: [{ alignmentPeriod: '600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' }],
            comparison: 'COMPARISON_GT', thresholdValue: 5, duration: '0s', trigger: { count: 1 } } }],
        alertStrategy: { autoClose: '1800s' } });

    // A4 · App Check (sólo rechazos: result="DENY")
    await politica('Chronos · A4 · Rechazos anómalos de App Check (>50 en 1 h)', {
        documentation: doc('Más de 50 peticiones rechazadas por App Check en una hora (lo normal: unas pocas por semana). Puede ser abuso, un cliente roto o reCAPTCHA caído. Ver `node scripts/ops/evidencia_appcheck.js`.'),
        conditions: [{ displayName: 'Rechazos App Check > 50 / h', conditionThreshold: {
            filter: 'metric.type="firebaseappcheck.googleapis.com/services/verification_count" AND resource.type="firebaseappcheck.googleapis.com/Service" AND metric.label.result="DENY"',
            aggregations: [{ alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' }],
            comparison: 'COMPARISON_GT', thresholdValue: 50, duration: '0s', trigger: { count: 1 } } }],
        alertStrategy: { autoClose: '3600s' } });

    // A5 · disponibilidad
    const ups = await lista(`/v3/projects/${P}/uptimeCheckConfigs`, 'uptimeCheckConfigs');
    let up = ups.find((u) => u.monitoredResource && u.monitoredResource.labels && u.monitoredResource.labels.host === HOST);
    if (up) console.log('  = comprobación de disponibilidad ya existe', up.name);
    else up = await crea('comprobación de disponibilidad ' + HOST, M, `/v3/projects/${P}/uptimeCheckConfigs`, {
        displayName: 'Chronos · ' + HOST, period: '300s', timeout: '10s',
        monitoredResource: { type: 'uptime_url', labels: { project_id: P, host: HOST } },
        httpCheck: { path: '/', port: 443, useSsl: true, validateSsl: true, requestMethod: 'GET' },
        selectedRegions: ['EUROPE', 'USA', 'SOUTH_AMERICA'] });
    const checkId = (up.name || '').split('/').pop();
    await politica('Chronos · A5 · La app no responde', {
        documentation: doc(`La comprobación de https://${HOST}/ falla desde más de una región. Mirar la consola de Hosting y el último despliegue.`),
        conditions: [{ displayName: 'Uptime falla', conditionThreshold: {
            filter: `metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND resource.type="uptime_url" AND metric.label.check_id="${checkId}"`,
            aggregations: [{ alignmentPeriod: '1200s', perSeriesAligner: 'ALIGN_NEXT_OLDER', crossSeriesReducer: 'REDUCE_COUNT_FALSE', groupByFields: ['resource.label.host'] }],
            comparison: 'COMPARISON_GT', thresholdValue: 1, duration: '600s', trigger: { count: 1 } } }],
        alertStrategy: { autoClose: '1800s' } });

    console.log('\nFin.');
})().catch((e) => { console.error(e.message); process.exit(1); });

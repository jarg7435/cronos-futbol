// ═══════════════════════════════════════════════════════════════════════════
//  scripts/ops/mfa_quitar_factor.js  ·  v862 (PROPUESTA_MFA_SA.md)
//  RECUPERACIÓN DEL SEGUNDO FACTOR (TOTP) DEL SUPERADMIN
//
//  Firebase no da códigos de recuperación. Si el SuperAdmin pierde TODOS sus
//  aparatos, la única forma de volver a entrar es quitar sus factores desde
//  la administración (Identity Toolkit, con la sesión de `firebase login`
//  del titular). Después entra sólo con contraseña y da de alta otra vez
//  sus aparatos («🔒 Contraseña» → «🔐 Verificación en dos pasos»).
//
//  Uso:
//    node scripts/ops/mfa_quitar_factor.js --proyecto test --correo <correo>
//         → EN SECO: enseña los factores de la cuenta (nombre y fecha; nunca
//           secretos) y no cambia nada
//    … --quitar                              → quita TODOS sus factores
//    … --proyecto prod … --quitar --confirmo-produccion
//         → en PRODUCCIÓN hace falta además este indicador
//
//  🚨 Quitar el factor deja la cuenta protegida SÓLO por la contraseña hasta
//  que se vuelva a dar de alta. Hacerlo sólo con la cuenta comprobada y con
//  permiso expreso del titular, y anotarlo en INCIDENTES.md.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const https = require('https'), fs = require('fs'), os = require('os'), path = require('path');

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const PROYECTOS = { prod: 'cronos-futbol-app', test: 'cronos-futbol-test' };
const P = PROYECTOS[arg('--proyecto')];
const CORREO = (arg('--correo') || '').trim().toLowerCase();
const QUITAR = process.argv.includes('--quitar');
const CONFIRMO_PROD = process.argv.includes('--confirmo-produccion');
if (!P || !CORREO) {
    console.error('uso: --proyecto prod|test --correo <correo> [--quitar [--confirmo-produccion]]');
    process.exit(2);
}
if (QUITAR && P === 'cronos-futbol-app' && !CONFIRMO_PROD) {
    console.error('✗ En producción, --quitar exige además --confirmo-produccion.');
    process.exit(2);
}
const mask = (e) => (e && e.includes('@')) ? e[0] + '***@' + e.split('@')[1] : '-';

function req(url, { method = 'GET', headers = {}, body = null } = {}) {
    const u = new URL(url);
    return new Promise((res, rej) => {
        const h = { ...headers }; if (body) h['Content-Length'] = Buffer.byteLength(body);
        const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: h }, (x) => {
            const c = []; x.on('data', (d) => c.push(d));
            x.on('end', () => { const t = Buffer.concat(c).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (_) {} res({ st: x.statusCode, j, t }); });
        });
        r.on('error', rej); if (body) r.write(body); r.end();
    });
}

(async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
    const b = new URLSearchParams({ client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', refresh_token: cfg.tokens.refresh_token, grant_type: 'refresh_token' }).toString();
    const tk = (await req('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b })).j.access_token;
    const H = { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json', 'x-goog-user-project': P };
    const IDT = `https://identitytoolkit.googleapis.com/v1/projects/${P}`;

    const lk = await req(`${IDT}/accounts:lookup`, { method: 'POST', headers: H, body: JSON.stringify({ email: [CORREO] }) });
    const u = lk.j && lk.j.users && lk.j.users[0];
    if (!u) { console.error('✗ No hay cuenta con ese correo en ' + P + ' (HTTP ' + lk.st + ')'); process.exit(1); }
    const fac = u.mfaInfo || [];
    console.log(`\n${P} · ${mask(u.email)} · uid ${u.localId.slice(0, 6)}… · correo verificado: ${u.emailVerified ? 'sí' : 'NO'}`);
    console.log(`factores: ${fac.length}`);
    fac.forEach((f) => console.log(`   · «${f.displayName || 'sin nombre'}» · ${f.totpInfo ? 'TOTP' : (f.phoneInfo ? 'SMS' : '?')} · alta ${f.enrolledAt || '?'}`));

    if (!QUITAR) { console.log('\nEN SECO: no se ha cambiado nada. Para quitarlos, añade --quitar.'); return; }
    if (!fac.length) { console.log('\nNo hay factores que quitar.'); return; }

    const up = await req(`${IDT}/accounts:update`, { method: 'POST', headers: H,
        body: JSON.stringify({ localId: u.localId, mfa: { enrollments: [] } }) });
    if (up.st !== 200) { console.error('✗ No se pudo quitar (HTTP ' + up.st + '): ' + (up.t || '').slice(0, 300)); process.exit(1); }
    const re = await req(`${IDT}/accounts:lookup`, { method: 'POST', headers: H, body: JSON.stringify({ localId: [u.localId] }) });
    const quedan = ((re.j && re.j.users && re.j.users[0] && re.j.users[0].mfaInfo) || []).length;
    console.log(quedan === 0
        ? '\n✅ Factores quitados. La cuenta entra sólo con contraseña: da de alta los aparatos otra vez cuanto antes.'
        : '\n✗ Siguen ' + quedan + ' factor(es). Revisar.');
    process.exit(quedan === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });

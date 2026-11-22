// ═══════════════════════════════════════════════════════════════════════════
//  scripts/ops/plazas_adultas_club.js  ·  v860 (N5 del E2E de Storage)
//  QUIÉN PUEDE COMPARTIR CLIPS DE ADULTOS CON LAS FAMILIAS
//
//  Las reglas de Storage y de la ficha `cronos_clips` exigen que quien abre un
//  clip a las familias figure en `clubs/{clubId}.plazasAdultas`. Ese documento
//  sólo lo escriben el SuperAdmin y la administración del club o del ente: la
//  categoría que declara quien sube ya NO basta (un entrenador de Alevín podía
//  declarar «senior», probado en testeo el 22-11).
//
//  🚨 NO DEDUCE NADA. `allRoles` y `platform_requests` los puede escribir el
//  propio usuario (ver INC-2026-004): la lista la decide el TITULAR, cuenta a
//  cuenta, y este script sólo la ejecuta. Comprueba, eso sí, que la cuenta
//  existe, es de ese club y tiene una plaza de adultos (si no, se niega).
//
//  Uso:
//    node scripts/ops/plazas_adultas_club.js --proyecto prod --club <clubId> --uid <uid o prefijo>
//         → EN SECO: enseña la cuenta (correo enmascarado) y lo que haría
//    … --escribir   → añade el uid (appendMissingElements: no toca nada más)
//    … --quitar     → lo retira (removeAllArrayElements)
//    node scripts/ops/plazas_adultas_club.js --proyecto prod --club <clubId> --ver
//         → enseña la lista actual
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const https = require('https'), fs = require('fs'), os = require('os'), path = require('path');

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const PROYECTOS = { prod: 'cronos-futbol-app', test: 'cronos-futbol-test' };
const P = PROYECTOS[arg('--proyecto')];
const CLUB = arg('--club'), UIDP = arg('--uid');
const ESCRIBIR = process.argv.includes('--escribir'), QUITAR = process.argv.includes('--quitar'), VER = process.argv.includes('--ver');
if (!P || !CLUB || (!UIDP && !VER)) {
    console.error('uso: --proyecto prod|test --club <clubId> (--uid <uid|prefijo> [--escribir|--quitar] | --ver)');
    process.exit(2);
}
const ADULTOS = /^(regional|regional-fem|nacional|senior)(-[a-z0-9-]*)?$/;
const slug = (c) => String(c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/^(f7|f11)-/, '');
const STAFF = ['user', 'coach', 'director', 'coordinator', 'club_admin', 'individual', 'admin_individual', 'individual_admin', 'entrenador_individual'];
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
const v = (x) => x == null ? null : (x.stringValue ?? x.booleanValue ?? (x.arrayValue ? (x.arrayValue.values || []).map(v)
    : (x.mapValue ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, y]) => [k, v(y)])) : null)));

(async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
    const b = new URLSearchParams({ client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', refresh_token: cfg.tokens.refresh_token, grant_type: 'refresh_token' }).toString();
    const tk = (await req('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b })).j.access_token;
    const A = { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' };
    const FS = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;

    const club = await req(`${FS}/clubs/${CLUB}`, { headers: A });
    if (club.st !== 200) { console.error('✗ no existe clubs/' + CLUB + ' en ' + P); process.exit(1); }
    const cf = club.j.fields || {};
    const lista = v(cf.plazasAdultas) || [];
    console.log(`\n${P} · club «${v(cf.name) || CLUB}» · vídeos ${((v(cf.extras) || {}).modulo_videos === true) ? 'ACTIVADOS' : 'no'} · plazasAdultas: ${lista.length} uid(s)`);
    if (VER) { for (const u of lista) console.log('   · ' + u.slice(0, 6) + '…'); return; }

    // Resolver la cuenta (por uid completo o prefijo único) entre los usuarios del club.
    const q = await req(`${FS}:runQuery`, { method: 'POST', headers: A, body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: 'clubId' }, op: 'EQUAL', value: { stringValue: CLUB } } } } }) });
    let cand = (q.j || []).filter((x) => x.document).map((x) => ({ uid: x.document.name.split('/').pop(), f: x.document.fields || {} }));
    if (!cand.some((c) => c.uid.startsWith(UIDP))) {
        const r = await req(`${FS}:runQuery`, { method: 'POST', headers: A, body: JSON.stringify({ structuredQuery: {
            from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: 'individualEntityId' }, op: 'EQUAL', value: { stringValue: CLUB } } } } }) });
        cand = cand.concat((r.j || []).filter((x) => x.document).map((x) => ({ uid: x.document.name.split('/').pop(), f: x.document.fields || {} })));
    }
    const m = cand.filter((c) => c.uid.startsWith(UIDP));
    if (m.length !== 1) { console.error(`✗ el uid/prefijo «${UIDP}» casa con ${m.length} cuentas de este club (debe ser exactamente 1)`); process.exit(1); }
    const { uid, f } = m[0];
    const plazas = (v(f.allRoles) || []).filter((p) => p && STAFF.includes(p.role) && p.status !== 'removed' && p.status !== 'revoked');
    const adultas = plazas.filter((p) => ADULTOS.test(slug(p.category)));
    console.log(`   cuenta ${uid.slice(0, 6)}… · ${mask(v(f.email))} · rol raíz ${v(f.role)} · plazas de adultos: ${adultas.map((p) => p.role + ':' + p.category + (p.subcategory ? '/' + p.subcategory : '')).join(', ') || 'NINGUNA'}`);
    const esta = lista.includes(uid);

    if (QUITAR) {
        if (!esta) { console.log('   = no está en la lista: nada que quitar'); return; }
        if (!ESCRIBIR && !process.argv.includes('--quitar')) return;
    } else {
        if (!adultas.length) { console.error('✗ la cuenta no tiene ninguna plaza de cuerpo técnico de ADULTOS en este club: no se añade'); process.exit(1); }
        if (esta) { console.log('   = ya está en la lista: nada que hacer'); return; }
    }
    const accion = QUITAR ? 'removeAllArrayElements' : 'appendMissingElements';
    if (!ESCRIBIR) { console.log(`   (EN SECO) se ${QUITAR ? 'QUITARÍA' : 'AÑADIRÍA'} a clubs/${CLUB}.plazasAdultas. Repite con --escribir.`); return; }
    const w = await req(`https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents:commit`, { method: 'POST', headers: A,
        body: JSON.stringify({ writes: [{ transform: { document: `projects/${P}/databases/(default)/documents/clubs/${CLUB}`,
            fieldTransforms: [{ fieldPath: 'plazasAdultas', [accion]: { values: [{ stringValue: uid }] } }] } }] }) });
    const despues = v(((await req(`${FS}/clubs/${CLUB}?mask.fieldPaths=plazasAdultas`, { headers: A })).j.fields || {}).plazasAdultas) || [];
    console.log(`   ${w.st === 200 ? '✓' : '✗'} commit HTTP ${w.st} · ahora plazasAdultas: ${despues.length} uid(s) · la cuenta ${despues.includes(uid) ? 'ESTÁ' : 'NO está'}`);
    if (w.st !== 200) process.exit(1);
})().catch((e) => { console.error(e.message); process.exit(1); });

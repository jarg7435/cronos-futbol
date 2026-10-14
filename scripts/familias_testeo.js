// ─────────────────────────────────────────────────────────────────────────
//  familias_testeo.js  ·  🧪 5 familias sintéticas para probar Contactos
//  (implementar.txt 2026-10-13)
//
//  Añade a cronos-futbol-test cinco cuentas de Familiar / Jugador del club
//  «CD PRUEBA», tal como las deja el registro real de una familia aprobada:
//  plaza `parent` con categoría y subcategoría de SU equipo y el código de
//  invitación «J{dorsal}» que el registro guarda en `inviteCode`.
//
//    3 de Alevín C (F7) y 2 de Regional B (F11). El #10 está A PROPÓSITO en
//    los dos equipos (DÁMASO en Alevín C, CARLO en Regional B): el vínculo
//    vive en `cronos_player_links/{clubId}_{dorsal}`, uno por dorsal y club.
//
//  🔒 SALVAGUARDAS (las de semilla_testeo.js)
//   · Proyecto FIJADO aquí; toda URL de producción, o sin el de testeo, aborta.
//   · Datos inventados. Por defecto SIMULA; sólo escribe con --escribir.
//   · Repetible: las cuentas que ya existen se reutilizan.
//   · Contraseña: la común de testeo (fichero local, nunca se imprime).
//
//  Uso:  node scripts/familias_testeo.js              → simula
//        node scripts/familias_testeo.js --escribir   → escribe en TESTEO
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROYECTO = 'cronos-futbol-test';
const PROHIBIDO = /cronos-futbol-app|393110572633/;
const ESCRIBIR = process.argv.includes('--escribir');
const FICHERO_CLAVE = path.join(os.homedir(), 'cronos_testeo', 'contrasena.txt');
const FS = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const IDT = `https://identitytoolkit.googleapis.com/v1/projects/${PROYECTO}`;

const SA_EMAIL = 'jarg7435@gmail.com';
const CLUB = { id: 'club_test_cdprueba', name: 'CD PRUEBA' };
const FAMILIAS = [
    { n: 1, cat: 'alevin',   sub: 'C', dorsal: '3',  jugador: 'LUIS' },
    { n: 2, cat: 'alevin',   sub: 'C', dorsal: '7',  jugador: 'ROBER' },
    { n: 3, cat: 'alevin',   sub: 'C', dorsal: '10', jugador: 'DÁMASO' },
    { n: 4, cat: 'regional', sub: 'B', dorsal: '10', jugador: 'CARLO' },
    { n: 5, cat: 'regional', sub: 'B', dorsal: '15', jugador: 'SERGIO' },
].map((f) => ({ ...f, email: `jarg7435+testfam${f.n}@gmail.com`,
    nombre: `Familia ${f.jugador} ${f.cat === 'alevin' ? 'ALC' : 'RGB'}`, invite: 'J' + f.dorsal }));

function cerrojo(url) {
    if (PROHIBIDO.test(url)) throw new Error('ABORTADO: URL de PRODUCCIÓN: ' + url);
    if (!url.includes(PROYECTO)) throw new Error('ABORTADO: URL sin el proyecto de testeo: ' + url);
}
function http(url, method, cuerpo, tok) {
    return new Promise((res, rej) => {
        const headers = { 'x-goog-user-project': PROYECTO };
        if (tok) headers.Authorization = 'Bearer ' + tok;
        let body;
        if (cuerpo !== undefined) { body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
            headers['Content-Type'] = typeof cuerpo === 'string' ? 'application/x-www-form-urlencoded' : 'application/json'; }
        const r = https.request(url, { method, headers }, (x) => {
            const b = []; x.on('data', (c) => b.push(c));
            x.on('end', () => { const t = Buffer.concat(b).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (_) {} res({ s: x.statusCode, j, t }); });
        });
        r.on('error', rej); if (body) r.write(body); r.end();
    });
}
let TOK;
async function api(url, method = 'GET', cuerpo) {
    cerrojo(url);
    if (method !== 'GET' && !ESCRIBIR && !url.endsWith(':lookup')) throw new Error('BUG: escritura en modo simulación');
    const r = await http(url, method, cuerpo, TOK);
    if (r.s !== 200) throw new Error(method + ' ' + url.replace(/\?.*/, '') + ' → ' + r.s + ' ' + r.t.replace(/\s+/g, ' ').slice(0, 300));
    return r.j;
}
async function token() {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.tokens.refresh_token,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' }).toString();
    const r = await http('https://oauth2.googleapis.com/token', 'POST', body);
    if (!r.j || !r.j.access_token) throw new Error('Sin sesión del CLI de Firebase');
    TOK = r.j.access_token;
}

function valor(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
    return { mapValue: { fields: campos(v) } };
}
function campos(o) { const f = {}; for (const k of Object.keys(o)) f[k] = valor(o[k]); return f; }

// Como auth.js (registro de familia): plaza `parent` con su equipo, su
// código y el nombre del jugador; los mismos campos repetidos en la raíz.
function docUsuario(f, ahora) {
    const plaza = { role: 'parent', clubId: CLUB.id, clubName: CLUB.name, category: f.cat, subcategory: f.sub,
        coordinatorType: null, isAuthorized: true, status: 'active', firstName: f.nombre, lastName: null,
        displayName: f.nombre, playerAlias: f.jugador, inviteCode: f.invite };
    return { email: f.email, firstName: f.nombre, displayName: f.nombre, role: 'parent', clubId: CLUB.id, clubName: CLUB.name,
        category: f.cat, subcategory: f.sub, playerAlias: f.jugador, inviteCode: f.invite,
        isAuthorized: true, status: 'active', allRoles: [plaza], requestedSlot: null,
        createdAt: ahora, gdprConsent: true, gdprConsentDate: ahora, gdprConsentVersion: '2024-01',
        authorizedAt: ahora.toISOString(), authorizedBy: SA_EMAIL, _semillaTesteo: true };
}
function solicitud(f, uid, ahora) {
    return { id: `semilla_${uid}_parent_${f.cat}-${f.sub.toLowerCase()}`, datos: {
        type: 'self_registration', status: 'sa_approved', userUid: uid, requestedEmail: f.email, requestedName: f.nombre,
        requestedRole: 'parent', requestedRoleLabel: 'Familiar / Jugador', requestedCategory: f.cat, requestedSubcategory: f.sub,
        requestedCoordinatorType: null, requestedSlot: null, inviteCode: f.invite, playerAlias: f.jugador,
        clubId: CLUB.id, clubName: CLUB.name, individualOwnerId: null,
        createdAt: ahora.toISOString(), forwardedAt: ahora.toISOString(), forwardedBy: SA_EMAIL,
        approvedAt: ahora.toISOString(), approvedBy: SA_EMAIL, _semillaTesteo: true } };
}

(async () => {
    console.log('\n🧪 Familias de TESTEO → ' + PROYECTO + (ESCRIBIR ? '  (ESCRIBE)' : '  (SIMULACIÓN: no escribe nada)'));
    await token();
    if (!fs.existsSync(FICHERO_CLAVE)) throw new Error('Falta la contraseña común: ejecuta antes la semilla de testeo');
    const clave = fs.readFileSync(FICHERO_CLAVE, 'utf8').trim();

    const uids = {};
    const hay = await api(IDT + '/accounts:lookup', 'POST', { email: FAMILIAS.map((f) => f.email) });
    for (const f of FAMILIAS) {
        const ya = (hay.users || []).find((u) => (u.email || '').toLowerCase() === f.email);
        if (ya) { uids[f.n] = ya.localId; console.log('  cuenta existente  ' + f.email); continue; }
        if (!ESCRIBIR) { uids[f.n] = '(nuevo:' + f.n + ')'; console.log('  se crearía        ' + f.email); continue; }
        const r = await api(IDT + '/accounts', 'POST', { email: f.email, password: clave, emailVerified: true, displayName: f.nombre });
        uids[f.n] = r.localId; console.log('  cuenta creada     ' + f.email);
    }
    if (ESCRIBIR) for (const f of FAMILIAS) await api(IDT + '/accounts:update', 'POST', { localId: uids[f.n], password: clave, emailVerified: true });

    const ahora = new Date();
    const docs = [];
    for (const f of FAMILIAS) {
        docs.push(['users/' + uids[f.n], docUsuario(f, ahora)]);
        const s = solicitud(f, uids[f.n], ahora);
        docs.push(['platform_requests/' + s.id, s.datos]);
    }
    console.log('\nDocumentos: ' + docs.length);
    FAMILIAS.forEach((f) => console.log(`  ${f.email}  →  ${f.cat} ${f.sub} · ${f.invite} · ${f.jugador}`));
    if (!ESCRIBIR) { console.log('\nSIMULACIÓN: no se ha escrito nada. Repite con --escribir.'); return; }

    const nombre = (p) => `projects/${PROYECTO}/databases/(default)/documents/${p}`;
    await api(FS + ':commit', 'POST', { writes: docs.map(([p, d]) => ({ update: { name: nombre(p), fields: campos(d) } })) });
    console.log('✅ ' + docs.length + ' documentos escritos (commit atómico)');

    for (const f of FAMILIAS) {
        await api(IDT + '/accounts:update', 'POST', { localId: uids[f.n],
            customAttributes: JSON.stringify({ role: 'parent', clubId: CLUB.id, claimsSetAt: Date.now() }) });
    }
    console.log('✅ permisos asignados a ' + FAMILIAS.length + ' cuentas');
})().catch((e) => { console.error('\n❌ ' + e.message); process.exit(1); });

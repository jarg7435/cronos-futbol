// ─────────────────────────────────────────────────────────────────────────
//  semilla_testeo.js  ·  🧪 Testeo aislado, fase C (2026-09-24)
//
//  Siembra DATOS SINTÉTICOS en cronos-futbol-test: un club, un ente, siete
//  cuentas con sus plazas, sus solicitudes aprobadas y la configuración que
//  la app lee de la BD (superadmins, clave VAPID).
//
//  🔒 SALVAGUARDAS
//   · El proyecto está FIJADO AQUÍ, no viene de un argumento. Toda URL que
//     mencione producción, o que NO mencione testeo, aborta antes de salir.
//   · NO SE COPIA NADA DE PRODUCCIÓN: son datos de menores. Todo es inventado.
//   · Por defecto SIMULA. Sólo escribe con --escribir.
//   · Repetible: ids fijos; las cuentas que ya existen se reutilizan.
//   · La contraseña común de las cuentas vive en un fichero LOCAL fuera del
//     repo y de OneDrive (se genera la primera vez) y NUNCA se imprime.
//
//  Uso:  node scripts/semilla_testeo.js              → simula
//        node scripts/semilla_testeo.js --escribir   → escribe en TESTEO
//
//  Credenciales: la sesión del CLI de Firebase (owner).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PROYECTO = 'cronos-futbol-test';
const PROHIBIDO = /cronos-futbol-app|393110572633/;
const ESCRIBIR = process.argv.includes('--escribir');
const FICHERO_CLAVE = path.join(os.homedir(), 'cronos_testeo', 'contrasena.txt');
const VAPID_TESTEO = 'BLw-4u4DOJxXPZrN-gjpDfp23u7056mYap4gtGzzsdqTZoSaUXCGf2oYicCtW4RdPQ3E0afupmIgRmNBYJFtwcA';
const FS = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const IDT = `https://identitytoolkit.googleapis.com/v1/projects/${PROYECTO}`;

// ── Los datos ────────────────────────────────────────────────────────────
const SA_EMAIL = 'jarg7435@gmail.com';
const CLUB = { id: 'club_test_cdprueba', name: 'CD PRUEBA' };
const ENTE = { id: 'individual_test_mister', name: 'MÍSTER PRUEBA' };
const CUENTAS = [
    { clave: 'sa',       email: SA_EMAIL,                         nombre: 'SuperAdmin',   role: 'superadmin',  donde: null,
      plazas: [{ role: 'superadmin' }] },
    { clave: 'admin',    email: 'jarg7435+testadmin@gmail.com',    nombre: 'Admin Prueba', role: 'club_admin',  donde: CLUB,
      plazas: [{ role: 'club_admin' }] },
    { clave: 'director', email: 'jarg7435+testdirector@gmail.com', nombre: 'Director Prueba', role: 'director', donde: CLUB,
      plazas: [{ role: 'director' }] },
    { clave: 'coord',    email: 'jarg7435+testcoord@gmail.com',    nombre: 'Coordinador Prueba', role: 'coordinator', donde: CLUB,
      plazas: [{ role: 'coordinator', coordinatorType: 'f711' }] },
    // Un entrenador con DOS equipos (F7 y F11): el caso de las plazas.
    { clave: 'coach',    email: 'jarg7435+testcoach@gmail.com',    nombre: 'Entrenador Prueba', role: 'user', donde: CLUB,
      plazas: [{ role: 'user', category: 'alevin', subcategory: 'C' }, { role: 'user', category: 'regional', subcategory: 'B' }] },
    { clave: 'familia',  email: 'jarg7435+testfamilia@gmail.com',  nombre: 'Familia Prueba', role: 'parent', donde: CLUB,
      plazas: [{ role: 'parent', category: 'alevin', subcategory: 'C' }] },
    { clave: 'ente',     email: 'jarg7435+testente@gmail.com',     nombre: 'Míster Prueba', role: 'individual', donde: ENTE,
      plazas: [{ role: 'individual', category: 'regional', subcategory: 'A' }] },
];
const ETIQUETA = { club_admin: 'Administrador de Club', director: 'Director Deportivo', coordinator: 'Coordinador',
                   user: 'Entrenador', parent: 'Familiar / Jugador', individual: 'Administrador Individual' };

// ── Red, con el cerrojo ─────────────────────────────────────────────────
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
    if (method !== 'GET' && !ESCRIBIR) throw new Error('BUG: escritura en modo simulación');
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

// ── Contraseña: se crea una vez, no se imprime nunca ────────────────────
function contrasena() {
    if (fs.existsSync(FICHERO_CLAVE)) return fs.readFileSync(FICHERO_CLAVE, 'utf8').trim();
    if (!ESCRIBIR) return null;
    // Cumple la política del registro: mayúscula, minúscula, número y especial.
    const cuerpo = crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    const clave = 'Cp' + cuerpo + '7*';
    fs.mkdirSync(path.dirname(FICHERO_CLAVE), { recursive: true });
    fs.writeFileSync(FICHERO_CLAVE, clave, { mode: 0o600 });
    return clave;
}

// ── Firestore: JS → valores REST ─────────────────────────────────────────
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

// ── Construcción de los documentos ───────────────────────────────────────
function plaza(c, p) {
    const d = c.donde;
    const o = { role: p.role, clubId: d ? d.id : null, clubName: d ? d.name : null,
        category: p.category || null, subcategory: p.subcategory || null,
        coordinatorType: p.coordinatorType || null, isAuthorized: true, status: 'active',
        firstName: c.nombre, lastName: null, displayName: null };
    if (d === ENTE) o.individualEntityId = ENTE.id;
    return o;
}
function docUsuario(c, uid, ahora) {
    const d = c.donde;
    const u = { email: c.email, firstName: c.nombre, role: c.role, clubId: d ? d.id : null, clubName: d ? d.name : null,
        isAuthorized: true, status: 'active', allRoles: c.plazas.map((p) => plaza(c, p)),
        createdAt: ahora, gdprConsent: true, gdprConsentDate: ahora, gdprConsentVersion: '2024-01',
        authorizedAt: ahora.toISOString(), authorizedBy: SA_EMAIL, requestedSlot: null, _semillaTesteo: true };
    if (c.role === 'club_admin') { u.requestedClubName = d.name; u.requestedQuotas = { directors: 2, coordinators: 3, coaches: 10, parents: 50 }; }
    if (d === ENTE) { u.individualEntityId = ENTE.id; u.individualOwnerId = ENTE.id; u.isIndividual = true; u.displayName = c.nombre; }
    return u;
}
function solicitudes(c, uid, ahora) {
    if (c.role === 'superadmin') return [];
    return c.plazas.map((p) => {
        const sufijo = p.category ? '_' + p.category + '-' + String(p.subcategory).toLowerCase() : '';
        const esEnte = c.donde === ENTE;
        return { id: 'semilla_' + uid + '_' + p.role + sufijo, datos: {
            type: esEnte ? 'ind_admin_registration' : 'self_registration', status: 'sa_approved',
            userUid: uid, requestedEmail: c.email, requestedName: c.nombre,
            requestedRole: p.role, requestedRoleLabel: ETIQUETA[p.role] || p.role,
            requestedCategory: p.category || null, requestedSubcategory: p.subcategory || null,
            requestedCoordinatorType: p.coordinatorType || null, requestedSlot: null,
            clubId: esEnte ? null : c.donde.id, clubName: c.donde.name,
            individualOwnerId: esEnte ? ENTE.id : null,
            createdAt: ahora.toISOString(), forwardedAt: ahora.toISOString(), forwardedBy: SA_EMAIL,
            approvedAt: ahora.toISOString(), approvedBy: SA_EMAIL, _semillaTesteo: true } };
    });
}

// ── Principal ────────────────────────────────────────────────────────────
(async () => {
    console.log('\n🧪 Semilla de TESTEO → ' + PROYECTO + (ESCRIBIR ? '  (ESCRIBE)' : '  (SIMULACIÓN: no escribe nada)'));
    await token();
    const clave = contrasena();
    console.log('Contraseña común: ' + (clave ? 'en ' + FICHERO_CLAVE + ' (no se muestra)' : 'se generará al escribir'));

    // 1. Cuentas de Authentication
    const uids = {};
    const hay = await api(IDT + '/accounts:lookup', 'POST', { email: CUENTAS.map((c) => c.email) }).catch((e) => {
        if (!ESCRIBIR) return { users: [] }; throw e; });
    for (const c of CUENTAS) {
        const ya = (hay.users || []).find((u) => (u.email || '').toLowerCase() === c.email.toLowerCase());
        if (ya) { uids[c.clave] = ya.localId; console.log('  cuenta existente  ' + c.email); continue; }
        if (!ESCRIBIR) { uids[c.clave] = '(nuevo:' + c.clave + ')'; console.log('  se crearía        ' + c.email); continue; }
        const r = await api(IDT + '/accounts', 'POST', { email: c.email, password: clave, emailVerified: true, displayName: c.nombre });
        uids[c.clave] = r.localId; console.log('  cuenta creada     ' + c.email);
    }
    if (ESCRIBIR) {  // la contraseña de las ya existentes también se alinea con el fichero
        for (const c of CUENTAS) await api(IDT + '/accounts:update', 'POST', { localId: uids[c.clave], password: clave, emailVerified: true });
    }

    // 2. Documentos
    const ahora = new Date();
    const docs = [];
    docs.push(['cronos_config/superadmins', { emails: [SA_EMAIL] }]);
    docs.push(['cronos_config/push', { vapidKey: VAPID_TESTEO }]);
    docs.push(['clubs/' + CLUB.id, { name: CLUB.name, plan: 'free', status: 'active',
        slots: { users: 10, coordinators: 3, directors: 2, parents: 50 },
        usedSlots: { users: 0, coordinators: 0, directors: 0, parents: 0 },
        adminEmail: CUENTAS[1].email, adminUid: uids.admin, createdAt: ahora.toISOString(), createdBySA: SA_EMAIL, _semillaTesteo: true }]);
    const extras = {};
    ['mensajeria', 'contactos', 'rol_coordinador', 'rol_padres', 'sesion_unica', 'comunicaciones', 'partidos_terminados',
     'entrenamientos', 'actualizaciones', 'secretaria', 'semaforo', 'cuadrante', 'informes_padres', 'informes',
     'rol_director', 'partidos_en_vivo', 'plantilla', 'convocatorias'].forEach((k) => { extras[k] = true; });
    extras.registro_pr = false;
    docs.push(['clubs/' + ENTE.id, { name: ENTE.name, type: 'individual', plan: 'free', status: 'active',
        slots: { parents: 100, coaches: 2, admins: 2 }, usedSlots: { parents: 0, coaches: 0, admins: 1 },
        adminEmail: CUENTAS[6].email, adminName: CUENTAS[6].nombre, adminUid: uids.ente, hasAdmin: true, email: null,
        extras, createdAt: ahora.toISOString(), createdBySA: SA_EMAIL, _semillaTesteo: true }]);
    for (const c of CUENTAS) {
        docs.push(['users/' + uids[c.clave], docUsuario(c, uids[c.clave], ahora)]);
        for (const s of solicitudes(c, uids[c.clave], ahora)) docs.push(['platform_requests/' + s.id, s.datos]);
    }
    console.log('\nDocumentos: ' + docs.length);
    docs.forEach(([p]) => console.log('  ' + p));
    if (!ESCRIBIR) { console.log('\nSIMULACIÓN: no se ha escrito nada. Repite con --escribir.'); return; }

    const nombre = (p) => `projects/${PROYECTO}/databases/(default)/documents/${p}`;
    await api(FS + ':commit', 'POST', { writes: docs.map(([p, d]) => ({ update: { name: nombre(p), fields: campos(d) } })) });
    console.log('✅ ' + docs.length + ' documentos escritos (commit atómico)');

    // 3. Permisos (custom claims), como los pone setCustomClaims
    for (const c of CUENTAS) {
        const claims = c.role === 'superadmin'
            ? { role: 'superadmin', superAdmin: true, admin: true, clubId: null, claimsSetAt: Date.now() }
            : { role: c.role, clubId: c.donde.id, claimsSetAt: Date.now() };
        await api(IDT + '/accounts:update', 'POST', { localId: uids[c.clave], customAttributes: JSON.stringify(claims) });
    }
    console.log('✅ permisos asignados a ' + CUENTAS.length + ' cuentas');
})().catch((e) => { console.error('\n❌ ' + e.message); process.exit(1); });

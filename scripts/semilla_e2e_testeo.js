// ─────────────────────────────────────────────────────────────────────────
//  semilla_e2e_testeo.js  ·  🧪 Pruebas end-to-end de la reauditoría 18-10
//
//  Siembra en cronos-futbol-test DOS CLUBES FICTICIOS para las pruebas E2E
//  que pide el auditor (aislamiento, invitaciones, revocación, acceso
//  familiar, informes/Storage y borrado):
//
//    · «E2E CLUB NORTE»: admin, director, entrenador Alevín A y una familia
//      de Alevín A aprobada y SIN jugador (pendiente de asignación, v824).
//    · «E2E CLUB SUR»:   admin, entrenador Alevín A, un segundo entrenador
//      (Benjamín B, el que se revoca) y una familia de Alevín A pendiente.
//
//  🔑 Los dos entrenadores llevan la MISMA categoría a propósito: sus
//  jugadores tienen los MISMOS códigos (ALA01…), que es el caso difícil del
//  aislamiento entre clubes. Cada uno con su plantilla de 18 (10 con nombre).
//
//  No toca nada del club «CD PRUEBA» ni del ente de la semilla general
//  (semilla_testeo.js): ids y cuentas propios, marcados `_semillaE2E`.
//
//  🔒 SALVAGUARDAS (las mismas que semilla_testeo.js)
//   · Proyecto FIJADO aquí; toda URL de producción, o sin testeo, aborta.
//   · Datos INVENTADOS: nada se copia de producción (son datos de menores).
//   · Por defecto SIMULA. Sólo escribe con --escribir.
//   · Repetible: ids fijos; las cuentas existentes se reutilizan. ⚠️ Repetirlo
//     DEVUELVE los documentos sembrados a su estado inicial.
//   · Contraseña: la común de testeo (fichero local, nunca se imprime).
//
//  Uso:  node scripts/semilla_e2e_testeo.js              → simula
//        node scripts/semilla_e2e_testeo.js --escribir   → escribe en TESTEO
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const PROYECTO = 'cronos-futbol-test';
const PROHIBIDO = /cronos-futbol-app|393110572633/;
const ESCRIBIR = process.argv.includes('--escribir');
const FICHERO_CLAVE = path.join(os.homedir(), 'cronos_testeo', 'contrasena.txt');
const FS = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const IDT = `https://identitytoolkit.googleapis.com/v1/projects/${PROYECTO}`;

// ── Los datos (todo inventado) ───────────────────────────────────────────
const SA_EMAIL = 'jarg7435@gmail.com';
const NORTE = { id: 'club_test_e2e_norte', name: 'E2E CLUB NORTE' };
const SUR   = { id: 'club_test_e2e_sur',   name: 'E2E CLUB SUR' };
const ALEVIN_A = { category: 'alevin', subcategory: 'A' };
const CUENTAS = [
    { cuenta: 'n_admin',   club: NORTE, email: 'jarg7435+e2enorteadmin@gmail.com',    nombre: 'Admin Norte',        role: 'club_admin', plazas: [{ role: 'club_admin' }] },
    { cuenta: 'n_dir',     club: NORTE, email: 'jarg7435+e2enortedirector@gmail.com', nombre: 'Director Norte',     role: 'director',   plazas: [{ role: 'director' }] },
    { cuenta: 'n_coach',   club: NORTE, email: 'jarg7435+e2enortecoach@gmail.com',    nombre: 'Entrenador Norte',   role: 'user',       plazas: [{ role: 'user', ...ALEVIN_A }] },
    { cuenta: 'n_familia', club: NORTE, email: 'jarg7435+e2enortefamilia@gmail.com',  nombre: 'Familia Norte',      role: 'parent',     plazas: [{ role: 'parent', ...ALEVIN_A, playerAlias: 'NICO' }] },
    { cuenta: 's_admin',   club: SUR,   email: 'jarg7435+e2esuradmin@gmail.com',      nombre: 'Admin Sur',          role: 'club_admin', plazas: [{ role: 'club_admin' }] },
    { cuenta: 's_coach',   club: SUR,   email: 'jarg7435+e2esurcoach@gmail.com',      nombre: 'Entrenador Sur',     role: 'user',       plazas: [{ role: 'user', ...ALEVIN_A }] },
    { cuenta: 's_coach2',  club: SUR,   email: 'jarg7435+e2esurcoach2@gmail.com',     nombre: 'Entrenador Sur Dos', role: 'user',       plazas: [{ role: 'user', category: 'benjamin', subcategory: 'B' }] },
    { cuenta: 's_familia', club: SUR,   email: 'jarg7435+e2esurfamilia@gmail.com',    nombre: 'Familia Sur',        role: 'parent',     plazas: [{ role: 'parent', ...ALEVIN_A, playerAlias: 'SAMU' }] },
];
// Plantillas: nombres inventados, distintos en cada club.
const PLANTILLA = {
    n_coach: ['NICO', 'ÁLEX', 'BRUNO', 'CARLOS', 'DANI', 'ELÍAS', 'FÉLIX', 'GABI', 'HUGO', 'IKER'],
    s_coach: ['SAMU', 'TONI', 'UNAI', 'VÍCTOR', 'WILLY', 'XAVI', 'YAGO', 'ZACA', 'RAÚL', 'PABLO'],
};
const ETIQUETA = { club_admin: 'Administrador de Club', director: 'Director Deportivo', user: 'Entrenador', parent: 'Familiar / Jugador' };

// Clave de equipo y prefijo de código con las MISMAS funciones de la app.
const UTILS = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'utils.js'), 'utf8');
const ctxU = { window: {} };
vm.createContext(ctxU);
function _funcion(desde) {
    const i = UTILS.indexOf(desde); if (i < 0) throw new Error('utils.js sin ' + desde);
    let p = 0, j = UTILS.indexOf('{', i);
    for (; j < UTILS.length; j++) { if (UTILS[j] === '{') p++; else if (UTILS[j] === '}') { p--; if (!p) break; } }
    return UTILS.slice(i, j + 1);
}
['function _cronosNoEsAcento(', 'function cronosTeamSlug(', 'function cronosSinModalidad(', 'function cronosTeamId(',
 'function cronosPrefijoJugador('].forEach((f) => vm.runInContext(_funcion(f), ctxU));
const teamId = (clubId, cat, sub) => vm.runInContext(`cronosTeamId(${JSON.stringify(clubId)}, ${JSON.stringify(cat)}, ${JSON.stringify(sub)})`, ctxU);
const prefijo = (eq) => vm.runInContext(`cronosPrefijoJugador(${JSON.stringify(eq)})`, ctxU);

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
    if (method !== 'GET' && !ESCRIBIR && !/accounts:lookup$/.test(url)) throw new Error('BUG: escritura en modo simulación');
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
    return { role: p.role, clubId: c.club.id, clubName: c.club.name,
        category: p.category || null, subcategory: p.subcategory || null, coordinatorType: null,
        playerAlias: p.playerAlias || null, isAuthorized: true, status: 'active',
        firstName: c.nombre, lastName: null, displayName: null };
}
function docUsuario(c, ahora) {
    const p0 = c.plazas[0];
    const u = { email: c.email, firstName: c.nombre, displayName: c.nombre, role: c.role,
        clubId: c.club.id, clubName: c.club.name, isAuthorized: true, status: 'active',
        allRoles: c.plazas.map((p) => plaza(c, p)),
        category: p0.category || null, subcategory: p0.subcategory || null,
        playerAlias: p0.playerAlias || null,
        createdAt: ahora, gdprConsent: true, gdprConsentDate: ahora, gdprConsentVersion: '2024-01',
        authorizedAt: ahora.toISOString(), authorizedBy: SA_EMAIL, requestedSlot: null, _semillaE2E: true };
    if (c.role === 'club_admin') { u.requestedClubName = c.club.name; u.requestedQuotas = { directors: 2, coordinators: 3, coaches: 10, parents: 50 }; }
    return u;
}
function solicitudes(c, uid, ahora) {
    return c.plazas.map((p) => {
        const sufijo = p.category ? '_' + p.category + '-' + String(p.subcategory).toLowerCase() : '';
        return { id: 'e2e_' + uid + '_' + p.role + sufijo, datos: {
            type: 'self_registration', status: 'sa_approved', userUid: uid, requestedEmail: c.email, requestedName: c.nombre,
            requestedRole: p.role, requestedRoleLabel: ETIQUETA[p.role] || p.role,
            requestedCategory: p.category || null, requestedSubcategory: p.subcategory || null,
            requestedCoordinatorType: null, requestedSlot: null, clubId: c.club.id, clubName: c.club.name,
            createdAt: ahora.toISOString(), forwardedAt: ahora.toISOString(), forwardedBy: SA_EMAIL,
            approvedAt: ahora.toISOString(), approvedBy: SA_EMAIL, _semillaE2E: true } };
    });
}
// La raíz de plantilla tal como la guarda cronosPlantillaGuardar (utils.js):
// la del equipo en `porEquipo[teamId].f7` y el legado `f7` al día.
function raizPlantilla(c) {
    const eq = teamId(c.club.id, ALEVIN_A.category, ALEVIN_A.subcategory);
    const pre = prefijo(eq);
    const nombres = PLANTILLA[c.cuenta];
    const f7 = Array.from({ length: 18 }, (_, i) => ({
        id: pre + String(i + 1).padStart(2, '0'), number: i + 1,
        name: nombres[i] || '', surname: '', alias: nombres[i] || '' }));
    return { eq, raiz: { f7, f11: [], porEquipo: { [eq]: { f7, f11: [] } } } };
}

// ── Principal ────────────────────────────────────────────────────────────
(async () => {
    console.log('\n🧪 Semilla E2E de TESTEO → ' + PROYECTO + (ESCRIBIR ? '  (ESCRIBE)' : '  (SIMULACIÓN: no escribe nada)'));
    await token();
    if (!fs.existsSync(FICHERO_CLAVE)) throw new Error('Falta la contraseña común de testeo (' + FICHERO_CLAVE + '): lanza antes semilla_testeo.js');
    const clave = fs.readFileSync(FICHERO_CLAVE, 'utf8').trim();
    console.log('Contraseña: la común de testeo (no se muestra)');

    // 1. Cuentas de Authentication
    const uids = {};
    const hay = await api(IDT + '/accounts:lookup', 'POST', { email: CUENTAS.map((c) => c.email) }).catch(() => ({ users: [] }));
    for (const c of CUENTAS) {
        const ya = (hay.users || []).find((u) => (u.email || '').toLowerCase() === c.email.toLowerCase());
        if (ya) { uids[c.cuenta] = ya.localId; console.log('  cuenta existente  ' + c.email); continue; }
        if (!ESCRIBIR) { uids[c.cuenta] = '(nuevo:' + c.cuenta + ')'; console.log('  se crearía        ' + c.email); continue; }
        const r = await api(IDT + '/accounts', 'POST', { email: c.email, password: clave, emailVerified: true, displayName: c.nombre });
        uids[c.cuenta] = r.localId; console.log('  cuenta creada     ' + c.email);
    }
    if (ESCRIBIR) {
        for (const c of CUENTAS) await api(IDT + '/accounts:update', 'POST', { localId: uids[c.cuenta], password: clave, emailVerified: true });
    }

    // 2. Documentos
    const ahora = new Date();
    const docs = [];
    for (const club of [NORTE, SUR]) {
        const admin = CUENTAS.find((c) => c.club === club && c.role === 'club_admin');
        docs.push(['clubs/' + club.id, { name: club.name, plan: 'free', status: 'active',
            slots: { users: 10, coordinators: 3, directors: 2, parents: 50 },
            usedSlots: { users: 0, coordinators: 0, directors: 0, parents: 0 },
            // Ausente = encendido, salvo los módulos «opt-in»: se encienden para
            // poder probar vídeos y estadísticas avanzadas.
            extras: { modulo_videos: true, modulo_stats_avanzadas: true },
            adminEmail: admin.email, adminUid: uids[admin.cuenta], createdAt: ahora.toISOString(),
            createdBySA: SA_EMAIL, _semillaE2E: true }]);
    }
    for (const c of CUENTAS) {
        docs.push(['users/' + uids[c.cuenta], docUsuario(c, ahora)]);
        for (const s of solicitudes(c, uids[c.cuenta], ahora)) docs.push(['platform_requests/' + s.id, s.datos]);
        if (PLANTILLA[c.cuenta]) {
            const { eq, raiz } = raizPlantilla(c);
            docs.push(['users/' + uids[c.cuenta] + '/cronos_data/main', { cronos_master_roster: JSON.stringify(raiz) }]);
            console.log('  plantilla ' + c.cuenta + ' → ' + eq + ' · ' + raiz.f7[0].id + '…' + raiz.f7[17].id);
        }
    }
    console.log('\nDocumentos: ' + docs.length);
    docs.forEach(([p]) => console.log('  ' + p));
    if (!ESCRIBIR) { console.log('\nSIMULACIÓN: no se ha escrito nada. Repite con --escribir.'); return; }

    const nombre = (p) => `projects/${PROYECTO}/databases/(default)/documents/${p}`;
    await api(FS + ':commit', 'POST', { writes: docs.map(([p, d]) => ({ update: { name: nombre(p), fields: campos(d) } })) });
    console.log('✅ ' + docs.length + ' documentos escritos (commit atómico)');

    // 3. Permisos (custom claims), como los pone setCustomClaims
    for (const c of CUENTAS) {
        await api(IDT + '/accounts:update', 'POST', { localId: uids[c.cuenta],
            customAttributes: JSON.stringify({ role: c.role, clubId: c.club.id, claimsSetAt: Date.now() }) });
    }
    console.log('✅ permisos asignados a ' + CUENTAS.length + ' cuentas');
})().catch((e) => { console.error('\n❌ ' + e.message); process.exit(1); });

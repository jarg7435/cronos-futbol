// ─────────────────────────────────────────────────────────────────────────
// test_live_stats_rules.js — v775
//
// COMPORTAMIENTO de las reglas de `live_stats/{matchId}` (estadísticas
// tácticas del directo: R/P y avanzadas), evaluadas EN EL SERVIDOR de Google
// con el método `:test` de la Rules API (sin emulador; ver
// scripts/test_sec_c3_live_matches_rules.js y la nota de referencia).
//
// El encargo (implementar.txt 2026-09-28, punto 3): el panel SOLO para
// entrenador, coordinador, director y admin del club; para una familia,
// «completamente oculto e INACCESIBLE». Aquí se prueba lo segundo: que la
// BASE DE DATOS se lo niega, no sólo la pantalla.
//
// ⚠️ Cada DENY lleva al lado un ALLOW que recorre la MISMA expresión: un
// lote de sólo DENY puede estar midiendo una regla averiada (pagado en v434
// y v633). Y `errorPosition` cuenta como fallo aunque el estado sea SUCCESS.
//
// Requiere sesión del CLI (`firebase login`); sin ella, SE SALTA con aviso.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROJECT = 'cronos-futbol-test';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};

// Buffers, no `d += chunk`: un carácter multibyte partido entre dos trozos se
// corrompe (trampa pagada en la fase A del testeo aislado).
function pide(url, method, headers, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method, headers }, res => {
            const b = []; res.on('data', c => b.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(b).toString('utf8') }));
        });
        req.on('error', reject); if (body) req.write(body); req.end();
    });
}
async function token() {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const body = new URLSearchParams({ refresh_token: cfg.tokens.refresh_token,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    const r = await pide('https://oauth2.googleapis.com/token', 'POST',
        { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, body);
    const j = JSON.parse(r.body);
    if (!j.access_token) throw new Error(r.body.slice(0, 200));
    return j.access_token;
}

function mocksUsuario(uid, data) {
    const p = `${DB}/users/${uid}`;
    return [
        { function: 'exists', args: [{ exactValue: p }], result: { value: data !== null } },
        { function: 'get', args: [{ exactValue: p }], result: { value: { data: data || {} } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
        // isClubAdminOf mira clubs/{id}: por defecto no hay administrador.
        { function: 'exists', args: [{ anyValue: {} }], result: { value: false } },
    ];
}

const CLUB = 'clubA', OTRO = 'clubB';
const COACH = 'coach_uid', COACH2 = 'coach2_uid', FAM = 'familia_uid', DIR = 'director_uid', AJENO = 'ajeno_uid';
const tok = (email, extra) => Object.assign({ email, firebase: { sign_in_provider: 'password' } }, extra || {});
const DOC = {
    matchId: 'M1', clubId: CLUB, createdBy: COACH, coachEmail: 'c@a.es', category: 'f11_regional', v: 1,
    pr:  { t: 1, items: [{ id: 'pr_1', kind: 'loss', playerId: '7', number: '7', name: 'NANO', matchTime: '1T 01:00', createdAt: 1 }] },
    sav: { t: 1, items: [{ id: 'sav_1', metrica: 'corners', tipo: 'favor', playerId: null, number: '', name: '', matchTime: '1T 02:00', createdAt: 2 }] },
    updatedAt: '2026-09-28T10:00:00Z', expireAt: '2026-09-29T22:00:00Z'
};
const RUTA = `${DB}/live_stats/M1`;
const U = {
    coach:  { clubId: CLUB, isAuthorized: true, role: 'user' },          // el entrenador es 'user'
    coach2: { clubId: CLUB, isAuthorized: true, role: 'user' },
    fam:    { clubId: CLUB, isAuthorized: true, role: 'parent',
              allRoles: [{ role: 'user', status: 'active', clubId: CLUB }] },   // allRoles FALSIFICADO
    dir:    { clubId: CLUB, isAuthorized: true, role: 'director' },
    ajeno:  { clubId: OTRO, isAuthorized: true, role: 'user' },
};
const T = '2026-09-28T10:00:00Z';

function casos() {
    const con = (extra) => Object.assign({}, DOC, extra || {});
    return [
        // ── LECTURA ──────────────────────────────────────────────────────
        { n: 'L1 · el ENTRENADOR del club (rol «user») LEE', exp: 'ALLOW',
          req: { auth: { uid: COACH2, token: tok('c2@a.es') }, path: RUTA, method: 'get', time: T },
          mocks: mocksUsuario(COACH2, U.coach2), existing: DOC },
        { n: 'L2 · el DIRECTOR del club LEE', exp: 'ALLOW',
          req: { auth: { uid: DIR, token: tok('d@a.es') }, path: RUTA, method: 'get', time: T },
          mocks: mocksUsuario(DIR, U.dir), existing: DOC },
        { n: 'L3 · una FAMILIA del mismo club NO lee (aunque se ponga una plaza de entrenador en allRoles)', exp: 'DENY',
          req: { auth: { uid: FAM, token: tok('f@a.es') }, path: RUTA, method: 'get', time: T },
          mocks: mocksUsuario(FAM, U.fam), existing: DOC },
        { n: 'L4 · un entrenador de OTRO club NO lee', exp: 'DENY',
          req: { auth: { uid: AJENO, token: tok('x@b.es') }, path: RUTA, method: 'get', time: T },
          mocks: mocksUsuario(AJENO, U.ajeno), existing: DOC },
        { n: 'L5 · el autor del partido LEE (aunque su raíz no sea técnica)', exp: 'ALLOW',
          req: { auth: { uid: COACH, token: tok('c@a.es') }, path: RUTA, method: 'get', time: T },
          mocks: mocksUsuario(COACH, { clubId: CLUB, isAuthorized: true, role: 'parent' }), existing: DOC },
        { n: 'L6 · un usuario NO autorizado no lee', exp: 'DENY',
          req: { auth: { uid: DIR, token: tok('d@a.es') }, path: RUTA, method: 'get', time: T },
          mocks: mocksUsuario(DIR, { clubId: CLUB, isAuthorized: false, role: 'director' }), existing: DOC },

        // ── CREAR ────────────────────────────────────────────────────────
        { n: 'C1 · el entrenador CREA el documento de su partido', exp: 'ALLOW',
          req: { auth: { uid: COACH, token: tok('c@a.es') }, path: RUTA, method: 'create', time: T,
                 resource: { data: DOC } },
          mocks: mocksUsuario(COACH, U.coach) },
        { n: 'C2 · una FAMILIA no puede sembrar estadísticas (aun poniéndose de autora)', exp: 'DENY',
          req: { auth: { uid: FAM, token: tok('f@a.es') }, path: RUTA, method: 'create', time: T,
                 resource: { data: con({ createdBy: FAM }) } },
          mocks: mocksUsuario(FAM, U.fam) },
        { n: 'C3 · nadie crea a nombre de OTRO autor', exp: 'DENY',
          req: { auth: { uid: COACH2, token: tok('c2@a.es') }, path: RUTA, method: 'create', time: T,
                 resource: { data: DOC } },
          mocks: mocksUsuario(COACH2, U.coach2) },
        { n: 'C4 · un entrenador de otro club no crea en ESTE club', exp: 'DENY',
          req: { auth: { uid: AJENO, token: tok('x@b.es') }, path: RUTA, method: 'create', time: T,
                 resource: { data: con({ createdBy: AJENO }) } },
          mocks: mocksUsuario(AJENO, U.ajeno) },
        { n: 'C5 · campos libres fuera de la forma se rechazan', exp: 'DENY',
          req: { auth: { uid: COACH, token: tok('c@a.es') }, path: RUTA, method: 'create', time: T,
                 resource: { data: con({ basura: 'x' }) } },
          mocks: mocksUsuario(COACH, U.coach) },
        { n: 'C6 · entrenador SIN club crea el suyo (createdBy propio)', exp: 'ALLOW',
          req: { auth: { uid: COACH, token: tok('c@a.es') }, path: RUTA, method: 'create', time: T,
                 resource: { data: con({ clubId: null }) } },
          mocks: mocksUsuario(COACH, { isAuthorized: true, role: 'user' }) },

        // ── ACTUALIZAR (el iPad del mismo entrenador, otro técnico) ─────
        { n: 'U1 · el autor ACTUALIZA desde otro aparato', exp: 'ALLOW',
          req: { auth: { uid: COACH, token: tok('c@a.es') }, path: RUTA, method: 'update', time: T,
                 resource: { data: con({ pr: { t: 2, items: [] } }) } },
          mocks: mocksUsuario(COACH, U.coach), existing: DOC },
        { n: 'U2 · otro técnico del club actualiza respetando el autor', exp: 'ALLOW',
          req: { auth: { uid: COACH2, token: tok('c2@a.es') }, path: RUTA, method: 'update', time: T,
                 resource: { data: con({ sav: { t: 3, items: [] } }) } },
          mocks: mocksUsuario(COACH2, U.coach2), existing: DOC },
        { n: 'U3 · pero NO puede quedarse con la autoría', exp: 'DENY',
          req: { auth: { uid: COACH2, token: tok('c2@a.es') }, path: RUTA, method: 'update', time: T,
                 resource: { data: con({ createdBy: COACH2 }) } },
          mocks: mocksUsuario(COACH2, U.coach2), existing: DOC },
        { n: 'U4 · ni mover el documento a otro club', exp: 'DENY',
          req: { auth: { uid: COACH, token: tok('c@a.es') }, path: RUTA, method: 'update', time: T,
                 resource: { data: con({ clubId: OTRO }) } },
          mocks: mocksUsuario(COACH, U.coach), existing: DOC },
        { n: 'U5 · una FAMILIA no actualiza', exp: 'DENY',
          req: { auth: { uid: FAM, token: tok('f@a.es') }, path: RUTA, method: 'update', time: T,
                 resource: { data: con({ pr: { t: 9, items: [] } }) } },
          mocks: mocksUsuario(FAM, U.fam), existing: DOC },

        // ── BORRAR ───────────────────────────────────────────────────────
        { n: 'D1 · el autor BORRA', exp: 'ALLOW',
          req: { auth: { uid: COACH, token: tok('c@a.es') }, path: RUTA, method: 'delete', time: T },
          mocks: mocksUsuario(COACH, U.coach), existing: DOC },
        { n: 'D2 · otro técnico no borra', exp: 'DENY',
          req: { auth: { uid: COACH2, token: tok('c2@a.es') }, path: RUTA, method: 'delete', time: T },
          mocks: mocksUsuario(COACH2, U.coach2), existing: DOC },
    ];
}

(async () => {
    console.log('── v775 · reglas de live_stats (sólo cuerpo técnico) ──\n');
    let tk;
    try { tk = await token(); }
    catch (e) {
        console.log('SKIP · sin sesión del CLI de Firebase (ejecuta `firebase login`).');
        console.log('       ' + e.message);
        process.exit(0);
    }
    const reglas = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    ok('0 · el bloque `match /live_stats/{matchId}` existe', /match \/live_stats\/\{matchId\}/.test(reglas));

    const cs = casos();
    const testCases = cs.map(c => {
        const tc = { expectation: c.exp, request: c.req, functionMocks: c.mocks, pathEncoding: 'PLAIN' };
        if (c.existing) tc.resource = { data: c.existing };
        return tc;
    });
    const cuerpo = JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: reglas }] },
                                    testSuite: { testCases } });
    const r = await pide(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, 'POST',
        { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) }, cuerpo);
    if (r.status !== 200) {
        ok('0b · la Rules API responde 200', false, { status: r.status, body: r.body.slice(0, 500) });
        console.log('\nResultado: ' + pass + '/' + (pass + fail) + '  ❌');
        process.exit(1);
    }
    const res = JSON.parse(r.body);
    (res.testResults || []).forEach((t, i) => {
        // En los ALLOW, un error de evaluación sería un fallo real. En los
        // DENY, un error en una rama de un OR no cambia el resultado (medido
        // en v437); se informa pero sólo cuenta como fallo si NO es SUCCESS.
        const bien = t.state === 'SUCCESS' && (cs[i].exp === 'DENY' || !t.errorPosition);
        ok(cs[i].n + '  [espera ' + cs[i].exp + ']', bien, { estado: t.state, error: t.errorPosition, dbg: t.debugMessages });
    });
    ok('1z · se evaluaron los ' + cs.length + ' casos', (res.testResults || []).length === cs.length);
    console.log('\nResultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

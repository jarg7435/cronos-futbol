// ─────────────────────────────────────────────────────────────────────────
// test_asistencia_rules.js · COMPORTAMIENTO de las reglas de asistencia
//
// No comprueba que compilen: comprueba QUÉ PERMITEN. Usa el método `:test` de
// la Firebase Rules REST API, que evalúa las reglas en el servidor de Google
// sin emulador ni JDK (ver reference: la máquina tiene Java 1.8).
//
// LO QUE ESTÁ EN JUEGO. El documento clubs/{club}/attendance/{equipo}__{mes}
// contiene las FALTAS DE LOS 25 JUGADORES con su causa, y las reglas de
// Firestore no saben conceder lectura "sólo de la clave ALC07": o se lee
// entero o no se lee. Un padre del club lleva el MISMO claim `clubId` que un
// entrenador, así que el predicado que usa team_rosters —sameClubAsDoc a
// secas— le habría abierto el parte completo del equipo. De ahí que este
// fichero exista.
//
//  A · el ENTRENADOR (users/{uid}.role == 'user', que es lo que tienen los
//      entrenadores reales — verificado contra producción) lee y escribe.
//  B · 🔑 el PADRE del mismo club NO lee el documento del equipo.
//  C · 🔑 el PADRE SÍ lee su extracto, y NO el de otro niño.
//  D · el DIRECTOR y el COORDINADOR leen (seguimiento de todas las
//      categorías, que es el requisito del autor).
//  E · alguien de OTRO club no toca nada.
//
// ⚠️ `request.time` se pasa SIEMPRE. Sin él, cualquier expresión temporal
// lanza, y como un error equivale a DENY, los casos DENY saldrían verdes por
// el motivo equivocado.
// ⚠️ `errorPosition` se trata como FALLO aunque el state sea SUCCESS: es la
// única forma de distinguir "la regla denegó" de "la regla se averió".
// ⚠️ El cuerpo HTTP se acumula en Buffers: con `d += chunk` se corrompen los
// multibyte partidos entre chunks.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs    = require('fs');
const https = require('https');
const os    = require('os');
const path  = require('path');

const ROOT    = path.join(__dirname, '..');
const PROJECT = 'cronos-futbol-app';
const CONFIG  = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB      = '/databases/(default)/documents';
const AHORA   = '2026-08-13T18:00:00Z';

let fail = 0, pass = 0;
const ok = (n, c, x) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (x !== undefined) console.log('       ' + JSON.stringify(x).slice(0, 400)); }
};

function getAccessToken(rt) {
    const body = new URLSearchParams({ refresh_token: rt,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    return new Promise((res, rej) => {
        const r = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            x => { const b = []; x.on('data', c => b.push(c));
                   x.on('end', () => { try { const j = JSON.parse(Buffer.concat(b).toString('utf8'));
                       j.access_token ? res(j.access_token) : rej(new Error('sin token')); } catch (e) { rej(e); } }); });
        r.on('error', rej); r.write(body); r.end();
    });
}

function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((res, rej) => {
        const r = https.request(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            x => { const b = []; x.on('data', c => b.push(c));
                   x.on('end', () => res({ status: x.statusCode, body: Buffer.concat(b).toString('utf8') })); });
        r.on('error', rej); r.write(body); r.end();
    });
}

const CLUB = 'club_test';
const EQUIPO = 'club-test__alevin__c';
const DOC_MES = `${EQUIPO}__2026-08`;

// Los entrenadores REALES tienen role 'user'; el rol de entrenador vive en
// allRoles. Es justo lo que hacía inservible una lista blanca con 'coach'.
const U_COACH  = { uid: 'uid_coach',  rol: 'user' };
const U_PADRE  = { uid: 'uid_padre',  rol: 'parent' };
const U_DIR    = { uid: 'uid_dir',    rol: 'director' };
const U_COORD  = { uid: 'uid_coord',  rol: 'coordinator' };
const U_FUERA  = { uid: 'uid_fuera',  rol: 'user' };

// ⚠️ El correo se puede fijar por caso: hace falta para demostrar que
// coincidir con el adminEmail del club NO concede nada.
const auth = (u, clubId, email) => ({ uid: u.uid,
    token: { email: email || (u.uid + '@x.es'), clubId: clubId,
             firebase: { sign_in_provider: 'password' } } });

// opts = { inactivo, adminEmailDelClub }
const mocks = (u, clubId, opts) => (opts = opts || {}) && [
    { function: 'exists', args: [{ exactValue: `${DB}/users/${u.uid}` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/users/${u.uid}` }],
      result: { value: { data: { role: u.rol, clubId: clubId, isAuthorized: true,
                                 status: opts.inactivo ? 'removed' : 'active' } } } },
    { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
    { function: 'get',    args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
    // El club existe pero su admin es otro: así isClubAdminOf() no concede
    // por la puerta de atrás y se prueba de verdad el predicado nuevo.
    { function: 'exists', args: [{ exactValue: `${DB}/clubs/${CLUB}` }], result: { value: true } },
    { function: 'get',    args: [{ exactValue: `${DB}/clubs/${CLUB}` }],
      result: { value: { data: { adminUid: 'otro_admin',
                                 adminEmail: opts.adminEmailDelClub || 'admin@otro.es' } } } },
];

const docEquipo = { clubId: CLUB, teamId: EQUIPO, month: '2026-08',
                    category: 'alevin', subcategory: 'C',
                    marks: { '2026-08-13': { ALC01: { s: 'P' } } }, sessions: {} };

const docHijo  = { clubId: CLUB, teamId: EQUIPO, ficha: 'ALC01', dorsal: '1',
                   parentUids: [U_PADRE.uid], days: { '2026-08-13': { s: 'P', t: 'entrenamiento' } } };
const docAjeno = { clubId: CLUB, teamId: EQUIPO, ficha: 'ALC09', dorsal: '9',
                   parentUids: ['otro_padre_uid'], days: { '2026-08-13': { s: 'I', t: 'entrenamiento' } } };

const P_EQUIPO = `${DB}/clubs/${CLUB}/attendance/${DOC_MES}`;
const P_HIJO   = `${DB}/clubs/${CLUB}/attendance_players/${EQUIPO}__ALC01`;
const P_AJENO  = `${DB}/clubs/${CLUB}/attendance_players/${EQUIPO}__ALC09`;

const CASOS = [
    // ── A · EL ENTRENADOR ────────────────────────────────────────────
    { n: 'A1 · el ENTRENADOR (role=user) LEE el parte de su equipo', exp: 'ALLOW',
      u: U_COACH, club: CLUB, path: P_EQUIPO, method: 'get', existing: docEquipo },
    { n: 'A2 · el ENTRENADOR ESCRIBE una marca', exp: 'ALLOW',
      u: U_COACH, club: CLUB, path: P_EQUIPO, method: 'update',
      existing: docEquipo, entrante: Object.assign({}, docEquipo, { marks: { '2026-08-13': { ALC01: { s: 'I' } } } }) },
    { n: 'A3 · el ENTRENADOR crea el documento del mes', exp: 'ALLOW',
      u: U_COACH, club: CLUB, path: P_EQUIPO, method: 'create', entrante: docEquipo },
    { n: 'A4 · el ENTRENADOR publica el extracto del jugador', exp: 'ALLOW',
      u: U_COACH, club: CLUB, path: P_HIJO, method: 'create', entrante: docHijo },

    // ── B · EL PADRE NO VE EL PARTE DEL EQUIPO ───────────────────────
    { n: 'B1 · 🔑 el PADRE del club NO lee el parte del equipo', exp: 'DENY',
      u: U_PADRE, club: CLUB, path: P_EQUIPO, method: 'get', existing: docEquipo },
    { n: 'B2 · 🔑 y tampoco lo escribe', exp: 'DENY',
      u: U_PADRE, club: CLUB, path: P_EQUIPO, method: 'update',
      existing: docEquipo, entrante: docEquipo },

    // ── C · EL PADRE Y SU EXTRACTO ───────────────────────────────────
    { n: 'C1 · 🔑 el PADRE lee el extracto de SU hijo', exp: 'ALLOW',
      u: U_PADRE, club: CLUB, path: P_HIJO, method: 'get', existing: docHijo },
    { n: 'C2 · 🔑 el PADRE NO lee el extracto de OTRO niño', exp: 'DENY',
      u: U_PADRE, club: CLUB, path: P_AJENO, method: 'get', existing: docAjeno },
    { n: 'C3 · ⚠️ el PADRE no puede FALSEAR la asistencia de su hijo', exp: 'DENY',
      u: U_PADRE, club: CLUB, path: P_HIJO, method: 'update',
      existing: docHijo, entrante: Object.assign({}, docHijo, { days: { '2026-08-13': { s: 'P' } } }) },
    { n: 'C4 · ⚠️ ni añadirse a los parentUids de otro niño', exp: 'DENY',
      u: U_PADRE, club: CLUB, path: P_AJENO, method: 'update',
      existing: docAjeno, entrante: Object.assign({}, docAjeno, { parentUids: [U_PADRE.uid] }) },

    // ── D · DIRECCIÓN VE TODAS LAS CATEGORÍAS ────────────────────────
    { n: 'D1 · el DIRECTOR lee el parte de cualquier equipo del club', exp: 'ALLOW',
      u: U_DIR, club: CLUB, path: P_EQUIPO, method: 'get', existing: docEquipo },
    { n: 'D2 · el COORDINADOR también', exp: 'ALLOW',
      u: U_COORD, club: CLUB, path: P_EQUIPO, method: 'get', existing: docEquipo },

    // ── E · OTRO CLUB, NADA ──────────────────────────────────────────
    { n: 'E1 · ⚠️ un entrenador de OTRO club NO lee este parte', exp: 'DENY',
      u: U_FUERA, club: 'club_ajeno', path: P_EQUIPO, method: 'get', existing: docEquipo },
    { n: 'E2 · ⚠️ ni escribe en él', exp: 'DENY',
      u: U_FUERA, club: 'club_ajeno', path: P_EQUIPO, method: 'update',
      existing: docEquipo, entrante: docEquipo },
    { n: 'E3 · ⚠️ ni lee el extracto de un niño de este club', exp: 'DENY',
      u: U_FUERA, club: 'club_ajeno', path: P_HIJO, method: 'get', existing: docHijo },

    // ── P · BORRAR UN INFORME COLECTIVO: SÓLO EL DIRECTOR ────────────
    // Regla del autor (2026-08-13): entrenador y coordinador OCULTAN; la
    // purga física, que descuenta del acumulado, es del Director Deportivo.
    // ⚠️ Estas cuatro retiran permisos que ANTES existían: el coordinador
    // entraba por isTechStaffByDoc() y el entrenador autor por coachUid.
    { n: 'P1 · 🔑 el DIRECTOR borra el informe colectivo', exp: 'ALLOW',
      u: U_DIR, club: CLUB, path: `${DB}/cronos_player_reports/R1`, method: 'delete',
      existing: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach', type: 'staff_match_report' } },
    { n: 'P2 · 🔑🔑 el COORDINADOR ya NO puede borrarlo', exp: 'DENY',
      u: U_COORD, club: CLUB, path: `${DB}/cronos_player_reports/R1`, method: 'delete',
      existing: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach', type: 'staff_match_report' } },
    { n: 'P3 · 🔑🔑 el ENTRENADOR AUTOR tampoco, aunque sea suyo', exp: 'DENY',
      u: U_COACH, club: CLUB, path: `${DB}/cronos_player_reports/R1`, method: 'delete',
      existing: { clubId: CLUB, staffReport: true, coachUid: U_COACH.uid, type: 'staff_match_report' } },
    { n: 'P4 · ⚠️ un director de OTRO club no toca este informe', exp: 'DENY',
      u: U_DIR, club: 'club_ajeno', path: `${DB}/cronos_player_reports/R1`, method: 'delete',
      existing: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach', type: 'staff_match_report' } },
    // El entrenador conserva sus copias NO colectivas: sólo se le retiró el
    // informe compartido, no su propio material.
    { n: 'P5 · el ENTRENADOR sí borra su copia NO colectiva', exp: 'ALLOW',
      u: U_COACH, club: CLUB, path: `${DB}/cronos_player_reports/R2`, method: 'delete',
      existing: { clubId: CLUB, staffReport: false, _forCoach: true, coachUid: U_COACH.uid } },
    // Y ocultar sigue estando abierto para todos: es lo que se les ofrece.
    // ── R · POR ROL, NUNCA POR IDENTIDAD ─────────────────────────────
    // El escenario que describe el autor: la MISMA persona física que hoy es
    // director y mañana es sólo coordinador. Mismo uid, mismo correo, misma
    // cuenta: lo único que cambia es el cargo, y con él la potestad.
    { n: 'R1 · 🔑🔑 MISMA persona, ahora COORDINADOR: pierde el borrado', exp: 'DENY',
      u: { uid: 'uid_mismo', rol: 'coordinator' }, club: CLUB,
      path: `${DB}/cronos_player_reports/R1`, method: 'delete',
      existing: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach' } },
    { n: 'R2 · y la MISMA persona siendo DIRECTOR sí puede', exp: 'ALLOW',
      u: { uid: 'uid_mismo', rol: 'director' }, club: CLUB,
      path: `${DB}/cronos_player_reports/R1`, method: 'delete',
      existing: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach' } },
    { n: 'R3 · el ADMINISTRADOR DEL CLUB también (por rol, no por correo)', exp: 'ALLOW',
      u: { uid: 'uid_admin', rol: 'club_admin' }, club: CLUB,
      path: `${DB}/cronos_player_reports/R1`, method: 'delete',
      existing: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach' } },
    // ⚠️ EL CASO QUE CIERRA LA PUERTA DEL CORREO: este uid es el adminEmail
    // registrado en clubs/{id}, pero su cargo actual es COORDINADOR. Con la
    // rama isClubAdminOf que había antes, habría podido borrar.
    { n: 'R4 · 🔑🔑🔑 coincidir con el adminEmail del club NO da potestad', exp: 'DENY',
      u: { uid: 'uid_exdirector', rol: 'coordinator' }, club: CLUB,
      email: 'admin@club.es', adminEmailDelClub: 'admin@club.es',
      path: `${DB}/cronos_player_reports/R1`, method: 'delete',
      existing: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach' } },
    { n: 'R5 · ⚠️ un director DADO DE BAJA no destruye datos', exp: 'DENY',
      u: { uid: 'uid_baja', rol: 'director' }, club: CLUB, inactivo: true,
      path: `${DB}/cronos_player_reports/R1`, method: 'delete',
      existing: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach' } },

    { n: 'P6 · 🔑 el COORDINADOR sigue pudiendo OCULTAR (dismissedByStaff)', exp: 'ALLOW',
      u: U_COORD, club: CLUB, path: `${DB}/cronos_player_reports/R1`, method: 'update',
      existing: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach',
                  staffUids: [U_COORD.uid], dismissedByStaff: [] },
      entrante: { clubId: CLUB, staffReport: true, coachUid: 'uid_coach',
                  staffUids: [U_COORD.uid], dismissedByStaff: [U_COORD.uid] } },
];

(async () => {
    let rt;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        rt = cfg.tokens?.refresh_token || cfg.user?.tokens?.refresh_token;
    } catch (e) { rt = null; }
    if (!rt) {
        // Igual que los otros tests de reglas: se salta con aviso para no
        // tumbar CI en una máquina sin sesión del CLI.
        console.log('SKIP · sin sesión de firebase-tools; no se pueden probar las reglas contra el servidor.');
        process.exit(0);
    }

    let token;
    try { token = await getAccessToken(rt); }
    catch (e) { console.log('SKIP · no se pudo renovar el token: ' + e.message); process.exit(0); }

    const source = { files: [{ name: 'firestore.rules',
                               content: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }] };

    const testCases = CASOS.map(c => {
        const req = { auth: auth(c.u, c.club, c.email), path: c.path, method: c.method, time: AHORA };
        if (c.entrante) req.resource = { data: c.entrante };
        const tc = { expectation: c.exp, request: req, pathEncoding: 'PLAIN',
                     functionMocks: mocks(c.u, c.club,
                        { inactivo: c.inactivo, adminEmailDelClub: c.adminEmailDelClub }) };
        if (c.existing) tc.resource = { data: c.existing };
        return tc;
    });

    const url = 'https://firebaserules.googleapis.com/v1/projects/' + PROJECT + ':test';
    let r = await post(url, token, { source, testSuite: { testCases } });

    // El servicio devuelve internal_failure transitorio de vez en cuando:
    // se reintenta antes de culpar al cambio.
    let j = JSON.parse(r.body);
    for (let intento = 0; intento < 3 && (r.status !== 200 || !j.testResults); intento++) {
        await new Promise(s => setTimeout(s, 1500));
        r = await post(url, token, { source, testSuite: { testCases } });
        j = JSON.parse(r.body);
    }
    if (r.status !== 200 || !j.testResults) {
        console.log('FALLO al invocar :test — status ' + r.status);
        console.log(r.body.slice(0, 800));
        process.exit(1);
    }

    j.testResults.forEach((res, i) => {
        const c = CASOS[i];
        const errores = res.errorPosition ? 1 : 0;
        // ⚠️ Un caso DENY sale SUCCESS tanto si la regla denegó como si se
        // averió. errorPosition distingue las dos cosas.
        ok(c.n, res.state === 'SUCCESS' && !errores,
           { state: res.state, errorPosition: res.errorPosition, debug: (res.debugMessages || []).slice(0, 2) });
    });

    console.log('\n' + (fail === 0 ? 'OK' : 'FALLOS') + ': ' + pass + ' pass, ' + fail + ' fail');
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('EXCEPCIÓN:', e && e.stack || e); process.exit(1); });

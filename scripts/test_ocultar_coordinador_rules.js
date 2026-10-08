// ─────────────────────────────────────────────────────────────────────────
//  test_ocultar_coordinador_rules.js  ·  🎯 v787 · COMPORTAMIENTO REAL
//
//  Encargo del autor (implementar.txt 2026-10-08, capturas 11238-11242): el
//  Coordinador está supeditado al Director Deportivo. Puede OCULTAR informes
//  de su panel —añadiendo su clave `{uid}_coordinator` a
//  `hiddenByCoordinators`— pero no borrarlos ni alterar su contenido.
//
//  Se le pide a la Rules API de Google que EVALÚE cada caso contra el
//  firestore.rules del repo (mismo arnés que test_sec_r01_rules.js, con sus
//  dos trampas ya pagadas: `request.time` aportado y un ALLOW en cada lote de
//  DENY). Se evalúa en el proyecto de TESTEO: la API sólo compila y evalúa el
//  fuente enviado con datos de mentira, no lee ni escribe ninguna base.
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
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 500)); }
};

function getAccessToken(refreshToken) {
    const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
    const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
    const body = new URLSearchParams({
        refresh_token: refreshToken, client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET, grant_type: 'refresh_token',
    }).toString();
    return new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); } catch (e) { reject(new Error(d.slice(0, 200))); } });
        });
        req.on('error', reject); req.write(body); req.end();
    });
}

function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: {
            Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body) } },
            res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
        req.on('error', reject); req.write(body); req.end();
    });
}

function mocksUsuario(uid, data, emailsSA) {
    const p = `${DB}/users/${uid}`;
    return [
        { function: 'exists', args: [{ exactValue: p }], result: { value: data !== null } },
        { function: 'get', args: [{ exactValue: p }], result: { value: { data: data || {} } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }],
          result: { value: { data: { emails: emailsSA || [] } } } },
    ];
}

// ── Los personajes ──────────────────────────────────────────────────
// El COORDINADOR del club A: cuenta multi-rol (raíz club_admin, plaza de
// coordinador en allRoles), como la de CD DÍA. Sin claim de club en el token,
// para que no entre por `sameClubAsDoc` ni por la rama general de miembros.
const COORD = 'coord_uid';
const DOC_COORD = { clubId: 'clubOtro', isAuthorized: true, status: 'active', role: 'coach',
                    allRoles: [{ role: 'coordinator', clubId: 'clubA' }] };
const AUTH_COORD = { uid: COORD, token: { email: 'coord@a.es', firebase: { sign_in_provider: 'password' } } };
const OTRO = 'otro_coord_uid';

const INFORME = { clubId: 'clubA', staffReport: true, staffUids: ['director_uid'],
                  matchId: 'M1', playerNumber: '5', goals: 2 };
const CON_OTRO = { ...INFORME, hiddenByCoordinators: [OTRO + '_coordinator'] };
const P_REP = `${DB}/cronos_player_reports/M1_staff_p5`;

function casos() {
    const upd = (data, existing, n, exp, nota) => ({
        n, exp, nota, existing,
        req: { auth: AUTH_COORD, path: P_REP, method: 'update', resource: { data } },
        mocks: mocksUsuario(COORD, DOC_COORD),
    });
    return [
        upd({ ...INFORME, hiddenByCoordinators: [COORD + '_coordinator'] }, INFORME,
            '1a · 🔑 el COORDINADOR se oculta el informe con SU clave (antes: permission-denied)',
            'ALLOW', 'es la función que el encargo pide y la que sostiene el lote'),
        upd({ ...CON_OTRO, hiddenByCoordinators: [OTRO + '_coordinator', COORD + '_coordinator'] }, CON_OTRO,
            '1b · y se añade aunque otro coordinador ya lo tuviera oculto',
            'ALLOW', 'la lista crece; lo ajeno se conserva'),
        upd({ ...CON_OTRO, hiddenByCoordinators: [] }, CON_OTRO,
            '1c · 🔑 NO puede deshacer la ocultación de otro coordinador',
            'DENY', 'hasAll: la lista sólo crece'),
        upd({ ...INFORME, hiddenByCoordinators: [OTRO + '_coordinator'] }, INFORME,
            '1d · 🔑 NO puede ocultárselo a otro',
            'DENY', 'hasOnly: sólo su propia clave'),
        upd({ ...INFORME, hiddenByCoordinators: ['director_uid_director'] }, INFORME,
            '1e · 🔑 ni meter la clave del Director en su campo',
            'DENY', 'jerarquía: no toca la vista de la dirección'),
        upd({ ...INFORME, hiddenByCoordinators: [COORD + '_director'] }, INFORME,
            '1f · ni ocultar con su clave de OTRA plaza (director)',
            'DENY', 'el campo es sólo de la plaza de coordinador'),
        upd({ ...INFORME, hiddenByCoordinators: [COORD + '_coordinator'], goals: 0 }, INFORME,
            '1g · 🔑🔑 NO puede alterar el informe aprovechando la ocultación',
            'DENY', 'affectedKeys().hasOnly([hiddenByCoordinators])'),
        upd({ ...INFORME, dismissedBy: [COORD + '_coordinator'] }, INFORME,
            '1h · y dismissedBy sigue sin ser suyo (ni staffUids ni claim de club)',
            'DENY', 'es la escritura que fallaba en las capturas: el campo correcto es el suyo'),
        { n: '1i · 🔑🔑 y NO puede BORRAR el informe colectivo',
          exp: 'DENY', existing: INFORME,
          req: { auth: AUTH_COORD, path: P_REP, method: 'delete' },
          mocks: mocksUsuario(COORD, DOC_COORD),
          nota: 'la purga es exclusiva del Director Deportivo / administrador del club' },
    ];
}


(async () => {
    console.log('\n── 🔒 v787 · el Coordinador oculta, no borra: comportamiento real de las reglas ──\n');

    let token;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        token = await getAccessToken(cfg.tokens.refresh_token);
    } catch (e) {
        console.log('SKIP · sin sesion del CLI de Firebase (ejecuta `firebase login`).');
        console.log('       ' + e.message);
        process.exit(0);
    }
    ok('0a · sesion del CLI valida (access_token obtenido)', !!token);

    const source = { files: [{ name: 'firestore.rules',
        content: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }] };

    const cs = casos();
    const testCases = cs.map(c => {
        const tc = { expectation: c.exp,
                     request: { time: new Date().toISOString(), ...c.req },
                     functionMocks: c.mocks || [], pathEncoding: 'PLAIN' };
        if (c.existing) tc.resource = { data: c.existing };
        return tc;
    });

    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
        token, { source, testSuite: { testCases } });

    if (r.status !== 200) {
        ok('0b · la Rules API responde 200', false, { status: r.status, body: r.body.slice(0, 500) });
        console.log('\nResultado: ' + pass + '/' + (pass + fail) + '  ❌');
        process.exit(1);
    }
    ok('0b · la Rules API responde 200', true);

    const res = JSON.parse(r.body);
    const graves = (res.issues || []).filter(i => i.severity === 'ERROR');
    ok('0c · las reglas COMPILAN sin errores', graves.length === 0, graves);

    const errores = (res.testResults || []).flatMap((t, i) =>
        (t.errorPosition ? [`${cs[i].n}: ${JSON.stringify(t.errorPosition)}`] : []));
    ok('0d · 🔑 ninguna evaluacion se AVERIO (un error denegaria y saldria verde)',
       errores.length === 0, errores);

    (res.testResults || []).forEach((t, i) => {
        ok(cs[i].n + '  [espera ' + cs[i].exp + ']', t.state === 'SUCCESS', {
            estado: t.state,
            porque: cs[i].nota,
            nota: t.state === 'FAILURE' ? 'la regla NO se comporto como se esperaba' : t.debugMessages,
        });
    });

    ok('zz · se evaluaron los ' + cs.length + ' casos',
       (res.testResults || []).length === cs.length, (res.testResults || []).length);

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

// ─────────────────────────────────────────────────────────────────────────
// test_reports_control.js · CONTROL POR ROL DE LOS INFORMES (v435)
//
// Criterio del autor, literal:
//   1. Los informes son PURAMENTE DEPORTIVOS: analizan lo ocurrido en el campo
//      y no llevan datos personales sensibles.
//   2. COLECTIVOS: accesibles y gestionados por Director Deportivo,
//      Coordinador y Entrenador.
//   3. INDIVIDUALES: el padre tiene CONTROL TOTAL desde su panel para
//      descargar y borrar los informes de su hijo.
//   4. El SuperAdmin puede vaciar la informacion o borrar el club al terminar
//      la temporada.
//
// ⚠️ ESTO NO ES LA INMUTABILIDAD DE v434 Y NO HAY QUE CONFUNDIRLOS. Un partido
// terminado se congela a las 2 h; un informe NO. Son dos cosas distintas que
// conviven en el mismo listado de "Partidos Terminados", y el error facil es
// aplicarle a una el criterio de la otra — que es justo lo que hacia v434,
// donde las fichas de informe salian marcadas 🔒 CERRADO y sin botones.
//
// La PARTE 3 evalua firestore.rules EN EL SERVIDOR de Google. Es la que
// importa: lo demas es interfaz y se salta desde la consola.
// ⚠️ `request.time` hay que pasarlo explicitamente en cada testCase; sin el,
// toda expresion que lo use LANZA y un error equivale a DENY, con lo que los
// casos DENY salen verdes por el motivo equivocado. Ver v434.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const PROJECT = 'cronos-futbol-app';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const PANEL = fs.readFileSync(path.join(ROOT, 'js/parent/panel.js'), 'utf8');
const FTAB  = fs.readFileSync(path.join(ROOT, 'js/coach/reports/finished-matches-tab.js'), 'utf8');
const INIT  = fs.readFileSync(path.join(ROOT, 'js/core/app-init.js'), 'utf8');
const DELC  = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/delete-club.js'), 'utf8');

// Aserciones negativas SOLO contra codigo. `split(/\r?\n/)` y no `split('\n')`:
// el `.` de una regex NO casa `\r`, asi que en un fichero CRLF no se borraria
// ni un comentario (trampa pagada en v434).
const sinComs = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

const PANELc = sinComs(PANEL);
const FTABc  = sinComs(FTAB);
const INITc  = sinComs(INIT);
const DELCc  = sinComs(DELC);

console.log('── control por rol de los informes (v435) ──');

// ═══════════ PARTE 1 · el panel del padre ═══════════
console.log('\n── PARTE 1 · el padre tiene control total (punto 3) ──');
{
    ok('1a · existe la descarga del informe',
       /window\._ppDownloadReport = /.test(PANELc),
       'el criterio pide "descargar y borrar" y la descarga NO existia');
    ok('1b · y su boton esta en la tarjeta',
       /_ppDownloadReport\('\$\{_esc\(r\._id\|\|''\)\}'\)/.test(PANEL));
    ok('1c · genera un fichero de texto descargable',
       /new Blob\(\[.{0,4}' \+ L\.join\('\\r\\n'\)\]|new Blob\(/.test(PANELc) &&
       /a\.download = /.test(PANELc));
    ok('1d · con BOM, o el Bloc de notas rompe los acentos',
       /new Blob\(\['\\ufeff'|new Blob\(\['﻿'/.test(PANEL) || PANEL.includes("new Blob(['﻿"),
       'mismo criterio que miDescargarInforme');
    ok('1e · el <a> se adjunta al DOM antes del click',
       /document\.body\.appendChild\(a\);[\s\S]{0,40}a\.click\(\)/.test(PANELc),
       'un click suelto no dispara la descarga en Firefox');
    ok('1f · el registro por id existe, porque el onclick solo pasa el id',
       /window\._ppReportsById/.test(PANELc));

    ok('1g · [PUNTO 3] el borrado del padre es FISICO, no "ocultar"',
       /window\._ppDeleteReport = async[\s\S]{0,400}deleteDoc\(/.test(PANELc),
       'antes hacia soft delete con dismissedBy y solo caia a borrado si fallaba');
    ok('1h · y el soft delete queda como ULTIMO recurso, no como via principal',
       PANELc.indexOf('deleteDoc(dRef2') < PANELc.indexOf('dismissedBy: arrayUnion(me.uid)'),
       'el orden importa: primero borrar de verdad');
    ok('1i · el aviso ya no dice "solo se eliminara para ti"',
       !/Solo se eliminará para ti/.test(PANEL),
       'seria mentir: ahora se borra de verdad');
}

// ═══════════ PARTE 2 · los listados de terminados ═══════════
console.log('\n── PARTE 2 · informe y partido no son lo mismo (puntos 1 y 2) ──');
{
    [['finished-matches-tab.js', FTABc], ['app-init.js', INITc]].forEach(([nombre, src]) => {
        ok('2a · ' + nombre + ' distingue informe de partido',
           /_esInforme = m\.source === 'cronos_player_reports'/.test(src));
        ok('2b · ' + nombre + ': un informe NO se marca como congelado',
           /_congelado = _esInforme \? false :/.test(src),
           'v434 los marcaba 🔒 CERRADO y les quitaba todos los botones');
        ok('2c · ' + nombre + ': el informe SI se puede borrar',
           /\$\{_congelado \? '' : `[\s\S]{0,400}deleteFinishedMatchFromCloud/.test(src),
           'los gestionan Director, Coordinador y Entrenador');
        ok('2d · ' + nombre + ': pero NO admite evento retroactivo',
           /\$\{\(_congelado \|\| _esInforme\) \? '' : `[\s\S]{0,300}openRetroactiveEventModal/.test(src),
           'un informe no es un partido en curso al que anadir sucesos');
    });

    ok('2e · [TRAMPA] el candado del partido NO bloquea el borrado del informe',
       /let _borrarPartido = /.test(INITc) &&
       /if \(matchId && _borrarPartido\)/.test(INITc),
       'el id de una ficha de informe es data.liveMatchId, que puede ser un partido CONGELADO');
    ok('2f · y si solo habia partido congelado, se avisa y se sale',
       /if \(!docId\) \{[\s\S]{0,300}lockReason/.test(INITc));
}

// ═══════════ PARTE 3 · limpieza de temporada ═══════════
console.log('\n── PARTE 3 · el SuperAdmin vacia al cerrar temporada (punto 4) ──');
{
    ok('3a · el borrado de club se lleva los informes',
       /_borrarPorClub\('cronos_player_reports'\)/.test(DELCc),
       'quedaban huerfanos: sin club, nadie podia verlos NI borrarlos');
    ok('3b · y los partidos', /_borrarPorClub\('live_matches'\)/.test(DELCc));
    ok('3c · y los vinculos jugador-padre', /_borrarPorClub\('cronos_player_links'\)/.test(DELCc));
    ok('3d · acota por clubId, no barre la coleccion entera',
       /where\('clubId', '==', clubId\)/.test(DELCc));
    ok('3e · trocea el borrado para no lanzar miles de promesas de golpe',
       /i \+= 400/.test(DELCc));
    // ⚠️ delete-club.js escribe los acentos como escapes unicode
    // (`vínculos`), asi que un regex con la tilde literal NO casa aunque el
    // texto este. Se busca solo el tramo ASCII.
    ok('3f · y el aviso al usuario dice lo que se va a borrar',
       /TODOS sus informes, partidos y v/.test(DELC));
}

// ═══════════ PARTE 4 · LAS REGLAS, en el servidor ═══════════
console.log('\n── PARTE 4 · firestore.rules (Rules REST API) ──');

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
            const cs = []; res.on('data', c => cs.push(c));
            res.on('end', () => { const d = Buffer.concat(cs).toString('utf8');
                try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); }
                catch (e) { reject(new Error(d.slice(0, 200))); } });
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
            res => { const cs = []; res.on('data', c => cs.push(c));
                     res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(cs).toString('utf8') })); });
        req.on('error', reject); req.write(body); req.end();
    });
}
function mocks(uid, data) {
    const p = `${DB}/users/${uid}`;
    return [
        { function: 'exists', args: [{ exactValue: p }], result: { value: data !== null } },
        { function: 'get', args: [{ exactValue: p }], result: { value: { data: data || {} } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
    ];
}

const CLUB = 'clubA';
const iso = (ms) => new Date(ms).toISOString();
const AHORA = Date.now();

const docDirector = { clubId: CLUB, isAuthorized: true, role: 'director' };
const docPadre    = { clubId: CLUB, isAuthorized: true, role: 'parent' };
const docExtrano  = { clubId: 'clubZ', isAuthorized: true, role: 'user' };

const authDirector = { uid: 'dir_uid', token: { email: 'dir@club.es', firebase: { sign_in_provider: 'password' } } };
const authPadre    = { uid: 'padre_uid', token: { email: 'p@club.es', firebase: { sign_in_provider: 'password' } } };
const authExtrano  = { uid: 'ext_uid', token: { email: 'x@otro.es', firebase: { sign_in_provider: 'password' } } };
const authSA       = { uid: 'sa_uid', token: { email: 'sa@x.es', role: 'superadmin', firebase: { sign_in_provider: 'password' } } };

const colectivo  = { clubId: CLUB, coachUid: 'coach_uid', staffReport: true,
                     staffUids: ['dir_uid'], scoreHome: 2, scoreAway: 1 };
const individual = { clubId: CLUB, coachUid: 'coach_uid', parentUid: 'padre_uid',
                     type: 'parent_player_report', goals: 1 };

function casos() {
    return [
        { n: '4a · [PUNTO 2] el Director BORRA un informe colectivo',
          exp: 'ALLOW', auth: authDirector, doc: docDirector, method: 'delete', existing: colectivo,
          why: 'antes solo podia OCULTARLO con dismissedByStaff; el doc no habia forma de borrarlo' },

        { n: '4b · [PUNTO 3] el padre BORRA el informe individual de su hijo',
          exp: 'ALLOW', auth: authPadre, doc: docPadre, method: 'delete', existing: individual },

        { n: '4c · el padre NO borra un informe colectivo del club',
          exp: 'DENY', auth: authPadre, doc: docPadre, method: 'delete', existing: colectivo },

        { n: '4d · un usuario de OTRO club no borra nada',
          exp: 'DENY', auth: authExtrano, doc: docExtrano, method: 'delete', existing: colectivo },

        { n: '4e · [PUNTO 4] el SuperAdmin borra cualquier informe',
          exp: 'ALLOW', auth: authSA, doc: { isAuthorized: true, role: 'superadmin' },
          method: 'delete', existing: colectivo },

        { n: '4f · [AGUJERO CERRADO] un extrano NO reescribe un informe poniendose como coachUid',
          exp: 'DENY', auth: authExtrano, doc: docExtrano, method: 'update',
          existing: colectivo,
          entrante: Object.assign({}, colectivo, { coachUid: 'ext_uid', scoreHome: 99 }),
          why: 'la rama borrada leia el doc ENTRANTE: bastaba con ponerse de coachUid en el payload' },

        { n: '4g · el Director SI actualiza un informe de su club (reenvio)',
          exp: 'ALLOW', auth: authDirector, doc: docDirector, method: 'update',
          existing: colectivo, entrante: Object.assign({}, colectivo, { scoreHome: 3 }) },

        { n: '4h · el padre puede leer el informe de su hijo',
          exp: 'ALLOW', auth: authPadre, doc: docPadre, method: 'get', existing: individual },

        { n: '4i · un extrano no lee informes de otro club',
          exp: 'DENY', auth: authExtrano, doc: docExtrano, method: 'get', existing: colectivo },
    ];
}

(async () => {
    let refresh = null;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        refresh = cfg.tokens && cfg.tokens.refresh_token;
    } catch (e) { /* sin sesion */ }

    if (!refresh) {
        console.log('SKIP · sin sesion del CLI (firebase login): no se evaluan las reglas.');
        console.log('       ⚠️ La barrera real queda SIN PROBAR en esta ejecucion.');
    } else {
        try {
            const token = await getAccessToken(refresh);
            const cs = casos();
            const testCases = cs.map(c => ({
                expectation: c.exp,
                request: {
                    auth: c.auth,
                    path: `${DB}/cronos_player_reports/R1`,
                    method: c.method,
                    time: iso(AHORA),
                    resource: c.entrante ? { data: c.entrante } : undefined,
                },
                resource: { data: c.existing },
                functionMocks: mocks(c.auth.uid, c.doc),
                pathEncoding: 'PLAIN',
            }));

            const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
                                 token,
                                 { source: { files: [{ name: 'firestore.rules', content: RULES }] },
                                   testSuite: { testCases } });
            const j = JSON.parse(r.body);
            const res = j.testResults || [];
            if (!res.length) {
                ok('4· la API respondio con resultados', false, r.body.slice(0, 400));
            } else {
                cs.forEach((c, i) => {
                    const t = res[i] || {};
                    // errorPosition = la regla se AVERIO. En un caso DENY eso
                    // sale "SUCCESS" y disfrazaria una regla rota de estricta.
                    const rota = !!t.errorPosition;
                    ok(c.n, t.state === 'SUCCESS' && !rota,
                       rota ? ('LA REGLA LANZA: ' + JSON.stringify(t.debugMessages || t.errorPosition).slice(0, 220))
                            : (c.why ? c.why + ' | estado=' + t.state : 'estado=' + t.state));
                });
            }
        } catch (e) {
            ok('4· las reglas se pudieron evaluar', false, e.message);
        }
    }

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();

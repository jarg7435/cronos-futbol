// ─────────────────────────────────────────────────────────────────────────
//  test_desbloqueo_partido.js  ·  🔓 v797
//
//  Encargo del autor (implementar.txt 2026-10-11, capturas 11295-11298):
//    1 · Sucesos libres en directo y en las 2 h siguientes; después, el
//        partido queda bloqueado.
//    2 · Pasadas las 2 h, «Sucesos Offline» sólo con permiso del Director
//        Deportivo o del Coordinador PARA ESE PARTIDO.
//    3 · Lo añadido a posteriori, en cursiva y con el icono en rojo (eso lo
//        vigila test_retroactivo_naranja.js).
//    + (encargo anterior) el modal elige el partido en un desplegable
//        OBLIGATORIO: sin partido no se guarda nada.
//
//  PARTE 1 · el candado (js/match/immutability.js), EJECUTADO.
//  PARTE 2 · el modal (js/match/events/retroactive-modal.js), EJECUTADO.
//  PARTE 3 · las reglas, evaluadas por la Rules API de Google en el proyecto
//            de TESTEO (sólo compila y evalúa con datos de mentira; no toca
//            ninguna base). Mismas trampas pagadas que el resto de tests de
//            reglas: `request.time` aportado, ALLOW en cada lote y
//            `errorPosition` = fallo. Sin sesión del CLI se SALTA con aviso.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 500)); }
};

const H = 60 * 60 * 1000;
const AHORA = Date.now();

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · el candado con permiso de desbloqueo ──');
// ═══════════════════════════════════════════════════════════════════════
const ctxLock = { window: {}, Date, Math, isNaN, console };
vm.createContext(ctxLock);
vm.runInContext(leer('js/match/immutability.js'), ctxLock);
const LOCK = ctxLock.window.CronosMatchLock;
{
    const fin = (horas) => ({ status: 'finished', finishedAt: new Date(AHORA - horas * H).toISOString() });
    const conPermiso = (m, u) => Object.assign(m, { _cronosUnlock: u });
    const vigente  = { status: 'granted', expiresAt: new Date(AHORA + 3 * H).toISOString() };
    const caducado = { status: 'granted', expiresAt: new Date(AHORA - 1 * H).toISOString() };

    ok('1a · en directo se pueden añadir sucesos', LOCK.canAddEvent({ status: 'active' }));
    ok('1b · y en las 2 h siguientes al final', LOCK.canAddEvent(fin(1.5)));
    ok('1c · 🔑 pasadas las 2 h, NO (sin permiso)', !LOCK.canAddEvent(fin(3)));
    ok('1d · 🔑🔑 pasadas las 2 h, SÍ con permiso vigente', LOCK.canAddEvent(conPermiso(fin(30), vigente)));
    ok('1e · ⚠️ un permiso CADUCADO no abre', !LOCK.canAddEvent(conPermiso(fin(30), caducado)));
    ok('1f · ⚠️ una solicitud PENDIENTE no abre', !LOCK.canAddEvent(conPermiso(fin(30), { status: 'pending' })));
    ok('1g · ⚠️ ni una DENEGADA aunque lleve fecha',
       !LOCK.canAddEvent(conPermiso(fin(30), { status: 'denied', expiresAt: vigente.expiresAt })));
    ok('1h · ⚠️ un permiso sin caducidad legible no vale', !LOCK.unlockValid({ status: 'granted' }));
    ok('1i · el estado sigue siendo «frozen» (el permiso no reescribe el partido)',
       LOCK.state(conPermiso(fin(30), vigente)) === 'frozen');
    ok('1j · el motivo del bloqueo dice a quién pedir el permiso',
       /Director Deportivo/.test(LOCK.lockReason(fin(3))) && /Coordinador/.test(LOCK.lockReason(fin(3))));
    ok('1k · y con permiso vigente no hay motivo de bloqueo',
       LOCK.lockReason(conPermiso(fin(30), vigente)) === '');
    ok('1l · el permiso dura 24 h (mismo número que el techo de 25 h de las reglas)',
       LOCK.UNLOCK_MS === 24 * H);
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · el modal: partido obligatorio y permiso ──');
// ═══════════════════════════════════════════════════════════════════════
// `permiso` = lo que devuelve la nube al releerlo: el modal NO se fía del que
// traiga el llamante y lo vuelve a pedir (la verdad es el servidor).
function entornoModal({ enCurso = null, permiso = null } = {}) {
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, value: '', style: {}, innerHTML: '', textContent: '',
                                               focus() {}, options: [], selectedIndex: 0 });
    const registrados = [], toasts = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        escapeHtml: (s) => String(s == null ? '' : s),
        showToast: (m) => toasts.push(String(m)),
        Promise, String, Number, Array, Object, Date, JSON, Math, parseInt, isNaN,
        _registerMatchEvent: (...a) => registrados.push(a),
        document: {
            getElementById: (id) => id === 'cronos-retroactive-modal' ? (els[id] || null) : el(id),
            createElement: () => ({ style: {}, innerHTML: '', className: '', id: '' }),
            body: { appendChild: (n) => { els['cronos-retroactive-modal'] = n; } },
        },
        liveMatchId: enCurso,
        CronosMatchLock: LOCK,
        CronosUnlocks: { leer: async () => permiso, estado: (u) => (u ? u.status : 'none'),
                         horaCorta: () => '', toMs: () => 0, solicitar: async () => ({ ok: true }) },
        _cronosMatchEvents: [],
        renderPlayers() {}, updateMasterUI() {},
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(leer('js/match/events/retroactive-modal.js'), sb);
    return { sb, el, els, registrados, toasts };
}
const plantilla = () => [
    { id: 1, number: '1', name: 'PEDRO', team: 'home', status: 'field', goals: 0 },
    { id: 7, number: '7', name: 'FEFO', team: 'home', status: 'bench', goals: 0 },
];
const partido = (horas, extra) => Object.assign({
    id: 'M1', status: 'finished', finishedAt: new Date(AHORA - horas * H).toISOString(),
    myTeamRole: 'home', homeTeam: { name: 'CD PRUEBA', score: 1 }, awayTeam: { name: 'RIVAL', score: 0 },
    players: plantilla(),
}, extra || {});

(async () => {
    {
        // 2a-2c · SIN partido: el desplegable está, y no se guarda nada.
        const E = entornoModal({ enCurso: 'en_curso_1' });
        await E.sb.openRetroactiveEventModal();
        const html = (E.els['cronos-retroactive-modal'] || {}).innerHTML || '';
        ok('2a · 🔑 el desplegable de partido va el PRIMERO del formulario',
           html.indexOf('id="retro-match-select"') > 0 &&
           html.indexOf('id="retro-match-select"') < html.indexOf('id="retro-half-select"'));
        ok('2b · y arranca en «— Elige el partido —» (sin caer en el partido en curso)',
           /<option value="" selected>— Elige el partido —<\/option>/.test(html));
        E.el('retro-player-select').value = '1';
        await E.sb.submitRetroactiveEvent();
        ok('2c · 🔑🔑 sin partido elegido NO se registra nada y se avisa',
           E.registrados.length === 0 && /Elige primero el partido/.test(E.toasts.join('|')), E.toasts);
    }
    {
        // 2d-2f · partido CERRADO sin permiso: el modal se abre APAGADO con el botón de pedir.
        const E = entornoModal();
        await E.sb.openRetroactiveEventModal('M1', partido(5));
        const estado = E.el('retro-match-status').innerHTML;
        ok('2d · 🔑 un partido cerrado ABRE el modal (antes: toast y fuera) con el motivo',
           /Partido cerrado/.test(estado) && /Director Deportivo/.test(estado));
        ok('2e · 🔑 y ofrece «Solicitar desbloqueo»', /_retroSolicitarDesbloqueo\(\)/.test(estado));
        ok('2f · con el formulario apagado y Guardar desactivado',
           E.el('retro-form-body').style.pointerEvents === 'none' && E.el('retro-save-btn').disabled === true);
        E.el('retro-player-select').value = '1';
        await E.sb.submitRetroactiveEvent();
        ok('2g · 🔑🔑 y guardar igualmente (consola) NO registra nada',
           E.registrados.length === 0 && E.toasts.some(t => /cerrado/.test(t)), E.toasts);
    }
    {
        // 2h-2k · partido CERRADO con permiso VIGENTE: se registra, marcado.
        const permiso = { status: 'granted', decidedByName: 'Director Prueba',
                          expiresAt: new Date(AHORA + 5 * H).toISOString() };
        const E = entornoModal({ permiso });
        const p = partido(30);
        await E.sb.openRetroactiveEventModal('M1', p);
        ok('2h · con permiso vigente el formulario se ENCIENDE',
           E.el('retro-form-body').style.pointerEvents === 'auto' && E.el('retro-save-btn').disabled === false);
        ok('2i · y dice quién lo concedió', /Desbloqueado por <strong>Director Prueba/.test(E.el('retro-match-status').innerHTML));
        E.el('retro-player-select').value = '1';
        E.el('retro-half-select').value = '2T';
        E.el('retro-minute-input').value = '40';
        await E.sb.submitRetroactiveEvent();
        const r = E.registrados[0] || [];
        ok('2j · 🔑 se registra el suceso contra ESE partido', r[0] === 'goal' && r[5] && r[5].matchId === 'M1', r);
        ok('2k · 🔑 marcado como posterior: retro + addedAfterMatch + quién desbloqueó',
           r[4] && r[4].retro === true && r[4].addedAfterMatch === true && r[4].unlockedBy === 'Director Prueba', r[4]);
    }
    {
        // 2l · partido en su ventana de 2 h: libre, y también marcado.
        const E = entornoModal();
        await E.sb.openRetroactiveEventModal('M1', partido(1));
        E.el('retro-player-select').value = '1';
        await E.sb.submitRetroactiveEvent();
        const r = E.registrados[0] || [];
        ok('2l · en la ventana de 2 h se registra sin permiso, marcado como posterior',
           r[0] === 'goal' && r[4] && r[4].retro === true && r[4].addedAfterMatch === true && !r[4].unlockedBy, r[4]);
    }
    {
        // 2m · un partido que sólo vive en los INFORMES (> 10 h) no escribe en live_matches.
        const E = entornoModal({ permiso: { status: 'granted', expiresAt: new Date(AHORA + 5 * H).toISOString() } });
        const p = partido(40, { _soloInformes: true });
        await E.sb.openRetroactiveEventModal('M1', p);
        E.el('retro-player-select').value = '1';
        await E.sb.submitRetroactiveEvent();
        ok('2m · 🔑 partido sólo en informes: NO se intenta escribir el directo (no existe)',
           E.registrados.length === 0);
    }
    {
        // 2n · el modal ya no se apoya en la plantilla en memoria para un partido ajeno.
        const SRC = leer('js/match/events/retroactive-modal.js');
        ok('2n · un partido elegido que no es el que se juega NO cae a window.players',
           /if \(!esElEnCurso && _targetMatchId\) return delDestino;/.test(SRC));
        const PA = leer('js/match/events/player-actions.js');
        ok('2o · 🔑 el suceso lleva dentro el id del partido DESTINO (antes: el del partido en curso)',
           /var _evMatchId = \(target && target\.matchId\) \? String\(target\.matchId\)/.test(PA));
        const CP = leer('js/coach/comms/panel.js');
        ok('2p · 🔑 la tarjeta de Comunicaciones abre el modal (llamaba a una función inexistente)',
           /<!-- 3\. REGISTRAR SUCESOS OFFLINE[\s\S]{0,700}openRetroactiveEventModal\(\)/.test(CP) &&
           !/openOfflineSyncModal\(\)/.test(CP));
        const CR = leer('js/coach/reports/club-reports.js');
        ok('2q · el Panel de Dirección/Coordinación tiene la pestaña «Desbloqueos»',
           /switchStaffTab\('desbloqueos'\)/.test(CR) && /tab === 'desbloqueos'/.test(CR) &&
           /CronosUnlocks\.renderPanel\('staff-dashboard-content'\)/.test(CR));
        const IND = leer('js/admin/individual/panel.js');
        ok('2s · 🔓 v798 · el panel del ENTE tiene «Desbloqueos» con SU id de ente',
           /indTab\('desbloqueos'\)/.test(IND) &&
           /CronosUnlocks\.renderPanel\('ind-desbloqueos-body', individualEntityId\)/.test(IND) &&
           /pintarBadge\('ind-badge-desbloqueos', individualEntityId\)/.test(IND));
        const IDX = leer('index.html');
        ok('2r · index.html carga match-unlocks.js ANTES del modal',
           IDX.indexOf('js/match/events/match-unlocks.js') > 0 &&
           IDX.indexOf('js/match/events/match-unlocks.js') < IDX.indexOf('js/match/events/retroactive-modal.js'));
    }

    await parteReglas();

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 3 · LAS REGLAS (Rules API, proyecto de testeo)
// ═══════════════════════════════════════════════════════════════════════
const PROJECT = 'cronos-futbol-test';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';

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
            const trozos = []; res.on('data', c => trozos.push(c));
            res.on('end', () => { const d = Buffer.concat(trozos).toString('utf8');
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
            res => { const trozos = []; res.on('data', c => trozos.push(c));
                     res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(trozos).toString('utf8') })); });
        req.on('error', reject); req.write(body); req.end();
    });
}

const iso = (ms) => new Date(ms).toISOString();
const COACH = 'coach_uid', OTRO_COACH = 'otro_coach_uid', DIR = 'dir_uid', COORD = 'coord_uid';
const AUTH = (uid, email) => ({ uid, token: { email, firebase: { sign_in_provider: 'password' } } });

// Mocks de TODO lo que las reglas pueden consultar: así ninguna rama se
// avería por falta de dato y `errorPosition` sólo salta por un fallo real.
function mocks({ uid, user, unlock, club, clubId }) {
    const pU = `${DB}/users/${uid}`;
    const pUn = `${DB}/cronos_match_unlocks/M1`;
    const pC = `${DB}/clubs/${clubId || 'clubA'}`;
    const pSA = `${DB}/cronos_config/superadmins`;
    return [
        { function: 'exists', args: [{ exactValue: pU }], result: { value: !!user } },
        { function: 'get', args: [{ exactValue: pU }], result: { value: { data: user || {} } } },
        { function: 'exists', args: [{ exactValue: pSA }], result: { value: true } },
        { function: 'get', args: [{ exactValue: pSA }], result: { value: { data: { emails: [] } } } },
        { function: 'exists', args: [{ exactValue: pUn }], result: { value: !!unlock } },
        { function: 'get', args: [{ exactValue: pUn }], result: { value: { data: unlock || {} } } },
        { function: 'exists', args: [{ exactValue: pC }], result: { value: true } },
        { function: 'get', args: [{ exactValue: pC }], result: { value: { data: club || { adminUid: 'admin_uid' } } } },
    ];
}

const U_COACH = { clubId: 'clubA', isAuthorized: true, role: 'user', status: 'active' };
const U_DIR   = { clubId: 'clubA', isAuthorized: true, role: 'director', status: 'active' };
const PARTIDO = (horas, extra) => Object.assign({
    clubId: 'clubA', createdBy: COACH, coachEmail: 'coach@a.es', status: 'finished',
    finishedAt: iso(AHORA - horas * H), events: [], players: [], homeTeam: { score: 1 }, awayTeam: { score: 0 },
}, extra || {});
const CON_SUCESO = (m) => Object.assign({}, m, { events: [{ eventId: 'ev1', type: 'goal', isRetroactive: true }] });
const VIGENTE = { matchId: 'M1', clubId: 'clubA', coachUid: COACH, status: 'granted',
                  decidedBy: DIR, expiresAt: iso(AHORA + 5 * H) };
const SOLICITUD = { matchId: 'M1', clubId: 'clubA', coachUid: COACH, coachName: 'Coach', status: 'pending',
                    requestedAt: iso(AHORA), matchLabel: 'CD 1-0 Rival', reason: '' };
const CONCEDE = (horas, extra) => Object.assign({}, SOLICITUD,
    { status: 'granted', decidedBy: DIR, decidedByName: 'Dir', decidedRole: 'director',
      decidedAt: iso(AHORA), expiresAt: iso(AHORA + horas * H) }, extra || {});

function casosReglas() {
    const P_LM = `${DB}/live_matches/M1`;
    const P_UN = `${DB}/cronos_match_unlocks/M1`;
    const lm = (n, exp, existente, nuevo, unlock, nota, auth) => ({
        n, exp, nota, existing: existente,
        req: { auth: auth || AUTH(COACH, 'coach@a.es'), path: P_LM, method: 'update', resource: { data: nuevo } },
        mocks: mocks({ uid: (auth || AUTH(COACH)).uid, user: U_COACH, unlock }),
    });
    const un = (n, exp, metodo, uid, user, existente, nuevo, nota, club) => ({
        n, exp, nota, existing: existente,
        req: Object.assign({ auth: AUTH(uid, uid + '@a.es'), path: P_UN, method: metodo },
                           nuevo ? { resource: { data: nuevo } } : {}),
        mocks: mocks({ uid, user, unlock: existente, club }),
    });
    const P5 = PARTIDO(5);
    // Concede sobre una solicitud del ENTE 'enteE'.
    const ente = (n, exp, uid, user, club, claims) => {
        const sol = Object.assign({}, SOLICITUD, { clubId: 'enteE', coachUid: 'ente_coach' });
        const auth = AUTH(uid, uid + '@a.es');
        if (claims) Object.assign(auth.token, claims);
        return { n, exp, existing: sol,
                 req: { auth, path: P_UN, method: 'update',
                        resource: { data: Object.assign({}, sol, { status: 'granted', decidedBy: uid,
                                    decidedAt: iso(AHORA), expiresAt: iso(AHORA + 24 * H) }) } },
                 mocks: mocks({ uid, user, unlock: sol, club, clubId: 'enteE' }) };
    };
    return [
        // ── live_matches: el partido cerrado ─────────────────────────────
        lm('3a · ventana de 2 h: se añade sin permiso (lo de siempre)', 'ALLOW',
           PARTIDO(1), CON_SUCESO(PARTIDO(1)), null, 'lmInGrace'),
        lm('3b · 🔑 pasadas las 2 h, SIN permiso: denegado', 'DENY',
           P5, CON_SUCESO(P5), null, 'lmFrozen sin lmDesbloqueado'),
        lm('3c · 🔑🔑 pasadas las 2 h, CON permiso vigente a su nombre: permitido', 'ALLOW',
           P5, CON_SUCESO(P5), VIGENTE, 'lmFrozen && lmOnlyEvents && lmDesbloqueado'),
        lm('3d · ⚠️ con el permiso CADUCADO: denegado', 'DENY',
           P5, CON_SUCESO(P5), Object.assign({}, VIGENTE, { expiresAt: iso(AHORA - H) }), 'request.time < expiresAt'),
        lm('3e · ⚠️ con una solicitud PENDIENTE: denegado', 'DENY',
           P5, CON_SUCESO(P5), Object.assign({}, VIGENTE, { status: 'pending' }), 'status == granted'),
        lm('3f · 🔑 el permiso es de OTRO entrenador: denegado', 'DENY',
           P5, CON_SUCESO(P5), Object.assign({}, VIGENTE, { coachUid: OTRO_COACH }), 'coachUid == request.auth.uid'),
        lm('3g · 🔑 el partido NO es suyo (otro creador y otro correo): denegado', 'DENY',
           PARTIDO(5, { createdBy: OTRO_COACH, coachEmail: 'otro@a.es' }),
           CON_SUCESO(PARTIDO(5, { createdBy: OTRO_COACH, coachEmail: 'otro@a.es' })), VIGENTE,
           'un compañero del club no se cuela con un permiso pedido a su nombre'),
        lm('3h · 🔑 aun con permiso, sólo sucesos: tocar `status` se deniega', 'DENY',
           P5, Object.assign(CON_SUCESO(P5), { status: 'active' }), VIGENTE, 'lmOnlyEvents (hasOnly)'),

        // ── cronos_match_unlocks: pedir ──────────────────────────────────
        un('3i · el entrenador PIDE el desbloqueo para sí', 'ALLOW', 'create', COACH, U_COACH, null, SOLICITUD),
        un('3j · 🔑 el entrenador NO puede crearlo ya CONCEDIDO', 'DENY', 'create', COACH, U_COACH, null,
           Object.assign({}, SOLICITUD, { status: 'granted' })),
        un('3k · 🔑 ni colar la caducidad en la solicitud', 'DENY', 'create', COACH, U_COACH, null,
           Object.assign({}, SOLICITUD, { expiresAt: iso(AHORA + 5 * H) })),
        un('3l · ni pedirlo a nombre de otro entrenador', 'DENY', 'create', COACH, U_COACH, null,
           Object.assign({}, SOLICITUD, { coachUid: OTRO_COACH })),
        // ⚠️ «leer un permiso que NO existe» (`resource == null`) NO SE PUEDE
        // PROBAR AQUÍ: el banco `:test` no representa un documento inexistente
        // y la comparación revienta (medido otra vez en v797; ver la nota de
        // cronos_sessions en firestore.rules). El patrón ya está desplegado en
        // otras dos colecciones, y el cliente (`CronosUnlocks.leer`) trata
        // cualquier fallo de lectura como «no hay permiso».
        un('3m · el entrenador lee SU permiso', 'ALLOW', 'get', COACH, U_COACH, CONCEDE(5), null),
        un('3m2 · ⚠️ y no el de otro entrenador', 'DENY', 'get', COACH, U_COACH,
           CONCEDE(5, { coachUid: OTRO_COACH }), null),
        un('3n · reabrir una solicitud DENEGADA', 'ALLOW', 'update', COACH, U_COACH,
           Object.assign({}, SOLICITUD, { status: 'denied', decidedBy: DIR }),
           Object.assign({}, SOLICITUD, { status: 'pending', decidedBy: DIR, requestedAt: iso(AHORA + 1000) })),
        un('3o · ⚠️ pero no «reabrir» uno VIGENTE (lo dejaría en pendiente a su antojo)', 'DENY', 'update', COACH, U_COACH,
           CONCEDE(5), Object.assign({}, CONCEDE(5), { status: 'pending' })),

        // ── cronos_match_unlocks: decidir ────────────────────────────────
        un('3p · 🔑🔑 el DIRECTOR (rol raíz) concede 24 h', 'ALLOW', 'update', DIR, U_DIR, SOLICITUD, CONCEDE(24)),
        un('3q · ⚠️ pero no más de 25 h', 'DENY', 'update', DIR, U_DIR, SOLICITUD, CONCEDE(48)),
        un('3r · ⚠️ ni firmando con el uid de otro', 'DENY', 'update', DIR, U_DIR, SOLICITUD,
           CONCEDE(24, { decidedBy: 'alguien' })),
        un('3s · 🔑 el director de OTRO club no puede', 'DENY', 'update', DIR,
           Object.assign({}, U_DIR, { clubId: 'clubB' }), SOLICITUD, CONCEDE(24)),
        un('3t · 🔑 el COORDINADOR por la lista del club (rol raíz entrenador)', 'ALLOW', 'update', COORD,
           Object.assign({}, U_COACH), SOLICITUD, CONCEDE(24, { decidedBy: COORD }),
           'clubs/clubA.coordinatorUids', { adminUid: 'admin_uid', coordinatorUids: [COORD] }),
        un('3u · 🔑🔑 el entrenador NO se concede su propia solicitud', 'DENY', 'update', COACH, U_COACH,
           SOLICITUD, CONCEDE(24, { decidedBy: COACH })),
        un('3v · 🔑🔑 ni escribiéndose «director» en allRoles (autoafirmable)', 'DENY', 'update', COACH,
           Object.assign({}, U_COACH, { allRoles: [{ role: 'director', clubId: 'clubA' }] }),
           SOLICITUD, CONCEDE(24, { decidedBy: COACH })),
        un('3w · el administrador del club (adminUid) también decide', 'ALLOW', 'update', 'admin_uid',
           Object.assign({}, U_COACH, { role: 'club_admin' }), SOLICITUD, CONCEDE(24, { decidedBy: 'admin_uid' })),
        un('3x · la autoridad deniega', 'ALLOW', 'update', DIR, U_DIR, SOLICITUD,
           Object.assign({}, SOLICITUD, { status: 'denied', decidedBy: DIR, decidedAt: iso(AHORA) })),
        un('3y · ⚠️ nadie mueve un permiso a otro entrenador', 'DENY', 'update', DIR, U_DIR, SOLICITUD,
           CONCEDE(24, { coachUid: OTRO_COACH })),
        un('3z · la autoridad lee los permisos de su club', 'ALLOW', 'get', DIR, U_DIR, SOLICITUD, null),

        // ── 🔓 v798 · el ENTE individual: decide su ADMINISTRADOR ─────────
        ente('4a · 🔑🔑 el administrador del ente (adminUid del ente) concede', 'ALLOW',
             'ente_admin', { isAuthorized: true, role: 'individual', individualEntityId: 'enteE' },
             { type: 'individual', adminUid: 'ente_admin' }),
        ente('4b · 🔑 y por su claim de administrador individual de ESE ente', 'ALLOW',
             'ente_admin2', { isAuthorized: true, role: 'user' }, { type: 'individual', adminUid: 'otro' },
             { role: 'individual', clubId: 'enteE' }),
        ente('4c · ⚠️ el administrador de OTRO ente no', 'DENY',
             'ente_admin', { isAuthorized: true, role: 'individual', clubId: 'enteF' },
             { type: 'individual', adminUid: 'otro' }),
        ente('4d · 🔑 un ENTRENADOR del ente no se concede nada', 'DENY',
             'ente_coach', { isAuthorized: true, role: 'entrenador_individual', clubId: 'enteE' },
             { type: 'individual', adminUid: 'ente_admin' }),
        ente('4e · 🔑🔑 ni escribiéndose el ente en individualEntityId (autoescribible)', 'DENY',
             'listo', { isAuthorized: true, role: 'user', individualEntityId: 'enteE' },
             { type: 'individual', adminUid: 'ente_admin' }),
        ente('4f · el rol raíz individual con su ente en clubId también decide', 'ALLOW',
             'ente_admin3', { isAuthorized: true, role: 'individual', clubId: 'enteE' },
             { type: 'individual', adminUid: 'otro' }),
        { n: '4g · el entrenador del ente PIDE aunque su ente vaya en individualEntityId', exp: 'ALLOW',
          req: { auth: AUTH('ente_coach', 'ente_coach@a.es'), path: P_UN, method: 'create',
                 resource: { data: Object.assign({}, SOLICITUD, { clubId: 'enteE', coachUid: 'ente_coach' }) } },
          mocks: mocks({ uid: 'ente_coach', user: { isAuthorized: true, role: 'entrenador_individual', individualEntityId: 'enteE' },
                         club: { type: 'individual', adminUid: 'ente_admin' }, clubId: 'enteE' }) },
    ];
}

async function parteReglas() {
    console.log('\n── PARTE 3 · las reglas (Rules API, proyecto de testeo) ──');
    let token;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        token = await getAccessToken(cfg.tokens.refresh_token);
    } catch (e) {
        console.log('SKIP · sin sesion del CLI de Firebase (ejecuta `firebase login`): ' + e.message);
        return;
    }
    const source = { files: [{ name: 'firestore.rules', content: leer('firestore.rules') }] };
    const cs = casosReglas();
    const testCases = cs.map(c => {
        const tc = { expectation: c.exp, request: Object.assign({ time: new Date(AHORA).toISOString() }, c.req),
                     functionMocks: c.mocks || [], pathEncoding: 'PLAIN' };
        if (c.existing) tc.resource = { data: c.existing };
        return tc;
    });
    const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
        token, { source, testSuite: { testCases } });
    if (r.status !== 200) { ok('3· la Rules API responde 200', false, { status: r.status, body: r.body.slice(0, 600) }); return; }
    const res = JSON.parse(r.body);
    const graves = (res.issues || []).filter(i => i.severity === 'ERROR');
    ok('3· las reglas COMPILAN sin errores', graves.length === 0, graves);
    const errores = (res.testResults || []).flatMap((t, i) =>
        (t.errorPosition ? [`${cs[i].n}: ${JSON.stringify(t.errorPosition)}`] : []));
    ok('3· 🔑 ninguna evaluación se AVERIÓ (un error denegaría y saldría verde)', errores.length === 0, errores);
    (res.testResults || []).forEach((t, i) => {
        ok(cs[i].n + '  [espera ' + cs[i].exp + ']', t.state === 'SUCCESS',
           { estado: t.state, porque: cs[i].nota, debug: t.debugMessages });
    });
    ok('3· se evaluaron los ' + cs.length + ' casos', (res.testResults || []).length === cs.length);
}

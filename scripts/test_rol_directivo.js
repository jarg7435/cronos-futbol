// ─────────────────────────────────────────────────────────────────────────
//  scripts/test_rol_directivo.js  ·  🏢 v810 · ROL «DIRECTIVO / EMPLEADO»
//
//  Encargo del autor (2026-10-12): un rol para clubes y entes que SÓLO ve
//  «Partidos en Vivo», y ahí TODOS los partidos de su entidad. Decisiones:
//  lo aprueba el admin del club / del ente (→ SuperAdmin, como todos); cupo
//  propio `slots.directivos` (10 por defecto); sólo En Vivo; en el visor, el
//  detalle de Dirección (las reglas sólo le dejan LEER live_stats).
//
//  PARTE 1 · el alta, el selector, el panel, el visor y los cupos (texto y
//            ejecución del panel en un vm).
//  PARTE 2 · firestore.rules por la Rules API `:test` (live_stats y
//            live_matches): lee lo de SU entidad, nunca escribe, nunca otra.
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
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};

// ═══ PARTE 1 ═══
console.log('── PARTE 1 · alta, selector, panel, visor y cupos ──');
const IDX = leer('index.html');
const AUTH = leer('js/services/auth.js');
const RL = leer('js/services/auth/role-launch.js');
const SM = leer('js/core/setup-modal.js');
const LIVE = leer('live.html');
const CLUB = leer('js/admin/club/panel.js');
const ENTE = leer('js/admin/individual/panel.js');
const FN = leer('functions/index.js');

ok('1a · el registro ofrece «Directivo / Empleado»', /<option value="directivo">🏢 Directivo \/ Empleado<\/option>/.test(IDX));
ok('1b · 🔑 el alta del directivo PIDE APROBACIÓN en los 6 caminos de alta',
   (AUTH.match(/\['director', 'coordinator', 'user', 'parent', 'directivo'\]\.includes\(requestedRole\)/g) || []).length === 6 &&
   !/\['director', 'coordinator', 'user', 'parent'\]\.includes\(requestedRole\)/.test(AUTH));
ok('1c · elige club o ente (como entrenador y familia) y se le exige elegirlo',
   /if \(isEntrenador \|\| isParent \|\| isDirectivo\) \{\s*entityTypeCont\.style\.display = 'block';/.test(AUTH) &&
   /\['user', 'parent', 'directivo'\]\.includes\(requestedRole\) && _entityTypeVal === 'individual' && !selectedIndivId/.test(AUTH) &&
   /\['user', 'parent', 'directivo'\]\.includes\(requestedRole\) && _entityTypeVal === 'club' && !selectedClubId/.test(AUTH));
ok('1d · 🔑 pero NO equipo ni categoría (ve todos los partidos)',
   /const _bajoEnte     = isUnderIndividual && \['user', 'parent'\]\.includes\(role\);/.test(AUTH) &&
   /const needsCategory = !_bajoEnte && \['user', 'parent', 'individual'\]\.includes\(role\);/.test(AUTH));
ok('1e · 🔑🔑 bajo un ente CONSERVA su rol (antes todo lo que no era entrenador acababa en «familia»)',
   /const _finalSubRole = requestedRole === 'user' \? 'user' : \(requestedRole === 'directivo' \? 'directivo' : 'parent'\);/.test(AUTH));

// El selector de roles y el lanzamiento.
ok('1f · tarjeta propia en el selector de roles', /id="card-opt-directivo"[^>]*onclick="selectOption\('directivo'\)"/.test(IDX) &&
   /directivo:\s*'card-opt-directivo'/.test(RL) && /'card-opt-directivo'/.test(RL));
ok('1g · selectOption lo traduce y lo lanza a SU panel, no al campo',
   /'directivo':\s*'directivo'/.test(RL) &&
   /const isAdminJob  = \['director', 'coordinator', 'club_admin', 'directivo'\]\.includes\(activeRole\);/.test(RL) &&
   /\} else if \(activeRole === 'directivo'\) \{[\s\S]{0,200}window\.openDirectivoPanel\(\)/.test(RL));
ok('1h · sin el extra «partidos_en_vivo» su tarjeta sale con candado y motivo',
   /directivo:\s*'partidos_en_vivo',/.test(SM) && /partidos_en_vivo: 'Partidos en Vivo no está contratado/.test(SM));

// El visor.
const lista = (ini) => { const i = LIVE.indexOf(ini); return i < 0 ? '' : LIVE.slice(i, LIVE.indexOf('];', i)); };
ok('1i · 🔑 el visor le deja entrar', /'directivo'/.test(lista('const AUTHORIZED_ROLES = [')));
ok('1j · 🔑🔑 ve VARIOS partidos (vuelve del partido a la lista)', /'directivo'/.test(lista('const _LIVE_ROLES_MULTIPARTIDO = [')));
ok('1k · 🔑🔑 recibe los avisos de TODOS los partidos de su entidad, como Dirección',
   /rol === 'individual' \|\| rol === 'admin_individual' \|\| rol === 'directivo'\) \{\s*return !!\(userData\.clubId && m\.clubId === userData\.clubId\);/.test(LIVE));
ok('1l · ve el panel de estadísticas del directo (decisión: como Dirección)', /'directivo'/.test(lista('const _LIVE_SAV_ROLES_TECNICOS = [')));
ok('1m · ⚠️ y la lista de En Vivo es la del CLUB entero (por clubId), no la de una categoría',
   /\} else if \(userData\.clubId && m\.clubId === userData\.clubId\) \{/.test(LIVE));

// Cupos y paneles de administración.
ok('1n · 🔑 cupo propio en el club (`slots.directivos`, 10 por defecto) y en el resumen de plazas',
   /role === 'directivo' \? 'directivos' : 'users'\] \?\? \(role === 'directivo' \? 10 : -1\)/.test(CLUB) &&
   /\['director','coordinator','user','parent','directivo'\]\.map\(role => \{/.test(CLUB));
ok('1o · aprobado, sale en el Staff del club (y se le puede quitar la casilla)',
   /if \(role === 'director' \|\| role === 'directivo'\) \{/.test(CLUB));
ok('1p · en el ente, bloque propio y sin ✏️ de categoría (no tiene equipo)',
   /_filasDirectivos\.push\(u\)/.test(ENTE) && /🏢 Directivos \/ Empleados/.test(ENTE) && /r\.role === 'directivo' \? '' :/.test(ENTE));
ok('1q · el SuperAdmin edita el cupo de clubes y entes sin perderlo al guardar',
   /slots: \{ directors: dirS, coordinators: coS, users: coachS, parents: parS, directivos: dirvS \}/.test(leer('js/admin/superadmin/club-slots.js')) &&
   /slots: \{ admins: adminS, coaches: coachS, parents: parS, directivos: dirvS \}/.test(leer('js/admin/superadmin/individual-entity.js')));
ok('1r · 🔑 su baja libera SU cupo, no uno de entrenador (functions)',
   /: after\.role === 'directivo' \? 'directivos'\s*: 'users';/.test(FN));
ok('1s · ROLE_META lo rotula', /directivo:\s*\{ label:'Directivo \/ Empleado'/.test(leer('js/shared/admin-shared.js')));
ok('1t · el panel se carga y se precachea', /<script src="js\/directivo\/panel\.js\?v=[^"]+"><\/script>/.test(IDX) &&
   /'\.\/js\/directivo\/panel\.js'/.test(leer('sw.js')));

// 🏢 v811 · Las vistas del SuperAdmin (implementar.txt 2026-10-12, capturas 11380-11382).
ok('1y · tarjeta de cada CLUB: barra «Directivos / Empleados» con su cupo (10 si no está guardado)',
   /\$\{slotBar\('directivo',\s*'🏢', 'Directivos \/ Empleados'/.test(leer('js/admin/superadmin/clubs-tab.js')) &&
   /role === 'directivo' \? 'directivos' : 'parents'\] \?\? \(role === 'directivo' \? 10 : '∞'\)/.test(leer('js/admin/superadmin/clubs-tab.js')));
const IT = leer('js/admin/superadmin/individuals-tab.js');
ok('1z · tarjeta de cada ENTE: su barra, contando sólo plazas `directivo` del ente',
   /\$\{slotBar\('directivo'\)\}/.test(IT) && /directivo:\s*\['directivo'\],/.test(IT) &&
   /\?\? \(roleKey === 'directivo' \? 10 : '∞'\)/.test(IT));
{
    // El árbol compartido, EJECUTADO («Ver usuarios» del club y «Usuarios del Ente»).
    const sb = { console, Set, Map, Array, Object, String, Number, JSON, Math };
    sb.window = sb;
    sb.ROLE_META = { directivo: { label: 'Directivo / Empleado', icon: '🏢', color: '#ff5858' },
                     director: { label: 'Director Deportivo', icon: '📋', color: '#f0883e' } };
    sb.cronosNombreUsuario = (u) => u.firstName || u.email;
    vm.createContext(sb);
    vm.runInContext(leer('js/admin/shared/category-tree.js'), sb);
    const dv = { _id: 'd1', email: 'dv@x.es', firstName: 'Pepe', _activeRoleData: { role: 'directivo', isAuthorized: true, status: 'active' } };
    const di = { _id: 'd2', email: 'di@x.es', firstName: 'Ana', _activeRoleData: { role: 'director', isAuthorized: true, status: 'active' } };
    const club = sb.renderCategoryTreeReadOnly([dv, di], { mode: 'club', conBorrado: true });
    const staffClub = club.slice(club.indexOf('Staff del Club'), club.indexOf('Prebenjam'));
    ok('1za · 🔑 «Ver usuarios» del CLUB: el directivo sale en el Staff, detrás del Director',
       /Directivo \/ Empleado/.test(staffClub) && staffClub.indexOf('Director Deportivo') < staffClub.indexOf('Directivo / Empleado') &&
       !/Sin categoría\/subcategoría/.test(club), staffClub.slice(0, 200));
    const ente = sb.renderCategoryTreeReadOnly([dv], { mode: 'individual', conBorrado: true });
    ok('1zb · 🔑 «Usuarios del Ente»: bloque propio «Directivos / Empleados (1)», no «sin categoría»',
       /🏢 Directivos \/ Empleados \(1\)/.test(ente) && /dv@x\.es/.test(ente) && !/Sin categoría\/subcategoría/.test(ente), ente.slice(0, 300));
    const dos = sb.renderCategoryTreeReadOnly([dv, Object.assign({}, dv)], { mode: 'individual' });
    ok('1zc · y la misma persona no sale dos veces', /Directivos \/ Empleados \(1\)/.test(dos));
}

// El panel, EJECUTADO.
function cajaPanel(me, extraOn, videosOn) {
    const els = {};
    const mk = (id) => ({ id, style: {}, innerHTML: '', set cssText(v) { this._css = v; } });
    const abiertas = [], toasts = [], listas = [];
    const sb = {
        console, Promise, Object, Array, String,
        document: {
            getElementById: (id) => els[id] || null,
            createElement: () => mk(''),
            body: { appendChild: (el) => { el.id = el.id || 'x'; els['directivo-panel'] = el; } },
        },
        _cronosCurrentUser: me,
        _cronosExtraEnabled: (k) => k === 'partidos_en_vivo' ? extraOn : true,
        showToast: (m) => toasts.push(m),
        open: (u, t) => abiertas.push([u, t]),
        CRONOS_ROL_EXTRA_MOTIVO: { partidos_en_vivo: 'Partidos en Vivo no está contratado en el plan de tu club.' },
        // 🎬 v812 · el módulo de vídeos, con su puerta (el extra) y su lista.
        CronosClips: { activo: () => !!videosOn, abrirLista: () => listas.push(1) },
        setInterval, clearInterval,
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(leer('js/directivo/panel.js'), sb);
    return { sb, els, abiertas, toasts, listas };
}
(async () => {
    const yo = { uid: 'd1', email: 'dir@x.es', role: 'directivo', clubId: 'clubA', clubName: 'CD Prueba', extras: {} };
    let c = cajaPanel(yo, true, true);
    await c.sb.openDirectivoPanel();
    const html = (c.els['directivo-panel'] || {}).innerHTML || '';
    // 🎬 v812 · DOS tarjetas: Partidos en Vivo y Vídeos (encargo del autor).
    ok('1u · 🔑 el panel tiene DOS tarjetas: Partidos en Vivo y Vídeos, y nada más', /Partidos en Vivo/.test(html) && />Vídeos</.test(html) &&
       (html.match(/<button type="button" id="dv-/g) || []).length === 2 && !/Informes|Mensajes|Convocatoria/.test(html), html.slice(0, 300));
    c.sb.cronosDirectivoVideos();
    ok('1u2 · 🎬 con el extra de vídeos, la tarjeta abre la lista de clips', c.listas.length === 1 && c.toasts.length === 0);
    c.sb.cronosDirectivoEnVivo();
    ok('1v · y abre el visor de siempre (live.html), en otra pestaña', c.abiertas.length === 1 && c.abiertas[0][0] === './live.html');
    c = cajaPanel(yo, false, false);
    await c.sb.openDirectivoPanel();
    c.sb.cronosDirectivoEnVivo();
    ok('1w · 🔑 sin el extra: tarjeta con candado y motivo, y NO abre nada',
       /🔒/.test(c.els['directivo-panel'].innerHTML) && /no está contratado/.test(c.els['directivo-panel'].innerHTML) &&
       c.abiertas.length === 0 && c.toasts.length === 1);
    c.sb.cronosDirectivoVideos();
    const _dvV = (c.els['directivo-panel'].innerHTML.split('id="dv-videos"')[1] || '');
    ok('1w2 · 🎬 sin el extra de vídeos: candado, el aviso de Dirección y NO abre la lista',
       /🔒/.test(_dvV) && /Extra no activado para tu club\. Habla con el administrador\./.test(_dvV) &&
       c.listas.length === 0 && c.toasts.length === 2);
    c = cajaPanel({ uid: 'p1', role: 'parent', clubId: 'clubA' }, true, true);
    await c.sb.openDirectivoPanel();
    ok('1x · ⚠️ otro rol no entra a este panel', !c.els['directivo-panel'] && /restringido/.test(c.toasts[0] || ''));

    await parte2();
    fin();
})();

// ═══ PARTE 2 · reglas ═══
const PROJECT = 'cronos-futbol-test';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';
function token(rt) {
    const body = new URLSearchParams({ refresh_token: rt, client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    return new Promise((res, rej) => { const r = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
        s => { const t = []; s.on('data', c => t.push(c)); s.on('end', () => { try { const j = JSON.parse(Buffer.concat(t).toString()); j.access_token ? res(j.access_token) : rej(new Error('sin token')); } catch (e) { rej(e); } }); });
        r.on('error', rej); r.write(body); r.end(); });
}
function post(tk, payload) {
    const body = JSON.stringify(payload);
    return new Promise((res, rej) => { const r = https.request(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, { method: 'POST',
        headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        s => { const t = []; s.on('data', c => t.push(c)); s.on('end', () => res({ status: s.statusCode, body: Buffer.concat(t).toString('utf8') })); });
        r.on('error', rej); r.write(body); r.end(); });
}
const AHORA = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const U = (role, club, extra) => Object.assign({ role, clubId: club || 'clubA', isAuthorized: true, status: 'active' }, extra || {});
const A = (uid) => ({ uid, token: { email: uid + '@x.es', firebase: { sign_in_provider: 'password' } } });
const STATS = (over) => Object.assign({ matchId: 'm1', clubId: 'clubA', createdBy: 'coach', coachEmail: 'coach@x.es',
    category: 'alevin', pr: { items: [] }, sav: { items: [] }, updatedAt: iso(AHORA), v: 1 }, over || {});
const LIVEDOC = (over) => Object.assign({ clubId: 'clubA', createdBy: 'coach', coachEmail: 'coach@x.es', status: 'active',
    category: 'f7_alevin', updatedAt: iso(AHORA) }, over || {});

async function parte2() {
    console.log('\n── PARTE 2 · firestore.rules: lee su entidad, nunca escribe ──');
    let tk;
    try { tk = await token(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token); }
    catch (e) { console.log('SKIP · sin sesión del CLI: reglas sin evaluar'); return; }
    const mocks = (c) => {
        const uid = c.req.auth ? c.req.auth.uid : 'nadie';
        return [
            { function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: !!c.user } },
            { function: 'get', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data: c.user || {} } } },
            { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
            { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
            { function: 'exists', args: [{ exactValue: `${DB}/clubs/clubA` }], result: { value: true } },
            { function: 'get', args: [{ exactValue: `${DB}/clubs/clubA` }], result: { value: { data: { adminUid: 'adm' } } } },
        ];
    };
    const PS = `${DB}/live_stats/m1`, PL = `${DB}/live_matches/m1`, PI = `${DB}/live_index/m1`;
    const casos = [
        { n: '2a · 🔑 el directivo LEE las estadísticas del directo de SU club', exp: 'ALLOW', user: U('directivo'),
          existing: { data: STATS() }, req: { auth: A('dv'), path: PS, method: 'get' } },
        { n: '2b · 🔑🔑 pero NO las escribe (ni crea)', exp: 'DENY', user: U('directivo'),
          req: { auth: A('dv'), path: PS, method: 'create', resource: { data: STATS({ createdBy: 'dv' }) } } },
        { n: '2c · 🔑🔑 ni las modifica', exp: 'DENY', user: U('directivo'), existing: { data: STATS() },
          req: { auth: A('dv'), path: PS, method: 'update', resource: { data: STATS({ v: 2 }) } } },
        { n: '2d · ⚠️ ni lee las de OTRO club', exp: 'DENY', user: U('directivo', 'clubB'),
          existing: { data: STATS() }, req: { auth: A('dv'), path: PS, method: 'get' } },
        { n: '2e · ⚠️ ni sin estar aprobado', exp: 'DENY', user: U('directivo', 'clubA', { isAuthorized: false, status: 'pending_club_admin' }),
          existing: { data: STATS() }, req: { auth: A('dv'), path: PS, method: 'get' } },
        { n: '2f · ⚠️ ni quien se escribe «directivo» en allRoles con otra raíz', exp: 'DENY',
          user: U('parent', 'clubA', { allRoles: [{ role: 'directivo', clubId: 'clubA', isAuthorized: true, status: 'active' }] }),
          existing: { data: STATS() }, req: { auth: A('dv'), path: PS, method: 'get' } },
        { n: '2g · CONTROL · una familia sigue sin leerlas', exp: 'DENY', user: U('parent'),
          existing: { data: STATS() }, req: { auth: A('fa'), path: PS, method: 'get' } },
        { n: '2h · 🔑 el partido en vivo de CUALQUIER categoría de su club se lee', exp: 'ALLOW', user: U('directivo'),
          existing: { data: LIVEDOC({ category: 'f11_regional' }) }, req: { auth: A('dv'), path: PL, method: 'get' } },
        { n: '2i · 🔑 y la lista (live_index) también', exp: 'ALLOW', user: U('directivo'),
          existing: { data: LIVEDOC() }, req: { auth: A('dv'), path: PI, method: 'get' } },
        { n: '2j · ⚠️ el de OTRO club no', exp: 'DENY', user: U('directivo', 'clubB'),
          existing: { data: LIVEDOC() }, req: { auth: A('dv'), path: PL, method: 'get' } },
        // 🔴 Lo que destapó este guard: `userDocClubId` (pertenencia al club)
        // concede ESCRIBIR en ~40 sitios. El directivo ya no la hereda.
        { n: '2k · 🔑🔑 y no puede tocar el partido en vivo', exp: 'DENY', user: U('directivo'),
          existing: { data: LIVEDOC() }, req: { auth: A('dv'), path: PL, method: 'update', resource: { data: LIVEDOC({ scoreHome: 9 }) } } },
        { n: '2l · 🔑🔑 ni borrarlo', exp: 'DENY', user: U('directivo'),
          existing: { data: LIVEDOC() }, req: { auth: A('dv'), path: PL, method: 'delete' } },
        { n: '2m · 🔑🔑 ni borrarlo de la lista (live_index)', exp: 'DENY', user: U('directivo'),
          existing: { data: LIVEDOC() }, req: { auth: A('dv'), path: PI, method: 'delete' } },
        { n: '2n · 🔑 ni ve Partidos Terminados (sólo En Vivo)', exp: 'DENY', user: U('directivo'),
          existing: { data: LIVEDOC({ status: 'finished' }) }, req: { auth: A('dv'), path: `${DB}/finished_index/m1`, method: 'get' } },
        { n: '2o · 🔑 ni lee el plan semanal de entrenamientos', exp: 'DENY', user: U('directivo'),
          existing: { data: { clubId: 'clubA' } }, req: { auth: A('dv'), path: `${DB}/trainingPlans/clubA/weeks/w1`, method: 'get' } },
        { n: '2p · ni con el CLAIM de su club en el token', exp: 'DENY', user: U('directivo'),
          existing: { data: LIVEDOC() },
          req: { auth: { uid: 'dv', token: { email: 'dv@x.es', role: 'directivo', clubId: 'clubA', firebase: { sign_in_provider: 'password' } } },
                 path: PL, method: 'update', resource: { data: LIVEDOC({ scoreHome: 9 }) } } },
        { n: '2q · 🔑 sí lee el documento de su club (sus extras)', exp: 'ALLOW', user: U('directivo'),
          existing: { data: { adminUid: 'adm', name: 'CD Prueba' } }, req: { auth: A('dv'), path: `${DB}/clubs/clubA`, method: 'get' } },
        // CONTROLES: lo que se ha tocado (sameClubAsDoc / userDocClubId) es de
        // todo el fichero; los demás roles tienen que seguir igual.
        { n: '2r · CONTROL · el entrenador del club sigue actualizando su partido en vivo', exp: 'ALLOW', user: U('user'),
          existing: { data: LIVEDOC() }, req: { auth: A('co'), path: PL, method: 'update', resource: { data: LIVEDOC({ scoreHome: 1 }) } } },
        { n: '2s · CONTROL · y con el claim del club, también', exp: 'ALLOW', user: U('user'),
          existing: { data: LIVEDOC() },
          req: { auth: { uid: 'co', token: { email: 'co@x.es', role: 'user', clubId: 'clubA', firebase: { sign_in_provider: 'password' } } },
                 path: PL, method: 'update', resource: { data: LIVEDOC({ scoreHome: 1 }) } } },
        { n: '2t · CONTROL · la familia sigue viendo el partido en vivo de su club', exp: 'ALLOW', user: U('parent'),
          existing: { data: LIVEDOC() }, req: { auth: A('fa'), path: PL, method: 'get' } },
        { n: '2u · CONTROL · el entrenador sigue viendo Partidos Terminados', exp: 'ALLOW', user: U('user'),
          existing: { data: LIVEDOC({ status: 'finished' }) }, req: { auth: A('co'), path: `${DB}/finished_index/m1`, method: 'get' } },
        { n: '2v · CONTROL · y el documento de su club', exp: 'ALLOW', user: U('user'),
          existing: { data: { adminUid: 'adm', name: 'CD Prueba' } }, req: { auth: A('co'), path: `${DB}/clubs/clubA`, method: 'get' } },
    ];
    const testCases = casos.map(c => {
        const tc = { expectation: c.exp, request: Object.assign({ time: iso(AHORA) }, c.req), functionMocks: mocks(c), pathEncoding: 'PLAIN' };
        if (c.existing) tc.resource = c.existing;
        return tc;
    });
    const r = await post(tk, { source: { files: [{ name: 'firestore.rules', content: leer('firestore.rules') }] }, testSuite: { testCases } });
    if (r.status !== 200) { ok('la Rules API responde 200', false, r.body.slice(0, 500)); return; }
    const res = JSON.parse(r.body);
    const graves = (res.issues || []).filter(i => i.severity === 'ERROR');
    ok('firestore.rules compila', graves.length === 0, graves);
    // Un DENY por AVERÍA (clave ausente, mock que falta) saldría «bien» por el
    // motivo equivocado: la única forma de distinguirlo es `errorPosition`.
    const averias = (res.testResults || []).flatMap((t, i) => t.errorPosition ? [casos[i].n + ' ' + JSON.stringify(t.debugMessages || '')] : []);
    ok('🔑 ninguna evaluación se averió (los DENY lo son por lógica)', averias.length === 0, averias);
    (res.testResults || []).forEach((t, i) => ok(casos[i].n + '  [espera ' + casos[i].exp + ']', t.state === 'SUCCESS',
        { estado: t.state, debug: t.debugMessages, pos: t.errorPosition }));
}

function fin() {
    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
}

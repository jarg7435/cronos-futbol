// ─────────────────────────────────────────────────────────────────────────
//  test_clips_video.js  ·  🎬 v804
//
//  Encargo del autor (implementar.txt 2026-10-11, capturas 11321-11322) y
//  sus decisiones: vídeos cortos adjuntos a sucesos; UNA reproducción por
//  cuenta (visto = abierto, v808); marca de agua;
//  borrado a las 24 h; menores → sólo cuerpo técnico, adultos → también
//  jugadores y familias si se habilita; extra `modulo_videos` apagado por
//  defecto.
//
//  PARTE 1 · el módulo (js/match/events/match-clips.js), EJECUTADO.
//  PARTE 2 · firestore.rules (cronos_clips + vistas) por la Rules API.
//  PARTE 3 · storage.rules (descarga y subida) por la Rules API.
//  Proyecto de TESTEO; sin sesión del CLI las partes 2-3 se SALTAN con aviso.
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

console.log('\n── PARTE 1 · el módulo ──');
const parte1 = (async () => {   // async: 1f3 espera al reloj de 5 s
    const win = { _cronosCurrentUser: { uid: 'u1', role: 'user', clubId: 'clubA', extras: {} } };
    const sb = { window: win, console, document: {}, URL: {}, Date, Math, JSON, Object, Array, String, Number, Promise };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(leer('js/match/events/match-clips.js'), sb, { filename: 'match-clips.js' });
    const C = win.CronosClips;
    ok('1a · 🔑 extra AUSENTE = APAGADO', C.activo() === false);
    win._cronosCurrentUser.extras.modulo_videos = true;
    ok('1b · y con el extra a true, activo', C.activo() === true);
    win._cronosCurrentUser.extras.modulo_videos = 'si';
    ok('1c · ⚠️ sólo vale `true` (no cualquier valor)', C.activo() === false);
    const adultos = ['regional', 'Regional FEM', 'f11_regional', 'nacional', 'senior'];
    const menores = ['juvenil', 'f11_juvenil', 'cadete', 'infantil', 'alevin', 'f7_alevin', 'benjamin', 'prebenjamín', 'futurefem', ''];
    ok('1d · 🔑 adultos: Regional, Regional FEM, Nacional, Senior', adultos.every(c => C.esAdultos(c)), adultos.map(c => [c, C.esAdultos(c)]));
    ok('1e · 🔑🔑 menores: Juvenil hacia abajo y FUTureFEM (y sin categoría)', menores.every(c => !C.esAdultos(c)), menores.map(c => [c, C.esAdultos(c)]));
    ok('1f · el módulo publica lo necesario', ['subir', 'listar', 'abrirLista', 'ver', 'cerrarVisor', 'compruebaFichero'].every(k => typeof C[k] === 'function'));

    // 🎬 v806 · cualquier vídeo: el tipo se deduce si el móvil no lo da.
    const tv = (type, name) => C.tipoVideo({ type, name });
    ok('1f2 · 🔑 .MOV / .3gp / .mkv sin tipo o como octet-stream se reconocen',
       tv('', 'IMG_0001.MOV') === 'video/quicktime' && tv('application/octet-stream', 'a.3gp') === 'video/3gpp' &&
       tv('', 'x.mkv') === 'video/x-matroska' && tv('video/hevc', 'x.mp4') === 'video/hevc' && tv('', 'sin_ext') === 'video/mp4');
    // Un <video> falso que NUNCA avisa (códec ilegible sin evento): no debe colgarse.
    sb.document.createElement = () => ({ setAttribute() {} });
    sb.URL.createObjectURL = () => 'blob:x'; sb.URL.revokeObjectURL = () => {};
    sb.setTimeout = setTimeout; sb.clearTimeout = clearTimeout;
    const t0 = Date.now();
    const rMudo = await C.compruebaFichero({ type: '', name: 'clip.mov', size: 1e6 });
    ok('1f3 · 🔑🔑 un códec que el navegador no lee NO bloquea: a los 5 s vale igual',
       rMudo.ok === true && rMudo.duracion === 0 && rMudo.tipo === 'video/quicktime' && Date.now() - t0 < 7000, rMudo);
    const rImg = await C.compruebaFichero({ type: 'image/png', name: 'a.png', size: 1e3 });
    const rGordo = await C.compruebaFichero({ type: 'video/mp4', name: 'a.mp4', size: 60 * 1048576 });
    ok('1f4 · pero una imagen no, ni más de 50 MB', rImg.ok === false && rGordo.ok === false);

    const SRC = leer('js/match/events/match-clips.js').replace(/\/\/.*$/gm, '');
    ok('1g · 🔑🔑 NUNCA se pide un enlace público (getDownloadURL); se usa getBlob', !/getDownloadURL/.test(SRC) && /getBlob\(/.test(SRC));
    // 👁️ v808 · VISTO = ABIERTO (encargo del autor): se apunta al desplegar el
    // reproductor, ANTES de que se reproduzca nada; al cerrar sólo se reintenta.
    const iSes = SRC.indexOf('_sesion = { clipId, url,');
    const iMarca = SRC.indexOf('_marcaVisto(false);', iSes);
    const iPinta = SRC.indexOf('capa.innerHTML =', iSes);
    ok('1h · 🔑🔑 la vista se apunta AL ABRIR el reproductor (antes de pintarlo)',
       iSes > 0 && iMarca > iSes && iMarca < iPinta);
    ok('1h2 · ya no depende de terminarlo ni de pasar la mitad',
       !/_pasoLaMitad|duracion \/ 2|'ended'/.test(SRC));
    ok('1h3 · si la escritura falla, se reintenta al cerrar (s.marcado sólo tras escribir)',
       /await fs\.setDoc\(fs\.doc\(_db\(\), COL, s\.clipId, 'vistas', me\.uid\)[\s\S]{0,300}s\.marcado = true;/.test(SRC) &&
       /function cerrarVisor\(\) \{[\s\S]{0,120}_marcaVisto\(false\);/.test(SRC));
    ok('1i · 🔑 marca de agua con nombre y correo del que mira, y una marca que se mueve',
       /me\.email/.test(SRC) && /cronos-clip-marca-viva/.test(SRC) && /setInterval\(/.test(SRC));
    ok('1j · reproductor sin descarga ni PiP ni menú contextual',
       /controlsList="nodownload/.test(SRC) && /disablePictureInPicture/.test(SRC) && /oncontextmenu="return false;"/.test(SRC));
    ok('1k · la ficha caduca a las 24 h', /const VIDA_MS = 24 \* 60 \* 60 \* 1000;/.test(SRC) && /expiresAt: fs\.Timestamp\.fromMillis\(ahora \+ VIDA_MS\)/.test(SRC));
    ok('1l · 🔑 las familias consultan SÓLO audiencia familias (si no, las reglas rechazan la consulta)',
       /filtros\.push\(fs\.where\('audiencia', '==', 'familias'\)\)/.test(SRC));

    const RM = leer('js/match/events/retroactive-modal.js');
    ok('1m · el modal de sucesos ofrece el vídeo sólo con el extra',
       /window\.CronosClips && window\.CronosClips\.activo\(\)\) \? `\s*<div id="retro-clip-box"/.test(RM));
    // 🎬 v806 · grabar y galería SEPARADOS: con capture el sistema sólo abre la cámara.
    const inputs = RM.match(/<input type="file"[^>]*>/g) || [];
    ok('1m2 · 🔑 «Grabar» (cámara) y «Galería» (sin capture) son dos entradas, ambas video/* sin códecs',
       inputs.length === 2 && inputs.every(t => /accept="video\/\*"/.test(t)) &&
       inputs.some(t => /id="retro-clip-camara"/.test(t) && /capture="environment"/.test(t)) &&
       inputs.some(t => /id="retro-clip-input"/.test(t) && !/capture=/.test(t)), inputs);
    ok('1n · y los vídeos se suben DESPUÉS de registrar los sucesos', RM.indexOf('const _vid = await _subeClips(items);') > RM.indexOf('_informePendiente = _informes ? null : cambios;'));
    const PP = leer('js/parent/panel.js');
    ok('1o · 🔑 la familia sólo ve la tarjeta en categorías de adultos',
       /window\.CronosClips\.activo\(_yo\) && window\.CronosClips\.esAdultos\(_cat\)/.test(PP));
    const FB = JSON.parse(leer('firebase.json'));
    const ign = (Array.isArray(FB.hosting) ? FB.hosting : [FB.hosting]).every(h => (h.ignore || []).indexOf('storage.rules') >= 0);
    ok('1p · storage.rules registrado y FUERA del hosting público', FB.storage && FB.storage.rules === 'storage.rules' && ign);
    // 🚨 v807 · sin media-src, la CSP cae en default-src 'self' y el navegador
    // BLOQUEA el vídeo blob: → TODOS los clips daban «no puede reproducir el formato».
    const csp = JSON.stringify(FB.hosting).match(/Content-Security-Policy","value":"([^"]*)"/);
    ok('1p2 · 🔑🔑 la CSP deja reproducir vídeo blob: (media-src)', !!csp && /media-src [^;]*blob:/.test(csp[1]), csp && csp[1].slice(0, 120));
    const MC = leer('js/match/events/match-clips.js');
    ok('1p3 · 🗑️ la lista ofrece Borrar a quien puede, y borra fichero y ficha',
       /puedeBorrar\(c, me\)/.test(MC) && /window\.CronosClips\.borrar\(/.test(MC) &&
       MC.indexOf('st.deleteObject(') > 0 && MC.indexOf('st.deleteObject(') < MC.indexOf('fs.deleteDoc(fs.doc(db, COL, clipId))'));
    const yo = { uid: 'u9', role: 'user' };
    ok('1p4 · puedeBorrar: el suyo sí, el ajeno no; Dirección todos',
       C.puedeBorrar({ uploaderUid: 'u9' }, yo) && !C.puedeBorrar({ uploaderUid: 'x' }, yo) &&
       C.puedeBorrar({ uploaderUid: 'x' }, { uid: 'd', role: 'director' }) && !C.puedeBorrar({ uploaderUid: 'x' }, { uid: 'f', role: 'parent' }));
    // 🚨 Storage sólo deja consultar DOS documentos de Firestore por petición (medido
    // en testeo: con tres, toda descarga daba «Permission denied»). La descarga mira
    // vista + usuario; la subida, usuario + club. Leer la ficha sería el tercero.
    const SR = leer('storage.rules').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const docs = new Set([...SR.matchAll(/\/documents\/([a-z_]+\/\$\([^)]*\)(?:\/[a-z_]+\/\$\([^)]*\))?)/g)].map(m => m[1]));
    const PERMITIDOS = ['users/$(request.auth.uid)', 'clubs/$(clubId)', 'cronos_clips/$(clipId)/vistas/$(request.auth.uid)'];
    ok('1q · 🔑 storage.rules consulta sólo usuario, club y vista (nunca la ficha)',
        docs.size === 3 && [...docs].every(d => PERMITIDOS.includes(d)), [...docs]);
    ok('1r · 🔑 el fichero sube con su audiencia y categoría en los metadatos',
        /customMetadata:\s*\{[^}]*audiencia[^}]*categoria/.test(leer('js/match/events/match-clips.js')));
})();

// ═══════════════════════════════════════════════════════════════════════
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
const AHORA = Date.now(), H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const U = (role, club, extra) => Object.assign({ role, clubId: club || 'clubA', isAuthorized: true }, extra || {});
const CLUB = { adminUid: 'adm', extras: { modulo_videos: true } };

async function lote(tk, nombre, fichero, casos, mocksDe) {
    const source = { files: [{ name: nombre, content: leer(fichero) }] };
    const testCases = casos.map(c => {
        const tc = { expectation: c.exp, request: Object.assign({ time: iso(AHORA) }, c.req), functionMocks: mocksDe(c), pathEncoding: 'PLAIN' };
        if (c.existing) tc.resource = c.existing;
        return tc;
    });
    const r = await post(tk, { source, testSuite: { testCases } });
    if (r.status !== 200) { ok(nombre + ' · la Rules API responde 200', false, r.body.slice(0, 600)); return; }
    const res = JSON.parse(r.body);
    const graves = (res.issues || []).filter(i => i.severity === 'ERROR');
    ok(nombre + ' · compila', graves.length === 0, graves);
    const errores = (res.testResults || []).flatMap((t, i) => t.errorPosition ? [casos[i].n + ' ' + JSON.stringify(t.errorPosition) + ' ' + JSON.stringify(t.debugMessages || '')] : []);
    ok(nombre + ' · 🔑 ninguna evaluación se averió', errores.length === 0, errores);
    (res.testResults || []).forEach((t, i) => ok(casos[i].n + '  [espera ' + casos[i].exp + ']', t.state === 'SUCCESS', { estado: t.state, debug: t.debugMessages }));
}

(async () => {
    await parte1;
    let tk;
    try { tk = await token(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens.refresh_token); }
    catch (e) { console.log('SKIP · sin sesión del CLI: partes 2-3 sin evaluar'); return fin(); }

    // ── PARTE 2 · firestore.rules ────────────────────────────────────
    console.log('\n── PARTE 2 · firestore.rules: cronos_clips ──');
    const P = `${DB}/cronos_clips/c1`;
    const FICHA = (over) => Object.assign({ clipId: 'c1', clubId: 'clubA', uploaderUid: 'coach', audiencia: 'staff',
        categoria: 'alevin', expiresAt: iso(AHORA + 24 * H) }, over || {});
    const fsMocks = (c) => {
        const uid = c.req.auth.uid;
        return [
            { function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: true } },
            { function: 'get', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data: c.user } } },
            { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: true } },
            { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
            { function: 'exists', args: [{ exactValue: `${DB}/clubs/clubA` }], result: { value: true } },
            { function: 'get', args: [{ exactValue: `${DB}/clubs/clubA` }], result: { value: { data: c.club || CLUB } } },
        ];
    };
    const A = (uid) => ({ uid, token: { email: uid + '@x.es', firebase: { sign_in_provider: 'password' } } });
    const cr = (n, exp, uid, user, data, club) => ({ n, exp, user, club, req: { auth: A(uid), path: P, method: 'create', resource: { data } } });
    const rd = (n, exp, uid, user, existente) => ({ n, exp, user, existing: { data: existente }, req: { auth: A(uid), path: P, method: 'get' } });
    await lote(tk, 'firestore.rules', 'firestore.rules', [
        cr('2a · el entrenador sube un clip de su club (menores, sólo staff)', 'ALLOW', 'coach', U('user'), FICHA()),
        cr('2b · 🔑🔑 NO puede abrirlo a familias en una categoría de MENORES', 'DENY', 'coach', U('user'), FICHA({ audiencia: 'familias' })),
        cr('2c · 🔑 en categoría de adultos SÍ puede abrirlo a familias', 'ALLOW', 'coach', U('user'), FICHA({ audiencia: 'familias', categoria: 'regional' })),
        cr('2d · 🔑 sin el extra en el club no se crea nada', 'DENY', 'coach', U('user'), FICHA(), { extras: {} }),
        cr('2e · una familia no sube vídeos', 'DENY', 'fam', U('parent'), FICHA({ uploaderUid: 'fam' })),
        cr('2f · ni se firma con el uid de otro', 'DENY', 'coach', U('user'), FICHA({ uploaderUid: 'otro' })),
        cr('2g · ⚠️ ni con caducidad de más de 25 h', 'DENY', 'coach', U('user'), FICHA({ expiresAt: iso(AHORA + 72 * H) })),
        cr('2h · ni en un club ajeno', 'DENY', 'coach', U('user', 'clubB'), FICHA()),
        rd('2i · 🔑 el cuerpo técnico lee la ficha de menores', 'ALLOW', 'dir', U('director'), FICHA()),
        rd('2j · 🔑🔑 una familia NO lee la ficha de menores', 'DENY', 'fam', U('parent'), FICHA()),
        rd('2k · una familia SÍ lee la de adultos abierta a familias', 'ALLOW', 'fam', U('parent'), FICHA({ audiencia: 'familias', categoria: 'regional' })),
        rd('2l · ⚠️ un usuario que se autoescribe «director» en allRoles sigue siendo familia', 'DENY', 'fam',
           U('parent', 'clubA', { allRoles: [{ role: 'director', clubId: 'clubA' }] }), FICHA()),
        { n: '2m · el usuario apunta SU vista', exp: 'ALLOW', user: U('director'),
          req: { auth: A('dir'), path: `${P}/vistas/dir`, method: 'create', resource: { data: { uid: 'dir', at: iso(AHORA), completo: true, expiresAt: iso(AHORA + 25 * H) } } } },
        { n: '2n · ⚠️ y no la de otro', exp: 'DENY', user: U('director'),
          req: { auth: A('dir'), path: `${P}/vistas/otro`, method: 'create', resource: { data: { uid: 'otro', at: iso(AHORA), completo: true, expiresAt: iso(AHORA + 25 * H) } } } },
        { n: '2o · 🔑 ni borrar su vista para volver a verlo', exp: 'DENY', user: U('director'),
          existing: { data: { uid: 'dir' } }, req: { auth: A('dir'), path: `${P}/vistas/dir`, method: 'delete' } },
        // 🗑️ v807 · borrar la ficha: quien la subió y Dirección.
        { n: '2p · 🔑 quien lo subió borra su clip', exp: 'ALLOW', user: U('user'),
          existing: { data: FICHA() }, req: { auth: A('coach'), path: P, method: 'delete' } },
        { n: '2q · 🔑 el Director borra el clip de otro', exp: 'ALLOW', user: U('director'),
          existing: { data: FICHA() }, req: { auth: A('dir'), path: P, method: 'delete' } },
        { n: '2r · el Coordinador por la lista del club (rol raíz entrenador)', exp: 'ALLOW', user: U('user'),
          club: Object.assign({}, CLUB, { coordinatorUids: ['coo'] }),
          existing: { data: FICHA() }, req: { auth: A('coo'), path: P, method: 'delete' } },
        { n: '2s · ⚠️ otro entrenador NO borra un clip ajeno', exp: 'DENY', user: U('user'),
          existing: { data: FICHA() }, req: { auth: A('otro'), path: P, method: 'delete' } },
        { n: '2t · ⚠️ ni un Director de OTRO club', exp: 'DENY', user: U('director', 'clubB'),
          existing: { data: FICHA() }, req: { auth: A('dir'), path: P, method: 'delete' } },
        { n: '2u · ⚠️ ni quien se escribe «director» en allRoles', exp: 'DENY', user: U('user', null, { allRoles: [{ role: 'director' }] }),
          existing: { data: FICHA() }, req: { auth: A('otro'), path: P, method: 'delete' } },
        { n: '2v · ⚠️ ni una familia', exp: 'DENY', user: U('parent'),
          existing: { data: FICHA({ audiencia: 'familias', categoria: 'regional' }) }, req: { auth: A('fam'), path: P, method: 'delete' } },
        // 🏢 v812 · El Directivo / Empleado VE como el cuerpo técnico (también
        // menores: decisión del autor), pero no sube ni borra.
        rd('2w · 🔑 el directivo VE un clip de MENORES (sólo cuerpo técnico) de su club', 'ALLOW', 'dv', U('directivo'), FICHA()),
        rd('2x · ⚠️ pero no el de otro club', 'DENY', 'dv', U('directivo', 'clubB'), FICHA()),
        rd('2y · ⚠️ ni sin estar aprobado', 'DENY', 'dv', U('directivo', 'clubA', { isAuthorized: false }), FICHA()),
        cr('2z · 🔑🔑 el directivo NO sube clips', 'DENY', 'dv', U('directivo'), FICHA({ uploaderUid: 'dv', expiresAt: iso(AHORA + 20 * H) })),
        { n: '2za · 🔑🔑 ni los borra', exp: 'DENY', user: U('directivo'),
          existing: { data: FICHA() }, req: { auth: A('dv'), path: P, method: 'delete' } },
        { n: '2zb · y apunta SU vista (vista única)', exp: 'ALLOW', user: U('directivo'),
          req: { auth: A('dv'), path: `${P}/vistas/dv`, method: 'create', resource: { data: { uid: 'dv', at: iso(AHORA), completo: false, expiresAt: iso(AHORA + 25 * H) } } } },
    ], fsMocks);

    // ── PARTE 3 · storage.rules ──────────────────────────────────────
    console.log('\n── PARTE 3 · storage.rules: descarga y subida ──');
    const SP = '/b/cronos-futbol-test.firebasestorage.app/o/clips/clubA/c1';
    const stMocks = (c) => {
        const uid = c.req.auth ? c.req.auth.uid : 'nadie';
        return [
            { function: 'firestore.exists', args: [{ exactValue: `/databases/(default)/documents/users/${uid}` }], result: { value: true } },
            { function: 'firestore.get', args: [{ exactValue: `/databases/(default)/documents/users/${uid}` }], result: { value: { data: c.user } } },
            { function: 'firestore.exists', args: [{ exactValue: '/databases/(default)/documents/cronos_clips/c1' }], result: { value: !!c.ficha } },
            { function: 'firestore.get', args: [{ exactValue: '/databases/(default)/documents/cronos_clips/c1' }], result: { value: { data: c.ficha || {} } } },
            { function: 'firestore.exists', args: [{ exactValue: `/databases/(default)/documents/cronos_clips/c1/vistas/${uid}` }], result: { value: !!c.visto } },
            { function: 'firestore.exists', args: [{ exactValue: '/databases/(default)/documents/clubs/clubA' }], result: { value: true } },
            { function: 'firestore.get', args: [{ exactValue: '/databases/(default)/documents/clubs/clubA' }], result: { value: { data: c.club || CLUB } } },
        ];
    };
    // El fichero ya subido: metadatos fijados al subir + timeCreated del servidor.
    const OBJ = (meta, creado) => ({ name: 'clips/clubA/c1', size: 5 * 1024 * 1024, contentType: 'video/mp4',
        timeCreated: iso(creado == null ? AHORA - H : creado),
        metadata: Object.assign({ uploader: 'coach', clipId: 'c1', audiencia: 'staff', categoria: 'alevin' }, meta || {}) });
    const lee = (n, exp, uid, user, obj, visto) => ({ n, exp, user, visto, existing: obj, req: { auth: uid ? A(uid) : null, path: SP, method: 'get' } });
    const META = (uid, over) => Object.assign({ uploader: uid, clipId: 'c1', audiencia: 'staff', categoria: 'alevin' }, over || {});
    const sube = (n, exp, uid, user, res, club) => ({ n, exp, user, club,
        req: { auth: A(uid), path: SP, method: 'create',
               resource: Object.assign({ size: 5 * 1024 * 1024, contentType: 'video/mp4', metadata: META(uid) }, res || {}) } });
    const borra = (n, exp, uid, user, club) => ({ n, exp, user, club, existing: OBJ(),
        req: { auth: A(uid), path: SP, method: 'delete' } });
    await lote(tk, 'storage.rules', 'storage.rules', [
        lee('3a · 🔑 el cuerpo técnico descarga el clip (primera vez)', 'ALLOW', 'dir', U('director'), OBJ(), false),
        lee('3b · 🔑🔑 VISTA ÚNICA: tras su vista ya NO lo descarga', 'DENY', 'dir', U('director'), OBJ(), true),
        lee('3c · 🔑🔑 una familia NO descarga un clip de menores', 'DENY', 'fam', U('parent'), OBJ(), false),
        lee('3d · una familia SÍ el de adultos abierto a familias', 'ALLOW', 'fam', U('parent'), OBJ({ audiencia: 'familias', categoria: 'regional' }), false),
        lee('3e · ⚠️ subido hace más de 24 h: nadie', 'DENY', 'dir', U('director'), OBJ(null, AHORA - 25 * H), false),
        lee('3f · ⚠️ sin sesión: nadie', 'DENY', null, U('director'), OBJ(), false),
        lee('3g · un miembro de otro club no', 'DENY', 'dir', U('director', 'clubB'), OBJ(), false),
        sube('3h · el entrenador sube un vídeo de su club', 'ALLOW', 'coach', U('user')),
        sube('3i · ⚠️ de más de 50 MB no', 'DENY', 'coach', U('user'), { size: 60 * 1024 * 1024 }),
        sube('3j · ⚠️ ni algo que no sea vídeo', 'DENY', 'coach', U('user'), { contentType: 'image/png' }),
        sube('3k · 🔑 sin el extra del club no', 'DENY', 'coach', U('user'), null, { extras: {} }),
        sube('3l · una familia no sube', 'DENY', 'fam', U('parent')),
        sube('3m · el de adultos abierto a familias sí', 'ALLOW', 'coach', U('user'), { metadata: META('coach', { audiencia: 'familias', categoria: 'regional' }) }),
        sube('3n · 🔑🔑 uno de MENORES marcado para familias NO', 'DENY', 'coach', U('user'), { metadata: META('coach', { audiencia: 'familias', categoria: 'alevin' }) }),
        sube('3o · ⚠️ sin audiencia no', 'DENY', 'coach', U('user'), { metadata: { uploader: 'coach', clipId: 'c1' } }),
        sube('3p · ⚠️ firmado con otro uid no', 'DENY', 'coach', U('user'), { metadata: META('otro') }),
        // 🗑️ v807 · borrar el fichero: quien lo subió y Dirección.
        borra('3q · 🔑 quien lo subió borra el fichero', 'ALLOW', 'coach', U('user')),
        borra('3r · 🔑 el Director borra el de otro', 'ALLOW', 'dir', U('director')),
        borra('3s · el Coordinador por la lista del club', 'ALLOW', 'coo', U('user'), Object.assign({}, CLUB, { coordinatorUids: ['coo'] })),
        borra('3t · ⚠️ otro entrenador NO', 'DENY', 'otro', U('user')),
        borra('3u · ⚠️ ni un Director de otro club', 'DENY', 'dir', U('director', 'clubB')),
        borra('3v · ⚠️ ni una familia', 'DENY', 'fam', U('parent')),
        // 🏢 v812 · El Directivo / Empleado reproduce como el cuerpo técnico.
        lee('3w · 🔑 el directivo reproduce un clip de MENORES de su club', 'ALLOW', 'dv', U('directivo'), OBJ(), false),
        lee('3x · 🔑🔑 VISTA ÚNICA también para él', 'DENY', 'dv', U('directivo'), OBJ(), true),
        lee('3y · ⚠️ ni el de otro club', 'DENY', 'dv', U('directivo', 'clubB'), OBJ(), false),
        sube('3z · 🔑🔑 el directivo NO sube', 'DENY', 'dv', U('directivo')),
        borra('3za · 🔑🔑 ni borra', 'DENY', 'dv', U('directivo')),
    ], stMocks);

    fin();
})();

function fin() {
    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
}

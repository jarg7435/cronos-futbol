// ═══════════════════════════════════════════════════════════════════════════
//  scripts/ops/e2e_storage_testeo.js
//  PRUEBA E2E REAL DE STORAGE (vídeos de jugadas) CONTRA EL BUCKET DE TESTEO
//
//  Reauditoría 19-11: «E2E real de Storage en navegador con un caso permitido y
//  varios rechazados». Los guards (test_clips_video.js) prueban las reglas con
//  el simulador; esto las prueba DE VERDAD: cuentas reales de testeo, App Check,
//  el bucket real y Firestore real.
//
//  Requisitos: `node scripts/semilla_e2e_testeo.js --escribir` (clubes E2E
//  NORTE y SUR) y la contraseña común de testeo en ~/cronos_testeo/contrasena.txt.
//
//  Uso:
//    node scripts/ops/e2e_storage_testeo.js              → enseña el plan, no hace nada
//    node scripts/ops/e2e_storage_testeo.js --ejecutar   → ejecuta en TESTEO
//
//  Lo que hace al ejecutar (y deshace siempre, también si falla):
//   1. crea un token de depuración de App Check SÓLO en testeo (Auth y Firestore
//      exigen App Check) → lo BORRA al terminar y comprueba que no queda ninguno;
//   2. apaga el extra «Vídeos» en E2E CLUB SUR (caso N8) → lo vuelve a encender;
//   3. ejecuta los casos con vídeos FALSOS (bytes generados, tipo video/mp4);
//   4. borra todo lo subido (ficheros, fichas y vistas con prefijo e2e_).
//
//  🔒 Proyecto FIJADO a testeo: cualquier URL de producción aborta el proceso.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const P = 'cronos-futbol-test';
const APP_ID = '1:899742404040:web:1e76b2a8fa22a21dd0c4fd';
const API_KEY = 'AIzaSyD9XUnOOePDBQ_S3xXrqMqYr4WyIBN10Mc';           // clave web pública de testeo
const BUCKET = 'cronos-futbol-test.firebasestorage.app';
const REFERER = 'https://cronos-futbol-test.web.app/';
const PROHIBIDO = /cronos-futbol-app|393110572633/;
const EJECUTAR = process.argv.includes('--ejecutar');
const NORTE = 'club_test_e2e_norte', SUR = 'club_test_e2e_sur';
const CUENTAS = {
    n_coach: 'jarg7435+e2enortecoach@gmail.com',
    n_dir: 'jarg7435+e2enortedirector@gmail.com',
    n_familia: 'jarg7435+e2enortefamilia@gmail.com',
    s_coach: 'jarg7435+e2esurcoach@gmail.com',
};
const SELLO = 'e2e_' + Date.now().toString(36);

// ── Red, con cerrojo de proyecto ─────────────────────────────────────────
function req(url, { method = 'GET', headers = {}, body = null } = {}) {
    if (PROHIBIDO.test(url) || PROHIBIDO.test(String(body && !Buffer.isBuffer(body) ? body : ''))) {
        console.error('🛑 ABORTADO: petición hacia PRODUCCIÓN → ' + url); process.exit(3);
    }
    const u = new URL(url);
    return new Promise((res, rej) => {
        const h = { ...headers };
        if (body) h['Content-Length'] = Buffer.byteLength(body);
        const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: h }, (x) => {
            const c = []; x.on('data', (d) => c.push(d));
            x.on('end', () => { const t = Buffer.concat(c).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (_) {} res({ st: x.statusCode, t, j }); });
        });
        r.on('error', rej); if (body) r.write(body); r.end();
    });
}
const J = (o) => JSON.stringify(o);

// Token OAuth del CLI (operaciones de administración en TESTEO).
async function oauth() {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
    const rt = (cfg.tokens && cfg.tokens.refresh_token) || (cfg.user && cfg.user.tokens && cfg.user.tokens.refresh_token);
    const b = new URLSearchParams({ client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', refresh_token: rt, grant_type: 'refresh_token' }).toString();
    const r = await req('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b });
    if (!r.j || !r.j.access_token) throw new Error('sin token del CLI'); return r.j.access_token;
}

// ── Casos ────────────────────────────────────────────────────────────────
const CASOS = [
    ['P1', 'Entrenador Norte sube un clip (staff) + su ficha', 'permitido'],
    ['P2', 'Director Norte lo ve por primera vez (y marca la vista)', 'permitido'],
    ['P3', 'Director Norte lo ve por segunda vez', 'denegado (vista única)'],
    ['N1', 'Entrenador SUR ve el clip de Norte', 'denegado (otro club)'],
    ['N2', 'Familia Norte ve un clip de audiencia staff', 'denegado (audiencia)'],
    ['N3', 'Entrenador Norte sube con uploader de otro', 'denegado'],
    ['N4', 'Entrenador Norte sube para familias con categoría Alevín', 'denegado (menores)'],
    ['N5', 'Entrenador Norte (Alevín) sube para familias DECLARANDO senior', 'denegado (sospecha)'],
    ['N6', 'Entrenador Norte sube una imagen, no un vídeo', 'denegado'],
    ['N7', 'Entrenador Norte sube más de 50 MB', 'denegado'],
    ['N8', 'Entrenador Sur sube con el extra apagado', 'denegado'],
    ['N9', 'Familia Norte intenta subir', 'denegado'],
    ['N10', 'Entrenador Norte sobrescribe un clip existente', 'denegado'],
    ['N11', 'Familia Norte (no lo subió ni es Dirección) lo borra', 'denegado'],
    ['N12', 'Sin sesión: lee y sube', 'denegado'],
    ['N13', 'Entrenador Norte escribe fuera de clips/', 'denegado'],
    ['P4', 'Director Norte borra el clip (no es suyo)', 'permitido'],
    // v860 · el lado PERMITIDO de N5: quien figura en clubs/{id}.plazasAdultas.
    ['P5', 'Entrenador Norte EN plazasAdultas sube para familias (regional) y la Familia lo ve', 'permitido'],
];

if (!EJECUTAR) {
    console.log(`\nE2E de Storage en ${P} · PLAN (no se hace nada; añade --ejecutar)\n`);
    for (const [id, d, e] of CASOS) console.log(`  ${id.padEnd(4)} ${d.padEnd(66)} → ${e}`);
    console.log('\n  + token de App Check temporal en testeo (se borra) · extra de Sur apagado y restaurado · limpieza de e2e_*\n');
    process.exit(0);
}

(async () => {
    const tk = await oauth();
    const A = { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' };
    const AC = `https://firebaseappcheck.googleapis.com/v1/projects/${P}/apps/${APP_ID}`;
    const FS = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
    const ST = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;
    const resultados = [];
    let debugName = null, surApagado = false;
    let listaNortePrevia;            // v860 · undefined = no se ha tocado
    const leerLista = async () => {
        const r = await req(`${FS}/clubs/${NORTE}?mask.fieldPaths=plazasAdultas`, { headers: A });
        return (((r.j || {}).fields || {}).plazasAdultas || {}).arrayValue ? (r.j.fields.plazasAdultas.arrayValue.values || []).map((x) => x.stringValue) : [];
    };
    const ponerLista = (uids) => req(`${FS}/clubs/${NORTE}?updateMask.fieldPaths=plazasAdultas`, { method: 'PATCH', headers: A,
        body: J({ fields: { plazasAdultas: { arrayValue: { values: uids.map((u) => ({ stringValue: u })) } } } }) });
    const subidos = new Set();

    try {
        // 1 · token de depuración temporal
        const debugSecret = crypto.randomUUID();
        const c = await req(AC + '/debugTokens', { method: 'POST', headers: A, body: J({ displayName: SELLO + '-storage', token: debugSecret }) });
        if (c.st !== 200) throw new Error('no se pudo crear el token de depuración: ' + c.st + ' ' + c.t.slice(0, 200));
        debugName = c.j.name;
        console.log('  · token de depuración temporal creado en testeo');
        const ex = await req(AC + ':exchangeDebugToken?key=' + API_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: REFERER }, body: J({ debugToken: debugSecret }) });
        if (ex.st !== 200) throw new Error('canje del token de depuración: ' + ex.st + ' ' + ex.t.slice(0, 200));
        const appCheck = ex.j.token;

        // 2 · sesiones
        const clave = fs.readFileSync(path.join(os.homedir(), 'cronos_testeo', 'contrasena.txt'), 'utf8').trim();
        const S = {};
        for (const [k, email] of Object.entries(CUENTAS)) {
            const r = await req('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': appCheck, Referer: REFERER },
                body: J({ email, password: clave, returnSecureToken: true }) });
            if (r.st !== 200) throw new Error('inicio de sesión ' + k + ': ' + r.st + ' ' + ((r.j && r.j.error && r.j.error.message) || ''));
            S[k] = { uid: r.j.localId, id: r.j.idToken };
        }
        console.log('  · sesiones iniciadas: ' + Object.keys(S).join(', '));

        // 3 · apagar el extra en Sur (N8)
        const ps = await req(`${FS}/clubs/${SUR}?updateMask.fieldPaths=extras.modulo_videos`, { method: 'PATCH', headers: A,
            body: J({ fields: { extras: { mapValue: { fields: { modulo_videos: { booleanValue: false } } } } } }) });
        if (ps.st !== 200) throw new Error('apagar extra de Sur: ' + ps.st);
        surApagado = true;
        console.log('  · extra «Vídeos» apagado en E2E CLUB SUR\n');

        // ── ayudantes (como la app: fichero primero, ficha después) ──────
        const hU = (s) => (s ? { Authorization: 'Firebase ' + s.id, 'X-Firebase-AppCheck': appCheck } : {});
        const enc = (p) => encodeURIComponent(p);
        async function subir(s, ruta, { tipo = 'video/mp4', bytes = 2048, meta = {} } = {}) {
            const b = '----e2e' + crypto.randomBytes(8).toString('hex');
            const cabecera = Buffer.from(`--${b}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n` +
                J({ name: ruta, contentType: tipo, metadata: meta }) + `\r\n--${b}\r\nContent-Type: ${tipo}\r\n\r\n`);
            const cuerpo = Buffer.concat([cabecera, crypto.randomBytes(bytes), Buffer.from(`\r\n--${b}--\r\n`)]);
            const r = await req(`${ST}?name=${enc(ruta)}`, { method: 'POST',
                headers: { ...hU(s), 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': 'multipart/related; boundary=' + b }, body: cuerpo });
            if (r.st === 200) subidos.add(ruta);
            return r.st;
        }
        const leer = async (s, ruta) => (await req(`${ST}/${enc(ruta)}?alt=media`, { headers: hU(s) })).st;
        async function borrar(s, ruta) { const st = (await req(`${ST}/${enc(ruta)}`, { method: 'DELETE', headers: hU(s) })).st; if (st === 204 || st === 200) subidos.delete(ruta); return st; }
        const ts = (ms) => ({ timestampValue: new Date(ms).toISOString() });
        const fsH = (s) => ({ Authorization: 'Bearer ' + s.id, 'X-Firebase-AppCheck': appCheck, 'Content-Type': 'application/json' });
        async function ficha(s, clipId, club, audiencia, categoria) {
            const f = { clipId, clubId: club, path: `clips/${club}/${clipId}`, audiencia, categoria, uploaderUid: s.uid };
            const fields = {}; for (const [k, v] of Object.entries(f)) fields[k] = { stringValue: v };
            fields.createdAt = ts(Date.now()); fields.expiresAt = ts(Date.now() + 24 * 3600e3);
            return (await req(`${FS}/cronos_clips?documentId=${clipId}`, { method: 'POST', headers: fsH(s), body: J({ fields }) })).st;
        }
        async function vista(s, clipId) {
            const fields = { uid: { stringValue: s.uid }, at: ts(Date.now()), completo: { booleanValue: false }, expiresAt: ts(Date.now() + 24 * 3600e3) };
            return (await req(`${FS}/cronos_clips/${clipId}/vistas?documentId=${s.uid}`, { method: 'POST', headers: fsH(s), body: J({ fields }) })).st;
        }
        const meta = (s, clipId, audiencia, categoria) => ({ uploader: s.uid, clipId, audiencia, categoria });
        const OK = (st) => st === 200 || st === 204;
        const NO = (st) => st === 401 || st === 403;
        function apunta(id, esperaPermitido, obtenido, nota) {
            const ok = esperaPermitido ? obtenido.every(OK) : obtenido.every(NO);
            const caso = CASOS.find((x) => x[0] === id);
            resultados.push({ id, desc: caso[1], esperado: caso[2], obtenido: obtenido.join('/'), ok, nota: nota || '' });
            console.log(`  ${ok ? '✓' : '✗'} ${id.padEnd(4)} ${caso[1].padEnd(66)} esperado: ${caso[2].padEnd(24)} HTTP ${obtenido.join('/')}${nota ? '  · ' + nota : ''}`);
        }

        // ── casos ─────────────────────────────────────────────────────────
        const A_ = SELLO + '_a', rutaA = `clips/${NORTE}/${A_}`;
        apunta('P1', true, [await subir(S.n_coach, rutaA, { meta: meta(S.n_coach, A_, 'staff', 'alevin') }),
                            await ficha(S.n_coach, A_, NORTE, 'staff', 'alevin')]);
        const p2 = await leer(S.n_dir, rutaA);
        apunta('P2', true, [p2, await vista(S.n_dir, A_)]);
        apunta('P3', false, [await leer(S.n_dir, rutaA)]);
        apunta('N1', false, [await leer(S.s_coach, rutaA)]);
        apunta('N2', false, [await leer(S.n_familia, rutaA)]);
        const B_ = SELLO + '_b';
        apunta('N3', false, [await subir(S.n_coach, `clips/${NORTE}/${B_}`, { meta: meta(S.n_dir, B_, 'staff', 'alevin') })]);
        const C_ = SELLO + '_c';
        apunta('N4', false, [await subir(S.n_coach, `clips/${NORTE}/${C_}`, { meta: meta(S.n_coach, C_, 'familias', 'alevin') })]);
        const D_ = SELLO + '_d', rutaD = `clips/${NORTE}/${D_}`;
        const n5 = await subir(S.n_coach, rutaD, { meta: meta(S.n_coach, D_, 'familias', 'senior') });
        let nota5 = '';
        if (OK(n5)) {
            const f5 = await ficha(S.n_coach, D_, NORTE, 'familias', 'senior');
            const l5 = await leer(S.n_familia, rutaD);
            nota5 = `🚨 SOSPECHA CONFIRMADA: la ficha ${OK(f5) ? 'también se acepta' : 'se rechaza (' + f5 + ')'} y la Familia Norte ${OK(l5) ? 'LO VE (HTTP ' + l5 + ')' : 'no lo ve (' + l5 + ')'}`;
        }
        apunta('N5', false, [n5], nota5);
        const E_ = SELLO + '_e';
        apunta('N6', false, [await subir(S.n_coach, `clips/${NORTE}/${E_}`, { tipo: 'image/png', meta: meta(S.n_coach, E_, 'staff', 'alevin') })]);
        const F_ = SELLO + '_f';
        apunta('N7', false, [await subir(S.n_coach, `clips/${NORTE}/${F_}`, { bytes: 51 * 1024 * 1024, meta: meta(S.n_coach, F_, 'staff', 'alevin') })]);
        const G_ = SELLO + '_g';
        apunta('N8', false, [await subir(S.s_coach, `clips/${SUR}/${G_}`, { meta: meta(S.s_coach, G_, 'staff', 'alevin') })]);
        const H_ = SELLO + '_h';
        apunta('N9', false, [await subir(S.n_familia, `clips/${NORTE}/${H_}`, { meta: meta(S.n_familia, H_, 'staff', 'alevin') })]);
        apunta('N10', false, [await subir(S.n_coach, rutaA, { meta: meta(S.n_coach, A_, 'staff', 'alevin') })]);
        apunta('N11', false, [await borrar(S.n_familia, rutaA)]);
        const I_ = SELLO + '_i';
        apunta('N12', false, [await leer(null, rutaA), await subir(null, `clips/${NORTE}/${I_}`, { meta: { uploader: 'x', clipId: I_, audiencia: 'staff', categoria: 'alevin' } })]);
        apunta('N13', false, [await subir(S.n_coach, `otros/${SELLO}.mp4`, { meta: meta(S.n_coach, SELLO, 'staff', 'alevin') })]);
        apunta('P4', true, [await borrar(S.n_dir, rutaA)]);
        // v860 · P5: con el entrenador EN la lista del club, el clip de adultos
        // para familias se acepta (fichero + ficha) y la familia lo ve.
        listaNortePrevia = await leerLista();
        await ponerLista([...new Set([...listaNortePrevia, S.n_coach.uid])]);
        const J_ = SELLO + '_j', rutaJ = `clips/${NORTE}/${J_}`;
        const p5s = await subir(S.n_coach, rutaJ, { meta: meta(S.n_coach, J_, 'familias', 'regional') });
        const p5f = await ficha(S.n_coach, J_, NORTE, 'familias', 'regional');
        const p5l = await leer(S.n_familia, rutaJ);
        apunta('P5', true, [p5s, p5f, p5l], 'subida/ficha/familia ve');
        await borrar(S.n_coach, rutaJ);
    } catch (e) {
        console.error('\n✗ La prueba se interrumpió: ' + e.message);
        process.exitCode = 1;
    } finally {
        // ── deshacer SIEMPRE ───────────────────────────────────────────────
        console.log('\nLimpieza:');
        try {
            if (listaNortePrevia !== undefined) {
                const r = await ponerLista(listaNortePrevia);
                console.log('  · plazasAdultas de Norte restaurada (' + listaNortePrevia.length + ' uids): HTTP ' + r.st);
            }
            if (surApagado) {
                const r = await req(`${FS}/clubs/${SUR}?updateMask.fieldPaths=extras.modulo_videos`, { method: 'PATCH', headers: A,
                    body: J({ fields: { extras: { mapValue: { fields: { modulo_videos: { booleanValue: true } } } } } }) });
                console.log('  · extra «Vídeos» de Sur restaurado: HTTP ' + r.st);
            }
            // ficheros e2e_ que hayan quedado (con la cuenta del CLI, en testeo)
            let borrados = 0;
            for (const pref of [`clips/${NORTE}/${SELLO}`, `clips/${SUR}/${SELLO}`, `otros/${SELLO}`]) {
                const l = await req(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=${enc2(pref)}`, { headers: A });
                for (const it of (l.j && l.j.items) || []) {
                    const d = await req(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${enc2(it.name)}`, { method: 'DELETE', headers: A });
                    if (d.st === 204) borrados++;
                }
            }
            console.log('  · ficheros e2e restantes borrados: ' + borrados);
            // fichas y vistas e2e_
            let fichas = 0;
            for (const suf of ['_a', '_b', '_c', '_d', '_e', '_f', '_g', '_h', '_i', '_j']) {
                const id = SELLO + suf;
                const vs = await req(`${FS}/cronos_clips/${id}/vistas`, { headers: A });
                for (const v of (vs.j && vs.j.documents) || []) await req(`https://firestore.googleapis.com/v1/${v.name}`, { method: 'DELETE', headers: A });
                const g = await req(`${FS}/cronos_clips/${id}`, { headers: A });
                if (g.st === 200) { await req(`${FS}/cronos_clips/${id}`, { method: 'DELETE', headers: A }); fichas++; }
            }
            console.log('  · fichas e2e borradas (con sus vistas): ' + fichas);
            if (debugName) {
                const d = await req('https://firebaseappcheck.googleapis.com/v1/' + debugName, { method: 'DELETE', headers: A });
                const l = await req(`https://firebaseappcheck.googleapis.com/v1/projects/${P}/apps/${APP_ID}/debugTokens`, { headers: A });
                const quedan = ((l.j && l.j.debugTokens) || []).length;
                console.log('  · token de depuración borrado: HTTP ' + d.st + ' · tokens que quedan en testeo: ' + quedan);
                if (quedan) process.exitCode = 1;
            }
        } catch (e) { console.error('  ✗ fallo en la limpieza: ' + e.message + ' — REVISAR A MANO'); process.exitCode = 1; }

        const malos = resultados.filter((r) => !r.ok);
        console.log(`\nResultado: ${resultados.length - malos.length}/${resultados.length} casos como se esperaba` +
            (malos.length ? ' · DIFERENCIAS: ' + malos.map((m) => m.id).join(', ') : ''));
        if (malos.length) process.exitCode = 1;
    }
})();

function enc2(s) { return encodeURIComponent(s); }

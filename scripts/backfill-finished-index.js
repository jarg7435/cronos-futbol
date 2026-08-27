// ─────────────────────────────────────────────────────────────────────────
// backfill-finished-index.js  ·  v639
//
// Rellena `finished_index` (UN documento por PARTIDO) a partir del histórico
// de `cronos_player_reports` (UN informe por JUGADOR y partido, ~31 por
// partido). Sin esto, el índice sólo cubriría los partidos despachados a
// partir de v639 y el histórico seguiría entrando por el camino largo.
//
// Medido en producción antes de escribirlo (2026-08-27):
//     cronos_player_reports en la plataforma ....... 11.114 documentos
//     del club con datos (CD DÍA) ...................  5.436  ·  10,5 MB
//     🔑 partidos distintos .........................    176
//
// USO:
//     node scripts/backfill-finished-index.js               (SIMULACRO, no escribe)
//     node scripts/backfill-finished-index.js --escribir    (escribe de verdad)
//     node scripts/backfill-finished-index.js --escribir --proyecto cronos-futbol-app
//
// ⚠️ POR DEFECTO NO ESCRIBE NADA. Hay que pedirlo con `--escribir`: es una
//    migración sobre datos reales y el simulacro imprime exactamente lo que
//    haría, para poder mirarlo antes.
//
// ⚠️ ES IDEMPOTENTE. Escribe con `merge` sobre un id determinista (el matchId),
//    así que volver a pasarlo no duplica nada: reescribe lo mismo.
//
// ⚠️ SE AUTENTICA CON EL TOKEN DEL CLI (credencial de administrador), que SALTA
//    las reglas. Es lo correcto para una migración que ejecuta el dueño de la
//    plataforma, y es la misma vía que ya usan verify_prod.js y los sondeos de
//    reglas. No expone credenciales por pantalla.
//
// 🔑 LO QUE ESTE BACKFILL NO PUEDE SABER, y por qué no se inventa:
//   · `eventsCount` queda a 0. Los informes por jugador NO guardan los sucesos
//     del partido (sus campos son dorsal, goles, tarjetas, minutos e
//     historial de movimientos). La tarjeta ya omitía el "📍 N eventos" para
//     estos partidos ANTES de v639, así que no se pierde nada — pero tampoco
//     se va a rellenar con un número inventado.
//   · El nombre del equipo PROPIO tampoco está: sólo hay `rival` y
//     `myTeamRole`. Se deriva lo que sí se sabe (quién es local y quién
//     visitante) y el propio queda como 'LOCAL'/'VISITANTE', que es
//     exactamente lo que la pestaña pintaba antes.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ARGS      = process.argv.slice(2);
const ESCRIBIR  = ARGS.includes('--escribir');
const PROYECTO  = (ARGS[ARGS.indexOf('--proyecto') + 1] && ARGS.includes('--proyecto'))
                    ? ARGS[ARGS.indexOf('--proyecto') + 1] : 'cronos-futbol-app';
const CONFIG    = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const BASE      = 'https://firestore.googleapis.com/v1/projects/' + PROYECTO + '/databases/(default)/documents';

// ⚠️ Respuestas acumuladas como BUFFERS y decodificadas una sola vez: con
//    `d += chunk` un carácter multibyte partido entre dos trozos se corrompe.
function pedir(url, token, metodo, cuerpo) {
    return new Promise((resolve, reject) => {
        const datos = cuerpo ? JSON.stringify(cuerpo) : null;
        const opts = { method: metodo || 'GET', headers: { Authorization: 'Bearer ' + token } };
        if (datos) {
            opts.headers['Content-Type'] = 'application/json';
            opts.headers['Content-Length'] = Buffer.byteLength(datos);
        }
        const r = https.request(url, opts, (res) => {
            const trozos = [];
            res.on('data', (c) => trozos.push(c));
            res.on('end', () => {
                const t = Buffer.concat(trozos).toString('utf8');
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(t)); } catch (e) { reject(new Error('parse: ' + t.slice(0, 300))); }
                } else reject(new Error('HTTP ' + res.statusCode + ': ' + t.slice(0, 300)));
            });
        });
        r.on('error', reject);
        r.setTimeout(180000, () => { r.destroy(); reject(new Error('timeout')); });
        if (datos) r.write(datos);
        r.end();
    });
}

function accessToken(refresh) {
    const body = new URLSearchParams({
        refresh_token: refresh,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
        grant_type: 'refresh_token',
    }).toString();
    return new Promise((resolve, reject) => {
        const r = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            const c = [];
            res.on('data', (x) => c.push(x));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(c).toString('utf8')).access_token); }
                catch (e) { reject(e); }
            });
        });
        r.on('error', reject);
        r.write(body); r.end();
    });
}

// Firestore REST envuelve cada valor en su tipo. Estos dos lo deshacen.
const S = (f, k, d) => (f[k] && f[k].stringValue !== undefined ? f[k].stringValue : (d !== undefined ? d : ''));
const N = (f, k) => {
    if (!f[k]) return 0;
    const v = f[k].integerValue !== undefined ? f[k].integerValue : f[k].doubleValue;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

(async () => {
    if (!fs.existsSync(CONFIG)) { console.log('SIN SESIÓN del CLI de firebase. Ejecuta `firebase login`.'); process.exit(2); }
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const refresh = (cfg.tokens && cfg.tokens.refresh_token) || cfg.refresh_token;
    if (!refresh) { console.log('SIN SESIÓN del CLI de firebase.'); process.exit(2); }
    const token = await accessToken(refresh);

    console.log('── Backfill de finished_index · proyecto ' + PROYECTO + ' ──');
    console.log(ESCRIBIR ? '   MODO: ESCRITURA REAL\n' : '   MODO: SIMULACRO (no escribe nada — usa --escribir)\n');

    const res = await pedir(BASE + ':runQuery', token, 'POST', {
        structuredQuery: { from: [{ collectionId: 'cronos_player_reports' }] },
    });
    const docs = res.filter(r => r.document);
    console.log('Informes leídos: ' + docs.length);

    // ── Agrupar por matchId: UN índice por partido ────────────────────────
    const porPartido = new Map();
    let sinMatchId = 0;

    docs.forEach(r => {
        const f = r.document.fields || {};
        const matchId = S(f, 'matchId');
        if (!matchId) { sinMatchId++; return; }

        // Sólo cuentan los que la pestaña considera "de partido terminado":
        // el mismo predicado que finished-matches-tab.js.
        const esColectivo = (f.staffReport && f.staffReport.booleanValue === true) ||
                            S(f, 'type') === 'collective_match_report' ||
                            S(f, 'reportType') === 'collective';
        if (!esColectivo) return;

        const previo = porPartido.get(matchId);
        const createdAt = S(f, 'createdAt');
        // Se queda el MÁS RECIENTE de cada partido: si un partido se despachó
        // dos veces, la última versión es la buena.
        if (previo && previo.createdAt >= createdAt) return;

        const rival = S(f, 'rival', 'Rival');
        const miRol = S(f, 'myTeamRole', 'home');   // 'home' | 'away'
        // ⚠️ `mode` NO está en estos documentos, pero la CATEGORÍA sí y lleva el
        //    prefijo (`f11_infantil`, `f7_alevin`). Derivarlo de ahí es leer el
        //    dato; dejar 'f7' por defecto habría etiquetado de Fútbol 7 a los
        //    partidos de Fútbol 11, que es peor que no saberlo.
        const _cat  = S(f, 'category');
        const modo  = S(f, 'mode') || (/^f11|_f11|f11_/.test(_cat) ? 'f11'
                                     : (/^f7|_f7|f7_/.test(_cat) ? 'f7' : ''));
        // 🔑 Sólo se sabe QUIÉN es el rival y de qué lado juega el equipo
        //    propio. El nombre del propio no está en estos documentos.
        const esLocal = miRol !== 'away';

        porPartido.set(matchId, {
            matchId,
            clubId:      S(f, 'clubId') || null,
            createdBy:   S(f, 'coachUid') || null,
            coachUid:    S(f, 'coachUid') || null,
            coachEmail:  S(f, 'coachEmail') || null,
            homeName:    esLocal ? 'LOCAL' : rival,
            homeScore:   N(f, 'scoreHome'),
            homeColor:   '#58a6ff', homeShorts: '#1a4e99', homeText: '#000000',
            awayName:    esLocal ? rival : 'VISITANTE',
            awayScore:   N(f, 'scoreAway'),
            awayColor:   '#ff5858', awayShorts: '#b22222', awayText: '#ffffff',
            category:    _cat,
            subcategory: S(f, 'subcategory'),
            mode:        modo || 'f7',
            matchDate:   S(f, 'matchDate'),
            createdAt:   createdAt || new Date().toISOString(),
            eventsCount: 0,      // ver la cabecera: no se inventa
            source:      'cronos_player_reports',
            docId:       matchId,
            updatedAt:   new Date().toISOString(),
        });
    });

    console.log('Informes sin matchId (ignorados): ' + sinMatchId);
    console.log('🔑 PARTIDOS a indexar: ' + porPartido.size + '\n');

    // Desglose por club, para poder cotejarlo de un vistazo.
    const porClub = {};
    porPartido.forEach(v => { const k = v.clubId || '(sin club)'; porClub[k] = (porClub[k] || 0) + 1; });
    Object.entries(porClub).sort((a, b) => b[1] - a[1])
        .forEach(([k, n]) => console.log('   ' + String(n).padStart(5) + '  ' + k));

    if (!ESCRIBIR) {
        console.log('\nSIMULACRO: no se ha escrito nada. Repite con --escribir para aplicarlo.');
        const muestra = porPartido.values().next().value;
        if (muestra) console.log('\nEjemplo de documento que se escribiría:\n' + JSON.stringify(muestra, null, 2));
        return;
    }

    // ── Escritura ─────────────────────────────────────────────────────────
    // Uno a uno con `updateMask` vacío = setDoc completo. No se usa
    // commitBatch para que un documento malo no tumbe a los otros 175.
    let ok = 0, fallos = 0;
    for (const [matchId, idx] of porPartido) {
        const fields = {};
        Object.entries(idx).forEach(([k, v]) => {
            if (v === null || v === undefined) { fields[k] = { nullValue: null }; }
            else if (typeof v === 'number')    { fields[k] = { integerValue: String(v) }; }
            else                               { fields[k] = { stringValue: String(v) }; }
        });
        try {
            await pedir(BASE + '/finished_index/' + encodeURIComponent(matchId),
                        token, 'PATCH', { fields });
            ok++;
            if (ok % 25 === 0) console.log('   ' + ok + '/' + porPartido.size + '…');
        } catch (e) {
            fallos++;
            console.warn('   ⚠️ ' + matchId + ': ' + e.message);
        }
    }
    console.log('\n✅ Escritos ' + ok + ' índices' + (fallos ? ', ' + fallos + ' fallos' : '') + '.');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

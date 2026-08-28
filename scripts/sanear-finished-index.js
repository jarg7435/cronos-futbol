// ─────────────────────────────────────────────────────────────────────────
// sanear-finished-index.js  ·  v640
//
// ⚠️ SUSTITUYE A `backfill-finished-index.js`, QUE SE RETIRA.
//
// Aquel script llenaba `finished_index` con TODO el histórico (390 partidos
// desde abril) porque la sección «Partidos Terminados» se estaba comportando
// como un archivo. Al aclararse la regla de negocio (implementar.txt
// 2026-08-28) resultó ser lo contrario:
//
//   · Los informes colectivos e individuales PERMANECEN toda la temporada.
//   · La SECCIÓN «Partidos Terminados» es un registro TEMPORAL de 10 h desde
//     el final del encuentro: 2 h de margen para corregir informes + 8 h para
//     poder descargarlo. Pasadas las 10 h, desaparece de la sección.
//
// `finished_index` es la VISTA de esa sección, así que NO debe contener nada
// de hace más de 10 h. Este script deja la colección conforme a la regla:
//
//   · Documentos FUERA de la ventana  → se BORRAN (son sólo la vista; el
//     informe permanente no se toca).
//   · Documentos DENTRO de la ventana → se les sella `expireAt` si les falta,
//     que es lo que necesita el paso C de `cleanupLiveMatches` para recogerlos
//     cuando les llegue la hora. Un `where` EXCLUYE los documentos que no
//     tienen el campo, así que sin este sellado se quedarían para siempre.
//
// USO:
//     node scripts/sanear-finished-index.js               (SIMULACRO)
//     node scripts/sanear-finished-index.js --escribir    (aplica)
//
// ⚠️ POR DEFECTO NO ESCRIBE NADA.
// ⚠️ NO TOCA `cronos_player_reports`. Ni una operación. Los informes de
//    temporada quedan intactos: esto sólo sanea la vista.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ARGS     = process.argv.slice(2);
const ESCRIBIR = ARGS.includes('--escribir');
const PROYECTO = (ARGS.includes('--proyecto') && ARGS[ARGS.indexOf('--proyecto') + 1]) || 'cronos-futbol-app';
const CONFIG   = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const BASE     = 'https://firestore.googleapis.com/v1/projects/' + PROYECTO + '/databases/(default)/documents';

// La MISMA ventana que CronosMatchLock.RETENTION_MS (js/match/immutability.js).
const RETENCION_MS = 10 * 60 * 60 * 1000;

function pedir(url, token, metodo, cuerpo) {
    return new Promise((resolve, reject) => {
        const datos = cuerpo ? JSON.stringify(cuerpo) : null;
        const opts = { method: metodo || 'GET', headers: { Authorization: 'Bearer ' + token } };
        if (datos) {
            opts.headers['Content-Type'] = 'application/json';
            opts.headers['Content-Length'] = Buffer.byteLength(datos);
        }
        const r = https.request(url, opts, (res) => {
            const t = [];
            res.on('data', (c) => t.push(c));
            res.on('end', () => {
                const s = Buffer.concat(t).toString('utf8');
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new Error('parse: ' + s.slice(0, 200))); }
                } else reject(new Error('HTTP ' + res.statusCode + ': ' + s.slice(0, 250)));
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

const S = (f, k) => (f[k] && f[k].stringValue) || '';
const msDe = (s) => { const t = Date.parse(s); return isNaN(t) ? 0 : t; };

(async () => {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const refresh = (cfg.tokens && cfg.tokens.refresh_token) || cfg.refresh_token;
    if (!refresh) { console.log('SIN SESIÓN del CLI de firebase.'); process.exit(2); }
    const token = await accessToken(refresh);

    console.log('── Saneado de finished_index · proyecto ' + PROYECTO + ' ──');
    console.log('   Ventana de retención: ' + (RETENCION_MS / 3600000) + ' h');
    console.log(ESCRIBIR ? '   MODO: ESCRITURA REAL\n' : '   MODO: SIMULACRO (usa --escribir para aplicar)\n');

    const res = await pedir(BASE + ':runQuery', token, 'POST', {
        structuredQuery: { from: [{ collectionId: 'finished_index' }] },
    });
    const docs = res.filter(r => r.document);
    const corte = Date.now() - RETENCION_MS;

    const fuera = [], dentroSinSello = [], dentroOk = [];
    docs.forEach(r => {
        const f = r.document.fields || {};
        const id = r.document.name.split('/').pop();
        // El ancla es `finishedAt`, con respaldo en `createdAt` para los
        // documentos escritos antes de v640, que nunca lo tuvieron.
        const fin = msDe(S(f, 'finishedAt')) || msDe(S(f, 'createdAt'));
        if (!fin)            { dentroOk.push(id); return; }   // sin ancla: no se toca
        if (fin <= corte)    { fuera.push({ id, fin }); return; }
        if (!S(f, 'expireAt')) dentroSinSello.push({ id, fin });
        else dentroOk.push(id);
    });

    console.log('Documentos en el índice ............... ' + docs.length);
    console.log('🗑️  FUERA de la ventana (se borran) ..... ' + fuera.length);
    console.log('🏷️  dentro pero sin expireAt (se sella) . ' + dentroSinSello.length);
    console.log('✔️  dentro y ya conformes ............... ' + dentroOk.length);

    if (fuera.length) {
        const masNuevo = Math.max(...fuera.map(x => x.fin));
        console.log('   (el más reciente de los que se borran terminó hace ' +
                    ((Date.now() - masNuevo) / 3600000).toFixed(1) + ' h)');
    }

    if (!ESCRIBIR) {
        console.log('\nSIMULACRO: no se ha escrito nada.');
        console.log('⚠️ Recuerda: esto sólo toca la VISTA. `cronos_player_reports`');
        console.log('   —los informes de toda la temporada— no se toca en ningún caso.');
        return;
    }

    let borrados = 0, sellados = 0, fallos = 0;
    for (const x of fuera) {
        try { await pedir(BASE + '/finished_index/' + encodeURIComponent(x.id), token, 'DELETE'); borrados++; }
        catch (e) { fallos++; console.warn('   ⚠️ borrando ' + x.id + ': ' + e.message); }
        if (borrados % 50 === 0 && borrados) console.log('   borrados ' + borrados + '/' + fuera.length + '…');
    }
    for (const x of dentroSinSello) {
        try {
            await pedir(BASE + '/finished_index/' + encodeURIComponent(x.id) +
                        '?updateMask.fieldPaths=expireAt', token, 'PATCH',
                        { fields: { expireAt: { stringValue: new Date(x.fin + RETENCION_MS).toISOString() } } });
            sellados++;
        } catch (e) { fallos++; console.warn('   ⚠️ sellando ' + x.id + ': ' + e.message); }
    }

    console.log('\n✅ Borrados ' + borrados + ' · sellados ' + sellados +
                (fallos ? ' · ' + fallos + ' fallos' : '') + '.');
    console.log('   `cronos_player_reports` NO se ha tocado.');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

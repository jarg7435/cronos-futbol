// ═══════════════════════════════════════════════════════════════════════════
//  scripts/ops/copias_estado.js
//  ¿HAY COPIAS DE SEGURIDAD DE VERDAD, AHORA MISMO?
//
//  Uso:  node scripts/ops/copias_estado.js
//        node scripts/ops/copias_estado.js --dias-auth 45
//
//  🔑🔑 POR QUE EXISTE
//  RECUPERACION.md describe una politica. Un documento no es una defensa: lo
//  que protege es que PITR este ENCENDIDO y que las copias se esten HACIENDO,
//  y eso no se sabe leyendo el fichero, se sabe preguntandoselo a Google.
//
//  Este proyecto ya ha pagado TRES veces el mismo error con las reglas —dar
//  por activo algo porque el comando se lanzo una vez, y llegar a informar de
//  que estaba vivo cuando no lo estaba (ver scripts/lee_reglas_vivas.js)—. La
//  politica de copias nace con su verificador para no repetirlo una cuarta.
//
//  ⚠️ SOLO LEE. No crea copias, no borra nada, no toca la base.
//
//  ⚠️ SALE CON 1 SI ALGO FALTA, a proposito: asi puede colgarse de una tarea
//  programada. Un verificador que siempre sale con 0 es el `echo TODO` del
//  build otra vez.
//
//  ⚠️ FALLA HACIA EL NO. Si la API no contesta, o contesta 403, NO se da por
//  bueno nada: «no lo se» no es «esta bien». Es la leccion de v617.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const PROJECT = 'cronos-futbol-app';
const DB = '(default)';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const ROOT = path.join(__dirname, '..', '..');

// Cuantos dias puede tener la copia mas reciente antes de considerarla vieja.
// Una copia DIARIA que lleve mas de 2 dias significa que la programacion se ha
// parado y nadie se ha enterado.
const MAX_DIAS_COPIA = 2;
// Y cuanto puede llevar sin renovarse la exportacion de cuentas de Auth.
const argDias = process.argv.indexOf('--dias-auth');
const MAX_DIAS_AUTH = argDias > -1 ? Number(process.argv[argDias + 1]) || 35 : 35;

let fallos = 0;
const bien = (m, extra) => console.log('  ✓ ' + m + (extra ? '  — ' + extra : ''));
const mal = (m, extra) => { fallos++; console.log('  ✗ ' + m + (extra ? '\n      → ' + extra : '')); };
const nota = (m) => console.log('    · ' + m);

function httpGet(url, token) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token } },
            (res) => {
                let d = '';
                res.on('data', (c) => { d += c; });
                res.on('end', () => resolve({ status: res.statusCode, body: d }));
            });
        req.on('error', reject);
        req.end();
    });
}

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
        }, (res) => {
            let d = ''; res.on('data', (c) => { d += c; });
            res.on('end', () => { try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); } catch (e) { reject(new Error(d.slice(0, 200))); } });
        });
        req.on('error', reject); req.write(body); req.end();
    });
}

const dias = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;
const API = 'https://firestore.googleapis.com/v1/projects/' + PROJECT;
const DB_URL = API + '/databases/' + encodeURIComponent(DB);

(async () => {
    console.log('\n🛟 Estado de las copias de seguridad · ' + PROJECT + '\n');

    let token;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        const rt = (cfg.tokens && cfg.tokens.refresh_token) ||
                   (cfg.user && cfg.user.tokens && cfg.user.tokens.refresh_token);
        token = await getAccessToken(rt);
    } catch (e) {
        // ⚠️ SIN SESION NO SE APRUEBA NADA. Aqui no se hace SKIP: un
        //    verificador de copias que se salta en silencio deja de avisar
        //    justo cuando nadie esta mirando.
        console.log('  ✗ sin sesion del CLI de Firebase — no se ha podido comprobar NADA');
        console.log('      → ejecuta `firebase login` y vuelve a lanzarlo');
        console.log('\n❌ ESTADO DESCONOCIDO (que no es lo mismo que «bien»)\n');
        process.exit(1);
    }

    // ── 1. PITR ────────────────────────────────────────────────────────
    console.log('1) Point-in-Time Recovery');
    try {
        const r = await httpGet(DB_URL, token);
        if (r.status !== 200) {
            mal('no se ha podido leer la base', 'HTTP ' + r.status + ' ' + r.body.slice(0, 200));
        } else {
            const d = JSON.parse(r.body);
            const pitr = d.pointInTimeRecoveryEnablement || '(sin dato)';
            if (pitr === 'POINT_IN_TIME_RECOVERY_ENABLED') {
                bien('PITR ENCENDIDO', pitr);
                if (d.earliestVersionTime) nota('se puede volver hasta: ' + d.earliestVersionTime);
            } else {
                mal('PITR APAGADO (' + pitr + ')',
                    'es la defensa principal contra un script o un despliegue que borre datos.\n' +
                    '        Arreglo:  gcloud firestore databases update --database=\'(default)\' --enable-pitr');
            }
        }
    } catch (e) { mal('error consultando PITR', e.message); }

    // ── 2. Programaciones ──────────────────────────────────────────────
    console.log('\n2) Copias programadas');
    try {
        const r = await httpGet(DB_URL + '/backupSchedules', token);
        if (r.status !== 200) {
            mal('no se han podido listar las programaciones', 'HTTP ' + r.status + ' ' + r.body.slice(0, 200));
        } else {
            const sch = JSON.parse(r.body).backupSchedules || [];
            if (!sch.length) {
                mal('NO hay ninguna copia programada',
                    'Arreglo (Cloud Shell):  gcloud firestore backups schedules create \\\n' +
                    '          --database=\'(default)\' --recurrence=daily --retention=7d');
            } else {
                bien(sch.length + ' programación(es)');
                for (const s of sch) {
                    const tipo = s.dailyRecurrence ? 'diaria'
                               : s.weeklyRecurrence ? ('semanal (' + (s.weeklyRecurrence.day || '?') + ')')
                               : 'desconocida';
                    nota(tipo + ' · retención ' + (s.retention || '?') + ' · ' + (s.name || '').split('/').pop());
                }
                if (!sch.some((s) => s.dailyRecurrence)) {
                    mal('ninguna es DIARIA', 'con sólo una semanal, el RPO real es de 7 días, no de 24 h');
                }
            }
        }
    } catch (e) { mal('error consultando las programaciones', e.message); }

    // ── 3. ¿Existe de verdad alguna copia, y es fresca? ────────────────
    // 🔑 Que la PROGRAMACION exista no prueba que la copia se haya HECHO.
    //    Son dos cosas distintas, y la segunda es la que salva el dia malo.
    console.log('\n3) Copias que existen de verdad');
    try {
        const r = await httpGet(API + '/locations/-/backups', token);
        if (r.status !== 200) {
            mal('no se han podido listar las copias', 'HTTP ' + r.status + ' ' + r.body.slice(0, 200));
        } else {
            const bks = (JSON.parse(r.body).backups || [])
                .filter((b) => !b.database || b.database.endsWith('/' + DB));
            if (!bks.length) {
                mal('NO existe ni una sola copia',
                    'si acabas de crear la programación, la primera copia tarda en aparecer:\n' +
                    '        no des esto por hecho hasta ver aquí una fila READY');
            } else {
                const listas = bks.filter((b) => (b.state || '') === 'READY');
                bien(bks.length + ' copia(s), ' + listas.length + ' en estado READY');
                const ordenadas = listas.slice().sort((a, b) =>
                    new Date(b.snapshotTime) - new Date(a.snapshotTime));
                const ultima = ordenadas[0];
                if (!ultima) {
                    mal('ninguna copia está READY');
                } else {
                    const d = dias(ultima.snapshotTime);
                    nota('más reciente: ' + ultima.snapshotTime + '  (hace ' + d.toFixed(1) + ' días)');
                    if (d > MAX_DIAS_COPIA) {
                        mal('la copia más reciente tiene ' + d.toFixed(1) + ' días',
                            'la programación diaria se ha parado y nadie se ha enterado');
                    } else {
                        bien('la copia más reciente es fresca (≤ ' + MAX_DIAS_COPIA + ' días)');
                    }
                }
            }
        }
    } catch (e) { mal('error consultando las copias', e.message); }

    // ── 4. Las cuentas de Auth, que la copia NO cubre ──────────────────
    // 🔑🔑 Sin esto, restaurar Firestore deja 40 colecciones apuntando a uids
    //    que ya no existen: NADIE PUEDE ENTRAR. Ver RECUPERACION.md, Parte 0.
    console.log('\n4) Exportación de cuentas de Auth (lo que la copia NO cubre)');
    try {
        const dir = path.join(ROOT, 'backups');
        const ficheros = fs.existsSync(dir)
            ? fs.readdirSync(dir).filter((f) => /^auth_users_.*\.json$/.test(f))
            : [];
        if (!ficheros.length) {
            mal('NO hay ninguna exportación de cuentas en backups/',
                'restaurar Firestore sin esto deja la aplicación sin nadie que pueda entrar.\n' +
                '        Arreglo:  npm run backup:auth');
        } else {
            const conFecha = ficheros
                .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
                .sort((a, b) => b.t - a.t);
            const ult = conFecha[0];
            const d = (Date.now() - ult.t) / 86400000;
            nota('más reciente: ' + ult.f + '  (hace ' + d.toFixed(1) + ' días)');
            if (d > MAX_DIAS_AUTH) {
                mal('la exportación de cuentas tiene ' + d.toFixed(0) + ' días',
                    'las altas posteriores no están: esas personas no podrían volver a entrar.\n' +
                    '        Arreglo:  npm run backup:auth');
            } else {
                bien('la exportación de cuentas es reciente (≤ ' + MAX_DIAS_AUTH + ' días)');
            }
        }
    } catch (e) { mal('error revisando backups/', e.message); }

    // ── 5. El simulacro ────────────────────────────────────────────────
    // Una copia que no se ha restaurado nunca es una suposicion.
    console.log('\n5) Simulacro de restauración');
    try {
        const doc = fs.readFileSync(path.join(ROOT, 'RECUPERACION.md'), 'utf8');
        const tabla = doc.slice(doc.indexOf('## Registro de simulacros'));
        const fechas = tabla.match(/\d{4}-\d{2}-\d{2}/g) || [];
        if (!fechas.length) {
            mal('NUNCA se ha hecho un simulacro de restauración',
                'una copia que no se ha restaurado nunca no es una copia, es una suposición.\n' +
                '        Procedimiento: RECUPERACION.md, Parte 3');
        } else {
            const ultima = fechas.sort().pop();
            const d = dias(ultima);
            nota('último simulacro anotado: ' + ultima + '  (hace ' + Math.round(d) + ' días)');
            if (d > 200) mal('el último simulacro tiene más de 6 meses', 'toca repetirlo');
            else bien('simulacro dentro de plazo');
        }
    } catch (e) { mal('no se ha podido leer RECUPERACION.md', e.message); }

    console.log('\n' + '─'.repeat(64));
    if (fallos) {
        console.log('❌ ' + fallos + ' punto(s) sin cubrir. Los datos de los clubes NO están a salvo.');
        console.log('   Qué hacer: RECUPERACION.md, Parte 2.\n');
        process.exit(1);
    }
    console.log('✅ Copias activas, frescas y con simulacro dentro de plazo.\n');
    process.exit(0);
})().catch((e) => {
    console.error('\n❌ ERROR: ' + e.message);
    console.error('   «No lo sé» no es «está bien»: se sale con 1.\n');
    process.exit(1);
});

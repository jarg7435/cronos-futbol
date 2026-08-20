// ═══════════════════════════════════════════════════════════════════════════
//  scripts/lee_reglas_vivas.js
//  ¿QUE REGLAS ESTAN VIVAS DE VERDAD EN PRODUCCION?
//
//  Uso:  node scripts/lee_reglas_vivas.js firestore.rules [salida.rules]
//
//  🔑🔑🔑 POR QUE ESTA AQUI Y NO EN EL SCRATCHPAD
//  `npm run deploy:staging` sube firestore.rules al proyecto cronos-futbol-test,
//  Y LA APP NO CONSULTA ESE PROYECTO JAMAS: el firebaseConfig apunta siempre a
//  cronos-futbol-app (ver la memoria "Testeo comparte BD, REGLAS y FUNCTIONS
//  con PRODUCCION"). O sea: se puede "desplegar" un cambio de reglas y creer
//  que esta vivo cuando no lo esta.
//
//  Este defecto ha mordido TRES veces:
//    · v572/v573 — las reglas de `live_index` nunca llegaron a produccion, y
//      como P2 degradaba en silencio la app parecia funcionar perfecta.
//    · 2026-08-18 — mismo caso, resuelto con este script… que vivia en el
//      scratchpad y desaparecio con la sesion.
//    · v594/v595 — la clave `inviteTemplate` de la plantilla de Secretaria.
//      Se llego a informar al autor de que "ya estaba viva". No lo estaba.
//
//  Por eso ahora vive en el repo. **Tras CUALQUIER cambio en firestore.rules,
//  ejecutarlo antes de dar el cambio por desplegado.**
//
//  ⚠️ Lee tambien las lineas que produccion tiene y el repo NO: un
//  `deploy --only firestore:rules` publica el fichero ENTERO, asi que arrastra
//  cualquier otro cambio pendiente de sesiones anteriores. Conviene verlo antes.
// ═══════════════════════════════════════════════════════════════════════════
//
// Diferencias EXACTAS entre las reglas vivas en produccion y las del repo.
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const PROYECTO = 'cronos-futbol-app';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

function token(rt) {
    const body = new URLSearchParams({ refresh_token: rt,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', grant_type: 'refresh_token' }).toString();
    return new Promise((res, rej) => {
        const r = https.request('https://oauth2.googleapis.com/token', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            x => { const b = []; x.on('data', c => b.push(c)); x.on('end', () => {
                const j = JSON.parse(Buffer.concat(b).toString('utf8')); j.access_token ? res(j.access_token) : rej(new Error('sin token')); }); });
        r.on('error', rej); r.write(body); r.end();
    });
}
function get(url, tk) {
    return new Promise((res, rej) => {
        https.get(url, { headers: { Authorization: 'Bearer ' + tk } }, x => {
            const b = []; x.on('data', c => b.push(c));
            x.on('end', () => res(Buffer.concat(b).toString('utf8')));
        }).on('error', rej);
    });
}

(async () => {
    const rt = (JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tokens || {}).refresh_token;
    const tk = await token(rt);
    const rel = JSON.parse(await get(`https://firebaserules.googleapis.com/v1/projects/${PROYECTO}/releases/cloud.firestore`, tk));
    const rs = JSON.parse(await get(`https://firebaserules.googleapis.com/v1/${rel.rulesetName}`, tk));
    const vivo = (rs.source.files || []).map(f => f.content).join('\n').replace(/\r\n/g, '\n').split('\n');
    const repo = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n').split('\n');

    // El volcado a fichero es opcional: normalmente basta con el resumen.
    if (process.argv[3]) fs.writeFileSync(process.argv[3], vivo.join('\n'), 'utf8');

    // Diferencia por conjuntos de lineas no vacias: basta para ver QUE cambia.
    const norm = l => l.trim();
    const setVivo = new Map(); vivo.forEach(l => { const k = norm(l); if (k) setVivo.set(k, (setVivo.get(k) || 0) + 1); });
    const setRepo = new Map(); repo.forEach(l => { const k = norm(l); if (k) setRepo.set(k, (setRepo.get(k) || 0) + 1); });

    const soloRepo = [], soloVivo = [];
    setRepo.forEach((n, k) => { const m = setVivo.get(k) || 0; for (let i = 0; i < n - m; i++) soloRepo.push(k); });
    setVivo.forEach((n, k) => { const m = setRepo.get(k) || 0; for (let i = 0; i < n - m; i++) soloVivo.push(k); });

    const codigo = l => !/^\/\//.test(l) && !/^\/\*/.test(l) && !/^\*/.test(l);
    console.log('=== lineas de CODIGO que el repo tiene y produccion NO (' + soloRepo.filter(codigo).length + ') ===');
    soloRepo.filter(codigo).forEach(l => console.log('  + ' + l.slice(0, 150)));
    console.log('\n=== lineas de CODIGO que produccion tiene y el repo NO (' + soloVivo.filter(codigo).length + ') ===');
    soloVivo.filter(codigo).forEach(l => console.log('  - ' + l.slice(0, 150)));
    console.log('\n(comentarios cambiados: +' + soloRepo.filter(l => !codigo(l)).length + ' / -' + soloVivo.filter(l => !codigo(l)).length + ')');
})();

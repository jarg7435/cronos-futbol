#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  scripts/empaqueta.js  ·  EL PAQUETE DE ENTREGA, LIMPIO  (2026-10-02)
//
//    npm run package             → dist/cronos-futbol_<commit>.zip
//    npm run package:verificar   → y además lo prueba desde cero
//
//  🚨 POR QUÉ EXISTE. El ZIP de la auditoría externa del 30-09 se hizo
//  comprimiendo LA CARPETA, y la carpeta es mucho más que el producto:
//    · `backups/` con cinco volcados reales (export de Auth incluido);
//    · `node_modules/` con `.bin/eslint` sin permiso de ejecución (0644),
//      que dejaba `npm run lint` roto en la máquina del auditor;
//    · capturas, encargos, accesos directos…
//  `.gitignore` no protege de un compresor: sólo de git. Así que el paquete
//  se hace CON git (`git archive`), que únicamente mete lo VERSIONADO, y
//  `node_modules` se reconstruye en destino con `npm ci`, que es como lo pide
//  la auditoría y como lo hace la CI.
//
//  🔑 EL PAQUETE ES UN COMMIT. Si hay cambios sin commitear en ficheros
//  seguidos, se niega: un ZIP que no corresponde a ningún commit no se puede
//  reproducir ni auditar («¿qué versión os mandé?»).
//
//  🔑 SE VALIDA EL ZIP DE VERDAD, no una lista que se le parezca: se lee su
//  directorio central y cada nombre pasa por la lista de PROHIBIDOS. Si uno
//  cae, el ZIP se borra y sale con 1.
//
//  --verificar: lo descomprime en una carpeta temporal y ejecuta
//  `npm ci` (raíz y functions) + `npm run build` + `npm run lint` + `npm test`.
//  Es exactamente el recorrido del auditor; si algo depende de un fichero que
//  sólo existe en ESTE disco, aquí sale.
//
//  🚨 2026-10-19 (reauditoría del 19-10). El ZIP auditado volvió a hacerse
//  comprimiendo la carpeta —con node_modules y `.bin/eslint` a 0644— y el
//  auditor no pudo reproducir `--verificar` porque exigía un checkout de git.
//  Dos cambios:
//    · el ZIP lleva `PAQUETE.json`: commit, fecha y el sha256 de CADA fichero;
//    · `--verificar` SIN git (dentro del paquete descomprimido) comprueba ese
//      manifiesto —nada falta, nada cambió, nada prohibido de más— y después
//      hace el mismo npm ci + build + lint + test. `npm ci` borra cualquier
//      node_modules que viniera copiado, y `npm run lint` llama a ESLint con
//      `node`, así que el permiso de ejecución de `.bin/` ya no importa.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// Lo que NUNCA puede viajar en una entrega. Se compara contra rutas con `/`.
const PROHIBIDOS = [
    { re: /(^|\/)backups\//i,                       por: 'respaldos de datos reales' },
    { re: /(^|\/)capturas\//i,                      por: 'capturas con datos de menores' },
    { re: /(^|\/)calendarios\//i,                   por: 'material de terceros' },
    { re: /(^|\/)presentaci(o|ó)n\//i,              por: 'capturas de la app' },
    { re: /(^|\/)node_modules\//,                   por: 'dependencias: se instalan con npm ci' },
    { re: /(^|\/)\.firebase\//,                     por: 'caché del CLI de Firebase' },
    { re: /(^|\/)\.claude\//,                       por: 'configuración local del asistente' },
    { re: /(^|\/)\.env(\.[^/]*)?$/i,                por: 'variables de entorno / secretos' },
    { re: /auth_users_[^/]*\.json$/i,               por: 'export de cuentas de Auth' },
    { re: /backup_users_[^/]*\.json$/i,             por: 'respaldo de usuarios' },
    { re: /respaldo_[^/]*\.json$/i,                 por: 'respaldo de datos' },
    { re: /usuarios_temp[^/]*\.json$/i,             por: 'volcado de usuarios' },
    { re: /(serviceaccount|service-account|firebase-adminsdk-)[^/]*$/i, por: 'clave de cuenta de servicio' },
    { re: /\.(pem|key|p12|pfx)$/i,                  por: 'clave privada / certificado' },
    { re: /\.log$/i,                                por: 'registros locales' },
    { re: /\.lnk$/i,                                por: 'acceso directo de Windows' },
    { re: /(^|\/)dist\/|\.zip$/i,                   por: 'paquetes anteriores (un ZIP dentro del ZIP)' },
    { re: /(^|\/)(implementar|mensajes)\.txt$/i,    por: 'canal de encargos' },
];

function rutasProhibidas(lista) {
    const malas = [];
    for (const f of lista) {
        const r = String(f).replace(/\\/g, '/');
        const p = PROHIBIDOS.find((x) => x.re.test(r));
        if (p) malas.push(r + '  ← ' + p.por);
    }
    return malas;
}

// Nombres de un ZIP leyendo su directorio central (firma 0x02014b50). Sin
// dependencias: lo justo para saber QUÉ lleva el fichero que se va a entregar.
function nombresDelZip(fichero) {
    const buf = fs.readFileSync(fichero);
    // Fin del directorio central: firma 0x06054b50, en los últimos 64 KB.
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('no es un ZIP válido (sin directorio central)');
    const total = buf.readUInt16LE(eocd + 10);
    let pos = buf.readUInt32LE(eocd + 16);
    const nombres = [];
    for (let n = 0; n < total; n++) {
        if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('directorio central corrupto');
        const lNombre = buf.readUInt16LE(pos + 28);
        const lExtra = buf.readUInt16LE(pos + 30);
        const lComent = buf.readUInt16LE(pos + 32);
        nombres.push(buf.toString('utf8', pos + 46, pos + 46 + lNombre));
        pos += 46 + lNombre + lExtra + lComent;
    }
    return nombres;
}

// ── Manifiesto ─────────────────────────────────────────────────────────────
const MANIFIESTO = 'PAQUETE.json';
// Lo que puede aparecer en el paquete descomprimido sin estar en el
// manifiesto: lo regenera la propia verificación (npm ci, build, tests).
const REGENERABLE = /^(node_modules|functions\/node_modules)(\/|$)|^PAQUETE\.json$/;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Contenido de cada fichero de un commit con UN solo `git cat-file --batch`.
// Con `* text=auto eol=lf` el ZIP lleva exactamente estos bytes.
function ficherosDelCommit(rev, rutas) {
    // `encoding: undefined` (no 'buffer': Node 24 lo rechaza con «Unknown
    // encoding») anula el 'utf8' de git() y devuelve Buffers: hay binarios.
    const r = git(['cat-file', '--batch'], { input: Buffer.from(rutas.map((p) => rev + ':' + p).join('\n') + '\n', 'utf8'), encoding: undefined, maxBuffer: 1024 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('git cat-file falló: ' + String(r.stderr));
    const out = r.stdout;
    const res = {};
    let pos = 0;
    for (const p of rutas) {
        const fin = out.indexOf(10, pos);
        const cab = out.toString('utf8', pos, fin).split(' ');
        if (cab[1] !== 'blob') throw new Error('no es un fichero: ' + p + ' (' + cab.join(' ') + ')');
        const n = Number(cab[2]);
        res[p] = sha256(out.subarray(fin + 1, fin + 1 + n));
        pos = fin + 1 + n + 1;
    }
    return res;
}

// Compara una carpeta con su manifiesto. Devuelve { errores, avisos }.
function compruebaManifiesto(dir, manif) {
    const errores = [];
    const avisos = [];
    const esperado = manif.ficheros || {};
    for (const [rel, h] of Object.entries(esperado)) {
        let buf;
        try { buf = fs.readFileSync(path.join(dir, rel)); } catch (_) { errores.push('falta: ' + rel); continue; }
        if (sha256(buf) !== h) errores.push('modificado: ' + rel);
    }
    const sobran = [];
    const recorrer = (d, rel) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const r = rel ? rel + '/' + e.name : e.name;
            if (REGENERABLE.test(r)) { if (/node_modules$/.test(r)) avisos.push(r + '/ venía en el paquete: `npm ci` lo reinstala desde el lockfile'); continue; }
            if (e.isDirectory()) recorrer(path.join(d, e.name), r);
            else if (!Object.prototype.hasOwnProperty.call(esperado, r)) sobran.push(r);
        }
    };
    recorrer(dir, '');
    const prohibidos = rutasProhibidas(sobran);
    prohibidos.forEach((m) => errores.push('prohibido: ' + m));
    sobran.filter((r) => !rutasProhibidas([r]).length).forEach((r) => avisos.push('fuera del manifiesto: ' + r));
    return { errores, avisos };
}

module.exports = { PROHIBIDOS, rutasProhibidas, nombresDelZip, MANIFIESTO, compruebaManifiesto };

// ───────────────────────────────────────────────────────────────────────────
function git(args, opts) {
    return cp.spawnSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, opts));
}

function fallo(msg, detalle) {
    console.error('\n❌ ' + msg);
    if (detalle) console.error('   ' + String(detalle).split('\n').join('\n   '));
    console.error('');
    process.exit(1);
}

// npm desde Node sin `shell: true`: con el npm-cli.js que nos ha lanzado.
function npm(args, cwd) {
    const cli = process.env.npm_execpath;
    console.log('\n▶ npm ' + args.join(' ') + '   (' + path.relative(os.tmpdir(), cwd) + ')');
    const r = cli && /\.c?js$/.test(cli)
        ? cp.spawnSync(process.execPath, [cli].concat(args), { cwd, stdio: 'inherit' })
        : cp.spawnSync('npm', args, { cwd, stdio: 'inherit', shell: true });
    return r.status === 0;
}

// El recorrido del auditor sobre una carpeta ya descomprimida.
function recorridoDesdeCero(dir) {
    return npm(['ci', '--no-audit', '--no-fund'], dir) &&
           npm(['ci', '--no-audit', '--no-fund'], path.join(dir, 'functions')) &&
           npm(['run', 'build'], dir) &&
           npm(['run', 'lint'], dir) &&
           npm(['test'], dir);
}

// --verificar dentro de un paquete descomprimido (sin .git): el manifiesto
// sustituye a git como prueba de «esto es exactamente el commit X».
function verificaPaqueteSinGit() {
    let manif;
    try { manif = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFIESTO), 'utf8')); }
    catch (_) { fallo('Ni checkout de git ni ' + MANIFIESTO + ': esta carpeta no viene de `npm run package`.'); }
    console.log('\n🔎 Paquete del commit ' + manif.commit + ' (' + manif.fecha + '), ' + Object.keys(manif.ficheros || {}).length + ' ficheros');
    const { errores, avisos } = compruebaManifiesto(ROOT, manif);
    avisos.forEach((a) => console.log('   ℹ️  ' + a));
    if (errores.length) fallo('La carpeta NO coincide con su manifiesto:', errores.slice(0, 40).join('\n'));
    console.log('   ✓ todos los ficheros presentes e idénticos (sha256), nada prohibido');
    console.log('\n🧪 Verificando desde cero en ' + ROOT);
    if (!recorridoDesdeCero(ROOT)) fallo('La verificación desde cero ha FALLADO.', 'ver arriba');
    console.log('\n✅ Verificado: manifiesto + npm ci + build + lint + test en verde.');
}

function main() {
    const verificar = process.argv.includes('--verificar');

    // `.git` en la raíz y no `rev-parse`: un paquete descomprimido dentro de
    // OTRO repositorio respondería con el de fuera.
    if (!fs.existsSync(path.join(ROOT, '.git'))) {
        if (verificar) return verificaPaqueteSinGit();
        fallo('Esto no es un checkout de git: el paquete se hace DESDE git.');
    }

    const sucio = git(['status', '--porcelain', '--untracked-files=no']);
    if ((sucio.stdout || '').trim()) {
        fallo('Hay cambios sin commitear. El paquete es un COMMIT: commitea primero.', sucio.stdout.trim());
    }

    const sha = git(['rev-parse', '--short=7', 'HEAD']).stdout.trim();
    const contenido = git(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).stdout.split('\0').filter(Boolean);
    const malos = rutasProhibidas(contenido);
    if (malos.length) fallo('El commit ' + sha + ' lleva ficheros que no pueden viajar:', malos.join('\n'));

    // Manifiesto: commit + sha256 de cada fichero, generado desde git (no
    // desde el disco, que puede llevar cambios sin versionar).
    const tmpManif = fs.mkdtempSync(path.join(os.tmpdir(), 'cronos_manif_'));
    const manifPath = path.join(tmpManif, MANIFIESTO);
    let huellas;
    try { huellas = ficherosDelCommit('HEAD', contenido); } catch (e) { fallo('No se pudo leer el commit: ' + e.message); }
    fs.writeFileSync(manifPath, JSON.stringify({
        producto: 'cronos-futbol',
        commit: git(['rev-parse', 'HEAD']).stdout.trim(),
        fecha: new Date().toISOString(),
        instrucciones: 'npm run package:verificar  (comprueba este manifiesto y hace npm ci + build + lint + test)',
        ficheros: huellas,
    }, null, 1) + '\n');
    const archivo = (fmt, salida) => git(['archive', '--format=' + fmt, '--prefix=cronos-futbol/', '--add-file=' + manifPath, '-o', salida, 'HEAD']);

    const DIST = path.join(ROOT, 'dist');
    fs.mkdirSync(DIST, { recursive: true });
    const zip = path.join(DIST, 'cronos-futbol_' + sha + '.zip');
    const r = archivo('zip', zip);
    if (r.status !== 0) { fs.rmSync(tmpManif, { recursive: true, force: true }); fallo('git archive falló', r.stderr); }

    // Validar el ZIP producido, no la lista de git.
    let nombres;
    try { nombres = nombresDelZip(zip); } catch (e) { fs.rmSync(zip, { force: true }); fallo('ZIP ilegible: ' + e.message); }
    const enZip = nombres.map((n) => n.replace(/^cronos-futbol\//, ''));
    const malosZip = rutasProhibidas(enZip);
    if (malosZip.length) { fs.rmSync(zip, { force: true }); fallo('El ZIP llevaba ficheros prohibidos (borrado):', malosZip.join('\n')); }
    if (!enZip.includes(MANIFIESTO)) { fs.rmSync(zip, { force: true }); fallo('El ZIP no lleva ' + MANIFIESTO + ' (borrado)'); }

    const hash = sha256(fs.readFileSync(zip));
    const ficheros = enZip.filter((n) => n && !n.endsWith('/')).length;
    console.log('\n📦 Paquete limpio');
    console.log('   fichero ... ' + path.relative(ROOT, zip));
    console.log('   commit .... ' + sha);
    console.log('   ficheros .. ' + ficheros + '  (sin node_modules, sin respaldos, sin capturas; ' + MANIFIESTO + ' con su sha256)');
    console.log('   tamaño .... ' + (fs.statSync(zip).size / 1048576).toFixed(2) + ' MB');
    console.log('   sha256 .... ' + hash);
    console.log('   En destino:  npm run package:verificar   (o: npm ci && (cd functions && npm ci) && npm run build && npm run lint && npm test)');

    if (!verificar) { fs.rmSync(tmpManif, { recursive: true, force: true }); return; }

    // ── Verificación desde cero: el recorrido del auditor ────────────────
    // Se descomprime el MISMO contenido (manifiesto incluido) y se lanza ahí
    // `empaqueta.js --verificar`, que sin .git toma el camino del auditor.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cronos_pkg_'));
    const tar = path.join(tmp, 'p.tar');
    const dir = path.join(tmp, 'cronos-futbol');
    let ok = false;
    let error = '';
    try {
        // (`throw` y no `fallo()`: process.exit se saltaría el `finally` y
        // dejaría la carpeta temporal con una copia entera del proyecto.)
        const a = archivo('tar', tar);
        if (a.status !== 0) throw new Error('git archive (tar) falló: ' + a.stderr);
        // Ruta RELATIVA y `cwd`: el tar de GNU (el de Git Bash) lee `C:\…`
        // como «servidor C» y falla con «Cannot connect to C».
        const x = cp.spawnSync('tar', ['-xf', path.basename(tar)], { cwd: tmp, encoding: 'utf8' });
        if (x.status !== 0) throw new Error('no se pudo descomprimir: ' + x.stderr);
        const v = cp.spawnSync(process.execPath, [path.join('scripts', 'empaqueta.js'), '--verificar'], { cwd: dir, stdio: 'inherit' });
        ok = v.status === 0;
    } catch (e) {
        error = e.message;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(tmpManif, { recursive: true, force: true });
    }
    if (!ok) fallo('La verificación desde cero ha FALLADO. El paquete no está listo.', error || 'ver arriba');
    console.log('\n✅ Verificado desde cero: manifiesto + npm ci + build + lint + test en verde. Listo para entregar.');
}

if (require.main === module) main();

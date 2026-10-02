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

module.exports = { PROHIBIDOS, rutasProhibidas, nombresDelZip };

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

function main() {
    const verificar = process.argv.includes('--verificar');

    const top = git(['rev-parse', '--show-toplevel']);
    if (top.status !== 0) fallo('Esto no es un checkout de git: el paquete se hace DESDE git.', top.stderr);

    const sucio = git(['status', '--porcelain', '--untracked-files=no']);
    if ((sucio.stdout || '').trim()) {
        fallo('Hay cambios sin commitear. El paquete es un COMMIT: commitea primero.', sucio.stdout.trim());
    }

    const sha = git(['rev-parse', '--short=7', 'HEAD']).stdout.trim();
    const contenido = git(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).stdout.split('\0').filter(Boolean);
    const malos = rutasProhibidas(contenido);
    if (malos.length) fallo('El commit ' + sha + ' lleva ficheros que no pueden viajar:', malos.join('\n'));

    const DIST = path.join(ROOT, 'dist');
    fs.mkdirSync(DIST, { recursive: true });
    const zip = path.join(DIST, 'cronos-futbol_' + sha + '.zip');
    const r = git(['archive', '--format=zip', '--prefix=cronos-futbol/', '-o', zip, 'HEAD']);
    if (r.status !== 0) fallo('git archive falló', r.stderr);

    // Validar el ZIP producido, no la lista de git.
    let nombres;
    try { nombres = nombresDelZip(zip); } catch (e) { fs.rmSync(zip, { force: true }); fallo('ZIP ilegible: ' + e.message); }
    const enZip = nombres.map((n) => n.replace(/^cronos-futbol\//, ''));
    const malosZip = rutasProhibidas(enZip);
    if (malosZip.length) { fs.rmSync(zip, { force: true }); fallo('El ZIP llevaba ficheros prohibidos (borrado):', malosZip.join('\n')); }

    const hash = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    const ficheros = enZip.filter((n) => n && !n.endsWith('/')).length;
    console.log('\n📦 Paquete limpio');
    console.log('   fichero ... ' + path.relative(ROOT, zip));
    console.log('   commit .... ' + sha);
    console.log('   ficheros .. ' + ficheros + '  (sin node_modules, sin respaldos, sin capturas)');
    console.log('   tamaño .... ' + (fs.statSync(zip).size / 1048576).toFixed(2) + ' MB');
    console.log('   sha256 .... ' + hash);
    console.log('   Instalación en destino:  npm ci && (cd functions && npm ci)');

    if (!verificar) return;

    // ── Verificación desde cero: el recorrido del auditor ────────────────
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cronos_pkg_'));
    const tar = path.join(tmp, 'p.tar');
    const dir = path.join(tmp, 'cronos-futbol');
    let ok = false;
    let error = '';
    try {
        // (`throw` y no `fallo()`: process.exit se saltaría el `finally` y
        // dejaría la carpeta temporal con una copia entera del proyecto.)
        const a = git(['archive', '--format=tar', '--prefix=cronos-futbol/', '-o', tar, 'HEAD']);
        if (a.status !== 0) throw new Error('git archive (tar) falló: ' + a.stderr);
        // Ruta RELATIVA y `cwd`: el tar de GNU (el de Git Bash) lee `C:\…`
        // como «servidor C» y falla con «Cannot connect to C».
        const x = cp.spawnSync('tar', ['-xf', path.basename(tar)], { cwd: tmp, encoding: 'utf8' });
        if (x.status !== 0) throw new Error('no se pudo descomprimir: ' + x.stderr);
        console.log('\n🧪 Verificando desde cero en ' + dir);
        ok = npm(['ci', '--no-audit', '--no-fund'], dir) &&
             npm(['ci', '--no-audit', '--no-fund'], path.join(dir, 'functions')) &&
             npm(['run', 'build'], dir) &&
             npm(['run', 'lint'], dir) &&
             npm(['test'], dir);
    } catch (e) {
        error = e.message;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (!ok) fallo('La verificación desde cero ha FALLADO. El paquete no está listo.', error || 'ver arriba');
    console.log('\n✅ Verificado desde cero: npm ci + build + lint + test en verde. Listo para entregar.');
}

if (require.main === module) main();

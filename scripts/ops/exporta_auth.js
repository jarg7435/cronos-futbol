// ═══════════════════════════════════════════════════════════════════════════
//  scripts/ops/exporta_auth.js
//  EXPORTA LAS CUENTAS DE FIREBASE AUTH  ·  `npm run backup:auth`
//
//  🔑🔑 POR QUE ESTO ES UN PASO APARTE Y NO UN EXTRA
//  Una copia de Firestore NO contiene las cuentas de Auth. Y en este proyecto
//  `users/{uid}` esta indexado por el UID DE AUTH, igual que media docena de
//  colecciones mas. Restaurar Firestore sin esto deja 40 colecciones apuntando
//  a uids que ya no existen: los datos vuelven y NADIE PUEDE ENTRAR. Las
//  personas solo se podrian volver a casar por `email`, a mano, una a una.
//
//  🔑 Y ARRASTRA LOS CUSTOM CLAIMS (`customAttributes`: role, clubId), con los
//  que autoriza medio firestore.rules. Se COMPRUEBA aqui mismo en vez de darlo
//  por hecho: el fichero se lee despues de escribirlo y se cuenta cuantas
//  cuentas traen claims. Si esa cuenta sale 0 en un proyecto que los usa, la
//  exportacion no sirve para restaurar y hay que saberlo HOY, no el dia malo.
//
//  ⚠️⚠️ LO QUE ESCRIBE ES DATO PERSONAL DEL PEOR TIPO: correo y HASH DE
//  CONTRASENA de todas las familias, menores incluidos. Va a `backups/`, que
//  esta en .gitignore y TIENE QUE SEGUIR ESTANDOLO. Guardalo cifrado y fuera
//  de este ordenador; un backup en la carpeta de Descargas es una brecha
//  esperando a que alguien pierda el portatil.
//
//  ⚠️ El hash se exporta con sus parametros (`hash_config` del fichero). Para
//  reimportar hace falta el MISMO algoritmo, o las contrasenas no valdran:
//  `firebase auth:import <fichero> --hash-algo=... --hash-key=...`
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const PROJECT = 'cronos-futbol-app';
const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'backups');

// Fecha en el nombre: un fichero que se pisa a si mismo no es una copia, es la
// ultima copia. Aqui interesa poder volver a la de antes de un incidente.
const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const nombre = 'auth_users_' + sello + '.json';
const destino = path.join(DIR, nombre);

// ⚠️⚠️ LA RUTA QUE SE LE PASA A LA CLI VA **RELATIVA**, Y NO ES ESTETICA.
//   La ruta absoluta de este proyecto es
//   `C:\...\JOSÉ ALBERTO\PROYECTOS IA\APP CRONOS FÚTBOL\...`: lleva ESPACIOS
//   y ACENTOS. La primera version lanzaba `npx` con `shell: true`, que junta
//   los argumentos en una cadena y deja que el interprete la parta por los
//   espacios — con lo que `auth:export` recibia media docena de argumentos y
//   respondia «Too many arguments». Relativa a `cwd` (la raiz del repo) es
//   `backups/auth_users_….json`: sin un solo espacio.
const destinoRelativo = path.join('backups', nombre).replace(/\\/g, '/');

if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

// ⚠️ SE COMPRUEBA QUE `backups/` SIGA IGNORADO ANTES DE ESCRIBIR NADA. Si
//    alguien tocara .gitignore, el siguiente `git add -A` subiria los hashes
//    de contrasena de todas las familias a un repositorio. Se falla ANTES de
//    crear el fichero, no despues.
try {
    const r = cp.spawnSync('git', ['check-ignore', '-q', path.join('backups', 'x.json')],
                           { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
        console.error('\n❌ ABORTADO: `backups/` NO está ignorado por git.');
        console.error('   Este fichero lleva correos y hashes de contraseña de las familias.');
        console.error('   Arregla .gitignore antes de exportar nada.\n');
        process.exit(1);
    }
} catch (e) {
    console.error('\n❌ ABORTADO: no se ha podido comprobar .gitignore (' + e.message + ').');
    console.error('   No se exporta a ciegas un fichero con datos personales.\n');
    process.exit(1);
}

console.log('\n🔐 Exportando cuentas de Firebase Auth · ' + PROJECT);
console.log('   → ' + path.relative(ROOT, destino) + '\n');

// 🔑 SIN `shell: true`, Y LLAMANDO AL BINARIO LOCAL CON NODE.
//    Sin shell, los argumentos viajan como ARRAY y ninguno se parte, pase lo
//    que pase con los espacios. Y usando `node_modules/firebase-tools` se usa
//    la MISMA version que el resto del proyecto (la 15), no la que hubiera
//    instalada por ahi globalmente.
const BIN = path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
if (!fs.existsSync(BIN)) {
    console.error('\n❌ No se encuentra firebase-tools en node_modules. Ejecuta `npm install`.\n');
    process.exit(1);
}

const r = cp.spawnSync(process.execPath,
                       [BIN, 'auth:export', destinoRelativo, '--format=json', '--project', PROJECT],
                       { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });

if (r.status !== 0) {
    // ⚠️ NO SE ADIVINA LA CAUSA. La primera version decia siempre «¿Sesión del
    //    CLI? Prueba firebase login», y la causa real era un problema de
    //    ARGUMENTOS: mandaba a mirar donde no estaba el fallo. El motivo de
    //    verdad ya lo ha impreso la CLI justo arriba (stdio heredado).
    console.error('\n❌ La exportación falló (código ' + r.status + ').');
    console.error('   El motivo lo ha dicho la CLI ahí arriba. Si habla de');
    console.error('   credenciales o de sesión, prueba `firebase login`.\n');
    process.exit(1);
}

// ── Verificar lo que se acaba de escribir ───────────────────────────────
// Un fichero creado no es un fichero util: `auth:export` puede salir con 0 y
// dejar un JSON con cero cuentas si el proyecto es el equivocado.
let datos;
try {
    datos = JSON.parse(fs.readFileSync(destino, 'utf8'));
} catch (e) {
    console.error('\n❌ El fichero exportado no es JSON legible: ' + e.message + '\n');
    process.exit(1);
}

const usuarios = datos.users || [];
const conClaims = usuarios.filter((u) => u.customAttributes && u.customAttributes !== '{}');
const tam = (fs.statSync(destino).size / 1024).toFixed(1);

console.log('\n' + '─'.repeat(64));
console.log('  cuentas exportadas ....... ' + usuarios.length);
console.log('  con custom claims ........ ' + conClaims.length);
console.log('  tamaño ................... ' + tam + ' KB');

let fallos = 0;
if (!usuarios.length) {
    console.log('\n  ✗ CERO cuentas. Algo va mal: ¿es el proyecto correcto?');
    fallos++;
}
if (usuarios.length && !conClaims.length) {
    // No es fatal —los claims se pueden reconstruir con setCustomClaims desde
    // `users/{uid}`—, pero hay que SABERLO antes del dia malo, no durante.
    console.log('\n  ⚠️ Ninguna cuenta trae `customAttributes`.');
    console.log('     Este proyecto autoriza con los claims `role` y `clubId`, así que');
    console.log('     una restauración exigiría volver a asignarlos con setCustomClaims');
    console.log('     leyendo `users/{uid}`. Anótalo en el simulacro (RECUPERACION.md).');
}

console.log('\n  ⚠️ ESTE FICHERO LLEVA CORREOS Y HASHES DE CONTRASEÑA.');
console.log('     Guárdalo CIFRADO y FUERA de este ordenador. No lo subas a ningún sitio.');
console.log('─'.repeat(64) + '\n');

process.exit(fallos ? 1 : 0);

// ═══════════════════════════════════════════════════════════════════════════
//  scripts/ruta_respaldos.js  ·  DÓNDE VIVEN LOS RESPALDOS (2026-10-02)
//
//  🚨 POR QUÉ EXISTE. Hasta v779 los respaldos se escribían en `backups/`,
//  DENTRO del proyecto, y la única barrera era `.gitignore`. Pero git es sólo
//  UNA de las listas que deciden qué sale de esta carpeta:
//    · `firebase.json` publica la carpeta entera (`"public": "."`) y su
//      `ignore` NO excluía `backups/`: el export de Auth (correos + hashes de
//      contraseña) estuvo DESCARGABLE en producción y en testeo hasta el
//      2026-10-02.
//    · el ZIP que se entregó a la auditoría externa del 30-09 también los
//      llevaba: comprimir la carpeta no pregunta a .gitignore.
//  Tapar cada salida por separado ya falló dos veces. Lo que no puede salir
//  de la carpeta del proyecto es lo que NO ESTÁ en ella.
//
//  🔑 Por defecto: `~/CRONOS_RESPALDOS_PRIVADOS` (fuera del proyecto y fuera
//  de OneDrive, que sincroniza el Escritorio). Se puede cambiar con la
//  variable CRONOS_RESPALDOS, pero NUNCA a un sitio dentro del proyecto:
//  `dentroDelProyecto()` lo detecta y quien escribe tiene que abortar.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR_RESPALDOS = path.resolve(
    process.env.CRONOS_RESPALDOS || path.join(os.homedir(), 'CRONOS_RESPALDOS_PRIVADOS'));

// En Windows las rutas no distinguen mayúsculas: se compara en minúsculas.
function dentroDelProyecto(dir) {
    const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    const rel = path.relative(norm(ROOT), norm(path.resolve(dir)));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

module.exports = { ROOT, DIR_RESPALDOS, dentroDelProyecto };

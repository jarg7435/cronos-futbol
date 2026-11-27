// ─────────────────────────────────────────────────────────────────────────
// test_sdk_mismo_origen.js · El SDK de Firebase se sirve desde NUESTRO dominio
// (v866, Fase 2a de la pérdida de red)
//
// PRUEBA DE CAMPO DEL 26-11 (VALIDACION §4): la app instalada en el iPad no
// abría sin red. Una de las dos causas: el SDK venía de gstatic y el Service
// Worker no lo guarda (v454, y con razón: interceptar peticiones de OTRO
// ORIGEN que alimentan `import` dejó pantallas en negro en iPad). Sin red y
// con la caché HTTP de iOS vaciada, no había SDK y la app no arrancaba.
//
// EL ARREGLO, SIN TOCAR LAS 146 IMPORTACIONES: una copia de los 6 módulos en
// js/vendor/firebase/10.12.2/ y un IMPORT MAP en index.html y live.html que
// redirige el prefijo de gstatic a esa copia. Los módulos sólo se importan
// entre sí por `…/10.12.2/firebase-app.js`, que el mismo mapa redirige: en un
// documento, o TODO viene de la copia (navegador con import maps) o TODO de
// gstatic (navegador sin ellos). Nunca una mezcla con dos `firebase-app`.
// El Service Worker guarda la copia como cualquier fichero propio; v454 sigue
// en pie (gstatic no se intercepta).
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 240)); }
};
const leer = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return ''; } };

const VER = '10.12.2';
const PREFIJO = 'https://www.gstatic.com/firebasejs/' + VER + '/';
const DIR = 'js/vendor/firebase/' + VER + '/';
// Huellas de los ficheros bajados de gstatic el 27-11-2026. Si alguien
// sustituye uno (o sube de versión sin actualizar todo), salta aquí.
const SHA = {
    'firebase-app.js':       '08b83f02859328aabb9acea9370d600ffe739d9e2c251b6668b6f6ff56a2e1d1',
    'firebase-auth.js':      '9b2ebba6ffced4657e12300f4187d53c8fc1762e98188e5e2005407a86e926b6',
    'firebase-firestore.js': 'aecb2b5b722d1a45426326cd144bc025d5bea8c48f3a53eca3914ad587361bd4',
    'firebase-functions.js': 'ff26c4d8047bed91561ae1035cf6ca4205f3db37f887a6b15ceba232ad3f2bc9',
    'firebase-storage.js':   'ed550180b319f62991edcdbf2f2049124ac4d7e01d7fd86e7d91f07a7b962cc9',
    'firebase-app-check.js': '8d63723fc3ad5b7342230bbea4a6a60af91a3672703fc0b4e4f9d60169182403',
};

console.log('── SDK de Firebase desde el propio dominio (v866) ──\n');

console.log('── PARTE 1 · la copia ──');
for (const [f, sha] of Object.entries(SHA)) {
    let buf = null;
    try { buf = fs.readFileSync(path.join(ROOT, DIR, f)); } catch (e) {}
    ok('1 · ' + DIR + f + ' existe y es el de gstatic',
       buf && crypto.createHash('sha256').update(buf).digest('hex') === sha,
       buf ? 'huella distinta' : 'no existe');
    if (buf) {
        const imps = [...buf.toString('utf8').matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(x => x[1]);
        const ajenos = imps.filter(u => u !== PREFIJO + 'firebase-app.js');
        ok('1 · ' + f + ' sólo importa firebase-app.js por la URL que el mapa redirige', ajenos.length === 0, ajenos.join(', '));
    }
}

console.log('\n── PARTE 2 · todo lo que la app importa está en la copia ──');
{
    const usados = new Set();
    const recorre = (d) => {
        for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
            const p = d + '/' + e.name;
            if (e.isDirectory()) { if (e.name !== 'vendor') recorre(p); continue; }
            if (!/\.(js|mjs)$/.test(e.name)) continue;
            for (const m of leer(p).matchAll(/gstatic\.com\/firebasejs\/([0-9.]+)\/([a-z-]+\.js)/g)) usados.add(m[1] + '/' + m[2]);
        }
    };
    recorre('js');
    for (const h of ['index.html', 'live.html']) {
        for (const m of leer(h).matchAll(/gstatic\.com\/firebasejs\/([0-9.]+)\/([a-z-]+\.js)/g)) usados.add(m[1] + '/' + m[2]);
    }
    const fuera = [...usados].filter(u => !(u.startsWith(VER + '/') && SHA[u.slice(VER.length + 1)]));
    ok('2a · cada módulo del SDK que se importa (' + usados.size + ') tiene copia de la misma versión', fuera.length === 0 && usados.size > 0, fuera.join(', '));
}

console.log('\n── PARTE 3 · el import map ──');
for (const h of ['index.html', 'live.html']) {
    const t = leer(h).replace(/<!--[\s\S]*?-->/g, '');   // los comentarios no cuentan
    const m = t.match(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/);
    let mapa = null;
    try { mapa = m ? JSON.parse(m[1]) : null; } catch (e) {}
    ok('3a · ' + h + ' tiene un import map válido', !!mapa);
    const destino = mapa && mapa.imports && mapa.imports[PREFIJO];
    ok('3b · ' + h + ' redirige ' + PREFIJO + ' → ./' + DIR, destino === './' + DIR, String(destino));
    // Tiene que ir ANTES de cualquier <script>: un import() o un módulo
    // anterior al mapa lo deja sin efecto para todo el documento.
    const primerScript = t.search(/<script\b/i);
    ok('3c · ' + h + ': el import map es el PRIMER <script> del documento', m && primerScript === t.indexOf(m[0]));
    ok('3d · ' + h + ': sólo hay un import map', (t.match(/type=["']importmap["']/g) || []).length === 1);
}

console.log('\n── PARTE 4 · Service Worker ──');
{
    const sw = leer('sw.js');
    const iA = sw.indexOf('const ASSETS = [');
    const fA = sw.indexOf('];', iA);
    const assets = (iA !== -1 && fA > iA) ? sw.slice(iA, fA) : '';
    const faltan = Object.keys(SHA).filter(f => assets.indexOf("'./" + DIR + f + "'") === -1);
    ok('4a · los 6 módulos de la copia están en el precache (ASSETS)', faltan.length === 0, faltan.join(', '));
    ok('4b · v454 intacto: gstatic sigue sin interceptarse', /function _esCanalVivo[\s\S]{0,300}gstatic\.com/.test(sw));
    const iS = sw.indexOf('const SHELL = [');
    const shell = sw.slice(iS, sw.indexOf('];', iS));
    ok('4c · la copia NO va en el armazón que bloquea la instalación (v728)', iS !== -1 && shell.indexOf('vendor/firebase') === -1);
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

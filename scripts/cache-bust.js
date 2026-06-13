// scripts/cache-bust.js
// Sincroniza un parametro ?v=<VERSION> en todos los <script src="js/..."> de
// index.html, derivando la version del CACHE_NAME de sw.js (fuente de verdad).
// Idempotente: elimina cualquier ?v= previo antes de reescribir.
// Uso: node scripts/cache-bust.js
const fs = require('fs');

const sw = fs.readFileSync('sw.js', 'utf8');
// Lee la constante real, no los comentarios: const CACHE_NAME = 'cronos-cache-vNNN';
const m = sw.match(/const\s+CACHE_NAME\s*=\s*'cronos-cache-(v\d+)'/);
if (!m) { console.error('No se encontro la constante CACHE_NAME en sw.js'); process.exit(1); }
const VERSION = m[1];

const file = 'index.html';
let html = fs.readFileSync(file, 'utf8');

// Solo scripts LOCALES (src="js/..."). Evita CDNs (https://...).
// Captura: <script ... src="js/....js"  + (opcional ?v=...)  + "
const re = /(<script\b[^>]*\bsrc=")(js\/[^"?]+\.js)(\?v=[^"]*)?(")/g;
let count = 0;
html = html.replace(re, (_full, pre, path, _old, post) => {
  count++;
  return `${pre}${path}?v=${VERSION}${post}`;
});

fs.writeFileSync(file, html);
console.log(`cache-bust: ${count} scripts -> ?v=${VERSION} en ${file}`);

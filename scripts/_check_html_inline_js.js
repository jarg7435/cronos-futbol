// Extrae el <script type="module"> de un HTML y valida su sintaxis con node --check.
// Uso: node scripts/_check_html_inline_js.js <archivo.html>
const fs = require('fs');
const cp = require('child_process');
const os = require('os');
const path = require('path');

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
if (!m) { console.error('No <script> found'); process.exit(2); }
const js = m[1];
const tmp = path.join(os.tmpdir(), 'inline_js_check_' + Date.now() + '.mjs');
fs.writeFileSync(tmp, js, 'utf8');
try {
  cp.execFileSync(process.execPath, ['--check', tmp], { stdio: 'inherit' });
  console.log('OK: inline module JS syntax valid (' + js.split('\n').length + ' lines)');
} catch (e) {
  process.exit(1);
} finally {
  try { fs.unlinkSync(tmp); } catch (e) {}
}

// Ad-hoc syntax checker: copies files to an ASCII temp path (the project path
// has accents that break `node --check` via cmd.exe) and runs node --check.
const fs = require('fs');
const cp = require('child_process');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const argFiles = process.argv.slice(2);

// ⚠️ v596 · ANTES ERA UNA LISTA A MANO DE 18 FICHEROS, y por eso este checker
// daba VERDE sobre un fichero roto: js/core/setup-modal.js —2400 líneas, la
// mayor concentración de template literals del proyecto— NUNCA estuvo en ella.
// Un backtick metido en un comentario dentro de un template literal lo dejó sin
// compilar y `npm run` no dijo ni una palabra. Es la trampa que la cabecera de
// panel.js lleva advirtiendo desde v429, y una lista a mano no la ve nunca en
// los ficheros que no están escritos en ella.
// 🔑 Ahora se RECORRE js/ entero: un fichero nuevo entra solo.
// 🟡 EXCLUSIONES, UNA A UNA Y CON MOTIVO. Nunca por patrón: una exclusión
// genérica es como la lista a mano de antes — esconde lo que no se mira.
// HOY ESTÁ VACÍA, y ése es el estado bueno: todo js/ se comprueba.
//  · El primer y único inquilino fue js/core/logger.js, que NO ERA JAVASCRIPT
//    (una copia antigua de package.json colada en el commit cdb912c, "Fase
//    0+1"). Se BORRÓ el 2026-08-21 tras comprobar que no lo referenciaba
//    ningún <script>, ningún import ni el precache de sw.js.
const EXCLUIDOS = new Set([]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js') &&
             !EXCLUIDOS.has(path.relative(root, p).replace(/\\/g, '/'))) out.push(p);
  }
  return out;
}

// ⚠️ LA LISTA EXPLÍCITA SE QUEDA, aunque el recorrido ya la cubra entera.
// No es redundante: catorce guards de módulos extraídos comprueban que su
// fichero está REGISTRADO aquí por su nombre (la aserción "1e · registrado en
// index.html, en el precache del SW y en _check_syntax"). Es su forma de
// exigir que un módulo nuevo quede declarado en los tres sitios, y borrarla
// los pone a todos en rojo. El recorrido AÑADE cobertura; no la sustituye.
const COBERTURA_DECLARADA = [
  'js/services/firestore-sync.js',
  'js/coach/reports/report-engine.js',
  'js/coach/reports/club-reports.js',
  'js/coach/reports/director-config.js',
  'js/coach/reports/events-tab.js',
  'js/match/live/finished-index.js',
  'js/coach/reports/finished-matches-tab.js',
  'js/coach/reports/reports-tab.js',
  'js/coach/reports/reports-export.js',
  'js/coach/comms/panel.js',
  'js/coach/comms/training-notify.js',
  'js/coach/comms/collective-report.js',
  'js/coach/comms/individual-reports.js',
  'js/coach/comms/contact-manager.js',
  'js/coach/comms/bulk-messaging.js',
  'js/coach/comms/match-reports-send.js',
  'js/coach/comms/match-reports-auto.js',
  'js/services/auth.js',
  'js/services/auth/role-launch.js',
  // v596 · El que faltaba y costó una ronda: ver la nota de arriba.
  'js/core/setup-modal.js',
  // v669 · Selección múltiple reutilizable. Lo consumen seis listados de tres
  // áreas, así que se declara igual que el resto de módulos compartidos.
  'js/shared/multi-select.js',
  // v672 · Pases de regalo, dentro de la Secretaría del SuperAdmin.
  'js/admin/superadmin/gift-passes.js',
];

const files = (argFiles.length
  ? argFiles.map(f => path.isAbsolute(f) ? f : path.join(root, f))
  : [...new Set([
      ...COBERTURA_DECLARADA.map(f => path.join(root, f)),
      ...walk(path.join(root, 'js'), []),
    ])].sort());
let anyErr = false;
for (const f of files) {
  const tmp = path.join(os.tmpdir(), 'chk_' + path.basename(f));
  fs.copyFileSync(f, tmp);
  try {
    cp.execSync('node --check "' + tmp + '"', { stdio: 'pipe' });
    console.log('OK   ' + f);
  } catch (e) {
    anyErr = true;
    console.log('ERR  ' + f + '\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}
process.exit(anyErr ? 1 : 0);

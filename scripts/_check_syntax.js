// Ad-hoc syntax checker: copies files to an ASCII temp path (the project path
// has accents that break `node --check` via cmd.exe) and runs node --check.
const fs = require('fs');
const cp = require('child_process');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const argFiles = process.argv.slice(2);
const files = (argFiles.length ? argFiles : [
  'js/services/firestore-sync.js',
  'js/coach/reports/club-reports.js',
]).map(f => path.isAbsolute(f) ? f : path.join(root, f));
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

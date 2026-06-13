const https = require('https');

function fetch(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

(async () => {
  const hosts = [
    'https://cronos-futbol-app.web.app',
    'https://jarg7435.github.io/cronos-futbol',
  ];
  for (const base of hosts) {
    console.log('################ ' + base + ' ################');

    const idx = await fetch(base + '/index.html');
    console.log('--- index.html STATUS ' + idx.status + '  cache-control: ' + idx.headers['cache-control']);
    const versioned = (idx.body.match(/src="js\/[^"]+\?v=v\d+"/g) || []);
    const unversioned = (idx.body.match(/src="js\/[^"?]+\.js"/g) || []);
    console.log('  <script src=js/...> con ?v=: ' + versioned.length + ' | sin ?v=: ' + unversioned.length);
    const panelTag = (idx.body.match(/src="js\/parent\/panel\.js[^"]*"/) || ['(no encontrado)'])[0];
    console.log('  panel.js tag: ' + panelTag);

    // Pide panel.js EXACTAMENTE como lo pediria el navegador (con ?v=)
    const m = panelTag.match(/src="([^"]+)"/);
    if (m) {
      const purl = base + '/' + m[1].replace(/^\//, '');
      const p = await fetch(purl);
      const occ = (p.body.match(/parent_player_report/g) || []).length;
      const hasFix = p.body.includes("if (data.type !== 'parent_player_report') return;");
      console.log('  GET ' + purl);
      console.log('    STATUS ' + p.status + '  cache-control: ' + p.headers['cache-control']);
      console.log('    parent_player_report ocurrencias: ' + occ + '  | FIX v169 presente: ' + hasFix);
    }
    console.log('');
  }
})();

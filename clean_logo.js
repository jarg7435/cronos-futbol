const fs = require('fs');
const path = 'app.js';
let content = fs.readFileSync(path, 'utf8');

// Buscamos el inicio del modal y el final de la línea del logo base64
// El logo está en una línea que empieza con <img src="data:image/png;base64
const lines = content.split('\n');
const newLines = lines.map(line => {
    if (line.includes('<img src="data:image/png;base64')) {
        return '                <div style="display:flex;align-items:center;"><img src="img/logo_cronos.png" style="height:45px; margin-right:12px; filter: drop-shadow(0 0 10px rgba(88,166,255,0.3));" onerror="this.style.display=\'none\'">';
    }
    return line;
});

fs.writeFileSync(path, newLines.join('\n'));
console.log('Logo base64 reemplazado con éxito.');

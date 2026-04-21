const fs = require('fs');
const path = 'js/11_persistence.js';
let content = fs.readFileSync(path, 'utf8');

// Eliminamos los escapes de acentos abiertos y dólares en plantillas literales
// Buscamos \` y los cambiamos por `
// Buscamos \${ y los cambiamos por ${
content = content.replace(/\\`/g, '`');
content = content.replace(/\\\$\{/g, '${');

fs.writeFileSync(path, content);
console.log('js/11_persistence.js limpiado con éxito.');

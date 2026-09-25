// ─────────────────────────────────────────────────────────────────────────
//  test_convocatoria_no_desborda_v768.js  ·  📐 v768 (2026-09-25)
//
//  Capturas 10911-10912: las fichas de la derecha y el campo «Rival» se
//  salían del panel de la convocatoria. Medido en Chrome sin interfaz con el
//  HTML real del modal (F11, 25 jugadores): ANTES 10 fichas fuera (hasta
//  +344 px) y barra horizontal a 820-1920 px; DESPUÉS 0 fuera y 0 nombres
//  recortados en escritorio y tableta, en los dos modos de dorsal.
//
//  Dos causas, y se vigilan las dos:
//   1. `repeat(5, 1fr)`: una columna `1fr` no baja de su contenido sin
//      partir (nombre + asistencia + TITULAR). → columnas que QUEPAN.
//   2. `.conv-input` no tenía estilo en este modal (lo inyectan el panel de
//      envío y el de entrenamientos): sin pasar por ellos, cada campo tomaba
//      su ancho por defecto. → el modal declara el suyo.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai', 'import.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };
const i = SRC.indexOf('function openConvocationModal()');
const MODAL = SRC.slice(i, SRC.indexOf('\nfunction ', i + 10));

console.log('\n══ 📐 v768 · la convocatoria no se sale del panel ══');
const rejilla = (MODAL.match(/<div style="([^"]*)" id="conv-grid-container">/) || [])[1] || '';
ok('1a · la rejilla de fichas pone las columnas que QUEPAN (auto-fill + mínimo acotado al 100%)',
   /grid-template-columns:repeat\(auto-fill, minmax\(min\(100%, /.test(rejilla));
ok('1b · 🔑 ya no hay un nº fijo de columnas `repeat(N, 1fr)`', !/repeat\(\$\{cols\}, 1fr\)/.test(MODAL) && !/repeat\(\d, 1fr\)/.test(rejilla));
ok('1c · la ficha y el nombre pueden encoger (min-width:0) y las etiquetas bajan de línea antes que recortar',
   /\.conv-row \{[^}]*min-width:0[^}]*flex-wrap:wrap/.test(MODAL) && /\.conv-nombre \{[^}]*min-width:0/.test(MODAL) &&
   /class="conv-nombre"/.test(MODAL));
ok('2a · 🔑 el modal declara su propio `.conv-input` a ancho completo con box-sizing',
   /#setup-modal \.conv-input \{[^}]*width:100%[^}]*box-sizing:border-box/.test(MODAL));
ok('2b · el panel no pasa del ancho de la pantalla', /class="modal-content" style="width:min\(96vw,860px\); max-width:100%; box-sizing:border-box;/.test(MODAL));

console.log(`\nResultado: ${pass}/${pass + fail}  ${fail ? '❌ ' + fail + ' FALLOS' : '✅'}`);
process.exit(fail ? 1 : 0);

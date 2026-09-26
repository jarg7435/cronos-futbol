// ─────────────────────────────────────────────────────────────────────────
// v769 · Planificación Semanal en el móvil (capturas IMG_4856 / IMG_4857)
//
//   1. La botonera (Enviar · PDF · Copiar · Limpiar · Guardar) se pintaba
//      ENCIMA del miércoles y el jueves en un iPhone apaisado. La caja de la
//      tabla llevaba `flex:1; min-height:0` dentro de un .modal-content que
//      hace él el scroll: se encogía al alto libre, la tabla se desbordaba
//      por fuera y la botonera caía encima. Medido en Chrome headless a
//      852×393: botonera en y=239 con la tabla acabando en y=514.
//      → la caja va a `flex:0 0 auto` y la botonera no se encoge.
//   2. La casilla de HORA se montaba sobre DURACIÓN: `.conv-input` no tenía
//      estilo en este modal (content-box + width:100% + relleno) y el control
//      nativo de iOS trae su alto y ancho mínimo. → el modal declara el suyo.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'coach', 'training', 'panel.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };

const ini = SRC.indexOf('function renderTrainingWeek(');
const fin = SRC.indexOf('\nfunction ', ini + 10);
const RW = SRC.slice(ini, fin);

console.log('\n1 · La botonera no pisa la tabla');
ok('1a · 🔑 la caja de la tabla va a su alto natural (flex:0 0 auto)',
   /<div style="flex:0 0 auto; display:flex; gap:0\.7rem; align-items:stretch; flex-wrap:wrap;">/.test(RW));
ok('1b · y ya no lleva flex:1 + min-height:0',
   !/<div style="flex:1; display:flex; gap:0\.7rem;[^"]*min-height:0/.test(RW));
ok('1c · la botonera no se encoge',
   /<div style="flex-shrink:0; margin-top:0\.8rem; display:flex; gap:0\.5rem; justify-content:flex-end;/.test(RW));

console.log('\n2 · La casilla de hora no invade Duración');
ok('2a · 🔑 el modal declara `.conv-input` con box-sizing:border-box',
   /#setup-modal \.conv-input \{[^}]*box-sizing:border-box/.test(RW));
ok('2b · todas las casillas de la tabla con el mismo alto',
   /#setup-modal td \.conv-input \{ height:1\.85rem; \}/.test(RW));
ok('2c · la hora sin aspecto nativo de iOS',
   /#setup-modal input\[type="time"\]\.conv-input \{[^}]*-webkit-appearance:none; appearance:none;/.test(RW));
ok('2d · …y sin un height propio que anule el alto común',
   !/#setup-modal input\[type="time"\]\.conv-input \{[^}]*(?<![-\w])height:/.test(RW));

console.log(`\nResultado: ${pass}/${pass + fail}  ${fail ? '❌ ' + fail + ' FALLOS' : '✅'}`);
process.exit(fail ? 1 : 0);

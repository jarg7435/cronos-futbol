// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v841 · Gestionar Plantilla: cabecera y columnas alineadas
// ═══════════════════════════════════════════════════════════════════════════
// Captura 11720: «★ ALIAS (EN FICHA)» caía sobre una columna vacía y las
// casillas de alias iban una más allá; el ID salía cortado («RGB0…») y el
// dorsal de dos cifras también («1(»).
// 🔴 CAUSA: las filas tienen 5 celdas (ID, #, Nombre, ORIGEN de las plazas de
//    apoyo, Alias) y la cabecera sólo 4: la del origen se había perdido.
// Se comprueba también en Chrome sin pantalla (escritorio y táctil a 16 px):
// cabecera = celdas al píxel, 0 IDs y 0 dorsales cortados.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'staff-and-comms.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const iThead = src.indexOf('<thead>', src.indexOf('function openRosterManager'));
const thead = src.slice(iThead, src.indexOf('</thead>', iThead));
const nTh = (thead.match(/<th[\s>]/g) || []).length;
const iFila = src.indexOf('<tr>', src.indexOf('id="roster-tbody"'));
const fila = src.slice(iFila, src.indexOf('</tr>', iFila));
const nTdBase = (fila.match(/<td[\s>]/g) || []).length;
const iApoyo = src.indexOf('function _cronosSupportRowHtml');
const apoyo = src.slice(iApoyo, src.indexOf('</tr>', iApoyo));
const nTdApoyo = (apoyo.match(/<td[\s>]/g) || []).length;

ok('1 · la cabecera tiene tantas columnas como la fila base (' + nTh + ' / ' + nTdBase + ')', nTh === 5 && nTdBase === 5);
ok('2 · y como la fila de plaza de apoyo (' + nTdApoyo + ')', nTdApoyo === 5);
ok('3 · la 4ª cabecera dice «Origen» sólo si hay un invitado', /i >= limit && p\.isGuest\) \? 'Origen' : ''/.test(thead));
ok('4 · el ID se enseña como texto (no en una casilla de 45 px)',
   !/class="r-id"[^>]*width:45px/.test(src) && (src.match(/type="hidden" class="r-id"/g) || []).length === 2);
ok('5 · el guardado sigue leyendo .r-id', /row\.querySelector\('\.r-id'\)\?\.value/.test(src));
ok('6 · el dorsal ya no va en 40 px', !/class="r-num"[^>]*width:40px/.test(src) &&
   (src.match(/class="r-num"[^>]*width:3\.4rem/g) || []).length === 2);

console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

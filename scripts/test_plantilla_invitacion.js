// ════════════════════════════════════════════════════════════════════════
//  test_plantilla_invitacion.js — v783
//  ⚠️ SIN «secret» EN EL NOMBRE: `.gitignore` ignora `*secret*`.
// ════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-10-04, capturas 11090-11092):
//  la plantilla de fábrica de la Secretaría pasa a ser EXACTAMENTE su texto,
//  con las marcas dinámicas y «CHRONOS FÚTBOL» en negrita.
//
//  🔑 LO QUE SE PROTEGE:
//   · El texto, LETRA POR LETRA, tal y como lo escribió (con club).
//   · Sin club (SuperAdmin) no queda «del .» ni una firma vacía.
//   · La negrita: `**x**` → <strong>x</strong> en la vista previa Y en el
//     correo, con la MISMA regla, y SIEMPRE escapando antes de marcar (un
//     `<script>` escrito en el mensaje no puede salir como HTML).
//   · El texto plano del correo va sin asteriscos.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SECR = leer('js/admin/superadmin/secretary.js');
const FUNC = leer('functions/index.js');

const sb = { console: { log() {}, warn() {}, error() {} }, document: { getElementById: () => null },
             localStorage: { getItem() { return null; }, setItem() {} }, setTimeout() {} };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(SECR, sb);
const W = sb.window;

// ── PARTE 1 · el texto exacto ─────────────────────────────────────────────
console.log('\nPARTE 1 · la plantilla de fábrica es el texto del autor');
const ESPERADO =
    'Hola, {nombre}:\n\n' +
    'Te damos la bienvenida a **CHRONOS FÚTBOL**. Has sido invitado a unirte a nuestra plataforma como {rol} del {club}.\n\n' +
    '**CHRONOS FÚTBOL** es una aplicación diseñada especialmente para el fútbol base: ayuda a que directiva, cuerpo técnico y familias compartan un mismo espacio de trabajo y disfruten al máximo de este deporte.\n\n' +
    'Pulsa el botón de abajo para completar tu registro: el correo, el rol y el club ya te vendrán rellenos y sólo tendrás que elegir tu contraseña.\n\n' +
    '¡Muchas gracias por tu implicación y bienvenido a bordo!\n\n' +
    'Un saludo,\n' +
    '{club}';
const conClub = W.secPlantillaFabrica('email', 'CD DÍA');
ok('1a · con club: idéntica, letra por letra, a la del encargo', conClub === ESPERADO,
   conClub === ESPERADO ? '' : [conClub, ESPERADO]);
ok('1b · el club va como MARCA, no escrito dentro (sirve para guardarla)', !/CD DÍA/.test(conClub));

const sinClub = W.secPlantillaFabrica('email', '');
ok('1c · sin club: no hay «del {club}» (quedaría «del .»)', !/del \{club\}/.test(sinClub) && /como \{rol\}\./.test(sinClub));
ok('1d · sin club: firma la plataforma, no una línea vacía', /Un saludo,\nCHRONOS FÚTBOL$/.test(sinClub), sinClub.slice(-30));

const render = W.secRenderPlantilla(conClub, { nombre: 'Ana', rol: 'Director Deportivo', club: 'CD DÍA', enlace: '' });
ok('1e · ya sustituida: «como Director Deportivo del CD DÍA.»', /como Director Deportivo del CD DÍA\./.test(render));
ok('1f · ya sustituida: firma «CD DÍA»', /Un saludo,\nCD DÍA$/.test(render));

// ── PARTE 2 · la negrita en la vista previa ───────────────────────────────
console.log('\nPARTE 2 · la negrita de la vista previa');
const html = W.secNegritaHtml(render);
ok('2a · **CHRONOS FÚTBOL** sale en <strong>', (html.match(/<strong>CHRONOS FÚTBOL<\/strong>/g) || []).length === 2, html.slice(0, 120));
ok('2b · no quedan asteriscos', !/\*\*/.test(html));
const malo = W.secNegritaHtml('Hola <script>alert(1)</script> y **<img src=x onerror=1>**');
ok('2c · 🔑 se ESCAPA antes de marcar: nada del usuario sale como HTML',
   !/<script>/.test(malo) && !/<img/.test(malo) && /<strong>&lt;img src=x onerror=1&gt;<\/strong>/.test(malo), malo);
ok('2d · la vista previa se pinta POR secNegritaHtml', /prev\.innerHTML = window\.secNegritaHtml\(/.test(SECR));

// ── PARTE 3 · el servidor ─────────────────────────────────────────────────
console.log('\nPARTE 3 · sendInviteEmail pinta la misma negrita');
const fn = FUNC.slice(FUNC.indexOf('exports.sendInviteEmail'));
const reCli = SECR.match(/\.replace\((\/\\\*\\\*\(\[\^\*\\n\]\+\?\)\\\*\\\*\/g), '<strong>\$1<\/strong>'\)/);
const reSrv = fn.match(/const _NEGRITA = (\/[^;]+\/g);/);
ok('3a · el servidor declara la regla de negrita', !!reSrv);
ok('3b · 🔑 es LA MISMA expresión que la del cliente', reCli && reSrv && reCli[1] === reSrv[1], [reCli && reCli[1], reSrv && reSrv[1]]);
ok('3c · 🔑 en el HTML escapa PRIMERO y marca DESPUÉS',
   /_esc\(body\)\.replace\(_NEGRITA, '<strong>\$1<\/strong>'\)/.test(fn));
ok('3d · el texto plano va SIN asteriscos', /const textBody = \(body \? body\.replace\(_NEGRITA, '\$1'\) : ''\)/.test(fn));

// Y se EJECUTA: la regla del servidor, aplicada como él la aplica.
if (reSrv) {
    const _NEG = vm.runInNewContext(reSrv[1]);
    const _esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const out = _esc('Te damos la bienvenida a **CHRONOS FÚTBOL** y **<b>x</b>**').replace(_NEG, '<strong>$1</strong>');
    ok('3e · ejecutada: negrita sí, HTML del usuario no',
       /<strong>CHRONOS FÚTBOL<\/strong>/.test(out) && !/<b>/.test(out), out);
}

console.log('\n' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos ? 1 : 0);

// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v857 · LA CONSOLA DEL NAVEGADOR NO ESCRIBE DATOS PERSONALES
// ═══════════════════════════════════════════════════════════════════════════
//  Reauditoría del 19-11, «revisar los logs del navegador». La consola sólo se
//  ve en el propio aparato, pero se queda a la vista en un iPad compartido del
//  club, en una captura enviada para pedir ayuda o en una depuración remota.
//  Lo que se encontró al revisarlo (2026-11-22), todo en whatsapp-email.js:
//   · el selector de destinatarios escribía NOMBRE + CORREO + roles de TODOS
//     los usuarios del club, uno por línea;
//   · publicar una convocatoria volcaba la LISTA DE JUGADORES (menores) y el
//     primero en JSON crudo, y el objeto entero de la convocatoria.
//
//  🔑 Como el guard del backend (test_logs_sin_pii.js), se recorren TODAS las
//  llamadas: el riesgo es la próxima `console.log(user.email)` de diagnóstico.
//
//  Lo PERMITIDO: uid, ids de documento, códigos de error, `e.message`,
//  recuentos (`.length`), categorías y nombres de club. Y cualquier cosa
//  detrás de `window._CRONOS_DEBUG`, que en producción vale false.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 1500));
        fallos++;
    }
}

function ficherosJs(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'vendor') out.push(...ficherosJs(p)); }
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

// Cada `console.x( … )` con sus paréntesis equilibrados (mismo extractor que
// el guard del backend). Las cadenas se saltan para no descuadrar la cuenta.
function llamadasConsole(src) {
    const out = [];
    const re = /console\.(log|warn|error|info|debug|table)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
        let i = re.lastIndex, nivel = 1, q = null;
        while (i < src.length && nivel > 0) {
            const c = src[i];
            if (q) { if (c === '\\') i++; else if (c === q) q = null; }
            else if (c === '\'' || c === '"' || c === '`') q = c;
            else if (c === '(') nivel++;
            else if (c === ')') nivel--;
            i++;
        }
        const inicioLinea = src.lastIndexOf('\n', m.index) + 1;
        out.push({
            linea: src.slice(0, m.index).split('\n').length,
            texto: src.slice(m.index, i),
            antes: src.slice(inicioLinea, m.index),           // misma línea, antes de la llamada
        });
    }
    return out;
}

// Quita el TEXTO fijo de los literales pero conserva lo interpolado en `${…}`:
// lo que importa son las expresiones que se registran.
function sinLiterales(t) {
    return t
        .replace(/`(?:\\.|[^`\\])*`/g, (s) => (s.match(/\$\{[^}]*\}/g) || []).join(' + '))
        .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
}

const PROHIBIDAS = [
    { re: /\.(?:email|displayName|phone|phoneNumber|telefono|nombre)\b/, por: 'campo personal de un objeto' },
    { re: /\b(?:u|user|usuario|p|player|jugador|c|contact|contacto|m|member)\.name\b/, por: 'nombre de una persona' },
    { re: /\b(?:playersArr|_savedConvokedPlayers|_savedConvData|convokedPlayers)\b(?!\s*(?:\.length|\?|&&))/, por: 'lista de jugadores / convocatoria' },
    { re: /JSON\.stringify\([^)]*(?:player|jugador|Players|user|usuario)/i, por: 'volcado JSON de personas' },
    { re: /\b(?:password|contrasena|contraseña)\b/, por: 'secreto' },
];

console.log('\n══ v857 · la consola del navegador, sin datos personales ══');

const FICHEROS = [...ficherosJs(path.join(RAIZ, 'js')),
                  path.join(RAIZ, 'index.html'), path.join(RAIZ, 'live.html')];

console.log('\n1) 🔑 NINGUNA llamada a console.* escribe datos personales (salvo tras _CRONOS_DEBUG)');
let revisadas = 0, depuracion = 0;
const malas = [];
for (const f of FICHEROS) {
    const src = fs.readFileSync(f, 'utf8');
    for (const l of llamadasConsole(src)) {
        revisadas++;
        // Depuración permitida: `_CRONOS_DEBUG` (false en producción) y el
        // diagnóstico opcional de informes `_diag` = window._cronosDiagReports
        // (coach/comms/panel.js), que sólo se enciende a mano desde la consola.
        if (/_CRONOS_DEBUG|if\s*\(\s*_diag\s*\)/.test(l.antes)) { depuracion++; continue; }
        const expr = sinLiterales(l.texto);
        for (const p of PROHIBIDAS) {
            if (p.re.test(expr)) {
                malas.push(path.relative(RAIZ, f).replace(/\\/g, '/') + ':' + l.linea + ' (' + p.por + ') ' +
                           l.texto.replace(/\s+/g, ' ').slice(0, 130));
                break;
            }
        }
    }
}
ok('1a · ' + FICHEROS.length + ' ficheros, ' + revisadas + ' llamadas revisadas (' + depuracion +
   ' tras _CRONOS_DEBUG): ninguna con datos personales', malas.length === 0, malas.join('\n      → '));
ok('1b · el recorrido no está vacío (extractor vivo)', revisadas > 500, revisadas);

console.log('\n2) Lo corregido en whatsapp-email.js no puede volver');
const WE = fs.readFileSync(path.join(RAIZ, 'js/shared/whatsapp-email.js'), 'utf8');
ok('2a · 🔑 el selector no escribe usuario a usuario (nombre/correo)',
   !/console\.log\([^;]*name=.*email=/.test(WE));
ok('2b · …pero conserva el recuento de usuarios cargados',
   /\[_cronosLoadClubUsers\] cargados', users\.length/.test(WE));
ok('2c · 🔑 la convocatoria no vuelca la lista de jugadores ni el JSON crudo',
   !/console\.log\([^;]*JSON\.stringify\(window\._savedConvokedPlayers/.test(WE) &&
   !/console\.log\([^;]*playersArr\.length,\s*playersArr\)/.test(WE));
ok('2d · el objeto de la convocatoria y los uids enviados, sólo en depuración',
   /_CRONOS_DEBUG\)\s*console\.log\('\[publishConvocationToAppV2\] _savedConvData/.test(WE) &&
   /_CRONOS_DEBUG\)\s*console\.log\('\[publishConvocationToAppV2\] Debug:/.test(WE));

console.log('\n3) El interruptor de depuración sigue apagado en el código servido');
const INIT = fs.readFileSync(path.join(RAIZ, 'js/core/app-init.js'), 'utf8');
ok('3 · window._CRONOS_DEBUG = false', /window\._CRONOS_DEBUG\s*=\s*false/.test(INIT));

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);

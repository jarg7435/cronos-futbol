// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v848 · LOS REGISTROS DEL BACKEND NO GUARDAN PII NI CREDENCIALES
// ═══════════════════════════════════════════════════════════════════════════
//  Reauditoría del 31-10, «revisión formal de logs para evitar PII
//  innecesaria». Cloud Logging conserva lo que escriben las Functions y lo lee
//  cualquiera con acceso al proyecto. Lo que se encontró al revisarlo:
//   · sendInviteEmail escribía el CORREO del invitado entero, y
//   · la URL de invitación, que lleva el token opaco de UN SOLO USO: una
//     credencial canjeable en el registro.
//
//  🔑 POR QUÉ SE RECORREN TODAS LAS LLAMADAS y no sólo las cuatro corregidas:
//  el riesgo no es que vuelvan esas cuatro, es la QUINTA — un `console.log`
//  de diagnóstico con `user.email` añadido con prisa. Este guard lo corta
//  donde se escriba.
//
//  Lo PERMITIDO es trazabilidad técnica: uid, ids de documento, códigos de
//  error, contadores, nombres de club (no son datos de una persona).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const FICHEROS = ['functions/index.js', 'functions/purga_usuario.js'];

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 400));
        fallos++;
    }
}

// Extrae cada `console.x( … )` con sus paréntesis equilibrados. Las cadenas se
// saltan para que un «(» dentro de un texto no descuadre la cuenta.
function llamadasConsole(src) {
    const out = [];
    const re = /console\.(log|warn|error|info)\s*\(/g;
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
        const linea = src.slice(0, m.index).split('\n').length;
        out.push({ linea, texto: src.slice(m.index, i) });
    }
    return out;
}

// Quita los literales de cadena: lo que se mira son las EXPRESIONES que se
// registran, no las palabras de los mensajes («Email enviado a:» es texto).
function sinLiterales(t) {
    return t.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''");
}

// Expresiones que NUNCA pueden llegar a un registro en crudo.
const PROHIBIDAS = [
    { re: /\binviteUrl\b|\binviteToken\b|\btokenLimpio\b/, por: 'enlace/token de invitación (credencial)' },
    { re: /\b(?:email|correo|correoReal|realEmail|parentEmail|requestedEmail|emailUser)\b(?!\s*\))/, por: 'correo' },
    { re: /\.(?:email|displayName|phone|phoneNumber|telefono|nombre)\b/, por: 'campo personal de un objeto' },
    { re: /\b(?:password|pass|emailPass)\b/, por: 'secreto' },
    // `to` es el destinatario de sendInviteEmail: como ARGUMENTO suelto.
    { re: /(?:\(|,|\+)\s*to\s*(?:,|\)|\+)/, por: 'destinatario en crudo' },
];

console.log('\n══ v848 · los registros del backend, sin PII ni credenciales ══');

console.log('\n1) 🔑 NINGUNA llamada a console.* registra datos personales en crudo');
for (const rel of FICHEROS) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const llamadas = llamadasConsole(src);
    const malas = [];
    for (const l of llamadas) {
        // Lo que pasa por un enmascarador ya va limpio.
        const expr = sinLiterales(l.texto)
            .replace(/_correoEnLog\([^)]*\)/g, '_M_')
            .replace(/_sinCorreosEnLog\([^)]*\)/g, '_M_')
            // `!!emailUser` registra si HAY credencial, no cuál es.
            .replace(/!!\s*emailUser\b/g, '_B_')
            // `tokenLimpio ? 'forma invalida' : 'sin token'` sólo dice si
            // llegó algo: el token no se escribe.
            .replace(/\btokenLimpio\s*\?/g, '_B_ ?');
        for (const p of PROHIBIDAS) {
            if (p.re.test(expr)) malas.push(rel + ':' + l.linea + ' (' + p.por + ') ' + l.texto.replace(/\s+/g, ' ').slice(0, 140));
        }
    }
    ok('1 · ' + rel + ' · ' + llamadas.length + ' llamadas revisadas, ninguna con PII', malas.length === 0, malas.join('\n      → '));
}

console.log('\n2) sendInviteEmail: lo que se corrigió no puede volver');
const IDX = fs.readFileSync(path.join(RAIZ, 'functions/index.js'), 'utf8');
const _ini = IDX.indexOf('exports.sendInviteEmail');
const SEND = IDX.slice(_ini, IDX.indexOf('\nexports.', _ini + 10));
ok('2a · 🔑 ningún registro de sendInviteEmail lleva la URL de invitación',
   llamadasConsole(SEND).every(l => !/inviteUrl/.test(l.texto)));
ok('2b · el destinatario se registra enmascarado',
   /Iniciando\. Destino:',\s*_correoEnLog\(to\)/.test(SEND) &&
   /Email enviado a:',\s*_correoEnLog\(to\)/.test(SEND));
ok('2c · el error SMTP pasa por el filtro de correos',
   /Error Nodemailer:',\s*_sinCorreosEnLog\(error\.message\)/.test(SEND));
ok('2d · …y la traza conserva quién invita (uid) y el messageId',
   /uid:',\s*context\.auth\.uid/.test(SEND) && /MessageId:',\s*info\.messageId/.test(SEND));

console.log('\n3) Los enmascaradores, EJECUTADOS');
const a = IDX.indexOf('function _correoEnLog(');
if (a < 0) {
    ok('3 · los enmascaradores existen en functions/index.js', false, 'no está _correoEnLog');
} else {
    const b = IDX.indexOf('exports.sendInviteEmail', a);
    const sb = { String };
    vm.createContext(sb);
    vm.runInContext(IDX.slice(a, b) + '\n;this.c = _correoEnLog; this.s = _sinCorreosEnLog;', sb);
    ok('3a · ana.garcia@club.es → a***@club.es', sb.c('ana.garcia@club.es') === 'a***@club.es', sb.c('ana.garcia@club.es'));
    ok('3b · sin correo no revienta', sb.c('') === '(sin correo)' && sb.c(null) === '(sin correo)');
    const smtp = '550 5.1.1 <pepe.lopez@gmail.com>: Recipient address rejected';
    const limpio = sb.s(smtp);
    ok('3c · 🔑 el error SMTP pierde la dirección pero conserva el código',
       !/pepe\.lopez/.test(limpio) && /p\*\*\*@gmail\.com/.test(limpio) && /^550 5\.1\.1/.test(limpio), limpio);
    ok('3d · un texto sin correos sale tal cual', sb.s('Invalid login: 535') === 'Invalid login: 535');
}

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);

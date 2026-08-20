// ─────────────────────────────────────────────────────────────────────────
// test_correo_invitacion_texto.js
//
// v595 · EL CORREO DE INVITACIÓN, TAL Y COMO LO LEE EL DESTINATARIO.
//
// POR QUÉ EXISTE
//   El autor abrió el correo real que le llega a un invitado (capturas
//   9333/9334) y encontró dos cosas que no puede ver ningún test de lógica:
//
//   1. TODO el texto fijo del correo iba SIN TILDES — "Invitacion a Chronos
//      Futbol" en el asunto y en la cabecera, "desde Chronos Futbol" en el
//      pie, "Si el boton no funciona"… No había ninguna razón técnica: la
//      misma función ya enviaba `from: "Chronos Fútbol"` con tilde y llegaba
//      bien. Alguien las quitó por miedo al encoding y se quedaron.
//
//   2. En mitad del párrafo salía el marcador de ayuda de la plantilla:
//      "🔗 [ENLACE DE INVITACIÓN - SE AÑADE AUTOMÁTICAMENTE AL ENVIAR]".
//      🔑 Ese texto ya se había quitado del cliente en v594, pero su captura
//      salió de PRODUCCIÓN, que servía v593. Y ahí está la lección: la
//      plantilla la escribe el CLIENTE, así que mientras haya un navegador
//      con la versión vieja en caché —o una plantilla del club guardada que
//      lo contenga— el marcador puede volver. Por eso se limpia en el
//      SERVIDOR, que es el último sitio por el que pasa el correo.
//
// 🔑 ESTE GUARD NO SE CONFORMA CON CENSAR TEXTO: extrae la limpieza REAL de
//    functions/index.js y la EJECUTA. Un censo por regex habría dado verde
//    sobre una expresión regular mal escrita.
//
// ⚠️ La marca se escribe CHRONOS, con hache (decisión de v476, ver
//    scripts/test_marca_chronos_y_rojas.js). Aquí solo se añaden tildes.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
const ok = (n, c, x) => {
    total++;
    if (c) console.log('  ✓ ' + n);
    else { console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 220) : '')); fallos++; }
};

const FN = fs.readFileSync(path.join(RAIZ, 'functions', 'index.js'), 'utf8');
const BLOQUE = FN.slice(FN.indexOf('exports.sendInviteEmail'), FN.indexOf('exports.registerStaffUid'));
if (!BLOQUE) { console.log('\n✗ No se localizó sendInviteEmail en functions/index.js'); process.exit(1); }

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · las tildes del texto fijo del correo ──');
// ───────────────────────────────────────────────────────────────────────────
// Se buscan las formas SIN tilde: si alguna reaparece, esto se pone rojo.
const SIN_TILDE = [
    ['Chronos Futbol', 'la marca, en cabecera / pie / asunto / texto plano'],
    ['Invitacion',     'el asunto y el <h1> de la cabecera'],
    ['el boton',       '"Si el botón no funciona…"'],
    ['Direccion Deportiva', 'la firma del club cuando invita un Director'],
];
SIN_TILDE.forEach(([mal, donde]) => {
    ok('1 · sin tildes NO aparece "' + mal + '" (' + donde + ')',
       !BLOQUE.includes(mal),
       (BLOQUE.match(new RegExp('.{0,45}' + mal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.{0,25}')) || [])[0]);
});

// Y que la forma BUENA sí esté: sin esto, borrar la línea entera daría verde.
const CON_TILDE = ['Invitación a Chronos Fútbol', 'desde Chronos Fútbol', 'Si el botón no funciona'];
CON_TILDE.forEach(t => ok('1b · aparece la forma correcta: "' + t + '"', BLOQUE.includes(t)));

// ⚠️⚠️ LA HACHE. El autor la recordó expresamente mientras se hacía esto
// (2026-08-20): «RECUERDA PONER chronos, con la h intercalada». Es la misma
// decisión de v476, donde hubo que corregir 93 sitios. Al añadir las tildes
// era fácil escribir "Cronos Fútbol" de paso, así que se fija aquí: NINGÚN
// "Cronos" sin hache puede aparecer en el correo, en ninguna forma.
// ⚠️ SE MIRA EL TEXTO QUE LEE UNA PERSONA, no los identificadores. El dominio
// real del proyecto es `cronos-futbol-app.web.app` y las colecciones se llaman
// `cronos_notifications`: van SIN hache y no se pueden cambiar. Sin quitarlos
// antes, esta comprobación daba rojo sobre la URL de la app — pasó al
// escribirla.
const TEXTO_VISIBLE = BLOQUE
    .replace(/https?:\/\/[^\s'"]+/g, '')
    .replace(/cronos[-_][a-z0-9_-]+/gi, '');
ok('1c · ⚠️⚠️ la marca conserva la HACHE en TODO el correo (CHRONOS, v476)',
   !/(^|[^Hh])Cronos/i.test(TEXTO_VISIBLE),
   (TEXTO_VISIBLE.match(/.{0,40}[^Hh]Cronos.{0,20}/i) || [])[0]);
ok('1d · … y la marca aparece escrita entera al menos una vez',
   /Chronos Fútbol/.test(BLOQUE));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · la limpieza del marcador, EJECUTADA de verdad ──');
// ───────────────────────────────────────────────────────────────────────────
// Se extrae la expresión tal cual está en el fichero y se ejecuta. Si alguien
// toca una de las tres sustituciones, aquí se nota.
const mLimpia = BLOQUE.match(/const _quitarMarcador = \(t\) =>[\s\S]*?\.trim\(\);/);
ok('2a · la función de limpieza sigue en sendInviteEmail', !!mLimpia);

if (mLimpia) {
    const sb = { console: { log() {}, warn() {} }, String };
    vm.createContext(sb);
    vm.runInContext(mLimpia[0].replace(/^const /, 'var ') + '\nthis.limpiar = _quitarMarcador;', sb);
    const limpiar = sb.limpiar;

    const MARCADOR = '[ENLACE DE INVITACIÓN - SE AÑADE AUTOMÁTICAMENTE AL ENVIAR]';

    // El caso EXACTO que reportó el autor, copiado de la plantilla de v593.
    const real = 'Hola, Ana:\n\n' +
        'Para acceder directamente a la plataforma, haz clic en el siguiente enlace de invitación:\n\n' +
        '🔗 ' + MARCADOR + '\n\n' +
        '¡Muchas gracias por tu implicación y bienvenido a bordo!';
    const salida = limpiar(real);
    ok('2b · 🔑 el marcador de su captura desaparece', !salida.includes('ENLACE DE INVITACIÓN'), salida);
    ok('2c · … y el emoji suelto tampoco se queda huérfano', !/🔗\s*$/m.test(salida), salida);
    ok('2d · ⚠️ el resto del mensaje del club se conserva intacto',
       salida.includes('Hola, Ana:') && salida.includes('¡Muchas gracias por tu implicación y bienvenido a bordo!'));
    ok('2e · no deja un agujero de tres saltos de línea', !/\n{3,}/.test(salida), salida);

    // Variantes: sin emoji, sin tilde en "INVITACION", en mitad de una frase.
    ok('2f · sin el emoji delante', !limpiar('a\n' + MARCADOR + '\nb').includes('ENLACE'));
    ok('2g · con "INVITACION" sin tilde (así estaba en versiones viejas)',
       !limpiar('a\n🔗 [ENLACE DE INVITACION - SE AÑADE AL ENVIAR]\nb').includes('ENLACE'));
    ok('2h · incrustado en mitad de un párrafo',
       limpiar('Entra aquí ' + MARCADOR + ' y regístrate.').replace(/\s+/g, ' ') === 'Entra aquí y regístrate.',
       limpiar('Entra aquí ' + MARCADOR + ' y regístrate.'));

    // ⚠️ Y LO QUE NO DEBE TOCAR. El mensaje es del club: no se le censura.
    ok('2i · ⚠️ NO borra otros corchetes del mensaje del club',
       limpiar('Trae [equipación blanca] y [botas de tacos]') === 'Trae [equipación blanca] y [botas de tacos]');
    ok('2j · un mensaje normal pasa sin cambios',
       limpiar('Hola {nombre}, entra en {enlace}') === 'Hola {nombre}, entra en {enlace}');
    ok('2k · null / vacío no revientan', limpiar(null) === '' && limpiar(undefined) === '');
    ok('2l · si el mensaje era SOLO el marcador, queda vacío y el correo cae a su texto por defecto',
       limpiar('🔗 ' + MARCADOR) === '');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el cliente ya no genera el marcador (v594) ──');
// ───────────────────────────────────────────────────────────────────────────
const SEC = fs.readFileSync(path.join(RAIZ, 'js', 'admin', 'superadmin', 'secretary.js'), 'utf8');
ok('3a · la plantilla de fábrica NO lleva el marcador', !SEC.includes('SE AÑADE AUTOMÁTICAMENTE'));
ok('3b · … lleva la marca {enlace}, que se sustituye por el enlace real', SEC.includes('🔗 {enlace}'));

console.log('\n' + (fallos === 0
    ? '✅ TODO OK (' + total + ' comprobaciones)'
    : '❌ ' + fallos + ' FALLOS de ' + total));
process.exit(fallos === 0 ? 0 : 1);

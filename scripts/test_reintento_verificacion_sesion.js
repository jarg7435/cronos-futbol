// ═══════════════════════════════════════════════════════════════════════════
//  UN FALLO TRANSITORIO NO PUEDE APARCARTE EN LA PANTALLA DE LA CLAVE — v529
// ═══════════════════════════════════════════════════════════════════════════
//  POR QUÉ EXISTE
//
//  Reporte del autor, tres rondas seguidas: en el iPad, tras DESCARGAR el vídeo
//  del partido, al cerrar el reproductor la app le pide la contraseña otra vez.
//  Se descartó la ✕ (prueba A/B suya) y se descartó la memoria (v526: liberar
//  las pistas, los trozos y el lienzo NO lo arregló, ya con la versión
//  confirmada en pantalla por la insignia de v528).
//
//  🔑🔑🔑 EL FALLO NO ES QUE SE PIERDA LA SESIÓN: ES QUE SE LE APARCA EN EL
//  LOGIN. En `checkAuthorization`, dos caminos enseñan la pantalla de acceso y
//  se rinden sin reintentar NUNCA:
//    · el catch final, cuando la lectura del documento de usuario da un fallo
//      de red o agota su tope de 4 s (`Firestore no responde`);
//    · el CASO 0, cuando la lectura vuelve vacía y marcada `fromCache`.
//  La sesión de Firebase sigue viva en los dos (eso ya se arregló y sigue
//  vigente), pero el usuario ve el panel de la clave y concluye, con razón,
//  que le han echado.
//
//  Un iPad que acaba de recargar la pestaña tras exportar un vídeo es
//  exactamente el escenario donde esa primera lectura tarda de más.
//
//  ⚠️ SEC-M08 SIGUE EN PIE: reintentar NO es entrar. Si la verificación no
//  llega a completarse, no se entra en la app con datos parciales jamás.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
// CRONOS_AUTH_JS permite apuntar a una copia MUTADA (para el red-check) o al
// fichero que sirve producción.
const AUTH = fs.readFileSync(process.env.CRONOS_AUTH_JS ||
                             path.join(RAIZ, 'js/services/auth.js'), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}

// El bloque del catch final, que es donde se decide si se le expulsa.
// ⚠️ La ventana tiene que llegar hasta el showAuthError del final. Con 2600
// caracteres se quedaba corta en cuanto crecieron los comentarios, el indexOf
// devolvía -1 y la comparación de orden salía roja sin que el código fallara:
// una ventana mal medida es un falso rojo esperando su turno.
const iCatch  = AUTH.indexOf('Auth verify error');
const bloqueCatch = iCatch === -1 ? '' : AUTH.slice(iCatch, iCatch + 4200);

// ⚠️⚠️ DESPOJAR DE COMENTARIOS ANTES DE COMPARAR EL ORDEN. La primera versión
// de este guard daba rojo con el código correcto porque el comentario que
// explica el arreglo contiene la palabra "showAuthError", y el indexOf la
// encontraba ANTES que la llamada real. Es la cuarta vez en el proyecto que
// una aserción casa mi propio comentario: sobre orden y presencia, siempre
// sobre el CÓDIGO.
const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '')
                     .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const codCatch = sinCom(bloqueCatch);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · un fallo de red se REINTENTA, no se rinde ──');
// ───────────────────────────────────────────────────────────────────────────
ok('1a · existe el catch final de la verificación', !!bloqueCatch);

ok('1b · 🔑🔑 ante un fallo de red se programa un REINTENTO',
   /_programaReintentoAuth\(/.test(codCatch),
   'el catch enseña la pantalla de acceso y no vuelve a intentarlo nunca');

// 🔑 EL ORDEN ES EL ARREGLO. Conservar la sesión no sirve de nada si acto
// seguido se le enseña el panel de la clave: hay que SALIR antes.
ok('1c · 🔑 y se sale SIN enseñar la pantalla de la clave mientras queden intentos',
   codCatch.indexOf('_programaReintentoAuth(') !== -1 &&
   codCatch.indexOf('showAuthError') !== -1 &&
   codCatch.indexOf('_programaReintentoAuth(') < codCatch.indexOf('showAuthError') &&
   /_programaReintentoAuth\([^)]*\)\)\s*return;/.test(codCatch),
   'el reintento tiene que ir ANTES del showAuthError, y con return');

// El resto se mide donde de verdad vive: la función auxiliar.
const iHelper = AUTH.indexOf('function _programaReintentoAuth');
const helper  = iHelper === -1 ? '' : AUTH.slice(iHelper, iHelper + 900);

ok('1d · el reintento vuelve a llamar a la verificación con el mismo usuario',
   /checkAuthorization\(user\)/.test(helper),
   'no encuentro la rellamada dentro del programador de reintentos');

ok('1e · ⚠️ con TOPE: sin él, un fallo permanente sería un bucle infinito',
   /_MAX_REINTENTOS_AUTH/.test(AUTH) &&
   /_reintentosAuth\s*>=\s*_MAX_REINTENTOS_AUTH/.test(helper),
   'no encuentro el tope de reintentos');

ok('1f · y con espera creciente entre intentos',
   /Math\.pow\(2/.test(helper) && /setTimeout/.test(helper),
   'reintentar tres veces seguidas en el mismo instante no reintenta nada');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · el contador se pone a cero cuando Firestore responde ──');
// ───────────────────────────────────────────────────────────────────────────
// Sin esto, tres cortes de red a lo largo del día dejarían la cuenta agotada y
// el cuarto arranque volvería a aparcarle en el login sin reintentar.
{
    const iLectura = AUTH.indexOf('CASO 0: sin cobertura');
    const antes = iLectura === -1 ? '' : AUTH.slice(Math.max(0, iLectura - 700), iLectura);
    ok('2a · 🔑 tras una lectura con éxito el contador se reinicia',
       /_reintentosAuth\s*=\s*0/.test(antes),
       'el contador no se reinicia junto a la lectura buena');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el CASO 0 tampoco puede rendirse a la primera ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const i = AUTH.indexOf('CASO 0: sin cobertura');
    const bloque0 = i === -1 ? '' : AUTH.slice(i, i + 1600);
    ok('3a · existe el CASO 0 (lectura vacía y de caché)', !!bloque0);
    ok('3b · 🔑 también reintenta antes de enseñar la pantalla de acceso',
       /_programaReintentoAuth\([^)]*\)\)\s*return;/.test(bloque0) &&
       bloque0.indexOf('_programaReintentoAuth(') < bloque0.indexOf('showAuthError'),
       'una lectura fromCache al arrancar le manda directo al login');
    ok('3c · y conserva su mensaje para cuando de verdad no hay nada que hacer',
       /Sin conexión y sin datos/.test(bloque0));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · lo que NO puede romperse ──');
// ───────────────────────────────────────────────────────────────────────────
ok('4a · ⚠️ SEC-M08: ningún camino de reintento entra en la app',
   !/_reintentosAuth[\s\S]{0,300}?enterApp\(\)/.test(AUTH),
   'reintentar no es entrar: nunca con datos parciales');
ok('4b · un fallo de RED sigue sin destruir la sesión (lo de v447)',
   /_esDeRed/.test(bloqueCatch) && /if\s*\(user\s*&&\s*!_esDeRed\)/.test(bloqueCatch),
   'el signOut volvería a dispararse por un corte de cobertura');
ok('4c · un fallo REAL de autorización sigue expulsando',
   /signOut/.test(bloqueCatch),
   'sin esto, una cuenta revocada se quedaría dentro');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ Un fallo transitorio se reintenta en vez de pedir la contraseña');

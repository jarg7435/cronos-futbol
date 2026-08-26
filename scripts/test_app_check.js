// ─────────────────────────────────────────────────────────────────────────
//  test_app_check.js  ·  v634
//
//  App Check estuvo apagado desde la v227 (el intercambio de token daba 403 y
//  entraba en throttle de 24 h). Se reactiva, pero con una condicion que es
//  TODO el contenido de este guard:
//
//  🔴 LA CLAVE DE reCAPTCHA SOLO TIENE REGISTRADO EL DOMINIO DE PRODUCCION.
//  Medido contra Google: `cronos-futbol-test.web.app` devuelve exactamente la
//  misma respuesta que un dominio inventado — 1506 bytes de pagina de error,
//  frente a los ~39 KB del anchor real. reCAPTCHA no lo conoce.
//
//  🔑 POR ESO NO SE ARRANCA EN TODAS PARTES. En un dominio no registrado el
//  intercambio falla y VUELVE A DISPARAR EL THROTTLE DE 24 H, que es el
//  agujero exacto de la v227. Y el autor prueba testeo y produccion en el
//  MISMO navegador: un throttle provocado en testeo le estropearia produccion.
//
//  ⚠️ ACTIVAR EL SDK NO BASTA: App Check solo defiende cuando la
//  OBLIGATORIEDAD esta encendida por servicio en Firebase Console. Este guard
//  fija la PREPARACION del cliente; encenderla es un paso aparte que se decide
//  y se comprueba alli.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

const INIT = leer('js/services/firebase-init.js');
const LIVE = leer('live.html');
const SW   = leer('sw.js');

console.log('\n══ v634 · App Check: activo donde puede, callado donde no ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🛡️ Se activa de verdad (ya no es un bloque comentado)');
{
    ok('1a · 🔑 el bloque de App Check NO está comentado',
       /initializeAppCheck\(app, \{/.test(INIT) &&
       !/\/\*[\s\S]*initializeAppCheck\(app, \{[\s\S]*\*\//.test(INIT),
       'desde v227 vivía dentro de un /* */ — existía y no hacía nada');

    ok('1b · usa reCAPTCHA v3 con la clave del proyecto',
       /new ReCaptchaV3Provider\(/.test(INIT) &&
       /6Ld5cEQtAAAAAA0OCimDVsOORapoEKfsVmJmGI23/.test(INIT));

    ok('1c · con refresco automático de token',
       /isTokenAutoRefreshEnabled: true/.test(INIT));

    // ⚠️ Se mide la ESTRUCTURA, no la cercanía de dos cadenas: la propiedad
    //    real es «un fallo de App Check no interrumpe el arranque», y eso es
    //    try + catch que NO relanza. Una regex de proximidad se rompería con
    //    sólo añadir un comentario, y aflojarla hasta que pase sería peor que
    //    no tenerla.
    const _reg = (INIT.match(/const APPCHECK_HOSTS[\s\S]*?_cronosAppCheck = 'off'/) || [''])[0];
    ok('1d · ⚠️ y NO puede tumbar el arranque: try/catch que no relanza',
       /try \{/.test(_reg) && /catch \(e\)/.test(_reg) &&
       /_cronosAppCheck = 'error'/.test(_reg) && !/\bthrow\b/.test(_reg),
       'mientras la obligatoriedad no esté encendida, la app funciona igual sin token');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔴 Sólo donde reCAPTCHA nos conoce');
{
    ok('2a · 🔑🔑 hay una lista EXPLÍCITA de dominios',
       /const APPCHECK_HOSTS = \[/.test(INIT));

    ok('2b · producción está dentro',
       /APPCHECK_HOSTS = \[[^\]]*cronos-futbol-app\.web\.app/.test(INIT));

    // 🚨 ESTA ES LA ASERCIÓN QUE IMPORTA. Meter testeo aquí SIN registrarlo
    //    antes en reCAPTCHA reintroduce el throttle de 24 h de la v227.
    ok('2c · 🚨 TESTEO **NO** está: su dominio no está registrado en la clave',
       !/APPCHECK_HOSTS = \[[^\]]*cronos-futbol-test/.test(INIT),
       'si alguien lo añade sin darlo de alta en www.google.com/recaptcha/admin, ' +
       'vuelve el throttle de 24 h — y machaca la sesión de producción del mismo navegador');

    ok('2d · en un dominio no registrado ni se intenta, y se explica por qué',
       /App Check inactivo en[\s\S]{0,120}no está registrado/.test(INIT),
       'un silencio aquí se leería como "App Check está roto"');

    ok('2e · ⚠️ el token de DEPURACIÓN sólo en local, nunca en producción',
       /if \(_local\) self\.FIREBASE_APPCHECK_DEBUG_TOKEN = true;/.test(INIT),
       'un debug token suelto en producción anula App Check por completo');

    ok('2f · queda escrito cómo añadir testeo el día que se registre',
       /PARA AÑADIR TESTEO/.test(INIT));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 🔑 El VISOR EN VIVO también, que arranca su propia app');
{
    //  Si App Check sólo estuviera en firebase-init.js, el día que se ponga
    //  ENFORCED el visor se quedaría fuera: pantalla en negro en pleno partido.
    ok('3a · 🔑🔑 live.html inicializa App Check',
       /initializeAppCheck\(app, \{/.test(LIVE),
       'es un documento APARTE con su propio initializeApp: media medida = corte');

    ok('3b · con la misma clave',
       /6Ld5cEQtAAAAAA0OCimDVsOORapoEKfsVmJmGI23/.test(LIVE));

    ok('3c · y la MISMA restricción de dominios',
       /const HOSTS = \[[^\]]*cronos-futbol-app\.web\.app/.test(LIVE) &&
       !/const HOSTS = \[[^\]]*cronos-futbol-test/.test(LIVE));

    ok('3d · ⚠️ tampoco puede tumbar el visor',
       /catch \(e\) \{[\s\S]{0,200}Visor: App Check no arrancó/.test(LIVE));

    ok('3e · el debug token, también sólo en local',
       /if \(local\) self\.FIREBASE_APPCHECK_DEBUG_TOKEN = true;/.test(LIVE));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) 🚦 El Service Worker no puede tocar reCAPTCHA');
{
    const fn = (SW.match(/function _esCanalVivo\(url\) \{[\s\S]*?\n\}/) || [''])[0];

    ok('4a · 🔑 `/recaptcha/` pasa sin que el SW lo intercepte',
       /\/recaptcha\//.test(fn),
       'reCAPTCHA es antiabuso: su script y sus peticiones llevan estado y son ' +
       'de un solo uso. Servirlas desde caché = el token no se emite nunca');

    ok('4b · y recaptcha.net (el dominio alternativo) también',
       /recaptcha\.net/.test(fn));

    ok('4c · ⚠️ vive en www.google.com, que NO entraba por la regla de gstatic',
       /gstatic\.com/.test(fn) && /\/recaptcha\//.test(fn),
       'por eso hizo falta una línea aparte, no bastaba la que ya había');
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);

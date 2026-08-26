// ─────────────────────────────────────────────────────────────────────────
//  test_app_check.js  ·  v634
//
//  App Check estuvo apagado desde la v227 (el intercambio de token daba 403 y
//  entraba en throttle de 24 h). Se reactiva, pero con una condicion que es
//  TODO el contenido de este guard:
//
//  🔑 SOLO SE ARRANCA EN DOMINIOS REGISTRADOS EN LA CLAVE DE reCAPTCHA.
//  Se comprueba sondeando su `anchor` con ese origen: un dominio desconocido
//  devuelve ~1,5 KB de pagina de error; uno registrado, ~39 KB. Asi se
//  verifico `cronos-futbol-test.web.app` el 26-08 ANTES de meterlo en la lista.
//
//  🔴 EL ORDEN IMPORTA Y AL REVES NO AVISA NADIE: en un dominio no registrado
//  el intercambio falla y DISPARA UN THROTTLE DE 24 H, el agujero exacto de la
//  v227. Y testeo y produccion se prueban en el MISMO navegador, asi que un
//  throttle provocado en testeo estropea la sesion de produccion.
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

    // ⚠️ Hasta el 26-08 aquí se afirmaba lo contrario: que testeo **NO** podía
    //    estar, porque su dominio no estaba dado de alta en la clave. Se
    //    registró y se verificó sondeando el `anchor` de reCAPTCHA (un dominio
    //    desconocido devuelve ~1,5 KB; uno registrado, ~39 KB), así que esa
    //    aserción se SUSTITUYE — no se borra ni se afloja.
    ok('2c · testeo ya está en la lista (dominio registrado el 26-08)',
       /APPCHECK_HOSTS = \[[\s\S]{0,200}cronos-futbol-test\.web\.app/.test(INIT));

    // 🚨 Y ESTE ES EL RIESGO QUE SUSTITUYE AL ANTERIOR: que las dos listas se
    //    separen. Son DOS ficheros a propósito (el visor es autónomo), así que
    //    es fácil tocar una y olvidar la otra — y el síntoma sería el visor
    //    quedándose fuera en pleno partido, que es justo lo que se vino a
    //    evitar. Se comparan los hosts, no el texto.
    const _hosts = (src, re) => {
        const m = src.match(re);
        return m ? (m[1].match(/'[^']+'/g) || []).map(s => s.slice(1, -1)).sort() : null;
    };
    const hInit = _hosts(INIT, /APPCHECK_HOSTS = \[([\s\S]*?)\]/);
    const hLive = _hosts(LIVE, /const HOSTS = \[([\s\S]*?)\]/);
    ok('2c2 · 🔑🔑 la lista de la app y la del VISOR son IDÉNTICAS',
       !!hInit && !!hLive && JSON.stringify(hInit) === JSON.stringify(hLive),
       'app: ' + JSON.stringify(hInit) + ' · visor: ' + JSON.stringify(hLive));

    ok('2c3 · ⚠️ y ningún host se cuela sin estar registrado en reCAPTCHA',
       !!hInit && hInit.every(h => /^cronos-futbol-(app|test)\.(web\.app|firebaseapp\.com)$/.test(h)),
       'añadir uno sin darlo de alta en www.google.com/recaptcha/admin devuelve ' +
       'el throttle de 24 h — y machaca la sesión de producción del mismo navegador');

    ok('2d · en un dominio no registrado ni se intenta, y se explica por qué',
       /App Check inactivo en[\s\S]{0,120}no está registrado/.test(INIT),
       'un silencio aquí se leería como "App Check está roto"');

    ok('2e · ⚠️ el token de DEPURACIÓN sólo en local, nunca en producción',
       /if \(_local\) self\.FIREBASE_APPCHECK_DEBUG_TOKEN = true;/.test(INIT),
       'un debug token suelto en producción anula App Check por completo');

    // Antes decía «cómo añadir TESTEO»; ya está añadido, así que la nota se
    // generalizó a cualquier host. La intención es la misma: que el
    // procedimiento —y sobre todo el ORDEN— estén escritos donde se toca.
    ok('2f · queda escrito el procedimiento para añadir un host, y su ORDEN',
       /ANTES DE AÑADIR UN HOST A LA LISTA/.test(INIT) &&
       /recaptcha\/admin/.test(INIT));
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

    // La igualdad de las dos listas se comprueba en 2c2; aquí sólo que el
    // visor tenga la suya y no se quede con los dominios cableados a mano.
    ok('3c · y su propia lista de dominios',
       /const HOSTS = \[[\s\S]{0,200}cronos-futbol-app\.web\.app/.test(LIVE));

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

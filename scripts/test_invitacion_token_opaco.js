// ─────────────────────────────────────────────────────────────────────────
//  test_invitacion_token_opaco.js  ·  v633
//
//  El enlace de invitación llevaba el correo, el rol y el club EN CLARO en la
//  dirección. Eso queda escrito en el historial del navegador, en los
//  registros del servidor de correo y en la cabecera `Referer` de cualquier
//  recurso que cargue la página de alta. Y el enlace no caducaba ni se
//  consumía: valía para siempre y para quien lo reenviara.
//
//  Ahora los datos viven en `invites/{token}` y la dirección sólo lleva un
//  token aleatorio de 128 bits.
//
//  ════════════════════════════════════════════════════════════════════
//  🔴 LAS CUATRO TRAMPAS DE ESTE CAMBIO, Y QUE SON LO QUE ESTE GUARD FIJA
//
//  1. `read` = `get` + `list`. El token es el secreto, así que su `get` va
//     SIN autenticar: quien abre la invitación todavía no tiene cuenta. Pero
//     si eso se escribiera como `allow read`, cualquiera podría vaciar la
//     colección entera con un `getDocs` y quedarse con TODOS los correos
//     invitados. `get` y `list` van separados, y `list` es sólo del SA.
//
//  2. ACUÑAR CUESTA UNA ESCRITURA, y `_secDatosActuales()` corre en CADA
//     PULSACIÓN DE TECLA (`oninput` → saUpdateInvitePreview). Si el token se
//     creara ahí, un solo envío dejaría cientos de invitaciones vivas —cada
//     una un enlace válido de verdad—. Se acuña al COPIAR o al ENVIAR.
//
//  3. `?invite=` YA EXISTÍA en index.html, pero sólo para saltarse el
//     onboarding: el gate que cambia a la pestaña «Registrarse» miraba
//     `register=true`. Con el token la URL ya no lo lleva, así que el
//     invitado aterrizaba en LOGIN, sin cuenta que usar.
//
//  4. El correo lo compone el servidor con su logo y su firma. Si aceptara
//     una URL del cliente, quien pueda invitar podría colar un enlace ajeno
//     dentro de un correo con marca de la plataforma. Va el TOKEN, y la
//     dirección la monta el servidor.
//
//  🔑 SE EJECUTA EL CÓDIGO REAL contra dobles, no se le pasa una regex por
//  encima: una regex no distingue «acuña una sola vez» de «cree que acuña una
//  sola vez», que es justo la trampa 2.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra) console.log('      → ' + extra); }
};

const UTILS = leer('js/core/utils.js');
const SEC   = leer('js/admin/superadmin/secretary.js');
const PREF  = leer('js/services/auth/invite-prefill.js');
const INDEX = leer('index.html');
const FUNCS = leer('functions/index.js');
const RULES = leer('firestore.rules');
const FINIT = leer('js/services/firebase-init.js');

console.log('\n══ v633 · La invitación, con token opaco ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🔒 Las reglas: el token es el secreto, pero NO se puede enumerar');
{
    const bloque = (RULES.match(/match \/invites\/\{token\}[\s\S]*?\n    \}/) || [''])[0];
    ok('1a · existe el bloque `invites/{token}`', bloque.length > 50);

    ok('1b · 🔑🔑 `get` y `list` van SEPARADOS, nunca un `read` de los dos',
       /allow get:/.test(bloque) && /allow list:/.test(bloque) &&
       !/allow read/.test(bloque),
       'un `allow read: if true` dejaría vaciar TODOS los correos invitados con un getDocs');

    ok('1c · 🔑 y `list` es sólo del SuperAdmin',
       /allow list: if isSuperAdmin\(\)/.test(bloque));

    ok('1d · el `get` NO exige sesión: el invitado aún no tiene cuenta',
       /allow get:/.test(bloque) && !/allow get: if isAuth\(\)/.test(bloque));

    ok('1e · ⚠️ pero el `get` sí exige que NO esté usada…',
       /allow get:[\s\S]*?usedAt', null\) == null/.test(bloque));

    ok('1f · …y que no haya caducado',
       /request\.time < resource\.data\.get\('expiresAt'/.test(bloque));

    // La caducidad tiene que FALLAR HACIA EL NO. Si el valor por defecto de
    // `expiresAt` fuera un futuro lejano, un documento sin ese campo sería
    // eterno. `request.time` como defecto hace que la comparación sea falsa.
    ok('1g · 🔑 sin `expiresAt`, el enlace NO vale (falla hacia el NO)',
       /get\('expiresAt', request\.time\)/.test(bloque),
       'el defecto es AHORA, así que `request.time < request.time` es falso');

    ok('1h · sólo se puede marcar como usada UNA vez, y por quien la usa',
       /allow update:[\s\S]*?usedAt', null\) == null/.test(bloque) &&
       /hasOnly\(\['usedAt', 'usedBy'\]\)/.test(bloque) &&
       /usedBy', null\) == request\.auth\.uid/.test(bloque),
       'sin el hasOnly, el invitado podría reescribirse el rol antes de usarla');

    ok('1i · crear una invitación exige sesión y firmarla con el propio uid',
       /allow create:[\s\S]*?createdBy', null\) == request\.auth\.uid/.test(bloque));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🎲 El token: aleatorio de verdad, no una fecha disfrazada');
{
    // El cuerpo se recorta por índices: la función vive DENTRO de un
    // `if (typeof …)`, así que su cierre no está a columna 0 y una regex
    // «hasta \n};» no lo encuentra. Eso es lo que hacía fallar 2a-2e.
    const _ini = UTILS.indexOf('window.cronosCrearInvitacion = async function');
    const _fin = UTILS.indexOf('window.cronosLeerInvitacion');
    const fn = _ini >= 0 ? UTILS.slice(_ini, _fin > _ini ? _fin : _ini + 4000) : '';

    ok('2a · el token sale de `crypto.getRandomValues`',
       /crypto\.getRandomValues/.test(fn),
       'Math.random() o Date.now() serían adivinables: es LO ÚNICO que protege la invitación');

    ok('2b · 🔑 128 bits (16 bytes → 32 hex)',
       /new Uint8Array\(16\)/.test(fn) && /padStart\(2, '0'\)/.test(fn));

    ok('2c · `expiresAt` es un Timestamp de verdad, no una cadena',
       /Timestamp\.fromMillis/.test(fn),
       'la regla lo compara con request.time; una cadena haría fallar la comparación SIEMPRE');

    ok('2d · nace sin usar', /usedAt: null/.test(fn) && /usedBy: null/.test(fn));

    ok('2e · el enlace es `?invite=<token>` y no lleva ni correo ni rol ni club',
       /'\/\?invite=' \+ token/.test(fn) &&
       !/inviteParams|'&email='/.test(fn));

    // ── EJECUTADO: el token de dos llamadas no puede repetirse ──
    const sb = {
        console: { log() {}, warn() {} },
        crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } },
        Date, Math, String, Number, Array, Object, JSON, RegExp, Promise,
        URLSearchParams, Uint8Array, setTimeout,
    };
    sb.window = sb;
    vm.createContext(sb);
    // Sólo el trozo que define las tres funciones de invitación.
    const desde = UTILS.indexOf('if (typeof window.cronosCrearInvitacion');
    vm.runInContext('window.CRONOS_APP_URL = "https://x";\n' + UTILS.slice(desde), sb);

    const escrituras = [];
    sb.window._cronos_auth = {
        db: {}, auth: { currentUser: { uid: 'uid_prueba' } },
    };
    // El `import()` dinámico del SDK se sustituye por un doble.
    const modulo = {
        doc: (db, col, id) => ({ col, id }),
        setDoc: async (ref, datos) => { escrituras.push({ ref, datos }); },
        getDoc: async () => ({ exists: () => false }),
        updateDoc: async () => {},
        Timestamp: { fromMillis: (ms) => ({ _ts: ms }) },
    };
    // Se intercepta el import() reescribiendo la función con el doble dentro.
    const fuenteParcheada = UTILS.slice(desde).replace(
        /await import\('https:\/\/www\.gstatic\.com[^']*'\)/g, '__mod');
    const sb2 = Object.assign({}, sb);
    sb2.window = sb2; sb2.__mod = modulo;
    sb2.window._cronos_auth = sb.window._cronos_auth;
    sb2.window.CRONOS_APP_URL = 'https://x';
    delete sb2.window.cronosCrearInvitacion;
    delete sb2.window.cronosLeerInvitacion;
    delete sb2.window.cronosConsumirInvitacion;
    vm.createContext(sb2);
    vm.runInContext(fuenteParcheada, sb2);

    (async () => {
        const a = await sb2.window.cronosCrearInvitacion({ email: 'x@y.z', role: 'user', clubName: 'C' });
        const b = await sb2.window.cronosCrearInvitacion({ email: 'x@y.z', role: 'user', clubName: 'C' });
        ok('2f · 🔑 EJECUTADO: dos invitaciones seguidas dan tokens DISTINTOS',
           a.token !== b.token, a.token + ' vs ' + b.token);
        ok('2g · EJECUTADO: el token es hex de 32 caracteres',
           /^[0-9a-f]{32}$/.test(a.token), a.token);
        ok('2h · EJECUTADO: la URL no contiene el correo por ninguna parte',
           a.url.indexOf('x@y.z') < 0 && a.url.indexOf('%40') < 0, a.url);
        // 🔑 La URL no lleva los datos, pero ALGUIEN tiene que llevarlos: el
        // documento. Si esto no se comprobara, un enlace opaco que no resuelve
        // a nada pasaría todas las demás pruebas.
        const doc1 = escrituras[0] || { ref: {}, datos: {} };
        ok('2i · EJECUTADO: se escribe en `invites`, con el token como id',
           doc1.ref.col === 'invites' && doc1.ref.id === a.token,
           JSON.stringify(doc1.ref));
        ok('2j · EJECUTADO: y el documento sí lleva correo, rol y club',
           doc1.datos.email === 'x@y.z' && doc1.datos.role === 'user' &&
           doc1.datos.clubName === 'C' && doc1.datos.createdBy === 'uid_prueba',
           JSON.stringify(doc1.datos));
        ok('2k · EJECUTADO: con caducidad en el futuro',
           doc1.datos.expiresAt && doc1.datos.expiresAt._ts > Date.now(),
           JSON.stringify(doc1.datos.expiresAt));

        // ── El lector nunca lanza ──
        const nulo = await sb2.window.cronosLeerInvitacion('no_existe_123456');
        ok('2l · leer un token inexistente devuelve null, NO lanza', nulo === null);
        const feo = await sb2.window.cronosLeerInvitacion('../../users/admin');
        ok('2m · 🔑 un token con forma de ruta se rechaza antes de tocar la red',
           feo === null, 'si no, iría a parar a otro documento');

        rematar();
    })();
}

// ════════════════════════════════════════════════════════════════════
function rematar() {
console.log('\n3) ⌨️ Acuñar NO puede pasar al teclear');
{
    ok('3a · 🔑🔑 `_secDatosActuales` ya NO fabrica el enlace',
       !/function _secDatosActuales\(\)[\s\S]*?cronosInviteUrl\(/.test(SEC),
       'corre en cada pulsación: crearía cientos de invitaciones vivas por envío');

    ok('3b · sólo devuelve lo que haya en la caché',
       /const enlace = \(cache && cache\.clave === clave && cache\.url\)/.test(SEC));

    ok('3c · y si no hay nada, un aviso, NO una URL a medias',
       /SEC_ENLACE_PENDIENTE = '\(se genera al copiar o al enviar\)'/.test(SEC),
       'una URL incompleta se copiaría y llegaría rota');

    ok('3d · quien acuña es `_secEnlaceReal`, y reutiliza por email|rol|club',
       /async function _secEnlaceReal\(\)/.test(SEC) &&
       /const clave   = email \+ '\|' \+ roleVal \+ '\|' \+ club/.test(SEC));

    // ── EJECUTADO: la caché de verdad ──
    const llamadas = [];
    const sb = {
        console: { log() {}, warn() {} },
        document: {
            getElementById: (id) => sb.__campos[id] || null,
            querySelector: () => null,
        },
        __campos: {
            'sec-email': { value: 'a@b.c' },
            'sec-role':  { value: 'user' },
            'sec-club':  { value: 'CD Prueba' },
        },
        Date, Math, String, Number, Array, Object, JSON, RegExp, Promise, setTimeout,
        URLSearchParams, encodeURIComponent,
    };
    sb.window = sb;
    vm.createContext(sb);
    const trozo = SEC.slice(SEC.indexOf('const SEC_ENLACE_PENDIENTE'),
                            SEC.indexOf('// ── Plantillas de fábrica'));
    vm.runInContext(trozo, sb);
    sb.window.cronosCrearInvitacion = async (d) => {
        llamadas.push(d);
        return { token: 't' + llamadas.length, url: 'https://x/?invite=t' + llamadas.length };
    };
    sb._saToast = () => {};

    (async () => {
        const u1 = await sb.window._secEnlaceReal();
        const u2 = await sb.window._secEnlaceReal();
        ok('3e · 🔑 EJECUTADO: dos llamadas con el MISMO formulario → UNA sola invitación',
           llamadas.length === 1, 'se acuñaron ' + llamadas.length);
        ok('3f · EJECUTADO: y devuelve el mismo enlace', u1 === u2);

        sb.__campos['sec-email'].value = 'otro@b.c';
        const u3 = await sb.window._secEnlaceReal();
        ok('3g · 🔑 EJECUTADO: al cambiar el destinatario, invitación NUEVA',
           llamadas.length === 2 && u3 !== u1,
           'reutilizarla dejaría entrar a esa persona con la invitación de otra');

        // La vista previa, con la caché puesta, ve el enlace bueno.
        const datos = vm.runInContext('_secDatosActuales()', sb);
        ok('3h · EJECUTADO: con el token ya acuñado, la vista previa lo enseña',
           datos.enlace === u3, datos.enlace);

        sb.window._secTokenActual = null;
        const datos2 = vm.runInContext('_secDatosActuales()', sb);
        ok('3i · EJECUTADO: sin token, la vista previa NO inventa una URL',
           datos2.enlace === sb.window.SEC_ENLACE_PENDIENTE, datos2.enlace);

        parteFinal();
    })();
}
}

// ════════════════════════════════════════════════════════════════════
function parteFinal() {
console.log('\n4) 📤 Los tres caminos de salida acuñan');
{
    ok('4a · Copiar acuña antes de copiar',
       /saCopiarEnlace = async function[\s\S]*?await _secEnlaceReal\(\)/.test(SEC));

    ok('4b · el correo acuña antes de componer el cuerpo',
       /saSendInviteEmail = async function[\s\S]*?await _secEnlaceReal\(\)[\s\S]*?const datos   = _secDatosActuales\(\)/.test(SEC),
       'si no, el cuerpo saldría con el aviso de "pendiente" dentro');

    ok('4c · 🔑 WhatsApp también, que allí el enlace es el ÚNICO camino',
       /saSendInviteWhatsApp = async function[\s\S]*?await _secEnlaceReal\(\)/.test(SEC),
       'en WhatsApp no hay botón ni frase de respaldo como en el correo');

    ok('4d · ⚠️ y el enrutador lo ESPERA, ahora que es async',
       /await window\.saSendInviteWhatsApp\(\)/.test(SEC),
       'sin el await, el formulario se limpiaría antes de abrir WhatsApp');

    ok('4e · 🔑 al limpiar el formulario se SUELTA el token usado',
       /_limpiarFormularioSecretaria[\s\S]*?window\._secTokenActual = null/.test(SEC),
       'si no, la siguiente invitación reutilizaría la anterior');

    ok('4f · si no se puede acuñar, se cae al enlace clásico PERO SE AVISA',
       /No se pudo generar el enlace seguro/.test(SEC),
       'degradar en silencio devolvería el correo a la URL sin decirlo');
}

console.log('\n5) ✉️ El servidor compone la URL, no el cliente');
{
    ok('5a · 🔑🔑 la función recibe el TOKEN, nunca una URL',
       /data\.inviteToken/.test(FUNCS) && !/data\.inviteUrl/.test(FUNCS),
       'aceptar una URL dejaría colar un enlace ajeno en un correo con la marca de la plataforma');

    ok('5b · y valida su FORMA antes de meterlo en el href',
       /\/\^\[A-Za-z0-9_-\]\{8,64\}\$\/\.test\(tokenLimpio\)/.test(FUNCS));

    ok('5c · la dirección la monta con su propia constante APP_URL',
       /inviteUrl = APP_URL \+ '\/\?invite=' \+ encodeURIComponent\(tokenLimpio\)/.test(FUNCS));

    ok('5d · ⚠️ sin token sigue valiendo el enlace clásico (compatibilidad)',
       /inviteParams\.set\('register', 'true'\)/.test(FUNCS),
       'los enlaces ya enviados tienen que seguir funcionando');

    ok('5e · el cliente le pasa el token en la llamada',
       /sendEmail\(\{ to, subject, body, role, clubName, inviteToken \}\)/.test(SEC));
}

console.log('\n6) 🚪 El invitado aterriza en el ALTA, no en el login');
{
    ok('6a · 🔑🔑 el gate de la pestaña «Registrarse» ya mira `invite`',
       /if \(registerParam === 'true' \|\| urlParams\.has\('invite'\)\)/.test(INDEX),
       'ÉSTE era el que se quedaba corto: `isInviteLink` ya contaba invite, este no');

    ok('6b · el resolutor lee `?invite=` y resuelve el token',
       /var token = p\.get\('invite'\)/.test(PREF) &&
       /await window\.cronosLeerInvitacion\(token\)/.test(PREF));

    ok('6c · ⚠️ y las DOS formas conviven: manda el token si vienen las dos',
       /email = inv\.email \|\| email/.test(PREF),
       'los enlaces ya enviados con ?register=true&email= tienen que seguir valiendo');

    ok('6d · 🔑 un token muerto NO bloquea el alta: avisa y deja el form a mano',
       /ya no es válido[\s\S]*?Puedes registrarte igualmente/.test(PREF),
       'una pantalla que no explica nada sería peor que rellenarlo a mano');

    ok('6e · se recuerda para consumirlo cuando haya sesión',
       /window\._cronosInviteToken = inv\.token/.test(PREF));
}

console.log('\n7) ♻️ Consumir: un solo sitio, y que no pueda tumbar el alta');
{
    ok('7a · 🔑 se engancha al ESTADO DE SESIÓN, no a cada rama del alta',
       /fa\.onAuthStateChanged\(fa\.auth, function/.test(PREF),
       'auth.js escribe el doc de usuario en 5 ramas y varias salen con return');

    ok('7b · 🔴 y `onAuthStateChanged` está EXPUESTO en _cronos_auth',
       /onAuthStateChanged\n    \};/.test(FINIT),
       'sin esto el vigilante reintenta 60 veces y se rinde EN SILENCIO');

    ok('7c · se consume una sola vez', /_yaConsumida = true/.test(PREF));

    ok('7d · ⚠️ a fuego y olvido: nunca lanza',
       /window\.cronosConsumirInvitacion = async function[\s\S]*?catch \(e\)[\s\S]*?return false;/.test(UTILS),
       'un fallo aquí no puede tumbar un alta que ya se completó');
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
}

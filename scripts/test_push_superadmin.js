// ─────────────────────────────────────────────────────────────────────────
//  test_push_superadmin.js  ·  v644
//
//  Los avisos push del SuperAdmin: alta del dispositivo (cliente), recepcion
//  con la app cerrada (service worker) y envio (Cloud Functions).
//
//  🚨 POR QUE ESTE GUARD EJECUTA EL SERVICE WORKER EN VEZ DE MIRARLO
//
//  Un aviso que no llega NO PRODUCE NINGUN ERROR EN NINGUNA PARTE. No hay
//  pantalla en rojo, no hay 500, no hay consola: simplemente el telefono no
//  suena, y eso es indistinguible de "no ha entrado ninguna solicitud". Es la
//  misma clase de fallo mudo que dejo el backend caido 7 h en la v633 con el
//  deploy diciendo "Successful", y la razon por la que aqui no vale un
//  aprobado por regex.
//
//  Ademas la v641 dejo escrito lo que pasa cuando el guard solo mira nombres:
//  16 aserciones verdes sobre una funcion muerta, porque el defecto estaba en
//  el ARGUMENTO de la llamada y ninguna regex mira argumentos. Aqui hay DOS
//  argumentos que, si se pierden, rompen cosas grandes en silencio:
//    · `serviceWorkerRegistration` en getToken()  → el SDK registraria su
//      service worker en la RAIZ y DESALOJARIA a sw.js: la app entera se
//      quedaria sin caches ni modo sin cobertura.
//    · el `scope` del register()                  → lo mismo.
//  Los dos tienen asercion propia.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const L = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SW      = L('firebase-messaging-sw.js');
const CLI     = L('js/services/push-superadmin.js');
const FN      = L('functions/index.js');
const REGLAS  = L('firestore.rules');
const INDEX   = L('index.html');
const FBJSON  = L('firebase.json');
const REQTAB  = L('js/admin/superadmin/requests-tab.js');
const PANEL   = L('js/admin/superadmin/superadmin.panel.js');
const CLUBS   = L('js/admin/superadmin/clubs-tab.js');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 400)); }
};

console.log('\n══ v644 · avisos push al SuperAdmin ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🔴 EL SERVICE WORKER, EJECUTADO DE VERDAD');
//  Se monta un ServiceWorkerGlobalScope de mentira, se carga el fichero real
//  y se le dispara un `push` con el payload EXACTO que produce FCM para un
//  mensaje solo de datos: `{ data: {...}, from, fcmMessageId }`.
{
    function arrancarSW() {
        const estado = {
            handlers: {}, notificaciones: [], insignias: [],
            mensajesAClientes: [], ventanasAbiertas: [],
        };
        const clienteFalso = {
            url: 'https://cronos-futbol-app.web.app/index.html',
            focus: async () => { estado.enfocado = true; },
            postMessage: (m) => estado.mensajesAClientes.push(m),
        };
        const self_ = {
            addEventListener: (t, h) => { estado.handlers[t] = h; },
            location: { origin: 'https://cronos-futbol-app.web.app' },
            skipWaiting: () => {},
            navigator: {
                setAppBadge:   (n) => estado.insignias.push(n),
                clearAppBadge: ()  => estado.insignias.push(0),
            },
            registration: {
                showNotification: async (t, o) => { estado.notificaciones.push({ titulo: t, op: o }); },
            },
            clients: {
                claim: async () => {},
                matchAll: async () => [clienteFalso],
                openWindow: async (u) => { estado.ventanasAbiertas.push(u); },
            },
        };
        const ctx = vm.createContext({ self: self_, console, Number, Date, Promise });
        vm.runInContext(SW, ctx, { filename: 'firebase-messaging-sw.js' });
        estado.self = self_;
        return estado;
    }

    //  ⚠️ EL ARNES ATRAPA LO QUE LANCE EL HANDLER, y no por comodidad: un
    //  `push` que revienta SINCRONAMENTE tumbaria este proceso con una traza
    //  de Node en vez de con una asercion roja con nombre. Salir en rojo no
    //  basta — hay que salir en rojo DICIENDO QUE FALLA, que es lo que se lee
    //  cuando la suite se pone en rojo dentro de seis meses. (Se descubrio
    //  haciendo el red-check de este mismo guard.)
    function disparar(e, tipo, evento) {
        let esperado = null, exploto = '';
        evento.waitUntil = (p) => { esperado = p; };
        try { e.handlers[tipo](evento); }
        catch (err) { exploto = (err && err.message) || String(err); }
        ok('   · el handler `' + tipo + '` no lanza de forma sincrona', !exploto, exploto);
        return esperado;
    }

    // ── 1a · el payload REAL de FCM (solo datos) ──────────────────────
    {
        const e = arrancarSW();
        ok('1a · el fichero se evalua como service worker (sin dependencias externas)',
           typeof e.handlers.push === 'function' &&
           typeof e.handlers.notificationclick === 'function',
           'handlers registrados: ' + Object.keys(e.handlers).join(', '));

        const cargaFCM = {
            data: {
                tipo: 'sa_pendiente', titulo: '📋 Nueva solicitud',
                cuerpo: 'Ana · coach · CD Ejemplo', insignia: '7',
                url: '/index.html?sa=requests', motivo: 'users/abc', ts: '1',
            },
            from: '393110572633', fcmMessageId: 'x',
        };
        const esperado = disparar(e, 'push', { data: { json: () => cargaFCM } });
        return_1a(e, esperado);
    }

    function return_1a(e, esperado) {
        ok('1b · `push` usa waitUntil (sin el, el navegador mata el handler antes de mostrar nada)',
           !!esperado && typeof esperado.then === 'function');
        if (!esperado) return;
        esperado.then(() => {
            ok('1c · 🔑 se MOSTRO la notificacion, con el titulo y el cuerpo del envio',
               e.notificaciones.length === 1 &&
               e.notificaciones[0].titulo === '📋 Nueva solicitud' &&
               e.notificaciones[0].op.body === 'Ana · coach · CD Ejemplo',
               JSON.stringify(e.notificaciones));

            const op = (e.notificaciones[0] || {}).op || {};
            ok('1d · 🔊 el aviso SUENA: silent:false + renotify (reusar el tag sin renotify actualiza EN SILENCIO)',
               op.silent === false && op.renotify === true && !!op.tag,
               'silent=' + op.silent + ' renotify=' + op.renotify + ' tag=' + op.tag);

            ok('1e · 🔢 y puso la INSIGNIA con el numero que mando el servidor',
               e.insignias.length === 1 && Number(e.insignias[0]) === 7,
               JSON.stringify(e.insignias));

            ok('1f · avisa a la pestana abierta para que suene el aviso de la app',
               e.mensajesAClientes.length === 1 &&
               e.mensajesAClientes[0].fuente === 'chronos-push',
               JSON.stringify(e.mensajesAClientes));
        }).catch(err => { fail++; console.log('  ✗ 1c-1f · el handler de push lanzo: ' + err.message); });
    }

    // ── 1g · ⚠️ EL CASO QUE RETIRA EL PERMISO EN iOS ──────────────────
    //  Un `push` con payload ilegible (o vacio) TIENE que acabar mostrando
    //  algo igualmente. Si el handler sale sin notificacion, Chrome pinta
    //  "Este sitio se ha actualizado en segundo plano" y iOS puede RETIRAR
    //  el permiso — y entonces se pierden todos los avisos, no solo ese.
    {
        const e = arrancarSW();
        const esperado = disparar(e, 'push', {
            data: { json: () => { throw new Error('no es JSON'); }, text: () => 'ruido' },
        });
        if (esperado) {
            esperado.then(() => {
                ok('1g · 🔑🔑 un payload ILEGIBLE tambien acaba en showNotification (iOS retira el permiso si no)',
                   e.notificaciones.length === 1, JSON.stringify(e.notificaciones));
            }).catch(err => { fail++; console.log('  ✗ 1g · lanzo: ' + err.message); });
        } else { ok('1g · un payload ilegible acaba en showNotification', false, 'no hubo waitUntil'); }
    }

    // ── 1h · sin `data` ninguno ────────────────────────────────────────
    {
        const e = arrancarSW();
        const esperado = disparar(e, 'push', { data: null });
        if (esperado) {
            esperado.then(() => {
                ok('1h · …y un push SIN datos, igual (aviso por defecto, nunca mudo)',
                   e.notificaciones.length === 1);
            }).catch(() => {});
        }
    }

    // ── 1i · la pulsacion reutiliza la pestana, no abre otra ───────────
    {
        const e = arrancarSW();
        const esperado = disparar(e, 'notificationclick', {
            action: '', notification: { close: () => {}, data: { url: '/index.html?sa=requests' } },
        });
        if (esperado) {
            esperado.then(() => {
                ok('1i · pulsar el aviso ENFOCA la pestana abierta en vez de abrir otra (v638: una sesion por pestana)',
                   e.enfocado === true && e.ventanasAbiertas.length === 0,
                   'enfocado=' + e.enfocado + ' abiertas=' + JSON.stringify(e.ventanasAbiertas));
            }).catch(() => {});
        }
    }
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔑🔑 LOS DOS ARGUMENTOS QUE, SI SE PIERDEN, DESALOJAN A sw.js');
{
    //  Este es EL riesgo del cambio. FCM, por defecto, registra
    //  `/firebase-messaging-sw.js` con ambito `/` — el mismo que ocupa sw.js.
    //  Dos service workers no pueden gobernar el mismo ambito: el nuevo
    //  DESALOJA al viejo, y la app entera se queda sin precarga, sin caches
    //  y sin modo sin cobertura. Para TODOS los usuarios, no solo para el SA.
    //
    //  Se comprueba el ARGUMENTO, no el nombre de la funcion: ese es
    //  exactamente el punto ciego que dejo 16 aserciones en verde en la v641.

    const mReg = CLI.match(/serviceWorker\.register\(\s*([A-Za-z_$][\w$]*|'[^']*')\s*,\s*\{\s*scope:\s*([A-Za-z_$][\w$]*|'[^']*')/);
    ok('2a · el register() pasa un `scope` EXPLICITO', !!mReg, mReg || 'no se encontro la llamada');

    let ambito = null;
    if (mReg) {
        const tok = mReg[2];
        ambito = tok.startsWith("'") ? tok.slice(1, -1)
               : (CLI.match(new RegExp('const\\s+' + tok + '\\s*=\\s*\'([^\']*)\'')) || [])[1];
    }
    ok('2b · 🔑🔑 y ese ambito NO es la raiz (si lo fuera, sw.js quedaria desalojado)',
       !!ambito && ambito !== '/' && ambito !== './' && ambito !== '',
       'ambito resuelto: ' + JSON.stringify(ambito));

    const mTok = CLI.match(/getToken\(\s*messaging\s*,\s*\{([\s\S]*?)\}\s*\)/);
    ok('2c · 🔑🔑 getToken recibe `serviceWorkerRegistration` (sin el, el SDK registra el SUYO en la raiz)',
       !!mTok && /serviceWorkerRegistration\s*:/.test(mTok[1]),
       mTok ? mTok[1].replace(/\s+/g, ' ').slice(0, 200) : 'no se encontro getToken');

    ok('2d · …y tambien la clave vapid, en la MISMA llamada',
       !!mTok && /vapidKey\s*:/.test(mTok[1]));

    ok('2e · el ambito de push no aparece en el precache de sw.js (no es una pagina)',
       !/cronos-push/.test(L('sw.js')));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 📨 EL ENVIO: solo datos, y autorizado por el SERVIDOR');
{
    const bloque = FN.slice(FN.indexOf('async function _avisarSuperAdmin'),
                            FN.indexOf('function _rotuloSolicitud'));

    ok('3a · 🔑 el mensaje lleva `data:` y NO `notification:` (con notification el SW pierde el control del aviso)',
       /\bdata:\s*\{/.test(bloque) && !/\bnotification:\s*\{/.test(bloque),
       bloque.slice(0, 0) || 'hay un bloque notification en el mensaje');

    ok('3b · todos los valores de `data` son cadenas (FCM rechaza el envio ENTERO si cuela un numero)',
       /insignia:\s*String\(/.test(bloque) && /ts:\s*String\(/.test(bloque));

    ok('3c · Urgency alta: es lo que fuerza la entrega con el movil en ahorro de energia',
       /Urgency:\s*'high'/.test(bloque));

    ok('3d · se usa sendEachForMulticast (envio a varios dispositivos con resultado por token)',
       /sendEachForMulticast\(/.test(bloque));

    ok('3e · ⚠️ los tokens muertos SE BORRAN (registration-token-not-registered)',
       /registration-token-not-registered/.test(bloque) && /lote\.delete\(/.test(bloque));

    ok('3f · 🔑🔑 quien recibe se decide contra cronos_config/superadmins, NO contra el `role` del documento',
       /_tokensDelSuperAdmin/.test(FN) &&
       /cronos_config\/superadmins/.test(FN.slice(FN.indexOf('async function _tokensDelSuperAdmin'),
                                                  FN.indexOf('async function _avisarSuperAdmin'))),
       'el `role` del documento lo escribe el cliente: no puede autorizar nada');

    const bloqueTok = FN.slice(FN.indexOf('async function _tokensDelSuperAdmin'),
                               FN.indexOf('async function _avisarSuperAdmin'));
    ok('3g · …y FALLA HACIA EL "NADIE" si no puede leer esa lista',
       /return \[\];/.test(bloqueTok) && /correos\.length/.test(bloqueTok),
       'un error de lectura no puede convertirse en un envio a ciegas');

    ok('3h · el envio NUNCA lanza: un aviso que falla no puede tumbar el disparador',
       /catch \(e\) \{[\s\S]*?console\.error\('\[pushSA\] el aviso no salio/.test(bloque));

    ok('3i · `admin.messaging` esta en el adaptador de firebase-admin 14 (v633)',
       /if \(typeof admin\.messaging !== 'function'\)/.test(FN) &&
       /require\('firebase-admin\/messaging'\)/.test(FN));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) ⚠️ LOS DISPARADORES MIRAN LA **TRANSICION**, no el estado');
{
    //  Un onWrite salta con CADA escritura. Sin comprobar que ANTES no estaba
    //  pendiente, editar o aprobar una solicitud ya pendiente volveria a hacer
    //  sonar el telefono. Mismo criterio que la regla de v546.
    const disparadores = [
        ['notifySuperAdminNewRequest',  '_esPRPendienteSA'],
        ['notifySuperAdminPendingUser', '_esUsuarioPendienteSA'],
        ['notifySuperAdminSuccession',  '_esSucesionPendienteSA'],
    ];
    for (const [nombre, pred] of disparadores) {
        const i = FN.indexOf('exports.' + nombre);
        const cuerpo = i >= 0 ? FN.slice(i, i + 1400) : '';
        ok('4·' + nombre + ' · existe y es un onWrite', i >= 0 && /\.onWrite\(/.test(cuerpo));
        ok('4·' + nombre + ' · 🔑 exige `antes NO pendiente` Y `ahora SI pendiente`',
           new RegExp('if \\(' + pred + '\\(antes\\) \\|\\| !' + pred + '\\(ahora\\)\\) return null;').test(cuerpo),
           cuerpo.split('\n').filter(l => l.includes(pred)).join(' | '));
    }
}

// ════════════════════════════════════════════════════════════════════
console.log('\n5) 🚨 EL PREDICADO DE "PENDIENTE" ESTA DUPLICADO — que no divergen');
{
    //  El cliente (requests-tab.js) y el servidor (functions/index.js) deciden
    //  por separado que esta pendiente. No se pueden compartir: uno corre en el
    //  navegador y el otro en Node.
    //
    //  🚨 Y ESA DUPLICIDAD ES LO QUE ROMPIO EL BADGE EN LA v532: badge 7, lista
    //  4, dos implementaciones que se separaron. Aqui se comprueba que el
    //  servidor conoce TODOS los estados que el cliente cuenta.
    const estadosCliente = new Set();
    const re = /where\('status','==','([a-z_]+)'\)/g;
    let m; while ((m = re.exec(REQTAB))) estadosCliente.add(m[1]);

    ok('5a · se han encontrado los estados que cuenta el cliente',
       estadosCliente.size >= 3, [...estadosCliente].join(', '));

    const predicados = FN.slice(FN.indexOf('function _esPRPendienteSA'),
                                FN.indexOf('async function _contarPendientesSA'));
    const faltan = [...estadosCliente].filter(s => !predicados.includes("'" + s + "'"));
    ok('5b · 🔑🔑 el servidor conoce TODOS los estados del cliente',
       faltan.length === 0,
       'el servidor no sabe de: ' + faltan.join(', ') +
       ' — el aviso no saltaria para esas solicitudes y la insignia mentiria');

    ok('5c · el matiz de `pending_individual` esta en los DOS (ese estado lo comparten flujos que no son solicitudes)',
       /individualEntityId/.test(REQTAB) && /individualEntityId/.test(predicados));

    ok('5d · la cuenta del servidor DEDUPLICA igual que el panel (una solicitud representa a su usuario)',
       /representados/.test(FN.slice(FN.indexOf('async function _contarPendientesSA'),
                                     FN.indexOf('async function _tokensDelSuperAdmin'))),
       'sin dedup, la insignia daria un numero MAYOR que la lista — el fallo de v532 desde el servidor');

    ok('5e · quota_increase/unread tambien cuenta en el servidor',
       /quota_increase/.test(predicados) && /'unread'/.test(predicados));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n6) 🔒 LAS REGLAS: nadie escribe un token a nombre de otro, y nadie los lee');
{
    const i = REGLAS.indexOf('match /push_tokens/{tokenId}');
    const b = i >= 0 ? REGLAS.slice(i, REGLAS.indexOf('}', REGLAS.indexOf('allow delete', i))) : '';
    ok('6a · existe el bloque de push_tokens', i >= 0);
    ok('6b · 🔑 NADIE lee la coleccion (ni el SA: el Admin SDK no pasa por las reglas)',
       /allow read:\s*if false;/.test(b), b.slice(0, 200));
    ok('6c · 🔑🔑 el `uid` del documento tiene que ser el DEL QUE ESCRIBE (v636: no se fabrica a nombre de otro)',
       /request\.resource\.data\.get\('uid', ''\) == request\.auth\.uid/.test(b), b.slice(0, 400));
    ok('6d · y el id del documento tiene que ser el token (dedupe, y borrado exacto desde el servidor)',
       /request\.resource\.data\.get\('token', ''\) == tokenId/.test(b));
    ok('6e · uno puede borrar el SUYO (darse de baja sin esperar a que caduque)',
       /allow delete:\s*if isAuth\(\) && resource\.data\.get\('uid', ''\) == request\.auth\.uid;/.test(b));
    ok('6f · el bloque va ANTES del catch-all `allow read, write: if false`',
       i >= 0 && i < REGLAS.indexOf('match /{document=**}'));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n7) 🔌 ENCHUFADO: script, cabeceras y llamada desde el panel');
{
    ok('7a · index.html carga js/services/push-superadmin.js',
       /<script src="js\/services\/push-superadmin\.js\?v=/.test(INDEX));

    const fb = JSON.parse(FBJSON);
    const cab = (fb.hosting.headers || []).find(h => h.source === '/firebase-messaging-sw.js');
    ok('7b · 🔑 firebase-messaging-sw.js se sirve SIN CACHEAR',
       !!cab && cab.headers.some(h => h.key === 'Cache-Control' && /no-store/.test(h.value)),
       'un service worker cacheado no lo desaloja ningun despliegue, y no lleva ?v= que lo salve');

    ok('7c · …y no esta en la lista de `ignore` del hosting (si no, no se subiria)',
       !(fb.hosting.ignore || []).some(p => p === 'firebase-messaging-sw.js' || p === '*.js'));

    ok('7d · el panel del SuperAdmin arranca los avisos al abrirse',
       /cronosPushArrancar/.test(PANEL));

    ok('7e · ⚠️ y lo hace SIN await: el panel no puede quedarse esperando al alta',
       !/await\s+window\.cronosPushArrancar/.test(PANEL),
       'un panel que no abre deja la plataforma sin nadie que apruebe altas');

    ok('7f · 🔢 la insignia BAJA tambien cuando el SA despacha (oyente de solicitudes)',
       /cronosPushInsignia\(count\)/.test(CLUBS),
       'sin esto la insignia solo sabria subir, y un contador que no baja deja de mirarse');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n8) 🧯 EL CLIENTE: permiso con gesto, clave visible y texto de terceros');
{
    ok('8a · 🔑 el permiso solo se pide con `pedirPermiso` (Safari/iOS lo descartan fuera de un clic)',
       /if \(!pedirPermiso\) return \{ ok: false, motivo: 'permiso-sin-pedir' \};/.test(CLI));

    ok('8b · el arranque automatico NO pide permiso (pasa false)',
       /cronosPushActivar\(false\)/.test(CLI) && /cronosPushActivar\(true\)/.test(CLI));

    ok('8c · 🔑 la falta de clave VAPID se DICE (el fallo es mudo por naturaleza)',
       /sin-clave-vapid/.test(CLI) && /claveVapid/.test(CLI),
       'nadie echa de menos una notificacion que no llega');

    ok('8d · la clave se puede poner sin desplegar (cronos_config/push.vapidKey)',
       /'cronos_config', 'push'/.test(CLI) && /vapidKey/.test(CLI));

    ok('8e · 🔒 el cuerpo del aviso se pinta con textContent, NUNCA innerHTML (lo escribe un tercero)',
       /p\.textContent = cuerpo/.test(CLI) && !/aviso[\s\S]{0,400}innerHTML/.test(CLI));

    ok('8f · cronosPushActivar nunca lanza: devuelve { ok, motivo }',
       /return \{ ok: false, motivo: 'error', detalle:/.test(CLI));

    ok('8g · la insignia va entre try/catch en las DOS puntas (existe y lanza en algunos navegadores)',
       (CLI.match(/catch \(_\) \{ \/\* la insignia/g) || []).length >= 1 &&
       /catch \(_\) \{ \/\* la insignia es un extra/.test(SW));
}

// ── El sumario se imprime cuando las promesas de la parte 1 han corrido ──
setTimeout(() => {
    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
    process.exit(fail ? 1 : 0);
}, 50);

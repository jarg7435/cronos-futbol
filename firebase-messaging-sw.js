// ─────────────────────────────────────────────────────────────────────────
//  CHRONOS FUTBOL · SERVICE WORKER DE AVISOS PUSH  (v644)
//
//  Recibe el aviso de solicitud pendiente del SuperAdmin cuando la app esta
//  cerrada o en segundo plano: lo muestra, lo hace sonar y pone el numero en
//  la insignia del icono.
//
//  ══════════════════════════════════════════════════════════════════════
//  🔑 POR QUE ES UN FICHERO APARTE Y NO VA DENTRO DE sw.js
//  ══════════════════════════════════════════════════════════════════════
//  sw.js es el service worker de la aplicacion entera: precarga, caches,
//  respuesta garantizada sin cobertura. Mete la mano ahi y lo que se rompe
//  es el arranque de TODOS los usuarios — y su `cache.addAll` es ATOMICO
//  (v452), asi que un fallo dentro se lleva la precarga completa.
//
//  El aviso push lo usa UNA persona. Meterlo en sw.js habria puesto el
//  arranque de todo el mundo a merced de una funcion para el SuperAdmin.
//  Aqui, lo peor que puede pasar es que el SuperAdmin no reciba un aviso.
//
//  ⚠️ POR ESO SE REGISTRA CON AMBITO PROPIO (`/cronos-push/`, ver
//  js/services/push-superadmin.js). Dos service workers NO pueden gobernar
//  el mismo ambito: registrar este en `/` habria DESALOJADO a sw.js y
//  dejado la app sin caches ni modo sin cobertura. El ambito solo decide
//  que paginas controla un service worker — el `push` llega igual, porque
//  va a la suscripcion, no al ambito. Ninguna pagina vive bajo
//  `/cronos-push/`: este service worker no controla ninguna, y eso es
//  exactamente lo que se quiere.
//
//  ══════════════════════════════════════════════════════════════════════
//  🔑 Y POR QUE NO SE CARGA EL SDK DE FIREBASE AQUI DENTRO
//  ══════════════════════════════════════════════════════════════════════
//  Lo habitual es un `importScripts` de firebase-app-compat +
//  firebase-messaging-compat desde gstatic y usar `onBackgroundMessage`.
//  No se hace, por dos razones medidas:
//
//   1. `importScripts` que falla = INSTALACION que falla. El service worker
//      no llega a existir, y con el se pierden los avisos — por una CDN
//      caida, no por un fallo nuestro. Este proyecto ya decidio alojar
//      pdf.js en vez de servirlo de CDN (v543) por la misma razon.
//   2. Un aviso de FCM que solo lleva `data` ES un mensaje Web Push
//      estandar: `event.data.json()` lo entrega entero. El SDK no aporta
//      nada que aqui haga falta, y sin el este fichero no depende de nada
//      externo ni de una version concreta.
//
//  ⚠️⚠️ LA CONTRAPARTIDA, QUE ES UNA OBLIGACION: un `push` recibido SIEMPRE
//  tiene que acabar en `showNotification`. Si un handler termina sin
//  mostrar nada, Chrome pinta una notificacion generica ("Este sitio se ha
//  actualizado en segundo plano") y iOS puede RETIRAR el permiso. Por eso
//  no hay ni una rama de `onpush` que salga sin mostrar aviso, ni siquiera
//  la de payload ilegible.
//
//  🔊 EL SONIDO. La web no deja adjuntar un sonido propio a una
//  notificacion en segundo plano: suena el del sistema operativo, y lo
//  unico que se puede hacer es NO pedir silencio (`silent: false`). Cuando
//  hay una pestana abierta se le avisa por `postMessage` para que ademas
//  toque el silbato de la casa; eso ya es cosa de push-superadmin.js.
// ─────────────────────────────────────────────────────────────────────────

'use strict';

const PUSH_SW_VERSION = 'v644';
const ETIQUETA        = 'chronos-sa-pendientes';
const ICONO           = '/public/assets/icons/chronos-192.svg';
const DESTINO         = '/index.html?sa=requests';

// El nuevo releva al viejo sin esperar: un aviso es inmediato por
// definicion, y no hay estado que migrar entre versiones.
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ── La insignia del icono ────────────────────────────────────────────────
// `setAppBadge` existe en el ambito del service worker (Chrome/Edge en
// escritorio y en PWA instalada de Android; Safari en app anyadida a la
// pantalla de inicio). Donde no existe, no pasa nada: el aviso se ve igual.
// ⚠️ Va SIEMPRE entre try/catch — en algunos navegadores existe y lanza.
function _ponerInsignia(n) {
    try {
        if (!self.navigator || typeof self.navigator.setAppBadge !== 'function') return;
        const num = Number(n);
        if (!Number.isFinite(num) || num <= 0) {
            if (typeof self.navigator.clearAppBadge === 'function') self.navigator.clearAppBadge();
            return;
        }
        self.navigator.setAppBadge(num);
    } catch (_) { /* la insignia es un extra: nunca puede tumbar el aviso */ }
}

// ── Normaliza el payload venga como venga ────────────────────────────────
// FCM entrega `{ data: {...}, from, fcmMessageId }` cuando el mensaje es
// solo de datos. Se admite tambien el objeto plano y un `notification`
// suelto, para que un cambio en el emisor no deje el aviso mudo.
function _leerPayload(event) {
    if (!event.data) return {};
    let crudo = null;
    try { crudo = event.data.json(); }
    catch (_) {
        try { return { cuerpo: event.data.text() }; } catch (__) { return {}; }
    }
    if (!crudo || typeof crudo !== 'object') return {};
    const d = crudo.data || {};
    const n = crudo.notification || {};
    return {
        titulo:   d.titulo   || n.title || crudo.titulo || '',
        cuerpo:   d.cuerpo   || n.body  || crudo.cuerpo || '',
        insignia: d.insignia !== undefined ? d.insignia : crudo.insignia,
        url:      d.url      || crudo.url || '',
        motivo:   d.motivo   || '',
        tipo:     d.tipo     || crudo.tipo || '',
    };
}

self.addEventListener('push', (event) => {
    const p = _leerPayload(event);

    const titulo = p.titulo || '📋 Chronos Fútbol';
    const cuerpo = p.cuerpo || 'Tienes una solicitud pendiente de aprobación.';
    const url    = p.url    || DESTINO;

    const opciones = {
        body: cuerpo,
        icon: ICONO,
        badge: ICONO,
        // 🔑 `tag` + `renotify`: los avisos de solicitudes se APILAN en uno
        //    solo (no se llena la bandeja con quince), pero `renotify` obliga
        //    a que el que sustituye vuelva a sonar y a vibrar. Sin renotify,
        //    reutilizar el tag actualiza el aviso EN SILENCIO — que es
        //    justamente lo contrario de lo que se pide aqui.
        tag: ETIQUETA,
        renotify: true,
        // 🔊 Nunca silencioso: es lo unico que el navegador nos deja decir
        //    sobre el sonido en segundo plano.
        silent: false,
        // Se queda en pantalla hasta que el SuperAdmin la toque: una
        // solicitud pendiente no es un aviso de los que se dejan pasar.
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 300],
        data: { url: url, motivo: p.motivo || '', ts: Date.now() },
        actions: [
            { action: 'abrir',   title: 'Ver solicitudes' },
            { action: 'luego',   title: 'Más tarde' },
        ],
    };

    event.waitUntil((async () => {
        _ponerInsignia(p.insignia);

        // Si hay alguna pestana abierta se le cuenta, para que suene el
        // silbato de la casa y pinte su propio aviso dentro de la app.
        // `includeUncontrolled` es imprescindible: este service worker no
        // controla ninguna pagina (vive en su propio ambito), asi que sin
        // el la lista vendria SIEMPRE vacia.
        try {
            const clientes = await self.clients.matchAll({
                type: 'window', includeUncontrolled: true,
            });
            clientes.forEach(c => c.postMessage({
                fuente: 'chronos-push',
                tipo: p.tipo || 'sa_pendiente',
                titulo: titulo,
                cuerpo: cuerpo,
                insignia: p.insignia,
                url: url,
            }));
        } catch (_) { /* no puede impedir que se muestre el aviso */ }

        // ⚠️ ESTA LINEA NO PUEDE QUEDAR DENTRO DE NINGUN `if`. Ver la
        //    cabecera: un push sin notificacion es un aviso generico del
        //    navegador y, en iOS, un permiso retirado.
        await self.registration.showNotification(titulo, opciones);
    })());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'luego') return;

    const destino = (event.notification.data && event.notification.data.url) || DESTINO;

    event.waitUntil((async () => {
        const clientes = await self.clients.matchAll({
            type: 'window', includeUncontrolled: true,
        });
        // Se REUTILIZA la pestana que ya este abierta en vez de abrir otra:
        // este proyecto arrastra una sesion por pestana (v638) y abrir una
        // segunda ventana obligaria a volver a entrar.
        for (const c of clientes) {
            if (c.url && c.url.indexOf(self.location.origin) === 0) {
                try {
                    c.postMessage({ fuente: 'chronos-push', tipo: 'abrir_solicitudes', url: destino });
                    if ('focus' in c) { await c.focus(); return; }
                } catch (_) { /* si no se puede enfocar, se abre una nueva */ }
            }
        }
        if (self.clients.openWindow) await self.clients.openWindow(destino);
    })());
});

// La pagina pone la insignia al dia a traves de aqui cuando el SuperAdmin
// despacha solicitudes: asi el numero BAJA, y no solo sube al recibir.
self.addEventListener('message', (event) => {
    const m = event.data || {};
    if (m.fuente !== 'chronos-push') return;
    if (m.tipo === 'insignia') _ponerInsignia(m.valor);
    if (m.tipo === 'version' && event.ports && event.ports[0]) {
        event.ports[0].postMessage({ version: PUSH_SW_VERSION });
    }
});

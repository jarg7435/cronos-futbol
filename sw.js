// ─────────────────────────────────────────────────────────────
//  CRONOS FUTBOL — Service Worker v114
//  Incrementa VERSION en cada deploy para forzar actualización.
// ─────────────────────────────────────────────────────────────
const VERSION    = 'v114';
const CACHE_NAME = 'cronos-cache-v114';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './app.js',
    './auth.js',
    './js/cronos_patches.js',
    './js/00_setup_modal.js',
    './js/16_superadmin.js',
    './js/17_club_admin.js',
];

self.addEventListener('install', event => {
    self.skipWaiting(); // Activar inmediatamente sin esperar a cerrar pestañas
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS).catch(err => {
                console.warn('[SW v114] Error al precargar recursos:', err);
            });
        })
    );
});

self.addEventListener('activate', event => {
    console.log('[SW v114] Activado - eliminando cachés antiguas');
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log('[SW v114] Borrando caché antigua:', key);
                        return caches.delete(key);
                    })
            );
        }).then(() => {
            console.log('[SW v114] Todas las cachés antiguas eliminadas ✅');
            return self.clients.claim(); // Tomar control de todas las pestañas abiertas
        })
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith('http')) return;
    // No cachear peticiones a Firebase/Google
    if (event.request.url.includes('googleapis.com') ||
        event.request.url.includes('firebaseio.com') ||
        event.request.url.includes('gstatic.com')) return;

    // NETWORK FIRST: siempre intenta la red primero
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => {
                console.warn('[SW v114] Red no disponible, usando caché:', event.request.url);
                return caches.match(event.request);
            })
    );
});

self.addEventListener('message', event => {
    if (event.data === 'force-update') {
        self.skipWaiting();
    }
});

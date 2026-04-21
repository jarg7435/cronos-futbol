// ─────────────────────────────────────────────────────────────
//  CRONOS FÚTBOL — Service Worker
//  INSTRUCCIÓN PARA EL DESARROLLADOR:
//  Cada vez que subas una versión nueva a GitHub,
//  incrementa el número de VERSION (v31, v32, etc.)
//  Los usuarios verán la nueva versión automáticamente.
// ─────────────────────────────────────────────────────────────
const VERSION    = 'v45';
const CACHE_NAME = 'cronos-cache-v11.2';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './img/logo_cronos.png',
    './img/icon-192.png',
    './img/icon-512.png',
    // Módulos JS principales
    './app.js',
    './js/auth.js',
    './js/rbac.js',
    './js/01_state.js',
    './js/02_utils.js',
    './js/03_ui_components.js',
    './js/04_formation_data.js',
    './js/05_field_rendering.js',
    './js/06_firestore_storage.js',
    './js/07_staff.js',
    './js/08_ai_import.js',
    './js/09_reports.js',
    './js/10_notifications.js',
    './js/11_persistence.js',
    './js/11_persistence_FIX.js',
    './js/12_init.js',
    './js/14_match_reports_parents.js',
    './js/15_coordinated_comms.js',
    './js/16_superadmin.js',
    './js/17_club_admin.js'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS).catch(err => {
                console.warn('SW: Algunos recursos no se pudieron cachear (omitido)', err);
            });
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // Solo cachear peticiones GET. No soportamos POST (Firebase), PUT, DELETE, etc. en cache.
    if (event.request.method !== 'GET') return;

    // Solo permitir esquemas http o https
    if (!event.request.url.startsWith('http')) return;

    // No cachear peticiones a Firebase o externas (Google Fonts, etc)
    if (event.request.url.includes('firestore.googleapis.com') ||
        event.request.url.includes('firebaseio.com') ||
        event.request.url.includes('fonts.googleapis.com') ||
        event.request.url.includes('fonts.gstatic.com')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Si la red responde, guardamos en cache y devolvemos
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => {
                // Si falla la red, intentamos cache
                return caches.match(event.request);
            })
    );
});

// Listener para forzar actualización desde la UI
self.addEventListener('message', event => {
    if (event.data === 'force-update') {
        self.skipWaiting();
        console.log('SW: Forzando actualización v' + VERSION);
    }
});

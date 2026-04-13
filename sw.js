// ─────────────────────────────────────────────────────────────
//  CRONOS FÚTBOL — Service Worker
//  Incrementa VERSION en cada deploy para forzar actualización
// ─────────────────────────────────────────────────────────────
const VERSION    = 'v33';
const CACHE_NAME = 'cronos-cache-v8.0';

const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './auth.js',
    './manifest.json',
    'https://cdn-icons-png.flaticon.com/512/53/53283.png'
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// ── ACTIVATE: borrar cachés antiguas ─────────────────────────
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key)  => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// ── FETCH: Red primero, caché como respaldo ───────────────────
self.addEventListener('fetch', (e) => {
    // ⚠️ CRÍTICO: ignorar cualquier petición que NO sea http o https
    // (chrome-extension://, moz-extension://, etc. no se pueden cachear)
    if (!e.request.url.startsWith('http')) return;

    // Solo interceptar GET
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);

    // Ignorar peticiones de Firebase (autenticación, Firestore, Functions)
    // No queremos cachear respuestas de la API
    const isFirebase =
        url.hostname.includes('firebaseapp.com')     ||
        url.hostname.includes('googleapis.com')      ||
        url.hostname.includes('identitytoolkit.google.com') ||
        url.hostname.includes('securetoken.google.com');

    if (isFirebase) return;

    // Archivos principales de la app → RED PRIMERO
    const isAppFile =
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('.js')   ||
        url.pathname.endsWith('.css')  ||
        url.pathname === '/'           ||
        url.pathname.endsWith('/');

    if (isAppFile) {
        e.respondWith(
            fetch(e.request)
                .then((networkRes) => {
                    // Guardar copia fresca en caché
                    const clone = networkRes.clone();
                    caches.open(CACHE_NAME).then((cache) =>
                        cache.put(e.request, clone)
                    );
                    return networkRes;
                })
                .catch(() =>
                    // Sin conexión → servir desde caché
                    caches.match(e.request)
                )
        );
    } else {
        // Imágenes, fuentes → CACHÉ PRIMERO
        e.respondWith(
            caches.match(e.request).then(
                (cached) => cached || fetch(e.request)
            )
        );
    }
});

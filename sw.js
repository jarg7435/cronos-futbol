// ─────────────────────────────────────────────────────────────
//  CRONOS FÚTBOL — Service Worker
//  INSTRUCCIÓN PARA EL DESARROLLADOR:
//  Cada vez que subas una versión nueva a GitHub,
//  incrementa el número de VERSION (v31, v32, etc.)
//  Los usuarios verán la nueva versión automáticamente.
// ─────────────────────────────────────────────────────────────
const VERSION    = 'v31';
const CACHE_NAME = `cronos-futbol-${VERSION}`;

const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './auth.js',
    './manifest.json',
    'https://cdn-icons-png.flaticon.com/512/53/53283.png'
];

// ── INSTALL: precachear todos los assets ─────────────────────
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    // Activa el nuevo SW inmediatamente sin esperar a que
    // el usuario cierre todas las pestañas
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
    // Toma el control de todas las pestañas abiertas de inmediato
    self.clients.claim();
});

// ── FETCH: Red primero, caché como respaldo ───────────────────
// Así los usuarios siempre reciben la versión más reciente
// cuando tienen conexión. Si están offline, sirve la caché.
self.addEventListener('fetch', (e) => {
    // Solo interceptar peticiones GET
    if (e.request.method !== 'GET') return;

    // Para los archivos principales de la app → RED PRIMERO
    const url = new URL(e.request.url);
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
        // Para imágenes, fuentes, etc. → CACHÉ PRIMERO (más rápido)
        e.respondWith(
            caches.match(e.request).then(
                (cached) => cached || fetch(e.request)
            )
        );
    }
});

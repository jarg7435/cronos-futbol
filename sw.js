// ─────────────────────────────────────────────────────────────
//  CRONOS FUTBOL — Service Worker v134
//  v134: isClubAdminOf con fallback adminEmail (club_admin sin adminUid lee su club) + saCreateClubConfirm escribe adminUid:null
//         (pending/pending_club_admin accionables + pending_sa solo lectura).
//  v131: Bump cache — fix multi-rol (anadir rol a cuenta existente sin
//         escalada) + badge de Solicitudes del SuperAdmin con conteo real.
//  v130: Bump cache — multi-rol + fallo deleteAuthUser visible/persistente
//         en individual_panel.js y superadmin_panel.js.
//  v129: Bump cache — multi-rol club admin (quitar rol vs eliminar
//         usuario) + fallo deleteAuthUser registrado/visible.
//  v128: Bump cache — fuerza recarga de utils.js (fix export roto
//         que rompia el <script> clasico con SyntaxError).
//  v127: Fix todas las rutas fin partido limpian localStorage +
//         dedup padres por email + clubId staff docs.
//  v126: Guard idempotencia con huella granular (uid+fecha+marcador)
//         + logs diagnostico staffReport en autoDispatchMatchReports.
//  v125: Fix informes duplicados (dedupe rutas endMatch muertas +
//         guard idempotencia persistente en localStorage).
//  v124: Fix nombre superadmin.panel.js en ASSETS, eliminar
//         email-whatsapp.js del precache, quitar ?v= de index.html.
//  v123: Eliminados 4 scripts stub del index.html
//  pre-populate send modal from localStorage, planificacion_semanal
//  detail view renderiza tabla de días correctamente.
//  v121: Eliminados 4 scripts stub vacíos del ASSETS.
// ─────────────────────────────────────────────────────────────
const VERSION    = 'v134';
const CACHE_NAME = 'cronos-cache-v134';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './style.css',
    './js/core/app-init.js',
    './js/core/setup-modal.js',
    './js/core/patches.js',
    './js/core/security-and-state.js',
    './js/core/utils.js',
    './js/core/pseudonymizer.js',
    './js/core/staff-and-comms.js',
    './js/core/event-listeners.js',
    './js/services/firebase-init.js',
    './js/services/auth.js',
    './js/services/auth-improvements.js',
    './js/services/firestore-sync.js',
    './js/services/firestore-storage.js',
    './js/services/offline-manager.js',
    './js/services/user-management.js',
    './js/match/events/player-actions.js',
    './js/match/demo-tutorial.js',
    './js/match/persistence/active-match.js',
    './js/match/timer/core.js',
    './js/match/events/movement-log.js',
    './js/match/persistence/team-persistence.js',
    './js/match/live/sync.js',
    './js/roster/formations.js',
    './js/roster/legacy-formations.js',
    './js/ui/bench-scroll.js',
    './js/ui/render.js',
    './js/ui/drag-drop.js',
    './js/shared/whatsapp-email.js',
    './js/shared/admin-shared.js',
    './js/ai/import.js',
    './js/admin/superadmin/superadmin.panel.js',
    './js/admin/superadmin/extras.js',
    './js/admin/superadmin/billing.js',
    './js/admin/club/panel.js',
    './js/admin/individual/panel.js',
    './js/admin/billing/payments.js',
    './js/admin/billing/ui.js',
    './js/coach/comms/panel.js',
    './js/coach/convocation.js',
    './js/coach/reports/club-reports.js',
    './js/coach/reports/generator.js',
    './js/coach/training/panel.js',
    './js/parent/panel.js',
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS).catch(err => {
                console.warn('[SW v134] Error al precargar recursos:', err);
            });
        })
    );
});

self.addEventListener('activate', event => {
    console.log('[SW v134] Activado - eliminando cachés antiguas');
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log('[SW v134] Borrando caché antigua:', key);
                        return caches.delete(key);
                    })
            );
        }).then(() => {
            console.log('[SW v134] Todas las cachés antiguas eliminadas');
            return self.clients.claim();
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
                console.warn('[SW v134] Red no disponible, usando caché:', event.request.url);
                return caches.match(event.request);
            })
    );
});

self.addEventListener('message', event => {
    if (event.data === 'force-update') {
        self.skipWaiting();
    }
});

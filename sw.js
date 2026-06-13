// ─────────────────────────────────────────────────────────────
//  CRONOS FUTBOL — Service Worker v172
//  v172: logging de diagnostico opcional para informes (activar con
//         window._cronosDiagReports = true en consola). Sin efecto en
//         produccion si la bandera no esta activada. Registra por que se
//         omite cada padre/staff al enviar informes.
//  v171: REDISENO del envio de informes de partido (raiz: padres recibian
//         informes de jugadores que NO son sus hijos).
//         - Helper compartido _cronosResolveParentReportTargets usado por
//           AMBAS rutas (auto-despacho y envio manual): emparejado ESTRICTO
//           SOLO por dorsal (inviteCode 'J10'), nunca por nombre; maximo 1
//           informe por padre; solo si el padre tiene parentUid registrado y
//           su hijo fue convocado (si no, se omite en silencio).
//         - _cGetStaff Regla 1/2: director y coordinador SIEMPRE reciben el
//           informe colectivo aunque no tengan el checkbox INF; el resto del
//           staff solo con el checkbox.
//         - IDs deterministas {matchId}_parent_{parentUid}_p{dorsal} (idempotentes).
//  v170: FIX DEFINITIVO panel del padre (2 bugs latentes tras v169):
//         (1) Perdida de datos: _rptDedupKey ignoraba matchId y deduplicaba por
//         fecha+rival+marcador, asi que DOS partidos distintos el mismo dia contra
//         el mismo rival con identico marcador colapsaban a una clave y el cleanup
//         borraba de Firestore el informe del 2o partido. Fix: la clave usa matchId
//         (mid:<matchId>_<dorsal>) cuando existe; solo cae a fecha+rival+marcador
//         (dt:...) para los rpt_* legacy sin matchId.
//         (2) Asimetria de filtro: el loop de Prioridad 1 (parentUid) NO filtraba
//         por type===parent_player_report (solo lo hacia Prioridad 2 desde v169),
//         de modo que un collective_match_report con parentUid del padre habria
//         colado. Anadido el mismo filtro estricto a Prioridad 1.
//         Verificado con scripts/test_parent_dedup.js (6/6): incl. escenario de
//         perdida de datos y colectivo con parentUid.
//  v168: Refuerzo de los fixes v167 (P1/P2):
//         P1: eliminado Math.random() por completo de las 3 copias de
//         startLiveSync; el sufijo se deriva de uid+fecha+equipo(+rival+convo)
//         via _cronosBuildLiveMatchId (sin componente aleatorio).
//         P2: la query de links cargaba por clubId/individualOwnerId/coachUid;
//         si el link de un padre tiene clubId distinto/ausente quedaba fuera y
//         el match devolvia undefined. Anadido _fetchLinkByParentUid: fallback
//         que consulta cronos_player_links por parentUid SIN filtro de club
//         (cacheado) en _executeReportsSend y autoDispatchMatchReports.
//  v167: FIX raiz informes duplicados a padres + link padre-jugador undefined.
//         P1: liveMatchId usaba Math.random() en sus 3 copias de startLiveSync
//         (app-init.js, match/live/sync.js, services/firestore-sync.js); reiniciar
//         el sync cambiaba el sufijo (eq1u->x9k2) y, como _stableMatchId deriva de
//         liveMatchId, el matchId del informe dejaba de ser estable y el dedup del
//         padre no colapsaba. Fix: sufijo DETERMINISTA (hash FNV-1a de equipo+
//         fecha+rival+convocatoria) via window._cronosBuildLiveMatchId, que ademas
//         reutiliza el liveMatchId existente. v166 solo corrigio el Date.now() de
//         _stableMatchId; la aleatoriedad real estaba aguas arriba.
//         P2: el emparejado link padre-jugador (autoDispatchMatchReports/FaseC)
//         comparaba email/telefono con === sin normalizar -> link undefined aunque
//         el doc existiera (case/espacios o prefijo +34). Fix: _cronosNormEmail /
//         _cronosNormPhone + fallback de link por playerNumber/playerAlias + log
//         diagnostico que distingue "no cargado por clubId" de "no caso".
//  v166: FIX informes individuales duplicados a padres (llegaban 10+ veces).
//         Causa: sharedMatchId usaba Date.now(), así que cada disparo del fin
//         de partido que se colaba por los guards creaba docs con matchId nuevo
//         (setDoc no idempotente) y el dedup del panel del padre no los colapsaba.
//         Fix: matchId DETERMINISTA (helper _stableMatchId: liveMatchId o
//         uid+fecha+rival, sin marcador) en auto y manual dispatch + dedup
//         defensivo en parent/panel.js (fallback parentUid+playerNumber+fecha).
//  v165: FIX informes club — ocultado suave por usuario (hiddenBy) en lugar de
//         borrado físico. Director y coordinador comparten los mismos docs en
//         Firestore: al borrar uno, el otro perdía el informe. Ahora sdDeleteReport
//         hace updateDoc con hiddenBy: arrayUnion(uid); el filtro cliente excluye
//         los docs ocultados por el propio uid y firestore.rules permite el update.
//  v163: FIX CRÍTICO — al reanudar la 2ª parte tras el descanso el partido se
//         reiniciaba (marcador 0-0, cronómetro a cero, vuelta a 1ª parte). Causa:
//         el técnico volvía a «Configuración» durante el descanso para hacer
//         cambios y, al re-confirmar la convocatoria, goToTitularSelection() /
//         startMatchWithConvocation() (versión ACTIVA en js/ai/import.js)
//         ejecutaban el RESET GLOBAL del partido. Fix: nuevo guard
//         _guardAgainstMatchReset() (app-init.js) detecta un partido EN CURSO
//         (1ª/descanso/2ª con marcador o tiempo) y ofrece REANUDAR (conserva
//         marcador y cronómetro vía _restoreActiveMatch) o empezar de cero.
//  v162: Bump cache — fuerza recarga de los fixes de partido en vivo (clubId en
//         live_matches), del filtro del visor (live.html) y de setCustomClaims al
//         activar miembros (panel.js). Sin el bump no se purga la cache v161.
//  v161: FIX CRÍTICO — informes de partido no se enviaban a nadie a partir
//         del 2º partido. La versión ACTIVA de startMatchWithConvocation
//         (js/ai/import.js, carga DESPUÉS de app-init.js y la eclipsa) no
//         limpiaba los guards de idempotencia de informes (cronos_reports_sent_*
//         + _cronosLastDispatchedMatch + liveMatchId), por lo que
//         saveAllMatchReportsInternal() omitía el despacho del 2º partido en
//         adelante. Bump fuerza recarga de import.js parcheado.
//  v159: RGPD (P1) — el enlace «Política de Privacidad» del pie ahora solo
//         se muestra en modo login (en registro queda el del checkbox). Se
//         gestiona en los onclick de las pestañas y en switchTab (auth.js).
//  v158: RGPD (P1, fix definitivo) — una regla CSS ofuscada con
//         display:none !important sobreescribia el display:block inline del
//         checkbox. Ahora se usa setProperty('display', ..., 'important') en
//         los onclick de las pestañas y en switchTab (auth.js). Bump cache.
//  v157: Fix ojo de contraseña — se desactiva initPasswordToggles() en
//         auth-improvements.js (duplicaba el listener de wireToggle() de
//         index.html y alternaba el tipo dos veces por clic). Bump cache.
//  v156: RGPD (P1, hotfix 2) — el onclick de las pestañas muestra el GDPR
//         ANTES de switchTab y solo llama a switchTab si existe (evita que
//         un ReferenceError rompa la cadena y oculte el checkbox). Bump cache.
//  v155: RGPD (P1, hotfix) — el onclick de las pestañas muestra/oculta
//         #gdpr-consent-container inline (independiente de switchTab/cache),
//         para que el checkbox aparezca en registro. Bump invalida cache.
//  v154: CSP (hotfix) — bump para forzar descarte de cache en clientes y
//         recoger la cabecera CSP nueva (cdn.jsdelivr.net en connect-src).
//  v153: RGPD (P1) — #auth-btn se deshabilita en registro hasta aceptar el
//         consentimiento (switchTab + syncAuthBtnConsent). Bump fuerza
//         recarga de auth.js parcheado.
//  v152: RGPD (P1) — el registro persiste el consentimiento explicito en el
//         documento del usuario (gdprConsent / gdprConsentDate /
//         gdprConsentVersion) en las 4 rutas de creacion de usuario.
//         Bump fuerza recarga de auth.js parcheado.
//  v151: Privacidad (P9, 2/2) — refuerza el cierre de la fuga:
//         (1) firestore.rules: live_matches read pasa de isAuth() a
//         isRegisteredUser() (exige users/{uid}.isAuthorized==true, no
//         solo autenticado). (2) live.html: el coachEmail en las tarjetas
//         de showLiveNow()/showHistory() solo se muestra a role
//         superadmin/admin; el resto de usuarios ya no ve el correo del
//         entrenador. Bump fuerza recarga de live.html parcheado.
//  v150: Privacidad (P9) — firestore.rules: live_matches pasa de
//         `allow read: if true` (PII publica: coachEmail, nombres de
//         jugadores menores, dorsales, club, colores) a `allow read:
//         if isAuth()`. live.html y parent/panel.js ya gatean por login
//         antes de consultar, asi que no rompe ningun flujo. Cierra la
//         fuga de datos que v149 solo mitigaba a nivel de XSS. (El
//         comentario "se lee sin auth" de v149 queda obsoleto tras este
//         deploy de reglas.)
//  v149: Seguridad — fix XSS almacenado en live.html. Se anaden
//         escapeHtml() (nombres de equipo/jugador, email del entrenador,
//         dorsales, nombre de club) y safeColor() (validacion de color
//         CSS contra regex) en los ~20 puntos de innerHTML que inyectaban
//         datos de Firestore controlables por el entrenador. live_matches
//         se lee sin auth, asi que el payload era explotable por visitantes
//         anonimos. Bump fuerza recarga del live.html parcheado.
//  v148: Limpieza — elimina el log de debug temporal de v147 y baja a
//         console.debug el permission-denied transitorio de syncFromFirestore
//         (esperado para coach/club_admin con claims aun no propagados; el SA
//         no inicializa TrainingSync). Menos ruido en consola.
//  v147: Log de debug TEMPORAL en training-firestore-sync.js para
//         inspeccionar en produccion el estado de _cronos_auth.auth.currentUser
//         y los claims reales (role/clubId) del ID token vs el clubId que se
//         consulta. Diagnostico del permission-denied persistente.
//  v146: Bump cache — fuerza recarga de js/services/training-firestore-sync.js
//         con el fix de Race B: se reemplaza el setTimeout(2000ms) fijo por
//         _whenTokenReady() (getIdToken(true)) antes de syncFromFirestore,
//         evitando el permission-denied espurio cuando el ID token aun no
//         tiene los custom claims role/clubId propagados.
//  v145: Bump cache — fuerza recarga de js/parent/panel.js con el fix
//         que evita crear IDs basura 'null_N' en cronos_player_links
//         (guarda && clubId en auto-vinculacion + guard if(!clubId) en
//         vinculacion manual). Sin el bump los clientes seguirian con el
//         panel.js antiguo que generaba docs como null_10.
//  v141: Logs del SW usan `${VERSION}` (antes hardcodeado '[SW v134]',
//         desincronizado desde v135). Bump fuerza a clientes con SW
//         antiguo (<=v139) a migrar al SW con el CSP que permite
//         cdn.jsdelivr.net en connect-src, eliminando el error real de
//         consola al hacer fetch del bundle de EmailJS/Tesseract.
//  v140: Bump cache — purga el manifest.json cacheado con la antigua URL
//         de Flaticon (CDN externo). Ahora el icono PWA usa el logo local
//         /public/assets/logo.png. Sin el bump, CACHE_NAME no cambia y el
//         activate no borra cronos-cache-v139, que servia el manifest viejo.
//  v139: Rediseno de privacy.html con tema oscuro CHRONOS FUTBOL: hero con
//         logo a 120px, header sticky con logo a 64px y marca actualizada.
//  v138: Anadida pagina privacy.html (Politica de Privacidad RGPD) al
//         precache + enlace en el pie de la pantalla de login (index.html).
//  v137: Bump cache — revertir tarjeta roja (rectificacion arbitral) en
//         player-actions.js: boton en el modal que deshace la expulsion
//         sin mover al jugador, con registro en auditLogger/matchEvents.
//  v136: Eliminado js/coach/convocation.js (duplicado obsoleto que
//         sobrescribia las funciones canonicas de shared/whatsapp-email.js).
//         Quitado del precache + index.html. Sin perdida de funciones.
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
// ─────────────────────────────────────────────────────────────
// CHRONOS FÚTBOL — SERVICE WORKER
// v142: SPRINT 4 — Offline Fallback + Local Icons
// ─────────────────────────────────────────────────────────────
const VERSION    = 'v172';
const CACHE_NAME = 'cronos-cache-v172';

const ASSETS = [
    './',
    './index.html',
    './offline.html',
    './privacy.html',
    './manifest.json',
    './style.css',
    './js/core/app-init.js',
    './js/core/setup-modal.js',
    './js/core/patches.js',
    './js/core/security-and-state.js',
    './js/core/utils.js',
    './js/core/pseudonymizer.js',
    './js/core/accessibility-wcag.js',
    './js/core/staff-and-comms.js',
    './js/core/event-listeners.js',
    './js/services/firebase-init.js',
    './js/services/auth.js',
    './js/services/auth-improvements.js',
    './js/services/firestore-sync.js',
    './js/services/firestore-storage.js',
    './js/services/offline-manager.js',
    './js/services/notification-dismiss-sync.js',
    './js/services/training-firestore-sync.js',
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
    './js/coach/reports/club-reports.js',
    './js/coach/reports/generator.js',
    './js/coach/training/panel.js',
    './js/parent/panel.js',
    // SPRINT 4: Iconos locales para PWA
    './public/assets/icons/chronos-192.svg',
    './public/assets/icons/chronos-512.svg',
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS).catch(err => {
                console.warn(`[SW ${VERSION}] Error al precargar recursos:`, err);
            });
        })
    );
});

self.addEventListener('activate', event => {
    console.log(`[SW ${VERSION}] Activado - eliminando cachés antiguas`);
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log(`[SW ${VERSION}] Borrando caché antigua:`, key);
                        return caches.delete(key);
                    })
            );
        }).then(() => {
            console.log(`[SW ${VERSION}] Todas las cachés antiguas eliminadas`);
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

    // CACHE FIRST para iconos, fonts, y assets estáticos
    if (event.request.url.includes('/public/assets/icons/') ||
        event.request.url.includes('.svg') ||
        event.request.url.includes('.woff') ||
        event.request.url.includes('.woff2') ||
        event.request.url.includes('manifest.json')) {
        
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    return response || fetch(event.request)
                        .then(response => {
                            if (response.ok) {
                                const copy = response.clone();
                                caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                            }
                            return response;
                        });
                })
                .catch(() => {
                    console.warn(`[SW ${VERSION}] Asset no disponible:`, event.request.url);
                    return caches.match(event.request);
                })
        );
        return;
    }

    // NETWORK FIRST para todo lo demás
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
                // Intentar caché
                return caches.match(event.request)
                    .then(cached => {
                        if (cached) return cached;
                        
                        // Fallback a offline.html para navegación
                        if (event.request.destination === 'document') {
                            return caches.match('./offline.html')
                                .then(offlinePage => offlinePage || new Response(
                                    '⚠️ Sin conexión y página no disponible en caché',
                                    { status: 503, statusText: 'Service Unavailable' }
                                ));
                        }
                        
                        // Para otros recursos, retornar error
                        return new Response(
                            'Recurso no disponible',
                            { status: 404, statusText: 'Not Found' }
                        );
                    });
            })
    );
});

self.addEventListener('message', event => {
    if (event.data === 'force-update') {
        self.skipWaiting();
    }
});

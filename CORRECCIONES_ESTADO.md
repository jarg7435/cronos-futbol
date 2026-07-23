# Cronos Fútbol — Estado de correcciones

_Última actualización: 2026-07-22 — unificados los chats entrenador/director/coordinador (ver más abajo). Próxima sesión: empezar por E6._

## COMPLETADO

- [x] **C1**: Doble init Firebase eliminada (`cronos_post_update` movido a `firebase-init.js`)
- [x] **E1**: Goles bloqueados en banquillo; tarjetas y lesiones siempre visibles (`js/match/events/player-actions.js`)
- [x] **E2**: `deleteAuthUser` robusto + email liberado
  - Servidor (`functions/index.js`): resuelve UID real por email ante `auth/user-not-found`; distingue `alreadyAbsent`.
  - Cliente (`js/admin/superadmin/superadmin.panel.js`): `saSetClubUserStatus` y `saPurgeUser` abortan el borrado (aviso 🚫) si Auth falla por motivo distinto a `auth/user-not-found`.
  - Desplegado: Cloud Function `deleteAuthUser(us-central1)` + hosting. Commit `712d718` en `main`.

- [x] **E3**: Informes colectivos ahora llegan a coordinadores/directores
  - Causa: `_sendCollectiveReportNow` (`js/coach/comms/panel.js`, botón "Informe Colectivo → Dirección") guardaba los documentos `cronos_player_reports` con `type:'collective_match_report'` pero **sin** `staffReport:true`.
  - El panel de Dirección (`js/coach/reports/club-reports.js` → `_sdLoadReports`) filtra exclusivamente `data.staffReport === true`, por lo que esos informes nunca aparecían.
  - Fix: añadido `staffReport: true` al documento por jugador en `_sendCollectiveReportNow` (línea ~3107). Verificado con test de filtro (doc nuevo visible; doc antiguo sin flag, oculto).
  - Refuerzo (puntos 1-3 del plan, sesión E3b):
    - P1 `autoDispatchMatchReports`: destinatarios del staff resueltos SIEMPRE vía `_cGetStaff` (users por clubId + roles director/coordinator) unificado con `emailConfig`; el tag `rpt` deja de ser requisito.
    - P2: guard/aviso en consola si `me.clubId` es nulo (sin él, las reglas Firestore impiden la lectura del staff).
    - P3 `openCollectiveReport`: `_cGetStaff` pasa a ser fuente PRIMARIA (antes solo fallback); `emailConfig` solo añade contactos no duplicados.
    - Verificado con test: directores/coordinadores del club incluidos aunque no estén en `emailConfig` ni tengan tag `rpt`; sin duplicados; padres excluidos.
  - Commits E3: `cfcea5e` (staffReport=true) + `8bdfebc` (puntos 1-3 staff sin tag rpt) en `main`.

## COMPLETADO E4

- [x] **E4**: Informe individual ya NO se triplica a padres
  - Causa: el fin de partido se dispara desde 3 rutas (`endMatch` manual en `active-match.js`, `terminateMatch` por expulsiones en `player-actions.js`/`app-init.js`, y fin automático del crono). Cada ruta llamaba a `saveAllMatchReportsInternal()` sin guard, y **además** esa función escribía un doc `rpt_*` por jugador (con `parentUid`) Y llamaba a `autoDispatchMatchReports()`, que escribe un `parent_player_report`. El panel del padre (`js/parent/panel.js` → filtra por `parentUid` y por `playerNumber+clubId`) mostraba ambos → 2 copias por llamada × varios disparos = informe duplicado/triplicado.
  - Fix (`js/coach/comms/panel.js` → `saveAllMatchReportsInternal`):
    1. **Guard de idempotencia**: huella por partido (`live:<liveMatchId>` o `local:<uid>:<fecha>:<marcador>`). Se reserva la huella antes del primer `await` para cerrar la ventana de carrera entre disparos casi simultáneos; si vuelve a llamarse con la misma huella, se omite. En error se libera la huella para permitir reintento manual.
    2. **Eliminada la escritura redundante** del doc `rpt_*` por jugador: la función queda como orquestador único; `autoDispatchMatchReports()` genera la copia canónica (`parent_player_report`) → una sola copia al padre.
  - Reset del guard al empezar partido nuevo: `resetMatch` (`js/match/events/movement-log.js`) y al generar nuevo `liveMatchId` (`js/match/live/sync.js`, `js/services/firestore-sync.js`).
  - Verificado con test del guard: 3 disparos del mismo partido → 1 despacho; partido nuevo → vuelve a despachar; modo local sin live-sync funciona.

## COMPLETADO (HOTFIX v167 — persistían tras v166)

- [x] **P1 (v167)**: Informes individuales aún duplicados a padres (10+ veces)
  - v166 corrigió el `Date.now()` dentro de `_stableMatchId`, pero la aleatoriedad
    real estaba **aguas arriba**: las 3 copias de `startLiveSync`
    (`js/core/app-init.js`, `js/match/live/sync.js`, `js/services/firestore-sync.js`)
    generaban el sufijo de `liveMatchId` con `Math.random().toString(36).substr(2,4)`
    (ej. `futbol-7-12062026-eq1u`). Al re-iniciar el sync el sufijo cambiaba, y como
    `_stableMatchId` devuelve `match_${liveMatchId}`, el `matchId` del informe dejaba
    de ser estable → `setDoc` creaba docs nuevos y el dedup del panel del padre
    (`matchId+playerNumber`) no los colapsaba.
  - Fix: helpers deterministas en `js/core/utils.js`:
    - `window._cronosStableSlug(input,len)`: hash FNV-1a 32-bit → 4 chars base36.
    - `window._cronosBuildLiveMatchId(opts)`: reutiliza el `liveMatchId` existente
      (`existing`) o deriva el sufijo de la identidad estable del partido
      (equipo+fecha+rival+huella de la convocatoria). Las 3 copias de `startLiveSync`
      llaman a este helper pasando `existing: liveMatchId`.
  - Verificado con `test_fixes_p1_p2.js`: 50 llamadas con el mismo input → 1 id;
    reuse del id existente; partido distinto → id distinto; matchId del informe
    estable entre disparos.

- [x] **P2 (v167)**: `link: undefined` al buscar al jugador del padre (FaseC)
  - `No se encontró al jugador para el destinatario … con link: undefined`. El
    `link` venía `undefined` porque el emparejado en `autoDispatchMatchReports`
    (`js/coach/comms/panel.js`) comparaba `l.parentEmail === r.email` y
    `l.parentPhone === r.phone` **sin normalizar** (case/espacios o prefijo `+34`),
    así que el doc existía en Firestore pero el `find` no casaba; las 4 condiciones
    siguientes del `find` del jugador exigen `link && …` → `undefined`.
  - Fix (`js/core/utils.js` + `panel.js`):
    - `window._cronosNormEmail` (trim+lowercase) y `window._cronosNormPhone`
      (solo dígitos; quita prefijo `34`/`0034` español) aplicados al matching del
      link y a los dedup-merge de contactos (líneas ~470 y ~948).
    - Fallback de link por `playerNumber`/`playerAlias` cuando no casa por padre.
    - Log diagnóstico `[Cronos][P2]` que distingue "link no cargado por `clubId`"
      (filtro de la query) de "no casó".
  - Verificado con `test_fixes_p1_p2.js`: email/teléfono normalizados casan;
    fallback por número/alias recupera el link; comparación estricta (pre-fix) no
    encontraba el link (confirma la causa).
  - Bump SW a `cronos-cache-v167`.

## COMPLETADO (HOTFIX v168 — refuerzo de v167)

- [x] **P1 (v168)**: `liveMatchId` SIN `Math.random()` en sus 3 copias
  - v167 introdujo `_cronosBuildLiveMatchId` (sufijo determinista) pero las 3 copias
    de `startLiveSync` (`js/core/app-init.js`, `js/match/live/sync.js`,
    `js/services/firestore-sync.js`) todavía calculaban un `randSlug` con
    `Math.random().toString(36).substr(2,4)` como ruta de fallback.
  - Fix: eliminado `Math.random()` por completo de las 3 copias. El sufijo se deriva
    SIEMPRE de la identidad del partido: `uid + fecha + equipo (+ rival + convocatoria)`
    vía `_cronosBuildLiveMatchId({ ..., uid })`. El fallback sin helper usa
    `_cronosStableSlug(uid|equipo|fecha)`. Con ello, reiniciar el sync NO cambia el
    `matchId` del informe y el dedup del panel del padre colapsa correctamente.
  - Verificado con `test_fixes_p1_p2.js`: 50 llamadas con el mismo input → 1 solo id;
    `uid` distinto → id distinto; y comprobación de que el código fuente de las 3
    copias ya no contiene el patrón `Math.random().toString(36).substr(2,4)`.

- [x] **P2 (v168)**: fallback de link SIN filtro de `clubId`
  - La query de links (`autoDispatchMatchReports` y la carga manual) filtra por
    `clubId == me.clubId`. Si `me.clubId` es nulo, o el doc del link de un padre/jugador
    tiene un `clubId` distinto/ausente, ese link nunca se carga y el `find` devuelve
    `undefined` aunque el doc exista en Firestore.
  - Fix (`js/coach/comms/panel.js`):
    - Despacho MANUAL (`_executeReportsSend`): `_fetchLinkByParentUid(parentUid)`
      consulta `cronos_player_links` por `parentUid` SIN filtro de club (cacheado) y
      se invoca cuando el match por club/email/teléfono/jugador ha fallado.
    - Despacho AUTO (`autoDispatchMatchReports`): `_fetchLinksByPlayerNumber(num)`
      consulta por `playerNumber` SIN filtro de club (cacheado) y se invoca por
      jugador cuando `linkedParents` sale vacío; los links recuperados se incorporan
      al array `links` para usos posteriores del mismo despacho.
    - Logs `[Cronos][P2]` / `[Cronos][P2][auto]` registran cuándo se recupera un link
      por el fallback (con el `clubId` del link vs `me.clubId`).
  - Verificado con `test_fixes_p1_p2.js`: con un link de clubId distinto, la query por
    club no lo trae (pre-fix) y ambos fallbacks (parentUid en manual, playerNumber en
    auto) lo recuperan.
  - Bump SW a `cronos-cache-v168`.

## COMPLETADO (HOTFIX informes)

- [x] **BUG-CRÍTICO**: «Informes de partido no se envían a nadie» (a partir del 2º partido)
  - Causa raíz: hay DOS definiciones globales de `startMatchWithConvocation`:
    - `js/core/app-init.js` (~línea 3558): limpia los guards de idempotencia de
      informes al empezar un partido nuevo (`cronos_reports_sent_*` en
      localStorage, `window._cronosLastDispatchedMatch`, `liveMatchId`,
      `liveIsActive`).
    - `js/ai/import.js` (~línea 819): **NO** limpiaba nada.
  - `js/ai/import.js` se carga DESPUÉS de `js/core/app-init.js` en `index.html`
    (1183 vs 1228), así que su versión **eclipsa** a la de app-init.js y es la
    ACTIVA. Resultado: tras finalizar el 1er partido, los guards quedaban puestos
    y `saveAllMatchReportsInternal()` (`js/coach/comms/panel.js`) omitía el
    despacho de TODOS los partidos siguientes → ni staff, ni padres, ni la copia
    del propio entrenador recibían informe. Con `liveMatchId` obsoleto (sin red /
    sync fallido) el bloqueo era inmediato en el 2º partido.
  - Fix (`js/ai/import.js` → `startMatchWithConvocation`): replicada la limpieza
    de guards de la versión de app-init.js justo tras fijar `activeConvocation`.
  - Verificado con repro E2E que extrae el bloque de limpieza real y simula 2
    partidos consecutivos (incl. `liveMatchId` obsoleto/offline): pre-fix el 2º
    partido se omitía; post-fix ambos despachan. `node --check` OK.
  - Bump SW a `cronos-cache-v161` para forzar recarga de `import.js` parcheado.
  - Deuda técnica: unificar las múltiples copias de `startMatchWithConvocation`
    en un único módulo (mismo problema de orden de carga frágil ya anotado en E5).

## COMPLETADO E5

- [x] **E5**: Entradas/salidas duplicadas en línea de tiempo
  - Causa: las transiciones de fase (`endFirstHalf` → `Sale (DESCANSO)`, `startSecondHalf` → `Entra (2ªP)`, `endMatch` → `Sale (FIN)`) empujaban un registro al `history` de cada jugador en campo **sin guard de idempotencia**. Se podían disparar más de una vez:
    - `endFirstHalf`: carrera entre el auto-fin del crono (`tick` -> `endFirstHalf(true)` en `js/match/timer/core.js`) y el botón manual.
    - `startSecondHalf` / `endMatch`: doble pulsación o varias rutas de fin (manual, expulsión, fin automático).
  - Cada llamada extra añadía un par entrada/salida que `exportData` (`js/match/events/movement-log.js`) renderizaba como columnas duplicadas en la línea de tiempo del informe.
  - Fix: guard por `matchPhase` (la fase cambia de forma síncrona antes de cualquier llamada duplicada, cerrando la carrera):
    - `endFirstHalf`: `if (matchPhase !== '1st_half') return;`
    - `startSecondHalf`: `if (matchPhase !== 'break') return;`
    - `endMatch`: `if (matchPhase === 'finished') return;` (colocado antes del confirm, evita además el diálogo redundante).
  - Aplicado a **todas las copias** de cada función (herencia del split de `app.js`), ya que el orden de carga decide cuál gana: `js/core/event-listeners.js` (la activa, cargada al final), `js/core/app-init.js`, `js/match/persistence/active-match.js`, `js/ai/import.js` y `js/match/events/player-actions.js` (`endMatch`).
  - Verificado con test de integración que extrae los cuerpos reales de las funciones ganadoras y los ejecuta en sandbox: doble llamada / carrera → exactamente 1 `DESCANSO` + 1 `2ªP` + 1 `FIN` por jugador; flujo normal intacto. Sintaxis (`node --check`) y EOL por archivo verificados.
  - Deuda técnica anotada: existen 4-5 definiciones globales redundantes de `setupEventListeners`/`endFirstHalf`/`startSecondHalf`/`endMatch`; conviene unificarlas en un único módulo en una limpieza posterior (la activa depende del orden de `<script>`, frágil).
  - Refuerzo (puntos C + D, saneo defensivo para informes ya guardados antes del fix):
    - P-C `_parseHistoryForFirestore` (`js/coach/comms/panel.js`): dedupe de eventos `sub_in`/`sub_out` repetidos (clave `type|timeStr`) antes de construir la línea de tiempo de los paneles de Dirección (`club-reports.js`) y de Padre (`parent/panel.js`). Goles/tarjetas/lesiones intactos; entradas/salidas en minutos distintos se conservan.
    - P-D emparejador de turnos en `exportData` (`js/match/events/movement-log.js`): helper `pushShift` que descarta un turno idéntico (mismo `in`+`out`) al último añadido, saneando el informe imprimible CSV/HTML. Turnos legítimos en minutos distintos dentro de la misma parte se conservan.
    - `js/coach/reports/generator.js` confirmado como **código muerto** (`ReportGenerator`/`generatePDF` no se instancian en ningún sitio); no es la fuente de la duplicación. Pendiente de limpieza (baja prioridad).
    - Verificado con test C+D que extrae las funciones reales de las fuentes: history antiguo con duplicados → 1 entrada/1 salida por turno; flujo limpio post-E5 intacto; dobles turnos legítimos preservados.


## COMPLETADO (HOTFIX v169 — panel del padre: 14 informes por partido)

- [x] **P3 (v169)**: El padre veía 14 informes del mismo partido en lugar de 1
  - Causa: en `ppPlayer` (`js/parent/panel.js`) se lanzan 2 queries en paralelo sobre
    `cronos_player_reports`: (1) `where(parentUid==me.uid)` y (2)
    `where(playerNumber==…) + where(clubId==…)`. La query (2) arrastra TODOS los docs
    del partido con ese dorsal, incluidos los `collective_match_report` que el
    entrenador genera (uno por cada jugador convocado). El loop de Prioridad 2
    (`rptByPlayer.forEach`) solo excluía `staffReport===true || _forCoach===true`, y
    esos `collective_match_report` NO llevan esos flags → colaban los 14.
  - Fix (`js/parent/panel.js`, loop de Prioridad 2): añadido filtro de inclusión
    estricto `if (data.type !== 'parent_player_report') return;` antes de los demás
    filtros. Solo los informes específicos de padre llegan al panel.
  - Verificado con test (15 docs de entrada: 14 `collective_match_report` + 1
    `parent_player_report`) → el padre ve exactamente 1 informe. `node --check` OK.
  - Bump SW a `cronos-cache-v169`.

## COMPLETADO (HOTFIX v170 — fix DEFINITIVO panel del padre)

- [x] **P4 (v170)**: dos bugs latentes en `js/parent/panel.js` que v169 no cerró
  - **(1) Pérdida de datos en el cleanup**: `_rptDedupKey` ignoraba `matchId` y
    deduplicaba por `fecha+rival+marcador`. Dos partidos DISTINTOS el mismo día,
    contra el mismo rival y con idéntico marcador colapsaban a la misma clave; el
    bloque "LIMPIEZA DE DUPLICADOS EN FIRESTORE" hacía `deleteDoc` del perdedor →
    se BORRABA el informe del 2º partido de Firestore (irreversible). Fix: la clave
    usa `mid:<matchId>_<dorsal>` cuando hay `matchId` (estable desde v167/v168) y
    solo cae a `dt:<fecha>_<rival>_<sh>_<sa>_<dorsal>` para los `rpt_*` legacy sin
    `matchId`.
  - **(2) Asimetría de filtro**: el loop de Prioridad 1 (`rptByParent`, docs con
    `parentUid==me.uid`) NO filtraba por `type==='parent_player_report'` (solo lo
    hacía Prioridad 2 desde v169), así que un `collective_match_report` con
    `parentUid` del padre habría colado. Añadido el mismo filtro estricto a
    Prioridad 1.
  - Verificado con `scripts/test_parent_dedup.js` (6/6): incluye el escenario
    crítico de pérdida de datos (2 partidos mismo día/rival/marcador → 2 informes,
    0 borrados) y el del colectivo con `parentUid` (excluido).
  - Bump SW a `cronos-cache-v170` + cache-busting `?v=v170` en index.html.

## COMPLETADO (v182-v188 — claims automaticos + reglas staff)

- [x] **C2 (v182)**: Custom claims automaticos al aprobar/cambiar rol de un usuario
  - Causa raiz del bug "director/coordinador no recibe informes": `_cGetStaff`
    (`js/coach/comms/panel.js`) consulta `users` por `clubId`, pero las reglas
    Firestore (`sameClubAsDoc`) necesitan `clubId` en el TOKEN del solicitante.
    Si el custom claim nunca se asigno (o no se propago), las queries de staff
    fallan -> `staffUids=[]` -> los informes colectivos/individuales no llegan.
  - Fix (raiz): nueva Cloud Function `autoSetClaimsOnApproval`
    (`functions/index.js`), trigger `users/{userId}.onWrite`. Cuando cambia
    `isAuthorized`/`status`/`role`/`clubId` y el usuario queda autorizado y
    activo, escribe `role`+`clubId` en los custom claims (idempotente: solo si
    difieren; soporta multi-rol via `allRoles[].clubId`). No hay bucle: setear
    claims afecta a Auth, no dispara otra escritura Firestore.
  - Coexiste con `syncUserChanges` (mismo trigger, responsabilidades distintas:
    notificaciones de borrado + decremento de slots). Deuda menor: dos triggers
    onWrite sobre el mismo doc (2 invocaciones por escritura); aceptable.

- [x] **registerStaffUid (v183)**: Cloud Function invocable de respaldo
  - `functions/index.js`: `registerStaffUid({role, clubId})` valida server-side
    que el solicitante tenga ese rol (raiz o `allRoles[]`) y registra su UID en
    `clubs/{clubId}.directorUids|coordinatorUids` via Admin SDK (ignora reglas).
    Mecanismo de respaldo por si los claims aun no estuvieran disponibles. Sin
    caller en el cliente todavia (infraestructura lista para uso futuro).

- [x] **cronos_staff_registry (v184 -> ELIMINADO v188)**: la coleccion y su
  regla en `firestore.rules` se ANADIERON y luego se RETIRARON: ningun codigo
  JS (desplegado ni en repo) la lee o escribe. `registerStaffUid` registra en
  `clubs/{clubId}.directorUids` (Admin SDK), no en esta coleccion. Dejarla seria
  una puerta de acceso sin proposito; se elimino por higiene de seguridad.

- [x] **Refactor de seguridad (v188)** sobre el WIP v183:
  - `isDirectorOrCoordinator()` hacia **11 get()** al mismo doc -> superaba el
    limite de **10 document-access calls** de Firestore -> la regla habria
    fallado SIEMPRE con PERMISSION_DENIED. Ademas indexaba `allRoles[0..3].role`
    sin comprobar tamano. Se elimino por completo: era el unico consumidor de la
    rama de update en `clubs/{clubId}` que permitia a director/coordinador
    escribir `directorUids/coordinatorUids` desde el cliente, rama que ademas
    abria **escalada cross-club** (un director del club A podia anadirse al club
    B). El registro va EXCLUSIVAMENTE por `registerStaffUid` (Admin SDK), que
    valida el rol server-side. Reglas mas simples y seguras.
  - `firestore.rules` validado con `firebase deploy --only firestore:rules
    --dry-run`: "rules file compiled successfully". `functions/index.js` con
    `node --check` OK y carga real (15 exports, `registerStaffUid` +
    `autoSetClaimsOnApproval` presentes).
  - Pendiente de DESPLIEGUE: `firebase deploy --only firestore:rules,functions`.

## COMPLETADO (live.html — silbato + overlay de fin de parte/partido para espectadores)

- [x] **LIVE-1 (commit `a29356f`)**: replicado el silbato + overlay de fin de 1ª
  parte / fin de partido del entrenador (`_cronosWhistle` /
  `_cronosMatchMomentOverlay` de `js/core/event-listeners.js` y
  `js/match/persistence/active-match.js`) en `live.html` (vista de seguimiento en
  vivo para espectadores), cubriendo TAMBIÉN los partidos en segundo plano.
  - Diseño previo: 5 decisiones de producto cerradas → (1) modo autónomo en
    background cubierto, (2) colisión de overlays = cola FIFO, (3) overlay de
    partido en fondo con equipos + marcador + botón «Ver partido», (4) auto-cierre
    4s (igual que el del entrenador), (5) overlay SIEMPRE visible con modo silencio
    (solo se salta el silbato).
  - Implementación (toda en `live.html`):
    - `_handlePhaseTransition(matchId, matchData)`: punto ÚNICO de decisión.
      Invocado desde el listener visible y el watcher de fondo (ambos vía
      `detectAndAlert`, colocado por ENCIMA del guard `status !== "active"` para
      no perder el FIN de partido, que es justamente `status='finished'`) y desde
      el nuevo timer autónomo.
    - `_effectivePhase(matchData)`: centraliza la inferencia de la fase REAL,
      incluido el modo autónomo (el reloj absoluto `phaseStartedAt` agota la parte
      → `break`/`finished` aunque el entrenador haya cerrado la app y no marque la
      transición). Solo presentación: no escribe en Firestore.
    - `_autonomousPhaseTick` (timer ~1s) + `_matchLastData[matchId]` (cache del
      último snapshot por partido): reevalúa la fase efectiva y dispara
      DESCANSO/FIN aunque dejen de llegar snapshots.
    - `_matchPrevPhase[matchId]`: sembrado SIN disparo la primera vez (mismo patrón
      que `_matchSeeded`); COMPARTIDO entre fondo y visible, por lo que NO se borra
      en `loadMatch`; SÍ se borra al cancelar watchers de partidos terminados
      (`refreshBackgroundWatchers` + `teardownBackgroundWatch`).
    - `_liveWhistle(times)`: sintetizado sobre el `_audioCtx` compartido (con
      keep-alive), NUNCA un `AudioContext` propio (lo que hacía el `_cronosWhistle`
      original y rompería en iOS PWA standalone). Respeta `_alertsMuted` igual que
      `playEventSound`/`_playSeq`.
    - Cola FIFO de overlays (`_momentQueue` + `_momentActive`): dos transiciones
      casi simultáneas (p.ej. dos partidos en fondo) no se pisan; se muestran una
      tras otra.
    - Overlay de partido en fondo: subtítulo con equipos + marcador y botón
      «Ver partido» que navega vía `loadMatch(matchId)`; el partido ya abierto
      (`currentMatchId`) solo cierra, sin botón extra. Auto-cierre 4s.
  - SIN bump de SW: `live.html` se sirve network-first y NO está en `ASSETS`, así
    que la feature llega a los usuarios sin tocar `sw.js`.
  - Verificado: `scripts/_check_html_inline_js.js` (`node --check` del módulo
    inline → OK, 1767 líneas) y `scripts/test_live_phase_transition.js` (extrae los
    cuerpos REALES de `_effectivePhase`/`_handlePhaseTransition` y los ejecuta en
    sandbox → 15/15 OK: siembra sin disparo, 1ªP→DESCANSO silbato×2, 2ªP→FIN
    silbato×3, agotamiento autónomo por reloj, sin duplicado, break→2ªP sin
    disparo, modo silencio, navigable abierto vs fondo, subtítulo con marcador).
  - Nota técnica: `live.html` se normalizó de EOL CRLF→LF en el working tree (git
    ya lo almacenaba como LF), por lo que el diff del commit son +297 líneas puras
    de contenido sin ruido de fin de línea.

## COMPLETADO (auditoría 2026-07-22 — liveMatchId vuelve a ser estable a mitad de partido)

- [x] **P1 (v266C)**: `startLiveSync()` recalculaba el liveMatchId en cada llamada
  para el MISMO partido, reabriendo el riesgo de informes duplicados al padre
  - Causa: el commit `7b0a1f2` ("v266B") quitó la reutilización del `liveMatchId`
    existente en `_cronosBuildLiveMatchId` (`js/core/utils.js`) para que dos
    partidos DISTINTOS el mismo día/equipo/rival no compartieran id (mezclaban
    eventos). El fix era legítimo en la intención, pero el **llamador**
    (`js/match/live/sync.js` → `startLiveSync`) seguía añadiendo un sufijo de
    HORA (`_hourSlug`, calculado con `new Date()`) **en cada invocación**,
    independientemente de si el partido era nuevo o el mismo de antes. Si
    `startLiveSync()` se invocaba dos veces para el mismo partido (reconexión,
    doble disparo entre `goToTitularSelection()`/`startMatchWithConvocation()`,
    o cualquier ruta futura de "resume tras pérdida de cobertura/batería" —
    justo la feature en desarrollo, `retroactive-modal.js`/"PERDIDOS"), el
    `liveMatchId` cambiaba de un minuto a otro dentro del MISMO partido, y con
    él el `matchId` de los informes (derivado de `liveMatchId`) → vuelve el bug
    de informes duplicados al padre, ya corregido dos veces antes (P1 v167/v168).
  - Fix (`js/match/live/sync.js`, función `startLiveSync`): se añade el guard
    `const _isNewMatch = !liveMatchId;`. La construcción del id (con su
    `_hourSlug`), el borrado del array `events` en Firestore y el reset del
    guard de despacho de informes (`_cronosLastDispatchedMatch = null`) quedan
    dentro de `if (_isNewMatch)` — solo ocurren la PRIMERA vez que arranca un
    partido. Si `liveMatchId` ya tiene valor (mismo partido en curso, sync
    reiniciándose), se reutiliza tal cual, sin recalcular nada.
    `_cronosBuildLiveMatchId` (`js/core/utils.js`) se dejó intacto: ya era
    determinista y el problema real estaba en el llamador, no en el builder.
  - Verificado: (1) `node --check` OK; (2) nuevo
    `scripts/test_startlivesync_idempotent.js` (8/8 PASS) — ejecuta el código
    REAL de `startLiveSync` en sandbox: dos llamadas para el mismo partido en
    minutos distintos → mismo `liveMatchId`; tras resetear `liveMatchId=null`
    (partido nuevo de verdad) → id distinto; confirma estructuralmente que el
    guard existe y que el borrado de `events`/`_hourSlug` quedan dentro de él;
    (3) `scripts/test_livematchid_idempotency.js` (ya existente, 10/10 PASS)
    sigue en verde sin cambios — el builder de `utils.js` no se tocó; (4) los
    3 fallos preexistentes de la suite (`test_parent_report_targets.js`,
    `test_timer_color_dom.js`, `test_timer_color_semaforo.js`) se confirmaron
    NO relacionados con este fix: revirtiendo SOLO `js/match/live/sync.js` a
    HEAD (dejando el resto del WIP intacto) siguen fallando igual.
  - Pendiente: commit/deploy — el fix vive en el working tree.

## COMPLETADO (auditoría 2026-07-22 — P11-D: informe colectivo con staff vacío)

- [x] **P11-D (REGRESIÓN REAL EN PRODUCCIÓN, restaurada 2026-07-22)**: el informe
  colectivo NO se enviaba cuando el entrenador no tenía director/coordinador
  asignado — y fallaba EN SILENCIO (sin error visible). Causa: `if (!staff.length)
  { ...; return; }` en `js/coach/comms/panel.js` (`window._sendCollectiveReportNow`)
  abortaba ANTES de escribir los `cronos_player_reports`; el Panel de Dirección se
  alimenta solo de esos docs, así que el partido no aparecía jamás. El fix P11-D
  original (commit `e2189fb`) había quitado ese `return`, pero un "Add files via
  upload" posterior sobrescribió `panel.js` y lo revirtió (detectado al activar
  la suite: `scripts/test_p11d_collective_write.js` llevaba tiempo en rojo/xfail).
  - Fix restaurado (`js/coach/comms/panel.js`):
    1. `window._sendCollectiveReportNow`: eliminado el `return` temprano cuando
       `!staff.length` — ahora solo avisa (`console.warn` + toast distinto) y
       sigue escribiendo los `cronos_player_reports` (visibles por `clubId`).
    2. `_collStaffUids` (colectivo) y `_allStaffUids` (`autoDispatchMatchReports`):
       ambos incluyen SIEMPRE `me.uid` además del staff resuelto (dedupe con
       `Set`), para que la query `array-contains` del Panel de Dirección nunca
       quede vacía aunque el club no tenga staff asignado todavía.
    3. Toast final ajustado para el caso sin staff ("informe guardado, visible
       en el Panel de Dirección" en vez de "enviado a 0 personas").
    4. Logs de diagnóstico `[StaffReport] TOTAL informes ... escritos en
       cronos_player_reports` en ambos caminos (colectivo y auto-despacho).
  - Verificado: `scripts/test_p11d_collective_write.js` pasa 9/9 (antes en rojo
    permanente); retirado de la lista `XFAIL` de `scripts/run-tests.js` (el propio
    runner obliga a esto cuando un XFAIL empieza a pasar — XPASS). Suite completa:
    24/27 activos OK, sin XFAIL ni XPASS pendientes; los 3 fallos restantes
    (`test_parent_report_targets.js`, `test_timer_color_dom.js`,
    `test_timer_color_semaforo.js`) son preexistentes en otras partes del WIP, no
    relacionados con este fix. De paso se corrigió un falso negativo en
    `scripts/test_startlivesync_idempotent.js` (la comparación de "sin
    Math.random()" no normalizaba CRLF antes de quitar comentarios, así que el
    comentario que MENCIONA "Math.random()" como código eliminado nunca se
    recortaba y el test fallaba en falso tras un `git stash`/`pop` que dejó el
    archivo con CRLF).
  - Pendiente: commit/deploy — el fix vive en el working tree.

## COMPLETADO (auditoría 2026-07-22 — borrado masivo de mensajes con auditoría)

- [x] **Borrado sin rastro en `coachDeleteAllMessages`/`ppDeleteAllMessages`**
  - Causa: ambas funciones (nuevas en el WIP de comunicaciones) vaciaban el hilo
    completo de `cronos_messages/{threadId}` con `updateDoc({ messages: [] })`,
    incluidos los mensajes escritos por la OTRA parte (familia↔entrenador de un
    menor), sin `auditLogger` y sin posibilidad de recuperación. Única
    salvaguarda: un `confirm()` de cliente. `window.auditLogger` (clase
    `AuditLogger`, `js/services/audit-logger.js`) no encajaba tal cual: exige
    `matchId` (vía `init(matchId)`) y la Cloud Function `logAuditEntry` valida
    `matchId`+`action` como obligatorios — un hilo de mensajes no tiene
    `matchId`, así que se optó por un registro propio en el propio documento.
  - Fix (`js/coach/comms/panel.js` → `coachDeleteAllMessages`, `js/parent/panel.js`
    → `ppDeleteAllMessages`): antes de vaciar, se lee el hilo (`getDoc`) y se
    archiva su contenido en `deletedMessagesLog` (`arrayUnion`) con
    `deletedBy`/`deletedByEmail`/`deletedByRole`/`deletedAt`/`messageCount`/
    `messages` (los mensajes archivados, no destruidos) — borrado LÓGICO, no
    destructivo. Las reglas de `cronos_messages` (`allow update`) no restringen
    los campos escribibles, así que no hizo falta tocar `firestore.rules`.
  - Verificado con nuevo `scripts/test_delete_all_messages_audit.js` (15/15
    PASS): ejecuta el código REAL de ambas funciones en sandbox — confirma que
    `deletedMessagesLog` archiva los mensajes previos con el conteo correcto y
    la identidad de quien borró, en ambos lados (entrenador y padre).
  - Pendiente: commit/deploy — el fix vive en el working tree.

## COMPLETADO (auditoría 2026-07-22 — replay-player.js: emparejamiento por nombre exacto)

- [x] **Misatribución de eventos en el reproductor de repeticiones**
  - Causa: `js/match/replay/replay-player.js` reconstruía goles/tarjetas/
    entradas-salidas/lesiones emparejando `ev.text.includes(p.name)`. Los
    eventos de partido (`_registerMatchEvent`, `js/match/events/player-actions.js`)
    solo llevan texto libre (p.ej. `'GOL · ' + p.name`), sin `playerId`. Con
    `includes()`, un nombre que fuera subcadena de otro (p.ej. "Ana" dentro de
    "Anabel") misatribuía el evento, y el `forEach` sin `break` aplicaba el
    evento a TODOS los jugadores cuyo nombre encajara a la vez (no solo a uno)
    en tarjetas/cambios/lesiones.
  - Fix (`js/match/replay/replay-player.js`): nuevas `_extractPlayerNameFromEventText`
    (toma el ÚLTIMO segmento tras ' · ' — necesario porque el formato de
    cambio tiene DOS separadores, `'CAMBIO · Entra · ' + nombre`; recorta el
    sufijo entre paréntesis, p.ej. "(doble amarilla)") y `_findPlayerByEventText`
    (busca por IGUALDAD normalizada, no por subcadena, devolviendo como mucho
    un jugador). Los 6 tipos de evento (goal/yellow/red/sub_in/sub_out/injury)
    usan ahora este helper.
  - Verificado con nuevo `scripts/test_replay_player_name_match.js` (13/13
    PASS): ejecuta las funciones REALES en sandbox — confirma que "Anabel" y
    "Ana" ya no se confunden entre sí, que los 4 formatos reales de texto
    (gol, tarjeta con sufijo, cambio con doble separador, lesión) extraen el
    nombre correcto, y que ya no queda ningún `.includes(p.name)` en el código.
  - Limitación residual conocida (no resoluble solo con texto): si dos
    jugadores del mismo partido tienen el nombre COMPLETO idéntico, el emparejamiento
    por igualdad de nombre no puede distinguirlos (ambigüedad real de datos,
    no un bug de este fix). Solución de fondo: que `_registerMatchEvent`
    incluya `playerId`/`playerNumber` en el evento — fuera del alcance de este
    fix puntual (tocaría 4 archivos adicionales que escriben eventos).
  - Pendiente: commit/deploy — el fix vive en el working tree.

## COMPLETADO (2026-07-22 — chats entrenador↔director/coordinador: permisos + estructura)

- [x] **Chat interno roto entre entrenador, director y coordinador**
  ("Missing or insufficient permissions" / "Error al cargar", conversaciones
  que no se veían o se mezclaban entre sí).
  - Logística exigida: Padre↔solo su entrenador; Entrenador↔director+
    coordinador+padres; Coordinador↔director+entrenadores; Director↔
    coordinador+entrenadores; cada destinatario en un chat independiente.
  - **Causa A (estructura/mezcla)**: `js/coach/comms/panel.js` calculaba el
    `threadId` de un hilo entrenador↔staff como `${clubId}_${staffUid}` —
    SIN el uid del propio entrenador, así que TODOS los entrenadores de un
    club que hablaran con el MISMO director/coordinador acababan
    compartiendo un único hilo (mensajes de distintos entrenadores
    mezclados). Además, `js/coach/reports/club-reports.js` (Panel de
    Dirección) calculaba la MISMA relación con una fórmula DISTINTA
    (`${clubId}_${coachUid}`): cada lado escribía en un documento de
    Firestore diferente y la conversación nunca se reconciliaba (el otro
    lado veía "sin mensajes" aunque sí se hubieran enviado).
  - **Causa B (visualización)**: `club-reports.js` reutilizaba (copia-pega)
    la perspectiva `'parent'` y `sender:'parent'` del compositor de padres
    para TODOS los mensajes de staff. Funcionaba por accidente en una
    conversación de 2 partes (entrenador↔un staff), pero: (1) etiquetaba
    SIEMPRE "Padre/Tutor" bajo los mensajes del director/coordinador; (2) en
    una conversación staff↔staff (director↔coordinador) AMBOS lados
    escribían `sender:'parent'`, así que era imposible distinguir quién
    había escrito qué (todo se mostraba como "mío" para ambos).
  - **Causa C (permisos)**: `firestore.rules` → `cronos_messages` no tenía
    ninguna rama que comprobara el campo `staffUid` (solo `coachUid`,
    `parentUid`, `participants` y claims de club), así que el acceso del
    staff dependía enteramente de que `participants` ya incluyera su uid o
    de que sus custom claims (`role`+`clubId`) estuvieran propagados — ambos
    con historial de fallos parciales en este proyecto.
  - **Fix**:
    1. Dos helpers ÚNICOS y compartidos en `js/core/utils.js` (carga antes
       que ambos paneles): `window._cronosStaffChatThreadId(clubId, coachUid,
       staffUid)` (incluye SIEMPRE ambos uids — no colisiona entre
       entrenadores ni diverge entre paneles) y
       `window._cronosPeerChatThreadId(clubId, uidA, uidB)` (par ordenado,
       simétrico, para conversaciones director↔coordinador).
    2. `_cStaffThreadId` (comms/panel.js) y las 2 fórmulas ad-hoc de
       `club-reports.js` (lista de destinatarios + `sdSendBulkMsg`) ahora
       delegan en esos mismos helpers.
    3. `sender`/`senderUid` reales: `sdSendBulkMsg` y `sdSendReplyToCoach`
       (club-reports.js) usan `sender: activeRole` ('director'|'coordinator')
       + `senderUid: me.uid` en vez de `'parent'` hardcodeado. `sendCoachMessage`
       (comms/panel.js) añade `senderUid: me.uid` también.
    4. `_loadThreadMessages` (comms/panel.js, compartida) generalizada:
       `perspective` admite ahora el UID del propio visor (usado por el Panel
       de Dirección) además de los literales clásicos `'coach'`/`'parent'`;
       compara por `senderUid` cuando está disponible, y el label de cada
       burbuja usa un mapa de roles (`Entrenador`/`Padre-Tutor`/`Director
       Deportivo`/`Coordinador`) en vez de la dicotomía binaria anterior.
    5. `firestore.rules` → `cronos_messages`: nueva rama explícita
       `resource.data.staffUid != null && request.auth.uid == resource.data.staffUid`
       en `read`/`create`/`update`/`delete` (mismo patrón ya usado en
       `cronos_player_reports.staffUids`) — respaldo directo que no depende
       de `participants` ni de claims propagados.
    6. Contadores de no-leído (`unreadByStaff`/`unreadByCoach`) corregidos
       para no confundirse en hilos staff↔staff (antes asumían siempre "el
       remitente es staff, el destinatario es coach").
  - Verificado con nuevo `scripts/test_staff_chat_unification.js` (27/27
    PASS): orden de carga en `index.html`, ambos paneles delegan en el mismo
    helper, ejecución REAL de los helpers confirmando que coach y staff
    calculan el MISMO id para su conversación, que dos entrenadores distintos
    con el mismo staff obtienen hilos independientes, y que el hilo
    director↔coordinador es simétrico. `firebase deploy --only
    firestore:rules --dry-run` compila OK.
  - **Aviso importante**: este fix corrige la escritura de mensajes NUEVOS.
    Las conversaciones YA partidas en producción (docs bajo los IDs viejos e
    incompatibles) NO se migran automáticamente — quedan huérfanas en
    Firestore (no se pierden, pero tampoco aparecen ya en la UI). Si hace
    falta recuperar histórico de esos hilos rotos, requiere un script de
    migración aparte (no incluido en este fix).
  - Pendiente: commit/deploy — el fix vive en el working tree.

## COMPLETADO (2026-07-22 — chats: 2ª y 3ª ronda de fixes tras pruebas del usuario)

- [x] **"Missing or insufficient permissions" al abrir una conversación NUEVA**
  (persistía tras desplegar la 1ª ronda de reglas). Causa: `getDoc()` sobre un
  `threadId` que aún no existe (primera vez que dos personas van a hablar)
  hace que `resource` sea `null` en la evaluación de la regla; cualquier rama
  que lea `resource.data.X` (todas, salvo `isSuperAdmin()`) genera un ERROR de
  evaluación, no `false`, y Firestore deniega por defecto. Afectaba a los 4
  roles por igual porque el patrón "leer para comprobar si existe" lo usan
  todas las funciones de envío. Fix: `resource == null ||` añadido al `allow
  read` de `cronos_messages` (seguro: un doc inexistente no tiene datos que
  proteger). Verificado con `scripts/test_staff_chat_unification.js` (28/28
  PASS) y desplegado a producción (confirmado byte a byte contra el ruleset
  activo).

- [x] **Crash "Cannot read properties of undefined (reading 'push')" al abrir
  el Gestor de Contactos (botón CONTACTOS)**
  - Causa: `openContactManager()` (`js/coach/comms/panel.js`) usa en TODO su
    cuerpo la variable GLOBAL `emailConfig` (sin `window.`), declarada con
    `let emailConfig = {...}` en `js/core/app-init.js` **sin** campo
    `contacts`. Los dos guards defensivos al principio de la función solo
    inicializaban `window.emailConfig` — una variable DISTINTA que el resto
    de la función nunca lee (`let` a nivel de script NO cuelga de `window`).
    La ganadora de las 3 copias de `loadEmailConfig`
    (`js/services/firestore-storage.js`) solo rellena `.contacts` si YA hay
    algo guardado en `localStorage`; en cualquier navegador/cuenta que nunca
    haya guardado contactos antes, `emailConfig.contacts` es `undefined` y el
    primer `.push()` (al fusionar los usuarios del club: director,
    coordinador, padres) revienta — por eso el entrenador no podía ver ni
    contactar con ellos.
  - Fix: `if (typeof emailConfig === 'undefined') emailConfig = { contacts: [] };`
    + `if (!emailConfig.contacts) emailConfig.contacts = [];` en la variable
    REAL que usa la función, antes del primer uso.
  - Verificado con nuevo `scripts/test_contact_manager_crash.js` (7/7 PASS):
    ejecuta el código REAL de `openContactManager` en sandbox reproduciendo
    exactamente la condición del bug (sin localStorage previo) y confirma que
    ya no crashea y que director/coordinador se añaden correctamente a la
    lista de contactos.

- [x] **"Los mensajes cruzados siguen sin llegar" — CAUSA CONFIRMADA Y CORREGIDA
  (caso real, no solo de test): una misma cuenta puede tener VARIOS roles a
  la vez** (admin de club que también es director, coordinador, entrenador y
  padre — confirmado por el usuario probando en producción con la cuenta
  arinagazone@..., mismo uid de Firebase Auth para los 4 roles). El threadId
  de `_cronosStaffChatThreadId(clubId, coachUid, staffUid)` dependía solo del
  PAR de uids; en cuanto director y coordinador son la MISMA cuenta,
  "entrenador habla con X-como-director" y "...con X-como-coordinador"
  calculaban el MISMO id (coachUid+staffUid coincidían) → los mensajes de
  ambas conversaciones se mezclaban en un único hilo. Confirmado por el
  propio usuario con un script de diagnóstico contra Firestore real: "los IDs
  calculados se solapan".
  - Fix: 4º parámetro `staffRole` en `_cronosStaffChatThreadId` (y en
    `_cStaffThreadId`) — el id incluye el rol del destinatario staff
    (`_role_director` / `_role_coordinator`), así que aunque coachUid+staffUid
    coincidan, roles distintos generan hilos distintos. Propagado en los 6
    call-sites de `js/coach/comms/panel.js` (incluida una extensión de
    `_msgGetSelected()`/el checkbox de destinatarios masivos para leer
    `data-role`, que antes no existía) y los 2 de `js/coach/reports/club-
    reports.js` (usando `activeRole`, el rol con el que el staff está
    actuando).
  - Verificado con `scripts/test_staff_chat_unification.js` ampliado (36/36
    PASS): confirma que la MISMA cuenta actuando como director vs como
    coordinador produce hilos DISTINTOS, que el caso normal (roles = personas
    distintas) sigue funcionando igual que antes, y que los 8 call-sites
    reales pasan el rol correctamente.
  - **Aviso**: los 2 hilos de prueba ya creados en Firestore por el usuario
    (bajo el ID viejo, sin rol) quedan huérfanos — hay que enviar mensajes
    NUEVOS tras este fix para que se cree el hilo correcto por rol. Es JS
    puro (sin cambios en `firestore.rules`), así que no requiere un nuevo
    `firebase deploy --only firestore:rules` — basta recargar la app.

- [ ] **(histórico) "Los mensajes cruzados siguen sin llegar" — en investigación**. Tras
  las correcciones de ID/sender/permisos (rondas anteriores), la lógica de
  enrutamiento se verificó consistente por análisis estático completo
  (mismo threadId desde ambos lados, mismo campo `senderUid`, misma regla).
  Hallazgo relevante: **ningún panel de mensajería usa `onSnapshot`** (0
  listeners en tiempo real en comms/panel.js, club-reports.js, parent/panel.js
  — confirmado por grep) — todo son lecturas puntuales (`getDoc`/`getDocs`).
  Si el usuario prueba con dos sesiones abiertas simultáneamente esperando
  entrega en vivo, o sin recargar/reabrir la conversación tras que la otra
  parte envíe, el síntoma sería exactamente "el mensaje no llega" sin ser un
  bug de enrutamiento. Pendiente de confirmar con el usuario la metodología
  de prueba antes de decidir si hace falta añadir listeners en tiempo real
  (cambio mayor, no incluido en este fix) o si el bug persiste incluso
  recargando.

## COMPLETADO (2026-07-23 — chats: 4ª ronda, auto-open con uno mismo bajo otro rol)

- [x] **"No hay conexión ni se cruzan los mensajes" entre Entrenador↔Director,
  Entrenador↔Coordinador, Director↔Coordinador — CAUSA REAL: auto-open roto,
  NO enrutamiento**. El propio usuario confirmó con un diagnóstico contra
  Firestore real que los documentos SÍ se creaban correctamente (sender,
  senderUid y rol correctos en los 7 hilos de su cuenta) — el problema estaba
  en la INTERFAZ, no en los datos.
  - Causa: el auto-open del primer hilo en `_sdLoadMessages`
    (`js/coach/reports/club-reports.js`) buscaba "el otro participante" con
    `first.participants.find(p => p !== me.uid) || ''`. El usuario prueba con
    UNA cuenta que tiene VARIOS roles (director, coordinador, entrenador,
    padre — mismo uid de Firebase Auth para todos, ver ronda anterior sobre
    `staffRole`). Un hilo "consigo mismo bajo otro rol" tiene
    `participants=[uid, uid]` (ambos el MISMO valor) — `.find(p => p !== me.uid)`
    no encuentra nada, `otherUser` sale `undefined`, y el auto-open no muestra
    ningún hilo por defecto. Si el usuario no hace clic manual en el contacto
    (esperando que se abra solo, como con conversaciones normales entre dos
    personas distintas), ve el placeholder vacío y parece que "el mensaje no
    llegó" aunque el documento existe y está bien formado.
  - Fix: fallback a `me.uid` (uno mismo) en vez de cadena vacía —
    `first.participants.find(p => p !== me.uid) || me.uid`. Con eso,
    `otherUser` encuentra la entrada "yo mismo, etiquetado con el otro rol"
    (ya presente en la lista gracias al manejo `isSelf` de `_sdLoadMessages`)
    y el auto-open funciona igual que con dos personas distintas.
  - Verificado con nuevo `scripts/test_selfmessage_autoopen.js` (4/4 PASS).
  - **Nota para el usuario**: aunque el auto-open ahora funciona, sigue
    siendo buena práctica hacer clic manual en el contacto concreto tras
    cambiar de rol, ya que el auto-open solo abre el hilo MÁS RECIENTE
    (`threads[0]`), no necesariamente el que se acaba de comprobar.
  - Pendiente: commit — el fix vive en el working tree (es JS puro, sin
    cambios en `firestore.rules`, no requiere nuevo deploy).

## COMPLETADO (2026-07-23 — chats: 5ª ronda, panel de conversación no se reseteaba al cambiar de pestaña)

- [x] **"Los mensajes al director y al coordinador se mezclan en el mismo hilo"
  — CAUSA REAL CONFIRMADA (fallo de ESCRITURA, no de lectura)**. El usuario
  confirmó con un diagnóstico contra Firestore real que "hola señor director"
  y "hola señor coordinador" (enviados desde el rol de entrenador, a
  destinatarios distintos) acababan literalmente en el MISMO documento
  (`..._role_director`).
  - Causa: `js/coach/comms/panel.js` tiene pestañas (Padres/Director/
    Coordinador) en el panel de mensajería del entrenador. Cambiar de
    pestaña (`_loadStaffList('coordinator')` tras haber estado en
    `'director'`) refresca la LISTA de contactos de la izquierda
    (`#coach-parent-list`), pero **nunca reseteaba el panel de conversación
    de la derecha** (`#cm-chat-thread-pane`). Si el entrenador abría la
    conversación con el Director, enviaba un mensaje, cambiaba a la pestaña
    Coordinador SIN hacer clic en el contacto del coordinador, y escribía
    directamente en el textarea que seguía visible (de la conversación con
    el director), el mensaje se enviaba con el `threadId` VIEJO — incrustado
    en ese textarea desde que se abrió la conversación con el director — sin
    que el cambio de pestaña lo actualizara.
  - Fix: nueva función `_resetChatThreadPane()` — vuelve al placeholder
    "Selecciona un contacto..." cada vez que se cambia de pestaña
    (`_loadStaffList` y `_loadParentList`), obligando a un clic explícito en
    el contacto correcto antes de poder escribir. Así es estructuralmente
    imposible enviar un mensaje al destinatario equivocado por tener el
    textarea de otra conversación todavía abierto.
  - Verificado con nuevo `scripts/test_stale_chat_pane_reset.js` (7/7 PASS):
    ejecuta el código real y confirma que, tras el reset, el pane ya no
    contiene el `threadId` antiguo ni ningún `<textarea>`/`onkeydown` activo.
  - Pendiente: commit — el fix vive en el working tree (JS puro, sin cambios
    en `firestore.rules`).

## COMPLETADO (2026-07-23 — chats: 6ª ronda, `_cGetStaff` ignoraba el rol pedido por pestaña)

- [x] **"Los mensajes al director y al coordinador se cruzan y mezclan" —
  CAUSA RAÍZ REAL, confirmada tras descartar caché del navegador** (el
  usuario verificó con un script de consola que su navegador ejecutaba el
  código v349 correcto — SW activo, `_resetChatThreadPane` presente, fetch
  directo al servidor con el fix por rol — así que las rondas anteriores
  quedaron correctamente desplegadas, pero no eran la causa completa).
  - Causa: `_cGetStaff(db, clubId, fns, roles)` (`js/coach/comms/panel.js`)
    tiene 3 fuentes que alimentan la lista de staff. La "REGLA 1" (director/
    coordinador reciben SIEMPRE el informe colectivo) filtraba
    `emailConfig.contacts` con `c.role === 'director' || c.role === 'coordinator'`
    **sin comprobar `roles.includes(c.role)`** — a diferencia de las otras 2
    fuentes, que sí lo hacían. `_cGetStaff` se llama de dos formas: (a) SIN
    roles (por defecto `['director','coordinator']`, para el despacho de
    informes colectivos — ahí REGLA 1 es correcta tal cual, quieres AMBOS
    roles); (b) con `roles=[selectedRole]` desde cada pestaña de mensajería
    1:1 del entrenador (SOLO 'director' o SOLO 'coordinator'). Una cuenta con
    VARIOS roles a la vez (director Y coordinador, MISMO uid — caso real del
    usuario) tiene UNA sola ficha en Gestión de Contactos (una fila por
    documento `users/{uid}`, no una por rol) con un ÚNICO campo `role`
    guardado. REGLA 1 colaba esa ficha en la pestaña "Director" igualmente
    (o en la de "Coordinador"), etiquetada con el rol EQUIVOCADO (el que
    tuviera guardado en Contactos, no el de la pestaña activa) — el mensaje
    se enviaba entonces con el `threadId` de ese rol incorrecto.
  - Fix: añadido `&& roles.includes(c.role)` a REGLA 1, igual que ya tenían
    las otras 2 fuentes de `_cGetStaff`. El caso por defecto (informes
    colectivos, sin filtro de rol) sigue trayendo ambos roles sin cambios.
  - Verificado con nuevo `scripts/test_cgetstaff_role_filter.js` (6/6 PASS):
    ejecuta el código REAL de `_cGetStaff` reproduciendo el escenario exacto
    (una cuenta con `allRoles` = [director, coordinator] y una ficha de
    contacto con un único rol guardado) — confirma que la pestaña Director ya
    NO cuela la etiqueta 'coordinator' (ni viceversa), y que el despacho de
    informes colectivos sigue trayendo ambos roles correctamente.
  - Pendiente: commit — el fix vive en el working tree (JS puro).

## COMPLETADO (2026-07-23 — chats: 7ª ronda, threadId calculado con la pestaña cruda en vez del contexto canónico)

- [x] **"Los mensajes entre roles no llegan/se cruzan" — CAUSA REAL: el sistema de
  mensajería unificado (`_umState`/`_resolveThreadDoc`/`_cThreadId`, que reemplazó
  la arquitectura de las rondas 1-6 documentadas más abajo) ya implementaba casi
  todo lo pedido en `mensajes.txt` (pestañas por rol, filtro estricto de
  categoría/subcategoría para padres, ámbito F7/F11 para coordinadores vía
  `_coordinatorCoversModality`), pero el camino ACTIVO de lectura/escritura tenía
  un bug estructural que fragmentaba cada conversación en varios documentos.**
  - Causa: `_selectUnifiedContact`, `_loadUnifiedThreadMessages` (indirectamente,
    vía el `threadId` que recibe) y `_sendUnifiedMessage`/`_openUnifiedBulkComposer`
    (`js/coach/comms/panel.js`) calculaban el `threadId` con
    `_cThreadId(uidA, uidB, window._umState.activeTab)` usando la pestaña CRUDA
    de quien mira — pero la MISMA relación se ve desde pestañas con nombres
    distintos según el rol: el entrenador ve la pestaña `'director'` para hablar
    con el director, mientras que el propio director ve la pestaña `'coaches'`
    para hablar con entrenadores. Con la pestaña cruda, `_cThreadId(C,U,'director')`
    (lado del entrenador) y `_cThreadId(U,C,'coaches')` (lado del director) daban
    IDs distintos para la MISMA conversación → cada lado escribía/leía un
    documento de Firestore diferente, y el otro no encontraba los mensajes. La
    función `_getCanonicalContext(role, tab)` que resuelve esto YA EXISTÍA en el
    archivo (usada dentro de `_resolveThreadDoc`), pero el camino activo de
    enviar/abrir un hilo no la llamaba — `_resolveThreadDoc` estaba prácticamente
    muerto (solo lo usa `_clearUnifiedThread`).
  - Fix (`js/coach/comms/panel.js`, 4 puntos): `_loadUnifiedContactList` (preview
    de la lista de contactos), `_selectUnifiedContact` (abrir el hilo),
    `_sendUnifiedMessage` y `_openUnifiedBulkComposer` (envío individual y
    grupal) ahora calculan `tabContext`/`threadId` con
    `_getCanonicalContext(window._umState.role, tab)` antes de pasarlo a
    `_cThreadId`, en vez de la pestaña cruda.
  - Verificado con nuevo `scripts/test_role_thread_canonical.js` (11/11 PASS):
    confirma en el código real que los 4 call-sites canonicalizan, y ejecuta
    `_getCanonicalContext`+`_cThreadId` extraídos del archivo real simulando:
    entrenador↔director, entrenador↔coordinador, director↔coordinador y
    padre↔entrenador calculan el MISMO id visto desde ambos lados; el caso real
    reportado (una cuenta con el mismo uid actuando de director Y de coordinador
    con el mismo entrenador) sigue dando hilos DISTINTOS; dos entrenadores
    distintos con el mismo director siguen aislados entre sí. Suite completa:
    22/36 activos OK (mismo conjunto de 14 fallos preexistentes que ya fallaban
    antes de este fix, correspondientes a tests de la arquitectura de
    mensajería ANTERIOR —tabs con `_msgGetSelected`/`_cStaffThreadId`,
    `sdSendBulkMsg`, etc.— que ya no existe en el código: fue sustituida por
    este sistema unificado `_umState`. Esos tests quedan obsoletos, no
    reflejan una regresión de este fix).
  - **Aviso**: igual que en rondas anteriores, los hilos YA creados en Firestore
    con el id "de pestaña cruda" (antes de este fix) quedan huérfanos — hace
    falta enviar un mensaje NUEVO en cada conversación para que se cree bajo el
    id canónico correcto. Es JS puro, sin cambios en `firestore.rules`.
  - Pendiente: commit/deploy — el fix vive en el working tree.

## PENDIENTE (empezar por E6)

- [ ] **E6**: Crono live sin progreso segundo a segundo
- [ ] **E7**: Tiempos con redondeo en informes
- [ ] **E8**: Zoom deshabilitado
- [ ] **E9**: Vista vertical móvil

## Notas técnicas

- Sin trackear: `firestore.rules.BACKUP` (no incluido en commits).
- Avisos Firebase no bloqueantes: `firebase-functions` desactualizado; `functions.config()` deprecado (límite marzo 2027).
- Entorno Windows: cmd requiere `chcp 65001` por acentos en la ruta del proyecto.

## Deuda de seguridad (preexistente, a revisar)

- [x] **SEC-C4 — `transitionalRead()` sin comprobar propiedad de club: CERRADO (2026-07-22, sin desplegar todavía)**.
  Detectado en la auditoría general de 2026-07-22 (`AUDITORIA_GENERAL_2026-07-22.md`, hallazgo #1),
  mientras `transitionalRead()` estaba siendo RESTAURADA en el WIP sin commitear (había sido
  eliminada antes por ser "un backdoor por diseño", ver nota histórica más abajo en este mismo
  archivo). La restauración ("Opción B") arregló que la ventana de gracia fuera renovable con
  logout+login (mide desde `users/{uid}.createdAt` en vez de `auth_time`), pero **no comprobaba
  que el `clubId` del documento objetivo perteneciera al propio usuario** — solo exigía `clubId !=
  null` en el documento. Durante los 5 minutos posteriores a CUALQUIER registro nuevo, esa cuenta
  podía leer/escribir documentos de **cualquier otro club** (equipos, jugadores, entrenamientos,
  partidos, mensajes, `cronos_player_links`, `individuals`...) en las ~15 colecciones donde esta
  rama se usa como `OR`. Afecta datos de menores (nombres, dorsales, fotos).
  **Fix** (`firestore.rules`, función `transitionalRead(clubId)`): se añade
  `get(users/{uid}).data.clubId == clubId`, el mismo check que ya usa `userDocClubId()` para
  usuarios con claims. La ventana de gracia ahora solo cubre el club al que el usuario dice
  pertenecer (su propio `users/{uid}.clubId`), nunca uno ajeno. Los tres `get()` a `users/{uid}`
  dentro de la función se resuelven a una sola lectura facturada (mismo documento, memoizado por
  Firestore dentro de una misma evaluación de reglas).
  **Verificado**: (1) `firebase deploy --only firestore:rules --dry-run` → "rules file
  firestore.rules compiled successfully"; (2) `scripts/test_sec_transitionalread_clubid.js` —
  16/16 PASS: estructura de la función (clubId propio exigido, resto de guards intactos) +
  simulación del predicado en 8 escenarios (hueco cross-club cerrado con/sin club propio, flujo
  legítimo del usuario recién registrado intacto, ventana expirada deniega, usuario con claims no
  depende de este helper, `users/{uid}` inexistente deniega, `createdAt` legacy no-timestamp
  deniega, `clubId` de documento null deniega).
  **Pendiente**: desplegar (`firebase deploy --only firestore:rules`) — el fix vive en el working
  tree, todavía sin commitear ni desplegar a producción.

- [x] **SEC-C2 — `live_matches` borrable por cualquier autenticado si `clubId == null`: CERRADO Y VERIFICADO EN PRODUCCIÓN (2026-07-16)**.
  La regla `allow delete` de `match /live_matches/{matchId}` incluía la rama
  standalone `resource.data.clubId == null`, que permitía a **cualquier usuario
  autenticado** borrar un partido en vivo sin `clubId` (docs con PII de menores:
  nombres, dorsales, colores) — un usuario del club B podía borrar el huérfano de
  un coach del club A. Era **preexistente** (NO la introdujo la feature v274 de
  borrado de huérfanos; v274 solo añadió las ramas `createdBy==uid` y
  `coachEmail==token.email`).
  **Fix**: se ELIMINÓ la rama standalone `clubId == null`. El caso legítimo (el
  coach limpia SU propio partido sin club) sigue cubierto por `createdBy==uid` y
  `coachEmail==token.email`, que NO llevan gate de `clubId`: `sync.js` SIEMPRE
  escribe `createdBy` con el uid del propio coach y la query de recuperación
  (`setup-modal.js`) filtra por `createdBy==me.uid`, así que el flujo de borrado
  del coach NO se rompe. Los huérfanos legacy SIN `createdBy`/`coachEmail`
  (pre-v274) solo los limpia ya el SuperAdmin (el barrido cliente
  `cleanupStaleMatches` >7 días fallará sobre docs ajenos, que quedan para el SA),
  evitando el borrado cruzado entre clubes.
  **Verificación** (el emulador sigue bloqueado por entorno: solo JDK 8, exige
  JDK≥21): (1) `scripts/test_sec_c2_live_delete.js` — 21/21 PASS: parser
  estructural del `allow delete` desplegado + simulación del predicado en 9
  escenarios (hueco cerrado en a/b/f/h; flujos legítimos c/d/e/g intactos) +
  comprobación de que el cliente escribe `createdBy`; (2)
  `scripts/verify_sec_c2_prod.js` — 10/10 PASS: el ruleset ACTIVO del proyecto
  (`cronos-futbol-app`, ruleset `6391f0e3…`, updateTime 2026-07-16T23:34:41Z) ya
  NO contiene la rama `clubId == null` en el `allow delete` de `live_matches` y
  COINCIDE byte a byte (normalizado) con `firestore.rules` local; (3) `firebase
  deploy --only firestore:rules` compiló y publicó OK.


- [ ] **SEC-C3 — test de comportamiento del emulador PENDIENTE (bloqueado por
  entorno)**: el commit `a39c2bd` cerró el hueco de `create`/`update` abiertos a
  `if isAuth()` en `match /live_matches/{matchId}`. Verificación ya realizada:
  (1) compilación remota OK vía `firebase deploy --only firestore:rules
  --dry-run` → "rules file firestore.rules compiled successfully"; (2) validación
  estructural (llaves/paréntesis balanceados, una sola regla por verbo, sin
  `if isAuth();` residual). **QUEDA PENDIENTE** el test de comportamiento real con
  el emulador de Firestore + `@firebase/rules-unit-testing` para los 5 casos:
  (a) coach del club A → `update` de partido con `clubId` del club B → DENY;
  (b) coach del club A → su propio partido (`sameClub`/`userDocClubId`) → ALLOW;
  (c) coach sin `clubId` en token pero `users/{uid}.clubId` coincide → ALLOW;
  (d) coach con `clubId:null` + `createdBy==uid` (legacy) → ALLOW; (e) superadmin
  → ALLOW. **Motivo del bloqueo**: (1) solo hay JDK 8 instalado y el emulador de
  firebase-tools 15.x exige JDK ≥ 21; (2) en este entorno TODAS las descargas de
  Internet están bloqueadas (curl a google.com, adoptium.net y registry.npmjs.org
  devuelven HTTP `000`), por lo que NO se puede instalar JDK 21 ni el paquete
  `@firebase/rules-unit-testing`. Traza estática (no sustituye al test): los 5
  casos dan el resultado esperado; **matiz a revisar en el test**: el caso (a) es
  DENY para `update` (hueco principal cerrado), pero para `create` un coach podría
  crear un doc con `clubId=B` si además pone `createdBy=su_propio_uid` (pasa por la
  rama `createdBy==uid`); solo puede crear docs que él mismo posee, pero valdría la
  pena decidir si se restringe también ese "spoof" de creación cross-club. Ejecutar
  el test en una máquina con JDK 21 + acceso a npm antes de dar por cerrado SEC-C3.

- [x] **SEC-C1 (update): CERRADO Y VERIFICADO EN PRODUCCIÓN (2026-07-16)**. La
  rama `allow update` de `users/{userId}` tiene `clubId` en la lista PROHIBIDA de
  `hasAny()`; el cliente ya no puede escribir su propio `clubId` bajo ningún caso.
  La migración del `clubId` a la raíz la hace EXCLUSIVAMENTE el Admin SDK: el
  SuperAdmin, la Cloud Function `syncRootClubId()` (valida server-side que el
  clubId pertenece al usuario) o el trigger `autoSetClaimsOnApproval` (lo puebla
  al aprobar). Verificación FINAL en producción (`scripts/verify_sec_c1_prod.js`,
  9/9 PASS): (1) el ruleset ACTIVO del proyecto `cronos-futbol-app` (release
  `cloud.firestore`, ruleset `017c55fb…`, updateTime 2026-07-16T12:15:42Z) se
  descargó vía la Rules REST API y contiene `clubId` en la lista prohibida;
  (2) la fuente desplegada COINCIDE byte a byte (normalizada) con `firestore.rules`
  local → no hay cambios sin desplegar; (3) `firebase deploy --only firestore:rules
  --dry-run` compila OK; (4) las 3 CF de las que depende el fix están DESPLEGADAS
  (`syncRootClubId` callable, `autoSetClaimsOnApproval` document.write,
  `registerStaffUid` callable); (5) `scripts/test_sec_c1_clubid.js` con el código
  real de las CFs + reglas da 26/26 PASS.

- [ ] **SEC-C1 (create): pendiente (riesgo residual BAJO)**. Bloquear `clubId` en
  el `create` de `users/{userId}` se REVIRTIÓ (commit `f3444df`) porque el alta de
  usuarios individuales escribe legítimamente `clubId = _entityId` en el propio
  create (`services/auth.js:1879,1893`) para que el panel del SuperAdmin y el
  descubrimiento de pendientes por club_admin funcionen (queries `where('clubId','==',…)`).
  Nulificarlo en el alta exige rediseñar ese descubrimiento primero. **Por qué el
  riesgo residual es BAJO aun sin cerrar el create**: (a) el `create` solo permite
  al usuario crear SU PROPIO doc (`request.auth.uid == userId`), no el de otro;
  (b) fijar un `clubId` ajeno en el alta NO concede acceso efectivo por sí solo:
  las reglas sensibles cruzan `isAuthorized`/`status` de la RAÍZ, que el usuario
  NO puede escribir (siguen prohibidos en create+update), y esos campos solo los
  activa el SuperAdmin vía Admin SDK en la aprobación; (c) `userDocClubId()` da
  lectura del club, pero el vector real de escalada (escribir informes/mensajes
  cross-club) requiere además pasar el resto de gates. **No tocar sin analizar
  `js/coach/comms/panel.js` (descubrimiento) y el flujo de aprobación completo.**

## Mejoras opcionales aparcadas

- [ ] **Q2 — guard `_seededOnce[matchId]` en live.html (aparcado)**: limitar el
  repintado destructivo de `_loadMatchEventsFromSnapshot` (que hace
  `listEl.innerHTML=''` + `_matchEventsLog=[]`) a UNA sola vez por partido, para
  que no vuelva a borrar el HTML coloreado que `detectAndAlert` pinta en vivo
  despues. Diseno: declarar `const _matchEventsSeeded = {}` junto a los otros
  mapas por matchId (~L1046), consultarlo/marcarlo en el "Sitio A" de
  `renderMatch` (~L2385), y `delete _matchEventsSeeded[matchId]` al cambiar de
  partido en `loadMatch` (~L2190). NO aplicado a proposito: eliminaria la red de
  re-sync de v235 (`snapshotCount > localCount`), util si un espectador pierde
  eventos con la pestana en background. Revisar SOLO si en pruebas reales se
  detecta parpadeo o borrado del panel de historial. Con el fix del commit
  `9d24a6c` (shape unificado del arrayUnion), cada evento nuevo ya llega por
  `detectAndAlert`, por lo que el re-sync destructivo es redundante en el flujo
  normal; por eso queda como mejora opcional y no como bug abierto.

## Regresiones detectadas por la suite de tests

- [x] **P11-D — informe colectivo con staff vacío ABORTA la escritura de
  `cronos_player_reports` — CORREGIDO 2026-07-22 (ver "COMPLETADO (auditoría
  2026-07-22 — P11-D...)" más arriba; detalle histórico de la regresión abajo)**.

  **Qué falla**: `scripts/test_p11d_collective_write.js` (exit 1). El test NO se ha
  tocado a propósito: refleja un bug real, no una aserción obsoleta.

  **Evidencia — el guard de staff vacío existe y hace `return` (cita textual,
  `js/coach/comms/panel.js`, función `window._sendCollectiveReportNow`, líneas
  4110-4114)**:

  ```js
  if (!staff.length) {
      if (typeof hideSpinner==='function') hideSpinner();
      if (typeof showToast==='function') showToast('⚠️ Sin directores/coordinadores asignados', 3000);
      return;
  }
  ```

  Ese `return` (línea 4113) aborta ANTES del bucle que escribe los documentos
  `cronos_player_reports` (a partir de la línea ~4137). El Panel de Informes de
  Dirección se alimenta EXCLUSIVAMENTE de esos documentos, así que si el
  entrenador no tiene director/coordinador asignado, el partido nuevo NO aparece
  nunca en el panel.

  **Qué se perdió y dónde**: el fix P11-D original (commit `e2189fb`,
  "fix(P11-C/P11-D): el Panel de Informes ahora recibe los partidos nuevos del
  staff") reescribió esa función en el MISMO archivo `js/coach/comms/panel.js`
  para:
  1. **NO hacer `return`** con staff vacío (solo avisar y seguir escribiendo los
     informes, visibles por `clubId`). En `e2189fb` el guard era, textualmente:
     `if (!staff.length) { console.warn('[StaffReport] Lista de staff vacía: se
     escriben los informes igualmente...'); showToast('⚠️ Sin destinatarios
     directos; el informe se guardará para Dirección', 3500); }` — SIN `return`.
  2. Construir `_collStaffUids = Array.from(new Set([...staff.map(s=>s.uid)
     .filter(Boolean), me.uid].filter(Boolean)))` para incluir SIEMPRE al propio
     entrenador (`me.uid`) como red de seguridad, y usarlo en `staffUids:
     _collStaffUids` (así la query `array-contains` nunca queda vacía).
  3. Logs de diagnóstico `[StaffReport] TOTAL informes colectivos escritos en
     cronos_player_reports`.

  El código actual **no contiene** ninguno de los tres: reintrodujo el `return`
  temprano, usa `staffUids: staff.map(s => s.uid).filter(Boolean)` (línea 4150,
  SIN el `me.uid` de seguridad) y no tiene los logs TOTAL. La causa es que un
  commit posterior de tipo "Add files via upload" **sobrescribió**
  `js/coach/comms/panel.js` y revirtió el fix P11-D (no fue un refactor
  intencionado; el símbolo `_collStaffUids` no aparece en ningún commit posterior
  a `e2189fb`).

  **Verificación de la evidencia**: `git log --all -S "_collStaffUids"` → solo
  `e2189fb`; `git show e2189fb:js/coach/comms/panel.js` contiene el guard sin
  `return` + `_collStaffUids` + logs TOTAL; el archivo actual (líneas 4110-4114 y
  4150) contiene el `return` y el `staffUids` sin `me.uid`.

  **Decisión histórica** (tanda anterior): NO se forzó el pase del test ni se
  parcheó el producto en su momento; quedó como regresión abierta con el test
  marcado `xfail` en `scripts/run-tests.js` para que siguiera VISIBLE sin
  bloquear el resto de la suite.

  **Cierre (2026-07-22)**: restaurados los 3 puntos que perdió el "Add files via
  upload" (guard sin `return`, `_collStaffUids`/`_allStaffUids` con `me.uid`,
  logs TOTAL) — más el mismo tratamiento aplicado también a `_allStaffUids` en
  `autoDispatchMatchReports` (que el fix original `e2189fb` no cubría, pero el
  test sí lo exige). `test_p11d_collective_write.js` pasa 9/9 y se retiró de
  `XFAIL` en `scripts/run-tests.js`.

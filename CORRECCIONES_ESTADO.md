# Cronos Fútbol — Estado de correcciones

_Última actualización: 2026-06-01 (sesión E5 — cerrada). Próxima sesión: empezar por E6._

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

## PENDIENTE (empezar por E6)

- [ ] **E6**: Crono live sin progreso segundo a segundo
- [ ] **E7**: Tiempos con redondeo en informes
- [ ] **E8**: Zoom deshabilitado
- [ ] **E9**: Vista vertical móvil

## Notas técnicas

- Sin trackear: `firestore.rules.BACKUP` (no incluido en commits).
- Avisos Firebase no bloqueantes: `firebase-functions` desactualizado; `functions.config()` deprecado (límite marzo 2027).
- Entorno Windows: cmd requiere `chcp 65001` por acentos en la ruta del proyecto.

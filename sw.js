// ─────────────────────────────────────────────────────────────
//  CRONOS FUTBOL - Service Worker v229
//  v299 (cache): Unificado el render del aviso de entrenamiento
//        (planificacion_semanal) en un helper compartido
//        _cronosRenderTrainingWeekCards (js/shared/whatsapp-email.js).
//        El panel de padres dejaba de mostrar una tabla vertical y ahora
//        usa las mismas tarjetas horizontales con scroll lateral que el
//        panel de coordinador/director. Bump para forzar recarga del JS.
//  v229: FIX v221 - sincronización de umbrales del semáforo entre
//        coach y live.html:
//        · pushLiveSnapshot ahora lee DIRECTAMENTE clubs/{clubId}.timerThresholds
//          de Firestore (con caché 60s) en vez de fiarse de window._clubTimerThresholds
//          que podía ser null o estar desactualizado.
//        · live.html añadido fallback asincrónico: si el snapshot llega sin
//          timerThresholds, lee clubs/{clubId} directamente y re-renderiza.
//        Esto garantiza que el live SIEMPRE aplique los umbrales configurados
//        por el Director Deportivo, aunque los haya cambiado a mitad de partido.
//  v228: FIX v220 - dos bugs críticos:
//        1) Panel "en vivo" solo mostraba 5 cambios aunque se hiciesen 7:
//           · Subido el límite de toasts simultáneos de 5 a 15.
//           · Añadido panel persistente "HISTORIAL DEL PARTIDO" que acumula
//             TODOS los eventos (goles/tarjetas/lesiones/cambios) en una
//             lista no efímera en la parte inferior de la pantalla.
//        2) Colores del cronómetro distintos en panel entrenador vs "en vivo":
//           · tickPlayerTimes ahora recalcula el color en cada tick 250ms
//             (antes solo actualizaba el texto; el color iba retrasado 5s).
//           · getTimerColor en app-init.js usa fallback mode-aware
//             (F7=1800+1800=3600, F11=2400+2400=4800) consistente con live.html.
//           · sync.js envía half1MaxTime/half2MaxTime >0 (antes enviaba 0
//             si el global era 0, y live caía a defaults distintos del coach).
//           · renderPlayers() llama colorAllTimers() sincrónicamente para
//             evitar la ventana de 1s donde los chips mostraban los colores
//             por defecto del CSS (amarillo #ffde59) en lugar del semáforo.
//  v227: FIX v219 - inversión de flechas de sustitución:
//        · ▼ verde = ENTRA al campo (señala el campo hacia abajo).
//        · ▲ roja = SALE del campo (señala hacia fuera, hacia arriba).
//        Motivo: el toast aparece arriba a la derecha, así que ▼ señala
//        el campo (entra) y ▲ señala fuera (sale).
//  v226: FIX v218 - formato de mensajes de eventos:
//        · Sin '#' antes del dorsal del jugador (solo nombre).
//        · Palabras GOL/TARJETA/LESIÓN/CAMBIO en MAYÚSCULAS con color
//          (verde/amarillo/rojo/rojo/azul respectivamente) en HTML.
//        · Flecha ▲ verde = ENTRA al campo; flecha ▼ roja = SALE del campo.
//        · Texto plano (WhatsApp/email) usa emojis + MAYÚSCULAS.
//  v225: FIX v217 - semaforo respeta umbrales del Director Deportivo
//        (patches.js ya no pisa window.getTimerColor; live.html lee
//        data.timerThresholds del snapshot) + checkbox per-partido del
//        modal de informes se respeta ESTRICTAMENTE (authorizedIds en
//        _cronosResolveParentReportTargets y autoDispatch FASE A/B).
//  v224: Banquillo en flujo flex (no fixed) - campo se ajusta solo, sin solapamiento
//  v216: Bump tras feat del silbato de arbitro + overlay de fin de parte/partido
//         (js/core/event-listeners.js: _cronosWhistle, _cronosMatchMomentOverlay;
//         enganche en endMatch de active-match.js) y fix de no pausar el cronometro
//         al volver al setup en modo autonomo (movement-log.js). Invalida el precache.
//  v215: Bump tras fix de emparejado de sustituciones simultaneas por subId en
//         el informe colectivo (coach/reports/club-reports.js) + captura de subId
//         en _parseHistoryForFirestore (coach/comms/panel.js). Invalida el precache
//         para servir el club-reports.js corregido en vez de la version con el bug.
//  v214: Bump tras fix de duplicado Solicitudes de Registro / Nuevos Roles Solicitados (panel.js).
//  v211: Panel del SuperAdmin â€” saClubs() y saShowEntityUsers() ahora
//         renderizan el arbol jerarquico Categoria/Subcategoria (solo
//         lectura) via window.renderCategoryTreeReadOnly, en lugar de la
//         lista plana. Helper compartido en js/admin/shared/category-tree.js
//         (modo club con bloque Staff; modo individual sin Staff). Bump
//         fuerza recarga de js/admin/superadmin/superadmin.panel.js y del
//         nuevo js/admin/shared/category-tree.js.
//  v209: Panel del Club — dentro de cada Subcategoria, la lista de usuarios
//         pasa a columnas alineadas: Rol · Nombre · Email · Fecha (+acciones),
//         con fila de cabecera. "Nombre" muestra solo el nombre de pila
//         (firstName, con fallback a displayName.split(' ')[0]). Bump fuerza
//         recarga de js/admin/club/panel.js.
//  v208: Panel del Club — la lista plana de "Usuarios del Club" pasa a un
//         arbol jerarquico: bloque Staff fijo (Director + Coordinadores con
//         su modalidad F7/F11/F7&11) y 7 Categorias x 3 Subcategorias
//         plegables (Entrenadores/Padres por grupo). Selector CSS de hijo
//         directo para soportar el plegado anidado. Bump fuerza recarga de
//         js/admin/club/panel.js.
//  v207: Bump tras fix de category/subcategory en el flujo de alta del Club.
//  v206: Bump tras fix del contador "Admin de Club" (countByRole via allRoles).
//  v205: Pieza 2 - Resolutor de staff por modalidad del partido. Al despachar
//         el informe colectivo (auto y manual) los Coordinadores se filtran por
//         su coordinatorType (f7/f11/f711) segun la modalidad de la categoria
//         del partido: F7 solo lo reciben coords f7/f711/sin-tipo, F11 solo
//         f11/f711/sin-tipo; el Director Deportivo lo recibe SIEMPRE. Helpers
//         puros en js/core/utils.js (_cronosMatchModality /
//         _cronosStaffCoordinatorType / _cronosResolveStaffForMatch). Bump
//         fuerza recarga de utils.js + coach/comms/panel.js.
//  v204: FIX CRITICO PERDIDA DE DATOS EN CADA ACTUALIZACION. La logica de
//         privacidad introducida en v199 (_purgeStaleLocalDataIfNeeded) borraba
//         TODAS las claves cronos_* cuando el dispositivo no tenia el marcador
//         'cronos_owner_uid'. Como ese marcador solo existe desde v199, cualquier
//         usuario con datos previos (o que limpiara la cache) entraba en la rama
//         de "limpieza preventiva" en su siguiente login tras CADA actualizacion,
//         perdiendo plantillas, formaciones, convocatorias y planificaciones de
//         entrenamiento (claves que solo viven en localStorage). FIX: la purga
//         ahora SOLO se dispara ante un cambio de uid REAL y comprobado (CASO 3).
//         Si no hay marcador previo (CASO 2) se ADOPTA el uid actual como
//         propietario SIN purgar, preservando los datos del usuario entrante.
//         Bump fuerza recarga del bundle de firestore-storage.js.
//  v203: Anade selector de tipo de Coordinador (F7/F11/F7&11) en registro.
//  v202: Persiste subcategory en los informes colectivos (deriva de allRoles del entrenador, base para futuro resumen agregado de estadisticas)
//  v201: Corrige etiquetas entrada/salida en linea de tiempo de informes colectivos (verde=entra, roja=sale, con nombre propio y minuto)
//  v200: Habilitado pinch-to-zoom en movil y iPad. Se quito
//         maximum-scale=1.0 y user-scalable=no del meta viewport en
//         index.html, live.html y sound-test.html. Se cambio touch-action
//         de 'none' a 'pinch-zoom' en .player-chip (campo y banquillo) para
//         permitir zoom con 2 dedos sin afectar el arrastre con 1 dedo. El
//         drag-and-drop tactil no requirio cambios (el touchcancel existente
//         en render.js ya limpia el clon de arrastre si el navegador
//         intercepta el gesto de 2 dedos).
//  v199: FIX CRITICO DE PRIVACIDAD - localStorage no estaba aislado por usuario,
//         causando que un usuario nuevo en el mismo dispositivo heredara plantillas,
//         jugadores, partidos y datos de la cuenta anterior. Se anade
//         _purgeStaleLocalDataIfNeeded() y _cronosPurgeAllLocalPII() en
//         firestore-storage.js: purga automatica de claves cronos_* con PII al
//         detectar cambio de uid en login (checkAuthorization, _launchWithRole,
//         auto-recovery de superadmin/individual) y en logout (logoutUser,
//         cerrarSesion). Autosanea dispositivos ya afectados en su proximo login,
//         sin accion manual. No afecta sincronizacion legitima entre dispositivos
//         del mismo usuario (Firestore ya estaba aislado por uid correctamente).
//         Bump fuerza recarga obligatoria de todos los bundles para que el fix
//         llegue a todos los usuarios cuanto antes.
//  v198: Fix condicion de carrera en live.html entre el watcher de fondo
//         (background) y el listener visible del partido abierto. Durante la
//         ventana de "partido recien creado + interaccion temprana", ambos
//         listeners competian por el mismo estado de seeding/monotonia
//         (_matchSeeded/_matchLastTs/_matchPrevState), de modo que el watcher de
//         fondo gastaba el seed o avanzaba la monotonia del partido a punto de
//         abrirse y el listener visible descartaba el snapshot del gol sin
//         comparar el delta de marcador (gol del rival no disparaba alerta).
//         Fix: loadMatch() resetea de forma SINCRONA esos tres objetos para el
//         matchId justo antes de suscribir su onSnapshot, quedando como dueno
//         unico de la deteccion. Bump fuerza recarga del bundle de live.html.
//  v197: Fix alerta de gol (sonido+imagen) que no se disparaba en live.html para
//         goles del equipo rival sin plantilla cargada, ni para goles no
//         asignados/propia puerta del equipo propio. detectAndAlert() ahora
//         compara el delta de marcador agregado (homeTeam.score/awayTeam.score)
//         restando los goles ya atribuidos a jugadores, evitando alertas
//         duplicadas. Usa el nombre real del equipo configurado. Bump fuerza
//         recarga del bundle de live.html.
//  v196: Fix ficha difuminada tras confirmar cambio de jugador por toque (tap)
//         en iPad/movil. renderPlayers() exigia ahora que exista un clon de
//         arrastre activo (touchData.clone) antes de aplicar opacity:0.3,
//         evitando que un draggedPlayerId residual deje la ficha entrante
//         atenuada hasta el siguiente gesto. Bump fuerza recarga del bundle de UI.
//  v195: Restaura panel.js de Administrador de Club (443 lineas borradas en
//         edicion local recuperadas) + elimina boton Cambiar Rol de ese panel
//         por decision de Jose Alberto. Alinea VERSION y CACHE_NAME (desfasados
//         entre v191/v194 por cambios de sesion anterior sin commitear). Bump
//         fuerza recarga completa del bundle de admin.
//  v191: Boton explicito "Activar sonido" en live.html para iPhone PWA
//         standalone. live.html se abre con window.open(_blank), un documento
//         separado que NO hereda el gesto del usuario de la pagina padre, asi que
//         su AudioContext nunca se desbloqueaba (en iPhone; PC/iPad iban OK por
//         politica de autoplay mas laxa). El boton da un gesto GARANTIZADO en
//         este documento: desbloquea el AudioContext + keep-alive y emite un bip
//         de confirmacion. Tras desbloquear pasa a "Sonido activo". Bump fuerza
//         recarga de live.html.
//  v190: FIX audio de alertas En Vivo en iPhone PWA standalone (instalada en
//         pantalla de inicio): no sonaba NUNCA, ni la 1a repeticion (PC/iPad ya
//         iban OK tras v189). iOS standalone suspende el AudioContext entre
//         gestos y no permite resume() fuera de un gesto; las alertas llegan por
//         Firestore (sin gesto). Fix: keep-alive del AudioContext (loop de
//         silencio inaudible) que lo mantiene 'running' de forma continua tras
//         el primer toque, para que _playSeq suene sin gesto. Bump fuerza
//         recarga de live.html.
//  v189: FIX sonido de alerta En Vivo: se oia "una vez y corta" en partidos
//         reales. Las alertas llegan desde el callback de Firestore (no es un
//         gesto del usuario), con el AudioContext en 'suspended'; al leer
//         currentTime congelado las repeticiones colapsaban en un golpe. Ahora
//         playEventSound() solo programa con ctx.state 'running' (si no, resume()
//         + then) y _playSeq() repite 3 veces fijas una secuencia CORTA por
//         evento con envolvente sostenida. Bump fuerza recarga de live.html.
//  v188: NUEVO — Alertas sonoras + visuales en la pestaña "En Vivo" del Panel
//         de Direccion (live.html). Al ocurrir un evento (gol, tarjeta amarilla/
//         roja, cambio o lesion) en cualquier partido seguido, se muestra un
//         toast con flash de pantalla, un sonido sintetico (WebAudio, sin
//         archivos) distinto por evento y vibracion en movil. Funciona aunque
//         el director este viendo otro partido: un watcher en segundo plano
//         (onSnapshot a todos los partidos seguidos) detecta los cambios
//         comparando snapshots consecutivos por jugador. Boton de silenciar
//         (persistente en localStorage). Bump fuerza recarga de live.html.
//  v187: FIX campo mostraba AMBOS equipos al jugar de VISITANTE con el checkbox
//         "Analizar Contrario" DESACTIVADO. RAIZ: setup-modal.js forzaba
//         analyzeAway=true cuando _userTeamRole==='away', ignorando el checkbox,
//         y spawnInitialPlayers creaba siempre el equipo home (rival generico).
//         AHORA: spawnInitialPlayers se reescribe en torno a "mi equipo" (team =
//         userRole, siempre) vs "el contrario" (solo si analyzeAway). Se elimina
//         el forzado de analyzeAway. Como de visitante mi banca esta en la sidebar
//         derecha, se anade clase body.role-away + CSS para que hide-visitor oculte
//         la sidebar izquierda (rival) en vez de la derecha (mia). Bug especifico
//         del rol visitante; de local sin el checkbox ya funcionaba bien.
//  CRONOS FUTBOL - Service Worker v186
//  v186: FIX (continuacion v185) resultado V/D/E AUN invertido de VISITANTE en
//         el Panel de Direccion y Mis Informes pese a que los docs en Firestore
//         SI tenian myTeamRole correcto. RAIZ: al AGRUPAR los docs por partido
//         (matches[key]) los 3 puntos de agrupacion (club-reports.js _sdLoadReports,
//         panel.js openMisInformes) NO copiaban myTeamRole al objeto agrupado, asi
//         que el calculo leia m.myTeamRole=undefined -> fallback 'home' -> DERROTA.
//         AHORA: se propaga myTeamRole en la construccion del objeto agrupado y se
//         adopta del primer doc que lo traiga. Sin backfill.
//  v185: FIX resultado V/D/E invertido al jugar de VISITANTE. Los informes
//         guardaban scoreHome/scoreAway como marcador local-visitante pero la
//         formula asumia scoreHome=mi equipo, dando DERROTA cuando se ganaba de
//         visitante. AHORA: (1) escritura -> se persiste myTeamRole (_cMyTeamKey)
//         en parent_player_report, staff_match_report, collective_match_report y
//         la notificacion informe_partido; (2) lectura -> los 4 puntos de calculo
//         (coach/reports/club-reports.js x2, coach/comms/panel.js, parent/panel.js)
//         comparan goles propios vs rival segun myTeamRole. Docs antiguos sin el
//         campo -> fallback 'home' (comportamiento previo intacto, sin backfill).
//         C-25 (resuelto): js/club-reports.js (duplicado muerto) ELIMINADO del
//         repo; el activo es js/coach/reports/club-reports.js. Pendiente aun:
//         linea 2413 aviso_partido_finalizado (consistencia, no afecta al bug).
//  v183: FIX panel de Direccion mostraba solo 1 partido al director/coordinador.
//         RAIZ: _sdLoadReports hacia where(clubId==cid).limit(500) SIN orden ni
//         filtro; con clubs de miles de docs el cupo de 500 se llenaba de docs
//         _coach_pN / _parent_* y, tras el filtro cliente staffReport===true,
//         apenas sobrevivia 1 partido. AHORA la query primaria filtra ya por
//         staffReport==true + orderBy(createdAt desc) + limit(500) (indice
//         compuesto clubId,staffReport,createdAt desc desplegado), con fallback
//         sin orderBy y fallback legacy. El fallback staffUids array-contains
//         downstream se conserva intacto como red de seguridad.
//  v179: P14 — eliminado el banner flotante "Partido interrumpido" del panel
//         del entrenador (recuperacion sigue en "RECUPERAR PARTIDO" del modal).
//         P15 — panel de Comunicaciones simplificado (openUnifiedCommsMenu):
//         quitadas 5 tarjetas redundantes/rotas (Convocatoria, Entrenamiento,
//         Informe Colectivo, Mis Informes, Gestion de Contactos); se conservan
//         Mensajes, Informes Individuales, Partidos Terminados y Retransmision.
//  v178: Ocultar informes de staff por usuario sin borrar el doc compartido.
//         El Director/Coordinador ya no borra fisicamente el documento de
//         cronos_player_reports: ahora anade su propio UID a dismissedByStaff
//         (arrayUnion) y la lectura (_sdLoadReports) filtra en cliente los
//         docs donde dismissedByStaff contiene su UID. Asi cada rol ve/oculta
//         de forma independiente sin afectar al otro. firestore.rules: el
//         update de dismissedByStaff lo permite solo a UIDs listados en
//         staffUids; el delete fisico de informes staffReport=true queda
//         reservado al coach autor (coachUid) y al SuperAdmin.
//  v177: FIX (P11-C/P11-D) el Panel de Informes seguia sin mostrar partidos
//         nuevos al Director/Coordinador.
//         P11-C: las 3 llamadas a _cResolveClubId en club-reports.js no pasaban
//           updateDoc, asi que el clubId resuelto desde allRoles[] nunca se
//           migraba al campo raiz de users/{uid} -> userDocClubId() fallaba y la
//           Query A (por clubId) era rechazada. Ahora pasan { doc, getDoc,
//           updateDoc } y la migracion se persiste.
//         P11-D: _sendCollectiveReportNow hacia `return` si la lista de staff
//           estaba vacia, ABORTANDO la escritura de cronos_player_reports -> el
//           partido nuevo nunca aparecia (el panel se alimenta de esos docs).
//           Ahora se escriben igualmente; staffUids incluye SIEMPRE me.uid
//           (red de seguridad para la Query B array-contains) tanto en el
//           colectivo como en autoDispatchMatchReports. Anadidos logs
//           [StaffReport] con conteo TOTAL de docs escritos para diagnostico.
//  v176: FIX (P11) panel de Informes no mostraba TODOS los partidos al
//         Director/Coordinador. (1) La agrupacion usaba matchDate+rival+coach
//         pero los docs staff_match_report guardan matchDate=hoy -> partidos
//         distintos contra el mismo rival el mismo dia colapsaban en una
//         tarjeta. Ahora se agrupa por matchId. (2) La query por clubId no
//         filtraba staffReport, agotando limit(500) con docs irrelevantes;
//         ahora ambas queries (clubId+staffReport / staffUids) corren en
//         paralelo con Promise.allSettled y se fusionan. Nuevo indice
//         compuesto cronos_player_reports(clubId, staffReport).
//  v175: FIX permission-denied del informe colectivo al staff (director/
//         coordinador). Causa: el hilo coach<->staff usaba threadId
//         {coachUid}_{staffUid}; los docs antiguos no tenian coachUid ni
//         participants, asi que updateDoc/setDoc(merge) los rechazaba contra
//         las reglas de cronos_messages -> el informe no llegaba al staff.
//         Solucion: nuevo helper _cStaffThreadId -> el hilo pasa a
//         {clubId}_{staffUid} (pertenece al CLUB) y los setDoc incluyen
//         clubId + participants + staffUids, de modo que sameClubAsDoc/
//         participants/coachUid SIEMPRE pasan. Aplicado en las 4 rutas:
//         listado de hilos, openThreadWithStaff (chat manual), sendCoachMessage,
//         _executeReportsSend (informe colectivo) y la 2a ruta de envio staff.
//         El staff sigue leyendo por query (staffUid==uid / staffUids
//         array-contains), asi que el cambio de ID no afecta a su bandeja.
//         No requiere cambio en firestore.rules.
//  v174: dos bugs confirmados del envio de informes:
//         Bug 1 (clubId null): _cResolveClubId lee clubId de users/{uid}
//           cuando el token no trae el claim -> staff y padres dejan de
//           recibir por sameClubAsDoc(null). Aplicado en ambas rutas.
//         Bug 2 (contacto manual): _cronosResolveParentReportTargets empareja
//           por playerId/dorsal de forma robusta (J10/J-10/playerNumber) para
//           recuperar el parentUid del link; el target lleva su contacto y la
//           ruta manual reempareja con las MISMAS vias que el helper.
//  v173: el catch de 'Error creando hilo staff' ahora vuelca code+message+
//         threadId+staffUid+clubId para diagnosticar el permission-denied de
//         las reglas de cronos_messages (sin cambio de comportamiento).
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
const VERSION = 'v276';
const CACHE_NAME = 'cronos-cache-v311';

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
    './js/admin/shared/category-tree.js',
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
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => {
                        return caches.delete(key);
                    })
            );
        }).then(() => {
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
    // v229: soporte para mensaje { action: 'skipWaiting' } desde el banner
    // de actualización. Esto activa el nuevo SW inmediatamente.
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});

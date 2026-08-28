// ════════════════════════════════════════════════════════════════════
//  js/coach/reports/finished-matches-tab.js
//  Pestaña "Partidos Terminados" del Panel de Dirección: reúne los partidos
//  finalizados desde live_matches y los informes colectivos de
//  cronos_player_reports, y los presenta como lista plana filtrada (rol
//  entrenador) o como árbol de Categoría × Subcategoría (director/coordinador).
//
//  Extraído de js/coach/reports/club-reports.js (auditoría 2026-07-22,
//  hallazgo #9 — monolitos sin tests de framework) el 2026-07-26, paso 3 de 6
//  de la descomposición de ese archivo. Movimiento puramente mecánico, sin
//  cambios de lógica.
//
//  ⚠️ ESTE ARCHIVO NO ES AUTÓNOMO: tiene un CICLO con js/core/app-init.js.
//  El HTML que genera llama a deleteFinishedMatchFromCloud (definida en
//  app-init.js), y esa función llama de vuelta a _renderFinishedMatchesTab
//  para refrescar. Los dos sentidos se resuelven en tiempo de click vía
//  window, así que el orden de <script> es indiferente, pero no se puede
//  razonar sobre este archivo sin tener app-init.js delante.
//
//  ACOPLAMIENTO:
//   · Entrada 1: switchStaffTab('partidos_terminados') → esta función
//     (switchStaffTab SE QUEDA en club-reports.js), detrás de la comprobación
//     del extra `partidos_terminados`.
//   · Entrada 2: app-init.js, dentro de deleteFinishedMatchFromCloud, con
//     guarda typeof. Es el ÚNICO consumidor externo — la aserción 1c del test
//     lo fija para que no aparezcan otros por descuido.
//   · Depende de _sdFS() (helper Firestore que SE QUEDA en club-reports.js),
//     escapeHtml (app-init.js), window.openMatchReplay
//     (match/replay/replay-player.js), openRetroactiveEventModal
//     (match/events/retroactive-modal.js, invocada con guarda) y
//     deleteFinishedMatchFromCloud (app-init.js, invocada SIN guarda).
//
//  ⚠️ IMPLEMENTACIÓN PARALELA: app-init.js:1086 define
//  `async function showFinishedMatches()`, un SEGUNDO renderizador
//  independiente del mismo listado, con su propio _renderItem casi idéntico a
//  _renderMatchItem de aquí. No hay colisión de nombres ni de contenedor, así
//  que no es un caso de "last script wins", pero es lógica duplicada entre dos
//  monolitos y deleteFinishedMatchFromCloud refresca LAS DOS. Unificarlas es
//  tarea para cuando le toque a app-init.js, no de este refactor.
//
//  ⚠️ ESCRIBE EN FIRESTORE DURANTE EL RENDER: el "enriquecimiento retroactivo"
//  hace updateDoc sobre live_matches o cronos_player_reports para rellenar
//  category/subcategory ausentes, fire-and-forget y con el error silenciado.
//  No es destructivo, pero no es un render de sólo lectura.
//
//  🟠 ACTUALIZADO (SEC-A1/A2, 2026-08-26). Esta nota decía que se leían TRES
//  colecciones enteras sin where y advertía de no convertirlas a queries sin
//  revisar la semántica. Dos ya están convertidas, y revisadas:
//   · `live_matches` → por club y por creador (las mismas dos condiciones que
//     evaluaba el filtro local; lo fija test_finished_matches_module 2e).
//   · `users` → por club, y sólo si hay clubId.
//  Las dos eran además fugas: se descargaba el censo y los partidos de todos
//  los clubes para quedarse con los propios.
//  ✅ Y `cronos_player_reports` desde v635. Aquella nota decía «probablemente
//  ya se deniega y muere en su catch». Se midió contra producción y era
//  CIERTO: la colección entera daba 403 y los informes colectivos llevaban
//  tiempo sin cargarse, sin ningún error a la vista.
//
//  ⚠️ RAREZAS PREEXISTENTES, DELIBERADAMENTE NO CORREGIDAS:
//   · El objeto que se guarda en finishedMap para los informes colectivos
//     termina en `...data`, DESPUÉS de las ~26 líneas que normalizan
//     homeTeam/awayTeam. Si el documento trae esos campos, el valor crudo pisa
//     la normalización, que sólo surte efecto cuando el campo no viene. NO
//     produce fallo visible porque _renderMatchItem repite la misma cadena de
//     fallbacks, pero son 26 líneas de trabajo muerto. Aserción 2n del test.
//   · Los tres onclick interpolan m.id / m.docId SIN escapeAttr (aserción 6g),
//     al contrario que events-tab.js, que sí escapaba.
//   · deleteFinishedMatchFromCloud va sin guarda typeof mientras
//     openRetroactiveEventModal, en el botón contiguo, sí la lleva.
//
//  Cubierto por scripts/test_finished_matches_module.js.
// ════════════════════════════════════════════════════════════════════

async function _renderFinishedMatchesTab() {
    const container = document.getElementById('staff-dashboard-content');
    const me = window._cronosCurrentUser;
    const activeRole = me?._activeRole || me?.role;
    const clubId = me?.clubId;

    try {
        // ⚠️ `query`/`where` se traen AQUI, con los demas. Estuvieron un rato
        //    pedidos dentro del bloque de live_matches, y el bloque de `users`
        //    —que tambien los necesita desde SEC-A1— los veia `undefined`:
        //    reventaba y el catch se lo comia en silencio.
        // ⚠️ `orderBy`/`limit` se traen AQUI TAMBIEN, con los demas (v638). La
        //    nota de abajo ya avisaba de esto para `query`/`where`: pedirlos
        //    dentro de un bloque los deja `undefined` para el resto y revienta
        //    donde no toca. Y `test_finished_matches_module.js` (1b) vigila que
        //    no se multipliquen las aperturas de Firestore: son DOS, no tres.
        const { db, collection, getDocs, query, where, orderBy, limit } = await _sdFS();
        if (!db) {
            container.innerHTML = '<p style="color:#7d8590;padding:2rem;">Error de conexión.</p>';
            return;
        }

        const finishedMap = new Map(); // id -> matchData

        // ══════════════════════════════════════════════════════════════
        //  🔴 SEC-A2 (auditoria 2026-08-25) · SE PREGUNTA POR EL CLUB PROPIO
        //
        //  Antes: `getDocs(collection(db,'live_matches'))` — la coleccion
        //  ENTERA— y el filtro `isMyClub` se aplicaba DESPUES, en el navegador.
        //  O sea que para pintar los partidos del propio club se descargaban
        //  los de todos los demas, con los alias de sus menores dentro.
        //
        //  🔑 DOBLE ARREGLO CON EL MISMO CAMBIO: cierra la fuga Y baja las
        //  lecturas, que en este proyecto siempre han sido el techo (v431,
        //  v576, v579). Y desde SEC-A2 la regla EXIGE el filtro: sin el, la
        //  consulta se deniega entera.
        //
        //  ⚠️ SIN clubId NO SE PREGUNTA. Antes `!clubId` significaba "traelo
        //  todo"; ahora eso seria justo lo que la regla rechaza. Se salta el
        //  paso y la lista se completa con los informes de mas abajo.
        // ══════════════════════════════════════════════════════════════
        try {
            // Las MISMAS dos condiciones que evaluaba el filtro local: el club
            // propio y los partidos que creó uno mismo (que pueden llevar otro
            // clubId). Firestore no tiene OR entre campos distintos, así que
            // son dos consultas fusionadas por id — el patrón de live.html
            // desde v431/v433, y las mismas ramas que admite la regla SEC-A2.
            const condiciones = [];
            if (clubId)   condiciones.push(where('clubId', '==', clubId));
            if (me?.uid)  condiciones.push(where('createdBy', '==', me.uid));

            for (const cond of condiciones) {
                // ⚠️ Una consulta que falle no puede tumbar a la otra.
                try {
                    const snapLive = await getDocs(query(collection(db, 'live_matches'), cond));
                    snapLive.forEach(d => {
                        const data = d.data() || {};
                        if (data.status === 'finished' || data.phase === 'finished' || data.matchPhase === 'finished') {
                            finishedMap.set(d.id, { id: d.id, source: 'live_matches', ...data });
                        }
                    });
                } catch (eC) {
                    console.warn('[FinishedMatches] live_matches (una condición):', eC && eC.message);
                }
            }
        } catch(e1) {
            console.warn('[FinishedMatches] Error leyendo live_matches:', e1);
        }

        // ══════════════════════════════════════════════════════════════
        //  🔴 LOS INFORMES COLECTIVOS NO ESTABAN CARGANDO (v635)
        //
        //  Aqui habia `getDocs(collection(db,'cronos_player_reports'))` — la
        //  coleccion ENTERA— y el filtro se aplicaba despues, en el navegador.
        //
        //  🔑 PERO LA REGLA DE LECTURA DE ESA COLECCION ES ENTERA DEPENDIENTE
        //  DEL DOCUMENTO: siete ramas, todas sobre `resource.data`. Firestore
        //  deniega cualquier consulta que no pueda demostrar segura de
        //  antemano, asi que esa lectura moria ENTERA con un 403.
        //
        //  🚨 Y NO SE VEIA: el `catch` de abajo solo hace `console.warn`. La
        //  pestaña se pintaba «bien», sin informes y sin error.
        //
        //  Medido lanzando la consulta DE VERDAD contra produccion con un
        //  entrenador real: coleccion entera -> 403; acotada por `clubId` -> 200
        //  y SI ve el colectivo; por `coachUid` -> 200 tambien. El `:test` de
        //  la Rules API no habria servido: evalua documentos sueltos, no la
        //  legalidad de una CONSULTA.
        //  Guard del codigo: scripts/test_finished_matches_module.js (2g2-2g6).
        //
        //  Mismo patron que `live_matches` aqui arriba: las MISMAS dos
        //  condiciones que evaluaba el filtro local —el club propio y lo que
        //  uno mismo firmo como coach—, en dos consultas fusionadas por id,
        //  porque Firestore no tiene OR entre campos distintos.
        //
        //  ⚠️ `!clubId` YA NO SIGNIFICA «traelo todo». Antes esa rama abria la
        //  coleccion entera; hoy es justo lo que la regla rechaza. Sin clubId
        //  se pregunta solo por `coachUid`.
        // ══════════════════════════════════════════════════════════════
        // ══════════════════════════════════════════════════════════════
        //  🔴🔴 v638 · 176 PARTIDOS PINTADOS COMO 5.377 FICHAS
        //
        //  Reportado como «la carga es extremadamente lenta, al punto de
        //  quedarse colgado» (implementar.txt 2026-08-27, punto 4) y con
        //  captura: la pestaña atascada en «Cargando…» SIN un solo error en
        //  consola. Medido contra producción antes de tocar nada, con el club
        //  real (CD DÍA):
        //
        //     documentos que descargaba .......... 5.436   (10,5 MB)
        //     fichas de partido que construía ..... 5.377
        //     🔑 PARTIDOS DE VERDAD ................. 176
        //
        //  🔑 LA CAUSA NO ERA EL VOLUMEN, ERA LA CLAVE DE AGRUPACIÓN. El mapa
        //  se indexaba por `data.liveMatchId || d.id`, y `liveMatchId` NO
        //  EXISTE EN NINGUNO de los 5.436 documentos (cero, medido). Así que
        //  siempre caía al id del documento y CADA INFORME —uno por jugador y
        //  partido— se convertía en su propia ficha. El campo que sí llevan
        //  los 5.436 es `matchId`, y es el que agrupa: 5.377 → 176.
        //
        //  ⚠️ Y EL VOLUMEN TAMBIÉN ESTABA MAL, aunque no fuera la causa: para
        //  una lista de 176 filas se bajaban 10,5 MB. Se acota con
        //  orderBy(createdAt desc) + limit. `createdAt` es una cadena ISO en
        //  los 5.436 (medido), y una ISO ordena lexicográficamente igual que
        //  cronológicamente, así que el orden es fiable. El índice
        //  `clubId + createdAt DESC` ya existía en firestore.indexes.json.
        //
        //  ⚠️⚠️ `limit` SIN `orderBy` habría sido peor que no ponerlo: abre una
        //  ventana sobre lo MÁS VIEJO, porque el id empieza por la fecha. Es
        //  la lección de v508 y aquí estaba a un paso de repetirse.
        //
        //  ⏳ LO QUE ESTO NO ARREGLA, y conviene decidir aparte: esta
        //  colección NO TIENE un documento por partido. Son ~31 informes por
        //  partido (uno por jugador), así que cualquier lista de partidos
        //  construida desde aquí siempre bajará de más. La solución duradera
        //  es un índice ligero por partido, como el `live_index` de v572/v573.
        //  Con el tope de abajo la pestaña va sobrada hoy (176 partidos), pero
        //  crecerá.
        // ══════════════════════════════════════════════════════════════
        // ══════════════════════════════════════════════════════════════
        //  🪶 v639 · PRIMERO EL ÍNDICE LIGERO (`finished_index`)
        //
        //  UN documento por PARTIDO en vez de ~31. Ver la cabecera de
        //  js/match/live/finished-index.js para el porqué y las medidas.
        //
        //  🔑 EL ÍNDICE ACELERA, NO MANDA. Si no devuelve nada —porque aún no
        //  se ha hecho el backfill, porque su escritura falló, o porque las
        //  reglas todavía no están desplegadas— se sigue por el camino de v638
        //  exactamente como antes. Eso es lo que permite desplegar esto sin
        //  ventana de "la pestaña está vacía" y sin backfill previo.
        //
        //  ⚠️ LA CONDICIÓN ES «no devolvió NADA», no «falló». Un club que de
        //  verdad no tiene partidos indexados todavía tiene que poder ver su
        //  histórico; y uno que sí los tiene no debe pagar los 10,5 MB.
        // ══════════════════════════════════════════════════════════════
        const _TOPE_INDICE = 300;      // 300 PARTIDOS, no 300 informes
        let _indiceSirvio = false;
        try {
            const condIdx = [];
            if (clubId)  condIdx.push(where('clubId', '==', clubId));
            if (me?.uid) condIdx.push(where('coachUid', '==', me.uid));

            const vistosIdx = new Set();
            for (const cond of condIdx) {
                try {
                    const partes = [cond];
                    if (typeof orderBy === 'function') partes.push(orderBy('createdAt', 'desc'));
                    if (typeof limit === 'function')   partes.push(limit(_TOPE_INDICE));
                    const snapIdx = await getDocs(query(collection(db, 'finished_index'), ...partes));
                    snapIdx.forEach(d => {
                        if (vistosIdx.has(d.id)) return;
                        vistosIdx.add(d.id);
                        const x = d.data() || {};
                        if (finishedMap.has(d.id)) return;   // ya vino de live_matches
                        finishedMap.set(d.id, {
                            id: d.id,
                            docId:  x.docId || d.id,
                            source: x.source || 'cronos_player_reports',
                            homeTeam: { name: x.homeName || 'LOCAL',    score: x.homeScore || 0,
                                        color: x.homeColor, shorts: x.homeShorts, textColor: x.homeText },
                            awayTeam: { name: x.awayName || 'VISITANTE', score: x.awayScore || 0,
                                        color: x.awayColor, shorts: x.awayShorts, textColor: x.awayText },
                            scoreHome: x.homeScore || 0,
                            scoreAway: x.awayScore || 0,
                            category:    x.category || '',
                            subcategory: x.subcategory || '',
                            mode:        x.mode || 'f7',
                            matchDate:   x.matchDate || '',
                            createdAt:   x.createdAt || 0,
                            // ⏳ v640 · el ancla de la ventana de 10 h. Sin
                            //    traerla aquí, el filtro caería al `createdAt`
                            //    del despacho, que es parecido pero no es el
                            //    dato que manda.
                            finishedAt:  x.finishedAt || x.createdAt || 0,
                            createdBy:   x.createdBy || null,
                            coachUid:    x.coachUid || null,
                            coachEmail:  x.coachEmail || null,
                            // 🔑 El array de sucesos NO viaja: la tarjeta sólo
                            //    escribía su longitud. Se le da un array del
                            //    tamaño justo para que `m.events.length` siga
                            //    diciendo la verdad sin arrastrar el contenido.
                            events: new Array(Number(x.eventsCount) || 0),
                        });
                    });
                } catch (eIdx) {
                    console.warn('[FinishedMatches] finished_index (una condición):', eIdx && eIdx.message);
                }
            }
            _indiceSirvio = vistosIdx.size > 0;
        } catch (eIdx0) {
            console.warn('[FinishedMatches] Índice ligero no disponible, se usa el camino largo:', eIdx0 && eIdx0.message);
        }

        const _TOPE_INFORMES = 1500;   // ~48 partidos recientes a 31 informes/partido
        if (!_indiceSirvio) try {
            const condRep = [];
            if (clubId)  condRep.push(where('clubId', '==', clubId));
            if (me?.uid) condRep.push(where('coachUid', '==', me.uid));

            const vistos = new Set();
            const docsInformes = [];
            for (const cond of condRep) {
                // ⚠️ Una consulta que falle no puede tumbar a la otra.
                try {
                    // Si el arnés/SDK no trajera orderBy o limit, se consulta
                    // como antes: acotar es una mejora, no un requisito para
                    // que la pestaña funcione.
                    const partes = [cond];
                    if (typeof orderBy === 'function') partes.push(orderBy('createdAt', 'desc'));
                    if (typeof limit === 'function')   partes.push(limit(_TOPE_INFORMES));
                    const snap = await getDocs(query(collection(db, 'cronos_player_reports'), ...partes));
                    snap.forEach(d => { if (!vistos.has(d.id)) { vistos.add(d.id); docsInformes.push(d); } });
                } catch (eC) {
                    console.warn('[FinishedMatches] cronos_player_reports (una condición):', eC && eC.message);
                }
            }

            docsInformes.forEach(d => {
                const data = d.data() || {};
                // El club ya lo garantiza la consulta; queda el filtro que NO
                // se puede expresar como query: «es colectivo» son tres campos
                // alternativos, y un OR entre campos distintos no existe.
                const isCollective = data.staffReport === true || data.type === 'collective_match_report' || data.reportType === 'collective';
                if (isCollective) {
                    // 🔑 v638 · `matchId` PRIMERO. Es el único de los tres que
                    //    existe de verdad en estos documentos (medido: 5.436 de
                    //    5.436 lo llevan; `liveMatchId`, CERO). Sin él, cada
                    //    informe de cada jugador se pintaba como un partido
                    //    aparte. Ver la nota larga de arriba.
                    const idKey = data.matchId || data.liveMatchId || d.id;
                    if (!finishedMap.has(idKey)) {
                        finishedMap.set(idKey, {
                            id: idKey,
                            docId: d.id,
                            source: 'cronos_player_reports',
                            homeTeam: typeof data.homeTeam === 'object' && data.homeTeam ? {
                                name: data.homeTeam.name || data.homeName || 'LOCAL',
                                score: data.homeTeam.score ?? data.scoreHome ?? data.goalsHome ?? 0,
                                color: data.homeTeam.color || data.homeColor || '#58a6ff',
                                shorts: data.homeTeam.shorts || data.homeShorts || '#1a4e99',
                                textColor: data.homeTeam.textColor || data.homeText || '#000000'
                            } : {
                                name: data.homeName || (typeof data.homeTeam === 'string' ? data.homeTeam : 'LOCAL'),
                                score: data.scoreHome ?? data.goalsHome ?? 0,
                                color: data.homeColor || '#58a6ff',
                                shorts: data.homeShorts || '#1a4e99',
                                textColor: data.homeText || '#000000'
                            },
                            awayTeam: typeof data.awayTeam === 'object' && data.awayTeam ? {
                                name: data.awayTeam.name || data.awayName || 'VISITANTE',
                                score: data.awayTeam.score ?? data.scoreAway ?? data.goalsAway ?? 0,
                                color: data.awayTeam.color || data.awayColor || '#ff5858',
                                shorts: data.awayTeam.shorts || data.awayShorts || '#b22222',
                                textColor: data.awayTeam.textColor || data.awayText || '#ffffff'
                            } : {
                                name: data.awayName || (typeof data.awayTeam === 'string' ? data.awayTeam : 'VISITANTE'),
                                score: data.scoreAway ?? data.goalsAway ?? 0,
                                color: data.awayColor || '#ff5858',
                                shorts: data.awayShorts || '#b22222',
                                textColor: data.awayText || '#ffffff'
                            },
                            category: data.category || '',
                            subcategory: data.subcategory || '',
                            createdAt: data.createdAt || data.timestamp || 0,
                            events: data.events || data.timeline || [],
                            players: data.players || [],
                            mode: data.mode || 'f7',
                            ...data
                        });
                    }
                }
            });
        } catch(e2) {
            console.warn('[FinishedMatches] Error leyendo cronos_player_reports:', e2);
        }

        let finishedMatches = Array.from(finishedMap.values());

        // ══════════════════════════════════════════════════════════════
        //  ⏳⏳ v640 · LA VENTANA DE 10 HORAS — LA REGLA DE ESTA SECCIÓN
        //
        //  Regla de negocio (implementar.txt 2026-08-28): esta sección es un
        //  REGISTRO TEMPORAL de 10 h desde el final del encuentro:
        //      · las 2 primeras   → margen para corregir informes
        //      · las 8 siguientes → para poder descargarlo y guardarlo
        //  Pasadas las 10 h el partido DESAPARECE DE AQUÍ.
        //
        //  🔴 ESTO NO SE ESTABA APLICANDO. `CronosMatchLock.RETENTION_MS`
        //  existe desde v434 y `live.html` sí lo respeta (su lista en vivo
        //  descarta lo caducado), pero esta pestaña NUNCA lo leyó: se estaba
        //  comportando como un archivo histórico. Medido en producción el
        //  2026-08-28: 390 partidos desde abril, con julio y junio dentro.
        //
        //  ⚠️⚠️ DESAPARECE DE LA SECCIÓN, NO SE BORRA NADA. Los informes
        //  colectivos e individuales PERMANECEN TODA LA TEMPORADA — son los
        //  que alimentan «Mis Informes», el resumen de temporada, la
        //  exportación CSV/PDF y el Gantt. Este filtro es de PRESENTACIÓN.
        //
        //  🔑 SE FILTRA AQUÍ, DESPUÉS DE FUSIONAR LAS TRES FUENTES
        //  (`live_matches`, `finished_index` y el respaldo sobre
        //  `cronos_player_reports`), y no en cada consulta. Filtrar sólo el
        //  índice habría dejado la puerta abierta: el respaldo habría vuelto a
        //  pintar julio en cuanto el índice saliera vacío — que con esta regla
        //  es el estado NORMAL cuando no hay partidos recientes.
        //
        //  🔑 EL ANCLA ES `finishedAt`, con respaldo en `createdAt`/`updatedAt`
        //  para el histórico anterior a v431 que nunca tuvo sello. Es la MISMA
        //  que usan el candado, la Cloud Function y live.html. Anclar en
        //  `updatedAt` a secas dejaría que corregir un informe dentro de las
        //  2 h de margen reiniciara el reloj otras 10 h (la lección de v434).
        //
        //  ⚠️ SIN FECHA UTILIZABLE NO SE OCULTA: más vale una ficha de más que
        //  esconderle a alguien un partido por un dato corrupto. Mismo criterio
        //  que el paso B de `cleanupLiveMatches`, que tampoco borra sin ancla.
        // ══════════════════════════════════════════════════════════════
        const _LOCK = window.CronosMatchLock;
        const _retencionMs = (_LOCK && _LOCK.RETENTION_MS) || (10 * 60 * 60 * 1000);
        const _corteRetencion = Date.now() - _retencionMs;
        const _finMs = (m) => {
            if (_LOCK && typeof _LOCK.finishedAtMs === 'function') {
                const v = _LOCK.finishedAtMs(m);
                if (v) return v;
            }
            const bruto = m.finishedAt || m.createdAt || m.updatedAt;
            if (!bruto) return 0;
            if (typeof bruto === 'number') return bruto;
            if (typeof bruto.toMillis === 'function') return bruto.toMillis();
            const t = Date.parse(bruto);
            return isNaN(t) ? 0 : t;
        };

        const _antesDeCaducar = finishedMatches.length;
        finishedMatches = finishedMatches.filter(m => {
            const fin = _finMs(m);
            if (!fin) return true;                  // sin ancla: no se esconde
            return fin > _corteRetencion;
        });
        if (_antesDeCaducar !== finishedMatches.length) {
            console.log('[FinishedMatches] Ventana de ' + (_retencionMs / 3600000) + ' h: ' +
                        (_antesDeCaducar - finishedMatches.length) + ' partido(s) fuera de plazo ocultados ' +
                        '(sus informes NO se tocan).');
        }

        // ── ENRIQUECIMIENTO RETROACTIVO DE CATEGORÍA Y SUBCATEGORÍA ─────────────
        // Si un partido no tiene categoría/subcategoría registrada, buscamos en los
        // datos del entrenador creador (por UID, email o me) y actualizamos Firestore.
        try {
            const coachCatMap = new Map();
            if (me) {
                const meCat = me.category || me._activeRoleData?.category || me.categoryLabel || '';
                const meSub = me.subcategory || me._activeRoleData?.subcategory || '';
                if (meCat || meSub) {
                    if (me.uid) coachCatMap.set(me.uid, { category: meCat, subcategory: meSub });
                    if (me.email) coachCatMap.set(me.email, { category: meCat, subcategory: meSub });
                }
            }

            // Cargar perfiles de usuarios del club si hay partidos sin categoría
            const unassignedMatches = finishedMatches.filter(m => !m.category);
            if (unassignedMatches.length > 0) {
                // 🟠 SEC-A1 (2026-08-26) · ACOTADO AL CLUB. Antes se
                // descargaba la coleccion `users` ENTERA —el censo de la
                // plataforma— solo para resolver la categoria de unos cuantos
                // entrenadores. Con `users` ya no publico, esa consulta se
                // deniega; y aunque no lo estuviera, sobraba. Sin clubId no
                // hay a quien preguntar y se salta el paso.
                const usersSnap = clubId ? await getDocs(query(
                    collection(db, 'users'),
                    where('clubId', '==', clubId)
                )).catch(() => null) : null;
                if (usersSnap) {
                    usersSnap.forEach(ud => {
                        const uData = ud.data() || {};
                        const cat = uData.category || uData._activeRoleData?.category || uData.categoryLabel || '';
                        const sub = uData.subcategory || uData._activeRoleData?.subcategory || '';
                        if (cat || sub) {
                            coachCatMap.set(ud.id, { category: cat, subcategory: sub });
                            if (uData.email) coachCatMap.set(uData.email, { category: cat, subcategory: sub });
                            if (uData.uid) coachCatMap.set(uData.uid, { category: cat, subcategory: sub });
                        }
                    });
                }

                // Asignar categoría encontrada y actualizar Firestore
                const { doc, updateDoc } = await _sdFS();
                unassignedMatches.forEach(m => {
                    const info = coachCatMap.get(m.createdBy) || coachCatMap.get(m.coachUid) || coachCatMap.get(m.coachEmail);
                    if (info && (info.category || info.subcategory)) {
                        m.category = m.category || info.category;
                        m.subcategory = m.subcategory || info.subcategory;

                        // Guardar en Firestore de forma silenciosa e instantánea
                        const colName = m.source === 'live_matches' ? 'live_matches' : 'cronos_player_reports';
                        const targetId = m.docId || m.id;
                        // v434 · NO SE ESCRIBE SOBRE UN PARTIDO TERMINADO. Este
                        // "enriquecimiento" rellenaba category/subcategory
                        // durante el render, y eso es editar un partido cerrado:
                        // la regla de firestore.rules lo deniega y el .catch(())
                        // se lo tragaba, dejando un error de permisos por cada
                        // ficha en cada apertura de la pestaña. La categoría
                        // calculada se sigue usando EN PANTALLA (las dos líneas
                        // de arriba), simplemente ya no se persiste.
                        const _esPartido = colName === 'live_matches';
                        if (targetId && updateDoc && doc && !_esPartido) {
                            updateDoc(doc(db, colName, targetId), {
                                category: m.category,
                                subcategory: m.subcategory
                            }).catch(() => {});
                        }
                    }
                });
            }
        } catch(catErr) {
            console.warn('[FinishedMatches] Error en enriquecimiento retroactivo:', catErr);
        }

        finishedMatches.sort((a, b) => {
            const tsA = typeof a.createdAt === 'number' ? a.createdAt : (a.createdAt?.toMillis?.() || 0);
            const tsB = typeof b.createdAt === 'number' ? b.createdAt : (b.createdAt?.toMillis?.() || 0);
            return tsB - tsA;
        });

        // ── Normalizadores de Categoría y Subcategoría ────────────────────
        const _normCat = (c) => {
            if (!c) return '';
            let str = String(c).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (str.includes('prebenj')) return 'prebenjamin';
            if (str.includes('benj')) return 'benjamin';
            if (str.includes('alev')) return 'alevin';
            if (str.includes('infant')) return 'infantil';
            if (str.includes('cadet')) return 'cadete';
            if (str.includes('juven')) return 'juvenil';
            // ⚠️ EL ORDEN IMPORTA (2026-08-12): 'Regional FEM' CONTIENE
            // 'region'. Con la comprobación genérica delante, la categoría
            // femenina se archivaba entera bajo 'Regional' y el Director no
            // veía nunca su rama.
            if (str.includes('futurefem') || str.includes('future fem') || str.includes('future_fem')) return 'futurefem';
            if (str.includes('region') && str.includes('fem')) return 'regional_fem';
            if (str.includes('region')) return 'regional';
            return str.replace(/\s+[abc]$/, '').replace(/[\s-]+/g, '_').replace(/_[abc]$/, '');
        };
        const _normSub = (s, c) => {
            let sub = String(s || '').trim().toUpperCase();
            if (!sub && c) {
                const m = String(c).match(/_([abc])$/i);
                if (m) sub = m[1].toUpperCase();
            }
            return sub;
        };

        const isCoach = (activeRole === 'user' || activeRole === 'coach');

        // ── FILTRO EXCLUSIVO PARA ENTRENADOR ──────────────────────────────
        if (isCoach) {
            const coachCat = _normCat(me?.category || me?._activeRoleData?.category || me?.categoryLabel);
            const coachSub = _normSub(me?.subcategory || me?._activeRoleData?.subcategory, me?.category);

            finishedMatches = finishedMatches.filter(m => {
                const isMyDoc = m.createdBy === me?.uid || m.coachUid === me?.uid || m.coachEmail === me?.email;
                if (isMyDoc) return true;
                const mCat = _normCat(m.category);
                const mSub = _normSub(m.subcategory, m.category);
                if (coachCat && mCat === coachCat) {
                    if (!coachSub || !mSub || mSub === coachSub) return true;
                }
                return false;
            });
        }

        // ── FILTRO POR MODALIDAD DEL COORDINADOR (v593) ──────────────────
        // Mismo criterio que Convocatorias, Entrenamientos, Asistencia e
        // Informes, y por el mismo predicado único (js/core/utils.js). Un
        // coordinador de Fútbol 7 al que se le acotan los informes pero se le
        // deja el archivo de partidos entero no está acotado: sólo lo parece.
        const _fmAlcance = (typeof window._cronosCoordScope === 'function')
            ? window._cronosCoordScope(me) : '';
        if (_fmAlcance && typeof window._cronosVeCategoria === 'function') {
            finishedMatches = finishedMatches.filter(m =>
                window._cronosVeCategoria(me, m.category || m.matchCategory));
        }

        if (finishedMatches.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:3rem 1rem;">
                    <div style="font-size:3rem; margin-bottom:0.8rem;">🎬</div>
                    <h3 style="color:white; margin-bottom:0.4rem;">No hay partidos terminados guardados</h3>
                    <p style="color:#7d8590; font-size:0.85rem;">
                        ${isCoach
                            ? 'Solo se muestran los partidos de tu categoría y subcategoría asignada.'
                            : (_fmAlcance
                                ? 'Solo se muestran los partidos de ' + window._cronosCoordScopeLabel(_fmAlcance) + ', que es tu modalidad de coordinación.'
                                : 'En cuanto finalice un partido o se genere su informe, aparecerá aquí organizados por categoría.')}
                    </p>
                </div>`;
            return;
        }

        // Helper renderizado de tarjeta de partido
        const _renderMatchItem = (m) => {
            const homeName = m.homeTeam?.name || m.homeName || (typeof m.homeTeam === 'string' ? m.homeTeam : 'LOCAL');
            const awayName = m.awayTeam?.name || m.awayName || (typeof m.awayTeam === 'string' ? m.awayTeam : 'VISITANTE');
            const scoreHome = m.homeTeam?.score ?? m.scoreHome ?? m.goalsHome ?? 0;
            const scoreAway = m.awayTeam?.score ?? m.scoreAway ?? m.goalsAway ?? 0;
            const cat = (m.category || 'Fútbol').toUpperCase();
            const sub = m.subcategory ? `Grupo ${m.subcategory}` : '';
            const eventsCount = Array.isArray(m.events) ? m.events.length : 0;
            const dateStr = m.matchDate || (m.createdAt ? (typeof m.createdAt === 'number' ? new Date(m.createdAt).toLocaleDateString('es-ES') : new Date(m.createdAt.seconds * 1000).toLocaleDateString('es-ES')) : '—');

            // ── v434/v435 · Estado de la ficha ────────────────────────────
            // Hay DOS cosas distintas en este listado y no se rigen igual:
            //
            //  · PARTIDOS (live_matches) → inmutabilidad de v434: 2 h de
            //    ventana para incidencias y después congelado, ni editar ni
            //    borrar.
            //  · INFORMES (cronos_player_reports) → v435. Son puramente
            //    deportivos y los GESTIONAN Director Deportivo, Coordinador y
            //    Entrenador: se pueden borrar en cualquier momento. Lo que NO
            //    admiten es el evento retroactivo, porque un informe no es un
            //    partido en curso al que añadirle sucesos.
            const _lock = window.CronosMatchLock;
            const _esInforme = m.source === 'cronos_player_reports';
            const _congelado = _esInforme ? false : (!_lock || _lock.state(m) === 'frozen');
            const _restante = (!_esInforme && !_congelado && _lock) ? _lock.graceRemainingText(m) : '';
            const _chip = _esInforme
                ? `<span title="Informe deportivo: lo gestiona el cuerpo técnico del club" style="background:rgba(121,192,255,0.12); border:1px solid rgba(121,192,255,0.3); color:#79c0ff; font-size:0.62rem; font-weight:800; padding:2px 6px; border-radius:5px;">📋 INFORME</span>`
                : _congelado
                ? `<span title="Cerrado definitivamente: no admite cambios" style="background:rgba(125,133,144,0.15); border:1px solid rgba(125,133,144,0.35); color:#7d8590; font-size:0.62rem; font-weight:800; padding:2px 6px; border-radius:5px;">🔒 CERRADO</span>`
                : `<span title="Admite incidencias durante ${escapeHtml(_restante)} más" style="background:rgba(240,136,62,0.12); border:1px solid rgba(240,136,62,0.35); color:#f0883e; font-size:0.62rem; font-weight:800; padding:2px 6px; border-radius:5px;">✏️ ${escapeHtml(_restante)}</span>`;

            return `
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(121,192,255,0.2); border-radius:12px; padding:0.9rem 1.1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; margin-bottom:0.7rem; transition:border-color 0.2s;"
                     onmouseover="this.style.borderColor='rgba(121,192,255,0.45)'" onmouseout="this.style.borderColor='rgba(121,192,255,0.2)'">
                    <div>
                        <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.3rem;">
                            <span style="font-size:0.92rem; font-weight:800; color:white;">${escapeHtml(homeName)} vs ${escapeHtml(awayName)}</span>
                            <span style="background:rgba(121,192,255,0.12); border:1px solid rgba(121,192,255,0.3); color:#79c0ff; font-size:0.65rem; font-weight:700; padding:2px 6px; border-radius:5px;">
                                ${escapeHtml(cat)} ${escapeHtml(sub)}
                            </span>
                            ${_chip}
                        </div>
                        <div style="font-size:0.75rem; color:#7d8590; display:flex; align-items:center; gap:0.8rem;">
                            <span>📅 ${escapeHtml(dateStr)}</span>
                            <span>⚽ Marcador: <strong>${scoreHome} - ${scoreAway}</strong></span>
                            ${eventsCount > 0 ? `<span>📍 ${eventsCount} eventos</span>` : ''}
                        </div>
                    </div>
                    <div style="display:flex; gap:0.4rem; align-items:center;">
                        <button onclick="window.openMatchReplay('${m.id}')"
                            style="background:linear-gradient(135deg,#58a6ff,#1f6beb); border:none; color:white; padding:0.5rem 1.1rem; border-radius:8px; font-weight:800; font-size:0.8rem; cursor:pointer; box-shadow:0 4px 12px rgba(88,166,255,0.3); display:flex; align-items:center; gap:0.4rem;">
                            ▶️ Revivir Partido
                        </button>
                        ${(_congelado || _esInforme) ? '' : `
                        <button onclick="if(typeof openRetroactiveEventModal==='function') openRetroactiveEventModal('${m.id}');" title="Añadir evento retroactivo (batería/cobertura) — quedan ${escapeHtml(_restante)}"
                            style="background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.4); color:#58a6ff; padding:0.5rem 0.65rem; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;"
                            onmouseover="this.style.background='rgba(88,166,255,0.3)'" onmouseout="this.style.background='rgba(88,166,255,0.15)'">
                            ⏱️
                        </button>`}
                        ${_congelado ? '' : `
                        <button onclick="deleteFinishedMatchFromCloud('${m.id}', '${m.docId || ''}', event);" title="${_esInforme ? 'Eliminar informe' : 'Eliminar partido'}"
                            style="background:rgba(255,88,88,0.15); border:1px solid rgba(255,88,88,0.4); color:#ff5858; padding:0.5rem 0.65rem; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;"
                            onmouseover="this.style.background='rgba(255,88,88,0.3)'" onmouseout="this.style.background='rgba(255,88,88,0.15)'">
                            🗑️
                        </button>`}
                    </div>
                </div>`;
        };

        // Si es ENTRENADOR: mostrar la lista filtrada de su propia categoría
        if (isCoach) {
            let html = `
                <div style="max-width:850px;">
                    <div style="margin-bottom:1.2rem;">
                        <h3 style="margin:0; font-size:1.1rem; color:white;">🎬 Mis Partidos Terminados (${finishedMatches.length})</h3>
                        <div style="font-size:0.75rem; color:#7d8590; margin-top:3px;">
                            Revive los encuentros finalizados de tu categoría asignada.
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.3rem;">
                        ${finishedMatches.map(_renderMatchItem).join('')}
                    </div>
                </div>`;
            container.innerHTML = html;
            return;
        }

        // ── ÁRBOLES DE CATEGORÍAS Y SUBCATEGORÍAS PARA DIRECTOR / COORDINADOR ──
        const CAT_DEFINITIONS = [
            { id: 'prebenjamin', label: 'Prebenjamín', icon: '⚽' },
            { id: 'benjamin',    label: 'Benjamín', icon: '⚡' },
            { id: 'alevin',      label: 'Alevín', icon: '🌟' },
            { id: 'infantil',    label: 'Infantil', icon: '🔥' },
            { id: 'cadete',      label: 'Cadete', icon: '🏆' },
            { id: 'juvenil',      label: 'Juvenil', icon: '👑' },
            { id: 'regional',     label: 'Regional', icon: '🥇' },
            { id: 'regional_fem', label: 'Regional FEM', icon: '🩷' },
            { id: 'futurefem',    label: 'FUTureFEM', icon: '💗' }
        ];
        const SUB_LIST = ['A', 'B', 'C'];

        const byCatSub = new Map(); // catId -> (subId -> [matches])
        const unassigned = [];

        finishedMatches.forEach(m => {
            const cId = _normCat(m.category);
            const sId = _normSub(m.subcategory, m.category);
            if (!cId || !CAT_DEFINITIONS.some(c => c.id === cId)) {
                unassigned.push(m);
                return;
            }
            const subKey = SUB_LIST.includes(sId) ? sId : 'A';
            if (!byCatSub.has(cId)) byCatSub.set(cId, new Map());
            const subMap = byCatSub.get(cId);
            if (!subMap.has(subKey)) subMap.set(subKey, []);
            subMap.get(subKey).push(m);
        });

        let html = `
            <div style="max-width:850px;">
                <div style="margin-bottom:1.2rem;">
                    <h3 style="margin:0; font-size:1.1rem; color:white;">🎬 Partidos Terminados del Club (${finishedMatches.length})</h3>
                    <div style="font-size:0.75rem; color:#7d8590; margin-top:3px;">
                        Organizados jerárquicamente por Categoría y Subcategoría. Haz clic en cualquier grupo para desplegar sus partidos.
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.8rem;">
        `;

        CAT_DEFINITIONS.forEach((catDef, catIdx) => {
            const subMap = byCatSub.get(catDef.id) || new Map();
            let catTotalMatches = 0;
            subMap.forEach(arr => { catTotalMatches += arr.length; });

            const isExpanded = catTotalMatches > 0;

            html += `
                <div style="background:rgba(255,255,255,0.02); border:1px solid ${catTotalMatches > 0 ? 'rgba(88,166,255,0.3)' : 'rgba(255,255,255,0.08)'}; border-radius:14px; overflow:hidden;">
                    <div onclick="const b=this.nextElementSibling; b.style.display=(b.style.display==='none'?'block':'none'); this.querySelector('.arrow').textContent=(b.style.display==='none'?'►':'▼');"
                         style="padding:0.8rem 1.1rem; background:rgba(255,255,255,0.03); cursor:pointer; display:flex; align-items:center; justify-content:space-between; user-select:none;">
                        <div style="display:flex; align-items:center; gap:0.6rem;">
                            <span class="arrow" style="font-size:0.75rem; color:#79c0ff;">${isExpanded ? '▼' : '►'}</span>
                            <span style="font-size:1rem;">${catDef.icon}</span>
                            <span style="font-weight:800; color:white; font-size:0.95rem;">${catDef.label}</span>
                            <span style="background:${catTotalMatches > 0 ? 'rgba(63,185,80,0.18)' : 'rgba(255,255,255,0.06)'}; color:${catTotalMatches > 0 ? '#3fb950' : '#7d8590'}; font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:12px;">
                                ${catTotalMatches} ${catTotalMatches === 1 ? 'partido' : 'partidos'}
                            </span>
                        </div>
                    </div>
                    <div style="display:${isExpanded ? 'block' : 'none'}; padding:0.8rem; border-top:1px solid rgba(255,255,255,0.05);">
            `;

            SUB_LIST.forEach(subId => {
                const subMatches = subMap.get(subId) || [];
                const hasSubMatches = subMatches.length > 0;

                html += `
                    <div style="margin-bottom:0.6rem; border:1px solid ${hasSubMatches ? 'rgba(121,192,255,0.2)' : 'rgba(255,255,255,0.05)'}; border-radius:10px; overflow:hidden;">
                        <div onclick="const b=this.nextElementSibling; if(b){ b.style.display=(b.style.display==='none'?'block':'none'); this.querySelector('.sub-arrow').textContent=(b.style.display==='none'?'►':'▼'); }"
                             style="padding:0.55rem 0.9rem; background:rgba(0,0,0,0.2); cursor:pointer; display:flex; align-items:center; justify-content:space-between; user-select:none;">
                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                <span class="sub-arrow" style="font-size:0.7rem; color:#58a6ff;">${hasSubMatches ? '▼' : '►'}</span>
                                <span style="font-size:0.85rem; font-weight:700; color:white;">Subcategoría ${subId}</span>
                                <span style="font-size:0.68rem; color:${hasSubMatches ? '#79c0ff' : '#4d5566'}; font-weight:700;">
                                    (${subMatches.length})
                                </span>
                            </div>
                        </div>
                        <div style="display:${hasSubMatches ? 'block' : 'none'}; padding:0.6rem 0.6rem 0.1rem 0.6rem;">
                            ${hasSubMatches ? subMatches.map(_renderMatchItem).join('') : '<div style="font-size:0.75rem; color:#4d5566; padding:0.4rem 0.6rem;">Sin partidos en esta subcategoría.</div>'}
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        // ── Sección para Partidos sin categoría asignada ──────────────────
        if (unassigned.length > 0) {
            html += `
                <div style="margin-top:0.6rem; border:1px solid rgba(255,215,0,0.25); border-radius:14px; overflow:hidden;">
                    <div style="padding:0.8rem 1.1rem; background:rgba(255,215,0,0.06); display:flex; align-items:center; gap:0.6rem;">
                        <span style="font-size:0.95rem; font-weight:800; color:#ffd700;">⚠️ Sin categoría asignada (${unassigned.length})</span>
                    </div>
                    <div style="padding:0.8rem;">
                        ${unassigned.map(_renderMatchItem).join('')}
                    </div>
                </div>
            `;
        }

        html += `</div></div>`;
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = `<div style="color:#ff5858;padding:2rem;">⚠️ Error cargando partidos terminados: ${escapeHtml(e.message)}</div>`;
    }
}

window._renderFinishedMatchesTab = _renderFinishedMatchesTab;

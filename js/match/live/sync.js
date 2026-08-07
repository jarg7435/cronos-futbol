// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — MATCH/LIVE/SYNC
// Live sync, Firestore push, stop sync, live view, sharing
// Extraído de app.js (líneas 1552-1957)
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN EN VIVO — Firestore
// ══════════════════════════════════════════════════════════════════

async function cleanupStaleMatches() {
    try {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) return;
        // v434 · `deleteDoc` ya no se importa: el borrado desde el cliente se
        // retiró (ver abajo). `serverTimestamp` entra para sellar finishedAt.
        const { collection, query, where, getDocs,
                updateDoc, doc, serverTimestamp } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

        // v431 · ACOTADO AL CLUB PROPIO. Esto era el segundo escaneo completo
        // de la colección: `getDocs(collection(fa.db,'live_matches'))` sin
        // filtro, en el arranque de la app de CADA usuario, trayéndose los
        // partidos de todos los clubes —con nombres y dorsales de menores— al
        // navegador de un entrenador que solo necesita los suyos.
        //
        // Ya no hace falta que barra todo: desde v431 la limpieza de verdad la
        // hace `cleanupLiveMatches` en el servidor (functions/index.js), cada
        // hora y para toda la colección. Esto se queda como red de seguridad
        // local para que el propio club no vea fantasmas entre dos pasadas.
        // Sin clubId no hay nada que acotar y se sale: el servidor se encarga.
        const _clubIdLimpieza = window._cronosCurrentUser?.clubId;
        if (!_clubIdLimpieza) return;
        const snap = await getDocs(query(
            collection(fa.db, 'live_matches'),
            where('clubId', '==', _clubIdLimpieza)
        ));

        let closed = 0;
        const promises = [];

        snap.forEach(d => {
            const data    = d.data();
            const updated = data.updatedAt?.toDate?.() || new Date(0);

            // v434 · SE RETIRA EL BORRADO A 7 DÍAS DESDE EL CLIENTE.
            // Ya era inalcanzable desde v431 —`cleanupLiveMatches` borra en
            // servidor a las 10 h, así que nunca hay nada de 7 días— y desde
            // v434 es además IMPOSIBLE: un partido congelado no lo puede borrar
            // nadie salvo el SuperAdmin, de modo que ese deleteDoc solo podía
            // producir errores de permisos tragados por el .catch(). Lo que
            // queda es cerrar los abandonados, que sigue siendo legítimo porque
            // el documento todavía está 'active' y la regla lo permite.
            if (data.status === 'active' && updated < fourHoursAgo) {
                // Más de 4 horas sin actualizar → cerrar como finalizado.
                // ⚠️ Se sella `finishedAt` aquí también. Sin el sello, el ancla
                // de la ventana de gracia y del borrado caía en `updatedAt`,
                // que en un partido abandonado es la hora del último latido: el
                // partido nacía ya congelado y con la retención medio gastada.
                // La Cloud Function sí lo sellaba; este camino no, y son el
                // mismo cierre por las mismas 4 h.
                promises.push(
                    updateDoc(doc(fa.db, 'live_matches', d.id), {
                        status: 'finished',
                        finishedAt: serverTimestamp(),
                        autoClosed: true
                    })
                        .then(() => closed++)
                        .catch(() => {})
                );
            }
        });
        await Promise.all(promises);

    } catch(e) { if(window._CRONOS_DEBUG) console.warn('cleanupStaleMatches:', e.message); }
}

// Alineación inicial pendiente de escribir. La rellena startLiveSync al
// empezar un partido NUEVO y la consume el primer pushLiveSnapshot, que es la
// escritura que sí lleva clubId/createdBy y por tanto pasa las reglas. Se
// vacía en cuanto se manda, para no reescribirla en los latidos siguientes.
let _pendingInitialLineup = null;

// FIX (fidelidad de "Revivir", 2026-07-29): forma canónica con la que un
// jugador viaja a Firestore. Antes esta proyección estaba escrita a mano
// dentro de pushLiveSnapshot; ahora la comparten el snapshot de cada latido
// y el de la ALINEACIÓN INICIAL, para que no puedan divergir.
function _mapPlayerForSnapshot(p) {
    return {
        id:      p.id,
        number:  p.number,
        name:    p.name,
        team:    p.team,
        status:  p.status,    // 'field' | 'bench'
        time:    p.time,
        goals:   p.goals   || 0,
        cards:   p.cards   || 'ninguna',
        injured: p.injured || false,
        x:       p.x       || 0,
        y:       p.y       || 0,
        color:       p.color       || (p.team === 'home' ? COLORS.home.primary : COLORS.away.primary),
        shortsColor: p.shortsColor || (p.team === 'home' ? COLORS.home.shorts  : COLORS.away.shorts),
        textColor:   p.textColor   || (p.team === 'home' ? COLORS.home.text    : COLORS.away.text)
    };
}

async function startLiveSync() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) return;

    // FIX (auditoría 2026-07-22): startLiveSync() debe ser IDEMPOTENTE para el
    // MISMO partido. v266B recalculaba el sufijo de hora (_hourSlug) en CADA
    // llamada, así que reiniciar el sync de un partido YA EN CURSO (reconexión,
    // doble disparo desde goToTitularSelection()+startMatchWithConvocation(), o
    // cualquier futura ruta de "resume tras pérdida de cobertura/batería")
    // generaba un liveMatchId DISTINTO al de la primera llamada → el matchId
    // de los informes dejaba de ser estable → reaparece el bug de informes
    // duplicados al padre (P1 v167/v168, ya corregido dos veces antes).
    // liveMatchId solo se resetea a null cuando arranca un partido NUEVO de
    // verdad (startMatchWithConvocation lo hace antes de llamar aquí), así que
    // "ya tiene valor" == "mismo partido en curso": se reutiliza TAL CUAL
    // (incluida la hora ya fijada la primera vez) y se evita repetir el
    // borrado de events / el reset del guard de despacho, que solo deben
    // ocurrir UNA vez, al empezar el partido.
    const _isNewMatch = !liveMatchId;

    if (_isNewMatch) {
        // Generar ID legible: nombre-equipo-fecha  (ej: atletico-20032026-a3f)
        // Así en el historial y en los enlaces se identifica el equipo de un vistazo
        const slugify = (str) => (str || 'equipo')
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar acentos
            .replace(/[^a-z0-9]+/g, '-')                        // solo letras y números
            .replace(/^-+|-+$/g, '')                            // sin guiones al inicio/fin
            .substring(0, 20);                                   // máximo 20 chars

        const teamSlug = slugify(TEAM_NAMES.home);
        const now      = new Date();
        const dateSlug = String(now.getDate()).padStart(2,'0') +
                         String(now.getMonth()+1).padStart(2,'0') +
                         now.getFullYear();
        // v266: Añadir la HORA de creación al matchId para que cada partido
        // tenga un ID Único. Antes, dos partidos el mismo día con el mismo
        // equipo y rival tenían el mismo matchId, lo que hacía que los eventos
        // del partido anterior se mezclaran con los del nuevo. Se calcula UNA
        // sola vez aquí (solo al arrancar un partido nuevo de verdad), nunca
        // en cada llamada.
        const _hourSlug = String(now.getHours()).padStart(2,'0') +
                          String(now.getMinutes()).padStart(2,'0');
        // FIX (Problema 1): ID DETERMINISTA — SIN Math.random(). Deriva el
        // sufijo de uid+fecha+equipo (+rival+convocatoria).
        const _uidSlug = (window._cronosCurrentUser && window._cronosCurrentUser.uid) || 'u';
        liveMatchId = (typeof window._cronosBuildLiveMatchId === 'function')
            ? window._cronosBuildLiveMatchId({ teamName: TEAM_NAMES.home, rivalName: TEAM_NAMES.away, date: now, uid: _uidSlug }) + '-' + _hourSlug
            : `${teamSlug}-${dateSlug}-${(window._cronosStableSlug ? window._cronosStableSlug(_uidSlug+'|'+teamSlug+'|'+dateSlug, 4) : '0000')}-${_hourSlug}`;
    }
    // v465 · ESTA PESTAÑA RECLAMA EL PARTIDO. Es la pieza que ata el estado
    // local a quien lo está jugando: a partir de aquí el autoguardado escribe
    // en `cronos_active_match_v2::<liveMatchId>` y, al recargarse, la pestaña
    // recupera ESTE partido y no el que tenga abierto la de al lado. Vive en
    // sessionStorage —lo único que NO comparten dos pestañas del mismo
    // usuario—, así que sobrevive a la recarga sin pisar a nadie.
    // Se llama también cuando el partido NO es nuevo: una reconexión tiene que
    // volver a reclamarlo, porque la pestaña puede haberse recargado por medio.
    try { window._cronosMatchSlots?.setTabMatchId(liveMatchId); } catch (e) {}
    liveIsActive = true;

    if (_isNewMatch) {
        // E4: nuevo partido en vivo → liberar el guard de despacho de informes.
        window._cronosLastDispatchedMatch = null;

        // v265: Limpiar el array events del documento en Firestore al empezar
        // un partido nuevo. Usar updateDoc (NO setDoc merge) porque merge: true
        // NO sobrescribe arrays — los combina. updateDoc SÍ reemplaza el array.
        window._cronosMatchEvents = [];
        _eventsLoadedFromFirestore = false;

        // FIX (fidelidad de "Revivir", 2026-07-29): la ALINEACIÓN INICIAL se
        // guarda AQUÍ y en ningún otro sitio. `players` se reescribe en cada
        // latido de 5 s con el estado ACTUAL, así que el documento solo
        // conserva la ÚLTIMA foto del partido; el visor de repetición la usaba
        // como punto de partida y por eso pintaba el once FINAL en el minuto 0
        // (el que entró en el 60' aparecía en el campo desde el segundo 0).
        // Este bloque solo se ejecuta con `_isNewMatch`, o sea una vez por
        // partido: reabrir la app o reconectar NO lo sobrescribe.
        // Momento correcto: startLiveSync() se invoca 800 ms DESPUÉS de
        // renderPlayers() (ai/import.js:799,889), con las posiciones ya
        // asignadas por applyFormationPreset.
        //
        // Guarda `typeof`: `players` y `activeFormationKey` son globales de
        // app-init.js (que carga el PRIMERO, así que en el navegador existen
        // siempre). Leerlos por nombre pelado sin guarda haría que, si alguna
        // vez no estuvieran declarados, un ReferenceError abortase
        // startLiveSync ENTERA — sin limpiar eventos, sin snapshot y sin
        // partido en vivo. Guardar la alineación es una mejora: nunca debe
        // poder tumbar el arranque del partido.
        //
        // ⚠️ NO se escribe aquí, se DEJA EN ESPERA para el primer
        // pushLiveSnapshot. Motivo, medido contra las reglas: en un partido
        // nuevo el documento todavía NO existe, así que el updateDoc de abajo
        // falla y cae al setDoc de respaldo... que escribe un doc SIN clubId ni
        // createdBy, y eso lo DENIEGA `allow create` de live_matches (el mismo
        // caso h3 que fija scripts/test_sec_c3_live_matches_rules.js). La
        // alineación se habría perdido en silencio justo en los partidos
        // nuevos, que son todos. pushLiveSnapshot sí manda clubId/createdBy/
        // coachEmail, así que su escritura pasa las reglas y además crea el
        // documento; se ejecuta inmediatamente después (unas líneas más abajo).
        _pendingInitialLineup = {
            initialPlayers: (typeof players !== 'undefined' && Array.isArray(players))
                ? players.map(_mapPlayerForSnapshot)
                : [],
            initialFormation: (typeof activeFormationKey !== 'undefined' && activeFormationKey) || ''
        };

        try {
            const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            await updateDoc(doc(fa.db, 'live_matches', liveMatchId), { events: [] });
            console.log('[v265] Array events limpiado para nuevo partido:', liveMatchId);
        } catch(e) {
            // Si el documento no existe, updateDoc falla. Crearlo con setDoc.
            try {
                const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                await setDoc(doc(fa.db, 'live_matches', liveMatchId), { events: [] }, { merge: true });
                console.log('[v265] Array events limpiado (setDoc fallback):', liveMatchId);
            } catch(e2) {
                console.warn('[v265] Error limpiando events:', e2);
            }
        }
    }

    // Guardar el snapshot inicial
    await pushLiveSnapshot('active');

    // v276 (unificación): latido cada 5000ms — SOLO con isRunning (en pausa/descanso
    // los cambios ya se auto-flushean por liveSyncOnAction/liveSyncFlushNow, así que
    // no hace falta latir en pausa). Guard anti-doble-intervalo: si startLiveSync se
    // llama 2× (p.ej. share-modal + import), evita dejar timers huérfanos.
    if (liveSyncTimer) clearInterval(liveSyncTimer);
    liveSyncTimer = setInterval(() => {
        if (liveIsActive && isRunning) pushLiveSnapshot('active');
    }, 5000);

    // Mostrar botón de compartir en el header
    updateLiveButton(true);
}

// v221: caché de umbrales del club para evitar leer Firestore en cada
// pushLiveSnapshot (que se llama cada 2-5s). TTL de 60s: si el Director
// Deportivo cambia los umbrales, como mucho tardan 60s en reflejarse en
// el snapshot en vivo. Sin este caché, el snapshot podría enviarse con
// timerThresholds: null si window._clubTimerThresholds no estaba cargado
// en el navegador del coach (p.ej. si el coach abrió el partido antes
// de que el Director guardara los umbrales nuevos).
let _clubThresholdsCache = null; // {value, fetchedAt, clubId}
const _CLUB_THRESHOLDS_TTL_MS = 60_000; // 60 segundos

async function _fetchClubTimerThresholds(db, clubId) {
    if (!clubId || !db) {
        console.warn('[sync v221] _fetchClubTimerThresholds: clubId o db vacíos. clubId=', clubId);
        return null;
    }
    const now = Date.now();
    // Devolver caché si es válido (mismo clubId y no expirado).
    if (_clubThresholdsCache &&
        _clubThresholdsCache.clubId === clubId &&
        (now - _clubThresholdsCache.fetchedAt) < _CLUB_THRESHOLDS_TTL_MS) {
        return _clubThresholdsCache.value;
    }
    try {
        const { doc, getDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await getDoc(doc(db, 'clubs', clubId));
        if (snap.exists()) {
            const data = snap.data() || {};
            const t = data.timerThresholds || {};
            const value = {
                red:    (typeof t.red    === 'number' && !isNaN(t.red))    ? t.red    : 33,
                yellow: (typeof t.yellow === 'number' && !isNaN(t.yellow)) ? t.yellow : 50,
                categoryConfigs: data.categoryConfigs || null,
                extras: data.extras || null
            };
            // Actualizar TAMBIÉN window._clubTimerThresholds y window._clubCategoryConfigs
            window._clubTimerThresholds = value;
            if (data.categoryConfigs) window._clubCategoryConfigs = data.categoryConfigs;
            _clubThresholdsCache = { value, fetchedAt: now, clubId, fullData: data };
            // v224: log silenciado en producción (era de diagnóstico v221).
            // console.log('[sync v221] Umbrales leídos de Firestore para club', clubId, ':', value);
            return value;
        } else {
            console.warn('[sync v221] clubs/' + clubId + ' NO existe en Firestore');
        }
    } catch(e) {
        console.warn('[sync v221] Error fetching club timer thresholds:', e);
    }
    return null;
}

// v234: cargar eventos existentes de Firestore al iniciar, para no sobrescribirlos.
// Esto evita que al cerrar y reabrir la app del coach, el primer snapshot
// borre el historial de eventos guardado en Firestore.
// v234: usar una promesa para evitar race conditions entre múltiples pushLiveSnapshot.
let _eventsLoadedFromFirestore = false;
let _eventsLoadPromise = null;
async function _loadEventsFromFirestore() {
    if (_eventsLoadedFromFirestore) return;
    if (_eventsLoadPromise) return _eventsLoadPromise;
    _eventsLoadPromise = (async () => {
        try {
            const { doc, getDoc } = await import(
                'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            const _db = window._cronos_auth?.db;
            if (!_db || !liveMatchId) { _eventsLoadedFromFirestore = true; return; }
            const snap = await getDoc(doc(_db, 'live_matches', liveMatchId));
            if (snap.exists()) {
                const data = snap.data() || {};
                const existingEvents = data.events || [];
                if (Array.isArray(existingEvents) && existingEvents.length > 0) {
                    window._cronosMatchEvents = window._cronosMatchEvents || [];
                    const existingTimestamps = new Set(existingEvents.map(e => e.timestamp));
                    const newLocalEvents = window._cronosMatchEvents.filter(e => !existingTimestamps.has(e.timestamp));
                    window._cronosMatchEvents = existingEvents.concat(newLocalEvents);
                    console.log('[sync v234] Eventos cargados de Firestore:', existingEvents.length);
                }
            }
        } catch(e) {
            console.warn('[sync v234] Error cargando eventos de Firestore:', e);
        } finally {
            _eventsLoadedFromFirestore = true;
            _eventsLoadPromise = null;
        }
    })();
    return _eventsLoadPromise;
}

async function pushLiveSnapshot(status = 'active') {
    const fa = window._cronos_auth;
    if (!fa || !fa.db || !liveMatchId) return;

    try {
        const { setDoc, doc, serverTimestamp } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // v232: cargar eventos existentes de Firestore antes del primer push
        // para no sobrescribirlos con un array vacío.
        if (!_eventsLoadedFromFirestore) {
            await _loadEventsFromFirestore();
        }

        const scoreHome = document.getElementById('score-home')?.textContent || '0';
        const scoreAway = document.getElementById('score-away')?.textContent || '0';

        const _clubId = window._cronosCurrentUser?.clubId;
        const _thresholds = await _fetchClubTimerThresholds(fa.db, _clubId);

        const snapCat = window._cronosCurrentUser?.category || window._cronosCurrentUser?._activeRoleData?.category || window._cronosCurrentUser?.categoryLabel || null;
        const snapSub = window._cronosCurrentUser?.subcategory || window._cronosCurrentUser?._activeRoleData?.subcategory || null;

        // v463 · CATEGORÍA DEL PARTIDO (la del panel de creación), aparte de la
        // del entrenador. La lista de Partidos en Vivo la pinta encima del
        // cronómetro para poder distinguir varios partidos simultáneos.
        //
        // ⚠️ VAN EN CAMPOS PROPIOS Y NO SE TOCAN `category`/`subcategory`. No es
        // duplicar por duplicar: `category` es la entrada del SEMÁFORO tanto en
        // live.html (`_timerColorFor`) como en la repetición, y las dos formas
        // NO resuelven al mismo grupo. `getCategoryGroupKey` mira primero si la
        // cadena contiene 'f7', así que el valor del panel `f7_infantil` cae en
        // el grupo 'f7' mientras que el del perfil, 'infantil', cae en
        // 'infantil_a' — con umbrales distintos. Reutilizar el mismo campo para
        // pintar una etiqueta le cambiaría los colores del semáforo a los
        // equipos de Infantil/Cadete que juegan F7, en un partido en curso.
        //
        // El orden de la cascada es el mismo que usa `getTimerColor`
        // (js/core/app-init.js): manda el DOM del panel, y `_currentMatchCategory`
        // es el respaldo para cuando el modal ya se cerró o el partido se
        // recuperó de localStorage.
        const _dom = (id) => {
            try { return document.getElementById(id)?.value || ''; } catch(e) { return ''; }
        };
        const _matchCat = _dom('match-category')    || window._currentMatchCategory    || '';
        const _matchSub = _dom('match-subcategory') || window._currentMatchSubcategory || '';

        const _me = window._cronosCurrentUser;
        const _extras = (_me && _me.extras) || (_thresholds && _thresholds.extras) || {};
        let _semaforoActive = true;
        if (_extras.semaforo === false) {
            _semaforoActive = false;
        } else {
            const getGroupFn = (typeof window.getCategoryGroupKey === 'function')
                ? window.getCategoryGroupKey
                : function(c, s) { return 'f7'; };
            const groupKey = getGroupFn(snapCat, snapSub);
            if (groupKey === 'juvenil' || groupKey === 'regional') {
                _semaforoActive = false;
            } else {
                const configs = window._clubCategoryConfigs || (_thresholds && _thresholds.categoryConfigs) || {};
                const groupCfg = configs[groupKey];
                if (groupCfg && groupCfg.semaforoActive === false) {
                    _semaforoActive = false;
                }
            }
        }

        const snapshot = {
            id:          liveMatchId,
            status:      status,          // 'active' | 'finished'
            updatedAt:   serverTimestamp(),
            createdBy:   window._cronosCurrentUser?.uid   || '',
            coachEmail:  window._cronosCurrentUser?.email || '',
            clubId:      window._cronosCurrentUser?.clubId   || null,
            clubName:    window._cronosCurrentUser?.clubName || null,

            // Categoría y Subcategoría del Entrenador
            category:    window._cronosCurrentUser?.category || window._cronosCurrentUser?._activeRoleData?.category || window._cronosCurrentUser?.categoryLabel || null,
            subcategory: window._cronosCurrentUser?.subcategory || window._cronosCurrentUser?._activeRoleData?.subcategory || null,

            // v463 · Categoría y Subcategoría DEL PARTIDO, tal y como las dejó el
            // entrenador en el panel de creación. Sólo para mostrar (la etiqueta
            // sobre el cronómetro de la tarjeta en vivo); ver el comentario de
            // arriba para por qué no comparten campo con las de encima.
            // Se cae al perfil del entrenador cuando el panel no las resuelve,
            // para que la etiqueta no desaparezca al recuperar un partido.
            matchCategory:    _matchCat || snapCat || null,
            matchSubcategory: _matchSub || snapSub || null,

            // Partido
            mode:        currentMode,
            phase:       matchPhase,
            isRunning:   isRunning,
            timeH1:      masterTimeH1,
            timeH2:      masterTimeH2,
            // v220: usar `|| 1800` para que si half1MaxTime/half2MaxTime son 0
            // (caso de corrupción de estado) se envíe 1800 y no 0. Antes se
            // usaba `typeof !== 'undefined'` que enviaba 0 tal cual, y entonces
            // live.html hacía `data.half1MaxTime || (mode==='f7'?1800:2400)`
            // → en F11 caía a 2400 mientras el coach usaba 1800 → colores
            // distintos para el mismo jugador en coach vs live.
            half1MaxTime: (typeof half1MaxTime !== 'undefined' && half1MaxTime > 0) ? half1MaxTime : 1800,
            half2MaxTime: (typeof half2MaxTime !== 'undefined' && half2MaxTime > 0) ? half2MaxTime : 1800,
            // v221: umbrales del semáforo configurados por el Director Deportivo.
            // Se leen DIRECTAMENTE de Firestore (con caché 60s en _fetchClubTimerThresholds)
            // para garantizar que siempre estén frescos, incluso si el Director
            // cambió los umbrales DESPUÉS de que el coach abriera el partido.
            // Antes (v217) usábamos window._clubTimerThresholds que podía ser null
            // o estar desactualizado → el live caía a defaults (33/50) → colores
            // distintos entre coach y live para el mismo jugador.
            timerThresholds: (_thresholds && typeof _thresholds === 'object')
                ? {
                    red:    Number(_thresholds.red)    || 33,
                    yellow: Number(_thresholds.yellow) || 50
                  }
                : null,
            // v427: bandera de semáforo ACTIVO/INACTIVO resuelta arriba
            // (_semaforoActive). Hasta ahora se calculaba y NO se escribía en
            // ningún sitio: era una variable muerta. live.html:_timerColorFor
            // pregunta por `data.semaforoActive` desde v217, así que la rama
            // estaba comprobando un campo que jamás llegaba, y el visor tenía
            // que reconstruir la decisión releyendo clubs/{clubId} por su
            // cuenta. Persistirla aquí es lo que permite que la REPETICIÓN
            // (js/match/replay/replay-player.js) coloree los cronómetros con la
            // configuración que el partido tenía DE VERDAD el día que se jugó,
            // y no con la que el club tenga hoy: los umbrales pueden haber
            // cambiado, o el Director puede haber apagado el semáforo después.
            // Los partidos ya grabados no llevan el campo y siguen resolviéndose
            // por la cascada de respaldo (categoría → categoryConfigs → extras).
            semaforoActive: _semaforoActive,
            // phaseStartedAt: instante absoluto (epoch ms) en que arrancó la parte
            // ACTUAL. Se ancla a lastTickTime (no a Date.now() crudo) sumando los
            // segundos que el tick no pudo procesar por throttling del navegador
            // (pestaña en background). Así el valor es ESTABLE e independiente del
            // estado del cliente: live.html cuenta de forma autónoma aunque el
            // entrenador minimice o cierre la app. En pausa/descanso/fin es null.
            phaseStartedAt: (isRunning && (matchPhase === '1st_half' || matchPhase === '2nd_half'))
                ? (Date.now() - (
                    (matchPhase === '2nd_half' ? masterTimeH2 : masterTimeH1)
                    + ((typeof lastTickTime !== 'undefined' && lastTickTime > 0)
                        ? Math.max(0, Math.floor((Date.now() - lastTickTime) / 1000))
                        : 0)
                  ) * 1000)
                : null,
            formation:   activeFormationKey || '',
            myTeamRole:  window._userTeamRole || 'home',

            // Equipos
            homeTeam: {
                name:     TEAM_NAMES.home,
                score:    parseInt(scoreHome) || 0,
                color:    COLORS.home.primary,
                shorts:   COLORS.home.shorts,
                textColor:COLORS.home.text
            },
            awayTeam: {
                name:     TEAM_NAMES.away,
                score:    parseInt(scoreAway) || 0,
                color:    COLORS.away.primary,
                shorts:   COLORS.away.shorts,
                textColor:COLORS.away.text
            },

            // Jugadores (campo + banquillo)
            // v276 (unificación): incluir los colores por jugador. Antes solo los
            // emitía la copia de firestore-sync.js; live.html los consume con
            // fallback a los colores del equipo (safeColor), así que es una mejora
            // con degradación elegante.
            players: players.map(_mapPlayerForSnapshot),

            // v234: historial de eventos del partido persistente en Firestore.
            // Permite que un usuario que entre tarde al partido pueda ver todos
            // los eventos anteriores (goles, tarjetas, lesiones, cambios).
            // v234: NO incluir `events` en el snapshot si el array local está
            // vacío, para no sobrescribir los eventos guardados en Firestore.
            // Esto es crítico: si el coach reabre la app y _cronosMatchEvents
            // está vacío, enviar events: [] borraría el historial.
        };

        // v246: NUNCA incluir events en el snapshot. Los eventos se escriben
        // exclusivamente con arrayUnion desde _registerMatchEvent. Si los
        // incluyéramos aquí, sobrescribiríamos el array acumulado por arrayUnion.
        // El arrayUnion añade sin sobrescribir; setDoc merge reemplaza arrays enteros.

        // v230: si el snapshot no tiene la marca de tiempo del partido actual,
        // calcularla a partir de masterTimeH1/masterTimeH2/matchPhase.
        const _currentMatchMinute = (() => {
            try {
                const h1 = (typeof masterTimeH1 !== 'undefined') ? masterTimeH1 : 0;
                const h2 = (typeof masterTimeH2 !== 'undefined') ? masterTimeH2 : 0;
                const phase = (typeof matchPhase !== 'undefined') ? matchPhase : '1st_half';
                const total = (phase === '2nd_half' || phase === 'finished') ? (h1 + h2) : h1;
                const part = (phase === '2nd_half' || phase === 'finished') ? '2T' : '1T';
                const m = Math.floor(total / 60).toString().padStart(2, '0');
                const s = (total % 60).toString().padStart(2, '0');
                return part + ' ' + m + ':' + s;
            } catch(e) { return ''; }
        })();

        // v224: log silenciado en producción (era de diagnóstico v221/v222).
        // console.log('[sync v221] Snapshot enviado. timerThresholds=', snapshot.timerThresholds,
        //             '| half1Max=', snapshot.half1MaxTime, '| half2Max=', snapshot.half2MaxTime,
        //             '| mode=', snapshot.mode);

        // FIX (fidelidad de "Revivir", 2026-07-29): la ALINEACIÓN INICIAL viaja
        // con este snapshot, que sí lleva clubId/createdBy/coachEmail y por eso
        // pasa `allow create`/`allow update` de live_matches. Se adjunta UNA
        // sola vez (el stash se vacía justo después), así que los latidos
        // posteriores no la tocan: `players` seguirá reflejando el estado
        // actual, e `initialPlayers` se queda congelada en el once de salida.
        if (_pendingInitialLineup) {
            snapshot.initialPlayers   = _pendingInitialLineup.initialPlayers;
            snapshot.initialFormation = _pendingInitialLineup.initialFormation;
            _pendingInitialLineup = null;
        }

        // ════════════════════════════════════════════════════════════════
        // v431 · SELLO DE FINALIZACIÓN, ancla del borrado automático a 10 h
        // ════════════════════════════════════════════════════════════════
        // El borrado se ancla a CUÁNDO TERMINÓ el partido, no a la última
        // modificación del documento. Ese instante no se guardaba en ningún
        // sitio: sólo existía `updatedAt`, que reescribe cualquier retoque
        // posterior y habría ido aplazando el borrado indefinidamente.
        //
        // ⚠️ SE AÑADE FUERA DEL OBJETO, CON UN `if`, Y NO COMO
        // `finishedAt: status === 'finished' ? x : undefined`.
        // El SDK de Firestore **LANZA** con un valor `undefined`
        // ("Unsupported field value: undefined") salvo que se haya creado la
        // instancia con `ignoreUndefinedProperties: true`, y en este proyecto
        // NO se usa esa opción en ningún sitio. Con el ternario, cada latido
        // de un partido activo habría reventado la sincronización entera.
        //
        // Al ir dentro del `if`, el campo simplemente no viaja mientras el
        // partido está en curso, y el `merge: true` deja intacto el sello ya
        // guardado: no se pisa a sí mismo ni se borra al reabrir la app.
        if (status === 'finished') {
            snapshot.finishedAt = serverTimestamp();
            // Caducidad explícita, por si algún día se activa la política TTL
            // nativa de Firestore como red de seguridad sin coste. La TTL
            // nativa borra "dentro de las 24 h siguientes", no a la hora
            // exacta; por eso el borrado fino lo hace la función programada.
            snapshot.expireAt = new Date(Date.now() + 10 * 60 * 60 * 1000);
        }

        await setDoc(doc(fa.db, 'live_matches', liveMatchId), snapshot, { merge: true });
    } catch (err) {
        console.warn('Error sync live:', err.message);
        // v467 · Si el cliente de Firestore está TERMINADO, esto no es un fallo
        // pasajero: no se recupera solo y el latido lo repetiría cada 5 s para
        // siempre, sin sincronizar ni un suceso y sin decírselo a nadie. Era la
        // emergencia de v466. La única salida es recargar, y desde v465 la
        // pestaña recupera su partido entero al volver.
        if (typeof window._cronosRecuperaSiClienteMuerto === 'function') {
            window._cronosRecuperaSiClienteMuerto(err, 'pushLiveSnapshot');
        }
    }
}

async function stopLiveSync() {
    if (!liveIsActive) return;
    liveIsActive = false;
    if (liveSyncTimer) { clearInterval(liveSyncTimer); liveSyncTimer = null; }
    
    // Si el partido REALMENTE ha terminado (fase finished), se marca como finished.
    // De lo contrario, se queda como 'active' para que siga recuperándolo!
    const finalStatus = (typeof matchPhase !== 'undefined' && matchPhase === 'finished') ? 'finished' : 'active';
    await pushLiveSnapshot(finalStatus);
    
    updateLiveButton(false);
}

function updateLiveButton(active) {
    let indicator = document.getElementById('live-status-indicator');
    if (!indicator) {
        // Crear el contenedor del indicador si no existe
        indicator = document.createElement('div');
        indicator.id = 'live-status-indicator';
        indicator.style.cssText =
            'display:none; align-items:center; gap:8px; padding:0.4rem 0.8rem; ' +
            'background:rgba(255,88,88,0.1); border:1px solid rgba(255,88,88,0.3); ' +
            'border-radius:20px; color:#ff5858; font-size:0.7rem; font-weight:800; ' +
            'letter-spacing:0.5px; transition:all 0.3s; margin-right: 8px;';
        
        // Insertar en la zona de acciones del header
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) headerActions.insertBefore(indicator, headerActions.firstChild);
        
        // Añadir estilos de animación si no existen
        if (!document.getElementById('live-pulse-style')) {
            const s = document.createElement('style');
            s.id = 'live-pulse-style';
            s.textContent = `
                @keyframes liveDotPulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.3); opacity: 0.5; }
                    100% { transform: scale(1); opacity: 1; }
                }
            `;
            document.head.appendChild(s);
        }
    }

    if (active) {
        indicator.style.display = 'inline-flex';
        indicator.innerHTML = `
            <span style="width:8px; height:8px; background:#ff5858; border-radius:50%; 
                         box-shadow:0 0 8px #ff5858; animation: liveDotPulse 1.5s ease-in-out infinite;"></span>
            EN VIVO
        `;
    } else {
        indicator.style.display = 'none';
    }

    // ELIMINAR el antiguo botón de compartir si existiera para no duplicar
    const oldBtn = document.getElementById('btn-live-share');
    if (oldBtn) oldBtn.remove();
}

function openLiveView() {
    // Abrir la pantalla de partidos en vivo en una nueva pestaña
    const liveUrl = location.origin + location.pathname.replace('index.html','') + 'live.html';
    window.open(liveUrl, '_blank');
}

function showLiveShareModal() {
    if (!liveMatchId) {
        // No hay partido activo — preguntar si quiere iniciarlo
        if (confirm('¿Iniciar la transmisión en vivo para que el Director Deportivo pueda seguir el partido?')) {
            startLiveSync();
        }
        return;
    }

    const liveUrl = `${location.origin}${location.pathname.replace('index.html','')}live.html?match=${liveMatchId}`;

    // Recoger contactos con acceso EN VIVO (staff + padres ya se envían por Firestore)
    const liveContacts = (emailConfig.contacts || []).filter(c => c.tags && c.tags.includes('live'));
    const liveCount    = liveContacts.length;

    const liveContactsHtml = liveCount > 0
        ? `<div style="background:rgba(255,88,88,0.06);border:1px solid rgba(255,88,88,0.2);
                        border-radius:8px;padding:0.7rem 0.9rem;margin-bottom:1rem;">
               <p style="font-size:0.7rem;color:#ff5858;font-weight:700;margin:0 0 0.5rem;">
                   📡 ACCESO EN VIVO AUTORIZADO (${liveCount})
               </p>
               <div style="display:flex;flex-direction:column;gap:0.3rem;">
                   ${liveContacts.map(c => `
                   <div style="display:flex;align-items:center;justify-content:space-between;
                               font-size:0.75rem;color:var(--text-muted);">
                       <span>✅ ${c.name || c.email}</span>
                       <span style="display:flex;gap:0.3rem;">
                           ${c.phone ? `<a href="https://wa.me/${c.phone}?text=${encodeURIComponent('⚽ Partido en vivo: ' + liveUrl)}" target="_blank"
                               style="padding:2px 8px;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.4);
                                      border-radius:5px;color:#25d366;text-decoration:none;font-size:0.68rem;font-weight:700;">
                               📱 WA</a>` : ''}
                           ${c.email ? `<a href="mailto:${c.email}?subject=${encodeURIComponent('⚽ Partido en Vivo — ' + TEAM_NAMES.home + ' vs ' + TEAM_NAMES.away)}&body=${encodeURIComponent('Sigue el partido en tiempo real:\n' + liveUrl)}" target="_blank"
                               style="padding:2px 8px;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                                      border-radius:5px;color:#58a6ff;text-decoration:none;font-size:0.68rem;font-weight:700;">
                               📧</a>` : ''}
                       </span>
                   </div>`).join('')}
               </div>
               <button onclick="notifyAllLiveContacts('${liveUrl}')"
                   style="margin-top:0.7rem;width:100%;padding:0.55rem;
                          background:rgba(255,88,88,0.2);border:1px solid rgba(255,88,88,0.5);
                          border-radius:7px;color:#ff5858;font-weight:700;
                          font-size:0.8rem;cursor:pointer;">
                   📡 Notificar a todos por WhatsApp
               </button>
           </div>`
        : `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
                        border-radius:8px;padding:0.6rem 0.9rem;margin-bottom:1rem;
                        font-size:0.73rem;color:var(--text-muted);text-align:center;">
               📡 Sin contactos con acceso EN VIVO configurados.<br>
               <span style="font-size:0.68rem;">Ve a <strong>Comunicaciones → Gestión de Contactos</strong>
               y activa la casilla 📡 EN VIVO en quien quieras.</span>
           </div>`;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(95vw,500px);">
            <h2 style="margin:0 0 0.3rem; text-align:center;">🔴 Partido en Vivo</h2>
            <p style="color:var(--text-muted); font-size:0.8rem; text-align:center; margin-bottom:1.2rem;">
                Comparte este enlace con el Director Deportivo para que siga el partido en tiempo real.
                Solo usuarios registrados y autorizados pueden verlo.
            </p>

            <!-- URL -->
            <div style="background:rgba(255,88,88,0.08); border:1px solid rgba(255,88,88,0.3);
                        border-radius:10px; padding:0.9rem; margin-bottom:1rem;">
                <p style="font-size:0.7rem; color:#7d8590; margin:0 0 0.4rem;">🔗 Enlace del partido</p>
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <input id="live-url-input" type="text" value="${liveUrl}" readonly
                        style="flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                               border-radius:6px; padding:0.5rem 0.7rem; color:#cdd9e5;
                               font-size:0.75rem; font-family:monospace; outline:none;">
                    <button onclick="copyLiveUrl()"
                        style="padding:0.5rem 0.8rem; background:#58a6ff; border:none;
                               border-radius:6px; color:#0a0e14; font-weight:700;
                               font-size:0.75rem; cursor:pointer; white-space:nowrap;">
                        📋 Copiar
                    </button>
                </div>
            </div>

            <!-- Contactos EN VIVO -->
            ${liveContactsHtml}

            <!-- Botones de compartir -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-bottom:1rem;">
                <button onclick="shareLiveWhatsApp('${liveUrl}')"
                    style="padding:0.7rem; background:rgba(37,211,102,0.12);
                           border:1px solid rgba(37,211,102,0.4); border-radius:8px;
                           color:#25d366; font-weight:700; font-size:0.85rem; cursor:pointer;">
                    📱 WhatsApp
                </button>
                <button onclick="shareLiveEmail('${liveUrl}')"
                    style="padding:0.7rem; background:rgba(88,166,255,0.1);
                           border:1px solid rgba(88,166,255,0.3); border-radius:8px;
                           color:#58a6ff; font-weight:700; font-size:0.85rem; cursor:pointer;">
                    📧 Email
                </button>
            </div>

            <div style="display:flex; justify-content:space-between; gap:0.6rem;">
                <button class="btn danger" onclick="confirmStopLive()"
                    style="font-size:0.82rem;">
                    ⏹ Finalizar transmisión
                </button>
                <button class="btn primary" onclick="document.getElementById('setup-modal').style.display='none'">
                    ✕ Cerrar
                </button>
            </div>
        </div>`;
}

function copyLiveUrl() {
    const input = document.getElementById('live-url-input');
    if (!input) return;
    navigator.clipboard.writeText(input.value).then(() => {
        const btn = input.nextElementSibling;
        btn.textContent = '✅ Copiado';
        setTimeout(() => btn.textContent = '📋 Copiar', 2000);
    }).catch(() => { input.select(); document.execCommand('copy'); });
}

function shareLiveWhatsApp(url) {
    const date = new Date().toLocaleDateString('es-ES');
    const msg  = encodeURIComponent(
        `⚽ *CHRONOS FÚTBOL — Partido en Vivo*\n` +
        `${TEAM_NAMES.home} vs ${TEAM_NAMES.away} · ${date}\n\n` +
        `Sigue el partido en tiempo real:\n${url}\n\n` +
        `_(Necesitas estar registrado en la app para verlo)_`);
    const num = emailConfig?.whatsappNumber;
    window.open(num ? `https://wa.me/${num}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank');
}

function shareLiveEmail(url) {
    const date    = new Date().toLocaleDateString('es-ES');
    const subject = encodeURIComponent(`⚽ Partido en Vivo — ${TEAM_NAMES.home} vs ${TEAM_NAMES.away}`);
    const body    = encodeURIComponent(
        `Hola,\n\n` +
        `Puedes seguir el partido en tiempo real desde este enlace:\n${url}\n\n` +
        `${TEAM_NAMES.home} vs ${TEAM_NAMES.away} · ${date}\n\n` +
        `Necesitas estar registrado y autorizado en Chronos Fútbol para acceder.\n\n` +
        `Chronos Fútbol — Coach Assistant`);
    const to = emailConfig?.directorEmail || '';
    window.open(`mailto:${to}?subject=${subject}&body=${body}`);
}

// ── Notificar a todos los contactos con acceso EN VIVO ──────────────
window.notifyAllLiveContacts = function(url) {
    const liveContacts = (emailConfig.contacts || []).filter(c => c.tags && c.tags.includes('live') && c.phone);
    if (!liveContacts.length) {
        showToast('⚠️ Ningún contacto tiene WhatsApp configurado para EN VIVO', 4000);
        return;
    }
    const date    = new Date().toLocaleDateString('es-ES');
    const msg     = encodeURIComponent(
        `⚽ *PARTIDO EN VIVO — ${TEAM_NAMES.home} vs ${TEAM_NAMES.away}*\n` +
        `📅 ${date}\n\n` +
        `Sigue el partido en tiempo real aquí:\n${url}\n\n` +
        `_Chronos Fútbol_`);
    let opened = 0;
    liveContacts.forEach((c, i) => {
        // Abrimos ventanas escalonadas para no bloquear pop-ups
        setTimeout(() => {
            window.open(`https://wa.me/${c.phone}?text=${msg}`, '_blank');
        }, i * 600);
        opened++;
    });
    showToast(`📡 WhatsApp abierto para ${opened} contacto${opened > 1 ? 's' : ''} con acceso EN VIVO`, 4000);
};

function confirmStopLive() {
    if (confirm('¿Finalizar la transmisión en vivo?\n\nEl enlace quedará guardado como historial.')) {
        stopLiveSync();
        document.getElementById('setup-modal').style.display = 'none';
    }
}

// Llamar a pushLiveSnapshot en cada acción relevante del partido.
// v225: throttle reducido de 2s a 500ms para que los goles y otros eventos
// críticos se sincronicen casi en tiempo real con el panel en vivo. Antes,
// con 2s, un gol metido justo antes de un cambio podía quedar "atrapado" en
// el mismo batch y el live no lo veía hasta 2s después (o se perdía si había
// race conditions). 500ms sigue agrupando ráfagas rápidas pero es mucho más
// responsivo.
let _liveSyncThrottleTimer = null;
function liveSyncOnAction() {
    if (!liveIsActive) return;
    if (_liveSyncThrottleTimer) return;
    _liveSyncThrottleTimer = setTimeout(() => {
        _liveSyncThrottleTimer = null;
        if (liveIsActive) pushLiveSnapshot('active');
    }, 500);
}

// v225: flush inmediato para eventos críticos (gol, tarjeta, lesión, cambio).
// Estos eventos deben llegar al live lo antes posible, sin esperar al throttle.
// Cancela cualquier timer pendiente y envía el snapshot inmediatamente.
function liveSyncFlushNow() {
    if (!liveIsActive) return;
    if (_liveSyncThrottleTimer) {
        clearTimeout(_liveSyncThrottleTimer);
        _liveSyncThrottleTimer = null;
    }
    pushLiveSnapshot('active');
}
// Exponer para que player-actions.js pueda llamarlo tras meter un gol.
window.liveSyncFlushNow = liveSyncFlushNow;

// ══════════════════════════════════════════════════════════════════
//  CAPA DE ALMACENAMIENTO EN LA NUBE (Firestore)
//  Sustituye localStorage de forma transparente.
//  El resto del código no cambia — solo se llaman estas funciones.
// ══════════════════════════════════════════════════════════════════


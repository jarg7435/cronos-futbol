// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — MATCH/LIVE/SYNC
// Live sync, Firestore push, stop sync, live view, sharing
// Extraído de app.js (líneas 1552-1957)
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN EN VIVO — Firestore
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  ⏱️ v572 · P1 — EL LATIDO PASA DE 5 s A 15 s
// ══════════════════════════════════════════════════════════════════
//  Medido sobre la prueba de estrés del 17/08/2026 y la facturación real
//  (74.000 lecturas ese día, 0,01 € cobrados): el latido es la ÚNICA fuente
//  de coste de la aplicación. Cada latido de un partido se entrega a TODOS
//  los espectadores suscritos, así que multiplicar por tres el intervalo
//  divide entre tres las lecturas Y los bytes de todos a la vez.
//
//  🔑 POR QUÉ NO SE NOTA EN PANTALLA. El reloj del visor NO avanza con el
//  latido: se deriva de `phaseStartedAt` (un instante absoluto en epoch ms
//  que viaja en el snapshot) contra `Date.now()` del propio espectador
//  —live.html:_startAutonomousPhaseWatch—. El cronómetro corre solo, segundo
//  a segundo, aunque no llegue ni un snapshot. El latido sólo refresca
//  marcador, alineación y posiciones, que cambian cada varios minutos.
//
//  🔑 Y LOS SUCESOS NO ESPERAN AL LATIDO. Gol, tarjeta, cambio y lesión se
//  escriben en el acto desde `_registerMatchEvent`, y `liveSyncOnAction` /
//  `liveSyncFlushNow` fuerzan un latido inmediato en cada acción. Lo que se
//  espacia es el relleno entre sucesos, no los sucesos.
//
//  ⚠️⚠️ CORRECCIÓN v574 · ESO ERA CIERTO PARA LOS SUCESOS Y FALSO PARA LA
//  PIZARRA, y aquí se dio por bueno sin comprobarlo. `js/ui/drag-drop.js` no
//  llamaba a `liveSyncOnAction` NI UNA VEZ: mover una ficha por el campo o
//  permutar dos jugadores sólo llegaba al visor con el siguiente latido. El
//  defecto ya existía —hasta 5 s de espera— pero por debajo del umbral en que
//  se nota; al triplicar el latido, P1 lo convirtió en "tarda varios segundos"
//  y el autor lo detectó en la prueba de campo con 4 partidos.
//
//  🔑 LA LECCIÓN: al espaciar un latido hay que auditar TODO lo que viajaba
//  sólo con él, no sólo lo que uno recuerda. Lo que ya iba justo pasa a ir mal.
//  Corregido en drag-drop.js (`_repintaPizarra`); lo vigila
//  `scripts/test_pizarra_sincroniza.js`.
//
//  ⚠️⚠️ ACOPLAMIENTO CON EL VIGILANTE DE CANAL MUERTO. live.html tiene un
//  watchdog (`_MS_SIN_SNAPSHOT_SOSPECHOSO`) que declara muerto el canal si
//  pasa demasiado tiempo sin snapshots y entonces RELEE todo. Estaba en 25 s
//  porque el latido era de 5 s. Con 15 s de latido, 25 s se alcanzan con
//  cualquier jitter de red y el watchdog se dispararía en bucle: una tormenta
//  de lecturas, justo lo contrario de lo que busca P1. Se sube a 50 s en el
//  mismo cambio. **Si se vuelve a tocar este número hay que tocar aquél.**
const LIVE_HEARTBEAT_MS = 15000;

async function cleanupStaleMatches() {
    try {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) return;
        // v434 · `deleteDoc` ya no se importa: el borrado desde el cliente se
        // retiró (ver abajo). `serverTimestamp` entra para sellar finishedAt.
        // v572 · `setDoc` entra para cerrar también el índice ligero: se usa
        // con merge porque el índice puede no existir (partidos anteriores).
        const { collection, query, where, getDocs,
                updateDoc, setDoc, doc, serverTimestamp } = await import(
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

        // ════════════════════════════════════════════════════════════════
        //  🚨🚨🚨 v568 · ESTE BARREDOR MATABA PARTIDOS RECIÉN CREADOS
        // ════════════════════════════════════════════════════════════════
        //  MEDIDO en los datos reales de la 2ª prueba de estrés (17/08/2026).
        //  Tres partidos quedaron así:
        //
        //    cadete-b-…-2204    status=finished  phase=1st_half  isRunning=true
        //    local-…-2203       status=finished  phase=1st_half  isRunning=true
        //    benjamin-c-…-2146  status=finished  phase=1st_half  autoClosed=true
        //
        //  Cerrados los TRES con `autoClosed:true` **en 133 milisegundos**, en
        //  plena primera parte, y uno de ellos **un segundo después de crearlo**.
        //  Eso no lo hace una persona: es este bucle.
        //
        //  🔑🔑🔑 LA CAUSA, en una línea:
        //        const updated = data.updatedAt?.toDate?.() || new Date(0);
        //
        //  `updatedAt` se escribe con `serverTimestamp()`, que es un CENTINELA:
        //  hasta que el servidor lo confirma, quien lee el documento de la caché
        //  local ve `updatedAt: null`. Entonces `?.toDate?.()` da `undefined` y
        //  el `|| new Date(0)` lo convierte en **1 de enero de 1970**. Un
        //  partido creado hace un segundo pasaba a estar "sin actualizar desde
        //  1970" y el `updated < fourHoursAgo` lo cerraba como abandonado.
        //
        //  ⚠️ Y se dispara MÁS cuanto más se prueba: `cleanupStaleMatches` corre
        //  en el ARRANQUE de la app, así que abrir una pestaña para crear el
        //  partido nº 4 barría los tres anteriores. De ahí "he querido crear
        //  siete, sólo tengo cinco y no puedo crear más": cada partido nuevo
        //  mataba a los que ya estaban en marcha.
        //
        //  🔑 LA LECCIÓN: la AUSENCIA de fecha no es prueba de abandono, es
        //  ausencia de prueba. `new Date(0)` convierte "no lo sé" en "abandonado
        //  hace 56 años". Las REGLAS ya lo tenían bien resuelto —"sin fecha
        //  utilizable NO hay ventana; ante la duda, cerrado" (v434)—; este
        //  camino del cliente hacía justo lo contrario.
        //
        //  ⚠️ La Cloud Function `cleanupLiveMatches` NO tiene este fallo: filtra
        //  con `where('updatedAt','<',corte4h)` en el SERVIDOR, y Firestore
        //  excluye de un índice los documentos sin ese campo. Por eso el barrido
        //  de la nube nunca tocó un partido fresco y éste sí.
        // ════════════════════════════════════════════════════════════════

        // ⚠️ Una decisión DESTRUCTIVA no se toma con datos de caché. Si este
        // resultado no viene confirmado por el servidor, los `updatedAt` de los
        // documentos recién escritos —por esta pestaña o por otra, que comparten
        // el IndexedDB— todavía pueden estar sin resolver. Se deja para la
        // siguiente pasada; el barrido de la nube corre igualmente cada hora.
        if (snap.metadata && snap.metadata.fromCache) return;

        // El partido que ESTA pestaña está jugando no se cierra jamás desde
        // aquí, pase lo que pase con su marca de tiempo.
        let _miPartido = null;
        try { _miPartido = window._cronosMatchSlots?.getTabMatchId() || null; } catch (e) {}

        let closed = 0;
        const promises = [];

        snap.forEach(d => {
            const data    = d.data();

            // 🔑 SIN FECHA UTILIZABLE NO SE CIERRA NADA. Ni `new Date(0)`, ni
            // ningún otro valor por defecto: se sale y se vuelve a mirar en la
            // pasada siguiente, cuando el servidor haya sellado la hora.
            const _ts = data.updatedAt && typeof data.updatedAt.toDate === 'function'
                ? data.updatedAt.toDate()
                : null;
            if (!_ts || isNaN(_ts.getTime())) return;
            const updated = _ts;

            // Un documento con escrituras aún sin confirmar es, por definición,
            // reciente: no puede llevar 4 h abandonado.
            if (d.metadata && d.metadata.hasPendingWrites) return;

            if (_miPartido && d.id === _miPartido) return;

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
                // v572 · P2 · El índice se cierra CON el partido: la lista y las
                // alertas filtran por `status` en el ÍNDICE, así que un índice
                // que siguiera 'active' mantendría en pantalla un partido ya
                // cerrado. `setDoc` con merge y no `updateDoc`: un partido
                // anterior a v572 no tiene índice y `updateDoc` fallaría.
                promises.push(
                    setDoc(doc(fa.db, 'live_index', d.id), {
                        status: 'finished',
                        finishedAt: serverTimestamp(),
                        autoClosed: true
                    }, { merge: true }).catch(() => {})
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

    // v276 (unificación): latido — SOLO con isRunning (en pausa/descanso
    // los cambios ya se auto-flushean por liveSyncOnAction/liveSyncFlushNow, así que
    // no hace falta latir en pausa). Guard anti-doble-intervalo: si startLiveSync se
    // llama 2× (p.ej. share-modal + import), evita dejar timers huérfanos.
    if (liveSyncTimer) clearInterval(liveSyncTimer);
    liveSyncTimer = setInterval(() => {
        if (liveIsActive && isRunning) pushLiveSnapshot('active');
    }, LIVE_HEARTBEAT_MS);

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

// ══════════════════════════════════════════════════════════════════
//  🪶 v572 · P2 — EL DOCUMENTO LIGERO (`live_index/{matchId}`)
// ══════════════════════════════════════════════════════════════════
//  EL PROBLEMA QUE RESUELVE. Un espectador no mira un partido: está suscrito a
//  TODOS los partidos activos de su club (un `onSnapshot` por partido para las
//  alertas + los listeners de la lista, live.html). Y cada latido le entrega el
//  documento ENTERO —10.625 B de media, medidos sobre los 10 partidos del
//  respaldo—, cuando para pintar una tarjeta y sonar un aviso hace falta una
//  fracción de eso. Con 15 partidos son 375 MB por espectador en una mañana.
//
//  🔑 LA ASIMETRÍA QUE LO HACE POSIBLE: el 97% del peso del documento es lo que
//  la lista NO usa. `players` son 3.330 B que viajan enteros en cada latido, y
//  la lista sólo los usa para CONTAR cuántos hay en campo —dos enteros—. El
//  array `events` crece sin tope y la lista no lo mira siquiera.
//
//  Así que se escribe un segundo documento con lo justo: ~1.000 B frente a
//  10.625. La lista y las alertas leen de aquí; el visor de detalle —el único
//  que necesita jugadores, posiciones e historial completo— sigue leyendo
//  `live_matches`, como siempre.
//
//  ⚠️⚠️ NO VA EN UN `writeBatch` CON EL DOCUMENTO GORDO, A PROPÓSITO.
//  Un batch es atómico: si la escritura del índice fallara —reglas todavía sin
//  desplegar, un índice compuesto que falta, cuota— **se caería también el
//  latido del partido**. Eso convierte una optimización en una caída total del
//  directo. Aquí el índice se escribe aparte y con su propio `catch` mudo: si
//  falla, el partido sigue exactamente como antes de v572 y los lectores caen
//  solos al documento gordo (ver el respaldo de live.html). Cuesta la misma
//  operación de escritura que dentro del batch.
//
//  ⚠️ ESTE DOCUMENTO TAMBIÉN LLEVA PII (nombres de equipo y textos de suceso con
//  nombres de menores), así que sus reglas son las MISMAS que las de
//  `live_matches`: lectura sólo para usuario registrado. No es un documento
//  "público" por ser pequeño.
// ══════════════════════════════════════════════════════════════════
//  🏃 v575 · EL CAMINO CORTO DE LA PIZARRA
// ══════════════════════════════════════════════════════════════════
//  Reporte del autor (4 partidos simultáneos, PC + iPad): el primer arrastre
//  se sincroniza al instante, pero al mover fichas en los otros tres el
//  desfase sube a **8-9 segundos**. Goles, tarjetas, lesiones y cambios siguen
//  inmediatos.
//
//  🔑🔑🔑 LA CAUSA, medida: para mover una ficha veinte píxeles se enviaba el
//  partido ENTERO — 8.668 B con nombres, colores, categorías, umbrales del
//  semáforo, marcadores y los 18 jugadores completos— cuando lo único que
//  cambia son dos números. Y los cuatro partidos comparten UNA sola conexión:
//  Firestore usa `persistentMultipleTabManager` (firebase-init.js), así que una
//  pestaña es la primaria y las demás encolan sus escrituras a través de ella.
//  Con 4 partidos arrastrando son ~68 KB/s por un solo canal, y ahí se forma
//  la cola. Por eso el PRIMER arrastre iba bien: sin cola no hay desfase.
//
//  🔑 Y POR QUÉ UN GOL SÍ LLEGA AL INSTANTE: viaja por DOS caminos. El suceso
//  se escribe aparte en ~300 B (`_registerMatchEvent`) y de ahí salen el aviso
//  y el sonido; ese paquete diminuto atraviesa la cola sin despeinarse. La
//  posición de una ficha no tenía camino corto: sólo viajaba dentro del gordo.
//
//  LA SOLUCIÓN: darle a la pizarra su propio paquete pequeño — sólo id, x, y y
//  estado. **675 B frente a 8.668: trece veces menos.**
//
//  ⚠️⚠️ EL INVARIANTE QUE LO HACE SEGURO: `positions` se escribe SIEMPRE que se
//  escribe `players`, derivado del MISMO array (ver `pushLiveSnapshot`). Así
//  `positions` nunca puede ser más viejo que `players`, y el visor puede
//  aplicarlo encima sin comprobar fechas. Si algún día se escribe `players` sin
//  `positions`, el visor pintaría posiciones ANTIGUAS sobre jugadores nuevos —
//  una ficha que "vuelve atrás" sola. Lo vigila test_pizarra_camino_corto.js.
//
//  ⚠️ NO se tocan los sucesos `tactical_move`: los CONSUME la Repetición para
//  animar el movimiento (js/match/replay/replay-player.js:145 y :848). Se
//  evaluó quitarlos como P3 y se descartó: rompería "Revivir".
function _buildPositions(lista) {
    // Nombres de una letra a propósito: con 18 jugadores y varios envíos por
    // segundo, `i/x/y/s` en vez de `id/x/y/status` ahorra ~25% del paquete.
    return (lista || []).map(p => ({
        i: p.id,
        x: p.x || 0,
        y: p.y || 0,
        s: p.status || 'bench'
    }));
}

// ══════════════════════════════════════════════════════════════════
//  ✂️ v578 · LA FORMA DE UN SUCESO EN EL ÍNDICE, EN UN SOLO SITIO
// ══════════════════════════════════════════════════════════════════
//  Lo escriben DOS caminos: el latido (`_buildLiveIndexDoc`) y cada suceso en
//  el acto (`_registerMatchEvent`, player-actions.js). Tenerlo escrito dos
//  veces es pedir que diverjan — y este proyecto ya sabe cómo acaba eso: el
//  badge de solicitudes eran DOS implementaciones divergiendo (v532), y el
//  criterio de `_userCanFollow` acabó duplicado (v433). Una sola función.
//
//  🔑 QUÉ LLEVA Y POR QUÉ. Alimenta a los DOS consumidores del panel:
//    · los avisos flotantes (`detectAndAlert`) → identidad, tipo, texto, hora;
//    · el mini-feed de la tarjeta (`_liveFeedItems`/`_liveFeedTexto`) → además
//      `subInName`/`subOutName`/`playerName`, o una sustitución se enseñaría
//      con su texto crudo ("EQUIPO | ▲ SALE: X | ▼ ENTRA: Y") en vez de con
//      "Sale X · Entra Y".
//
//  ⚠️⚠️ NI UN `undefined` PUEDE SALIR DE AQUÍ. El SDK de Firestore **LANZA**
//  con un valor `undefined` ("Unsupported field value"), y este proyecto no usa
//  `ignoreUndefinedProperties`. Por eso los campos opcionales se copian sólo
//  si existen, en vez de escribirlos siempre: es la misma trampa que costó el
//  `finishedAt` de v431.
function _recortaSuceso(ev, matchIdPorDefecto) {
    if (!ev) return null;
    const out = {
        eventId:   ev.eventId   || '',
        matchId:   ev.matchId   || matchIdPorDefecto || '',
        type:      ev.type      || '',
        text:      ev.text      || '',
        icon:      ev.icon      || '•',
        matchTime: ev.matchTime || '',
        team:      ev.team      || null,
        // Marca de agua con la que el visor separa historial de novedad
        // (ver `_matchSeedTs` en live.html). Sin ella, sembrar con la ventana
        // de 3 haría anunciar todo el historial al abrir el partido.
        createdAt: ev.createdAt || 0
    };
    // Nombres de la sustitución: sólo si vienen. Son los que convierten el
    // texto crudo en una línea legible en la tarjeta.
    ['subInName', 'subOutName', 'playerName'].forEach(function (k) {
        if (ev[k] !== undefined && ev[k] !== null) out[k] = ev[k];
    });
    return out;
}
if (typeof window !== 'undefined') window._cronosRecortaSuceso = _recortaSuceso;

const _IDX_TIPOS_NO_VISIBLES = new Set(['tactical_move']);
const _IDX_MAX_EVENTOS = 3;

function _buildLiveIndexDoc(snapshot, players) {
    // Sólo los sucesos que de verdad se ANUNCIAN. `tactical_move` es el 45% de
    // los eventos y de su peso (44 de 98 medidos), y live.html lo descarta con
    // `_esEventoVisible` sin pintarlo jamás: meterlo aquí sería pagar casi la
    // mitad del tamaño por algo que nadie lee. Es P3 aplicado, gratis, al
    // camino de las alertas.
    //
    // 🔑 POR QUÉ BASTAN LOS 3 ÚLTIMOS. El aviso no depende de que el evento
    // esté en este documento para siempre: live.html deduplica por `eventId`
    // contra su propio Set (`_matchSeenEvents`), así que sólo hace falta que
    // cada suceso APAREZCA UNA VEZ. Y aparece: `_registerMatchEvent` reescribe
    // este índice en el acto con cada suceso, no espera al latido. Tres es
    // margen de sobra para que dos sucesos casi simultáneos entren los dos.
    const _todos = Array.isArray(window._cronosMatchEvents) ? window._cronosMatchEvents : [];
    const _visibles = [];
    for (let i = _todos.length - 1; i >= 0 && _visibles.length < _IDX_MAX_EVENTOS; i--) {
        const ev = _todos[i];
        if (!ev || _IDX_TIPOS_NO_VISIBLES.has(ev.type)) continue;
        // Se recorta al mínimo que consume `detectAndAlert`: identidad para
        // deduplicar, tipo y texto para la línea, minuto para la etiqueta y
        // `team` para el chip de equipo (v439/v445 — es la fuente fiable, y en
        // el índice es la ÚNICA, porque aquí no viaja `players`).
        _visibles.unshift(_recortaSuceso(ev, snapshot.id));
    }

    const _enCampo = (lado) => {
        try {
            return (players || []).filter(p => p.team === lado && p.status === 'field').length;
        } catch (e) { return 0; }
    };

    const idx = {
        // 🔒 MARCA DE ORIGEN. live.html la mira para saber que está leyendo un
        // documento ligero y NO puede usar la detección por delta (que compara
        // `players` entre snapshots, y aquí no hay `players`). Sin esta marca,
        // un partido sin sucesos aún caería a la vía delta y compararía contra
        // un estado vacío.
        idx: true,

        id:        snapshot.id,
        status:    snapshot.status,
        updatedAt: snapshot.updatedAt,

        // Pertenencia — las tres condiciones de `_userCanFollow` y las cuatro
        // consultas de `_followableQueries`. Sin estos campos el índice no se
        // podría consultar y habría que volver al documento gordo.
        clubId:     snapshot.clubId,
        clubName:   snapshot.clubName,
        createdBy:  snapshot.createdBy,
        coachEmail: snapshot.coachEmail,
        teamId:     snapshot.teamId,

        // Semáforo y etiqueta de la tarjeta.
        category:         snapshot.category,
        subcategory:      snapshot.subcategory,
        matchCategory:    snapshot.matchCategory,
        matchSubcategory: snapshot.matchSubcategory,
        semaforoActive:   snapshot.semaforoActive,
        timerThresholds:  snapshot.timerThresholds,

        // Reloj. `phaseStartedAt` es lo que hace que el cronómetro de la tarjeta
        // corra solo entre latidos: es justo lo que permite que P1 no se note.
        mode:           snapshot.mode,
        phase:          snapshot.phase,
        isRunning:      snapshot.isRunning,
        timeH1:         snapshot.timeH1,
        timeH2:         snapshot.timeH2,
        half1MaxTime:   snapshot.half1MaxTime,
        half2MaxTime:   snapshot.half2MaxTime,
        phaseStartedAt: snapshot.phaseStartedAt,

        // Marcador. Sin colores: la tarjeta de la lista no los usa.
        homeTeam: {
            name:  snapshot.homeTeam?.name  || '',
            score: snapshot.homeTeam?.score ?? 0
        },
        awayTeam: {
            name:  snapshot.awayTeam?.name  || '',
            score: snapshot.awayTeam?.score ?? 0
        },

        // 🔑 LOS 3.330 B DE `players`, REDUCIDOS A DOS ENTEROS. Es lo único que
        // la lista hacía con el array: contar cuántos hay en campo por equipo.
        onFieldHome: _enCampo('home'),
        onFieldAway: _enCampo('away'),

        // ══════════════════════════════════════════════════════════════
        //  🔑🔑🔑 v576 · LAS POSICIONES VIVEN AQUÍ, NO EN EL PARTIDO
        // ══════════════════════════════════════════════════════════════
        //  MEDIDO en los documentos reales de la prueba del autor: un partido
        //  activo pesa **17,7–23,4 KB**. Y Firestore NO ENVÍA DELTAS: escribir
        //  675 B en `live_matches` hace que cada espectador se descargue el
        //  documento ENTERO otra vez. Por eso v575 —que sólo encogió la
        //  ESCRITURA— no mejoró nada: el visor seguía bajando 23 KB por cada
        //  movimiento de ficha.
        //
        //  Poniéndolas en el índice ligero, mover una ficha hace que el visor
        //  baje ~1-2 KB en vez de 23. El documento gordo deja de tocarse al
        //  arrastrar.
        //
        //  ⚠️ EL INVARIANTE SE MANTIENE: `positions` se escribe SIEMPRE que se
        //  escribe `players` —las dos salen de este mismo `pushLiveSnapshot`, del
        //  mismo array—, así que nunca puede ser más viejo. Entre latidos sólo
        //  puede ser MÁS nuevo (los arrastres). Por eso el visor puede volcarlo
        //  encima sin comparar fechas.
        positions: _buildPositions(players),

        lastEvents: _visibles
    };

    // El sello de finalización y la caducidad viajan igual que en el gordo, para
    // que el barrido de la nube pueda recoger los dos con el mismo criterio.
    if (snapshot.finishedAt) idx.finishedAt = snapshot.finishedAt;
    if (snapshot.expireAt)   idx.expireAt   = snapshot.expireAt;

    return idx;
}

// Escritura del índice: aislada, silenciosa y jamás bloqueante (ver arriba).
async function _pushLiveIndex(setDoc, doc, db, matchId, idxDoc) {
    try {
        await setDoc(doc(db, 'live_index', matchId), idxDoc, { merge: true });
    } catch (e) {
        // Un fallo aquí NO puede afectar al partido. Los lectores se dan cuenta
        // solos (no encuentran el documento) y caen al gordo.
        console.warn('[v572] Índice ligero no escrito (' + matchId + '):', e && e.message);
    }
}

async function pushLiveSnapshot(status = 'active') {
    const fa = window._cronos_auth;
    if (!fa || !fa.db || !liveMatchId) return;

    try {
        // v576 · `arrayUnion` entra para vaciar el aparcamiento de movimientos
        // tácticos en UNA sola escritura agrupada (ver más abajo).
        const { setDoc, doc, serverTimestamp, arrayUnion } = await import(
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
        // ══════════════════════════════════════════════════════════════
        //  🏷️ v562 · LA PAREJA SE TOMA DE UNA SOLA FUENTE, ENTERA
        //
        //  Antes cada mitad hacía su propia cascada:
        //      _matchCat = DOM || global || ''
        //      _matchSub = DOM || global || ''
        //  y bastaba con que una resolviera por el DOM y la otra por la global
        //  —o que un desplegable estuviera desfasado— para que el documento
        //  naciera con la categoría de un equipo y la LETRA DE OTRO. Medido en
        //  los 10 partidos del respaldo: la subcategoría del partido era
        //  siempre la del PERFIL, y de ahí el "Regional C" de un Regional A
        //  (capturas 9077/9078/9083).
        //
        //  🔑 Ahora se elige la FUENTE primero y se toman las dos de ella. El
        //  par global manda sobre el DOM: `confirmSetup` lo escribe con las dos
        //  a la vez, mientras que los desplegables pueden haber quedado atrás
        //  —o desaparecido, porque el panel se repinta— cada uno por su lado.
        // ══════════════════════════════════════════════════════════════
        let _matchCat = '', _matchSub = '';
        if (window._currentMatchCategory) {
            _matchCat = window._currentMatchCategory;
            _matchSub = window._currentMatchSubcategory || '';
        } else if (_dom('match-category')) {
            _matchCat = _dom('match-category');
            _matchSub = _dom('match-subcategory') || '';
        }

        const _me = window._cronosCurrentUser;
        const _extras = (_me && _me.extras) || (_thresholds && _thresholds.extras) || {};
        let _semaforoActive = true;
        if (_extras.semaforo === false) {
            _semaforoActive = false;
        } else if (typeof window.cronosCategoriaSinSemaforo === 'function' &&
                   // 🚦 v559 · CON LAS DOS CATEGORÍAS, no sólo con la del perfil.
                   // Este flag viaja DENTRO del documento y es la primera puerta
                   // que mira el visor (`data.semaforoActive === false`), así que
                   // acertar aquí deja el partido en celeste en TODAS las
                   // pantallas —visor, repetición y tarjetas— de una vez. Con
                   // sólo `snapCat`, un perfil sin categoría dejaba el flag en
                   // true y el Regional salía con semáforo (captura 9056).
                   window.cronosCategoriaSinSemaforo(_matchCat, snapCat)) {
            _semaforoActive = false;
        } else {
            const getGroupFn = (typeof window.getCategoryGroupKey === 'function')
                ? window.getCategoryGroupKey
                : function(c, s) { return 'f7'; };
            const groupKey = getGroupFn(snapCat, snapSub);
            // v586 · también 'regional_fem' (grupo propio desde v586).
            if (groupKey === 'juvenil' || groupKey === 'regional' || groupKey === 'regional_fem') {
                _semaforoActive = false;
            } else {
                const configs = window._clubCategoryConfigs || (_thresholds && _thresholds.categoryConfigs) || {};
                // v586 · con herencia (ver cronosCfgGrupo en utils.js).
                const groupCfg = (typeof window.cronosCfgGrupo === 'function' ? window.cronosCfgGrupo(configs, groupKey) : configs[groupKey]);
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

            // 🔑 v559 · EL EQUIPO, EXPLÍCITO EN EL DOCUMENTO.
            // El autor pide garantía de que un suceso se retransmite "a ese
            // partido, de esa categoría y de esa subcategoría exacta". El
            // `matchId` ya identifica un partido, pero es un slug opaco: no se
            // puede auditar de un vistazo ni comparar con el equipo de nadie.
            // `teamId` es la MISMA clave canónica que usa el resto del proyecto
            // (clubId + categoría + subcategoría, `cronosTeamId` en utils.js), y
            // deja la pertenencia del partido escrita en el propio dato.
            //
            // 🔴🔴 v561 · SE SELLA CON EL EQUIPO **DEL PARTIDO**, NO CON EL DEL
            // PERFIL. Medido en producción (captura 9075): el partido del
            // Regional A de una entrenadora con dos equipos quedó sellado
            // `…__alevin__c`, porque esto leía `_cronosCurrentUser.category` —
            // la categoría del perfil, que era la del OTRO equipo. Con el sello
            // equivocado, "Recuperar Partido" pintaba dos veces el mismo equipo
            // y el partido del Regional se presentaba como un segundo Alevín.
            //
            // ⚠️ SE LE QUITA EL PREFIJO DE MODALIDAD. `matchCategory` viene del
            // desplegable como `f11_regional`, y `cronosTeamId` haría el slug
            // `f11-regional`, que NO casa con el `…__regional__a` de la ficha de
            // equipo: el partido quedaría huérfano de su plantilla.
            teamId: (function () {
                if (typeof cronosTeamId !== 'function') return null;
                const _u = window._cronosCurrentUser || {};
                const _sinPrefijo = (v) => String(v || '').replace(/^f(?:7|8|11)_/i, '');
                const _cat = _sinPrefijo(_matchCat) ||
                             _u.category || _u._activeRoleData?.category || _u.categoryLabel || '';
                const _sub = (_matchCat ? (_matchSub || '') : '') ||
                             _u.subcategory || _u._activeRoleData?.subcategory || '';
                return cronosTeamId(_u.clubId || '', _cat, _sub) || null;
            })(),

            // v463 · Categoría y Subcategoría DEL PARTIDO, tal y como las dejó el
            // entrenador en el panel de creación. Sólo para mostrar (la etiqueta
            // sobre el cronómetro de la tarjeta en vivo); ver el comentario de
            // arriba para por qué no comparten campo con las de encima.
            // Se cae al perfil del entrenador cuando el panel no las resuelve,
            // para que la etiqueta no desaparezca al recuperar un partido.
            // ⚠️ v562 · EL RESPALDO AL PERFIL ES DE LA PAREJA ENTERA, NO DE
            // CADA MITAD. Antes `matchSubcategory: _matchSub || snapSub` caía
            // al perfil en cuanto la subcategoría del partido venía vacía —aun
            // teniendo la categoría del partido resuelta—, y ahí volvía a
            // formarse el híbrido "categoría de uno + letra de otro". Si se usa
            // la categoría del PARTIDO, la letra sale del partido aunque quede
            // en null; sólo cuando no hay categoría de partido se recurre al
            // perfil, y entonces se toman sus DOS campos.
            matchCategory:    _matchCat || snapCat || null,
            matchSubcategory: _matchCat ? (_matchSub || null) : (snapSub || null),

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

        // v469 · 🔒 MISMA PUERTA ESTANCA QUE EN LOS SUCESOS. El latido reescribe
        // marcador, alineación y tiempos: mandarlo al documento equivocado no
        // "cruza un gol", sobrescribe el partido entero de otro. Si esta pestaña
        // declara jugar otro partido, no se emite.
        try {
            const _S = window._cronosMatchSlots;
            const _propio = _S && _S.getTabMatchId();
            if (_propio && _propio !== liveMatchId && String(_propio).indexOf('tab:') !== 0) {
                console.error('[v469] 🔒 Latido BLOQUEADO: iba a "' + liveMatchId +
                              '" y esta pestaña juega "' + _propio + '".');
                return;
            }
        } catch (e) { /* nunca puede cortar la emisión por sí misma */ }

        // ════════════════════════════════════════════════════════════════
        //  🐌 v576 · AQUÍ SE VACÍA EL APARCAMIENTO DE MOVIMIENTOS TÁCTICOS
        // ════════════════════════════════════════════════════════════════
        //  ⚠️ SÍ, ESTO ESCRIBE `events` DESDE EL SNAPSHOT, Y v246 DICE QUE NO SE
        //  HAGA NUNCA. La prohibición de v246 es sobre mandar un ARRAY PLANO:
        //  `setDoc merge` REEMPLAZA arrays enteros, así que un `events: [...]`
        //  aquí borraría todo lo acumulado por `arrayUnion` desde los sucesos.
        //  `arrayUnion` NO reemplaza: AÑADE. Por eso esto es seguro y aquello
        //  no lo era. Si alguien lo cambia por un array plano, se lleva por
        //  delante el historial entero del partido.
        //
        //  Los `tactical_move` se aparcan en `_registerMatchEvent` en vez de
        //  escribirse uno a uno (eran el 75-90% de los sucesos y cada uno hacía
        //  bajar 23 KB a cada espectador). Aquí salen todos juntos, gratis:
        //  aprovechan una escritura que ya se iba a hacer.
        const _tacticasPendientes = Array.isArray(window._cronosTacticalPending)
            ? window._cronosTacticalPending.slice() : [];
        if (_tacticasPendientes.length) {
            snapshot.events = arrayUnion.apply(null, _tacticasPendientes);
        }

        await setDoc(doc(fa.db, 'live_matches', liveMatchId), snapshot, { merge: true });

        // Vaciado DESPUÉS de que la escritura haya ido bien, y sólo de lo que
        // se mandó: si mientras tanto entró un movimiento nuevo, se queda para
        // el siguiente latido en vez de perderse.
        if (_tacticasPendientes.length) {
            window._cronosTacticalPending =
                (window._cronosTacticalPending || []).slice(_tacticasPendientes.length);
        }

        // v575 · Sella el estado que acaba de salir. A partir de aquí el camino
        // corto puede comparar contra esto para saber si le basta con mandar
        // posiciones o si un `status` cambió y hace falta el completo.
        // Va DESPUÉS de la escritura: si falló, no se puede dar por enviado.
        try {
            snapshot.players.forEach(p => { _ultimoEstadoEnviado[p.id] = p.status; });
        } catch (e) { /* nunca puede cortar la sincronización */ }

        // v572 · P2 · El índice ligero, DESPUÉS y por separado. Va detrás del
        // gordo a propósito: si algo tuviera que fallar por cuota o por reglas,
        // que falle lo prescindible y no el partido. `snapshot.players` ya está
        // construido, así que contar los que hay en campo no cuesta nada.
        await _pushLiveIndex(setDoc, doc, fa.db, liveMatchId,
                             _buildLiveIndexDoc(snapshot, snapshot.players));
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
<!-- v671 · fuera el enlace "📱 WA" de cada contacto -->

                           ${c.email ? `<a href="mailto:${c.email}?subject=${encodeURIComponent('⚽ Partido en Vivo — ' + TEAM_NAMES.home + ' vs ' + TEAM_NAMES.away)}&body=${encodeURIComponent('Sigue el partido en tiempo real:\n' + liveUrl)}" target="_blank"
                               style="padding:2px 8px;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                                      border-radius:5px;color:#58a6ff;text-decoration:none;font-size:0.68rem;font-weight:700;">
                               📧</a>` : ''}
                       </span>
                   </div>`).join('')}
               </div>
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
            <!-- v671 · Queda un solo botón de compartir (email), así que la
                 rejilla pasa de dos columnas a una. -->
            <div style="display:grid; grid-template-columns:1fr; gap:0.6rem; margin-bottom:1rem;">
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

// v671 · `shareLiveWhatsApp` retirada con su botón.
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

// ── v671 · AQUÍ VIVÍA `notifyAllLiveContacts`, Y SE HA RETIRADO ─────
//  Abría una ventana de wa.me por cada contacto con acceso EN VIVO. Se va
//  con `shareLiveWhatsApp` y con el enlace "📱 WA" de cada fila: el enlace
//  del directo se comparte por correo o copiándolo.
//  ⚠️ Los dos nombres estaban inventariados en
//  scripts/test_app_init_dead_duplicates.js como propiedad de este fichero;
//  esa lista se ha actualizado en la misma ronda. Si no, el guard exigiría
//  que este archivo siguiera declarando algo que ya no existe.

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

// ══════════════════════════════════════════════════════════════════
//  🏃 v575 · EL VOLCADO CORTO: SÓLO POSICIONES
// ══════════════════════════════════════════════════════════════════
//  Lo que llama la pizarra al soltar una ficha. Escribe ~675 B en vez de los
//  8.668 B del snapshot completo (ver `_buildPositions` para el porqué).
//
//  ⚠️ Tiene su PROPIO throttle, separado del de `liveSyncOnAction`. Si
//  compartieran timer, arrastrar cancelaría el volcado completo pendiente de un
//  gol —o al revés— y una de las dos cosas se perdería hasta el siguiente
//  latido. Son dos caminos independientes a propósito.
let _posThrottleTimer = null;

// Estado de cada jugador tal y como salió en el ÚLTIMO volcado completo. Es la
// referencia con la que `_pushPositions` decide si el camino corto basta o si
// hace falta mandar el partido entero (ver el bloque de arriba).
const _ultimoEstadoEnviado = {};

function liveSyncPositions() {
    if (!liveIsActive) return;
    if (_posThrottleTimer) return;
    _posThrottleTimer = setTimeout(() => {
        _posThrottleTimer = null;
        if (liveIsActive) _pushPositions();
    }, 500);
}

async function _pushPositions() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db || !liveMatchId) return;

    // 🔒 v469 · LA MISMA PUERTA ESTANCA QUE EL LATIDO Y LOS SUCESOS. Escribir
    // posiciones en el documento equivocado recolocaría las fichas del partido
    // de otro entrenador en pleno directo. Si esta pestaña declara jugar otro
    // partido, no se emite.
    try {
        const _S = window._cronosMatchSlots;
        const _propio = _S && _S.getTabMatchId();
        if (_propio && _propio !== liveMatchId && String(_propio).indexOf('tab:') !== 0) {
            console.error('[v575] 🔒 Posiciones BLOQUEADAS: iban a "' + liveMatchId +
                          '" y esta pestaña juega "' + _propio + '".');
            return;
        }
    } catch (e) { /* la puerta nunca puede impedir el envío por sí misma */ }

    try {
        const { setDoc, doc, serverTimestamp } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        // ⚠️ `players` es la global del partido en curso, la misma de la que
        // come `pushLiveSnapshot`: las dos escrituras salen de la misma fuente.
        const _lista = (typeof players !== 'undefined' && Array.isArray(players)) ? players : [];
        if (!_lista.length) return;

        // ══════════════════════════════════════════════════════════════
        //  ⚠️ SI CAMBIÓ ALGÚN ESTADO, EL CAMINO CORTO NO BASTA
        // ══════════════════════════════════════════════════════════════
        //  El camino corto sólo lleva posiciones. Pero un arrastre de banquillo
        //  a campo cambia también `status`, y de ahí salen cosas que NO viajan
        //  en este paquete: los contadores `onFieldHome`/`onFieldAway` del
        //  índice ligero —los "N en campo" de la tarjeta— y el reparto de
        //  minutos. Con el reloj en marcha eso ya lo cubre `logMovement`, que
        //  fuerza un volcado completo; pero **en pausa o en el descanso
        //  `logMovement` no se llama Y el latido tampoco late** (sólo late con
        //  `isRunning`), así que la tarjeta se quedaría mintiendo hasta que el
        //  entrenador reanudara. Aquí se detecta y se manda el completo.
        const _hayCambioDeEstado = _lista.some(p =>
            _ultimoEstadoEnviado[p.id] !== undefined &&
            _ultimoEstadoEnviado[p.id] !== p.status);
        if (_hayCambioDeEstado) {
            await pushLiveSnapshot('active');
            return;
        }
        // 🔑🔑🔑 v576 · SE ESCRIBE EN `live_index`, NO EN `live_matches`.
        // Firestore no envía deltas: tocar el documento gordo (17-23 KB
        // medidos) obliga a CADA espectador a descargarlo entero, por muy
        // pequeña que sea la escritura. Ése fue el fallo de v575 — encogió la
        // subida y dejó la bajada igual. En el índice ligero, el visor baja
        // ~1-2 KB por movimiento.
        await setDoc(doc(fa.db, 'live_index', liveMatchId), {
            positions: _buildPositions(_lista),
            // Sella la hora: el visor tiene una guarda monotónica que descarta
            // el snapshot entero si `updatedAt` no avanza (v567). Sin esto, un
            // movimiento entre latidos llegaría y se tiraría a la basura.
            updatedAt: serverTimestamp()
        }, { merge: true });
    } catch (err) {
        console.warn('[v575] Posiciones no enviadas:', err && err.message);
        if (typeof window._cronosRecuperaSiClienteMuerto === 'function') {
            window._cronosRecuperaSiClienteMuerto(err, '_pushPositions');
        }
    }
}
window.liveSyncPositions = liveSyncPositions;

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


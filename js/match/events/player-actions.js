// ════════════════════════════════════════════════════════════════════
//  PLAYER ACTION MODAL — v2 (con doble amarilla = expulsión)
//  Este archivo se carga DESPUÉS de cronos_patches.js, así que
//  las funciones que define son las definitivas que se ejecutan.
// ════════════════════════════════════════════════════════════════════

// activeActionPlayerId ya declarado en app.js

// v246: Registrar eventos del partido en window._cronosMatchEvents (local)
// Y escribirlos DIRECTAMENTE a Firestore con setDoc + merge + arrayUnion.
// arrayUnion anade al array sin sobrescribir los eventos anteriores.
// setDoc con merge crea el documento si no existe.
// pushLiveSnapshot NUNCA incluye events en el snapshot (ver sync.js v246).
window._cronosMatchEvents = window._cronosMatchEvents || [];
// ════════════════════════════════════════════════════════════════════
//  SUSTITUCIÓN COMO UN ÚNICO SUCESO  (implementar.txt, 2026-07-31)
//
//  Antes cada cambio emitía DOS eventos sueltos —'CAMBIO · Entra · X' y
//  'CAMBIO · Sale · Y'— que llegaban al visor como dos líneas desarticuladas,
//  a veces ni siquiera consecutivas. Ahora un cambio es UN evento con las dos
//  mitades y el equipo, tal como lo pidió el autor:
//      [Equipo] | ▲ SALE: [saliente] | ▼ ENTRA: [entrante]
//
//  ⚠️ CONVENCIÓN DE FLECHAS — ÚNICA EN TODA LA APP (v424, 2026-08-02):
//      ▲ ROJO  = SALE      ▼ VERDE = ENTRA
//  Hasta v423 había DOS convenciones opuestas: ésta y la del cronograma de
//  informes (report-engine.js, donde ▲ verde = ENTRA). El autor decidió
//  unificarlas con este criterio, así que report-engine.js, individual-reports.js
//  y collective-report.js se cambiaron a la vez. Si se vuelve a tocar, hay que
//  tocar las CUATRO o vuelve la incoherencia.
//
//  ⚠️ Y POR QUÉ ▲/▼ Y NO 🟥/🟩 NI 🔺/🔻 (las dos formas que ya se probaron):
//    · 🔺/🔻 (U+1F53A/B) son AMBOS ROJOS en Unicode: sólo cambia hacia dónde
//      apuntan, así que entrada y salida no se distinguían de un vistazo.
//    · 🟥/🟩 (U+1F7E5/E9) sí contrastan, PERO son de Unicode 12 (2019) y en
//      móviles y fuentes anteriores salen como el rombo negro con '?'
//      (U+FFFD). Es lo que el autor vio en sus capturas.
//    · ▲/▼ (U+25B2/U+25BC) son de Unicode 1.1 (1993): existen en TODAS las
//      fuentes, y al ser glifos neutros el COLOR lo pone el CSS, no la fuente.
//      Por eso se colorean en el visor (_coloreaSustitucion en live.html).
// ════════════════════════════════════════════════════════════════════
function _nombreEquipoDe(player) {
    var t = (player && player.team) || 'home';
    try {
        if (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES && TEAM_NAMES[t]) return TEAM_NAMES[t];
    } catch (e) {}
    return t === 'away' ? 'VISITANTE' : 'LOCAL';
}

// ════════════════════════════════════════════════════════════════════
//  v439 · EL EQUIPO, EN CAMPOS ESTRUCTURADOS DEL EVENTO
//
//  Hasta aquí el equipo sólo viajaba DENTRO del texto, y sólo en las
//  sustituciones ("CHRONOS | ▲ SALE: …"). En goles, tarjetas y lesiones no
//  viajaba de ninguna forma: el texto es 'GOL · Pedro' y nada más. Por eso el
//  mini-feed de las tarjetas de Partidos en Vivo no podía decir de qué equipo
//  era el gol, que es justo lo que pidió el autor.
//
//  🔑 SE EMITE COMO DATO, NO COMO TEXTO. Es la misma regla que ya obligó a
//  añadir subOutName/subInName (v418-v421): el formato visible ha cambiado
//  varias veces y cualquier consumidor que lo parsee se rompe en silencio.
//    · `team`     → 'home' | 'away'  (el CONTRATO: no depende del idioma ni
//                    de que el club renombre el equipo a mitad de temporada)
//    · `teamName` → el nombre en el momento del suceso, sólo para poder
//                    mostrar algo si el documento del partido no lo trae.
//  El texto NO se toca: hay guards y un reproductor de repeticiones que
//  dependen de su formato exacto.
// ════════════════════════════════════════════════════════════════════
function _datosEquipoDe(player) {
    return {
        team: ((player && player.team) === 'away') ? 'away' : 'home',
        teamName: _nombreEquipoDe(player)
    };
}

window._registerSubstitution = function (outPlayer, inPlayer) {
    if (typeof _registerMatchEvent !== 'function') return;
    var outName = (outPlayer && outPlayer.name) || 'Jugador';
    var inName  = (inPlayer  && inPlayer.name)  || 'Jugador';
    var equipo  = _nombreEquipoDe(outPlayer || inPlayer);
    // ▲ = SALE, ▼ = ENTRA (ver la convención al principio del fichero). El color
    // lo pone el visor con _coloreaSustitucion, porque ▲/▼ son glifos neutros.
    // subOutName/subInName: los nombres en campos propios, para que el replay
    // no dependa de parsear el texto visible.
    var eq = _datosEquipoDe(outPlayer || inPlayer);
    _registerMatchEvent('sub',
        equipo + ' | ▲ SALE: ' + outName + ' | ▼ ENTRA: ' + inName, '🔄', undefined,
        { subOutName: outName, subInName: inName, team: eq.team, teamName: eq.teamName });
};

// Emparejado para logMovement, que se invoca UNA VEZ POR JUGADOR y por tanto
// sólo conoce una mitad del cambio. El subId lo comparten la entrada y la
// salida del mismo cambio, así que se guarda la primera mitad y se emite el
// evento unificado cuando llega la segunda.
var _subsPendientes = {};
window._registerSubHalf = function (player, subId, action) {
    if (!player) return;
    // Sin subId no hay forma fiable de emparejar: se emite suelto, como antes,
    // en vez de perder el suceso.
    // ⚠️ MOVIMIENTO SUELTO, SIN PAREJA — y son la MAYORÍA de las llamadas.
    // Sólo los intercambios por arrastre pasan subId (3 de 9 llamadas a
    // logMovement). Mandar a un jugador al banquillo sin traer a otro —jugar con
    // uno menos, una expulsión— es un movimiento real de UN solo jugador: no hay
    // a quién emparejarlo, y esperar una pareja que nunca llegará perdería el
    // suceso. Así que se emite suelto.
    // 🔑 PERO CON EL MISMO FORMATO LIMPIO que la sustitución (equipo + cuadro de
    // color + nombre). Antes salía 'CAMBIO · Sale · X', que es justo la línea
    // desarticulada que el autor pidió eliminar: unificar sólo los cambios por
    // arrastre habría dejado el historial mezclando dos estilos.
    // ▲ = SALE, ▼ = ENTRA (ver la convención al principio del fichero).
    if (!subId) {
        var eq = _nombreEquipoDe(player);
        var datosEq = _datosEquipoDe(player);
        var nombre = player.name || 'Jugador';
        _registerMatchEvent(
            action === 'Entra' ? 'sub_in' : 'sub_out',
            action === 'Entra' ? (eq + ' | ▼ ENTRA: ' + nombre)
                               : (eq + ' | ▲ SALE: ' + nombre),
            action === 'Entra' ? '▼' : '▲', undefined,
            { playerName: nombre, team: datosEq.team, teamName: datosEq.teamName });
        return;
    }
    var slot = _subsPendientes[subId] || (_subsPendientes[subId] = {});
    if (action === 'Entra') slot.in = player; else slot.out = player;
    if (slot.in && slot.out) {
        window._registerSubstitution(slot.out, slot.in);
        delete _subsPendientes[subId];
    }
};

// ════════════════════════════════════════════════════════════════════
//  💬 v690 · LOS COMENTARIOS DEL PARTIDO, LISTOS PARA EL INFORME
//
//  Encargo del autor (implementar.txt + captura 10265): un suceso
//  "Comentario" en "Registrar Evento Perdido" —notas tácticas o generales
//  sobre el partido, de los dos equipos— que salga en orden en el historial
//  y en el informe final.
//
//  El informe NO lee `live_matches.events` (se borra a las 10 h): se
//  construye con los documentos `cronos_player_reports` que escriben los
//  despachos al terminar. Por eso los tres escritores guardan el resultado
//  de esta función en el campo `matchComments` de las copias del cuerpo
//  técnico y del entrenador — NUNCA en las de las familias (decisión del
//  autor: los comentarios son sólo del cuerpo técnico).
//
//  Se lee el campo estructurado `comment`, no el texto visible: el texto no
//  es el contrato de datos (lección de v418-v421).
// ════════════════════════════════════════════════════════════════════
window.cronosComentariosDelPartido = function (eventos) {
    var lista = Array.isArray(eventos) ? eventos
              : (Array.isArray(window._cronosMatchEvents) ? window._cronosMatchEvents : []);
    var vistos = {};
    return lista
        .filter(function (e) { return e && e.type === 'comment' && String(e.comment || '').trim(); })
        .map(function (e) {
            var mt = String(e.matchTime || '');
            var mm = mt.match(/(\d+):(\d+)/);
            return {
                id:        String(e.eventId || ''),
                minute:    (typeof e.minute === 'number' && e.minute >= 0) ? e.minute : (mm ? parseInt(mm[1], 10) : 0),
                half:      (e.half === '2T' || e.half === '1T') ? e.half : (/^\s*2T/.test(mt) ? '2T' : '1T'),
                text:      String(e.comment).trim().slice(0, 500),
                realTime:  String(e.realTime || ''),
                createdAt: Number(e.createdAt) || 0,
                // 🟠 v715 · Y SI SE APUNTÓ A POSTERIORI, SE DICE. El suceso lo
                // marca `_registerMatchEvent` con `isRetroactive` al recibir un
                // minuto manual, pero aquí se perdía: el comentario llegaba al
                // informe sin distinguirse de uno escrito en directo, y el
                // autor los nombra PRIMEROS en su lista de lo que tiene que
                // salir en naranja.
                retro:     e.isRetroactive === true,
            };
        })
        .filter(function (c) {
            var k = c.id || (c.minute + '|' + c.text);
            if (vistos[k]) return false;
            vistos[k] = true;
            return true;
        })
        .sort(function (a, b) { return (a.minute - b.minute) || (a.createdAt - b.createdAt); });
};

// `extra`: campos ESTRUCTURADOS que se mezclan en el evento.
// 🔑 EXISTE PORQUE EL TEXTO NO PUEDE SER EL CONTRATO DE DATOS: el reproductor
// de repeticiones (js/match/replay/replay-player.js) sacaba el nombre del
// jugador PARSEANDO el texto del evento (partiendo por ' · ' y tomando el
// último trozo). Al reformatear las sustituciones ese parseo dejaba de
// encontrarlo. Con campos propios, el formato visible puede cambiar sin romper
// nada que dependa de los datos.
// v434 · `target` (opcional) = { matchId, matchData }. Solo lo usa el modal de
// eventos retroactivos, para escribir en el partido que el usuario abrió y no
// en el que se esté jugando. Ver la nota junto a la puerta de inmutabilidad.
function _registerMatchEvent(type, text, icon, matchTimeOverride, extra, target) {
    // 🔑 CONFIRMACIÓN DIFERIDA: con el modal abierto NADA sale de aquí. Se aparca
    // y se decide en HECHO (_confirmarEventosModal), para que una rectificación
    // o un doble clic no manden un aviso falso que ya no se puede retirar.
    // Los cambios de jugador no pasan por aquí con el modal abierto —es un modal
    // bloqueante—, así que no se aparca nada ajeno al propio modal.
    if (_modalStaging) {
        // v434: `target` va en la tupla porque _confirmarEventosModal la reenvía
        // con _registerMatchEvent.apply(null, ev). Sin él, un evento aparcado
        // perdería el partido destino al emitirse y volvería a caer en la global
        // liveMatchId, que es el defecto que v434 corrige.
        _modalBuffer.push([type, text, icon, matchTimeOverride, extra, target]);
        return;
    }
    try {
        var now = new Date();
        var realTime = now.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        var matchTime = '';
        try {
            var h1 = (typeof masterTimeH1 !== 'undefined') ? masterTimeH1 : 0;
            var h2 = (typeof masterTimeH2 !== 'undefined') ? masterTimeH2 : 0;
            var phase = (typeof matchPhase !== 'undefined') ? matchPhase : '1st_half';
            var total = (phase === '2nd_half' || phase === 'finished') ? (h1 + h2) : h1;
            var part = (phase === '2nd_half' || phase === 'finished') ? '2T' : '1T';
            var m = Math.floor(total / 60).toString().padStart(2, '0');
            var s = (total % 60).toString().padStart(2, '0');
            matchTime = part + ' ' + m + ':' + s;
        } catch(e) {}
        // matchTimeOverride: minuto manual para eventos retroactivos (perdida
        // de bateria/cobertura). Si se pasa, sustituye al calculo por cronometro.
        if (typeof matchTimeOverride === 'string' && matchTimeOverride) {
            matchTime = matchTimeOverride;
        }
        // \ud83d\udd11 eventId \u00daNICO POR EVENTO (fix del bucle infinito de goles en el
        // visor en vivo, 2026-07-31). Sin identidad, live.html s\u00f3lo pod\u00eda
        // deducir "ha habido gol" comparando estados entre snapshots, y como el
        // emisor reescribe el documento cada ~5 s, cualquier p\u00e9rdida del estado
        // previo convert\u00eda CADA LATIDO en un gol nuevo: se cantaba el gol y se
        // a\u00f1ad\u00eda la l\u00ednea al historial indefinidamente.
        // Con id, el visor procesa cada evento UNA sola vez y el bucle es
        // imposible por construcci\u00f3n.
        // \u26a0\ufe0f Aqu\u00ed el sufijo aleatorio es CORRECTO, al contrario que en
        // liveMatchId (donde Math.random() caus\u00f3 el bug de ids inestables): el
        // evento se escribe UNA vez con su id y nunca se vuelve a derivar.
        // Tambi\u00e9n lleva el matchId, para que el visor pueda descartar de ra\u00edz
        // cualquier evento que no sea del partido que est\u00e1 mostrando.
        // 🔓 v797 · …el del partido DESTINO cuando lo hay. Un suceso apuntado a
        // posteriori sobre un partido terminado se escribe en ESE documento
        // (ver `_id` más abajo) y llevaba dentro el id del partido en curso, o
        // vacío: el visor lo descartaba como «de otro partido».
        var _evMatchId = (target && target.matchId) ? String(target.matchId)
                       : ((typeof liveMatchId !== 'undefined' && liveMatchId) ? liveMatchId : '');
        var eventEntry = {
            eventId: 'ev_' + now.getTime().toString(36) + '_' +
                     Math.random().toString(36).slice(2, 8),
            matchId: _evMatchId,
            type: type, text: text, icon: icon || '\u2022',
            realTime: realTime, matchTime: matchTime,
            timestamp: now.toISOString(),
            createdAt: now.getTime()
        };
        if (extra && typeof extra === 'object') {
            Object.keys(extra).forEach(function (k) {
                if (extra[k] !== undefined && extra[k] !== null) eventEntry[k] = extra[k];
            });
        }
        if (typeof matchTimeOverride === 'string' && matchTimeOverride) {
            eventEntry.isRetroactive = true;
        }
        window._cronosMatchEvents.push(eventEntry);
        if (window._cronosMatchEvents.length > 200) {
            // 💬 v690 · LOS COMENTARIOS NO SE RECORTAN. De esta lista sale el
            // informe al terminar (`cronosComentariosDelPartido`), y los
            // `tactical_move` son el 75-90% de los sucesos: con el recorte a
            // 200 a secas, una nota de la primera parte habría desaparecido
            // antes de generar el informe. Son pocas y cortas.
            var _notas = window._cronosMatchEvents.filter(function (e) { return e && e.type === 'comment'; });
            window._cronosMatchEvents = window._cronosMatchEvents.slice(-200);
            _notas.forEach(function (n) {
                if (window._cronosMatchEvents.indexOf(n) < 0) window._cronosMatchEvents.unshift(n);
            });
        }
        console.log('[v246] Evento registrado:', type, '| Total local:', window._cronosMatchEvents.length);

        // ══════════════════════════════════════════════════════════════
        //  🐌 v576 · LOS MOVIMIENTOS TÁCTICOS NO ESCRIBEN EN CALIENTE
        // ══════════════════════════════════════════════════════════════
        //  MEDIDO en los partidos reales de la prueba del autor: los
        //  `tactical_move` son el **75-90%** de los sucesos, y cada uno hacía
        //  aquí un `arrayUnion` sobre `live_matches`. Como Firestore NO ENVÍA
        //  DELTAS, cada uno obligaba a todos los espectadores a descargarse el
        //  documento ENTERO — 17-23 KB medidos. Con cuatro partidos, eso son
        //  cientos de KB por segundo bajando al dispositivo del director, más
        //  parsearlos y repintar el campo cada vez. Ése era el cuello de
        //  botella real de los 10-12 s, no la subida.
        //
        //  🔑 Ahora se APARCAN y viajan con el siguiente latido, en UNA sola
        //  escritura agrupada (`pushLiveSnapshot`, con `arrayUnion`). El
        //  arrastre deja de tocar el documento gordo por completo: sus
        //  posiciones van al índice ligero por su propio camino.
        //
        //  ⚠️ NO SE PIERDE NINGUNO Y LA REPETICIÓN NO SE ENTERA. Llegan todos,
        //  sólo que agrupados; `replay-player.js` los lee del array `events`
        //  igual que siempre. Ya están en `window._cronosMatchEvents` (arriba),
        //  así que el historial LOCAL del entrenador es inmediato.
        //
        //  ⚠️ TOPE DE SEGURIDAD: con el reloj parado no hay latido, así que el
        //  aparcamiento podría crecer sin fin. Al llegar al tope se deja pasar
        //  el más viejo por la vía normal para no perderlo.
        //
        //  ══════════════════════════════════════════════════════════════
        //   📤 v724 · EL APARCAMIENTO SE MUDA A LA COLA POR PARTIDO
        //  ══════════════════════════════════════════════════════════════
        //  La idea de v576 se mantiene ENTERA —un `tactical_move` no puede
        //  hacer bajar el documento gordo a todos los espectadores por cada
        //  píxel arrastrado— pero el aparcamiento ya no es
        //  `window._cronosTacticalPending`, que era UNA GLOBAL SIN PARTIDO:
        //  `pushLiveSnapshot` la volcaba sobre el `liveMatchId` que tocara en
        //  ese momento, así que con dos partidos en la misma pestaña los
        //  movimientos de uno acababan escritos en el documento del OTRO. Y su
        //  vaciado por `slice(n)` —por POSICIÓN, con varios latidos en vuelo—
        //  perdía movimientos que nadie había enviado.
        //
        //  🔑 Ahora esperan EN LA COLA DE SU PARTIDO (`CronosOutbox`, con su
        //  ventana de agrupación larga), con reintento y sin poder cruzarse.
        //
        //  🔑🔑 Y DE PASO PASAN POR LAS PUERTAS. El aparcamiento estaba AQUÍ,
        //  ANTES de la puerta de inmutabilidad (v434) y de la puerta estanca
        //  por partido (v469): los movimientos tácticos eran los únicos
        //  sucesos que se saltaban las dos. Al bajar el `return`, todos los
        //  tipos siguen exactamente el mismo camino.

        // v246: escribir a Firestore con setDoc + merge + arrayUnion.
        var fa = window._cronos_auth;
        // v434 · EL PARTIDO DESTINO PUEDE NO SER EL QUE SE ESTÁ JUGANDO.
        // `target` lo pasa el modal retroactivo cuando se abre desde la tarjeta
        // de un partido TERMINADO. Hasta v434 esto no existía: el modal recibía
        // el matchId, lo guardaba en _targetMatchId y NO lo pasaba aquí, así que
        // el evento se escribía sobre la global `liveMatchId` — es decir, en el
        // partido en curso del entrenador, o en ninguno. La única edición
        // post-partido que hay apuntaba al documento equivocado.
        var _id = (target && target.matchId)
                    || ((typeof liveMatchId !== 'undefined') ? liveMatchId : null);

        // v434 · PUERTA DE INMUTABILIDAD. Solo se comprueba cuando el llamante
        // aporta los datos del partido destino (el caso retroactivo): para el
        // partido en curso el estado es 'live' por definición. Esto es UX —
        // evitar una escritura que el servidor va a rechazar—; la barrera real
        // está en firestore.rules.
        if (target && target.matchData && window.CronosMatchLock
            && !window.CronosMatchLock.canAddEvent(target.matchData)) {
            console.warn('[v434] Partido congelado: no se registra el evento.');
            if (typeof showToast === 'function') {
                showToast('🔒 ' + window.CronosMatchLock.lockReason(target.matchData), 5000);
            }
            return;
        }

        // ══════════════════════════════════════════════════════════════
        //  v469 · 🔒 CIERRE ESTANCO POR PARTIDO
        // ══════════════════════════════════════════════════════════════
        //  Reporte del autor: "los sucesos se están cruzando entre sí (un gol
        //  en Fútbol 7 aparece en Juvenil)".
        //
        //  🔑 EL CRUCE SOLO PUEDE PASAR AQUÍ: `_id` sale de la global
        //  `liveMatchId`, y esa global la reescriben el arranque de un partido
        //  y la RECUPERACIÓN de uno guardado. Si una pestaña recupera la ranura
        //  equivocada, `liveMatchId` pasa a ser el del OTRO partido y todos sus
        //  sucesos se escriben en el documento ajeno — exactamente el síntoma.
        //
        //  Desde v465 cada pestaña declara CUÁL es su partido en sessionStorage
        //  (js/core/match-slots.js), que no se comparte entre pestañas. Aquí se
        //  usa como CONTRASTE: si lo que se va a escribir no es el partido que
        //  esta pestaña dice estar jugando, NO SE ESCRIBE.
        //
        //  ⚠️ Se exige coincidencia sólo cuando la pestaña tiene un partido
        //  declarado Y NO es una edición retroactiva (`target.matchId`, que
        //  apunta a propósito a otro partido ya terminado). Sin ese matiz, la
        //  puerta bloquearía la única edición post-partido que existe.
        try {
            var _S = window._cronosMatchSlots;
            var _propio = _S && _S.getTabMatchId();
            var _esRetroactivo = !!(target && target.matchId);
            if (_id && _propio && !_esRetroactivo && _propio !== _id
                && String(_propio).indexOf('tab:') !== 0) {
                console.error('[v469] 🔒 Suceso BLOQUEADO: se iba a escribir en "' + _id +
                              '" pero esta pestaña juega "' + _propio + '".');
                if (typeof showToast === 'function') {
                    showToast('🔒 Suceso no guardado: apuntaba a otro partido. Recarga esta pestaña.', 6000);
                }
                return;
            }
        } catch (e) { /* la puerta nunca puede impedir un partido por sí misma */ }

        // ══════════════════════════════════════════════════════════════
        //  📤 v724 · EL SUCESO SE ENTREGA A LA COLA DE SU PARTIDO
        // ══════════════════════════════════════════════════════════════
        //  🔴 LO QUE HABÍA AQUÍ Y POR QUÉ NO PODÍA QUEDARSE. Esta función
        //  escribía directamente y su `.catch` sólo hacía `console.error`: NO
        //  HABÍA REINTENTO. Un gol, una tarjeta o un cambio que fallara en su
        //  único intento se perdía del directo PARA SIEMPRE y en silencio.
        //
        //  🔑🔑 Y EL LATIDO NO PODÍA REPARARLO: `pushLiveSnapshot` tiene
        //  PROHIBIDO mandar `events` como array plano (v246, `setDoc merge`
        //  reemplaza arrays y borraría el historial). O sea que no existía
        //  NINGÚN camino por el que un suceso caído volviera a salir. Un
        //  parpadeo de cobertura —la norma en un campo— bastaba.
        //
        //  Ahora el suceso se entrega a `CronosOutbox`, que lo guarda hasta
        //  que el servidor acusa recibo, reintenta con espera creciente, lo
        //  agrupa con los de su ráfaga y lo sobrevive a una recarga. La cola
        //  es POR `matchId` —el mismo `_id` que ya calcularon las puertas de
        //  arriba—, así que dos partidos del mismo aparato no comparten nada.
        //
        //  ⚠️ EL OBJETO NO SE VUELVE A TOCAR DESPUÉS DE ENCOLARLO. Es lo que
        //  hace seguro el reintento: `arrayUnion` con un objeto IDÉNTICO no
        //  añade nada, así que reenviar un suceso cuya primera escritura
        //  llegó tarde es una operación nula. Si alguien mutase `eventEntry`
        //  aquí abajo, un reintento crearía un duplicado en el historial.
        var _cola = (typeof window !== 'undefined') ? window.CronosOutbox : null;
        if (_cola && typeof _cola.encola === 'function' && _id) {
            _cola.encola(_id, eventEntry);
        } else if (fa && fa.db && _id) {
            // ⚠️ RESPALDO LITERAL AL CAMINO DE v246, por si el módulo de la
            // cola no hubiera cargado. Sin reintento, como antes: es peor,
            // pero es infinitamente mejor que no emitir el suceso.
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
                .then(function(fs) {
                    return fs.setDoc(fs.doc(fa.db, 'live_matches', _id), {
                        events: fs.arrayUnion(eventEntry),
                        // ══════════════════════════════════════════════════
                        //  🔑🔑🔑 v567 · EL SUCESO TAMBIÉN SELLA LA HORA
                        // ══════════════════════════════════════════════════
                        //  Hasta v566 esta escritura tocaba ÚNICAMENTE `events`.
                        //  Consecuencia medida en la prueba de 7 partidos: el
                        //  snapshot que llevaba el gol al visor llegaba con el
                        //  MISMO `updatedAt` que el anterior, y la guarda
                        //  monotónica de `detectAndAlert` (live.html) lo
                        //  descartaba entero por "no ser más reciente". El aviso
                        //  flotante no salía hasta que un latido posterior
                        //  —hasta 5 s— cambiaba `updatedAt`, y entonces se
                        //  anunciaban de golpe todos los goles acumulados. Es el
                        //  "efecto embudo" que reportó el autor: 4 avisos juntos
                        //  al llegar al séptimo gol.
                        //
                        //  El visor ya no depende de esto (v567 reordenó sus
                        //  guardas), pero el dato estaba MAL en origen: un
                        //  documento que acaba de cambiar tiene que decir que ha
                        //  cambiado. De aquí también comen el "↻ hora" de la
                        //  cabecera y el cierre por abandono a las 4 h de
                        //  `cleanupLiveMatches`, que con un partido lleno de
                        //  sucesos y sin latido lo daba por muerto.
                        //
                        //  ⚠️ NO altera la inmutabilidad de v434: el ancla de la
                        //  ventana de gracia es `finishedAt` (lo sella
                        //  pushLiveSnapshot al terminar) y sólo cae en
                        //  `updatedAt` cuando aquél no existe, cosa que no pasa
                        //  en ningún partido posterior a v431.
                        updatedAt: fs.serverTimestamp()
                    }, { merge: true });
                })
                .then(function() {
                    console.log('[v246] Evento guardado en Firestore OK');
                })
                .then(function() {
                    // ══════════════════════════════════════════════════════
                    //  🪶 v572 · P2 · EL SUCESO TAMBIÉN VA AL ÍNDICE LIGERO
                    // ══════════════════════════════════════════════════════
                    //  🔑 SIN ESTO, P1 SERÍA UNA REGRESIÓN. Los avisos de la
                    //  lista y de los partidos que no se están mirando salen
                    //  del índice; si el índice sólo se refrescara con el
                    //  latido, un gol tardaría hasta 15 s en anunciarse — tres
                    //  veces peor que los 5 s de antes. El suceso tiene que
                    //  empujar su propio índice, igual que empuja el gordo.
                    //
                    //  Se escribe la MISMA entrada recortada que arma
                    //  `_buildLiveIndexDoc`, y con `arrayUnion`: si dos sucesos
                    //  caen a la vez, ninguno pisa al otro. La poda a los N
                    //  últimos la hace el siguiente latido, que reescribe
                    //  `lastEvents` entero.
                    //
                    //  ⚠️ Los `tactical_move` NO entran (son el 45% de los
                    //  sucesos y no se anuncian nunca), y el fallo es mudo: el
                    //  suceso ya está guardado en el documento bueno.
                    if (type === 'tactical_move') return;
                    // ⚠️ v578 · LA FORMA DEL SUCESO SE DEFINE EN UN SOLO SITIO
                    // (`_cronosRecortaSuceso`, js/match/live/sync.js). Estaba
                    // escrita aquí Y allí, y al añadir los nombres de la
                    // sustitución para el mini-feed de la tarjeta habría que
                    // acordarse de tocar las dos: así es como el badge de
                    // solicitudes acabó siendo dos implementaciones divergiendo
                    // (v532). Si la función no estuviera, sync.js no ha cargado
                    // y el partido en vivo no funciona de todos modos: se sale
                    // sin escribir y el latido rellenará `lastEvents`.
                    var _recorta = window._cronosRecortaSuceso;
                    if (typeof _recorta !== 'function') return;
                    var _recortado = _recorta(eventEntry, _id);
                    if (!_recortado) return;
                    return import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
                        .then(function(fs) {
                            return fs.setDoc(fs.doc(fa.db, 'live_index', _id), {
                                lastEvents: fs.arrayUnion(_recortado),
                                updatedAt: fs.serverTimestamp()
                            }, { merge: true });
                        })
                        .catch(function(e) {
                            console.warn('[v572] Suceso no reflejado en el índice:', e && e.message);
                        });
                })
                .catch(function(err) {
                    console.error('[v246] ERROR guardando evento:', err && err.code || '', err && err.message);
                    // v467 · `failed-precondition: The client has already been
                    // terminated` no es un fallo de red: el cliente está muerto
                    // y NINGÚN suceso más se va a guardar. Se recupera
                    // recargando (la pestaña recupera su partido desde v465).
                    if (typeof window._cronosRecuperaSiClienteMuerto === 'function') {
                        window._cronosRecuperaSiClienteMuerto(err, '_registerMatchEvent');
                    }
                });
        } else {
            console.warn('[v246] No se pudo guardar: fa=', !!fa, 'matchId=', _id);
        }
    } catch(e) { console.error('[v246] ERROR _registerMatchEvent:', e && e.message); }
}

// ════════════════════════════════════════════════════════════════════
//  E1: Guard para acciones permitidas SOLO a jugadores EN EL CAMPO.
//  Se aplica únicamente a GOLES. Las TARJETAS y la LESIÓN se permiten
//  también en banquillo (un suplente puede recibir tarjeta o lesionarse
//  calentando).
// ====================================================================
function _requireOnField(p, accionLabel) {
    if (!p || p.status !== 'field') {
        alert(`⛔ ${p ? p.name : 'El jugador'} está en el banquillo. ` +
              `Solo se pueden registrar ${accionLabel} a jugadores EN EL CAMPO.`);
        return false;
    }
    return true;
}

// ════════════════════════════════════════════════════════════════════
//  CONFIRMACIÓN DIFERIDA DEL MODAL  (implementar.txt, 2026-07-31)
//
//  Antes, cada pulsación dentro del modal (gol, tarjeta, lesión) emitía su
//  aviso AL INSTANTE. Un doble clic o una rectificación mandaban avisos falsos
//  que ya no se podían retirar del visor en vivo.
//
//  AHORA: mientras el modal está abierto, los eventos se APARCAN. Al pulsar
//  HECHO se emite únicamente la DIFERENCIA NETA respecto al estado que tenía el
//  jugador al abrirlo. Así:
//    · +1 y luego −1 gol  → no se emite nada
//    · +1 +1 −1           → se emite UN gol
//    · roja y luego revertirla → no se emite nada
//  El estado local y la interfaz siguen respondiendo al instante: lo único que
//  se aplaza es el AVISO, que es lo que el autor pidió.
//
//  ⚠️ HECHO es la ÚNICA salida del modal (index.html no tiene ✕ ni cierre por
//  fondo), así que "cerrar sin confirmar" es en la práctica rectificar. Si algún
//  día se añade otra salida, debe llamar a _descartarEventosModal().
// ════════════════════════════════════════════════════════════════════
var _modalStaging  = false;
var _modalBuffer   = [];
var _modalBaseline = null;

// ════════════════════════════════════════════════════════════════════
//  📝 v801 · EL MODAL TRABAJA SOBRE UN BORRADOR
//
//  Encargo del autor (implementar.txt 2026-10-11, capturas 11308-11311):
//  con la ventana del jugador ABIERTA, el visor ya pintaba «LESIÓN ·
//  DÁMASO», el marcador 1-0 y «GOL · DÁMASO»; y tras −1 el marcador volvía
//  a 0-0 pero el GOL se quedaba en el historial del visor.
//
//  🔑 EL AVISO YA ESPERABA A HECHO (lo de arriba); LO QUE NO ESPERABA ERA EL
//  ESTADO. Cada pulsación cambiaba al momento la ficha REAL del jugador
//  (goles, tarjeta, lesión), su historial y el marcador, y además forzaba un
//  envío inmediato (`liveSyncOnAction` / `liveSyncFlushNow`). El visor
//  recibía la ficha cambiada, la comparaba con la anterior y DEDUCÍA el
//  suceso por su cuenta (su vía «por diferencia»). Por esa puerta lateral se
//  colaba todo antes de confirmar.
//
//  AHORA, con el modal abierto:
//    · las acciones cambian una COPIA del jugador (`_modalBorrador`), no la
//      ficha real: ni el latido de 5 s, ni el autoguardado, ni el marcador
//      ven nada;
//    · los envíos al directo, los «eventos críticos» durables y la
//      auditoría se APARCAN como los avisos;
//    · HECHO (`_confirmarEventosModal`) aplica el borrador a la ficha real,
//      emite la diferencia neta, guarda lo aparcado y envía UNA vez;
//    · LIMPIAR (`clearPlayerActions`, decisión del autor: «descartar») tira
//      el borrador y cierra SIN tocar ni enviar nada; lo registrado antes de
//      abrir se queda intacto.
//
//  ⚠️ SE COPIAN DE VUELTA SÓLO LOS CAMPOS DEL MODAL (goles, tarjeta,
//  amarillas, lesión) y lo AÑADIDO al historial. El reloj sigue sumando
//  `time` a la ficha real mientras el modal está abierto: copiar el
//  borrador entero le devolvería los segundos de cuando se abrió.
//
//  ⚠️ La roja, la doble amarilla y la rectificación CIERRAN el modal: son
//  su propia confirmación. Esas ramas pasan el borrador a la ficha real
//  (`_borradorAlReal`) ANTES de mover al jugador al banquillo y contar
//  expulsiones, que se cuentan sobre `players`.
// ════════════════════════════════════════════════════════════════════
var _modalBorrador     = null;
var _modalHistBase     = 0;      // longitud del historial al abrir
var _modalSyncPend     = null;   // null | 'normal' | 'ya'
var _modalCriticos     = [];     // commitCriticalEvent aplazados
var _modalAuditoria    = [];     // auditLogger.logPlayerAction aplazados
var _CAMPOS_MODAL      = ['goals', 'cards', 'yellowCards', 'injured'];

// El jugador sobre el que actúa el modal: el BORRADOR mientras está abierto.
function _jugadorDelModal() {
    if (!activeActionPlayerId) return null;
    if (_modalStaging && _modalBorrador && _modalBorrador.id === activeActionPlayerId) return _modalBorrador;
    try { return players.find(function (x) { return x.id === activeActionPlayerId; }) || null; } catch (e) { return null; }
}

// Lo apuntado en el historial DURANTE el modal, por la diferencia NETA (la
// misma criba que los avisos): un +1 −1 no deja «GOL» + «GOL ANULADO», y una
// lesión marcada y desmarcada no deja «LESIÓN». Lo que no es del modal (el
// movimiento al banquillo de una roja) pasa tal cual.
function _historialNeto(nuevas, base, b) {
    var net = (b.goals || 0) - (base.goals || 0);
    var esGol = function (h) { return /^GOL \(/.test(h); };
    var esAnulado = function (h) { return /^GOL ANULADO/.test(h); };
    var esLesion = function (h) { return /^LESIÓN /.test(h); };
    var goles = nuevas.filter(esGol), anulados = nuevas.filter(esAnulado);
    var quedanGoles = net > 0 ? goles.slice(-net) : [];
    var quedanAnul  = net < 0 ? anulados.slice(net) : [];
    var lesionNueva = b.injured === true && base.injured !== true;
    var lesionHecha = false;
    return nuevas.filter(function (h) {
        if (esGol(h))     return quedanGoles.indexOf(h) >= 0;
        if (esAnulado(h)) return quedanAnul.indexOf(h) >= 0;
        if (esLesion(h)) { if (!lesionNueva || lesionHecha) return false; lesionHecha = true; return true; }
        return true;
    });
}

// Vuelca el borrador en la ficha real y devuelve la ficha real.
function _borradorAlReal() {
    var b = _modalBorrador;
    if (!b) return _jugadorDelModal();
    var real = null;
    try { real = players.find(function (x) { return x.id === b.id; }) || null; } catch (e) {}
    _modalBorrador = null;
    if (!real) return null;
    _CAMPOS_MODAL.forEach(function (k) { if (k in b) real[k] = b[k]; });
    var nuevas = _historialNeto((Array.isArray(b.history) ? b.history : []).slice(_modalHistBase),
                                _modalBaseline || {}, b);
    if (nuevas.length) {
        if (!Array.isArray(real.history)) real.history = [];
        nuevas.forEach(function (h) { real.history.push(h); });
    }
    return real;
}

// Los tres efectos que salen del aparato, aplazados mientras hay modal.
function _syncAccion(inmediato) {
    if (_modalStaging) { _modalSyncPend = (inmediato || _modalSyncPend === 'ya') ? 'ya' : 'normal'; return; }
    if (inmediato && typeof window.liveSyncFlushNow === 'function') window.liveSyncFlushNow();
    else if (typeof liveSyncOnAction === 'function') liveSyncOnAction();
}
function _criticoAccion(tipo, datos) {
    if (_modalStaging) { _modalCriticos.push([tipo, datos]); return; }
    if (typeof commitCriticalEvent === 'function') commitCriticalEvent(tipo, datos);
}
function _auditaAccion() {
    var args = Array.prototype.slice.call(arguments);
    if (_modalStaging) { _modalAuditoria.push(args); return; }
    if (window.auditLogger && liveMatchId) window.auditLogger.logPlayerAction.apply(window.auditLogger, args);
}

function _descartarEventosModal() {
    _modalStaging = false;
    _modalBuffer = [];
    _modalBaseline = null;
    // 📝 v801 · y con ellos el borrador y todo lo aparcado: nada sale.
    _modalBorrador = null;
    _tarjetaVentana = null;     // 🟨 v802 · la tarjeta marcada, también
    _modalSyncPend = null;
    _modalCriticos = [];
    _modalAuditoria = [];
}

// Emite del buffer SÓLO lo que sobrevive al diff contra el estado inicial.
function _confirmarEventosModal() {
    var buffer = _modalBuffer;
    var base = _modalBaseline || {};
    // 📝 v801 · El borrador pasa a la ficha real AQUÍ, en HECHO.
    var pReal = _borradorAlReal();
    var criticos = _modalCriticos, auditoria = _modalAuditoria, syncPend = _modalSyncPend;
    _modalStaging = false;          // desde aquí, _registerMatchEvent vuelve a emitir
    _modalBuffer = [];
    _modalBaseline = null;
    _modalCriticos = [];
    _modalAuditoria = [];
    _modalSyncPend = null;

    var p = pReal;
    if (!p) { try { p = players.find(function (x) { return x.id === base.id; }) || null; } catch (e) {} }
    if (!p) return;

    var netGoles     = (p.goals || 0) - (base.goals || 0);
    var cambioTarjeta = p.cards !== base.cards;
    var lesionNueva   = p.injured === true && base.injured !== true;
    var golesEmitidos = 0;
    var anuladosEmitidos = 0;

    buffer.forEach(function (ev) {
        var type = ev[0];
        if (type === 'goal') {
            if (golesEmitidos < netGoles) { golesEmitidos++; _registerMatchEvent.apply(null, ev); }
            return;
        }
        // ⚽❌ v789 · los avisos de GOL ANULADO, sólo por lo que de verdad se
        // quitó respecto a lo que había al abrir (el mismo neto, en negativo).
        if (type === 'goal_cancelled') {
            if (anuladosEmitidos < -netGoles) { anuladosEmitidos++; _registerMatchEvent.apply(null, ev); }
            return;
        }
        if (type === 'yellow' || type === 'red') {
            if (cambioTarjeta) _registerMatchEvent.apply(null, ev);
            return;
        }
        if (type === 'injury') {
            if (lesionNueva) _registerMatchEvent.apply(null, ev);
            return;
        }
        _registerMatchEvent.apply(null, ev);
    });

    // 📝 v801 · LO APARCADO, AHORA. Los «eventos críticos» durables, con la
    // misma criba neta que los avisos (un +1 −1 no deja un gol guardado); la
    // auditoría, entera (es el rastro de lo que se pulsó y se confirmó).
    var golesGuardados = 0;
    criticos.forEach(function (c) {
        var t = c[0];
        if (t === 'goal') { if (golesGuardados < netGoles) { golesGuardados++; } else return; }
        if (t === 'injury' && !(c[1] && c[1].value === true && lesionNueva)) return;
        if ((t === 'card_yellow' || t === 'card_red' || t === 'red_card_reversed') && !cambioTarjeta) return;
        if (typeof commitCriticalEvent === 'function') commitCriticalEvent(t, c[1]);
    });
    if (window.auditLogger && liveMatchId) {
        auditoria.forEach(function (a) { window.auditLogger.logPlayerAction.apply(window.auditLogger, a); });
    }

    // El marcador se mueve AHORA (durante el modal no lo hizo: los goles
    // estaban en el borrador), y el directo recibe UN envío con el resultado.
    var huboCambio = netGoles !== 0 || cambioTarjeta || ((p.injured === true) !== (base.injured === true));
    if (netGoles !== 0 && typeof syncScoreFromPlayers === 'function') {
        try { syncScoreFromPlayers(p.team); } catch (e) {}
    }
    // Sin diferencia neta (un +1 −1) no hay nada que enviar.
    if (huboCambio) _syncAccion(syncPend === 'ya' || netGoles !== 0);
}

function openPlayerActionModal(player) {
    // Foto del estado al abrir: es contra esto contra lo que se diffea en HECHO.
    _modalBuffer = [];
    _modalBaseline = {
        id: player.id,
        goals: player.goals || 0,
        cards: player.cards,
        // 🟨 v802 · las amarillas que ya tenía: deciden si lo que se marca
        // es la 1ª o la 2ª (ver _ponTarjetaEnBorrador).
        yellowCards: (typeof player.yellowCards === 'number') ? player.yellowCards : 0,
        injured: player.injured === true
    };
    _tarjetaVentana = null;
    _modalStaging = true;
    // 📝 v801 · El borrador: una copia con SU historial (logEvent escribe ahí).
    _modalBorrador = Object.assign({}, player,
        { history: Array.isArray(player.history) ? player.history.slice() : [] });
    _modalHistBase = _modalBorrador.history.length;
    _modalSyncPend = null;
    _modalCriticos = [];
    _modalAuditoria = [];
    activeActionPlayerId = player.id;
    document.getElementById('action-player-name').innerHTML =
        `${escapeHtml(player.name)} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-number').innerHTML =
        `Dorsal ${escapeHtml(String(player.number))} <span style="font-size:0.8rem">✏️</span>`;
    document.getElementById('action-player-goals').textContent = `${player.goals || 0} ⚽`;

    // ── Resaltar botones de tarjeta (🟨 v802 · según el borrador) ──
    _pintaBotonesTarjeta();

    // Reflejar estado de lesión en el botón
    const injBtn = document.getElementById('btn-injury');
    if (injBtn) {
        injBtn.style.background = player.injured ? 'rgba(231,76,60,0.3)' : 'rgba(255,255,255,0.08)';
        injBtn.style.border     = player.injured ? '1px solid #e74c3c' : '';
        injBtn.textContent      = player.injured ? '🚑 Lesionado ✓' : '🚑 Lesión';
    }
    // ── E1: Deshabilitar SOLO los botones de GOL (+1/-1) si el jugador
    //    NO está en el campo. Tarjetas (🟨/🟥) y lesión (🚑) permanecen
    //    SIEMPRE activas: un suplente puede recibir tarjeta o lesionarse
    //    calentando. Se actúa sobre cada botón changeGoals de forma
    //    individual (NO sobre el contenedor padre, que comparte fila con
    //    la lesión) para no afectar a otras acciones.
    const onField = player.status === 'field';
    document.querySelectorAll('#player-action-modal .btn[onclick*="changeGoals"]').forEach(btn => {
        btn.disabled = !onField;
        btn.style.opacity = onField ? '' : '0.35';
        btn.style.pointerEvents = onField ? '' : 'none';
        btn.title = onField ? '' : 'Solo se registran goles a jugadores EN EL CAMPO';
    });

    // ── Botón de rectificación arbitral (revertir tarjeta roja) ──
    // Solo visible cuando el jugador está expulsado. Se inyecta/retira
    // dinámicamente para no alterar el HTML estático del modal.
    _syncRevertRedCardButton(player);

    document.getElementById('player-action-modal').style.display = 'flex';
}

// ════════════════════════════════════════════════════════════════════
//  Inserta o elimina el botón "Revertir tarjeta roja (rectificación
//  arbitral)" dentro del modal según el estado del jugador.
// ════════════════════════════════════════════════════════════════════
function _syncRevertRedCardButton(player) {
    const modal = document.getElementById('player-action-modal');
    if (!modal) return;
    const content = modal.querySelector('.modal-content');
    if (!content) return;

    const existing = document.getElementById('btn-revert-red');

    if (player.cards !== 'roja') {
        if (existing) existing.remove();
        return;
    }

    if (existing) return; // ya presente

    const btn = document.createElement('button');
    btn.id = 'btn-revert-red';
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = '↩️ Revertir tarjeta roja (rectificación arbitral)';
    btn.style.cssText =
        'width:100%;margin-top:0.6rem;background:#5a3a1a;color:#ffd9a3;' +
        'border:1px solid #e67e22;font-size:0.78rem;font-weight:700;';
    btn.setAttribute('onclick', 'revertRedCard()');
    content.appendChild(btn);
}

function closePlayerActionModal() {
    // HECHO: aquí y sólo aquí se emiten los avisos aparcados, ya filtrados por
    // la diferencia neta contra el estado inicial.
    // 🟨🟥 v802 · Primero la tarjeta marcada en la ventana (se apunta y se
    // registra AHORA). Si expulsa, al banquillo ANTES de confirmar, para que
    // el único envío al directo lleve ya al jugador fuera del campo.
    const _exp = (typeof _aplicaTarjetaVentana === 'function') ? _aplicaTarjetaVentana() : null;
    let _expulsado = null;
    if (_exp) {
        _expulsado = _borradorAlReal();
        if (_expulsado && _expulsado.status === 'field') {
            _expulsado.status = 'bench'; _expulsado.x = 0; _expulsado.y = 0;
            if (isRunning) logMovement(_expulsado, undefined, 'field');   // v425: transicion real campo->banquillo
        }
    }
    _confirmarEventosModal();
    activeActionPlayerId = null;
    document.getElementById('player-action-modal').style.display = 'none';
    renderPlayers(); // redibujar para mostrar cambios (lesión, tarjeta, goles)
    renderStaffInBench();

    // La expulsión, ya confirmada: límite del equipo o aviso.
    if (_exp && _expulsado) {
        const limit = currentMode === 'f7' ? 3 : 5;
        const teamReds = players.filter(x => x.team === _expulsado.team && x.cards === 'roja').length;
        if (teamReds >= limit) {
            terminateMatch(`LÍMITE DE EXPULSIONES ALCANZADO (${limit} en ${_expulsado.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away})`);
        } else {
            alert(_exp.doble
                ? `🟨🟨 DOBLE AMARILLA: ${_exp.nombre} queda EXPULSADO y retirado al banquillo.`
                : `🟥 TARJETA ROJA: ${_exp.nombre} ha sido expulsado y retirado al banquillo.`);
        }
        renderPlayers();
    }
}

function toggleInjury() {
    if (!activeActionPlayerId) return;
    // 📝 v801 · el BORRADOR del modal (ver _jugadorDelModal): hasta HECHO no
    // cambia la ficha real, ni sale nada.
    const p = _jugadorDelModal();
    if (!p) return;
    const wasInjured = p.injured;
    p.injured = !p.injured;
    if (p.injured) { logEvent(p, 'LESIÓN'); _registerMatchEvent('injury', 'LESIÓN · ' + p.name, '🚑', undefined, _datosEquipoDe(p)); }

    // 📊 SOLUCIÓN #7: Auditar cambio de lesión (📝 v801 · aparcado hasta HECHO)
    _auditaAccion(
        p.id,
        p.name,
        p.number,
        'injury',
        p.injured ? 'marcado' : 'desmarcado',
        { injured: { before: wasInjured, after: p.injured } }
    );

    // Actualizar botón del modal — compatible con ambos estilos de markup
    const btn = document.getElementById('btn-injury');
    if (btn) {
        btn.style.background  = p.injured ? 'rgba(231,76,60,0.3)'  : 'rgba(255,255,255,0.08)';
        btn.style.border      = p.injured ? '1px solid #e74c3c'    : '';
        btn.style.borderColor = p.injured ? '#e74c3c'              : 'transparent';
        // Soporte para botón con <span> interior o texto directo
        const span = btn.querySelector('span');
        if (span) {
            span.style.color = p.injured ? '#e74c3c' : 'var(--text-muted)';
        } else {
            btn.textContent = p.injured ? '🚑 Lesionado ✓' : '🚑 Lesión';
        }
    }
    renderPlayers();
    // Commit síncrono del evento crítico (snapshot localStorage + IndexedDB
    // durable) antes de sincronizar con Firestore. Mecanismo único en
    // commitCriticalEvent() para no perder el evento si el navegador se cierra.
    _criticoAccion('injury', { playerId: p.id, playerName: p.name, playerNumber: p.number, value: p.injured });
    _syncAccion(false);
}

// ════════════════════════════════════════════════════════════════════
//  assignCard v2 — Con doble amarilla = expulsión automática
//
//  Flujo:
//    1ª amarilla → p.cards='amarilla', p.yellowCards=1 → badge "1" en chip
//    2ª amarilla → p.cards='roja', p.yellowCards=2 → badge "2🟨" en chip
//    Roja directa → p.cards='roja', p.yellowCards=0 → badge "🟥" en chip
//
//  Al final del partido se distingue claramente si fue doble amarilla
//  o roja directa gracias al campo yellowCards.
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
//  🟨🟥 v802 · LAS TARJETAS SE ALTERNAN EN EL BORRADOR
//
//  Encargo del autor (implementar.txt 2026-10-11, capturas 11315-11316):
//  las tarjetas tienen que poder marcarse, desmarcarse o revertirse con un
//  nuevo clic antes de HECHO, igual que los goles y la lesión. Un toque de
//  más en la amarilla saltaba DIRECTAMENTE a la doble amarilla: expulsaba,
//  cerraba la ventana y mandaba al jugador al banquillo.
//
//  AHORA, dentro de la ventana:
//    · 🟨 un clic marca la amarilla de esta ventana; otro la quita. Si el
//      jugador ya tenía una de antes, lo que se marca es la 2ª —y se dice
//      («2ª → EXPULSIÓN»)—, pero NO expulsa hasta HECHO;
//    · 🟥 un clic marca la roja directa; otro la quita;
//    · son EXCLUYENTES (decisión del autor): marcar una quita la otra;
//    · NADA se apunta en el historial, ni se avisa, ni se guarda mientras
//      tanto: la tarjeta es sólo un estado del borrador (`_tarjetaVentana`).
//  En HECHO (`_aplicaTarjetaVentana`, desde closePlayerActionModal) se apunta,
//  se avisa y, si expulsa, se manda al banquillo, se cuenta el límite de
//  expulsiones y se avisa al usuario. LIMPIAR la descarta con todo lo demás.
//
//  ⚠️ Un jugador YA expulsado al abrir no se toca desde aquí: eso está
//  registrado y se corrige con «Revertir tarjeta roja» (rectificación
//  arbitral, con su confirmación y su rastro en el informe).
// ════════════════════════════════════════════════════════════════════
var _tarjetaVentana = null;   // null | 'amarilla' | 'roja'

function _baseTarjeta() {
    var b = _modalBaseline || {};
    return { cards: b.cards || 'ninguna', yellow: (typeof b.yellowCards === 'number') ? b.yellowCards : 0 };
}

// Pone en el borrador la tarjeta elegida en esta ventana (o la quita).
function _ponTarjetaEnBorrador(p) {
    var b = _baseTarjeta();
    if (_tarjetaVentana === 'amarilla') {
        if (b.cards === 'amarilla' && b.yellow >= 1) { p.cards = 'roja'; p.yellowCards = 2; }
        else { p.cards = 'amarilla'; p.yellowCards = 1; }
    } else if (_tarjetaVentana === 'roja') {
        p.cards = 'roja'; p.yellowCards = 0;   // roja directa → NO es doble amarilla
    } else {
        p.cards = b.cards; p.yellowCards = b.yellow;
    }
}

function _badge(btn, texto, fondo, titulo) {
    var badge = document.createElement('span');
    badge.className   = 'cronos-ycard-badge';
    badge.textContent = texto;
    badge.style.cssText = 'margin-left:5px;background:' + fondo + ';color:#000;' +
        'border-radius:3px;font-size:0.62rem;font-weight:800;' +
        'padding:1px 4px;vertical-align:middle;';
    badge.title = titulo;
    btn.appendChild(badge);
}

function _pintaBotonesTarjeta() {
    var b = _baseTarjeta();
    var btnAm = document.querySelector('#player-action-modal .btn[onclick*="amarilla"]');
    var btnRo = document.querySelector('#player-action-modal .btn[onclick*="roja"]');
    [btnAm, btnRo].forEach(function (btn) {
        if (!btn) return;
        var old = btn.querySelectorAll ? btn.querySelectorAll('.cronos-ycard-badge') : [];
        Array.prototype.forEach.call(old, function (x) { x.remove(); });
        btn.style.outline = ''; btn.style.boxShadow = '';
    });
    if (btnAm) {
        var tieneUna = b.cards === 'amarilla' && b.yellow >= 1;
        if (_tarjetaVentana === 'amarilla') {
            btnAm.style.outline   = tieneUna ? '3px solid #ff5858' : '3px solid #fff';
            btnAm.style.boxShadow = '0 0 12px rgba(241,196,15,0.95)';
            _badge(btnAm, tieneUna ? '2ª → EXPULSIÓN' : '✓', tieneUna ? '#ff9b93' : '#fff',
                   'Marcada en esta ventana. Vuelve a pulsar para quitarla. Se aplica al pulsar HECHO.');
        } else if (tieneUna) {
            btnAm.style.outline   = '3px solid #f1c40f';
            btnAm.style.boxShadow = '0 0 10px rgba(241,196,15,0.9)';
            _badge(btnAm, '1ª', '#f1c40f', 'Ya tiene 1ª amarilla — marcar otra = EXPULSIÓN al pulsar HECHO');
        }
    }
    if (btnRo) {
        if (_tarjetaVentana === 'roja') {
            btnRo.style.outline   = '3px solid #fff';
            btnRo.style.boxShadow = '0 0 12px rgba(231,76,60,0.95)';
            _badge(btnRo, '✓', '#fff', 'Marcada en esta ventana. Vuelve a pulsar para quitarla. Se aplica al pulsar HECHO.');
        } else if (b.cards === 'roja') {
            btnRo.style.outline   = '3px solid #fff';
            btnRo.style.boxShadow = '0 0 8px rgba(231,76,60,0.8)';
        }
    }
}

function assignCard(type) {
    if (!activeActionPlayerId) return;
    // 📝 v801 · el BORRADOR del modal (ver _jugadorDelModal).
    const p = _jugadorDelModal();
    if (!p) return;
    if (type !== 'amarilla' && type !== 'roja') return;

    // ── Jugador ya expulsado AL ABRIR ─────────────────────────────
    if (_baseTarjeta().cards === 'roja') {
        alert(`⛔ ${p.name} ya está expulsado.\n\nSi se trata de un error, usa "Revertir tarjeta roja (rectificación arbitral)".`);
        return;
    }

    // Alternar: la misma tarjeta otra vez la QUITA; la otra la SUSTITUYE.
    _tarjetaVentana = (_tarjetaVentana === type) ? null : type;
    _ponTarjetaEnBorrador(p);
    _pintaBotonesTarjeta();
}

// ── HECHO · la tarjeta de la ventana se hace REAL ──────────────────
//  Se llama desde closePlayerActionModal ANTES de _confirmarEventosModal:
//  apunta en el historial del borrador y registra el suceso (aparcado, sale
//  en la confirmación). Si expulsa, devuelve los datos para terminar fuera.
function _aplicaTarjetaVentana() {
    var t = _tarjetaVentana;
    _tarjetaVentana = null;
    var p = _jugadorDelModal();
    if (!t || !p) return null;
    var b = _baseTarjeta();
    var antes = { card: b.cards, yellowCards: b.yellow };
    if (t === 'amarilla' && p.cards === 'amarilla') {
        logEvent(p, 'TARJETA AMARILLA'); _registerMatchEvent('yellow', 'TARJETA AMARILLA · ' + p.name, '🟨', undefined, _datosEquipoDe(p));
        _criticoAccion('card_yellow', { playerId: p.id, playerName: p.name, playerNumber: p.number, value: 1 });
        _auditaAccion(p.id, p.name, p.number, 'card', 'amarilla_1',
            { card: { before: antes.card, after: 'amarilla' }, yellowCards: { before: antes.yellowCards, after: 1 } });
        return null;
    }
    var doble = (t === 'amarilla');
    logEvent(p, doble ? 'DOBLE AMARILLA → EXPULSADO' : 'TARJETA ROJA');
    _registerMatchEvent('red', 'TARJETA ROJA · ' + p.name + (doble ? ' (doble amarilla)' : ''), '🟥', undefined, _datosEquipoDe(p));
    _criticoAccion('card_red', { playerId: p.id, playerName: p.name, playerNumber: p.number,
                                 value: doble ? 'doble_amarilla' : 'roja_directa' });
    _auditaAccion(p.id, p.name, p.number, 'card', doble ? 'doble_amarilla' : 'roja_directa',
        { card: { before: antes.card, after: 'roja' }, yellowCards: { before: antes.yellowCards, after: doble ? 2 : 0 } });
    return { doble: doble, nombre: p.name };
}

// ════════════════════════════════════════════════════════════════════
//  revertRedCard — Rectificación arbitral de una tarjeta roja.
//
//  Deshace una expulsión asignada por error. A diferencia de assignCard,
//  el jugador NO cambia de posición: se queda donde está (campo o
//  banquillo). Queda registrado en el historial del jugador, en el
//  auditLogger ('red_card_reversed') y como evento crítico durable.
// ════════════════════════════════════════════════════════════════════
function revertRedCard() {
    if (!activeActionPlayerId) return;
    // 📝 v801 · el borrador del modal; la rectificación cierra = confirma.
    let p = _jugadorDelModal();
    if (!p) return;

    // Solo aplica a jugadores realmente expulsados.
    if (p.cards !== 'roja') return;

    if (!confirm('¿Confirmar rectificación arbitral? Esta acción quedará registrada en el informe.')) {
        return;
    }
    p = _borradorAlReal() || p;

    const wasCards   = p.cards;
    const wasYellow  = (typeof p.yellowCards === 'number') ? p.yellowCards : 0;

    // Revertir: el jugador deja de estar expulsado. NO se mueve de su
    // posición actual (campo o banquillo se mantiene tal cual).
    p.cards       = 'ninguna';
    p.yellowCards = 0;

    // Historial del jugador / matchEvents
    logEvent(p, 'ROJA REVERTIDA (rectificación arbitral)');

    // Evento crítico durable (mismo patrón que assignCard).
    _criticoAccion('red_card_reversed', {
        playerId: p.id,
        playerName: p.name,
        playerNumber: p.number,
        value: 'rectificacion_arbitral'
    });

    _syncAccion(false);

    // Auditoría (antes → después).
    {
        _auditaAccion(
            p.id,
            p.name,
            p.number,
            'red_card_reversed',
            'rectificacion_arbitral',
            {
                card: { before: wasCards, after: 'ninguna' },
                yellowCards: { before: wasYellow, after: 0 },
                position: p.status, // queda en su posición actual (sin mover)
                timestamp: new Date().toISOString()
            }
        );
    }

    closePlayerActionModal();
    renderPlayers();
}
window.revertRedCard = revertRedCard;

function terminateMatch(reason) {
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';
    // Punto 2: limpiar el estado persistido para que el partido no quede
    // recuperable tras finalizar por expulsiones (misma corrección que endMatch).
    try {
        // v465 · sólo la ranura de ESTE partido (ver js/core/match-slots.js).
        // La misma corrección que en endMatch: el fin por expulsiones tampoco
        // puede invalidar el partido que otra pestaña siga jugando.
        window._cronosMatchSlots?.cerrar(
            window._cronosMatchSlots.slotIdActual(
                (typeof liveMatchId !== 'undefined') ? liveMatchId : null),
            true);
    } catch (e) {}
    // Commit sincrono del FIN (por expulsiones) como evento critico durable.
    try {
        const _mgr = window._cronosOffline;
        if (_mgr && typeof _mgr.saveEventSync === 'function') {
            _mgr.saveEventSync({
                kind: 'match_critical', type: 'phase', detail: { phase: 'finished', reason: reason },
                phase: 'finished',
                matchId: (typeof liveMatchId !== 'undefined') ? liveMatchId : null,
                clientTs: Date.now(),
            }).catch(() => {});
        }
    } catch (e) { /* silencioso */ }
    document.getElementById('btn-play-pause').textContent = 'P. FINALIZADO';
    document.getElementById('btn-play-pause').classList.remove('danger');
    stopLiveSync();

    // Disparar informes automáticos e internos
    // FIX (C4): log de errores en vez de silenciarlos. Antes una promesa
    // rechazada (p.ej. permisos Firestore) no se reportaba y los informes de
    // staff no se escribían sin rastro en consola.
    if (typeof saveAllMatchReportsInternal === 'function') {
        Promise.resolve(saveAllMatchReportsInternal()).catch(e => {
            console.error('[C4 terminateMatch] Error al guardar informes automáticamente:', e && e.message);
        });
    }

    alert(`🏁 PARTIDO FINALIZADO: ${reason}\nResultado final: ${TEAM_NAMES.home} ${document.getElementById('score-home').textContent} - ${document.getElementById('score-away').textContent} ${TEAM_NAMES.away}`);
}

// NOTA (auditoría 2026-07-22, deuda "endMatch duplicado"): la definición de
// window.endMatch vivía aquí también, pero index.html carga active-match.js
// DESPUÉS de este archivo, así que esa versión (más completa: limpia
// localStorage, empuja el snapshot 'finished' a Firestore, dispara el triple
// silbato) siempre ganaba y esta quedaba muerta. Eliminada para no depender
// del orden de <script> — la única definición real vive ahora en
// js/match/persistence/active-match.js.

function changeGoals(amount) {
    if (!activeActionPlayerId) return;
    // 📝 v801 · el BORRADOR del modal: el marcador y el directo no se mueven
    // hasta HECHO (ver _confirmarEventosModal).
    const p = _jugadorDelModal();
    if (p) {
        // ── E1: Goles SOLO a jugadores en el campo ──
        if (!_requireOnField(p, 'goles')) { closePlayerActionModal(); return; }
        // 🔴 v716 · La misma pregunta única que en `changeScore` (ver la nota
        // de js/match/timer/core.js): el aviso salía con el partido en marcha
        // porque el reloj y `isRunning` se habían separado.
        if (typeof window.cronosPartidoEnJuego === 'function'
            ? !window.cronosPartidoEnJuego() : !isRunning) {
            alert("⚠️ No se pueden sumar o quitar goles con el cronómetro del partido detenido. Debe iniciar o reanudar el partido.");
            return;
        }
        const prevGoals = p.goals || 0;
        p.goals = Math.max(0, prevGoals + amount);
        if (amount > 0 && p.goals > prevGoals) {
            logEvent(p, `GOL (${p.goals}º)`); _registerMatchEvent('goal', 'GOL · ' + p.name, '⚽', undefined, _datosEquipoDe(p));
            
            // 📊 SOLUCIÓN #7: Auditar gol (aparcado hasta HECHO)
            {
                _auditaAccion(
                    p.id,
                    p.name,
                    p.number,
                    'goal',
                    `gol_${p.goals}`,
                    { goals: { before: prevGoals, after: p.goals } }
                );
            }
        } else if (amount < 0 && p.goals < prevGoals) {
            logEvent(p, `GOL ANULADO (Quedan: ${p.goals})`);
            // ⚽❌ v789 · el aviso de GOL ANULADO para el visor y las familias.
            // Con el modal abierto queda APARCADO y _confirmarEventosModal lo
            // suelta sólo si al pulsar HECHO el jugador tiene MENOS goles que
            // al abrir: un +1 −1 dentro del modal no avisa de nada.
            _registerMatchEvent('goal_cancelled', 'GOL ANULADO · ' + p.name, '❌', undefined, _datosEquipoDe(p));

            // 📊 SOLUCIÓN #7: Auditar gol anulado (aparcado hasta HECHO)
            {
                _auditaAccion(
                    p.id,
                    p.name,
                    p.number,
                    'goal_cancelled',
                    `gol_anulado_${p.goals}`,
                    { goals: { before: prevGoals, after: p.goals } }
                );
            }
        }
        document.getElementById('action-player-goals').textContent = `${p.goals} ⚽`;
        syncScoreFromPlayers(p.team);
        renderPlayers();
        // Commit síncrono del evento crítico antes de sincronizar con Firestore.
        // Solo cuando el gol AUMENTA (amount > 0): los goles anulados no
        // necesitan registrarse como evento crítico de gol.
        if (amount > 0) {
            _criticoAccion('goal', { playerId: p.id, playerName: p.name, playerNumber: p.number, team: p.team, value: p.goals });
        }
        // v225: flush inmediato en goles (no esperar al throttle de 500ms)
        // para que el panel en vivo reciba el gol sin delay. Antes usábamos
        // liveSyncOnAction() que esperaba 2s (ahora 500ms) y el gol podía
        // llegar retrasado o perderse en race conditions.
        // v789 · y también al ANULAR: su aviso no puede llegar tarde.
        // 📝 v801 · con el modal abierto, aparcado: el envío es en HECHO.
        _syncAccion(amount !== 0 && p.goals !== prevGoals);
    }
}

function syncScoreFromPlayers(team) {
    const total = players.filter(x => x.team === team).reduce((sum, x) => sum + (x.goals || 0), 0);
    const extra = window._cronosExtraGoals ? (window._cronosExtraGoals[team] || 0) : 0;
    document.getElementById(`score-${team}`).textContent = total + extra;
}

// ════════════════════════════════════════════════════════════════════
//  🧹 v801 · LIMPIAR = DESCARTAR (decisión del autor, 2026-10-11)
//
//  Antes ponía a CERO goles, tarjetas y lesión del jugador en TODO el
//  partido —también lo registrado antes de abrir la ventana— y, al cerrar
//  con HECHO, lo transmitía como goles anulados.
//
//  Ahora deshace SÓLO lo que se tocó en ESTA ventana y la cierra SIN enviar
//  ni guardar nada: el borrador se tira (la ficha real nunca lo vio) y con
//  él los avisos, envíos, guardados y auditoría aparcados. Lo registrado
//  antes de abrir se queda intacto.
//
//  ⚠️ Sin la comprobación del reloj parado que tenía: descartar no cambia
//  nada del partido, así que se puede siempre.
// ════════════════════════════════════════════════════════════════════
function clearPlayerActions() {
    if (!activeActionPlayerId) return;
    _descartarEventosModal();
    activeActionPlayerId = null;
    const modal = document.getElementById('player-action-modal');
    if (modal) modal.style.display = 'none';
    renderPlayers();
    if (typeof renderStaffInBench === 'function') renderStaffInBench();
}

function editNameFromModal() {
    if (!activeActionPlayerId) return;
    const player = players.find(p => p.id === activeActionPlayerId);
    const newName = prompt(`Editar nombre para dorsal ${player.number}:`, player.name);
    if (newName !== null && newName.trim() !== "") {
        player.name = newName.trim();
        document.getElementById('action-player-name').innerHTML =
            `${escapeHtml(player.name)} <span style="font-size:0.8rem">✏️</span>`;
        renderPlayers();
    }
}

function editNumberFromModal() {
    if (!activeActionPlayerId) return;
    const player = players.find(p => p.id === activeActionPlayerId);
    const newNum = prompt(`Editar dorsal para ${player.name}:`, player.number);
    if (newNum !== null && !isNaN(newNum)) {
        player.number = newNum;
        document.getElementById('action-player-number').innerHTML =
            `Dorsal ${escapeHtml(String(player.number))} <span style="font-size:0.8rem">✏️</span>`;
        renderPlayers();
    }
}

function selectForSubstitution(benchPlayer) {
    pendingSubstitution = { player: benchPlayer };
    closeDrawers();
    document.querySelectorAll('.player-chip').forEach(c => c.classList.remove('sub-selected', 'sub-target'));
    const selectedChip = document.getElementById(`player-${benchPlayer.id}`);
    if (selectedChip) selectedChip.classList.add('sub-selected');
    players.filter(p => p.team === benchPlayer.team && p.status === 'field').forEach(p => {
        const chip = document.getElementById(`player-${p.id}`);
        if (chip) chip.classList.add('sub-target');
    });
    const actionsEl = document.getElementById('phase-actions');
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'btn-cancel-sub';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = '✕ Cancelar cambio';
    cancelBtn.style.cssText = 'background:var(--glass);color:var(--danger);font-size:0.7rem;';
    cancelBtn.onclick = cancelPendingSubstitution;
    if (!document.getElementById('btn-cancel-sub')) actionsEl.appendChild(cancelBtn);
}

function confirmSubstitutionWith(fieldPlayer) {
    if (!pendingSubstitution) return;
    const inPlayer = pendingSubstitution.player;

    // 🟨 La normativa de la categoría YA NO SE COMPRUEBA AQUÍ: la aplica
    //    `handleSmartSwap`, que es el punto por el que pasan las CUATRO vías
    //    de sustitución (ésta, el GRUPAL y las dos de arrastrar y soltar).
    //    En v622 se engancharon los llamantes y las de arrastrar quedaron sin
    //    control — el autor hizo seis cambios en un Juvenil sin ver el aviso.
    //    Dejarla también aquí contaría el cambio DOS veces.
    const _swapHecho = handleSmartSwap(pendingSubstitution.player, fieldPlayer);
    if (_swapHecho === false) { cancelPendingSubstitution(); return; }
    cancelPendingSubstitution();
    renderPlayers();
    // Commit síncrono del evento crítico antes de sincronizar con Firestore.
    if (typeof commitCriticalEvent === 'function') {
        commitCriticalEvent('substitution', {
            playerId: inPlayer ? inPlayer.id : null,
            playerName: inPlayer ? inPlayer.name : null,
            playerNumber: inPlayer ? inPlayer.number : null,
            value: { inId: inPlayer ? inPlayer.id : null, outId: fieldPlayer ? fieldPlayer.id : null },
        });
    }
    liveSyncOnAction();
}

function cancelPendingSubstitution() {
    pendingSubstitution = null;
    document.querySelectorAll('.player-chip').forEach(c => c.classList.remove('sub-selected', 'sub-target'));
    const cancelBtn = document.getElementById('btn-cancel-sub');
    if (cancelBtn) cancelBtn.remove();
    // NOTA: NO tocamos groupSubMode aquí para evitar el bug circular
    updateMasterUI();
}

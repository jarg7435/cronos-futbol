// ══════════════════════════════════════════════════════════════════════
//  📤 v724 · LA BANDEJA DE SALIDA DE SUCESOS · UNA COLA POR PARTIDO
//  js/match/live/outbox.js
// ══════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-16, capturas 10538-10543 y
//  10588-10591): «el cronómetro del partido y el visor en vivo continuaron
//  sincronizados […] pero la cola de eventos tácticos (cambios, goles,
//  tarjetas y lesiones) se congeló por completo», con el requisito de
//  escalabilidad de 20-30 clubes × 10-15 equipos un sábado por la mañana.
//
//  📏 LO PRIMERO, LA MEDICIÓN — Y CORRIGE EL DIAGNÓSTICO DEL ENCARGO
//  ─────────────────────────────────────────────────────────────────────
//  Las cuatro capturas del VISOR (10538 a las 01:57, 10539 a las 02:03,
//  10542 a las 02:13 y 10543 a las 02:15) llevan todas el MISMO sello en la
//  cabecera: **«↻ 01:55:47»**. Ese texto lo pinta `renderMatch` en live.html
//  con `data.updatedAt`, o sea LA HORA DEL ÚLTIMO SNAPSHOT RECIBIDO. Y la
//  captura 10541 (lista de Partidos en Vivo, 02:13) lo confirma desde otro
//  sitio: «FUTUREFEM C · Actualizado 01:55» frente a «PREBENJAMÍN A ·
//  Actualizado 02:13».
//
//  🔑 O SEA QUE NO SE CONGELÓ «LA COLA DE EVENTOS»: SE CONGELÓ EL DOCUMENTO
//  ENTERO. Desde las 01:55:47 no llegó NADA de ese partido — ni sucesos, ni
//  marcador, ni alineación. La prueba definitiva está en el propio par de
//  capturas: a las 02:13 el entrenador tiene **3-0** (10591) y a las 02:15 el
//  visor sigue mostrando **2-0** (10543). El marcador viaja en el latido, no
//  en el canal de sucesos; si sólo hubiera fallado el canal de sucesos, el
//  marcador habría llegado igual.
//
//  🔑🔑 Y ENTONCES ¿POR QUÉ «EL CRONÓMETRO SEGUÍA SINCRONIZADO»? Porque el
//  reloj del visor NO viaja: se deriva de `phaseStartedAt` —un instante
//  absoluto— contra el `Date.now()` del propio espectador
//  (`_startAutonomousPhaseWatch`, decisión de v572). Los dos aparatos cuentan
//  SOLOS desde la misma ancla, así que siguen pareciendo sincronizados
//  aunque no se cruce un solo byte. El reloj que corría era la ILUSIÓN; el
//  canal llevaba veinte minutos muerto.
//
//  ⚠️ ESTO IMPORTA PARA EL ARREGLO: buscar el fallo «en el canal de sucesos»
//  habría sido buscar donde no estaba. Lo que hay que garantizar es que
//  NINGÚN camino de escritura pueda quedarse mudo para siempre sin
//  reintentar y sin decirlo.
//
//  🔴 LOS CUATRO DEFECTOS QUE SE CIERRAN AQUÍ (los cuatro, leídos en el
//     código de v723, no deducidos)
//  ─────────────────────────────────────────────────────────────────────
//  1 · UN SUCESO QUE FALLA SE PIERDE PARA SIEMPRE. `_registerMatchEvent`
//      escribía directamente y su `.catch` sólo hacía `console.error`. No
//      había reintento. Y el latido NO puede repararlo: `pushLiveSnapshot`
//      tiene PROHIBIDO mandar `events` como array plano (v246), así que un
//      gol que se cae en su único intento no vuelve a salir nunca. Un
//      parpadeo de cobertura —la norma en un campo— borraba el suceso del
//      directo de forma permanente y en silencio.
//
//  2 · EL APARCAMIENTO TÁCTICO ERA UNA GLOBAL SIN PARTIDO.
//      `window._cronosTacticalPending` no llevaba `matchId`: `pushLiveSnapshot`
//      lo volcaba entero sobre `live_matches/<liveMatchId>`, el que tocara en
//      ese momento. Con dos partidos en la misma pestaña, los movimientos de
//      uno acababan escritos en el documento del OTRO. Es justo lo contrario
//      del «aislamiento total por ID de partido» que pide el encargo.
//
//  3 · EL VACIADO POR `slice(n)` PERDÍA MOVIMIENTOS. El latido hacía
//      `pendientes.slice()`, escribía, y al volver hacía
//      `pendientes.slice(n)` — por POSICIÓN. Con dos latidos en vuelo (que es
//      lo normal: no había ningún guard de concurrencia) el segundo recortaba
//      por una longitud que ya no correspondía y se llevaba por delante
//      movimientos que NADIE había enviado. Aquí se retira POR `eventId`,
//      nunca por posición.
//
//  4 · UNA ESCRITURA COLGADA PARABA EL CANAL PARA SIEMPRE. El `setDoc` del
//      SDK sólo resuelve cuando el servidor confirma; sin plazo, una
//      escritura atascada deja la promesa pendiente indefinidamente. No había
//      un solo `timeout` en todo el camino de emisión.
//
//  🔑 LA FORMA DE LA SOLUCIÓN, Y POR QUÉ ASÍ
//  ─────────────────────────────────────────────────────────────────────
//  Una COLA POR `matchId`, cada una con su propio temporizador, su propio
//  vuelo y su propio contador de fallos. Dos partidos del mismo aparato no
//  comparten nada: si el de Futurefem se atasca, el de Prebenjamín sigue
//  emitiendo. Ése es el aislamiento que pide el punto 2 del encargo, y es lo
//  que hace que la arquitectura escale: el coste de un partido atascado no se
//  reparte entre los demás.
//
//  · SE RETIRA DE LA COLA DESPUÉS DEL ACUSE, Y POR IDENTIDAD. Mientras el
//    servidor no confirme, el suceso sigue en la cola. Nada se da por enviado
//    por haberlo intentado.
//  · REINTENTO CON ESPERA CRECIENTE Y SORTEO. 800 ms, 1,6 s, 3,2 s… con tope
//    de 20 s y ±25% de sorteo. El sorteo NO es decorativo: con cientos de
//    partidos reintentando a la vez, esperas idénticas los sincronizan y
//    forman una ola que vuelve a saturar el canal (el «trueno de rebaño»).
//  · PLAZO EN CADA ESCRITURA. Pasados 12 s sin acuse se da por fallida y se
//    reintenta. La primera puede llegar más tarde: **no importa, y ésa es la
//    pieza que hace seguro el reintento** — `arrayUnion` con un objeto
//    IDÉNTICO no añade nada (Firestore compara por valor), así que reenviar
//    el mismo suceso es una operación nula. Por eso el `eventId` se calcula
//    UNA vez y el objeto no se vuelve a tocar jamás.
//  · AGRUPACIÓN POR LOTES. Hasta 25 sucesos en UNA escritura. Una ráfaga
//    —tres cambios seguidos, o veinte arrastres— deja de ser veinte
//    escrituras que cada espectador tiene que bajarse.
//  · LOS TÁCTICOS ESPERAN MÁS (5 s) QUE LOS ANUNCIABLES (350 ms). Se conserva
//    íntegro el ahorro de v576: un `tactical_move` no puede hacer bajar el
//    documento gordo a todos los espectadores por cada píxel arrastrado. Pero
//    ahora esperan EN SU COLA, con su partido, y con reintento.
//  · PERSISTE EN `localStorage`. Si la pestaña se recarga o el navegador mata
//    la página con la cola llena, los sucesos siguen ahí y salen al volver.
//    La clave `cronos_outbox::<matchId>` la aísla por uid el envoltorio de
//    v720 sin que haya que hacer nada.
//  · Y SI SE ATASCA, SE VE. Un canal mudo es lo que hizo perder veinte
//    minutos de partido sin que nadie se enterara. Pasado el umbral, se avisa
//    al entrenador una vez por episodio.
//
//  ⚠️ LO QUE ESTE MÓDULO **NO** HACE, A PROPÓSITO: no toca el reloj, no
//  decide qué es un suceso y no conoce el partido. Recibe objetos ya hechos y
//  los entrega. Si Firestore no está, encola igual y espera: el partido se
//  juega sin depender de la red (la lección de v714).
//
//  Cubierto por scripts/test_cola_sucesos_outbox.js y
//  scripts/test_estres_concurrencia_masiva.js.
// ══════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
    var PREFIJO_CLAVE = 'cronos_outbox::';

    // ── Los números, en un solo sitio y sustituibles por los tests ──────
    // ⚠️ `ventanaTactica` es el ahorro de v576 hecho número. Bajarlo devuelve
    // el documento gordo a cada arrastre. Si algún día se toca, hay que volver
    // a medir el consumo con scripts/test_p1_p2_consumo.js.
    var T = {
        loteMax:          25,      // sucesos por escritura
        ventanaUrgente:   350,     // ms · gol, tarjeta, cambio, lesión, comentario
        ventanaTactica:   5000,    // ms · tactical_move (v576: se agrupan)
        plazoEscritura:   12000,   // ms · sin acuse se da por fallida y se reintenta
        esperaBase:       800,     // ms · primer reintento
        esperaTope:       20000,   // ms · tope del reintento
        topeCola:         600,     // sucesos retenidos por partido
        avisoAtascoMs:    60000,   // ms sin acuse con cola pendiente → se avisa
        conciliaCadaMs:   90000    // ms entre comprobaciones de «¿llegó de verdad?»
    };

    // Los que NO se anuncian nunca y por tanto no gastan escritura en el
    // índice ligero (v572). Es la misma lista que miraba player-actions.js.
    var NO_ANUNCIABLES = { tactical_move: 1 };

    // Cola por partido. La clave es SIEMPRE el matchId: es lo único que no
    // puede confundir un partido con otro.
    var colas = Object.create(null);

    // Escritor sustituible. En producción es Firestore; en los tests, un doble
    // que puede fallar, tardar o duplicar a voluntad.
    var _escritor = null;
    // Lector sustituible, para el conciliador de v725 (ver más abajo).
    var _lector = null;

    // ── Utilidades mínimas, todas a prueba de entorno ───────────────────
    function _ahora() { return Date.now(); }

    function _log(msg, extra) {
        try { console.warn('[v724 cola] ' + msg, extra === undefined ? '' : extra); } catch (e) {}
    }

    function _lsGet(k) {
        try { return (typeof localStorage !== 'undefined') ? localStorage.getItem(k) : null; }
        catch (e) { return null; }
    }
    function _lsSet(k, v) {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); }
        catch (e) { /* cuota llena: la cola sigue viva en memoria */ }
    }
    function _lsDel(k) {
        try { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); } catch (e) {}
    }

    // ── El plazo: una promesa que no puede esperar para siempre ─────────
    //  ⚠️ EL TEMPORIZADOR SE APAGA PASE LO QUE PASE. Sin el `clear`, cada
    //  escritura dejaría un temporizador vivo hasta su vencimiento; con
    //  cientos de partidos eso es basura acumulándose en el hilo.
    function conPlazo(promesa, ms, etiqueta) {
        if (!promesa || typeof promesa.then !== 'function') return Promise.resolve(promesa);
        if (!(ms > 0)) return promesa;
        return new Promise(function (resolver, rechazar) {
            var vencido = false;
            var t = setTimeout(function () {
                vencido = true;
                var err = new Error('plazo-agotado' + (etiqueta ? ' (' + etiqueta + ')' : ''));
                err.code = 'cronos/plazo-agotado';
                rechazar(err);
            }, ms);
            promesa.then(function (v) {
                clearTimeout(t);
                if (!vencido) resolver(v);
            }, function (e) {
                clearTimeout(t);
                if (!vencido) rechazar(e);
            });
        });
    }

    // Espera creciente CON SORTEO. Ver la nota del encabezado: sin el sorteo,
    // cientos de clientes reintentando vuelven a chocar todos a la vez.
    function _espera(fallos) {
        var base = Math.min(T.esperaTope, T.esperaBase * Math.pow(2, Math.max(0, fallos - 1)));
        var sorteo = 0.75 + Math.random() * 0.5;   // ±25%
        return Math.round(base * sorteo);
    }

    // ── La cola de un partido ───────────────────────────────────────────
    function _cola(matchId) {
        var id = String(matchId || '');
        if (!id) return null;
        if (colas[id]) return colas[id];
        colas[id] = {
            id:            id,
            pendientes:    _hidrata(id),
            enVuelo:       false,
            temporizador:  null,
            fallos:        0,
            enviados:      0,
            descartados:   0,
            ultimoError:   null,
            ultimoEnvioOk: 0,
            avisado:       false
        };
        return colas[id];
    }

    function _hidrata(id) {
        var crudo = _lsGet(PREFIJO_CLAVE + id);
        if (!crudo) return [];
        try {
            var d = JSON.parse(crudo);
            var lista = Array.isArray(d) ? d : (d && Array.isArray(d.pendientes) ? d.pendientes : []);
            // Sólo lo que tiene identidad: sin `eventId` no se puede retirar de
            // la cola por identidad ni deduplicar, que es todo lo que sostiene
            // este módulo.
            return lista.filter(function (e) { return e && typeof e === 'object' && e.eventId; });
        } catch (e) { return []; }
    }

    function _persiste(cola) {
        if (!cola.pendientes.length) { _lsDel(PREFIJO_CLAVE + cola.id); return; }
        _lsSet(PREFIJO_CLAVE + cola.id, JSON.stringify({
            actualizado: _ahora(),
            pendientes:  cola.pendientes
        }));
    }

    // ⚠️ EL TOPE SACRIFICA TÁCTICOS ANTES QUE NADA. Un `tactical_move` perdido
    // le quita fluidez a la animación de «Revivir»; un gol, una tarjeta o un
    // cambio perdidos falsean el partido. Si la cola desborda, se van los
    // tácticos más viejos y los anunciables se quedan.
    function _recorta(cola) {
        if (cola.pendientes.length <= T.topeCola) return;
        var sobran = cola.pendientes.length - T.topeCola;
        for (var i = 0; i < cola.pendientes.length && sobran > 0; ) {
            if (NO_ANUNCIABLES[cola.pendientes[i].type]) {
                cola.pendientes.splice(i, 1);
                cola.descartados++; sobran--;
            } else { i++; }
        }
        // Si aun así sobra (una cola de sólo anunciables: imposible en la
        // práctica, pero no se deja crecer sin fin) se va lo más viejo.
        if (sobran > 0) {
            cola.descartados += sobran;
            cola.pendientes.splice(0, sobran);
        }
        _log('cola de ' + cola.id + ' desbordada: ' + cola.descartados + ' descartados');
    }

    function _hayUrgente(cola) {
        for (var i = 0; i < cola.pendientes.length; i++) {
            if (!NO_ANUNCIABLES[cola.pendientes[i].type]) return true;
        }
        return false;
    }

    function _programa(cola) {
        if (cola.enVuelo || cola.temporizador || !cola.pendientes.length) return;
        var ms = cola.fallos > 0 ? _espera(cola.fallos)
               : (_hayUrgente(cola) ? T.ventanaUrgente : T.ventanaTactica);
        cola.temporizador = setTimeout(function () {
            cola.temporizador = null;
            _drena(cola);
        }, ms);
        // Un temporizador de cola no puede mantener vivo un proceso de Node
        // (los tests) ni impedir que el navegador descargue la página.
        if (cola.temporizador && typeof cola.temporizador.unref === 'function') {
            try { cola.temporizador.unref(); } catch (e) {}
        }
    }

    // ── El drenaje ──────────────────────────────────────────────────────
    //  🔑 UNA SOLA ESCRITURA EN VUELO POR PARTIDO. Es lo que impide la pila de
    //  llamadas solapadas que causaba el defecto 3. Y es POR PARTIDO: el
    //  atasco de uno no bloquea a los demás.
    function _drena(cola) {
        if (cola.enVuelo || !cola.pendientes.length) return Promise.resolve(false);
        cola.enVuelo = true;

        var lote = cola.pendientes.slice(0, T.loteMax);

        return _escribe(cola.id, lote).then(function () {
            // ✅ ACUSE RECIBIDO. Sólo AHORA se retira, y POR `eventId`: si
            // mientras tanto entraron sucesos nuevos, siguen donde estaban.
            var enviados = Object.create(null);
            lote.forEach(function (e) { enviados[e.eventId] = 1; });
            cola.pendientes = cola.pendientes.filter(function (e) { return !enviados[e.eventId]; });
            cola.enviados      += lote.length;
            cola.fallos         = 0;
            cola.ultimoError    = null;
            cola.ultimoEnvioOk  = _ahora();
            cola.avisado        = false;
            _persiste(cola);
            return true;
        }).catch(function (err) {
            // ❌ NO SE RETIRA NADA. El lote entero vuelve a intentarse.
            cola.fallos++;
            cola.ultimoError = (err && (err.code || err.message)) || 'error';
            _log('partido ' + cola.id + ': intento ' + cola.fallos + ' fallido (' +
                 cola.ultimoError + '), ' + cola.pendientes.length + ' en cola');
            _avisaSiAtascada(cola);
            return false;
        }).then(function (ok) {
            cola.enVuelo = false;
            if (cola.pendientes.length) _programa(cola);
            return ok;
        });
    }

    // Un canal mudo es lo que costó veinte minutos de partido el 16/09 sin que
    // nadie lo viera. Se avisa UNA vez por episodio (se rearma con el primer
    // acuse bueno), para informar sin convertirse en una lluvia de avisos.
    function _avisaSiAtascada(cola) {
        if (cola.avisado) return;
        var desde = cola.ultimoEnvioOk || 0;
        if (desde && (_ahora() - desde) < T.avisoAtascoMs) return;
        if (!desde && cola.fallos < 4) return;
        cola.avisado = true;
        try {
            if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
                window.showToast('📡 Sin conexión con el directo: ' + cola.pendientes.length +
                                 ' sucesos en espera. Se enviarán solos al recuperarla.', 6000);
            }
        } catch (e) {}
    }

    // ── La escritura ────────────────────────────────────────────────────
    //  Dos documentos, y el orden importa: primero el GORDO (la verdad del
    //  partido) y después el ÍNDICE (lo prescindible). Si el índice fallara,
    //  el lote ya está confirmado en el documento bueno y no se reintenta: los
    //  lectores del índice caen solos al gordo (el respaldo de v572).
    function _escribe(matchId, lote) {
        if (typeof _escritor === 'function') {
            try { return conPlazo(Promise.resolve(_escritor(matchId, lote)), T.plazoEscritura, 'escritor'); }
            catch (e) { return Promise.reject(e); }
        }
        var fa = (typeof window !== 'undefined') ? window._cronos_auth : null;
        if (!fa || !fa.db) return Promise.reject(new Error('sin-firestore'));

        return import(FIRESTORE_URL).then(function (fs) {
            // ⚠️ `arrayUnion`, NUNCA un array plano: `setDoc merge` REEMPLAZA
            // arrays y un array plano aquí borraría el historial entero del
            // partido (la prohibición de v246).
            //
            // 🔑🔑 Y EL SELLO DE HORA VIAJA CON EL SUCESO, como desde v567: un
            // documento que acaba de cambiar tiene que decir que ha cambiado, o
            // la guarda monotónica del visor descarta el snapshot entero y el
            // aviso no suena hasta el siguiente latido.
            var escrituraGorda = fs.setDoc(
                fs.doc(fa.db, 'live_matches', matchId),
                {
                    events:    fs.arrayUnion.apply(null, lote),
                    updatedAt: fs.serverTimestamp()
                },
                { merge: true }
            );

            return conPlazo(escrituraGorda, T.plazoEscritura, 'live_matches').then(function () {
                var recorta = (typeof window !== 'undefined') ? window._cronosRecortaSuceso : null;
                if (typeof recorta !== 'function') return;
                // ⚠️ LA FORMA DEL SUCESO RECORTADO SE DEFINE EN UN SOLO SITIO
                // (`_cronosRecortaSuceso`, js/match/live/sync.js). Estuvo
                // escrita dos veces y las dos copias divergieron (v578).
                var recortados = [];
                lote.forEach(function (e) {
                    if (NO_ANUNCIABLES[e.type]) return;   // v572: no gastan índice
                    var r = recorta(e, matchId);
                    if (r) recortados.push(r);
                });
                if (!recortados.length) return;
                return conPlazo(
                    fs.setDoc(
                        fs.doc(fa.db, 'live_index', matchId),
                        {
                            lastEvents: fs.arrayUnion.apply(null, recortados),
                            updatedAt:  fs.serverTimestamp()
                        },
                        { merge: true }
                    ),
                    T.plazoEscritura, 'live_index'
                ).catch(function (e) {
                    // Mudo a propósito: el suceso YA está en el documento bueno.
                    _log('índice no reflejado en ' + matchId + ':', e && e.message);
                });
            });
        });
    }

    // ══════════════════════════════════════════════════════════════════
    //  API pública
    // ══════════════════════════════════════════════════════════════════

    // Encola un suceso YA CONSTRUIDO para un partido CONCRETO.
    // ⚠️ El `matchId` es obligatorio y explícito: no se deriva de ninguna
    // global. Ése es todo el punto del aislamiento que pide el encargo.
    function encola(matchId, suceso) {
        var cola = _cola(matchId);
        if (!cola) { _log('suceso sin matchId: no se encola'); return false; }
        if (!suceso || typeof suceso !== 'object' || !suceso.eventId) {
            _log('suceso sin eventId: no se encola'); return false;
        }
        // Idempotencia en la propia cola: un doble clic o un reintento del
        // llamante no duplica el suceso.
        for (var i = 0; i < cola.pendientes.length; i++) {
            if (cola.pendientes[i].eventId === suceso.eventId) return true;
        }
        cola.pendientes.push(suceso);
        _recorta(cola);
        _persiste(cola);
        _programa(cola);
        return true;
    }

    // Fuerza un drenaje inmediato (lo usan el fin de partido y el botón de
    // guardar). Devuelve una promesa que se resuelve cuando la cola queda
    // vacía o cuando ya no se puede avanzar más en `vueltas` intentos.
    function drenaYa(matchId, vueltas) {
        var cola = _cola(matchId);
        if (!cola) return Promise.resolve(false);
        if (cola.temporizador) { clearTimeout(cola.temporizador); cola.temporizador = null; }
        var quedan = (typeof vueltas === 'number' && vueltas > 0) ? vueltas : 1;
        var paso = function () {
            if (!cola.pendientes.length) return Promise.resolve(true);
            if (quedan-- <= 0) return Promise.resolve(false);
            return _drena(cola).then(function (ok) { return ok ? paso() : false; });
        };
        return paso();
    }

    // Recupera la cola que dejó una recarga o un cierre inesperado. La llama
    // `startLiveSync` en cuanto sabe cuál es su partido.
    function recupera(matchId) {
        var cola = _cola(matchId);
        if (!cola) return 0;
        cola.fallos = 0;          // sesión nueva: se empieza a reintentar desde ya
        if (cola.pendientes.length) _programa(cola);
        return cola.pendientes.length;
    }

    // ══════════════════════════════════════════════════════════════════
    //  🔁 v725 · RECUPERAR **TODAS** LAS COLAS, NO SÓLO LA DEL PARTIDO
    // ══════════════════════════════════════════════════════════════════
    //  🔴 EL AGUJERO QUE CIERRA. `recupera(matchId)` sólo se llamaba desde
    //  `startLiveSync`, o sea SÓLO para el partido que se está arrancando. La
    //  cola que dejaba un partido **ya terminado** —el caso normal: el
    //  entrenador pita el final con cobertura mala, cierra la app y se va del
    //  campo— no la recuperaba nadie, y `barre(24)` la borraba al día
    //  siguiente. Eran sucesos guardados en disco, intactos, que se tiraban
    //  por no volver a mirarlos.
    //
    //  🔑 Ahora se adoptan TODAS las colas con sucesos dentro en cuanto la app
    //  vuelve a tener Firestore, sea cual sea el partido que se abra. Lo que
    //  quedó a medias de un partido de ayer sale hoy.
    function recuperaTodas() {
        var ids = _idsGuardados();
        var total = 0;
        ids.forEach(function (id) {
            var cola = _cola(id);
            if (!cola || !cola.pendientes.length) return;
            cola.fallos = 0;
            _programa(cola);
            total += cola.pendientes.length;
        });
        return { colas: ids.length, sucesos: total };
    }

    // Los ids que tienen cola guardada en disco. Se apoya en
    // `cronosClavesLocales` (v720) porque la clave real lleva el uid pegado.
    function _idsGuardados() {
        var claves = [];
        try {
            if (typeof window !== 'undefined' && typeof window.cronosClavesLocales === 'function') {
                claves = window.cronosClavesLocales(PREFIJO_CLAVE) || [];
            } else if (typeof localStorage !== 'undefined') {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(PREFIJO_CLAVE) === 0) claves.push(k);
                }
            }
        } catch (e) { return []; }
        var vistos = Object.create(null);
        claves.forEach(function (clave) {
            // La clave real puede venir como `cronos_outbox::<id>@<uid>`.
            var id = String(clave).slice(PREFIJO_CLAVE.length).split('@')[0];
            if (id) vistos[id] = 1;
        });
        Object.keys(colas).forEach(function (id) { vistos[id] = 1; });
        return Object.keys(vistos);
    }

    // ══════════════════════════════════════════════════════════════════
    //  🔎 v725 · EL CONCILIADOR · «¿DE VERDAD LLEGÓ?»
    // ══════════════════════════════════════════════════════════════════
    //  📏 POR QUÉ HACE FALTA, Y QUÉ NO ARREGLA LA COLA SOLA. La cola garantiza
    //  que un suceso se reintenta hasta que el servidor ACUSA. Eso cubre el
    //  fallo y la latencia, que eran los agujeros de v723. Lo que NO cubre es
    //  todo lo que ocurre ANTES de entrar en la cola o FUERA de ella:
    //    · un suceso que nació cuando `liveMatchId` todavía era null;
    //    · uno que la puerta estanca de v469 bloqueó y se descartó;
    //    · uno que se encoló en un navegador que se cerró y cuyo `localStorage`
    //      estaba lleno (la persistencia falla en silencio, por diseño);
    //    · el respaldo sin reintento de `_registerMatchEvent`, si el módulo de
    //      la cola no hubiera cargado;
    //    · y cualquier defecto futuro que hoy no sabemos ver.
    //
    //  🔑 LA DIFERENCIA ENTRE «CONFIAR» Y «COMPROBAR». Sin esto, la respuesta a
    //  «¿llegaron todos los goles?» es «deberían». Con esto es una MEDICIÓN: se
    //  lee lo que el servidor tiene guardado, se compara contra el registro
    //  local del entrenador (`window._cronosMatchEvents`, que lleva TODO lo que
    //  pulsó) y lo que falte **se vuelve a encolar**. La pérdida deja de ser
    //  silenciosa y pasa a ser auto-reparable.
    //
    //  ⚠️ NO CUENTA COMO «FALTA» LO QUE ESTÁ EN CAMINO. Un suceso que sigue en
    //  la cola aún no tiene por qué estar en el servidor: re-encolarlo sería
    //  duplicar trabajo. Se excluyen los pendientes antes de comparar.
    //
    //  ⚠️ Y SI LA LECTURA FALLA, NO SE REPARA NADA. Un `getDoc` caído no
    //  significa «el servidor no tiene nada»: significa que no lo sabemos. Dar
    //  por perdido lo que no se ha podido leer re-encolaría el partido entero
    //  en cada corte de red. Ante la duda, no se toca.
    //
    //  ⚠️ CUESTA UNA LECTURA por pasada y por partido. A 90 s son 40 lecturas
    //  por hora y partido: con los 30 partidos de una jornada, 1.200 lecturas —
    //  frente a las 74.000 diarias que ya factura el proyecto. Es barato.
    function concilia(matchId) {
        var id = String(matchId || '');
        if (!id) return Promise.resolve({ revisados: 0, reparados: 0, leido: false });

        return _leeSucesosDelServidor(id).then(function (enServidor) {
            // `null` = no se ha podido leer. No es lo mismo que «vacío».
            if (!enServidor) return { revisados: 0, reparados: 0, leido: false };

            var locales = [];
            try {
                var log = (typeof window !== 'undefined' && window._cronosMatchEvents) || [];
                locales = log.filter(function (e) {
                    return e && e.eventId && (!e.matchId || e.matchId === id);
                });
            } catch (e) { return { revisados: 0, reparados: 0, leido: true }; }

            var cola = colas[id];
            var enCamino = Object.create(null);
            if (cola) cola.pendientes.forEach(function (e) { enCamino[e.eventId] = 1; });

            var reparados = 0;
            locales.forEach(function (ev) {
                if (enServidor[ev.eventId]) return;   // ya está
                if (enCamino[ev.eventId]) return;     // va de camino
                if (encola(id, ev)) reparados++;
            });

            if (reparados) {
                _log('conciliación de ' + id + ': ' + reparados +
                     ' sucesos no estaban en el servidor y se han vuelto a encolar');
                if (cola) cola.reparados = (cola.reparados || 0) + reparados;
            }
            return { revisados: locales.length, reparados: reparados, leido: true };
        }).catch(function () {
            return { revisados: 0, reparados: 0, leido: false };
        });
    }

    // Devuelve un mapa {eventId: 1} de lo que el servidor tiene, o `null` si no
    // se ha podido leer (que NO es lo mismo que «no tiene nada»).
    function _leeSucesosDelServidor(matchId) {
        if (typeof _lector === 'function') {
            try { return Promise.resolve(_lector(matchId)).catch(function () { return null; }); }
            catch (e) { return Promise.resolve(null); }
        }
        var fa = (typeof window !== 'undefined') ? window._cronos_auth : null;
        if (!fa || !fa.db) return Promise.resolve(null);
        return import(FIRESTORE_URL).then(function (fs) {
            return conPlazo(fs.getDoc(fs.doc(fa.db, 'live_matches', matchId)),
                            T.plazoEscritura, 'conciliar');
        }).then(function (snap) {
            if (!snap || !snap.exists()) return null;
            var datos = snap.data() || {};
            if (!Array.isArray(datos.events)) return null;
            var mapa = Object.create(null);
            datos.events.forEach(function (e) { if (e && e.eventId) mapa[e.eventId] = 1; });
            return mapa;
        }).catch(function () { return null; });
    }

    // Arranca/para la conciliación periódica de un partido. La llama
    // `startLiveSync` y la para `stopLiveSync`.
    var _vigias = Object.create(null);
    function vigila(matchId, cada) {
        var id = String(matchId || '');
        if (!id) return null;
        if (_vigias[id]) clearInterval(_vigias[id]);
        var ms = (typeof cada === 'number' && cada > 0) ? cada : T.conciliaCadaMs;
        _vigias[id] = setInterval(function () { concilia(id); }, ms);
        if (_vigias[id] && typeof _vigias[id].unref === 'function') {
            try { _vigias[id].unref(); } catch (e) {}
        }
        return _vigias[id];
    }
    function noVigiles(matchId) {
        var id = String(matchId || '');
        if (_vigias[id]) { clearInterval(_vigias[id]); delete _vigias[id]; }
    }

    function pendientes(matchId) {
        var cola = colas[String(matchId || '')];
        return cola ? cola.pendientes.length : 0;
    }

    // Cierra la cola de un partido y borra su rastro. SÓLO para un partido que
    // se reinicia o se borra: cerrarla con sucesos dentro los pierde.
    function cierra(matchId) {
        var id = String(matchId || '');
        var cola = colas[id];
        if (cola && cola.temporizador) clearTimeout(cola.temporizador);
        delete colas[id];
        _lsDel(PREFIJO_CLAVE + id);
    }

    // Diagnóstico. `CronosOutbox.estado()` en la consola dice, partido a
    // partido, si algo se está quedando atrás — que es lo que no se pudo ver
    // el 16/09.
    function estado(matchId) {
        var resumen = {};
        Object.keys(colas).forEach(function (id) {
            if (matchId && id !== String(matchId)) return;
            var c = colas[id];
            resumen[id] = {
                pendientes:    c.pendientes.length,
                enVuelo:       c.enVuelo,
                fallos:        c.fallos,
                enviados:      c.enviados,
                descartados:   c.descartados,
                // 🔎 v725 · cuántos tuvo que rescatar el conciliador. Un número
                // distinto de cero aquí significa que algo se escapó de la cola
                // y se recuperó: es la señal de que queda un agujero por buscar.
                reparados:     c.reparados || 0,
                ultimoError:   c.ultimoError,
                ultimoEnvioOk: c.ultimoEnvioOk
            };
        });
        return resumen;
    }

    // Barre las colas huérfanas que dejó un partido de hace días. Sin esto,
    // `localStorage` acumula sucesos de partidos que ya no existen.
    function barre(maxHoras) {
        var horas = (typeof maxHoras === 'number' && maxHoras > 0) ? maxHoras : 24;
        var corte = _ahora() - horas * 3600 * 1000;
        var claves = [];
        try {
            if (typeof window !== 'undefined' && typeof window.cronosClavesLocales === 'function') {
                claves = window.cronosClavesLocales(PREFIJO_CLAVE) || [];
            } else if (typeof localStorage !== 'undefined') {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(PREFIJO_CLAVE) === 0) claves.push(k);
                }
            }
        } catch (e) { return 0; }
        var barridas = 0;
        claves.forEach(function (clave) {
            var id = String(clave).slice(PREFIJO_CLAVE.length).split('@')[0];
            if (colas[id]) return;                    // viva: no se toca
            var crudo = _lsGet(PREFIJO_CLAVE + id);
            if (!crudo) return;
            try {
                var d = JSON.parse(crudo);
                if (d && d.actualizado && d.actualizado > corte) return;
                // ══════════════════════════════════════════════════════════
                //  🔴 v725 · UN GOL SIN ENTREGAR NO CADUCA
                // ══════════════════════════════════════════════════════════
                //  El barrido borraba por ANTIGÜEDAD a secas. Un partido que
                //  acabó con la cola llena y no se volvió a abrir en 24 h
                //  perdía sus sucesos AUNQUE ESTUVIERAN INTACTOS EN DISCO, y
                //  sin que nadie se enterara. El barrido está para recoger
                //  basura, no para tirar trabajo del entrenador.
                //
                //  🔑 Los `tactical_move` SÍ caducan (son pintura de la
                //  Repetición y son el 75-90% del volumen). Un gol, una
                //  tarjeta, un cambio, una lesión o un comentario, NO: se
                //  quedan hasta que `recuperaTodas` los entregue.
                var quedan = Array.isArray(d && d.pendientes) ? d.pendientes : [];
                var anunciables = quedan.filter(function (e) {
                    return e && !NO_ANUNCIABLES[e.type];
                });
                if (anunciables.length) {
                    if (anunciables.length !== quedan.length) {
                        // Se poda sólo lo caducable y se conserva lo que importa.
                        _lsSet(PREFIJO_CLAVE + id, JSON.stringify({
                            actualizado: d.actualizado || _ahora(),
                            pendientes:  anunciables
                        }));
                    }
                    _log('cola vieja de ' + id + ' CONSERVADA: ' + anunciables.length +
                         ' sucesos anunciables sin entregar');
                    return;
                }
            } catch (e) { /* ilegible: se va */ }
            _lsDel(PREFIJO_CLAVE + id);
            barridas++;
        });
        return barridas;
    }

    // ══════════════════════════════════════════════════════════════════
    //  📱 v725 · AL IRSE A SEGUNDO PLANO, SE VACÍA LO QUE HAYA
    // ══════════════════════════════════════════════════════════════════
    //  🔴 EL CASO REAL, Y ES EL MÁS FRECUENTE DE TODOS: en un iPad basta con
    //  bloquear la pantalla, atender una llamada o cambiar de app para que el
    //  navegador CONGELE la página. Los temporizadores dejan de correr, así
    //  que la ventana de agrupación de la cola no vence nunca y lo que estaba
    //  esperando se queda esperando — y si iOS decide matar la pestaña para
    //  recuperar memoria (lo hace, y sin avisar), esos sucesos sólo sobreviven
    //  en `localStorage`, hasta que alguien vuelva a abrir el partido.
    //
    //  🔑 `pagehide` y `visibilitychange` son el ÚLTIMO instante garantizado en
    //  que todavía corre nuestro código. Se fuerza el drenaje de TODAS las
    //  colas: es una escritura que probablemente ya se iba a hacer, sólo que
    //  ahora se hace mientras aún se puede.
    //
    //  ⚠️ `beforeunload` NO sirve en iOS (Safari no lo dispara de forma
    //  fiable en una PWA instalada) y `pagehide` sí. Se registran los dos
    //  caminos que funcionan, no el que suena más lógico.
    //
    //  ⚠️ SE REGISTRA UNA SOLA VEZ, aquí, porque este fichero es un IIFE que
    //  corre al cargarse. Registrarlo dentro de una función de arranque es
    //  como nacieron los listeners duplicados de v719.
    function _vaciaTodasYa() {
        try {
            Object.keys(colas).forEach(function (id) {
                if (colas[id].pendientes.length) {
                    _persiste(colas[id]);     // primero al disco, que no falla
                    drenaYa(id, 1);           // y después, un intento de salir
                }
            });
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        try {
            window.addEventListener('pagehide', _vaciaTodasYa);
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', function () {
                    if (document.visibilityState === 'hidden') _vaciaTodasYa();
                });
            }
        } catch (e) { /* sin eventos de ciclo de vida se sigue como antes */ }
    }

    // Sólo para los arneses: sustituye el escritor y/o los tiempos.
    function _configura(opciones) {
        if (!opciones) return;
        if ('escritor' in opciones) _escritor = opciones.escritor;
        if ('lector'   in opciones) _lector   = opciones.lector;
        if (opciones.tiempos) {
            Object.keys(opciones.tiempos).forEach(function (k) {
                if (k in T) T[k] = opciones.tiempos[k];
            });
        }
        if (opciones.reinicia) {
            Object.keys(colas).forEach(function (id) {
                if (colas[id].temporizador) clearTimeout(colas[id].temporizador);
                delete colas[id];
            });
            Object.keys(_vigias).forEach(function (id) {
                clearInterval(_vigias[id]); delete _vigias[id];
            });
        }
    }

    var API = {
        encola:        encola,
        drenaYa:       drenaYa,
        recupera:      recupera,
        recuperaTodas: recuperaTodas,
        concilia:      concilia,
        vigila:        vigila,
        noVigiles:     noVigiles,
        pendientes:    pendientes,
        cierra:        cierra,
        estado:        estado,
        barre:         barre,
        conPlazo:      conPlazo,
        _vaciaTodasYa: _vaciaTodasYa,
        _configura:    _configura,
        _T:            T
    };

    if (typeof window !== 'undefined') window.CronosOutbox = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();

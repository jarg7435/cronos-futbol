// ════════════════════════════════════════════════════════════════════
//  🔵🔴 v693 · REGISTRO TÁCTICO DE PÉRDIDAS Y RECUPERACIONES
//  js/match/events/possession-tracker.js
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-09-12): registrar en directo las
//  pérdidas (P) y recuperaciones (R) del EQUIPO PROPIO, con un gesto rápido
//  de banquillo, y que los datos salgan luego en el informe colectivo y en el
//  individual de cada jugador. Es una FASE DE PRUEBA: "si es ágil se
//  mantendrá, y si no, se descartará fácilmente".
//
//  🔑 POR ESO TODO VIVE AQUÍ. El módulo se pinta a sí mismo (botones, barra y
//  estilos) y no hay marcado suyo en index.html: descartarlo es borrar este
//  fichero, su <script>, la clave del extra y el trozo de informe. No se ha
//  tocado ni el modelo de `players` ni la sincronización del partido.
//
//  ⚠️⚠️ LO QUE SE REGISTRA NO VIAJA COMO SUCESO DEL PARTIDO, Y ES DELIBERADO:
//   · v576 midió que escribir en caliente sobre `live_matches` obliga a CADA
//     espectador a bajarse el documento entero (17-23 KB). Un partido con 60
//     pérdidas habría reproducido exactamente el cuello de botella que v576
//     arregló.
//   · v690 tuvo que blindar los comentarios contra el recorte a 200 sucesos
//     (los `tactical_move` son el 75-90%). Una lista propia no compite por
//     ese cupo, así que ninguna P/R puede desaparecer antes del informe.
//   · Y el historial del partido no se llena de 60 líneas que nadie lee.
//  A cambio, el visor en vivo NO muestra las P/R. No estaba en el encargo.
//
//  🔑 SE PERSISTE EN `localStorage` POR PARTIDO. Sin eso, una recarga a media
//  parte —o el "Recuperar Partido en Curso"— se llevaría por delante todo lo
//  registrado, y el dato no se puede volver a pasar a mano.
//
//  DOS PUERTAS (las dos tienen que estar abiertas):
//    1. el extra `registro_pr` del SuperAdmin (extras-toggle.js);
//    2. la categoría del partido: Cadete, Juvenil o Regional, masculinas y
//       femeninas (`cronosCategoriaConRegistroPR`, js/core/utils.js).
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var VENTANA_MS = 5000;   // cuánto espera la barra de asignación
    var _cierraBarra = null; // temporizador de la barra

    // ── Estado ───────────────────────────────────────────────────────
    // items: { id, kind:'loss'|'recovery', playerId, number, name, matchTime, createdAt }
    // `playerId: null` = registro COLECTIVO (el jugador es opcional, a
    // propósito: el encargo prioriza la velocidad sobre el detalle).
    window._cronosPR = window._cronosPR || { matchId: '', items: [] };

    function _idPartido() {
        return (typeof liveMatchId !== 'undefined' && liveMatchId) ? String(liveMatchId) : '';
    }

    function _clave() { return 'cronos_pr::' + (_idPartido() || 'sin_id'); }

    //  ☁️ v775 · `t` = instante del último cambio LOCAL. Con él decide
    //  js/match/live/stats-cloud.js si lo que llega de otro aparato es más
    //  nuevo. `desdeNube` = el guardado lo provoca una hidratación: ni se
    //  re-sella ni se vuelve a subir (sería un bucle de ecos).
    function _guarda(desdeNube) {
        if (!desdeNube) window._cronosPR.t = Date.now();
        try {
            localStorage.setItem(_clave(), JSON.stringify({
                matchId: window._cronosPR.matchId,
                items:   window._cronosPR.items,
                t:       Number(window._cronosPR.t) || 0
            }));
        } catch (e) { /* cuota o modo privado: el registro sigue vivo en memoria */ }
        if (!desdeNube && typeof window.cronosStatsNubeCambio === 'function') {
            try { window.cronosStatsNubeCambio(); } catch (e) { /* la nube nunca tumba el registro */ }
        }
    }

    // ☁️ v775 · Lo que llega de la nube (otro aparato, o este mismo al
    // recargar) sustituye al registro local de ESTE partido.
    window.cronosPRHidrata = function (items, t) {
        var id = _idPartido();
        if (!id) return false;
        window._cronosPR.matchId = id;
        window._cronosPR.items = Array.isArray(items) ? items.slice() : [];
        window._cronosPR.t = Number(t) || 0;
        _guarda(true);
        _pintaBotones();
        _pintaResumen();
        return true;
    };

    // ════════════════════════════════════════════════════════════════
    //  🔵🔴 v707 · UN PARTIDO NUEVO EMPIEZA A CERO, Y LA RECARGA NO PIERDE NADA
    // ════════════════════════════════════════════════════════════════
    //  Encargo del autor (implementar.txt 2026-09-13): «asegurar que al
    //  inicializar y crear un nuevo partido, todos los contadores de
    //  estadísticas tácticas comiencen estrictamente desde cero».
    //
    //  🔑 LA VERSIÓN ANTERIOR TENÍA DOS AGUJEROS, LOS DOS EN LA MISMA LÍNEA
    //  (`if (!id || …) return;`), y los dos por lo mismo: `liveMatchId` NO
    //  EXISTE al principio del partido (la retransmisión lo asigna ~800 ms
    //  después de pintar la plantilla) y puede no existir nunca si el
    //  entrenador no retransmite.
    //    · SIN id NO SE RESTAURABA NADA: los apuntes guardados bajo la clave
    //      `sin_id` no volvían jamás, así que una recarga a media parte los
    //      perdía — justo lo que la persistencia venía a evitar.
    //    · Y NO SE LIMPIABA NADA: los del partido ANTERIOR seguían en memoria
    //      y contaban en el informe del nuevo.
    //
    //  🔑 EL CAMBIO DE CLAVE NO TIRA LOS APUNTES: cuando el id pasa de vacío a
    //  real —que es lo que ocurre en cada partido, a los 800 ms— se MIGRAN al
    //  nuevo cajón en vez de vaciarse. Sin esto, todo lo registrado en el
    //  primer minuto de un partido sin retransmisión previa desaparecería al
    //  empezar a retransmitir.
    //
    //  ⚠️ La puesta a cero de un partido NUEVO no se adivina aquí: la pide
    //  `_cronosNuevoPartidoDeEquipo()` (app-init.js), que es el único sitio que
    //  SABE que nace un partido. Deducirlo de un id vacío sería confundir «aún
    //  no retransmito» con «otro partido».
    function _restaura() {
        var id = _idPartido() || 'sin_id';
        if (window._cronosPR.matchId === id) return;

        var previo    = window._cronosPR.matchId || '';
        var enMemoria = Array.isArray(window._cronosPR.items) ? window._cronosPR.items : [];
        window._cronosPR.matchId = id;
        window._cronosPR.items = [];
        window._cronosPR.t = 0;

        var guardados = null, tGuardado = 0;
        try {
            var crudo = localStorage.getItem(_clave());
            if (crudo) {
                var d = JSON.parse(crudo);
                if (d && Array.isArray(d.items)) { guardados = d.items; tGuardado = Number(d.t) || 0; }
            }
        } catch (e) { /* json corrupto: se empieza de cero, no se rompe el partido */ }

        if (guardados && guardados.length) {
            window._cronosPR.items = guardados;
            window._cronosPR.t = tGuardado;
            return;
        }
        // Migración `sin_id` → id real del MISMO partido: el cajón nuevo está
        // vacío y lo que hay en memoria es de este partido, no de otro.
        if (previo === 'sin_id' && id !== 'sin_id' && enMemoria.length) {
            window._cronosPR.items = enMemoria;
            _guarda();
            try { localStorage.removeItem('cronos_pr::sin_id'); } catch (e) {}
            return;
        }
        if (guardados) window._cronosPR.items = guardados;
    }

    // Lo llama `_cronosNuevoPartidoDeEquipo()` (app-init.js) al nacer un
    // partido. Borra la memoria Y el cajón sin identificar, que es el que se
    // heredaría entre partidos del mismo dispositivo.
    window.cronosPRNuevoPartido = function () {
        window._cronosPR.matchId = '';
        window._cronosPR.items   = [];
        try { localStorage.removeItem('cronos_pr::sin_id'); } catch (e) {}
        if (typeof window.cronosPRActualiza === 'function') {
            try { window.cronosPRActualiza(); } catch (e) {}
        }
    };

    // ── Las dos puertas ──────────────────────────────────────────────
    function _categoriaDelPartido() {
        // `_currentMatchCategory` es la categoría DEL PARTIDO (v561/v562), que
        // es la buena: la del perfil se queda con la del otro equipo en un
        // entrenador con dos equipos. El <select> es sólo el respaldo de
        // arranque, antes de que la global esté puesta.
        var g = window._currentMatchCategory || '';
        if (g) return g;
        var el = document.getElementById('match-category');
        return el ? (el.value || '') : '';
    }

    function _disponible() {
        if (typeof window._cronosExtraEnabled === 'function' &&
            !window._cronosExtraEnabled('registro_pr')) return false;
        if (typeof window.cronosCategoriaConRegistroPR !== 'function') return false;
        return window.cronosCategoriaConRegistroPR(_categoriaDelPartido());
    }
    window.cronosPRDisponible = _disponible;

    // ════════════════════════════════════════════════════════════════
    //  ⏱️ v695 · SÓLO CON EL PARTIDO EN JUEGO
    // ════════════════════════════════════════════════════════════════
    //  Reporte del autor (captura 10282): el marcador a 0-0, el botón todavía
    //  en EMPEZAR y los cronómetros intactos en 45:00 — y aun así la barra
    //  marcaba «R 2 · P 1». Se podía registrar antes del saque inicial, con el
    //  reloj pausado y durante el descanso, y esos apuntes contaban en el
    //  informe como si fueran del partido.
    //
    //  🔑 HACEN FALTA LAS DOS CONDICIONES, no basta con `isRunning`:
    //    · `isRunning` cubre "sin empezar" y "en pausa" —las dos dejan el
    //      reloj parado—, pero es una variable de RELOJ, no de partido;
    //    · `matchPhase` descarta el DESCANSO y el partido ya FINALIZADO.
    //  En el descanso el reloj queda parado (event-listeners.js pone
    //  `isRunning = false` al pasar a 'break'), así que hoy cualquiera de las
    //  dos bastaría; se exigen las dos para que un cambio en una no vuelva a
    //  abrir la puerta en silencio.
    //
    //  ⚠️ SÓLO SE BLOQUEA EL REGISTRO. Rectificar, limpiar, asignar y el panel
    //  de resumen siguen disponibles con el reloj parado: corregir y consultar
    //  en el descanso es justo cuando más falta hace.
    function _enJuego() {
        var corriendo = (typeof isRunning !== 'undefined') ? (isRunning === true) : false;
        var fase = (typeof matchPhase !== 'undefined') ? matchPhase : '';
        return corriendo && (fase === '1st_half' || fase === '2nd_half');
    }
    window.cronosPREnJuego = _enJuego;

    // ── Mi equipo ────────────────────────────────────────────────────
    // "Exclusiva para nuestro propio equipo": puede ser el LOCAL o el
    // VISITANTE — el entrenador elige su rol al crear el partido (v-role),
    // así que dar por hecho 'home' habría dejado la función inservible justo
    // en los partidos fuera de casa.
    //  🏠✈️ v707 · Y la decisión la toma `cronosMiLado()` (js/core/utils.js),
    //  que es la MISMA que usan los informes (`_cMyTeamKey`). Con dos
    //  expresiones equivalentes escritas aparte, el día que una cambie el
    //  registro y el informe hablarán de equipos distintos.
    function _miEquipo() {
        if (typeof window.cronosMiLado === 'function') return window.cronosMiLado();
        return (window._userTeamRole === 'away') ? 'away' : 'home';
    }

    function _misJugadoresEnCampo() {
        var lista = (typeof players !== 'undefined' && Array.isArray(players)) ? players : [];
        var mio = _miEquipo();
        return lista.filter(function (p) { return p && p.team === mio && p.status === 'field'; });
    }

    // ── Tiempo de partido, con el mismo formato que los sucesos ──────
    function _tiempoPartido() {
        try {
            var h1 = (typeof masterTimeH1 !== 'undefined') ? masterTimeH1 : 0;
            var h2 = (typeof masterTimeH2 !== 'undefined') ? masterTimeH2 : 0;
            var phase = (typeof matchPhase !== 'undefined') ? matchPhase : '1st_half';
            var segunda = (phase === '2nd_half' || phase === 'finished');
            var total = segunda ? (h1 + h2) : h1;
            var m = Math.floor(total / 60).toString().padStart(2, '0');
            var s = (total % 60).toString().padStart(2, '0');
            return (segunda ? '2T ' : '1T ') + m + ':' + s;
        } catch (e) { return ''; }
    }

    // ════════════════════════════════════════════════════════════════
    //  REGISTRO
    // ════════════════════════════════════════════════════════════════
    window.cronosPRRegistra = function (kind) {
        if (kind !== 'loss' && kind !== 'recovery') return null;
        if (!_disponible()) return null;
        // 🚨 LA PUERTA VA AQUÍ, no sólo en el aspecto del botón. Deshabilitar
        // el botón es PINTADO: esta función es pública y se llama desde la
        // consola, y un apunte colado antes del saque inicial acaba en el
        // informe. Misma lección que el filtro del rival y que v679.
        if (!_enJuego()) {
            if (typeof showToast === 'function') {
                showToast('⏸️ El partido no está en juego: no se registran pérdidas ni recuperaciones', 2600);
            }
            return null;
        }
        _restaura();
        var item = {
            id: 'pr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
            kind: kind,
            playerId: null, number: '', name: '',
            matchTime: _tiempoPartido(),
            createdAt: Date.now()
        };
        window._cronosPR.items.push(item);
        _guarda();
        _pintaBotones();
        _abreBarra(item);
        return item;
    };

    // Asignación opcional: completa el registro que YA está guardado. Si el
    // entrenador no llega a tiempo, se queda como colectivo — que es el
    // comportamiento pedido, no un fallo.
    window.cronosPRAsigna = function (itemId, playerId) {
        var it = _busca(itemId);
        if (!it) return false;
        var lista = (typeof players !== 'undefined' && Array.isArray(players)) ? players : [];
        var p = lista.filter(function (x) { return String(x.id) === String(playerId); })[0];
        if (!p) return false;
        // 🚨 EL FILTRO VA AQUÍ, NO SÓLO EN LA BARRA. La barra ya ofrece sólo a
        // los míos, pero eso es PINTADO: esta función es pública y un id del
        // rival colaba una P/R ajena en el informe de mi equipo. Lo cazó el
        // guard; es la forma exacta del fallo de v679 (la puerta visible
        // cerrada y la de la ruta abierta).
        if (p.team !== _miEquipo()) return false;
        it.playerId = String(p.id);
        it.number   = String(p.number == null ? '' : p.number);
        it.name     = String(p.alias || p.name || '');
        _guarda();
        _cierraBarraYa();
        _pintaBotones();
        if (typeof showToast === 'function') {
            showToast((it.kind === 'loss' ? '🔻 Pérdida' : '🔺 Recuperación') +
                      ' · ' + (it.name || ('#' + it.number)), 1800);
        }
        return true;
    };

    window.cronosPRDeshace = function (itemId) {
        var i = _indice(itemId);
        if (i < 0) return false;
        window._cronosPR.items.splice(i, 1);
        _guarda();
        _cierraBarraYa();
        _pintaBotones();
        if (typeof showToast === 'function') showToast('Registro deshecho', 1500);
        return true;
    };

    // ════════════════════════════════════════════════════════════════
    //  ↩ RECTIFICAR — ACUMULATIVO, DEL FINAL HACIA EL COMIENZO
    // ════════════════════════════════════════════════════════════════
    //  Encargo del autor: "si se pulsa tres veces, debe eliminar de forma
    //  consecutiva los tres últimos registros, uno a uno".
    //
    //  🔑 NO depende de la ventana de asignación. Antes sólo se podía
    //  rectificar el último apunte MIENTRAS su ventana seguía abierta (5 s):
    //  pasado ese momento, un error registrado ya no se podía quitar. Esta
    //  función vive en el panel de resumen, que se abre cuando haga falta.
    //
    //  ⚠️ Quita el último POR ORDEN DE REGISTRO, esté asignado a un jugador o
    //  sea colectivo: es "deshacer lo que acabo de hacer", no "quitarle una
    //  pérdida a alguien" (eso es el panel, restando al jugador).
    window.cronosPRRectifica = function () {
        _restaura();
        var arr = window._cronosPR.items;
        if (!arr.length) {
            if (typeof showToast === 'function') showToast('No queda nada que rectificar', 1500);
            return null;
        }
        var fuera = arr.pop();
        _guarda();
        _cierraBarraYa();
        _pintaBotones();
        _pintaResumen();
        if (typeof showToast === 'function') {
            showToast('↩ Rectificado: ' + (fuera.kind === 'loss' ? '🔻 Pérdida' : '🔺 Recuperación') +
                      (fuera.name ? (' · ' + fuera.name) : ' (colectiva)'), 1800);
        }
        return fuera;
    };

    // ════════════════════════════════════════════════════════════════
    //  🗑 LIMPIAR — TODO EL PARTIDO DE GOLPE
    // ════════════════════════════════════════════════════════════════
    //  Encargo del autor: "estrictamente para borrar TODO lo del partido de
    //  golpe (reiniciar a cero todas las operaciones acumuladas)".
    //
    //  ⚠️ PIDE CONFIRMACIÓN. Es irreversible —no hay papelera— y el botón vive
    //  al lado de los de registro, en una pantalla que se usa con el dedo y a
    //  toda prisa en la banda. Un roce no puede llevarse el partido entero.
    window.cronosPRLimpiaTodo = function (sinPreguntar) {
        _restaura();
        var n = window._cronosPR.items.length;
        if (!n) {
            if (typeof showToast === 'function') showToast('No hay registros que borrar', 1500);
            return 0;
        }
        if (!sinPreguntar && typeof confirm === 'function' &&
            !confirm('¿Borrar TODO el registro de pérdidas y recuperaciones de este partido?\n\n' +
                     n + ' apunte(s). No se puede deshacer.')) {
            return 0;
        }
        window._cronosPR.items = [];
        _guarda();
        _cierraBarraYa();
        _pintaBotones();
        _pintaResumen();
        if (typeof showToast === 'function') showToast('🗑 Registro borrado (' + n + ')', 1800);
        return n;
    };

    function _busca(id) {
        var i = _indice(id);
        return i < 0 ? null : window._cronosPR.items[i];
    }
    function _indice(id) {
        var arr = window._cronosPR.items;
        for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
        return -1;
    }

    // ════════════════════════════════════════════════════════════════
    //  AGREGADO PARA LOS INFORMES
    // ════════════════════════════════════════════════════════════════
    //  🔑 La clave del desglose es el DORSAL, no el id interno del jugador:
    //  los informes casan por `playerNumber` (report-engine.js construye su
    //  índice con 'n:'+número), y el id de la sesión no existe en ellos.
    window.cronosPRDelPartido = function (items) {
        var lista = Array.isArray(items) ? items
                  : ((window._cronosPR && Array.isArray(window._cronosPR.items)) ? window._cronosPR.items : []);
        // 🔴 v761 · Sin lista explícita, esto es «lo del partido EN CURSO»: lo
        // piden TODOS los despachos (colectivo, individuales, familias) para
        // guardarlo en el informe. En una categoría base el informe no lleva
        // P/R, y aunque aquí quedara algo en memoria de un partido anterior de
        // otro equipo, no puede viajar al informe de éste.
        if (!Array.isArray(items) && typeof window.cronosPRPermitidoEnCategoria === 'function' &&
            !window.cronosPRPermitidoEnCategoria(_categoriaDelPartido())) {
            lista = [];
        }
        var res = {
            perdidas:       { total: 0, sinAsignar: 0, porDorsal: {} },
            recuperaciones: { total: 0, sinAsignar: 0, porDorsal: {} },
            items: []
        };
        lista.forEach(function (it) {
            if (!it || (it.kind !== 'loss' && it.kind !== 'recovery')) return;
            var b = (it.kind === 'loss') ? res.perdidas : res.recuperaciones;
            b.total++;
            var dorsal = String(it.number == null ? '' : it.number).trim();
            if (!it.playerId || !dorsal) { b.sinAsignar++; }
            else { b.porDorsal[dorsal] = (b.porDorsal[dorsal] || 0) + 1; }
            res.items.push({
                kind: it.kind, number: dorsal, name: String(it.name || ''),
                matchTime: String(it.matchTime || ''), createdAt: Number(it.createdAt) || 0
            });
        });
        res.items.sort(function (a, b) { return a.createdAt - b.createdAt; });
        return res;
    };

    // Lo que le toca a UN jugador, por dorsal. Lo usa el informe individual.
    window.cronosPRDeJugador = function (resumen, dorsal) {
        var d = String(dorsal == null ? '' : dorsal).trim();
        if (!resumen || !d) return { perdidas: 0, recuperaciones: 0 };
        return {
            perdidas:       ((resumen.perdidas       || {}).porDorsal || {})[d] || 0,
            recuperaciones: ((resumen.recuperaciones || {}).porDorsal || {})[d] || 0
        };
    };

    // ════════════════════════════════════════════════════════════════
    //  INTERFAZ — botones flotantes sobre el campo
    // ════════════════════════════════════════════════════════════════
    function _estilos() {
        if (document.getElementById('cronos-pr-css')) return;
        var st = document.createElement('style');
        st.id = 'cronos-pr-css';
        st.textContent = [
            // ── PC: los tres botones juntos, abajo al centro (sin cambios) ──
            '#cronos-pr-bar{position:fixed;left:50%;transform:translateX(-50%);',
            'bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:1002;',
            'display:none;gap:8px;align-items:center;',
            // ══════════════════════════════════════════════════════════════
            //  🚨 v696 · LA BARRA NO PUEDE COMERSE LOS TOQUES DEL CÉSPED
            //
            //  Reporte del autor (IMG_4714/IMG_4715, óvalo amarillo): las
            //  fichas de la franja inferior del campo se quedaban muertas —no
            //  se podían mover ni seleccionar.
            //
            //  🔑 LA CAUSA ES LA COLOCACIÓN EN LAS ESQUINAS DE v694: para
            //  repartir los botones a los extremos, la barra pasó a ocupar
            //  TODO EL ANCHO (`left:0;right:0` + `space-between`). Un <div>
            //  sin fondo SIGUE CAPTURANDO los eventos en toda su caja, así
            //  que quedó una franja invisible de lado a lado por encima del
            //  campo. Se veía transparente y se comportaba como una pared.
            //
            //  El arreglo es que la CAJA deje pasar y sólo los CONTROLES
            //  reciban: nada de mover la barra ni de recortar el campo.
            //  ⚠️ Va también en la regla base, no sólo en el @media de móvil:
            //  en PC la barra es pequeña, pero su caja tapa igual la porción
            //  de césped que hay bajo ella.
            'pointer-events:none;}',
            '#cronos-pr-bar.on{display:flex;}',
            // Los botones SÍ son interactivos: el `none` del padre se hereda
            // en cascada y hay que reponerlo explícitamente en cada control.
            '.cronos-pr-btn{pointer-events:auto;',
            'min-width:62px;min-height:44px;border-radius:12px;font-weight:900;',
            'font-size:0.82rem;letter-spacing:0.5px;cursor:pointer;color:#fff;',
            'display:flex;align-items:center;justify-content:center;gap:5px;',
            'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);',
            'box-shadow:0 4px 14px rgba(0,0,0,0.45);touch-action:manipulation;}',
            '.cronos-pr-btn.loss{background:rgba(218,54,51,0.82);border:1px solid rgba(255,255,255,0.35);}',
            '.cronos-pr-btn.rec{background:rgba(46,160,67,0.82);border:1px solid rgba(255,255,255,0.35);}',
            '.cronos-pr-btn.sum{background:rgba(88,166,255,0.72);border:1px solid rgba(255,255,255,0.30);',
            'min-width:46px;font-size:0.9rem;}',
            '.cronos-pr-btn:active{transform:scale(0.94);}',
            // v695 · Apagado mientras el partido no está en juego.
            '.cronos-pr-btn.off{opacity:0.38;filter:grayscale(0.6);cursor:not-allowed;}',
            '.cronos-pr-btn.off:active{transform:none;}',
            '.cronos-pr-num{font-size:0.7rem;opacity:0.9;font-weight:700;}',
            '#cronos-pr-assign{position:fixed;left:50%;transform:translateX(-50%);',
            'bottom:calc(62px + env(safe-area-inset-bottom,0px));z-index:1003;display:none;',
            'background:rgba(13,17,23,0.96);border:1px solid rgba(255,255,255,0.18);',
            'border-radius:12px;padding:7px 9px;max-width:94vw;',
            'box-shadow:0 8px 26px rgba(0,0,0,0.6);}',
            '#cronos-pr-assign.on{display:block;}',
            '.cronos-pr-title{font-size:0.62rem;color:#8b949e;font-weight:700;',
            'text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;}',
            // 🏷️ v775 · Mismo diseño que la lista de advanced-stats.js
            // (`.sav-chip`): píldora con el dorsal en un círculo y el nombre.
            // Varias filas en vez de una tira con desplazamiento lateral: con
            // nombres, once botones no caben en una sola línea del móvil.
            '.cronos-pr-chips{display:flex;gap:5px;flex-wrap:wrap;max-width:92vw;max-height:46vh;',
            'overflow-y:auto;padding-bottom:2px;}',
            '.cronos-pr-chip{min-height:38px;border-radius:19px;border:1px solid rgba(255,255,255,0.45);',
            'background:rgba(255,255,255,0.08);color:#fff;font-size:0.74rem;cursor:pointer;',
            'display:flex;align-items:center;gap:5px;padding:0 10px 0 4px;flex-shrink:0;',
            'touch-action:manipulation;}',
            '.cronos-pr-chip b{display:inline-flex;align-items:center;justify-content:center;min-width:28px;',
            'height:28px;border-radius:50%;background:rgba(255,255,255,0.16);font-weight:900;}',
            '.cronos-pr-chip:active{transform:scale(0.95);}',
            '.cronos-pr-undo{background:none;border:1px solid rgba(210,168,255,0.5);',
            'color:#d2a8ff;border-radius:19px;font-size:0.74rem;padding:0 10px;cursor:pointer;',
            'min-height:38px;flex-shrink:0;}',

            // ══════════════════════════════════════════════════════════════
            //  v770 · FUERA DEL CÉSPED (iPad y móvil)
            //
            //  Encargo del autor (implementar.txt, IMG_0617/IMG_0564/IMG_4888):
            //  en las esquinas de v694 la R pisaba el banquillo y el cuerpo
            //  técnico, la P el córner y el 📊 el propio campo.
            //    · iPad  → los tres JUNTOS en la franja negra de debajo del
            //              campo, centrados bajo él.
            //    · móvil → en COLUMNA (R, 📊, P) en el margen DERECHO, fuera
            //              del campo y justo encima del botón «VISIT.».
            //
            //  🔑 El sitio depende de dónde acabe el CAMPO, que es fluido
            //  (aspect-ratio + max-height), y eso el CSS no lo sabe: la
            //  posición la calcula `_colocaBarra()` midiendo `.pitch` y el
            //  botón VISIT. Aquí sólo va la FORMA (fila o columna).
            //
            //  Cortes: 1366px = iPad Pro 12,9" apaisado (el de v691/v692);
            //  950px = el del sistema de cajones del móvil (style.css).
            // ══════════════════════════════════════════════════════════════
            '@media (max-width: 1366px){',
            '  #cronos-pr-bar.on{transform:none;bottom:auto;right:auto;}',
            '  #cronos-pr-assign{max-width:calc(100vw - 20px);transform:none;}',
            '  #cronos-pr-assign.desde-izq{left:10px;right:auto;transform:none;}',
            '  #cronos-pr-assign.desde-der{right:10px;left:auto;transform:none;}',
            '  .cronos-pr-chips{max-width:100%;}',
            '}',
            '@media (max-width: 950px){',
            '  #cronos-pr-bar.on{flex-direction:column;gap:6px;}',
            '  #cronos-pr-bar .cronos-pr-btn{width:54px;min-width:0;',
            '   padding:0 3px;gap:3px;font-size:0.74rem;box-sizing:border-box;}',
            '}',

            // ── Panel de resumen por jugador (modal) ──
            '#cronos-pr-panel{position:fixed;inset:0;z-index:2400;display:none;',
            'align-items:center;justify-content:center;background:rgba(0,0,0,0.66);padding:14px;}',
            '#cronos-pr-panel.on{display:flex;}',
            '.cronos-pr-card{background:var(--bg-card,#0d1117);border:1px solid rgba(255,255,255,0.16);',
            'border-radius:14px;width:100%;max-width:440px;max-height:86vh;overflow-y:auto;',
            'padding:14px;box-shadow:0 18px 50px rgba(0,0,0,0.7);}',
            '.cronos-pr-row{display:flex;align-items:center;gap:8px;padding:6px 0;',
            'border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.8rem;color:#c9d1d9;}',
            '.cronos-pr-row .d{min-width:26px;font-weight:900;color:#8b949e;}',
            '.cronos-pr-row .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.cronos-pr-row .p{color:#f85149;font-weight:800;min-width:38px;text-align:right;}',
            '.cronos-pr-row .r{color:#3fb950;font-weight:800;min-width:38px;text-align:right;}',
            '.cronos-pr-acc{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}',
            '.cronos-pr-acc button{flex:1;min-height:44px;border-radius:10px;font-weight:800;',
            'font-size:0.75rem;cursor:pointer;touch-action:manipulation;}',
            '.cronos-pr-acc .rect{background:rgba(210,168,255,0.16);border:1px solid rgba(210,168,255,0.45);color:#d2a8ff;}',
            '.cronos-pr-acc .clr{background:rgba(248,81,73,0.14);border:1px solid rgba(248,81,73,0.45);color:#f85149;}',
            '.cronos-pr-acc .cls{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);color:#c9d1d9;}'
        ].join('');
        document.head.appendChild(st);
    }

    function _monta() {
        _estilos();
        if (document.getElementById('cronos-pr-bar')) return;

        var barra = document.createElement('div');
        barra.id = 'cronos-pr-bar';
        // ⚠️ EL ORDEN DEL DOM ES EL DE LA PANTALLA: en fila (PC e iPad) queda
        // R a la izquierda, 📊 en medio y P a la derecha; en la columna del
        // móvil (v770), R arriba, 📊 en medio y P abajo, como pidió el autor.
        barra.innerHTML =
            '<button type="button" class="cronos-pr-btn rec" id="cronos-pr-rec" ' +
            'title="Recuperación de balón">🔺 R <span class="cronos-pr-num" id="cronos-pr-nrec">0</span></button>' +
            '<button type="button" class="cronos-pr-btn sum" id="cronos-pr-sum" ' +
            'title="Resumen por jugador">📊</button>' +
            '<button type="button" class="cronos-pr-btn loss" id="cronos-pr-loss" ' +
            'title="Pérdida de balón">🔻 P <span class="cronos-pr-num" id="cronos-pr-nloss">0</span></button>';

        var asig = document.createElement('div');
        asig.id = 'cronos-pr-assign';

        var panel = document.createElement('div');
        panel.id = 'cronos-pr-panel';

        document.body.appendChild(asig);
        document.body.appendChild(panel);
        document.body.appendChild(barra);

        // 🔑 `click` y no `touchstart`: en táctil un touchstart con el dedo
        // resbalando registraría pérdidas fantasma, y aquí cada pulsación es
        // un dato. `touch-action:manipulation` ya quita el retardo de 300 ms.
        document.getElementById('cronos-pr-loss').addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            window.cronosPRRegistra('loss');
        });
        document.getElementById('cronos-pr-rec').addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            window.cronosPRRegistra('recovery');
        });
        document.getElementById('cronos-pr-sum').addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            window.cronosPRAbrePanel();
        });

        // El campo cambia de tamaño al girar el dispositivo o redimensionar.
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('resize', _colocaBarra);
            window.addEventListener('orientationchange', function () { setTimeout(_colocaBarra, 250); });
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  v770 · DÓNDE VA LA BARRA (iPad y móvil)
    // ════════════════════════════════════════════════════════════════
    //  Cálculo PURO, sin tocar el DOM, para que el guard lo ejecute con
    //  medidas reales de las capturas. Recibe (en px de pantalla):
    //    ancho, alto   → la ventana
    //    seguro        → safe-area inferior (la barra de inicio del iPad)
    //    campo         → rect de `.pitch` o null
    //    visit         → rect del botón «VISIT.» o null si no se ve
    //    barra         → { w, h } de la propia barra
    //  Devuelve null en PC (>1366px): allí se queda como estaba.
    window.cronosPRSitioBarra = function (m) {
        if (!m || !(m.ancho > 0) || !(m.alto > 0) || m.ancho > 1366) return null;
        var w = m.barra ? m.barra.w : 0, h = m.barra ? m.barra.h : 0;
        var seguro = m.seguro || 0;
        var left, top;

        if (m.ancho <= 950) {
            // 📱 COLUMNA en el margen DERECHO, justo encima de «VISIT.».
            var v = m.visit;
            var suelo = v ? v.top - 8 : m.alto - seguro - 20;
            top = Math.max(4, suelo - h);
            var derecha = v ? v.right : m.ancho - 10;
            left = derecha - w;
            // Fuera del césped: si el margen lo permite, a la derecha del campo.
            if (m.campo) left = Math.max(left, m.campo.right + 4);
            left = Math.min(Math.max(4, left), m.ancho - w - 4);
            return { modo: 'movil', left: Math.round(left), top: Math.round(top),
                     w: w, h: h,
                     // El desplegable crece HACIA LA IZQUIERDA desde la columna.
                     asignar: { right: Math.round(m.ancho - left + 8), left: null,
                                bottom: Math.round(m.alto - (top + h)),
                                maxW: Math.max(120, Math.round(left - 18)) } };
        }

        // 📟 iPAD: los tres juntos, centrados en la franja bajo el campo.
        var c = m.campo;
        var cx  = c ? (c.left + c.right) / 2 : m.ancho / 2;
        var pie = c ? c.bottom : m.alto - seguro - h - 14;
        var hueco = (m.alto - seguro) - pie;
        top = pie + Math.max(4, (hueco - h) / 2);
        var limite = m.alto - seguro - h - 4;
        if (limite < pie + 2) limite = m.alto - h - 2;   // antes la zona segura que el césped
        top = Math.round(Math.min(top, limite));
        left = Math.min(Math.max(4, cx - w / 2), m.ancho - w - 4);
        return { modo: 'tablet', left: Math.round(left), top: Math.round(top),
                 w: w, h: h,
                 // El desplegable, centrado justo encima de la barra.
                 asignar: { left: Math.round(cx), right: null, centrado: true,
                            bottom: Math.round(m.alto - top + 8),
                            maxW: Math.round(Math.min(440, m.ancho - 20)) } };
    };

    function _rectVisible(el) {
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        var r = el.getBoundingClientRect();
        return (r && r.width > 0 && r.height > 0) ? r : null;
    }

    var _sondaSeguro = null;
    function _seguroInferior() {
        try {
            if (!_sondaSeguro) {
                _sondaSeguro = document.createElement('div');
                _sondaSeguro.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;' +
                    'visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px);';
                document.body.appendChild(_sondaSeguro);
            }
            return parseFloat(getComputedStyle(_sondaSeguro).paddingBottom) || 0;
        } catch (e) { return 0; }
    }

    function _colocaBarra() {
        var barra = document.getElementById('cronos-pr-bar');
        var asig  = document.getElementById('cronos-pr-assign');
        if (!barra || !barra.style) return;
        var ancho = window.innerWidth, alto = window.innerHeight;
        var rb = (barra.classList.contains('on')) ? _rectVisible(barra) : null;
        var sitio = (rb && typeof document.querySelector === 'function')
            ? window.cronosPRSitioBarra({
                ancho: ancho, alto: alto, seguro: _seguroInferior(),
                campo: _rectVisible(document.querySelector('.pitch')),
                visit: _rectVisible(document.getElementById('toggle-bench-away')),
                barra: { w: rb.width, h: rb.height }
              })
            : null;

        if (!sitio) {                       // PC: vuelve el CSS de siempre
            barra.style.left = barra.style.top = '';
            if (asig && asig.style) {
                asig.style.left = asig.style.right = asig.style.bottom =
                    asig.style.maxWidth = asig.style.transform = '';
            }
            return;
        }
        barra.style.left = sitio.left + 'px';
        barra.style.top  = sitio.top + 'px';
        if (asig && asig.style) {
            var a = sitio.asignar;
            asig.style.left   = (a.left  == null) ? 'auto' : a.left + 'px';
            asig.style.right  = (a.right == null) ? 'auto' : a.right + 'px';
            asig.style.bottom = a.bottom + 'px';
            asig.style.maxWidth = a.maxW + 'px';
            asig.style.transform = a.centrado ? 'translateX(-50%)' : 'none';
        }
    }

    function _pintaBotones() {
        var nl = document.getElementById('cronos-pr-nloss');
        var nr = document.getElementById('cronos-pr-nrec');
        if (!nl || !nr) return;
        var r = window.cronosPRDelPartido();
        nl.textContent = r.perdidas.total;
        nr.textContent = r.recuperaciones.total;

        // v695 · Aspecto apagado mientras el partido no está en juego, para que
        // se vea que no aceptan pulsación (el bloqueo real está en la función).
        // El 📊 NO se apaga: el resumen se consulta en cualquier momento, y el
        // descanso es precisamente cuando se mira.
        var enJuego = _enJuego();
        ['cronos-pr-loss', 'cronos-pr-rec'].forEach(function (id) {
            var b = document.getElementById(id);
            if (!b) return;
            if (enJuego) {
                b.classList.remove('off');
                b.removeAttribute('aria-disabled');
                b.title = (id === 'cronos-pr-loss') ? 'Pérdida de balón' : 'Recuperación de balón';
            } else {
                b.classList.add('off');
                b.setAttribute('aria-disabled', 'true');
                b.title = 'Sólo con el partido en juego';
            }
        });
    }

    // ⚠️ EL ESTADO DEL RELOJ CAMBIA SIN PASAR POR `renderPlayers()`: pausar,
    // reanudar, el descanso y el final automático por tiempo no repintan las
    // fichas, así que enganchar sólo ahí dejaría los botones encendidos con el
    // partido parado. Un repaso de un segundo los mantiene fieles venga el
    // cambio de donde venga —incluido el reloj adoptado del servidor—, y sólo
    // toca el DOM cuando el estado cambia de verdad.
    var _ultimoEnJuego = null;
    function _vigilaEstado() {
        if (_vigilaEstado._t) return;
        _vigilaEstado._t = setInterval(function () {
            var barra = document.getElementById('cronos-pr-bar');
            if (!barra || !barra.classList.contains('on')) return;
            // v770 · El campo se reacomoda sin avisar (cabecera que crece,
            // cajones, teclado): medir dos rects por segundo es barato.
            _colocaBarra();
            var e = _enJuego();
            if (e === _ultimoEnJuego) return;
            _ultimoEnJuego = e;
            _pintaBotones();
        }, 1000);
    }

    function _abreBarra(item) {
        var cont = document.getElementById('cronos-pr-assign');
        if (!cont) return;
        var jug = _misJugadoresEnCampo().slice().sort(function (a, b) {
            return (parseInt(a.number, 10) || 99) - (parseInt(b.number, 10) || 99);
        });
        if (!jug.length) return;   // nadie a quien asignar: se queda colectivo

        // 🏷️ v775 · DORSAL + NOMBRE, el mismo botón que Córners/Faltas
        // (encargo del autor, implementar.txt punto 1): con sólo el dorsal
        // había que acordarse de quién llevaba cada número. El nombre va
        // recortado a la primera palabra, como en advanced-stats.js.
        var esc = (typeof escapeHtml === 'function') ? escapeHtml : function (s) { return String(s); };
        var chips = jug.map(function (p) {
            var nom = String(p.alias || p.name || '').split(' ')[0].slice(0, 10);
            return '<button type="button" class="cronos-pr-chip" data-pid="' + esc(String(p.id)) + '" ' +
                   'title="' + esc(String(p.name || '')) + '">' +
                   '<b>' + esc(String(p.number)) + '</b>' + esc(nom) +
                   '</button>';
        }).join('');

        cont.innerHTML =
            '<div class="cronos-pr-title">' +
            (item.kind === 'loss' ? '🔻 Pérdida' : '🔺 Recuperación') +
            ' ' + (item.matchTime || '') + ' · ¿de quién? (opcional)</div>' +
            '<div class="cronos-pr-chips">' + chips +
            '<button type="button" class="cronos-pr-undo" data-undo="1">↩ Rectificar</button></div>';

        // 🔑 HACIA DENTRO DEL CAMPO. El desplegable se ancla al MISMO lado que
        // el botón que lo abrió (R a la izquierda, P a la derecha) y crece
        // hacia el centro; centrado se salía de la pantalla o quedaba cortado.
        // El lado se deriva del tipo, que es lo que fija la posición del botón
        // en el CSS: así no hay dos fuentes de verdad que puedan discrepar.
        cont.classList.remove('desde-izq', 'desde-der');
        cont.classList.add(item.kind === 'loss' ? 'desde-der' : 'desde-izq');

        cont.classList.add('on');
        _colocaBarra();

        cont.querySelectorAll('.cronos-pr-chip').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                window.cronosPRAsigna(item.id, b.getAttribute('data-pid'));
            });
        });
        // ↩ Rectificar: NO borra "este" apunte, borra EL ÚLTIMO. Son lo mismo
        // mientras la ventana está abierta, pero así el botón hace siempre lo
        // mismo esté donde esté (ventana o panel) y pulsarlo tres veces quita
        // los tres últimos, que es lo que pidió el autor.
        var undo = cont.querySelector('[data-undo]');
        if (undo) undo.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            window.cronosPRRectifica();
        });

        if (_cierraBarra) clearTimeout(_cierraBarra);
        _cierraBarra = setTimeout(_cierraBarraYa, VENTANA_MS);
    }

    function _cierraBarraYa() {
        if (_cierraBarra) { clearTimeout(_cierraBarra); _cierraBarra = null; }
        var cont = document.getElementById('cronos-pr-assign');
        if (cont) { cont.classList.remove('on'); cont.innerHTML = ''; }
    }

    // ════════════════════════════════════════════════════════════════
    //  📊 PANEL DE RESUMEN POR JUGADOR, EN VIVO
    // ════════════════════════════════════════════════════════════════
    //  Encargo del autor: poder consultar en CUALQUIER momento del partido
    //  —en el descanso o cuando haga falta— cuántas pérdidas y recuperaciones
    //  lleva cada jugador.
    //
    //  🔑 Se listan TODOS los convocados de mi equipo, no sólo los que tienen
    //  registros: en el banquillo hace falta ver también quién está a cero, y
    //  un listado que sólo enseña a los "manchados" obliga a acordarse de
    //  quién falta. Misma política que el informe con los convocados (v458).
    window.cronosPRAbrePanel = function () {
        _restaura();
        var panel = document.getElementById('cronos-pr-panel');
        if (!panel) return false;
        panel.classList.add('on');
        _pintaResumen();
        return true;
    };

    window.cronosPRCierraPanel = function () {
        var panel = document.getElementById('cronos-pr-panel');
        if (panel) { panel.classList.remove('on'); }
        return true;
    };

    function _misJugadores() {
        var lista = (typeof players !== 'undefined' && Array.isArray(players)) ? players : [];
        var mio = _miEquipo();
        return lista.filter(function (p) { return p && p.team === mio; });
    }

    function _pintaResumen() {
        var panel = document.getElementById('cronos-pr-panel');
        if (!panel || !panel.classList.contains('on')) return;

        var r = window.cronosPRDelPartido();
        var esc = (typeof escapeHtml === 'function') ? escapeHtml : function (s) { return String(s); };

        var filas = _misJugadores()
            .slice()
            .sort(function (a, b) { return (parseInt(a.number, 10) || 99) - (parseInt(b.number, 10) || 99); })
            .map(function (p) {
                var d = window.cronosPRDeJugador(r, p.number);
                var apagado = (!d.perdidas && !d.recuperaciones) ? 'opacity:0.45;' : '';
                return '<div class="cronos-pr-row" style="' + apagado + '">' +
                       '<span class="d">' + esc(String(p.number)) + '</span>' +
                       '<span class="n">' + esc(String(p.alias || p.name || '')) +
                       (p.status === 'bench' ? ' <span style="font-size:0.62rem;color:#8b949e;">(banq.)</span>' : '') +
                       '</span>' +
                       '<span class="p">🔻 ' + d.perdidas + '</span>' +
                       '<span class="r">🔺 ' + d.recuperaciones + '</span>' +
                       '</div>';
            }).join('');

        var sinAsig = (r.perdidas.sinAsignar || 0) + (r.recuperaciones.sinAsignar || 0);
        var balance = (r.recuperaciones.total || 0) - (r.perdidas.total || 0);

        panel.innerHTML =
            '<div class="cronos-pr-card">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
            '<strong style="font-size:0.88rem;color:#c9d1d9;">📊 Pérdidas y recuperaciones</strong>' +
            '<span style="font-size:0.68rem;color:#8b949e;">en lo que va de partido</span></div>' +

            '<div style="display:flex;gap:14px;margin-bottom:10px;">' +
            '<div><div style="font-size:1.25rem;font-weight:800;color:#f85149;">' + (r.perdidas.total || 0) + '</div>' +
            '<div style="font-size:0.6rem;color:#8b949e;text-transform:uppercase;">Pérdidas</div></div>' +
            '<div><div style="font-size:1.25rem;font-weight:800;color:#3fb950;">' + (r.recuperaciones.total || 0) + '</div>' +
            '<div style="font-size:0.6rem;color:#8b949e;text-transform:uppercase;">Recuperaciones</div></div>' +
            '<div><div style="font-size:1.25rem;font-weight:800;color:' +
            (balance > 0 ? '#3fb950' : (balance < 0 ? '#f85149' : '#8b949e')) + ';">' +
            (balance > 0 ? '+' : '') + balance + '</div>' +
            '<div style="font-size:0.6rem;color:#8b949e;text-transform:uppercase;">Balance</div></div>' +
            '</div>' +

            (filas || '<div style="font-size:0.76rem;color:#8b949e;">No hay jugadores en la plantilla.</div>') +

            (sinAsig
                ? '<div style="font-size:0.68rem;color:#8b949e;margin-top:8px;">Sin asignar (colectivas): ' +
                  '<strong>🔻 ' + (r.perdidas.sinAsignar || 0) + '</strong> · ' +
                  '<strong>🔺 ' + (r.recuperaciones.sinAsignar || 0) + '</strong></div>'
                : '') +

            '<div class="cronos-pr-acc">' +
            '<button type="button" class="rect" data-acc="rect">↩ Rectificar último</button>' +
            '<button type="button" class="clr"  data-acc="clr">🗑 Limpiar todo</button>' +
            '<button type="button" class="cls"  data-acc="cls">Cerrar</button>' +
            '</div></div>';

        var btns = panel.querySelectorAll('[data-acc]');
        for (var i = 0; i < btns.length; i++) {
            (function (b) {
                b.addEventListener('click', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    var a = b.getAttribute('data-acc');
                    if (a === 'rect') window.cronosPRRectifica();
                    else if (a === 'clr') window.cronosPRLimpiaTodo();
                    else window.cronosPRCierraPanel();
                });
            })(btns[i]);
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  SINCRONÍA CON LA PANTALLA
    // ════════════════════════════════════════════════════════════════
    //  Se llama desde `renderPlayers()`, que es el único punto por el que
    //  pasan TODOS los caminos de arranque y repintado del partido (lección
    //  de v692: enganchar por camino deja la función viva sólo en algunos).
    // ════════════════════════════════════════════════════════════════
    //  🔴 v776 · LA DECISIÓN SE REPASA, NO SÓLO SE TOMA AL REPINTAR
    // ════════════════════════════════════════════════════════════════
    //  Reporte del autor (capturas 10948/10949): extras en verde en el panel
    //  del SuperAdmin y el directo sin botones. `cronosPRActualiza()` sólo se
    //  llamaba desde `renderPlayers()`: si en ese momento los extras aún no
    //  habían llegado, o la pantalla seguía en `setup-mode`, la barra quedaba
    //  apagada hasta el siguiente cambio de jugador. Este vigía compara cada
    //  2 s lo que DEBERÍA verse con lo que se ve, y sólo actúa si difieren.
    function _vigiaDecision() {
        if (_vigiaDecision._t) return;
        _vigiaDecision._t = setInterval(function () {
            var barra = document.getElementById('cronos-pr-bar');
            if (!barra || !document.body) return;
            var quiere = _disponible() && !document.body.classList.contains('setup-mode');
            if (quiere !== barra.classList.contains('on')) {
                try { window.cronosPRActualiza(); } catch (e) {}
            }
        }, 2000);
    }

    window.cronosPRActualiza = function () {
        _monta();
        _vigiaDecision();
        var barra = document.getElementById('cronos-pr-bar');
        if (!barra) return;
        var enPartido = !document.body.classList.contains('setup-mode');
        if (_disponible() && enPartido) {
            _restaura();
            barra.classList.add('on');
            _pintaBotones();
            _colocaBarra();
            _vigilaEstado();
            // ☁️ v775 · Escucha del documento del partido: hidrata al abrir
            // en otro aparato y mantiene los contadores al día.
            if (typeof window.cronosStatsNubeEscucha === 'function') {
                try { window.cronosStatsNubeEscucha(); } catch (e) {}
            }
        } else {
            barra.classList.remove('on');
            _cierraBarraYa();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { _monta(); });
    } else {
        _monta();
    }
})();

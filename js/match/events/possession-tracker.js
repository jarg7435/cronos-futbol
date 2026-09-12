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

    function _guarda() {
        try {
            localStorage.setItem(_clave(), JSON.stringify({
                matchId: window._cronosPR.matchId,
                items:   window._cronosPR.items
            }));
        } catch (e) { /* cuota o modo privado: el registro sigue vivo en memoria */ }
    }

    function _restaura() {
        var id = _idPartido();
        if (!id || window._cronosPR.matchId === id) return;
        window._cronosPR.matchId = id;
        window._cronosPR.items = [];
        try {
            var crudo = localStorage.getItem(_clave());
            if (crudo) {
                var d = JSON.parse(crudo);
                if (d && Array.isArray(d.items)) window._cronosPR.items = d.items;
            }
        } catch (e) { /* json corrupto: se empieza de cero, no se rompe el partido */ }
    }

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
    function _miEquipo() {
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
            'display:none;gap:8px;align-items:center;}',
            '#cronos-pr-bar.on{display:flex;}',
            '.cronos-pr-btn{min-width:62px;min-height:44px;border-radius:12px;font-weight:900;',
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
            '.cronos-pr-chips{display:flex;gap:5px;overflow-x:auto;max-width:92vw;padding-bottom:2px;}',
            '.cronos-pr-chip{min-width:40px;min-height:40px;border-radius:50%;border:2px solid rgba(255,255,255,0.5);',
            'background:rgba(255,255,255,0.10);color:#fff;font-weight:900;font-size:0.85rem;',
            'display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;',
            'touch-action:manipulation;}',
            '.cronos-pr-chip:active{transform:scale(0.92);}',
            '.cronos-pr-undo{margin-left:6px;background:none;border:1px solid rgba(255,255,255,0.25);',
            'color:#8b949e;border-radius:8px;font-size:0.66rem;padding:6px 9px;cursor:pointer;',
            'min-height:40px;flex-shrink:0;}',

            // ══════════════════════════════════════════════════════════════
            //  v694 · MÓVIL E iPAD: A LAS ESQUINAS, SOBRE LOS BANQUILLOS
            //
            //  Encargo del autor (capturas IMG_4713 con la R y la P dibujadas
            //  a mano en las esquinas): abajo al centro, los botones caían
            //  sobre la línea de fondo del campo y estorbaban justo donde se
            //  colocan las fichas. Se van a las esquinas, encima de los
            //  cajones LOCAL/VISITANTE (`.mobile-toggle`, que vive en
            //  bottom:20px), y en PC se quedan como estaban.
            //
            //  🔑 No hacen falta dos posicionamientos distintos: la misma
            //  barra pasa a ocupar todo el ancho con `space-between`, y son
            //  sus dos extremos los que aterrizan en las esquinas. El botón
            //  de resumen queda en medio.
            //
            //  1366px = iPad Pro 12,9" apaisado, el mismo corte que usan el
            //  recorte de fichas de v691 y el del visor de v692.
            // ══════════════════════════════════════════════════════════════
            '@media (max-width: 1366px){',
            '  #cronos-pr-bar.on{left:0;right:0;transform:none;justify-content:space-between;',
            '   padding:0 10px;box-sizing:border-box;',
            '   bottom:calc(72px + env(safe-area-inset-bottom,0px));}',
            // El desplegable se ancla al lado del botón que lo abre y crece
            // HACIA DENTRO del campo: pegado a un borde se salía de la
            // pantalla o quedaba cortado, que es lo que reportó el autor.
            '  #cronos-pr-assign{max-width:calc(100vw - 20px);',
            '   bottom:calc(124px + env(safe-area-inset-bottom,0px));}',
            '  #cronos-pr-assign.desde-izq{left:10px;right:auto;transform:none;}',
            '  #cronos-pr-assign.desde-der{right:10px;left:auto;transform:none;}',
            '  .cronos-pr-chips{max-width:calc(100vw - 40px);}',
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
        // ⚠️ EL ORDEN DEL DOM ES EL DE LAS ESQUINAS. En móvil/iPad la barra se
        // reparte con `space-between`, así que el PRIMERO cae a la izquierda y
        // el ÚLTIMO a la derecha: R a la izquierda y P a la derecha, como las
        // anotaciones a mano de las capturas IMG_4713. El resumen queda en
        // medio. En PC son simplemente los tres seguidos.
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
            var e = _enJuego();
            if (e === _ultimoEnJuego) return;
            _ultimoEnJuego = e;
            _pintaBotones();
        }, 1000);
    }

    function _abreBarra(item) {
        var cont = document.getElementById('cronos-pr-assign');
        if (!cont) return;
        var jug = _misJugadoresEnCampo();
        if (!jug.length) return;   // nadie a quien asignar: se queda colectivo

        var chips = jug.map(function (p) {
            return '<button type="button" class="cronos-pr-chip" data-pid="' + String(p.id) + '" ' +
                   'title="' + (typeof escapeHtml === 'function' ? escapeHtml(String(p.name || '')) : '') + '">' +
                   (typeof escapeHtml === 'function' ? escapeHtml(String(p.number)) : String(p.number)) +
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
    window.cronosPRActualiza = function () {
        _monta();
        var barra = document.getElementById('cronos-pr-bar');
        if (!barra) return;
        var enPartido = !document.body.classList.contains('setup-mode');
        if (_disponible() && enPartido) {
            _restaura();
            barra.classList.add('on');
            _pintaBotones();
            _vigilaEstado();
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

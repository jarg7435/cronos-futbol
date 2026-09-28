// ════════════════════════════════════════════════════════════════════
//  📈 v774 · ESTADÍSTICAS AVANZADAS — LA MITAD DEL DIRECTO
//  js/match/events/advanced-stats.js
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-28, CAPTURAS IMG_0623 e
//  IMG_4890): córners, faltas, centros y ocasiones de gol, con «exactamente
//  el flujo y la logística de Recuperaciones (R) y Pérdidas (P)».
//
//  🔑 POR ESO ES UN CALCO DE possession-tracker.js, y no una ampliación
//  suya: el de R/P es una FASE DE PRUEBA que se descarta borrando su
//  fichero, y si éste viviera dentro se iría con él. Mismo gesto:
//    · un toque = acción del EQUIPO registrada al instante;
//    · se abre la lista de mis jugadores en el campo (dorsal + nombre) para
//      asignarla, OPCIONAL, 5 s; sin asignar se queda como colectiva, que
//      en las acciones EN CONTRA es «del rival / genérica» (encargo, 3.3);
//    · ↩ Rectificar quita la última, acumulativo; 🗑 limpia el partido con
//      confirmación; 📈 abre el resumen por jugador en cualquier momento.
//
//  Y la misma decisión de fondo que R/P: lo registrado NO viaja como suceso
//  del partido (v576: cada suceso obliga a cada espectador a bajarse el
//  documento entero). Se persiste en `localStorage` por partido y viaja:
//    · ☁️ v775 · a `live_stats/{matchId}` (js/match/live/stats-cloud.js),
//      un documento APARTE que sólo lee el cuerpo técnico: de ahí se hidrata
//      al abrir el partido en otro aparato y de ahí lee el visor en vivo. (En
//      v774 iba un resumen dentro del latido de `live_matches`, que también
//      pueden leer las familias: retirado.)
//    · a los informes, en `matchStats`, por los despachos del cuerpo
//      técnico (collective-report / match-reports-send / -auto).
//
//  Las reglas (extra, categoría) viven en js/shared/advanced-stats-report.js.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var VENTANA_MS = 5000;
    var _cierraBarra = null;

    // items: { id, metrica:'corners'|'faltas'|'centros'|'ocasiones',
    //          tipo:'favor'|'contra'|null, playerId, number, name,
    //          matchTime, createdAt }
    window._cronosSAv = window._cronosSAv || { matchId: '', items: [] };

    var METRICA_OK = { corners: 1, faltas: 1, centros: 1, ocasiones: 1 };

    function _idPartido() {
        return (typeof liveMatchId !== 'undefined' && liveMatchId) ? String(liveMatchId) : '';
    }
    function _clave() { return 'cronos_sav::' + (_idPartido() || 'sin_id'); }

    // ☁️ v775 · `t` y `desdeNube`: ver el mismo par en possession-tracker.js.
    function _guarda(desdeNube) {
        if (!desdeNube) window._cronosSAv.t = Date.now();
        try {
            localStorage.setItem(_clave(), JSON.stringify({
                matchId: window._cronosSAv.matchId,
                items:   window._cronosSAv.items,
                t:       Number(window._cronosSAv.t) || 0
            }));
        } catch (e) { /* cuota o modo privado: sigue vivo en memoria */ }
        if (!desdeNube && typeof window.cronosStatsNubeCambio === 'function') {
            try { window.cronosStatsNubeCambio(); } catch (e) { /* la nube nunca tumba el registro */ }
        }
    }

    window.cronosSAvHidrata = function (items, t) {
        var id = _idPartido();
        if (!id) return false;
        window._cronosSAv.matchId = id;
        window._cronosSAv.items = Array.isArray(items) ? items.slice() : [];
        window._cronosSAv.t = Number(t) || 0;
        _guarda(true);
        _pintaBotones();
        _pintaResumen();
        return true;
    };

    // Misma lógica que R/P (v707): el id del partido llega ~800 ms tarde, y
    // lo apuntado bajo `sin_id` se MIGRA al cajón real en vez de perderse.
    function _restaura() {
        var id = _idPartido() || 'sin_id';
        if (window._cronosSAv.matchId === id) return;
        var previo    = window._cronosSAv.matchId || '';
        var enMemoria = Array.isArray(window._cronosSAv.items) ? window._cronosSAv.items : [];
        window._cronosSAv.matchId = id;
        window._cronosSAv.items = [];
        window._cronosSAv.t = 0;
        var guardados = null, tGuardado = 0;
        try {
            var crudo = localStorage.getItem(_clave());
            if (crudo) {
                var d = JSON.parse(crudo);
                if (d && Array.isArray(d.items)) { guardados = d.items; tGuardado = Number(d.t) || 0; }
            }
        } catch (e) { /* json corrupto: se empieza de cero */ }
        if (guardados && guardados.length) {
            window._cronosSAv.items = guardados;
            window._cronosSAv.t = tGuardado;
            return;
        }
        if (previo === 'sin_id' && id !== 'sin_id' && enMemoria.length) {
            window._cronosSAv.items = enMemoria;
            _guarda();
            try { localStorage.removeItem('cronos_sav::sin_id'); } catch (e) {}
            return;
        }
        if (guardados) window._cronosSAv.items = guardados;
    }

    // La llama `_cronosNuevoPartidoDeEquipo()` (app-init.js), junto a la de R/P.
    window.cronosSAvNuevoPartido = function () {
        window._cronosSAv.matchId = '';
        window._cronosSAv.items   = [];
        try { localStorage.removeItem('cronos_sav::sin_id'); } catch (e) {}
        if (typeof window.cronosSAvActualiza === 'function') {
            try { window.cronosSAvActualiza(); } catch (e) {}
        }
    };

    // ── Puertas ──────────────────────────────────────────────────────
    function _categoriaDelPartido() {
        var g = window._currentMatchCategory || '';
        if (g) return g;
        var el = document.getElementById('match-category');
        return el ? (el.value || '') : '';
    }

    function _disponible() {
        if (typeof window.cronosSAvExtraActivo !== 'function' || !window.cronosSAvExtraActivo()) return false;
        if (typeof window.cronosSAvCategoriaCaptura !== 'function') return false;
        return window.cronosSAvCategoriaCaptura(_categoriaDelPartido());
    }
    window.cronosSAvDisponible = _disponible;

    // Igual que R/P (v695): con el reloj corriendo Y en una parte de juego.
    function _enJuego() {
        var corriendo = (typeof isRunning !== 'undefined') ? (isRunning === true) : false;
        var fase = (typeof matchPhase !== 'undefined') ? matchPhase : '';
        return corriendo && (fase === '1st_half' || fase === '2nd_half');
    }

    function _miEquipo() {
        if (typeof window.cronosMiLado === 'function') return window.cronosMiLado();
        return (window._userTeamRole === 'away') ? 'away' : 'home';
    }
    function _misJugadores() {
        var lista = (typeof players !== 'undefined' && Array.isArray(players)) ? players : [];
        var mio = _miEquipo();
        return lista.filter(function (p) { return p && p.team === mio; });
    }
    function _misJugadoresEnCampo() {
        return _misJugadores().filter(function (p) { return p.status === 'field'; });
    }

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

    function _metrica(id) {
        var M = window.CRONOS_SAV_METRICAS || [];
        for (var i = 0; i < M.length; i++) if (M[i].id === id) return M[i];
        return null;
    }
    function _etiquetaItem(it) {
        var mt = _metrica(it.metrica);
        if (!mt) return '';
        if (mt.total) return mt.nombre.replace(' al área', '');
        return mt.nombre.replace(' de gol', '') + ' ' + (it.tipo === 'contra' ? mt.con : mt.fav).toLowerCase();
    }

    // ════════════════════════════════════════════════════════════════
    //  REGISTRO
    // ════════════════════════════════════════════════════════════════
    window.cronosSAvRegistra = function (metrica, tipo) {
        if (!METRICA_OK[metrica]) return null;
        var mt = _metrica(metrica);
        if (!mt) return null;
        if (mt.total) tipo = null;
        else if (tipo !== 'favor' && tipo !== 'contra') return null;
        // 🚨 Las puertas van en la FUNCIÓN (es pública), no sólo en el botón.
        if (!_disponible()) return null;
        if (!_enJuego()) {
            if (typeof showToast === 'function') {
                showToast('⏸️ El partido no está en juego: no se registran estadísticas', 2600);
            }
            return null;
        }
        _restaura();
        var item = {
            id: 'sav_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
            metrica: metrica, tipo: tipo,
            playerId: null, number: '', name: '',
            matchTime: _tiempoPartido(),
            createdAt: Date.now()
        };
        window._cronosSAv.items.push(item);
        _guarda();
        _pintaBotones();
        _abreBarra(item);
        return item;
    };

    window.cronosSAvAsigna = function (itemId, playerId) {
        var it = _busca(itemId);
        if (!it) return false;
        var p = _misJugadores().filter(function (x) { return String(x.id) === String(playerId); })[0];
        // 🚨 Sólo los MÍOS: la lista ya los filtra, pero eso es pintado (la
        // lección de R/P: un id del rival colaba una acción ajena).
        if (!p) return false;
        it.playerId = String(p.id);
        it.number   = String(p.number == null ? '' : p.number);
        it.name     = String(p.alias || p.name || '');
        _guarda();
        _cierraBarraYa();
        _pintaBotones();
        _pintaResumen();
        if (typeof showToast === 'function') {
            showToast('📈 ' + _etiquetaItem(it) + ' · ' + (it.name || ('#' + it.number)), 1800);
        }
        return true;
    };

    // Deja una acción como colectiva / del rival (quita el jugador).
    window.cronosSAvDesasigna = function (itemId) {
        var it = _busca(itemId);
        if (!it) return false;
        it.playerId = null; it.number = ''; it.name = '';
        _guarda();
        _cierraBarraYa();
        _pintaBotones();
        _pintaResumen();
        return true;
    };

    window.cronosSAvDeshace = function (itemId) {
        var i = _indice(itemId);
        if (i < 0) return false;
        window._cronosSAv.items.splice(i, 1);
        _guarda();
        _cierraBarraYa();
        _pintaBotones();
        _pintaResumen();
        return true;
    };

    window.cronosSAvRectifica = function () {
        _restaura();
        var arr = window._cronosSAv.items;
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
            showToast('↩ Rectificado: ' + _etiquetaItem(fuera) + (fuera.name ? (' · ' + fuera.name) : ''), 1800);
        }
        return fuera;
    };

    window.cronosSAvLimpiaTodo = function (sinPreguntar) {
        _restaura();
        var n = window._cronosSAv.items.length;
        if (!n) {
            if (typeof showToast === 'function') showToast('No hay registros que borrar', 1500);
            return 0;
        }
        if (!sinPreguntar && typeof confirm === 'function' &&
            !confirm('¿Borrar TODAS las estadísticas avanzadas de este partido?\n\n' +
                     n + ' apunte(s). No se puede deshacer.')) {
            return 0;
        }
        window._cronosSAv.items = [];
        _guarda();
        _cierraBarraYa();
        _pintaBotones();
        _pintaResumen();
        if (typeof showToast === 'function') showToast('🗑 Estadísticas borradas (' + n + ')', 1800);
        return n;
    };

    function _busca(id) { var i = _indice(id); return i < 0 ? null : window._cronosSAv.items[i]; }
    function _indice(id) {
        var arr = window._cronosSAv.items;
        for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
        return -1;
    }

    // ════════════════════════════════════════════════════════════════
    //  AGREGADO — el esquema del encargo (punto 2)
    // ════════════════════════════════════════════════════════════════
    //  corners/faltas/ocasiones: { favor, contra, detalle:[{ playerId, dorsal,
    //  name, minuto, tipo }] } · centros: { total, detalle:[…] }
    //  + `porDorsal` (lo de cada jugador, claves cortas de CRONOS_SAV_CLAVES)
    //  y `sinAsignar`, que es lo que necesitan el informe y el acumulado.
    //
    //  🔑 La clave del desglose es el DORSAL (como R/P): los informes casan
    //  por `playerNumber`, y el id de la sesión no existe en ellos.
    //
    //  Sin lista explícita es «lo del partido EN CURSO», que es lo que piden
    //  los despachos: devuelve null si el módulo no aplica a este partido o
    //  no hay nada registrado (no se guarda un objeto vacío en 18 documentos).
    window.cronosSAvDelPartido = function (items) {
        var explicito = Array.isArray(items);
        var lista = explicito ? items
                  : ((window._cronosSAv && Array.isArray(window._cronosSAv.items)) ? window._cronosSAv.items : []);
        if (!explicito) {
            if (typeof window.cronosSAvCategoriaPermite === 'function' &&
                !window.cronosSAvCategoriaPermite(_categoriaDelPartido())) return null;
            if (!lista.length) return null;
        }
        var res = {
            v: 1,
            corners:   { favor: 0, contra: 0, detalle: [] },
            faltas:    { favor: 0, contra: 0, detalle: [] },
            centros:   { total: 0, detalle: [] },
            ocasiones: { favor: 0, contra: 0, detalle: [] },
            porDorsal: {},
            sinAsignar: (typeof window.cronosSAvCeros === 'function') ? window.cronosSAvCeros()
                        : { cf: 0, cc: 0, ff: 0, fc: 0, ce: 0, of: 0, oc: 0 }
        };
        var ordenados = lista.slice().sort(function (a, b) {
            return (Number(a && a.createdAt) || 0) - (Number(b && b.createdAt) || 0);
        });
        ordenados.forEach(function (it) {
            if (!it || !METRICA_OK[it.metrica]) return;
            var mt = _metrica(it.metrica);
            if (!mt) return;
            var b = res[it.metrica];
            var k;
            if (mt.total) { b.total++; k = mt.kt; }
            else {
                if (it.tipo !== 'favor' && it.tipo !== 'contra') return;
                b[it.tipo]++;
                k = (it.tipo === 'favor') ? mt.kf : mt.kc;
            }
            var dorsal = String(it.number == null ? '' : it.number).trim();
            var asignado = !!(it.playerId && dorsal);
            if (asignado) {
                if (!res.porDorsal[dorsal]) res.porDorsal[dorsal] = {};
                res.porDorsal[dorsal][k] = (res.porDorsal[dorsal][k] || 0) + 1;
            } else {
                res.sinAsignar[k]++;
            }
            var det = {
                playerId: asignado ? String(it.playerId) : null,
                dorsal:   asignado ? dorsal : '',
                name:     asignado ? String(it.name || '') : '',
                minuto:   String(it.matchTime || '')
            };
            if (!mt.total) det.tipo = it.tipo;
            b.detalle.push(det);
        });
        return res;
    };

    // ════════════════════════════════════════════════════════════════
    //  INTERFAZ
    // ════════════════════════════════════════════════════════════════
    function _estilos() {
        if (document.getElementById('cronos-sav-css')) return;
        var st = document.createElement('style');
        st.id = 'cronos-sav-css';
        st.textContent = [
            // La caja deja pasar los toques (lección de v696: un <div> sin
            // fondo sobre el césped se come los toques de las fichas); sólo
            // los controles los reciben.
            '#cronos-sav-bar{position:fixed;left:0;top:0;z-index:1002;display:none;',
            'gap:6px;align-items:stretch;pointer-events:none;}',
            '#cronos-sav-bar.on{display:flex;}',
            '#cronos-sav-bar.tapado{display:none;}',
            // Separador con el bloque R/P (encargo 4.A).
            '#cronos-sav-bar .sav-sep{width:2px;align-self:stretch;margin:4px 4px 4px 0;',
            'background:rgba(255,255,255,0.18);border-radius:2px;}',
            '.sav-grp{pointer-events:auto;display:flex;flex-direction:column;align-items:stretch;',
            'background:rgba(13,17,23,0.72);border:1px solid rgba(240,136,62,0.40);border-radius:10px;',
            'padding:3px;gap:2px;box-shadow:0 4px 14px rgba(0,0,0,0.45);',
            'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}',
            '.sav-lbl{font-size:0.56rem;font-weight:900;letter-spacing:0.6px;color:#f0883e;',
            'text-align:center;line-height:1;padding-top:1px;}',
            '.sav-pair{display:flex;gap:3px;}',
            '.sav-btn{flex:1;min-width:40px;min-height:34px;border-radius:7px;border:1px solid rgba(255,255,255,0.28);',
            'color:#fff;font-weight:900;font-size:0.72rem;cursor:pointer;touch-action:manipulation;',
            'display:flex;align-items:center;justify-content:center;gap:3px;padding:0 4px;}',
            '.sav-btn.fav{background:rgba(46,160,67,0.78);}',
            '.sav-btn.con{background:rgba(218,54,51,0.78);}',
            '.sav-btn.tot{background:rgba(88,166,255,0.62);}',
            '.sav-btn.sum{pointer-events:auto;background:rgba(240,136,62,0.72);min-width:40px;',
            'border-radius:10px;font-size:0.9rem;box-shadow:0 4px 14px rgba(0,0,0,0.45);}',
            '.sav-btn:active{transform:scale(0.94);}',
            '.sav-btn.off{opacity:0.38;filter:grayscale(0.6);cursor:not-allowed;}',
            '.sav-btn.off:active{transform:none;}',
            '.sav-n{font-size:0.66rem;opacity:0.95;}',
            // ── 📱 Móvil apaisado: COLUMNA sobre el botón LOCAL (encargo 4.B).
            //    Cada grupo en una fila compacta; la posición la calcula JS.
            '@media (max-width: 950px){',
            '  #cronos-sav-bar.on{flex-direction:column;gap:4px;}',
            '  #cronos-sav-bar .sav-sep{display:none;}',
            '  .sav-grp{padding:2px;border-radius:8px;}',
            '  .sav-lbl{font-size:0.5rem;}',
            '  .sav-btn{min-width:25px;min-height:28px;font-size:0.64rem;padding:0 2px;border-radius:6px;}',
            '  .sav-btn .sav-s{display:none;}',
            '  .sav-btn.sum{min-height:30px;font-size:0.8rem;}',
            '}',
            // ── Lista de jugadores para asignar ──
            '#cronos-sav-assign{position:fixed;z-index:1003;display:none;',
            'background:rgba(13,17,23,0.97);border:1px solid rgba(240,136,62,0.35);',
            'border-radius:12px;padding:7px 9px;max-width:94vw;box-shadow:0 8px 26px rgba(0,0,0,0.6);}',
            '#cronos-sav-assign.on{display:block;}',
            '.sav-a-tit{font-size:0.62rem;color:#8b949e;font-weight:700;text-transform:uppercase;',
            'letter-spacing:0.5px;margin-bottom:5px;}',
            '.sav-chips{display:flex;gap:5px;flex-wrap:wrap;max-height:46vh;overflow-y:auto;}',
            '.sav-chip{min-height:38px;border-radius:19px;border:1px solid rgba(255,255,255,0.45);',
            'background:rgba(255,255,255,0.08);color:#fff;font-size:0.74rem;cursor:pointer;',
            'display:flex;align-items:center;gap:5px;padding:0 10px 0 4px;touch-action:manipulation;}',
            '.sav-chip b{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;',
            'border-radius:50%;background:rgba(255,255,255,0.16);font-weight:900;}',
            '.sav-chip:active{transform:scale(0.95);}',
            '.sav-chip.gen{border-style:dashed;color:#c9d1d9;padding:0 10px;}',
            '.sav-chip.undo{border-color:rgba(210,168,255,0.5);color:#d2a8ff;padding:0 10px;}',
            // ── Panel de resumen ──
            '#cronos-sav-panel{position:fixed;inset:0;z-index:2400;display:none;',
            'align-items:center;justify-content:center;background:rgba(0,0,0,0.66);padding:14px;}',
            '#cronos-sav-panel.on{display:flex;}',
            '.sav-card{background:var(--bg-card,#0d1117);border:1px solid rgba(255,255,255,0.16);',
            'border-radius:14px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;',
            'padding:14px;box-shadow:0 18px 50px rgba(0,0,0,0.7);color:#c9d1d9;}',
            '.sav-k{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;}',
            '.sav-k div{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);',
            'border-radius:8px;padding:5px 6px;}',
            '.sav-k .n{font-size:0.56rem;color:#8b949e;text-transform:uppercase;}',
            '.sav-k .v{font-size:1rem;font-weight:800;}',
            '.sav-k .f{color:#3fb950;}.sav-k .c{color:#f85149;}',
            '.sav-t{width:100%;border-collapse:collapse;font-size:0.72rem;}',
            '.sav-t th{font-size:0.56rem;color:#f0883e;text-transform:uppercase;padding:4px 3px;',
            'border-bottom:1px solid rgba(255,255,255,0.12);}',
            '.sav-t td{padding:4px 3px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:center;}',
            '.sav-t td.n{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;}',
            '.sav-t td.z{color:#4d5566;}',
            '.sav-ult{margin-top:10px;font-size:0.7rem;}',
            '.sav-ult div{display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);}',
            '.sav-ult span.t{color:#8b949e;min-width:62px;}',
            '.sav-ult span.x{flex:1;min-width:0;}',
            '.sav-ult button{background:none;border:1px solid rgba(248,81,73,0.45);color:#f85149;border-radius:6px;',
            'min-width:30px;min-height:28px;cursor:pointer;}',
            '.sav-acc{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}',
            '.sav-acc button{flex:1;min-height:44px;border-radius:10px;font-weight:800;font-size:0.75rem;cursor:pointer;}',
            '.sav-acc .rect{background:rgba(210,168,255,0.16);border:1px solid rgba(210,168,255,0.45);color:#d2a8ff;}',
            '.sav-acc .clr{background:rgba(248,81,73,0.14);border:1px solid rgba(248,81,73,0.45);color:#f85149;}',
            '.sav-acc .cls{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);color:#c9d1d9;}'
        ].join('');
        document.head.appendChild(st);
    }

    // Los botones, a partir del catálogo único de métricas.
    function _htmlBarra() {
        var M = window.CRONOS_SAV_METRICAS || [];
        var grupos = M.map(function (mt) {
            if (mt.total) {
                return '<div class="sav-grp"><div class="sav-lbl">' + mt.corto + '</div><div class="sav-pair">' +
                    '<button type="button" class="sav-btn tot" data-sav="' + mt.id + '" data-tipo="" ' +
                    'title="' + mt.nombre + '">+ <span class="sav-n" id="sav-n-' + mt.kt + '">0</span></button>' +
                    '</div></div>';
            }
            return '<div class="sav-grp"><div class="sav-lbl">' + mt.corto + '</div><div class="sav-pair">' +
                '<button type="button" class="sav-btn fav" data-sav="' + mt.id + '" data-tipo="favor" ' +
                'title="' + mt.nombre + ' · ' + mt.fav + '">▲<span class="sav-s">F</span> <span class="sav-n" id="sav-n-' + mt.kf + '">0</span></button>' +
                '<button type="button" class="sav-btn con" data-sav="' + mt.id + '" data-tipo="contra" ' +
                'title="' + mt.nombre + ' · ' + mt.con + '">▼<span class="sav-s">C</span> <span class="sav-n" id="sav-n-' + mt.kc + '">0</span></button>' +
                '</div></div>';
        }).join('');
        return '<div class="sav-sep"></div>' + grupos +
            '<button type="button" class="sav-btn sum" id="cronos-sav-sum" title="Estadísticas avanzadas por jugador">📈</button>';
    }

    function _monta() {
        _estilos();
        if (document.getElementById('cronos-sav-bar')) return;
        var barra = document.createElement('div');
        barra.id = 'cronos-sav-bar';
        barra.innerHTML = _htmlBarra();
        var asig = document.createElement('div');
        asig.id = 'cronos-sav-assign';
        var panel = document.createElement('div');
        panel.id = 'cronos-sav-panel';
        document.body.appendChild(asig);
        document.body.appendChild(panel);
        document.body.appendChild(barra);

        // `click`, no `touchstart` (un dedo que resbala registraría fantasmas).
        var btns = barra.querySelectorAll('[data-sav]');
        for (var i = 0; i < btns.length; i++) {
            (function (b) {
                b.addEventListener('click', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    window.cronosSAvRegistra(b.getAttribute('data-sav'), b.getAttribute('data-tipo') || null);
                });
            })(btns[i]);
        }
        var sum = document.getElementById('cronos-sav-sum');
        if (sum) sum.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            window.cronosSAvAbrePanel();
        });
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('resize', _colocaBarra);
            window.addEventListener('orientationchange', function () { setTimeout(_colocaBarra, 250); });
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  DÓNDE VA LA BARRA — cálculo PURO (lo ejecuta el guard)
    // ════════════════════════════════════════════════════════════════
    //  m = { ancho, alto, seguro, campo, local, pr, barra:{w,h} }
    //    campo → rect de `.pitch` · local → rect del botón «LOCAL»
    //    pr    → rect de la barra R/P si está a la vista
    //
    //  📱 ≤950px (móvil apaisado): COLUMNA en el margen IZQUIERDO, justo
    //     encima de «LOCAL» y, si el margen da, fuera del césped. El R/P del
    //     margen derecho (v770) no se toca.
    //  📟/🖥️ >950px (iPad, tablet, PC): FILA junto al bloque R/P, a su
    //     derecha y con separador; si no cabe, a su izquierda; sin R/P a la
    //     vista, centrada bajo el campo.
    window.cronosSAvSitioBarra = function (m) {
        if (!m || !(m.ancho > 0) || !(m.alto > 0)) return null;
        var w = m.barra ? m.barra.w : 0, h = m.barra ? m.barra.h : 0;
        var seguro = m.seguro || 0;
        var left, top;

        if (m.ancho <= 950) {
            var l = m.local;
            var suelo = l ? l.top - 8 : m.alto - seguro - 20;
            top = Math.max(4, suelo - h);
            left = l ? l.left : 10;
            if (m.campo) left = Math.min(left, m.campo.left - w - 4);
            left = Math.max(4, Math.min(left, m.ancho - w - 4));
            return { modo: 'movil', left: Math.round(left), top: Math.round(top), w: w, h: h,
                     // La lista de jugadores crece HACIA LA DERECHA.
                     asignar: { left: Math.round(left + w + 8), right: null,
                                bottom: Math.round(Math.max(4, m.alto - (top + h))),
                                maxW: Math.max(160, Math.round(m.ancho - (left + w + 8) - 8)) } };
        }

        var p = m.pr;
        if (p && p.width > 0) {
            top = (p.top + p.height / 2) - h / 2;
            left = p.right + 10;
            if (left + w > m.ancho - 4) {
                left = p.left - 10 - w;
                if (left < 4) {              // no cabe a ningún lado: encima de R/P
                    left = Math.max(4, Math.min((p.left + p.right) / 2 - w / 2, m.ancho - w - 4));
                    top = p.top - h - 8;
                }
            }
        } else {
            var c = m.campo;
            var cx  = c ? (c.left + c.right) / 2 : m.ancho / 2;
            var pie = c ? c.bottom : m.alto - seguro - h - 14;
            var hueco = (m.alto - seguro) - pie;
            top = pie + Math.max(4, (hueco - h) / 2);
            var limite = m.alto - seguro - h - 4;
            if (limite < pie + 2) limite = m.alto - h - 2;
            top = Math.min(top, limite);
            left = Math.min(Math.max(4, cx - w / 2), m.ancho - w - 4);
        }
        top = Math.max(4, Math.min(top, m.alto - seguro - h - 2));
        var cxBarra = left + w / 2;
        return { modo: 'fila', left: Math.round(left), top: Math.round(top), w: w, h: h,
                 asignar: { left: Math.round(cxBarra), right: null, centrado: true,
                            bottom: Math.round(m.alto - top + 8),
                            maxW: Math.round(Math.min(560, m.ancho - 20)) } };
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
        var barra = document.getElementById('cronos-sav-bar');
        var asig  = document.getElementById('cronos-sav-assign');
        if (!barra || !barra.style || !barra.classList.contains('on')) return;
        var ancho = window.innerWidth, alto = window.innerHeight;

        // 📱 El cajón de LOCAL abierto ocupa ese margen: la columna se aparta.
        var cajon = (typeof document.querySelector === 'function') ? document.querySelector('.sidebar') : null;
        var tapado = ancho <= 950 && !!(cajon && cajon.classList && cajon.classList.contains('open'));
        if (tapado) { barra.classList.add('tapado'); return; }
        barra.classList.remove('tapado');

        var rb = _rectVisible(barra);
        if (!rb || typeof document.querySelector !== 'function') return;
        var prBar = document.getElementById('cronos-pr-bar');
        var sitio = window.cronosSAvSitioBarra({
            ancho: ancho, alto: alto, seguro: _seguroInferior(),
            campo: _rectVisible(document.querySelector('.pitch')),
            local: _rectVisible(document.getElementById('toggle-bench-home')),
            pr: (prBar && prBar.classList.contains('on')) ? _rectVisible(prBar) : null,
            barra: { w: rb.width, h: rb.height }
        });
        if (!sitio) return;
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
        var r = window.cronosSAvDelPartido(window._cronosSAv.items) || {};
        var M = window.CRONOS_SAV_METRICAS || [];
        M.forEach(function (mt) {
            var b = r[mt.id] || {};
            var pon = function (k, v) {
                var el = document.getElementById('sav-n-' + k);
                if (el) el.textContent = String(Number(v) || 0);
            };
            if (mt.total) pon(mt.kt, b.total);
            else { pon(mt.kf, b.favor); pon(mt.kc, b.contra); }
        });
        var enJuego = _enJuego();
        var bar = document.getElementById('cronos-sav-bar');
        var btns = bar ? bar.querySelectorAll('[data-sav]') : [];
        for (var i = 0; i < btns.length; i++) {
            if (enJuego) { btns[i].classList.remove('off'); btns[i].removeAttribute('aria-disabled'); }
            else { btns[i].classList.add('off'); btns[i].setAttribute('aria-disabled', 'true'); }
        }
    }

    // El reloj cambia sin pasar por renderPlayers(): vigía de 1 s (como R/P).
    var _ultimoEnJuego = null;
    function _vigila() {
        if (_vigila._t) return;
        _vigila._t = setInterval(function () {
            var barra = document.getElementById('cronos-sav-bar');
            if (!barra || !barra.classList.contains('on')) return;
            _colocaBarra();
            var e = _enJuego();
            if (e === _ultimoEnJuego) return;
            _ultimoEnJuego = e;
            _pintaBotones();
        }, 1000);
    }

    function _esc(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }

    function _abreBarra(item) {
        var cont = document.getElementById('cronos-sav-assign');
        if (!cont) return;
        var jug = _misJugadoresEnCampo().slice().sort(function (a, b) {
            return (parseInt(a.number, 10) || 99) - (parseInt(b.number, 10) || 99);
        });
        var contra = item.tipo === 'contra';
        var chips = jug.map(function (p) {
            var nom = String(p.alias || p.name || '').split(' ')[0].slice(0, 10);
            return '<button type="button" class="sav-chip" data-pid="' + _esc(p.id) + '">' +
                   '<b>' + _esc(p.number) + '</b>' + _esc(nom) + '</button>';
        }).join('');
        cont.innerHTML =
            '<div class="sav-a-tit">📈 ' + _esc(_etiquetaItem(item)) + ' ' + _esc(item.matchTime || '') +
            ' · ¿' + (contra ? 'quién? (opcional)' : 'de quién? (opcional)') + '</div>' +
            '<div class="sav-chips">' + chips +
            '<button type="button" class="sav-chip gen" data-gen="1">' +
                (contra ? '⚑ Rival / equipo' : '👥 Equipo') + '</button>' +
            '<button type="button" class="sav-chip undo" data-undo="1">↩ Rectificar</button></div>';
        cont.classList.add('on');
        _colocaBarra();

        cont.querySelectorAll('[data-pid]').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                window.cronosSAvAsigna(item.id, b.getAttribute('data-pid'));
            });
        });
        var gen = cont.querySelector('[data-gen]');
        if (gen) gen.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            _cierraBarraYa();   // se queda como está: colectiva / del rival
        });
        var undo = cont.querySelector('[data-undo]');
        if (undo) undo.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            window.cronosSAvRectifica();
        });
        if (_cierraBarra) clearTimeout(_cierraBarra);
        _cierraBarra = setTimeout(_cierraBarraYa, VENTANA_MS);
    }

    function _cierraBarraYa() {
        if (_cierraBarra) { clearTimeout(_cierraBarra); _cierraBarra = null; }
        var cont = document.getElementById('cronos-sav-assign');
        if (cont) { cont.classList.remove('on'); cont.innerHTML = ''; }
    }

    // ════════════════════════════════════════════════════════════════
    //  📈 RESUMEN POR JUGADOR, EN VIVO
    // ════════════════════════════════════════════════════════════════
    window.cronosSAvAbrePanel = function () {
        _restaura();
        var panel = document.getElementById('cronos-sav-panel');
        if (!panel) return false;
        panel.classList.add('on');
        _pintaResumen();
        return true;
    };
    window.cronosSAvCierraPanel = function () {
        var panel = document.getElementById('cronos-sav-panel');
        if (panel) panel.classList.remove('on');
        return true;
    };

    function _pintaResumen() {
        var panel = document.getElementById('cronos-sav-panel');
        if (!panel || !panel.classList.contains('on')) return;
        var r = window.cronosSAvDelPartido(window._cronosSAv.items);
        var de = function (d) {
            return (typeof window.cronosSAvDeJugador === 'function')
                ? window.cronosSAvDeJugador(r, d) : { cf: 0, cc: 0, ff: 0, fc: 0, ce: 0, of: 0, oc: 0 };
        };
        var cel = function (n) { return '<td' + (n ? '' : ' class="z"') + '>' + n + '</td>'; };
        var M = window.CRONOS_SAV_METRICAS || [];
        var kpis = M.map(function (mt) {
            var b = r[mt.id] || {};
            return '<div><div class="n">' + _esc(mt.nombre.replace(' al área', '').replace(' de gol', '')) + '</div>' +
                (mt.total ? '<div class="v">' + (b.total || 0) + '</div>'
                          : '<div class="v"><span class="f">' + (b.favor || 0) + '</span> / <span class="c">' +
                            (b.contra || 0) + '</span></div>') + '</div>';
        }).join('');

        var filas = _misJugadores().slice()
            .sort(function (a, b) { return (parseInt(a.number, 10) || 99) - (parseInt(b.number, 10) || 99); })
            .map(function (p) {
                var x = de(p.number);
                var algo = x.cf + x.cc + x.ff + x.fc + x.ce + x.of + x.oc;
                return '<tr style="' + (algo ? '' : 'opacity:0.45;') + '">' +
                    '<td class="n"><b style="color:#8b949e;">' + _esc(p.number) + '</b> ' + _esc(p.alias || p.name || '') + '</td>' +
                    cel(x.cf) + cel(x.cc) + cel(x.ff) + cel(x.fc) + cel(x.ce) + cel(x.of) + cel(x.oc) + '</tr>';
            }).join('');
        var s = r.sinAsignar || {};
        var filaSin = '<tr style="color:#8b949e;"><td class="n"><i>Sin asignar / rival</i></td>' +
            cel(s.cf || 0) + cel(s.cc || 0) + cel(s.ff || 0) + cel(s.fc || 0) +
            cel(s.ce || 0) + cel(s.of || 0) + cel(s.oc || 0) + '</tr>';

        // Últimos apuntes, con ✕ para quitar uno concreto (el «restar»).
        var ult = window._cronosSAv.items.slice(-12).reverse().map(function (it) {
            return '<div><span class="t">' + _esc(it.matchTime || '') + '</span>' +
                '<span class="x">' + _esc(_etiquetaItem(it)) +
                (it.name ? ' · <b>' + _esc(it.number) + '</b> ' + _esc(it.name) : ' · <i style="color:#8b949e;">equipo</i>') +
                '</span><button type="button" data-del="' + _esc(it.id) + '" title="Quitar este apunte">✕</button></div>';
        }).join('');

        panel.innerHTML =
            '<div class="sav-card">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
            '<strong style="font-size:0.88rem;">📈 Estadísticas avanzadas</strong>' +
            '<span style="font-size:0.66rem;color:#8b949e;">en lo que va de partido · ▲ a favor / ▼ en contra</span></div>' +
            '<div class="sav-k">' + kpis + '</div>' +
            '<div style="overflow-x:auto;"><table class="sav-t"><thead><tr><th style="text-align:left;">Jugador</th>' +
            '<th title="Córners a favor">Cór▲</th><th title="Córners en contra">Cór▼</th>' +
            '<th title="Faltas recibidas">Falt R</th><th title="Faltas cometidas">Falt C</th>' +
            '<th title="Centros al área">Cen</th>' +
            '<th title="Ocasiones generadas">Oca▲</th><th title="Ocasiones concedidas">Oca▼</th></tr></thead>' +
            '<tbody>' + (filas || '') + filaSin + '</tbody></table></div>' +
            (ult ? '<div class="sav-ult"><div style="border:none;color:#8b949e;font-size:0.62rem;text-transform:uppercase;">Últimos apuntes</div>' + ult + '</div>' : '') +
            '<div class="sav-acc">' +
            '<button type="button" class="rect" data-acc="rect">↩ Rectificar último</button>' +
            '<button type="button" class="clr"  data-acc="clr">🗑 Limpiar todo</button>' +
            '<button type="button" class="cls"  data-acc="cls">Cerrar</button>' +
            '</div></div>';

        var dels = panel.querySelectorAll('[data-del]');
        for (var i = 0; i < dels.length; i++) {
            (function (b) {
                b.addEventListener('click', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    window.cronosSAvDeshace(b.getAttribute('data-del'));
                });
            })(dels[i]);
        }
        var accs = panel.querySelectorAll('[data-acc]');
        for (var j = 0; j < accs.length; j++) {
            (function (b) {
                b.addEventListener('click', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    var a = b.getAttribute('data-acc');
                    if (a === 'rect') window.cronosSAvRectifica();
                    else if (a === 'clr') window.cronosSAvLimpiaTodo();
                    else window.cronosSAvCierraPanel();
                });
            })(accs[j]);
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  SINCRONÍA CON LA PANTALLA — desde renderPlayers() (render.js)
    // ════════════════════════════════════════════════════════════════
    //  ⚠️ Si la puerta está cerrada, la barra ni se ve ni ocupa sitio: el
    //  encargo pide que con la bandera apagada «no se altere el layout».
    window.cronosSAvActualiza = function () {
        _monta();
        var barra = document.getElementById('cronos-sav-bar');
        if (!barra) return;
        var enPartido = !document.body.classList.contains('setup-mode');
        if (_disponible() && enPartido) {
            _restaura();
            barra.classList.add('on');
            _pintaBotones();
            _colocaBarra();
            _vigila();
            // ☁️ v775 · La misma escucha que R/P (una sola por partido).
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

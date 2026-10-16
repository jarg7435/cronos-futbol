// ════════════════════════════════════════════════════════════════════
//  💪 v819 · F-D · FORTALEZAS Y DEBILIDADES EN DIRECTO
//  js/match/events/strengths-panel.js
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 16-10, capturas 11560/11561): el
//  mismo panel que Cronos Basket, adaptado al fútbol. Un botón «F-D» abre
//  un balance que se recalcula con cada apunte y clasifica cada apartado en
//  Fortaleza / Neutro / Punto crítico / Muestra escasa, más quién DESTACA y
//  quién FLOJEA de mi equipo.
//
//  🔑 NO GUARDA NADA PROPIO. Lee lo que ya registran R/P
//  (`window._cronosPR`, possession-tracker.js), las estadísticas avanzadas
//  (`window._cronosSAv`, advanced-stats.js), el marcador y los goles y
//  tarjetas de cada jugador. Descartarlo es borrar este fichero y su
//  <script>: nada más depende de él.
//
//  📱 DÓNDE VA EL BOTÓN (encargo expreso): en la barra de R/P —la columna
//  del margen DERECHO en el móvil, junto a VISIT.; en fila bajo el campo en
//  iPad y PC—. Si el club sólo tiene las estadísticas avanzadas, va en esa
//  barra. Es UN botón que se mueve de barra: las dos ya se colocan midiendo
//  su propio tamaño, así que no hay que tocar sus cálculos.
//
//  ⏱️ PESTAÑAS: «En directo» (todo el partido), «1.ª parte», «2.ª parte».
//  Cada apunte lleva el minuto como «1T mm:ss» / «2T mm:ss».
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var MIN_PAREJA = 4;   // apuntes mínimos (a favor + en contra) para juzgar
    var MIN_RP     = 6;   // ídem para el balance R/P, que se apunta mucho más
    var UMBRAL     = 0.2; // ±20 % de balance separa fortaleza / neutro / crítico

    var _vista = 'vivo';  // 'vivo' | '1T' | '2T'
    var _vigia = null;
    var _ultimoHtml = '';

    // ════════════════════════════════════════════════════════════════
    //  ANÁLISIS (función PURA: la ejecuta el guard con datos inventados)
    // ════════════════════════════════════════════════════════════════
    //  e = {
    //    pr:   { rec, perd, porDorsal: { '7': { rec, perd } } } | null,
    //    sav:  resultado de cronosSAvDelPartido(lista) | null,
    //    goles:{ favor, contra } | null,
    //    minutos: minutos jugados en el tramo,
    //    jugadores: [{ number, name, goals, cards, yellowCards }]
    //  }
    function _pareja(id, nombre, f, c, min, txt) {
        var n = f + c;
        var r = n ? (f - c) / n : 0;
        var estado = n < min ? 'escasa' : (r >= UMBRAL ? 'fortaleza' : (r <= -UMBRAL ? 'critico' : 'neutro'));
        return { id: id, nombre: nombre, detalle: txt, n: n, puntos: r,
                 barra: n ? Math.round((r + 1) * 50) : 0, estado: estado };
    }

    function _pl(n, sing, plur) { return n + ' ' + (n === 1 ? sing : plur); }

    window.cronosFDAnaliza = function (e) {
        e = e || {};
        var items = [];
        var minutos = Math.max(0, Number(e.minutos) || 0);

        if (e.goles) {
            var gf = Number(e.goles.favor) || 0, gc = Number(e.goles.contra) || 0;
            var g = _pareja('goles', 'Goles', gf, gc, 1, gf + ' a favor · ' + gc + ' en contra');
            items.push(g);
        }
        if (e.pr) {
            var rec = Number(e.pr.rec) || 0, perd = Number(e.pr.perd) || 0;
            var bal = rec - perd;
            items.push(_pareja('rp', 'Balance recuperaciones / pérdidas', rec, perd, MIN_RP,
                rec + ' recup. · ' + perd + ' pérd. · balance ' + (bal > 0 ? '+' : '') + bal));
        }
        var s = e.sav;
        if (s) {
            var oc = s.ocasiones || {}, co = s.corners || {}, fa = s.faltas || {};
            items.push(_pareja('ocasiones', 'Ocasiones de gol', oc.favor || 0, oc.contra || 0, MIN_PAREJA,
                _pl(oc.favor || 0, 'generada', 'generadas') + ' · ' + _pl(oc.contra || 0, 'concedida', 'concedidas')));
            items.push(_pareja('corners', 'Córners', co.favor || 0, co.contra || 0, MIN_PAREJA,
                (co.favor || 0) + ' a favor · ' + (co.contra || 0) + ' en contra'));
            // Faltas: RECIBIR es bueno (el rival no puede pararte), COMETER resta.
            items.push(_pareja('faltas', 'Faltas recibidas / cometidas', fa.favor || 0, fa.contra || 0, MIN_PAREJA,
                _pl(fa.favor || 0, 'recibida', 'recibidas') + ' · ' + _pl(fa.contra || 0, 'cometida', 'cometidas')));
            // Centros: sólo hay total → se juzga el RITMO por parte de 45'.
            var ce = (s.centros && s.centros.total) || 0;
            var ritmo = minutos > 0 ? ce / minutos * 45 : 0;
            var escaso = minutos < 15 && ce < 3;
            var est = escaso ? 'escasa' : (ritmo >= 8 ? 'fortaleza' : (ritmo <= 3 ? 'critico' : 'neutro'));
            var pc = Math.max(-1, Math.min(1, (ritmo - 5.5) / 5.5));
            items.push({ id: 'centros', nombre: 'Centros al área', n: ce, puntos: pc,
                         barra: (ce || minutos >= 15) ? Math.round((pc + 1) * 50) : 0, estado: est,
                         detalle: ce + (minutos > 0 ? ' (' + Math.round(ritmo) + ' por parte)' : '') });
        }

        // Orden: juzgados de más fuerte a más débil; los de muestra escasa al
        // final, los de más apuntes primero.
        items.sort(function (a, b) {
            var ea = a.estado === 'escasa', eb = b.estado === 'escasa';
            if (ea !== eb) return ea ? 1 : -1;
            if (ea) return b.n - a.n;
            return b.puntos - a.puntos;
        });

        var fuertes = items.filter(function (i) { return i.estado === 'fortaleza'; });
        var criticos = items.filter(function (i) { return i.estado === 'critico'; });

        var jug = _valoraJugadores(e);
        return {
            items: items,
            fortalezas: fuertes.length,
            criticos: criticos.length,
            mejor: fuertes.length ? fuertes[0].nombre : '',
            peor: criticos.length ? criticos[criticos.length - 1].nombre : '',
            destacan: jug.destacan,
            flojean: jug.flojean
        };
    };

    //  Puntos por jugador con lo que tiene apuntado A SU NOMBRE. Lo colectivo
    //  (sin dorsal) no reparte entre nadie.
    var PESOS = { goles: 3, rec: 1, perd: -1, of: 1.5, oc: -1, ff: 0.5, fc: -0.5,
                  cf: 0.5, cc: -0.5, ce: 0.5, amarilla: -1, roja: -3 };
    var UMBRAL_JUG = 2;

    function _valoraJugadores(e) {
        var prD = (e.pr && e.pr.porDorsal) || {};
        var svD = (e.sav && e.sav.porDorsal) || {};
        var lista = (e.jugadores || []).map(function (p) {
            var d = String(p.number == null ? '' : p.number).trim();
            var a = prD[d] || {}, b = svD[d] || {};
            var roja = p.cards === 'roja' ? 1 : 0;
            var amar = roja ? (Number(p.yellowCards) >= 2 ? 1 : 0) : ((p.cards === 'amarilla' || Number(p.yellowCards) >= 1) ? 1 : 0);
            var c = { goles: Number(p.goals) || 0, rec: a.rec || 0, perd: a.perd || 0,
                      of: b.of || 0, oc: b.oc || 0, ff: b.ff || 0, fc: b.fc || 0,
                      cf: b.cf || 0, cc: b.cc || 0, ce: b.ce || 0, amarilla: amar, roja: roja };
            var pts = 0;
            Object.keys(PESOS).forEach(function (k) { pts += (c[k] || 0) * PESOS[k]; });
            return { number: d, name: String(p.alias || p.name || ''), puntos: pts, c: c };
        }).filter(function (j) { return j.number || j.name; });

        var destacan = lista.filter(function (j) { return j.puntos >= UMBRAL_JUG; })
            .sort(function (a, b) { return b.puntos - a.puntos; }).slice(0, 4);
        var flojean = lista.filter(function (j) { return j.puntos <= -UMBRAL_JUG; })
            .sort(function (a, b) { return a.puntos - b.puntos; }).slice(0, 4);
        destacan.forEach(function (j) { j.detalle = _detalleJugador(j.c, true); });
        flojean.forEach(function (j) { j.detalle = _detalleJugador(j.c, false); });
        return { destacan: destacan, flojean: flojean };
    }

    function _detalleJugador(c, bueno) {
        var partes = [];
        var pon = function (v, sing, plur) { if (v) partes.push(v + ' ' + (v === 1 ? sing : plur)); };
        if (bueno) {
            pon(c.goles, 'gol', 'goles'); pon(c.of, 'ocasión', 'ocasiones'); pon(c.rec, 'recup.', 'recup.');
            pon(c.ff, 'falta recibida', 'faltas recibidas'); pon(c.cf, 'córner', 'córners'); pon(c.ce, 'centro', 'centros');
            if (c.perd) partes.push(c.perd + ' pérd.');
        } else {
            pon(c.perd, 'pérd.', 'pérd.'); pon(c.fc, 'falta cometida', 'faltas cometidas');
            pon(c.oc, 'ocasión concedida', 'ocasiones concedidas'); pon(c.cc, 'córner en contra', 'córners en contra');
            if (c.roja) partes.push('🟥'); else if (c.amarilla) partes.push('🟨');
            if (c.rec) partes.push(c.rec + ' recup.');
        }
        return partes.join(' · ');
    }

    // ════════════════════════════════════════════════════════════════
    //  DATOS DEL PARTIDO EN CURSO
    // ════════════════════════════════════════════════════════════════
    function _miEquipo() {
        if (typeof window.cronosMiLado === 'function') return window.cronosMiLado();
        return (window._userTeamRole === 'away') ? 'away' : 'home';
    }

    function _delTramo(lista, vista) {
        if (!Array.isArray(lista)) return [];
        if (vista === 'vivo') return lista;
        return lista.filter(function (it) { return String((it && it.matchTime) || '').indexOf(vista) === 0; });
    }

    function _prDisponible() {
        return typeof window.cronosPRDisponible === 'function' && !!window.cronosPRDisponible();
    }
    function _savDisponible() {
        return typeof window.cronosSAvDisponible === 'function' && !!window.cronosSAvDisponible();
    }

    function _num(id) {
        var el = document.getElementById(id);
        return el ? (parseInt(el.textContent, 10) || 0) : 0;
    }

    function _minutos(vista) {
        var h1 = (typeof masterTimeH1 !== 'undefined') ? (Number(masterTimeH1) || 0) : 0;
        var h2 = (typeof masterTimeH2 !== 'undefined') ? (Number(masterTimeH2) || 0) : 0;
        var seg = vista === '1T' ? h1 : (vista === '2T' ? h2 : h1 + h2);
        return seg / 60;
    }

    function _entrada(vista) {
        var e = { minutos: _minutos(vista), jugadores: [] };
        if (_prDisponible() && typeof window.cronosPRDelPartido === 'function') {
            var r = window.cronosPRDelPartido(_delTramo((window._cronosPR || {}).items, vista));
            var porDorsal = {};
            Object.keys(r.recuperaciones.porDorsal || {}).forEach(function (d) {
                porDorsal[d] = porDorsal[d] || {}; porDorsal[d].rec = r.recuperaciones.porDorsal[d];
            });
            Object.keys(r.perdidas.porDorsal || {}).forEach(function (d) {
                porDorsal[d] = porDorsal[d] || {}; porDorsal[d].perd = r.perdidas.porDorsal[d];
            });
            e.pr = { rec: r.recuperaciones.total || 0, perd: r.perdidas.total || 0, porDorsal: porDorsal };
        }
        if (_savDisponible() && typeof window.cronosSAvDelPartido === 'function') {
            e.sav = window.cronosSAvDelPartido(_delTramo((window._cronosSAv || {}).items, vista));
        }
        // Goles y tarjetas sólo existen como TOTAL del partido: no se pueden
        // partir por tramos, así que van únicamente en «En directo».
        var mio = _miEquipo();
        if (vista === 'vivo') {
            var gh = _num('score-home'), ga = _num('score-away');
            e.goles = mio === 'away' ? { favor: ga, contra: gh } : { favor: gh, contra: ga };
        }
        var lista = (typeof players !== 'undefined' && Array.isArray(players)) ? players : [];
        e.jugadores = lista.filter(function (p) { return p && p.team === mio; }).map(function (p) {
            return { number: p.number, name: p.name, alias: p.alias,
                     goals: vista === 'vivo' ? p.goals : 0,
                     cards: vista === 'vivo' ? p.cards : '', yellowCards: vista === 'vivo' ? p.yellowCards : 0 };
        });
        return e;
    }

    // ════════════════════════════════════════════════════════════════
    //  INTERFAZ
    // ════════════════════════════════════════════════════════════════
    function _esc(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }

    function _estilos() {
        if (document.getElementById('cronos-fd-css')) return;
        var st = document.createElement('style');
        st.id = 'cronos-fd-css';
        st.textContent = [
            // ── El botón: mismo cuerpo que R/P, en morado como en Basket ──
            '.cronos-fd-btn{pointer-events:auto;min-width:54px;min-height:44px;border-radius:12px;',
            'font-weight:900;font-size:0.82rem;letter-spacing:0.5px;cursor:pointer;color:#fff;',
            'background:rgba(137,87,229,0.85);border:1px solid rgba(255,255,255,0.35);',
            'display:flex;align-items:center;justify-content:center;padding:0 8px;',
            'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);',
            'box-shadow:0 4px 14px rgba(0,0,0,0.45);touch-action:manipulation;}',
            '.cronos-fd-btn:active{transform:scale(0.94);}',
            '#cronos-sav-bar .cronos-fd-btn{border-radius:10px;align-self:center;}',
            '@media (max-width: 950px){',
            '  #cronos-pr-bar .cronos-fd-btn{width:54px;min-width:0;padding:0 3px;font-size:0.74rem;box-sizing:border-box;}',
            '  #cronos-sav-bar .cronos-fd-btn{min-height:30px;min-width:0;font-size:0.7rem;padding:0 4px;align-self:stretch;}',
            '}',
            // ── La ventana ──
            '#cronos-fd-panel{position:fixed;inset:0;z-index:2400;display:none;',
            'align-items:center;justify-content:center;background:rgba(0,0,0,0.6);padding:14px;}',
            '#cronos-fd-panel.on{display:flex;}',
            '.cronos-fd-card{background:#0d1117;border:1px solid rgba(255,255,255,0.14);border-radius:14px;',
            'width:100%;max-width:760px;max-height:88vh;overflow-y:auto;padding:14px 16px;',
            'box-shadow:0 18px 50px rgba(0,0,0,0.7);color:#c9d1d9;-webkit-overflow-scrolling:touch;}',
            '.cronos-fd-cab{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}',
            '.cronos-fd-tit{font-size:1rem;font-weight:800;color:#f0f6fc;}',
            '.cronos-fd-sub{font-size:0.7rem;color:#8b949e;margin-top:2px;}',
            '.cronos-fd-x{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.2);color:#f0f6fc;',
            'border-radius:8px;padding:6px 12px;font-size:0.8rem;cursor:pointer;min-height:36px;flex-shrink:0;}',
            '.cronos-fd-tabs{display:flex;gap:6px;margin:10px 0 8px;flex-wrap:wrap;}',
            '.cronos-fd-tab{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:#8b949e;',
            'border-radius:16px;padding:5px 12px;font-size:0.72rem;font-weight:700;cursor:pointer;min-height:32px;}',
            '.cronos-fd-tab.on{background:rgba(137,87,229,0.35);border-color:rgba(137,87,229,0.8);color:#fff;}',
            '.cronos-fd-res{font-size:0.74rem;margin-bottom:6px;}',
            '.cronos-fd-res .f{color:#3fb950;} .cronos-fd-res .c{color:#f85149;} .cronos-fd-res b{color:#f0f6fc;}',
            '.cronos-fd-row{display:grid;grid-template-columns:22px minmax(0,1.3fr) minmax(0,1.4fr) 92px;',
            'align-items:center;gap:8px;padding:7px 6px;border-bottom:1px solid rgba(255,255,255,0.06);}',
            '.cronos-fd-row.fortaleza{background:rgba(46,160,67,0.08);}',
            '.cronos-fd-row.critico{background:rgba(218,54,51,0.08);}',
            '.cronos-fd-row .i{font-size:0.72rem;color:#8b949e;}',
            '.cronos-fd-row .nm{font-size:0.8rem;font-weight:800;color:#f0f6fc;}',
            '.cronos-fd-bar{height:4px;border-radius:2px;background:rgba(255,255,255,0.08);margin-top:5px;overflow:hidden;}',
            '.cronos-fd-bar span{display:block;height:100%;border-radius:2px;}',
            '.cronos-fd-row .dt{font-size:0.72rem;color:#c9d1d9;}',
            '.cronos-fd-tag{font-size:0.62rem;font-weight:800;text-align:center;border-radius:6px;padding:3px 4px;}',
            '.cronos-fd-tag.fortaleza{background:rgba(46,160,67,0.25);color:#3fb950;}',
            '.cronos-fd-tag.neutro{background:rgba(139,148,158,0.18);color:#c9d1d9;}',
            '.cronos-fd-tag.critico{background:rgba(218,54,51,0.25);color:#f85149;}',
            '.cronos-fd-tag.escasa{border:1px dashed rgba(139,148,158,0.5);color:#8b949e;}',
            '.cronos-fd-jug{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px;}',
            '.cronos-fd-jug h4{margin:0 0 4px;font-size:0.72rem;letter-spacing:0.5px;}',
            '.cronos-fd-jug .l{font-size:0.76rem;line-height:1.45;}',
            '.cronos-fd-jug .l b{color:#f0f6fc;} .cronos-fd-jug .l span{color:#8b949e;}',
            '.cronos-fd-vacio{font-size:0.76rem;color:#8b949e;padding:10px 0;}',
            // 📱 Móvil apaisado: casi toda la pantalla y filas más compactas.
            '@media (max-width: 950px){',
            '  #cronos-fd-panel{padding:6px;}',
            '  .cronos-fd-card{max-height:calc(100vh - 12px);padding:10px 12px;}',
            '  .cronos-fd-row{grid-template-columns:18px minmax(0,1.2fr) minmax(0,1.3fr) 78px;gap:6px;padding:5px 4px;}',
            '  .cronos-fd-row .nm{font-size:0.74rem;} .cronos-fd-row .dt{font-size:0.66rem;}',
            '}',
            '@media (max-width: 560px){',
            '  .cronos-fd-row{grid-template-columns:16px minmax(0,1fr) 74px;}',
            '  .cronos-fd-row .dt{grid-column:2 / 4;grid-row:2;}',
            '  .cronos-fd-jug{grid-template-columns:1fr;}',
            '}'
        ].join('');
        document.head.appendChild(st);
    }

    // El botón se crea UNA vez y se guarda aquí: suelto (sin barra) no está
    // en el documento y getElementById no lo encontraría.
    var _boton = null;

    function _monta() {
        _estilos();
        if (!_boton) {
            _boton = document.createElement('button');
            _boton.type = 'button';
            _boton.id = 'cronos-fd-btn';
            _boton.className = 'cronos-fd-btn';
            _boton.title = 'Fortalezas y debilidades';
            _boton.textContent = 'F-D';
            _boton.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                window.cronosFDAbre();
            });
        }
        if (!document.getElementById('cronos-fd-panel')) {
            var p = document.createElement('div');
            p.id = 'cronos-fd-panel';
            p.addEventListener('click', function (e) {
                if (e.target === p) { window.cronosFDCierra(); return; }
                var t = e.target && e.target.closest ? e.target.closest('[data-fd]') : null;
                if (!t) return;
                var a = t.getAttribute('data-fd');
                if (a === 'cerrar') window.cronosFDCierra();
                else { _vista = a; _pinta(true); }
            });
            document.body.appendChild(p);
        }
    }

    // El botón vive en la barra de R/P; si el club sólo tiene avanzadas, en
    // la suya. Sin ninguna de las dos, fuera.
    function _colocaBoton() {
        _monta();
        var b = _boton;
        if (!b) return;
        var pr = document.getElementById('cronos-pr-bar');
        var sv = document.getElementById('cronos-sav-bar');
        var destino = (pr && pr.classList.contains('on')) ? pr
                    : ((sv && sv.classList.contains('on')) ? sv : null);
        var movido = false;
        if (destino) {
            if (b.parentNode !== destino) { destino.appendChild(b); movido = true; }
        } else if (b.parentNode) {
            b.parentNode.removeChild(b); movido = true;
        }
        // v820 · La barra cambió de ancho: que las dos se recoloquen ya (en
        // el iPad comparten la fila repartida).
        if (movido) {
            try {
                if (typeof window.cronosPRColoca === 'function') window.cronosPRColoca();
                if (typeof window.cronosSAvColoca === 'function') window.cronosSAvColoca();
            } catch (e) { /* nunca tumba la interfaz */ }
        }
    }
    window.cronosFDColocaBoton = _colocaBoton;

    function _html(a) {
        var titulos = { vivo: 'En directo', '1T': '1.ª parte', '2T': '2.ª parte' };
        var tabs = ['vivo', '1T', '2T'].map(function (v) {
            return '<button type="button" class="cronos-fd-tab' + (v === _vista ? ' on' : '') +
                   '" data-fd="' + v + '">' + titulos[v] + '</button>';
        }).join('');

        var filas = a.items.map(function (it, i) {
            var color = it.estado === 'fortaleza' ? '#3fb950' : (it.estado === 'critico' ? '#f85149' : '#8b949e');
            var etiqueta = { fortaleza: 'Fortaleza', neutro: 'Neutro', critico: 'Punto crítico', escasa: 'Muestra escasa' }[it.estado];
            return '<div class="cronos-fd-row ' + it.estado + '">' +
                   '<span class="i">' + (i + 1) + '</span>' +
                   '<div><div class="nm">' + _esc(it.nombre) + '</div>' +
                   '<div class="cronos-fd-bar"><span style="width:' + it.barra + '%;background:' + color + ';"></span></div></div>' +
                   '<span class="dt">' + _esc(it.detalle) + '</span>' +
                   '<span class="cronos-fd-tag ' + it.estado + '">' + etiqueta + '</span>' +
                   '</div>';
        }).join('');

        var lineaJug = function (j) {
            return '<div><b>#' + _esc(j.number) + ' ' + _esc(j.name.toUpperCase()) + '</b> <span>' +
                   _esc(j.detalle || '') + '</span></div>';
        };

        return '<div class="cronos-fd-card" role="dialog" aria-label="Fortalezas y debilidades">' +
            '<div class="cronos-fd-cab"><div>' +
            '<div class="cronos-fd-tit">💪 F-D · Fortalezas y debilidades</div>' +
            '<div class="cronos-fd-sub">En directo · se recalcula con cada apunte · ordenado de más fuerte a más débil</div>' +
            '</div><button type="button" class="cronos-fd-x" data-fd="cerrar">Cerrar</button></div>' +
            '<div class="cronos-fd-tabs">' + tabs + '</div>' +
            '<div class="cronos-fd-res"><span class="f">' + a.fortalezas + ' fortaleza' + (a.fortalezas === 1 ? '' : 's') +
            '</span> &nbsp;<span class="c">' + a.criticos + ' punto' + (a.criticos === 1 ? '' : 's') + ' crítico' +
            (a.criticos === 1 ? '' : 's') + '</span> &nbsp;· Lo mejor: <b>' + _esc(a.mejor || '—') + '</b>' +
            (a.peor ? ' &nbsp;· A mejorar: <b>' + _esc(a.peor) + '</b>' : '') + '</div>' +
            (filas || '<div class="cronos-fd-vacio">Todavía no hay apuntes de recuperaciones, pérdidas ni estadísticas avanzadas.</div>') +
            '<div class="cronos-fd-jug">' +
            '<div><h4 style="color:#3fb950;">⭐ DESTACAN</h4><div class="l">' +
            (a.destacan.length ? a.destacan.map(lineaJug).join('') : '<span>Nadie todavía.</span>') + '</div></div>' +
            '<div><h4 style="color:#f0883e;">⚠️ FLOJEAN</h4><div class="l">' +
            (a.flojean.length ? a.flojean.map(lineaJug).join('') : '<span>Nadie todavía.</span>') + '</div></div>' +
            '</div></div>';
    }

    function _pinta(forzar) {
        var panel = document.getElementById('cronos-fd-panel');
        if (!panel || !panel.classList.contains('on')) return;
        var html = _html(window.cronosFDAnaliza(_entrada(_vista)));
        if (!forzar && html === _ultimoHtml) return;   // nada nuevo: no se toca (ni el scroll)
        var card = panel.querySelector('.cronos-fd-card');
        var scroll = card ? card.scrollTop : 0;
        panel.innerHTML = html;
        _ultimoHtml = html;
        var nueva = panel.querySelector('.cronos-fd-card');
        if (nueva && !forzar) nueva.scrollTop = scroll;
    }

    window.cronosFDAbre = function () {
        _monta();
        var panel = document.getElementById('cronos-fd-panel');
        if (!panel) return false;
        // Una sola cosa flotante a la vez (v818): fuera banquillos y ventanas.
        if (typeof window.closeDrawers === 'function') window.closeDrawers();
        if (typeof window.cronosPRCierraAsignar === 'function') window.cronosPRCierraAsignar();
        if (typeof window.cronosSAvCierraAsignar === 'function') window.cronosSAvCierraAsignar();
        _vista = 'vivo';
        panel.classList.add('on');
        _pinta(true);
        // 🔁 Se recalcula con cada apunte: R/P, avanzadas, goles y tarjetas
        // llegan por caminos distintos (y de otro aparato, por la nube), así
        // que se mira cada segundo y sólo se repinta si cambió algo.
        if (!_vigia) _vigia = setInterval(function () { _pinta(false); }, 1000);
        return true;
    };

    window.cronosFDCierra = function () {
        var panel = document.getElementById('cronos-fd-panel');
        if (panel) panel.classList.remove('on');
        if (_vigia) { clearInterval(_vigia); _vigia = null; }
        _ultimoHtml = '';
        return true;
    };

    // Las barras se encienden y apagan con la categoría, el extra y la fase
    // del partido: el botón las sigue.
    function _arranca() {
        _colocaBoton();
        setInterval(function () {
            _colocaBoton();
            if (document.body.classList.contains('setup-mode')) window.cronosFDCierra();
        }, 1000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _arranca);
    else _arranca();
})();

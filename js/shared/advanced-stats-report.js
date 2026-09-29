// ════════════════════════════════════════════════════════════════════
//  📈 v774 · ESTADÍSTICAS AVANZADAS — LA MITAD DE LOS INFORMES
//  js/shared/advanced-stats-report.js
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-28 + ampliación del mismo
//  día): córners, faltas, centros y ocasiones de gol, capturados en el
//  directo con la misma logística que R/P y llevados a TODO el ciclo
//  analítico posterior:
//    · informe colectivo del partido (report-engine.js, copia privada);
//    · resumen acumulado de la temporada del equipo (Dirección,
//      Coordinación y «Mis Informes»), con totales y promedios;
//    · desglose por jugador, del partido y de la temporada.
//
//  Este fichero es la mitad que LEE: reglas, lectura del dato guardado en
//  los informes, acumulado y pintado del bloque de temporada. La mitad que
//  CAPTURA vive en js/match/events/advanced-stats.js.
//
//  🔑 EL DATO VIAJA EN `matchStats`, junto a `matchPR`, en las copias del
//  CUERPO TÉCNICO de `cronos_player_reports` (los mismos cinco despachos).
//  A las familias NO se les manda: el encargo pide que las analíticas sean
//  de los roles técnicos.
//
//  TRES PUERTAS, y hacen falta todas:
//    1. el extra `modulo_stats_avanzadas` del SuperAdmin. ⚠️ AL REVÉS QUE
//       LOS DEMÁS EXTRAS, AUSENTE = APAGADO (`=== true`): el encargo lo
//       describe como una bandera que se ENCIENDE, y con la regla de
//       siempre (`!== false`) el módulo se habría estrenado solo en todos
//       los clubes reales el día del despliegue.
//    2. la categoría: Juvenil, Regional (y Regional FEM) y Nacional. El
//       fútbol base y formativo —Cadete incluido— queda fuera.
//    3. (sólo al capturar) el partido en juego, como R/P.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── Las métricas, en UN sitio ────────────────────────────────────
    //  `k` es la clave corta del desglose por jugador (`porDorsal`), que
    //  viaja en cada informe: corta a propósito, porque se repite una vez
    //  por jugador y por documento.
    var METRICAS = [
        { id: 'corners',   corto: 'CÓR', nombre: 'Córners',  fav: 'A favor',   con: 'En contra', kf: 'cf', kc: 'cc' },
        { id: 'faltas',    corto: 'FAL', nombre: 'Faltas',   fav: 'Recibidas', con: 'Cometidas', kf: 'ff', kc: 'fc' },
        { id: 'centros',   corto: 'CEN', nombre: 'Centros al área', total: true, kt: 'ce' },
        { id: 'ocasiones', corto: 'OCA', nombre: 'Ocasiones de gol', fav: 'Generadas', con: 'Concedidas', kf: 'of', kc: 'oc' }
    ];
    var CLAVES = ['cf', 'cc', 'ff', 'fc', 'ce', 'of', 'oc'];
    window.CRONOS_SAV_METRICAS = METRICAS;
    window.CRONOS_SAV_CLAVES = CLAVES;

    function _ceros() {
        var o = {};
        CLAVES.forEach(function (k) { o[k] = 0; });
        return o;
    }
    window.cronosSAvCeros = _ceros;

    // ════════════════════════════════════════════════════════════════
    //  PUERTA 2 · LA CATEGORÍA
    // ════════════════════════════════════════════════════════════════
    //  «Juvenil, Regional (Senior) o Nacional, manteniéndose ocultas para el
    //  fútbol base/formativo inferior». Lista blanca, como la de R/P (v738):
    //  una categoría nueva entra SIN el módulo y hay que apuntarla aquí.
    //
    //  🔑 Por subcadena, como `cronosCategoriaConRegistroPR`, porque la
    //  categoría llega como 'f11_regional', 'Regional FEM B', 'Juvenil A'…
    //  Aquí la trampa de v511 no muerde: FUTureFEM no contiene ninguna de
    //  las tres palabras, y Regional FEM (senior) SÍ debe entrar.
    //  ⚠️ 'senior'/'aficionado' se aceptan por si un club usa su propio
    //  nombre para el primer equipo: son, literalmente, «Regional (Senior)».
    //
    //  SIN CATEGORÍA DEVUELVE `true` (misma política que v738/v761): quien no
    //  sabe de qué equipo es un informe no puede decidir, y el dato sólo
    //  existe si se capturó con las puertas abiertas.
    var CATS = ['juvenil', 'regional', 'nacional', 'senior', 'aficionado'];
    window.CRONOS_SAV_CATEGORIAS = CATS;

    function _norm(s) {
        return String(s == null ? '' : s).normalize('NFD')
            .replace(/\p{M}/gu, '').toLowerCase().trim();
    }

    window.cronosSAvCategoriaPermite = function (cat) {
        var n = _norm(cat);
        if (!n) return true;
        for (var i = 0; i < CATS.length; i++) if (n.indexOf(CATS[i]) !== -1) return true;
        return false;
    };

    // Versión ESTRICTA para el directo: allí la categoría del partido se
    // sabe siempre, y sin ella no se pintan botones.
    window.cronosSAvCategoriaCaptura = function (cat) {
        return !!_norm(cat) && window.cronosSAvCategoriaPermite(cat);
    };

    // ════════════════════════════════════════════════════════════════
    //  PUERTA 1 · EL EXTRA (ausente = APAGADO)
    // ════════════════════════════════════════════════════════════════
    //  Se lee del MISMO usuario efectivo que `_cronosExtraEnabled`
    //  (setup-modal.js), pero con `=== true`. Ver la cabecera.
    window.CRONOS_SAV_EXTRA = 'modulo_stats_avanzadas';
    window.cronosSAvExtraActivo = function () {
        var me = (typeof window._getEffectiveUser === 'function')
            ? (window._getEffectiveUser() || window._cronosCurrentUser)
            : window._cronosCurrentUser;
        // 👑 v776 · EL SUPERADMIN SIN CLUB PROPIO LO VE. Medido en producción
        // (29-09, sólo lectura): la cuenta con la que el autor probó el directo
        // es SÓLO superadmin —sin `clubId`, sin plaza de entrenador y sin
        // `extras`—, así que aquí siempre salía `undefined === true` → apagado,
        // aunque todos los clubes lo tuvieran en verde. Su partido no cuelga de
        // ningún club: no hay extras que consultar, y es el «Control Total».
        // ⚠️ Sólo sin club: un SA que entra con la plaza de un club se juzga
        // por los extras de ESE club, como cualquiera.
        var raiz = window._cronosCurrentUser || {};
        var esSA = raiz.role === 'superadmin' || raiz.role === 'admin';
        if (esSA && !raiz.clubId && !(raiz.extras && typeof raiz.extras === 'object' &&
            Object.prototype.hasOwnProperty.call(raiz.extras, window.CRONOS_SAV_EXTRA))) return true;
        var extras = (me && me.extras) || {};
        return extras[window.CRONOS_SAV_EXTRA] === true;
    };

    // ════════════════════════════════════════════════════════════════
    //  LECTURA DEL DATO GUARDADO EN UN INFORME
    // ════════════════════════════════════════════════════════════════
    //  `matchStats` viaja REPETIDO, una copia por documento de jugador (igual
    //  que `matchPR`). No se suman: se coge el ejemplar más completo. Se
    //  acepta al nivel del partido (`m.matchStats`) por si un agrupador lo
    //  sube ahí.
    function _totalDe(s) {
        if (!s) return -1;
        var t = 0;
        METRICAS.forEach(function (mt) {
            var b = s[mt.id] || {};
            t += mt.total ? (Number(b.total) || 0) : ((Number(b.favor) || 0) + (Number(b.contra) || 0));
        });
        return t;
    }

    window.cronosSAvDelInforme = function (m) {
        if (!m) return null;
        var cat = m.category || ((Array.isArray(m.players) ? m.players : [])
            .filter(function (x) { return x && x.category; })[0] || {}).category || '';
        if (!window.cronosSAvCategoriaPermite(cat)) return null;
        var cands = [];
        if (m.matchStats) cands.push(m.matchStats);
        (Array.isArray(m.players) ? m.players : []).forEach(function (d) {
            if (d && d.matchStats) cands.push(d.matchStats);
        });
        var mejor = null;
        cands.forEach(function (c) { if (_totalDe(c) > _totalDe(mejor)) mejor = c; });
        return (mejor && _totalDe(mejor) > 0) ? mejor : null;
    };

    // Lo de UN jugador en un partido, por dorsal.
    window.cronosSAvDeJugador = function (s, dorsal) {
        var d = String(dorsal == null ? '' : dorsal).trim();
        var out = _ceros();
        if (!s || !d) return out;
        var fila = (s.porDorsal || {})[d] || {};
        CLAVES.forEach(function (k) { out[k] = Number(fila[k]) || 0; });
        return out;
    };

    // ════════════════════════════════════════════════════════════════
    //  ACUMULADO DE TEMPORADA DEL EQUIPO
    // ════════════════════════════════════════════════════════════════
    //  Totales de EQUIPO desde los partidos (incluye lo que se registró sin
    //  jugador: un córner en contra suele ser del rival, no de nadie mío).
    //  Los promedios se dividen por los partidos QUE TRAEN EL DATO: dividir
    //  por todos los de la temporada, incluidos los jugados antes de activar
    //  el módulo, hundiría las medias con ceros que nadie registró.
    window.cronosSAvAcumulaEquipo = function (matches) {
        var tot = { partidos: 0 };
        METRICAS.forEach(function (mt) {
            tot[mt.id] = mt.total ? { total: 0 } : { favor: 0, contra: 0 };
        });
        (matches || []).forEach(function (m) {
            var s = window.cronosSAvDelInforme(m);
            if (!s) return;
            tot.partidos += 1;
            METRICAS.forEach(function (mt) {
                var b = s[mt.id] || {};
                if (mt.total) tot[mt.id].total += Number(b.total) || 0;
                else {
                    tot[mt.id].favor  += Number(b.favor)  || 0;
                    tot[mt.id].contra += Number(b.contra) || 0;
                }
            });
        });
        return tot;
    };

    // ════════════════════════════════════════════════════════════════
    //  PINTADO DEL BLOQUE DE TEMPORADA
    // ════════════════════════════════════════════════════════════════
    //  cronosSAvRenderTemporada(matches, filas, opts) → HTML ('' si no toca)
    //    matches: los partidos agrupados de esa rama (con players[]).
    //    filas:   las de `ctAccumulatePlayerStats`, que ya traen `f.sav`
    //             sumado por jugador con la identidad de temporada de v767
    //             (código, no dorsal).
    //    opts.categoria: la del equipo; sin ella no se filtra (ver arriba).
    //
    //  🔑 VA EN UN BLOQUE APARTE, DEBAJO DE LA TABLA DE SIEMPRE, y no como
    //  siete columnas más: la tabla ya tiene diez y en un iPad vertical se
    //  saldría. Aparte, además, se puede quitar entero sin tocar la otra.
    function _eH(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _media(n, p) {
        if (!p) return '0';
        var v = n / p;
        return (Math.round(v * 10) / 10).toString().replace('.', ',');
    }

    var CSS = '<style>' +
        '.sav-wrap{border:1px solid rgba(240,136,62,0.25);border-radius:10px;background:rgba(240,136,62,0.03);' +
            'margin-bottom:0.9rem;padding:0.6rem 0.7rem;}' +
        '.sav-tit{font-size:0.78rem;font-weight:700;color:#f0883e;margin-bottom:0.2rem;}' +
        '.sav-sub{font-size:0.66rem;color:#8b949e;margin-bottom:0.55rem;}' +
        '.sav-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0.45rem;margin-bottom:0.6rem;}' +
        '.sav-kpi{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:0.4rem 0.5rem;}' +
        '.sav-kpi-n{font-size:0.62rem;color:#8b949e;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.15rem;}' +
        '.sav-kpi-v{font-size:0.95rem;font-weight:800;color:#c9d1d9;}' +
        '.sav-kpi-v .f{color:#3fb950;}.sav-kpi-v .c{color:#f85149;}' +
        '.sav-kpi-m{font-size:0.62rem;color:#8b949e;margin-top:0.1rem;}' +
        '.sav-tbl-wrap{overflow-x:auto;}' +
        '.sav-tbl{width:100%;border-collapse:collapse;font-size:0.72rem;min-width:420px;}' +
        '.sav-tbl th{font-size:0.6rem;text-transform:uppercase;color:#f0883e;font-weight:700;padding:0.35rem 0.4rem;' +
            'border-bottom:1px solid rgba(255,255,255,0.12);text-align:center;white-space:nowrap;}' +
        '.sav-tbl td{padding:0.32rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.05);text-align:center;color:#c9d1d9;white-space:nowrap;}' +
        '.sav-tbl th.n,.sav-tbl td.n{text-align:left;}' +
        '.sav-tbl td.z{color:#4d5566;}' +
        '</style>';
    window.CRONOS_SAV_CSS = CSS;

    window.cronosSAvRenderTemporada = function (matches, filas, opts) {
        opts = opts || {};
        if (!window.cronosSAvExtraActivo()) return '';
        if (opts.categoria && !window.cronosSAvCategoriaPermite(opts.categoria)) return '';
        var tot = window.cronosSAvAcumulaEquipo(matches);
        if (!tot.partidos) return '';
        var p = tot.partidos;

        var kpi = function (mt) {
            var b = tot[mt.id];
            if (mt.total) {
                return '<div class="sav-kpi"><div class="sav-kpi-n">' + _eH(mt.nombre) + '</div>' +
                    '<div class="sav-kpi-v">' + b.total + '</div>' +
                    '<div class="sav-kpi-m">media ' + _media(b.total, p) + ' / partido</div></div>';
            }
            return '<div class="sav-kpi"><div class="sav-kpi-n">' + _eH(mt.nombre) + '</div>' +
                '<div class="sav-kpi-v"><span class="f" title="' + _eH(mt.fav) + '">' + b.favor + '</span>' +
                ' <span style="color:#4d5566;">/</span> ' +
                '<span class="c" title="' + _eH(mt.con) + '">' + b.contra + '</span></div>' +
                '<div class="sav-kpi-m">' + _eH(mt.fav.toLowerCase()) + ' / ' + _eH(mt.con.toLowerCase()) +
                ' · media ' + _media(b.favor, p) + ' / ' + _media(b.contra, p) + '</div></div>';
        };

        // Sólo los jugadores con algo registrado: una tabla de 25 filas a cero
        // no dice nada, y la plantilla entera ya está en la tabla de arriba.
        var conDato = (Array.isArray(filas) ? filas : []).filter(function (f) {
            var s = f && f.sav;
            if (!s) return false;
            for (var i = 0; i < CLAVES.length; i++) if (Number(s[CLAVES[i]])) return true;
            return false;
        });
        var cel = function (n) { n = Number(n) || 0; return '<td' + (n ? '' : ' class="z"') + '>' + n + '</td>'; };
        var tabla = conDato.length
            ? '<div class="sav-tbl-wrap"><table class="sav-tbl"><thead><tr>' +
                '<th class="n">Jugador</th>' +
                '<th title="Córners a favor">Cór F</th><th title="Córners en contra">Cór C</th>' +
                '<th title="Faltas recibidas">Falt R</th><th title="Faltas cometidas">Falt C</th>' +
                '<th title="Centros al área">Centros</th>' +
                '<th title="Ocasiones de gol generadas">Ocas F</th><th title="Ocasiones concedidas">Ocas C</th>' +
              '</tr></thead><tbody>' +
              conDato.map(function (f) {
                  var s = f.sav;
                  return '<tr><td class="n"><span style="color:#8b949e;display:inline-block;min-width:1.4rem;">' +
                      _eH(f.number || '—') + '</span> ' + _eH(f.alias || 'Sin nombre') + '</td>' +
                      cel(s.cf) + cel(s.cc) + cel(s.ff) + cel(s.fc) + cel(s.ce) + cel(s.of) + cel(s.oc) + '</tr>';
              }).join('') +
              '</tbody></table></div>'
            : '<div class="sav-sub" style="margin:0;">Ninguna acción asignada todavía a un jugador concreto.</div>';

        return CSS +
            '<div class="sav-wrap" data-sav-temporada="1">' +
            '<div class="sav-tit">📈 Estadísticas avanzadas de la temporada</div>' +
            '<div class="sav-sub">En ' + p + ' partido' + (p === 1 ? '' : 's') + ' con registro · ' +
                'los totales incluyen las acciones sin jugador asignado</div>' +
            '<div class="sav-kpis">' + METRICAS.map(kpi).join('') + '</div>' +
            tabla +
            '</div>';
    };

    // ════════════════════════════════════════════════════════════════
    //  LÍNEAS DE TEXTO PARA LAS DESCARGAS (TXT del partido)
    // ════════════════════════════════════════════════════════════════
    window.cronosSAvLineasTxt = function (s, etiquetaDe) {
        if (!s) return [];
        var L = [];
        METRICAS.forEach(function (mt) {
            var b = s[mt.id] || {};
            if (mt.total) L.push(mt.nombre + ': ' + (Number(b.total) || 0));
            else L.push(mt.nombre + ': ' + mt.fav.toLowerCase() + ' ' + (Number(b.favor) || 0) +
                        ' · ' + mt.con.toLowerCase() + ' ' + (Number(b.contra) || 0));
        });
        var dorsales = Object.keys(s.porDorsal || {}).sort(function (a, b) {
            return (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99);
        });
        dorsales.forEach(function (d) {
            var x = window.cronosSAvDeJugador(s, d);
            L.push((typeof etiquetaDe === 'function' ? etiquetaDe(d) : '#' + d) +
                   '  ·  Cór ' + x.cf + '/' + x.cc + ' · Falt ' + x.ff + '/' + x.fc +
                   ' · Centros ' + x.ce + ' · Ocas ' + x.of + '/' + x.oc);
        });
        return L;
    };
})();

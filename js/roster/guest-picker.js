// ════════════════════════════════════════════════════════════════════
//  SELECTOR DE JUGADOR INVITADO (plazas de apoyo) — 2026-08-12
// ════════════════════════════════════════════════════════════════════
//  Requisito del autor: en una plaza de apoyo NO se teclea el nombre. Se
//  elige el equipo de origen (categoría + subcategoría) y después el jugador
//  de la lista de ese equipo, y al elegirlo se arrastra su ficha y su nombre.
//
//  ⚠️ SE PINTA SOBRE <body> Y NO DENTRO DE #setup-modal. openRosterManager
//  reescribe el innerHTML de #setup-modal entero: un selector metido ahí
//  desaparecería en cuanto la plantilla se repintara, que es justo lo que
//  hace este módulo al confirmar.
//
//  🔑 LA FICHA DE ORIGEN ES EL DATO, NO EL NOMBRE. Lo que hace que el
//  jugador cuente después en el acumulado de su categoría es
//  originPlayerId + originCategory + originSubcategory, no el texto que se
//  ve. Por eso el nombre queda de sólo lectura en la fila.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var OVERLAY_ID = 'cronos-guest-picker';
    var _equipos = null;      // caché de la lectura, por sesión de selector
    var _destino = -1;        // índice de la fila de la plantilla que se rellena
    var _modoActual = 'f7';   // modalidad del partido que se está creando

    function _eH(s) {
        if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : s);
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _cerrar() {
        var el = document.getElementById(OVERLAY_ID);
        if (el) el.remove();
    }
    window.cronosCloseGuestPicker = _cerrar;

    function _marco(interior) {
        _cerrar();
        var wrap = document.createElement('div');
        wrap.id = OVERLAY_ID;
        wrap.style.cssText =
            'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.72);' +
            'display:flex; align-items:center; justify-content:center; padding:1rem;';
        wrap.innerHTML =
            '<div style="background:var(--card,#161b22); border:1px solid rgba(210,168,255,0.35);' +
                 'border-radius:14px; width:min(94vw,620px); max-height:88vh; overflow-y:auto;' +
                 'padding:1.2rem; box-shadow:0 18px 50px rgba(0,0,0,0.6);">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.9rem;">' +
                    '<h3 style="margin:0; font-size:1.05rem; color:#d2a8ff;">🔍 Jugador de otra categoría</h3>' +
                    '<button onclick="cronosCloseGuestPicker()" style="background:none; border:none;' +
                        'color:var(--text-muted,#7d8590); font-size:1.3rem; cursor:pointer; line-height:1;">✕</button>' +
                '</div>' + interior +
            '</div>';
        // Cerrar al pulsar el fondo, no el contenido.
        wrap.addEventListener('click', function (e) { if (e.target === wrap) _cerrar(); });
        document.body.appendChild(wrap);
        return wrap;
    }

    function _aviso(txt, detalle) {
        _marco(
            '<div style="background:rgba(240,136,62,0.08); border:1px solid rgba(240,136,62,0.3);' +
                 'border-radius:10px; padding:1rem; font-size:0.85rem; color:#f0883e;">' +
                _eH(txt) +
                (detalle ? '<div style="margin-top:0.5rem; font-size:0.76rem; color:var(--text-muted,#7d8590);">'
                           + _eH(detalle) + '</div>' : '') +
            '</div>');
    }

    // ── Paso 1: elegir equipo de origen ─────────────────────────────────
    function _pasoEquipos() {
        var opciones = _equipos.map(function (t, i) {
            return '<button onclick="_cronosGuestPickTeam(' + i + ')" ' +
                'style="display:flex; justify-content:space-between; align-items:center; width:100%;' +
                       'text-align:left; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.09);' +
                       'border-radius:10px; padding:0.7rem 0.9rem; margin-bottom:0.45rem; cursor:pointer;' +
                       'color:var(--text,#fff); font-size:0.9rem; font-weight:600;">' +
                '<span>' + _eH(t.teamLabel) + '</span>' +
                '<span style="font-size:0.7rem; font-weight:700; color:#3fb950;' +
                      'background:rgba(63,185,80,0.15); border-radius:20px; padding:2px 9px;">' +
                    t.players.length + ' jugadores</span>' +
            '</button>';
        }).join('');

        _marco(
            '<p style="font-size:0.8rem; color:var(--text-muted,#7d8590); margin:0 0 0.8rem;">' +
                'Paso 1 de 2 · Elige el equipo del que sube el jugador.</p>' +
            opciones);
    }

    // ── Paso 2: elegir jugador ──────────────────────────────────────────
    window._cronosGuestPickTeam = function (idx) {
        var t = _equipos[idx];
        if (!t) return;
        var filas = t.players.map(function (p, j) {
            return '<button onclick="_cronosGuestPickPlayer(' + idx + ',' + j + ')" ' +
                'style="display:flex; align-items:center; gap:0.7rem; width:100%; text-align:left;' +
                       'background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.09);' +
                       'border-radius:9px; padding:0.55rem 0.8rem; margin-bottom:0.35rem; cursor:pointer;' +
                       'color:var(--text,#fff); font-size:0.86rem;">' +
                '<span style="font-weight:900; color:#58a6ff; min-width:26px;">' + _eH(p.dorsal || '—') + '</span>' +
                '<span style="flex:1;">' + _eH(p.alias || p.nombre || 'Sin nombre') + '</span>' +
                // Aviso de formato distinto: convocar a un alevín (F7) para un
                // partido de F11 es legítimo y el autor lo pidió expresamente,
                // pero el entrenador tiene que VERLO antes de pulsar.
                (p.modalidad && p.modalidad !== _modoActual
                    ? '<span title="Su plantilla es de ' + (p.modalidad === 'f7' ? 'Fútbol 7' : 'Fútbol 11') +
                            ' y este partido es de ' + (_modoActual === 'f7' ? 'Fútbol 7' : 'Fútbol 11') + '"' +
                       ' style="font-size:0.6rem; font-weight:800; color:#f0883e;' +
                       'background:rgba(240,136,62,0.12); border:1px solid rgba(240,136,62,0.3);' +
                       'border-radius:5px; padding:1px 5px;">' + (p.modalidad === 'f7' ? 'F7' : 'F11') + '</span>'
                    : '') +
                '<span style="font-size:0.66rem; font-weight:700; color:#d2a8ff;' +
                      'background:rgba(210,168,255,0.12); border-radius:5px; padding:2px 6px;">' +
                    _eH(p.ficha || '—') + '</span>' +
            '</button>';
        }).join('');

        _marco(
            '<p style="font-size:0.8rem; color:var(--text-muted,#7d8590); margin:0 0 0.8rem;">' +
                'Paso 2 de 2 · <strong style="color:#d2a8ff;">' + _eH(t.teamLabel) + '</strong> · ' +
                'elige al jugador. Subirá conservando su ficha.</p>' +
            filas +
            '<button onclick="_cronosGuestBack()" style="margin-top:0.6rem; background:none; border:none;' +
                   'color:var(--text-muted,#7d8590); font-size:0.8rem; cursor:pointer;">← Cambiar de equipo</button>');
    };

    window._cronosGuestBack = function () { _pasoEquipos(); };

    // ── Confirmación: escribir la fila ──────────────────────────────────
    window._cronosGuestPickPlayer = function (ti, pi) {
        var t = _equipos[ti];
        var p = t && t.players[pi];
        if (!t || !p) return;

        var mode = (typeof window.cronosActiveMode === 'function') ? window.cronosActiveMode() : 'f7';
        var roster = window.cronosPlantillaAmbas();   // v580 · la del EQUIPO abierto

        // Se vuelca la tabla ANTES de tocar nada: si no, lo tecleado en las
        // filas base desde el último guardado se perdería al repintar.
        var actuales = (typeof window._cronosHarvestRosterRows === 'function')
            ? window._cronosHarvestRosterRows() : [];
        if (actuales.length) roster[mode] = actuales;

        if (_destino < 0 || _destino >= roster[mode].length) { _cerrar(); return; }

        // ⚠️ EL MISMO JUGADOR NO PUEDE OCUPAR DOS PLAZAS. Sin esto, sus
        // minutos se contarían dos veces en el acumulado de su categoría.
        var repetido = roster[mode].some(function (r, i) {
            return i !== _destino && r && r.isGuest && r.originPlayerId === p.ficha
                   && r.originTeamId === t.teamId;
        });
        if (repetido) {
            if (typeof showToast === 'function') {
                showToast('⚠️ ' + (p.alias || p.nombre) + ' ya ocupa otra plaza de apoyo.', 3200);
            }
            _cerrar();
            return;
        }

        // ── Dorsal: se ajusta si choca, la FICHA jamás ────────────────────
        // 🔑 EL AUTOR LO FIJÓ ASÍ (2026-08-12): "el código identificativo de
        // origen debe prevalecer inalterable... el dorsal en la plantilla de
        // acogida puede gestionarse para evitar numeración duplicada".
        // Un invitado que llega con el 7 y se encuentra al 7 del equipo de
        // acogida rompería dos cosas: la ficha del partido (dos jugadores con
        // el mismo número) y el emparejamiento por dorsal del que todavía
        // dependen los informes antiguos.
        var suDorsal = String(p.dorsal || '').trim();
        var ocupados = Object.create(null);
        roster[mode].forEach(function (r, i) {
            if (i === _destino || !r) return;
            var n = String(r.number == null ? '' : r.number).trim();
            // Sólo cuenta como ocupado si la fila tiene jugador de verdad: las
            // filas base vacías traen dorsal 1..25 de relleno y, contándolas,
            // NINGÚN número quedaría libre nunca.
            if (n && (r.alias || r.name)) ocupados[n] = true;
        });
        var ajustado = false;
        if (!suDorsal || ocupados[suDorsal]) {
            var libre = '';
            for (var n = 1; n <= 99; n++) {
                if (!ocupados[String(n)]) { libre = String(n); break; }
            }
            if (libre) { suDorsal = libre; ajustado = true; }
        }

        roster[mode][_destino] = {
            // 🔑 LA FICHA DE ORIGEN SE COPIA TAL CUAL AL id DE LA FILA: es el
            // requisito literal del autor ("conservando estrictamente su ID de
            // origen"). openRosterManager tiene prohibido regenerarlo.
            id:                p.ficha || '',
            number:            suDorsal,
            name:              p.nombre || p.alias || '',
            surname:           '',
            alias:             p.alias || p.nombre || '',
            isSupport:         true,
            isGuest:           true,
            originTeamId:      t.teamId,
            originCategory:    t.category,
            originSubcategory: t.subcategory,
            originPlayerId:    p.ficha || ''
        };
        // v580 · el invitado entra en la plantilla DE ESTE EQUIPO. Antes caía
        // en la lista de la modalidad, que compartían todos los equipos de la
        // persona: el invitado del Alevín aparecía también en el otro equipo.
        window.cronosPlantillaGuardar(mode, roster[mode], { nube: false });
        _cerrar();
        if (typeof showToast === 'function') {
            showToast(ajustado
                ? '✅ ' + (p.alias || p.nombre) + ' (' + t.teamLabel + ') añadido con el dorsal ' +
                  suDorsal + ' — el ' + (p.dorsal || '—') + ' ya estaba ocupado. Su ficha ' +
                  (p.ficha || '') + ' no cambia.'
                : '✅ ' + (p.alias || p.nombre) + ' (' + t.teamLabel + ') añadido como apoyo',
                ajustado ? 5000 : 3000);
        }
        if (typeof openRosterManager === 'function') openRosterManager();
    };

    // ── Entrada ─────────────────────────────────────────────────────────
    window.cronosOpenGuestPicker = async function (rowIndex) {
        _destino = rowIndex;
        _marco('<div style="text-align:center; padding:1.5rem; color:var(--text-muted,#7d8590); font-size:0.85rem;">' +
               'Buscando equipos del club…</div>');

        if (typeof window.cronosFetchClubRosters !== 'function') {
            _aviso('El módulo de fichas de equipo no está cargado.',
                   'Recarga la página; si sigue igual, avisa a soporte.');
            return;
        }

        var mode = (typeof window.cronosActiveMode === 'function') ? window.cronosActiveMode() : 'f7';
        _modoActual = mode;
        window._cronosRosterFetchError = '';
        _equipos = await window.cronosFetchClubRosters(mode);

        if (!_equipos || !_equipos.length) {
            // 🔑 UN FALLO REAL NO SE DISFRAZA DE "no hay equipos". La lectura
            // traga sus errores para no romper la pantalla, pero si se los come
            // del todo el usuario reporta "no aparece nada" y se pierde una
            // ronda entera averiguando si es un permiso, la red o el filtro.
            // Aquí se enseña el motivo de verdad cuando lo hay.
            var err = window._cronosRosterFetchError;
            if (err) {
                _aviso('No se han podido leer las plantillas del club.',
                       'Error: ' + err + ' · Enséñale este mensaje a soporte.');
                return;
            }
            _aviso('No hay equipos disponibles para convocar.',
                   'Sólo se puede tirar de categorías POR DEBAJO de la tuya, o de una ' +
                   'subcategoría posterior dentro de la tuya (de Juvenil B se puede ' +
                   'llamar al Juvenil C, no al Juvenil A). ' +
                   'Además, cada entrenador tiene que haber pulsado GUARDAR PLANTILLA ' +
                   'al menos una vez para que su equipo aparezca aquí.');
            return;
        }
        _pasoEquipos();
    };
})();

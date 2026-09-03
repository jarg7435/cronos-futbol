// ══════════════════════════════════════════════════════════════════════
//  CHRONOS FUTBOL — SELECCION MULTIPLE REUTILIZABLE  (v669)
//
//  Encargo del autor (implementar.txt, 2026-09-03): casilla en cada fila,
//  "seleccionar todos" en la cabecera, boton dinamico "Eliminar
//  seleccionados (X)" y una confirmacion que diga CUANTOS registros se van
//  a borrar. Generalizable a cualquier listado con borrado.
//
//  ══════════════════════════════════════════════════════════════════
//  🔑🔑 ESTE MODULO NO BORRA NADA, Y ASI DEBE SEGUIR.
//
//  Se ocupa de la SELECCION y de la CONFIRMACION. El borrado lo pone
//  cada listado, con la funcion que YA tenia. No es purismo: las
//  pantallas de informes ocultan con claves DISTINTAS —"Mis Informes"
//  usa `uid` y el panel de Direccion usa `uid_rol`— y cada una lee con
//  la suya. Un motor que "unificara" el borrado tendria que elegir una,
//  y elegir mal significa ocultar con una clave y leer con otra: el
//  informe reaparece y no salta ningun error (la leccion de v637, que
//  esta escrita en reports-tab.js justo encima de esa linea).
//
//  Corolario para quien amplie esto: si tu listado no tiene todavia una
//  funcion de borrado que puedas llamar en bucle, la sacas de su boton
//  individual (partiendola en "preguntar" + "hacer"). No la reescribas
//  aqui.
//  ══════════════════════════════════════════════════════════════════
//
//  🔑 LA VERDAD DE LA SELECCION ES EL DOM, no un Set paralelo.
//  `document.querySelectorAll('.cms-chk-<grupo>:checked')`, igual que ya
//  hacian `sharedGetSelectedRecipients` (whatsapp-email.js) y
//  `updateBulkCount` (bulk-messaging.js). Estos listados se repintan al
//  filtrar, al cambiar de pestaña y al terminar un borrado: un Set
//  guardado aparte sobrevive al repintado y deja marcadas filas que ya
//  no existen — o peor, apunta a claves de OTRO equipo. Con el DOM como
//  fuente, un repintado limpia la seleccion por construccion.
//
//  ⚠️ `disabled` en el boton es SOLO cosmetico (leccion de v548): la
//  guarda de verdad esta dentro de `lanzar()`, que se planta si no hay
//  ni una clave marcada. Las dos cosas, no una.
//
//  Test: scripts/test_multi_select.js
// ══════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    if (window.cronosMS) return;

    // Registro de acciones por grupo. Las funciones no pueden viajar en un
    // atributo onclick, asi que el HTML solo lleva el nombre del grupo y el
    // indice de la accion, y aqui se resuelven.
    var _grupos = Object.create(null);

    function _esc(s) {
        return (typeof window.escapeAttr === 'function')
            ? window.escapeAttr(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                                        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // El nombre del grupo se incrusta en clases CSS y en atributos onclick:
    // si admitiera cualquier cosa, un nombre con comillas partiria el HTML.
    function _grupoValido(g) { return /^[A-Za-z0-9_-]{1,40}$/.test(String(g || '')); }

    function _toast(msg, ms) {
        if (typeof window.showToast === 'function') window.showToast(msg, ms || 3500);
    }

    // ── Registrar un listado ──────────────────────────────────────────
    //  acciones: [{ id, etiqueta, icono, tono:'suave'|'peligro',
    //               confirmar(claves) -> string|null,
    //               ejecutar(claves, progreso) -> {resumen, ok, fallos},
    //               alTerminar() }]
    //  Se llama ANTES de pintar. Reemplaza el registro anterior del grupo,
    //  que es lo correcto: al repintar, las acciones se vuelven a declarar.
    function registrar(grupo, acciones) {
        if (!_grupoValido(grupo)) {
            console.warn('[MultiSel] nombre de grupo invalido:', grupo);
            return false;
        }
        _grupos[grupo] = Array.isArray(acciones) ? acciones : [];
        return true;
    }

    // ── La casilla de una fila ────────────────────────────────────────
    //  ⚠️ stopPropagation OBLIGATORIO: estas filas son tarjetas con su
    //  propio onclick (desplegar el informe, abrir el hilo…). Sin esto,
    //  marcar la casilla desplegaria la tarjeta a la vez.
    function chk(grupo, clave, opts) {
        if (!_grupoValido(grupo)) return '';
        opts = opts || {};
        return '<input type="checkbox"' +
            ' class="cms-chk cms-chk-' + grupo + '"' +
            ' data-k="' + _esc(clave) + '"' +
            (opts.extra ? ' ' + opts.extra : '') +
            ' title="' + _esc(opts.titulo || 'Seleccionar') + '"' +
            ' onclick="event.stopPropagation();window.cronosMS.sync(\'' + grupo + '\')"' +
            ' style="width:17px;height:17px;cursor:pointer;accent-color:#58a6ff;flex-shrink:0;' +
            (opts.estilo || '') + '">';
    }

    // ── La barra de cabecera ──────────────────────────────────────────
    function barra(grupo, opts) {
        if (!_grupoValido(grupo)) return '';
        opts = opts || {};
        var acciones = _grupos[grupo] || [];
        var botones = acciones.map(function (a, i) {
            var peligro = a.tono === 'peligro';
            return '<button type="button" id="cms-btn-' + grupo + '-' + i + '"' +
                ' onclick="window.cronosMS.lanzar(\'' + grupo + '\',' + i + ')" disabled' +
                ' title="' + _esc(a.titulo || a.etiqueta || '') + '"' +
                ' style="background:' + (peligro ? 'rgba(139,0,0,0.18)' : 'rgba(255,88,88,0.10)') + ';' +
                'border:1px solid ' + (peligro ? 'rgba(255,88,88,0.55)' : 'rgba(255,88,88,0.30)') + ';' +
                'color:#ff5858;padding:0.34rem 0.75rem;border-radius:6px;font-size:0.73rem;' +
                'font-weight:700;cursor:pointer;opacity:0.4;transition:opacity 0.15s;white-space:nowrap;">' +
                (a.icono ? _esc(a.icono) + ' ' : '') +
                '<span id="cms-lbl-' + grupo + '-' + i + '">' + _esc(a.etiqueta || 'Eliminar seleccionados') + '</span>' +
                '</button>';
        }).join('');

        return '' +
        '<div id="cms-bar-' + grupo + '" class="cms-bar" style="display:flex;align-items:center;gap:0.75rem;' +
             'flex-wrap:wrap;padding:0.5rem 0.75rem;margin-bottom:0.7rem;border-radius:9px;' +
             'background:rgba(88,166,255,0.05);border:1px solid rgba(88,166,255,0.18);">' +
            '<label style="display:flex;align-items:center;gap:0.45rem;cursor:pointer;' +
                   'font-size:0.74rem;font-weight:700;color:#58a6ff;user-select:none;">' +
                '<input type="checkbox" id="cms-all-' + grupo + '"' +
                    ' onclick="window.cronosMS.todos(\'' + grupo + '\',this.checked)"' +
                    ' style="width:17px;height:17px;cursor:pointer;accent-color:#58a6ff;">' +
                '<span id="cms-alltxt-' + grupo + '">Seleccionar todos</span>' +
            '</label>' +
            '<span id="cms-cnt-' + grupo + '" style="font-size:0.72rem;color:var(--text-muted);">' +
                'Ninguno seleccionado' +
            '</span>' +
            '<div style="flex:1;"></div>' +
            botones +
        '</div>';
    }

    // ── Lectura: SIEMPRE del DOM ──────────────────────────────────────
    function _casillas(grupo) {
        return Array.prototype.slice.call(
            document.querySelectorAll('.cms-chk-' + grupo));
    }
    function claves(grupo) {
        return _casillas(grupo).filter(function (c) { return c.checked; })
                               .map(function (c) { return c.dataset.k; });
    }

    // ── Repintar contador y botones ───────────────────────────────────
    function sync(grupo) {
        var todas = _casillas(grupo);
        var n = todas.filter(function (c) { return c.checked; }).length;
        var total = todas.length;

        var cnt = document.getElementById('cms-cnt-' + grupo);
        if (cnt) {
            cnt.textContent = n === 0
                ? 'Ninguno seleccionado'
                : n + ' de ' + total + ' seleccionado' + (n === 1 ? '' : 's');
        }

        // La casilla maestra refleja el estado real, incluido el intermedio:
        // marcada a medias no puede verse igual que marcada del todo.
        var all = document.getElementById('cms-all-' + grupo);
        if (all) {
            all.checked = total > 0 && n === total;
            all.indeterminate = n > 0 && n < total;
        }
        var alltxt = document.getElementById('cms-alltxt-' + grupo);
        if (alltxt) alltxt.textContent = (total > 0 && n === total) ? 'Deseleccionar todos' : 'Seleccionar todos';

        (_grupos[grupo] || []).forEach(function (a, i) {
            var b = document.getElementById('cms-btn-' + grupo + '-' + i);
            if (!b) return;
            b.disabled = (n === 0);
            b.style.opacity = n === 0 ? '0.4' : '1';
            b.style.cursor = n === 0 ? 'not-allowed' : 'pointer';
            var lbl = document.getElementById('cms-lbl-' + grupo + '-' + i);
            if (lbl) {
                lbl.textContent = (a.etiqueta || 'Eliminar seleccionados') + (n ? ' (' + n + ')' : '');
            }
        });
        return n;
    }

    // ── Seleccionar / deseleccionar todo LO QUE HAY PINTADO ───────────
    //  ⚠️ Solo lo pintado, a proposito. Si el listado esta filtrado o
    //  plegado por categorias, "todos" tiene que significar "todos los que
    //  estoy viendo": marcar filas que el usuario no tiene delante y luego
    //  borrarlas seria exactamente lo que nadie espera de un boton asi.
    function todos(grupo, valor) {
        _casillas(grupo).forEach(function (c) { c.checked = !!valor; });
        return sync(grupo);
    }

    function limpiar(grupo) { return todos(grupo, false); }

    // ── Ejecutar una accion sobre lo seleccionado ─────────────────────
    async function lanzar(grupo, idx) {
        var acciones = _grupos[grupo] || [];
        var a = acciones[idx];
        if (!a || typeof a.ejecutar !== 'function') {
            _toast('⚠️ Esta acción no está disponible', 3000);
            return;
        }

        // 🔑 La guarda de verdad. El `disabled` del boton es decoracion.
        var ks = claves(grupo);
        if (!ks.length) { _toast('Marca al menos un elemento', 2500); return; }

        // La confirmacion la REDACTA EL LISTADO, porque solo el sabe que
        // esta contando: 3 tarjetas de partido pueden ser 42 documentos de
        // jugador, y la ventana tiene que decir la verdad de lo que borra.
        //
        // El valor devuelto decide:
        //   string  -> se muestra en un confirm() y hay que aceptarlo
        //   null/false -> el listado aborta (ya dijo lo que tuviera que decir)
        //   true    -> el listado YA ha preguntado por su cuenta; no se
        //              vuelve a preguntar. Es para las acciones que necesitan
        //              un ritual mas duro que un confirm —el borrado
        //              permanente pide teclear BORRAR—, que si no acabarian
        //              encadenando tres ventanas seguidas.
        var texto = (typeof a.confirmar === 'function')
            ? a.confirmar(ks)
            : ('¿Eliminar ' + ks.length + ' elemento' + (ks.length === 1 ? '' : 's') + '?');
        if (texto === null || texto === false || texto === undefined) return;
        if (texto !== true && !window.confirm(texto)) return;

        var haySpinner = typeof window.showSpinner === 'function';
        var progreso = function (hechos, tot) {
            if (haySpinner) window.showSpinner('Procesando ' + hechos + ' de ' + tot + '…');
        };
        if (haySpinner) window.showSpinner('Procesando 0 de ' + ks.length + '…');

        var r;
        try {
            r = await a.ejecutar(ks, progreso);
        } catch (e) {
            if (typeof window.hideSpinner === 'function') window.hideSpinner();
            console.error('[MultiSel] fallo en ' + grupo + '/' + (a.id || idx) + ':', e);
            _toast('⚠️ Error: ' + (e && e.message ? e.message : e), 5000);
            return;
        }
        if (typeof window.hideSpinner === 'function') window.hideSpinner();

        // ⚠️ EL RESUMEN LO DA QUIEN EJECUTA, no este modulo. Un motor que
        // anunciara "N borrados" contando lo SELECCIONADO mentiria en cuanto
        // uno fallara por permisos — que es justo lo que pasa al purgar
        // partidos de otro entrenador (ver cronosResumenPurga).
        if (r && r.resumen) _toast(r.resumen, 6000);

        if (typeof a.alTerminar === 'function') { try { await a.alTerminar(r); } catch (_) {} }
        sync(grupo);
    }

    // ── Utilidad para los listados: recorrer con tope de concurrencia ──
    //  17 partidos x 14 jugadores son ~240 escrituras. Soltarlas todas de
    //  golpe con Promise.all castiga al movil y a la cuota; de una en una
    //  es eterno. Se va por tandas y se informa del avance.
    async function enTandas(items, tam, fn, progreso) {
        var hechos = 0, res = [];
        var paso = Math.max(1, tam | 0);
        for (var i = 0; i < items.length; i += paso) {
            var tanda = items.slice(i, i + paso);
            var out = await Promise.all(tanda.map(function (it) { return fn(it); }));
            res = res.concat(out);
            hechos += tanda.length;
            if (typeof progreso === 'function') progreso(hechos, items.length);
        }
        return res;
    }

    window.cronosMS = {
        registrar: registrar,
        chk: chk,
        barra: barra,
        claves: claves,
        sync: sync,
        todos: todos,
        limpiar: limpiar,
        lanzar: lanzar,
        enTandas: enTandas,
    };
})();

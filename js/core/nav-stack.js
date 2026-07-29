// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — nav-stack.js
//  Pila de navegación única para todos los paneles.
// ════════════════════════════════════════════════════════════════════
//
//  POR QUÉ EXISTE
//  Todas las pantallas de la app se dibujan en el MISMO contenedor
//  (#setup-modal) sobrescribiendo su innerHTML — 38 sitios en 19 archivos.
//  La pantalla anterior se DESTRUYE al pintar la siguiente, así que "volver"
//  no podía existir: sólo podía simularse cableando un destino fijo en cada
//  botón. Resultado medido antes de este módulo: 34 botones "Volver" con 14
//  destinos distintos, y 11 pantallas con destino fijo pese a tener VARIAS
//  vías de entrada — o sea que al menos una vía siempre acababa en una
//  pantalla por la que el usuario no había pasado.
//
//  QUÉ GUARDA LA PILA
//  Descriptores `{fn, args}`, NO nodos del DOM. Volver = volver a INVOCAR la
//  función anterior, que se repinta sola. Se descartó guardar el innerHTML y
//  restaurarlo: sería instantáneo y conservaría formularios a medio rellenar,
//  pero devolvería datos caducados y estado interno incoherente.
//
//  🔑 CÓMO SE MIGRA UNA PANTALLA (dos líneas, y sin tocar ningún onclick)
//    1. Primera sentencia de la función:  navScreen('nombreDeLaFuncion', ...)
//       — o navRootScreen(...) si es la raíz de un panel.
//    2. Su botón "Volver" pasa a ser  navBack()  y su ✕ pasa a ser navExit().
//
//  🔑 POR QUÉ LA AUTO-REGISTRACIÓN HACE SEGURA LA MIGRACIÓN PARCIAL
//  Como es la PROPIA pantalla la que se registra, da igual cómo se llegue a
//  ella: por navTo, por un onclick antiguo o por código. Una pantalla aún sin
//  migrar que llame directamente a `openSetupModal()` deja la pila coherente,
//  porque openSetupModal se declara RAÍZ y al pintarse la resetea. Sin esto,
//  migrar a medias dejaría la pila describiendo una pantalla que ya no está y
//  el primer navBack saltaría a un sitio equivocado — el mismo bug que
//  venimos a arreglar, pero peor.
// ════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var MAX_DEPTH = 25;
    var _stack = [];
    // Mientras navBack repinta la pantalla anterior, su navScreen() debe ser
    // un NO-OP: ya está en la pila, y volver a apilarla haría que "volver"
    // nunca avanzase hacia atrás (se quedaría en bucle en la misma pantalla).
    var _restoring = false;

    function _resolve(name) {
        var f = window[name];
        return (typeof f === 'function') ? f : null;
    }

    function _sameArgs(a, b) {
        try { return JSON.stringify(a || []) === JSON.stringify(b || []); }
        catch (e) { return false; }   // args no serializables: trátalos como distintos
    }

    // ── Registro de una pantalla normal ──────────────────────────────
    // `args` son los que hay que repetir para volver a pintarla igual.
    window.navScreen = function(name /*, ...args */) {
        if (_restoring) return;
        var args = Array.prototype.slice.call(arguments, 1);
        var top = _stack[_stack.length - 1];
        if (top && top.fn === name) {
            top.args = args;            // re-render de la misma pantalla: actualiza, no apila
            return;
        }
        _stack.push({ fn: name, args: args });
        if (_stack.length > MAX_DEPTH) _stack.shift();
    };

    // ── Registro de la RAÍZ de un panel ──────────────────────────────
    // Resetea la pila: desde una raíz no se vuelve atrás, se sale.
    window.navRootScreen = function(name /*, ...args */) {
        if (_restoring) return;
        var args = Array.prototype.slice.call(arguments, 1);
        _stack = [{ fn: name, args: args }];
    };

    // ── Navegar a una pantalla ───────────────────────────────────────
    // Azúcar para los onclick. No es obligatorio: como las pantallas se
    // auto-registran, llamarlas directamente también funciona.
    window.navTo = function(name /*, ...args */) {
        var f = _resolve(name);
        var args = Array.prototype.slice.call(arguments, 1);
        if (!f) {
            if (typeof showToast === 'function') showToast('⚠️ Pantalla no disponible', 3000);
            return;
        }
        return f.apply(window, args);
    };

    // ── Volver exactamente por donde se vino ─────────────────────────
    window.navBack = function() {
        if (_stack.length <= 1) return window.navExit();
        _stack.pop();
        var prev = _stack[_stack.length - 1];
        var f = _resolve(prev.fn);
        if (!f) return window.navExit();   // la pantalla anterior ya no existe
        _restoring = true;
        try {
            return f.apply(window, prev.args || []);
        } finally {
            _restoring = false;
        }
    };

    // ── Repintar la pantalla ACTUAL con sus mismos argumentos ────────
    // Para los refrescos de después de una acción ("guardar y recargar la
    // lista"). Antes cada pantalla se refrescaba llamándose a sí misma A PELO,
    // y si la función llevaba argumentos había que acordarse de repetirlos: en
    // el panel del Admin de Club había DIEZ refrescos escritos como
    // `openClubAdminPanel()` SIN el clubId, lo que devolvía al SuperAdmin al
    // selector de clubes después de cada acción. navReload() reutiliza los
    // argumentos guardados en la pila, así que no se pueden olvidar.
    window.navReload = function() {
        var top = _stack[_stack.length - 1];
        if (!top) return;
        var f = _resolve(top.fn);
        if (!f) return;
        _restoring = true;                 // repintar no debe volver a apilar
        try {
            return f.apply(window, top.args || []);
        } finally {
            _restoring = false;
        }
    };

    // ── Salir del panel: vacía la pila y cierra el contenedor ────────
    window.navExit = function() {
        _stack = [];
        var el = document.getElementById('setup-modal');
        if (el) el.style.display = 'none';
    };

    // ── Salir del ÁREA DE TRABAJO y volver al selector de roles ──────
    // POR QUÉ EXISTE (reportado DOS veces por el autor probando en navegador):
    // navExit() sólo oculta #setup-modal, y debajo queda lo que hubiera. En el
    // panel del Entrenador debajo está la pantalla del partido (#main-container),
    // así que "cerrar" el modal te dejaba mirando el campo de fútbol, atrapado
    // en el partido. Y navBack() tampoco vale para eso: con la pila en un solo
    // nivel cae en navExit() y reproduce el mismo síntoma.
    // Esta salida oculta TAMBIÉN los contenedores del campo y pinta el selector
    // de roles. Es el mismo procedimiento que saGoBackToRoles (el "⏻ Salir" del
    // SuperAdmin), que ya lo hacía bien desde antes de la pila.
    // ⚠️ NO DESTRUYE EL PARTIDO: #main-container se OCULTA, no se vacía, así que
    // jugadores, cronómetro y goles se conservan. Se recupera con el botón
    // "🔄 RECUPERAR PARTIDO" del modal de setup.
    window.navExitToRoles = function() {
        var show = (typeof window.showRoleSelector === 'function')  ? window.showRoleSelector
                 : (typeof window.showRoleSelection === 'function') ? window.showRoleSelection
                 : null;
        // Sin selector NO se oculta nada: dejar la pantalla en negro sería peor
        // que el defecto que venimos a arreglar. Se degrada a la salida de siempre.
        if (!show) return window.navExit();

        _stack = [];
        ['setup-modal', 'main-header', 'main-container'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        if (document.body) {
            document.body.style.background = '#0d1117';
            if (document.body.classList) document.body.classList.remove('locked');
        }
        show();
    };

    // ── Consultas (las usan las vistas y el guard) ────────────────────
    window.navCanGoBack = function() { return _stack.length > 1; };
    window.navDepth     = function() { return _stack.length; };
    window.navCurrent   = function() {
        var top = _stack[_stack.length - 1];
        return top ? top.fn : null;
    };
    // Sólo para diagnóstico y tests: copia, nunca la pila real.
    window._navTrail = function() { return _stack.map(function(e) { return e.fn; }); };
    window._navReset = function() { _stack = []; };
})();

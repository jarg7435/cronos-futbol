// ══════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL · v545 — LA CASILLA DEL RGPD, FIJA EN EL REGISTRO
//
//  ⚠️ TERCERA DESVIACIÓN DELIBERADA RESPECTO A PRODUCCIÓN, declarada como las
//  otras dos (el sello de versión y el respaldo del `onsubmit`). La pide el
//  autor por escrito el 2026-08-16: *"garantiza que al pulsar REGISTRARSE el
//  checkbox se pinte y se quede fijo sin desaparecer jamás"*.
//
//  🔑🔑🔑 QUÉ PASABA DE VERDAD, Y NO ERA `display`:
//  `#auth-screen` tiene `max-height:100dvh; overflow-y:auto` y la tarjeta va
//  centrada. En ENTRAR el formulario es corto y cabe entero. Al pasar a
//  REGISTRARSE se despliegan el selector de rol, el club, la contraseña y su
//  confirmación: la tarjeta CRECE y la casilla —que vive al final, pegada al
//  botón— se va POR DEBAJO del área visible. En una pantalla alta cabe (por
//  eso en producción "funciona"); en un iPad, no. De ahí "aparece un segundo
//  y desaparece" y "se desposiciona". No había ningún script ocultándola:
//  se salía de la pantalla.
//
//  Por eso aquí hay DOS cosas, y ninguna es un parche de red:
//    1. Se AVISA de que hay que bajar, con un recordatorio al pie que sólo
//       sale si la casilla está fuera de la vista y sin marcar. Al pulsarlo,
//       lleva hasta ella.
//    2. Un vigilante barato REPONE la visibilidad si algo llegara a ocultarla
//       mientras el registro está a la vista. Es la garantía que pidió.
//
//  ⚠️ LO QUE ESTE FICHERO NO HACE, Y NO PUEDE HACER NUNCA:
//    · no oculta la casilla en ningún caso (sólo repone);
//    · no toca `style.css` ni usa `position:sticky` (capa retirada en v501);
//    · no recarga la página (fue el defecto de v541);
//    · no espera promesas de Firebase (fue el parche de v543);
//    · no mueve la casilla de sitio: sigue justo encima del botón.
//
//  ⚠️ VIVE EN UN FICHERO Y NO EN LÍNEA A PROPÓSITO. `index.html` no puede
//  llevar scripts inline dentro del bloque de acceso —cada uno de los que
//  hubo allí acabó siendo una capa— y hay un guard que lo prohíbe:
//  test_consentimiento_visible_en_registro.js. Se puso rojo cuando lo escribí
//  ahí, y tenía razón.
//
//  Guard: scripts/test_paridad_arranque_produccion.js (parte 2b)
// ══════════════════════════════════════════════════════════════════

(function () {
    var CONT = 'gdpr-consent-container';
    var recordatorio = null;

    // ¿Se está viendo el formulario de REGISTRO? Se mira lo que se ve
    // (`#role-container` desplegado), no una variable de estado: `_isLoginMode`
    // puede ir desincronizada si el módulo no ha evaluado todavía.
    function enRegistro() {
        var rc = document.getElementById('role-container');
        var as = document.getElementById('auth-screen');
        return !!rc && rc.style.display === 'block' &&
               !!as && as.style.display !== 'none';
    }

    // 1 · GARANTÍA: si se ve el registro, la casilla se ve.
    function repon() {
        if (!enRegistro()) return null;
        var g = document.getElementById(CONT);
        if (!g) return null;
        var cs = window.getComputedStyle ? window.getComputedStyle(g) : null;
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) {
            g.style.setProperty('display', 'block', 'important');
            g.style.setProperty('visibility', 'visible', 'important');
        }
        return g;
    }

    // 2 · Si queda fuera de la vista y sin marcar, se avisa con un botón que
    //     lleva hasta ella. Sin esto el usuario no sabe que existe: es
    //     exactamente lo que estaba pasando.
    function avisaSiFuera() {
        var g = repon();
        var chk = document.getElementById('gdpr-consent');
        if (!g || !chk) { quita(); return; }
        if (chk.checked) { quita(); return; }
        var r = g.getBoundingClientRect();
        var alto = window.innerHeight || document.documentElement.clientHeight;
        var fuera = r.top >= alto || r.bottom <= 0;
        if (!fuera) { quita(); return; }
        if (recordatorio) return;
        recordatorio = document.createElement('button');
        recordatorio.type = 'button';
        recordatorio.id = 'cronos-aviso-rgpd';
        recordatorio.textContent = '⬇️ Falta aceptar la Política de Privacidad';
        recordatorio.style.cssText =
            'position:fixed;left:50%;transform:translateX(-50%);' +
            'bottom:calc(10px + env(safe-area-inset-bottom, 0px));z-index:2147482000;' +
            'background:#58a6ff;color:#0a0e14;border:none;border-radius:999px;' +
            'padding:9px 16px;font-size:0.78rem;font-weight:800;cursor:pointer;' +
            'box-shadow:0 3px 14px rgba(0,0,0,0.4);max-width:92vw;';
        recordatorio.addEventListener('click', function () {
            var el = document.getElementById(CONT);
            if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        });
        document.body.appendChild(recordatorio);
    }

    function quita() {
        if (recordatorio) {
            try { recordatorio.remove(); } catch (e) {}
            recordatorio = null;
        }
    }

    function tick() { if (enRegistro()) avisaSiFuera(); else quita(); }

    // Barato y sin efectos: sólo mira, y sólo repone.
    setInterval(tick, 400);
    document.addEventListener('click', function () { setTimeout(tick, 60); }, true);
    window.addEventListener('resize', tick);
    window.addEventListener('scroll', tick, true);
})();

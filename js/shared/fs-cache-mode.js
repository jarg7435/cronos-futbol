// ══════════════════════════════════════════════════════════════════════
//  🔴🔴🔴 v721 · UNA CUENTA POR CACHÉ DE FIRESTORE
//  js/shared/fs-cache-mode.js
// ══════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-15, capturas 10450-10451 e
//  IMG_4736-4738, sobre v720): tres partidos simultáneos y tres fallos que
//  parecían distintos —
//    · FUTureFEM C: «desconexión total entre el partido en directo y el
//      partido en vivo»: terminó el partido y el visor siguió EN VIVO, sin
//      sucesos ni cronómetro («Actualizado 13:51» mientras los otros dos
//      decían 14:01);
//    · Regional B: el partido se quedó clavado en el descanso y hubo que
//      usar «Recuperar Partido» (en Firestore: ni un solo suceso después de
//      las 13:52:20, en 13 minutos);
//    · el visor dejó de avisar con los partidos todavía en marcha.
//
//  📏 LO QUE LOS UNE, CONFIRMADO CON ÉL: en los dos aparatos había DOS
//  CUENTAS DISTINTAS abiertas a la vez en el mismo navegador —el Chrome del
//  PC (visor + entrenador de FUTureFEM) y el Safari del iPad (Prebenjamín A
//  + Regional B)—, que es justo lo que v720 acababa de hacer posible.
//
//  🔑🔑 LA CAUSA ESTÁ EN EL SDK DE FIRESTORE, NO EN NUESTRO CÓDIGO, y está
//  leída en su fuente (@firebase/firestore 4.6.3, la de firebase 10.12.2):
//  con `persistentMultipleTabManager` todas las pestañas del ORIGEN comparten
//  UNA caché en IndexedDB y UNA conexión, que lleva la pestaña «primaria».
//    1 · La primaria sólo envía las escrituras de SU usuario. Las de otra
//        cuenta se quedan en la cola de IndexedDB y se descartan con
//        «Ignoring mutation for non-active user» (shared_client_state.ts).
//        El `await setDoc` no resuelve NUNCA y no hay ningún error: el panel
//        sigue funcionando en local y el partido deja de existir para los
//        demás. Es literalmente la «desconexión total».
//    2 · Las lecturas y los oyentes de las demás pestañas los ejecuta la
//        primaria CON SUS CREDENCIALES: una cuenta lee con los permisos de
//        otra.
//    3 · La primaria no cede el turno por estar en segundo plano: sólo si
//        deja de renovarlo (canActAsPrimary, indexeddb_persistence.ts). De
//        ahí que cambiar de pestaña no lo arreglara.
//
//  🔑 EL ARREGLO: el caché en disco compartido sólo lo usa UNA cuenta a la
//  vez. Cualquier pestaña de OTRA cuenta arranca Firestore con caché en
//  MEMORIA, que es un cliente independiente: su propia conexión, sus
//  propias credenciales y sus escrituras salen siempre.
//    · Una sola cuenta en el navegador (el caso normal, y el de un
//      entrenador con la app y el visor abiertos) → NO CAMBIA NADA: caché en
//      disco y multipestaña, como hasta ahora.
//    · Lo que pierde la pestaña en memoria es poder RECARGAR sin cobertura
//      (no tiene copia en disco). Con cobertura funciona igual.
//
//  ⚠️ LA DECISIÓN SE TOMA ANTES DE CREAR LA INSTANCIA, y no puede tomarse
//  después: cambiar de caché en caliente exige `terminate()`, y eso es lo
//  que dejó la app entera sobre un cliente muerto en v467/v468. Si hace
//  falta cambiar (ver `usuario`), la pestaña se RECARGA — que desde v465
//  recupera su partido.
//
//  ⚠️ EL REGISTRO NO EMPIEZA POR `cronos_` A PROPÓSITO: así no lo aísla por
//  usuario la envoltura de v720 (js/core/local-uid.js) ni lo barre la purga
//  de la salida. Tiene que ser del NAVEGADOR: es justo la lista de quién hay.
//
//  Cubierto por scripts/test_una_cuenta_por_cache.js.
// ══════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (typeof window === 'undefined') return;
    if (window.cronosFsModo) return;   // cargado dos veces: no duplicar el latido

    var PREFIJO   = 'cronos-fs::pestana::';
    var AVISO     = 'cronos-fs::aviso-recarga';
    // Una pestaña cuenta como VIVA durante 30 min desde su último latido.
    // 🔑 Largo a propósito: Chrome espacia los temporizadores de una pestaña
    // oculta a uno por minuto, e iOS la congela entera. Equivocarse hacia
    // «viva» sólo le cuesta a la otra cuenta ir en memoria, que funciona;
    // equivocarse hacia «muerta» vuelve a mezclar dos cuentas en un caché.
    var VIVA_MS   = 30 * 60 * 1000;
    var LATIDO_MS = 60 * 1000;
    var BASURA_MS = 24 * 60 * 60 * 1000;

    // ⚠️ El id va en MEMORIA y no en sessionStorage: una pestaña abierta con
    // window.open (el visor) HEREDA una copia del sessionStorage de quien la
    // abre, y las dos acabarían con el mismo id.
    var tabId  = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    var estado = { modo: '', uid: '', desde: 0, uidDesde: 0 };
    var latido = null;

    function _ls() { try { return window.localStorage; } catch (e) { return null; } }

    // El uid de ESTA pestaña sin esperar a Firebase Auth. Desde v638 la sesión
    // vive en sessionStorage (`firebase:authUser:<apiKey>:<app>`), que es por
    // pestaña y está disponible en el primer instante.
    function uidDeSesion() {
        try {
            var ss = window.sessionStorage;
            for (var i = 0; i < ss.length; i++) {
                var k = ss.key(i);
                if (!k || k.indexOf('firebase:authUser:') !== 0) continue;
                var u = JSON.parse(ss.getItem(k) || 'null');
                if (u && u.uid) return String(u.uid);
            }
        } catch (e) {}
        return '';
    }

    // Las OTRAS pestañas con caché en disco que siguen vivas. De paso se barre
    // lo que lleve un día sin latir (una pestaña que se cerró sin `pagehide`).
    function otras() {
        var ls = _ls(); if (!ls) return [];
        var ahora = Date.now(), vivas = [], claves = [];
        try { claves = Object.keys(ls); } catch (e) { return []; }
        claves.forEach(function (k) {
            if (k.indexOf(PREFIJO) !== 0 || k === PREFIJO + tabId) return;
            var r = null;
            try { r = JSON.parse(ls.getItem(k) || 'null'); } catch (e) {}
            if (!r || !r.ts) { try { ls.removeItem(k); } catch (e) {} return; }
            var edad = ahora - Number(r.ts);
            if (edad > BASURA_MS) { try { ls.removeItem(k); } catch (e) {} return; }
            if (edad <= VIVA_MS) {
                r.tab = k.slice(PREFIJO.length);
                vivas.push(r);
            }
        });
        return vivas;
    }

    function escribe() {
        var ls = _ls(); if (!ls || estado.modo !== 'persistente') return;
        try {
            ls.setItem(PREFIJO + tabId, JSON.stringify({
                uid: estado.uid, desde: estado.desde, uidDesde: estado.uidDesde,
                ts: Date.now(), pagina: (location && location.pathname) || ''
            }));
        } catch (e) {}
    }
    function borra() {
        var ls = _ls(); if (!ls) return;
        try { ls.removeItem(PREFIJO + tabId); } catch (e) {}
    }

    // ¿Hay otra pestaña con caché en disco y con OTRA cuenta?
    //   · uid conocido  → choca quien tenga un uid conocido y distinto (una
    //     pestaña en la pantalla de acceso todavía no es de nadie);
    //   · uid NO conocido (pantalla de acceso) → choca cualquiera: aún no se
    //     sabe quién va a entrar, y ante la duda se va a memoria, que funciona.
    function choques(uid, lista) {
        return (lista || otras()).filter(function (o) {
            return uid ? (o.uid && o.uid !== uid) : true;
        });
    }

    // ── 1 · La decisión, ANTES de crear la instancia ──────────────────────
    function decide() {
        if (estado.modo) return estado.modo;
        var ahora = Date.now();
        estado.uid   = uidDeSesion();
        estado.desde = ahora;
        estado.uidDesde = estado.uid ? ahora : 0;
        var ls = _ls();
        if (!ls) { estado.modo = 'persistente'; return estado.modo; }   // sin almacén no hay a quién pisar
        var c = choques(estado.uid);
        if (c.length) {
            estado.modo = 'memoria';
            console.info('[v721] Otra cuenta usa el caché de Firestore de este navegador: ' +
                         'esta pestaña va con caché en MEMORIA (conexión y credenciales propias).');
        } else {
            estado.modo = 'persistente';
            escribe();
            _arrancaLatido();
        }
        _avisoTrasRecarga();
        return estado.modo;
    }

    // ── 2 · Cuando Firebase Auth dice quién es ─────────────────────────────
    //  Una pestaña en MEMORIA no tiene nada que vigilar. Una con caché en
    //  disco apunta su cuenta y comprueba si choca con otra.
    function usuario(uid) {
        uid = uid ? String(uid) : '';
        if (estado.modo !== 'persistente') { estado.uid = uid; return; }
        if (uid !== estado.uid) {
            estado.uid = uid;
            estado.uidDesde = uid ? Date.now() : 0;
            escribe();
        }
        revisa();
    }

    // 🔑 SI DOS PESTAÑAS CON CACHÉ EN DISCO LLEVAN CUENTAS DISTINTAS, CEDE LA
    // QUE HA LLEGADO MÁS TARDE A SU CUENTA (`uidDesde` más reciente; a
    // igualdad, el id mayor). Las dos aplican la misma regla, así que sólo
    // cede UNA y no hay ping-pong.
    //   · Pasa en la pantalla de acceso (una pestaña arrancó sola y, antes de
    //     entrar, se abrió otra con otra cuenta): cede la que acaba de entrar,
    //     que no tiene nada en marcha.
    //   · Y pasa si una pestaña congelada más de 30 min (iOS) se despierta y
    //     encuentra otra cuenta ocupando el caché: cede la recién llegada.
    function revisa() {
        if (estado.modo !== 'persistente' || !estado.uid) return false;
        var mios = { uidDesde: estado.uidDesde, tab: tabId };
        var cedo = choques(estado.uid).some(function (o) {
            var su = Number(o.uidDesde) || 0;
            if (!su) return false;                         // la otra aún no tiene cuenta
            if (su !== mios.uidDesde) return mios.uidDesde > su;
            return String(mios.tab) > String(o.tab);
        });
        if (!cedo) return false;
        console.warn('[v721] Otra cuenta ocupa el caché de Firestore de este navegador. ' +
                     'Esta pestaña se recarga para seguir con caché en memoria; si llevaba un ' +
                     'partido, lo recupera al volver.');
        cede();
        return true;
    }

    function cede() {
        _paraLatido();
        borra();
        estado.modo = 'cediendo';
        try { window.sessionStorage.setItem(AVISO, '1'); } catch (e) {}
        try { (window.cronosFsModo._recarga || function () { location.reload(); })(); } catch (e) {}
    }

    function _arrancaLatido() {
        if (latido) return;
        latido = setInterval(function () { escribe(); revisa(); }, LATIDO_MS);
    }
    function _paraLatido() { if (latido) { clearInterval(latido); latido = null; } }

    function _avisoTrasRecarga() {
        var hubo = false;
        try { hubo = window.sessionStorage.getItem(AVISO) === '1'; window.sessionStorage.removeItem(AVISO); } catch (e) {}
        if (!hubo) return;
        setTimeout(function () {
            if (typeof window.showToast === 'function') {
                window.showToast('🔄 Había otra cuenta abierta en este navegador: esta pestaña se ha ' +
                                 'recargado para que las dos transmitan por separado.', 7000);
            }
        }, 2500);
    }

    // ── Oyentes ────────────────────────────────────────────────────────────
    //  `storage` es lo que hace la detección INMEDIATA: salta en las demás
    //  pestañas en cuanto una escribe su registro, sin esperar al latido.
    try {
        window.addEventListener('storage', function (ev) {
            if (!ev || !ev.key || ev.key.indexOf(PREFIJO) !== 0) return;
            revisa();
        });
        window.addEventListener('pagehide', function () {
            if (estado.modo === 'persistente') borra();
        });
        window.addEventListener('pageshow', function (ev) {
            // Vuelve de la caché de navegación (bfcache): la instancia es la
            // misma, así que se vuelve a apuntar y se revisa.
            if (ev && ev.persisted && estado.modo === 'persistente') { escribe(); revisa(); }
        });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible' && estado.modo === 'persistente') {
                escribe(); revisa();
            }
        });
    } catch (e) {}

    window.cronosFsModo = {
        decide: decide,
        usuario: usuario,
        revisa: revisa,
        estado: function () {
            return { modo: estado.modo, uid: estado.uid, tab: tabId,
                     desde: estado.desde, uidDesde: estado.uidDesde };
        },
        // Para los guards: cambiar la recarga y los plazos sin tocar el navegador.
        _recarga: null,
        _PREFIJO: PREFIJO,
        _VIVA_MS: VIVA_MS,
    };
})();

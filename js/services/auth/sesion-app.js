// ══════════════════════════════════════════════════════════════════════════
//  📶 v867 · LA SESIÓN DE LA APP INSTALADA (Fase 2b de la pérdida de red)
//
//  Prueba de campo del 26-11 (VALIDACION §4): cerrada la app sin red, no
//  dejaba entrar. Desde v638 la sesión vive en sessionStorage y muere al
//  cerrar la app; volver a entrar exige contraseña, y eso exige red.
//
//  DECISIÓN DEL TITULAR (27-11):
//   · SÓLO en la app instalada (abierta desde el icono: display-mode
//     standalone, o navigator.standalone en iOS) la sesión aguanta cerrar y
//     abrir la app. En el navegador, como siempre: se cierra al salir.
//   · Límite: 12 h desde el último inicio de sesión con contraseña, o hasta
//     acabar el partido en curso de esa cuenta en el aparato.
//   · SuperAdmin excluido: su sesión sigue siendo de sessionStorage.
//
//  Funciones PURAS (sin Firebase ni DOM directos) para poder ejecutarlas en el
//  guard: scripts/test_abrir_y_empezar_sin_red.js. Las usa firebase-init.js.
//  Script CLÁSICO: tiene que existir antes de que el módulo firebase-init.js
//  (diferido) cree Auth.
// ══════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (typeof window === 'undefined' || window.cronosSesionApp) return;

    var LIMITE_MS = 12 * 60 * 60 * 1000;          // 12 h
    var RANURA_VIVA_MS = 3 * 60 * 60 * 1000;      // una ranura sin guardar en 3 h está abandonada
    var BASE = 'cronos_active_match_v2::';
    var FIN = 'cronos_active_match_v2_finished::';

    // ¿Se está ejecutando como app instalada? Falla hacia «navegador»: ante la
    // duda, la sesión corta de siempre.
    function esAppInstalada(w) {
        w = w || window;
        try {
            if (typeof w.matchMedia === 'function' &&
                w.matchMedia('(display-mode: standalone)').matches) return true;
        } catch (e) {}
        try { if (w.navigator && w.navigator.standalone === true) return true; } catch (e) {}
        return false;
    }

    // `ultimoInicio` = user.metadata.lastSignInTime (lo guarda Firebase con la
    // sesión, así que se sabe también sin red). Sin hora válida, caducada.
    function caducada(ultimoInicio, ahora, hayPartido) {
        var t = Date.parse(ultimoInicio || '');
        if (!isFinite(t) || t <= 0) return true;
        if ((Number(ahora) || Date.now()) - t <= LIMITE_MS) return false;
        return !hayPartido;
    }

    function esSuperAdmin(claims) {
        return !!(claims && claims.role === 'superadmin');
    }

    // v868 · Los claims del token GUARDADO, sin red (aunque haya caducado).
    // Sólo sirven para decidir dónde se guarda la sesión. null si no se lee.
    function claimsDelToken(jwt) {
        try {
            var p = String(jwt || '').split('.')[1];
            if (!p) return null;
            p = p.replace(/-/g, '+').replace(/_/g, '/');
            while (p.length % 4) p += '=';
            if (typeof atob !== 'function') return null;
            var o = JSON.parse(atob(p));
            return (o && typeof o === 'object') ? o : null;
        } catch (e) { return null; }
    }

    // ¿Hay en este aparato un partido EN CURSO de esta cuenta? Lee las claves
    // REALES de localStorage (`…::<id>@<uid>`, v720), porque al arrancar aún
    // no hay perfil cargado y el envoltorio de local-uid.js no sabe el uid.
    // `alm` = { claves(): string[], lee(k): string|null } (sustituible en el guard).
    function hayPartidoEnCurso(uid, alm, ahora) {
        if (!uid) return false;
        alm = alm || _almacenReal();
        if (!alm) return false;
        var ref = Number(ahora) || Date.now();
        var suf = '@' + uid;
        var claves = [];
        try { claves = alm.claves() || []; } catch (e) { return false; }
        for (var i = 0; i < claves.length; i++) {
            var k = claves[i];
            if (k.indexOf(BASE) !== 0 || k.slice(-suf.length) !== suf) continue;
            var id = k.slice(BASE.length, k.length - suf.length);
            if (alm.lee(FIN + id + suf)) continue;
            var st = null;
            try { st = JSON.parse(alm.lee(k) || 'null'); } catch (e) { st = null; }
            if (!st || !st.savedAt) continue;
            if (st.ownerUid && String(st.ownerUid) !== String(uid)) continue;
            if (st.matchPhase === 'finished' || st.matchPhase === 'idle') continue;
            var t = Date.parse(st.savedAt);
            if (!isFinite(t) || ref - t > RANURA_VIVA_MS) continue;
            return true;
        }
        return false;
    }

    function _almacenReal() {
        try {
            var ls = window.localStorage;
            var orig = window._cronosLocalOriginal;   // sin el envoltorio de v720
            return {
                claves: function () { return Object.keys(ls); },
                lee: function (k) { return orig ? orig.getItem.call(ls, k) : ls.getItem(k); },
            };
        } catch (e) { return null; }
    }

    window.cronosSesionApp = {
        LIMITE_MS: LIMITE_MS,
        esAppInstalada: esAppInstalada,
        caducada: caducada,
        esSuperAdmin: esSuperAdmin,
        claimsDelToken: claimsDelToken,
        hayPartidoEnCurso: hayPartidoEnCurso,
    };
})();

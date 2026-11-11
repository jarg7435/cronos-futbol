// ════════════════════════════════════════════════════════════════════
//  js/shared/suspension.js · ⏸️ v853 · BLOQUEO TEMPORAL DE USUARIO
//
//  Encargo del autor (2026-11-11): el SuperAdmin puede suspender
//  temporalmente el acceso de una cuenta (incumplimiento de condiciones).
//  Mientras dure, la persona no entra y se le dice por qué; sus datos,
//  informes, historiales y trabajos NO se tocan. Al reactivar, todo vuelve
//  exactamente como estaba.
//
//  🔑 LA MARCA VIVE APARTE: `cronos_suspensiones/{uid}`
//      { uid, email, activa, motivo, desde, por, historial[] }
//   · NO es `status: 'blocked'`: ese estado ya existe y descuenta la plaza
//     del club (syncUserChanges) y esconde al usuario de los paneles.
//   · No se escribe en `users/{uid}`, así que no salta ninguna Function ni
//     cambia nada que los paneles lean.
//   · Nunca se borra: reactivar es `activa: false`, y el historial queda.
//
//  🛡️ TRES CAPAS
//   1. Servidor: firestore.rules → isAuth() exige noSuspendido(). Sin la
//      app, una cuenta suspendida tampoco lee ni escribe nada.
//   2. Acceso: checkAuthorization (auth.js) llama a `leerPropia` ANTES de
//      leer users/{uid} y, si está suspendida, cierra la sesión y lo dice.
//   3. En vivo: `vigilar` escucha la propia marca; si el SA suspende a quien
//      está dentro, sale al momento con el mismo aviso.
//
//  ⚠️ LA SALIDA EN VIVO NO PURGA NADA LOCAL (a diferencia de logoutUser):
//  un partido a medias guardado en el dispositivo tiene que seguir ahí
//  cuando se levante la suspensión. Sólo suelta la plaza y cierra sesión.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var COL = 'cronos_suspensiones';
    var FS_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
    var AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
    var CLAVE_AVISO = 'cronos_aviso_suspension';

    var MENSAJE =
        '⏸️ Tu cuenta está suspendida temporalmente por el administrador de la plataforma, ' +
        'por lo que ahora no puedes acceder a la aplicación. Tus datos, informes e historial ' +
        'se conservan intactos y volverás a tenerlos en cuanto se levante la suspensión. ' +
        'Si crees que se trata de un error, contacta con el administrador.';

    function _db() { return window._cronos_auth && window._cronos_auth.db; }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    // Para meter un valor dentro de un onclick="…('…')".
    function _arg(s) { return _esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }

    // ── 2 · Al iniciar sesión ─────────────────────────────────────────
    // Devuelve los datos de la suspensión si está ACTIVA; null si no lo está
    // o si no se pudo leer. ⚠️ Un fallo de lectura NO deja fuera a nadie
    // (sin red no es una decisión del SA): la capa de las reglas sigue ahí.
    async function leerPropia(uid) {
        if (!uid) return null;
        try {
            var fs = await import(FS_URL);
            var db = _db();
            if (!db) return null;
            var snap = await fs.getDoc(fs.doc(db, COL, uid));
            if (!snap.exists()) return null;
            var d = snap.data() || {};
            return d.activa === true ? d : null;
        } catch (e) {
            console.warn('[suspensión] no se pudo comprobar la cuenta:', e && e.message);
            return null;
        }
    }

    // ── 3 · En vivo ────────────────────────────────────────────────────
    var _vigilado = { uid: '', off: null };
    async function vigilar(uid) {
        if (!uid || _vigilado.uid === uid) return;
        if (_vigilado.off) { try { _vigilado.off(); } catch (e) { /* ya cerrada */ } }
        _vigilado = { uid: uid, off: null };
        try {
            var fs = await import(FS_URL);
            var db = _db();
            if (!db || _vigilado.uid !== uid) return;
            _vigilado.off = fs.onSnapshot(fs.doc(db, COL, uid), function (snap) {
                if (snap.exists() && (snap.data() || {}).activa === true) expulsar();
            }, function (err) {
                console.warn('[suspensión] escucha cerrada:', err && err.message);
                if (_vigilado.uid === uid) _vigilado = { uid: '', off: null };
            });
        } catch (e) {
            console.warn('[suspensión] no se pudo escuchar:', e && e.message);
            if (_vigilado.uid === uid) _vigilado = { uid: '', off: null };
        }
    }

    var _saliendo = false;
    async function expulsar() {
        if (_saliendo) return;
        _saliendo = true;
        try { if (typeof window.cronosSesionLibera === 'function') await window.cronosSesionLibera(); }
        catch (e) { /* caducará sola */ }
        try { sessionStorage.setItem(CLAVE_AVISO, '1'); } catch (e) { /* sin almacenamiento */ }
        try {
            var fa = window._cronos_auth;
            if (fa && fa.auth) {
                var au = await import(AUTH_URL);
                await au.signOut(fa.auth).catch(function () {});
            }
        } catch (e) { /* la salida no puede quedarse colgada */ }
        location.reload();
    }

    // Tras la recarga de una expulsión, el aviso en la pantalla de acceso.
    function _avisoPendiente() {
        var hay = false;
        try { hay = sessionStorage.getItem(CLAVE_AVISO) === '1'; } catch (e) { return; }
        if (!hay) return;
        var n = 0;
        (function intenta() {
            var el = document.getElementById('auth-error');
            if (el && typeof window.showAuthError === 'function') {
                try { sessionStorage.removeItem(CLAVE_AVISO); } catch (e) { /* nada */ }
                window.showAuthError(MENSAJE);
                return;
            }
            if (++n < 40) setTimeout(intenta, 250);
        })();
    }

    // ── SuperAdmin ────────────────────────────────────────────────────
    window._saSuspendidos = window._saSuspendidos || {};

    async function cargarActivas() {
        try {
            var fs = await import(FS_URL);
            var db = _db();
            if (!db) return window._saSuspendidos;
            var snap = await fs.getDocs(fs.query(fs.collection(db, COL), fs.where('activa', '==', true)));
            var m = {};
            snap.forEach(function (d) { m[d.id] = d.data() || {}; });
            window._saSuspendidos = m;
        } catch (e) {
            console.warn('[suspensión] no se pudieron leer las suspensiones:', e && e.message);
        }
        return window._saSuspendidos;
    }

    function estaSuspendido(uid) {
        return !!(uid && window._saSuspendidos && window._saSuspendidos[uid]);
    }

    function _saEmail() {
        var me = window._cronosCurrentUser || {};
        return me.email || '';
    }

    function _repintar() {
        if (window._saSeccionActual === 'diagnostico' && typeof window._saDiagFiltrar === 'function') {
            window._saDiagFiltrar(window._saDiagFiltroActual || '');
        } else if (typeof window.saTab === 'function' && window._saSeccionActual) {
            window.saTab(window._saSeccionActual);
        }
    }

    async function _escribe(uid, email, activa, motivo) {
        var fs = await import(FS_URL);
        var db = _db();
        if (!db) throw new Error('Firebase no disponible');
        var ahora = new Date().toISOString();
        var datos = {
            uid: uid,
            email: email || '',
            activa: activa,
            historial: fs.arrayUnion({ accion: activa ? 'suspender' : 'reactivar',
                                       motivo: motivo || '', por: _saEmail(), en: ahora }),
        };
        if (activa) {
            datos.motivo = motivo || '';
            datos.desde = fs.serverTimestamp();
            datos.por = _saEmail();
        } else {
            datos.reactivadaEn = fs.serverTimestamp();
            datos.reactivadaPor = _saEmail();
        }
        await fs.setDoc(fs.doc(db, COL, uid), datos, { merge: true });
    }

    async function suspender(uid, email) {
        if (!uid) return false;
        var me = window._cronosCurrentUser || {};
        if (uid === me.uid) { alert('⚠️ No puedes suspender tu propia cuenta.'); return false; }
        var motivo = prompt(
            '⏸️ Suspender temporalmente el acceso de ' + (email || uid) + '\n\n' +
            '• No podrá entrar en la aplicación (si la tiene abierta, sale al momento).\n' +
            '• Sus datos, informes e historial NO se borran ni se modifican.\n' +
            '• Se reactiva desde este mismo botón cuando quieras.\n\n' +
            'Motivo (sólo lo ves tú, el usuario no):', 'Incumplimiento de las condiciones de uso');
        if (motivo === null) return false;
        motivo = String(motivo).trim();
        if (!motivo) { alert('⚠️ Indica un motivo para dejar constancia.'); return false; }
        try {
            await _escribe(uid, email, true, motivo);
            window._saSuspendidos[uid] = { uid: uid, email: email, activa: true, motivo: motivo, por: _saEmail() };
            if (typeof showToast === 'function') showToast('⏸️ Acceso suspendido: ' + (email || uid), 3500);
            _repintar();
            return true;
        } catch (e) {
            alert('⚠️ No se pudo suspender: ' + (e && e.message ? e.message : e));
            return false;
        }
    }

    async function reactivar(uid, email) {
        if (!uid) return false;
        if (!confirm('▶️ ¿Reactivar el acceso de ' + (email || uid) + '?\n\nVolverá a entrar con todo su contenido, igual que antes.')) return false;
        try {
            await _escribe(uid, email, false, '');
            delete window._saSuspendidos[uid];
            if (typeof showToast === 'function') showToast('▶️ Acceso reactivado: ' + (email || uid), 3500);
            _repintar();
            return true;
        } catch (e) {
            alert('⚠️ No se pudo reactivar: ' + (e && e.message ? e.message : e));
            return false;
        }
    }

    // Botón para las fichas del SA. Nunca sobre un SuperAdmin.
    function botonHtml(uid, email, role, compacto) {
        if (!uid || role === 'superadmin' || role === 'admin') return '';
        var susp = estaSuspendido(uid);
        var base = 'border-radius:7px;cursor:pointer;font-weight:700;' +
            (compacto ? 'padding:0.22rem 0.45rem;font-size:0.68rem;' : 'padding:0.32rem 0.7rem;font-size:0.72rem;');
        var accion = (susp ? 'CronosSuspension.reactivar' : 'CronosSuspension.suspender') +
            '(\'' + _arg(uid) + '\',\'' + _arg(email) + '\')';
        return susp
            ? '<button onclick="' + accion + '" title="Reactivar el acceso" style="' + base +
              'background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.45);color:#3fb950;">▶️' +
              (compacto ? '' : ' Reactivar acceso') + '</button>'
            : '<button onclick="' + accion + '" title="Suspender temporalmente el acceso" style="' + base +
              'background:rgba(210,153,34,0.14);border:1px solid rgba(210,153,34,0.45);color:#d29922;">⏸️' +
              (compacto ? '' : ' Suspender acceso') + '</button>';
    }

    function insigniaHtml(uid) {
        if (!estaSuspendido(uid)) return '';
        var d = window._saSuspendidos[uid] || {};
        return ' <span title="' + _esc('Motivo: ' + (d.motivo || '—') + (d.por ? ' · por ' + d.por : '')) +
            '" style="font-size:0.66rem;color:#d29922;font-weight:700;">⏸️ SUSPENDIDO TEMPORALMENTE</span>';
    }

    window.CronosSuspension = {
        MENSAJE: MENSAJE,
        COLECCION: COL,
        leerPropia: leerPropia,
        vigilar: vigilar,
        expulsar: expulsar,
        cargarActivas: cargarActivas,
        estaSuspendido: estaSuspendido,
        suspender: suspender,
        reactivar: reactivar,
        botonHtml: botonHtml,
        insigniaHtml: insigniaHtml,
    };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _avisoPendiente);
        else _avisoPendiente();
    }
})();

// ════════════════════════════════════════════════════════════════════
//  🔒 v699 · UNA PLAZA, UN DISPOSITIVO
//  js/services/auth/session-lock.js
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt): si una cuenta entra con un rol, otro
//  aparato no debe poder abrir ESE MISMO rol a la vez. Con varios roles sí
//  puede repartirse (Director en el PC y Entrenador en el móvil). El motivo
//  de fondo es la CONSISTENCIA: dos aparatos escribiendo el mismo partido se
//  pisan.
//
//  🔑 LA UNIDAD ES LA PLAZA, NO EL ROL (decisión del autor, y es la unidad
//  que ya usa el resto de la app desde v540/v547). Un entrenador con dos
//  equipos —un F7 y un F11, legítimo desde v537— lleva DOS plazas: puede
//  abrir el Alevín en el iPad y el Regional en el móvil, porque son partidos
//  distintos que no se pisan. Lo que se bloquea es la MISMA plaza.
//
//  🔑 QUÉ PASA EN EL CONFLICTO (lo eligió el autor): el segundo aparato no
//  entra a ciegas ni echa a nadie por su cuenta. Ve quién está dentro y desde
//  cuándo, y decide: cancelar o TOMAR EL CONTROL. Si lo toma, al primero se le
//  cierra esa plaza con un aviso y vuelve al selector de roles.
//
//  ⚠️⚠️ ESTO NO ES UN CONTROL DE SEGURIDAD, ES DE COORDINACIÓN. Quien tiene
//  la plaza sigue teniendo permiso en las reglas de Firestore; lo que se evita
//  es que DOS aparatos suyos escriban a la vez. Por eso, cuando la
//  comprobación no se puede hacer (sin cobertura en el campo, que es LO
//  NORMAL en un partido), se DEJA ENTRAR: dejar a un entrenador fuera de su
//  propio partido por no tener red sería mucho peor que el problema que se
//  quiere evitar. Un fail-open aquí es la decisión correcta, al revés que en
//  los `!dato ||` de autorización que v617 tuvo que cerrar.
//
//  ⚠️ LA SESIÓN CADUCA SOLA. Si el aparato que tenía la plaza se quedó sin
//  batería, sin red o simplemente cerró la app, su marca deja de refrescarse
//  y a los TTL segundos la plaza queda libre sin que nadie tenga que hacer
//  nada. Sin esto, un móvil apagado dejaría la plaza bloqueada para siempre.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var COLECCION   = 'cronos_role_sessions';
    var LATIDO_MS   = 25000;   // cada cuánto se refresca la marca
    var TTL_MS      = 75000;   // sin refresco pasado esto, la plaza está libre
    var _latido     = null;
    var _paraEscucha = null;
    var _claveActual = null;

    // ── Identidad de este aparato ────────────────────────────────────
    // Estable entre recargas: si cambiara en cada arranque, recargar la
    // página parecería "otro dispositivo" y el usuario se bloquearía a sí
    // mismo. Vive en localStorage, que es por navegador y por aparato.
    function _deviceId() {
        var k = 'cronos_device_id';
        try {
            var v = localStorage.getItem(k);
            if (!v) {
                v = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
                localStorage.setItem(k, v);
            }
            return v;
        } catch (e) {
            // Modo privado o almacenamiento bloqueado: id de sesión. Peor
            // (una recarga cuenta como aparato nuevo), pero nunca vacío.
            if (!window._cronosDeviceIdVolatil) {
                window._cronosDeviceIdVolatil = 'vol_' + Math.random().toString(36).slice(2, 10);
            }
            return window._cronosDeviceIdVolatil;
        }
    }
    window.cronosDeviceId = _deviceId;

    // Nombre legible para que el aviso diga algo útil ("iPad", "Windows"),
    // no un identificador que no significa nada para quien lo lee.
    function _nombreAparato() {
        var ua = String(navigator.userAgent || '');
        var so = /iPad/i.test(ua) ? 'iPad'
               : /iPhone/i.test(ua) ? 'iPhone'
               : /Android/i.test(ua) ? 'Android'
               : /Macintosh/i.test(ua) ? 'Mac'
               : /Windows/i.test(ua) ? 'Windows'
               : 'Dispositivo';
        // iPadOS se presenta como Macintosh con pantalla táctil.
        if (so === 'Mac' && navigator.maxTouchPoints > 1) so = 'iPad';
        var nav = /CriOS|Chrome/i.test(ua) ? 'Chrome'
                : /FxiOS|Firefox/i.test(ua) ? 'Firefox'
                : /Edg/i.test(ua) ? 'Edge'
                : /Safari/i.test(ua) ? 'Safari' : '';
        return nav ? (so + ' · ' + nav) : so;
    }

    // ── La clave de la PLAZA ─────────────────────────────────────────
    //  uid + rol + entidad + equipo. El equipo es lo que separa al mismo
    //  entrenador con dos equipos; si la plaza no lleva equipo (un Director,
    //  por ejemplo), queda vacío y el bloqueo es por rol dentro de su club,
    //  que es justo lo que se quiere.
    function _claveDePlaza(me) {
        if (!me || !me.uid) return null;
        var rol = String(me._activeRole || me.role || '').trim();
        if (!rol) return null;
        var entidad = String(me.clubId || me.individualEntityId || '').trim();
        var equipo = '';
        try {
            if (typeof window.cronosMyTeamId === 'function') equipo = String(window.cronosMyTeamId() || '');
        } catch (e) { equipo = ''; }
        // Sólo caracteres seguros: esto acaba siendo el id del documento.
        return [me.uid, rol, entidad, equipo].join('__').replace(/[^A-Za-z0-9_\-.@+]/g, '_');
    }
    window.cronosClaveDePlaza = _claveDePlaza;

    // Etiqueta humana de la plaza, para los avisos.
    function _etiquetaPlaza(me) {
        var rol = String((me && me._activeRole) || '');
        var nombres = {
            user: 'Entrenador', coach: 'Entrenador', director: 'Director Deportivo',
            coordinator: 'Coordinador', club_admin: 'Administrador de Club',
            parent: 'Familiar / Jugador', individual: 'Entrenador Administrador',
            superadmin: 'SuperAdmin'
        };
        var base = nombres[rol] || rol || 'Rol';
        var eq = '';
        try {
            var t = (typeof window.cronosMyTeam === 'function') ? window.cronosMyTeam() : null;
            if (t && (t.categoryLabel || t.category)) {
                eq = String(t.categoryLabel || t.category) + (t.subcategory ? (' ' + t.subcategory) : '');
            }
        } catch (e) {}
        return eq ? (base + ' · ' + eq) : base;
    }

    // ── Firestore, con el mismo patrón que el resto de auth/ ─────────
    //  ⚠️ `window.cronosSesionFS` es un punto de entrada DELIBERADO para el
    //  guard: el resto del módulo carga Firestore con un `import()` dinámico
    //  a gstatic, que dentro de un sandbox de pruebas no se puede interceptar.
    //  Sin esta rendija, lo único comprobable sería el fail-open y todo lo
    //  demás —el conflicto, la toma de control, el desalojo, la caducidad—
    //  quedaría sin medir, que es justo lo que no puede pasar en una función
    //  que decide si un entrenador entra o no a su partido.
    async function _fs() {
        if (typeof window.cronosSesionFS === 'function') return window.cronosSesionFS();
        var fa = window._cronos_auth;
        if (!fa || !fa.db) return null;
        var m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        return { m: m, db: fa.db };
    }

    function _vive(doc) {
        if (!doc || !doc.lastSeen) return false;
        var t = Number(doc.lastSeen) || 0;
        return (Date.now() - t) < TTL_MS;
    }

    // ════════════════════════════════════════════════════════════════
    //  RECLAMAR LA PLAZA
    //  Devuelve { ok:true } si se entra, o { ok:false, ocupadaPor:{...} }
    //  si otro aparato la tiene viva. Con `forzar` se toma el control.
    // ════════════════════════════════════════════════════════════════
    window.cronosSesionReclama = async function (clave, opciones) {
        var op = opciones || {};
        var yo = _deviceId();
        var f;
        try { f = await _fs(); } catch (e) { f = null; }
        // Sin Firestore cargado (o sin red): se deja entrar. Ver la nota de
        // arriba sobre por qué aquí el fail-open es lo correcto.
        if (!f || !clave) return { ok: true, sinComprobar: true };

        var ref = f.m.doc(f.db, COLECCION, clave);
        var previo = null;
        try {
            var snap = await f.m.getDoc(ref);
            previo = snap.exists() ? (snap.data() || null) : null;
        } catch (e) {
            return { ok: true, sinComprobar: true };
        }

        if (!op.forzar && previo && previo.deviceId && previo.deviceId !== yo && _vive(previo)) {
            return { ok: false, ocupadaPor: previo };
        }

        try {
            await f.m.setDoc(ref, {
                uid:        (window._cronosCurrentUser || {}).uid || '',
                clave:      clave,
                deviceId:   yo,
                deviceName: _nombreAparato(),
                rol:        String((window._cronosCurrentUser || {})._activeRole || ''),
                etiqueta:   _etiquetaPlaza(window._cronosCurrentUser),
                startedAt:  Date.now(),
                lastSeen:   Date.now()
            });
        } catch (e) {
            // Escribir la marca puede fallar (reglas aún sin desplegar, sin
            // red). No se impide trabajar por eso.
            return { ok: true, sinComprobar: true };
        }
        return { ok: true };
    };

    // ── Latido: mantiene viva la marca mientras se usa la plaza ──────
    function _arrancaLatido(clave) {
        _paraLatido();
        _claveActual = clave;
        _latido = setInterval(async function () {
            try {
                var f = await _fs();
                if (!f || !_claveActual) return;
                // ⚠️ El `uid` viaja también en el latido: si la marca se
                // hubiera borrado, este `merge` sería un ALTA, y la regla de
                // creación exige el uid. Sin él, el latido moriría en silencio
                // y la plaza caducaría con el entrenador dentro.
                await f.m.setDoc(f.m.doc(f.db, COLECCION, _claveActual),
                                 { lastSeen: Date.now(), deviceId: _deviceId(),
                                   uid: (window._cronosCurrentUser || {}).uid || '' },
                                 { merge: true });
            } catch (e) { /* sin red: la plaza caducará sola, y está bien */ }
        }, LATIDO_MS);
    }

    function _paraLatido() {
        if (_latido) { clearInterval(_latido); _latido = null; }
    }

    // ── Escucha: si otro aparato toma el control, este se retira ─────
    //  🔑 El aviso al PRIMER aparato es la otra mitad del encargo: sin esto,
    //  seguiría escribiendo creyendo que manda y volveríamos al problema de
    //  las escrituras contradictorias.
    async function _escucha(clave) {
        _paraEscuchaFn();
        try {
            var f = await _fs();
            if (!f) return;
            _paraEscucha = f.m.onSnapshot(f.m.doc(f.db, COLECCION, clave), function (snap) {
                var d = snap.exists() ? (snap.data() || {}) : null;
                if (!d || !d.deviceId) return;
                if (d.deviceId === _deviceId()) return;
                // Otro aparato ha tomado esta plaza.
                _paraLatido();
                _paraEscuchaFn();
                window.cronosSesionDesalojado(d);
            });
        } catch (e) { /* sin escucha: se sigue trabajando igual */ }
    }

    function _paraEscuchaFn() {
        if (typeof _paraEscucha === 'function') { try { _paraEscucha(); } catch (e) {} }
        _paraEscucha = null;
    }

    // ── Liberar (cambio de rol, cerrar sesión) ───────────────────────
    window.cronosSesionLibera = async function () {
        var clave = _claveActual;
        _paraLatido();
        _paraEscuchaFn();
        _claveActual = null;
        if (!clave) return;
        try {
            var f = await _fs();
            if (!f) return;
            var snap = await f.m.getDoc(f.m.doc(f.db, COLECCION, clave));
            // Sólo se borra si la marca sigue siendo MÍA: si otro tomó el
            // control, borrarla le dejaría la plaza libre para un tercero.
            if (snap.exists() && (snap.data() || {}).deviceId === _deviceId()) {
                await f.m.deleteDoc(f.m.doc(f.db, COLECCION, clave));
            }
        } catch (e) { /* la marca caducará sola */ }
    };

    // ════════════════════════════════════════════════════════════════
    //  AVISOS
    // ════════════════════════════════════════════════════════════════
    function _desde(ts) {
        var min = Math.max(0, Math.round((Date.now() - (Number(ts) || 0)) / 60000));
        if (min < 1) return 'hace menos de un minuto';
        if (min === 1) return 'hace 1 minuto';
        if (min < 60) return 'hace ' + min + ' minutos';
        var h = Math.floor(min / 60);
        return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
    }

    // Pregunta del conflicto. Resuelve a true si el usuario toma el control.
    window.cronosSesionPreguntaConflicto = function (info) {
        return new Promise(function (resolve) {
            var esc = (typeof window.escapeHtml === 'function') ? window.escapeHtml : function (s) { return String(s); };
            var ov = document.createElement('div');
            ov.id = 'cronos-sesion-conflicto';
            ov.style.cssText = 'position:fixed;inset:0;z-index:2600;display:flex;align-items:center;' +
                'justify-content:center;background:rgba(0,0,0,0.72);padding:16px;';
            ov.innerHTML =
                '<div style="background:var(--bg-card,#0d1117);border:1px solid rgba(255,255,255,0.18);' +
                'border-radius:14px;max-width:420px;width:100%;padding:18px;' +
                'box-shadow:0 18px 50px rgba(0,0,0,0.7);">' +
                '<div style="font-size:1rem;font-weight:800;color:#e3b341;margin-bottom:10px;">' +
                '⚠️ Ese rol ya está abierto</div>' +
                '<div style="font-size:0.84rem;color:#c9d1d9;line-height:1.45;margin-bottom:6px;">' +
                '<strong>' + esc(info.etiqueta || 'Este rol') + '</strong></div>' +
                '<div style="font-size:0.78rem;color:#8b949e;margin-bottom:14px;">' +
                esc(info.deviceName || 'Otro dispositivo') + ' · activo ' + esc(_desde(info.startedAt || info.lastSeen)) +
                '</div>' +
                '<div style="font-size:0.76rem;color:#8b949e;margin-bottom:16px;line-height:1.45;">' +
                'Si tomas el control, la sesión del otro dispositivo se cerrará para evitar que ' +
                'los dos escriban a la vez sobre el mismo partido.</div>' +
                '<div style="display:flex;gap:8px;">' +
                '<button id="cs-cancelar" style="flex:1;min-height:44px;border-radius:10px;cursor:pointer;' +
                'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);color:#c9d1d9;' +
                'font-weight:700;font-size:0.8rem;">Cancelar</button>' +
                '<button id="cs-tomar" style="flex:1;min-height:44px;border-radius:10px;cursor:pointer;' +
                'background:rgba(218,54,51,0.85);border:1px solid rgba(255,255,255,0.25);color:#fff;' +
                'font-weight:800;font-size:0.8rem;">Tomar el control</button>' +
                '</div></div>';
            document.body.appendChild(ov);
            var cierra = function (v) { try { ov.remove(); } catch (e) {} resolve(v); };
            ov.querySelector('#cs-cancelar').addEventListener('click', function () { cierra(false); });
            ov.querySelector('#cs-tomar').addEventListener('click', function () { cierra(true); });
        });
    };

    // Al aparato que pierde la plaza.
    window.cronosSesionDesalojado = function (info) {
        var esc = (typeof window.escapeHtml === 'function') ? window.escapeHtml : function (s) { return String(s); };
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:2700;display:flex;align-items:center;' +
            'justify-content:center;background:rgba(0,0,0,0.82);padding:16px;';
        ov.innerHTML =
            '<div style="background:var(--bg-card,#0d1117);border:1px solid rgba(248,81,73,0.5);' +
            'border-radius:14px;max-width:400px;width:100%;padding:18px;text-align:center;">' +
            '<div style="font-size:1rem;font-weight:800;color:#f85149;margin-bottom:10px;">' +
            '🔒 Sesión cerrada en este dispositivo</div>' +
            '<div style="font-size:0.82rem;color:#c9d1d9;line-height:1.5;margin-bottom:16px;">' +
            'Se ha abierto <strong>' + esc(info && info.etiqueta ? info.etiqueta : 'este rol') + '</strong> en ' +
            esc((info && info.deviceName) || 'otro dispositivo') + '.<br>' +
            'Para evitar que los datos del partido se pisen, aquí se cierra.</div>' +
            '<button id="cs-volver" style="width:100%;min-height:46px;border-radius:10px;cursor:pointer;' +
            'background:rgba(88,166,255,0.9);border:none;color:#fff;font-weight:800;font-size:0.85rem;">' +
            'Volver a los roles</button></div>';
        document.body.appendChild(ov);
        ov.querySelector('#cs-volver').addEventListener('click', function () {
            try { ov.remove(); } catch (e) {}
            if (typeof window.navExitToRoles === 'function') window.navExitToRoles();
            else window.location.reload();
        });
    };

    // ════════════════════════════════════════════════════════════════
    //  PUERTA ÚNICA — la llama el arranque de rol
    // ════════════════════════════════════════════════════════════════
    //  Devuelve true si se puede seguir en esta plaza.
    window.cronosSesionAlEntrar = async function () {
        var me = window._cronosCurrentUser;
        var clave = _claveDePlaza(me);
        if (!clave) return true;

        // Cambiar de plaza dentro del mismo aparato libera la anterior: si no,
        // un entrenador que salta de su Alevín a su Regional se dejaría la
        // primera marcada como ocupada por él mismo.
        if (_claveActual && _claveActual !== clave) { await window.cronosSesionLibera(); }

        var r = await window.cronosSesionReclama(clave);
        if (!r.ok) {
            var tomar = await window.cronosSesionPreguntaConflicto(r.ocupadaPor || {});
            if (!tomar) return false;
            await window.cronosSesionReclama(clave, { forzar: true });
        }
        _arrancaLatido(clave);
        _escucha(clave);
        return true;
    };

    // Al cerrar la pestaña se suelta la plaza cuanto antes; si no llega a
    // enviarse, caduca sola.
    window.addEventListener('pagehide', function () {
        try { window.cronosSesionLibera(); } catch (e) {}
    });
})();

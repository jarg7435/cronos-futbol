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

    // ════════════════════════════════════════════════════════════════
    //  🔑 v731 · LA CLAVE ES EL RECURSO QUE SE EDITA, Y NADA MÁS
    // ════════════════════════════════════════════════════════════════
    //  Encargo del autor (implementar.txt 2026-09-17, captura 10518): «el
    //  candado jamás debe basarse en el usuario global ni en el
    //  navegador/dispositivo. Debe generar una clave única ligada
    //  exclusivamente al recurso que se está editando: userId + equipoId +
    //  categoría + subcategoría».
    //
    //  📏 Lo que ya era cierto y lo que no: la clave NUNCA ha llevado el
    //  navegador ni el aparato (el `deviceId` sirve para saber QUIÉN la tiene,
    //  no para formarla) y el `equipo` ya es `club__categoria__subcategoria`.
    //  Lo que sí sobraba era el ROL, y faltaba el ENTORNO:
    //
    //  🔑 EL ROL FUERA. Desde v730 sólo ocupan plaza los que dirigen, así que
    //  el rol no distinguía recursos: sólo podía PARTIRLOS. La misma persona
    //  entrando al mismo equipo como 'user' y como 'individual' son el MISMO
    //  partido y deben colisionar; con el rol dentro, no colisionaban.
    //
    //  🚨 EL ENTORNO DENTRO, Y ESTE ES EL GORDO. `cronos-futbol-test` y
    //  `cronos-futbol-app` son dominios distintos —cada uno con su
    //  `localStorage`, o sea con su propio identificador de aparato— pero
    //  COMPARTEN LA MISMA BASE DE DATOS (ver la nota del proyecto sobre
    //  staging). Resultado medido en la captura del autor: la pestaña de
    //  PRODUCCIÓN retenía la plaza del Regional B y bloqueaba a la de TESTEO,
    //  presentándose como «otro dispositivo · Windows · Chrome» — que era su
    //  propio PC. Peor aún: una prueba en testeo podía DESALOJAR a un club
    //  real en producción. Con el host en la clave, cada entorno tiene sus
    //  marcas y no se pisan jamás.
    function _entorno() {
        try {
            var h = String(location.hostname || '');
            if (h.indexOf('cronos-futbol-test') === 0) return 'test';
            if (h === 'localhost' || h === '127.0.0.1') return 'local';
            return 'prod';
        } catch (e) { return 'prod'; }
    }
    window.cronosSesionEntorno = _entorno;

    function _claveDePlaza(me) {
        if (!me || !me.uid) return null;
        var entidad = String(me.clubId || me.individualEntityId || '').trim();
        var equipo = '';
        try {
            if (typeof window.cronosMyTeamId === 'function') equipo = String(window.cronosMyTeamId() || '');
        } catch (e) { equipo = ''; }
        // ⚠️ SIN EQUIPO NO HAY PLAZA. Un recurso sin identificar no se puede
        // bloquear sin bloquear de más, y bloquear de más es exactamente lo
        // que este módulo lleva tres versiones corrigiendo. Desde v730 quien
        // no lleva equipo tampoco ocupa plaza, así que esto es coherente con
        // la puerta de entrada: devolver null significa "no hay nada que
        // reservar", y todos los caminos lo tratan como vía libre.
        if (!equipo) return null;
        // Sólo caracteres seguros: esto acaba siendo el id del documento.
        return [_entorno(), me.uid, entidad, equipo].join('__').replace(/[^A-Za-z0-9_\-.@+]/g, '_');
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
        // v717 · `auth` viaja también: es el respaldo del `uid` con el que las
        // reglas comparan la marca de la plaza (ver `cronosSesionReclama`).
        return { m: m, db: fa.db, auth: fa.auth || null };
    }

    // ════════════════════════════════════════════════════════════════
    //  ⏳ v730 · UNA MARCA DEL FUTURO NO PUEDE BLOQUEAR PARA SIEMPRE
    // ════════════════════════════════════════════════════════════════
    //  `lastSeen` lo escribe el OTRO aparato con SU reloj y lo juzgamos con el
    //  NUESTRO. Con los relojes desincronizados —un iPad adelantado diez
    //  minutos— la resta sale NEGATIVA, siempre menor que el TTL, y la marca
    //  se daba por viva indefinidamente: un bloqueo fantasma que ni siquiera
    //  caduca, que es lo que el autor describe como «falsos positivos» y le
    //  obligaba a borrar el almacenamiento desde F12.
    //
    //  🔑 Un margen pequeño hacia el futuro SÍ se acepta (un par de segundos de
    //  deriva es normal y no hay que castigarlo); más allá, la marca no se
    //  considera viva. Ante la duda se deja pasar, que es la política de todo
    //  este módulo: es coordinación, no seguridad.
    var FUTURO_MAX_MS = 120000;   // 2 min de deriva de reloj tolerada

    function _vive(doc) {
        if (!doc || !doc.lastSeen) return false;
        var t = Number(doc.lastSeen) || 0;
        var edad = Date.now() - t;
        if (edad < 0) return (-edad) <= FUTURO_MAX_MS;   // marca "del futuro"
        return edad < TTL_MS;
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

        // 🔑 v717 · SIN `uid` NO SE ESCRIBE LA MARCA. La regla de lectura es
        // `resource.data.uid == request.auth.uid`, así que una marca con
        // `uid: ''` es una marca **que su propio dueño no puede leer**: su
        // oyente muere con permission-denied y este aparato deja de enterarse
        // de que otro le toma la plaza. Antes se escribía igual y el fallo
        // aparecía después, lejos de su causa. El respaldo es el usuario de
        // Firebase Auth, que es el que las reglas comparan.
        var _uid = (window._cronosCurrentUser || {}).uid ||
                   (f.auth && f.auth.currentUser && f.auth.currentUser.uid) || '';
        if (!_uid) {
            console.warn('[v717] No se reclama la plaza: todavía no hay uid. ' +
                         'Una marca sin uid no la puede leer ni su dueño.');
            return { ok: true, sinComprobar: true };
        }

        // 📋 v731 · LA MARCA DICE DE QUÉ EQUIPO ES. Hasta aquí había que
        // deducirlo de la etiqueta, y cuando un bloqueo salta donde no debe —la
        // captura 10518— lo primero que hace falta saber es QUÉ recurso se
        // reservó y DÓNDE. Son cuatro campos y no cuestan una lectura más.
        var _me2 = window._cronosCurrentUser || {};
        var _eq = null;
        try { _eq = (typeof window.cronosMyTeam === 'function') ? window.cronosMyTeam() : null; }
        catch (e) { _eq = null; }

        try {
            await f.m.setDoc(ref, {
                uid:        _uid,
                clave:      clave,
                deviceId:   yo,
                deviceName: _nombreAparato(),
                rol:        String(_me2._activeRole || ''),
                entorno:     _entorno(),
                teamId:      (_eq && _eq.teamId) ? String(_eq.teamId) : '',
                // `category` o `categoryLabel`: la cascada de `cronosMyTeam`
                // devuelve una u otra según de dónde salga el equipo.
                category:    (_eq && (_eq.category || _eq.categoryLabel)) ? String(_eq.category || _eq.categoryLabel) : '',
                subcategory: (_eq && _eq.subcategory) ? String(_eq.subcategory) : '',
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
    // ════════════════════════════════════════════════════════════════
    //  🔴🔴 v717 · EL OYENTE DE LA SESIÓN SE MORÍA EN SILENCIO
    // ════════════════════════════════════════════════════════════════
    //  📏 MEDIDO en la consola del autor (captura 10421, producción v716,
    //  22:26:40Z — el mismo instante en que se le cerró la sesión):
    //    «Uncaught Error in snapshot listener: FirebaseError:
    //     [code=permission-denied]: Missing or insufficient permissions»
    //
    //  🔑 POR QUÉ SE DENIEGA UNA LECTURA QUE ES SUYA. La regla de
    //  `cronos_role_sessions` es `allow get: resource.data.uid == uid`, y en el
    //  lenguaje de reglas **leer un campo de un documento que NO EXISTE LANZA**
    //  —y un error en la condición equivale a DENY—. O sea que en cuanto la
    //  marca se BORRA (`cronosSesionLibera`, al cambiar de plaza o cerrar
    //  sesión) cualquier oyente que siga puesto no recibe «documento
    //  borrado»: recibe **permission-denied**. Es exactamente la misma trampa
    //  que se midió en v714 para `live_matches`, ahora en una LECTURA.
    //  El otro camino al mismo sitio: una marca escrita con `uid: ''` (si el
    //  usuario aún no estaba cargado) es una marca **que su propio dueño no
    //  puede leer**.
    //
    //  🔑🔑 Y ESTE `onSnapshot` NO TENÍA CALLBACK DE ERROR, así que:
    //    · el SDK lo escupía como error NO CAPTURADO en la consola, y
    //    · el oyente quedaba MUERTO para siempre — este aparato no volvía a
    //      enterarse de que otro tomaba su plaza, que es justo lo que este
    //      módulo existe para vigilar.
    //
    //  Lo que se hace ahora: se atiende el error, se dice UNA vez, y se vuelve
    //  a enganchar si seguimos teniendo la plaza (con tope de reintentos, para
    //  que un fallo permanente no se convierta en un bucle de reconexión).
    //  ⚠️ Sigue siendo COORDINACIÓN, no seguridad: si la escucha no se puede
    //  restablecer, se trabaja igual (misma política de fail-open del módulo).
    // ════════════════════════════════════════════════════════════════
    var _reintentos = 0;
    var _MAX_REINTENTOS = 3;
    var _REINTENTO_MS = 4000;

    // ════════════════════════════════════════════════════════════════
    //  🔴 v730 · NINGÚN OYENTE HUÉRFANO SOBRE LA PLAZA ANTERIOR
    // ════════════════════════════════════════════════════════════════
    //  `_escucha` tiene un `await` entre el «apaga el anterior» y el «guarda el
    //  nuevo». Dos llamadas seguidas —cambiar de equipo, rearrancar el rol— se
    //  solapan ahí: la segunda apaga lo que hay, y luego la PRIMERA termina y
    //  escribe su `unsubscribe` encima. Resultado: un oyente vivo sobre la
    //  plaza VIEJA al que ya nadie puede dar de baja. Cuando otro aparato
    //  reclamaba esa plaza vieja, ese huérfano disparaba el desalojo y cerraba
    //  la sesión de un equipo que no tenía nada que ver. Misma familia que
    //  v719: la baja no basta si el alta puede llegar después.
    //
    //  🔑 Cada intento lleva su GENERACIÓN. Si al volver del `await` la
    //  generación ya no es la vigente, la suscripción se cierra en el acto en
    //  vez de guardarse.
    var _generacion = 0;

    async function _escucha(clave) {
        _paraEscuchaFn();
        var mia = ++_generacion;
        try {
            var f = await _fs();
            if (!f) return;
            if (mia !== _generacion) return;          // nos adelantó otra llamada
            var baja = f.m.onSnapshot(f.m.doc(f.db, COLECCION, clave), function (snap) {
                if (mia !== _generacion) return;      // esta escucha ya no manda
                _reintentos = 0;            // la escucha va: se olvida el historial de fallos
                var d = snap.exists() ? (snap.data() || {}) : null;
                if (!d || !d.deviceId) return;
                if (d.deviceId === _deviceId()) return;
                // Otro aparato ha tomado esta plaza.
                _paraLatido();
                _paraEscuchaFn();
                window.cronosSesionDesalojado(d);
            }, function (err) {
                if (mia !== _generacion) return;
                // 🔑 El oyente ya está muerto cuando llega aquí: Firestore lo
                // cierra al fallar. Se suelta la referencia y se decide.
                _paraEscucha = null;
                var msg = (err && err.message) || String(err);
                if (window._cronosSesionUltimoFallo !== msg) {
                    window._cronosSesionUltimoFallo = msg;
                    console.warn('[v717] La escucha de la plaza se cortó (' + msg +
                                 '). Reintentando mientras la plaza siga siendo nuestra.');
                }
                // Si ya no tenemos plaza (cambio de rol, salida), no hay nada
                // que volver a escuchar.
                if (_claveActual !== clave) return;
                if (_reintentos >= _MAX_REINTENTOS) {
                    console.warn('[v717] Escucha de plaza desactivada tras ' + _reintentos +
                                 ' intentos. Se sigue trabajando (coordinación, no seguridad).');
                    return;
                }
                _reintentos++;
                setTimeout(function () {
                    if (_claveActual === clave && !_paraEscucha) _escucha(clave);
                }, _REINTENTO_MS);
            });
            // ⚠️ La baja se guarda SÓLO si esta sigue siendo la escucha vigente.
            // Si nos adelantaron mientras se abría, se cierra aquí mismo: es lo
            // que impide que quede un oyente sobre la plaza anterior.
            if (mia !== _generacion) { try { baja(); } catch (e) {} return; }
            _paraEscucha = baja;
        } catch (e) { /* sin escucha: se sigue trabajando igual */ }
    }

    function _paraEscuchaFn() {
        _generacion++;              // invalida cualquier escucha en vuelo
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
                // ══════════════════════════════════════════════════════════
                //  🔒🔒 v718 · EL EQUIPO QUEDA BLOQUEADO, Y SE DICE POR QUÉ
                // ══════════════════════════════════════════════════════════
                //  Encargo del autor (implementar.txt 2026-09-15, pruebas con
                //  el Alevín C): «si un dispositivo intenta abrir o gestionar
                //  un equipo que ya tiene una sesión activa en otro lugar, el
                //  sistema debe BLOQUEAR el acceso de forma explícita y
                //  mostrar un mensaje claro indicando que no es posible
                //  trabajar con este equipo a no ser que se retire la
                //  prioridad o se cierre la sesión en el otro dispositivo».
                //
                //  ⚠️ CAMBIA LA POLÍTICA DE v699, Y LO PIDE ÉL. Hasta aquí
                //  esto era una pregunta con dos salidas al mismo nivel
                //  («Cancelar» / «Tomar el control»), así que tomar el equipo
                //  de otro aparato costaba un clic y no se leía el aviso.
                //  Ahora la respuesta POR DEFECTO es NO ENTRAR: el botón
                //  principal cierra, y retirar la prioridad es una acción
                //  aparte, secundaria y dicha con todas las letras.
                //
                //  🔑 LA SALIDA SIGUE EXISTIENDO, Y NO ES UN CAPRICHO: si el
                //  otro aparato se quedó sin batería en mitad del partido, un
                //  bloqueo sin escape dejaría al entrenador fuera de su propio
                //  encuentro. Por eso se dicen las TRES vías: cerrar allí,
                //  retirar la prioridad desde aquí, o esperar — la marca
                //  caduca sola en ~1 minuto (TTL 75 s, latido 25 s).
                '<div style="font-size:1rem;font-weight:800;color:#f85149;margin-bottom:10px;">' +
                '🔒 Este equipo ya está abierto en otro dispositivo</div>' +
                '<div style="font-size:0.84rem;color:#c9d1d9;line-height:1.45;margin-bottom:6px;">' +
                '<strong>' + esc(info.etiqueta || 'Este rol') + '</strong></div>' +
                '<div style="font-size:0.78rem;color:#8b949e;margin-bottom:14px;">' +
                esc(info.deviceName || 'Otro dispositivo') + ' · activo ' + esc(_desde(info.startedAt || info.lastSeen)) +
                '</div>' +
                '<div style="font-size:0.78rem;color:#f0f6fc;background:rgba(248,81,73,0.10);' +
                'border:1px solid rgba(248,81,73,0.35);border-radius:10px;padding:10px;' +
                'margin-bottom:12px;line-height:1.5;">' +
                '<strong>No es posible trabajar con este equipo desde aquí</strong> mientras siga ' +
                'abierto en el otro dispositivo: los dos escribirían a la vez sobre el mismo ' +
                'partido.</div>' +
                '<div style="font-size:0.76rem;color:#8b949e;margin-bottom:16px;line-height:1.5;">' +
                'Para poder usarlo: <strong>cierra la sesión</strong> en ese dispositivo, ' +
                '<strong>retírale la prioridad</strong> desde aquí (allí se cerrará al momento), ' +
                'o espera: si se quedó sin batería o sin cobertura, el equipo se libera solo en ' +
                'aproximadamente un minuto.</div>' +
                '<div style="display:flex;flex-direction:column;gap:8px;">' +
                '<button id="cs-cancelar" style="width:100%;min-height:46px;border-radius:10px;cursor:pointer;' +
                'background:rgba(88,166,255,0.9);border:none;color:#fff;' +
                'font-weight:800;font-size:0.85rem;">Entendido, no entrar</button>' +
                '<button id="cs-tomar" style="width:100%;min-height:42px;border-radius:10px;cursor:pointer;' +
                'background:rgba(255,255,255,0.04);border:1px solid rgba(218,54,51,0.55);color:#ff7b72;' +
                'font-weight:700;font-size:0.78rem;">Retirar la prioridad al otro dispositivo</button>' +
                '</div></div>';
            document.body.appendChild(ov);
            var cierra = function (v) { try { ov.remove(); } catch (e) {} resolve(v); };
            ov.querySelector('#cs-cancelar').addEventListener('click', function () { cierra(false); });
            ov.querySelector('#cs-tomar').addEventListener('click', function () { cierra(true); });
        });
    };

    // Al aparato que pierde la plaza.
    // ════════════════════════════════════════════════════════════════
    //  🔴🔴 v717 · EL APARATO DESALOJADO DEJA DE ESCRIBIR EL PARTIDO
    // ════════════════════════════════════════════════════════════════
    //  Hasta aquí, al ser desalojado sólo se PINTABA el aviso: el cronómetro
    //  seguía corriendo y el latido seguía subiendo `live_matches` hasta que el
    //  entrenador pulsara «Volver a los roles». O sea que durante ese rato
    //  había DOS aparatos escribiendo el mismo partido — exactamente lo que
    //  este módulo existe para evitar (ver la cabecera, v699) — y el que se
    //  queda leyendo ve el reloj pelearse consigo mismo: es el «bucle» y los
    //  «saltos extraños» del reporte (implementar.txt 2026-09-14).
    //
    //  🔑 UNA SOLA FUENTE DE VERDAD, que es lo que pide el autor: manda el
    //  aparato que tiene la plaza. Así que aquí se CALLA este: se para el
    //  reloj, se corta el latido y se apaga la emisión.
    //
    //  ⚠️ NO SE EMITE UN ÚLTIMO LATIDO al callarse (`stopLiveSync` lo haría):
    //  nuestro estado ya es el viejo, y mandarlo pisaría el del aparato que
    //  acaba de tomar el control. Callarse es justo lo contrario de despedirse.
    //  ⚠️ Y NO SE BORRA NADA EN LOCAL: la ranura del partido se queda donde
    //  está, así que si vuelve por aquí lo recupera.
    function _callaEsteAparato() {
        try { if (typeof isRunning !== 'undefined') isRunning = false; } catch (e) {}
        try { if (typeof window._cronosParaReloj === 'function') window._cronosParaReloj(); } catch (e) {}
        try { if (typeof window.cronosPintaBotonReloj === 'function') window.cronosPintaBotonReloj(); } catch (e) {}
        try {
            if (typeof liveSyncTimer !== 'undefined' && liveSyncTimer) {
                clearInterval(liveSyncTimer); liveSyncTimer = null;
            }
        } catch (e) {}
        try { if (typeof liveIsActive !== 'undefined') liveIsActive = false; } catch (e) {}
        try { if (typeof updateLiveButton === 'function') updateLiveButton(false); } catch (e) {}
    }

    window.cronosSesionDesalojado = function (info) {
        _callaEsteAparato();
        var esc =(typeof window.escapeHtml === 'function') ? window.escapeHtml : function (s) { return String(s); };
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
    // ⚠️ v700 · INTERRUPTOR DE EMERGENCIA POR CLUB (`sesion_unica`).
    //  Apagarlo devuelve al club al comportamiento de antes de v699 —varios
    //  aparatos con la misma plaza— sin desplegar nada, que es lo que hace
    //  falta un sábado por la mañana si esto estorbara en un partido real.
    //  Se comprueba con `_cronosExtraEnabled`, la lectura ÚNICA de extras del
    //  proyecto (v429), y por tanto hereda su regla `!== false`: un club sin
    //  el campo lo tiene ACTIVO, que es como está desplegado hoy.
    //  🔑 Apagado, no se reclama la plaza NI se deja marca NI se escucha: el
    //  módulo queda inerte del todo, no sólo "sin preguntar".
    function _controlActivo() {
        if (typeof window._cronosExtraEnabled !== 'function') return true;
        return window._cronosExtraEnabled('sesion_unica');
    }
    window.cronosSesionControlActivo = _controlActivo;

    // ════════════════════════════════════════════════════════════════
    //  🔓 v730 · QUIÉN OCUPA PLAZA: SÓLO QUIEN ESCRIBE EL PARTIDO
    // ════════════════════════════════════════════════════════════════
    //  Encargo del autor (implementar.txt 2026-09-17, capturas 10513-10514):
    //  «Un director deportivo, coordinador, familiar o la pantalla de En Vivo
    //  deben poder consultar un partido o panel libremente a la vez que el
    //  entrenador lo tiene abierto dirigiendo el encuentro. Ningún rol de
    //  supervisión o visualización puede ser bloqueado».
    //
    //  🔑 El motivo del candado (v699) es que DOS APARATOS NO ESCRIBAN EL
    //  MISMO PARTIDO. Un director que mira informes no escribe ningún partido:
    //  reservarle plaza no protegía nada y, en cambio, le echaba de su propio
    //  panel si abría el móvil. Así que la plaza la ocupan únicamente los roles
    //  que dirigen —los mismos de `CRONOS_ROLES_CON_EQUIPO` (v598)— y sólo al
    //  entrar en el partido, no al entrar en la aplicación.
    function _rolOcupaPlaza(me) {
        var rol = String((me && (me._activeRole || me.role)) || '').trim();
        var conEquipo = window.CRONOS_ROLES_CON_EQUIPO || ['user', 'coach', 'individual', 'admin_individual'];
        return conEquipo.indexOf(rol) >= 0;
    }
    window.cronosRolOcupaPlaza = _rolOcupaPlaza;

    // ════════════════════════════════════════════════════════════════
    //  🚪 v730 · EL CANDADO VIVE EN LA PUERTA DEL PARTIDO, NO EN LA DE CASA
    // ════════════════════════════════════════════════════════════════
    //  Segundo punto del encargo: «el aviso de que un equipo ya está abierto en
    //  otro dispositivo sólo debe saltar si se intenta editar o crear un
    //  partido de manera simultánea para el mismo equipo, categoría y
    //  subcategoría exacta».
    //
    //  🔑 Antes se reclamaba al ARRANCAR EL ROL, así que el segundo aparato se
    //  quedaba fuera de TODO —plantilla, asistencia, convocatoria, informes—
    //  por un partido que quizá nadie iba a tocar. Y era justo lo que le
    //  impedía al autor entrar a comprobar la asistencia de v729.
    //  Ahora la comprobación va donde está el riesgo real: `confirmSetup()` y
    //  `openLiveMatchRecovery()`, las dos puertas al partido en vivo.
    //
    //  ⚠️ EL CANDADO NO SE AFLOJA DONDE IMPORTA: dos aparatos escribiendo el
    //  mismo partido siguen sin poder, que es para lo que nació v718.
    window.cronosSesionAlAbrirPartido = async function () {
        if (!_controlActivo()) return true;
        var me = window._cronosCurrentUser;
        if (!_rolOcupaPlaza(me)) return true;      // quien no dirige, no ocupa
        var clave = _claveDePlaza(me);
        if (!clave) return true;

        // Ya la tenemos: entrar otra vez en nuestro propio partido no pregunta.
        if (_claveActual === clave) return true;

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

    // ════════════════════════════════════════════════════════════════
    //  🚪 ENTRAR EN LA APLICACIÓN — la llama el arranque de rol
    // ════════════════════════════════════════════════════════════════
    //  Ya NO reclama nada ni puede impedir la entrada a nadie (v730). Lo único
    //  que hace es higiene: soltar la plaza que hubiera quedado de la sesión
    //  anterior en este mismo aparato, para no dejar marcas que luego bloqueen
    //  al propio usuario. Devuelve true siempre, a propósito.
    window.cronosSesionAlEntrar = async function () {
        try {
            if (_claveActual) {
                var clave = _claveDePlaza(window._cronosCurrentUser);
                if (clave !== _claveActual) await window.cronosSesionLibera();
            }
        } catch (e) { /* entrar en la app nunca puede fallar por esto */ }
        return true;
    };

    // ════════════════════════════════════════════════════════════════
    //  🔄 v730 · CAMBIAR DE EQUIPO MUEVE LA PLAZA
    // ════════════════════════════════════════════════════════════════
    //  🔑🔑 ESTE ERA EL FALSO POSITIVO DE LA CAPTURA 10513. `_cronosCambiarEquipo`
    //  (js/core/setup-modal.js) cambiaba el equipo activo y repintaba… pero no
    //  tocaba la sesión: la marca de la plaza ANTERIOR seguía viva, con su
    //  latido, y el oyente seguía escuchando ESA. Así que al abrir el iPad el
    //  equipo que el PC había dejado atrás, el PC —que estaba tranquilamente en
    //  OTRO equipo— recibía «Se ha abierto este rol en otro dispositivo» y se
    //  le cerraba la sesión. Ni había dos ventanas del mismo equipo, ni el rol
    //  estaba duplicado: era una plaza que este aparato ya no usaba y no había
    //  soltado.
    //
    //  ⚠️ NO RECLAMA la plaza nueva: desde v730 la plaza se toma al entrar en
    //  el partido. Cambiar de equipo sólo SUELTA lo que ya no se usa.
    window.cronosSesionSincroniza = async function () {
        try {
            if (!_claveActual) return;
            var clave = _claveDePlaza(window._cronosCurrentUser);
            if (clave !== _claveActual) await window.cronosSesionLibera();
        } catch (e) { /* cambiar de equipo nunca puede fallar por esto */ }
    };

    // Al cerrar la pestaña se suelta la plaza cuanto antes; si no llega a
    // enviarse, caduca sola.
    window.addEventListener('pagehide', function () {
        try { window.cronosSesionLibera(); } catch (e) {}
    });
})();

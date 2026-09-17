// ════════════════════════════════════════════════════════════════════
//  📡 v728 · LA LOGÍSTICA DEL CLUB, EN DIRECTO
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-17, punto 2, con clubes reales
//  ya en producción): *"Cuando el director deportivo introduce el calendario
//  de temporada o envía los entrenamientos semanales, la información debe
//  sincronizarse de manera totalmente fluida… sin necesidad de salir y entrar
//  varias veces de las pantallas."*
//
//  🔑 MEDIDO ANTES DE TOCAR NADA. Las tres pantallas leían FOTOS, y cada una
//  con su propia caché, que es lo que obligaba a salir y entrar:
//    · Planificación Semanal · cuadrante del club → `getDoc` + caché de 60 s
//      (`_cqCacheDirectriz`, cuadrante-club.js). El cuadrante recién enviado
//      podía tardar un minuto… y sólo aparecía si algo repintaba la pantalla.
//    · Calendario oficial (el desplegable de jornadas de la convocatoria y del
//      panel de creación de partidos) → `getDoc` + caché DE SESIÓN
//      (`_calState.cache`, calendario-temporada.js), que sólo se invalida al
//      ESCRIBIR. Si el director importaba la temporada mientras el entrenador
//      tenía la app abierta, el entrenador no la veía hasta RECARGAR la app.
//    · Panel de Dirección · Convocatorias y Entrenamientos → `getDocs`
//      (events-tab.js): una foto del momento de abrir la pestaña.
//
//  Este módulo es el ÚNICO sitio donde se abren esas escuchas. No pinta nada:
//  avisa, y cada pantalla decide qué hacer con el aviso.
//
//  ⚠️⚠️ TODA ESCUCHA LLEVA CALLBACK DE ERROR. Un `onSnapshot` sin él queda
//  MUERTO para siempre tras un `permission-denied` y, como nadie se entera, la
//  pantalla se queda congelada con cara de estar al día (v717). Aquí es
//  obligatorio: `_escuchar` no acepta una suscripción sin su manejador.
//
//  ⚠️ UNA CLAVE, UNA ESCUCHA. `init()` y los repintados llaman a esto muchas
//  veces; registrar un listener nuevo en cada pasada es exactamente cómo nació
//  el fallo por paridad de v719. Si la clave ya está escuchando, se devuelve
//  la baja existente y no se abre nada.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // clave → { baja, cbs: Set }
    const _escuchas = new Map();

    async function _fs() {
        if (typeof window._sdFS === 'function') return window._sdFS();
        if (typeof window.saFS === 'function')  return window.saFS();
        const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        return { ...m, db: window._cronos_auth && window._cronos_auth.db };
    }

    // ⚠️ Sin sesión no se escucha nada: una suscripción anónima se come un
    // `permission-denied` y deja la clave ocupada con un listener muerto.
    function _hayaSesion() {
        return !!(window._cronosCurrentUser && window._cronosCurrentUser.uid);
    }

    function _avisar(clave, datos) {
        const e = _escuchas.get(clave);
        if (!e) return;
        e.cbs.forEach(cb => {
            // Un suscriptor que reviente NO puede llevarse por delante a los
            // demás ni cerrar la escucha.
            try { cb(datos); } catch (err) {
                console.warn('[ClubLive] un suscriptor de ' + clave + ' falló:', err && err.message);
            }
        });
    }

    // Abre (o reutiliza) la escucha de `clave`. `abrir(fs, entregar, fallar)`
    // devuelve la función de baja del SDK.
    function _escuchar(clave, abrir, cb) {
        const ya = _escuchas.get(clave);
        if (ya) { ya.cbs.add(cb); return () => _bajar(clave, cb); }
        if (!_hayaSesion()) return () => {};

        const reg = { baja: null, cbs: new Set([cb]) };
        _escuchas.set(clave, reg);

        _fs().then(fs => {
            if (!_escuchas.has(clave)) return;   // se dieron de baja mientras cargaba el SDK
            reg.baja = abrir(
                fs,
                (datos) => _avisar(clave, datos),
                (err) => {
                    // 🔑 v717 · Aquí se ENTERA alguien. La escucha ya está
                    // muerta: se descarta la clave para que el siguiente
                    // intento pueda volver a abrirla en vez de creer que
                    // sigue viva.
                    console.warn('[ClubLive] escucha caída (' + clave + '):', err && err.message);
                    _escuchas.delete(clave);
                }
            );
        }).catch(err => {
            console.warn('[ClubLive] no se pudo abrir la escucha ' + clave + ':', err && err.message);
            _escuchas.delete(clave);
        });

        return () => _bajar(clave, cb);
    }

    function _bajar(clave, cb) {
        const e = _escuchas.get(clave);
        if (!e) return;
        e.cbs.delete(cb);
        if (e.cbs.size) return;                 // otra pantalla sigue escuchando
        try { if (typeof e.baja === 'function') e.baja(); } catch (_) {}
        _escuchas.delete(clave);
    }

    // ── API ──────────────────────────────────────────────────────────
    //  Escucha un documento del club. `cb(datos|null)`.
    window.cronosEscuchaDocClub = function (ruta, cb) {
        if (!Array.isArray(ruta) || !ruta.length || typeof cb !== 'function') return () => {};
        const clave = 'doc:' + ruta.join('/');
        return _escuchar(clave, (fs, entregar, fallar) =>
            fs.onSnapshot(fs.doc(fs.db, ...ruta),
                (snap) => entregar(snap.exists() ? (snap.data() || {}) : null),
                fallar), cb);
    };

    //  Escucha una consulta. `construir(fs)` devuelve la query ya montada —la
    //  MISMA que use la lectura de esa pantalla, para que pase por las mismas
    //  reglas (un `list` se prueba con el rol más acotado, v674).
    //  `cb(filas)` recibe [{ _id, ...datos }].
    window.cronosEscuchaConsultaClub = function (clave, construir, cb) {
        if (!clave || typeof construir !== 'function' || typeof cb !== 'function') return () => {};
        return _escuchar('q:' + clave, (fs, entregar, fallar) =>
            fs.onSnapshot(construir(fs),
                (snap) => {
                    const filas = [];
                    snap.forEach(d => filas.push({ _id: d.id, ...d.data() }));
                    entregar(filas);
                },
                fallar), cb);
    };

    //  Cerrar TODO: cambio de cuenta, cierre de sesión. Dejar escuchas vivas
    //  del club anterior es el defecto de v721 (una cuenta hablando por otra).
    window.cronosCerrarEscuchasClub = function () {
        _escuchas.forEach((e) => { try { if (typeof e.baja === 'function') e.baja(); } catch (_) {} });
        _escuchas.clear();
    };

    //  Para los guards y para diagnosticar: qué se está escuchando ahora.
    window.cronosEscuchasClubAbiertas = function () { return Array.from(_escuchas.keys()); };
})();

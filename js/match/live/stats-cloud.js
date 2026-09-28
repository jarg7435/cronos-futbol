// ════════════════════════════════════════════════════════════════════
//  ☁️ v775 · ESTADÍSTICAS TÁCTICAS EN LA NUBE (R/P + avanzadas)
//  js/match/live/stats-cloud.js
// ════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-28, punto 2, URGENTE): se
//  apuntan córners, faltas, R o P en el PC, se abre el partido en el iPad o
//  el móvil… y todo vuelve a 0.
//
//  📏 ERA VERDAD Y ERA POR DISEÑO: los dos módulos (possession-tracker.js y
//  advanced-stats.js) sólo guardaban en el `localStorage` del aparato. Otro
//  aparato no tenía de dónde sacarlos.
//
//  🔑 AHORA VIVEN EN `live_stats/{matchId}`, UN DOCUMENTO APARTE (decisión
//  del autor entre las dos opciones que se le dieron):
//    · sus reglas sólo dejan leer al cuerpo técnico — una familia no puede
//      leerlo ni pidiéndolo a mano (dentro de `live_matches` sí podría);
//    · es pequeño, así que escribirlo en cada toque no obliga a nadie a
//      bajarse el partido entero (la lección de v576).
//
//  CÓMO SE SINCRONIZA
//    · Cada cambio local (registrar, asignar, rectificar, ✕, limpiar) avisa
//      aquí; se escribe el documento ENTERO tras una pausa corta (700 ms),
//      así una ráfaga de toques es UNA escritura. Entero y sin `merge`: las
//      listas se sustituyen, y un borrado viaja igual que un alta.
//    · Una escucha (`onSnapshot`) en cada aparato con el partido abierto.
//      Al abrir o recargar, el primer dato HIDRATA los contadores.
//    · ¿Quién gana? Cada sección (pr / sav) lleva `t`, el instante de su
//      último cambio. Se aplica lo remoto sólo si es MÁS NUEVO que lo local
//      y no hay un cambio local esperando a subir. Lo propio que vuelve como
//      eco (`hasPendingWrites`) se ignora.
//    · Sin cobertura, el SDK encola la escritura y el `localStorage` sigue
//      guardándolo todo: al volver la red, sube.
//
//  ⚠️ Sin `liveMatchId` (el partido aún no retransmite) no hay nube: se
//  sigue apuntando en local y sube en cuanto el id existe.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var FS_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
    var PAUSA_MS = 700;

    var _fs = null;              // módulo de Firestore, cargado una vez
    var _escuchaId = '';         // partido que se está escuchando
    var _baja = null;            // función para dar de baja la escucha
    var _temporizador = null;    // escritura programada
    var _sucio = false;          // hay un cambio local sin subir
    var _enVuelo = false;        // hay una escritura en curso
    var _autorRemoto = null;     // createdBy del documento (no se puede cambiar)
    var _existeRemoto = null;    // null = aún no se sabe

    function _id() {
        return (typeof liveMatchId !== 'undefined' && liveMatchId) ? String(liveMatchId) : '';
    }
    function _db() {
        var fa = window._cronos_auth;
        return (fa && fa.db) ? fa.db : null;
    }
    // `window._cronosStatsNubeFS`: un objeto con doc/setDoc/onSnapshot/
    // serverTimestamp que sustituye al SDK. Sólo lo pone el guard
    // (scripts/test_stats_avanzadas.js) para EJECUTAR la sincronía con un
    // Firestore simulado; en la app no existe y se importa el SDK real.
    function _cargaFS() {
        if (window._cronosStatsNubeFS) return Promise.resolve(window._cronosStatsNubeFS);
        if (_fs) return Promise.resolve(_fs);
        return import(FS_URL).then(function (m) { _fs = m; return m; });
    }

    // Las dos secciones, cada una con su estado en memoria y su hidratador.
    var SECCIONES = {
        pr:  { estado: function () { return window._cronosPR; },  hidrata: 'cronosPRHidrata' },
        sav: { estado: function () { return window._cronosSAv; }, hidrata: 'cronosSAvHidrata' }
    };

    // Firestore no admite `undefined`: se copia cada apunte a un objeto plano.
    function _limpio(it) {
        var o = {};
        Object.keys(it || {}).forEach(function (k) {
            var v = it[k];
            if (v === undefined || typeof v === 'function') return;
            o[k] = (v === null || typeof v === 'number' || typeof v === 'boolean') ? v : String(v);
        });
        return o;
    }

    function _seccion(k) {
        var e = SECCIONES[k].estado();
        var id = _id();
        // Sólo lo de ESTE partido: el estado en memoria puede ser del anterior
        // si todavía no se ha restaurado.
        if (!e || e.matchId !== id) return { t: 0, items: [] };
        return {
            t: Number(e.t) || 0,
            items: (Array.isArray(e.items) ? e.items : []).map(_limpio)
        };
    }

    function _hayAlgoLocal() {
        return _seccion('pr').items.length > 0 || _seccion('sav').items.length > 0;
    }

    // ── Escritura ────────────────────────────────────────────────────
    function _escribe() {
        _temporizador = null;
        var id = _id(), db = _db();
        if (!id || !db) return;
        if (_enVuelo) { _programa(); return; }
        var me = window._cronosCurrentUser || {};
        _enVuelo = true;
        _sucio = false;
        _cargaFS().then(function (F) {
            var datos = {
                v: 1,
                matchId: id,
                clubId: me.clubId || null,
                // El autor NO puede cambiar (reglas): si el documento ya
                // existe, se respeta el suyo aunque escriba otro aparato.
                createdBy: _autorRemoto || me.uid || null,
                coachEmail: me.email || null,
                category: String(window._currentMatchCategory || ''),
                pr:  _seccion('pr'),
                sav: _seccion('sav'),
                updatedAt: F.serverTimestamp(),
                // Red de seguridad por si algún día se activa la TTL nativa;
                // el borrado fino lo hace cleanupLiveMatches con el partido.
                expireAt: new Date(Date.now() + 36 * 60 * 60 * 1000)
            };
            return F.setDoc(F.doc(db, 'live_stats', id), datos);
        }).then(function () {
            _existeRemoto = true;
            if (!_autorRemoto) _autorRemoto = (window._cronosCurrentUser || {}).uid || null;
        }).catch(function (e) {
            // Se queda marcado para reintentar con el próximo cambio o la
            // próxima escucha. Lo local nunca se pierde.
            _sucio = true;
            console.warn('[stats-cloud] no se pudo guardar:', e && e.message);
        }).then(function () {
            _enVuelo = false;
        });
    }

    function _programa() {
        if (_temporizador) clearTimeout(_temporizador);
        _temporizador = setTimeout(_escribe, PAUSA_MS);
    }

    // La llaman los dos módulos tras CADA cambio local.
    window.cronosStatsNubeCambio = function () {
        _sucio = true;
        if (!_id()) return;          // sin id: sube cuando lo haya
        window.cronosStatsNubeEscucha();
        _programa();
    };

    // ── Lectura en tiempo real ───────────────────────────────────────
    function _aplica(d) {
        if (!d) return;
        if (d.createdBy) _autorRemoto = d.createdBy;
        // Un cambio local pendiente manda: lo remoto se aplicará si sigue
        // siendo más nuevo en el siguiente dato.
        if (_sucio || _temporizador || _enVuelo) return;
        Object.keys(SECCIONES).forEach(function (k) {
            var r = d[k];
            if (!r || !Array.isArray(r.items)) return;
            var local = _seccion(k);
            if ((Number(r.t) || 0) <= local.t) return;
            var fn = window[SECCIONES[k].hidrata];
            if (typeof fn === 'function') {
                try { fn(r.items, Number(r.t) || 0); } catch (e) { /* nunca tumba la escucha */ }
            }
        });
    }

    window.cronosStatsNubeEscucha = function () {
        var id = _id(), db = _db();
        if (!id || !db) return false;
        if (_escuchaId === id && _baja) return true;
        if (_baja) { try { _baja(); } catch (e) {} _baja = null; }
        _escuchaId = id;
        _autorRemoto = null;
        _existeRemoto = null;
        _cargaFS().then(function (F) {
            if (_escuchaId !== id) return;      // cambió de partido mientras cargaba
            _baja = F.onSnapshot(F.doc(db, 'live_stats', id), function (snap) {
                if (snap.metadata && snap.metadata.hasPendingWrites) return;   // eco propio
                if (!snap.exists()) {
                    // Sólo se cree lo que dice el SERVIDOR: la caché local
                    // puede no tenerlo aún (la trampa de v773).
                    if (snap.metadata && snap.metadata.fromCache) return;
                    _existeRemoto = false;
                    // Partido sin documento y apuntes locales (migrados del
                    // `sin_id` o de antes de este cambio): se suben.
                    if (_hayAlgoLocal()) window.cronosStatsNubeCambio();
                    return;
                }
                _existeRemoto = true;
                _aplica(snap.data());
            }, function (err) {
                // Escucha caída (permisos, red): se deja libre para que la
                // próxima llamada la vuelva a enganchar.
                console.warn('[stats-cloud] escucha caída:', err && err.message);
                _baja = null;
                _escuchaId = '';
            });
        }).catch(function (e) {
            console.warn('[stats-cloud] Firestore no disponible:', e && e.message);
            _escuchaId = '';
        });
        return true;
    };

    // Para el guard: estado interno de sólo lectura.
    window._cronosStatsNubeEstado = function () {
        return { escuchaId: _escuchaId, sucio: _sucio, enVuelo: _enVuelo,
                 programado: !!_temporizador, autor: _autorRemoto, existe: _existeRemoto };
    };
})();

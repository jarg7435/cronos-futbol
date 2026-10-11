// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — immutability.js
//  Regla de negocio: UN PARTIDO TERMINADO NO SE EDITA (v434)
// ════════════════════════════════════════════════════════════════════
//
//  LOS TRES ESTADOS DE UN PARTIDO, y el único sitio donde se deciden:
//
//    live    · status 'active'. Se escribe con normalidad (el latido de 5 s).
//    grace   · terminado hace MENOS de 2 h. Lo único que se admite es AÑADIR
//              sucesos que no se registraron en su momento (batería, cobertura)
//              por la vía del modal retroactivo. Nada más: ni corregir el
//              marcador a mano, ni tocar alineaciones, ni reescribir o borrar
//              un suceso ya registrado.
//    frozen  · terminado hace MÁS de 2 h. Congelado del todo. Ni edición ni
//              borrado. A las 10 h lo borra `cleanupLiveMatches` en servidor.
//
//  2 h de gracia + 8 h congelado = las 10 h de retención de v431.
//
//  ⚠️ ESTO ES LA CAPA DE INTERFAZ, NO LA BARRERA. Todo lo de este fichero corre
//  en el navegador del usuario y por tanto es un ayudante de UX: evita que se
//  intente una escritura que va a fallar, y apaga los botones que no proceden.
//  QUIEN IMPIDE DE VERDAD LA FALSIFICACIÓN SON LAS REGLAS DE firestore.rules
//  (bloque live_matches), que aplican el mismo criterio del lado del servidor
//  con `request.time` y no se pueden saltar desde la consola del navegador.
//  Si algún día cambian las horas, hay que cambiarlas EN LOS DOS SITIOS: no se
//  pueden compartir constantes entre JS y el lenguaje de reglas.
//
//  ⚠️ EL ANCLA ES `finishedAt`, CON RESPALDO EN `updatedAt`. Mismo criterio que
//  la Cloud Function. El respaldo no es cosmético y cubre dos casos reales:
//    · Partidos anteriores a v431, que nunca tuvieron sello de finalización.
//    · El instante justo después de finalizar: `pushLiveSnapshot` sella con
//      `serverTimestamp()`, que en la copia local del cliente llega NULL hasta
//      que el servidor confirma. Sin respaldo, el partido se vería congelado
//      durante ese hueco y el entrenador no podría registrar el gol que se le
//      quedó sin anotar — justo el caso para el que existe la ventana.
//  Sin ninguno de los dos sellos se considera CONGELADO: si no se puede fechar
//  el final, no se puede demostrar que estemos dentro de la ventana, y ante la
//  duda mandan los datos, no la comodidad.
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    var GRACE_MS     = 2  * 60 * 60 * 1000;   // ventana de incidencias
    var RETENTION_MS = 10 * 60 * 60 * 1000;   // borrado en servidor

    // Firestore devuelve Timestamp; el histórico guarda a veces ISO o epoch.
    // Un dato con el que no se pueda construir una fecha vale como ausente.
    function _toMs(v) {
        if (v == null) return 0;
        try {
            if (typeof v.toDate === 'function') return v.toDate().getTime();
            if (typeof v.seconds === 'number')   return v.seconds * 1000;
            if (typeof v === 'number')           return v;
            if (typeof v === 'string') {
                var t = new Date(v).getTime();
                return isNaN(t) ? 0 : t;
            }
        } catch (e) { /* dato corrupto: como ausente */ }
        return 0;
    }

    // Instante de finalización, con el respaldo explicado arriba.
    function finishedAtMs(m) {
        if (!m) return 0;
        return _toMs(m.finishedAt) || _toMs(m.updatedAt);
    }

    // 'live' | 'grace' | 'frozen'. Único sitio donde se decide.
    function state(m, ahoraMs) {
        if (!m) return 'frozen';
        var status = m.status || 'active';
        if (status === 'active') return 'live';

        var fin = finishedAtMs(m);
        if (!fin) return 'frozen';            // sin fecha utilizable: congelado

        var ahora = typeof ahoraMs === 'number' ? ahoraMs : Date.now();
        return (ahora - fin) <= GRACE_MS ? 'grace' : 'frozen';
    }

    // ════════════════════════════════════════════════════════════════
    //  🔓 v797 · EL DESBLOQUEO DE DIRECCIÓN / COORDINACIÓN
    //
    //  Encargo del autor (implementar.txt 2026-10-11): pasadas las 2 h, el
    //  entrenador sólo puede añadir sucesos a un partido si el Director
    //  Deportivo o el Coordinador le conceden permiso PARA ESE PARTIDO.
    //
    //  El permiso es un documento `cronos_match_unlocks/{matchId}` (lo
    //  gestiona js/match/events/match-unlocks.js). Aquí sólo se decide si
    //  está VIGENTE: concedido y sin caducar. Quien lo trae al partido es el
    //  modal, que lo cuelga en `m._cronosUnlock` antes de preguntar.
    //
    //  ⚠️ Igual que el resto del fichero, ESTO ES INTERFAZ. La barrera es la
    //  rama `lmDesbloqueado()` de firestore.rules, que lee el mismo documento
    //  con `request.time`. Si cambia la duración, cambia también allí.
    // ════════════════════════════════════════════════════════════════
    var UNLOCK_MS = 24 * 60 * 60 * 1000;      // vigencia de un permiso

    function unlockValid(u, ahoraMs) {
        if (!u || u.status !== 'granted') return false;
        var hasta = _toMs(u.expiresAt);
        if (!hasta) return false;              // sin caducidad legible: no vale
        var ahora = typeof ahoraMs === 'number' ? ahoraMs : Date.now();
        return ahora < hasta;
    }

    // ¿Se admite AÑADIR un suceso retroactivo?
    // 🔓 v797 · Congelado + permiso vigente de Dirección/Coordinación = sí.
    function canAddEvent(m, ahoraMs) {
        var s = state(m, ahoraMs);
        if (s === 'live' || s === 'grace') return true;
        return !!(m && unlockValid(m._cronosUnlock, ahoraMs));
    }

    // ¿Se admite borrar a mano? El SuperAdmin conserva la válvula de escape;
    // para todos los demás, congelado es también no borrable — si un partido
    // incómodo se puede hacer desaparecer, la inmutabilidad no sirve de nada.
    function canDelete(m, esSuperAdmin, ahoraMs) {
        if (esSuperAdmin) return true;
        return state(m, ahoraMs) !== 'frozen';
    }

    // Milisegundos que quedan de ventana (0 si ya está congelado o en vivo).
    function graceRemainingMs(m, ahoraMs) {
        if (state(m, ahoraMs) !== 'grace') return 0;
        var ahora = typeof ahoraMs === 'number' ? ahoraMs : Date.now();
        return Math.max(0, finishedAtMs(m) + GRACE_MS - ahora);
    }

    // "1h 12min" / "8min" — para decirle al usuario cuánto le queda.
    function graceRemainingText(m, ahoraMs) {
        var ms = graceRemainingMs(m, ahoraMs);
        if (ms <= 0) return '';
        var min = Math.ceil(ms / 60000);
        if (min < 60) return min + 'min';
        return Math.floor(min / 60) + 'h ' + (min % 60) + 'min';
    }

    // Motivo legible del bloqueo, para el aviso al usuario. Se centraliza aquí
    // para que los cinco puntos de llamada digan exactamente lo mismo.
    function lockReason(m, ahoraMs) {
        if (state(m, ahoraMs) !== 'frozen') return '';
        if (m && unlockValid(m._cronosUnlock, ahoraMs)) return '';
        return 'Este partido está cerrado: solo se admiten incidencias durante '
             + 'las 2 horas siguientes a su finalización. Para añadir más, '
             + 'pide el desbloqueo al Director Deportivo o al Coordinador '
             + '(en un ente individual, a su administrador) '
             + 'desde «Registrar sucesos offline».';
    }

    window.CronosMatchLock = {
        GRACE_MS: GRACE_MS,
        RETENTION_MS: RETENTION_MS,
        UNLOCK_MS: UNLOCK_MS,
        finishedAtMs: finishedAtMs,
        state: state,
        unlockValid: unlockValid,
        canAddEvent: canAddEvent,
        canDelete: canDelete,
        graceRemainingMs: graceRemainingMs,
        graceRemainingText: graceRemainingText,
        lockReason: lockReason
    };
})();

// ════════════════════════════════════════════════════════════════════
//  CRONOS FUTBOL — FIN DE PARTIDO (endMatch)
// ════════════════════════════════════════════════════════════════════
//  Este archivo declara UNA sola cosa: window.endMatch, de la que es el
//  UNICO duenyo en todo el proyecto. La consumen core/app-init.js,
//  core/patches.js, core/setup-modal.js, core/sprint3-init.js y
//  match/timer/core.js.
//
//  LIMPIEZA 2026-07-29: antes tenia 609 lineas y sus primeras 320 eran
//  BYTE-IDENTICAS a las de match/persistence/team-persistence.js, que
//  carga DESPUES (index.html) y por tanto ganaba en todos los nombres
//  compartidos. Las 11 funciones duplicadas se borraron: 9 cuerpos eran
//  identicos y 2 —_showPostMatchOptions y _postMatchSendReports— eran
//  una version VIEJA de la pantalla de post-partido (su boton decia
//  "Descargar / Exportar Datos" y exportaba el CSV; el vivo dice "Enviar
//  Informes a Padres" y llama al envio de informes a las familias).
//  Todo eso es ahora de team-persistence.js, la fuente canonica.
//
//  ⚠️ Ese nombre de funcion NO se escribe aqui a proposito:
//  test_match_reports_send_module.js (1d) mide el fan-in barriendo el texto
//  del repo SIN quitar comentarios, asi que nombrarlo en una explicacion lo
//  cuenta como consumidor y pone el test en rojo. Ya paso antes en extras.js.
//
//  endMatch llama a _showPostMatchOptions por nombre pelado: resuelve a
//  la de team-persistence.js, que es la que ya ganaba antes del borrado.
//
//  Guard: scripts/test_persistence_duplication.js
// ════════════════════════════════════════════════════════════════════

window.endMatch = function endMatch(skipConfirm = false) {
    if (matchPhase === 'finished') return; // E5: guard idempotencia (evita Sale FIN duplicado por rutas multiples de fin)
    if (!skipConfirm && !confirm('¿Finalizar el partido?')) return;

    // Detener cronómetro
    isRunning = false;
    clearInterval(timerInterval);
    matchPhase = 'finished';

    // ── FIX (punto 2): limpiar el estado persistido del partido activo ──
    // Esta es la ruta de fin de partido que realmente gana (se carga después
    // de la versión de app-init.js). Antes NO tocaba localStorage, por lo que
    // el último snapshot con fase 1ª/2ª parte quedaba guardado y
    // _checkActiveMatch() mostraba el banner "Retomar partido" tras finalizar.
    try {
        // No detenemos autoSaveInterval (destruirlo rompería el autoguardado de
        // un partido nuevo iniciado en la misma sesión). Su guard interno ya
        // evita reescribir el snapshot cuando matchPhase === 'finished'.
        localStorage.removeItem('cronos_active_match_v2');
        // Blindaje: marca de finalización que _checkActiveMatch() respeta para
        // ignorar cualquier snapshot residual escrito por una carrera de 5s.
        localStorage.setItem('cronos_active_match_v2_finished', Date.now().toString());
        // Commit sincrono del FIN como evento critico durable en IndexedDB.
        // No usamos commitCriticalEvent() aqui porque reescribiria el snapshot
        // que acabamos de borrar; registramos solo el evento de forma durable.
        try {
            const _mgr = window._cronosOffline;
            if (_mgr && typeof _mgr.saveEventSync === 'function') {
                _mgr.saveEventSync({
                    kind: 'match_critical', type: 'phase', detail: { phase: 'finished' },
                    phase: 'finished',
                    matchId: (typeof liveMatchId !== 'undefined') ? liveMatchId : null,
                    clientTs: Date.now(),
                }).catch(() => {});
            }
        } catch (e) { /* silencioso */ }
    } catch (e) { /* silencioso: el fin de partido nunca debe romperse por storage */ }

    // Registrar salida de todos los jugadores en campo
    const finalTime = formatTime((masterTimeH1 || 0) + (masterTimeH2 || 0));
    (players || []).filter(p => p.status === 'field').forEach(p => {
        p.history.push('Sale a las ' + finalTime + ' (FIN)');
    });

    updateMasterUI();

    // Detener sincronización en vivo y empujar estado 'finished' a Firestore
    if (typeof pushLiveSnapshot === 'function') {
        pushLiveSnapshot('finished').catch(e => console.warn('[endMatch] Error pushing finished snapshot:', e));
    }
    if (typeof stopLiveSync === 'function') {
        stopLiveSync();
    }

    // FIX (C4): log de errores en vez de silenciarlos completamente.
    // Antes .catch(() => {}) ocultaba errores de permisos Firestore que
    // impedían que los informes de staff se escribieran.
    if (typeof saveAllMatchReportsInternal === 'function') {
        saveAllMatchReportsInternal().catch(e => {
            console.error('[C4 endMatch] Error al guardar informes automáticamente:', e.message);
        });
    }

    // \ud83d\udd34\ud83d\udd34\ud83d\udd34 TRIPLE SILBATO + PANTALLA FINAL DEL PARTIDO
    if (typeof _cronosWhistle === 'function') {
        _cronosWhistle(3, () => {
            if (typeof _cronosMatchMomentOverlay === 'function') {
                _cronosMatchMomentOverlay(
                    '\ud83e\udd1d',
                    'FINAL DEL PARTIDO',
                    'El \u00e1rbitro ha pitado el final',
                    () => { _showPostMatchOptions(); }
                );
            } else {
                _showPostMatchOptions();
            }
        });
    } else {
        _showPostMatchOptions();
    }
};

/**
 * _showPostMatchOptions() — Modal post-partido sobre la vista del partido.
 * Usa #setup-modal para no destruir el estado del partido en #main-container.
 * Así el entrenador puede volver si lo necesita.
 */

/** Desde la pantalla post-partido → abre opciones de exportación porque los internos ya se enviaron auto */

/**
 * Volver al partido — cierra el modal y muestra el main-container.
 * El estado del partido (jugadores, crono, goles) se conserva intacto.
 */

/** Desde la pantalla post-partido → nueva configuración */

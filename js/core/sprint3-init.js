// ════════════════════════════════════════════════════════════════════
// 🚀 SPRINT 3: INICIALIZACIÓN DE AUDIT LOGGER Y RENDER OPTIMIZER
// Asegura que las herramientas estén disponibles en window para toda la app
// ════════════════════════════════════════════════════════════════════

(function initSprint3Features() {

  // ══════════════════════════════════════════════════════════════════
  // Esperar a que las clases estén disponibles en window
  // ══════════════════════════════════════════════════════════════════
  
  const checkInterval = setInterval(() => {
    const hasAuditLogger = window.AuditLogger !== undefined;
    const hasRenderOptimizer = window.RenderOptimizer !== undefined;
    
    if (hasAuditLogger && hasRenderOptimizer) {
      clearInterval(checkInterval);
      
      // ══════════════════════════════════════════════════════════════════
      // Instanciar RenderOptimizer globalmente
      // ══════════════════════════════════════════════════════════════════
      if (!window.renderOptimizer) {
        window.renderOptimizer = new RenderOptimizer();
      }
      
      // Crear instancias de utilidades de render optimization
      if (!window.playerVirtualizer) {
        window.playerVirtualizer = new PlayerListVirtualizer();
      }
      
      if (!window.debounceRender) {
        window.debounceRender = new DebounceRender();
      }
      
      if (!window.batchDomUpdate) {
        window.batchDomUpdate = new BatchDomUpdate();
      }
      
      // ══════════════════════════════════════════════════════════════════
      // Inicialización del AuditLogger para el partido en curso
      // ══════════════════════════════════════════════════════════════════
      // NOTA (2026-07-27): aquí había un envoltorio de `window.startMatch`.
      // Se ha eliminado porque `startMatch` NO EXISTE en ningún archivo del
      // proyecto: el envoltorio capturaba `window.startMatch || (() => {})`,
      // es decir un no-op, y creaba un global fantasma que nadie invocaba
      // jamás. El partido arranca por goToTitularSelection(), no por ahí.
      // La inicialización real del auditor es la de abajo, que es la que
      // siempre ha funcionado.
      if (typeof window.liveMatchId !== 'undefined' && window.liveMatchId && !window.auditLogger) {
        window.auditLogger = new AuditLogger();
        window.auditLogger.init(window.liveMatchId);
      }

      // ══════════════════════════════════════════════════════════════════
      // Limpiar RenderOptimizer y auditor cuando termina el partido
      // ══════════════════════════════════════════════════════════════════
      // ⚠️ FIX (2026-07-27) — hallazgo #11 de la auditoría 2026-07-22.
      // Este envoltorio se PERDÍA en conexiones lentas. Corre dentro de un
      // setInterval, y `window.endMatch` lo define active-match.js, que es un
      // <script> posterior: si el intervalo disparaba antes de que ese script
      // terminara de descargarse, se envolvía un no-op y acto seguido
      // active-match.js sobrescribía window.endMatch, tirando este envoltorio
      // a la basura. Resultado: el volcado de la auditoría al terminar el
      // partido no ocurría, en silencio y justo en el escenario más probable
      // (entrenador en el campo con mala cobertura).
      //
      // Ahora se espera a que endMatch exista DE VERDAD antes de envolverlo,
      // con guarda de idempotencia — el mismo patrón que ya usaba
      // js/core/patches.js (patchEndMatchCleanup). Los dos envoltorios
      // conviven sin pisarse: cada uno comprueba su propia marca.
      function wrapEndMatchForAudit() {
        if (typeof window.endMatch !== 'function') {
          setTimeout(wrapEndMatchForAudit, 300);
          return;
        }
        if (window.endMatch._cronosAuditWrapped) return;   // idempotente
        const origEndMatch = window.endMatch;
        window.endMatch = function(...args) {

          // Flush audit logs
          if (window.auditLogger) {
            window.auditLogger.flushQueue().catch(err => {
              if(window._CRONOS_DEBUG) console.warn('[Sprint 3 Init] Error flushing logs before end:', err);
            });
          }

          return origEndMatch.apply(this, args);
        };
        window.endMatch._cronosAuditWrapped = true;
      }
      wrapEndMatchForAudit();
      
      
    } else if (hasAuditLogger && !hasRenderOptimizer) {
    } else if (!hasAuditLogger && hasRenderOptimizer) {
    }
  }, 100);
  
  // Timeout después de 5 segundos si no se cargan
  setTimeout(() => {
    if (clearInterval) clearInterval(checkInterval);
    if (!window.renderOptimizer) {
      if(window._CRONOS_DEBUG) console.warn('⚠️ [Sprint 3 Init] RenderOptimizer no cargó en 5s - features pueden estar degradadas');
    }
    if (!window.auditLogger && window.liveMatchId) {
      if(window._CRONOS_DEBUG) console.warn('⚠️ [Sprint 3 Init] AuditLogger no cargó en 5s - audit trail puede no funcionar');
    }
  }, 5000);
  
})();


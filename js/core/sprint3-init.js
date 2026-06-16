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
      // Hook para inicializar AuditLogger cuando inicia el partido
      // ══════════════════════════════════════════════════════════════════
      const origStartMatch = window.startMatch || (() => {});
      window.startMatch = function(...args) {
        
        // Esperar a que liveMatchId esté disponible
        setTimeout(() => {
          if (window.liveMatchId && !window.auditLogger) {
            window.auditLogger = new AuditLogger();
            window.auditLogger.init(window.liveMatchId);
            
            // Flush any pending logs from offline queue
            window.auditLogger.flushQueue().catch(err => {
              if(window._CRONOS_DEBUG) console.warn('[Sprint 3 Init] Error flushing audit queue:', err);
            });
          }
        }, 100);
        
        return origStartMatch.apply(this, args);
      };
      
      // ══════════════════════════════════════════════════════════════════
      // Inicialización fallback si startMatch no existe
      // ══════════════════════════════════════════════════════════════════
      if (typeof window.liveMatchId !== 'undefined' && window.liveMatchId && !window.auditLogger) {
        window.auditLogger = new AuditLogger();
        window.auditLogger.init(window.liveMatchId);
      }
      
      // ══════════════════════════════════════════════════════════════════
      // Limpiar RenderOptimizer y auditor cuando termina el partido
      // ══════════════════════════════════════════════════════════════════
      const origEndMatch = window.endMatch || (() => {});
      window.endMatch = function(...args) {
        
        // Flush audit logs
        if (window.auditLogger) {
          window.auditLogger.flushQueue().then(() => {
          }).catch(err => {
            if(window._CRONOS_DEBUG) console.warn('[Sprint 3 Init] Error flushing logs before end:', err);
          });
        }
        
        // Limpiar estadísticas de render
        if (window.renderOptimizer) {
          const stats = window.renderOptimizer.getStats();
        }
        
        return origEndMatch.apply(this, args);
      };
      
      
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


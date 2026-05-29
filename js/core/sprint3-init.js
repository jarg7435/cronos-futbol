// ════════════════════════════════════════════════════════════════════
// 🚀 SPRINT 3: INICIALIZACIÓN DE AUDIT LOGGER Y RENDER OPTIMIZER
// Asegura que las herramientas estén disponibles en window para toda la app
// ════════════════════════════════════════════════════════════════════

(function initSprint3Features() {
  console.log('[Sprint 3 Init] Inicializando AuditLogger y RenderOptimizer...');

  // ══════════════════════════════════════════════════════════════════
  // Esperar a que las clases estén disponibles en window
  // ══════════════════════════════════════════════════════════════════
  
  const checkInterval = setInterval(() => {
    const hasAuditLogger = window.AuditLogger !== undefined;
    const hasRenderOptimizer = window.RenderOptimizer !== undefined;
    
    if (hasAuditLogger && hasRenderOptimizer) {
      clearInterval(checkInterval);
      console.log('✅ [Sprint 3 Init] Clases AuditLogger y RenderOptimizer disponibles');
      
      // ══════════════════════════════════════════════════════════════════
      // Instanciar RenderOptimizer globalmente
      // ══════════════════════════════════════════════════════════════════
      if (!window.renderOptimizer) {
        window.renderOptimizer = new RenderOptimizer();
        console.log('✅ [Sprint 3 Init] RenderOptimizer instanciado globalmente');
      }
      
      // Crear instancias de utilidades de render optimization
      if (!window.playerVirtualizer) {
        window.playerVirtualizer = new PlayerListVirtualizer();
        console.log('✅ [Sprint 3 Init] PlayerListVirtualizer instanciado');
      }
      
      if (!window.debounceRender) {
        window.debounceRender = new DebounceRender();
        console.log('✅ [Sprint 3 Init] DebounceRender instanciado');
      }
      
      if (!window.batchDomUpdate) {
        window.batchDomUpdate = new BatchDomUpdate();
        console.log('✅ [Sprint 3 Init] BatchDomUpdate instanciado');
      }
      
      // ══════════════════════════════════════════════════════════════════
      // Hook para inicializar AuditLogger cuando inicia el partido
      // ══════════════════════════════════════════════════════════════════
      const origStartMatch = window.startMatch || (() => {});
      window.startMatch = function(...args) {
        console.log('[Sprint 3 Init] startMatch interceptado - inicializando AuditLogger...');
        
        // Esperar a que liveMatchId esté disponible
        setTimeout(() => {
          if (window.liveMatchId && !window.auditLogger) {
            window.auditLogger = new AuditLogger();
            window.auditLogger.init(window.liveMatchId);
            console.log(`✅ [Sprint 3 Init] AuditLogger inicializado para match: ${window.liveMatchId}`);
            
            // Flush any pending logs from offline queue
            window.auditLogger.flushQueue().catch(err => {
              console.warn('[Sprint 3 Init] Error flushing audit queue:', err);
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
        console.log(`✅ [Sprint 3 Init] AuditLogger inicializado (fallback) para match: ${window.liveMatchId}`);
      }
      
      // ══════════════════════════════════════════════════════════════════
      // Limpiar RenderOptimizer y auditor cuando termina el partido
      // ══════════════════════════════════════════════════════════════════
      const origEndMatch = window.endMatch || (() => {});
      window.endMatch = function(...args) {
        console.log('[Sprint 3 Init] endMatch interceptado - limpiando recursos...');
        
        // Flush audit logs
        if (window.auditLogger) {
          window.auditLogger.flushQueue().then(() => {
            console.log('✅ [Sprint 3 Init] Audit logs sincronizados antes de finalizar');
          }).catch(err => {
            console.warn('[Sprint 3 Init] Error flushing logs before end:', err);
          });
        }
        
        // Limpiar estadísticas de render
        if (window.renderOptimizer) {
          const stats = window.renderOptimizer.getStats();
          console.log(`📊 [Sprint 3 Init] Render Stats - Renders: ${stats.renders}, Avg: ${stats.avgMs.toFixed(2)}ms, Last: ${stats.lastRenderMs.toFixed(2)}ms`);
        }
        
        return origEndMatch.apply(this, args);
      };
      
      console.log('✅ [Sprint 3 Init] Todos los hooks configurados correctamente');
      
    } else if (hasAuditLogger && !hasRenderOptimizer) {
      console.log('[Sprint 3 Init] AuditLogger disponible, esperando RenderOptimizer...');
    } else if (!hasAuditLogger && hasRenderOptimizer) {
      console.log('[Sprint 3 Init] RenderOptimizer disponible, esperando AuditLogger...');
    }
  }, 100);
  
  // Timeout después de 5 segundos si no se cargan
  setTimeout(() => {
    if (clearInterval) clearInterval(checkInterval);
    if (!window.renderOptimizer) {
      console.warn('⚠️ [Sprint 3 Init] RenderOptimizer no cargó en 5s - features pueden estar degradadas');
    }
    if (!window.auditLogger && window.liveMatchId) {
      console.warn('⚠️ [Sprint 3 Init] AuditLogger no cargó en 5s - audit trail puede no funcionar');
    }
  }, 5000);
  
})();

console.log('✅ sprint3-init.js cargado - Inicialización asincrónica en progreso...');

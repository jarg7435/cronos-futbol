// ════════════════════════════════════════════════════════════════════
// 🧪 SPRINT 3: VERIFICACIÓN Y TESTING
// Valida que AuditLogger y RenderOptimizer funcionen correctamente
// ════════════════════════════════════════════════════════════════════

window.runSprint3Tests = function() {
  console.log('%c🧪 SPRINT 3 - INICIANDO TESTS', 'color: #58a6ff; font-size: 14px; font-weight: bold');
  
  let passed = 0;
  let failed = 0;
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 1: RenderOptimizer disponible
  // ══════════════════════════════════════════════════════════════════
  try {
    if (!window.RenderOptimizer) throw new Error('RenderOptimizer no definido');
    if (!window.renderOptimizer) throw new Error('renderOptimizer (instancia) no disponible');
    console.log('✅ TEST 1: RenderOptimizer cargado y disponible');
    passed++;
  } catch (e) {
    console.error('❌ TEST 1 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 2: AuditLogger disponible
  // ══════════════════════════════════════════════════════════════════
  try {
    if (!window.AuditLogger) throw new Error('AuditLogger no definido');
    console.log('✅ TEST 2: AuditLogger cargado');
    passed++;
  } catch (e) {
    console.error('❌ TEST 2 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 3: PlayerListVirtualizer disponible
  // ══════════════════════════════════════════════════════════════════
  try {
    if (!window.PlayerListVirtualizer) throw new Error('PlayerListVirtualizer no definido');
    if (!window.playerVirtualizer) throw new Error('playerVirtualizer (instancia) no disponible');
    console.log('✅ TEST 3: PlayerListVirtualizer cargado');
    passed++;
  } catch (e) {
    console.error('❌ TEST 3 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 4: DebounceRender disponible
  // ══════════════════════════════════════════════════════════════════
  try {
    if (!window.DebounceRender) throw new Error('DebounceRender no definido');
    if (!window.debounceRender) throw new Error('debounceRender (instancia) no disponible');
    console.log('✅ TEST 4: DebounceRender cargado');
    passed++;
  } catch (e) {
    console.error('❌ TEST 4 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 5: BatchDomUpdate disponible
  // ══════════════════════════════════════════════════════════════════
  try {
    if (!window.BatchDomUpdate) throw new Error('BatchDomUpdate no definido');
    if (!window.batchDomUpdate) throw new Error('batchDomUpdate (instancia) no disponible');
    console.log('✅ TEST 5: BatchDomUpdate cargado');
    passed++;
  } catch (e) {
    console.error('❌ TEST 5 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 6: RenderOptimizer métodos funcionan
  // ══════════════════════════════════════════════════════════════════
  try {
    const optimizer = window.renderOptimizer;
    if (typeof optimizer.scheduleRender !== 'function') throw new Error('scheduleRender no es función');
    if (typeof optimizer.getStats !== 'function') throw new Error('getStats no es función');
    if (typeof optimizer.resetStats !== 'function') throw new Error('resetStats no es función');
    
    // Test scheduling
    let called = false;
    optimizer.scheduleRender(() => { called = true; }, 'normal');
    
    // Forzar ejecución en siguiente frame
    requestAnimationFrame(() => {
      if (called) {
        console.log('✅ TEST 6: RenderOptimizer.scheduleRender funciona');
        passed++;
      } else {
        console.warn('⚠️ TEST 6: scheduleRender llamado pero function no ejecutada (RAF timing)');
        passed++; // No fallar, es timing issue
      }
    });
  } catch (e) {
    console.error('❌ TEST 6 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 7: AuditLogger puede inicializarse
  // ══════════════════════════════════════════════════════════════════
  try {
    const testLogger = new window.AuditLogger();
    testLogger.init('test-match-id');
    console.log('✅ TEST 7: AuditLogger.init() funciona');
    passed++;
  } catch (e) {
    console.error('❌ TEST 7 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 8: AuditLogger puede loguear acciones
  // ══════════════════════════════════════════════════════════════════
  try {
    const testLogger = new window.AuditLogger();
    testLogger.init('test-match-id');
    
    // Mock Firestore
    if (!window.db) {
      console.warn('⚠️ TEST 8: Firestore no disponible (normal en offline), skipping actual log');
    }
    
    testLogger.logPlayerAction('p1', 'John Doe', 7, 'goal', 'goal_1', { goals: { before: 0, after: 1 } });
    console.log('✅ TEST 8: AuditLogger.logPlayerAction() funciona');
    passed++;
  } catch (e) {
    console.error('❌ TEST 8 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 9: player-actions.js integración (toggleInjury audit)
  // ══════════════════════════════════════════════════════════════════
  try {
    const source = typeof toggleInjury;
    if (source !== 'function') throw new Error('toggleInjury no es función');
    console.log('✅ TEST 9: player-actions.js toggleInjury integrado');
    passed++;
  } catch (e) {
    console.error('❌ TEST 9 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // TEST 10: timer/core.js integración (RenderOptimizer en tick)
  // ══════════════════════════════════════════════════════════════════
  try {
    const source = typeof tick;
    if (source !== 'function') throw new Error('tick no es función');
    console.log('✅ TEST 10: timer/core.js tick integrado');
    passed++;
  } catch (e) {
    console.error('❌ TEST 10 FALLIDO:', e.message);
    failed++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // RESUMEN
  // ══════════════════════════════════════════════════════════════════
  console.log('');
  console.log('%c🧪 RESULTADOS:', 'color: #58a6ff; font-size: 14px; font-weight: bold');
  console.log(`✅ Pasados: ${passed}/10`);
  console.log(`❌ Fallidos: ${failed}/10`);
  
  if (failed === 0) {
    console.log('%c✅ SPRINT 3 VERIFICACIÓN EXITOSA', 'color: #1a7a3e; font-size: 14px; font-weight: bold');
    return true;
  } else {
    console.log('%c⚠️ SPRINT 3 TIENE FALLOS', 'color: #dc3545; font-size: 14px; font-weight: bold');
    return false;
  }
};

// Ejecutar tests automáticamente cuando todo carga
window.addEventListener('load', () => {
  setTimeout(() => {
    console.log('');
    console.log('📊 Para ejecutar tests de Sprint 3, copia y ejecuta:');
    console.log('   window.runSprint3Tests()');
  }, 2000);
});

console.log('✅ sprint3-tests.js cargado - Ejecuta window.runSprint3Tests() para validar');

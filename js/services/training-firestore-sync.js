/**
 * training-firestore-sync.js — Sincronización de Planes de Entrenamiento
 * SPRINT 4 — BLOQUE C: Planes de entrenamiento persistentes en Firestore
 *
 * Sincroniza bidireccional: localStorage ↔ Firestore
 * Permite acceso multi-dispositivo a los planes semanales
 *
 * Uso:
 *   TrainingSync.saveWeek(weekKey, weekData)  // Guarda en local + Firestore
 *   TrainingSync.loadWeek(weekKey)            // Carga desde Firestore si existe
 *   TrainingSync.getAllWeeks()                 // Obtiene todas las semanas
 *   TrainingSync.deleteWeek(weekKey)          // Elimina semana
 *   TrainingSync.syncToFirestore()            // Sincroniza todo localStorage → Firestore
 */

const TrainingSync = (() => {
  'use strict';

  const FIREBASE_COLLECTION = 'trainingPlans';
  const LOCAL_STORAGE_KEY = 'cronos_training_weeks';
  const SYNC_TIMESTAMP_KEY = 'cronos_training_sync_ts';

  let _isInitialized = false;
  let _currentClubId = null;

  /**
   * Inicializa el módulo con clubId del usuario
   */
  function init(clubId) {
    if (!clubId) {
      console.warn('[TrainingSync] clubId requerido para inicializar');
      return false;
    }

    _currentClubId = clubId;
    _isInitialized = true;

    // Auto-sync al cargar
    setTimeout(() => {
      syncFromFirestore();
    }, 2000);

    console.log('[TrainingSync] Inicializado para club:', clubId);
    return true;
  }

  /**
   * Guarda una semana de entrenamiento en localStorage y Firestore
   */
  function saveWeek(weekKey, weekData) {
    if (!weekKey || !weekData) return false;

    // 1. Guardar en localStorage
    const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    allWeeks[weekKey] = weekData;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allWeeks));

    // 2. Guardar en Firestore si está disponible
    if (_isInitialized && window.db && _currentClubId) {
      saveWeekToFirestore(weekKey, weekData);
    }

    console.log('[TrainingSync] Semana guardada:', weekKey);
    return true;
  }

  /**
   * Carga una semana desde Firestore
   */
  function loadWeek(weekKey) {
    return new Promise((resolve, reject) => {
      if (!_isInitialized || !window.db || !_currentClubId) {
        // Fallback a localStorage
        const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
        resolve(allWeeks[weekKey] || null);
        return;
      }

      const docPath = `${FIREBASE_COLLECTION}/${_currentClubId}/weeks/${weekKey}`;
      window.db.collection('trainingPlans').doc(_currentClubId)
        .collection('weeks').doc(weekKey)
        .get()
        .then(doc => {
          if (doc.exists) {
            const data = doc.data();
            // Actualizar localStorage con datos de Firestore
            const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
            allWeeks[weekKey] = data;
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allWeeks));
            resolve(data);
          } else {
            const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
            resolve(allWeeks[weekKey] || null);
          }
        })
        .catch(err => {
          console.warn('[TrainingSync] Error cargando desde Firestore:', err);
          const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
          resolve(allWeeks[weekKey] || null);
        });
    });
  }

  /**
   * Obtiene todas las semanas
   */
  function getAllWeeks() {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
  }

  /**
   * Elimina una semana de entrenamiento
   */
  function deleteWeek(weekKey) {
    // 1. Eliminar de localStorage
    const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    delete allWeeks[weekKey];
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allWeeks));

    // 2. Eliminar de Firestore si está disponible
    if (_isInitialized && window.db && _currentClubId) {
      window.db.collection('trainingPlans').doc(_currentClubId)
        .collection('weeks').doc(weekKey)
        .delete()
        .catch(err => console.warn('[TrainingSync] Error eliminando en Firestore:', err));
    }

    console.log('[TrainingSync] Semana eliminada:', weekKey);
    return true;
  }

  /**
   * Sincroniza TODO localStorage → Firestore (operación de fondo)
   * Útil para backfill inicial o recuperación
   */
  function syncToFirestore() {
    if (!_isInitialized || !window.db || !_currentClubId) {
      console.warn('[TrainingSync] No se puede sincronizar sin Firestore');
      return Promise.reject('Firestore no disponible');
    }

    const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    const batch = window.db.batch();
    let count = 0;

    Object.entries(allWeeks).forEach(([weekKey, weekData]) => {
      const docRef = window.db.collection('trainingPlans').doc(_currentClubId)
        .collection('weeks').doc(weekKey);
      batch.set(docRef, {
        ...weekData,
        lastModified: new Date(),
        createdBy: window.currentUser?.uid || 'unknown'
      }, { merge: true });
      count++;
    });

    if (count === 0) {
      return Promise.resolve('No hay semanas para sincronizar');
    }

    return batch.commit()
      .then(() => {
        localStorage.setItem(SYNC_TIMESTAMP_KEY, Date.now().toString());
        console.log('[TrainingSync] Sincronizadas', count, 'semanas a Firestore');
        return `✅ ${count} semanas sincronizadas`;
      })
      .catch(err => {
        console.error('[TrainingSync] Error en sincronización:', err);
        return `❌ Error al sincronizar: ${err.message}`;
      });
  }

  /**
   * Sincroniza FROM Firestore → localStorage (descarga cambios remotos)
   */
  function syncFromFirestore() {
    if (!_isInitialized || !window.db || !_currentClubId) {
      return Promise.reject('Firestore no disponible');
    }

    return window.db.collection('trainingPlans').doc(_currentClubId)
      .collection('weeks')
      .get()
      .then(snapshot => {
        let count = 0;
        const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');

        snapshot.forEach(doc => {
          const weekKey = doc.id;
          const weekData = doc.data();

          // Merge: Firestore data sobreescribe localStorage si es más reciente
          if (!allWeeks[weekKey] || 
              (weekData.lastModified && new Date(weekData.lastModified) > new Date(allWeeks[weekKey].lastModified || 0))) {
            allWeeks[weekKey] = weekData;
            count++;
          }
        });

        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allWeeks));

        if (count > 0) {
          console.log('[TrainingSync] Descargadas', count, 'semanas desde Firestore');
        }

        return count;
      })
      .catch(err => {
        console.warn('[TrainingSync] Error descargando de Firestore:', err);
        return 0;
      });
  }

  /**
   * Guarda una semana en Firestore (función interna)
   */
  function saveWeekToFirestore(weekKey, weekData) {
    if (!window.db || !_currentClubId) return;

    window.db.collection('trainingPlans').doc(_currentClubId)
      .collection('weeks').doc(weekKey)
      .set({
        ...weekData,
        lastModified: new Date(),
        createdBy: window.currentUser?.uid || 'unknown'
      }, { merge: true })
      .catch(err => console.warn('[TrainingSync] Error guardando en Firestore:', err));
  }

  /**
   * Obtiene estadísticas de sincronización
   */
  function getStats() {
    const allWeeks = getAllWeeks();
    const lastSync = localStorage.getItem(SYNC_TIMESTAMP_KEY);

    return {
      totalWeeks: Object.keys(allWeeks).length,
      lastSyncTimestamp: lastSync ? parseInt(lastSync) : null,
      lastSyncDate: lastSync ? new Date(parseInt(lastSync)).toLocaleString('es-ES') : 'Nunca',
      firestoreAvailable: !!(_isInitialized && window.db && _currentClubId)
    };
  }

  // ── API Pública ──
  return {
    init: init,
    saveWeek: saveWeek,
    loadWeek: loadWeek,
    getAllWeeks: getAllWeeks,
    deleteWeek: deleteWeek,
    syncToFirestore: syncToFirestore,
    syncFromFirestore: syncFromFirestore,
    getStats: getStats
  };
})();

// Exportar globalmente
window.TrainingSync = TrainingSync;

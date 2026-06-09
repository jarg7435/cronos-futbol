/**
 * training-firestore-sync.js — Sincronización de Planes de Entrenamiento
 * SPRINT 4 — BLOQUE C: Planes de entrenamiento persistentes en Firestore
 *
 * Sincroniza bidireccional: localStorage ↔ Firestore (API Firebase v9 modular
 * vía window.saFS()). Permite acceso multi-dispositivo a los planes semanales.
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

  const LOCAL_STORAGE_KEY = 'cronos_training_weeks';
  const SYNC_TIMESTAMP_KEY = 'cronos_training_sync_ts';

  let _isInitialized = false;
  let _currentClubId = null;

  /**
   * Convierte serverTimestamp (Firestore) / Date / string a milisegundos
   * para poder comparar versiones local vs remota.
   */
  function _toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    const ms = new Date(ts).getTime();
    return isNaN(ms) ? 0 : ms;
  }

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
    if (_isInitialized && _currentClubId && window.saFS) {
      saveWeekToFirestore(weekKey, weekData);
    }

    console.log('[TrainingSync] Semana guardada:', weekKey);
    return true;
  }

  /**
   * Carga una semana desde Firestore (con fallback a localStorage)
   */
  async function loadWeek(weekKey) {
    const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');

    if (!_isInitialized || !_currentClubId || !window.saFS) {
      return allWeeks[weekKey] || null;
    }

    try {
      const { db, doc, getDoc } = await window.saFS();
      const snap = await getDoc(doc(db, 'trainingPlans', _currentClubId, 'weeks', weekKey));
      if (snap.exists()) {
        const data = snap.data();
        // Actualizar localStorage con datos de Firestore
        allWeeks[weekKey] = data;
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allWeeks));
        return data;
      }
      return allWeeks[weekKey] || null;
    } catch (err) {
      console.warn('[TrainingSync] Error cargando desde Firestore:', err);
      return allWeeks[weekKey] || null;
    }
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
    if (_isInitialized && _currentClubId && window.saFS) {
      (async () => {
        try {
          const { db, doc, deleteDoc } = await window.saFS();
          await deleteDoc(doc(db, 'trainingPlans', _currentClubId, 'weeks', weekKey));
        } catch (err) {
          console.warn('[TrainingSync] Error eliminando en Firestore:', err);
        }
      })();
    }

    console.log('[TrainingSync] Semana eliminada:', weekKey);
    return true;
  }

  /**
   * Sincroniza TODO localStorage → Firestore (operación de fondo)
   * Útil para backfill inicial o recuperación
   */
  async function syncToFirestore() {
    if (!_isInitialized || !_currentClubId || !window.saFS) {
      console.warn('[TrainingSync] No se puede sincronizar sin Firestore');
      return Promise.reject('Firestore no disponible');
    }

    const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    const entries = Object.entries(allWeeks);

    if (entries.length === 0) {
      return 'No hay semanas para sincronizar';
    }

    try {
      const { db, doc, setDoc, serverTimestamp } = await window.saFS();
      const uid = window._cronosCurrentUser?.uid || 'unknown';

      await Promise.all(entries.map(([weekKey, weekData]) =>
        setDoc(doc(db, 'trainingPlans', _currentClubId, 'weeks', weekKey), {
          ...weekData,
          lastModified: serverTimestamp(),
          createdBy: uid
        }, { merge: true })
      ));

      localStorage.setItem(SYNC_TIMESTAMP_KEY, Date.now().toString());
      console.log('[TrainingSync] Sincronizadas', entries.length, 'semanas a Firestore');
      return `✅ ${entries.length} semanas sincronizadas`;
    } catch (err) {
      console.error('[TrainingSync] Error en sincronización:', err);
      return `❌ Error al sincronizar: ${err.message}`;
    }
  }

  /**
   * Sincroniza FROM Firestore → localStorage (descarga cambios remotos)
   */
  async function syncFromFirestore() {
    if (!_isInitialized || !_currentClubId || !window.saFS) {
      return Promise.reject('Firestore no disponible');
    }

    try {
      const { db, collection, getDocs } = await window.saFS();
      const snapshot = await getDocs(collection(db, 'trainingPlans', _currentClubId, 'weeks'));

      let count = 0;
      const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');

      snapshot.forEach(d => {
        const weekKey = d.id;
        const weekData = d.data();

        // Merge: Firestore data sobreescribe localStorage si es más reciente
        const remoteMs = _toMillis(weekData.lastModified);
        const localMs = _toMillis(allWeeks[weekKey]?.lastModified);

        if (!allWeeks[weekKey] || remoteMs > localMs) {
          allWeeks[weekKey] = weekData;
          count++;
        }
      });

      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allWeeks));

      if (count > 0) {
        console.log('[TrainingSync] Descargadas', count, 'semanas desde Firestore');
      }

      return count;
    } catch (err) {
      console.warn('[TrainingSync] Error descargando de Firestore:', err);
      return 0;
    }
  }

  /**
   * Guarda una semana en Firestore (función interna)
   */
  async function saveWeekToFirestore(weekKey, weekData) {
    if (!_currentClubId || !window.saFS) return;

    try {
      const { db, doc, setDoc, serverTimestamp } = await window.saFS();
      await setDoc(doc(db, 'trainingPlans', _currentClubId, 'weeks', weekKey), {
        ...weekData,
        lastModified: serverTimestamp(),
        createdBy: window._cronosCurrentUser?.uid || 'unknown'
      }, { merge: true });
    } catch (err) {
      console.warn('[TrainingSync] Error guardando en Firestore:', err);
    }
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
      firestoreAvailable: !!(_isInitialized && _currentClubId && window.saFS)
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

// SPRINT 4: Hook central de inicialización de sync (llamado desde auth.js
// tras fijar window._cronosCurrentUser). Idempotente.
window._initSprint4Sync = function () {
  const me = window._cronosCurrentUser;
  if (!me || !me.uid) return;
  if (window.NotificationDismiss) window.NotificationDismiss.init(me.uid);
  if (window.TrainingSync && me.clubId) window.TrainingSync.init(me.clubId);
};

/**
 * notification-dismiss-sync.js — Sincronización de Descarte de Notificaciones
 * SPRINT 4 — BLOQUE C: Notificaciones dismissed sincronizadas en Firestore
 *
 * Permite que el descarte de notificaciones sea multi-dispositivo
 * Se guarda en Firestore campo 'dismissedBy' + fallback en localStorage
 *
 * Uso:
 *   NotificationDismiss.init(userId)
 *   NotificationDismiss.dismiss(notificationId)     // Descarta en Firestore + localStorage
 *   NotificationDismiss.isDismissed(notificationId) // Verifica si está descartado
 *   NotificationDismiss.getDismissedList()          // Lista de IDs descartados locales
 *   NotificationDismiss.sync()                      // Sincroniza desde Firestore
 */

const NotificationDismiss = (() => {
  'use strict';

  const FIRESTORE_COLLECTION = 'cronos_notifications';
  const LOCAL_STORAGE_KEY = 'cronos_dismissed_notifs';
  
  let _isInitialized = false;
  let _currentUserId = null;
  let _dismissedCache = []; // Cache local de IDs descartados

  /**
   * Inicializa el módulo con el userId del usuario actual
   */
  function init(userId) {
    if (!userId) {
      console.warn('[NotificationDismiss] userId requerido para inicializar');
      return false;
    }

    _currentUserId = userId;
    _isInitialized = true;

    // Cargar estado actual de localStorage
    _loadLocalDismissed();

    // Sincronizar con Firestore al inicializar
    if (window.db) {
      syncFromFirestore();
    }

    console.log('[NotificationDismiss] Inicializado para usuario:', userId);
    return true;
  }

  /**
   * Descarta una notificación (en Firestore + localStorage)
   */
  function dismiss(notificationId) {
    if (!notificationId) return false;

    // 1. Actualizar localStorage
    if (!_dismissedCache.includes(notificationId)) {
      _dismissedCache.push(notificationId);
      _saveLocalDismissed();
    }

    // 2. Actualizar en Firestore (async, sin esperar)
    if (_isInitialized && window.db && _currentUserId) {
      dismissInFirestore(notificationId);
    }

    console.log('[NotificationDismiss] Notificación descartada:', notificationId);
    return true;
  }

  /**
   * Verifica si una notificación está descartada
   */
  function isDismissed(notificationId) {
    return _dismissedCache.includes(notificationId);
  }

  /**
   * Obtiene la lista completa de notificaciones descartadas
   */
  function getDismissedList() {
    return [..._dismissedCache];
  }

  /**
   * Restaura una notificación (la vuelve a mostrar)
   */
  function restore(notificationId) {
    if (!notificationId) return false;

    const idx = _dismissedCache.indexOf(notificationId);
    if (idx !== -1) {
      _dismissedCache.splice(idx, 1);
      _saveLocalDismissed();
    }

    // Actualizar en Firestore (async)
    if (_isInitialized && window.db && _currentUserId) {
      restoreInFirestore(notificationId);
    }

    console.log('[NotificationDismiss] Notificación restaurada:', notificationId);
    return true;
  }

  /**
   * Sincroniza descarte desde Firestore (descarga lista de otros dispositivos)
   */
  function syncFromFirestore() {
    if (!_isInitialized || !window.db || !_currentUserId) {
      return Promise.resolve('Firestore no disponible');
    }

    return window.db.collection(FIRESTORE_COLLECTION)
      .where('dismissedBy', 'array-contains', _currentUserId)
      .get()
      .then(snapshot => {
        let syncedCount = 0;

        snapshot.forEach(doc => {
          const dismissedBy = doc.data().dismissedBy || [];
          if (dismissedBy.includes(_currentUserId)) {
            if (!_dismissedCache.includes(doc.id)) {
              _dismissedCache.push(doc.id);
              syncedCount++;
            }
          }
        });

        _saveLocalDismissed();

        if (syncedCount > 0) {
          console.log('[NotificationDismiss] Sincronizadas', syncedCount, 'notificaciones descartadas');
        }

        return syncedCount;
      })
      .catch(err => {
        console.warn('[NotificationDismiss] Error sincronizando desde Firestore:', err);
        return 0;
      });
  }

  /**
   * Actualiza el campo dismissedBy en Firestore (función interna)
   */
  function dismissInFirestore(notificationId) {
    if (!window.db || !_currentUserId) return;

    window.db.collection(FIRESTORE_COLLECTION).doc(notificationId)
      .update({
        dismissedBy: window.firebase.firestore.FieldValue.arrayUnion(_currentUserId)
      })
      .catch(err => {
        // Puede fallar si el documento no existe o sin permisos
        // Es OK - fallback a localStorage
        console.warn('[NotificationDismiss] No se pudo actualizar en Firestore:', err.message);
      });
  }

  /**
   * Restaura el campo dismissedBy en Firestore (función interna)
   */
  function restoreInFirestore(notificationId) {
    if (!window.db || !_currentUserId) return;

    window.db.collection(FIRESTORE_COLLECTION).doc(notificationId)
      .update({
        dismissedBy: window.firebase.firestore.FieldValue.arrayRemove(_currentUserId)
      })
      .catch(err => {
        console.warn('[NotificationDismiss] No se pudo restaurar en Firestore:', err.message);
      });
  }

  /**
   * Carga lista de descartados desde localStorage
   */
  function _loadLocalDismissed() {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      _dismissedCache = stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.warn('[NotificationDismiss] Error cargando localStorage:', e);
      _dismissedCache = [];
    }
  }

  /**
   * Guarda lista de descartados en localStorage
   */
  function _saveLocalDismissed() {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(_dismissedCache));
    } catch (e) {
      console.warn('[NotificationDismiss] Error guardando en localStorage:', e);
    }
  }

  /**
   * Obtiene estadísticas del módulo
   */
  function getStats() {
    return {
      initialized: _isInitialized,
      currentUserId: _currentUserId,
      dismissedCount: _dismissedCache.length,
      dismissedList: getDismissedList()
    };
  }

  /**
   * Limpia todo (para logout)
   */
  function clear() {
    _dismissedCache = [];
    _currentUserId = null;
    _isInitialized = false;
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch (e) {
      console.warn('[NotificationDismiss] Error limpiando localStorage:', e);
    }
    console.log('[NotificationDismiss] Módulo limpiado para logout');
  }

  // ── API Pública ──
  return {
    init: init,
    dismiss: dismiss,
    isDismissed: isDismissed,
    getDismissedList: getDismissedList,
    restore: restore,
    syncFromFirestore: syncFromFirestore,
    getStats: getStats,
    clear: clear
  };
})();

// Exportar globalmente
window.NotificationDismiss = NotificationDismiss;

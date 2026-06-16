/**
 * notification-dismiss-sync.js — Descarte de Notificaciones (capa localStorage)
 * SPRINT 4 — BLOQUE C
 *
 * NOTA (corrección post-Bloque C): la sincronización multi-dispositivo del
 * descarte de notificaciones la realiza el flujo nativo `ppDeleteNotif`
 * (js/parent/panel.js) usando `dismissedBy: arrayUnion(me.uid)` con la API
 * Firebase v9 modular. Este módulo queda como capa de descarte LOCAL
 * (localStorage) para respuesta inmediata en UI y como fuente de verdad local.
 *
 * Uso:
 *   NotificationDismiss.init(userId)
 *   NotificationDismiss.dismiss(notificationId)     // Descarta en localStorage
 *   NotificationDismiss.isDismissed(notificationId) // Verifica si está descartado
 *   NotificationDismiss.getDismissedList()          // Lista de IDs descartados locales
 *   NotificationDismiss.restore(notificationId)     // Restaura (vuelve a mostrar)
 */

const NotificationDismiss = (() => {
  'use strict';

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

    return true;
  }

  /**
   * Descarta una notificación (en localStorage)
   */
  function dismiss(notificationId) {
    if (!notificationId) return false;

    if (!_dismissedCache.includes(notificationId)) {
      _dismissedCache.push(notificationId);
      _saveLocalDismissed();
    }

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

    return true;
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
  }

  // ── API Pública ──
  return {
    init: init,
    dismiss: dismiss,
    isDismissed: isDismissed,
    getDismissedList: getDismissedList,
    restore: restore,
    getStats: getStats,
    clear: clear
  };
})();

// Exportar globalmente
window.NotificationDismiss = NotificationDismiss;

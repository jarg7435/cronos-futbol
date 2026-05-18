/**
 * 14_pseudonymizer.js — Servicio de Pseudonimización de Menores
 * ECOSISTEMA 4.0 — Fase 0: Emergencia Crítica
 *
 * Genera pseudónimos determinísticos para jugadores menores.
 * Los nombres reales SOLO se muestran al entrenador del mismo club.
 *
 * Uso:
 *   Pseudonymizer.maskPlayer(player, viewerClubId)
 *   Pseudonymizer.maskPlayers(playersArray, viewerClubId)
 *   Pseudonymizer.getPseudonym(realName, clubId)
 */

const Pseudonymizer = (() => {
  'use strict';

  // ── Diccionario de pseudónimos deportivos (30 base + variaciones numéricas) ──
  const DICT = [
    'Rayo', 'Turbo', 'Titan', 'Flecha', 'Aguila',
    'Trueno', 'Meteoro', 'Condor', 'Centella', 'Pantera',
    'Fenix', 'Bufalo', 'Cobra', 'Dragon', 'Halcon',
    'Jabali', 'Lince', 'Oso', 'Puma', 'Tigre',
    'Ventisca', 'Ciclon', 'Eclipse', 'Glaciar', 'Tornado',
    'Avalancha', 'Bolido', 'Cometa', 'Estela', 'Volcan'
  ];

  // Mapa persistente: clave → pseudonym (almacenado en localStorage)
  let _map = {};

  // Flag de inicialización
  let _initialized = false;

  // ── Hash determinístico: mismo nombre + club → mismo pseudónimo siempre ──
  function _hash(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) - h) + key.charCodeAt(i);
      h |= 0; // Convertir a 32-bit signed int
    }
    return Math.abs(h);
  }

  /**
   * Genera o recupera pseudónimo para un jugador
   */
  function getPseudonym(realName, clubId) {
    if (!realName) return 'Jugador';
    if (!clubId) return 'Jugador';

    const key = clubId + '_' + realName;

    if (_map[key]) return _map[key];

    const idx = _hash(key) % DICT.length;
    const basePseudonym = DICT[idx];

    let pseudonym = basePseudonym;
    let counter = 1;
    const usedPseudonyms = Object.values(_map);
    while (usedPseudonyms.includes(pseudonym)) {
      counter++;
      pseudonym = basePseudonym + counter;
    }

    _map[key] = pseudonym;
    _persist();

    return pseudonym;
  }

  /**
   * Revela nombre real SOLO si el usuario pertenece al mismo club del jugador.
   */
  function maskPlayer(player, viewerClubId) {
    if (!player) return player;

    // Mismo club → nombre real visible
    if (player.clubId && player.clubId === viewerClubId) {
      return player;
    }

    // SuperAdmin ve nombres reales (viewerClubId = 'superadmin')
    if (viewerClubId === 'superadmin') {
      return player;
    }

    // Otro club o espectador sin club → pseudonimizar
    const pseudonym = getPseudonym(player.name || '', player.clubId || '');

    const masked = Object.assign({}, player);
    masked.name = pseudonym;
    masked.pseudonym = pseudonym;

    // Eliminar campos sensibles
    delete masked.realName;
    delete masked.surname;
    delete masked.lastName;
    delete masked.firstName;
    delete masked.fullName;
    delete masked.dni;
    delete masked.email;
    delete masked.phone;
    delete masked.address;
    delete masked.birthDate;
    delete masked.parentName;
    delete masked.parentPhone;

    return masked;
  }

  /**
   * Procesa un array de jugadores para vista de espectador
   */
  function maskPlayers(players, viewerClubId) {
    if (!Array.isArray(players)) return players;
    return players.map(function(p) { return maskPlayer(p, viewerClubId); });
  }

  /**
   * Verifica si un jugador debe ser pseudonimizado
   */
  function shouldMask(player, viewerClubId) {
    if (!player || !player.clubId) return true;
    if (viewerClubId === 'superadmin') return false;
    return player.clubId !== viewerClubId;
  }

  /**
   * Obtiene el nombre a mostrar (versión ligera)
   */
  function getDisplayName(player, viewerClubId) {
    if (!player) return '';
    if (!shouldMask(player, viewerClubId)) {
      return player.name || '';
    }
    return getPseudonym(player.name || '', player.clubId || '');
  }

  /**
   * Limpia el mapa de pseudónimos (para logout)
   */
  function clearMap() {
    _map = {};
    try {
      localStorage.removeItem('cronos_pseudonym_map');
    } catch (e) {
      // Silenciar errores
    }
  }

  // ── Persistencia del mapa en localStorage ──
  function _persist() {
    try {
      localStorage.setItem('cronos_pseudonym_map', JSON.stringify(_map));
    } catch (e) {
      console.warn('[Pseudonymizer] Error persistiendo mapa:', e);
    }
  }

  function _load() {
    try {
      var stored = localStorage.getItem('cronos_pseudonym_map');
      if (stored) {
        _map = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[Pseudonymizer] Error cargando mapa:', e);
      _map = {};
    }
  }

  function init() {
    if (_initialized) return;
    _load();
    _initialized = true;
    console.log('[Pseudonymizer] Inicializado. Mapa tiene', Object.keys(_map).length, 'entradas');
  }

  // Inicializar automáticamente al cargar
  init();

  // ── API Pública ──
  return {
    getPseudonym: getPseudonym,
    maskPlayer: maskPlayer,
    maskPlayers: maskPlayers,
    shouldMask: shouldMask,
    getDisplayName: getDisplayName,
    clearMap: clearMap,
    init: init
  };
})();

// Exportar globalmente (patrón usado en el ecosistema)
window.Pseudonymizer = Pseudonymizer;
/**
 * 14_pseudonymizer.js — Servicio de Pseudonimización de Menores
 * SPRINT 4 — BLOQUE C: GDPR por Categoría de Rol
 *
 * Genera pseudónimos determinísticos para jugadores menores.
 * Visibilidad granular según role del usuario.
 * Soporta: name, email, phone, birthDate
 *
 * Roles soportados:
 *   - 'superadmin': Ve TODO sin filtrar
 *   - 'admin_club': Ve datos de su club completos
 *   - 'admin_individual': Ve datos de su federación
 *   - 'dir_deportivo': Ve casi todo excepto DNI
 *   - 'coordinador': Ve solo nombre/pseudónimo, NO emails/phones
 *   - 'entrenador': Ve name, phone, email, birthDate
 *   - 'padre': Ve solo nombre + datos contacto entrenador
 *
 * Uso:
 *   Pseudonymizer.maskPlayer(player, { role, clubId })
 *   Pseudonymizer.maskUser(user, { role, clubId })
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

  // ── Matriz de Visibilidad: ¿qué campos puede ver cada rol? ──
  const VISIBILITY_MATRIX = {
    player: {
      superadmin: ['name', 'email', 'phone', 'birthDate'],
      admin_club: ['name', 'email', 'phone', 'birthDate'],
      admin_individual: ['name', 'email', 'phone', 'birthDate'],
      dir_deportivo: ['name', 'email', 'phone', 'birthDate'],
      coordinador: ['pseudonym'], // SOLO pseudónimo, no nombre real
      entrenador: ['name', 'email', 'phone', 'birthDate'],
      padre: ['name', 'birthDate'] // padre ve nombre e edad, no email/phone del jugador
    },
    user: {
      superadmin: ['name', 'email', 'phone'],
      admin_club: ['name', 'email', 'phone'],
      admin_individual: ['name', 'email', 'phone'],
      dir_deportivo: ['name', 'email', 'phone'],
      coordinador: ['name'], // SOLO nombre, NO email/phone
      entrenador: ['name', 'email', 'phone'],
      padre: ['name', 'email', 'phone'] // padre puede ver contactos
    }
  };

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
   * Valida el contexto del viewer (role + clubId)
   */
  function _validateContext(context) {
    if (!context) return { role: 'public', clubId: null };
    return {
      role: context.role || 'public',
      clubId: context.clubId || null
    };
  }

  /**
   * ¿Puede este viewer ver este campo para este tipo de entidad?
   */
  function _canViewField(entityType, fieldName, viewerRole) {
    if (!entityType || !fieldName || !viewerRole) return false;

    const matrix = VISIBILITY_MATRIX[entityType] || {};
    const allowedFields = matrix[viewerRole] || [];

    return allowedFields.includes(fieldName);
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
   * Enmascara un jugador según rol + contexto
   * context = { role: 'entrenador', clubId: 'club-123' }
   */
  function maskPlayer(player, context) {
    if (!player) return player;

    const ctx = _validateContext(context);

    // Superadmin ve todo sin mascara
    if (ctx.role === 'superadmin') {
      return player;
    }

    // Coordinador ve solo pseudónimo
    if (ctx.role === 'coordinador') {
      const masked = { name: getPseudonym(player.name || '', player.clubId || '') };
      if (player.plantilla) masked.plantilla = player.plantilla;
      if (player.dorsal) masked.dorsal = player.dorsal;
      return masked;
    }

    // Resto de roles: aplicar matriz de visibilidad
    const masked = {};

    // Copiar solo campos permitidos
    ['name', 'email', 'phone', 'birthDate', 'plantilla', 'dorsal', 'posicion'].forEach(field => {
      if (player.hasOwnProperty(field)) {
        if (field === 'email' || field === 'phone' || field === 'birthDate') {
          // Campos sensibles: verificar matriz
          if (_canViewField('player', field, ctx.role)) {
            masked[field] = player[field];
          }
        } else {
          // Campos no sensibles: copiar siempre
          masked[field] = player[field];
        }
      }
    });

    // Si padre, no mostrar email/phone del jugador
    if (ctx.role === 'padre') {
      delete masked.email;
      delete masked.phone;
    }

    return masked;
  }

  /**
   * Enmascara un usuario (entrenador, padre, etc) según rol
   */
  function maskUser(user, context) {
    if (!user) return user;

    const ctx = _validateContext(context);

    // Superadmin ve todo
    if (ctx.role === 'superadmin') {
      return user;
    }

    const masked = {};

    ['name', 'email', 'phone'].forEach(field => {
      if (user.hasOwnProperty(field)) {
        if (_canViewField('user', field, ctx.role)) {
          masked[field] = user[field];
        }
      }
    });

    // Campos siempre visibles
    if (user.role) masked.role = user.role;
    if (user.clubId) masked.clubId = user.clubId;

    return masked;
  }

  /**
   * Procesa un array de jugadores para vista con contexto
   */
  function maskPlayers(players, context) {
    if (!Array.isArray(players)) return players;
    return players.map(function(p) { return maskPlayer(p, context); });
  }

  /**
   * Procesa un array de usuarios
   */
  function maskUsers(users, context) {
    if (!Array.isArray(users)) return users;
    return users.map(function(u) { return maskUser(u, context); });
  }

  /**
   * ¿Debe pseudonimizarse este jugador?
   * (Legacy: compatibilidad con código anterior)
   */
  function shouldMask(player, context) {
    const ctx = _validateContext(context);
    if (ctx.role === 'superadmin') return false;
    if (ctx.role === 'coordinador') return true; // Coordinador siempre ve pseudónimo
    return false;
  }

  /**
   * Obtiene el nombre a mostrar para un jugador
   */
  function getDisplayName(player, context) {
    if (!player) return '';

    const ctx = _validateContext(context);

    if (ctx.role === 'coordinador' || ctx.role === 'public') {
      return getPseudonym(player.name || '', player.clubId || '');
    }

    return player.name || '';
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
    maskUser: maskUser,
    maskUsers: maskUsers,
    shouldMask: shouldMask,
    getDisplayName: getDisplayName,
    clearMap: clearMap,
    init: init,
    // Métodos helper para debugging
    getVisibilityMatrix: function() { return VISIBILITY_MATRIX; },
    canViewField: _canViewField
  };
})();

// Exportar globalmente (patrón usado en el ecosistema)
window.Pseudonymizer = Pseudonymizer;
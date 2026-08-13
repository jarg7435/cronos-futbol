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

  // ══════════════════════════════════════════════════════════════════
  //  EL CUADRANTE ES POR EQUIPO (2026-08-13)
  // ══════════════════════════════════════════════════════════════════
  //  🔑🔑🔑 QUÉ ESTABA ROTO. trainingPlans/{clubId}/weeks/{lunes} es UN SOLO
  //  documento por club y semana, y TODOS los entrenadores del club escribían
  //  sus días en la raíz de ese documento. Comprobado por REST en producción:
  //  el club CD DÍA tiene semanas creadas por DOS uid distintos. Mientras
  //  planifica una sola persona no se nota; en cuanto dos entrenadores tocan
  //  la misma semana, el `setDoc({merge:true})` funde sus días y, si coinciden
  //  en fecha, el último guardado pisa al anterior SIN AVISO. Además la
  //  Planificación Semanal se envía a los padres: los del Alevín podían
  //  recibir los entrenamientos del Juvenil.
  //
  //  Los días pasan a colgar de `teams.<teamId>`. Compatible hacia atrás: si
  //  no hay nodo para mi equipo se leen los días sueltos de la raíz, que es
  //  exactamente lo que hay guardado hoy. No hace falta migrar nada.
  //
  //  ⚠️ EL FILTRO POR FORMATO DE FECHA NO ES DECORATIVO. En la raíz conviven
  //  `lastModified`, `createdBy` y ahora `teams`, y _getTrainingWeekText
  //  recorre las claves COMO SI TODAS FUERAN DÍAS. Hoy, en cuanto la semana
  //  baja de Firestore, el mensaje que se manda a los padres se lleva dos
  //  líneas de basura ("📅 undefined Invalid Date"). Todo lector pasa por
  //  aquí para que eso no pueda volver a ocurrir.
  const _RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

  function _soloDias(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(obj).forEach(k => { if (_RE_DIA.test(k)) out[k] = obj[k]; });
    return out;
  }

  // Clave del equipo de quien mira. Cadena vacía = no lleva equipo (director,
  // coordinador, administrador): ese caso conserva el comportamiento antiguo
  // y sigue trabajando sobre los días de la raíz.
  function _miEquipoId() {
    try {
      return (typeof window.cronosMyTeamId === 'function') ? (window.cronosMyTeamId() || '') : '';
    } catch (e) { return ''; }
  }

  // Días del equipo indicado dentro del documento de una semana.
  function _diasDeEquipo(weekDoc, teamId) {
    if (!weekDoc || typeof weekDoc !== 'object') return {};
    if (teamId && weekDoc.teams && weekDoc.teams[teamId]) return _soloDias(weekDoc.teams[teamId]);
    return _soloDias(weekDoc);          // legado: días sueltos en la raíz
  }

  // Documento de semana con los días de MI equipo sustituidos, conservando
  // intactos los de los demás equipos y los metadatos.
  function _conDiasDeEquipo(weekDoc, teamId, dias) {
    const base = (weekDoc && typeof weekDoc === 'object') ? weekDoc : {};
    if (!teamId) {
      // Sin equipo: se reemplazan los días de la raíz y se respeta lo demás.
      const out = {};
      Object.keys(base).forEach(k => { if (!_RE_DIA.test(k)) out[k] = base[k]; });
      return Object.assign(out, dias);
    }
    const teams = Object.assign({}, base.teams || {});
    teams[teamId] = dias;
    return Object.assign({}, base, { teams: teams });
  }

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
      if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[TrainingSync] clubId requerido para inicializar');
      return false;
    }

    _currentClubId = clubId;
    _isInitialized = true;

    // Auto-sync al cargar: esperar a que el ID token tenga claims FRESCOS
    // (Race B: el setTimeout fijo disparaba getDocs antes de que Firebase
    //  propagara los custom claims role/clubId → permission-denied espurio
    //  en el primer login tras asignarse claims).
    _whenTokenReady().then(() => syncFromFirestore());

    return true;
  }

  /**
   * Fuerza el refresco del ID token (custom claims role/clubId) antes de
   * consultar Firestore. Usa la MISMA vía que el resto del proyecto:
   * window._cronos_auth.auth.currentUser (SDK modular v10). Idempotente y
   * tolerante a fallos: si no hay user/token, no bloquea el flujo.
   */
  async function _whenTokenReady() {
    try {
      const fa = window._cronos_auth;
      const user = fa && fa.auth && fa.auth.currentUser;
      if (user && typeof user.getIdToken === 'function') {
        await user.getIdToken(true);   // force refresh → claims frescos
      }
    } catch (err) {
      console.warn('[TrainingSync] No se pudo refrescar el token:', err);
    }
  }

  /**
   * Días del cuadrante de MI equipo en una semana, leídos de localStorage.
   * Devuelve siempre un objeto { 'YYYY-MM-DD': {tipo,hora,lugar,…} }, nunca
   * null: los llamadores pintan tablas y un null les obliga a un guard extra.
   *
   * 🔑 ES EL ÚNICO LECTOR DEL CUADRANTE. La pantalla de planificación, el
   * texto que se envía a los padres, el copiar/pegar y la asistencia leen
   * todos por aquí; si cada uno destripara localStorage a su manera, el día
   * que cambie la forma del documento unos verían los días y otros no.
   */
  function readWeekDays(weekKey) {
    const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    return _diasDeEquipo(allWeeks[weekKey], _miEquipoId());
  }

  /**
   * Guarda los días de MI equipo en una semana (localStorage + Firestore).
   * `weekData` es el mapa de días tal cual lo construye la pantalla.
   */
  function saveWeek(weekKey, weekData) {
    if (!weekKey || !weekData) return false;

    const teamId = _miEquipoId();
    const dias   = _soloDias(weekData);

    // 1. Guardar en localStorage (misma forma que el documento de Firestore)
    const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    allWeeks[weekKey] = _conDiasDeEquipo(allWeeks[weekKey], teamId, dias);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allWeeks));

    // 2. Guardar en Firestore si está disponible
    if (_isInitialized && _currentClubId && window.saFS) {
      saveWeekToFirestore(weekKey, dias, teamId);
    }

    return true;
  }

  /**
   * Carga una semana desde Firestore (con fallback a localStorage).
   * Devuelve los días de MI equipo, no el documento crudo.
   */
  async function loadWeek(weekKey) {
    const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    const teamId = _miEquipoId();

    if (!_isInitialized || !_currentClubId || !window.saFS) {
      return _diasDeEquipo(allWeeks[weekKey], teamId);
    }

    try {
      const { db, doc, getDoc } = await window.saFS();
      const snap = await getDoc(doc(db, 'trainingPlans', _currentClubId, 'weeks', weekKey));
      if (snap.exists()) {
        const data = snap.data();
        // Actualizar localStorage con datos de Firestore
        allWeeks[weekKey] = data;
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allWeeks));
        return _diasDeEquipo(data, teamId);
      }
      return _diasDeEquipo(allWeeks[weekKey], teamId);
    } catch (err) {
      console.warn('[TrainingSync] Error cargando desde Firestore:', err);
      return _diasDeEquipo(allWeeks[weekKey], teamId);
    }
  }

  /**
   * Obtiene todas las semanas (documentos crudos, tal cual están guardados).
   */
  function getAllWeeks() {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
  }

  /**
   * Vacía el cuadrante de MI equipo en una semana.
   *
   * ⚠️ YA NO BORRA EL DOCUMENTO. Antes hacía deleteDoc del documento de la
   * semana entera: con el cuadrante compartido por club, un entrenador
   * pulsando "LIMPIAR" se llevaba por delante la planificación de TODOS sus
   * compañeros. Ahora sólo se retira el nodo del equipo propio.
   */
  function deleteWeek(weekKey) {
    const teamId = _miEquipoId();

    // 1. Eliminar de localStorage
    const allWeeks = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    if (!teamId) {
      delete allWeeks[weekKey];                       // sin equipo: como antes
    } else if (allWeeks[weekKey] && allWeeks[weekKey].teams) {
      delete allWeeks[weekKey].teams[teamId];
    } else if (allWeeks[weekKey]) {
      allWeeks[weekKey] = _conDiasDeEquipo(allWeeks[weekKey], teamId, {});
      delete allWeeks[weekKey].teams[teamId];
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allWeeks));

    // 2. Eliminar de Firestore si está disponible
    if (_isInitialized && _currentClubId && window.saFS) {
      (async () => {
        try {
          const fs = await window.saFS();
          const ref = fs.doc(fs.db, 'trainingPlans', _currentClubId, 'weeks', weekKey);
          if (!teamId) {
            await fs.deleteDoc(ref);
            return;
          }
          const patch = {};
          patch['teams.' + teamId] = fs.deleteField();
          patch.lastModified = fs.serverTimestamp();
          await fs.updateDoc(ref, patch);
        } catch (err) {
          console.warn('[TrainingSync] Error eliminando en Firestore:', err);
        }
      })();
    }

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

    await _whenTokenReady();

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
      }

      return count;
    } catch (err) {
      // permission-denied es ESPERADO de forma transitoria para coach/club_admin
      // cuyo ID token aun no tiene propagado el custom claim 'clubId' (ventana
      // tras la aprobacion). No es un fallo real: el sync se reintenta en el
      // siguiente arranque con el token ya refrescado. Se baja a console.debug
      // para no generar ruido de error en consola.
      if (err && err.code === 'permission-denied') {
      } else {
        console.warn('[TrainingSync] Error descargando de Firestore:', err);
      }
      return 0;
    }
  }

  /**
   * Guarda una semana en Firestore (función interna)
   */
  async function saveWeekToFirestore(weekKey, weekData, teamId) {
    if (!_currentClubId || !window.saFS) return;

    try {
      const { db, doc, setDoc, updateDoc, serverTimestamp } = await window.saFS();
      const ref = doc(db, 'trainingPlans', _currentClubId, 'weeks', weekKey);
      const uid = window._cronosCurrentUser?.uid || 'unknown';

      // Sin equipo (director o coordinador planificando para el club): se
      // conserva EXACTAMENTE el comportamiento anterior, días en la raíz.
      if (!teamId) {
        await setDoc(ref, {
          ...weekData,
          lastModified: serverTimestamp(),
          createdBy: uid
        }, { merge: true });
        return;
      }

      // 🔑 updateDoc CON RUTA PUNTEADA, no setDoc con merge, por dos razones:
      //   1. La ruta punteada REEMPLAZA el nodo del equipo entero, así que un
      //      día retirado del cuadrante desaparece de verdad. Un merge funde
      //      mapas y el día borrado sobreviviría para siempre.
      //   2. Sólo toca `teams.<miEquipo>`: la planificación del resto de
      //      entrenadores del club queda intacta pase lo que pase.
      // El teamId sale de cronosTeamSlug, que colapsa todo lo que no sea
      // [a-z0-9] en guiones: NO puede contener puntos y la ruta no se rompe.
      const patch = {};
      patch['teams.' + teamId] = weekData;
      patch.lastModified = serverTimestamp();
      patch.createdBy = uid;

      try {
        await updateDoc(ref, patch);
      } catch (err) {
        // El documento de la semana todavía no existe: updateDoc no lo crea.
        if (err && err.code === 'not-found') {
          const inicial = { teams: {}, lastModified: serverTimestamp(), createdBy: uid };
          inicial.teams[teamId] = weekData;
          await setDoc(ref, inicial, { merge: true });
        } else {
          throw err;
        }
      }
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
    readWeekDays: readWeekDays,
    getAllWeeks: getAllWeeks,
    deleteWeek: deleteWeek,
    syncToFirestore: syncToFirestore,
    syncFromFirestore: syncFromFirestore,
    getStats: getStats,
    // Expuestos para la asistencia (que necesita las sesiones de la semana)
    // y para los guards. Son funciones puras.
    _diasDeEquipo: _diasDeEquipo,
    _soloDias: _soloDias
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

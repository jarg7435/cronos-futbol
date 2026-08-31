const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

/* ══════════════════════════════════════════════════════════════════════
   🔴🔴 v633 · firebase-admin 14 BORRO LA API CON ESPACIO DE NOMBRES

   `admin.firestore()`, `admin.auth()` y `admin.firestore.FieldValue` YA NO
   EXISTEN en la v14: el export de raiz solo trae initializeApp/getApp/cert.
   Todo lo demas se pide por su propia puerta (`firebase-admin/firestore`,
   `firebase-admin/auth`).

   🚨 Y ASI ES COMO SE MANIFESTO: **el deploy dijo "Successful update"**.
   Es un fallo de EJECUCION, no de compilacion, asi que nada se quejo hasta
   que alguien pulso el boton. Cada funcion que tocaba Firestore o Auth
   moria con `TypeError: admin.firestore is not a function` y devolvia un
   500 — o sea, el backend ENTERO: 40 usos de firestore(), 10 de auth() y
   21 de FieldValue. Se vio por el correo de invitacion porque es lo que se
   estaba probando, pero el correo no tenia nada que ver.

   🔑 SE ADAPTA AQUI, EN UN SITIO, en vez de reescribir 71 puntos de
   llamada. Reescribirlos seria 71 ocasiones de equivocarse a cambio de
   ningun beneficio: estas tres lineas dan exactamente la misma API.

   ⚠️ `admin.firestore` tiene que ser FUNCION **Y** ESPACIO DE NOMBRES a la
   vez: se usa como `admin.firestore()` (40 veces) y como
   `admin.firestore.FieldValue.serverTimestamp()` (21). Por eso el
   Object.assign — una funcion pelada dejaria las 21 en `undefined`, y ese
   fallo se veria igual de tarde que este.

   Guard: scripts/test_functions_api_admin.js
   ══════════════════════════════════════════════════════════════════════ */
const { getFirestore, FieldValue, Timestamp, FieldPath, GeoPoint } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');
if (typeof admin.firestore !== 'function') {
  admin.firestore = Object.assign(() => getFirestore(), { FieldValue, Timestamp, FieldPath, GeoPoint });
}
if (typeof admin.auth !== 'function') {
  admin.auth = () => getAuth();
}
/* 🔔 v644 · MISMA PUERTA PARA MENSAJERIA. `admin.messaging()` tampoco existe
   en la v14, y el aviso push del SuperAdmin la usa. Se anyade aqui, con los
   otros dos, y NO en el punto de llamada: el dia que se escriba un segundo
   uso, quien lo escriba encontrara la forma de siempre. El `if` es el de
   4a del guard: si la API vuelve algun dia, esto no la pisa. */
if (typeof admin.messaging !== 'function') {
  admin.messaging = () => getMessaging();
}

/* ----------------------------------------------------------- */
/* Diccionario de pseudónimos (server-side — coincidir con cliente) */
/* ----------------------------------------------------------- */
const PSEUDONYM_DICT = [
  'Rayo', 'Turbo', 'Titan', 'Flecha', 'Aguila',
  'Trueno', 'Meteoro', 'Condor', 'Centella', 'Pantera',
  'Fenix', 'Bufalo', 'Cobra', 'Dragon', 'Halcon',
  'Jabali', 'Lince', 'Oso', 'Puma', 'Tigre',
  'Ventisca', 'Ciclon', 'Eclipse', 'Glaciar', 'Tornado',
  'Avalancha', 'Bolido', 'Cometa', 'Estela', 'Volcan'
];

/* ----------------------------------------------------------- */
/* Hash determinístico server-side (debe coincidir con el cliente) */
/* ----------------------------------------------------------- */
function _serverHash(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h) + key.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/* ----------------------------------------------------------- */
/* Genera pseudónimo server-side */
/* ----------------------------------------------------------- */
function _serverPseudonym(name, clubId) {
  if (!name || !clubId) return 'Jugador';
  const key = clubId + '_' + name;
  const idx = _serverHash(key) % PSEUDONYM_DICT.length;
  return PSEUDONYM_DICT[idx];
}

/* ----------------------------------------------------------- */
/* Lista de campos sensibles que nunca deben salir del servidor */
/* ----------------------------------------------------------- */
const SENSITIVE_FIELDS = [
  'realName', 'surname', 'lastName', 'firstName', 'fullName',
  'dni', 'email', 'phone', 'address', 'birthDate',
  'parentName', 'parentPhone', 'parentId'
];

function _stripSensitiveFields(player) {
  const safe = Object.assign({}, player);
  SENSITIVE_FIELDS.forEach(function(field) { delete safe[field]; });
  return safe;
}

// 🔒 ¿Puede el LLAMANTE administrar la entidad `targetClubId`?
//
// ⚠️⚠️ ESTA FUNCIÓN AUTORIZA BORRADOS DE CUENTA. Se escribió (v610/v611) con
//    tres comodines `!targetClubId || !callerClubId || !r.clubId` que la
//    volvían FAIL-OPEN: cuando el club del objetivo no se lograba resolver
//    —cosa habitual, porque NINGÚN cliente envía `clubId` y el uid recibido
//    puede ser el de un doc secundario que no existe en `users/{uid}`— el
//    `!targetClubId` daba `true` y CUALQUIER administrador de CUALQUIER club
//    quedaba autorizado a borrar a esa persona. Es justo el aislamiento por
//    entidad que se auditó en v584/v585.
//
// 🔑 La comparación es OBLIGATORIA: sin club resuelto no hay autorización.
//    El superadmin ya ha salido antes; para todos los demás, "no sé de qué
//    club es" tiene que significar NO, nunca SÍ.
/* ====================================================================== */
/* 🛡️ SEC-C1c (auditoria 2026-08-26) · LA IDENTIDAD SE LEE DEL TOKEN,     */
/*    NUNCA DEL DOCUMENTO                                                 */
/*                                                                        */
/* EL DEFECTO, y estaba repetido en CINCO funciones: todas decidian si    */
/* quien llamaba era SuperAdmin —o administrador de un club— leyendo      */
/* `users/{callerUid}.role`. Y ese documento LO ESCRIBE EL PROPIO USUARIO:*/
/* la regla `allow create` de users deja crear el tuyo con los campos que */
/* quieras salvo isAuthorized/status (y, desde SEC-C1b, salvo el `role`   */
/* 'superadmin'/'admin'). El `clubId` del alta lo elige el propio usuario   */
/* del desplegable, asi que no se restringe — pero YA NO CONCEDE NADA por   */
/* si solo: los predicados que lo leen (userDocClubId, isClubDirectorOf,    */
/* isClubCoordinatorOf) exigen isAuthorized:true, y desde aqui abajo        */
/* tambien lo exige _cuentaHabilitada.                                      */
/*                                                                        */
/* O sea que una cuenta recien registrada podia declararse                */
/* `role:'club_admin', clubId:'<club ajeno>'` y con eso pasar             */
/* _callerHasClubPermission -> BORRAR cuentas de Auth de ese club         */
/* (deleteAuthUser) o archivar a sus entrenadores.                        */
/*                                                                        */
/* 🔑 EL TOKEN NO SE PUEDE FALSIFICAR. Los custom claims solo los escribe */
/* el Admin SDK, asi que `context.auth.token.role` es la unica fuente     */
/* fiable. Como respaldo se admite el correo en cronos_config/superadmins,*/
/* que es la misma lista que consultan las reglas (isSuperAdminEmail) y   */
/* que tambien escribe solo un SuperAdmin.                                */
/*                                                                        */
/* ⚠️ Y PARA LO QUE SIGUE LEYENDOSE DEL DOCUMENTO —el club de un director,*/
/* que no viaja en el token— se exige ademas CUENTA HABILITADA. Un        */
/* documento recien creado nace con isAuthorized:false, asi que deja de   */
/* servir para nada.                                                      */
/* ====================================================================== */
async function _esSuperAdmin(context) {
  if (!context || !context.auth) return false;
  const tk = context.auth.token || {};
  if (tk.role === 'superadmin') return true;          // claim: no falsificable
  const email = tk.email;
  if (!email) return false;
  try {
    const snap = await admin.firestore().doc('cronos_config/superadmins').get();
    const emails = (snap.exists && Array.isArray(snap.data().emails)) ? snap.data().emails : [];
    return emails.includes(email);
  } catch (e) {
    // ⚠️ FALLA HACIA EL "NO". Aqui un error de lectura no puede conceder
    // privilegios: es exactamente lo contrario de lo que hacen los extras.
    console.warn('[_esSuperAdmin] no se pudo leer cronos_config/superadmins:', e.message);
    return false;
  }
}

/* Una cuenta que todavia no ha aprobado el SuperAdmin no autoriza NADA. */
function _cuentaHabilitada(d) {
  return !!d && d.isAuthorized === true &&
         d.status !== 'removed' && d.status !== 'blocked' && d.status !== 'rejected';
}

/* ══════════════════════════════════════════════════════════════════════
   🔒 SEC-F01 (Paso 3, auditoria 2026-08-31) · UNA PLAZA VIVA SE PRUEBA,
      NO SE PRESUME

   Cinco sitios decidian con `r.isAuthorized !== false`. Eso es FAIL-OPEN, la
   leccion de v617: en algo que AUTORIZA, «no se» se convierte en SI. Una
   entrada de `allRoles` SIN el campo pasaba por autorizada.

   🚨🚨 Y NO ERA TEORICO, porque el usuario PUEDE escribir su propio
   `allRoles`: el `allow update` de `users/{userId}` prohibe tocar `role`,
   `isAuthorized`, `status`, `clubId`… pero **`allRoles` no esta en esa
   lista** (se dejo abierto a proposito para poder anyadir plazas
   PENDIENTES). La cadena completa que esto cierra:

     1. Ser director AUTORIZADO del club A.
     2. Anyadirse a mano una entrada `{ clubId: 'CLUB_B' }` sin
        `isAuthorized` — permitido por las reglas.
     3. Llamar a `syncRootClubId({ clubId: 'CLUB_B' })`: su comprobacion
        `isAuthorized !== false` daba VERDADERO sobre esa entrada.
     4. La funcion escribe el `clubId` de la RAIZ con el Admin SDK, que NO
        pasa por las reglas — justamente el campo que las reglas prohiben
        que el usuario se cambie.
     5. `isClubDirectorOf('CLUB_B')` lee la raiz y ya da VERDADERO:
        **director de un club ajeno.**

   🔑 SE ARREGLA EN UNA FUNCION Y NO EN CINCO SITIOS, para que el proximo
   que pregunte por una plaza herede la regla sin acordarse de ella.

   ⚠️ SE ADMITE EL ALIAS `authorized`, como ya hacia
   `_callerHasClubPermission`: hay datos antiguos que lo usan y exigir solo
   `isAuthorized` dejaria fuera plazas legitimas.

   ⚠️ MEDIDO ANTES DE APRETAR (produccion, 2026-08-31): 13 entradas de
   `allRoles` en 7 usuarios — 10 con `isAuthorized:true`, 3 con `false` y
   **NINGUNA sin el campo**. O sea que pasar de `!== false` a `=== true` no
   deja fuera ni una plaza legitima de las que hay hoy.

   Guard: scripts/test_functions_plaza_viva.js
   ══════════════════════════════════════════════════════════════════════ */
function _plazaViva(r) {
  return !!r &&
         (r.isAuthorized === true || r.authorized === true) &&
         r.status !== 'rejected' && r.status !== 'removed';
}

/* `esSA` llega YA RESUELTO desde el token (ver _esSuperAdmin). Esta funcion
   ya no decide sobre el rol de SuperAdmin por su cuenta. */
function _callerHasClubPermission(callerDoc, targetClubId, esSA) {
  if (esSA === true) return true;
  if (!callerDoc || !callerDoc.exists) return false;
  const callerData = callerDoc.data() || {};

  // 🛡️ SEC-C1c · sin cuenta habilitada no hay permiso por documento.
  if (!_cuentaHabilitada(callerData)) return false;

  // Sin club de destino no se puede comprobar nada: se deniega.
  if (!targetClubId) return false;
  const objetivo = String(targetClubId);

  const validRoles = ['club_admin', 'individual_admin', 'director', 'coordinator'];
  const callerRole = callerData.role;
  const callerClubId = callerData.clubId || callerData.individualEntityId;

  if (validRoles.includes(callerRole) && callerClubId && String(callerClubId) === objetivo) {
    return true;
  }

  const allRoles = Array.isArray(callerData.allRoles) ? callerData.allRoles : [];
  return allRoles.some(r =>
    r && r.status !== 'removed' && (r.isAuthorized === true || r.authorized === true) &&
    validRoles.includes(r.role) &&
    r.clubId && String(r.clubId) === objetivo
  );
}

/* ══════════════════════════════════════════════════════════════════════
   🛡️ v646 · APP CHECK TAMBIEN EN LAS CLOUD FUNCTIONS

   La v634 encendio App Check en el CLIENTE (firebase-init.js y live.html,
   reCAPTCHA v3) y puso en ENFORCED los dos servicios que se administran
   desde la consola: `firestore` e `identitytoolkit`. Pero se quedo FUERA
   la tercera puerta, que es esta.

   🔑🔑 LAS CALLABLE NO SE PROTEGEN DESDE LA CONSOLA. Firestore e Identity
   Toolkit tienen un interruptor de obligatoriedad en Firebase Console;
   `cloudfunctions` NO. Para una funcion invocable la obligatoriedad se
   escribe EN EL CODIGO — y como aqui no estaba escrita, las once callable
   quedaban abiertas a cualquiera con la apiKey publica (que va en el HTML)
   y una cuenta: `curl` contra
   https://us-central1-cronos-futbol-app.cloudfunctions.net/<nombre>
   entraba sin pasar por reCAPTCHA. El aislamiento por rol seguia en pie
   —de eso se ocupan `_esSuperAdmin` y compania—, pero el cedazo antiabuso
   que si defiende a Firestore no cubria ni un solo punto de este fichero.

   ⚠️ EL TOKEN LLEGA SOLO: el SDK de Functions del navegador adjunta el de
   App Check cuando la app de Firebase lo tiene inicializado. Los dos sitios
   que crean el objeto `functions` lo hacen sobre ESA misma app
   (`getFunctions(app)` en firebase-init.js:234 y `getFunctions(getApp())`
   en el cargador perezoso de saFS), asi que no hay nada que anyadir en el
   cliente. Si algun dia alguien crea una segunda app de Firebase y pide
   ahi las funciones, sus llamadas se caeran por aqui.

   🔑 POR QUE ESTE AYUDANTE Y NO `runWith({ enforceAppCheck: true })`
   El interruptor de plataforma existe y hace lo mismo, pero obliga a tocar
   las once firmas de exportacion —once ocasiones de equivocarse, la
   leccion de v633— y no deja medir antes de cortar. Aqui hay UN sitio, con
   un modo, que se puede leer de un vistazo y revertir en un caracter.

   ⚠️⚠️ LA VUELTA ATRAS, QUE HACE FALTA TENER A MANO: si reCAPTCHA se cae o
   el intercambio de token entra en throttle, el cliente se queda sin token
   y TODAS las callable dirian que no — no se podria aprobar a nadie, ni
   invitar, ni borrar. En el cliente un fallo de App Check no puede tumbar
   el arranque (try/catch que no relanza, v634); aqui el equivalente es
   poner `APPCHECK_MODO` en 'monitor' y volver a desplegar: sigue anotando
   quien llega sin token, pero deja pasar.

   ⚠️ 'monitor' es tambien el modo con el que se MIDE antes de cortar: deja
   en el registro una linea `[AppCheck] SIN TOKEN` por llamada sin
   atestiguar. Recordatorio de v640: `functions:log` devuelve ventanas
   desfasadas — leerlo en la consola de Cloud Logging, no por la CLI.

   Guard: scripts/test_app_check.js (seccion 5)
   ══════════════════════════════════════════════════════════════════════ */
const APPCHECK_MODO = 'enforce';   // 'enforce' | 'monitor' | 'off'

function _exigirAppCheck(context, nombre) {
  // `context.app` solo viene relleno cuando la peticion trajo un token de
  // App Check VALIDO. Sin token, o con uno invalido, llega `undefined`.
  if (context && context.app) return;

  if (APPCHECK_MODO !== 'enforce') {
    console.warn('[AppCheck] SIN TOKEN en ' + nombre + ' (modo ' + APPCHECK_MODO +
                 ': se deja pasar). uid=' + ((context && context.auth && context.auth.uid) || '-'));
    return;
  }

  console.warn('[AppCheck] DENEGADA ' + nombre + ': peticion sin token de App Check. uid=' +
               ((context && context.auth && context.auth.uid) || '-'));
  // `failed-precondition` y no `permission-denied` a proposito: no es que a
  // esta persona le falte un permiso, es que la peticion no viene de la app.
  throw new functions.https.HttpsError(
    'failed-precondition',
    'Peticion no verificada (App Check). Vuelve a abrir la aplicación desde su dirección habitual.'
  );
}

/* ==================================================================== */
/* 0️⃣ Cloud Function: setCustomClaims – Asignar Custom Claims (roles) a un usuario  */
/* ==================================================================== */
exports.setCustomClaims = functions.https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'setCustomClaims');
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Debes estar autenticado para realizar esta acción'
    );
  }

  /* 🛡️ SEC-C1c · ANTES esto leia `users/{caller}.role` — un campo que
     escribe el propio usuario al registrarse. Era la segunda mitad de la
     escalada a SuperAdmin: bastaba crearse el documento diciendo
     'superadmin' y llamar aqui para recibir el claim DE VERDAD.
     Ahora la identidad sale del TOKEN (o de cronos_config/superadmins). */
  if (!(await _esSuperAdmin(context))) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo SuperAdmin puede asignar roles'
    );
  }

  const { uid, role, clubId } = data;

  if (!uid || !role) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Se requieren uid y role'
    );
  }

  const validRoles = ['superadmin', 'club_admin', 'individual_admin', 'individual', 'director', 'coordinator', 'user', 'parent', 'spectator'];
  if (!validRoles.includes(role)) {
    // SEC-H02: Do not expose valid roles in error response
    throw new functions.https.HttpsError('invalid-argument', 'Rol invalido');
  }

  const claims = {
    role: role,
    clubId: clubId || null,
    claimsSetAt: Date.now()
  };

  try {
    await admin.auth().setCustomUserClaims(uid, claims);

    // FIX: Actualizar Firestore con isAuthorized y status para superadmin
    // Antes solo se actualizaba role y clubId, dejando isAuthorized:false
    // lo que causaba que el superadmin quedara bloqueado en checkAuthorization()
    const updateData = {
      role: role,
      clubId: clubId || null,
      claimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (role === 'superadmin') {
      updateData.isAuthorized = true;
      updateData.status = 'active';
      console.log('[setCustomClaims] SuperAdmin detectado — forzando isAuthorized=true, status=active');
    }

    await admin.firestore()
      .collection('users')
      .doc(uid)
      .update(updateData);

    console.log('[setCustomClaims] Claims asignados:', { uid, role, clubId });

    return { success: true, uid, role, clubId };
  } catch (error) {
    // SEC-H01: Generic error message; full detail stays in server log
    console.error('[setCustomClaims] Error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Error interno. Contacte al administrador.'
    );
  }
});

/* ==================================================================== */
/* 1️⃣ Cloud Function: getMatchForSpectator – Pseudonimización para espectadores */
/* ==================================================================== */
exports.getMatchForSpectator = functions.https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'getMatchForSpectator');
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado');
  }

  const { matchId } = data;
  if (!matchId) {
    throw new functions.https.HttpsError('invalid-argument', 'Se requiere matchId');
  }

  const matchDoc = await admin.firestore().collection('matches').doc(matchId).get();
  if (!matchDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Partido no encontrado');
  }

  const matchData = matchDoc.data();
  const viewerRole = context.auth.token.role || null;

  // SEC-020: Only superadmin gets raw data; all other roles (including same-club) are pseudonymized
  if (viewerRole === 'superadmin') return matchData;

  const playersSnapshot = await admin.firestore()
    .collection('players')
    .where('matchId', '==', matchId)
    .get();

  const pseudonymizedPlayers = [];
  playersSnapshot.forEach(doc => {
    const p = doc.data();
    const pseudonym = _serverPseudonym(p.name || '', p.clubId || '');
    const safe = _stripSensitiveFields(p);
    safe.name = pseudonym;
    safe.pseudonym = pseudonym;
    pseudonymizedPlayers.push(safe);
  });

  const result = Object.assign({}, matchData);
  result.players = pseudonymizedPlayers;
  delete result.homeTeamRoster;
  delete result.awayTeamRoster;

  return result;
});

/* ==================================================================== */
/* 2️⃣ Cloud Function: onPlayerCreate – Guardar pseudónimo en mapa */
/* ==================================================================== */
exports.onPlayerCreate = functions.firestore
  .document('players/{playerId}')
  .onCreate(async (snap, context) => {
    const playerData = snap.data();

    if (!playerData.name || !playerData.clubId) return null;

    const key = playerData.clubId + '_' + playerData.name;
    const pseudonym = _serverPseudonym(playerData.name, playerData.clubId);

    try {
      // SEC-H05: Do NOT store realName — only pseudonym and clubId
      await admin.firestore()
        .collection('pseudonym_map')
        .doc(key)
        .set({
          clubId: playerData.clubId,
          pseudonym: pseudonym,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
      console.error('[onPlayerCreate] Error guardando pseudonym_map:', error);
    }

    return null;
  });

/* ==================================================================== */
/* 2️⃣b Cloud Function: syncClubPublic - Espejo publico de clubs */
/* ==================================================================== */
/* Mantiene la coleccion clubs_public (lectura publica, solo name/type/  */
/* status) sincronizada con clubs. Permite que el formulario de registro */
/* liste los clubes disponibles SIN autenticacion, sin exponer el resto  */
/* de campos sensibles de clubs (slots, adminEmail, plan, etc.).         */
exports.syncClubPublic = functions.firestore
  .document('clubs/{clubId}')
  .onWrite(async (change, context) => {
    const clubId = context.params.clubId;
    const publicRef = admin.firestore().collection('clubs_public').doc(clubId);

    // Documento eliminado -> borrar el espejo
    if (!change.after.exists) {
      try {
        await publicRef.delete();
      } catch (error) {
        console.error('[syncClubPublic] Error eliminando espejo:', error);
      }
      return null;
    }

    const data = change.after.data() || {};

    // Solo se exponen 3 campos publicos.
    const publicData = {
      name: data.name || null,
      type: data.type || 'club',
      status: data.status || 'active'
    };

    try {
      await publicRef.set(publicData);
    } catch (error) {
      console.error('[syncClubPublic] Error escribiendo espejo:', error);
    }

    return null;
  });

/* ==================================================================== */
/* 3️⃣ Cloud Function: deleteUserData – Limpiar datos en Firestore al eliminar usuario Auth */
/* ==================================================================== */
exports.deleteUserData = functions.auth.user().onDelete(async (user) => {
  const uid = user.uid;

  try {
    await admin.firestore().collection('users').doc(uid).delete();

    const requests = await admin.firestore()
      .collection('platform_requests')
      .where('uid', '==', uid)
      .get();

    const batch = admin.firestore().batch();
    requests.forEach(doc => { batch.delete(doc.ref); });

    if (!requests.empty) await batch.commit();

    console.log('[deleteUserData] Datos eliminados para uid:', uid);
  } catch (error) {
    console.error('[deleteUserData] Error:', error);
  }

  return null;
});

/* ==================================================================== */
/* 4️⃣ Cloud Function: deleteAuthUser – Eliminar usuario de Firebase Auth  */
/* ==================================================================== */
exports.deleteAuthUser = functions.https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'deleteAuthUser');
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const callerUid = context.auth.uid;
  const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
  if (!callerDoc.exists) {
    throw new functions.https.HttpsError('permission-denied', 'Permisos insuficientes');
  }

  const { uid, email } = data || {};
  if (!uid || !email) {
    throw new functions.https.HttpsError('invalid-argument', 'uid y email son requeridos');
  }

  // 🔑 El club del OBJETIVO se resuelve SIEMPRE contra el servidor, nunca con
  //    el `data.clubId` que manda el cliente: quien llama no puede declarar de
  //    qué club es su víctima y autorizarse solo. (Es la misma política que ya
  //    dejó escrita la versión anterior de esta función.)
  //
  //    Se busca en dos sitios, porque el uid recibido puede ser el de un doc
  //    secundario y `users/{uid}` no existir — ese hueco era justo el que
  //    dejaba el club sin resolver y abría el fail-open de arriba.
  let targetClubId = null;
  try {
    const targetDoc = await admin.firestore().collection('users').doc(uid).get();
    if (targetDoc.exists) {
      targetClubId = targetDoc.data().clubId || targetDoc.data().individualEntityId || null;
    }
    if (!targetClubId) {
      const porEmail = await admin.firestore().collection('users')
        .where('email', '==', email).get();
      for (const d of porEmail.docs) {
        const dd = d.data() || {};
        targetClubId = dd.clubId || dd.individualEntityId || null;
        if (targetClubId) break;
      }
    }
  } catch (e) {
    console.warn('[deleteAuthUser] No se pudo resolver el club del objetivo:', e && e.message);
  }

  if (!_callerHasClubPermission(callerDoc, targetClubId, await _esSuperAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Permisos insuficientes');
  }

  // Determina el UID real de Firebase Auth. El uid recibido del cliente puede
  // estar desalineado (p.ej. ID de doc secundario); ante user-not-found
  // resolvemos por email antes de dar el borrado por fallido.
  let resolvedUid = uid;
  let deletedFromAuth = false;
  let alreadyAbsent = false;
  try {
    await admin.auth().deleteUser(resolvedUid);
    deletedFromAuth = true;
  } catch (firstErr) {
    if (firstErr.code !== 'auth/user-not-found') {
      console.error('[deleteAuthUser] Error al eliminar usuario:', firstErr);
      await admin.firestore().collection('error_logs').add({
        action:'delete_user_failed', targetUid:uid, targetEmail:email,
        error:firstErr.message, errorCode:firstErr.code||null,
        performedBy:context.auth.token.email,
        timestamp:admin.firestore.FieldValue.serverTimestamp()
      });
      // SEC-H01: Generic error message; full detail stays in server log
      throw new functions.https.HttpsError('internal', 'Error interno. Contacte al administrador.');
    }
    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      resolvedUid = userRecord.uid;
      await admin.auth().deleteUser(resolvedUid);
      deletedFromAuth = true;
    } catch (secondErr) {
      if (secondErr.code === 'auth/user-not-found') {
        alreadyAbsent = true;
      } else {
        console.error('[deleteAuthUser] Error al eliminar usuario (retry):', secondErr);
        // SEC-H01: Generic error message; full detail stays in server log
        throw new functions.https.HttpsError('internal', 'Error interno. Contacte al administrador.');
      }
    }
  }

  // Purga en Firestore cuando se borra Auth.
  //
  // ⚠️ EL CORREO ES LA PERSONA; LA PLAZA ES DEL CLUB (v584/v585). Barrer
  //    `users where email == X` a secas borra también las plazas que esa
  //    persona tenga en OTROS clubes, que este llamante no administra. Se
  //    purgan sólo los documentos de la entidad autorizada; el superadmin,
  //    que sí manda sobre todas, los purga todos.
  if (deletedFromAuth || alreadyAbsent) {
    try {
      const esSuperadmin = (callerDoc.data() || {}).role === 'superadmin';
      await admin.firestore().collection('users').doc(uid).delete();
      if (resolvedUid && resolvedUid !== uid) {
        await admin.firestore().collection('users').doc(resolvedUid).delete().catch(() => {});
      }
      const secSnap = await admin.firestore().collection('users')
        .where('email', '==', email)
        .get();
      for (const sDoc of secSnap.docs) {
        const sd = sDoc.data() || {};
        const sClub = sd.clubId || sd.individualEntityId || null;
        // Fuera de mi entidad y con dueño conocido: no es mío, no lo toco.
        if (!esSuperadmin && sClub && targetClubId && String(sClub) !== String(targetClubId)) {
          console.info('[deleteAuthUser] Se respeta la plaza de otra entidad:', sDoc.id, sClub);
          continue;
        }
        try { await sDoc.ref.delete(); } catch (_) {}
      }
    } catch (e) {
      console.warn('[deleteAuthUser] Error al limpiar documentos de Firestore:', e && e.message);
    }
  }

  await admin.firestore().collection('audit_logs').add({
    action: 'delete_user',
    targetUid: resolvedUid,
    requestedUid: uid,
    targetEmail: email,
    deletedFromAuth: deletedFromAuth,
    alreadyAbsent: alreadyAbsent,
    performedBy: context.auth.token.email,
    performedByUid: callerUid,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ipAddress: context.rawRequest.ip,
  });

  return {
    success: true,
    alreadyAbsent: alreadyAbsent,
    uid: resolvedUid,
    deletedFromAuth: deletedFromAuth,
    message: alreadyAbsent
      ? `${email} ya no existia en Firebase Auth (email liberado)`
      : `${email} eliminado de Firebase Auth`,
    deletedAt: new Date().toISOString(),
  };
});

/* ==================================================================== */
/* 4️⃣b Cloud Function: archiveAndDeleteCoach                            */
/*      PRESERVAR ANTES DE BORRAR. Encargo del autor (implementar.txt):  */
/*      al eliminar a un entrenador se libera su correo, pero su trabajo  */
/*      se queda en la CATEGORÍA.                                        */
/* ==================================================================== */
//
// ⚠️⚠️ POR QUÉ ESTA FUNCIÓN EXISTE Y POR QUÉ EL ORDEN ES INNEGOCIABLE
//
// Casi todo el trabajo del entrenador (informes, convocatorias, partidos,
// entrenamientos) ya vive en colecciones indexadas por `clubId`: eso NO se
// pierde al borrar la cuenta. El problema es UNO y muy concreto:
//
//   `users/{uid}/cronos_data/main` — donde vive la PLANTILLA
//   (`cronos_master_roster`, vía cloudSet) — es una SUBCOLECCIÓN.
//
//   · Firestore NO borra las subcolecciones al borrar el documento padre, y
//     el disparador `deleteUserData` borra `users/{uid}`. La subcolección
//     queda HUÉRFANA.
//   · Su regla es `request.auth.uid == userId`, SIN rama de SuperAdmin: en
//     cuanto ese uid deja de existir, no la puede leer NADIE. Nunca más.
//   · Al re-registrarse, el mismo correo estrena UID y apunta a un documento
//     vacío.
//   Resultado: se perdía sin dar un solo error.
//
// 🔑 De ahí el orden: COPIAR → VERIFICAR → BORRAR AUTH → LIMPIAR. Si la
//    verificación no cuadra, se aborta y NO se borra nada. Es preferible
//    dejar el correo ocupado a perder la plantilla, porque lo primero se
//    puede reintentar y lo segundo no.
//
// ⚠️ Y no se copia sólo el roster: `cronos_data/main` es un documento
//    clave-valor donde cloudSet mete lo que le pidan. Se archiva ENTERA la
//    subcolección, documento a documento, para no dejarse claves futuras.

// Réplica EXACTA de cronosTeamId() de js/core/utils.js, que es una FUNCIÓN
// PURA: por eso el archivo casa con el histórico ya escrito sin migrar nada.
//
// ⚠️ Los acentos se filtran por CÓDIGO DE CARÁCTER, no con una clase de regex
//    tipo [̀-ͯ]. Escribir esa clase en el fuente ha acabado más de
//    una vez como marcas diacríticas literales en el fichero; con charCodeAt
//    el fuente es ASCII puro y no hay nada que se pueda corromper al escribirlo.
function _esMarcaDeAcento(ch) {
  const c = ch.charCodeAt(0);
  return c >= 0x300 && c <= 0x36f;
}
function _teamSlug(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .normalize('NFD')
    .split('').filter((ch) => !_esMarcaDeAcento(ch)).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function _teamId(clubId, category, subcategory) {
  const c = _teamSlug(clubId);
  const cat = _teamSlug(category);
  const sub = _teamSlug(subcategory);
  if (!c || !cat) return '';
  return c + '__' + cat + '__' + sub;
}

// ══════════════════════════════════════════════════════════════════════
// DE QUÉ EQUIPO ES ESTE ENTRENADOR
// ══════════════════════════════════════════════════════════════════════
// ⚠️⚠️ NO SE PUEDE LEER LA CATEGORÍA DE LA RAÍZ, Y ASÍ EMPEZÓ ESTO. En la
//    primera prueba real la Function abortó porque la raíz del documento era
//    la identidad `club_admin` de una cuenta con CINCO roles: ahí `category`
//    y `subcategory` están vacías. **La categoría del entrenador vive DENTRO
//    de `allRoles[]`**, en la entrada de su rol. Abortar fue lo correcto (no
//    se archivó ni se borró nada), pero el motivo era un defecto de aquí.
//
// 🔑 Está FUERA de la callable a propósito: así el guard puede EJECUTARLA con
//    la forma real del documento que falló, en vez de mirar su texto.
function _resuelveEquipo(target, data) {
  const allRoles = Array.isArray(target.allRoles) ? target.allRoles : [];
  const clubBase = target.clubId || (data && data.clubId) || null;
  const esDeEsteClub = (r) => !r.clubId || String(r.clubId) === String(clubBase || '');

  let rolElegido = null;
  // 1. El rol que el panel dice estar dando de baja: es la señal más fiable.
  if (data && data.role) {
    rolElegido = allRoles.find((r) => r && r.role === data.role && r.category && esDeEsteClub(r)) || null;
  }
  // 2. Si no, el rol revocado MÁS RECIENTE con categoría (la baja acaba de
  //    marcarlo justo antes de llamar aquí).
  if (!rolElegido) {
    const revocados = allRoles
      .filter((r) => r && r.status === 'removed' && r.category && esDeEsteClub(r))
      .sort((a, b) => String(b.removedAt || '').localeCompare(String(a.removedAt || '')));
    rolElegido = revocados[0] || null;
  }
  // 3. Y como último recurso, cualquiera de este club que tenga categoría.
  if (!rolElegido) {
    rolElegido = allRoles.find((r) => r && r.category && esDeEsteClub(r)) || null;
  }

  const clubId = clubBase || (rolElegido && rolElegido.clubId) || null;
  const category = target.category || (rolElegido && rolElegido.category) ||
                   (data && data.category) || '';
  const subcategory = target.subcategory || (rolElegido && rolElegido.subcategory) ||
                      (data && data.subcategory) || '';
  return { clubId, category, subcategory, teamId: _teamId(clubId, category, subcategory) };
}

exports.archiveAndDeleteCoach = functions.https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'archiveAndDeleteCoach');
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuario no autenticado');
  }
  const db = admin.firestore();
  const callerUid = context.auth.uid;
  const callerDoc = await db.collection('users').doc(callerUid).get();
  /* 🛡️ SEC-C1c · el rol de SuperAdmin sale del TOKEN, y para los demas roles
     —que si se leen del documento— se exige CUENTA HABILITADA. Sin esto, una
     cuenta recien creada podia declararse 'club_admin' y archivar/borrar a los
     entrenadores de un club ajeno. */
  const _esSA = await _esSuperAdmin(context);
  const _cd = callerDoc.exists ? (callerDoc.data() || {}) : {};
  if (!_esSA && (!callerDoc.exists ||
      !_cuentaHabilitada(_cd) ||
      !['club_admin', 'individual_admin', 'director', 'coordinator'].includes(_cd.role))) {
    throw new functions.https.HttpsError('permission-denied', 'Permisos insuficientes');
  }
  const callerRole = _esSA ? 'superadmin' : _cd.role;

  const targetUid = data && data.uid;
  const targetEmail = data && data.email;
  if (!targetUid || !targetEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'uid y email son requeridos');
  }

  const targetSnap = await db.collection('users').doc(targetUid).get();
  const target = targetSnap.exists ? targetSnap.data() : {};

  // El club se resuelve del documento del LLAMANTE o del target
  if (callerRole === 'club_admin') {
    const callerClubId = callerDoc.data().clubId;
    if (targetSnap.exists && target.clubId && target.clubId !== callerClubId) {
      throw new functions.https.HttpsError('permission-denied', 'Solo puedes eliminar usuarios de tu club');
    }
  }

  // De qué equipo es este entrenador (ver _resuelveEquipo, más arriba).
  // Este `clubId` puede venir de `data`: vale para SABER DÓNDE ARCHIVAR, que es
  // una pista, no un permiso.
  const { clubId, category, subcategory, teamId } = _resuelveEquipo(target, data);

  // 🔒 Pero AUTORIZAR es otra cosa, y se hace sólo con lo que dice el servidor.
  //
  // ⚠️ La versión anterior remataba la cadena con `|| callerDoc.data().clubId`:
  //    si nada se resolvía, el club del objetivo pasaba a ser EL DEL PROPIO
  //    LLAMANTE y la comprobación se aprobaba a sí misma. Un objetivo sin
  //    documento (`targetSnap.exists === false`) llegaba además con `allRoles`
  //    vacío, o sea `borrarCuenta = true`: cuenta de Auth borrada por correo,
  //    sin dueño comprobado. Sin club resuelto en el servidor, aquí se deniega.
  const authClubId = target.clubId || target.individualEntityId ||
    ((Array.isArray(target.allRoles) ? target.allRoles : [])
      .find((r) => r && r.clubId && r.status !== 'removed') || {}).clubId || null;

  if (!_callerHasClubPermission(callerDoc, authClubId, _esSA)) {
    throw new functions.https.HttpsError('permission-denied', 'Solo puedes eliminar usuarios de tu club');
  }

  const allRoles = Array.isArray(target.allRoles) ? target.allRoles : [];

  // ══════════════════════════════════════════════════════════════════
  // ¿SE BORRA LA CUENTA, O SOLO SE VACÍA LA CASILLA?
  // ══════════════════════════════════════════════════════════════════
  // 🔑 LA REGLA DE NEGOCIO, tal y como la fijó el autor:
  //    · El correo es de la PERSONA; la casilla (rol + categoría) es del CLUB.
  //    · Revocar una casilla archiva su trabajo en la categoría y la deja
  //      vacante, pero **la cuenta sigue viva mientras le quede algún rol**
  //      (un entrenador puede llevar, por ejemplo, un equipo de F11 y otro
  //      de F7, además de ser padre o coordinador).
  //    · Sólo cuando se le revoca el ÚLTIMO rol del club se elimina su
  //      cuenta de Auth y se libera su correo.
  //
  // Por eso aquí ya no se aborta si conserva roles: se archiva igual y
  // simplemente NO se borra. Lo único que decide es cuántos roles vivos
  // quedan DESPUÉS de la revocación (el panel revoca justo antes de llamar).
  const _vivo = (r) => r && r.status !== 'removed' &&
                       (r.isAuthorized === true || r.authorized === true);
  const _esAdmin = (rol) => rol === 'club_admin' || rol === 'superadmin' ||
                            rol === 'individual_admin';
  const rolesVivos = allRoles.filter(_vivo);

  // ⚠️ SALVAGUARDA QUE SE QUEDA: una cuenta ADMINISTRADORA no se borra nunca
  //    desde aquí, ni aunque pareciera quedarse sin roles. Las filas de equipo
  //    no muestran el rol de administrador (no tiene categoría), así que este
  //    caso no debería darse; es una red por si algún día se da. Dejar un club
  //    sin administrador no se puede deshacer.
  const esCuentaAdmin = _esAdmin(target.role) || allRoles.some((r) => _esAdmin(r.role) && _vivo(r));
  const borrarCuenta = rolesVivos.length === 0 && !esCuentaAdmin;

  // ── 1. COPIAR: la subcolección entera ────────────────────────────
  const origen = await db.collection('users').doc(targetUid).collection('cronos_data').get();
  const payload = {};
  let clavesOrigen = 0;
  origen.forEach((d) => {
    payload[d.id] = d.data() || {};
    clavesOrigen += Object.keys(payload[d.id]).length;
  });

  // Sin equipo no hay dónde archivar. Si además había algo que guardar, se
  // aborta: borrar dejaría la plantilla ilegible para siempre.
  if (!teamId) {
    if (origen.size > 0) {
      // El mensaje dice QUÉ falta: sin esto, la primera prueba real dejó al
      // administrador sin saber si el problema era suyo o de la aplicación.
      const falta = !_teamSlug(clubId) ? 'el club' : 'la categoría';
      throw new functions.https.HttpsError('failed-precondition',
        'No se puede archivar el trabajo de ' + targetEmail + ' porque no consta ' + falta +
        ' de su rol de entrenador (club=' + JSON.stringify(clubId) +
        ', categoría=' + JSON.stringify(category) + '/' + JSON.stringify(subcategory) + '). ' +
        'No se ha borrado nada: asígnale categoría en el panel y reinténtalo.');
    }
    console.warn('[archiveAndDeleteCoach] Sin teamId y sin datos que archivar:', targetUid);
  }

  const archivoRef = teamId
    ? db.collection('clubs').doc(clubId).collection('team_archives').doc(teamId)
    : null;

  if (archivoRef) {
    // merge:true — si esa categoría ya tiene archivo de un entrenador
    // anterior, se ACUMULA por uid en vez de pisarlo.
    await archivoRef.set({
      teamId: teamId,
      clubId: clubId,
      category: category,
      subcategory: subcategory,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      coaches: {
        [targetUid]: {
          uid: targetUid,
          email: targetEmail,
          archivedAt: new Date().toISOString(),
          archivedBy: context.auth.token.email || callerUid,
          documentos: payload,
          numDocumentos: origen.size,
          numClaves: clavesOrigen,
        },
      },
    }, { merge: true });
  }

  // ── 2. VERIFICAR antes de tocar nada irreversible ────────────────
  // 🔑 Se RELEE del servidor y se cuentan las claves. Si no cuadra, se aborta
  //    con el correo aún ocupado: eso se puede reintentar; perder la
  //    plantilla, no.
  if (archivoRef) {
    const comprobacion = await archivoRef.get();
    const guardado = comprobacion.exists
      ? ((comprobacion.data().coaches || {})[targetUid] || null)
      : null;
    const okDocs = guardado && guardado.numDocumentos === origen.size;
    let okClaves = false;
    if (guardado && guardado.documentos) {
      let n = 0;
      Object.keys(guardado.documentos).forEach((k) => {
        n += Object.keys(guardado.documentos[k] || {}).length;
      });
      okClaves = (n === clavesOrigen);
    }
    if (!okDocs || !okClaves) {
      console.error('[archiveAndDeleteCoach] VERIFICACIÓN FALLIDA — no se borra nada', {
        targetUid, teamId, origen: origen.size, clavesOrigen,
      });
      throw new functions.https.HttpsError('internal',
        'El archivado no se pudo verificar. NO se ha borrado la cuenta: inténtalo de nuevo.');
    }
  }

  // ── 3. BORRAR la cuenta de Auth — SÓLO SI ERA SU ÚLTIMO ROL ──────
  //
  // ⚠️⚠️ AQUÍ ESTÁ LA REGLA DE NEGOCIO ENTERA. Si le queda cualquier rol
  //    vivo en el club, la cuenta y el correo siguen siendo suyos y no se
  //    tocan: lo único que ha pasado es que una casilla ha quedado vacante y
  //    su trabajo se ha archivado en la categoría. Borrar aquí le dejaría sin
  //    acceso a sus otros equipos.
  let resolvedUid = targetUid;
  let deletedFromAuth = false;
  let alreadyAbsent = false;
  if (borrarCuenta) {
    try {
      await admin.auth().deleteUser(resolvedUid);
      deletedFromAuth = true;
    } catch (err1) {
      if (err1.code === 'auth/user-not-found') {
        try {
          const rec = await admin.auth().getUserByEmail(targetEmail);
          resolvedUid = rec.uid;
          await admin.auth().deleteUser(resolvedUid);
          deletedFromAuth = true;
        } catch (err2) {
          if (err2.code === 'auth/user-not-found') alreadyAbsent = true;
          else {
            console.error('[archiveAndDeleteCoach] Error al borrar Auth (retry):', err2);
            throw new functions.https.HttpsError('internal',
              'Los datos SÍ quedaron archivados, pero no se pudo borrar la cuenta. Reinténtalo.');
          }
        }
      } else {
        console.error('[archiveAndDeleteCoach] Error al borrar Auth:', err1);
        throw new functions.https.HttpsError('internal',
          'Los datos SÍ quedaron archivados, pero no se pudo borrar la cuenta. Reinténtalo.');
      }
    }
  }

  // ── 4. LIMPIAR la subcolección Y LOS DOCUMENTOS — SÓLO SI SE BORRÓ LA CUENTA ─
  //
  // 🔑 Si la cuenta sigue viva, ARCHIVAR ES COPIAR, NO MOVER: su plantilla
  //    es de la CUENTA y la sigue necesitando para sus otros equipos. Sólo
  //    cuando la cuenta desaparece hay que limpiarla, porque si no queda
  //    huérfana e ilegible para siempre (esa es la razón de ser de todo esto).
  let limpiados = 0;
  if (deletedFromAuth || alreadyAbsent) {
    for (const d of origen.docs) {
      try { await d.ref.delete(); limpiados++; } catch (e) {
        console.warn('[archiveAndDeleteCoach] No se pudo limpiar', d.id, e.message);
      }
    }
    // Borrar el documento principal en users/{targetUid} para liberar completamente la cuenta
    try {
      await db.collection('users').doc(targetUid).delete();
      if (resolvedUid && resolvedUid !== targetUid) {
        await db.collection('users').doc(resolvedUid).delete().catch(() => {});
      }
    } catch (e) {
      console.warn('[archiveAndDeleteCoach] Error borrando doc primario:', e.message);
    }
    // Borrar documentos secundarios en users (uid_rol_club) y referencias por email.
    //
    // ⚠️ Sólo los de ESTA entidad: el correo es la PERSONA y puede tener plazas
    //    en otros clubes que este llamante no administra (v584/v585). El
    //    superadmin sí barre todas.
    const esSuperadmin = callerRole === 'superadmin';
    try {
      const secSnap = await db.collection('users')
        .where('email', '==', targetEmail)
        .get();
      for (const sDoc of secSnap.docs) {
        const sd = sDoc.data() || {};
        const sClub = sd.clubId || sd.individualEntityId || null;
        if (!esSuperadmin && sClub && authClubId && String(sClub) !== String(authClubId)) {
          console.info('[archiveAndDeleteCoach] Se respeta la plaza de otra entidad:', sDoc.id, sClub);
          continue;
        }
        try { await sDoc.ref.delete(); } catch (_) {}
      }
    } catch (e) {
      console.warn('[archiveAndDeleteCoach] Error borrando docs secundarios:', e.message);
    }
    // Limpiar solicitudes pendientes — igual, sin pisar las dirigidas a otro club.
    try {
      const reqSnap = await db.collection('registration_requests')
        .where('userEmail', '==', targetEmail)
        .get();
      for (const rDoc of reqSnap.docs) {
        const rClub = (rDoc.data() || {}).clubId || null;
        if (!esSuperadmin && rClub && authClubId && String(rClub) !== String(authClubId)) continue;
        try { await rDoc.ref.delete(); } catch (_) {}
      }
    } catch (_) {}
  }

  // ── 5. Dejar constancia ──────────────────────────────────────────
  await db.collection('deletion_requests')
    .doc(resolvedUid + '_purge_' + Date.now())
    .set({
      userId: resolvedUid, userEmail: targetEmail, clubId: clubId,
      requestedBy: callerUid, requestedByEmail: context.auth.token.email || null,
      action: borrarCuenta ? 'archive_and_delete' : 'archive_slot',
      teamId: teamId || null,
      rolRevocado: (data && data.role) || null,
      accountDeleted: deletedFromAuth,
      alreadyAbsent: alreadyAbsent,
      rolesRestantes: rolesVivos.map((r) => r.role),
      dataArchived: !!archivoRef,
      documentosArchivados: origen.size,
      clavesArchivadas: clavesOrigen,
      subcoleccionLimpiada: limpiados,
      status: 'completed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  return {
    success: true,
    uid: resolvedUid,
    teamId: teamId || null,
    documentosArchivados: origen.size,
    clavesArchivadas: clavesOrigen,
    cuentaBorrada: deletedFromAuth || alreadyAbsent,
    emailLiberado: deletedFromAuth || alreadyAbsent,
    rolesRestantes: rolesVivos.map((r) => r.role),
    esCuentaAdmin: esCuentaAdmin,
    message: borrarCuenta
      ? 'Era su último rol: trabajo archivado en la categoría y correo liberado.'
      : 'Casilla vacante y trabajo archivado. La cuenta sigue activa con ' +
        rolesVivos.length + ' rol(es).',
  };
});

/* ==================================================================== */
/* 5️⃣ Cloud Function: syncUserChanges – Sincronizar cambios de usuarios entre clubes */
/* ==================================================================== */
exports.syncUserChanges = functions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const before = change.before.data();
    const after = change.after.data();

    if (!after) {
      console.log(`Usuario ${userId} eliminado`);
      await admin.firestore().collection('notifications').add({
        type: 'user_deleted',
        userId,
        email: before?.email,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
      return;
    }

    if (before?.status !== after?.status && ['removed', 'blocked'].includes(after.status)) {
      console.log(`Usuario ${userId} cambió a estado: ${after.status}`);

      if (after.clubId) {
        const clubRef = admin.firestore().collection('clubs').doc(after.clubId);

        // SEC-H04: Use atomic FieldValue.increment instead of read-modify-write to avoid race condition
        const roleKey = after.role === 'director' ? 'directors'
                    : after.role === 'coordinator' ? 'coordinators'
                    : after.role === 'parent' ? 'parents'
                    : 'users';

        if (after.status === 'removed' || after.status === 'blocked') {
          await clubRef.update({
            [`usedSlots.${roleKey}`]: admin.firestore.FieldValue.increment(-1)
          });
        }
      }
    }
  });

/* ----------------------------------------------------------- */
/* FIX (v182): Auto-set custom claims cuando un usuario es      */
/* aprobado o su rol cambia. Esto asegura que clubId y role      */
/* esten siempre en el token, lo que permite que las reglas      */
/* Firestore (sameClubAsDoc) funcionen correctamente.            */
/* Sin estos claims, _cGetStaff falla -> staffUids=[] ->         */
/* informes no llegan al director/coordinador.                   */
/* ----------------------------------------------------------- */
exports.autoSetClaimsOnApproval = functions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const userId = context.params.userId;

    if (!change.after.exists) return;

    const before = change.before.data() || {};
    const after = change.after.data() || {};

    // GUARD ANTI-LOOP #1: si el único cambio es claimsSetAt, abortar
    const beforeKeys = Object.keys(before).sort();
    const afterKeys = Object.keys(after).sort();
    const changedKeys = afterKeys.filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])
    );

    if (changedKeys.length === 1 && changedKeys[0] === 'claimsSetAt') {
      console.log(`[autoSetClaims v2] Solo cambió claimsSetAt. Abortando.`);
      return;
    }

    // GUARD ANTI-LOOP #2: si _claimsSyncedAt es muy reciente (<5s), abortar
    if (after._claimsSyncedAt) {
      const ageMs = after._claimsSyncedAt.toMillis
        ? after._claimsSyncedAt.toMillis()
        : after._claimsSyncedAt;
      if (Date.now() - ageMs < 5000) return;
    }

    // Solo disparar si cambió isAuthorized, status, role, clubId o allRoles.
    // SEC-C1: se añade allRoles para que, en el flujo multi-rol donde el SA
    // solo toca allRoles[] (sin cambiar la raíz), el trigger también pueble el
    // clubId raíz. Cierra la ventana de carrera sin depender del cliente.
    const significantChange =
      before.isAuthorized !== after.isAuthorized ||
      before.status !== after.status ||
      before.role !== after.role ||
      before.clubId !== after.clubId ||
      JSON.stringify(before.allRoles) !== JSON.stringify(after.allRoles);

    if (!significantChange) return;

    // Solo si el usuario está autorizado y activo
    if (!after.isAuthorized || after.status === 'removed' || after.status === 'blocked') return;

    const role = after.role;
    // clubId autorizado: primero la raíz; si está vacía, el primer allRoles[]
    // con clubId cuyo rol NO esté rechazado/eliminado (mismo criterio que
    // syncRootClubId, para no poblar la raíz con un clubId de un rol revocado).
    const clubId =
      after.clubId ||
      (Array.isArray(after.allRoles)
        // SEC-F01 · de aqui sale el `clubId` que va al CLAIM, o sea la raiz
        // de la autorizacion. Una plaza sin `isAuthorized` no puede elegirlo.
        ? (after.allRoles.find((r) => r && r.clubId && _plazaViva(r)) || {}).clubId
        : null);

    if (!role || !clubId) return;

    // SEC-C1: si la raíz clubId está vacía pero lo resolvimos desde allRoles,
    // hay que migrarlo a la raíz (userDocClubId de las reglas lee la raíz).
    const rootClubIdMissing = !after.clubId && !!clubId;

    try {
      const userRecord = await admin.auth().getUser(userId);
      const currentClaims = userRecord.customClaims || {};

      // Si los claims ya están correctos, no hay que tocarlos. Pero AÚN así
      // hay que migrar el clubId raíz si falta (SEC-C1): puede que los claims
      // ya estuvieran bien y solo cambiara allRoles[].
      if (currentClaims.role === role && currentClaims.clubId === clubId) {
        if (rootClubIdMissing) {
          await admin.firestore().collection('users').doc(userId).set(
            {
              clubId: clubId,
              _claimsSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          console.log(`[autoSetClaims v2] clubId raíz migrado para ${userId}: ${clubId}`);
        } else {
          console.log(`[autoSetClaims v2] Claims ya correctos para ${userId}. Skip.`);
        }
        return;
      }

      // Asignar claims
      await admin.auth().setCustomUserClaims(userId, {
        ...currentClaims,
        role: role,
        clubId: clubId,
        claimsSetAt: Date.now(),
      });

      // Escribir _claimsSyncedAt (NO claimsSetAt) para no disparar loop.
      // SEC-C1: si la raíz clubId estaba vacía, poblarla aquí (Admin SDK) para
      // que userDocClubId de las reglas funcione sin escritura del cliente.
      const rootUpdate = {
        _claimsSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (rootClubIdMissing) rootUpdate.clubId = clubId;
      await admin.firestore().collection('users').doc(userId).set(
        rootUpdate,
        { merge: true }
      );

      console.log(
        `[autoSetClaims v2] Claims OK para ${userId}: role=${role}, clubId=${clubId}`
      );
    } catch (err) {
      console.error(`[autoSetClaims v2] Error para ${userId}:`, err.message);
      await admin.firestore().collection('error_logs').add({
        function: 'autoSetClaimsOnApproval',
        targetUid: userId,
        error: err.message,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

/* ==================================================================== */
/* 6️⃣ Cloud Function: cleanupExpiredRequests – Limpiar solicitudes de plazas expiradas */
/* ==================================================================== */
exports.cleanupExpiredRequests = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const snapshot = await admin.firestore()
      .collection('slot_requests')
      .where('status', '==', 'pending')
      .where('createdAt', '<', thirtyDaysAgo)
      .get();

    const batch = admin.firestore().batch();
    let count = 0;

    snapshot.forEach(doc => {
      batch.update(doc.ref, {
        status: 'expired',
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      count++;
    });

    if (count > 0) {
      await batch.commit();
      console.log(`${count} solicitudes marcadas como expiradas`);
    }

    return null;
  });

/* ==================================================================== */
/* 7️⃣ Cloud Function: notifySlotRequest – Notificar solicitud de plaza */
/* ==================================================================== */
exports.notifySlotRequest = functions.firestore
  .document('slot_requests/{requestId}')
  .onCreate(async (snap, context) => {
    const request = snap.data();

    await admin.firestore().collection('notifications').add({
      type: 'slot_request',
      clubId: request.clubId,
      clubName: request.clubName,
      requestedRole: request.requestedRole,
      quantity: request.quantity,
      adminEmail: request.adminEmail,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
      targetRole: 'superadmin',
    });

    console.log(`Nueva solicitud de plaza: ${request.clubName} - ${request.requestedRole}`);
  });

/* ==================================================================== */
/* 8️⃣ Cloud Function: auditUserStatusChange – Audit Log para cambios de estado de usuario */
/* ==================================================================== */
exports.auditUserStatusChange = functions.firestore
  .document('users/{userId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    if (before.status !== after.status) {
      await admin.firestore().collection('audit_logs').add({
        action: 'user_status_changed',
        userId: context.params.userId,
        email: after.email,
        statusBefore: before.status,
        statusAfter: after.status,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    if (before.isAuthorized !== after.isAuthorized) {
      await admin.firestore().collection('audit_logs').add({
        action: 'user_authorization_changed',
        userId: context.params.userId,
        email: after.email,
        authorizedBefore: before.isAuthorized,
        authorizedAfter: after.isAuthorized,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

/* ==================================================================== */
/* 9️⃣ Cloud Function: sendInviteEmail – Enviar email de invitación       */
/*                                                                     */
/* v2 CORRECCIONES:                                                    */
/*   - Reemplaza functions.config() (deprecado en v5) por process.env  */
/*   - Si no hay credenciales, devuelve inviteUrl en lugar de error    */
/*     para que el cliente pueda usar el fallback mailto               */
/*   - Logging detallado para diagnóstico                              */
/* ==================================================================== */
exports.sendInviteEmail = functions
  .runWith({ secrets: ['EMAIL_USER', 'EMAIL_PASS'] })
  .https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'sendInviteEmail');
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado');
  }

  const callerDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();

  /* ==================================================================== */
  /* 🔴 v594 · LA PUERTA SOLO DEJABA PASAR AL SUPERADMIN                  */
  /*                                                                      */
  /* v590 le dio al Director Deportivo la pantalla de Secretaria, pero    */
  /* NADIE abrio esta puerta: sus envios morian aqui con permission-denied*/
  /* y el cliente los enseñaba como "Error de conexion con el servidor",  */
  /* que mandaba a mirar la red cuando el problema era un permiso.        */
  /* Medido en los registros de produccion (2026-08-20): dos llamadas del */
  /* autor con auth VALID y status code 403, sin una sola linea de este   */
  /* fichero — porque el throw ocurria ANTES del primer console.log.      */
  /*                                                                      */
  /* 🔑 SE MIRA allRoles, NO SOLO LA RAIZ. En este proyecto el campo      */
  /* `role` de la raiz va desfasado con frecuencia y la verdad esta en    */
  /* las PLAZAS (v563, v581, v540). Mismo criterio que ya usa             */
  /* registerStaffUid unas lineas mas abajo: si no, un director cuya raiz */
  /* diga 'user' seguiria sin poder invitar, con el mismo 403 opaco.      */
  /*                                                                      */
  /* 🔑🔑 Y EL CLUB SE IMPONE, NO SE ACEPTA. Un director invita al SUYO:  */
  /* el `clubName` que llega del cliente se IGNORA para todo el que no    */
  /* sea SuperAdmin y se sustituye por el de su plaza. Sin esto, el       */
  /* formulario —cuyo campo de club es editable— permitiria mandar        */
  /* invitaciones en nombre de otro club.                                 */
  /* ==================================================================== */
  const _cd = callerDoc.exists ? (callerDoc.data() || {}) : {};
  /* 🛡️ SEC-C1c · el SuperAdmin se reconoce por el TOKEN, no por el `role` del
     documento —que escribe el propio usuario al registrarse—. Y para el resto
     de vias se exige CUENTA HABILITADA: sin esto, una cuenta recien creada
     podia declararse 'director' y mandar correos con la marca de la
     plataforma a quien quisiera. */
  /* ══════════════════════════════════════════════════════════════════
     🚨 SEC-F03 (Paso 4, 2026-08-31) · LA PLAZA SALE DE LA RAIZ O DEL
        CLAIM. NUNCA DE `allRoles`.

     Aqui se decidia con una plaza de `allRoles`, y SEC-F01 creyo cerrarlo
     exigiendo `isAuthorized === true` en la entrada. NO SIRVE: **el que
     escribe ese `true` es el propio atacante**. El `hasAny([...])` del
     `allow update` de `users/{userId}` protege claves de PRIMER NIVEL, y
     tocar el array solo aparece como la clave `allRoles` — las entradas
     llevan dentro sus propios `role`, `clubId` e `isAuthorized`.
     Medido con el metodo `:test`: un entrenador cualquiera puede anyadirse
     una plaza autorizada de otro club, y hasta una de superadmin.

     👉 Consecuencia concreta que esto cierra: **cualquier usuario
     autorizado podia mandar invitaciones con la marca de la plataforma en
     nombre de CUALQUIER club.** Es lo unico de esa familia que era
     aprovechable sin ser ya director.

     🔑 Se verifica contra lo que el usuario NO puede escribir:
       · la RAIZ del documento (`role`), protegida por el `allow update`;
       · el CLAIM del token, que solo pone el Admin SDK.
     Ninguna de las dos se puede falsificar desde la consola del navegador.

     ⚠️ ESTO DEJA FUERA A QUIEN SOLO TENGA LA PLAZA EN `allRoles`. Medido en
     produccion (2026-08-31): de 10 plazas autorizadas, 4 las corrobora la
     raiz y **6 no las corrobora ninguna fuente no falsificable**. Esas 6 no
     podran invitar hasta que exista el dato con el que verificarlas — es
     decidido, no un descuido. El arreglo completo (sembrar el documento del
     club y verificar contra el) queda para una sesion dedicada.
     ⛔ NO "arreglar" esto volviendo a mirar `allRoles`: seria reabrirlo.
     ══════════════════════════════════════════════════════════════════ */
  const _esSA = await _esSuperAdmin(context);
  const _habilitado = _cuentaHabilitada(_cd);
  const _tk = (context.auth && context.auth.token) || {};
  const _esStaffRaiz = _habilitado && ['director', 'club_admin'].includes(_cd.role);
  const _esStaffClaim = ['director', 'club_admin'].includes(_tk.role || '');
  const _puedeInvitar = _esSA || _esStaffRaiz || _esStaffClaim;

  if (!callerDoc.exists || !_puedeInvitar) {
    /* Mensaje que dice QUE pasa, para que el cliente no tenga que adivinar. */
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo el SuperAdmin, el Administrador de Club o el Director Deportivo pueden enviar invitaciones.'
    );
  }

  /* El club del invitante, para imponerlo mas abajo.
     SEC-F03 · sale de la RAIZ, que el usuario no puede escribir. Ya NO se
     acepta el `clubName` de una plaza de `allRoles`: era la via por la que
     se invitaba en nombre de otro club. */
  const _clubPropio = _esSA ? null : (_cd.clubName || null);

  /* ==================================================================== */
  /* 🛡️ SEC-DEP1 (auditoria 2026-08-26) · SANEADO DE CABECERAS DE CORREO   */
  /*                                                                      */
  /* `to` y `subject` llegaban del cliente y se pasaban TAL CUAL a         */
  /* nodemailer. Con el aviso de seguridad abierto contra nodemailer       */
  /* —"CRLF injection in Nodemailer List-* header comments"— eso es una    */
  /* via de inyeccion de cabeceras: un salto de linea dentro del asunto    */
  /* puede anadir destinatarios ocultos a un correo que sale con la marca  */
  /* de la plataforma.                                                     */
  /*                                                                      */
  /* 🔑 SE ARREGLAN LAS DOS COSAS, no una: se sube nodemailer (que corrige */
  /* la libreria) Y se sanea aqui (que corrige el dato). Depender solo de  */
  /* la libreria deja el mismo agujero abierto para el siguiente aviso.    */
  /* ==================================================================== */
  const _sinSaltos = (t, max) => String(t == null ? '' : t)
    /* CR, LF y los separadores de linea Unicode: los tres sirven para
       partir una cabecera de correo en dos. Van con ESCAPE y no con el
       caracter literal — un salto de linea de verdad dentro de un /.../
       no es JavaScript valido. */
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 200);

  const to          = _sinSaltos(data && data.to, 254);       /* RFC 5321: 254 */
  const subject     = _sinSaltos(data && data.subject, 200);
  const role        = _sinSaltos(data && data.role, 60);
  const inviterName = _sinSaltos(data && data.inviterName, 120);

  /* Y el destinatario tiene que ser UN correo, no una lista ni un montaje. */
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(to)) {
    throw new functions.https.HttpsError('invalid-argument', 'Destinatario no valido');
  }

  /* ==================================================================== */
  /* 🧹 v595 · EL MARCADOR RESIDUAL NO PUEDE LLEGAR NUNCA AL DESTINATARIO */
  /*                                                                      */
  /* El autor lo vio en el correo real (capturas 9333/9334): en mitad del  */
  /* parrafo salia el texto literal                                       */
  /*   "🔗 [ENLACE DE INVITACION - SE AÑADE AUTOMATICAMENTE AL ENVIAR]"    */
  /* Era un marcador de ayuda de la plantilla del CLIENTE, que en v594 ya  */
  /* se sustituyo por el enlace de verdad ({enlace}).                      */
  /*                                                                      */
  /* 🔑 PERO SE LIMPIA TAMBIEN AQUI, Y A PROPOSITO. La plantilla la escribe */
  /* el cliente, y hay tres formas de que ese texto siga llegando:         */
  /*   · un navegador con la version vieja en cache (produccion sirve v593 */
  /*     mientras esto se escribe, y ES de donde salio su captura);        */
  /*   · una plantilla del club GUARDADA que ya lo contenga;               */
  /*   · alguien que lo copie y pegue sin saber que es.                    */
  /* El servidor es el ultimo sitio por el que pasa el correo: es el unico */
  /* punto donde la limpieza vale para todos los casos a la vez.           */
  /*                                                                      */
  /* ⚠️ SOLO se borra ESE marcador, no cualquier corchete: el mensaje es   */
  /* del club y no se le tocan sus palabras.                              */
  /* ==================================================================== */
  const _quitarMarcador = (t) => String(t == null ? '' : t)
    /* La linea entera si el marcador la ocupa el solo (con o sin 🔗). */
    .replace(/^[ \t]*(?:🔗[ \t]*)?\[[^\]\n]*ENLACE DE INVITACI[ÓO]N[^\]\n]*\][ \t]*\r?\n?/gim, '')
    /* Y suelto, si quedo incrustado en mitad de un parrafo. */
    .replace(/(?:🔗[ \t]*)?\[[^\]\n]*ENLACE DE INVITACI[ÓO]N[^\]\n]*\]/gi, '')
    /* El hueco que deja no puede convertirse en tres saltos de linea. */
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const body = _quitarMarcador(data.body);
  /* ⚠️ `clubName` NO se desestructura arriba a proposito: para quien no es */
  /* SuperAdmin manda su club, no lo que venga en el payload.              */
  /* 🚨 SEC-F03 · AQUI HABIA UN SEGUNDO AGUJERO, EN LA MISMA FUNCION Y MAS
     simple: decia `(_clubPropio || data.clubName)`. Ese `||` DESHACIA la
     imposicion que promete el comentario de arriba — a quien no tuviera
     `clubName` en la raiz se le cogia el que mandaba el CLIENTE, que es un
     campo editable del formulario. Ahora, si la raiz no dice de que club es,
     la invitacion sale SIN club en vez de con el que diga el navegador. */
  const clubName = _esSA ? data.clubName : _clubPropio;
  /* SECURITY: escapar toda entrada de usuario que se interpole en HTML */
  const _esc = (v) => { if (v === null || v === undefined) return ''; return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
  if (!to) {
    throw new functions.https.HttpsError('invalid-argument', 'Se requiere el email de destino');
  }

  /* ---- Leer credenciales: process.env (nuevo sistema Firebase v5) ---- */
  /* Para configurarlas: firebase functions:secrets:set EMAIL_USER        */
  /*                     firebase functions:secrets:set EMAIL_PASS        */
  /* O con variables de entorno: firebase functions:config deprecado.     */
  /* Fallback compatible: también lee las variables de entorno de proceso */
  const emailUser = process.env.EMAIL_USER || null;
  const emailPass = process.env.EMAIL_PASS || null;

  console.log('[sendInviteEmail] Iniciando. Destino:', to, '| emailUser configurado:', !!emailUser);

  /* ---- Etiquetas legibles para roles ---- */
  const roleLabels = {
    club_admin: 'Administrador de Club',
    individual_admin: 'Administrador Individual',
    individual: 'Entrenador Individual',
    director: 'Director Deportivo',
    coordinator: 'Coordinador',
    user: 'Entrenador',
    parent: 'Padre/Madre/Tutor',
    spectator: 'Espectador',
  };
  const roleLabel = roleLabels[role] || role || 'Usuario';

  /* ══════════════════════════════════════════════════════════════════
     🎟️ v633 · LA URL DE INVITACION, CON TOKEN OPACO

     Antes esta funcion metia el correo, el rol y el club EN CLARO en la
     direccion. Eso acaba en el historial del navegador, en los registros
     del servidor de correo y en la cabecera `Referer` de cualquier
     recurso que cargue la pagina de alta. Ahora los datos viven en
     `invites/{token}` y la direccion solo lleva el token.

     🔑 EL CLIENTE MANDA EL TOKEN, NUNCA LA URL. La direccion la compone
     el servidor con su propia constante APP_URL: si aceptara una URL de
     fuera, cualquiera con permiso para invitar podria colar un enlace a
     un sitio ajeno DENTRO de un correo con el logo y la firma de la
     plataforma. Eso es phishing con marca propia.

     ⚠️ Se admite que no venga token: los enlaces clasicos siguen
     funcionando y la Secretaria cae a ellos si no puede acuñar. Se
     valida la FORMA del token (solo hex/guiones) para que no pueda
     inyectarse nada en el atributo href del HTML.
     ══════════════════════════════════════════════════════════════════ */
  const APP_URL = 'https://cronos-futbol-app.web.app';
  const tokenLimpio = String((data && data.inviteToken) || '').trim();
  let inviteUrl;
  if (/^[A-Za-z0-9_-]{8,64}$/.test(tokenLimpio)) {
    inviteUrl = APP_URL + '/?invite=' + encodeURIComponent(tokenLimpio);
  } else {
    if (tokenLimpio) console.warn('[sendInviteEmail] token con forma invalida; se usa el enlace clasico');
    const inviteParams = new URLSearchParams();
    inviteParams.set('register', 'true');
    inviteParams.set('email', to);
    if (role) inviteParams.set('role', role);
    if (clubName) inviteParams.set('clubName', clubName);
    inviteUrl = APP_URL + '/?' + inviteParams.toString();
  }

  /* ---- Nombre del invitante ---- */
  /* v594: el remitente por defecto ya no es "SuperAdmin" para todo el     */
  /* mundo. Si quien invita es un club, firma el club; el generico solo    */
  /* queda para el SuperAdmin sin nombre.                                  */
  const senderName = inviterName || _cd.displayName || _cd.firstName ||
                     (clubName ? ('Dirección Deportiva de ' + clubName) : null) ||
                     (_esSA ? 'SuperAdmin' : 'Chronos Fútbol');

  /* ---- Asunto del correo ---- */
  /* ✍️ v595 · CON TILDES. Estaban quitadas en TODO el texto fijo del correo
     -asunto, cabecera, pie y respaldo en texto plano-, y el autor lo reporto
     al leer el correo real. No habia ninguna razon tecnica: `from:` ya
     enviaba "Chronos Fútbol" con tilde y le llegaba bien, igual que el
     cuerpo que escribe el club. Nodemailer manda UTF-8 por defecto.
     ⚠️ La marca lleva HACHE -CHRONOS- por decision de v476, con guard. */
  const emailSubject = subject || ('Invitación a Chronos Fútbol · ' + roleLabel + (clubName ? ' (' + clubName + ')' : ''));

  /* ---- URL del logo (alojado en Firebase Hosting) ---- */
  const LOGO_URL = APP_URL + '/public/assets/img_0f3942d4.png';

  /* ---- Cuerpo en texto plano (fallback para clientes que no soportan HTML) ---- */
  const textBody = body || (
    'Hola,\n\n' +
    'Has sido invitado a unirte a Chronos Fútbol como ' + roleLabel +
    (clubName ? ' del club ' + clubName : '') + '.\n\n' +
    'Para completar tu registro, haz clic en el siguiente enlace:\n' +
    inviteUrl + '\n\n' +
    'Si no puedes hacer clic, copia y pega la URL en tu navegador.\n\n' +
    'Si no esperabas este correo, puedes ignorarlo.\n\n' +
    'Saludos,\n' +
    senderName + ' · Chronos Fútbol'
  );

  /* ---- Cuerpo principal del mensaje (por defecto o personalizado) ---- */
  const customBodyHtml = body
    ? _esc(body).replace(/\n\n/g, '</p><p style="font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 20px 0;">')
          .replace(/\n/g, '<br/>')
    : `<strong>${_esc(senderName)}</strong> te ha invitado a unirte a <strong>Chronos Fútbol</strong> como:`;

  /* ---- Cuerpo en HTML con logo y diseño profesional ---- */
  const htmlBody = (
    '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">' +

      /* -- Cabecera con logo y color de marca -- */
      '<div style="background: linear-gradient(135deg, #1a237e 0%, #283593 50%, #3949ab 100%); padding: 30px 20px; text-align: center;">' +
        '<img src="' + LOGO_URL + '" alt="Chronos Fútbol" style="max-width: 180px; height: auto; display: block; margin: 0 auto 12px auto;" />' +
        '<h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 600;">Invitación a Chronos Fútbol</h1>' +
      '</div>' +

      /* -- Cuerpo del mensaje -- */
      '<div style="padding: 30px 25px;">' +
        (body ? '' : '<p style="font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 20px 0;">Hola,</p>') +
        '<p style="font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 20px 0;">' +
          customBodyHtml +
        '</p>' +

        /* -- Tarjeta de rol y club (solo si no es body personalizado, para evitar duplicar info) -- */
        (body ? '' : 
        '<div style="background-color: #f5f7ff; border-left: 4px solid #3949ab; border-radius: 4px; padding: 16px 20px; margin: 0 0 25px 0;">' +
          '<p style="margin: 0 0 8px 0; font-size: 15px; color: #555555;">Rol: <strong style="color: #1a237e;">' + _esc(roleLabel) + '</strong></p>' +
          (clubName ? '<p style="margin: 0; font-size: 15px; color: #555555;">Club: <strong style="color: #1a237e;">' + _esc(clubName) + '</strong></p>' : '') +
        '</div>'
        ) +

        /* -- Botón de registro -- */
        '<div style="text-align: center; margin: 30px 0;">' +
          '<a href="' + inviteUrl + '" style="display: inline-block; background: linear-gradient(135deg, #1a237e, #3949ab); color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-size: 16px; font-weight: 600; letter-spacing: 0.5px;">' +
            'Completar Registro / Acceder' +
          '</a>' +
        '</div>' +

        '<p style="font-size: 14px; color: #888888; line-height: 1.5; margin: 15px 0 0 0; text-align: center;">' +
          'Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>' +
          '<a href="' + inviteUrl + '" style="color: #3949ab; word-break: break-all;">' + inviteUrl + '</a>' +
        '</p>' +
      '</div>' +

      /* -- Pie del correo -- */
      '<div style="background-color: #f5f5f5; padding: 20px; text-align: center; border-top: 1px solid #e0e0e0;">' +
        '<p style="margin: 0 0 6px 0; font-size: 13px; color: #999999;">Enviado por ' + _esc(senderName) + ' desde Chronos Fútbol</p>' +
        '<p style="margin: 0; font-size: 12px; color: #bbbbbb;">Si no esperabas este correo, puedes ignorarlo de forma segura.</p>' +
      '</div>' +

    '</div>'
  );

  /* ---- Si no hay credenciales → devolver inviteUrl para fallback mailto ---- */
  if (!emailUser || !emailPass) {
    console.warn('[sendInviteEmail] Credenciales EMAIL_USER/EMAIL_PASS no configuradas.');
    console.warn('[sendInviteEmail] Configura con: firebase functions:secrets:set EMAIL_USER');
    /* NO lanzamos error: devolvemos la URL para que el cliente use mailto */
    return {
      success: false,
      noCredentials: true,
      inviteUrl: inviteUrl,
      sentTo: to,
      message: 'Credenciales no configuradas. Usa el fallback mailto con la URL adjunta.',
    };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: emailUser, pass: emailPass },
  });

  try {
    const info = await transporter.sendMail({
      from: '"Chronos Fútbol" <' + emailUser + '>',
      to,
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
    });

    console.log('[sendInviteEmail] ✅ Email enviado a:', to, '| MessageId:', info.messageId, '| URL:', inviteUrl);

    return {
      success: true,
      messageId: info.messageId,
      sentTo: to,
      inviteUrl: inviteUrl,
    };
  } catch (error) {
    console.error('[sendInviteEmail] ❌ Error Nodemailer:', error.message);
    /* Devolver inviteUrl para que el cliente use mailto como fallback */
    return {
      success: false,
      error: error.message,
      inviteUrl: inviteUrl,
      sentTo: to,
    };
  }
});

console.log('Cloud Functions v8.4 cargadas (Fase 0 + originales + sendInviteEmail + logAuditEntry auditoria completa)');

/* ----------------------------------------------------------- */
/* FIX (v183): Registrar UID de director/coordinador en el club */
/* Cloud Function invocable por el cliente. Usa Admin SDK que  */
/* ignora las reglas Firestore, así que siempre funciona.       */
/* Sin este registro, _cGetStaff no encuentra staff →          */
/* staffUids=[] → informes no llegan al director/coordinador.  */
/* ----------------------------------------------------------- */
exports.registerStaffUid = functions.https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'registerStaffUid');
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado');
  }

  const uid = context.auth.uid;
  const role = data.role; // 'director' o 'coordinator'
  const clubId = data.clubId;

  if (!role || !clubId) {
    throw new functions.https.HttpsError('invalid-argument', 'role y clubId son obligatorios');
  }

  if (!['director', 'coordinator'].includes(role)) {
    throw new functions.https.HttpsError('permission-denied', 'Solo director o coordinador pueden registrarse');
  }

  // Verificar que el usuario realmente tiene ese rol en su documento
  try {
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Usuario no encontrado');
    }
    const userData = userDoc.data();

    /* 🛡️ SEC-C1c · CUENTA HABILITADA ANTES QUE NADA. `userData.role` lo
       escribe el propio usuario al registrarse, asi que la rama de la RAIZ
       valia para una cuenta recien creada que se declarase 'director' y
       registrarse como staff de un club ajeno. Un documento nuevo nace con
       isAuthorized:false, de modo que este filtro lo deja fuera. */
    if (!_cuentaHabilitada(userData)) {
      throw new functions.https.HttpsError('permission-denied', 'Cuenta no habilitada');
    }

    const hasRole = userData.role === role ||
      (userData.allRoles || []).some(r => r.role === role && _plazaViva(r));   // SEC-F01

    if (!hasRole) {
      throw new functions.https.HttpsError('permission-denied', 'No tienes el rol ' + role);
    }

    // BE-C1 (cierre escalada cross-club): NO basta con tener el rol en ALGUN
    // club; hay que tenerlo EN EL clubId que se pretende registrar. Antes solo
    // se validaba la presencia del rol (hasRole), asi que un director del club
    // A podia pasar clubId=B y anadir su UID a clubs/B.directorUids. Se exige
    // ahora que el rol este ligado a ESE clubId (raiz o allRoles autorizado).
    const rootMatchesClub = userData.role === role &&
      userData.clubId != null && userData.clubId === clubId;
    const roleForClub = Array.isArray(userData.allRoles) && userData.allRoles.some(
      (r) => r && r.role === role && r.clubId === clubId && _plazaViva(r)   // SEC-F01
    );

    if (!rootMatchesClub && !roleForClub) {
      throw new functions.https.HttpsError('permission-denied', 'No tienes el rol ' + role + ' en ese club (cross-club)');
    }

    // Registrar UID en el documento del club
    const field = role === 'director' ? 'directorUids' : 'coordinatorUids';
    await admin.firestore().collection('clubs').doc(clubId).set({
      [field]: admin.firestore.FieldValue.arrayUnion(uid)
    }, { merge: true });

    console.log('[registerStaffUid] UID', uid, 'registrado como', role, 'en club', clubId);
    return { success: true, field, uid };
  } catch (err) {
    if (err.code && err.code.startsWith('functions.https.HttpsError')) throw err;
    console.error('[registerStaffUid] Error:', err.message);
    throw new functions.https.HttpsError('internal', err.message);
  }
});

/* ==================================================================== */
/* Cloud Function: syncRootClubId – Migrar clubId a la raíz del doc        */
/*                                                                        */
/* SEC-C1: cierra la auto-asignación de clubId en users/{userId}.         */
/*                                                                        */
/* Contexto: las reglas Firestore (userDocClubId) necesitan el clubId en  */
/* el CAMPO RAÍZ de users/{uid} porque no pueden iterar arrays arbitrarios */
/* (allRoles[]). Antes, el cliente (_cResolveClubId) escribía clubId       */
/* directamente vía `allow update`, lo que permitía a un usuario fijar un  */
/* clubId AJENO y obtener acceso cross-club. Ahora esa escritura la hace   */
/* EXCLUSIVAMENTE esta Cloud Function con Admin SDK, validando server-side  */
/* que el clubId propuesto pertenece de verdad al usuario (mismo criterio  */
/* que registerStaffUid v183). La regla `allow update` ya NO permite tocar */
/* clubId bajo ningún caso.                                                */
/* ==================================================================== */
exports.syncRootClubId = functions.https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'syncRootClubId');
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado');
  }

  const uid = context.auth.uid;
  const clubId = data && data.clubId;

  if (!clubId || typeof clubId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'clubId es obligatorio');
  }

  try {
    const userRef = admin.firestore().collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Usuario no encontrado');
    }
    const userData = userDoc.data() || {};

    // 1. La cuenta debe estar habilitada (mismo criterio que registerStaffUid).
    /* 🔒 SEC-F01 · LA PUERTA TAMBIEN ERA FAIL-OPEN. Preguntaba
       `isAuthorized === false`, asi que una cuenta con el campo AUSENTE
       pasaba. Es la misma trampa de v617 en su otra forma: no basta con
       descartar el NO, hay que exigir el SI. `_cuentaHabilitada` pide
       `isAuthorized === true` y es la misma puerta que ya usan
       registerStaffUid y sendInviteEmail — aqui faltaba. */
    if (!_cuentaHabilitada(userData)) {
      throw new functions.https.HttpsError('permission-denied', 'Cuenta no habilitada');
    }

    // 2. El clubId propuesto debe ser realmente del usuario: coincidir con el
    //    clubId raíz ya existente, o con algún allRoles[].clubId autorizado
    //    (escrito por el SA vía Admin SDK). NUNCA se confía en un clubId que el
    //    cliente proponga sin respaldo en el propio documento.
    const rootMatches = userData.clubId != null && userData.clubId === clubId;
    const roleMatches = Array.isArray(userData.allRoles) && userData.allRoles.some(
      // 🚨 SEC-F01 · ESTA ES LA GRAVE. Lo que sigue escribe el `clubId` de la
      // RAIZ con el Admin SDK —el campo que las reglas prohiben que el usuario
      // se cambie— y `isClubDirectorOf` lo lee para conceder permisos. Una
      // entrada de `allRoles` escrita por el propio usuario abria el club ajeno.
      (r) => r && r.clubId === clubId && _plazaViva(r)
    );

    if (!rootMatches && !roleMatches) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'El clubId no corresponde a este usuario'
      );
    }

    // 3. Ya está poblado y coincide: nada que hacer (idempotente).
    if (userData.clubId === clubId) {
      return { success: true, clubId, migrated: false };
    }

    // 4. Escribir el clubId raíz con Admin SDK (se salta las reglas cliente).
    await userRef.set({ clubId }, { merge: true });
    console.log('[syncRootClubId] UID', uid, 'clubId raíz ->', clubId);
    return { success: true, clubId, migrated: true };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    console.error('[syncRootClubId] Error:', err.message);
    throw new functions.https.HttpsError('internal', err.message);
  }
});

/* ==================================================================== */
/* Cloud Function: approveIndividualAdmin - Aprobar admin individual      */
/* ==================================================================== */
exports.approveIndividualAdmin = functions.https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'approveIndividualAdmin');
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado');
  }

  /* 🛡️ SEC-C1c · identidad por TOKEN, no por el documento del usuario. */
  if (!(await _esSuperAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Solo SuperAdmin puede aprobar administradores individuales');
  }

  const { uid, entityId } = data;
  if (!uid || !entityId) {
    throw new functions.https.HttpsError('invalid-argument', 'Se requieren uid y entityId');
  }

  try {
    /* 1️⃣ Obtener el usuario a aprobar --------------------------------- */
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Usuario no encontrado');
    }
    const userData = userDoc.data();

    /* 2️⃣ Actualizar roles ------------------------------------------------ */
    const updatedRoles = (userData.allRoles || []).map(r => {
      if (r.role === 'individual' || r.role === 'admin_individual') {
        return { ...r, isAuthorized: true, status: 'active' };
      }
      return r;
    });

    if (!updatedRoles.some(r => r.role === 'individual' || r.role === 'admin_individual')) {
      updatedRoles.push({
        role: 'individual',
        isAuthorized: true,
        status: 'active',
        clubId: entityId,
        individualEntityId: entityId,
      });
    }

    await admin.firestore().collection('users').doc(uid).update({
      isAuthorized: true,
      status: 'active',
      clubId: entityId,
      individualEntityId: entityId,
      individualOwnerId: entityId,
      allRoles: updatedRoles,
      authorizedAt: admin.firestore.FieldValue.serverTimestamp(),
      authorizedBy: context.auth.token.email || 'superadmin',
    });

    /* 3️⃣ Marcar entidad individual como con administrador ----------------- */
    const entityDoc = await admin.firestore().collection('clubs').doc(entityId).get();
    if (entityDoc.exists && entityDoc.data().type === 'individual') {
      await admin.firestore().collection('clubs').doc(entityId).update({
        hasAdmin: true,
        adminUid: uid,
        adminEmail: userData.email,
        adminName: userData.displayName || userData.firstName || userData.email,
      });
    }

    /* 4️⃣ Marcar la solicitud como aprobada ------------------------------- */
    const reqSnap = await admin.firestore().collection('platform_requests')
      .where('userUid', '==', uid)
      .where('requestedRole', '==', 'individual')
      .where('status', '==', 'pending_sa')
      .get();

    const batch = admin.firestore().batch();
    reqSnap.forEach(doc => {
      batch.update(doc.ref, {
        status: 'sa_approved',
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedBy: context.auth.token.email || 'superadmin',
      });
    });
    if (reqSnap.size > 0) await batch.commit();

    /* 5️⃣ FIX (C2): Asignar custom claims al admin individual ------------- */
    // Sin estos claims, las reglas de Firestore (sameClubAsDoc) deniegan
    // acceso a cronos_player_reports, cronos_notifications y cronos_player_links,
    // lo que impide que los informes lleguen al staff y a los padres.
    try {
      await admin.auth().setCustomUserClaims(uid, {
        role: 'individual',
        clubId: entityId,
        claimsSetAt: Date.now(),
      });
      console.log('[approveIndividualAdmin] Custom claims asignados:', { uid, role: 'individual', clubId: entityId });
    } catch (claimErr) {
      // No bloquear la aprobación si los claims fallan (el fallback de reglas lo cubre)
      console.error('[approveIndividualAdmin] Error asignando custom claims:', claimErr.message);
    }

    console.log('[approveIndividualAdmin] Admin individual aprobado:', uid, 'entidad:', entityId);

    return {
      success: true,
      uid,
      entityId,
      message: 'Administrador Individual aprobado correctamente',
    };
  } catch (error) {
    console.error('[approveIndividualAdmin] Error:', error);
    throw new functions.https.HttpsError('internal', 'Error al aprobar admin individual: ' + error.message);
  }
});

exports.logAuditEntry = functions.https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'logAuditEntry');
  // 1) Requiere autenticación
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'No autenticado');
  }

  data = data || {};

  // 2) Validar campos obligatorios: matchId y action
  const matchId = typeof data.matchId === 'string' ? data.matchId.trim() : '';
  const action  = typeof data.action === 'string' ? data.action.trim() : '';
  if (!matchId || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'matchId y action son obligatorios');
  }

  // BE-C7 (whitelist de acciones + limites de tamano): antes se persistia
  // CUALQUIER 'action' y 'matchId' del cliente sin validar. audit_logs solo lo
  // lee el SuperAdmin (write:false en reglas -> solo Admin SDK/esta CF escribe),
  // asi que el peor caso era polucion del log de auditoria con acciones
  // arbitrarias (no hay escalada: userId/email vienen del TOKEN, no del cliente).
  // Se restringe 'action' a la lista de eventos reales que emite el cliente
  // (js/match/events/player-actions.js + js/services/audit-logger.js) y se acotan
  // las longitudes para evitar entradas gigantes.
  const ALLOWED_ACTIONS = [
    'goal', 'goal_cancelled', 'card', 'yellow_card', 'red_card',
    'red_card_reversed', 'injury', 'substitute', 'substitution',
    'formation_change', 'actions_cleared'
  ];
  if (ALLOWED_ACTIONS.indexOf(action) === -1) {
    throw new functions.https.HttpsError('invalid-argument', 'action no permitida');
  }
  if (matchId.length > 200) {
    throw new functions.https.HttpsError('invalid-argument', 'matchId demasiado largo');
  }

  // 3) Identidad desde el token (no confiar en el cliente)
  const trustedUid   = context.auth.uid;
  const trustedEmail = context.auth.token.email || data.userEmail || 'unknown';

  // 4) Documento a persistir (campos que envía audit-logger.js)
  const entry = {
    matchId:         matchId,
    action:          action,
    value:           data.value !== undefined ? data.value : null,

    playerId:        data.playerId !== undefined ? data.playerId : null,
    playerName:      typeof data.playerName === 'string' ? data.playerName : null,
    playerNumber:    data.playerNumber !== undefined ? data.playerNumber : null,

    role:            typeof data.role === 'string' ? data.role : 'unknown',
    userId:          trustedUid,
    userEmail:       trustedEmail,

    changes:         (data.changes && typeof data.changes === 'object') ? data.changes : {},

    timestamp:       typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
    clientTimestamp: typeof data.clientTimestamp === 'number' ? data.clientTimestamp : null,
    deviceInfo:      (data.deviceInfo && typeof data.deviceInfo === 'object') ? data.deviceInfo : {},

    ipAddress:       context.rawRequest ? context.rawRequest.ip : 'unknown',
    serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  // 5) Persistir en la colección audit_logs con manejo de errores genérico
  try {
    await admin.firestore().collection('audit_logs').add(entry);
    return { success: true };
  } catch (error) {
    console.error('[logAuditEntry] Error:', error);
    throw new functions.https.HttpsError('internal', 'No se pudo registrar la auditoria');
  }
});

/* ==================================================================== */
/* 7️⃣ Cloud Function: cleanupLiveMatches — borrado automatico de        */
/*    live_matches a las 10 HORAS de TERMINAR el partido (v431)          */
/* ==================================================================== */
/*
 *  POR QUE EXISTE. Hasta v431 la limpieza de `live_matches` la hacia
 *  EXCLUSIVAMENTE el navegador (`cleanupStaleMatches` en js/match/live/sync.js),
 *  y por tanto solo ocurria si algun entrenador abria la aplicacion. Si nadie
 *  entraba, los documentos —con nombres y dorsales de MENORES— se quedaban
 *  indefinidamente. Ademas escaneaba la coleccion ENTERA sin filtro.
 *
 *  QUE HACE, en dos pasos, una vez por hora:
 *
 *   PASO A · cerrar los partidos ABANDONADOS. Un partido cuyo entrenador cerro
 *     la app sin pulsar "finalizar" se queda 'active' para siempre y por tanto
 *     nunca entraria en el paso B. Se cierran los 'active' sin latido desde
 *     hace mas de 4 h, que es EXACTAMENTE el mismo umbral que ya aplicaba el
 *     cliente: este paso no cambia el criterio, solo lo traslada al servidor.
 *
 *   PASO B · borrar los TERMINADOS con mas de 10 h. El ancla es `finishedAt`
 *     (sello que escribe pushLiveSnapshot en la transicion a 'finished'),
 *     NO `updatedAt`: cualquier retoque posterior del documento reescribe
 *     updatedAt y habria ido aplazando el borrado indefinidamente.
 *
 *  ⚠️ PARTIDOS ANTERIORES A v431 (sin `finishedAt`). Una consulta
 *  `where('finishedAt','<',corte)` NO devuelve los documentos que no tienen el
 *  campo — Firestore los excluye del indice, no los trata como "null". Esos
 *  documentos no se borrarian JAMAS y el problema seguiria vivo justo para lo
 *  ya acumulado. Por eso la consulta se hace sobre `updatedAt`, que existe en
 *  todos, y el ancla real se decide en codigo con `finishedAt || updatedAt`.
 *
 *  ⚠️ PRECISION. Al correr cada hora, el borrado ocurre entre las 10 h y las
 *  11 h despues de terminar. Para afinar mas, bajar el `every N minutes` (el
 *  coste es despreciable: son dos consultas indexadas por ejecucion).
 */
// Sin `.timeZone(...)`: el disparador es un INTERVALO ("cada 60 minutos"), no
// una hora concreta del dia, asi que la zona horaria no pinta nada. Ademas
// mantiene la firma igual que cleanupExpiredRequests, que es lo que espera el
// arnes de scripts/test_sec_c1_clubid.js al cargar este fichero.
exports.cleanupLiveMatches = functions.pubsub
  .schedule('every 60 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const ahora = Date.now();
    const corte4h  = new Date(ahora - 4  * 60 * 60 * 1000);
    const corte10h = new Date(ahora - 10 * 60 * 60 * 1000);

    let cerrados = 0, borrados = 0;

    /* ---- PASO A · cerrar abandonados (mismo umbral que el cliente) ---- */
    try {
      // ⚠️ `limit(...)`: un batch de Firestore admite 500 operaciones como
      // maximo y falla ENTERO al superarlas. Con 150 partidos simultaneos
      // previstos, una acumulacion de fin de semana puede pasar de 500 y
      // dejaria la limpieza sin hacer NADA, justo cuando mas falta hace. Al
      // correr cada hora, lo que sobre se recoge en la pasada siguiente.
      //
      // ⚠️⚠️ v572 · EL TOPE BAJA DE 450 A 225 PORQUE AHORA SON DOS ESCRITURAS
      // POR PARTIDO: la del partido y la de su indice ligero (`live_index`).
      // Con 450 documentos serian 900 operaciones, MAS DEL DOBLE del limite, y
      // el lote fallaria entero — la limpieza dejaria de funcionar del todo y
      // en silencio, que es justo el escenario contra el que avisa el parrafo
      // de arriba. 225 x 2 = 450, la misma holgura que habia.
      const abandonados = await db.collection('live_matches')
        .where('status', '==', 'active')
        .where('updatedAt', '<', corte4h)
        .limit(225)
        .get();

      const loteA = db.batch();
      abandonados.forEach(d => {
        loteA.update(d.ref, {
          status:     'finished',
          finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          expireAt:   new Date(ahora + 10 * 60 * 60 * 1000),
          autoClosed: true,
        });
        // v572 · P2 · El indice tiene que cerrarse CON el partido. Si se
        // quedara en `status:'active'`, las consultas de la lista y de las
        // alertas —que filtran por ese campo en el INDICE, no en el partido—
        // seguirian devolviendo un partido abandonado como si seguiera en
        // juego, indefinidamente. `set` con merge y no `update`: un partido
        // anterior a v572 no tiene indice, y `update` sobre un documento
        // inexistente hace fallar el lote ENTERO.
        loteA.set(db.collection('live_index').doc(d.id), {
          status:     'finished',
          finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          expireAt:   new Date(ahora + 10 * 60 * 60 * 1000),
          autoClosed: true,
        }, { merge: true });
        cerrados++;
      });
      if (cerrados) await loteA.commit();
    } catch (e) {
      console.error('[cleanupLiveMatches] paso A (cerrar abandonados):', e.message);
    }

    /* ---- PASO B · borrar los cerrados con mas de 10 h ---- */
    try {
      // ⚠️ v434 · SE QUITA EL `where('updatedAt','<',corte10h)`.
      // Ese filtro reintroducia por la puerta de atras justo el aplazamiento
      // que el ancla `finishedAt` existe para evitar: cualquier escritura
      // posterior al final —un suceso retroactivo dentro de la ventana de 2 h,
      // por ejemplo— refresca `updatedAt`, el documento sale de la consulta y
      // el borrado se retrasa otras 10 h contadas desde esa edicion. Con la
      // regla de las 10 h exactas de retencion, eso ya no vale.
      //
      // Se puede prescindir del filtro temporal porque la coleccion se mantiene
      // pequena precisamente gracias a este borrado: lo que hay son los
      // partidos de las ultimas horas. El `orderBy('updatedAt')` ordena de mas
      // antiguo a mas reciente para que, si un dia hubiera acumulacion, cada
      // pasada ataque siempre los mas viejos en vez de quedarse dando vueltas
      // sobre los mismos 450. Usa el indice (status, updatedAt), ya desplegado.
      //
      // ⚠️ `orderBy` EXCLUYE los documentos que no tengan el campo, igual que un
      // `where`. Se ordena por `updatedAt`, que existe en todos; ordenar por
      // `finishedAt` dejaria fuera para siempre a los anteriores a v431.
      //
      // v434 · Tambien se recogen los 'cancelled'. Antes solo se miraban los
      // 'finished', asi que un partido cancelado se quedaba en la coleccion
      // indefinidamente — y desde v434 ya no se puede borrar a mano una vez
      // congelado, con lo que nadie lo recogeria nunca.
      const terminados = await db.collection('live_matches')
        .where('status', 'in', ['finished', 'cancelled'])
        .orderBy('updatedAt', 'asc')
        .limit(225)   // mismo motivo que en el paso A: 225 x 2 ops = 450 < 500
        .get();

      const loteB = db.batch();
      terminados.forEach(d => {
        const data = d.data() || {};
        // El ancla es CUANDO TERMINO, con respaldo en updatedAt para los
        // documentos anteriores a v431, que nunca tuvieron sello.
        const fin = data.finishedAt || data.cancelledAt || data.updatedAt;
        let finMs = 0;
        if (fin && typeof fin.toDate === 'function') finMs = fin.toDate().getTime();
        else if (typeof fin === 'string') { const t = Date.parse(fin); finMs = isNaN(t) ? 0 : t; }
        else if (typeof fin === 'number') finMs = fin;
        // Sin fecha utilizable no se borra: mas vale un documento de mas que
        // destruir el partido de alguien por un dato corrupto.
        if (!finMs) return;
        if (finMs <= corte10h.getTime()) {
          loteB.delete(d.ref);
          // v572 · P2 · El indice se va CON el partido. `delete` sobre un
          // documento que no existe es una operacion valida y silenciosa en
          // Firestore, asi que esto no puede romper el lote por los partidos
          // anteriores a v572 que nunca tuvieron indice. Sin esta linea los
          // indices se acumularian para siempre: son ~1 KB cada uno y nadie
          // los recogeria jamas, porque el unico barredor mira `live_matches`.
          loteB.delete(db.collection('live_index').doc(d.id));
          borrados++;
        }
      });
      if (borrados) await loteB.commit();
    } catch (e) {
      console.error('[cleanupLiveMatches] paso B (borrar terminados):', e.message);
    }

    /* ---- PASO C · borrar los `finished_index` caducados (v640) ---- */
    // ══════════════════════════════════════════════════════════════════
    //  `finished_index` es la VISTA de la seccion «Partidos Terminados», que
    //  por regla de negocio es un registro TEMPORAL de 10 h (2 h de margen
    //  para corregir informes + 8 h para descargarlo). La pestana ya filtra
    //  por esa ventana en el cliente, asi que un indice caducado es invisible
    //  — pero sin recogerlo se acumularia PARA SIEMPRE, que es exactamente lo
    //  que el paso B evita para `live_index`.
    //
    //  ⚠️⚠️ ESTO NO BORRA NINGUN INFORME. `cronos_player_reports` permanece
    //  toda la temporada: es lo que alimenta «Mis Informes», el resumen de
    //  temporada, la exportacion y el Gantt. Aqui solo se recoge la VISTA.
    //
    //  ⚠️ VA EN SU PROPIA CONSULTA Y SU PROPIO LOTE, no colgado del paso B.
    //  Los ids no coinciden: `live_matches` usa el id del partido en vivo
    //  (`local-27082026-...`) y `finished_index` usa el `matchId` del despacho
    //  (`match_<uid>_<fecha>_...`). Colgarlo del paso B habria borrado
    //  documentos que no existen —silencioso— y dejado los de verdad.
    //
    //  ⚠️ Y CON SU PROPIO TOPE. Un lote admite 500 operaciones y falla ENTERO
    //  al pasarse. Aqui es UNA borrado por documento, asi que 300 va sobrado;
    //  lo que quede lo recoge la pasada siguiente (esto corre cada hora).
    let indicesBorrados = 0;
    try {
      const caducados = await db.collection('finished_index')
        .where('expireAt', '<', new Date(ahora))
        .limit(300)
        .get();

      if (!caducados.empty) {
        const loteC = db.batch();
        caducados.forEach(d => { loteC.delete(d.ref); indicesBorrados++; });
        await loteC.commit();
      }
    } catch (e) {
      // ⚠️ Un fallo aqui NO puede tumbar los pasos A y B, que son los que
      // gobiernan los partidos de verdad. Mismo aislamiento que ellos.
      console.error('[cleanupLiveMatches] paso C (indices de terminados):', e.message);
    }

    console.log('[cleanupLiveMatches] cerrados=' + cerrados + ' borrados=' + borrados +
                ' indicesTerminados=' + indicesBorrados);
    return null;
  });

/* ====================================================================== */
/* 🔔 v644 · AVISO PUSH AL SUPERADMIN CUANDO ENTRA UNA SOLICITUD          */
/*                                                                        */
/* Encargo del autor: que una solicitud pendiente de su aprobacion final  */
/* suene, se vea y actualice la insignia del icono AUNQUE la app este     */
/* cerrada.                                                               */
/*                                                                        */
/* 🔑 SE ENVIA UN MENSAJE **SOLO DE DATOS** (`data`), NUNCA un bloque     */
/* `notification`. No es un detalle: con `notification`, quien pinta el   */
/* aviso es el navegador y el service worker NO puede tocarlo — ni poner  */
/* la insignia, ni avisar a la pestana abierta, ni decidir el `tag`. Con  */
/* solo datos, el `push` del service worker manda del todo. El precio es  */
/* que el service worker esta OBLIGADO a mostrar una notificacion (si no, */
/* el navegador pinta una generica y iOS puede retirar el permiso), y por */
/* eso su handler no tiene ninguna rama que termine sin `showNotification`*/
/*                                                                        */
/* ⚠️ QUIEN ES SUPERADMIN SE DECIDE **AQUI**, NO EN EL DOCUMENTO. El      */
/* documento de token lo escribe el propio cliente, asi que su campo      */
/* `role` es un dato del usuario y NO una autorizacion: si mandaramos a   */
/* todo el que se ponga `role:'superadmin'`, cualquiera se suscribiria al */
/* flujo de solicitudes y sabria quien se da de alta en la plataforma.    */
/* La lista buena es `cronos_config/superadmins`, la MISMA que consultan  */
/* las reglas (isSuperAdminEmail) y que solo un SuperAdmin puede escribir.*/
/*                                                                        */
/* Guard: scripts/test_push_superadmin.js                                 */
/* ====================================================================== */

const PUSH_TOKENS_COL = 'push_tokens';

/* ──────────────────────────────────────────────────────────────────────
   LOS PREDICADOS DE "ESTA PENDIENTE DEL SUPERADMIN"

   🔑 SON UNA COPIA DELIBERADA de las seis fuentes de `saPendingItems()`
   (js/admin/superadmin/requests-tab.js). No se pueden compartir: aquel es
   un script de navegador y esto corre en Node, en otro despliegue.

   🚨 Y ESA DUPLICIDAD ES EXACTAMENTE LO QUE ROMPIO EL BADGE EN LA v532
   (badge 7, lista 4: dos implementaciones de "pendiente" que divergieron).
   Por eso el guard test_push_superadmin.js compara los dos ficheros y se
   pone rojo si el cliente aprende un estado que aqui no esta.
   ────────────────────────────────────────────────────────────────────── */

/* platform_requests: reenviada al SA, o peticion de cuota sin leer. */
function _esPRPendienteSA(d) {
  if (!d) return false;
  if (d.status === 'pending_sa') return true;
  if (d.type === 'quota_increase' && d.status === 'unread') return true;
  return false;
}

/* users: pendiente de aprobacion. `pending_individual` SOLO cuenta si de
   verdad es de un ente individual — ese estado lo comparten flujos que no
   son solicitudes, y sin este filtro el aviso sonaria por altas normales
   de club (mismo matiz que lleva escrito el cliente). */
function _esUsuarioPendienteSA(d) {
  if (!d) return false;
  if (d.status === 'pending' || d.status === 'pending_sa') return true;
  if (d.status === 'pending_individual') {
    return !!(d.individualEntityId || d.individualOwnerId || d.isIndividual ||
              d.role === 'individual' || d.role === 'admin_individual');
  }
  return false;
}

/* succession_requests: sucesion de administrador esperando al SA. */
function _esSucesionPendienteSA(d) {
  return !!d && d.status === 'pending_sa';
}

/* ──────────────────────────────────────────────────────────────────────
   EL NUMERO DE LA INSIGNIA

   Rehace la MISMA lista que pinta el panel, con la MISMA deduplicacion
   (una solicitud representa a su usuario; el documento de usuario solo
   aporta el caso huerfano). Se leen los documentos en vez de usar count():
   la dedup necesita el `userUid` de cada solicitud, y un count() por
   consulta daria un numero MAYOR que el que el SuperAdmin va a ver — que
   es justo el fallo de la v532 reproducido desde el servidor.

   Son pocas decenas de documentos y solo se leen cuando algo entra en
   pendiente, no en cada escritura.
   ────────────────────────────────────────────────────────────────────── */
async function _contarPendientesSA() {
  const db = admin.firestore();
  const vacio = { forEach: () => {} };
  const [snapD, snapD2, snapD3, snapP, snapQ, snapSucc] = await Promise.all([
    db.collection('users').where('status', '==', 'pending').get().catch(() => vacio),
    db.collection('users').where('status', '==', 'pending_sa').get().catch(() => vacio),
    db.collection('users').where('status', '==', 'pending_individual').get().catch(() => vacio),
    db.collection('platform_requests').where('status', '==', 'pending_sa').get().catch(() => vacio),
    db.collection('platform_requests').where('type', '==', 'quota_increase')
      .where('status', '==', 'unread').get().catch(() => vacio),
    db.collection('succession_requests').where('status', '==', 'pending_sa').get().catch(() => vacio),
  ]);

  let registros = 0;
  const representados = new Set();

  snapP.forEach(d => {
    registros++;
    const r = d.data() || {};
    if (r.userUid) representados.add(r.userUid);
  });

  const _huerfano = (d) => {
    if (representados.has(d.id)) return;
    representados.add(d.id);
    registros++;
  };
  snapD.forEach(_huerfano);
  snapD2.forEach(_huerfano);
  snapD3.forEach(d => { if (_esUsuarioPendienteSA(d.data())) _huerfano(d); });

  let cuota = 0, sucesion = 0;
  snapQ.forEach(() => cuota++);
  snapSucc.forEach(() => sucesion++);

  return registros + cuota + sucesion;
}

/* ──────────────────────────────────────────────────────────────────────
   LOS DESTINATARIOS

   Devuelve los tokens de `push_tokens` cuyo dueno esta en la lista de
   SuperAdmins de verdad. FALLA HACIA EL "NADIE": si no se puede leer
   `cronos_config/superadmins` no se envia a ciegas — mismo criterio que
   `_esSuperAdmin`, donde un error de lectura tampoco concede nada.
   ────────────────────────────────────────────────────────────────────── */
async function _tokensDelSuperAdmin() {
  const db = admin.firestore();

  let correos = [];
  try {
    const cfg = await db.doc('cronos_config/superadmins').get();
    const data = cfg.exists ? (cfg.data() || {}) : {};
    correos = Array.isArray(data.emails) ? data.emails.map(e => String(e).toLowerCase()) : [];
  } catch (e) {
    console.warn('[pushSA] no se pudo leer cronos_config/superadmins:', e.message);
    return [];
  }
  if (!correos.length) {
    console.warn('[pushSA] cronos_config/superadmins no lista ningun correo: no se envia nada.');
    return [];
  }

  const snap = await db.collection(PUSH_TOKENS_COL).where('role', '==', 'superadmin').get();
  const salida = [];
  snap.forEach(d => {
    const t = d.data() || {};
    const correo = String(t.email || '').toLowerCase();
    // 🔑 LA COMPROBACION QUE CONVIERTE UN DATO DEL CLIENTE EN AUTORIZACION.
    if (!t.token || !correos.includes(correo)) return;
    salida.push({ id: d.id, token: t.token });
  });
  return salida;
}

/* ──────────────────────────────────────────────────────────────────────
   EL ENVIO

   ⚠️ NUNCA LANZA. Un aviso que no sale no puede tumbar el disparador que
   lo invoca: la solicitud ya esta escrita y el panel la vera igual. El
   push es un extra, no el camino por el que llega el dato.
   ────────────────────────────────────────────────────────────────────── */
async function _avisarSuperAdmin({ titulo, cuerpo, motivo }) {
  try {
    const destinos = await _tokensDelSuperAdmin();
    if (!destinos.length) {
      console.log('[pushSA] sin dispositivos dados de alta; no se envia (' + motivo + ')');
      return;
    }

    let pendientes = 0;
    try { pendientes = await _contarPendientesSA(); }
    catch (e) { console.warn('[pushSA] no se pudo contar pendientes:', e.message); }

    const mensaje = {
      /* Solo datos. Ver la cabecera del bloque: con `notification` el
         service worker perderia el control del aviso. Todos los valores
         han de ser CADENAS — FCM rechaza el envio entero si cuela un
         numero, y el rechazo se veria como "no llega ningun aviso". */
      data: {
        tipo:      'sa_pendiente',
        titulo:    String(titulo || 'Chronos Fútbol'),
        cuerpo:    String(cuerpo || 'Tienes una solicitud pendiente.'),
        insignia:  String(pendientes),
        motivo:    String(motivo || ''),
        url:       '/index.html?sa=requests',
        ts:        String(Date.now()),
      },
      webpush: {
        headers: {
          /* `high` pide entrega inmediata aunque el dispositivo este en
             ahorro de energia — que es el caso "app cerrada" del encargo.
             TTL de 24 h: una solicitud sigue siendo noticia al dia
             siguiente, pero no a la semana. */
          Urgency: 'high',
          TTL: '86400',
        },
      },
      tokens: destinos.map(d => d.token),
    };

    const res = await admin.messaging().sendEachForMulticast(mensaje);

    /* ⚠️ LOS TOKENS MUERTOS SE BORRAN. Un token caduca cuando se
       desinstala la app, se limpian los datos del navegador o pasa medio
       ano sin usarse. Si no se recogen, la coleccion crece para siempre y
       cada envio arrastra fallos que enmascaran los de verdad. */
    const aBorrar = [];
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const cod = (r.error && r.error.code) || '';
      if (cod === 'messaging/registration-token-not-registered' ||
          cod === 'messaging/invalid-registration-token' ||
          cod === 'messaging/invalid-argument') {
        aBorrar.push(destinos[i].id);
      } else {
        console.warn('[pushSA] fallo de envio (' + cod + '):', r.error && r.error.message);
      }
    });
    if (aBorrar.length) {
      const db = admin.firestore();
      const lote = db.batch();
      aBorrar.forEach(id => lote.delete(db.collection(PUSH_TOKENS_COL).doc(id)));
      await lote.commit().catch(e => console.warn('[pushSA] limpieza de tokens:', e.message));
    }

    console.log('[pushSA] ' + motivo + ' · enviados=' + res.successCount +
                '/' + destinos.length + ' fallidos=' + res.failureCount +
                ' retirados=' + aBorrar.length + ' insignia=' + pendientes);
  } catch (e) {
    console.error('[pushSA] el aviso no salio (' + motivo + '):', e.message);
  }
}

/* Rotulo legible para el cuerpo del aviso. Se queda con el nombre y el rol
   pedidos; sin correo, que es dato personal y va a un aviso que se ve en
   la pantalla de bloqueo. */
function _rotuloSolicitud(d) {
  if (!d) return '';
  const nombre = d.requestedName || d.displayName ||
                 [d.firstName, d.lastName].filter(Boolean).join(' ') || '';
  const rol = d.requestedRole || d.role || '';
  const club = d.requestedClubName || d.clubName || '';
  return [nombre, rol, club].filter(Boolean).join(' · ');
}

/* ──────────────────────────────────────────────────────────────────────
   LOS TRES DISPARADORES

   ⚠️ SE AVISA EN LA **TRANSICION** A PENDIENTE, no mientras este
   pendiente. Un `onWrite` salta con cada escritura del documento, y sin
   esta comprobacion aprobar, editar o tocar cualquier campo de una
   solicitud ya pendiente volveria a hacer sonar el telefono. Es el mismo
   criterio con el que la regla de v546 mira la transicion y no el estado.
   ────────────────────────────────────────────────────────────────────── */

exports.notifySuperAdminNewRequest = functions.firestore
  .document('platform_requests/{reqId}')
  .onWrite(async (change, context) => {
    const antes = change.before.exists ? change.before.data() : null;
    const ahora = change.after.exists ? change.after.data() : null;
    if (!ahora) return null;
    if (_esPRPendienteSA(antes) || !_esPRPendienteSA(ahora)) return null;

    const esCuota = ahora.type === 'quota_increase';
    await _avisarSuperAdmin({
      titulo: esCuota ? '📈 Solicitud de plazas' : '📋 Nueva solicitud',
      cuerpo: esCuota
        ? ((ahora.clubName || 'Un club') + ' pide más plazas.')
        : (_rotuloSolicitud(ahora) || 'Una solicitud espera tu aprobación.'),
      motivo: 'platform_requests/' + context.params.reqId,
    });
    return null;
  });

exports.notifySuperAdminPendingUser = functions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const antes = change.before.exists ? change.before.data() : null;
    const ahora = change.after.exists ? change.after.data() : null;
    if (!ahora) return null;
    if (_esUsuarioPendienteSA(antes) || !_esUsuarioPendienteSA(ahora)) return null;

    await _avisarSuperAdmin({
      titulo: '📋 Alta pendiente',
      cuerpo: _rotuloSolicitud(ahora) || 'Un alta espera tu aprobación.',
      motivo: 'users/' + context.params.userId,
    });
    return null;
  });

exports.notifySuperAdminSuccession = functions.firestore
  .document('succession_requests/{reqId}')
  .onWrite(async (change, context) => {
    const antes = change.before.exists ? change.before.data() : null;
    const ahora = change.after.exists ? change.after.data() : null;
    if (!ahora) return null;
    if (_esSucesionPendienteSA(antes) || !_esSucesionPendienteSA(ahora)) return null;

    await _avisarSuperAdmin({
      titulo: '🔑 Sucesión de administrador',
      cuerpo: (ahora.clubName || 'Un club') + ' propone un nuevo administrador.',
      motivo: 'succession_requests/' + context.params.reqId,
    });
    return null;
  });

/* ──────────────────────────────────────────────────────────────────────
   Y LA PUERTA PARA PONER LA INSIGNIA AL DIA SIN QUE ENTRE NADA NUEVO

   La llama el cliente al abrir el panel y al aprobar o rechazar: devuelve
   el numero que el servidor considera pendiente. Asi la insignia baja
   cuando el SuperAdmin despacha, y no solo sube cuando entra algo.
   ────────────────────────────────────────────────────────────────────── */
exports.saPendingCount = functions.https.onCall(async (data, context) => {
  _exigirAppCheck(context, 'saPendingCount');
  if (!(await _esSuperAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Solo el SuperAdmin.');
  }
  return { count: await _contarPendientesSA() };
});

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

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

/* ==================================================================== */
/* 0️⃣ Cloud Function: setCustomClaims – Asignar Custom Claims (roles) a un usuario  */
/* ==================================================================== */
exports.setCustomClaims = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Debes estar autenticado para realizar esta acción'
    );
  }

  const callerDoc = await admin.firestore()
    .collection('users')
    .doc(context.auth.uid)
    .get();

  const callerData = callerDoc.data();
  const callerRole = callerData?.role || context.auth.token.role;

  if (callerRole !== 'superadmin') {
    // club_admin: puede propagar claims SOLO a miembros NO privilegiados de SU
    // propio club (director/coordinator/user/parent/spectator). Esto resuelve el
    // PROBLEMA 2: al activar a un entrenador, el club_admin propaga su clubId al
    // token JWT para que sameClub()/sameClubAsDoc() funcionen. NO puede crear
    // superadmins ni club_admins, ni tocar usuarios de otros clubes.
    const callerClubId = callerData?.clubId || context.auth.token.clubId || null;
    const PRIVILEGED_ROLES = ['superadmin', 'admin', 'club_admin', 'individual_admin', 'individual', 'admin_individual'];
    const isClubAdmin = callerRole === 'club_admin';
    const targetIsSafeRole = !PRIVILEGED_ROLES.includes(data.role);
    const sameClub = data.clubId && callerClubId && String(data.clubId) === String(callerClubId);
    if (!(isClubAdmin && targetIsSafeRole && sameClub)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'No tienes permiso para asignar este rol/club.'
      );
    }
    // Defensa adicional: el usuario objetivo debe pertenecer realmente al club
    // del club_admin (segun su documento Firestore), no solo segun el payload.
    const targetDocCheck = await admin.firestore().collection('users').doc(data.uid).get();
    const targetClubId = targetDocCheck.exists ? (targetDocCheck.data().clubId || null) : null;
    if (!targetClubId || String(targetClubId) !== String(callerClubId)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'El usuario no pertenece a tu club.'
      );
    }
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
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const callerUid = context.auth.uid;
  const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();

  // SEC-003: Correct role check — only superadmin, club_admin, individual_admin
  if (!callerDoc.exists || !['superadmin', 'club_admin', 'individual_admin'].includes(callerDoc.data().role)) {
    throw new functions.https.HttpsError('permission-denied', 'Permisos insuficientes');
  }

  const callerRole = callerDoc.data().role;

  // SEC-003: club_admin solo puede eliminar usuarios de SU PROPIO club.
  // El clubId se lee del documento del caller en Firestore (fuente fiable),
  // NO de data.clubId enviado por el cliente. Ademas se valida que el
  // usuario objetivo realmente pertenece a ese club.
  if (callerRole === 'club_admin') {
    const callerClubId = callerDoc.data().clubId;
    try {
      const targetDoc = await admin.firestore().collection('users').doc(data.uid).get();
      if (targetDoc.exists) {
        if (targetDoc.data().clubId !== callerClubId) {
          throw new functions.https.HttpsError('permission-denied', 'Solo puedes eliminar usuarios de tu club');
        }
      }
    } catch(e) {
      if (e.code === 'permission-denied') throw e;
    }
  }

  // individual_admin can only delete users in their own entity
  if (callerRole === 'individual_admin') {
    const callerEntityId = callerDoc.data().individualEntityId || callerDoc.data().clubId;
    try {
      const targetDoc = await admin.firestore().collection('users').doc(data.uid).get();
      if (targetDoc.exists) {
        const targetEntityId = targetDoc.data().individualEntityId || targetDoc.data().clubId;
        if (targetEntityId !== callerEntityId) {
          throw new functions.https.HttpsError('permission-denied', 'Solo puedes eliminar usuarios de tu propio ente individual');
        }
      }
    } catch(e) {
      if (e.code === 'permission-denied') throw e;
    }
  }

  const { uid, email } = data;

  if (!uid || !email) {
    throw new functions.https.HttpsError('invalid-argument', 'uid y email son requeridos');
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
    message: alreadyAbsent
      ? `${email} ya no existia en Firebase Auth (email liberado)`
      : `${email} eliminado de Firebase Auth`,
    deletedAt: new Date().toISOString(),
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
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado');
  }

  const callerDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists || !['superadmin', 'admin'].includes(callerDoc.data().role)) {
    throw new functions.https.HttpsError('permission-denied', 'Solo SuperAdmin puede enviar invitaciones');
  }

  const { to, subject, body, role, clubName, inviterName } = data;
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

  /* ---- Construir URL de invitación con todos los parámetros ---- */
  const APP_URL = 'https://cronos-futbol-app.web.app';
  const inviteParams = new URLSearchParams();
  inviteParams.set('register', 'true');
  inviteParams.set('email', to);
  if (role) inviteParams.set('role', role);
  if (clubName) inviteParams.set('clubName', clubName);
  const inviteUrl = APP_URL + '/?' + inviteParams.toString();

  /* ---- Nombre del invitante ---- */
  const senderName = inviterName || callerDoc.data().displayName || callerDoc.data().firstName || 'SuperAdmin';

  /* ---- Asunto del correo ---- */
  const emailSubject = subject || ('Invitacion a Chronos Futbol - ' + roleLabel + (clubName ? ' (' + clubName + ')' : ''));

  /* ---- URL del logo (alojado en Firebase Hosting) ---- */
  const LOGO_URL = APP_URL + '/public/assets/img_0f3942d4.png';

  /* ---- Cuerpo en texto plano (fallback para clientes que no soportan HTML) ---- */
  const textBody = body || (
    'Hola,\n\n' +
    'Has sido invitado a unirte a Chronos Futbol como ' + roleLabel +
    (clubName ? ' del club ' + clubName : '') + '.\n\n' +
    'Para completar tu registro, haz clic en el siguiente enlace:\n' +
    inviteUrl + '\n\n' +
    'Si no puedes hacer clic, copia y pega la URL en tu navegador.\n\n' +
    'Si no esperabas este correo, puedes ignorarlo.\n\n' +
    'Saludos,\n' +
    senderName + ' - Equipo Chronos Futbol'
  );

  /* ---- Cuerpo principal del mensaje (por defecto o personalizado) ---- */
  const customBodyHtml = body
    ? _esc(body).replace(/\n\n/g, '</p><p style="font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 20px 0;">')
          .replace(/\n/g, '<br/>')
    : `<strong>${_esc(senderName)}</strong> te ha invitado a unirte a <strong>Chronos Futbol</strong> como:`;

  /* ---- Cuerpo en HTML con logo y diseño profesional ---- */
  const htmlBody = (
    '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">' +

      /* -- Cabecera con logo y color de marca -- */
      '<div style="background: linear-gradient(135deg, #1a237e 0%, #283593 50%, #3949ab 100%); padding: 30px 20px; text-align: center;">' +
        '<img src="' + LOGO_URL + '" alt="Chronos Futbol" style="max-width: 180px; height: auto; display: block; margin: 0 auto 12px auto;" />' +
        '<h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 600;">Invitacion a Chronos Futbol</h1>' +
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
          'Si el boton no funciona, copia y pega este enlace en tu navegador:<br/>' +
          '<a href="' + inviteUrl + '" style="color: #3949ab; word-break: break-all;">' + inviteUrl + '</a>' +
        '</p>' +
      '</div>' +

      /* -- Pie del correo -- */
      '<div style="background-color: #f5f5f5; padding: 20px; text-align: center; border-top: 1px solid #e0e0e0;">' +
        '<p style="margin: 0 0 6px 0; font-size: 13px; color: #999999;">Enviado por ' + _esc(senderName) + ' desde Chronos Futbol</p>' +
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

/* ==================================================================== */
/* 0️⃣0️⃣ Cloud Function: approveIndividualAdmin – Aprobar admin individual */
/* ==================================================================== */
exports.approveIndividualAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado');
  }

  const callerDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== 'superadmin') {
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

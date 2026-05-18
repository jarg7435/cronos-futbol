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
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Rol inválido. Roles permitidos: ' + validRoles.join(', ')
    );
  }

  const claims = {
    role: role,
    clubId: clubId || null,
    claimsSetAt: Date.now()
  };

  try {
    await admin.auth().setCustomUserClaims(uid, claims);

    await admin.firestore()
      .collection('users')
      .doc(uid)
      .update({
        role: role,
        clubId: clubId || null,
        claimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    console.log('[setCustomClaims] Claims asignados:', { uid, role, clubId });

    return { success: true, uid, role, clubId };
  } catch (error) {
    console.error('[setCustomClaims] Error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Error al asignar claims: ' + error.message
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
  const viewerClubId = context.auth.token.clubId || null;
  const viewerRole = context.auth.token.role || null;

  if (viewerRole === 'superadmin') return matchData;
  if (matchData.clubId && matchData.clubId === viewerClubId) return matchData;

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
      await admin.firestore()
        .collection('pseudonym_map')
        .doc(key)
        .set({
          realName: playerData.name,
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

  if (!callerDoc.exists() || !['superadmin', 'admin', 'individual', 'admin_individual'].includes(callerDoc.data().role)) {
    throw new functions.https.HttpsError('permission-denied', 'Solo SuperAdmin o Administrador Individual puede eliminar usuarios');
  }

  /* ******************************************************************* */
  /* ---- CORRECCIÓN PRINCIPAL: definir uid antes de usarlo ------------ */
  /* ******************************************************************* */
  const { uid, email } = data;   // <─ ¡Ahora uid está definido!

  if (!uid || !email) {
    throw new functions.https.HttpsError('invalid-argument', 'uid y email son requeridos');
  }

  /* ------------------------------------------------------------------- */
  /* La verificación de que el usuario a eliminar está dentro del mismo */
  /* ente del administrador (individual) se conserva y se copia tal cual   */
  /* ------------------------------------------------------------------- */
  const callerRole = callerDoc.data().role;
  if (['individual', 'admin_individual'].includes(callerRole)) {
    const callerEntityId = callerDoc.data().individualEntityId || callerDoc.data().clubId;
    try {
      const targetDoc = await admin.firestore().collection('users').doc(uid).get();
      if (targetDoc.exists()) {
        const targetEntityId = targetDoc.data().individualEntityId || targetDoc.data().clubId;
        if (targetEntityId !== callerEntityId) {
          throw new functions.https.HttpsError('permission-denied', 'Solo puedes eliminar usuarios de tu propio ente individual');
        }
      }
    } catch(e) {
      if (e.code === 'permission-denied') throw e;
    }
  }

  try {
    await admin.auth().deleteUser(uid);

    await admin.firestore().collection('audit_logs').add({
      action: 'delete_user',
      targetUid: uid,
      targetEmail: email,
      performedBy: context.auth.token.email,
      performedByUid: callerUid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress: context.rawRequest.ip,
    });

    return {
      success: true,
      message: `${email} eliminado de Firebase Auth`,
      deletedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error al eliminar usuario:', error);

    await admin.firestore().collection('error_logs').add({
      action: 'delete_user_failed',
      targetUid: uid,
      targetEmail: email,
      error: error.message,
      performedBy: context.auth.token.email,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    throw new functions.https.HttpsError('internal', `Error al eliminar usuario: ${error.message}`);
  }
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
        const clubDoc = await clubRef.get();

        if (clubDoc.exists()) {
          const club = clubDoc.data();
          const usedSlots = club.usedSlots || {};
          const roleKey = after.role === 'director' ? 'directors'
                      : after.role === 'coordinator' ? 'coordinators'
                      : after.role === 'parent' ? 'parents'
                      : 'users';

          if (after.status === 'removed' || after.status === 'blocked') {
            usedSlots[roleKey] = Math.max(0, (usedSlots[roleKey] || 0) - 1);
          }

          await clubRef.update({ usedSlots });
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
/* 9️⃣ Cloud Function: sendInviteEmail – Enviar email de invitación */
/* ==================================================================== */
exports.sendInviteEmail = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado');
  }

  const callerDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists() || !['superadmin', 'admin'].includes(callerDoc.data().role)) {
    throw new functions.https.HttpsError('permission-denied', 'Solo SuperAdmin puede enviar invitaciones');
  }

  const { to, subject, body, role, clubName } = data;
  if (!to) {
    throw new functions.https.HttpsError('invalid-argument', 'Se requiere el email de destino');
  }

  const emailUser = functions.config().email?.user;
  const emailPass = functions.config().email?.pass;

  if (!emailUser || !emailPass) {
    console.warn('[sendInviteEmail] Credenciales de email no configuradas. Usa: firebase functions:config:set email.user="..." email.pass="..."');
    throw new functions.https.HttpsError('failed-precondition', 'Credenciales de email no configuradas en Firebase');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: emailUser, pass: emailPass },
  });

  const defaultSubject = subject || 'Invitación a Chronos Fútbol';
  const roleLabels = {
    club_admin: 'Administrador de Club',
    individual: 'Entrenador Individual',
    director: 'Director Deportivo',
    coordinator: 'Coordinador',
    user: 'Entrenador',
    parent: 'Padre/Madre/Tutor',
  };
  const roleLabel = roleLabels[role] || role || 'Usuario';

  const defaultBody = body || `
Hola,

Has sido invitado a unirte a Chronos Fútbol como ${roleLabel}${clubName ? ' del club ' + clubName : ''}.

Para completar tu registro, accede a la aplicación con este email y crea tu cuenta:
https://cronos-futbol.web.app

Si no esperabas este correo, puedes ignorarlo.

Saludos,
Equipo Chronos Fútbol
`;

  try {
    const info = await transporter.sendMail({
      from: `"Chronos Fútbol" <${emailUser}>`,
      to,
      subject: defaultSubject,
      text: defaultBody,
    });

    console.log('[sendInviteEmail] Email enviado a:', to, 'MessageId:', info.messageId);

    return {
      success: true,
      messageId: info.messageId,
      sentTo: to,
    };
  } catch (error) {
    console.error('[sendInviteEmail] Error:', error);
    throw new functions.https.HttpsError('internal', `Error al enviar email: ${error.message}`);
  }
});

console.log('Cloud Functions v8.2 cargadas (Fase 0 + originales + sendInviteEmail)');

/* ==================================================================== */
/* 0️⃣0️⃣ Cloud Function: approveIndividualAdmin – Aprobar admin individual */
/* ==================================================================== */
exports.approveIndividualAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado');
  }

  const callerDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists() || callerDoc.data().role !== 'superadmin') {
    throw new functions.https.HttpsError('permission-denied', 'Solo SuperAdmin puede aprobar administradores individuales');
  }

  const { uid, entityId } = data;
  if (!uid || !entityId) {
    throw new functions.https.HttpsError('invalid-argument', 'Se requieren uid y entityId');
  }

  try {
    /* 1️⃣ Obtener el usuario a aprobar --------------------------------- */
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists()) {
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
    if (entityDoc.exists() && entityDoc.data().type === 'individual') {
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
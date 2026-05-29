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

  if (!callerDoc.exists || !['superadmin', 'admin', 'individual', 'admin_individual'].includes(callerDoc.data().role)) {
    throw new functions.https.HttpsError('permission-denied', 'Solo SuperAdmin o Administrador Individual puede eliminar usuarios');
  }

  const { uid, email } = data;

  if (!uid || !email) {
    throw new functions.https.HttpsError('invalid-argument', 'uid y email son requeridos');
  }

  const callerRole = callerDoc.data().role;
  if (['individual', 'admin_individual'].includes(callerRole)) {
    const callerEntityId = callerDoc.data().individualEntityId || callerDoc.data().clubId;
    try {
      const targetDoc = await admin.firestore().collection('users').doc(uid).get();
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

        if (clubDoc.exists) {
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
  if (!to) {
    throw new functions.https.HttpsError('invalid-argument', 'Se requiere el email de destino');
  }

  /* ---- Leer credenciales: process.env (nuevo sistema Firebase v5) ---- */
  /* Para configurarlas: firebase functions:secrets:set EMAIL_USER        */
  /*                     firebase functions:secrets:set EMAIL_PASS        */
  /* O con variables de entorno: firebase functions:config deprecado.     */
  /* Fallback compatible: también lee las variables de entorno de proceso */
  const emailUser = process.env.EMAIL_USER
    || (typeof functions.config === 'function' && functions.config().email && functions.config().email.user)
    || null;
  const emailPass = process.env.EMAIL_PASS
    || (typeof functions.config === 'function' && functions.config().email && functions.config().email.pass)
    || null;

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
    ? body.replace(/\n/g, '<br/>')
          .replace(/\n\n/g, '</p><p style="font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 20px 0;">')
    : `<strong>${senderName}</strong> te ha invitado a unirte a <strong>Chronos Futbol</strong> como:`;

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
          '<p style="margin: 0 0 8px 0; font-size: 15px; color: #555555;">Rol: <strong style="color: #1a237e;">' + roleLabel + '</strong></p>' +
          (clubName ? '<p style="margin: 0; font-size: 15px; color: #555555;">Club: <strong style="color: #1a237e;">' + clubName + '</strong></p>' : '') +
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
        '<p style="margin: 0 0 6px 0; font-size: 13px; color: #999999;">Enviado por ' + senderName + ' desde Chronos Futbol</p>' +
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

console.log('Cloud Functions v8.3 cargadas (Fase 0 + originales + sendInviteEmail con HTML/Logo/URL corregida)');

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

/* ==================================================================== */
/* 🔐 SOLUCIÓN #7: LOG CENTRALIZADO DE AUDITORÍA */
/* Cloud Function que recibe logs del cliente y los guarda de forma segura */
/* ==================================================================== */
exports.logAuditEntry = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { matchId, playerId, action, value, changes } = data;

  // Validar datos mínimos
  if (!matchId || !action) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'matchId y action son requeridos'
    );
  }

  try {
    // Validar que el usuario tiene permisos sobre este partido
    const matchDoc = await admin.firestore().collection('matches').doc(matchId).get();
    if (!matchDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Partido no encontrado');
    }

    const match = matchDoc.data();
    const userClubId = context.auth.token.clubId;
    const isSuperAdmin = context.auth.token.role === 'superadmin';

    if (!isSuperAdmin && userClubId !== match.clubId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'No tienes permiso para auditar este partido'
      );
    }

    // Construir entrada de auditoría con timestamp de servidor
    const auditEntry = {
      matchId: matchId,
      playerId: playerId || null,
      playerName: data.playerName || null,
      action: action,
      value: value || null,
      changes: changes || {},
      userId: context.auth.uid,
      userEmail: context.auth.token.email,
      role: context.auth.token.role,
      
      // Timestamps
      clientTimestamp: data.clientTimestamp || Date.now(),
      serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      
      // Información de contexto
      ipAddress: context.rawRequest.ip,
      userAgent: context.rawRequest.headers['user-agent'] || 'unknown',
      
      // Detalles del dispositivo
      deviceInfo: data.deviceInfo || {},
      
      // Metadatos
      type: data.type || 'player_action',
      substitutionId: data.substitutionId || null,
      formationId: data.formationId || null
    };

    // Guardar en match_audit_log
    const auditRef = await admin.firestore()
      .collection('match_audit_log')
      .add(auditEntry);

    return {
      success: true,
      auditId: auditRef.id,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    if (error.code && error.message) {
      throw error;
    }

    console.error('[logAuditEntry] Error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Error al registrar auditoría'
    );
  }
});

/* ==================================================================== */
/* 🔐 SOLUCIÓN #4: VALIDACIÓN BACKEND DE CAMBIOS DE JUGADORES */
/* Previene inyección de datos maliciosos desde cliente */
/* ==================================================================== */
exports.validateAndUpdatePlayerAction = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { matchId, playerId, action, value } = data;

  // Validar que se proporcionen los datos mínimos requeridos
  if (!matchId || !playerId || !action) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Se requieren matchId, playerId y action'
    );
  }

  // 1. Validar que el usuario tiene permisos sobre este partido
  try {
    const matchDoc = await admin.firestore().collection('matches').doc(matchId).get();
    if (!matchDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Partido no encontrado');
    }

    const match = matchDoc.data();
    const userClubId = context.auth.token.clubId;
    const userRole = context.auth.token.role;
    const isSuperAdmin = userRole === 'superadmin';

    // Solo SuperAdmin, coach del club propietario, o director del club pueden cambiar acciones
    if (!isSuperAdmin && userClubId !== match.clubId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'No tienes permiso para modificar este partido'
      );
    }

    // 2. Validar que la acción sea permitida (whitelist)
    const allowedActions = ['goal', 'yellow_card', 'red_card', 'injury', 'substitute'];
    if (!allowedActions.includes(action)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Acción no válida. Permitidas: ' + allowedActions.join(', ')
      );
    }

    // 3. Validar rango de valores según la acción
    if (action === 'yellow_card' && ![0, 1, 2].includes(value)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Tarjeta amarilla inválida (debe ser 0, 1 o 2)'
      );
    }

    if (action === 'red_card' && ![0, 1].includes(value)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Tarjeta roja inválida (debe ser 0 o 1)'
      );
    }

    if (action === 'goal' && (typeof value !== 'number' || value < 0)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Goles inválidos (debe ser número >= 0)'
      );
    }

    if (action === 'injury' && ![true, false].includes(value)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Estado de lesión inválido (debe ser true o false)'
      );
    }

    // 4. Obtener el documento del jugador para validar integridad
    const playerDoc = await admin.firestore().collection('players').doc(playerId).get();
    if (!playerDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Jugador no encontrado');
    }

    const playerData = playerDoc.data();

    // Validar que el jugador pertenece al partido
    if (playerData.matchId !== matchId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'El jugador no pertenece a este partido'
      );
    }

    // 5. Grabar acción en audit trail ANTES de actualizar
    const auditEntry = {
      matchId: matchId,
      playerId: playerId,
      playerName: playerData.name,
      playerNumber: playerData.number,
      action: action,
      value: value,
      userId: context.auth.uid,
      userEmail: context.auth.token.email,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress: context.rawRequest.ip,
      userAgent: context.rawRequest.headers['user-agent'] || 'unknown'
    };

    await admin.firestore().collection('match_audit_log').add(auditEntry);

    // 6. Actualizar el jugador según la acción (con validaciones específicas)
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: context.auth.uid
    };

    switch (action) {
      case 'goal':
        updateData.goals = (playerData.goals || 0) + 1;
        break;

      case 'yellow_card':
        // value=0: sin amarilla, value=1: 1ª amarilla, value=2: 2ª amarilla
        updateData.yellowCards = value;
        if (value === 2) {
          updateData.cards = 'roja'; // 2ª amarilla = expulsión
        } else if (value === 1) {
          updateData.cards = 'amarilla';
        } else {
          updateData.cards = 'ninguna';
        }
        break;

      case 'red_card':
        updateData.cards = value === 1 ? 'roja' : 'ninguna';
        updateData.yellowCards = 0; // Roja directa (no es doble amarilla)
        break;

      case 'injury':
        updateData.injured = value === true;
        break;

      case 'substitute':
        // Validación especial para sustituciones
        updateData.status = value === 'field' ? 'field' : 'bench';
        if (value === 'bench') {
          updateData.x = 0;
          updateData.y = 0;
        }
        break;
    }

    await admin.firestore().collection('players').doc(playerId).update(updateData);

    return {
      success: true,
      matchId,
      playerId,
      action,
      value,
      updatedAt: new Date().toISOString(),
      message: 'Acción de jugador validada y actualizada correctamente'
    };

  } catch (error) {
    // Si es un HttpsError, relanzar tal cual
    if (error.code && error.message) {
      throw error;
    }

    // Si es otro error, registrar en logs de error y devolver genérico
    console.error('[validateAndUpdatePlayerAction] Error:', error);
    await admin.firestore().collection('error_logs').add({
      function: 'validateAndUpdatePlayerAction',
      matchId: data.matchId,
      error: error.message,
      stack: error.stack,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    throw new functions.https.HttpsError(
      'internal',
      'Error al procesar acción del jugador'
    );
  }
});

/* ==================================================================== */
/* ✉️ SOLUCIÓN #8: CONFIRMACIÓN DE EMAIL EN REGISTROS */
/* Genera código de verificación y lo envía al email del usuario */
/* ==================================================================== */
exports.sendEmailVerification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { email } = data;
  if (!email || !email.includes('@')) {
    throw new functions.https.HttpsError('invalid-argument', 'Email inválido');
  }

  try {
    // Generar código único de 6 dígitos
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 3600000); // Expira en 1 hora

    // Guardar código en Firestore
    await admin.firestore()
      .collection('email_verifications')
      .doc(email)
      .set({
        code: verificationCode,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: expiresAt,
        attempts: 0,
        verified: false,
        userId: context.auth.uid
      });

    // Enviar email con código (si credenciales configuradas)
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (emailUser && emailPass) {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: emailUser, pass: emailPass }
      });

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background-color: #f5f5f5; padding: 20px; border-radius: 8px;">
          <div style="background: linear-gradient(135deg, #1a237e 0%, #3949ab 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h2 style="margin: 0;">Verificación de Email</h2>
            <p style="margin: 5px 0 0 0; font-size: 0.9rem; opacity: 0.9;">Chronos Fútbol</p>
          </div>
          <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px;">
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Para verificar tu email y completar el registro, usa el siguiente código:
            </p>
            <div style="background: #f0f0f0; padding: 20px; border-radius: 6px; text-align: center; margin: 20px 0;">
              <code style="font-size: 32px; font-weight: bold; letter-spacing: 2px; color: #1a237e;">
                ${verificationCode}
              </code>
            </div>
            <p style="font-size: 14px; color: #666; margin: 20px 0;">
              Este código expira en <strong>1 hora</strong>.
            </p>
            <p style="font-size: 12px; color: #999; margin: 0;">
              Si no solicitaste este código, ignora este email.
            </p>
          </div>
        </div>
      `;

      await transporter.sendMail({
        from: `"Chronos Fútbol" <${emailUser}>`,
        to: email,
        subject: 'Verifica tu email - Chronos Fútbol',
        html: htmlBody,
        text: `Tu código de verificación es: ${verificationCode}\nExpira en 1 hora.`
      });
    }

    return {
      success: true,
      email,
      message: 'Código de verificación enviado',
      expiresIn: 3600 // segundos
    };

  } catch (error) {
    console.error('[sendEmailVerification] Error:', error);
    throw new functions.https.HttpsError('internal', 'Error al enviar verificación');
  }
});

/* ==================================================================== */
/* ✉️ Validar código de verificación de email */
/* ==================================================================== */
exports.verifyEmailCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { email, code } = data;
  if (!email || !code) {
    throw new functions.https.HttpsError('invalid-argument', 'Email y código requeridos');
  }

  try {
    const verDoc = await admin.firestore()
      .collection('email_verifications')
      .doc(email)
      .get();

    if (!verDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Verificación no encontrada');
    }

    const verData = verDoc.data();

    // Validar expiración
    if (new Date() > verData.expiresAt.toDate()) {
      throw new functions.https.HttpsError('failed-precondition', 'Código expirado');
    }

    // Validar número de intentos
    if ((verData.attempts || 0) >= 5) {
      throw new functions.https.HttpsError('resource-exhausted', 'Demasiados intentos fallidos');
    }

    // Validar código
    if (code !== verData.code) {
      // Incrementar intentos
      await admin.firestore()
        .collection('email_verifications')
        .doc(email)
        .update({ attempts: admin.firestore.FieldValue.increment(1) });

      throw new functions.https.HttpsError('invalid-argument', 'Código incorrecto');
    }

    // Marcar como verificado
    await admin.firestore()
      .collection('email_verifications')
      .doc(email)
      .update({
        verified: true,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    // Actualizar usuario
    await admin.firestore()
      .collection('users')
      .doc(context.auth.uid)
      .update({
        emailVerified: true,
        emailVerifiedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    return { success: true, message: 'Email verificado correctamente' };

  } catch (error) {
    if (error.code && error.message) throw error;
    console.error('[verifyEmailCode] Error:', error);
    throw new functions.https.HttpsError('internal', 'Error al verificar código');
  }
});

/* ==================================================================== */
/* 🗑️ SOLUCIÓN #8: EXPIRACIÓN AUTOMÁTICA DE SOLICITUDES PENDIENTES */
/* Cloud Scheduler (cada 24h) limpia solicitudes antiguas */
/* ==================================================================== */
exports.cleanupExpiredRegistrationRequests = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      // 1. Obtener solicitudes pendientes expiradas
      const expiredSnap = await admin.firestore()
        .collection('platform_requests')
        .where('status', 'in', ['pending_sa', 'pending_admin'])
        .where('createdAt', '<', thirtyDaysAgo)
        .get();

      if (expiredSnap.empty) {
        console.log('[cleanupExpiredRegistrationRequests] No hay solicitudes expiradas');
        return null;
      }

      // 2. Marcar como expiradas y registrar
      const batch = admin.firestore().batch();
      let count = 0;

      expiredSnap.forEach(doc => {
        batch.update(doc.ref, {
          status: 'expired',
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'No fue confirmada dentro de 30 días'
        });
        count++;
      });

      await batch.commit();

      // 3. Notificar a SuperAdmin
      await admin.firestore().collection('notifications').add({
        type: 'cleanup_completed',
        expiredCount: count,
        cleanupDate: admin.firestore.FieldValue.serverTimestamp(),
        targetRole: 'superadmin'
      });

      console.log(`[cleanupExpiredRegistrationRequests] ${count} solicitudes marcadas como expiradas`);
      return null;

    } catch (error) {
      console.error('[cleanupExpiredRegistrationRequests] Error:', error);
      throw error;
    }
  });

/* ==================================================================== */
/* 🗑️ Eliminar solicitudes completamente (solo SuperAdmin) */
/* ==================================================================== */
exports.deleteExpiredRequest = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const callerDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== 'superadmin') {
    throw new functions.https.HttpsError('permission-denied', 'Solo SuperAdmin');
  }

  const { requestId } = data;
  if (!requestId) {
    throw new functions.https.HttpsError('invalid-argument', 'requestId requerido');
  }

  try {
    const reqDoc = await admin.firestore().collection('platform_requests').doc(requestId).get();
    if (!reqDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Solicitud no encontrada');
    }

    const reqData = reqDoc.data();
    if (reqData.status !== 'expired') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Solo pueden eliminarse solicitudes expiradas'
      );
    }

    // Borrar documento y registrar en audit
    await admin.firestore().collection('platform_requests').doc(requestId).delete();

    await admin.firestore().collection('audit_logs').add({
      action: 'delete_expired_request',
      requestId,
      performedBy: context.auth.token.email,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, message: 'Solicitud eliminada' };

  } catch (error) {
    if (error.code && error.message) throw error;
    console.error('[deleteExpiredRequest] Error:', error);
    throw new functions.https.HttpsError('internal', 'Error al eliminar solicitud');
  }
});

console.log('✅ Cloud Functions v8.4 actualizado - Sprint 2: Auditoría, Email Verification, Cleanup completado');

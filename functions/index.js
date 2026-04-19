const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();

// Le cambiamos el nombre para que Google no se bloquee
exports.deleteAuthUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'No identificado');
    }

    try {
        await admin.auth().deleteUser(data.uid);
        return { success: true, message: 'Usuario eliminado' };
    } catch (error) {
        throw new functions.https.HttpsError('internal', error.message);
    }
});



// ═══════════════════════════════════════════════════════════════════════════
// Cloud Function: Eliminar usuario de Firebase Auth
// ═══════════════════════════════════════════════════════════════════════════

exports.deleteAuthUser = functions.https.onCall(async (data, context) => {
    // Verificar que el usuario está autenticado
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Usuario no autenticado'
        );
    }

    // Verificar que el usuario es SuperAdmin
    const callerUid = context.auth.uid;
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    
    if (!callerDoc.exists() || !['superadmin', 'admin'].includes(callerDoc.data().role)) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Solo SuperAdmin puede eliminar usuarios'
        );
    }

    const { uid, email } = data;

    // Validar que uid y email están presentes
    if (!uid || !email) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'uid y email son requeridos'
        );
    }

    try {
        // Eliminar usuario de Firebase Auth
        await admin.auth().deleteUser(uid);

        // Log de auditoría
        await admin.firestore().collection('audit_logs').add({
            action: 'delete_user',
            targetUid: uid,
            targetEmail: email,
            performedBy: context.auth.token.email,
            performedByUid: callerUid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ipAddress: context.rawRequest.ip,
        });

        console.log(`✅ Usuario ${email} (${uid}) eliminado de Auth`);

        return {
            success: true,
            message: `${email} eliminado de Firebase Auth`,
            deletedAt: new Date().toISOString(),
        };

    } catch (error) {
        console.error('❌ Error al eliminar usuario:', error);

        // Log de error
        await admin.firestore().collection('error_logs').add({
            action: 'delete_user_failed',
            targetUid: uid,
            targetEmail: email,
            error: error.message,
            performedBy: context.auth.token.email,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        throw new functions.https.HttpsError(
            'internal',
            `Error al eliminar usuario: ${error.message}`
        );
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// Cloud Function: Sincronizar cambios de usuarios entre clubes
// ═══════════════════════════════════════════════════════════════════════════

exports.syncUserChanges = functions.firestore
    .document('users/{userId}')
    .onWrite(async (change, context) => {
        const userId = context.params.userId;
        const before = change.before.data();
        const after = change.after.data();

        // Si el documento fue eliminado
        if (!after) {
            console.log(`🗑️ Usuario ${userId} eliminado`);

            // Notificar a SuperAdmin (opcional)
            await admin.firestore().collection('notifications').add({
                type: 'user_deleted',
                userId,
                email: before?.email,
                deletedAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            });

            return;
        }

        // Si el estado cambió a "removed" o "blocked"
        if (before?.status !== after?.status && ['removed', 'blocked'].includes(after.status)) {
            console.log(`📝 Usuario ${userId} cambió a estado: ${after.status}`);

            // Actualizar estadísticas del club
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

                    if (after.status === 'removed') {
                        // Decrementar slots usados
                        usedSlots[roleKey] = Math.max(0, (usedSlots[roleKey] || 0) - 1);
                    } else if (after.status === 'blocked') {
                        // Decrementar slots usados
                        usedSlots[roleKey] = Math.max(0, (usedSlots[roleKey] || 0) - 1);
                    }

                    await clubRef.update({ usedSlots });
                }
            }
        }
    });

// ═══════════════════════════════════════════════════════════════════════════
// Cloud Function: Limpiar solicitudes de plazas expiradas
// ═══════════════════════════════════════════════════════════════════════════

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
            console.log(`✅ ${count} solicitudes marcadas como expiradas`);
        }

        return null;
    });

// ═══════════════════════════════════════════════════════════════════════════
// Cloud Function: Enviar notificación cuando hay solicitud de plaza
// ═══════════════════════════════════════════════════════════════════════════

exports.notifySlotRequest = functions.firestore
    .document('slot_requests/{requestId}')
    .onCreate(async (snap, context) => {
        const request = snap.data();

        // Crear notificación para SuperAdmin
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

        console.log(`📋 Nueva solicitud de plaza: ${request.clubName} - ${request.requestedRole}`);
    });

// ═══════════════════════════════════════════════════════════════════════════
// Cloud Function: Audit Log para cambios de estado de usuario
// ═══════════════════════════════════════════════════════════════════════════

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

            console.log(`📝 Usuario ${after.email}: ${before.status} → ${after.status}`);
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

            console.log(`🔐 Usuario ${after.email}: autorizado = ${after.isAuthorized}`);
        }
    });

console.log('✅ Cloud Functions v8.0 cargadas');

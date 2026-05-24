/**
 * Chronos Fútbol - User Management Improvements v8.0
 * Gestión completa de usuarios: eliminación real, sincronización automática y flujo de plazas
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. ELIMINACIÓN REAL EN FIREBASE AUTH + FIRESTORE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Elimina un usuario de forma DEFINITIVA:
 * - Elimina de Firebase Auth
 * - Elimina de Firestore
 * - Libera la plaza en el club
 * - Sincroniza automáticamente en SuperAdmin
 */
async function deleteUserPermanently(uid, email, clubId, role) {
    if (!confirm(`⚠️ ELIMINAR DEFINITIVAMENTE: ${email}\n\nEsta acción es IRREVERSIBLE.\nEl usuario podrá registrarse de nuevo con este email.\n\n¿Confirmar?`)) {
        return false;
    }

    showSpinner('Eliminando usuario definitivamente...');
    try {
        const { fa, doc, deleteDoc, getDoc, updateDoc, httpsCallable } = await saFS();

        // 1. Eliminar de Firebase Auth (usando Cloud Function)
        const deleteAuthUser = httpsCallable(fa.functions, 'deleteAuthUser');
        await deleteAuthUser({ uid, email });

        // 2. Eliminar documento de usuario en Firestore
        await deleteDoc(doc(fa.db, 'users', uid));

        // 3. Liberar la plaza en el club
        if (clubId) {
            const clubRef = doc(fa.db, 'clubs', clubId);
            const clubSnap = await getDoc(clubRef);
            if (clubSnap.exists()) {
                const usedSlots = clubSnap.data().usedSlots || {};
                const roleKey = role === 'director' ? 'directors'
                              : role === 'coordinator' ? 'coordinators'
                              : role === 'parent' ? 'parents'
                              : 'users';
                
                usedSlots[roleKey] = Math.max(0, (usedSlots[roleKey] || 0) - 1);
                await updateDoc(clubRef, { usedSlots });
            }
        }

        hideSpinner();
        showToast(`🗑️ ${email} eliminado definitivamente. Puede registrarse de nuevo.`, 4000);
        return true;

    } catch (e) {
        hideSpinner();
        console.error('Error al eliminar usuario:', e);
        showToast(`⚠️ Error: ${e.message}`, 4000);
        return false;
    }
}
window.deleteUserPermanently = deleteUserPermanently;

// ═══════════════════════════════════════════════════════════════════════════
// 2. SINCRONIZACIÓN AUTOMÁTICA: Cambios en Club → SuperAdmin
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Listener que detecta cambios en usuarios de un club
 * y actualiza automáticamente la vista del SuperAdmin
 */
async function setupUserSyncListener(clubId) {
    try {
        const { fa, collection, query, where, onSnapshot } = await saFS();

        // Escuchar cambios en usuarios del club
        const q = query(
            collection(fa.db, 'users'),
            where('clubId', '==', clubId)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'removed') {
                    // Usuario eliminado en el club → eliminar del SuperAdmin
                    console.log(`🗑️ Usuario ${change.doc.id} eliminado en club ${clubId}`);
                    // Actualizar vista del SuperAdmin si está abierta
                    if (typeof saClubs === 'function') {
                        saClubs();
                    }
                } else if (change.type === 'modified') {
                    // Usuario modificado → actualizar vista
                    console.log(`✏️ Usuario ${change.doc.id} modificado en club ${clubId}`);
                    if (typeof saClubs === 'function') {
                        saClubs();
                    }
                }
            });
        });

        return unsubscribe;
    } catch (e) {
        console.error('Error en setupUserSyncListener:', e);
    }
}
window.setupUserSyncListener = setupUserSyncListener;

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROTOCOLO DE PLAZAS: Solicitud → Aprobación → Visto Bueno
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estructura de una solicitud de plaza:
 * {
 *   id: "req_xxx",
 *   clubId: "club_xxx",
 *   clubName: "Club Deportivo Jose",
 *   adminEmail: "admin@club.com",
 *   requestedRole: "director" | "coordinator" | "user" | "parent",
 *   quantity: 1,
 *   status: "pending" | "approved" | "rejected",
 *   createdAt: timestamp,
 *   approvedAt: timestamp,
 *   approvedBy: "superadmin_email",
 *   notes: "Necesitamos más directores"
 * }
 */

/**
 * Admin del Club solicita una nueva plaza al SuperAdmin
 */
async function requestUserSlot(clubId, role, quantity = 1, notes = '') {
    if (!['director', 'coordinator', 'user', 'parent'].includes(role)) {
        showToast('❌ Rol inválido', 2000);
        return false;
    }

    showSpinner('Enviando solicitud...');
    try {
        const { fa, collection, addDoc, getDoc, doc } = await saFS();
        const clubSnap = await getDoc(doc(fa.db, 'clubs', clubId));
        
        if (!clubSnap.exists()) {
            throw new Error('Club no encontrado');
        }

        const club = clubSnap.data();
        const request = {
            clubId,
            clubName: club.name,
            adminEmail: club.adminEmail,
            requestedRole: role,
            quantity,
            status: 'pending',
            createdAt: new Date().toISOString(),
            notes,
        };

        const docRef = await addDoc(collection(fa.db, 'slot_requests'), request);
        hideSpinner();
        showToast(`✅ Solicitud enviada al SuperAdmin. ID: ${docRef.id}`, 4000);
        return docRef.id;

    } catch (e) {
        hideSpinner();
        console.error('Error en requestUserSlot:', e);
        showToast(`⚠️ Error: ${e.message}`, 4000);
        return false;
    }
}
window.requestUserSlot = requestUserSlot;

/**
 * SuperAdmin aprueba una solicitud de plaza
 */
async function approveSlotsRequest(requestId, approve = true) {
    const action = approve ? 'aprobar' : 'rechazar';
    if (!confirm(`¿${action} esta solicitud de plazas?`)) return false;

    showSpinner(`${action === 'aprobar' ? 'Aprobando' : 'Rechazando'} solicitud...`);
    try {
        const { fa, doc, updateDoc, getDoc } = await saFS();
        const reqSnap = await getDoc(doc(fa.db, 'slot_requests', requestId));
        
        if (!reqSnap.exists()) {
            throw new Error('Solicitud no encontrada');
        }

        const req = reqSnap.data();
        const superAdminEmail = window._cronosCurrentUser?.email || 'superadmin@chronos.com';

        if (approve) {
            // Actualizar slots disponibles del club
            const clubSnap = await getDoc(doc(fa.db, 'clubs', req.clubId));
            if (clubSnap.exists()) {
                const club = clubSnap.data();
                const slots = club.slots || {};
                const roleKey = req.requestedRole === 'director' ? 'directors'
                              : req.requestedRole === 'coordinator' ? 'coordinators'
                              : req.requestedRole === 'parent' ? 'parents'
                              : 'users';
                
                // Si es -1 (ilimitado), mantener -1; si no, sumar
                if (slots[roleKey] !== -1) {
                    slots[roleKey] = (slots[roleKey] || 0) + req.quantity;
                }

                await updateDoc(doc(fa.db, 'clubs', req.clubId), { slots });
            }

            // Actualizar solicitud
            await updateDoc(doc(fa.db, 'slot_requests', requestId), {
                status: 'approved',
                approvedAt: new Date().toISOString(),
                approvedBy: superAdminEmail,
            });

            hideSpinner();
            showToast(`✅ Solicitud aprobada. Plazas asignadas: ${req.quantity}`, 4000);
        } else {
            // Rechazar solicitud
            await updateDoc(doc(fa.db, 'slot_requests', requestId), {
                status: 'rejected',
                rejectedAt: new Date().toISOString(),
                rejectedBy: superAdminEmail,
            });

            hideSpinner();
            showToast(`❌ Solicitud rechazada`, 3000);
        }

        return true;

    } catch (e) {
        hideSpinner();
        console.error('Error en approveSlotsRequest:', e);
        showToast(`⚠️ Error: ${e.message}`, 4000);
        return false;
    }
}
window.approveSlotsRequest = approveSlotsRequest;

// ═══════════════════════════════════════════════════════════════════════════
// 4. MEJORA EN REGISTRO: Ojo para ver contraseña + Validación
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Añade funcionalidad de "ojo" a un campo de contraseña
 */
function setupPasswordToggle(inputId, toggleBtnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(toggleBtnId);

    if (!input || !btn) return;

    btn.addEventListener('click', () => {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.textContent = isPassword ? '🙈' : '👁️';
        btn.title = isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña';
    });
}
window.setupPasswordToggle = setupPasswordToggle;

/**
 * Valida contraseña con requisitos mínimos
 */
function validatePassword(password) {
    const errors = [];
    
    if (password.length < 8) {
        errors.push('Mínimo 8 caracteres');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Al menos una mayúscula');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Al menos una minúscula');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Al menos un número');
    }
    if (!/[!@#$%^&*]/.test(password)) {
        errors.push('Al menos un carácter especial (!@#$%^&*)');
    }

    return {
        valid: errors.length === 0,
        errors,
        message: errors.length > 0 ? `Contraseña débil:\n- ${errors.join('\n- ')}` : '✅ Contraseña fuerte'
    };
}

/**
 * Valida contraseña con detalle de fortaleza (compatibilidad con auth.js)
 * Reemplaza la función que estaba en auth-improvements.js (eliminado).
 * auth.js llama validatePasswordStrength() en la línea 1375-1376.
 */
function validatePasswordStrength(password) {
    const requirements = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[!@#$%^&*]/.test(password),
    };

    const score = Object.values(requirements).filter(Boolean).length;
    
    return {
        valid: score === 5,
        score,
        requirements,
        strength: score <= 2 ? 'Débil' : score <= 3 ? 'Media' : score <= 4 ? 'Fuerte' : 'Muy Fuerte',
    };
}
window.validatePassword = validatePassword;
window.validatePasswordStrength = validatePasswordStrength;

/**
 * Verifica que las contraseñas coincidan
 */
function checkPasswordMatch(pwd1Id, pwd2Id) {
    const pwd1 = document.getElementById(pwd1Id)?.value || '';
    const pwd2 = document.getElementById(pwd2Id)?.value || '';
    
    if (!pwd1 || !pwd2) return null;
    
    return pwd1 === pwd2;
}
window.checkPasswordMatch = checkPasswordMatch;

// ═══════════════════════════════════════════════════════════════════════════
// 5. VISTA DE USUARIOS ELIMINADOS/ANULADOS EN SUPERADMIN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene todos los usuarios con estado "removed" o "blocked"
 */
async function getDeletedUsers() {
    try {
        const { fa, collection, query, where, getDocs } = await saFS();
        
        const q = query(
            collection(fa.db, 'users'),
            where('status', 'in', ['removed', 'blocked'])
        );

        const snapshot = await getDocs(q);
        const users = [];
        
        snapshot.forEach(doc => {
            users.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return users.sort((a, b) => 
            new Date(b.removedAt || b.blockedAt) - new Date(a.removedAt || a.blockedAt)
        );

    } catch (e) {
        console.error('Error en getDeletedUsers:', e);
        return [];
    }
}
window.getDeletedUsers = getDeletedUsers;

/**
 * Limpia definitivamente un usuario eliminado (borra el rastro)
 */
async function purgeDeletedUser(uid, email) {
    if (!confirm(`🗑️ LIMPIAR RASTRO: ${email}\n\nEsta acción es IRREVERSIBLE.\n¿Confirmar?`)) {
        return false;
    }

    showSpinner('Limpiando rastro...');
    try {
        const { fa, doc, deleteDoc } = await saFS();
        await deleteDoc(doc(fa.db, 'users', uid));
        
        hideSpinner();
        showToast(`✅ Rastro de ${email} eliminado`, 3000);
        return true;

    } catch (e) {
        hideSpinner();
        console.error('Error en purgeDeletedUser:', e);
        showToast(`⚠️ Error: ${e.message}`, 4000);
        return false;
    }
}
window.purgeDeletedUser = purgeDeletedUser;

// ═══════════════════════════════════════════════════════════════════════════
// 6. CLOUD FUNCTION PARA ELIMINAR DE FIREBASE AUTH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * NOTA: Esta función debe ser ejecutada como Cloud Function en Firebase
 * Copiar este código a: functions/index.js
 * 
 * exports.deleteAuthUser = functions.https.onCall(async (data, context) => {
 *     const { uid, email } = data;
 *     
 *     if (!context.auth) {
 *         throw new functions.https.HttpsError('unauthenticated', 'Usuario no autenticado');
 *     }
 *     
 *     try {
 *         await admin.auth().deleteUser(uid);
 *         console.log(`Usuario ${email} (${uid}) eliminado de Auth`);
 *         return { success: true, message: `${email} eliminado de Auth` };
 *     } catch (error) {
 *         console.error('Error al eliminar usuario:', error);
 *         throw new functions.https.HttpsError('internal', error.message);
 *     }
 * });
 */

// ═══════════════════════════════════════════════════════════════════════════
// 7. INTEGRACIÓN EN FLUJO DE REGISTRO (auth.js)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mejora para auth.js: Permitir re-registro si el usuario fue eliminado
 * 
 * En la función de registro, antes de crear el usuario:
 * 
 * async function handleRegister(email, password) {
 *     try {
 *         // Validar contraseña
 *         const pwdValidation = validatePassword(password);
 *         if (!pwdValidation.valid) {
 *             showToast(pwdValidation.message, 4000);
 *             return;
 *         }
 *
 *         // Buscar si el usuario existe pero fue eliminado
 *         const { fa, collection, query, where, getDocs } = await saFS();
 *         const q = query(
 *             collection(fa.db, 'users'),
 *             where('email', '==', email),
 *             where('status', 'in', ['removed', 'blocked'])
 *         );
 *         const snapshot = await getDocs(q);
 *         
 *         if (snapshot.size > 0) {
 *             // Usuario fue eliminado, permitir re-registro
 *             // Limpiar el documento antiguo
 *             const oldDoc = snapshot.docs[0];
 *             await deleteDoc(doc(fa.db, 'users', oldDoc.id));
 *         }
 *
 *         // Proceder con el registro normal
 *         const userCred = await createUserWithEmailAndPassword(auth, email, password);
 *         // ... resto del código
 *     } catch (e) {
 *         // ... manejo de errores
 *     }
 * }
 */

console.log('✅ User Management Improvements v8.0 cargado');

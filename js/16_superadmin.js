/**
 * Chronos Fútbol - SuperAdmin Panel Improvements v8.0
 * Integración de:
 * - Eliminación definitiva de usuarios
 * - Sincronización automática
 * - Gestión de plazas
 * - Vista de usuarios eliminados
 * 
 * INSTRUCCIONES: Reemplaza las funciones correspondientes en 16_superadmin.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 1: Función mejorada saSetClubUserStatus con eliminación real
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reemplaza la función saSetClubUserStatus en 16_superadmin.js con esta:
 */
window.saSetClubUserStatus = async (uid, email, newStatus, clubId) => {
    const labels = {
        active: 'activar',
        blocked: 'bloquear',
        removed: 'eliminar definitivamente'
    };

    if (!confirm(`¿Deseas ${labels[newStatus]} a ${email}?`)) return;

    showSpinner('Procesando…');
    try {
        const { fa, doc, getDoc, updateDoc, deleteDoc, httpsCallable } = await saFS();

        // Leer rol del usuario para ajustar slots
        const uSnap = await getDoc(doc(fa.db, 'users', uid));
        const ud = uSnap.exists() ? uSnap.data() : {};
        const role = ud.role || 'user';
        const slotKey = role === 'director' ? 'usedSlots.directors'
                      : role === 'coordinator' ? 'usedSlots.coordinators'
                      : role === 'parent' ? 'usedSlots.parents'
                      : 'usedSlots.users';

        if (newStatus === 'removed') {
            // ═══════════════════════════════════════════════════════════
            // ELIMINACIÓN DEFINITIVA: Firestore + Firebase Auth
            // ═══════════════════════════════════════════════════════════

            // 1. Eliminar de Firebase Auth (Cloud Function)
            try {
                const deleteAuthUser = httpsCallable(fa.functions, 'deleteAuthUser');
                await deleteAuthUser({ uid, email });
                console.log(`✅ ${email} eliminado de Firebase Auth`);
            } catch (authErr) {
                console.warn('⚠️ No se pudo eliminar de Auth (puede estar ya eliminado):', authErr.message);
            }

            // 2. Eliminar documento de usuario en Firestore
            await deleteDoc(doc(fa.db, 'users', uid));

            // 3. Liberar la plaza en el club
            if (clubId) {
                const cSnap = await getDoc(doc(fa.db, 'clubs', clubId)).catch(() => null);
                if (cSnap?.exists()) {
                    const cur = cSnap.data().usedSlots?.[slotKey.split('.')[1]] || 1;
                    await updateDoc(doc(fa.db, 'clubs', clubId), {
                        [slotKey]: Math.max(0, cur - 1)
                    });
                }
            }

            hideSpinner();
            showToast(`🗑️ ${email} eliminado definitivamente. Puede registrarse de nuevo.`, 4000);

        } else {
            // ═══════════════════════════════════════════════════════════
            // ACTIVAR O BLOQUEAR (mantener en Firestore)
            // ═══════════════════════════════════════════════════════════

            const isActive = newStatus === 'active';
            await updateDoc(doc(fa.db, 'users', uid), {
                isAuthorized: isActive,
                status: newStatus,
                ...(isActive ? { authorizedAt: new Date().toISOString() } : { blockedAt: new Date().toISOString() }),
            });

            // Ajustar slots: bloquear resta, activar suma
            const cSnap = await getDoc(doc(fa.db, 'clubs', clubId)).catch(() => null);
            if (cSnap?.exists()) {
                const cur = cSnap.data().usedSlots?.[slotKey.split('.')[1]] || 0;
                const delta = isActive ? 1 : -1;
                await updateDoc(doc(fa.db, 'clubs', clubId), {
                    [slotKey]: Math.max(0, cur + delta)
                });
            }

            hideSpinner();
            showToast(isActive ? `✅ ${email} activado` : `🔒 ${email} bloqueado`, 3000);
        }

        saClubs();

    } catch (e) {
        hideSpinner();
        showToast('⚠️ Error: ' + e.message, 4000);
        console.error(e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 2: Nueva pestaña "Rastros" en SuperAdmin para limpiar usuarios
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Añade esta nueva pestaña al SuperAdmin (en openSuperAdminPanel):
 * 
 * <button class="sa-tab" onclick="saTab('trash')">🗑️ Rastros</button>
 * 
 * Y añade este manejador:
 */
window.saTrash = async () => {
    const body = document.getElementById('sa-body');
    body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando usuarios eliminados…</p>';

    try {
        const { fa, collection, query, where, getDocs, deleteDoc, doc } = await saFS();

        // Obtener usuarios con estado "removed" o "blocked"
        const q = query(
            collection(fa.db, 'users'),
            where('status', 'in', ['removed', 'blocked'])
        );

        const snapshot = await getDocs(q);
        const users = [];

        snapshot.forEach(d => {
            users.push({
                id: d.id,
                ...d.data()
            });
        });

        if (users.length === 0) {
            body.innerHTML = `
                <div style="text-align:center;padding:3rem;color:var(--text-muted);">
                    <p style="font-size:1.2rem;margin-bottom:0.5rem;">✅ Sin rastros</p>
                    <p style="font-size:0.9rem;">Todos los usuarios eliminados han sido limpiados.</p>
                </div>
            `;
            return;
        }

        // Agrupar por estado
        const removed = users.filter(u => u.status === 'removed');
        const blocked = users.filter(u => u.status === 'blocked');

        let html = `
            <div style="margin-bottom:1.5rem;">
                <h3 style="color:var(--primary);margin-bottom:0.8rem;">🗑️ Usuarios Eliminados (${removed.length})</h3>
                <div style="display:grid;gap:0.5rem;">
        `;

        removed.forEach(u => {
            const removedAt = new Date(u.removedAt).toLocaleDateString('es-ES');
            html += `
                <div style="background:var(--glass);border:1px solid rgba(255,88,88,0.3);
                           border-radius:8px;padding:0.8rem;display:flex;justify-content:space-between;
                           align-items:center;">
                    <div>
                        <div style="font-weight:700;color:var(--text);">${u.email}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);">
                            Rol: ${u.role || 'N/A'} · Eliminado: ${removedAt}
                        </div>
                    </div>
                    <button onclick="saPurgeUser('${u.id}', '${u.email}')"
                            style="padding:0.4rem 0.8rem;background:rgba(255,88,88,0.15);
                                   border:1px solid rgba(255,88,88,0.4);border-radius:6px;
                                   color:#ff5858;font-size:0.75rem;cursor:pointer;font-weight:700;">
                        🗑️ LIMPIAR
                    </button>
                </div>
            `;
        });

        html += `</div></div>`;

        if (blocked.length > 0) {
            html += `
                <div>
                    <h3 style="color:#f0883e;margin-bottom:0.8rem;">🔒 Usuarios Bloqueados (${blocked.length})</h3>
                    <div style="display:grid;gap:0.5rem;">
            `;

            blocked.forEach(u => {
                const blockedAt = new Date(u.blockedAt).toLocaleDateString('es-ES');
                html += `
                    <div style="background:var(--glass);border:1px solid rgba(240,136,62,0.3);
                               border-radius:8px;padding:0.8rem;display:flex;justify-content:space-between;
                               align-items:center;">
                        <div>
                            <div style="font-weight:700;color:var(--text);">${u.email}</div>
                            <div style="font-size:0.75rem;color:var(--text-muted);">
                                Rol: ${u.role || 'N/A'} · Bloqueado: ${blockedAt}
                            </div>
                        </div>
                        <div style="display:flex;gap:0.3rem;">
                            <button onclick="saSetClubUserStatus('${u.id}', '${u.email}', 'active', '${u.clubId}')"
                                    style="padding:0.4rem 0.8rem;background:rgba(63,185,80,0.15);
                                           border:1px solid rgba(63,185,80,0.4);border-radius:6px;
                                           color:#3fb950;font-size:0.75rem;cursor:pointer;font-weight:700;">
                                ✅ ACTIVAR
                            </button>
                            <button onclick="saPurgeUser('${u.id}', '${u.email}')"
                                    style="padding:0.4rem 0.8rem;background:rgba(255,88,88,0.15);
                                           border:1px solid rgba(255,88,88,0.4);border-radius:6px;
                                           color:#ff5858;font-size:0.75rem;cursor:pointer;font-weight:700;">
                                🗑️ LIMPIAR
                            </button>
                        </div>
                    </div>
                `;
            });

            html += `</div></div>`;
        }

        body.innerHTML = html;

    } catch (e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ Error: ${e.message}</p>`;
        console.error(e);
    }
};

/**
 * Función para limpiar definitivamente un usuario (purgar rastro)
 */
window.saPurgeUser = async (uid, email) => {
    if (!confirm(`🗑️ LIMPIAR RASTRO: ${email}\n\nEsta acción es IRREVERSIBLE.\n¿Confirmar?`)) {
        return;
    }

    showSpinner('Limpiando rastro…');
    try {
        const { fa, doc, deleteDoc } = await saFS();
        await deleteDoc(doc(fa.db, 'users', uid));

        hideSpinner();
        showToast(`✅ Rastro de ${email} eliminado`, 3000);
        saTrash();  // Recargar vista

    } catch (e) {
        hideSpinner();
        showToast(`⚠️ Error: ${e.message}`, 4000);
        console.error(e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 3: Nueva pestaña "Solicitudes" para gestionar plazas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Añade esta nueva pestaña al SuperAdmin:
 * 
 * <button class="sa-tab" onclick="saTab('requests')">📋 Solicitudes</button>
 */
window.saRequests = async () => {
    const body = document.getElementById('sa-body');
    body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando solicitudes…</p>';

    try {
        const { fa, collection, query, where, getDocs, orderBy } = await saFS();

        // Obtener solicitudes pendientes
        const q = query(
            collection(fa.db, 'slot_requests'),
            where('status', '==', 'pending'),
            orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(q);
        const requests = [];

        snapshot.forEach(d => {
            requests.push({
                id: d.id,
                ...d.data()
            });
        });

        if (requests.length === 0) {
            body.innerHTML = `
                <div style="text-align:center;padding:3rem;color:var(--text-muted);">
                    <p style="font-size:1.2rem;margin-bottom:0.5rem;">✅ Sin solicitudes pendientes</p>
                </div>
            `;
            return;
        }

        const roleLabels = {
            director: '📋 Director Deportivo',
            coordinator: '🎯 Coordinador',
            user: '⚽ Entrenador',
            parent: '👨‍👩‍👧 Padre/Madre',
        };

        let html = `
            <div style="display:grid;gap:0.8rem;">
        `;

        requests.forEach(req => {
            const createdAt = new Date(req.createdAt).toLocaleDateString('es-ES');
            html += `
                <div style="background:var(--glass);border:1px solid rgba(88,166,255,0.3);
                           border-radius:8px;padding:1rem;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.8rem;">
                        <div>
                            <div style="font-weight:700;font-size:1rem;color:var(--primary);">
                                ${req.clubName}
                            </div>
                            <div style="font-size:0.85rem;color:var(--text-muted);margin-top:0.2rem;">
                                ${req.adminEmail}
                            </div>
                        </div>
                        <div style="background:rgba(88,166,255,0.15);padding:0.4rem 0.8rem;
                                   border-radius:6px;font-size:0.75rem;color:var(--primary);font-weight:700;">
                            ${createdAt}
                        </div>
                    </div>

                    <div style="background:rgba(255,255,255,0.03);padding:0.8rem;border-radius:6px;margin-bottom:0.8rem;">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.85rem;">
                            <div>
                                <div style="color:var(--text-muted);font-size:0.75rem;">Rol Solicitado</div>
                                <div style="color:var(--text);font-weight:700;">${roleLabels[req.requestedRole] || req.requestedRole}</div>
                            </div>
                            <div>
                                <div style="color:var(--text-muted);font-size:0.75rem;">Cantidad</div>
                                <div style="color:var(--text);font-weight:700;">${req.quantity} plaza(s)</div>
                            </div>
                        </div>
                        ${req.notes ? `
                            <div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid rgba(255,255,255,0.1);">
                                <div style="color:var(--text-muted);font-size:0.75rem;">Notas</div>
                                <div style="color:var(--text);font-size:0.85rem;">${req.notes}</div>
                            </div>
                        ` : ''}
                    </div>

                    <div style="display:flex;gap:0.5rem;">
                        <button onclick="saApproveRequest('${req.id}', true)"
                                style="flex:1;padding:0.5rem;background:rgba(63,185,80,0.15);
                                       border:1px solid rgba(63,185,80,0.4);border-radius:6px;
                                       color:#3fb950;font-weight:700;cursor:pointer;font-size:0.85rem;">
                            ✅ APROBAR
                        </button>
                        <button onclick="saApproveRequest('${req.id}', false)"
                                style="flex:1;padding:0.5rem;background:rgba(255,88,88,0.15);
                                       border:1px solid rgba(255,88,88,0.4);border-radius:6px;
                                       color:#ff5858;font-weight:700;cursor:pointer;font-size:0.85rem;">
                            ❌ RECHAZAR
                        </button>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        body.innerHTML = html;

    } catch (e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ Error: ${e.message}</p>`;
        console.error(e);
    }
};

/**
 * Función para aprobar/rechazar solicitud de plaza
 */
window.saApproveRequest = async (requestId, approve) => {
    const action = approve ? 'aprobar' : 'rechazar';
    if (!confirm(`¿${action} esta solicitud de plazas?`)) return;

    showSpinner(`${approve ? 'Aprobando' : 'Rechazando'} solicitud…`);
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

                if (slots[roleKey] !== -1) {
                    slots[roleKey] = (slots[roleKey] || 0) + req.quantity;
                }

                await updateDoc(doc(fa.db, 'clubs', req.clubId), { slots });
            }

            await updateDoc(doc(fa.db, 'slot_requests', requestId), {
                status: 'approved',
                approvedAt: new Date().toISOString(),
                approvedBy: superAdminEmail,
            });

            hideSpinner();
            showToast(`✅ Solicitud aprobada. Plazas: ${req.quantity}`, 4000);
        } else {
            await updateDoc(doc(fa.db, 'slot_requests', requestId), {
                status: 'rejected',
                rejectedAt: new Date().toISOString(),
                rejectedBy: superAdminEmail,
            });

            hideSpinner();
            showToast(`❌ Solicitud rechazada`, 3000);
        }

        saRequests();

    } catch (e) {
        hideSpinner();
        showToast(`⚠️ Error: ${e.message}`, 4000);
        console.error(e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 4: Sincronización automática en tiempo real
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Llamar esto cuando se abra el panel de clubes para escuchar cambios
 */
window.setupClubsSyncListener = async () => {
    try {
        const { fa, collection, onSnapshot } = await saFS();

        const unsubscribe = onSnapshot(collection(fa.db, 'users'), (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'removed') {
                    console.log(`🗑️ Usuario eliminado: ${change.doc.id}`);
                    // Recargar vista si está abierta
                    if (typeof saClubs === 'function') {
                        setTimeout(() => saClubs(), 500);
                    }
                }
            });
        });

        window._clubsSyncUnsubscribe = unsubscribe;

    } catch (e) {
        console.error('Error en setupClubsSyncListener:', e);
    }
};

console.log('✅ SuperAdmin Improvements v8.0 cargado');

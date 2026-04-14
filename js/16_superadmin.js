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
        const { fa, collection, query, where, getDocs, orderBy, getDoc, doc } = await saFS();

        // ── 1. Solicitudes de usuario (registro pendiente de aprobación SA) ──
        const userReqQ = query(
            collection(fa.db, 'platform_requests'),
            where('status', '==', 'pending_sa')
        );

        // ── 2. Solicitudes de cuota (ampliación de plazas) ──
        const slotReqQ = query(
            collection(fa.db, 'slot_requests'),
            where('status', '==', 'pending')
        );

        // ── 3. Usuarios auto-registrados pendientes sin club admin que los gestione ──
        const pendingUsersQ = query(
            collection(fa.db, 'users'),
            where('status', '==', 'pending'),
            where('isAuthorized', '==', false)
        );

        const [userReqSnap, slotReqSnap, pendingUsersSnap] = await Promise.all([
            getDocs(userReqQ),
            getDocs(slotReqQ),
            getDocs(pendingUsersQ).catch(() => ({ forEach: () => {} }))
        ]);

        const userRequests = [];
        userReqSnap.forEach(d => userRequests.push({ id: d.id, _type: 'user_request', ...d.data() }));

        const slotRequests = [];
        slotReqSnap.forEach(d => slotRequests.push({ id: d.id, _type: 'slot_request', ...d.data() }));

        const pendingUsers = [];
        pendingUsersSnap.forEach(d => {
            const u = d.data();
            // Solo mostrar si no tiene ya una solicitud en platform_requests
            if (!userRequests.find(r => r.requestedEmail === u.email)) {
                pendingUsers.push({ id: d.id, _type: 'direct_register', ...u });
            }
        });

        const all = [...userRequests, ...slotRequests, ...pendingUsers];

        if (all.length === 0) {
            body.innerHTML = `
                <div style="text-align:center;padding:3rem;color:var(--text-muted);">
                    <p style="font-size:1.2rem;margin-bottom:0.5rem;">✅ Sin solicitudes pendientes</p>
                    <p style="font-size:0.85rem;">Todo está al día.</p>
                </div>`;
            return;
        }

        const roleLabels = {
            director:    '📋 Director Deportivo',
            coordinator: '🎯 Coordinador',
            user:        '⚽ Entrenador',
            parent:      '👨‍👩‍👧 Padre/Madre',
            individual:  '👤 Entrenador Individual',
            club_admin:  '🏟️ Admin de Club',
        };

        let html = `<div style="display:grid;gap:0.8rem;">`;

        // ── SOLICITUDES DE USUARIO (desde club admin) ──
        userRequests.forEach(req => {
            const createdAt = req.createdAt ? new Date(req.createdAt).toLocaleDateString('es-ES') : '—';
            html += `
            <div style="background:var(--glass);border:1px solid rgba(88,166,255,0.3);
                        border-radius:10px;padding:1rem;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.6rem;flex-wrap:wrap;gap:0.4rem;">
                    <div>
                        <span style="font-size:0.65rem;background:rgba(88,166,255,0.15);color:var(--primary);
                                     border-radius:4px;padding:2px 7px;font-weight:700;">👤 SOLICITUD USUARIO</span>
                        <div style="font-weight:700;font-size:0.95rem;color:var(--primary);margin-top:0.3rem;">
                            ${req.clubName || '—'}
                        </div>
                    </div>
                    <span style="font-size:0.72rem;color:var(--text-muted);">${createdAt}</span>
                </div>
                <div style="font-size:0.83rem;margin-bottom:0.5rem;">
                    <b>${req.requestedEmail || '—'}</b>
                    ${req.requestedName ? `<span style="color:var(--text-muted);"> · ${req.requestedName}</span>` : ''}
                </div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.8rem;">
                    Rol solicitado: <b style="color:white;">${roleLabels[req.requestedRole] || req.requestedRole || '—'}</b>
                    ${req.requestedByEmail ? `<br>Enviado por admin: <b>${req.requestedByEmail}</b>` : ''}
                </div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                    <button onclick="saApproveRequest('${req.id}', true, 'user_request')"
                        style="flex:1;padding:0.4rem;background:rgba(63,185,80,0.15);
                               border:1px solid rgba(63,185,80,0.4);border-radius:7px;
                               color:#3fb950;font-weight:700;cursor:pointer;font-size:0.8rem;">
                        ✅ Aprobar
                    </button>
                    <button onclick="saApproveRequest('${req.id}', false, 'user_request')"
                        style="flex:1;padding:0.4rem;background:rgba(255,88,88,0.12);
                               border:1px solid rgba(255,88,88,0.3);border-radius:7px;
                               color:#ff5858;font-weight:700;cursor:pointer;font-size:0.8rem;">
                        ❌ Rechazar
                    </button>
                </div>
            </div>`;
        });

        // ── USUARIOS AUTO-REGISTRADOS DIRECTAMENTE ──
        pendingUsers.forEach(u => {
            const createdAt = u.createdAt ? new Date(u.createdAt).toLocaleDateString('es-ES') : '—';
            html += `
            <div style="background:var(--glass);border:1px solid rgba(240,136,62,0.3);
                        border-radius:10px;padding:1rem;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.6rem;flex-wrap:wrap;gap:0.4rem;">
                    <div>
                        <span style="font-size:0.65rem;background:rgba(240,136,62,0.15);color:#f0883e;
                                     border-radius:4px;padding:2px 7px;font-weight:700;">📝 AUTO-REGISTRO</span>
                        <div style="font-weight:700;font-size:0.95rem;color:#f0883e;margin-top:0.3rem;">
                            ${u.email || u.id}
                        </div>
                    </div>
                    <span style="font-size:0.72rem;color:var(--text-muted);">${createdAt}</span>
                </div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.8rem;">
                    Rol: <b style="color:white;">${roleLabels[u.role] || u.role || '—'}</b>
                    · Club: <b style="color:white;">${u.clubId || 'Sin club'}</b>
                </div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                    <button onclick="saApproveRequest('${u.id}', true, 'direct_user')"
                        style="flex:1;padding:0.4rem;background:rgba(63,185,80,0.15);
                               border:1px solid rgba(63,185,80,0.4);border-radius:7px;
                               color:#3fb950;font-weight:700;cursor:pointer;font-size:0.8rem;">
                        ✅ Aprobar acceso
                    </button>
                    <button onclick="saApproveRequest('${u.id}', false, 'direct_user')"
                        style="flex:1;padding:0.4rem;background:rgba(255,88,88,0.12);
                               border:1px solid rgba(255,88,88,0.3);border-radius:7px;
                               color:#ff5858;font-weight:700;cursor:pointer;font-size:0.8rem;">
                        ❌ Rechazar
                    </button>
                </div>
            </div>`;
        });

        // ── SOLICITUDES DE CUOTA ──
        slotRequests.forEach(req => {
            const createdAt = req.createdAt ? new Date(req.createdAt).toLocaleDateString('es-ES') : '—';
            html += `
            <div style="background:var(--glass);border:1px solid rgba(255,215,0,0.25);
                        border-radius:10px;padding:1rem;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.6rem;flex-wrap:wrap;gap:0.4rem;">
                    <div>
                        <span style="font-size:0.65rem;background:rgba(255,215,0,0.12);color:#ffd700;
                                     border-radius:4px;padding:2px 7px;font-weight:700;">📊 AMPLIACIÓN CUOTA</span>
                        <div style="font-weight:700;font-size:0.95rem;color:#ffd700;margin-top:0.3rem;">
                            ${req.clubName || '—'}
                        </div>
                    </div>
                    <span style="font-size:0.72rem;color:var(--text-muted);">${createdAt}</span>
                </div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.8rem;">
                    Rol: <b style="color:white;">${roleLabels[req.requestedRole] || req.requestedRole || '—'}</b>
                    · Cantidad: <b style="color:white;">+${req.quantity || 1}</b>
                    ${req.reason ? `<br><i>${req.reason}</i>` : ''}
                </div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                    <button onclick="saApproveRequest('${req.id}', true, 'slot_request')"
                        style="flex:1;padding:0.4rem;background:rgba(63,185,80,0.15);
                               border:1px solid rgba(63,185,80,0.4);border-radius:7px;
                               color:#3fb950;font-weight:700;cursor:pointer;font-size:0.8rem;">
                        ✅ Aprobar cuota
                    </button>
                    <button onclick="saApproveRequest('${req.id}', false, 'slot_request')"
                        style="flex:1;padding:0.4rem;background:rgba(255,88,88,0.12);
                               border:1px solid rgba(255,88,88,0.3);border-radius:7px;
                               color:#ff5858;font-weight:700;cursor:pointer;font-size:0.8rem;">
                        ❌ Rechazar
                    </button>
                </div>
            </div>`;
        });

        html += `</div>`;
        body.innerHTML = html;

    } catch(e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ Error: ${e.message}</p>`;
        console.error('[saRequests]', e);
    }
};

window.saApproveRequest = async (requestId, approve, reqType) => {
    const action = approve ? 'aprobar' : 'rechazar';
    if (!confirm(`¿${action} esta solicitud?`)) return;

    if (typeof showSpinner === 'function') showSpinner(`${approve ? 'Aprobando' : 'Rechazando'}…`);
    try {
        const { fa, doc, updateDoc, getDoc, collection, query, where, getDocs } = await saFS();
        const saEmail = window._cronosCurrentUser?.email || 'superadmin';

        // ── SOLICITUD DE USUARIO (desde club admin vía platform_requests) ──
        if (reqType === 'user_request') {
            const reqSnap = await getDoc(doc(fa.db, 'platform_requests', requestId));
            if (!reqSnap.exists()) throw new Error('Solicitud no encontrada en platform_requests');
            const req = reqSnap.data();

            if (approve) {
                // Marcar la solicitud como aprobada
                await updateDoc(doc(fa.db, 'platform_requests', requestId), {
                    status: 'approved_sa',
                    approvedAt: new Date().toISOString(),
                    approvedBy: saEmail,
                });

                // Notificar al club_admin que puede confirmar la alta del usuario
                // (escribir notificación para el admin del club)
                if (req.requestedBy) {
                    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
                        .then(async m => {
                            await m.setDoc(m.doc(fa.db, 'cronos_notifications', 'sa_ok_' + requestId), {
                                type: 'sa_user_approved',
                                clubId: req.clubId,
                                requestedEmail: req.requestedEmail,
                                requestedRole: req.requestedRole,
                                platformRequestId: requestId,
                                saEmail,
                                message: `✅ SA aprobó a ${req.requestedEmail} como ${req.requestedRole} en ${req.clubName}`,
                                createdAt: new Date().toISOString(),
                                read: false,
                            });
                        });
                }

                if (typeof hideSpinner === 'function') hideSpinner();
                showToast(`✅ Solicitud de ${req.requestedEmail} aprobada. El admin del club puede darle de alta.`, 5000);
            } else {
                await updateDoc(doc(fa.db, 'platform_requests', requestId), {
                    status: 'rejected_sa',
                    rejectedAt: new Date().toISOString(),
                    rejectedBy: saEmail,
                });
                if (typeof hideSpinner === 'function') hideSpinner();
                showToast(`❌ Solicitud rechazada.`, 3000);
            }

        // ── USUARIO AUTO-REGISTRADO DIRECTAMENTE ──
        } else if (reqType === 'direct_user') {
            const userSnap = await getDoc(doc(fa.db, 'users', requestId));
            if (!userSnap.exists()) throw new Error('Usuario no encontrado');
            const u = userSnap.data();

            if (approve) {
                await updateDoc(doc(fa.db, 'users', requestId), {
                    isAuthorized: true,
                    status: 'active',
                    approvedAt: new Date().toISOString(),
                    approvedBy: saEmail,
                });
                // Update club slot count
                if (u.clubId) {
                    const clubSnap = await getDoc(doc(fa.db, 'clubs', u.clubId));
                    if (clubSnap.exists()) {
                        const role = u.role;
                        const key = role==='director'?'usedSlots.directors':role==='coordinator'?'usedSlots.coordinators':role==='parent'?'usedSlots.parents':'usedSlots.users';
                        const currentUsed = clubSnap.data()[key.replace('usedSlots.','')] || 0;
                        await updateDoc(doc(fa.db, 'clubs', u.clubId), { [key]: currentUsed + 1 });
                    }
                }
                if (typeof hideSpinner === 'function') hideSpinner();
                showToast(`✅ ${u.email} autorizado. Puede entrar en la app.`, 4000);
            } else {
                await updateDoc(doc(fa.db, 'users', requestId), {
                    isAuthorized: false,
                    status: 'rejected',
                    rejectedAt: new Date().toISOString(),
                    rejectedBy: saEmail,
                });
                if (typeof hideSpinner === 'function') hideSpinner();
                showToast(`❌ Solicitud rechazada.`, 3000);
            }

        // ── SOLICITUD DE CUOTA (slot_requests) ──
        } else {
            const reqSnap = await getDoc(doc(fa.db, 'slot_requests', requestId));
            if (!reqSnap.exists()) throw new Error('Solicitud no encontrada en slot_requests');
            const req = reqSnap.data();

            if (approve) {
                const clubSnap = await getDoc(doc(fa.db, 'clubs', req.clubId));
                if (clubSnap.exists()) {
                    const slots = clubSnap.data().slots || {};
                    const roleKey = req.requestedRole === 'director' ? 'directors'
                                  : req.requestedRole === 'coordinator' ? 'coordinators'
                                  : req.requestedRole === 'parent' ? 'parents' : 'users';
                    if (slots[roleKey] !== -1) slots[roleKey] = (slots[roleKey] || 0) + (req.quantity || 1);
                    await updateDoc(doc(fa.db, 'clubs', req.clubId), { slots });
                }
                await updateDoc(doc(fa.db, 'slot_requests', requestId), {
                    status: 'approved', approvedAt: new Date().toISOString(), approvedBy: saEmail,
                });
                if (typeof hideSpinner === 'function') hideSpinner();
                showToast(`✅ Cuota ampliada en ${req.quantity || 1} plazas.`, 4000);
            } else {
                await updateDoc(doc(fa.db, 'slot_requests', requestId), {
                    status: 'rejected', rejectedAt: new Date().toISOString(), rejectedBy: saEmail,
                });
                if (typeof hideSpinner === 'function') hideSpinner();
                showToast(`❌ Solicitud de cuota rechazada.`, 3000);
            }
        }

        saRequests();

    } catch(e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        showToast(`⚠️ Error: ${e.message}`, 4000);
        console.error('[saApproveRequest]', e);
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

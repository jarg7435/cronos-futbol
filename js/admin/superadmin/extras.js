/**
 * js/25_sa_extras.js
 * Mejoras al panel SuperAdmin — sin tocar app.js
 *
 * Funciones:
 * 1. Botones "Rol" y "Salir" en el header del SA panel
 * 2. Un único botón "🧹 Limpieza Total" en pestaña Clubes
 *    → Borra roles, platform_requests y status pendiente de clubes eliminados
 * 3. saRequests muestra platform_requests pending_sa + deletion_requests
 * 4. Fix saAddIndividual cuando lista vacía
 */
(function () {
    'use strict';

    // ════════════════════════════════════════════════════════════════
    // 1. BOTONES ROL Y SALIR
    // ════════════════════════════════════════════════════════════════

    window.saCambiarRol = function () {
        var modal = document.getElementById('sa-root-modal');
        if (modal) modal.style.display = 'none';
        var me = window._cronosCurrentUser;
        if (!me) { location.reload(); return; }
        var allRoles = me._allAuthorizedRoles || me.allRoles || [];
        if (allRoles.length > 1 && typeof _showMultiRolePicker === 'function') {
            _showMultiRolePicker({ uid: me.uid, email: me.email }, allRoles);
        } else if (typeof showScreen === 'function') {
            window._cronosCurrentUser = null;
            showScreen('auth-screen');
        } else { location.reload(); }
    };

    window.saSalir = function () {
        var modal = document.getElementById('sa-root-modal');
        if (modal) modal.style.display = 'none';
        if (typeof cerrarSesion === 'function') cerrarSesion();
        else location.reload();
    };

    function injectSAButtons() {
        var modal = document.getElementById('sa-root-modal');
        if (!modal || modal.querySelector('#sa-btn-rol')) return;
        var cont = modal.querySelector('.sa-topbar > div:last-child');
        if (!cont) return;

        var btnRol = document.createElement('button');
        btnRol.id = 'sa-btn-rol';
        btnRol.textContent = 'Rol';
        btnRol.onclick = window.saCambiarRol;
        btnRol.style.cssText = 'padding:0.3rem 0.7rem;background:rgba(240,136,62,0.1);border:1px solid rgba(240,136,62,0.3);border-radius:6px;color:#f0883e;font-size:0.78rem;cursor:pointer;font-weight:600;';

        var btnSalir = document.createElement('button');
        btnSalir.id = 'sa-btn-salir';
        btnSalir.textContent = 'Salir';
        btnSalir.onclick = window.saSalir;
        btnSalir.style.cssText = 'padding:0.3rem 0.7rem;background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);border-radius:6px;color:#ff5858;font-size:0.78rem;cursor:pointer;font-weight:600;';

        cont.insertBefore(btnSalir, cont.firstChild);
        cont.insertBefore(btnRol, cont.firstChild);
    }

    // ════════════════════════════════════════════════════════════════
    // 2. LIMPIEZA TOTAL — un solo botón en pestaña Clubes
    // ════════════════════════════════════════════════════════════════

    window.saExtLimpiezaTotal = async function () {
        if (!confirm(
            '🧹 LIMPIEZA TOTAL DE CLUBES ELIMINADOS\n\n' +
            'Esto eliminará de TODOS los usuarios:\n' +
            '• Roles que apunten a clubes ya eliminados\n' +
            '• Platform_requests de clubes eliminados\n' +
            '• Status "pending" sin solicitud activa\n\n' +
            'Los usuarios afectados podrán re-registrarse.\n\n' +
            '¿Confirmar?'
        )) return;

        if (typeof showToast === 'function') showToast('⏳ Limpiando...', 4000);

        try {
            var { db, collection, getDocs, query, where, doc, updateDoc, deleteDoc } = await saFS();

            // 1. Clubes válidos existentes
            var clubsSnap = await getDocs(collection(db, 'clubs'));
            var validClubIds = new Set();
            clubsSnap.forEach(function (d) { validClubIds.add(d.id); });

            // 2. Todas las platform_requests
            var prSnap = await getDocs(collection(db, 'platform_requests'));
            var validPrUserUids = new Set(); // uids con solicitud activa pending
            var prToDelete = [];
            prSnap.forEach(function (d) {
                var pr = d.data();
                // Borrar si su clubId ya no existe (y tiene clubId)
                if (pr.clubId && !validClubIds.has(pr.clubId)) {
                    prToDelete.push(d.id);
                } else if (pr.clubId && validClubIds.has(pr.clubId)) {
                    // Solicitud válida — recordar el userUid
                    if (pr.userUid && (pr.status === 'pending_sa' || pr.status === 'pending_club_admin')) {
                        validPrUserUids.add(pr.userUid);
                    }
                } else if (!pr.clubId) {
                    // Sin clubId (club_admin individual) — si no es pending_sa borrar si es antiguo
                    if (pr.userUid && (pr.status === 'pending_sa' || pr.status === 'pending_club_admin')) {
                        validPrUserUids.add(pr.userUid);
                    }
                }
            });

            // Borrar platform_requests obsoletas
            var prOps = prToDelete.map(function (id) {
                return deleteDoc(doc(db, 'platform_requests', id)).catch(function () {});
            });
            await Promise.all(prOps);

            // 3. Limpiar user docs
            var usersSnap = await getDocs(collection(db, 'users'));
            var userOps = [];
            var fixedUsers = 0;

            usersSnap.forEach(function (uDoc) {
                var u = uDoc.data();
                if (!u.allRoles || u.allRoles.length === 0) {
                    // Sin allRoles — resetear si status pendiente y sin solicitud
                    if ((u.status === 'pending_sa' || u.status === 'pending_club_admin' || u.status === 'pending') &&
                        !validPrUserUids.has(uDoc.id)) {
                        fixedUsers++;
                        userOps.push(updateDoc(doc(db, 'users', uDoc.id), {
                            status: 'free', isAuthorized: false, clubId: null, clubName: null
                        }));
                    }
                    return;
                }

                var seen = new Set();
                var cleaned = u.allRoles.filter(function (r) {
                    // Mantener superadmin siempre
                    if (r.role === 'superadmin') return true;
                    // Quitar si clubId apunta a club eliminado
                    if (r.clubId && !validClubIds.has(r.clubId)) return false;
                    // Quitar duplicados
                    var k = (r.role || '') + '|' + (r.clubId || '');
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                });

                var changed = cleaned.length !== u.allRoles.length;

                // Si el status es pendiente y no tiene solicitud activa, resetear
                var isPending = u.status === 'pending_sa' || u.status === 'pending_club_admin' || u.status === 'pending';
                var hasPendingReq = validPrUserUids.has(uDoc.id);
                var hasActiveRole = cleaned.some(function (r) { return r.isAuthorized; });

                if (isPending && !hasPendingReq && !hasActiveRole) {
                    changed = true;
                    var updateData = {
                        allRoles: cleaned,
                        status: 'free',
                        isAuthorized: false,
                    };
                    // Limpiar clubId si apuntaba a club eliminado
                    if (u.clubId && !validClubIds.has(u.clubId)) {
                        updateData.clubId = null;
                        updateData.clubName = null;
                    }
                    fixedUsers++;
                    userOps.push(updateDoc(doc(db, 'users', uDoc.id), updateData));
                } else if (changed) {
                    var updateData2 = { allRoles: cleaned };
                    if (u.clubId && !validClubIds.has(u.clubId)) {
                        updateData2.clubId = null;
                        updateData2.clubName = null;
                        var newActive = cleaned.find(function (r) { return r.isAuthorized && r.clubId; });
                        if (newActive) { updateData2.clubId = newActive.clubId; updateData2.clubName = newActive.clubName; }
                    }
                    fixedUsers++;
                    userOps.push(updateDoc(doc(db, 'users', uDoc.id), updateData2));
                }
            });

            await Promise.all(userOps);

            var msg = '✅ Limpieza completada.\n' +
                '• ' + prToDelete.length + ' solicitudes obsoletas eliminadas\n' +
                '• ' + fixedUsers + ' usuarios limpiados';
            if (typeof showToast === 'function') showToast(msg, 6000);
            setTimeout(function () { if (typeof saTab === 'function') saTab('clubs'); }, 1500);

        } catch (e) {
            if (typeof showToast === 'function') showToast('❌ Error: ' + e.message, 5000);
            console.error('[saExtLimpiezaTotal]', e);
        }
    };

    // Inyectar botón en pestaña Clubes (solo uno, arriba del todo)
    function injectCleanupBtn() {
        var body = document.getElementById('sa-body');
        if (!body || body.querySelector('#sa-cleanup-total')) return;
        // Solo si estamos en la pestaña Clubes (hay sa-card o mensaje de sin clubes)
        if (!body.innerHTML.includes('sa-card') && !body.innerHTML.includes('Sin clubes')) return;

        var div = document.createElement('div');
        div.style.cssText = 'margin-bottom:0.7rem;';
        div.innerHTML = '<button id="sa-cleanup-total" onclick="saExtLimpiezaTotal()" ' +
            'style="width:100%;padding:0.55rem;background:rgba(240,136,62,0.08);' +
            'border:1px solid rgba(240,136,62,0.3);border-radius:8px;' +
            'color:#f0883e;font-size:0.82rem;cursor:pointer;font-weight:600;text-align:left;">' +
            '🧹 Limpieza total — eliminar remanentes de clubes eliminados' +
            '</button>';
        body.insertBefore(div, body.firstChild);
    }

    // ════════════════════════════════════════════════════════════════
    // 3. SOLICITUDES — mostrar platform_requests pending_sa
    // ════════════════════════════════════════════════════════════════

    function patchSaRequests() {
        var orig = window.saRequests;
        if (!orig || orig._p25req) return;

        window.saRequests = async function () {
            var body = document.getElementById('sa-body');
            if (body) body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando...</p>';
            try {
                var { db, collection, getDocs, query, where, doc, updateDoc, setDoc, getDoc } = await saFS();

                var snapP_all = [], snapU_all = [], snapD_all = [];
                try {
                    // Fetch directo
                    const pDocs = await getDocs(collection(db, 'platform_requests'));
                    pDocs.forEach(d => snapP_all.push(Object.assign({_id: d.id}, d.data())));
                    
                    const uDocs = await getDocs(collection(db, 'users'));
                    uDocs.forEach(d => snapU_all.push(Object.assign({_id: d.id}, d.data())));

                    const dDocs = await getDocs(collection(db, 'deletion_requests'));
                    dDocs.forEach(d => snapD_all.push(Object.assign({_id: d.id}, d.data())));
                    
                } catch (e) { 
                    console.error('[SA-DEBUG] Error crítico de lectura:', e);
                    if (body) body.innerHTML = `<div style="padding:1rem;background:rgba(255,88,88,0.1);border:1px solid #ff5858;border-radius:8px;color:#ff5858;">
                        <strong>⚠️ Error de Permisos Firestore:</strong><br>${e.message}
                    </div>`;
                    return;
                }

                var regReqs = [];
                var delReqs = [];
                var pendingStatuses = ['pending_sa', 'pending', 'pending_individual'];
                
                // 1. Procesar registro
                snapP_all.forEach(function(data) {
                    if (pendingStatuses.includes(data.status)) {
                        regReqs.push(data);
                    }
                });

                // 2. Procesar bajas
                snapD_all.forEach(function(data) {
                    if (data.status === 'pending') {
                        delReqs.push(data);
                    }
                });

                // 2. Procesar usuarios (huérfanos)
                var existingUids = new Set(regReqs.map(function(r){ return r.userUid; }).filter(Boolean));
                snapU_all.forEach(function(ud) {
                    if (pendingStatuses.includes(ud.status) && !existingUids.has(ud._id)) {
                        regReqs.push({
                            _id:               'orphan_' + ud._id,
                            userUid:           ud._id,
                            requestedEmail:    ud.email || ud._id,
                            requestedName:     ud.displayName || ud.firstName || 'Usuario',
                            requestedRole:     ud.role || ud.requestedRole || 'user',
                            requestedClubName: ud.requestedClubName || ud.clubName || '–',
                            clubId:            ud.clubId || null,
                            status:            ud.status,
                            isOrphan:          true
                        });
                    }
                });

                var resetBtn = '<div style="margin-top:1rem;padding-top:0.8rem;border-top:1px solid rgba(255,255,255,0.07);"><button onclick="saExtResetUser()" style="width:100%;padding:0.6rem;background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.25);border-radius:8px;color:#58a6ff;font-size:0.8rem;cursor:pointer;font-weight:600;text-align:left;">🔄 Resetear / limpiar usuario por email (solicitudes atascadas)</button></div>';
                if (!regReqs.length && !delReqs.length) {
                    if (body) body.innerHTML = '<div style="background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.3);border-radius:8px;padding:0.8rem 1rem;">✅ No hay solicitudes pendientes</div>' + resetBtn;
                    return;
                }

                var RLABELS = { club_admin: 'Administrador de Club', director: 'Director Deportivo', coordinator: 'Coordinador', user: 'Entrenador', parent: 'Padre/Madre/Tutor', individual: 'Usuario Individual' };
                var RICONS  = { club_admin: '🏛️', director: '📋', coordinator: '🎯', user: '⚽', parent: '👨‍👩‍👧', individual: '👤' };
                var CATS    = { prebenjamin: 'Prebenjamín', benjamin: 'Benjamín', alevin: 'Alevín', infantil: 'Infantil', cadete: 'Cadete', juvenil: 'Juvenil', femenino: 'Femenino', regional: 'Regional' };

                var html = '';
                if (regReqs.length) {
                    html += '<div style="font-size:0.82rem;font-weight:700;color:#ffd700;margin-bottom:0.7rem;">📩 Solicitudes de Registro (' + regReqs.length + ')</div>';
                    regReqs.forEach(function (r) {
                        var rl = RLABELS[r.requestedRole] || r.requestedRole || '?';
                        var ri = RICONS[r.requestedRole] || '👤';
                        var cat = r.requestedCategory ? ' · <strong style="color:#3fb950;">' + (CATS[r.requestedCategory] || r.requestedCategory) + (r.requestedSubcat ? ' ' + r.requestedSubcat : '') + '</strong>' : '';
                        
                        var eid = (r._id || '').replace(/'/g, "\\'");
                        var erole = (r.requestedRole || 'user').replace(/'/g, "\\'");
                        var eemail = (r.requestedEmail || '').replace(/'/g, "\\'");
                        var eclubid = (r.clubId || '').replace(/'/g, "\\'");
                        var eclubname = (r.requestedClubName || r.clubName || 'Solicitud Directa').replace(/'/g, "\\'");

                        html += '<div style="background:rgba(255,215,0,0.05);border:1px solid rgba(255,215,0,0.25);border-radius:10px;padding:0.9rem;margin-bottom:0.7rem;border-left:4px solid #ffd700;">' +
                            '<div style="font-weight:700;display:flex;align-items:center;gap:0.4rem;color:white;">' + ri + ' ' + rl + cat + '</div>' +
                            '<div style="font-size:0.8rem;color:var(--text-muted);margin:4px 0 10px;">' +
                            '📧 ' + (r.requestedEmail || '—') + (r.requestedName ? ' · ' + r.requestedName : '') +
                            '<br>🏟️ ' + (r.requestedClubName || r.clubName || '<span style="color:#f0883e;">Revisar vinculación</span>') +
                            (r.forwardedBy ? '<br>📤 Reenviado por: ' + r.forwardedBy : '') + '</div>' +
                            '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">' +
                            '<button class="sa-btn" onclick="saExtApprove(\'' + eid + '\',\'' + erole + '\',\'' + eemail + '\',\'' + eclubid + '\',\'' + eclubname + '\',true)" style="color:#3fb950;border-color:rgba(63,185,80,0.4);background:rgba(63,185,80,0.08);font-weight:700;">✅ Aprobar</button>' +
                            '<button class="sa-btn" onclick="saExtApprove(\'' + eid + '\',\'' + erole + '\',\'' + eemail + '\',\'' + eclubid + '\',\'' + eclubname + '\',false)" style="color:#ff5858;border-color:rgba(255,88,88,0.4);background:rgba(255,88,88,0.08);">✕ Rechazar</button>' +
                            '<button onclick="saExtDiscardRequest(\'' + eid + '\')" class="sa-btn" title="Solo borrar solicitud, no al usuario" style="color:#8b949e;border-color:rgba(255,255,255,0.15);background:rgba(255,255,255,0.03);">Descartar</button>' +
                            '</div></div>';
                    });
                }
                if (delReqs.length) {
                    html += '<div style="font-size:0.82rem;font-weight:700;color:#f0883e;margin:1rem 0 0.5rem;">🗑️ Solicitudes de Baja (' + delReqs.length + ')</div>';
                    delReqs.forEach(function (r) {
                        html += '<div style="background:rgba(240,136,62,0.05);border:1px solid rgba(240,136,62,0.25);border-radius:8px;padding:0.8rem;margin-bottom:0.6rem;">' +
                            '<div style="font-size:0.82rem;color:var(--text-muted);">👤 ' + (r.userEmail || r.userId) + ' · ' + (r.reason || '—') + '</div>' +
                            '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
                            '<button class="sa-btn" onclick="saExtBaja(\'' + r._id + '\',\'' + r.userId + '\',true)" style="color:#3fb950;border-color:rgba(63,185,80,0.4);background:rgba(63,185,80,0.08);font-weight:700;">✅ Aprobar</button>' +
                            '<button class="sa-btn" onclick="saExtBaja(\'' + r._id + '\',\'' + r.userId + '\',false)" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.06);">✕ Rechazar</button>' +
                            '</div></div>';
                    });
                }
                if (body) body.innerHTML = html + resetBtn;

                // Aprobar/Rechazar registro
                window.saExtApprove = async function (reqId, role, email, clubId, clubName, approve) {
                    if (!confirm(approve ? ('✅ Aprobar a "' + email + '" como ' + (RLABELS[role] || role) + '?') : ('✕ Rechazar solicitud de "' + email + '"?'))) return;

                    // Anti-duplicación: deshabilitar todos los botones de esta solicitud inmediatamente
                    document.querySelectorAll('button[onclick*="' + reqId + '"]').forEach(function(b) {
                        b.disabled = true;
                        b.style.opacity = '0.4';
                        b.style.cursor = 'not-allowed';
                    });

                    if (typeof showToast === 'function') showToast('⏳ Procesando...', 2000);
                    try {
                        // Detectar solicitud huérfana (sin platform_request real)
                        var isOrphan = reqId.startsWith('orphan_');
                        var orphanUid = isOrphan ? reqId.replace('orphan_', '') : null;
                        var r;
                        if (isOrphan) {
                            r = { userUid: orphanUid, requestedRole: role, clubId: clubId || null, requestedClubName: clubName || null };
                        } else {
                            var prSnap2 = await getDoc(doc(db, 'platform_requests', reqId));
                            if (!prSnap2.exists()) { if (typeof showToast === 'function') showToast('⚠️ Solicitud no encontrada', 3000); return; }
                            r = prSnap2.data();
                        }
                        var me = (window._cronosCurrentUser || {}).email || 'superadmin';
                        if (!approve) {
                            await updateDoc(doc(db, 'platform_requests', reqId), { status: 'rejected', rejectedAt: new Date().toISOString() });
                            if (r.userUid) await updateDoc(doc(db, 'users', r.userUid), { status: 'rejected' }).catch(function () {});
                            if (typeof showToast === 'function') showToast('✕ Rechazada', 3000);
                            window.saRequests(); return;
                        }
                        if (role === 'club_admin' && (r.requestedClubName || clubName)) {
                            var targetClubName = r.requestedClubName || clubName;

                            // ── ANTI-DUPLICACIÓN: comprobar si ya existe un club con ese nombre ──
                            var existingSnap = await getDocs(query(collection(db, 'clubs'), where('name', '==', targetClubName)));
                            var newClubId;
                            if (!existingSnap.empty) {
                                // Ya existe — reutilizar el ID existente
                                newClubId = existingSnap.docs[0].id;
                                if (typeof showToast === 'function') showToast('ℹ️ Club ya existente — reutilizando', 2000);
                            } else {
                                // Crear nuevo club
                                newClubId = 'club_' + Date.now().toString(36);
                                var q = r.requestedQuotas || {};
                                await setDoc(doc(db, 'clubs', newClubId), {
                                    name: targetClubName, adminEmail: email, adminUid: r.userUid || null,
                                    plan: 'free', status: 'active',
                                    slots: { directors: q.directors || 1, coordinators: q.coordinators || 2, users: q.coaches || 10, parents: q.parents || 50 },
                                    usedSlots: { directors: 0, coordinators: 0, users: 0, parents: 0 },
                                    createdAt: new Date().toISOString(), approvedBy: me,
                                });
                            }
                            if (r.userUid) {
                                var uSn = await getDoc(doc(db, 'users', r.userUid)).catch(function () { return null; });
                                if (uSn && uSn.exists()) {
                                    var ud = uSn.data();
                                    var updR = (ud.allRoles || []).map(function (ar) {
                                        return ar.role === 'club_admin' ? Object.assign({}, ar, { isAuthorized: true, status: 'active', clubId: newClubId, clubName: r.requestedClubName || clubName }) : ar;
                                    });
                                    if (!updR.some(function (ar) { return ar.role === 'club_admin'; })) updR.push({ role: 'club_admin', isAuthorized: true, status: 'active', clubId: newClubId, clubName: r.requestedClubName || clubName });
                                    await updateDoc(doc(db, 'users', r.userUid), { isAuthorized: true, status: 'active', clubId: newClubId, clubName: r.requestedClubName || clubName, allRoles: updR, authorizedAt: new Date().toISOString(), authorizedBy: me });
                                }
                            }
                            if (typeof showToast === 'function') showToast('✅ Club "' + (r.requestedClubName || clubName) + '" creado y ' + email + ' activado', 6000);
                        // ── individual sub-user registration: activate directly ──
                        } else if (r.type === 'ind_sub_registration' && r.userUid) {
                            var uSnapInd = await getDoc(doc(db,'users',r.userUid)).catch(()=>null);
                            if (uSnapInd && uSnapInd.exists()) {
                                var uDataInd = uSnapInd.data();
                                var updRolesInd = (uDataInd.allRoles||[]).map(function(rl) {
                                    if (rl.role === r.requestedRole) {
                                        return Object.assign({}, rl, { isAuthorized: true, status: 'active' });
                                    }
                                    return rl;
                                });
                                var indUpdateData = {
                                    isAuthorized: true,
                                    status: 'active',
                                    allRoles: updRolesInd,
                                    role: r.requestedRole || uDataInd.role,
                                    authorizedAt: new Date().toISOString(),
                                    authorizedBy: me,
                                    // CRITICAL: preserve both individualEntityId and individualOwnerId
                                    individualEntityId: r.individualOwnerId || uDataInd.individualEntityId || null,
                                    individualOwnerId: r.individualOwnerId || uDataInd.individualOwnerId || null,
                                };
                                // Preserve category data from the request
                                if (r.requestedCategory || r.category) {
                                    indUpdateData.category = r.requestedCategory || r.category;
                                    indUpdateData.categoryLabel = r.requestedCategoryLabel || r.categoryLabel || null;
                                }
                                if (r.requestedSubcat) {
                                    indUpdateData.subcategory = r.requestedSubcat;
                                }
                                await updateDoc(doc(db,'users',r.userUid), indUpdateData);
                            }
                            await updateDoc(doc(db,'platform_requests',reqId), { status: approve ? 'sa_approved' : 'rejected', approvedAt: new Date().toISOString(), approvedBy: me }).catch(function(){});
                            if (typeof showToast === 'function') showToast(approve ? '✅ Sub-usuario individual activado' : '❌ Rechazada', 3000);
                            window.saRequests();
                            return;
                        // ── individual admin approval (orphan or direct): set hasAdmin on entity ──
                        } else if (role === 'individual' && r.userUid) {
                            var uSnapIndAdmin = await getDoc(doc(db,'users',r.userUid)).catch(()=>null);
                            if (uSnapIndAdmin && uSnapIndAdmin.exists()) {
                                var uDataIndAdmin = uSnapIndAdmin.data();
                                var updRolesIndAdmin = (uDataIndAdmin.allRoles||[]).map(function(rl) {
                                    if (rl.role === 'individual') {
                                        return Object.assign({}, rl, { isAuthorized: true, status: 'active' });
                                    }
                                    return rl;
                                });
                                var indAdminUpdateData = {
                                    isAuthorized: true,
                                    status: 'active',
                                    allRoles: updRolesIndAdmin,
                                    role: 'individual',
                                    authorizedAt: new Date().toISOString(),
                                    authorizedBy: me,
                                    individualEntityId: uDataIndAdmin.individualEntityId || uDataIndAdmin.individualOwnerId || null,
                                    individualOwnerId: uDataIndAdmin.individualOwnerId || uDataIndAdmin.individualEntityId || null,
                                };
                                await updateDoc(doc(db,'users',r.userUid), indAdminUpdateData);
                                // CRITICAL: set hasAdmin=true on the individual entity
                                var _indEntityId = uDataIndAdmin.individualEntityId || uDataIndAdmin.individualOwnerId || null;
                                if (_indEntityId) {
                                    try {
                                        await updateDoc(doc(db,'individuals',_indEntityId), {
                                            hasAdmin: true,
                                            adminEmail: uDataIndAdmin.email || email,
                                            adminUid: r.userUid,
                                        });
                                    } catch(_indErr) {
                                        console.warn('[saExtApprove] Error setting hasAdmin:', _indErr.message);
                                    }
                                }
                            }
                            if (!isOrphan) {
                                await updateDoc(doc(db,'platform_requests',reqId), { status: approve ? 'sa_approved' : 'rejected', approvedAt: new Date().toISOString(), approvedBy: me }).catch(function(){});
                            }
                            if (typeof showToast === 'function') showToast(approve ? '✅ Administrador Individual activado' : '❌ Rechazada', 3000);
                            window.saRequests();
                            return;
                        } else if (r.userUid) {
                            var uSn2 = await getDoc(doc(db, 'users', r.userUid)).catch(function () { return null; });
                            if (uSn2 && uSn2.exists()) {
                                var ud2 = uSn2.data();
                                var updR2 = (ud2.allRoles || []).map(function (ar) {
                                    return (ar.role === role && (ar.clubId || null) === (clubId || null)) ? Object.assign({}, ar, { isAuthorized: true, status: 'active' }) : ar;
                                });
                                if (!updR2.some(function (ar) { return ar.role === role && (ar.clubId || null) === (clubId || null); })) {
                                    updR2.push({ role: role, isAuthorized: true, status: 'active', clubId: clubId || null });
                                }
                                // FIX: Preservar el rol individual y todos los demás roles activos
                                // Solo actualizamos el rol aprobado, sin tocar los demás
                                var updatePayload = {
                                    allRoles:     updR2,
                                    authorizedAt: new Date().toISOString(),
                                    authorizedBy: me,
                                };
                                // Para usuarios del sistema individual: NO sobreescribir isAuthorized global
                                // si ya tienen el rol individual activo (que es su rol principal)
                                var hasActiveIndividual = updR2.some(function(ar) { return ar.role === 'individual' && ar.isAuthorized; });
                                if (!hasActiveIndividual) {
                                    updatePayload.isAuthorized = true;
                                }
                                await updateDoc(doc(db, 'users', r.userUid), updatePayload);
                            }
                            if (typeof showToast === 'function') showToast('✅ ' + email + ' activado como ' + (RLABELS[role] || role), 5000);
                        }
                        if (!isOrphan) {
                            await updateDoc(doc(db, 'platform_requests', reqId), { status: approve ? 'sa_approved' : 'rejected', approvedAt: new Date().toISOString(), approvedBy: me }).catch(function(){});
                        }
                        
                        // FIX: asegurar que allRoles también refleje isAuthorized:true o el estado rechazado
                        if (r.userUid) {
                            if (!approve) {
                                await updateDoc(doc(db, 'users', r.userUid), { status: 'rejected' }).catch(function(){});
                                if (typeof showToast === 'function') showToast('✕ Solicitud rechazada', 3000);
                                window.saRequests();
                                return;
                            }

                            var finalSnap = await getDoc(doc(db, 'users', r.userUid)).catch(function(){ return null; });
                            if (finalSnap && finalSnap.exists()) {
                                var finalData = finalSnap.data();
                                var finalRoles = (finalData.allRoles || []).map(function(ar) {
                                    var isThisRole = (ar.role === role);
                                    return isThisRole ? Object.assign({}, ar, { 
                                        isAuthorized: true, 
                                        status: 'active', 
                                        clubId: clubId || ar.clubId, 
                                        clubName: clubName || ar.clubName,
                                        category: r.category || ar.category || null,
                                        subcategory: r.subcategory || ar.subcategory || null,
                                        coordinatorType: r.requestedCoordinatorType || r.coordinatorType || ar.coordinatorType || null
                                    }) : ar;
                                });
                                if (!finalRoles.some(function(ar){ return ar.role === role; })) {
                                    finalRoles.push({ 
                                        role: role, 
                                        isAuthorized: true, 
                                        status: 'active', 
                                        clubId: clubId || null, 
                                        clubName: clubName || null,
                                        category: r.category || null,
                                        subcategory: r.subcategory || null
                                    });
                                }
                                await updateDoc(doc(db, 'users', r.userUid), {
                                    status:       'active',
                                    isAuthorized: true,
                                    clubId:       clubId || finalData.clubId || null,
                                    clubName:     clubName || finalData.clubName || null,
                                    allRoles:     finalRoles,
                                }).catch(function(){});
                            }
                        }
                        if (typeof showToast === 'function') showToast('✅ Operación completada', 4000);
                        window.saRequests();
                    } catch (e) {
                        console.error('[saExtApprove] Error:', e);
                        if (typeof showToast === 'function') showToast('⚠️ Error: ' + e.message, 5000);
                    }
                };

                // ── RESETEAR USUARIO ATASCADO ────────────────────────
                window.saExtResetUser = async function () {
                    var email = prompt('Introduce el EMAIL del usuario a resetear (limpiar estados pendientes):');
                    if (!email) return;
                    if (typeof showToast === 'function') showToast('⏳ Limpiando...', 2000);
                    try {
                        var { db, collection, getDocs, query, where, doc, updateDoc, deleteDoc } = await saFS();
                        var snap = await getDocs(query(collection(db, 'users'), where('email', '==', email.trim())));
                        if (snap.empty) { alert('Usuario no encontrado.'); return; }
                        
                        var userDoc = snap.docs[0];
                        var uid = userDoc.id;

                        // 1. Limpiar platform_requests
                        var prSnap = await getDocs(query(collection(db, 'platform_requests'), where('userUid', '==', uid)));
                        var ops = [];
                        prSnap.forEach(function(d) { ops.push(deleteDoc(doc(db, 'platform_requests', d.id))); });
                        await Promise.all(ops);

                        // 2. Resetear User Doc
                        await updateDoc(doc(db, 'users', uid), {
                            status: 'free',
                            isAuthorized: false,
                            clubId: null,
                            clubName: null,
                            requestedClubName: null,
                            allRoles: []
                        });

                        if (typeof showToast === 'function') showToast('✅ Usuario reseteado. Ya puede volver a registrarse.', 5000);
                        window.saRequests();
                    } catch (e) {
                        alert('Error: ' + e.message);
                    }
                };

                // ── DESCARTAR SOLICITUD SIN BORRAR USUARIO ──────────
                window.saExtDiscardRequest = async function (reqId) {
                    if (!confirm('¿Descartar esta solicitud?\n(Solo se borra la solicitud, el usuario NO se elimina)')) return;
                    try {
                        var { db, doc, deleteDoc } = await saFS();
                        await deleteDoc(doc(db, 'platform_requests', reqId));
                        if (typeof showToast === 'function') showToast('🗑️ Solicitud descartada', 3000);
                        window.saRequests();
                    } catch (e) {
                        alert('Error: ' + e.message);
                    }
                };

                window.saExtBaja = async function (reqId, userId, approve) {
                    await updateDoc(doc(db, 'deletion_requests', reqId), { status: approve ? 'approved' : 'rejected', resolvedAt: new Date().toISOString() });
                    if (approve) await updateDoc(doc(db, 'users', userId), { isAuthorized: false, status: 'removed' }).catch(function () {});
                    if (typeof showToast === 'function') showToast(approve ? '✅ Baja aprobada' : '❌ Rechazada', 3000);
                    window.saRequests();
                };

            } catch (e) {
                if (body) body.innerHTML = '<p style="color:#ff5858;padding:1rem;">⚠️ Error: ' + e.message + '</p>';
            }
        };
        window.saRequests._p25req = true;
    }

    // ════════════════════════════════════════════════════════════════
    // 4. FIX saAddIndividual CUANDO LISTA VACÍA
    // ════════════════════════════════════════════════════════════════

    function registerAddIndividual() {
        if (!window.saAddIndividual || !window.saAddIndividual._orig) {
            window.saAddIndividual = function () {
                if (typeof saOpenIndividualEditor === 'function') saOpenIndividualEditor(null);
            };
        }
    }

    // ════════════════════════════════════════════════════════════════
    // OBSERVADOR Y ARRANQUE
    // ════════════════════════════════════════════════════════════════

    var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes.forEach(function (node) {
                if (!node || node.nodeType !== 1) return;
                if (node.id === 'sa-root-modal' || (node.querySelector && node.querySelector('#sa-root-modal'))) {
                    setTimeout(injectSAButtons, 150);
                }
            });
        });
        // Inyectar botón de limpieza cuando se carga la pestaña Clubes
        setTimeout(injectCleanupBtn, 200);
    });

    function patchOpenSA() {
        var orig = window.openSuperAdminPanel;
        if (typeof orig !== 'function' || orig._p25) return;
        window.openSuperAdminPanel = async function () {
            await orig.apply(this, arguments);
            setTimeout(injectSAButtons, 200);
            setTimeout(injectCleanupBtn, 500);
            patchSaRequests();
        };
        window.openSuperAdminPanel._p25 = true;
        patchSaRequests();
    }

    function init() {
        observer.observe(document.body, { childList: true, subtree: true });
        registerAddIndividual();
        setTimeout(patchOpenSA, 600);
        setTimeout(patchOpenSA, 1400);
        if (document.getElementById('sa-root-modal')) injectSAButtons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

// ═══════════════════════════════════════════════════════════════════
// saFixIndividualNames() — Actualizar displayName de todos los
//   usuarios individuales al formato "Usuario Individual Nombre Apellido"
// ═══════════════════════════════════════════════════════════════════
window.saFixIndividualNames = async function() {
    if (!confirm('¿Actualizar el nombre de todos los usuarios individuales al formato\n"Usuario Individual Nombre Apellido"?')) return;
    try {
        const { db, collection, getDocs, doc, updateDoc } = await saFS();
        const snap = await getDocs(collection(db, 'users'));
        let updated = 0;
        const ops = [];
        snap.forEach(d => {
            const u = d.data();
            if (u.role === 'individual' || (u.allRoles||[]).some(r=>r.role==='individual')) {
                const firstName = u.firstName || '';
                const lastName  = u.lastName  || '';
                const fullName  = (firstName + ' ' + lastName).trim();
                if (fullName) {
                    const newDisplay = 'Usuario Individual ' + fullName;
                    if (u.displayName !== newDisplay) {
                        ops.push(updateDoc(doc(db, 'users', d.id), { displayName: newDisplay }));
                        updated++;
                    }
                }
            }
        });
        await Promise.all(ops);
        if (typeof showToast === 'function') showToast('✅ ' + updated + ' usuario(s) individual(es) actualizados', 4000);
        if (typeof window.saRequests === 'function') window.saRequests();
    } catch(e) {
        if (typeof showToast === 'function') showToast('❌ Error: ' + e.message, 4000);
    }
};

// Ejecutar automáticamente una vez al cargar para actualizar nombres existentes
(async function autoFixOnce() {
    const key = 'cronos_indnames_fixed_v1';
    if (localStorage.getItem(key)) return;
    try {
        const { db, collection, getDocs, doc, updateDoc } = await saFS().catch(()=>null);
        if (!db) return;
        const snap = await getDocs(collection(db, 'users'));
        const ops = [];
        snap.forEach(d => {
            const u = d.data();
            if (u.role === 'individual' || (u.allRoles||[]).some(r=>r.role==='individual')) {
                const firstName = u.firstName || '';
                const lastName  = u.lastName  || '';
                const fullName  = (firstName + ' ' + lastName).trim();
                if (fullName) {
                    const newDisplay = 'Usuario Individual ' + fullName;
                    if (u.displayName !== newDisplay) {
                        ops.push(updateDoc(doc(db, 'users', d.id), { displayName: newDisplay }).catch(()=>{}));
                    }
                }
            }
        });
        if (ops.length > 0) {
            await Promise.all(ops);
        }
        localStorage.setItem(key, '1');
    } catch(_) {}
})();


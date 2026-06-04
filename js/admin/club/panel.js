// ════════════════════════════════════════════════════════════════════
//  PANEL ADMIN DE CLUB (club_admin) — v3
//  Secciones expandibles por rol · Aprobación de solicitudes
//  Solicitud de ampliación de cuota al SuperAdmin
// ════════════════════════════════════════════════════════════════════
// Guardia: SA_CSS puede no estar definido si 16_superadmin.js no cargó aún
if (typeof window.SA_CSS === 'undefined') {
    window.SA_CSS = '<style>.sa-modal{background:#0d1117!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:16px!important;max-width:860px!important;width:98vw!important;max-height:92vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;font-family:Inter,sans-serif!important}.sa-body{flex:1;overflow-y:auto;padding:1rem 1.2rem}.sa-topbar{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.2rem;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;flex-wrap:wrap;gap:0.5rem}.sa-btn{display:inline-flex;align-items:center;gap:0.3rem;padding:0.32rem 0.65rem;border:1px solid rgba(255,255,255,0.1);border-radius:7px;background:rgba(255,255,255,0.04);color:white;font-size:0.78rem;font-weight:600;cursor:pointer}.sa-label{display:block;font-size:0.72rem;color:#8b949e;margin-bottom:0.3rem;font-weight:600}.sa-input{width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box}</style>';
}
if (typeof window.ROLE_META === 'undefined') {
    console.warn('[club/panel.js] ROLE_META no definido — admin-shared.js no cargó correctamente');
}

async function openClubAdminPanel(preClubId = null) {
    const me         = window._cronosCurrentUser;
    const activeRole = me._activeRole || me.role;
    const isSA       = me.role === 'superadmin' || me.role === 'admin';

    if (!me || (!isSA && activeRole !== 'club_admin' && activeRole !== 'individual')) {
        showToast('⛔ Sin permisos', 3000);
        return;
    }

    // Guard: ensure saFS is available (defined in 16_superadmin.js)
    if (typeof saFS !== 'function') {
        console.error('[ClubAdmin] saFS() not available. Make sure 16_superadmin.js is loaded.');
        showToast('⚠️ Error: módulo de administración no cargado. Recarga la página.', 5000);
        return;
    }

    let _fsResult;
    try {
        _fsResult = await saFS();
    } catch (err) {
        const _modal = document.getElementById('setup-modal');
        if (_modal) {
            _modal.style.display = 'flex';
            _modal.innerHTML = `<div style="background:#0d1117;border-radius:12px;padding:2rem;color:white;text-align:center;max-width:400px;margin:auto;">
                <div style="font-size:1.5rem;margin-bottom:1rem;">⚠️</div>
                <p style="color:#ff5858;">Error de conexión: ${escapeHtml(err.message)}</p>
                <button onclick="document.getElementById('setup-modal').style.display='none'"
                    style="margin-top:1rem;padding:0.5rem 1.2rem;background:rgba(255,88,88,0.15);
                           border:1px solid rgba(255,88,88,0.4);border-radius:7px;color:#ff5858;cursor:pointer;">
                    Cerrar
                </button>
            </div>`;
        }
        return;
    }
    const { db, fa, doc, getDoc, collection, getDocs, query, where, setDoc, updateDoc, deleteDoc, httpsCallable } = _fsResult;

    // Ensure setup-modal exists in DOM (needed for rendering)
    let setupModal = document.getElementById('setup-modal');
    if (!setupModal) {
        setupModal = document.createElement('div');
        setupModal.id = 'setup-modal';
        setupModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem;';
        document.body.appendChild(setupModal);
    }

    // ── Determinar clubId ──────────────────────────────────────
    let clubId = preClubId || me.clubId;

    // Si el Club Admin no tiene clubId, intentar buscarlo en Firestore
    if (!clubId && !isSA) {
        try {
            const clubsSnap = await getDocs(collection(db, 'clubs'));
            const clubs = [];
            clubsSnap.forEach(d => clubs.push({ id: d.id, ...d.data() }));

            // Buscar club donde el usuario sea admin (por email o por uid)
            const myClub = clubs.find(c =>
                (c.adminEmail === me.email) ||
                (c.adminUid === me.uid) ||
                (c.createdBy === me.uid)
            );
            if (myClub) {
                clubId = myClub.id;
                console.log('[ClubAdmin] Club encontrado por email/uid:', clubId);
                // Actualizar el documento del usuario con el clubId
                try {
                    await updateDoc(doc(db, 'users', me.uid), { clubId: myClub.id, clubName: myClub.name || '' });
                    me.clubId = myClub.id;
                    me.clubName = myClub.name || '';
                } catch(updErr) {
                    console.warn('[ClubAdmin] No se pudo actualizar clubId en user doc:', updErr.message);
                }
            } else if (clubs.length === 1) {
                // Si solo hay un club, asumir que es el suyo
                clubId = clubs[0].id;
                console.log('[ClubAdmin] Un solo club encontrado, asignando:', clubId);
                try {
                    await updateDoc(doc(db, 'users', me.uid), { clubId: clubs[0].id, clubName: clubs[0].name || '' });
                    me.clubId = clubs[0].id;
                    me.clubName = clubs[0].name || '';
                } catch(updErr2) {
                    console.warn('[ClubAdmin] No se pudo actualizar clubId:', updErr2.message);
                }
            }
        } catch(findErr) {
            console.warn('[ClubAdmin] Error buscando club:', findErr.message);
        }
    }

    // Si el SA no tiene clubId, mostrar selector de club ──────────
    if (!clubId && isSA) {
        const clubsSnap = await getDocs(collection(db, 'clubs'));
        const clubs = [];
        clubsSnap.forEach(d => clubs.push({ id: d.id, ...d.data() }));
        if (!clubs.length) { showToast('⚠️ No hay clubes creados aún', 3000); return; }
        window._sa_clubs_cache = clubs;

        const modal = document.getElementById('setup-modal');
        if (!modal) { showToast('⚠️ Error: modal no encontrado en la página', 5000); return; }
        modal.style.display = 'flex';
        modal.innerHTML = SA_CSS + `
        <div class="modal-content sa-modal" style="max-width:480px;">
          <div class="sa-topbar">
            <div style="font-weight:700; font-size:1rem;">🏟️ Seleccionar Club</div>
            <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
          </div>
          <div class="sa-body" style="padding:1.5rem;display:flex;flex-direction:column;gap:0.6rem;">
            <p style="color:var(--text-muted);font-size:0.82rem;margin:0 0 0.5rem;">
              Como Superadmin, selecciona el club que deseas gestionar:</p>
            ${clubs.map((c, idx) => `
              <button data-club-idx="${idx}"
                  style="text-align:left;padding:0.8rem 1rem;background:rgba(255,255,255,0.04);
                         border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;
                         color:white;font-size:0.9rem;transition:all 0.2s;width:100%;"
                  onmouseover="this.style.background='rgba(88,166,255,0.1)';this.style.borderColor='rgba(88,166,255,0.3)';"
                  onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.borderColor='rgba(255,255,255,0.1)';"
                  onclick="openClubAdminPanel(window._sa_clubs_cache[this.dataset.clubIdx].id)">
                🏟️ <strong>${escapeHtml(c.name)}</strong>
                <span style="font-size:0.72rem;color:var(--text-muted);display:block;margin-top:0.2rem;">
                  ${escapeHtml(c.adminEmail||'Sin admin')} · Plan: ${escapeHtml(c.plan||'free')}
                </span>
              </button>`).join('')}
          </div>
        </div>`;
        return;
    }

    if (!clubId) {
        const modal = document.getElementById('setup-modal');
        if (modal) {
            modal.style.display = 'flex';
            modal.innerHTML = SA_CSS + `
            <div class="modal-content sa-modal" style="max-width:450px;">
              <div class="sa-topbar">
                <div style="font-weight:700; font-size:1rem;">⚠️ Sin club asignado</div>
                <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
              </div>
              <div class="sa-body" style="padding:1.5rem;text-align:center;">
                <div style="font-size:2rem;margin-bottom:1rem;">🏟️</div>
                <p style="color:#ff5858;font-size:0.9rem;margin-bottom:0.5rem;">No se encontró un club asociado a tu cuenta.</p>
                <p style="color:#8b949e;font-size:0.8rem;margin-bottom:1rem;">Contacta con el SuperAdmin para que asigne un club a tu cuenta de Administrador.</p>
                <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                    style="padding:0.6rem 1.5rem;background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);border-radius:8px;color:#58a6ff;cursor:pointer;font-size:0.85rem;">
                    ⬅ Volver</button>
              </div>
            </div>`;
        } else {
            showToast('⚠️ Sin club asignado. Contacta con el SuperAdmin.', 5000);
        }
        return;
    }

    let clubSnap, usersSnap, platformReqsSnap, users = [], features = [];
    try {
        [clubSnap, usersSnap] = await Promise.all([
            getDoc(doc(db, 'clubs', clubId)),
            getDocs(query(collection(db, 'users'), where('clubId', '==', clubId))),
        ]);
        // platform_requests separado para que un fallo no cancele todo
        platformReqsSnap = await getDocs(query(
            collection(db, 'platform_requests'),
            where('clubId', '==', clubId)
        )).catch(e => {
            // Error de permisos es esperado si las reglas son estrictas, usamos users como respaldo
            console.log('[CA] Usando respaldo de usuarios para solicitudes (platform_requests restringido).');
            return { forEach: () => {} }; // Simular snap vacío
        });
    } catch (queryErr) {
        console.error('[ClubAdmin] Error loading data:', queryErr);
        // Fallback: try loading club doc only
        try {
            clubSnap = await getDoc(doc(db, 'clubs', clubId));
            users = [];
        } catch (e2) {
            const _modal = document.getElementById('setup-modal');
            if (_modal) {
                _modal.style.display = 'flex';
                _modal.innerHTML = `<div style="background:#0d1117;border-radius:12px;padding:2rem;color:white;text-align:center;max-width:450px;margin:auto;">
                    <div style="font-size:1.5rem;margin-bottom:1rem;">⚠️</div>
                    <p style="color:#ff5858;font-size:0.88rem;">Error al cargar datos del club.</p>
                    <p style="color:#8b949e;font-size:0.78rem;margin-top:0.5rem;">${escapeHtml(queryErr.message)}</p>
                    <p style="color:#8b949e;font-size:0.75rem;margin-top:0.8rem;">Posible causa: permisos insuficientes en Firestore rules.<br>Verifica que las reglas permiten consultar la colección users por clubId.</p>
                    <button onclick="document.getElementById('setup-modal').style.display='none'"
                        style="margin-top:1rem;padding:0.5rem 1.2rem;background:rgba(88,166,255,0.15);
                               border:1px solid rgba(88,166,255,0.4);border-radius:7px;color:#58a6ff;cursor:pointer;">
                        Cerrar</button>
                </div>`;
            }
            return;
        }
    }
    if (!clubSnap || !clubSnap.exists()) { showToast('⚠️ Club no encontrado', 3000); return; }
    const club = clubSnap.data();
    if (club.status === 'blocked') {
        showToast('🔒 Club suspendido. Contacta con el administrador de la plataforma.', 6000);
        return;
    }
    if (usersSnap) {
        usersSnap.forEach(d => users.push({ _id: d.id, ...d.data() }));
    }
    // Deduplicate: keep only one entry per uid (prefer primary doc) and merge roles
    const userMap = new Map();
    users.forEach(u => {
        const realUid = u.uid || u._id;
        if (!userMap.has(realUid)) {
            userMap.set(realUid, { ...u });
        } else {
            const existing = userMap.get(realUid);
            // Merge allRoles
            const merged = [...(existing.allRoles || [])];
            const incoming = u.allRoles || [];
            incoming.forEach(r => {
                const match = merged.find(m => m.role === r.role && (String(m.clubId||'') === String(r.clubId||'')));
                if (!match) {
                    merged.push(r);
                } else {
                    // Update if incoming is more authoritative (authorized)
                    if (r.isAuthorized && !match.isAuthorized) {
                        Object.assign(match, r);
                    }
                }
            });
            existing.allRoles = merged;

            // If this is the primary doc, prefer its root attributes
            if (u._id === realUid) {
                const preservedRoles = existing.allRoles;
                Object.assign(existing, u);
                existing.allRoles = preservedRoles;
            }
        }
    });
    users = Array.from(userMap.values());
    features = club.features || {};

    const slotOf = (role) => {
        const max = (club.slots || {})[role === 'director' ? 'directors' : role === 'coordinator' ? 'coordinators' : role === 'parent' ? 'parents' : 'users'] ?? -1;
        const usedSet = new Set();
        users.forEach(u => {
            if (u.status === 'removed') return;
            if (u.role === role && u.isAuthorized === true) {
                usedSet.add(u._id);
            } else if (u.allRoles) {
                const hasRole = u.allRoles.some(r => r.role === role && r.isAuthorized === true && (r.clubId === clubId || !r.clubId));
                if (hasRole) usedSet.add(u._id);
            }
        });
        const used = usedSet.size;
        return { max, used, full: max !== -1 && used >= max, unlimited: max === -1 };
    };

    const pendingFromPlatformReqs = [];
    if (platformReqsSnap) {
        platformReqsSnap.forEach(d => {
            const pr = { _id: d.id, _isPlatformReq: true, ...d.data() };
            if (pr.status !== 'pending_club_admin') return;
            const alreadyAuthorized = users.some(u => {
                const isSameUser = (u._id === pr.userUid || u.email === (pr.requestedEmail || pr.email));
                if (!isSameUser) return false;
                if (u.role === pr.requestedRole && u.isAuthorized) return true;
                return (u.allRoles || []).some(r => r.role === pr.requestedRole && r.isAuthorized && (r.clubId === clubId || !r.clubId));
            });
            if (alreadyAuthorized) return;
            const alreadyInPendingUsers = users.some(u => (u._id === pr.userUid || u.email === pr.requestedEmail) && (u.status === 'pending_club_admin' || (u.allRoles || []).some(r => r.status === 'pending_club_admin')));
            if (!alreadyInPendingUsers) pendingFromPlatformReqs.push(pr);
        });
    }

    const pendingFromUserDocs = [];
    users.forEach(u => {
        if (u.status === 'removed') return;
        if (u.status === 'pending_club_admin') pendingFromUserDocs.push({ ...u, _pendingRole: u.role || u.requestedRole });
        if (u.allRoles) {
            u.allRoles.forEach(r => {
                if (!r.isAuthorized && r.status === 'pending_club_admin' && (r.clubId === clubId || !r.clubId)) {
                    pendingFromUserDocs.push({ ...u, _pendingRole: r.role, _pendingCategory: r.category || u.requestedCategory, _pendingSubcat: r.subcategory || u.requestedSubcat });
                }
            });
        }
    });

    const pendingClubAdmin = [];
    const seenPendingKeys = new Set();
    pendingFromPlatformReqs.forEach(pr => {
        const key = (pr.userUid || pr.requestedEmail) + '_' + pr.requestedRole;
        pendingClubAdmin.push(pr);
        seenPendingKeys.add(key);
    });
    pendingFromUserDocs.forEach(u => {
        const key = (u._id || u.email) + '_' + u._pendingRole;
        if (!seenPendingKeys.has(key)) {
            pendingClubAdmin.push(u);
            seenPendingKeys.add(key);
        }
    });

    // Roles adicionales pendientes de usuarios que ya están activos en el club
    // (ej: un entrenador que solicita ser coordinador — su primer rol ya está aprobado)
    const pendingRolesInAllRoles = [];
    users.forEach(u => {
        if (u.status === 'removed' || u.status === 'blocked') return;
        // Solo incluir usuarios que ya tienen AL MENOS un rol autorizado en este club
        const hasActiveRole = (u.allRoles || []).some(r =>
            r.isAuthorized && (r.clubId === clubId || !r.clubId)
        );
        if (!hasActiveRole) return;
        // Buscar roles pendientes en allRoles que NO sean el rol principal ya aprobado
        (u.allRoles || []).forEach(r => {
            if (r.isAuthorized) return; // ya está autorizado, no es pendiente
            if (r.status === 'pending_club_admin' || r.status === 'pending_sa' || r.status === 'pending') {
                if (r.clubId === clubId || !r.clubId) {
                    pendingRolesInAllRoles.push({
                        ...u,
                        _pendingRole: r.role,
                        role: r.role, // sobreescribir para que el template use el rol pendiente
                        _pendingCategory: r.category || u.requestedCategory,
                        _pendingSubcat: r.subcategory || u.requestedSubcat,
                    });
                }
            }
        });
    });
    const pendingAutoReg = users.filter(u => u.status === 'pending' && u.requestedRole !== 'club_admin');
    const pendingClubApproval = users.filter(u => u.status === 'pending_club' && u.approvedBySA === true);
    const pendingMembers = [...pendingAutoReg];

    console.group('%c[CA-DIAG] Club Admin Panel', 'color:#58a6ff;font-weight:bold');
    console.log('clubId:', clubId, '| users:', users.length, '| pending:', pendingClubAdmin.length);
    console.groupEnd();
    // ─────────────────────────────────────────────────────────────────

    // ── Render de una fila de usuario ────────────────────────────────
    const userRow = (u) => {
        const isBlocked = u.status === 'blocked';
        const isRemoved = u.status === 'removed';
        const isPending = u.status === 'pending_register';
        const isActive  = u.isAuthorized && !isBlocked && !isRemoved;

        const statusBadge =
            isRemoved ? '<span class="sa-badge" style="margin-left:0.4rem;background:#ff585822;color:#ff5858;">🗑️ Baja</span>'
          : isBlocked ? '<span class="sa-badge" style="margin-left:0.4rem;background:#ff585822;color:#ff5858;">🔒 Bloqueado</span>'
          : isPending ? '<span class="sa-badge" style="margin-left:0.4rem;background:#ffa50022;color:#ffa500;">⏳ Pendiente registro</span>'
          : isActive  ? '<span class="sa-badge" style="margin-left:0.4rem;background:rgba(63,185,80,0.12);color:#3fb950;">✅ Activo</span>'
          : '<span class="sa-badge" style="margin-left:0.4rem;background:#ffa50022;color:#ffa500;">⏳ Pendiente</span>';

        const _escA = escapeAttr;
        const _escH = escapeHtml;
        const uid   = u._id;
        const email = _escA(u.email||u._id).replace(/\\/g,'\\\\').replace(/'/g, "\'");
        const euid  = _escA(u._id).replace(/\\/g,'\\\\').replace(/'/g, "\'");
        const ecid  = _escA(clubId).replace(/\\/g,'\\\\').replace(/'/g, "\'");

        return `
        <div class="sa-urow" style="opacity:${isRemoved ? '0.45' : '1'};">
            <div style="flex:1;min-width:0;">
                <span style="font-size:0.83rem;font-weight:600;">${_escH(u.email||u._id)}</span>
                ${u.displayName ? `<span style="color:var(--text-muted);font-size:0.74rem;"> · ${_escH(u.displayName)}</span>` : ''}
                ${statusBadge}
                ${(function(){
                    // Buscar categoría en el perfil o en allRoles
                    let cat = u.category || u.categoryLabel;
                    let sub = u.subcategory || u.subCategory;
                    if (!cat && u.allRoles) {
                        let roleEntry = u.allRoles.find(r => r.role === u.role);
                        if (roleEntry) { cat = roleEntry.category; sub = roleEntry.subcategory; }
                    }
                    if (!cat) return '';
                    return `
                    <div style="margin-top:4px; display:flex; align-items:center; gap:0.5rem;">
                        <span style="font-size:0.68rem;background:rgba(63,185,80,0.1);color:#3fb950;border:1px solid rgba(63,185,80,0.2);padding:2px 8px;border-radius:100px;font-weight:600;">
                            ⚽ ${_escH(cat)}${sub ? ' · ' + _escH(sub) : ''}
                        </span>
                        <button onclick="caEditUserCategory('${euid}','${email}','${_escA(cat)}','${_escA(sub||'')}')" 
                                style="background:none;border:none;color:#58a6ff;font-size:0.65rem;cursor:pointer;text-decoration:underline;padding:0;">
                            Cambiar equipo</button>
                    </div>`;
                })()}
            </div>
            <div style="display:flex;gap:0.3rem;flex-shrink:0;align-items:center;flex-wrap:wrap;">
                ${!isActive && !isRemoved ? `<button class="sa-btn"
                    onclick="caSetUserStatus('${euid}','${email}','active','${ecid}')"
                    style="font-size:0.7rem;color:#3fb950;border-color:rgba(63,185,80,0.35);background:rgba(63,185,80,0.08);">
                    ✅ Activar</button>` : ''}
                ${isActive ? `<button class="sa-btn"
                    onclick="caSetUserStatus('${euid}','${email}','blocked','${ecid}')"
                    style="font-size:0.7rem;color:#ffa500;border-color:rgba(255,165,0,0.35);background:rgba(255,165,0,0.07);">
                    🔒 Bloquear</button>` : ''}
                ${!isRemoved ? `<button class="sa-btn"
                    onclick="caSetUserStatus('${euid}','${email}','removed','${ecid}')"
                    style="font-size:0.7rem;color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);">
                    🗑️ Baja</button>` : ''}
                <button class="sa-btn"
                    onclick="caDeleteUserComplete('${euid}','${email}','${ecid}')"
                    style="font-size:0.7rem;color:white;border-color:rgba(255,88,88,0.6);background:rgba(255,88,88,0.2);font-weight:700;">
                    🗑️ Eliminar</button>
            </div>
        </div>`;
    };

    // ── Render de sección acordeón por rol ───────────────────────────
    // ── Render de TABLA UNIFICADA DE USUARIOS ────────────────────────
    const unifiedUserTable = () => {
        const expandedUsers = [];
        const cidStr = String(clubId || '');

        // 1. Filtrar y expandir usuarios por rol (para el club actual)
        users.filter(u => u.status !== 'removed').forEach(u => {
            let roles = u.allRoles || [];
            
            // Fallback: Si no tiene allRoles, considerar el rol raíz si pertenece al club
            if (roles.length === 0) {
                const rootRoleKey = u.role || u.requestedRole;
                const rootClubId = String(u.clubId || u.requestedClubId || '');
                const isAuth = u.isAuthorized === true || u.authorized === true;
                
                if (rootClubId === cidStr) {
                    roles = [{
                        role: rootRoleKey,
                        clubId: u.clubId || null,
                        isAuthorized: isAuth,
                        status: u.status,
                        category: u.category || u.categoryLabel,
                        subcategory: u.subcategory || u.subCategory
                    }];
                }
            }

            roles.forEach(r => {
                const rCid = String(r.clubId || '');
                const isAuth = r.isAuthorized === true || r.authorized === true || (u.role === 'superadmin');
                
                if (rCid === cidStr && isAuth && r.status !== 'rejected') {
                    expandedUsers.push({
                        ...u,
                        _activeRoleData: r
                    });
                }
            });
        });
            
        // 2. Generar las filas de la tabla
        const rows = expandedUsers.map(u => {
            const r = u._activeRoleData || {};
            const roleMeta = (window.ROLE_META || {})[r.role] || { icon: '👤', color: '#8b949e', label: r.role || 'Usuario' };
            
            // Nombre visible
            let name = u.firstName || u.displayName || (u.email ? u.email.split('@')[0] : 'Usuario');
            name = name.split(' ')[0];

            // Fecha de registro
            let regDate = '–';
            if (u.createdAt) {
                const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt.seconds ? u.createdAt.seconds * 1000 : u.createdAt);
                regDate = isNaN(d.getTime()) ? '–' : d.toLocaleDateString();
            } else if (u.authorizedAt) {
                regDate = new Date(u.authorizedAt).toLocaleDateString();
            }

            const catLabel = r.category || '–';
            const subLabel = r.subcategory || '–';
            const euid = (u._id || '').replace(/'/g, "\\'");
            const email = (u.email || '').replace(/'/g, "\\'");
            const ecid = (clubId || '').replace(/'/g, "\\'");
            const erole = (r.role || u.role || '').replace(/'/g, "\\'");

            return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                <td style="padding:0.8rem 0.7rem;">
                    <div style="font-weight:600; color:white;">${name}</div>
                    <div style="font-size:0.68rem; color:${roleMeta.color};">${roleMeta.icon} ${roleMeta.label}</div>
                </td>
                <td style="padding:0.8rem 0.7rem; font-size:0.8rem; color:#8b949e;">${u.email}</td>
                <td style="padding:0.8rem 0.7rem; font-size:0.8rem; color:#8b949e;">${regDate}</td>
                <td style="padding:0.8rem 0.7rem; font-size:0.8rem; color:#3fb950; font-weight:600;">${catLabel}</td>
                <td style="padding:0.8rem 0.7rem; font-size:0.8rem; color:#d2a8ff; font-weight:600;">${subLabel}</td>
                <td style="padding:0.8rem 0.7rem; text-align:right;">
                    <div style="display:flex; gap:0.4rem; justify-content:flex-end;">
                        <button onclick="caSetUserStatus('${euid}','${email}','removed','${ecid}','${erole}')"
                            title="Quitar este rol (conserva la cuenta y los demás roles)"
                            class="sa-btn" style="padding:0.25rem 0.5rem; color:#ffa500; border-color:rgba(255,165,0,0.25);">➖ Rol</button>
                        <button onclick="caDeleteUserComplete('${euid}','${email}','${ecid}')"
                            title="Eliminar usuario completamente (borra la cuenta Auth y todos sus roles)"
                            class="sa-btn" style="padding:0.25rem 0.5rem; color:#ff5858; border-color:rgba(255,88,88,0.3); font-weight:700;">🗑️ Usuario</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        return `
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; overflow:hidden; margin-bottom:1.5rem;">
            <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                    <tr style="background:rgba(255,255,255,0.05); border-bottom:1px solid rgba(255,255,255,0.1);">
                        <th style="padding:0.8rem 0.7rem; font-size:0.75rem; font-weight:700; color:var(--primary); text-transform:uppercase; letter-spacing:1px;">Nombre</th>
                        <th style="padding:0.8rem 0.7rem; font-size:0.75rem; font-weight:700; color:var(--primary); text-transform:uppercase; letter-spacing:1px;">Email</th>
                        <th style="padding:0.8rem 0.7rem; font-size:0.75rem; font-weight:700; color:var(--primary); text-transform:uppercase; letter-spacing:1px;">Registro</th>
                        <th style="padding:0.8rem 0.7rem; font-size:0.75rem; font-weight:700; color:var(--primary); text-transform:uppercase; letter-spacing:1px;">Categoría</th>
                        <th style="padding:0.8rem 0.7rem; font-size:0.75rem; font-weight:700; color:var(--primary); text-transform:uppercase; letter-spacing:1px;">Subcat.</th>
                        <th style="padding:0.8rem 0.7rem; text-align:right;"></th>
                    </tr>
                </thead>
                <tbody>
                    ${rows || '<tr><td colspan="6" style="padding:2rem; text-align:center; color:#8b949e;">No hay usuarios registrados.</td></tr>'}
                </tbody>
            </table>
        </div>`;
    };

    // ── Modal principal ─────────────────────────────────────────────
    let modalHTML;
    try {
    modalHTML = SA_CSS + `
    <div class="modal-content sa-modal">
      <div class="sa-topbar">
        <div>
          <div style="font-size:1.15rem;font-weight:700;">🏟️ ${escapeHtml(club.name)}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">Panel del Administrador del Club</div>
        </div>
        <div style="display:flex;gap:0.7rem;flex-wrap:wrap;">
          <button onclick="caNotifySuperAdmin('${clubId}')"
              style="padding:0.45rem 1rem;background:rgba(88,166,255,0.15);
                     border:1px solid rgba(88,166,255,0.4);border-radius:10px;
                     color:var(--primary);font-size:0.75rem;font-weight:700;cursor:pointer;">
              📡 Transmitir al SuperAdmin</button>
          <button onclick="caShowSuccession('${escapeAttr(clubId)}')"
              style="padding:0.45rem 1rem;background:rgba(210,168,255,0.12);
                     border:1px solid rgba(210,168,255,0.4);border-radius:10px;
                     color:#d2a8ff;font-size:0.75rem;font-weight:700;cursor:pointer;">
              🔄 Ceder Administración</button>
          <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
              style="padding:0.45rem 1rem;background:rgba(255,215,0,0.1);
                     border:1px solid rgba(255,215,0,0.3);border-radius:10px;
                     color:#ffd700;font-size:0.75rem;font-weight:700;cursor:pointer;">
              ⇄ Cambiar Rol</button>
          <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();else if(typeof logoutUser==='function')logoutUser();"
              style="padding:0.45rem 1rem;background:rgba(255,88,88,0.15);
                     border:1px solid rgba(255,88,88,0.4);border-radius:10px;
                     color:#ff5858;font-size:0.75rem;font-weight:700;cursor:pointer;">
              🚪 SALIR</button>
        </div>
      </div>

      <div class="sa-body">

        <!-- ── BLOQUE DE TRANSPARENCIA: Enviadas al SuperAdmin ── -->
        ${(function(){
            const fw = users.filter(u => (u.allRoles || []).some(r => r.status === 'pending_sa' && (r.clubId === clubId || !r.clubId)));
            if (!fw.length) return '';
            const meta = window.ROLE_META || {};
            return `
            <div style="background:rgba(88,166,255,0.08); border:1px solid rgba(88,166,255,0.3); border-radius:12px; padding:1rem; margin-bottom:1.5rem;">
                <h3 style="margin:0 0 0.8rem; font-size:0.85rem; color:#58a6ff; display:flex; align-items:center; gap:0.5rem;">
                    📤 Solicitudes enviadas al SuperAdmin
                    <span style="background:#58a6ff; color:white; padding:2px 8px; border-radius:10px; font-size:0.7rem;">${fw.length}</span>
                </h3>
                ${fw.map(u => {
                    const pr = (u.allRoles || []).find(r => r.status === 'pending_sa');
                    const label = (meta[pr?.role] || {}).label || pr?.role || 'Usuario';
                    return `<div style="font-size:0.8rem; color:white; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                        • <strong>${u.email}</strong> solicitó ser <strong>${label}</strong>. 
                        <span style="color:#8b949e; font-size:0.72rem; display:block; margin-top:2px;">⏳ Esperando que el SuperAdmin apruebe la solicitud.</span>
                    </div>`;
                }).join('')}
            </div>`;
        })()}

        <!-- ── BLOQUE 0: Aprobados por SA, pendientes de confirmación club ── -->
        ${pendingClubApproval.length ? `
        <div style="background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.25);
                    border-radius:10px;padding:1rem;margin-bottom:1.2rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#3fb950;
                     display:flex;align-items:center;gap:0.5rem;">
            ✅ Pendientes de tu confirmación (aprobados por SA)
            <span style="background:rgba(63,185,80,0.15);color:#3fb950;padding:1px 8px;border-radius:10px;font-size:0.7rem;">${pendingClubApproval.length}</span>
          </h3>
          <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.7rem;padding:0.4rem 0.6rem;background:rgba(63,185,80,0.05);border-radius:6px;border:1px solid rgba(63,185,80,0.15);">
            El SuperAdmin ya los aprobó. Tú debes dar el acceso final.
          </p>
          ${pendingClubApproval.map(u => {
              const roleLabel = ROLE_META[u.role]?.label || u.role || 'Usuario';
              const roleIcon  = ROLE_META[u.role]?.icon  || '👤';
              const escEmail = (escapeAttr(u.email||'')).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
              const escId    = u._id.replace(/'/g,"\\'");
              return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">' +
                '<div><div style="font-size:0.85rem;font-weight:600;">' + (escapeHtml(u.email)) + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">' + roleIcon + ' ' + roleLabel + ' · Aprobado por SA ✅</div></div>' +
                '<div style="display:flex;gap:0.4rem;">' +
                '<button onclick="caConfirmClubAccess(\'' + escId + '\',\'' + (u.role||'user') + '\',\'' + escEmail + '\')" class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.08);">✅ Confirmar acceso</button>' +
                '<button onclick="caRejectRequest(\'' + escId + '\',\'' + escEmail + '\')" class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">✕ Rechazar</button>' +
                '</div></div>';
          }).join('')}
        </div>` : ''}

        <!-- ── BLOQUE 0b: Solicitudes de registro pendientes de reenvío ── -->
        ${pendingClubAdmin.length ? `
        <div style="background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.25);\n                    border-radius:10px;padding:1rem;margin-bottom:1.5rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#58a6ff;\n                     display:flex;align-items:center;gap:0.5rem;">
            📨 Solicitudes de Registro (${pendingClubAdmin.length})
          </h3>
          <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.7rem;padding:0.4rem 0.6rem;\n                     background:rgba(88,166,255,0.05);border-radius:6px;border:1px solid rgba(88,166,255,0.15);">
            ℹ️ Estos usuarios se han registrado y esperan que reenvíes su solicitud al SuperAdmin.
          </p>
          ${pendingClubAdmin.map(u => {
              // Usar _pendingRole (allRoles expandido) o requestedRole (platform_req)
              const roleKey   = u._pendingRole || u.requestedRole || u.role || 'user';
              const roleLabel = (ROLE_META[roleKey] || {}).label || roleKey;
              const roleIcon  = (ROLE_META[roleKey] || {}).icon  || '👤';
              const cat       = u._pendingCategory || u.requestedCategory;
              const sub       = u._pendingSubcat   || u.requestedSubcat;
              const catInfo   = cat ? ' · <strong style="color:#3fb950">' + _catLabel(cat, sub) + '</strong>' : '';
              const nameInfo  = u.requestedName || [u.firstName, u.lastName].filter(Boolean).join(' ') || '';
              const emailShow = u.email || u.requestedEmail || '–';
              const escEmail  = (escapeAttr(emailShow)).replace(/\\/g,'\\\\').replace(/'/g,"\\'" );
              const escId     = (u._id||'').replace(/'/g,"\\'" );
              const fwdId     = u._isPlatformReq ? (u.userUid || escId) : escId;
              const escUserUid = (u._isPlatformReq ? (u.userUid || '') : '').replace(/'/g,"\\'");
              const isPR      = u._isPlatformReq ? 'true' : 'false';
              return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(88,166,255,0.15);">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">' +
                '<div style="min-width:0;flex:1;">' +
                '<div style="font-size:0.85rem;font-weight:600;word-break:break-all;">' + (escapeHtml(emailShow)) +
                (nameInfo ? ' · <span style="font-weight:400;color:#8b949e;font-size:0.78rem;">' + (escapeHtml(nameInfo)) + '</span>' : '') + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">' + roleIcon + ' ' + roleLabel + catInfo + '</div></div>' +
                '<div style="display:flex;gap:0.4rem;flex-shrink:0;">' +
                '<button onclick="caForwardToSA(\'' + fwdId + '\',\'' + roleKey + '\',\'' + escEmail + '\',\'' + clubId + '\')" class="sa-btn" style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.08);font-size:0.75rem;">📤 Reenviar al SA</button>' +
                '<button onclick="caRejectRequest(\'' + escId + '\',\'' + escEmail + '\',' + isPR + ',\'' + escUserUid + '\')" class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);font-size:0.75rem;">✕</button>' +
                '</div></div></div>';
          }).join('')}
        </div>` : ''}

        <!-- ── BLOQUE 0c: Roles pendientes de usuarios multi-rol ── -->
        ${pendingRolesInAllRoles.length ? `
        <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.25);\n                    border-radius:10px;padding:1rem;margin-bottom:1.5rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#f0883e;\n                     display:flex;align-items:center;gap:0.5rem;">
            📋 Nuevos Roles Solicitados (${pendingRolesInAllRoles.length})
          </h3>
          <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.7rem;padding:0.4rem 0.6rem;\n                     background:rgba(240,136,62,0.05);border-radius:6px;border:1px solid rgba(240,136,62,0.15);">
            ℹ️ Usuarios activos que solicitan un rol adicional en el club. Reenvía al SuperAdmin para aprobación.
          </p>
          ${pendingRolesInAllRoles.map(u => {
              const _meta = window.ROLE_META || {};
              const roleLabel = (_meta[u.role] || {}).label || u.role;
              const roleIcon  = (_meta[u.role] || {}).icon  || '👤';
              const escEmail  = (escapeAttr(u.email||'')).replace(/\\/g,'\\\\').replace(/'/g,"\\'" );
              const escId     = u._id.replace(/'/g,"\\'");
              return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(240,136,62,0.15);display:flex;justify-content:space-between;align-items:center;">' +
                '<div><div style="font-size:0.85rem;font-weight:600;">' + (escapeHtml(u.email)) + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Solicita: ' + roleIcon + ' ' + roleLabel + '</div></div>' +
                '<div style="display:flex;gap:0.4rem;">' +
                '<button onclick="caForwardToSA(\'' + escId + '\',\'' + (u.role||'user') + '\',\'' + escEmail + '\',\'' + clubId + '\')" class="sa-btn" style="color:#f0883e;border-color:rgba(240,136,62,0.3);background:rgba(240,136,62,0.08);">📤 Reenviar al SuperAdmin</button>' +
                '<button onclick="caRejectMultiRole(\'' + escId + '\',\'' + (u.role||'user') + '\',\'' + escEmail + '\')" class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">✕ Rechazar</button>' +
                '</div></div>';
          }).join('')}
        </div>` : ''}

        <!-- ── BLOQUE 0d: Solicitudes YA reenviadas (Transparencia) ── -->
        ${(function(){
            const forwarded = users.filter(u => {
                const ar = u.allRoles || [];
                return ar.some(r => r.status === 'pending_sa' && r.clubId === clubId);
            });
            if (!forwarded.length) return '';
            return `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);
                        border-radius:10px;padding:1rem;margin-bottom:1.5rem; opacity:0.8;">
              <h3 style="font-size:0.8rem;margin:0 0 0.8rem;color:var(--text-muted);
                         display:flex;align-items:center;gap:0.5rem;">
                📦 Enviadas al SuperAdmin (Pendientes de aprobación final)
                <span style="background:rgba(255,255,255,0.05);color:var(--text-muted);padding:1px 8px;border-radius:10px;font-size:0.65rem;">${forwarded.length}</span>
              </h3>
              ${forwarded.map(u => {
                  const ar = u.allRoles || [];
                  const pr = ar.find(r => r.status === 'pending_sa' && r.clubId === clubId);
                  const meta = window.ROLE_META || {};
                  const label = (meta[pr?.role] || {}).label || pr?.role || 'Usuario';
                  return '<div style="font-size:0.75rem; color:#8b949e; padding:4px 0;">' +
                         '• <b>' + (escapeHtml(u.email)) + '</b> (' + label + ')</div>';
              }).join('')}
            </div>`;
        })()}

        ${pendingMembers.length ? `
        <div style="background:rgba(255,165,0,0.06);border:1px solid rgba(255,165,0,0.25);
                    border-radius:10px;padding:1rem;margin-bottom:1.5rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#ffa500;
                     display:flex;align-items:center;gap:0.5rem;">
            🔔 Solicitudes de Acceso (${pendingMembers.length})
          </h3>
          ${pendingMembers.map(u => {
              const si        = slotOf(u.requestedRole || 'user');
              const roleLabel = ROLE_META[u.requestedRole || 'user']?.label || 'Usuario';
              return `
              <div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;
                          margin-bottom:0.5rem;border:1px solid rgba(255,255,255,0.05);
                          display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-size:0.85rem;font-weight:600;">${escapeHtml(u.email)}</div>
                  <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">
                    Rol solicitado: <strong>${escapeHtml(roleLabel)}</strong> ·
                    <span style="color:${si.full ? '#ff5858' : '#31d0aa'};">
                      ${si.used}/${si.max === -1 ? '∞' : si.max} slots</span>
                  </div>
                </div>
                <div style="display:flex;gap:0.4rem;">
                  <button onclick="caApproveRequest('${(escapeAttr(u._id)).replace(/'/g,"\\'")}','${u.requestedRole||'user'}','${(escapeAttr(u.email||'')).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' )"
                      class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.08);">
                      ✅ Aceptar</button>
                  <button onclick="caRejectRequest('${(escapeAttr(u._id)).replace(/'/g,"\\'")}','${(escapeAttr(u.email||'')).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' )"
                      class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">
                      ✕ Rechazar</button>
                </div>
              </div>`;
          }).join('')}
        </div>` : ''}

        <!-- ── TABLA DE USUARIOS UNIFICADA ── -->
        <h3 style="font-size:0.85rem; margin:1.5rem 0 0.8rem; color:#58a6ff; display:flex; align-items:center; gap:0.5rem;">
            👥 Usuarios del Club
            <span style="background:rgba(88,166,255,0.15); color:#58a6ff; padding:2px 8px; border-radius:10px; font-size:0.7rem;">${users.filter(u => u.status !== 'removed').length}</span>
        </h3>
        ${unifiedUserTable()}

        <!-- ── BLOQUE B: Resumen de cuotas ── -->
        <div class="sa-stats" style="margin-bottom:1.2rem;">
          ${['director','coordinator','user','parent'].map(role => {
              const si    = slotOf(role);
              const label = role==='director'?'Directores':role==='coordinator'?'Coordinadores':role==='parent'?'Padres':'Entrenadores';
              return `<div class="sa-stat">
                <div class="sa-stat-n" style="color:${si.full?'#ff5858':'#3fb950'};">
                  ${si.used}${si.unlimited ? '' : '/' + si.max}</div>
                <div class="sa-stat-l">${label}${si.unlimited?' ∞':''}</div>
                ${si.full ? '<div style="font-size:0.65rem;color:#ff5858;">Límite alcanzado</div>' : ''}
              </div>`;
          }).join('')}
        </div>

        <!-- ── BLOQUE C: Solicitar nuevo usuario al SuperAdmin ── -->
        <div class="sa-card" style="border-color:rgba(88,166,255,0.25);margin-bottom:1.2rem;">
          <div style="font-weight:700;color:var(--primary);margin-bottom:0.4rem;font-size:0.9rem;">
            📩 Solicitar nuevo usuario al SuperAdmin</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.8rem;
                      padding:0.5rem 0.7rem;background:rgba(88,166,255,0.05);
                      border:1px solid rgba(88,166,255,0.15);border-radius:8px;line-height:1.5;">
            <strong style="color:var(--primary);">Flujo correcto:</strong>
            1️⃣ Tú solicitas aquí → 2️⃣ SuperAdmin aprueba → 3️⃣ El usuario se registra en la app → 4️⃣ Tú le das acceso
          </div>
          <div class="sa-g4" style="align-items:end;">
            <div><label class="sa-label">Email del nuevo usuario *</label>
              <input class="sa-input" id="nu-email" type="email" placeholder="usuario@email.com"></div>
            <div><label class="sa-label">Nombre completo</label>
              <input class="sa-input" id="nu-name" placeholder="Nombre y apellidos"></div>
            <div><label class="sa-label">Rol solicitado</label>
              <select class="sa-input" id="nu-role" onchange="caRoleChanged()">
                <option value="user">⚽ Entrenador</option>
                <option value="parent">👨‍👩‍👧 Padre/Madre/Tutor</option>
                ${features.live_view ? '<option value="coordinator">🎯 Coordinador</option>' : ''}
                ${features.live_view ? '<option value="director">📋 Director Dep.</option>' : ''}
              </select></div>
            <button onclick="caSolicitarUsuario('${clubId}')" class="sa-btn"
                style="color:var(--primary);border-color:rgba(88,166,255,0.4);
                       background:rgba(88,166,255,0.1);font-weight:700;height:34px;">
                📩 Solicitar</button>
          </div>
          <!-- Campos extra para Padre/Madre -->
          <div id="nu-parent-fields" style="display:none;margin-top:0.6rem;">
            <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.4rem;
                        padding:0.4rem 0.6rem;background:rgba(210,168,255,0.08);
                        border:1px solid rgba(210,168,255,0.2);border-radius:6px;">
              👨‍👩‍👧 Datos adicionales para Padre/Tutor — vincula al jugador de su hijo/a
            </div>
            <div class="sa-g4" style="margin-top:0.4rem;">
              <div><label class="sa-label">Nº Dorsal del jugador *</label>
                <input class="sa-input" id="nu-player-num" type="number" placeholder="ej: 7" min="1" max="99"></div>
              <div><label class="sa-label">Alias / Nombre del jugador</label>
                <input class="sa-input" id="nu-player-alias" placeholder="ej: García"></div>
              <div><label class="sa-label">WhatsApp del padre (sin +)</label>
                <input class="sa-input" id="nu-parent-wa" type="tel" placeholder="ej: 34612345678"></div>
            </div>
          </div>
          <div id="nu-msg" style="font-size:0.78rem;margin-top:0.4rem;min-height:1rem;color:#3fb950;"></div>
        </div>



        <!-- ── BLOQUE E: Toggle envío informes individualizados a padres ── -->
        <div class="sa-card" style="border-color:rgba(210,168,255,0.3);margin-top:1rem;">
          <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')">
            <div class="sa-card-title">
              <span class="sa-chevron">▼</span>
              <span style="color:#d2a8ff;">⚙️ Configuración del Club</span>
            </div>
          </div>
          <div class="sa-card-body" id="ca-features-section">
            <div style="background:rgba(210,168,255,0.06);border:1px solid rgba(210,168,255,0.2);
                        border-radius:8px;padding:0.8rem;margin-bottom:0.6rem;">
              <div style="display:flex;align-items:center;gap:0.7rem;">
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;flex:1;">
                  <input type="checkbox" id="ca-toggle-individual-reports"
                    ${features.sendIndividualReports ? 'checked' : ''}
                    onchange="caToggleFeature('${clubId}','sendIndividualReports',this.checked)"
                    style="width:20px;height:20px;accent-color:#d2a8ff;">
                  <div>
                    <div style="font-size:0.85rem;font-weight:700;color:white;">
                      📊 Enviar informes individualizados a padres
                    </div>
                    <div style="font-size:0.72rem;color:#7d8590;margin-top:0.15rem;">
                      Si está activado, los entrenadores podrán enviar el informe de cada jugador
                      directamente al padre/tutor vinculado a ese jugador.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- ── BLOQUE F: Contactos del Club con permisos ── -->
        <div class="sa-card" style="border-color:rgba(88,166,255,0.3);margin-top:1rem;">
          <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')">
            <div class="sa-card-title">
              <span class="sa-chevron">▼</span>
              <span style="color:#58a6ff;">📇 Contactos del Club — Permisos</span>
              <span class="sa-badge" style="background:rgba(88,166,255,0.15);color:#58a6ff;">
                ${users.filter(u=>u.status==='active'&&u.isAuthorized!==false).length} usuarios
              </span>
            </div>
          </div>
          <div class="sa-card-body" id="ca-contacts-section">
            <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.8rem;
                        padding:0.4rem 0.6rem;background:rgba(88,166,255,0.05);
                        border-radius:6px;border:1px solid rgba(88,166,255,0.15);">
              Configura qué puede recibir o acceder cada usuario del club.
              Los cambios se guardan automáticamente.
            </div>
            ${users.filter(u=>u.status==='active'&&u.isAuthorized!==false).sort((a,b)=>(a.role||'').localeCompare(b.role||'')).map(u => {
                const meta = ROLE_META[u.role] || {icon:'👤',color:'#8b949e',label:u.role||'?'};
                const perms = u.permissions || {};
                const uid = u._id;
                const permToggle = (key, icon, label, color) =>
                  '<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.7rem;color:#7d8590;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);padding:0.25rem 0.5rem;border-radius:5px;cursor:pointer;">' +
                  '<input type="checkbox" ' + (perms[key]?'checked':'') + ' onchange="caSetPermission(\'' + uid.replace(/'/g,"\\'") + '\',\'' + key + '\',this.checked)" style="width:14px;height:14px;accent-color:' + color + ';"> ' +
                  icon + ' ' + label + '</label>';
                return '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:0.7rem 0.8rem;margin-bottom:0.5rem;">' +
                  '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">' +
                  '<span>' + meta.icon + '</span>' +
                  '<div style="flex:1;min-width:0;">' +
                  '<div style="font-weight:700;font-size:0.82rem;color:white;">' + (escapeHtml(u.email||u._id)) +
                  (u.displayName ? ' <span style="color:#7d8590;font-weight:400;font-size:0.75rem;"> · ' + (escapeHtml(u.displayName)) + '</span>' : '') +
                  '</div><div style="font-size:0.68rem;color:' + meta.color + ';">' + meta.label + '</div></div></div>' +
                  '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">' +
                  permToggle('receiveConvocatorias','📋','Convocatorias','#3fb950') +
                  permToggle('receiveEntrenamientos','🏃','Entrenamientos','#58a6ff') +
                  permToggle('receiveMessages','💬','Mensajes','#d2a8ff') +
                  permToggle('receiveReports','📊','Informes','#f0883e') +
                  permToggle('receiveIndividualReports','📝','Inf. Individual','#ffa500') +
                  permToggle('liveView','🔴','En Vivo','#ff5858') +
                  '</div></div>';
            }).join('')}
          </div>
        </div>

        <!-- ── SECCIÓN FACTURACIÓN ── -->
        <div style="margin-top:1.5rem;border-top:1px solid rgba(255,255,255,0.08);padding-top:1.2rem;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;flex-wrap:wrap;gap:0.5rem;">
            <div style="font-size:0.88rem;font-weight:700;color:white;display:flex;align-items:center;gap:0.4rem;">
              💳 Mi suscripción
            </div>
            <button onclick="billClubView('club-billing-container')"
                style="padding:0.3rem 0.75rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                       border-radius:7px;color:#58a6ff;font-size:0.75rem;font-weight:600;cursor:pointer;">
                🔄 Actualizar
            </button>
          </div>
          <div id="club-billing-container" style="min-height:60px;">
            <div style="text-align:center;color:#8b949e;font-size:0.82rem;padding:1rem;">
              <button onclick="if(typeof billClubView==='function')billClubView('club-billing-container')"
                  style="padding:0.4rem 1rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                         border-radius:7px;color:#58a6ff;font-size:0.78rem;cursor:pointer;">
                  📊 Ver mi plan y facturas
              </button>
            </div>
          </div>
        </div>

      </div><!-- /sa-body -->
    </div>`;
    } catch (renderErr) {
        console.error('[ClubAdmin] Error rendering panel:', renderErr);
        const _modal = document.getElementById('setup-modal');
        if (_modal) {
            _modal.style.display = 'flex';
            _modal.innerHTML = `<div style="background:#0d1117;border-radius:12px;padding:2rem;color:white;text-align:center;max-width:450px;margin:auto;">
                <div style="font-size:1.5rem;margin-bottom:1rem;">⚠️</div>
                <p style="color:#ff5858;font-size:0.88rem;">Error al renderizar el panel del club.</p>
                <p style="color:#8b949e;font-size:0.78rem;margin-top:0.5rem;">${escapeHtml(renderErr.message)}</p>
                <button onclick="document.getElementById('setup-modal').style.display='none'"
                    style="margin-top:1rem;padding:0.5rem 1.2rem;background:rgba(88,166,255,0.15);
                           border:1px solid rgba(88,166,255,0.4);border-radius:7px;color:#58a6ff;cursor:pointer;">
                    Cerrar</button>
            </div>`;
        }
        return;
    }

    const modal = document.getElementById('setup-modal');
    if (!modal) {
        console.error('[ClubAdmin] setup-modal no encontrado. Creando modal temporal...');
        // Crear modal temporal si no existe en el DOM
        const tmpModal = document.createElement('div');
        tmpModal.id = 'setup-modal';
        tmpModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem;';
        document.body.appendChild(tmpModal);
        tmpModal.innerHTML = modalHTML;
    } else {
        modal.style.display = 'flex';
        modal.innerHTML = modalHTML;
    }

    // ── Bindings ─────────────────────────────────────────────────────
    window.caRoleChanged = () => {
        const role   = document.getElementById('nu-role')?.value;
        const fields = document.getElementById('nu-parent-fields');
        if (fields) fields.style.display = role === 'parent' ? 'block' : 'none';
    };

    // ── Solicitar nuevo usuario al SuperAdmin (nuevo flujo correcto) ──────
    window.caSolicitarUsuario = async (cid) => {
        const email   = document.getElementById('nu-email').value.trim();
        const name    = document.getElementById('nu-name').value.trim();
        const role    = document.getElementById('nu-role').value;
        const msgEl   = document.getElementById('nu-msg');

        if (!email) { msgEl.style.color='#ff5858'; msgEl.textContent='⚠️ Email obligatorio.'; return; }

        const si = slotOf(role);
        if (si.full) {
            msgEl.style.color = '#ff5858';
            msgEl.textContent = '⛔ Cuota llena para este rol. Solicita ampliación al SuperAdmin.';
            return;
        }

        msgEl.style.color = 'var(--primary)'; msgEl.textContent = 'Enviando solicitud…';

        const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
        const pNum   = document.getElementById('nu-player-num')?.value?.trim() || '';
        const pAlias = document.getElementById('nu-player-alias')?.value?.trim() || '';
        const pWA    = document.getElementById('nu-parent-wa')?.value?.trim() || '';

        try {
            // Crear solicitud para el SuperAdmin en platform_requests
            const reqId = 'user_req_' + cid + '_' + Date.now().toString(36);
            await setDoc(doc(db, 'platform_requests', reqId), {
                type:             'user_request',
                clubId:           cid,
                clubName:         club.name || '',
                requestedEmail:   email,
                requestedName:    name,
                requestedRole:    role,
                requestedRoleLabel: ROLE_LABELS[role] || role,
                playerNumber:     pNum   || null,
                playerAlias:      pAlias || null,
                parentWA:         pWA    || null,
                requestedBy:      me.uid,
                requestedByEmail: me.email,
                status:           'pending_sa',
                createdAt:        new Date().toISOString(),
            });

            msgEl.style.color   = '#3fb950';
            msgEl.textContent   = '✅ Solicitud enviada al SuperAdmin. Cuando la apruebe, el usuario podrá registrarse.';
            document.getElementById('nu-email').value = '';
            document.getElementById('nu-name').value  = '';
            if (document.getElementById('nu-player-num'))   document.getElementById('nu-player-num').value   = '';
            if (document.getElementById('nu-player-alias'))  document.getElementById('nu-player-alias').value  = '';
            if (document.getElementById('nu-parent-wa'))    document.getElementById('nu-parent-wa').value    = '';
        } catch(e) {
            msgEl.style.color   = '#ff5858';
            msgEl.textContent   = '❌ Error: ' + e.message;
        }
    };

    // ── Alta directa (mantenida para compatibilidad interna) ─────────────
    window.caAddUser = async (cid) => {
        const email  = document.getElementById('nu-email').value.trim();
        const name   = document.getElementById('nu-name').value.trim();
        const role   = document.getElementById('nu-role').value;
        const msgEl  = document.getElementById('nu-msg');
        if (!email) { msgEl.style.color='#ff5858'; msgEl.textContent='⚠️ Email obligatorio.'; return; }

        if (role === 'parent') {
            const pNum = document.getElementById('nu-player-num')?.value?.trim();
            if (!pNum) {
                msgEl.style.color='#ff5858';
                msgEl.textContent='⚠️ El número de dorsal del jugador es obligatorio para Padre/Tutor.';
                return;
            }
        }

        const si = slotOf(role);
        if (si.full) {
            msgEl.style.color='#ff5858';
            msgEl.textContent='⛔ Límite alcanzado. Solicita al SuperAdmin ampliar el plan.';
            return;
        }
        msgEl.style.color='var(--primary)'; msgEl.textContent='Registrando…';

        const uid = 'pre_' + Date.now().toString(36);
        await setDoc(doc(db,'users',uid), {
            email, displayName: name, role, clubId: cid, clubName: club.name || '',
            isAuthorized: true, status: 'pending_register',
            createdBy: me.uid, createdAt: new Date().toISOString()
        });
        const key = role==='director'?'usedSlots.directors':role==='coordinator'?'usedSlots.coordinators':role==='parent'?'usedSlots.parents':'usedSlots.users';
        await updateDoc(doc(db,'clubs',cid), { [key]: si.used + 1 });

        if (role === 'parent') {
            const pNum   = document.getElementById('nu-player-num')?.value?.trim()  || '';
            const pAlias = document.getElementById('nu-player-alias')?.value?.trim() || '';
            const pWA    = document.getElementById('nu-parent-wa')?.value?.trim()    || '';
            const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const linkId     = `${cid}_${pNum}`;
            await setDoc(doc(db,'cronos_player_links',linkId), {
                clubId: cid, playerNumber: pNum, playerAlias: pAlias,
                playerName: pAlias, teamName: club.name || '',
                parentUid: uid, parentEmail: email, parentWA: pWA,
                inviteCode, coachUid: '', coachEmail: '',
                linkedAt: new Date().toISOString(),
            });
            const codeDisplay   = document.getElementById('nu-invite-code-display');
            const codeContainer = document.getElementById('generated-invite-container');
            if (codeDisplay && codeContainer) {
                codeDisplay.textContent = inviteCode;
                codeContainer.style.display = 'flex';
            }
            if (document.getElementById('nu-player-num'))   document.getElementById('nu-player-num').value   = '';
            if (document.getElementById('nu-player-alias'))  document.getElementById('nu-player-alias').value  = '';
            if (document.getElementById('nu-parent-wa'))    document.getElementById('nu-parent-wa').value    = '';
        }

        msgEl.style.color = '#3fb950';
        msgEl.textContent = `✅ ${email} dado de alta. Debe registrarse con ese email.`;
        document.getElementById('nu-email').value = '';
        document.getElementById('nu-name').value  = '';
        setTimeout(() => openClubAdminPanel(), 1800);
    };

    // ── Confirmar acceso (paso 2: club admin confirma tras SA) ──────────
    window.caConfirmClubAccess = async (uid, role, email) => {
        const si = slotOf(role);
        if (si.full) {
            showToast(`⛔ No hay slots libres para ${role}. Solicita ampliación al SuperAdmin.`, 4000);
            return;
        }
        if (!confirm(`¿Confirmar acceso definitivo a ${email} como ${role}?`)) return;
        try {
            const targetDocRef = doc(db, 'users', uid);
            const targetSnap   = await getDoc(targetDocRef);
            let updateData = {
                isAuthorized: true,
                status: 'active',
                authorizedAt: new Date().toISOString(),
                authorizedBy: me.email
            };

            if (targetSnap.exists()) {
                const data = targetSnap.data();
                
                // Buscar metadata en platform_requests si no está en el doc
                let cat = data.requestedCategory || data.category || data.categoryLabel;
                let sub = data.requestedSubcat   || data.subcategory || data.subCategory;

                const roleInAll = (data.allRoles || []).find(r => r.role === role);
                if (roleInAll) {
                    cat = roleInAll.category || cat;
                    sub = roleInAll.subcategory || sub;
                }

                if (cat) {
                    updateData.category      = cat;
                    updateData.categoryLabel = cat;
                    if (sub) {
                        updateData.subcategory = sub;
                        updateData.subCategory = sub;
                    }
                }
                if (data.allRoles) {
                    updateData.allRoles = data.allRoles.map(r => {
                        if (r.role === role && (String(r.clubId||'') === String(clubId||''))) {
                            return { ...r, isAuthorized: true, status: 'active', category: cat, subcategory: sub };
                        }
                        return r;
                    });
                } else {
                    // Crear allRoles si no existe
                    updateData.allRoles = [{
                        role: role, clubId: clubId, isAuthorized: true, status: 'active',
                        category: cat, subcategory: sub
                    }];
                }
            }
            await updateDoc(targetDocRef, updateData);
            const key = role==='director'?'usedSlots.directors':role==='coordinator'?'usedSlots.coordinators':role==='parent'?'usedSlots.parents':'usedSlots.users';
            await updateDoc(doc(db,'clubs',clubId), { [key]: (si.used||0) + 1 });
            showToast(`✅ ${email} tiene acceso completo a la app.`, 4000);
            
            // Limpiar platform_request si existe
            try {
                const prRef = doc(db, 'platform_requests', 'fwd_' + clubId + '_' + uid + '_' + role);
                await updateDoc(prRef, { status: 'approved', approvedAt: new Date().toISOString() }).catch(()=>{});
            } catch(prErr) {}

            openClubAdminPanel();
        } catch(e) {
            showToast('❌ Error: ' + e.message, 3000);
        }
    };

    // ── Aprobar solicitud de acceso (auto-registro pendiente SA) ────────────
    window.caApproveRequest = async (uid, role, email) => {
        const si = slotOf(role);
        if (si.full) {
            showToast(`⛔ No hay slots libres para el rol ${role}. Solicita ampliación al SuperAdmin.`, 4000);
            return;
        }
        if (!confirm(`¿Autorizar acceso a ${email} como ${role}?`)) return;
        try {
            const targetDocRef = doc(db, 'users', uid);
            const targetSnap   = await getDoc(targetDocRef);
            let updateData = {
                isAuthorized: true,
                status: 'active',
                authorizedAt: new Date().toISOString(),
                authorizedBy: me.email
            };

            // Si el usuario tiene metadatos de categoría en la solicitud, migrarlos a la raíz del perfil
            if (targetSnap.exists()) {
                const data = targetSnap.data();
                const roleInAll = (data.allRoles || []).find(r => r.role === role);
                
                // Prioridad: 1. Datos en allRoles, 2. Datos en raíz, 3. Datos de la solicitud
                const cat = (roleInAll && roleInAll.category) || data.requestedCategory || data.categoryLabel;
                const sub = (roleInAll && roleInAll.subcategory) || data.requestedSubcat || data.subCategory;

                if (cat) {
                    updateData.category      = cat;
                    updateData.categoryLabel = cat;
                    if (sub) {
                        updateData.subcategory = sub;
                        updateData.subCategory = sub;
                    }
                }

                // También activar el rol dentro del array allRoles
                if (data.allRoles) {
                    const newAllRoles = data.allRoles.map(r => {
                        if (r.role === role) return { ...r, isAuthorized: true, status: 'active' };
                        return r;
                    });
                    updateData.allRoles = newAllRoles;
                }
            }

            await updateDoc(targetDocRef, updateData);
            const key = role==='director'?'usedSlots.directors':role==='coordinator'?'usedSlots.coordinators':role==='parent'?'usedSlots.parents':'usedSlots.users';
            await updateDoc(doc(db,'clubs',clubId), { [key]: (si.used || 0) + 1 });
            showToast(`✅ ${email} autorizado correctamente.`, 3000);
            openClubAdminPanel();
        } catch(e) {
            showToast('❌ Error al autorizar usuario: ' + e.message, 3000);
        }
    };

    // ── Rechazar solicitud de acceso ─────────────────────────────────
    window.caRejectRequest = async (uid, email, isPlatformReq, userUid) => {
        if (!confirm('¿Rechazar solicitud de ' + email + '?')) return;
        try {
            const isPR = isPlatformReq === true || isPlatformReq === 'true'
                || (typeof uid === 'string' && (uid.startsWith('self_reg_') || uid.startsWith('fwd_')));

            if (isPR) {
                // uid es un doc de platform_requests — borrarlo
                await deleteDoc(doc(db, 'platform_requests', uid));
                // Si tenemos el UID real del usuario, marcarlo como rechazado
                if (userUid) {
                    await updateDoc(doc(db, 'users', userUid), {
                        isAuthorized: false, status: 'rejected',
                        rejectedAt: new Date().toISOString(), rejectedBy: me.uid
                    }).catch(e => console.warn('[caRejectRequest] No se pudo actualizar user:', e.message));
                }
            } else {
                // uid es un usuario real
                try {
                    await updateDoc(doc(db,'users',uid), {
                        isAuthorized: false, status: 'rejected',
                        rejectedAt: new Date().toISOString(), rejectedBy: me.uid
                    });
                } catch(updErr) {
                    if (!updErr.message.includes('No document to update')) throw updErr;
                    // El doc de usuario no existe — solo limpiamos (no es error fatal)
                    console.warn('[caRejectRequest] User doc no existe, limpiando platform_requests...');
                }
                // Limpiar platform_requests relacionados (evitar solicitudes fantasma)
                try {
                    const prSnap = await getDocs(query(collection(db, 'platform_requests'), where('userUid', '==', uid)));
                    prSnap.forEach(d => deleteDoc(doc(db, 'platform_requests', d.id)).catch(() => {}));
                } catch(_) {}
            }
            showToast('❌ Solicitud de ' + email + ' rechazada.', 3000);
            openClubAdminPanel();
        } catch(e) { showToast('❌ Error al rechazar: ' + e.message, 3000); }
    };

    // ── Rechazar rol pendiente de un usuario multi-rol ─────────────
    window.caRejectMultiRole = async (uid, role, email) => {
        const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
        if (!confirm('¿Rechazar rol de ' + (ROLE_LABELS[role]||role) + ' para ' + email + '?')) return;
        try {
            const { db: fDb, doc: fDoc, updateDoc: fUpdateDoc, getDoc: fGetDoc } = await saFS();
            const userSnap = await fGetDoc(fDoc(fDb, 'users', uid));
            if (!userSnap.exists()) { showToast('❌ Usuario no encontrado', 3000); return; }
            const userData = userSnap.data();
            const allRoles = userData.allRoles || [];
            // Remove the pending role from allRoles
            const filtered = allRoles.filter(ar => !(ar.role === role && !ar.isAuthorized));
            // Update user doc (user writes own doc — should work)
            // But if called from Club Admin context, it might fail. Use try-catch.
            try {
                await fUpdateDoc(fDoc(fDb, 'users', uid), {
                    allRoles: filtered,
                    rejectedAt: new Date().toISOString(),
                    rejectedBy: window._cronosCurrentUser?.email || 'club_admin',
                });
            } catch (updErr) {
                console.warn('[caRejectMultiRole] Could not update user doc:', updErr.message);
            }
            showToast('❌ Rol ' + (ROLE_LABELS[role]||role) + ' rechazado para ' + email, 3000);
            openClubAdminPanel();
        } catch(e) { showToast('❌ Error al rechazar: ' + e.message, 3000); }
    };

    // ── Reenviar solicitud de registro al SuperAdmin ─────────────────
    // Helper: etiqueta legible de categoría
    function _catLabel(cat, sub) {
        if (!cat) return '';
        const labels = { prebenjamin:'Prebenjamín', benjamin:'Benjamín', alevin:'Alevín',
                         infantil:'Infantil', cadete:'Cadete', juvenil:'Juvenil', regional:'Regional' };
        return (labels[cat] || cat) + (sub ? ' ' + sub : '');
    }

    window.caForwardToSA = async (uid, role, email, cid) => {
        const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
        if (!confirm(`¿Reenviar solicitud de ${email} como ${ROLE_LABELS[role]||role} al SuperAdmin?`)) return;
        try {
            const { db: fDb, doc: fDoc, updateDoc: fUpdateDoc, setDoc: fSetDoc, getDoc: fGetDoc, deleteDoc: fDeleteDoc } = await saFS();
            
            // 1. Read current user doc to check if user already has active roles
            const userSnap = await fGetDoc(fDoc(fDb, 'users', uid));
            const userData = userSnap.exists() ? userSnap.data() : {};
            const hasOtherActiveRoles = (userData.isAuthorized === true) && userSnap.exists();
            
            // 1. Intentar actualizar el doc del usuario (informativo, puede fallar por reglas)
            try {
                if (hasOtherActiveRoles) {
                    const allRoles = userData.allRoles || [];
                    const roleIdx = allRoles.findIndex(r => 
                        r.role === role && (r.clubId || null) === (cid || null)
                    );
                    if (roleIdx >= 0) {
                        allRoles[roleIdx].status = 'pending_sa';
                        allRoles[roleIdx].forwardedToSA = true;
                    }
                    await fUpdateDoc(fDoc(fDb, 'users', uid), { allRoles });
                } else {
                    await fUpdateDoc(fDoc(fDb, 'users', uid), { status: 'pending_sa' });
                }
            } catch (updErr) {
                console.warn('[caForwardToSA] No se pudo actualizar el perfil del usuario (falta de permisos), procediendo con platform_request...');
            }

            // 2. Crear solicitud oficial de reenvío (ID único para el admin para evitar errores de permisos)
            const clubSnap = await fGetDoc(fDoc(fDb, 'clubs', cid));
            const clubName = clubSnap.exists() ? (clubSnap.data().name || '') : '';
            
            // Usar un ID que el Club Admin "posea" para evitar el error de permisos al sobrescribir la del usuario
            const fwdReqId = 'fwd_' + cid + '_' + uid + '_' + role;
            
            const realEmail = (email && email !== '–' && email !== '-') ? email 
                            : (userData.email || userData.requestedEmail || '');
            const realName  = userData.displayName || 
                             [userData.firstName, userData.lastName].filter(Boolean).join(' ') || 
                             userData.requestedName || '';

            // Obtener categorías si existen (del doc del usuario, allRoles, o de la solicitud original)
            let userCatFwd    = userData.requestedCategory || userData.category || null;
            let userSubcatFwd = userData.requestedSubcat   || userData.subcategory || null;
            const userSlotFwd = userData.requestedSlot     || null;
            // Buscar también en allRoles si no se encontró en el doc raíz
            if (!userCatFwd && userData.allRoles) {
                const roleEntry = userData.allRoles.find(r => r.role === role && (r.clubId || null) === (cid || null));
                if (roleEntry) {
                    userCatFwd    = roleEntry.category || roleEntry.categoryLabel || null;
                    userSubcatFwd = roleEntry.subcategory || roleEntry.subCategory || null;
                }
            }

            await fSetDoc(fDoc(fDb, 'platform_requests', fwdReqId), {
                type: 'self_registration',
                clubId: cid,
                clubName: clubName,
                requestedEmail:    realEmail,
                requestedName:     realName,
                requestedRole:     role,
                requestedRoleLabel: ROLE_LABELS[role] || role,
                requestedCategory: userCatFwd,
                requestedSubcat:   userSubcatFwd,
                requestedSlot:     userSlotFwd,
                userUid: uid,
                status: 'pending_sa',
                forwardedBy: window._cronosCurrentUser?.email || 'club_admin',
                forwardedAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            });
            
            // 3. Limpiar la solicitud original self_reg_* para que no quede colgada como pendiente
            //    Se buscan platform_requests de tipo pending_club_admin con el mismo usuario
            try {
                const { getDocs: _gds, collection: _col, query: _q, where: _w } = await saFS();
                const origPRSnap = await _gds(_q(_col(fDb, 'platform_requests'), _w('userUid', '==', uid)));
                origPRSnap.forEach(d => {
                    if (d.id !== fwdReqId && (d.data().status === 'pending_club_admin' || d.data().status === 'pending')) {
                        fDeleteDoc ? fDeleteDoc(fDoc(fDb, 'platform_requests', d.id)).catch(() => {}) : null;
                    }
                });
            } catch(_) {}

            showToast('✅ Solicitud de ' + email + ' reenviada al SuperAdmin.', 4000);
            openClubAdminPanel();
        } catch(e) {
            showToast('❌ Error al reenviar: ' + e.message, 3000);
        }
    };

    // ── Cambiar estado de un usuario (activo / bloqueado / baja total) ──

    // ── Eliminar usuario completo (sin preguntar motivo, borrado total) ──
    window.caDeleteUserComplete = async (userId, userEmail, cid) => {
        if (!confirm(
            '🗑️ ELIMINAR USUARIO COMPLETAMENTE\n\n' +
            'Email: ' + userEmail + '\n\n' +
            'Esto eliminará PERMANENTEMENTE:\n' +
            '• Su cuenta y documento de Firestore\n' +
            '• Todas sus solicitudes y platform_requests\n' +
            '• Sus enlaces con jugadores (cronos_player_links)\n' +
            '• Sus registros de baja\n\n' +
            'El correo quedará libre para re-registrarse.\n\n' +
            '¿Confirmar BORRADO TOTAL?'
        )) return;
        // Reutilizar caSetUserStatus con 'removed' que ya hace el borrado completo
        await window.caSetUserStatus(userId, userEmail, 'removed', cid);
    };

    // ── GESTIONAR EQUIPO (Categoría/Subcategoría) ────────────────────
    window.caEditUserCategory = async function(uid, email, currentCat, currentSub) {
        let newCat = prompt('Categoría (ej: Infantil, Cadete, Senior...):', currentCat);
        if (newCat === null) return;
        let newSub = prompt('Subcategoría / Grupo (ej: A, B, Segunda...):', currentSub);
        if (newSub === null) return;

        try {
            const { db, doc, updateDoc, getDoc } = await saFS();
            const userRef = doc(db, 'users', uid);
            const snap = await getDoc(userRef);
            if (!snap.exists()) {
                // Si es un documento secundario (uid_role_clubId), buscar el primario
                alert('No se puede editar directamente. Prueba a refrescar o contacta con el SuperAdmin.');
                return;
            }
            const data = snap.data();
            
            // Actualizar en el perfil general
            let updates = {
                category: newCat,
                subcategory: newSub
            };

            // Actualizar en allRoles
            if (data.allRoles) {
                updates.allRoles = data.allRoles.map(function(r) {
                    if (r.role === data.role || r.clubId === clubId) {
                        return Object.assign({}, r, { category: newCat, subcategory: newSub });
                    }
                    return r;
                });
            }

            await updateDoc(userRef, updates);
            if (typeof showToast === 'function') showToast('✅ Equipo actualizado correctamente', 3000);
            
            // Refrescar panel tras 1 segundo
            setTimeout(() => openClubAdminPanel(), 1000);
        } catch(e) {
            console.error('[caEditUserCategory] Error:', e);
            alert('Error: ' + e.message);
        }
    };

    window.caSetUserStatus = async (userId, userEmail, newStatus, cid, targetRole) => {
        const labels = { active:'activar', blocked:'bloquear', removed:'dar de baja definitivamente' };
        // Si se especifica targetRole, la "baja" es de UN solo rol (no del usuario entero).
        if (newStatus === 'removed' && targetRole) {
            if (!confirm('¿Quitar el rol "' + targetRole + '" a ' + userEmail + '?\n\n' +
                         'Se conservará su cuenta y los demás roles activos.')) return;
        } else {
            if (!confirm('¿Deseas ' + (labels[newStatus] || newStatus) + ' a ' + userEmail + '?')) return;
        }

        // Función auxiliar para obtener la clave de slot del club según el rol
        // Definida aquí para estar disponible en TODOS los caminos (removed, active, blocked)
        function _slotKey(role) {
            if (role === 'director') return 'usedSlots.directors';
            if (role === 'coordinator') return 'usedSlots.coordinators';
            if (role === 'parent') return 'usedSlots.parents';
            return 'usedSlots.users';
        }

        try {
            // ═══════════════════════════════════════════════════════════
            // BAJA DEFINITIVA — Eliminar TODOS los rastros del correo
            // ═══════════════════════════════════════════════════════════
            if (newStatus === 'removed') {
                var reason = prompt('Motivo de baja para ' + userEmail + ' (se registra en el sistema):');
                if (reason === null) return;

                // 1. Leer documento para obtener uid real
                var docSnap = await getDoc(doc(db, 'users', userId));
                var docData = docSnap.exists() ? docSnap.data() : {};
                var realUid = docData.uid || userId;
                var realEmail = docData.email || userEmail;

                // 2. Leer documento primario para obtener todos los roles
                var primarySnap = (realUid !== userId)
                    ? await getDoc(doc(db, 'users', realUid)).catch(function() { return null; })
                    : docSnap;
                var allRoles = [];
                if (primarySnap && primarySnap.exists()) {
                    allRoles = primarySnap.data().allRoles || [];
                } else if (docData.allRoles) {
                    allRoles = docData.allRoles;
                }

                // ── Determinar alcance del borrado (multi-rol) ──────────────
                // Si se especifica targetRole y el usuario tiene OTROS roles
                // activos, solo se elimina ESE rol; la cuenta Auth y los demás
                // roles se conservan. Sin targetRole = borrado total del usuario.
                var rolesRestantes = allRoles.filter(function(r) {
                    var sameRole = r.role === targetRole;
                    var sameClub = String(r.clubId || '') === String(cid || '');
                    return !(sameRole && sameClub);
                });
                var deleteAllRoles  = !targetRole || allRoles.length <= 1 || rolesRestantes.length === 0;
                var shouldDeleteAuth = deleteAllRoles;

                // ── CAMINO A: quitar SOLO un rol (conservar cuenta + otros roles)
                if (!deleteAllRoles) {
                    // A1. Liberar el slot de ese rol en el club
                    if (cid) {
                        try {
                            var csR = await getDoc(doc(db, 'clubs', cid));
                            if (csR.exists()) {
                                var rkR  = _slotKey(targetRole);
                                var subR = rkR.split('.')[1];
                                var curR = ((csR.data().usedSlots || {})[subR]) || 1;
                                var updR = {}; updR[rkR] = Math.max(0, curR - 1);
                                await updateDoc(doc(db, 'clubs', cid), updR);
                            }
                        } catch (_) {}
                    }
                    // A2. Quitar el rol de allRoles del doc primario (NO borrar el doc)
                    try {
                        await updateDoc(doc(db, 'users', realUid), { allRoles: rolesRestantes });
                    } catch (_) {}
                    // A3. Eliminar SOLO el doc secundario de ese rol (si existe)
                    var secOne = realUid + '_' + targetRole + '_' + (cid || 'global');
                    if (secOne !== realUid) {
                        try { await deleteDoc(doc(db, 'users', secOne)); } catch (_) {}
                    }
                    // A4. Registrar la baja de rol (sin tocar Firebase Auth)
                    await setDoc(doc(db, 'deletion_requests', realUid + '_role_' + Date.now()), {
                        userId: realUid, userEmail: realEmail, clubId: cid,
                        requestedBy: me.uid, requestedByEmail: me.email,
                        reason: (reason || '').trim() || 'Baja de rol',
                        roleDeleted: targetRole,
                        remainingRoles: rolesRestantes.map(function(r) { return r.role; }),
                        status: 'completed',
                        resolvedAt: new Date().toISOString(),
                        createdAt: new Date().toISOString()
                    }).catch(function() {});

                    showToast('➖ Rol "' + targetRole + '" de ' + userEmail +
                              ' eliminado. El usuario conserva sus otros roles.', 4000);
                    openClubAdminPanel();
                    return; // NO continúa al borrado total ni llama a deleteAuthUser
                }

                // ── CAMINO B: borrado TOTAL del usuario (incluye Auth) ──────
                // 3. Actualizar slots del club para CADA rol del usuario
                // (_slotKey ya definido al inicio de caSetUserStatus)
                for (var ri = 0; ri < allRoles.length; ri++) {
                    var rcid = allRoles[ri].clubId || cid;
                    if (rcid) {
                        var rk = _slotKey(allRoles[ri].role);
                        try {
                            var cs = await getDoc(doc(db, 'clubs', rcid));
                            if (cs.exists()) {
                                var sub = rk.split('.')[1];
                                var cur = ((cs.data().usedSlots || {})[sub]) || 1;
                                var upd = {}; upd[rk] = Math.max(0, cur - 1);
                                await updateDoc(doc(db, 'clubs', rcid), upd);
                            }
                        } catch (_) {}
                    }
                }

                // 4. Eliminar todos los documentos secundarios (roles adicionales)
                for (var si2 = 0; si2 < allRoles.length; si2++) {
                    var secId = realUid + '_' + allRoles[si2].role + '_' + (allRoles[si2].clubId || 'global');
                    if (secId !== realUid) {
                        try { await deleteDoc(doc(db, 'users', secId)); } catch (_) {}
                    }
                }

                // 5. Eliminar documento primario
                try { await deleteDoc(doc(db, 'users', realUid)); } catch (_) {}
                // Si el documento clickeado era secundario, eliminarlo también
                if (userId !== realUid) {
                    try { await deleteDoc(doc(db, 'users', userId)); } catch (_) {}
                }

                // 6. Eliminar enlaces de jugador (cronos_player_links)
                try {
                    var linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('parentUid', '==', realUid)));
                    var linksArr = []; linksSnap.forEach(function(ld) { linksArr.push(ld); });
                    for (var li = 0; li < linksArr.length; li++) {
                        try { await deleteDoc(doc(db, 'cronos_player_links', linksArr[li].id)); } catch (_) {}
                    }
                } catch (_) {}
                // También por email
                try {
                    var linksSnap2 = await getDocs(query(collection(db, 'cronos_player_links'), where('parentEmail', '==', realEmail)));
                    var linksArr2 = []; linksSnap2.forEach(function(ld) { linksArr2.push(ld); });
                    for (var li2 = 0; li2 < linksArr2.length; li2++) {
                        try { await deleteDoc(doc(db, 'cronos_player_links', linksArr2[li2].id)); } catch (_) {}
                    }
                } catch (_) {}

                // 7. Eliminar cuenta de Firebase Auth (vía Cloud Function) — ÚLTIMA operación.
                //    Solo se ejecuta en borrado TOTAL (shouldDeleteAuth). El fallo NO se
                //    ignora: se registra en auth_deletion_failures y se avisa al admin.
                if (shouldDeleteAuth) {
                    try {
                        if (!fa || !fa.functions) throw new Error('Functions SDK no disponible');
                        var delFn = httpsCallable(fa.functions, 'deleteAuthUser');
                        var authRes = await delFn({ uid: realUid, email: realEmail });
                        console.log('[caSetUserStatus] deleteAuthUser OK:', realEmail, authRes && authRes.data);
                    } catch (authErr) {
                        console.error('[caSetUserStatus] deleteAuthUser FALLÓ:',
                            authErr && authErr.code, authErr && authErr.message);
                        // Registrar el fallo de forma persistente para revisión manual
                        try {
                            await setDoc(doc(db, 'auth_deletion_failures', realUid + '_' + Date.now()), {
                                uid: realUid, email: realEmail, clubId: cid,
                                errorCode: (authErr && authErr.code) || null,
                                errorMessage: (authErr && authErr.message) || String(authErr),
                                requestedBy: me.uid, requestedByEmail: me.email,
                                createdAt: new Date().toISOString()
                            });
                        } catch (_) {}
                        showToast('⚠️ Datos borrados, pero la cuenta de Auth de ' + realEmail +
                                  ' NO se pudo eliminar. Registrado para revisión.', 6000);
                    }
                }

                // 8. Registrar la baja completa en deletion_requests
                var delRoles = allRoles.map(function(r) { return r.role; });
                await setDoc(doc(db, 'deletion_requests', realUid + '_del_' + Date.now()), {
                    userId: realUid, userEmail: realEmail, clubId: cid,
                    requestedBy: me.uid, requestedByEmail: me.email,
                    reason: reason.trim() || 'Sin motivo indicado',
                    allRolesDeleted: delRoles,
                    status: 'completed',
                    resolvedAt: new Date().toISOString(),
                    createdAt: new Date().toISOString()
                }).catch(function() {});

                showToast('\uD83D\uDDD1\uFE0F ' + userEmail + ' dado de baja. Todos los rastros eliminados.', 4000);
                openClubAdminPanel();
                return;
            }

            // ═══════════════════════════════════════════════════════════
            // ACTIVAR / BLOQUEAR (sin cambios)
            // ═══════════════════════════════════════════════════════════
            var isActive  = (newStatus === 'active');
            var isBlocked = (newStatus === 'blocked');

            await updateDoc(doc(db,'users',userId), {
                isAuthorized: isActive,
                status: newStatus
            });
            if (isActive) {
                var actUpd = {
                    authorizedAt: new Date().toISOString(),
                    authorizedBy: me.uid
                };
                await updateDoc(doc(db,'users',userId), actUpd);
            }
            if (isBlocked) {
                var blkUpd = {
                    blockedAt: new Date().toISOString(),
                    blockedBy: me.uid
                };
                await updateDoc(doc(db,'users',userId), blkUpd);
            }

            // Actualizar slots del club
            var userSnap = await getDoc(doc(db,'users',userId)).catch(function() { return null; });
            var role = (userSnap && userSnap.data()) ? (userSnap.data().role || 'user') : 'user';
            var key = _slotKey(role);
            var si = slotOf(role);
            if (isActive) {
                var actSlot = {}; actSlot[key] = (si.used || 0) + 1;
                await updateDoc(doc(db,'clubs',cid), actSlot);
            }
            if (isBlocked) {
                var blkSlot = {}; blkSlot[key] = Math.max(0, (si.used || 1) - 1);
                await updateDoc(doc(db,'clubs',cid), blkSlot);
            }

            showToast(isActive ? '\u2705 Usuario activado' : '\uD83D\uDD12 Usuario bloqueado', 3000);
            openClubAdminPanel();
        } catch(e) {
            showToast('\u274C Error: ' + e.message, 4000);
            console.error(e);
        }
    };

    // Mantener por compatibilidad (se usaba desde código externo)
    window.caRequestDeletion = (userId, userEmail, cid) =>
        window.caSetUserStatus(userId, userEmail, 'removed', cid);

    // ── Solicitar ampliación de cuota al SuperAdmin ──────────────────
    window.caRequestQuota = async (cid, role, roleLabel, slotKey) => {
        const current = slotOf(role);
        const extra   = prompt(
            `Solicitar ampliación de cuota para ${roleLabel}\n` +
            `Slots actuales: ${current.unlimited ? '∞' : current.max}\n\n` +
            `¿Cuántos slots adicionales necesitas?`
        );
        if (!extra || isNaN(parseInt(extra))) return;
        const requestedExtra = parseInt(extra);
        await setDoc(doc(db,'platform_requests',`quota_${cid}_${role}_${Date.now()}`), {
            type:        'quota_increase',
            clubId:      cid,
            clubName:    club.name || '',
            role,
            roleLabel,
            slotKey,
            currentMax:  current.max,
            currentUsed: current.used,
            requestedExtra,
            requestedBy:      me.uid,
            requestedByEmail: me.email,
            status:      'unread',
            createdAt:   new Date().toISOString(),
        });
        showToast(`✅ Solicitud enviada al SuperAdmin: +${requestedExtra} slots para ${roleLabel}.`, 5000);
    };

    // ── Transmitir estado al SuperAdmin ─────────────────────────────
    window.caNotifySuperAdmin = async (cid) => {
        if (!confirm('¿Enviar resumen de estado del club al SuperAdmin?')) return;
        showSpinner('Transmitiendo…');
        try {
            const pendingUsers  = users.filter(u => !u.isAuthorized || u.status === 'pending_register');
            const summary = `Club: ${club.name}\n` +
                `Pendientes de acceso: ${pendingUsers.length}\n` +
                `Directores: ${slotOf('director').used} · ` +
                `Coordinadores: ${slotOf('coordinator').used} · ` +
                `Entrenadores: ${slotOf('user').used} · ` +
                `Padres: ${slotOf('parent').used}\n\n` +
                pendingUsers.map(u => `- ${u.email} (${u.requestedRole||u.role})`).join('\n');

            await setDoc(doc(db,'platform_requests',`sync_${cid}_${Date.now()}`), {
                clubId: cid, clubName: club.name,
                type: 'sync_request', summary,
                pendingCount: pendingUsers.length,
                status: 'unread',
                createdAt: new Date().toISOString(),
                requestedBy: me.uid, requestedByEmail: me.email
            });
            hideSpinner();
            showToast('✅ Estado del club transmitido al SuperAdmin.', 5000);
        } catch(e) {
            hideSpinner();
            showToast('❌ Error: ' + e.message, 5000);
        }
    };
}
window.openClubAdminPanel = openClubAdminPanel;

// ════════════════════════════════════════════════════════════════════
//  SUCESIÓN DE ADMIN DE CLUB
// ════════════════════════════════════════════════════════════════════
window.caShowSuccession = async function caShowSuccession(clubId) {
    const me = window._cronosCurrentUser;
    try {
        const { db, doc, getDoc, collection, getDocs, query, where, setDoc, serverTimestamp } = await saFS();
        const clubSnap = await getDoc(doc(db, 'clubs', clubId));
        if (!clubSnap.exists()) { showToast('⚠️ Club no encontrado', 3000); return; }
        const club = clubSnap.data();

        // Cargar miembros activos del club (excluir al admin actual y superadmins)
        const usersSnap = await getDocs(query(collection(db, 'users'), where('clubId', '==', clubId)));
        const members = [];
        usersSnap.forEach(d => {
            const u = { id: d.id, ...d.data() };
            if (u.status === 'removed' || u.status === 'blocked') return;
            if (['superadmin', 'admin'].includes(u.role)) return;
            if (u.role === 'club_admin' && u.email === me.email) return;
            if (u.isAuthorized) members.push(u);
        });

        // Verificar si ya hay una sucesión pendiente
        const existingSnap = await getDocs(query(
            collection(db, 'succession_requests'),
            where('clubId', '==', clubId),
            where('status', '==', 'pending_sa')
        )).catch(() => ({ empty: true }));
        if (!existingSnap.empty) {
            showToast('⚠️ Ya hay una solicitud de sucesión pendiente para este club.', 5000);
            return;
        }

        // Construir opciones del selector
        let memberOptions = '<option value="">-- Selecciona un miembro --</option>';
        members.forEach(m => {
            const name = m.displayName || m.firstName || m.email;
            const roleMeta = (window.ROLE_META || {})[m.role] || { icon: '👤', label: m.role };
            memberOptions += `<option value="${m.id}">${roleMeta.icon} ${name} (${m.email}) - ${roleMeta.label}</option>`;
        });

        // Modal de sucesión
        const overlay = document.createElement('div');
        overlay.id = 'succession-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';
        overlay.innerHTML = `
        <div style="background:#161b22;border:1px solid rgba(210,168,255,0.3);border-radius:16px;
                    padding:1.5rem;width:min(96vw,500px);max-height:90vh;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem;">
                <div>
                    <div style="font-weight:700;font-size:1.05rem;color:white;">🔄 Ceder Administración</div>
                    <div style="font-size:0.75rem;color:#8b949e;margin-top:4px;">Club: ${typeof escapeHtml === 'function' ? escapeHtml(club.name) : club.name}</div>
                </div>
                <button id="succession-close" style="background:none;border:none;color:#8b949e;font-size:1.4rem;cursor:pointer;">✕</button>
            </div>

            <p style="font-size:0.8rem;color:#8b949e;margin:0 0 1.2rem;padding:0.6rem;background:rgba(210,168,255,0.06);border:1px solid rgba(210,168,255,0.15);border-radius:8px;">
                ⚠️ Al completarse la sucesión, tu cuenta de administrador será eliminada
                y el nuevo admin tomará el control del club. Los usuarios del club no se verán afectados.
                <strong>Requiere aprobación del SuperAdmin.</strong>
            </p>

            <!-- Selector de tipo -->
            <div style="display:flex;gap:0.6rem;margin-bottom:1rem;">
                <button id="succ-tab-existing" onclick="document.getElementById('succ-existing').style.display='block';document.getElementById('succ-new').style.display='none';this.style.borderColor='rgba(210,168,255,0.5)';this.style.color='#d2a8ff';document.getElementById('succ-tab-new').style.borderColor='rgba(255,255,255,0.1)';document.getElementById('succ-tab-new').style.color='#8b949e';"
                    style="flex:1;padding:0.6rem;background:rgba(255,255,255,0.04);border:2px solid rgba(210,168,255,0.5);border-radius:8px;color:#d2a8ff;font-size:0.82rem;font-weight:600;cursor:pointer;">
                    👥 Miembro existente
                </button>
                <button id="succ-tab-new" onclick="document.getElementById('succ-new').style.display='block';document.getElementById('succ-existing').style.display='none';this.style.borderColor='rgba(210,168,255,0.5)';this.style.color='#d2a8ff';document.getElementById('succ-tab-existing').style.borderColor='rgba(255,255,255,0.1)';document.getElementById('succ-tab-existing').style.color='#8b949e';"
                    style="flex:1;padding:0.6rem;background:rgba(255,255,255,0.04);border:2px solid rgba(255,255,255,0.1);border-radius:8px;color:#8b949e;font-size:0.82rem;font-weight:600;cursor:pointer;">
                    ✉️ Persona nueva
                </button>
            </div>

            <!-- Camino A: Miembro existente -->
            <div id="succ-existing" style="display:block;">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Selecciona al nuevo administrador</label>
                <select id="succ-member"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;">
                    ${memberOptions}
                </select>
                ${members.length === 0 ? '<p style="font-size:0.75rem;color:#ffa500;margin-top:0.5rem;">No hay miembros activos. Usa la opción "Persona nueva".</p>' : ''}
            </div>

            <!-- Camino B: Persona nueva -->
            <div id="succ-new" style="display:none;">
                <div style="margin-bottom:0.8rem;">
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email del nuevo administrador *</label>
                    <input id="succ-email" type="email" placeholder="nuevo.admin@email.com"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del nuevo administrador</label>
                    <input id="succ-name" type="text" placeholder="Nombre completo"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;">
                </div>
            </div>

            <!-- Botón confirmar -->
            <button id="succ-confirm"
                style="margin-top:1.2rem;width:100%;padding:0.8rem;background:rgba(210,168,255,0.15);border:1px solid rgba(210,168,255,0.4);border-radius:8px;color:#d2a8ff;font-weight:700;font-size:0.9rem;cursor:pointer;">
                📤 Enviar solicitud al SuperAdmin
            </button>
        </div>`;

        document.body.appendChild(overlay);

        // Cerrar modal
        document.getElementById('succession-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        // Confirmar sucesión
        document.getElementById('succ-confirm').addEventListener('click', async () => {
            const isExistingTab = document.getElementById('succ-existing').style.display !== 'none';

            let successorType, successorUid, successorEmail, successorName;

            if (isExistingTab) {
                successorUid = document.getElementById('succ-member').value;
                if (!successorUid) { showToast('⚠️ Selecciona un miembro del club', 3000); return; }
                const chosen = members.find(m => m.id === successorUid);
                successorEmail = chosen?.email || '';
                successorName = chosen?.displayName || chosen?.firstName || successorEmail;
                successorType = 'existing';
            } else {
                successorEmail = document.getElementById('succ-email').value.trim();
                successorName = document.getElementById('succ-name').value.trim();
                if (!successorEmail) { showToast('⚠️ Introduce el email del nuevo administrador', 3000); return; }
                successorType = 'new';
                successorUid = null;
            }

            if (!confirm('¿Confirmas la solicitud de sucesión?\n\nNuevo admin: ' + successorEmail + '\n\nRequiere aprobación del SuperAdmin.')) return;

            try {
                showSpinner('Enviando solicitud...');
                const reqId = 'succession_' + clubId + '_' + Date.now().toString(36);
                await setDoc(doc(db, 'succession_requests', reqId), {
                    clubId:              clubId,
                    clubName:            club.name || '',
                    outgoingAdminUid:    me.uid,
                    outgoingAdminEmail:  me.email,
                    successorType:       successorType,
                    successorUid:        successorUid || null,
                    successorEmail:      successorEmail,
                    successorName:       successorName || null,
                    status:              'pending_sa',
                    createdAt:           serverTimestamp(),
                });
                hideSpinner();
                overlay.remove();
                showToast('✅ Solicitud enviada al SuperAdmin. Tu acceso se mantiene hasta que confirme.', 6000);
            } catch (e) {
                hideSpinner();
                showToast('❌ Error: ' + e.message, 5000);
                console.error('[caShowSuccession]', e);
            }
        });
    } catch (e) {
        showToast('❌ Error: ' + e.message, 5000);
        console.error('[caShowSuccession]', e);
    }
};

// ════════════════════════════════════════════════════════════════════
//  TOGGLE DE FEATURES DEL CLUB (ej: informes individualizados)
// ════════════════════════════════════════════════════════════════════
window.caToggleFeature = async function caToggleFeature(clubId, featureKey, value) {
    try {
        const { db, doc, updateDoc, getDoc } = await saFS();
        await updateDoc(doc(db, 'clubs', clubId), {
            [`features.${featureKey}`]: value
        });
        const label = featureKey === 'sendIndividualReports'
            ? 'Envío de informes individualizados'
            : featureKey;
        showToast(`${value ? '✅' : '⏹️'} ${label} ${value ? 'activado' : 'desactivado'}`, 3000);
    } catch (e) {
        showToast('❌ Error: ' + e.message, 4000);
    }
};

// ════════════════════════════════════════════════════════════════════
//  PERMISOS INDIVIDUALES POR USUARIO
// ════════════════════════════════════════════════════════════════════
window.caSetPermission = async function caSetPermission(userId, permKey, value) {
    try {
        const { db, doc, getDoc, updateDoc } = await saFS();
        const uSnap = await getDoc(doc(db, 'users', userId));
        if (!uSnap.exists()) { showToast('⚠️ Usuario no encontrado', 3000); return; }

        const currentPerms = uSnap.data().permissions || {};
        currentPerms[permKey] = value;

        await updateDoc(doc(db, 'users', userId), { permissions: currentPerms });
        showToast('✅ Permiso actualizado', 2000);
    } catch (e) {
        showToast('❌ Error: ' + e.message, 4000);
    }
};

// ── Verificar acceso al club al iniciar sesión ───────────────────────
async function checkClubAccess(userData) {
    if (!userData?.clubId) return true;
    try {
        const cl = await saGet('clubs', userData.clubId);
        if (!cl) return true;
        if (cl.status === 'blocked') {
            const { signOut } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
            await signOut(window._cronos_auth?.auth);
            showToast('🔒 Club suspendido. Contacta con el administrador.', 8000);
            return false;
        }
        if (cl.expiresAt && new Date(cl.expiresAt) < new Date() && cl.status !== 'blocked') {
            showToast('⚠️ El plan de tu club ha vencido. Contacta con el administrador.', 6000);
        }
    } catch(e) { /* no bloquear */ }
    return true;
}
window.checkClubAccess = checkClubAccess;

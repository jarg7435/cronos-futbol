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
                // Actualizar el documento del usuario con el clubId
                try {
                    await updateDoc(doc(db, 'users', me.uid), { clubId: myClub.id, clubName: myClub.name || '' });
                    me.clubId = myClub.id;
                    me.clubName = myClub.name || '';
                } catch(updErr) {
                    if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[ClubAdmin] No se pudo actualizar clubId en user doc:', updErr.message);
                }
            } else if (clubs.length === 1) {
                // Si solo hay un club, asumir que es el suyo
                clubId = clubs[0].id;
                try {
                    await updateDoc(doc(db, 'users', me.uid), { clubId: clubs[0].id, clubName: clubs[0].name || '' });
                    me.clubId = clubs[0].id;
                    me.clubName = clubs[0].name || '';
                } catch(updErr2) {
                    if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[ClubAdmin] No se pudo actualizar clubId:', updErr2.message);
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

        // Pila de navegación: el selector de clubes del SuperAdmin es la OTRA
        // raíz de este panel (se llega aquí cuando no hay clubId). Se registra
        // SIN argumentos, para distinguirlo del panel de un club concreto.
        if (typeof navRootScreen === 'function') navRootScreen('openClubAdminPanel');

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

    // ══════════════════════════════════════════════════════════════
    // PLAZA VACANTE — quién OCUPA de verdad una plaza del club
    // ══════════════════════════════════════════════════════════════
    // De esto depende el bloqueo "⛔ Cuota llena para este rol", que corta
    // dar de alta o aprobar a un entrenador nuevo (4 puntos del panel). Si
    // alguien dado de baja sigue contando, su categoría NUNCA queda vacante y
    // el sustituto no puede entrar aunque el hueco exista.
    //
    // ⚠️ NO BASTA CON MIRAR `isAuthorized`. Un rol dado de baja se marca con
    //    status:'removed' + isAuthorized:false, pero hay documentos en los que
    //    esas dos cosas NO son coherentes:
    //      · los que reactivó el fallo de resurrección al iniciar sesión
    //        (quedaron status:'removed' con isAuthorized:true, o al revés);
    //      · los antiguos que usan el alias heredado `authorized` sin el "is".
    //    Contando solo `isAuthorized === true` esas plazas se quedaban pilladas
    //    para siempre, sin forma de liberarlas desde la interfaz.
    //    Por eso 'removed' manda: si el rol está de baja, NO ocupa plaza, diga
    //    lo que diga el resto de banderas.
    const _rolOcupaPlaza = (r, role) => {
        if (!r || r.role !== role) return false;
        if (String(r.clubId || '') !== String(clubId || '') && r.clubId) return false;
        if (r.status === 'removed' || r.status === 'rejected') return false;
        return r.isAuthorized === true || r.authorized === true;
    };
    const slotOf = (role) => {
        const max = (club.slots || {})[role === 'director' ? 'directors' : role === 'coordinator' ? 'coordinators' : role === 'parent' ? 'parents' : 'users'] ?? -1;
        const usedSet = new Set();
        users.forEach(u => {
            if (u.status === 'removed') return;
            // El rol de la RAÍZ. Se exige además que la raíz no esté de baja,
            // por si el documento quedó con status y bandera descuadrados.
            if (u.role === role && u.isAuthorized === true && u.status !== 'removed') {
                usedSet.add(u._id);
            } else if (u.allRoles) {
                if (u.allRoles.some(r => _rolOcupaPlaza(r, role))) usedSet.add(u._id);
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
    // Estados pendientes que el Club Admin debe poder GESTIONAR (reenviar/rechazar).
    // 'pending_sa' NO se incluye aquí: ya fue reenviado al SA y se muestra en el
    // bloque de solo-lectura "Enviadas al SuperAdmin".
    const _CA_ACTIONABLE = ['pending', 'pending_club_admin'];
    users.forEach(u => {
        if (u.status === 'removed' || u.status === 'blocked') return;
        // ¿Ya tiene algún rol ACTIVO en este club? Si lo tiene, sus roles pendientes
        // los gestiona el bloque "Nuevos Roles Solicitados" (pendingRolesInAllRoles).
        const hasActiveRole = u.isAuthorized === true ||
            (u.allRoles || []).some(r => r.isAuthorized && (r.clubId === clubId || !r.clubId));

        // (a) Usuario NUEVO (sin rol activo) cuyo rol principal está pendiente.
        if (!hasActiveRole && _CA_ACTIONABLE.includes(u.status) && u.role !== 'club_admin') {
            pendingFromUserDocs.push({ ...u, _pendingRole: u.role || u.requestedRole });
        }

        // (b) Rol pendiente dentro de allRoles (para este club) sin estar autorizado.
        if (u.allRoles) {
            u.allRoles.forEach(r => {
                if (!r.isAuthorized && _CA_ACTIONABLE.includes(r.status) && (r.clubId === clubId || !r.clubId)) {
                    pendingFromUserDocs.push({ ...u, _pendingRole: r.role, _pendingCategory: r.category || u.requestedCategory, _pendingSubcat: r.subcategory || u.requestedSubcategory });
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
                        _pendingSubcat: r.subcategory || u.requestedSubcategory,
                    });
                }
            }
        });
    });

    // FIX duplicados: un rol pendiente que ya se mostró en "Solicitudes de Registro"
    // (vía pendingFromPlatformReqs/pendingFromUserDocs, ver seenPendingKeys arriba)
    // NO debe repetirse en "Nuevos Roles Solicitados". Misma clave: (_id||email)+'_'+rol.
    const pendingRolesInAllRolesDeduped = pendingRolesInAllRoles.filter(u => {
        const key = (u._id || u.email) + '_' + u._pendingRole;
        if (seenPendingKeys.has(key)) return false;
        seenPendingKeys.add(key);
        return true;
    });
    pendingRolesInAllRoles.length = 0;
    pendingRolesInAllRoles.push(...pendingRolesInAllRolesDeduped);
    const pendingAutoReg = users.filter(u => u.status === 'pending' && u.requestedRole !== 'club_admin');
    const pendingClubApproval = users.filter(u => u.status === 'pending_club' && u.approvedBySA === true);
    const pendingMembers = [...pendingAutoReg];

    console.group('%c[CA-DIAG] Club Admin Panel', 'color:#58a6ff;font-weight:bold');
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
                    let sub = u.subcategory;
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
                <!-- ⚠️ EL BOTÓN "🗑️ Eliminar" (cuenta entera) SE HA RETIRADO.
                     El borrado global de cuentas es cosa del SuperAdministrador
                     al cerrar temporada. Desde el Panel de Club sólo se vacían
                     casillas, y la cuenta desaparece —sola— cuando se revoca la
                     última. Un botón que borra cuentas enteras al lado de uno
                     que sólo quita un rol es un accidente esperando. -->
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
                        subcategory: u.subcategory
                    }];
                }
            }

            roles.forEach(r => {
                const rCid = String(r.clubId || '');
                const isAuth = r.isAuthorized === true || r.authorized === true || (u.role === 'superadmin');
                
                // ⚠️ 'removed' TAMBIÉN excluye, no solo 'rejected'. Desde que la
                //    baja MARCA el rol en vez de borrarlo (revocación), un rol
                //    dado de baja sigue estando en allRoles: si aquí no se
                //    descarta explícitamente, el entrenador se sigue pintando
                //    en su categoría como si nada. `isAuth` no basta por sí
                //    solo, porque acepta el alias heredado `r.authorized`.
                if (rCid === cidStr && isAuth && r.status !== 'rejected' && r.status !== 'removed') {
                    // Fallback por-rol: si esta entrada concreta de allRoles no trae
                    // category/subcategory (tipico de altas del flujo Club previas al
                    // fix), respaldarlas desde la raiz del documento del usuario.
                    // Misma fuente que el fallback de array vacio (lineas 449-450).
                    const _roleData = (r.category == null && r.subcategory == null)
                        ? { ...r,
                            category:    r.category    != null ? r.category    : (u.category || u.categoryLabel),
                            subcategory: r.subcategory != null ? r.subcategory : u.subcategory }
                        : r;
                    expandedUsers.push({
                        ...u,
                        _activeRoleData: _roleData
                    });
                }
            });
        });
            
        // ── 2. Construir índices (una sola pasada O(n)) ──────────────
        //    · staff: Director + Coordinador(es) con coordinatorType válido.
        //    · byCatSub: Map<catId, Map<subId, user[]>> solo Entrenador/Padre
        //      con category Y subcategory válidas. Los registros incompletos
        //      (históricos) se EXCLUYEN por completo (decisión de diseño).
        // ⚠️ EL VOCABULARIO YA NO SE DECLARA AQUÍ (2026-07-30, fase 1 del árbol
        // del panel de Dirección). Vive en js/admin/shared/category-tree.js, porque el
        // panel del Director necesita EXACTAMENTE las mismas categorías para
        // agrupar informes, convocatorias y entrenamientos: dos copias acabarían
        // desincronizándose y cada panel mostraría un árbol distinto.
        // Se leen de window.* y NO se re-declaran con `const` de nivel superior
        // (ver la nota de admin-shared.js y test_admin_shared_constants.js).
        // Se leen DENTRO de la función, no al cargar el fichero, así que el
        // orden de los <script> no puede dejarlas vacías por sorpresa.
        // El respaldo mantiene el panel en pie si el módulo no cargara.
        const CLUB_CATEGORIES = window.CT_CATEGORIES || [];
        const CLUB_SUBCATS    = window.CT_SUBCATS    || ['A', 'B', 'C'];
        const _validCatIds = new Set(CLUB_CATEGORIES.map(c => c.id));
        const _coordLabel = { f7: 'F7', f11: 'F11', f711: 'F7&11' };

        const _buildUserIndex = (eUsers) => {
            const staff = [];                 // {u, role, coordType?}
            const byCatSub = new Map();       // catId -> (subId -> [rows])
            const catHasAny = new Set();      // catId
            const subHasAny = new Set();      // "catId|subId"
            eUsers.forEach(u => {
                const r = u._activeRoleData || {};
                const role = r.role || u.role;
                if (role === 'director') {
                    staff.push({ u, role, coordType: '' });
                    return;
                }
                if (role === 'coordinator') {
                    // Tipo de modalidad: preferir la entrada de rol concreta,
                    // con respaldo en el normalizador canónico global.
                    let ct = '';
                    const raw = (r.coordinatorType || r.requestedCoordinatorType || '');
                    const n = String(raw).trim().toLowerCase();
                    if (n === 'f7' || n === 'f11' || n === 'f711') ct = n;
                    if (!ct && typeof window._cronosStaffCoordinatorType === 'function') {
                        ct = window._cronosStaffCoordinatorType(u) || '';
                    }
                    // EXCLUIR coordinador sin tipo válido (registro histórico).
                    if (!ct) return;
                    staff.push({ u, role, coordType: ct });
                    return;
                }
                if (role !== 'user' && role !== 'parent') return; // club_admin u otros: fuera del árbol
                // Entrenador / Padre → al árbol. Requiere cat Y subcat válidas.
                const cat = String(r.category || '').trim().toLowerCase();
                const sub = String(r.subcategory || '').trim().toUpperCase();
                if (!_validCatIds.has(cat)) return;        // EXCLUIR sin categoría válida
                if (!CLUB_SUBCATS.includes(sub)) return;    // EXCLUIR sin subcategoría válida
                if (!byCatSub.has(cat)) byCatSub.set(cat, new Map());
                const subMap = byCatSub.get(cat);
                if (!subMap.has(sub)) subMap.set(sub, []);
                subMap.get(sub).push(u);
                catHasAny.add(cat);
                subHasAny.add(cat + '|' + sub);
            });
            return { staff, byCatSub, catHasAny, subHasAny };
        };

        // ── Fila plana de un usuario (Entrenador/Padre) ──────────────
        const _userRowHtml = (u) => {
            const r = u._activeRoleData || {};
            const roleMeta = (window.ROLE_META || {})[r.role] || { icon: '👤', color: '#8b949e', label: r.role || 'Usuario' };
            let name = window.cronosNombreUsuario(u)   /* v534 · el correo NO es un nombre */;
            name = escapeHtml(String(name).split(' ')[0]);
            let regDate = '–';
            if (u.createdAt) {
                const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt.seconds ? u.createdAt.seconds * 1000 : u.createdAt);
                regDate = isNaN(d.getTime()) ? '–' : d.toLocaleDateString();
            } else if (u.authorizedAt) {
                regDate = new Date(u.authorizedAt).toLocaleDateString();
            }
            const euid  = (u._id || '').replace(/'/g, "\\'");
            const email = (u.email || '').replace(/'/g, "\\'");
            const ecid  = (clubId || '').replace(/'/g, "\\'");
            const erole = (r.role || u.role || '').replace(/'/g, "\\'");
            return `
                <div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(80px,1fr) minmax(0,2fr) auto auto;
                            align-items:center; gap:0.6rem; padding:0.55rem 0.6rem;
                            border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="font-size:0.7rem; color:${roleMeta.color}; font-weight:600; white-space:nowrap;">${roleMeta.icon} ${escapeHtml(roleMeta.label)}</div>
                    <div style="font-weight:600; color:white; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</div>
                    <div style="font-size:0.74rem; color:#8b949e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(u.email || '')}">${escapeHtml(u.email || '')}</div>
                    <div style="font-size:0.72rem; color:#8b949e; white-space:nowrap;">${regDate}</div>
                    <div style="display:flex; gap:0.4rem; flex-shrink:0; justify-content:flex-end;">
                        <!-- ⚠️ UN SOLO BOTÓN. Aquí había también un "🗑️ Usuario"
                             que borraba la cuenta ENTERA: se ha retirado. Desde
                             una fila de equipo sólo se vacía esa casilla; el
                             borrado de cuentas es cosa del SuperAdministrador al
                             cerrar temporada, y ocurre solo si era el último rol. -->
                        <button onclick="caRevocarCasilla('${euid}','${email}','${ecid}','${erole}')"
                            title="Quitar esta casilla: archiva su trabajo en la categoría y la deja vacante. La cuenta se conserva si le quedan otros roles."
                            class="sa-btn" style="padding:0.25rem 0.5rem; color:#ffa500; border-color:rgba(255,165,0,0.25);">➖ Quitar del equipo</button>
                    </div>
                </div>`;
        };

        // ── Cabecera de columnas para la lista de una subcategoría ───
        //    Mismo grid que _userRowHtml: Rol · Nombre · Email · Fecha · (acciones).
        const _userRowHeaderHtml = () => `
                <div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(80px,1fr) minmax(0,2fr) auto auto;
                            align-items:center; gap:0.6rem; padding:0.4rem 0.6rem;
                            border-bottom:1px solid rgba(255,255,255,0.1);">
                    <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Rol</div>
                    <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Nombre</div>
                    <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Email</div>
                    <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Fecha</div>
                    <div></div>
                </div>`;

        // ── Bloque Staff (siempre visible, sin plegar) ───────────────
        const _staffBlockHtml = (staff) => {
            // Orden: Director primero, luego Coordinadores.
            const ordered = staff.slice().sort((a, b) =>
                (a.role === 'director' ? 0 : 1) - (b.role === 'director' ? 0 : 1));
            const items = ordered.map(({ u, role, coordType }) => {
                const roleMeta = (window.ROLE_META || {})[role] || { icon: '👤', color: '#8b949e', label: role };
                let name = window.cronosNombreUsuario(u)   /* v534 · el correo NO es un nombre */;
                name = escapeHtml(String(name).split(' ')[0]);
                const euid  = (u._id || '').replace(/'/g, "\\'");
                const email = (u.email || '').replace(/'/g, "\\'");
                const ecid  = (clubId || '').replace(/'/g, "\\'");
                const erole = (role || '').replace(/'/g, "\\'");
                const modBadge = coordType
                    ? `<span class="sa-badge" style="background:rgba(210,168,255,0.15); color:#d2a8ff;">${_coordLabel[coordType] || coordType}</span>`
                    : '';
                return `
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:0.6rem;
                                padding:0.5rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; align-items:center; gap:0.5rem; min-width:0;">
                            <span style="font-size:0.85rem; font-weight:700; color:white;">${name}</span>
                            <span style="font-size:0.7rem; color:${roleMeta.color}; font-weight:600;">${roleMeta.icon} ${escapeHtml(roleMeta.label)}</span>
                            ${modBadge}
                        </div>
                        <div style="display:flex; gap:0.4rem; flex-shrink:0;">
                            <button onclick="caRevocarCasilla('${euid}','${email}','${ecid}','${erole}')"
                                title="Quitar esta casilla: archiva su trabajo y la deja vacante"
                                class="sa-btn"
                                style="padding:0.25rem 0.5rem; color:#ffa500; border-color:rgba(255,165,0,0.25);">➖ Quitar del equipo</button>
                        </div>
                    </div>`;
            }).join('');
            return `
            <div style="background:rgba(240,136,62,0.05); border:1px solid rgba(240,136,62,0.25);
                        border-radius:10px; padding:0.8rem 0.9rem; margin-bottom:1rem;">
                <div style="font-size:0.78rem; font-weight:700; color:#f0883e; text-transform:uppercase;
                            letter-spacing:1px; margin-bottom:0.5rem;">📋 Staff del Club</div>
                ${items || '<div style="font-size:0.78rem; color:#8b949e; padding:0.4rem 0;">Sin staff (Director / Coordinadores) registrado.</div>'}
            </div>`;
        };

        // ── Subtarjeta (nivel 2): subcategoría A/B/C ─────────────────
        const _subcategoryCardHtml = (catId, subId, users, hasAny) => {
            const dot = hasAny
                ? `<span class="sa-badge" style="background:rgba(63,185,80,0.18); color:#3fb950;">${users.length}</span>`
                : `<span style="font-size:0.7rem; color:#6e7681;">vacía</span>`;
            const body = hasAny
                ? _userRowHeaderHtml() + users.map(_userRowHtml).join('')
                : '<div style="font-size:0.75rem; color:#6e7681; padding:0.5rem 0.6rem;">Sin usuarios en esta subcategoría.</div>';
            return `
                <div class="sa-card" style="margin-bottom:0.5rem; padding:0.6rem 0.7rem;
                            border-color:rgba(255,255,255,0.08);">
                    <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')">
                        <div class="sa-card-title" style="font-size:0.82rem;">
                            <span class="sa-chevron">▼</span>
                            <span>Subcategoría ${subId}</span>
                            ${dot}
                        </div>
                    </div>
                    <div class="sa-card-body">${body}</div>
                </div>`;
        };

        // ── Tarjeta (nivel 1): categoría ─────────────────────────────
        const _categoryCardHtml = (catDef, idx) => {
            const subMap = idx.byCatSub.get(catDef.id) || new Map();
            const catHas = idx.catHasAny.has(catDef.id);
            const subsHtml = CLUB_SUBCATS.map(subId => {
                const users = subMap.get(subId) || [];
                const subHas = idx.subHasAny.has(catDef.id + '|' + subId);
                return _subcategoryCardHtml(catDef.id, subId, users, subHas);
            }).join('');
            const dot = catHas
                ? '<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:#3fb950; box-shadow:0 0 6px rgba(63,185,80,0.7);"></span>'
                : '<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,0.12);"></span>';
            return `
                <div class="sa-card" style="margin-bottom:0.6rem; border-color:rgba(88,166,255,0.2);">
                    <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')">
                        <div class="sa-card-title">
                            <span class="sa-chevron">▼</span>
                            <span>${escapeHtml(catDef.label)}</span>
                            ${dot}
                        </div>
                    </div>
                    <div class="sa-card-body">${subsHtml}</div>
                </div>`;
        };

        // ── Render final: Staff + árbol de 7×3 ───────────────────────
        const _idx = _buildUserIndex(expandedUsers);
        const _treeHtml = CLUB_CATEGORIES.map(c => _categoryCardHtml(c, _idx)).join('');
        return `
        <div style="margin-bottom:1.5rem;">
            ${_staffBlockHtml(_idx.staff)}
            ${_treeHtml}
        </div>`;
    };

    // ── Modal principal ─────────────────────────────────────────────
    let modalHTML;
    try {
    modalHTML = SA_CSS + `
    <style>
      /* Fix minimo: selector de hijo directo para que el plegado funcione con
         tarjetas .sa-card anidadas (cada nivel controla solo su propio body/chevron).
         Sobrescribe la regla descendente compartida sin tocar los otros archivos. */
      .sa-card.expanded > .sa-card-body { display: block; }
      .sa-card.expanded > .sa-card-head .sa-chevron { transform: rotate(0deg); }
    </style>
    <div class="modal-content sa-modal">
      <div class="sa-topbar">
        <div>
          <div style="font-size:1.15rem;font-weight:700;">🏟️ ${escapeHtml(club.name)}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">Panel del Administrador del Club</div>
        </div>
        <div style="display:flex;gap:0.7rem;flex-wrap:wrap;">
          <!-- Mensajes internos (implementar.txt 2026-07-30): canales con el
               SuperAdmin y con el Director Deportivo del club. Se invoca AL
               PULSAR, no al cargar: comms/panel.js se carga después que este
               fichero en index.html y llamarlo en carga rompería por orden. -->
          <button onclick="if(typeof openClubAdminMessaging==='function') openClubAdminMessaging('director'); else if(typeof showToast==='function') showToast('⚠️ Mensajería no disponible', 3000);"
              style="padding:0.45rem 1rem;background:rgba(63,185,80,0.15);
                     border:1px solid rgba(63,185,80,0.45);border-radius:10px;
                     color:#3fb950;font-size:0.75rem;font-weight:700;cursor:pointer;">
              💬 Mensajes</button>
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
              const sub       = u._pendingSubcat   || u.requestedSubcategory;
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
                if (u.status === 'removed' || u.status === 'blocked') return false;
                // (a) Rol reenviado al SA dentro de allRoles (clubId de este club o vacío).
                const ar = u.allRoles || [];
                if (ar.some(r => r.status === 'pending_sa' && (r.clubId === clubId || !r.clubId))) return true;
                // (b) Usuario nuevo cuyo rol principal fue reenviado al SA (root status).
                if (u.status === 'pending_sa' && !u.isAuthorized && u.role !== 'club_admin'
                    && (u.clubId === clubId || !u.clubId)) return true;
                return false;
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
                  const pr = ar.find(r => r.status === 'pending_sa' && (r.clubId === clubId || !r.clubId));
                  const meta = window.ROLE_META || {};
                  const _role = pr?.role || u.role || u.requestedRole;
                  const label = (meta[_role] || {}).label || _role || 'Usuario';
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

    // Pila de navegación (js/core/nav-stack.js): RAÍZ del panel del Admin de
    // Club, registrada CON el clubId ya resuelto. Ese argumento es todo el
    // arreglo: sin él, refrescar el panel devolvía al SuperAdmin al selector
    // de clubes (ver los navReload() de más abajo).
    //
    // ⚠️ Aquí el registro va DESPUÉS de varios `await`, al revés que en las
    // demás pantallas, porque el clubId no se conoce antes. Es seguro
    // PORQUE ES UNA RAÍZ: si navBack la re-invoca, el flag de restauración ya
    // estará limpio y navRootScreen reseteará la pila a [openClubAdminPanel],
    // que es exactamente donde debe quedar. El invariante "registrar antes del
    // primer await" sólo es crítico para navScreen (una pantalla intermedia sí
    // se re-apilaría y dejaría el "Volver" en bucle).
    if (typeof navRootScreen === 'function') navRootScreen('openClubAdminPanel', clubId);

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
        setTimeout(() => { if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId); }, 1800);
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
                let sub = data.requestedSubcategory   || data.subcategory;

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

            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
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
                const sub = (roleInAll && roleInAll.subcategory) || data.requestedSubcategory;

                if (cat) {
                    updateData.category      = cat;
                    updateData.categoryLabel = cat;
                    if (sub) {
                        updateData.subcategory = sub;
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
            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
        } catch(e) {
            showToast('❌ Error al autorizar usuario: ' + e.message, 3000);
        }
    };

    // ── Rechazar solicitud de acceso ─────────────────────────────────
    // v474 · Rechazar es DOS limpiezas independientes —marcar el perfil y
    // retirar la(s) solicitud(es)— y antes iban encadenadas: si la primera
    // fallaba, la segunda ni se intentaba y la solicitud se quedaba colgada en
    // el panel para siempre (el caso reportado). Ahora se intentan LAS DOS y
    // solo se da error si no se consiguió ninguna.
    //
    // ⚠️ Los deleteDoc se ESPERAN uno a uno. Antes se lanzaban sin await
    // dentro de un forEach y el repintado posterior (navReload) llegaba antes
    // que los borrados: la solicitud recién rechazada volvía a aparecer.
    window.caRejectRequest = async (uid, email, isPlatformReq, userUid) => {
        if (!confirm('¿Rechazar solicitud de ' + email + '?')) return;

        // `uid` es el id de un doc de platform_requests o el de un usuario.
        const isPR = isPlatformReq === true || isPlatformReq === 'true'
            || (typeof uid === 'string' && (uid.startsWith('self_reg_') || uid.startsWith('fwd_')
                || uid.startsWith('ind_reg_') || uid.startsWith('user_req_')));
        const targetUid = isPR ? (userUid || '') : (uid || '');

        const fallos = [];
        let algoHecho = false;

        // 1. Marcar el perfil como rechazado (si sabemos de quién es).
        if (targetUid) {
            try {
                await updateDoc(doc(db, 'users', targetUid), {
                    isAuthorized: false, status: 'rejected',
                    rejectedAt: new Date().toISOString(), rejectedBy: me.uid
                });
                algoHecho = true;
            } catch (updErr) {
                const msg = updErr && updErr.message ? updErr.message : String(updErr);
                // Que el documento no exista NO es un fallo: hay solicitudes sin
                // perfil todavía. Solo hay que retirar la solicitud.
                if (!msg.includes('No document to update')) fallos.push('perfil: ' + msg);
            }
        }

        // 2. Retirar la solicitud pulsada y cualquier otra del mismo usuario,
        //    para que no reaparezca como solicitud fantasma.
        //    ⚠️ EL FILTRO POR clubId NO ES DECORATIVO. Firestore autoriza una
        //    consulta SIN leer los documentos: la regla tiene que quedar
        //    garantizada por los filtros de la consulta. Con `userUid` a secas,
        //    `resource.data.clubId` es desconocido y la consulta se deniega
        //    entera —"Missing or insufficient permissions" al LISTAR—, que es
        //    justo por lo que las solicitudes seguian sin retirarse. El listado
        //    principal del panel (linea ~180) ya filtra por clubId; esta no.
        const porBorrar = [];
        if (isPR && uid) porBorrar.push(uid);
        if (targetUid) {
            try {
                const prSnap = await getDocs(query(collection(db, 'platform_requests'),
                    where('clubId', '==', clubId), where('userUid', '==', targetUid)));
                prSnap.forEach(d => { if (porBorrar.indexOf(d.id) === -1) porBorrar.push(d.id); });
            } catch (qErr) {
                console.warn('[caRejectRequest] No se pudieron listar las solicitudes:', qErr.message);
            }
        }
        for (const prId of porBorrar) {
            try { await deleteDoc(doc(db, 'platform_requests', prId)); algoHecho = true; }
            catch (delErr) { fallos.push('solicitud ' + prId + ': ' + (delErr.message || delErr)); }
        }

        if (!algoHecho && fallos.length) {
            showToast('❌ Error al rechazar: ' + fallos[0], 4000);
            return;
        }
        if (fallos.length) console.warn('[caRejectRequest] Rechazo parcial:', fallos);

        showToast('❌ Solicitud de ' + email + ' rechazada.', 3000);
        // Refresco tras la acción. Antes iba SIN clubId, así que al
        // SuperAdmin le devolvía al selector de clubes.
        if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
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
            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
        } catch(e) { showToast('❌ Error al rechazar: ' + e.message, 3000); }
    };

    // ── Reenviar solicitud de registro al SuperAdmin ─────────────────
    // Helper: etiqueta legible de categoría
    function _catLabel(cat, sub) {
        if (!cat) return '';
        const labels = { prebenjamin:'Prebenjamín', benjamin:'Benjamín', alevin:'Alevín',
                         infantil:'Infantil', cadete:'Cadete', juvenil:'Juvenil', regional:'Regional',
                         regional_fem:'Regional FEM', futurefem:'FUTureFEM' };
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
            let userSubcatFwd = userData.requestedSubcategory   || userData.subcategory || null;
            let userCoordTypeFwd = userData.requestedCoordinatorType || userData.coordinatorType || null;
            const userSlotFwd = userData.requestedSlot     || null;
            // Buscar también en allRoles si no se encontró en el doc raíz
            if (!userCatFwd && userData.allRoles) {
                const roleEntry = userData.allRoles.find(r => r.role === role && (r.clubId || null) === (cid || null));
                if (roleEntry) {
                    userCatFwd    = roleEntry.category || roleEntry.categoryLabel || null;
                    userSubcatFwd = roleEntry.subcategory || null;
                    if (!userCoordTypeFwd) userCoordTypeFwd = roleEntry.coordinatorType || null;
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
                requestedSubcategory:   userSubcatFwd,
                requestedCoordinatorType: userCoordTypeFwd,
                requestedSlot:     userSlotFwd,
                userUid: uid,
                status: 'pending_sa',
                forwardedBy: window._cronosCurrentUser?.email || 'club_admin',
                forwardedAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            });
            
            // 3. Limpiar la solicitud original self_reg_* para que no quede colgada como pendiente
            //    Se buscan platform_requests de tipo pending_club_admin con el mismo usuario
            //    ⚠️ v474 · MISMO DEFECTO QUE EN caRejectRequest, y aqui lo tapaba un
            //    `catch(_) {}` mudo: sin el filtro por clubId la consulta se DENIEGA
            //    entera, asi que esta limpieza no borraba nada. Se ve en los datos de
            //    produccion: usuarios con su `fwd_*` ya aprobado y el `self_reg_*`
            //    original todavia en pending_club_admin, apareciendo como pendientes.
            //    Los borrados se ESPERAN, como en caRejectRequest.
            try {
                const { getDocs: _gds, collection: _col, query: _q, where: _w } = await saFS();
                const origPRSnap = await _gds(_q(_col(fDb, 'platform_requests'),
                    _w('clubId', '==', cid), _w('userUid', '==', uid)));
                const _viejas = [];
                origPRSnap.forEach(d => {
                    if (d.id !== fwdReqId && (d.data().status === 'pending_club_admin' || d.data().status === 'pending')) {
                        _viejas.push(d.id);
                    }
                });
                for (const _vid of _viejas) {
                    try { await fDeleteDoc(fDoc(fDb, 'platform_requests', _vid)); }
                    catch (e) { console.warn('[caForwardToSA] No se pudo retirar la solicitud original ' + _vid + ':', e.message); }
                }
            } catch(e) { console.warn('[caForwardToSA] No se pudieron listar las solicitudes originales:', e.message); }

            showToast('✅ Solicitud de ' + email + ' reenviada al SuperAdmin.', 4000);
            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
        } catch(e) {
            showToast('❌ Error al reenviar: ' + e.message, 3000);
        }
    };

    // ── Cambiar estado de un usuario (activo / bloqueado / baja) ──

    // ══════════════════════════════════════════════════════════════════
    // REVOCAR UNA CASILLA (rol + categoría) — NO se borra a la persona
    // ══════════════════════════════════════════════════════════════════
    // 🔑 LA REGLA DE NEGOCIO, tal y como la fijó el autor:
    //
    //    · El correo es de la PERSONA. La casilla (rol + categoría) es del
    //      CLUB. Una misma cuenta puede llevar varias casillas: un equipo de
    //      F11 y otro de F7, y además ser padre, coordinador o director.
    //    · Revocar una casilla ARCHIVA su trabajo en la categoría —para que
    //      lo herede quien venga— y la deja VACANTE. La cuenta no se toca.
    //    · SÓLO si era el ÚLTIMO rol que le quedaba en el club se elimina su
    //      cuenta de Auth y se libera su correo.
    //
    // ⚠️ Desde las filas de equipo YA NO SE BORRAN CUENTAS ENTERAS. Eso lo
    //    gestiona el SuperAdministrador a nivel de club al cerrar temporada.
    //    Aquí sólo se vacían casillas; el borrado, cuando toca, es una
    //    CONSECUENCIA de haber revocado la última, no una acción aparte.
    //
    // 🔑 EL ORDEN NO ES CASUAL:
    //   1. Revocar primero: marca el rol y —lo que la Function no hace—
    //      LIBERA LA PLAZA del club decrementando usedSlots.
    //   2. Después la Function: archiva y verifica; y sólo si no le queda
    //      ningún rol, borra la cuenta.
    window.caRevocarCasilla = async (userId, userEmail, cid, targetRole) => {
        // ── Cuántos roles le quedarían: decide el aviso y la confirmación ──
        // Se lee del documento, no de lo pintado en la fila: la fila puede
        // llevar minutos en pantalla.
        let quedanOtros = null;   // null = no se ha podido saber
        try {
            const _s = await getDoc(doc(db, 'users', userId));
            if (_s.exists()) {
                const _d = _s.data() || {};
                const _todos = Array.isArray(_d.allRoles) ? _d.allRoles : [];
                const _vivo = (r) => r && r.status !== 'removed' &&
                                     (r.isAuthorized === true || r.authorized === true);
                // El que se está revocando ahora todavía consta como vivo.
                quedanOtros = _todos.filter((r) => _vivo(r) &&
                    !(r.role === targetRole && (!r.clubId || String(r.clubId) === String(cid || '')))).length;
            }
        } catch (_) { /* si falla, se avisa en genérico y decide el servidor */ }

        const _rotulo = { user: 'Entrenador', parent: 'Padre/Madre/Tutor', director: 'Director Deportivo',
                          coordinator: 'Coordinador', club_admin: 'Administrador' }[targetRole] || targetRole;
        const esUltimo = (quedanOtros === 0);

        if (!confirm(
            '➖ QUITAR LA CASILLA DE "' + _rotulo + '" A ' + userEmail + '\n\n' +
            'QUÉ PASA CON EL TRABAJO:\n' +
            '• Se archiva en la categoría, para el siguiente entrenador\n' +
            '• Informes, convocatorias y entrenamientos siguen en el club\n\n' +
            'QUÉ PASA CON LA CASILLA:\n' +
            '• Queda VACANTE, lista para otra persona\n\n' +
            'QUÉ PASA CON SU CUENTA:\n' +
            (esUltimo
                ? '• ⚠️ Es el ÚLTIMO rol que le queda en el club:\n' +
                  '  su cuenta se ELIMINARÁ y su correo quedará LIBRE.\n' +
                  '  ESTO NO SE PUEDE DESHACER.\n'
                : (quedanOtros === null
                    ? '• Se conservará si le quedan otros roles\n'
                    : '• Sigue intacta: conserva ' + quedanOtros + ' rol(es) más\n')) +
            '\n¿Continuar?'
        )) return;

        // ── Segunda confirmación SÓLO cuando de verdad se va a borrar ──
        // 🔑 Pedirla siempre acabaría en aceptar sin leer; pedirla justo
        //    cuando la acción es irreversible es lo que la hace valer.
        if (esUltimo) {
            const tecleado = prompt(
                'Es su último rol: se eliminará la cuenta y se liberará el correo.\n\n' +
                'Escribe el correo completo para confirmarlo:\n' + userEmail
            );
            if (tecleado === null) return;
            if (String(tecleado).trim().toLowerCase() !== String(userEmail).trim().toLowerCase()) {
                alert('El correo no coincide. No se ha hecho nada.');
                return;
            }
        }

        try {
            if (typeof showToast === 'function') showToast('⏳ Archivando el trabajo del equipo…', 4000);

            // 1. Revocar esa casilla: marca el rol y libera la plaza.
            await window.caSetUserStatus(userId, userEmail, 'removed', cid, targetRole, true);

            // 2. Archivar (y borrar la cuenta sólo si era el último rol).
            if (typeof httpsCallable !== 'function' || !fa || !fa.functions) {
                alert('⚠️ La casilla ha quedado vacante, pero no se pudo contactar con el ' +
                      'servidor para archivar el trabajo. No se ha borrado nada: reinténtalo.');
                return;
            }
            const res = await httpsCallable(fa.functions, 'archiveAndDeleteCoach')({
                uid: userId, email: userEmail, clubId: cid, role: targetRole || null
            });
            const d = (res && res.data) || {};
            alert('✅ Casilla de "' + _rotulo + '" liberada.\n\n' +
                  'Archivado en la categoría: ' + (d.documentosArchivados || 0) + ' documento(s), ' +
                  (d.clavesArchivadas || 0) + ' dato(s).\n' +
                  (d.cuentaBorrada
                      ? 'Era su último rol: cuenta eliminada y correo LIBERADO.'
                      : 'Su cuenta sigue activa con ' + ((d.rolesRestantes || []).length) + ' rol(es): ' +
                        ((d.rolesRestantes || []).join(', ') || '—')) +
                  '\n\nEl histórico del equipo sigue en el Panel del Club.');
            // Mismo patrón que el resto del panel: si nav-stack no ha cargado,
            // se repinta a mano CON el clubId.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(cid);
        } catch (e) {
            const msg = (e && e.message) || String(e);
            alert('⚠️ No se ha completado.\n\n' + msg + '\n\n' +
                  'Si el mensaje dice que el archivado no se pudo verificar, ' +
                  'NO se ha borrado la cuenta ni se ha perdido ningún dato: vuelve a intentarlo.');
            console.error('[caRevocarCasilla]', e);
        }
    };

    // ── ASIGNAR / MOVER DE EQUIPO (Categoría/Subcategoría) ───────────
    //
    // Esta es la palanca de MOVILIDAD: cambiar aquí la categoría de un
    // entrenador le retira la vista de su equipo anterior y le da la del
    // nuevo, con TODO el histórico que ese equipo acumule, lo firmara quien
    // lo firmara. No hay que mover ni copiar un solo informe: los informes
    // se consultan por equipo (ver cronosTeamId en js/core/utils.js).
    window.caEditUserCategory = async function(uid, email, currentCat, currentSub) {
        let newCat = prompt('Categoría (ej: Infantil, Cadete, Senior...):', currentCat);
        if (newCat === null) return;
        let newSub = prompt('Subcategoría / Grupo (ej: A, B, Segunda...):', currentSub);
        if (newSub === null) return;

        // Que el administrador vea la consecuencia ANTES de aceptar: esto no
        // es editar una etiqueta, es mover el acceso de una persona.
        var _antes = (currentCat || '—') + (currentSub ? ' / ' + currentSub : '');
        var _despues = (newCat || '—') + (newSub ? ' / ' + newSub : '');
        if (_antes !== _despues) {
            if (!confirm('Mover a ' + email + ' de equipo:\n\n' +
                         '   ' + _antes + '   →   ' + _despues + '\n\n' +
                         'Pasará a ver el histórico de ' + _despues + ' (informes,\n' +
                         'convocatorias y entrenamientos, los firmara quien los firmara)\n' +
                         'y dejará de ver los de ' + _antes + '.\n\n' +
                         'No se mueve ni se borra ningún dato: cada informe se queda\n' +
                         'en el equipo donde se generó.\n\n' +
                         '¿Confirmar el cambio de equipo?')) return;
        }

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
            //
            // ⚠️ LA PUNTERÍA ERA DEMASIADO ANCHA. La condición era
            //        r.role === data.role || r.clubId === clubId
            //    con un O: bastaba que el rol coincidiera con el rol RAÍZ para
            //    reetiquetar entradas de OTROS clubes, y bastaba compartir club
            //    para reetiquetar OTROS roles. A quien tuviera dos roles en el
            //    mismo club (p. ej. entrenador y padre) se le cambiaba la
            //    categoría de los dos de una vez.
            //    Ahora se exige club Y rol, y sólo se tocan los roles ACTIVOS:
            //    un rol ya revocado conserva la categoría que tenía, que es su
            //    valor histórico.
            if (data.allRoles) {
                updates.allRoles = data.allRoles.map(function(r) {
                    var mismoClub = String(r.clubId || '') === String(clubId || '');
                    var mismoRol  = r.role === data.role;
                    var activo    = r.status !== 'removed' && r.isAuthorized !== false;
                    if (mismoClub && mismoRol && activo) {
                        return Object.assign({}, r, { category: newCat, subcategory: newSub });
                    }
                    return r;
                });
            }

            await updateDoc(userRef, updates);
            // ⚠️ El cambio NO es inmediato para el interesado: su categoría se
            //    leyó al iniciar sesión (window._cronosCurrentUser), así que
            //    verá el equipo nuevo la próxima vez que entre.
            if (typeof showToast === 'function') showToast('✅ Equipo actualizado. Lo verá al volver a entrar.', 4000);
            
            // Refrescar panel tras 1 segundo (antes SIN clubId: al SuperAdmin
            // le devolvía al selector de clubes en vez de al club editado).
            setTimeout(() => { if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId); }, 1000);
        } catch(e) {
            console.error('[caEditUserCategory] Error:', e);
            alert('Error: ' + e.message);
        }
    };

    // `sinConfirmar` lo usa caRevocarCasilla, que ya ha pedido su propia
    // doble confirmación: encadenar aquí un tercer diálogo sólo consigue que
    // se acepte sin leer.
    window.caSetUserStatus = async (userId, userEmail, newStatus, cid, targetRole, sinConfirmar) => {
        // 'removed' ya NO es "dar de baja definitivamente": es revocar el
        // acceso. El texto lo dice, porque de él depende que el administrador
        // entienda qué está aceptando.
        const labels = { active:'activar', blocked:'bloquear', removed:'dar de baja (revocar el acceso de)' };
        // Si se especifica targetRole, la "baja" es de UN solo rol (no del usuario entero).
        if (sinConfirmar) {
            /* el llamante ya ha confirmado */
        } else if (newStatus === 'removed' && targetRole) {
            if (!confirm('¿Quitar el rol "' + targetRole + '" a ' + userEmail + '?\n\n' +
                         'Se conservará su cuenta y los demás roles activos.')) return;
        } else if (newStatus === 'removed') {
            if (!confirm('¿Dar de baja a ' + userEmail + '?\n\n' +
                         'Se le retira el acceso y se libera su plaza.\n' +
                         'Su cuenta y el histórico del equipo se conservan.')) return;
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

                // ── Determinar alcance de la REVOCACIÓN (multi-rol) ─────────
                // Si se especifica targetRole y el usuario tiene OTROS roles
                // activos, solo se revoca ESE rol; los demás siguen vivos.
                // Sin targetRole = se revoca su acceso al club entero.
                //
                // ⚠️ LA PUNTERÍA ERA MÁS ESTRECHA QUE LA DEL LISTADO. Exigía
                //    `String(r.clubId||'') === String(cid||'')`, pero el panel
                //    pinta los roles con `(r.clubId === clubId || !r.clubId)`
                //    (líneas 263/280/298): una entrada de allRoles SIN clubId
                //    —las hay, las crea auth.js con `clubId: data.clubId || null`—
                //    SE VE en el listado y NO casaba aquí. Resultado: cero roles
                //    seleccionados, cero cambios escritos... y toast de éxito.
                //    Es una de las causas del "parece que funciona y no persiste".
                var _esDeEsteClub = function(r) {
                    var rc = String(r.clubId || '');
                    return rc === String(cid || '') || rc === '';
                };
                var rolesRemovidos = allRoles.filter(function(r) {
                    if (!_esDeEsteClub(r)) return false;
                    if (targetRole && r.role !== targetRole) return false;
                    return true;
                });
                var rolesRestantes = allRoles.filter(function(r) {
                    if (!_esDeEsteClub(r)) return true;
                    if (targetRole && r.role !== targetRole) return true;
                    return false;
                });
                // Sólo cuentan como "restantes" los que siguen VIVOS: un rol ya
                // revocado antes no puede sostener la cuenta abierta.
                var rolesRestantesVivos = rolesRestantes.filter(function(r) {
                    return r.status !== 'removed' && r.isAuthorized !== false;
                });
                var revocaTodosLosRoles = rolesRestantesVivos.length === 0;

                // ⚠️⚠️ EL ROL DE LA RAÍZ MANDA SOBRE allRoles.
                //    users/{uid} tiene, además del array, un rol de RAÍZ
                //    (`role` + `clubId` + `isAuthorized`). Si se revoca ese
                //    mismo rol y la raíz se queda con isAuthorized:true,
                //    auth.js lo RESUCITA en el siguiente inicio de sesión
                //    (ver el bloque "Sincronizar roles autorizados entre raíz y
                //    allRoles"): reescribe la entrada a isAuthorized:true /
                //    status:'active' y la persiste. Ese era el fallo reportado:
                //    el entrenador reaparecía en su misma categoría al recargar.
                //    Por eso, si lo revocado incluye el rol raíz de este club,
                //    la raíz TIENE que quedar desautorizada.
                var _raizEsDeEsteClub = String(docData.clubId || '') === String(cid || '')
                                        || String(docData.clubId || '') === '';
                var revocaRolRaiz = _raizEsDeEsteClub && !!docData.role &&
                    rolesRemovidos.some(function(r) { return r.role === docData.role; });
                // Sin allRoles utilizable, la baja recae entera sobre la raíz.
                if (allRoles.length === 0) revocaRolRaiz = true;

                // ══════════════════════════════════════════════════════════
                // 🔑 allRoles: SE MARCA, NO SE QUITA
                // ══════════════════════════════════════════════════════════
                // Antes el rol revocado se BORRABA del array. Se conserva la
                // entrada con status:'removed' porque:
                //
                //  1. Es la convención que el backend YA entiende: el trigger
                //     autoSetClaimsOnApproval (functions/index.js) elige el
                //     clubId saltándose los roles con
                //     `isAuthorized === false || status === 'removed'`. Marcar
                //     produce el mismo efecto que borrar de cara a los claims,
                //     y además deja rastro.
                //  2. Readmitir a alguien es volver a poner status:'active',
                //     sin reconstruir un rol desde cero.
                //  3. El histórico de quién entrenó qué categoría y cuándo
                //     queda EN el documento, no solo en deletion_requests.
                var marcaRevocado = function(r) {
                    return Object.assign({}, r, {
                        status: 'removed',
                        isAuthorized: false,
                        // ⚠️ `authorized` (sin el "is") es un alias heredado que
                        //    el listado TAMBIÉN acepta como válido:
                        //    `r.isAuthorized === true || r.authorized === true`.
                        //    Marcar solo isAuthorized dejaba visible cualquier
                        //    entrada antigua que llevara el alias a true.
                        authorized: false,
                        removedAt: new Date().toISOString(),
                        removedBy: me.uid,
                        removedReason: (reason || '').trim() || 'Sin motivo indicado'
                    });
                };
                // El array COMPLETO que se va a guardar: los revocados marcados
                // y los demás intactos. Se respeta el orden original.
                var allRolesTrasRevocar = allRoles.map(function(r) {
                    var esRevocado = rolesRemovidos.some(function(x) {
                        return x.role === r.role &&
                               String(x.clubId || '') === String(r.clubId || '');
                    });
                    return esRevocado ? marcaRevocado(r) : r;
                });

                // ══════════════════════════════════════════════════════════
                // REVOCACIÓN — un solo camino, sin borrar NADA
                // ══════════════════════════════════════════════════════════
                // Antes había dos caminos: "quitar un rol" (conservador) y
                // "borrado total", que eliminaba los documentos de users, los
                // cronos_player_links y la cuenta de Firebase Auth.
                //
                // 🔑 EL BORRADO TOTAL SE RETIRA DE AQUÍ. El dato del club
                //    (informes, convocatorias, entrenamientos) pertenece al
                //    EQUIPO, no a la cuenta que lo generó, y ya vivía en
                //    colecciones propias indexadas por clubId — nunca se
                //    borraba en cascada. Lo que sí destruía el borrado total
                //    era el acceso al histórico:
                //
                //    ⚠️⚠️ users/{uid}/cronos_data/main es una SUBCOLECCIÓN.
                //    Firestore NO borra subcolecciones al borrar el documento
                //    padre: la plantilla quedaba viva pero HUÉRFANA, y su regla
                //    (`request.auth.uid == userId`, sin rama de SuperAdmin) la
                //    dejaba ilegible para todo el mundo, incluido el SA. Al
                //    re-registrarse, el correo estrena UID y apunta a un
                //    documento vacío. Se perdía sin dar un solo error.
                //
                //    ⚠️ Y si deleteAuthUser fallaba, los datos ya estaban
                //    borrados pero el correo seguía ocupado en Auth: el
                //    re-registro caía en 'auth/email-already-in-use' y exigía
                //    la contraseña ANTIGUA. Quien no la recordara se quedaba
                //    fuera para siempre.
                //
                // Ahora la baja es exactamente lo que dice ser: se le retira el
                // acceso. La cuenta, su UID y todo lo que firmó siguen en pie,
                // así que el entrenador que herede la categoría encuentra el
                // histórico intacto y readmitir a alguien es reactivar un rol.

                // 1. Liberar las plazas del club de CADA rol revocado. La
                //    plaza sí se libera: la persona deja de ocuparla.
                for (var rIdx = 0; rIdx < rolesRemovidos.length; rIdx++) {
                    var cidRol = rolesRemovidos[rIdx].clubId || cid;
                    if (!cidRol) continue;
                    try {
                        var csR = await getDoc(doc(db, 'clubs', cidRol));
                        if (csR.exists()) {
                            var rkR  = _slotKey(rolesRemovidos[rIdx].role);
                            var subR = rkR.split('.')[1];
                            var curR = ((csR.data().usedSlots || {})[subR]) || 1;
                            var updR = {}; updR[rkR] = Math.max(0, curR - 1);
                            await updateDoc(doc(db, 'clubs', cidRol), updR);
                        }
                    } catch (_) {}
                }

                // 2. Marcar los roles revocados en el documento PRIMARIO.
                //
                // ⚠️ SOLO SE ESCRIBEN CAMPOS DE isMembershipDecision().
                //    Las reglas acotan al administrador de club con un
                //    hasOnly([...]) (firestore.rules): 'isAuthorized',
                //    'status', 'allRoles', 'updatedAt' y poco más. Colar aquí
                //    un campo de raíz fuera de esa lista —'removedAt' suelto,
                //    por ejemplo— NO se ignora: hace fallar la actualización
                //    ENTERA con "Missing or insufficient permissions". El
                //    detalle de la baja va DENTRO de allRoles[] (que es un
                //    campo permitido) y en deletion_requests.
                // ⚠️ SI NO SE HA SELECCIONADO NADA, NO SE ANUNCIA UNA BAJA.
                //    Cuando el filtro no casaba ningún rol, esto seguía adelante,
                //    escribía un allRoles idéntico al que ya había y mostraba el
                //    toast de éxito: el administrador daba por hecha una baja que
                //    no se había producido. Ahora se dice, y no se toca nada.
                if (rolesRemovidos.length === 0 && !revocaRolRaiz && !revocaTodosLosRoles) {
                    showToast('⚠️ No se encontró ningún rol activo de ' + userEmail +
                              ' en este club' + (targetRole ? ' con el rol "' + targetRole + '"' : '') +
                              '. No se ha cambiado nada.', 6000);
                    return;
                }

                var revocaRaiz = {
                    allRoles: allRolesTrasRevocar,
                    updatedAt: new Date().toISOString()
                };
                if (revocaTodosLosRoles || revocaRolRaiz) {
                    // Se cierra la puerta. isAuthorized:false es lo que de
                    // verdad revoca, porque userDocClubId() de las reglas lo
                    // exige para conceder acceso a los datos del club.
                    //
                    // ⚠️ También cuando `revocaRolRaiz`, aunque le queden otros
                    //    roles: dejar la raíz autorizada con el rol revocado es
                    //    lo que hacía que auth.js lo resucitara al entrar. No se
                    //    puede "mover" la raíz al rol que le queda porque las
                    //    reglas prohíben al administrador escribir 'role' y
                    //    'clubId' (isMembershipDecision). Si conserva otros
                    //    roles, se le reactiva desde el panel y auth.js
                    //    reconstruye la raíz en el siguiente inicio de sesión.
                    revocaRaiz.isAuthorized = false;
                    revocaRaiz.status = 'removed';
                }
                var falloRevocacion = null;
                try {
                    await updateDoc(doc(db, 'users', realUid), revocaRaiz);
                } catch (revErr) {
                    falloRevocacion = revErr;
                }

                // 3. Marcar también los documentos SECUNDARIOS (uid_rol_club).
                //    Antes se borraban; ahora se desautorizan, que es lo que
                //    corta el acceso sin perder el rastro del rol.
                for (var rIdx2 = 0; rIdx2 < rolesRemovidos.length; rIdx2++) {
                    var secOne = realUid + '_' + rolesRemovidos[rIdx2].role +
                                 '_' + (rolesRemovidos[rIdx2].clubId || cid || 'global');
                    if (secOne === realUid) continue;
                    try {
                        await updateDoc(doc(db, 'users', secOne), {
                            isAuthorized: false,
                            status: 'removed',
                            updatedAt: new Date().toISOString()
                        });
                    } catch (_) { /* puede no existir: no es un error */ }
                }

                // 4. Los cronos_player_links NO se tocan.
                //    Antes se borraban al dar de baja a un padre. Ese enlace es
                //    la relación padre↔jugador del CLUB, no una pertenencia de
                //    la cuenta: borrarlo obligaba a reconstruir a mano los
                //    contactos del equipo. Con isAuthorized:false el padre ya
                //    no puede leer nada (isLinkClubMember exige autorización),
                //    así que conservarlos no abre ningún acceso.

                // 5. Dejar constancia. Aquí sí caben los campos libres: la
                //    colección deletion_requests admite `create` de cualquier
                //    autenticado y no la acota isMembershipDecision().
                await setDoc(doc(db, 'deletion_requests', realUid + '_revoke_' + Date.now()), {
                    userId: realUid, userEmail: realEmail, clubId: cid,
                    requestedBy: me.uid, requestedByEmail: me.email,
                    reason: (reason || '').trim() || 'Sin motivo indicado',
                    action: 'revoke',
                    rolesRevoked: rolesRemovidos.map(function(r) { return r.role; }),
                    remainingRoles: rolesRestantes.map(function(r) { return r.role; }),
                    accountDeleted: false,
                    dataDeleted: false,
                    status: 'completed',
                    resolvedAt: new Date().toISOString(),
                    createdAt: new Date().toISOString()
                }).catch(function() {});

                // ⚠️ El fallo se REPORTA. Antes los updateDoc iban en
                //    try/catch mudos y un error de permisos dejaba al usuario
                //    con el acceso intacto mientras el panel cantaba éxito.
                if (falloRevocacion) {
                    showToast('❌ No se pudo revocar el acceso de ' + userEmail +
                              ': ' + (falloRevocacion.message || falloRevocacion), 6000);
                    return;
                }

                if (revocaTodosLosRoles) {
                    showToast('🔒 Acceso de ' + userEmail + ' revocado. Sus datos y el ' +
                              'histórico del equipo se conservan íntegros.', 4500);
                } else {
                    showToast('➖ Rol/Roles de ' + userEmail + ' revocados. Conserva sus otros roles.', 4000);
                }
                if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
                return;

                // ── (retirado) CAMINO B: borrado TOTAL del usuario ──────────
                // Aquí vivía el borrado de los documentos de users, de los
                // cronos_player_links y de la cuenta de Firebase Auth. Se
                // retira entero: la revocación de arriba ya cumple la baja y
                // no destruye el acceso al histórico. Ver el bloque
                // "REVOCACIÓN — un solo camino, sin borrar NADA".
                //
                // El derecho de supresión (RGPD) NO desaparece: sigue
                // atendiéndose desde el Panel del SuperAdmin, que es donde
                // debe estar una operación irreversible sobre datos ajenos.
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

            // ── PROBLEMA 2: propagar custom claim clubId al activar ──────────
            // El entrenador (rol 'user') y demás miembros tienen clubId en su
            // documento Firestore, pero su token JWT no lo lleva, así que las
            // reglas basadas en sameClub()/sameClubAsDoc() (informes, vínculos,
            // hilos de staff, partidos en vivo) fallaban con permission-denied.
            // Al activarlo, el club_admin invoca setCustomClaims para grabar
            // {role, clubId} en el token. La Cloud Function valida que el admin
            // solo afecte a miembros NO privilegiados de SU propio club.
            // El token del usuario activado se refrescará en su próximo login o
            // ciclo de refresco (claimsSetAt fuerza la regeneración del ID token).
            if (isActive && fa && fa.functions && cid) {
                try {
                    var setClaimsFn = httpsCallable(fa.functions, 'setCustomClaims');
                    await setClaimsFn({ uid: userId, role: role, clubId: cid });
                } catch (claimErr) {
                    // No bloquea la activación: las reglas tienen fallback
                    // userDocClubId() que lee users/{uid}.clubId aunque el claim
                    // no llegue a propagarse.
                    console.warn('[caSetUserStatus] setCustomClaims falló (continúa con fallback de reglas):',
                        claimErr && claimErr.message);
                }
            }

            showToast(isActive ? '\u2705 Usuario activado' : '\uD83D\uDD12 Usuario bloqueado', 3000);
            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
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

// ── Verificar acceso al club: definición única en js/core/app-init.js ─
//    (esta copia se eliminó: eclipsaba a la versión completa que sí
//     carga cl.timerThresholds para el semáforo de getTimerColor).

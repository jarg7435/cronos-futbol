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
    window.ROLE_META = {
        superadmin:  { label:'Superadministrador', icon:'👑', color:'#ffd700' },
        admin:       { label:'Administrador',       icon:'⚙️',  color:'#58a6ff' },
        club_admin:  { label:'Admin de Club',       icon:'🏟️', color:'#58a6ff' },
        director:    { label:'Director Deportivo',  icon:'📋', color:'#f0883e' },
        coordinator: { label:'Coordinador',         icon:'🎯', color:'#d2a8ff' },
        user:        { label:'Entrenador',          icon:'⚽', color:'#3fb950' },
        parent:      { label:'Padre / Madre / Tutor', icon:'👨‍👩‍👧', color:'#79c0ff' },
        individual:  { label:'Entrenador Individual', icon:'👤', color:'#79c0ff' },
    };
}

async function openClubAdminPanel(preClubId = null) {
    const me         = window._cronosCurrentUser;
    const activeRole = me._activeRole || me.role;
    const isSA       = me.role === 'superadmin' || me.role === 'admin';

    if (!me || (!isSA && activeRole !== 'club_admin')) {
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
                <p style="color:#ff5858;">Error de conexión: ${typeof escapeHtml==='function'?escapeHtml(err.message):err.message}</p>
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
                🏟️ <strong>${typeof escapeHtml==='function'?escapeHtml(c.name):c.name}</strong>
                <span style="font-size:0.72rem;color:var(--text-muted);display:block;margin-top:0.2rem;">
                  ${typeof escapeHtml==='function'?escapeHtml(c.adminEmail||'Sin admin'):(c.adminEmail||'Sin admin')} · Plan: ${typeof escapeHtml==='function'?escapeHtml(c.plan||'free'):(c.plan||'free')}
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

    let clubSnap, usersSnap, users = [], features = {};
    try {
        [clubSnap, usersSnap] = await Promise.all([
            getDoc(doc(db, 'clubs', clubId)),
            getDocs(query(collection(db, 'users'), where('clubId', '==', clubId)))
        ]);
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
                    <p style="color:#8b949e;font-size:0.78rem;margin-top:0.5rem;">${typeof escapeHtml==='function'?escapeHtml(queryErr.message):queryErr.message}</p>
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
    // Deduplicate: keep only one entry per uid (prefer primary doc)
    const seenUids = new Set();
    users = users.filter(u => {
        const realUid = u.uid || u._id;
        // Keep primary docs (where _id == uid), and secondary docs only if no primary exists
        if (u._id === realUid) { seenUids.add(realUid); return true; }
        if (seenUids.has(realUid)) return false;
        seenUids.add(realUid);
        return true;
    });
    features = club.features || {};

    // ── Helper: info de slots de un rol ─────────────────────────────
    const slotOf = (role) => {
        const max  = role === 'director'     ? (club.slots?.directors    ?? -1)
                   : role === 'coordinator'  ? (club.slots?.coordinators ?? -1)
                   : role === 'parent'       ? (club.slots?.parents      ?? -1)
                   :                           (club.slots?.users        ?? -1);
        const used = users.filter(u => u.role === role && u.isAuthorized !== false && u.status !== 'removed').length;
        return { max, used, full: max !== -1 && used >= max, unlimited: max === -1 };
    };

    // ── Pendientes de aprobación (auto-registro) ─────────────────────
    // Paso 1: Solicitudes de auto-registro pendientes de aprobación SA (status='pending')
    const pendingAutoReg = users.filter(u =>
        u.status === 'pending' && u.requestedRole !== 'club_admin'
    );
    // Paso 1b: Self-registrations pending Club Admin forwarding to SA
    const pendingClubAdmin = users.filter(u =>
        u.status === 'pending_club_admin'
    );
    // Paso 1c: Multi-role users with pending roles in allRoles
    // These are users whose main doc status is active, but have roles
    // in allRoles with isAuthorized=false
    const pendingRolesInAllRoles = [];
    users.forEach(u => {
        // Skip if already in pendingClubAdmin (avoid duplicates)
        if (u.status === 'pending_club_admin' || u.status === 'pending' || u.status === 'pending_sa') return;
        // Skip secondary docs (doc ID format: uid_role_clubId)
        if (u.uid && u._id !== u.uid) return;
        const ar = u.allRoles || [];
        ar.forEach(roleEntry => {
            if (!roleEntry.isAuthorized && roleEntry.role) {
                // Accept both: explicit status='pending_club_admin' OR no status field at all
                // (new role entries from multi-reg may not have status field)
                const isPending = (roleEntry.status === 'pending_club_admin') || (!roleEntry.status && !roleEntry.isAuthorized);
                if (isPending) {
                    pendingRolesInAllRoles.push({
                        _id: u._id,
                        email: u.email,
                        role: roleEntry.role,
                        clubId: roleEntry.clubId || u.clubId,
                        clubName: roleEntry.clubName || u.clubName,
                        pendingRole: roleEntry.role,
                        pendingRoleLabel: (ROLE_META[roleEntry.role] || {}).label || roleEntry.role,
                        pendingRoleIcon: (ROLE_META[roleEntry.role] || {}).icon || '👤',
                    });
                }
            }
        });
    });
    // Paso 2: Aprobados por SA, pendientes de confirmación por club admin (status='pending_club')
    const pendingClubApproval = users.filter(u =>
        u.status === 'pending_club' && u.approvedBySA === true
    );
    // Compat: mantener pendingMembers para el resto del código (direct pending only)
    const pendingMembers = [...pendingAutoReg];

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

        const _escA = typeof escapeAttr==='function'?escapeAttr:function(s){return s;};
        const _escH = typeof escapeHtml==='function'?escapeHtml:function(s){return s;};
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
            </div>
            <div style="display:flex;gap:0.3rem;flex-shrink:0;align-items:center;">
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
            </div>
        </div>`;
    };

    // ── Render de sección acordeón por rol ───────────────────────────
    const roleSections = [
        { role: 'director',    label: '📋 Directores Deportivos', color: '#f0883e',  slotKey: 'directors'    },
        { role: 'coordinator', label: '🎯 Coordinadores',         color: '#d2a8ff',  slotKey: 'coordinators' },
        { role: 'user',        label: '⚽ Entrenadores',           color: '#3fb950',  slotKey: 'users'        },
        { role: 'parent',      label: '👨‍👩‍👧 Padres / Madres / Tutores', color: '#79c0ff', slotKey: 'parents' },
    ];

    const accordionSections = roleSections.map(({ role, label, color, slotKey }) => {
        const si          = slotOf(role);
        const roleUsers   = users.filter(u => u.role === role && u.status !== 'removed');
        const slotsLabel  = si.unlimited ? `${si.used} · ∞` : `${si.used}/${si.max}`;
        const slotsColor  = si.full ? '#ff5858' : '#3fb950';
        const sectionId   = `ca-section-${role}-${clubId}`;

        return `
        <div class="sa-card" id="${sectionId}" style="margin-bottom:0.6rem; border-color:${color}33;">
          <div class="sa-card-head" onclick="document.getElementById('${sectionId}').classList.toggle('expanded')">
            <div class="sa-card-title">
              <span class="sa-chevron">▼</span>
              <span style="color:${color};">${label}</span>
              <span class="sa-badge" style="background:${color}22;color:${color};">${slotsLabel}</span>
              ${si.full ? '<span class="sa-badge" style="background:#ff585822;color:#ff5858;">Cuota llena</span>' : ''}
            </div>
            <button class="sa-btn"
                onclick="event.stopPropagation(); caRequestQuota('${clubId}','${role}','${label.replace(/'/g,"\\'")}','${slotKey}')"
                style="font-size:0.71rem;color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                📩 Solicitar ampliación</button>
          </div>
          <div class="sa-card-body">
            ${roleUsers.length
                ? roleUsers.map(u => userRow(u)).join('')
                : `<p style="color:var(--text-muted);font-size:0.78rem;margin:0.3rem 0;">Sin ${label.split(' ')[1]?.toLowerCase() || 'usuarios'} registrados.</p>`
            }
          </div>
        </div>`;
    }).join('');

    // ── Modal principal ─────────────────────────────────────────────
    let modalHTML;
    try {
    modalHTML = SA_CSS + `
    <div class="modal-content sa-modal">
      <div class="sa-topbar">
        <div>
          <div style="font-size:1.15rem;font-weight:700;">🏟️ ${typeof escapeHtml==='function'?escapeHtml(club.name):club.name}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">Panel del Administrador del Club</div>
        </div>
        <div style="display:flex;gap:0.7rem;flex-wrap:wrap;">
          <button onclick="caNotifySuperAdmin('${clubId}')"
              style="padding:0.45rem 1rem;background:rgba(88,166,255,0.15);
                     border:1px solid rgba(88,166,255,0.4);border-radius:10px;
                     color:var(--primary);font-size:0.75rem;font-weight:700;cursor:pointer;">
              📡 Transmitir al SuperAdmin</button>
          <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
              style="padding:0.45rem 1rem;background:rgba(255,215,0,0.1);
                     border:1px solid rgba(255,215,0,0.3);border-radius:10px;
                     color:#ffd700;font-size:0.75rem;font-weight:700;cursor:pointer;">
              ⇄ Cambiar Rol</button>
          <button onclick="logoutUser()"
              style="padding:0.45rem 1rem;background:rgba(255,88,88,0.15);
                     border:1px solid rgba(255,88,88,0.4);border-radius:10px;
                     color:#ff5858;font-size:0.75rem;font-weight:700;cursor:pointer;">
              🚪 SALIR</button>
        </div>
      </div>

      <div class="sa-body">

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
              const escEmail = (typeof escapeAttr==='function'?escapeAttr(u.email||''):u.email||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
              const escId    = u._id.replace(/'/g,"\\'");
              return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">' +
                '<div><div style="font-size:0.85rem;font-weight:600;">' + (typeof escapeHtml==='function'?escapeHtml(u.email):u.email) + '</div>' +
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
              const roleLabel = ROLE_META[u.role || u.requestedRole || 'user']?.label || 'Usuario';
              const roleIcon  = ROLE_META[u.role || u.requestedRole || 'user']?.icon || '👤';
              const escEmail = (typeof escapeAttr==='function'?escapeAttr(u.email||''):u.email||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
              const escId    = (u._id).replace(/'/g,"\\'");
              return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;">' +
                '<div><div style="font-size:0.85rem;font-weight:600;">' + (typeof escapeHtml==='function'?escapeHtml(u.email):u.email) + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">' + roleIcon + ' ' + roleLabel + '</div></div>' +
                '<div style="display:flex;gap:0.4rem;">' +
                '<button onclick="caForwardToSA(\'' + escId + '\',\'' + (u.role||u.requestedRole||'user') + '\',\'' + escEmail + '\',\'' + clubId + '\')" class="sa-btn" style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.08);">📤 Reenviar al SuperAdmin</button>' +
                '<button onclick="caRejectRequest(\'' + escId + '\',\'' + escEmail + '\')" class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">✕ Rechazar</button>' +
                '</div></div>';
          }).join('')}
        </div>` : ''}

        <!-- ── BLOQUE 0c: Roles pendientes de usuarios multi-rol ── -->
        ${pendingRolesInAllRoles.length ? `
        <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.25);\n                    border-radius:10px;padding:1rem;margin-bottom:1.5rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#f0883e;\n                     display:flex;align-items:center;gap:0.5rem;">
            📋 Nuevos Roles Solicitados (${pendingRolesInAllRoles.length})
          </h3>
          <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.7rem;padding:0.4rem 0.6rem;\n                     background:rgba(240,136,62,0.05);border-radius:6px;border:1px solid rgba(240,136,62,0.15);">
            ℹ️ Usuarios activos que solicitan un rol adicional. Reenvía al SuperAdmin para aprobación.
          </p>
          ${pendingRolesInAllRoles.map(u => {
              const escEmail = (typeof escapeAttr==='function'?escapeAttr(u.email||''):u.email||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
              const escId    = (u._id).replace(/'/g,"\\'");
              return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;">' +
                '<div><div style="font-size:0.85rem;font-weight:600;">' + (typeof escapeHtml==='function'?escapeHtml(u.email):u.email) + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">' + u.pendingRoleIcon + ' Solicita: <strong>' + u.pendingRoleLabel + '</strong></div></div>' +
                '<div style="display:flex;gap:0.4rem;">' +
                '<button onclick="caForwardToSA(\'' + escId + '\',\'' + u.pendingRole + '\',\'' + escEmail + '\',\'' + clubId + '\')" class="sa-btn" style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.08);">📤 Reenviar al SuperAdmin</button>' +
                '<button onclick="caRejectMultiRole(\'' + escId + '\',\'' + u.pendingRole + '\',\'' + escEmail + '\')" class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">✕ Rechazar</button>' +
                '</div></div>';
          }).join('')}
        </div>` : ''}

        <!-- ── BLOQUE A: Solicitudes de acceso automático ── -->
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
                  <div style="font-size:0.85rem;font-weight:600;">${typeof escapeHtml==='function'?escapeHtml(u.email):u.email}</div>
                  <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">
                    Rol solicitado: <strong>${typeof escapeHtml==='function'?escapeHtml(roleLabel):roleLabel}</strong> ·
                    <span style="color:${si.full ? '#ff5858' : '#31d0aa'};">
                      ${si.used}/${si.max === -1 ? '∞' : si.max} slots</span>
                  </div>
                </div>
                <div style="display:flex;gap:0.4rem;">
                  <button onclick="caApproveRequest('${(typeof escapeAttr==='function'?escapeAttr(u._id):u._id).replace(/'/g,"\\'")}','${u.requestedRole||'user'}','${(typeof escapeAttr==='function'?escapeAttr(u.email||''):u.email||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' )"
                      class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.08);">
                      ✅ Aceptar</button>
                  <button onclick="caRejectRequest('${(typeof escapeAttr==='function'?escapeAttr(u._id):u._id).replace(/'/g,"\\'")}','${(typeof escapeAttr==='function'?escapeAttr(u.email||''):u.email||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' )"
                      class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">
                      ✕ Rechazar</button>
                </div>
              </div>`;
          }).join('')}
        </div>` : ''}

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

        <!-- ── BLOQUE D: Miembros por rol (acordeón) ── -->
        <div style="margin-bottom:0.5rem;font-size:0.73rem;color:var(--text-muted);
                    padding:0 0.2rem;font-weight:600;">👥 MIEMBROS DEL CLUB</div>
        ${accordionSections}

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
                  '<div style="font-weight:700;font-size:0.82rem;color:white;">' + (typeof escapeHtml==='function'?escapeHtml(u.email||u._id):u.email||u._id) +
                  (u.displayName ? ' <span style="color:#7d8590;font-weight:400;font-size:0.75rem;"> · ' + (typeof escapeHtml==='function'?escapeHtml(u.displayName):u.displayName) + '</span>' : '') +
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
                <p style="color:#8b949e;font-size:0.78rem;margin-top:0.5rem;">${typeof escapeHtml==='function'?escapeHtml(renderErr.message):renderErr.message}</p>
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
            await updateDoc(doc(db,'users',uid), {
                isAuthorized: true, status: 'active',
                authorizedAt: new Date().toISOString(), authorizedBy: me.uid,
            });
            const key = role==='director'?'usedSlots.directors':role==='coordinator'?'usedSlots.coordinators':role==='parent'?'usedSlots.parents':'usedSlots.users';
            await updateDoc(doc(db,'clubs',clubId), { [key]: (si.used||0) + 1 });
            showToast(`✅ ${email} tiene acceso completo a la app.`, 4000);
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
            await updateDoc(doc(db,'users',uid), {
                isAuthorized: true, role, status: 'active',
                authorizedAt: new Date().toISOString(), authorizedBy: me.uid
            });
            const key = role==='director'?'usedSlots.directors':role==='coordinator'?'usedSlots.coordinators':role==='parent'?'usedSlots.parents':'usedSlots.users';
            await updateDoc(doc(db,'clubs',clubId), { [key]: (si.used || 0) + 1 });
            showToast(`✅ ${email} autorizado correctamente.`, 3000);
            openClubAdminPanel();
        } catch(e) {
            showToast('❌ Error al autorizar usuario: ' + e.message, 3000);
        }
    };

    // ── Rechazar solicitud de acceso ─────────────────────────────────
    window.caRejectRequest = async (uid, email) => {
        if (!confirm('¿Rechazar solicitud de ' + email + '?')) return;
        try {
            await updateDoc(doc(db,'users',uid), {
                isAuthorized: false, status: 'rejected',
                rejectedAt: new Date().toISOString(), rejectedBy: me.uid
            });
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
    window.caForwardToSA = async (uid, role, email, cid) => {
        const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
        if (!confirm(`¿Reenviar solicitud de ${email} como ${ROLE_LABELS[role]||role} al SuperAdmin?`)) return;
        try {
            const { db: fDb, doc: fDoc, updateDoc: fUpdateDoc, setDoc: fSetDoc, getDoc: fGetDoc } = await saFS();
            
            // 1. Read current user doc to check if user already has active roles
            const userSnap = await fGetDoc(fDoc(fDb, 'users', uid));
            const userData = userSnap.exists() ? userSnap.data() : {};
            const hasOtherActiveRoles = (userData.isAuthorized === true) && userSnap.exists();
            
            // Try to update user doc status (might fail due to Firestore rules)
            // Non-critical: platform_request is the reliable path
            try {
                if (hasOtherActiveRoles) {
                    const allRoles = userData.allRoles || [];
                    const roleIdx = allRoles.findIndex(r =>
                        r.role === role && (r.clubId || null) === (cid || null)
                    );
                    if (roleIdx >= 0) {
                        allRoles[roleIdx].status = 'pending_sa';
                        allRoles[roleIdx].forwardedToSA = true;
                        allRoles[roleIdx].forwardedToSAAt = new Date().toISOString();
                    }
                    await fUpdateDoc(fDoc(fDb, 'users', uid), {
                        allRoles: allRoles,
                        forwardedToSA: true,
                        forwardedToSAAt: new Date().toISOString(),
                        forwardedBy: window._cronosCurrentUser?.email || 'club_admin',
                    });
                } else {
                    await fSetDoc(fDoc(fDb, 'users', uid), {
                        status: 'pending_sa',
                        forwardedToSA: true,
                        forwardedToSAAt: new Date().toISOString(),
                        forwardedBy: window._cronosCurrentUser?.email || 'club_admin',
                    }, { merge: true });
                }
            } catch (userDocErr) {
                console.warn('[caForwardToSA] Could not update user doc (permissions):', userDocErr.message);
                // Non-critical — platform_request is the primary channel
            }
            
            // 2. Create or update platform_request for SA (THIS IS CRITICAL — always succeeds)
            const clubSnap = await fGetDoc(fDoc(fDb, 'clubs', cid));
            const clubName = clubSnap.exists() ? (clubSnap.data().name || '') : '';
            
            // Use consistent reqId: try to find existing request first
            const existingReqSnap = await fGetDoc(fDoc(fDb, 'platform_requests', 'self_reg_' + uid)).catch(() => null);
            const finalReqId = existingReqSnap?.exists() ? 'self_reg_' + uid : ('self_reg_' + uid + '_' + role + '_' + (cid || ''));
            
            await fSetDoc(fDoc(fDb, 'platform_requests', finalReqId), {
                type: 'self_registration',
                clubId: cid,
                clubName: clubName,
                requestedEmail: email,
                requestedRole: role,
                requestedRoleLabel: ROLE_LABELS[role] || role,
                userUid: uid,
                status: 'pending_sa',
                forwardedBy: window._cronosCurrentUser?.email || 'club_admin',
                forwardedAt: new Date().toISOString(),
                createdAt: existingReqSnap?.exists() ? (existingReqSnap.data().createdAt || new Date().toISOString()) : new Date().toISOString(),
            });
            
            showToast('✅ Solicitud de ' + email + ' reenviada al SuperAdmin.', 4000);
            openClubAdminPanel();
        } catch(e) {
            showToast('❌ Error al reenviar: ' + e.message, 3000);
        }
    };

    // ── Cambiar estado de un usuario (activo / bloqueado / baja total) ──
    window.caSetUserStatus = async (userId, userEmail, newStatus, cid) => {
        const labels = { active:'activar', blocked:'bloquear', removed:'dar de baja definitivamente' };
        if (!confirm('¿Deseas ' + (labels[newStatus] || newStatus) + ' a ' + userEmail + '?')) return;

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

                // 3. Actualizar slots del club para CADA rol del usuario
                var _slotKey = function(role) {
                    if (role === 'director') return 'usedSlots.directors';
                    if (role === 'coordinator') return 'usedSlots.coordinators';
                    if (role === 'parent') return 'usedSlots.parents';
                    return 'usedSlots.users';
                };
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

                // 7. Eliminar cuenta de Firebase Auth (vía Cloud Function)
                try {
                    if (fa && fa.functions) {
                        var delFn = httpsCallable(fa.functions, 'deleteAuthUser');
                        await delFn({ uid: realUid, email: realEmail });
                    }
                } catch (_) {}

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
//  TOGGLE DE FEATURES DEL CLUB (ej: informes individualizados)
// ════════════════════════════════════════════════════════════════════
window.caToggleFeature = async function caToggleFeature(clubId, featureKey, value) {
    try {
        const { db, doc, updateDoc } = await saFS();
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

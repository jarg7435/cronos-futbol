// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/individual-entity.js
//  Crear/editar/eliminar "entes individuales" y gestionar sus usuarios
//  (saShowCreateIndividualEntity, saCreateIndividualEntityConfirm,
//  saEditIndividualEntity, saEditIndividualEntityConfirm,
//  saDeleteIndividualEntity, saShowEntityUsers,
//  saShowCreateIndividualForEntity, saCreateIndividualForEntityConfirm).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-25. Movimiento puramente
//  mecánico, sin cambios de lógica — depende de helpers ya definidos por
//  superadmin.panel.js (saFS, _saShowSpinner/_saHideSpinner/_saToast,
//  saTab) y de window.renderCategoryTreeReadOnly
//  (js/admin/shared/category-tree.js), todos resueltos en tiempo de
//  llamada (sin dependencia de orden de carga).
//  Cubierto por scripts/test_sa_individual_entity_module.js.
// ════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// CREAR ENTE INDIVIDUAL (entidad en clubs con type=individual)
// ═══════════════════════════════════════════════════════════════════

window.saShowCreateIndividualEntity = function() {
    // Pila de navegación (js/core/nav-stack.js) — primera sentencia, ver la
    // nota sobre `await` en superadmin.panel.js.
    if (typeof navScreen === 'function') navScreen('saShowCreateIndividualEntity');

    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="max-width:520px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="navBack()" class="sa-btn"
                    style="color:#79c0ff;border-color:rgba(121,192,255,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">👤 Crear Ente Individual</h3>
            </div>
            <p style="font-size:0.8rem;color:#8b949e;margin-bottom:1.2rem;">
                Un ente individual es una entidad independiente (sin club fisico) donde se registran
                administradores individuales, entrenadores individuales y padres/madres/tutores individuales.
                Es necesario crear al menos un ente individual antes de poder registrar usuarios individuales.
            </p>
            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del Ente Individual *</label>
                    <input id="cie-name" type="text" placeholder="Ej: Ente Individual - Entrenadores Libres"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;">
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Admins Ind.</label>
                        <input id="cie-admins" type="number" value="5" min="0" max="50"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Entrenadores Ind.</label>
                        <input id="cie-coaches" type="number" value="50" min="0" max="500"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Padres Ind.</label>
                        <input id="cie-parents" type="number" value="100" min="0" max="1000"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Plan</label>
                    <select id="cie-plan"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="free">🆓 Free</option>
                        <option value="basic">⭐ Basic</option>
                        <option value="pro">🚀 Pro</option>
                    </select>
                </div>
                <button onclick="saCreateIndividualEntityConfirm()"
                    style="margin-top:0.5rem;padding:0.8rem;background:#79c0ff;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Crear Ente Individual
                </button>
            </div>
        </div>`;
};

window.saCreateIndividualEntityConfirm = async function() {
    const name      = document.getElementById('cie-name')?.value.trim();
    const adminS    = parseInt(document.getElementById('cie-admins')?.value)   || 5;
    const coachS    = parseInt(document.getElementById('cie-coaches')?.value)  || 50;
    const parS      = parseInt(document.getElementById('cie-parents')?.value)  || 100;
    const plan      = document.getElementById('cie-plan')?.value || 'free';

    if (!name) { _saToast('⚠️ El nombre del ente individual es obligatorio', 3000); return; }

    _saShowSpinner('Creando ente individual...');
    try {
        const { db, doc, setDoc } = await saFS();
        const entityId = 'individual_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,4);
        await setDoc(doc(db, 'clubs', entityId), {
            name,
            type:           'individual',
            plan,
            status:         'active',
            hasAdmin:       false,
            adminEmail:     null,
            adminUid:       null,
            adminName:      null,
            email:          null,
            slots:          { admins: adminS, coaches: coachS, parents: parS },
            usedSlots:      { admins: 0,      coaches: 0,     parents: 0    },
            createdAt:      new Date().toISOString(),
            createdBySA:    window._cronosCurrentUser?.email || 'superadmin',
        });
        _saHideSpinner();
        _saToast('✅ Ente individual "' + name + '" creado correctamente. Ya puedes anadir usuarios individuales.', 6000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saCreateIndividualEntityConfirm]', e);
    }
};

// Editar ente individual (slots y plan)
window.saEditIndividualEntity = async function(entityId) {
    // Pila de navegación — con el id, para poder repintarse igual al volver.
    if (typeof navScreen === 'function') navScreen('saEditIndividualEntity', entityId);

    const { db, doc, getDoc } = await saFS();
    const snap = await getDoc(doc(db,'clubs',entityId));
    if (!snap.exists()) { _saToast('Ente no encontrado', 3000); return; }
    const c = snap.data();
    const _escH = typeof escapeHtml==='function'?escapeHtml:function(s){return s;};
    const _escA = typeof escapeAttr==='function'?escapeAttr:function(s){return s;};

    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <div style="max-width:520px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="navBack()" class="sa-btn"
                    style="color:#79c0ff;border-color:rgba(121,192,255,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">✏️ Editar Ente Individual: ${_escH(c.name||entityId)}</h3>
            </div>
            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del Ente</label>
                    <input id="eie-name" type="text" value="${_escA(c.name||'')}"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;">
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Admins Ind.</label>
                        <input id="eie-admins" type="number" value="${c.slots?.admins ?? 5}" min="0" max="50"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Entrenadores Ind.</label>
                        <input id="eie-coaches" type="number" value="${c.slots?.coaches ?? 50}" min="0" max="500"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Padres Ind.</label>
                        <input id="eie-parents" type="number" value="${c.slots?.parents ?? 100}" min="0" max="1000"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Plan</label>
                    <select id="eie-plan"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="free" ${c.plan==='free'?'selected':''}>🆓 Free</option>
                        <option value="basic" ${c.plan==='basic'?'selected':''}>⭐ Basic</option>
                        <option value="pro" ${c.plan==='pro'?'selected':''}>🚀 Pro</option>
                    </select>
                </div>
                <button onclick="saEditIndividualEntityConfirm('${_escA(entityId).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')"
                    style="margin-top:0.5rem;padding:0.8rem;background:#79c0ff;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Guardar Cambios
                </button>
            </div>
        </div>`;
};

window.saEditIndividualEntityConfirm = async function(entityId) {
    const name     = document.getElementById('eie-name')?.value.trim();
    const adminS   = parseInt(document.getElementById('eie-admins')?.value)   || 5;
    const coachS   = parseInt(document.getElementById('eie-coaches')?.value)  || 50;
    const parS     = parseInt(document.getElementById('eie-parents')?.value)  || 100;
    const plan     = document.getElementById('eie-plan')?.value || 'free';

    if (!name) { _saToast('⚠️ El nombre es obligatorio', 3000); return; }

    _saShowSpinner('Guardando cambios...');
    try {
        const { db, doc, updateDoc } = await saFS();
        await updateDoc(doc(db, 'clubs', entityId), {
            name,
            plan,
            slots: { admins: adminS, coaches: coachS, parents: parS },
        });
        _saHideSpinner();
        _saToast('✅ Ente individual actualizado.', 4000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saEditIndividualEntityConfirm]', e);
    }
};

// Eliminar ente individual
window.saDeleteIndividualEntity = async function(entityId, entityName) {
    if (!confirm('🗑️ ¿ELIMINAR el ente individual "' + entityName + '"?\n\nSe eliminara el ente pero NO los usuarios asociados. Los usuarios quedaran sin ente asignado.')) return;

    _saShowSpinner('Eliminando ente individual...');
    try {
        const { db, doc, deleteDoc } = await saFS();
        await deleteDoc(doc(db, 'clubs', entityId));
        _saHideSpinner();
        _saToast('✅ Ente individual eliminado.', 4000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saDeleteIndividualEntity]', e);
    }
};

// Ver usuarios de un ente individual
window.saShowEntityUsers = async function(entityId) {
    // Pila de navegación — con el id, para poder repintarse igual al volver.
    if (typeof navScreen === 'function') navScreen('saShowEntityUsers', entityId);

    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center;padding:2.5rem;color:#8b949e;"><div style="font-size:1.6rem;">⏳</div>Cargando usuarios…</div>`;
    try {
        const { db, collection, query, where, getDocs } = await saFS();
        // CRITICAL: Query by both clubId AND individualEntityId to find all users linked to this entity
        const snapByClubId = await getDocs(query(collection(db,'users'), where('clubId','==',entityId)));
        const snapByIndivId = await getDocs(query(collection(db,'users'), where('individualEntityId','==',entityId)));
        const snapByOwnerId = await getDocs(query(collection(db,'users'), where('individualOwnerId','==',entityId))).catch(()=>({forEach:()=>{}}));
        // Merge results, avoiding duplicates by user ID
        const userMap = new Map();
        snapByClubId.forEach(d => { if (!userMap.has(d.id)) userMap.set(d.id, { id:d.id, ...d.data() }); });
        snapByIndivId.forEach(d => { if (!userMap.has(d.id)) userMap.set(d.id, { id:d.id, ...d.data() }); });
        snapByOwnerId.forEach(d => { if (!userMap.has(d.id)) userMap.set(d.id, { id:d.id, ...d.data() }); });
        const users = Array.from(userMap.values());

        const stColor = { active:'#3fb950', blocked:'#f0883e', removed:'#ff5858', pending:'#ffd700', pending_club:'#ffa500', pending_register:'#79c0ff', pending_sa:'#79c0ff', pending_individual:'#ffa500' };
        const stLabel = { active:'Activo', blocked:'Bloqueado', removed:'Baja', pending:'⏳ Pend.SA', pending_club:'⏳ Pend.Club', pending_register:'⏳ Sin registrar', pending_sa:'⏳ Pend.SA', pending_individual:'⏳ Pend.Indiv.' };

        let html = `
        <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1rem;">
            <button onclick="navBack()" class="sa-btn" style="color:#79c0ff;border-color:rgba(121,192,255,0.3);">← Volver</button>
            <h3 style="margin:0;font-size:1rem;">📋 Usuarios del Ente (${users.length})</h3>
        </div>`;

        if (!users.length) {
            html += `<div style="text-align:center;padding:2rem;color:#8b949e;">Sin usuarios registrados en este ente.</div>`;
        } else {
            const _escH = typeof escapeHtml==='function'?escapeHtml:function(s){return s;};
            const _escA = typeof escapeAttr==='function'?escapeAttr:function(s){return s;};
            const _expandEntityUsers = (entUsers) => {
                const expanded = [];
                (entUsers || []).filter(u => u.status !== 'removed').forEach(u => {
                    let roles = u.allRoles || [];
                    if (roles.length === 0) {
                        roles = [{
                            role: u.role || u.requestedRole,
                            clubId: u.clubId || u.individualEntityId || u.individualOwnerId || null,
                            isAuthorized: (u.isAuthorized === true || u.authorized === true),
                            status: u.status,
                            category: u.category || u.categoryLabel,
                            subcategory: u.subcategory,
                        }];
                    }
                    roles.forEach(r => {
                        const isAuth = r.isAuthorized === true || r.authorized === true;
                        if (isAuth && r.status !== 'rejected') {
                            const _roleData = (r.category == null && r.subcategory == null)
                                ? { ...r,
                                    category:    r.category    != null ? r.category    : (u.category || u.categoryLabel),
                                    subcategory: r.subcategory != null ? r.subcategory : u.subcategory }
                                : r;
                            expanded.push({ ...u, _activeRoleData: _roleData });
                        }
                    });
                });
                return expanded;
            };
            const _expandedEnt = _expandEntityUsers(users);
            html += window.renderCategoryTreeReadOnly(_expandedEnt, { mode: 'individual' });
        }
        body.innerHTML = html;
    } catch(e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${e.message}</p>`;
        console.error('[saShowEntityUsers]', e);
    }
};

// Crear usuario individual para un ente específico
window.saShowCreateIndividualForEntity = function(entityId) {
    // Pila de navegación — con el id, para poder repintarse igual al volver.
    if (typeof navScreen === 'function') navScreen('saShowCreateIndividualForEntity', entityId);

    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="max-width:480px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="navBack()" class="sa-btn"
                    style="color:#79c0ff;border-color:rgba(121,192,255,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">👤 Anadir Usuario al Ente</h3>
            </div>
            <p style="font-size:0.8rem;color:#8b949e;margin-bottom:1.2rem;">
                Crea un usuario individual pre-aprobado y asignalo a este ente individual.
            </p>
            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email del usuario *</label>
                    <input id="cife-email" type="email" placeholder="usuario@email.com"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre completo</label>
                    <input id="cife-name" type="text" placeholder="Nombre y Apellidos"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Rol individual</label>
                    <select id="cife-role"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="admin_individual">⚙️ Administrador Individual</option>
                        <option value="individual">⚙️ Administrador Individual (registro auth.js)</option>
                        <option value="user">⚽ Entrenador Individual</option>
                        <option value="entrenador_individual">⚽ Entrenador Individual (alternativo)</option>
                        <option value="parent_individual">👨‍👩‍👧 Padre/Madre/Tutor Individual</option>
                    </select>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <input id="cife-sendemail" type="checkbox" checked
                        style="width:1.1rem;height:1.1rem;accent-color:#3fb950;cursor:pointer;">
                    <label for="cife-sendemail" style="font-size:0.82rem;color:#cdd9e5;cursor:pointer;">
                        Enviar email de invitacion al usuario
                    </label>
                </div>
                <button onclick="saCreateIndividualForEntityConfirm('${typeof escapeAttr==='function'?escapeAttr(entityId).replace(/\\/g,'\\\\').replace(/'/g,"\\'"):entityId}')"
                    style="margin-top:0.5rem;padding:0.8rem;background:#3fb950;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Crear y Asignar Usuario
                </button>
            </div>
        </div>`;
};

window.saCreateIndividualForEntityConfirm = async function(entityId) {
    const email     = document.getElementById('cife-email')?.value.trim();
    const name      = document.getElementById('cife-name')?.value.trim() || '';
    const role      = document.getElementById('cife-role')?.value || 'individual';
    const sendEmail = document.getElementById('cife-sendemail')?.checked || false;

    if (!email) { _saToast('⚠️ El email es obligatorio', 3000); return; }

    _saShowSpinner('Creando usuario individual...');
    try {
        const { db, doc, setDoc, updateDoc, getDoc, collection, query, where, getDocs, fa, httpsCallable } = await saFS();
        const me = window._cronosCurrentUser?.email || 'superadmin';

        // Verificar si ya existe
        const existing = await getDocs(query(collection(db,'users'), where('email','==',email))).catch(()=>null);

        if (existing && !existing.empty) {
            const existingDoc = existing.docs[0];
            const existingData = existingDoc.data();
            const existingStatus = existingData.status;
            const existingId = existingDoc.id;

            if (existingStatus === 'removed' || existingStatus === 'blocked') {
                const updAllRoles = (existingData.allRoles||[]).map(r =>
                    r.role === role ? {...r, isAuthorized:true, status:'active', clubId:entityId} : r
                );
                if (!updAllRoles.some(r => r.role === role)) {
                    updAllRoles.push({ role:role, isAuthorized:true, status:'active', clubId:entityId });
                }

                await updateDoc(doc(db, 'users', existingId), {
                    role:          role,
                    clubId:        entityId,
                    displayName:   name || existingData.displayName || '',
                    isAuthorized:  true,
                    status:        'active',
                    allRoles:      updAllRoles,
                    removedAt:     null,
                    blockedAt:     null,
                    reactivatedAt: new Date().toISOString(),
                    reactivatedBy: me,
                    authorizedAt:  new Date().toISOString(),
                    authorizedBy:  me,
                });

                _saHideSpinner();
                _saToast('✅ ' + email + ' reactivado y asignado al ente individual.', 5000);
                saTab('individuals');
                return;
            } else {
                _saHideSpinner();
                _saToast('⚠️ Ya existe un usuario activo con ese email (' + (existingStatus||'activo') + ').', 6000);
                return;
            }
        }

        // Crear nuevo usuario individual
        const preId = 'individual_pre_' + Date.now().toString(36);
        await setDoc(doc(db, 'users', preId), {
            email,
            displayName:  name,
            firstName:    name,
            role:         role,
            clubId:       entityId,
            isAuthorized: true,
            status:       'active',
            isIndividual: true,
            individualEntityId: entityId,
            individualOwnerId:  entityId,
            individualOwnerEmail: null,
            allRoles: [{
                role:         role,
                isAuthorized: true,
                status:       'active',
                clubId:       entityId,
                individualEntityId: entityId,
            }],
            approvedBySA:    true,
            approvedBySAAt:  new Date().toISOString(),
            approvedBySABy:  me,
            createdAt:       new Date().toISOString(),
        });

        // Actualizar usedSlots y hasAdmin del ente individual
        try {
            const entSnap = await getDoc(doc(db, 'clubs', entityId));
            if (entSnap.exists()) {
                const slotKey = role === 'admin_individual' ? 'admins'
                              : role === 'parent_individual' ? 'parents'
                              : role === 'individual' ? 'admins'  // 'individual' from auth.js = admin individual
                              : role === 'entrenador_individual' ? 'coaches'  // 'entrenador_individual' = entrenador individual
                              : 'coaches';  // 'user' = entrenador individual
                const currentUsed = entSnap.data().usedSlots?.[slotKey] || 0;
                const updateData = {
                    ['usedSlots.' + slotKey]: currentUsed + 1,
                };
                // Si es admin_individual o individual, marcar hasAdmin y registrar adminEmail
                if (role === 'admin_individual' || role === 'individual') {
                    updateData.hasAdmin = true;
                    updateData.adminEmail = email;
                    updateData.adminName = name || email;
                    updateData.adminUid = preId;
                }
                await updateDoc(doc(db, 'clubs', entityId), updateData);
            }
        } catch(se) { console.warn('[saCreateIndividualForEntityConfirm] usedSlots update failed:', se.message); }

        // Enviar email
        if (sendEmail && fa.functions) {
            try {
                const sendEmailFn = httpsCallable(fa.functions, 'sendInviteEmail');
                await sendEmailFn({ to:email, role:role, clubName:'' });
            } catch(ee) { console.warn('[saCreateIndividualForEntityConfirm] Email no enviado:', ee.message); }
        }

        _saHideSpinner();
        _saToast('✅ Usuario individual creado y asignado al ente. ' + email + ' puede registrarse y acceder directamente.', 6000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saCreateIndividualForEntityConfirm]', e);
    }
};

// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/create-direct.js
//  Crear club / usuario individual directamente desde SuperAdmin
//  (saShowCreateClub, saCreateClubConfirm, saShowCreateIndividual,
//  saCreateIndividualConfirm).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-24. Movimiento puramente
//  mecánico, sin cambios de lógica — depende de helpers ya definidos por
//  superadmin.panel.js (saFS, _saShowSpinner/_saHideSpinner/_saToast,
//  saTab, window.ROLE_META), que debe cargarse ANTES que este archivo.
//  Cubierto por scripts/test_sa_create_direct_module.js.
// ════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// CREAR CLUB directamente desde SA
// ═══════════════════════════════════════════════════════════════════
window.saShowCreateClub = function() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="max-width:520px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="saTab('clubs')" class="sa-btn"
                    style="color:#58a6ff;border-color:rgba(88,166,255,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">🏟️ Crear Nuevo Club</h3>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del Club *</label>
                    <input id="cc-name" type="text" placeholder="Ej: Club Deportivo José"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email del Administrador del Club *</label>
                    <input id="cc-email" type="email" placeholder="admin@club.com"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Directores</label>
                        <input id="cc-dir" type="number" value="1" min="0" max="10"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Coordinadores</label>
                        <input id="cc-coord" type="number" value="2" min="0" max="20"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Entrenadores</label>
                        <input id="cc-coach" type="number" value="10" min="0" max="100"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Padres/Tutores</label>
                        <input id="cc-parents" type="number" value="50" min="0" max="500"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Plan</label>
                    <select id="cc-plan"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="free">🆓 Free</option>
                        <option value="basic">⭐ Basic</option>
                        <option value="pro">🚀 Pro</option>
                    </select>
                </div>
                <button onclick="saCreateClubConfirm()"
                    style="margin-top:0.5rem;padding:0.8rem;background:#58a6ff;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Crear Club
                </button>
            </div>
        </div>`;
};

window.saCreateClubConfirm = async function() {
    const name   = document.getElementById('cc-name')?.value.trim();
    const email  = document.getElementById('cc-email')?.value.trim();
    const dirS   = parseInt(document.getElementById('cc-dir')?.value)     || 1;
    const coS    = parseInt(document.getElementById('cc-coord')?.value)    || 2;
    const coachS = parseInt(document.getElementById('cc-coach')?.value)    || 10;
    const parS   = parseInt(document.getElementById('cc-parents')?.value)  || 50;
    const plan   = document.getElementById('cc-plan')?.value || 'free';

    if (!name)  { _saToast('⚠️ El nombre del club es obligatorio', 3000); return; }
    if (!email) { _saToast('⚠️ El email del administrador es obligatorio', 3000); return; }

    _saShowSpinner('Creando club...');
    try {
        const { db, doc, setDoc, collection } = await saFS();
        const clubId = 'club_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,4);
        await setDoc(doc(db, 'clubs', clubId), {
            name,
            adminEmail:    email,
            adminUid:      null, // se rellena cuando el admin se registra/aprueba (regla isClubAdminOf usa adminEmail como fallback hasta entonces)
            plan,
            status:        'active',
            slots:         { directors: dirS, coordinators: coS, users: coachS, parents: parS },
            usedSlots:     { directors: 0,    coordinators: 0,   users: 0,      parents: 0    },
            createdAt:     new Date().toISOString(),
            createdBySA:   window._cronosCurrentUser?.email || 'superadmin',
        });
        _saHideSpinner();
        _saToast('✅ Club "' + name + '" creado correctamente. El administrador puede registrarse ahora.', 6000);
        saTab('clubs');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saCreateClubConfirm]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// CREAR USUARIO INDIVIDUAL directamente desde SA
// ═══════════════════════════════════════════════════════════════════
window.saShowCreateIndividual = function() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="max-width:480px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="saTab('individuals')" class="sa-btn"
                    style="color:#3fb950;border-color:rgba(63,185,80,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">👤 Crear Usuario Individual</h3>
            </div>
            <p style="font-size:0.8rem;color:#8b949e;margin-bottom:1.2rem;">
                Crea un usuario individual pre-aprobado. Podrá registrarse en la app y acceder directamente.
                Si el email ya existe pero estaba dado de baja, se reactivará automáticamente.
            </p>
            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email del usuario *</label>
                    <input id="ci-email" type="email" placeholder="entrenador@email.com"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre completo</label>
                    <input id="ci-name" type="text" placeholder="Nombre y Apellidos"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Rol individual</label>
                    <select id="ci-role"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="admin_individual">⚙️ Administrador Individual</option>
                        <option value="individual">⚙️ Administrador Individual (auth.js)</option>
                        <option value="user">👤 Entrenador Individual</option>
                        <option value="parent">👨‍👩‍👧 Padre/Madre/Tutor Individual</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Plan</label>
                    <select id="ci-plan"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="free">🆓 Free</option>
                        <option value="basic">⭐ Basic</option>
                        <option value="pro">🚀 Pro</option>
                    </select>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <input id="ci-sendemail" type="checkbox" checked
                        style="width:1.1rem;height:1.1rem;accent-color:#3fb950;cursor:pointer;">
                    <label for="ci-sendemail" style="font-size:0.82rem;color:#cdd9e5;cursor:pointer;">
                        Enviar email de invitación al usuario
                    </label>
                </div>
                <button onclick="saCreateIndividualConfirm()"
                    style="margin-top:0.5rem;padding:0.8rem;background:#3fb950;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Crear Usuario Individual
                </button>
            </div>
        </div>`;
};

window.saCreateIndividualConfirm = async function() {
    const email     = document.getElementById('ci-email')?.value.trim();
    const name      = document.getElementById('ci-name')?.value.trim() || '';
    const role      = document.getElementById('ci-role')?.value || 'individual';
    const plan      = document.getElementById('ci-plan')?.value || 'free';
    const sendEmail = document.getElementById('ci-sendemail')?.checked || false;

    if (!email) { _saToast('⚠️ El email es obligatorio', 3000); return; }

    _saShowSpinner('Creando usuario individual...');
    try {
        const { db, doc, setDoc, updateDoc, collection, query, where, getDocs, fa, httpsCallable } = await saFS();
        const me = window._cronosCurrentUser?.email || 'superadmin';

        // Verificar si ya existe un usuario con ese email
        const existing = await getDocs(query(collection(db,'users'), where('email','==',email))).catch(()=>null);
        
        if (existing && !existing.empty) {
            // Ya existe un usuario con ese email
            const existingDoc = existing.docs[0];
            const existingData = existingDoc.data();
            const existingStatus = existingData.status;
            const existingId = existingDoc.id;

            if (existingStatus === 'removed' || existingStatus === 'blocked') {
                // REACTIVAR usuario que fue dado de baja o bloqueado
                const updAllRoles = (existingData.allRoles||[]).map(r =>
                    r.role === role ? {...r, isAuthorized:true, status:'active'} : r
                );
                // Si el rol no estaba en allRoles, añadirlo
                if (!updAllRoles.some(r => r.role === role)) {
                    updAllRoles.push({ role:role, isAuthorized:true, status:'active', clubId:null });
                }

                await updateDoc(doc(db, 'users', existingId), {
                    role:          role,
                    displayName:   name || existingData.displayName || '',
                    isAuthorized:  true,
                    status:        'active',
                    plan:          plan,
                    allRoles:      updAllRoles,
                    removedAt:     null,
                    blockedAt:     null,
                    reactivatedAt: new Date().toISOString(),
                    reactivatedBy: me,
                    authorizedAt:  new Date().toISOString(),
                    authorizedBy:  me,
                });

                _saHideSpinner();
                _saToast('✅ ' + email + ' reactivado como ' + (window.ROLE_META[role]?.label || role) + '.', 5000);

                // Enviar email si está marcado
                if (sendEmail && fa.functions) {
                    try {
                        const sendEmailFn = httpsCallable(fa.functions, 'sendInviteEmail');
                        await sendEmailFn({ to:email, role:role, clubName:'' });
                    } catch(ee) { console.warn('[saCreateIndividualConfirm] Email no enviado:', ee.message); }
                }

                saTab('individuals');
                return;
            } else {
                // El usuario existe y está activo o pendiente — no se puede crear
                _saHideSpinner();
                _saToast('⚠️ Ya existe un usuario activo con ese email (' + (existingStatus||'activo') + '). Gestiónalo desde la pestaña Individuales.', 6000);
                return;
            }
        }

        // No existe — crear un nuevo pre-usuario con rol individual pre-aprobado
        const preId = 'individual_pre_' + Date.now().toString(36);
        await setDoc(doc(db, 'users', preId), {
            email,
            displayName:  name,
            role:         role,
            plan,
            isAuthorized: true,
            status:       'active',
            allRoles: [{
                role:         role,
                isAuthorized: true,
                status:       'active',
                clubId:       null,
            }],
            approvedBySA:    true,
            approvedBySAAt:  new Date().toISOString(),
            approvedBySABy:  me,
            createdAt:       new Date().toISOString(),
        });

        // Enviar email si está marcado
        if (sendEmail && fa.functions) {
            try {
                const sendEmailFn = httpsCallable(fa.functions, 'sendInviteEmail');
                await sendEmailFn({ to:email, role:role, clubName:'' });
            } catch(ee) { console.warn('[saCreateIndividualConfirm] Email no enviado:', ee.message); }
        }

        _saHideSpinner();
        _saToast('✅ Usuario individual creado. ' + email + ' puede registrarse y acceder directamente.', 6000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saCreateIndividualConfirm]', e);
    }
};

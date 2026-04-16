/**
 * auth.js - Gestión de Autenticación y Autorización
 * Cronos Fútbol — v5 (multi-rol: mismo email, múltiples roles)
 */

// ── Estado Local ──────────────────────────────────────────────
let _isLoginMode = true;

// ── Cambiar entre Login y Registro ──────────────────────────
export async function switchTab(tab) {
    _isLoginMode = (tab === 'login');
    const loginTab     = document.getElementById('tab-login');
    const regTab       = document.getElementById('tab-register');
    const loginForm    = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    if (loginTab) {
        loginTab.style.color        = _isLoginMode ? '#58a6ff' : '#7d8590';
        loginTab.style.borderBottom = _isLoginMode ? '2px solid #58a6ff' : '2px solid transparent';
    }
    if (regTab) {
        regTab.style.color        = !_isLoginMode ? '#58a6ff' : '#7d8590';
        regTab.style.borderBottom = !_isLoginMode ? '2px solid #58a6ff' : '2px solid transparent';
    }

    if (loginForm)    loginForm.style.display    = _isLoginMode ? 'block' : 'none';
    if (registerForm) registerForm.style.display = _isLoginMode ? 'none'  : 'block';

    const errorEl = document.getElementById('auth-error');
    if (errorEl) errorEl.textContent = '';

    const loginPwdSec    = document.getElementById('login-pwd-section');
    const registerPwdSec = document.getElementById('register-pwd-section');
    
    if (loginPwdSec)    loginPwdSec.style.display    = _isLoginMode ? 'block' : 'none';
    if (registerPwdSec) registerPwdSec.style.display = _isLoginMode ? 'none'  : 'block';

    if (!_isLoginMode) {
        loadClubOptions();
        handleRoleChange();
    } else {
        ['club-container', 'new-club-container',
         'individual-name-container', 'invite-code-container'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }
}

// ── Cargar Clubes en el selector ─────────────────────────────
export async function loadClubOptions() {
    const select = document.getElementById('auth-club-select');
    if (!select) return;

    select.innerHTML = '<option value="">⏳ Cargando clubes...</option>';

    // Esperar hasta 4 segundos a que Firebase esté listo
    let fa = window._cronos_auth;
    if (!fa) {
        for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 500));
            fa = window._cronos_auth;
            if (fa) break;
        }
    }
    if (!fa || !fa.db) {
        select.innerHTML = '<option value="">⚠️ Firebase no disponible. Recarga la página.</option>';
        return;
    }

    try {
        const m    = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await m.getDocs(m.collection(fa.db, 'clubs'));

        if (snap.empty) {
            select.innerHTML = '<option value="">No hay clubes registrados aún</option>';
            return;
        }

        let html = '<option value="">-- Selecciona tu club --</option>';
        snap.forEach(doc => {
            const club = doc.data();
            if (club.status !== 'blocked') {
                html += '<option value="' + doc.id + '">' + (club.name || doc.id) + '</option>';
            }
        });
        select.innerHTML = html;
    } catch(e) {
        console.error('[Cronos] Error cargando clubes:', e);
        // Si es error de permisos, intentar sin autenticación con REST
        select.innerHTML = '<option value="">⚠️ Error al cargar clubes — actualiza la página</option>';
        // Reintento automático en 2 segundos
        setTimeout(() => loadClubOptions(), 2000);
    }
}

// ── Manejar Cambio de Rol ────────────────────────────────────
export function handleRoleChange() {
    const role = document.getElementById('auth-role')?.value;

    const isParent     = (role === 'parent');
    const isClubAdmin  = (role === 'club_admin');
    const isIndividual = (role === 'individual');

    const clubCont    = document.getElementById('club-container');
    const newClubCont = document.getElementById('new-club-container');
    const inviteCont  = document.getElementById('invite-code-container');
    const indivCont   = document.getElementById('individual-name-container');

    // Selector de club: mostrar para todos los roles de club (no admin, no individual)
    if (clubCont)    clubCont.style.display    = (!isClubAdmin && !isIndividual) ? 'block' : 'none';
    // Formulario de nuevo club: solo para quien va a ser administrador de club
    if (newClubCont) newClubCont.style.display  = isClubAdmin ? 'block' : 'none';
    // Código de invitación: solo para padres/madres/tutores
    if (inviteCont)  inviteCont.style.display   = isParent ? 'block' : 'none';
    // Nombre y apellidos: solo para usuario individual
    if (indivCont)   indivCont.style.display    = isIndividual ? 'block' : 'none';
}

// ── Mostrar Error / Éxito ────────────────────────────────────
export function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (el) {
        el.textContent = msg;
        el.style.color = (msg.startsWith('✅') || msg.includes('correct'))
            ? '#3fb950' : '#ff5858';
    }
}

// ── Verificación de Autorización ────────────────────────────
// Emails con acceso automático de superadmin
const SUPERADMIN_EMAILS = ['jarg7435@gmail.com'];

export async function checkAuthorization(user) {
    if (!user) return;
    const fa = window._cronos_auth;
    if (!fa) return;

    // ── Si se está añadiendo un rol, no interferir ──────────
    if (window._addingRole) {
        console.log('[Cronos] Autorización pospuesta (añadiendo rol)...');
        return;
    }

    try {
        const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // ── Buscar TODOS los documentos con este email ─────────
        const q = m.query(
            m.collection(fa.db, 'users'),
            m.where('email', '==', user.email)
        );
        const snapshot = await m.getDocs(q);

        // ── Recopilar documentos ────────────────────────────────
        const activeDocs   = [];  // documentos activos/pendientes
        const removedDocs  = [];  // documentos eliminados/bloqueados

        snapshot.forEach(doc => {
            const data = doc.data();
            const entry = { docId: doc.id, ...data };
            if (data.status === 'removed' || data.status === 'blocked') {
                removedDocs.push(entry);
            } else {
                activeDocs.push(entry);
            }
        });

        // ── CASO 1: No se encontró ningún documento ──────────────
        if (snapshot.empty) {
            // Auto-crear documento para superadmin
            if (SUPERADMIN_EMAILS.includes(user.email)) {
                await fa.setDoc(fa.doc(fa.db, 'users', user.uid), {
                    email:        user.email,
                    role:         'superadmin',
                    isAuthorized: true,
                    status:       'active',
                    createdAt:    fa.serverTimestamp(),
                    lastLogin:    fa.serverTimestamp(),
                    autoRecovered: true,
                });
                window._cronosCurrentUser = {
                    uid:     user.uid,
                    email:   user.email,
                    role:    'superadmin',
                    clubId:  null,
                    clubName: null,
                    docId:   user.uid,
                };
                enterApp();
                return;
            }

            await fa.signOut(fa.auth);
            showAuthError(
                '⚠️ Tu cuenta no está registrada en el sistema. ' +
                'Si ya te registraste y fuiste dado de baja, ' +
                'puedes volver a registrarte con el mismo email.'
            );
            return;
        }

        // ── CASO 2: Todos los documentos están eliminados/bloqueados ──
        if (activeDocs.length === 0 && removedDocs.length > 0) {
            await fa.signOut(fa.auth);
            showAuthError(
                '🔄 Tu cuenta fue dada de baja. ' +
                'Puedes registrarte de nuevo con el mismo email.'
            );
            return;
        }

        if (activeDocs.length === 0) {
            await fa.signOut(fa.auth);
            showAuthError('⚠️ Tu cuenta no está registrada en el sistema.');
            return;
        }

        // ── Filtrar solo roles autorizados ────────────────────────
        const authorizedRoles = activeDocs.filter(d =>
            d.isAuthorized || d.role === 'superadmin'
        );

        if (authorizedRoles.length === 0) {
            await fa.signOut(fa.auth);
            const hasPending = activeDocs.some(d => d.status === 'pending');
            showAuthError(
                hasPending
                    ? '⏳ Acceso pendiente de aprobación. ' +
                      'El administrador de tu club debe confirmar tu acceso.'
                    : '⚠️ Tu cuenta no tiene roles autorizados.'
            );
            return;
        }

        // ── CASO 3: Un solo rol autorizado → entrar directamente ──
        if (authorizedRoles.length === 1) {
            const r = authorizedRoles[0];
            await fa.setDoc(
                fa.doc(fa.db, 'users', r.docId),
                { lastLogin: fa.serverTimestamp() },
                { merge: true }
            );

            window._cronosCurrentUser = {
                uid:         user.uid,
                email:       user.email,
                role:        r.role,
                clubId:      r.clubId      || null,
                clubName:    r.clubName    || null,
                docId:       r.docId,
                firstName:   r.firstName   || null,
                lastName:    r.lastName    || null,
                displayName: r.displayName || null,
            };
            enterApp();
            return;
        }

        // ── CASO 4: Múltiples roles autorizados → mostrar selector ──
        _showMultiRolePicker(user, authorizedRoles);

    } catch (err) {
        console.error('Auth verify error:', err);
        showAuthError('Error de verificación: ' + err.message);
    }
}

// ── Selector Multi-Rol (aparece al hacer login con varios roles) ──
function _showMultiRolePicker(user, roles) {
    // Eliminar picker previo si existiera
    const prev = document.getElementById('multi-role-picker');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.id = 'multi-role-picker';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;' +
        'display:flex;align-items:center;justify-content:center;padding:1rem;';

    const roleLabels = {
        superadmin:  '🛡️  Super Administrador',
        club_admin:  '🏛️  Administrador de Club',
        director:    '📋  Director Deportivo',
        coordinator: '🎯  Coordinador',
        user:        '⚽  Entrenador',
        coach:       '⚽  Entrenador',
        parent:      '👨‍👧  Padre / Madre / Tutor',
        individual:  '👤  Usuario Individual',
    };

    const cards = roles.map(r => {
        const label    = roleLabels[r.role] || r.role;
        const clubInfo = r.clubName
            ? '<div style="font-size:0.78rem;color:#7d8590;margin-top:4px;">🏟️ ' +
              (r.clubName || 'Sin club') + '</div>'
            : '';
        const disabled = !r.isAuthorized && r.role !== 'superadmin';
        const badge    = disabled
            ? '<div style="font-size:0.72rem;color:#d29922;margin-top:3px;">⏳ Pendiente de aprobación</div>'
            : '';
        const opacity  = disabled ? 'opacity:0.45;cursor:not-allowed;' : 'cursor:pointer;';

        return '<button class="mrp-btn" data-docid="' + r.docId + '" ' +
            'style="width:100%;text-align:left;padding:1rem;margin-bottom:0.6rem;' +
            'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);' +
            'border-radius:12px;color:white;font-size:0.9rem;transition:all 0.2s;' +
            opacity + '">' +
            '<div style="font-weight:600;">' + label + '</div>' +
            clubInfo + badge + '</button>';
    }).join('');

    overlay.innerHTML =
        '<div style="background:#161b22;border:1px solid rgba(88,166,255,0.3);border-radius:16px;' +
        'padding:1.5rem;width:min(96vw,460px);max-height:85vh;overflow-y:auto;">' +
            '<div style="text-align:center;margin-bottom:1.2rem;">' +
                '<div style="font-weight:700;font-size:1.1rem;color:white;">' +
                    'Selecciona con qué rol deseas entrar</div>' +
                '<div style="font-size:0.8rem;color:#7d8590;margin-top:6px;">' +
                    user.email + '</div>' +
            '</div>' +
            cards +
            '<button id="mrp-close" style="width:100%;padding:0.7rem;margin-top:0.5rem;' +
                'background:rgba(255,70,70,0.1);border:1px solid rgba(255,70,70,0.25);' +
                'border-radius:8px;color:#ff5858;font-size:0.82rem;cursor:pointer;">' +
                'Cerrar sesión</button>' +
        '</div>';
    document.body.appendChild(overlay);

    // Eventos de hover
    overlay.querySelectorAll('.mrp-btn').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            if (btn.style.cursor === 'not-allowed') return;
            btn.style.background  = 'rgba(88,166,255,0.12)';
            btn.style.borderColor = 'rgba(88,166,255,0.4)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background  = 'rgba(255,255,255,0.04)';
            btn.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        btn.addEventListener('click', () => {
            const r = roles.find(x => x.docId === btn.dataset.docid);
            if (!r) return;

            // Roles pendientes no se pueden seleccionar
            if (!r.isAuthorized && r.role !== 'superadmin') {
                if (typeof showToast === 'function') {
                    showToast('⏳ Este rol está pendiente de aprobación', 3000);
                }
                return;
            }

            overlay.remove();

            // Establecer usuario actual con el rol seleccionado
            window._cronosCurrentUser = {
                uid:         user.uid,
                email:       user.email,
                role:        r.role,
                clubId:      r.clubId      || null,
                clubName:    r.clubName    || null,
                docId:       r.docId,
                firstName:   r.firstName   || null,
                lastName:    r.lastName    || null,
                displayName: r.displayName || null,
            };

            // Actualizar lastLogin en el documento seleccionado
            const fa = window._cronos_auth;
            fa.setDoc(
                fa.doc(fa.db, 'users', r.docId),
                { lastLogin: fa.serverTimestamp() },
                { merge: true }
            ).catch(() => {});

            enterApp();
        });
    });

    // Botón cerrar sesión
    document.getElementById('mrp-close').addEventListener('click', () => {
        overlay.remove();
        if (window._cronos_auth?.auth) {
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
                .then(({ signOut }) => signOut(window._cronos_auth.auth))
                .then(() => location.reload())
                .catch(() => location.reload());
        } else {
            location.reload();
        }
    });
}

// ── Login / Registro ─────────────────────────────────────────
export async function doAuth() {
    const fa = window._cronos_auth;
    if (!fa) { showAuthError('Firebase no disponible.'); return; }

    const email    = document.getElementById('auth-email')?.value.trim();
    let password;
    let passwordConfirm;

    if (_isLoginMode) {
        password = document.getElementById('auth-password')?.value;
    } else {
        password = document.getElementById('register-password')?.value;
        passwordConfirm = document.getElementById('register-password-confirm')?.value;
    }

    if (!email || !password) {
        showAuthError('Introduce email y contraseña.'); return;
    }

    showAuthError('⏳ Conectando…');

    try {
        // ═══════════════════════════════════════════════════════
        // LOGIN
        // ═══════════════════════════════════════════════════════
        if (_isLoginMode) {
            window._loginThisSession = true;
            await fa.signInWithEmailAndPassword(fa.auth, email, password);
            return; // onAuthStateChanged → checkAuthorization se encarga
        }

        // ═══════════════════════════════════════════════════════
        // REGISTRO
        // ═══════════════════════════════════════════════════════
        const requestedRole   = document.getElementById('auth-role')?.value          || 'user';
        const selectedClubId  = document.getElementById('auth-club-select')?.value   || null;
        const newClubName     = document.getElementById('auth-new-club-name')?.value.trim() || '';
        const reqDirectors    = parseInt(document.getElementById('auth-req-directors')?.value)    || 0;
        const reqCoordinators = parseInt(document.getElementById('auth-req-coordinators')?.value) || 0;
        const reqCoaches      = parseInt(document.getElementById('auth-req-coaches')?.value)      || 0;
        const reqParents      = parseInt(document.getElementById('auth-req-parents')?.value)      || 0;
        const firstName       = document.getElementById('auth-firstname')?.value.trim()  || '';
        const lastName        = document.getElementById('auth-lastname')?.value.trim()   || '';
        const inviteCode      = document.getElementById('auth-invite-code')?.value.trim().toUpperCase() || '';

        // ── Validaciones por rol ──────────────────────────────────
        if (requestedRole === 'club_admin' && !newClubName) {
            showAuthError('⚠️ Indica el nombre de tu club.'); return;
        }
        if (requestedRole === 'individual' && (!firstName || !lastName)) {
            showAuthError('⚠️ Nombre y apellidos obligatorios.'); return;
        }

        // ── Validaciones de contraseña ────────────────────────────
        if (password !== passwordConfirm) {
            showAuthError('❌ Las contraseñas no coinciden');
            return;
        }

        if (typeof validatePasswordStrength === 'function') {
            const valObj = validatePasswordStrength(password);
            if (!valObj.valid) {
                showAuthError('❌ Contraseña no cumple los requisitos mínimos');
                return;
            }
        }

        // ── Crear cuenta Firebase Auth ────────────────────────────
        let cred;
        let isAddingRole = false;

        try {
            cred = await fa.createUserWithEmailAndPassword(fa.auth, email, password);
        } catch (createErr) {
            if (createErr.code === 'auth/email-already-in-use') {
                // ── El email ya existe → verificar contraseña para añadir rol ──
                window._addingRole = true;
                try {
                    cred = await fa.signInWithEmailAndPassword(fa.auth, email, password);
                    isAddingRole = true;
                } catch (signInErr) {
                    window._addingRole = false;
                    showAuthError(
                        '❌ Este email ya está registrado. ' +
                        'Si es tu cuenta, introduce la contraseña correcta.'
                    );
                    window._loginThisSession = false;
                    return;
                }
            } else {
                throw createErr;
            }
        }

        const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // ── Verificar duplicado: mismo rol + mismo club para este email ──
        const existQ = m.query(
            m.collection(fa.db, 'users'),
            m.where('email', '==', email)
        );
        const existSnap = await m.getDocs(existQ);
        let duplicate = null;
        existSnap.forEach(d => {
            const data = d.data();
            if (data.role === requestedRole &&
                (data.clubId || null) === (selectedClubId || null) &&
                data.status !== 'removed' && data.status !== 'blocked') {
                duplicate = data;
            }
        });
        if (duplicate) {
            window._addingRole = false;
            showAuthError(
                '⚠️ Ya tienes registrado el rol de "' +
                (requestedRole === 'user' ? 'entrenador' : requestedRole) +
                '"' + (selectedClubId ? ' en este club' : '') + '.'
            );
            if (!isAddingRole) {
                await fa.signOut(fa.auth);
            }
            return;
        }

        // ── Limpiar documentos eliminados/bloqueados del mismo rol ──
        existSnap.forEach(d => {
            const data = d.data();
            if (data.role === requestedRole &&
                (data.status === 'removed' || data.status === 'blocked')) {
                m.deleteDoc(m.doc(fa.db, 'users', d.id)).catch(() => {});
            }
        });

        // ── Determinar autorización y rol final ──────────────────
        let finalRole    = requestedRole;
        let isAuthorized = false;
        let clubId       = selectedClubId;

        // SuperAdmin → autorización automática (mantiene el rol solicitado, no lo sobreescribe)
        if (SUPERADMIN_EMAILS.includes(email)) {
            isAuthorized = true;
        }

        // Padre/madre con código de invitación válido
        if (requestedRole === 'parent' && inviteCode) {
            const linksSnap = await m.getDocs(
                m.query(
                    m.collection(fa.db, 'cronos_player_links'),
                    m.where('inviteCode', '==', inviteCode)
                )
            );
            if (!linksSnap.empty) {
                const linkDoc = linksSnap.docs[0];
                isAuthorized  = true;
                clubId        = linkDoc.data().clubId;
                await m.updateDoc(m.doc(fa.db, 'cronos_player_links', linkDoc.id), {
                    parentUid:   cred.user.uid,
                    parentEmail: email
                });
            }
        }

        // ── Obtener nombre del club ───────────────────────────────
        let clubName = null;
        if (clubId) {
            try {
                const clubSnap = await m.getDoc(m.doc(fa.db, 'clubs', clubId));
                if (clubSnap.exists()) {
                    clubName = clubSnap.data().name || null;
                }
            } catch(e) { /* ignorar */ }
        }

        // ── Construir documento de usuario ────────────────────────
        const userData = {
            email,
            isAuthorized,
            role:          finalRole,
            requestedRole,
            clubId,
            clubName,
            status:        isAuthorized ? 'active' : 'pending',
            requestedSlot: null,
            createdAt:     fa.serverTimestamp(),
            lastLogin:     fa.serverTimestamp(),
        };

        // Datos extra para el admin de club
        if (requestedRole === 'club_admin') {
            userData.requestedClubName = newClubName;
            userData.requestedQuotas   = {
                directors:    reqDirectors,
                coordinators: reqCoordinators,
                coaches:      reqCoaches,
                parents:      reqParents,
            };
        }

        // Datos extra para usuario individual
        if (requestedRole === 'individual') {
            userData.firstName    = firstName;
            userData.lastName     = lastName;
            userData.displayName  = firstName + ' ' + lastName;
            userData.isIndividual = true;
        }

        // ── Determinar ID del documento ──────────────────────────
        // Primer registro: usa el uid de Auth como ID
        // Roles adicionales: usa uid_rol_clubId para no sobreescribir
        let docId = cred.user.uid;

        if (isAddingRole) {
            // Al añadir un rol, siempre usar ID compuesto
            docId = cred.user.uid + '_' + requestedRole + '_' + (selectedClubId || 'global');
        }

        await fa.setDoc(fa.doc(fa.db, 'users', docId), userData);

        // ── Post-registro ─────────────────────────────────────────
        window._addingRole = false;

        if (isAddingRole) {
            // ── Rol añadido a cuenta existente ────────────────────
            const roleLabel = {
                club_admin: 'Administrador de Club',
                director: 'Director Deportivo',
                coordinator: 'Coordinador',
                user: 'Entrenador',
                parent: 'Padre/Madre/Tutor',
                individual: 'Usuario Individual',
            };
            if (isAuthorized) {
                showAuthError(
                    '✅ Rol "' + (roleLabel[requestedRole] || requestedRole) +
                    '" registrado correctamente. Recargando...'
                );
            } else {
                showAuthError(
                    '✅ Rol solicitado. Pendiente de aprobación del administrador. Recargando...'
                );
            }
            // Recargar para que checkAuthorization muestre el picker con todos los roles
            setTimeout(() => location.reload(), 2000);

        } else if (!isAuthorized) {
            // ── Nuevo usuario no autorizado → cerrar sesión ───────
            await fa.signOut(fa.auth);
            const msgByRole = {
                club_admin:  '✅ Solicitud de club enviada al SuperAdmin. Recibirás confirmación por correo.',
                individual:  '✅ Solicitud enviada al SuperAdmin. Pendiente de aprobación.',
            };
            showAuthError(
                msgByRole[requestedRole] ||
                '✅ Solicitud enviada. El administrador de tu club confirmará tu acceso.'
            );
            switchTab('login');

        } else {
            // ── Nuevo usuario autorizado → entrará automáticamente ──
            // onAuthStateChanged → checkAuthorization se encarga
            showAuthError('✅ Registro completado. Entrando…');
        }

    } catch(e) {
        window._addingRole = false;
        const msgs = {
            'auth/invalid-email':        'Email no válido.',
            'auth/user-not-found':        'Usuario no encontrado.',
            'auth/wrong-password':        'Contraseña incorrecta.',
            'auth/invalid-credential':    'Email o contraseña incorrectos.',
            'auth/weak-password':         'Contraseña demasiado corta (mínimo 6 caracteres).',
        };
        showAuthError(msgs[e.code] || ('Error: ' + e.message));
        window._loginThisSession = false;
    }
}

// ── Entrar en la app ──────────────────────────────────────────
export function enterApp() {
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) authScreen.style.display = 'none';
    document.body.classList.remove('locked');
    showRoleSelection();
}

// ── Pantalla de Selección de Rol ──────────────────────────────
export function showRoleSelection() {
    const role   = window._cronosCurrentUser?.role;
    const screen = document.getElementById('role-selection-screen');
    if (!screen) return;
    screen.style.display = 'flex';

    const allCards = [
        'card-opt-superadmin', 'card-opt-clubadmin',
        'card-opt-director',   'card-opt-coordinator',
        'card-opt-coach',      'card-opt-parent',
        'card-opt-individual',
    ];

    // Ocultar todas primero
    allCards.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const show = (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    };

    if (['superadmin', 'admin'].includes(role)) {
        // El SuperAdmin ve todas para poder gestionarlas y probar
        allCards.forEach(id => show(id));
    } else if (role === 'club_admin')  { show('card-opt-clubadmin');   }
    else if (role === 'director')      { show('card-opt-director');    }
    else if (role === 'coordinator')   { show('card-opt-coordinator'); }
    else if (['coach','user'].includes(role)) { show('card-opt-coach'); }
    else if (role === 'parent')        { show('card-opt-parent');      }
    else if (role === 'individual')    { show('card-opt-individual');  }
}

// ── Lanzar App con la opción seleccionada ─────────────────────
export function selectOption(option) {
    const me = window._cronosCurrentUser;
    if (!me) return;

    const map = {
        'superadmin':  'superadmin',
        'clubadmin':   'club_admin',
        'director':    'director',
        'coordinator': 'coordinator',
        'coach':       'user',
        'parent':      'parent',
        'individual':  'individual',
    };

    me._activeRole = map[option] || me.role;

    // ── MODO PRUEBA multi-rol: el SuperAdmin necesita un club para roles no-SA ──
    const isSA         = ['superadmin','admin'].includes(me.role);
    const needsClub    = ['club_admin','director','coordinator','user','parent','individual'].includes(me._activeRole);
    const alreadyHasClub = !!me.clubId;

    if (isSA && needsClub && !alreadyHasClub) {
        // Mostrar selector de club antes de entrar al rol
        _saPickTestClub(me._activeRole);
        return;
    }

    _launchWithRole(me._activeRole);
}

// ── Selector de club para pruebas del SuperAdmin ─────────────────────
async function _saPickTestClub(targetRole) {
    const me = window._cronosCurrentUser;
    try {
        const fa = window._cronos_auth;
        const m  = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await m.getDocs(m.collection(fa.db, 'clubs'));
        const clubs = [];
        snap.forEach(d => clubs.push({ id: d.id, ...d.data() }));

        // Crear overlay de selección
        const overlay = document.createElement('div');
        overlay.id = 'sa-club-picker';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;' +
            'display:flex;align-items:center;justify-content:center;padding:1rem;';
        overlay.innerHTML = `
        <div style="background:#161b22;border:1px solid rgba(88,166,255,0.3);border-radius:16px;
                    padding:1.5rem;width:min(96vw,440px);max-height:85vh;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <div>
                    <div style="font-weight:700;font-size:1rem;color:white;">🧪 Modo Prueba</div>
                    <div style="font-size:0.76rem;color:#7d8590;margin-top:2px;">
                        ¿En qué club quieres actuar como <strong style="color:#58a6ff;">${targetRole}</strong>?
                    </div>
                </div>
                <button id="sa-picker-close"
                    style="background:none;border:none;color:#7d8590;font-size:1.5rem;cursor:pointer;">✕</button>
            </div>
            ${clubs.length === 0
                ? `<p style="color:#7d8590;text-align:center;padding:1.5rem;">No hay clubes creados aún.<br>
                   <span style="font-size:0.78rem;">Crea uno desde el panel SuperAdmin.</span></p>`
                : clubs.map(c => `
                <button class="sa-club-btn" data-id="${c.id}" data-name="${(c.name||c.id).replace(/"/g,'')}"
                    style="width:100%;text-align:left;padding:0.85rem 1rem;margin-bottom:0.5rem;
                           background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
                           border-radius:10px;cursor:pointer;color:white;font-size:0.88rem;transition:all 0.2s;">
                    🏟️ <strong>${c.name || c.id}</strong>
                    <span style="font-size:0.7rem;color:#7d8590;display:block;margin-top:2px;">
                        ${c.adminEmail || 'Sin admin'} · Plan: ${c.plan || 'free'}
                    </span>
                </button>`).join('')
            }
            <button id="sa-picker-noclub"
                style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.03);
                       border:1px dashed rgba(255,255,255,0.15);border-radius:8px;
                       color:#7d8590;font-size:0.8rem;cursor:pointer;margin-top:0.3rem;">
                Continuar sin club asignado (funcionalidad limitada)
            </button>
        </div>`;
        document.body.appendChild(overlay);

        // Hover effects
        overlay.querySelectorAll('.sa-club-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background    = 'rgba(88,166,255,0.1)';
                btn.style.borderColor   = 'rgba(88,166,255,0.35)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background    = 'rgba(255,255,255,0.04)';
                btn.style.borderColor   = 'rgba(255,255,255,0.1)';
            });
            btn.addEventListener('click', () => {
                me.clubId   = btn.dataset.id;
                me.clubName = btn.dataset.name;
                overlay.remove();
                showToast(`🧪 Actuando en "${btn.dataset.name}" como ${targetRole}`, 3000);
                _launchWithRole(me._activeRole);
            });
        });

        document.getElementById('sa-picker-close').addEventListener('click', () => {
            overlay.remove();
            document.getElementById('role-selection-screen').style.display = 'flex';
        });
        document.getElementById('sa-picker-noclub').addEventListener('click', () => {
            overlay.remove();
            _launchWithRole(me._activeRole);
        });

    } catch(e) {
        console.error('Error cargando clubes para prueba:', e);
        _launchWithRole(me._activeRole);
    }
}

function _launchWithRole(role) {
    const activeRole = window._cronosCurrentUser?._activeRole || role;
    document.getElementById('role-selection-screen').style.display = 'none';

    // Roles que usan la interfaz de campo (entrenador / usuario / individual)
    const isFieldRole = ['user', 'coach', 'individual'].includes(activeRole);
    const isParent    = (activeRole === 'parent');
    const isSA        = (activeRole === 'superadmin');
    const isAdminJob  = ['director', 'coordinator', 'club_admin'].includes(activeRole);

    document.getElementById('main-container').style.display = isFieldRole ? 'flex' : 'none';
    document.getElementById('main-header').style.display    = isFieldRole ? 'flex' : 'none';

    if (isAdminJob || isSA) {
        document.body.style.background = '#0d1117';
    } else if (isFieldRole) {
        document.body.style.background = '';
    }

    const btnAdmin = document.getElementById('btn-admin-panel');
    if (btnAdmin) {
        btnAdmin.style.display = (
            ['admin', 'superadmin'].includes(window._cronosCurrentUser.role) &&
            activeRole === window._cronosCurrentUser.role
        ) ? 'inline-block' : 'none';
    }

    const btnClub = document.getElementById('btn-club-panel');
    if (btnClub) {
        btnClub.style.display =
            (window._cronosCurrentUser.role === 'club_admin') ? 'inline-block' : 'none';
    }

    sessionStorage.setItem('cronos_session_uid',   window._cronosCurrentUser.uid);
    sessionStorage.setItem('cronos_session_email', window._cronosCurrentUser.email);
    sessionStorage.setItem('cronos_session_role',  activeRole);

    if (activeRole === 'parent') {
        if (typeof openParentPanel === 'function') openParentPanel();
    } else if (activeRole === 'superadmin') {
        if (typeof openSuperAdminPanel === 'function') openSuperAdminPanel();
    } else if (activeRole === 'club_admin') {
        if (typeof openClubAdminPanel === 'function') openClubAdminPanel();
    } else if (['director', 'coordinator'].includes(activeRole)) {
        if (typeof init === 'function') init(activeRole);
        if (typeof openStaffDashboard === 'function') openStaffDashboard();
    } else {
        // user / coach / individual → interfaz de campo
        if (typeof init === 'function') init(activeRole);
    }
}

// ── Logout ─────────────────────────────────────────────────
window.logoutUser = () => {
    if (!confirm('¿Seguro que deseas salir y volver al inicio?')) return;
    sessionStorage.clear();
    if (window._cronos_auth?.auth) {
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
            .then(({ signOut }) => {
                signOut(window._cronos_auth.auth).finally(() => location.reload());
            })
            .catch(() => location.reload());
    } else {
        location.reload();
    }
};

// ── Exportación Global ───────────────────────────────────────
window.switchTab            = switchTab;
window.handleRoleChange     = handleRoleChange;
window.doAuth               = doAuth;
window.selectOption         = selectOption;
window._checkAuthorization  = checkAuthorization;
window.enterApp             = enterApp;
window.showRoleSelector     = showRoleSelection;
window.showAuthError        = showAuthError;
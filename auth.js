/**
 * auth.js - Gestión de Autenticación y Autorización
 * Cronos Fútbol — v5.1 (multi-rol sin queries, compatible con firestore rules)
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
    if (registerPwdSec) registerPwdSec.style.display = _isLoginMode ? 'none' : 'block';

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
        select.innerHTML = '<option value="">⚠️ Error al cargar clubes — actualiza la página</option>';
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

    if (clubCont)    clubCont.style.display    = (!isClubAdmin && !isIndividual) ? 'block' : 'none';
    if (newClubCont) newClubCont.style.display  = isClubAdmin ? 'block' : 'none';
    if (inviteCont)  inviteCont.style.display   = isParent ? 'block' : 'none';
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
const SUPERADMIN_EMAILS = ['jarg7435@gmail.com'];

export async function checkAuthorization(user) {
    if (!user) return;
    const fa = window._cronos_auth;
    if (!fa) return;

    // Si se está añadiendo un rol, no interferir
    if (window._addingRole) {
        console.log('[Cronos] Autorización pospuesta (añadiendo rol)...');
        return;
    }

    try {
        // ── Leer SOLO el documento principal (por uid) ─────────
        // Esto siempre está permitido por la regla: request.auth.uid == userId
        const ref  = fa.doc(fa.db, 'users', user.uid);
        const snap = await fa.getDoc(ref);

        // ── CASO 1: Documento NO existe ─────────────────────────
        if (!snap.exists()) {
            if (SUPERADMIN_EMAILS.includes(user.email)) {
                await fa.setDoc(ref, {
                    email:        user.email,
                    role:         'superadmin',
                    isAuthorized: true,
                    status:       'active',
                    createdAt:    fa.serverTimestamp(),
                    lastLogin:    fa.serverTimestamp(),
                    autoRecovered: true,
                    allRoles: [{ role: 'superadmin', clubId: null, clubName: null, isAuthorized: true }],
                });
                window._cronosCurrentUser = {
                    uid:     user.uid,
                    email:   user.email,
                    role:    'superadmin',
                    clubId:  null,
                    clubName: null,
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

        const data = snap.data();

        // ── CASO 2: Cuenta eliminada ───────────────────────────
        if (data.status === 'removed') {
            await fa.signOut(fa.auth);
            showAuthError(
                '🔄 Tu cuenta fue dada de baja. ' +
                'Puedes registrarte de nuevo con el mismo email.'
            );
            return;
        }

        // ── CASO 3: Cuenta bloqueada ───────────────────────────
        if (data.status === 'blocked') {
            await fa.signOut(fa.auth);
            showAuthError('🔒 Cuenta bloqueada. Contacta con tu administrador.');
            return;
        }

        // ── CASO 3b: Pendiente de que Club Admin reenvíe a SA ─────────
        if (data.status === 'pending_club_admin') {
            // Check if SA already approved (user might have been offline when approved)
            try {
                // Build list of possible platform_request IDs to check
                const possibleIds3b = ['self_reg_' + user.uid];
                const existingRoles3b = data.allRoles || [{ role: data.role, clubId: data.clubId }];
                existingRoles3b.forEach(er => {
                    const rid = 'self_reg_' + user.uid + '_' + (er.role || '') + '_' + (er.clubId || '');
                    if (!possibleIds3b.includes(rid)) possibleIds3b.push(rid);
                });

                for (let i3b = 0; i3b < possibleIds3b.length; i3b++) {
                    try {
                        const prRef3b = fa.doc(fa.db, 'platform_requests', possibleIds3b[i3b]);
                        const prSnap3b = await fa.getDoc(prRef3b);
                        if (!prSnap3b.exists()) continue;
                        const prData3b = prSnap3b.data();

                        if (prData3b.status === 'sa_approved' || prData3b.status === 'approved') {
                            // SA already approved — jump to activation
                            console.log('[Cronos] SA approval found while in pending_club_admin. Activating...');
                            const approvedAllRoles3b = prData3b.approvedAllRoles || data.allRoles || [];
                            const activateUpdate3b = {
                                status: 'active',
                                isAuthorized: true,
                                allRoles: approvedAllRoles3b,
                                approvedBySA: true,
                                approvedBySAAt: prData3b.approvedAt || new Date().toISOString(),
                                authorizedAt: new Date().toISOString(),
                                lastLogin: fa.serverTimestamp(),
                            };
                            if (prData3b.approvedRole) activateUpdate3b.role = prData3b.approvedRole;
                            if (prData3b.approvedClubId) activateUpdate3b.clubId = prData3b.approvedClubId;
                            if (prData3b.approvedClubName) activateUpdate3b.clubName = prData3b.approvedClubName;
                            await fa.updateDoc(ref, activateUpdate3b);
                            await fa.updateDoc(prRef3b, { status: 'active', appliedAt: new Date().toISOString() });
                            showAuthError('✅ Solicitud aprobada. Activando...');
                            setTimeout(() => location.reload(), 1500);
                            return;
                        }
                    } catch (_) { /* skip this ID, try next */ }
                }
            } catch (_) { /* ignore check errors, proceed to show waiting message */ }

            await fa.signOut(fa.auth);
            showAuthError(
                '⏳ Tu solicitud está pendiente. ' +
                'El administrador de tu club debe reenviarla al SuperAdmin para su aprobación.'
            );
            return;
        }

        // ── CASO 3c: Pendiente de aprobación SA (reenviado por Club Admin) ─
        if (data.status === 'pending_sa') {
            // Check if SA already approved via platform_request
            try {
                const prId = 'self_reg_' + user.uid;
                const prRef = fa.doc(fa.db, 'platform_requests', prId);
                const prSnap = await fa.getDoc(prRef);

                if (prSnap.exists()) {
                    const prData = prSnap.data();

                    if (prData.status === 'sa_approved') {
                        // ═══════════════════════════════════════════════
                        // AUTO-ACTIVATE: SA approved, user can write own doc
                        // ═══════════════════════════════════════════════
                        console.log('[Cronos] SA approval detected. Auto-activating...');

                        const approvedAllRoles = prData.approvedAllRoles || data.allRoles || [];
                        const alreadyHasActiveRole = (data.isAuthorized === true);

                        // Build update for user doc
                        const activateUpdate = {
                            allRoles: approvedAllRoles,
                            approvedBySA: true,
                            approvedBySAAt: prData.approvedAt || new Date().toISOString(),
                            authorizedAt: new Date().toISOString(),
                        };

                        if (!alreadyHasActiveRole && prData.approvedIsAuthorized) {
                            activateUpdate.isAuthorized = true;
                            activateUpdate.status = 'active';
                            if (prData.approvedRole) activateUpdate.role = prData.approvedRole;
                            if (prData.approvedClubId) activateUpdate.clubId = prData.approvedClubId;
                            if (prData.approvedClubName) activateUpdate.clubName = prData.approvedClubName;
                            activateUpdate.lastLogin = fa.serverTimestamp();
                        }

                        await fa.updateDoc(ref, activateUpdate);

                        // Mark platform_request as applied
                        await fa.updateDoc(prRef, { status: 'active', appliedAt: new Date().toISOString() });

                        // Re-read user doc and continue normal flow
                        const updatedSnap = await fa.getDoc(ref);
                        if (updatedSnap.exists()) {
                            const updatedData = updatedSnap.data();
                            const finalAllRoles = updatedData.allRoles || approvedAllRoles;
                            const authorizedRoles = finalAllRoles.filter(r =>
                                r.isAuthorized || r.role === 'superadmin'
                            );

                            if (authorizedRoles.length === 1) {
                                const ar = authorizedRoles[0];
                                window._cronosCurrentUser = {
                                    uid: user.uid, email: user.email,
                                    role: ar.role,
                                    clubId: ar.clubId || null,
                                    clubName: ar.clubName || null,
                                    firstName: ar.firstName || null,
                                    lastName: ar.lastName || null,
                                    displayName: ar.displayName || null,
                                };
                                enterApp();
                                return;
                            } else if (authorizedRoles.length > 1) {
                                _showMultiRolePicker(user, authorizedRoles);
                                return;
                            }
                        }

                        // Fallback: reload
                        showAuthError('✅ Solicitud aprobada. Activando...');
                        setTimeout(() => location.reload(), 1500);
                        return;
                    }

                    if (prData.status === 'approved') {
                        // Already fully applied — reload to refresh
                        showAuthError('✅ Solicitud aprobada. Cargando...');
                        setTimeout(() => location.reload(), 1500);
                        return;
                    }
                }

                // Also check secondary platform_request IDs (for multi-role additions)
                // Format: self_reg_{uid}_{role}_{clubId}
                const allPossibleIds = [
                    'self_reg_' + user.uid,
                ];
                // Try common role+club combos from existing allRoles
                const existingRoles = data.allRoles || [{ role: data.role, clubId: data.clubId }];
                existingRoles.forEach(er => {
                    const rid = 'self_reg_' + user.uid + '_' + (er.role || '') + '_' + (er.clubId || '');
                    if (!allPossibleIds.includes(rid)) allPossibleIds.push(rid);
                });

                for (let pi = 0; pi < allPossibleIds.length; pi++) {
                    if (allPossibleIds[pi] === prId) continue; // already checked
                    try {
                        const altRef = fa.doc(fa.db, 'platform_requests', allPossibleIds[pi]);
                        const altSnap = await fa.getDoc(altRef);
                        if (altSnap.exists() && altSnap.data().status === 'sa_approved') {
                            // Same auto-activation logic
                            const altData = altSnap.data();
                            const altAllRoles = altData.approvedAllRoles || data.allRoles || [];
                            const altUpdate = {
                                allRoles: altAllRoles,
                                approvedBySA: true,
                                approvedBySAAt: altData.approvedAt || new Date().toISOString(),
                                authorizedAt: new Date().toISOString(),
                            };
                            if (!data.isAuthorized && altData.approvedIsAuthorized) {
                                altUpdate.isAuthorized = true;
                                altUpdate.status = 'active';
                                if (altData.approvedRole) altUpdate.role = altData.approvedRole;
                                if (altData.approvedClubId) altUpdate.clubId = altData.approvedClubId;
                                if (altData.approvedClubName) altUpdate.clubName = altData.approvedClubName;
                                altUpdate.lastLogin = fa.serverTimestamp();
                            }
                            await fa.updateDoc(ref, altUpdate);
                            await fa.updateDoc(altRef, { status: 'active', appliedAt: new Date().toISOString() });
                            showAuthError('✅ Solicitud aprobada. Activando...');
                            setTimeout(() => location.reload(), 1500);
                            return;
                        }
                    } catch (_) { /* skip */ }
                }
            } catch (prErr) {
                console.warn('[Cronos] Error checking platform_request:', prErr.message);
            }

            // Not approved yet — show waiting message
            await fa.signOut(fa.auth);
            showAuthError(
                '⏳ Tu solicitud fue reenviada al SuperAdmin. ' +
                'Espera la confirmación de aprobación.'
            );
            return;
        }

        // ── CASO 4: Pendiente de aprobación ────────────────────
        if (!data.isAuthorized) {
            await fa.signOut(fa.auth);
            showAuthError(
                '⏳ Acceso pendiente de aprobación. ' +
                'El administrador de tu club debe confirmar tu acceso.'
            );
            return;
        }

        // ── Obtener todos los roles desde allRoles ──────────────
        // Compatibilidad: si no existe allRoles, construir desde el documento
        const allRoles = data.allRoles || [{
            role:        data.role,
            clubId:      data.clubId      || null,
            clubName:    data.clubName    || null,
            isAuthorized: data.isAuthorized || (data.role === 'superadmin'),
            firstName:   data.firstName   || null,
            lastName:    data.lastName    || null,
            displayName: data.displayName || null,
        }];

        // Filtrar solo roles autorizados
        const authorizedRoles = allRoles.filter(r =>
            r.isAuthorized || r.role === 'superadmin'
        );

        if (authorizedRoles.length === 0) {
            await fa.signOut(fa.auth);
            showAuthError('⚠️ Tu cuenta no tiene roles autorizados.');
            return;
        }

        // ── Un solo rol → entrar directamente ───────────────────
        if (authorizedRoles.length === 1) {
            const r = authorizedRoles[0];
            await fa.setDoc(ref, { lastLogin: fa.serverTimestamp() }, { merge: true });

            window._cronosCurrentUser = {
                uid:         user.uid,
                email:       user.email,
                role:        r.role,
                clubId:      r.clubId      || null,
                clubName:    r.clubName    || null,
                firstName:   r.firstName   || null,
                lastName:    r.lastName    || null,
                displayName: r.displayName || null,
            };
            enterApp();
            return;
        }

        // ── Múltiples roles → mostrar selector ─────────────────
        _showMultiRolePicker(user, authorizedRoles);

    } catch (err) {
        console.error('Auth verify error:', err);
        showAuthError('Error de verificación: ' + err.message);
    }
}

// ── Selector Multi-Rol (sin query, usa datos del documento) ──
function _showMultiRolePicker(user, roles) {
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

        return '<button class="mrp-btn" data-role="' + r.role + '" data-clubid="' + (r.clubId||'') + '" ' +
            'data-clubname="' + (r.clubName||'') + '" ' +
            'data-fn="' + (r.firstName||'') + '" data-ln="' + (r.lastName||'') + '" ' +
            'data-dn="' + (r.displayName||'') + '" ' +
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

    // Eventos
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
            const role = btn.dataset.role;
            const isAuth = roles.find(r => r.role === role &&
                (r.clubId || null) === (btn.dataset.clubid || null));

            if (!isAuth) return;

            if (!isAuth.isAuthorized && role !== 'superadmin') {
                if (typeof showToast === 'function') {
                    showToast('⏳ Este rol está pendiente de aprobación', 3000);
                }
                return;
            }

            overlay.remove();

            window._cronosCurrentUser = {
                uid:         user.uid,
                email:       user.email,
                role:        role,
                clubId:      btn.dataset.clubid   || null,
                clubName:    btn.dataset.clubname  || null,
                firstName:   btn.dataset.fn        || null,
                lastName:    btn.dataset.ln        || null,
                displayName: btn.dataset.dn        || null,
            };

            // Actualizar lastLogin
            const fa = window._cronos_auth;
            fa.setDoc(
                fa.doc(fa.db, 'users', user.uid),
                { lastLogin: fa.serverTimestamp() },
                { merge: true }
            ).catch(() => {});

            enterApp();
        });
    });

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
            return; // onAuthStateChanged → checkAuthorization
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

        // ── Validaciones por rol ────────────────────────────────
        if (requestedRole === 'club_admin' && !newClubName) {
            showAuthError('⚠️ Indica el nombre de tu club.'); return;
        }
        if (requestedRole === 'individual' && (!firstName || !lastName)) {
            showAuthError('⚠️ Nombre y apellidos obligatorios.'); return;
        }

        // ── Validaciones de contraseña ──────────────────────────
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

        // ── Crear cuenta Firebase Auth ──────────────────────────
        let cred;
        let isAddingRole = false;

        try {
            cred = await fa.createUserWithEmailAndPassword(fa.auth, email, password);
        } catch (createErr) {
            if (createErr.code === 'auth/email-already-in-use') {
                // Email ya existe → verificar contraseña para añadir rol
                window._addingRole = true;
                try {
                    cred = await fa.signInWithEmailAndPassword(fa.auth, email, password);
                    isAddingRole = true;
                } catch (signInErr) {
                    window._addingRole = false;
                    window._loginThisSession = false;

                    // Distinguir entre errores de contraseña y otros
                    if (signInErr.code === 'auth/wrong-password' || signInErr.code === 'auth/invalid-credential') {
                        showAuthError(
                            '⚠️ Este email ya está registrado, pero la contraseña no coincide. ' +
                            'Para añadir el rol de "' + (requestedRole === 'user' ? 'entrenador' : requestedRole === 'parent' ? 'padre/madre/tutor' : requestedRole === 'director' ? 'director deportivo' : requestedRole === 'coordinator' ? 'coordinador' : requestedRole) +
                            '" a tu cuenta, debes iniciar sesión con la contraseña original y ' +
                            'luego usar la pestaña de Registro para añadir el nuevo rol.'
                        );
                    } else if (signInErr.code === 'auth/user-not-found') {
                        showAuthError(
                            '⚠️ Esta cuenta fue eliminada. ' +
                            'Puedes registrarte de nuevo con el mismo email.'
                        );
                    } else if (signInErr.code === 'auth/too-many-requests') {
                        showAuthError(
                            '⚠️ Demasiados intentos fallidos. ' +
                            'Espera unos minutos e inténtalo de nuevo.'
                        );
                    } else {
                        showAuthError(
                            '⚠️ Este email ya está registrado. ' +
                            'Para añadir un nuevo rol, debes usar la misma contraseña con la que te registraste originalmente.'
                        );
                    }
                    return;
                }
            } else {
                throw createErr;
            }
        }

        // ── Determinar autorización y rol final ─────────────────
        let finalRole    = requestedRole;
        let isAuthorized = false;
        let clubId       = selectedClubId;
        let clubName     = null;

        if (SUPERADMIN_EMAILS.includes(email)) {
            isAuthorized = true;
        }

        // Padre con código de invitación
        if (requestedRole === 'parent' && inviteCode) {
            const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
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

        // Obtener nombre del club
        if (clubId) {
            try {
                const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                const clubSnap = await m.getDoc(m.doc(fa.db, 'clubs', clubId));
                if (clubSnap.exists()) {
                    clubName = clubSnap.data().name || null;
                }
            } catch(e) { /* ignorar */ }
        }

        // ── Registrar displayName para individual ───────────────
        let displayName = null;
        if (requestedRole === 'individual') {
            displayName = firstName + ' ' + lastName;
        }

        if (isAddingRole) {
            // ═══════════════════════════════════════════════════
            // AÑADIR ROL A CUENTA EXISTENTE (sin queries)
            // ═══════════════════════════════════════════════════

            // 1. Leer documento principal (permitido: uid == userId)
            const primarySnap = await fa.getDoc(fa.doc(fa.db, 'users', cred.user.uid));

            if (!primarySnap.exists()) {
                // El email existe en Firebase Auth pero no hay documento en Firestore
                // (fue borrado o nunca se creó). Tratar como REGISTRO NUEVO.
                window._addingRole = false;
                console.log('[Cronos] Auth account exists but no user doc — creating new registration.');

                const newAllRoles = [{
                    role:        finalRole,
                    clubId:      clubId,
                    clubName:    clubName,
                    isAuthorized: isAuthorized,
                    firstName:   firstName || null,
                    lastName:    lastName || null,
                    displayName: displayName,
                }];

                const needsApproval = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
                const userStatus = isAuthorized
                    ? 'active'
                    : (needsApproval ? 'pending_club_admin' : 'pending');

                const newUserData = {
                    email,
                    isAuthorized,
                    role:          finalRole,
                    clubId,
                    clubName,
                    allRoles:      newAllRoles,
                    status:        userStatus,
                    createdAt:     fa.serverTimestamp(),
                    lastLogin:     fa.serverTimestamp(),
                };

                await fa.setDoc(fa.doc(fa.db, 'users', cred.user.uid), newUserData);

                // Create platform_request for Club Admin
                if (needsApproval && clubId) {
                    const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
                    const reqId = 'self_reg_' + cred.user.uid;
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', reqId), {
                        type: 'self_registration',
                        clubId: clubId,
                        clubName: clubName || '',
                        requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole,
                        requestedRoleLabel: ROLE_LABELS[finalRole] || finalRole,
                        userUid: cred.user.uid,
                        status: 'pending_club_admin',
                        createdAt: new Date().toISOString(),
                    }).catch(e => console.warn('[Cronos] Error creating platform_request:', e));
                }

                // Show result message
                if (!isAuthorized) {
                    await fa.signOut(fa.auth);
                    const rl = { director:'Director Deportivo', coordinator:'Coordinador', user:'Entrenador', parent:'Padre/Madre/Tutor', club_admin:'Administrador de Club', individual:'Usuario Individual' };
                    showAuthError(
                        '✅ Solicitud de "' + (rl[requestedRole] || requestedRole) +
                        '" enviada. ⏳ Esperar confirmación — el administrador de tu club debe reenviar la solicitud al SuperAdmin.'
                    );
                    switchTab('login');
                } else {
                    showAuthError('✅ Registro completado. Recargando...');
                    setTimeout(() => location.reload(), 2000);
                }
                return;
            }

            const primaryData = primarySnap.data();

            // ── CHECK: If user was removed, treat as NEW registration ──
            if (primaryData.status === 'removed') {
                console.log('[Cronos] Previous account was removed. Creating fresh registration.');
                // Delete the stale doc completely
                try { await fa.deleteDoc(fa.doc(fa.db, 'users', cred.user.uid)); } catch(_) {}
                // Also delete any platform_requests for this user
                try {
                    const m2 = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    const prRef2 = m2.doc(fa.db, 'platform_requests', 'self_reg_' + cred.user.uid);
                    const prSnap2 = await m2.getDoc(prRef2);
                    if (prSnap2.exists()) { await m2.deleteDoc(prRef2); }
                } catch(_) {}
                window._addingRole = false;

                // Create fresh registration (same logic as new user section below)
                const freshAllRoles = [{ role: finalRole, clubId, clubName, isAuthorized: isAuthorized, firstName: firstName || null, lastName: lastName || null, displayName }];
                const freshNeedsApproval = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
                const freshStatus = isAuthorized ? 'active' : (freshNeedsApproval ? 'pending_club_admin' : 'pending');
                const freshData = { email, isAuthorized, role: finalRole, clubId, clubName, allRoles: freshAllRoles, status: freshStatus, requestedSlot: null, createdAt: fa.serverTimestamp(), lastLogin: fa.serverTimestamp() };
                if (requestedRole === 'club_admin') { freshData.requestedClubName = newClubName; freshData.requestedQuotas = { directors: reqDirectors, coordinators: reqCoordinators, coaches: reqCoaches, parents: reqParents }; }
                if (requestedRole === 'individual') { freshData.firstName = firstName; freshData.lastName = lastName; freshData.displayName = displayName; freshData.isIndividual = true; }
                await fa.setDoc(fa.doc(fa.db, 'users', cred.user.uid), freshData);

                // Create platform_request for Club Admin
                if (freshNeedsApproval && clubId) {
                    const RL2 = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', 'self_reg_' + cred.user.uid), {
                        type: 'self_registration', clubId, clubName: clubName || '', requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole, requestedRoleLabel: RL2[finalRole] || finalRole,
                        userUid: cred.user.uid, status: 'pending_club_admin', createdAt: new Date().toISOString(),
                    }).catch(function(e) { console.warn('[Cronos] Error creating platform_request:', e); });
                }

                const rl3 = { director:'Director Deportivo', coordinator:'Coordinador', user:'Entrenador', parent:'Padre/Madre/Tutor', club_admin:'Administrador de Club', individual:'Usuario Individual' };
                if (!isAuthorized) {
                    await fa.signOut(fa.auth);
                    showAuthError('✅ Registro de "' + (rl3[requestedRole] || requestedRole) + '" completado. ⏳ Espera confirmación del administrador del club.');
                    switchTab('login');
                } else {
                    showAuthError('✅ Registro completado. Recargando...');
                    setTimeout(function() { location.reload(); }, 2000);
                }
                return;
            }

            // 2. Verificar duplicado en allRoles (only if NOT removed)
            const currentRoles = primaryData.allRoles || [{
                role:        primaryData.role,
                clubId:      primaryData.clubId      || null,
                clubName:    primaryData.clubName    || null,
                isAuthorized: primaryData.isAuthorized || false,
            }];

            const duplicate = currentRoles.find(r =>
                r.role === requestedRole &&
                (r.clubId || null) === (clubId || null)
            );

            if (duplicate) {
                window._addingRole = false;

                const ROLE_LABELS = {
                    user: 'entrenador', parent: 'padre/madre/tutor',
                    coordinator: 'coordinador', director: 'director deportivo',
                    club_admin: 'administrador de club', individual: 'usuario individual',
                };
                const roleLabel = ROLE_LABELS[requestedRole] || requestedRole;
                const clubInfo = clubId ? ' en este club' : '';

                if (duplicate.isAuthorized) {
                    // Role is already active — user can just log in and select it
                    showAuthError(
                        '✅ Ya tienes el rol de "' + roleLabel + '"' + clubInfo +
                        ' y está activado. Inicia sesión y selecciónalo.'
                    );
                } else {
                    // Role exists but is pending approval
                    // Check if there's a platform_request for this role
                    let prStatus = null;
                    try {
                        const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                        const prId = 'self_reg_' + cred.user.uid + '_' + requestedRole + '_' + (clubId || '');
                        const prSnap = await m.getDoc(m.doc(fa.db, 'platform_requests', prId));
                        if (prSnap.exists()) {
                            prStatus = prSnap.data().status;
                        }
                    } catch (_) { /* ignore */ }

                    let statusMsg = '';
                    if (prStatus === 'pending_club_admin') {
                        statusMsg = ' ⏳ Tu solicitud está pendiente de que el administrador del club la reenvíe al SuperAdmin.';
                    } else if (prStatus === 'pending_sa') {
                        statusMsg = ' ⏳ Tu solicitud fue reenviada al SuperAdmin. Espera la confirmación.';
                    } else if (prStatus === 'sa_approved') {
                        statusMsg = ' ✅ El SuperAdmin aprobó tu solicitud. Inicia sesión para activarla automáticamente.';
                    } else if (prStatus === 'rejected') {
                        statusMsg = ' ❌ Tu solicitud fue rechazada. Contacta con tu administrador de club.';
                    } else {
                        statusMsg = ' ⏳ Este rol está pendiente de aprobación. Inicia sesión para comprobar el estado.';
                    }

                    showAuthError(
                        'ℹ️ Ya tienes una solicitud de "' + roleLabel + '"' + clubInfo +
                        ' registrada.' + statusMsg
                    );
                }

                // Sign out since we signed in during the isAddingRole flow
                await fa.signOut(fa.auth).catch(() => {});
                switchTab('login');
                return;
            }

            // 3. Añadir nuevo rol al array allRoles
            const needsApprovalFlag = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
            const newRoleEntry = {
                role:        finalRole,
                clubId:      clubId,
                clubName:    clubName,
                isAuthorized: isAuthorized,
                status:      isAuthorized ? 'active' : (needsApprovalFlag && clubId ? 'pending_club_admin' : 'pending'),
                firstName:   firstName || null,
                lastName:    lastName || null,
                displayName: displayName,
            };

            currentRoles.push(newRoleEntry);

            // 4. Actualizar documento principal (always works — user writes own doc)
            await fa.setDoc(
                fa.doc(fa.db, 'users', cred.user.uid),
                { allRoles: currentRoles },
                { merge: true }
            );

            // 5. Crear documento secundario (para queries del club admin)
            // This may fail due to Firestore rules (doc ID != uid), so wrap in try-catch
            const needsApprovalSecondary = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
            const secondaryStatus = isAuthorized ? 'active' : (needsApprovalSecondary && clubId ? 'pending_club_admin' : 'pending');
            try {
                const secondaryId = cred.user.uid + '_' + requestedRole + '_' + (clubId || 'global');
                const secondaryData = {
                    email,
                    uid:       cred.user.uid,
                    isAuthorized,
                    role:      finalRole,
                    clubId,
                    clubName,
                    status:    secondaryStatus,
                    createdAt: fa.serverTimestamp(),
                    lastLogin: fa.serverTimestamp(),
                };
                if (requestedRole === 'club_admin') {
                    secondaryData.requestedClubName = newClubName;
                    secondaryData.requestedQuotas   = {
                        directors:    reqDirectors,
                        coordinators: reqCoordinators,
                        coaches:      reqCoaches,
                        parents:      reqParents,
                    };
                }
                if (requestedRole === 'individual') {
                    secondaryData.firstName    = firstName;
                    secondaryData.lastName     = lastName;
                    secondaryData.displayName  = displayName;
                    secondaryData.isIndividual = true;
                }
                await fa.setDoc(fa.doc(fa.db, 'users', secondaryId), secondaryData);
            } catch (secErr) {
                console.warn('[Cronos] Secondary doc creation failed (permissions). Non-critical — allRoles is the source of truth.', secErr.message);
            }

            // 6. If role needs club approval, create platform_request for Club Admin
            const needsApproval = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
            if (needsApproval && clubId) {
                try {
                    const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
                    const reqId = 'self_reg_' + cred.user.uid + '_' + requestedRole + '_' + (clubId || '');
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', reqId), {
                        type: 'self_registration',
                        clubId: clubId,
                        clubName: clubName || '',
                        requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole,
                        requestedRoleLabel: ROLE_LABELS[finalRole] || finalRole,
                        userUid: cred.user.uid,
                        status: 'pending_club_admin',
                        createdAt: new Date().toISOString(),
                    });
                } catch (prErr) {
                    console.warn('[Cronos] platform_request creation failed (permissions). allRoles is the source of truth.', prErr.message);
                }
            }

            window._addingRole = false;

            // Mostrar resultado
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
            } else if (needsApproval) {
                await fa.signOut(fa.auth);
                showAuthError(
                    '✅ Rol "' + (roleLabel[requestedRole] || requestedRole) +
                    '" solicitado. ⏳ Esperar confirmación — el administrador de tu club debe reenviar la solicitud al SuperAdmin.'
                );
                switchTab('login');
            } else {
                showAuthError(
                    '✅ Rol solicitado. Pendiente de aprobación. Recargando...'
                );
            }
            if (isAuthorized || !needsApproval) {
                setTimeout(() => location.reload(), 2000);
            }

        } else {
            // ═══════════════════════════════════════════════════
            // NUEVO USUARIO (primer registro)
            // ═══════════════════════════════════════════════════

            const allRoles = [{
                role:        finalRole,
                clubId:      clubId,
                clubName:    clubName,
                isAuthorized: isAuthorized,
                firstName:   firstName || null,
                lastName:    lastName || null,
                displayName: displayName,
            }];

            // Determine status: pending_club_admin for roles needing club+SA approval
            const needsClubApproval = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
            const userStatus = isAuthorized
                ? 'active'
                : (needsClubApproval ? 'pending_club_admin' : 'pending');

            const userData = {
                email,
                isAuthorized,
                role:          finalRole,
                clubId,
                clubName,
                allRoles,
                status:        userStatus,
                requestedSlot: null,
                createdAt:     fa.serverTimestamp(),
                lastLogin:     fa.serverTimestamp(),
            };

            if (requestedRole === 'club_admin') {
                userData.requestedClubName = newClubName;
                userData.requestedQuotas   = {
                    directors:    reqDirectors,
                    coordinators: reqCoordinators,
                    coaches:      reqCoaches,
                    parents:      reqParents,
                };
            }

            if (requestedRole === 'individual') {
                userData.firstName    = firstName;
                userData.lastName     = lastName;
                userData.displayName  = displayName;
                userData.isIndividual = true;
            }

            await fa.setDoc(fa.doc(fa.db, 'users', cred.user.uid), userData);

            // Also create a platform_request so Club Admin sees it
            if (needsClubApproval && clubId) {
                const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
                const reqId = 'self_reg_' + cred.user.uid;
                await fa.setDoc(fa.doc(fa.db, 'platform_requests', reqId), {
                    type: 'self_registration',
                    clubId: clubId,
                    clubName: clubName || '',
                    requestedEmail: email,
                    requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                    requestedRole: finalRole,
                    requestedRoleLabel: ROLE_LABELS[finalRole] || finalRole,
                    userUid: cred.user.uid,
                    status: 'pending_club_admin',
                    createdAt: new Date().toISOString(),
                });
            }

            // Post-registro
            if (!isAuthorized) {
                await fa.signOut(fa.auth);
                const msgByRole = {
                    club_admin:  '✅ Solicitud de club enviada al SuperAdmin. Recibirás confirmación por correo.',
                    individual:  '✅ Solicitud enviada al SuperAdmin. Pendiente de aprobación.',
                };
                showAuthError(
                    msgByRole[requestedRole] ||
                    '✅ Solicitud enviada. ⏳ Esperar confirmación — el administrador de tu club debe reenviarla al SuperAdmin. Recibirás confirmación cuando sea aprobada.'
                );
                switchTab('login');
            } else {
                showAuthError('✅ Registro completado. Entrando…');
            }
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

    allCards.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const show = (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    };

    if (['superadmin', 'admin'].includes(role)) {
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

    const isSA         = ['superadmin','admin'].includes(me.role);
    const needsClub    = ['club_admin','director','coordinator','user','parent','individual'].includes(me._activeRole);
    const alreadyHasClub = !!me.clubId;

    if (isSA && needsClub && !alreadyHasClub) {
        _saPickTestClub(me._activeRole);
        return;
    }

    _launchWithRole(me._activeRole);
}

// ── Selector de club para pruebas del SuperAdmin ──────────────
async function _saPickTestClub(targetRole) {
    const me = window._cronosCurrentUser;
    try {
        const fa = window._cronos_auth;
        const m  = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await m.getDocs(m.collection(fa.db, 'clubs'));
        const clubs = [];
        snap.forEach(d => clubs.push({ id: d.id, ...d.data() }));

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

    // ── Botón ADMIN solo para rol "individual" ────────────────────
    const btnIndAdmin = document.getElementById('btn-individual-admin');
    if (btnIndAdmin) {
        if (activeRole === 'individual') {
            btnIndAdmin.style.display    = 'inline-flex';
            btnIndAdmin.style.visibility = 'visible';
        } else {
            btnIndAdmin.style.display = 'none';
        }
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
    } else if (activeRole === 'individual') {
        // Individual: lanzar el campo de juego normal
        if (typeof init === 'function') init(activeRole);
    } else {
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
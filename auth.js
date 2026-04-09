/**
 * auth.js - Gestión de Autenticación y Autorización
 * Cronos Fútbol
 */

// ── Estado Local ──────────────────────────────────────────────
let _isLoginMode = true;

// ── Cambiar entre Login y Registro ──────────────────────────
export function switchTab(tab) {
    _isLoginMode = (tab === 'login');
    const loginTab = document.getElementById('tab-login');
    const regTab   = document.getElementById('tab-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    if (loginTab) loginTab.classList.toggle('active', _isLoginMode);
    if (regTab)   regTab.classList.toggle('active', !_isLoginMode);
    
    if (loginForm)    loginForm.style.display = _isLoginMode ? 'block' : 'none';
    if (registerForm) registerForm.style.display = _isLoginMode ? 'none' : 'block';
    
    const errorEl = document.getElementById('auth-error');
    if (errorEl) errorEl.textContent = '';

    if (!_isLoginMode) {
        loadClubOptions();
    }
}

// ── Cargar Clubes en el Registro ─────────────────────────────
export async function loadClubOptions() {
    const select = document.getElementById('auth-club-select');
    if (!select) return;
    
    const fa = window._cronos_auth;
    if (!fa) return;

    try {
        const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await m.getDocs(m.collection(fa.db, 'clubs'));
        let html = '<option value="">-- Selecciona un club --</option>';
        snap.forEach(doc => {
            const club = doc.data();
            if (club.status !== 'blocked') {
                html += `<option value="${doc.id}">${club.name}</option>`;
            }
        });
        select.innerHTML = html;
    } catch(e) {
        select.innerHTML = '<option value="">Error al cargar clubes</option>';
    }
}

// ── Manejar Cambio de Rol en Registro ────────────────────────
export function handleRoleChange() {
    const role = document.getElementById('auth-role')?.value;
    const isParent = (role === 'parent');
    const isClubAdmin = (role === 'club_admin');
    
    const clubCont = document.getElementById('club-container');
    const newClubCont = document.getElementById('new-club-container');
    const inviteCont = document.getElementById('invite-code-container');

    if (clubCont) clubCont.style.display = (!isClubAdmin) ? 'block' : 'none';
    if (newClubCont) newClubCont.style.display = isClubAdmin ? 'block' : 'none';
    if (inviteCont) inviteCont.style.display = isParent ? 'block' : 'none';
}

// ── Mostrar Error ───────────────────────────────────────────
export function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (el) {
        el.textContent  = msg;
        el.style.color  = (msg.startsWith('✅') || msg.includes('correct')) ? '#3fb950' : '#ff5858';
    }
}

// ── Mostrar Pantallas ───────────────────────────────────────
export function showScreen(screenId) {
    ['auth-screen','install-screen','onboarding-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === screenId) ? 'flex' : 'none';
    });
}

// ── Login / Registro ────────────────────────────────────────
export async function doAuth() {
    const fa = window._cronos_auth;
    if (!fa) { showAuthError('Firebase no disponible. Revisa tu conexión.'); return; }

    const email    = document.getElementById('auth-email')?.value.trim();
    const password = document.getElementById('auth-password')?.value;
    if (!email || !password) {
        showAuthError('Introduce email y contraseña.'); return;
    }

    showAuthError('⏳ Conectando…');

    try {
        if (_isLoginMode) {
            // ── LOGIN ──
            window._loginThisSession = true;
            const cred = await fa.signInWithEmailAndPassword(fa.auth, email, password);
            if (window._checkAuthorization) { await window._checkAuthorization(cred.user); } 
            else if (fa.checkAuthorization) { await fa.checkAuthorization(cred.user); } 
            else { throw new Error("checkAuth not found"); }
        } else {
            // ── REGISTRO ──
            const requestedRole = document.getElementById('auth-role')?.value || 'user';
            const selectedClubId = document.getElementById('auth-club-select')?.value || null;
            const newClubName = document.getElementById('auth-new-club-name')?.value.trim() || '';
            const reqCoaches = parseInt(document.getElementById('auth-req-coaches')?.value) || 0;
            const reqParents = parseInt(document.getElementById('auth-req-parents')?.value) || 0;
            const inviteCode = document.getElementById('auth-invite-code')?.value.trim().toUpperCase() || '';

            // Validaciones básicas
            if (requestedRole === 'club_admin' && !newClubName) {
                showAuthError('⚠️ El nombre del club es obligatorio.'); return;
            }
            if (requestedRole !== 'club_admin' && !selectedClubId && requestedRole !== 'superadmin' && requestedRole !== 'parent') {
                showAuthError('⚠️ Debes seleccionar un club.'); return;
            }

            const cred = await fa.createUserWithEmailAndPassword(fa.auth, email, password);
            
            let finalRole = requestedRole;
            let isAuthorized = false;
            let clubId = selectedClubId;

            // Superadmin automático (por correo)
            if (email === 'jarg7435@gmail.com') {
                finalRole = 'superadmin';
                isAuthorized = true;
            }

            // Lógica de invitación para padres
            if (requestedRole === 'parent' && inviteCode) {
                const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                const linksSnap = await m.getDocs(m.query(
                    m.collection(fa.db, 'cronos_player_links'),
                    m.where('inviteCode', '==', inviteCode)
                ));
                
                if (!linksSnap.empty) {
                    const linkDoc = linksSnap.docs[0];
                    const linkData = linkDoc.data();
                    isAuthorized = true;
                    clubId = linkData.clubId;
                    
                    await m.updateDoc(m.doc(fa.db, 'cronos_player_links', linkDoc.id), {
                        parentUid: cred.user.uid,
                        parentEmail: email
                    });
                    showAuthError('✅ Vinculación correcta. Padre autorizado.');
                }
            }

            // Crear documento en Firestore
            const userData = {
                email:         email,
                isAuthorized:  isAuthorized,
                role:          finalRole,
                requestedRole: requestedRole,
                clubId:        clubId,
                createdAt:     fa.serverTimestamp(),
                lastLogin:     fa.serverTimestamp(),
                status:        isAuthorized ? 'active' : 'pending'
            };

            if (requestedRole === 'club_admin') {
                userData.requestedClubName = newClubName;
                userData.requestedQuotas = { coaches: reqCoaches, parents: reqParents };
            }

            await fa.setDoc(fa.doc(fa.db, 'users', cred.user.uid), userData);
            
            if (!isAuthorized) {
                await fa.signOut(fa.auth);
                showAuthError('✅ Solicitud enviada. Espera la aprobación.');
                switchTab('login');
            } else {
                showAuthError('✅ Registro completado. Ya puedes entrar.');
                switchTab('login');
            }
        }
    } catch(e) {
        showAuthError('Error: ' + e.message);
        window._loginThisSession = false;
    }
}

// ── Entrar en la app tras login ─────────────────────────────
export function enterApp() {
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) authScreen.style.display = 'none';
    document.body.classList.remove('locked');
    showRoleSelection();
}

// ── Selección de Rol (Multi-Perfil) ─────────────────────────
export function showRoleSelection() {
    const role = window._cronosCurrentUser?.role;
    const screen = document.getElementById('role-selection-screen');
    if (!screen) return;

    screen.style.display = 'flex';

    // Ocultar tarjetas
    ['card-opt-superadmin', 'card-opt-coach', 'card-opt-parent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Mostrar según rol real
    if (['superadmin','admin'].includes(role)) {
        document.getElementById('card-opt-superadmin').style.display = 'block';
        document.getElementById('card-opt-coach').style.display      = 'block';
        document.getElementById('card-opt-parent').style.display     = 'block';
    } 
    else if (['club_admin', 'director', 'coordinator', 'user', 'coach'].includes(role)) {
        document.getElementById('card-opt-coach').style.display      = 'block';
        document.getElementById('card-opt-parent').style.display     = 'block';
    } 
    else if (role === 'parent') {
        document.getElementById('card-opt-parent').style.display     = 'block';
    }
}

// ── Seleccionar una Opción ──────────────────────────────────
export function selectOption(option) {
    const screen = document.getElementById('role-selection-screen');
    if (screen) screen.style.display = 'none';

    const me = window._cronosCurrentUser;
    if (!me) return;

    me._activeRole = (option === 'superadmin') ? me.role : (option === 'coach' ? 'user' : 'parent');
    _launchWithRole(me._activeRole);
}

// ── Lanzar App con Rol Activo ───────────────────────────────
export function _launchWithRole(role) {
    const activeRole = window._cronosCurrentUser?._activeRole || role;

    document.getElementById('main-container').style.display = (activeRole === 'parent') ? 'none' : 'flex';
    document.getElementById('main-header').style.display    = (activeRole === 'parent') ? 'none' : 'flex';

    // Visibilidad de botones según rol y contexto
    const btnAdmin = document.getElementById('btn-admin-panel');
    if (btnAdmin) {
        btnAdmin.style.display = (['admin','superadmin','club_admin'].includes(window._cronosCurrentUser.role) && 
                                 (activeRole === window._cronosCurrentUser.role || activeRole === 'user')) 
                                 ? 'inline-block' : 'none';
    }

    const btnClub = document.getElementById('btn-club-panel');
    if (btnClub) {
        btnClub.style.display = (window._cronosCurrentUser.role === 'club_admin') ? 'inline-block' : 'none';
    }

    // Persistencia
    sessionStorage.setItem('cronos_session_uid',   window._cronosCurrentUser.uid   || '');
    sessionStorage.setItem('cronos_session_email', window._cronosCurrentUser.email || '');
    sessionStorage.setItem('cronos_session_role',  activeRole || 'user');

    if (activeRole === 'parent') {
        if (typeof openParentPanel === 'function') openParentPanel();
    } else {
        if (typeof init === 'function') init(activeRole);
    }
}

// ── Panel Admin ─────────────────────────────────────────────
export function openAdminPanel() {
    const role = window._cronosCurrentUser?.role;
    if (['admin','superadmin'].includes(role) && typeof openSuperAdminPanel === 'function') {
        openSuperAdminPanel();
    } else if (role === 'club_admin' && typeof openClubAdminPanel === 'function') {
        openClubAdminPanel();
    }
}

// Exponer funciones globales para compatibilidad con index.html (onclick)
window.switchTab = switchTab;
window.handleRoleChange = handleRoleChange;
window.doAuth = doAuth;
window.selectOption = selectOption;
window.openAdminPanel = openAdminPanel;
window.showRoleSelector = showRoleSelection;
window.enterApp = enterApp;
window.showAuthError = showAuthError;
window.showScreen = showScreen;
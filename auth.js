/**
 * auth.js - Gestión de Autenticación y Autorización
 * Cronos Fútbol
 */

// ── Estado Local ──────────────────────────────────────────────
let _isLoginMode = true;

// ── Cambiar entre Login y Registro ──────────────────────────
export async function switchTab(tab) {
    _isLoginMode = (tab === 'login');
    const loginTab = document.getElementById('tab-login');
    const regTab   = document.getElementById('tab-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    if (loginTab) {
        loginTab.style.color = _isLoginMode ? '#58a6ff' : '#7d8590';
        loginTab.style.borderBottom = _isLoginMode ? '2px solid #58a6ff' : '2px solid transparent';
    }
    if (regTab) {
        regTab.style.color = !_isLoginMode ? '#58a6ff' : '#7d8590';
        regTab.style.borderBottom = !_isLoginMode ? '2px solid #58a6ff' : '2px solid transparent';
    }
    
    if (loginForm)    loginForm.style.display = _isLoginMode ? 'block' : 'none';
    if (registerForm) registerForm.style.display = _isLoginMode ? 'none' : 'block';
    
    const errorEl = document.getElementById('auth-error');
    if (errorEl) errorEl.textContent = '';

    if (!_isLoginMode) {
        loadClubOptions();
        handleRoleChange();
    } else {
        const cc = document.getElementById('club-container');
        const nc = document.getElementById('new-club-container');
        if (cc) cc.style.display = 'none';
        if (nc) nc.style.display = 'none';
    }
}

// ── Cargar Clubes ─────────────────────────────────────────────
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

// ── Manejar Cambio de Rol ────────────────────────────────────
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

// ── Verificación de Autorización ──────────────────────────────
export async function checkAuthorization(user) {
    if (!user) return;
    const fa = window._cronos_auth;
    if (!fa) return;

    try {
        const ref  = fa.doc(fa.db, 'users', user.uid);
        const snap = await fa.getDoc(ref);

        if (!snap.exists()) {
            await fa.signOut(fa.auth);
            showAuthError('Cuenta pendiente de registro en base de datos.');
            return;
        }

        const data = snap.data();
        if (!data.isAuthorized) {
            showAuthError('Acceso no autorizado. Contacta con tu club o administrador.');
            await fa.signOut(fa.auth);
            return;
        }

        // Actualizar último login
        await fa.setDoc(ref, { lastLogin: fa.serverTimestamp() }, { merge: true });

        // Establecer usuario global
        window._cronosCurrentUser = { 
            uid: user.uid, 
            email: user.email, 
            role: data.role,
            clubId: data.clubId || null,
            clubName: data.clubName || null
        };

        enterApp();

    } catch (err) {
        console.error("Auth verify error:", err);
        showAuthError('Error de verificación: ' + err.message);
    }
}

// ── Login / Registro ────────────────────────────────────────
export async function doAuth() {
    const fa = window._cronos_auth;
    if (!fa) { showAuthError('Firebase no disponible.'); return; }

    const email    = document.getElementById('auth-email')?.value.trim();
    const password = document.getElementById('auth-password')?.value;
    if (!email || !password) {
        showAuthError('Introduce email y contraseña.'); return;
    }

    showAuthError('⏳ Conectando…');

    try {
        if (_isLoginMode) {
            window._loginThisSession = true;
            await fa.signInWithEmailAndPassword(fa.auth, email, password);
        } else {
            const requestedRole = document.getElementById('auth-role')?.value || 'user';
            const selectedClubId = document.getElementById('auth-club-select')?.value || null;
            const newClubName = document.getElementById('auth-new-club-name')?.value.trim() || '';
            const reqCoaches = parseInt(document.getElementById('auth-req-coaches')?.value) || 0;
            const reqParents = parseInt(document.getElementById('auth-req-parents')?.value) || 0;
            const inviteCode = document.getElementById('auth-invite-code')?.value.trim().toUpperCase() || '';

            if (requestedRole === 'club_admin' && !newClubName) {
                showAuthError('⚠️ Nombre del club obligatorio.'); return;
            }

            const cred = await fa.createUserWithEmailAndPassword(fa.auth, email, password);
            let finalRole = requestedRole;
            let isAuthorized = false;
            let clubId = selectedClubId;

            if (email === 'jarg7435@gmail.com') { finalRole = 'superadmin'; isAuthorized = true; }

            if (requestedRole === 'parent' && inviteCode) {
                const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                const linksSnap = await m.getDocs(m.query(m.collection(fa.db, 'cronos_player_links'), m.where('inviteCode', '==', inviteCode)));
                if (!linksSnap.empty) {
                    const linkDoc = linksSnap.docs[0];
                    isAuthorized = true;
                    clubId = linkDoc.data().clubId;
                    await m.updateDoc(m.doc(fa.db, 'cronos_player_links', linkDoc.id), { parentUid: cred.user.uid, parentEmail: email });
                }
            }

            const userData = { email, isAuthorized, role: finalRole, requestedRole, clubId, createdAt: fa.serverTimestamp(), lastLogin: fa.serverTimestamp() };
            if (requestedRole === 'club_admin') {
                userData.requestedClubName = newClubName;
                userData.requestedQuotas = { coaches: reqCoaches, parents: reqParents };
            }
            await fa.setDoc(fa.doc(fa.db, 'users', cred.user.uid), userData);
            
            if (!isAuthorized) {
                await fa.signOut(fa.auth);
                showAuthError('✅ Solicitud enviada. Espera aprobación.');
                switchTab('login');
            } else {
                showAuthError('✅ Registro completado. Entrando...');
                // Autorizado -> checkAuthorization se encargará vía onAuthStateChanged
            }
        }
    } catch(e) {
        const msgs = {
            'auth/invalid-email': 'Email no válido.',
            'auth/user-not-found': 'Usuario no encontrado.',
            'auth/wrong-password': 'Contraseña incorrecta.',
            'auth/invalid-credential': 'Email o contraseña incorrectos.',
            'auth/email-already-in-use': 'Este email ya está registrado.',
            'auth/weak-password': 'Contraseña demasiado corta.',
        };
        showAuthError(msgs[e.code] || ('Error: ' + e.message));
        window._loginThisSession = false;
    }
}

// ── Entrar en la app ─────────────────────────────────────────
export function enterApp() {
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) authScreen.style.display = 'none';
    document.body.classList.remove('locked');
    showRoleSelection();
}

// ── Selección de Rol ─────────────────────────────────────────
export function showRoleSelection() {
    const role = window._cronosCurrentUser?.role;
    const screen = document.getElementById('role-selection-screen');
    if (!screen) return;
    screen.style.display = 'flex';

    // Ocultar todas primero
    const allCards = [
        'card-opt-superadmin', 'card-opt-clubadmin', 
        'card-opt-director', 'card-opt-coordinator',
        'card-opt-coach', 'card-opt-parent'
    ];
    allCards.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Mostrar tarjetas
    if (['superadmin','admin'].includes(role)) {
        // El Superadministrador ve TODAS para poder trabajar en ellas y corregirlas
        allCards.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'block';
        });
    } else if (role === 'club_admin') {
        document.getElementById('card-opt-clubadmin').style.display  = 'block';
    } else if (role === 'director') {
        document.getElementById('card-opt-director').style.display   = 'block';
    } else if (role === 'coordinator') {
        document.getElementById('card-opt-coordinator').style.display = 'block';
    } else if (['coach', 'user'].includes(role)) {
        document.getElementById('card-opt-coach').style.display       = 'block';
    } else if (role === 'parent') {
        document.getElementById('card-opt-parent').style.display      = 'block';
    }
}

// ── Lanzar App ──────────────────────────────────────────────
export function selectOption(option) {
    const me = window._cronosCurrentUser;
    if (!me) return;

    // Mapeo estricto del botón a rol interno
    const map = {
        'superadmin':  'superadmin',
        'clubadmin':   'club_admin',
        'director':    'director',
        'coordinator': 'coordinator',
        'coach':       'user',
        'parent':      'parent'
    };
    
    me._activeRole = map[option] || me.role;
    _launchWithRole(me._activeRole);
}

function _launchWithRole(role) {
    const activeRole = window._cronosCurrentUser?._activeRole || role;
    document.getElementById('role-selection-screen').style.display = 'none';

    // Roles que usan la interfaz principal de campo (Entrenador, Usuario local)
    const isFieldRole = (activeRole === 'user' || activeRole === 'coach');
    const isParent    = (activeRole === 'parent');
    const isSA        = (activeRole === 'superadmin');
    const isAdminJob  = ['director', 'coordinator', 'club_admin'].includes(activeRole);

    // Ocultar campo y cabecera para administradores y staff
    document.getElementById('main-container').style.display = isFieldRole ? 'flex' : 'none';
    document.getElementById('main-header').style.display    = isFieldRole ? 'flex' : 'none';

    // Fondo limpio para roles admin
    if (isAdminJob || isSA) {
        document.body.style.background = '#0d1117';
    } else if (isFieldRole) {
        document.body.style.background = ''; // Default (css pitch)
    }

    const btnAdmin = document.getElementById('btn-admin-panel');
    if (btnAdmin) {
        btnAdmin.style.display = (['admin','superadmin'].includes(window._cronosCurrentUser.role) && activeRole === window._cronosCurrentUser.role) ? 'inline-block' : 'none';
    }
    const btnClub = document.getElementById('btn-club-panel');
    if (btnClub) {
        btnClub.style.display = (window._cronosCurrentUser.role === 'club_admin') ? 'inline-block' : 'none';
    }

    sessionStorage.setItem('cronos_session_uid', window._cronosCurrentUser.uid);
    sessionStorage.setItem('cronos_session_email', window._cronosCurrentUser.email);
    sessionStorage.setItem('cronos_session_role', activeRole);

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
        if (typeof init === 'function') init(activeRole); 
    }
}

// ── Exportación Global ───────────────────────────────────────
window.logoutUser = () => {
    if (!confirm('¿Seguro que deseas salir y volver al inicio?')) return;
    sessionStorage.clear();
    // Intentar logout de firebase si está disponible
    if (window._cronos_auth?.auth) {
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js').then(({ signOut }) => {
            signOut(window._cronos_auth.auth).finally(() => {
                location.reload();
            });
        }).catch(() => location.reload());
    } else {
        location.reload();
    }
};

window.switchTab = switchTab;
window.handleRoleChange = handleRoleChange;
window.doAuth = doAuth;
window.selectOption = selectOption;
window._checkAuthorization = checkAuthorization;
window.enterApp = enterApp;
window.showRoleSelector = showRoleSelection;
window.showAuthError = showAuthError;
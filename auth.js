import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendPasswordResetEmail,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

let isLoginMode = true;

// --- CAMBIAR ENTRE LOGIN Y REGISTRO ---
window.toggleAuthMode = () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-subtitle').textContent = isLoginMode ? 'Iniciar Sesión' : 'Crear Cuenta Nueva';
    document.getElementById('auth-action-btn').textContent = isLoginMode ? 'ENTRAR' : 'REGISTRARSE';
    document.getElementById('auth-toggle-link').textContent = isLoginMode ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión';
    document.getElementById('access-error').textContent = '';
};

// --- ACCIÓN PRINCIPAL DEL BOTÓN ---
window.handleAuthAction = async () => {
    if (isLoginMode) {
        await handleLogin();
    } else {
        await handleRegister();
    }
}

// --- INICIAR SESIÓN ---
async function handleLogin() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('access-error');
    const rememberMe = document.getElementById('remember-me').checked;
    
    if (!email || !password) {
        errorEl.textContent = 'Introduzca correo y contraseña';
        return;
    }

    try {
        errorEl.style.color = 'var(--primary)';
        errorEl.textContent = 'Validando...';

        // Configurar persistencia (Recordarme)
        const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(window.firebaseAuth, persistence);

        const userCredential = await signInWithEmailAndPassword(window.firebaseAuth, email, password);
        const user = userCredential.user;

        const userDoc = await getDoc(doc(window.firebaseDb, "users", user.uid));

        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.isAuthorized) {
                sessionStorage.setItem('cronos_user_role', userData.role || 'user');
                if (userData.role === 'admin') {
                    document.getElementById('btn-admin').style.display = 'block';
                }
                document.getElementById('auth-screen').style.display = 'none';
                document.body.classList.remove('locked');
                if (window.unlockApp) window.unlockApp();
            } else {
                await window.firebaseAuth.signOut();
                errorEl.style.color = 'var(--danger)';
                errorEl.textContent = 'Cuenta pendiente de autorización.';
            }
        }
    } catch (error) {
        errorEl.style.color = 'var(--danger)';
        errorEl.textContent = 'Correo o contraseña incorrectos.';
    }
}

// --- REGISTRO NUEVO ---
async function handleRegister() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('access-error');
    
    if (!email || password.length < 6) {
        errorEl.textContent = 'Email válido y clave de min. 6 caracteres.';
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(window.firebaseAuth, email, password);
        const user = userCredential.user;

        await setDoc(doc(window.firebaseDb, "users", user.uid), {
            email: user.email,
            role: "user",
            isAuthorized: false,
            createdAt: new Date().toISOString()
        });

        await window.firebaseAuth.signOut();
        toggleAuthMode();
        errorEl.style.color = 'var(--success)';
        errorEl.textContent = '¡Creada! Espera a que el Admin te autorice.';
    } catch (error) {
        errorEl.textContent = 'Error al registrar. El correo podría existir.';
    }
}

// --- OLVIDÉ MI CONTRASEÑA ---
window.handleForgotPassword = async () => {
    const email = document.getElementById('auth-email').value;
    const errorEl = document.getElementById('access-error');
    
    if (!email) {
        errorEl.textContent = 'Escribe tu email arriba primero.';
        return;
    }

    try {
        await sendPasswordResetEmail(window.firebaseAuth, email);
        errorEl.style.color = 'var(--success)';
        errorEl.textContent = 'Correo de recuperación enviado.';
    } catch (error) {
        errorEl.textContent = 'No se pudo enviar el correo.';
    }
};

// --- VER/OCULTAR CONTRASEÑA ---
document.getElementById('toggle-password').addEventListener('click', function() {
    const passInput = document.getElementById('auth-password');
    if (passInput.type === 'password') {
        passInput.type = 'text';
        this.textContent = '🔒';
    } else {
        passInput.type = 'password';
        this.textContent = '👁️';
    }
});

// --- PERSISTENCIA AUTOMÁTICA AL CARGAR ---
window.onloadAuth = () => {
    window.firebaseAuth.onAuthStateChanged(async (user) => {
        if (user && !document.body.classList.contains('unlocked')) {
            const userDoc = await getDoc(doc(window.firebaseDb, "users", user.uid));
            if (userDoc.exists() && userDoc.data().isAuthorized) {
                if (userDoc.data().role === 'admin') document.getElementById('btn-admin').style.display = 'block';
                document.getElementById('auth-screen').style.display = 'none';
                document.body.classList.remove('locked');
                if (window.unlockApp) window.unlockApp();
            }
        }
    });
};

// --- FUNCIONES DE ADMINISTRACIÓN ---
window.fetchUsers = async () => {
    const querySnapshot = await getDocs(collection(window.firebaseDb, "users"));
    const userList = document.getElementById('admin-user-list');
    userList.innerHTML = '';
    querySnapshot.forEach((docSnap) => {
        const user = docSnap.data();
        const id = docSnap.id;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.email}</td>
            <td>${user.role}</td>
            <td>
                <input type="checkbox" ${user.isAuthorized ? 'checked' : ''} onchange="toggleUserAuthorization('${id}', this.checked)">
            </td>
        `;
        userList.appendChild(row);
    });
};

window.toggleUserAuthorization = async (userId, status) => {
    try {
        await updateDoc(doc(window.firebaseDb, "users", userId), { isAuthorized: status });
    } catch (e) { console.error(e); }
};
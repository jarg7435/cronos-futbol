import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendPasswordResetEmail,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

let isLoginMode = true;

window.toggleAuthMode = () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-subtitle').textContent = isLoginMode ? 'Iniciar Sesión' : 'Registro';
    document.getElementById('auth-action-btn').textContent = isLoginMode ? 'ENTRAR' : 'CREAR CUENTA';
    document.getElementById('auth-toggle-link').textContent = isLoginMode ? '¿No tienes cuenta? Regístrate' : 'Ya tengo cuenta';
};

window.handleAuthAction = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('access-error');
    const rememberMe = document.getElementById('remember-me').checked;

    if (!email || !pass) { errorEl.textContent = "Rellena todos los campos"; return; }

    try {
        if (isLoginMode) {
            const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
            await setPersistence(window.firebaseAuth, persistence);
            const userCredential = await signInWithEmailAndPassword(window.firebaseAuth, email, pass);
            checkUserStatus(userCredential.user.uid);
        } else {
            const userCredential = await createUserWithEmailAndPassword(window.firebaseAuth, email, pass);
            await setDoc(doc(window.firebaseDb, "users", userCredential.user.uid), {
                email: email, isAuthorized: false, role: "user"
            });
            errorEl.style.color = "#3fb950";
            errorEl.textContent = "Cuenta creada. Espera autorización.";
        }
    } catch (e) { errorEl.textContent = "Error: Credenciales inválidas"; }
};

async function checkUserStatus(uid) {
    const userDoc = await getDoc(doc(window.firebaseDb, "users", uid));
    if (userDoc.exists() && userDoc.data().isAuthorized) {
        // AQUÍ ESTÁ LA MAGIA: Desbloquea la app
        document.getElementById('access-screen').style.display = 'none';
        document.getElementById('main-header').style.display = 'flex';
        document.getElementById('main-container').style.display = 'flex';
        document.body.classList.remove('locked');
        if (window.init) window.init(); // Arranca app.js
    } else {
        await window.firebaseAuth.signOut();
        document.getElementById('access-error').textContent = "Cuenta no autorizada aún.";
    }
}

window.handleForgotPassword = async () => {
    const email = document.getElementById('auth-email').value;
    if (!email) { alert("Escribe tu email"); return; }
    await sendPasswordResetEmail(window.firebaseAuth, email);
    alert("Email de recuperación enviado.");
};

document.getElementById('toggle-password').onclick = () => {
    const p = document.getElementById('auth-password');
    p.type = p.type === 'password' ? 'text' : 'password';
};
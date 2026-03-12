import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

let isLoginMode = true;

window.toggleAuthMode = () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-subtitle').textContent = isLoginMode ? 'Iniciar Sesión' : 'Crear Cuenta Nueva';
    document.getElementById('auth-action-btn').textContent = isLoginMode ? 'ENTRAR' : 'REGISTRARSE';
    document.getElementById('auth-toggle-link').textContent = isLoginMode ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión';
    document.getElementById('access-error').textContent = '';
};

window.handleAuthAction = async () => {
    if (isLoginMode) {
        await handleLogin();
    } else {
        await handleRegister();
    }
}

async function handleLogin() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('access-error');
    
    if (!email || !password) {
        errorEl.textContent = 'Introduza correo y contraseña';
        return;
    }

    try {
        errorEl.textContent = 'Iniciando sesión...';
        const userCredential = await signInWithEmailAndPassword(window.firebaseAuth, email, password);
        const user = userCredential.user;

        // Comprobar autorización en Firestore
        const userDocRef = doc(window.firebaseDb, "users", user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.isAuthorized) {
                // Usuario Autorizado
                sessionStorage.setItem('cronos_user_role', userData.role || 'user');
                sessionStorage.setItem('cronos_access', 'true');
                unlockApp();
            } else {
                // Usuario NO Autorizado
                window.firebaseAuth.signOut();
                errorEl.textContent = 'Cuenta pendiente de autorización.';
            }
        } else {
            window.firebaseAuth.signOut();
            errorEl.textContent = 'Error: Contacte con el administrador (Doc not found).';
        }
    } catch (error) {
        console.error("Error signing in", error);
        errorEl.textContent = 'Usuario o contraseña incorrectos.';
    }
}

async function handleRegister() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('access-error');
    
    if (!email || !password) {
        errorEl.textContent = 'Introduzca correo y contraseña';
        return;
    }

    if (password.length < 6) {
        errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
        return;
    }

    try {
        errorEl.textContent = 'Creando cuenta...';
        const userCredential = await createUserWithEmailAndPassword(window.firebaseAuth, email, password);
        const user = userCredential.user;

        // Crear documento base en la colección `users` en Firestore
        // El usuario se crea "desautorizado" por defecto
        await setDoc(doc(window.firebaseDb, "users", user.uid), {
            email: user.email,
            role: "user",
            isAuthorized: false,
            subscriptionPlan: "free",
            createdAt: new Date().toISOString()
        });

        // Cerrar sesión recién creada para que el Admin lo tenga que autorizar primero
        await window.firebaseAuth.signOut();
        
        // Volver a la pantalla de login con un mensaje de info
        toggleAuthMode();
        errorEl.style.color = 'var(--success)';
        errorEl.textContent = 'Cuenta creada. Esperando autorización.';
        // resetear color despues de un rato o a la siguiente intencion
        setTimeout(() => errorEl.style.color = 'var(--danger)', 5000);

    } catch (error) {
        console.error("Error registering", error);
        if(error.code === 'auth/email-already-in-use') {
            errorEl.textContent = 'Este correo ya está registrado.';
        } else {
            errorEl.textContent = 'Hubo un error al crear la cuenta.';
        }
    }
}

window.onloadAuth = () => {
    // Escuchar si ya hay usuario al arrancar (persistencia de sesión Firebase)
    window.firebaseAuth.onAuthStateChanged(async (user) => {
        if (user) {
            // Chequear de nuevo en base de datos si sigue autorizado
             const userDocRef = doc(window.firebaseDb, "users", user.uid);
             const userDoc = await getDoc(userDocRef);
             
             if (userDoc.exists() && userDoc.data().isAuthorized) {
                 sessionStorage.setItem('cronos_access', 'true');
                 unlockApp();
             } else {
                 document.getElementById('access-error').textContent = 'Tu autorización ha sido revocada.';
                 window.firebaseAuth.signOut();
             }
        }
    });
};
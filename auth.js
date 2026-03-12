import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

window.handleLogin = async () => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('access-error');
    
    if (!email || !password) {
        errorEl.textContent = 'Introduzca correo y contraseña';
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
                errorEl.textContent = 'Su cuenta está pendiente de autorización por el administrador.';
            }
        } else {
            // Documento de usuario no existe (nuevo registro no procesado)
            window.firebaseAuth.signOut();
            errorEl.textContent = 'Error: Contacte con el administrador para crear su perfil.';
        }

    } catch (error) {
        console.error("Error signing in", error);
        errorEl.textContent = 'Usuario o contraseña incorrectos.';
    }
};

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

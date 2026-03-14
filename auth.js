import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

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
                if (userData.role === 'admin') {
                    document.getElementById('btn-admin').style.display = 'block';
                }
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
            const errorEl = document.getElementById('access-error');
            // Si acabamos de registrar un usuario, handleRegister ya se encarga del mensaje y el signOut
            // No queremos que este listener pise el mensaje de "Cuenta creada"
            const userDocRef = doc(window.firebaseDb, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            
            if (userDoc.exists()) {
                const userData = userDoc.data();
                if (userData.isAuthorized) {
                    sessionStorage.setItem('cronos_user_role', userData.role || 'user');
                    sessionStorage.setItem('cronos_access', 'true');
                    if (userData.role === 'admin') {
                        document.getElementById('btn-admin').style.display = 'block';
                    }
                    unlockApp();
                } else {
                    // Solo mostramos el error si NO estamos en el proceso de registro manual
                    // (Si estamos registrando, el errorEl tendrá el color success temporalmente)
                    if (errorEl.style.color !== 'var(--success)') {
                        errorEl.textContent = 'Tu cuenta está pendiente de autorización.';
                        await window.firebaseAuth.signOut();
                    }
                }
            } else {
                // Si el documento no existe pero el auth sí (raro), forzar logout
                await window.firebaseAuth.signOut();
            }
        }
    });
};

window.fetchUsers = async () => {
    const querySnapshot = await getDocs(collection(window.firebaseDb, "users"));
    const userList = document.getElementById('admin-user-list');
    userList.innerHTML = '';
    querySnapshot.forEach((docSnap) => {
        const user = docSnap.data();
        const id = docSnap.id;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="padding: 10px;">${user.email}</td>
            <td style="padding: 10px;">${user.subscriptionPlan || 'free'}</td>
            <td style="padding: 10px;">
                <label class="toggle-switch">
                    <input type="checkbox" ${user.isAuthorized ? 'checked' : ''} onchange="toggleUserAuthorization('${id}', this.checked)">
                    <span class="slider"></span>
                </label>
            </td>
            <td style="padding: 10px;">
                <button class="btn" style="font-size: 0.7rem;" onclick="changeUserPlan('${id}', '${user.subscriptionPlan === 'pro' ? 'free' : 'pro'}')">
                    ${user.subscriptionPlan === 'pro' ? 'Bajar a FREE' : 'Subir a PRO'}
                </button>
            </td>
        `;
        userList.appendChild(row);
    });
};

window.toggleUserAuthorization = async (userId, status) => {
    try {
        await updateDoc(doc(window.firebaseDb, "users", userId), {
            isAuthorized: status
        });
        console.log("User authorization updated");
    } catch (error) {
        console.error("Error updating authorization", error);
        alert("Error al actualizar autorización");
    }
};

window.changeUserPlan = async (userId, newPlan) => {
    try {
        await updateDoc(doc(window.firebaseDb, "users", userId), {
            subscriptionPlan: newPlan
        });
        window.fetchUsers();
    } catch (error) {
        console.error("Error updating plan", error);
    }
};

window.showUpgradeModal = () => {
    alert("🚀 ¡Sube a Cronos PRO!\n\n- Equipos ilimitados\n- Exportación PDF personalizada\n- Sincronización en la nube\n\nPróximamente disponible.");
};
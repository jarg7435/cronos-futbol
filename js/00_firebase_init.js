
        import { initializeApp }
            from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
        import { getAuth, createUserWithEmailAndPassword,
                 signInWithEmailAndPassword, onAuthStateChanged, signOut,
                 setPersistence, browserLocalPersistence, browserSessionPersistence }
            from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
        import { getFirestore, doc, getDoc, setDoc, serverTimestamp }
            from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

        // ╔══════════════════════════════════════════╗
        // ║  PEGA AQUÍ TU firebaseConfig             ║
        // ╚══════════════════════════════════════════╝
        const firebaseConfig = {
            apiKey:            "AIzaSyAWPw-lE6ynYK1CkFpSbwCgRtitDzBpIb4",
            authDomain:        "cronos-futbol-app.firebaseapp.com",
            projectId:         "cronos-futbol-app",
            storageBucket:     "cronos-futbol-app.firebasestorage.app",
            messagingSenderId: "393110572633",
            appId:             "1:393110572633:web:27a7effed60975e690ab48",
            measurementId:     "G-WP3921EM1Z"
        };

        const app  = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db   = getFirestore(app);

        // Sesión solo dura mientras el navegador está abierto (no persiste al cerrar)
        setPersistence(auth, browserLocalPersistence).catch(() => {});

        // Exponer al scope global para los scripts clásicos
        window._cronos_auth = {
            auth, db, signOut,
            createUserWithEmailAndPassword, signInWithEmailAndPassword,
            doc, getDoc, setDoc, serverTimestamp
        };

        // ── Restaurar sesión tras recarga por actualización ────────────────
        const _restoredUid   = sessionStorage.getItem('cronos_session_uid');
        const _restoredEmail = sessionStorage.getItem('cronos_session_email');
        const _restoredRole  = sessionStorage.getItem('cronos_session_role');
        const _updateFlag    = sessionStorage.getItem('cronos_post_update');

        if (_restoredUid && _updateFlag === '1') {
            // Venimos de una actualización forzada: restaurar sesión sin pasar por login
            sessionStorage.removeItem('cronos_post_update');
            window._cronosCurrentUser = {
                uid:   _restoredUid,
                email: _restoredEmail,
                role:  _restoredRole
            };
            // Mostrar toast de actualización completada
            window.addEventListener('load', () => {
                const toast = document.createElement('div');
                toast.textContent = '✅ App actualizada correctamente';
                toast.style.cssText =
                    'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
                    'background:#1a7a3e;color:#fff;padding:10px 24px;border-radius:8px;' +
                    'font-size:0.88rem;font-weight:bold;z-index:99999;' +
                    'box-shadow:0 4px 16px rgba(0,0,0,0.5);';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 3000);
            });
            // Entrar directamente sin pasar por Firebase login
            document.getElementById('install-screen').style.display = 'none';
            document.getElementById('auth-screen').style.display    = 'none';
            enterApp();
        }

        // Observador de sesión — solo entra automáticamente si el login fue en ESTA sesión
        onAuthStateChanged(auth, async (user) => {
            if (window._cronosCurrentUser) return; // ya restaurado por post-update
            if (user && window._loginThisSession) {
                await checkAuthorization(user);
            } else {
                // Siempre mostrar pantalla de login al cargar la página
                await signOut(auth).catch(() => {});
                showScreen('auth-screen');
            }
        });

        async function checkAuthorization(user) {
            try {
                const ref  = doc(db, 'users', user.uid);
                const snap = await getDoc(ref);

                if (!snap.exists()) {
                    // Primera vez: crear doc pendiente de autorización
                    await setDoc(ref, {
                        email:        user.email,
                        isAuthorized: false,
                        role:         'user',
                        createdAt:    serverTimestamp(),
                        lastLogin:    serverTimestamp()
                    });
                    showAuthError('Cuenta creada. Pendiente de autorización por el administrador.');
                    await signOut(auth);
                    return;
                }

                const data = snap.data();
                if (!data.isAuthorized) {
                    showAuthError('Acceso no autorizado. Contacta con el administrador para activar tu cuenta.');
                    await signOut(auth);
                    return;
                }

                // Usuario autorizado: actualizar lastLogin y entrar
                await setDoc(ref, { lastLogin: serverTimestamp() }, { merge: true });
                window._cronosCurrentUser = { uid: user.uid, email: user.email, role: data.role };
                enterApp();

            } catch (err) {
                showAuthError('Error de conexión: ' + err.message);
            }
        }

        window._checkAuthorization = checkAuthorization;
    
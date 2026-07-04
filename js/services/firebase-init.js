// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — SERVICES/FIREBASE-INIT
// Inicialización Firebase con importación dinámica
// ══════════════════════════════════════════════════════════════════
// NOTA: Esta es la ÚNICA inicialización de Firebase. El bloque
// inline que había antes en index.html ha sido eliminado para
// evitar la doble instancia que causaba ERR_QUIC_PROTOCOL_ERROR.
// ══════════════════════════════════════════════════════════════════

// SECURITY FIX (SEC-002): Protect _cronosCurrentUser from privilege escalation
// Wrap _cronosCurrentUser in a Proxy that prevents modification of protected properties.
// Uses Object.defineProperty to intercept all future assignments from any file.
(function() {
    const _protectedProps = ['uid', 'email', 'role', 'clubId', 'clubName'];
    let _internalUser = window._cronosCurrentUser || undefined;
    function _wrapProxy(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        return new Proxy(obj, {
            set(target, prop, value) {
                if (_protectedProps.includes(prop)) {
                    console.error('[SECURITY] Blocked attempt to modify _cronosCurrentUser.' + prop);
                    return false;
                }
                target[prop] = value;
                return true;
            }
        });
    }
    if (_internalUser) _internalUser = _wrapProxy(_internalUser);
    Object.defineProperty(window, '_cronosCurrentUser', {
        get() { return _internalUser; },
        set(newValue) {
            if (newValue && typeof newValue === 'object') {
                _internalUser = _wrapProxy(newValue);
            } else {
                _internalUser = newValue;
            }
        },
        configurable: true,
        enumerable: true,
    });
})();

(async () => {
    const { initializeApp } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getAuth, createUserWithEmailAndPassword,
            signInWithEmailAndPassword, onAuthStateChanged, signOut,
            setPersistence, browserLocalPersistence } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const { getFirestore, doc, getDoc, setDoc, serverTimestamp } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { getFunctions } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const { initializeAppCheck, ReCaptchaV3Provider } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js');

    // ── Configuración Firebase ────────────────────────────────────
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
    const functions = getFunctions(app);

    // ── App Check con reCAPTCHA v3 ───────────────────────────────
    try {
        const appCheck = initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider('6Ld5cEQtAAAAAA0OCimDVsOORapoEKfsVmJmGI23'),
            isTokenAutoRefreshEnabled: true
        });
        if (window._CRONOS_DEBUG) console.log('[AppCheck] Activado (reCAPTCHA v3)');
    } catch (e) {
        console.warn('[AppCheck] No se pudo inicializar:', e.message);
    }

    // ── Función checkAuthorization (fallback si auth.js no cargó) ──
    // FIX: Añadido SuperAdmin bypass para que el fallback no bloquee al SA
    async function checkAuthorization(user) {
        // Si auth.js ya cargó su versión, usar esa
        if (typeof window._checkAuthorization === 'function') {
            return window._checkAuthorization(user);
        }
        try {
            const ref  = doc(db, 'users', user.uid);
            const snap = await getDoc(ref);
            if (!snap.exists()) {
                if (typeof showAuthError === 'function')
                    showAuthError('Pendiente de autorización por el administrador.');
                await signOut(auth);
                return;
            }
            const d = snap.data();

            // ═══ SUPERADMIN BYPASS (fallback) ═════════════════════════
            let _isSA = d.role === 'superadmin';
            if (!_isSA) {
                try {
                    const _token = await user.getIdTokenResult(true); // SECURITY FIX (SEC-M01): Force token refresh
                    if (_token && _token.claims && _token.claims.role === 'superadmin') {
                        _isSA = true;
                    }
                } catch(_) {}
            }
            if (_isSA) {
                // Corregir documento si está desincronizado
                if (!d.isAuthorized || d.status !== 'active') {
                    try {
                        await setDoc(ref, {
                            isAuthorized: true,
                            status: 'active',
                            role: 'superadmin',
                            lastLogin: serverTimestamp(),
                        }, { merge: true });
                    } catch(_) {}
                }
                d.isAuthorized = true;
                d.status = 'active';
                d.role = 'superadmin';
            }
            // ═══ FIN SUPERADMIN BYPASS ════════════════════════════════

            if (!d.isAuthorized) {
                if (typeof showAuthError === 'function')
                    showAuthError('⏳ Acceso pendiente de aprobación.');
                await signOut(auth);
                return;
            }
            await setDoc(ref, { lastLogin: serverTimestamp() }, { merge: true });
        } catch (err) {
            console.error('[Cronos] Firebase auth error:', err);
        }
    }

    // ── Exponer al scope global ───────────────────────────────────
    window._cronos_auth = {
        auth, db, functions, signOut,
        createUserWithEmailAndPassword,
        signInWithEmailAndPassword,
        doc, getDoc, setDoc, serverTimestamp,
        checkAuthorization
    };

    // SECURITY FIX (SEC-001): Removed sessionStorage-based session restoration.
    // This was an auth bypass — an attacker could write arbitrary uid/email/role
    // to sessionStorage and impersonate any user including superadmin.
    // Session must always be verified via Firebase Auth onAuthStateChanged.

    // ── Sesión persistente ────────────────────────────────────────
    setPersistence(auth, browserLocalPersistence).catch(() => {});

    // ── Observador de sesión ──────────────────────────────────────
    onAuthStateChanged(auth, async (user) => {
        if (window._cronosCurrentUser) return;
        if (user) {
            // ── Validar token antes de continuar ──
            try {
                await user.getIdToken(true);
            } catch (tokenErr) {
                console.warn('[Cronos] Token inválido — limpiando sesión:', tokenErr.code || tokenErr.message);
                await signOut(auth).catch(() => {});
                const el = document.getElementById('auth-screen');
                if (el) {
                    document.body.classList.remove('locked');
                    el.style.display = 'flex';
                }
                return;
            }
            // Verificar autorización
            await checkAuthorization(user);
        } else {
            // Mostrar pantalla de login de forma robusta
            if (typeof showScreen === 'function') {
                showScreen('auth-screen');
            } else {
                const el = document.getElementById('auth-screen');
                if (el) {
                    document.body.classList.remove('locked');
                    el.style.display = 'flex';
                }
            }
        }
    });

})();

// ══════════════════════════════════════════════════════════════════
// saFS() — Helper de Firebase para todos los paneles y servicios
// ══════════════════════════════════════════════════════════════════
window.saFS = async function saFS() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) throw new Error('[saFS] Firebase no inicializado. Recarga la página.');
    const [fs, fnMod, appMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    ]);
    if (!fa._functions) {
        try { fa._functions = fnMod.getFunctions(appMod.getApp()); }
        catch (e) { console.warn('[saFS] Functions:', e.message); }
    }
    return {
        db: fa.db,
        fa: Object.assign({}, fa, { functions: fa._functions }),
        doc: fs.doc, getDoc: fs.getDoc, setDoc: fs.setDoc,
        updateDoc: fs.updateDoc, deleteDoc: fs.deleteDoc,
        collection: fs.collection, query: fs.query,
        where: fs.where, getDocs: fs.getDocs,
        orderBy: fs.orderBy, onSnapshot: fs.onSnapshot,
        serverTimestamp: fs.serverTimestamp,
        httpsCallable: fnMod.httpsCallable,
    };
};


// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — SERVICES/FIREBASE-INIT
// Inicialización Firebase con importación dinámica (compatible con
// scripts clásicos — sin type="module" necesario)
// ══════════════════════════════════════════════════════════════════
// NOTA: Esta es la ÚNICA inicialización de Firebase. El bloque
// inline que había antes en index.html ha sido eliminado para
// evitar la doble instancia que causaba ERR_QUIC_PROTOCOL_ERROR.
// ══════════════════════════════════════════════════════════════════

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

    // ── Función checkAuthorization (fallback si auth.js no cargó) ──
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

    // ── Sesión persistente ────────────────────────────────────────
    setPersistence(auth, browserLocalPersistence).catch(() => {});

    // ── Observador de sesión ──────────────────────────────────────
    onAuthStateChanged(auth, async (user) => {
        if (window._cronosCurrentUser) return;
        if (user) {
            // ── Validar token antes de continuar ──
            // Si el token está corrupto o el usuario fue eliminado en
            // Firebase Auth, getIdToken() falla con 400. En ese caso,
            // limpiar la sesión de indexedDB para evitar bucles de error.
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

    // Firebase init completado
})();

// ══════════════════════════════════════════════════════════════════
// saFS() — Helper de Firebase para todos los paneles y servicios
// ══════════════════════════════════════════════════════════════════
// Proporciona acceso dinámico a Firestore + Functions.
// Se define AQUÍ (firebase-init.js) para que esté disponible
// ANTES de que se carguen user-management.js y los paneles.
// Los paneles (superadmin, club, individual) tienen guards
// que no sobrescriben si ya existe: if (typeof saFS !== 'function')
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

// Firebase functions inicializadas

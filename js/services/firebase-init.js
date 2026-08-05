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
            setPersistence, browserLocalPersistence,
            // v451 · recuperación y cambio de contraseña. `updatePassword`
            // exige sesión reciente, así que reautenticamos SIEMPRE antes con
            // la contraseña actual: de paso se comprueba que quien la cambia
            // es el dueño y no alguien que pilló el móvil desbloqueado.
            sendPasswordResetEmail, updatePassword,
            reauthenticateWithCredential, EmailAuthProvider } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const { getFirestore, initializeFirestore, persistentLocalCache,
            persistentMultipleTabManager, terminate, clearIndexedDbPersistence,
            doc, getDoc, getDocFromServer, setDoc, serverTimestamp } =
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

    // v227: App Check DESACTIVADO en el código.
    // Motivo: Firebase App Check está registrado en la consola con reCAPTCHA v3,
    // pero al intentar intercambiar el token devuelve 403 Forbidden y entra en
    // throttle de 24h. Como App Check NO está "enforced" para Firestore ni Auth
    // (lo verificamos en la consola), la app funciona perfectamente sin él.
    // Si en el futuro quieres reactivar App Check:
    //   1. Verifica que la site key Y la secret key estén bien en Firebase Console
    //   2. Verifica que el dominio cronos-futbol-app.web.app esté en reCAPTCHA
    //   3. Descomenta el bloque de abajo
    /*
    try {
        const { initializeAppCheck, ReCaptchaV3Provider } =
            await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js');
        const _RECAPTCHA_SITE_KEY = '6Ld5cEQtAAAAAA0OCimDVsOORapoEKfsVmJmGI23';
        initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(_RECAPTCHA_SITE_KEY),
            isTokenAutoRefreshEnabled: true
        });
        console.log('[Cronos] App Check inicializado correctamente con reCAPTCHA v3.');
    } catch (e) {
        console.warn('[Cronos] No se pudo inicializar App Check:', e.message);
    }
    */
    console.log('[Cronos] App Check desactivado (v227). Si lo necesitas, verifícalo en Firebase Console.');

    const auth = getAuth(app);

    // ── Firestore con caché PERSISTENTE en disco ──────────────────
    // Sin esto la caché es sólo de memoria: muere con la pestaña, así que
    // recargar la app sin cobertura dejaba al usuario fuera (no había ni
    // documento de usuario que leer para autorizarle).
    //
    // ⚠️ EL GESTOR MULTIPESTAÑA NO ES OPCIONAL AQUÍ. El visor `live.html` se
    // abre con window.open: es OTRO documento con SU PROPIA instancia de
    // Firestore, y lo normal es tenerlos abiertos a la vez. Con el gestor por
    // defecto (una sola pestaña), el segundo en arrancar se queda SIN
    // persistencia — justo el caso de uso real del entrenador.
    //
    // El respaldo a getFirestore existe porque un navegador puede denegar
    // IndexedDB (modo privado, cuota); ahí se pierde la persistencia, pero la
    // app tiene que seguir arrancando.
    let db;
    try {
        db = initializeFirestore(app, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        });
    } catch (e) {
        console.warn('[Cronos] Caché persistente no disponible; se usa la de memoria:', e.message);
        db = getFirestore(app);
    }

    const functions = getFunctions(app);

    // ── Borrado de la caché en disco de Firestore ─────────────────
    // [Cronos-Privacy] ⚠️ Las lecturas servidas desde la caché local NO PASAN
    // POR LAS REGLAS de Firestore: son datos ya descargados. Es la lección de
    // v199 aplicada a la capa nueva — sin borrarla al salir o al cambiar de
    // usuario, el siguiente usuario del dispositivo podría leer documentos
    // cacheados del anterior. Va enganchada al purgado de PII que ya existía.
    //
    // clearIndexedDbPersistence() EXIGE que la instancia esté terminada, y
    // falla si otro documento (p. ej. live.html abierto) sigue usándola: por
    // eso nunca lanza hacia fuera, sólo informa. Sus dos llamadores recargan
    // la página justo después, así que terminar la instancia no rompe nada.
    window._cronosClearFirestoreCache = async function _cronosClearFirestoreCache() {
        try {
            await terminate(db);
            await clearIndexedDbPersistence(db);
            console.log('[Cronos-Privacy] 🔒 Caché en disco de Firestore borrada.');
            return true;
        } catch (e) {
            console.warn('[Cronos-Privacy] No se pudo borrar la caché de Firestore ' +
                         '(¿otra pestaña abierta?):', e.message);
            return false;
        }
    };

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
        checkAuthorization,
        // v451 · contraseñas. Se publican aquí, y no con un import() dinámico
        // en cada sitio, porque js/services/auth/password.js es un script
        // CLÁSICO: no puede hacer `import` y el ámbito de este módulo no
        // cuelga de window (la trampa de v383).
        sendPasswordResetEmail, updatePassword,
        reauthenticateWithCredential, EmailAuthProvider
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
            //
            // El refresco FORZADO (getIdToken(true)) es obligatorio cuando hay
            // red: es la única forma de detectar un token revocado (SEC-M01).
            // Pero exige ida al servidor, así que SIN COBERTURA lanza siempre
            // 'auth/network-request-failed' — y eso cerraba la sesión y dejaba
            // al usuario en el login por una simple pérdida de red.
            //
            // Ahora: forzado sólo si el navegador dice que hay red, y un fallo
            // de RED no cuesta la sesión (se sigue con el token cacheado; las
            // reglas de Firestore siguen validando en el servidor de todos
            // modos). Un token realmente inválido sí expulsa, como antes.
            const _hayRed = navigator.onLine !== false;
            try {
                await user.getIdToken(_hayRed);
            } catch (tokenErr) {
                const _code = (tokenErr && tokenErr.code) || '';
                const _esDeRed = _code === 'auth/network-request-failed' || !navigator.onLine;
                if (!_esDeRed) {
                    console.warn('[Cronos] Token inválido — limpiando sesión:', _code || tokenErr.message);
                    await signOut(auth).catch(() => {});
                    const el = document.getElementById('auth-screen');
                    if (el) {
                        document.body.classList.remove('locked');
                        el.style.display = 'flex';
                    }
                    return;
                }
                console.warn('[Cronos] Sin red al validar el token: se continúa con el cacheado.');
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

    // ── Revalidación al recuperar la cobertura ────────────────────
    // Con la caché en disco, un usuario puede haber entrado leyendo su
    // autorización del disco, sin hablar con el servidor. Eso es lo que hace
    // usable la app sin cobertura, pero no puede quedarse así para siempre:
    // en cuanto vuelve la red hay que comprobar contra el SERVIDOR que la
    // cuenta sigue siendo válida y expulsar si ya no lo es.
    //
    // Es la mitad que le faltaba a lo que quitó SEC-M08: allí se entraba con
    // datos sin verificar y nunca se verificaban; aquí se entra con datos que
    // FUERON verificados y se revalidan a la primera oportunidad.
    //
    // Sólo mira las dos condiciones inequívocas —token revocado y cuenta
    // borrada o desautorizada— para no duplicar la política de roles, que
    // vive entera en checkAuthorization y divergiría al copiarla.
    let _revalidando = false;
    window.addEventListener('online', async () => {
        if (_revalidando) return;
        const u = auth.currentUser;
        if (!u || !window._cronosCurrentUser) return;
        _revalidando = true;
        try {
            await u.getIdToken(true);   // token revocado → lanza
            const snap = await getDocFromServer(doc(db, 'users', u.uid));
            const d = snap.exists() ? snap.data() : null;
            const _fuera = !d || d.isAuthorized === false ||
                           d.status === 'suspended' || d.status === 'deleted';
            if (_fuera) {
                console.warn('[Cronos] La cuenta ya no está autorizada. Cerrando sesión.');
                if (typeof window._cronosPurgeAllLocalPII === 'function') window._cronosPurgeAllLocalPII();
                await signOut(auth).catch(() => {});
                location.reload();
                return;
            }
            console.log('[Cronos] Cobertura recuperada: autorización revalidada contra el servidor.');
        } catch (e) {
            const _code = (e && e.code) || '';
            if (_code === 'auth/user-token-expired' || _code === 'auth/user-disabled' ||
                _code === 'auth/user-not-found') {
                await signOut(auth).catch(() => {});
                location.reload();
                return;
            }
            // Red aún inestable u otro fallo transitorio: se reintenta en el
            // siguiente evento 'online'. Nunca se expulsa por esto.
            console.warn('[Cronos] No se pudo revalidar al reconectar:', e.message);
        } finally {
            _revalidando = false;
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


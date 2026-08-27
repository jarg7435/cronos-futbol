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
            setPersistence, browserSessionPersistence,
            // v451 · recuperación y cambio de contraseña. `updatePassword`
            // exige sesión reciente, así que reautenticamos SIEMPRE antes con
            // la contraseña actual: de paso se comprueba que quien la cambia
            // es el dueño y no alguien que pilló el móvil desbloqueado.
            sendPasswordResetEmail, updatePassword,
            reauthenticateWithCredential, EmailAuthProvider } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    // v468 · ⚠️ `terminate` y `clearIndexedDbPersistence` YA NO SE IMPORTAN, y
    // no es limpieza cosmética: es la barrera. Con ellas a mano, el arreglo de
    // v467 las usó en el arranque creyendo que actuaba sobre una instancia
    // "temporal" —no existe tal cosa: `initializeFirestore` crea LA instancia
    // de la app— y dejó la aplicación entera corriendo sobre un cliente
    // terminado: bloqueo total de acceso. Sin el import, esa vía no se puede
    // volver a tomar por descuido. La caché se borra por IndexedDB, más abajo.
    const { getFirestore, initializeFirestore, persistentLocalCache,
            persistentMultipleTabManager,
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

    // ══════════════════════════════════════════════════════════════
    //  🛡️ v634 · APP CHECK, REACTIVADO — pero SOLO donde puede funcionar
    //
    //  Estuvo apagado desde la v227: el intercambio de token daba 403 y
    //  entraba en throttle de 24 h. Aquella nota dejaba tres cosas por
    //  comprobar; MEDIDAS contra los servidores de Google: el secreto esta
    //  puesto en la consola, la API firebaseappcheck esta ENABLED y la clave
    //  de sitio es valida y v3/invisible.
    //
    //  🔑🔑 SOLO SE ARRANCA EN DOMINIOS REGISTRADOS EN LA CLAVE DE reCAPTCHA.
    //  En uno que no lo este, el intercambio falla y **dispara un throttle de
    //  24 h** — el agujero exacto de la v227. Y testeo y produccion se prueban
    //  en el MISMO navegador, asi que un throttle provocado en testeo
    //  estropearia la sesion de produccion.
    //
    //  ⚠️⚠️ POR ESO, ANTES DE AÑADIR UN HOST A LA LISTA: registrarlo en
    //  https://www.google.com/recaptcha/admin (la clave de abajo). El orden
    //  importa, y al reves no avisa nadie. Se comprueba de verdad sondeando
    //  el `anchor` de reCAPTCHA con ese origen: un dominio desconocido
    //  devuelve ~1,5 KB de pagina de error; uno registrado, ~39 KB.
    //  (`cronos-futbol-test.web.app` se dio de alta el 2026-08-26 y se
    //  verifico asi antes de meterlo aqui.)
    //
    //  ⚠️ ACTIVAR EL SDK NO BASTA. App Check solo defiende cuando la
    //  OBLIGATORIEDAD esta encendida por servicio en Firebase Console
    //  (Firestore, Identity Toolkit...). Es un paso APARTE, y puede dejar
    //  clientes fuera: consultar alli el estado antes de tocarlo.
    // ══════════════════════════════════════════════════════════════
    const _RECAPTCHA_SITE_KEY = '6Ld5cEQtAAAAAA0OCimDVsOORapoEKfsVmJmGI23';
    const APPCHECK_HOSTS = ['cronos-futbol-app.web.app', 'cronos-futbol-app.firebaseapp.com',
                            'cronos-futbol-test.web.app'];
    const _host  = (typeof location !== 'undefined' && location.hostname) || '';
    const _local = _host === 'localhost' || _host === '127.0.0.1';

    if (APPCHECK_HOSTS.includes(_host) || _local) {
        try {
            // En desarrollo se usa el token de DEPURACION: localhost tampoco
            // esta en reCAPTCHA, y sin esto `npm run dev` quedaria igual de
            // roto que testeo. El token lo imprime el SDK en la consola y hay
            // que darlo de alta en Firebase Console > App Check > Apps.
            // ⚠️ Va detras del `if`: NUNCA se activa en produccion.
            if (_local) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

            const { initializeAppCheck, ReCaptchaV3Provider } =
                await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js');
            initializeAppCheck(app, {
                provider: new ReCaptchaV3Provider(_RECAPTCHA_SITE_KEY),
                isTokenAutoRefreshEnabled: true
            });
            window._cronosAppCheck = 'on';
            console.log('[Chronos] App Check activo (reCAPTCHA v3) en ' + _host);
        } catch (e) {
            // ⚠️ JAMAS puede tumbar el arranque. Mientras la obligatoriedad
            // no este encendida, la app funciona igual sin token.
            window._cronosAppCheck = 'error';
            console.warn('[Chronos] App Check no arrancó:', e && e.message);
        }
    } else {
        window._cronosAppCheck = 'off';
        console.log('[Chronos] App Check inactivo en ' + _host +
                    ': ese dominio no está registrado en la clave de reCAPTCHA.');
    }

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
    // ══════════════════════════════════════════════════════════════
    //  v467 · EL BORRADO DE LA CACHÉ SE HACE **ANTES** DE QUE EXISTA
    //  LA INSTANCIA QUE LA APP VA A USAR
    // ══════════════════════════════════════════════════════════════
    //  Emergencia reportada por el autor: bucles de
    //  `The client has already been terminated` y de
    //  `failed-precondition` al guardar sucesos; nada se sincronizaba.
    //
    //  ⚠️ CAUSA: `_purgeStaleLocalDataIfNeeded` (login con un uid distinto al
    //  último del dispositivo — o sea, CADA vez que se cambia de cuenta en el
    //  mismo navegador, que es lo normal en una demo) llamaba a
    //  `_cronosClearFirestoreCache()`, y ésa hace `terminate(db)` sobre LA
    //  INSTANCIA QUE LA APP ESTÁ USANDO y sólo recarga la página en el
    //  `.finally()`, DESPUÉS de `clearIndexedDbPersistence`.
    //
    //  El cliente muere en el acto, pero la recarga puede tardar mucho o no
    //  llegar: `clearIndexedDbPersistence` **rechaza o se queda colgada si otra
    //  pestaña sigue usando la persistencia**, y con el gestor multipestaña eso
    //  es lo habitual (live.html abierto, o los dos partidos simultáneos que
    //  v465 hizo posibles). En esa ventana la app sigue viva sobre un cliente
    //  muerto: el latido de 5 s y cada escritura de suceso fallan una y otra
    //  vez. De ahí los bucles y la pérdida total de sincronización.
    //
    //  🔑 LA REGLA: **no se termina jamás el cliente que la app sigue usando.**
    //  Quien quiere limpiar la caché deja una MARCA y recarga en el acto; el
    //  borrado se hace aquí, en el arranque siguiente, cuando todavía no hay
    //  instancia que romper. Sale gratis en el 99,9 % de los arranques (una
    //  lectura de localStorage) y elimina la ventana de cliente muerto.
    //  ⚠️⚠️ v468 · SE BORRA EL IndexedDB DIRECTAMENTE, SIN TOCAR FIRESTORE.
    //  La primera versión de esto (v467) hacía aquí
    //  `const _tmp = initializeFirestore(app, {}); await terminate(_tmp); ...`
    //  y ERA UN BLOQUEO TOTAL DE ACCESO: `initializeFirestore` NO crea una
    //  instancia "temporal", crea LA instancia de esa app. La segunda llamada
    //  —la de abajo, la que lleva `localCache`— LANZA ("Firestore has already
    //  been started"), cae al `catch`, y `getFirestore(app)` devuelve
    //  EXACTAMENTE LA INSTANCIA QUE SE ACABA DE TERMINAR. La app arrancaba
    //  entera sobre un cliente muerto y no se podía ni iniciar sesión.
    //
    //  🔑 LA CACHÉ DE FIRESTORE ES UN IndexedDB Y SE PUEDE BORRAR COMO TAL.
    //  No hace falta ninguna instancia: ni crearla, ni terminarla, ni el baile
    //  de `clearIndexedDbPersistence`, que además exige que la instancia esté
    //  terminada y falla si otra pestaña la tiene abierta. Aquí, ANTES de que
    //  exista ningún cliente, basta con pedirle al navegador que borre esas
    //  bases. Es la única forma de cumplir la regla de v467 —no se termina
    //  jamás el cliente que la app usa— sin quedarse sin cliente.
    // ⚠️⚠️ v469 · EL ARRANQUE NO HACE **NADA** CON LA CACHÉ. Aquí no va código.
    //
    // v467 y v468 metieron trabajo en este punto —crear una instancia, terminar
    // la instancia, enumerar y borrar bases de IndexedDB— y las dos veces salió
    // mal en producción: v467 dejó la app sin cliente (bloqueo de acceso) y
    // v468, aun sin terminar nada, siguió tocando el almacén JUSTO ANTES de que
    // el SDK abriera el suyo. El arranque de sesión es la ruta más crítica de
    // la aplicación y no admite pasos opcionales delante.
    //
    // 🔑 EL BORRADO SE HACE AL SALIR, NO AL ENTRAR (ver
    // `_cronosClearFirestoreCache` más abajo): en ese momento la página se va a
    // recargar de todos modos, así que pedir el borrado no le quita el cliente
    // a nadie. Si otra pestaña tiene la base abierta, el navegador deja el
    // borrado EN COLA y lo completa solo cuando se cierran las conexiones —que
    // es exactamente lo que pasa al recargar—, sin que nadie tenga que esperar.

    let db;
    try {
        db = initializeFirestore(app, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        });
    } catch (e) {
        console.warn('[Chronos] Caché persistente no disponible; se usa la de memoria:', e.message);
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
    // v467 · ⚠️ YA NO TERMINA NADA AQUÍ. Antes hacía `terminate(db)` sobre la
    // instancia viva y esperaba a `clearIndexedDbPersistence`, que se cuelga o
    // rechaza cuando otra pestaña tiene la persistencia abierta (lo habitual
    // con el gestor multipestaña). El cliente quedaba muerto y la app seguía
    // funcionando encima: bucles de `The client has already been terminated` en
    // el latido de 5 s y en cada escritura de suceso. Era la emergencia de v466.
    //
    // Ahora sólo DEJA LA MARCA. El borrado de verdad lo hace el arranque
    // siguiente, arriba en este mismo fichero, ANTES de crear la instancia que
    // usará la app — que es el único momento en que se puede hacer sin romper
    // nada. Los tres llamadores recargan justo después, así que la limpieza
    // ocurre igual y en el mismo gesto del usuario.
    //
    // Devuelve `true` porque, desde el punto de vista del llamador, la limpieza
    // queda garantizada: lo que cambia es CUÁNDO.
    // v469 · Se PIDE el borrado aquí mismo y se vuelve en el acto. Sus tres
    // llamadores (logout de security-and-state.js, logout de auth.js y el
    // cambio de usuario de firestore-storage.js) recargan justo después, y esa
    // recarga cierra las conexiones que tuviera abiertas la base: el navegador
    // completa entonces el borrado que aquí queda encolado.
    //
    // ⚠️ NO SE ESPERA A QUE TERMINE, y es deliberado. Esperar fue el fallo de
    // v467: `clearIndexedDbPersistence` se queda colgada si otra pestaña tiene
    // la persistencia abierta, y la app se quedaba viva sobre un cliente
    // muerto. Aquí no hay nada que esperar ni ninguna instancia que tocar.
    window._cronosClearFirestoreCache = async function _cronosClearFirestoreCache() {
        // ══════════════════════════════════════════════════════════════
        //  v470 · ⚠️⚠️ ESTA FUNCIÓN NO BORRA NADA, Y ES DELIBERADO.
        // ══════════════════════════════════════════════════════════════
        //  Reporte del autor: vuelve `The client has already been terminated`,
        //  y esta vez EN `live.html`. Ahí estaba la pieza que me faltaba:
        //
        //  🔑🔑 `live.html` ES OTRO DOCUMENTO CON SU PROPIA INSTANCIA DE
        //  FIRESTORE, PERO COMPARTE EL MISMO IndexedDB (el gestor
        //  multipestaña es obligatorio ahí, y lo normal es tener el visor y la
        //  app abiertos a la vez). Al borrar esa base desde aquí —logout o
        //  cambio de cuenta en la app— el navegador fuerza el cierre de la
        //  conexión que el VISOR tiene abierta, y el SDK del visor termina su
        //  cliente. De ahí el error, y de ahí la "latencia" y las
        //  "acumulaciones que saltan de golpe": no había retardo, había
        //  escrituras fallando y reintentándose.
        //
        //  ⚠️ Y LO EMPEORÉ YO. Hasta v466 esto usaba
        //  `clearIndexedDbPersistence`, que **se niega** cuando otro documento
        //  tiene la persistencia abierta: con el visor abierto no hacía nada y
        //  por eso nunca molestó. Al cambiarlo por `indexedDB.deleteDatabase`
        //  (v468/v469) pasó a borrar DE VERDAD, y a llevarse por delante el
        //  cliente del visor.
        //
        //  Se vuelve al comportamiento de v466 y anteriores: NO se toca la
        //  caché en disco. La purga de PII de `localStorage`
        //  (`_cronosPurgeAllLocalPII`, que es la que guarda plantillas,
        //  nombres y convocatorias) SIGUE HACIÉNDOSE y no ha cambiado.
        //
        //  HUECO CONOCIDO Y ASUMIDO: en un dispositivo COMPARTIDO por dos
        //  usuarios distintos, los documentos que Firestore dejó cacheados en
        //  disco sobreviven al cambio de cuenta, y las lecturas servidas desde
        //  esa caché no pasan por las reglas. Cerrarlo exige una vía que no
        //  pueda tumbar al visor —y no la hay desde aquí—: el sitio correcto
        //  es hacerlo al ARRANCAR, cuando aún no hay ningún cliente abierto en
        //  ninguna pestaña, y eso es justo lo que v467/v468 demostraron que no
        //  se puede improvisar en la ruta de login. Queda como trabajo aparte,
        //  con su propio guard, y NO se hace en caliente durante un partido.
        console.log('[Cronos-Privacy] Caché en disco de Firestore: NO se toca ' +
                    '(la comparte live.html; borrarla le mata el cliente al visor).');
        return true;
    };

    // ══════════════════════════════════════════════════════════════
    //  v467 · RED DE SEGURIDAD: UN CLIENTE MUERTO NO PUEDE QUEDARSE
    //  DANDO VUELTAS
    // ══════════════════════════════════════════════════════════════
    //  Aunque arriba se haya cerrado la causa conocida, un cliente terminado
    //  puede volver a aparecer por otras vías (una pestaña que se quedó con la
    //  versión anterior, un fallo del SDK, el navegador cerrando IndexedDB por
    //  cuota). Y lo que hacía daño de verdad NO era el fallo puntual: era que
    //  la app seguía intentándolo cada 5 segundos, para siempre, sin decir
    //  nada al usuario y sin guardar un solo suceso.
    //
    //  🔑 Un cliente terminado NO se recupera: la única salida es recargar. Y
    //  recargar es barato desde v465, porque la pestaña recupera SU partido
    //  (js/core/match-slots.js) con marcador, cronómetro y alineación.
    //
    //  ⚠️ CON TOPE DE UN INTENTO POR SESIÓN. Si el problema persistiera, una
    //  recarga automática en bucle sería peor que el propio fallo: dejaría la
    //  app inservible y sin forma de leer el aviso. A partir del segundo, se
    //  informa y se deja al usuario decidir.
    const _CLAVE_RECARGA = 'cronos_recuperacion_cliente';
    window._cronosClienteTerminado = function(err) {
        if (!err) return false;
        const msg = String((err && err.message) || err).toLowerCase();
        const code = String((err && err.code) || '').toLowerCase();
        return msg.includes('client has already been terminated') ||
               msg.includes('client has already been closed') ||
               (code.includes('failed-precondition') && msg.includes('terminated'));
    };
    window._cronosRecuperaSiClienteMuerto = function(err, origen) {
        try {
            if (!window._cronosClienteTerminado(err)) return false;
            let intentos = 0;
            try { intentos = Number(sessionStorage.getItem(_CLAVE_RECARGA)) || 0; } catch (e) {}
            if (intentos >= 1) {
                if (!window._cronosAvisoClienteMuerto) {
                    window._cronosAvisoClienteMuerto = true;
                    console.error('[Chronos] Cliente de Firestore terminado y la recarga no lo arregló (' + (origen || '') + ').');
                    if (typeof showToast === 'function') {
                        showToast('⚠️ Se ha perdido la conexión con la base de datos. Cierra las demás pestañas de la app y vuelve a entrar.', 12000);
                    }
                }
                return true;
            }
            try { sessionStorage.setItem(_CLAVE_RECARGA, String(intentos + 1)); } catch (e) {}
            console.error('[Chronos] Cliente de Firestore terminado (' + (origen || '') +
                          '). Recargando para restablecer la sincronización.');
            if (typeof showToast === 'function') {
                showToast('🔄 Restableciendo la conexión…', 4000);
            }
            // Un respiro para que el aviso se vea y para que cualquier escritura
            // ya encolada por el SDK tenga su oportunidad.
            setTimeout(() => { try { location.reload(); } catch (e) {} }, 1200);
            return true;
        } catch (e) { return false; }
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
            console.error('[Chronos] Firebase auth error:', err);
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
        reauthenticateWithCredential, EmailAuthProvider,
        // 🎟️ v633 · Lo necesita invite-prefill.js para marcar la invitación
        // como usada en cuanto aparece la sesión. Mismo motivo que arriba: es
        // un script CLÁSICO y no puede importar el SDK por su cuenta.
        onAuthStateChanged
    };

    // SECURITY FIX (SEC-001): Removed sessionStorage-based session restoration.
    // This was an auth bypass — an attacker could write arbitrary uid/email/role
    // to sessionStorage and impersonate any user including superadmin.
    // Session must always be verified via Firebase Auth onAuthStateChanged.

    // ══════════════════════════════════════════════════════════════
    //  🔐 v638 · LA SESIÓN VIVE MIENTRAS LA APP ESTÉ ABIERTA, NO EN DISCO
    //
    //  Reportado como «la aplicación accede automáticamente nada más
    //  rellenarse el campo del correo, aprovechando las credenciales
    //  memorizadas por el navegador, sin pulsar ENTRAR»
    //  (implementar.txt 2026-08-27, punto 3).
    //
    //  🔑 EL AUTOCOMPLETADO NO TENÍA NADA QUE VER. Nadie llama a `doAuth()`
    //  desde un `input`: el formulario sólo entra por su `submit`. Lo que
    //  pasaba es que `browserLocalPersistence` guarda la sesión en IndexedDB
    //  POR ORIGEN y sobrevive al cierre del navegador, así que el observador
    //  de aquí abajo la restauraba y llamaba a `checkAuthorization` él solo.
    //  Como esa restauración tarda un momento (lleva una ida al servidor a
    //  validar el token), daba tiempo a ver el login y a que el navegador
    //  rellenara el correo ANTES de que la app entrara. De ahí la impresión
    //  de que lo disparaba el campo. Coincidencia de tiempos, no causa.
    //
    //  ⚠️ Y EL CÓDIGO CONTRADECÍA LO QUE LA PROPIA APP PROMETE: el onboarding
    //  dice, literalmente, «La sesión solo dura mientras tienes la app
    //  abierta, por seguridad se cierra al salir» (index.html). Eso era falso
    //  desde siempre.
    //
    //  `browserSessionPersistence` lo alinea: la sesión aguanta recargas y la
    //  jornada entera con la pestaña abierta, y muere al CERRAR el navegador.
    //  Entonces sí hay que pulsar ENTRAR.
    //
    //  🔑 EFECTO COLATERAL BUENO: esta persistencia va en `sessionStorage`,
    //  que es POR PESTAÑA. Hasta ahora todas las ventanas del mismo navegador
    //  compartían UNA sesión —entrar con una 5ª cuenta expulsaba a las otras
    //  cuatro, la limitación que documentó v570 al no poder simular varios
    //  entrenadores a la vez—. Con esto, dos pestañas pueden llevar cuentas
    //  distintas.
    //
    //  ⚠️ SI SE REVIERTE, revertir también la promesa del onboarding: lo que
    //  no puede volver a pasar es que digan cosas distintas.
    // ══════════════════════════════════════════════════════════════
    setPersistence(auth, browserSessionPersistence).catch(() => {});

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
                    console.warn('[Chronos] Token inválido — limpiando sesión:', _code || tokenErr.message);
                    await signOut(auth).catch(() => {});
                    const el = document.getElementById('auth-screen');
                    if (el) {
                        document.body.classList.remove('locked');
                        el.style.display = 'flex';
                    }
                    return;
                }
                console.warn('[Chronos] Sin red al validar el token: se continúa con el cacheado.');
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
                console.warn('[Chronos] La cuenta ya no está autorizada. Cerrando sesión.');
                if (typeof window._cronosPurgeAllLocalPII === 'function') window._cronosPurgeAllLocalPII();
                await signOut(auth).catch(() => {});
                location.reload();
                return;
            }
            console.log('[Chronos] Cobertura recuperada: autorización revalidada contra el servidor.');
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
            console.warn('[Chronos] No se pudo revalidar al reconectar:', e.message);
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


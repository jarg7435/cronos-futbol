// Configuración de Firebase con tus llaves reales
const firebaseConfig = {
  apiKey: "AIzaSyAWPw-lE6ynYK1CkFpSbwCgRtitDzBpIb4",
  authDomain: "cronos-futbol-app.firebaseapp.com",
  projectId: "cronos-futbol-app",
  storageBucket: "cronos-futbol-app.firebasestorage.app",
  messagingSenderId: "393110572633",
  appId: "1:393110572633:web:27a7effed60975e690ab48",
  measurementId: "G-WP3921EM1Z"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Función para registrarse (FASE 1)
function registerUser(email, password) {
    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            // Guardar el usuario en la base de datos con acceso bloqueado por defecto
            return db.collection("users").doc(userCredential.user.uid).set({
                email: email,
                isAuthorized: false,
                role: "user"
            });
        })
        .then(() => {
            alert("Cuenta creada. Por ahora estás bloqueado, avisa al administrador.");
        })
        .catch((error) => {
            alert("Error al registrarse: " + error.message);
        });
}

// Función para iniciar sesión
function loginUser(email, password) {
    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            checkUserAccess(userCredential.user.uid);
        })
        .catch((error) => {
            alert("Error al entrar: " + error.message);
        });
}

// Comprobar si el usuario tiene permiso (isAuthorized)
function checkUserAccess(uid) {
    db.collection("users").doc(uid).get().then((doc) => {
        if (doc.exists && doc.data().isAuthorized) {
            window.location.href = "campo.html"; // O la página de tu juego
        } else {
            alert("Acceso denegado. Tu cuenta aún no ha sido autorizada.");
            auth.signOut();
        }
    });
}
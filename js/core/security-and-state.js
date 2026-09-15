// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — CORE/SECURITY-AND-STATE
// Seguridad, estado global, cerrar sesión
// ══════════════════════════════════════════════════════════════════
// NOTA: FORMATION_PRESETS, FIELD_MARGIN, clampToField,
// updateFormationOptions y applyFormationPreset están declarados en
// app-init.js y sobrescritos por formations.js (versiones actualizadas).
// Este archivo NO los redeclara para evitar conflictos.
// ══════════════════════════════════════════════════════════════════

// --- Función auxiliar para mostrar pantallas ---
function showScreen(screenId) {
    document.body.classList.remove('locked');
    document.querySelectorAll('#install-screen, #auth-screen, #role-selection-screen')
        .forEach(el => el.style.display = 'none');
    const el = document.getElementById(screenId);
    if (el) el.style.display = 'flex';
}

// --- Función auxiliar para mostrar errores de auth ---
function showAuthError(msg) {
    const errEl = document.getElementById('auth-error');
    if (errEl) {
        errEl.textContent = msg;
        errEl.style.color = '#ff5858';
    }
}

// --- CERRAR SESIÓN ---
async function cerrarSesion() {
    if (!confirm('¿Cerrar sesión?')) return;
    // 🔐 v720 · EL UID, LO PRIMERO. Más abajo esta función anula
    // `window._cronosCurrentUser` y DESPUÉS llama a la purga de PII, que desde
    // v720 necesita saber QUIÉN sale para barrer sólo lo suyo. Sin capturarlo
    // aquí llegaría vacía y barrería el almacén entero, llevándose los datos
    // de la otra cuenta abierta en otra pestaña.
    const _uidSaliente = (window._cronosCurrentUser && window._cronosCurrentUser.uid) ||
                         (window._cronos_auth && window._cronos_auth.auth &&
                          window._cronos_auth.auth.currentUser &&
                          window._cronos_auth.auth.currentUser.uid) || '';
    // 🔒 v699 · Soltar la plaza ANTES de cerrar la sesión de Firebase: después
    // ya no habría permiso para borrar la marca y quedaría ocupada hasta
    // caducar, bloqueando al propio usuario si entra desde otro aparato.
    try {
        if (typeof window.cronosSesionLibera === 'function') await window.cronosSesionLibera();
    } catch(e) { /* caducará sola */ }
    try {
        // Detener cronómetro si está en marcha
        if (typeof isRunning !== 'undefined' && isRunning) {
            isRunning = false;
            clearInterval(timerInterval);
        }
        // Cerrar sesión en Firebase
        const fa = window._cronos_auth;
        if (fa && fa.signOut && fa.auth) {
            await fa.signOut(fa.auth);
        }
    } catch(e) { /* continuar aunque falle */ }

    // Limpiar estado de sesión
    window._cronosCurrentUser = null;
    window._loginThisSession  = false;
    sessionStorage.clear();

    // [Cronos-Privacy] Logout: purga de la PII del usuario que sale (v720).
    if (typeof window._cronosPurgeAllLocalPII === 'function') window._cronosPurgeAllLocalPII(_uidSaliente);

    // [Cronos-Privacy] Y la caché EN DISCO de Firestore, que localStorage no
    // cubre: las lecturas servidas desde ella no pasan por las reglas, así que
    // sin borrarla el siguiente usuario del dispositivo podría leer documentos
    // cacheados de éste. Se espera antes de recargar para que dé tiempo a
    // completarse; si falla (otra pestaña abierta) no bloquea la salida.
    if (typeof window._cronosClearFirestoreCache === 'function') {
        await window._cronosClearFirestoreCache();
    }

    // Recargar para volver al login
    location.reload();
}

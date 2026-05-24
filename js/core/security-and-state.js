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

    // Recargar para volver al login
    location.reload();
}

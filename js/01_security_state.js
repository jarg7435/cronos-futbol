// --- SECURITY & INITIALIZATION ---
// ACCESS_CODE declarado en app.js

window.onload = () => {
    // La app arranca desde enterApp() en index.html tras la autenticación Firebase
};

function validateAccess() {
    const input = document.getElementById('access-input').value;
    const errorEl = document.getElementById('access-error');
    if (input === ACCESS_CODE) {
        sessionStorage.setItem('cronos_access', 'true');
        unlockApp();
    } else {
        errorEl.textContent = 'Código incorrecto. Inténtelo de nuevo.';
        document.getElementById('access-input').value = '';
    }
}

function unlockApp() {
    document.getElementById('access-screen').style.display = 'none';
    document.body.classList.remove('locked');
    init();
}

// --- CONFIGURATION & STATE (todas las variables ya declaradas en app.js) ---

// ══════════════════════════════════════════════════════════════════
//  FORMACIONES PREDEFINIDAS → usando FORMATION_PRESETS de app.js
// ══════════════════════════════════════════════════════════════════
// FORMATION_PRESETS ya declarado en app.js — bloque omitido aquí

// FIELD_MARGIN declarado en app.js

function clampToField(x, y) {
    return {
        x: Math.max(FIELD_MARGIN.minX, Math.min(FIELD_MARGIN.maxX, x)),
        y: Math.max(FIELD_MARGIN.minY, Math.min(FIELD_MARGIN.maxY, y)),
    };
}

// Actualiza el <select> de formación según la modalidad elegida
function updateFormationOptions() {
    const mode = document.getElementById('setup-mode')?.value || 'f7';
    const sel  = document.getElementById('setup-formation');
    if (!sel) return;
    const presets = FORMATION_PRESETS[mode];
    sel.innerHTML = '<option value="">-- Sin formación predefinida --</option>';
    Object.entries(presets).forEach(([key, val]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = val.label;
        sel.appendChild(opt);
    });
}

// --- APLICAR FORMACIÓN ---
function applyFormationPreset(key) {
    const presets = FORMATION_PRESETS[currentMode];
    if (!presets || !presets[key]) return;

    const preset = presets[key];
    const useFullField = !analyzeAway; // solo local → campo completo

    // CRÍTICO: Ordenar jugadores por DORSAL antes de asignar posiciones.
    // Esto garantiza que el portero (dorsal 1) vaya a la posición de portero,
    // el dorsal 2 al primer defensa, etc., sin importar el orden en que se
    // añadieron al array players (convocatoria, drag&drop, sustituciones).
    const sortedPlayers = [...players].sort((a, b) => {
        const na = a.number || 0;
        const nb = b.number || 0;
        return na - nb;
    });

    let homeIdx = 0, awayIdx = 0;
    sortedPlayers.forEach(p => {
        if (p.status !== 'field') return;
        if (p.team === 'home') {
            const positions = useFullField ? preset.full : preset.home;
            if (positions[homeIdx]) {
                const pos = clampToField(positions[homeIdx].x, positions[homeIdx].y);
                p.x = pos.x; p.y = pos.y;
                homeIdx++;
            }
        } else if (p.team === 'away') {
            const positions = preset.away;
            if (positions && positions[awayIdx]) {
                const pos = clampToField(positions[awayIdx].x, positions[awayIdx].y);
                p.x = pos.x; p.y = pos.y;
                awayIdx++;
            }
        }
    });

    // Actualizar botones activos
    activeFormationKey = key;
    document.querySelectorAll('.formation-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fkey === key);
    });

    renderPlayers();
}


// --- CERRAR SESIÓN ---
async function cerrarSesion() {
    if (!confirm('¿Cerrar sesión?')) return;
    try {
        // Detener cronómetro si está en marcha
        if (isRunning) {
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

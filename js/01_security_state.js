// --- SECURITY & INITIALIZATION ---
// NOTA: ACCESS_CODE, players, isRunning, COLORS, TEAM_NAMES, FORMATION_PRESETS,
// FIELD_MARGIN, liveMatchId, staffConfig, emailConfig, etc. están declarados
// en app.js (que carga primero). Solo definimos aquí las funciones.

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

    let homeIdx = 0, awayIdx = 0;
    players.forEach(p => {
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

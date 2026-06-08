// --- PERSISTENCE ---

// Helper centralizado para cargar datos de una plantilla
window.loadTeamData = function(teamKey, team, idx) {
    if (!team) return;

    // Sincronizar el select oculto
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    if (dropdown) dropdown.value = idx;

    // Cargar datos básicos en los campos de texto y colores
    const nameInput = document.getElementById(`setup-${teamKey}-name`);
    if (nameInput) nameInput.value = team.name;
    
    const colorInput = document.getElementById(`setup-${teamKey}-color`);
    if (colorInput) colorInput.value = team.color;
    
    const shortsInput = document.getElementById(`setup-${teamKey}-shorts`);
    if (shortsInput) shortsInput.value = team.shortsColor || '#ffffff';
    
    const textInput = document.getElementById(`setup-${teamKey}-text`);
    if (textInput) textInput.value = team.textColor || '#ffffff';

    if (team.secondaryColor) {
        const secEl = document.getElementById(`setup-${teamKey}-secondary`);
        if (secEl) secEl.value = team.secondaryColor;
        if (typeof COLORS !== 'undefined' && COLORS[teamKey]) COLORS[teamKey].secondary = team.secondaryColor;
    }

    // Sincronizar modalidad (Fútbol 7 o Fútbol 11)
    const teamMode = team.mode || 'f7';
    const modeEl = document.getElementById('setup-mode');
    if (modeEl) {
        modeEl.value = teamMode;
        if (typeof currentMode !== 'undefined') currentMode = teamMode;
    }

    // Sincronizar centralizadamente categorías, formaciones y filtrado de equipos
    if (typeof syncSetupMode === 'function') {
        syncSetupMode(teamMode);
    } else {
        if (typeof updateCategoryOptions === 'function') updateCategoryOptions(teamMode);
        if (typeof updateFormationOptions === 'function') updateFormationOptions(teamMode);
    }

    // Sincronizar la categoría del equipo con delay para asegurar que el select se haya regenerado
    if (team.category) {
        setTimeout(() => {
            const catEl = document.getElementById('match-category');
            if (catEl) {
                catEl.value = team.category;
                catEl.dispatchEvent(new Event('change'));
            }
        }, 100);
    }

    // Sincronizar el sistema táctico (formación)
    if (team.formation) {
        setTimeout(() => {
            const formEl = document.getElementById('setup-formation');
            if (formEl) formEl.value = team.formation;
        }, 120);
    }

    // Registrar los jugadores en el estado global
    if (!window.loadedTeamPlayers) window.loadedTeamPlayers = {};
    window.loadedTeamPlayers[teamKey] = team.players;

    // Resaltar visualmente la fila seleccionada en la lista
    const listEl = document.getElementById(`saved-teams-list-${teamKey}`);
    if (listEl) {
        Array.from(listEl.children).forEach((row) => {
            const isSelected = row.dataset.originalIndex == idx;
            row.style.background = isSelected ? 'rgba(63,185,80,0.12)' : '';
        });
    }

    // Sincronizar _pendingSetupState para evitar sobreescritura accidental
    if (window._pendingSetupState) {
        if (teamKey === 'home') {
            window._pendingSetupState.homeName   = team.name;
            window._pendingSetupState.homeColor  = team.color;
            window._pendingSetupState.homeShorts = team.shortsColor || '#ffffff';
            window._pendingSetupState.homeText   = team.textColor   || '#ffffff';
        } else {
            window._pendingSetupState.awayName   = team.name;
            window._pendingSetupState.awayColor  = team.color;
            window._pendingSetupState.awayShorts = team.shortsColor || '#ffffff';
            window._pendingSetupState.awayText   = team.textColor   || '#ffffff';
        }
        window._pendingSetupState.mode = teamMode;
        if (team.category) window._pendingSetupState.category = team.category;
        if (team.formation) window._pendingSetupState.formation = team.formation;
    }

    if (typeof showToast === 'function') showToast(`✅ Plantilla "${team.name}" cargada.`, 2500);
};

// ═══════════════════════════════════════════════════════════════════
// populateSavedTeams — Rellena el select oculto Y la lista visual
//   filtrada por la modalidad activa, con botón 🗑️ individual.
// ═══════════════════════════════════════════════════════════════════
function populateSavedTeams(teamKey) {
    const activeMode = document.getElementById('setup-mode')?.value || 'f7';

    // 1. Actualizar el <select> oculto (compatibilidad con código legado)
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    if (dropdown) {
        dropdown.innerHTML = '<option value="">-- Cargar --</option>';
        const teamsForSelect = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
        teamsForSelect.forEach((team, index) => {
            if ((team.mode || 'f7') === activeMode) {
                const opt = document.createElement('option');
                opt.value = index;
                opt.textContent = team.name;
                dropdown.appendChild(opt);
            }
        });
    }

    // 2. Actualizar la lista visual con botones de borrado individuales
    const listEl = document.getElementById(`saved-teams-list-${teamKey}`);
    if (!listEl) return;

    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    listEl.innerHTML = '';

    let hasFilteredTeams = false;
    teams.forEach((team, index) => {
        if ((team.mode || 'f7') === activeMode) {
            hasFilteredTeams = true;
            const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            const row = document.createElement('div');
            row.dataset.originalIndex = index; // Guardar el índice original para el resaltado
            row.style.cssText = [
                'display:flex', 'align-items:center', 'justify-content:space-between',
                'padding:0.38rem 0.55rem',
                'border-bottom:1px solid rgba(255,255,255,0.05)',
                'transition:background 0.15s'
            ].join(';');

            // Nombre clicable — carga la plantilla
            const nameSpan = document.createElement('span');
            nameSpan.title = `Cargar "${esc(team.name)}"`;
            nameSpan.style.cssText = [
                'flex:1', 'font-size:0.82rem', 'color:#e6edf3', 'font-weight:600',
                'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
                'padding-right:0.5rem', 'cursor:pointer'
            ].join(';');
            nameSpan.textContent = '⚽ ' + team.name;
            nameSpan.addEventListener('mouseenter', () => row.style.background = 'rgba(88,166,255,0.1)');
            nameSpan.addEventListener('mouseleave', () => row.style.background = row.style.background.includes('rgba(63,185,80') ? 'rgba(63,185,80,0.12)' : '');
            nameSpan.addEventListener('click', () => loadTeamByIndex(teamKey, index));

            // Botón eliminar individual
            const delBtn = document.createElement('button');
            delBtn.title = `Eliminar "${esc(team.name)}"`;
            delBtn.style.cssText = [
                'background:rgba(255,88,88,0.15)', 'border:1px solid rgba(255,88,88,0.45)',
                'color:#ff5858', 'font-size:0.75rem', 'padding:0.22rem 0.45rem',
                'border-radius:5px', 'cursor:pointer', 'flex-shrink:0',
                'white-space:nowrap', 'line-height:1.2', 'font-weight:700'
            ].join(';');
            delBtn.textContent = '🗑️';
            delBtn.addEventListener('mouseenter', () => delBtn.style.background = 'rgba(255,88,88,0.3)');
            delBtn.addEventListener('mouseleave', () => delBtn.style.background = 'rgba(255,88,88,0.15)');
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteTeamByIndex(teamKey, index, team.name);
            });

            row.appendChild(nameSpan);
            row.appendChild(delBtn);
            listEl.appendChild(row);
        }
    });

    if (!hasFilteredTeams) {
        listEl.innerHTML = `<p style="color:#8b949e;font-size:0.75rem;text-align:center;
                            padding:0.55rem 0.5rem;margin:0;">
                            Sin plantillas en esta modalidad</p>`;
    }
}

// ═══════════════════════════════════════════════════════════════════
// loadTeamByIndex — Carga una plantilla por su índice en el array
// ═══════════════════════════════════════════════════════════════════
function loadTeamByIndex(teamKey, idx) {
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const team = teams[idx];
    if (team) {
        window.loadTeamData(teamKey, team, idx);
    }
}

// ═══════════════════════════════════════════════════════════════════
// deleteTeamByIndex — Elimina una plantilla por su índice con confirm
// ═══════════════════════════════════════════════════════════════════
function deleteTeamByIndex(teamKey, idx, name) {
    if (!confirm(`¿Eliminar la plantilla «${name}»?\nEsta acción no se puede deshacer.`)) return;

    try {
        const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
        if (idx < 0 || idx >= teams.length) return;
        teams.splice(idx, 1);

        // 1. Guardar localmente primero (éxito garantizado en la UI)
        localStorage.setItem('cronos_teams', JSON.stringify(teams));
        
        // 2. Intentar sincronizar con la nube
        if (typeof cloudSet === 'function') {
            cloudSet('cronos_teams', JSON.stringify(teams)).catch(err => {
                console.warn('[Persistence] Error al sincronizar borrado en la nube:', err.message);
                if (err.message.includes('permission')) {
                    if (typeof showToast === 'function') showToast('⚠️ Borrado local OK, pero error de permisos en la nube. Contacta con soporte.', 5000);
                }
            });
        }

        // 3. Actualizar la interfaz inmediatamente
        if (typeof populateSavedTeams === 'function') {
            populateSavedTeams('home');
            populateSavedTeams('away');
        }

        if (typeof showToast === 'function') showToast(`🗑️ Plantilla «${name}» eliminada localmente.`, 3000);
    } catch (e) {
        console.error('[Persistence] Error en deleteTeamByIndex:', e);
        if (typeof showToast === 'function') showToast('❌ Error al eliminar equipo.', 3000);
    }
}

/**
 * Elimina una plantilla basándose en la selección actual del dropdown.
 */
function deleteTeamFromDropdown(teamKey) {
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    if (!dropdown) {
        console.warn(`[Persistence] No se encontró el desplegable saved-teams-${teamKey}`);
        return;
    }
    
    const index = dropdown.value;
    if (index === "" || index === null) {
        if (typeof showToast === 'function') {
            showToast("⚠️ Selecciona un equipo en el menú desplegable para poder borrarlo", 4000);
        }
        return;
    }

    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const team = teams[index];
    
    if (team) {
        console.log(`[Persistence] Solicitando borrado de equipo: ${team.name} (índice ${index})`);
        deleteTeamByIndex(teamKey, parseInt(index), team.name);
    } else {
        if (typeof showToast === 'function') showToast("❌ No se encontró el equipo seleccionado.", 3000);
    }
}

function loadTeamFromDropdown(teamKey) {
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    if (!dropdown) return;
    const index = dropdown.value;
    if (index === "") return;
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const team = teams[index];
    if (team) {
        window.loadTeamData(teamKey, team, parseInt(index));
    }
}

function saveCurrentTeam() {
    const choice = prompt("¿Qué equipo quieres guardar?\nEscribe '1' para Local\nEscribe '2' para Visitante");
    if (!choice) return;
    let teamKey = '';
    if (choice === '1' || choice.toLowerCase() === 'local') teamKey = 'home';
    else if (choice === '2' || choice.toLowerCase() === 'visitante') teamKey = 'away';
    else return;

    const teamName = TEAM_NAMES[teamKey];
    // Guardar jugadores: número, nombre, alias, status (titular=field / suplente=bench) y posición en campo
    const currentPlayers = players.filter(p => p.team === teamKey).map(p => ({
        id: p.id,
        number: p.number,
        name: p.name,
        status: p.status,   // 'field' = titular  |  'bench' = suplente
        x: p.x,
        y: p.y
    }));
    const newTeam = {
        name: teamName,
        color: COLORS[teamKey].primary,
        secondaryColor: COLORS[teamKey].secondary,
        shortsColor: COLORS[teamKey].shorts,
        textColor: COLORS[teamKey].text,
        players: currentPlayers,          // convocatoria completa con titulares y suplentes
        mode: currentMode,                // 'f7' o 'f11'
        formation: activeFormationKey     // sistema de juego activo
    };
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const existingIndex = teams.findIndex(t => t.name === teamName);
    if (existingIndex >= 0) {
        if (confirm(`¿Sobrescribir equipo "${teamName}"?`)) teams[existingIndex] = newTeam;
        else return;
    } else {
        if (teams.length >= 20) { alert('Memoria llena (20 equipos).'); return; }
        teams.push(newTeam);
    }
    showSpinner('Guardando equipo…');
    setTimeout(() => {
        cloudSet('cronos_teams', JSON.stringify(teams));
        const titulares = currentPlayers.filter(p => p.status === 'field').length;
        const suplentes = currentPlayers.filter(p => p.status === 'bench').length;
        const formationDisplay = activeFormationKey ? '1-' + activeFormationKey : 'sin definir';
        hideSpinner();
        showToast('✅ ' + teamName + ' guardado · ' + (currentMode === 'f7' ? 'F7' : 'F11') + ' · ' + formationDisplay + ' · ' + titulares + 'T + ' + suplentes + 'S');
    }, 300);
}

// ════════════════════════════════════════════════════════════════════
//  POST-MATCH OPTIONS
//  (setupEventListeners, spawnInitialPlayers, toggleGame, tick,
//   updateMasterUI, editTimer, showSpinner, hideSpinner, showToast,
//   formatTime — are defined in their respective owner modules:
//   js/core/event-listeners.js and js/match/timer/core.js.
//   endMatch se define en active-match.js)
// ════════════════════════════════════════════════════════════════════

/**
 * _showPostMatchOptions() — Modal post-partido sobre la vista del partido.
 * Usa #setup-modal para no destruir el estado del partido en #main-container.
 * Así el entrenador puede volver si lo necesita.
 */
window._showPostMatchOptions = function _showPostMatchOptions() {
    const home   = (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES.home) || 'Local';
    const away   = (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES.away) || 'Visitante';
    const scoreH = (typeof scoreHome  !== 'undefined') ? scoreHome  : '—';
    const scoreA = (typeof scoreAway  !== 'undefined') ? scoreAway  : '—';

    // Estadísticas rápidas del partido
    const totalPlayers  = (players || []).filter(p => p.team === 'home').length;
    const totalGoals    = (players || []).filter(p => p.team === 'home').reduce((s, p) => s + (p.goals || 0), 0);
    const totalCards    = (players || []).filter(p => p.team === 'home' && p.cards && p.cards !== 'ninguna').length;
    const totalInjured  = (players || []).filter(p => p.team === 'home' && p.injured).length;
    const h1min = Math.floor((masterTimeH1 || 0) / 60);
    const h2min = Math.floor((masterTimeH2 || 0) / 60);

    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,480px);max-height:94vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#161b22,#0d1117);
                    padding:1.2rem 1.5rem;border-bottom:1px solid var(--glass-border);">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:0.8rem;">
                <span style="font-size:1.8rem;">🏁</span>
                <div>
                    <div style="font-family:'Outfit',sans-serif;font-weight:700;
                                font-size:1.1rem;color:white;">
                        ¡Partido Finalizado!
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-muted);">
                        1ª parte: ${h1min}' · 2ª parte: ${h2min}'
                    </div>
                </div>
            </div>
            <!-- Marcador -->
            <div style="display:flex;justify-content:center;align-items:center;
                        gap:1.2rem;background:rgba(255,255,255,0.04);
                        border-radius:10px;padding:0.8rem;
                        border:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:0.9rem;font-weight:700;color:white;">${home}</span>
                <span style="font-size:1.8rem;font-weight:800;
                             color:var(--primary);letter-spacing:2px;">
                    ${scoreH} – ${scoreA}
                </span>
                <span style="font-size:0.9rem;font-weight:700;color:white;">${away}</span>
            </div>
        </div>

        <!-- Stats rápidas -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;
                    border-bottom:1px solid var(--glass-border);">
            ${[
                ['👥', totalPlayers, 'Jugadores'],
                ['⚽', totalGoals,   'Goles'],
                ['🟨', totalCards,   'Tarjetas'],
                ['🩹', totalInjured, 'Lesiones'],
            ].map(([icon, val, lbl]) => `
            <div style="text-align:center;padding:0.8rem 0.4rem;
                        border-right:1px solid var(--glass-border);">
                <div style="font-size:1rem;">${icon}</div>
                <div style="font-size:1.2rem;font-weight:800;color:white;">${val}</div>
                <div style="font-size:0.62rem;color:var(--text-muted);">${lbl}</div>
            </div>`).join('')}
        </div>

        <!-- Opciones -->
        <div style="flex:1;overflow-y:auto;padding:1.1rem;
                    display:flex;flex-direction:column;gap:0.6rem;">

            <!-- ENVIAR INFORMES — acción principal -->
            <button onclick="_postMatchSendReports()"
                style="display:flex;align-items:center;gap:0.9rem;
                       padding:0.9rem 1rem;width:100%;
                       background:rgba(63,185,80,0.12);
                       border:1px solid rgba(63,185,80,0.35);
                       border-radius:10px;cursor:pointer;
                       color:white;font-size:0.92rem;font-weight:700;
                       transition:all 0.2s;"
                onmouseover="this.style.background='rgba(63,185,80,0.2)'"
                onmouseout="this.style.background='rgba(63,185,80,0.12)'">
                <span style="font-size:1.4rem;">📊</span>
                <div style="text-align:left;">
                    <div style="color:#3fb950;">Enviar Informes a Padres</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);
                                font-weight:400;">WhatsApp · Email · App interna</div>
                </div>
            </button>

            <!-- VOLVER AL PARTIDO -->
            <button onclick="_postMatchReturn()"
                style="display:flex;align-items:center;gap:0.9rem;
                       padding:0.9rem 1rem;width:100%;
                       background:rgba(88,166,255,0.1);
                       border:1px solid rgba(88,166,255,0.3);
                       border-radius:10px;cursor:pointer;
                       color:white;font-size:0.92rem;font-weight:600;
                       transition:all 0.2s;"
                onmouseover="this.style.background='rgba(88,166,255,0.18)'"
                onmouseout="this.style.background='rgba(88,166,255,0.1)'">
                <span style="font-size:1.4rem;">↩️</span>
                <div style="text-align:left;">
                    <div style="color:var(--primary);">Volver al Partido</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);
                                font-weight:400;">Los datos del partido se conservan</div>
                </div>
            </button>

            <!-- COMUNICACIONES -->
            <button onclick="openUnifiedCommsMenu ? openUnifiedCommsMenu() : null"
                style="display:flex;align-items:center;gap:0.9rem;
                       padding:0.9rem 1rem;width:100%;
                       background:rgba(255,255,255,0.04);
                       border:1px solid var(--glass-border);
                       border-radius:10px;cursor:pointer;
                       color:white;font-size:0.92rem;font-weight:600;
                       transition:all 0.2s;"
                onmouseover="this.style.background='rgba(255,255,255,0.08)'"
                onmouseout="this.style.background='rgba(255,255,255,0.04)'">
                <span style="font-size:1.4rem;">💬</span>
                <div style="text-align:left;">
                    <div>Comunicaciones</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);
                                font-weight:400;">Convocatoria, mensajes y más</div>
                </div>
            </button>

            <!-- NUEVA CONFIGURACIÓN -->
            <button onclick="_postMatchNewSetup()"
                style="display:flex;align-items:center;gap:0.9rem;
                       padding:0.9rem 1rem;width:100%;
                       background:rgba(255,255,255,0.03);
                       border:1px solid rgba(255,255,255,0.08);
                       border-radius:10px;cursor:pointer;
                       color:var(--text-muted);font-size:0.88rem;
                       transition:all 0.2s;"
                onmouseover="this.style.background='rgba(255,255,255,0.06)'"
                onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                <span style="font-size:1.2rem;">🔄</span>
                <div style="text-align:left;">
                    <div>Nueva Configuración</div>
                    <div style="font-size:0.7rem;color:rgba(125,133,144,0.8);
                                font-weight:400;">Volver a la pantalla inicial del partido</div>
                </div>
            </button>

        </div>
    </div>`;
};

/** Desde la pantalla post-partido → abre el módulo de envío de informes */
window._postMatchSendReports = function() {
    if (typeof sendMatchReportsToParents === 'function') {
        sendMatchReportsToParents(false);
    } else if (typeof openUnifiedCommsMenu === 'function') {
        openUnifiedCommsMenu();
    } else {
        document.getElementById('setup-modal').style.display = 'none';
    }
};

/**
 * Volver al partido — cierra el modal y muestra el main-container.
 * El estado del partido (jugadores, crono, goles) se conserva intacto.
 */
window._postMatchReturn = function() {
    const modal = document.getElementById('setup-modal');
    if (modal) modal.style.display = 'none';

    // Asegurar que el contenedor principal está visible
    const mc = document.getElementById('main-container');
    const mh = document.getElementById('main-header');
    if (mc) mc.style.display = 'flex';
    if (mh) mh.style.display = 'flex';

    if (typeof showToast === 'function')
        showToast('↩️ Volviste al partido — los datos siguen activos', 3000);
};

/** Desde la pantalla post-partido → nueva configuración */
window._postMatchNewSetup = function() {
    if (!confirm('¿Empezar una nueva configuración? Se perderá el estado actual del partido.')) return;
    if (typeof openSetupModal === 'function') {
        openSetupModal();
    } else {
        const modal = document.getElementById('setup-modal');
        if (modal) modal.style.display = 'none';
    }
};

// ═══════════════════════════════════════════════════════════════════
// saveTeamSetup / deleteTeamSetup — Guardar/Eliminar equipo desde modal
// Movido desde app-init.js (v73)
// ═══════════════════════════════════════════════════════════════════
function saveTeamSetup(teamKey) {
    const nameEl = document.getElementById('setup-' + teamKey + '-name');
    const colorEl = document.getElementById('setup-' + teamKey + '-color');
    const shortsEl = document.getElementById('setup-' + teamKey + '-shorts');
    const textEl = document.getElementById('setup-' + teamKey + '-text');
    if (!nameEl) return;

    const teamName = (nameEl.value || '').trim();
    if (!teamName || teamName === 'LOCAL' || teamName === 'VISITANTE') {
        showToast('⚠️ Escribe un nombre para el equipo antes de guardar.', 3000);
        nameEl.focus();
        return;
    }

    const newTeam = {
        name:         teamName,
        color:        colorEl ? colorEl.value : '#58a6ff',
        shortsColor:  shortsEl ? shortsEl.value : '#ffffff',
        textColor:    textEl ? textEl.value : '#ffffff',
        mode:         (typeof currentMode !== 'undefined') ? currentMode : 'f7',
        category:     document.getElementById('match-category')?.value || '',
        players:      [],
        savedAt:      new Date().toISOString(),
    };

    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const existingIdx = teams.findIndex(t => t.name === teamName);

    if (existingIdx >= 0) {
        if (!confirm('Ya existe el equipo «' + teamName + '». ¿Sobrescribir?')) return;
        teams[existingIdx] = { ...teams[existingIdx], ...newTeam };
    } else {
        if (teams.length >= 20) { showToast('⚠️ Límite de 20 equipos guardados.', 3000); return; }
        teams.push(newTeam);
    }

    if (typeof cloudSet === 'function') cloudSet('cronos_teams', JSON.stringify(teams));
    else localStorage.setItem('cronos_teams', JSON.stringify(teams));
    populateSavedTeams('home');
    populateSavedTeams('away');
    showToast('✅ Equipo «' + teamName + '» guardado correctamente.', 3000);
}
window.saveTeamSetup = saveTeamSetup;

function deleteTeamSetup(teamKey) {
    const nameEl = document.getElementById('setup-' + teamKey + '-name');
    const teamName = (nameEl ? nameEl.value : '').trim();
    if (!teamName || teamName === 'LOCAL' || teamName === 'VISITANTE') {
        showToast('⚠️ Primero carga un equipo guardado para poder eliminarlo.', 3000);
        return;
    }
    if (!confirm('¿Eliminar el equipo «' + teamName + '» de los equipos guardados?')) return;

    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const idx = teams.findIndex(t => t.name === teamName);
    if (idx < 0) { showToast('⚠️ Equipo no encontrado en los guardados.', 3000); return; }

    teams.splice(idx, 1);
    if (typeof cloudSet === 'function') cloudSet('cronos_teams', JSON.stringify(teams));
    else localStorage.setItem('cronos_teams', JSON.stringify(teams));
    populateSavedTeams('home');
    populateSavedTeams('away');

    if (nameEl) nameEl.value = teamKey === 'home' ? 'LOCAL' : 'VISITANTE';
    showToast('🗑️ Equipo «' + teamName + '» eliminado.', 3000);
}
window.deleteTeamSetup = deleteTeamSetup;

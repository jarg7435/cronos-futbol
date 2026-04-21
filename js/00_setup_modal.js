// ══════════════════════════════════════════════════════════════════
//  MODAL DE CONFIGURACIÓN DEL PARTIDO (Setup)
// ══════════════════════════════════════════════════════════════════

function openSetupModal() {
    document.body.classList.add('setup-mode');
    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:860px; max-width:98vw; padding:1.2rem; border-radius:16px;">
            <!-- Cabecera Responsiva -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.2rem; flex-wrap:wrap; gap:10px;">
                <div style="display:flex; align-items:center;">
                    <img src="img/logo_cronos.png" style="height:40px; margin-right:12px; filter: drop-shadow(0 0 10px rgba(88,166,255,0.3));" onerror="this.style.display='none'">
                    <span style="font-size:1.4rem; font-weight:900; color:var(--text); letter-spacing:-0.5px;">CRONOS <span style="color:#58a6ff;">FÚTBOL</span></span>
                </div>
                <button onclick="logout()" style="background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); color:var(--text-muted); padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem;">Cerrar Sesión</button>
            </div>

            <!-- CUADRICULA RESPONSIVA DE EQUIPOS -->
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:1.2rem; margin-bottom:1.2rem;">
                <!-- LOCAL -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:14px; overflow:hidden; display:flex; flex-direction:column;">
                    <div style="background:linear-gradient(90deg, #1d4ed8, #1e40af); color:white; padding:0.6rem 1rem; display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:0; font-size:0.85rem; font-weight:800; letter-spacing:1px;">LOCAL</h3>
                        <span style="font-size:1.1rem;">🏠</span>
                    </div>
                    <div style="padding:1rem; display:flex; flex-direction:column; gap:0.8rem;">
                        <div class="form-group" style="margin:0;">
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px; display:block;">Nombre del equipo</label>
                            <input type="text" id="setup-home-name" value="LOCAL" 
                                style="width:100%; padding:0.55rem; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:8px; color:white; font-weight:600;">
                        </div>
                        
                        <div>
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Colores (Camiseta / Pantalón / Dorsal)</label>
                            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.6rem;">
                                <input type="color" id="setup-home-color" value="#58a6ff" title="Camiseta"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                                <input type="color" id="setup-home-shorts" value="#ffffff" title="Pantalón"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                                <input type="color" id="setup-home-text" value="#000000" title="Dorsal"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                            </div>
                        </div>

                        <div style="margin-top:0.4rem; padding-top:0.8rem; border-top:1px solid rgba(255,255,255,0.08);">
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Plantilla Guardada</label>
                            <div style="display:flex; gap:0.5rem; align-items:center;">
                                <select id="saved-teams-home" onchange="loadTeamFromDropdown('home')" 
                                    style="flex:1; padding:0.5rem; background:rgba(255,255,255,0.07); border:1px solid var(--glass-border); border-radius:8px; color:white;">
                                    <option value="">-- Seleccionar --</option>
                                </select>
                                <button onclick="saveTeamSetup('home')" title="Guardar Plantilla"
                                    style="background:rgba(63,185,80,0.2); border:1px solid rgba(63,185,80,0.5); color:#3fb950; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">💾</button>
                                <button onclick="deleteTeamFromDropdown('home')" title="Borrar Plantilla"
                                    style="background:rgba(255,88,88,0.15); border:1px solid rgba(255,88,88,0.5); color:#ff5858; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">🗑️</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- VISITANTE -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:14px; overflow:hidden; display:flex; flex-direction:column;">
                    <div style="background:linear-gradient(90deg, #b91c1c, #991b1b); color:white; padding:0.6rem 1rem; display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:0; font-size:0.85rem; font-weight:800; letter-spacing:1px;">VISITANTE</h3>
                        <span style="font-size:1.1rem;">✈️</span>
                    </div>
                    <div style="padding:1rem; display:flex; flex-direction:column; gap:0.8rem;">
                        <div class="form-group" style="margin:0;">
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px; display:block;">Nombre del equipo</label>
                            <input type="text" id="setup-away-name" value="VISITANTE" 
                                style="width:100%; padding:0.55rem; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:8px; color:white; font-weight:600;">
                        </div>
                        
                        <div>
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Colores (Camiseta / Pantalón / Dorsal)</label>
                            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.6rem;">
                                <input type="color" id="setup-away-color" value="#ff5858" title="Camiseta"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                                <input type="color" id="setup-away-shorts" value="#000000" title="Pantalón"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                                <input type="color" id="setup-away-text" value="#ffffff" title="Dorsal"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                            </div>
                        </div>

                        <div style="margin-top:0.4rem; padding-top:0.8rem; border-top:1px solid rgba(255,255,255,0.08);">
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Plantilla Guardada</label>
                            <div style="display:flex; gap:0.5rem; align-items:center;">
                                <select id="saved-teams-away" onchange="loadTeamFromDropdown('away')" 
                                    style="flex:1; padding:0.5rem; background:rgba(255,255,255,0.07); border:1px solid var(--glass-border); border-radius:8px; color:white;">
                                    <option value="">-- Seleccionar --</option>
                                </select>
                                <button onclick="saveTeamSetup('away')" title="Guardar Plantilla"
                                    style="background:rgba(63,185,80,0.2); border:1px solid rgba(63,185,80,0.5); color:#3fb950; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">💾</button>
                                <button onclick="deleteTeamFromDropdown('away')" title="Borrar Plantilla"
                                    style="background:rgba(255,88,88,0.15); border:1px solid rgba(255,88,88,0.5); color:#ff5858; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">🗑️</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- FILA: Mi Equipo (Local/Visitante) -->
            <div style="margin-bottom:1.2rem; text-align:center; background:rgba(255,255,255,0.04); border:1px solid var(--glass-border); padding:0.8rem; border-radius:12px; display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:1rem;">
                <label style="font-weight:800; color:var(--text); font-size:0.9rem; text-transform:uppercase;">MI EQUIPO JUGARÁ COMO:</label>
                <div style="display:flex; background:rgba(0,0,0,0.2); padding:4px; border-radius:10px; border:1px solid var(--glass-border);">
                    <select id="user-team-role" 
                        style="padding:0.5rem 1rem; border-radius:8px; background:var(--bg); border:none; color:var(--text); font-weight:800; font-size:0.85rem; cursor:pointer; text-transform:uppercase;">
                        <option value="home">🔵 LOCAL</option>
                        <option value="away">🔴 VISITANTE</option>
                    </select>
                </div>
            </div>

            <!-- FILA: Modalidad | Sistema | Analizar -->
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; align-items:end;
                        background:rgba(255,255,255,0.02); border:1px solid var(--glass-border); border-radius:12px; padding:1rem; margin-bottom:1.5rem;">
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Modalidad de juego</label>
                    <select id="setup-mode" onchange="updateFormationOptions()" style="width:100%; background:var(--bg); border-color:var(--glass-border); padding:0.5rem; border-radius:8px; color:white;">
                        <option value="f7">Fútbol 7 (2T x 30')</option>
                        <option value="f11">Fútbol 11 (2T x 40')</option>
                    </select>
                </div>
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Sistema táctico inicial</label>
                    <select id="setup-formation" style="width:100%; font-weight:700; background:var(--bg); border-color:var(--glass-border); padding:0.5rem; border-radius:8px; color:white;">
                        <option value="">-- Sin formación --</option>
                    </select>
                </div>
                <div style="display:flex; align-items:center; justify-content:center; gap:10px; padding:0.6rem 0.8rem; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid var(--glass-border); cursor:pointer;" onclick="document.getElementById('setup-analyze-away').click()">
                    <input type="checkbox" id="setup-analyze-away" style="width:20px; height:20px; cursor:pointer;" onclick="event.stopPropagation()">
                    <label for="setup-analyze-away" style="margin:0; cursor:pointer; font-weight:600; font-size:0.85rem; color:var(--text);">ANALIZAR VISITANTE</label>
                </div>
            </div>

            <!-- BOTONES ACCIÓN -->
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
                <div style="display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap;">
                    <button class="btn" onclick="openRosterManager()"
                        style="background:var(--glass);color:var(--primary);font-size:0.82rem; font-weight:700;">
                        GESTIONAR PLANTILLA
                    </button>
                    <button class="btn" onclick="openContactManager()"
                        title="Configurar teléfonos de padres y emails del club"
                        style="background:rgba(255,255,255,0.05); color:var(--secondary); font-size:0.85rem; border:1px solid var(--secondary); font-weight:800; padding:0.6rem 1rem; border-radius:10px;">
                        📱 CONTACTOS
                    </button>
                    <button class="btn" onclick="openConvocationModal()"
                        title="Gestionar convocatoria del partido"
                        style="background:rgba(88,166,255,0.12); color:#58a6ff; font-size:0.85rem; border:1px solid rgba(88,166,255,0.4); font-weight:800; padding:0.6rem 1rem; border-radius:10px;">
                        📋 CONVOCATORIA
                    </button>
                    <button class="btn" onclick="openTrainingPanel()"
                        title="Gestionar entrenamientos"
                        style="background:rgba(63,185,80,0.12); color:#3fb950; font-size:0.85rem; border:1px solid rgba(63,185,80,0.4); font-weight:800; padding:0.6rem 1rem; border-radius:10px;">
                        🏃 ENTRENAMIENTO
                    </button>
                    
                    ${(['admin','superadmin'].includes(window._cronosCurrentUser?.role) && !['user','coach','individual'].includes(window._cronosCurrentUser?._activeRole)) ? `
                    <button onclick="openAdminPanel()"
                        style="background:rgba(255,165,0,0.15); border:1px solid rgba(255,165,0,0.5);
                               color:#ffa500; font-size:0.85rem; padding:0.6rem 1rem;
                               border-radius:10px; cursor:pointer; font-weight:800;">
                        ⚙ ADMIN
                    </button>` : ''}
                    
                    ${window._cronosCurrentUser?.role === 'club_admin' ? `
                    <button onclick="openClubAdminPanel()"
                        style="background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.4);
                               color:var(--primary); font-size:0.85rem; padding:0.6rem 1rem;
                               border-radius:10px; cursor:pointer; font-weight:800;">
                        🏟️ MI CLUB
                    </button>` : ''}
                </div>
                <button class="btn primary" onclick="confirmSetup()" 
                    style="padding:0.8rem 2.2rem; font-size:1.05rem; font-weight:900; letter-spacing:0.5px; box-shadow: 0 6px 20px rgba(88,166,255,0.3); border-radius:12px;">
                    COMENZAR PARTIDO
                </button>
            </div>
        </div>
    `;
    if (typeof populateSavedTeams === 'function') {
        populateSavedTeams('home');
        populateSavedTeams('away');
    }
    if (typeof updateFormationOptions === 'function') {
        updateFormationOptions();
    }
    
    // Restaurar estado previo si existe (para cuando volvemos de gestionar plantilla)
    if (typeof restoreSetupState === 'function') {
        restoreSetupState();
    }
}

function saveSetupState() {
    window._pendingSetupState = {
        homeName:      document.getElementById('setup-home-name')?.value  || '',
        homeColor:     document.getElementById('setup-home-color')?.value || '#58a6ff',
        homeShorts:    document.getElementById('setup-home-shorts')?.value|| '#ffffff',
        homeText:      document.getElementById('setup-home-text')?.value  || '#ffffff',
        awayName:      document.getElementById('setup-away-name')?.value  || '',
        awayColor:     document.getElementById('setup-away-color')?.value || '#ff5858',
        awayShorts:    document.getElementById('setup-away-shorts')?.value|| '#000000',
        awayText:      document.getElementById('setup-away-text')?.value  || '#ffffff',
        mode:          document.getElementById('setup-mode')?.value       || 'f7',
        formation:     document.getElementById('setup-formation')?.value  || '',
        analyzeAway:   document.getElementById('setup-analyze-away')?.checked || false,
    };
}

function restoreSetupState() {
    const s = window._pendingSetupState;
    if (!s) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    set('setup-home-name',    s.homeName);
    set('setup-home-color',   s.homeColor);
    set('setup-home-shorts',  s.homeShorts);
    set('setup-home-text',    s.homeText);
    set('setup-away-name',    s.awayName);
    set('setup-away-color',   s.awayColor);
    set('setup-away-shorts',  s.awayShorts);
    set('setup-away-text',    s.awayText);
    set('setup-mode',         s.mode);
    
    const analyzeEl = document.getElementById('setup-analyze-away');
    if (analyzeEl) analyzeEl.checked = s.analyzeAway;
    
    if (typeof updateFormationOptions === 'function') updateFormationOptions();
    set('setup-formation', s.formation);
    window._pendingSetupState = null; 
}

function confirmSetup() {
    TEAM_NAMES.home = document.getElementById('setup-home-name').value.toUpperCase() || 'LOCAL';
    COLORS.home.primary = document.getElementById('setup-home-color').value;
    COLORS.home.shorts = document.getElementById('setup-home-shorts').value;
    COLORS.home.text = document.getElementById('setup-home-text').value;

    TEAM_NAMES.away = document.getElementById('setup-away-name').value.toUpperCase() || 'VISITANTE';
    COLORS.away.primary = document.getElementById('setup-away-color').value;
    COLORS.away.shorts = document.getElementById('setup-away-shorts').value;
    COLORS.away.text = document.getElementById('setup-away-text').value;

    currentMode = document.getElementById('setup-mode').value;
    analyzeAway = document.getElementById('setup-analyze-away').checked;
    window._userTeamRole = document.getElementById('user-team-role')?.value || 'home';
    selectedFormationOnStart = document.getElementById('setup-formation')?.value || '';

    if (!selectedFormationOnStart) {
        selectedFormationOnStart = currentMode === 'f7' ? '231' : '442';
        document.getElementById('setup-formation').value = selectedFormationOnStart;
    }

    document.getElementById('team-a-name').textContent = TEAM_NAMES.home;
    document.getElementById('team-b-name').textContent = TEAM_NAMES.away;

    if (!analyzeAway) {
        document.body.classList.add('hide-visitor');
    } else {
        document.body.classList.remove('hide-visitor');
    }

    document.body.classList.toggle('mode-f11', currentMode === 'f11');

    const defaultTime = currentMode === 'f7' ? 30 : 40;
    half1MaxTime = defaultTime * 60;
    half2MaxTime = defaultTime * 60;

    // Sincronización final con Firestore antes de empezar
    if (typeof syncMatchData === 'function') syncMatchData();

    openConvocationModal();
}

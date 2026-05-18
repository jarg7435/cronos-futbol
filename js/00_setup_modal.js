// ══════════════════════════════════════════════════════════════════
//  MODAL DE CONFIGURACIÓN DEL PARTIDO (Setup) — v2
//  Cambios v2:
//  [FIX] Categoría se sincroniza SIEMPRE con modalidad.
//        - onchange del select #setup-mode usa syncSetupMode() centralizado
//        - Garantía final tras restoreSetupState
//        - Listener en equipos guardados para re-sincronizar
// ══════════════════════════════════════════════════════════════════

function openSetupModal() {
    document.body.classList.add('setup-mode');
    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:960px; max-width:98vw; padding:1.5rem; border-radius:16px;">
            <!-- Cabecera -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                <div style="display:flex; align-items:center;">
                    <img src="img/logo_cronos.png" style="height:40px; margin-right:12px; filter: drop-shadow(0 0 10px rgba(88,166,255,0.3));" onerror="this.style.display='none'">
                    <span style="font-size:1.4rem; font-weight:900; color:var(--text); letter-spacing:-0.5px;">CRONOS <span style="color:#58a6ff;">FÚTBOL</span></span>
                </div>
                <button onclick="cerrarSesion()" style="background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); color:var(--text-muted); padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem;">Cerrar Sesión</button>
            </div>

            <!-- CUADRICULA SIMÉTRICA DE EQUIPOS (LOCAL / VISITANTE) -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; margin-bottom:1.2rem;">
                
                <!-- COLUMNA LOCAL -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:14px; overflow:hidden; display:flex; flex-direction:column;">
                    <div style="background:linear-gradient(90deg, #1d4ed8, #1e40af); color:white; padding:0.6rem 1rem; display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:0; font-size:0.85rem; font-weight:800; letter-spacing:1px;">LOCAL</h3>
                        <span style="font-size:1.1rem;">🏠</span>
                    </div>
                    <div style="padding:1rem; display:flex; flex-direction:column; gap:0.8rem;">
                        <div>
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Cargar Guardado</label>
                            <div style="display:flex; gap:0.5rem; align-items:center;">
                                <select id="saved-teams-home" onchange="loadTeamFromDropdown('home')" 
                                    style="flex:1; padding:0.5rem; background:rgba(255,255,255,0.07); border:1px solid var(--glass-border); border-radius:8px; color:white;">
                                    <option value="">-- Cargar --</option>
                                </select>
                                <button onclick="saveTeamSetup('home')" title="Guardar Plantilla"
                                    style="background:rgba(63,185,80,0.2); border:1px solid rgba(63,185,80,0.5); color:#3fb950; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">💾</button>
                                <button onclick="deleteTeamFromDropdown('home')" title="Borrar Plantilla"
                                    style="background:rgba(255,88,88,0.15); border:1px solid rgba(255,88,88,0.5); color:#ff5858; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">🗑️</button>
                            </div>
                            <!-- Contenedor lista visual Local -->
                            <div id="saved-teams-list-home" style="margin-top:0.5rem; max-height:100px; overflow-y:auto; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid var(--glass-border);"></div>
                        </div>

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
                    </div>
                </div>

                <!-- COLUMNA VISITANTE -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:14px; overflow:hidden; display:flex; flex-direction:column;">
                    <div style="background:linear-gradient(90deg, #b91c1c, #991b1b); color:white; padding:0.6rem 1rem; display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:0; font-size:0.85rem; font-weight:800; letter-spacing:1px;">VISITANTE</h3>
                        <span style="font-size:1.1rem;">✈️</span>
                    </div>
                    <div style="padding:1rem; display:flex; flex-direction:column; gap:0.8rem;">
                        <div>
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Cargar Guardado</label>
                            <div style="display:flex; gap:0.5rem; align-items:center;">
                                <select id="saved-teams-away" onchange="loadTeamFromDropdown('away')" 
                                    style="flex:1; padding:0.5rem; background:rgba(255,255,255,0.07); border:1px solid var(--glass-border); border-radius:8px; color:white;">
                                    <option value="">-- Cargar --</option>
                                </select>
                                <button onclick="saveTeamSetup('away')" title="Guardar Plantilla"
                                    style="background:rgba(63,185,80,0.2); border:1px solid rgba(63,185,80,0.5); color:#3fb950; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">💾</button>
                                <button onclick="deleteTeamFromDropdown('away')" title="Borrar Plantilla"
                                    style="background:rgba(255,88,88,0.15); border:1px solid rgba(255,88,88,0.5); color:#ff5858; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">🗑️</button>
                            </div>
                            <!-- Contenedor lista visual Visitante -->
                            <div id="saved-teams-list-away" style="margin-top:0.5rem; max-height:100px; overflow-y:auto; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid var(--glass-border);"></div>
                        </div>

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
                    </div>
                </div>

            </div> <!-- FIN DE CUADRICULA SIMÉTRICA -->

            <!-- FILA: Mi equipo | Modalidad | Categoría | Sistema | Analizar -->
            <div style="display:grid; grid-template-columns:auto 1fr 1fr 1.2fr auto; gap:1rem; align-items:end;
                        background:var(--glass); border-radius:10px; padding:0.8rem 1rem; margin-bottom:1rem;">
                <!-- NUEVO: selector de rol del equipo del entrenador -->
                <div style="min-width:120px;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Mi equipo juega de</label>
                    <div style="display:flex; border-radius:8px; overflow:hidden; border:1px solid var(--glass-border);">
                        <button id="role-btn-home"
                            onclick="_setMyTeamRole('home')"
                            style="flex:1; padding:0.45rem 0.5rem; background:rgba(29,78,216,0.35);
                                   border:none; color:white; font-size:0.72rem; font-weight:800;
                                   cursor:pointer; border-right:1px solid var(--glass-border);
                                   transition:background 0.15s;">
                            🏠 LOCAL
                        </button>
                        <button id="role-btn-away"
                            onclick="_setMyTeamRole('away')"
                            style="flex:1; padding:0.45rem 0.5rem; background:rgba(255,255,255,0.04);
                                   border:none; color:var(--text-muted); font-size:0.72rem; font-weight:800;
                                   cursor:pointer; transition:background 0.15s;">
                            ✈️ VISITA
                        </button>
                    </div>
                    <input type="hidden" id="setup-my-team-role" value="home">
                </div>
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Modalidad</label>
                    <select id="setup-mode" onchange="syncSetupMode(this.value)" style="width:100%; background:var(--bg); border-color:var(--glass-border); padding:0.5rem; border-radius:8px; color:white;">
                        <option value="f7">Fútbol 7</option>
                        <option value="f11">Fútbol 11</option>
                    </select>
                </div>
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Categoría</label>
                    <select id="match-category" style="width:100%; background:var(--bg); border-color:var(--glass-border); padding:0.5rem; border-radius:8px; color:white;">
                        <!-- Se llena dinámicamente por syncSetupMode() -->
                    </select>
                </div>
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Sistema táctico inicial</label>
                    <select id="setup-formation" style="width:100%; font-weight:700; background:var(--bg); border-color:var(--glass-border); padding:0.5rem; border-radius:8px; color:white;">
                        <option value="">-- Sin formación predefinida --</option>
                    </select>
                </div>
                <div style="display:flex; align-items:center; gap:8px; padding-bottom:2px;">
                    <input type="checkbox" id="setup-analyze-away" style="width:18px;height:18px;flex-shrink:0;">
                    <label for="setup-analyze-away" style="margin:0;cursor:pointer;white-space:nowrap;color:var(--text);" title="Actívalo para registrar también los datos del equipo contrario">
                        Analizar Contrario
                    </label>
                </div>
            </div>

            <!-- BOTONES DE ACCIÓN (5 EN UNA LÍNEA EXACTA) -->
            <div style="display:flex; flex-direction:column; gap:1.2rem;">
                
                <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:0.5rem; align-items:stretch; width:100%;">
                    <button class="btn" onclick="saveSetupState(); openRosterManager()"
                        style="background:rgba(88,166,255,0.12); color:#58a6ff; font-size:0.7rem; border:1px solid rgba(88,166,255,0.4); font-weight:800; padding:0.6rem 0.2rem; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center;">
                        GESTIONAR PLANTILLA
                    </button>
                    <button class="btn" onclick="saveSetupState(); openContactManager()"
                        title="Configurar teléfonos de padres y emails del club"
                        style="background:rgba(255,165,0,0.12); color:#ffa500; font-size:0.7rem; border:1px solid rgba(255,165,0,0.4); font-weight:800; padding:0.6rem 0.2rem; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center;">
                        📱 CONTACTOS
                    </button>
                    <button class="btn" onclick="openConvocationModal()"
                        title="Gestionar convocatoria del partido"
                        style="background:rgba(63,185,80,0.12); color:#3fb950; font-size:0.7rem; border:1px solid rgba(63,185,80,0.5); font-weight:800; padding:0.6rem 0.2rem; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center;">
                        📋 CONVOCATORIA
                    </button>
                    <button class="btn" onclick="openTrainingPanel()"
                        title="Gestionar entrenamientos"
                        style="background:rgba(88,166,255,0.12); color:#58a6ff; font-size:0.7rem; border:1px solid rgba(88,166,255,0.4); font-weight:800; padding:0.6rem 0.2rem; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center;">
                        🏃 ENTRENAMIENTO
                    </button>
                    <button class="btn" onclick="typeof openMisInformes === 'function' ? openMisInformes() : alert('Módulo en mantenimiento')"
                        title="Mis Informes de Partido"
                        style="background:rgba(255,215,0,0.12); color:#ffd700; font-size:0.7rem; border:1px solid rgba(255,215,0,0.4); font-weight:800; padding:0.6rem 0.2rem; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center;">
                        📊 MIS INFORMES
                    </button>
                </div>

                <!-- Botones Administrativos (si aplican) -->
                ${window._cronosCurrentUser?.role === 'club_admin' ? `
                <div style="display:flex; justify-content:center; gap:0.6rem;">
                    <button onclick="openClubAdminPanel()"
                        style="background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.4);
                               color:var(--primary); font-size:0.85rem; padding:0.6rem 1rem;
                               border-radius:10px; cursor:pointer; font-weight:800;">
                        🏟️ MI CLUB
                    </button>
                </div>` : ''}

                <!-- BOTONES PRINCIPALES: CONTINUAR + RECUPERAR PARTIDO -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.7rem;">
                    <button class="btn primary" onclick="confirmSetup()"
                        style="width:100%; padding:0.9rem; font-size:1rem; font-weight:900;
                               letter-spacing:0.3px; box-shadow:0 6px 20px rgba(88,166,255,0.3);
                               border-radius:10px; background:#58a6ff; color:#0d1117;
                               border:none; cursor:pointer; text-transform:uppercase;">
                        ▶️ CONTINUAR AL PARTIDO
                    </button>
                    <button class="btn" onclick="openLiveMatchRecovery()"
                        title="Recuperar un partido en curso que quedó interrumpido"
                        style="width:100%; padding:0.9rem; font-size:1rem; font-weight:900;
                               letter-spacing:0.3px; border-radius:10px;
                               background:rgba(240,136,62,0.15); color:#f0883e;
                               border:2px solid rgba(240,136,62,0.5); cursor:pointer;
                               text-transform:uppercase;">
                        🔄 RECUPERAR PARTIDO
                    </button>
                </div>
            </div>
        </div>
    `;

    // ── Inicializaciones ──
    if (typeof populateSavedTeams === 'function') {
        populateSavedTeams('home');
        populateSavedTeams('away');
    }

    // Sincronizar categoría y formaciones con la modalidad actual
    const initialMode = document.getElementById('setup-mode')?.value || 'f7';
    if (typeof syncSetupMode === 'function') {
        syncSetupMode(initialMode);
    } else {
        // Fallback si syncSetupMode no está disponible todavía
        if (typeof updateFormationOptions === 'function') updateFormationOptions(initialMode);
        if (typeof updateCategoryOptions === 'function')  updateCategoryOptions(initialMode);
    }
    
    // Restaurar estado previo si existe
    if (typeof restoreSetupState === 'function') {
        restoreSetupState();
    }

    // ── Garantía final: sincronizar categoría con el modo REAL del select ──
    // restoreSetupState puede cambiar el modo sin disparar onchange.
    const finalMode = document.getElementById('setup-mode')?.value || 'f7';
    if (typeof updateCategoryOptions  === 'function') updateCategoryOptions(finalMode);
    if (typeof updateFormationOptions === 'function') updateFormationOptions(finalMode);

    // ── Sincronizar categoría cuando se carga un equipo guardado ──
    // loadTeamFromDropdown() asigna modeEl.value programáticamente,
    // lo que NO dispara el evento onchange del select.
    // Por eso añadimos un listener adicional que sincroniza la categoría
    // 50ms después de que loadTeamFromDropdown haya terminado.
    ['home', 'away'].forEach(function(key) {
        var savedSel = document.getElementById('saved-teams-' + key);
        if (savedSel && !savedSel._cronosCatSync) {
            savedSel._cronosCatSync = true;
            savedSel.addEventListener('change', function() {
                setTimeout(function() {
                    var modeEl = document.getElementById('setup-mode');
                    var mode   = modeEl ? modeEl.value : 'f7';
                    if (typeof updateCategoryOptions  === 'function') updateCategoryOptions(mode);
                    if (typeof updateFormationOptions === 'function') updateFormationOptions(mode);
                    console.log('[Setup] Categoría sincronizada tras cargar equipo. Modo:', mode);
                }, 50);
            });
        }
    });
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
        category:      document.getElementById('match-category')?.value   || '',
        formation:     document.getElementById('setup-formation')?.value  || '',
        analyzeAway:   document.getElementById('setup-analyze-away')?.checked || false,
        myTeamRole:    document.getElementById('setup-my-team-role')?.value || 'home',
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

    // Restaurar selector de rol
    if (s.myTeamRole && typeof _setMyTeamRole === 'function') {
        _setMyTeamRole(s.myTeamRole);
    }
    
    // Actualizar formaciones y categoría según la modalidad restaurada
    if (typeof updateFormationOptions === 'function') updateFormationOptions(s.mode);
    if (typeof updateCategoryOptions === 'function') updateCategoryOptions(s.mode);

    // Restaurar categoría si coincide con la modalidad
    const categoryMatchesMode = s.category && s.category.startsWith(s.mode + '_');
    if (categoryMatchesMode) {
        set('match-category', s.category);
    }
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
    selectedFormationOnStart = document.getElementById('setup-formation')?.value || '';

    // ── Leer rol del equipo del entrenador (LOCAL o VISITANTE) ──
    const myRoleEl = document.getElementById('setup-my-team-role');
    window._userTeamRole = myRoleEl ? (myRoleEl.value || 'home') : 'home';

    // Si mi equipo juega de visitante, activar análisis del contrario automáticamente
    if (window._userTeamRole === 'away') {
        analyzeAway = true;
        const chk = document.getElementById('setup-analyze-away');
        if (chk) chk.checked = true;
    }

    if (!selectedFormationOnStart) {
        selectedFormationOnStart = currentMode === 'f7' ? '231' : '442';
        const formationEl = document.getElementById('setup-formation');
        if (formationEl) formationEl.value = selectedFormationOnStart;
    }

    document.getElementById('team-a-name').textContent = TEAM_NAMES.home;
    document.getElementById('team-b-name').textContent = TEAM_NAMES.away;

    if (!analyzeAway) {
        document.body.classList.add('hide-visitor');
    } else {
        document.body.classList.remove('hide-visitor');
    }

    document.body.classList.toggle('mode-f11', currentMode === 'f11');

    const catEl = document.getElementById('match-category');
    const category = catEl ? catEl.value : 'f7_prebenjamin';
    window._currentMatchCategory = category;
    let defaultTime = 30;

    if (category.includes('infantil') || category.includes('cadete')) {
        defaultTime = 40;
    } else if (category.includes('juvenil') || category.includes('regional')) {
        defaultTime = 45;
    } else if (currentMode === 'f11') {
        defaultTime = 40;
    } else {
        defaultTime = 30;
    }

    half1MaxTime = defaultTime * 60;
    half2MaxTime = defaultTime * 60;

    // ── Actualizar display del cronómetro inmediatamente ──
    (function syncTimerDisplay() {
        var mins = defaultTime;
        var display = (mins < 10 ? '0' : '') + mins + ':00';
        var t1 = document.getElementById('timer-h1');
        var t2 = document.getElementById('timer-h2');
        if (t1) t1.textContent = display;
        if (t2) t2.textContent = display;
        console.log('[Setup] Cronómetros actualizados a ' + display + ' (' + currentMode + ' / ' + category + ')');
    })();

    openConvocationModal();
}

// ── Cambiar rol visual del equipo del entrenador ──
function _setMyTeamRole(role) {
    const hiddenEl = document.getElementById('setup-my-team-role');
    if (hiddenEl) hiddenEl.value = role;

    const btnHome = document.getElementById('role-btn-home');
    const btnAway = document.getElementById('role-btn-away');

    if (role === 'home') {
        if (btnHome) { btnHome.style.background = 'rgba(29,78,216,0.55)'; btnHome.style.color = 'white'; }
        if (btnAway) { btnAway.style.background = 'rgba(255,255,255,0.04)'; btnAway.style.color = 'var(--text-muted)'; }
    } else {
        if (btnAway) { btnAway.style.background = 'rgba(185,28,28,0.45)'; btnAway.style.color = 'white'; }
        if (btnHome) { btnHome.style.background = 'rgba(255,255,255,0.04)'; btnHome.style.color = 'var(--text-muted)'; }
    }

    // Guardar en _pendingSetupState para persistencia
    if (!window._pendingSetupState) window._pendingSetupState = {};
    window._pendingSetupState.myTeamRole = role;
}

// ════════════════════════════════════════════════════════════════════
//  RECUPERAR PARTIDO EN CURSO
//  Consulta live_matches en Firestore filtrando por coachUid actual
//  y status === 'active'. Muestra un panel para retomar el partido.
// ════════════════════════════════════════════════════════════════════
async function openLiveMatchRecovery() {
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!me || !fa || !fa.db) {
        if (typeof showToast === 'function') showToast('⚠️ Debes estar autenticado para recuperar un partido', 3000);
        return;
    }

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,620px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;">

        <!-- Cabecera -->
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:1rem;flex-shrink:0;">
            <h2 style="margin:0;font-size:1.1rem;">🔄 Recuperar Partido en Curso</h2>
            <button onclick="openSetupModal()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.4rem;cursor:pointer;">✕</button>
        </div>

        <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 1rem;flex-shrink:0;">
            Aquí aparecen los partidos que iniciaste y no finalizaste correctamente.
            Pulsa <strong style="color:#f0883e;">Retomar</strong> para volver al partido en el punto en que lo dejaste.
        </p>

        <div id="live-recovery-list"
             style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:0.6rem;">
            <div style="text-align:center;color:var(--text-muted);padding:2rem;">⏳ Buscando partidos…</div>
        </div>

        <div style="margin-top:1rem;padding-top:0.8rem;border-top:1px solid var(--glass-border);flex-shrink:0;">
            <button onclick="openSetupModal()" class="btn"
                style="color:var(--text-muted);width:100%;">← Volver al menú</button>
        </div>
    </div>`;

    // Cargar partidos activos desde Firestore
    try {
        const { collection, getDocs, query, where, orderBy } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const q = query(
            collection(fa.db, 'live_matches'),
            where('createdBy', '==', me.uid),
            where('status', '==', 'active')
        );

        const snap = await getDocs(q);
        const list = document.getElementById('live-recovery-list');
        if (!list) return;

        if (snap.empty) {
            list.innerHTML = `
            <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:0.8rem;">✅</div>
                <div style="font-size:0.9rem;font-weight:600;">No hay partidos en curso</div>
                <div style="font-size:0.78rem;margin-top:0.4rem;">
                    Todos tus partidos han sido finalizados correctamente.
                </div>
            </div>`;
            return;
        }
        // Filtrar caducados y ordenar por updatedAt descendente
        const docs = [];
        const now = Date.now();
        const maxAgeMs = 120 * 60 * 1000; // 120 minutos en milisegundos

        snap.forEach(d => {
            const data = d.data();
            let isExpired = false;

            // Verificar caducidad si existe createdAt (ISO string)
            if (data.createdAt) {
                const createdTime = new Date(data.createdAt).getTime();
                if (!isNaN(createdTime) && (now - createdTime > maxAgeMs)) {
                    isExpired = true;
                }
            }

            if (isExpired) {
                // Borrar silenciosamente los caducados en segundo plano
                _doDeleteLiveMatch(d.id, null, true);
            } else {
                docs.push({ _id: d.id, ...data });
            }
        });

        docs.sort((a, b) => {
            const ta = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
            const tb = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
            return tb - ta;
        });

        if (docs.length === 0) {
            list.innerHTML = `
            <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:0.8rem;">✅</div>
                <div style="font-size:0.9rem;font-weight:600;">No hay partidos en curso</div>
                <div style="font-size:0.78rem;margin-top:0.4rem;">
                    Todos tus partidos han sido finalizados correctamente.
                </div>
            </div>`;
            return;
        }

        list.innerHTML = docs.map(m => {
            const updTs = m.updatedAt?.toMillis ? m.updatedAt.toMillis() : 0;
            const updStr = updTs
                ? new Date(updTs).toLocaleString('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
                : '—';
            const scoreH = m.homeTeam?.score ?? 0;
            const scoreA = m.awayTeam?.score ?? 0;
            const homeName = m.homeTeam?.name || 'LOCAL';
            const awayName = m.awayTeam?.name || 'VISITANTE';
            const phase = m.phase === '2nd_half' ? '2ª Parte' : '1ª Parte';
            const minsH1 = Math.floor((m.timeH1 || 0) / 60).toString().padStart(2,'0');
            const secsH1 = ((m.timeH1 || 0) % 60).toString().padStart(2,'0');
            const minsH2 = Math.floor((m.timeH2 || 0) / 60).toString().padStart(2,'0');
            const secsH2 = ((m.timeH2 || 0) % 60).toString().padStart(2,'0');
            const timeStr = m.phase === '2nd_half' ? `${minsH2}:${secsH2}` : `${minsH1}:${secsH1}`;
            const playerCount = Array.isArray(m.players) ? m.players.length : 0;
            const modeLabel = m.mode === 'f11' ? 'F-11' : 'F-7';
            const safeId = typeof escapeAttr === 'function' ? escapeAttr(m._id) : m._id.replace(/'/g, '');

            return `
            <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.3);
                        border-radius:12px;padding:0.9rem 1rem;display:flex;flex-direction:column;gap:0.5rem;">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:800;font-size:1rem;color:var(--text);">
                            ${typeof escapeHtml==='function'?escapeHtml(homeName):homeName}
                            <span style="color:#f0883e;margin:0 0.3rem;">${scoreH} – ${scoreA}</span>
                            ${typeof escapeHtml==='function'?escapeHtml(awayName):awayName}
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;display:flex;flex-wrap:wrap;gap:0.3rem 0.8rem;">
                            <span>⏱ ${phase} · ${timeStr}</span>
                            <span>🏆 ${modeLabel}</span>
                            <span>👥 ${playerCount} jugadores</span>
                            <span>🕐 ${updStr}</span>
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.4rem;flex-shrink:0;">
                        <button onclick="_doResumeMatch('${safeId}')"
                            style="padding:0.45rem 1rem;background:#f0883e;border:none;
                                   border-radius:8px;color:#0a0e14;font-weight:800;
                                   font-size:0.82rem;cursor:pointer;">
                            ▶ Retomar
                        </button>
                        <button onclick="_doDeleteLiveMatch('${safeId}', this)"
                            style="padding:0.35rem 0.7rem;background:rgba(255,88,88,0.12);
                                   border:1px solid rgba(255,88,88,0.35);
                                   border-radius:8px;color:#ff5858;font-weight:700;
                                   font-size:0.72rem;cursor:pointer;">
                            🗑 Eliminar
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');

    } catch (err) {
        const list = document.getElementById('live-recovery-list');
        if (list) list.innerHTML = `<div style="color:#ff5858;text-align:center;padding:2rem;">⚠️ Error al cargar: ${err.message}</div>`;
        console.error('[Recovery] Error cargando live_matches:', err);
    }
}

// ── Retomar un partido desde su snapshot de Firestore ──────────────────
async function _doResumeMatch(matchId) {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) return;

    if (typeof showSpinner === 'function') showSpinner('Cargando partido…');

    try {
        const { doc, getDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const snap = await getDoc(doc(fa.db, 'live_matches', matchId));
        if (!snap.exists()) {
            if (typeof hideSpinner === 'function') hideSpinner();
            if (typeof showToast === 'function') showToast('⚠️ El partido ya no existe en la nube', 3000);
            return;
        }

        const m = snap.data();

        // ── No sumamos tiempo transcurrido real porque el tiempo del fútbol se para ──
        const deltaSecs = 0;

        // ── Restaurar configuración global del partido ──
        if (m.mode)  { currentMode = m.mode; }
        if (m.phase) { matchPhase  = m.phase; }
        liveMatchId  = matchId;
        liveIsActive = true;
        
        masterTimeH1 = (m.timeH1 || 0);
        masterTimeH2 = (m.timeH2 || 0);

        // Restaurar categoría y tiempos límites correspondientes
        if (m.category) {
            window._currentMatchCategory = m.category;
            const catSelect = document.getElementById('match-category');
            if (catSelect) catSelect.value = m.category;

            let defaultTime = 30;
            if (m.category.includes('infantil') || m.category.includes('cadete')) {
                defaultTime = 40;
            } else if (m.category.includes('juvenil') || m.category.includes('regional')) {
                defaultTime = 45;
            } else if (currentMode === 'f11') {
                defaultTime = 40;
            } else {
                defaultTime = 30;
            }
            half1MaxTime = defaultTime * 60;
            half2MaxTime = defaultTime * 60;
        } else {
            half1MaxTime = m.half1MaxTime || 1800;
            half2MaxTime = m.half2MaxTime || 1800;
        }

        // Equipos
        if (m.homeTeam) {
            TEAM_NAMES.home      = m.homeTeam.name      || 'LOCAL';
            COLORS.home.primary  = m.homeTeam.color     || '#58a6ff';
            COLORS.home.shorts   = m.homeTeam.shorts    || '#ffffff';
            COLORS.home.text     = m.homeTeam.textColor || '#000000';
        }
        if (m.awayTeam) {
            TEAM_NAMES.away      = m.awayTeam.name      || 'VISITANTE';
            COLORS.away.primary  = m.awayTeam.color     || '#ff5858';
            COLORS.away.shorts   = m.awayTeam.shorts    || '#000000';
            COLORS.away.text     = m.awayTeam.textColor || '#ffffff';
        }

        // Formación
        if (m.formation) { activeFormationKey = m.formation; }

        // Modo analizar visitante
        analyzeAway = !!(m.awayTeam && m.mode);

        // ── Restaurar jugadores ──
        if (Array.isArray(m.players) && m.players.length > 0) {
            players = m.players.map(p => ({
                id:        p.id,
                number:    p.number,
                name:      p.name,
                team:      p.team,
                status:    p.status    || 'bench',
                time:      (p.time || 0) + ((p.status === 'field' || (!p.status && 'bench' === 'field')) ? deltaSecs : 0),
                goals:     p.goals     || 0,
                cards:     p.cards     || 'ninguna',
                yellowCards: p.yellowCards || 0,
                injured:   p.injured   || false,
                x:         p.x        || 50,
                y:         p.y        || 50,
                history:   p.history   || [],
                convocado: p.convocado || false,
                color:     p.color     || (p.team === 'home' ? COLORS.home.primary : COLORS.away.primary),
                shortsColor: p.shortsColor || (p.team === 'home' ? COLORS.home.shorts : COLORS.away.shorts),
                textColor: p.textColor || (p.team === 'home' ? COLORS.home.text : COLORS.away.text),
                benchOrder: p.benchOrder || 0,
            }));
        }

        // ── Restaurar marcador en UI ──
        const homeScore = (m.homeTeam?.score ?? 0).toString();
        const awayScore = (m.awayTeam?.score ?? 0).toString();
        const scoreHomeEl = document.getElementById('score-home');
        const scoreAwayEl = document.getElementById('score-away');
        if (scoreHomeEl) scoreHomeEl.textContent = homeScore;
        if (scoreAwayEl) scoreAwayEl.textContent = awayScore;

        // ── Restaurar nombres de equipos en UI ──
        const teamAEl = document.getElementById('team-a-name');
        const teamBEl = document.getElementById('team-b-name');
        if (teamAEl) teamAEl.textContent = TEAM_NAMES.home;
        if (teamBEl) teamBEl.textContent = TEAM_NAMES.away;

        // ── Ajustar clases de modalidad ──
        document.body.classList.toggle('mode-f11', currentMode === 'f11');
        if (!analyzeAway) {
            document.body.classList.add('hide-visitor');
        } else {
            document.body.classList.remove('hide-visitor');
        }

        // ── Cerrar modal y mostrar campo ──
        const modal = document.getElementById('setup-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('setup-mode');

        // ── Renderizar jugadores ──
        if (typeof renderPlayers === 'function') renderPlayers();

        // ── Restaurar cronómetros ──
        const timerH1El = document.getElementById('timer-h1');
        const timerH2El = document.getElementById('timer-h2');
        const fmtTime = (s) => {
            const m = Math.floor(s/60).toString().padStart(2,'0');
            const sec = (s % 60).toString().padStart(2,'0');
            return `${m}:${sec}`;
        };
        if (timerH1El) timerH1El.textContent = fmtTime(masterTimeH1);
        if (timerH2El) timerH2El.textContent = fmtTime(masterTimeH2);

        // ── Reiniciar el timer de sincronización en vivo y cronómetro principal ──
        if (typeof liveSyncTimer !== 'undefined' && liveSyncTimer) {
            clearInterval(liveSyncTimer);
        }
        
        // Arrancar cronómetro y sync si el partido estaba en curso
        if (m.isRunning) {
            if (typeof isRunning !== 'undefined') {
                isRunning = false; // Forzamos false para que toggleGame() lo pase a true y arranque el intervalo
            }
            if (typeof toggleGame === 'function') toggleGame();
            
            if (typeof pushLiveSnapshot === 'function') {
                liveSyncTimer = setInterval(() => {
                    if (liveIsActive && isRunning) pushLiveSnapshot('active');
                }, 5000);
            }
        } else {
            if (typeof isRunning !== 'undefined') {
                isRunning = false; // Asegurarse de que esté pausado visual y lógicamente
            }
            const btn = document.getElementById('btn-play-pause');
            if (btn) {
                btn.textContent = 'REANUDAR';
                btn.classList.remove('danger');
            }
            if (typeof timerInterval !== 'undefined') clearInterval(timerInterval);
        }

        if (typeof updateLiveButton === 'function') updateLiveButton(true);
        if (typeof hideSpinner === 'function') hideSpinner();
        if (typeof showToast === 'function') showToast('✅ Partido recuperado correctamente', 3500);

        console.log('[Recovery] Partido restaurado:', matchId);

    } catch (err) {
        if (typeof hideSpinner === 'function') hideSpinner();
        if (typeof showToast === 'function') showToast('⚠️ Error al recuperar partido: ' + err.message, 4000);
        console.error('[Recovery] Error:', err);
    }
}

// ── Eliminar un partido en curso desde el panel de recuperación ─────────
async function _doDeleteLiveMatch(matchId, btn, isSilent = false) {
    if (!isSilent) {
        if (!confirm('¿Eliminar este partido en curso? Se borrará de la nube y no podrás recuperarlo.')) return;
    }
    const fa = window._cronos_auth;
    if (!fa || !fa.db) return;

    try {
        const { doc, deleteDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await deleteDoc(doc(fa.db, 'live_matches', matchId));

        if (isSilent) return; // No UI updates if silent

        // Quitar tarjeta de la UI
        const card = btn?.closest('div[style]');
        if (card) card.remove();

        if (typeof showToast === 'function') showToast('🗑 Partido eliminado', 2500);

        // Si la lista queda vacía, mostrar mensaje
        const list = document.getElementById('live-recovery-list');
        if (list && list.children.length === 0) {
            list.innerHTML = `
            <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:0.8rem;">✅</div>
                <div style="font-size:0.9rem;font-weight:600;">No hay más partidos en curso</div>
            </div>`;
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('⚠️ Error al eliminar: ' + err.message, 3000);
        console.error('[Recovery] Error eliminando:', err);
    }
}

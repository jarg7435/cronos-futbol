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
                    <button class="btn" onclick="saveSetupState(); Promise.resolve(openContactManager()).catch(function(e){ console.error('[Contactos] Error al abrir:', e); if(typeof hideSpinner==='function') hideSpinner(); if(typeof showToast==='function') showToast('⚠️ No se pudo abrir Contactos', 3000); });"
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

    if (category.includes('prebenjamin')) {
        defaultTime = 30;
    } else if (category.includes('benjamin') || category.includes('alevin')) {
        defaultTime = 35;
    } else if (category.includes('infantil') || category.includes('cadete')) {
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

    // 1. Obtener y validar partido local en localStorage
    const localRaw = localStorage.getItem('cronos_active_match_v2');
    let localMatch = null;
    const now = Date.now();

    if (localRaw) {
        try {
            const parsed = JSON.parse(localRaw);
            if (parsed && parsed.savedAt && parsed.matchPhase !== 'finished') {
                const mode = parsed.currentMode || 'f7';
                const cat = (parsed.category || '').toLowerCase();
                let limitMins = 80; // Fútbol 7 por defecto: 80 min

                if (mode === 'f11') {
                    if (cat.includes('juvenil') || cat.includes('regional') || cat.includes('senior') || cat.includes('aficionado') || cat.includes('preferente') || cat.includes('primera') || cat.includes('segunda')) {
                        limitMins = 120; // 120 min
                    } else if (cat.includes('cadete') || cat.includes('infantil')) {
                        limitMins = 110; // 110 min
                    } else {
                        limitMins = 120; // Default F-11: 120 min
                    }
                } else {
                    limitMins = 80; // F-7 / F-8: 80 min
                }

                const startTimestamp = parsed.createdAt ? new Date(parsed.createdAt).getTime() : new Date(parsed.savedAt).getTime();
                const elapsedSec = (now - startTimestamp) / 1000;
                const LIMIT_SEC = limitMins * 60;

                if (elapsedSec <= LIMIT_SEC) {
                    localMatch = {
                        _id: 'local_active',
                        isLocal: true,
                        liveMatchId: parsed.liveMatchId,
                        savedAt: parsed.savedAt,
                        createdAt: parsed.createdAt,
                        homeTeam: { name: parsed.teamNames?.home || 'LOCAL', score: parseInt(parsed.scoreHome) || 0 },
                        awayTeam: { name: parsed.teamNames?.away || 'VISITANTE', score: parseInt(parsed.scoreAway) || 0 },
                        mode: parsed.currentMode,
                        phase: parsed.matchPhase,
                        timeH1: parsed.masterTimeH1,
                        timeH2: parsed.masterTimeH2,
                        playerCount: Array.isArray(parsed.players) ? parsed.players.length : 0,
                        category: parsed.category || ''
                    };
                } else {
                    // Expiró localmente
                    localStorage.removeItem('cronos_active_match_v2');
                }
            }
        } catch (e) {
            console.warn('[Recovery] Error al analizar partido local:', e);
        }
    }

    // 2. Cargar partidos activos desde Firestore y combinarlos con el local
    try {
        const { collection, getDocs, query, where } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const q = query(
            collection(fa.db, 'live_matches'),
            where('createdBy', '==', me.uid),
            where('status', '==', 'active')
        );

        const snap = await getDocs(q);
        const list = document.getElementById('live-recovery-list');
        if (!list) return;

        const allDocs = [];
        if (localMatch) {
            allDocs.push(localMatch);
        }

        snap.forEach(d => {
            const data = d.data();
            let isExpired = false;

            // Calcular límite dinámico según modalidad y categoría
            const mode = data.mode || 'f7';
            const cat = (data.category || '').toLowerCase();
            let limitMins = 80;

            if (mode === 'f11') {
                if (cat.includes('juvenil') || cat.includes('regional') || cat.includes('senior') || cat.includes('aficionado') || cat.includes('preferente') || cat.includes('primera') || cat.includes('segunda')) {
                    limitMins = 120;
                } else if (cat.includes('cadete') || cat.includes('infantil')) {
                    limitMins = 110;
                } else {
                    limitMins = 120;
                }
            } else {
                limitMins = 80;
            }

            const docMaxAgeMs = limitMins * 60 * 1000;

            if (data.createdAt) {
                const createdTime = new Date(data.createdAt).getTime();
                if (!isNaN(createdTime) && (now - createdTime > docMaxAgeMs)) {
                    isExpired = true;
                }
            }

            if (isExpired) {
                _doDeleteLiveMatch(d.id, null, true);
            } else {
                // Evitar duplicar en la lista si ya mostramos la versión local (más reciente)
                const isSameId = localMatch && localMatch.liveMatchId === d.id;
                if (!isSameId) {
                    allDocs.push({ _id: d.id, ...data });
                }
            }
        });

        // Ordenar por actualización descendente
        allDocs.sort((a, b) => {
            const ta = a.isLocal ? new Date(a.savedAt).getTime() : (a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0);
            const tb = b.isLocal ? new Date(b.savedAt).getTime() : (b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0);
            return tb - ta;
        });

        if (allDocs.length === 0) {
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

        list.innerHTML = allDocs.map(m => {
            const updTs = m.isLocal ? new Date(m.savedAt).getTime() : (m.updatedAt?.toMillis ? m.updatedAt.toMillis() : 0);
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
            const playerCount = m.playerCount || 0;
            const modeLabel = m.mode === 'f11' ? 'F-11' : 'F-7';

            let clickResume, clickDelete;
            if (m.isLocal) {
                clickResume = `_doResumeLocalMatch()`;
                clickDelete = `_doDeleteLocalMatch()`;
            } else {
                const safeId = typeof escapeAttr === 'function' ? escapeAttr(m._id) : m._id.replace(/'/g, '');
                clickResume = `_doResumeMatch('${safeId}')`;
                clickDelete = `_doDeleteLiveMatch('${safeId}', this)`;
            }

            const localTag = m.isLocal
                ? `<span style="background:#58a6ff;color:#0a0e14;font-size:0.68rem;padding:2px 6px;border-radius:4px;font-weight:900;margin-left:0.5rem;vertical-align:middle;">DISPOSITIVO LOCAL</span>`
                : `<span style="background:rgba(240,136,62,0.2);color:#f0883e;font-size:0.68rem;padding:2px 6px;border-radius:4px;font-weight:900;margin-left:0.5rem;vertical-align:middle;">NUBE</span>`;

            return `
            <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.3);
                        border-radius:12px;padding:0.9rem 1rem;display:flex;flex-direction:column;gap:0.5rem;">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:800;font-size:1rem;color:var(--text);">
                            ${typeof escapeHtml==='function'?escapeHtml(homeName):homeName}
                            <span style="color:#f0883e;margin:0 0.3rem;">${scoreH} – ${scoreA}</span>
                            ${typeof escapeHtml==='function'?escapeHtml(awayName):awayName}
                            ${localTag}
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;display:flex;flex-wrap:wrap;gap:0.3rem 0.8rem;">
                            <span>⏱ ${phase} · ${timeStr}</span>
                            <span>🏆 ${modeLabel}</span>
                            <span>👥 ${playerCount} jugadores</span>
                            <span>🕐 ${updStr}</span>
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.4rem;flex-shrink:0;">
                        <button onclick="${clickResume}"
                            style="padding:0.45rem 1rem;background:#f0883e;border:none;
                                   border-radius:8px;color:#0a0e14;font-weight:800;
                                   font-size:0.82rem;cursor:pointer;">
                            ▶ Retomar
                        </button>
                        <button onclick="${clickDelete}"
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
        if (list && localMatch) {
            // Caso sin conexión: mostrar el local al menos
            const updTs = new Date(localMatch.savedAt).getTime();
            const updStr = updTs
                ? new Date(updTs).toLocaleString('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
                : '—';
            const scoreH = localMatch.homeTeam?.score ?? 0;
            const scoreA = localMatch.awayTeam?.score ?? 0;
            const homeName = localMatch.homeTeam?.name || 'LOCAL';
            const awayName = localMatch.awayTeam?.name || 'VISITANTE';
            const phase = localMatch.phase === '2nd_half' ? '2ª Parte' : '1ª Parte';
            const minsH1 = Math.floor((localMatch.timeH1 || 0) / 60).toString().padStart(2,'0');
            const secsH1 = ((localMatch.timeH1 || 0) % 60).toString().padStart(2,'0');
            const minsH2 = Math.floor((localMatch.timeH2 || 0) / 60).toString().padStart(2,'0');
            const secsH2 = ((localMatch.timeH2 || 0) % 60).toString().padStart(2,'0');
            const timeStr = localMatch.phase === '2nd_half' ? `${minsH2}:${secsH2}` : `${minsH1}:${secsH1}`;
            const playerCount = localMatch.playerCount || 0;
            const modeLabel = localMatch.mode === 'f11' ? 'F-11' : 'F-7';

            list.innerHTML = `
            <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.3);
                        border-radius:12px;padding:0.9rem 1rem;display:flex;flex-direction:column;gap:0.5rem;">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:800;font-size:1rem;color:var(--text);">
                            ${typeof escapeHtml==='function'?escapeHtml(homeName):homeName}
                            <span style="color:#f0883e;margin:0 0.3rem;">${scoreH} – ${scoreA}</span>
                            ${typeof escapeHtml==='function'?escapeHtml(awayName):awayName}
                            <span style="background:#58a6ff;color:#0a0e14;font-size:0.68rem;padding:2px 6px;border-radius:4px;font-weight:900;margin-left:0.5rem;vertical-align:middle;">LOCAL (SIN CONEXIÓN)</span>
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;display:flex;flex-wrap:wrap;gap:0.3rem 0.8rem;">
                            <span>⏱ ${phase} · ${timeStr}</span>
                            <span>🏆 ${modeLabel}</span>
                            <span>👥 ${playerCount} jugadores</span>
                            <span>🕐 ${updStr}</span>
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.4rem;flex-shrink:0;">
                        <button onclick="_doResumeLocalMatch()"
                            style="padding:0.45rem 1rem;background:#f0883e;border:none;
                                   border-radius:8px;color:#0a0e14;font-weight:800;
                                   font-size:0.82rem;cursor:pointer;">
                            ▶ Retomar
                        </button>
                        <button onclick="_doDeleteLocalMatch()"
                            style="padding:0.35rem 0.7rem;background:rgba(255,88,88,0.12);
                                   border:1px solid rgba(255,88,88,0.35);
                                   border-radius:8px;color:#ff5858;font-weight:700;
                                   font-size:0.72rem;cursor:pointer;">
                            🗑 Eliminar
                        </button>
                    </div>
                </div>
            </div>`;
        } else {
            if (list) list.innerHTML = `<div style="color:#ff5858;text-align:center;padding:2rem;">⚠️ Error al cargar: ${err.message}</div>`;
        }
        console.error('[Recovery] Error cargando live_matches:', err);
    }
}

// ── Retomar un partido local ───────────────────────────────────────────
function _doResumeLocalMatch() {
    if (typeof window._restoreActiveMatch === 'function') {
        window._restoreActiveMatch();
    }
}
window._doResumeLocalMatch = _doResumeLocalMatch;
// ── Eliminar un partido local ──────────────────────────────────────────
function _doDeleteLocalMatch() {
    if (!confirm('¿Eliminar este partido local en curso? Se perderá definitivamente.')) return;
    localStorage.removeItem('cronos_active_match_v2');
    document.getElementById('cronos-restore-banner')?.remove();
    if (typeof showToast === 'function') showToast('🗑 Partido local eliminado', 3000);
    openLiveMatchRecovery();
}
window._doDeleteLocalMatch = _doDeleteLocalMatch;

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

        // ── Calcular tiempo transcurrido ──
        // PRIORIDAD: si el snapshot trae phaseStartedAt (modo autónomo), derivar el
        // tiempo real exacto desde el reloj absoluto, igual que ve el espectador en vivo.
        // Fallback (snapshots antiguos): m.savedAt/updatedAt + delta solo si isRunning.
        let autonomousElapsedSec = null;
        if (typeof m.phaseStartedAt === 'number' && m.phaseStartedAt > 0) {
            autonomousElapsedSec = Math.max(0, Math.floor((Date.now() - m.phaseStartedAt) / 1000));
        }
        let savedTimeMs = 0;
        if (m.savedAt) {
            savedTimeMs = new Date(m.savedAt).getTime();
        } else if (m.updatedAt) {
            if (typeof m.updatedAt.toMillis === 'function') {
                savedTimeMs = m.updatedAt.toMillis();
            } else if (typeof m.updatedAt.toDate === 'function') {
                savedTimeMs = m.updatedAt.toDate().getTime();
            } else {
                savedTimeMs = new Date(m.updatedAt).getTime();
            }
        }
        let deltaSecs = 0;
        if (autonomousElapsedSec === null && m.isRunning && savedTimeMs > 0) {
            deltaSecs = Math.max(0, Math.floor((Date.now() - savedTimeMs) / 1000));
        }

        // ── Restaurar configuración global del partido ──
        if (m.mode)  { currentMode = m.mode; }
        if (m.phase) { matchPhase  = m.phase; }
        liveMatchId  = matchId;
        liveIsActive = true;

        // Restaurar categoría y tiempos límites correspondientes
        if (m.category) {
            window._currentMatchCategory = m.category;
            const catSelect = document.getElementById('match-category');
            if (catSelect) catSelect.value = m.category;
        }
        // FIX: Siempre usar los tiempos del snapshot (no recalcular desde categoría).
        // La categoría puede dar valores erróneos si el partido usó tiempos personalizados.
        half1MaxTime = m.half1MaxTime || 1800;
        half2MaxTime = m.half2MaxTime || 1800;

        let activeAddedSec = 0;
        let shouldAutoEndFirstHalf = false;
        let shouldAutoEndMatch = false;
        const maxAddedSecs = (currentMode === 'f11') ? 900 : 600; // 15 min F11, 10 min F7

        if (autonomousElapsedSec !== null) {
            // Modo AUTÓNOMO: el tiempo real de la parte activa es el derivado desde
            // phaseStartedAt, capado a (reglamentario + añadido). activeAddedSec es la
            // diferencia respecto al valor guardado, para sumarla a los jugadores en campo.
            if (matchPhase === '1st_half') {
                const limit1 = half1MaxTime + maxAddedSecs;
                const realTime = Math.min(autonomousElapsedSec, limit1);
                activeAddedSec = Math.max(0, realTime - (m.timeH1 || 0));
                if (autonomousElapsedSec >= limit1) shouldAutoEndFirstHalf = true;
            } else if (matchPhase === '2nd_half') {
                const limit2 = half2MaxTime + maxAddedSecs;
                const realTime = Math.min(autonomousElapsedSec, limit2);
                activeAddedSec = Math.max(0, realTime - (m.timeH2 || 0));
                if (autonomousElapsedSec >= limit2) shouldAutoEndMatch = true;
            }
        } else if (deltaSecs > 0) {
            // Fallback (snapshots antiguos sin phaseStartedAt)
            if (matchPhase === '1st_half') {
                const limit1 = half1MaxTime + maxAddedSecs; // Reglamentario + añadido
                const remaining = Math.max(0, limit1 - (m.timeH1 || 0));
                activeAddedSec = Math.min(deltaSecs, remaining);
                if (deltaSecs >= remaining) {
                    shouldAutoEndFirstHalf = true;
                }
            } else if (matchPhase === '2nd_half') {
                const limit2 = half2MaxTime + maxAddedSecs;
                const remaining = Math.max(0, limit2 - (m.timeH2 || 0));
                activeAddedSec = Math.min(deltaSecs, remaining);
                if (deltaSecs >= remaining) {
                    shouldAutoEndMatch = true;
                }
            }
        }

        // Restaurar cronómetros sumando el tiempo transcurrido
        masterTimeH1 = (m.timeH1 || 0);
        masterTimeH2 = (m.timeH2 || 0);

        if (activeAddedSec > 0) {
            if (matchPhase === '1st_half') {
                masterTimeH1 += activeAddedSec;
            } else if (matchPhase === '2nd_half') {
                masterTimeH2 += activeAddedSec;
            }
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
                time:      (p.time || 0) + ((activeAddedSec > 0 && (p.status === 'field' || (!p.status && 'bench' === 'field'))) ? activeAddedSec : 0),
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

        // ── FIX: Detectar si otro dispositivo está sincronizando activamente ──
        // Si el snapshot se actualizó hace < 8 segundos con otro deviceId, este dispositivo
        // actúa en modo LECTURA (no escribe) para no sobrescribir el estado del dispositivo principal.
        const remoteDeviceId  = m.syncDeviceId || null;
        const myDeviceId      = window._cronosSyncDeviceId || null;
        const lastSavedMs     = m.savedAt ? new Date(m.savedAt).getTime() : 0;
        const secSinceLastSync = lastSavedMs > 0 ? (Date.now() - lastSavedMs) / 1000 : 999;
        const anotherDeviceActive = remoteDeviceId && myDeviceId && 
                                    remoteDeviceId !== myDeviceId && 
                                    secSinceLastSync < 8;

        if (anotherDeviceActive) {
            // Otro dispositivo está controlando el partido: solo lectura aquí
            if (typeof showToast === 'function') {
                showToast('👁 Otro dispositivo está controlando el partido. Este dispositivo solo visualiza.', 6000);
            }
            console.warn('[Recovery] Modo lectura: otro dispositivo activo (deviceId:', remoteDeviceId, ', hace', Math.round(secSinceLastSync), 's)');
            liveIsActive = false;  // No escribir desde este dispositivo
        }

        if (shouldAutoEndFirstHalf) {
            if (typeof window.endFirstHalf === 'function') {
                window.endFirstHalf(true);
            }
        } else if (shouldAutoEndMatch) {
            if (typeof window.endMatch === 'function') {
                window.endMatch(true);
            }
        } else {
            // ── Decidir si el partido debe continuar en marcha ──
            // AUTÓNOMO: si la fase es de juego y el snapshot trae phaseStartedAt
            // (no null), el partido estaba corriendo → continuar SIEMPRE en marcha,
            // sincronizado con el tiempo real ya derivado. No hay que pulsar nada.
            // Fallback: respetar m.isRunning para snapshots antiguos.
            const inPlayPhase = (matchPhase === '1st_half' || matchPhase === '2nd_half');
            const shouldRunAutonomous = (autonomousElapsedSec !== null) && inPlayPhase;
            const shouldRun = shouldRunAutonomous || m.isRunning;

            if (shouldRun) {
                if (typeof isRunning !== 'undefined') {
                    isRunning = false; // Forzamos false para que toggleGame() lo pase a true y arranque el intervalo
                }
                if (typeof toggleGame === 'function') toggleGame();
                
                // Solo activar sincronización de escritura si este dispositivo es el controlador
                if (!anotherDeviceActive && typeof pushLiveSnapshot === 'function') {
                    liveSyncTimer = setInterval(() => {
                        if (liveIsActive && isRunning) pushLiveSnapshot('active');
                    }, 1000);
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
        }

        if (typeof updateLiveButton === 'function') updateLiveButton(true);
        if (typeof hideSpinner === 'function') hideSpinner();

        // Guardar el estado local de inmediato tras recuperarlo de la nube
        if (typeof window._saveMatchStateToStorage === 'function') {
            window._saveMatchStateToStorage();
        }

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

        // ALSO clean local storage so it doesn't try to recover it locally!
        localStorage.removeItem('cronos_active_match_v2');

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

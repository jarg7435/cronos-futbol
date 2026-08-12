// ══════════════════════════════════════════════════════════════════
//  MODAL DE CONFIGURACIÓN DEL PARTIDO (Setup) — v2
//  Cambios v2:
//  [FIX] Categoría se sincroniza SIEMPRE con modalidad.
//        - onchange del select #setup-mode usa syncSetupMode() centralizado
//        - Garantía final tras restoreSetupState
//        - Listener en equipos guardados para re-sincronizar
// ══════════════════════════════════════════════════════════════════

// v261: Variable global para recordar qué modalidades tiene permitidas el entrenador.
window._cronosAllowedModes = ['f7', 'f11']; // por defecto, ambas

// ════════════════════════════════════════════════════════════════════
//  v429 — POLÍTICA DE EXTRAS BLOQUEADOS (🔒), PUNTO ÚNICO
// ════════════════════════════════════════════════════════════════════
//  La regla del autor: un extra desactivado NO esconde su pestaña ni su
//  botón — los deja a la vista con un candado y en estado bloqueado, para
//  que el usuario sepa que la función existe y que es cosa de su plan.
//
//  Hasta v428 esa política vivía ENTERA dentro de _cronosExtraBtn, y por
//  tanto solo existía en el modal del Entrenador. El panel de Padres, el
//  menú de Comunicaciones y las entradas de mensajería no la aplicaban.
//  Estas tres funciones la sacan a un sitio común para que todas las
//  superficies decidan igual:
//
//    _cronosExtraEnabled(key) → ¿está activo?          (LECTURA única)
//    _cronosExtraGate(key)    → ¿puedo entrar? + aviso (RUNTIME)
//    _cronosExtraBtn(...)     → botón con candado      (PINTADO)
//
//  ⚠️ Por defecto TODO está activo: `!== false`. Un extra ausente (club
//  antiguo que nunca pasó por el panel del SuperAdmin) tiene que quedar
//  HABILITADO. Comparar con `=== true` apagaría media aplicación a todos
//  los clubes que aún no tienen el mapa `extras` en su documento.
window._cronosExtraEnabled = function(extraKey) {
    // Usuario EFECTIVO: en cuentas multi-rol el usuario activo puede no ser
    // window._cronosCurrentUser. Los extras son del club, así que en la
    // práctica coinciden; se prefiere el efectivo por coherencia con el
    // motor de mensajería, que ya resuelve así.
    const me = (typeof window._getEffectiveUser === 'function')
        ? (window._getEffectiveUser() || window._cronosCurrentUser)
        : window._cronosCurrentUser;
    const extras = (me && me.extras) || {};
    return extras[extraKey] !== false;
};

// Portero de tiempo de ejecución. Se llama al PRINCIPIO de la función de
// entrada de cada función bloqueable: si devuelve false, no se entra.
// Devolver un booleano (y no lanzar) permite usarlo tal cual en un `if`.
window._cronosExtraGate = function(extraKey, label) {
    if (window._cronosExtraEnabled(extraKey)) return true;
    const txt = '🔒 ' + (label || 'Esta función') + ' no está disponible en tu plan';
    if (typeof showToast === 'function') showToast(txt, 3500);
    else alert(txt);
    return false;
};

// FIX (Error #26): Helper para mostrar botones con candado si el extra está desactivado
window._cronosExtraBtn = function(extraKey, label, onclickAction, styleStr) {
    const enabled = window._cronosExtraEnabled(extraKey);
    // FIX: verificar en tiempo de click tambien (por si extras se cargo tarde).
    // v429: el guard delega en _cronosExtraGate en vez de repetir aquí la
    // lectura de extras — antes había DOS reglas (esta cadena y la de arriba)
    // que podían divergir, y de hecho miraban usuarios distintos.
    const guard = "if(typeof window._cronosExtraGate==='function' && !window._cronosExtraGate('" + extraKey + "'))return;";
    if (enabled) {
        return '<button class="btn" onclick="' + guard + onclickAction + '" style="background:' + styleStr + '; font-size:0.7rem; font-weight:800; padding:0.6rem 0.2rem; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center;">' + label + '</button>';
    } else {
        return '<button class="btn" disabled title="No disponible en tu plan" style="background:rgba(255,255,255,0.03); color:#555; font-size:0.7rem; border:1px solid rgba(255,255,255,0.08); font-weight:800; padding:0.6rem 0.2rem; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center; cursor:not-allowed; opacity:0.6;">🔒 ' + label + '</button>';
    }
};

// FIX: re-renderizar el modal cuando los extras se carguen
window._cronosRefreshExtras = function() {
    if (typeof openSetupModal === 'function' && document.querySelector('.setup-mode')) {
        openSetupModal();
    }
};

function openSetupModal() {
    // Pila de navegación (js/core/nav-stack.js): esta pantalla es la RAÍZ del
    // panel del Entrenador, así que al pintarse resetea la pila. Eso es lo que
    // permite migrar el resto por partes: cualquier "Volver" antiguo que
    // todavía llame a openSetupModal() directamente deja la pila coherente en
    // vez de dejarla describiendo una pantalla ya destruida.
    if (typeof navRootScreen === 'function') navRootScreen('openSetupModal');

    document.body.classList.add('setup-mode');
    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    // v261: Limitar la modalidad según la categoría del entrenador.
    // Si el entrenador tiene categoría F7 (prebenjamin, benjamin, alevin),
    // solo puede crear partidos F7. Si tiene F11 (infantil, cadete, juvenil,
    // regional), solo puede crear F11. Si tiene ambas, puede elegir.
    try {
        var me = window._cronosCurrentUser;
        var hasF7 = false, hasF11 = false;
        if (me && me.allRoles) {
            me.allRoles.forEach(function(r) {
                if (!r || (r.role !== 'user' && r.role !== 'coach')) return;
                var rcat = (r.category || '').toLowerCase();
                // Categorías F7: prebenjamin, benjamin, alevin, futurefem
                // Categorías F11: infantil, cadete, juvenil, regional, regional_fem
                // (aceptamos también con prefijo f7_/f11_)
                // 🔑 FUTureFEM es F7 y Regional FEM es F11 (decisión del autor,
                // 2026-08-12). 'regional_fem' ya entra por includes('regional');
                // 'futurefem' no contiene ninguna de las otras claves y sin esta
                // línea al entrenador se le ofrecerían LAS DOS modalidades.
                if (rcat.includes('prebenjamin') || rcat.includes('benjamin') || rcat.includes('alevin') || rcat.includes('futurefem')) hasF7 = true;
                if (rcat.includes('infantil') || rcat.includes('cadete') || rcat.includes('juvenil') || rcat.includes('regional')) hasF11 = true;
                if (rcat.startsWith('f7_')) hasF7 = true;
                if (rcat.startsWith('f11_')) hasF11 = true;
            });
        }
        // Guardar modalidades permitidas en variable global
        if (hasF7 && !hasF11) {
            window._cronosAllowedModes = ['f7'];
        } else if (hasF11 && !hasF7) {
            window._cronosAllowedModes = ['f11'];
        } else {
            window._cronosAllowedModes = ['f7', 'f11'];
        }
        // Aplicar restricción al desplegable
        setTimeout(function() {
            var modeSel = document.getElementById('setup-mode');
            if (!modeSel) return;
            var allowed = window._cronosAllowedModes;
            var options = '';
            if (allowed.indexOf('f7') >= 0) options += '<option value="f7">Fútbol  7</option>';
            if (allowed.indexOf('f11') >= 0) options += '<option value="f11">Fútbol  11</option>';
            modeSel.innerHTML = options;
            modeSel.value = allowed[0];
            // Desactivar el desplegable si solo hay una opción
            modeSel.disabled = (allowed.length === 1);
            console.log('[v261] Modalidades permitidas:', allowed.join(', '));
            if (typeof syncSetupMode === 'function') syncSetupMode(modeSel.value);
        }, 100);
    } catch(e) { console.warn('[v261] Error limitando modalidad:', e); }
    
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:960px; max-width:98vw; padding:1.5rem; border-radius:16px;">
            <!-- Cabecera -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                <div style="display:flex; align-items:center;">
                    <img src="public/assets/logo.png" style="height:40px; margin-right:12px; filter: drop-shadow(0 0 10px rgba(88,166,255,0.3));" onerror="this.style.display='none'">
                    <span style="font-size:1.4rem; font-weight:900; color:var(--text); letter-spacing:-0.5px;">CHRONOS <span style="color:#58a6ff;">FÚTBOL</span></span>
                </div>
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <!-- v451 · el entrenador vive en esta pantalla; la otra vía
                         está en el landing de roles, que no todos vuelven a ver. -->
                    <button onclick="if(typeof openChangePasswordModal==='function')openChangePasswordModal();"
                            title="Cambiar mi contraseña"
                            style="background:rgba(88,166,255,0.08); border:1px solid rgba(88,166,255,0.3); color:#58a6ff; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem;">🔒 Contraseña</button>
                    <button onclick="cerrarSesion()" style="background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); color:var(--text-muted); padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem;">Cerrar Sesión</button>
                </div>
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
                    <div style="min-width:80px;">
                        <label style="font-size:0.7rem; color:var(--text-muted); display:block; margin-bottom:4px;">Subcategoría</label>
                        <select id="match-subcategory" style="width:100%; padding:6px 8px; background:var(--surface); color:var(--text); border:1px solid var(--glass-border); border-radius:6px; font-size:0.8rem;">
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                        </select>
                    </div>
                    <script>
                    // FIX: bloquear categoria y subcategoria si el entrenador las tiene asignadas
                    (function() {
                        var me = window._cronosCurrentUser;
                        if (me && me.category) {
                            var cat = document.getElementById('match-category');
                            var sub = document.getElementById('match-subcategory');
                            if (cat) cat.disabled = true;
                            if (sub) sub.disabled = true;
                        }
                    })();
                    </script>
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
                    ${_cronosExtraBtn('plantilla', 'GESTIONAR PLANTILLA', 'saveSetupState(); openRosterManager()', 'rgba(88,166,255,0.12); color:#58a6ff; border:1px solid rgba(88,166,255,0.4)')}
                    ${_cronosExtraBtn('contactos', '📱 CONTACTOS', 'saveSetupState(); Promise.resolve(openContactManager()).catch(function(e){ console.error(\'[Contactos] Error al abrir:\', e); if(typeof hideSpinner===\'function\') hideSpinner(); if(typeof showToast===\'function\') showToast(\'⚠️ No se pudo abrir Contactos\', 3000); });', 'rgba(255,165,0,0.12); color:#ffa500; border:1px solid rgba(255,165,0,0.4)')}
                    ${_cronosExtraBtn('convocatorias', '📋 CONVOCATORIA', 'openConvocationModal()', 'rgba(63,185,80,0.12); color:#3fb950; border:1px solid rgba(63,185,80,0.5)')}
                    ${_cronosExtraBtn('entrenamientos', '🏃 ENTRENAMIENTO', 'openTrainingPanel()', 'rgba(88,166,255,0.12); color:#58a6ff; border:1px solid rgba(88,166,255,0.4)')}
                    ${_cronosExtraBtn('informes', '📊 MIS INFORMES', 'typeof openMisInformes === \'function\' ? openMisInformes() : alert(\'Módulo en mantenimiento\')', 'rgba(255,215,0,0.12); color:#ffd700; border:1px solid rgba(255,215,0,0.4)')}
                </div>

                <!-- BOTONES PRINCIPALES: CONTINUAR + RECUPERAR + COMUNICACIONES -->
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.7rem;">
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
                    <button class="btn" onclick="if(typeof _openCoachCommsMenu==='function') _openCoachCommsMenu();"
                        title="Mensajes, Partidos Terminados y Retransmisión en Vivo"
                        style="width:100%; padding:0.9rem; font-size:1rem; font-weight:900;
                               letter-spacing:0.3px; border-radius:10px;
                               background:rgba(180,120,200,0.15); color:#b478c8;
                               border:2px solid rgba(180,120,200,0.5); cursor:pointer;
                               text-transform:uppercase;">
                        💬 COMUNICACIONES
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

    // FIX (Error #27 CRÍTICO): forzar auto-seleccion de categoria/subcategoria
    // con múltiples reintentos retardados. El problema es que me.category se
    // asigna de forma asíncrona en _launchWithRole, y cuando openSetupModal
    // se ejecuta, me.category puede no estar disponible aún.
    function _forceCategorySelect() {
        var _me = window._cronosCurrentUser;
        if (!_me || !_me.category) return false;
        var catSel = document.getElementById('match-category');
        var subSel = document.getElementById('match-subcategory');
        if (!catSel) return false;
        var userCat = String(_me.category).toLowerCase();
        var mode = document.getElementById('setup-mode')?.value || 'f7';
        var targetValue = '';
        // ⚠️ LAS DOS FEM VAN PRIMERO: 'regional_fem' CONTIENE 'regional', así que
        // con el orden anterior a un entrenador de Regional FEM se le forzaba
        // 'Regional' a secas y su informe acababa en la rama equivocada.
        if (userCat.includes('futurefem'))    targetValue = mode + '_futurefem';
        else if (userCat.includes('regional') && userCat.includes('fem'))
                                              targetValue = mode + '_regional_fem';
        else if (userCat.includes('prebenj'))      targetValue = mode + '_prebenjamin';
        else if (userCat.includes('benj'))    targetValue = mode + '_benjamin';
        else if (userCat.includes('alev'))    targetValue = mode + '_alevin';
        else if (userCat.includes('infant'))  targetValue = mode + '_infantil';
        else if (userCat.includes('cadet'))   targetValue = mode + '_cadete';
        else if (userCat.includes('juvenil')) targetValue = mode + '_juvenil';
        else if (userCat.includes('regional'))targetValue = mode + '_regional';
        if (targetValue) {
            var opt = catSel.querySelector('option[value="' + targetValue + '"]');
            if (opt) {
                catSel.value = targetValue;
                catSel.disabled = true;
                console.log('[openSetupModal] categoria forzada:', targetValue);
            }
        }
        if (subSel && _me.subcategory) {
            var userSub = String(_me.subcategory).toUpperCase().trim();
            if (['A','B','C'].includes(userSub)) {
                subSel.value = userSub;
                subSel.disabled = true;
                console.log('[openSetupModal] subcategoria forzada:', userSub);
            }
        }
        return true;
    }
    // Intentar inmediatamente, luego a 200ms, 500ms, 1000ms y 2000ms
    if (!_forceCategorySelect()) {
        setTimeout(_forceCategorySelect, 200);
        setTimeout(_forceCategorySelect, 500);
        setTimeout(_forceCategorySelect, 1000);
        setTimeout(_forceCategorySelect, 2000);
    }

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
        subcategory: document.getElementById('match-subcategory')?.value || 'A',
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
    // FIX: NO sobrescribir si el entrenador tiene me.category asignada
    const me = window._cronosCurrentUser;
    const userHasCategory = me && me.category;
    const categoryMatchesMode = s.category && s.category.startsWith(s.mode + '_');
    if (categoryMatchesMode && !userHasCategory) {
        set('match-category', s.category);
        set('match-subcategory', s.subcategory || 'A');
    }
    if (userHasCategory && typeof updateCategoryOptions === 'function') {
        updateCategoryOptions(s.mode);
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

    // NOTA: NO se fuerza analyzeAway al jugar de visitante. "Analizar Contrario"
    // (analyzeAway) controla EXCLUSIVAMENTE si se dibuja también el equipo rival.
    // El equipo del entrenador se crea siempre (sea 'home' o 'away') en
    // spawnInitialPlayers(). Forzarlo aquí dibujaba ambos equipos de visitante
    // aunque el checkbox estuviera desactivado.

    if (!selectedFormationOnStart) {
        selectedFormationOnStart = currentMode === 'f7' ? '231' : '442';
        const formationEl = document.getElementById('setup-formation');
        if (formationEl) formationEl.value = selectedFormationOnStart;
    }

    document.getElementById('team-a-name').textContent = TEAM_NAMES.home;
    document.getElementById('team-b-name').textContent = TEAM_NAMES.away;

    // hide-visitor: oculta la banca del equipo CONTRARIO y agranda el campo.
    // role-away: cuando juego de visitante mi banca está en la sidebar derecha,
    // así el CSS sabe que debe ocultar la izquierda (home) en vez de la derecha.
    document.body.classList.toggle('role-away', window._userTeamRole === 'away');
    if (!analyzeAway) {
        document.body.classList.add('hide-visitor');
    } else {
        document.body.classList.remove('hide-visitor');
    }

    document.body.classList.toggle('mode-f11', currentMode === 'f11');

    const catEl = document.getElementById('match-category');
    const category = catEl ? catEl.value : 'f7_prebenjamin';
    window._currentMatchCategory = category;
        window._currentMatchSubcategory = document.getElementById('match-subcategory')?.value || 'A';
        window._currentMatchSubcategory = document.getElementById('match-subcategory')?.value || 'A';
    let defaultTime = 30;

    if (category.includes('prebenjamin')) {
        defaultTime = 30;
    } else if (category.includes('futurefem')) {
        defaultTime = 35;               // F7, 2T x 35' (decisión del autor)
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
//  v441 · UNA SOLA TARJETA POR PARTIDO EN "RECUPERAR PARTIDO EN CURSO"
//
//  Reporte del autor: al salir y volver a entrar, el mismo partido salía DOS
//  veces —una con la etiqueta "DISPOSITIVO LOCAL" y otra con "NUBE"—, y hay que
//  elegir entre dos tarjetas que son lo mismo.
//
//  🔑 POR QUÉ NO BASTABA EL DEDUP QUE YA HABÍA. Existía, pero comparaba
//  ÚNICAMENTE el identificador: `localMatch.liveMatchId === d.id`. Basta con que
//  el id guardado en el dispositivo no coincida con el del documento de la nube
//  para que el filtro no vea nada y salgan las dos. Y hay más de una forma de
//  que no coincida: que el estado se guardara antes de que `startLiveSync`
//  asignara el id (arranca 800 ms después de pintar a los jugadores), o que el
//  partido se reanudara sin pasar por "Retomar", en cuyo caso `startLiveSync`
//  lo trata como partido NUEVO y genera otro id —lleva la hora y el minuto en
//  el sufijo— dejando el documento anterior huérfano en la nube.
//
//  🔑 LA IDENTIDAD QUE SÍ AGUANTA: dentro de este panel, dos entradas con los
//  MISMOS equipos y la misma modalidad son el mismo partido. No es una
//  suposición: las dos fuentes ya vienen filtradas por el límite de duración
//  (80 min en F-7, 110/120 en F-11), así que la lista sólo puede contener
//  partidos de las últimas dos horas y no se puede jugar dos veces el mismo
//  enfrentamiento en esa ventana. El id sigue valiendo como segunda vía: si
//  coincide, fusiona aunque alguien haya renombrado un equipo a mitad.
//
//  Se fusiona en vez de descartar una fuente porque cada una sabe algo que la
//  otra no: el dispositivo tiene el estado más fresco cuando se perdió la
//  cobertura, y la nube lo tiene cuando el partido se siguió desde otro
//  aparato. Se muestra la MÁS RECIENTE y se ofrece un único "Retomar".
// ════════════════════════════════════════════════════════════════════
function _recoveryNorm(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Momento del último guardado, en milisegundos. Es lo que decide qué fuente
// manda cuando el mismo partido está en las dos.
function _recoveryTs(c) {
    if (!c) return 0;
    if (c.isLocal) return new Date(c.savedAt || 0).getTime() || 0;
    const u = c.updatedAt;
    if (u && typeof u.toMillis === 'function') return u.toMillis() || 0;
    if (u && typeof u.toDate === 'function') return u.toDate().getTime() || 0;
    return new Date(c.savedAt || u || 0).getTime() || 0;
}

// Las claves por las que dos candidatos son el MISMO partido.
function _recoveryClaves(c) {
    const claves = [];
    const id = c.isLocal ? c.liveMatchId : c._id;
    if (id) claves.push('id:' + id);
    const home = _recoveryNorm(c.homeTeam && c.homeTeam.name);
    const away = _recoveryNorm(c.awayTeam && c.awayTeam.name);
    // Sin nombres de equipo no hay identidad por equipos: se queda sólo con el
    // id. Fusionar dos partidos "sin nombre" sería peor que enseñar dos.
    if (home || away) claves.push('eq:' + home + '|' + away + '|' + (c.mode || 'f7'));
    return claves;
}

// Fusiona las dos fuentes en UNA entrada por partido. Función pura: no toca el
// DOM ni Firestore, para poder ejercitarla en el guard.
//   Devuelve [{ datos, tieneLocal, idsNube, ts }] ordenado por ts descendente.
// v465 · El primer argumento admite UN candidato local o una LISTA de ellos.
// Antes sólo podía haber uno porque el estado local vivía en una clave única;
// desde v465 hay una ranura por partido y un entrenador puede tener dos o tres
// abiertos a la vez, así que el panel tiene que poder enseñarlos todos. Se
// mantiene la forma de un solo candidato porque es como lo llama el guard
// scripts/test_recovery_merge.js, que comprueba la fusión en sí.
function _fusionaCandidatosRecuperacion(localMatch, docsNube) {
    const entradas = [];
    const porClave = new Map();

    const meter = (cand) => {
        if (!cand) return;
        const claves = _recoveryClaves(cand);
        let destino = null;
        for (const k of claves) {
            if (porClave.has(k)) { destino = porClave.get(k); break; }
        }
        if (!destino) {
            destino = { datos: null, tieneLocal: false, idsNube: [], idsLocal: [], ts: -1 };
            entradas.push(destino);
        }
        // TODAS las claves del candidato apuntan ya a esta entrada: así un
        // tercer candidato que coincida por cualquiera de ellas también cae
        // aquí (el local casa por equipos, y el segundo documento de nube por
        // id con el primero).
        for (const k of claves) porClave.set(k, destino);

        if (cand.isLocal) {
            destino.tieneLocal = true;
            // v465 · QUÉ ranura local es. Con varios partidos abiertos,
            // "tiene local" ya no basta para borrarlo: hay que saber CUÁL, o
            // el botón de eliminar se llevaría por delante el partido
            // equivocado.
            if (cand._slotId && destino.idsLocal.indexOf(cand._slotId) === -1) {
                destino.idsLocal.push(cand._slotId);
            }
        }
        else if (cand._id && destino.idsNube.indexOf(cand._id) === -1) destino.idsNube.push(cand._id);

        // Lo que se ENSEÑA sale de la fuente más reciente.
        const ts = _recoveryTs(cand);
        if (ts > destino.ts) { destino.datos = cand; destino.ts = ts; }
    };

    if (Array.isArray(localMatch)) localMatch.forEach(meter);
    else meter(localMatch);
    (docsNube || []).forEach(meter);

    entradas.sort((a, b) => b.ts - a.ts);
    return entradas;
}
window._fusionaCandidatosRecuperacion = _fusionaCandidatosRecuperacion;

// ════════════════════════════════════════════════════════════════════
//  RECUPERAR PARTIDO EN CURSO
//  Consulta live_matches en Firestore filtrando por coachUid actual
//  y status === 'active'. Muestra un panel para retomar el partido.
// ════════════════════════════════════════════════════════════════════
async function openLiveMatchRecovery() {
    // Pila de navegación (js/core/nav-stack.js).
    if (typeof navScreen === 'function') navScreen('openLiveMatchRecovery');

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

    // 1. Obtener y validar los partidos locales.
    // v465 · Ya no es UNO: hay una ranura por partido (js/core/match-slots.js),
    // porque un entrenador puede tener el Alevín y el Juvenil abiertos a la vez.
    // El panel tiene que enseñarlos TODOS o el segundo sería irrecuperable.
    const localMatches = [];
    const now = Date.now();

    const _ranuras = window._cronosMatchSlots ? window._cronosMatchSlots.listar() : [];
    for (const _ranura of _ranuras) {
        try {
            const parsed = _ranura.state;
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
                    localMatches.push({
                        // El _id sigue siendo el marcador de "esto es local"; lo
                        // que identifica la RANURA concreta es `_slotId`, y es
                        // lo que necesita el botón de eliminar para no llevarse
                        // el partido de al lado.
                        _id: 'local_active',
                        _slotId: _ranura.id,
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
                    });
                } else {
                    // Expiró localmente — se cierra SÓLO esta ranura.
                    window._cronosMatchSlots?.cerrar(_ranura.id, false);
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

        const docsNube = [];

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
                // v441: ya NO se descarta aquí el documento que coincide con el
                // local. La fusión se hace después, en un solo sitio y con una
                // identidad que no depende de que los ids coincidan.
                docsNube.push({ _id: d.id, ...data });
            }
        });

        // v441 · Las dos fuentes se funden en UNA entrada por partido, ordenadas
        // por la más recientemente guardada.
        const entradas = _fusionaCandidatosRecuperacion(localMatches, docsNube);

        if (entradas.length === 0) {
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

        list.innerHTML = entradas.map(entrada => {
            // `m` son los datos de la fuente MÁS RECIENTE de esta entrada; la
            // procedencia (dispositivo, nube o ambas) va aparte.
            const m = entrada.datos;
            const updTs = entrada.ts > 0 ? entrada.ts : 0;
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
            // v441: `playerCount` sólo lo trae la fuente del dispositivo; el
            // documento de la nube guarda el array `players`. Antes toda tarjeta
            // de nube decía "0 jugadores", y ahora la fusión puede elegir esa
            // fuente, así que el recuento se saca de donde esté.
            const playerCount = m.playerCount || (Array.isArray(m.players) ? m.players.length : 0);
            const modeLabel = m.mode === 'f11' ? 'F-11' : 'F-7';

            // ── Retomar: por la fuente MÁS RECIENTE de la entrada ──
            // Retomar del dispositivo no necesita red y trae el estado tal cual
            // se dejó; de la nube trae el que vieron los espectadores. Se elige
            // el más fresco, que es justo lo que ya decidió la fusión.
            const idsAttr = typeof escapeAttr === 'function'
                ? escapeAttr(entrada.idsNube.join(','))
                : entrada.idsNube.join(',').replace(/'/g, '');
            let clickResume;
            if (m.isLocal) {
                // v465 · SE DICE QUÉ RANURA SE RETOMA. Sin el argumento, con dos
                // partidos abiertos las dos tarjetas llamaban a lo mismo y la
                // segunda retomaba el primero.
                const safeSlot = typeof escapeAttr === 'function'
                    ? escapeAttr(m._slotId || '') : String(m._slotId || '').replace(/'/g, '');
                clickResume = `_doResumeLocalMatch('${safeSlot}')`;
            } else {
                const safeId = typeof escapeAttr === 'function' ? escapeAttr(m._id) : String(m._id).replace(/'/g, '');
                clickResume = `_doResumeMatch('${safeId}')`;
            }
            // ── Eliminar: SE LLEVA LAS DOS FUENTES ──
            // 🔑 Si sólo se borrara una, la otra reaparecería sola en el
            // siguiente repintado y el usuario volvería a ver el partido que
            // acaba de eliminar. Es la mitad del defecto que se está cerrando.
            // v465 · viaja también QUÉ ranura local es esta entrada.
            const idsLocalAttr = (entrada.idsLocal || []).join(',');
            const clickDelete = `_doDeleteRecoveryEntry('${idsAttr}', ${entrada.tieneLocal ? 'true' : 'false'}, '${idsLocalAttr}')`;

            // Una sola etiqueta que dice DÓNDE está guardado, en vez de dos
            // tarjetas compitiendo. La información no se pierde: se consolida.
            const origenTexto = (entrada.tieneLocal && entrada.idsNube.length) ? '📱 DISPOSITIVO + ☁️ NUBE'
                              : entrada.tieneLocal ? '📱 SOLO EN ESTE DISPOSITIVO'
                              : '☁️ NUBE';
            const origenColor = (entrada.tieneLocal && entrada.idsNube.length)
                ? 'background:rgba(63,185,80,0.18);color:#3fb950;'
                : entrada.tieneLocal ? 'background:rgba(88,166,255,0.2);color:#58a6ff;'
                : 'background:rgba(240,136,62,0.2);color:#f0883e;';
            const localTag = `<span title="Fuentes de este partido" style="${origenColor}font-size:0.62rem;padding:2px 6px;border-radius:4px;font-weight:900;margin-left:0.5rem;vertical-align:middle;white-space:nowrap;">${origenTexto}</span>`;

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
        if (list && localMatches.length) {
            // Caso sin conexión: mostrar los locales al menos.
            // v465 · TODOS, no sólo el primero: sin red, esta lista es la única
            // forma de volver a un partido, y dejar fuera el segundo lo haría
            // irrecuperable justo cuando peor viene.
            list.innerHTML = localMatches.map(localMatch => {
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
            const slotAttr = (typeof escapeHtml==='function'?escapeHtml(localMatch._slotId||''):(localMatch._slotId||''));

            return `
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
                        <button onclick="_doResumeLocalMatch('${slotAttr}')"
                            style="padding:0.45rem 1rem;background:#f0883e;border:none;
                                   border-radius:8px;color:#0a0e14;font-weight:800;
                                   font-size:0.82rem;cursor:pointer;">
                            ▶ Retomar
                        </button>
                        <button onclick="_doDeleteLocalMatch('${slotAttr}')"
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
        } else {
            if (list) list.innerHTML = `<div style="color:#ff5858;text-align:center;padding:2rem;">⚠️ Error al cargar: ${err.message}</div>`;
        }
        console.error('[Recovery] Error cargando live_matches:', err);
    }
}

// ¿El partido guardado en este dispositivo es el del id que se va a borrar?
// Se compara por id Y por equipos, la misma identidad que usa la fusión: si
// sólo se mirara el id, el estado local del MISMO partido sobreviviría al
// borrado (con otro id) y el partido reaparecería solo.
// v465 · Devuelve el ID DE LA RANURA que corresponde a ese partido, o '' si
// ninguna. Antes devolvía un booleano porque sólo podía haber un estado local;
// ahora hay uno por partido y hace falta saber CUÁL, no si "hay alguno": con
// dos partidos abiertos, un booleano habría hecho que borrar el de la nube se
// llevara por delante el estado local del otro.
function _recoveryRanuraDelPartido(matchId) {
    try {
        const S = window._cronosMatchSlots;
        if (!S) return '';
        for (const r of S.listar()) {
            if (_ranuraCasaConPartido(r.state, matchId)) return r.id;
        }
        return '';
    } catch (e) { return ''; }
}

function _ranuraCasaConPartido(p, matchId) {
    try {
        if (!p) return false;
        if (p.liveMatchId && matchId && p.liveMatchId === matchId) return true;
        // Sin coincidencia de id, el nombre del equipo local va dentro del id
        // generado por startLiveSync (slug del equipo + fecha + hora), así que
        // se compara por ahí; es una pista, no una certeza, y por eso exige
        // además que el partido local no tenga id propio con el que decidir.
        if (!p.liveMatchId && p.teamNames && p.teamNames.home && matchId) {
            const slug = _recoveryNorm(p.teamNames.home)
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 20);
            return !!slug && String(matchId).indexOf(slug) === 0;
        }
        return false;
    } catch (e) { return false; }
}

// Se conserva la forma booleana: la usa el borrado silencioso de documentos
// caducados y el guard scripts/test_recuperar_partido_fusion equivalente.
function _recoveryEsElPartidoLocal(matchId) {
    return !!_recoveryRanuraDelPartido(matchId);
}
window._recoveryEsElPartidoLocal = _recoveryEsElPartidoLocal;
window._recoveryRanuraDelPartido = _recoveryRanuraDelPartido;

// ── Eliminar una entrada FUSIONADA del panel de recuperación (v441) ────
// Borra TODAS las fuentes del partido: los documentos de la nube que se
// hubieran fusionado y el estado guardado en el dispositivo. Si se dejara una,
// el partido volvería a aparecer solo en el siguiente repintado.
async function _doDeleteRecoveryEntry(idsNubeCsv, tieneLocal, idsLocalCsv) {
    if (!confirm('¿Eliminar este partido en curso? Se borrará de este dispositivo y de la nube, y no podrás recuperarlo.')) return;
    const ids = String(idsNubeCsv || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const id of ids) {
        try { await _doDeleteLiveMatch(id, null, true); } catch (e) { console.warn('[Recovery] borrando', id, e); }
    }
    if (tieneLocal === true || tieneLocal === 'true') {
        // v465 · Se borran LAS RANURAS DE ESTA ENTRADA, no "el estado local".
        // Con varios partidos abiertos, borrar a ciegas se llevaba el que
        // seguía jugándose.
        const locales = String(idsLocalCsv || '').split(',').map(s => s.trim()).filter(Boolean);
        const S = window._cronosMatchSlots;
        if (S) {
            if (locales.length) locales.forEach(sid => S.cerrar(sid, true));
            // Respaldo para una entrada antigua sin idsLocal: se resuelve por
            // identidad del partido, nunca borrando lo primero que haya.
            else ids.forEach(id => { const sid = _recoveryRanuraDelPartido(id); if (sid) S.cerrar(sid, true); });
        }
        document.getElementById('cronos-restore-banner')?.remove();
    }
    if (typeof showToast === 'function') showToast('🗑 Partido eliminado', 2500);
    // Repintar: es la forma de que el recuento y el estado vacío queden bien.
    openLiveMatchRecovery();
}
window._doDeleteRecoveryEntry = _doDeleteRecoveryEntry;

// ── Retomar un partido local ───────────────────────────────────────────
// v465 · Recibe QUÉ ranura se retoma. `_restoreActiveMatch` lee
// `_cronosRestoreSlotId`, así que fijarlo aquí es lo que hace que el botón de
// la segunda tarjeta retome el segundo partido y no el primero.
function _doResumeLocalMatch(slotId) {
    if (slotId) window._cronosRestoreSlotId = slotId;
    if (typeof window._restoreActiveMatch === 'function') {
        window._restoreActiveMatch();
    }
}
window._doResumeLocalMatch = _doResumeLocalMatch;
// ── Eliminar un partido local ──────────────────────────────────────────
function _doDeleteLocalMatch(slotId) {
    if (!confirm('¿Eliminar este partido local en curso? Se perderá definitivamente.')) return;
    const S = window._cronosMatchSlots;
    const id = slotId || (S && S.getTabMatchId());
    if (S && id) S.cerrar(id, true);
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

        // FIX: restaurar el rol del equipo del entrenador (home/away). Sin esto,
        // tras recuperar un partido jugado de visitante, _userTeamRole se perdía
        // y los informes (filtrados por _cMyTeamKey) quedaban vacíos.
        if (m.myTeamRole) window._userTeamRole = m.myTeamRole;

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
        document.body.classList.toggle('role-away', window._userTeamRole === 'away');
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

        // Limpiar también el estado del dispositivo, para que no reaparezca por
        // la otra fuente.
        // 🐛 v441 · PERO SÓLO SI ES EL MISMO PARTIDO. Antes se borraba SIEMPRE, y
        // esta función se llama en silencio para cada documento CADUCADO que se
        // encuentra al abrir el panel: un partido viejo de la nube borraba el
        // estado del partido de HOY que aún estaba en curso en el dispositivo.
        // Pérdida de datos real, y silenciosa.
        // v465 · Y sólo LA RANURA de ese partido. La v441 ya evitó que un
        // documento caducado borrase el partido de hoy; con varios partidos
        // abiertos hay que apuntar además a la ranura correcta, porque ahora
        // conviven dos partidos de hoy igual de vivos.
        const _sid = _recoveryRanuraDelPartido(matchId);
        if (_sid) window._cronosMatchSlots?.cerrar(_sid, true);

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

// ════════════════════════════════════════════════════════════════════
// COMUNICACIONES (desde panel del entrenador)
// Abre un modal con 3 opciones: Mensajes, Partidos Terminados, Retransmisión
// ════════════════════════════════════════════════════════════════════
window._openCoachCommsMenu = function() {
    // Pila de navegación (js/core/nav-stack.js).
    if (typeof navScreen === 'function') navScreen('_openCoachCommsMenu');

    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(94vw,460px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <div style="padding:1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1.1rem;">💬 Comunicaciones</h3>
            <div style="display:flex;align-items:center;gap:0.5rem;">
                <button onclick="navBack()" class="btn"
                    style="padding:0.3rem 0.7rem;font-size:0.72rem;color:var(--text-muted);">← Volver</button>
                <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();" title="Salir al selector de roles"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
            </div>
        </div>

        <div style="padding:1.2rem;overflow-y:auto;flex:1;">
            <div style="font-size:0.85rem;color:var(--text);margin-bottom:0.5rem;font-weight:600;">
                ¿Qué quieres hacer?
            </div>

            <div style="display:grid;gap:0.7rem;">

                <!-- MENSAJES · v429: candado del extra 'mensajeria'. -->
                <button onclick="(function(){ if(typeof openCoachMessaging==='function'){openCoachMessaging('parents');}else{alert('Módulo de mensajes no disponible');} })()"
                    ${window._cronosExtraEnabled('mensajeria') ? '' : 'disabled title="No disponible en el plan de tu club"'}
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;
                           ${window._cronosExtraEnabled('mensajeria') ? '' : 'opacity:0.45;cursor:not-allowed;filter:grayscale(0.7);'}">
                    <span style="font-size:1.5rem;">${window._cronosExtraEnabled('mensajeria') ? '💬' : '🔒'}</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Mensajes</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Chat con padres · dirección · coordinación</div>
                    </div>
                </button>

                <!-- PARTIDOS TERMINADOS -->
                <button onclick="(function(){
                    const _extras = (window._cronosCurrentUser?.extras) || {};
                    if (_extras.partidos_terminados === false) {
                        if(typeof showToast==='function') showToast('🔒 Partidos Terminados no disponible en tu plan', 3500);
                        else alert('No disponible en tu plan');
                        return;
                    }
                    if(typeof showFinishedMatches==='function'){showFinishedMatches();}else{alert('Módulo no disponible');}
                })()"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(255,88,88,0.08);border:1px solid rgba(255,88,88,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">📋</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Partidos Terminados</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Ver y volver a partidos finalizados</div>
                    </div>
                </button>

                <!-- REGISTRAR SUCESOS OFFLINE (retroactivos) -->
                <button onclick="(function(){ if(typeof openRetroactiveEventModal==='function'){openRetroactiveEventModal();}else{alert('Módulo no disponible');} })()"
                    title="Registrar goles, tarjetas o cambios que ocurrieron sin batería o cobertura"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">⏱️</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Registrar sucesos offline</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Añadir eventos perdidos por falta de batería o cobertura</div>
                    </div>
                </button>

                <!-- PARTIDOS EN VIVO -->
                <button onclick="_cronosOpenLiveMatchesPanel()"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(255,88,88,0.12);border:1px solid rgba(255,88,88,0.35);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">🔴</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Partidos en Vivo</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Ver partidos del club en directo</div>
                    </div>
                </button>

            </div>
        </div>

        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);flex-shrink:0;">
            <button onclick="openSetupModal()" class="btn"
                style="color:var(--text-muted);width:100%;">← Volver</button>
        </div>
    </div>`;
};

// ════════════════════════════════════════════════════════════════════
// PARTIDOS EN VIVO — Panel para ver partidos del club en directo
// ════════════════════════════════════════════════════════════════════
window._cronosOpenLiveMatchesPanel = async function() {
    // 🔑 v425 — ESTA PANTALLA NO SE REGISTRABA EN LA PILA DE NAVEGACIÓN.
    // Es la única de las que pintan sobre #setup-modal que se lo saltaba, y su
    // pie llama a navBack(). Como nunca llegó a estar en la pila, ese navBack()
    // desapilaba la pantalla que la había ABIERTO y repintaba la anterior a
    // ésa: se volvía un nivel de más, a una pantalla por la que el usuario no
    // había pasado. Es exactamente el fallo que el módulo nav-stack vino a
    // eliminar, y su cabecera lo advierte: una pantalla sin registrar deja la
    // pila describiendo algo que ya no está en el DOM.
    //
    // Va ANTES del primer await (invariante de la ronda 3 del módulo): después
    // del await, navBack podría haber corrido ya con la pila vieja.
    if (typeof navScreen === 'function') navScreen('_cronosOpenLiveMatchesPanel');

    const me = window._cronosCurrentUser;
    if (!me) return;

    // Verificar extra
    const extras = (me && me.extras) || {};
    if (extras.partidos_en_vivo === false) {
        if (typeof showToast === 'function') showToast('🔒 No disponible en tu plan', 3000);
        else alert('No disponible en tu plan');
        return;
    }

    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(94vw,600px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <div style="padding:1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1.1rem;">🔴 Partidos en Vivo</h3>
            <button onclick="openSetupModal()"
                style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <div id="live-matches-body" style="padding:1.2rem;overflow-y:auto;flex:1;">
            <div style="text-align:center;padding:2rem;color:var(--text-muted);">
                <div style="font-size:1.6rem;animation:spin 1.2s linear infinite;">🔴</div>
                <p style="margin-top:0.5rem;">Buscando partidos en vivo...</p>
            </div>
            <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
        </div>

        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);flex-shrink:0;">
            <div style="display:flex;gap:0.5rem;">
                <button onclick="navBack()" class="btn" style="color:var(--text-muted);flex:1;">← Volver</button>
                <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();" class="btn" title="Salir al selector de roles"
                    style="color:var(--text-muted);flex:0 0 auto;">✕</button>
            </div>
        </div>
    </div>`;

    try {
        const { collection, getDocs, query, where } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth?.db;
        if (!db) { document.getElementById('live-matches-body').innerHTML = '<div style="color:#ff5858;">Firebase no disponible</div>'; return; }

        // FIX: la coleccion se llama 'live_matches' (NO 'cronos_live_matches')
        // Buscar TODOS los partidos activos del club sin filtro de status
        // (el filtro se hace en cliente porque Firestore no soporta != en queries)
        const snap = await getDocs(query(
            collection(db, 'live_matches'),
            where('clubId', '==', me.clubId || '')
        )).catch(() => null);

        const body = document.getElementById('live-matches-body');
        if (!snap || snap.empty) {
            body.innerHTML = `
            <div style="text-align:center;padding:2rem;color:var(--text-muted);">
                <div style="font-size:2rem;margin-bottom:0.5rem;">📭</div>
                <div style="font-size:0.9rem;font-weight:600;">No hay partidos en vivo ahora mismo</div>
                <div style="font-size:0.75rem;margin-top:0.3rem;">Los partidos activos aparecerán aquí cuando un entrenador inicie un partido.</div>
            </div>`;
            return;
        }

        const matches = [];
        snap.forEach(d => {
            const data = d.data();
            // Solo mostrar partidos activos (no finalizados)
            if (data.status !== 'finished' && data.status !== 'ended' && data.phase !== 'finished') {
                matches.push({ id: d.id, ...data });
            }
        });

        if (!matches.length) {
            body.innerHTML = `
            <div style="text-align:center;padding:2rem;color:var(--text-muted);">
                <div style="font-size:2rem;margin-bottom:0.5rem;">📭</div>
                <div style="font-size:0.9rem;font-weight:600;">No hay partidos en vivo ahora mismo</div>
            </div>`;
            return;
        }

        body.innerHTML = matches.map(m => {
            const home = m.homeName || m.teamHome || 'Local';
            const away = m.awayName || m.teamAway || m.rival || 'Visitante';
            const score = (m.scoreHome != null && m.scoreAway != null) ? m.scoreHome + ' - ' + m.scoreAway : '0 - 0';
            const half = m.currentHalf === 2 ? '2ª Parte' : (m.currentHalf === 1 ? '1ª Parte' : 'En juego');
            const coach = m.coachEmail || '';
            const cat = m.category || '';
            return `
            <div style="background:rgba(255,88,88,0.06);border:1px solid rgba(255,88,88,0.2);
                        border-radius:10px;padding:0.9rem;margin-bottom:0.6rem;cursor:pointer;transition:all 0.15s;"
                 onclick="window.open('./live.html?match=${m.id}', '_blank')"
                 onmouseover="this.style.borderColor='rgba(255,88,88,0.5)'"
                 onmouseout="this.style.borderColor='rgba(255,88,88,0.2)'">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="flex:1;">
                        <div style="font-weight:700;font-size:0.95rem;">
                            <span style="color:#58a6ff;">${typeof escapeHtml==='function'?escapeHtml(home):home}</span>
                            <span style="color:var(--text-muted);margin:0 0.5rem;">${score}</span>
                            <span style="color:#ff5858;">${typeof escapeHtml==='function'?escapeHtml(away):away}</span>
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;">
                            🔴 ${half} ${cat ? '· ' + cat : ''} ${coach ? '· ' + coach : ''}
                        </div>
                    </div>
                    <div style="font-size:0.7rem;color:#3fb950;font-weight:700;flex-shrink:0;">
                        ▶ Ver
                    </div>
                </div>
            </div>`;
        }).join('');

    } catch(e) {
        const body = document.getElementById('live-matches-body');
        if (body) body.innerHTML = '<div style="color:#ff5858;padding:1rem;">⚠️ Error: ' + e.message + '</div>';
    }
};

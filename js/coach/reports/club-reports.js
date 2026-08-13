// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — Staff Dashboard (Director / Coordinador) v3.0
//  ADDED: Motor de Informes Visual — Gantt + Panel de Rotaciones +
//         Cabecera completa con logo, marcador, fecha, venue, tiempo
// ════════════════════════════════════════════════════════════════════

// ── Helper Firestore ─────────────────────────────────────────────────
async function _sdFS() {
    const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...m, db: window._cronos_auth?.db };
}

// ════════════════════════════════════════════════════════════════════
//  MODO PRUEBA MULTI-ROL — Solo SuperAdmin
// ════════════════════════════════════════════════════════════════════
window._testRoleClubId = null;

async function openTestRolePicker(targetRole) {
    const me = window._cronosCurrentUser;
    if (!['superadmin','admin'].includes(me?.role)) return;

    const { db, collection, getDocs } = await _sdFS();
    const snap  = await getDocs(collection(db, 'clubs'));
    const clubs = [];
    snap.forEach(d => clubs.push({ id: d.id, ...d.data() }));

    // Pila de navegación: esta pantalla SÍ destruye el panel de Dirección, así
    // que se apila encima para poder volver.
    if (typeof navScreen === 'function') navScreen('openTestRolePicker', targetRole);

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="max-width:460px;padding:1.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem;">
            <div>
                <h3 style="margin:0;font-size:1rem;">🧪 Modo Prueba — ${targetRole}</h3>
                <p style="margin:0.2rem 0 0;font-size:0.75rem;color:var(--text-muted);">
                    Selecciona el club en el que quieres actuar como <strong>${targetRole}</strong>
                </p>
            </div>
            <!-- Cancelar el cambio de club: si se llegó aquí DESDE el panel,
                 vuelve al panel; si esta pantalla fue la entrada (SuperAdmin
                 todavía sin club), no hay nada detrás y la salida correcta
                 sigue siendo el selector de rol. Antes iba SIEMPRE al selector
                 de rol: cancelar te echaba del panel entero. -->
            <button onclick="if(typeof navCanGoBack==='function' && navCanGoBack()) navBack(); else if(typeof showRoleSelector==='function') showRoleSelector();"
                title="Cancelar"
                style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer;">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.5rem;max-height:380px;overflow-y:auto;">
            ${clubs.length === 0
                ? `<p style="color:var(--text-muted);text-align:center;padding:2rem;">No hay clubes creados.</p>`
                : clubs.map(c => `
                <button onclick="window._applyTestRole('${c.id}','${(c.name||'').replace(/'/g,"\\'")}','${targetRole}')"
                    style="text-align:left;padding:0.9rem 1rem;background:rgba(255,255,255,0.04);
                           border:1px solid rgba(255,255,255,0.1);border-radius:10px;
                           color:white;font-size:0.88rem;cursor:pointer;transition:all 0.2s;"
                    onmouseover="this.style.background='rgba(88,166,255,0.1)';this.style.borderColor='rgba(88,166,255,0.3)';"
                    onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.borderColor='rgba(255,255,255,0.1)';">
                    🏟️ <strong>${escapeHtml(c.name||c.id)}</strong>
                    <span style="font-size:0.7rem;color:var(--text-muted);display:block;margin-top:2px;">
                        ${escapeHtml(c.adminEmail||'Sin admin')} · Plan: ${escapeHtml(c.plan||'free')}
                    </span>
                </button>`).join('')
            }
        </div>
    </div>`;

    window._applyTestRole = (clubId, clubName, role) => {
        window._testRoleClubId = clubId;
        window._cronosCurrentUser.clubId   = clubId;
        window._cronosCurrentUser.clubName = clubName;
        window._cronosCurrentUser._activeRole = role === 'director' ? 'director' : 'coordinator';
        showToast(`🧪 Modo prueba: ${role} en "${clubName}"`, 3500);
        modal.style.display = 'none';
        if (role === 'director' || role === 'coordinator') {
            openStaffDashboard();
        } else if (role === 'coach' || role === 'user') {
            if (typeof init === 'function') init('user');
            document.getElementById('main-container').style.display = 'flex';
            document.getElementById('main-header').style.display    = 'flex';
        } else if (role === 'parent') {
            if (typeof openParentPanel === 'function') openParentPanel();
        } else if (role === 'club_admin') {
            if (typeof openClubAdminPanel === 'function') openClubAdminPanel(clubId);
        }
    };
}
window.openTestRolePicker = openTestRolePicker;

// ════════════════════════════════════════════════════════════════════
//  PANEL PRINCIPAL DE DIRECCIÓN
// ════════════════════════════════════════════════════════════════════
// ────────────────────────────────────────────────────────────────────
//  PERMISO DE LA PESTAÑA "Config."  —  Director Deportivo y SuperAdmin
//
//  Regla de producto (2026-07-28): el COORDINADOR no debe ver la pestaña ni
//  poder llegar a ella. El coordinador ejecuta; el director decide.
//
//  Una sola funcion para las DOS puertas —el boton y la ruta— a proposito: si
//  cada una calculase el permiso por su cuenta, podrian divergir y volveria el
//  defecto. Ocultar el boton NO basta: switchStaffTab('config') es invocable
//  desde la consola o desde un onclick reutilizado.
//
//  Ojo con el rol que se mira: el resto del archivo usa `_activeRole || role`
//  porque un usuario puede tener varios roles y estar actuando con uno de
//  ellos; el superadmin, en cambio, se reconoce por `role` (cuando prueba como
//  director, su `_activeRole` es 'director' pero su `role` sigue siendo
//  'superadmin'). Se respeta esa distincion tal cual la usa openStaffDashboard.
// ────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────
//  ¿ACTÚA COMO DIRECTOR DEPORTIVO?  —  predicado único
//
//  Se extrajo de _sdCanSeeConfigTab (2026-08-13) porque el BORRADO
//  PERMANENTE de informes necesita EXACTAMENTE el mismo criterio: sólo el
//  Director Deportivo destruye datos; el entrenador y el coordinador ocultan.
//  Con dos copias, el día que cambie el criterio una de las dos puertas se
//  quedaría atrás — y aquí quedarse atrás significa que alguien que no debe
//  borra informes de forma irreversible.
//
//  ⚠️ SE MIRA EL ROL CON EL QUE SE ESTÁ ACTUANDO (`_activeRole`), no sólo el
//  de raíz: un multi-rol que entra como COORDINADOR no es director aunque su
//  documento diga director. El superadmin se reconoce por `role` porque, al
//  probar como director, su `_activeRole` es 'director' pero su `role` sigue
//  siendo 'superadmin'.
// ────────────────────────────────────────────────────────────────────
function _sdEsDirector(user) {
    const me = user || window._cronosCurrentUser;
    if (!me) return false;
    if (['superadmin', 'admin'].includes(me.role)) return true;
    return (me._activeRole || me.role) === 'director';
}
window._sdEsDirector = _sdEsDirector;

function _sdCanSeeConfigTab(user) {
    return _sdEsDirector(user);
}
window._sdCanSeeConfigTab = _sdCanSeeConfigTab;

// ────────────────────────────────────────────────────────────────────
//  ¿PUEDE BORRAR INFORMES DE FORMA PERMANENTE?
//
//  Regla del autor (2026-08-13, ajuste estricto): la potestad depende ÚNICA Y
//  EXCLUSIVAMENTE del ROL CON EL QUE SE HA ENTRADO —Director Deportivo o
//  Administrador del Club—, nunca de quién sea la persona. Si esa misma
//  persona pasa a ser sólo coordinador o entrenador, pierde la potestad
//  automáticamente aunque siga siendo el mismo usuario físico.
//
//  ⚠️ ES OTRA FUNCIÓN QUE _sdEsDirector Y NO UN ALIAS, aunque se parezcan.
//  Codifican reglas de producto DISTINTAS: la pestaña "Config." es del
//  Director y SÓLO del Director (su guard lo fija: el club_admin NO la ve),
//  mientras que la purga la comparte con el Administrador del Club. Fundirlas
//  para "no repetir" le daría al club_admin una pestaña que no le toca, o le
//  quitaría al director un botón que sí. Una función por regla.
//
//  🔑 SE MIRA `_activeRole` PRIMERO: un multi-rol que ha entrado como
//  COORDINADOR no puede purgar, aunque su documento diga director. Eso es
//  exactamente "tener ACTIVO el rol".
// ────────────────────────────────────────────────────────────────────
function _sdPuedePurgar(user) {
    const me = user || window._cronosCurrentUser;
    if (!me) return false;
    if (['superadmin', 'admin'].includes(me.role)) return true;
    const activo = me._activeRole || me.role;
    return activo === 'director' || activo === 'club_admin';
}
window._sdPuedePurgar = _sdPuedePurgar;

async function openStaffDashboard(initialTab) {
    const me         = window._cronosCurrentUser;
    const activeRole = me?._activeRole || me?.role;
    const isSA       = ['superadmin','admin'].includes(me?.role);

    if (isSA && !me?.clubId) {
        await openTestRolePicker('director');
        return;
    }

    if (!me || (!isSA && !['director','coordinator'].includes(activeRole))) {
        showToast('⚠️ No tienes permisos para acceder al panel de dirección.', 4000);
        return;
    }

    // FIX (v179): Resolver clubId del director/coordinador desde Firestore.
    // Si el campo raíz clubId del documento users/{uid} está vacío (solo existe
    // en allRoles), las reglas Firestore (userDocClubId) no pueden verificarlo.
    // _cResolveClubId migra clubId al campo raíz para que las reglas funcionen.
    try {
        if (typeof window._cResolveClubId === 'function' && me && me.uid && !me.clubId) {
            const { doc, getDoc } = await _sdFS();
            const db = window._cronos_auth?.db;
            if (db) {
                const resolvedId = await window._cResolveClubId(db, me, { doc, getDoc });
                if (resolvedId) {
                    me.clubId = resolvedId;
                }
            }
        }
    } catch(e) {
        if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[StaffDashboard] No se pudo resolver clubId:', e.message);
    }

    // Pila de navegación (js/core/nav-stack.js): RAÍZ del panel de Dirección
    // (lo comparten Director y Coordinador), registrada CON la pestaña activa.
    //
    // 🔑 POR QUÉ LA PESTAÑA VA EN LA RAÍZ Y NO ES UNA PANTALLA APARTE: aquí las
    // pestañas NO repintan el modal, sólo el div interno
    // #staff-dashboard-content, así que el marco del panel sobrevive. Si se
    // apilaran como pantallas propias, volver a una de ellas invocaría
    // switchStaffTab con el panel ya destruido y #staff-dashboard-content no
    // existiría. Guardando la pestaña como ARGUMENTO de la raíz, volver
    // reconstruye el panel entero y lo deja en la pestaña correcta.
    //
    // Como en openClubAdminPanel, el registro va después de varios `await`
    // porque antes no se conocen ni el rol ni el clubId. Es seguro por ser
    // RAÍZ (ver la nota del invariante async en superadmin.panel.js).
    const _tab = initialTab || 'convocatorias';
    if (typeof navRootScreen === 'function') navRootScreen('openStaffDashboard', _tab);

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,960px);max-height:94vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;background:#0d1117;">

        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:1.2rem 1.5rem;background:linear-gradient(to right,#161b22,#0d1117);
                    border-bottom:1px solid var(--glass-border);flex-shrink:0;">
            <div>
                <h2 style="margin:0;font-size:1.15rem;display:flex;align-items:center;gap:0.7rem;">
                    ${activeRole === 'coordinator' ? '🎯 Panel de Coordinación:' : '🏢 Panel de Dirección:'}
                    <span style="color:var(--primary);">${escapeHtml(me.clubName||'Mi Club')}</span>
                    ${isSA ? `<span style="font-size:0.65rem;background:rgba(255,215,0,0.12);
                        border:1px solid rgba(255,215,0,0.3);color:#ffd700;
                        padding:2px 7px;border-radius:5px;font-weight:700;">🧪 PRUEBA</span>` : ''}
                </h2>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">
                    ${activeRole === 'director' ? '📋 Director Deportivo' : '🎯 Coordinador'}
                    ${isSA ? ' · SuperAdmin en modo prueba' : ''}
                </div>
            </div>
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
                ${isSA ? `
                <button class="dev-role-btn" onclick="openTestRolePicker('director')"
                    style="display:inline-flex;padding:0.35rem 0.8rem;background:rgba(255,215,0,0.08);
                           border:1px solid rgba(255,215,0,0.3);border-radius:6px;
                           color:#ffd700;font-size:0.73rem;font-weight:700;cursor:pointer;">
                    🔄 Cambiar Club</button>` : ''}
                <!-- Recargar CONSERVANDO la pestaña activa: navReload repinta
                     la raíz con sus argumentos guardados. Antes llamaba a
                     openStaffDashboard() sin argumentos y devolvía siempre a
                     "Convocatorias", perdiendo la pestaña en la que estabas. -->
                <button onclick="if(typeof navReload==='function') navReload(); else openStaffDashboard();"
                    style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
                           color:var(--text-muted);padding:0.35rem 0.7rem;border-radius:6px;
                           cursor:pointer;font-size:0.74rem;font-weight:600;" title="Recargar panel">
                    🔄 Recargar</button>
                
                <button onclick="if(typeof logoutUser==='function')logoutUser();else if(typeof cerrarSesion==='function')cerrarSesion();"
                    style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);
                           color:#ff5858;padding:0.35rem 0.8rem;border-radius:6px;
                           cursor:pointer;font-size:0.74rem;font-weight:700;">
                    ⏻ Salir</button>
            </div>
        </div>

        <div style="display:flex;gap:0.2rem;padding:0.5rem 1.5rem;background:#161b22;
                    border-bottom:1px solid var(--glass-border);flex-shrink:0;overflow-x:auto;">
            <button onclick="switchStaffTab('convocatorias')" class="staff-tab active" id="tab-convocatorias">📋 Convoc.</button>
            <button onclick="switchStaffTab('entrenamientos')" class="staff-tab" id="tab-entrenamientos">🕒 Entreno.</button>
            <button onclick="switchStaffTab('asistencia')" class="staff-tab" id="tab-asistencia">✅ Asistencia</button>
            <button onclick="switchStaffTab('informes')" class="staff-tab" id="tab-informes">📊 Informes</button>
            <button onclick="switchStaffTab('mensajes')" class="staff-tab" id="tab-mensajes">💬 Mensajes</button>
            ${((window._cronosCurrentUser?.extras?.partidos_terminados ?? true) !== false)
                ? `<button onclick="switchStaffTab('partidos_terminados')" class="staff-tab" id="tab-partidos_terminados" style="color:#79c0ff;">🎬 Partidos Terminados</button>`
                : `<button onclick="switchStaffTab('partidos_terminados')" class="staff-tab" id="tab-partidos_terminados" style="color:#555;cursor:not-allowed;opacity:0.5;" title="Extra no activado">🔒 Partidos Terminados</button>`}
            ${_sdCanSeeConfigTab(me)
                ? `<button onclick="switchStaffTab('config')" class="staff-tab" id="tab-config">⚙️ Config.</button>`
                : ''}
            <button onclick="openLiveMatchesView()" class="staff-tab"
                style="color:#ff5858;border-left:1px solid rgba(255,255,255,0.1);margin-left:0.5rem;">
                🔴 En Vivo</button>
        </div>

        <div id="staff-dashboard-content"
             style="flex:1;overflow-y:auto;padding:1.5rem;background:#0d1117;">
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div class="spinner" style="margin:0 auto 1rem;"></div>
                Cargando…
            </div>
        </div>
    </div>

    <style>
        .staff-tab {
            padding:0.55rem 1.1rem;background:none;border:none;
            border-bottom:2px solid transparent;color:var(--text-muted);
            font-size:0.82rem;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 0.2s;
        }
        .staff-tab:hover { color:white;background:rgba(255,255,255,0.03); }
        .staff-tab.active { color:var(--primary);border-bottom-color:var(--primary);background:rgba(88,166,255,0.05); }
        .sd-card {
            background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
            border-radius:12px;padding:1rem;margin-bottom:0.9rem;
            display:flex;justify-content:space-between;align-items:center;gap:1rem;
            transition:border-color 0.2s;
        }
        .sd-card:hover { border-color:rgba(88,166,255,0.3); }
        .sd-badge {
            font-size:0.65rem;font-weight:700;padding:2px 8px;
            border-radius:5px;text-transform:uppercase;
        }
        .sd-report-card {
            background:rgba(255,255,255,0.03);border:1px solid rgba(88,166,255,0.15);
            border-radius:12px;padding:1rem 1.2rem;margin-bottom:0.7rem;cursor:pointer;
            transition:all 0.2s;
        }
        .sd-report-card:hover { border-color:rgba(88,166,255,0.4);background:rgba(88,166,255,0.05); }
        .sd-report-unread { border-color:rgba(255,165,0,0.5);background:rgba(255,165,0,0.04); }
    </style>`;

    switchStaffTab(_tab);
}

// ── Cambiar tab ──────────────────────────────────────────────────────
window.switchStaffTab = async (tab) => {
    // Pila de navegación: la pestaña activa se guarda como ARGUMENTO de la
    // raíz, no como una pantalla propia (ver la nota en openStaffDashboard).
    // Reiniciar la raíz aquí es seguro: switchStaffTab sólo puede ejecutarse
    // con el panel visible, o sea cuando la raíz ya es la cima de la pila.
    if (typeof navRootScreen === 'function') navRootScreen('openStaffDashboard', tab);

    document.querySelectorAll('.staff-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`tab-${tab}`);
    if (btn) btn.classList.add('active');

    const container = document.getElementById('staff-dashboard-content');
    container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">⏳ Cargando…</div>`;

    if (tab === 'convocatorias')  await _sdLoadEvents('convocatoria');
    if (tab === 'entrenamientos') await _sdLoadEvents('planificacion_semanal');
    if (tab === 'asistencia')     await _sdLoadAsistencia();
    if (tab === 'informes')       await _sdLoadReports();
    if (tab === 'mensajes')       await _sdLoadMessages();
    if (tab === 'partidos_terminados') {
        const _ptExtras = (window._cronosCurrentUser?.extras) || {};
        if (_ptExtras.partidos_terminados === false) {
            const _ptCont = document.getElementById('staff-dashboard-content');
            if (_ptCont) _ptCont.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem 2rem;text-align:center;gap:1rem;">
                    <div style="font-size:3.5rem;">🔒</div>
                    <div style="font-size:1.1rem;font-weight:700;color:white;">Partidos Terminados no disponible</div>
                    <div style="font-size:0.85rem;color:#8b949e;max-width:320px;">Este extra no está activado para tu club. Contacta con el administrador para habilitarlo.</div>
                </div>`;
        } else {
            await _renderFinishedMatchesTab();
        }
    }
    if (tab === 'config') {
        // ⚠️ SEGUNDA PUERTA, y la que de verdad cierra el acceso: ocultar el
        // boton no impide llamar a switchStaffTab('config') desde la consola.
        if (!_sdCanSeeConfigTab()) {
            container.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem 2rem;text-align:center;gap:1rem;">
                    <div style="font-size:3.5rem;">🔒</div>
                    <div style="font-size:1.1rem;font-weight:700;color:white;">Configuración no disponible</div>
                    <div style="font-size:0.85rem;color:#8b949e;max-width:340px;">La configuración del club es competencia del Director Deportivo. Contacta con él si necesitas cambiar algo.</div>
                </div>`;
            return;
        }
        await _renderDirectorConfig();
    }
};

// ════════════════════════════════════════════════════════════════════
//  TAB: PARTIDOS TERMINADOS
//  (_renderFinishedMatchesTab)
//  Extraída a js/coach/reports/finished-matches-tab.js (auditoría 2026-07-22,
//  2026-07-26). Entradas: switchStaffTab('partidos_terminados') y
//  deleteFinishedMatchFromCloud (app-init.js) — ciclo entre ficheros.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  TAB: CONVOCATORIAS / ENTRENAMIENTOS
//  (_sdLoadEvents, con sdViewEventDetail y sdDeleteNotif anidados dentro)
//  Extraídas a js/coach/reports/events-tab.js (auditoría 2026-07-22,
//  2026-07-26). Entrada: switchStaffTab('convocatorias'|'entrenamientos').
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  MOTOR DE INFORMES VISUAL v1.0  (_RP)
//  Extraído a js/coach/reports/report-engine.js (auditoría 2026-07-22,
//  2026-07-26). Se carga ANTES de este archivo en index.html (a propósito:
//  ver la cabecera de report-engine.js). Aquí sólo se CONSUME, vía
//  _RP.build(); no volver a declarar `const _RP` o este archivo dejaría de
//  cargarse por SyntaxError.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  TAB: INFORMES DE PARTIDO (renderizado visual lazy)
//  (_sdLoadReports, con sdToggleReport / sdDeleteReport / _sdMatchData
//   anidados dentro)
//  Extraída a js/coach/reports/reports-tab.js (auditoría 2026-07-22,
//  2026-07-26). Entrada: switchStaffTab('informes').
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  TAB: MENSAJES (vista Director Deportivo / Coordinador)
// ════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
//  ASISTENCIA DE TODO EL CLUB (Director / Coordinador)
// ══════════════════════════════════════════════════════════════════
//  Organizada por el ÁRBOL DE CATEGORÍAS, igual que Convocatorias,
//  Entrenamientos e Informes, y con un indicador de actividad de HOY por
//  equipo (verde = tiene sesión hoy · rojo = descansa).
//
//  🔑 LEE LA COLECCIÓN ENTERA DE UN MES, no equipo por equipo. Los
//  documentos se llaman {teamId}__{YYYY-MM}, así que basta con filtrar por
//  el campo `month`: una sola consulta para el club completo.
//
//  🔑🔑 LOS EQUIPOS NO SALEN SÓLO DE LA ASISTENCIA. Un equipo que hoy
//  entrena pero al que aún no le han pasado lista NO tiene documento de
//  asistencia, y es justo el que el director quiere ver. La lista de
//  equipos es la UNIÓN de tres fuentes: los partes de asistencia del mes,
//  el cuadrante de la semana y las plantillas publicadas. Construirla sólo
//  con la primera dejaría fuera precisamente lo que se pregunta.
//
//  🔑 "HOY ENTRENA" SALE DEL CUADRANTE, no del parte de asistencia: el
//  parte sólo existe cuando alguien ya ha marcado. Se lee el documento de
//  la semana ENTERO (trainingPlans/{club}/weeks/{lunes}), que desde el
//  arreglo del cuadrante trae los días de cada equipo en `teams.<teamId>`.
//
//  ⚠️ NO SE PINTAN LOS NOMBRES DE LOS JUGADORES NI SUS MOTIVOS aquí. Esta
//  pantalla es de seguimiento agregado; el detalle con las causas —que es
//  dato personal de un menor— se queda en la pantalla del entrenador.
window._sdAsistMes = null;

// teamId = '{club}__{categoria}__{subcategoria}'. Los tres tramos los genera
// cronosTeamSlug, que colapsa todo lo que no sea [a-z0-9] en guiones: ningún
// tramo puede contener '__', así que partir por ahí es seguro.
function _sdPartirTeamId(teamId) {
    const t = String(teamId || '').split('__');
    if (t.length < 3) return null;
    return { club: t[0], cat: t[1], sub: t[2] };
}

window._sdCambiarMesAsist = async function (delta) {
    var y = parseInt(window._sdAsistMes.slice(0, 4), 10);
    var m = parseInt(window._sdAsistMes.slice(5, 7), 10) + delta;
    var d = new Date(y, m - 1, 1, 12, 0, 0);
    window._sdAsistMes = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    await _sdLoadAsistencia();
};

async function _sdLoadAsistencia() {
    const container = document.getElementById('staff-dashboard-content');
    if (!container) return;
    const me = window._cronosCurrentUser;
    const clubId = window._testRoleClubId || me?.clubId || '';
    const ea = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : s) : String(s == null ? '' : s);

    if (!window._sdAsistMes) {
        const hoy = new Date();
        window._sdAsistMes = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
    }
    const mes = window._sdAsistMes;

    // ── 1. Partes de asistencia del mes ─────────────────────────────
    let docs = [];
    try {
        const { db, collection, getDocs, query, where } = await _sdFS();
        const snap = await getDocs(query(
            collection(db, 'clubs', clubId, 'attendance'),
            where('month', '==', mes)));
        snap.forEach(d => docs.push(d.data() || {}));
    } catch (e) {
        console.warn('[Dirección] asistencia:', e);
        container.innerHTML = '<div style="text-align:center;padding:3rem;color:#f0883e;">' +
            '⚠️ No se ha podido cargar la asistencia del club.</div>';
        return;
    }

    // ── 2. Cuadrante de ESTA semana: quién tiene sesión hoy ─────────
    // ⚠️ Sólo tiene sentido preguntarlo cuando se está mirando el mes en
    // curso. En un mes pasado "hoy" no significa nada y el indicador se
    // apaga en vez de mentir.
    const hoyKey = window._cronosLocalDateKey(new Date());
    const esMesActual = hoyKey.slice(0, 7) === mes;
    let sesionHoy = {};          // teamId -> { tipo, hora, lugar }
    if (esMesActual) {
        try {
            const { db, doc, getDoc } = await _sdFS();
            // El lunes se calcula aquí y no se toma de CronosAttendance: esta
            // pestaña no puede quedarse sin indicador porque otro módulo no
            // haya cargado. Domingo es 0 y cuenta como el FINAL de la semana,
            // igual que en la Planificación Semanal.
            const hoy = new Date();
            const lunes = new Date(hoy);
            lunes.setDate(hoy.getDate() - (hoy.getDay() === 0 ? 6 : hoy.getDay() - 1));
            lunes.setHours(0, 0, 0, 0);

            const wk = window._cronosLocalDateKey(lunes);
            const snap = await getDoc(doc(db, 'trainingPlans', clubId, 'weeks', wk));
            if (snap.exists()) {
                const v = snap.data() || {};
                const porEquipo = v.teams || {};
                Object.keys(porEquipo).forEach(tid => {
                    const dd = (porEquipo[tid] || {})[hoyKey];
                    if (dd && dd.tipo) {
                        sesionHoy[tid] = { tipo: String(dd.tipo), hora: dd.hora || '', lugar: dd.lugar || '' };
                    }
                });
            }
        } catch (e) {
            console.warn('[Dirección] cuadrante de la semana:', e);
        }
    }

    // ── 3. Plantillas publicadas: equipos que existen aunque no hayan
    //       pasado lista ni planificado nada esta semana ─────────────
    let plantillas = {};
    try {
        if (typeof window.cronosFetchAllTeamRosters === 'function') {
            plantillas = await window.cronosFetchAllTeamRosters(clubId) || {};
        }
    } catch (e) { plantillas = {}; }

    // ── 4. Unión de las tres fuentes ────────────────────────────────
    const equipos = new Map();   // teamId -> { teamId, cat, sub, doc, hoy }
    const anota = (teamId, cat, sub) => {
        if (!teamId) return;
        if (equipos.has(teamId)) return;
        const c = (typeof window.ctNormCat === 'function') ? window.ctNormCat(cat || '') : String(cat || '');
        const s = (typeof window.ctNormSubcat === 'function') ? window.ctNormSubcat(sub || '') : String(sub || '');
        equipos.set(teamId, { teamId, cat: c, sub: s, doc: null, hoy: null });
    };

    docs.forEach(d => anota(d.teamId, d.category, d.subcategory));
    Object.keys(sesionHoy).forEach(tid => {
        const p = _sdPartirTeamId(tid);
        if (p) anota(tid, p.cat, p.sub);
    });
    Object.keys(plantillas).forEach(clave => {
        const [c, s] = clave.split('|');
        // El teamId se reconstruye con la MISMA función que lo generó, para
        // que case con el de los partes y el del cuadrante.
        const tid = (typeof window.cronosTeamId === 'function') ? window.cronosTeamId(clubId, c, s) : '';
        if (tid) anota(tid, c, s);
    });

    docs.forEach(d => { const e = equipos.get(d.teamId); if (e) e.doc = d; });
    Object.keys(sesionHoy).forEach(tid => { const e = equipos.get(tid); if (e) e.hoy = sesionHoy[tid]; });

    // ── 5. Recuentos por equipo ─────────────────────────────────────
    const resumen = (e) => {
        const d = e.doc || {};
        const marks = d.marks || {};
        const sesiones = Object.keys(d.sessions || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
        let P = 0, I = 0, J = 0, hoyP = 0, hoyMarcados = 0;
        Object.keys(marks).forEach(fecha => {
            const dia = marks[fecha] || {};
            Object.keys(dia).forEach(f => {
                const s = dia[f] && dia[f].s;
                if (s === 'P') P++; else if (s === 'I') I++; else if (s === 'J') J++;
                if (fecha === hoyKey && s) {
                    hoyMarcados++;
                    if (s === 'P') hoyP++;
                }
            });
        });
        const tot = P + I + J;
        return { sesiones: sesiones.length, P, I, J, tot,
                 pct: tot ? Math.round(P / tot * 100) : null,
                 hoyP, hoyMarcados };
    };

    const nombreMes = new Date(parseInt(mes.slice(0, 4), 10), parseInt(mes.slice(5, 7), 10) - 1, 1)
        .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    let html = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.6rem;margin-bottom:1rem;">' +
        '<div><div style="font-size:1rem;font-weight:700;color:white;">✅ Asistencia del club</div>' +
        '<div style="font-size:0.72rem;color:var(--text-muted);">Por categorías · sesiones del cuadrante semanal</div></div>' +
        '<div style="display:flex;gap:0.4rem;align-items:center;">' +
          '<button class="btn" onclick="_sdCambiarMesAsist(-1)" style="padding:0.3rem 0.6rem;font-size:0.85rem;">◀</button>' +
          '<span style="font-size:0.82rem;font-weight:700;color:white;min-width:150px;text-align:center;text-transform:capitalize;">' + ea(nombreMes) + '</span>' +
          '<button class="btn" onclick="_sdCambiarMesAsist(1)" style="padding:0.3rem 0.6rem;font-size:0.85rem;">▶</button>' +
        '</div></div>';

    if (!equipos.size) {
        html += '<div style="text-align:center;padding:3.5rem 1rem;color:var(--text-muted);line-height:1.8;">' +
                '<div style="font-size:2.5rem;margin-bottom:0.5rem;">🗓️</div>' +
                'Todavía no hay ningún equipo con actividad registrada.<br>' +
                '<span style="font-size:0.8rem;">Los entrenadores pasan lista desde <strong>Gestionar Plantilla → ✅ ASISTENCIA</strong>.</span></div>';
        container.innerHTML = html;
        return;
    }

    const lista = Array.from(equipos.values());

    // ── 6. Tira de HOY, para verlo sin desplegar nada ───────────────
    if (esMesActual) {
        const conHoy = lista.filter(e => !!e.hoy);
        const sinHoy = lista.filter(e => !e.hoy);
        const fechaLarga = new Date().toLocaleDateString('es-ES',
            { weekday: 'long', day: 'numeric', month: 'long' });

        html += '<div style="border:1px solid var(--glass-border);border-radius:12px;padding:0.9rem 1rem;margin-bottom:1rem;background:rgba(255,255,255,0.02);">' +
          '<div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);margin-bottom:0.6rem;text-transform:capitalize;">📆 HOY · ' + ea(fechaLarga) + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">';

        const chip = (texto, titulo, colFondo, colBorde, colTexto) =>
            '<span title="' + ea(titulo) + '" style="font-size:0.72rem;font-weight:700;padding:0.28rem 0.6rem;' +
            'border-radius:20px;background:' + colFondo + ';border:1px solid ' + colBorde + ';color:' + colTexto + ';">' +
            ea(texto) + '</span>';

        conHoy.forEach(e => {
            const r = resumen(e);
            const etiq = _sdEtiquetaEquipo(e);
            const esPartido = String(e.hoy.tipo).toLowerCase().indexOf('partido') === 0;
            const icono = esPartido ? '⚽' : '🏃';
            // Verde: hay sesión hoy. Si además ya se pasó lista, se dice
            // cuántos fueron; si no, se avisa de que está pendiente.
            const cola = r.hoyMarcados
                ? ' · ' + r.hoyP + '/' + r.hoyMarcados
                : ' · sin pasar lista';
            html += chip(icono + ' ' + etiq + cola,
                e.hoy.tipo + (e.hoy.hora ? ' a las ' + e.hoy.hora : '') +
                (e.hoy.lugar ? ' · ' + e.hoy.lugar : '') +
                (r.hoyMarcados ? ' · ' + r.hoyP + ' de ' + r.hoyMarcados + ' presentes' : ' · lista sin pasar'),
                'rgba(63,185,80,0.14)', 'rgba(63,185,80,0.45)', '#3fb950');
        });

        sinHoy.forEach(e => {
            html += chip('💤 ' + _sdEtiquetaEquipo(e), 'Sin sesión programada hoy',
                'rgba(255,88,88,0.10)', 'rgba(255,88,88,0.35)', '#ff5858');
        });

        html += '</div>' +
          '<div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.6rem;">' +
            '<strong style="color:#3fb950;">' + conHoy.length + '</strong> con sesión hoy · ' +
            '<strong style="color:#ff5858;">' + sinHoy.length + '</strong> descansan' +
          '</div></div>';
    }

    // ── 7. El árbol ─────────────────────────────────────────────────
    // ⚠️ Mismo respaldo que las demás pestañas: si el módulo del árbol no
    // estuviera cargado, esto degrada a la lista plana en vez de dejar la
    // pestaña en blanco.
    const usaArbol = typeof window.ctRenderTree === 'function' &&
                     typeof window.ctNormCat === 'function';

    if (usaArbol) {
        html += window.ctRenderTree({
            items:  lista,
            getCat: (e) => e.cat,
            getSub: (e) => e.sub,
            renderLeaf: (e) => _sdFilaAsistencia(e, resumen(e), esMesActual),
            // El indicador va en la CABECERA porque las ramas nacen plegadas.
            renderSubBadge: (arr) => {
                if (!esMesActual || !arr.length) return '';
                const conSesion = arr.filter(e => !!e.hoy);
                if (!conSesion.length) {
                    return '<span title="Sin sesión hoy" style="font-size:0.62rem;font-weight:700;padding:1px 7px;' +
                           'border-radius:20px;background:rgba(255,88,88,0.12);color:#ff5858;' +
                           'border:1px solid rgba(255,88,88,0.3);">💤 HOY NO</span>';
                }
                const r = resumen(conSesion[0]);
                const txt = r.hoyMarcados ? r.hoyP + '/' + r.hoyMarcados : 'pendiente';
                return '<span title="Tiene sesión hoy" style="font-size:0.62rem;font-weight:700;padding:1px 7px;' +
                       'border-radius:20px;background:rgba(63,185,80,0.16);color:#3fb950;' +
                       'border:1px solid rgba(63,185,80,0.4);">🟢 HOY ' + ea(txt) + '</span>';
            },
            renderCatBadge: (catId, n, subMap) => {
                if (!esMesActual || !n) return '';
                let conSesion = 0;
                subMap.forEach(arr => { arr.forEach(e => { if (e.hoy) conSesion++; }); });
                if (!conSesion) return '';
                return '<span title="Equipos con sesión hoy en esta categoría" style="font-size:0.62rem;' +
                       'font-weight:700;padding:1px 7px;border-radius:20px;background:rgba(63,185,80,0.16);' +
                       'color:#3fb950;border:1px solid rgba(63,185,80,0.4);">🟢 ' + conSesion + ' hoy</span>';
            },
            emptyText: 'El club no tiene equipo en esta subcategoría.',
        });
    } else {
        lista.forEach(e => { html += _sdFilaAsistencia(e, resumen(e), esMesActual); });
    }

    container.innerHTML = html;
}

// Etiqueta legible del equipo, con la misma función que usa el resto del
// proyecto para no inventar un mapa de nombres más.
function _sdEtiquetaEquipo(e) {
    if (typeof window._cronosTeamRosterLabel === 'function') {
        const l = window._cronosTeamRosterLabel(e.cat, e.sub);
        if (l) return l;
    }
    return String(e.cat || '') + ' ' + String(e.sub || '').toUpperCase();
}

// Ficha de un equipo dentro de su rama del árbol.
function _sdFilaAsistencia(e, r, esMesActual) {
    const ea = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : s) : String(s == null ? '' : s);
    const col = r.pct == null ? 'var(--text-muted)' : (r.pct >= 80 ? '#3fb950' : (r.pct >= 60 ? '#f0883e' : '#ff5858'));

    let cabecera = '';
    if (esMesActual) {
        cabecera = e.hoy
            ? '<div style="font-size:0.7rem;font-weight:700;color:#3fb950;margin-bottom:0.4rem;">🟢 HOY · ' +
              ea(e.hoy.tipo) + (e.hoy.hora ? ' · ' + ea(e.hoy.hora) : '') +
              (e.hoy.lugar ? ' · ' + ea(e.hoy.lugar) : '') +
              (r.hoyMarcados ? ' — ' + r.hoyP + ' de ' + r.hoyMarcados + ' presentes'
                             : ' — <span style="color:#f0883e;">lista sin pasar</span>') + '</div>'
            : '<div style="font-size:0.7rem;font-weight:700;color:#ff5858;margin-bottom:0.4rem;">💤 HOY sin sesión programada</div>';
    }

    const celda = (etiq, valor, color) =>
        '<div style="text-align:center;"><div style="font-size:1.05rem;font-weight:700;color:' + color + ';">' +
        valor + '</div><div style="font-size:0.6rem;color:var(--text-muted);">' + etiq + '</div></div>';

    return '<div style="border:1px solid var(--glass-border);border-radius:10px;padding:0.7rem 0.9rem;margin-bottom:0.5rem;background:rgba(255,255,255,0.02);">' +
        cabecera +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.8rem;flex-wrap:wrap;">' +
          '<div style="font-weight:700;font-size:0.85rem;">' + ea(_sdEtiquetaEquipo(e)) + '</div>' +
          '<div style="display:flex;gap:1.1rem;flex-wrap:wrap;">' +
            celda('SESIONES', r.sesiones, 'var(--text)') +
            celda('ASIST.', r.P, '#3fb950') +
            celda('INJUST.', r.I, '#ff5858') +
            celda('JUSTIF.', r.J, '#f0883e') +
            celda('MEDIA', (r.pct == null ? '—' : r.pct + '%'), col) +
          '</div>' +
        '</div>' +
      '</div>';
}

async function _sdLoadMessages() {
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    const role = me?._activeRole || me?.role || 'director';

    if (role === 'director' && typeof openDirectorMessaging === 'function') {
        await openDirectorMessaging('coordinators', 'staff-dashboard-content');
    } else if (role === 'coordinator' && typeof openCoordinatorMessaging === 'function') {
        await openCoordinatorMessaging('director', 'staff-dashboard-content');
    } else if (typeof openCoachMessaging === 'function') {
        await openCoachMessaging('parents', 'staff-dashboard-content');
    }
}

window.openLiveMatchesView = () => {
    window.open('./live.html', '_blank');
};

window.openStaffDashboard = openStaffDashboard;
// ════════════════════════════════════════════════════════════════════
//  TAB: CONFIGURACIÓN DEL CLUB (Director)
//  (_renderDirectorConfig / _dirSaveCategoryConfigs)
//  Extraídas a js/coach/reports/director-config.js (auditoría 2026-07-22,
//  2026-07-26). Punto de entrada: switchStaffTab('config').
// ════════════════════════════════════════════════════════════════════

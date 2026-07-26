// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Staff Dashboard (Director / Coordinador) v3.0
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
            <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
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
async function openStaffDashboard() {
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
                <button onclick="openStaffDashboard()"
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
            <button onclick="switchStaffTab('informes')" class="staff-tab" id="tab-informes">📊 Informes</button>
            <button onclick="switchStaffTab('mensajes')" class="staff-tab" id="tab-mensajes">💬 Mensajes</button>
            ${((window._cronosCurrentUser?.extras?.partidos_terminados ?? true) !== false)
                ? `<button onclick="switchStaffTab('partidos_terminados')" class="staff-tab" id="tab-partidos_terminados" style="color:#79c0ff;">🎬 Partidos Terminados</button>`
                : `<button onclick="switchStaffTab('partidos_terminados')" class="staff-tab" id="tab-partidos_terminados" style="color:#555;cursor:not-allowed;opacity:0.5;" title="Extra no activado">🔒 Partidos Terminados</button>`}
            <button onclick="switchStaffTab('config')" class="staff-tab" id="tab-config">⚙️ Config.</button>
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

    switchStaffTab('convocatorias');
}

// ── Cambiar tab ──────────────────────────────────────────────────────
window.switchStaffTab = async (tab) => {
    document.querySelectorAll('.staff-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`tab-${tab}`);
    if (btn) btn.classList.add('active');

    const container = document.getElementById('staff-dashboard-content');
    container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">⏳ Cargando…</div>`;

    if (tab === 'convocatorias')  await _sdLoadEvents('convocatoria');
    if (tab === 'entrenamientos') await _sdLoadEvents('planificacion_semanal');
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
    if (tab === 'config')         await _renderDirectorConfig();
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
// ════════════════════════════════════════════════════════════════════
async function _sdLoadReports() {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');

    // FIX (v179): Intentar resolver clubId si no está disponible.
    // Esto cubre el caso donde openStaffDashboard no pudo resolverlo
    // (p.ej. _cResolveClubId no estaba disponible aún).
    let clubId = me.clubId;
    if (!clubId && me && me.uid && typeof window._cResolveClubId === 'function') {
        try {
            const { doc, getDoc } = await _sdFS();
            const db = window._cronos_auth?.db;
            if (db) {
                clubId = await window._cResolveClubId(db, me, { doc, getDoc });
                if (clubId) me.clubId = clubId;
            }
        } catch(e) {
            if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][_sdLoadReports] clubId resolution falló:', e.message);
        }
    }

    if (!clubId) {
        container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">
            ⚠️ Sin club asignado. Usa el modo prueba para seleccionar un club.</div>`;
        return;
    }

    try {
        const { db, collection, getDocs, query, where, orderBy, limit, doc, getDoc } = await _sdFS();

        // FIX (v179): Query multi-clubId para acceder a informes de staff.
        // PROBLEMA IDENTIFICADO: El clubId del entrenador y el del director
        // pueden ser DIFERENTES si hay inconsistencias en los documentos users/{uid}.
        // El entrenador escribe informes con SU clubId, el director busca con SU clubId
        // → nunca coinciden.
        // SOLUCIÓN: Descubrir TODOS los clubIds del club consultando la colección
        // 'clubs' y los documentos de entrenadores, y hacer queries por cada uno.

        // FIX (v179): Recopilar clubIds alternativos del mismo club.
        // PROBLEMA: El clubId del entrenador y el del director pueden ser
        // DIFERENTES (p.ej. club_mq1hzm6o_1j6j vs club_mqlhzm6o_ij6j)
        // porque el campo se asignó de forma inconsistente.
        // ESTRATEGIA:
        // 1. Leer allRoles del director → obtener todos sus clubIds
        // 2. Para cada clubId encontrado, buscar usuarios con ese clubId
        // 3. Recopilar TODOS los clubIds de todos esos usuarios (incluidos los de allRoles)
        // 4. Consultar informes por cada clubId encontrado
        const _allClubIds = new Set([clubId]);

        // Paso 1: Leer allRoles del propio director
        try {
            const myDoc = await getDoc(doc(db, 'users', me.uid));
            if (myDoc.exists()) {
                const myData = myDoc.data();
                // ClubId raíz
                if (myData.clubId) _allClubIds.add(myData.clubId);
                // ClubIds de allRoles
                if (myData.allRoles && Array.isArray(myData.allRoles)) {
                    myData.allRoles.forEach(r => {
                        if (r.clubId) _allClubIds.add(r.clubId);
                    });
                }
            }
        } catch(_) {}

        // Paso 2: Para cada clubId, buscar usuarios y recopilar SUS clubIds
        const _initialClubIds = [..._allClubIds];
        for (const cid of _initialClubIds) {
            try {
                const usersSnap = await getDocs(query(
                    collection(db, 'users'),
                    where('clubId', '==', cid),
                    limit(200)
                ));
                usersSnap.forEach(d => {
                    const data = d.data();
                    if (data.clubId) _allClubIds.add(data.clubId);
                    if (data.allRoles && Array.isArray(data.allRoles)) {
                        data.allRoles.forEach(r => {
                            if (r.clubId) _allClubIds.add(r.clubId);
                        });
                    }
                });
            } catch(e) {
                if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] No se pudieron buscar usuarios con clubId', cid, ':', e.code || e.message);
            }
        }

        // Paso 3 (FIX v179): Buscar por email del propio director para encontrar
        // otros documentos de usuario con el mismo email (caso multi-rol donde
        // el mismo email tiene clubIds diferentes). Esto cubre el caso donde
        // el director y entrenador comparten email pero tienen clubIds distintos.
        try {
            if (me.email) {
                const emailSnap = await getDocs(query(
                    collection(db, 'users'),
                    where('email', '==', me.email),
                    limit(10)
                ));
                emailSnap.forEach(d => {
                    const data = d.data();
                    if (data.clubId) _allClubIds.add(data.clubId);
                    if (data.allRoles && Array.isArray(data.allRoles)) {
                        data.allRoles.forEach(r => {
                            if (r.clubId) _allClubIds.add(r.clubId);
                        });
                    }
                });
            }
        } catch(e) {
            if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] Búsqueda por email falló:', e.code || e.message);
        }


        // FIX (v179): Consultar por TODOS los clubIds encontrados
        const combinedDocs = [];
        const seenIds = new Set();
        let _clubQueryOk = false;

        for (const cid of _allClubIds) {
            // FIX (limit-500): el club puede tener MILES de docs (informes de
            // staff + coach + padres de muchos partidos). La query antigua
            //   where(clubId==cid).limit(500)
            // traía 500 docs SIN orden, que se llenaban con _coach_pN / _parent_*
            // y partidos antiguos; tras el filtro cliente staffReport===true al
            // director le quedaban muy pocos (o 1) partido visible. Ahora la query
            // PRIMARIA filtra ya por staffReport==true y ordena por createdAt desc,
            // así el limit se gasta SOLO en docs útiles del panel de staff.
            // Requiere el índice compuesto (clubId, staffReport, createdAt desc).
            // Si el índice aún no está desplegado (failed-precondition), se hace
            // fallback a la query antigua sin orderBy para no romper nada.
            try {
                const snap = await getDocs(query(
                    collection(db, 'cronos_player_reports'),
                    where('clubId', '==', cid),
                    where('staffReport', '==', true),
                    orderBy('createdAt', 'desc'),
                    limit(500)
                ));
                _clubQueryOk = true;
                snap.forEach(d => {
                    if (!seenIds.has(d.id)) {
                        seenIds.add(d.id);
                        combinedDocs.push(d);
                    }
                });
            } catch (clubErr) {
                const _code = clubErr.code || clubErr.message || '';
                if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] Query staff por clubId', cid, 'FALLÓ:', _code, '— intentando fallback sin orderBy');
                // Fallback A: misma query sin orderBy (cubre el caso de índice no
                // desplegado; sigue filtrando por staffReport para no saturar limit).
                try {
                    const snapA = await getDocs(query(
                        collection(db, 'cronos_player_reports'),
                        where('clubId', '==', cid),
                        where('staffReport', '==', true),
                        limit(500)
                    ));
                    _clubQueryOk = true;
                    snapA.forEach(d => {
                        if (!seenIds.has(d.id)) { seenIds.add(d.id); combinedDocs.push(d); }
                    });
                } catch (clubErr2) {
                    // Fallback B: query original (sin filtro staffReport). Último
                    // recurso para clubs pequeños / reglas que no permitan el filtro.
                    if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] Fallback staff también falló:', clubErr2.code || clubErr2.message, '— usando query legacy');
                    try {
                        const snapB = await getDocs(query(
                            collection(db, 'cronos_player_reports'),
                            where('clubId', '==', cid),
                            limit(500)
                        ));
                        _clubQueryOk = true;
                        snapB.forEach(d => {
                            if (!seenIds.has(d.id)) { seenIds.add(d.id); combinedDocs.push(d); }
                        });
                    } catch (clubErr3) {
                        if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] Query legacy por clubId', cid, 'FALLÓ:', clubErr3.code || clubErr3.message);
                    }
                }
            }
        }

        let rawSnap = { forEach: (fn) => combinedDocs.forEach(fn) };

        // Contar docs de staff
        let _clubQueryDocCount = 0;
        let _hasStaffDocs = false;
        let _staffDocCount = 0;
        rawSnap.forEach(d => {
            _clubQueryDocCount++;
            if (d.data().staffReport === true) { _hasStaffDocs = true; _staffDocCount++; }
        });

        // Si aún no hay docs de staff, intentar por staffUids
        if ((!_hasStaffDocs || !_clubQueryOk) && me.uid) {
            try {
                const altSnap = await getDocs(query(
                    collection(db, 'cronos_player_reports'),
                    where('staffUids', 'array-contains', me.uid),
                    limit(500)
                ));
                let _altCount = 0;
                altSnap.forEach(d => _altCount++);
                // Fusionar resultados alternativos con los originales
                const existingIds = new Set();
                rawSnap.forEach(d => existingIds.add(d.id));
                altSnap.forEach(d => {
                    if (!existingIds.has(d.id) && d.data().staffReport === true) {
                        // Añadir docs que no estaban en el snap original
                        _hasStaffDocs = true;
                    }
                });
                // Usar el snap alternativo si tiene resultados de staff
                if (_hasStaffDocs) {
                    // Combinar ambos snaps
                    const combinedDocs = [];
                    rawSnap.forEach(d => combinedDocs.push(d));
                    const existingIds2 = new Set(combinedDocs.map(d => d.id));
                    altSnap.forEach(d => {
                        if (!existingIds2.has(d.id)) combinedDocs.push(d);
                    });
                    rawSnap = { forEach: fn => combinedDocs.forEach(fn) };
                }
            } catch(altErr) {
                console.warn('[StaffDashboard] Query alternativa por staffUids falló:', altErr.message);
            }
        }

        // Filtrar en cliente: solo documentos del panel de staff (staffReport=true)
        // FIX v3: Solo usar dismissKey con rol (uid_role) para el filtro.
        // Así Director y Coordinador pueden borrar de forma INDEPENDIENTE:
        // el borrado del Director añade "uid_director" y el del Coordinador
        // añade "uid_coordinador". Cada uno solo ve su propia clave.
        // IMPORTANTE: NO filtrar por me.uid a secas porque si dos roles
        // comparten el mismo uid (o versiones antiguas lo guardaron sin rol)
        // se borraría para ambos.
        const currentRole = me.currentRole || me.role || 'staff';
        const dismissKey = `${me.uid}_${currentRole}`;

        const snap = { empty: true, forEach: (fn) => {
            rawSnap.forEach(d => {
                const data = d.data();
                const dismissed = data.dismissedBy || [];
                // Solo excluir si contiene la clave específica de rol de este usuario
                if (data.staffReport === true && !dismissed.includes(dismissKey)) fn(d);
            });
        }};
        // Recalcular si está vacío
        let _snapHasDocs = false;
        rawSnap.forEach(d => {
            const data = d.data();
            const dismissed = data.dismissedBy || [];
            if (data.staffReport === true && !dismissed.includes(dismissKey)) _snapHasDocs = true;
        });
        Object.defineProperty(snap, 'empty', { get: () => !_snapHasDocs });

        if (snap.empty) {
            container.innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:1rem;">📊</div>
                <div style="font-size:0.95rem;font-weight:600;margin-bottom:0.4rem;">Sin informes de partido aún</div>
                <div style="font-size:0.8rem;">Los informes aparecen aquí cuando un entrenador finaliza un partido
                    y pulsa <strong>"Enviar Informe"</strong> en la app.</div>
            </div>`;
            return;
        }

        // ── Agrupar documentos por partido (fecha + rival + coach) ───
        const matches = {};
        snap.forEach(docSnap => {
            const r   = { _id: docSnap.id, ...docSnap.data() };
            const key = `${r.matchDate || 'sin-fecha'}_${r.rival || 'sin-rival'}_${r.coachUid || ''}`;
            if (!matches[key]) {
                matches[key] = {
                    key,
                    matchId:       r.matchId || r._id || '',
                    matchDate:     r.matchDate,
                    rival:         r.rival,
                    scoreHome:     r.scoreHome,
                    scoreAway:     r.scoreAway,
                    myTeamRole:    r.myTeamRole,   // FIX: propagar rol del equipo para el cálculo V/D/E correcto (visitante)
                    coachEmail:    r.coachEmail,
                    coachUid:      r.coachUid,
                    createdAt:     r.createdAt,
                    // Campos opcionales (enriquecen la cabecera)
                    category:      r.category,
                    venue:         r.venue,
                    competition:   r.competition,
                    matchTime:     r.matchTime,
                    duration:      r.duration,
                    stoppageTime:  r.stoppageTime,
                    players:       [],
                };
            }
            matches[key].players.push(r);
            // FIX: si el objeto agrupado aún no tiene myTeamRole pero este doc sí,
            // adoptarlo (algunos docs antiguos del mismo partido pueden no llevarlo).
            if (matches[key].myTeamRole == null && r.myTeamRole != null) {
                matches[key].myTeamRole = r.myTeamRole;
            }
        });

        // Ordenar por fecha descendente
        const sorted = Object.values(matches).sort((a, b) =>
            (b.createdAt || '').localeCompare(a.createdAt || ''));

        // Mapa global de datos de partido para renderizado lazy
        window._sdMatchData = {};

        let html = `
        <div style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;font-size:0.95rem;color:white;">
                📊 Informes — ${sorted.length} encuentro${sorted.length !== 1 ? 's' : ''}
            </h3>
            <span style="font-size:0.73rem;color:var(--text-muted);">
                Club: <strong style="color:var(--primary);">${escapeHtml(me.clubName||clubId)}</strong>
            </span>
        </div>`;

        sorted.forEach(m => {
            const goals   = m.players.reduce((s, p) => s + (p.goals || 0), 0);
            const injured = m.players.filter(p => p.injured).length;
            const dateStr = m.matchDate
                ? new Date(m.matchDate).toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })
                : '—';
            const sh = m.scoreHome, sa = m.scoreAway;
            const score = (sh != null && sa != null) ? `${sh} – ${sa}` : '—';
            // Resultado según myTeamRole; sin el campo (informes antiguos) → fallback 'home', comportamiento previo.
            const _mine   = m.myTeamRole === 'away' ? sa : sh;
            const _theirs = m.myTeamRole === 'away' ? sh : sa;
            const res   = (sh != null && sa != null) ? (_mine > _theirs ? 'VICTORIA' : _mine < _theirs ? 'DERROTA' : 'EMPATE') : '';
            const rCol  = res === 'VICTORIA' ? '#3fb950' : res === 'DERROTA' ? '#ff5858' : '#eab308';
            const key64 = btoa(unescape(encodeURIComponent(m.key))).replace(/=/g, '');

            // Guardar datos del partido para renderizado lazy en el toggle
            window._sdMatchData[key64] = m;

            html += `
            <div class="sd-report-card" id="rcard-${key64}" onclick="sdToggleReport('${key64}')">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:1rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                            🆚 vs <span style="color:var(--primary);">${escapeHtml(m.rival||'Sin rival')}</span>
                            ${res ? `<span style="font-size:0.65rem;font-weight:700;letter-spacing:0.5px;color:${rCol};">${res}</span>` : ''}
                        </div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;display:flex;flex-wrap:wrap;gap:0.3rem 0.8rem;">
                            <span>📅 ${dateStr}</span>
                            ${score !== '—' ? `<span>⚽ <strong style="color:${rCol};">${score}</strong></span>` : ''}
                            ${m.category ? `<span style="color:#58a6ff;">${escapeHtml(m.category)}</span>` : ''}
                            <span>👤 ${escapeHtml(m.coachEmail||'Entrenador')}</span>
                        </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
                        <span class="sd-badge" style="background:rgba(63,185,80,0.12);color:#3fb950;">${m.players.length} jugadores</span>
                        ${goals > 0 ? `<span class="sd-badge" style="background:rgba(255,165,0,0.12);color:#ffa500;">⚽ ${goals} gol${goals !== 1 ? 'es' : ''}</span>` : ''}
                        ${injured > 0 ? `<span class="sd-badge" style="background:rgba(249,115,22,0.12);color:#f97316;">🩹 ${injured} lesión${injured > 1 ? 'es' : ''}</span>` : ''}
                        <div style="font-size:0.62rem;color:var(--text-muted);margin-top:2px;">▼ Ver informe completo</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.5rem;padding-left:0.5rem;border-left:1px solid rgba(255,255,255,0.08);">
                        <button onclick="event.stopPropagation(); sdDeleteReport('${key64}')" 
                                title="Eliminar este informe definitivamente"
                                style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);
                                       color:#ff5858;padding:0.4rem;border-radius:6px;cursor:pointer;
                                       display:flex;align-items:center;justify-content:center;transition:all 0.2s;">
                            🗑️
                        </button>
                    </div>
                </div>
                <!-- Panel de detalle: vacío hasta el primer click (lazy render) -->
                <div id="rdetail-${key64}"
                     style="display:none;margin-top:0.8rem;border-top:1px solid var(--glass-border);padding-top:0.8rem;">
                </div>
            </div>`;
        });

        container.innerHTML = html;

        // ── Toggle con renderizado lazy del informe visual ────────────
        window.sdToggleReport = (key64) => {
            const card   = document.getElementById(`rcard-${key64}`);
            const detail = document.getElementById(`rdetail-${key64}`);
            if (!detail) return;
            const isOpen = detail.style.display !== 'none';
            // Renderizar el informe completo solo en el primer click
            if (!isOpen && !detail.dataset.rendered) {
                const matchData = window._sdMatchData && window._sdMatchData[key64];
                if (matchData) {
                    try {
                        detail.innerHTML = _RP.build(matchData, window._cronosCurrentUser);
                    } catch (err) {
                        detail.innerHTML = `<div style="color:#ff5858;font-size:0.8rem;">⚠️ Error al generar informe: ${err.message}</div>`;
                    }
                    detail.dataset.rendered = '1';
                }
            }
            detail.style.display = isOpen ? 'none' : 'block';
            if (card) card.style.borderColor = isOpen ? 'rgba(88,166,255,0.15)' : 'rgba(88,166,255,0.55)';
        };

        // ── Función para ocultar informe del panel ──────────────
        // FIX v2: Soft delete — añade el UID del usuario a dismissedBy.
        // Así cada rol (Director/Coordinador) borra independientemente.
        // El documento no se elimina físicamente, solo se oculta para este usuario.
        // Solo el coach autor (coachUid) puede eliminar físicamente.
        window.sdDeleteReport = async (key64) => {
            if (!confirm('¿Deseas ocultar este informe de tu panel? Solo se eliminará para ti; los demás roles seguirán viéndolo.')) return;
            
            const currentRole = me.currentRole || me.role || 'staff';
            const dismissKey = `${me.uid}_${currentRole}`;

            const match = window._sdMatchData[key64];
            if (!match) return;
            
            try {
                const { db, doc, updateDoc, arrayUnion } = await _sdFS();
                if (typeof showSpinner === 'function') showSpinner('Ocultando informe…');
                
                // Añadir mi UID a dismissedBy en cada documento de jugador
                // Usar SIEMPRE el ID real del documento (p._id), no construir IDs
                // con matchId que puede ser undefined
                const updatePromises = match.players.flatMap(p => {
                    const docIds = [];
                    // Prioridad 1: ID real del documento
                    if (p._id || p.id) docIds.push(p._id || p.id);
                    // Prioridad 2: IDs derivados si matchId es válido
                    const mid = match.matchId;
                    if (mid && mid !== 'undefined' && mid !== '') {
                        const pNum = p.playerNumber || p.number || '';
                        if (pNum) {
                            docIds.push(`${mid}_coach_p${pNum}`);
                            docIds.push(`${mid}_staff_p${pNum}`);
                            docIds.push(`${mid}_p${pNum}`);
                        }
                    }
                    const uniqueIds = [...new Set(docIds)];
                    return uniqueIds.map(docId =>
                        updateDoc(doc(db, 'cronos_player_reports', docId), {
                            dismissedBy: arrayUnion(dismissKey)
                        }).catch(err => {
                            console.warn(`[StaffDashboard] No se pudo ocultar ${docId}:`, err.message);
                        })
                    );
                });
                
                await Promise.all(updatePromises);
                
                if (typeof hideSpinner === 'function') hideSpinner();
                if (typeof showToast === 'function') showToast('✅ Informe ocultado de tu panel', 3000);
                
                // Quitar de la UI
                const card = document.getElementById(`rcard-${key64}`);
                if (card) card.remove();
                
                // Actualizar contador
                const currentCount = Object.keys(window._sdMatchData).length - 1;
                const title = container.querySelector('h3');
                if (title) title.innerHTML = `📊 Informes — ${currentCount} encuentro${currentCount !== 1 ? 's' : ''}`;
                
                delete window._sdMatchData[key64];
                
            } catch (err) {
                if (typeof hideSpinner === 'function') hideSpinner();
                console.error('[StaffDashboard] Error al ocultar:', err);
                if (typeof showToast === 'function') showToast('⚠️ Error al ocultar: ' + err.message, 4000);
            }
        };

    } catch(e) {
        console.error('[StaffDashboard] Error cargando informes:', e);
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">
            ⚠️ Error al cargar informes: ${escapeHtml(e.message)}</div>`;
    }
}

// ════════════════════════════════════════════════════════════════════
//  TAB: MENSAJES (vista Director Deportivo / Coordinador)
// ════════════════════════════════════════════════════════════════════
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

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
            const { doc, getDoc, updateDoc } = await _sdFS();
            const db = window._cronos_auth?.db;
            if (db) {
                const resolvedId = await window._cResolveClubId(db, me, { doc, getDoc, updateDoc });
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
                    🏢 Panel de Dirección:
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
    if (tab === 'config')         await _renderDirectorConfig();
};

// ════════════════════════════════════════════════════════════════════
//  TAB: CONVOCATORIAS / ENTRENAMIENTOS
// ════════════════════════════════════════════════════════════════════
async function _sdLoadEvents(type) {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    const MAX_ITEMS = 40;
    try {
        const { db, collection, getDocs, query, where, orderBy, deleteDoc, doc: firestoreDoc, limit } = await _sdFS();
        const clubId = me.clubId || '';

        // Buscar por clubId O por parentUid (para coordinadores/directores)
        // FIX: filtrar docs donde me.uid está en dismissedBy (borrado "personal" sin afectar a otros)
        let items = [];
        const queries = [
            getDocs(query(collection(db,'cronos_notifications'), where('clubId','==',clubId), where('type','==',type))).catch(()=>null),
            getDocs(query(collection(db,'cronos_notifications'), where('parentUid','==',me.uid), where('type','==',type))).catch(()=>null),
        ];
        const snaps = await Promise.all(queries);
        const seen  = new Set();
        snaps.forEach(snap => {
            if (!snap) return;
            snap.forEach(d => {
                if (seen.has(d.id)) return;
                seen.add(d.id);
                const dat = d.data();
                // Omitir si este usuario ya lo descartó individualmente
                if (Array.isArray(dat.dismissedBy) && dat.dismissedBy.includes(me.uid)) return;
                items.push({ _id: d.id, ...dat });
            });
        });

        items.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

        // Auto-borrar exceso (> MAX_ITEMS)
        if (items.length > MAX_ITEMS) {
            const toDelete = items.splice(MAX_ITEMS);
            toDelete.forEach(it => {
                if (it._id) deleteDoc(firestoreDoc(db,'cronos_notifications',it._id)).catch(()=>{});
            });
        }

        if (!items.length) {
            const label = type === 'convocatoria' ? 'convocatorias' : 'avisos de entrenamiento';
            container.innerHTML = `<div style="text-align:center;padding:4rem;color:var(--text-muted);">
                📭 Sin ${label} recibidos aún.<br>
                <span style="font-size:0.78rem;margin-top:0.5rem;display:block;">
                    El entrenador debe activar las palomillas en <strong>Gestión de Contactos</strong> y enviar via Envío Interno.
                </span></div>`;
            return;
        }

        const isConv = type === 'convocatoria';
        const accent = isConv ? 'var(--primary)' : '#f0883e';
        const icon   = isConv ? '📋' : '📅';

        let html = `<div style="font-size:0.73rem;color:var(--text-muted);margin-bottom:0.8rem;text-align:right;">
            ${items.length} registros · máx. ${MAX_ITEMS} (los más antiguos se eliminan automáticamente)
        </div>`;

        items.forEach(d => {
            const date = d.createdAt
                ? new Date(d.createdAt).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})
                : '—';
            const isPlan = d.type === 'planificacion_semanal';
            const title = isConv
                ? (d.rival ? 'vs ' + escapeHtml(d.rival) : 'Partido')
                : isPlan
                    ? (d.weekStartDate
                        ? 'Semana del ' + new Date(d.weekStartDate + 'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})
                        : (d.datetime ? new Date(d.datetime).toLocaleString('es-ES',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Planificación Semanal'))
                    : (d.datetime ? new Date(d.datetime).toLocaleString('es-ES',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Entrenamiento');
            const subLine = isConv
                ? (isConv && d.venue ? ' · 📍 ' + escapeHtml(d.venue) : '')
                : isPlan
                    ? (Array.isArray(d.days) ? d.days.filter(dy=>dy.time||dy.venue).map(dy=>dy.day+': '+[dy.time,dy.venue].filter(Boolean).join(' ')).slice(0,2).join(' | ') : (d.location ? '📍 ' + escapeHtml(d.location) : ''))
                    : (d.location ? ' · 📍 ' + escapeHtml(d.location) : '');

            html += `
            <div class="sd-card" style="position:relative;border-left:3px solid ${accent};">
                <!-- Botón eliminar -->
                <button onclick="sdDeleteNotif('${escapeAttr(d._id)}')"
                    title="Eliminar" 
                    style="position:absolute;top:0.6rem;right:0.6rem;background:rgba(255,88,88,0.1);
                           border:1px solid rgba(255,88,88,0.3);color:#ff5858;border-radius:6px;
                           width:28px;height:28px;cursor:pointer;font-size:0.85rem;display:flex;
                           align-items:center;justify-content:center;">🗑️</button>
                <div style="flex:1;min-width:0;padding-right:2rem;">
                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;">
                        <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:4px;
                            background:${isConv?'rgba(88,166,255,0.12)':'rgba(240,136,62,0.12)'};
                            color:${accent};">${icon} ${isConv?'CONVOCATORIA':'ENTRENAMIENTO'}</span>
                        <span style="font-size:0.7rem;color:var(--text-muted);">${date}</span>
                    </div>
                    <div style="font-weight:700;font-size:0.92rem;margin-bottom:0.2rem;">${title}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">
                        ${isConv && d.players ? `👥 ${d.players.length} convocados · ` : ''}
                        ${d.coachEmail ? 'Enviado por ' + escapeHtml(d.coachEmail) : ''}
                        ${subLine}
                    </div>
                </div>
                <button onclick="sdViewEventDetail('${escapeAttr(d._id)}')" class="btn"
                    style="font-size:0.75rem;padding:0.4rem 0.9rem;flex-shrink:0;background:rgba(88,166,255,0.1);
                           border-color:rgba(88,166,255,0.3);color:var(--primary);">
                    👁 Ver</button>
            </div>`;
        });
        container.innerHTML = html;

        // ── Detalle completo sin alert() ────────────────────────────────
        window.sdViewEventDetail = async (id) => {
            const snap = items.find(it => it._id === id) ||
                         await (async () => { const s = await (await _sdFS()).getDoc?.((await _sdFS()).doc?.((await _sdFS()).db,'cronos_notifications',id)); return s?.exists()?{_id:id,...s.data()}:null; })().catch(()=>null);
            if (!snap) return;
            const d = snap;
            const isC = d.type === 'convocatoria';
            const isPlan = d.type === 'planificacion_semanal';

            // Mostrar en modal in-app (no alert)
            const overlay = document.createElement('div');
            overlay.id = 'sd-detail-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:1rem;';

            const logo = `<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;justify-content:center;">
                <span style="font-size:1.8rem;">${isC?'📋':'📅'}</span>
                <div>
                    <div style="font-size:1.1rem;font-weight:900;color:${isC?'var(--primary)':'#f0883e'};">CHRONOS FÚTBOL</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">${isC?'CONVOCATORIA':isPlan?'PLANIFICACIÓN SEMANAL':'AVISO DE ENTRENAMIENTO'}</div>
                </div>
            </div>`;

            let body = '';
            if (isC) {
                body = `
                <div style="background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    ${d.matchDate?`<div style="font-size:0.92rem;margin-bottom:0.4rem;">📅 <strong>${escapeHtml(d.matchDate)}</strong></div>`:''}
                    ${d.rival   ?`<div style="font-size:0.92rem;margin-bottom:0.4rem;">🆚 vs <strong>${escapeHtml(d.rival)}</strong></div>`:''}
                    ${d.venue   ?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">🏟️ ${escapeHtml(d.venue)}</div>`:''}
                    ${d.meettime?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">🕐 Presentación: <strong>${escapeHtml(d.meettime)}h</strong></div>`:''}
                    ${d.kickoff ?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">⚽ Inicio: <strong>${escapeHtml(d.kickoff)}h</strong></div>`:''}
                </div>
                ${d.players?.length?`
                <div style="background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    <div style="font-size:0.75rem;font-weight:700;color:#3fb950;margin-bottom:0.6rem;letter-spacing:0.5px;">👥 CONVOCADOS (${d.players.length})</div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0.3rem;">
                        ${d.players.map((p,i)=>`<div style="font-size:0.82rem;padding:0.2rem 0.4rem;background:rgba(255,255,255,0.04);border-radius:4px;">${i+1}. ${escapeHtml(p)}</div>`).join('')}
                    </div>
                </div>`:''}
                ${d.extra?`<div style="font-size:0.85rem;padding:0.8rem;background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.2);border-radius:8px;font-style:italic;">💬 ${escapeHtml(d.extra)}</div>`:''}`;
            } else if (isPlan && (Array.isArray(d.days) || d.weekStartDate)) {
                // Planificación Semanal con tabla de días
                const weekDaysHTML = Array.isArray(d.days)
                    ? d.days.map(dy => {
                        const hasData = dy.time || dy.venue || dy.note;
                        return '<div style="display:flex;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">'
                            + '<div style="font-weight:700;color:#f0883e;min-width:80px;font-size:0.82rem;">' + escapeHtml(dy.day||'') + '</div>'
                            + '<div style="font-size:0.8rem;color:' + (hasData?'var(--text)':'#555') + ';">'
                            + (hasData
                                ? [dy.time?'🕐 '+dy.time:'', dy.venue?'📍 '+escapeHtml(dy.venue):'', dy.note?'📝 '+escapeHtml(dy.note):''].filter(Boolean).join(' &nbsp;·&nbsp; ')
                                : '_Descanso_')
                            + '</div></div>';
                    }).join('')
                    : '';
                body = `
                <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    ${d.weekStartDate?`<div style="font-size:0.9rem;font-weight:700;color:#f0883e;margin-bottom:0.8rem;">📅 Semana del ${new Date(d.weekStartDate+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}</div>`:''}
                    <div style="display:flex;flex-direction:column;gap:0;">${weekDaysHTML}</div>
                    ${d.location?`<div style="font-size:0.85rem;margin-top:0.5rem;">📍 ${escapeHtml(d.location)}</div>`:''}
                    ${d.notes?`<div style="font-size:0.82rem;margin-top:0.4rem;padding:0.5rem;background:rgba(255,255,255,0.04);border-radius:6px;">📝 ${escapeHtml(d.notes)}</div>`:''}
                </div>`;
            } else {
                const dtFmt = d.datetime
                    ? new Date(d.datetime).toLocaleString('es-ES',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})
                    : d.trainDate || '—';
                body = `
                <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    <div style="font-size:0.92rem;margin-bottom:0.4rem;">📅 <strong>${escapeHtml(dtFmt)}</strong></div>
                    ${d.location||d.venue?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">📍 ${escapeHtml(d.location||d.venue)}</div>`:''}
                    ${d.notes  ?`<div style="font-size:0.88rem;margin-top:0.4rem;padding:0.6rem;background:rgba(255,255,255,0.04);border-radius:6px;">📝 ${escapeHtml(d.notes)}</div>`:''}
                </div>`;
            }

            overlay.innerHTML = `
            <div style="width:min(92vw,540px);background:var(--surface,#161b22);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:1.4rem;margin:auto;">
                ${logo}
                ${body}
                <div style="text-align:right;margin-top:1rem;">
                    <span style="font-size:0.7rem;color:var(--text-muted);">Enviado: ${d.createdAt?new Date(d.createdAt).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}</span>
                </div>
                <button onclick="(function(){var el=document.getElementById('sd-detail-overlay');if(el)el.remove();})()"
                    style="width:100%;margin-top:0.9rem;padding:0.6rem;background:rgba(88,166,255,0.15);
                           border:1px solid rgba(88,166,255,0.3);border-radius:8px;color:var(--primary);
                           font-weight:700;cursor:pointer;font-size:0.88rem;">
                    ✕ Cerrar
                </button>
            </div>`;
            document.body.appendChild(overlay);
        };

        // ── Eliminar notificación ────────────────────────────────────────
        // FIX: "borrar" = marcar como descartado por este usuario (no borra para los demás)
        window.sdDeleteNotif = async (id) => {
            if (!confirm('¿Quitar este aviso de tu panel? Los demás roles seguirán viéndolo.')) return;
            try {
                const { db: db2, doc: dRef, updateDoc: upd, arrayUnion: au } = await _sdFS();
                await upd(dRef(db2, 'cronos_notifications', id), {
                    dismissedBy: au(me.uid)
                });
                items = items.filter(it => it._id !== id);
                await _sdLoadEvents(type);
                if (typeof showToast === 'function') showToast('🗑️ Quitado de tu panel', 2000);
            } catch(e) {
                // Fallback: si el campo arrayUnion falla (doc sin el campo), intentar con set merge
                try {
                    const { db: db3, doc: dRef3 } = await _sdFS();
                    const { updateDoc, arrayUnion } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    await updateDoc(dRef3(db3, 'cronos_notifications', id), { dismissedBy: arrayUnion(me.uid) });
                    items = items.filter(it => it._id !== id);
                    await _sdLoadEvents(type);
                    if (typeof showToast === 'function') showToast('🗑️ Quitado de tu panel', 2000);
                } catch(e2) {
                    if (typeof showToast === 'function') showToast('⚠️ Error: ' + e2.message, 3000);
                }
            }
        };

    } catch(e) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">⚠️ ${escapeHtml(e.message)}</div>`;
    }
}

// ════════════════════════════════════════════════════════════════════
//  MOTOR DE INFORMES VISUAL v1.0
//  Genera Gantt + Panel de Rotaciones + Cabecera completa con logo
// ════════════════════════════════════════════════════════════════════

const _RP = (() => {

    // ── Colores y etiquetas por posición ──────────────────────────────
    const PC = { POR:'#BA7517', DEF:'#185FA5', MED:'#1D9E75', DEL:'#D85A30', SUP:'#7F77DD' };
    
    // Paleta de colores para cadenas de rotación (Gantt)
    const CHAIN_COLORS = [
        '#3fb950', '#58a6ff', '#f0883e', '#d2a8ff', '#ff5858', '#eab308', 
        '#79c0ff', '#aff5b4', '#ff7b72', '#d29922', '#bc8cff', '#58d1ff'
    ];

    // ── Escape HTML seguro ────────────────────────────────────────────
    const esc = s => (s || '').toString()
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    // ── Detectar posición del jugador ─────────────────────────────────
    const getPos = p => {
        const v = p.position || p.pos || '';
        if (PC[v]) return v;
        return (String(p.playerNumber) === '1') ? 'POR' : 'MED';
    };

    // ── Reconstruir intervalos en campo desde el historial ────────────
    // history contiene eventos {type:'sub_in'|'sub_out'|'goal'|..., minute:N, second:S, timeStr:"MM:SS"}
    const buildIvs = (player, totMin) => {
        const rawHist = (player.history || []).filter(e => e.type === 'sub_in' || e.type === 'sub_out');
        
        // Agrupar por tiempo exacto para eliminar intercambios de posición (sub_in y sub_out simultáneos del mismo jugador)
        const timeMap = {};
        rawHist.forEach(e => {
            const exact = (e.minute || 0) + (e.second || 0) / 60;
            const tKey = exact.toFixed(3);
            if (!timeMap[tKey]) timeMap[tKey] = { in: false, out: false, events: [] };
            if (e.type === 'sub_in') timeMap[tKey].in = true;
            if (e.type === 'sub_out') timeMap[tKey].out = true;
            timeMap[tKey].events.push(e);
        });
        
        const hist = [];
        Object.values(timeMap).forEach(g => {
            if (g.in && g.out) return; // Se anulan (cambio de posición en el campo)
            hist.push(...g.events);
        });
        
        hist.sort((a, b) => {
            const ta = (a.minute || 0) + (a.second || 0) / 60;
            const tb = (b.minute || 0) + (b.second || 0) / 60;
            return ta - tb;
        });
            
        if (!hist.length) {
            const playedSome = (player.minutesPlayed > 0) || (player.status === 'field') || (player.initialStatus === 'field') || (player.titular === true);
            return playedSome ? [[0, totMin]] : [];
        }
        
        const ivs = [];
        let on = (player.status === 'field' || player.initialStatus === 'field' || player.titular === true) || hist[0].type === 'sub_out';
        let at = on ? 0 : null;
        
        hist.forEach(ev => {
            const exact = (ev.minute || 0) + (ev.second || 0) / 60;
            if (ev.type === 'sub_in' && !on) { on = true;  at = exact; }
            else if (ev.type === 'sub_out' && on)  { ivs.push([at, exact]); on = false; at = null; }
        });
        
        if (on && at !== null) ivs.push([at, totMin]);
        return ivs;
    };

    // ── Calcular minutos totales desde intervalos ─────────────────────
    const calcTot = ivs => ivs.reduce((s, [a, b]) => s + (b - a), 0);

    // ── Helper format time for totals
    const formatTot = t => {
        const mm = Math.floor(t);
        const ss = Math.round((t - mm) * 60);
        return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    };

    // ── Obtener tiempo exacto del cronómetro de cada jugador ──────────
    // Prioridad: minutesPlayed (cronómetro real) > calcTot(_ivs) (calculado por historial)
    const getExactTime = p => {
        if (p.minutesPlayed && /^\d{1,3}:\d{2}$/.test(String(p.minutesPlayed))) {
            return p.minutesPlayed; // "MM:SS" ya formateado
        }
        if (typeof p.minutesPlayed === 'number' && p.minutesPlayed > 0) {
            const mm = Math.floor(p.minutesPlayed / 60);
            const ss = p.minutesPlayed % 60;
            return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
        }
        if (p.time != null && p.time > 0) {
            const mm = Math.floor(p.time / 60);
            const ss = p.time % 60;
            return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
        }
        return formatTot(p._tot || 0);
    };

    // ── Extraer pares de sustitución de todos los jugadores ───────────
    // Empareja sub_out con sub_in al mismo minuto y segundo (±0.05 min de margen)
    const buildSubs = players => {
        const outs = [], ins = [];
        players.forEach(p => {
            const evs = (p.history || []);
            // Filtrar eventos simultáneos (cambios de posición)
            const timeMap = {};
            evs.forEach(ev => {
                if (ev.type !== 'sub_in' && ev.type !== 'sub_out') return;
                const exact = (ev.minute || 0) + (ev.second || 0) / 60;
                const tKey = exact.toFixed(3);
                if (!timeMap[tKey]) timeMap[tKey] = { in: false, out: false, eIn: null, eOut: null };
                if (ev.type === 'sub_in')  { timeMap[tKey].in = true; timeMap[tKey].eIn = ev; }
                if (ev.type === 'sub_out') { timeMap[tKey].out = true; timeMap[tKey].eOut = ev; }
            });
            
            Object.keys(timeMap).forEach(tKey => {
                const g = timeMap[tKey];
                if (g.in && g.out) return; // Es un simple cambio de posición en el campo, no sustitución
                const exact = parseFloat(tKey);
                if (g.out) outs.push({ min: exact, timeStr: g.eOut.timeStr || '', subId: g.eOut.subId || null, p });
                if (g.in)  ins.push({ min: exact, timeStr: g.eIn.timeStr || '', subId: g.eIn.subId || null, p });
            });
        });
        outs.sort((a, b) => a.min - b.min);
        const used = new Set(); // playerAlias de entradas (ins) ya emparejadas

        // Indice de entradas por subId para el emparejado PRIORITARIO. El subId
        // (id numerico de sustitucion) lo comparten la salida y la entrada de un
        // mismo cambio, asi que empareja con exactitud aunque haya varias
        // sustituciones en el mismo minuto (lo que la proximidad temporal no podia).
        const insBySubId = new Map(); // subId -> [ins]
        ins.forEach(i => {
            if (i.subId == null) return;
            if (!insBySubId.has(i.subId)) insBySubId.set(i.subId, []);
            insBySubId.get(i.subId).push(i);
        });

        const pairIn = new Array(outs.length).fill(null);

        // PASO 1 (prioritario): emparejar por subId exacto, ignorando la distancia
        // temporal. Se resuelve para TODAS las salidas con subId antes de pasar a la
        // proximidad, para que esta no 'robe' una entrada destinada a un subId.
        outs.forEach((o, idx) => {
            if (o.subId == null) return;
            const cands = insBySubId.get(o.subId);
            if (!cands) return;
            const hit = cands.find(i => !used.has(i.p.playerAlias) && i.p.playerAlias !== o.p.playerAlias);
            if (hit) { pairIn[idx] = hit; used.add(hit.p.playerAlias); }
        });

        // PASO 2 (fallback): salidas sin emparejar (informes antiguos sin subId, o
        // sin coincidencia por id) -> proximidad 0.05 min + entrada libre (Set de
        // playerAlias usados) + no auto-emparejar al mismo jugador.
        outs.forEach((o, idx) => {
            if (pairIn[idx]) return;
            const hit = ins.find(i => Math.abs(i.min - o.min) <= 0.05 && !used.has(i.p.playerAlias) && i.p.playerAlias !== o.p.playerAlias);
            if (hit) { pairIn[idx] = hit; used.add(hit.p.playerAlias); }
        });

        // Array unico final, en el mismo orden que outs (ordenado por min).
        return outs.map((o, idx) => {
            const found = pairIn[idx];
            return { min: o.min, timeStr: o.timeStr, out: o.p, inp: found ? found.p : null };
        });
    };

    // ── Determinar duración según categoría ───────────────────────────
    const getTotMin = m => {
        if (m.duration) return parseInt(m.duration) || 60;
        const cat = (m.category || '').toLowerCase();
        if (cat.includes('cadete') || cat.includes('juvenil') || cat.includes('regional') || cat.includes('senior')) return 90;
        if (cat.includes('infantil')) return 70;
        if (cat.includes('benjamin') || cat.includes('benjamín')) return 50;
        if (cat.includes('prebenjamin') || cat.includes('prebenjamín')) return 40;
        return 60; // alevín y genérico
    };

    // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 1: CABECERA DEL ENCUENTRO
    // ════════════════════════════════════════════════════════════════
    const buildHeader = (m, clubName, totMin, stopMin) => {
        const home  = esc(clubName || 'CD Local');
        const away  = esc(m.rival || 'Sin rival');
        const sh = m.scoreHome, sa = m.scoreAway;
        const score = (sh != null && sa != null) ? `${sh} – ${sa}` : '— : —';
        // Resultado desde la perspectiva del equipo del usuario (myTeamRole).
        // Sin myTeamRole (informes antiguos) → fallback 'home' (sh = mi equipo): comportamiento previo intacto.
        const _mine   = m.myTeamRole === 'away' ? sa : sh;
        const _theirs = m.myTeamRole === 'away' ? sh : sa;
        const res   = (sh != null && sa != null) ? (_mine > _theirs ? 'VICTORIA' : _mine < _theirs ? 'DERROTA' : 'EMPATE') : '';
        const rCol  = res === 'VICTORIA' ? '#3fb950' : res === 'DERROTA' ? '#ff5858' : '#eab308';
        const dateStr = m.matchDate
            ? new Date(m.matchDate).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
            : 'Fecha no disponible';
        const durStr = stopMin > 0
            ? `${totMin}' <span style="color:#58a6ff;font-size:0.85em;">+${stopMin}'</span>`
            : `${totMin}'`;

        const logoSVG =
            `<svg width="14" height="14" viewBox="0 0 20 20" fill="none">` +
            `<circle cx="10" cy="10" r="8" stroke="#3fb950" stroke-width="1.5"/>` +
            `<circle cx="10" cy="10" r="3" fill="#3fb950"/>` +
            `<line x1="10" y1="2" x2="10" y2="7" stroke="#3fb950" stroke-width="1.2"/>` +
            `<line x1="10" y1="13" x2="10" y2="18" stroke="#3fb950" stroke-width="1.2"/>` +
            `<line x1="2" y1="10" x2="7" y2="10" stroke="#3fb950" stroke-width="1.2"/>` +
            `<line x1="13" y1="10" x2="18" y2="10" stroke="#3fb950" stroke-width="1.2"/>` +
            `</svg>`;

        return (
            `<div style="background:linear-gradient(135deg,#0d1117,#161b22);` +
            `border:1px solid rgba(88,166,255,0.22);border-radius:14px;padding:1.1rem 1.3rem;margin-bottom:0.85rem;">` +

            // Chronos header row
            `<div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:0.85rem;` +
            `padding-bottom:0.7rem;border-bottom:1px solid rgba(255,255,255,0.07);">` +
            `<div style="width:30px;height:30px;border-radius:50%;background:#0d1117;border:2px solid #3fb950;` +
            `display:flex;align-items:center;justify-content:center;flex-shrink:0;">${logoSVG}</div>` +
            `<div style="flex:1;">` +
            `<div style="font-size:0.7rem;font-weight:700;letter-spacing:0.7px;color:#3fb950;">CHRONOS FÚTBOL</div>` +
            `<div style="font-size:0.64rem;color:var(--text-muted);">Informe oficial post-partido · Generado automáticamente · No editable</div>` +
            `</div>` +
            `<div style="text-align:right;font-size:0.67rem;">` +
            (m.competition ? `<div style="color:#58a6ff;font-weight:600;margin-bottom:1px;">${esc(m.competition)}</div>` : '') +
            (m.category    ? `<div style="color:rgba(255,255,255,0.45);">${esc(m.category)}</div>` : '') +
            `</div></div>` +

            // Score row
            `<div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.75rem;">` +
            `<div style="flex:1;">` +
            `<div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">LOCAL</div>` +
            `<div style="font-size:1rem;font-weight:700;color:white;">${home}</div>` +
            `</div>` +
            `<div style="text-align:center;flex-shrink:0;">` +
            `<div style="font-size:1.85rem;font-weight:700;letter-spacing:6px;color:${rCol};">${score}</div>` +
            (res ? `<div style="font-size:0.62rem;font-weight:700;letter-spacing:1px;margin-top:1px;color:${rCol};">${res}</div>` : '') +
            `</div>` +
            `<div style="flex:1;text-align:right;">` +
            `<div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">VISITANTE</div>` +
            `<div style="font-size:1rem;font-weight:700;color:white;">${away}</div>` +
            `</div></div>` +

            // Metadata row
            `<div style="display:flex;flex-wrap:wrap;gap:0.4rem 0.9rem;font-size:0.69rem;color:var(--text-muted);">` +
            `<span>📅 ${dateStr}</span>` +
            (m.matchTime ? `<span>🕐 ${esc(m.matchTime)}</span>` : '') +
            `<span>⏱ <span style="color:rgba(255,255,255,0.7);">${durStr}</span></span>` +
            (stopMin > 0 ? `<span>⌛ Descuento: <strong style="color:#58a6ff;">+${stopMin}'</strong></span>` : '') +
            (m.venue ? `<span>📍 ${esc(m.venue)}</span>` : '') +
            `<span>👤 ${esc(m.coachEmail || 'Entrenador')}</span>` +
            `</div>` +
            `</div>`
        );
    };

    // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 2: TARJETAS DE RESUMEN (4 métricas)
    // ════════════════════════════════════════════════════════════════
    const buildStats = m => {
        const goals  = m.players.reduce((s, p) => s + (p.goals || 0), 0);
        const ycards = m.players.filter(p => p.cards === 'yellow').length;
        const rcards = m.players.filter(p => p.cards === 'red').length;
        const inj    = m.players.filter(p => p.injured).length;
        const cardTxt = ycards > 0
            ? (rcards > 0
                ? `<span style="color:#eab308;">${ycards}</span><span style="font-size:0.72rem;color:#ff5858;margin-left:2px;">+${rcards}R</span>`
                : `<span style="color:#eab308;">${ycards}</span>`)
            : `<span style="color:rgba(255,255,255,0.25);">0</span>`;
        return (
            `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);` +
            `border-radius:10px;padding:0.5rem;text-align:center;">` +
            `<div style="font-size:1.2rem;font-weight:700;color:white;">${m.participantsCount || m.players.length}</div>` +
            `<div style="font-size:0.62rem;color:var(--text-muted);">convocados</div></div>` +

            `<div style="background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.15);` +
            `border-radius:10px;padding:0.5rem;text-align:center;">` +
            `<div style="font-size:1.2rem;font-weight:700;color:#3fb950;">${goals}</div>` +
            `<div style="font-size:0.62rem;color:var(--text-muted);">goles</div></div>` +

            `<div style="background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.12);` +
            `border-radius:10px;padding:0.5rem;text-align:center;">` +
            `<div style="font-size:1.2rem;font-weight:700;">${cardTxt}</div>` +
            `<div style="font-size:0.62rem;color:var(--text-muted);">tarjetas</div></div>` +

            `<div style="background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.12);` +
            `border-radius:10px;padding:0.5rem;text-align:center;">` +
            `<div style="font-size:1.2rem;font-weight:700;color:${inj > 0 ? '#f97316' : 'rgba(255,255,255,0.25)'};">${inj}</div>` +
            `<div style="font-size:0.62rem;color:var(--text-muted);">lesiones</div></div>` +
            `</div>`
        );
    };

    // ════════════════════════════════════════════════════════════════
    // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 3: LÍNEAS DE TIEMPO INDIVIDUALES POR JUGADOR
    //  Reemplaza el Gantt combinado. Cada jugador tiene su propia
    //  línea de tiempo: barra azul = en campo, gris = banquillo.
    //  Al inicio/fin de cada barra: nombre del compañero de cambio.
    //  ────────────────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════
    const buildPlayerTimelines = (players, subs, totMin) => {
        // ── Mapas de sustitución para etiquetar los extremos de barra ──
        // subOutMap[alias] = [{timeFrac, name}]  → quién entró cuando salió
        // subInMap[alias]  = [{timeFrac, name}]  → a quién reemplazó al entrar
        const subOutMap = {}, subInMap = {};
        subs.forEach(s => {
            if (!s.out || !s.inp) return;
            const oa = s.out.playerAlias  || ('#' + s.out.playerNumber);
            const ia = s.inp.playerAlias  || ('#' + s.inp.playerNumber);
            const minStr = Math.floor(s.min) + "'";
            (subOutMap[oa] = subOutMap[oa] || []).push({ timeFrac: s.min, name: `${ia.substring(0, 9)} ${minStr}` });
            (subInMap[ia]  = subInMap[ia]  || []).push({ timeFrac: s.min, name: `${oa.substring(0, 9)} ${minStr}` });
        });
        const findNear = (map, alias, t) => {
            const arr = map[alias];
            if (!arr) return null;
            const hit = arr.find(e => Math.abs(e.timeFrac - t) <= 0.12);
            return hit ? hit.name : null;
        };

        const W = 500, Hrow = 62;
        const TRACK_Y = 20, TRACK_H = 16;
        const EVT_Y   = 10;  // centro de zona de eventos (sobre la barra)
        const LBL_Y   = Hrow - 3; // etiquetas de minutos
        const sc      = W / totMin;

        // Marcas de tiempo según duración
        const step = totMin <= 50 ? 10 : 15;
        const ticks = [];
        for (let m = 0; m <= totMin; m += step) ticks.push(m);
        if (ticks[ticks.length-1] !== totMin) ticks.push(totMin);

        let html = `<div style="display:flex;flex-direction:column;gap:1px;padding:2px 0;">`;

        players.forEach((p, idx) => {
            const posCol  = PC[p._pos] || '#888';
            const timeStr = getExactTime(p);
            const alias   = esc((p.playerAlias || 'Jugador').substring(0, 16));
            const num     = p.playerNumber || '?';
            const aliasKey = p.playerAlias || ('#' + num);
            const periods  = p._ivs || [];

            // ── SVG por jugador ─────────────────────────────────────────
            let svg = `<svg viewBox="0 0 ${W} ${Hrow}" width="100%" style="display:block;overflow:visible;">`;

            // Fondo gris (banquillo completo)
            svg += `<rect x="0" y="${TRACK_Y}" width="${W}" height="${TRACK_H}" rx="4"
                fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.07)" stroke-width="0.5"/>`;

            // Calcular huecos (banquillo) y etiquetarlos
            const gaps = [];
            let prev = 0;
            [...periods].sort((a,b)=>a[0]-b[0]).forEach(([a,b]) => {
                if (a > prev + 0.1) gaps.push([prev, a]);
                prev = b;
            });
            if (prev < totMin - 0.1) gaps.push([prev, totMin]);

            gaps.forEach(([ga, gb]) => {
                const gW = (gb - ga) * sc;
                if (gW > 30) {
                    const cx = (ga + (gb - ga)/2) * sc;
                    svg += `<text x="${cx.toFixed(1)}" y="${TRACK_Y + TRACK_H/2 + 3.5}"
                        text-anchor="middle" font-size="6" fill="rgba(255,255,255,0.18)"
                        font-weight="700" letter-spacing="0.8">BANQUILLO</text>`;
                }
            });

            // Barras de tiempo en campo (azul) + etiquetas de cambio
            periods.forEach(([a, b]) => {
                const px = a * sc, pw = Math.max(2, (b - a) * sc);
                svg += `<rect x="${px.toFixed(1)}" y="${TRACK_Y}" width="${pw.toFixed(1)}"
                    height="${TRACK_H}" rx="3" fill="#58a6ff" fill-opacity="0.82"/>`;

                // Inicio de barra desde banquillo (sub_in)
                if (a > 0.15) {
                    const outName = findNear(subInMap, aliasKey, a); // Nombre del que salió
                    svg += `<line x1="${px.toFixed(1)}" y1="${TRACK_Y-4}" x2="${px.toFixed(1)}" y2="${TRACK_Y+TRACK_H+2}" stroke="#3fb950" stroke-width="1.8"/>`;
                    
                    // v219: Texto Verde (el que entra, alias) abajo — ▼ hacia el campo
                    svg += `<text x="${(px+3).toFixed(1)}" y="${TRACK_Y+TRACK_H+11}" font-size="7" fill="#3fb950" font-weight="700">▼ ${alias} ${Math.floor(a)}'</text>`;
                    
                    // v219: Texto Rojo (el que sale, outName) arriba — ▲ hacia fuera
                    if (outName) {
                        svg += `<text x="${(px-3).toFixed(1)}" y="${TRACK_Y-7}" text-anchor="end" font-size="7" fill="#ff5858" font-weight="700">${outName} ▲</text>`;
                    }
                }

                // Fin de barra antes del final (sub_out)
                if (b < totMin - 0.3) {
                    const inpName = findNear(subOutMap, aliasKey, b); // Nombre del que entró
                    const ex = px + pw;
                    svg += `<line x1="${ex.toFixed(1)}" y1="${TRACK_Y-4}" x2="${ex.toFixed(1)}" y2="${TRACK_Y+TRACK_H+2}" stroke="#ff5858" stroke-width="1.8"/>`;
                    
                    // v219: Texto Rojo (el que sale, alias) arriba — ▲ hacia fuera
                    svg += `<text x="${(ex-3).toFixed(1)}" y="${TRACK_Y-7}" text-anchor="end" font-size="7" fill="#ff5858" font-weight="700">${alias} ${Math.floor(b)}' ▲</text>`;
                    
                    // v219: Texto Verde (el que entra, inpName) abajo — ▼ hacia el campo
                    if (inpName) {
                        svg += `<text x="${(ex+3).toFixed(1)}" y="${TRACK_Y+TRACK_H+11}" font-size="7" fill="#3fb950" font-weight="700">▼ ${inpName}</text>`;
                    }
                }
            });

            // Ticks de tiempo
            ticks.forEach(mn => {
                const tx = mn * sc;
                svg += `<line x1="${tx.toFixed(1)}" y1="${TRACK_Y}" x2="${tx.toFixed(1)}" y2="${TRACK_Y+TRACK_H}"
                    stroke="rgba(255,255,255,0.1)" stroke-width="0.7" stroke-dasharray="2,2"/>`;
                svg += `<text x="${tx.toFixed(1)}" y="${LBL_Y}"
                    font-size="7.5" fill="rgba(255,255,255,0.28)"
                    text-anchor="${mn===0?'start':mn===totMin?'end':'middle'}">${mn}'</text>`;
            });

            // Eventos sobre la barra (goles, tarjetas, lesiones) con tiempo exacto
            (p.history || [])
                .filter(e => ['goal','yellow','red','injury'].includes(e.type))
                .forEach(ev => {
                    const ef = (ev.minute||0) + (ev.second||0)/60;
                    const ex = ef * sc;
                    const ts = ev.timeStr || `${ev.minute||0}'${ev.second>0?String(ev.second).padStart(2,'0')+'"':''}`;
                    if (ev.type === 'goal') {
                        svg += `<circle cx="${ex.toFixed(1)}" cy="${EVT_Y}" r="5.5" fill="white" stroke="#3fb950" stroke-width="1.5"/>`;
                        svg += `<circle cx="${ex.toFixed(1)}" cy="${EVT_Y}" r="2.2" fill="#3fb950"/>`;
                    } else if (ev.type === 'yellow') {
                        svg += `<rect x="${(ex-3.5).toFixed(1)}" y="${EVT_Y-6}" width="7" height="10" rx="1.5" fill="#eab308"/>`;
                    } else if (ev.type === 'red') {
                        svg += `<rect x="${(ex-3.5).toFixed(1)}" y="${EVT_Y-6}" width="7" height="10" rx="1.5" fill="#ef4444"/>`;
                    } else if (ev.type === 'injury') {
                        svg += `<polygon points="${ex},${EVT_Y-7} ${(ex-5)},${EVT_Y+4} ${(ex+5)},${EVT_Y+4}" fill="#f97316"/>`;
                    }
                    svg += `<text x="${ex.toFixed(1)}" y="${TRACK_Y-8}"
                        text-anchor="middle" font-size="5.5" fill="rgba(255,255,255,0.38)">${ts}</text>`;
                });

            svg += '</svg>';

            const bg = idx % 2 === 0 ? 'rgba(255,255,255,0.014)' : 'transparent';

            html += `
            <div style="display:flex;align-items:center;gap:0;padding:2px 0;background:${bg};border-radius:5px;">
                <div style="min-width:118px;max-width:118px;padding:0 6px 0 6px;flex-shrink:0;">
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span style="width:5px;height:5px;border-radius:50%;background:${posCol};flex-shrink:0;"></span>
                        <span style="font-size:0.72rem;font-weight:700;color:rgba(255,255,255,0.87);
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${num}. ${alias}</span>
                    </div>
                    <div style="font-size:0.65rem;color:#58a6ff;font-weight:600;margin-top:1px;padding-left:9px;">${timeStr}</div>
                </div>
                <div style="flex:1;min-width:0;overflow:hidden;">${svg}</div>
            </div>`;
        });

        html += '</div>';
        return html;
    };

    // ── Leyenda (actualizada para el nuevo formato) ───────────────────
    const buildLegend = () =>
        `<div style="display:flex;gap:6px 14px;flex-wrap:wrap;margin:6px 0 0.85rem;font-size:0.66rem;color:var(--text-muted);">` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="display:inline-block;width:12px;height:7px;background:#58a6ff;border-radius:2px;opacity:0.82;"></span>En campo</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="display:inline-block;width:12px;height:7px;background:rgba(255,255,255,0.07);border:0.5px solid rgba(255,255,255,0.15);border-radius:2px;"></span>Banquillo</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="display:inline-block;width:1.5px;height:12px;background:#3fb950;"></span><span style="color:#3fb950;font-weight:700;font-size:0.62rem;">▼ NOMBRE</span> Entra (reemplaza a)</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="display:inline-block;width:1.5px;height:12px;background:#ff5858;"></span><span style="color:#ff5858;font-weight:700;font-size:0.62rem;">NOMBRE ▲</span> Sale (relevado por)</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;border-radius:50%;background:white;border:1.5px solid #3fb950;display:inline-block;"></span>Gol</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="width:7px;height:10px;background:#eab308;border-radius:1px;display:inline-block;"></span>Amarilla</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="width:7px;height:10px;background:#ef4444;border-radius:1px;display:inline-block;"></span>Roja</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid #f97316;display:inline-block;"></span>Lesión</span>` +
        `</div>`;

        // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 4: PANEL DE ROTACIONES — Quién por quién
    // ════════════════════════════════════════════════════════════════
    const buildRotPanel = (subs) => {
        if (!subs.length) return '';

        const rows = subs.map((sub, idx) => {
            const op = sub.out, ip = sub.inp;
            const oc = PC[op._pos] || '#888', ic = ip ? (PC[ip._pos] || '#888') : null;

            // ¿Es un regreso? (el jugador entrante tiene más de un intervalo y este no es el primero)
            let retBadge = '';
            if (ip && ip._ivs && ip._ivs.length > 1) {
                const pi = ip._ivs.findIndex(([a]) => a === sub.min);
                if (pi > 0) retBadge = `<span style="background:rgba(88,166,255,0.12);color:#58a6ff;padding:1px 6px;border-radius:100px;font-size:0.65rem;">Regresa · ${pi + 1}º per.</span>`;
            }

            // ¿Lesión asociada a esta sustitución?
            const isInj = (op.history || []).some(e => e.type === 'injury' && Math.abs((e.minute || 0) - sub.min) <= 1);
            const injBadge = isInj
                ? `<span style="background:rgba(249,115,22,0.12);color:#f97316;padding:1px 6px;border-radius:100px;font-size:0.65rem;">Lesión</span>` : '';

            // ¿En qué período sale el jugador saliente?
            const opPeriods = op._ivs ? op._ivs.length : 1;
            const opPeriodIdx = op._ivs ? op._ivs.findIndex(([, b]) => b === sub.min) : -1;
            const outPerBadge = opPeriods > 1 && opPeriodIdx >= 0
                ? ` <span style="font-size:0.62rem;opacity:0.6;">(${opPeriodIdx + 1}º per.)</span>` : '';

            // v219: flechas invertidas. ▼ verde = ENTRA al campo (hacia abajo), ▲ roja = SALE del campo (hacia arriba).
            // Sin "nº<num>"; solo se muestra el nombre del jugador.
            const outPill =
                `<span style="background:rgba(255,88,88,0.10);color:#ff5858;padding:2px 8px;border-radius:100px;` +
                `font-size:0.77rem;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;flex-shrink:0;">` +
                `<span style="font-size:0.85rem;color:#ff5858;font-weight:800;">▲</span> ${esc((op.playerAlias || 'Jugador').substring(0, 15))}${outPerBadge}</span>`;

            const inPill = ip
                ? `<span style="background:rgba(63,185,80,0.10);color:#3fb950;padding:2px 8px;border-radius:100px;` +
                  `font-size:0.77rem;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;flex-shrink:0;">` +
                  `<span style="font-size:0.85rem;color:#3fb950;font-weight:800;">▼</span> ${esc((ip.playerAlias || 'Jugador').substring(0, 15))}</span>`
                : `<span style="font-size:0.77rem;color:var(--text-muted);font-style:italic;">banquillo</span>`;

            return (
                `<div style="display:flex;align-items:center;gap:7px;padding:6px 0;` +
                `border-bottom:${idx < subs.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'};flex-wrap:wrap;">` +
                `<span style="min-width:35px;font-size:0.7rem;font-weight:700;color:var(--text-muted);flex-shrink:0;">${sub.timeStr || formatTot(sub.min)}</span>` +
                outPill +
                `<span style="color:rgba(255,255,255,0.2);font-size:0.85rem;flex-shrink:0;">→</span>` +
                inPill +
                injBadge + retBadge +
                `</div>`
            );
        }).join('');

        return (
            `<div style="font-size:0.67rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Panel de rotaciones · Quién por quién</div>` +
            `<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:0.65rem 0.85rem;margin-bottom:0.85rem;">${rows}</div>`
        );
    };

    // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 5: REGISTRO CRONOLÓGICO DE INCIDENCIAS
    // ════════════════════════════════════════════════════════════════
    const buildEventsList = players => {
        const all = [];
        players.forEach(p => (p.history || []).forEach(ev => all.push({ ...ev, _p: p })));
        all.sort((a, b) => (a.minute || 0) - (b.minute || 0));

        const relevant = all.filter(ev => ['goal','yellow','red','injury','sub_in','sub_out'].includes(ev.type));
        if (!relevant.length) return '';

        const rows = relevant.map((ev, idx) => {
            // v218: sin "nº<num>"; solo nombre del jugador.
            const name = esc((ev._p.playerAlias || 'Jugador').substring(0, 16));
            let icon = '', col = 'var(--text-muted)', txt = '';

            if (ev.type === 'goal') {
                icon = `<span style="width:10px;height:10px;border-radius:50%;background:#3fb950;border:2px solid #27500A;display:inline-block;flex-shrink:0;"></span>`;
                // v218: GOL en MAYÚSCULAS (verde).
                col = '#3fb950'; txt = `<strong style="letter-spacing:0.5px;">GOL</strong> &middot; ${name}`;
            } else if (ev.type === 'yellow') {
                icon = `<span style="width:7px;height:10px;background:#eab308;border-radius:1px;display:inline-block;flex-shrink:0;"></span>`;
                // v218: TARJETA en MAYÚSCULAS (amarillo).
                col = '#eab308'; txt = `<strong style="letter-spacing:0.5px;">TARJETA</strong> &middot; ${name}`;
            } else if (ev.type === 'red') {
                icon = `<span style="width:7px;height:10px;background:#ef4444;border-radius:1px;display:inline-block;flex-shrink:0;"></span>`;
                // v218: TARJETA en MAYÚSCULAS (rojo).
                col = '#ff5858'; txt = `<strong style="letter-spacing:0.5px;">TARJETA</strong> &middot; ${name}`;
            } else if (ev.type === 'injury') {
                icon = `<span style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid #f97316;display:inline-block;flex-shrink:0;"></span>`;
                // v218: LESIÓN en MAYÚSCULAS (rojo).
                col = '#ef4444'; txt = `<strong style="letter-spacing:0.5px;">LESIÓN</strong> &middot; ${name}`;
            } else if (ev.type === 'sub_in') {
                // v219: ▼ verde = ENTRA al campo (hacia abajo).
                icon = `<span style="color:#3fb950;font-size:13px;line-height:1;flex-shrink:0;font-weight:800;">▼</span>`;
                col  = '#58a6ff';
                txt  = `<strong style="letter-spacing:0.5px;color:#58a6ff;">CAMBIO</strong> · <span style="color:#3fb950;">Entra</span> &middot; ${name}`;
            } else if (ev.type === 'sub_out') {
                // v219: ▲ roja = SALE del campo (hacia arriba).
                icon = `<span style="color:#ff5858;font-size:13px;line-height:1;flex-shrink:0;font-weight:800;">▲</span>`;
                col  = '#58a6ff';
                txt  = `<strong style="letter-spacing:0.5px;color:#58a6ff;">CAMBIO</strong> · <span style="color:#ff5858;">Sale</span> &middot; ${name}`;
            }

            return (
                `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;` +
                `border-bottom:${idx < relevant.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none'};font-size:0.76rem;">` +
                `<span style="min-width:35px;font-size:0.69rem;font-weight:700;color:var(--text-muted);flex-shrink:0;">${ev.timeStr || formatTot((ev.minute||0) + (ev.second||0)/60)}</span>` +
                icon +
                `<span style="color:${col};">${txt}</span>` +
                `</div>`
            );
        }).join('');

        return (
            `<div style="font-size:0.67rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Registro cronológico de incidencias</div>` +
            `<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:0.65rem 0.85rem;">${rows}</div>`
        );
    };

    // ════════════════════════════════════════════════════════════════
    //  TABLA RESUMEN — TIEMPO POR JUGADOR (cronómetro real)
    // ════════════════════════════════════════════════════════════════
    const buildTimeSummary = players => {
        const sorted = [...players].sort((a, b) => {
            const toSec = p => {
                const t = getExactTime(p);
                const [m, sc] = String(t).split(':').map(Number);
                return (m || 0) * 60 + (sc || 0);
            };
            return toSec(b) - toSec(a);
        });

        const rows = sorted.map((p, i) => {
            const t  = getExactTime(p);
            const bg = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'transparent';
            const goalBadge = (p.goals || 0) > 0
                ? `<span style="font-size:0.68rem;background:rgba(63,185,80,0.15);color:#3fb950;padding:1px 6px;border-radius:100px;">⚽ ${p.goals}</span>` : '';
            const cardBadge = p.cards === 'amarilla'
                ? `<span style="font-size:0.68rem;background:rgba(234,179,8,0.15);color:#eab308;padding:1px 6px;border-radius:100px;">🟨</span>`
                : p.cards === 'roja'
                ? `<span style="font-size:0.68rem;background:rgba(239,68,68,0.15);color:#ef4444;padding:1px 6px;border-radius:100px;">🟥</span>` : '';
            const injBadge = p.injured
                ? `<span style="font-size:0.68rem;background:rgba(249,115,22,0.15);color:#f97316;padding:1px 6px;border-radius:100px;">🚑</span>` : '';
            const badges = [goalBadge, cardBadge, injBadge].filter(Boolean).join(' ');

            return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:${bg};border-radius:5px;">
                <span style="min-width:22px;font-size:0.72rem;font-weight:700;color:rgba(255,255,255,0.35);text-align:right;">${esc(String(p.playerNumber || '?'))}</span>
                <span style="flex:1;font-size:0.8rem;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc((p.playerAlias || 'Jugador').substring(0, 22))}</span>
                <span style="display:flex;gap:3px;align-items:center;">${badges}</span>
                <span style="font-size:0.9rem;font-weight:800;color:white;letter-spacing:0.5px;font-variant-numeric:tabular-nums;min-width:46px;text-align:right;">${t}</span>
            </div>`;
        }).join('');

        return `<div style="font-size:0.67rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:1rem 0 0.4rem;">
            ⏱ Tiempo jugado por jugador
        </div>
        <div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:0.5rem 0.6rem;margin-bottom:0.9rem;">
            ${rows}
        </div>`;
    };

    // ════════════════════════════════════════════════════════════════
    //  ORQUESTADOR PRINCIPAL — build(matchData, currentUser)
    // ════════════════════════════════════════════════════════════════
    const build = (m, me) => {
        const totMin  = getTotMin(m);
        const stopMin = parseInt(m.stoppageTime) || 0;

        // 1. Deduplicar jugadores por número (quedarnos con el informe más completo/reciente)
        const uniquePlayers = {};
        m.players.forEach(p => {
            const num = p.playerNumber || '?';
            if (!uniquePlayers[num] || (p.history && p.history.length > (uniquePlayers[num].history || []).length)) {
                uniquePlayers[num] = p;
            }
        });

        // 2. Enriquecer y filtrar: Solo los que han tenido minutos de juego (convocados/participantes)
        const players = Object.values(uniquePlayers)
            .map(p => ({ ...p, _pos: getPos(p), _ivs: buildIvs(p, totMin) }))
            .filter(p => p.convocado || p._ivs.some(([a, b]) => b > a))
            .sort((a, b) => (parseInt(a.playerNumber) || 99) - (parseInt(b.playerNumber) || 99));

        players.forEach(p => { p._tot = calcTot(p._ivs); });
        
        // Guardar contador para las estadísticas
        m.participantsCount = players.length;

        const subs      = buildSubs(players);
        const clubName  = me?.clubName || 'CD Local';

        return (
            `<div style="padding:0.35rem 0 0.15rem;">` +
            buildHeader(m, clubName, totMin, stopMin) +
            buildStats(m) +
            `<div style="font-size:0.67rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:7px;">` +
            `Tiempos de partido · Línea individual por jugador</div>` +
            `<div style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:6px 4px;margin-bottom:4px;">` +
            buildPlayerTimelines(players, subs, totMin) +
            `</div>` +
            buildLegend() +
            buildTimeSummary(players) +
            buildRotPanel(subs) +
            buildEventsList(players) +
            `</div>`
        );
    };

    // Solo exponer build públicamente
    return { build };

})();

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
            const { doc, getDoc, updateDoc } = await _sdFS();
            const db = window._cronos_auth?.db;
            if (db) {
                clubId = await window._cResolveClubId(db, me, { doc, getDoc, updateDoc });
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
//  TAB: MENSAJES (mensajes recibidos desde entrenadores)
// ════════════════════════════════════════════════════════════════════
async function _sdLoadMessages() {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    if (!container) return;

    // FIX (v179): Intentar resolver clubId si no está disponible.
    let clubId = me.clubId;
    if (!clubId && me && me.uid && typeof window._cResolveClubId === 'function') {
        try {
            const { doc, getDoc, updateDoc } = await _sdFS();
            const db = window._cronos_auth?.db;
            if (db) {
                clubId = await window._cResolveClubId(db, me, { doc, getDoc, updateDoc });
                if (clubId) me.clubId = clubId;
            }
        } catch(e) {
            if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][_sdLoadMessages] clubId resolution falló:', e.message);
        }
    }

    if (!clubId) {
        container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">⚠️ Sin club asignado.</div>`;
        return;
    }

    try {
        const { db, collection, getDocs, query, where, doc, updateDoc } = await _sdFS();

        // FIX (v179): Cuatro consultas para máxima cobertura de hilos de mensajes.
        // Consulta A: staffUid == me.uid (hilos donde soy staff)
        // Consulta B: parentUid == me.uid (hilos donde soy padre/destinatario legacy)
        // Consulta C: participants array-contains me.uid (fallback si A y B fallan)
        // Consulta D: clubId == me.clubId (fallback para hilos antiguos sin
        //   staffUid/parentUid/participants pero con clubId; el director puede
        //   leerlos si userDocClubId funciona en las reglas Firestore)
        // FIX (v178): Log diagnóstico para mensajes

        const [snapStaff, snapParent, snapParticipants, snapClub] = await Promise.all([
            getDocs(query(collection(db,'cronos_messages'), where('staffUid','==',me.uid))).catch((e)=>{ if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG-MSG] Query staffUid falló:', e.code||e.message); return {forEach:()=>{}}; }),
            getDocs(query(collection(db,'cronos_messages'), where('parentUid','==',me.uid))).catch((e)=>{ if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG-MSG] Query parentUid falló:', e.code||e.message); return {forEach:()=>{}}; }),
            // FIX (v178): consulta fallback por participants — siempre funciona
            // porque las reglas de Firestore siempre han verificado uid in participants
            getDocs(query(collection(db,'cronos_messages'), where('participants','array-contains',me.uid))).catch((e)=>{ if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG-MSG] Query participants falló:', e.code||e.message); return {forEach:()=>{}}; }),
            // FIX (v179): consulta fallback por clubId — cubre hilos antiguos
            // que no tienen staffUid/parentUid/participants pero sí clubId
            getDocs(query(collection(db,'cronos_messages'), where('clubId','==',clubId))).catch((e)=>{ if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG-MSG] Query clubId falló:', e.code||e.message); return {forEach:()=>{}}; }),
        ]);

        // FIX (v179): Contar resultados de cada query para diagnóstico
        let _staffMsgCount = 0, _parentMsgCount = 0, _participantsMsgCount = 0, _clubMsgCount = 0;
        snapStaff.forEach(() => _staffMsgCount++);
        snapParent.forEach(() => _parentMsgCount++);
        snapParticipants.forEach(() => _participantsMsgCount++);
        snapClub.forEach(() => _clubMsgCount++);

        const threadsMap = {};
        snapStaff.forEach(d  => { threadsMap[d.id] = { _id:d.id, ...d.data() }; });
        snapParent.forEach(d => { if (!threadsMap[d.id]) threadsMap[d.id] = { _id:d.id, ...d.data() }; });
        // FIX (v178): fusionar resultados de participants
        snapParticipants.forEach(d => { if (!threadsMap[d.id]) threadsMap[d.id] = { _id:d.id, ...d.data() }; });
        // FIX (v179): fusionar resultados de clubId (solo hilos de staff)
        snapClub.forEach(d => {
            if (!threadsMap[d.id] && d.data().recipientType === 'staff') {
                threadsMap[d.id] = { _id:d.id, ...d.data() };
            }
        });

        const threads = Object.values(threadsMap)
            .sort((a,b) => (b.lastMessageAt||'').localeCompare(a.lastMessageAt||''));

        if (!threads.length) {
            container.innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="font-size:2rem;margin-bottom:0.8rem;">💬</div>
                Sin mensajes recibidos aún.<br>
                <span style="font-size:0.78rem;">Los mensajes de los entrenadores aparecerán aquí.</span>
            </div>`;
            return;
        }

        let html = `<div style="margin-bottom:0.8rem;font-size:0.78rem;color:var(--text-muted);">
            ${threads.length} conversación${threads.length!==1?'es':''}</div>`;

        threads.forEach(t => {
            const unread    = (t.unreadByStaff || t.unreadByParent || 0);
            const lastMsg   = t.lastMessage   || '—';
            const lastT     = t.lastMessageAt
                ? new Date(t.lastMessageAt).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
                : '';
            const isReport  = lastMsg.includes('📊');
            const isCollective = t.recipientType === 'staff' || (t.messages||[]).some(m=>m.type==='collective_report');

            html += `
            <div class="sd-card ${unread>0?'sd-report-unread':''}"
                 onclick="sdOpenStaffThread('${t._id}','${t.coachUid||''}','${(t.coachEmail||'').replace(/'/g,"\\'")}')"
                 style="cursor:pointer;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.88rem;margin-bottom:0.15rem;">
                        ${isCollective?'📊':'✉️'} ${escapeHtml(t.coachEmail||'Entrenador')}
                        ${unread>0?`<span style="background:${isReport?'#ffa500':'#58a6ff'};color:#0a0e14;
                            border-radius:10px;padding:1px 7px;font-size:0.62rem;
                            font-weight:700;margin-left:6px;">
                            ${unread} nuevo${unread>1?'s':''}</span>`:''}
                    </div>
                    <div style="font-size:0.76rem;
                                color:${unread?'#58a6ff':'var(--text-muted)'};
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${unread?`<strong>🔵 ${escapeHtml(lastMsg)}</strong>`:escapeHtml(lastMsg)}
                    </div>
                </div>
                <span style="font-size:0.68rem;color:var(--text-muted);flex-shrink:0;">${lastT}</span>
            </div>`;
        });

        container.innerHTML = html;

        window.sdOpenStaffThread = async (threadId, coachUid, coachEmail) => {
            if (typeof _loadThreadMessages === 'function') {
                const { db:db2, doc:doc2, updateDoc:upd } = await _sdFS();
                container.innerHTML = `
                <div style="display:flex;flex-direction:column;height:100%;">
                    <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1rem;flex-shrink:0;">
                        <button onclick="switchStaffTab('mensajes')"
                            style="padding:0.35rem 0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid var(--glass-border);border-radius:7px;
                                   color:var(--text-muted);font-size:0.74rem;cursor:pointer;">
                            ← Volver
                        </button>
                        <div style="font-weight:700;font-size:0.88rem;">💬 ${escapeHtml(coachEmail)}</div>
                    </div>
                    <div id="thread-messages"
                         style="flex:1;overflow-y:auto;display:flex;
                                flex-direction:column;gap:0.5rem;min-height:200px;">
                        <p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando…</p>
                    </div>
                    <div style="margin-top:0.7rem;border-top:1px solid var(--glass-border);
                                padding-top:0.7rem;flex-shrink:0;">
                        <div style="display:flex;gap:0.5rem;align-items:flex-end;">
                            <textarea id="staff-reply-input"
                                placeholder="Responder al entrenador… (Enter para enviar)"
                                rows="2"
                                style="flex:1;padding:0.55rem 0.75rem;
                                       background:rgba(255,255,255,0.06);
                                       border:1px solid var(--glass-border);border-radius:8px;
                                       color:white;font-size:0.85rem;resize:none;"
                                onkeydown="if(event.key==='Enter'&&!event.shiftKey){
                                    event.preventDefault();
                                    sdSendReplyToCoach('${threadId}','${coachUid}','${coachEmail}');
                                }">
                            </textarea>
                            <button onclick="sdSendReplyToCoach('${threadId}','${coachUid}','${coachEmail}')"
                                class="btn primary" style="padding:0.55rem 0.9rem;flex-shrink:0;">
                                Enviar ›
                            </button>
                        </div>
                    </div>
                </div>`;

                await _loadThreadMessages(threadId, 'parent');
                try {
                    const data = {};
                    data['unreadByStaff']  = 0;
                    data['unreadByParent'] = 0;
                    await upd(doc2(db2,'cronos_messages',threadId), data);
                } catch(_) {}
            } else {
                if (typeof showToast==='function') showToast('ℹ️ Módulo de mensajería no cargado.', 3000);
            }
        };

        window.sdSendReplyToCoach = async (threadId, coachUid, coachEmail) => {
            const input = document.getElementById('staff-reply-input');
            const text  = (input?.value||'').trim();
            if (!text) return;

            const { db:db2, doc:doc2, getDoc, updateDoc:upd, arrayUnion } = await _sdFS();
            const newMsg = { sender:'parent', text, timestamp:new Date().toISOString() };

            try {
                const snap = await getDoc(doc2(db2,'cronos_messages',threadId));
                const preview = text.length>60 ? text.substring(0,60)+'…' : text;
                if (snap.exists()) {
                    await upd(doc2(db2,'cronos_messages',threadId), {
                        messages: arrayUnion(newMsg),
                        lastMessage: preview, lastMessageAt: newMsg.timestamp,
                        unreadByCoach: (snap.data().unreadByCoach||0) + 1,
                    });
                }
                if (input) input.value = '';
                await _loadThreadMessages(threadId, 'parent');
            } catch(e) {
                if (typeof showToast==='function') showToast('⚠️ Error: '+e.message, 3000);
            }
        };

    } catch(e) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">⚠️ ${escapeHtml(e.message)}</div>`;
    }
}

window.openLiveMatchesView = () => {
    window.open('./live.html', '_blank');
};

window.openStaffDashboard = openStaffDashboard;
// ════════════════════════════════════════════════════════════════════
//  TAB: CONFIGURACIÓN DEL CLUB (Director)
// ════════════════════════════════════════════════════════════════════
async function _renderDirectorConfig() {
    const container = document.getElementById('staff-dashboard-content');
    const me = window._cronosCurrentUser;
    const clubId = me?.clubId;
    if (!clubId) {
        container.innerHTML = '<p style="color:var(--text-muted);padding:2rem;">Sin club asignado.</p>';
        return;
    }

    const { doc, getDoc } = await _sdFS();
    const db = window._cronos_auth?.db;
    const clubSnap = await getDoc(doc(db, 'clubs', clubId));
    const clubData = clubSnap.exists() ? clubSnap.data() : {};
    const features = clubData.features || {};
    const thresholds = clubData.timerThresholds || { red: 33, yellow: 50 };
    const sendReports = !!features.sendIndividualReports;

    container.innerHTML = `
    <div style="max-width:560px;">
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
                  border-radius:12px;padding:1.2rem;margin-bottom:1rem;">
        <div style="font-size:0.85rem;font-weight:700;color:white;margin-bottom:0.3rem;">
          Semaforo de tiempo de juego
        </div>
        <div style="font-size:0.72rem;color:#7d8590;margin-bottom:1rem;">
          Porcentaje del tiempo total que determina el color de cada jugador en el planometro.
        </div>
        <label style="display:flex;align-items:center;gap:1rem;margin-bottom:0.8rem;">
          <span style="width:90px;font-size:0.8rem;color:#da3633;font-weight:700;">Rojo hasta</span>
          <input type="range" id="dir-threshold-red" min="10" max="45" step="1"
                 value="${thresholds.red}"
                 oninput="document.getElementById('dir-red-val').textContent=this.value+'%'"
                 style="flex:1;accent-color:#da3633;">
          <span id="dir-red-val" style="width:38px;text-align:right;font-weight:700;color:#da3633;">
            ${thresholds.red}%
          </span>
        </label>
        <label style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;">
          <span style="width:90px;font-size:0.8rem;color:#e3b341;font-weight:700;">Amarillo hasta</span>
          <input type="range" id="dir-threshold-yellow" min="30" max="70" step="1"
                 value="${thresholds.yellow}"
                 oninput="document.getElementById('dir-yellow-val').textContent=this.value+'%'"
                 style="flex:1;accent-color:#e3b341;">
          <span id="dir-yellow-val" style="width:38px;text-align:right;font-weight:700;color:#e3b341;">
            ${thresholds.yellow}%
          </span>
        </label>
        <div style="font-size:0.7rem;color:#7d8590;margin-bottom:0.8rem;">
          Verde: del umbral amarillo hasta el final del partido.
        </div>
        <button onclick="window._dirSaveThresholds('${clubId}')"
            style="background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);
                   color:#58a6ff;padding:0.45rem 1.2rem;border-radius:7px;
                   font-size:0.82rem;font-weight:700;cursor:pointer;">
          Guardar semaforo
        </button>
      </div>

      <div style="background:rgba(210,168,255,0.06);border:1px solid rgba(210,168,255,0.2);
                  border-radius:12px;padding:1.2rem;">
        <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
          <input type="checkbox" id="dir-toggle-reports"
                 ${sendReports ? 'checked' : ''}
                 onchange="window._dirToggleReports('${clubId}', this.checked)"
                 style="width:20px;height:20px;accent-color:#d2a8ff;">
          <div>
            <div style="font-size:0.85rem;font-weight:700;color:white;">
              Enviar informes individualizados a padres
            </div>
            <div style="font-size:0.72rem;color:#7d8590;margin-top:0.15rem;">
              Cuando esta activo, los entrenadores pueden enviar el informe de cada jugador al padre vinculado.
            </div>
          </div>
        </label>
      </div>
    </div>`;
}

window._dirSaveThresholds = async function(clubId) {
    const red    = parseInt(document.getElementById('dir-threshold-red')?.value)    || 33;
    const yellow = parseInt(document.getElementById('dir-threshold-yellow')?.value) || 50;
    if (red >= yellow) { showToast('El umbral rojo debe ser menor que el amarillo.', 3000); return; }
    try {
        const { doc, updateDoc } = await _sdFS();
        const db = window._cronos_auth?.db;
        await updateDoc(doc(db, 'clubs', clubId), { timerThresholds: { red, yellow } });
        window._clubTimerThresholds = { red, yellow };
        showToast('Semaforo actualizado', 2500);
    } catch(e) { showToast('Error: ' + e.message, 4000); }
};

window._dirToggleReports = async function(clubId, value) {
    try {
        const { doc, updateDoc } = await _sdFS();
        const db = window._cronos_auth?.db;
        await updateDoc(doc(db, 'clubs', clubId), { 'features.sendIndividualReports': value });
        showToast('Informes a padres ' + (value ? 'activados' : 'desactivados'), 3000);
    } catch(e) { showToast('Error: ' + e.message, 4000); }
};

window._renderDirectorConfig = _renderDirectorConfig;

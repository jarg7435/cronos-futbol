// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Staff Dashboard (Director / Coordinador) v3.0
//
//  CORRECCIONES v3.0:
//  - "Actualizar" ya no duplica el panel: refresca solo el tab activo
//  - Tab "En Vivo" usa onSnapshot en tiempo real (Firestore)
//  - Sin acumulación de filas vacías al actualizar sin partido
//  - Botones del header reorganizados y limpios
//  - Timeline con goles, tarjetas, cambios y lesiones
//  - Listener de tiempo real se cancela al cambiar de tab
// ════════════════════════════════════════════════════════════════════

'use strict';

// ── Helper Firestore ─────────────────────────────────────────────────
async function _sdFS() {
    const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...m, db: window._cronos_auth?.db };
}

// ── Tab activo y listener de tiempo real ────────────────────────────
window._sdCurrentTab        = 'convocatorias';
window._sdLiveUnsubscribe   = null;   // cancela el onSnapshot de En Vivo

function _sdCancelLiveListener() {
    if (typeof window._sdLiveUnsubscribe === 'function') {
        window._sdLiveUnsubscribe();
        window._sdLiveUnsubscribe = null;
    }
}

// ════════════════════════════════════════════════════════════════════
//  MODO PRUEBA MULTI-ROL — Solo SuperAdmin
// ════════════════════════════════════════════════════════════════════
window._testRoleClubId = null;

async function openTestRolePicker(targetRole) {
    const me = window._cronosCurrentUser;
    if (!['superadmin', 'admin'].includes(me?.role)) return;

    const { db, collection, getDocs } = await _sdFS();
    const snap  = await getDocs(collection(db, 'clubs'));
    const clubs = [];
    snap.forEach(d => clubs.push({ id: d.id, ...d.data() }));

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="max-width:460px;padding:1.5rem;">
        <div style="display:flex;justify-content:space-between;
                    align-items:center;margin-bottom:1.2rem;">
            <div>
                <h3 style="margin:0;font-size:1rem;">🧪 Modo Prueba — ${targetRole}</h3>
                <p style="margin:0.2rem 0 0;font-size:0.75rem;color:var(--text-muted);">
                    Selecciona el club en el que quieres actuar como <strong>${targetRole}</strong>
                </p>
            </div>
            <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.4rem;cursor:pointer;">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.5rem;
                    max-height:380px;overflow-y:auto;">
            ${clubs.length === 0
                ? `<p style="color:var(--text-muted);text-align:center;padding:2rem;">
                       No hay clubes creados.</p>`
                : clubs.map(c => `
                <button onclick="window._applyTestRole('${c.id}',
                            '${(c.name||'').replace(/'/g,"\\'")}','${targetRole}')"
                    style="text-align:left;padding:0.9rem 1rem;
                           background:rgba(255,255,255,0.04);
                           border:1px solid rgba(255,255,255,0.1);
                           border-radius:10px;color:white;font-size:0.88rem;
                           cursor:pointer;transition:all 0.2s;"
                    onmouseover="this.style.background='rgba(88,166,255,0.1)';
                                 this.style.borderColor='rgba(88,166,255,0.3)';"
                    onmouseout="this.style.background='rgba(255,255,255,0.04)';
                                this.style.borderColor='rgba(255,255,255,0.1)';">
                    🏟️ <strong>${c.name || c.id}</strong>
                    <span style="font-size:0.7rem;color:var(--text-muted);
                                 display:block;margin-top:2px;">
                        ${c.adminEmail || 'Sin admin'} · Plan: ${c.plan || 'free'}
                    </span>
                </button>`).join('')}
        </div>
    </div>`;

    window._applyTestRole = (clubId, clubName, role) => {
        window._testRoleClubId = clubId;
        window._cronosCurrentUser.clubId    = clubId;
        window._cronosCurrentUser.clubName  = clubName;
        window._cronosCurrentUser._activeRole =
            role === 'director' ? 'director' : 'coordinator';
        if (typeof showToast === 'function')
            showToast(`🧪 Modo prueba: ${role} en "${clubName}"`, 3500);
        modal.style.display = 'none';
        if (role === 'director' || role === 'coordinator') {
            openStaffDashboard();
        } else if (role === 'coach' || role === 'user') {
            if (typeof init === 'function') init('user');
        } else if (role === 'parent') {
            if (typeof openParentPanel === 'function') openParentPanel();
        } else if (role === 'club_admin') {
            if (typeof openClubAdminPanel === 'function') openClubAdminPanel(clubId);
        }
    };
}
window.openTestRolePicker = openTestRolePicker;

// ════════════════════════════════════════════════════════════════════
//  PANEL PRINCIPAL
// ════════════════════════════════════════════════════════════════════
async function openStaffDashboard() {
    const me         = window._cronosCurrentUser;
    const activeRole = me?._activeRole || me?.role;
    const isSA       = ['superadmin', 'admin'].includes(me?.role);

    if (isSA && !me?.clubId) {
        await openTestRolePicker('director');
        return;
    }
    if (!me || (!isSA && !['director', 'coordinator'].includes(activeRole))) {
        if (typeof showToast === 'function')
            showToast('⚠️ Sin permisos para el panel de dirección.', 4000);
        return;
    }

    // Si el panel ya existe, solo refrescar el tab activo
    const existing = document.getElementById('sd-panel');
    if (existing && existing.style.display !== 'none') {
        switchStaffTab(window._sdCurrentTab || 'convocatorias');
        return;
    }

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" id="sd-panel"
         style="width:min(96vw,960px);max-height:94vh;
                display:flex;flex-direction:column;overflow:hidden;
                padding:0;background:#0d1117;">

        <!-- ── Header ──────────────────────────────────────────── -->
        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:0.9rem 1.2rem;
                    background:linear-gradient(to right,#161b22,#0d1117);
                    border-bottom:1px solid var(--glass-border);flex-shrink:0;
                    flex-wrap:wrap;gap:0.4rem;">
            <div>
                <h2 style="margin:0;font-size:1.05rem;display:flex;
                            align-items:center;gap:0.6rem;flex-wrap:wrap;">
                    🏢 <span style="color:var(--primary);">
                        ${me.clubName || 'Mi Club'}
                    </span>
                    ${isSA ? `<span style="font-size:0.62rem;
                        background:rgba(255,215,0,0.12);
                        border:1px solid rgba(255,215,0,0.3);color:#ffd700;
                        padding:2px 7px;border-radius:5px;font-weight:700;">
                        🧪 PRUEBA</span>` : ''}
                </h2>
                <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.1rem;">
                    ${activeRole === 'director'
                        ? '📋 Director Deportivo'
                        : '🎯 Coordinador'}
                </div>
            </div>
            <!-- Botones del header -->
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
                ${isSA ? `
                <button onclick="openTestRolePicker('director')"
                    style="padding:0.35rem 0.7rem;
                           background:rgba(255,215,0,0.08);
                           border:1px solid rgba(255,215,0,0.3);
                           border-radius:7px;color:#ffd700;
                           font-size:0.7rem;font-weight:700;cursor:pointer;">
                    🔄 Cambiar Club
                </button>` : ''}
                <button id="sd-btn-refresh"
                        onclick="switchStaffTab(window._sdCurrentTab || 'convocatorias')"
                        title="Actualizar pestaña actual"
                        style="padding:0.35rem 0.7rem;
                               background:rgba(255,255,255,0.05);
                               border:1px solid var(--glass-border);
                               border-radius:7px;color:white;
                               font-size:0.7rem;cursor:pointer;">
                    🔄 Actualizar
                </button>
                <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                    style="padding:0.35rem 0.7rem;
                           background:rgba(255,215,0,0.07);
                           border:1px solid rgba(255,215,0,0.25);
                           border-radius:7px;color:#ffd700;
                           font-size:0.7rem;font-weight:700;cursor:pointer;">
                    ⇄ Cambiar Rol
                </button>
                <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();
                                 else if(typeof logoutUser==='function')logoutUser();"
                    style="padding:0.35rem 0.7rem;
                           background:rgba(255,88,88,0.1);
                           border:1px solid rgba(255,88,88,0.35);
                           border-radius:7px;color:#ff5858;
                           font-size:0.7rem;font-weight:700;cursor:pointer;">
                    🚪 Salir
                </button>
            </div>
        </div>

        <!-- ── Tabs ─────────────────────────────────────────────── -->
        <div style="display:flex;gap:0;padding:0 1rem;background:#161b22;
                    border-bottom:1px solid var(--glass-border);
                    flex-shrink:0;overflow-x:auto;
                    -webkit-overflow-scrolling:touch;">
            <button onclick="switchStaffTab('convocatorias')"
                    class="staff-tab active" id="tab-convocatorias">
                📋 Convocatorias
            </button>
            <button onclick="switchStaffTab('entrenamientos')"
                    class="staff-tab" id="tab-entrenamientos">
                🕒 Entrenamientos
            </button>
            <button onclick="switchStaffTab('informes')"
                    class="staff-tab" id="tab-informes">
                📊 Informes
            </button>
            <button onclick="switchStaffTab('envivo')"
                    class="staff-tab" id="tab-envivo"
                    style="color:#3fb950;">
                🔴 En Vivo
            </button>
            <button onclick="switchStaffTab('mensajes')"
                    class="staff-tab" id="tab-mensajes">
                💬 Mensajes
            </button>
        </div>

        <!-- ── Contenido ─────────────────────────────────────────── -->
        <div id="staff-dashboard-content"
             style="flex:1;overflow-y:auto;padding:1.2rem;
                    background:#0d1117;
                    -webkit-overflow-scrolling:touch;">
            <div style="text-align:center;padding:4rem;
                        color:var(--text-muted);">⏳ Cargando…</div>
        </div>
    </div>

    <style>
        .staff-tab {
            padding:0.6rem 1rem;background:none;border:none;
            border-bottom:2px solid transparent;
            color:var(--text-muted,#8b949e);
            font-size:0.8rem;font-weight:600;cursor:pointer;
            white-space:nowrap;transition:all 0.2s;flex-shrink:0;
        }
        .staff-tab:hover { color:white; }
        .staff-tab.active {
            color:var(--primary,#58a6ff);
            border-bottom-color:var(--primary,#58a6ff);
            background:rgba(88,166,255,0.05);
        }
        .sd-card {
            background:rgba(255,255,255,0.03);
            border:1px solid var(--glass-border,rgba(255,255,255,0.1));
            border-radius:12px;padding:0.85rem 1rem;margin-bottom:0.7rem;
            display:flex;justify-content:space-between;
            align-items:center;gap:0.8rem;transition:border-color 0.2s;
        }
        .sd-card:hover { border-color:rgba(88,166,255,0.3); }
        .sd-badge {
            font-size:0.65rem;font-weight:700;padding:2px 7px;
            border-radius:5px;text-transform:uppercase;
        }
        .sd-report-card {
            background:rgba(255,255,255,0.03);
            border:1px solid rgba(88,166,255,0.15);
            border-radius:12px;padding:0.9rem 1.1rem;
            margin-bottom:0.7rem;cursor:pointer;transition:all 0.2s;
        }
        .sd-report-card:hover {
            border-color:rgba(88,166,255,0.45);
            background:rgba(88,166,255,0.04);
        }
        .sd-timeline {
            display:flex;flex-wrap:wrap;gap:0.4rem 0.7rem;
            padding:0.55rem 0.65rem;
            background:rgba(255,255,255,0.025);
            border-radius:7px;font-size:0.72rem;
            border:1px solid rgba(255,255,255,0.06);
            margin-top:0.7rem;
        }
        .sd-tl-ev {
            display:inline-flex;align-items:center;gap:0.25rem;
            white-space:nowrap;color:var(--text-muted,#8b949e);
        }
        .sd-tl-ev strong { color:white; }
        .sd-live-card {
            background:rgba(63,185,80,0.04);
            border:1px solid rgba(63,185,80,0.2);
            border-radius:12px;padding:1rem;margin-bottom:0.8rem;
        }
        .sd-live-card.active-match {
            border-color:rgba(63,185,80,0.6);
            box-shadow:0 0 12px rgba(63,185,80,0.12);
        }
        @keyframes sdPulse {
            0%,100% { opacity:1; } 50% { opacity:0.4; }
        }
        .sd-live-dot {
            width:8px;height:8px;border-radius:50%;
            background:#3fb950;display:inline-block;
            animation:sdPulse 1.4s ease-in-out infinite;
        }
    </style>`;

    switchStaffTab('convocatorias');
}

// ════════════════════════════════════════════════════════════════════
//  switchStaffTab — cambia la pestaña activa y carga su contenido
// ════════════════════════════════════════════════════════════════════
window.switchStaffTab = async function switchStaffTab(tab) {
    // Cancelar cualquier listener de tiempo real previo
    _sdCancelLiveListener();

    window._sdCurrentTab = tab;

    document.querySelectorAll('.staff-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`tab-${tab}`);
    if (btn) btn.classList.add('active');

    const container = document.getElementById('staff-dashboard-content');
    if (container) {
        container.innerHTML = `
            <div style="text-align:center;padding:3rem;
                        color:var(--text-muted,#8b949e);">⏳ Cargando…</div>`;
    }

    if      (tab === 'convocatorias')  await _sdLoadEvents('convocatoria');
    else if (tab === 'entrenamientos') await _sdLoadEvents('planificacion_semanal');
    else if (tab === 'informes')       await _sdLoadReports();
    else if (tab === 'envivo')         await _sdLoadLive();
    else if (tab === 'mensajes')       await _sdLoadMessages();
};

// ════════════════════════════════════════════════════════════════════
//  TAB: CONVOCATORIAS / ENTRENAMIENTOS
// ════════════════════════════════════════════════════════════════════
async function _sdLoadEvents(type) {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    if (!container) return;

    try {
        const { db, collection, getDocs, query, where, limit } = await _sdFS();
        const clubId = me.clubId || 'demo';
        const snap   = await getDocs(query(
            collection(db, 'cronos_notifications'),
            where('clubId', '==', clubId),
            where('type',   '==', type),
            limit(60),
        ));

        if (snap.empty) {
            container.innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:0.8rem;">
                    ${type === 'convocatoria' ? '📋' : '🕒'}
                </div>
                Sin ${type === 'convocatoria' ? 'convocatorias' : 'entrenamientos'}
                registrados aún.
            </div>`;
            return;
        }

        // Ordenar en memoria por fecha descendente
        const docs = [];
        snap.forEach(d => docs.push({ _id: d.id, ...d.data() }));
        docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        let html = `
        <div style="margin-bottom:0.8rem;font-size:0.78rem;color:var(--text-muted);">
            ${docs.length} registro${docs.length !== 1 ? 's' : ''} —
            ${type === 'convocatoria' ? '📋 Convocatorias' : '🕒 Entrenamientos'}
        </div>`;

        docs.forEach(d => {
            const date = d.createdAt
                ? new Date(d.createdAt).toLocaleString('es-ES', {
                    day:'2-digit', month:'2-digit',
                    hour:'2-digit', minute:'2-digit'
                  })
                : '—';
            html += `
            <div class="sd-card">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;
                                gap:0.5rem;margin-bottom:0.3rem;">
                        <span class="sd-badge"
                              style="background:${type==='convocatoria'
                                ? 'rgba(88,166,255,0.15)':'rgba(210,168,255,0.15)'};
                                     color:${type==='convocatoria'
                                ? 'var(--primary)':'#d2a8ff'};">
                            ${type}
                        </span>
                        <span style="font-size:0.7rem;color:var(--text-muted);">
                            ${date}
                        </span>
                    </div>
                    <div style="font-weight:700;font-size:0.92rem;
                                margin-bottom:0.1rem;">
                        ${type==='convocatoria'
                            ? `🆚 vs ${d.rival || 'Rival'}`
                            : `⚽ ${d.category || 'Entrenamiento'}`}
                    </div>
                    <div style="font-size:0.74rem;color:var(--text-muted);">
                        Por: <strong>${d.coachEmail || 'Entrenador'}</strong>
                        ${d.players ? ` · 👥 ${d.players.length} convocados` : ''}
                    </div>
                </div>
                <button onclick="sdViewEventDetail('${d._id}')"
                        style="padding:0.4rem 0.8rem;background:rgba(88,166,255,0.1);
                               border:1px solid rgba(88,166,255,0.3);border-radius:8px;
                               color:var(--primary);font-size:0.74rem;cursor:pointer;
                               flex-shrink:0;">
                    Ver detalles
                </button>
            </div>`;
        });

        container.innerHTML = html;

        window.sdViewEventDetail = async (id) => {
            const { db: db2, doc, getDoc } = await _sdFS();
            const s = await getDoc(doc(db2, 'cronos_notifications', id));
            if (!s.exists()) return;
            const d   = s.data();
            let txt   = d.fullText || d.extra || 'Sin detalles.';
            if (d.players?.length) txt += '\n\nConvocados:\n' + d.players.join(', ');
            alert(txt);
        };

    } catch (e) {
        if (container) container.innerHTML = `
            <div style="text-align:center;padding:2rem;color:#ff5858;">
                ⚠️ ${e.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════════════
//  TAB: INFORMES DE PARTIDO con línea de tiempo completa
// ════════════════════════════════════════════════════════════════════
async function _sdLoadReports() {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    if (!container) return;

    const clubId = me.clubId;
    if (!clubId) {
        container.innerHTML = `
        <div style="text-align:center;padding:3rem;color:var(--text-muted);">
            ⚠️ Sin club asignado.</div>`;
        return;
    }

    try {
        const { db, collection, getDocs, query, where, limit } = await _sdFS();

        const snap = await getDocs(query(
            collection(db, 'cronos_player_reports'),
            where('clubId', '==', clubId),
            limit(150),
        ));

        if (snap.empty) {
            container.innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:1rem;">📊</div>
                <div style="font-size:0.95rem;font-weight:600;margin-bottom:0.4rem;">
                    Sin informes de partido aún</div>
                <div style="font-size:0.8rem;">
                    Los informes aparecen aquí cuando el entrenador finaliza
                    un partido y pulsa <strong>"Enviar Informe"</strong>.
                </div>
            </div>`;
            return;
        }

        // Agrupar por partido
        const matches = {};
        snap.forEach(docSnap => {
            const r   = { _id: docSnap.id, ...docSnap.data() };
            const key = `${r.matchDate || 'sin-fecha'}_${r.rival || 'sin-rival'}_${r.coachUid || ''}`;
            if (!matches[key]) {
                matches[key] = {
                    key,
                    matchDate:  r.matchDate,
                    rival:      r.rival,
                    scoreHome:  r.scoreHome,
                    scoreAway:  r.scoreAway,
                    coachEmail: r.coachEmail,
                    teamName:   r.teamName || me.clubName || '',
                    createdAt:  r.createdAt,
                    players:    [],
                };
            }
            matches[key].players.push(r);
        });

        const sorted = Object.values(matches).sort(
            (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        let html = `
        <div style="margin-bottom:0.9rem;display:flex;
                    justify-content:space-between;align-items:center;">
            <h3 style="margin:0;font-size:0.92rem;color:white;">
                📊 ${sorted.length} partido${sorted.length !== 1 ? 's' : ''}
                con informes
            </h3>
            <span style="font-size:0.72rem;color:var(--text-muted);">
                Club: <strong style="color:var(--primary);">
                    ${me.clubName || clubId}</strong>
            </span>
        </div>`;

        sorted.forEach((m, idx) => {
            const goals   = m.players.reduce((s, p) => s + (p.goals || 0), 0);
            const injured = m.players.filter(p => p.injured).length;
            const cards   = m.players.filter(p => p.cards && p.cards !== 'ninguna').length;
            const dateStr = m.matchDate
                ? new Date(m.matchDate).toLocaleDateString('es-ES',
                    { day:'2-digit', month:'long', year:'numeric' })
                : '—';
            const score = (m.scoreHome != null && m.scoreAway != null)
                ? `${m.scoreHome} – ${m.scoreAway}` : '—';
            const key64 = btoa(unescape(encodeURIComponent(m.key))).replace(/=/g, '');

            // ── Construir línea de tiempo del partido ──────────────
            const allEvents = [];
            m.players.forEach(p => {
                const alias = p.playerAlias || `#${p.playerNumber || '?'}`;
                (p.history || []).forEach(ev => {
                    allEvents.push({ ...ev, playerAlias: alias });
                });
                // Añadir entrada/salida si están como campos directos
                if (p.subInMinute)  allEvents.push({ type:'sub_in',  minute: p.subInMinute,  playerAlias: alias });
                if (p.subOutMinute) allEvents.push({ type:'sub_out', minute: p.subOutMinute, playerAlias: alias });
                if (p.injuryMinute) allEvents.push({ type:'injury',  minute: p.injuryMinute, playerAlias: alias });
            });
            allEvents.sort((a, b) => (a.minute || 0) - (b.minute || 0));

            const evIcon = {
                goal:    '⚽', yellow: '🟨', red:    '🟥',
                sub_in:  '▶️', sub_out:'⏸️', injury: '🩹',
            };
            const timelineHtml = allEvents.length
                ? `<div class="sd-timeline">
                    <strong style="color:white;font-size:0.7rem;
                                   width:100%;display:block;margin-bottom:0.2rem;">
                        📋 Línea de tiempo</strong>
                    ${allEvents.map(ev => `
                    <span class="sd-tl-ev">
                        <strong>${ev.minute || '?'}'</strong>
                        ${evIcon[ev.type] || '•'}
                        ${ev.playerAlias}
                    </span>`).join('')}
                </div>` : '';

            html += `
            <div class="sd-report-card" id="rcard-${key64}">
                <!-- Cabecera del partido (siempre visible) -->
                <div onclick="sdToggleReport('${key64}')"
                     style="display:flex;justify-content:space-between;
                            align-items:start;gap:0.5rem;">
                    <div>
                        <div style="font-weight:700;font-size:0.97rem;">
                            🆚 vs <span style="color:var(--primary);">
                                ${m.rival || 'Sin rival'}</span>
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);
                                    margin-top:2px;">
                            📅 ${dateStr} ·
                            Marcador: <strong style="color:white;">${score}</strong> ·
                            👤 ${m.coachEmail || 'Entrenador'}
                        </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;">
                        <span class="sd-badge"
                              style="background:rgba(63,185,80,0.12);color:#3fb950;">
                            ${m.players.length} jugadores
                        </span>
                        ${goals > 0 ? `
                        <span class="sd-badge"
                              style="background:rgba(255,165,0,0.12);color:#ffa500;
                                     margin-left:3px;">
                            ⚽ ${goals}
                        </span>` : ''}
                        ${cards > 0 ? `
                        <span class="sd-badge"
                              style="background:rgba(255,215,0,0.1);color:#ffd700;
                                     margin-left:3px;">
                            🟨 ${cards}
                        </span>` : ''}
                        ${injured > 0 ? `
                        <span class="sd-badge"
                              style="background:rgba(255,88,88,0.12);color:#ff5858;
                                     margin-left:3px;">
                            🩹 ${injured}
                        </span>` : ''}
                        <div style="font-size:0.62rem;color:var(--text-muted);
                                    margin-top:3px;">
                            ▼ Ver detalles
                        </div>
                    </div>
                </div>

                <!-- Detalle (oculto por defecto) -->
                <div id="rdetail-${key64}"
                     style="display:none;margin-top:0.8rem;
                            border-top:1px solid var(--glass-border);
                            padding-top:0.8rem;">

                    <!-- Línea de tiempo -->
                    ${timelineHtml}

                    <!-- Tabla de jugadores -->
                    <div style="overflow-x:auto;margin-top:0.6rem;">
                    <table style="width:100%;border-collapse:collapse;
                                  font-size:0.76rem;min-width:420px;">
                        <thead>
                            <tr style="color:var(--text-muted);
                                       border-bottom:1px solid rgba(255,255,255,0.08);">
                                <th style="padding:0.3rem 0.4rem;text-align:left;">Nº</th>
                                <th style="padding:0.3rem 0.4rem;text-align:left;">Jugador</th>
                                <th style="padding:0.3rem 0.4rem;text-align:center;">⏱ Min</th>
                                <th style="padding:0.3rem 0.4rem;text-align:center;">⚽</th>
                                <th style="padding:0.3rem 0.4rem;text-align:center;">🎴</th>
                                <th style="padding:0.3rem 0.4rem;text-align:center;">🩹</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${m.players
                                .sort((a, b) => (a.playerNumber||0) - (b.playerNumber||0))
                                .map(p => `
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                                    <td style="padding:0.3rem 0.4rem;
                                               color:var(--primary);font-weight:700;">
                                        ${p.playerNumber || '—'}
                                    </td>
                                    <td style="padding:0.3rem 0.4rem;font-weight:600;">
                                        ${p.playerAlias || 'Jugador'}
                                    </td>
                                    <td style="padding:0.3rem 0.4rem;text-align:center;">
                                        ${p.minutesPlayed || '—'}
                                    </td>
                                    <td style="padding:0.3rem 0.4rem;text-align:center;">
                                        ${p.goals > 0
                                            ? `<strong style="color:#ffa500;">
                                                ${p.goals}</strong>`
                                            : '—'}
                                    </td>
                                    <td style="padding:0.3rem 0.4rem;text-align:center;">
                                        ${p.cards && p.cards !== 'ninguna'
                                            ? `<span style="font-size:0.78rem;">
                                                ${p.cards==='red' || p.cards==='roja'
                                                    ? '🟥' : '🟨'}</span>`
                                            : '—'}
                                    </td>
                                    <td style="padding:0.3rem 0.4rem;text-align:center;">
                                        ${p.injured ? '🩹' : '—'}
                                    </td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                    </div>
                </div>
            </div>`;
        });

        container.innerHTML = html;

        window.sdToggleReport = (key64) => {
            const card   = document.getElementById(`rcard-${key64}`);
            const detail = document.getElementById(`rdetail-${key64}`);
            if (!detail) return;
            const isOpen = detail.style.display !== 'none';
            detail.style.display = isOpen ? 'none' : 'block';
            if (card) card.style.borderColor = isOpen
                ? 'rgba(88,166,255,0.15)'
                : 'rgba(88,166,255,0.55)';
        };

    } catch (e) {
        console.error('[StaffDashboard] informes:', e);
        if (container) container.innerHTML = `
            <div style="text-align:center;padding:2rem;color:#ff5858;">
                ⚠️ ${e.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════════════
//  TAB: EN VIVO — suscripción en tiempo real con onSnapshot
// ════════════════════════════════════════════════════════════════════
async function _sdLoadLive() {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    if (!container) return;

    const clubId = me.clubId;
    if (!clubId) {
        container.innerHTML = `
        <div style="text-align:center;padding:3rem;color:var(--text-muted);">
            ⚠️ Sin club asignado.</div>`;
        return;
    }

    // Cabecera fija del tab
    container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;
                margin-bottom:0.9rem;">
        <h3 style="margin:0;font-size:0.92rem;color:white;
                   display:flex;align-items:center;gap:0.5rem;">
            <span class="sd-live-dot"></span> Partidos en Vivo
        </h3>
        <span style="font-size:0.7rem;color:var(--text-muted);">
            Actualización automática en tiempo real
        </span>
    </div>
    <div id="sd-live-list">
        <div style="text-align:center;padding:3rem;color:var(--text-muted);">
            ⏳ Conectando…
        </div>
    </div>`;

    try {
        const { db, collection, query, where, onSnapshot } = await _sdFS();

        const q = query(
            collection(db, 'cronos_live_matches'),
            where('clubId', '==', clubId),
        );

        // Suscribirse en tiempo real — se actualiza solo sin intervención
        window._sdLiveUnsubscribe = onSnapshot(q, (snap) => {
            const liveList = document.getElementById('sd-live-list');
            if (!liveList) return;   // tab ya cambió

            if (snap.empty) {
                liveList.innerHTML = `
                <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                    <div style="font-size:2.5rem;margin-bottom:0.8rem;">🏟️</div>
                    No hay partidos en curso en este momento.
                    <br>
                    <span style="font-size:0.78rem;margin-top:0.5rem;display:block;">
                        Cuando un entrenador inicie un partido aparecerá aquí
                        automáticamente.
                    </span>
                </div>`;
                return;
            }

            const evIcon = {
                goal:'⚽', yellow:'🟨', red:'🟥',
                sub_in:'▶️', sub_out:'⏸️', injury:'🩹',
            };

            let html = '';
            snap.forEach(docSnap => {
                const m      = docSnap.data();
                const isLive = m.status === 'live' || m.isPlaying;
                const score  = `${m.scoreHome ?? 0} – ${m.scoreAway ?? 0}`;

                // Últimos 5 eventos de la línea de tiempo
                const events = (m.timeline || [])
                    .slice(-5)
                    .reverse();

                html += `
                <div class="sd-live-card ${isLive ? 'active-match' : ''}">
                    <div style="display:flex;justify-content:space-between;
                                align-items:start;margin-bottom:0.6rem;">
                        <div>
                            <div style="font-weight:700;font-size:1rem;">
                                🆚 vs <span style="color:${isLive ? '#3fb950' : 'var(--primary)'};">
                                    ${m.rival || 'Rival'}
                                </span>
                            </div>
                            <div style="font-size:0.72rem;color:var(--text-muted);
                                        margin-top:2px;">
                                👤 ${m.coachEmail || 'Entrenador'} ·
                                ${m.phase || '1ª parte'}
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:1.5rem;font-weight:800;
                                        color:${isLive ? '#3fb950' : 'white'};">
                                ${score}
                            </div>
                            <div style="font-size:0.68rem;color:${isLive ? '#3fb950' : 'var(--text-muted)'};">
                                ${isLive
                                    ? `<span class="sd-live-dot"></span> EN VIVO`
                                    : '⏸ Pausado'}
                                ${m.matchMinute ? ` · ${m.matchMinute}'` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Jugadores en campo -->
                    ${m.onField && m.onField.length ? `
                    <div style="font-size:0.72rem;color:var(--text-muted);
                                margin-bottom:0.4rem;">
                        En campo:
                        <span style="color:white;">
                            ${(m.onField || []).slice(0,11).map(p =>
                                `${p.alias || p.name || '#'+p.number}`
                            ).join(', ')}
                        </span>
                    </div>` : ''}

                    <!-- Últimos eventos -->
                    ${events.length ? `
                    <div class="sd-timeline">
                        <strong style="color:white;font-size:0.68rem;
                                       width:100%;display:block;margin-bottom:0.2rem;">
                            Últimas acciones</strong>
                        ${events.map(ev => `
                        <span class="sd-tl-ev">
                            <strong>${ev.minute || '?'}'</strong>
                            ${evIcon[ev.type] || '•'}
                            ${ev.playerAlias || ev.player || ''}
                        </span>`).join('')}
                    </div>` : ''}
                </div>`;
            });

            liveList.innerHTML = html;
        },
        (err) => {
            console.error('[sdLive] onSnapshot error:', err);
            const liveList = document.getElementById('sd-live-list');
            if (liveList) liveList.innerHTML = `
                <div style="text-align:center;padding:2rem;color:#ff5858;">
                    ⚠️ ${err.message}</div>`;
        });

    } catch (e) {
        const liveList = document.getElementById('sd-live-list');
        if (liveList) liveList.innerHTML = `
            <div style="text-align:center;padding:2rem;color:#ff5858;">
                ⚠️ ${e.message}</div>`;
        console.error('[sdLoadLive]', e);
    }
}

// ════════════════════════════════════════════════════════════════════
//  TAB: MENSAJES
// ════════════════════════════════════════════════════════════════════
async function _sdLoadMessages() {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    if (!container) return;

    const clubId = me.clubId;
    if (!clubId) {
        container.innerHTML = `
        <div style="text-align:center;padding:3rem;color:var(--text-muted);">
            ⚠️ Sin club asignado.</div>`;
        return;
    }

    try {
        const { db, collection, getDocs, query, where } = await _sdFS();

        const snap = await getDocs(query(
            collection(db, 'cronos_messages'),
            where('parentUid', '==', me.uid),
        ));

        if (snap.empty) {
            container.innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="font-size:2rem;margin-bottom:0.8rem;">💬</div>
                Sin mensajes recibidos aún.<br>
                <span style="font-size:0.78rem;">
                    Los mensajes de los entrenadores aparecerán aquí.</span>
            </div>`;
            return;
        }

        const threads = [];
        snap.forEach(d => threads.push({ _id: d.id, ...d.data() }));
        threads.sort((a, b) =>
            (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

        let html = `
        <div style="margin-bottom:0.8rem;font-size:0.78rem;
                    color:var(--text-muted);">
            ${snap.size} hilo${snap.size !== 1 ? 's' : ''} de mensajes
        </div>`;

        threads.forEach(t => {
            const unread  = t.unreadByParent || 0;
            const lastMsg = t.lastMessage || '—';
            const lastT   = t.lastMessageAt
                ? new Date(t.lastMessageAt).toLocaleDateString('es-ES',
                    { day:'numeric', month:'short' })
                : '';
            html += `
            <div class="sd-card ${unread > 0 ? 'sd-report-unread' : ''}"
                 onclick="sdOpenThread('${t._id}','${t.coachUid || ''}',
                          '${(t.coachEmail||'').replace(/'/g,"\\'")}')"
                 style="cursor:pointer;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.87rem;
                                margin-bottom:0.12rem;">
                        ✉️ ${t.coachEmail || 'Entrenador'}
                        ${unread > 0 ? `
                        <span style="background:#58a6ff;color:#0a0e14;
                                     border-radius:10px;padding:1px 7px;
                                     font-size:0.62rem;font-weight:700;
                                     margin-left:6px;">
                            ${unread} nuevo${unread > 1 ? 's' : ''}
                        </span>` : ''}
                    </div>
                    <div style="font-size:0.74rem;
                                color:${unread ? '#58a6ff' : 'var(--text-muted)'};
                                white-space:nowrap;overflow:hidden;
                                text-overflow:ellipsis;">
                        ${unread
                            ? `<strong>🔵 ${lastMsg}</strong>`
                            : lastMsg}
                    </div>
                </div>
                <span style="font-size:0.67rem;color:var(--text-muted);
                             flex-shrink:0;">${lastT}</span>
            </div>`;
        });

        container.innerHTML = html;

        window.sdOpenThread = async (threadId, coachUid, coachEmail) => {
            if (typeof _loadThreadMessages === 'function') {
                const { db: db2, doc, updateDoc } = await _sdFS();
                container.innerHTML = `
                <div style="display:flex;flex-direction:column;height:100%;">
                    <div style="display:flex;align-items:center;gap:0.7rem;
                                margin-bottom:1rem;flex-shrink:0;">
                        <button onclick="switchStaffTab('mensajes')"
                                style="padding:0.35rem 0.7rem;background:rgba(255,255,255,0.05);
                                       border:1px solid var(--glass-border);border-radius:7px;
                                       color:var(--text-muted);font-size:0.74rem;cursor:pointer;">
                            ← Volver
                        </button>
                        <div style="font-weight:700;font-size:0.87rem;">
                            💬 ${coachEmail}
                        </div>
                    </div>
                    <div id="thread-messages"
                         style="flex:1;overflow-y:auto;display:flex;
                                flex-direction:column;gap:0.5rem;min-height:200px;">
                        <p style="color:var(--text-muted);text-align:center;
                                  padding:2rem;">⏳ Cargando…</p>
                    </div>
                </div>`;
                await _loadThreadMessages(threadId, 'parent');
                try {
                    await updateDoc(doc(db2, 'cronos_messages', threadId),
                        { unreadByParent: 0 });
                } catch (_) {}
            } else {
                if (typeof showToast === 'function')
                    showToast('ℹ️ Módulo de mensajería no cargado.', 3000);
            }
        };

    } catch (e) {
        if (container) container.innerHTML = `
            <div style="text-align:center;padding:2rem;color:#ff5858;">
                ⚠️ ${e.message}</div>`;
    }
}

window.openStaffDashboard = openStaffDashboard;

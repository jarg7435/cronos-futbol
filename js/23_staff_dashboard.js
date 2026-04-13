// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Staff Dashboard (Director / Coordinador) v2.0
//  FIXED: Tab Informes lee cronos_player_reports en tiempo real
//  ADDED: Modo Prueba multi-rol para SuperAdmin
// ════════════════════════════════════════════════════════════════════

// ── Helper Firestore ─────────────────────────────────────────────────
async function _sdFS() {
    const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...m, db: window._cronos_auth?.db };
}

// ════════════════════════════════════════════════════════════════════
//  MODO PRUEBA MULTI-ROL — Solo SuperAdmin
//  Permite al SA actuar temporalmente con el clubId de cualquier club
// ════════════════════════════════════════════════════════════════════
window._testRoleClubId = null; // club seleccionado en modo prueba

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
                    🏟️ <strong>${c.name || c.id}</strong>
                    <span style="font-size:0.7rem;color:var(--text-muted);display:block;margin-top:2px;">
                        ${c.adminEmail || 'Sin admin'} · Plan: ${c.plan || 'free'}
                    </span>
                </button>`).join('')
            }
        </div>
    </div>`;

    window._applyTestRole = (clubId, clubName, role) => {
        window._testRoleClubId = clubId;
        // Inyectar temporalmente el clubId en el usuario activo
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

    // Si el SA no tiene clubId, lanzar selector de prueba
    if (isSA && !me?.clubId) {
        await openTestRolePicker('director');
        return;
    }

    if (!me || (!isSA && !['director','coordinator'].includes(activeRole))) {
        showToast('⚠️ No tienes permisos para acceder al panel de dirección.', 4000);
        return;
    }

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,960px);max-height:94vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;background:#0d1117;">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:1.2rem 1.5rem;background:linear-gradient(to right,#161b22,#0d1117);
                    border-bottom:1px solid var(--glass-border);flex-shrink:0;">
            <div>
                <h2 style="margin:0;font-size:1.15rem;display:flex;align-items:center;gap:0.7rem;">
                    🏢 Panel de Dirección:
                    <span style="color:var(--primary);">${me.clubName || 'Mi Club'}</span>
                    ${isSA ? `<span style="font-size:0.65rem;background:rgba(255,215,0,0.12);
                        border:1px solid rgba(255,215,0,0.3);color:#ffd700;
                        padding:2px 7px;border-radius:5px;font-weight:700;">🧪 PRUEBA</span>` : ''}
                </h2>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">
                    ${activeRole === 'director' ? '📋 Director Deportivo' : '🎯 Coordinador'}
                    ${isSA ? ' · SuperAdmin en modo prueba' : ''}
                </div>
            </div>
            <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;">
                ${isSA ? `
                <button onclick="openTestRolePicker('director')"
                    style="padding:0.4rem 0.8rem;background:rgba(255,215,0,0.08);
                           border:1px solid rgba(255,215,0,0.3);border-radius:8px;
                           color:#ffd700;font-size:0.73rem;font-weight:700;cursor:pointer;">
                    🔄 Cambiar Club</button>` : ''}
                <button onclick="openStaffDashboard()"
                    style="padding:0.4rem 0.8rem;background:rgba(255,255,255,0.05);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.73rem;cursor:pointer;">
                    🔄 Actualizar</button>
                <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                    style="padding:0.4rem 0.9rem;background:rgba(255,215,0,0.08);
                           border:1px solid rgba(255,215,0,0.3);border-radius:8px;
                           color:#ffd700;font-size:0.73rem;font-weight:700;cursor:pointer;">
                    ⇄ Cambiar Rol</button>
                <button onclick="logoutUser()"
                    style="padding:0.4rem 0.9rem;background:rgba(255,88,88,0.12);
                           border:1px solid rgba(255,88,88,0.4);border-radius:8px;
                           color:#ff5858;font-size:0.73rem;font-weight:700;cursor:pointer;">
                    🚪 SALIR</button>
            </div>
        </div>

        <!-- Tabs -->
        <div style="display:flex;gap:0.2rem;padding:0.5rem 1.5rem;background:#161b22;
                    border-bottom:1px solid var(--glass-border);flex-shrink:0;overflow-x:auto;">
            <button onclick="switchStaffTab('convocatorias')" class="staff-tab active" id="tab-convocatorias">📋 Convocatorias</button>
            <button onclick="switchStaffTab('entrenamientos')" class="staff-tab" id="tab-entrenamientos">🕒 Entrenamientos</button>
            <button onclick="switchStaffTab('informes')" class="staff-tab" id="tab-informes">📊 Informes de Partido</button>
            <button onclick="switchStaffTab('mensajes')" class="staff-tab" id="tab-mensajes">💬 Mensajes</button>
            <button onclick="openLiveMatchesView()" class="staff-tab"
                style="color:#3fb950;border-left:1px solid rgba(255,255,255,0.1);margin-left:0.5rem;">
                🔴 En Vivo</button>
        </div>

        <!-- Contenido -->
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
};

// ════════════════════════════════════════════════════════════════════
//  TAB: CONVOCATORIAS / ENTRENAMIENTOS
// ════════════════════════════════════════════════════════════════════
async function _sdLoadEvents(type) {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    try {
        const { db, collection, getDocs, query, where, limit } = await _sdFS();
        const clubId = me.clubId || 'demo';
        const snap   = await getDocs(query(
            collection(db, 'cronos_notifications'),
            where('clubId', '==', clubId),
            where('type',   '==', type),
            limit(50)
        ));
        if (snap.empty) {
            container.innerHTML = `<div style="text-align:center;padding:4rem;color:var(--text-muted);">
                Sin ${type === 'convocatoria' ? 'convocatorias' : 'entrenamientos'} registrados aún.</div>`;
            return;
        }
        let html = '';
        snap.forEach(docSnap => {
            const d    = docSnap.data();
            const date = d.createdAt
                ? new Date(d.createdAt).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
                : '—';
            html += `
            <div class="sd-card">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.35rem;">
                        <span class="sd-badge" style="background:${type==='convocatoria'?'rgba(88,166,255,0.15)':'rgba(210,168,255,0.15)'};
                            color:${type==='convocatoria'?'var(--primary)':'#d2a8ff'};">${type}</span>
                        <span style="font-size:0.73rem;color:var(--text-muted);">${date}</span>
                    </div>
                    <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.15rem;">
                        ${type==='convocatoria' ? `🆚 vs ${d.rival||'Rival'}` : `⚽ ${d.category||'Entrenamiento'}`}
                    </div>
                    <div style="font-size:0.76rem;color:var(--text-muted);">
                        Por: <strong>${d.coachEmail||'Entrenador'}</strong>
                        ${d.players ? ` · 👥 ${d.players.length} convocados` : ''}
                    </div>
                </div>
                <button onclick="sdViewEventDetail('${docSnap.id}')" class="btn"
                    style="font-size:0.75rem;padding:0.4rem 0.8rem;flex-shrink:0;">
                    Ver detalles</button>
            </div>`;
        });
        container.innerHTML = html;

        window.sdViewEventDetail = async (id) => {
            const { db: db2, doc, getDoc } = await _sdFS();
            const s = await getDoc(doc(db2, 'cronos_notifications', id));
            if (!s.exists()) return;
            const d = s.data();
            let txt = d.fullText || d.extra || 'Sin detalles.';
            if (d.players?.length) txt += '\n\nConvocados:\n' + d.players.join(', ');
            alert(txt);
        };
    } catch(e) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">⚠️ ${e.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════════════
//  TAB: INFORMES DE PARTIDO  ← NUEVO, FUNCIONAL
// ════════════════════════════════════════════════════════════════════
async function _sdLoadReports() {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    const clubId    = me.clubId;
    if (!clubId) {
        container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">
            ⚠️ Sin club asignado. Usa el modo prueba para seleccionar un club.</div>`;
        return;
    }

    try {
        const { db, collection, getDocs, query, where, orderBy, limit, doc, updateDoc } = await _sdFS();

        // Cargar informes del club (los genera el entrenador via saveAllMatchReportsInternal)
        const snap = await getDocs(query(
            collection(db, 'cronos_player_reports'),
            where('clubId', '==', clubId),
            limit(100)
        ));

        if (snap.empty) {
            container.innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:1rem;">📊</div>
                <div style="font-size:0.95rem;font-weight:600;margin-bottom:0.4rem;">
                    Sin informes de partido aún</div>
                <div style="font-size:0.8rem;">
                    Los informes aparecen aquí cuando un entrenador finaliza un partido
                    y pulsa <strong>"Enviar Informe"</strong> en la app.</div>
            </div>`;
            return;
        }

        // Agrupar por partido (matchDate + rival)
        const matches = {};
        snap.forEach(docSnap => {
            const r   = { _id: docSnap.id, ...docSnap.data() };
            const key = `${r.matchDate || 'sin-fecha'}_${r.rival || 'sin-rival'}_${r.coachUid || ''}`;
            if (!matches[key]) {
                matches[key] = {
                    key, matchDate: r.matchDate, rival: r.rival,
                    scoreHome: r.scoreHome, scoreAway: r.scoreAway,
                    coachEmail: r.coachEmail, createdAt: r.createdAt,
                    players: [],
                };
            }
            matches[key].players.push(r);
        });

        // Ordenar por fecha descendente
        const sortedMatches = Object.values(matches).sort((a, b) => {
            return (b.createdAt || '').localeCompare(a.createdAt || '');
        });

        let html = `
        <div style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;font-size:0.95rem;color:white;">
                📊 Informes recibidos — ${sortedMatches.length} partido${sortedMatches.length !== 1 ? 's' : ''}
            </h3>
            <span style="font-size:0.73rem;color:var(--text-muted);">
                Club: <strong style="color:var(--primary);">${me.clubName || clubId}</strong>
            </span>
        </div>`;

        sortedMatches.forEach((m, idx) => {
            const goals   = m.players.reduce((s, p) => s + (p.goals || 0), 0);
            const injured = m.players.filter(p => p.injured).length;
            const dateStr = m.matchDate
                ? new Date(m.matchDate).toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'})
                : '—';
            const score   = (m.scoreHome != null && m.scoreAway != null)
                ? `${m.scoreHome} – ${m.scoreAway}` : '—';
            const key64   = btoa(unescape(encodeURIComponent(m.key))).replace(/=/g,'');

            html += `
            <div class="sd-report-card" id="rcard-${key64}" onclick="sdToggleReport('${key64}')">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.35rem;">
                    <div>
                        <div style="font-weight:700;font-size:1rem;">
                            🆚 vs <span style="color:var(--primary);">${m.rival || 'Sin rival'}</span>
                        </div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                            📅 ${dateStr} ·
                            ⚽ Marcador: <strong style="color:white;">${score}</strong> ·
                            👤 ${m.coachEmail || 'Entrenador'}
                        </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;">
                        <span class="sd-badge" style="background:rgba(63,185,80,0.12);color:#3fb950;">
                            ${m.players.length} jugadores
                        </span>
                        ${goals > 0 ? `<span class="sd-badge" style="background:rgba(255,165,0,0.12);color:#ffa500;margin-left:4px;">
                            ⚽ ${goals} goles</span>` : ''}
                        ${injured > 0 ? `<span class="sd-badge" style="background:rgba(255,88,88,0.12);color:#ff5858;margin-left:4px;">
                            🩹 ${injured} lesión${injured > 1 ? 'es' : ''}</span>` : ''}
                        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:3px;">
                            ▼ Ver detalles
                        </div>
                    </div>
                </div>
                <!-- Tabla de jugadores (oculta por defecto) -->
                <div id="rdetail-${key64}" style="display:none;margin-top:0.8rem;
                     border-top:1px solid var(--glass-border);padding-top:0.8rem;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                        <thead>
                            <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.08);">
                                <th style="padding:0.35rem 0.5rem;text-align:left;">Nº</th>
                                <th style="padding:0.35rem 0.5rem;text-align:left;">Jugador</th>
                                <th style="padding:0.35rem 0.5rem;text-align:center;">⏱ Minutos</th>
                                <th style="padding:0.35rem 0.5rem;text-align:center;">⚽ Goles</th>
                                <th style="padding:0.35rem 0.5rem;text-align:center;">🟨 Tarjetas</th>
                                <th style="padding:0.35rem 0.5rem;text-align:center;">🩹 Lesión</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${m.players
                                .sort((a, b) => (a.playerNumber || 0) - (b.playerNumber || 0))
                                .map(p => `
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                                    <td style="padding:0.35rem 0.5rem;color:var(--primary);font-weight:700;">${p.playerNumber || '—'}</td>
                                    <td style="padding:0.35rem 0.5rem;font-weight:600;">${p.playerAlias || 'Jugador'}</td>
                                    <td style="padding:0.35rem 0.5rem;text-align:center;">${p.minutesPlayed || '0:00'}</td>
                                    <td style="padding:0.35rem 0.5rem;text-align:center;">
                                        ${p.goals > 0 ? `<strong style="color:#ffa500;">${p.goals}</strong>` : '—'}
                                    </td>
                                    <td style="padding:0.35rem 0.5rem;text-align:center;">
                                        ${p.cards && p.cards !== 'ninguna'
                                            ? `<span style="background:${p.cards==='red'?'rgba(255,88,88,0.2)':'rgba(255,215,0,0.15)'};
                                                           color:${p.cards==='red'?'#ff5858':'#ffd700'};
                                                           padding:1px 6px;border-radius:4px;font-size:0.7rem;font-weight:700;">
                                                ${p.cards==='red'?'🟥 Roja':'🟨 Amarilla'}</span>`
                                            : '—'}
                                    </td>
                                    <td style="padding:0.35rem 0.5rem;text-align:center;">
                                        ${p.injured ? '🩹 Sí' : '—'}
                                    </td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                    <!-- Historial de acciones si existe -->
                    ${m.players.some(p => p.history?.length) ? `
                    <div style="margin-top:0.7rem;padding:0.6rem 0.7rem;background:rgba(255,255,255,0.02);
                                border-radius:8px;font-size:0.73rem;color:var(--text-muted);">
                        <strong style="color:white;display:block;margin-bottom:0.3rem;">📋 Línea de tiempo</strong>
                        ${m.players.flatMap(p =>
                            (p.history || []).map(ev => ({
                                ...ev,
                                player: p.playerAlias || `#${p.playerNumber}`
                            }))
                        ).sort((a,b) => (a.minute||0) - (b.minute||0))
                        .map(ev => `
                            <span style="margin-right:0.8rem;white-space:nowrap;">
                                <strong style="color:white;">${ev.minute || '?'}'</strong>
                                ${ev.type === 'goal'    ? '⚽' :
                                  ev.type === 'yellow'  ? '🟨' :
                                  ev.type === 'red'     ? '🟥' :
                                  ev.type === 'sub_in'  ? '▶️' :
                                  ev.type === 'sub_out' ? '⏸️' : '•'}
                                ${ev.player}
                            </span>`).join('')}
                    </div>` : ''}
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
            card.style.borderColor = isOpen ? 'rgba(88,166,255,0.15)' : 'rgba(88,166,255,0.5)';
        };

    } catch(e) {
        console.error('[StaffDashboard] Error cargando informes:', e);
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">
            ⚠️ Error al cargar informes: ${e.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════════════
//  TAB: MENSAJES (mensajes recibidos desde entrenadores)
// ════════════════════════════════════════════════════════════════════
async function _sdLoadMessages() {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    const clubId    = me.clubId;
    if (!container) return;

    if (!clubId) {
        container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">⚠️ Sin club asignado.</div>`;
        return;
    }

    try {
        const { db, collection, getDocs, query, where, doc, updateDoc } = await _sdFS();

        // Buscar threads donde este staff es destinatario (campo staffUid)
        // y threads donde es parentUid (compatibilidad retroactiva)
        const [snapStaff, snapParent] = await Promise.all([
            getDocs(query(collection(db,'cronos_messages'), where('staffUid','==',me.uid))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'cronos_messages'), where('parentUid','==',me.uid))).catch(()=>({forEach:()=>{}})),
        ]);

        const threadsMap = {};
        snapStaff.forEach(d  => { threadsMap[d.id] = { _id:d.id, ...d.data() }; });
        snapParent.forEach(d => { if (!threadsMap[d.id]) threadsMap[d.id] = { _id:d.id, ...d.data() }; });
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
                        ${isCollective?'📊':'✉️'} ${t.coachEmail||'Entrenador'}
                        ${unread>0?`<span style="background:${isReport?'#ffa500':'#58a6ff'};color:#0a0e14;
                            border-radius:10px;padding:1px 7px;font-size:0.62rem;
                            font-weight:700;margin-left:6px;">
                            ${unread} nuevo${unread>1?'s':''}</span>`:''}
                    </div>
                    <div style="font-size:0.76rem;
                                color:${unread?'#58a6ff':'var(--text-muted)'};
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${unread?`<strong>🔵 ${lastMsg}</strong>`:lastMsg}
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
                        <div style="font-weight:700;font-size:0.88rem;">💬 ${coachEmail}</div>
                    </div>
                    <div id="thread-messages"
                         style="flex:1;overflow-y:auto;display:flex;
                                flex-direction:column;gap:0.5rem;min-height:200px;">
                        <p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando…</p>
                    </div>
                    <!-- Staff puede responder al entrenador -->
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

                await _loadThreadMessages(threadId, 'parent');  // 'parent' perspective: staff on right
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

        // Staff replies to coach
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
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">⚠️ ${e.message}</div>`;
    }
}

window.openLiveMatchesView = () => {
    window.open('./live.html', '_blank');
};

window.openStaffDashboard = openStaffDashboard;

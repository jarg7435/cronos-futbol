// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Central de Informes de Club v2.0
//
//  CORRECCIONES v2.0:
//  - Línea de tiempo completa en el detalle de cada informe
//    (goles, tarjetas, cambios, lesiones con su minuto)
//  - Agrupación por partido en la lista principal
//  - Informe individual profesional por jugador (para padres)
//    con logo del club
//  - Botón de actualizar en la cabecera
//  - Envío correcto de informe individual a cada padre
// ════════════════════════════════════════════════════════════════════

'use strict';

// ── Helper Firestore ─────────────────────────────────────────────────
async function _rpFS() {
    const m  = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...m, db: window._cronos_auth?.db };
}

// ════════════════════════════════════════════════════════════════════
//  openClubReports() — abre el panel de informes
// ════════════════════════════════════════════════════════════════════
async function openClubReports() {
    const me = window._getEffectiveUser
        ? window._getEffectiveUser()
        : window._cronosCurrentUser;
    if (!me) {
        if (typeof showToast === 'function')
            showToast('⚠️ No tienes un club asignado.', 4000);
        return;
    }

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,900px);max-height:93vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <!-- ── Header ─────────────────────────────────────── -->
        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:0.85rem 1.3rem;
                    border-bottom:1px solid var(--glass-border);
                    flex-shrink:0;flex-wrap:wrap;gap:0.4rem;">
            <h2 style="margin:0;font-size:1rem;display:flex;
                        align-items:center;gap:0.5rem;flex-wrap:wrap;">
                📊 Informes del Club:
                <span style="color:var(--primary);">
                    ${me.clubName || 'Mi Club'}
                </span>
            </h2>
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
                <button onclick="_loadClubReports()"
                        title="Recargar informes"
                        style="padding:0.35rem 0.7rem;
                               background:rgba(255,255,255,0.05);
                               border:1px solid var(--glass-border);
                               border-radius:7px;color:white;
                               font-size:0.73rem;cursor:pointer;">
                    🔄 Actualizar
                </button>
                <button onclick="openSendReportsModal()"
                    style="padding:0.35rem 0.8rem;
                           background:rgba(63,185,80,0.12);
                           border:1px solid rgba(63,185,80,0.35);
                           border-radius:7px;color:#3fb950;
                           font-size:0.73rem;font-weight:700;cursor:pointer;">
                    📤 Enviar Informes
                </button>
                <button onclick="if(typeof showRoleSelector==='function')showRoleSelector();"
                    style="background:none;border:none;
                           color:var(--text-muted);font-size:1.3rem;cursor:pointer;"
                    title="Cerrar">✕</button>
            </div>
        </div>

        <!-- ── Buscador y filtros ─────────────────────────── -->
        <div style="padding:0.65rem 1.3rem;
                    background:rgba(255,255,255,0.02);
                    border-bottom:1px solid var(--glass-border);
                    display:flex;gap:0.7rem;flex-wrap:wrap;align-items:center;">
            <input type="text" id="report-search"
                   placeholder="🔍 Buscar por jugador o rival…"
                   oninput="filterClubReports()"
                   style="flex:1;min-width:160px;padding:0.45rem 0.7rem;
                          background:rgba(255,255,255,0.05);
                          border:1px solid var(--glass-border);
                          border-radius:6px;color:white;font-size:0.84rem;
                          outline:none;">
            <select id="report-filter-role"
                    onchange="filterClubReports()"
                    style="padding:0.45rem;background:rgba(255,255,255,0.05);
                           border:1px solid var(--glass-border);
                           border-radius:6px;color:white;font-size:0.84rem;">
                <option value="all">📅 Todos los informes</option>
                <option value="today">Hoy</option>
                <option value="week">Esta semana</option>
            </select>
        </div>

        <!-- ── Lista ─────────────────────────────────────── -->
        <div id="club-reports-list"
             style="flex:1;overflow-y:auto;padding:1rem 1.3rem;
                    background:rgba(0,0,0,0.12);
                    -webkit-overflow-scrolling:touch;">
            <p style="color:var(--text-muted);text-align:center;padding:3rem;">
                ⏳ Cargando informes del club…
            </p>
        </div>
    </div>

    <style>
        .rpt-card {
            background:rgba(255,255,255,0.03);
            border:1px solid var(--glass-border,rgba(255,255,255,0.1));
            border-radius:10px;padding:0.9rem;margin-bottom:0.65rem;
            cursor:pointer;transition:all 0.2s;
        }
        .rpt-card:hover {
            background:rgba(88,166,255,0.06);
            border-color:rgba(88,166,255,0.3);
        }
        .rpt-badge {
            font-size:0.62rem;font-weight:700;padding:2px 6px;
            border-radius:5px;text-transform:uppercase;
        }
        .rpt-timeline {
            display:flex;flex-wrap:wrap;gap:0.35rem 0.65rem;
            padding:0.5rem 0.6rem;
            background:rgba(255,255,255,0.025);border-radius:7px;
            font-size:0.71rem;margin-top:0.6rem;
            border:1px solid rgba(255,255,255,0.06);
        }
        .rpt-tl-ev {
            display:inline-flex;align-items:center;gap:0.2rem;
            white-space:nowrap;color:var(--text-muted,#8b949e);
        }
        .rpt-tl-ev strong { color:white; }
    </style>`;

    await _loadClubReports();
}

// ════════════════════════════════════════════════════════════════════
//  _loadClubReports() — carga los datos de Firestore
// ════════════════════════════════════════════════════════════════════
async function _loadClubReports() {
    const me = window._getEffectiveUser
        ? window._getEffectiveUser()
        : window._cronosCurrentUser;
    const container = document.getElementById('club-reports-list');
    if (!container) return;

    try {
        const { db, collection, getDocs, query, where } = await _rpFS();
        if (!db) {
            container.innerHTML = `
            <div style="text-align:center;color:#ff5858;padding:2rem;">
                ⚠️ Base de datos no disponible. Recarga la página.</div>`;
            return;
        }

        const snap = await getDocs(query(
            collection(db, 'cronos_player_reports'),
            where('clubId', '==', me.clubId || '_preview'),
        ));

        window._allClubReports = [];
        snap.forEach(d => window._allClubReports.push({ id: d.id, ...d.data() }));

        // Ordenar por fecha descendente en memoria
        window._allClubReports.sort((a, b) =>
            (b.createdAt || '').localeCompare(a.createdAt || ''));

        renderClubReportsList(window._allClubReports);

    } catch (e) {
        console.error('[ClubReports]', e);
        if (container) container.innerHTML = `
            <div style="text-align:center;color:#ff5858;padding:2rem;">
                ⚠️ Error al cargar informes: ${e.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════════════
//  renderClubReportsList() — agrupa por partido y renderiza
// ════════════════════════════════════════════════════════════════════
function renderClubReportsList(reports) {
    const container = document.getElementById('club-reports-list');
    if (!container) return;

    if (!reports.length) {
        container.innerHTML = `
        <div style="text-align:center;color:var(--text-muted);padding:4rem 2rem;">
            <div style="font-size:3rem;margin-bottom:1rem;">📂</div>
            Sin informes para los filtros seleccionados.
        </div>`;
        return;
    }

    // ── Agrupar por partido ────────────────────────────────────────
    const matches = {};
    reports.forEach(r => {
        const key = `${r.matchDate || r.createdAt?.slice(0,10) || '?'}_${r.rival || 'sin-rival'}_${r.coachUid || ''}`;
        if (!matches[key]) {
            matches[key] = {
                key,
                matchDate:  r.matchDate || r.createdAt?.slice(0,10),
                rival:      r.rival,
                scoreHome:  r.scoreHome,
                scoreAway:  r.scoreAway,
                coachEmail: r.coachEmail,
                teamName:   r.teamName || '',
                createdAt:  r.createdAt,
                players:    [],
            };
        }
        matches[key].players.push(r);
    });

    const sorted = Object.values(matches).sort(
        (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    let html = `
    <div style="margin-bottom:0.7rem;font-size:0.76rem;color:var(--text-muted);">
        ${sorted.length} partido${sorted.length !== 1 ? 's' : ''} ·
        ${reports.length} registros de jugadores
    </div>`;

    sorted.forEach(m => {
        const goals   = m.players.reduce((s, p) => s + (p.goals || 0), 0);
        const injured = m.players.filter(p => p.injured).length;
        const cards   = m.players.filter(p =>
            p.cards && p.cards !== 'ninguna').length;
        const dateStr = m.matchDate
            ? new Date(m.matchDate).toLocaleDateString('es-ES',
                { day:'2-digit', month:'2-digit', year:'2-digit' })
            : '—';
        const score = (m.scoreHome != null && m.scoreAway != null)
            ? `${m.scoreHome}-${m.scoreAway}` : '—';
        const key64 = btoa(unescape(encodeURIComponent(m.key))).replace(/=/g, '');

        html += `
        <div class="rpt-card" id="rpcard-${key64}">
            <!-- Cabecera del partido — siempre visible -->
            <div onclick="toggleMatchReport('${key64}')"
                 style="display:flex;justify-content:space-between;
                        align-items:start;gap:0.5rem;">
                <div>
                    <div style="font-weight:700;font-size:0.95rem;">
                        🆚 vs <span style="color:var(--primary);">
                            ${m.rival || 'Sin rival'}</span>
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-muted);
                                margin-top:2px;">
                        📅 ${dateStr} ·
                        <strong style="color:white;">${score}</strong> ·
                        ${m.coachEmail || 'Entrenador'}
                    </div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <span class="rpt-badge"
                          style="background:rgba(63,185,80,0.12);color:#3fb950;">
                        ${m.players.length} jugadores
                    </span>
                    ${goals > 0 ? `<span class="rpt-badge"
                        style="background:rgba(255,165,0,0.1);color:#ffa500;margin-left:3px;">
                        ⚽ ${goals}</span>` : ''}
                    ${cards > 0 ? `<span class="rpt-badge"
                        style="background:rgba(255,215,0,0.1);color:#ffd700;margin-left:3px;">
                        🟨 ${cards}</span>` : ''}
                    ${injured > 0 ? `<span class="rpt-badge"
                        style="background:rgba(255,88,88,0.1);color:#ff5858;margin-left:3px;">
                        🩹 ${injured}</span>` : ''}
                    <div style="font-size:0.6rem;color:var(--text-muted);margin-top:3px;">
                        ▼ Ver jugadores
                    </div>
                </div>
            </div>

            <!-- Detalle del partido (oculto por defecto) -->
            <div id="rpdetail-${key64}"
                 style="display:none;margin-top:0.7rem;
                        border-top:1px solid var(--glass-border);
                        padding-top:0.7rem;">
                ${_buildMatchTimeline(m)}
                <div style="display:grid;gap:0.3rem;margin-top:0.6rem;">
                    ${m.players
                        .sort((a, b) => (a.playerNumber||0) - (b.playerNumber||0))
                        .map(p => `
                        <div style="display:flex;align-items:center;gap:0.5rem;
                                    padding:0.4rem 0.5rem;
                                    background:rgba(255,255,255,0.025);
                                    border-radius:7px;cursor:pointer;"
                             onclick="viewReportDetail('${p.id}')">
                            <div style="background:rgba(88,166,255,0.12);
                                        width:30px;height:30px;border-radius:8px;
                                        display:flex;align-items:center;
                                        justify-content:center;
                                        color:var(--primary);font-weight:700;
                                        font-size:0.8rem;flex-shrink:0;">
                                #${p.playerNumber || '?'}
                            </div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:700;font-size:0.82rem;">
                                    ${p.playerAlias || 'Jugador'}
                                </div>
                                <div style="font-size:0.68rem;
                                            color:var(--text-muted);">
                                    ⏱ ${p.minutesPlayed || '—'}
                                    ${p.goals > 0 ? ` · ⚽ ${p.goals}` : ''}
                                    ${p.cards && p.cards !== 'ninguna'
                                        ? ` · ${p.cards==='red'||p.cards==='roja'?'🟥':'🟨'}`
                                        : ''}
                                    ${p.injured ? ' · 🩹' : ''}
                                </div>
                            </div>
                            <div style="font-size:0.68rem;color:var(--text-muted);
                                        flex-shrink:0;">
                                Ver →
                            </div>
                        </div>`).join('')}
                </div>
            </div>
        </div>`;
    });

    container.innerHTML = html;

    window.toggleMatchReport = (key64) => {
        const card   = document.getElementById(`rpcard-${key64}`);
        const detail = document.getElementById(`rpdetail-${key64}`);
        if (!detail) return;
        const isOpen = detail.style.display !== 'none';
        detail.style.display = isOpen ? 'none' : 'block';
        if (card) card.style.borderColor = isOpen
            ? 'var(--glass-border)'
            : 'rgba(88,166,255,0.45)';
    };
}

// ── Construir línea de tiempo de un partido ───────────────────────────
function _buildMatchTimeline(match) {
    const evIcon = {
        goal:'⚽', yellow:'🟨', red:'🟥',
        sub_in:'▶️', sub_out:'⏸️', injury:'🩹',
    };

    const allEvents = [];
    match.players.forEach(p => {
        const alias = p.playerAlias || `#${p.playerNumber || '?'}`;
        (p.history || []).forEach(ev => {
            allEvents.push({ ...ev, playerAlias: alias });
        });
        if (p.subInMinute)  allEvents.push({ type:'sub_in',  minute:p.subInMinute,  playerAlias:alias });
        if (p.subOutMinute) allEvents.push({ type:'sub_out', minute:p.subOutMinute, playerAlias:alias });
        if (p.injuryMinute) allEvents.push({ type:'injury',  minute:p.injuryMinute, playerAlias:alias });
    });

    if (!allEvents.length) return '';

    allEvents.sort((a, b) => (a.minute || 0) - (b.minute || 0));

    return `
    <div class="rpt-timeline">
        <strong style="color:white;font-size:0.69rem;
                       width:100%;display:block;margin-bottom:0.25rem;">
            📋 Línea de tiempo del partido</strong>
        ${allEvents.map(ev => `
        <span class="rpt-tl-ev">
            <strong>${ev.minute || '?'}'</strong>
            ${evIcon[ev.type] || '•'}
            ${ev.playerAlias}
        </span>`).join('')}
    </div>`;
}

// ════════════════════════════════════════════════════════════════════
//  filterClubReports() — aplica búsqueda y filtro temporal
// ════════════════════════════════════════════════════════════════════
window.filterClubReports = function filterClubReports() {
    const q    = (document.getElementById('report-search')?.value || '').toLowerCase();
    const time = document.getElementById('report-filter-role')?.value || 'all';

    let filtered = window._allClubReports || [];

    if (q) {
        filtered = filtered.filter(r =>
            (r.playerAlias || '').toLowerCase().includes(q) ||
            (r.rival       || '').toLowerCase().includes(q)
        );
    }

    if (time === 'today') {
        const today = new Date().toDateString();
        filtered = filtered.filter(r =>
            new Date(r.createdAt).toDateString() === today);
    } else if (time === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        filtered = filtered.filter(r => new Date(r.createdAt) > weekAgo);
    }

    renderClubReportsList(filtered);
};

// ════════════════════════════════════════════════════════════════════
//  viewReportDetail() — informe INDIVIDUAL de un jugador
//  Diseño profesional con logo del club, línea de tiempo propia
// ════════════════════════════════════════════════════════════════════
window.viewReportDetail = function viewReportDetail(id) {
    const r = (window._allClubReports || []).find(x => x.id === id);
    if (!r) return;

    const me       = window._cronosCurrentUser;
    const logoUrl  = me?.clubLogoUrl || r.clubLogoUrl || '';
    const clubName = me?.clubName    || r.clubName    || 'Cronos Fútbol';

    const evIcon = {
        goal:'⚽', yellow:'🟨', red:'🟥',
        sub_in:'▶️ Entra', sub_out:'⏸️ Sale', injury:'🩹 Lesión',
    };

    // Línea de tiempo individual del jugador
    const events = [];
    (r.history || []).forEach(ev => events.push(ev));
    if (r.subInMinute)  events.push({ type:'sub_in',  minute:r.subInMinute  });
    if (r.subOutMinute) events.push({ type:'sub_out', minute:r.subOutMinute });
    if (r.injuryMinute) events.push({ type:'injury',  minute:r.injuryMinute });
    events.sort((a, b) => (a.minute || 0) - (b.minute || 0));

    const timelineHtml = events.length ? `
    <div style="background:rgba(255,255,255,0.03);border-radius:8px;
                padding:0.8rem;border:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.7rem;color:var(--text-muted);
                    text-transform:uppercase;letter-spacing:0.8px;
                    margin-bottom:0.6rem;font-weight:700;">
            📋 Línea de tiempo
        </div>
        ${events.map(ev => `
        <div style="display:flex;align-items:center;gap:0.7rem;
                    padding:0.28rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <div style="width:34px;text-align:center;font-weight:700;
                        color:var(--primary);font-size:0.85rem;flex-shrink:0;">
                ${ev.minute || '?'}'
            </div>
            <div style="font-size:0.82rem;color:white;">
                ${evIcon[ev.type] || ev.type || '•'}
            </div>
        </div>`).join('')}
    </div>` : '';

    const existing = document.getElementById('report-detail-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'report-detail-modal';
    modal.style.cssText = [
        'position:fixed;inset:0;background:rgba(0,0,0,0.88);',
        'display:flex;align-items:center;justify-content:center;',
        'z-index:10000;padding:1rem;',
    ].join('');

    modal.innerHTML = `
    <div style="width:min(96vw,480px);max-height:91vh;display:flex;
                flex-direction:column;overflow:hidden;border-radius:14px;
                border:1px solid var(--glass-border);
                background:#0d1117;font-family:Inter,sans-serif;">

        <!-- ── Cabecera del club (profesional) ──────────────── -->
        <div style="background:linear-gradient(135deg,#161b22,#0d1117);
                    padding:1.1rem 1.3rem;border-bottom:1px solid var(--glass-border);
                    display:flex;align-items:center;gap:0.9rem;flex-shrink:0;">
            ${logoUrl
                ? `<img src="${logoUrl}" alt="${clubName}"
                        style="height:44px;width:44px;border-radius:8px;
                               object-fit:contain;flex-shrink:0;">`
                : `<div style="width:44px;height:44px;border-radius:8px;
                               background:rgba(88,166,255,0.12);
                               display:flex;align-items:center;justify-content:center;
                               font-size:1.3rem;flex-shrink:0;">🏟️</div>`}
            <div style="flex:1;min-width:0;">
                <div style="font-family:'Outfit',sans-serif;font-weight:700;
                            color:white;font-size:0.95rem;overflow:hidden;
                            text-overflow:ellipsis;white-space:nowrap;">
                    ${clubName}
                </div>
                <div style="font-size:0.68rem;color:var(--text-muted);">
                    Informe Individual de Partido
                </div>
            </div>
            <button onclick="document.getElementById('report-detail-modal').remove()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.4rem;cursor:pointer;flex-shrink:0;">✕</button>
        </div>

        <!-- ── Cuerpo ─────────────────────────────────────── -->
        <div style="flex:1;overflow-y:auto;padding:1.1rem 1.3rem;
                    -webkit-overflow-scrolling:touch;">

            <!-- Jugador -->
            <div style="display:flex;align-items:center;gap:0.9rem;
                        margin-bottom:1.1rem;
                        background:rgba(88,166,255,0.06);
                        padding:0.8rem;border-radius:10px;
                        border:1px solid rgba(88,166,255,0.12);">
                <div style="width:46px;height:46px;border-radius:50%;
                            background:var(--primary,#58a6ff);
                            display:flex;align-items:center;justify-content:center;
                            font-size:1.2rem;font-weight:800;color:#0d1117;
                            flex-shrink:0;">
                    ${(r.playerAlias || '?').substring(0,1).toUpperCase()}
                </div>
                <div>
                    <div style="font-weight:700;font-size:1.05rem;">
                        ${r.playerAlias || 'Jugador'}
                        <span style="color:var(--text-muted);font-weight:400;
                                     font-size:0.85rem;">
                            #${r.playerNumber || '?'}
                        </span>
                    </div>
                    <div style="font-size:0.73rem;color:var(--text-muted);">
                        ${new Date(r.createdAt || Date.now()).toLocaleString('es-ES',
                            { day:'2-digit', month:'long', year:'numeric',
                              hour:'2-digit', minute:'2-digit' })}
                    </div>
                </div>
            </div>

            <!-- Stats del partido -->
            <div style="display:grid;grid-template-columns:1fr 1fr;
                        gap:0.8rem;margin-bottom:1.1rem;">
                <div style="background:rgba(255,255,255,0.03);
                            border-radius:9px;padding:0.7rem;
                            border:1px solid var(--glass-border);">
                    <div style="font-size:0.65rem;color:var(--text-muted);
                                text-transform:uppercase;letter-spacing:0.8px;
                                margin-bottom:0.25rem;">Rival</div>
                    <div style="font-weight:700;">${r.rival || '—'}</div>
                </div>
                <div style="background:rgba(255,255,255,0.03);
                            border-radius:9px;padding:0.7rem;
                            border:1px solid var(--glass-border);">
                    <div style="font-size:0.65rem;color:var(--text-muted);
                                text-transform:uppercase;letter-spacing:0.8px;
                                margin-bottom:0.25rem;">Resultado</div>
                    <div style="font-weight:700;font-size:1.05rem;">
                        ${r.scoreHome ?? '—'}–${r.scoreAway ?? '—'}
                    </div>
                </div>
                <div style="background:rgba(88,166,255,0.06);
                            border-radius:9px;padding:0.7rem;
                            border:1px solid rgba(88,166,255,0.15);">
                    <div style="font-size:0.65rem;color:var(--text-muted);
                                text-transform:uppercase;letter-spacing:0.8px;
                                margin-bottom:0.25rem;">⏱ Minutos jugados</div>
                    <div style="font-weight:800;font-size:1.2rem;color:var(--primary);">
                        ${r.minutesPlayed || '0'}
                    </div>
                </div>
                <div style="background:rgba(63,185,80,0.05);
                            border-radius:9px;padding:0.7rem;
                            border:1px solid rgba(63,185,80,0.15);">
                    <div style="font-size:0.65rem;color:var(--text-muted);
                                text-transform:uppercase;letter-spacing:0.8px;
                                margin-bottom:0.25rem;">⚽ Goles</div>
                    <div style="font-weight:800;font-size:1.2rem;color:#3fb950;">
                        ${r.goals || '0'}
                    </div>
                </div>
            </div>

            <!-- Estado físico / tarjetas -->
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1.1rem;">
                <span style="padding:5px 11px;border-radius:20px;font-size:0.75rem;
                    background:${r.cards && r.cards !== 'ninguna'
                        ? 'rgba(255,215,0,0.1)':'rgba(255,255,255,0.04)'};
                    color:${r.cards && r.cards !== 'ninguna'?'#ffd700':'var(--text-muted)'};
                    border:1px solid ${r.cards && r.cards !== 'ninguna'
                        ? 'rgba(255,215,0,0.3)':'rgba(255,255,255,0.08)'};">
                    🎴 Tarjeta: ${r.cards
                        ? (r.cards === 'ninguna' ? 'Ninguna' : r.cards)
                        : 'Ninguna'}
                </span>
                <span style="padding:5px 11px;border-radius:20px;font-size:0.75rem;
                    background:${r.injured?'rgba(255,88,88,0.12)':'rgba(63,185,80,0.08)'};
                    color:${r.injured?'#ff5858':'#3fb950'};
                    border:1px solid ${r.injured
                        ? 'rgba(255,88,88,0.35)':'rgba(63,185,80,0.25)'};">
                    🚑 Lesión: ${r.injured ? 'SÍ' : 'NO'}
                </span>
            </div>

            <!-- Línea de tiempo individual -->
            ${timelineHtml}

            <!-- Observaciones del entrenador -->
            ${r.notes ? `
            <div style="background:rgba(240,136,62,0.04);
                        border:1px solid rgba(240,136,62,0.18);
                        padding:0.85rem;border-radius:9px;margin-top:0.9rem;">
                <div style="font-size:0.65rem;color:#f0883e;
                            text-transform:uppercase;letter-spacing:0.8px;
                            margin-bottom:0.4rem;font-weight:700;">
                    ✍️ Observaciones del entrenador
                </div>
                <p style="margin:0;font-size:0.84rem;line-height:1.55;color:white;">
                    ${r.notes}
                </p>
            </div>` : ''}
        </div>

        <!-- ── Pie con botones ────────────────────────────── -->
        <div style="padding:0.8rem 1.1rem;border-top:1px solid var(--glass-border);
                    background:rgba(0,0,0,0.2);display:flex;gap:0.5rem;flex-shrink:0;">
            <button onclick="_rpSendParentReport('${r.id}')"
                    style="flex:1;padding:0.48rem;
                           background:rgba(63,185,80,0.14);
                           border:1px solid rgba(63,185,80,0.35);
                           border-radius:7px;color:#3fb950;
                           font-size:0.78rem;font-weight:700;cursor:pointer;">
                📱 Enviar a familia
            </button>
            <button onclick="document.getElementById('report-detail-modal').remove()"
                    style="flex:1;padding:0.48rem;
                           background:rgba(255,255,255,0.05);
                           border:1px solid var(--glass-border);
                           border-radius:7px;color:var(--text-muted);
                           font-size:0.78rem;cursor:pointer;">
                Cerrar
            </button>
        </div>
    </div>`;

    document.body.appendChild(modal);
};

// ── Enviar informe individual al padre/madre por WhatsApp ─────────────
window._rpSendParentReport = async function _rpSendParentReport(reportId) {
    const r = (window._allClubReports || []).find(x => x.id === reportId);
    if (!r) return;

    // Buscar el número de WhatsApp del padre en cronos_player_links
    let phone = null;
    try {
        const { db, doc, getDoc } = await _rpFS();
        const me     = window._cronosCurrentUser;
        const linkId = `${me.clubId}_${r.playerNumber}`;
        const snap   = await getDoc(doc(db, 'cronos_player_links', linkId));
        if (snap.exists()) phone = snap.data().parentWA || null;
    } catch (_) {}

    // Construir texto del informe
    const evIcon = {
        goal:'⚽ Gol', yellow:'🟨 Amarilla', red:'🟥 Roja',
        sub_in:'▶️ Entra', sub_out:'⏸️ Sale', injury:'🩹 Lesión',
    };
    const events = [];
    (r.history || []).forEach(ev => events.push(ev));
    if (r.subInMinute)  events.push({ type:'sub_in',  minute:r.subInMinute  });
    if (r.subOutMinute) events.push({ type:'sub_out', minute:r.subOutMinute });
    if (r.injuryMinute) events.push({ type:'injury',  minute:r.injuryMinute });
    events.sort((a, b) => (a.minute || 0) - (b.minute || 0));

    const me       = window._cronosCurrentUser;
    const clubName = me?.clubName || 'Cronos Fútbol';
    const fecha    = r.matchDate
        ? new Date(r.matchDate).toLocaleDateString('es-ES',
            { day:'2-digit', month:'long', year:'numeric' })
        : '—';

    let msg = `⚽ *INFORME DE PARTIDO*\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `🏟️ *${clubName}*\n`;
    msg += `📅 ${fecha}\n`;
    msg += `🆚 vs *${r.rival || '—'}* (${r.scoreHome ?? '?'}-${r.scoreAway ?? '?'})\n\n`;
    msg += `👤 *${r.playerAlias || 'Jugador'} #${r.playerNumber || '?'}*\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `⏱ Minutos jugados: *${r.minutesPlayed || '0'}*\n`;
    msg += `⚽ Goles: *${r.goals || '0'}*\n`;
    msg += `🎴 Tarjeta: *${r.cards && r.cards !== 'ninguna' ? r.cards : 'Ninguna'}*\n`;
    msg += `🚑 Lesión: *${r.injured ? 'SÍ' : 'NO'}*\n`;

    if (events.length) {
        msg += `\n📋 *Acciones:*\n`;
        events.forEach(ev => {
            msg += `• ${ev.minute || '?'}' ${evIcon[ev.type] || ev.type}\n`;
        });
    }

    if (r.notes) {
        msg += `\n✍️ *Observaciones:*\n${r.notes}\n`;
    }
    msg += `\n_Cronos Fútbol · Informe automático_ ⚽`;

    const encoded = encodeURIComponent(msg);
    const target  = phone
        ? `https://wa.me/${phone}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;

    window.open(target, '_blank');
};

// ════════════════════════════════════════════════════════════════════
//  Modal de envío masivo
// ════════════════════════════════════════════════════════════════════
window.openSendReportsModal = function openSendReportsModal() {
    const allContacts = [];
    const staffContacts = (typeof emailConfig !== 'undefined'
        ? emailConfig.contacts || [] : [])
        .filter(c => c.type !== 'parent' && (c.phone || c.email));
    staffContacts.forEach(c => allContacts.push({
        id: c.id, type:'staff',
        label: c.name || c.email || 'Staff',
        phone: c.phone || '', email: c.email || '', uid: c.uid || null,
        defaultOn: (c.tags || []).includes('reports'),
    }));

    const parentContacts = (typeof emailConfig !== 'undefined'
        ? emailConfig.contacts || [] : [])
        .filter(c => c.type === 'parent' && (c.phone || c.email));
    parentContacts.forEach(c => allContacts.push({
        id: c.id, type:'parent',
        label: c.player ? `${c.name || 'Padre'} (${c.player})` : (c.name || 'Padre'),
        phone: c.phone || '', email: c.email || '', uid: null,
        defaultOn: true,
    }));

    let savedPresel = null;
    try {
        savedPresel = JSON.parse(
            localStorage.getItem('cronos_reports_preselection') || 'null');
    } catch (_) {}

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content"
         style="width:min(96vw,500px);max-height:90vh;
                display:flex;flex-direction:column;gap:0.7rem;padding:1.2rem;">

        <div style="display:flex;justify-content:space-between;
                    align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;">📤 Enviar Informes</h3>
            <button onclick="openClubReports()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- Destinatarios -->
        <div style="background:rgba(255,255,255,0.03);
                    border:1px solid var(--glass-border);
                    border-radius:9px;padding:0.75rem;">
            <div style="display:flex;justify-content:space-between;
                        align-items:center;margin-bottom:0.5rem;">
                <span style="font-size:0.72rem;font-weight:700;
                             color:var(--text-muted);letter-spacing:0.5px;">
                    📋 DESTINATARIOS
                </span>
                <div style="display:flex;gap:0.35rem;">
                    <button onclick="document.querySelectorAll('.rpt-recipient-chk')
                                .forEach(c=>c.checked=true)"
                        style="font-size:0.6rem;padding:0.16rem 0.5rem;
                               background:rgba(88,166,255,0.1);
                               border:1px solid rgba(88,166,255,0.3);
                               border-radius:4px;color:var(--primary);cursor:pointer;">
                        ✓ Todos
                    </button>
                    <button onclick="document.querySelectorAll('.rpt-recipient-chk')
                                .forEach(c=>c.checked=false)"
                        style="font-size:0.6rem;padding:0.16rem 0.5rem;
                               background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.1);
                               border-radius:4px;color:var(--text-muted);cursor:pointer;">
                        ✗ Ninguno
                    </button>
                    <button onclick="_rptSavePreselection()"
                        style="font-size:0.6rem;padding:0.16rem 0.5rem;
                               background:rgba(63,185,80,0.1);
                               border:1px solid rgba(63,185,80,0.3);
                               border-radius:4px;color:#3fb950;cursor:pointer;">
                        💾 Guardar
                    </button>
                </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.3rem;
                        max-height:230px;overflow-y:auto;padding-right:3px;">
                ${allContacts.length
                    ? allContacts.map(c => {
                        const isChecked = savedPresel
                            ? savedPresel.includes(c.id) : c.defaultOn;
                        const tColor  = c.type === 'staff'
                            ? 'rgba(88,166,255,0.1)':'rgba(240,136,62,0.08)';
                        const tBorder = c.type === 'staff'
                            ? 'rgba(88,166,255,0.22)':'rgba(240,136,62,0.2)';
                        return `
                        <label style="display:flex;align-items:center;gap:0.5rem;
                                      background:${tColor};border:1px solid ${tBorder};
                                      border-radius:7px;padding:0.4rem 0.6rem;
                                      cursor:pointer;">
                            <input type="checkbox" class="rpt-recipient-chk"
                                   data-id="${c.id}" data-phone="${c.phone}"
                                   data-email="${c.email}" data-uid="${c.uid||''}"
                                   ${isChecked ? 'checked' : ''}
                                   style="width:14px;height:14px;flex-shrink:0;
                                          accent-color:var(--primary);">
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:0.77rem;font-weight:600;">
                                    ${c.type === 'staff' ? '🏢' : '👨‍👩‍👧'} ${c.label}
                                </div>
                                <div style="font-size:0.62rem;color:var(--text-muted);">
                                    ${c.phone ? `📱 ${c.phone}` : ''}
                                    ${c.phone && c.email ? ' · ' : ''}
                                    ${c.email ? `📧 ${c.email}` : ''}
                                </div>
                            </div>
                        </label>`;
                    }).join('')
                    : `<div style="text-align:center;color:var(--text-muted);
                                   font-size:0.78rem;padding:1rem;">
                           ⚠️ Sin contactos configurados.
                       </div>`}
            </div>
        </div>

        <!-- Filtro de periodo -->
        <div style="background:rgba(255,255,255,0.02);
                    border:1px solid var(--glass-border);
                    border-radius:8px;padding:0.65rem 0.8rem;">
            <label style="font-size:0.7rem;color:var(--text-muted);
                          display:block;margin-bottom:0.3rem;">
                📅 Informes a incluir
            </label>
            <select id="rpt-period"
                    style="width:100%;padding:0.4rem;
                           background:rgba(255,255,255,0.05);
                           border:1px solid var(--glass-border);
                           border-radius:6px;color:white;font-size:0.83rem;">
                <option value="last">Último partido</option>
                <option value="week">Última semana</option>
                <option value="all">Todos los disponibles</option>
            </select>
        </div>

        <!-- Botones de envío -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;
                    gap:0.4rem;flex-shrink:0;">
            <button onclick="openClubReports()"
                    style="padding:0.45rem;background:rgba(255,255,255,0.05);
                           border:1px solid var(--glass-border);border-radius:7px;
                           color:var(--text-muted);font-size:0.76rem;cursor:pointer;">
                ← Volver
            </button>
            <button onclick="_sendReportsViaWA()"
                    style="padding:0.45rem;background:rgba(37,211,102,0.14);
                           border:1px solid rgba(37,211,102,0.35);border-radius:7px;
                           color:#25d366;font-weight:700;font-size:0.76rem;cursor:pointer;">
                📱 WhatsApp
            </button>
            <button onclick="_sendReportsViaEmail()"
                    style="padding:0.45rem;background:rgba(88,166,255,0.14);
                           border:1px solid rgba(88,166,255,0.35);border-radius:7px;
                           color:var(--primary);font-weight:700;font-size:0.76rem;cursor:pointer;">
                📧 Email
            </button>
        </div>
    </div>`;
};

window._rptSavePreselection = function() {
    const ids = Array.from(
        document.querySelectorAll('.rpt-recipient-chk:checked'))
        .map(c => c.dataset.id);
    localStorage.setItem('cronos_reports_preselection', JSON.stringify(ids));
    if (typeof showToast === 'function')
        showToast('✅ Selección guardada como predeterminada', 2500);
};

function _rptBuildReportText(reports) {
    if (!reports.length) return 'No hay informes disponibles.';
    const grouped = {};
    reports.forEach(r => {
        const key = r.matchDate
            || new Date(r.createdAt).toLocaleDateString('es-ES');
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
    });
    let msg = `📊 *INFORMES DEL CLUB*\n━━━━━━━━━━━━━━━━\n\n`;
    Object.entries(grouped).forEach(([date, rpts]) => {
        msg += `📅 *${date}*\n`;
        rpts.forEach(r => {
            msg += `• ${r.playerAlias || 'Jugador'} #${r.playerNumber} — `;
            msg += `vs ${r.rival || '—'} (${r.scoreHome}-${r.scoreAway}) `;
            msg += `⏱️${r.minutesPlayed || '—'}`;
            if (r.goals > 0) msg += ` ⚽${r.goals}`;
            if (r.cards === 'amarilla') msg += ' 🟨';
            if (r.cards === 'roja')     msg += ' 🟥';
            msg += '\n';
        });
        msg += '\n';
    });
    msg += `_Cronos Fútbol_ ⚽`;
    return msg;
}

function _rptGetFilteredReports() {
    const period = document.getElementById('rpt-period')?.value || 'last';
    const all    = window._allClubReports || [];
    if (!all.length) return [];
    if (period === 'last') {
        const latestDate = all[0]?.matchDate || '';
        return latestDate
            ? all.filter(r => r.matchDate === latestDate)
            : [all[0]];
    }
    if (period === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return all.filter(r => new Date(r.createdAt) > weekAgo);
    }
    return all;
}

window._sendReportsViaWA = function() {
    const recipients = Array.from(
        document.querySelectorAll('.rpt-recipient-chk:checked'))
        .filter(c => c.dataset.phone);
    if (!recipients.length) {
        if (typeof showToast === 'function')
            showToast('⚠️ Sin destinatario con WhatsApp', 3000);
        return;
    }
    const text = encodeURIComponent(
        _rptBuildReportText(_rptGetFilteredReports()));
    recipients.forEach((r, i) => {
        setTimeout(() => window.open(
            `https://wa.me/${r.dataset.phone}?text=${text}`, '_blank'),
            i * 850);
    });
    if (typeof showToast === 'function')
        showToast(`📱 Enviando a ${recipients.length} contacto(s)`, 4000);
};

window._sendReportsViaEmail = function() {
    const recipients = Array.from(
        document.querySelectorAll('.rpt-recipient-chk:checked'))
        .filter(c => c.dataset.email);
    if (!recipients.length) {
        if (typeof showToast === 'function')
            showToast('⚠️ Sin destinatario con email', 3000);
        return;
    }
    const toList  = recipients.map(r => r.dataset.email).join(',');
    const subject = encodeURIComponent(
        `📊 Informes del Club — ${new Date().toLocaleDateString('es-ES')}`);
    const body    = encodeURIComponent(
        _rptBuildReportText(_rptGetFilteredReports()).replace(/[*_]/g, ''));
    window.open(`mailto:${toList}?subject=${subject}&body=${body}`, '_blank');
    if (typeof showToast === 'function')
        showToast(`📧 Email abierto para ${recipients.length} destinatario(s)`, 3000);
};

window.openClubReports = openClubReports;

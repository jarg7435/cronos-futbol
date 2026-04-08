// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Central de Informes de Club v1.0
//  Vista para Coordinadores y Directores Deportivos
// ════════════════════════════════════════════════════════════════════

async function openClubReports() {
    const me = window._cronosCurrentUser;
    if (!me || !me.clubId) {
        showToast('⚠️ No tienes un club asignado.', 4000);
        return;
    }

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,900px);max-height:92vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:1rem 1.5rem;border-bottom:1px solid var(--glass-border);flex-shrink:0;">
            <h2 style="margin:0;font-size:1.1rem;display:flex;align-items:center;gap:0.6rem;">
                📊 Informes del Club: <span style="color:var(--primary);">${me.clubName || 'Mi Club'}</span>
            </h2>
            <div style="display:flex;gap:0.5rem;align-items:center;">
                <button onclick="openSendReportsModal()"
                    style="padding:0.4rem 0.9rem;background:rgba(63,185,80,0.12);
                           border:1px solid rgba(63,185,80,0.35);border-radius:8px;
                           color:#3fb950;font-size:0.78rem;font-weight:700;cursor:pointer;">
                    📤 Enviar Informes
                </button>
                <button onclick="document.getElementById('setup-modal').style.display='none'"
                    style="background:none;border:none;color:var(--text-muted);
                           font-size:1.4rem;cursor:pointer;">✕</button>
            </div>
        </div>

        <div style="padding:0.8rem 1.5rem;background:rgba(255,255,255,0.02);
                    border-bottom:1px solid var(--glass-border);display:flex;gap:1rem;flex-wrap:wrap;">
            <div style="flex:1;min-width:200px;">
                <input type="text" id="report-search" placeholder="🔍 Buscar por jugador o rival…" 
                    style="width:100%;padding:0.5rem 0.8rem;background:rgba(255,255,255,0.05);
                           border:1px solid var(--glass-border);border-radius:6px;color:white;font-size:0.85rem;"
                    oninput="filterClubReports()">
            </div>
            <select id="report-filter-role" style="padding:0.5rem;background:rgba(255,255,255,0.05);
                    border:1px solid var(--glass-border);border-radius:6px;color:white;font-size:0.85rem;"
                    onchange="filterClubReports()">
                <option value="all">📅 Todos los informes</option>
                <option value="today">Hoy</option>
                <option value="week">Esta semana</option>
            </select>
        </div>

        <div id="club-reports-list" style="flex:1;overflow-y:auto;padding:1.2rem 1.5rem;">
            <p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando informes del club…</p>
        </div>
    </div>`;

    await _loadClubReports();
}

async function _loadClubReports() {
    const me = window._cronosCurrentUser;
    const { db, collection, getDocs, query, where, orderBy } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    try {
        const snap = await getDocs(query(
            collection(db, 'cronos_player_reports'),
            where('clubId', '==', me.clubId),
            orderBy('createdAt', 'desc')
        ));

        window._allClubReports = [];
        snap.forEach(d => window._allClubReports.push({ id: d.id, ...d.data() }));

        renderClubReportsList(window._allClubReports);

    } catch (e) {
        console.error("Error loading club reports:", e);
        document.getElementById('club-reports-list').innerHTML = 
            `<div style="text-align:center;color:#ff5858;padding:2rem;">⚠️ Error al cargar informes: ${e.message}</div>`;
    }
}

function renderClubReportsList(reports) {
    const container = document.getElementById('club-reports-list');
    if (!container) return;

    if (!reports.length) {
        container.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);padding:4rem 2rem;">
                <div style="font-size:3rem;margin-bottom:1rem;">📂</div>
                Aún no hay informes registrados para este club.
            </div>`;
        return;
    }

    container.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; color:var(--text-main);">
            <thead>
                <tr style="text-align:left; border-bottom:1px solid var(--glass-border); color:var(--text-muted);">
                    <th style="padding:0.8rem 0.5rem;">Fecha</th>
                    <th style="padding:0.8rem 0.5rem;">Jugador</th>
                    <th style="padding:0.8rem 0.5rem;">Rival</th>
                    <th style="padding:0.8rem 0.5rem;">Resultado</th>
                    <th style="padding:0.8rem 0.5rem;">Minutos</th>
                    <th style="padding:0.8rem 0.5rem;">Goles/Tj</th>
                    <th style="padding:0.8rem 0.5rem;">Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${reports.map(r => `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.03); transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                        <td style="padding:0.8rem 0.5rem;font-size:0.75rem;white-space:nowrap;">
                            ${new Date(r.createdAt).toLocaleDateString('es-ES', {day:'2-digit', month:'2-digit', year:'2-digit'})}
                        </td>
                        <td style="padding:0.8rem 0.5rem;font-weight:700;">
                            ${r.playerAlias || 'Jugador'} <span style="color:var(--primary); font-size:0.7rem;">#${r.playerNumber}</span>
                        </td>
                        <td style="padding:0.8rem 0.5rem;color:var(--text-muted);">${r.rival || '—'}</td>
                        <td style="padding:0.8rem 0.5rem;">
                            <span style="background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:4px;font-weight:bold;">
                                ${r.scoreHome}-${r.scoreAway}
                            </span>
                        </td>
                        <td style="padding:0.8rem 0.5rem;font-family:monospace;">${r.minutesPlayed || '—'}</td>
                        <td style="padding:0.8rem 0.5rem;">
                            ${r.goals > 0 ? `⚽ <span style="color:#3fb950;font-weight:bold;">${r.goals}</span>` : ''}
                            ${r.cards === 'amarilla' ? '🟨' : r.cards === 'roja' ? '🟥' : ''}
                            ${!r.goals && r.cards === 'ninguna' ? '—' : ''}
                        </td>
                        <td style="padding:0.8rem 0.5rem;">
                            <button onclick="viewReportDetail('${r.id}')" class="btn" 
                                style="font-size:0.7rem;padding:0.2rem 0.5rem;background:rgba(88,166,255,0.1);color:var(--primary);">
                                Ver Detalle
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
}

window.filterClubReports = () => {
    const q = document.getElementById('report-search').value.toLowerCase();
    const time = document.getElementById('report-filter-role').value;
    
    let filtered = window._allClubReports || [];
    
    if (q) {
        filtered = filtered.filter(r => 
            (r.playerAlias || '').toLowerCase().includes(q) || 
            (r.rival || '').toLowerCase().includes(q)
        );
    }
    
    if (time === 'today') {
        const today = new Date().toDateString();
        filtered = filtered.filter(r => new Date(r.createdAt).toDateString() === today);
    } else if (time === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        filtered = filtered.filter(r => new Date(r.createdAt) > weekAgo);
    }
    
    renderClubReportsList(filtered);
};

// ── Modal para enviar informes con selector de contactos ──────────────
window.openSendReportsModal = function() {
    const allContacts = [];

    // Staff desde emailConfig
    const staffContacts = (typeof emailConfig !== 'undefined' ? emailConfig.contacts || [] : [])
        .filter(c => c.type !== 'parent' && (c.phone || c.email));
    staffContacts.forEach(c => {
        allContacts.push({
            id: c.id, type: 'staff',
            label: c.name || c.email || 'Staff',
            phone: c.phone || '', email: c.email || '', uid: c.uid || null,
            defaultOn: (c.tags || []).includes('reports')
        });
    });

    // Padres manuales desde emailConfig
    const parentContacts = (typeof emailConfig !== 'undefined' ? emailConfig.contacts || [] : [])
        .filter(c => c.type === 'parent' && (c.phone || c.email));
    parentContacts.forEach(c => {
        allContacts.push({
            id: c.id, type: 'parent',
            label: c.player ? `${c.name || 'Padre'} (${c.player})` : (c.name || 'Padre'),
            phone: c.phone || '', email: c.email || '', uid: null,
            defaultOn: true
        });
    });

    // Cargar preselección guardada
    let savedPresel = null;
    try { savedPresel = JSON.parse(localStorage.getItem('cronos_reports_preselection') || 'null'); } catch(e) {}

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,500px);max-height:90vh;
         display:flex;flex-direction:column;gap:0.8rem;">

        <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;">📤 Enviar Informes</h3>
            <button onclick="openClubReports()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- Selector de destinatarios -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                    border-radius:10px;padding:0.8rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
                <span style="font-size:0.75rem;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;">
                    📋 DESTINATARIOS
                </span>
                <div style="display:flex;gap:0.4rem;">
                    <button onclick="document.querySelectorAll('.rpt-recipient-chk').forEach(c=>c.checked=true)"
                        style="font-size:0.62rem;padding:0.18rem 0.55rem;background:rgba(88,166,255,0.1);
                               border:1px solid rgba(88,166,255,0.3);border-radius:4px;color:var(--primary);cursor:pointer;">
                        ✓ Todos
                    </button>
                    <button onclick="document.querySelectorAll('.rpt-recipient-chk').forEach(c=>c.checked=false)"
                        style="font-size:0.62rem;padding:0.18rem 0.55rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--text-muted);cursor:pointer;">
                        ✗ Ninguno
                    </button>
                    <button onclick="_rptSavePreselection()"
                        style="font-size:0.62rem;padding:0.18rem 0.55rem;background:rgba(63,185,80,0.1);
                               border:1px solid rgba(63,185,80,0.3);border-radius:4px;color:#3fb950;cursor:pointer;">
                        💾 Guardar
                    </button>
                </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.35rem;max-height:240px;overflow-y:auto;padding-right:4px;">
                ${allContacts.length ? allContacts.map(c => {
                    const isChecked = savedPresel ? savedPresel.includes(c.id) : c.defaultOn;
                    const typeColor  = c.type === 'staff' ? 'rgba(88,166,255,0.12)' : 'rgba(240,136,62,0.08)';
                    const typeBorder = c.type === 'staff' ? 'rgba(88,166,255,0.25)' : 'rgba(240,136,62,0.2)';
                    const typeIcon   = c.type === 'staff' ? '🏢' : '👨‍👩‍👧';
                    return `
                    <label style="display:flex;align-items:center;gap:0.55rem;
                                   background:${typeColor};border:1px solid ${typeBorder};
                                   border-radius:7px;padding:0.45rem 0.65rem;cursor:pointer;">
                        <input type="checkbox" class="rpt-recipient-chk"
                            data-id="${c.id}" data-phone="${c.phone}" data-email="${c.email}" data-uid="${c.uid || ''}"
                            ${isChecked ? 'checked' : ''}
                            style="width:15px;height:15px;flex-shrink:0;accent-color:var(--primary);">
                        <span style="font-size:0.7rem;flex-shrink:0;">${typeIcon}</span>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.78rem;font-weight:600;">${c.label}</div>
                            <div style="font-size:0.63rem;color:var(--text-muted);">
                                ${c.phone ? `📱 ${c.phone}` : ''}${c.phone && c.email ? ' · ' : ''}${c.email ? `📧 ${c.email}` : ''}
                            </div>
                        </div>
                        ${c.phone ? `<span style="font-size:0.58rem;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.3);border-radius:3px;padding:1px 4px;color:#3fb950;">WA</span>` : ''}
                        ${c.email ? `<span style="font-size:0.58rem;background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.25);border-radius:3px;padding:1px 4px;color:var(--primary);">Email</span>` : ''}
                    </label>`;
                }).join('') : `<div style="text-align:center;color:var(--text-muted);font-size:0.78rem;padding:1rem;">
                    ⚠️ No hay contactos configurados. Ve a Gestión de Contactos para añadirlos.
                </div>`}
            </div>
            <p style="font-size:0.62rem;color:var(--text-muted);margin:0.5rem 0 0;">
                💡 Pulsa "Guardar" para recordar siempre esta selección.
            </p>
        </div>

        <!-- Filtro de periodo -->
        <div style="background:rgba(255,255,255,0.02);border:1px solid var(--glass-border);
                    border-radius:8px;padding:0.7rem 0.8rem;">
            <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">
                📅 Informes a incluir
            </label>
            <select id="rpt-period" style="width:100%;padding:0.4rem;background:rgba(255,255,255,0.05);
                    border:1px solid var(--glass-border);border-radius:6px;color:white;font-size:0.84rem;">
                <option value="last">Último partido</option>
                <option value="week">Última semana</option>
                <option value="all">Todos los disponibles</option>
            </select>
        </div>

        <!-- Botones -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;flex-shrink:0;">
            <button onclick="openClubReports()" class="btn"
                style="color:var(--text-muted);font-size:0.78rem;">← Volver</button>
            <button onclick="_sendReportsViaWA()" class="btn"
                style="background:rgba(37,211,102,0.15);border-color:rgba(37,211,102,0.4);
                       color:#25d366;font-weight:700;font-size:0.78rem;">
                📱 WhatsApp
            </button>
            <button onclick="_sendReportsViaEmail()" class="btn"
                style="background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.4);
                       color:var(--primary);font-weight:700;font-size:0.78rem;">
                📧 Email
            </button>
        </div>
    </div>`;
};

window._rptSavePreselection = function() {
    const ids = Array.from(document.querySelectorAll('.rpt-recipient-chk:checked')).map(c => c.dataset.id);
    localStorage.setItem('cronos_reports_preselection', JSON.stringify(ids));
    showToast('✅ Selección guardada como predeterminada', 2500);
};

function _rptBuildReportText(reports) {
    if (!reports.length) return 'No hay informes disponibles.';
    const grouped = {};
    reports.forEach(r => {
        const key = r.matchDate || new Date(r.createdAt).toLocaleDateString('es-ES');
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
    });
    let msg = `📊 *INFORMES DEL CLUB*\n`;
    msg += `━━━━━━━━━━━━━━━━\n\n`;
    Object.entries(grouped).forEach(([date, rpts]) => {
        msg += `📅 *${date}*\n`;
        rpts.forEach(r => {
            msg += `• ${r.playerAlias || 'Jugador'} #${r.playerNumber} — `;
            msg += `vs ${r.rival || '—'} (${r.scoreHome}-${r.scoreAway}) `;
            msg += `⏱️${r.minutesPlayed || '—'}`;
            if (r.goals > 0) msg += ` ⚽${r.goals}`;
            if (r.cards === 'amarilla') msg += ' 🟨';
            if (r.cards === 'roja') msg += ' 🟥';
            msg += '\n';
        });
        msg += '\n';
    });
    msg += `_Cronos Fútbol_ ⚽`;
    return msg;
}

function _rptGetFilteredReports() {
    const period  = document.getElementById('rpt-period')?.value || 'last';
    const all     = window._allClubReports || [];
    if (!all.length) return [];
    if (period === 'last') {
        const latestDate = all[0]?.matchDate || '';
        return latestDate ? all.filter(r => r.matchDate === latestDate) : [all[0]];
    }
    if (period === 'week') {
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
        return all.filter(r => new Date(r.createdAt) > weekAgo);
    }
    return all;
}

window._sendReportsViaWA = function() {
    const recipients = Array.from(document.querySelectorAll('.rpt-recipient-chk:checked'))
        .filter(c => c.dataset.phone);
    if (!recipients.length) { showToast('⚠️ Ningún destinatario con WhatsApp seleccionado', 3000); return; }
    const reports = _rptGetFilteredReports();
    const encoded = encodeURIComponent(_rptBuildReportText(reports));
    recipients.forEach((r, i) => {
        setTimeout(() => window.open(`https://wa.me/${r.dataset.phone}?text=${encoded}`, '_blank'), i * 800);
    });
    showToast(`📱 Enviando a ${recipients.length} contacto${recipients.length > 1 ? 's' : ''} por WhatsApp`, 4000);
};

window._sendReportsViaEmail = function() {
    const recipients = Array.from(document.querySelectorAll('.rpt-recipient-chk:checked'))
        .filter(c => c.dataset.email);
    if (!recipients.length) { showToast('⚠️ Ningún destinatario con email seleccionado', 3000); return; }
    const reports = _rptGetFilteredReports();
    const toList  = recipients.map(r => r.dataset.email).join(',');
    const subject = encodeURIComponent(`📊 Informes del Club — ${new Date().toLocaleDateString('es-ES')}`);
    const body    = encodeURIComponent(_rptBuildReportText(reports).replace(/[*_]/g, ''));
    window.open(`mailto:${toList}?subject=${subject}&body=${body}`, '_blank');
    showToast(`📧 Email abierto para ${recipients.length} destinatario${recipients.length > 1 ? 's' : ''}`, 3000);
};

window.viewReportDetail = async (id) => {
    const r = (window._allClubReports || []).find(x => x.id === id);
    if (!r) return;

    alert(`Detalle del Informe:\n\n` +
          `Jugador: ${r.playerAlias} (#${r.playerNumber})\n` +
          `Partido: ${r.rival} (${r.scoreHome}-${r.scoreAway})\n` +
          `Minutos: ${r.minutesPlayed}\n` +
          `Goles: ${r.goals}\n` +
          `Tarjetas: ${r.cards}\n` +
          `Lesionado: ${r.injured ? 'SÍ' : 'NO'}\n\n` +
          `Fecha: ${new Date(r.createdAt).toLocaleString()}`);
};

window.openClubReports = openClubReports;

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
            <button onclick="document.getElementById('setup-modal').style.display='none'"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.4rem;cursor:pointer;">✕</button>
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

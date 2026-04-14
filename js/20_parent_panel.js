// ══════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Panel de Padres
// ══════════════════════════════════════════════════════════════════

window.loadParentDashboard = async function() {
    const me = window._cronosCurrentUser;
    if (!me || !me.email) {
        showAuth();
        return;
    }

    showSpinner('Cargando panel de padres…');

    try {
        const { collection, getDocs, query, where, orderBy, limit } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth?.db;
        if (!db) throw new Error('Firestore no disponible');

        // Buscar el vínculo padre-jugador
        const linksSnap = await getDocs(query(
            collection(db, 'cronos_player_links'),
            where('parentEmail', '==', me.email)
        ));
        const links = [];
        linksSnap.forEach(d => links.push({ id: d.id, ...d.data() }));

        // Buscar notificaciones para este padre
        const notifsSnap = await getDocs(query(
            collection(db, 'cronos_notifications'),
            where('parentUid', '==', me.uid),
            orderBy('createdAt', 'desc'),
            limit(20)
        ));
        const notifs = [];
        notifsSnap.forEach(d => notifs.push({ id: d.id, ...d.data() }));

        hideSpinner();
        renderParentPanel(me, links, notifs);
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error al cargar: ' + e.message, 5000);
    }
};

function renderParentPanel(me, links, notifs) {
    const main = document.getElementById('main-content');
    if (!main) return;

    const playerName = (links.length && links[0].playerAlias) 
        ? links[0].playerAlias 
        : (links.length && links[0].playerName) 
            ? links[0].playerName : '—';

    main.innerHTML = `
        <div style="max-width:800px;margin:0 auto;padding:1rem;">
            <div style="text-align:center;margin-bottom:1.5rem;">
                <div style="font-size:1.4rem;font-weight:700;color:var(--primary);">
                    👨‍👩‍👧 Panel de Padres
                </div>
                <div style="font-size:0.85rem;color:var(--text-muted);margin-top:0.3rem;">
                    ${typeof escapeHtml==='function'?escapeHtml(me.displayName || me.email):me.displayName || me.email}
                </div>
            </div>

            <!-- Vinculación -->
            <div style="background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.2);
                        border-radius:12px;padding:1rem;margin-bottom:1rem;">
                <div style="font-size:0.82rem;font-weight:700;color:var(--primary);margin-bottom:0.5rem;">
                    🔗 Mi jugador vinculado
                </div>
                ${links.length > 0 ? `
                    <div style="font-size:0.95rem;font-weight:600;">
                        ⚽ ${typeof escapeHtml==='function'?escapeHtml(playerName):playerName}
                    </div>
                    ${links.length > 1 ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">
                        (+${links.length - 1} vínculo${links.length - 1 > 1 ? 's' : ''} más)
                    </div>` : ''}
                ` : `
                    <div style="font-size:0.82rem;color:var(--text-muted);">
                        ⚠️ No tienes ningún jugador vinculado todavía.
                        Contacta con tu entrenador para que te vincule.
                    </div>
                `}
            </div>

            <!-- Notificaciones -->
            <div style="background:rgba(240,136,62,0.05);border:1px solid rgba(240,136,62,0.15);
                        border-radius:12px;padding:1rem;margin-bottom:1rem;">
                <div style="font-size:0.82rem;font-weight:700;color:var(--secondary);margin-bottom:0.7rem;">
                    📬 Notificaciones (${notifs.length})
                </div>
                <div id="parent-notifs-list" style="display:flex;flex-direction:column;gap:0.5rem;
                     max-height:450px;overflow-y:auto;">
                    ${notifs.length === 0 ? `
                        <div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.82rem;">
                            No tienes notificaciones todavía.
                        </div>
                    ` : notifs.map(n => renderParentNotifCard(n)).join('')}
                </div>
            </div>

            <!-- Botón cerrar sesión -->
            <div style="text-align:center;margin-top:1.5rem;">
                <button onclick="signOutUser()" class="btn" style="color:var(--text-muted);">
                    🚪 Cerrar sesión
                </button>
            </div>
        </div>
    `;
}

function renderParentNotifCard(n) {
    const typeLabels = {
        convocatoria: '📋 Convocatoria',
        mensaje: '💬 Mensaje',
        aviso: '📢 Aviso'
    };
    const label = typeLabels[n.type] || '📨 Notificación';
    const dateStr = n.createdAt 
        ? new Date(n.createdAt).toLocaleDateString('es-ES', {
            day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
        }) : '';

    const rival = n.rival ? ` vs ${typeof escapeHtml==='function'?escapeHtml(n.rival):n.rival}` : '';
    const venue = n.venue ? ` — ${typeof escapeHtml==='function'?escapeHtml(n.venue):n.venue}` : '';
    const meettime = n.meettime ? `\n🕐 Presentarse: ${n.meettime}h` : '';
    const kickoff = n.kickoff ? `\n⚽ Inicio: ${n.kickoff}h` : '';
    const extra = n.extra ? `\n💬 ${typeof escapeHtml==='function'?escapeHtml(n.extra):n.extra}` : '';

    let playersHtml = '';
    if (n.players && n.players.length) {
        playersHtml = `
            <div style="margin-top:0.4rem;padding-top:0.4rem;border-top:1px solid rgba(255,255,255,0.06);
                        font-size:0.78rem;color:var(--text-muted);">
                👥 Convocados:<br>
                ${n.players.map((p,i) => `${i+1}. ${typeof escapeHtml==='function'?escapeHtml(p):p}`).join('<br>')}
            </div>
        `;
    }

    const bgColors = {
        convocatoria: 'rgba(63,185,80,0.06)',
        mensaje: 'rgba(88,166,255,0.06)',
        aviso: 'rgba(240,136,62,0.06)'
    };
    const borderColors = {
        convocatoria: 'rgba(63,185,80,0.2)',
        mensaje: 'rgba(88,166,255,0.2)',
        aviso: 'rgba(240,136,62,0.2)'
    };
    const bg = bgColors[n.type] || 'rgba(255,255,255,0.03)';
    const border = borderColors[n.type] || 'rgba(255,255,255,0.08)';

    return `
        <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:0.7rem 0.9rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                <span style="font-size:0.78rem;font-weight:700;color:var(--text);">${label}</span>
                <span style="font-size:0.62rem;color:var(--text-muted);">${dateStr}</span>
            </div>
            ${n.type === 'convocatoria' ? `
                <div style="font-size:0.85rem;font-weight:600;color:var(--text);">
                    📅 ${typeof escapeHtml==='function'?escapeHtml(n.matchDate || ''):n.matchDate || ''}${rival}
                </div>
                <div style="font-size:0.75rem;color:var(--text-muted);white-space:pre-line;">
                    ${venue}${meettime}${kickoff}
                </div>
                ${extra}
                ${playersHtml}
            ` : `
                <div style="font-size:0.82rem;color:var(--text);white-space:pre-line;">
                    ${typeof escapeHtml==='function'?escapeHtml(n.fullText || n.body || ''):n.fullText || n.body || ''}
                </div>
            `}
        </div>
    `;
}

// ── Listar partidos recientes del club del padre ──────────────────
window.loadParentMatches = async function() {
    const me = window._cronosCurrentUser;
    if (!me || !window._cronos_auth) return;

    const db = window._cronos_auth.db;
    const { collection, getDocs, query, where, orderBy, limit } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    showSpinner('Cargando partidos…');
    try {
        const snap = await getDocs(query(
            collection(db, 'cronos_matches'),
            where('clubId', '==', me.clubId || ''),
            orderBy('createdAt', 'desc'),
            limit(10)
        ));
        const matches = [];
        snap.forEach(d => matches.push({ id: d.id, ...d.data() }));
        hideSpinner();
        renderParentMatches(matches);
    } catch(e) {
        hideSpinner();
        showToast('⚠️ ' + e.message, 4000);
    }
};

function renderParentMatches(matches) {
    const container = document.getElementById('parent-matches-list');
    if (!container) return;

    if (!matches.length) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.82rem;">
            No hay partidos registrados todavía.</div>`;
        return;
    }

    container.innerHTML = matches.map(m => {
        const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString('es-ES', {
            day:'numeric', month:'short', year:'numeric'
        }) : '—';
        const rival = m.rival || '—';
        const score = (m.homeScore != null && m.awayScore != null) 
            ? `${m.homeScore} - ${m.awayScore}` : 'Pendiente';

        return `
            <div style="background:rgba(88,166,255,0.04);border:1px solid rgba(88,166,255,0.12);
                        border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.4rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:0.85rem;font-weight:600;">
                            🆚 ${typeof escapeHtml==='function'?escapeHtml(rival):rival}
                        </div>
                        <div style="font-size:0.7rem;color:var(--text-muted);">📅 ${date}</div>
                    </div>
                    <div style="font-size:1rem;font-weight:700;color:var(--primary);">${score}</div>
                </div>
            </div>
        `;
    }).join('');
}
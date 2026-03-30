// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Panel de Padres/Madres v3
//  3 pestañas: 🔴 En Vivo · 📬 Mensajes · 👤 Mi Jugador
// ════════════════════════════════════════════════════════════════════

async function openParentPanel() {
    const me = window._cronosCurrentUser;
    if (!me) return;

    // Ocultar app principal
    ['main-header', 'main-container', 'auth-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const fa     = window._cronos_auth;
    const clubId = me.clubId || null;
    let   clubName = '';

    if (fa && clubId) {
        try {
            const { doc, getDoc } = await import(
                'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            const cs = await getDoc(doc(fa.db, 'clubs', clubId));
            if (cs.exists()) clubName = cs.data().name || '';
        } catch(e) {}
    }

    // Crear / reutilizar contenedor
    let panel = document.getElementById('parent-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'parent-panel';
        document.body.appendChild(panel);
    }
    panel.style.cssText =
        'position:fixed;inset:0;background:#0a0e14;z-index:8000;' +
        'display:flex;flex-direction:column;overflow:hidden;font-family:inherit;';

    panel.innerHTML = `
    <style>
        #parent-panel .pp-tab {
            padding:0.55rem 1.1rem;
            background:rgba(255,255,255,0.04);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:8px;
            color:#7d8590;
            font-size:0.84rem;
            cursor:pointer;
            transition:all 0.15s;
            white-space:nowrap;
        }
        #parent-panel .pp-tab.active {
            background:rgba(88,166,255,0.15);
            border-color:rgba(88,166,255,0.5);
            color:#58a6ff;
            font-weight:700;
        }
        #parent-panel .pp-card {
            background:rgba(255,255,255,0.04);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:12px;
            padding:1rem 1.2rem;
            margin-bottom:0.75rem;
        }
        #parent-panel .pp-empty {
            text-align:center;
            color:#7d8590;
            padding:4rem 1rem;
            font-size:0.9rem;
            line-height:1.8;
        }
        #parent-panel .pp-stat {
            background:rgba(255,255,255,0.04);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:10px;
            padding:0.75rem 0.5rem;
            text-align:center;
        }
        @keyframes ppPulse{0%,100%{opacity:1}50%{opacity:0.35}}
    </style>

    <!-- TOPBAR -->
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:0.85rem 1.2rem;
                border-bottom:1px solid rgba(255,255,255,0.08);
                background:rgba(10,14,20,0.98);flex-shrink:0;">
        <div>
            <div style="font-size:1rem;font-weight:700;color:white;">
                👨‍👩‍👧 Área de Familias
                ${clubName ? `<span style="font-size:0.74rem;color:#7d8590;
                    font-weight:400;margin-left:0.4rem;">· ${clubName}</span>` : ''}
            </div>
            <div style="font-size:0.71rem;color:#7d8590;margin-top:0.12rem;">
                ${me.email || ''}
            </div>
        </div>
        <button onclick="cerrarSesion()"
            style="background:none;border:1px solid rgba(255,88,88,0.35);
                   color:rgba(255,88,88,0.75);font-size:0.74rem;
                   padding:0.35rem 0.85rem;border-radius:6px;cursor:pointer;">
            ⏻ Salir
        </button>
    </div>

    <!-- TABS -->
    <div style="display:flex;gap:0.5rem;padding:0.7rem 1.2rem;
                border-bottom:1px solid rgba(255,255,255,0.08);
                flex-shrink:0;">
        <button class="pp-tab active" onclick="ppTab('live',this)">🔴 En Vivo</button>
        <button class="pp-tab"        onclick="ppTab('msgs',this)">📬 Mensajes</button>
        <button class="pp-tab"        onclick="ppTab('player',this)">👤 Mi Jugador</button>
    </div>

    <!-- CUERPO -->
    <div id="pp-body" style="flex:1;overflow-y:auto;padding:1.1rem 1.2rem;">
        <p style="color:#7d8590;text-align:center;padding:3rem;">⏳ Cargando…</p>
    </div>`;

    // ── Router ────────────────────────────────────────────────────
    window.ppTab = (tab, btn) => {
        panel.querySelectorAll('.pp-tab').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        document.getElementById('pp-body').innerHTML =
            '<p style="color:#7d8590;text-align:center;padding:3rem;">⏳ Cargando…</p>';
        ({ live: ppLive, msgs: ppMsgs, player: ppPlayer })[tab]?.();
    };

    // ══════════════════════════════════════════════════════════════
    // TAB 1 · EN VIVO
    // ══════════════════════════════════════════════════════════════
    window.ppLive = async () => {
        const body = document.getElementById('pp-body');
        try {
            const { collection, getDocs, query, where } = await import(
                'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            const q = clubId
                ? query(collection(fa.db,'live_matches'),
                        where('clubId','==',clubId),
                        where('status','==','active'))
                : query(collection(fa.db,'live_matches'),
                        where('status','==','active'));

            const snap = await getDocs(q);
            const matches = [];
            snap.forEach(d => matches.push({ _id: d.id, ...d.data() }));

            if (!matches.length) {
                body.innerHTML = `<div class="pp-empty">
                    🔴 No hay ningún partido en vivo ahora mismo.<br>
                    <span style="font-size:0.8rem;color:#555;">
                        Cuando empiece el partido aparecerá aquí automáticamente.
                    </span>
                </div>`;
                return;
            }

            body.innerHTML = matches.map(m => {
                const liveUrl = location.origin +
                    location.pathname.replace('index.html','') +
                    'live.html?match=' + m._id;
                const elapsed = (typeof formatTime === 'function')
                    ? formatTime((m.timeH1||0) + (m.timeH2||0)) : '';

                return `
                <div class="pp-card" style="border-color:rgba(255,88,88,0.4);
                                             background:rgba(255,88,88,0.04);">
                    <div style="display:flex;justify-content:space-between;
                                align-items:flex-start;gap:1rem;flex-wrap:wrap;">
                        <div>
                            <div style="font-size:0.84rem;font-weight:700;color:#ff5858;
                                        margin-bottom:0.4rem;
                                        animation:ppPulse 1.5s ease-in-out infinite;">
                                🔴 PARTIDO EN VIVO
                            </div>
                            <div style="font-size:1.2rem;font-weight:700;margin-bottom:0.3rem;">
                                <span style="color:${m.homeTeam?.color||'#58a6ff'};">
                                    ${m.homeTeam?.name||'Local'}
                                </span>
                                <span style="color:white;margin:0 0.5rem;">
                                    ${m.homeTeam?.score||0} - ${m.awayTeam?.score||0}
                                </span>
                                <span style="color:${m.awayTeam?.color||'#ff5858'};">
                                    ${m.awayTeam?.name||'Visitante'}
                                </span>
                            </div>
                            ${elapsed ? `<div style="font-size:0.76rem;color:#7d8590;">
                                ⏱️ ${elapsed}
                            </div>` : ''}
                        </div>
                        <a href="${liveUrl}" target="_blank"
                            style="display:inline-block;padding:0.65rem 1.2rem;
                                   background:#ff5858;border-radius:8px;color:#fff;
                                   font-weight:700;font-size:0.86rem;
                                   text-decoration:none;white-space:nowrap;">
                            👁️ Ver partido
                        </a>
                    </div>
                </div>`;
            }).join('');

        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ ${e.message}</div>`;
        }
    };

    // ══════════════════════════════════════════════════════════════
    // TAB 2 · MENSAJES — convocatorias + entrenamientos juntos
    // ══════════════════════════════════════════════════════════════
    window.ppMsgs = async () => {
        const body = document.getElementById('pp-body');
        try {
            const { collection, getDocs, query, where } = await import(
                'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            let snap;
            if (clubId) {
                snap = await getDocs(query(
                    collection(fa.db,'cronos_notifications'),
                    where('clubId','==',clubId)
                ));
            } else {
                snap = await getDocs(collection(fa.db,'cronos_notifications'));
            }

            const items = [];
            snap.forEach(d => {
                const dat = d.data();
                if (dat.type === 'convocatoria' || dat.type === 'entrenamiento') {
                    items.push({ _id: d.id, ...dat });
                }
            });
            items.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

            if (!items.length) {
                body.innerHTML = `<div class="pp-empty">
                    📬 Todavía no hay mensajes del entrenador.<br>
                    <span style="font-size:0.8rem;color:#555;">
                        Aquí recibirás las convocatorias y la información
                        de los entrenamientos.
                    </span>
                </div>`;
                return;
            }

            body.innerHTML = items.map(n => {
                const isConv = n.type === 'convocatoria';
                const accent = isConv ? '#3fb950' : '#58a6ff';
                const icon   = isConv ? '📋' : '📅';
                const title  = isConv ? 'Convocatoria' : 'Entrenamiento';
                const sent   = n.createdAt
                    ? new Date(n.createdAt).toLocaleDateString('es-ES',
                        {day:'numeric', month:'long', year:'numeric'})
                    : '';

                const inner = isConv ? `
                    ${n.matchDate ? `<div style="font-size:0.83rem;margin-bottom:0.25rem;">
                        📅 <strong>${n.matchDate}</strong>
                        ${n.rival ? ` · 🆚 vs <strong>${n.rival}</strong>` : ''}
                    </div>` : ''}
                    ${n.venue    ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">🏟️ ${n.venue}</div>` : ''}
                    ${n.meettime ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">🕐 Presentación: <strong>${n.meettime}h</strong></div>` : ''}
                    ${n.kickoff  ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">⚽ Inicio: <strong>${n.kickoff}h</strong></div>` : ''}
                    ${n.players?.length ? `
                    <div style="margin-top:0.5rem;padding:0.55rem 0.8rem;
                                background:rgba(63,185,80,0.07);border-radius:8px;
                                border:1px solid rgba(63,185,80,0.2);">
                        <div style="font-size:0.71rem;font-weight:700;
                                    color:#3fb950;margin-bottom:0.35rem;">
                            👥 CONVOCADOS (${n.players.length})
                        </div>
                        <div style="font-size:0.8rem;line-height:1.8;">
                            ${n.players.map((p,i)=>`${i+1}. ${p}`).join('<br>')}
                        </div>
                    </div>` : ''}
                    ${n.extra ? `<div style="font-size:0.8rem;margin-top:0.5rem;
                        color:#7d8590;font-style:italic;">💬 ${n.extra}</div>` : ''}
                ` : `
                    ${n.trainDate ? `<div style="font-size:0.83rem;margin-bottom:0.25rem;">
                        📅 <strong>${n.trainDate}</strong>
                        ${n.trainTime ? ` · 🕐 <strong>${n.trainTime}h</strong>` : ''}
                    </div>` : ''}
                    ${n.venue ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">📍 ${n.venue}</div>` : ''}
                    ${n.content ? `
                    <div style="font-size:0.82rem;line-height:1.6;margin-top:0.5rem;
                                padding:0.55rem 0.8rem;
                                background:rgba(88,166,255,0.06);
                                border-radius:8px;border:1px solid rgba(88,166,255,0.15);">
                        ${n.content.replace(/\n/g,'<br>')}
                    </div>` : ''}
                `;

                return `
                <div class="pp-card" style="border-left:3px solid ${accent};">
                    <div style="display:flex;justify-content:space-between;
                                margin-bottom:0.55rem;flex-wrap:wrap;gap:0.3rem;">
                        <span style="font-weight:700;color:${accent};">${icon} ${title}</span>
                        <span style="font-size:0.71rem;color:#7d8590;">${sent}</span>
                    </div>
                    ${inner}
                </div>`;
            }).join('');

        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ ${e.message}</div>`;
        }
    };

    // ══════════════════════════════════════════════════════════════
    // TAB 3 · MI JUGADOR — estadísticas + historial por partido
    // ══════════════════════════════════════════════════════════════
    window.ppPlayer = async () => {
        const body = document.getElementById('pp-body');
        try {
            const { collection, getDocs, query, where } = await import(
                'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            // Vínculo padre → jugador
            const linkSnap = await getDocs(query(
                collection(fa.db, 'cronos_player_links'),
                where('parentUid', '==', me.uid)
            ));
            const links = [];
            linkSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

            if (!links.length) {
                body.innerHTML = `<div class="pp-empty">
                    👤 Tu cuenta aún no está vinculada a ningún jugador.<br>
                    <span style="font-size:0.8rem;color:#555;">
                        El administrador del club asignará el jugador correspondiente
                        a tu cuenta.
                    </span>
                </div>`;
                return;
            }

            const link        = links[0];
            const playerLabel = link.playerAlias || link.playerName
                              || `Jugador #${link.playerNumber}`;

            // Informes de partido enviados por el entrenador
            const rptSnap = await getDocs(query(
                collection(fa.db, 'cronos_player_reports'),
                where('parentUid', '==', me.uid)
            ));
            const reports = [];
            rptSnap.forEach(d => reports.push({ _id: d.id, ...d.data() }));
            reports.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

            // ── Acumulados ───────────────────────────────────────
            const totalGoals   = reports.reduce((s,r) => s + (r.goals||0), 0);
            const totalYellow  = reports.filter(r => r.cards === 'amarilla').length;
            const totalRed     = reports.filter(r => r.cards === 'roja').length;
            const totalInjured = reports.filter(r => r.injured).length;
            const totalGames   = reports.length;

            const mmssToSec = (str) => {
                if (!str) return 0;
                const p = str.split(':');
                return (parseInt(p[0])||0)*60 + (parseInt(p[1])||0);
            };
            const totalSecs  = reports.reduce((s,r) => s + mmssToSec(r.minutesPlayed), 0);
            const totalMins  = Math.floor(totalSecs / 60);
            const totalHours = Math.floor(totalMins / 60);
            const remMins    = totalMins % 60;
            const totalTimeStr = totalHours > 0
                ? `${totalHours}h ${remMins}m`
                : `${totalMins} min`;

            body.innerHTML = `

            <!-- Cabecera jugador -->
            <div class="pp-card" style="border-color:rgba(88,166,255,0.4);
                                         background:rgba(88,166,255,0.05);
                                         margin-bottom:1rem;">
                <div style="font-size:1.05rem;font-weight:700;">
                    ⚽ ${playerLabel}
                    <span style="color:#58a6ff;"> · #${link.playerNumber}</span>
                </div>
                <div style="font-size:0.74rem;color:#7d8590;margin-top:0.15rem;">
                    ${link.teamName || clubName || ''}
                </div>
            </div>

            <!-- Estadísticas acumuladas -->
            <div style="font-size:0.74rem;font-weight:700;color:#7d8590;
                        letter-spacing:0.5px;margin-bottom:0.55rem;">
                ESTADÍSTICAS ACUMULADAS
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);
                        gap:0.6rem;margin-bottom:1.4rem;">
                ${[
                    ['⚽', 'Goles',      totalGoals,    '#3fb950'],
                    ['⏱️', 'Tiempo jug.', totalTimeStr,  '#58a6ff'],
                    ['🏃', 'Partidos',   totalGames,    '#d2a8ff'],
                    ['🟨', 'Amarillas',  totalYellow,   '#f0883e'],
                    ['🟥', 'Rojas',      totalRed,      '#ff5858'],
                    ['🚑', 'Lesiones',   totalInjured,  '#ffa500'],
                ].map(([icon, label, val, color]) => `
                    <div class="pp-stat">
                        <div style="font-size:1.3rem;margin-bottom:0.15rem;">${icon}</div>
                        <div style="font-size:1.1rem;font-weight:700;
                                    color:${color};line-height:1.1;">
                            ${val}
                        </div>
                        <div style="font-size:0.63rem;color:#7d8590;margin-top:0.2rem;">
                            ${label}
                        </div>
                    </div>`).join('')}
            </div>

            <!-- Historial partido a partido -->
            <div style="font-size:0.74rem;font-weight:700;color:#7d8590;
                        letter-spacing:0.5px;margin-bottom:0.55rem;">
                HISTORIAL DE PARTIDOS (${totalGames})
            </div>

            ${reports.length ? reports.map((r, idx) => {
                const cardBadge = r.cards === 'amarilla'
                    ? '<span style="font-size:0.68rem;background:rgba(240,136,62,0.2);color:#f0883e;border-radius:4px;padding:1px 7px;">🟨 Amarilla</span>'
                    : r.cards === 'roja'
                        ? '<span style="font-size:0.68rem;background:rgba(255,88,88,0.2);color:#ff5858;border-radius:4px;padding:1px 7px;">🟥 Roja</span>'
                        : '';
                const injBadge = r.injured
                    ? '<span style="font-size:0.68rem;background:rgba(255,165,0,0.2);color:#ffa500;border-radius:4px;padding:1px 7px;">🚑 Lesión</span>'
                    : '';

                return `
                <div class="pp-card">
                    <div style="display:flex;justify-content:space-between;
                                align-items:flex-start;flex-wrap:wrap;gap:0.4rem;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:0.86rem;margin-bottom:0.18rem;">
                                Partido ${idx+1}
                                ${r.rival
                                    ? ` · <span style="color:#7d8590;font-weight:400;">
                                          🆚 ${r.rival}</span>`
                                    : ''}
                            </div>
                            <div style="font-size:0.73rem;color:#7d8590;">
                                📅 ${r.matchDate || '—'}
                                ${r.scoreHome !== undefined
                                    ? ` · <strong style="color:white;">
                                          ${r.scoreHome}-${r.scoreAway}</strong>`
                                    : ''}
                            </div>
                        </div>
                        <div style="display:flex;flex-direction:column;
                                    align-items:flex-end;gap:0.2rem;flex-shrink:0;">
                            <div style="font-size:0.82rem;">
                                ⏱️ <strong>${r.minutesPlayed || '—'}</strong>
                            </div>
                            <div style="font-size:0.82rem;">
                                ⚽ <strong>${r.goals||0}</strong>
                                ${(r.goals||0)===1 ? 'gol' : 'goles'}
                            </div>
                            ${cardBadge || injBadge ? `
                            <div style="display:flex;gap:0.3rem;flex-wrap:wrap;
                                        justify-content:flex-end;margin-top:0.1rem;">
                                ${cardBadge}${injBadge}
                            </div>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('') : `
            <div class="pp-empty" style="padding:2rem 1rem;">
                📊 Aún no hay informes de partido para este jugador.<br>
                <span style="font-size:0.8rem;color:#555;">
                    Cuando el entrenador envíe el informe tras cada partido,
                    los datos aparecerán aquí.
                </span>
            </div>`}`;

        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ ${e.message}</div>`;
        }
    };

    // Animación pulso
    if (!document.getElementById('pp-pulse-style')) {
        const s = document.createElement('style');
        s.id = 'pp-pulse-style';
        s.textContent = '@keyframes ppPulse{0%,100%{opacity:1}50%{opacity:0.35}}';
        document.head.appendChild(s);
    }

    // Cargar pestaña inicial
    ppLive();
}

window.openParentPanel = openParentPanel;


// ════════════════════════════════════════════════════════════════════
//  ENVIAR INFO DE ENTRENAMIENTO (entrenador → Firestore)
// ════════════════════════════════════════════════════════════════════
function openTrainingNotification() {
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,520px);max-height:92vh;
         display:flex;flex-direction:column;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:0.9rem;flex-shrink:0;">
            <h2 style="margin:0;font-size:1rem;">📅 Publicar Info de Entrenamiento</h2>
            <button onclick="document.getElementById('setup-modal').style.display='none'"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>
        <div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:0.75rem;">
            <div>
                <label style="font-size:0.73rem;color:var(--text-muted);
                               display:block;margin-bottom:0.3rem;">
                    📅 Fecha del entrenamiento *
                </label>
                <input type="date" id="tr-date"
                    value="${new Date().toISOString().substring(0,10)}"
                    style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>
            <div>
                <label style="font-size:0.73rem;color:var(--text-muted);
                               display:block;margin-bottom:0.3rem;">
                    🕐 Hora de inicio
                </label>
                <input type="time" id="tr-time"
                    style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>
            <div>
                <label style="font-size:0.73rem;color:var(--text-muted);
                               display:block;margin-bottom:0.3rem;">
                    📍 Lugar
                </label>
                <input type="text" id="tr-venue"
                    placeholder="Ciudad Deportiva, Campo 3…"
                    style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>
            <div>
                <label style="font-size:0.73rem;color:var(--text-muted);
                               display:block;margin-bottom:0.3rem;">
                    💬 Indicaciones (equipación, material, etc.)
                </label>
                <textarea id="tr-content" rows="4"
                    placeholder="ej: Traer equipación azul. Hidratación obligatoria."
                    style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.9rem;
                           box-sizing:border-box;resize:vertical;"></textarea>
            </div>
            <div style="background:rgba(88,166,255,0.06);
                        border:1px solid rgba(88,166,255,0.18);
                        border-radius:8px;padding:0.6rem 0.85rem;
                        font-size:0.77rem;color:var(--text-muted);">
                💡 Los padres recibirán esta información en la pestaña
                <strong>Mensajes</strong> de su panel.
            </div>
            <div id="tr-msg" style="font-size:0.8rem;min-height:1rem;text-align:center;"></div>
        </div>
        <div style="display:flex;gap:0.6rem;margin-top:0.9rem;flex-shrink:0;">
            <button onclick="document.getElementById('setup-modal').style.display='none'"
                class="btn" style="flex:1;color:var(--text-muted);">
                Cancelar
            </button>
            <button onclick="sendTrainingNotification()" class="btn primary" style="flex:2;">
                📤 Publicar
            </button>
        </div>
    </div>`;
}
window.openTrainingNotification = openTrainingNotification;

async function sendTrainingNotification() {
    const me  = window._cronosCurrentUser;
    const fa  = window._cronos_auth;
    const date = document.getElementById('tr-date')?.value;
    const msg  = document.getElementById('tr-msg');
    if (!date) { msg.style.color='#ff5858'; msg.textContent='⚠️ La fecha es obligatoria.'; return; }

    msg.style.color='var(--primary)'; msg.textContent='Publicando…';

    const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('es-ES',{
        weekday:'long', day:'numeric', month:'long'});

    const payload = {
        type:       'entrenamiento',
        clubId:     me?.clubId || null,
        coachEmail: me?.email  || '',
        coachUid:   me?.uid    || '',
        trainDate:  dateStr,
        trainTime:  document.getElementById('tr-time')?.value || '',
        venue:      document.getElementById('tr-venue')?.value.trim() || '',
        content:    document.getElementById('tr-content')?.value.trim() || '',
        createdAt:  new Date().toISOString(),
    };

    try {
        const { setDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await setDoc(
            doc(fa.db, 'cronos_notifications', 'train_' + Date.now().toString(36)),
            payload
        );
        msg.style.color = '#3fb950';
        msg.textContent = '✅ Entrenamiento publicado.';
        showToast('✅ Info de entrenamiento publicada para los padres', 3000);
        setTimeout(() => {
            document.getElementById('setup-modal').style.display = 'none';
        }, 1400);
    } catch(e) {
        msg.style.color = '#ff5858';
        msg.textContent = '⚠️ Error: ' + e.message;
    }
}

window.openTrainingNotification = openTrainingNotification;
window.sendTrainingNotification = sendTrainingNotification;

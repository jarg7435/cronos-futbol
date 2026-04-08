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
                if (dat.type === 'convocatoria' || dat.type === 'entrenamiento' || dat.type === 'planificacion_semanal' || dat.type === 'informe_partido') {
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
                const sent   = n.createdAt
                    ? new Date(n.createdAt).toLocaleDateString('es-ES',
                        {day:'numeric', month:'long', year:'numeric'})
                    : '';

                const isConv   = (n.type === 'convocatoria');
                const isReport = (n.type === 'informe_partido');
                const isWeekly = (n.type === 'planificacion_semanal');
                const accent = isConv ? '#3fb950' : (isReport ? '#d2a8ff' : '#58a6ff');
                const icon   = isConv ? '📋' : (isReport ? '📊' : '📅');
                const title  = isConv ? 'Convocatoria' : (isReport ? 'Informe Rendimiento' : 'Entrenamiento');

                let inner = '';
                if (isReport) {
                    inner = `
                        <div style="font-size:0.86rem;font-weight:700;margin-bottom:0.4rem;">
                            ⚽ vs ${n.rival || 'Rival'}
                            <span style="float:right;color:#58a6ff;">${n.scoreHome}-${n.scoreAway} 🏁</span>
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.45rem;padding:0.7rem;background:rgba(210,168,255,0.06);border-radius:8px;border:1px solid rgba(210,168,255,0.15);">
                            <div style="font-size:0.77rem;">⏱️ Minutos: <strong>${n.minutesPlayed}</strong></div>
                            <div style="font-size:0.77rem;">⚽ Goles: <strong>${n.goals}</strong></div>
                            <div style="font-size:0.77rem;">🃏 Tarjetas: <strong>${n.cards}</strong></div>
                            <div style="font-size:0.77rem;">🚑 Estado: <strong>${n.injured ? 'Lesionado' : 'OK'}</strong></div>
                        </div>
                    `;
                } else if (isConv) {
                    inner = `
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
                    `;
                } else if (n.type === 'planificacion_semanal') {
                    const d = new Date(n.weekStartDate + 'T12:00:00');
                    const weekStr = d.toLocaleDateString('es-ES', { day:'numeric', month:'long' });
                    inner = `
                        <div style="font-size:0.85rem;font-weight:700;margin-bottom:0.6rem;color:#58a6ff;">
                            🗓️ Semana del ${weekStr}
                        </div>
                        <div style="overflow-x:auto;">
                            <table style="width:100%;font-size:0.78rem;border-collapse:collapse;border:1px solid rgba(255,255,255,0.08);">
                                <thead>
                                    <tr style="background:rgba(88,166,255,0.08);color:#7d8590;">
                                        <th style="padding:5px;border:1px solid rgba(255,255,255,0.08);text-align:left;">DÍA</th>
                                        <th style="padding:5px;border:1px solid rgba(255,255,255,0.08);text-align:left;">HORA</th>
                                        <th style="padding:5px;border:1px solid rgba(255,255,255,0.08);text-align:left;">NOTA</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${n.days.map(day => `
                                        <tr>
                                            <td style="padding:5px;border:1px solid rgba(255,255,255,0.05);font-weight:700;color:var(--primary);">${day.day}</td>
                                            <td style="padding:5px;border:1px solid rgba(255,255,255,0.05);">${day.time || '—'}</td>
                                            <td style="padding:5px;border:1px solid rgba(255,255,255,0.05);color:#7d8590;">
                                                ${day.note || (day.time ? '' : 'Descanso')}
                                                ${day.venue ? `<br><small>📍 ${day.venue}</small>` : ''}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                } else {
                    inner = `
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
                }

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
    const today = new Date();
    // Obtener el lunes de la semana actual
    const dayOfWeek = today.getDay(); // 0: domingo, 1: lunes...
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const startOfWeek = new Date(today.setDate(diff)).toISOString().substring(0,10);

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(98vw,680px);max-height:96vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0.8rem 1rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:0.5rem;flex-shrink:0;">
            <div>
                <h2 style="margin:0;font-size:1.1rem;line-height:1.2;">📅 Planificación Semanal</h2>
                <p style="margin:0;font-size:0.75rem;color:var(--text-muted);display:none;">
                    Informa a los padres del horario de toda la semana
                </p>
            </div>
            <button onclick="openConvocationModal()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.5rem;cursor:pointer;">✕</button>
        </div>

        <div style="overflow-y:auto;flex:1;padding-right:0.2rem;">

            <div style="margin-bottom:0.8rem;display:flex;align-items:center;gap:0.6rem;">
                <label style="font-size:0.8rem;color:var(--text-muted);margin:0;white-space:nowrap;">
                    🗓️ Semana del Lunes:
                </label>
                <input type="date" id="wp-start-date" value="${startOfWeek}"
                       style="flex:1;max-width:180px;padding:0.45rem;background:rgba(255,255,255,0.06);
                              border:1px solid var(--glass-border);border-radius:6px;color:white;font-size:0.8rem;">
            </div>

            <div style="background:rgba(0,0,0,0.15);border-radius:8px;padding:0.4rem;" id="wp-tbody">
                <div style="display:flex; flex-direction:column; gap:0.4rem;">
                ${['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'].map((day, i) => `
                <div class="wp-day-row" data-day="${day}" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.5rem 0.6rem;">
                    <div style="font-weight:700;color:var(--primary);margin-bottom:0.3rem;font-size:0.85rem;">${day}</div>
                    <div style="display:flex;flex-wrap:wrap;gap:0.3rem;">
                        <input type="time" class="wp-time" style="flex:1;min-width:70px;padding:0.4rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.8rem;">
                        <input type="text" class="wp-venue" placeholder="Lugar (ej: Ciudad Dep.)" style="flex:2;min-width:110px;padding:0.4rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.8rem;">
                        <input type="text" class="wp-note" placeholder="Nota o Actividad" style="flex:3;min-width:100%;padding:0.4rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.8rem;">
                    </div>
                </div>
                `).join('')}
                </div>
            </div>

        </div> <!-- fin zona scroll -->

            <!-- ── ENVIAR A ─────────────────────────────────── -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:10px;padding:0.9rem 1rem;margin:0.5rem 0;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;">
                    <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;">
                        📤 ENVIAR A
                    </div>
                    <div style="display:flex;gap:0.4rem;">
                        <button onclick="sharedSelectAll(true, 'tr')"
                            style="font-size:0.65rem;padding:0.2rem 0.6rem;background:rgba(88,166,255,0.1);
                                   border:1px solid rgba(88,166,255,0.3);border-radius:5px;
                                   color:var(--primary);cursor:pointer;">
                            ✓ Todos
                        </button>
                        <button onclick="sharedSelectAll(false, 'tr')"
                            style="font-size:0.65rem;padding:0.2rem 0.6rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.1);border-radius:5px;
                                   color:var(--text-muted);cursor:pointer;">
                            ✗ Ninguno
                        </button>
                        <button onclick="sharedSavePreselection('tr')"
                            style="font-size:0.65rem;padding:0.2rem 0.6rem;background:rgba(63,185,80,0.1);
                                   border:1px solid rgba(63,185,80,0.3);border-radius:5px;
                                   color:#3fb950;cursor:pointer;">
                            💾 Guardar
                        </button>
                    </div>
                </div>
                <div id="tr-recipients-list" style="display:flex;flex-direction:column;gap:0.4rem;max-height:180px;overflow-y:auto;padding-right:4px;">
                    ${sharedBuildRecipientsHTML(null, 'tr')}
                </div>
            </div>

        <div id="wp-msg" style="font-size:0.8rem;min-height:0;text-align:center;margin-top:0.4rem;"></div>

        <div style="display:flex;gap:0.5rem;margin-top:0.4rem;padding-top:0.6rem;border-top:1px solid var(--glass-border);flex-shrink:0;">
            <button onclick="openConvocationModal()"
                class="btn" style="flex:1;color:var(--text-muted);">
                Cancelar
            </button>
            <button onclick="sendWeeklyPlan()" class="btn primary" style="flex:1.5; background:rgba(88,166,255,0.15); border-color:rgba(88,166,255,0.4); color:var(--primary); font-weight:700;">
                📱 Envío Interno
            </button>
            <button onclick="sendWeeklyPlanWA()" class="btn" style="flex:1;background:rgba(63,185,80,0.12);color:#3fb950;font-weight:700;border:1px solid rgba(63,185,80,0.4);">
                📱 WhatsApp
            </button>
            <button onclick="sendWeeklyPlanEmail()" class="btn" style="flex:1;background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.4);color:var(--primary);font-weight:700;">
                📧 Email
            </button>
        </div>
    </div>`;
}
window.openTrainingNotification = openTrainingNotification;
window.openTrainingNotification = openTrainingNotification;

async function sendWeeklyPlan() {
    const recipients = sharedGetSelectedRecipients('tr');
    if (!recipients.length) {
        showToast('⚠️ Selecciona al menos un destinatario', 3000);
        return;
    }
    
    const me  = window._cronosCurrentUser;
    const fa  = window._cronos_auth;
    const startDate = document.getElementById('wp-start-date')?.value;
    const msg = document.getElementById('wp-msg');

    if (!startDate) {
        msg.style.color = '#ff5858';
        msg.textContent = '⚠️ Selecciona la fecha de inicio de la semana.';
        return;
    }

    msg.style.color = 'var(--primary)';
    msg.textContent = 'Publicando plan semanal…';

    const rows = document.querySelectorAll('.wp-day-row');
    const daysData = Array.from(rows).map((row) => {
        return {
            day:   row.dataset.day,
            time:  row.querySelector('.wp-time').value,
            venue: row.querySelector('.wp-venue').value.trim(),
            note:  row.querySelector('.wp-note').value.trim()
        };
    });

    try {
        const { setDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        
        // Iterar sobre recipients y enviar individualmente
        let count = 0;
        for (const r of recipients) {
            // Find user uid based on links or just use the system's global logic... wait,
            // the recipient array has id (like p_xxxx or staff uid). Actually, the parentUid might equal c.id if we use exact uids?
            // "ENVIAR A" is primarily built on `id: c.id` where c is from emailConfig.
            // In publishConvocationToApp, we see it matches `contact.uid`.
            // Let's send a generic club-wide one for now, but ALSO send to specific UIDs if they exist.
            // Actually, if we just want Envío Interno to go to selected parents in emailConfig, we must get their UIDs!
            // Para "TUTORES", c.uid lo obtenemos buscando en cronos_player_links (aunque sharedHTML sólo da 'id' desde emailConfig).
            // Lo más seguro y compatible es mantener el "Envío Global" interno para Planificación Semanal y que WhatsApp / Email usen los checkboxes.
            // O modificar el payload con "parentUid" explícito... veamos:
            await setDoc(
                doc(fa.db, 'cronos_notifications', `week_${r.id}_${Date.now().toString(36)}`),
                {
                    type:          'planificacion_semanal',
                    clubId:        me?.clubId || null,
                    coachEmail:    me?.email  || '',
                    coachUid:      me?.uid    || '',
                    parentUid:     r.id, 
                    weekStartDate: startDate,
                    days:          daysData,
                    createdAt:     new Date().toISOString(),
                }
            );
            count++;
        }

        msg.style.color = '#3fb950';
        msg.textContent = `✅ Planificación semanal enviada a ${count} contacto(s).`;
        showToast('✅ Planificación semanal publicada', 3000);
        
        setTimeout(() => { openConvocationModal(); }, 1500);

    } catch (e) {
        msg.style.color = '#ff5858';
        msg.textContent = '⚠️ Error: ' + e.message;
    }
}

function _buildWeeklyPlanText() {
    const startDate = document.getElementById('wp-start-date')?.value;
    if (!startDate) return '';

    const d = new Date(startDate + 'T12:00:00');
    const dateStr = d.toLocaleDateString('es-ES', { day:'numeric', month:'long' });
    
    let text = `📅 *PLANIFICACIÓN SEMANAL*\n📌 Semana del ${dateStr}\n\n`;
    const rows = document.querySelectorAll('.wp-day-row');

    rows.forEach((row, i) => {
        const time = row.querySelector('.wp-time').value;
        const venue = row.querySelector('.wp-venue').value.trim();
        const note = row.querySelector('.wp-note').value.trim();
        const dayName = row.dataset.day;

        if (time || venue || note) {
            text += `🔹 *${dayName}*\n`;
            if (time)  text += `   🕒 ${time}h\n`;
            if (venue) text += `   📍 ${venue}\n`;
            if (note)  text += `   📝 ${note}\n`;
            text += `\n`;
        } else {
            text += `🔹 *${dayName}*: _Descanso_\n\n`;
        }
    });

    text += `⚽ _Enviado desde Cronos Fútbol_`;
    return text;
}

function sendWeeklyPlanWA() {
    const recipients = sharedGetSelectedRecipients('tr').filter(r => r.phone);
    const msg = _buildWeeklyPlanText();
    if (!msg) {
        showToast('⚠️ Selecciona la fecha primero', 3000);
        return;
    }
    
    const encoded = encodeURIComponent(msg);

    if (!recipients.length) {
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
        showToast('📱 WhatsApp abierto — ningún contacto con teléfono seleccionado', 4000);
        return;
    }

    recipients.forEach((r, i) => {
        setTimeout(() => {
            window.open(`https://wa.me/${r.phone}?text=${encoded}`, '_blank');
        }, i * 800);
    });
    showToast(`📱 Enviando a ${recipients.length} contacto(s) por WhatsApp`, 4000);
}

function sendWeeklyPlanEmail() {
    const recipients = sharedGetSelectedRecipients('tr').filter(r => r.email);
    const msg = _buildWeeklyPlanText();
    if (!msg) {
        showToast('⚠️ Selecciona la fecha primero', 3000);
        return;
    }
    
    const d = new Date(document.getElementById('wp-start-date').value + 'T12:00:00');
    const dateStr = d.toLocaleDateString('es-ES', { day:'numeric', month:'long' });
    const subject = encodeURIComponent(`📅 Planificación Semanal — ${dateStr}`);
    const body = encodeURIComponent(msg.replace(/[*_]/g,''));

    if (!recipients.length) {
        window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
        showToast('📧 Email abierto — ningún contacto con email seleccionado', 3000);
        return;
    }

    const toList = recipients.map(r => r.email).join(',');
    window.open(`mailto:${toList}?subject=${subject}&body=${body}`, '_blank');
    showToast(`📧 Email abierto para ${recipients.length} contacto(s)`, 3000);
}

window.openTrainingNotification = openTrainingNotification;
window.sendWeeklyPlan          = sendWeeklyPlan;
window.sendWeeklyPlanWA         = sendWeeklyPlanWA;
window.sendWeeklyPlanEmail      = sendWeeklyPlanEmail;

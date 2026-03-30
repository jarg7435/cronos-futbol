// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Panel de Padres/Madres (role: parent)
// ════════════════════════════════════════════════════════════════════

async function openParentPanel() {
    const me = window._cronosCurrentUser;
    if (!me || me.role !== 'parent') return;

    const fa  = window._cronos_auth;
    const { db, doc, getDoc, collection, getDocs, query, where, orderBy, limit } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    // Ocultar la app principal
    document.getElementById('main-header').style.display  = 'none';
    document.getElementById('main-container').style.display = 'none';
    document.getElementById('auth-screen').style.display  = 'none';

    // Obtener datos del club si pertenece a uno
    let clubName = '';
    let clubId   = me.clubId || null;
    if (clubId) {
        try {
            const cs = await getDoc(doc(db, 'clubs', clubId));
            if (cs.exists()) clubName = cs.data().name || '';
        } catch(e) {}
    }

    // Crear o reutilizar el contenedor padre
    let panel = document.getElementById('parent-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'parent-panel';
        panel.style.cssText =
            'position:fixed;inset:0;background:#0a0e14;z-index:8000;' +
            'display:flex;flex-direction:column;overflow:hidden;';
        document.body.appendChild(panel);
    }
    panel.style.display = 'flex';

    panel.innerHTML = `
    ${SA_CSS}
    <style>
        .pp-tab { padding:0.5rem 1.1rem; background:var(--glass);
            border:1px solid var(--glass-border); border-radius:8px;
            color:var(--text-muted); font-size:0.85rem; cursor:pointer; transition:all 0.15s; }
        .pp-tab.active { background:rgba(88,166,255,0.15);
            border-color:rgba(88,166,255,0.5); color:#58a6ff; font-weight:700; }
        .pp-card { background:var(--glass); border:1px solid var(--glass-border);
            border-radius:12px; padding:1rem 1.2rem; margin-bottom:0.8rem; }
        .pp-badge { display:inline-block; padding:0.15rem 0.6rem; border-radius:4px;
            font-size:0.7rem; font-weight:700; }
        .pp-empty { text-align:center; color:var(--text-muted); padding:3rem 1rem;
            font-size:0.9rem; }
    </style>

    <!-- TOPBAR -->
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:0.9rem 1.4rem;border-bottom:1px solid var(--glass-border);
                background:rgba(10,14,20,0.95);flex-shrink:0;">
        <div>
            <div style="font-size:1.1rem;font-weight:700;">
                👨‍👩‍👧 Área de Familias
                ${clubName ? `<span style="font-size:0.78rem;color:var(--text-muted);font-weight:400;"> · ${clubName}</span>` : ''}
            </div>
            <div style="font-size:0.73rem;color:var(--text-muted);margin-top:0.1rem;">
                ${me.email}
            </div>
        </div>
        <button onclick="cerrarSesion()"
            style="background:none;border:1px solid rgba(255,88,88,0.3);
                   color:rgba(255,88,88,0.7);font-size:0.75rem;
                   padding:0.35rem 0.8rem;border-radius:6px;cursor:pointer;">
            ⏻ Salir
        </button>
    </div>

    <!-- TABS -->
    <div style="display:flex;gap:0.5rem;padding:0.7rem 1.4rem;
                border-bottom:1px solid var(--glass-border);flex-shrink:0;flex-wrap:wrap;">
        <button class="pp-tab active" onclick="ppTab('live')">🔴 En Vivo</button>
        <button class="pp-tab" onclick="ppTab('convocatorias')">📋 Convocatorias</button>
        <button class="pp-tab" onclick="ppTab('entrenamientos')">📅 Entrenamientos</button>
        <button class="pp-tab" onclick="ppTab('mensajes')">💬 Mensajes</button>
        <button class="pp-tab" onclick="ppTab('mijugador')">👤 Mi Jugador</button>
    </div>

    <!-- BODY -->
    <div id="pp-body" style="flex:1;overflow-y:auto;padding:1.2rem 1.4rem;">
        <p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando…</p>
    </div>`;

    // Tab switcher
    window.ppTab = (tab) => {
        panel.querySelectorAll('.pp-tab').forEach(b => b.classList.remove('active'));
        const tabs = ['live','convocatorias','entrenamientos','mensajes','mijugador'];
        const idx  = tabs.indexOf(tab);
        panel.querySelectorAll('.pp-tab')[idx]?.classList.add('active');
        ({
            live:           ppLive,
            convocatorias:  ppConvocatorias,
            entrenamientos: ppEntrenamientos,
            mensajes:       ppMensajes,
            mijugador:      ppMiJugador,
        })[tab]?.();
    };

    // ── TAB: EN VIVO ──────────────────────────────────────────────
    window.ppLive = async () => {
        const body = document.getElementById('pp-body');
        body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Buscando partidos…</p>';
        try {
            const q    = clubId
                ? query(collection(db,'live_matches'), where('clubId','==',clubId), where('status','==','active'))
                : query(collection(db,'live_matches'), where('status','==','active'));
            const snap = await getDocs(q);
            const matches = [];
            snap.forEach(d => matches.push({ _id: d.id, ...d.data() }));

            if (!matches.length) {
                body.innerHTML = `<div class="pp-empty">
                    🔴 No hay ningún partido en vivo ahora mismo.<br>
                    <span style="font-size:0.8rem;">Vuelve cuando empiece el partido.</span>
                </div>`;
                return;
            }

            body.innerHTML = matches.map(m => {
                const liveUrl = location.origin + location.pathname.replace('index.html','') +
                    `live.html?match=${m._id}`;
                const elapsed = formatTime((m.timeH1||0) + (m.timeH2||0));
                return `
                <div class="pp-card" style="border-color:rgba(255,88,88,0.4);">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
                        <div>
                            <div style="font-size:1rem;font-weight:700;margin-bottom:0.3rem;">
                                🔴 <span style="animation:livePulse 1.5s infinite;">EN VIVO</span>
                            </div>
                            <div style="font-size:1.3rem;font-weight:700;margin:0.3rem 0;">
                                <span style="color:${m.homeTeam?.color||'#58a6ff'}">
                                    ${m.homeTeam?.name||'Local'}
                                </span>
                                <span style="color:white;margin:0 0.5rem;">
                                    ${m.homeTeam?.score||0} - ${m.awayTeam?.score||0}
                                </span>
                                <span style="color:${m.awayTeam?.color||'#ff5858'}">
                                    ${m.awayTeam?.name||'Visitante'}
                                </span>
                            </div>
                            <div style="font-size:0.78rem;color:var(--text-muted);">
                                ⏱️ ${elapsed} · ${m.coachEmail||''}
                            </div>
                        </div>
                        <a href="${liveUrl}" target="_blank"
                            style="display:inline-block;padding:0.65rem 1.2rem;
                                   background:#ff5858;border-radius:8px;color:#fff;
                                   font-weight:700;font-size:0.88rem;text-decoration:none;
                                   white-space:nowrap;">
                            👁️ Ver partido
                        </a>
                    </div>
                </div>`;
            }).join('');
        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ Error al cargar. Inténtalo de nuevo.</div>`;
        }
    };

    // ── TAB: CONVOCATORIAS ────────────────────────────────────────
    window.ppConvocatorias = async () => {
        const body = document.getElementById('pp-body');
        body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando convocatorias…</p>';
        try {
            const constraints = [where('type','==','convocatoria')];
            if (clubId) constraints.push(where('clubId','==',clubId));
            const q    = query(collection(db,'cronos_notifications'), ...constraints);
            const snap = await getDocs(q);
            const notifs = [];
            snap.forEach(d => notifs.push({ _id: d.id, ...d.data() }));
            notifs.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

            if (!notifs.length) {
                body.innerHTML = `<div class="pp-empty">
                    📋 No hay convocatorias aún.<br>
                    <span style="font-size:0.8rem;">Aquí verás las convocatorias cuando el entrenador las envíe.</span>
                </div>`;
                return;
            }

            body.innerHTML = notifs.map(n => {
                const date = n.createdAt
                    ? new Date(n.createdAt).toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})
                    : '—';
                return `
                <div class="pp-card">
                    <div style="display:flex;justify-content:space-between;align-items:center;
                                margin-bottom:0.6rem;flex-wrap:wrap;gap:0.3rem;">
                        <div style="font-weight:700;font-size:0.95rem;">📋 Convocatoria</div>
                        <span style="font-size:0.72rem;color:var(--text-muted);">${date}</span>
                    </div>
                    ${n.matchDate ? `<div style="font-size:0.82rem;margin-bottom:0.3rem;">
                        📅 <strong>${n.matchDate}</strong>
                        ${n.rival ? ` · 🆚 vs <strong>${n.rival}</strong>` : ''}
                    </div>` : ''}
                    ${n.venue ? `<div style="font-size:0.82rem;margin-bottom:0.3rem;">🏟️ ${n.venue}</div>` : ''}
                    ${n.meettime ? `<div style="font-size:0.82rem;margin-bottom:0.3rem;">🕐 Presentación: <strong>${n.meettime}h</strong></div>` : ''}
                    ${n.kickoff ? `<div style="font-size:0.82rem;margin-bottom:0.3rem;">⚽ Inicio: <strong>${n.kickoff}h</strong></div>` : ''}
                    ${n.players?.length ? `
                    <div style="margin-top:0.6rem;padding:0.6rem 0.8rem;
                                background:rgba(63,185,80,0.06);border-radius:8px;
                                border:1px solid rgba(63,185,80,0.2);">
                        <div style="font-size:0.73rem;font-weight:700;color:#3fb950;margin-bottom:0.4rem;">
                            👥 CONVOCADOS (${n.players.length})
                        </div>
                        <div style="font-size:0.82rem;line-height:1.8;">
                            ${n.players.map((p,i)=>`${i+1}. ${p}`).join('<br>')}
                        </div>
                    </div>` : ''}
                    ${n.extra ? `<div style="font-size:0.82rem;margin-top:0.6rem;
                                             color:var(--text-muted);font-style:italic;">
                        💬 ${n.extra}
                    </div>` : ''}
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.5rem;">
                        Enviado por: ${n.coachEmail||'entrenador'}
                    </div>
                </div>`;
            }).join('');
        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ Error al cargar. Inténtalo de nuevo.</div>`;
        }
    };

    // ── TAB: ENTRENAMIENTOS ───────────────────────────────────────
    window.ppEntrenamientos = async () => {
        const body = document.getElementById('pp-body');
        body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando entrenamientos…</p>';
        try {
            const constraints = [where('type','==','entrenamiento')];
            if (clubId) constraints.push(where('clubId','==',clubId));
            const q    = query(collection(db,'cronos_notifications'), ...constraints);
            const snap = await getDocs(q);
            const notifs = [];
            snap.forEach(d => notifs.push({ _id: d.id, ...d.data() }));
            notifs.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

            if (!notifs.length) {
                body.innerHTML = `<div class="pp-empty">
                    ⚽ No hay información de entrenamientos aún.<br>
                    <span style="font-size:0.8rem;">Aquí verás las fechas y detalles cuando el entrenador los publique.</span>
                </div>`;
                return;
            }

            body.innerHTML = notifs.map(n => {
                const date = n.createdAt
                    ? new Date(n.createdAt).toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})
                    : '—';
                return `
                <div class="pp-card">
                    <div style="display:flex;justify-content:space-between;align-items:center;
                                margin-bottom:0.6rem;flex-wrap:wrap;gap:0.3rem;">
                        <div style="font-weight:700;font-size:0.95rem;">⚽ Entrenamiento</div>
                        <span style="font-size:0.72rem;color:var(--text-muted);">${date}</span>
                    </div>
                    ${n.trainDate ? `<div style="font-size:0.82rem;margin-bottom:0.3rem;">
                        📅 <strong>${n.trainDate}</strong>
                        ${n.trainTime ? ` · 🕐 <strong>${n.trainTime}h</strong>` : ''}
                    </div>` : ''}
                    ${n.venue ? `<div style="font-size:0.82rem;margin-bottom:0.3rem;">📍 ${n.venue}</div>` : ''}
                    ${n.content ? `
                    <div style="font-size:0.85rem;line-height:1.6;margin-top:0.5rem;
                                padding:0.6rem 0.8rem;background:rgba(88,166,255,0.06);
                                border-radius:8px;border:1px solid rgba(88,166,255,0.15);">
                        ${n.content.replace(/\n/g,'<br>')}
                    </div>` : ''}
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.5rem;">
                        Enviado por: ${n.coachEmail||'entrenador'}
                    </div>
                </div>`;
            }).join('');
        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ Error al cargar. Inténtalo de nuevo.</div>`;
        }
    };

    // ── TAB: 💬 MENSAJES ─────────────────────────────────────────────
    window.ppMensajes = async () => {
        const body = document.getElementById('pp-body');
        body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando mensajes…</p>';
        try {
            const { db: fdb, collection, getDocs, query, where, doc, updateDoc } =
                await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            // Buscar hilos donde este padre es participante
            const snap = await getDocs(query(
                collection(fdb, 'cronos_messages'),
                where('parentUid', '==', me.uid)
            ));
            const threads = [];
            snap.forEach(d => threads.push({ _id: d.id, ...d.data() }));

            if (!threads.length) {
                body.innerHTML = `<div class="pp-empty">
                    💬 Sin mensajes aún.<br>
                    <span style="font-size:0.8rem;">Tu entrenador te enviará mensajes aquí.</span>
                </div>`;
                return;
            }

            // Mostrar hilo más reciente directamente
            const thread = threads.sort((a,b)=>(b.lastMessageAt||'').localeCompare(a.lastMessageAt||''))[0];

            // Renderizar chat
            const messages = thread.messages || [];
            const coachEmail = thread.coachEmail || 'Entrenador';

            body.innerHTML = `
            <div style="display:flex;flex-direction:column;height:100%;">
                <div style="font-size:0.78rem;color:var(--text-muted);
                            margin-bottom:0.7rem;padding:0.5rem 0.7rem;
                            background:var(--glass);border-radius:8px;
                            border:1px solid var(--glass-border);">
                    💬 Hilo con tu entrenador: <strong>${coachEmail}</strong>
                </div>

                <!-- Mensajes -->
                <div id="pp-messages-list"
                     style="flex:1;display:flex;flex-direction:column;gap:0.5rem;
                            overflow-y:auto;max-height:calc(100vh - 320px);padding-bottom:0.5rem;">
                    ${messages.map(m => {
                        const isMine = m.sender === 'parent';
                        const isReport = m.type === 'report';
                        const time = m.timestamp
                            ? new Date(m.timestamp).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})
                            : '';
                        const date = m.timestamp
                            ? new Date(m.timestamp).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
                            : '';
                        return `
                        <div style="display:flex;justify-content:${isMine?'flex-end':'flex-start'};padding:0 0.3rem;">
                            <div style="max-width:80%;
                                        background:${isReport?'rgba(63,185,80,0.12)':isMine?'rgba(210,168,255,0.2)':'rgba(255,255,255,0.07)'};
                                        border:1px solid ${isReport?'rgba(63,185,80,0.3)':isMine?'rgba(210,168,255,0.3)':'rgba(255,255,255,0.1)'};
                                        border-radius:12px;padding:0.5rem 0.85rem;">
                                <div style="font-size:0.84rem;line-height:1.55;white-space:pre-wrap;">
                                    ${m.text.replace(/\*(.*?)\*/g,'<strong>$1</strong>')}
                                </div>
                                <div style="font-size:0.64rem;color:var(--text-muted);
                                            text-align:right;margin-top:0.2rem;">
                                    ${date} ${time} · ${isMine ? 'Tú' : 'Entrenador'}
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>

                <!-- Input respuesta -->
                <div style="margin-top:0.8rem;border-top:1px solid var(--glass-border);padding-top:0.8rem;">
                    <div style="display:flex;gap:0.5rem;align-items:flex-end;">
                        <textarea id="parent-msg-input"
                            placeholder="Responder al entrenador… (Enter envía)"
                            rows="2"
                            style="flex:1;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.06);
                                   border:1px solid var(--glass-border);border-radius:8px;
                                   color:white;font-size:0.88rem;resize:none;box-sizing:border-box;"
                            onkeydown="if(event.key==='Enter'&&!event.shiftKey){
                                event.preventDefault();
                                ppSendParentMessage('${thread._id}','${thread.coachUid}');
                            }">
                        </textarea>
                        <button onclick="ppSendParentMessage('${thread._id}','${thread.coachUid}')"
                            class="btn primary" style="padding:0.6rem 1rem;flex-shrink:0;">
                            Enviar ›
                        </button>
                    </div>
                </div>
            </div>`;

            // Scroll al final
            const ml = document.getElementById('pp-messages-list');
            if (ml) ml.scrollTop = ml.scrollHeight;

            // Marcar como leídos
            try {
                await updateDoc(doc(fdb, 'cronos_messages', thread._id), { unreadByParent: 0 });
            } catch(e) {}

        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ Error: ${e.message}</div>`;
        }
    };

    // Enviar mensaje del padre al entrenador
    window.ppSendParentMessage = async (threadId, coachUid) => {
        const input = document.getElementById('parent-msg-input');
        const text  = (input?.value || '').trim();
        if (!text) return;

        const { db: fdb, doc, getDoc, updateDoc, setDoc, arrayUnion } =
            await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const newMsg = { sender: 'parent', text, timestamp: new Date().toISOString() };
        const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

        try {
            const snap = await getDoc(doc(fdb, 'cronos_messages', threadId));
            if (snap.exists()) {
                await updateDoc(doc(fdb, 'cronos_messages', threadId), {
                    messages:      arrayUnion(newMsg),
                    lastMessage:   preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByCoach: (snap.data().unreadByCoach || 0) + 1,
                });
            }
            if (input) input.value = '';
            ppMensajes(); // Recargar
        } catch(e) {
            showToast('⚠️ Error al enviar: ' + e.message, 3000);
        }
    };

    // ── TAB: 👤 MI JUGADOR ───────────────────────────────────────────
    window.ppMiJugador = async () => {
        const body = document.getElementById('pp-body');
        body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando datos del jugador…</p>';
        try {
            const { db: fdb, collection, getDocs, query, where } =
                await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            // Buscar el vínculo jugador-padre
            const linkSnap = await getDocs(query(
                collection(fdb, 'cronos_player_links'),
                where('parentUid', '==', me.uid)
            ));
            const links = [];
            linkSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

            if (!links.length) {
                body.innerHTML = `<div class="pp-empty">
                    👤 Tu cuenta no está vinculada a ningún jugador aún.<br>
                    <span style="font-size:0.8rem;">Contacta con el administrador del club.</span>
                </div>`;
                return;
            }

            const link = links[0];
            const playerAlias = link.playerAlias || link.playerName || `Jugador #${link.playerNumber}`;

            // Buscar informes de partidos de este jugador
            const reportsSnap = await getDocs(query(
                collection(fdb, 'cronos_player_reports'),
                where('parentUid', '==', me.uid)
            ));
            const reports = [];
            reportsSnap.forEach(d => reports.push({ _id: d.id, ...d.data() }));
            reports.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

            // Calcular totales
            const totalGoals   = reports.reduce((s,r) => s + (r.goals || 0), 0);
            const totalYellow  = reports.filter(r => r.cards === 'amarilla').length;
            const totalRed     = reports.filter(r => r.cards === 'roja').length;
            const totalInjured = reports.filter(r => r.injured).length;
            const totalMatches = reports.length;

            // Sumar minutos
            const parseMinutes = (str) => {
                if (!str) return 0;
                const parts = str.split(':');
                return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
            };
            const totalSecondsRaw = reports.reduce((s,r) => s + parseMinutes(r.minutesPlayed) * 60, 0);
            const totalMin = Math.floor(totalSecondsRaw / 60);
            const totalHours = Math.floor(totalMin / 60);
            const remMin = totalMin % 60;
            const totalTimeStr = totalHours > 0 ? `${totalHours}h ${remMin}m` : `${totalMin} min`;

            body.innerHTML = `
            <!-- Cabecera jugador -->
            <div class="pp-card" style="border-color:rgba(88,166,255,0.4);
                                         background:rgba(88,166,255,0.05);margin-bottom:1rem;">
                <div style="font-size:1.1rem;font-weight:700;margin-bottom:0.2rem;">
                    👤 ${playerAlias}
                    <span style="color:var(--primary);"> #${link.playerNumber}</span>
                </div>
                <div style="font-size:0.75rem;color:var(--text-muted);">
                    Equipo: ${link.teamName || link.clubId || '—'}
                </div>
            </div>

            <!-- Estadísticas acumuladas -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));
                        gap:0.6rem;margin-bottom:1.2rem;">
                ${[
                    ['⚽', 'Goles', totalGoals, '#3fb950'],
                    ['⏱️', 'Minutos', totalTimeStr, '#58a6ff'],
                    ['🟨', 'Amarillas', totalYellow, '#f0883e'],
                    ['🟥', 'Rojas', totalRed, '#ff5858'],
                    ['🏃', 'Partidos', totalMatches, '#d2a8ff'],
                    ['🚑', 'Lesiones', totalInjured, '#ffa500'],
                ].map(([icon, label, val, color]) => `
                    <div style="background:var(--glass);border:1px solid var(--glass-border);
                                border-radius:10px;padding:0.8rem;text-align:center;">
                        <div style="font-size:1.5rem;">${icon}</div>
                        <div style="font-size:1.2rem;font-weight:700;color:${color};line-height:1.2;">
                            ${val}
                        </div>
                        <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.2rem;">
                            ${label}
                        </div>
                    </div>`).join('')}
            </div>

            <!-- Historial de partidos -->
            ${reports.length ? `
            <div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);
                        margin-bottom:0.6rem;letter-spacing:0.5px;">
                📋 HISTORIAL DE PARTIDOS (${reports.length})
            </div>
            ${reports.map(r => `
            <div class="pp-card" style="margin-bottom:0.6rem;">
                <div style="display:flex;justify-content:space-between;
                            align-items:flex-start;flex-wrap:wrap;gap:0.3rem;">
                    <div>
                        <div style="font-weight:700;font-size:0.88rem;margin-bottom:0.2rem;">
                            🆚 vs ${r.rival || '—'}
                        </div>
                        <div style="font-size:0.75rem;color:var(--text-muted);">
                            📅 ${r.matchDate} · ${r.scoreHome}-${r.scoreAway}
                        </div>
                    </div>
                    <div style="text-align:right;font-size:0.8rem;">
                        <div>⏱️ ${r.minutesPlayed || '—'}</div>
                        <div>⚽ ${r.goals || 0} goles</div>
                        ${r.cards === 'amarilla' ? '<div>🟨 Amarilla</div>' : ''}
                        ${r.cards === 'roja' ? '<div>🟥 Roja</div>' : ''}
                        ${r.injured ? '<div>🚑 Lesionado</div>' : ''}
                    </div>
                </div>
            </div>`).join('')}` : `
            <div class="pp-empty" style="font-size:0.85rem;">
                📊 Aún no hay informes de partido para este jugador.
            </div>`}`;

        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ Error: ${e.message}</div>`;
        }
    };

    // Añadir animación live pulse si no existe
    if (!document.getElementById('live-pulse-style')) {
        const s = document.createElement('style');
        s.id = 'live-pulse-style';
        s.textContent = '@keyframes livePulse{0%,100%{opacity:1}50%{opacity:0.5}}';
        document.head.appendChild(s);
    }

    // Cargar pestaña inicial
    ppLive();
}

window.openParentPanel = openParentPanel;


// ════════════════════════════════════════════════════════════════════
//  ENVIAR INFO DE ENTRENAMIENTO (entrenador → padres via Firestore)
// ════════════════════════════════════════════════════════════════════
function openTrainingNotification() {
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,560px);max-height:92vh;
         display:flex;flex-direction:column;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:0.9rem;flex-shrink:0;">
            <h2 style="margin:0;font-size:1.05rem;">⚽ Enviar Info de Entrenamiento</h2>
            <button onclick="document.getElementById('setup-modal').style.display='none'"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>
        <div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:0.8rem;">
            <div>
                <label style="font-size:0.73rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">
                    📅 Fecha del entrenamiento *
                </label>
                <input type="date" id="tr-date" class="conv-input"
                    value="${new Date().toISOString().substring(0,10)}"
                    style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>
            <div>
                <label style="font-size:0.73rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">
                    🕐 Hora de inicio
                </label>
                <input type="time" id="tr-time"
                    style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>
            <div>
                <label style="font-size:0.73rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">
                    📍 Lugar
                </label>
                <input type="text" id="tr-venue" placeholder="Ciudad Deportiva, Campo 3…"
                    style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>
            <div>
                <label style="font-size:0.73rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">
                    💬 Información adicional
                </label>
                <textarea id="tr-content" rows="5"
                    placeholder="Descripción del entrenamiento, material necesario, indicaciones especiales…"
                    style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;resize:vertical;"></textarea>
            </div>
            <div style="background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.2);
                        border-radius:8px;padding:0.65rem 0.9rem;font-size:0.78rem;color:var(--text-muted);">
                💡 Esta información quedará guardada y los padres podrán verla desde su panel.
            </div>
            <div id="tr-msg" style="font-size:0.8rem;min-height:1rem;text-align:center;"></div>
        </div>
        <div style="display:flex;gap:0.6rem;margin-top:0.9rem;flex-shrink:0;">
            <button onclick="document.getElementById('setup-modal').style.display='none'"
                class="btn" style="flex:1;color:var(--text-muted);">Cancelar</button>
            <button onclick="sendTrainingNotification()" class="btn primary" style="flex:2;">
                📤 Publicar entrenamiento
            </button>
        </div>
    </div>`;
}

async function sendTrainingNotification() {
    const me   = window._cronosCurrentUser;
    const date = document.getElementById('tr-date')?.value;
    const msg  = document.getElementById('tr-msg');
    if (!date) { msg.style.color='#ff5858'; msg.textContent='⚠️ La fecha es obligatoria.'; return; }

    msg.style.color='var(--primary)'; msg.textContent='Publicando…';

    const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('es-ES',{
        weekday:'long', day:'numeric', month:'long'});

    const payload = {
        type:        'entrenamiento',
        clubId:      me?.clubId || null,
        coachEmail:  me?.email  || '',
        coachUid:    me?.uid    || '',
        trainDate:   dateStr,
        trainTime:   document.getElementById('tr-time')?.value || '',
        venue:       document.getElementById('tr-venue')?.value.trim() || '',
        content:     document.getElementById('tr-content')?.value.trim() || '',
        createdAt:   new Date().toISOString(),
    };

    try {
        const fa = window._cronos_auth;
        const { setDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const id = 'train_' + Date.now().toString(36);
        await setDoc(doc(fa.db, 'cronos_notifications', id), payload);
        msg.style.color = '#3fb950';
        msg.textContent = '✅ Entrenamiento publicado. Los padres ya pueden verlo.';
        showToast('✅ Info de entrenamiento publicada', 3000);
        setTimeout(() => { document.getElementById('setup-modal').style.display='none'; }, 1500);
    } catch(e) {
        msg.style.color = '#ff5858';
        msg.textContent = '⚠️ Error: ' + e.message;
    }
}

window.openTrainingNotification  = openTrainingNotification;
window.sendTrainingNotification  = sendTrainingNotification;

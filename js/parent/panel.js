// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Panel de Padres/Madres v3
//  3 pestañas: 🔴 En Vivo · 📬 Mensajes · 👤 Mi Jugador
// ════════════════════════════════════════════════════════════════════

async function openParentPanel() {
    const me = window._cronosCurrentUser;
    const activeRole = me?._activeRole || me?.role;
    const isSA = me?.role === 'superadmin' || me?.role === 'admin';

    if (!me || (!isSA && activeRole !== 'parent')) {
        showToast("⛔ Acceso restringido a padres/tutores", 3000);
        return;
    }

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
                    font-weight:400;margin-left:0.4rem;">· ${typeof escapeHtml==='function'?escapeHtml(clubName):clubName}</span>` : ''}
            </div>
            <div style="font-size:0.71rem;color:#7d8590;margin-top:0.12rem;">
                ${typeof escapeHtml==='function'?escapeHtml(me.email||''):me.email||''}
            </div>
        </div>
        <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
            ${typeof _cronosDevRoleBtn==='function'?_cronosDevRoleBtn("typeof showRoleSelector==='function'?showRoleSelector():typeof showRoleSelection==='function'&&showRoleSelection()","padding:0.35rem 0.8rem;border-radius:6px;font-size:0.74rem;"):''}
            <button onclick="typeof logoutUser==='function'?logoutUser():typeof cerrarSesion==='function'&&cerrarSesion()"
                style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);
                       color:#ff5858;padding:0.35rem 0.8rem;border-radius:6px;cursor:pointer;
                       font-size:0.74rem;font-weight:700;">⏻ Salir</button>
        </div>
    </div>

    <!-- TABS -->
    <div style="display:flex;gap:0.4rem;padding:0.7rem 1.2rem;
                border-bottom:1px solid rgba(255,255,255,0.08);
                flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <button class="pp-tab active" onclick="ppTab('conv',this)" title="Convocatorias">📋 Convoc.</button>
        <button class="pp-tab"        onclick="ppTab('train',this)" title="Entrenamientos">📅 Entreno.</button>
        <button class="pp-tab"        onclick="ppTab('player',this)" title="Informes del jugador">📊 Informes</button>
        <button class="pp-tab"        onclick="ppTab('chat',this)" title="Chat con el entrenador">💬 Chat</button>
        <button class="pp-tab"        onclick="ppTab('live',this)" title="Partidos en vivo">🔴 En Vivo</button>
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
        ({
            conv:   () => ppNotifsByType('convocatoria'),
            train:  () => ppNotifsByType('planificacion_semanal'),
            player: ppPlayer,
            chat:   ppChat,
            live:   ppLive,
        })[tab]?.();
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
                                <span style="color:${typeof escapeAttr==='function'?escapeAttr(m.homeTeam?.color||'#58a6ff'):m.homeTeam?.color||'#58a6ff'};">
                                    ${typeof escapeHtml==='function'?escapeHtml(m.homeTeam?.name||'Local'):(m.homeTeam?.name||'Local')}
                                </span>
                                <span style="color:white;margin:0 0.5rem;">
                                    ${typeof escapeHtml==='function'?escapeHtml(m.homeTeam?.score||0):m.homeTeam?.score||0} - ${typeof escapeHtml==='function'?escapeHtml(m.awayTeam?.score||0):m.awayTeam?.score||0}
                                </span>
                                <span style="color:${typeof escapeAttr==='function'?escapeAttr(m.awayTeam?.color||'#ff5858'):m.awayTeam?.color||'#ff5858'};">
                                    ${typeof escapeHtml==='function'?escapeHtml(m.awayTeam?.name||'Visitante'):(m.awayTeam?.name||'Visitante')}
                                </span>
                            </div>
                            ${elapsed ? `<div style="font-size:0.76rem;color:#7d8590;">
                                ⏱️ ${elapsed}
                            </div>` : ''}
                        </div>
                        <a href="${typeof escapeAttr==='function'?escapeAttr(liveUrl):liveUrl}" target="_blank"
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
            body.innerHTML = `<div class="pp-empty">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
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

            // SPRINT 4: Usar NotificationDismiss para check de descarte
            let dismissed = [];
            if (window.NotificationDismiss) {
                dismissed = NotificationDismiss.getDismissedList();
            } else {
                dismissed = JSON.parse(localStorage.getItem('cronos_dismissed_notifs') || '[]');
            }
            
            const items = [];
            snap.forEach(d => {
                const dat = d.data();
                if (dismissed.includes(d.id)) return; // Saltar borrados
                // También saltar si está en dismissedBy de Firestore
                if (dat.dismissedBy && dat.dismissedBy.includes(me?.uid || '')) return;

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
                            ⚽ vs ${typeof escapeHtml==='function'?escapeHtml(n.rival||'Rival'):n.rival||'Rival'}
                            <span style="float:right;color:#58a6ff;">${typeof escapeHtml==='function'?escapeHtml(n.scoreHome):n.scoreHome}-${typeof escapeHtml==='function'?escapeHtml(n.scoreAway):n.scoreAway} 🏁</span>
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.45rem;padding:0.7rem;background:rgba(210,168,255,0.06);border-radius:8px;border:1px solid rgba(210,168,255,0.15);">
                            <div style="font-size:0.77rem;">⏱️ Minutos: <strong>${typeof escapeHtml==='function'?escapeHtml(n.minutesPlayed):n.minutesPlayed}</strong></div>
                            <div style="font-size:0.77rem;">⚽ Goles: <strong>${typeof escapeHtml==='function'?escapeHtml(n.goals):n.goals}</strong></div>
                            <div style="font-size:0.77rem;">🃏 Tarjetas: <strong>${typeof escapeHtml==='function'?escapeHtml(n.cards):n.cards}</strong></div>
                            <div style="font-size:0.77rem;">🚑 Estado: <strong>${n.injured ? 'Lesionado' : 'OK'}</strong></div>
                        </div>
                    `;
                } else if (isConv) {
                    inner = `
                        ${n.matchDate ? `<div style="font-size:0.83rem;margin-bottom:0.25rem;">
                            📅 <strong>${typeof escapeHtml==='function'?escapeHtml(n.matchDate):n.matchDate}</strong>
                            ${n.rival ? ` · 🆚 vs <strong>${typeof escapeHtml==='function'?escapeHtml(n.rival):n.rival}</strong>` : ''}
                        </div>` : ''}
                        ${n.venue    ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">🏟️ ${typeof escapeHtml==='function'?escapeHtml(n.venue):n.venue}</div>` : ''}
                        ${n.meettime ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">🕐 Presentación: <strong>${typeof escapeHtml==='function'?escapeHtml(n.meettime):n.meettime}h</strong></div>` : ''}
                        ${n.kickoff  ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">⚽ Inicio: <strong>${typeof escapeHtml==='function'?escapeHtml(n.kickoff):n.kickoff}h</strong></div>` : ''}
                        ${n.players?.length ? `
                        <div style="margin-top:0.5rem;padding:0.55rem 0.8rem;
                                    background:rgba(63,185,80,0.07);border-radius:8px;
                                    border:1px solid rgba(63,185,80,0.2);">
                            <div style="font-size:0.71rem;font-weight:700;
                                        color:#3fb950;margin-bottom:0.35rem;">
                                👥 CONVOCADOS (${n.players.length})
                            </div>
                            <div style="font-size:0.8rem;line-height:1.8;">
                                ${n.players.map((p,i)=>`${i+1}. ${typeof escapeHtml==='function'?escapeHtml(p):p}`).join('<br>')}
                            </div>
                        </div>` : ''}
                        ${n.extra ? `<div style="font-size:0.8rem;margin-top:0.5rem;
                            color:#7d8590;font-style:italic;">💬 ${typeof escapeHtml==='function'?escapeHtml(n.extra):n.extra}</div>` : ''}
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
                                            <td style="padding:5px;border:1px solid rgba(255,255,255,0.05);font-weight:700;color:var(--primary);">${typeof escapeHtml==='function'?escapeHtml(day.day):day.day}</td>
                                            <td style="padding:5px;border:1px solid rgba(255,255,255,0.05);">${typeof escapeHtml==='function'?escapeHtml(day.time||'—'):day.time||'—'}</td>
                                            <td style="padding:5px;border:1px solid rgba(255,255,255,0.05);color:#7d8590;">
                                                ${typeof escapeHtml==='function'?escapeHtml(day.note||(day.time?'':'Descanso')):day.note||(day.time?'':'Descanso')}
                                                ${day.venue ? `<br><small>📍 ${typeof escapeHtml==='function'?escapeHtml(day.venue):day.venue}</small>` : ''}
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
                            📅 <strong>${typeof escapeHtml==='function'?escapeHtml(n.trainDate):n.trainDate}</strong>
                            ${n.trainTime ? ` · 🕐 <strong>${typeof escapeHtml==='function'?escapeHtml(n.trainTime):n.trainTime}h</strong>` : ''}
                        </div>` : ''}
                        ${n.venue ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">📍 ${typeof escapeHtml==='function'?escapeHtml(n.venue):n.venue}</div>` : ''}
                        ${n.content ? `
                        <div style="font-size:0.82rem;line-height:1.6;margin-top:0.5rem;
                                    padding:0.55rem 0.8rem;
                                    background:rgba(88,166,255,0.06);
                                    border-radius:8px;border:1px solid rgba(88,166,255,0.15);">
                            ${(typeof escapeHtml==='function'?escapeHtml(n.content):n.content).replace(/\n/g,'<br>')}
                        </div>` : ''}
                    `;
                }

                return `
                <div class="pp-card" style="border-left:3px solid ${accent}; position:relative;">
                    <button onclick="dismissNotification('${typeof escapeAttr==='function'?escapeAttr(n._id):n._id}')" 
                        style="position:absolute; top:1rem; right:1rem; background:rgba(255,255,255,0.05); 
                               border:1px solid rgba(255,255,255,0.1); color:var(--text-muted); 
                               width:28px; height:28px; border-radius:50%; display:flex; 
                               align-items:center; justify-content:center; cursor:pointer; 
                               font-size:0.85rem; transition:all 0.2s; z-index:10;" 
                        onmouseover="this.style.background='rgba(231,76,60,0.2)';this.style.color='#e74c3c';this.style.borderColor='rgba(231,76,60,0.4)';"
                        onmouseout="this.style.background='rgba(255,255,255,0.05)';this.style.color='var(--text-muted)';this.style.borderColor='rgba(255,255,255,0.1)';"
                        title="Quitar de mi vista">
                        ✕
                    </button>
                    <div style="display:flex;justify-content:space-between;
                                margin-bottom:0.55rem;flex-wrap:wrap;gap:0.3rem; padding-right:1.5rem;">
                        <span style="font-weight:700;color:${accent};">${icon} ${title}</span>
                        <span style="font-size:0.71rem;color:#7d8590;">${sent}</span>
                    </div>
                    ${inner}
                </div>`;
            }).join('');

        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
        }
    };

    window.dismissNotification = (id) => {
        if (!confirm('¿Deseas quitar este mensaje de tu bandeja de entrada?')) return;
        
        // SPRINT 4: Usar NotificationDismiss para sincronizar en Firestore
        if (window.NotificationDismiss && window._cronosCurrentUser?.uid) {
            NotificationDismiss.dismiss(id);
        } else {
            // Fallback: guardar solo en localStorage
            const dismissed = JSON.parse(localStorage.getItem('cronos_dismissed_notifs') || '[]');
            if (!dismissed.includes(id)) dismissed.push(id);
            localStorage.setItem('cronos_dismissed_notifs', JSON.stringify(dismissed));
        }
        
        // Refrescar la pestaña de mensajes inmediatamente
        if (typeof window.ppMsgs === 'function') {
            window.ppMsgs();
        }
        showToast('🗑️ Mensaje ocultado', 2000);
    };

    // ══════════════════════════════════════════════════════════════
    // TAB 3 · MI JUGADOR — estadísticas + historial por partido
    // ══════════════════════════════════════════════════════════════
    window.ppPlayer = async () => {
        const body = document.getElementById('pp-body');
        try {
            const { collection, getDocs, query, where,
                    doc, getDoc, setDoc, updateDoc } = await import(
                'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            // Vínculo padre → jugador
            const linkSnap = await getDocs(query(
                collection(fa.db, 'cronos_player_links'),
                where('parentUid', '==', me.uid)
            ));
            const links = [];
            linkSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

            // ── AUTO-VINCULACIÓN ──────────────────────────────────────────
            // Si no hay link todavía, intentar crearlo automáticamente usando
            // los datos del documento del usuario (playerNumber almacenado al
            // aprobar la solicitud de registro del padre).
            if (!links.length && clubId) {
                try {
                    // Buscar playerNumber en el documento del usuario primero
                    const myDoc  = await getDoc(doc(fa.db, 'users', me.uid));
                    const myData = myDoc.exists() ? myDoc.data() : {};
                    let pNum  = myData.playerNumber || myData.dorsalJugador || null;
                    let pAlias = myData.playerAlias || myData.playerName || myData.displayName || '';

                    // Si no está en users, buscar en platform_requests
                    if (!pNum || !myData.inviteCode) {
                        try {
                            const prSnap = await getDocs(query(
                                collection(fa.db, 'platform_requests'),
                                where('requestedEmail',  '==', me.email || ''),
                                where('clubId', '==', clubId)
                            ));
                            prSnap.forEach(d => {
                                const pr = d.data();
                                if (!pNum && (pr.playerNumber || pr.requestedPlayerNumber)) {
                                    pNum   = pr.playerNumber || pr.requestedPlayerNumber;
                                    pAlias = pr.playerAlias || pr.playerName || pAlias;
                                }
                                if (!myData.inviteCode && pr.inviteCode) {
                                    myData.inviteCode = pr.inviteCode;
                                }
                            });
                        } catch(_) {}
                    }

                    // ── FIX A1: extraer playerNumber del inviteCode top-level ──
                    // El registro guarda inviteCode ('J10') en Firestore, no playerNumber ('10').
                    if (!pNum && myData.inviteCode) {
                        const invM = String(myData.inviteCode).match(/^J-?(\d+)$/i);
                        if (invM) {
                            pNum = invM[1];
                            console.log('[ppPlayer] playerNumber extraído de inviteCode (top-level):', myData.inviteCode, '→', pNum);
                        }
                    }

                    // ── FIX A2: buscar inviteCode dentro de allRoles[] ──
                    // Usuarios con múltiples roles: el inviteCode puede estar SOLO en
                    // allRoles[N].inviteCode para la entrada del rol 'parent', no en el top-level.
                    if (!pNum && Array.isArray(myData.allRoles)) {
                        const parentEntry = myData.allRoles.find(r =>
                            r.role === 'parent' && (r.clubId === clubId || !r.clubId)
                        );
                        if (parentEntry) {
                            if (parentEntry.inviteCode) {
                                const invM2 = String(parentEntry.inviteCode).match(/^J-?(\d+)$/i);
                                if (invM2) {
                                    pNum = invM2[1];
                                    pAlias = parentEntry.playerAlias || parentEntry.displayName || pAlias;
                                    console.log('[ppPlayer] playerNumber extraído de allRoles[parent].inviteCode:', parentEntry.inviteCode, '→', pNum);
                                }
                            }
                            // Actualizar top-level inviteCode para futuros accesos más rápidos
                            if (pNum && !myData.inviteCode) {
                                updateDoc(doc(fa.db, 'users', me.uid), {
                                    inviteCode: parentEntry.inviteCode || ('J' + pNum),
                                    playerNumber: String(pNum),
                                    playerAlias: pAlias || myData.playerAlias || ''
                                }).catch(() => {});
                            }
                        }
                    }

                    // También buscar en cronos_player_links por email del padre o por inviteCode
                    if (!pNum && (me.email || myData.inviteCode)) {
                        try {
                            const queries = [];
                            if (me.email) queries.push(query(
                                collection(fa.db, 'cronos_player_links'),
                                where('parentEmail', '==', me.email),
                                where('clubId',      '==', clubId)
                            ));
                            if (myData.inviteCode) queries.push(query(
                                collection(fa.db, 'cronos_player_links'),
                                where('inviteCode', '==', myData.inviteCode),
                                where('clubId',     '==', clubId)
                            ));

                            for (const q of queries) {
                                const qSnap = await getDocs(q);
                                qSnap.forEach(d => {
                                    const ld = d.data();
                                    if (!pNum && (ld.playerNumber || ld.inviteCode)) {
                                        pNum   = ld.playerNumber || (ld.inviteCode ? ld.inviteCode.replace(/^J/, '') : null);
                                        pAlias = ld.playerAlias || ld.playerName || pAlias;
                                        // Si el link ya existe pero sin parentUid, actualizarlo
                                        if (!ld.parentUid) {
                                            updateDoc(doc(fa.db, 'cronos_player_links', d.id), {
                                                parentUid:   me.uid,
                                                parentEmail: me.email || ld.parentEmail || '',
                                                parentName:  myData.displayName || me.email || ld.parentName || '',
                                            }).catch(()=>{});
                                            links.push({ _id: d.id, ...ld, parentUid: me.uid });
                                        }
                                    }
                                });
                                if (links.length) break;
                            }
                        } catch(_) {}
                    }

                    if (pNum && clubId && !links.length) {
                        const pTeam  = myData.teamName || myData.category || '';
                        // Fase 4: la categoría del jugador permite al entrenador
                        // filtrar sus contactos por categoría. Se toma del doc del
                        // padre (category/categoryLabel) o, si no, del rol parent.
                        const _roleCat = (Array.isArray(myData.allRoles)
                            ? (myData.allRoles.find(r => r.role === 'parent' || r.role === 'parent_individual') || {})
                            : {});
                        const pCat = myData.category || myData.categoryLabel
                            || _roleCat.category || _roleCat.categoryLabel
                            || (me && me.category) || '';
                        const linkId = `${clubId}_${pNum}`;
                        const existingLink = await getDoc(doc(fa.db, 'cronos_player_links', linkId));

                        if (existingLink.exists()) {
                            const _exCat = existingLink.data().category;
                            await updateDoc(doc(fa.db, 'cronos_player_links', linkId), {
                                parentUid:   me.uid,
                                parentEmail: me.email || '',
                                parentPhone: myData.whatsapp || myData.phone || '',
                                parentName:  myData.displayName || me.email || '',
                                // Solo establecer categoría si el link no la tenía aún.
                                ...(!_exCat && pCat ? { category: pCat } : {}),
                            });
                        } else {
                            await setDoc(doc(fa.db, 'cronos_player_links', linkId), {
                                clubId,
                                playerNumber:      String(pNum),
                                playerAlias:       pAlias,
                                teamName:          pTeam,
                                category:          pCat || pTeam || '',
                                parentUid:         me.uid,
                                parentEmail:       me.email || '',
                                parentPhone:       myData.whatsapp || myData.phone || '',
                                parentName:        myData.displayName || me.email || '',
                                canReceiveReports: true,
                                canReceiveConv:    true,
                                canReceiveTr:      true,
                                canReceiveMsg:     true,
                                inviteCode:        `J${pNum}`,
                                createdAt:         new Date().toISOString(),
                            });
                        }
                        // Recargar tras la vinculación
                        const refreshSnap = await getDocs(query(
                            collection(fa.db, 'cronos_player_links'),
                            where('parentUid', '==', me.uid)
                        ));
                        refreshSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));
                    }
                } catch(autoErr) {
                    console.warn('[ppPlayer] Auto-vinculación fallida:', autoErr.message);
                }
            }

            if (!links.length) {
                // ── FIX: Mostrar formulario de entrada manual de código ──────
                // Si inviteCode es null en allRoles (rol parent añadido por admin
                // sin código) el padre puede introducirlo manualmente aquí.
                body.innerHTML = `
                <div style="max-width:420px;margin:2rem auto;padding:1.5rem;
                    background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
                    border-radius:12px;text-align:center;">
                    <div style="font-size:2rem;margin-bottom:0.8rem;">🔗</div>
                    <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.4rem;color:white;">
                        Vincular tu jugador
                    </div>
                    <div style="font-size:0.8rem;color:#7d8590;margin-bottom:1.2rem;">
                        Introduce el código de jugador que te proporcionó el entrenador
                        (por ejemplo: <strong style="color:#58a6ff;">J10</strong>).
                    </div>
                    <input id="pp-manual-code"
                        placeholder="Ej: J10"
                        maxlength="6"
                        style="width:100%;box-sizing:border-box;padding:0.65rem 1rem;
                            background:rgba(255,255,255,0.06);border:1px solid rgba(88,166,255,0.4);
                            border-radius:8px;color:white;font-size:1rem;text-align:center;
                            letter-spacing:2px;text-transform:uppercase;outline:none;margin-bottom:0.8rem;"
                        oninput="this.value=this.value.toUpperCase()"
                    />
                    <button onclick="window._ppLinkManual()"
                        style="width:100%;padding:0.65rem;background:#58a6ff;color:#0a0e14;
                            border:none;border-radius:8px;font-weight:700;font-size:0.95rem;
                            cursor:pointer;">
                        🔗 Vincular jugador
                    </button>
                    <div id="pp-link-msg" style="margin-top:0.6rem;font-size:0.8rem;color:#7d8590;"></div>
                </div>`;

                // Handler del botón de vinculación manual
                window._ppLinkManual = async () => {
                    const codeRaw = (document.getElementById('pp-manual-code')?.value || '').trim().toUpperCase();
                    const msgEl   = document.getElementById('pp-link-msg');
                    if (!msgEl) return;

                    // Validar formato J + número
                    const m = codeRaw.match(/^J-?(\d+)$/);
                    if (!m) {
                        msgEl.style.color = '#ff5858';
                        msgEl.textContent = '⚠️ Formato incorrecto. Usa J seguido del número (ej: J10).';
                        return;
                    }
                    const manualPNum = m[1];
                    msgEl.style.color = '#7d8590';
                    msgEl.textContent = '🔄 Buscando jugador…';

                    try {
                        const { collection, getDocs, query, where,
                                doc, getDoc, setDoc, updateDoc } = await import(
                            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

                        // 1. Buscar link existente por inviteCode o playerNumber
                        let linkDoc = null, linkRef = null;
                        const byCode = await getDocs(query(
                            collection(fa.db, 'cronos_player_links'),
                            where('inviteCode', '==', codeRaw),
                            where('clubId',     '==', clubId)
                        )).catch(() => null);

                        if (byCode && !byCode.empty) {
                            byCode.forEach(d => { if (!linkDoc) { linkDoc = d.data(); linkRef = d.ref; } });
                        }

                        if (!linkRef) {
                            // Buscar por playerNumber + clubId
                            const byNum = await getDocs(query(
                                collection(fa.db, 'cronos_player_links'),
                                where('playerNumber', '==', manualPNum),
                                where('clubId',       '==', clubId)
                            )).catch(() => null);
                            if (byNum && !byNum.empty) {
                                byNum.forEach(d => { if (!linkDoc) { linkDoc = d.data(); linkRef = d.ref; } });
                            }
                        }

                        if (linkRef) {
                            // Link encontrado: añadir parentUid
                            await updateDoc(linkRef, {
                                parentUid:   me.uid,
                                parentEmail: me.email || '',
                                parentName:  me.displayName || me.email || '',
                            });
                        } else {
                            // Link no existe: crear uno nuevo
                            if (!clubId) {
                                console.warn('[ppPlayer] Vinculación manual cancelada: clubId ausente, no se crea link para evitar ID basura "null_' + manualPNum + '" en cronos_player_links.');
                                return;
                            }
                            const newLinkId = clubId + '_' + manualPNum;
                            linkRef = doc(fa.db, 'cronos_player_links', newLinkId);
                            await setDoc(linkRef, {
                                clubId,
                                playerNumber:      manualPNum,
                                playerAlias:       '',
                                inviteCode:        codeRaw,
                                parentUid:         me.uid,
                                parentEmail:       me.email || '',
                                parentName:        me.displayName || me.email || '',
                                canReceiveReports: true,
                                canReceiveConv:    true,
                                canReceiveTr:      true,
                                canReceiveMsg:     true,
                                createdAt:         new Date().toISOString(),
                            });
                        }

                        // 2. Guardar inviteCode en el documento del usuario para futuros logins
                        await updateDoc(doc(fa.db, 'users', me.uid), {
                            inviteCode:   codeRaw,
                            playerNumber: manualPNum,
                        }).catch(() => {});

                        // 3. Actualizar allRoles[parent].inviteCode en Firestore
                        const userSnap = await getDoc(doc(fa.db, 'users', me.uid)).catch(() => null);
                        if (userSnap && userSnap.exists()) {
                            const userData = userSnap.data();
                            const updatedRoles = (userData.allRoles || []).map(r =>
                                (r.role === 'parent' && (r.clubId === clubId || !r.clubId))
                                    ? { ...r, inviteCode: codeRaw, playerNumber: manualPNum }
                                    : r
                            );
                            await updateDoc(doc(fa.db, 'users', me.uid), {
                                allRoles: updatedRoles
                            }).catch(() => {});
                        }

                        // 4. Actualizar contexto en memoria para esta sesión
                        if (window._cronosCurrentUser) {
                            window._cronosCurrentUser.inviteCode   = codeRaw;
                            window._cronosCurrentUser.playerNumber = manualPNum;
                        }

                        msgEl.style.color = '#3fb950';
                        msgEl.textContent = '✅ ¡Vinculado! Cargando tu informe…';
                        setTimeout(() => window.ppPlayer && window.ppPlayer(), 1200);

                    } catch(err) {
                        console.error('[ppLinkManual]', err);
                        const msgEl2 = document.getElementById('pp-link-msg');
                        if (msgEl2) {
                            msgEl2.style.color = '#ff5858';
                            msgEl2.textContent = '⚠️ Error al vincular. Comprueba el código e inténtalo de nuevo.';
                        }
                    }
                };
                return;
            }

            const link        = links[0];
            const playerLabel = link.playerAlias || link.playerName
                              || `Jugador #${link.playerNumber}`;

            // Informes de partido enviados por el entrenador
            // ── FIX B: buscar por parentUid (informes futuros) Y por playerNumber+clubId (informes pasados) ──
            // Los informes enviados antes de la vinculación tienen parentUid: null pero sí tienen playerNumber.
            const [rptByParent, rptByPlayer] = await Promise.all([
                getDocs(query(
                    collection(fa.db, 'cronos_player_reports'),
                    where('parentUid', '==', me.uid)
                )).catch(() => ({ forEach: () => {} })),
                (link.playerNumber && (me.clubId || link.clubId))
                    ? getDocs(query(
                        collection(fa.db, 'cronos_player_reports'),
                        where('playerNumber', '==', String(link.playerNumber)),
                        where('clubId',       '==', me.clubId || link.clubId)
                    )).catch(() => ({ forEach: () => {} }))
                    : Promise.resolve({ forEach: () => {} })
            ]);

            // ══════════════════════════════════════════════════════════════
            // FIX v3: Deduplicación robusta por partido + jugador
            // ══════════════════════════════════════════════════════════════
            // El problema anterior: la dedup usaba solo matchId+playerNumber,
            // pero los docs rpt_* (despacho manual viejo) NO tienen matchId,
            // así que su dedupKey era "_10" y TODOS los informes sin matchId
            // del mismo jugador colapsaban a uno solo (perdiendo partidos
            // distintos) O no se deduplicaban si tenían IDs distintos.
            //
            // FIX v3: Clave de deduplicación compuesta:
            //   Si tiene matchId → "{matchId}_{playerNumber}"
            //   Si NO tiene matchId → "{matchDate}_{rival}_{scoreHome}_{scoreAway}_{playerNumber}"
            // Esto permite distinguir partidos distintos incluso sin matchId
            // y deduplicar correctamente los 3 tipos de doc por partido:
            //   {matchId}_staff_p5      (staffReport=true) → EXCLUIDO
            //   {matchId}_coach_p5      (_forCoach=true)   → EXCLUIDO
            //   {matchId}_parent_UID_p5 (parent_player_report) → CORRECTO
            //   rpt_5_abc               (despacho manual)  → dedup por fecha+rival+marcador
            // ══════════════════════════════════════════════════════════════
            const reportsByMatch = {}; // clave: dedupKey
            const seenDocIds = new Set();

            // Helper: generar clave de deduplicación robusta
            function _rptDedupKey(data) {
                const pNum = data.playerNumber || '';
                if (data.matchId && data.matchId !== 'undefined' && data.matchId !== '') {
                    return `${data.matchId}_${pNum}`;
                }
                // Fallback: usar fecha + rival + marcador para distinguir partidos
                const date = data.matchDate || '';
                const rival = data.rival || '';
                const sh = data.scoreHome != null ? String(data.scoreHome) : '';
                const sa = data.scoreAway != null ? String(data.scoreAway) : '';
                return `${date}_${rival}_${sh}_${sa}_${pNum}`;
            }

            // Prioridad 1: docs con parentUid (informes específicos para padres)
            rptByParent.forEach(d => {
                const data = d.data();
                // EXCLUIR docs de staff y coach — NO son para padres
                if (data.staffReport === true || data._forCoach === true) return;
                // EXCLUIR docs que este padre ya descartó (soft delete)
                if (Array.isArray(data.dismissedBy) && data.dismissedBy.includes(me.uid)) return;
                if (seenDocIds.has(d.id)) return;
                seenDocIds.add(d.id);
                const dedupKey = _rptDedupKey(data);
                // Priorizar type=parent_player_report sobre otros tipos
                if (!reportsByMatch[dedupKey] || data.type === 'parent_player_report') {
                    reportsByMatch[dedupKey] = { _id: d.id, ...data };
                }
            });
            // Prioridad 2: docs por playerNumber sin parentUid (informes pre-vinculación)
            rptByPlayer.forEach(d => {
                const data = d.data();
                // EXCLUIR docs de staff y coach — NO son para padres
                if (data.staffReport === true || data._forCoach === true) return;
                // EXCLUIR docs que este padre ya descartó (soft delete)
                if (Array.isArray(data.dismissedBy) && data.dismissedBy.includes(me.uid)) return;
                if (seenDocIds.has(d.id)) return;
                seenDocIds.add(d.id);
                const dedupKey = _rptDedupKey(data);
                if (!reportsByMatch[dedupKey]) {
                    reportsByMatch[dedupKey] = { _id: d.id, ...data };
                    // Actualizar parentUid en Firestore si falta
                    if (!data.parentUid && me.uid) {
                        const { updateDoc: upd, doc: docRef } = { updateDoc, doc };
                        upd(docRef(fa.db, 'cronos_player_reports', d.id), {
                            parentUid: me.uid
                        }).catch(() => {});
                    }
                }
            });

            const reports = Object.values(reportsByMatch);
            reports.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

            // ── LIMPIEZA DE DUPLICADOS EN FIRESTORE ─────────────────────
            // FIX v3: Los docs que NO fueron seleccionados como ganadores de
            // la deduplicación son duplicados que deben borrarse de Firestore.
            // Esto limpia progresivamente los docs rpt_* legacy y otros
            // duplicados que se acumularon antes del fix.
            const _winningIds = new Set(reports.map(r => r._id));
            const _allSeenIds = Array.from(seenDocIds);
            const _duplicateIds = _allSeenIds.filter(id => !_winningIds.has(id));
            if (_duplicateIds.length > 0) {
                console.log(`[ParentPanel] Limpiando ${_duplicateIds.length} docs duplicados de Firestore`);
                import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
                    .then(({ doc: dRef, deleteDoc }) => {
                        _duplicateIds.forEach(id => {
                            deleteDoc(dRef(fa.db, 'cronos_player_reports', id)).catch(() => {});
                        });
                    });
            }

            // ── MAX 40: auto-borrar los más antiguos si hay más ─────────────
            const MAX_RPT = 40;
            if (reports.length > MAX_RPT) {
                const toDelete = reports.splice(MAX_RPT);
                import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
                    .then(({ doc: dRef, deleteDoc }) => {
                        toDelete.forEach(r => {
                            if (r._id) deleteDoc(dRef(fa.db, 'cronos_player_reports', r._id)).catch(()=>{});
                        });
                    });
            }

            // ── Helpers de tiempo ────────────────────────────────────────────
            const _mmssToSec = (str) => {
                if (!str && str !== 0) return 0;
                const parts = String(str).split(':').map(n => parseInt(n)||0);
                if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
                if (parts.length === 2) return parts[0]*60 + parts[1];
                return parts[0]; // raw seconds or minutes
            };
            const _secToLabel = (s) => {
                const m = Math.floor(s / 60), sec = s % 60;
                return sec > 0 ? `${m}'${String(sec).padStart(2,'0')}"` : `${m}'`;
            };
            const _fmtTotal = (secs) => {
                const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60);
                return h > 0 ? `${h}h ${m}m` : `${m} min`;
            };

            // ── Estadísticas acumuladas (solo de los partidos mostrados) ─────
            const totalGoals   = reports.reduce((s,r) => s + (r.goals||0), 0);
            const totalYellow  = reports.filter(r => r.cards === 'amarilla').length;
            const totalRed     = reports.filter(r => r.cards === 'roja').length;
            const totalInjured = reports.filter(r => r.injured).length;
            const totalGames   = reports.length;
            const totalSecs    = reports.reduce((s,r) => s + _mmssToSec(r.minutesPlayed), 0);
            const totalTimeStr = _fmtTotal(totalSecs);

            // ── Función generadora de SVG de línea de tiempo ─────────────────
            const _buildTimeline = (r) => {
                const playedSec  = _mmssToSec(r.minutesPlayed);
                const history    = Array.isArray(r.history) ? r.history : [];
                // Duración total visual: al menos el tiempo jugado, mín 30 min, máx 90 min
                const durSec     = Math.max(playedSec, 30*60);
                const capDurSec  = Math.min(durSec, 90*60);

                // Calcular períodos de juego y eventos desde history
                const periods = [];   // [{startSec, endSec}]
                const events  = [];   // [{type, timeSec, note}]

                if (history.length > 0) {
                    // Convertir minuto+segundo a segundos totales
                    const toSec = (ev) => (ev.minute||0)*60 + (ev.second||0);
                    const sorted = [...history].sort((a,b) => toSec(a) - toSec(b));
                    let inField = false, lastSec = 0;
                    sorted.forEach(ev => {
                        const t = toSec(ev);
                        if (ev.type === 'starter') {
                            inField = true; lastSec = 0;
                        } else if (ev.type === 'sub_in') {
                            inField = true; lastSec = t;
                            events.push({type:'sub_in', timeSec:t, note: ev.note||''});
                        } else if (ev.type === 'sub_out') {
                            if (inField) periods.push({startSec:lastSec, endSec:t});
                            inField = false;
                            events.push({type:'sub_out', timeSec:t, note: ev.note||''});
                        } else if (['goal','yellow','red','injury'].includes(ev.type)) {
                            events.push({type:ev.type, timeSec:t, note: ev.note||ev.timeStr||''});
                        }
                    });
                    if (inField && playedSec > 0) {
                        periods.push({startSec: lastSec, endSec: playedSec});
                    }
                } else if (playedSec > 0) {
                    // Sin historial: asumir titular desde minuto 0
                    periods.push({startSec:0, endSec:playedSec});
                }

                // ── Construir SVG ────────────────────────────────────────────
                const W = 500, Hsvg = 72;
                const TRACK_Y = 28, TRACK_H = 16;  // barra principal
                const EVT_Y   = 12;                 // zona de eventos (sobre barra)
                const LBL_Y   = Hsvg - 4;           // etiquetas de minutos
                const sc      = W / capDurSec;       // px por segundo

                // Marcas de tiempo (cada 15 min, ajustadas al partido)
                const tickMins = capDurSec <= 40*60
                    ? [0,10,20,30,40]
                    : capDurSec <= 60*60
                        ? [0,15,30,45,60]
                        : [0,15,30,45,60,75,90];

                let svg = `<svg viewBox="0 0 ${W} ${Hsvg}" width="100%" style="display:block;overflow:visible;">`;
                svg += `<defs>
                    <clipPath id="cc${r._id||'x'}"><rect x="0" y="0" width="${W}" height="${Hsvg}"/></clipPath>
                </defs>`;

                // Fondo banquillo (toda la duración)
                svg += `<rect x="0" y="${TRACK_Y}" width="${W}" height="${TRACK_H}"
                    rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>`;

                // Etiquetas "BANQUILLO" en los huecos
                const gaps = [];
                let prev = 0;
                [...periods].sort((a,b)=>a.startSec-b.startSec).forEach(p => {
                    if (p.startSec > prev) gaps.push({startSec:prev, endSec:p.startSec});
                    prev = p.endSec;
                });
                if (prev < capDurSec) gaps.push({startSec:prev, endSec:capDurSec});

                gaps.forEach(g => {
                    const gW = (g.endSec - g.startSec) * sc;
                    if (gW > 40) {
                        const cx = g.startSec * sc + gW/2;
                        svg += `<text x="${cx.toFixed(1)}" y="${TRACK_Y+TRACK_H/2+3}"
                            text-anchor="middle" font-size="7"
                            fill="rgba(255,255,255,0.22)" font-weight="600"
                            letter-spacing="1">BANQUILLO</text>`;
                    }
                });

                // Barras de tiempo jugado (azul)
                periods.forEach(p => {
                    const px = p.startSec * sc, pw = (p.endSec - p.startSec) * sc;
                    svg += `<rect x="${px.toFixed(1)}" y="${TRACK_Y}" width="${Math.max(2,pw).toFixed(1)}"
                        height="${TRACK_H}" rx="3" fill="#58a6ff" fill-opacity="0.82"/>`;
                });

                // Líneas verticales de ticks
                tickMins.forEach(mn => {
                    const tx = mn * 60 * sc;
                    svg += `<line x1="${tx.toFixed(1)}" y1="${TRACK_Y-2}" x2="${tx.toFixed(1)}" y2="${TRACK_Y+TRACK_H+2}"
                        stroke="rgba(255,255,255,0.12)" stroke-width="0.8" stroke-dasharray="2,2"/>`;
                    svg += `<text x="${tx.toFixed(1)}" y="${LBL_Y}" font-size="8"
                        fill="rgba(255,255,255,0.35)"
                        text-anchor="${mn===0?'start':mn===tickMins[tickMins.length-1]?'end':'middle'}">${mn}'</text>`;
                });

                // Marcadores de sustitución (línea vertical)
                events.filter(e => e.type === 'sub_in' || e.type === 'sub_out').forEach(e => {
                    const ex = e.timeSec * sc;
                    const col = e.type === 'sub_in' ? '#3fb950' : '#ff5858';
                    svg += `<line x1="${ex.toFixed(1)}" y1="${TRACK_Y-4}" x2="${ex.toFixed(1)}" y2="${TRACK_Y+TRACK_H+2}"
                        stroke="${col}" stroke-width="1.5"/>`;
                    const arrow = e.type === 'sub_in' ? '▲' : '▼';
                    svg += `<text x="${ex.toFixed(1)}" y="${EVT_Y}" text-anchor="middle"
                        font-size="8" fill="${col}">${arrow}</text>`;
                });

                // Iconos de eventos (goles, tarjetas, lesiones)
                const evtIcon = {goal:'⚽', yellow:'🟨', red:'🟥', injury:'🚑'};
                events.filter(e => evtIcon[e.type]).forEach(e => {
                    const ex = e.timeSec * sc;
                    svg += `<text x="${ex.toFixed(1)}" y="${EVT_Y}" text-anchor="middle"
                        font-size="10">${evtIcon[e.type]}</text>`;
                    // Tiempo exacto debajo del icono
                    svg += `<text x="${ex.toFixed(1)}" y="${EVT_Y+10}" text-anchor="middle"
                        font-size="6" fill="rgba(255,255,255,0.45)">${_secToLabel(e.timeSec)}</text>`;
                });

                svg += '</svg>';
                return { svg, events, periods, playedSec };
            };

            // ── Handler de borrado (expuesto globalmente) ────────────────────
            // FIX v2: Soft delete — añade el UID del padre a dismissedBy
            // en vez de borrar físicamente el documento. Así no afecta a otros roles.
            window._ppDeleteReport = async (reportId) => {
                if (!confirm('¿Ocultar este informe de tu panel? Solo se eliminará para ti.')) return;
                try {
                    const { doc: dRef2, updateDoc, arrayUnion } = await import(
                        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    await updateDoc(dRef2(fa.db, 'cronos_player_reports', reportId), {
                        dismissedBy: arrayUnion(me.uid)
                    });
                    if (typeof window.ppPlayer === 'function') window.ppPlayer();
                } catch(err) {
                    // Fallback: si dismissedBy falla (permisos), intentar borrado físico
                    // solo para informes de tipo parent_player_report del propio padre
                    console.warn('[ppDelete] Soft delete falló, intentando borrado físico:', err.message);
                    try {
                        const { doc: dRef3, deleteDoc } = await import(
                            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                        await deleteDoc(dRef3(fa.db, 'cronos_player_reports', reportId));
                        if (typeof window.ppPlayer === 'function') window.ppPlayer();
                    } catch(err2) {
                        alert('⚠️ Error al eliminar: ' + err2.message);
                    }
                }
            };

            const _esc = (v) => typeof escapeHtml === 'function' ? escapeHtml(String(v||'')) : String(v||'');

            body.innerHTML = `

            <!-- Cabecera jugador -->
            <div class="pp-card" style="border-color:rgba(88,166,255,0.4);
                                         background:rgba(88,166,255,0.05);margin-bottom:1rem;">
                <div style="font-size:1.05rem;font-weight:700;">
                    ⚽ ${typeof escapeHtml==='function'?escapeHtml(playerLabel):playerLabel}
                    <span style="color:#58a6ff;"> · #${typeof escapeHtml==='function'?escapeHtml(link.playerNumber):link.playerNumber}</span>
                </div>
                <div style="font-size:0.74rem;color:#7d8590;margin-top:0.15rem;">
                    ${typeof escapeHtml==='function'?escapeHtml(link.teamName || clubName || ''):link.teamName || clubName || ''}
                </div>
            </div>

            <!-- Estadísticas acumuladas (suma de los ${MAX_RPT} últimos partidos mostrados) -->
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
                        <div style="font-size:1.1rem;font-weight:700;color:${color};line-height:1.1;">${val}</div>
                        <div style="font-size:0.63rem;color:#7d8590;margin-top:0.2rem;">${label}</div>
                    </div>`).join('')}
            </div>

            <!-- Historial partido a partido -->
            <div style="font-size:0.74rem;font-weight:700;color:#7d8590;
                        letter-spacing:0.5px;margin-bottom:0.55rem;">
                INFORMES INDIVIDUALES POR PARTIDO (${totalGames}${totalGames>=MAX_RPT?' · máx '+MAX_RPT:''})
            </div>

            ${reports.length ? reports.map((r) => {
                const { svg: tlSvg, events: tlEvts, periods: tlPeriods, playedSec: tlSec } = _buildTimeline(r);
                const tlLabel = tlSec > 0 ? _secToLabel(tlSec) : '0\'';
                const sh = r.scoreHome, sa = r.scoreAway;
                const resultNum = (sh != null && sa != null) ? (Number(sh) > Number(sa) ? 'VICTORIA' : Number(sh) < Number(sa) ? 'DERROTA' : 'EMPATE') : '';
                const rCol = resultNum === 'VICTORIA' ? '#3fb950' : resultNum === 'DERROTA' ? '#ff5858' : '#eab308';

                // Eventos cronológicos para el listado
                const evIcons = {
                    starter: {icon:'🏁', col:'#58a6ff',               txt:'Titular desde el inicio'},
                    sub_in:  {icon:'▲',  col:'#3fb950',               txt:'Entra al campo'},
                    sub_out: {icon:'▼',  col:'rgba(255,100,100,0.9)', txt:'Sale al banquillo'},
                    goal:    {icon:'⚽', col:'#3fb950',               txt:'Gol'},
                    yellow:  {icon:'🟨', col:'#eab308',               txt:'Tarjeta amarilla'},
                    red:     {icon:'🟥', col:'#ef4444',               txt:'Tarjeta roja'},
                    injury:  {icon:'🚑', col:'#f97316',               txt:'Lesión'},
                };
                const allEvts = [...tlEvts].sort((a,b) => a.timeSec - b.timeSec);
                const evRows = allEvts.length ? allEvts.map(ev => {
                    const info = evIcons[ev.type] || {icon:'•', col:'#7d8590', txt: ev.type};
                    return `<div style="display:flex;align-items:center;gap:8px;font-size:0.75rem;
                                padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                        <span style="min-width:38px;color:rgba(255,255,255,0.4);font-weight:700;
                                     font-variant-numeric:tabular-nums;">${_secToLabel(ev.timeSec)}</span>
                        <span style="font-size:1rem;line-height:1;">${info.icon}</span>
                        <span style="color:${info.col};font-weight:600;">${info.txt}</span>
                        ${ev.note ? `<span style="color:rgba(255,255,255,0.25);font-size:0.7rem;">${_esc(ev.note)}</span>` : ''}
                    </div>`;
                }).join('') : '';

                const miniStats = [
                    r.goals > 0  ? `⚽ ${r.goals}` : '',
                    r.cards === 'amarilla' ? '🟨' : '',
                    r.cards === 'roja'     ? '🟥' : '',
                    r.injured              ? '🚑' : '',
                ].filter(Boolean).join('  ');

                return `
                <div class="pp-card" style="margin-bottom:1rem;padding:1rem;
                    border-left:3px solid ${tlSec > 0 ? '#58a6ff' : 'rgba(255,255,255,0.1)'};">

                    <!-- Cabecera del partido -->
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;margin-bottom:0.8rem;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.2rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                vs <span style="color:#58a6ff;">${_esc(r.rival||'Rival')}</span>
                                ${sh != null && sa != null ? `<span style="color:white;opacity:0.9;">${sh}-${sa}</span>` : ''}
                                ${resultNum ? `<span style="font-size:0.65rem;font-weight:800;letter-spacing:0.5px;color:${rCol};">${resultNum}</span>` : ''}
                                ${miniStats ? `<span style="font-size:0.75rem;margin-left:4px;">${miniStats}</span>` : ''}
                            </div>
                            <div style="font-size:0.73rem;color:#7d8590;">📅 ${_esc(r.matchDate||'—')}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                            <div style="text-align:right;">
                                <div style="font-size:1.15rem;font-weight:800;color:#58a6ff;line-height:1;">${tlLabel}</div>
                                <div style="font-size:0.58rem;color:#7d8590;text-transform:uppercase;letter-spacing:0.5px;">tiempo jugado</div>
                            </div>
                            <button onclick="window._ppDeleteReport('${_esc(r._id||'')}')"
                                title="Eliminar este partido"
                                style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.25);
                                    color:#ff5858;border-radius:6px;padding:5px 8px;cursor:pointer;
                                    font-size:0.8rem;line-height:1;transition:background 0.15s;"
                                onmouseover="this.style.background='rgba(255,88,88,0.22)'"
                                onmouseout="this.style.background='rgba(255,88,88,0.1)'">🗑</button>
                        </div>
                    </div>

                    <!-- Línea de tiempo -->
                    <div style="margin:0.5rem 0 0.3rem;">
                        <div style="font-size:0.6rem;color:rgba(255,255,255,0.3);font-weight:700;
                                    letter-spacing:0.8px;text-transform:uppercase;margin-bottom:4px;">
                            LÍNEA DE TIEMPO
                            ${tlPeriods.length === 0 && tlSec === 0
                                ? '<span style="color:rgba(255,88,88,0.6);margin-left:6px;">(sin datos de tiempo)</span>'
                                : ''}
                        </div>
                        ${tlSvg}
                    </div>

                    <!-- Leyenda rápida -->
                    <div style="display:flex;gap:10px;margin:4px 0 8px;font-size:0.63rem;color:rgba(255,255,255,0.3);">
                        <span><span style="display:inline-block;width:10px;height:6px;background:#58a6ff;border-radius:2px;vertical-align:middle;"></span> En campo</span>
                        <span><span style="display:inline-block;width:10px;height:6px;background:rgba(255,255,255,0.08);border-radius:2px;vertical-align:middle;"></span> Banquillo</span>
                        <span>▲ Entra  ▼ Sale</span>
                    </div>

                    <!-- Eventos cronológicos -->
                    ${allEvts.length ? `
                    <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:0.6rem;margin-top:0.4rem;">
                        <div style="font-size:0.6rem;color:rgba(255,255,255,0.3);font-weight:700;
                                    letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">
                            EVENTOS CRONOLÓGICOS
                        </div>
                        ${evRows}
                    </div>` : ''}
                </div>`;
            }).join('') : `
            <div class="pp-empty" style="padding:2rem 1rem;">
                📊 Aún no hay informes de partido para este jugador.<br>
                <span style="font-size:0.8rem;color:#555;">
                    Cuando el entrenador envíe el informe tras cada partido, los datos aparecerán aquí.
                </span>
            </div>`}`;

        } catch(e) {
            body.innerHTML = `<div class="pp-empty">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
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
    ppNotifsByType('convocatoria');
}

// ══════════════════════════════════════════════════════════════
// TAB 4 · CHAT — Mensajería interna padre ↔ entrenador
// ══════════════════════════════════════════════════════════════
window.ppChat = async () => {
    const body = document.getElementById('pp-body');
    const me = window._cronosCurrentUser;
    if (!me) return;

    const fa = window._cronos_auth;
    try {
        const { collection, getDocs, query, where, doc, getDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // Buscar hilos donde el padre es participante
        // Los thread IDs son {coachUid}_{parentUid}
        const threadsSnap = await getDocs(query(
            collection(fa.db, 'cronos_messages'),
            where('parentUid', '==', me.uid)
        ));

        const threads = [];
        threadsSnap.forEach(d => threads.push({ _id: d.id, ...d.data() }));

        // También buscar hilos donde el threadId contiene el uid del padre
        const allMsgsSnap = await getDocs(collection(fa.db, 'cronos_messages'));
        allMsgsSnap.forEach(d => {
            const data = d.data();
            if (data.parentUid === me.uid && !threads.find(t => t._id === d.id)) {
                threads.push({ _id: d.id, ...data });
            }
        });

        if (!threads.length) {
            body.innerHTML = `<div class="pp-empty">
                💬 Aún no hay conversaciones con el entrenador.<br>
                <span style="font-size:0.8rem;color:#555;">
                    Cuando el entrenador te envíe un mensaje o informe,
                    aparecerá aquí para que puedas responder.
                </span>
            </div>`;
            return;
        }

        // Ordenar por último mensaje
        threads.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

        body.innerHTML = threads.map(t => {
            const unread = t.unreadByParent || 0;
            const lastMsg = t.lastMessage || '— Sin mensajes —';
            const lastTime = t.lastMessageAt
                ? new Date(t.lastMessageAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                : '';
            const coachLabel = t.coachEmail || 'Entrenador';

            return `
            <div onclick="ppOpenChatThread('${t._id}','${typeof escapeAttr==='function'?escapeAttr(coachLabel):coachLabel}')"
                 style="display:flex;align-items:center;gap:0.8rem;margin-bottom:0.6rem;
                        background:${unread ? 'rgba(88,166,255,0.06)' : 'var(--glass)'};
                        border:1px solid ${unread ? 'rgba(88,166,255,0.5)' : 'var(--glass-border)'};
                        border-radius:10px;padding:0.85rem 1rem;
                        cursor:pointer;transition:all 0.15s;">
                <div style="width:42px;height:42px;border-radius:50%;
                            background:rgba(63,185,80,0.15);
                            display:flex;align-items:center;justify-content:center;
                            font-size:1.2rem;flex-shrink:0;">
                    ⚽
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.88rem;margin-bottom:0.1rem;">
                        ${typeof escapeHtml==='function'?escapeHtml(coachLabel):coachLabel}
                        ${unread > 0 ? `<span style="background:#58a6ff;color:#0a0e14;border-radius:10px;
                            padding:1px 7px;font-size:0.62rem;font-weight:700;margin-left:6px;">
                            ${unread} nuevo${unread > 1 ? 's' : ''}</span>` : ''}
                    </div>
                    <div style="font-size:0.76rem;color:${unread ? '#58a6ff' : '#7d8590'};
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${unread ? `<strong>🔵 ${typeof escapeHtml==='function'?escapeHtml(lastMsg):lastMsg}</strong>` : (typeof escapeHtml==='function'?escapeHtml(lastMsg):lastMsg)}
                    </div>
                </div>
                <span style="font-size:0.68rem;color:#7d8590;flex-shrink:0;">${lastTime}</span>
            </div>`;
        }).join('');

    } catch (e) {
        body.innerHTML = `<div class="pp-empty">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
    }
};

// ── Abrir hilo de chat (vista padre) ──
window.ppOpenChatThread = async (threadId, coachLabel) => {
    const me = window._cronosCurrentUser;
    if (!me) return;
    const fa = window._cronos_auth;
    const body = document.getElementById('pp-body');

    body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
        <!-- Header del chat -->
        <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:0.8rem;flex-shrink:0;">
            <button onclick="ppChat()" class="pp-tab" style="padding:0.3rem 0.7rem;font-size:0.78rem;">
                ← Volver
            </button>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:0.9rem;">
                    ⚽ ${typeof escapeHtml==='function'?escapeHtml(coachLabel):coachLabel}
                </div>
                <div style="font-size:0.7rem;color:#7d8590;">Entrenador</div>
            </div>
        </div>

        <!-- Mensajes -->
        <div id="pp-chat-messages"
             style="flex:1;overflow-y:auto;padding:0.4rem 0;
                    display:flex;flex-direction:column;gap:0.5rem;min-height:200px;">
            <p style="color:#7d8590;text-align:center;padding:2rem;">⏳ Cargando mensajes…</p>
        </div>

        <!-- Input -->
        <div style="margin-top:0.8rem;flex-shrink:0;border-top:1px solid var(--glass-border);
                    padding-top:0.8rem;">
            <div style="display:flex;gap:0.5rem;align-items:flex-end;">
                <textarea id="pp-chat-input"
                    placeholder="Escribe un mensaje… (Enter para enviar)"
                    rows="2"
                    style="flex:1;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.88rem;resize:none;box-sizing:border-box;"
                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){
                        event.preventDefault();
                        ppSendChatMessage('${threadId}');
                    }"></textarea>
                <button onclick="ppSendChatMessage('${threadId}')"
                    style="padding:0.6rem 1rem;background:rgba(88,166,255,0.2);
                           border:1px solid rgba(88,166,255,0.4);border-radius:8px;
                           color:#58a6ff;font-weight:700;cursor:pointer;flex-shrink:0;">
                    Enviar ›
                </button>
            </div>
        </div>
    </div>`;

    // Cargar mensajes existentes
    try {
        const { doc, getDoc, updateDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const snap = await getDoc(doc(fa.db, 'cronos_messages', threadId));
        const container = document.getElementById('pp-chat-messages');

        if (!snap.exists() || !snap.data().messages?.length) {
            if (container) container.innerHTML = `
                <div style="text-align:center;color:#7d8590;padding:3rem 1rem;">
                    💬 Sin mensajes aún. ¡Escribe algo para empezar la conversación!
                </div>`;
        } else {
            const messages = snap.data().messages || [];
            if (container) {
                container.innerHTML = messages.map(m => {
                    const isMine = m.sender === 'parent';
                    const time = m.timestamp
                        ? new Date(m.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                        : '';
                    const date = m.timestamp
                        ? new Date(m.timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                        : '';

                    return `
                    <div style="display:flex;justify-content:${isMine ? 'flex-end' : 'flex-start'};padding:0 0.2rem;">
                        <div style="max-width:78%;
                                    background:${isMine ? 'rgba(88,166,255,0.18)' : 'rgba(255,255,255,0.07)'};
                                    border:1px solid ${isMine ? 'rgba(88,166,255,0.3)' : 'rgba(255,255,255,0.1)'};
                                    border-radius:12px;padding:0.5rem 0.85rem;">
                            <div style="font-size:0.84rem;line-height:1.55;white-space:pre-wrap;">
                                ${(typeof escapeHtml==='function'?escapeHtml(m.text):m.text).replace(/\*(.*?)\*/g, '<strong>$1</strong>')}
                            </div>
                            <div style="font-size:0.64rem;color:#7d8590;text-align:right;margin-top:0.25rem;">
                                ${date} ${time}
                            </div>
                        </div>
                    </div>`;
                }).join('');
                container.scrollTop = container.scrollHeight;
            }
        }

        // Marcar como leídos por el padre
        try {
            await updateDoc(doc(fa.db, 'cronos_messages', threadId), { unreadByParent: 0 });
        } catch (_) {}

    } catch (e) {
        if (document.getElementById('pp-chat-messages')) {
            document.getElementById('pp-chat-messages').innerHTML =
                `<div style="text-align:center;color:#ff5858;padding:1rem;">⚠️ Error al cargar</div>`;
        }
    }
};

// ── Enviar mensaje (desde el padre) ──
window.ppSendChatMessage = async (threadId) => {
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    const input = document.getElementById('pp-chat-input');
    const text = (input?.value || '').trim();
    if (!text) return;

    try {
        const { doc, getDoc, setDoc, updateDoc, arrayUnion } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const newMsg = {
            sender: 'parent',
            text,
            timestamp: new Date().toISOString(),
        };

        const snap = await getDoc(doc(fa.db, 'cronos_messages', threadId));
        const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

        if (snap.exists()) {
            await updateDoc(doc(fa.db, 'cronos_messages', threadId), {
                messages: arrayUnion(newMsg),
                lastMessage: preview,
                lastMessageAt: newMsg.timestamp,
                unreadByCoach: (snap.data().unreadByCoach || 0) + 1,
            });
        } else {
            // Crear nuevo hilo (caso raro)
            await setDoc(doc(fa.db, 'cronos_messages', threadId), {
                threadId,
                coachUid: threadId.split('_')[0],
                coachEmail: '',
                parentUid: me.uid,
                parentEmail: me.email,
                recipientType: 'parent',
                messages: [newMsg],
                lastMessage: preview,
                lastMessageAt: newMsg.timestamp,
                unreadByCoach: 1,
                unreadByParent: 0,
            });
        }

        if (input) input.value = '';
        // Recargar chat
        ppOpenChatThread(threadId, document.querySelector('#pp-body div[style*="font-weight:700"]')?.textContent || 'Entrenador');

    } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ Error: ' + e.message, 4000);
    }
};

window.openParentPanel = openParentPanel;


// ════════════════════════════════════════════════════════════════════
//  ENVIAR INFO DE ENTRENAMIENTO (entrenador → Firestore)
// ════════════════════════════════════════════════════════════════════
function openWeeklyPlanModal() {
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
                <div class="wp-day-row" data-day="${day}" data-idx="${i}" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.5rem 0.6rem;">
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

    // ── Pre-poblar desde localStorage['cronos_training_weeks'] ────────────
    try {
        const offset = window._trWeekOffset || 0;
        const getMon = typeof _getWeekMonday === 'function'
            ? _getWeekMonday(offset)
            : (() => {
                const now = new Date();
                const dow = now.getDay();
                const mon = new Date(now);
                mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
                mon.setHours(0,0,0,0);
                return mon;
            })();
        const weekKey = getMon.toISOString().substring(0, 10);
        // Actualizar el date input para reflejar la semana activa en el panel
        const dateInput = document.getElementById('wp-start-date');
        if (dateInput) dateInput.value = weekKey;

        const allWeeks = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
        const weekData = allWeeks[weekKey] || {};

        document.querySelectorAll('.wp-day-row').forEach((row) => {
            const idx = parseInt(row.dataset.idx || '0');
            const ms = getMon.getTime() + idx * 86400000;
            const dateKey = new Date(ms).toISOString().substring(0, 10);
            const dd = weekData[dateKey] || {};
            if (dd.hora)  row.querySelector('.wp-time').value = dd.hora;
            if (dd.lugar) row.querySelector('.wp-venue').value = dd.lugar;
            const noteParts = [dd.tipo, dd.equipaciones, dd.duracion].filter(Boolean);
            if (noteParts.length) row.querySelector('.wp-note').value = noteParts.join(' · ');
        });
    } catch(e) { /* silencioso */ }
}
window.openWeeklyPlanModal = openWeeklyPlanModal;

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
            // CRÍTICO: usar r.uid (Firebase Auth UID) si existe; r.id es el ID del emailConfig
            // y puede no coincidir con me.uid del director/coordinador en Firestore
            const targetUid = r.uid || r.id;
            await setDoc(
                doc(fa.db, 'cronos_notifications', `week_${targetUid}_${Date.now().toString(36)}`),
                {
                    type:          'planificacion_semanal',
                    clubId:        me?.clubId || null,
                    coachEmail:    me?.email  || '',
                    coachUid:      me?.uid    || '',
                    parentUid:     targetUid,
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

window.openWeeklyPlanModal = openWeeklyPlanModal;
window.sendWeeklyPlan          = sendWeeklyPlan;
window.sendWeeklyPlanWA         = sendWeeklyPlanWA;
window.sendWeeklyPlanEmail      = sendWeeklyPlanEmail;

// ════════════════════════════════════════════════════════════════════
//  TAB DE CONVOCATORIAS / ENTRENAMIENTOS PARA PADRES
//  Reemplaza el antiguo ppMsgs unificado con tabs separados y
//  detalle en modal in-app (sin alert())
// ════════════════════════════════════════════════════════════════════
window.ppNotifsByType = async function(type) {
    const body = document.getElementById('pp-body');
    if (!body) return;
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    body.innerHTML = '<p style="color:#7d8590;text-align:center;padding:3rem;">⏳ Cargando…</p>';

    const isConv  = type === 'convocatoria';
    const accent  = isConv ? '#3fb950' : '#f0883e';
    const icon    = isConv ? '📋' : '📅';
    const label   = isConv ? 'convocatorias' : 'avisos de entrenamiento';
    const MAX     = 40;

    try {
        const { collection, getDocs, query, where, deleteDoc, doc: dRef } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // Buscar por parentUid (enviadas personalmente) + clubId como fallback
        const clubId = me.clubId || me.individualId || '';
        const queries = [
            getDocs(query(collection(fa.db,'cronos_notifications'), where('parentUid','==',me.uid), where('type','==',type))).catch(()=>null),
        ];
        if (clubId) {
            queries.push(getDocs(query(collection(fa.db,'cronos_notifications'), where('clubId','==',clubId), where('type','==',type))).catch(()=>null));
        }
        const snaps = await Promise.all(queries);
        const seen  = new Set();
        let items   = [];
        snaps.forEach(snap => {
            if (!snap) return;
            snap.forEach(d => {
                if (seen.has(d.id)) return;
                seen.add(d.id);
                const dat = d.data();
                // FIX: omitir si este usuario ya lo descartó individualmente
                if (Array.isArray(dat.dismissedBy) && dat.dismissedBy.includes(me.uid)) return;
                items.push({ _id: d.id, ...dat });
            });
        });

        items.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

        // Auto-borrar exceso
        if (items.length > MAX) {
            const toDelete = items.splice(MAX);
            toDelete.forEach(it => deleteDoc(dRef(fa.db,'cronos_notifications',it._id)).catch(()=>{}));
        }

        if (!items.length) {
            body.innerHTML = `<div class="pp-empty">
                ${icon} No hay ${label} todavía.<br>
                <span style="font-size:0.78rem;color:#555;margin-top:0.3rem;display:block;">
                    Aquí aparecerán cuando el entrenador las envíe a través de la app.
                </span>
            </div>`;
            return;
        }

        body.innerHTML = items.map(d => {
            const date = d.createdAt
                ? new Date(d.createdAt).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
                : '—';

            const isPlan = d.type === 'planificacion_semanal';
            const title = isConv
                ? (d.rival ? '🆚 vs ' + (typeof escapeHtml==='function'?escapeHtml(d.rival):d.rival) : 'Partido')
                : isPlan
                    ? (d.weekStartDate
                        ? '📅 Semana del ' + new Date(d.weekStartDate + 'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long'})
                        : 'Planificación Semanal')
                    : (d.datetime ? new Date(d.datetime).toLocaleString('es-ES',{weekday:'long',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Entrenamiento');
            const sub = isConv
                ? [d.matchDate?'📅 '+d.matchDate:'', d.venue?'🏟️ '+d.venue:'', d.meettime?'🕐 '+d.meettime+'h':''].filter(Boolean).join(' · ')
                : isPlan
                    ? (Array.isArray(d.days) ? d.days.filter(dy=>dy.time||dy.venue||dy.note).map(dy=>`${dy.day}: ${dy.time||''}${dy.venue?' · '+dy.venue:''}`).slice(0,3).join(' | ') : '')
                    : [d.location?'📍 '+d.location:'', d.notes?'📝 '+d.notes:''].filter(Boolean).join(' · ');

            const ea = typeof escapeAttr==='function' ? escapeAttr : s=>(s||'').replace(/"/g,'&quot;');

            return `
            <div class="pp-card" style="border-left:3px solid ${accent};position:relative;">
                <button onclick="ppDeleteNotif('${ea(d._id)}')"
                    title="Eliminar"
                    style="position:absolute;top:0.6rem;right:0.6rem;background:rgba(255,88,88,0.08);
                           border:1px solid rgba(255,88,88,0.25);color:#ff5858;border-radius:6px;
                           width:26px;height:26px;cursor:pointer;font-size:0.75rem;display:flex;
                           align-items:center;justify-content:center;">🗑️</button>
                <div style="display:flex;justify-content:space-between;margin-bottom:0.35rem;padding-right:2rem;">
                    <span style="font-weight:700;color:${accent};font-size:0.85rem;">${icon} ${isConv?'Convocatoria':'Entrenamiento'}</span>
                    <span style="font-size:0.7rem;color:#7d8590;">${date}</span>
                </div>
                <div style="font-weight:700;font-size:0.9rem;margin-bottom:0.2rem;">${title}</div>
                ${sub ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.4rem;">${typeof escapeHtml==='function'?escapeHtml(sub):sub}</div>` : ''}
                ${isConv && d.players?.length ? `<div style="font-size:0.75rem;color:#3fb950;">👥 ${d.players.length} convocados</div>` : ''}
                <button onclick="ppViewNotifDetail('${ea(d._id)}')"
                    style="margin-top:0.6rem;width:100%;padding:0.45rem;background:rgba(88,166,255,0.08);
                           border:1px solid rgba(88,166,255,0.2);border-radius:7px;color:var(--primary);
                           font-size:0.8rem;font-weight:700;cursor:pointer;">
                    👁 Ver detalle completo
                </button>
            </div>`;
        }).join('');

        // ── Detalle completo en modal in-app ──────────────────────────
        window.ppViewNotifDetail = (id) => {
            const d = items.find(x => x._id === id);
            if (!d) return;
            const isC = d.type === 'convocatoria';
            const isPlan = d.type === 'planificacion_semanal';

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:1rem;';
            overlay.id = 'pp-notif-detail-overlay';
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

            const dtFmt = !isC && !isPlan && d.datetime
                ? new Date(d.datetime).toLocaleString('es-ES',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})
                : '';

            // Build weekly schedule HTML for planificacion_semanal
            const weekPlanHTML = isPlan && Array.isArray(d.days)
                ? d.days.map(dy => {
                    const hasData = dy.time || dy.venue || dy.note;
                    return '<div style="display:flex;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">'
                        + '<div style="font-weight:700;color:#f0883e;min-width:80px;font-size:0.85rem;">' + (typeof escapeHtml==='function'?escapeHtml(dy.day):dy.day) + '</div>'
                        + '<div style="font-size:0.82rem;color:' + (hasData?'var(--text)':'#555') + ';">'
                        + (hasData
                            ? [dy.time?'🕐 '+dy.time:'', dy.venue?'📍 '+(typeof escapeHtml==='function'?escapeHtml(dy.venue):dy.venue):'', dy.note?'📝 '+(typeof escapeHtml==='function'?escapeHtml(dy.note):dy.note):''].filter(Boolean).join(' &nbsp;·&nbsp; ')
                            : '_Descanso_')
                        + '</div></div>';
                }).join('')
                : '';

            overlay.innerHTML = `
            <div style="width:min(92vw,520px);background:#161b22;border:1px solid rgba(255,255,255,0.1);
                        border-radius:16px;padding:1.5rem;margin:auto;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
                <!-- Cabecera con logo -->
                <div style="text-align:center;margin-bottom:1.2rem;padding-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div style="font-size:2.2rem;margin-bottom:0.3rem;">${isC?'📋':'📅'}</div>
                    <div style="font-size:1.1rem;font-weight:900;letter-spacing:1px;color:${isC?'var(--primary)':'#f0883e'};">
                        CRONOS FÚTBOL
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">
                        ${isC ? 'CONVOCATORIA OFICIAL' : isPlan ? 'PLANIFICACIÓN SEMANAL' : 'AVISO DE ENTRENAMIENTO'}
                    </div>
                </div>

                <!-- Datos principales -->
                <div style="background:rgba(${isC?'88,166,255':'240,136,62'},0.06);border:1px solid rgba(${isC?'88,166,255':'240,136,62'},0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    ${isC ? `
                        ${d.matchDate?`<div style="font-size:0.95rem;margin-bottom:0.5rem;">📅 <strong>${typeof escapeHtml==='function'?escapeHtml(d.matchDate):d.matchDate}</strong></div>`:''}
                        ${d.rival   ?`<div style="font-size:0.95rem;margin-bottom:0.5rem;">🆚 vs <strong>${typeof escapeHtml==='function'?escapeHtml(d.rival):d.rival}</strong></div>`:''}
                        ${d.venue   ?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">🏟️ ${typeof escapeHtml==='function'?escapeHtml(d.venue):d.venue}</div>`:''}
                        ${d.meettime?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">🕐 Presentación: <strong>${typeof escapeHtml==='function'?escapeHtml(d.meettime):d.meettime}h</strong></div>`:''}
                        ${d.kickoff ?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">⚽ Inicio: <strong>${typeof escapeHtml==='function'?escapeHtml(d.kickoff):d.kickoff}h</strong></div>`:''}
                    ` : isPlan ? `
                        ${d.weekStartDate?`<div style="font-size:0.9rem;font-weight:700;color:#f0883e;margin-bottom:0.8rem;">📅 Semana del ${new Date(d.weekStartDate+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}</div>`:''}
                        <div style="display:flex;flex-direction:column;gap:0;">${weekPlanHTML}</div>
                    ` : `
                        <div style="font-size:0.95rem;margin-bottom:0.5rem;">📅 <strong>${typeof escapeHtml==='function'?escapeHtml(dtFmt):dtFmt}</strong></div>
                        ${d.location||d.venue?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">📍 ${typeof escapeHtml==='function'?escapeHtml(d.location||d.venue):d.location||d.venue}</div>`:''}
                        ${d.notes?`<div style="font-size:0.85rem;margin-top:0.4rem;padding:0.5rem;background:rgba(255,255,255,0.04);border-radius:6px;">📝 ${typeof escapeHtml==='function'?escapeHtml(d.notes):d.notes}</div>`:''}
                    `}
                </div>

                ${isC && d.players?.length ? `
                <div style="background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    <div style="font-size:0.72rem;font-weight:700;color:#3fb950;margin-bottom:0.6rem;letter-spacing:0.5px;">👥 CONVOCADOS (${d.players.length})</div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0.25rem;">
                        ${d.players.map((p,i)=>`<div style="font-size:0.8rem;padding:0.2rem 0.4rem;background:rgba(255,255,255,0.04);border-radius:4px;">${i+1}. ${typeof escapeHtml==='function'?escapeHtml(p):p}</div>`).join('')}
                    </div>
                </div>` : ''}

                ${d.extra?`<div style="font-size:0.85rem;padding:0.8rem;background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.15);border-radius:8px;margin-bottom:0.8rem;font-style:italic;">💬 ${typeof escapeHtml==='function'?escapeHtml(d.extra):d.extra}</div>`:''}

                <div style="font-size:0.68rem;color:var(--text-muted);text-align:right;margin-bottom:0.8rem;">
                    Enviado por: ${typeof escapeHtml==='function'?escapeHtml(d.coachEmail||'Entrenador'):d.coachEmail||'Entrenador'} · ${d.createdAt?new Date(d.createdAt).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}
                </div>

                <button onclick="(function(){var el=document.getElementById('pp-notif-detail-overlay');if(el)el.remove();})()"
                    style="width:100%;padding:0.65rem;background:rgba(88,166,255,0.12);
                           border:1px solid rgba(88,166,255,0.3);border-radius:9px;color:var(--primary);
                           font-weight:700;cursor:pointer;font-size:0.9rem;">
                    ✕ Cerrar
                </button>
            </div>`;
            document.body.appendChild(overlay);
        };

        // ── Eliminar ──────────────────────────────────────────────────
        // FIX: "borrar" = quitar solo de la vista de este usuario (no borra para los demás)
        window.ppDeleteNotif = async (id) => {
            if (!confirm('¿Quitar este aviso de tu bandeja? Los demás seguirán viéndolo.')) return;
            try {
                const { arrayUnion, updateDoc, doc: docRef } = await import(
                    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                await updateDoc(docRef(fa.db, 'cronos_notifications', id), {
                    dismissedBy: arrayUnion(me.uid)
                });
                items = items.filter(x => x._id !== id);
                ppNotifsByType(type);
                if (typeof showToast === 'function') showToast('🗑️ Quitado de tu bandeja', 2000);
            } catch(e) {
                if (typeof showToast === 'function') showToast('⚠️ Error: ' + e.message, 3000);
            }
        };

    } catch(e) {
        body.innerHTML = `<div class="pp-empty">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
    }
};

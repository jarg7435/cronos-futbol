// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Sistema de Comunicación Entrenador ↔ Padres v1.0
//  Colecciones Firestore:
//    cronos_player_links/{clubId}_{playerNumber} → vincula padre con jugador
//    cronos_messages/{coachUid}_{parentUid}      → hilo de mensajes
//    cronos_player_reports/{reportId}            → informes post-partido
// ════════════════════════════════════════════════════════════════════

// ── Función auxiliar para cargar módulo Firestore ─────────────────────
async function _cFS() {
    return await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
}

// ════════════════════════════════════════════════════════════════════
//  PANEL PRINCIPAL DE MENSAJES (vista entrenador)
// ════════════════════════════════════════════════════════════════════
async function openCoachMessaging() {
    const me = window._cronosCurrentUser;
    if (!me) return;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,720px);max-height:92vh;
         display:flex;flex-direction:column;overflow:hidden;">

        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:0.8rem;flex-shrink:0;">
            <h2 style="margin:0;font-size:1.05rem;">💬 Mensajes a Padres/Tutores</h2>
            <button onclick="document.getElementById('setup-modal').style.display='none'"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- Acciones rápidas -->
        <div style="display:flex;gap:0.5rem;margin-bottom:0.9rem;flex-shrink:0;flex-wrap:wrap;">
            <button onclick="openCoachMessaging()" class="btn"
                style="font-size:0.78rem;background:var(--glass);color:var(--text-muted);">
                🔄 Actualizar
            </button>
            <button onclick="openTrainingNotification()" class="btn"
                style="font-size:0.78rem;background:rgba(240,136,62,0.1);
                       border-color:rgba(240,136,62,0.4);color:var(--secondary);font-weight:700;">
                📅 Info Entrenamiento
            </button>
            <button onclick="openContactManager()" class="btn"
                style="font-size:0.78rem;background:rgba(255,255,255,0.05);
                       border-color:rgba(255,255,255,0.2);color:var(--text-muted);font-weight:700;">
                📱 Gestión Contactos
            </button>
            <button onclick="sendMatchReportsToParents()" class="btn"
                style="font-size:0.78rem;background:rgba(63,185,80,0.1);
                       border-color:rgba(63,185,80,0.4);color:#3fb950;font-weight:700;">
                📊 Enviar Informes
            </button>
        </div>

        <div id="coach-parent-list" style="flex:1;overflow-y:auto;">
            <p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando padres vinculados…</p>
        </div>
    </div>`;

    await _loadParentList();
}

async function _loadParentList() {
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    const body = document.getElementById('coach-parent-list');
    if (!body) return;

    try {
        const { db, collection, getDocs, query, where } = await _cFS();

        // Obtener vínculos jugador-padre de este club (antes era solo por coachUid)
        const linksSnap = await getDocs(query(
            collection(db, 'cronos_player_links'),
            where('clubId', '==', me.clubId)
        ));
        const links = [];
        linksSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

        if (!links.length) {
            body.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);padding:3rem 1rem;">
                👥 No hay padres vinculados aún.<br>
                <span style="font-size:0.8rem;margin-top:0.5rem;display:block;">
                    El administrador del club vincula cada padre con su jugador.
                </span>
            </div>`;
            return;
        }

        // Obtener hilos de mensajes existentes (aquí sí mantenemos coachUid para que el chat sea privado entrenador-padre)
        const threadsSnap = await getDocs(query(
            collection(db, 'cronos_messages'),
            where('coachUid', '==', me.uid)
        ));
        const threadsMap = {};
        threadsSnap.forEach(d => { threadsMap[d.id] = { _id: d.id, ...d.data() }; });

        // Ordenar por último mensaje
        links.sort((a, b) => {
            const ta = threadsMap[`${me.uid}_${a.parentUid}`]?.lastMessageAt || '';
            const tb = threadsMap[`${me.uid}_${b.parentUid}`]?.lastMessageAt || '';
            return tb.localeCompare(ta);
        });

        body.innerHTML = links.map(link => {
            const threadId = `${me.uid}_${link.parentUid}`;
            const thread   = threadsMap[threadId] || {};
            const unread   = thread.unreadByCoach || 0;
            const lastMsg  = thread.lastMessage || '— Sin mensajes —';
            const lastTime = thread.lastMessageAt
                ? new Date(thread.lastMessageAt).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
                : '';

            return `
            <div onclick="openThreadWithParent('${link.parentUid}','${link.parentEmail}',
                         '${link.playerNumber}','${link.playerAlias || link.playerName || ''}',
                         '${link.parentWA || ''}')"
                style="background:var(--glass);
                       border:1px solid ${unread ? 'rgba(88,166,255,0.5)' : 'var(--glass-border)'};
                       border-radius:10px;padding:0.85rem 1rem;margin-bottom:0.6rem;
                       cursor:pointer;display:flex;justify-content:space-between;
                       align-items:center;gap:0.8rem;transition:all 0.15s;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.88rem;margin-bottom:0.15rem;">
                        ⚽ ${link.playerAlias || link.playerName || 'Jugador'}
                        <span style="color:var(--primary);">#${link.playerNumber}</span>
                    </div>
                    <div style="font-size:0.73rem;color:var(--text-muted);margin-bottom:0.2rem;">
                        👨‍👩‍👧 ${link.parentEmail}
                        ${link.parentPhone ? ` · 📱 ${link.parentPhone}` : ''}
                    </div>
                    <div style="font-size:0.76rem;
                                color:${unread ? '#58a6ff' : 'var(--text-muted)'};
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${unread ? `<strong>🔵 ${lastMsg}</strong>` : lastMsg}
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;
                            gap:0.3rem;flex-shrink:0;">
                    ${unread > 0 ? `
                    <span style="background:#58a6ff;color:#0a0e14;border-radius:10px;
                        padding:2px 8px;font-size:0.68rem;font-weight:700;">
                        ${unread} nuevo${unread > 1 ? 's' : ''}
                    </span>` : ''}
                    <span style="font-size:0.68rem;color:var(--text-muted);">${lastTime}</span>
                    <span style="color:var(--text-muted);font-size:1.1rem;">›</span>
                </div>
            </div>`;
        }).join('');

    } catch(e) {
        if (document.getElementById('coach-parent-list')) {
            document.getElementById('coach-parent-list').innerHTML =
                `<div style="text-align:center;color:#ff5858;padding:2rem;">⚠️ Error: ${e.message}</div>`;
        }
    }
}

// ════════════════════════════════════════════════════════════════════
//  HILO DE CONVERSACIÓN individual
// ════════════════════════════════════════════════════════════════════
async function openThreadWithParent(parentUid, parentEmail, playerNumber, playerAlias, parentWA) {
    const me = window._cronosCurrentUser;
    if (!me) return;

    const threadId = `${me.uid}_${parentUid}`;
    const { db, doc, updateDoc } = await _cFS();

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,660px);max-height:92vh;
         display:flex;flex-direction:column;overflow:hidden;">

        <!-- Header del hilo -->
        <div style="display:flex;align-items:center;gap:0.7rem;
                    margin-bottom:0.8rem;flex-shrink:0;flex-wrap:wrap;">
            <button onclick="openCoachMessaging()" class="btn"
                style="font-size:0.78rem;padding:0.3rem 0.7rem;color:var(--text-muted);">
                ← Volver
            </button>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:0.9rem;">
                    ⚽ ${playerAlias || 'Jugador'}
                    <span style="color:var(--primary);">#${playerNumber}</span>
                </div>
                <div style="font-size:0.73rem;color:var(--text-muted);
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    👨‍👩‍👧 ${parentEmail}
                </div>
            </div>
            <!-- Botones rápidos WhatsApp / Email -->
            <div style="display:flex;gap:0.4rem;flex-shrink:0;">
                ${parentWA ? `
                <a href="https://wa.me/${parentWA}" target="_blank"
                    style="padding:0.35rem 0.7rem;background:rgba(37,211,102,0.12);
                           border:1px solid rgba(37,211,102,0.4);border-radius:6px;
                           color:#25d366;font-size:0.72rem;text-decoration:none;font-weight:700;">
                    📱 WA
                </a>` : ''}
                <a href="mailto:${parentEmail}"
                    style="padding:0.35rem 0.7rem;background:rgba(88,166,255,0.1);
                           border:1px solid rgba(88,166,255,0.3);border-radius:6px;
                           color:var(--primary);font-size:0.72rem;text-decoration:none;font-weight:700;">
                    📧 Email
                </a>
            </div>
        </div>

        <!-- Mensajes -->
        <div id="thread-messages"
             style="flex:1;overflow-y:auto;padding:0.4rem 0;
                    display:flex;flex-direction:column;gap:0.5rem;min-height:200px;">
            <p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando…</p>
        </div>

        <!-- Input envío -->
        <div style="margin-top:0.8rem;flex-shrink:0;border-top:1px solid var(--glass-border);
                    padding-top:0.8rem;">
            <div style="display:flex;gap:0.5rem;align-items:flex-end;">
                <textarea id="coach-msg-input"
                    placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter nueva línea)"
                    rows="2"
                    style="flex:1;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.88rem;resize:none;box-sizing:border-box;"
                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){
                        event.preventDefault();
                        sendCoachMessage('${threadId}','${parentUid}','${parentEmail}','${parentWA||''}');
                    }">
                </textarea>
                <button onclick="sendCoachMessage('${threadId}','${parentUid}','${parentEmail}','${parentWA||''}')"
                    class="btn primary" style="padding:0.6rem 1rem;flex-shrink:0;">
                    Enviar ›
                </button>
            </div>
        </div>
    </div>`;

    // Cargar mensajes y marcar como leídos
    await _loadThreadMessages(threadId, 'coach');
    try {
        await updateDoc(doc(db, 'cronos_messages', threadId), { unreadByCoach: 0 });
    } catch(e) { /* El hilo puede no existir aún */ }
}

// ── Cargar mensajes de un hilo (reutilizable para coach y padre) ─────────
async function _loadThreadMessages(threadId, perspective) {
    const { db, doc, getDoc } = await _cFS();
    const container = document.getElementById('thread-messages');
    if (!container) return;

    try {
        const snap = await getDoc(doc(db, 'cronos_messages', threadId));
        if (!snap.exists() || !snap.data().messages?.length) {
            container.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);
                        padding:3rem 1rem;font-size:0.85rem;">
                💬 Sin mensajes aún. ¡Empieza la conversación!
            </div>`;
            return;
        }

        const messages = snap.data().messages || [];
        container.innerHTML = messages.map(m => {
            // perspective 'coach': coach = derecha (azul), padre = izquierda
            // perspective 'parent': padre = derecha (violeta), coach = izquierda
            const isMine = (perspective === 'coach' && m.sender === 'coach') ||
                           (perspective === 'parent' && m.sender === 'parent');
            const time = m.timestamp
                ? new Date(m.timestamp).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})
                : '';
            const date = m.timestamp
                ? new Date(m.timestamp).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
                : '';
            const isReport = m.type === 'report';

            return `
            <div style="display:flex;justify-content:${isMine ? 'flex-end' : 'flex-start'};
                        padding:0 0.4rem;">
                <div style="max-width:78%;
                            background:${isReport
                                ? 'rgba(63,185,80,0.12)'
                                : isMine
                                    ? 'rgba(88,166,255,0.18)'
                                    : 'rgba(255,255,255,0.07)'};
                            border:1px solid ${isReport
                                ? 'rgba(63,185,80,0.3)'
                                : isMine
                                    ? 'rgba(88,166,255,0.3)'
                                    : 'rgba(255,255,255,0.1)'};
                            border-radius:12px;padding:0.5rem 0.85rem;">
                    <div style="font-size:0.84rem;line-height:1.55;white-space:pre-wrap;">
                        ${m.text.replace(/\*(.*?)\*/g,'<strong>$1</strong>')}
                    </div>
                    <div style="font-size:0.64rem;color:var(--text-muted);
                                text-align:right;margin-top:0.25rem;">
                        ${date} ${time} ·
                        ${m.sender === 'coach' ? 'Entrenador' : 'Padre/Tutor'}
                    </div>
                </div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;

    } catch(e) {
        if (container) container.innerHTML =
            `<div style="text-align:center;color:#ff5858;padding:1rem;">⚠️ ${e.message}</div>`;
    }
}

// ── Enviar mensaje (entrenador) ────────────────────────────────────────────
window.sendCoachMessage = async function(threadId, parentUid, parentEmail, parentWA) {
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    const input = document.getElementById('coach-msg-input');
    const text  = (input?.value || '').trim();
    if (!text) return;

    const { db, doc, getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();

    const newMsg = {
        sender: 'coach',
        text,
        timestamp: new Date().toISOString(),
    };

    try {
        const snap = await getDoc(doc(db, 'cronos_messages', threadId));
        const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

        if (snap.exists()) {
            await updateDoc(doc(db, 'cronos_messages', threadId), {
                messages:       arrayUnion(newMsg),
                lastMessage:    preview,
                lastMessageAt:  newMsg.timestamp,
                unreadByParent: (snap.data().unreadByParent || 0) + 1,
            });
        } else {
            await setDoc(doc(db, 'cronos_messages', threadId), {
                threadId,
                coachUid:       me.uid,
                coachEmail:     me.email,
                parentUid,
                parentEmail,
                messages:       [newMsg],
                lastMessage:    preview,
                lastMessageAt:  newMsg.timestamp,
                unreadByCoach:  0,
                unreadByParent: 1,
            });
        }

        if (input) input.value = '';
        await _loadThreadMessages(threadId, 'coach');

    } catch(e) {
        showToast('⚠️ Error al enviar: ' + e.message, 4000);
    }
};

// ════════════════════════════════════════════════════════════════════
//  ENVIAR INFORMES DE PARTIDO A TODOS LOS PADRES VINCULADOS
// ════════════════════════════════════════════════════════════════════
async function sendMatchReportsToParents() {
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    if (!players || !players.length) {
        showToast('⚠️ No hay partido activo. Inicia un partido primero.', 4000);
        return;
    }

    if (!confirm('¿Enviar el informe del partido a todos los padres vinculados?\n\nSe enviará la información de cada jugador al padre/tutor correspondiente.')) return;

    showSpinner('Enviando informes a padres…');

    try {
        const { db, collection, getDocs, query, where, doc,
                getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();

        const linksSnap = await getDocs(query(
            collection(db, 'cronos_player_links'),
            where('clubId', '==', me.clubId)
        ));
        const links = [];
        linksSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

        if (!links.length) {
            hideSpinner();
            showToast('⚠️ No hay padres vinculados para recibir informes.', 4000);
            return;
        }

        const scoreHome  = document.getElementById('score-home')?.textContent || '0';
        const scoreAway  = document.getElementById('score-away')?.textContent || '0';
        const matchDate  = new Date().toLocaleDateString('es-ES',
            {weekday:'long', day:'numeric', month:'long'});
        const homePlayers = players.filter(p => p.team === 'home');

        let sent = 0;

        for (const link of links) {
            const player = homePlayers.find(p => String(p.number) === String(link.playerNumber));
            if (!player) continue;

            const cardIcon = player.cards === 'amarilla' ? '🟨 Amarilla'
                           : player.cards === 'roja'     ? '🟥 Roja'
                           : '—';
            const minutesPlayed = formatTime(player.time || 0);

            const reportText =
                `📊 *INFORME DE PARTIDO*\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `📅 ${matchDate}\n` +
                `⚽ ${TEAM_NAMES.home} *${scoreHome}* - *${scoreAway}* ${TEAM_NAMES.away}\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `👤 *${player.name}* — Dorsal ${player.number}\n\n` +
                `⏱️ Minutos jugados: *${minutesPlayed}*\n` +
                `⚽ Goles: *${player.goals || 0}*\n` +
                `🃏 Tarjetas: *${cardIcon}*\n` +
                (player.injured ? `🚑 *LESIONADO*\n` : '') +
                `━━━━━━━━━━━━━━━━\n` +
                `_Cronos Fútbol · Informe automático_`;

            // Guardar informe en cronos_player_reports
            const reportId = `rpt_${link.playerNumber}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_player_reports', reportId), {
                reportId,
                playerNumber:   link.playerNumber,
                playerAlias:    link.playerAlias || player.name,
                parentUid:      link.parentUid,
                coachUid:       me.uid,
                coachEmail:     me.email,
                clubId:         me.clubId || null,
                matchDate,
                rival:          TEAM_NAMES.away,
                scoreHome,
                scoreAway,
                minutesPlayed,
                goals:          player.goals   || 0,
                cards:          player.cards   || 'ninguna',
                injured:        player.injured || false,
                history:        player.history || [],
                createdAt:      new Date().toISOString(),
            });

            // Enviar como mensaje en el hilo
            const threadId  = `${me.uid}_${link.parentUid}`;
            const threadSnap = await getDoc(doc(db, 'cronos_messages', threadId));
            const msgEntry   = {
                sender:    'coach',
                text:      reportText,
                timestamp: new Date().toISOString(),
                type:      'report',
            };

            if (threadSnap.exists()) {
                await updateDoc(doc(db, 'cronos_messages', threadId), {
                    messages:       arrayUnion(msgEntry),
                    lastMessage:    '📊 Informe de partido enviado',
                    lastMessageAt:  msgEntry.timestamp,
                    unreadByParent: (threadSnap.data().unreadByParent || 0) + 1,
                });
            } else {
                await setDoc(doc(db, 'cronos_messages', threadId), {
                    threadId,
                    coachUid:       me.uid,
                    coachEmail:     me.email,
                    parentUid:      link.parentUid,
                    parentEmail:    link.parentEmail,
                    messages:       [msgEntry],
                    lastMessage:    '📊 Informe de partido enviado',
                    lastMessageAt:  msgEntry.timestamp,
                    unreadByCoach:  0,
                    unreadByParent: 1,
                });
            }

            // --- NOTIFICACIÓN INTERNA GRATUITA (TAB MENSAJES DEL PADRE) ---
            const notifId = `notif_rpt_${link.playerNumber}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', notifId), {
                type:           'informe_partido',
                clubId:         me.clubId || null,
                parentUid:      link.parentUid,
                playerNumber:   link.playerNumber,
                rival:          TEAM_NAMES.away,
                scoreHome,
                scoreAway,
                minutesPlayed,
                goals:          player.goals || 0,
                cards:          cardIcon,
                injured:        player.injured || false,
                createdAt:      new Date().toISOString()
            });

            // --- OPCIÓN WHATSAPP (SI TIENE TELÉFONO GRABADO) ---
            if (link.parentPhone) {
                const waUrl = `https://wa.me/${link.parentPhone}?text=${encodeURIComponent(reportText)}`;
                // Nota: Abrir WhatsApp individualmente si el coach lo desea, o dejarlo para el hilo
                console.log(`[WA] Perfil listo para: ${link.parentPhone}`);
            }

            sent++;
        }

        hideSpinner();
        showToast(`✅ Informe enviado a ${sent} padre${sent !== 1 ? 's' : ''}`, 4000);

    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error: ' + e.message, 5000);
    }
}

// ── Guardado automático interno para Club Staff ───────────────────────
async function saveAllMatchReportsInternal() {
    const me = window._cronosCurrentUser;
    if (!me || !window.players) return;

    try {
        const { setDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth.db;

        const scoreHome = document.getElementById('score-home')?.textContent || '0';
        const scoreAway = document.getElementById('score-away')?.textContent || '0';
        const matchDate = new Date().toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
        const homePlayers = window.players.filter(p => p.team === 'home');

        // Obtener links actuales para vincular playerNumber → parentUid
        const { collection, getDocs, query, where } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const linksSnap = await getDocs(query(
            collection(db, 'cronos_player_links'),
            where('clubId', '==', me.clubId || '')
        ));

        const linksMap = {};
        linksSnap.forEach(d => {
            const data = d.data();
            linksMap[data.playerNumber] = data;
        });

        let saved = 0;
        for (const player of homePlayers) {
            const link = linksMap[player.number] || {};
            const reportId = `rpt_${player.number}_${Date.now().toString(36)}`;
            
            await setDoc(doc(db, 'cronos_player_reports', reportId), {
                reportId,
                playerNumber:   player.number,
                playerAlias:    player.name,
                parentUid:      link.parentUid || null,
                coachUid:       me.uid,
                coachEmail:     me.email,
                clubId:         me.clubId || null,
                matchDate,
                rival:          TEAM_NAMES.away,
                scoreHome,
                scoreAway,
                minutesPlayed:  formatTime(player.time || 0),
                goals:          player.goals   || 0,
                cards:          player.cards   || 'ninguna',
                injured:        player.injured || false,
                history:        player.history || [],
                createdAt:      new Date().toISOString(),
            });
            saved++;
        }
        console.log(`[AutoReport] ${saved} informes técnicos generados para Staff.`);
    } catch(e) {
        console.error('[AutoReport] Error:', e.message);
    }
}

// ── Gestión de Contactos (Teléfonos WhatsApp) ─────────────────────────
async function openContactManager() {
    const me = window._cronosCurrentUser;
    const db = window._cronos_auth.db;
    showSpinner('Cargando contactos…');

    try {
        const { collection, getDocs, query, where } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        
        const snap = await getDocs(query(
            collection(db, 'cronos_player_links'),
            where('clubId', '==', me.clubId || '')
        ));

        const links = [];
        snap.forEach(d => links.push({ _id: d.id, ...d.data() }));

        hideSpinner();

        const modal = document.getElementById('setup-modal');
        modal.style.display = 'flex';
        modal.innerHTML = `
        <div class="modal-content" style="width:min(95vw,500px);max-height:92vh;display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-shrink:0;">
                <h2 style="margin:0;font-size:1rem;">📱 Gestión de Contactos</h2>
                <button onclick="document.getElementById('setup-modal').style.display='none'" style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
            </div>
            
            <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1rem;">
                Graba los teléfonos de los padres de forma permanente para enviar WhatsApps directos.
            </p>

            <div style="flex:1;overflow-y:auto;">
                <table style="width:100%;font-size:0.8rem;border-collapse:collapse;">
                    <thead>
                        <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.1);">
                            <th style="padding:0.5rem;text-align:left;">JUGADOR</th>
                            <th style="padding:0.5rem;text-align:left;">DORSAL</th>
                            <th style="padding:0.5rem;text-align:left;">TELÉFONO WHATSAPP</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${links.map(link => `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                            <td style="padding:0.6rem 0.4rem;">${link.playerAlias || link.playerName || 'Jugador'}</td>
                            <td style="padding:0.6rem 0.4rem;font-weight:700;color:var(--primary);">#${link.playerNumber}</td>
                            <td style="padding:0.6rem 0.4rem;">
                                <input type="text" class="contact-phone" data-linkid="${link._id}"
                                    value="${link.parentPhone || ''}"
                                    placeholder="ej: 34600112233"
                                    style="width:100%;padding:0.4rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
                            </td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div style="margin-top:1rem;display:flex;gap:0.6rem;flex-shrink:0;">
                <button onclick="document.getElementById('setup-modal').style.display='none'" class="btn" style="flex:1;">Cancelar</button>
                <button onclick="saveContactPhones()" class="btn primary" style="flex:2;">💾 Guardar Teléfonos</button>
            </div>
        </div>`;
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error: ' + e.message, 4000);
    }
}

async function saveContactPhones() {
    const inputs = document.querySelectorAll('.contact-phone');
    const db = window._cronos_auth.db;
    showSpinner('Guardando cambios…');

    try {
        const { updateDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        for (const input of inputs) {
            const linkId = input.dataset.linkid;
            const phone  = input.value.trim().replace(/\s/g, ''); // Sin espacios
            await updateDoc(doc(db, 'cronos_player_links', linkId), { parentPhone: phone });
        }

        hideSpinner();
        showToast('✅ Teléfonos guardados correctamente', 3000);
        document.getElementById('setup-modal').style.display = 'none';
        _loadParentList(); // Recargar lista principal
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error al guardar: ' + e.message, 4000);
    }
}

window.openCoachMessaging      = openCoachMessaging;
window.openThreadWithParent    = openThreadWithParent;
window.sendMatchReportsToParents = sendMatchReportsToParents;
window._loadThreadMessages     = _loadThreadMessages;
window.openContactManager      = openContactManager;
window.saveContactPhones       = saveContactPhones;
window.saveAllMatchReportsInternal = saveAllMatchReportsInternal;

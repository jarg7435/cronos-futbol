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
            <button onclick="openUnifiedCommsMenu()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- Acciones rápidas -->
        <div style="display:flex;gap:0.5rem;margin-bottom:0.9rem;flex-shrink:0;flex-wrap:wrap;">
            <button onclick="openCoachMessaging()" class="btn"
                style="font-size:0.78rem;background:var(--glass);color:var(--text-muted);">
                🔄 Actualizar
            </button>
            <button onclick="openUnifiedCommsMenu()" class="btn"
                style="font-size:0.78rem;background:rgba(255,255,255,0.05);color:var(--text-muted);">
                🔙 Menú Principal
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

        // --- 3. NOTIFICAR A STAFF / OTROS (Fuente de la Verdad) ---
        if (emailConfig.contacts) {
            const staffNotifs = emailConfig.contacts.filter(c => c.tags.includes('notifs') && c.uid);
            for (const contact of staffNotifs) {
                const notifId = `notif_match_end_${contact.uid}_${Date.now().toString(36)}`;
                await setDoc(doc(db, 'cronos_notifications', notifId), {
                    type:           'aviso_partido_finalizado',
                    clubId:         me.clubId || null,
                    parentUid:      contact.uid,
                    matchDate:      matchDate || new Date().toLocaleDateString('es-ES'),
                    rival:          TEAM_NAMES.away || 'Rival',
                    scoreHome:      scoreHome || '0',
                    scoreAway:      scoreAway || '0',
                    message:        `📊 El partido ha finalizado. Los informes de los jugadores ya están disponibles para su revisión.`,
                    createdAt:      new Date().toISOString()
                });
            }
        }

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
        // --- NOTIFICAR A STAFF / OTROS (Fuente de la Verdad) ---
        if (emailConfig.contacts) {
            const staffNotifs = emailConfig.contacts.filter(c => c.tags.includes('notifs') && c.uid);
            for (const contact of staffNotifs) {
                const notifId = `notif_match_end_staff_${contact.uid}_${Date.now().toString(36)}`;
                await setDoc(doc(db, 'cronos_notifications', notifId), {
                    type:           'aviso_partido_finalizado',
                    clubId:         me.clubId || null,
                    parentUid:      contact.uid,
                    matchDate:      matchDate || new Date().toLocaleDateString('es-ES'),
                    rival:          TEAM_NAMES.away || 'Rival',
                    scoreHome:      scoreHome || '0',
                    scoreAway:      scoreAway || '0',
                    message:        `📊 Partido finalizado y sincronizado con la nube. Los informes técnicos han sido generados.`,
                    createdAt:      new Date().toISOString()
                });
            }
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

    // Asegurar que tenemos la config de email cargada
    if (typeof loadEmailConfig === 'function') loadEmailConfig();

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

        // --- MIGRACIÓN Y PREPARACIÓN DE DATOS ---
        if (!emailConfig.contacts) {
            emailConfig.contacts = [];
            // Migrar Director
            if (emailConfig.directorEmail) {
                emailConfig.contacts.push({
                    id: 'dir_' + Math.random().toString(36).substr(2, 4),
                    name: 'Director Deportivo',
                    email: emailConfig.directorEmail,
                    phone: emailConfig.whatsappNumber || '',
                    tags: ['reports', 'notifs']
                });
            }
            // Migrar Coordinador
            if (emailConfig.directorEmail2) {
                emailConfig.contacts.push({
                    id: 'coord_' + Math.random().toString(36).substr(2, 4),
                    name: 'Coordinador',
                    email: emailConfig.directorEmail2,
                    phone: emailConfig.whatsappNumber2 || '',
                    tags: ['reports', 'notifs']
                });
            }
        }

        const modal = document.getElementById('setup-modal');
        modal.style.display = 'flex';
        modal.innerHTML = `
        <div class="modal-content" style="width:min(98vw,850px);max-height:92vh;display:flex;flex-direction:column;gap:1rem;overflow:hidden;padding:1.4rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:1.5rem;">📱</span>
                    <h2 style="margin:0;font-size:1.2rem;font-family:'Outfit',sans-serif;">Gestión de Contactos (Fuente de la Verdad)</h2>
                </div>
                <button onclick="document.getElementById('setup-modal').style.display='none'; openUnifiedCommsMenu();" style="background:none;border:none;color:var(--text-muted);font-size:1.6rem;cursor:pointer;">✕</button>
            </div>

            <p style="font-size:0.75rem; color:var(--text-muted); margin:-0.5rem 0 0.5rem;">
                Define quién recibe los informes de partido, convocatorias y avisos del club.
            </p>
            
            <!-- 1. TABLA UNIFICADA DE CONTACTOS -->
            <div style="flex:1.2; overflow:hidden; display:flex; flex-direction:column; border:1px solid rgba(88,166,255,0.2); border-radius:12px; background:rgba(88,166,255,0.03);">
                <div style="padding:0.7rem 1rem; border-bottom:1px solid rgba(88,166,255,0.2); display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="font-size:0.85rem; color:var(--primary); margin:0; font-weight:700;">📋 Lista de Contactos (Staff y Otros)</h3>
                    <button onclick="addNewContactRow()" class="btn" style="padding:0.3rem 0.8rem; font-size:0.7rem; background:var(--primary); color:white; border:none; border-radius:6px;">
                        ➕ AÑADIR CONTACTO
                    </button>
                </div>
                
                <div style="flex:1; overflow-y:auto; padding:0.5rem;">
                    <table style="width:100%;font-size:0.75rem;border-collapse:collapse;" id="table-custom-contacts">
                        <thead>
                            <tr style="color:var(--text-muted); border-bottom:1px solid rgba(255,255,255,0.1); text-align:left;">
                                <th style="padding:0.5rem;">NOMBRE / CARGO</th>
                                <th style="padding:0.5rem;">EMAIL</th>
                                <th style="padding:0.5rem;">WHATSAPP</th>
                                <th style="padding:0.5rem;">UID (APP)</th>
                                <th style="padding:0.5rem; text-align:center;">INFORMES</th>
                                <th style="padding:0.5rem; text-align:center;">AVISOS</th>
                                <th style="padding:0.5rem; text-align:center; color:#ff5858;">EN VIVO 📡</th>
                                <th style="padding:0.5rem; text-align:center;"></th>
                            </tr>
                        </thead>
                        <tbody id="tbody-custom-contacts">
                            ${emailConfig.contacts.map(c => renderContactRowMarkup(c)).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 2. TELÉFONOS DE PADRES (POR JUGADOR) -->
            <div style="flex:1;overflow:hidden; display:flex; flex-direction:column; border:1px solid rgba(255,255,255,0.1); border-radius:12px; background:rgba(255,255,255,0.02);">
                <div style="padding:0.8rem; border-bottom:1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03);">
                    <h3 style="font-size:0.85rem; color:var(--secondary); margin:0;">👨‍👩‍👧‍👦 Contactos de Padres/Tutores</h3>
                    <span style="font-size:0.7rem; color:var(--text-muted);">${links.length} vinculados</span>
                </div>
                
                <div style="flex:1; overflow-y:auto; padding:0.5rem;">
                    <table style="width:100%;font-size:0.8rem;border-collapse:collapse;">
                        <thead>
                            <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.1);">
                                <th style="padding:0.6rem;text-align:left;">JUGADOR</th>
                                <th style="padding:0.6rem;text-align:left;">DORSAL</th>
                                <th style="padding:0.6rem;text-align:left;">WHATSAPP</th>
                                <th style="padding:0.6rem;text-align:center;color:#ff5858;">EN VIVO 📡</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${links.sort((a,b) => (a.playerNumber || 0) - (b.playerNumber || 0)).map(link => `
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                <td style="padding:0.6rem;">${link.playerAlias || link.playerName || 'Jugador'}</td>
                                <td style="padding:0.6rem;font-weight:700;color:var(--primary);">#${link.playerNumber}</td>
                                <td style="padding:0.6rem;">
                                    <input type="text" class="contact-phone" data-linkid="${link._id}"
                                        value="${link.parentPhone || ''}"
                                        placeholder="ej: 34600112233"
                                        style="width:100%;padding:0.4rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;box-sizing:border-box;">
                                </td>
                                <td style="padding:0.6rem;text-align:center;">
                                    <input type="checkbox" class="contact-live" data-linkid="${link._id}"
                                        ${link.canWatchLive ? 'checked' : ''}
                                        style="width:18px;height:18px;accent-color:#ff5858;"
                                        title="Puede ver el partido en vivo">
                                </td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div style="display:flex;gap:0.7rem;flex-shrink:0;">
                <button onclick="openUnifiedCommsMenu()" class="btn" style="flex:1;">← VOLVER</button>
                <button onclick="saveContactManagerData()" class="btn primary" style="flex:2; font-weight:bold;">💾 GUARDAR CAMBIOS</button>
            </div>
        </div>`;
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error: ' + e.message, 4000);
    }
}

async function saveContactManagerData() {
    const parentInputs = document.querySelectorAll('.contact-phone');
    const customRows   = document.querySelectorAll('.custom-contact-row');
    const db = window._cronos_auth.db;
    showSpinner('Sincronizando Fuente de la Verdad…');

    try {
        const { updateDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // 1. Guardar Teléfonos y acceso EN VIVO de Padres (en cronos_player_links)
        const liveInputs  = document.querySelectorAll('.contact-live');
        for (const input of parentInputs) {
            const linkId     = input.dataset.linkid;
            const phone      = input.value.trim().replace(/\s/g, '');
            const liveToggle = document.querySelector(`.contact-live[data-linkid="${linkId}"]`);
            const canWatch   = liveToggle ? liveToggle.checked : false;
            await updateDoc(doc(db, 'cronos_player_links', linkId), {
                parentPhone:   phone,
                canWatchLive:  canWatch
            });
        }

        // 2. Guardar Lista Unificada de Contactos (en emailConfig)
        const updatedContacts = [];
        customRows.forEach(row => {
            const tags = [];
            if (row.querySelector('.tag-reports').checked) tags.push('reports');
            if (row.querySelector('.tag-notifs').checked)  tags.push('notifs');
            if (row.querySelector('.tag-live').checked)    tags.push('live');

            updatedContacts.push({
                id:    row.dataset.id || ('c_' + Math.random().toString(36).substr(2,6)),
                name:  row.querySelector('.c-name').value.trim(),
                email: row.querySelector('.c-email').value.trim(),
                phone: row.querySelector('.c-phone').value.trim().replace(/\s/g, ''),
                uid:   row.querySelector('.c-uid').value.trim(),
                tags:  tags
            });
        });

        if (typeof emailConfig !== 'undefined') {
            emailConfig.contacts = updatedContacts;
            
            // Mantener compatibilidad con campos antiguos por si acaso se usan en otros scripts legacy
            const firstReport = updatedContacts.find(c => c.tags.includes('reports'));
            if (firstReport) {
                emailConfig.directorEmail = firstReport.email;
                emailConfig.whatsappNumber = firstReport.phone;
            }

            if (typeof cloudSet === 'function') {
                await cloudSet('cronos_email_config', JSON.stringify(emailConfig));
            }
        }

        hideSpinner();
        showToast('✅ Fuente de la Verdad actualizada', 3000);
        openUnifiedCommsMenu();
        if (typeof _loadParentList === 'function') _loadParentList(); 
        
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error al guardar: ' + e.message, 4000);
    }
}

// ── FUNCIONES AUXILIARES PARA EL GESTOR DE CONTACTOS ──────────────────

function renderContactRowMarkup(c = {}) {
    const isReports = (c.tags || []).includes('reports');
    const isNotifs  = (c.tags || []).includes('notifs');
    const isLive    = (c.tags || []).includes('live');
    const id = c.id || ('new_' + Date.now());

    return `
    <tr class="custom-contact-row" data-id="${id}" style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:0.4rem;">
            <input type="text" class="c-name" value="${c.name || ''}" placeholder="Nombre / Cargo"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="email" class="c-email" value="${c.email || ''}" placeholder="email@ejemplo.com"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="tel" class="c-phone" value="${c.phone || ''}" placeholder="34600000000"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="text" class="c-uid" value="${c.uid || ''}" placeholder="ID App (opcional)"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-muted);font-size:0.7rem;">
        </td>
        <td style="padding:0.4rem; text-align:center;">
            <input type="checkbox" class="tag-reports" ${isReports ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem; text-align:center;">
            <input type="checkbox" class="tag-notifs" ${isNotifs ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem; text-align:center;">
            <input type="checkbox" class="tag-live" ${isLive ? 'checked' : ''}
                style="width:16px;height:16px;accent-color:#ff5858;"
                title="Puede ver los partidos en vivo">
        </td>
        <td style="padding:0.4rem; text-align:center;">
            <button onclick="this.closest('tr').remove()" style="background:none; border:none; color:#ff5858; cursor:pointer; font-size:1rem;" title="Eliminar">🗑️</button>
        </td>
    </tr>`;
}

window.addNewContactRow = () => {
    const tbody = document.getElementById('tbody-custom-contacts');
    if (!tbody) return;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = `<table>${renderContactRowMarkup({})}</table>`;
    const newRow = tempDiv.querySelector('tr');
    tbody.appendChild(newRow);
    newRow.querySelector('.c-name').focus();
};

async function openUnifiedCommsMenu() {
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(95vw,480px);max-height:90vh;display:flex;flex-direction:column;gap:1.5rem;padding:1.8rem;background:linear-gradient(145deg, #0f1218 0%, #0a0e14 100%);border:1px solid rgba(255,255,255,0.1);box-shadow:0 20px 40px rgba(0,0,0,0.6);">
        
        <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0;margin-bottom:0.5rem;">
            <div style="display:flex; align-items:center; gap:12px;">
                <div style="width:40px;height:40px;background:rgba(88,166,255,0.1);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;">💬</div>
                <h2 style="margin:0;font-size:1.4rem;font-family:'Outfit',sans-serif;color:white;letter-spacing:0.5px;">Comunicaciones</h2>
            </div>
            <button onclick="openSetupModal()" 
                style="background:none;border:none;color:var(--text-muted);font-size:1.8rem;cursor:pointer;line-height:1;transition:color 0.2s;"
                onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--text-muted)'">✕</button>
        </div>

        <div style="display:grid; grid-template-columns:1fr; gap:0.9rem; flex:1; overflow-y:auto; padding-right:5px; scrollbar-width:thin;">
            
            <button onclick="openCoachMessaging()" class="btn-comms-card">
                <span class="icon">💬</span>
                <div class="content">
                    <div class="title">Mensajería con Padres</div>
                    <div class="desc">Chat directo e hilos de mensajes</div>
                </div>
            </button>

            <button onclick="openConvocationModal()" class="btn-comms-card" style="--color: #3fb950; --bg: rgba(63,185,80,0.1);">
                <span class="icon">📲</span>
                <div class="content">
                    <div class="title" style="color:#3fb950;">Enviar Convocatoria</div>
                    <div class="desc">Publicar y notificar el próximo partido</div>
                </div>
            </button>

            <button onclick="openTrainingNotification()" class="btn-comms-card" style="--color: var(--secondary); --bg: rgba(240,136,62,0.1);">
                <span class="icon">📅</span>
                <div class="content">
                    <div class="title" style="color:var(--secondary);">Info Entrenamiento</div>
                    <div class="desc">Notificar horarios y cambios de sesión</div>
                </div>
            </button>

            <button onclick="openClubReports()" class="btn-comms-card" style="--color: #ffa500; --bg: rgba(255,165,0,0.1);">
                <span class="icon">📊</span>
                <div class="content">
                    <div class="title" style="color:#ffa500;">Informes de Club</div>
                    <div class="desc">Ver rendimiento global y estadísticas</div>
                </div>
            </button>

            <button onclick="openContactManager()" class="btn-comms-card" style="--color: #7d8590; --bg: rgba(255,255,255,0.05);">
                <span class="icon">📱</span>
                <div class="content">
                    <div class="title">Gestión de Contactos</div>
                    <div class="desc">Emails y teléfonos de staff/padres</div>
                </div>
            </button>

        </div>

    </div>
    <style>
        .btn-comms-card {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 1.1rem;
            background: var(--bg, rgba(88,166,255,0.08));
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 14px;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer;
            width: 100%;
            text-decoration: none;
            color: inherit;
        }
        .btn-comms-card:hover {
            background: var(--bg, rgba(88,166,255,0.15));
            border-color: var(--color, var(--primary));
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.3);
        }
        .btn-comms-card .icon {
            font-size: 1.8rem;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .btn-comms-card .content {
            text-align: left;
            flex: 1;
        }
        .btn-comms-card .title {
            font-weight: 700;
            color: var(--color, var(--primary));
            font-size: 1.05rem;
            margin-bottom: 2px;
        }
        .btn-comms-card .desc {
            font-size: 0.78rem;
            color: var(--text-muted);
            line-height: 1.3;
        }
    </style>`;
}

window.openCoachMessaging      = openCoachMessaging;
window.openThreadWithParent    = openThreadWithParent;
window.sendMatchReportsToParents = sendMatchReportsToParents;
window._loadThreadMessages     = _loadThreadMessages;
window.openContactManager      = openContactManager;
window.saveContactManagerData  = saveContactManagerData;
window.saveAllMatchReportsInternal = saveAllMatchReportsInternal;
window.openUnifiedCommsMenu    = openUnifiedCommsMenu;

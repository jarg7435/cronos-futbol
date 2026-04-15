// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Sistema de Comunicación Entrenador ↔ Padres v1.0
//  Colecciones Firestore:
//    cronos_player_links/{clubId}_{playerNumber} → vincula padre con jugador
//    cronos_messages/{coachUid}_{parentUid}      → hilo de mensajes
//    cronos_player_reports/{reportId}            → informes post-partido
// ════════════════════════════════════════════════════════════════════

// ── Función auxiliar para cargar módulo Firestore ─────────────────────
async function _cFS() {
    const module = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...module, db: window._cronos_auth?.db };
}

// ════════════════════════════════════════════════════════════════════
//  PANEL PRINCIPAL DE MENSAJES (vista entrenador)
// ════════════════════════════════════════════════════════════════════
async function openCoachMessaging() {
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
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

        <!-- Barra de selección múltiple -->
        <div id="bulk-msg-bar" style="display:none;background:rgba(88,166,255,0.08);
             border:1px solid rgba(88,166,255,0.25);border-radius:10px;
             padding:0.6rem 0.9rem;margin-bottom:0.7rem;flex-shrink:0;
             display:flex;align-items:center;gap:0.7rem;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:0.4rem;
                          font-size:0.8rem;font-weight:700;cursor:pointer;color:var(--primary);">
                <input type="checkbox" id="chk-select-all" style="width:17px;height:17px;"
                    onchange="toggleSelectAllParents(this.checked)">
                Seleccionar todos
            </label>
            <span id="bulk-count" style="font-size:0.75rem;color:var(--text-muted);flex:1;">
                0 seleccionados
            </span>
            <button onclick="openBulkMessageComposer()"
                style="padding:0.4rem 0.9rem;background:var(--primary);border:none;
                       border-radius:7px;color:#0a0e14;font-weight:700;
                       font-size:0.78rem;cursor:pointer;">
                ✉️ Mensaje grupal
            </button>
        </div>

        <div id="coach-parent-list" style="flex:1;overflow-y:auto;">
            <p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando padres vinculados…</p>
        </div>
    </div>`;

    await _loadParentList();
}

async function _loadParentList() {
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    const body = document.getElementById('coach-parent-list');
    if (!body) return;

    // Asegurar que tenemos la configuración de contactos manuales cargada
    if (typeof loadEmailConfig === 'function') await loadEmailConfig();

    try {
        const { db, collection, getDocs, query, where } = await _cFS();

        // Obtener vínculos jugador-padre de este club (antes era solo por coachUid)
        const linksSnap = await getDocs(query(
            collection(db, 'cronos_player_links'),
            where('clubId', '==', me.clubId)
        ));
        const links = [];
        linksSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

        if (!links.length && (!emailConfig.contacts || !emailConfig.contacts.length)) {
            body.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);padding:3rem 1rem;">
                👥 No hay padres vinculados ni contactos configurados aún.<br>
                <span style="font-size:0.8rem;margin-top:0.5rem;display:block;">
                    Agrega contactos en "Gestión de Contactos" o vincula padres desde el panel de admin.
                </span>
            </div>`;
            return;
        }

        // --- FUSIÓN CON CONTACTOS MANUALES Y STAFF ---
        // Obtenemos los contactos de la "Fuente de la Verdad" (emailConfig)
        const contacts = (typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : [];
        console.log("Merging contacts from emailConfig:", contacts.length);

        contacts.forEach(c => {
            // Buscamos si ya existe en los links de Firestore para no duplicar
            const exists = links.find(l => 
                (c.email && l.parentEmail === c.email) || 
                (c.phone && (l.parentPhone === c.phone || l.parentWA === c.phone || l.phone === c.phone)) ||
                (c.uid && (l.parentUid === c.uid || l.uid === c.uid))
            );
            
            if (!exists) {
                links.push({
                    _id:            c.id || ('m_' + Math.random().toString(36).substr(2,5)),
                    isManual:       true,
                    type:           c.type || 'staff', // staff o parent
                    parentUid:      c.uid || c.id,
                    parentEmail:    c.email || '',
                    parentPhone:    c.phone || '',
                    parentWA:       c.phone || '',
                    playerAlias:    c.type === 'staff' ? c.name : (c.player || c.name || 'Familiar'),
                    playerName:     c.type === 'staff' ? c.name : (c.player || c.name || 'Familiar'),
                    playerNumber:   c.type === 'staff' ? 'STAFF' : '—'
                });
            } else {
                // Si ya existe en Firestore, le aseguramos el tipo para que salga su icono correcto
                if (c.type) exists.type = c.type;
            }
        });

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
                ? new Date(thread.lastMessageAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                : '';

            const typeIcon = link.type === 'staff' ? '🏢' : '👨‍👩‍👧';
            const displayNum = link.playerNumber && link.playerNumber !== '—' ? `#${link.playerNumber}` : '';
            const isUnread = unread > 0;

            return `
            <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.6rem;">
                <!-- Checkbox de selección -->
                <input type="checkbox" class="parent-select-chk"
                    data-parent-uid="${link.parentUid || ''}"
                    data-parent-email="${link.parentEmail || ''}"
                    data-player="${link.playerAlias || link.playerName || ''}"
                    data-player-num="${link.playerNumber || ''}"
                    data-parent-wa="${link.parentPhone || link.parentWA || ''}"
                    style="width:18px;height:18px;flex-shrink:0;accent-color:var(--primary);"
                    onchange="updateBulkCount()">
                <!-- Fila del contacto -->
                <div onclick="openThreadWithParent('${link.parentUid || link._id}','${link.parentEmail}',
                             '${link.playerNumber}','${link.playerAlias || link.playerName || ''}',
                             '${link.parentPhone || link.parentWA || ''}')"
                    style="flex:1;background:var(--glass);
                           border:1px solid ${isUnread ? 'rgba(88,166,255,0.5)' : 'var(--glass-border)'};
                           border-radius:10px;padding:0.85rem 1rem;
                           cursor:pointer;display:flex;justify-content:space-between;
                           align-items:center;gap:0.8rem;transition:all 0.15s;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:0.88rem;margin-bottom:0.15rem;">
                            ${typeIcon} ${link.playerAlias || link.playerName || 'Contacto'}
                            <span style="color:var(--primary);">${displayNum}</span>
                        </div>
                        <div style="font-size:0.73rem;color:var(--text-muted);margin-bottom:0.2rem;">
                            ${link.parentEmail || 'Sin email'}
                            ${link.parentPhone || link.parentWA ? ` · 📱 ${link.parentPhone || link.parentWA}` : ''}
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
                </div>
            </div>`;
        }).join('');

        // Mostrar barra de selección múltiple
        const bar = document.getElementById('bulk-msg-bar');
        if (bar) bar.style.display = 'flex';

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
//  ENVIAR INFORMES DE PARTIDO A PADRES Y STAFF
// ════════════════════════════════════════════════════════════════════
async function sendMatchReportsToParents() {
    const isSetupMode = !window.players || !window.players.length;
    let selectedPlayerIds = [];
    let mergedContacts = [];
    let filterCriteria = { ids: [], numbers: [] };

    // 1. Mostrar modal inmediatamente para dar feedback (Cargando...)
    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,400px); text-align:center; padding:2rem;">
        <div class="spinner" style="margin:0 auto 1rem;"></div>
        <p style="color:white;font-size:0.9rem;">Cargando lista de destinatarios...</p>
    </div>`;

    try {
        const me = window._cronosCurrentUser;
        if (!me) {
            showToast('⚠️ Usuario no identificado. Por favor, recarga.', 4000);
            modal.style.display = 'none';
            return;
        }

        if (isSetupMode) {
            // 1. Obtener convocados
            const convRows = document.querySelectorAll('.conv-row.conv-selected');
            const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}');
            
            // Intentamos detectar el modo de varias formas (global o por el título si falla)
            let mode = (typeof currentMode !== 'undefined') ? currentMode : (window.currentMode || 'f11');
            
            const selectedPlayers = [];
            convRows.forEach(row => {
                const idx = row.dataset.index;
                let p = roster[mode] ? roster[mode][idx] : null;
                
                // Si no lo encuentra en el modo actual, probamos en el otro (f7 <-> f11)
                if (!p) {
                    const altMode = mode === 'f11' ? 'f7' : 'f11';
                    p = roster[altMode] ? roster[altMode][idx] : null;
                }

                if (p) {
                    selectedPlayers.push(p);
                } else {
                    // FALLBACK MAESTRO: Si no hay datos en el roster, extraemos el número del DOM
                    const numSpan = row.querySelector('span[style*="font-weight:bold"]');
                    const num = numSpan ? parseInt(numSpan.textContent) : null;
                    if (num) {
                        selectedPlayers.push({ id: `J-${idx+1}`, number: num, alias: 'Jugador ' + num });
                    }
                }
            });
            
            // Coleccionamos tanto IDs (J-01) como Números (10) para máxima compatibilidad
            const selectedIds = selectedPlayers.map(p => p.id).filter(Boolean);
            const selectedNums = selectedPlayers.map(p => p.number).filter(n => n != null);

            console.log("[Reports] Detección Inteligente:", {
                rowsFound: convRows.length,
                playersMatched: selectedPlayers.length,
                modeUsed: mode,
                nums: selectedNums
            });

            if (selectedPlayers.length === 0 && convRows.length > 0) {
                // Si hay filas de convocatoria pero no pudimos extraer datos, 
                // hacemos un último intento solo con los números para no bloquear al usuario
                convRows.forEach((row, i) => {
                    const numText = row.innerText.match(/\d+/);
                    if (numText) selectedNums.push(parseInt(numText[0]));
                });
            }

            if (selectedPlayers.length === 0 && selectedNums.length === 0) {
                showToast('⚠️ Primero selecciona jugadores para la convocatoria.', 4000);
                if (typeof openConvocationModal === 'function') openConvocationModal();
                return;
            }

            filterCriteria = { ids: selectedIds, numbers: selectedNums };

            // 2. Obtener TODA la base de contactos (Manuales + Firestore)
            if (typeof loadEmailConfig === 'function') await loadEmailConfig();
            const contacts = (typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : [];
            
            try {
                const { db, collection, getDocs, query, where } = await _cFS();
                const linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('clubId', '==', me.clubId || '')));
                const links = [];
                linksSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

                mergedContacts = [...contacts];
                links.forEach(l => {
                    const exists = mergedContacts.find(c => 
                        (l.parentUid && c.uid === l.parentUid) || 
                        (l.parentEmail && c.email === l.parentEmail) ||
                        (l.parentPhone && c.phone === l.parentPhone)
                    );
                    if (!exists) {
                        mergedContacts.push({
                            id: l._id,
                            type: 'parent',
                            name: l.parentName || l.playerAlias || 'Familiar',
                            player: l.playerAlias || l.playerName || 'Jugador',
                            playerId: l.playerId, 
                            playerNumber: l.playerNumber,
                            uid: l.parentUid,
                            email: l.parentEmail,
                            phone: l.parentPhone,
                            tags: ['rpt']
                        });
                    } else {
                        if (!exists.playerId) exists.playerId = l.playerId;
                        if (!exists.playerNumber) exists.playerNumber = l.playerNumber;
                    }
                });
            } catch (e) {
                console.warn("Reports: Fallback to manual contacts:", e);
                mergedContacts = [...contacts];
            }
        }

        // 3. Renderizar modal oficial (NUEVO DISEÑO PREMIUM)
        modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,560px);max-height:92vh;
             display:flex;flex-direction:column;gap:0;padding:0;background:#0d1117;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">

            <!-- Header -->
            <div style="padding:1.5rem;background:linear-gradient(to right, #161b22, #0d1117);
                        border-bottom:1px solid var(--glass-border);flex-shrink:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <h3 style="margin:0;font-size:1.2rem;color:var(--primary);display:flex;align-items:center;gap:0.6rem;">
                            📊 Informes de Rendimiento
                        </h3>
                        <p style="margin:0;font-size:0.75rem;color:var(--text-muted);margin-top:0.3rem;">
                            ${isSetupMode ? 'Selección previa para el despacho automático' : 'Envía el reporte del partido a los padres autorizados'}
                        </p>
                    </div>
                    <button onclick="${isSetupMode ? 'openConvocationModal()' : "document.getElementById('setup-modal').style.display='none'"}"
                        style="background:rgba(255,255,255,0.05);border:none;color:var(--text-muted);
                               width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;
                               align-items:center;justify-content:center;transition:all 0.2s;"
                        onmouseover="this.style.background='rgba(255,255,255,0.1)';this.style.color='white';">✕</button>
                </div>
            </div>

            <!-- Content Area -->
            <div style="flex:1;overflow-y:auto;padding:1.5rem;display:flex;flex-direction:column;gap:1.2rem;">
                
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="font-size:0.7rem;font-weight:800;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;">
                        Destinatarios Seleccionados
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button onclick="sharedSelectAll(true, 'rpt')"
                            style="font-size:0.65rem;padding:0.3rem 0.7rem;background:rgba(88,166,255,0.1);
                                   border:1px solid rgba(88,166,255,0.2);border-radius:6px;
                                   color:var(--primary);cursor:pointer;font-weight:600;">✓ Todos</button>
                        <button onclick="sharedSelectAll(false, 'rpt')"
                            style="font-size:0.65rem;padding:0.3rem 0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                                   color:var(--text-muted);cursor:pointer;font-weight:600;">✗ Ninguno</button>
                    </div>
                </div>

                <div id="rpt-recipients-list" style="display:grid;grid-template-columns:1fr;gap:0.6rem;">
                    ${isSetupMode ? buildConvocationRecipientsHTML(filterCriteria, 'rpt', mergedContacts) : sharedBuildRecipientsHTML(null, 'rpt')}
                </div>

                <div style="background:rgba(255,165,0,0.05);border:1px solid rgba(255,165,0,0.1);
                            border-radius:10px;padding:0.8rem;display:flex;gap:0.7rem;align-items:center;">
                    <span style="font-size:1.2rem;">💡</span>
                    <p style="margin:0;font-size:0.72rem;color:#ffb74d;line-height:1.4;">
                        El <strong>Staff Directivo</strong> recibirá un resumen global del partido. Los <strong>Padres</strong> recibirán el informe individual detallado de su hijo/a.
                    </p>
                </div>
            </div>

            <div id="rpt-msg" style="padding:0.5rem 1.5rem;font-size:0.8rem;text-align:center;"></div>

            <!-- Footer Buttons -->
            <div style="padding:1.2rem 1.5rem;background:#161b22;border-top:1px solid var(--glass-border);
                        display:flex;gap:0.8rem;flex-shrink:0;">
                <button onclick="${isSetupMode ? 'openConvocationModal()' : "document.getElementById('setup-modal').style.display='none'"}" 
                    class="btn" style="flex:1;background:rgba(255,255,255,0.03);color:var(--text-muted);border:1px solid var(--glass-border);">
                    Cancelar
                </button>
                ${isSetupMode ? `
                    <button onclick="saveMatchReportPreselection()" class="btn primary"
                        style="flex:2;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.3);
                               color:#3fb950;font-weight:700;box-shadow:0 0 15px rgba(63,185,80,0.1);">
                        💾 GUARDAR CONFIGURACIÓN
                    </button>
                ` : `
                    <button onclick="_executeReportsSend('internal')" class="btn primary"
                        style="flex:1.5;background:var(--primary);color:#0d1117;font-weight:700;">
                        🚀 Enviar ahora
                    </button>
                `}
            </div>
        </div>`;

    } catch (err) {
        console.error("Error in reports modal:", err);
        showToast('⚠️ Error al cargar informes: ' + err.message, 5000);
        modal.style.display = 'none';
    }
}

// Nueva función para filtrar destinatarios SOLO según los convocados
function buildConvocationRecipientsHTML(filterCriteria, prefix = 'rpt', allContacts = null) {
    const contacts = allContacts || ((typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : []);
    const staff = contacts.filter(c => c.type !== 'parent');
    
    const { ids, numbers } = filterCriteria || { ids: [], numbers: [] };

    // Filtramos los padres: solo si su playerId o playerNumber coincide con la convocatoria
    const activeParents = contacts.filter(c => {
        if (c.type !== 'parent') return false;
        
        // 1. Intentar por ID único (J-01, etc)
        const matchById = c.playerId && ids.includes(c.playerId);
        if (matchById) return true;

        // 2. Intentar por Número de dorsal como fallback
        const matchByNum = c.playerNumber != null && numbers.includes(parseInt(c.playerNumber));
        if (matchByNum) return true;

        return false;
    });

    console.log(`[Reports] Mostrando ${staff.length} staff y ${activeParents.length} padres.`);

    const allToShow = [...staff, ...activeParents];

    if (!allToShow.length) {
        return `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:1rem;">
            ⚠️ No hay contactos vinculados a los jugadores convocados.
        </div>`;
    }

    // Cargar preselección guardada
    let savedIds = JSON.parse(localStorage.getItem(`cronos_match_rpt_selection`) || 'null');

    return allToShow.map(c => {
        const checked = savedIds ? savedIds.includes(c.id) : (c.tags || []).includes(prefix);
        const typeIcon = c.type === 'staff' ? '🏢' : '👨‍👩‍👧';
        const typeLabel = c.type === 'staff' ? 'Staff' : 'Padre/Madre';
        const accent = c.type === 'staff' ? 'var(--primary)' : '#f0883e';

        return `
        <label style="display:flex;align-items:center;gap:0.8rem;background:rgba(255,255,255,0.03);
                      border:1px solid ${checked ? accent : 'rgba(255,255,255,0.08)'};
                      border-radius:12px;padding:0.8rem 1rem;cursor:pointer;transition:all 0.2s;
                      ${checked ? `box-shadow:inset 0 0 10px ${accent}1a;` : ''}">
            <input type="checkbox" class="${prefix}-recipient-chk" data-id="${c.id}" ${checked ? 'checked' : ''}
                style="width:20px;height:20px;accent-color:${accent};">
            
            <div style="flex:1;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.15rem;">
                    <span style="font-weight:700;font-size:0.88rem;color:white;">${c.name || 'Sin nombre'}</span>
                    <span style="font-size:0.6rem;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.05);color:var(--text-muted);font-weight:700;text-transform:uppercase;">
                        ${typeLabel}
                    </span>
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);display:flex;align-items:center;gap:0.4rem;">
                    ${typeIcon} ${c.type === 'staff' ? 'Personal del club' : `Tutor de ${c.player || 'Jugador'}`}
                    ${c.playerNumber && c.playerNumber !== '—' ? `<span style="color:${accent};font-weight:700;">#${c.playerNumber}</span>` : ''}
                </div>
            </div>
        </label>`;
    }).join('');
}

window.saveMatchReportPreselection = function() {
    const ids = Array.from(document.querySelectorAll('.rpt-recipient-chk:checked')).map(chk => chk.dataset.id);
    localStorage.setItem('cronos_match_rpt_selection', JSON.stringify(ids));
    showToast('✅ Configuración de informes guardada para este partido', 3000);
    // En lugar de cerrar el modal, volvemos a la pantalla de convocatoria
    if (typeof openConvocationModal === 'function') {
        openConvocationModal();
    } else {
        document.getElementById('setup-modal').style.display = 'none';
    }
};

// Generador de textos para no duplicar lógica
function _buildGlobalReportText() {
    const scoreHome = document.getElementById('score-home')?.textContent || '0';
    const scoreAway = document.getElementById('score-away')?.textContent || '0';
    const matchDate = new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'});
    const homePlayers = window.players.filter(p => p.team === 'home');
    
    let text = `📊 *RESUMEN GLOBAL DEL PARTIDO*\n━━━━━━━━━━━━━━━━\n`;
    text += `📅 ${matchDate}\n`;
    text += `⚽ ${TEAM_NAMES?.home||'Local'} *${scoreHome}* - *${scoreAway}* ${TEAM_NAMES?.away||'Visitante'}\n━━━━━━━━━━━━━━━━\n\n`;
    
    homePlayers.forEach(p => {
        const cardIcon = p.cards === 'amarilla' ? '🟨' : p.cards === 'roja' ? '🟥' : '—';
        text += `👤 ${p.name} (#${p.number}) - ${window.formatTime ? window.formatTime(p.time||0) : p.time||0} min\n`;
        text += `   ⚽ Goles: ${p.goals||0} | 🃏 Thrj: ${cardIcon} ${p.injured ? '| 🚑 Lesión' : ''}\n`;
    });
    return text + `\n_Cronos Fútbol · Dirección Deportiva_`;
}

function _buildIndividualReportText(player, scoreHome, scoreAway, matchDate) {
    const cardIcon = player.cards === 'amarilla' ? '🟨 Amarilla' : player.cards === 'roja' ? '🟥 Roja' : '—';
    const minutesPlayed = window.formatTime ? window.formatTime(player.time||0) : player.time||0;
    
    return `📊 *INFORME INDIVIDUAL DE PARTIDO*\n` +
           `━━━━━━━━━━━━━━━━\n` +
           `📅 ${matchDate}\n` +
           `⚽ ${TEAM_NAMES?.home||'Local'} *${scoreHome}* - *${scoreAway}* ${TEAM_NAMES?.away||'Visitante'}\n` +
           `━━━━━━━━━━━━━━━━\n` +
           `👤 *${player.name}* — Dorsal ${player.number}\n\n` +
           `⏱️ Minutos jugados: *${minutesPlayed}*\n` +
           `⚽ Goles: *${player.goals || 0}*\n` +
           `🃏 Tarjetas: *${cardIcon}*\n` +
           (player.injured ? `🚑 *LESIONADO*\n` : '') +
           `━━━━━━━━━━━━━━━━\n` +
           `_Cronos Fútbol · Informe automático_`;
}

// Ejecutor unificado
window._executeReportsSend = async function(method) {
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    const recipients = sharedGetSelectedRecipients('rpt');
    if (!recipients.length) {
        showToast('⚠️ Selecciona al menos un destinatario.', 3000);
        return;
    }

    const msgEl = document.getElementById('rpt-msg');
    if (msgEl) {
        msgEl.style.color = 'var(--primary)';
        msgEl.textContent = 'Procesando informes...';
    }

    const { db, collection, getDocs, query, where, doc, getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();
    
    // Obtener vínculos (solo sirve para saber qué padre es de qué jugador para Internal Envío)
    const linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('clubId', '==', me.clubId)));
    const links = [];
    linksSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

    const scoreHome = document.getElementById('score-home')?.textContent || '0';
    const scoreAway = document.getElementById('score-away')?.textContent || '0';
    const matchDate = new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'});
    const homePlayers = window.players.filter(p => p.team === 'home');
    
    const globalText = _buildGlobalReportText();
    let sentCount = 0;

    // ----- MODO WHATSAPP -----
    if (method === 'wa') {
        const toSend = recipients.filter(r => r.phone);
        if (!toSend.length) { showToast('⚠️ Ningún seleccionado con WA configurado.',3000); return; }
        
        toSend.forEach((r, i) => {
            setTimeout(() => {
                let text = globalText;
                if (r.type === 'parent') {
                    // Try to deduce player from label, or use links
                    let matchedPlayer = null;
                    const link = links.find(l => l.parentPhone === r.phone || (l.parentUid && r.id === l.parentUid));
                    if (link) {
                        matchedPlayer = homePlayers.find(p => String(p.number) === String(link.playerNumber));
                    } else if (r.label.includes('(')) {
                        const extractedName = r.label.match(/\((.*?)\)/)[1];
                        matchedPlayer = homePlayers.find(p => p.name === extractedName || p.alias === extractedName);
                    }
                    if (matchedPlayer) {
                        text = _buildIndividualReportText(matchedPlayer, scoreHome, scoreAway, matchDate);
                    }
                }
                window.open(`https://wa.me/${r.phone}?text=${encodeURIComponent(text)}`, '_blank');
            }, i * 800);
        });
        showToast('📱 Abriendo pestañas de WhatsApp...', 3000);
        if (msgEl) msgEl.textContent = 'Completado.';
        setTimeout(() => document.getElementById('setup-modal').style.display='none', 2000);
        return;
    }

    // ----- MODO EMAIL -----
    if (method === 'email') {
        const toSend = recipients.filter(r => r.email);
        if (!toSend.length) { showToast('⚠️ Ningún seleccionado con Email configurado.',3000); return; }
        
        toSend.forEach((r, i) => {
            setTimeout(() => {
                let text = globalText;
                let subject = encodeURIComponent(`📊 Informe Global de Partido — ${matchDate}`);
                if (r.type === 'parent') {
                    let matchedPlayer = null;
                    const link = links.find(l => l.parentEmail === r.email || (l.parentUid && r.id === l.parentUid));
                    if (link) matchedPlayer = homePlayers.find(p => String(p.number) === String(link.playerNumber));
                    
                    if (matchedPlayer) {
                        text = _buildIndividualReportText(matchedPlayer, scoreHome, scoreAway, matchDate);
                        subject = encodeURIComponent(`📊 Informe Individual - ${matchedPlayer.name} — ${matchDate}`);
                    }
                }
                const body = encodeURIComponent(text.replace(/[*_]/g, ''));
                window.open(`mailto:${r.email}?subject=${subject}&body=${body}`, '_blank');
            }, i * 800);
        });
        showToast('📧 Abriendo clientes de correo...', 3000);
        if (msgEl) msgEl.textContent = 'Completado.';
        setTimeout(() => document.getElementById('setup-modal').style.display='none', 2000);
        return;
    }

    // ----- MODO INTERNO -----
    showSpinner('Enviando informes internamente...');
    for (const r of recipients) {
        if (r.type === 'staff') {
            // Enviar notificación global al UID del staff si lo tiene
            // Recipient ID for staff might be custom ID or UID... actually emailConfig staff .uid is what we want.
            // Let's check if there's a matching contact in emailConfig with .uid
            let uidToNotify = null;
            if (typeof emailConfig !== 'undefined' && emailConfig.contacts) {
                const c = emailConfig.contacts.find(x => x.id === r.id || x.phone === r.phone || x.email === r.email);
                if (c && c.uid) uidToNotify = c.uid;
            }
            if (uidToNotify) {
                await setDoc(doc(db, 'cronos_notifications', `notif_matchsglobe_${uidToNotify}_${Date.now().toString(36)}`), {
                    type:           'aviso_partido_finalizado',
                    clubId:         me.clubId || null,
                    parentUid:      uidToNotify,
                    matchDate:      matchDate,
                    rival:          TEAM_NAMES.away || 'Rival',
                    scoreHome, scoreAway,
                    message:        globalText.replace(/[*_]/g,''),
                    createdAt:      new Date().toISOString()
                });
                sentCount++;
            }
        } 
        else if (r.type === 'parent') {
            // Find matched link
            const link = links.find(l => (r.id && r.id.includes('p_') === false ? l.parentUid === r.id : false)
                                     || l.parentEmail === r.email 
                                     || l.parentPhone === r.phone);
            if (!link) continue;
            
            const player = homePlayers.find(p => String(p.number) === String(link.playerNumber));
            if (!player) continue;

            const reportText = _buildIndividualReportText(player, scoreHome, scoreAway, matchDate);

            // Save in cronos_player_reports (for UI queries)
            const reportId = `rpt_${link.playerNumber}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_player_reports', reportId), {
                reportId,
                playerNumber:   link.playerNumber,
                playerAlias:    link.playerAlias || player.name,
                parentUid:      link.parentUid,
                coachUid:       me.uid, coachEmail: me.email,
                clubId:         me.clubId || null,
                matchDate, rival: TEAM_NAMES.away,
                scoreHome, scoreAway,
                minutesPlayed: window.formatTime ? window.formatTime(player.time||0) : player.time||0,
                goals: player.goals || 0,
                cards: player.cards || 'ninguna',
                injured: player.injured || false,
                history: player.history || [],
                createdAt: new Date().toISOString(),
            });

            // Send via Thread Message
            const threadId = `${me.uid}_${link.parentUid}`;
            const threadSnap = await getDoc(doc(db, 'cronos_messages', threadId));
            const msgEntry = { sender: 'coach', text: reportText, timestamp: new Date().toISOString(), type: 'report' };
            if (threadSnap.exists()) {
                await updateDoc(doc(db, 'cronos_messages', threadId), {
                    messages: arrayUnion(msgEntry),
                    lastMessage: '📊 Informe de partido enviado',
                    lastMessageAt: msgEntry.timestamp, unreadByParent: (threadSnap.data().unreadByParent||0) + 1
                });
            } else {
                await setDoc(doc(db, 'cronos_messages', threadId), {
                    threadId, coachUid: me.uid, coachEmail: me.email,
                    parentUid: link.parentUid, parentEmail: link.parentEmail,
                    messages: [msgEntry], lastMessage: '📊 Informe de partido enviado',
                    lastMessageAt: msgEntry.timestamp, unreadByCoach: 0, unreadByParent: 1
                });
            }

            // Also a notification for the parent
            await setDoc(doc(db, 'cronos_notifications', `notif_rpt_${link.playerNumber}_${Date.now().toString(36)}`), {
                type: 'informe_partido', clubId: me.clubId || null,
                parentUid: link.parentUid, playerNumber: link.playerNumber,
                rival: TEAM_NAMES.away, scoreHome, scoreAway,
                minutesPlayed: window.formatTime ? window.formatTime(player.time||0) : player.time||0,
                goals: player.goals || 0, cards: player.cards || 'ninguna',
                injured: player.injured || false, createdAt: new Date().toISOString()
            });

            sentCount++;
        }
    }
    hideSpinner();

    if (msgEl) {
        msgEl.style.color = '#3fb950';
        msgEl.textContent = `✅ Enviado con éxito a ${sentCount} destinatario(s).`;
    }
    showToast(`✅ Informes enviados (${sentCount})`, 4000);
    setTimeout(() => { document.getElementById('setup-modal').style.display='none'; }, 2000);
}

// ── Despacho automático de informes (Interno) ──────────────────────────
async function autoDispatchMatchReports() {
    const me = window._cronosCurrentUser;
    if (!me || !window.players) return;

    try {
        const { setDoc, doc, collection, getDocs, query, where, updateDoc, arrayUnion } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth.db;

        const scoreHome = document.getElementById('score-home')?.textContent || '0';
        const scoreAway = document.getElementById('score-away')?.textContent || '0';
        const rivalName = TEAM_NAMES.away || 'Rival';
        const matchDate = new Date().toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
        const homePlayers = window.players.filter(p => p.team === 'home');

        // 1. Obtener links y contactos
        const linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('clubId', '==', me.clubId || '')));
        const links = [];
        linksSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

        if (typeof loadEmailConfig === 'function') await loadEmailConfig();
        const contacts = (typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : [];

        // --- MEJORA: COMPROBAR PRE-SELECCIÓN DEL PARTIDO ---
        const preSelectionIds = JSON.parse(localStorage.getItem('cronos_match_rpt_selection') || 'null');
        
        function isRecipientAuthorized(contact) {
            if (preSelectionIds) {
                return preSelectionIds.includes(contact.id);
            }
            return (contact.tags || []).includes('rpt');
        }

        // --- FASE A: INFORME GLOBAL (STAFF + ENTRENADOR) ---
        const globalText = `📊 *INFORME GLOBAL DE PARTIDO*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📅 ${matchDate}\n` +
                          `⚽ ${TEAM_NAMES.home} ${scoreHome} - ${scoreAway} ${rivalName}\n\n` +
                          `Informes individuales generados y enviados a padres autorizados.\n` +
                          `_Cronos Fútbol_`;

        // Destinatarios Staff con tag 'rpt' (Informes)
        const staffToNotify = contacts.filter(c => c.type !== 'parent' && isRecipientAuthorized(c) && c.uid);
        
        for (const staff of staffToNotify) {
            const notifId = `notif_global_rpt_${staff.uid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', notifId), {
                type: 'aviso_partido_finalizado',
                clubId: me.clubId || null,
                parentUid: staff.uid,
                matchDate, rival: rivalName, scoreHome, scoreAway,
                message: globalText.replace(/[*_]/g, ''),
                createdAt: new Date().toISOString()
            });
        }

        // --- FASE B: INFORMES INDIVIDUALES (PADRES) ---
        for (const player of homePlayers) {
            // Generar texto individual
            const stats = `⏱️ ${formatTime(player.time || 0)} min | ⚽ ${player.goals || 0} goles | ${player.cards === 'amarilla' ? '🟨' : player.cards === 'roja' ? '🟥' : '0 tarjetas'}`;
            const indivText = `📊 *INFORME INDIVIDUAL: ${player.name}*\n` +
                             `━━━━━━━━━━━━━━━━\n` +
                             `📅 ${matchDate}\n` +
                             `⚽ Partido vs ${rivalName}\n` +
                             `📈 Rendimiento: ${stats}\n\n` +
                             `Revisa el panel de informes para más detalles.\n` +
                             `_Cronos Fútbol_`;

            // Buscar padres vinculados con tag 'rpt'
            // 1. Desde links de Firestore (vinculados por App, suelen usar dorsal como fallback si no hay ID)
            const linkedParents = links.filter(l => (l.playerId === player.playerId || l.playerNumber == player.number) && l.canReceiveReports && l.parentUid);
            
            // 2. Desde contactos manuales (vinculados por el Entrenador en "📱 Contactos")
            // SOLO enviamos si el contacto manual está autorizado (ya sea por pre-selección o por tag rpt global)
            const manualParents = contacts.filter(c => {
                if (c.type !== 'parent' || c.playerId !== player.playerId || !c.uid) return false;
                return isRecipientAuthorized(c);
            });

            const allUids = new Set([...linkedParents.map(l => l.parentUid), ...manualParents.map(c => c.uid)]);

            for (const pUid of allUids) {
                if (!pUid) continue;
                
                // Enviar mensaje al hilo de chat
                const threadId = `${me.uid}_${pUid}`;
                const msgEntry = { sender: 'coach', text: indivText, timestamp: new Date().toISOString(), type: 'report' };
                
                // Usar updateDoc con arrayUnion para mayor eficiencia
                try {
                    await updateDoc(doc(db, 'cronos_messages', threadId), {
                        messages: arrayUnion(msgEntry),
                        lastMessage: '📊 Informe de partido enviado',
                        lastMessageAt: msgEntry.timestamp,
                        unreadByParent: 1 // o incrementar si fuera necesario, aquí simplificamos
                    });
                } catch(e) {
                    // Si el hilo no existe, lo creamos (fallback)
                    await setDoc(doc(db, 'cronos_messages', threadId), {
                        threadId, coachUid: me.uid, coachEmail: me.email,
                        parentUid: pUid, messages: [msgEntry], lastMessage: '📊 Informe de partido enviado',
                        lastMessageAt: msgEntry.timestamp, unreadByCoach: 0, unreadByParent: 1
                    });
                }

                // Notificación de nuevo informe
                await setDoc(doc(db, 'cronos_notifications', `notif_indiv_rpt_${pUid}_${Date.now().toString(36)}`), {
                    type: 'informe_partido',
                    clubId: me.clubId || null,
                    parentUid: pUid,
                    playerNumber: player.number,
                    rival: rivalName, scoreHome, scoreAway,
                    createdAt: new Date().toISOString()
                });
            }
        }

        console.log(`[AutoDispatch] Despacho de informes completado.`);
        localStorage.removeItem('cronos_match_rpt_selection');
        showToast('✅ Informes enviados automáticamente (Interno)', 4000);

    } catch(e) {
        console.error('[AutoDispatch] Error:', e);
    }
}

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

        console.log(`[AutoReport] ${saved} informes técnicos persistidos.`);
        
        // --- DISPARAR DESPACHO AUTOMÁTICO ---
        await autoDispatchMatchReports();

    } catch(e) {
        console.error('[AutoReport] Error:', e.message);
    }
}

// ── Gestión de Contactos (Teléfonos WhatsApp) ─────────────────────────
async function openContactManager() {
    const me = window._cronosCurrentUser;
    if (!me) { if(typeof showToast==='function') showToast('⚠️ Sin sesión activa',3000); return; }
    const fa = window._cronos_auth;
    if (!fa || !fa.db) { if(typeof showToast==='function') showToast('⚠️ Firebase no disponible',3000); return; }
    const db = fa.db;
    if (!window.emailConfig) window.emailConfig = { contacts: [] };
    if (typeof showSpinner==='function') showSpinner('Cargando contactos…');

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
        // 2. FUSIÓN: Asegurar que el Coach esté en la lista de Staff si no está
        const contacts = emailConfig.contacts || [];
        const coachExists = contacts.find(c => c.uid === me.uid);
        if (!coachExists) {
            contacts.push({
                id: 'coach_' + me.uid,
                name: (me.displayName || me.email || 'Entrenador') + ' (TÚ)',
                email: me.email || '',
                phone: '', // El coach puede añadirlo si quiere
                uid: me.uid,
                type: 'coach',
                tags: ['rpt', 'msg', 'cv', 'tr', 'live'] // Por defecto todo activo para el coach
            });
            // Guardar localmente para esta sesión hasta que dé a "Guardar"
            emailConfig.contacts = contacts;
        }

        // --- CARGAR PLANTILLA PARA VINCULACIÓN ---
        const rosterData = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
        const currentSquad = rosterData[currentMode || 'f11'] || [];
        window._cronos_squad_cache = currentSquad; // Caché global para renderParentRowMarkup

        modal.innerHTML = `
        <div class="modal-content" style="width:min(98vw,870px);max-height:92vh;
             display:flex;flex-direction:column;padding:0;overflow:hidden;">

            <!-- ── CABECERA FIJA ── -->
            <div style="padding:1rem 1.2rem 0.7rem;flex-shrink:0;
                        border-bottom:1px solid var(--glass-border);">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:1.4rem;">📱</span>
                        <h2 style="margin:0;font-size:1.1rem;font-family:'Outfit',sans-serif;">
                            Gestión de Contactos
                        </h2>
                    </div>
                    <button onclick="document.getElementById('setup-modal').style.display='none'; openUnifiedCommsMenu();"
                        style="background:none;border:none;color:var(--text-muted);
                               font-size:1.6rem;cursor:pointer;line-height:1;">✕</button>
                </div>
                <p style="font-size:0.72rem;color:var(--text-muted);margin:0.3rem 0 0;">
                    Define quién recibe informes, convocatorias y avisos. Secciones independientes.
                </p>
            </div>

            <!-- ── ZONA DE SCROLL ÚNICA ── -->
            <div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;
                        padding:1rem 1rem 0.5rem;">

                <!-- ══ SECCIÓN 1: STAFF / DIRECTIVOS ══ -->
                <div style="border:1px solid rgba(88,166,255,0.25);border-radius:12px;
                            background:rgba(88,166,255,0.03);margin-bottom:1.2rem;">

                    <!-- Cabecera sección -->
                    <div style="padding:0.7rem 1rem;border-bottom:1px solid rgba(88,166,255,0.2);
                                display:flex;justify-content:space-between;align-items:center;
                                flex-wrap:wrap;gap:0.5rem;">
                        <div>
                            <h3 style="font-size:0.88rem;color:var(--primary);margin:0;font-weight:700;">
                                📋 Staff y Directivos
                            </h3>
                            <p style="font-size:0.67rem;color:var(--text-muted);margin:0.1rem 0 0;">
                                Director deportivo, coordinadores, delegados, etc.
                            </p>
                        </div>
                        <button onclick="addNewContactRow()" class="btn"
                            style="padding:0.35rem 0.9rem;font-size:0.72rem;
                                   background:var(--primary);color:#0a0e14;border:none;
                                   border-radius:6px;font-weight:700;white-space:nowrap;flex-shrink:0;">
                            ➕ AÑADIR STAFF
                        </button>
                    </div>

                    <!-- Tabla con scroll horizontal solo si es necesario -->
                    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0.5rem;">
                        <table style="width:100%;min-width:560px;font-size:0.75rem;border-collapse:collapse;"
                               id="table-custom-contacts">
                            <thead>
                                <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.1);
                                           text-align:left;">
                                    <th style="padding:0.45rem;min-width:120px;">NOMBRE / CARGO</th>
                                    <th style="padding:0.45rem;min-width:130px;">EMAIL</th>
                                    <th style="padding:0.45rem;min-width:110px;">WHATSAPP</th>
                                    <th style="padding:0.45rem;min-width:100px;">UID (APP)</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Convocatorias">CONV.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Entrenamientos">ENTR.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Mensajes">MSJ.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Informes">INF.</th>
                                    <th style="padding:0.45rem;text-align:center;color:#ff5858;">EN VIVO 📡</th>
                                    <th style="padding:0.45rem;"></th>
                                </tr>
                            </thead>
                            <tbody id="tbody-custom-contacts">
                                ${emailConfig.contacts.filter(c => c.type !== 'parent').map(c => renderContactRowMarkup(c)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- ══ SECCIÓN 2: PADRES / TUTORES ══ -->
                <div style="border:1px solid rgba(240,136,62,0.25);border-radius:12px;
                            background:rgba(240,136,62,0.02);margin-bottom:1rem;">

                    <!-- Cabecera sección -->
                    <div style="padding:0.7rem 1rem;border-bottom:1px solid rgba(240,136,62,0.2);
                                display:flex;justify-content:space-between;align-items:center;
                                flex-wrap:wrap;gap:0.5rem;background:rgba(240,136,62,0.04);
                                border-radius:12px 12px 0 0;">
                        <div>
                            <h3 style="font-size:0.88rem;color:var(--secondary);margin:0;font-weight:700;">
                                👨‍👩‍👧‍👦 Padres / Tutores
                            </h3>
                            <p style="font-size:0.67rem;color:var(--text-muted);margin:0.1rem 0 0;">
                                Los vinculados por plantilla aparecen automáticamente. Puedes añadir más.
                            </p>
                        </div>
                        <button onclick="addNewParentRow()" class="btn"
                            style="padding:0.35rem 0.9rem;font-size:0.72rem;
                                   background:var(--secondary);color:#0a0e14;border:none;
                                   border-radius:6px;font-weight:700;white-space:nowrap;flex-shrink:0;">
                            ➕ AÑADIR PADRE/TUTOR
                        </button>
                    </div>

                    <!-- Tabla con scroll horizontal solo si es necesario -->
                    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0.5rem;">
                        <table style="width:100%;min-width:580px;font-size:0.74rem;border-collapse:collapse;">
                            <thead>
                                <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.1);">
                                    <th style="padding:0.45rem;text-align:left;min-width:120px;">JUGADOR / NOMBRE</th>
                                    <th style="padding:0.45rem;text-align:left;min-width:40px;">N°</th>
                                    <th style="padding:0.45rem;text-align:left;min-width:110px;">WHATSAPP</th>
                                    <th style="padding:0.45rem;text-align:left;min-width:130px;">EMAIL</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Convocatorias">CONV.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Entrenamientos">ENTR.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Mensajes">MSJ.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Informes">INF.</th>
                                    <th style="padding:0.45rem;text-align:center;color:#ff5858;">EN VIVO 📡</th>
                                    <th style="padding:0.45rem;"></th>
                                </tr>
                            </thead>
                            <tbody id="tbody-parent-contacts">
                                ${links.sort((a,b) => (a.playerNumber||0)-(b.playerNumber||0)).map(link => `
                                <tr class="parent-contact-row firestore-linked" data-linkid="${link._id}"
                                    style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:0.45rem;font-weight:600;">
                                        ${link.playerAlias || link.playerName || 'Jugador'}
                                        <span style="font-size:0.6rem;color:var(--text-muted);
                                                     margin-left:3px;background:rgba(255,255,255,0.06);
                                                     border-radius:3px;padding:1px 4px;">vinculado</span>
                                    </td>
                                    <td style="padding:0.45rem;font-weight:700;color:var(--primary);">#${link.playerNumber}</td>
                                    <td style="padding:0.45rem;">
                                        <input type="text" class="contact-phone" data-linkid="${link._id}"
                                            value="${link.parentPhone || ''}" placeholder="34600112233"
                                            style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);
                                                   border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                                                   color:white;font-size:0.72rem;box-sizing:border-box;">
                                    </td>
                                    <td style="padding:0.45rem;">
                                        <input type="email" class="contact-parent-email" data-linkid="${link._id}"
                                            value="${link.parentEmail || ''}" placeholder="padre@email.com"
                                            style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);
                                                   border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                                                   color:white;font-size:0.72rem;box-sizing:border-box;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-cv" data-linkid="${link._id}"
                                            ${link.canReceiveConv !== false ? 'checked' : ''} style="width:16px;height:16px;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-tr" data-linkid="${link._id}"
                                            ${link.canReceiveTr !== false ? 'checked' : ''} style="width:16px;height:16px;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-msg" data-linkid="${link._id}"
                                            ${link.canReceiveMsg !== false ? 'checked' : ''} style="width:16px;height:16px;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-rpt" data-linkid="${link._id}"
                                            ${link.canReceiveReports ? 'checked' : ''} style="width:16px;height:16px;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-live" data-linkid="${link._id}"
                                            ${link.canWatchLive ? 'checked' : ''}
                                            style="width:16px;height:16px;accent-color:#ff5858;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;color:var(--text-muted);
                                               font-size:0.65rem;">—</td>
                                </tr>`).join('')}
                                ${emailConfig.contacts.filter(c => c.type === 'parent').map(c => renderParentRowMarkup(c)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div><!-- fin scroll único -->

            <!-- ── BOTONES FIJOS ABAJO ── -->
            <div style="padding:0.8rem 1rem;border-top:1px solid var(--glass-border);
                        display:flex;gap:0.7rem;flex-shrink:0;background:var(--surface);">
                <button onclick="openUnifiedCommsMenu()" class="btn" style="flex:1;">← VOLVER</button>
                <button onclick="saveContactManagerData()" class="btn primary"
                    style="flex:2;font-weight:bold;">
                    💾 GUARDAR CAMBIOS
                </button>
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

        // 1. Guardar datos completos de Padres (en cronos_player_links)
        for (const input of parentInputs) {
            const linkId      = input.dataset.linkid;
            const phone       = input.value.trim().replace(/\s/g, '');
            const emailEl     = document.querySelector(`.contact-parent-email[data-linkid="${linkId}"]`);
            const cvEl        = document.querySelector(`.contact-cv[data-linkid="${linkId}"]`);
            const trEl        = document.querySelector(`.contact-tr[data-linkid="${linkId}"]`);
            const msgEl       = document.querySelector(`.contact-msg[data-linkid="${linkId}"]`);
            const rptEl       = document.querySelector(`.contact-rpt[data-linkid="${linkId}"]`);
            const liveEl      = document.querySelector(`.contact-live[data-linkid="${linkId}"]`);
            await updateDoc(doc(db, 'cronos_player_links', linkId), {
                parentPhone:        phone,
                parentEmail:        emailEl   ? emailEl.value.trim()   : undefined,
                canWatchLive:       liveEl    ? liveEl.checked          : false,
                canReceiveReports:  rptEl     ? rptEl.checked           : false,
                canReceiveConv:     cvEl      ? cvEl.checked            : true,
                canReceiveTr:       trEl      ? trEl.checked            : true,
                canReceiveMsg:      msgEl     ? msgEl.checked           : true,
            });
        }

        // 2. Guardar Lista Unificada de Contactos (en emailConfig)
        const updatedContacts = [];

        // 2a. Staff y Coach (filas de la tabla azul)
        document.querySelectorAll('.custom-contact-row').forEach(row => {
            const tags = [];
            if (row.querySelector('.tag-cv').checked)   tags.push('cv');
            if (row.querySelector('.tag-tr').checked)   tags.push('tr');
            if (row.querySelector('.tag-msg').checked)  tags.push('msg');
            if (row.querySelector('.tag-rpt').checked)  tags.push('rpt');
            if (row.querySelector('.tag-live').checked) tags.push('live');

            updatedContacts.push({
                id:    row.dataset.id || ('c_' + Math.random().toString(36).substr(2,6)),
                type:  row.dataset.type || 'staff',
                name:  row.querySelector('.c-name').value.trim(),
                email: row.querySelector('.c-email').value.trim(),
                phone: row.querySelector('.c-phone').value.trim().replace(/\s/g, ''),
                uid:   row.querySelector('.c-uid').value.trim(),
                tags
            });
        });

        // 2b. Padres añadidos manualmente (filas de la tabla naranja, clase manual-parent)
        document.querySelectorAll('.manual-parent').forEach(row => {
            const tags = [];
            if (row.querySelector('.p-cv').checked)   tags.push('cv');
            if (row.querySelector('.p-tr').checked)   tags.push('tr');
            if (row.querySelector('.p-msg').checked)  tags.push('msg');
            if (row.querySelector('.p-rpt').checked)  tags.push('rpt');
            if (row.querySelector('.p-live').checked) tags.push('live');

            const pPlayerEl = row.querySelector('.p-player');
            const playerId = pPlayerEl.value;
            const playerName = playerId ? pPlayerEl.options[pPlayerEl.selectedIndex].text.split('] ')[1] : '';

            updatedContacts.push({
                id:     row.dataset.id || ('p_' + Math.random().toString(36).substr(2,6)),
                type:   'parent',
                name:   row.querySelector('.p-name').value.trim(),
                player: playerName,   // Para visualización legacy
                playerId: playerId,   // El vínculo inequivoco
                phone:  row.querySelector('.p-phone').value.trim().replace(/\s/g, ''),
                email:  row.querySelector('.p-email').value.trim(),
                tags
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

// Fila de STAFF (tabla azul)
function renderContactRowMarkup(c = {}) {
    const isCv  = (c.tags || []).includes('cv');
    const isTr  = (c.tags || []).includes('tr');
    const isMsg = (c.tags || []).includes('msg');
    const isRpt = (c.tags || []).includes('rpt');
    const isLive = (c.tags || []).includes('live');
    const id = c.id || ('new_' + Date.now());
    const isCoach = c.type === 'coach';

    return `
    <tr class="custom-contact-row" data-id="${id}" data-type="${c.type || 'staff'}" 
        style="border-bottom:1px solid rgba(255,255,255,0.05); ${isCoach ? 'background:rgba(88,166,255,0.03);' : ''}">
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
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-muted);font-size:0.7rem;"
                ${isCoach ? 'readonly' : ''}>
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-cv" ${isCv ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-tr" ${isTr ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-msg" ${isMsg ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-rpt" ${isRpt ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-live" ${isLive ? 'checked' : ''}
                style="width:16px;height:16px;accent-color:#ff5858;"
                title="Puede ver los partidos en vivo">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            ${isCoach ? '<span title="Tú" style="font-size:1rem; cursor:help;">👤</span>' : 
            `<button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#ff5858;cursor:pointer;font-size:1rem;" title="Eliminar">🗑️</button>`}
        </td>
    </tr>`;
}

// Fila de PADRE/TUTOR manual (tabla naranja)
function renderParentRowMarkup(c = {}) {
    const isCv = (c.tags || []).includes('cv');
    const isTr = (c.tags || []).includes('tr');
    const isMsg = (c.tags || []).includes('msg');
    const isRpt = (c.tags || []).includes('rpt');
    const isLive = (c.tags || []).includes('live');
    const id = c.id || ('new_' + Date.now());

    return `
    <tr class="parent-contact-row manual-parent" data-id="${id}"
        style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:0.4rem;">
            <input type="text" class="p-name" value="${c.name || ''}" placeholder="Nombre padre/madre"
                style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
        </td>
        <td style="padding:0.4rem;">
            <select class="p-player" style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
                <option value="">-- Seleccionar Jugador --</option>
                ${(window._cronos_squad_cache || []).map(p => `
                    <option value="${p.id}" ${c.playerId === p.id ? 'selected' : ''}>
                        [${p.id}] ${p.alias || p.name || 'Sin nombre'}
                    </option>
                `).join('')}
            </select>
        </td>
        <td style="padding:0.4rem;">
            <input type="tel" class="p-phone" value="${c.phone || ''}" placeholder="34600000000"
                style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="email" class="p-email" value="${c.email || ''}" placeholder="padre@email.com"
                style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-cv" ${isCv ? 'checked' : ''} style="width:15px;height:15px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-tr" ${isTr ? 'checked' : ''} style="width:15px;height:15px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-msg" ${isMsg ? 'checked' : ''} style="width:15px;height:15px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-rpt" ${isRpt ? 'checked' : ''} style="width:15px;height:15px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-live" ${isLive ? 'checked' : ''}
                style="width:15px;height:15px;accent-color:#ff5858;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#ff5858;cursor:pointer;font-size:1rem;" title="Eliminar">🗑️</button>
        </td>
    </tr>`;
}

// Añadir fila vacía en la tabla de STAFF
window.addNewContactRow = () => {
    const tbody = document.getElementById('tbody-custom-contacts');
    if (!tbody) return;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = `<table>${renderContactRowMarkup({})}</table>`;
    const newRow = tempDiv.querySelector('tr');
    tbody.appendChild(newRow);
    newRow.querySelector('.c-name').focus();
};

// Añadir fila vacía en la tabla de PADRES
window.addNewParentRow = () => {
    const tbody = document.getElementById('tbody-parent-contacts');
    if (!tbody) return;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = `<table>${renderParentRowMarkup({})}</table>`;
    const newRow = tempDiv.querySelector('tr');
    tbody.appendChild(newRow);
    newRow.querySelector('.p-name').focus();
};


// ════════════════════════════════════════════════════════════════════
//  NOTIFICACIÓN DE ENTRENAMIENTO — BUG 9 FIX
// ════════════════════════════════════════════════════════════════════
async function openTrainingNotification() {
    const me    = window._cronosCurrentUser;
    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    // Build 7-day rows
    const days = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
    const dayRows = days.map((d, i) => `
        <div class="tr-day-row" id="tr-day-${i}"
            style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;">
            <!-- Cabecera día -->
            <div onclick="document.getElementById('tr-day-body-${i}').classList.toggle('hidden');
                          this.querySelector('.tr-chev').textContent=document.getElementById('tr-day-body-${i}').classList.contains('hidden')?'▸':'▾';"
                style="display:flex;align-items:center;gap:0.5rem;padding:0.55rem 0.8rem;
                       cursor:pointer;background:rgba(255,255,255,0.03);user-select:none;">
                <input type="checkbox" id="tr-cb-${i}" onclick="event.stopPropagation();
                    var body=document.getElementById('tr-day-body-${i}');
                    if(this.checked){body.classList.remove('hidden');}
                    else{body.classList.add('hidden');}"
                    style="width:16px;height:16px;cursor:pointer;accent-color:var(--secondary);">
                <label for="tr-cb-${i}"
                    style="font-size:0.82rem;font-weight:700;color:var(--text-muted);cursor:pointer;flex:1;">
                    ${d}</label>
                <span class="tr-chev" style="font-size:0.7rem;color:var(--text-muted);">▸</span>
            </div>
            <!-- Cuerpo día (colapsable) -->
            <div id="tr-day-body-${i}" class="hidden"
                style="padding:0.6rem 0.8rem;display:grid;grid-template-columns:1fr 1fr;
                       gap:0.5rem;background:rgba(255,255,255,0.01);">
                <div>
                    <label style="font-size:0.68rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">🕐 Hora</label>
                    <input type="time" id="tr-time-${i}"
                        style="width:100%;padding:0.4rem;background:rgba(255,255,255,0.06);
                               border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                               color:white;font-size:0.8rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.68rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">📍 Lugar</label>
                    <input type="text" id="tr-place-${i}" placeholder="Campo…"
                        style="width:100%;padding:0.4rem;background:rgba(255,255,255,0.06);
                               border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                               color:white;font-size:0.8rem;box-sizing:border-box;">
                </div>
                <div style="grid-column:1/-1;">
                    <label style="font-size:0.68rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">📝 Notas</label>
                    <input type="text" id="tr-note-${i}" placeholder="Ropa especial, material…"
                        style="width:100%;padding:0.4rem;background:rgba(255,255,255,0.06);
                               border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                               color:white;font-size:0.8rem;box-sizing:border-box;">
                </div>
            </div>
        </div>`).join('');

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,520px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">
        <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;color:var(--secondary);">
                📅 Planificación Semanal de Entrenamientos
            </h3>
            <button onclick="openUnifiedCommsMenu()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>
        <p style="margin:0.5rem 1.2rem;font-size:0.75rem;color:var(--text-muted);">
            Activa los días que habrá entrenamiento, rellena hora y lugar, y envía a los padres.
        </p>
        <style>
            .tr-day-row .hidden { display:none!important; }
        </style>
        <div style="flex:1;overflow-y:auto;padding:0.6rem 1.2rem;display:grid;gap:0.4rem;">
            ${dayRows}
        </div>
        <div style="background:rgba(240,136,62,0.05);border-top:1px solid rgba(240,136,62,0.15);
                    padding:0.55rem 1.2rem;font-size:0.72rem;color:#f0883e;flex-shrink:0;">
            📤 Se enviará a <strong>padres/tutores</strong> (WhatsApp) + <strong>dirección deportiva</strong> (app)
        </div>
        <div style="padding:0.8rem 1.2rem;border-top:1px solid var(--glass-border);
                    display:flex;gap:0.5rem;flex-shrink:0;">
            <button onclick="openUnifiedCommsMenu()" class="btn"
                style="color:var(--text-muted);">← Volver</button>
            <button onclick="_sendWeeklyTraining()"
                style="flex:1;padding:0.5rem;background:rgba(240,136,62,0.15);
                       border:1px solid rgba(240,136,62,0.4);border-radius:7px;
                       color:#f0883e;font-weight:700;cursor:pointer;font-size:0.85rem;">
                📅 Enviar Planificación Semanal
            </button>
        </div>
    </div>`;
}

window._sendWeeklyTraining = async function() {
    const me = window._cronosCurrentUser;
    const days = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

    const selected = [];
    for (let i = 0; i < 7; i++) {
        if (!document.getElementById('tr-cb-' + i)?.checked) continue;
        const time  = document.getElementById('tr-time-' + i)?.value || '';
        const place = document.getElementById('tr-place-' + i)?.value.trim() || '';
        const note  = document.getElementById('tr-note-' + i)?.value.trim() || '';
        if (!time && !place) continue;  // skip días sin datos
        selected.push({ day: days[i], time, place, note });
    }

    if (!selected.length) {
        if (typeof showToast === 'function') showToast('⚠️ Activa al menos un día con hora o lugar', 3000);
        return;
    }
    if (typeof showSpinner === 'function') showSpinner('Enviando planificación…');

    try {
        const { db, collection, getDocs, query, where, setDoc, doc } = await _cFS();

        const [dirSnap, coordSnap] = await Promise.all([
            getDocs(query(collection(db,'users'), where('clubId','==',me.clubId||''), where('role','==','director'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'users'), where('clubId','==',me.clubId||''), where('role','==','coordinator'))).catch(()=>({forEach:()=>{}})),
        ]);
        const staff = [];
        dirSnap.forEach(d => staff.push({uid:d.id,...d.data()}));
        coordSnap.forEach(d => staff.push({uid:d.id,...d.data()}));

        const msgLines = ['📅 *PLANIFICACIÓN DE ENTRENAMIENTOS*', '━━━━━━━━━━━━━━━━'];
        selected.forEach(s => {
            msgLines.push(`\n📆 *${s.day}*`);
            if (s.time)  msgLines.push(`   🕐 ${s.time}`);
            if (s.place) msgLines.push(`   📍 ${s.place}`);
            if (s.note)  msgLines.push(`   📝 ${s.note}`);
        });
        msgLines.push('\n_Cronos Fútbol_ ⚽');
        const msg = msgLines.join('\n');

        // Notificar a staff vía app
        for (const s of staff) {
            await setDoc(doc(db,'cronos_notifications',`tr_staff_${s.uid}_${Date.now().toString(36)}`), {
                type:'planificacion_semanal', clubId:me.clubId||null,
                parentUid:s.uid, coachEmail:me.email,
                schedule: selected, message:msg,
                createdAt:new Date().toISOString(),
            });
        }

        // WhatsApp a padres
        if (typeof loadEmailConfig === 'function') await loadEmailConfig();
        const contacts = (typeof emailConfig !== 'undefined' && emailConfig?.contacts) ? emailConfig.contacts : [];
        const parents  = contacts.filter(c => c.type === 'parent' && c.phone);
        for (const p of parents) {
            window.open('https://wa.me/' + p.phone.replace(/\D/g,'') + '?text=' + encodeURIComponent(msg), '_blank');
            await new Promise(r => setTimeout(r, 400));
        }

        if (typeof hideSpinner === 'function') hideSpinner();
        if (typeof showToast === 'function')
            showToast(`✅ Enviado: ${selected.length} días${staff.length ? ` a ${staff.length} staff` : ''}${parents.length ? ` + ${parents.length} padres` : ''}`, 5000);
        openUnifiedCommsMenu();
    } catch(e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        if (typeof showToast  === 'function') showToast('⚠️ Error: ' + e.message, 4000);
        console.error('[WeeklyTraining]', e);
    }
};
window.openTrainingNotification = openTrainingNotification;


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

            <button onclick="sendMatchReportsToParents(false)" class="btn-comms-card" style="--color: #ffa500; --bg: rgba(255,165,0,0.1);">
                <span class="icon">📊</span>
                <div class="content">
                    <div class="title" style="color:#ffa500;">Informe de Partido</div>
                    <div class="desc">Enviar informe de rendimiento a padres y staff</div>
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

// ── Seleccionar / deseleccionar todos los padres ─────────────────────
window.toggleSelectAllParents = function(checked) {
    document.querySelectorAll('.parent-select-chk').forEach(chk => { chk.checked = checked; });
    updateBulkCount();
};

window.updateBulkCount = function() {
    const total = document.querySelectorAll('.parent-select-chk:checked').length;
    const countEl = document.getElementById('bulk-count');
    if (countEl) countEl.textContent = total + ' seleccionado' + (total !== 1 ? 's' : '');
};

// ── Compositor de mensaje grupal ──────────────────────────────────────
window.openBulkMessageComposer = function() {
    // Recopilar ABSOLUTAMENTE TODOS los que el usuario marcó con el checkbox
    const allSelected = Array.from(document.querySelectorAll('.parent-select-chk:checked'))
        .map(chk => {
            // Intentar buscar el contacto original en emailConfig para saber su tipo real
            const c = (emailConfig.contacts || []).find(x => x.id === chk.dataset.parentUid || x.email === chk.dataset.parentEmail);
            return {
                id:          chk.dataset.parentUid,
                type:        c ? c.type : 'parent',
                label:       chk.dataset.player + (chk.dataset.playerNum ? ` #${chk.dataset.playerNum}` : ''),
                parentUid:   chk.dataset.parentUid,
                parentEmail: chk.dataset.parentEmail,
                parentWA:    chk.dataset.parentWa,
                phone:       chk.dataset.parentWa,
                email:       chk.dataset.parentEmail,
            };
        });

    // Cargar preselección de mensajes guardada
    let savedMsgPresel = null;
    try { savedMsgPresel = JSON.parse(localStorage.getItem('cronos_msg_preselection') || 'null'); } catch(e) {}

    const allContacts = allSelected;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,540px);max-height:90vh;
         display:flex;flex-direction:column;gap:0.8rem;">

        <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;">✉️ Mensaje Grupal</h3>
            <button onclick="openCoachMessaging()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- Selector de destinatarios -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                    border-radius:10px;padding:0.8rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
                <span style="font-size:0.75rem;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;">
                    📤 DESTINATARIOS
                </span>
                <div style="display:flex;gap:0.4rem;">
                    <button onclick="document.querySelectorAll('.msg-recipient-chk').forEach(c=>c.checked=true)"
                        style="font-size:0.62rem;padding:0.18rem 0.55rem;background:rgba(88,166,255,0.1);
                               border:1px solid rgba(88,166,255,0.3);border-radius:4px;color:var(--primary);cursor:pointer;">
                        ✓ Todos
                    </button>
                    <button onclick="document.querySelectorAll('.msg-recipient-chk').forEach(c=>c.checked=false)"
                        style="font-size:0.62rem;padding:0.18rem 0.55rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--text-muted);cursor:pointer;">
                        ✗ Ninguno
                    </button>
                    <button onclick="_msgSavePreselection()"
                        style="font-size:0.62rem;padding:0.18rem 0.55rem;background:rgba(63,185,80,0.1);
                               border:1px solid rgba(63,185,80,0.3);border-radius:4px;color:#3fb950;cursor:pointer;">
                        💾 Guardar
                    </button>
                </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.35rem;max-height:200px;overflow-y:auto;padding-right:4px;">
                ${allContacts.length ? allContacts.map(c => {
                    const isChecked = savedMsgPresel ? savedMsgPresel.includes(c.id) : true;
                    const typeColor  = c.type === 'staff' ? 'rgba(88,166,255,0.12)' : 'rgba(63,185,80,0.08)';
                    const typeBorder = c.type === 'staff' ? 'rgba(88,166,255,0.25)' : 'rgba(63,185,80,0.2)';
                    return `
                    <label style="display:flex;align-items:center;gap:0.55rem;
                                   background:${typeColor};border:1px solid ${typeBorder};
                                   border-radius:7px;padding:0.45rem 0.65rem;cursor:pointer;">
                        <input type="checkbox" class="msg-recipient-chk"
                            data-uid="${c.parentUid || ''}"
                            data-email="${c.parentEmail}"
                            data-wa="${c.parentWA}"
                            data-id="${c.id}"
                            ${isChecked ? 'checked' : ''}
                            style="width:15px;height:15px;flex-shrink:0;accent-color:var(--primary);">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.78rem;font-weight:600;">${c.label}</div>
                            <div style="font-size:0.63rem;color:var(--text-muted);">
                                ${c.phone ? `📱 ${c.phone}` : ''}${c.phone && c.email ? ' · ' : ''}${c.email ? `📧 ${c.email}` : ''}
                            </div>
                        </div>
                        ${c.phone ? `<span style="font-size:0.58rem;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.3);border-radius:3px;padding:1px 4px;color:#3fb950;">WA</span>` : ''}
                        ${c.email ? `<span style="font-size:0.58rem;background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.25);border-radius:3px;padding:1px 4px;color:var(--primary);">Email</span>` : ''}
                    </label>`;
                }).join('') : `<div style="text-align:center;color:var(--text-muted);font-size:0.78rem;padding:0.8rem;">
                    ⚠️ No hay contactos. Ve a Gestión de Contactos para configurarlos.
                </div>`}
            </div>
        </div>

        <!-- Redactor -->
        <div style="flex:1;display:flex;flex-direction:column;gap:0.4rem;">
            <label style="font-size:0.75rem;color:var(--text-muted);">Mensaje</label>
            <textarea id="bulk-msg-text" rows="5"
                placeholder="Escribe aquí el mensaje para los destinatarios seleccionados…"
                style="flex:1;padding:0.7rem;background:rgba(255,255,255,0.05);
                       border:1px solid var(--glass-border);border-radius:8px;
                       color:white;font-size:0.88rem;resize:vertical;
                       box-sizing:border-box;width:100%;"></textarea>
        </div>

        <!-- Botones -->
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;flex-shrink:0;">
            <button onclick="openCoachMessaging()" class="btn"
                style="color:var(--text-muted);font-size:0.78rem;flex:1;">← Volver</button>
            <button onclick="_sendBulkMsgFirestore()" class="btn"
                style="background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.4);
                       color:var(--primary);font-weight:700;font-size:0.78rem;flex:1.5;">
                📱 Envío Interno
            </button>
            <button onclick="_sendBulkMsgWA()" class="btn"
                style="background:rgba(37,211,102,0.15);border-color:rgba(37,211,102,0.4);
                       color:#25d366;font-weight:700;font-size:0.78rem;flex:1;">
                📱 WhatsApp
            </button>
            <button onclick="_sendBulkMsgEmail()" class="btn"
                style="background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.25);
                       color:var(--primary);font-weight:700;font-size:0.78rem;flex:1;">
                📧 Email
            </button>
        </div>
    </div>`;
};

// ── Guardar preselección de mensajes ─────────────────────────────────
window._msgSavePreselection = function() {
    const ids = Array.from(document.querySelectorAll('.msg-recipient-chk:checked')).map(c => c.dataset.id);
    localStorage.setItem('cronos_msg_preselection', JSON.stringify(ids));
    showToast('✅ Selección guardada como predeterminada', 2500);
};

// ── Obtener destinatarios seleccionados para mensaje ──────────────────
function _msgGetSelected() {
    return Array.from(document.querySelectorAll('.msg-recipient-chk:checked')).map(chk => ({
        parentUid:   chk.dataset.uid,
        parentEmail: chk.dataset.email,
        parentWA:    chk.dataset.wa,
    }));
}

// ── Envío grupal interno (Firestore) ──────────────────────────────────
window._sendBulkMsgFirestore = async function() {
    const me   = window._cronosCurrentUser;
    const fa   = window._cronos_auth;
    if (!fa || !me) return;
    const text = document.getElementById('bulk-msg-text')?.value.trim();
    if (!text) { showToast('⚠️ Escribe un mensaje antes de enviar', 3000); return; }

    const selected = _msgGetSelected().filter(s => s.parentUid);
    if (!selected.length) { showToast('⚠️ Selecciona al menos un destinatario con cuenta en la app', 3000); return; }

    showSpinner('Enviando mensaje a ' + selected.length + ' destinatarios…');
    try {
        const { db, doc, getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();
        let sent = 0;
        for (const s of selected) {
            const threadId = `${me.uid}_${s.parentUid}`;
            const newMsg   = { sender: 'coach', text, timestamp: new Date().toISOString() };
            const preview  = text.length > 60 ? text.substring(0, 60) + '…' : text;
            const snap     = await getDoc(doc(db, 'cronos_messages', threadId));
            if (snap.exists()) {
                await updateDoc(doc(db, 'cronos_messages', threadId), {
                    messages: arrayUnion(newMsg), lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByParent: (snap.data().unreadByParent || 0) + 1
                });
            } else {
                await setDoc(doc(db, 'cronos_messages', threadId), {
                    threadId, coachUid: me.uid, coachEmail: me.email,
                    parentUid: s.parentUid, parentEmail: s.parentEmail,
                    messages: [newMsg], lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByCoach: 0, unreadByParent: 1
                });
            }
            sent++;
        }

        // --- LIMPIEZA POST-ENVÍO ---
        localStorage.removeItem('cronos_match_rpt_selection');
        hideSpinner();
        showToast(`✅ Mensaje enviado a ${sent} destinatario${sent !== 1 ? 's' : ''}`, 4000);
        openCoachMessaging();
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error: ' + e.message, 4000);
    }
};

// ── Envío grupal por WhatsApp ─────────────────────────────────────────
window._sendBulkMsgWA = function() {
    const text = document.getElementById('bulk-msg-text')?.value.trim();
    if (!text) { showToast('⚠️ Escribe un mensaje antes de enviar', 3000); return; }
    const withPhone = _msgGetSelected().filter(s => s.parentWA);
    if (!withPhone.length) {
        showToast('⚠️ Ningún destinatario seleccionado tiene WhatsApp configurado', 4000);
        return;
    }
    const encoded = encodeURIComponent(text);
    withPhone.forEach((s, i) => {
        setTimeout(() => {
            window.open(`https://wa.me/${s.parentWA}?text=${encoded}`, '_blank');
        }, i * 700);
    });
    showToast(`📱 WhatsApp abierto para ${withPhone.length} destinatario${withPhone.length !== 1 ? 's' : ''}`, 4000);
};

// ── Envío grupal por Email ───────────────────────────────────────────
window._sendBulkMsgEmail = function() {
    const text = document.getElementById('bulk-msg-text')?.value.trim();
    if (!text) { showToast('⚠️ Escribe un mensaje antes de enviar', 3000); return; }
    
    // El objeto c ya los guardó en data-email, por lo cual selected.parentEmail funciona
    const withEmail = _msgGetSelected().filter(s => s.parentEmail);
    if (!withEmail.length) {
        showToast('⚠️ Ningún destinatario seleccionado tiene Email configurado', 4000);
        return;
    }
    
    const subject = encodeURIComponent(`💬 Mensaje de Entrenador — ${new Date().toLocaleDateString('es-ES')}`);
    const body = encodeURIComponent(text.replace(/[*_]/g, ''));
    
    const toList = withEmail.map(s => s.parentEmail).join(',');
    window.open(`mailto:${toList}?subject=${subject}&body=${body}`, '_blank');
    showToast(`📧 Email abierto para ${withEmail.length} destinatario${withEmail.length !== 1 ? 's' : ''}`, 4000);
};

window.openCoachMessaging      = openCoachMessaging;
window.openThreadWithParent    = openThreadWithParent;
window.sendMatchReportsToParents = sendMatchReportsToParents;
window._loadThreadMessages     = _loadThreadMessages;
window.openContactManager      = openContactManager;
window.saveContactManagerData  = saveContactManagerData;
window.saveAllMatchReportsInternal = saveAllMatchReportsInternal;
window.openUnifiedCommsMenu    = openUnifiedCommsMenu;

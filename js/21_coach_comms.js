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
async function openCoachMessaging(tab) {
    tab = tab || 'parents';
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    if (!me) return;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,720px);max-height:92vh;
         display:flex;flex-direction:column;overflow:hidden;">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:0.6rem;flex-shrink:0;">
            <h2 style="margin:0;font-size:1.05rem;">💬 Mensajes</h2>
            <div style="display:flex;gap:0.4rem;align-items:center;">
                <button onclick="openCoachMessaging(window._cmTab||'parents')" class="btn"
                    style="font-size:0.72rem;background:var(--glass);color:var(--text-muted);">
                    🔄 Actualizar
                </button>
                <button onclick="openUnifiedCommsMenu()"
                    style="background:none;border:none;color:var(--text-muted);
                           font-size:1.3rem;cursor:pointer;">✕</button>
            </div>
        </div>

        <!-- Tabs: Padres / Staff -->
        <div style="display:flex;border-bottom:1px solid var(--glass-border);
                    margin-bottom:0.7rem;flex-shrink:0;">
            <button id="cm-tab-parents"
                    onclick="window._cmTab='parents'; _loadParentList();"
                    style="padding:0.5rem 1rem;background:none;border:none;
                           border-bottom:2px solid ${tab==='parents'?'var(--primary)':'transparent'};
                           color:${tab==='parents'?'var(--primary)':'var(--text-muted)'};
                           font-size:0.82rem;font-weight:700;cursor:pointer;">
                👨‍👩‍👧 Padres / Tutores
            </button>
            <button id="cm-tab-staff"
                    onclick="window._cmTab='staff'; _loadStaffList();"
                    style="padding:0.5rem 1rem;background:none;border:none;
                           border-bottom:2px solid ${tab==='staff'?'#f0883e':'transparent'};
                           color:${tab==='staff'?'#f0883e':'var(--text-muted)'};
                           font-size:0.82rem;font-weight:700;cursor:pointer;">
                🏢 Dirección / Coordinación
            </button>
        </div>

        <!-- Barra selección múltiple (solo padres) -->
        <div id="bulk-msg-bar" style="display:none;background:rgba(88,166,255,0.08);
             border:1px solid rgba(88,166,255,0.25);border-radius:10px;
             padding:0.6rem 0.9rem;margin-bottom:0.7rem;flex-shrink:0;
             align-items:center;gap:0.7rem;flex-wrap:wrap;">
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
            <p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando…</p>
        </div>
    </div>`;

    window._cmTab = tab;
    if (tab === 'staff') {
        await _loadStaffList();
    } else {
        await _loadParentList();
    }
}

// ════════════════════════════════════════════════════════════════════
//  LISTA DE STAFF PARA MENSAJES (Directores / Coordinadores)
// ════════════════════════════════════════════════════════════════════
async function _loadStaffList() {
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    const body = document.getElementById('coach-parent-list');
    if (!body || !me) return;

    const pBtn = document.getElementById('cm-tab-parents');
    const sBtn = document.getElementById('cm-tab-staff');
    if (pBtn) { pBtn.style.borderBottomColor = 'transparent'; pBtn.style.color = 'var(--text-muted)'; }
    if (sBtn) { sBtn.style.borderBottomColor = '#f0883e';     sBtn.style.color = '#f0883e'; }
    const bar = document.getElementById('bulk-msg-bar');
    if (bar) bar.style.display = 'none';

    body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando dirección…</p>';

    try {
        const { db, collection, getDocs, query, where } = await _cFS();

        const [dirSnap, coordSnap] = await Promise.all([
            getDocs(query(collection(db,'users'), where('clubId','==',me.clubId||''), where('role','==','director'))),
            getDocs(query(collection(db,'users'), where('clubId','==',me.clubId||''), where('role','==','coordinator'))),
        ]);

        const staffList = [];
        dirSnap.forEach(d   => staffList.push({ uid: d.id, role:'director',    ...d.data() }));
        coordSnap.forEach(d => staffList.push({ uid: d.id, role:'coordinator', ...d.data() }));

        if (!staffList.length) {
            body.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);padding:3rem 1rem;">
                🏢 No hay directores ni coordinadores asignados al club aún.
            </div>`;
            return;
        }

        const threadsSnap = await getDocs(query(
            collection(db,'cronos_messages'),
            where('coachUid','==',me.uid)
        ));
        const threadsMap = {};
        threadsSnap.forEach(d => { threadsMap[d.id] = { _id: d.id, ...d.data() }; });

        const roleIcon  = { director:'📋', coordinator:'🎯' };
        const roleLabel = { director:'Director Deportivo', coordinator:'Coordinador' };

        body.innerHTML = staffList.map(s => {
            const threadId = `${me.uid}_${s.uid}`;
            const thread   = threadsMap[threadId] || {};
            const unread   = thread.unreadByCoach || 0;
            const lastMsg  = thread.lastMessage || '— Sin mensajes —';
            const lastTime = thread.lastMessageAt
                ? new Date(thread.lastMessageAt).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
                : '';

            return `
            <div onclick="openThreadWithStaff('${typeof escapeAttr==='function'?escapeAttr(s.uid):s.uid}','${(typeof escapeAttr==='function'?escapeAttr(s.email||''):s.email||'').replace(/'/g,"\\'")}','${typeof escapeAttr==='function'?escapeAttr(s.role):s.role}')"
                 style="display:flex;align-items:center;gap:0.8rem;margin-bottom:0.6rem;
                        background:${unread?'rgba(240,136,62,0.06)':'var(--glass)'};
                        border:1px solid ${unread?'rgba(240,136,62,0.45)':'var(--glass-border)'};
                        border-radius:10px;padding:0.85rem 1rem;
                        cursor:pointer;transition:all 0.15s;">
                <div style="width:38px;height:38px;border-radius:50%;
                            background:rgba(240,136,62,0.15);
                            display:flex;align-items:center;justify-content:center;
                            font-size:1.1rem;flex-shrink:0;">
                    ${roleIcon[s.role]||'🏢'}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.88rem;margin-bottom:0.1rem;">
                        ${typeof escapeHtml==='function'?escapeHtml(s.displayName || s.email || s.uid):s.displayName || s.email || s.uid}
                        ${unread>0?`<span style="background:#f0883e;color:#0a0e14;border-radius:10px;
                            padding:1px 7px;font-size:0.62rem;font-weight:700;margin-left:6px;">
                            ${unread} nuevo${unread>1?'s':''}</span>`:''}
                    </div>
                    <div style="font-size:0.7rem;color:var(--text-muted);">
                        ${roleLabel[s.role]||s.role}
                        ${s.email?' · '+(typeof escapeHtml==='function'?escapeHtml(s.email):s.email):''}
                    </div>
                    <div style="font-size:0.74rem;color:${unread?'#f0883e':'var(--text-muted)'};
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:0.15rem;">
                        ${unread?`<strong>🔵 ${typeof escapeHtml==='function'?escapeHtml(lastMsg):lastMsg}</strong>`:(typeof escapeHtml==='function'?escapeHtml(lastMsg):lastMsg)}
                    </div>
                </div>
                <span style="font-size:0.68rem;color:var(--text-muted);flex-shrink:0;">${lastTime}</span>
            </div>`;
        }).join('');

    } catch(e) {
        body.innerHTML = `<div style="text-align:center;color:#ff5858;padding:2rem;">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
    }
}

// ── Abrir hilo con un miembro de la dirección (entrenador → staff) ────────
async function openThreadWithStaff(staffUid, staffEmail, staffRole) {
    const me = window._cronosCurrentUser;
    if (!me) return;

    const threadId = `${me.uid}_${staffUid}`;
    const { db, doc, updateDoc } = await _cFS();

    const roleLabel = { director:'Director Deportivo', coordinator:'Coordinador' };
    const roleIcon  = { director:'📋', coordinator:'🎯' };

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,660px);max-height:92vh;
         display:flex;flex-direction:column;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:0.7rem;
                    margin-bottom:0.8rem;flex-shrink:0;flex-wrap:wrap;">
            <button onclick="openCoachMessaging('staff')" class="btn"
                style="font-size:0.78rem;padding:0.3rem 0.7rem;color:var(--text-muted);">
                ← Volver
            </button>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:0.9rem;">
                    ${roleIcon[staffRole]||'🏢'} ${typeof escapeHtml==='function'?escapeHtml(staffEmail):staffEmail}
                </div>
                <div style="font-size:0.7rem;color:var(--text-muted);">
                    ${roleLabel[staffRole]||staffRole}
                </div>
            </div>
            <a href="mailto:${typeof escapeAttr==='function'?escapeAttr(staffEmail):staffEmail}"
               style="padding:0.32rem 0.65rem;background:rgba(88,166,255,0.1);
                      border:1px solid rgba(88,166,255,0.3);border-radius:6px;
                      color:var(--primary);font-size:0.72rem;text-decoration:none;font-weight:700;">
                📧 Email
            </a>
        </div>
        <div id="thread-messages"
             style="flex:1;overflow-y:auto;padding:0.4rem 0;
                    display:flex;flex-direction:column;gap:0.5rem;min-height:200px;">
            <p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando…</p>
        </div>
        <div style="margin-top:0.8rem;flex-shrink:0;border-top:1px solid var(--glass-border);padding-top:0.8rem;">
            <div style="display:flex;gap:0.5rem;align-items:flex-end;">
                <textarea id="coach-msg-input"
                    placeholder="Escribe un mensaje… (Enter para enviar)"
                    rows="2"
                    style="flex:1;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.88rem;resize:none;box-sizing:border-box;"
                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){
                        event.preventDefault();
                        sendCoachMessage('${typeof escapeAttr==='function'?escapeAttr(threadId):threadId}','${typeof escapeAttr==='function'?escapeAttr(staffUid):staffUid}','${typeof escapeAttr==='function'?escapeAttr(staffEmail):staffEmail}','','staff');
                    }">
                </textarea>
                <button onclick="sendCoachMessage('${typeof escapeAttr==='function'?escapeAttr(threadId):threadId}','${typeof escapeAttr==='function'?escapeAttr(staffUid):staffUid}','${typeof escapeAttr==='function'?escapeAttr(staffEmail):staffEmail}','','staff')"
                    class="btn primary" style="padding:0.6rem 1rem;flex-shrink:0;">
                    Enviar ›
                </button>
            </div>
        </div>
    </div>`;

    await _loadThreadMessages(threadId, 'coach');
    try {
        await updateDoc(doc(db,'cronos_messages',threadId), { unreadByCoach: 0 });
    } catch(_) {}
}

async function _loadParentList() {
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    const body = document.getElementById('coach-parent-list');
    if (!body) return;

    if (typeof loadEmailConfig === 'function') await loadEmailConfig();

    try {
        const { db, collection, getDocs, query, where } = await _cFS();

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

        const contacts = (typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : [];

        contacts.forEach(c => {
            const exists = links.find(l => 
                (c.email && l.parentEmail === c.email) || 
                (c.phone && (l.parentPhone === c.phone || l.parentWA === c.phone || l.phone === c.phone)) ||
                (c.uid && (l.parentUid === c.uid || l.uid === c.uid))
            );
            
            if (!exists) {
                links.push({
                    _id:            c.id || ('m_' + Math.random().toString(36).substr(2,5)),
                    isManual:       true,
                    type:           c.type || 'staff',
                    parentUid:      c.uid || c.id,
                    parentEmail:    c.email || '',
                    parentPhone:    c.phone || '',
                    parentWA:       c.phone || '',
                    playerAlias:    c.type === 'staff' ? c.name : (c.player || c.name || 'Familiar'),
                    playerName:     c.type === 'staff' ? c.name : (c.player || c.name || 'Familiar'),
                    playerNumber:   c.type === 'staff' ? 'STAFF' : '—'
                });
            } else {
                if (c.type) exists.type = c.type;
            }
        });

        const threadsSnap = await getDocs(query(
            collection(db, 'cronos_messages'),
            where('coachUid', '==', me.uid)
        ));
        const threadsMap = {};
        threadsSnap.forEach(d => { threadsMap[d.id] = { _id: d.id, ...d.data() }; });

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
                <input type="checkbox" class="parent-select-chk"
                    data-parent-uid="${typeof escapeAttr==='function'?escapeAttr(link.parentUid||''):link.parentUid||''}"
                    data-parent-email="${typeof escapeAttr==='function'?escapeAttr(link.parentEmail||''):link.parentEmail||''}"
                    data-player="${typeof escapeAttr==='function'?escapeAttr(link.playerAlias||link.playerName||''):link.playerAlias||link.playerName||''}"
                    data-player-num="${typeof escapeAttr==='function'?escapeAttr(link.playerNumber||''):link.playerNumber||''}"
                    data-parent-wa="${typeof escapeAttr==='function'?escapeAttr(link.parentPhone||link.parentWA||''):link.parentPhone||link.parentWA||''}"
                    style="width:18px;height:18px;flex-shrink:0;accent-color:var(--primary);"
                    onchange="updateBulkCount()">
                <div onclick="openThreadWithParent('${typeof escapeAttr==='function'?escapeAttr(link.parentUid||link._id):link.parentUid||link._id}','${typeof escapeAttr==='function'?escapeAttr(link.parentEmail):link.parentEmail}',
                             '${typeof escapeAttr==='function'?escapeAttr(link.playerNumber):link.playerNumber}','${typeof escapeAttr==='function'?escapeAttr(link.playerAlias||link.playerName||''):link.playerAlias||link.playerName||''}',
                             '${typeof escapeAttr==='function'?escapeAttr(link.parentPhone||link.parentWA||''):link.parentPhone||link.parentWA||''}')"
                    style="flex:1;background:var(--glass);
                           border:1px solid ${isUnread ? 'rgba(88,166,255,0.5)' : 'var(--glass-border)'};
                           border-radius:10px;padding:0.85rem 1rem;
                           cursor:pointer;display:flex;justify-content:space-between;
                           align-items:center;gap:0.8rem;transition:all 0.15s;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:0.88rem;margin-bottom:0.15rem;">
                            ${typeIcon} ${typeof escapeHtml==='function'?escapeHtml(link.playerAlias || link.playerName || 'Contacto'):link.playerAlias || link.playerName || 'Contacto'}
                            <span style="color:var(--primary);">${typeof escapeHtml==='function'?escapeHtml(displayNum):displayNum}</span>
                        </div>
                        <div style="font-size:0.73rem;color:var(--text-muted);margin-bottom:0.2rem;">
                            ${typeof escapeHtml==='function'?escapeHtml(link.parentEmail || 'Sin email'):link.parentEmail || 'Sin email'}
                            ${link.parentPhone || link.parentWA ? ` · 📱 ${typeof escapeHtml==='function'?escapeHtml(link.parentPhone || link.parentWA):link.parentPhone || link.parentWA}` : ''}
                        </div>
                        <div style="font-size:0.76rem;
                                    color:${unread ? '#58a6ff' : 'var(--text-muted)'};
                                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            ${unread ? `<strong>🔵 ${typeof escapeHtml==='function'?escapeHtml(lastMsg):lastMsg}</strong>` : (typeof escapeHtml==='function'?escapeHtml(lastMsg):lastMsg)}
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

        const bar = document.getElementById('bulk-msg-bar');
        if (bar) bar.style.display = 'flex';

    } catch(e) {
        if (document.getElementById('coach-parent-list')) {
            document.getElementById('coach-parent-list').innerHTML =
                `<div style="text-align:center;color:#ff5858;padding:2rem;">⚠️ Error: ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
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

        <div style="display:flex;align-items:center;gap:0.7rem;
                    margin-bottom:0.8rem;flex-shrink:0;flex-wrap:wrap;">
            <button onclick="openCoachMessaging()" class="btn"
                style="font-size:0.78rem;padding:0.3rem 0.7rem;color:var(--text-muted);">
                ← Volver
            </button>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:0.9rem;">
                    ⚽ ${typeof escapeHtml==='function'?escapeHtml(playerAlias||'Jugador'):playerAlias||'Jugador'}
                    <span style="color:var(--primary);">#${typeof escapeAttr==='function'?escapeAttr(playerNumber):playerNumber}</span>
                </div>
                <div style="font-size:0.73rem;color:var(--text-muted);
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    👨‍👩‍👧 ${typeof escapeHtml==='function'?escapeHtml(parentEmail):parentEmail}
                </div>
            </div>
            <div style="display:flex;gap:0.4rem;flex-shrink:0;">
                ${parentWA ? `
                <a href="https://wa.me/${typeof escapeAttr==='function'?escapeAttr(parentWA):parentWA}" target="_blank"
                    style="padding:0.35rem 0.7rem;background:rgba(37,211,102,0.12);
                           border:1px solid rgba(37,211,102,0.4);border-radius:6px;
                           color:#25d366;font-size:0.72rem;text-decoration:none;font-weight:700;">
                    📱 WA
                </a>` : ''}
                <a href="mailto:${typeof escapeAttr==='function'?escapeAttr(parentEmail):parentEmail}"
                    style="padding:0.35rem 0.7rem;background:rgba(88,166,255,0.1);
                           border:1px solid rgba(88,166,255,0.3);border-radius:6px;
                           color:var(--primary);font-size:0.72rem;text-decoration:none;font-weight:700;">
                    📧 Email
                </a>
            </div>
        </div>

        <div id="thread-messages"
             style="flex:1;overflow-y:auto;padding:0.4rem 0;
                    display:flex;flex-direction:column;gap:0.5rem;min-height:200px;">
            <p style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ Cargando…</p>
        </div>

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
                        sendCoachMessage('${typeof escapeAttr==='function'?escapeAttr(threadId):threadId}','${typeof escapeAttr==='function'?escapeAttr(parentUid):parentUid}','${typeof escapeAttr==='function'?escapeAttr(parentEmail):parentEmail}','${typeof escapeAttr==='function'?escapeAttr(parentWA||''):parentWA||''}');
                    }">
                </textarea>
                <button onclick="sendCoachMessage('${typeof escapeAttr==='function'?escapeAttr(threadId):threadId}','${typeof escapeAttr==='function'?escapeAttr(parentUid):parentUid}','${typeof escapeAttr==='function'?escapeAttr(parentEmail):parentEmail}','${typeof escapeAttr==='function'?escapeAttr(parentWA||''):parentWA||''}')"
                    class="btn primary" style="padding:0.6rem 1rem;flex-shrink:0;">
                    Enviar ›
                </button>
            </div>
        </div>
    </div>`;

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
                        ${(typeof escapeHtml==='function'?escapeHtml(m.text):m.text).replace(/\*(.*?)\*/g,'<strong>$1</strong>')}
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
            `<div style="text-align:center;color:#ff5858;padding:1rem;">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
    }
}

// ── Enviar mensaje (entrenador) ────────────────────────────────────────────
window.sendCoachMessage = async function(threadId, recipientUid, recipientEmail, recipientWA, recipientType) {
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    recipientType = recipientType || 'parent';

    const input = document.getElementById('coach-msg-input');
    const text  = (input?.value || '').trim();
    if (!text) return;

    const { db, doc, getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();

    const newMsg = {
        sender:    'coach',
        text,
        timestamp: new Date().toISOString(),
    };

    try {
        const snap    = await getDoc(doc(db, 'cronos_messages', threadId));
        const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

        if (snap.exists()) {
            const updateData = {
                messages:      arrayUnion(newMsg),
                lastMessage:   preview,
                lastMessageAt: newMsg.timestamp,
            };
            if (recipientType === 'staff') {
                updateData.unreadByStaff = (snap.data().unreadByStaff || 0) + 1;
            } else {
                updateData.unreadByParent = (snap.data().unreadByParent || 0) + 1;
            }
            await updateDoc(doc(db, 'cronos_messages', threadId), updateData);
        } else {
            const baseDoc = {
                threadId,
                coachUid:      me.uid,
                coachEmail:    me.email,
                messages:      [newMsg],
                lastMessage:   preview,
                lastMessageAt: newMsg.timestamp,
                unreadByCoach: 0,
            };
            if (recipientType === 'staff') {
                Object.assign(baseDoc, {
                    staffUid:      recipientUid,
                    staffEmail:    recipientEmail,
                    recipientType: 'staff',
                    unreadByStaff: 1,
                });
            } else {
                Object.assign(baseDoc, {
                    parentUid:      recipientUid,
                    parentEmail:    recipientEmail,
                    recipientType: 'parent',
                    unreadByParent: 1,
                });
            }
            await setDoc(doc(db, 'cronos_messages', threadId), baseDoc);
        }

        if (input) input.value = '';
        await _loadThreadMessages(threadId, 'coach');

    } catch(e) {
        if (typeof showToast === 'function') showToast('⚠️ Error al enviar: ' + e.message, 4000);
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
            const convRows = document.querySelectorAll('.conv-row.conv-selected');
            const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}');
            
            let mode = (typeof currentMode !== 'undefined') ? currentMode : (window.currentMode || 'f11');
            
            const selectedPlayers = [];
            convRows.forEach(row => {
                const idx = row.dataset.index;
                let p = roster[mode] ? roster[mode][idx] : null;
                
                if (!p) {
                    const altMode = mode === 'f11' ? 'f7' : 'f11';
                    p = roster[altMode] ? roster[altMode][idx] : null;
                }

                if (p) {
                    selectedPlayers.push(p);
                } else {
                    const numSpan = row.querySelector('span[style*="font-weight:bold"]');
                    const num = numSpan ? parseInt(numSpan.textContent) : null;
                    if (num) {
                        selectedPlayers.push({ id: `J-${idx+1}`, number: num, alias: 'Jugador ' + num });
                    }
                }
            });
            
            const selectedIds = selectedPlayers.map(p => p.id).filter(Boolean);
            const selectedNums = selectedPlayers.map(p => p.number).filter(n => n != null);


            if (selectedPlayers.length === 0 && convRows.length > 0) {
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

        modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,560px);max-height:92vh;
             display:flex;flex-direction:column;gap:0;padding:0;background:#0d1117;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">

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

function buildConvocationRecipientsHTML(filterCriteria, prefix = 'rpt', allContacts = null) {
    const contacts = allContacts || ((typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : []);
    const staff = contacts.filter(c => c.type !== 'parent');
    
    const { ids, numbers } = filterCriteria || { ids: [], numbers: [] };

    const activeParents = contacts.filter(c => {
        if (c.type !== 'parent') return false;
        
        const matchById = c.playerId && ids.includes(c.playerId);
        if (matchById) return true;

        const matchByNum = c.playerNumber != null && numbers.includes(parseInt(c.playerNumber));
        if (matchByNum) return true;

        return false;
    });

    const allToShow = [...staff, ...activeParents];

    if (!allToShow.length) {
        return `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:1rem;">
            ⚠️ No hay contactos vinculados a los jugadores convocados.
        </div>`;
    }

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
                    <span style="font-weight:700;font-size:0.88rem;color:white;">${typeof escapeHtml==='function'?escapeHtml(c.name||'Sin nombre'):c.name||'Sin nombre'}</span>
                    <span style="font-size:0.6rem;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.05);color:var(--text-muted);font-weight:700;text-transform:uppercase;">
                        ${typeLabel}
                    </span>
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);display:flex;align-items:center;gap:0.4rem;">
                    ${typeIcon} ${c.type === 'staff' ? 'Personal del club' : `Tutor de ${typeof escapeHtml==='function'?escapeHtml(c.player||'Jugador'):c.player||'Jugador'}`}
                    ${c.playerNumber && c.playerNumber !== '—' ? `<span style="color:${accent};font-weight:700;">#${typeof escapeAttr==='function'?escapeAttr(c.playerNumber):c.playerNumber}</span>` : ''}
                </div>
            </div>
        </label>`;
    }).join('');
}

window.saveMatchReportPreselection = function() {
    const ids = Array.from(document.querySelectorAll('.rpt-recipient-chk:checked')).map(chk => chk.dataset.id);
    localStorage.setItem('cronos_match_rpt_selection', JSON.stringify(ids));
    showToast('✅ Configuración de informes guardada para este partido', 3000);
    if (typeof openConvocationModal === 'function') {
        openConvocationModal();
    } else {
        document.getElementById('setup-modal').style.display = 'none';
    }
};

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
    
    const linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('clubId', '==', me.clubId)));
    const links = [];
    linksSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

    const scoreHome = document.getElementById('score-home')?.textContent || '0';
    const scoreAway = document.getElementById('score-away')?.textContent || '0';
    const matchDate = new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'});
    const homePlayers = window.players.filter(p => p.team === 'home');
    
    const globalText = _buildGlobalReportText();
    let sentCount = 0;

    if (method === 'wa') {
        const toSend = recipients.filter(r => r.phone);
        if (!toSend.length) { showToast('⚠️ Ningún seleccionado con WA configurado.',3000); return; }
        
        toSend.forEach((r, i) => {
            setTimeout(() => {
                let text = globalText;
                if (r.type === 'parent') {
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

    showSpinner('Enviando informes internamente...');
    for (const r of recipients) {
        if (r.type === 'staff') {
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
            const link = links.find(l => (r.id && r.id.includes('p_') === false ? l.parentUid === r.id : false)
                                     || l.parentEmail === r.email 
                                     || l.parentPhone === r.phone);
            if (!link) continue;
            
            const player = homePlayers.find(p => String(p.number) === String(link.playerNumber));
            if (!player) continue;

            const reportText = _buildIndividualReportText(player, scoreHome, scoreAway, matchDate);

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
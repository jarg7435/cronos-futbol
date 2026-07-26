// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/messaging.js
//  Sistema de mensajería del Super Administrador: panel de envío masivo a
//  administradores de club e individuales y listado de conversaciones
//  (saMessages), contador de destinatarios seleccionados (saUpdateCount),
//  envío (saSendMessages), vista de un hilo con su historial (saOpenThread),
//  respuesta dentro del hilo (saSendReply), borrado de un mensaje concreto
//  (saDeleteSingleMessage) y vaciado completo de la conversación
//  (saDeleteAllMessages, botón "🗑️ Vaciar"). Incluye los dos helpers de
//  escapado privados de esta sección (saEscapeHtml / saEscapeAttr).
//
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-26, en el paso 11 y último
//  de la descomposición de ese archivo. Movimiento puramente mecánico, sin
//  cambios de lógica.
//
//  ACOPLAMIENTO: es la sección más aislada de las once.
//   · No depende de NINGÚN helper de superadmin.panel.js: no usa saFS(), ni
//     _saToast, ni _saShowSpinner/_saHideSpinner. Obtiene Firestore vía
//     window._cronos_auth más un import() dinámico propio en cada función, y
//     avisa al usuario con alert()/confirm() nativos.
//   · Fan-in externo = 0: ninguna de estas nueve funciones se referencia
//     fuera de este archivo (ni en otro .js, ni en un onclick de .html). El
//     único punto de entrada es saTab('messages') → saMessages(), y saTab se
//     queda en superadmin.panel.js. El resto de llamadas nacen dentro del
//     HTML que genera este propio módulo, resueltas en tiempo de click.
//  Por eso su orden de carga no es crítico (a diferencia de clubs-tab.js o
//  requests-tab.js); se mantiene igualmente después de superadmin.panel.js y
//  antes de extras.js por coherencia con el resto de extracciones.
//
//  ⚠️ DIVERGENCIA PREEXISTENTE, DELIBERADAMENTE NO CORREGIDA: al quedar un
//  hilo sin mensajes, saDeleteSingleMessage deja `lastMessageAt: ''` mientras
//  saDeleteAllMessages lo sella con `new Date().toISOString()`. Como
//  saMessages() ordena los hilos por lastMessageAt descendente, un hilo
//  recién vaciado con el botón "Vaciar" salta al PRINCIPIO de la lista en vez
//  de irse al final. Se preserva tal cual porque unificarlo sería un cambio
//  de comportamiento, ajeno al mandato de este refactor. Las aserciones 9e y
//  10d del test lo fijan: si algún día se unifica, son las que hay que
//  actualizar.
//
//  Otro detalle fijado por el test (2d): saEscapeAttr escapa SOLO comillas,
//  no `<`/`>`/`&`. Es inocuo mientras su salida viaje únicamente dentro de
//  atributos onclick como aquí, pero no sirve como escapado de HTML general.
//
//  Cubierto por scripts/test_sa_messaging_module.js.
// ════════════════════════════════════════════════════════════════════

function saEscapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function saEscapeAttr(str) {
    if (!str) return '';
    return str.replace(/'/g, '&#039;').replace(/"/g, '&quot;');
}

window.saMessages = async function saMessages() {
    const body = document.getElementById('sa-body');
    body.innerHTML = `<p style="color:#7d8590;text-align:center;padding:3rem;">⏳ Cargando panel de mensajería…</p>`;
    
    try {
        const fa = window._cronos_auth;
        const { collection, getDocs, query, where } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        
        // 1. Obtener todos los administradores (de club e individuales)
        const usersSnap = await getDocs(collection(fa.db, 'users'));
        const admins = [];
        
        usersSnap.forEach(d => {
            const data = d.data();
            const roles = [data.role || '', ...(data.allRoles || []).map(r => r.role || '')];
            const isAdmin = roles.some(r => ['admin', 'club_admin', 'admin_individual', 'individual', 'individual_admin'].includes(r));
            
            if (isAdmin && d.id !== window._cronosCurrentUser?.uid) {
                let adminType = 'Administrador de Club';
                if (roles.some(r => ['admin_individual', 'individual', 'individual_admin'].includes(r))) {
                    adminType = 'Administrador Individual';
                }
                
                admins.push({
                    uid: d.id,
                    email: data.email || '',
                    displayName: data.displayName || data.email || 'Admin',
                    adminType,
                    clubName: data.clubName || ''
                });
            }
        });
        
        // Ordenar
        admins.sort((a,b) => a.adminType.localeCompare(b.adminType) || a.displayName.localeCompare(b.displayName));
        
        // Obtener hilos
        const threadsSnap = await getDocs(query(
            collection(fa.db, 'cronos_messages'),
            where('participants', 'array-contains', window._cronosCurrentUser?.uid)
        ));
        
        const threads = [];
        threadsSnap.forEach(d => {
            const tData = d.data();
            if (tData.recipientType === 'superadmin' || tData.senderRole === 'superadmin' || tData.threadId?.includes('sa_')) {
                threads.push({ _id: d.id, ...tData });
            }
        });
        
        threads.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

        body.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr; gap:1.5rem; max-width:1200px; margin:0 auto;">
            <!-- Nueva conversación -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:12px; padding:1.2rem; display:flex; flex-direction:column; gap:1rem;">
                <h3 style="margin:0; font-size:1.1rem; color:white; display:flex; align-items:center; gap:0.5rem;">
                    ✉️ Nuevo Mensaje a Administradores
                </h3>
                
                <div style="border:1px solid var(--glass-border); border-radius:8px; padding:0.8rem; background:rgba(0,0,0,0.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                        <span style="font-size:0.75rem; font-weight:700; color:#8b949e;">SELECCIONAR DESTINATARIOS</span>
                        <div style="display:flex; gap:0.4rem;">
                            <button onclick="document.querySelectorAll('.sa-msg-recipient-chk').forEach(c=>c.checked=true); saUpdateCount();"
                                style="font-size:0.62rem; padding:0.18rem 0.5rem; background:rgba(88,166,255,0.1); border:1px solid rgba(88,166,255,0.3); border-radius:4px; color:#58a6ff; cursor:pointer;">
                                ✓ Todos
                            </button>
                            <button onclick="document.querySelectorAll('.sa-msg-recipient-chk').forEach(c=>c.checked=false); saUpdateCount();"
                                style="font-size:0.62rem; padding:0.18rem 0.5rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#8b949e; cursor:pointer;">
                                ✗ Ninguno
                            </button>
                        </div>
                    </div>
                    
                    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:0.5rem; max-height:220px; overflow-y:auto; padding-right:5px;">
                        ${admins.length ? admins.map(a => `
                        <label style="display:flex; align-items:center; gap:0.5rem; background:rgba(255,255,255,0.02); border:1px solid var(--glass-border); border-radius:6px; padding:0.5rem; cursor:pointer;">
                            <input type="checkbox" class="sa-msg-recipient-chk" 
                                data-uid="${saEscapeAttr(a.uid)}" 
                                data-email="${saEscapeAttr(a.email)}"
                                data-name="${saEscapeAttr(a.displayName)}"
                                onchange="saUpdateCount()"
                                style="width:15px; height:15px; accent-color:#58a6ff; flex-shrink:0;">
                            <div style="flex:1; min-width:0;">
                                <div style="font-size:0.82rem; font-weight:600; color:white; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    ${saEscapeHtml(a.displayName)}
                                </div>
                                <div style="font-size:0.68rem; color:#8b949e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    ${saEscapeHtml(a.adminType)} ${a.clubName ? `· ${saEscapeHtml(a.clubName)}` : ''}
                                </div>
                            </div>
                        </label>`).join('') : '<p style="color:#8b949e; text-align:center; padding:1rem; font-size:0.8rem;">No se encontraron administradores.</p>'}
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:0.5rem;">
                    <textarea id="sa-msg-text" placeholder="Escribe tu mensaje aquí..." rows="3"
                        style="width:100%; box-sizing:border-box; padding:0.65rem 0.8rem; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:8px; color:white; font-size:0.88rem; resize:vertical; outline:none;"></textarea>
                    <button onclick="saSendMessages()" class="btn primary" id="sa-send-btn"
                        style="padding:0.65rem; font-weight:700; border-radius:8px; cursor:pointer; width:100%;">
                        Enviar mensaje a (<span id="sa-selected-count">0</span>) destinatarios
                    </button>
                </div>
            </div>

            <!-- Hilos activos -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:12px; padding:1.2rem;">
                <h3 style="margin:0 0 1rem 0; font-size:1.1rem; color:white;">Conversaciones Recientes</h3>
                <div id="sa-threads-list" style="display:flex; flex-direction:column; gap:0.6rem;">
                    ${threads.length ? threads.map(t => {
                        const otherName = t.staffEmail || t.coachEmail || t.parentEmail || 'Administrador';
                        const lastMsg = t.lastMessage || '—';
                        const lastT = t.lastMessageAt
                            ? new Date(t.lastMessageAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                            : '';
                        
                        return `
                        <div onclick="saOpenThread('${t._id}', '${saEscapeAttr(otherName)}')"
                             style="background:var(--glass); border:1px solid var(--glass-border); border-radius:8px; padding:0.75rem 1rem; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition:all 0.15s;">
                            <div style="flex:1; min-width:0;">
                                <div style="font-weight:700; font-size:0.88rem; color:#58a6ff; margin-bottom:0.15rem;">
                                    💬 ${saEscapeHtml(otherName)}
                                </div>
                                <div style="font-size:0.76rem; color:#8b949e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    ${saEscapeHtml(lastMsg)}
                                </div>
                            </div>
                            <span style="font-size:0.68rem; color:#8b949e; flex-shrink:0;">${lastT}</span>
                        </div>`;
                    }).join('') : '<p style="color:#8b949e; text-align:center; padding:2rem; font-size:0.85rem;">No hay conversaciones iniciadas todavía.</p>'}
                </div>
            </div>
        </div>`;
    } catch(err) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:3rem;">⚠️ Error al cargar: ${saEscapeHtml(err.message)}</p>`;
    }
};

window.saUpdateCount = () => {
    const count = document.querySelectorAll('.sa-msg-recipient-chk:checked').length;
    const countEl = document.getElementById('sa-selected-count');
    if (countEl) countEl.textContent = count;
};

window.saSendMessages = async () => {
    const text = (document.getElementById('sa-msg-text')?.value || '').trim();
    if (!text) {
        alert('Escribe un mensaje antes de enviar.');
        return;
    }
    
    const selected = Array.from(document.querySelectorAll('.sa-msg-recipient-chk:checked')).map(chk => ({
        uid: chk.dataset.uid,
        email: chk.dataset.email,
        name: chk.dataset.name
    }));

    if (!selected.length) {
        alert('Selecciona al menos un destinatario.');
        return;
    }

    const btn = document.getElementById('sa-send-btn');
    if (btn) btn.disabled = true;

    try {
        const fa = window._cronos_auth;
        const { doc, getDoc, setDoc, updateDoc, arrayUnion } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const me = window._cronosCurrentUser;
        const newMsg = {
            sender: 'superadmin',
            senderUid: me.uid,
            text,
            timestamp: new Date().toISOString()
        };

        const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

        for (const s of selected) {
            const threadId = 'sa_' + [me.uid, s.uid].sort().join('_');
            
            const snap = await getDoc(doc(fa.db, 'cronos_messages', threadId));
            if (snap.exists()) {
                await updateDoc(doc(fa.db, 'cronos_messages', threadId), {
                    messages: arrayUnion(newMsg),
                    lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByParent: (snap.data().unreadByParent || 0) + 1
                });
            } else {
                await setDoc(doc(fa.db, 'cronos_messages', threadId), {
                    threadId,
                    coachUid: me.uid,
                    coachEmail: me.email || 'Super Admin',
                    staffUid: s.uid,
                    staffEmail: s.email,
                    recipientType: 'superadmin',
                    senderRole: 'superadmin',
                    clubId: null,
                    participants: [me.uid, s.uid],
                    messages: [newMsg],
                    lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByCoach: 0,
                    unreadByStaff: 1,
                    unreadByParent: 1
                });
            }
        }

        alert('Mensajes enviados correctamente.');
        saMessages();
    } catch(err) {
        if (btn) btn.disabled = false;
        alert('Error al enviar: ' + err.message);
    }
};

window.saOpenThread = async (threadId, otherName) => {
    const body = document.getElementById('sa-body');
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;

    body.innerHTML = `
    <div style="display:flex; flex-direction:column; height:500px; max-width:800px; margin:0 auto; background:rgba(255,255,255,0.02); border:1px solid var(--glass-border); border-radius:12px; padding:1.2rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem; flex-shrink:0;">
            <div style="display:flex; align-items:center; gap:0.7rem;">
                <button onclick="saMessages()" class="sa-btn" style="padding:0.35rem 0.7rem; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:7px; color:#8b949e; font-size:0.74rem; cursor:pointer;">
                    ← Volver
                </button>
                <div style="font-weight:700; font-size:0.95rem; color:white;">💬 ${saEscapeHtml(otherName)}</div>
            </div>
            <button onclick="saDeleteAllMessages('${threadId}', '${saEscapeAttr(otherName)}')"
                style="padding:0.25rem 0.55rem;background:rgba(255,88,88,0.1);
                       border:1px solid rgba(255,88,88,0.3);border-radius:6px;
                       color:#ff5858;font-size:0.7rem;cursor:pointer;font-weight:700;flex-shrink:0;">
                🗑️ Vaciar
            </button>
        </div>
        
        <div id="sa-thread-messages" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:0.5rem; padding-right:5px; margin-bottom:1rem;">
            <p style="color:#8b949e; text-align:center; padding:2rem;">⏳ Cargando mensajes…</p>
        </div>

        <div style="display:flex; gap:0.5rem; align-items:flex-end; border-top:1px solid var(--glass-border); padding-top:0.7rem; flex-shrink:0;">
            <textarea id="sa-reply-input" placeholder="Responder..." rows="2"
                style="flex:1; padding:0.55rem 0.75rem; background:rgba(255,255,255,0.06); border:1px solid var(--glass-border); border-radius:8px; color:white; font-size:0.85rem; resize:none; outline:none; box-sizing:border-box;"
                onkeydown="if(event.key==='Enter'&&!event.shiftKey){ event.preventDefault(); saSendReply('${threadId}', '${saEscapeAttr(otherName)}'); }"></textarea>
            <button onclick="saSendReply('${threadId}', '${saEscapeAttr(otherName)}')" class="sa-btn primary" id="sa-reply-btn" style="padding:0.55rem 1rem; border-radius:8px; font-weight:700; cursor:pointer;">
                Enviar ›
            </button>
        </div>
    </div>`;

    try {
        const { doc, getDoc, updateDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        
        const snap = await getDoc(doc(fa.db, 'cronos_messages', threadId));
        const container = document.getElementById('sa-thread-messages');
        
        if (!snap.exists() || !snap.data().messages?.length) {
            container.innerHTML = `<p style="color:#8b949e; text-align:center; padding:2rem;">Sin mensajes aún.</p>`;
        } else {
            const messages = snap.data().messages || [];
            container.innerHTML = messages.map((m, idx) => {
                const isMine = m.sender === 'superadmin';
                const time = m.timestamp
                    ? new Date(m.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                    : '';
                const date = m.timestamp
                    ? new Date(m.timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                    : '';

                return `
                <div style="display:flex; justify-content:${isMine ? 'flex-end' : 'flex-start'}; padding:0 0.2rem;">
                    <div style="max-width:78%; background:${isMine ? 'rgba(88,166,255,0.18)' : 'rgba(255,255,255,0.07)'}; border:1px solid ${isMine ? 'rgba(88,166,255,0.3)' : 'rgba(255,255,255,0.1)'}; border-radius:12px; padding:0.5rem 0.85rem;">
                        <div style="font-size:0.84rem; line-height:1.55; white-space:pre-wrap; color:white;">
                            ${saEscapeHtml(m.text)}
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.25rem; gap:1.5rem;">
                            <span onclick="event.stopPropagation(); saDeleteSingleMessage('${threadId}', ${idx}, '${saEscapeAttr(otherName)}')"
                                  title="Borrar mensaje"
                                  style="font-size:0.7rem; color:#ff5858; cursor:pointer; opacity:0.6; transition:opacity 0.2s;"
                                  onmouseover="this.style.opacity='1'"
                                  onmouseout="this.style.opacity='0.6'">
                                🗑️ Borrar
                            </span>
                            <div style="font-size:0.64rem; color:#8b949e; text-align:right;">
                                ${date} ${time}
                            </div>
                        </div>
                    </div>
                </div>`;
            }).join('');
            container.scrollTop = container.scrollHeight;
        }

        await updateDoc(doc(fa.db, 'cronos_messages', threadId), { unreadByCoach: 0 });
    } catch(err) {
        const container = document.getElementById('sa-thread-messages');
        if (container) container.innerHTML = `<p style="color:#ff5858; text-align:center; padding:2rem;">⚠️ Error: ${saEscapeHtml(err.message)}</p>`;
    }
};

window.saSendReply = async (threadId, otherName) => {
    const input = document.getElementById('sa-reply-input');
    const text = (input?.value || '').trim();
    if (!text) return;

    const btn = document.getElementById('sa-reply-btn');
    if (btn) btn.disabled = true;

    try {
        const fa = window._cronos_auth;
        const { doc, updateDoc, arrayUnion } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const me = window._cronosCurrentUser;
        const newMsg = {
            sender: 'superadmin',
            senderUid: me.uid,
            text,
            timestamp: new Date().toISOString()
        };

        const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

        await updateDoc(doc(fa.db, 'cronos_messages', threadId), {
            messages: arrayUnion(newMsg),
            lastMessage: preview,
            lastMessageAt: newMsg.timestamp,
            unreadByParent: 1
        });

        if (input) input.value = '';
        saOpenThread(threadId, otherName);
    } catch(err) {
        if (btn) btn.disabled = false;
        alert('Error al responder: ' + err.message);
    }
};

window.saDeleteSingleMessage = async (threadId, index, otherName) => {
    if (!confirm('¿Estás seguro de que deseas borrar este mensaje?')) return;
    const fa = window._cronos_auth;
    try {
        const { doc, getDoc, updateDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const docRef = doc(fa.db, 'cronos_messages', threadId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;
        
        const data = snap.data();
        const messages = data.messages || [];
        if (index < 0 || index >= messages.length) return;
        
        messages.splice(index, 1);
        
        let lastMessage = data.lastMessage || '';
        let lastMessageAt = data.lastMessageAt || '';
        if (messages.length > 0) {
            const last = messages[messages.length - 1];
            lastMessage = last.text.length > 60 ? last.text.substring(0, 60) + '…' : last.text;
            lastMessageAt = last.timestamp || '';
        } else {
            lastMessage = '— Sin mensajes —';
            lastMessageAt = '';
        }
        
        await updateDoc(docRef, { messages, lastMessage, lastMessageAt });
        saOpenThread(threadId, otherName);
    } catch(err) {
        alert('Error al borrar: ' + err.message);
    }
};

window.saDeleteAllMessages = async (threadId, otherName) => {
    if (!confirm('¿Estás seguro de que deseas vaciar toda la conversación? Esta acción no se puede deshacer.')) return;
    const fa = window._cronos_auth;
    try {
        const { doc, updateDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const docRef = doc(fa.db, 'cronos_messages', threadId);
        await updateDoc(docRef, {
            messages: [],
            lastMessage: '— Sin mensajes —',
            lastMessageAt: new Date().toISOString()
        });
        saOpenThread(threadId, otherName);
    } catch(err) {
        alert('Error al vaciar: ' + err.message);
    }
};


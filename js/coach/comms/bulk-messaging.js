// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL · Compositor de mensajería masiva (LEGACY)
//  Extraído de js/coach/comms/panel.js (auditoría 2026-07-22, paso 5 de 6
//  del monolito #3). Movimiento MECÁNICO: cero cambios de comportamiento.
//
//  ⚠️⚠️ LEE ESTO ANTES DE TOCAR NADA: ESTE CÓDIGO NO SE EJECUTA HOY.
//  Ni openBulkMessageComposer ni toggleSelectAllParents tienen una sola
//  llamada en todo el repositorio (updateBulkCount sólo la llama la
//  primera). Y hay una segunda razón, independiente: las tres leen la
//  clase CSS `.parent-select-chk`, que NINGÚN archivo del proyecto pinta,
//  así que ni invocándolas encontrarían destinatarios. El resto
//  (_msgSavePreselection, _msgGetSelected y los tres _sendBulkMsg*) sólo
//  cuelga del HTML que pinta el compositor, que nadie abre.
//
//  La implementación VIVA es la familia _um* de panel.js
//  (_toggleSelectAllUnified / _updateUnifiedBulkCount /
//  _openUnifiedBulkComposer), cableada desde la mensajería unificada.
//  Esto es su antecesor, anterior a la unificación.
//
//  Se movió TAL CUAL, sin borrar una línea: el mandato del refactor es
//  cero cambios de comportamiento, y declarar código muerto por decreto
//  ya salió mal en este proyecto. Si algún día se decide retirarlo, este
//  archivo es la unidad a borrar; y si se decide RECABLEARLO, hay que
//  arreglar antes las rarezas de abajo.
//
//  DEPENDE de panel.js — y de nada más de ese archivo:
//    _cFS (una llamada) y openCoachMessaging (la X, "Volver" y la vuelta
//    tras enviar). Ambas se quedan allí y resuelven vía window.
//  Y de: emailConfig (global léxico de core/app-init.js), escapeHtml,
//  escapeAttr, showToast/showSpinner/hideSpinner.
//
//  ⚠️ RAREZAS PREEXISTENTES QUE SE PRESERVAN A PROPÓSITO (las fija
//  scripts/test_bulk_messaging_module.js):
//   1. La "limpieza post-envío" de _sendBulkMsgFirestore borra
//      `cronos_match_rpt_selection` — la preselección del modal de
//      INFORMES DE PARTIDO, que vive en panel.js — y NO borra la suya,
//      `cronos_msg_preselection`. Limpia el estado de otra funcionalidad.
//   2. El hilo se construye como `${me.uid}_${parentUid}` sin pasar por
//      _cThreadId, el helper canónico del resto de la mensajería.
//   3. El envío por email mete a TODOS los destinatarios en un único
//      campo `to`, así que cada familia vería las direcciones de las
//      demás. Los informes individuales abren un mailto por familia.
//   4. showToast/showSpinner/hideSpinner y emailConfig se usan SIN guarda
//      typeof, al contrario que en el resto del monolito.
//
//  Test: scripts/test_bulk_messaging_module.js
// ════════════════════════════════════════════════════════════════════

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
                            data-uid="${typeof escapeAttr==='function'?escapeAttr(c.parentUid||''):c.parentUid||''}"
                            data-email="${typeof escapeAttr==='function'?escapeAttr(c.parentEmail):c.parentEmail}"
                            data-wa="${typeof escapeAttr==='function'?escapeAttr(c.parentWA):c.parentWA}"
                            data-id="${typeof escapeAttr==='function'?escapeAttr(c.id):c.id}"
                            ${isChecked ? 'checked' : ''}
                            style="width:15px;height:15px;flex-shrink:0;accent-color:var(--primary);">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.78rem;font-weight:600;">${typeof escapeHtml==='function'?escapeHtml(c.label):c.label}</div>
                            <div style="font-size:0.63rem;color:var(--text-muted);">
                                ${c.phone ? `📱 ${typeof escapeHtml==='function'?escapeHtml(c.phone):c.phone}` : ''}${c.phone && c.email ? ' · ' : ''}${c.email ? `📧 ${typeof escapeHtml==='function'?escapeHtml(c.email):c.email}` : ''}
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
                    unreadByParent: (snap.data().unreadByParent || 0) + 1,
                    // FIX (v180): campos de identidad
                    parentUid:    s.parentUid,
                    participants: arrayUnion(me.uid, s.parentUid),
                    clubId:       me.clubId || null,
                    recipientType: 'parent'
                });
            } else {
                await setDoc(doc(db, 'cronos_messages', threadId), {
                    threadId, coachUid: me.uid, coachEmail: me.email,
                    parentUid: s.parentUid, parentEmail: s.parentEmail,
                    // FIX (v180): campos de identidad
                    clubId: me.clubId || null,
                    participants: [me.uid, s.parentUid],
                    recipientType: 'parent',
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

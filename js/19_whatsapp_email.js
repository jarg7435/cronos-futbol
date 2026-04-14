// ══════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Envío de convocatoria por WhatsApp / Email
// ══════════════════════════════════════════════════════════════════

function openConvocationMessage() {
    // Get currently selected players from convocation screen
    const rows = document.querySelectorAll('.conv-row.conv-selected');
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}');
    const mode   = document.getElementById('setup-mode')?.value || 'f11';
    const myPlayers = roster[mode] || [];

    const selectedPlayers = Array.from(rows).map(r => myPlayers[r.dataset.index]).filter(Boolean);
    const maxSlots = mode === 'f7' ? 14 : 18;

    // Saved convocation config
    const saved = JSON.parse(localStorage.getItem('cronos_conv_config') || '{}');

    // Greeting based on current time
    const hour = new Date().getHours();
    const defaultGreeting = hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,680px);max-height:94vh;
             display:flex;flex-direction:column;overflow:hidden;">

            <!-- Header -->
            <div style="display:flex;justify-content:space-between;align-items:center;
                        margin-bottom:0.8rem;flex-shrink:0;">
                <h2 style="margin:0;font-size:1.1rem;">📲 Enviar Convocatoria</h2>
                <button onclick="openConvocationModal()"
                    style="background:none;border:none;color:var(--text-muted);
                           font-size:1.3rem;cursor:pointer;">✕</button>
            </div>

            <div style="overflow-y:auto;flex:1;padding-right:0.2rem;">

            <!-- ── DATOS DEL PARTIDO ─────────────────────────── -->
            <div style="background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.2);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:var(--primary);
                            margin-bottom:0.7rem;letter-spacing:0.5px;">⚽ DATOS DEL PARTIDO</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.55rem;">
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Saludo inicial</label>
                        <select id="cv-greeting" class="conv-input">
                            <option value="Buenos días" ${(saved.greeting||defaultGreeting)==='Buenos días'?'selected':''}>Buenos días ☀️</option>
                            <option value="Buenas tardes" ${(saved.greeting||defaultGreeting)==='Buenas tardes'?'selected':''}>Buenas tardes 🌤️</option>
                            <option value="Buenas noches" ${(saved.greeting||defaultGreeting)==='Buenas noches'?'selected':''}>Buenas noches 🌙</option>
                            <option value="Hola" ${(saved.greeting||defaultGreeting)==='Hola'?'selected':''}>Hola 👋</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Tipo de partido</label>
                        <select id="cv-type" class="conv-input">
                            <option value="amistoso" ${(saved.type||'')===  'amistoso'?'selected':''}>⚽ Amistoso</option>
                            <option value="liga" ${(saved.type||'liga')==='liga'?'selected':''}>🏆 Liga</option>
                            <option value="copa" ${(saved.type||'')==='copa'?'selected':''}>🏅 Copa</option>
                            <option value="torneo" ${(saved.type||'')==='torneo'?'selected':''}>🎖️ Torneo</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Fecha del partido</label>
                        <input id="cv-date" type="date" class="conv-input"
                            value="${typeof escapeAttr==='function'?escapeAttr(saved.date || new Date().toISOString().substring(0,10)):saved.date || new Date().toISOString().substring(0,10)}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Rival</label>
                        <input id="cv-rival" type="text" class="conv-input"
                            placeholder="Nombre del equipo rival"
                            value="${typeof escapeAttr==='function'?escapeAttr(saved.rival || ''):saved.rival || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Hora de presentación</label>
                        <input id="cv-meettime" type="time" class="conv-input"
                            value="${typeof escapeAttr==='function'?escapeAttr(saved.meettime || ''):saved.meettime || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Hora de inicio del partido</label>
                        <input id="cv-kickoff" type="time" class="conv-input"
                            value="${typeof escapeAttr==='function'?escapeAttr(saved.kickoff || ''):saved.kickoff || ''}">
                    </div>
                    <div style="grid-column:1/-1;">
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Campo / Lugar</label>
                        <input id="cv-venue" type="text" class="conv-input"
                            placeholder="Nombre del campo o dirección"
                            value="${typeof escapeAttr==='function'?escapeAttr(saved.venue || ''):saved.venue || ''}">
                    </div>
                </div>
            </div>

            <!-- ── LISTA DE CONVOCADOS ──────────────────────── -->
            <div style="background:rgba(63,185,80,0.05);border:1px solid rgba(63,185,80,0.2);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:#3fb950;
                            margin-bottom:0.7rem;letter-spacing:0.5px;">
                    👥 CONVOCADOS (${selectedPlayers.length} seleccionados)
                </div>
                ${selectedPlayers.length === 0 ? `
                    <p style="color:var(--text-muted);font-size:0.82rem;margin:0;">
                        ⚠️ No has seleccionado jugadores. Vuelve atrás y selecciónalos primero.
                    </p>` : `
                    <div id="cv-players-list" style="display:flex;flex-direction:column;gap:0.3rem;">
                        ${selectedPlayers.map((p, i) => `
                        <div style="display:flex;align-items:center;gap:0.5rem;">
                            <span style="font-size:0.72rem;color:var(--primary);font-weight:700;
                                         width:18px;text-align:right;">${i+1}.</span>
                            <input type="text" class="conv-player-name conv-input"
                                data-idx="${i}"
                                value="${typeof escapeAttr==='function'?escapeAttr(p.alias || p.name || 'Jugador ' + (i+1)):p.alias || p.name || 'Jugador ' + (i+1)}"
                                style="flex:1;padding:0.3rem 0.5rem;font-size:0.82rem;">
                        </div>`).join('')}
                    </div>
                    <p style="font-size:0.72rem;color:var(--text-muted);margin:0.5rem 0 0;">
                        💡 Puedes editar los nombres antes de enviar
                    </p>`}
            </div>

            <!-- ── MENSAJE ADICIONAL ────────────────────────── -->
            <div style="background:rgba(240,136,62,0.05);border:1px solid rgba(240,136,62,0.2);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:var(--secondary);
                            margin-bottom:0.7rem;letter-spacing:0.5px;">💬 MENSAJE EXTRA (opcional)</div>
                <textarea id="cv-extra" class="conv-input" rows="3"
                    placeholder="ej: ¡Vamos equipo! Estamos preparados para este partido. Recordad traer el equipaje completo. 💪"
                    style="resize:vertical;">${typeof escapeHtml==='function'?escapeHtml(saved.extra || ''):saved.extra || ''}</textarea>
            </div>

            <!-- ── ENVIAR A ─────────────────────────────────── -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">

                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;">
                    <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;">
                        📤 ENVIAR A
                    </div>
                    <div style="display:flex;gap:0.4rem;">
                        <button onclick="sharedSelectAll(true, 'cv')"
                            style="font-size:0.65rem;padding:0.2rem 0.6rem;background:rgba(88,166,255,0.1);
                                   border:1px solid rgba(88,166,255,0.3);border-radius:5px;
                                   color:var(--primary);cursor:pointer;">
                            ✓ Todos
                        </button>
                        <button onclick="sharedSelectAll(false, 'cv')"
                            style="font-size:0.65rem;padding:0.2rem 0.6rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.1);border-radius:5px;
                                   color:var(--text-muted);cursor:pointer;">
                            ✗ Ninguno
                        </button>
                        <button onclick="sharedSavePreselection('cv')"
                            style="font-size:0.65rem;padding:0.2rem 0.6rem;background:rgba(63,185,80,0.1);
                                   border:1px solid rgba(63,185,80,0.3);border-radius:5px;
                                   color:#3fb950;cursor:pointer;">
                            💾 Guardar selección
                        </button>
                    </div>
                </div>

                <div id="cv-recipients-list" style="display:flex;flex-direction:column;gap:0.4rem;max-height:220px;overflow-y:auto;padding-right:4px;">
                    ${sharedBuildRecipientsHTML(saved.recipients, 'cv')}
                </div>

                <p style="font-size:0.62rem;color:var(--text-muted);margin:0.5rem 0 0;">
                    💡 Marca quién recibirá esta convocatoria. Pulsa "Guardar selección" para que se recuerde siempre.
                </p>
            </div>

            </div><!-- end scroll -->

            <!-- ── BOTONES ──────────────────────────────────── -->
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;padding-top:0.8rem;
                        border-top:1px solid var(--glass-border);flex-shrink:0;margin-top:0.4rem;">
                <button onclick="openConvocationModal()" class="btn"
                    style="color:var(--text-muted);">← Volver</button>
                <button onclick="previewConvocationMsg()" class="btn"
                    style="background:rgba(88,166,255,0.1);border-color:rgba(88,166,255,0.3);
                           color:var(--primary);flex:1;">
                    👁️ Vista previa</button>
                <button onclick="publishConvocationToApp()" class="btn"
                    style="background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.4);
                           color:var(--primary);font-weight:700;">
                    📱 Envío Interno</button>
                <button onclick="sendConvocationWA()" class="btn"
                    style="background:rgba(63,185,80,0.15);border-color:rgba(63,185,80,0.4);
                           color:#3fb950;font-weight:700;">
                    📱 WhatsApp</button>
                <button onclick="sendConvocationEmail()" class="btn"
                    style="background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.4);
                           color:var(--primary);font-weight:700;">
                    📧 Email</button>
            </div>
        </div>
        <style>
        .conv-input {
            width:100%;padding:0.42rem 0.6rem;
            background:rgba(255,255,255,0.06);
            border:1px solid var(--glass-border);
            border-radius:7px;color:var(--text);font-size:0.85rem;
            box-sizing:border-box;
        }
        .conv-input:focus { outline:none;border-color:rgba(88,166,255,0.5); }
        </style>
    `;
}

// ── Construir HTML de lista de destinatarios (Compartido) ────────────
window.sharedBuildRecipientsHTML = function(savedRecipients, prefix = 'cv') {
    const allContacts = [];

    // 1. Staff / directivos desde emailConfig
    const staffContacts = (emailConfig.contacts || []).filter(c => c.type !== 'parent');
    staffContacts.forEach(c => {
        if (!c.name && !c.email && !c.phone) return;
        allContacts.push({
            id:     c.id || ('s_' + Math.random().toString(36).substr(2,5)),
            type:   'staff',
            label:  c.name || c.email || 'Staff',
            sublabel: c.email || '',
            phone:  c.phone || '',
            email:  c.email || '',
            defaultOn: (c.tags || []).includes(prefix)
        });
    });

    // 2. Padres desde emailConfig (tipo parent manual)
    const parentContacts = (emailConfig.contacts || []).filter(c => c.type === 'parent');
    parentContacts.forEach(c => {
        if (!c.name && !c.email && !c.phone) return;
        allContacts.push({
            id:     c.id || ('p_' + Math.random().toString(36).substr(2,5)),
            type:   'parent',
            label:  c.player ? `${c.name || 'Padre'} (${c.player})` : (c.name || 'Padre'),
            sublabel: c.email || '',
            phone:  c.phone || '',
            email:  c.email || '',
            defaultOn: (c.tags || []).includes(prefix)
        });
    });

    if (!allContacts.length) {
        return `<div style="text-align:center;color:var(--text-muted);font-size:0.78rem;padding:1rem 0;">
            ⚠️ No hay contactos configurados. Ve a <strong>Gestión de Contactos</strong> para añadirlos.
        </div>`;
    }

    let savedIds = null;
    try { savedIds = savedRecipients || JSON.parse(localStorage.getItem(`cronos_${prefix}_preselection`) || 'null'); } catch(e) {}

    return allContacts.map(c => {
        const checked = savedIds ? savedIds.includes(c.id) : c.defaultOn;
        const typeColor = c.type === 'staff' ? 'rgba(88,166,255,0.15)' : 'rgba(240,136,62,0.1)';
        const typeBorder = c.type === 'staff' ? 'rgba(88,166,255,0.25)' : 'rgba(240,136,62,0.2)';
        const typeTag = c.type === 'staff' ? '🏢' : '👨‍👩‍👧';

        return `
        <label style="display:flex;align-items:center;gap:0.6rem;
                       background:${typeColor};border:1px solid ${typeBorder};
                       border-radius:8px;padding:0.5rem 0.7rem;cursor:pointer;">
            <input type="checkbox" class="${prefix}-recipient-chk"
                data-id="${typeof escapeAttr==='function'?escapeAttr(c.id):c.id}"
                data-type="${typeof escapeAttr==='function'?escapeAttr(c.type):c.type}"
                data-phone="${typeof escapeAttr==='function'?escapeAttr(c.phone):c.phone}"
                data-email="${typeof escapeAttr==='function'?escapeAttr(c.email):c.email}"
                data-label="${typeof escapeAttr==='function'?escapeAttr(c.label):c.label}"
                ${checked ? 'checked' : ''}
                style="width:16px;height:16px;flex-shrink:0;accent-color:var(--primary);">
            <span style="font-size:0.72rem;flex-shrink:0;">${typeTag}</span>
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.8rem;font-weight:600;color:var(--text);">${typeof escapeHtml==='function'?escapeHtml(c.label):c.label}</div>
                <div style="font-size:0.65rem;color:var(--text-muted);">
                    ${c.phone ? `📱 ${typeof escapeHtml==='function'?escapeHtml(c.phone):c.phone}` : ''}${c.phone && c.email ? ' · ' : ''}${c.email ? `📧 ${typeof escapeHtml==='function'?escapeHtml(c.email):c.email}` : ''}
                </div>
            </div>
            <div style="display:flex;gap:0.3rem;flex-shrink:0;">
                ${c.phone ? `<span style="font-size:0.58rem;background:rgba(37,211,102,0.15);
                    border:1px solid rgba(37,211,102,0.3);border-radius:4px;
                    padding:1px 5px;color:#3fb950;">WA</span>` : ''}
                ${c.email ? `<span style="font-size:0.58rem;background:rgba(88,166,255,0.12);
                    border:1px solid rgba(88,166,255,0.25);border-radius:4px;
                    padding:1px 5px;color:var(--primary);">Email</span>` : ''}
            </div>
        </label>`;
    }).join('');
};

// ── Seleccionar/deseleccionar todos (Compartido) ─────────────────────
window.sharedSelectAll = function(val, prefix = 'cv') {
    document.querySelectorAll(`.${prefix}-recipient-chk`).forEach(chk => { chk.checked = val; });
};

// ── Guardar preselección (Compartido) ────────────────────────────────
window.sharedSavePreselection = function(prefix = 'cv') {
    const ids = Array.from(document.querySelectorAll(`.${prefix}-recipient-chk:checked`)).map(c => c.dataset.id);
    localStorage.setItem(`cronos_${prefix}_preselection`, JSON.stringify(ids));
    showToast('✅ Selección guardada como predeterminada', 2500);
};

// ── Obtener destinatarios seleccionados (Compartido) ─────────────────
window.sharedGetSelectedRecipients = function(prefix = 'cv') {
    return Array.from(document.querySelectorAll(`.${prefix}-recipient-chk:checked`)).map(chk => ({
        id:    chk.dataset.id,
        type:  chk.dataset.type,
        phone: chk.dataset.phone,
        email: chk.dataset.email,
        label: chk.dataset.label,
    }));
};

// ── Construir el mensaje de convocatoria ─────────────────────────────
function buildConvocationText() {
    const greeting  = document.getElementById('cv-greeting')?.value || 'Hola';
    const type      = document.getElementById('cv-type')?.value || 'liga';
    const dateVal   = document.getElementById('cv-date')?.value || '';
    const rival     = document.getElementById('cv-rival')?.value.trim() || '—';
    const meettime  = document.getElementById('cv-meettime')?.value || '';
    const kickoff   = document.getElementById('cv-kickoff')?.value || '';
    const venue     = document.getElementById('cv-venue')?.value.trim() || '';
    const extra     = document.getElementById('cv-extra')?.value.trim() || '';

    const dateStr = dateVal
        ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES', {
            weekday:'long', day:'numeric', month:'long'})
        : '—';

    const playerInputs = document.querySelectorAll('.conv-player-name');
    const playerLines  = Array.from(playerInputs)
        .map((el, i) => `${i + 1}. ${el.value.trim() || '—'}`)
        .join('\n');

    const typeLabels = {
        amistoso:'amistoso', liga:'de liga', copa:'de copa', torneo:'de torneo'
    };
    const typeLabel = typeLabels[type] || type;

    let msg = `${greeting} familia! 👋\n\n`;
    msg += `📋 *CONVOCATORIA*\n`;
    msg += `Partido ${typeLabel}\n`;
    msg += `📅 ${dateStr}\n`;
    msg += `🆚 vs ${rival}\n\n
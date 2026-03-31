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
                            value="${saved.date || new Date().toISOString().substring(0,10)}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Rival</label>
                        <input id="cv-rival" type="text" class="conv-input"
                            placeholder="Nombre del equipo rival"
                            value="${saved.rival || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Hora de presentación</label>
                        <input id="cv-meettime" type="time" class="conv-input"
                            value="${saved.meettime || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Hora de inicio del partido</label>
                        <input id="cv-kickoff" type="time" class="conv-input"
                            value="${saved.kickoff || ''}">
                    </div>
                    <div style="grid-column:1/-1;">
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Campo / Lugar</label>
                        <input id="cv-venue" type="text" class="conv-input"
                            placeholder="Nombre del campo o dirección"
                            value="${saved.venue || ''}">
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
                                value="${p.alias || p.name || 'Jugador ' + (i+1)}"
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
                    style="resize:vertical;">${saved.extra || ''}</textarea>
            </div>

            <!-- ── ENVÍO ────────────────────────────────────── -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);
                            margin-bottom:0.7rem;letter-spacing:0.5px;">📤 ENVIAR A</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.55rem;">
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">
                            📱 WhatsApp (número o grupo)
                        </label>
                        <input id="cv-wa" type="tel" class="conv-input"
                            placeholder="34612345678"
                            value="${saved.wa || emailConfig?.whatsappNumber || ''}">
                        <p style="font-size:0.68rem;color:var(--text-muted);margin:0.2rem 0 0;">
                            Sin + ni espacios. Ej: 34612345678
                        </p>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">
                            📧 Email
                        </label>
                        <input id="cv-email" type="email" class="conv-input"
                            placeholder="padres@equipo.com"
                            value="${saved.email || emailConfig?.directorEmail || ''}">
                    </div>
                </div>
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

    // Format date
    const dateStr = dateVal
        ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES', {
            weekday:'long', day:'numeric', month:'long'})
        : '—';

    // Player names
    const playerInputs = document.querySelectorAll('.conv-player-name');
    const playerLines  = Array.from(playerInputs)
        .map((el, i) => `${i + 1}. ${el.value.trim() || '—'}`)
        .join('\n');

    const typeLabels = {
        amistoso:'amistoso', liga:'de liga', copa:'de copa', torneo:'de torneo'
    };
    const typeLabel = typeLabels[type] || type;

    // Build message
    let msg = `${greeting} familia! 👋\n\n`;
    msg += `📋 *CONVOCATORIA*\n`;
    msg += `Partido ${typeLabel}\n`;
    msg += `📅 ${dateStr}\n`;
    msg += `🆚 vs ${rival}\n\n`;
    msg += `👥 *CONVOCADOS:*\n${playerLines}\n\n`;

    if (venue || meettime || kickoff) {
        msg += `📍 *CONCENTRACIÓN:*\n`;
        if (venue)    msg += `🏟️ Campo: ${venue}\n`;
        if (meettime) msg += `🕐 Presentarse: ${meettime}h\n`;
        if (kickoff)  msg += `⚽ Inicio del partido: ${kickoff}h\n`;
        msg += '\n';
    }

    if (extra) {
        msg += `💬 ${extra}\n\n`;
    }

    msg += `_Cronos Fútbol_ ⚽`;
    return msg;
}

// ── Guardar configuración ───────────────────────────────────────────
function saveConvConfig() {
    const cfg = {
        greeting:  document.getElementById('cv-greeting')?.value,
        type:      document.getElementById('cv-type')?.value,
        date:      document.getElementById('cv-date')?.value,
        rival:     document.getElementById('cv-rival')?.value,
        meettime:  document.getElementById('cv-meettime')?.value,
        kickoff:   document.getElementById('cv-kickoff')?.value,
        venue:     document.getElementById('cv-venue')?.value,
        extra:     document.getElementById('cv-extra')?.value,
        wa:        document.getElementById('cv-wa')?.value,
        email:     document.getElementById('cv-email')?.value,
    };
    localStorage.setItem('cronos_conv_config', JSON.stringify(cfg));
}

// ── Vista previa ────────────────────────────────────────────────────
function previewConvocationMsg() {
    saveConvConfig();
    const msg = buildConvocationText();
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,560px);max-height:90vh;
             display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;align-items:center;
                        margin-bottom:0.8rem;flex-shrink:0;">
                <h3 style="margin:0;font-size:1rem;">👁️ Vista previa del mensaje</h3>
                <button onclick="openConvocationMessage()"
                    style="background:none;border:none;color:var(--text-muted);
                           font-size:1.3rem;cursor:pointer;">✕</button>
            </div>
            <div style="background:#111;border:1px solid var(--glass-border);border-radius:10px;
                        padding:1rem;overflow-y:auto;flex:1;
                        white-space:pre-wrap;font-size:0.85rem;line-height:1.6;
                        color:var(--text);font-family:inherit;">
${msg.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\*(.*?)\*/g,'<strong>$1</strong>')}
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.8rem;flex-shrink:0;">
                <button onclick="openConvocationMessage()" class="btn"
                    style="color:var(--text-muted);flex:1;">← Editar</button>
                <button onclick="sendConvocationWA()" class="btn"
                    style="background:rgba(63,185,80,0.15);border-color:rgba(63,185,80,0.4);
                           color:#3fb950;font-weight:700;flex:1;">
                    📱 WhatsApp</button>
                <button onclick="sendConvocationEmail()" class="btn"
                    style="background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.4);
                           color:var(--primary);font-weight:700;flex:1;">
                    📧 Email</button>
            </div>
        </div>`;
}

// ── Guardar convocatoria en Firestore (para que los padres la vean) ──
async function saveConvocationToFirestore() {
    try {
        const me = window._cronosCurrentUser;
        const fa = window._cronos_auth;
        if (!fa || !me) return;

        const dateVal = document.getElementById('cv-date')?.value || '';
        const dateStr = dateVal
            ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES',{
                weekday:'long', day:'numeric', month:'long'})
            : '';
        const playerInputs = document.querySelectorAll('.conv-player-name');
        const players = Array.from(playerInputs).map(el => el.value.trim()).filter(Boolean);

        const payload = {
            type:       'convocatoria',
            clubId:     me.clubId || null,
            coachEmail: me.email  || '',
            coachUid:   me.uid    || '',
            matchDate:  dateStr,
            rival:      document.getElementById('cv-rival')?.value.trim()    || '',
            venue:      document.getElementById('cv-venue')?.value.trim()    || '',
            meettime:   document.getElementById('cv-meettime')?.value        || '',
            kickoff:    document.getElementById('cv-kickoff')?.value         || '',
            extra:      document.getElementById('cv-extra')?.value.trim()    || '',
            players,
            createdAt:  new Date().toISOString(),
        };

        const { setDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const id = 'conv_' + Date.now().toString(36);
        await setDoc(doc(fa.db, 'cronos_notifications', id), payload);
        console.log('✅ Convocatoria guardada en Firestore para los padres');
    } catch(e) {
        console.warn('saveConvocationToFirestore:', e.message);
    }
}

// ── Enviar por WhatsApp ─────────────────────────────────────────────
function sendConvocationWA() {
    saveConvConfig();
    const num = document.getElementById('cv-wa')?.value.trim()
             || JSON.parse(localStorage.getItem('cronos_conv_config')||'{}').wa || '';
    const msg = buildConvocationText();
    const encoded = encodeURIComponent(msg);
    if (num) {
        window.open(`https://wa.me/${num}?text=${encoded}`, '_blank');
    } else {
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    }
    saveConvocationToFirestore(); // guardar para padres
    showToast('📱 WhatsApp abierto — selecciona el contacto o grupo', 4000);
}

// ── Enviar por Email ────────────────────────────────────────────────
function sendConvocationEmail() {
    saveConvConfig();
    const to      = document.getElementById('cv-email')?.value.trim()
                 || JSON.parse(localStorage.getItem('cronos_conv_config')||'{}').email || '';
    const rival   = document.getElementById('cv-rival')?.value.trim() || '';
    const dateVal = document.getElementById('cv-date')?.value || '';
    const dateStr = dateVal
        ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long'})
        : '';
    const subject = encodeURIComponent(
        `⚽ Convocatoria ${dateStr ? '— ' + dateStr : ''}${rival ? ' vs ' + rival : ''}`
    );
    const body = encodeURIComponent(buildConvocationText().replace(/[*_]/g,''));
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank');
    saveConvocationToFirestore(); // guardar para padres
    showToast('📧 Email abierto en tu cliente de correo', 3000);
}
async function publishConvocationToApp() {
    const me = window._cronosCurrentUser;
    const db = window._cronos_auth.db;
    
    // Generar el mensaje base
    const fullText = buildConvocationText();
    
    // Obtener datos del formulario
    const type      = document.getElementById('cv-type')?.value || 'liga';
    const dateVal   = document.getElementById('cv-date')?.value || '';
    const rival     = document.getElementById('cv-rival')?.value.trim() || '';
    const meettime  = document.getElementById('cv-meettime')?.value || '';
    const kickoff   = document.getElementById('cv-kickoff')?.value || '';
    const venue     = document.getElementById('cv-venue')?.value.trim() || '';
    const extra     = document.getElementById('cv-extra')?.value.trim() || '';

    // Jugadores seleccionados
    const playerInputs = document.querySelectorAll('.conv-player-name');
    const playersArr   = Array.from(playerInputs).map(el => el.value.trim());

    if (playersArr.length === 0) {
        showToast('⚠️ No hay jugadores para convocar', 3000);
        return;
    }

    showSpinner('Publicando convocatoria interna…');

    try {
        const { collection, getDocs, query, where, setDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        
        // Buscar links de los padres para ESTE club
        const linksSnap = await getDocs(query(
            collection(db, 'cronos_player_links'),
            where('clubId', '==', me.clubId || '')
        ));

        const links = [];
        linksSnap.forEach(d => links.push(d.data()));

        let count = 0;
        const dateStr = dateVal ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES', {
            weekday:'long', day:'numeric', month:'long'}) : '—';

        // Enviar notificación a cada padre de los jugadores convocados
        // Nota: En una app pro, esto se haría vinculando playerNumber. 
        // Aquí iteramos para encontrar el link.
        for (const pName of playersArr) {
            const link = links.find(l => l.playerAlias === pName || l.playerName === pName);
            if (link && link.parentUid) {
                const notifId = `cv_${link.parentUid}_${Date.now().toString(36)}`;
                await setDoc(doc(db, 'cronos_notifications', notifId), {
                    type:           'convocatoria',
                    clubId:         me.clubId || null,
                    parentUid:      link.parentUid,
                    matchDate:      dateStr,
                    rival,
                    meettime,
                    kickoff,
                    venue,
                    extra,
                    players:        playersArr, // Lista completa de convocados
                    fullText,       // Por si acaso
                    createdAt:      new Date().toISOString()
                });
                count++;
            }
        }

        hideSpinner();
        showToast(`✅ Convocatoria publicada para ${count} padres`, 4000);
        setTimeout(() => { document.getElementById('setup-modal').style.display='none'; }, 1500);

    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error: ' + e.message, 5000);
    }
}

window.openConvocationMessage = openConvocationMessage;
window.publishConvocationToApp = publishConvocationToApp;

// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — COACH/TRAINING
// Training week panel, save, send
// Extraído de app.js (líneas 2508-2819)
// ══════════════════════════════════════════════════════════════════

function openTrainingPanel() {
    const isMobile = window.innerWidth < 640;
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    renderTrainingWeek();
}

function _getWeekMonday(offset) {
    const now = new Date();
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + (offset || 0) * 7);
    mon.setHours(0,0,0,0);
    return mon;
}

function renderTrainingWeek() {
    const isMobile = window.innerWidth < 640;
    const modal = document.getElementById('setup-modal');
    const offset = window._trWeekOffset || 0;
    const monday = _getWeekMonday(offset);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

    const DAYS = ['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO','DOMINGO'];
    const DAYS_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
    const dayDates = [];
    for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); dayDates.push(d); }

    const fmtD = d => d.toLocaleDateString('es-ES', {day:'numeric',month:'short'});
    const fmtDD = d => d.getDate().toString().padStart(2,'0') + '/' + (d.getMonth()+1).toString().padStart(2,'0');
    const weekKey = monday.toISOString().substring(0, 10);

    const allWeeks = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    const weekData = allWeeks[weekKey] || {};

    const typeOpts = ['','entrenamiento','partido liga','partido amistoso'];

    modal.innerHTML = `
        <div class="modal-content" style="width:min(98vw,1150px); max-height:94vh; display:flex; flex-direction:column; overflow-y:auto; padding:${isMobile ? '0.6rem' : '1.5rem'};">
            <div style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem; flex-wrap:wrap; gap:0.5rem;">
                <div>
                    <h2 style="margin:0 0 0.05rem; font-size:${isMobile ? '1rem' : '1.35rem'};">🏃 Planificación Semanal</h2>
                    <p style="font-size:0.72rem; color:var(--text-muted);">Entrenamientos y partidos de la semana</p>
                </div>
                <div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
                    <button class="btn" onclick="window._trWeekOffset=(window._trWeekOffset||0)-1; renderTrainingWeek();" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">◀</button>
                    <span style="font-size:0.82rem; font-weight:700; color:white; min-width:${isMobile?'140px':'200px'}; text-align:center;">
                        ${fmtD(monday)} — ${fmtD(sunday)}
                    </span>
                    <button class="btn" onclick="window._trWeekOffset=(window._trWeekOffset||0)+1; renderTrainingWeek();" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">▶</button>
                    <button class="btn" onclick="window._trWeekOffset=0; renderTrainingWeek();" style="padding:0.35rem 0.7rem; font-size:0.68rem; background:rgba(88,166,255,0.12); border-color:rgba(88,166,255,0.3); color:#58a6ff;">HOY</button>
                    <button class="btn" onclick="openSetupModal()" style="padding:0.35rem 0.7rem; font-size:0.68rem;">← VOLVER</button>
                </div>
            </div>

            <div style="flex:1; overflow-x:auto; border:1px solid rgba(63,185,80,0.15); border-radius:12px;">
                <table style="width:100%; border-collapse:collapse; font-size:${isMobile ? '0.7rem' : '0.8rem'};">
                    <thead>
                        <tr style="background:rgba(63,185,80,0.08);">
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">DÍA</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">🏟️ LUGAR</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">👕 EQUIPACIONES</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">📋 TIPO</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">🕐 HORA</th>
                            <th style="padding:0.55rem 0.4rem; text-align:left; color:#3fb950; font-size:0.72rem; letter-spacing:0.5px; border-bottom:2px solid rgba(63,185,80,0.25); white-space:nowrap;">⏱️ DURACIÓN</th>
                        </tr>
                    </thead>
                    <tbody>${DAYS.map((dayName, i) => {
                        const ds = dayDates[i].toISOString().substring(0, 10);
                        const dd = weekData[ds] || {};
                        const isWE = i >= 5;
                        const today = new Date(); today.setHours(0,0,0,0);
                        const isToday = dayDates[i].getTime() === today.getTime();
                        const rowBg = isToday ? 'background:rgba(88,166,255,0.06);' : (isWE ? 'background:rgba(240,136,62,0.03);' : '');
                        const optSel = (v) => typeOpts.map(o => `<option value="${o}" ${dd.tipo===o?'selected':''} style="background:#161b22;">${o ? o.charAt(0).toUpperCase()+o.slice(1) : '— Seleccionar —'}</option>`).join('');
                        return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04); ${rowBg}">
                            <td style="padding:0.45rem 0.4rem; white-space:nowrap; vertical-align:middle;">
                                <div style="font-weight:700; color:${isToday?'#58a6ff':(isWE?'#f0883e':'white')}; font-size:0.82rem;">${isMobile?DAYS_SHORT[i]:dayName} ${isToday?'●':''}</div>
                                <div style="font-size:0.68rem; color:var(--text-muted);">${fmtDD(dayDates[i])}</div>
                            </td>
                            <td style="padding:0.3rem 0.25rem;"><input type="text" class="conv-input" data-day="${ds}" data-field="lugar" value="${dd.lugar||''}" placeholder="Campo / Instalación" style="width:100%; min-width:${isMobile?'80px':'130px'}; padding:0.35rem 0.45rem; font-size:0.76rem;"></td>
                            <td style="padding:0.3rem 0.25rem;"><input type="text" class="conv-input" data-day="${ds}" data-field="equipaciones" value="${dd.equipaciones||''}" placeholder="1a / 2a equipación" style="width:100%; min-width:${isMobile?'80px':'130px'}; padding:0.35rem 0.45rem; font-size:0.76rem;"></td>
                            <td style="padding:0.3rem 0.25rem;"><select class="conv-input" data-day="${ds}" data-field="tipo" style="width:100%; min-width:${isMobile?'90px':'140px'}; padding:0.35rem 0.45rem; font-size:0.76rem; background:var(--glass); color:white; border:1px solid var(--glass-border); border-radius:6px;">${optSel()}</select></td>
                            <td style="padding:0.3rem 0.25rem;"><input type="time" class="conv-input" data-day="${ds}" data-field="hora" value="${dd.hora||''}" style="width:100%; min-width:${isMobile?'75px':'100px'}; padding:0.35rem 0.45rem; font-size:0.76rem;"></td>
                            <td style="padding:0.3rem 0.25rem;"><input type="text" class="conv-input" data-day="${ds}" data-field="duracion" value="${dd.duracion||''}" placeholder="90 min" style="width:100%; min-width:${isMobile?'70px':'90px'}; padding:0.35rem 0.45rem; font-size:0.76rem;"></td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>

            <div style="margin-top:0.8rem; display:flex; gap:0.5rem; justify-content:flex-end; flex-wrap:wrap;">
                <button class="btn" onclick="typeof openTrainingNotification==='function'?openTrainingNotification():null" style="padding:0.45rem 1.1rem; font-size:0.76rem; background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.4); color:var(--primary); font-weight:700;">📲 ENVIAR</button>
                <button class="btn" onclick="clearTrainingWeek()" style="padding:0.45rem 0.9rem; font-size:0.76rem; background:rgba(255,88,88,0.08); border:1px solid rgba(255,88,88,0.25); color:#ff5858;">🗑️ LIMPIAR</button>
                <button class="btn" onclick="saveTrainingWeek()" style="padding:0.45rem 1.1rem; font-size:0.76rem; background:rgba(63,185,80,0.15); border:1px solid rgba(63,185,80,0.4); color:#3fb950; font-weight:700;">💾 GUARDAR</button>
            </div>
        </div>`;
}

function saveTrainingWeek() {
    const offset = window._trWeekOffset || 0;
    const monday = _getWeekMonday(offset);
    const weekKey = monday.toISOString().substring(0, 10);
    const inputs = document.querySelectorAll('[data-day][data-field]');
    const weekData = {};
    inputs.forEach(inp => {
        const day = inp.dataset.day;
        const field = inp.dataset.field;
        const val = inp.value.trim();
        if (val) { if (!weekData[day]) weekData[day] = {}; weekData[day][field] = val; }
    });
    const allWeeks = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    allWeeks[weekKey] = weekData;
    localStorage.setItem('cronos_training_weeks', JSON.stringify(allWeeks));
    if (typeof showToast === 'function') showToast('✅ Semana guardada correctamente', 3000);
}

function clearTrainingWeek() {
    if (!confirm('¿Limpiar todos los datos de esta semana?')) return;
    const offset = window._trWeekOffset || 0;
    const monday = _getWeekMonday(offset);
    const weekKey = monday.toISOString().substring(0, 10);
    const allWeeks = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    delete allWeeks[weekKey];
    localStorage.setItem('cronos_training_weeks', JSON.stringify(allWeeks));
    renderTrainingWeek();
    if (typeof showToast === 'function') showToast('🗑️ Semana limpiada', 3000);
}

// ══════════════════════════════════════════════════════════════════
//  ENVIAR ENTRENAMIENTO POR WHATSAPP / EMAIL
// ══════════════════════════════════════════════════════════════════

function _getTrainingWeekText() {
    const offset = window._trWeekOffset || 0;
    const monday = _getWeekMonday(offset);
    const weekKey = monday.toISOString().substring(0, 10);
    const allWeeks = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    const weekData = allWeeks[weekKey] || {};
    if (Object.keys(weekData).length === 0) return null;

    const DAYS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
    const fmtD = d => {
        const date = new Date(d + 'T12:00:00');
        return date.toLocaleDateString('es-ES', {day:'numeric', month:'short'});
    };
    const fmtDD = d => d;

    let text = '';
    Object.keys(weekData).sort().forEach(ds => {
        const dd = weekData[ds];
        const dayIdx = new Date(ds + 'T12:00:00').getDay();
        const dayNum = dayIdx === 0 ? 6 : dayIdx - 1;
        const dayName = DAYS[dayNum];
        text += `📅 *${dayName} ${fmtD(ds)}*\n`;
        if (dd.tipo)    text += `📋 ${dd.tipo}\n`;
        if (dd.hora)    text += `🕐 ${dd.hora}\n`;
        if (dd.duracion) text += `⏱️ ${dd.duracion}\n`;
        if (dd.lugar)   text += `🏟️ ${dd.lugar}\n`;
        if (dd.equipaciones) text += `👕 ${dd.equipaciones}\n`;
        text += '\n';
    });
    return text.trim();
}

function openTrainingSendPanel(target) {
    const weekText = _getTrainingWeekText();
    if (!weekText) {
        if (typeof showToast === 'function') showToast('⚠️ No hay entrenamientos para enviar esta semana', 3000);
        return;
    }

    const isParents = target === 'parents';
    const isCoordinators = target === 'coordinators';
    window._trTarget = target;

    const hour = new Date().getHours();
    const greeting = hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';

    let title;
    if (isParents) title = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Enviar Entrenamiento a Padres';
    else if (isCoordinators) title = '\u{1F3AF} Enviar Entrenamiento a Coordinadores';
    else title = '\u{1F4CB} Enviar Entrenamiento a Directores';

    const saved = JSON.parse(localStorage.getItem('cronos_conv_config') || '{}');

    // Build preview message
    const fullMessage = isParents
        ? `${greeting} familia! 👋\n\n🏃 *PLANIFICACIÓN SEMANAL*\n\n${weekText}\n_Cronos Fútbol_ ⚽`
        : `${greeting}! 👋\n\n🏃 *PLANIFICACIÓN SEMANAL*\n\n${weekText}\n_Cronos Fútbol_ ⚽`;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,680px);max-height:94vh;
             display:flex;flex-direction:column;overflow:hidden;padding:1.5rem;">

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <h2 style="margin:0;font-size:1.1rem;">${title}</h2>
                <button onclick="renderTrainingWeek()"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
            </div>

            <!-- Saludo -->
            <div style="margin-bottom:0.8rem;">
                <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">Saludo inicial</label>
                <select id="tr-greeting" class="conv-input" onchange="updateTrainingPreview()">
                    <option value="Buenos días" ${greeting==='Buenos días'?'selected':''}>Buenos días ☀️</option>
                    <option value="Buenas tardes" ${greeting==='Buenas tardes'?'selected':''}>Buenas tardes 🌤️</option>
                    <option value="Buenas noches" ${greeting==='Buenas noches'?'selected':''}>Buenas noches 🌙</option>
                    <option value="Hola" ${greeting==='Hola'?'selected':''}>Hola 👋</option>
                </select>
            </div>

            <!-- Mensaje extra -->
            <div style="margin-bottom:0.8rem;">
                <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">💬 Mensaje extra (opcional)</label>
                <textarea id="tr-extra" class="conv-input" rows="2" placeholder="ej: Recordad traer botellas de agua 💧"
                    oninput="updateTrainingPreview()"></textarea>
            </div>

            <!-- Vista previa -->
            <div style="background:rgba(63,185,80,0.05);border:1px solid rgba(63,185,80,0.2);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;flex:1;overflow-y:auto;">
                <div style="font-size:0.78rem;font-weight:700;color:#3fb950;margin-bottom:0.5rem;">👁️ Vista previa</div>
                <pre id="tr-preview" style="font-family:inherit;font-size:0.82rem;white-space:pre-wrap;
                     color:var(--text);margin:0;line-height:1.5;">${fullMessage}</pre>
            </div>

            <!-- Destinatarios -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;">
                <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);margin-bottom:0.5rem;">📤 ENVIAR A</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.55rem;">
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">📱 WhatsApp</label>
                        <input id="tr-wa" type="tel" class="conv-input" placeholder="34612345678"
                            value="${saved.wa || emailConfig?.whatsappNumber || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">📧 Email</label>
                        <input id="tr-email" type="email" class="conv-input" placeholder="directores@club.com"
                            value="${saved.email || emailConfig?.directorEmail || ''}">
                    </div>
                </div>
            </div>

            <!-- Botones -->
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;padding-top:0.8rem;
                        border-top:1px solid var(--glass-border);">
                <button onclick="renderTrainingWeek()" class="btn" style="color:var(--text-muted);">← Volver</button>
                <button onclick="sendTrainingWA()" class="btn"
                    style="background:rgba(63,185,80,0.15);border-color:rgba(63,185,80,0.4);
                           color:#3fb950;font-weight:700;flex:1;">📱 WhatsApp</button>
                <button onclick="sendTrainingEmail()" class="btn"
                    style="background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.4);
                           color:var(--primary);font-weight:700;flex:1;">📧 Email</button>
            </div>
        </div>
        <style>
        .conv-input {
            width:100%;padding:0.42rem 0.6rem;
            background:rgba(255,255,255,0.06);
            border:1px solid var(--glass-border);
            border-radius:7px;color:var(--text);font-size:0.85rem;box-sizing:border-box;
        }
        .conv-input:focus { outline:none;border-color:rgba(88,166,255,0.5); }
        </style>
    `;
}

function updateTrainingPreview() {
    const preview = document.getElementById('tr-preview');
    if (!preview) return;
    const greeting = document.getElementById('tr-greeting')?.value || 'Hola';
    const extra = document.getElementById('tr-extra')?.value.trim();
    const weekText = _getTrainingWeekText() || 'No hay entrenamientos';

    const isParents = window._trTarget === 'parents';
    const audience = isParents ? 'familia! 👋' : '! 👋';
    let msg = `${greeting} ${audience}\n\n🏃 *PLANIFICACIÓN SEMANAL*\n\n${weekText}`;
    if (extra) msg += `\n💬 ${extra}\n`;
    msg += `\n_Cronos Fútbol_ ⚽`;
    preview.textContent = msg;
}

function sendTrainingWA() {
    const preview = document.getElementById('tr-preview');
    const wa = document.getElementById('tr-wa')?.value.trim();
    if (!preview || !wa) {
        if (typeof showToast === 'function') showToast('⚠️ Introduce un número de WhatsApp', 3000);
        return;
    }
    const text = encodeURIComponent(preview.textContent);
    window.open('https://wa.me/' + wa.replace(/[^0-9]/g, '') + '?text=' + text, '_blank');
}

function sendTrainingEmail() {
    const preview = document.getElementById('tr-preview');
    const email = document.getElementById('tr-email')?.value.trim();
    if (!preview || !email) {
        if (typeof showToast === 'function') showToast('⚠️ Introduce un email', 3000);
        return;
    }
    const subject = encodeURIComponent('Planificación Semanal - Entrenamiento');
    const body = encodeURIComponent(preview.textContent);
    window.open('mailto:' + email + '?subject=' + subject + '&body=' + body, '_blank');
}

// ══════════════════════════════════════════════════════════════════
//  CUERPO TÉCNICO
// ══════════════════════════════════════════════════════════════════


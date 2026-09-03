// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL · Envío MANUAL de informes de partido
//  Extraído de js/coach/comms/panel.js (auditoría 2026-07-22, paso 6a de
//  6b del monolito #3). Movimiento MECÁNICO: cero cambios de
//  comportamiento.
//
//  El §8 original eran 1359 líneas en DOS CAMINOS INDEPENDIENTES
//  (verificado en ambos sentidos: cero referencias cruzadas):
//    · ESTE archivo — el camino MANUAL: el entrenador abre la modal,
//      elige destinatarios y envía.
//    · js/coach/comms/match-reports-auto.js — el camino AUTOMÁTICO
//      (autoDispatchMatchReports / saveAllMatchReportsInternal), que se
//      dispara solo al terminar el partido. Paso 6b.
//  Son implementaciones casi simétricas: mismos helpers, mismas
//  colecciones. Si cambias la lógica de envío, mira LAS DOS.
//
//  Contenido:
//    · sendMatchReportsToParents()      — la modal de destinatarios
//    · buildConvocationRecipientsHTML() — la lista en modo convocatoria
//    · saveMatchReportPreselection()    — guarda la preselección
//    · _buildGlobalReportText()         — el resumen del equipo
//    · _buildIndividualReportText()     — el informe de un jugador
//    · _executeReportsSend(method)      — el envío: wa | email | internal
//
//  ⚠️ AQUÍ NO HAY CÓDIGO MUERTO. Este es el camino por el que las
//  familias reciben los informes cuando el entrenador los manda a mano.
//  Entrada externa: js/match/persistence/team-persistence.js, con guarda
//  typeof.
//
//  DEPENDE de panel.js — SIETE helpers, y de nada más de ese archivo:
//    _cFS, _cMatchSubcatFor, _cMyTeamKey, _cResolveClubId,
//    _cStaffThreadId, _cronosResolveParentReportTargets,
//    _parseHistoryForFirestore
//  (_cGetStaff lo usa sólo la mitad automática.) Resuelven vía window en
//  tiempo de llamada, así que el orden de <script> no condiciona nada.
//  Y de js/shared/whatsapp-email.js (sharedGetSelectedRecipients,
//  sharedBuildRecipientsHTML, sharedSelectAll) más los globales léxicos
//  emailConfig / currentMode / currentCategory / TEAM_NAMES.
//
//  ⚠️ DOS RAREZAS PREEXISTENTES QUE SE PRESERVAN (las fija
//  scripts/test_match_reports_send_module.js):
//   1. El "guard anti-duplicados" del modo interno calcula
//      `_autoAlreadyRan` a partir de window._cronosLastDispatchedMatch...
//      y el `if` que lo consume está VACÍO. La variable no se usa. El
//      único efecto real de que el auto-despacho ya haya corrido es que
//      se reutiliza su matchId para sobrescribir en vez de duplicar.
//   2. _buildGlobalReportText hace window.players.filter SIN guarda: si
//      no hay partido en curso, lanza TypeError. Hoy sólo se le llama
//      desde _executeReportsSend, que corre tras haber jugado.
//  Además la modal tiene DOS papeles excluyentes: con partido en curso
//  ofrece ENVIAR; en modo convocatoria sólo GUARDAR la preselección.
//
//  Test: scripts/test_match_reports_send_module.js
// ════════════════════════════════════════════════════════════════════

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
            const roster = window.cronosPlantillaAmbas();   // v580 · la del EQUIPO abierto
            
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
                            ${isSetupMode ? 'Selección previa para el despacho automático' : 'Envía el reporte del partido a los familiares / jugadores autorizados'}
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
                        El <strong>Staff Directivo</strong> recibirá un resumen global del partido. Los <strong>Familiares / Jugadores</strong> recibirán el informe individual detallado del jugador.
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

    // ⛔ SIN ROL DE FAMILIAS NO HAY NI UN PADRE EN LA LISTA. El staff se queda:
    //    esta pantalla manda el informe del partido también al director y al
    //    coordinador, y eso no tiene nada que ver con el colectivo de familias
    //    (decisión suya al pedir la exclusión, 2026-08-24).
    const _hayFamilias = (typeof window.cronosHayPadres !== 'function') || window.cronosHayPadres();

    // Filtramos los padres: solo si su playerId o playerNumber coincide con la convocatoria
    const activeParents = !_hayFamilias ? [] : contacts.filter(c => {
        if (c.type !== 'parent') return false;

        // 1. Intentar por ID único (J-01, etc)
        const matchById = c.playerId && ids.includes(c.playerId);
        if (matchById) return true;

        // 2. Intentar por Número de dorsal como fallback
        const matchByNum = c.playerNumber != null && numbers.includes(parseInt(c.playerNumber));
        if (matchByNum) return true;

        return false;
    });

    // ── UNA línea por familiar y código de jugador ────────────────────
    // Mismo criterio que la lista de fin de partido (sharedBuildRecipientsHTML):
    // los cuatro orígenes de contactos traían cada uno su copia del mismo
    // padre. Ver _cronosDedupeRecipients en core/utils.js — un padre con DOS
    // hijos convocados SIGUE viendo dos líneas, porque son dos informes.
    const allToShow = (typeof window._cronosDedupeRecipients === 'function')
        ? window._cronosDedupeRecipients([...staff, ...activeParents])
        : [...staff, ...activeParents];

    if (!allToShow.length) {
        return `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:1rem;">
            ⚠️ No hay contactos vinculados a los jugadores convocados.
        </div>`;
    }

    // Cargar preselección guardada
    let savedIds = JSON.parse(localStorage.getItem(`cronos_match_rpt_selection`) || 'null');

    return allToShow.map(c => {
        // 🔑 Contra TODOS los ids fusionados: una preselección guardada con el
        // id de una copia descartada tiene que seguir marcando la casilla.
        const idsDeLaLinea = Array.isArray(c._ids) && c._ids.length ? c._ids : [c.id];
        const checked = savedIds
            ? idsDeLaLinea.some(id => savedIds.includes(id))
            : (c.tags || []).includes(prefix);
        const typeIcon = c.type === 'staff' ? '🏢' : '👨‍👩‍👧';
        const typeLabel = c.type === 'staff' ? 'Staff' : 'Familiar / Jugador';
        const accent = c.type === 'staff' ? 'var(--primary)' : '#f0883e';

        return `
        <label style="display:flex;align-items:center;gap:0.8rem;background:rgba(255,255,255,0.03);
                      border:1px solid ${checked ? accent : 'rgba(255,255,255,0.08)'};
                      border-radius:12px;padding:0.8rem 1rem;cursor:pointer;transition:all 0.2s;
                      ${checked ? `box-shadow:inset 0 0 10px ${accent}1a;` : ''}">
            <input type="checkbox" class="${prefix}-recipient-chk" 
                data-id="${typeof escapeAttr==='function'?escapeAttr(c.id):c.id}"
                data-type="${typeof escapeAttr==='function'?escapeAttr(c.type):c.type}"
                data-phone="${typeof escapeAttr==='function'?escapeAttr(c.phone||''):c.phone||''}"
                data-email="${typeof escapeAttr==='function'?escapeAttr(c.email||''):c.email||''}"
                data-label="${typeof escapeAttr==='function'?escapeAttr(c.name||''):c.name||''}"
                data-playerid="${typeof escapeAttr==='function'?escapeAttr(c.playerId||''):c.playerId||''}"
                data-playernumber="${typeof escapeAttr==='function'?escapeAttr(c.playerNumber||''):c.playerNumber||''}"
                ${checked ? 'checked' : ''}
                style="width:20px;height:20px;accent-color:${accent};">
            
            <div style="flex:1;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.15rem;">
                    <span style="font-weight:700;font-size:0.88rem;color:white;">${typeof escapeHtml==='function'?escapeHtml(c.name||'Sin nombre'):c.name||'Sin nombre'}</span>
                    <span style="font-size:0.6rem;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.05);color:var(--text-muted);font-weight:700;text-transform:uppercase;">
                        ${typeLabel}
                    </span>
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);display:flex;align-items:center;gap:0.4rem;">
                    ${typeIcon} ${c.type === 'staff' ? 'Personal del club' : `Familiar / Jugador · ${typeof escapeHtml==='function'?escapeHtml(c.player||'Jugador'):c.player||'Jugador'}`}
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
    const homePlayers = window.players.filter(p => p.team === _cMyTeamKey());
    
    let text = `📊 *RESUMEN GLOBAL DEL PARTIDO*\n━━━━━━━━━━━━━━━━\n`;
    text += `📅 ${matchDate}\n`;
    text += `⚽ ${TEAM_NAMES?.home||'Local'} *${scoreHome}* - *${scoreAway}* ${TEAM_NAMES?.away||'Visitante'}\n━━━━━━━━━━━━━━━━\n\n`;
    
    homePlayers.forEach(p => {
        const cardIcon = p.cards === 'amarilla' ? '🟨' : p.cards === 'roja' ? '🟥' : '—';
        text += `👤 ${p.name} - ${window.formatTime ? window.formatTime(p.time||0) : p.time||0} min\n`;
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

    // Bug 1 (v174): resolver el clubId desde Firestore si el token no lo trae.
    // Sin clubId, las reglas de cronos_messages/notifications/reports rechazan
    // el envío al staff y a los padres. Se cachea en me.clubId para esta sesión.
    const _clubId = await _cResolveClubId(db, me, { doc, getDoc });
    if (_clubId && !me.clubId) me.clubId = _clubId;

    // Obtener vínculos con timeout de seguridad y soporte para Admin Individual
    const links = [];
    try {
        const _linksTimeout = new Promise(r => setTimeout(() => r(null), 6000));
        
        // Query base: por clubId
        let linksQuery = query(collection(db, 'cronos_player_links'), where('clubId', '==', me.clubId || '---'));
        
        // Si es admin individual o no hay clubId, buscar por individualOwnerId o coachUid
        if (!me.clubId) {
            linksQuery = query(collection(db, 'cronos_player_links'), where('individualOwnerId', '==', me.uid));
        }

        const linksSnapRaw = await Promise.race([
            getDocs(linksQuery),
            _linksTimeout
        ]);

        if (linksSnapRaw) linksSnapRaw.forEach(d => links.push({ _id: d.id, ...d.data() }));

        // Fallback: si sigue vacío y no hay clubId, probar por coachUid
        if (links.length === 0 && !me.clubId) {
            const fbSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('coachUid', '==', me.uid)));
            fbSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));
        }
    } catch(errLinks) {
        console.warn('[Chronos] Error recuperando vínculos:', errLinks);
    }

    const scoreHome = document.getElementById('score-home')?.textContent || '0';
    const scoreAway = document.getElementById('score-away')?.textContent || '0';
    const rivalName = (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES && TEAM_NAMES.away) ? TEAM_NAMES.away : 'Rival';
    const matchDate = new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'});
    const homePlayers = window.players.filter(p => p.team === _cMyTeamKey());
    
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
    // FIX: Guard anti-duplicados — si autoDispatchMatchReports ya envió los informes
    // para este partido, el envío manual solo debe procesar destinatarios adicionales
    // que no fueron cubiertos por el auto-despacho.
    const _autoAlreadyRan = !!window._cronosLastDispatchedMatch;
    if (_autoAlreadyRan) {
    }
    if (window._cronosDiagReports) {
    }
    showSpinner('Enviando informes internamente...');
    // Generar matchId compartido para todos los destinatarios de staff de este envío.
    // FIX v3: Si el auto-despacho ya generó un matchId para este partido,
    // reutilizarlo para que los documentos se sobreescriban en vez de duplicarse.
    const _sharedMatchId = window._cronosLastAutoDispatchMatchId
        || (() => {
            const _d = new Date().toISOString().split('T')[0];
            const _rs = (rivalName||'rival').replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0,20);
            const _sh = document.getElementById('score-home')?.textContent||'0';
            const _sa = document.getElementById('score-away')?.textContent||'0';
            return `match_${me.uid}_${_d}_${_rs}_${_sh}x${_sa}`;
        })();
    let _staffReportsWritten = false; // guard: escribir docs de staff solo una vez por envío
    // v171: destinatarios de padres resueltos (lazy) con el helper compartido,
    // para que el despacho manual use EXACTAMENTE la misma lógica que el automático.
    let _parentTargetsManual = null;  // Array<{parentUid,dorsal,player}> o null si aún no resuelto
    let _parentTargetsByUid = null;   // Map<parentUid, target>
    try {
        for (const r of recipients) {
            if (r.type === 'staff') {
                // Enviar notificación global al UID del staff si lo tiene
                let uidToNotify = null;
                if (typeof emailConfig !== 'undefined' && emailConfig.contacts) {
                    const c = emailConfig.contacts.find(x => x.id === r.id || x.phone === r.phone || x.email === r.email);
                    if (c && c.uid) uidToNotify = c.uid;
                }
                // También intentar resolver por r.id directamente (uid del destinatario)
                if (!uidToNotify && r.id && !r.id.startsWith('p_')) uidToNotify = r.id;

                if (uidToNotify) {
                    // ── 1. Notificación push/UI ──────────────────────────────────────
                    // FIX: añadido userId para que las reglas de Firestore funcionen
                    if (!_autoAlreadyRan) {
                    await setDoc(doc(db, 'cronos_notifications', `notif_matchsglobe_${uidToNotify}_${Date.now().toString(36)}`), {
                        type:      'aviso_partido_finalizado',
                        clubId:    me.clubId || null,
                        userId:    uidToNotify,            // ← FIX: campo que las reglas verifican
                        coachUid:  me.uid,                // ← FIX (C3): coachUid para reglas Firestore
                        parentUid: uidToNotify,
                        staffUid:  uidToNotify,
                        matchDate,
                        rival:     rivalName,
                        scoreHome, scoreAway,
                        message:   globalText.replace(/[*_]/g,''),
                        createdAt: new Date().toISOString()
                    });
                    } // fin guard anti-duplicado

                    // ── 2. Hilo de mensajes unificado (mismo formato que auto-despacho) ──
                    // Usamos {clubId}_{staffUid} para que el hilo pertenezca al CLUB
                    // (sameClubAsDoc pasa siempre) y coincida con autoDispatchMatchReports.
                    // FIX v176: Se eliminó el getDoc previo porque si el hilo fue creado
                    // por OTRO entrenador del club, el getDoc falla con permission-denied
                    // (el entrenador actual no está en participants del doc ajeno).
                    // Ahora usamos patrón updateDoc→setDoc: intentar actualizar primero,
                    // y si falla (hilo no existe), crearlo.
                    const threadId = _cStaffThreadId(me.clubId, me.uid, uidToNotify);
                    const msgEntry = { sender: 'coach', text: globalText, timestamp: new Date().toISOString(), type: 'collective_report' };
                    try {
                        // Intentar actualizar el hilo existente (añadir mensaje)
                        // FIX (v180): Incluir campos de identidad para consultas del director/coordinador
                        await updateDoc(doc(db, 'cronos_messages', threadId), {
                            messages: arrayUnion(msgEntry),
                            lastMessage: '📊 Informe colectivo de partido',
                            lastMessageAt: msgEntry.timestamp,
                            unreadByStaff: (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.FieldValue.increment(1) : 1,
                            // FIX (v180): campos de identidad para consultas del director/coordinador
                            staffUid:      uidToNotify,
                            parentUid:     uidToNotify,
                            participants:  arrayUnion(me.uid, uidToNotify),
                            clubId:        me.clubId || null,
                            recipientType: 'staff'
                        });
                    } catch(updateErr) {
                        // Si update falla (hilo no existe o sin permiso de update),
                        // intentar crear el hilo con setDoc.
                        try {
                            await setDoc(doc(db, 'cronos_messages', threadId), {
                                threadId,
                                coachUid:      me.uid,
                                coachEmail:    me.email,
                                clubId:        me.clubId || null,     // ← FIX: para reglas Firestore
                                participants:  [me.uid, uidToNotify], // ← FIX: para reglas Firestore
                                staffUids:     [uidToNotify],         // ← FIX: lectura staff por array-contains
                                staffUid:      uidToNotify,
                                parentUid:     uidToNotify,           // FIX (v180): club-reports.js busca por parentUid
                                recipientType: 'staff',
                                messages:      [msgEntry],
                                lastMessage:   '📊 Informe colectivo de partido',
                                lastMessageAt: msgEntry.timestamp,
                                unreadByCoach: 0,
                                unreadByStaff: 1
                            });
                        } catch(setErr) {
                            if(window._CRONOS_DEBUG) console.warn('[Chronos] Error creando hilo staff:', {
                                code: setErr && setErr.code,
                                message: setErr && setErr.message,
                                threadId,
                                staffUid: uidToNotify,
                                coachClubId: me.clubId || null,
                            }, setErr);
                        }
                    }

                    // ── 3. CORRECCIÓN PRINCIPAL: escribir cronos_player_reports ────
                    // El panel de Dirección/Coordinación (_sdLoadReports) SOLO lee
                    // documentos de cronos_player_reports con staffReport===true.
                    // El despacho manual nunca los escribía → panel de Informes vacío.
                    // Se escriben UNA SOLA VEZ (guard _staffReportsWritten) con el
                    // matchId compartido para que todos los staff vean el mismo partido.
                    // FIX: solo escribir si auto-despacho no lo hizo ya.
                    if (!_staffReportsWritten && !_autoAlreadyRan) {
                        _staffReportsWritten = true;
                        // Recopilar UIDs de todos los destinatarios staff
                        const _manualStaffUids = recipients.filter(rx => rx.type === 'staff').map(rx => {
                            if (typeof emailConfig !== 'undefined' && emailConfig.contacts) {
                                const cx = emailConfig.contacts.find(x => x.id === rx.id);
                                if (cx && cx.uid) return cx.uid;
                            }
                            return (rx.id && !rx.id.startsWith('p_')) ? rx.id : null;
                        }).filter(Boolean);

                        try {
                            for (const p of homePlayers) {
                                const srId = `${_sharedMatchId}_staff_p${p.number}`;
                                await setDoc(doc(db, 'cronos_player_reports', srId), {
                                    matchId:       _sharedMatchId,
                                    type:          'staff_match_report',
                                    staffReport:   true,
                                    staffUids:     _manualStaffUids, // ← FIX: UIDs para reglas Firestore
                                    clubId:        me.clubId || null,
                                    coachUid:      me.uid,
                                    coachEmail:    me.email,
                                    matchDate:     new Date().toISOString().split('T')[0],
                                    rival:         rivalName,
                                    scoreHome,
                                    scoreAway,
                                    category:      (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                                   (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') || '',
                                    subcategory:   _cMatchSubcatFor(me, (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                                   (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') || ''),
                                    // Clave de equipo (el informe es del equipo).
                                    teamId:        (typeof window.cronosTeamId === 'function')
                                                     ? window.cronosTeamId(
                                                         me.clubId || '',
                                                         (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                                           (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') || '',
                                                         _cMatchSubcatFor(me, (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                                           (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') || ''))
                                                     : '',
                                    venue:         (typeof window.matchVenue !== 'undefined' ? window.matchVenue : ''),
                                    competition:   (typeof window.matchCompetition !== 'undefined' ? window.matchCompetition : ''),
                                    matchTime:     (typeof window.matchTime !== 'undefined' ? window.matchTime : ''),
                                    duration:      (typeof window.matchDuration !== 'undefined' ? window.matchDuration : ''),
                                    stoppageTime:  (typeof window.stoppageTime !== 'undefined' ? window.stoppageTime : 0),
                                    createdAt:     new Date().toISOString(),
                                    ...(typeof window.cronosGuestFields === 'function' ? window.cronosGuestFields(p) : {}),
                                    playerNumber:  String(p.number || ''),
                                    playerAlias:   p.alias || p.name || '',
                                    position:      p.position || p.pos || '',
                                    goals:         p.goals  || 0,
                                    cards:         p.cards  || null,
                                    injured:       p.injured || false,
                                    minutesPlayed: window.formatTime ? window.formatTime(p.time || 0) : String(p.time || 0),
                                    wasStarter:    typeof window.cronosFueTitular === 'function' ? window.cronosFueTitular(p) : false,
                                    history:       typeof _parseHistoryForFirestore === 'function'
                                                       ? _parseHistoryForFirestore(p.history || [])
                                                       : (p.history || []),
                                });
                            }
                        } catch(srErr) {
                            console.warn('[Chronos] Error escribiendo cronos_player_reports para staff:', srErr);
                        }
                    }

                    sentCount++;
                }
            } 
            else if (r.type === 'parent') {
                // ── REDISEÑO v171: misma lógica ESTRICTA que el auto-despacho ──
                // Resolvemos los destinatarios válidos UNA sola vez con el helper
                // compartido (_cronosResolveParentReportTargets): contactos 'parent'
                // con checkbox INF (tag 'rpt'), inviteCode válido, parentUid real y
                // jugador convocado. Emparejado SOLO por dorsal, nunca por nombre.
                if (!_parentTargetsManual) {
                    const _mc = (typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : [];
                    // FIX (v217): en el envio manual, usar la pre-seleccion per-partido
                    // (si existe) como autoridad. Si el modal no se uso, caer a tag 'rpt'.
                    let _manualAuthIds = null;
                    try {
                        const _raw = localStorage.getItem('cronos_match_rpt_selection');
                        if (_raw) {
                            const _parsed = JSON.parse(_raw);
                            if (Array.isArray(_parsed) && _parsed.length > 0) _manualAuthIds = _parsed;
                        }
                    } catch(_) {}
                    // Si no hay pre-seleccion per-partido, construir authorizedIds a
                    // partir de los checkboxes ACTUALMENTE marcados en el DOM
                    // (recipients ya viene de sharedGetSelectedRecipients('rpt')).
                    if (!_manualAuthIds && Array.isArray(recipients) && recipients.length > 0) {
                        _manualAuthIds = recipients.map(r => String(r.id)).filter(Boolean);
                    }
                    _parentTargetsManual = _cronosResolveParentReportTargets(_mc, links, homePlayers, _manualAuthIds);
                    _parentTargetsByUid = new Map(_parentTargetsManual.map(t => [t.parentUid, t]));
                }

                // Emparejar el recipient contra los targets YA validados por el
                // helper, usando los MISMOS campos que el helper (uid/id/email/phone).
                // FIX Bug 2: antes se re-resolvía recipientParentUid con menos vías
                // (solo parentUid/email/phone), lo que dejaba fuera a contactos
                // manuales emparejados por playerId/id/uid -> falsos "omitido".
                const _normE = (e) => (typeof window._cronosNormEmail === 'function')
                    ? window._cronosNormEmail(e) : String(e || '').trim().toLowerCase();

                // 1) Por parentUid directo (r.id es un UID).
                let target = (r.id && !r.id.startsWith('p_'))
                    ? _parentTargetsByUid.get(r.id) : null;

                // 2) Si no, emparejar por el contacto que originó cada target.
                if (!target) {
                    target = _parentTargetsManual.find(t => {
                        const c = t.contact || {};
                        return (c.uid && r.id && c.uid === r.id)
                            || (c.id && r.id && c.id === r.id)
                            || (r.email && c.email && _normE(c.email) === _normE(r.email))
                            || (r.phone && c.phone && c.phone === r.phone);
                    }) || null;
                }

                if (!target) {
                    // Hijo no convocado / sin inviteCode válido / sin parentUid → omitir en silencio.
                    continue;
                }

                // FIX: Si auto-despacho ya envió a este padre, saltar (evita duplicado).
                if (_autoAlreadyRan) {
                    sentCount++;
                    continue;
                }

                const targetParentUid = target.parentUid;
                const player = target.player;
                const dorsal = target.dorsal;
                const reportText = _buildIndividualReportText(player, scoreHome, scoreAway, matchDate);

                // ID determinista e idempotente: {matchId}_parent_{parentUid}_p{dorsal}
                const _manualMatchId = _sharedMatchId; // reutilizar el matchId compartido
                const reportId = `${_manualMatchId}_parent_${targetParentUid}_p${dorsal}`;
                await setDoc(doc(db, 'cronos_player_reports', reportId), {
                    matchId:        _manualMatchId,
                    type:           'parent_player_report',
                    reportId,
                    playerNumber:   String(dorsal),
                    playerAlias:    player.alias || player.name || 'Jugador',
                    parentUid:      targetParentUid,
                    coachUid:       me.uid, coachEmail: me.email,
                    clubId:         me.clubId || null,
                    matchDate:      new Date().toISOString().split('T')[0],
                    rival:          rivalName,
                    scoreHome, scoreAway,
                    minutesPlayed: window.formatTime ? window.formatTime(player.time||0) : player.time||0,
                    goals: player.goals || 0,
                    cards: player.cards || 'ninguna',
                    injured: player.injured || false,
                    history: typeof _parseHistoryForFirestore === 'function'
                             ? _parseHistoryForFirestore(player.history || [])
                             : (player.history || []),
                    createdAt: new Date().toISOString(),
                });

                // Send via Thread Message + notificación (parentUid siempre válido aquí).
                // FIX v176: Mismo patrón updateDoc→setDoc que para staff.
                // Se eliminó el getDoc previo para evitar permission-denied.
                const threadId = `${me.uid}_${targetParentUid}`;
                const msgEntry = { sender: 'coach', text: reportText, timestamp: new Date().toISOString(), type: 'report' };
                try {
                    // Intentar actualizar hilo existente
                    // FIX (v180): Incluir campos de identidad para consultas
                    await updateDoc(doc(db, 'cronos_messages', threadId), {
                        messages: arrayUnion(msgEntry),
                        lastMessage: '📊 Informe de partido enviado',
                        lastMessageAt: msgEntry.timestamp,
                        unreadByParent: (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.FieldValue.increment(1) : 1,
                        // FIX (v180): campos de identidad
                        parentUid:    targetParentUid,
                        participants: arrayUnion(me.uid, targetParentUid),
                        clubId:       me.clubId || null,
                        recipientType: 'parent'
                    });
                } catch(updateErr) {
                    // Si update falla (hilo no existe), crear con setDoc
                    try {
                        await setDoc(doc(db, 'cronos_messages', threadId), {
                            threadId, coachUid: me.uid, coachEmail: me.email,
                            clubId: me.clubId || null,                           // ← FIX: para reglas Firestore
                            participants: [me.uid, targetParentUid],              // ← FIX: para reglas Firestore
                            parentUid: targetParentUid, parentEmail: (target.contact && target.contact.email) || r.email || '',
                            messages: [msgEntry], lastMessage: '📊 Informe de partido enviado',
                            lastMessageAt: msgEntry.timestamp, unreadByCoach: 0, unreadByParent: 1
                        });
                    } catch(setErr) {
                        console.warn('[Chronos] Error creando hilo parent:', {
                            code: setErr && setErr.code,
                            message: setErr && setErr.message,
                            threadId, parentUid: targetParentUid,
                        }, setErr);
                    }
                }

                // Also a notification for the parent
                try {
                    await setDoc(doc(db, 'cronos_notifications', `notif_rpt_${dorsal}_${Date.now().toString(36)}`), {
                        type: 'informe_partido', clubId: me.clubId || null,
                        userId: targetParentUid,                              // ← FIX: campo que las reglas verifican
                        coachUid: me.uid,                                   // ← FIX (C3): coachUid para reglas Firestore
                        parentUid: targetParentUid, playerNumber: dorsal,
                        rival: rivalName, scoreHome, scoreAway,
                        myTeamRole: _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                        minutesPlayed: window.formatTime ? window.formatTime(player.time||0) : player.time||0,
                        goals: player.goals || 0, cards: player.cards || 'ninguna',
                        injured: player.injured || false, createdAt: new Date().toISOString()
                    });
                } catch(notifErr) {
                    console.warn('[Chronos] Error enviando notificación a parentUid:', targetParentUid, notifErr);
                }

                sentCount++;
            }
        }
        
        // ── INFORME COLECTIVO AL PROPIO ENTRENADOR ───────────────
        // FIX: Solo generar si auto-despacho no lo hizo ya (evita duplicados)
        if (!_autoAlreadyRan) {
        try {
            const _today2 = new Date().toISOString().split('T')[0];
            const _rivalSlug3 = (rivalName||'rival').replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0,20);
            const matchId = window._cronosLastAutoDispatchMatchId
                || `match_${me.uid}_${_today2}_${_rivalSlug3}_${scoreHome}x${scoreAway}`;
            for (const p of homePlayers) {
                const rptId = `${matchId}_coach_p${p.number}`;
                await setDoc(doc(db, 'cronos_player_reports', rptId), {
                    matchId, type: 'collective_match_report', clubId: me.clubId || null,
                    coachUid: me.uid, coachEmail: me.email,
                    matchDate: new Date().toISOString().split('T')[0],
                    rival: rivalName, scoreHome, scoreAway,
                    myTeamRole: _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                    category: (typeof currentCategory!=='undefined'?currentCategory:'') || (typeof window.currentCategory!=='undefined'?window.currentCategory:''),
                    subcategory: _cMatchSubcatFor(me, (typeof currentCategory!=='undefined'?currentCategory:'') || (typeof window.currentCategory!=='undefined'?window.currentCategory:'')),
                    // Clave de equipo (el informe es del equipo).
                    teamId: (typeof window.cronosTeamId === 'function')
                              ? window.cronosTeamId(
                                  me.clubId || '',
                                  (typeof currentCategory!=='undefined'?currentCategory:'') || (typeof window.currentCategory!=='undefined'?window.currentCategory:''),
                                  _cMatchSubcatFor(me, (typeof currentCategory!=='undefined'?currentCategory:'') || (typeof window.currentCategory!=='undefined'?window.currentCategory:'')))
                              : '',
                    createdAt: new Date().toISOString(),
                    ...(typeof window.cronosGuestFields === 'function' ? window.cronosGuestFields(p) : {}),
                    playerNumber: String(p.number||''), playerAlias: p.alias || p.name || '',
                    position: p.position || p.pos || '',
                    wasStarter: typeof window.cronosFueTitular === 'function' ? window.cronosFueTitular(p) : false,
                    goals: p.goals || 0, cards: p.cards || null, injured: p.injured || false,
                    minutesPlayed: window.formatTime ? window.formatTime(p.time||0) : String(p.time||0),
                    history: _parseHistoryForFirestore(p.history||[]),
                    _forCoach: true,
                });
            }

            // 🪶 v639 · ÍNDICE LIGERO DEL PARTIDO — UNA vez por partido, no una
            //    por jugador. Ver js/match/live/finished-index.js. Este es el
            //    TERCERO de los tres flujos de despacho; los tres tienen que
            //    indexar o la lista se quedaría coja según por dónde se enviara.
            if (typeof window._cronosIndexarPartidoTerminado === 'function') {
                const _catIdx = (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '');
                window._cronosIndexarPartidoTerminado({
                    matchId,
                    clubId:      me.clubId || null,
                    createdBy:   me.uid,
                    coachUid:    me.uid,
                    coachEmail:  me.email,
                    homeName:    (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES.home) || 'LOCAL',
                    awayName:    rivalName,
                    scoreHome, scoreAway,
                    category:    _catIdx,
                    subcategory: _cMatchSubcatFor(me, _catIdx),
                    mode:        (typeof currentMode !== 'undefined' ? currentMode : 'f7'),
                    matchDate:   new Date().toISOString().split('T')[0],
                    createdAt:   new Date().toISOString(),
                    // Mejor esfuerzo: ver la nota en collective-report.js.
                    eventsCount: Array.isArray(window.matchEvents) ? window.matchEvents.length : 0,
                    source:      'cronos_player_reports',
                    docId:       matchId,
                });
            }

            const coachNotifId = `coach_self_rpt_${me.uid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', coachNotifId), {
                type: 'informe_colectivo', clubId: me.clubId || null,
                userId: me.uid,    // FIX v177: campo que las reglas Firestore verifican
                coachUid: me.uid,
                parentUid: me.uid, staffUid: me.uid, coachEmail: me.email,
                matchDate: new Date().toISOString().split('T')[0],
                rival: rivalName, scoreHome, scoreAway, matchId,
                message: 'Has generado un nuevo informe colectivo de partido.',
                createdAt: new Date().toISOString(),
            });
        } catch(autoSelfErr) {
            console.warn('[ManualDispatch] Auto-informe al entrenador falló silenciosamente:', autoSelfErr.message);
        }
        } // fin guard !_autoAlreadyRan

    } catch (sendErr) {
        console.error('[Chronos] Error enviando informes internos:', sendErr);
        if (msgEl) {
            msgEl.style.color = '#da3633';
            msgEl.textContent = '⚠️ Error al enviar. Comprueba la conexión e inténtalo de nuevo.';
        }
        showToast('⚠️ Error al enviar informes. Revisa la consola.', 5000);
    } finally {
        hideSpinner();
    }

    if (sentCount > 0 && msgEl && msgEl.style.color !== '#da3633') {
        msgEl.style.color = '#3fb950';
        msgEl.textContent = `✅ Enviado con éxito a ${sentCount} destinatario(s).`;
        showToast(`✅ Informes enviados (${sentCount})`, 4000);
        setTimeout(() => { document.getElementById('setup-modal').style.display='none'; }, 2000);
    } else if (sentCount === 0 && msgEl && msgEl.style.color !== '#da3633') {
        msgEl.style.color = '#ffa500';
        msgEl.textContent = '⚠️ No se encontraron jugadores vinculados para los destinatarios seleccionados.';
        showToast('⚠️ No se pudo enviar ningún informe. Revisa las vinculaciones.', 5000);
    }
}

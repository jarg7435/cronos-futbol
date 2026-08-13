// ════════════════════════════════════════════════════════════════════
//  js/coach/comms/collective-report.js
//  Informe colectivo del partido para directores y coordinadores: compone el
//  texto y la lista de destinatarios (openCollectiveReport) y lo envía por
//  mensajería interna, notificaciones e informes de staff
//  (_sendCollectiveReportNow).
//
//  Extraído de js/coach/comms/panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-27, paso 2 de 6 de la
//  descomposición de ese archivo. Movimiento puramente mecánico, sin cambios
//  de lógica.
//
//  ⚠️ SOBRE CÓMO SE LLEGA AQUÍ — LÉASE ANTES DE TOCAR NADA
//  Una búsqueda estática en TODO el repositorio (2026-07-27) no encontró
//  ningún invocador de openCollectiveReport: ni un onclick, ni una llamada
//  desde JS, ni invocación dinámica del tipo window[nombre](). Sus únicas
//  apariciones son su propia definición, un comentario, la autoasignación
//  `window.openCollectiveReport = window.openCollectiveReport;` de panel.js
//  (un no-op) y la documentación. _sendCollectiveReportNow sólo se invoca
//  desde el onclick del HTML que genera openCollectiveReport, así que depende
//  de ella.
//  El autor del proyecto indica que el informe colectivo SÍ se usa, generado
//  automáticamente en segundo plano al finalizar un partido en vivo. Conviene
//  saber que el despacho automático localizado estáticamente es
//  `autoDispatchMatchReports`, que sigue en comms/panel.js y NO llama a estas
//  dos funciones: son implementaciones separadas que escriben las mismas
//  colecciones. Por eso este archivo se movió TAL CUAL, sin borrar nada y sin
//  afirmar que sea código muerto. Si algún día se confirma que no hay ninguna
//  vía de entrada, es candidato a eliminación; hasta entonces, se conserva.
//
//  ACOPLAMIENTO:
//   · Fan-in externo = 0. El estado se comparte entre las dos funciones vía
//     window._collectiveReportStaff y window._collectiveReportText, que
//     openCollectiveReport deja preparados para _sendCollectiveReportNow.
//   · Depende de _cFS() (×4) y _cGetStaff() (×5), que SE QUEDAN en
//     comms/panel.js; de _cronosResolveStaffForMatch (js/core/utils.js);
//     de escapeHtml y showToast/showSpinner/hideSpinner; y de
//     openUnifiedCommsMenu() (×3), que hoy sigue en panel.js y se irá a
//     bulk-messaging.js en el paso 5. Todo se resuelve en tiempo de llamada,
//     así que el orden de los <script> es indiferente.
//   · ⚠️ `emailConfig` (×7) es un GLOBAL LÉXICO: un `let` de nivel superior en
//     js/core/app-init.js:136, NO una propiedad de window. Se lee con
//     `typeof emailConfig !== 'undefined'`, guarda que para un `let` en su
//     zona muerta temporal LANZARÍA ReferenceError en vez de devolver
//     'undefined' — es ilusoria, igual que la de _RP en report-engine.js.
//     Hoy es inocua porque app-init.js carga mucho antes y esto sólo corre en
//     tiempo de click. No convertirla en algo que dependa del orden de carga.
//
//  ESCRITURAS: 5 setDoc y 1 updateDoc sobre cronos_messages,
//  cronos_notifications y cronos_player_reports.
//
//  ⚠️ El test scripts/test_p11d_collective_write.js vigila que staffUids
//  incluya SIEMPRE me.uid (`_collStaffUids`) aunque la lista de staff venga
//  vacía: sin eso, la Query B del Panel de Informes se queda sin resultados y
//  el partido no aparece. Ese test lee este archivo Y panel.js.
//
//  Cubierto por scripts/test_collective_report_module.js.
// ════════════════════════════════════════════════════════════════════

window.openCollectiveReport = async function openCollectiveReport() {
    const me = window._cronosCurrentUser;
    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    // Obtener datos del partido actual si existe
    const hasLiveData = !!(window.players && window.players.length);
    const scoreHome = document.getElementById('score-home')?.textContent || '?';
    const scoreAway = document.getElementById('score-away')?.textContent || '?';
    const rival     = (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES.away) || 'Rival';
    const matchDate = new Date().toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'});

    // Si no hay datos en vivo, intentar leer últimos informes de Firestore
    let playerData = [];
    if (hasLiveData) {
        playerData = (window.players || []).filter(p => p.team === _cMyTeamKey());
    } else {
        try {
            const { db, collection, getDocs, query, where, orderBy, limit } = await _cFS();
            const snap = await getDocs(query(
                collection(db,'cronos_player_reports'),
                where('clubId','==',me.clubId||''),
                orderBy('createdAt','desc'),
                limit(30)
            ));
            // Agrupar por el partido más reciente
            const reports = [];
            snap.forEach(d => reports.push({ id:d.id, ...d.data() }));
            if (reports.length) {
                const latestMatch = reports[0].matchDate;
                reports.filter(r => r.matchDate === latestMatch).forEach(r => {
                    playerData.push({
                        number: r.playerNumber, name: r.playerAlias,
                        time: 0, goals: r.goals||0, cards: r.cards||'ninguna',
                        injured: r.injured||false, history: r.history||[],
                        minutesPlayed: r.minutesPlayed,
                    });
                });
            }
        } catch(e) { console.warn('[collectiveReport]', e); }
    }

    // Construir texto del informe colectivo
    function buildCollectiveText() {
        let msg = `📊 *INFORME COLECTIVO DE PARTIDO*\n`;
        msg += `━━━━━━━━━━━━━━━━\n`;
        msg += `📅 ${matchDate}\n`;
        msg += `🆚 ${me.clubName||'Nuestro equipo'} ${scoreHome} – ${scoreAway} ${rival}\n\n`;

        // Línea de tiempo global (todos los eventos ordenados)
        const evIcon = { goal:'⚽ GOL', yellow:'🟨 TARJETA', red:'🟥 TARJETA', sub_in:'▼ CAMBIO·Entra', sub_out:'▲ CAMBIO·Sale', injury:'🚑 LESIÓN' };
        const allEvents = [];
        playerData.forEach(p => {
            const alias = p.name || 'Jugador';
            (p.history||[]).forEach(ev => {
                if (typeof ev === 'object' && ev.type) {
                    allEvents.push({ minute: ev.minute||0, type: ev.type, player: alias });
                }
            });
            // v218: sin '#<num>' en el fallback; solo el nombre del jugador.
            if (p.subInMinute)  allEvents.push({ minute:p.subInMinute,  type:'sub_in',  player:p.name||'Jugador' });
            if (p.subOutMinute) allEvents.push({ minute:p.subOutMinute, type:'sub_out', player:p.name||'Jugador' });
            if (p.injuryMinute) allEvents.push({ minute:p.injuryMinute, type:'injury',  player:p.name||'Jugador' });
        });
        allEvents.sort((a,b) => a.minute - b.minute);

        if (allEvents.length) {
            msg += `📋 *LÍNEA DE TIEMPO:*\n`;
            allEvents.forEach(ev => {
                msg += `• ${ev.minute}' ${evIcon[ev.type]||'•'} ${ev.player}\n`;
            });
            msg += '\n';
        }

        // Tabla de jugadores
        msg += `👥 *JUGADORES:*\n`;
        playerData.forEach(p => {
            const mins = p.minutesPlayed || (typeof formatTime==='function' ? formatTime(p.time||0) : '—');
            let line = `• ${p.name||'Jugador'} — ⏱${mins}`;
            if (p.goals > 0) line += ` ⚽${p.goals}`;
            if (p.cards === 'amarilla' || p.cards === 'yellow') line += ' 🟨';
            if (p.cards === 'roja'     || p.cards === 'red')    line += ' 🟥';
            if (p.injured) line += ' 🩹';
            msg += line + '\n';
        });

        // ── ACUMULADO DE ASISTENCIA DEL MES ──────────────────────────
        // 🔑 Va DENTRO de este informe y no en uno aparte: es lo que pidió el
        // autor —que la sumatoria mensual se refleje en los acumulados del
        // colectivo—, y es la pantalla que dirección ya lee.
        // ⚠️ textoMensual devuelve '' si no hay ni una marca registrada, y
        // entonces el mensaje sale EXACTAMENTE igual que antes de existir
        // esta función. Los clubes que no pasen lista no notan nada.
        try {
            if (window.CronosAttendance && typeof window.CronosAttendance.textoMensual === 'function') {
                const bloque = window.CronosAttendance.textoMensual();
                if (bloque) msg += bloque;
            }
        } catch (e) { console.warn('[collectiveReport] asistencia:', e); }

        msg += `\n_Cronos Fútbol · Informe Entrenador_ ⚽`;
        return msg;
    }

    // La caché de asistencia tiene que estar cargada ANTES de construir el
    // texto: textoMensual lee de local y no espera a la red.
    try {
        if (window.CronosAttendance && typeof window.CronosAttendance.precargarMeses === 'function') {
            await window.CronosAttendance.precargarMeses(31);
        }
    } catch (e) { console.warn('[collectiveReport] precarga asistencia:', e); }

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,560px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">
        <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;color:#d2a8ff;">
                📊 Informe Colectivo → Dirección
            </h3>
            <button onclick="openUnifiedCommsMenu()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>
        <div style="padding:1rem 1.2rem;flex:1;overflow-y:auto;">
            <!-- Info partido -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:8px;padding:0.75rem;margin-bottom:0.9rem;">
                <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.3rem;">Partido</div>
                <div style="font-weight:700;font-size:0.95rem;">
                    🆚 vs ${typeof escapeHtml==='function'?escapeHtml(rival):rival}
                    <span style="color:var(--primary);margin-left:0.5rem;">${scoreHome}–${scoreAway}</span>
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">📅 ${matchDate}</div>
            </div>
            <!-- Stats resumen -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.4rem;margin-bottom:0.9rem;">
                ${[
                    ['👥', playerData.length, 'Jugadores'],
                    ['⚽', playerData.reduce((s,p)=>s+(p.goals||0),0), 'Goles'],
                    ['🟨', playerData.filter(p=>p.cards&&p.cards!=='ninguna').length, 'Tarjetas'],
                    ['🩹', playerData.filter(p=>p.injured).length, 'Lesiones'],
                ].map(([ic,v,l]) => `
                <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                            border-radius:7px;padding:0.5rem;text-align:center;">
                    <div>${ic}</div>
                    <div style="font-size:1.1rem;font-weight:800;color:white;">${v}</div>
                    <div style="font-size:0.6rem;color:var(--text-muted);">${l}</div>
                </div>`).join('')}
            </div>
            <!-- Destinatarios (directores/coordinadores) -->
            <div style="background:rgba(210,168,255,0.06);border:1px solid rgba(210,168,255,0.2);
                        border-radius:8px;padding:0.75rem;margin-bottom:0.9rem;">
                <div style="font-size:0.72rem;color:#d2a8ff;font-weight:700;margin-bottom:0.5rem;">
                    📤 DESTINATARIOS — Dirección deportiva del club
                </div>
                <div id="coll-rpt-staff-list" style="font-size:0.78rem;color:var(--text-muted);">
                    ⏳ Cargando…
                </div>
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.7rem;">
                💡 El informe también se enviará como notificación interna a la app.
            </div>
        </div>
        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);
                    display:flex;gap:0.5rem;flex-shrink:0;">
            <button onclick="openUnifiedCommsMenu()" class="btn"
                style="color:var(--text-muted);">← Volver</button>
            <button onclick="_sendCollectiveReportNow()"
                style="flex:1;padding:0.5rem;background:rgba(210,168,255,0.15);
                       border:1px solid rgba(210,168,255,0.4);border-radius:7px;
                       color:#d2a8ff;font-weight:700;cursor:pointer;font-size:0.85rem;">
                📊 Enviar Informe Colectivo
            </button>
        </div>
    </div>`;

    // Cargar directores/coordinadores destinatarios del informe
    // E3 (punto 3): FUENTE PRIMARIA = _cGetStaff (staff real del club por
    // clubId + roles director/coordinator, combinado internamente con
    // emailConfig). FUENTE COMPLEMENTARIA = contactos de emailConfig que no
    // estén ya incluidos. Antes emailConfig era primario y _cGetStaff solo
    // fallback, así que si el entrenador no tenía a los directores en sus
    // contactos con tag 'rpt', el informe colectivo nunca les llegaba.
    try {
        let staffList = [];

        // 1. Fuente primaria: staff real del club.
        try {
            const fns4 = await _cFS();
            staffList = (await _cGetStaff(fns4.db, me.clubId || '', fns4)) || [];
        } catch (e) {
            console.warn('[collectiveReport] _cGetStaff falló:', e.message);
        }

        // 2. Complemento: contactos de emailConfig (incluye contactos solo-email
        //    sin uid) que no estén ya en la lista. El tag 'rpt' ya no es requisito.
        const emailCfgContacts = (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts))
            ? emailConfig.contacts
            : [];

        emailCfgContacts.filter(c => c.type !== 'parent').forEach(c => {
            const already = staffList.some(s =>
                (c.uid && s.uid === c.uid) ||
                (c.email && s.email && s.email.toLowerCase() === c.email.toLowerCase()));
            if (!already) {
                staffList.push({
                    uid:         c.uid   || '',
                    email:       c.email || '',
                    phone:       c.phone || '',
                    displayName: c.name  || c.email || '',
                    role:        c.role  || (c.uid ? 'staff' : 'contact'),
                    _fromConfig: true,
                });
            }
        });

        // ── Pieza 2: filtrar coordinadores por modalidad del partido ──────
        // (igual criterio que autoDispatch: director siempre; coordinador
        // solo si su coordinatorType encaja con la modalidad de la categoría).
        if (typeof window._cronosResolveStaffForMatch === 'function') {
            const _matchCat  = (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                               (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') ||
                               window._currentMatchCategory || '';
            const _matchMode = (typeof currentMode !== 'undefined' ? currentMode : null);
            staffList = window._cronosResolveStaffForMatch(staffList, _matchCat, _matchMode);
        }

        const listEl = document.getElementById('coll-rpt-staff-list');
        if (listEl) {
            if (!staffList.length) {
                listEl.innerHTML = `<div style="color:#f0883e;font-size:0.75rem;">
                    ⚠️ No hay directores ni coordinadores configurados.<br>
                    <span style="font-size:0.68rem;">Ve a Comunicaciones → Gestión de Contactos y añade al staff con el tag <strong>INF</strong> activado.</span>
                </div>`;
            } else {
                listEl.innerHTML = staffList.map(s => `
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.25rem;">
                    <span>${s.role==='director'?'📋':s.role==='coordinator'?'🎯':'🏢'}</span>
                    <span style="color:white;">${typeof escapeHtml==='function'?escapeHtml(s.displayName||s.email):s.displayName||s.email}</span>
                    <span style="font-size:0.65rem;color:var(--text-muted);">
                        (${s.role==='director'?'Director Deportivo':s.role==='coordinator'?'Coordinador':'Staff'})
                    </span>
                    ${s.uid ? `<span style="font-size:0.6rem;background:rgba(63,185,80,0.12);color:#3fb950;padding:1px 5px;border-radius:4px;">✅ App</span>` :
                               `<span style="font-size:0.6rem;background:rgba(240,136,62,0.12);color:#f0883e;padding:1px 5px;border-radius:4px;">📧 Email</span>`}
                </div>`).join('');
            }
        }
        window._collectiveReportStaff = staffList;
        window._collectiveReportText  = buildCollectiveText();

    } catch(e) {
        const listEl = document.getElementById('coll-rpt-staff-list');
        if (listEl) listEl.textContent = '⚠️ ' + e.message;
    }
};

window._sendCollectiveReportNow = async function() {
    const me    = window._cronosCurrentUser;
    let   staff = window._collectiveReportStaff || [];
    const text  = window._collectiveReportText  || '';
    if (typeof showSpinner==='function') showSpinner('Enviando informe colectivo…');
    try {
        const { db, doc, setDoc, updateDoc, getDoc, arrayUnion } = await _cFS();
        // Fallback: si el panel no precargó el staff, recargarlo aquí.
        if (!staff.length) {
            try {
                const fns4 = await _cFS();
                staff = (await _cGetStaff(fns4.db, me.clubId || '', fns4)) || [];
            } catch (e) { console.warn('[collectiveReport] recarga staff falló:', e.message); }
            // Pieza 2: si recargamos aquí, aplicar el filtro por modalidad
            // (en el flujo normal ya viene filtrado desde openCollectiveReport).
            if (staff.length && typeof window._cronosResolveStaffForMatch === 'function') {
                const _matchCat  = (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                   (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') ||
                                   window._currentMatchCategory || '';
                const _matchMode = (typeof currentMode !== 'undefined' ? currentMode : null);
                staff = window._cronosResolveStaffForMatch(staff, _matchCat, _matchMode);
            }
        }
        // FIX (P11-D): NO abortar con staff vacío — el Panel de Dirección se
        // alimenta exclusivamente de los cronos_player_reports que este mismo
        // bloque escribe más abajo; si hacemos return aquí el partido no
        // aparece nunca aunque el club aún no tenga director/coordinador
        // asignado. Solo avisamos y seguimos (los reports quedan visibles por
        // clubId de todos modos).
        if (!staff.length) {
            console.warn('[StaffReport] Lista de staff vacía: se escriben los informes igualmente (visibles por clubId en el Panel de Dirección).');
        }
        const now       = new Date();
        const matchDate = now.toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'});
        const matchDateISO = now.toISOString().split('T')[0];
        const rival     = (typeof TEAM_NAMES!=='undefined'&&TEAM_NAMES.away)||'Rival';
        const scoreHome = document.getElementById('score-home')?.textContent||'0';
        const scoreAway = document.getElementById('score-away')?.textContent||'0';
        const createdAt = now.toISOString();

        // ── 1. Guardar datos estructurados del partido en Firestore ──────
        // Esto alimenta el Gantt visual en el panel de Dirección/Coordinación.
        // Se guarda UN documento por jugador con su historial completo.
        const homePlayers = window.players
            ? window.players.filter(p => p.team === _cMyTeamKey())
            : [];

        // FIX (P11-D): incluir SIEMPRE me.uid como red de seguridad, igual que
        // _allStaffUids en autoDispatchMatchReports, para que la query
        // array-contains del Panel de Dirección nunca quede vacía.
        const _collStaffUids = Array.from(new Set([...staff.map(s => s.uid).filter(Boolean), me.uid,].filter(Boolean)));

        // matchId DETERMINISTA: reutiliza el de autoDispatch si ya se ejecutó,
        // o construye uno basado en fecha+rival+marcador (igual que autoDispatch).
        // Así el "Enviar Informe" manual nunca crea docs duplicados.
        const _rivalSlug2 = (rival || 'rival').replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0, 20);
        const matchId = window._cronosLastAutoDispatchMatchId
            || `match_${me.uid}_${matchDateISO}_${_rivalSlug2}_${scoreHome}x${scoreAway}`;

        for (const p of homePlayers) {
            const rptId = `${matchId}_p${p.number}`;
            // ══════════════════════════════════════════════════════════════
            // v507 · UN SOLO PAYLOAD PARA LOS TRES ROLES
            // ══════════════════════════════════════════════════════════════
            // Antes este objeto se escribía SOLO en el documento del staff, y
            // al entrenador se le dejaba únicamente una notificación (más
            // abajo). Como "Mis Informes" lee `cronos_player_reports` filtrando
            // `_forCoach === true`, esa notificación NO alimentaba nada: el
            // entrenador enviaba el colectivo y su propia pestaña seguía
            // vacía, aunque el Director y el Coordinador sí lo recibían.
            // Ahora el MISMO objeto se escribe dos veces —staff y entrenador—,
            // así que el informe del entrenador no puede ser una versión
            // reducida: es literalmente el mismo.
            const _reportePartido = {
                // Identificadores del partido
                matchId,
                type:           'collective_match_report',
                // E3 FIX: el panel de Dirección/Coordinación filtra exclusivamente
                // por staffReport===true. Sin esta marca el informe colectivo no
                // llegaba nunca a coordinadores/directores.
                staffReport:    true,
                // FIX (v178): staffUids para que las reglas Firestore permitan leer
                // a directores/coordinadores (request.auth.uid in resource.data.staffUids)
                // y la consulta fallback array-contains los encuentre.
                staffUids:      _collStaffUids,
                clubId:         me.clubId || null,
                coachUid:       me.uid,
                coachEmail:     me.email,
                matchDate:      matchDateISO,
                rival,
                scoreHome,
                scoreAway,
                myTeamRole:     _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto). CRÍTICO: este doc tiene staffReport:true y lo lee el Panel de Dirección.
                category:       (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                 (typeof window.currentCategory !== 'undefined' ? window.currentCategory : ''),
                subcategory:    _cMatchSubcatFor(me, (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                 (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '')),
                // Clave de equipo: el informe colectivo es del equipo, no del
                // entrenador que lo firmó. Permite que lo herede su relevo.
                teamId:         (typeof window.cronosTeamId === 'function')
                                  ? window.cronosTeamId(
                                      me.clubId || '',
                                      (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                        (typeof window.currentCategory !== 'undefined' ? window.currentCategory : ''),
                                      _cMatchSubcatFor(me, (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                        (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '')))
                                  : '',
                venue:          (typeof window.matchVenue !== 'undefined' ? window.matchVenue : ''),
                competition:    (typeof window.matchCompetition !== 'undefined' ? window.matchCompetition : ''),
                matchTime:      (typeof window.matchTime !== 'undefined' ? window.matchTime : ''),
                duration:       (typeof window.matchDuration !== 'undefined' ? window.matchDuration : ''),
                stoppageTime:   (typeof window.stoppageTime !== 'undefined' ? window.stoppageTime : 0),
                createdAt,
                // Datos del jugador con historial COMPLETO para el Gantt
                // Plazas de apoyo: si es invitado viaja su ficha de origen.
                ...(typeof window.cronosGuestFields === 'function' ? window.cronosGuestFields(p) : {}),
                playerNumber:   String(p.number || ''),
                playerAlias:    p.alias || p.name || '',
                position:       p.position || p.pos || '',
                goals:          p.goals  || 0,
                cards:          p.cards  || null,
                injured:        p.injured || false,
                minutesPlayed:  typeof formatTime==='function' ? formatTime(p.time||0) : String(p.time||0),
                // PT: ver js/core/utils.js. Este payload lo comparten la copia
                // del STAFF y la del ENTRENADOR (se hace spread mas abajo), asi
                // que con anadirlo aqui las dos lo llevan.
                wasStarter:     typeof window.cronosFueTitular === 'function' ? window.cronosFueTitular(p) : false,
                // history: array de eventos {type, minute} — clave para el Gantt
                // p.history puede contener strings "Entra a las MM:SS (1ªP)" O objetos {type,minute}
                history: _parseHistoryForFirestore(p.history || []),
            };

            // 1) Copia del STAFF (Director Deportivo y Coordinador).
            await setDoc(doc(db, 'cronos_player_reports', rptId), _reportePartido);

            // 2) Copia del ENTRENADOR, con los MISMOS datos.
            //    · `_forCoach: true`  → es lo que "Mis Informes" busca.
            //    · `staffReport: false` → no se duplica en el Panel de Dirección,
            //      que filtra por `staffReport === true`.
            //    El id es el MISMO que usa el despacho automático de fin de
            //    partido (`{matchId}_coach_p{dorsal}`), a propósito: así el
            //    envío manual SOBREESCRIBE esa copia en vez de crear una
            //    segunda, y el entrenador nunca ve el partido repetido.
            try {
                await setDoc(doc(db, 'cronos_player_reports', `${matchId}_coach_p${p.number}`), {
                    ..._reportePartido,
                    staffReport: false,
                    _forCoach:   true,
                });
            } catch (coachCopyErr) {
                console.error('[ColReport] La copia del entrenador falló para el dorsal ' +
                    p.number + ':', coachCopyErr && coachCopyErr.code, coachCopyErr && coachCopyErr.message);
            }
        }
        console.log(`[StaffReport] TOTAL informes colectivos escritos en cronos_player_reports: ${homePlayers.length} (matchId=${matchId}, staff=${staff.length}, staffUids=${_collStaffUids.length})`);

        // ── 2. Enviar mensaje de hilo a cada miembro del staff ───────────
        for (const s of staff) {
            // Solo envío in-app si tiene uid real
            if (s.uid) {
                const threadId = _cStaffThreadId(me.clubId, me.uid, s.uid);
                const msgEntry = {
                    sender: 'coach', type: 'collective_report',
                    text,
                    matchId,
                    timestamp: createdAt,
                };
                // FIX (v178): patrón updateDoc→setDoc en vez de getDoc→if/else.
                // getDoc puede dar permission-denied si las reglas no permiten leer
                // (ej. entrenador sin claim clubId). updateDoc→setDoc evita el getDoc.
                try {
                    // FIX (v180): Incluir campos de identidad para consultas del director/coordinador
                    await updateDoc(doc(db,'cronos_messages',threadId), {
                        messages:      arrayUnion(msgEntry),
                        lastMessage:   '📊 Informe colectivo de partido',
                        lastMessageAt: createdAt,
                        unreadByStaff: (typeof firebase !== 'undefined' && firebase.firestore)
                            ? firebase.firestore.FieldValue.increment(1) : 1,
                        // FIX (v180): campos de identidad para consultas del director/coordinador
                        staffUid:      s.uid,
                        parentUid:     s.uid,
                        participants:  arrayUnion(me.uid, s.uid),
                        clubId:        me.clubId || null,
                        recipientType: 'staff'
                    });
                } catch(updErr) {
                    try {
                        await setDoc(doc(db,'cronos_messages',threadId), {
                            threadId, coachUid: me.uid, coachEmail: me.email,
                            clubId: me.clubId || null,
                            participants: [me.uid, s.uid],
                            staffUids: [s.uid],
                            staffUid: s.uid,
                            parentUid: s.uid,          // FIX (v178): club-reports.js busca por parentUid
                            staffEmail: s.email||'',
                            recipientType:'staff',
                            messages: [msgEntry],
                            lastMessage:   '📊 Informe colectivo de partido',
                            lastMessageAt: createdAt,
                            unreadByCoach: 0, unreadByStaff: 1,
                        });
                    } catch(setErr) {
                        if(window._CRONOS_DEBUG) console.warn('[ColReport] Error creando hilo staff:', {
                            code: setErr && setErr.code,
                            message: setErr && setErr.message,
                            threadId,
                            staffUid: s.uid,
                        }, setErr);
                    }
                }
                await setDoc(doc(db,'cronos_notifications',`coll_rpt_${s.uid}_${Date.now().toString(36)}`), {
                    type: 'informe_colectivo', clubId: me.clubId||null,
                    userId: s.uid,                                // ← FIX (C3): campo que las reglas verifican
                    coachUid: me.uid,                             // ← FIX (C3): coachUid para reglas Firestore
                    staffUid: s.uid, parentUid: s.uid,
                    coachEmail: me.email, matchDate, rival, scoreHome, scoreAway,
                    matchId,
                    createdAt,
                });
            }

            // Envío por email si tiene email (cubre casos sin uid, p.ej. mismo correo multi-rol)
            if (s.email && s.email !== me.email) {
                const subj = encodeURIComponent(`📊 Informe colectivo: vs ${rival} — ${matchDate}`);
                const body = encodeURIComponent(text.replace(/[*_]/g,''));
                setTimeout(() => {
                    window.open(`mailto:${s.email}?subject=${subj}&body=${body}`, '_blank');
                }, staff.indexOf(s) * 800);
            }

            // Envío por WhatsApp si tiene teléfono
            if (s.phone) {
                const waNum = s.phone.replace(/\s/g,'');
                setTimeout(() => {
                    window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(text)}`, '_blank');
                }, staff.indexOf(s) * 800 + 400);
            }
        }

        // ── 3. Auto-notificación para el entrenador (para que "le llegue" también) ──
        const selfNotifId = `coll_rpt_self_${me.uid}_${Date.now().toString(36)}`;
        await setDoc(doc(db,'cronos_notifications', selfNotifId), {
            type: 'informe_colectivo', clubId: me.clubId||null,
            userId: me.uid,                                // ← FIX (C3): campo que las reglas verifican
            coachUid: me.uid,                              // ← FIX (C3): coachUid para reglas Firestore
            staffUid: me.uid, parentUid: me.uid,
            coachEmail: me.email, matchDate, rival, scoreHome, scoreAway,
            matchId,
            createdAt,
        });

        if (typeof hideSpinner==='function') hideSpinner();
        if (typeof showToast==='function') {
            if (staff.length) {
                showToast(`✅ Informe colectivo enviado a ${staff.length} persona(s) de la dirección`, 5000);
            } else {
                showToast('✅ Informe colectivo guardado — visible en el Panel de Dirección', 5000);
            }
        }

        // ── Aviso in-app para el entrenador (registro propio) ───────────
        // ⚠️ v507 · Este documento es SOLO el aviso del feed. Decía alimentar
        // la pestaña "Mis Informes", y era falso: esa pestaña lee
        // `cronos_player_reports` con `_forCoach === true`, no
        // `cronos_notifications`. Quien alimenta "Mis Informes" es la copia
        // del entrenador que ahora se escribe arriba, junto a la del staff.
        try {
            const coachNotifId = `coach_self_rpt_${me.uid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', coachNotifId), {
                type:      'informe_colectivo_entrenador',
                clubId:    me.clubId || null,
                userId:    me.uid,          // FIX v177: campo que las reglas Firestore verifican
                coachUid:  me.uid,
                parentUid: me.uid,
                matchDate, rival, scoreHome, scoreAway,
                matchId,
                createdAt,
                _forCoach: true,
            });
        } catch(selfErr) {
            console.warn('[ColReport] Auto-copia al entrenador falló:', selfErr.message);
        }

        openUnifiedCommsMenu();
    } catch(e) {
        if (typeof hideSpinner==='function') hideSpinner();
        if (typeof showToast==='function') showToast('⚠️ Error: '+e.message, 4000);
        console.error('[_sendCollectiveReportNow]', e);
    }
};

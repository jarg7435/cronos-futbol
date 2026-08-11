// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL · Despacho AUTOMÁTICO de informes de partido
//  Extraído de js/coach/comms/panel.js (auditoría 2026-07-22, paso 6b, el
//  ÚLTIMO del monolito #3). Movimiento MECÁNICO: cero cambios de
//  comportamiento.
//
//  Es la otra mitad del §8. La primera, el camino MANUAL, está en
//  js/coach/comms/match-reports-send.js. Son independientes (cero
//  referencias cruzadas) pero casi simétricas: mismos helpers, mismas
//  colecciones. Si cambias la lógica de envío, mira LAS DOS.
//
//  Contenido:
//    · autoDispatchMatchReports()   — genera y envía todo al terminar el
//      partido, en tres fases: A (staff), B (padres) y C (copia del
//      propio entrenador, marcada con _forCoach).
//    · saveAllMatchReportsInternal() — el orquestador que lo dispara.
//
//  ⚠️ ESTA ES LA MITAD DELICADA. saveAllMatchReportsInternal se ejecuta en
//  CADA ACCIÓN DE JUGADOR durante un partido (js/match/events/
//  player-actions.js) y al persistirlo (js/match/persistence/
//  active-match.js), ambas con guarda typeof. Y autoDispatchMatchReports
//  es lo que hace que las familias reciban el informe. Aquí no hay código
//  muerto que amortigüe un error.
//
//  ⚠️ LO QUE HAY QUE PROTEGER: LOS TRES GUARDS ANTI-DUPLICADO.
//  El bug E4 histórico era "informe individual TRIPLICADO a padres": el
//  fin de partido se dispara desde varias rutas (endMatch manual,
//  terminateMatch por expulsiones, fin automático del crono) y cada una
//  despachaba. Hoy lo impiden:
//   1. El guard PERSISTENTE en localStorage (`cronos_reports_sent_<id>`),
//      que sobrevive a recargas de página.
//   2. La huella EN MEMORIA (window._cronosLastDispatchedMatch),
//      RESERVADA ANTES del await para cerrar la ventana de carrera entre
//      disparos casi simultáneos. No muevas esa línea después del await.
//   3. El matchId DETERMINISTA (uid + fecha + rival + marcador), NO
//      Date.now(). Si fuese aleatorio, cada ejecución crearía documentos
//      nuevos y el padre vería el informe N veces.
//  Los tres los fija scripts/test_match_reports_auto_module.js.
//
//  DEPENDE de panel.js — SIETE helpers, y de nada más de ese archivo:
//    _cGetStaff, _cMatchSubcatFor, _cMyTeamKey, _cResolveClubId,
//    _cStaffThreadId, _cronosResolveParentReportTargets,
//    _parseHistoryForFirestore
//  OJO: NO usa _cFS(); hace su propio import() dinámico del SDK.
//  Y de formatTime, loadEmailConfig, showToast, TEAM_NAMES y los globales
//  léxicos emailConfig / currentMode.
//
//  ⚠️ DEFECTO PREEXISTENTE QUE SE PRESERVA: el catch de
//  saveAllMatchReportsInternal dice "liberar la huella para permitir
//  reintento manual", pero es INALCANZABLE — autoDispatchMatchReports
//  tiene su propio try/catch exterior que se traga cualquier error y sólo
//  hace console.error. Resultado: si el despacho falla, los dos guards se
//  quedan puestos y NO hay reintento posible; los informes de ese partido
//  se pierden en silencio hasta que empiece uno nuevo. Arreglarlo exige
//  propagar el error (o devolver un booleano) y es un cambio de
//  comportamiento, fuera del mandato de esta extracción.
//  Otras dos a tener en cuenta: la preselección del partido
//  (cronos_match_rpt_selection) es de UN SOLO USO, se borra al terminar la
//  fase de padres; y cada padre va en su propio try/catch (FIX v176), así
//  que un fallo con uno no impide el envío al resto — pero ese informe se
//  pierde sin más aviso que un console.
//
//  Test: scripts/test_match_reports_auto_module.js
// ════════════════════════════════════════════════════════════════════

// ── Despacho automático de informes (Interno) ──────────────────────────
async function autoDispatchMatchReports() {
    const me = window._cronosCurrentUser;
    if (!me || !window.players) return;

    try {
        const { setDoc, doc, getDoc, collection, getDocs, query, where, updateDoc, arrayUnion } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth.db;

        // Bug 1 (v174): resolver el clubId desde Firestore si el token no lo trae.
        // Sin clubId, las reglas de cronos_messages/notifications/reports rechazan
        // el envío al staff (director/coordinador) y a los padres.
        const _clubId = await _cResolveClubId(db, me, { doc, getDoc });
        if (_clubId && !me.clubId) me.clubId = _clubId;

        // E3 (punto 2): sin clubId válido, las reglas Firestore
        // (sameClubAsDoc) impiden que el panel de Dirección lea los
        // cronos_player_reports, así que los informes nunca se verían.
        // Avisamos en consola para diagnóstico; el envío continúa porque
        // el entrenador igualmente recibe su copia, pero el staff no podrá leer.
        if (!me.clubId) {
            if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[autoDispatch] me.clubId ausente: los informes de staff ' +
                'no serán legibles por coordinadores/directores (reglas Firestore por club).');
        }

        const scoreHome = document.getElementById('score-home')?.textContent || '0';
        const scoreAway = document.getElementById('score-away')?.textContent || '0';
        const rivalName = TEAM_NAMES.away || 'Rival';
        const matchDate = new Date().toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
        const homePlayers = window.players.filter(p => p.team === _cMyTeamKey());
        console.log('autoDispatch ejecutándose | teamKey:', _cMyTeamKey(),
            '| total players:', (window.players||[]).length,
            '| homePlayers (mi equipo):', homePlayers.length,
            homePlayers.map(p => '#'+p.number+' '+p.name).join(', ') || '(NINGUNO)');

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

        // ── Generar un matchId DETERMINISTA para este partido ────────────────
        // CRÍTICO: si usamos Date.now(), cada ejecución de autoDispatch genera
        // un ID diferente → setDoc crea un doc NUEVO en vez de sobreescribir
        // → los padres ven el informe duplicado N veces.
        // Solución: construir el ID con datos del partido que no cambian
        // (coachUid + fecha + rival + marcador) → idempotente aunque se llame
        // múltiples veces en el mismo partido (o el usuario cambie de rol).
        const _today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const _rivalSlug = (rivalName || 'rival').replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0, 20);
        const sharedMatchId = `match_${me.uid}_${_today}_${_rivalSlug}_${scoreHome}x${scoreAway}`;
        // Guardar globalmente para que el envío manual pueda reutilizarlo.
        window._cronosLastAutoDispatchMatchId = sharedMatchId;

        // ── Resolver destinatarios staff ANTES de escribir reports ──────────
        // FIX: antes los staff reports se escribían sin staffUids, así que los
        // directores/coordinadores no podían leerlos por las reglas de Firestore.
        // Ahora resolvemos el staff primero para incluir sus UIDs en cada doc.
        const notifiedUids = new Set();
        let staffToNotify = [];
        try {
            const _fns2 = { collection, getDocs, query, where };
            staffToNotify = (await _cGetStaff(db, me.clubId || '', _fns2)) || [];
        } catch (e) {
            console.warn('[autoDispatch] _cGetStaff falló, usando emailConfig:', e.message);
        }
        // Fuente complementaria: contactos de tipo staff con uid
        contacts.filter(c => c.type !== 'parent' && c.uid)
            .forEach(c => {
                if (!staffToNotify.some(s => s.uid === c.uid)) {
                    staffToNotify.push({ uid: c.uid, role: c.role || 'staff', email: c.email || '' });
                }
            });
        // ── Pieza 2: filtrar coordinadores por modalidad del partido ──────
        // Director Deportivo siempre; Coordinador solo si su coordinatorType
        // (f7/f11/f711) encaja con la modalidad de la categoría del partido.
        if (typeof window._cronosResolveStaffForMatch === 'function') {
            const _matchCat  = window._currentMatchCategory || '';
            const _matchMode = (typeof currentMode !== 'undefined' ? currentMode : null);
            const _before = staffToNotify.length;
            staffToNotify = window._cronosResolveStaffForMatch(staffToNotify, _matchCat, _matchMode);
            if (staffToNotify.length !== _before) {
                console.log('[autoDispatch] Staff filtrado por modalidad (' +
                    (window._cronosMatchModality(_matchCat, _matchMode) || '?') + '): ' +
                    _before + ' → ' + staffToNotify.length);
            }
        }
        // FIX (P11-D): incluir SIEMPRE me.uid (el propio entrenador) como red de
        // seguridad, para que la query array-contains del Panel de Dirección
        // nunca quede vacía aunque el club no tenga staff asignado todavía.
        const _allStaffUids = Array.from(new Set([...staffToNotify.map(s => s.uid).filter(Boolean), me.uid].filter(Boolean)));

        // FIX (v217): aplicar pre-seleccion per-partido al staff TAMBIEN.
        // Si preSelectionIds esta presente (modal de convocatoria usado),
        // filtramos staffToNotify para QUE SOLO queden los contactos cuyo
        // id este en la pre-seleccion. El director/coordinador se mantiene
        // SIEMPRE (Regla 1) salvo que el entrenador lo haya deschequeado
        // explicitamente en el modal del partido.
        if (preSelectionIds && Array.isArray(preSelectionIds) && preSelectionIds.length > 0) {
            const _staffSel = new Set(preSelectionIds.map(String));
            staffToNotify = staffToNotify.filter(s => {
                // Conservar si su uid O email coincide con un contacto seleccionado.
                if (!s) return false;
                if (s.uid && _staffSel.has(String(s.uid))) return true;
                if (s.email) {
                    const matchByEmail = (contacts || []).some(c =>
                        c && c.type !== 'parent' && c.email &&
                        String(c.email).toLowerCase() === String(s.email).toLowerCase() &&
                        _staffSel.has(String(c.id))
                    );
                    if (matchByEmail) return true;
                }
                return false;
            });
            if (window._cronosDiagReports) {
                console.log('[autoDispatch] Staff filtrado por pre-seleccion per-partido:',
                    staffToNotify.length, 'destinatarios');
            }
        }

        if (window._cronosDiagReports) {
        }
        // FIX v177: Log SIEMPRE (no condicional) para diagnosticar por qué
        // el informe colectivo no llega al director/coordinador.

        // ── Guardar documentos cronos_player_reports para el Gantt del staff ──
        // Un documento por jugador con type='staff_match_report' y staffReport=true.
        // FIX: incluye staffUids para que las reglas de Firestore permitan leer
        // a directores y coordinadores (request.auth.uid in resource.data.staffUids).
        for (const p of homePlayers) {
            const srId = `${sharedMatchId}_staff_p${p.number}`;
            await setDoc(doc(db, 'cronos_player_reports', srId), {
                matchId:       sharedMatchId,
                type:          'staff_match_report',
                staffReport:   true,          // ← filtro exclusivo del panel staff
                staffUids:     _allStaffUids, // ← FIX: UIDs de staff para reglas Firestore
                clubId:        me.clubId || null,
                coachUid:      me.uid,
                coachEmail:    me.email,
                matchDate:     new Date().toISOString().split('T')[0],
                rival:         rivalName,
                scoreHome,
                scoreAway,
                myTeamRole:    _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                category:      window._currentMatchCategory || '',
                subcategory:   _cMatchSubcatFor(me, window._currentMatchCategory || ''),
                // El informe pertenece al EQUIPO. Se sella su clave para que la
                // consulta por equipo sea directa y no dependa de recalcularla
                // desde los textos de categoría (que un día pueden renombrarse).
                teamId:        (typeof window.cronosTeamId === 'function')
                                 ? window.cronosTeamId(me.clubId || '', window._currentMatchCategory || '',
                                                       _cMatchSubcatFor(me, window._currentMatchCategory || ''))
                                 : '',
                createdAt:     new Date().toISOString(),
                playerNumber:  String(p.number || ''),
                playerAlias:   p.alias || p.name || '',
                position:      p.position || p.pos || '',
                goals:         p.goals  || 0,
                cards:         p.cards  || null,
                injured:       p.injured || false,
                minutesPlayed: typeof formatTime === 'function' ? formatTime(p.time || 0) : String(p.time || 0),
                history:       _parseHistoryForFirestore(p.history || []),
            });
        }
        console.log(`[StaffReport] TOTAL informes staff escritos en cronos_player_reports: ${homePlayers.length} (matchId=${sharedMatchId}, staffToNotify=${staffToNotify.length}, staffUids=${_allStaffUids.length})`);

        // ── Notificar al staff (coordinador + director) ──────────────────
        // Los destinatarios ya fueron resueltos arriba (antes de los reports).
        // Aquí enviamos las notificaciones Y creamos los hilos de mensajes.
        //
        // ⚠️ v507 · ESTE BLOQUE NO PUEDE TUMBAR LA FUNCIÓN. El `setDoc` de la
        // notificación de abajo estaba SIN try: un permission-denied con un
        // solo miembro del staff saltaba al catch general y se llevaba por
        // delante la FASE B y, sobre todo, la FASE C —la copia del propio
        // entrenador—, que es la última en escribirse. Ése es exactamente el
        // cuadro reportado: "el informe llega al Director y al Coordinador
        // pero no al entrenador". Los informes de staff (FASE A) ya estaban
        // escritos ANTES, así que el fallo era invisible por ese lado.
        try {
        for (const staff of staffToNotify) {
            if (!staff.uid || notifiedUids.has(staff.uid)) continue;
            notifiedUids.add(staff.uid);

            // FIX (v178): Log detallado por cada staff para diagnosticar

            // ── 1. Notificación push/UI ───────────────────────────────
            const notifId = `notif_global_rpt_${staff.uid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', notifId), {
                type: 'aviso_partido_finalizado',
                clubId: me.clubId || null,
                userId: staff.uid,           // ← FIX: campo que las reglas verifican
                coachUid: me.uid,            // ← FIX (C2): coachUid para reglas Firestore
                parentUid: staff.uid,
                staffUid: staff.uid,
                matchDate, rival: rivalName, scoreHome, scoreAway,
                message: globalText.replace(/[*_]/g, ''),
                createdAt: new Date().toISOString()
            });

            // ── 2. Hilo de mensajes para el staff ──────────────────────
            // FIX v176: El auto-despacho NO creaba hilos de mensajes para el
            // staff, así que el director/coordinador solo recibía la notificación
            // push pero NO veía el informe en su bandeja de mensajes.
            // Ahora se crea el hilo con el mismo patrón que el despacho manual.
            const threadId = _cStaffThreadId(me.clubId, me.uid, staff.uid);
            const staffMsgEntry = { sender: 'coach', text: globalText, timestamp: new Date().toISOString(), type: 'collective_report' };
            try {
                // Intentar actualizar el hilo existente (añadir mensaje)
                // FIX (v180): Incluir campos de identidad para que las queries del
                // director/coordinador (por clubId, staffUid, parentUid, participants)
                // encuentren este hilo. Sin estos campos, updateDoc solo añade el
                // mensaje pero el hilo sigue siendo invisible para director/coordinador.
                await updateDoc(doc(db, 'cronos_messages', threadId), {
                    messages: arrayUnion(staffMsgEntry),
                    lastMessage: '📊 Informe colectivo de partido',
                    lastMessageAt: staffMsgEntry.timestamp,
                    unreadByStaff: (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.FieldValue.increment(1) : 1,
                    // FIX (v180): campos de identidad para consultas del director/coordinador
                    staffUid:      staff.uid,
                    parentUid:     staff.uid,
                    participants:  arrayUnion(me.uid, staff.uid),
                    clubId:        me.clubId || null,
                    recipientType: 'staff'
                });
            } catch(updateErr) {
                // Si falla update (hilo no existe), crear con setDoc
                try {
                    await setDoc(doc(db, 'cronos_messages', threadId), {
                        threadId,
                        coachUid:      me.uid,
                        coachEmail:    me.email,
                        clubId:        me.clubId || null,
                        participants:  [me.uid, staff.uid],
                        staffUids:     [staff.uid],
                        staffUid:      staff.uid,
                        parentUid:     staff.uid,     // FIX (v178): club-reports.js busca por parentUid
                        recipientType: 'staff',
                        messages:      [staffMsgEntry],
                        lastMessage:   '📊 Informe colectivo de partido',
                        lastMessageAt: staffMsgEntry.timestamp,
                        unreadByCoach: 0,
                        unreadByStaff: 1
                    });
                } catch(thErr) {
                    if(window._CRONOS_DEBUG) console.warn('[autoDispatch] Error creando hilo staff:', {
                        code: thErr && thErr.code,
                        message: thErr && thErr.message,
                        threadId,
                        staffUid: staff.uid,
                        coachClubId: me.clubId || null,
                    }, thErr);
                }
            }
        }
        } catch (staffLoopErr) {
            // v507 · Un fallo notificando al staff NO puede impedir que el
            // entrenador reciba su copia (FASE C). Se registra y se sigue.
            console.error('[autoDispatch] Fallo notificando al staff (se continúa ' +
                'para no perder la copia del entrenador):', staffLoopErr && staffLoopErr.message, staffLoopErr);
        }

        // --- FASE B: INFORMES INDIVIDUALES (PADRES) — REDISEÑO v171 ---
        // REGLA 3 (estricta): se itera por PADRES (no por jugadores). Cada padre
        // con el checkbox INF (tag 'rpt') y un inviteCode válido (J<dorsal>)
        // recibe EXACTAMENTE 1 informe del jugador cuyo número coincide con su
        // dorsal, y solo si ese jugador fue convocado (homePlayers). El
        // emparejado es SOLO por dorsal, nunca por nombre. La resolución vive en
        // el helper compartido, idéntico al del despacho manual.
        // FIX (v217): pasar preSelectionIds como 4o argumento para que el helper
        // respete ESTRICTAMENTE el checkbox per-partido (modal de convocatoria).
        // Si preSelectionIds es null (no se uso el modal), el helper cae al
        // comportamiento legacy (tag 'rpt' global).
        // v507 · La RESOLUCIÓN de destinatarios estaba fuera de todo try: si
        // lanzaba (contactos o links mal formados), se llevaba por delante la
        // FASE C. El bucle de abajo sí guarda cada padre por separado.
        let _parentTargets = [];
        try {
            _parentTargets = _cronosResolveParentReportTargets(contacts, links, homePlayers, preSelectionIds) || [];
        } catch (targetsErr) {
            console.error('[autoDispatch] No se pudieron resolver los padres destinatarios ' +
                '(se continúa con la copia del entrenador):', targetsErr && targetsErr.message, targetsErr);
        }
        for (const { parentUid, dorsal, player } of _parentTargets) {
            // FIX v176: Cada padre se envía en su propio try/catch para que un
            // fallo con un padre (p.ej. permission-denied) NO impida el envío
            // al resto de padres. Antes, si setDoc de un padre fallaba, el
            // bucle se rompía y los padres siguientes no recibían su informe.
            try {
            // Texto individual de este jugador
            const cardLbl = player.cards === 'amarilla' ? '🟨 TARJETA' : player.cards === 'roja' ? '🟥 TARJETA' : 'Sin tarjetas';
            const stats = `⏱️ ${formatTime(player.time || 0)} min | ⚽ GOL ×${player.goals || 0} | ${cardLbl}`;
            const indivText = `📊 *INFORME INDIVIDUAL: ${player.name}*\n` +
                             `━━━━━━━━━━━━━━━━\n` +
                             `📅 ${matchDate}\n` +
                             `⚽ Partido vs ${rivalName}\n` +
                             `📈 Rendimiento: ${stats}\n\n` +
                             `Revisa el panel de informes para más detalles.\n` +
                             `_Cronos Fútbol_`;

            // ── Guardar en cronos_player_reports para el panel del padre ──
            // ID determinista e idempotente: {matchId}_parent_{parentUid}_p{dorsal}
            const prId = `${sharedMatchId}_parent_${parentUid}_p${dorsal}`;
            await setDoc(doc(db, 'cronos_player_reports', prId), {
                matchId:       sharedMatchId,
                type:          'parent_player_report',
                parentUid:     parentUid,
                clubId:        me.clubId || null,
                coachUid:      me.uid,
                coachEmail:    me.email,
                matchDate:     new Date().toISOString().split('T')[0],
                rival:         rivalName,
                scoreHome,
                scoreAway,
                myTeamRole:    _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                createdAt:     new Date().toISOString(),
                playerNumber:  String(dorsal),
                playerAlias:   player.alias || player.name || '',
                goals:         player.goals  || 0,
                cards:         player.cards  || 'ninguna',
                injured:       player.injured || false,
                minutesPlayed: typeof formatTime === 'function' ? formatTime(player.time || 0) : String(player.time || 0),
                history:       _parseHistoryForFirestore(player.history || []),
            });

            // ── Enviar mensaje al hilo de chat ───────────────────────────
            // FIX v176: Mismo patrón updateDoc→setDoc que para staff.
            // El hilo de padres usa {coachUid}_{parentUid} como threadId.
            const threadId = `${me.uid}_${parentUid}`;
            const msgEntry = { sender: 'coach', text: indivText, timestamp: new Date().toISOString(), type: 'report' };
            try {
                // FIX (v180): Incluir campos de identidad para consultas
                await updateDoc(doc(db, 'cronos_messages', threadId), {
                    messages: arrayUnion(msgEntry),
                    lastMessage: '📊 Informe de partido enviado',
                    lastMessageAt: msgEntry.timestamp,
                    unreadByParent: (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.FieldValue.increment(1) : 1,
                    // FIX (v180): campos de identidad
                    parentUid:    parentUid,
                    participants: arrayUnion(me.uid, parentUid),
                    clubId:       me.clubId || null,
                    recipientType: 'parent'
                });
            } catch(e) {
                await setDoc(doc(db, 'cronos_messages', threadId), {
                    threadId, coachUid: me.uid, coachEmail: me.email,
                    clubId: me.clubId || null,                        // ← FIX: para reglas Firestore
                    participants: [me.uid, parentUid],                // ← FIX: para reglas Firestore
                    parentUid: parentUid, messages: [msgEntry], lastMessage: '📊 Informe de partido enviado',
                    lastMessageAt: msgEntry.timestamp, unreadByCoach: 0, unreadByParent: 1
                });
            }

            // ── Notificación push para el padre ───────────────────────────
            const notifId = `notif_indiv_rpt_${parentUid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', notifId), {
                type:         'informe_partido',
                clubId:       me.clubId || null,
                userId:       parentUid,                           // ← FIX: campo que las reglas verifican
                coachUid:     me.uid,                              // ← FIX (C2): coachUid para reglas Firestore
                parentUid:    parentUid,
                playerNumber: dorsal,
                playerAlias:  player.alias || player.name,
                rival:        rivalName,
                scoreHome,
                scoreAway,
                minutes:      typeof formatTime==='function' ? formatTime(player.time||0) : String(player.time||0),
                goals:        player.goals || 0,
                cards:        player.cards || 'ninguna',
                history:      _parseHistoryForFirestore(player.history || []),
                matchId:      prId,
                createdAt:    new Date().toISOString()
            });
            } catch(parentErr) {
                // Un padre falló → log y continuar con el siguiente
                console.warn('[autoDispatch] Error enviando informe a padre:', {
                    parentUid, dorsal,
                    code: parentErr && parentErr.code,
                    message: parentErr && parentErr.message,
                }, parentErr);
            }
        }

        localStorage.removeItem('cronos_match_rpt_selection');

        // ── FASE C: INFORME COLECTIVO AL PROPIO ENTRENADOR ───────────────
        // El entrenador siempre recibe su propio informe colectivo como registro.
        // Usa el mismo matchId que el informe del staff para agrupación coherente.
        try {
            const matchId = sharedMatchId; // mismo ID que staff

            // [DIAG TEMP] Confirmar que la FASE C se ejecuta y con qué datos.


            // Guardar copia del informe en cronos_player_reports con coachUid = uid
            for (const p of homePlayers) {
                const rptId = `${matchId}_coach_p${p.number}`;
                try {
                await setDoc(doc(db, 'cronos_player_reports', rptId), {
                    matchId,
                    type:          'collective_match_report',
                    staffReport:   false,         // no aparece en vista del staff (ya tiene staffReport=true)
                    _forCoach:     true,
                    clubId:        me.clubId || null,
                    coachUid:      me.uid,
                    coachEmail:    me.email,
                    matchDate:     new Date().toISOString().split('T')[0],
                    rival:         rivalName,
                    scoreHome,
                    scoreAway,
                    myTeamRole:    _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                    category:      window._currentMatchCategory || '',
                    subcategory:   _cMatchSubcatFor(me, window._currentMatchCategory || ''),
                    // Clave de equipo: el informe es del equipo, no del autor.
                    teamId:        (typeof window.cronosTeamId === 'function')
                                     ? window.cronosTeamId(me.clubId || '', window._currentMatchCategory || '',
                                                           _cMatchSubcatFor(me, window._currentMatchCategory || ''))
                                     : '',
                    createdAt:     new Date().toISOString(),
                    playerNumber:  String(p.number||''),
                    playerAlias:   p.alias || p.name || '',
                    position:      p.position || p.pos || '',
                    goals:         p.goals  || 0,
                    cards:         p.cards  || null,
                    injured:       p.injured || false,
                    minutesPlayed: typeof formatTime==='function' ? formatTime(p.time||0) : String(p.time||0),
                    history:       _parseHistoryForFirestore(p.history||[]),
                });
                // [DIAG TEMP] setDoc del coach OK para este jugador.
                } catch (setErr) {
                    // [DIAG TEMP] Capturar el fallo concreto del setDoc por jugador
                    // (típicamente permission-denied de las reglas Firestore).
                    console.error('[FaseC][DIAG] setDoc coach FALLÓ:', rptId,
                        '| code:', setErr.code, '| msg:', setErr.message);
                }
            }

            // Notificación in-app para el propio entrenador (formato estándar)
            const coachNotifId = `coach_self_rpt_${me.uid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', coachNotifId), {
                type:      'informe_colectivo', // Usamos el tipo estándar para que aparezca en el feed
                clubId:    me.clubId || null,
                userId:    me.uid,              // FIX v177: campo que las reglas Firestore verifican (request.auth.uid == resource.data.userId)
                coachUid:  me.uid,
                parentUid: me.uid, // necesario para que el filtro de lectura lo encuentre
                staffUid:  me.uid,
                coachEmail: me.email,
                matchDate: new Date().toISOString().split('T')[0],
                rival: rivalName, 
                scoreHome, 
                scoreAway,
                matchId,
                message:   'Has generado un nuevo informe colectivo de partido.',
                createdAt: new Date().toISOString(),
            });
            // [DIAG TEMP] FASE C completada sin lanzar excepción al nivel superior.
        } catch(e) {
            // [DIAG TEMP] mostrar mensaje + objeto de error completo.
            console.error('FASE C ERROR setDoc coach:', e.message, e);
        }

        showToast('✅ Informes enviados automáticamente (Interno)', 4000);

    } catch(e) {
        console.error('[AutoDispatch] Error:', e);
    }
}

async function saveAllMatchReportsInternal() {
    const me = window._cronosCurrentUser;
    if (!me || !window.players) return;

    // ── GUARD DE IDEMPOTENCIA PERSISTENTE (localStorage) ─────────────────
    // Refuerza el guard en memoria (E4) para que sobreviva a recargas de
    // pagina y recuperaciones de partido. Se limpia al iniciar partido nuevo
    // (ver startMatchWithConvocation -> limpieza de 'cronos_reports_sent_').
    const _scoreHomeNow = document.getElementById('score-home')?.textContent || '0';
    const _scoreAwayNow = document.getElementById('score-away')?.textContent || '0';
    const _matchId = window.liveMatchId || ('local_' + (window._cronosCurrentUser?.uid || 'u') + '_' + new Date().toISOString().split('T')[0] + '_' + (window.TEAM_NAMES?.home || '') + '-' + _scoreHomeNow + '-' + _scoreAwayNow);
    const _guardKey = 'cronos_reports_sent_' + _matchId;
    if (localStorage.getItem(_guardKey)) {
        return;
    }
    localStorage.setItem(_guardKey, Date.now().toString());

    // ── E4: GUARD DE IDEMPOTENCIA ────────────────────────────────────────
    // El fin de partido se dispara desde varias rutas (endMatch manual,
    // terminateMatch por expulsiones, fin automático del crono). Cada una
    // llamaba a esta función, y cada llamada generaba informes a padres, por
    // lo que el padre recibía el informe individual 2-3 veces (E4: "informe
    // individual triplicado a padres").
    //
    // Solución: despachar como MÁXIMO una vez por partido finalizado.
    // La huella usa liveMatchId si existe; si no (modo sin sync en vivo),
    // se compone con uid + fecha + marcador para distinguir partidos reales
    // del mismo entrenador y evitar bloquear un partido legítimamente nuevo.
    // (_scoreHomeNow / _scoreAwayNow ya estan declarados arriba en el guard persistente)
    const _matchFingerprint =
        (typeof liveMatchId !== 'undefined' && liveMatchId)
            ? `live:${liveMatchId}`
            : `local:${me.uid}:${new Date().toISOString().split('T')[0]}:` +
              `${TEAM_NAMES.home}-${_scoreHomeNow}-${_scoreAwayNow}-${TEAM_NAMES.away}`;

    if (window._cronosLastDispatchedMatch === _matchFingerprint) {
        return;
    }
    // Reservar la huella ANTES del await para cerrar la ventana de carrera
    // entre disparos casi simultáneos (p. ej. crono + botón manual).
    window._cronosLastDispatchedMatch = _matchFingerprint;

    try {
        // Orquestador único: toda la generación de documentos (staff, padres y
        // copia del entrenador) vive en autoDispatchMatchReports(). Antes esta
        // función escribía además un doc `rpt_*` por jugador con parentUid, que
        // el panel del padre mostraba junto al `parent_player_report` generado
        // por autoDispatch → informe duplicado. Eliminado para una sola copia.
        await autoDispatchMatchReports();

    } catch(e) {
        console.error('[AutoReport] Error:', e.message);
        // Si falló, liberar la huella para permitir reintento manual.
        if (window._cronosLastDispatchedMatch === _matchFingerprint) {
            window._cronosLastDispatchedMatch = null;
        }
    }
}

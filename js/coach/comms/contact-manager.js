// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL · Gestión de Contactos (la "Fuente de la Verdad")
//  Extraído de js/coach/comms/panel.js (auditoría 2026-07-22, paso 4 de 6
//  del monolito #3). Movimiento MECÁNICO: cero cambios de comportamiento.
//
//  Contenido:
//    · openContactManager()       — la modal: auto-puebla staff y padres
//      desde Firestore y los fusiona con los contactos manuales
//    · saveContactManagerData()   — el guardado (cronos_player_links +
//      la lista unificada en la nube)
//    · renderContactRowMarkup()   — fila de staff (tabla azul)
//    · renderParentRowMarkup()    — fila de padre manual (tabla naranja)
//    · addNewContactRow / addNewParentRow — filas vacías
//
//  DEPENDE de panel.js — y de nada más de ese archivo:
//    _cFS, _cGetStaff, _catAndSubcatMatch, _loadParentList,
//    openUnifiedCommsMenu
//  (resuelven vía window en tiempo de click; el orden de <script> no
//  condiciona la ejecución). Fan-in externo: sólo core/setup-modal.js
//  invoca openContactManager; las otras cinco se llaman desde el HTML que
//  este archivo genera.
//
//  Y de otros archivos: los globales léxicos emailConfig y currentMode
//  (core/app-init.js), loadEmailConfig, cloudSet, escapeHtml, escapeAttr,
//  showToast/showSpinner/hideSpinner. Usa _cFS() y además el SDK de
//  Firestore por importación dinámica directa, dos veces.
//
//  ⚠️ ESTADO COMPARTIDO: escribe window._cronos_squad_cache, que lee
//  js/coach/comms/individual-reports.js (paso 3). Si algún día cambia el
//  formato de la plantilla, hay que mirar los dos archivos.
//
//  ⚠️ RAREZAS PREEXISTENTES QUE SE PRESERVAN A PROPÓSITO (las fija
//  scripts/test_contact_manager_module.js; NO son limpiezas pendientes
//  triviales, cambiarlas cambia comportamiento):
//   1. Los dos guards del arranque tocan una propiedad de window con el
//      mismo nombre que el global léxico que usa el resto de la función.
//      Son bindings DISTINTOS: un `let` de nivel de script no cuelga de
//      window, así que esos guards no protegen nada. Nadie más en el
//      repositorio lee esa propiedad. El guard que de verdad evita el
//      crash histórico es el de la migración.
//   2. La migración de los campos legacy a la lista de contactos se
//      deshace sola: la purga de staff que corre justo después elimina lo
//      recién migrado, porque no trae uid ni email de staff real.
//   3. El guardado busca una etiqueta "reports" que las palomillas nunca
//      escriben (usan cv/tr/msg/rpt/live), así que esa rama de
//      retrocompatibilidad es código muerto.
//   4. El comentario del inviteCode dice "sólo si no existía", pero se
//      escribe siempre que haya dorsal.
//   5. El jugador de un padre manual se recupera parseando el TEXTO del
//      <option>, no un dato estructurado.
//
//  Tests: scripts/test_contact_manager_module.js (dedicado) y
//         scripts/test_contact_manager_crash.js (xfail histórico).
// ════════════════════════════════════════════════════════════════════

// ── Gestión de Contactos (Teléfonos WhatsApp) ─────────────────────────
async function openContactManager() {
    // Pila de navegación (js/core/nav-stack.js). Mismo caso que Mis Informes:
    // se entra desde el modal de setup (core/setup-modal.js) Y desde el menú
    // de Comunicaciones, pero su "Volver" iba cableado a openUnifiedCommsMenu.
    if (typeof navScreen === 'function') navScreen('openContactManager');

    const me = window._cronosCurrentUser;
    if (!me) { if(typeof showToast==='function') showToast('⚠️ No hay sesión activa',3000); return; }
    const fa = window._cronos_auth;
    if (!fa || !fa.db) { if(typeof showToast==='function') showToast('⚠️ Firebase no disponible',3000); return; }
    const db = fa.db;
    if (typeof showSpinner === 'function') showSpinner('Cargando contactos…');

    // Asegurar que tenemos la config de email cargada y que emailConfig existe
    if (typeof window.emailConfig === 'undefined') window.emailConfig = { contacts: [] };
    // FIX: loadEmailConfig estaba FUERA del try/catch. Si su versión activa
    // (hay 3 definiciones) es async y rechaza, la promesa de esta función
    // async se rechazaba silenciosamente (onclick sin .catch) → "clic sin
    // efecto, sin error". Lo protegemos para que el modal abra igualmente.
    try { if (typeof loadEmailConfig === 'function') await loadEmailConfig(); }
    catch (e) { console.warn('[Contactos] loadEmailConfig falló, continúo igualmente:', e?.message); }
    if (!window.emailConfig) window.emailConfig = { contacts: [] };

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
        if (!emailConfig || !emailConfig.contacts) {
            if (!emailConfig) emailConfig = {};
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

        // ── AUTO-POPULACIÓN DESDE FIRESTORE ──
        const coachCat = me.category || me.categoryLabel || '';
        const coachSub = me.subcategory || '';
        const fns = await _cFS();

        // 1. Cargar Staff real de Firestore (Director y Coordinador)
        try {
            const realStaff = await _cGetStaff(db, me.clubId, fns, ['director', 'coordinator', 'club_admin', 'admin']);
            
            // Purgar contactos de staff que NO están realmente en Firestore
            const realStaffUids = new Set(realStaff.map(s => s.uid || s.id));
            const realStaffEmails = new Set(realStaff.map(s => (s.email || '').toLowerCase()).filter(Boolean));
            emailConfig.contacts = (emailConfig.contacts || []).filter(c => {
                if (c.type === 'parent') return true;
                if (c.uid === me.uid || c.type === 'coach') return true;
                const isRealUid = c.uid && realStaffUids.has(c.uid);
                const isRealEmail = c.email && realStaffEmails.has((c.email || '').toLowerCase());
                return isRealUid || isRealEmail;
            });

            realStaff.forEach(s => {
                const uid = s.uid || s.id;
                const email = s.email || '';
                const exists = (emailConfig.contacts || []).find(c => (uid && c.uid === uid) || (email && c.email === email));
                if (!exists) {
                    const roleLabel = (s.role === 'director' || s.role === 'club_admin' || s.role === 'admin') ? 'Director Deportivo' : 'Coordinador';
                    emailConfig.contacts.push({
                        id: 's_' + (uid || Math.random().toString(36).substr(2,6)),
                        name: s.displayName || s.name || roleLabel,
                        email: email,
                        phone: s.phone || '',
                        uid: uid || '',
                        role: s.role || 'staff',
                        type: 'staff',
                        tags: ['rpt', 'msg', 'cv', 'tr', 'live']
                    });
                }
            });
        } catch(sErr) { console.warn('[Contactos] Error cargando staff:', sErr); }

        // 2. Cargar Padres reales de Firestore (cronos_player_links de la categoría y subcategoría del entrenador)
        links.forEach(l => {
            const cat = l.category || l.categoryLabel || l.teamName || '';
            const sub = l.subcategory || '';
            if (_catAndSubcatMatch(coachCat, coachSub, cat, sub)) {
                const pUid = l.parentUid || l.uid || l._id;
                const pEmail = l.parentEmail || '';
                const exists = (emailConfig.contacts || []).find(c => c.type === 'parent' && ((pUid && (c.uid === pUid || c.id === pUid)) || (pEmail && c.email === pEmail)));
                if (!exists) {
                    emailConfig.contacts.push({
                        id: pUid,
                        name: l.parentName || l.parentEmail || 'Padre/Tutor',
                        player: l.playerAlias || l.playerName || 'Jugador',
                        playerId: l.playerId || ('J' + (l.playerNumber || '')),
                        playerNumber: l.playerNumber || '',
                        uid: pUid,
                        email: pEmail,
                        phone: l.parentPhone || l.parentWA || '',
                        type: 'parent',
                        category: l.category || coachCat,
                        subcategory: l.subcategory || coachSub,
                        tags: ['rpt', 'msg', 'cv', 'tr', 'live']
                    });
                }
            }
        });

        // 3. Cargar Usuarios con rol de Padre registrados en Firestore para la categoría/subcategoría
        try {
            const parentUsersSnap = await getDocs(query(
                collection(db, 'users'),
                where('clubId', '==', me.clubId || ''),
                where('role', '==', 'parent')
            ));
            parentUsersSnap.forEach(d => {
                const u = d.data();
                const uUid = d.id;
                const cat = u.category || u.categoryLabel || '';
                const sub = u.subcategory || '';
                if (_catAndSubcatMatch(coachCat, coachSub, cat, sub)) {
                    const exists = (emailConfig.contacts || []).find(c => c.type === 'parent' && (c.uid === uUid || (u.email && c.email === u.email)));
                    if (!exists) {
                        emailConfig.contacts.push({
                            id: uUid,
                            name: u.displayName || u.name || u.email || 'Padre/Tutor',
                            player: u.playerAlias || u.playerName || u.childName || 'Jugador',
                            playerId: u.playerId || '',
                            playerNumber: u.playerNumber || '',
                            uid: uUid,
                            email: u.email || '',
                            phone: u.phone || '',
                            type: 'parent',
                            category: cat || coachCat,
                            subcategory: sub || coachSub,
                            tags: ['rpt', 'msg', 'cv', 'tr', 'live']
                        });
                    }
                }
            });
        } catch(pErr) { console.warn('[Contactos] Error buscando usuarios padres:', pErr); }

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
                    <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();"
                        style="background:none;border:none;color:var(--text-muted);
                               font-size:1.6rem;cursor:pointer;line-height:1;" title="Salir al selector de roles">✕</button>
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
                                <tr class="parent-contact-row firestore-linked" data-linkid="${typeof escapeAttr==='function'?escapeAttr(link._id):link._id}"
                                    style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:0.45rem;font-weight:600;">
                                        ${typeof escapeHtml==='function'?escapeHtml(link.playerAlias || link.playerName || 'Jugador'):link.playerAlias || link.playerName || 'Jugador'}
                                        <span style="font-size:0.6rem;color:var(--text-muted);
                                                     margin-left:3px;background:rgba(255,255,255,0.06);
                                                     border-radius:3px;padding:1px 4px;">vinculado</span>
                                    </td>
                                    <td style="padding:0.45rem;font-weight:700;color:var(--primary);">#${typeof escapeAttr==='function'?escapeAttr(link.playerNumber):link.playerNumber}</td>
                                    <td style="padding:0.45rem;">
                                        <span style="background:rgba(240,136,62,0.12);color:#f0883e;font-size:0.7rem;font-weight:700;padding:1px 6px;border-radius:4px;cursor:help;" title="Código que el padre introduce al registrarse">
                                            🔑 ${typeof escapeHtml==='function'?escapeHtml(link.inviteCode || ('J'+link.playerNumber)):link.inviteCode || ('J'+link.playerNumber)}
                                        </span>
                                    </td>
                                    <td style="padding:0.45rem;">
                                        <input type="text" class="contact-phone" data-linkid="${typeof escapeAttr==='function'?escapeAttr(link._id):link._id}"
                                            value="${typeof escapeAttr==='function'?escapeAttr(link.parentPhone||''):link.parentPhone||''}" placeholder="34600112233"
                                            style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);
                                                   border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                                                   color:white;font-size:0.72rem;box-sizing:border-box;">
                                    </td>
                                    <td style="padding:0.45rem;">
                                        <input type="email" class="contact-parent-email" data-linkid="${typeof escapeAttr==='function'?escapeAttr(link._id):link._id}"
                                            value="${typeof escapeAttr==='function'?escapeAttr(link.parentEmail||''):link.parentEmail||''}" placeholder="padre@email.com"
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
                <button onclick="navBack()" class="btn" style="flex:1;">← VOLVER</button>
                <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();" class="btn" title="Salir al selector de roles"
                    style="flex:0 0 auto;color:var(--text-muted);">✕</button>
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
        // También genera el inviteCode (J{número}) si no existe todavía,
        // para que el padre pueda auto-registrarse con ese código.
        for (const input of parentInputs) {
            const linkId      = input.dataset.linkid;
            const phone       = input.value.trim().replace(/\s/g, '');
            const emailEl     = document.querySelector(`.contact-parent-email[data-linkid="${linkId}"]`);
            const cvEl        = document.querySelector(`.contact-cv[data-linkid="${linkId}"]`);
            const trEl        = document.querySelector(`.contact-tr[data-linkid="${linkId}"]`);
            const msgEl       = document.querySelector(`.contact-msg[data-linkid="${linkId}"]`);
            const rptEl       = document.querySelector(`.contact-rpt[data-linkid="${linkId}"]`);
            const liveEl      = document.querySelector(`.contact-live[data-linkid="${linkId}"]`);

            // Extraer playerNumber del linkId ({clubId}_{playerNumber})
            const playerNum = linkId.includes('_') ? linkId.split('_').pop() : null;
            // inviteCode = 'J' + playerNumber (ej: J10, J7, J1)
            const inviteCode = playerNum ? `J${playerNum}` : null;

            const updateData = {
                parentPhone:        phone,
                parentEmail:        emailEl   ? emailEl.value.trim()   : undefined,
                canWatchLive:       liveEl    ? liveEl.checked          : false,
                canReceiveReports:  rptEl     ? rptEl.checked           : false,
                canReceiveConv:     cvEl      ? cvEl.checked            : true,
                canReceiveTr:       trEl      ? trEl.checked            : true,
                canReceiveMsg:      msgEl     ? msgEl.checked           : true,
            };
            // Solo añadir inviteCode si no existía ya (para no sobreescribir)
            if (inviteCode) updateData.inviteCode = inviteCode;

            await updateDoc(doc(db, 'cronos_player_links', linkId), updateData);
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
    <tr class="custom-contact-row" data-id="${typeof escapeAttr==='function'?escapeAttr(id):id}" data-type="${typeof escapeAttr==='function'?escapeAttr(c.type||'staff'):c.type||'staff'}" 
        style="border-bottom:1px solid rgba(255,255,255,0.05); ${isCoach ? 'background:rgba(88,166,255,0.03);' : ''}">
        <td style="padding:0.4rem;">
            <input type="text" class="c-name" value="${typeof escapeAttr==='function'?escapeAttr(c.name||''):c.name||''}" placeholder="Nombre / Cargo"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="email" class="c-email" value="${typeof escapeAttr==='function'?escapeAttr(c.email||''):c.email||''}" placeholder="email@ejemplo.com"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="tel" class="c-phone" value="${typeof escapeAttr==='function'?escapeAttr(c.phone||''):c.phone||''}" placeholder="34600000000"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="text" class="c-uid" value="${typeof escapeAttr==='function'?escapeAttr(c.uid||''):c.uid||''}" placeholder="ID App (opcional)"
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
    <tr class="parent-contact-row manual-parent" data-id="${typeof escapeAttr==='function'?escapeAttr(id):id}"
        style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:0.4rem;">
            <input type="text" class="p-name" value="${typeof escapeAttr==='function'?escapeAttr(c.name||''):c.name||''}" placeholder="Nombre padre/madre"
                style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
        </td>
        <td style="padding:0.4rem;">
            <select class="p-player" style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
                <option value="">-- Seleccionar Jugador --</option>
                ${(window._cronos_squad_cache || []).map(p => `
                    <option value="${typeof escapeAttr==='function'?escapeAttr(p.id):p.id}" ${c.playerId === p.id ? 'selected' : ''}>
                        [${typeof escapeHtml==='function'?escapeHtml(p.id):p.id}] ${typeof escapeHtml==='function'?escapeHtml(p.alias||p.name||'Sin nombre'):p.alias||p.name||'Sin nombre'}
                    </option>
                `).join('')}
            </select>
        </td>
        <td style="padding:0.4rem;">
            <input type="tel" class="p-phone" value="${typeof escapeAttr==='function'?escapeAttr(c.phone||''):c.phone||''}" placeholder="34600000000"
                style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="email" class="p-email" value="${typeof escapeAttr==='function'?escapeAttr(c.email||''):c.email||''}" placeholder="padre@email.com"
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

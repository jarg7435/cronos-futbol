// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL · Gestión de Contactos (la "Fuente de la Verdad")
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
            let realStaff = await _cGetStaff(db, me.clubId, fns, ['director', 'coordinator', 'club_admin', 'admin']);

            // ══════════════════════════════════════════════════════════
            //  🎯 v593 · EL COORDINADOR QUE LE TOCA A ESTE EQUIPO
            //
            //  Petición del autor: las convocatorias y los entrenamientos
            //  tienen que llegar al coordinador de SU modalidad. Aquí es donde
            //  se decide de verdad: esta lista es la que alimenta las
            //  palomillas de Gestión de Contactos y, por tanto, a quién se le
            //  crea el aviso en cronos_notifications.
            //
            //  🔑 SE REUTILIZA _cronosResolveStaffForMatch (utils.js), que ya
            //  hacía exactamente esto para los informes de partido desde la
            //  Pieza 2. El Director entra siempre; el coordinador, sólo si su
            //  modalidad cubre la categoría del entrenador. Sin categoría no
            //  se puede juzgar y entran todos (fail-open).
            //
            //  ⚠️ EL FILTRO SE APLICA ANTES DE LA PURGA DE ABAJO, A PROPÓSITO:
            //  así un entrenador de F7 que ya tuviera guardado al coordinador
            //  de F11 —de cuando el rol era genérico— deja de tenerlo. Si sólo
            //  se filtrara el alta, la lista vieja seguiría enrutando mal y el
            //  cambio no se notaría en los clubes que ya están funcionando.
            // ══════════════════════════════════════════════════════════
            if (typeof window._cronosResolveStaffForMatch === 'function') {
                realStaff = window._cronosResolveStaffForMatch(realStaff, coachCat);
            }

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
                        name: l.parentName || l.parentEmail || 'Familiar / Jugador',
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
                            name: u.displayName || u.name || u.email || 'Familiar / Jugador',
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
        const rosterData = window.cronosPlantillaAmbas();   // v580 · la del EQUIPO abierto
        const currentSquad = rosterData[currentMode || 'f11'] || [];
        window._cronos_squad_cache = currentSquad; // Caché global para renderParentRowMarkup

        modal.innerHTML = `
        <div class="modal-content" style="width:min(98vw,870px);max-height:92vh;
             display:flex;flex-direction:column;padding:0;overflow:hidden;">

            <!-- ── CABECERA FIJA ── -->
            <div style="padding:1rem 1.2rem 0.7rem;flex-shrink:0;
                        border-bottom:1px solid var(--glass-border);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.6rem;">
                    <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                        <!-- 🔴 v598 · EL "VOLVER AL MENÚ" DE LA CABECERA.
                             Reportado por el autor (2026-08-21): «al entrar en
                             Contactos no hay un botón para regresar al menú
                             principal y obliga a salir totalmente del rol».
                             Y tenía razón en lo que se VE: sí existía un
                             "← VOLVER" al pie, pero esta pantalla mide 92vh y
                             tiene una zona de scroll larguísima (staff + todas
                             las familias), así que al entrar el pie queda fuera
                             de la vista. Lo único visible arriba era la ✕, que
                             literalmente dice "Salir al selector de roles". Con
                             lo que estaba a mano, salir del rol era la única
                             salida — exactamente su síntoma.
                             Ahora la vuelta está donde se mira primero. -->
                        <button onclick="cmVolverAlMenu()" title="Volver al menú anterior"
                            style="flex:0 0 auto;display:inline-flex;align-items:center;gap:0.35rem;
                                   padding:0.35rem 0.7rem;border-radius:8px;cursor:pointer;
                                   background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.4);
                                   color:#58a6ff;font-size:0.76rem;font-weight:800;">← Volver</button>
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

                    <div style="padding:0.5rem 0.5rem 0;">${_cmBarra('ctstaff')}</div>

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

                <!-- ══ SECCIÓN 2: PADRES / TUTORES ══
                     ⛔ Desaparece entera cuando el club no tiene rol de
                     familias: es el rastro más visible del colectivo y lo que
                     el autor pidió eliminar (2026-08-24). Con la sección
                     oculta no hay dónde dar de alta un padre, que es la raíz
                     de todo lo demás. -->
                ${(typeof window.cronosHayPadres === 'function' && !window.cronosHayPadres()) ? '' : `
                <div style="border:1px solid rgba(240,136,62,0.25);border-radius:12px;
                            background:rgba(240,136,62,0.02);margin-bottom:1rem;">

                    <!-- Cabecera sección -->
                    <div style="padding:0.7rem 1rem;border-bottom:1px solid rgba(240,136,62,0.2);
                                display:flex;justify-content:space-between;align-items:center;
                                flex-wrap:wrap;gap:0.5rem;background:rgba(240,136,62,0.04);
                                border-radius:12px 12px 0 0;">
                        <div>
                            <h3 style="font-size:0.88rem;color:var(--secondary);margin:0;font-weight:700;">
                                👨‍👩‍👧‍👦 Familiares / Jugadores
                            </h3>
                            <p style="font-size:0.67rem;color:var(--text-muted);margin:0.1rem 0 0;">
                                Los vinculados por plantilla aparecen automáticamente. Puedes añadir más.
                            </p>
                        </div>
                        <button onclick="addNewParentRow()" class="btn"
                            style="padding:0.35rem 0.9rem;font-size:0.72rem;
                                   background:var(--secondary);color:#0a0e14;border:none;
                                   border-radius:6px;font-weight:700;white-space:nowrap;flex-shrink:0;">
                            ➕ AÑADIR FAMILIAR / JUGADOR
                        </button>
                    </div>

                    <div style="padding:0.5rem 0.5rem 0;">${_cmBarra('ctfam')}</div>

                    <!-- Tabla con scroll horizontal solo si es necesario -->
                    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0.5rem;">
                        <table style="width:100%;min-width:580px;font-size:0.74rem;border-collapse:collapse;">
                            <thead>
                                <!-- ══════════════════════════════════════════════════════
                                     v430 · LAS 10 COLUMNAS DE "PADRES / TUTORES", en el
                                     orden fijado por el autor. Ademas de reordenar, esto
                                     ARREGLA UN DESCUADRE REAL Y PREEXISTENTE: la fila del
                                     padre VINCULADO traia 12 celdas contra 11 cabeceras
                                     (llevaba el dorsal Y el codigo en dos celdas, pero solo
                                     habia una cabecera para las dos). Desde la 3a columna,
                                     cada palomilla del padre vinculado quedaba bajo el
                                     rotulo de la ANTERIOR: el entrenador creia marcar MSJ.
                                     y estaba marcando ENTR. Los datos se guardaban bien
                                     —el guardado busca por CLASE, no por posicion—, asi que
                                     el fallo era puramente visual y por eso nunca dio error.
                                     Ahora las tres formas de fila (cabecera, vinculado y
                                     manual) tienen EXACTAMENTE 11 celdas: las 10 pedidas
                                     mas la de acciones. Lo fija el guard con un recuento.
                                     ⚠️ Al tocar esta tabla hay que cambiar LAS TRES a la
                                     vez: vinculados y manuales comparten el mismo <tbody>.
                                     ══════════════════════════════════════════════════════ -->
                                <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.1);">
                                    <th style="padding:0.45rem;text-align:left;min-width:130px;">FAMILIAR</th>
                                    <th style="padding:0.45rem;text-align:left;min-width:120px;"
                                        title="Codigo del jugador asociado a este familiar">CODIGO JUGADOR</th>
                                    <th style="padding:0.45rem;text-align:left;min-width:110px;">WHATSAPP</th>
                                    <th style="padding:0.45rem;text-align:left;min-width:130px;">EMAIL</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Recibir convocatorias">CONV.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Recibir entrenamientos">ENTR.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Recibir mensajes del club">MSJ.</th>
                                    <!-- v429 · Permiso de ENVÍO. Recibir y poder escribir son
                                         cosas distintas: TODOS los padres reciben siempre; poder
                                         escribir lo autoriza el entrenador uno a uno. -->
                                    <th style="padding:0.45rem;text-align:center;color:#3fb950;"
                                        title="Permitir enviar mensajes al entrenador. Si se desmarca, ese familiar o jugador solo puede RECIBIR.">ENVIAR ✍️</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Recibir los informes individuales del jugador">INF.</th>
                                    <th style="padding:0.45rem;text-align:center;color:#ff5858;" title="Ver los partidos en vivo">EN VIVO 📡</th>
                                    <th style="padding:0.45rem;"></th>
                                </tr>
                            </thead>
                            <tbody id="tbody-parent-contacts">
                                ${links.sort((a,b) => (a.playerNumber||0)-(b.playerNumber||0)).map(link => `
                                <tr class="parent-contact-row firestore-linked" data-linkid="${typeof escapeAttr==='function'?escapeAttr(link._id):link._id}"
                                    style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <!-- 1 · FAMILIAR. Antes esta celda mostraba el nombre del
                                         JUGADOR, no el del familiar, aunque el vínculo ya
                                         guardaba parentName: el dato estaba y no se pintaba.
                                         Ahora es editable y se persiste, como el teléfono y el
                                         email de al lado.
                                         ⚠️ SIN BACKTICKS aquí dentro (ver la nota de la celda
                                         de ENVIAR): cierran el template literal del innerHTML. -->
                                    <td style="padding:0.45rem;">
                                        <input type="text" class="contact-parent-name" data-linkid="${typeof escapeAttr==='function'?escapeAttr(link._id):link._id}"
                                            value="${typeof escapeAttr==='function'?escapeAttr(link.parentName||''):link.parentName||''}"
                                            placeholder="Nombre del familiar / jugador"
                                            style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);
                                                   border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                                                   color:white;font-size:0.72rem;box-sizing:border-box;">
                                    </td>
                                    <!-- 2 · CÓDIGO DEL JUGADOR. Una sola celda con las tres
                                         señas del vínculo —código de invitación, dorsal y alias—
                                         para que de un vistazo se vea A QUÉ JUGADOR pertenece
                                         este familiar. Antes iban en dos celdas y esa era la
                                         causa del descuadre de la tabla. -->
                                    <td style="padding:0.45rem;white-space:nowrap;">
                                        <span style="background:rgba(240,136,62,0.12);color:#f0883e;font-size:0.7rem;font-weight:700;padding:1px 6px;border-radius:4px;cursor:help;" title="Código que el familiar o el jugador introduce al registrarse">
                                            🔑 ${typeof escapeHtml==='function'?escapeHtml(link.inviteCode || ('J'+link.playerNumber)):link.inviteCode || ('J'+link.playerNumber)}
                                        </span>
                                        <span style="font-size:0.66rem;color:var(--text-muted);margin-left:4px;"
                                            title="Jugador vinculado">
                                            #${typeof escapeHtml==='function'?escapeHtml(String(link.playerNumber||'')):String(link.playerNumber||'')}
                                            ${typeof escapeHtml==='function'?escapeHtml(link.playerAlias || link.playerName || 'Jugador'):link.playerAlias || link.playerName || 'Jugador'}
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
                                            value="${typeof escapeAttr==='function'?escapeAttr(link.parentEmail||''):link.parentEmail||''}" placeholder="familiar@email.com"
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
                                    <!-- v429 · "Permitir enviar mensajes". Se compara con
                                         distinto-de-false, NO con igual-a-true: los vínculos ya
                                         existentes NO traen el campo, y la decisión del autor es
                                         que nadie pierda de golpe una capacidad que ya tenía.
                                         Exigiendo igual-a-true, el día del despliegue TODOS los
                                         padres se quedarían mudos hasta que el entrenador los
                                         rehabilitara uno a uno.
                                         ⚠️ SIN BACKTICKS en este comentario: va DENTRO del
                                         template literal del innerHTML y uno solo lo cierra,
                                         rompiendo el render entero SIN que node --check lo vea
                                         (lo que queda detrás sigue siendo JS válido). Costó los
                                         8 fallos de test_contact_manager_module en v429. -->
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-cansend" data-linkid="${link._id}"
                                            ${link.canSendMsg !== false ? 'checked' : ''}
                                            title="Si se desmarca, este familiar o jugador solo podrá RECIBIR mensajes"
                                            style="width:16px;height:16px;accent-color:#3fb950;">
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
                </div>`}<!-- fin SECCIÓN 2, condicionada al rol de familias -->

            </div><!-- fin scroll único -->

            <!-- ── BOTONES FIJOS ABAJO ── -->
            <div style="padding:0.8rem 1rem;border-top:1px solid var(--glass-border);
                        display:flex;gap:0.7rem;flex-shrink:0;background:var(--surface);">
                <button onclick="cmVolverAlMenu()" class="btn" style="flex:1;">← VOLVER AL MENÚ</button>
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

// ════════════════════════════════════════════════════════════════════
//  🔙 v598 · LA VUELTA AL MENÚ DE ESTA PANTALLA, CON RED DEBAJO
//
//  Los dos botones de volver de Contactos (el nuevo de la cabecera y el
//  "← VOLVER AL MENÚ" del pie) llaman aquí en vez de a `navBack()` a pelo.
//
//  🔑 POR QUÉ NO BASTA `navBack()`. Cuando la pila tiene UN solo nivel,
//  `navBack` se degrada a `navExit()` (nav-stack.js:95), que se limita a
//  ocultar #setup-modal. En el panel del Entrenador, debajo de ese modal está
//  la pantalla del partido, así que "volver" te deja mirando el campo, fuera
//  del menú y sin forma evidente de regresar: es el mismo síntoma que el autor
//  describe como "obliga a salir totalmente del rol". Normalmente la pila SÍ
//  trae un nivel previo (se entra desde `openSetupModal`, que es raíz, o desde
//  el menú de Comunicaciones), pero basta un camino de entrada que no lo haga
//  —o un `navRootScreen` posterior que la resetee— para caer en ese agujero.
//
//  🔑 LA RED: si no hay a dónde volver, se PINTA el menú de entrada en lugar
//  de cerrar el modal. Nunca se sale del rol desde un botón que dice "volver".
//  Para salir está la ✕, que lo dice y para eso está.
//
//  ⚠️ VIVE DEBAJO DE `openContactManager` A PROPÓSITO: el guard
//  (scripts/test_contact_manager_module.js) recorta el fichero DESDE esa
//  función, así que lo que se escriba por encima queda fuera del sandbox y no
//  se puede ejecutar en las pruebas. Colocada aquí, 3f4 y 3f5 la corren de
//  verdad y miran qué decide.
// ════════════════════════════════════════════════════════════════════
window.cmVolverAlMenu = function cmVolverAlMenu() {
    // Camino normal: hay pantalla anterior, se vuelve exactamente por donde
    // se vino (Comunicaciones, el modal de setup, o de donde sea).
    if (typeof navCanGoBack === 'function' && navCanGoBack()) return navBack();

    // Sin nivel previo: se REPINTA un menú, no se cierra nada.
    if (typeof openUnifiedCommsMenu === 'function') return openUnifiedCommsMenu();
    if (typeof openSetupModal      === 'function') return openSetupModal();

    // Último recurso: el comportamiento de siempre. Peor que lo anterior,
    // pero mejor que un botón que no hace nada.
    if (typeof navBack === 'function') return navBack();
};

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
            const nameEl      = document.querySelector(`.contact-parent-name[data-linkid="${linkId}"]`);
            const emailEl     = document.querySelector(`.contact-parent-email[data-linkid="${linkId}"]`);
            const cvEl        = document.querySelector(`.contact-cv[data-linkid="${linkId}"]`);
            const trEl        = document.querySelector(`.contact-tr[data-linkid="${linkId}"]`);
            const msgEl       = document.querySelector(`.contact-msg[data-linkid="${linkId}"]`);
            const sendEl      = document.querySelector(`.contact-cansend[data-linkid="${linkId}"]`);
            const rptEl       = document.querySelector(`.contact-rpt[data-linkid="${linkId}"]`);
            const liveEl      = document.querySelector(`.contact-live[data-linkid="${linkId}"]`);

            // Extraer playerNumber del linkId ({clubId}_{playerNumber})
            const playerNum = linkId.includes('_') ? linkId.split('_').pop() : null;
            // inviteCode = 'J' + playerNumber (ej: J10, J7, J1)
            const inviteCode = playerNum ? `J${playerNum}` : null;

            const updateData = {
                parentPhone:        phone,
                canWatchLive:       liveEl    ? liveEl.checked          : false,
                canReceiveReports:  rptEl     ? rptEl.checked           : false,
                canReceiveConv:     cvEl      ? cvEl.checked            : true,
                canReceiveTr:       trEl      ? trEl.checked            : true,
                canReceiveMsg:      msgEl     ? msgEl.checked           : true,
                // v429 · permiso de ENVÍO del padre. El respaldo es `true` (no
                // `false`) por lo mismo que el `!== false` del render: si la
                // casilla no está en el DOM, no se le quita a nadie un permiso
                // que ya tenía. Lo lee el propio padre desde su vínculo, que es
                // el único documento del entrenador que las reglas le dejan ver
                // (isLinkOwner en cronos_player_links).
                canSendMsg:         sendEl    ? sendEl.checked          : true,
            };

            // ⚠️ CORRECCIÓN v431 — EL `undefined` NO SE IGNORA, LANZA.
            // Hasta v430 estos dos campos se escribían como
            // `parentEmail: emailEl ? emailEl.value.trim() : undefined`, con el
            // comentario (mío, y equivocado) de que "Firestore ignora los
            // undefined en un updateDoc". NO es cierto: el SDK sólo los ignora
            // si la instancia se creó con `ignoreUndefinedProperties: true`, y
            // en este proyecto eso no se usa en ningún sitio. Sin esa opción,
            // updateDoc **lanza** ("Unsupported field value: undefined") y se
            // cae el guardado ENTERO de la tabla de contactos, no sólo ese
            // campo. El defecto era latente porque en el flujo normal las dos
            // casillas están en el DOM; saltaba sólo con el formulario a medio
            // montar, que es justo cuando peor viene.
            //
            // La intención original SÍ era buena —no pisar con cadena vacía un
            // dato ya guardado—, así que se conserva: el campo se añade sólo si
            // su casilla existe, y si no existe simplemente no viaja.
            if (nameEl)  updateData.parentName  = nameEl.value.trim();
            if (emailEl) updateData.parentEmail = emailEl.value.trim();

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
// ══════════════════════════════════════════════════════════════════════
//  🗂️ v669 · SELECCIÓN MÚLTIPLE EN LAS DOS TABLAS (multi-select.js)
//
//  ⚠️⚠️ AQUÍ "BORRAR" NO TOCA LA BASE DE DATOS. El 🗑️ de una fila hace
//  `this.closest('tr').remove()`: quita la fila de la TABLA, y el cambio
//  sólo se guarda cuando el entrenador pulsa Guardar. El borrado múltiple
//  hace exactamente eso mismo, N veces — y la confirmación lo dice, porque
//  prometer una purga que no ocurre es peor que no ofrecerla.
//
//  ⚠️⚠️ LA CASILLA VA DENTRO DE LA CELDA DE LA PAPELERA, no en una columna
//  nueva. Estas tablas tienen un número de columnas FIJADO POR UN GUARD
//  (scripts/test_parent_table_columns.js, "las 10 columnas") porque las
//  filas vinculadas y las manuales comparten el mismo <tbody>: una celda de
//  más en un tipo de fila desalinea la tabla entera a partir de ahí. Meter
//  una columna habría obligado a tocar los dos marcados y la cabecera.
//
//  🔑 Y SÓLO LAS FILAS MANUALES LLEVAN CASILLA, porque sólo ellas llevan
//  papelera: la fila de un familiar VINCULADO por plantilla no se puede
//  borrar desde aquí. Ofrecer marcarla sería ofrecer algo que no existe.
// ══════════════════════════════════════════════════════════════════════
function _cmHayMS() {
    return !!(window.cronosMS && typeof window.cronosMS.chk === 'function');
}
function _cmChk(grupo, id) {
    return _cmHayMS()
        ? window.cronosMS.chk(grupo, id, { titulo: 'Seleccionar esta fila para quitarla en bloque' })
        : '';
}
function _cmBarra(grupo) {
    if (!_cmHayMS()) return '';
    const queEs = grupo === 'ctstaff' ? 'contacto de staff' : 'familiar / jugador';
    window.cronosMS.registrar(grupo, [{
        id: 'quitar',
        icono: '🗑️',
        etiqueta: 'Quitar seleccionados',
        titulo: 'Quitar de la tabla las filas marcadas (se guarda al pulsar Guardar)',
        confirmar: (ks) =>
            '🗑️ QUITAR DE LA TABLA\n\n' +
            'Vas a quitar ' + ks.length + ' ' + queEs + (ks.length === 1 ? '' : 's') + '.\n\n' +
            'Se quitan de la tabla ahora; el cambio queda registrado cuando pulses\n' +
            'GUARDAR. Si sales sin guardar, no se pierde nada.\n\n¿Continuar?',
        ejecutar: async (ks) => {
            // Se trabaja sobre el DOM directamente: la fila ES el dato hasta
            // que se guarda, así que no hay índice que consultar.
            let n = 0;
            document.querySelectorAll('.cms-chk-' + grupo + ':checked').forEach((c) => {
                const tr = c.closest('tr');
                if (tr) { tr.remove(); n++; }
            });
            return { ok: n, fallos: 0,
                resumen: n
                    ? ('🗑️ ' + n + ' fila' + (n === 1 ? '' : 's') + ' quitada' + (n === 1 ? '' : 's') +
                       ' · pulsa GUARDAR para que el cambio quede registrado')
                    : '⚠️ No se quitó ninguna fila' };
        },
        alTerminar: () => { window.cronosMS.sync(grupo); },
    }]);
    return window.cronosMS.barra(grupo);
}

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
            `<span style="display:inline-flex;align-items:center;gap:5px;">
                ${_cmChk('ctstaff', id)}
                <button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#ff5858;cursor:pointer;font-size:1rem;" title="Eliminar">🗑️</button>
            </span>`}
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
            <input type="text" class="p-name" value="${typeof escapeAttr==='function'?escapeAttr(c.name||''):c.name||''}" placeholder="Nombre familiar / jugador"
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
            <input type="email" class="p-email" value="${typeof escapeAttr==='function'?escapeAttr(c.email||''):c.email||''}" placeholder="familiar@email.com"
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
        <!-- v429 · Columna "ENVIAR ✍️". Los padres MANUALES no tienen cuenta en
             la app (esta fila no captura uid, solo teléfono y email), así que no
             pueden abrir un chat y el permiso no les aplica. Pero la celda TIENE
             que existir: estas filas se añaden al MISMO <tbody> que las de los
             padres vinculados, y sin ella la tabla se desalinearía una columna
             entera a partir de aquí. -->
        <td style="padding:0.4rem;text-align:center;color:var(--text-muted);font-size:0.68rem;"
            title="Solo aplica a familiares y jugadores vinculados con cuenta en la app">—</td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-rpt" ${isRpt ? 'checked' : ''} style="width:15px;height:15px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-live" ${isLive ? 'checked' : ''}
                style="width:15px;height:15px;accent-color:#ff5858;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <span style="display:inline-flex;align-items:center;gap:5px;">
                ${_cmChk('ctfam', id)}
                <button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#ff5858;cursor:pointer;font-size:1rem;" title="Eliminar">🗑️</button>
            </span>
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

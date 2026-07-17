// ══════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — Envío de convocatoria por WhatsApp / Email
//  v76: Fusión de whatsapp-email.js + convocation.js.
//       convocation.js eliminado — todas sus funciones viven aquí.
//       Añadido parámetro `target` en openConvocationMessage():
//         'parents'      → título "Enviar Convocatoria a Padres"
//         'coordinators' → título "Enviar Convocatoria a Coordinadores"
//         'directors'    → título "Enviar Convocatoria a Directores"
//         (sin valor)    → título genérico "Enviar Convocatoria"
// ══════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// FIX (Error #13): Cargar usuarios REALES del club desde Firestore
// para que directores/coordinadores/entrenadores/padres aparezcan
// automáticamente en el selector, sin necesidad de añadirlos manualmente
// en Gestión de Contactos.
// ════════════════════════════════════════════════════════════════════
window._cronosClubUsersCache = null;
window._cronosLoadClubUsers = async function() {
    if (window._cronosClubUsersCache) return window._cronosClubUsersCache;
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!me || !fa) { window._cronosClubUsersCache = []; return []; }
    try {
        const { collection, getDocs, query, where } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const clubId = me.clubId;
        if (!clubId) { window._cronosClubUsersCache = []; return []; }
        const snap = await getDocs(query(collection(fa.db, 'users'), where('clubId', '==', clubId)));
        const users = [];
        snap.forEach(d => {
            const u = d.data();
            users.push({
                id: d.id,
                uid: d.id,
                name: u.displayName || u.firstName || u.email || 'Sin nombre',
                email: u.email || '',
                phone: u.phone || '',
                role: u.role || '',
                type: (u.role === 'parent' || u.role === 'parent_individual') ? 'parent' : 'staff',
                category: u.category || '',
                subcategory: u.subcategory || '',
                playerAlias: u.playerAlias || '',
                allRoles: u.allRoles || []
            });
        });
        window._cronosClubUsersCache = users;
        // FIX (Error #14): log DETALLADO para ver exactamente qué roles tienen
        console.log('[_cronosLoadClubUsers] cargados', users.length, 'usuarios del club:');
        users.forEach((u, i) => {
            const allRolesStr = Array.isArray(u.allRoles)
                ? u.allRoles.map(r => r.role || JSON.stringify(r)).join(', ')
                : '(sin allRoles)';
            console.log(`  [${i}] name="${u.name}" | email="${u.email}" | rootRole="${u.role}" | type="${u.type}" | allRoles=[${allRolesStr}]`);
        });
        return users;
    } catch(e) {
        console.warn('[_cronosLoadClubUsers] ERROR:', e.code || e.message);
        window._cronosClubUsersCache = [];
        return [];
    }
};

// ════════════════════════════════════════════════════════════════════
// NUEVO FLUJO SIMPLIFICADO (Error #11):
// 1. Tras rellenar convocatoria/entrenamiento → aparece selector de roles
// 2. Al elegir rol → aparece lista de personas de ese rol con checkboxes
// 3. Se envía SOLO a las personas marcadas
// ════════════════════════════════════════════════════════════════════

// Almacena el rol seleccionado y las personas marcadas temporalmente
window._cronosSelectedRole = null;
window._cronosSelectedRecipients = [];

// PASO 1: Selector de roles (6 combinaciones)
window._cronosOpenRoleSelector = function(context) {
    // context: 'convocatoria' | 'entrenamiento'
    window._cronosSelectedRole = null;
    window._cronosSelectedRecipients = [];

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    const isConv = context === 'convocatoria';
    const title = isConv ? '📤 Enviar Convocatoria' : '📤 Enviar Entrenamiento';
    const icon = isConv ? '📋' : '📅';

    modal.innerHTML = `
    <div class="modal-content" style="width:min(94vw,460px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <div style="padding:1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1.1rem;">${icon} ${title}</h3>
            <button onclick="openConvocationModal()"
                style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <div style="padding:1.2rem;overflow-y:auto;flex:1;">
            <div style="font-size:0.85rem;color:var(--text);margin-bottom:0.5rem;font-weight:600;">
                ¿A quién quieres enviar?
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1.2rem;">
                Selecciona el destinatario. Luego podrás elegir personas concretas.
            </div>

            <div style="display:grid;gap:0.7rem;">
                <button onclick="_cronosOpenRecipientPicker('directores', '${context}')"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">📋</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Solo Directores Deportivos</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Enviar únicamente a directores</div>
                    </div>
                </button>

                <button onclick="_cronosOpenRecipientPicker('coordinadores', '${context}')"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(240,136,62,0.08);border:1px solid rgba(240,136,62,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">🎯</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Solo Coordinadores</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Enviar únicamente a coordinadores</div>
                    </div>
                </button>

                <button onclick="_cronosOpenRecipientPicker('padres', '${context}')"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">👨‍👩‍👧</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Solo Padres</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Enviar únicamente a padres/tutores</div>
                    </div>
                </button>

                <button onclick="_cronosOpenRecipientPicker('directores_coordinadores', '${context}')"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(180,120,200,0.08);border:1px solid rgba(180,120,200,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">📋🎯</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Directores + Coordinadores</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Enviar a staff técnico completo</div>
                    </div>
                </button>

                <button onclick="_cronosOpenRecipientPicker('directores_padres', '${context}')"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(100,180,200,0.08);border:1px solid rgba(100,180,200,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">📋👨‍👩‍👧</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Directores + Padres</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Enviar a directores y padres</div>
                    </div>
                </button>

                <button onclick="_cronosOpenRecipientPicker('coordinadores_padres', '${context}')"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(200,180,100,0.08);border:1px solid rgba(200,180,100,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">🎯👨‍👩‍👧</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Coordinadores + Padres</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Enviar a coordinadores y padres</div>
                    </div>
                </button>

                <button onclick="_cronosOpenRecipientPicker('todos', '${context}')"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(150,150,255,0.1);border:1px solid rgba(150,150,255,0.35);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">📋🎯👨‍👩‍👧</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Directores + Coordinadores + Padres</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Enviar a todos (staff + padres)</div>
                    </div>
                </button>
            </div>
        </div>

        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);flex-shrink:0;">
            <button onclick="openConvocationModal()" class="btn"
                style="color:var(--text-muted);width:100%;">← Volver</button>
        </div>
    </div>`;
};

// PASO 2: Lista de personas del rol seleccionado, con checkboxes
window._cronosOpenRecipientPicker = async function(role, context) {
    window._cronosSelectedRole = role;
    window._cronosSelectedRecipients = [];

    // FIX (Error #13): combinar contactos manuales (emailConfig.contacts)
    // con usuarios REALES del club cargados desde Firestore.
    const manualContacts = (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts))
        ? emailConfig.contacts : [];
    const clubUsers = await window._cronosLoadClubUsers();
    // Combinar, deduplicando por email.
    // FIX (dedup uid v2): PRIORIDAD INVERTIDA. Cuando un contacto manual y un
    // usuario REAL del club comparten email, el registro del CLUB (con uid) es
    // la base/fuente de verdad — el uid SIEMPRE gana. Encima superponemos los
    // datos útiles editados a mano del contacto manual (alias/etiqueta visible
    // tipo "BRUNO", teléfono, cargo). Así nunca perdemos el uid real y a la vez
    // conservamos las personalizaciones del entrenador.
    const clubUsersByEmail = new Map();
    clubUsers.forEach(u => {
        const email = (u.email || '').toLowerCase().trim();
        if (email) clubUsersByEmail.set(email, u);
    });
    const seenEmails = new Set();
    const contacts = [];
    // Recorremos los manuales; si hay match con el club, fusionamos con el club como base
    manualContacts.forEach(c => {
        if (!c) return;
        const email = (c.email || '').toLowerCase().trim();
        let merged = c;
        if (email) {
            seenEmails.add(email);
            const clubMatch = clubUsersByEmail.get(email);
            if (clubMatch) {
                // BASE = usuario del club (uid + roles/categoría reales).
                // OVERLAY = campos editados a mano del contacto manual (si existen).
                merged = { ...clubMatch };
                // uid: SIEMPRE el del club (fuente de verdad). Solo caemos al
                // manual si el club no lo tuviera (no debería pasar).
                merged.uid = clubMatch.uid || c.uid || '';
                // Nombre/alias visible: preferimos la etiqueta personalizada del manual.
                const manualLabel = c.alias || c.name || c.label;
                if (manualLabel && manualLabel.trim()) merged.name = manualLabel.trim();
                if (c.alias && c.alias.trim()) merged.alias = c.alias.trim();
                // Datos de contacto editados a mano tienen prioridad si están presentes.
                if (c.phone && c.phone.trim()) merged.phone = c.phone.trim();
                if (c.email && c.email.trim()) merged.email = c.email.trim();
                // Cargo/rol manual (si el entrenador lo fijó explícitamente).
                if (c.cargo && c.cargo.trim()) merged.cargo = c.cargo.trim();
                if (c.role && c.role.trim()) merged.role = c.role.trim();
                // Conservar cualquier flag/etiqueta extra del manual sin pisar lo del club.
                if (c.tags && !merged.tags) merged.tags = c.tags;
            }
        }
        contacts.push(merged);
    });
    // Luego los del club que no estén ya (sin match manual)
    clubUsers.forEach(c => {
        const email = (c.email || '').toLowerCase().trim();
        if (email && seenEmails.has(email)) return;
        contacts.push(c);
    });
    console.log('[_cronosOpenRecipientPicker] contactos combinados:', contacts.length,
        '(manuales:', manualContacts.length, '+ club:', clubUsers.length, ')');

    // FIX (Error #12): 'todos' = Directores + Coordinadores + Padres
    const wantsDirectores = role === 'todos' || role.includes('directores');
    const wantsCoordinadores = role === 'todos' || role.includes('coordinadores');
    const wantsPadres = role === 'todos' || role.includes('padres');

    // FIX (Error #12/13): mejorar deteccion de roles. Ahora busca en role,
    // name, cargo Y allRoles (para usuarios del club desde Firestore).
    const filtered = contacts.filter(c => {
        if (!c || (!c.name && !c.email && !c.phone)) return false;
        const type = c.type || 'staff';
        const roleField = (c.role || '').toLowerCase();
        const name = (c.name || '').toLowerCase();
        const cargo = (c.cargo || '').toLowerCase();
        // allRoles: array de roles del usuario en Firestore
        const allRolesStr = Array.isArray(c.allRoles)
            ? c.allRoles.map(r => (r.role || '').toLowerCase()).join(' ')
            : '';
        // Buscar en role, name, cargo y allRoles
        const searchText = roleField + ' ' + name + ' ' + cargo + ' ' + allRolesStr;
        // Detectar directores (por role, nombre, cargo o allRoles)
        const isDirector = type === 'staff' && (
            roleField === 'director' || allRolesStr.includes('director') ||
            searchText.includes('director') || searchText.includes('deportiv')
        );
        // Detectar coordinadores
        const isCoordinator = type === 'staff' && (
            roleField === 'coordinator' || allRolesStr.includes('coordinator') ||
            searchText.includes('coordin')
        );
        // Detectar entrenadores (para cuando se busque staff completo)
        const isCoach = type === 'staff' && (
            roleField === 'coach' || roleField === 'user' ||
            allRolesStr.includes('coach') || allRolesStr.includes('user') ||
            searchText.includes('entrenador')
        );
        // FIX (Error #17): detectar padres tambien si tienen 'parent' en allRoles,
        // incluso si su rootRole es 'club_admin' (multi-rol).
        const isParent = type === 'parent' || roleField === 'parent'
            || allRolesStr.includes('parent') || allRolesStr.includes('parent_individual')
            || allRolesStr.includes('padre');
        // Staff generico (sin rol claro) — se incluye si se busca 'todos' o staff
        const isStaffGeneric = type === 'staff' && !isDirector && !isCoordinator && !isCoach;

        if (wantsPadres && isParent) return true;
        if (wantsDirectores && isDirector) return true;
        if (wantsCoordinadores && isCoordinator) return true;
        // Si se busca 'todos' o cualquier combinacion que incluya staff,
        // incluir tambien el staff generico y entrenadores
        if ((role === 'todos' || role === 'directores_coordinadores') && (isStaffGeneric || isCoach)) return true;
        return false;
    });
    // FIX (Error #14/17): si el filtro devuelve 0 pero hay usuarios del club,
    // mostrar TODOS los del club como fallback. Si se busca padres, incluir
    // tambien a los que tienen 'parent' en allRoles (multi-rol).
    if (filtered.length === 0 && clubUsers.length > 0) {
        console.warn('[_cronosOpenRecipientPicker] filtro devolvio 0 - mostrando TODOS los usuarios del club como fallback');
        if (wantsPadres && !wantsDirectores && !wantsCoordinadores) {
            // Solo padres: incluir type=parent O allRoles con parent
            clubUsers.forEach(u => {
                const ar = Array.isArray(u.allRoles) ? u.allRoles.map(r => (r.role||'').toLowerCase()).join(' ') : '';
                if (u.type === 'parent' || ar.includes('parent') || ar.includes('padre')) {
                    filtered.push(u);
                }
            });
            // Si sigue vacio, mostrar todos (ultimo recurso)
            if (filtered.length === 0) clubUsers.forEach(u => filtered.push(u));
        } else if (wantsDirectores || wantsCoordinadores) {
            // Staff (cualquiera)
            clubUsers.forEach(u => { if (u.type === 'staff') filtered.push(u); });
        } else {
            // Todos
            clubUsers.forEach(u => filtered.push(u));
        }
    }
    console.log('[_cronosOpenRecipientPicker] filtered despues de fallback:', filtered.length);

    const roleLabel = role === 'directores' ? 'Directores Deportivos'
        : role === 'coordinadores' ? 'Coordinadores'
        : role === 'padres' ? 'Padres/Tutores'
        : role === 'directores_coordinadores' ? 'Directores + Coordinadores'
        : role === 'directores_padres' ? 'Directores + Padres'
        : role === 'coordinadores_padres' ? 'Coordinadores + Padres'
        : role === 'todos' ? 'Directores + Coordinadores + Padres'
        : 'Destinatarios';

    const isConv = context === 'convocatoria';
    const sendFunction = isConv ? 'publishConvocationToAppV2' : '_sendTrainingNotificationV2';
    const sendLabel = isConv ? '📨 Enviar Convocatoria' : '📨 Enviar Entrenamiento';

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';

    const listHTML = filtered.length
        ? filtered.map(c => {
            const id = c.id || ('c_' + Math.random().toString(36).substr(2,5));
            // FIX (Error #15): mostrar nombre real (no email) + rol + email
            const realName = c.name || c.email || 'Contacto';
            // Detectar rol para mostrarlo como etiqueta
            const allRolesStr = Array.isArray(c.allRoles)
                ? c.allRoles.map(r => r.role || '').filter(Boolean)
                : [];
            let roleLabel = c.cargo || c.role || '';
            if (!roleLabel && allRolesStr.length) {
                // Si tiene varios roles, mostrar el que coincide con el seleccionado
                const wantsDir = role.includes('directores');
                const wantsCoord = role.includes('coordinadores');
                if (wantsDir && allRolesStr.includes('director')) roleLabel = 'director';
                else if (wantsCoord && allRolesStr.includes('coordinator')) roleLabel = 'coordinator';
                else roleLabel = allRolesStr[0];
            }
            const roleDisplay = roleLabel
                ? (roleLabel === 'director' ? 'Director Deportivo'
                : roleLabel === 'coordinator' ? 'Coordinador'
                : roleLabel === 'coach' || roleLabel === 'user' ? 'Entrenador'
                : roleLabel === 'parent' ? 'Padre/Tutor'
                : roleLabel === 'club_admin' ? 'Admin Club'
                : roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1))
                : '';
            const sub = [c.email, c.phone].filter(Boolean).join(' · ');
            const typeIcon = c.type === 'parent' ? '👨‍👩‍👧'
                : roleLabel === 'director' ? '📋'
                : roleLabel === 'coordinator' ? '🎯'
                : roleLabel === 'coach' || roleLabel === 'user' ? '🏃'
                : '🏢';
            return `
            <label style="display:flex;align-items:center;gap:0.7rem;padding:0.7rem 0.8rem;
                           background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
                           border-radius:8px;cursor:pointer;">
                <input type="checkbox" class="cronos-pick-chk" data-id="${id}"
                    data-uid="${c.uid||''}" data-email="${c.email||''}" data-phone="${c.phone||''}"
                    data-label="${(realName||'').replace(/"/g,'&quot;')}"
                    data-role="${roleLabel}"
                    data-target-role="${roleLabel}"
                    checked style="width:18px;height:18px;accent-color:var(--primary);flex-shrink:0;">
                <span style="font-size:1.1rem;">${typeIcon}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.85rem;font-weight:600;color:var(--text);">${realName}</div>
                    ${roleDisplay ? `<div style="font-size:0.68rem;color:#58a6ff;font-weight:600;margin-top:1px;">${roleDisplay}</div>` : ''}
                    ${sub ? `<div style="font-size:0.68rem;color:var(--text-muted);margin-top:1px;">${sub}</div>` : ''}
                </div>
            </label>`;
        }).join('')
        : `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.85rem;">
            ⚠️ No hay contactos de tipo "${roleLabel}" configurados.<br><br>
            Ve a <strong>Gestión de Contactos</strong> y añade contactos con el rol correcto.
           </div>`;

    modal.innerHTML = `
    <div class="modal-content" style="width:min(94vw,500px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <div style="padding:1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <div>
                <h3 style="margin:0;font-size:1.05rem;">✓ ${roleLabel}</h3>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">
                    Marca quién recibirá el ${isConv?'convocatoria':'entrenamiento'}
                </div>
            </div>
            <button onclick="_cronosOpenRoleSelector('${context}')"
                style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <div style="padding:1rem 1.2rem;overflow-y:auto;flex:1;">
            <div style="display:flex;gap:0.4rem;margin-bottom:0.8rem;">
                <button onclick="(function(){document.querySelectorAll('.cronos-pick-chk').forEach(c=>c.checked=true);})()"
                    style="flex:1;font-size:0.72rem;padding:0.4rem;background:rgba(88,166,255,0.1);
                           border:1px solid rgba(88,166,255,0.3);border-radius:6px;color:var(--primary);cursor:pointer;">
                    ✓ Todos</button>
                <button onclick="(function(){document.querySelectorAll('.cronos-pick-chk').forEach(c=>c.checked=false);})()"
                    style="flex:1;font-size:0.72rem;padding:0.4rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-muted);cursor:pointer;">
                    ✗ Ninguno</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:0.4rem;">
                ${listHTML}
            </div>
        </div>

        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);
                    display:flex;gap:0.5rem;flex-shrink:0;">
            <button onclick="_cronosOpenRoleSelector('${context}')" class="btn"
                style="color:var(--text-muted);">← Volver</button>
            <button onclick="${sendFunction}()"
                class="btn" ${filtered.length === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed;flex:1;"' : 'style="background:rgba(63,185,80,0.15);border-color:rgba(63,185,80,0.4);color:#3fb950;font-weight:700;flex:1;"'}
                >${sendLabel}</button>
        </div>
    </div>`;
};

function openConvocationMessage(target) {
    // FIX: usar _savedConvokedPlayers + pre-cargar caché de contactos
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}');
    const mode   = document.getElementById('setup-mode')?.value || 'f11';
    const myPlayers = roster[mode] || [];

    let selectedPlayers = window._savedConvokedPlayers || [];
    if (!selectedPlayers.length) {
        const rows = document.querySelectorAll('.conv-row.conv-selected');
        selectedPlayers = Array.from(rows).map(r => myPlayers[r.dataset.index]).filter(Boolean);
    }
    if (selectedPlayers.length) window._savedConvokedPlayers = selectedPlayers;

    // Pre-cargar caché de contactos (para que la lista no quede en blanco)
    if (typeof window._cronos_getContactsByFlag === 'function') {
        window._cronos_getContactsByFlag('cv').then(() => {
            const listEl = document.getElementById('cv-recipients-list');
            if (listEl && (listEl.innerHTML.includes('⏳') || !listEl.innerHTML.trim())) {
                const saved = JSON.parse(localStorage.getItem('cronos_cv_preselection') || 'null');
                listEl.innerHTML = window.sharedBuildRecipientsHTML(saved, 'cv');
            }
        }).catch(() => {});
    }

    const maxSlots = mode === 'f7' ? 14 : 18;

    // Saved convocation config
    const saved = JSON.parse(localStorage.getItem('cronos_conv_config') || '{}');

    // Greeting based on current time
    const hour = new Date().getHours();
    const defaultGreeting = hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';

    // Título dinámico según target (v76: antes en convocation.js)
    let title;
    if (target === 'parents')      title = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Enviar Convocatoria a Padres';
    else if (target === 'coordinators') title = '\u{1F3AF} Enviar Convocatoria a Coordinadores';
    else if (target === 'directors')    title = '\u{1F4CB} Enviar Convocatoria a Directores';
    else                                 title = '\u{1F4F2} Enviar Convocatoria';

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,680px);max-height:94vh;
             display:flex;flex-direction:column;overflow:hidden;">

            <!-- Header -->
            <div style="display:flex;justify-content:space-between;align-items:center;
                        margin-bottom:0.8rem;flex-shrink:0;">
                <h2 style="margin:0;font-size:1.1rem;">${title}</h2>
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
                    ${typeof sharedBuildRecipientsHTML==='function'?sharedBuildRecipientsHTML(saved.recipients, 'cv'):'<div style="color:var(--text-muted);text-align:center;padding:1rem;">Cargando contactos…</div>'}
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
                <button onclick="_cronosOpenRoleSelector('convocatoria')" class="btn"
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
    // Recopilar todos los contactos disponibles
    const allContacts = [];

    // 1. Staff / directivos desde emailConfig
    const staffContacts = (emailConfig.contacts || []).filter(c => c.type !== 'parent');
    staffContacts.forEach(c => {
        if (!c.name && !c.email && !c.phone) return;
        allContacts.push({
            id:     c.id || ('s_' + Math.random().toString(36).substr(2,5)),
            type:   'staff',
            uid:    c.uid || '',
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
            uid:    c.uid || '',
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

    // Cargar preselección guardada
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
                data-uid="${typeof escapeAttr==='function'?escapeAttr(c.uid||''):c.uid||''}"
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

// ── Obtener contactos por flag (para envío interno) ──────────────────
window._cronos_getContactsByFlag = async function(flag) {
    const contacts = (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts))
        ? emailConfig.contacts : [];
    return contacts.filter(c => (c.tags || []).includes(flag));
};

// ── Obtener destinatarios seleccionados (Compartido) ─────────────────
window.sharedGetSelectedRecipients = function(prefix = 'cv') {
    return Array.from(document.querySelectorAll(`.${prefix}-recipient-chk:checked`)).map(chk => ({
        id:    chk.dataset.id,
        uid:   chk.dataset.uid || '',
        type:  chk.dataset.type,
        phone: chk.dataset.phone,
        email: chk.dataset.email,
        label: chk.dataset.label,
        playerId: chk.dataset.playerid,
        playerNumber: chk.dataset.playernumber,
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

    msg += `_Chronos Fútbol_ ⚽`;
    return msg;
}

// ── Guardar configuración ───────────────────────────────────────────
function saveConvConfig() {
    const selectedIds = Array.from(document.querySelectorAll('.cv-recipient-chk:checked')).map(c => c.dataset.id);
    const cfg = {
        greeting:   document.getElementById('cv-greeting')?.value,
        type:       document.getElementById('cv-type')?.value,
        date:       document.getElementById('cv-date')?.value,
        rival:      document.getElementById('cv-rival')?.value,
        meettime:   document.getElementById('cv-meettime')?.value,
        kickoff:    document.getElementById('cv-kickoff')?.value,
        venue:      document.getElementById('cv-venue')?.value,
        extra:      document.getElementById('cv-extra')?.value,
        recipients: selectedIds,
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
${(typeof escapeHtml==='function'?escapeHtml(msg):msg.replace(/</g,'&lt;').replace(/>/g,'&gt;')).replace(/\*(.*?)\*/g,'<strong>$1</strong>')}
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

    } catch(e) {
        console.warn('saveConvocationToFirestore:', e.message);
    }
}

// ── Enviar por WhatsApp ─────────────────────────────────────────────
function sendConvocationWA() {
    saveConvConfig();
    const recipients = sharedGetSelectedRecipients('cv').filter(r => r.phone);
    const msg = buildConvocationText();
    const encoded = encodeURIComponent(msg);

    if (!recipients.length) {
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
        showToast('📱 WhatsApp abierto — ningún contacto con teléfono seleccionado', 4000);
        return;
    }

    recipients.forEach((r, i) => {
        setTimeout(() => {
            window.open(`https://wa.me/${r.phone}?text=${encoded}`, '_blank');
        }, i * 800);
    });
    saveConvocationToFirestore();
    showToast(`📱 Enviando a ${recipients.length} contacto${recipients.length > 1 ? 's' : ''} por WhatsApp`, 4000);
    setTimeout(() => openConvocationModal(), 1500);
}

// ── Enviar por Email ────────────────────────────────────────────────
function sendConvocationEmail() {
    saveConvConfig();
    const recipients = sharedGetSelectedRecipients('cv').filter(r => r.email);
    const rival   = document.getElementById('cv-rival')?.value.trim() || '';
    const dateVal = document.getElementById('cv-date')?.value || '';
    const dateStr = dateVal
        ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long'})
        : '';
    const subject = encodeURIComponent(
        `⚽ Convocatoria ${dateStr ? '— ' + dateStr : ''}${rival ? ' vs ' + rival : ''}`
    );
    const body = encodeURIComponent(buildConvocationText().replace(/[*_]/g,''));

    if (!recipients.length) {
        window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
        showToast('📧 Email abierto — ningún contacto con email seleccionado', 3000);
        return;
    }

    const toList = recipients.map(r => r.email).join(',');
    window.open(`mailto:${toList}?subject=${subject}&body=${body}`, '_blank');
    saveConvocationToFirestore();
    showToast(`📧 Email abierto para ${recipients.length} contacto${recipients.length > 1 ? 's' : ''}`, 3000);
    setTimeout(() => openConvocationModal(), 1000);
}

// ════════════════════════════════════════════════════════════════════
// FIX (Error #15b - raíz): resolución compartida de jugadores convocados.
// Lógica única usada por publishConvocationToApp y publishConvocationToAppV2
// para que no vuelvan a desincronizarse. Orden de fuentes:
//   1. window._savedConvokedPlayers (fuente de verdad) → mapear
//      number/dorsal/num + alias/name/surname/... con fallback a claves genéricas.
//   2. DOM .conv-player-name (cuando el formulario sigue montado).
//   3. localStorage cronos_last_conv.players (última convocatoria guardada).
// Devuelve siempre un array de strings no vacíos.
// ════════════════════════════════════════════════════════════════════
function _cronosResolvePlayersArr() {
    let playersArr = [];

    // 1) Fuente de verdad: _savedConvokedPlayers
    if (window._savedConvokedPlayers && window._savedConvokedPlayers.length) {
        console.log('[_cronosResolvePlayersArr] primer jugador raw:', JSON.stringify(window._savedConvokedPlayers[0]));
        playersArr = window._savedConvokedPlayers.map(p => {
            // Intentar TODOS los campos posibles del roster
            const num = p.number || p.dorsal || p.num || '';
            const alias = p.alias || p.name || p.surname || p.playerName || p.displayName || '';
            let label;
            if (num && alias) label = num + '. ' + alias;
            else if (alias) label = alias;
            else if (num) label = String(num);
            else label = '';
            return label.trim();
        }).filter(s => s.length > 0);
        console.log('[_cronosResolvePlayersArr] jugadores desde _savedConvokedPlayers:', playersArr.length, playersArr);
        // Si el mapeo dio 0 pero había elementos, usar cualquier clave con texto
        if (!playersArr.length && window._savedConvokedPlayers.length) {
            playersArr = window._savedConvokedPlayers.map((p, i) => {
                const keys = Object.keys(p);
                console.log('[_cronosResolvePlayersArr] jugador ' + i + ' keys:', keys);
                for (const k of ['alias', 'name', 'surname', 'playerName', 'displayName', 'number', 'dorsal']) {
                    if (p[k] && String(p[k]).trim()) return String(p[k]).trim();
                }
                return 'Jugador ' + (i + 1);
            });
            console.log('[_cronosResolvePlayersArr] jugadores (fallback keys):', playersArr.length, playersArr);
        }
    }

    // 2) Fallback: leer del DOM (.conv-player-name)
    if (!playersArr.length) {
        playersArr = Array.from(document.querySelectorAll('.conv-player-name'))
            .map(el => el.value.trim()).filter(Boolean);
        console.log('[_cronosResolvePlayersArr] jugadores desde DOM (fallback):', playersArr.length);
    }

    // 3) Fallback: leer de localStorage (cronos_last_conv)
    if (!playersArr.length) {
        try {
            const lastConv = JSON.parse(localStorage.getItem('cronos_last_conv') || '{}');
            if (lastConv.players && Array.isArray(lastConv.players)) {
                playersArr = lastConv.players.filter(Boolean);
                console.log('[_cronosResolvePlayersArr] jugadores desde localStorage:', playersArr.length);
            }
        } catch(e) {}
    }

    return playersArr;
}
window._cronosResolvePlayersArr = _cronosResolvePlayersArr;

// ════════════════════════════════════════════════════════════════════
// RENDER COMPARTIDO — PLANIFICACIÓN SEMANAL (tarjetas horizontales)
// ════════════════════════════════════════════════════════════════════
// Fuente ÚNICA del layout del aviso de entrenamiento para que todas las
// vistas (coordinador/director en club-reports.js y padres en parent/
// panel.js) usen exactamente el mismo HTML/CSS y no se desincronicen —
// mismo patrón que _cronosResolvePlayersArr.
//
// `days` = array de { day, time, venue, note } (ver notifPayload en
// coach/comms/panel.js). `note` ya incluye tipo · duración · equipación.
// `opts.hint` (por defecto true) muestra la pista de scroll lateral.
// Devuelve el HTML de la pista + el contenedor con scroll horizontal y una
// tarjeta por día (badge 🏃 ENTRENO / ⚽ PARTIDO, hora, lugar y nota).
// ════════════════════════════════════════════════════════════════════
function _cronosRenderTrainingWeekCards(days, opts) {
    opts = opts || {};
    const esc = (v) => typeof escapeHtml === 'function'
        ? escapeHtml(v == null ? '' : String(v))
        : (v == null ? '' : String(v));

    // FIX (Error #19): parsear el campo 'note' que viene concatenado con '·'
    // y separarlo en lineas independientes: tipo, duracion, equipaciones.
    // Cada dato va en su propia linea, con su icono, claro y ordenado.
    const parseNoteFields = (note) => {
        // El note se construye como: "Tipo · ⏱️ 90 MIN · 👕 ENTRENAMIENTOS"
        // (ver _buildWeekDays en comms/panel.js)
        const fields = { tipo: '', duracion: '', equipaciones: '', extra: '' };
        if (!note) return fields;
        const parts = note.split('·').map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
            const lower = p.toLowerCase();
            // Quitar iconos para clasificar
            const clean = p.replace(/^[^a-zA-Z0-9\s]+\s*/, '').trim();
            if (lower.includes('⏱') || lower.includes('min') || /^\d+\s*min/.test(clean.toLowerCase())) {
                fields.duracion = p;
            } else if (lower.includes('👕') || lower.includes('equipac')) {
                fields.equipaciones = clean;
            } else if (lower.includes('partido') || lower.includes('entrenamiento') || lower.includes('amistoso') || lower.includes('liga') || lower.includes('copa') || lower.includes('torneo')) {
                fields.tipo = clean;
            } else {
                // Si no encaja en nada, guardarlo como extra
                if (fields.extra) fields.extra += ' · ' + p;
                else fields.extra = p;
            }
        }
        return fields;
    };

    const isMatchDay = (note, tipo) => {
        const s = ((note || '') + ' ' + (tipo || '')).toLowerCase();
        return s.includes('partido') || s.includes('match');
    };
    const cardsHTML = Array.isArray(days) && days.length
        ? days.map((dy, idx) => {
            const nf = parseNoteFields(dy.note);
            const hasData    = dy.time || dy.venue || dy.note;
            const match      = isMatchDay(dy.note, nf.tipo);
            const cardBg     = match ? 'rgba(63,185,80,0.1)' : 'rgba(255,255,255,0.05)';
            const cardBorder = match ? 'rgba(63,185,80,0.4)' : 'rgba(255,255,255,0.12)';
            const dayColor   = match ? '#3fb950' : '#f0883e';
            const dayBadge   = match ? '⚽ PARTIDO' : '🏃 ENTRENO';
            const dayBadgeBg = match ? 'rgba(63,185,80,0.2)' : 'rgba(240,136,62,0.2)';

            // FIX: cada dato en su propia linea, bien separado y ordenado
            const lines = [];
            if (dy.time) {
                lines.push('<div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.06);">'
                    + '<span style="font-size:1rem;flex-shrink:0;">🕐</span>'
                    + '<strong style="font-size:0.88rem;">' + esc(dy.time) + '</strong>'
                    + '</div>');
            }
            if (dy.venue) {
                lines.push('<div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.06);">'
                    + '<span style="font-size:1rem;flex-shrink:0;">📍</span>'
                    + '<span style="line-height:1.35;font-size:0.82rem;">' + esc(dy.venue) + '</span>'
                    + '</div>');
            }
            if (nf.tipo) {
                lines.push('<div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.06);">'
                    + '<span style="font-size:1rem;flex-shrink:0;">📋</span>'
                    + '<span style="font-size:0.82rem;font-weight:600;color:' + dayColor + ';">' + esc(nf.tipo) + '</span>'
                    + '</div>');
            }
            if (nf.duracion) {
                const durClean = nf.duracion.replace(/⏱️?\s*/, '').trim();
                lines.push('<div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.06);">'
                    + '<span style="font-size:1rem;flex-shrink:0;">⏱️</span>'
                    + '<span style="font-size:0.82rem;">' + esc(durClean) + '</span>'
                    + '</div>');
            }
            if (nf.equipaciones) {
                lines.push('<div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.06);">'
                    + '<span style="font-size:1rem;flex-shrink:0;">👕</span>'
                    + '<span style="font-size:0.82rem;">' + esc(nf.equipaciones) + '</span>'
                    + '</div>');
            }
            if (nf.extra) {
                lines.push('<div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.35rem 0;"'
                    + '<span style="font-size:1rem;flex-shrink:0;">📝</span>'
                    + '<span style="font-size:0.78rem;color:var(--text-muted);line-height:1.3;">' + esc(nf.extra) + '</span>'
                    + '</div>');
            }

            return '<div style="flex:0 0 auto;min-width:180px;max-width:220px;background:' + cardBg + ';border:1px solid ' + cardBorder + ';border-radius:12px;padding:0.85rem;display:flex;flex-direction:column;gap:0.3rem;">'
                + '<div style="font-weight:800;color:' + dayColor + ';font-size:0.92rem;border-bottom:2px solid ' + cardBorder + ';padding-bottom:0.5rem;margin-bottom:0.3rem;">' + esc(dy.day || ('Día ' + (idx + 1))) + '</div>'
                + '<div style="font-size:0.62rem;font-weight:700;color:' + dayColor + ';background:' + dayBadgeBg + ';padding:3px 10px;border-radius:4px;align-self:flex-start;letter-spacing:0.5px;margin-bottom:0.3rem;">' + dayBadge + '</div>'
                + (hasData
                    ? '<div style="display:flex;flex-direction:column;">' + lines.join('') + '</div>'
                    : '<div style="font-size:0.82rem;color:#666;font-style:italic;text-align:center;padding:1rem 0;">😴 Descanso</div>')
                + '</div>';
        }).join('')
        : '<div style="color:var(--text-muted);font-size:0.82rem;padding:1rem;text-align:center;">No hay días en esta planificación.</div>';
    const hint = (opts.hint === false)
        ? ''
        : '<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.8rem;display:flex;align-items:center;gap:0.3rem;"><span>👈 Desplaza lateralmente para ver todos los días</span></div>';
    return hint
        + '<div style="display:flex;gap:0.6rem;overflow-x:auto;padding-bottom:0.6rem;-webkit-overflow-scrolling:touch;scrollbar-width:thin;">'
        + cardsHTML
        + '</div>';
}
window._cronosRenderTrainingWeekCards = _cronosRenderTrainingWeekCards;

// ── Publicar convocatoria interna (visible en app padres) ───────────
async function publishConvocationToApp() {
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!me || !fa) return;

    // FIX (Error #15b): leer jugadores de _savedConvokedPlayers PRIMERO,
    // antes de buildConvocationText (que puede fallar si el DOM no existe).
    const sv = window._savedConvData || {};
    const dateVal    = sv.date || '';
    const rival      = sv.rival || '';
    const meettime   = sv.meettime || '';
    const kickoff    = sv.time || '';
    const venue      = sv.venue || '';
    const extra      = sv.type || '';
    // Construir playersArr con la lógica compartida (fuente de verdad → DOM → localStorage)
    const playersArr = _cronosResolvePlayersArr();

    if (!playersArr.length) {
        showToast('⚠️ No hay jugadores convocados. Vuelve y marca jugadores.', 5000);
        console.warn('[publishConvocationToApp] SIN jugadores - abortando');
        return;
    }
    // Ahora safe llamar buildConvocationText (con try/catch)
    let fullText = '';
    try { fullText = buildConvocationText(); } catch(e) { console.warn('[publishConvocationToAppV2] buildConvocationText error:', e.message); }

    showSpinner('Publicando convocatoria interna…');
    saveConvConfig();

    try {
        const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = fa.db;

        const dateStr = dateVal
            ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES', {weekday:'long',day:'numeric',month:'long'})
            : '—';

        const notifPayload = (uid) => ({
            type:       'convocatoria',
            clubId:     me.clubId  || null,
            parentUid:  uid,
            coachUid:   me.uid,
            coachEmail: me.email   || '',
            category:    me.category    || null,
            subcategory: me.subcategory || null,
            matchDate:  dateStr,
            rival, meettime, kickoff, venue, extra,
            players:    playersArr,
            fullText,
            createdAt:  new Date().toISOString(),
        });

        // ── FUENTE DE VERDAD: asegurar que la caché esté cargada antes de enviar ──
        if (typeof window._cronos_getContactsByFlag === 'function') {
            if (!window._cronosContactsCache) {
                await window._cronos_getContactsByFlag('cv');
            }
        }
        const manualSelected = (typeof window.sharedGetSelectedRecipients === 'function')
            ? window.sharedGetSelectedRecipients('cv')
            : [];

        // Unión deduplicada: flags + manual
        const notifiedUids = new Set();
        let count = 0;

        for (const r of manualSelected) {
            const uid = r.uid || r.id;
            if (!uid || notifiedUids.has(uid)) continue;
            notifiedUids.add(uid);
            await setDoc(doc(db, 'cronos_notifications', 'cv_' + uid + '_' + Date.now().toString(36)), notifPayload(uid));
            count++;
        }

        // Guardar última convocatoria para reutilizar
        localStorage.setItem('cronos_last_conv', JSON.stringify({
            date: dateVal, rival, meettime, kickoff, venue, extra,
            recipients: manualSelected.map(r => r.id),
            savedAt: new Date().toISOString(),
        }));

        window._cronos_published_parent_uids = notifiedUids;
        hideSpinner();

        if (count > 0) {
            showToast('✅ Convocatoria enviada a ' + count + ' persona(s) en la app', 5000);
            const btn = document.querySelector('.btn[onclick*="publishConvocationToApp"]');
            if (btn) { btn.innerHTML = '✅ Enviado (' + count + ')'; btn.style.color = '#3fb950'; }
        } else {
            showToast('⚠️ 0 destinatarios — activa las palomillas CONV. en Gestión de Contactos', 7000);
        }
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error: ' + e.message, 5000);
        console.error('[publishConvocationToApp]', e);
    }
}

// ── Exports globales ─────────────────────────────────────────────────
// ── V2: Enviar convocatoria usando el nuevo flujo simplificado ──
window.publishConvocationToAppV2 = async function() {
    console.log('[publishConvocationToAppV2] ====== INICIO ======');
    console.log('[publishConvocationToAppV2] _savedConvokedPlayers:', window._savedConvokedPlayers ? window._savedConvokedPlayers.length : 'UNDEFINED', window._savedConvokedPlayers);
    console.log('[publishConvocationToAppV2] _savedConvData:', window._savedConvData);
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!me || !fa) { console.warn('[publishConvocationToAppV2] no me/fa'); return; }

    // Leer los checkboxes marcados en el picker
    const selected = Array.from(document.querySelectorAll('.cronos-pick-chk:checked')).map(chk => ({
        id: chk.dataset.id,
        uid: chk.dataset.uid || '',
        email: chk.dataset.email || '',
        phone: chk.dataset.phone || '',
        label: chk.dataset.label || '',
        role: chk.dataset.role || '',
        targetRole: chk.dataset.targetRole || chk.dataset.role || ''
    }));

    if (!selected.length) {
        if (typeof showToast === 'function') showToast('⚠️ Selecciona al menos una persona', 3000);
        return;
    }

    // FIX (Error #15b): sincronizado con publishConvocationToApp. Leer datos
    // y jugadores desde _savedConvData / _savedConvokedPlayers (fuente de
    // verdad) PRIMERO. Cuando V2 se ejecuta, el DOM del formulario (cv-date,
    // .conv-player-name) ya fue reemplazado por el picker de destinatarios,
    // así que leer del DOM devuelve vacío.
    const sv = window._savedConvData || {};
    const dateVal    = sv.date     || document.getElementById('cv-date')?.value           || '';
    const rival      = sv.rival    || document.getElementById('cv-rival')?.value.trim()    || '';
    const meettime   = sv.meettime || document.getElementById('cv-meettime')?.value        || '';
    const kickoff    = sv.time     || document.getElementById('cv-kickoff')?.value         || '';
    const venue      = sv.venue    || document.getElementById('cv-venue')?.value.trim()    || '';
    const extra      = sv.type     || document.getElementById('cv-extra')?.value.trim()    || '';

    // Construir playersArr con la lógica compartida (fuente de verdad → DOM → localStorage)
    const playersArr = _cronosResolvePlayersArr();

    if (!playersArr.length) {
        showToast('⚠️ No hay jugadores convocados. Vuelve y marca jugadores.', 5000);
        console.warn('[publishConvocationToAppV2] SIN jugadores - abortando');
        return;
    }

    // Ahora safe llamar buildConvocationText (con try/catch, el DOM puede no existir)
    let fullText = '';
    try { fullText = buildConvocationText(); } catch(e) { console.warn('[publishConvocationToAppV2] buildConvocationText error:', e.message); }

    if (typeof showSpinner === 'function') showSpinner('Enviando convocatoria...');

    try {
        const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = fa.db;

        const dateStr = dateVal
            ? new Date(dateVal + 'T12:00:00').toLocaleDateString('es-ES', {weekday:'long',day:'numeric',month:'long'})
            : '—';

        const _resolveRole = (r) => {
            // FIX (Error #15): usar el data-target-role del checkbox (que coincide
            // con el rol seleccionado en el selector). Así, si un usuario tiene
            // varios roles (director+coordinador+padre), la notificación va
            // SOLO al panel del rol que se seleccionó.
            if (r.targetRole) return r.targetRole;
            const label = (r.label || r.role || '').toLowerCase();
            if (label.includes('director')) return 'director';
            if (label.includes('coordin')) return 'coordinator';
            return 'staff';
        };

        const notifPayload = (uid, role) => ({
            type:       'convocatoria',
            clubId:     me.clubId  || null,
            parentUid:  uid,
            coachUid:   me.uid,
            coachEmail: me.email   || '',
            targetRole: role || null,
            matchDate:  dateStr,
            rival, meettime, kickoff, venue, extra,
            players:    playersArr,
            fullText,
            createdAt:  new Date().toISOString(),
        });

        const notifiedUids = new Set();
        let count = 0;
        const sinUid = [];
        const debugLog = [];

        for (const r of selected) {
            let uid = r.uid;
            if (!uid) {
                sinUid.push(r.label || r.email);
                continue;
            }
            if (notifiedUids.has(uid)) continue;
            notifiedUids.add(uid);
            await setDoc(doc(db, 'cronos_notifications', 'cv_' + uid + '_' + Date.now().toString(36)), notifPayload(uid, _resolveRole(r)));
            count++;
            debugLog.push(`[✓ ${r.label}] enviado a uid=${uid}`);
        }
        console.log('[publishConvocationToAppV2] Debug:', debugLog);

        if (typeof hideSpinner === 'function') hideSpinner();

        if (count > 0) {
            let msg = '✅ Convocatoria enviada a ' + count + ' persona(s)';
            if (sinUid.length > 0) {
                msg += '\n⚠️ No enviado a ' + sinUid.length + ' sin cuenta App: ' + sinUid.slice(0,3).join(', ');
            }
            if (typeof showToast === 'function') showToast(msg, sinUid.length > 0 ? 8000 : 5000);
            // Volver al menu principal
            if (typeof openUnifiedCommsMenu === 'function') openUnifiedCommsMenu();
        } else {
            let msg = '⚠️ 0 destinatarios válidos.';
            if (sinUid.length > 0) {
                msg += ' Sin cuenta App: ' + sinUid.slice(0,3).join(', ') + '. Verifica el email en Gestión de Contactos.';
            }
            if (typeof showToast === 'function') showToast(msg, 8000);
        }
    } catch(e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        console.error('[publishConvocationToAppV2]', e);
        if (typeof showToast === 'function') showToast('⚠️ Error: ' + e.message, 5000);
    }
};

window.openConvocationMessage = openConvocationMessage;
window.publishConvocationToApp = publishConvocationToApp;

// NOTA (v76): convocation.js ha sido eliminado. Toda su funcionalidad
// (openConvocationMessage con target, buildConvocationText, saveConvConfig,
//  previewConvocationMsg, sendConvocationWA, sendConvocationEmail) vive aquí.
// No crear convocation.js de nuevo — este archivo es el módulo canónico.

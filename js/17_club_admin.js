// ════════════════════════════════════════════════════════════════════
//  PANEL ADMIN DE CLUB (club_admin)
// ════════════════════════════════════════════════════════════════════
async function openClubAdminPanel() {
    const me = window._cronosCurrentUser;
    if (!me || me.role !== 'club_admin') { showToast('⛔ Sin permisos', 3000); return; }
    const { db, doc, getDoc, collection, getDocs, query, where, setDoc, updateDoc } = await saFS();
    const clubId = me.clubId;
    if (!clubId) { showToast('⚠️ Sin club asignado', 3000); return; }

    const [clubSnap, usersSnap] = await Promise.all([
        getDoc(doc(db,'clubs',clubId)),
        getDocs(query(collection(db,'users'), where('clubId','==',clubId)))
    ]);
    if (!clubSnap.exists()) { showToast('⚠️ Club no encontrado', 3000); return; }
    const club  = clubSnap.data();
    if (club.status==='blocked') {
        showToast('🔒 Club suspendido. Contacta con el administrador de la plataforma.', 6000); return;
    }
    const users = [];
    usersSnap.forEach(d => users.push({ _id: d.id, ...d.data() }));
    const features = club.features || {};

    const slotOf = (role) => {
        const max  = role==='director'?(club.slots?.directors??-1)
                   : role==='coordinator'?(club.slots?.coordinators??-1)
                   : role==='parent'?(club.slots?.parents??-1)
                   : (club.slots?.users??-1);
        const used = users.filter(u=>u.role===role&&u.isAuthorized!==false).length;
        return { max, used, full: max!==-1 && used>=max, unlimited: max===-1 };
    };

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = SA_CSS + `
    <div class="modal-content sa-modal">
      <div class="sa-topbar">
        <div>
          <div style="font-size:1.15rem;font-weight:700;">🏟️ ${club.name}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">
              Panel del Administrador del Club</div>
        </div>
        <button onclick="document.getElementById('setup-modal').style.display='none'"
            style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
      </div>
      <div class="sa-body">
        <!-- Slots resumen -->
        <div class="sa-stats" style="margin-bottom:1.2rem;">
            ${['director','coordinator','user','parent'].map(role => {
                const si = slotOf(role);
                const label = role==='director'?'Directores':role==='coordinator'?'Coordinadores':role==='parent'?'Padres':'Entrenadores';
                return `<div class="sa-stat">
                    <div class="sa-stat-n" style="color:${si.full?'#ff5858':'#3fb950'};">
                        ${si.used}${si.unlimited?'':'/' + si.max}</div>
                    <div class="sa-stat-l">${label}${si.unlimited?' ∞':''}</div>
                    ${si.full?'<div style="font-size:0.65rem;color:#ff5858;">Límite</div>':''}
                </div>`;
            }).join('')}
        </div>

        <!-- Alta nueva usuario -->
        <div class="sa-card" style="border-color:rgba(88,166,255,0.25);margin-bottom:1.2rem;">
            <div style="font-weight:700;color:var(--primary);margin-bottom:0.7rem;font-size:0.9rem;">
                ➕ Dar de alta usuario</div>
            <div class="sa-g4" style="align-items:end;">
                <div><label class="sa-label">Email *</label>
                    <input class="sa-input" id="nu-email" type="email" placeholder="usuario@email.com"></div>
                <div><label class="sa-label">Nombre</label>
                    <input class="sa-input" id="nu-name" placeholder="Nombre completo"></div>
                <div><label class="sa-label">Rol</label>
                    <select class="sa-input" id="nu-role" onchange="caRoleChanged()">
                        <option value="user">⚽ Entrenador</option>
                        <option value="parent">👨‍👩‍👧 Padre/Madre</option>
                        ${features.live_view?'<option value="coordinator">🎯 Coordinador</option>':''}
                        ${features.live_view?'<option value="director">📋 Director Dep.</option>':''}
                    </select></div>
                <button onclick="caAddUser('${clubId}')" class="sa-btn"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.4);
                           background:rgba(88,166,255,0.1);font-weight:700;height:34px;">
                    ➕ Alta</button>
            </div>
            <!-- Campos extra para Padre/Madre -->
            <div id="nu-parent-fields" style="display:none;margin-top:0.6rem;">
                <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.4rem;
                            padding:0.4rem 0.6rem;background:rgba(210,168,255,0.08);
                            border:1px solid rgba(210,168,255,0.2);border-radius:6px;">
                    👨‍👩‍👧 Datos adicionales para Padre/Tutor — vincula al jugador de su hijo/a
                </div>
                <div class="sa-g4" style="margin-top:0.4rem;">
                    <div><label class="sa-label">Nº Dorsal del jugador *</label>
                        <input class="sa-input" id="nu-player-num" type="number"
                               placeholder="ej: 7" min="1" max="99"></div>
                    <div><label class="sa-label">Alias / Nombre del jugador</label>
                        <input class="sa-input" id="nu-player-alias" placeholder="ej: García"></div>
                    <div><label class="sa-label">WhatsApp del padre (sin +)</label>
                        <input class="sa-input" id="nu-parent-wa" type="tel"
                               placeholder="ej: 34612345678"></div>
                    <div id="generated-invite-container" style="display:none; flex-direction:column; justify-content:center;">
                        <label class="sa-label" style="color:#ffd700;">Código de Invitación</label>
                        <div id="nu-invite-code-display" style="font-family:monospace; font-weight:bold; color:#ffd700; font-size:1.1rem; letter-spacing:2px;"></div>
                    </div>
                </div>
            </div>
            <div id="nu-msg" style="font-size:0.78rem;margin-top:0.4rem;min-height:1rem;"></div>
        </div>

        <!-- Lista usuarios por grupo -->
        ${['director','coordinator','user','parent'].map(role => {
            const roleUsers = users.filter(u => u.role===role);
            if (!roleUsers.length) return '';
            const labels = {director:'📋 DIRECTORES DEPORTIVOS', coordinator:'🎯 COORDINADORES', user:'⚽ ENTRENADORES', parent:'👨‍👩‍👧 PADRES/MADRES'};
            const cols   = {director:'#f0883e', coordinator:'#d2a8ff', user:'#3fb950', parent:'#d2a8ff'};
            return `<div style="margin-bottom:1rem;">
                <div style="font-size:0.76rem;font-weight:700;color:${cols[role]};margin-bottom:0.4rem;">
                    ${labels[role]} (${roleUsers.length})</div>
                ${roleUsers.map(u => `
                <div class="sa-urow">
                    <div>
                        <span style="font-size:0.83rem;">${u.email||u._id}</span>
                        ${u.displayName?`<span style="color:var(--text-muted);font-size:0.74rem;"> · ${u.displayName}</span>`:''}
                        ${!u.isAuthorized?'<span class="sa-badge" style="margin-left:0.3rem;background:#ff585822;color:#ff5858;">🔒</span>':''}
                    </div>
                    <button class="sa-btn" onclick="caRequestDeletion('${u._id}','${u.email||u._id}','${clubId}')"
                        style="font-size:0.72rem;color:#ffa500;border-color:rgba(255,165,0,0.3);background:rgba(255,165,0,0.07);">
                        📋 Baja</button>
                </div>`).join('')}
            </div>`;
        }).join('')}
      </div>
    </div>`;

    window.caRoleChanged = () => {
        const role = document.getElementById('nu-role')?.value;
        const fields = document.getElementById('nu-parent-fields');
        if (fields) fields.style.display = role === 'parent' ? 'block' : 'none';
    };

    window.caAddUser = async (cid) => {
        const email  = document.getElementById('nu-email').value.trim();
        const name   = document.getElementById('nu-name').value.trim();
        const role   = document.getElementById('nu-role').value;
        const msgEl  = document.getElementById('nu-msg');
        if (!email) { msgEl.style.color='#ff5858'; msgEl.textContent='⚠️ Email obligatorio.'; return; }

        // Validación extra para padres
        if (role === 'parent') {
            const pNum = document.getElementById('nu-player-num')?.value?.trim();
            if (!pNum) {
                msgEl.style.color='#ff5858';
                msgEl.textContent='⚠️ El número de dorsal del jugador es obligatorio para Padre/Tutor.';
                return;
            }
        }

        const si = slotOf(role);
        if (si.full) {
            msgEl.style.color='#ff5858';
            msgEl.textContent=`⛔ Límite alcanzado. Solicita al SuperAdmin ampliar el plan.`; return;
        }
        msgEl.style.color='var(--primary)'; msgEl.textContent='Registrando…';
        const uid = 'pre_'+Date.now().toString(36);
        await setDoc(doc(db,'users',uid), {
            email, displayName:name, role, clubId:cid, clubName:club.name||'',
            isAuthorized:true, status:'pending_register',
            createdBy:me.uid, createdAt:new Date().toISOString()
        });
        const key = role==='director'?'usedSlots.directors':role==='coordinator'?'usedSlots.coordinators':role==='parent'?'usedSlots.parents':'usedSlots.users';
        await updateDoc(doc(db,'clubs',cid), { [key]: si.used+1 });

        // Si es padre, guardar el vínculo con el jugador y generar código
        if (role === 'parent') {
            const pNum   = document.getElementById('nu-player-num')?.value?.trim() || '';
            const pAlias = document.getElementById('nu-player-alias')?.value?.trim() || '';
            const pWA    = document.getElementById('nu-parent-wa')?.value?.trim() || '';
            
            // Generar código aleatorio de 6 caracteres
            const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            
            const linkId = `${cid}_${pNum}`;
            await setDoc(doc(db, 'cronos_player_links', linkId), {
                clubId:      cid,
                playerNumber: pNum,
                playerAlias:  pAlias,
                playerName:   pAlias,
                teamName:     club.name || '',
                parentUid:    uid,
                parentEmail:  email,
                parentWA:     pWA,
                inviteCode:   inviteCode,
                coachUid:     '',        
                coachEmail:   '',
                linkedAt:     new Date().toISOString(),
            });

            // Mostrar el código
            const codeDisplay = document.getElementById('nu-invite-code-display');
            const codeContainer = document.getElementById('generated-invite-container');
            if (codeDisplay && codeContainer) {
                codeDisplay.textContent = inviteCode;
                codeContainer.style.display = 'flex';
            }

            if (document.getElementById('nu-player-num'))   document.getElementById('nu-player-num').value = '';
            if (document.getElementById('nu-player-alias'))  document.getElementById('nu-player-alias').value = '';
            if (document.getElementById('nu-parent-wa'))    document.getElementById('nu-parent-wa').value = '';
        }

        msgEl.style.color='#3fb950';
        msgEl.textContent=`✅ ${email} dado de alta. Debe registrarse con ese email.`;
        document.getElementById('nu-email').value='';
        document.getElementById('nu-name').value='';
        setTimeout(() => openClubAdminPanel(), 1800);
    };

    window.caRequestDeletion = async (userId, userEmail, cid) => {
        const reason = prompt(`Motivo de solicitud de baja para ${userEmail}:`);
        if (!reason?.trim()) return;
        await setDoc(doc(db,'deletion_requests',`${userId}_${Date.now()}`), {
            userId, userEmail, clubId:cid,
            requestedBy:me.uid, requestedByEmail:me.email,
            reason:reason.trim(), status:'pending',
            createdAt:new Date().toISOString()
        });
        showToast('📋 Solicitud enviada al SuperAdmin. Pendiente de aprobación.', 5000);
    };
}
window.openClubAdminPanel = openClubAdminPanel;

// ── Verificar acceso al club al iniciar sesión ───────────────────────
async function checkClubAccess(userData) {
    if (!userData?.clubId) return true;
    try {
        const cl = await saGet('clubs', userData.clubId);
        if (!cl) return true;
        if (cl.status === 'blocked') {
            const { signOut } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
            await signOut(window._cronos_auth?.auth);
            showToast('🔒 Club suspendido. Contacta con el administrador.', 8000);
            return false;
        }
        if (cl.expiresAt && new Date(cl.expiresAt) < new Date() && cl.status !== 'blocked') {
            showToast('⚠️ El plan de tu club ha vencido. Contacta con el administrador.', 6000);
        }
    } catch(e) { /* no bloquear */ }
    return true;
}
window.checkClubAccess = checkClubAccess;


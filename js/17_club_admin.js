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
            ${['director','coordinator','user'].map(role => {
                const si = slotOf(role);
                const label = role==='director'?'Directores':role==='coordinator'?'Coordinadores':'Entrenadores';
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
                    <select class="sa-input" id="nu-role">
                        <option value="user">⚽ Entrenador</option>
                        ${features.live_view?'<option value="coordinator">🎯 Coordinador</option>':''}
                        ${features.live_view?'<option value="director">📋 Director Dep.</option>':''}
                    </select></div>
                <button onclick="caAddUser('${clubId}')" class="sa-btn"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.4);
                           background:rgba(88,166,255,0.1);font-weight:700;height:34px;">
                    ➕ Alta</button>
            </div>
            <div id="nu-msg" style="font-size:0.78rem;margin-top:0.4rem;min-height:1rem;"></div>
        </div>

        <!-- Lista usuarios por grupo -->
        ${['director','coordinator','user'].map(role => {
            const roleUsers = users.filter(u => u.role===role);
            if (!roleUsers.length) return '';
            const labels = {director:'📋 DIRECTORES DEPORTIVOS', coordinator:'🎯 COORDINADORES', user:'⚽ ENTRENADORES'};
            const cols   = {director:'#f0883e', coordinator:'#d2a8ff', user:'#3fb950'};
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

    window.caAddUser = async (cid) => {
        const email  = document.getElementById('nu-email').value.trim();
        const name   = document.getElementById('nu-name').value.trim();
        const role   = document.getElementById('nu-role').value;
        const msgEl  = document.getElementById('nu-msg');
        if (!email) { msgEl.style.color='#ff5858'; msgEl.textContent='⚠️ Email obligatorio.'; return; }
        const si = slotOf(role);
        if (si.full) {
            msgEl.style.color='#ff5858';
            msgEl.textContent=`⛔ Límite alcanzado. Solicita al SuperAdmin ampliar el plan.`; return;
        }
        msgEl.style.color='var(--primary)'; msgEl.textContent='Registrando…';
        const uid = 'pre_'+Date.now().toString(36);
        await setDoc(doc(db,'users',uid), {
            email, displayName:name, role, clubId:cid,
            isAuthorized:true, status:'pending_register',
            createdBy:me.uid, createdAt:new Date().toISOString()
        });
        const key = role==='director'?'usedSlots.directors':role==='coordinator'?'usedSlots.coordinators':'usedSlots.users';
        await updateDoc(doc(db,'clubs',cid), { [key]: si.used+1 });
        msgEl.style.color='#3fb950';
        msgEl.textContent=`✅ ${email} dado de alta. Debe registrarse con ese email.`;
        document.getElementById('nu-email').value='';
        document.getElementById('nu-name').value='';
        setTimeout(() => openClubAdminPanel(), 1500);
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


// ════════════════════════════════════════════════════════════════════
//  PANEL ENTRENADOR INDIVIDUAL (individual) — v1
//  Gestión de padres/madres/tutores por categoría deportiva
//  Balance de plazas · Solicitudes · Alta/Baja completa
// ════════════════════════════════════════════════════════════════════

// Guardia: SA_CSS puede no estar definido si 16_superadmin.js no cargó aún
if (typeof window.SA_CSS === 'undefined') {
    window.SA_CSS = `<style>
.sa-modal{background:#0d1117!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:16px!important;max-width:860px!important;width:98vw!important;max-height:92vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;font-family:Inter,sans-serif!important;}
.sa-topbar{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.2rem;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;flex-wrap:wrap;gap:0.5rem;}
.sa-body{flex:1;overflow-y:auto;padding:1rem 1.2rem;-webkit-overflow-scrolling:touch;}
.sa-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.8rem;}
.sa-card-head{display:flex;align-items:center;justify-content:space-between;cursor:pointer;gap:0.5rem;user-select:none;}
.sa-card-title{display:flex;align-items:center;gap:0.5rem;font-weight:700;font-size:0.88rem;color:white;}
.sa-card-body{display:none;padding-top:0.7rem;margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.1);}
.sa-card.expanded .sa-card-body{display:block;}
.sa-card.expanded .sa-chevron{transform:rotate(0deg);}
.sa-chevron{display:inline-block;transform:rotate(-90deg);transition:transform 0.2s;font-size:0.65rem;}
.sa-badge{display:inline-flex;align-items:center;padding:0.18rem 0.55rem;border-radius:20px;font-size:0.7rem;font-weight:700;background:rgba(88,166,255,0.12);color:#58a6ff;}
.sa-btn{display:inline-flex;align-items:center;gap:0.3rem;padding:0.32rem 0.65rem;border:1px solid rgba(255,255,255,0.1);border-radius:7px;background:rgba(255,255,255,0.04);color:white;font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap;}
.sa-btn:hover{filter:brightness(1.2);}
.sa-input{width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;outline:none;font-family:Inter,sans-serif;}
.sa-input:focus{border-color:#58a6ff;}
.sa-label{display:block;font-size:0.72rem;color:#8b949e;margin-bottom:0.3rem;font-weight:600;letter-spacing:0.3px;}
.sa-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0.6rem;}
.sa-urow{display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.3rem;border-bottom:1px solid rgba(255,255,255,0.04);}
.sa-urow:last-child{border-bottom:none;}
.sa-g4{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.6rem;align-items:start;}
</style>`;
}
if (typeof window.ROLE_META === 'undefined') {
    window.ROLE_META = {
        superadmin:  { label:'Superadministrador',    icon:'👑', color:'#ffd700' },
        admin:       { label:'Administrador',          icon:'⚙️',  color:'#58a6ff' },
        club_admin:  { label:'Admin de Club',          icon:'🏟️', color:'#58a6ff' },
        director:    { label:'Director Deportivo',     icon:'📋', color:'#f0883e' },
        coordinator: { label:'Coordinador',            icon:'🎯', color:'#d2a8ff' },
        user:        { label:'Entrenador',             icon:'⚽', color:'#3fb950' },
        parent:      { label:'Padre / Madre / Tutor',  icon:'👨‍👩‍👧', color:'#79c0ff' },
        individual:  { label:'Entrenador Individual',  icon:'👤', color:'#79c0ff' },
    };
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTES DE CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════

const IND_CATEGORIES = [
    { id: 'prebenjamin', label: 'Prebenjamín' },
    { id: 'benjamin',    label: 'Benjamín' },
    { id: 'alevin',      label: 'Alevín' },
    { id: 'infantil',    label: 'Infantil' },
    { id: 'cadete',      label: 'Cadete' },
    { id: 'juvenil',     label: 'Juvenil' },
    { id: 'regional',    label: 'Regional' },
];
const IND_SUB_CATS = ['A', 'B', 'C'];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function _indEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s || '') : (s || ''); }
function _indEscA(s) { return typeof escapeAttr === 'function' ? escapeAttr(s || '') : (s || ''); }

// Genera la key de categorySlots a partir de categoría + subcategoría
function _indSlotKey(catId, subCat) {
    return `${catId}_${subCat.toLowerCase()}`;
}

// Obtiene la etiqueta legible de una categoría: "Alevín B"
function _indCatLabel(catId, subCat) {
    const cat = IND_CATEGORIES.find(c => c.id === catId);
    return cat ? `${cat.label} ${subCat}` : `${catId} ${subCat}`;
}

// ═══════════════════════════════════════════════════════════════════
// openIndividualAdminPanel()
// ═══════════════════════════════════════════════════════════════════

async function openIndividualAdminPanel() {
    const me = window._cronosCurrentUser;
    if (!me) {
        if (typeof _saToast === 'function') _saToast('⛔ Usuario no identificado', 3000);
        return;
    }
    const activeRole = me._activeRole || me.role;
    const isSA = me.role === 'superadmin' || me.role === 'admin';

    if (!isSA && activeRole !== 'individual') {
        if (typeof _saToast === 'function') _saToast('⛔ Sin permisos de Entrenador Individual', 3000);
        return;
    }

    // ── Firebase init ─────────────────────────────────────────────
    let _fs;
    try {
        _fs = await saFS();
    } catch (err) {
        const _modal = document.getElementById('setup-modal');
        if (_modal) {
            _modal.style.display = 'flex';
            _modal.innerHTML = `<div style="background:#0d1117;border-radius:12px;padding:2rem;color:white;text-align:center;max-width:400px;margin:auto;">
                <div style="font-size:1.5rem;margin-bottom:1rem;">⚠️</div>
                <p style="color:#ff5858;">Error de conexión: ${_indEsc(err.message)}</p>
                <button onclick="document.getElementById('setup-modal').style.display='none'"
                    style="margin-top:1rem;padding:0.5rem 1.2rem;background:rgba(255,88,88,0.15);
                           border:1px solid rgba(255,88,88,0.4);border-radius:7px;color:#ff5858;cursor:pointer;">
                    Cerrar</button>
            </div>`;
        }
        return;
    }
    const { db, doc, getDoc, collection, getDocs, query, where, setDoc, updateDoc, deleteDoc } = _fs;

    // ── Load individual's user document ───────────────────────────
    const uid = me.uid;
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.exists()) {
        if (typeof _saToast === 'function') _saToast('⚠️ Usuario no encontrado en Firestore', 3000);
        return;
    }
    const userData = userSnap.data();
    const categorySlots = userData.categorySlots || {};

    // ── Load parents under this individual ────────────────────────
    const parentsSnap = await getDocs(query(collection(db, 'users'), where('individualOwnerId', '==', uid)));
    const parents = [];
    parentsSnap.forEach(d => parents.push({ _id: d.id, ...d.data() }));

    // ── Pending requests (parents approved by SA, pending individual confirmation) ─
    const pendingParents = parents.filter(u =>
        u.status === 'pending_club' && u.approvedBySA === true
    );

    // ── Incoming registrations (users registered under this individual, pending forward) ──
    const pendingAutoReg = parents.filter(u =>
        u.status === 'pending' && u.requestedRole !== 'club_admin'
    );

    const totalPending = pendingAutoReg.length + pendingParents.length;

    // ── Helper: slot info for a category+sub ──────────────────────
    const slotOf = (catId, subCat) => {
        const key = _indSlotKey(catId, subCat);
        const max = categorySlots[key] ?? 5;
        const catFilter = catId + '_' + subCat.toLowerCase();
        const used = parents.filter(u =>
            u.role === 'parent' &&
            u.isAuthorized !== false &&
            u.status !== 'removed' &&
            u.status !== 'rejected' &&
            u.category === catFilter
        ).length;
        return { max, used, free: Math.max(0, max - used), full: used >= max };
    };

    // ── Helper: render a parent row ───────────────────────────────
    const parentRow = (u) => {
        const isBlocked = u.status === 'blocked';
        const isRemoved = u.status === 'removed';
        const isActive  = u.isAuthorized && !isBlocked && !isRemoved && u.status === 'active';

        const statusBadge =
            isRemoved ? '<span class="sa-badge" style="margin-left:0.4rem;background:#ff585822;color:#ff5858;">🗑️ Baja</span>'
          : isBlocked ? '<span class="sa-badge" style="margin-left:0.4rem;background:#ffa50022;color:#ffa500;">🔒 Bloqueado</span>'
          : isActive  ? '<span class="sa-badge" style="margin-left:0.4rem;background:rgba(63,185,80,0.12);color:#3fb950;">✅ Activo</span>'
          : '<span class="sa-badge" style="margin-left:0.4rem;background:#ffa50022;color:#ffa500;">⏳ Pendiente</span>';

        const _eA  = (s) => _indEscA(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const euid = _eA(u._id);
        const email = _eA(u.email || u._id);

        const catLabel = u.categoryLabel || _indCatLabel(u.category?.replace(/_[abc]$/, ''), u.category?.slice(-1).toUpperCase()) || '–';

        return `
        <div class="sa-urow" style="opacity:${isRemoved ? '0.45' : '1'};">
            <div style="flex:1;min-width:0;">
                <span style="font-size:0.83rem;font-weight:600;">${_indEsc(u.email || u._id)}</span>
                ${u.displayName ? `<span style="color:var(--text-muted);font-size:0.74rem;"> · ${_indEsc(u.displayName)}</span>` : ''}
                ${statusBadge}
                <div style="font-size:0.68rem;color:#8b949e;margin-top:1px;">
                    ${_indEsc(catLabel)}
                    ${u.playerNumber ? ` · Dorsal #${_indEsc(String(u.playerNumber))}` : ''}
                    ${u.playerAlias ? ` · ${_indEsc(u.playerAlias)}` : ''}
                </div>
            </div>
            <div style="display:flex;gap:0.3rem;flex-shrink:0;align-items:center;">
                ${isActive ? `<button class="sa-btn"
                    onclick="indSetParentStatus('${euid}','${email}','blocked')"
                    style="font-size:0.7rem;color:#ffa500;border-color:rgba(255,165,0,0.35);background:rgba(255,165,0,0.07);">
                    🔒 Bloquear</button>` : ''}
                ${!isActive && !isRemoved ? `<button class="sa-btn"
                    onclick="indSetParentStatus('${euid}','${email}','active')"
                    style="font-size:0.7rem;color:#3fb950;border-color:rgba(63,185,80,0.35);background:rgba(63,185,80,0.08);">
                    ✅ Activar</button>` : ''}
                ${!isRemoved ? `<button class="sa-btn"
                    onclick="indDeleteParent('${euid}','${email}')"
                    style="font-size:0.7rem;color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);">
                    🗑️ Dar de baja</button>` : ''}
            </div>
        </div>`;
    };

    // ── Build Balance de Plazas HTML ──────────────────────────────
    const balanceHTML = IND_CATEGORIES.map(cat => {
        const subRows = IND_SUB_CATS.map(sub => {
            const si = slotOf(cat.id, sub);
            const barPct = si.max > 0 ? Math.min(100, Math.round((si.used / si.max) * 100)) : 0;
            const barColor = si.full ? '#ff5858' : '#3fb950';
            const freeColor = si.free === 0 ? '#ff5858' : '#3fb950';
            return `
            <div style="display:grid;grid-template-columns:60px 1fr 50px 50px 50px;gap:0.3rem;align-items:center;padding:0.3rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.04);">
                <span style="font-size:0.78rem;font-weight:700;color:white;">${sub}</span>
                <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
                    <div style="height:100%;width:${barPct}%;background:${barColor};border-radius:2px;transition:width 0.3s;"></div>
                </div>
                <span style="font-size:0.72rem;font-weight:700;color:#8b949e;text-align:right;">${si.max}</span>
                <span style="font-size:0.72rem;font-weight:700;color:#58a6ff;text-align:right;">${si.used}</span>
                <span style="font-size:0.72rem;font-weight:700;color:${freeColor};text-align:right;">${si.free}</span>
            </div>`;
        }).join('');
        return `
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:0.6rem 0.7rem;margin-bottom:0.5rem;">
            <div style="font-size:0.82rem;font-weight:700;color:#79c0ff;margin-bottom:0.4rem;">${cat.label}</div>
            <div style="display:grid;grid-template-columns:60px 1fr 50px 50px 50px;gap:0.3rem;padding:0 0.4rem 0.2rem;font-size:0.62rem;color:#8b949e;font-weight:600;letter-spacing:0.3px;">
                <span>Equipo</span><span></span><span style="text-align:right;">Total</span><span style="text-align:right;">Ocup.</span><span style="text-align:right;">Libres</span>
            </div>
            ${subRows}
        </div>`;
    }).join('');

    // ── Build Miembros accordion by category ──────────────────────
    const membersSections = IND_CATEGORIES.map(cat => {
        const catParents = parents.filter(u => {
            if (u.status === 'removed' || u.status === 'rejected') return false;
            const uCat = u.category || '';
            return uCat.startsWith(cat.id + '_');
        });
        const totalActive = catParents.filter(u => u.status === 'active' && u.isAuthorized !== false).length;
        const sectionId = `ind-section-${cat.id}`;
        return `
        <div class="sa-card" id="${sectionId}" style="margin-bottom:0.6rem;border-color:rgba(121,192,255,0.2);">
          <div class="sa-card-head" onclick="document.getElementById('${sectionId}').classList.toggle('expanded')">
            <div class="sa-card-title">
              <span class="sa-chevron">▼</span>
              <span style="color:#79c0ff;">👨‍👩‍👧 ${cat.label}</span>
              <span class="sa-badge" style="background:rgba(121,192,255,0.12);color:#79c0ff;">${totalActive}</span>
            </div>
          </div>
          <div class="sa-card-body">
            ${catParents.length
                ? catParents.map(u => parentRow(u)).join('')
                : `<p style="color:var(--text-muted);font-size:0.78rem;margin:0.3rem 0;">Sin padres registrados en ${cat.label}.</p>`
            }
          </div>
        </div>`;
    }).join('');

    // ── Build category select options ─────────────────────────────
    const catOptions = IND_CATEGORIES.flatMap(cat =>
        IND_SUB_CATS.map(sub => {
            const val = _indSlotKey(cat.id, sub);
            return `<option value="${val}">${cat.label} ${sub}</option>`;
        })
    ).join('');

    // ── Render pending count badge ────────────────────────────────
    const pendingBadge = totalPending > 0
        ? ` <span style="background:#ff5858;color:white;border-radius:10px;padding:1px 7px;font-size:0.65rem;font-weight:700;">${totalPending}</span>`
        : '';

    // ── Display name ──────────────────────────────────────────────
    const displayName = userData.displayName
        || [userData.firstName, userData.lastName].filter(Boolean).join(' ')
        || me.email;

    // ── PANEL: full-screen ────────────────────────────────────────
    const oldPanel = document.getElementById('ind-panel');
    if (oldPanel) oldPanel.remove();

    const panel = document.createElement('div');
    panel.id = 'ind-panel';
    panel.style.cssText = 'position:fixed;inset:0;background:#0d1117;z-index:9500;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,sans-serif;';
    panel.innerHTML = `
<div style="background:rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.1);padding:0.85rem 1.2rem;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;flex-wrap:wrap;gap:0.4rem;">
    <div style="display:flex;align-items:center;gap:0.7rem;">
        <span style="font-size:1.4rem;">👤</span>
        <div>
            <div style="font-family:'Outfit',sans-serif;font-size:1rem;color:white;font-weight:700;">Entrenador Individual</div>
            <div style="font-size:0.68rem;color:#8b949e;">${_indEsc(displayName)} · Chronos Fútbol</div>
        </div>
    </div>
    <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
        <button onclick="saGoBackToRoles()"
            style="background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.3);color:#ffd700;padding:0.32rem 0.7rem;border-radius:6px;cursor:pointer;font-size:0.76rem;font-weight:700;">⇄ Cambiar rol</button>
        <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();else if(typeof logoutUser==='function')logoutUser();"
            style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);color:#ff5858;padding:0.32rem 0.7rem;border-radius:6px;cursor:pointer;font-size:0.76rem;font-weight:700;">🚪 SALIR</button>
    </div>
</div>
<div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch;">
    <button id="ind-tab-overview" onclick="indTab('overview')" style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid #79c0ff;color:#79c0ff;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">📊 Panel</button>
    <button id="ind-tab-pending" onclick="indTab('pending')" style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">🔔 Pendientes${pendingBadge}</button>
    <button id="ind-tab-request" onclick="indTab('request')" style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">📩 Solicitar</button>
    <button id="ind-tab-members" onclick="indTab('members')" style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">👥 Miembros</button>
</div>
<div id="ind-body" style="flex:1;overflow-y:auto;padding:1.1rem;-webkit-overflow-scrolling:touch;"></div>`;

    document.body.appendChild(panel);

    // ── Store data globally for tab functions ─────────────────────
    window._indData = {
        uid, userData, categorySlots, parents, pendingParents,
        pendingAutoReg, displayName, me
    };

    indTab('overview');
}

// ═══════════════════════════════════════════════════════════════════
// indTab() — Tab switching
// ═══════════════════════════════════════════════════════════════════

window.indTab = function indTab(tab) {
    ['overview', 'pending', 'request', 'members'].forEach(t => {
        const b = document.getElementById('ind-tab-' + t);
        if (!b) return;
        b.style.borderBottomColor = (t === tab) ? '#79c0ff' : 'transparent';
        b.style.color = (t === tab) ? '#79c0ff' : '#8b949e';
    });

    if (tab === 'overview') indRenderOverview();
    else if (tab === 'pending') indRenderPending();
    else if (tab === 'request') indRenderRequestForm();
    else if (tab === 'members') indRenderMembers();
};

// ═══════════════════════════════════════════════════════════════════
// indRenderOverview() — Balance de Plazas + resumen
// ═══════════════════════════════════════════════════════════════════

window.indRenderOverview = function indRenderOverview() {
    const body = document.getElementById('ind-body');
    if (!body || !window._indData) return;

    const { categorySlots, parents, pendingParents, pendingAutoReg } = window._indData;
    const _eH = _indEsc;

    // ── Summary stats ─────────────────────────────────────────────
    const activeParents = parents.filter(u => u.status === 'active' && u.isAuthorized !== false);
    const blockedParents = parents.filter(u => u.status === 'blocked');

    // Count total slots
    let totalSlots = 0, totalUsed = 0;
    IND_CATEGORIES.forEach(cat => {
        IND_SUB_CATS.forEach(sub => {
            const key = _indSlotKey(cat.id, sub);
            const max = categorySlots[key] ?? 5;
            const catFilter = cat.id + '_' + sub.toLowerCase();
            const used = parents.filter(u =>
                u.role === 'parent' && u.isAuthorized !== false &&
                u.status !== 'removed' && u.status !== 'rejected' &&
                u.category === catFilter
            ).length;
            totalSlots += max;
            totalUsed += used;
        });
    });
    const totalFree = Math.max(0, totalSlots - totalUsed);

    // ── Balance de Plazas table ───────────────────────────────────
    const balanceHTML = IND_CATEGORIES.map(cat => {
        const subRows = IND_SUB_CATS.map(sub => {
            const key = _indSlotKey(cat.id, sub);
            const max = categorySlots[key] ?? 5;
            const catFilter = cat.id + '_' + sub.toLowerCase();
            const used = parents.filter(u =>
                u.role === 'parent' && u.isAuthorized !== false &&
                u.status !== 'removed' && u.status !== 'rejected' &&
                u.category === catFilter
            ).length;
            const free = Math.max(0, max - used);
            const barPct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
            const barColor = used >= max ? '#ff5858' : '#3fb950';
            const freeColor = free === 0 ? '#ff5858' : '#3fb950';
            return `
            <div style="display:grid;grid-template-columns:55px 1fr 45px 45px 45px;gap:0.3rem;align-items:center;padding:0.3rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.04);">
                <span style="font-size:0.78rem;font-weight:700;color:white;">${sub}</span>
                <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
                    <div style="height:100%;width:${barPct}%;background:${barColor};border-radius:2px;transition:width 0.3s;"></div>
                </div>
                <span style="font-size:0.72rem;font-weight:700;color:#8b949e;text-align:right;">${max}</span>
                <span style="font-size:0.72rem;font-weight:700;color:#58a6ff;text-align:right;">${used}</span>
                <span style="font-size:0.72rem;font-weight:700;color:${freeColor};text-align:right;">${free}</span>
            </div>`;
        }).join('');
        return `
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:0.6rem 0.7rem;margin-bottom:0.5rem;">
            <div style="font-size:0.82rem;font-weight:700;color:#79c0ff;margin-bottom:0.4rem;">${cat.label}</div>
            <div style="display:grid;grid-template-columns:55px 1fr 45px 45px 45px;gap:0.3rem;padding:0 0.4rem 0.2rem;font-size:0.6rem;color:#8b949e;font-weight:600;letter-spacing:0.3px;">
                <span>Eq.</span><span></span><span style="text-align:right;">Total</span><span style="text-align:right;">Ocup.</span><span style="text-align:right;">Libres</span>
            </div>
            ${subRows}
        </div>`;
    }).join('');

    body.innerHTML = `
    <!-- Summary cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.6rem;margin-bottom:1.2rem;">
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.7rem;text-align:center;">
            <div style="font-size:1.3rem;font-weight:800;color:#58a6ff;">${activeParents.length}</div>
            <div style="font-size:0.65rem;color:#8b949e;margin-top:0.1rem;">Padres activos</div>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.7rem;text-align:center;">
            <div style="font-size:1.3rem;font-weight:800;color:#ffa500;">${pendingParents.length}</div>
            <div style="font-size:0.65rem;color:#8b949e;margin-top:0.1rem;">Pendientes</div>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.7rem;text-align:center;">
            <div style="font-size:1.3rem;font-weight:800;color:#ff5858;">${blockedParents.length}</div>
            <div style="font-size:0.65rem;color:#8b949e;margin-top:0.1rem;">Bloqueados</div>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.7rem;text-align:center;">
            <div style="font-size:1.3rem;font-weight:800;color:#3fb950;">${totalFree}</div>
            <div style="font-size:0.65rem;color:#8b949e;margin-top:0.1rem;">Plazas libres / ${totalSlots}</div>
        </div>
    </div>

    <!-- Balance de Plazas -->
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:1rem;margin-bottom:1.2rem;">
        <div style="font-size:0.85rem;font-weight:700;color:white;margin-bottom:0.8rem;display:flex;align-items:center;gap:0.5rem;">
            📊 Balance de Plazas — Padres / Madres / Tutores
        </div>
        ${balanceHTML}
    </div>

    <!-- Info box -->
    <div style="background:rgba(121,192,255,0.05);border:1px solid rgba(121,192,255,0.15);border-radius:8px;padding:0.7rem;font-size:0.75rem;color:#8b949e;line-height:1.5;">
        ℹ️ <strong style="color:#79c0ff;">Flujo de registro:</strong><br>
        1️⃣ Un usuario se registra → llega aquí como <strong>"Pendiente"</strong><br>
        2️⃣ Tú solicitas plaza al SuperAdmin → 3️⃣ SA confirma → vuelve aquí como <strong>"Aprobada"</strong><br>
        4️⃣ Tú confirmas el acceso → el usuario queda <strong>registrado automáticamente</strong>.<br>
        También puedes usar <strong>"📩 Solicitar"</strong> para crear solicitudes directas al SuperAdmin.
    </div>`;
};

// ═══════════════════════════════════════════════════════════════════
// indRenderPending() — Parents pending confirmation
// ═══════════════════════════════════════════════════════════════════

window.indRenderPending = function indRenderPending() {
    const body = document.getElementById('ind-body');
    if (!body || !window._indData) return;

    const { pendingParents, pendingAutoReg } = window._indData;
    const _eH = _indEsc;
    const _eA = (s) => _indEscA(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    if (!pendingAutoReg.length && !pendingParents.length) {
        body.innerHTML = `<div style="text-align:center;padding:3rem;color:#8b949e;">
            <div style="font-size:2.5rem;margin-bottom:0.5rem;">✅</div>
            Sin solicitudes pendientes.
        </div>`;
        return;
    }

    let html = '';

    // ── Section 1: Incoming registrations (status='pending') ──
    if (pendingAutoReg.length) {
        html += `
        <div style="background:rgba(255,165,0,0.06);border:1px solid rgba(255,165,0,0.25);border-radius:10px;padding:1rem;margin-bottom:1rem;">
            <h3 style="font-size:0.88rem;color:#ffa500;margin:0 0 0.5rem;display:flex;align-items:center;gap:0.5rem;">
                🔔 Solicitudes de registro recibidas
                <span style="background:rgba(255,165,0,0.15);color:#ffa500;padding:1px 8px;border-radius:10px;font-size:0.7rem;">${pendingAutoReg.length}</span>
            </h3>
            <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.8rem;padding:0.4rem 0.6rem;background:rgba(255,165,0,0.05);border-radius:6px;border:1px solid rgba(255,165,0,0.15);">
                Usuarios que se han registrado bajo tu equipo. Debes solicitar una plaza al SuperAdmin para cada uno.
            </p>
            ${pendingAutoReg.map(u => {
                const role = u.requestedRole || u.role || 'parent';
                const escId = _eA(u._id);
                const escEmail = _eA(u.email || u._id);
                const catBadge = u.category
                    ? `<span style="font-size:0.68rem;color:#d2a8ff;background:rgba(210,168,255,0.1);border:1px solid rgba(210,168,255,0.2);border-radius:4px;padding:1px 6px;margin-left:0.3rem;">${_eH(u.categoryLabel || u.category)}</span>`
                    : '';
                return `
                <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:0.85rem;margin-bottom:0.6rem;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.85rem;font-weight:600;color:white;">${_eH(u.email || u._id)}</div>
                            ${u.displayName ? `<div style="font-size:0.76rem;color:#8b949e;margin-top:2px;">${_eH(u.displayName)}</div>` : ''}
                            <div style="font-size:0.72rem;color:#79c0ff;margin-top:3px;">
                                👨‍👩‍👧 ${_eH(role === 'parent' ? 'Padre/Madre/Tutor' : role)}${catBadge}
                            </div>
                        </div>
                        <div style="display:flex;gap:0.4rem;flex-shrink:0;">
                            <button onclick="indForwardToSA('${escId}','${role}','${escEmail}','${u.category || ''}')"
                                class="sa-btn" style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.08);">
                                📩 Solicitar plaza al SuperAdmin</button>
                            <button onclick="indRejectRequest('${escId}','${escEmail}')"
                                class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">
                                ✕ Rechazar</button>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }

    // ── Section 2: SA-approved, pending individual confirmation ──
    if (pendingParents.length) {
        html += `
        <div style="background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.25);border-radius:10px;padding:1rem;margin-bottom:1rem;">
            <h3 style="font-size:0.88rem;color:#3fb950;margin:0 0 0.5rem;display:flex;align-items:center;gap:0.5rem;">
                ✅ Aprobadas por SuperAdmin — Pendientes de tu confirmación
                <span style="background:rgba(63,185,80,0.15);color:#3fb950;padding:1px 8px;border-radius:10px;font-size:0.7rem;">${pendingParents.length}</span>
            </h3>
            <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.8rem;padding:0.4rem 0.6rem;background:rgba(63,185,80,0.05);border-radius:6px;border:1px solid rgba(63,185,80,0.15);">
                El SuperAdmin ha aprobado la plaza. Confirma el acceso para que el usuario pueda entrar a la app.
            </p>
            ${pendingParents.map(u => {
                const catLabel = u.categoryLabel || u.category || '–';
                const escId = _eA(u._id);
                const escEmail = _eA(u.email || u._id);
                return `
                <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(63,185,80,0.25);border-radius:9px;padding:0.85rem;margin-bottom:0.6rem;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.85rem;font-weight:600;color:white;">${_eH(u.email || u._id)}</div>
                            ${u.displayName ? `<div style="font-size:0.76rem;color:#8b949e;margin-top:2px;">${_eH(u.displayName)}</div>` : ''}
                            <div style="font-size:0.72rem;color:#79c0ff;margin-top:3px;">
                                👨‍👩‍👧 ${_eH(catLabel)}
                                ${u.playerNumber ? ` · Dorsal #${_eH(String(u.playerNumber))}` : ''}
                                ${u.playerAlias ? ` · ${_eH(u.playerAlias)}` : ''}
                            </div>
                        </div>
                        <div style="display:flex;gap:0.4rem;flex-shrink:0;">
                            <button onclick="indConfirmAccess('${escId}','${escEmail}')"
                                class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.08);">
                                ✅ Confirmar acceso</button>
                            <button onclick="indRejectRequest('${escId}','${escEmail}')"
                                class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">
                                ✕ Rechazar</button>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }

    body.innerHTML = html;
};

// ═══════════════════════════════════════════════════════════════════
// indRenderRequestForm() — Solicitar nuevo padre al SuperAdmin
// ═══════════════════════════════════════════════════════════════════

window.indRenderRequestForm = function indRenderRequestForm() {
    const body = document.getElementById('ind-body');
    if (!body) return;

    const catOptions = IND_CATEGORIES.flatMap(cat =>
        IND_SUB_CATS.map(sub => {
            const val = _indSlotKey(cat.id, sub);
            return `<option value="${val}">${cat.label} ${sub}</option>`;
        })
    ).join('');

    body.innerHTML = `
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(88,166,255,0.25);border-radius:10px;padding:1rem;">
        <div style="font-weight:700;color:#58a6ff;margin-bottom:0.4rem;font-size:0.9rem;">
            📩 Solicitar nuevo usuario al SuperAdmin</div>
        <div style="font-size:0.75rem;color:#8b949e;margin-bottom:0.8rem;
                    padding:0.5rem 0.7rem;background:rgba(88,166,255,0.05);
                    border:1px solid rgba(88,166,255,0.15);border-radius:8px;line-height:1.5;">
            <strong style="color:#58a6ff;">Flujo correcto:</strong>
            1️⃣ Tú solicitas aquí → 2️⃣ SuperAdmin aprueba → 3️⃣ El usuario se registra → 4️⃣ Tú le das acceso
        </div>

        <div class="sa-g4" style="margin-bottom:0.6rem;">
            <div><label class="sa-label">Email del padre / tutor *</label>
                <input class="sa-input" id="ind-req-email" type="email" placeholder="padre@email.com"></div>
            <div><label class="sa-label">Nombre completo</label>
                <input class="sa-input" id="ind-req-name" placeholder="Nombre y apellidos"></div>
        </div>
        <div class="sa-g4" style="margin-bottom:0.6rem;">
            <div><label class="sa-label">Categoría *</label>
                <select class="sa-input" id="ind-req-category">
                    ${catOptions}
                </select></div>
            <div><label class="sa-label">Nº Dorsal del jugador *</label>
                <input class="sa-input" id="ind-req-dorsal" type="number" placeholder="ej: 7" min="1" max="99"></div>
        </div>
        <div class="sa-g4" style="margin-bottom:0.6rem;">
            <div><label class="sa-label">Alias del jugador</label>
                <input class="sa-input" id="ind-req-alias" placeholder="ej: García"></div>
            <div><label class="sa-label">WhatsApp del padre (sin +)</label>
                <input class="sa-input" id="ind-req-wa" type="tel" placeholder="ej: 34612345678"></div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.8rem;">
            <button onclick="indSolicitarPadre()" class="sa-btn"
                style="color:#58a6ff;border-color:rgba(88,166,255,0.4);
                       background:rgba(88,166,255,0.1);font-weight:700;padding:0.45rem 1.2rem;">
                📩 Enviar solicitud</button>
        </div>
        <div id="ind-req-msg" style="font-size:0.78rem;margin-top:0.4rem;min-height:1.2rem;color:#3fb950;"></div>
    </div>`;
};

// ═══════════════════════════════════════════════════════════════════
// indRenderMembers() — Miembros grouped by category accordion
// ═══════════════════════════════════════════════════════════════════

window.indRenderMembers = function indRenderMembers() {
    const body = document.getElementById('ind-body');
    if (!body || !window._indData) return;

    const { parents } = window._indData;
    const _eH = _indEsc;
    const _eA = (s) => _indEscA(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const membersHTML = IND_CATEGORIES.map(cat => {
        const catParents = parents.filter(u => {
            if (u.status === 'removed' || u.status === 'rejected') return false;
            const uCat = u.category || '';
            return uCat.startsWith(cat.id + '_');
        });
        const totalActive = catParents.filter(u => u.status === 'active' && u.isAuthorized !== false).length;
        const sectionId = `ind-members-${cat.id}`;

        const rows = catParents.map(u => {
            const isBlocked = u.status === 'blocked';
            const isActive = u.isAuthorized && !isBlocked && u.status === 'active';

            const statusBadge =
                isBlocked ? '<span class="sa-badge" style="margin-left:0.4rem;background:#ffa50022;color:#ffa500;">🔒 Bloqueado</span>'
              : isActive  ? '<span class="sa-badge" style="margin-left:0.4rem;background:rgba(63,185,80,0.12);color:#3fb950;">✅ Activo</span>'
              : '<span class="sa-badge" style="margin-left:0.4rem;background:#ffa50022;color:#ffa500;">⏳ Pendiente</span>';

            const subLabel = u.category ? u.category.slice(-1).toUpperCase() : '?';
            const catLabel = u.categoryLabel || `${cat.label} ${subLabel}`;

            const euid = _eA(u._id);
            const email = _eA(u.email || u._id);

            return `
            <div class="sa-urow">
                <div style="flex:1;min-width:0;">
                    <span style="font-size:0.83rem;font-weight:600;">${_eH(u.email || u._id)}</span>
                    ${u.displayName ? `<span style="color:var(--text-muted);font-size:0.74rem;"> · ${_eH(u.displayName)}</span>` : ''}
                    ${statusBadge}
                    <div style="font-size:0.68rem;color:#8b949e;margin-top:1px;">
                        ${_eH(catLabel)}
                        ${u.playerNumber ? ` · Dorsal #${_eH(String(u.playerNumber))}` : ''}
                        ${u.playerAlias ? ` · ${_eH(u.playerAlias)}` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:0.3rem;flex-shrink:0;align-items:center;">
                    ${isActive ? `<button class="sa-btn"
                        onclick="indSetParentStatus('${euid}','${email}','blocked')"
                        style="font-size:0.7rem;color:#ffa500;border-color:rgba(255,165,0,0.35);background:rgba(255,165,0,0.07);">
                        🔒 Bloquear</button>` : ''}
                    ${!isActive ? `<button class="sa-btn"
                        onclick="indSetParentStatus('${euid}','${email}','active')"
                        style="font-size:0.7rem;color:#3fb950;border-color:rgba(63,185,80,0.35);background:rgba(63,185,80,0.08);">
                        ✅ Activar</button>` : ''}
                    <button class="sa-btn"
                        onclick="indDeleteParent('${euid}','${email}')"
                        style="font-size:0.7rem;color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);">
                        🗑️ Dar de baja</button>
                </div>
            </div>`;
        }).join('');

        return `
        <div class="sa-card" id="${sectionId}" style="margin-bottom:0.6rem;border-color:rgba(121,192,255,0.2);">
            <div class="sa-card-head" onclick="document.getElementById('${sectionId}').classList.toggle('expanded')">
                <div class="sa-card-title">
                    <span class="sa-chevron">▼</span>
                    <span style="color:#79c0ff;">👨‍👩‍👧 ${cat.label}</span>
                    <span class="sa-badge" style="background:rgba(121,192,255,0.12);color:#79c0ff;">${totalActive}</span>
                </div>
            </div>
            <div class="sa-card-body">
                ${catParents.length
                    ? rows
                    : `<p style="color:var(--text-muted);font-size:0.78rem;margin:0.3rem 0;">Sin padres registrados en ${cat.label}.</p>`
                }
            </div>
        </div>`;
    }).join('');

    const totalParents = parents.filter(u => u.status !== 'removed' && u.status !== 'rejected').length;

    body.innerHTML = `
    <div style="margin-bottom:0.8rem;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:0.85rem;font-weight:700;color:white;display:flex;align-items:center;gap:0.5rem;">
            👥 Miembros registrados
            <span class="sa-badge" style="background:rgba(121,192,255,0.12);color:#79c0ff;">${totalParents}</span>
        </div>
        <button class="sa-btn" onclick="openIndividualAdminPanel()" style="font-size:0.72rem;color:#79c0ff;border-color:rgba(121,192,255,0.3);background:rgba(121,192,255,0.07);">
            🔄 Actualizar</button>
    </div>
    ${membersHTML}`;
};

// ═══════════════════════════════════════════════════════════════════
// indForwardToSA() — Forward pending registration to SuperAdmin
// ═══════════════════════════════════════════════════════════════════

window.indForwardToSA = async function indForwardToSA(uid, role, email, category) {
    const d = window._indData;
    if (!d) return;
    const { uid: indUid, userData, me } = d;
    const displayName = userData.displayName || me.email;

    if (!confirm(`¿Enviar solicitud de plaza al SuperAdmin para ${email}?\n\nRol: ${role}\n\nEl SuperAdmin deberá aprobarla antes de que el usuario pueda acceder.`)) return;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Enviando solicitud al SuperAdmin…');
    try {
        const { db, doc, setDoc } = await saFS();
        const reqId = 'ind_slot_req_' + indUid + '_' + uid + '_' + Date.now().toString(36);
        await setDoc(doc(db, 'platform_requests', reqId), {
            type: 'slot_request',
            individualOwnerId: indUid,
            individualName: displayName,
            clubId: indUid,
            clubName: displayName,
            requestedRole: role,
            requestedRoleLabel: role === 'parent' ? 'Padre/Madre/Tutor' : role,
            requestedCategory: category || null,
            requestedCategoryLabel: category || null,
            userUid: uid,
            userEmail: email,
            requestedBy: me.uid,
            requestedByEmail: me.email,
            status: 'pending_sa',
            createdAt: new Date().toISOString(),
        });
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`✅ Solicitud enviada al SuperAdmin para ${email}.`, 4000);
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indForwardToSA]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indConfirmAccess() — Confirm parent access after SA approval
// ═══════════════════════════════════════════════════════════════════

window.indConfirmAccess = async function indConfirmAccess(parentUid, email) {
    if (!confirm(`¿Confirmar acceso definitivo a ${email}?`)) return;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Confirmando acceso…');
    try {
        const { db, doc, updateDoc } = await saFS();
        const me = window._cronosCurrentUser;
        await updateDoc(doc(db, 'users', parentUid), {
            isAuthorized: true,
            status: 'active',
            authorizedAt: new Date().toISOString(),
            authorizedBy: me.uid,
        });
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`✅ ${email} tiene acceso completo a la app.`, 4000);
        // Reload panel
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indConfirmAccess]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indRejectRequest() — Reject a pending parent
// ═══════════════════════════════════════════════════════════════════

window.indRejectRequest = async function indRejectRequest(parentUid, email) {
    if (!confirm(`¿Rechazar la solicitud de ${email}?`)) return;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Rechazando…');
    try {
        const { db, doc, updateDoc } = await saFS();
        await updateDoc(doc(db, 'users', parentUid), {
            isAuthorized: false,
            status: 'rejected',
            rejectedAt: new Date().toISOString(),
            rejectedBy: window._cronosCurrentUser?.uid || 'individual',
        });
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Solicitud rechazada.', 3000);
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indRejectRequest]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indSetParentStatus() — Block / Activate a parent
// ═══════════════════════════════════════════════════════════════════

window.indSetParentStatus = async function indSetParentStatus(parentUid, email, newStatus) {
    const actionLabel = newStatus === 'blocked' ? 'bloquear' : 'activar';
    if (!confirm(`¿${actionLabel} a ${email}?`)) return;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Procesando…');
    try {
        const { db, doc, updateDoc } = await saFS();
        if (newStatus === 'blocked') {
            await updateDoc(doc(db, 'users', parentUid), {
                status: 'blocked',
                isAuthorized: false,
                blockedAt: new Date().toISOString(),
                blockedBy: window._cronosCurrentUser?.uid || 'individual',
            });
        } else {
            await updateDoc(doc(db, 'users', parentUid), {
                status: 'active',
                isAuthorized: true,
                authorizedAt: new Date().toISOString(),
                authorizedBy: window._cronosCurrentUser?.uid || 'individual',
            });
        }
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`✅ ${email} ${newStatus === 'blocked' ? 'bloqueado' : 'activado'}.`, 3000);
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indSetParentStatus]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indDeleteParent() — Delete parent completely from DB (email reuse)
// ═══════════════════════════════════════════════════════════════════

window.indDeleteParent = async function indDeleteParent(parentUid, email) {
    if (!confirm(`⚠️ ¿ELIMINAR completamente a ${email}?\n\nEsta acción es irreversible.\nEl usuario será borrado de la base de datos y su email podrá reutilizarse.`)) return;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Eliminando usuario…');
    try {
        const { db, fa, doc, deleteDoc, httpsCallable } = await saFS();

        // Try to delete from Firebase Auth
        if (httpsCallable && fa && fa.functions) {
            try { await httpsCallable(fa.functions, 'deleteAuthUser')({ uid: parentUid, email }); } catch (_) {}
        }

        // Delete from Firestore completely (allows email reuse)
        await deleteDoc(doc(db, 'users', parentUid));

        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`🗑️ ${email} eliminado completamente de la base de datos.`, 5000);
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indDeleteParent]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indSolicitarPadre() — Send request to SuperAdmin for new parent
// ═══════════════════════════════════════════════════════════════════

window.indSolicitarPadre = async function indSolicitarPadre() {
    const emailEl  = document.getElementById('ind-req-email');
    const nameEl   = document.getElementById('ind-req-name');
    const catEl    = document.getElementById('ind-req-category');
    const dorsalEl = document.getElementById('ind-req-dorsal');
    const aliasEl  = document.getElementById('ind-req-alias');
    const waEl     = document.getElementById('ind-req-wa');
    const msgEl    = document.getElementById('ind-req-msg');

    if (!emailEl || !msgEl) return;

    const email   = emailEl.value.trim();
    const name    = nameEl ? nameEl.value.trim() : '';
    const category = catEl ? catEl.value : '';
    const dorsal  = dorsalEl ? dorsalEl.value.trim() : '';
    const alias   = aliasEl ? aliasEl.value.trim() : '';
    const wa      = waEl ? waEl.value.trim() : '';

    // Validation
    if (!email) { msgEl.style.color = '#ff5858'; msgEl.textContent = '⚠️ Email obligatorio.'; return; }
    if (!category) { msgEl.style.color = '#ff5858'; msgEl.textContent = '⚠️ Categoría obligatoria.'; return; }
    if (!dorsal) { msgEl.style.color = '#ff5858'; msgEl.textContent = '⚠️ Nº Dorsal del jugador obligatorio.'; return; }

    // Build category label
    const catParts = category.split('_');
    const catId = catParts[0];
    const subCat = catParts[1] ? catParts[1].toUpperCase() : '';
    const catObj = IND_CATEGORIES.find(c => c.id === catId);
    const categoryLabel = catObj ? `${catObj.label} ${subCat}` : category;

    msgEl.style.color = '#58a6ff';
    msgEl.textContent = 'Enviando solicitud al SuperAdmin…';

    try {
        const { db, doc, setDoc } = await saFS();
        const me = window._cronosCurrentUser;

        const reqId = 'ind_req_' + me.uid + '_' + Date.now().toString(36);
        await setDoc(doc(db, 'platform_requests', reqId), {
            type: 'user_request',
            ownerType: 'individual',
            individualOwnerId: me.uid,
            individualOwnerEmail: me.email,
            individualOwnerName: window._indData?.displayName || me.email,
            requestedEmail: email,
            requestedName: name,
            requestedRole: 'parent',
            requestedRoleLabel: 'Padre / Madre / Tutor',
            category: category,
            categoryLabel: categoryLabel,
            playerNumber: parseInt(dorsal, 10) || null,
            playerAlias: alias || null,
            parentWA: wa || null,
            requestedBy: me.uid,
            requestedByEmail: me.email,
            status: 'pending_sa',
            createdAt: new Date().toISOString(),
        });

        msgEl.style.color = '#3fb950';
        msgEl.textContent = '✅ Solicitud enviada al SuperAdmin. Cuando la apruebe, el padre podrá registrarse y tú deberás confirmar su acceso.';
        // Clear form
        emailEl.value = '';
        if (nameEl) nameEl.value = '';
        if (dorsalEl) dorsalEl.value = '';
        if (aliasEl) aliasEl.value = '';
        if (waEl) waEl.value = '';
    } catch (e) {
        msgEl.style.color = '#ff5858';
        msgEl.textContent = '❌ Error: ' + e.message;
        console.error('[indSolicitarPadre]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════
window.openIndividualAdminPanel = openIndividualAdminPanel;

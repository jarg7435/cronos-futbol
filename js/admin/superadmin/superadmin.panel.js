/**
 * 16_superadmin.js  —  SuperAdmin Panel v9.0
 * Chronos Fútbol
 *
 * FLUJO DE APROBACIÓN (DOS PASOS):
 *   1. Usuario se registra  → status:'pending'       → SA ve en "Solicitudes"
 *   2. SuperAdmin aprueba   → status:'pending_club'  → Club Admin ve en "Pendientes"
 *   3. Club Admin confirma  → status:'active'        → usuario puede entrar
 *
 * SOLICITUD DESDE CLUB ADMIN:
 *   1. Club Admin pide plaza → platform_requests status:'pending_sa'
 *   2. SA aprueba → pre-usuario status:'pending_register'
 *   3. Usuario se registra → status:'pending_club'
 *   4. Club Admin confirma → status:'active'
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTES COMPARTIDAS — Definidas en admin-shared.js (carga antes)
// Si admin-shared.js no cargó, se emite un aviso en consola.
// ═══════════════════════════════════════════════════════════════════

if (typeof window.ROLE_META === 'undefined') {
    console.warn('[superadmin/panel.js] ROLE_META no definido — admin-shared.js no cargó correctamente');
}

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
.sa-stat{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.6rem;text-align:center;}
.sa-stat-n{font-size:1.3rem;font-weight:800;color:#3fb950;}
.sa-stat-l{font-size:0.65rem;color:#8b949e;margin-top:0.1rem;}
.sa-urow{display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.3rem;border-bottom:1px solid rgba(255,255,255,0.04);}
.sa-urow:last-child{border-bottom:none;}
.sa-g4{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.6rem;align-items:start;}
</style>`;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS UI
// ═══════════════════════════════════════════════════════════════════

(function () {
    function spinnerEl() {
        let el = document.getElementById('_sa-spinner');
        if (!el) {
            el = document.createElement('div');
            el.id = '_sa-spinner';
            el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);display:none;align-items:center;justify-content:center;z-index:99999;flex-direction:column;gap:0.8rem;';
            el.innerHTML = '<style>@keyframes _saSpin{to{transform:rotate(360deg)}}</style><div style="width:38px;height:38px;border:3px solid rgba(255,255,255,0.12);border-top-color:#58a6ff;border-radius:50%;animation:_saSpin 0.75s linear infinite;"></div><div id="_sa-spinner-msg" style="color:white;font-size:0.88rem;font-family:Inter,sans-serif;"></div>';
            document.body.appendChild(el);
        }
        return el;
    }
    window._saShowSpinner = function(msg) {
        if (typeof showSpinner === 'function') { showSpinner(msg); return; }
        const el = spinnerEl();
        const m = document.getElementById('_sa-spinner-msg');
        if (m) m.textContent = msg || '';
        el.style.display = 'flex';
    };
    window._saHideSpinner = function() {
        if (typeof hideSpinner === 'function') { hideSpinner(); return; }
        const el = document.getElementById('_sa-spinner');
        if (el) el.style.display = 'none';
    };
    window._saToast = function(msg, ms) {
        if (typeof showToast === 'function') { showToast(msg, ms); return; }
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;bottom:1.8rem;left:50%;transform:translateX(-50%);background:#1a2233;color:white;padding:0.75rem 1.4rem;border-radius:8px;font-size:0.87rem;font-family:Inter,sans-serif;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.1);white-space:nowrap;';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), ms || 3000);
    };
})();

// ═══════════════════════════════════════════════════════════════════
// saFS() — helper de Firebase (compartido con 17_club_admin.js)
// ═══════════════════════════════════════════════════════════════════

window.saFS = async function saFS() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) throw new Error('Firebase no inicializado. Recarga la página.');
    const [fs, fnMod, appMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    ]);
    if (!fa._functions) {
        try { fa._functions = fnMod.getFunctions(appMod.getApp()); }
        catch (e) { console.warn('[saFS] Functions:', e.message); }
    }
    return {
        db: fa.db,
        fa: Object.assign({}, fa, { functions: fa._functions }),
        doc: fs.doc, getDoc: fs.getDoc, setDoc: fs.setDoc,
        updateDoc: fs.updateDoc, deleteDoc: fs.deleteDoc,
        collection: fs.collection, query: fs.query,
        where: fs.where, getDocs: fs.getDocs,
        orderBy: fs.orderBy, onSnapshot: fs.onSnapshot,
        serverTimestamp: fs.serverTimestamp,
        httpsCallable: fnMod.httpsCallable,
    };
};

window.saGet = async function saGet(col, id) {
    try {
        const { db, doc, getDoc } = await saFS();
        const s = await getDoc(doc(db, col, id));
        return s.exists() ? { id: s.id, ...s.data() } : null;
    } catch (e) { console.warn('[saGet]', e.message); return null; }
};

// ═══════════════════════════════════════════════════════════════════
// openSuperAdminPanel()
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// saGoBackToRoles() — volver al selector de roles desde cualquier panel
// ═══════════════════════════════════════════════════════════════════
window.saGoBackToRoles = function saGoBackToRoles() {
    // Cerrar panel SA
    const saPanel = document.getElementById('sa-panel');
    if (saPanel) saPanel.remove();
    // Cerrar panel Individual Admin
    const indPanel = document.getElementById('ind-panel');
    if (indPanel) indPanel.remove();
    // Cerrar modal de club admin si está abierto
    const modal = document.getElementById('setup-modal');
    if (modal) modal.style.display = 'none';
    // Ocultar paneles de campo
    const mainH = document.getElementById('main-header');
    if (mainH) mainH.style.display = 'none';
    const mainC = document.getElementById('main-container');
    if (mainC) mainC.style.display = 'none';
    // Restaurar body
    document.body.style.background = '#0d1117';
    document.body.classList.remove('locked');
    // Mostrar selector de roles (compatible con ambos nombres)
    if (typeof showRoleSelection === 'function') showRoleSelection();
    else if (typeof showRoleSelector === 'function') showRoleSelector();
};

window.openSuperAdminPanel = async function openSuperAdminPanel() {
    ['main-header','role-selection-screen','install-screen','auth-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const main = document.getElementById('app-main') || document.querySelector('main');
    if (main) main.style.display = 'none';
    const setupModal = document.getElementById('setup-modal');
    if (setupModal) setupModal.style.display = 'none';

    // Contar pendientes para badge (mismas fuentes que el panel Solicitudes)
    let pendingCount = 0;
    try { pendingCount = await window.saCountPendingRequests(); } catch (_) {}

    const badge = pendingCount > 0
        ? ` <span style="background:#ff5858;color:white;border-radius:10px;padding:1px 7px;font-size:0.65rem;font-weight:700;">${pendingCount}</span>`
        : '';

    const old = document.getElementById('sa-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'sa-panel';
    panel.style.cssText = 'position:fixed;inset:0;background:#0d1117;z-index:9500;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,sans-serif;';
    panel.innerHTML = `
<div style="background:rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.1);padding:0.85rem 1.2rem;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;flex-wrap:wrap;gap:0.4rem;">
    <div style="display:flex;align-items:center;gap:0.7rem;">
        <span style="font-size:1.4rem;">👑</span>
        <div>
            <div style="font-family:'Outfit',sans-serif;font-size:1rem;color:white;font-weight:700;">SuperAdmin</div>
            <div style="font-size:0.68rem;color:#8b949e;">Chronos Fútbol · Control Total</div>
        </div>
    </div>
    <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
        
        <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();else if(typeof logoutUser==='function')logoutUser();"
            style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);color:#ff5858;padding:0.32rem 0.7rem;border-radius:6px;cursor:pointer;font-size:0.76rem;font-weight:700;">⏻ Salir</button>
    </div>
</div>
<div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch;">
    <button id="sa-tab-clubs"       onclick="saTab('clubs')"       style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid #58a6ff;color:#58a6ff;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">🏟️ Clubes</button>
    <button id="sa-tab-individuals" onclick="saTab('individuals')" style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">👤 Individuales</button>
    <button id="sa-tab-requests"    onclick="saTab('requests')"    style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">📋 Solicitudes${badge}</button>
    <button id="sa-tab-secretary"   onclick="saTab('secretary')"   style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">✉️ Secretaría</button>
    <button id="sa-tab-trash"       onclick="saTab('trash')"       style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">🗑️ Rastros</button>
    <button id="sa-tab-billing"     onclick="saTab('billing')"     style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">💳 Facturación</button>
    <button id="sa-tab-extras"      onclick="saTab('extras')"      style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">⚙️ Extras</button>
    <button id="sa-tab-messages"    onclick="saTab('messages')"    style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">✉️ Mensajes</button>
</div>
<div id="sa-body" style="flex:1;overflow-y:auto;padding:1.1rem;-webkit-overflow-scrolling:touch;"></div>`;
    document.body.appendChild(panel);
    saTab('clubs');
    setupClubsSyncListener();
};

// ═══════════════════════════════════════════════════════════════════
// saTab()
// ═══════════════════════════════════════════════════════════════════

window.saTab = function saTab(tab) {
    ['clubs','individuals','requests','secretary','trash','billing','extras','messages'].forEach(t => {
        const b = document.getElementById('sa-tab-'+t);
        if (!b) return;
        b.style.borderBottomColor = (t===tab)?'#58a6ff':'transparent';
        b.style.color             = (t===tab)?'#58a6ff':'#8b949e';
    });
    if      (tab==='clubs')       saClubs();
    else if (tab==='individuals') saIndividuals();
    else if (tab==='requests')    saRequests();
    else if (tab==='secretary')   saSecretary();
    else if (tab==='trash')       saTrash();
    else if (tab==='billing')     saBilling();
    else if (tab==='extras')      saExtras();
    else if (tab==='messages')    saMessages();
};

// ═══════════════════════════════════════════════════════════════════
// saClubs()
// ═══════════════════════════════════════════════════════════════════

window.saClubs = async function saClubs() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center;padding:2.5rem;color:#8b949e;"><div style="font-size:1.6rem;">⏳</div>Cargando clubes…</div>`;
    try {
        // Botones de creación siempre visibles arriba
        const actionBar = document.createElement('div');
        actionBar.style.cssText = 'display:flex;gap:0.7rem;padding:0.8rem;border-bottom:1px solid rgba(255,255,255,0.07);margin-bottom:0.5rem;';
        actionBar.innerHTML = `
            <button onclick="saShowCreateClub()"
                style="display:flex;align-items:center;gap:0.5rem;padding:0.55rem 1.1rem;
                       background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.4);
                       border-radius:8px;color:#58a6ff;font-size:0.85rem;font-weight:700;cursor:pointer;">
                🏟️ + Crear Club
            </button>
            <button onclick="saShowCreateIndividualEntity()"
                style="display:flex;align-items:center;gap:0.5rem;padding:0.55rem 1.1rem;
                       background:rgba(121,192,255,0.12);border:1px solid rgba(121,192,255,0.4);
                       border-radius:8px;color:#79c0ff;font-size:0.85rem;font-weight:700;cursor:pointer;">
                👤 + Crear Ente Individual
            </button>
            <button onclick="saShowCreateIndividual()"
                style="display:flex;align-items:center;gap:0.5rem;padding:0.55rem 1.1rem;
                       background:rgba(63,185,80,0.12);border:1px solid rgba(63,185,80,0.4);
                       border-radius:8px;color:#3fb950;font-size:0.85rem;font-weight:700;cursor:pointer;">
                👤 + Usuario Individual
            </button>
        `;
        body.innerHTML = '';
        body.appendChild(actionBar);
        const { db, collection, getDocs } = await saFS();
        const [clubsSnap, usersSnap] = await Promise.all([
            getDocs(collection(db,'clubs')),
            getDocs(collection(db,'users')),
        ]);
        const clubs = {};
        const _indivClubIds = new Set();
        clubsSnap.forEach(d => {
            const c = { id:d.id, users:[], ...d.data() };
            if (c.type === 'individual') { _indivClubIds.add(d.id); return; }
            clubs[d.id] = c;
        });
        const orphans = [];
        usersSnap.forEach(d => {
            const u = { id:d.id, ...d.data() };
            if (['superadmin','admin'].includes(u.role)) return;
            // Exclude users that belong to an individual entity (they appear in the Individuals tab)
            const isIndivUser = u.role === 'individual' || u.role === 'admin_individual' || u.role === 'parent_individual'
                || !!(u.individualEntityId || u.individualOwnerId || u.isIndividual)
                || (u.clubId && _indivClubIds.has(u.clubId))
                || (u.allRoles||[]).some(r => ['individual','admin_individual','parent_individual','entrenador_individual','padre_individual'].includes(r.role));
            if (isIndivUser) return;
            if (u.clubId && clubs[u.clubId]) clubs[u.clubId].users.push(u);
            else orphans.push(u);
        });

        const stColor = { active:'#3fb950', blocked:'#f0883e', removed:'#ff5858', pending:'#ffd700', pending_club:'#ffa500', pending_register:'#79c0ff' };
        const stLabel = { active:'Activo', blocked:'Bloqueado', removed:'Baja', pending:'⏳ Pend.SA', pending_club:'⏳ Pend.Club', pending_register:'⏳ Sin registrar' };

        // Expande los usuarios de un club a la forma { ...u, _activeRoleData }
        // que consume window.renderCategoryTreeReadOnly (mismo criterio que
        // js/admin/club/panel.js: allRoles del club + fallback al rol raiz,
        // con respaldo de category/subcategory).
        const _expandClubUsers = (clubUsers, cid) => {
            const cidStr = String(cid || '');
            const expanded = [];
            (clubUsers || []).filter(u => u.status !== 'removed').forEach(u => {
                let roles = u.allRoles || [];
                if (roles.length === 0) {
                    const rootClubId = String(u.clubId || u.requestedClubId || '');
                    const isAuth = u.isAuthorized === true || u.authorized === true;
                    if (rootClubId === cidStr) {
                        roles = [{
                            role: u.role || u.requestedRole,
                            clubId: u.clubId || u.requestedClubId || null,
                            isAuthorized: isAuth,
                            status: u.status,
                            category: u.category || u.categoryLabel,
                            subcategory: u.subcategory,
                        }];
                    }
                }
                // If still no roles resolved, add a synthetic entry so the user appears in the tree
                if (roles.length === 0 && (String(u.clubId||'') === cidStr || String(u.requestedClubId||'') === cidStr)) {
                    expanded.push({ ...u, _activeRoleData: {
                        role: u.role || u.requestedRole,
                        clubId: cid,
                        isAuthorized: u.isAuthorized === true,
                        status: u.status,
                        category: u.category || u.categoryLabel,
                        subcategory: u.subcategory,
                    }});
                    return;
                }
                roles.forEach(r => {
                    const rCid = String(r.clubId || r.requestedClubId || '');
                    // Include both authorized AND pending users (not rejected)
                    const notRejected = r.status !== 'rejected' && u.status !== 'rejected';
                    const matchClub = rCid === cidStr || (rCid === '' && String(u.clubId||'') === cidStr);
                    if (matchClub && notRejected) {
                        const _roleData = (r.category == null && r.subcategory == null)
                            ? { ...r,
                                category:    u.category || u.categoryLabel,
                                subcategory: u.subcategory }
                            : r;
                        expanded.push({ ...u, _activeRoleData: _roleData });
                    }
                });
            });
            return expanded;
        };

        const renderRow = (u, cid) => {
            const st   = u.status || (u.isAuthorized?'active':'pending');
            const meta = window.ROLE_META[u.role] || { icon:'👤', color:'#8b949e', label:u.role||'?' };
            const _escA = typeof escapeAttr==='function'?escapeAttr:function(s){return s;};
            const _escH = typeof escapeHtml==='function'?escapeHtml:function(s){return s;};
            const em   = _escA(u.email||u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            const eid  = _escA(u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            const ecid = _escA(cid).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            return `
            <div style="display:flex;align-items:center;gap:0.4rem;padding:0.48rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.04);">
                <span title="${_escA(meta.label)}">${meta.icon}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.81rem;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escH(u.email||u.id)}</div>
                    <div style="font-size:0.68rem;color:${stColor[st]||'#8b949e'};">${meta.label} · ${stLabel[st]||st}</div>
                </div>
                <div style="display:flex;gap:0.2rem;flex-shrink:0;">
                    ${st==='pending'?`<button onclick="saQuickApprove('${eid}','${em}','${ecid}')" title="Aprobar (SA)" style="padding:0.22rem 0.45rem;background:rgba(255,215,0,0.15);border:1px solid rgba(255,215,0,0.4);border-radius:5px;color:#ffd700;font-size:0.68rem;cursor:pointer;font-weight:700;">✅ SA</button>`:''}
                    ${st==='active'?`<button onclick="saSetClubUserStatus('${eid}','${em}','blocked','${ecid}')" style="padding:0.22rem 0.45rem;background:rgba(240,136,62,0.15);border:1px solid rgba(240,136,62,0.4);border-radius:5px;color:#f0883e;font-size:0.68rem;cursor:pointer;">🔒</button>`:''}
                    ${st==='blocked'?`<button onclick="saSetClubUserStatus('${eid}','${em}','active','${ecid}')" style="padding:0.22rem 0.45rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:5px;color:#3fb950;font-size:0.68rem;cursor:pointer;">✅</button>`:''}
                    ${st!=='removed'?`<button onclick="saSetClubUserStatus('${eid}','${em}','removed','${ecid}')" style="padding:0.22rem 0.45rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:5px;color:#ff5858;font-size:0.68rem;cursor:pointer;">🗑️</button>`:''}
                </div>
            </div>`;
        };

        let html = '';
        Object.values(clubs).forEach(c => {
            const vis  = c.users.filter(u => !['superadmin','admin'].includes(u.role));
            const pend = vis.filter(u => ['pending','pending_club'].includes(u.status)).length;
            // Contadores por rol
            const countByRole = (role) => vis.filter(u => {
                if (u.role === role && u.status !== 'removed') return true;
                return u.status !== 'removed' && (u.allRoles||[]).some(r => r.role === role && r.isAuthorized && r.clubId === c.id);
            }).length;
            const slotBar = (role, icon, label, color) => {
                const used = countByRole(role);
                const max  = c.slots?.[role === 'director' ? 'directors'
                           : role === 'coordinator' ? 'coordinators'
                           : role === 'user' ? 'users' : 'parents'] ?? '∞';
                const pct  = max !== '∞' && max > 0 ? Math.round((used/max)*100) : 0;
                const full = max !== '∞' && used >= max;
                return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0.9rem;border-bottom:1px solid rgba(255,255,255,0.03);">
                    <span style="font-size:0.8rem;">${icon}</span>
                    <span style="flex:1;font-size:0.75rem;color:#cdd9e5;">${label}</span>
                    <span style="font-size:0.75rem;font-weight:700;color:${full?'#ff5858':used>0?color:'#4d5566'};">${used}</span>
                    <span style="font-size:0.68rem;color:#4d5566;">/ ${max}</span>
                    <div style="width:60px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
                        <div style="height:100%;width:${Math.min(pct,100)}%;background:${full?'#ff5858':color};border-radius:2px;transition:width 0.3s;"></div>
                    </div>
                </div>`;
            };
            const adminCount = countByRole('club_admin');

            html += `
            <div style="margin-bottom:1rem;border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden;">
                <div style="background:rgba(88,166,255,0.07);padding:0.6rem 0.9rem;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-weight:700;color:white;font-size:0.9rem;">🏟️ ${typeof escapeHtml==='function'?escapeHtml(c.name||c.id):(c.name||c.id)}</div>
                        <div style="font-size:0.68rem;color:#8b949e;margin-top:2px;">Plan: ${c.plan||'free'} · ${vis.length} usuarios totales${pend>0?' · <span style="color:#ffd700;">'+pend+' pendientes</span>':''}</div>
                    </div>
                    <div style="display:flex;gap:0.4rem;align-items:center;">
                        <button onclick="saEditClubSlots('${c.id}','${typeof escapeAttr==='function'?escapeAttr(c.name||c.id):(c.name||c.id)}')"
                            title="Editar slots y plan"
                            style="padding:0.2rem 0.5rem;background:rgba(88,166,255,0.12);
                                   border:1px solid rgba(88,166,255,0.3);border-radius:5px;
                                   color:#58a6ff;font-size:0.68rem;cursor:pointer;">
                            ✏️ Editar
                        </button>
                        <button onclick="saDeleteClubComplete('${c.id}','${typeof escapeAttr==='function'?escapeAttr(c.name||c.id):(c.name||c.id)}')"
                            title="Borrar club completo"
                            style="padding:0.2rem 0.5rem;background:rgba(255,88,88,0.15);
                                   border:1px solid rgba(255,88,88,0.4);border-radius:5px;
                                   color:#ff5858;font-size:0.68rem;cursor:pointer;font-weight:700;">
                            🗑️
                        </button>
                    </div>
                </div>
                <!-- Contadores por rol -->
                <div style="background:rgba(0,0,0,0.15);">
                    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0.9rem;border-bottom:1px solid rgba(255,255,255,0.03);">
                        <span style="font-size:0.8rem;">🏅</span>
                        <span style="flex:1;font-size:0.75rem;color:#cdd9e5;">Administradores de Club</span>
                        <span style="font-size:0.75rem;font-weight:700;color:${adminCount>0?'#58a6ff':'#4d5566'};">${adminCount}</span>
                        <span style="font-size:0.68rem;color:#4d5566;">/ 1</span>
                        <div style="width:60px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;"></div>
                    </div>
                    ${slotBar('director',    '📋', 'Directores Deportivos',   '#f0883e')}
                    ${slotBar('coordinator', '🎯', 'Coordinadores',           '#d2a8ff')}
                    ${slotBar('user',        '⚙️', 'Entrenadores',            '#58a6ff')}
                    ${slotBar('parent',      '👨‍👩‍👧', 'Padres / Madres / Tutores','#79c0ff')}
                </div>
                <!-- Detalle usuarios (colapsable) -->
                <details>
                    <summary style="padding:0.5rem 0.9rem;cursor:pointer;font-size:0.75rem;color:#8b949e;
                                    list-style:none;display:flex;align-items:center;gap:0.4rem;user-select:none;
                                    border-top:1px solid rgba(255,255,255,0.05);">
                        <span>▾</span> Ver usuarios (${vis.length})
                    </summary>
                    ${(function(){const _ex=_expandClubUsers(vis,c.id);return _ex.length?window.renderCategoryTreeReadOnly(_ex,{mode:'club'}):'<p style="margin:0;padding:0.6rem 0.9rem;color:#8b949e;font-size:0.8rem;">Sin usuarios asignados.</p>';})()}
                </details>
            </div>`;
        });
        if (orphans.length) {
            html += `<div style="margin-bottom:1rem;border:1px solid rgba(255,215,0,0.2);border-radius:10px;overflow:hidden;"><div style="background:rgba(255,215,0,0.07);padding:0.6rem 0.9rem;"><span style="font-weight:700;color:#ffd700;font-size:0.9rem;">⚠️ Sin club asignado (${orphans.length})</span></div><div>${orphans.map(u=>renderRow(u,'')).join('')}</div></div>`;
        }
        if (!html) html = `<p style="color:#8b949e;text-align:center;padding:2rem;">Sin clubes creados aún. Usa <strong>+ Crear Club</strong> para empezar.</p>`;
        const clubsDiv = document.createElement('div');
        clubsDiv.innerHTML = html;
        body.appendChild(clubsDiv);
    } catch (e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</p>`;
        console.error('[saClubs]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// PESTAÑA INDIVIDUALES (saIndividuals / saActivateIndividual / saAssignOrphanToEntity)
// Extraídas a js/admin/superadmin/individuals-tab.js (auditoría 2026-07-22, 2026-07-25).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// saSecretary() Y ENVÍO DE INVITACIONES (Secretaría)
// Extraídas a js/admin/superadmin/secretary.js (auditoría 2026-07-22, 2026-07-25).
// ═══════════════════════════════════════════════════════════════════

// Aprobación rápida paso 1 desde vista de clubes
window.saQuickApprove = async function(uid, email, clubId) {
    // CRITICAL FIX: Check if user is under an individual entity
    // Individual entity users should be activated directly (no club admin confirmation needed)
    _saShowSpinner('Aprobando…');
    try {
        const { db, doc, getDoc, updateDoc } = await saFS();
        const me = window._cronosCurrentUser?.email || 'superadmin';

        // Check if user belongs to an individual entity
        const uSnap = await getDoc(doc(db, 'users', uid));
        if (!uSnap.exists()) { _saHideSpinner(); _saToast('⚠️ Usuario no encontrado', 3000); return; }
        const uData = uSnap.data();
        const isUnderIndividual = !!(uData.individualEntityId || uData.individualOwnerId)
            || (uData.clubId && (await getDoc(doc(db, 'clubs', uData.clubId))).data()?.type === 'individual');

        if (isUnderIndividual) {
            // User under individual entity → SA approval is definitive → activate directly
            if (!confirm(`Aprobar y activar directamente:\n${email}\n\n(Usuario bajo entidad individual — activación inmediata)`)) {
                _saHideSpinner(); return;
            }
            const updAllRoles = (uData.allRoles||[]).map(r => ({...r, isAuthorized:true, status:'active'}));
            const _indEntityId = uData.individualEntityId || uData.individualOwnerId || uData.clubId || null;
            const updateObj = {
                isAuthorized: true, status: 'active',
                allRoles: updAllRoles,
                approvedBySA: true,
                approvedBySAAt: new Date().toISOString(),
                approvedBySABy: me,
                authorizedAt: new Date().toISOString(),
                authorizedBy: me,
            };
            if (_indEntityId) {
                updateObj.individualEntityId = _indEntityId;
                updateObj.individualOwnerId = _indEntityId;
                if (!uData.clubId) updateObj.clubId = _indEntityId;
            }
            await updateDoc(doc(db, 'users', uid), updateObj);

            // FIX CRÍTICO: Si el usuario aprobado es admin individual, actualizar hasAdmin en la entidad
            const _isAdminIndividual = uData.role === 'individual' || uData.role === 'admin_individual'
                || (updAllRoles.some(r => (r.role === 'individual' || r.role === 'admin_individual') && r.isAuthorized));
            if (_isAdminIndividual && _indEntityId) {
                try {
                    await updateDoc(doc(db, 'clubs', _indEntityId), {
                        hasAdmin: true,
                        adminUid: uid,
                        adminEmail: uData.email || email,
                        adminName: uData.displayName || uData.firstName || email,
                    });
                } catch(entErr) {
                    console.warn('[saQuickApprove] Error setting hasAdmin:', entErr.message);
                    // Intentar en colección 'individuals' como fallback
                    try {
                        await updateDoc(doc(db, 'individuals', _indEntityId), {
                            hasAdmin: true,
                            adminUid: uid,
                            adminEmail: uData.email || email,
                            adminName: uData.displayName || uData.firstName || email,
                        });
                    } catch(_) {}
                }
            }

            _saHideSpinner();
            _saToast(`✅ ${email} activado directamente (usuario individual).`, 5000);
        } else {
            // User under club → Club Admin must confirm
            if (!confirm(`Aprobar (paso 1/2 — SA):\n${email}\n\nEl Club Admin deberá confirmar después.`)) {
                _saHideSpinner(); return;
            }
            await updateDoc(doc(db, 'users', uid), {
                status:'pending_club', approvedBySA:true,
                approvedBySAAt:new Date().toISOString(),
                approvedBySABy: me,
            });
            _saHideSpinner();
            _saToast(`✅ ${email} aprobado. El Club Admin debe confirmar el acceso.`, 5000);
        }
        saClubs();
    } catch (e) { _saHideSpinner(); _saToast('⚠️ '+e.message,4000); }
};

// ═══════════════════════════════════════════════════════════════════
// saRequests() — tres fuentes unificadas
// ═══════════════════════════════════════════════════════════════════

// ── Helper compartido: cuenta las solicitudes pendientes que ve el SA ──
// Usa EXACTAMENTE las mismas 6 fuentes y la misma deduplicación que
// saRequests(), para que el badge del tab nunca se desincronice del panel.
window.saCountPendingRequests = async function saCountPendingRequests() {
    try {
        const { db, collection, query, where, getDocs } = await saFS();
        const [snapD, snapD2, snapD3, snapP, snapQ, snapSucc] = await Promise.all([
            getDocs(query(collection(db,'users'),where('status','==','pending'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'users'),where('status','==','pending_sa'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'users'),where('status','==','pending_individual'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'platform_requests'),where('status','==','pending_sa'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'platform_requests'),where('type','==','quota_increase'),where('status','==','unread'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'succession_requests'),where('status','==','pending_sa'))).catch(()=>({forEach:()=>{}})),
        ]);
        const _seen = new Set();
        let count = 0;
        const _addDirect = (d) => { if (!_seen.has(d.id)) { _seen.add(d.id); count++; } };
        snapD.forEach(_addDirect);
        snapD2.forEach(_addDirect);
        snapD3.forEach(d => {
            const u = d.data();
            if (u.individualEntityId || u.individualOwnerId || u.isIndividual
                || u.role === 'individual' || u.role === 'admin_individual') {
                _addDirect(d);
            }
        });
        snapP.forEach(d => {
            const r = d.data();
            if ((r.type === 'self_registration' || r.type === 'ind_admin_registration')
                && (r.requestedRole === 'club_admin' || r.requestedRole === 'individual')) {
                return; // ya contado como direct_user
            }
            count++;
        });
        snapQ.forEach(() => count++);
        snapSucc.forEach(() => count++);
        return count;
    } catch (_) { return 0; }
};

window.saRequests = async function saRequests() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center;padding:2.5rem;color:#8b949e;"><div style="font-size:1.6rem;">⏳</div>Cargando solicitudes…</div>`;
    try {
        const { db, collection, query, where, getDocs, orderBy } = await saFS();
        // FIX: Buscar TAMBIÉN users con status 'pending_individual' (sub-usuarios de ente individual
        // que aún no han sido reenviados) y 'pending_club_admin' (usuarios que necesitan club admin)
        // para dar visibilidad completa al SA.
        const [snapD, snapD2, snapD3, snapP, snapQ, snapSucc] = await Promise.all([
            getDocs(query(collection(db,'users'),where('status','==','pending'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'users'),where('status','==','pending_sa'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'users'),where('status','==','pending_individual'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'platform_requests'),where('status','==','pending_sa'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'platform_requests'),where('type','==','quota_increase'),where('status','==','unread'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'succession_requests'),where('status','==','pending_sa'))).catch(()=>({forEach:()=>{}})),
        ]);

        const directUsers=[], platformReqs=[], quotaReqs=[], successionReqs=[];
        const _seenIds = new Set();
        const _addDirect = (d) => {
            if (!_seenIds.has(d.id)) { _seenIds.add(d.id); directUsers.push({id:d.id,...d.data()}); }
        };
        snapD.forEach(_addDirect);
        snapD2.forEach(_addDirect);
        // pending_individual: solo incluir si pertenecen a un ente individual (para visibilidad del SA)
        snapD3.forEach(d => {
            const u = d.data();
            // Solo mostrar en SA si son de ente individual (no de club)
            if (u.individualEntityId || u.individualOwnerId || u.isIndividual
                || u.role === 'individual' || u.role === 'admin_individual') {
                _addDirect(d);
            }
        });
        snapP.forEach(d => {
            const r = d.data();
            // FIX: No incluir platform_requests de tipo 'self_registration' o 'ind_admin_registration'
            // con roles club_admin/individual porque esos usuarios ya aparecen en la sección
            // de "Registros pendientes" directos (buscamos users.status=='pending_sa'). Evitar duplicados.
            if ((r.type === 'self_registration' || r.type === 'ind_admin_registration')
                && (r.requestedRole === 'club_admin' || r.requestedRole === 'individual')) {
                return; // Skip — ya aparece como direct_user
            }
            platformReqs.push({id:d.id,...r});
        });
        snapQ.forEach(d => quotaReqs.push({id:d.id,...d.data()}));
        snapSucc.forEach(d => successionReqs.push({id:d.id,...d.data()}));

        if (!directUsers.length && !platformReqs.length && !quotaReqs.length && !successionReqs.length) {
            body.innerHTML = `<div style="text-align:center;padding:3rem;color:#8b949e;"><div style="font-size:2.5rem;margin-bottom:0.5rem;">✅</div>Sin solicitudes pendientes.</div>`;
            return;
        }

        const fmt = iso => iso ? new Date(iso).toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '–';

        const buildCard = (item, srcType) => {
            const isDirect = srcType === 'direct';
            const role  = isDirect ? (item.role||item.requestedRole||'user') : (item.requestedRole||'user');
            const meta  = window.ROLE_META[role] || { icon:'👤', color:'#8b949e', label:role };
            const email = isDirect ? item.email : item.requestedEmail;
            const club  = item.requestedClubName || item.clubName || '–';
            const name  = isDirect
                ? (item.displayName || [item.firstName,item.lastName].filter(Boolean).join(' ') || '–')
                : (item.requestedName || '–');

            let extraRows = '';
            if (role === 'club_admin' && item.requestedQuotas) {
                const q = item.requestedQuotas;
                const parts = [
                    q.directors    ? `${q.directors} Dir.`    : '',
                    q.coordinators ? `${q.coordinators} Coord.` : '',
                    q.coaches      ? `${q.coaches} Entr.`     : '',
                    q.parents      ? `${q.parents} Padres`    : '',
                ].filter(Boolean).join(' · ');
                extraRows += `<div style="grid-column:1/-1;"><div style="color:#8b949e;font-size:0.67rem;">Cuotas pedidas</div><div style="color:white;font-size:0.8rem;">${parts||'–'}</div></div>`;
            }
            if (item.playerNumber) {
                extraRows += `<div><div style="color:#8b949e;font-size:0.67rem;">Dorsal jugador</div><div style="color:white;">#${item.playerNumber}${item.playerAlias?' · '+(typeof escapeHtml==='function'?escapeHtml(item.playerAlias):item.playerAlias):''}</div></div>`;
            }

            const approveCall = isDirect
                ? `saApproveRequest('${item.id}','direct_user',true)`
                : `saApproveRequest('${item.id}','user_request',true)`;
            const rejectCall  = isDirect
                ? `saApproveRequest('${item.id}','direct_user',false)`
                : `saApproveRequest('${item.id}','user_request',false)`;
            const borderRGB = isDirect ? '255,215,0' : '88,166,255';

            return `
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(${borderRGB},0.25);border-radius:9px;padding:0.85rem;margin-bottom:0.6rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span style="font-size:1.3rem;">${meta.icon}</span>
                        <div>
                            <div style="font-weight:700;font-size:0.88rem;color:${meta.color};">${meta.label}</div>
                            <div style="font-size:0.7rem;color:#8b949e;">${isDirect ? (role==='club_admin'||role==='individual' ? 'Aprobación directa SA' : 'Registro — SA confirma') : (item.type === 'ind_admin_registration' ? 'Registro Admin Individual' : item.type === 'ind_sub_registration' ? 'Reenviado por Admin Individual' : 'Reenviado por Club Admin')}</div>
                        </div>
                    </div>
                    <span style="font-size:0.68rem;color:#8b949e;background:rgba(255,255,255,0.06);padding:2px 7px;border-radius:5px;">${fmt(item.createdAt)}</span>
                </div>
                <div style="background:rgba(255,255,255,0.03);padding:0.55rem 0.65rem;border-radius:7px;margin-bottom:0.6rem;display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;font-size:0.82rem;">
                    <div><div style="color:#8b949e;font-size:0.67rem;">Email</div><div style="color:white;font-weight:600;word-break:break-all;">${typeof escapeHtml==='function'?escapeHtml(email||'–'):(email||'–')}</div></div>
                    <div><div style="color:#8b949e;font-size:0.67rem;">Club</div><div style="color:white;font-weight:600;">${typeof escapeHtml==='function'?escapeHtml(club):club}</div></div>
                    ${name&&name!=='–'?`<div style="grid-column:1/-1;"><div style="color:#8b949e;font-size:0.67rem;">Nombre</div><div style="color:white;">${typeof escapeHtml==='function'?escapeHtml(name):name}</div></div>`:''}
                    ${extraRows}
                </div>
                <div style="display:flex;gap:0.5rem;">
                    <button onclick="${approveCall}" style="flex:1;padding:0.45rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:6px;color:#3fb950;font-weight:700;cursor:pointer;font-size:0.81rem;">✅ APROBAR</button>
                    <button onclick="${rejectCall}"  style="flex:1;padding:0.45rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:6px;color:#ff5858;font-weight:700;cursor:pointer;font-size:0.81rem;">❌ RECHAZAR</button>
                </div>
            </div>`;
        };

        let html = '';

        if (directUsers.length) {
            html += `
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                <h3 style="margin:0;font-size:0.88rem;color:#ffd700;">🔔 Registros pendientes de aprobación SA</h3>
                <span style="background:rgba(255,215,0,0.15);color:#ffd700;padding:1px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;">${directUsers.length}</span>
            </div>
            <p style="font-size:0.72rem;color:#8b949e;margin:0 0 0.8rem;background:rgba(255,215,0,0.05);padding:0.5rem 0.7rem;border-radius:7px;border:1px solid rgba(255,215,0,0.15);">
                ℹ️ Administradores de club e individuales: tu aprobación es definitiva y activa al usuario al instante.
                Entrenadores y otros roles: al aprobar podrán completar el registro; el Admin del Club confirmará el acceso final.
            </p>
            ${directUsers.map(u => buildCard(u,'direct')).join('')}
            <div style="margin-bottom:1.4rem;"></div>`;
        }

        if (platformReqs.length) {
            const hasIndivReqs = platformReqs.some(r => r.type === 'ind_sub_registration');
            html += `
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                <h3 style="margin:0;font-size:0.88rem;color:#58a6ff;">📩 Solicitudes reenviadas</h3>
                <span style="background:rgba(88,166,255,0.15);color:#58a6ff;padding:1px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;">${platformReqs.length}</span>
            </div>
            <p style="font-size:0.72rem;color:#8b949e;margin:0 0 0.8rem;background:rgba(88,166,255,0.05);padding:0.5rem 0.7rem;border-radius:7px;border:1px solid rgba(88,166,255,0.15);">
                ℹ️ Al aprobar, el usuario queda activo inmediatamente. ${hasIndivReqs ? 'Las solicitudes de <strong>Admin Individual</strong> se activan directamente (sin paso extra del club).' : 'El Club Admin confirmará su acceso final.'}
            </p>
            ${platformReqs.map(r => buildCard(r,'platform')).join('')}
            <div style="margin-bottom:1.4rem;"></div>`;
        }

        if (quotaReqs.length) {
            html += `
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                <h3 style="margin:0;font-size:0.88rem;color:#f0883e;">📈 Ampliaciones de cuota</h3>
                <span style="background:rgba(240,136,62,0.15);color:#f0883e;padding:1px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;">${quotaReqs.length}</span>
            </div>
            ${quotaReqs.map(r => {
                const meta = window.ROLE_META[r.role] || { icon:'👤', color:'#8b949e', label:r.role };
                return `
                <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(240,136,62,0.25);border-radius:9px;padding:0.85rem;margin-bottom:0.6rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
                        <div>
                            <div style="font-weight:700;color:#f0883e;font-size:0.88rem;">${typeof escapeHtml==='function'?escapeHtml(r.clubName||r.clubId||'–'):(r.clubName||r.clubId||'–')}</div>
                            <div style="font-size:0.7rem;color:#8b949e;">${meta.icon} ${meta.label} · Solicita +${r.requestedExtra||1} plaza(s)</div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.3rem;font-size:0.75rem;text-align:center;">
                            <div style="background:rgba(255,255,255,0.04);padding:0.3rem 0.5rem;border-radius:5px;">
                                <div style="color:#8b949e;font-size:0.62rem;">Actual</div>
                                <div style="color:white;font-weight:700;">${r.currentUsed||0}/${r.currentMax===-1?'∞':(r.currentMax||0)}</div>
                            </div>
                            <div style="background:rgba(240,136,62,0.12);padding:0.3rem 0.5rem;border-radius:5px;">
                                <div style="color:#8b949e;font-size:0.62rem;">Solicita</div>
                                <div style="color:#f0883e;font-weight:700;">+${r.requestedExtra||1}</div>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button onclick="saApproveRequest('${r.id}','quota_increase',true)" style="flex:1;padding:0.42rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:6px;color:#3fb950;font-weight:700;cursor:pointer;font-size:0.8rem;">✅ APROBAR</button>
                        <button onclick="saApproveRequest('${r.id}','quota_increase',false)" style="flex:1;padding:0.42rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:6px;color:#ff5858;font-weight:700;cursor:pointer;font-size:0.8rem;">❌ RECHAZAR</button>
                    </div>
                </div>`;
            }).join('')}`;
        }

        if (successionReqs.length) {
            const _esc = typeof escapeHtml === 'function' ? escapeHtml : (s => s);
            html += `
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                <h3 style="margin:0;font-size:0.88rem;color:#d2a8ff;">🔄 Sucesiones de Admin de Club</h3>
                <span style="background:rgba(210,168,255,0.15);color:#d2a8ff;padding:1px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;">${successionReqs.length}</span>
            </div>
            <p style="font-size:0.72rem;color:#8b949e;margin:0 0 0.8rem;background:rgba(210,168,255,0.05);padding:0.5rem 0.7rem;border-radius:7px;border:1px solid rgba(210,168,255,0.15);">
                ⚠️ Al aprobar: el nuevo admin toma el control del club, el admin saliente se elimina (Firestore + Auth). Los usuarios del club no se ven afectados.
            </p>
            ${successionReqs.map(sr => {
                const typeLabel = sr.successorType === 'existing' ? '👥 Miembro existente' : '✉️ Persona nueva';
                return `
                <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(210,168,255,0.25);border-radius:9px;padding:0.85rem;margin-bottom:0.6rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
                        <div>
                            <div style="font-weight:700;font-size:0.88rem;color:#d2a8ff;">🏟️ ${_esc(sr.clubName||sr.clubId||'Club')}</div>
                            <div style="font-size:0.7rem;color:#8b949e;">${typeLabel}</div>
                        </div>
                        <span style="font-size:0.68rem;color:#8b949e;background:rgba(255,255,255,0.06);padding:2px 7px;border-radius:5px;">${sr.createdAt?.toDate ? sr.createdAt.toDate().toLocaleDateString('es-ES') : (sr.createdAt ? new Date(sr.createdAt).toLocaleDateString('es-ES') : '–')}</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.03);padding:0.55rem 0.65rem;border-radius:7px;margin-bottom:0.6rem;display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;font-size:0.82rem;">
                        <div><div style="color:#8b949e;font-size:0.67rem;">Admin saliente</div><div style="color:#ff5858;font-weight:600;word-break:break-all;">${_esc(sr.outgoingAdminEmail||'–')}</div></div>
                        <div><div style="color:#8b949e;font-size:0.67rem;">Nuevo admin</div><div style="color:#3fb950;font-weight:600;word-break:break-all;">${_esc(sr.successorEmail||'–')}</div></div>
                        ${sr.successorName ? `<div style="grid-column:1/-1;"><div style="color:#8b949e;font-size:0.67rem;">Nombre sucesor</div><div style="color:white;">${_esc(sr.successorName)}</div></div>` : ''}
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button onclick="saApproveRequest('${sr.id}','club_admin_succession',true)" style="flex:1;padding:0.45rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:6px;color:#3fb950;font-weight:700;cursor:pointer;font-size:0.81rem;">✅ APROBAR SUCESIÓN</button>
                        <button onclick="saApproveRequest('${sr.id}','club_admin_succession',false)" style="flex:1;padding:0.45rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:6px;color:#ff5858;font-weight:700;cursor:pointer;font-size:0.81rem;">❌ RECHAZAR</button>
                    </div>
                </div>`;
            }).join('')}`;
        }

        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</p>`;
        console.error('[saRequests]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// saApproveRequest()
// ═══════════════════════════════════════════════════════════════════

window.saApproveRequest = async function saApproveRequest(id, type, approve) {
    if (!confirm(`¿${approve?'Aprobar':'Rechazar'} esta solicitud?`)) return;
    _saShowSpinner(approve?'Aprobando…':'Rechazando…');
    try {
        const { db, fa, doc, getDoc, setDoc, updateDoc, httpsCallable } = await saFS();
        const me = window._cronosCurrentUser?.email || 'superadmin';

        if (type === 'direct_user') {
            const uSnap = await getDoc(doc(db,'users',id));
            if (!uSnap.exists()) throw new Error('Usuario no encontrado');
            const u = uSnap.data();
            if (approve) {
                if (u.role === 'club_admin' && u.requestedClubName) {
                    const clubId = 'club_' + Date.now().toString(36);
                    const q = u.requestedQuotas || {};
                    await setDoc(doc(db,'clubs',clubId), {
                        name:u.requestedClubName, adminEmail:u.email, adminUid:id,
                        plan:'free', status:'active',
                        slots:{ directors:q.directors||1, coordinators:q.coordinators||2, users:q.coaches||10, parents:q.parents||20 },
                        usedSlots:{ directors:0, coordinators:0, users:0, parents:0 },
                        createdAt:new Date().toISOString(), approvedBy:me,
                    });
                    // Actualizar allRoles con clubId correcto y activar
                    const updRoles = (u.allRoles||[]).map(r =>
                        r.role==='club_admin'
                            ? {...r, isAuthorized:true, status:'active', clubId, clubName:u.requestedClubName}
                            : r
                    );
                    const finalRoles = updRoles.some(r => r.role==='club_admin') ? updRoles : [
                        ...updRoles,
                        {role:'club_admin', isAuthorized:true, status:'active', clubId, clubName:u.requestedClubName}
                    ];
                    await updateDoc(doc(db,'users',id), {
                        isAuthorized:true, status:'active',
                        clubId, clubName:u.requestedClubName,
                        allRoles: finalRoles,
                        authorizedAt:new Date().toISOString(), authorizedBy:me,
                    });
                    // FIX (claims): asignar el custom claim 'clubId' + role al
                    // token del nuevo club_admin para que las reglas de Firestore
                    // (sameClubAsDoc) le concedan acceso sin depender del fallback.
                    // No bloquea la aprobación si falla (la Opción B lo cubre).
                    try {
                        if (httpsCallable && fa.functions) {
                            await httpsCallable(fa.functions, 'setCustomClaims')({
                                uid: id, role: 'club_admin', clubId,
                            });
                        } else {
                            console.warn('[saApprove] Functions no disponible; claims no asignados (fallback de reglas activo).');
                        }
                    } catch (claimErr) {
                        console.warn('[saApprove] setCustomClaims falló (continúa con fallback de reglas):', claimErr.message);
                    }
                    _saHideSpinner();
                    _saToast(`✅ Club "${u.requestedClubName}" creado y ${u.email} activado como Administrador.`, 6000);
                } else if (u.role === 'individual' || u.role === 'admin_individual') {
                    const updAllRolesInd = (u.allRoles||[]).map(r =>
                        (r.role==='individual' || r.role==='admin_individual') ? {...r, isAuthorized:true, status:'active', role:'individual'} : r
                    );
                    // Obtener el individualEntityId/clubId del usuario
                    const _indEntityId = u.individualEntityId || u.clubId || null;
                    const _updateUserObj = {
                        role: 'individual', // normalizar
                        isAuthorized:true, status:'active',
                        allRoles: updAllRolesInd,
                        authorizedAt:new Date().toISOString(), authorizedBy:me,
                    };
                    // Asegurar que clubId e individualEntityId estén seteados
                    if (_indEntityId) {
                        _updateUserObj.clubId = _indEntityId;
                        _updateUserObj.individualEntityId = _indEntityId;
                        _updateUserObj.individualOwnerId = _indEntityId;
                    }
                    await updateDoc(doc(db,'users',id), _updateUserObj);
                    // Actualizar la entidad individual: marcar hasAdmin=true
                    if (_indEntityId) {
                        try {
                            await updateDoc(doc(db,'clubs',_indEntityId), {
                                hasAdmin: true,
                                adminUid: id,
                                adminEmail: u.email,
                                adminName: u.displayName || u.firstName || u.email,
                            });
                        } catch(entErr) { console.warn('[saApproveRequest] Error setting hasAdmin:', entErr.message); }
                    }
                    // FIX (C2): Asignar custom claims al admin individual para que
                    // las reglas de Firestore (sameClubAsDoc) le concedan acceso.
                    try {
                        if (httpsCallable && fa.functions) {
                            await httpsCallable(fa.functions, 'setCustomClaims')({
                                uid: id, role: 'individual', clubId: _indEntityId || null,
                            });
                        } else {
                            console.warn('[saApprove] Functions no disponible; claims no asignados (fallback de reglas activo).');
                        }
                    } catch (claimErr) {
                        console.warn('[saApprove] setCustomClaims falló para individual (continúa con fallback de reglas):', claimErr.message);
                    }
                    // FIX: Marcar platform_requests del admin individual como aprobadas
                    try {
                        const { collection, getDocs, query, where, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                        const adminPRs = await getDocs(query(
                            collection(db,'platform_requests'),
                            where('userUid','==',id),
                            where('status','==','pending_sa')
                        ));
                        const _batch = [];
                        adminPRs.forEach(prDoc => {
                            _batch.push(updateDoc(doc(db,'platform_requests',prDoc.id), {
                                status:'sa_approved',
                                approvedAt: new Date().toISOString(),
                                approvedBy: me
                            }));
                        });
                        await Promise.all(_batch).catch(()=>{});
                    } catch(prErr) { console.warn('[saApproveRequest] Error marking platform_requests:', prErr.message); }
                    _saHideSpinner();
                    _saToast(`✅ ${u.email} activado como Administrador Individual.`, 5000);
                } else {
                    // FIX: Si el usuario pertenece a una entidad individual (tiene individualEntityId o individualOwnerId),
                    // la aprobación del SA es definitiva → status:'active'.
                    // Si pertenece a un club normal, el Club Admin debe confirmar → status:'pending_club'.
                    const _isUnderIndividual = !!(u.individualEntityId || u.individualOwnerId);
                    if (_isUnderIndividual) {
                        // Usuario bajo entidad individual → SA aprueba definitivamente
                        const updRolesOther = (u.allRoles||[]).map(r =>
                            ({...r, isAuthorized:true, status:'active'})
                        );
                        const _indEntityIdOther = u.individualEntityId || u.individualOwnerId || u.clubId || null;
                        const _updateObj = {
                            isAuthorized:true, status:'active',
                            allRoles: updRolesOther,
                            authorizedAt:new Date().toISOString(), authorizedBy:me,
                        };
                        if (_indEntityIdOther) {
                            _updateObj.individualEntityId = _indEntityIdOther;
                            _updateObj.individualOwnerId = _indEntityIdOther;
                            if (!u.clubId) _updateObj.clubId = _indEntityIdOther;
                        }
                        await updateDoc(doc(db,'users',id), _updateObj);
                        // FIX (C2): Asignar custom claims a usuarios bajo entidad individual
                        try {
                            if (httpsCallable && fa.functions && _indEntityIdOther) {
                                await httpsCallable(fa.functions, 'setCustomClaims')({
                                    uid: id, role: u.role || 'user', clubId: _indEntityIdOther,
                                });
                            }
                        } catch (claimErr2) {
                            console.warn('[saApprove] setCustomClaims falló para usuario individual (continúa con fallback):', claimErr2.message);
                        }
                        _saHideSpinner();
                        _saToast(`✅ ${u.email} activado directamente (usuario individual).`, 5000);
                    } else {
                        // Usuario bajo club normal → Club Admin debe confirmar
                        await updateDoc(doc(db,'users',id), {
                            status:'pending_club', approvedBySA:true,
                            approvedBySAAt:new Date().toISOString(), approvedBySABy:me,
                        });
                        _saHideSpinner();
                        _saToast(`✅ ${u.email} aprobado. El Club Admin debe confirmar el acceso.`, 5000);
                    }
                }
            } else {
                await updateDoc(doc(db,'users',id), {
                    isAuthorized:false, status:'rejected',
                    rejectedAt:new Date().toISOString(), rejectedBy:me,
                });
                _saHideSpinner();
                _saToast('❌ Solicitud rechazada.', 3000);
            }

        } else if (type === 'user_request') {
            const rSnap = await getDoc(doc(db,'platform_requests',id));
            if (!rSnap.exists()) throw new Error('Solicitud no encontrada');
            const r = rSnap.data();
            if (approve) {

                // ── club_admin: crear el club y activar usuario existente ──
                if (r.requestedRole === 'club_admin' && r.requestedClubName && r.userUid) {
                    const newClubId = 'club_' + Date.now().toString(36);
                    const q = r.requestedQuotas || {};
                    await setDoc(doc(db,'clubs',newClubId), {
                        name: r.requestedClubName, adminEmail: r.requestedEmail, adminUid: r.userUid,
                        plan:'free', status:'active',
                        slots:{ directors:q.directors||1, coordinators:q.coordinators||2, users:q.coaches||10, parents:q.parents||20 },
                        usedSlots:{ directors:0, coordinators:0, users:0, parents:0 },
                        createdAt:new Date().toISOString(), approvedBy:me,
                    });
                    // Activar el usuario existente
                    const uSnap2 = await getDoc(doc(db,'users',r.userUid)).catch(()=>null);
                    if (uSnap2 && uSnap2.exists()) {
                        const uData2 = uSnap2.data();
                        const updRoles2 = (uData2.allRoles||[]).map(role =>
                            role.role==='club_admin'
                                ? {...role, isAuthorized:true, status:'active', clubId:newClubId, clubName:r.requestedClubName}
                                : role
                        );
                        const finalRoles2 = updRoles2.length > 0 ? updRoles2 : [{
                            role:'club_admin', isAuthorized:true, status:'active',
                            clubId:newClubId, clubName:r.requestedClubName
                        }];
                        await updateDoc(doc(db,'users',r.userUid), {
                            isAuthorized:true,
                            clubId:newClubId, clubName:r.requestedClubName,
                            allRoles: finalRoles2,
                            authorizedAt:new Date().toISOString(), authorizedBy:me,
                        });
                    }
                    await updateDoc(doc(db,'platform_requests',id), { status:'sa_approved', approvedAt:new Date().toISOString(), approvedBy:me });
                    // FIX (C2): Asignar custom claims al club_admin (vía user_request)
                    try {
                        if (httpsCallable && fa.functions) {
                            await httpsCallable(fa.functions, 'setCustomClaims')({
                                uid: r.userUid, role: 'club_admin', clubId: newClubId,
                            });
                        }
                    } catch (claimErrCA) {
                        console.warn('[saApprove] setCustomClaims falló para club_admin (user_request):', claimErrCA.message);
                    }
                    _saHideSpinner();
                    _saToast(`✅ Club "${r.requestedClubName}" creado y ${r.requestedEmail} activado como Administrador.`, 6000);

                // ── individual: activar usuario como Administrador Individual ──
                } else if ((r.requestedRole === 'individual' || r.requestedRole === 'admin_individual') && r.userUid) {
                    const uSnap3 = await getDoc(doc(db,'users',r.userUid)).catch(()=>null);
                    if (uSnap3 && uSnap3.exists()) {
                        const uData3 = uSnap3.data();
                        const updRoles3 = (uData3.allRoles||[]).map(role =>
                            (role.role==='individual' || role.role==='admin_individual') ? {...role, isAuthorized:true, status:'active', role:'individual'} : role
                        );
                        // Obtener el individualEntityId/clubId del usuario o de la request
                        const _indEntityId3 = uData3.individualEntityId || uData3.clubId || r.individualOwnerId || r.clubId || null;
                        const _updateUser3 = {
                            role: 'individual', // normalizar
                            isAuthorized:true, status:'active',
                            allRoles:updRoles3,
                            authorizedAt:new Date().toISOString(), authorizedBy:me,
                        };
                        // Asegurar que clubId e individualEntityId estén seteados
                        if (_indEntityId3) {
                            _updateUser3.clubId = _indEntityId3;
                            _updateUser3.individualEntityId = _indEntityId3;
                            _updateUser3.individualOwnerId = _indEntityId3;
                        }
                        await updateDoc(doc(db,'users',r.userUid), _updateUser3);
                        // Actualizar la entidad individual: marcar hasAdmin=true
                        if (_indEntityId3) {
                            try {
                                await updateDoc(doc(db,'clubs',_indEntityId3), {
                                    hasAdmin: true,
                                    adminUid: r.userUid,
                                    adminEmail: r.requestedEmail || uData3.email,
                                    adminName: uData3.displayName || uData3.firstName || r.requestedEmail,
                                });
                            } catch(entErr3) { console.warn('[saApproveRequest] Error setting hasAdmin:', entErr3.message); }
                        }
                    }
                    // FIX (C2): Asignar custom claims al admin individual (vía user_request)
                    try {
                        if (httpsCallable && fa.functions) {
                            await httpsCallable(fa.functions, 'setCustomClaims')({
                                uid: r.userUid, role: 'individual', clubId: _indEntityId3 || null,
                            });
                        }
                    } catch (claimErr3) {
                        console.warn('[saApprove] setCustomClaims falló para individual (user_request):', claimErr3.message);
                    }
                    await updateDoc(doc(db,'platform_requests',id), { status:'sa_approved', approvedAt:new Date().toISOString(), approvedBy:me });
                    _saHideSpinner();
                    _saToast(`✅ ${r.requestedEmail} activado como Administrador Individual.`, 5000);

                // ── otros roles: activar usuario existente si tiene userUid ──
                } else if (r.userUid) {
                    // Usuario existente — activar su nuevo rol en allRoles
                    const uSnap4 = await getDoc(doc(db,'users',r.userUid)).catch(()=>null);
                    if (uSnap4 && uSnap4.exists()) {
                        const uData4 = uSnap4.data();

                        // Actualizar allRoles: marcar el rol aprobado como activo
                        let updRoles4 = (uData4.allRoles||[]).map(r4 => {
                            const isMatch = r4.role === r.requestedRole && (
                                (r4.clubId||null) === (r.clubId||null) ||
                                (r4.individualEntityId||null) === (r.individualOwnerId||null) ||
                                (r4.clubId||null) === (r.individualOwnerId||null)
                            );
                            return isMatch
                                ? {...r4, isAuthorized:true, status:'active',
                                   clubId: r.clubId || r4.clubId || r.individualOwnerId || null,
                                   clubName: r.clubName || r4.clubName || ''}
                                : r4;
                        });
                        // Si el rol no estaba en allRoles, añadirlo
                        const alreadyHas = updRoles4.some(r4 =>
                            r4.role === r.requestedRole && (
                                (r4.clubId||null) === (r.clubId||null) ||
                                (r4.individualEntityId||null) === (r.individualOwnerId||null) ||
                                (r4.clubId||null) === (r.individualOwnerId||null)
                            )
                        );
                        if (!alreadyHas) {
                            updRoles4.push({
                                role: r.requestedRole,
                                isAuthorized: true,
                                status: 'active',
                                clubId: r.clubId || r.individualOwnerId || null,
                                clubName: r.clubName || ''
                            });
                        }

                        // IMPORTANTE: NO cambiar el rol principal si el usuario
                        // ya tiene otro rol activo (multi-rol).
                        // Solo actualizar allRoles + isAuthorized + status + clubId si faltaba.
                        // CRITICAL FIX: status debe ser 'active' para que el usuario pueda entrar
                        // y para que aparezca en el panel del admin individual.
                        const updateData = {
                            isAuthorized: true,
                            status: 'active',
                            allRoles: updRoles4,
                            authorizedAt: new Date().toISOString(),
                            authorizedBy: me,
                        };
                        // Añadir clubId si el usuario no tenía ninguno
                        if (!uData4.clubId && r.clubId) {
                            updateData.clubId  = r.clubId;
                            updateData.clubName = r.clubName || '';
                        }
                        // FIX: Para usuarios bajo ente individual, asegurar que individualEntityId
                        // e individualOwnerId estén seteados para que aparezcan en el panel del admin.
                        // CRITICAL: Siempre setear estos campos si hay un entityId, incluso si ya tenían uno,
                        // para asegurar consistencia con la entidad correcta.
                        const _indEntityId = r.individualOwnerId || r.clubId || uData4.individualEntityId || uData4.clubId || null;
                        if (_indEntityId) {
                            updateData.individualEntityId = _indEntityId;
                            updateData.individualOwnerId = _indEntityId;
                            if (!uData4.clubId) updateData.clubId = _indEntityId;
                        }

                        await updateDoc(doc(db,'users',r.userUid), updateData);

                    } else {
                        // Usuario no existe aún (registro pendiente) — crear doc activo
                        // FIX: Incluir individualEntityId e individualOwnerId para usuarios bajo ente individual
                        const _newIndivEntityId = r.individualOwnerId || r.clubId || null;
                        await setDoc(doc(db,'users',r.userUid), {
                            email:       r.requestedEmail,
                            displayName: r.requestedName || '',
                            role:        r.requestedRole || 'user',
                            clubId:      r.clubId  || _newIndivEntityId || null,
                            clubName:    r.clubName || '',
                            isAuthorized: true,
                            status:      'active',
                            individualEntityId: _newIndivEntityId || null,
                            individualOwnerId:  _newIndivEntityId || null,
                            allRoles: [{
                                role:        r.requestedRole || 'user',
                                isAuthorized: true,
                                status:      'active',
                                clubId:      r.clubId  || _newIndivEntityId || null,
                                clubName:    r.clubName || '',
                                individualEntityId: _newIndivEntityId || null,
                            }],
                            approvedBySA:    true,
                            approvedBySAAt:  new Date().toISOString(),
                            approvedBySABy:  me,
                            createdAt:       new Date().toISOString(),
                        });
                    }
                    // Marcar esta y otras platform_requests del mismo usuario/rol como aprobadas
                    const allPRsForUser = await getDocs(
                        query(collection(db,'platform_requests'),
                              where('userUid','==',r.userUid))
                    ).catch(()=>null);
                    if (allPRsForUser) {
                        const batch = [];
                        allPRsForUser.forEach(prDoc => {
                            const prData = prDoc.data();
                            if (prData.requestedRole === r.requestedRole &&
                                prData.status !== 'sa_approved' &&
                                prData.status !== 'rejected') {
                                batch.push(updateDoc(doc(db,'platform_requests',prDoc.id), {
                                    status:'sa_approved',
                                    approvedAt: new Date().toISOString(),
                                    approvedBy: me
                                }));
                            }
                        });
                        await Promise.all(batch).catch(()=>{});
                    }
                    await updateDoc(doc(db,'platform_requests',id), {
                        status:'sa_approved',
                        approvedAt: new Date().toISOString(),
                        approvedBy: me
                    }).catch(()=>{});
                    // FIX (C2): Asignar custom claims a todos los roles aprobados
                    // (entrenador, director, coordinador, padre) para que las reglas
                    // de Firestore (sameClubAsDoc) les concedan acceso a informes,
                    // notificaciones y vínculos padre-jugador.
                    try {
                        if (httpsCallable && fa.functions) {
                            const _claimClubId = r.clubId || r.individualOwnerId || null;
                            await httpsCallable(fa.functions, 'setCustomClaims')({
                                uid: r.userUid,
                                role: r.requestedRole || 'user',
                                clubId: _claimClubId,
                            });
                        }
                    } catch (claimErr4) {
                        console.warn('[saApprove] setCustomClaims falló para', r.requestedRole, '(continúa con fallback):', claimErr4.message);
                    }
                    _saHideSpinner();
                    const roleLabels = {
                        user:'Entrenador', coordinator:'Coordinador',
                        director:'Director Deportivo', parent:'Padre/Madre/Tutor'
                    };
                    _saToast(`✅ ${r.requestedEmail} activado como ${roleLabels[r.requestedRole]||r.requestedRole}.`, 5000);

                // ── sin userUid: no debería ocurrir con el nuevo flujo ──
                } else {
                    _saHideSpinner();
                    _saToast('⚠️ Solicitud sin userUid — no se puede activar automáticamente.', 5000);
                    await updateDoc(doc(db,'platform_requests',id), {
                        status:'error_no_uid',
                        updatedAt: new Date().toISOString()
                    });
                }

            } else {
                await updateDoc(doc(db,'platform_requests',id), { status:'rejected', rejectedAt:new Date().toISOString(), rejectedBy:me });
                _saHideSpinner();
                _saToast('❌ Solicitud rechazada.', 3000);
            }

        } else if (type === 'quota_increase') {
            const rSnap = await getDoc(doc(db,'platform_requests',id));
            if (!rSnap.exists()) throw new Error('Solicitud no encontrada');
            const r = rSnap.data();
            if (approve) {
                const cSnap = await getDoc(doc(db,'clubs',r.clubId)).catch(()=>null);
                if (cSnap?.exists()) {
                    const slots = Object.assign({},cSnap.data().slots||{});
                    const rk = {director:'directors',coordinator:'coordinators',parent:'parents',user:'users'}[r.role]||'users';
                    if (slots[rk]!==-1) slots[rk] = (slots[rk]||0) + (r.requestedExtra||1);
                    await updateDoc(doc(db,'clubs',r.clubId),{slots});
                }
                await updateDoc(doc(db,'platform_requests',id), { status:'approved', approvedAt:new Date().toISOString(), approvedBy:me });
                _saHideSpinner();
                _saToast(`✅ Cuota ampliada +${r.requestedExtra||1} plaza(s).`, 5000);
            } else {
                await updateDoc(doc(db,'platform_requests',id), { status:'rejected', rejectedAt:new Date().toISOString(), rejectedBy:me });
                _saHideSpinner();
                _saToast('❌ Solicitud rechazada.', 3000);
            }
        } else if (type === 'club_admin_succession') {
            const { collection, getDocs, query, where, deleteDoc, httpsCallable: _httpsCallable } = await saFS();
            const srSnap = await getDoc(doc(db,'succession_requests',id));
            if (!srSnap.exists()) throw new Error('Solicitud de sucesión no encontrada');
            const sr = srSnap.data();

            if (approve) {
                // ── 1. Preparar nuevo admin ──
                let newAdminUid = sr.successorUid || null;
                let newAdminEmail = sr.successorEmail;
                let newAdminName = sr.successorName || sr.successorEmail;

                if (sr.successorType === 'existing' && sr.successorUid) {
                    // Camino A: miembro existente - añadir club_admin a allRoles
                    const uSnap = await getDoc(doc(db,'users',sr.successorUid));
                    if (!uSnap.exists()) throw new Error('Usuario sucesor no encontrado en Firestore');
                    const uData = uSnap.data();
                    newAdminEmail = uData.email || sr.successorEmail;
                    newAdminName = uData.displayName || uData.firstName || newAdminEmail;

                    // Añadir club_admin a allRoles (mantener roles existentes)
                    const updRoles = (uData.allRoles || []).filter(r =>
                        !(r.role === 'club_admin' && (r.clubId === sr.clubId || !r.clubId))
                    );
                    updRoles.push({
                        role: 'club_admin',
                        isAuthorized: true,
                        status: 'active',
                        clubId: sr.clubId,
                        clubName: sr.clubName || '',
                    });

                    await updateDoc(doc(db,'users',sr.successorUid), {
                        role: 'club_admin',
                        isAuthorized: true,
                        status: 'active',
                        clubId: sr.clubId,
                        clubName: sr.clubName || '',
                        allRoles: updRoles,
                        authorizedAt: new Date().toISOString(),
                        authorizedBy: me,
                    });

                } else {
                    // Camino B: persona nueva - crear doc pre-aprobado
                    newAdminUid = 'pre_' + Date.now().toString(36);
                    await setDoc(doc(db,'users',newAdminUid), {
                        email: sr.successorEmail,
                        displayName: sr.successorName || '',
                        role: 'club_admin',
                        clubId: sr.clubId,
                        clubName: sr.clubName || '',
                        isAuthorized: true,
                        status: 'active',
                        allRoles: [{
                            role: 'club_admin',
                            isAuthorized: true,
                            status: 'active',
                            clubId: sr.clubId,
                            clubName: sr.clubName || '',
                        }],
                        createdAt: new Date().toISOString(),
                        approvedBySA: true,
                        approvedBySAAt: new Date().toISOString(),
                        approvedBySABy: me,
                    });
                }

                // ── 2. Actualizar clubs doc ──
                await updateDoc(doc(db,'clubs',sr.clubId), {
                    adminEmail: newAdminEmail,
                    adminUid: newAdminUid,
                    adminName: newAdminName,
                });

                // ── 3. Borrar admin saliente de Firestore ──
                if (sr.outgoingAdminUid) {
                    try { await deleteDoc(doc(db,'users',sr.outgoingAdminUid)); } catch(_) {}
                    // Borrar docs secundarios del admin saliente
                    try {
                        const secSnap = await getDocs(query(collection(db,'users'), where('uid','==',sr.outgoingAdminUid)));
                        secSnap.forEach(d => { if (d.id !== sr.outgoingAdminUid) deleteDoc(doc(db,'users',d.id)).catch(()=>{}); });
                    } catch(_) {}
                }

                // ── 4. Borrar Firebase Auth del admin saliente ──
                const _fa = (await saFS()).fa;
                const _htCall = (await saFS()).httpsCallable;
                if (_htCall && _fa.functions && sr.outgoingAdminUid) {
                    try {
                        await _htCall(_fa.functions, 'deleteAuthUser')({ uid: sr.outgoingAdminUid, email: sr.outgoingAdminEmail });
                    } catch (cfErr) {
                        console.warn('[saApproveRequest:succession] deleteAuthUser falló:', cfErr.message);
                    }
                }

                // ── 5. Marcar sucesión como completada ──
                await updateDoc(doc(db,'succession_requests',id), {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    completedBy: me,
                });

                _saHideSpinner();
                _saToast(`✅ Sucesión completada. ${newAdminEmail} es el nuevo admin de "${sr.clubName}".`, 7000);

            } else {
                // Rechazar sucesión
                await updateDoc(doc(db,'succession_requests',id), {
                    status: 'rejected',
                    rejectedAt: new Date().toISOString(),
                    rejectedBy: me,
                });
                _saHideSpinner();
                _saToast('❌ Solicitud de sucesión rechazada.', 3000);
            }

        }
        saRequests();
    } catch (e) {
        _saHideSpinner();
        _saToast('⚠️ Error: '+e.message, 5000);
        console.error('[saApproveRequest]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// saSetClubUserStatus()
// ═══════════════════════════════════════════════════════════════════

window.saSetClubUserStatus = async function saSetClubUserStatus(uid, email, newStatus, clubId) {
    var stLabels = {active:'activar',blocked:'bloquear',removed:'dar de baja'};
    if (!confirm('\u00bf' + (stLabels[newStatus]||newStatus) + ' a ' + email + '?')) return;
    _saShowSpinner('Procesando\u2026');
    // Detect active tab for correct refresh after operation
    var _activeTab = 'clubs';
    var _indTabBtn = document.getElementById('sa-tab-individuals');
    if (_indTabBtn && _indTabBtn.style.borderBottomColor === 'rgb(88, 166, 255)') _activeTab = 'individuals';
    try {
        const { db, fa, doc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, setDoc, httpsCallable } = await saFS();
        const uSnap = await getDoc(doc(db,'users',uid));
        const uData = uSnap.exists() ? uSnap.data() : {};
        const realUid = uData.uid || uid;
        const realEmail = uData.email || email;
        // FIX: Detect if this is an individual entity user for entity cleanup
        const _isIndividualUser = uData.role === 'individual' || uData.role === 'admin_individual'
            || uData.role === 'entrenador_individual' || uData.role === 'parent_individual'
            || !!(uData.individualEntityId || uData.individualOwnerId)
            || (uData.allRoles||[]).some(r => ['individual','admin_individual','entrenador_individual','parent_individual'].includes(r.role)
                || r.individualEntityId);
        const _entityId = uData.individualEntityId || uData.clubId || clubId || null;
        const _isIndividualAdmin = uData.role === 'individual' || uData.role === 'admin_individual'
            || (uData.allRoles||[]).some(r => (r.role === 'individual' || r.role === 'admin_individual') && r.isAuthorized);

        if (newStatus === 'removed') {
            // ═══════════════════════════════════════════════════════════
            // BAJA DEFINITIVA — Eliminar TODOS los rastros
            // ═══════════════════════════════════════════════════════════

            // 1. Leer documento primario para obtener todos los roles
            var primarySnap = (realUid !== uid)
                ? await getDoc(doc(db, 'users', realUid)).catch(function() { return null; })
                : uSnap;
            var allRoles = [];
            if (primarySnap && primarySnap.exists()) {
                allRoles = primarySnap.data().allRoles || [];
            } else if (uData.allRoles) {
                allRoles = uData.allRoles;
            }

            // ── Multi-rol: solo eliminar la cuenta Auth si el usuario NO conserva
            //    roles activos en OTRO club/entidad distinto al que se está dando
            //    de baja. Si los tiene, se borra de este ámbito pero la cuenta
            //    de Firebase Auth se preserva.
            var _otherActiveRoles = allRoles.filter(function(r) {
                var sameScope = String(r.clubId || r.individualEntityId || '') === String(clubId || '');
                var isActive = r.isAuthorized === true && r.status !== 'removed' && r.status !== 'rejected';
                return !sameScope && isActive;
            });
            var _shouldDeleteAuth = _otherActiveRoles.length === 0;

            // 2. Actualizar slots del club para CADA rol
            var _sk = function(role) {
                if (role === 'director') return 'usedSlots.directors';
                if (role === 'coordinator') return 'usedSlots.coordinators';
                if (role === 'parent') return 'usedSlots.parents';
                return 'usedSlots.users';
            };
            for (var ri = 0; ri < allRoles.length; ri++) {
                var rcid = allRoles[ri].clubId || clubId;
                if (rcid) {
                    var rk = _sk(allRoles[ri].role);
                    try {
                        var cs = await getDoc(doc(db, 'clubs', rcid));
                        if (cs.exists()) {
                            var sub = rk.split('.')[1];
                            var cur = ((cs.data().usedSlots || {})[sub]) || 1;
                            var upd = {}; upd[rk] = Math.max(0, cur - 1);
                            await updateDoc(doc(db, 'clubs', rcid), upd);
                        }
                    } catch (_) {}
                }
            }

            // 3. Eliminar cuenta de Firebase Auth ANTES de borrar docs
            // (la Cloud Function necesita leer el doc del caller para verificar permisos)
            // Multi-rol: solo si no quedan roles activos en otro club/entidad.
            if (_shouldDeleteAuth && httpsCallable && fa.functions) {
                try {
                    await httpsCallable(fa.functions,'deleteAuthUser')({uid:realUid,email:realEmail});
                } catch(cfErr) {
                    console.warn('[saSetClubUserStatus] deleteAuthUser:', cfErr && cfErr.code, cfErr && cfErr.message);
                    var codeB = (cfErr.details && cfErr.details.code) || cfErr.code || '';
                    if (codeB !== 'auth/user-not-found') {
                        // Registrar el fallo de forma persistente para revisión manual, pero CONTINUAR
                        try {
                            var _meSA = window._cronosCurrentUser || {};
                            await setDoc(doc(db, 'auth_deletion_failures', realUid + '_' + Date.now()), {
                                uid: realUid, email: realEmail, clubId: clubId || null,
                                errorCode: codeB || null,
                                errorMessage: (cfErr && cfErr.message) || String(cfErr),
                                requestedBy: _meSA.uid || null, requestedByEmail: _meSA.email || null,
                                createdAt: new Date().toISOString()
                            });
                        } catch(_) {}
                        // Continuar con el borrado de Firestore aunque falle Auth
                        _saToast('⚠️ Email no liberado en Auth (pendiente revisión), pero se han eliminado los datos del usuario.', 6000);
                    }
                }
            }

            // 4. Eliminar documentos secundarios
            for (var si2 = 0; si2 < allRoles.length; si2++) {
                var secId = realUid + '_' + allRoles[si2].role + '_' + (allRoles[si2].clubId || 'global');
                if (secId !== realUid) {
                    try { await deleteDoc(doc(db, 'users', secId)); } catch (_) {}
                }
            }

            // 4. Eliminar documento primario
            try { await deleteDoc(doc(db, 'users', realUid)); } catch (_) {}
            if (uid !== realUid) {
                try { await deleteDoc(doc(db, 'users', uid)); } catch (_) {}
            }

            // 5. Eliminar enlaces de jugador
            try {
                var linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('parentUid', '==', realUid)));
                var linksArr = []; linksSnap.forEach(function(ld) { linksArr.push(ld); });
                for (var li = 0; li < linksArr.length; li++) {
                    try { await deleteDoc(doc(db, 'cronos_player_links', linksArr[li].id)); } catch (_) {}
                }
            } catch (_) {}
            try {
                var linksSnap2 = await getDocs(query(collection(db, 'cronos_player_links'), where('parentEmail', '==', realEmail)));
                var linksArr2 = []; linksSnap2.forEach(function(ld) { linksArr2.push(ld); });
                for (var li2 = 0; li2 < linksArr2.length; li2++) {
                    try { await deleteDoc(doc(db, 'cronos_player_links', linksArr2[li2].id)); } catch (_) {}
                }
            } catch (_) {}

            // 6. Eliminar platform_requests de este usuario
            try {
                var prSnaps = await getDocs(query(collection(db, 'platform_requests'), where('userUid', '==', realUid)));
                var prArr = []; prSnaps.forEach(function(pd) { prArr.push(pd); });
                for (var pi = 0; pi < prArr.length; pi++) {
                    try { await deleteDoc(doc(db, 'platform_requests', prArr[pi].id)); } catch (_) {}
                }
            } catch (_) {}
            try {
                var prSnaps2 = await getDocs(query(collection(db, 'platform_requests'), where('requestedEmail', '==', realEmail)));
                var prArr2 = []; prSnaps2.forEach(function(pd) { prArr2.push(pd); });
                for (var pi2 = 0; pi2 < prArr2.length; pi2++) {
                    try { await deleteDoc(doc(db, 'platform_requests', prArr2[pi2].id)); } catch (_) {}
                }
            } catch (_) {}

            // 8. FIX: Si era admin individual, actualizar la entidad individual
            if (_isIndividualAdmin && _entityId) {
                try {
                    var entSnap = await getDoc(doc(db, 'clubs', _entityId));
                    if (entSnap.exists() && entSnap.data().type === 'individual') {
                        // Verificar si quedan otros admins individuales en la entidad
                        var remainingAdmins = await getDocs(query(collection(db, 'users'),
                            where('individualEntityId', '==', _entityId),
                            where('role', 'in', ['individual', 'admin_individual'])
                        )).catch(() => ({forEach:()=>{}}));
                        var _hasOtherAdmin = false;
                        remainingAdmins.forEach(function(d) {
                            if (d.id !== realUid && d.data().status !== 'removed') _hasOtherAdmin = true;
                        });
                        if (!_hasOtherAdmin) {
                            await updateDoc(doc(db, 'clubs', _entityId), {
                                hasAdmin: false,
                                adminUid: null,
                                adminEmail: null,
                                adminName: null,
                            });
                        }
                    }
                } catch(entErr) { console.warn('[saSetClubUserStatus] Error limpiando entidad individual:', entErr.message); }
            }

            _saHideSpinner();
            _saToast('\uD83D\uDDD1\uFE0F ' + email + ' dado de baja. Todos los rastros eliminados.', 4000);
        } else {
            // ═══════════════════════════════════════════════════════════
            // ACTIVAR / BLOQUEAR
            // ═══════════════════════════════════════════════════════════
            var role = uData.role || 'user';
            var sk = _sk(role);
            var isActive = (newStatus === 'active');
            await updateDoc(doc(db,'users',uid),{isAuthorized:isActive,status:newStatus});
            if (isActive) {
                await updateDoc(doc(db,'users',uid),{authorizedAt:new Date().toISOString()});
                // FIX CRÍTICO: Si se está activando un admin individual, actualizar hasAdmin en la entidad
                if (_isIndividualAdmin && _entityId) {
                    try {
                        await updateDoc(doc(db, 'clubs', _entityId), {
                            hasAdmin: true,
                            adminUid: uid,
                            adminEmail: uData.email || email,
                            adminName: uData.displayName || uData.firstName || email,
                        });
                    } catch(entErr2) {
                        console.warn('[saSetClubUserStatus] Error setting hasAdmin:', entErr2.message);
                    }
                }
            } else {
                await updateDoc(doc(db,'users',uid),{blockedAt:new Date().toISOString()});
                // FIX: Si se está bloqueando un admin individual, verificar si quedan otros admins
                if (_isIndividualAdmin && _entityId) {
                    try {
                        var remainingAdminsBlock = await getDocs(query(collection(db, 'users'),
                            where('individualEntityId', '==', _entityId),
                            where('role', 'in', ['individual', 'admin_individual'])
                        )).catch(() => ({forEach:()=>{}}));
                        var _hasOtherAdminBlock = false;
                        remainingAdminsBlock.forEach(function(d) {
                            if (d.id !== uid && d.data().status === 'active' && d.data().isAuthorized) _hasOtherAdminBlock = true;
                        });
                        if (!_hasOtherAdminBlock) {
                            await updateDoc(doc(db, 'clubs', _entityId), {
                                hasAdmin: false,
                                adminUid: null,
                                adminEmail: null,
                                adminName: null,
                            });
                        }
                    } catch(entErr3) {
                        console.warn('[saSetClubUserStatus] Error updating hasAdmin on block:', entErr3.message);
                    }
                }
            }
            if (clubId) {
                var cs2 = await getDoc(doc(db,'clubs',clubId)).catch(function() { return null; });
                if (cs2 && cs2.exists()) {
                    var sub2 = sk.split('.')[1];
                    var cur2 = ((cs2.data().usedSlots||{})[sub2])||0;
                    var upd2 = {}; upd2[sk] = Math.max(0, cur2 + (isActive ? 1 : -1));
                    await updateDoc(doc(db,'clubs',clubId), upd2).catch(function() {});
                }
            }
            _saHideSpinner();
            _saToast(isActive ? ('\u2705 ' + email + ' activado') : ('\uD83D\uDD12 ' + email + ' bloqueado'), 3000);
        }
        if (_activeTab === 'individuals') saIndividuals(); else saClubs();
    } catch (e) { _saHideSpinner(); _saToast('\u26A0\uFE0F '+e.message,5000); console.error(e); }
};

// ═══════════════════════════════════════════════════════════════════
// saTrash() / saReactivateAsIndividual() / saPurgeUser()
// Extraídas a js/admin/superadmin/trash.js (auditoría 2026-07-22, 2026-07-24).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// setupClubsSyncListener()
// ═══════════════════════════════════════════════════════════════════

window.setupClubsSyncListener = async function setupClubsSyncListener() {
    try {
        const { db, collection, onSnapshot, query, where } = await saFS();
        if (window._clubsSyncUnsubscribe) window._clubsSyncUnsubscribe();
        window._clubsSyncUnsubscribe = onSnapshot(collection(db,'users'), snap => {
            const panel = document.getElementById('sa-panel');
            if (!panel || panel.style.display==='none') return;
            if (snap.docChanges().some(c=>c.type==='removed'||c.type==='modified')) {
                clearTimeout(window._saRefreshTimeout);
                // Refresh the currently active tab, not always Clubs
                window._saRefreshTimeout = setTimeout(()=>{
                    const _indBtn = document.getElementById('sa-tab-individuals');
                    const _isIndTab = _indBtn && _indBtn.style.borderBottomColor === 'rgb(88, 166, 255)';
                    if (_isIndTab) saIndividuals(); else saClubs();
                }, 700);
            }
        });

        // ── Listener de solicitudes nuevas (notificación en tiempo real al SA) ──
        if (window._requestsSyncUnsubscribe) window._requestsSyncUnsubscribe();
        let _initialRequestLoad = true;
        window._requestsSyncUnsubscribe = onSnapshot(
            query(collection(db, 'platform_requests'), where('status', '==', 'pending_sa')),
            async snap => {
                const panel = document.getElementById('sa-panel');
                if (!panel) return;
                // Recalcular el conteo COMPLETO (las 6 fuentes), no solo este snapshot,
                // para que el badge refleje exactamente lo que muestra el panel.
                let count = 0;
                try { count = await window.saCountPendingRequests(); }
                catch (_) { count = snap.size || 0; }

                // Actualizar badge del tab Solicitudes
                const reqTab = document.getElementById('sa-tab-requests');
                if (reqTab) {
                    const oldBadge = reqTab.querySelector('span');
                    if (oldBadge) oldBadge.remove();
                    if (count > 0) {
                        const badge = document.createElement('span');
                        badge.style.cssText = 'background:#ff5858;color:white;border-radius:10px;padding:1px 7px;font-size:0.65rem;font-weight:700;margin-left:4px;';
                        badge.textContent = count;
                        reqTab.appendChild(badge);
                    }
                }

                // Toast solo para solicitudes NUEVAS (no en la carga inicial)
                if (_initialRequestLoad) {
                    _initialRequestLoad = false;
                    return;
                }
                const newDocs = snap.docChanges().filter(c => c.type === 'added');
                if (newDocs.length > 0) {
                    const latest = newDocs[0].doc.data();
                    const name = latest.requestedName || latest.requestedEmail || latest.userEmail || 'Nuevo usuario';
                    const roleLabel = latest.requestedRoleLabel || latest.requestedRole || '';
                    _saToast('🔔 Nueva solicitud: ' + name + (roleLabel ? ' (' + roleLabel + ')' : ''), 6000);

                    // Vibrar si es posible (dispositivos móviles)
                    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

                    // Si está en la pestaña Solicitudes, refrescar automáticamente
                    const reqTabBtn = document.getElementById('sa-tab-requests');
                    if (reqTabBtn && reqTabBtn.style.borderBottomColor === 'rgb(88, 166, 255)') {
                        clearTimeout(window._saReqRefreshTimeout);
                        window._saReqRefreshTimeout = setTimeout(() => saRequests(), 500);
                    }
                }
            }
        );
    } catch (e) { console.error('[setupClubsSyncListener]', e); }
};

// saDeleteClubComplete()
// Extraída a js/admin/superadmin/delete-club.js (auditoría 2026-07-22, 2026-07-24).



// ═══════════════════════════════════════════════════════════════════
// CREAR ENTE INDIVIDUAL / GESTIONAR USUARIOS DEL ENTE
// Extraídas a js/admin/superadmin/individual-entity.js (auditoría 2026-07-22, 2026-07-25).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// CREAR CLUB / USUARIO INDIVIDUAL directamente desde SA
// Extraídas a js/admin/superadmin/create-direct.js (auditoría 2026-07-22, 2026-07-24).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// EDITAR SLOTS Y PLAN DE UN CLUB
// Extraídas a js/admin/superadmin/club-slots.js (auditoría 2026-07-22, 2026-07-24).
// ═══════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// saExtras() / saSaveExtras() — Gestión de Extras de la aplicación por club
// Extraídas a js/admin/superadmin/extras-toggle.js (auditoría 2026-07-22, 2026-07-24).
// ════════════════════════════════════════════════════════════════════

// ── SISTEMA DE MENSAJERÍA PARA SUPER ADMINISTRADOR ──
function saEscapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function saEscapeAttr(str) {
    if (!str) return '';
    return str.replace(/'/g, '&#039;').replace(/"/g, '&quot;');
}

window.saMessages = async function saMessages() {
    const body = document.getElementById('sa-body');
    body.innerHTML = `<p style="color:#7d8590;text-align:center;padding:3rem;">⏳ Cargando panel de mensajería…</p>`;
    
    try {
        const fa = window._cronos_auth;
        const { collection, getDocs, query, where } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        
        // 1. Obtener todos los administradores (de club e individuales)
        const usersSnap = await getDocs(collection(fa.db, 'users'));
        const admins = [];
        
        usersSnap.forEach(d => {
            const data = d.data();
            const roles = [data.role || '', ...(data.allRoles || []).map(r => r.role || '')];
            const isAdmin = roles.some(r => ['admin', 'club_admin', 'admin_individual', 'individual', 'individual_admin'].includes(r));
            
            if (isAdmin && d.id !== window._cronosCurrentUser?.uid) {
                let adminType = 'Administrador de Club';
                if (roles.some(r => ['admin_individual', 'individual', 'individual_admin'].includes(r))) {
                    adminType = 'Administrador Individual';
                }
                
                admins.push({
                    uid: d.id,
                    email: data.email || '',
                    displayName: data.displayName || data.email || 'Admin',
                    adminType,
                    clubName: data.clubName || ''
                });
            }
        });
        
        // Ordenar
        admins.sort((a,b) => a.adminType.localeCompare(b.adminType) || a.displayName.localeCompare(b.displayName));
        
        // Obtener hilos
        const threadsSnap = await getDocs(query(
            collection(fa.db, 'cronos_messages'),
            where('participants', 'array-contains', window._cronosCurrentUser?.uid)
        ));
        
        const threads = [];
        threadsSnap.forEach(d => {
            const tData = d.data();
            if (tData.recipientType === 'superadmin' || tData.senderRole === 'superadmin' || tData.threadId?.includes('sa_')) {
                threads.push({ _id: d.id, ...tData });
            }
        });
        
        threads.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

        body.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr; gap:1.5rem; max-width:1200px; margin:0 auto;">
            <!-- Nueva conversación -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:12px; padding:1.2rem; display:flex; flex-direction:column; gap:1rem;">
                <h3 style="margin:0; font-size:1.1rem; color:white; display:flex; align-items:center; gap:0.5rem;">
                    ✉️ Nuevo Mensaje a Administradores
                </h3>
                
                <div style="border:1px solid var(--glass-border); border-radius:8px; padding:0.8rem; background:rgba(0,0,0,0.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                        <span style="font-size:0.75rem; font-weight:700; color:#8b949e;">SELECCIONAR DESTINATARIOS</span>
                        <div style="display:flex; gap:0.4rem;">
                            <button onclick="document.querySelectorAll('.sa-msg-recipient-chk').forEach(c=>c.checked=true); saUpdateCount();"
                                style="font-size:0.62rem; padding:0.18rem 0.5rem; background:rgba(88,166,255,0.1); border:1px solid rgba(88,166,255,0.3); border-radius:4px; color:#58a6ff; cursor:pointer;">
                                ✓ Todos
                            </button>
                            <button onclick="document.querySelectorAll('.sa-msg-recipient-chk').forEach(c=>c.checked=false); saUpdateCount();"
                                style="font-size:0.62rem; padding:0.18rem 0.5rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#8b949e; cursor:pointer;">
                                ✗ Ninguno
                            </button>
                        </div>
                    </div>
                    
                    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:0.5rem; max-height:220px; overflow-y:auto; padding-right:5px;">
                        ${admins.length ? admins.map(a => `
                        <label style="display:flex; align-items:center; gap:0.5rem; background:rgba(255,255,255,0.02); border:1px solid var(--glass-border); border-radius:6px; padding:0.5rem; cursor:pointer;">
                            <input type="checkbox" class="sa-msg-recipient-chk" 
                                data-uid="${saEscapeAttr(a.uid)}" 
                                data-email="${saEscapeAttr(a.email)}"
                                data-name="${saEscapeAttr(a.displayName)}"
                                onchange="saUpdateCount()"
                                style="width:15px; height:15px; accent-color:#58a6ff; flex-shrink:0;">
                            <div style="flex:1; min-width:0;">
                                <div style="font-size:0.82rem; font-weight:600; color:white; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    ${saEscapeHtml(a.displayName)}
                                </div>
                                <div style="font-size:0.68rem; color:#8b949e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    ${saEscapeHtml(a.adminType)} ${a.clubName ? `· ${saEscapeHtml(a.clubName)}` : ''}
                                </div>
                            </div>
                        </label>`).join('') : '<p style="color:#8b949e; text-align:center; padding:1rem; font-size:0.8rem;">No se encontraron administradores.</p>'}
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:0.5rem;">
                    <textarea id="sa-msg-text" placeholder="Escribe tu mensaje aquí..." rows="3"
                        style="width:100%; box-sizing:border-box; padding:0.65rem 0.8rem; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:8px; color:white; font-size:0.88rem; resize:vertical; outline:none;"></textarea>
                    <button onclick="saSendMessages()" class="btn primary" id="sa-send-btn"
                        style="padding:0.65rem; font-weight:700; border-radius:8px; cursor:pointer; width:100%;">
                        Enviar mensaje a (<span id="sa-selected-count">0</span>) destinatarios
                    </button>
                </div>
            </div>

            <!-- Hilos activos -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:12px; padding:1.2rem;">
                <h3 style="margin:0 0 1rem 0; font-size:1.1rem; color:white;">Conversaciones Recientes</h3>
                <div id="sa-threads-list" style="display:flex; flex-direction:column; gap:0.6rem;">
                    ${threads.length ? threads.map(t => {
                        const otherName = t.staffEmail || t.coachEmail || t.parentEmail || 'Administrador';
                        const lastMsg = t.lastMessage || '—';
                        const lastT = t.lastMessageAt
                            ? new Date(t.lastMessageAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                            : '';
                        
                        return `
                        <div onclick="saOpenThread('${t._id}', '${saEscapeAttr(otherName)}')"
                             style="background:var(--glass); border:1px solid var(--glass-border); border-radius:8px; padding:0.75rem 1rem; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition:all 0.15s;">
                            <div style="flex:1; min-width:0;">
                                <div style="font-weight:700; font-size:0.88rem; color:#58a6ff; margin-bottom:0.15rem;">
                                    💬 ${saEscapeHtml(otherName)}
                                </div>
                                <div style="font-size:0.76rem; color:#8b949e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    ${saEscapeHtml(lastMsg)}
                                </div>
                            </div>
                            <span style="font-size:0.68rem; color:#8b949e; flex-shrink:0;">${lastT}</span>
                        </div>`;
                    }).join('') : '<p style="color:#8b949e; text-align:center; padding:2rem; font-size:0.85rem;">No hay conversaciones iniciadas todavía.</p>'}
                </div>
            </div>
        </div>`;
    } catch(err) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:3rem;">⚠️ Error al cargar: ${saEscapeHtml(err.message)}</p>`;
    }
};

window.saUpdateCount = () => {
    const count = document.querySelectorAll('.sa-msg-recipient-chk:checked').length;
    const countEl = document.getElementById('sa-selected-count');
    if (countEl) countEl.textContent = count;
};

window.saSendMessages = async () => {
    const text = (document.getElementById('sa-msg-text')?.value || '').trim();
    if (!text) {
        alert('Escribe un mensaje antes de enviar.');
        return;
    }
    
    const selected = Array.from(document.querySelectorAll('.sa-msg-recipient-chk:checked')).map(chk => ({
        uid: chk.dataset.uid,
        email: chk.dataset.email,
        name: chk.dataset.name
    }));

    if (!selected.length) {
        alert('Selecciona al menos un destinatario.');
        return;
    }

    const btn = document.getElementById('sa-send-btn');
    if (btn) btn.disabled = true;

    try {
        const fa = window._cronos_auth;
        const { doc, getDoc, setDoc, updateDoc, arrayUnion } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const me = window._cronosCurrentUser;
        const newMsg = {
            sender: 'superadmin',
            senderUid: me.uid,
            text,
            timestamp: new Date().toISOString()
        };

        const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

        for (const s of selected) {
            const threadId = 'sa_' + [me.uid, s.uid].sort().join('_');
            
            const snap = await getDoc(doc(fa.db, 'cronos_messages', threadId));
            if (snap.exists()) {
                await updateDoc(doc(fa.db, 'cronos_messages', threadId), {
                    messages: arrayUnion(newMsg),
                    lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByParent: (snap.data().unreadByParent || 0) + 1
                });
            } else {
                await setDoc(doc(fa.db, 'cronos_messages', threadId), {
                    threadId,
                    coachUid: me.uid,
                    coachEmail: me.email || 'Super Admin',
                    staffUid: s.uid,
                    staffEmail: s.email,
                    recipientType: 'superadmin',
                    senderRole: 'superadmin',
                    clubId: null,
                    participants: [me.uid, s.uid],
                    messages: [newMsg],
                    lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByCoach: 0,
                    unreadByStaff: 1,
                    unreadByParent: 1
                });
            }
        }

        alert('Mensajes enviados correctamente.');
        saMessages();
    } catch(err) {
        if (btn) btn.disabled = false;
        alert('Error al enviar: ' + err.message);
    }
};

window.saOpenThread = async (threadId, otherName) => {
    const body = document.getElementById('sa-body');
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;

    body.innerHTML = `
    <div style="display:flex; flex-direction:column; height:500px; max-width:800px; margin:0 auto; background:rgba(255,255,255,0.02); border:1px solid var(--glass-border); border-radius:12px; padding:1.2rem;">
        <div style="display:flex; align-items:center; gap:0.7rem; margin-bottom:1rem; flex-shrink:0;">
            <button onclick="saMessages()" class="sa-btn" style="padding:0.35rem 0.7rem; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:7px; color:#8b949e; font-size:0.74rem; cursor:pointer;">
                ← Volver
            </button>
            <div style="font-weight:700; font-size:0.95rem; color:white;">💬 ${saEscapeHtml(otherName)}</div>
        </div>
        
        <div id="sa-thread-messages" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:0.5rem; padding-right:5px; margin-bottom:1rem;">
            <p style="color:#8b949e; text-align:center; padding:2rem;">⏳ Cargando mensajes…</p>
        </div>

        <div style="display:flex; gap:0.5rem; align-items:flex-end; border-top:1px solid var(--glass-border); padding-top:0.7rem; flex-shrink:0;">
            <textarea id="sa-reply-input" placeholder="Responder..." rows="2"
                style="flex:1; padding:0.55rem 0.75rem; background:rgba(255,255,255,0.06); border:1px solid var(--glass-border); border-radius:8px; color:white; font-size:0.85rem; resize:none; outline:none; box-sizing:border-box;"
                onkeydown="if(event.key==='Enter'&&!event.shiftKey){ event.preventDefault(); saSendReply('${threadId}', '${saEscapeAttr(otherName)}'); }"></textarea>
            <button onclick="saSendReply('${threadId}', '${saEscapeAttr(otherName)}')" class="sa-btn primary" id="sa-reply-btn" style="padding:0.55rem 1rem; border-radius:8px; font-weight:700; cursor:pointer;">
                Enviar ›
            </button>
        </div>
    </div>`;

    try {
        const { doc, getDoc, updateDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        
        const snap = await getDoc(doc(fa.db, 'cronos_messages', threadId));
        const container = document.getElementById('sa-thread-messages');
        
        if (!snap.exists() || !snap.data().messages?.length) {
            container.innerHTML = `<p style="color:#8b949e; text-align:center; padding:2rem;">Sin mensajes aún.</p>`;
        } else {
            const messages = snap.data().messages || [];
            container.innerHTML = messages.map((m, idx) => {
                const isMine = m.sender === 'superadmin';
                const time = m.timestamp
                    ? new Date(m.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                    : '';
                const date = m.timestamp
                    ? new Date(m.timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                    : '';

                return `
                <div style="display:flex; justify-content:${isMine ? 'flex-end' : 'flex-start'}; padding:0 0.2rem;">
                    <div style="max-width:78%; background:${isMine ? 'rgba(88,166,255,0.18)' : 'rgba(255,255,255,0.07)'}; border:1px solid ${isMine ? 'rgba(88,166,255,0.3)' : 'rgba(255,255,255,0.1)'}; border-radius:12px; padding:0.5rem 0.85rem;">
                        <div style="font-size:0.84rem; line-height:1.55; white-space:pre-wrap; color:white;">
                            ${saEscapeHtml(m.text)}
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.25rem; gap:1.5rem;">
                            <span onclick="event.stopPropagation(); saDeleteSingleMessage('${threadId}', ${idx}, '${saEscapeAttr(otherName)}')"
                                  title="Borrar mensaje"
                                  style="font-size:0.7rem; color:#ff5858; cursor:pointer; opacity:0.6; transition:opacity 0.2s;"
                                  onmouseover="this.style.opacity='1'"
                                  onmouseout="this.style.opacity='0.6'">
                                🗑️ Borrar
                            </span>
                            <div style="font-size:0.64rem; color:#8b949e; text-align:right;">
                                ${date} ${time}
                            </div>
                        </div>
                    </div>
                </div>`;
            }).join('');
            container.scrollTop = container.scrollHeight;
        }

        await updateDoc(doc(fa.db, 'cronos_messages', threadId), { unreadByCoach: 0 });
    } catch(err) {
        const container = document.getElementById('sa-thread-messages');
        if (container) container.innerHTML = `<p style="color:#ff5858; text-align:center; padding:2rem;">⚠️ Error: ${saEscapeHtml(err.message)}</p>`;
    }
};

window.saSendReply = async (threadId, otherName) => {
    const input = document.getElementById('sa-reply-input');
    const text = (input?.value || '').trim();
    if (!text) return;

    const btn = document.getElementById('sa-reply-btn');
    if (btn) btn.disabled = true;

    try {
        const fa = window._cronos_auth;
        const { doc, updateDoc, arrayUnion } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const me = window._cronosCurrentUser;
        const newMsg = {
            sender: 'superadmin',
            senderUid: me.uid,
            text,
            timestamp: new Date().toISOString()
        };

        const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

        await updateDoc(doc(fa.db, 'cronos_messages', threadId), {
            messages: arrayUnion(newMsg),
            lastMessage: preview,
            lastMessageAt: newMsg.timestamp,
            unreadByParent: 1
        });

        if (input) input.value = '';
        saOpenThread(threadId, otherName);
    } catch(err) {
        if (btn) btn.disabled = false;
        alert('Error al responder: ' + err.message);
    }
};

window.saDeleteSingleMessage = async (threadId, index, otherName) => {
    if (!confirm('¿Estás seguro de que deseas borrar este mensaje?')) return;
    const fa = window._cronos_auth;
    try {
        const { doc, getDoc, updateDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const docRef = doc(fa.db, 'cronos_messages', threadId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;
        
        const data = snap.data();
        const messages = data.messages || [];
        if (index < 0 || index >= messages.length) return;
        
        messages.splice(index, 1);
        
        let lastMessage = data.lastMessage || '';
        let lastMessageAt = data.lastMessageAt || '';
        if (messages.length > 0) {
            const last = messages[messages.length - 1];
            lastMessage = last.text.length > 60 ? last.text.substring(0, 60) + '…' : last.text;
            lastMessageAt = last.timestamp || '';
        } else {
            lastMessage = '— Sin mensajes —';
            lastMessageAt = '';
        }
        
        await updateDoc(docRef, { messages, lastMessage, lastMessageAt });
        saOpenThread(threadId, otherName);
    } catch(err) {
        alert('Error al borrar: ' + err.message);
    }
};


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
        <button onclick="saGoBackToRoles()"
            style="background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.3);color:#ffd700;padding:0.32rem 0.7rem;border-radius:6px;cursor:pointer;font-size:0.76rem;font-weight:700;">⇄ Cambiar rol</button>
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
    ['clubs','individuals','requests','secretary','trash','billing'].forEach(t => {
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
        clubsSnap.forEach(d => { const c = { id:d.id, users:[], ...d.data() }; if (c.type !== 'individual') clubs[d.id] = c; });
        const orphans = [];
        usersSnap.forEach(d => {
            const u = { id:d.id, ...d.data() };
            if (['superadmin','admin'].includes(u.role)) return;
            if (u.clubId && clubs[u.clubId]) clubs[u.clubId].users.push(u);
            else orphans.push(u);
        });

        const stColor = { active:'#3fb950', blocked:'#f0883e', removed:'#ff5858', pending:'#ffd700', pending_club:'#ffa500', pending_register:'#79c0ff' };
        const stLabel = { active:'Activo', blocked:'Bloqueado', removed:'Baja', pending:'⏳ Pend.SA', pending_club:'⏳ Pend.Club', pending_register:'⏳ Sin registrar' };

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
                return (u.allRoles||[]).some(r => r.role === role && r.isAuthorized && r.clubId === c.id);
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
            const adminCount = vis.filter(u => u.role === 'club_admin' && u.status !== 'removed').length;

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
                    ${vis.length?'<div>'+vis.map(u=>renderRow(u,c.id)).join('')+'</div>':'<p style="margin:0;padding:0.6rem 0.9rem;color:#8b949e;font-size:0.8rem;">Sin usuarios asignados.</p>'}
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
// saIndividuals() — Pestaña de entes individuales y usuarios individuales
// ═══════════════════════════════════════════════════════════════════

window.saIndividuals = async function saIndividuals() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center;padding:2.5rem;color:#8b949e;"><div style="font-size:1.6rem;">⏳</div>Cargando entidades individuales…</div>`;
    try {
        const { db, collection, query, where, getDocs } = await saFS();

        // Cargar entes individuales (clubs con type=individual)
        const clubsSnap = await getDocs(collection(db,'clubs'));
        const individualEntities = [];
        clubsSnap.forEach(d => {
            const c = { id:d.id, ...d.data() };
            if (c.type === 'individual') individualEntities.push(c);
        });

        // Cargar usuarios individuales
        // CRITICAL: Include ALL users that belong to an individual entity:
        //   - Explicit individual roles (individual, admin_individual, parent_individual)
        //   - Users with individualEntityId or individualOwnerId set (even if role is 'user' or 'parent')
        //   - Users whose allRoles contain any individual-related role
        //   - Users with isIndividual flag
        //   - Users whose clubId matches an individual entity ID (clubId is set to entityId for SA panel compat)
        const _indivEntityIds = new Set(individualEntities.map(e => e.id));
        const usersSnap = await getDocs(collection(db,'users'));
        const individualUsers = [];

        // ═══ SINCRONIZACIÓN RETROACTIVA DE hasAdmin ═══
        // Verificar si alguna entidad individual tiene hasAdmin desactualizado
        // y corregirlo automáticamente
        const _activeAdminsByEntity = {};
        usersSnap.forEach(d => {
            const u = { id: d.id, ...d.data() };
            const isAdminIndiv = (u.role === 'individual' || u.role === 'admin_individual')
                && u.isAuthorized === true && u.status === 'active';
            if (isAdminIndiv) {
                const entityId = u.individualEntityId || u.individualOwnerId || u.clubId || null;
                if (entityId && _indivEntityIds.has(entityId)) {
                    if (!_activeAdminsByEntity[entityId]) {
                        _activeAdminsByEntity[entityId] = u;
                    }
                }
            }
        });
        // Corregir entidades con hasAdmin desactualizado
        for (const ent of individualEntities) {
            const realAdmin = _activeAdminsByEntity[ent.id];
            if (realAdmin && !ent.hasAdmin) {
                console.log('[saIndividuals] Corrigiendo hasAdmin para entidad:', ent.id, '(admin encontrado:', realAdmin.email, ')');
                try {
                    const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    await updateDoc(doc(db, 'clubs', ent.id), {
                        hasAdmin: true,
                        adminUid: realAdmin.id,
                        adminEmail: realAdmin.email,
                        adminName: realAdmin.displayName || realAdmin.firstName || realAdmin.email,
                    });
                    ent.hasAdmin = true; // Actualizar en memoria también
                } catch(syncErr) {
                    console.warn('[saIndividuals] Error corrigiendo hasAdmin:', syncErr.message);
                }
            }
        }

        usersSnap.forEach(d => {
            const u = { id:d.id, ...d.data() };
            const hasIndivRole = u.role === 'individual' || u.role === 'admin_individual' || u.role === 'parent_individual';
            const hasIndivInAllRoles = (u.allRoles||[]).some(r =>
                ['individual','admin_individual','parent_individual','entrenador_individual','padre_individual'].includes(r.role)
                || (r.individualEntityId && ['user','parent'].includes(r.role))
            );
            const hasIndivFields = !!(u.individualEntityId || u.individualOwnerId || u.isIndividual);
            // FIX: Also check if clubId matches an individual entity (auth.js sets clubId = entityId)
            const clubIdMatchesIndivEntity = u.clubId && _indivEntityIds.has(u.clubId);
            const isUserOrParentInIndivEntity = (u.role === 'user' || u.role === 'parent') && (hasIndivFields || clubIdMatchesIndivEntity);
            if (hasIndivRole || hasIndivInAllRoles || isUserOrParentInIndivEntity || clubIdMatchesIndivEntity) {
                individualUsers.push(u);
            }
        });

        const stColor = { active:'#3fb950', blocked:'#f0883e', removed:'#ff5858', pending:'#ffd700', pending_club:'#ffa500', pending_register:'#79c0ff', pending_sa:'#79c0ff', pending_individual:'#ffa500' };
        const stLabel = { active:'Activo', blocked:'Bloqueado', removed:'Baja', pending:'⏳ Pend.SA', pending_club:'⏳ Pend.Club', pending_register:'⏳ Sin registrar', pending_sa:'⏳ Pend.SA', pending_individual:'⏳ Pend.Admin Ind.' };

        let html = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
            <h3 style="margin:0;font-size:1rem;color:white;">👤 Entes Individuales (${individualEntities.length})</h3>
            <button onclick="saShowCreateIndividualEntity()"
                style="display:flex;align-items:center;gap:0.5rem;padding:0.55rem 1.1rem;
                       background:rgba(121,192,255,0.12);border:1px solid rgba(121,192,255,0.4);
                       border-radius:8px;color:#79c0ff;font-size:0.85rem;font-weight:700;cursor:pointer;">
                👤 + Crear Ente Individual
            </button>
        </div>
        <p style="font-size:0.78rem;color:#8b949e;margin:0 0 1rem;">
            Los entes individuales son entidades independientes (sin club) donde se registran administradores individuales, entrenadores individuales y padres/madres individuales.
        </p>`;

        // ── Sección: Entes Individuales ──
        if (!individualEntities.length) {
            html += `<div style="text-align:center;padding:2rem;color:#8b949e;margin-bottom:1.5rem;
                        background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.12);border-radius:10px;">
                <div style="font-size:2rem;margin-bottom:0.5rem;">👤</div>
                Sin entes individuales creados.<br>
                Usa el botón <strong>+ Crear Ente Individual</strong> para crear uno.<br>
                <span style="font-size:0.72rem;color:#4d5566;">El ente individual es necesario para que los usuarios individuales puedan registrarse.</span>
            </div>`;
        } else {
            individualEntities.forEach(ent => {
                // Contar usuarios de este ente individual
                // CRITICAL: Check clubId, individualEntityId AND individualOwnerId for matching
                const entUsers = individualUsers.filter(u =>
                    u.clubId === ent.id || u.individualEntityId === ent.id || u.individualOwnerId === ent.id
                );
                const roleLabels = {
                    admin_individual: { icon:'⚙️', label:'Administradores Individuales', slot:'admins' },
                    individual:       { icon:'⚙️', label:'Administradores Individuales', slot:'admins' },  // 'individual' from auth.js = admin individual
                    user:             { icon:'⚽', label:'Entrenadores Individuales',      slot:'coaches' },
                    entrenador_individual: { icon:'⚽', label:'Entrenadores Individuales', slot:'coaches' },
                    parent_individual:{ icon:'👨‍👩‍👧', label:'Padres/Madres Individuales',   slot:'parents' },
                    parent:           { icon:'👨‍👩‍👧', label:'Padres/Madres Individuales',   slot:'parents' },
                };
                const slotBar = (roleKey) => {
                    const meta = roleLabels[roleKey];
                    const used = entUsers.filter(u => {
                        if (u.status === 'removed') return false;
                        // CRITICAL: For admin_individual slot, count both 'admin_individual' and 'individual' roles
                        if (roleKey === 'admin_individual') {
                            return u.role === 'admin_individual' || u.role === 'individual'
                                || (u.allRoles||[]).some(r => (r.role === 'admin_individual' || r.role === 'individual') && r.isAuthorized);
                        }
                        // For coaches/parents, check main role and allRoles
                        // Also handle 'user'/'entrenador_individual' as entrenador individual
                        // and 'parent'/'parent_individual' as padre individual
                        if (roleKey === 'user' || roleKey === 'entrenador_individual') {
                            // Count users with role 'user' or 'entrenador_individual' that are authorized
                            return u.role === 'user' || u.role === 'entrenador_individual'
                                || (u.allRoles||[]).some(r =>
                                    (r.role === 'user' || r.role === 'entrenador_individual') && r.isAuthorized);
                        }
                        if (roleKey === 'parent' || roleKey === 'parent_individual') {
                            return u.role === 'parent' || u.role === 'parent_individual'
                                || (u.allRoles||[]).some(r =>
                                    (r.role === 'parent' || r.role === 'parent_individual') && r.isAuthorized);
                        }
                        return u.role === roleKey || (u.allRoles||[]).some(r => r.role === roleKey && r.isAuthorized);
                    }).length;
                    const max = ent.slots?.[meta.slot] ?? '∞';
                    const pct = max !== '∞' && max > 0 ? Math.round((used/max)*100) : 0;
                    const full = max !== '∞' && used >= max;
                    return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0.9rem;border-bottom:1px solid rgba(255,255,255,0.03);">
                        <span style="font-size:0.8rem;">${meta.icon}</span>
                        <span style="flex:1;font-size:0.75rem;color:#cdd9e5;">${meta.label}</span>
                        <span style="font-size:0.75rem;font-weight:700;color:${full?'#ff5858':used>0?'#79c0ff':'#4d5566'};">${used}</span>
                        <span style="font-size:0.68rem;color:#4d5566;">/ ${max}</span>
                        <div style="width:60px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
                            <div style="height:100%;width:${Math.min(pct,100)}%;background:${full?'#ff5858':'#79c0ff'};border-radius:2px;transition:width 0.3s;"></div>
                        </div>
                    </div>`;
                };

                const _escH = typeof escapeHtml==='function'?escapeHtml:function(s){return s;};
                const _escA = typeof escapeAttr==='function'?escapeAttr:function(s){return s;};
                const eId = _escA(ent.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

                html += `
                <div style="margin-bottom:1rem;border:1px solid rgba(121,192,255,0.15);border-radius:10px;overflow:hidden;">
                    <div style="background:rgba(121,192,255,0.07);padding:0.6rem 0.9rem;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-weight:700;color:white;font-size:0.9rem;">👤 ${_escH(ent.name||ent.id)}</div>
                            <div style="font-size:0.68rem;color:#8b949e;margin-top:2px;">Plan: ${ent.plan||'free'} · ${entUsers.length} usuarios totales · Ente Individual</div>
                        </div>
                        <div style="display:flex;gap:0.4rem;align-items:center;">
                            <button onclick="saEditIndividualEntity('${eId}')" title="Editar ente" style="padding:0.22rem 0.45rem;background:rgba(121,192,255,0.15);border:1px solid rgba(121,192,255,0.4);border-radius:5px;color:#79c0ff;font-size:0.72rem;cursor:pointer;font-weight:700;">✏️ Editar</button>
                            <button onclick="saDeleteIndividualEntity('${eId}','${_escA(ent.name||ent.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')" title="Eliminar ente" style="padding:0.22rem 0.45rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:5px;color:#ff5858;font-size:0.72rem;cursor:pointer;font-weight:700;">🗑️</button>
                        </div>
                    </div>
                    ${slotBar('admin_individual')}
                    ${slotBar('user')}
                    ${slotBar('parent_individual')}
                    <div style="padding:0.5rem 0.9rem;">
                        <button onclick="saShowCreateIndividualForEntity('${eId}')" style="padding:0.28rem 0.7rem;background:rgba(63,185,80,0.12);border:1px solid rgba(63,185,80,0.4);border-radius:6px;color:#3fb950;font-size:0.72rem;cursor:pointer;font-weight:700;">👤 + Añadir Usuario</button>
                        <button onclick="saShowEntityUsers('${eId}')" style="padding:0.28rem 0.7rem;margin-left:0.4rem;background:rgba(121,192,255,0.12);border:1px solid rgba(121,192,255,0.4);border-radius:6px;color:#79c0ff;font-size:0.72rem;cursor:pointer;font-weight:700;">📋 Ver usuarios (${entUsers.length})</button>
                    </div>
                </div>`;
            });
        }

        // ── Sección: Usuarios Individuales sin ente (huérfanos) ──
        // CRITICAL: Check clubId, individualEntityId AND individualOwnerId for entity assignment
        const orphans = individualUsers.filter(u => {
            if (u.status === 'removed') return false;
            const hasEntity = (u.clubId && individualEntities.some(e => e.id === u.clubId))
                           || (u.individualEntityId && individualEntities.some(e => e.id === u.individualEntityId))
                           || (u.individualOwnerId && individualEntities.some(e => e.id === u.individualOwnerId));
            return !hasEntity;
        });

        if (orphans.length > 0) {
            html += `
            <div style="margin-top:1rem;">
                <h4 style="margin:0 0 0.5rem;font-size:0.88rem;color:#ffd700;">⚠️ Usuarios sin ente individual asignado (${orphans.length})</h4>
                <p style="font-size:0.72rem;color:#8b949e;margin:0 0 0.5rem;">Estos usuarios individuales no tienen un ente individual asignado. Asígnalos a un ente para que funcionen correctamente.</p>`;
            orphans.forEach(u => {
                const st = u.status || (u.isAuthorized?'active':'pending');
                const meta = window.ROLE_META[u.role] || { icon:'👤', color:'#8b949e', label:u.role||'?' };
                const _escH = typeof escapeHtml==='function'?escapeHtml:function(s){return s;};
                const _escA = typeof escapeAttr==='function'?escapeAttr:function(s){return s;};
                const em  = _escA(u.email||u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
                const eid = _escA(u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
                // Build entity selector for orphan assignment
                let entityOpts = '<option value="">-- Asignar a ente --</option>';
                individualEntities.forEach(ent => {
                    entityOpts += '<option value="' + _escA(ent.id) + '">' + _escH(ent.name||ent.id) + '</option>';
                });
                html += `
                <div style="background:rgba(255,215,0,0.04);border:1px solid rgba(255,215,0,0.15);border-radius:9px;padding:0.7rem 0.85rem;margin-bottom:0.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
                    <div style="display:flex;align-items:center;gap:0.6rem;flex:1;min-width:200px;">
                        <span style="font-size:1.2rem;">${meta.icon}</span>
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:600;font-size:0.85rem;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escH(u.email||u.id)}</div>
                            <div style="font-size:0.72rem;color:${stColor[st]||'#8b949e'};">${_escH(u.displayName||'')} · ${meta.label} · ${stLabel[st]||st} · Sin ente</div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                        <select id="orph-ent-${eid}" style="padding:0.3rem 0.5rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:white;font-size:0.72rem;">
                            ${entityOpts}
                        </select>
                        <button onclick="saAssignOrphanToEntity('${eid}','${em}')" style="padding:0.28rem 0.6rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:6px;color:#3fb950;font-size:0.72rem;cursor:pointer;font-weight:700;">✅ Asignar</button>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }

        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</p>`;
        console.error('[saIndividuals]', e);
    }
};

// Activar un usuario individual (pre-aprobado)
window.saActivateIndividual = async function(uid, email) {
    if (!confirm('¿Activar a ' + email + '?')) return;
    _saShowSpinner('Activando...');
    try {
        const { db, doc, getDoc, updateDoc } = await saFS();
        const uSnap = await getDoc(doc(db,'users',uid));
        if (!uSnap.exists()) throw new Error('Usuario no encontrado');
        const uData = uSnap.data();
        const isAdminIndiv = uData.role === 'individual' || uData.role === 'admin_individual'
            || (uData.allRoles||[]).some(r => r.role === 'individual' || r.role === 'admin_individual');
        // FIX: Activar TODOS los roles pendientes, no solo individual/admin_individual
        const updAllRoles = (uData.allRoles||[]).map(r =>
            ({...r, isAuthorized:true, status:'active'})
        );
        // Obtener el entityId del usuario
        const _entityId = uData.individualEntityId || uData.clubId || null;
        const _updateObj = {
            isAuthorized: true,
            status: 'active',
            allRoles: updAllRoles,
            authorizedAt: new Date().toISOString(),
            authorizedBy: window._cronosCurrentUser?.email || 'superadmin',
        };
        // Asegurar que clubId e individualEntityId estén seteados
        if (_entityId) {
            _updateObj.clubId = _entityId;
            _updateObj.individualEntityId = _entityId;
            _updateObj.individualOwnerId = _entityId;
        }
        await updateDoc(doc(db,'users',uid), _updateObj);
        // Si es administrador individual, actualizar la entidad
        if (isAdminIndiv && _entityId) {
            try {
                await updateDoc(doc(db,'clubs',_entityId), {
                    hasAdmin: true,
                    adminUid: uid,
                    adminEmail: uData.email || email,
                    adminName: uData.displayName || uData.firstName || email,
                });
            } catch(entErr) { console.warn('[saActivateIndividual] Error setting hasAdmin:', entErr.message); }
        }
        _saHideSpinner();
        _saToast('✅ ' + email + ' activado correctamente.', 4000);
        saIndividuals();
    } catch (e) {
        _saHideSpinner();
        _saToast('⚠️ Error: ' + e.message, 4000);
        console.error('[saActivateIndividual]', e);
    }
};

// Asignar usuario huérfano a un ente individual
window.saAssignOrphanToEntity = async function(uid, email) {
    const selectEl = document.getElementById('orph-ent-' + uid);
    const entityId = selectEl ? selectEl.value : '';
    if (!entityId) { _saToast('⚠️ Selecciona un ente individual', 3000); return; }

    _saShowSpinner('Asignando...');
    try {
        const { db, doc, getDoc, updateDoc } = await saFS();
        const uSnap = await getDoc(doc(db, 'users', uid));
        if (!uSnap.exists()) throw new Error('Usuario no encontrado');
        const uData = uSnap.data();

        // Get entity name for clubName
        const entSnap = await getDoc(doc(db, 'clubs', entityId));
        const entName = entSnap.exists() ? (entSnap.data().name || entityId) : entityId;

        // Update user: set clubId AND individualEntityId to the entity
        const updAllRoles = (uData.allRoles || []).map(r => {
            if (r.role === 'individual' || r.role === 'admin_individual') {
                return { ...r, clubId: entityId, individualEntityId: entityId, isAuthorized: true, status: 'active' };
            }
            if (r.role === 'user' || r.role === 'parent' || r.role === 'parent_individual') {
                return { ...r, clubId: entityId, individualEntityId: entityId };
            }
            return r;
        });

        const updateData = {
            clubId: entityId,
            clubName: entName,
            individualEntityId: entityId,
            individualOwnerId: entityId,
            allRoles: updAllRoles,
        };

        // If user is admin individual, also mark entity as having admin
        if (uData.role === 'individual' || uData.role === 'admin_individual') {
            updateData.isAuthorized = true;
            updateData.status = 'active';
            // Also update entity
            try {
                await updateDoc(doc(db, 'clubs', entityId), {
                    hasAdmin: true,
                    adminUid: uid,
                    adminEmail: email,
                    adminName: uData.displayName || uData.firstName || email,
                });
            } catch(entErr) { console.warn('[saAssignOrphanToEntity] Entity update failed:', entErr.message); }
        }

        await updateDoc(doc(db, 'users', uid), updateData);
        _saHideSpinner();
        _saToast('✅ ' + email + ' asignado al ente individual correctamente.', 4000);
        saIndividuals();
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saAssignOrphanToEntity]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// saSecretary() — Pestaña de Secretaría
// ═══════════════════════════════════════════════════════════════════

window.saSecretary = async function saSecretary() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
    <div style="max-width:600px;">
        <h3 style="margin:0 0 1rem;font-size:1rem;color:white;">✉️ Secretaría</h3>
        <p style="font-size:0.8rem;color:#8b949e;margin:0 0 1.2rem;">
            Envía invitaciones personalizadas a futuros usuarios para registrarse en la plataforma mediante Correo o WhatsApp.
        </p>
        <div style="display:flex;flex-direction:column;gap:0.8rem;">
            <!-- Método de envío -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:6px;">Método de envío</label>
                <div style="display:flex;gap:1.5rem;margin-bottom:4px;">
                    <label style="display:flex;align-items:center;gap:0.45rem;color:white;font-size:0.85rem;cursor:pointer;font-weight:600;">
                        <input type="radio" name="sec-method" value="email" checked onchange="window.saToggleMethod('email')" style="cursor:pointer;width:16px;height:16px;">
                        ✉️ Correo electrónico
                    </label>
                    <label style="display:flex;align-items:center;gap:0.45rem;color:white;font-size:0.85rem;cursor:pointer;font-weight:600;">
                        <input type="radio" name="sec-method" value="whatsapp" onchange="window.saToggleMethod('whatsapp')" style="cursor:pointer;width:16px;height:16px;">
                        💬 WhatsApp
                    </label>
                </div>
            </div>

            <!-- Nombre del destinatario -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del destinatario *</label>
                <input id="sec-name" type="text" placeholder="Ej: José Alberto" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Email de destino -->
            <div id="sec-email-block">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email de destino *</label>
                <input id="sec-email" type="email" placeholder="usuario@email.com" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Teléfono de destino (WhatsApp) -->
            <div id="sec-phone-block" style="display:none;">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Teléfono de destino *</label>
                <input id="sec-phone" type="tel" placeholder="Ej: 34600112233" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
                <span style="font-size:0.68rem;color:#8b949e;margin-top:2px;display:block;">Incluye el código de país (ej. 34 para España) sin el signo + ni espacios.</span>
            </div>

            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Rol asignado</label>
                <select id="sec-role" onchange="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
                    <option value="individual">👤 Entrenador Individual</option>
                    <option value="individual_admin">🛡️ Administrador Individual</option>
                    <option value="club_admin">🏟️ Administrador de Club</option>
                    <option value="user">⚽ Entrenador</option>
                    <option value="parent">👨‍👩‍👧 Padre/Madre/Tutor</option>
                    <option value="director">📋 Director Deportivo</option>
                    <option value="coordinator">🎯 Coordinador</option>
                </select>
            </div>

            <!-- Nombre del Club -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del Club (opcional)</label>
                <input id="sec-club" type="text" placeholder="Nombre del club si aplica" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Asunto (Email) -->
            <div id="sec-subject-block">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Asunto</label>
                <input id="sec-subject" type="text" value="Invitación a Chronos Fútbol"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Mensaje Personalizado -->
            <div>
                <div style="display:flex;justify-content:between;align-items:center;margin-bottom:4px;">
                    <label style="font-size:0.78rem;color:#8b949e;flex:1;">Mensaje predeterminado (puedes modificarlo)</label>
                    <button onclick="window.saResetInviteTemplate()"
                        style="background:none;border:none;color:#58a6ff;font-size:0.68rem;cursor:pointer;font-weight:700;padding:0;">
                        🔄 Restablecer predeterminado
                    </button>
                </div>
                <textarea id="sec-body" rows="6"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;resize:vertical;font-family:Inter,sans-serif;"></textarea>
            </div>

            <!-- Botón de Envío -->
            <button onclick="window.saSendInvite()"
                style="margin-top:0.5rem;padding:0.8rem;background:#58a6ff;border:none;
                       border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                       cursor:pointer;width:100%;display:flex;align-items:center;justify-content:center;gap:0.5rem;">
                <span id="sec-btn-text">✉️ Enviar Invitación por Email</span>
            </button>
        </div>
    </div>`;

    // Inicializar listeners y templates
    setTimeout(() => {
        const secBody = document.getElementById('sec-body');
        if (secBody) {
            secBody.addEventListener('input', () => {
                secBody.classList.add('user-edited');
            });
        }
        window.saUpdateInviteTemplate();
    }, 100);
};

// Alternar entre Email y WhatsApp en la interfaz
window.saToggleMethod = function(method) {
    const emailBlock = document.getElementById('sec-email-block');
    const phoneBlock = document.getElementById('sec-phone-block');
    const subjectBlock = document.getElementById('sec-subject-block');
    const btnText = document.getElementById('sec-btn-text');
    
    if (method === 'email') {
        if (emailBlock) emailBlock.style.display = 'block';
        if (phoneBlock) phoneBlock.style.display = 'none';
        if (subjectBlock) subjectBlock.style.display = 'block';
        if (btnText) btnText.innerHTML = '✉️ Enviar Invitación por Email';
    } else {
        if (emailBlock) emailBlock.style.display = 'none';
        if (phoneBlock) phoneBlock.style.display = 'block';
        if (subjectBlock) subjectBlock.style.display = 'none';
        if (btnText) btnText.innerHTML = '💬 Enviar Invitación por WhatsApp';
    }
    
    const secBody = document.getElementById('sec-body');
    if (secBody && !secBody.classList.contains('user-edited')) {
        window.saUpdateInviteTemplate();
    }
};

// Actualizar en tiempo real el mensaje adaptativo con el nombre y parámetros
window.saUpdateInviteTemplate = function() {
    const name = document.getElementById('sec-name')?.value.trim() || '';
    const roleVal = document.getElementById('sec-role')?.value || 'individual';
    const club = document.getElementById('sec-club')?.value.trim() || '';
    const email = document.getElementById('sec-email')?.value.trim() || '';
    const method = document.querySelector('input[name="sec-method"]:checked')?.value || 'email';
    
    const roleLabels = {
        individual: 'Entrenador Individual',
        club_admin: 'Administrador de Club',
        user: 'Entrenador',
        parent: 'Padre/Madre/Tutor',
        director: 'Director Deportivo',
        coordinator: 'Coordinador'
    };
    const roleLabel = roleLabels[roleVal] || 'Usuario';
    const clubText = club ? (' del club ' + club) : '';
    
    // Construir enlace de invitación que bypassa onboarding (fullscreen=true, invite=true)
    const inviteUrl = 'https://cronos-futbol-app.web.app/?invite=true' + (email ? '&email=' + encodeURIComponent(email) : '');
    
    let defaultText = '';
    if (method === 'email') {
        defaultText = `Hola, ${name || '[Nombre]'}:

Te damos la bienvenida a Chronos Fútbol. Has sido invitado a unirte a nuestra plataforma como ${roleLabel}${clubText}.

Chronos Fútbol es una aplicación innovadora diseñada para transformar la experiencia en el fútbol base, ayudando a que directivas, cuerpos técnicos, familias y profesionales colaboren en un mismo ecosistema para disfrutar al máximo de este deporte.

Te invitamos a formar parte de este proyecto y a descubrir cómo optimizar nuestro día a día. Para acceder directamente a la plataforma (con pantalla completa e instalación automática en tu móvil), haz clic en el siguiente enlace de invitación:

🔗 [ENLACE DE INVITACIÓN - SE AÑADE AUTOMÁTICAMENTE AL ENVIAR]

¡Muchas gracias por tu implicación y bienvenido a bordo!

Atentamente,
El Equipo de Chronos Fútbol`;
    } else {
        defaultText = `⚽ *Invitación a Chronos Fútbol* ⚽

¡Hola, *${name || '[Nombre]'}*! Te invito a unirte a Chronos Fútbol como *${roleLabel}*${club ? ' del club *' + club + '*' : ''}.

Completa tu registro y accede a la app aquí:
${inviteUrl}

¡Un saludo!`;
    }
    
    const secBody = document.getElementById('sec-body');
    if (secBody && !secBody.classList.contains('user-edited')) {
        secBody.value = defaultText;
    }
};

// Restablecer el mensaje al predeterminado de fábrica
window.saResetInviteTemplate = function() {
    const secBody = document.getElementById('sec-body');
    if (secBody) {
        secBody.classList.remove('user-edited');
        window.saUpdateInviteTemplate();
        _saToast('🔄 Mensaje restablecido al predeterminado', 2500);
    }
};

// Enrutador de envío
window.saSendInvite = async function() {
    const method = document.querySelector('input[name="sec-method"]:checked')?.value || 'email';
    const name = document.getElementById('sec-name')?.value.trim();
    if (!name) { _saToast('⚠️ El nombre del destinatario es obligatorio', 3000); return; }
    
    if (method === 'email') {
        await window.saSendInviteEmail();
    } else {
        window.saSendInviteWhatsApp();
    }
};

// Enviar email de invitación vía Cloud Function (con fallback a mailto local)
window.saSendInviteEmail = async function() {
    const name    = document.getElementById('sec-name')?.value.trim() || '';
    const to      = document.getElementById('sec-email')?.value.trim();
    const role    = document.getElementById('sec-role')?.value || 'individual';
    const clubName= document.getElementById('sec-club')?.value.trim() || '';
    const subject = document.getElementById('sec-subject')?.value.trim() || 'Invitación a Chronos Fútbol';
    const body    = document.getElementById('sec-body')?.value.trim() || '';

    if (!to) { _saToast('⚠️ El email de destino es obligatorio', 3000); return; }

    _saShowSpinner('Enviando invitación por email...');
    try {
        const { fa, httpsCallable } = await saFS();
        if (!fa.functions) throw new Error('Firebase Functions no disponible. Recarga la página.');
        const sendEmail = httpsCallable(fa.functions, 'sendInviteEmail');
        const result = await sendEmail({ to, subject, body, role, clubName });
        _saHideSpinner();

        const d = result.data || {};

        if (d.success === true) {
            // ✅ Email enviado correctamente por el servidor
            _saToast('✅ Invitación enviada con éxito a ' + to, 5000);
            _limpiarFormularioSecretaria();
        } else if (d.noCredentials || d.error) {
            // ⚠️ El servidor no tiene credenciales configuradas o Nodemailer falló
            // → Usamos mailto automáticamente sin molestar al usuario con confirm()
            const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            const motivo = d.noCredentials
                ? 'El servidor no tiene credenciales Gmail configuradas.'
                : 'Error del servidor: ' + d.error;
            console.warn('[saSendInviteEmail] Fallback a mailto. Motivo:', motivo);
            _saToast('📧 Abriendo tu correo local para enviar la invitación...', 4000);
            window.open(mailtoUrl, '_self');
            _limpiarFormularioSecretaria();
        } else {
            _saToast('⚠️ Respuesta inesperada del servidor. Revisa la consola.', 4000);
            console.warn('[saSendInviteEmail] Respuesta inesperada:', d);
        }
    } catch (e) {
        _saHideSpinner();
        console.error('[saSendInviteEmail]', e);
        // Fallback a mailto como último recurso
        if (confirm(`⚠️ Error de conexión con el servidor.\n\n¿Abrir tu cliente de correo para enviar la invitación manualmente?`)) {
            const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.open(mailtoUrl, '_self');
            _saToast('📧 Abriendo cliente de correo...', 3000);
            _limpiarFormularioSecretaria();
        }
    }
};

// Helper: limpiar formulario de secretaría tras envío
function _limpiarFormularioSecretaria() {
    const fields = ['sec-email', 'sec-name', 'sec-phone'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const secBody = document.getElementById('sec-body');
    if (secBody) secBody.classList.remove('user-edited');
    window.saUpdateInviteTemplate?.();
}


// Enviar invitación vía WhatsApp Web/App
window.saSendInviteWhatsApp = function() {
    const name  = document.getElementById('sec-name')?.value.trim() || '';
    const phone = document.getElementById('sec-phone')?.value.trim();
    const body  = document.getElementById('sec-body')?.value.trim() || '';

    if (!phone) { _saToast('⚠️ El teléfono de destino es obligatorio', 3000); return; }

    // Limpiar caracteres del número telefónico
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 7) { _saToast('⚠️ El número de teléfono no parece ser válido', 3000); return; }

    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`;
    window.open(waUrl, '_blank');
    _saToast('✅ Abriendo WhatsApp...', 3000);
    
    // Limpiar campos
    document.getElementById('sec-phone').value = '';
    document.getElementById('sec-name').value = '';
    const secBody = document.getElementById('sec-body');
    if (secBody) secBody.classList.remove('user-edited');
    window.saUpdateInviteTemplate();
};

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
                    console.log('[saQuickApprove] hasAdmin actualizado a true en entidad:', _indEntityId);
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
                            console.log('[saApprove] Custom claims asignados a club_admin', id, clubId);
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
                            console.log('[saApprove] Custom claims asignados a individual_admin', id, _indEntityId);
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
                                console.log('[saApprove] Custom claims asignados a usuario individual', id, u.role, _indEntityIdOther);
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
                            console.log('[saApprove] Custom claims asignados a club_admin (user_request)', r.userUid, newClubId);
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
                            console.log('[saApprove] Custom claims asignados a individual_admin (user_request)', r.userUid, _indEntityId3);
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
                            console.log('[saApprove] Custom claims asignados a', r.requestedRole, r.userUid, _claimClubId);
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
                    var resB = await httpsCallable(fa.functions,'deleteAuthUser')({uid:realUid,email:realEmail});
                    console.log('[saSetClubUserStatus] deleteAuthUser OK:', realEmail, resB && resB.data);
                } catch(cfErr) {
                    console.error('[saSetClubUserStatus] deleteAuthUser FALLÓ:', cfErr && cfErr.code, cfErr && cfErr.message);
                    var codeB = (cfErr.details && cfErr.details.code) || cfErr.code || '';
                    if (codeB !== 'auth/user-not-found') {
                        // Registrar el fallo de forma persistente para revisión manual
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
                        _saToast('🚫 No se pudo eliminar la cuenta de acceso (' + (cfErr.message || codeB) + '). Borrado cancelado. Registrado para revisión.', 6000);
                        return;
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
                        console.log('[saSetClubUserStatus] hasAdmin actualizado a true en entidad:', _entityId);
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
                            console.log('[saSetClubUserStatus] hasAdmin actualizado a false en entidad:', _entityId);
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
// saTrash()
// ═══════════════════════════════════════════════════════════════════

window.saTrash = async function saTrash() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center;padding:2.5rem;color:#8b949e;"><div style="font-size:1.6rem;">⏳</div>Cargando rastros…</div>`;
    try {
        const { db, collection, query, where, getDocs } = await saFS();
        const snap = await getDocs(query(collection(db,'users'),where('status','in',['removed','blocked'])));
        const users = [];
        snap.forEach(d => users.push({id:d.id,...d.data()}));
        if (!users.length) {
            body.innerHTML = `<div style="text-align:center;padding:3rem;color:#8b949e;"><div style="font-size:2rem;">✅</div>Sin rastros pendientes.</div>`;
            return;
        }
        const fmt = iso => iso ? new Date(iso).toLocaleDateString('es-ES') : '–';
        const _escH2 = typeof escapeHtml==='function'?escapeHtml:function(s){return s;};
        const row = (u, brgb, btns) => `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(${brgb},0.3);border-radius:8px;padding:0.62rem 0.72rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;"><div><div style="font-weight:700;color:white;font-size:0.82rem;">${_escH2(u.email||u.id)}</div><div style="font-size:0.69rem;color:#8b949e;">${window.ROLE_META[u.role]?.label||u.role||'?'} · ${_escH2(u.clubName||'')} · ${u.status==='removed'?'Baja: '+fmt(u.removedAt):'Bloq: '+fmt(u.blockedAt)}${u.authDeleted?' · <span style="color:#3fb950">✅ Auth limpio</span>':''}</div></div><div style="display:flex;gap:0.25rem;flex-shrink:0;">${btns}</div></div>`;
        const removed = users.filter(u=>u.status==='removed');
        const blocked = users.filter(u=>u.status==='blocked');
        const _escO = typeof escapeAttr==='function'?escapeAttr:function(s){return s;};
        let html = '';
        if (removed.length) {
            html += `<h3 style="color:#ff5858;margin:0 0 0.6rem;font-size:0.9rem;">🗑️ Dados de baja (${removed.length})</h3>`;
            html += removed.map(u=>row(u,'255,88,88',`<button onclick="saReactivateAsIndividual('${_escO(u.id).replace(/'/g,"\\'")}','${_escO(u.email||u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' )" style="padding:0.28rem 0.58rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:5px;color:#3fb950;font-size:0.7rem;cursor:pointer;font-weight:700;">🔄 Reactivar</button><button onclick="saPurgeUser('${_escO(u.id).replace(/'/g,"\\'")}','${_escO(u.email||u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' )" style="padding:0.28rem 0.58rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:5px;color:#ff5858;font-size:0.7rem;cursor:pointer;font-weight:700;">🗑️ Limpiar</button>`)).join('');
            html += '<div style="margin-bottom:1.2rem;"></div>';
        }
        if (blocked.length) {
            html += `<h3 style="color:#f0883e;margin:0 0 0.6rem;font-size:0.9rem;">🔒 Bloqueados (${blocked.length})</h3>`;
            html += blocked.map(u=>row(u,'240,136,62',`<button onclick="saSetClubUserStatus('${_escO(u.id).replace(/'/g,"\\'")}','${_escO(u.email||u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}','active','${_escO(u.clubId||'').replace(/'/g,"\\'")}')" style="padding:0.28rem 0.58rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:5px;color:#3fb950;font-size:0.7rem;cursor:pointer;font-weight:700;">✅</button><button onclick="saPurgeUser('${_escO(u.id).replace(/'/g,"\\'")}','${_escO(u.email||u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' )" style="padding:0.28rem 0.58rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:5px;color:#ff5858;font-size:0.7rem;cursor:pointer;font-weight:700;">🗑️</button>`)).join('');
        }
        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</p>`;
    }
};

// Reactivar un usuario dado de baja como individual
window.saReactivateAsIndividual = async function(uid, email) {
    if (!confirm('🔄 REACTIVAR a ' + email + '\n\nSe reactivará como usuario individual. ¿Confirmar?')) return;
    _saShowSpinner('Reactivando...');
    try {
        const { db, doc, getDoc, updateDoc } = await saFS();
        const uSnap = await getDoc(doc(db,'users',uid));
        if (!uSnap.exists()) throw new Error('Usuario no encontrado');
        const uData = uSnap.data();
        const me = window._cronosCurrentUser?.email || 'superadmin';

        // Reactivar con rol individual
        const newRole = uData.role || 'individual';
        const updAllRoles = (uData.allRoles||[]).map(r =>
            ({...r, isAuthorized:true, status:'active'})
        );
        if (!updAllRoles.some(r => r.role === newRole)) {
            updAllRoles.push({ role:newRole, isAuthorized:true, status:'active', clubId:null });
        }

        await updateDoc(doc(db,'users',uid), {
            isAuthorized:  true,
            status:        'active',
            allRoles:      updAllRoles,
            removedAt:     null,
            blockedAt:     null,
            reactivatedAt: new Date().toISOString(),
            reactivatedBy: me,
        });

        _saHideSpinner();
        _saToast('✅ ' + email + ' reactivado correctamente.', 4000);
        saTrash();
    } catch (e) {
        _saHideSpinner();
        _saToast('⚠️ Error: ' + e.message, 4000);
        console.error('[saReactivateAsIndividual]', e);
    }
};

window.saPurgeUser = async function saPurgeUser(uid, email) {
    if (!confirm('\uD83D\uDDD1\uFE0F LIMPIAR RASTRO: ' + email + '\n\nIRREVERSIBLE. \u00bfConfirmar?')) return;
    _saShowSpinner('Limpiando\u2026');
    try {
        const { db, fa, doc, getDoc, deleteDoc, collection, getDocs, query, where, setDoc, httpsCallable } = await saFS();

        // 1. Leer documento para obtener uid real y todos los roles
        var uSnap = await getDoc(doc(db, 'users', uid));
        var uData = uSnap.exists() ? uSnap.data() : {};
        var realUid = uData.uid || uid;
        var realEmail = uData.email || email;

        var primarySnap = (realUid !== uid)
            ? await getDoc(doc(db, 'users', realUid)).catch(function() { return null; })
            : uSnap;
        var allRoles = [];
        if (primarySnap && primarySnap.exists()) {
            allRoles = primarySnap.data().allRoles || [];
        } else if (uData.allRoles) {
            allRoles = uData.allRoles;
        }

        // 2. Eliminar cuenta de Firebase Auth ANTES de borrar docs.
        //    saPurgeUser es la limpieza FINAL de la papelera: borra la cuenta
        //    Auth completa. El fallo NO se ignora: se registra para revisión.
        if (httpsCallable && fa.functions) {
            try {
                var resP = await httpsCallable(fa.functions,'deleteAuthUser')({uid:realUid,email:realEmail});
                console.log('[saPurgeUser] deleteAuthUser OK:', realEmail, resP && resP.data);
            } catch(cfErr) {
                console.error('[saPurgeUser] deleteAuthUser FALLÓ:', cfErr && cfErr.code, cfErr && cfErr.message);
                var codeP = (cfErr.details && cfErr.details.code) || cfErr.code || '';
                if (codeP !== 'auth/user-not-found') {
                    // Registrar el fallo de forma persistente para revisión manual
                    try {
                        var _meP = window._cronosCurrentUser || {};
                        await setDoc(doc(db, 'auth_deletion_failures', realUid + '_' + Date.now()), {
                            uid: realUid, email: realEmail, clubId: uData.clubId || null,
                            errorCode: codeP || null,
                            errorMessage: (cfErr && cfErr.message) || String(cfErr),
                            requestedBy: _meP.uid || null, requestedByEmail: _meP.email || null,
                            createdAt: new Date().toISOString()
                        });
                    } catch(_) {}
                    _saToast('🚫 No se pudo eliminar la cuenta de acceso (' + (cfErr.message || codeP) + '). Purga cancelada. Registrado para revisión.', 6000);
                    return;
                }
            }
        }

        // 3. Eliminar documentos secundarios
        for (var si2 = 0; si2 < allRoles.length; si2++) {
            var secId = realUid + '_' + allRoles[si2].role + '_' + (allRoles[si2].clubId || 'global');
            if (secId !== realUid) {
                try { await deleteDoc(doc(db, 'users', secId)); } catch (_) {}
            }
        }

        // 3. Eliminar documento primario
        try { await deleteDoc(doc(db, 'users', realUid)); } catch (_) {}
        if (uid !== realUid) {
            try { await deleteDoc(doc(db, 'users', uid)); } catch (_) {}
        }

        // 4. Eliminar enlaces de jugador
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

        _saHideSpinner();
        _saToast('\u2705 Rastro de ' + email + ' eliminado completamente.', 3000);
        saTrash();
    } catch (e) { _saHideSpinner(); _saToast('\u26A0\uFE0F '+e.message,4000); }
};

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



window.saDeleteClubComplete = async function(clubId, clubName) {
    if (!confirm(
        '\u26a0\ufe0f BORRADO COMPLETO DEL CLUB\n\n' +
        'Club: ' + clubName + '\n\n' +
        'Esto hard\u00e1 lo siguiente:\n' +
        '\u2022 Borrar\u00e1 el documento del club\n' +
        '\u2022 Eliminar\u00e1 el clubId de todos sus usuarios\n' +
        '\u2022 Borrar\u00e1 todas sus platform_requests\n' +
        '\u2022 Los usuarios quedar\u00e1n libres para re-registrarse con el mismo email\n\n' +
        '\u00bfConfirmas el borrado completo?'
    )) return;

    _saShowSpinner('Borrando club y reseteando usuarios...');
    try {
        const { db, doc, deleteDoc, collection, getDocs, query, where, updateDoc } = await saFS();

        // 1. Todos los usuarios que tengan ese clubId en su doc principal O en allRoles
        // Incluye también el SA u otros usuarios con roles en ese club
        const [usersSnap, allUsersSnap] = await Promise.all([
            getDocs(query(collection(db,'users'), where('clubId','==',clubId))),
            getDocs(collection(db,'users')), // para encontrar usuarios con allRoles del club
        ]);

        // Unir IDs únicos de ambas consultas
        const affectedUsers = new Map();
        usersSnap.forEach(d => affectedUsers.set(d.id, d));
        allUsersSnap.forEach(d => {
            const data = d.data();
            const hasRoleInClub = (data.allRoles||[]).some(r => r.clubId === clubId);
            if (hasRoleInClub) affectedUsers.set(d.id, d);
        });

        const userOps = [];
        affectedUsers.forEach((uDoc) => {
            const uData = uDoc.data();
            const cleanRoles = (uData.allRoles || []).filter(r => r.clubId !== clubId);
            const hasOtherActive = cleanRoles.some(r => r.isAuthorized);
            const isSA = uData.role === 'superadmin';

            if (isSA) {
                // SA: solo limpiar allRoles, mantener su rol de SA intacto
                userOps.push(updateDoc(doc(db,'users',uDoc.id), {
                    allRoles: cleanRoles,
                }));
            } else {
                userOps.push(updateDoc(doc(db,'users',uDoc.id), {
                    clubId:       uData.clubId === clubId ? null : uData.clubId,
                    clubName:     uData.clubId === clubId ? null : uData.clubName,
                    allRoles:     cleanRoles,
                    role:         hasOtherActive ? (cleanRoles.find(r=>r.isAuthorized)||{}).role || null : null,
                    status:       hasOtherActive ? 'active' : 'free',
                    isAuthorized: hasOtherActive,
                }));
            }
        });
        await Promise.all(userOps);

        // 2. Borrar platform_requests del club (por clubId)
        const prSnap = await getDocs(query(collection(db,'platform_requests'), where('clubId','==',clubId)));
        const prOps = [];
        prSnap.forEach(d => prOps.push(deleteDoc(doc(db,'platform_requests',d.id))));
        await Promise.all(prOps);

        // 2b. También borrar platform_requests por userUid de cada usuario del club
        // (cubre solicitudes sin clubId, como club_admin e individual)
        const prOps2 = [];
        affectedUsers.forEach((uDoc) => {
            const uid2 = uDoc.id;
            getDocs(query(collection(db,'platform_requests'), where('userUid','==',uid2)))
                .then(snap2 => {
                    snap2.forEach(d2 => deleteDoc(doc(db,'platform_requests',d2.id)).catch(()=>{}));
                }).catch(()=>{});
        });

        // 3. Borrar el club
        await deleteDoc(doc(db,'clubs',clubId));

        _saHideSpinner();
        _saToast('\u2705 Club "' + clubName + '" borrado. ' + usersSnap.size + ' usuario(s) reseteados. Pueden re-registrarse con los mismos correos.', 7000);
        saTab('clubs');

    } catch(e) {
        _saHideSpinner();
        _saToast('\u274c Error al borrar: ' + e.message, 5000);
        console.error('[saDeleteClubComplete]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// CREAR ENTE INDIVIDUAL (entidad en clubs con type=individual)
// ═══════════════════════════════════════════════════════════════════

window.saShowCreateIndividualEntity = function() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="max-width:520px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="saTab('individuals')" class="sa-btn"
                    style="color:#79c0ff;border-color:rgba(121,192,255,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">👤 Crear Ente Individual</h3>
            </div>
            <p style="font-size:0.8rem;color:#8b949e;margin-bottom:1.2rem;">
                Un ente individual es una entidad independiente (sin club fisico) donde se registran
                administradores individuales, entrenadores individuales y padres/madres/tutores individuales.
                Es necesario crear al menos un ente individual antes de poder registrar usuarios individuales.
            </p>
            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del Ente Individual *</label>
                    <input id="cie-name" type="text" placeholder="Ej: Ente Individual - Entrenadores Libres"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;">
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Admins Ind.</label>
                        <input id="cie-admins" type="number" value="5" min="0" max="50"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Entrenadores Ind.</label>
                        <input id="cie-coaches" type="number" value="50" min="0" max="500"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Padres Ind.</label>
                        <input id="cie-parents" type="number" value="100" min="0" max="1000"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Plan</label>
                    <select id="cie-plan"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="free">🆓 Free</option>
                        <option value="basic">⭐ Basic</option>
                        <option value="pro">🚀 Pro</option>
                    </select>
                </div>
                <button onclick="saCreateIndividualEntityConfirm()"
                    style="margin-top:0.5rem;padding:0.8rem;background:#79c0ff;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Crear Ente Individual
                </button>
            </div>
        </div>`;
};

window.saCreateIndividualEntityConfirm = async function() {
    const name      = document.getElementById('cie-name')?.value.trim();
    const adminS    = parseInt(document.getElementById('cie-admins')?.value)   || 5;
    const coachS    = parseInt(document.getElementById('cie-coaches')?.value)  || 50;
    const parS      = parseInt(document.getElementById('cie-parents')?.value)  || 100;
    const plan      = document.getElementById('cie-plan')?.value || 'free';

    if (!name) { _saToast('⚠️ El nombre del ente individual es obligatorio', 3000); return; }

    _saShowSpinner('Creando ente individual...');
    try {
        const { db, doc, setDoc } = await saFS();
        const entityId = 'individual_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,4);
        await setDoc(doc(db, 'clubs', entityId), {
            name,
            type:           'individual',
            plan,
            status:         'active',
            hasAdmin:       false,
            adminEmail:     null,
            adminUid:       null,
            adminName:      null,
            email:          null,
            slots:          { admins: adminS, coaches: coachS, parents: parS },
            usedSlots:      { admins: 0,      coaches: 0,     parents: 0    },
            createdAt:      new Date().toISOString(),
            createdBySA:    window._cronosCurrentUser?.email || 'superadmin',
        });
        _saHideSpinner();
        _saToast('✅ Ente individual "' + name + '" creado correctamente. Ya puedes anadir usuarios individuales.', 6000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saCreateIndividualEntityConfirm]', e);
    }
};

// Editar ente individual (slots y plan)
window.saEditIndividualEntity = async function(entityId) {
    const { db, doc, getDoc } = await saFS();
    const snap = await getDoc(doc(db,'clubs',entityId));
    if (!snap.exists()) { _saToast('Ente no encontrado', 3000); return; }
    const c = snap.data();
    const _escH = typeof escapeHtml==='function'?escapeHtml:function(s){return s;};
    const _escA = typeof escapeAttr==='function'?escapeAttr:function(s){return s;};

    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <div style="max-width:520px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="saTab('individuals')" class="sa-btn"
                    style="color:#79c0ff;border-color:rgba(121,192,255,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">✏️ Editar Ente Individual: ${_escH(c.name||entityId)}</h3>
            </div>
            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del Ente</label>
                    <input id="eie-name" type="text" value="${_escA(c.name||'')}"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;">
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Admins Ind.</label>
                        <input id="eie-admins" type="number" value="${c.slots?.admins ?? 5}" min="0" max="50"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Entrenadores Ind.</label>
                        <input id="eie-coaches" type="number" value="${c.slots?.coaches ?? 50}" min="0" max="500"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Padres Ind.</label>
                        <input id="eie-parents" type="number" value="${c.slots?.parents ?? 100}" min="0" max="1000"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Plan</label>
                    <select id="eie-plan"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="free" ${c.plan==='free'?'selected':''}>🆓 Free</option>
                        <option value="basic" ${c.plan==='basic'?'selected':''}>⭐ Basic</option>
                        <option value="pro" ${c.plan==='pro'?'selected':''}>🚀 Pro</option>
                    </select>
                </div>
                <button onclick="saEditIndividualEntityConfirm('${_escA(entityId).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')"
                    style="margin-top:0.5rem;padding:0.8rem;background:#79c0ff;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Guardar Cambios
                </button>
            </div>
        </div>`;
};

window.saEditIndividualEntityConfirm = async function(entityId) {
    const name     = document.getElementById('eie-name')?.value.trim();
    const adminS   = parseInt(document.getElementById('eie-admins')?.value)   || 5;
    const coachS   = parseInt(document.getElementById('eie-coaches')?.value)  || 50;
    const parS     = parseInt(document.getElementById('eie-parents')?.value)  || 100;
    const plan     = document.getElementById('eie-plan')?.value || 'free';

    if (!name) { _saToast('⚠️ El nombre es obligatorio', 3000); return; }

    _saShowSpinner('Guardando cambios...');
    try {
        const { db, doc, updateDoc } = await saFS();
        await updateDoc(doc(db, 'clubs', entityId), {
            name,
            plan,
            slots: { admins: adminS, coaches: coachS, parents: parS },
        });
        _saHideSpinner();
        _saToast('✅ Ente individual actualizado.', 4000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saEditIndividualEntityConfirm]', e);
    }
};

// Eliminar ente individual
window.saDeleteIndividualEntity = async function(entityId, entityName) {
    if (!confirm('🗑️ ¿ELIMINAR el ente individual "' + entityName + '"?\n\nSe eliminara el ente pero NO los usuarios asociados. Los usuarios quedaran sin ente asignado.')) return;

    _saShowSpinner('Eliminando ente individual...');
    try {
        const { db, doc, deleteDoc } = await saFS();
        await deleteDoc(doc(db, 'clubs', entityId));
        _saHideSpinner();
        _saToast('✅ Ente individual eliminado.', 4000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saDeleteIndividualEntity]', e);
    }
};

// Ver usuarios de un ente individual
window.saShowEntityUsers = async function(entityId) {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center;padding:2.5rem;color:#8b949e;"><div style="font-size:1.6rem;">⏳</div>Cargando usuarios…</div>`;
    try {
        const { db, collection, query, where, getDocs } = await saFS();
        // CRITICAL: Query by both clubId AND individualEntityId to find all users linked to this entity
        const snapByClubId = await getDocs(query(collection(db,'users'), where('clubId','==',entityId)));
        const snapByIndivId = await getDocs(query(collection(db,'users'), where('individualEntityId','==',entityId)));
        const snapByOwnerId = await getDocs(query(collection(db,'users'), where('individualOwnerId','==',entityId))).catch(()=>({forEach:()=>{}}));
        // Merge results, avoiding duplicates by user ID
        const userMap = new Map();
        snapByClubId.forEach(d => { if (!userMap.has(d.id)) userMap.set(d.id, { id:d.id, ...d.data() }); });
        snapByIndivId.forEach(d => { if (!userMap.has(d.id)) userMap.set(d.id, { id:d.id, ...d.data() }); });
        snapByOwnerId.forEach(d => { if (!userMap.has(d.id)) userMap.set(d.id, { id:d.id, ...d.data() }); });
        const users = Array.from(userMap.values());

        const stColor = { active:'#3fb950', blocked:'#f0883e', removed:'#ff5858', pending:'#ffd700', pending_club:'#ffa500', pending_register:'#79c0ff', pending_sa:'#79c0ff', pending_individual:'#ffa500' };
        const stLabel = { active:'Activo', blocked:'Bloqueado', removed:'Baja', pending:'⏳ Pend.SA', pending_club:'⏳ Pend.Club', pending_register:'⏳ Sin registrar', pending_sa:'⏳ Pend.SA', pending_individual:'⏳ Pend.Indiv.' };

        let html = `
        <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1rem;">
            <button onclick="saTab('individuals')" class="sa-btn" style="color:#79c0ff;border-color:rgba(121,192,255,0.3);">← Volver</button>
            <h3 style="margin:0;font-size:1rem;">📋 Usuarios del Ente (${users.length})</h3>
        </div>`;

        if (!users.length) {
            html += `<div style="text-align:center;padding:2rem;color:#8b949e;">Sin usuarios registrados en este ente.</div>`;
        } else {
            const _escH = typeof escapeHtml==='function'?escapeHtml:function(s){return s;};
            const _escA = typeof escapeAttr==='function'?escapeAttr:function(s){return s;};
            users.forEach(u => {
                const st = u.status || (u.isAuthorized?'active':'pending');
                const meta = window.ROLE_META[u.role] || { icon:'👤', color:'#8b949e', label:u.role||'?' };
                const eid = _escA(u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
                const em  = _escA(u.email||u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
                html += `
                <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:0.7rem 0.85rem;margin-bottom:0.5rem;display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:0.6rem;flex:1;min-width:0;">
                        <span style="font-size:1.2rem;">${meta.icon}</span>
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:600;font-size:0.85rem;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escH(u.email||u.id)}</div>
                            <div style="font-size:0.72rem;color:${stColor[st]||'#8b949e'};">${_escH(u.displayName||'')} · ${meta.label} · ${stLabel[st]||st}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:0.25rem;flex-shrink:0;">
                        ${st==='pending'||st==='pending_register'||st==='pending_sa'||st==='pending_individual'?`<button onclick="saActivateIndividual('${eid}','${em}')" style="padding:0.22rem 0.5rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:5px;color:#3fb950;font-size:0.7rem;cursor:pointer;font-weight:700;">✅ Activar</button>`:''}
                        ${st==='active'?`<button onclick="saSetClubUserStatus('${eid}','${em}','blocked','${_escA(entityId).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')" style="padding:0.22rem 0.5rem;background:rgba(240,136,62,0.15);border:1px solid rgba(240,136,62,0.4);border-radius:5px;color:#f0883e;font-size:0.7rem;cursor:pointer;">🔒</button>`:''}
                        ${st==='blocked'?`<button onclick="saSetClubUserStatus('${eid}','${em}','active','${_escA(entityId).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')" style="padding:0.22rem 0.5rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:5px;color:#3fb950;font-size:0.7rem;cursor:pointer;">✅</button>`:''}
                        ${st!=='removed'?`<button onclick="saSetClubUserStatus('${eid}','${em}','removed','${_escA(entityId).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')" style="padding:0.22rem 0.5rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:5px;color:#ff5858;font-size:0.7rem;cursor:pointer;">🗑️</button>`:''}
                    </div>
                </div>`;
            });
        }
        body.innerHTML = html;
    } catch(e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${e.message}</p>`;
        console.error('[saShowEntityUsers]', e);
    }
};

// Crear usuario individual para un ente específico
window.saShowCreateIndividualForEntity = function(entityId) {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="max-width:480px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="saTab('individuals')" class="sa-btn"
                    style="color:#79c0ff;border-color:rgba(121,192,255,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">👤 Anadir Usuario al Ente</h3>
            </div>
            <p style="font-size:0.8rem;color:#8b949e;margin-bottom:1.2rem;">
                Crea un usuario individual pre-aprobado y asignalo a este ente individual.
            </p>
            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email del usuario *</label>
                    <input id="cife-email" type="email" placeholder="usuario@email.com"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre completo</label>
                    <input id="cife-name" type="text" placeholder="Nombre y Apellidos"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Rol individual</label>
                    <select id="cife-role"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="admin_individual">⚙️ Administrador Individual</option>
                        <option value="individual">⚙️ Administrador Individual (registro auth.js)</option>
                        <option value="user">⚽ Entrenador Individual</option>
                        <option value="entrenador_individual">⚽ Entrenador Individual (alternativo)</option>
                        <option value="parent_individual">👨‍👩‍👧 Padre/Madre/Tutor Individual</option>
                    </select>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <input id="cife-sendemail" type="checkbox" checked
                        style="width:1.1rem;height:1.1rem;accent-color:#3fb950;cursor:pointer;">
                    <label for="cife-sendemail" style="font-size:0.82rem;color:#cdd9e5;cursor:pointer;">
                        Enviar email de invitacion al usuario
                    </label>
                </div>
                <button onclick="saCreateIndividualForEntityConfirm('${typeof escapeAttr==='function'?escapeAttr(entityId).replace(/\\/g,'\\\\').replace(/'/g,"\\'"):entityId}')"
                    style="margin-top:0.5rem;padding:0.8rem;background:#3fb950;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Crear y Asignar Usuario
                </button>
            </div>
        </div>`;
};

window.saCreateIndividualForEntityConfirm = async function(entityId) {
    const email     = document.getElementById('cife-email')?.value.trim();
    const name      = document.getElementById('cife-name')?.value.trim() || '';
    const role      = document.getElementById('cife-role')?.value || 'individual';
    const sendEmail = document.getElementById('cife-sendemail')?.checked || false;

    if (!email) { _saToast('⚠️ El email es obligatorio', 3000); return; }

    _saShowSpinner('Creando usuario individual...');
    try {
        const { db, doc, setDoc, updateDoc, getDoc, collection, query, where, getDocs, fa, httpsCallable } = await saFS();
        const me = window._cronosCurrentUser?.email || 'superadmin';

        // Verificar si ya existe
        const existing = await getDocs(query(collection(db,'users'), where('email','==',email))).catch(()=>null);

        if (existing && !existing.empty) {
            const existingDoc = existing.docs[0];
            const existingData = existingDoc.data();
            const existingStatus = existingData.status;
            const existingId = existingDoc.id;

            if (existingStatus === 'removed' || existingStatus === 'blocked') {
                const updAllRoles = (existingData.allRoles||[]).map(r =>
                    r.role === role ? {...r, isAuthorized:true, status:'active', clubId:entityId} : r
                );
                if (!updAllRoles.some(r => r.role === role)) {
                    updAllRoles.push({ role:role, isAuthorized:true, status:'active', clubId:entityId });
                }

                await updateDoc(doc(db, 'users', existingId), {
                    role:          role,
                    clubId:        entityId,
                    displayName:   name || existingData.displayName || '',
                    isAuthorized:  true,
                    status:        'active',
                    allRoles:      updAllRoles,
                    removedAt:     null,
                    blockedAt:     null,
                    reactivatedAt: new Date().toISOString(),
                    reactivatedBy: me,
                    authorizedAt:  new Date().toISOString(),
                    authorizedBy:  me,
                });

                _saHideSpinner();
                _saToast('✅ ' + email + ' reactivado y asignado al ente individual.', 5000);
                saTab('individuals');
                return;
            } else {
                _saHideSpinner();
                _saToast('⚠️ Ya existe un usuario activo con ese email (' + (existingStatus||'activo') + ').', 6000);
                return;
            }
        }

        // Crear nuevo usuario individual
        const preId = 'individual_pre_' + Date.now().toString(36);
        await setDoc(doc(db, 'users', preId), {
            email,
            displayName:  name,
            firstName:    name,
            role:         role,
            clubId:       entityId,
            isAuthorized: true,
            status:       'active',
            isIndividual: true,
            individualEntityId: entityId,
            individualOwnerId:  entityId,
            individualOwnerEmail: null,
            allRoles: [{
                role:         role,
                isAuthorized: true,
                status:       'active',
                clubId:       entityId,
                individualEntityId: entityId,
            }],
            approvedBySA:    true,
            approvedBySAAt:  new Date().toISOString(),
            approvedBySABy:  me,
            createdAt:       new Date().toISOString(),
        });

        // Actualizar usedSlots y hasAdmin del ente individual
        try {
            const entSnap = await getDoc(doc(db, 'clubs', entityId));
            if (entSnap.exists()) {
                const slotKey = role === 'admin_individual' ? 'admins'
                              : role === 'parent_individual' ? 'parents'
                              : role === 'individual' ? 'admins'  // 'individual' from auth.js = admin individual
                              : role === 'entrenador_individual' ? 'coaches'  // 'entrenador_individual' = entrenador individual
                              : 'coaches';  // 'user' = entrenador individual
                const currentUsed = entSnap.data().usedSlots?.[slotKey] || 0;
                const updateData = {
                    ['usedSlots.' + slotKey]: currentUsed + 1,
                };
                // Si es admin_individual o individual, marcar hasAdmin y registrar adminEmail
                if (role === 'admin_individual' || role === 'individual') {
                    updateData.hasAdmin = true;
                    updateData.adminEmail = email;
                    updateData.adminName = name || email;
                    updateData.adminUid = preId;
                }
                await updateDoc(doc(db, 'clubs', entityId), updateData);
            }
        } catch(se) { console.warn('[saCreateIndividualForEntityConfirm] usedSlots update failed:', se.message); }

        // Enviar email
        if (sendEmail && fa.functions) {
            try {
                const sendEmailFn = httpsCallable(fa.functions, 'sendInviteEmail');
                await sendEmailFn({ to:email, role:role, clubName:'' });
            } catch(ee) { console.warn('[saCreateIndividualForEntityConfirm] Email no enviado:', ee.message); }
        }

        _saHideSpinner();
        _saToast('✅ Usuario individual creado y asignado al ente. ' + email + ' puede registrarse y acceder directamente.', 6000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saCreateIndividualForEntityConfirm]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// CREAR CLUB directamente desde SA
// ═══════════════════════════════════════════════════════════════════
window.saShowCreateClub = function() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="max-width:520px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="saTab('clubs')" class="sa-btn"
                    style="color:#58a6ff;border-color:rgba(88,166,255,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">🏟️ Crear Nuevo Club</h3>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del Club *</label>
                    <input id="cc-name" type="text" placeholder="Ej: Club Deportivo José"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email del Administrador del Club *</label>
                    <input id="cc-email" type="email" placeholder="admin@club.com"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Directores</label>
                        <input id="cc-dir" type="number" value="1" min="0" max="10"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Coordinadores</label>
                        <input id="cc-coord" type="number" value="2" min="0" max="20"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Entrenadores</label>
                        <input id="cc-coach" type="number" value="10" min="0" max="100"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Slots Padres/Tutores</label>
                        <input id="cc-parents" type="number" value="50" min="0" max="500"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                    </div>
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Plan</label>
                    <select id="cc-plan"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="free">🆓 Free</option>
                        <option value="basic">⭐ Basic</option>
                        <option value="pro">🚀 Pro</option>
                    </select>
                </div>
                <button onclick="saCreateClubConfirm()"
                    style="margin-top:0.5rem;padding:0.8rem;background:#58a6ff;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Crear Club
                </button>
            </div>
        </div>`;
};

window.saCreateClubConfirm = async function() {
    const name   = document.getElementById('cc-name')?.value.trim();
    const email  = document.getElementById('cc-email')?.value.trim();
    const dirS   = parseInt(document.getElementById('cc-dir')?.value)     || 1;
    const coS    = parseInt(document.getElementById('cc-coord')?.value)    || 2;
    const coachS = parseInt(document.getElementById('cc-coach')?.value)    || 10;
    const parS   = parseInt(document.getElementById('cc-parents')?.value)  || 50;
    const plan   = document.getElementById('cc-plan')?.value || 'free';

    if (!name)  { _saToast('⚠️ El nombre del club es obligatorio', 3000); return; }
    if (!email) { _saToast('⚠️ El email del administrador es obligatorio', 3000); return; }

    _saShowSpinner('Creando club...');
    try {
        const { db, doc, setDoc, collection } = await saFS();
        const clubId = 'club_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,4);
        await setDoc(doc(db, 'clubs', clubId), {
            name,
            adminEmail:    email,
            adminUid:      null, // se rellena cuando el admin se registra/aprueba (regla isClubAdminOf usa adminEmail como fallback hasta entonces)
            plan,
            status:        'active',
            slots:         { directors: dirS, coordinators: coS, users: coachS, parents: parS },
            usedSlots:     { directors: 0,    coordinators: 0,   users: 0,      parents: 0    },
            createdAt:     new Date().toISOString(),
            createdBySA:   window._cronosCurrentUser?.email || 'superadmin',
        });
        _saHideSpinner();
        _saToast('✅ Club "' + name + '" creado correctamente. El administrador puede registrarse ahora.', 6000);
        saTab('clubs');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saCreateClubConfirm]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// CREAR USUARIO INDIVIDUAL directamente desde SA
// ═══════════════════════════════════════════════════════════════════
window.saShowCreateIndividual = function() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="max-width:480px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="saTab('individuals')" class="sa-btn"
                    style="color:#3fb950;border-color:rgba(63,185,80,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">👤 Crear Usuario Individual</h3>
            </div>
            <p style="font-size:0.8rem;color:#8b949e;margin-bottom:1.2rem;">
                Crea un usuario individual pre-aprobado. Podrá registrarse en la app y acceder directamente.
                Si el email ya existe pero estaba dado de baja, se reactivará automáticamente.
            </p>
            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email del usuario *</label>
                    <input id="ci-email" type="email" placeholder="entrenador@email.com"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre completo</label>
                    <input id="ci-name" type="text" placeholder="Nombre y Apellidos"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Rol individual</label>
                    <select id="ci-role"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="admin_individual">⚙️ Administrador Individual</option>
                        <option value="individual">⚙️ Administrador Individual (auth.js)</option>
                        <option value="user">👤 Entrenador Individual</option>
                        <option value="parent">👨‍👩‍👧 Padre/Madre/Tutor Individual</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Plan</label>
                    <select id="ci-plan"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="free">🆓 Free</option>
                        <option value="basic">⭐ Basic</option>
                        <option value="pro">🚀 Pro</option>
                    </select>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <input id="ci-sendemail" type="checkbox" checked
                        style="width:1.1rem;height:1.1rem;accent-color:#3fb950;cursor:pointer;">
                    <label for="ci-sendemail" style="font-size:0.82rem;color:#cdd9e5;cursor:pointer;">
                        Enviar email de invitación al usuario
                    </label>
                </div>
                <button onclick="saCreateIndividualConfirm()"
                    style="margin-top:0.5rem;padding:0.8rem;background:#3fb950;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Crear Usuario Individual
                </button>
            </div>
        </div>`;
};

window.saCreateIndividualConfirm = async function() {
    const email     = document.getElementById('ci-email')?.value.trim();
    const name      = document.getElementById('ci-name')?.value.trim() || '';
    const role      = document.getElementById('ci-role')?.value || 'individual';
    const plan      = document.getElementById('ci-plan')?.value || 'free';
    const sendEmail = document.getElementById('ci-sendemail')?.checked || false;

    if (!email) { _saToast('⚠️ El email es obligatorio', 3000); return; }

    _saShowSpinner('Creando usuario individual...');
    try {
        const { db, doc, setDoc, updateDoc, collection, query, where, getDocs, fa, httpsCallable } = await saFS();
        const me = window._cronosCurrentUser?.email || 'superadmin';

        // Verificar si ya existe un usuario con ese email
        const existing = await getDocs(query(collection(db,'users'), where('email','==',email))).catch(()=>null);
        
        if (existing && !existing.empty) {
            // Ya existe un usuario con ese email
            const existingDoc = existing.docs[0];
            const existingData = existingDoc.data();
            const existingStatus = existingData.status;
            const existingId = existingDoc.id;

            if (existingStatus === 'removed' || existingStatus === 'blocked') {
                // REACTIVAR usuario que fue dado de baja o bloqueado
                const updAllRoles = (existingData.allRoles||[]).map(r =>
                    r.role === role ? {...r, isAuthorized:true, status:'active'} : r
                );
                // Si el rol no estaba en allRoles, añadirlo
                if (!updAllRoles.some(r => r.role === role)) {
                    updAllRoles.push({ role:role, isAuthorized:true, status:'active', clubId:null });
                }

                await updateDoc(doc(db, 'users', existingId), {
                    role:          role,
                    displayName:   name || existingData.displayName || '',
                    isAuthorized:  true,
                    status:        'active',
                    plan:          plan,
                    allRoles:      updAllRoles,
                    removedAt:     null,
                    blockedAt:     null,
                    reactivatedAt: new Date().toISOString(),
                    reactivatedBy: me,
                    authorizedAt:  new Date().toISOString(),
                    authorizedBy:  me,
                });

                _saHideSpinner();
                _saToast('✅ ' + email + ' reactivado como ' + (window.ROLE_META[role]?.label || role) + '.', 5000);

                // Enviar email si está marcado
                if (sendEmail && fa.functions) {
                    try {
                        const sendEmailFn = httpsCallable(fa.functions, 'sendInviteEmail');
                        await sendEmailFn({ to:email, role:role, clubName:'' });
                    } catch(ee) { console.warn('[saCreateIndividualConfirm] Email no enviado:', ee.message); }
                }

                saTab('individuals');
                return;
            } else {
                // El usuario existe y está activo o pendiente — no se puede crear
                _saHideSpinner();
                _saToast('⚠️ Ya existe un usuario activo con ese email (' + (existingStatus||'activo') + '). Gestiónalo desde la pestaña Individuales.', 6000);
                return;
            }
        }

        // No existe — crear un nuevo pre-usuario con rol individual pre-aprobado
        const preId = 'individual_pre_' + Date.now().toString(36);
        await setDoc(doc(db, 'users', preId), {
            email,
            displayName:  name,
            role:         role,
            plan,
            isAuthorized: true,
            status:       'active',
            allRoles: [{
                role:         role,
                isAuthorized: true,
                status:       'active',
                clubId:       null,
            }],
            approvedBySA:    true,
            approvedBySAAt:  new Date().toISOString(),
            approvedBySABy:  me,
            createdAt:       new Date().toISOString(),
        });

        // Enviar email si está marcado
        if (sendEmail && fa.functions) {
            try {
                const sendEmailFn = httpsCallable(fa.functions, 'sendInviteEmail');
                await sendEmailFn({ to:email, role:role, clubName:'' });
            } catch(ee) { console.warn('[saCreateIndividualConfirm] Email no enviado:', ee.message); }
        }

        _saHideSpinner();
        _saToast('✅ Usuario individual creado. ' + email + ' puede registrarse y acceder directamente.', 6000);
        saTab('individuals');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saCreateIndividualConfirm]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// EDITAR SLOTS Y PLAN DE UN CLUB
// ═══════════════════════════════════════════════════════════════════
window.saEditClubSlots = async function(clubId, clubName) {
    const { db, doc, getDoc, updateDoc } = await saFS();
    const snap = await getDoc(doc(db,'clubs',clubId));
    if (!snap.exists()) { _saToast('Club no encontrado', 3000); return; }
    const c = snap.data();

    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <div style="max-width:520px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.5rem;">
                <button onclick="saTab('clubs')" class="sa-btn"
                    style="color:#58a6ff;border-color:rgba(88,166,255,0.3);">← Volver</button>
                <h3 style="margin:0;font-size:1rem;">✏️ Editar Club: ${clubName}</h3>
            </div>
            <div style="display:flex;flex-direction:column;gap:0.8rem;">
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Plan</label>
                    <select id="es-plan"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                               color:white;font-size:0.9rem;box-sizing:border-box;">
                        <option value="free"  ${(c.plan||'free')==='free'  ?'selected':''}>🆓 Free</option>
                        <option value="basic" ${c.plan==='basic'?'selected':''}>⭐ Basic</option>
                        <option value="pro"   ${c.plan==='pro'  ?'selected':''}>🚀 Pro</option>
                    </select>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">📋 Directores Deportivos</label>
                        <input id="es-dir" type="number" value="${c.slots?.directors??1}" min="0"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                        <div style="font-size:0.68rem;color:#8b949e;margin-top:2px;">Usados: ${c.usedSlots?.directors||0}</div>
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">🎯 Coordinadores</label>
                        <input id="es-coord" type="number" value="${c.slots?.coordinators??2}" min="0"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                        <div style="font-size:0.68rem;color:#8b949e;margin-top:2px;">Usados: ${c.usedSlots?.coordinators||0}</div>
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">⚙️ Entrenadores</label>
                        <input id="es-coach" type="number" value="${c.slots?.users??10}" min="0"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                        <div style="font-size:0.68rem;color:#8b949e;margin-top:2px;">Usados: ${c.usedSlots?.users||0}</div>
                    </div>
                    <div>
                        <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">👨‍👩‍👧 Padres/Tutores</label>
                        <input id="es-parents" type="number" value="${c.slots?.parents??50}" min="0"
                            style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.9rem;box-sizing:border-box;">
                        <div style="font-size:0.68rem;color:#8b949e;margin-top:2px;">Usados: ${c.usedSlots?.parents||0}</div>
                    </div>
                </div>
                <button onclick="saEditClubSlotsConfirm('${clubId}')"
                    style="margin-top:0.5rem;padding:0.8rem;background:#58a6ff;border:none;
                           border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                           cursor:pointer;width:100%;">
                    ✅ Guardar Cambios
                </button>
            </div>
        </div>`;
};

window.saEditClubSlotsConfirm = async function(clubId) {
    const plan  = document.getElementById('es-plan')?.value   || 'free';
    const dirS  = parseInt(document.getElementById('es-dir')?.value)     || 0;
    const coS   = parseInt(document.getElementById('es-coord')?.value)   || 0;
    const coachS= parseInt(document.getElementById('es-coach')?.value)   || 0;
    const parS  = parseInt(document.getElementById('es-parents')?.value) || 0;

    _saShowSpinner('Guardando...');
    try {
        const { db, doc, updateDoc } = await saFS();
        await updateDoc(doc(db,'clubs',clubId), {
            plan,
            slots: { directors: dirS, coordinators: coS, users: coachS, parents: parS },
            updatedAt: new Date().toISOString(),
            updatedBy: window._cronosCurrentUser?.email || 'superadmin',
        });
        _saHideSpinner();
        _saToast('✅ Club actualizado correctamente.', 4000);
        saTab('clubs');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
    }
};

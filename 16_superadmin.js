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
// CONSTANTES COMPARTIDAS (también las usa 17_club_admin.js)
// ═══════════════════════════════════════════════════════════════════

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
    // Cerrar modal de club admin si está abierto
    const modal = document.getElementById('setup-modal');
    if (modal) modal.style.display = 'none';
    // Ocultar paneles de campo (no son relevantes para SA)
    const mainH = document.getElementById('main-header');
    if (mainH) mainH.style.display = 'none';
    const mainC = document.getElementById('main-container');
    if (mainC) mainC.style.display = 'none';
    // Restaurar body
    document.body.style.background = '#0d1117';
    document.body.classList.remove('locked');
    // Mostrar selector de roles
    if (typeof showRoleSelector === 'function') showRoleSelector();
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

    // Contar pendientes para badge
    let pendingCount = 0;
    try {
        const { db, collection, query, where, getDocs } = await saFS();
        const [s1, s2] = await Promise.all([
            getDocs(query(collection(db,'platform_requests'), where('status','==','pending_sa'))).catch(()=>({size:0})),
            getDocs(query(collection(db,'users'), where('status','==','pending'))).catch(()=>({size:0})),
        ]);
        pendingCount = (s1.size||0) + (s2.size||0);
    } catch (_) {}

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
    <button id="sa-tab-clubs"    onclick="saTab('clubs')"    style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid #58a6ff;color:#58a6ff;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">🏟️ Clubes</button>
    <button id="sa-tab-requests" onclick="saTab('requests')" style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">📋 Solicitudes${badge}</button>
    <button id="sa-tab-trash"    onclick="saTab('trash')"    style="padding:0.72rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-weight:700;cursor:pointer;font-size:0.81rem;white-space:nowrap;flex-shrink:0;">🗑️ Rastros</button>
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
    ['clubs','requests','trash'].forEach(t => {
        const b = document.getElementById('sa-tab-'+t);
        if (!b) return;
        b.style.borderBottomColor = (t===tab)?'#58a6ff':'transparent';
        b.style.color             = (t===tab)?'#58a6ff':'#8b949e';
    });
    if      (tab==='clubs')    saClubs();
    else if (tab==='requests') saRequests();
    else if (tab==='trash')    saTrash();
};

// ═══════════════════════════════════════════════════════════════════
// saClubs()
// ═══════════════════════════════════════════════════════════════════

window.saClubs = async function saClubs() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center;padding:2.5rem;color:#8b949e;"><div style="font-size:1.6rem;">⏳</div>Cargando clubes…</div>`;
    try {
        const { db, collection, getDocs } = await saFS();
        const [clubsSnap, usersSnap] = await Promise.all([
            getDocs(collection(db,'clubs')),
            getDocs(collection(db,'users')),
        ]);
        const clubs = {};
        clubsSnap.forEach(d => { clubs[d.id] = { id:d.id, users:[], ...d.data() }; });
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
            html += `
            <div style="margin-bottom:1rem;border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden;">
                <div style="background:rgba(88,166,255,0.07);padding:0.6rem 0.9rem;display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:700;color:white;font-size:0.9rem;">🏟️ ${typeof escapeHtml==='function'?escapeHtml(c.name||c.id):(c.name||c.id)}</span>
                    <div style="display:flex;gap:0.5rem;align-items:center;">
                        ${pend>0?`<span style="background:rgba(255,215,0,0.2);color:#ffd700;padding:1px 8px;border-radius:10px;font-size:0.68rem;font-weight:700;">${pend} pend.</span>`:''}
                        <span style="font-size:0.68rem;color:#8b949e;">${vis.length} usuarios</span>
                        <button onclick="document.getElementById('sa-panel').style.display='none'; openClubAdminPanel('${(typeof escapeAttr==='function'?escapeAttr(c.id):c.id).replace(/'/g,"\\'")}')" style="padding:0.22rem 0.5rem;background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.3);border-radius:5px;color:#58a6ff;font-size:0.68rem;cursor:pointer;font-weight:700;">⚙️ Gestionar</button>
                    </div>
                </div>
                ${vis.length?`<div>${vis.map(u=>renderRow(u,c.id)).join('')}</div>`:`<p style="margin:0;padding:0.6rem 0.9rem;color:#8b949e;font-size:0.8rem;">Sin usuarios asignados.</p>`}
            </div>`;
        });
        if (orphans.length) {
            html += `<div style="margin-bottom:1rem;border:1px solid rgba(255,215,0,0.2);border-radius:10px;overflow:hidden;"><div style="background:rgba(255,215,0,0.07);padding:0.6rem 0.9rem;"><span style="font-weight:700;color:#ffd700;font-size:0.9rem;">⚠️ Sin club asignado (${orphans.length})</span></div><div>${orphans.map(u=>renderRow(u,'')).join('')}</div></div>`;
        }
        if (!html) html = `<p style="color:#8b949e;text-align:center;padding:2rem;">Sin clubes creados aún.</p>`;
        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = `<p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</p>`;
        console.error('[saClubs]', e);
    }
};

// Aprobación rápida paso 1 desde vista de clubes
window.saQuickApprove = async function(uid, email, clubId) {
    if (!confirm(`Aprobar (paso 1/2 — SA):\n${email}\n\nEl Club Admin deberá confirmar después.`)) return;
    _saShowSpinner('Aprobando…');
    try {
        const { db, doc, updateDoc } = await saFS();
        await updateDoc(doc(db,'users',uid), {
            status:'pending_club', approvedBySA:true,
            approvedBySAAt:new Date().toISOString(),
            approvedBySABy:window._cronosCurrentUser?.email||'superadmin',
        });
        _saHideSpinner();
        _saToast(`✅ ${email} aprobado por SA. Pendiente de confirmación del Club Admin.`, 5000);
        saClubs();
    } catch (e) { _saHideSpinner(); _saToast('⚠️ '+e.message,4000); }
};

// ═══════════════════════════════════════════════════════════════════
// saRequests() — tres fuentes unificadas
// ═══════════════════════════════════════════════════════════════════

window.saRequests = async function saRequests() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center;padding:2.5rem;color:#8b949e;"><div style="font-size:1.6rem;">⏳</div>Cargando solicitudes…</div>`;
    try {
        const { db, collection, query, where, getDocs, orderBy } = await saFS();
        const [snapD, snapP, snapQ] = await Promise.all([
            getDocs(query(collection(db,'users'),where('status','==','pending'),orderBy('createdAt','desc'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'platform_requests'),where('status','==','pending_sa'),orderBy('createdAt','desc'))).catch(()=>({forEach:()=>{}})),
            getDocs(query(collection(db,'platform_requests'),where('type','==','quota_increase'),where('status','==','unread'),orderBy('createdAt','desc'))).catch(()=>({forEach:()=>{}})),
        ]);

        const directUsers=[], platformReqs=[], quotaReqs=[];
        snapD.forEach(d => directUsers.push({id:d.id,...d.data()}));
        snapP.forEach(d => platformReqs.push({id:d.id,...d.data()}));
        snapQ.forEach(d => quotaReqs.push({id:d.id,...d.data()}));

        if (!directUsers.length && !platformReqs.length && !quotaReqs.length) {
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
                            <div style="font-size:0.7rem;color:#8b949e;">${isDirect?'Registro directo':'Solicitud de Club Admin'}</div>
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
                ℹ️ Paso 1/2 — Tú apruebas aquí. El Admin del Club confirma el acceso después.
            </p>
            ${directUsers.map(u => buildCard(u,'direct')).join('')}
            <div style="margin-bottom:1.4rem;"></div>`;
        }

        if (platformReqs.length) {
            html += `
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                <h3 style="margin:0;font-size:0.88rem;color:#58a6ff;">📩 Solicitudes de Club Admin</h3>
                <span style="background:rgba(88,166,255,0.15);color:#58a6ff;padding:1px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;">${platformReqs.length}</span>
            </div>
            <p style="font-size:0.72rem;color:#8b949e;margin:0 0 0.8rem;background:rgba(88,166,255,0.05);padding:0.5rem 0.7rem;border-radius:7px;border:1px solid rgba(88,166,255,0.15);">
                ℹ️ Al aprobar, el usuario podrá registrarse. El Club Admin confirmará su acceso final.
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
        const { db, doc, getDoc, setDoc, updateDoc } = await saFS();
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
                    await updateDoc(doc(db,'users',id), {
                        isAuthorized:true, status:'active',
                        clubId, clubName:u.requestedClubName,
                        authorizedAt:new Date().toISOString(), authorizedBy:me,
                    });
                    _saHideSpinner();
                    _saToast(`✅ Club "${u.requestedClubName}" creado y ${u.email} activado.`, 6000);
                } else if (u.role === 'individual') {
                    await updateDoc(doc(db,'users',id), {
                        isAuthorized:true, status:'active',
                        authorizedAt:new Date().toISOString(), authorizedBy:me,
                    });
                    _saHideSpinner();
                    _saToast(`✅ ${u.email} activado como Entrenador Individual.`, 5000);
                } else {
                    await updateDoc(doc(db,'users',id), {
                        status:'pending_club', approvedBySA:true,
                        approvedBySAAt:new Date().toISOString(), approvedBySABy:me,
                    });
                    _saHideSpinner();
                    _saToast(`✅ ${u.email} aprobado. El Club Admin debe confirmar el acceso.`, 5000);
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
                const preUid = 'pre_' + Date.now().toString(36);
                await setDoc(doc(db,'users',preUid), {
                    email:r.requestedEmail, displayName:r.requestedName||'',
                    role:r.requestedRole||'user', clubId:r.clubId, clubName:r.clubName||'',
                    isAuthorized:false, status:'pending_register',
                    approvedBySA:true, approvedBySAAt:new Date().toISOString(), approvedBySABy:me,
                    requestRef:id,
                    ...(r.playerNumber?{playerNumber:r.playerNumber,playerAlias:r.playerAlias||'',parentWA:r.parentWA||''}:{}),
                    createdAt:new Date().toISOString(),
                });
                await updateDoc(doc(db,'platform_requests',id), { status:'approved', approvedAt:new Date().toISOString(), approvedBy:me });
                _saHideSpinner();
                _saToast(`✅ ${r.requestedEmail} puede registrarse. El Club Admin confirmará su acceso.`, 6000);
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
    if (!confirm(`¿${({active:'activar',blocked:'bloquear',removed:'dar de baja'})[newStatus]||newStatus} a ${email}?`)) return;
    _saShowSpinner('Procesando…');
    try {
        const { db, fa, doc, getDoc, updateDoc, httpsCallable } = await saFS();
        const uSnap = await getDoc(doc(db,'users',uid));
        const role  = uSnap.exists() ? (uSnap.data().role||'user') : 'user';
        const sk    = ({director:'usedSlots.directors',coordinator:'usedSlots.coordinators',parent:'usedSlots.parents'})[role]||'usedSlots.users';

        if (newStatus === 'removed') {
            if (httpsCallable && fa.functions) {
                try { await httpsCallable(fa.functions,'deleteAuthUser')({uid,email}); } catch(_) {}
            }
            await updateDoc(doc(db,'users',uid),{status:'removed',isAuthorized:false,removedAt:new Date().toISOString(),removedBy:window._cronosCurrentUser?.email||'superadmin'}).catch(()=>{});
            if (clubId) {
                const cs = await getDoc(doc(db,'clubs',clubId)).catch(()=>null);
                if (cs?.exists()) {
                    const sub = sk.split('.')[1];
                    const cur = (cs.data().usedSlots||{})[sub]||1;
                    await updateDoc(doc(db,'clubs',clubId),{[sk]:Math.max(0,cur-1)}).catch(()=>{});
                }
            }
            _saHideSpinner(); _saToast(`🗑️ ${email} dado de baja.`,4000);
        } else {
            const isActive = newStatus==='active';
            await updateDoc(doc(db,'users',uid),{isAuthorized:isActive,status:newStatus,...(isActive?{authorizedAt:new Date().toISOString()}:{blockedAt:new Date().toISOString()})});
            if (clubId) {
                const cs = await getDoc(doc(db,'clubs',clubId)).catch(()=>null);
                if (cs?.exists()) {
                    const sub = sk.split('.')[1];
                    const cur = (cs.data().usedSlots||{})[sub]||0;
                    await updateDoc(doc(db,'clubs',clubId),{[sk]:Math.max(0,cur+(isActive?1:-1))}).catch(()=>{});
                }
            }
            _saHideSpinner(); _saToast(isActive?`✅ ${email} activado`:`🔒 ${email} bloqueado`,3000);
        }
        saClubs();
    } catch (e) { _saHideSpinner(); _saToast('⚠️ '+e.message,5000); console.error(e); }
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
            html += removed.map(u=>row(u,'255,88,88',`<button onclick="saPurgeUser('${_escO(u.id).replace(/'/g,"\\'")}','${_escO(u.email||u.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' )" style="padding:0.28rem 0.58rem;background:rgba(255,88,88,0.15);border:1px solid rgba(255,88,88,0.4);border-radius:5px;color:#ff5858;font-size:0.7rem;cursor:pointer;font-weight:700;">🗑️ Limpiar</button>`)).join('');
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

window.saPurgeUser = async function saPurgeUser(uid, email) {
    if (!confirm(`🗑️ LIMPIAR RASTRO: ${email}\n\nIRREVERSIBLE. ¿Confirmar?`)) return;
    _saShowSpinner('Limpiando…');
    try {
        const { db, doc, deleteDoc } = await saFS();
        await deleteDoc(doc(db,'users',uid));
        _saHideSpinner(); _saToast(`✅ Rastro de ${email} eliminado.`,3000); saTrash();
    } catch (e) { _saHideSpinner(); _saToast('⚠️ '+e.message,4000); }
};

// ═══════════════════════════════════════════════════════════════════
// setupClubsSyncListener()
// ═══════════════════════════════════════════════════════════════════

window.setupClubsSyncListener = async function setupClubsSyncListener() {
    try {
        const { db, collection, onSnapshot } = await saFS();
        if (window._clubsSyncUnsubscribe) window._clubsSyncUnsubscribe();
        window._clubsSyncUnsubscribe = onSnapshot(collection(db,'users'), snap => {
            const panel = document.getElementById('sa-panel');
            if (!panel || panel.style.display==='none') return;
            if (snap.docChanges().some(c=>c.type==='removed'||c.type==='modified')) {
                clearTimeout(window._saRefreshTimeout);
                window._saRefreshTimeout = setTimeout(()=>saClubs(), 700);
            }
        });
    } catch (e) { console.error('[setupClubsSyncListener]', e); }
};



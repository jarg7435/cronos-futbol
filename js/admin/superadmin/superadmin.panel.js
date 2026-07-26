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
// saClubs() — Pestaña de clubes
// Extraída a js/admin/superadmin/clubs-tab.js (auditoría 2026-07-22, 2026-07-26).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// PESTAÑA INDIVIDUALES (saIndividuals / saActivateIndividual / saAssignOrphanToEntity)
// Extraídas a js/admin/superadmin/individuals-tab.js (auditoría 2026-07-22, 2026-07-25).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// saSecretary() Y ENVÍO DE INVITACIONES (Secretaría)
// Extraídas a js/admin/superadmin/secretary.js (auditoría 2026-07-22, 2026-07-25).
// ═══════════════════════════════════════════════════════════════════

// saQuickApprove() — aprobación rápida desde la vista de clubes
// Extraída a js/admin/superadmin/clubs-tab.js (auditoría 2026-07-22, 2026-07-26).

// ═══════════════════════════════════════════════════════════════════
// SOLICITUDES / APROBACIÓN
// (saCountPendingRequests / saRequests / saApproveRequest)
// Extraídas a js/admin/superadmin/requests-tab.js (auditoría 2026-07-22, 2026-07-26).
// OJO: requests-tab.js debe cargarse DESPUÉS de app-init.js y ANTES de
// extras.js — ver la cabecera de ese archivo para el porqué.
// ═══════════════════════════════════════════════════════════════════

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
// Extraída a js/admin/superadmin/clubs-tab.js (auditoría 2026-07-22, 2026-07-26).
// ═══════════════════════════════════════════════════════════════════

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


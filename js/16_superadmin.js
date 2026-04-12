/**
 * 16_superadmin.js — SuperAdmin + Shared Helpers v8.0
 * Chronos Fútbol
 *
 * Este archivo:
 *  1. Define saFS() — helper compartido que usan 16_superadmin y 17_club_admin
 *  2. Define SA_CSS — estilos del modal admin (compartido con 17_club_admin)
 *  3. Define ROLE_META — metadatos de roles (compartido)
 *  4. Define saGet() — lectura simple de Firestore
 *  5. Panel completo del SuperAdmin (openSuperAdminPanel, saTab, saClubs…)
 *  6. Gestión de solicitudes leyendo de 'platform_requests' (donde escribe club admin)
 *  7. Helpers de UI con fallback propio
 *
 * CORRECCIONES RESPECTO A VERSIONES ANTERIORES:
 *  - saFS() ahora devuelve 'db' directamente (compatible con 17_club_admin.js)
 *  - saRequests() lee de 'platform_requests' con status 'pending_sa' (correcto)
 *  - saApproveRequest() actualiza correctamente y crea el pre-usuario
 *  - SA_CSS y ROLE_META definidos aquí para que 17_club_admin.js los encuentre
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES COMPARTIDAS (usadas también en 17_club_admin.js)
// ═══════════════════════════════════════════════════════════════════════════

window.ROLE_META = {
    superadmin:  { label: 'Superadministrador',  icon: '👑', color: '#ffd700'  },
    admin:       { label: 'Administrador',        icon: '⚙️',  color: '#58a6ff'  },
    club_admin:  { label: 'Admin de Club',         icon: '🏟️', color: '#58a6ff'  },
    director:    { label: 'Director Deportivo',    icon: '📋', color: '#f0883e'  },
    coordinator: { label: 'Coordinador',           icon: '🎯', color: '#d2a8ff'  },
    user:        { label: 'Entrenador',            icon: '⚽', color: '#3fb950'  },
    parent:      { label: 'Padre / Madre / Tutor', icon: '👨‍👩‍👧', color: '#79c0ff' },
    individual:  { label: 'Entrenador Individual', icon: '👤', color: '#79c0ff'  },
};

// CSS compartido para modales de admin
window.SA_CSS = `
<style>
:root {
  --sa-bg:      #0d1117;
  --sa-surface: rgba(255,255,255,0.04);
  --sa-border:  rgba(255,255,255,0.10);
  --sa-primary: #58a6ff;
}
.sa-modal {
  background: var(--sa-bg) !important;
  border: 1px solid var(--sa-border) !important;
  border-radius: 16px !important;
  max-width: 860px !important;
  width: 98vw !important;
  max-height: 92vh !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  font-family: Inter, sans-serif !important;
}
.sa-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.2rem;
  border-bottom: 1px solid var(--sa-border);
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.sa-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.2rem;
  -webkit-overflow-scrolling: touch;
}
.sa-card {
  background: var(--sa-surface);
  border: 1px solid var(--sa-border);
  border-radius: 10px;
  padding: 0.9rem 1rem;
  margin-bottom: 0.8rem;
}
.sa-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  gap: 0.5rem;
  user-select: none;
}
.sa-card-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 0.88rem;
  color: white;
}
.sa-card-body {
  display: none;
  padding-top: 0.7rem;
  margin-top: 0.5rem;
  border-top: 1px solid var(--sa-border);
}
.sa-card.expanded .sa-card-body { display: block; }
.sa-card.expanded .sa-chevron  { transform: rotate(0deg); }
.sa-chevron { display: inline-block; transform: rotate(-90deg); transition: transform 0.2s; font-size: 0.65rem; }
.sa-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.55rem;
  border-radius: 20px;
  font-size: 0.7rem;
  font-weight: 700;
  background: rgba(88,166,255,0.12);
  color: #58a6ff;
}
.sa-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.32rem 0.65rem;
  border: 1px solid var(--sa-border);
  border-radius: 7px;
  background: var(--sa-surface);
  color: white;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.sa-btn:hover { filter: brightness(1.2); }
.sa-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--sa-border);
  border-radius: 8px;
  color: white;
  font-size: 0.85rem;
  box-sizing: border-box;
  outline: none;
  font-family: Inter, sans-serif;
}
.sa-input:focus { border-color: var(--sa-primary); }
.sa-label {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted, #8b949e);
  margin-bottom: 0.3rem;
  font-weight: 600;
  letter-spacing: 0.3px;
}
.sa-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 0.6rem;
}
.sa-stat {
  background: var(--sa-surface);
  border: 1px solid var(--sa-border);
  border-radius: 9px;
  padding: 0.6rem;
  text-align: center;
}
.sa-stat-n { font-size: 1.3rem; font-weight: 800; color: #3fb950; }
.sa-stat-l { font-size: 0.65rem; color: var(--text-muted, #8b949e); margin-top: 0.1rem; }
.sa-urow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.3rem;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.sa-urow:last-child { border-bottom: none; }
.sa-g4 {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.6rem;
  align-items: start;
}
</style>`;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS UI — fallbacks seguros si app.js no expone showSpinner etc.
// ═══════════════════════════════════════════════════════════════════════════

(function _registerSAHelpers() {
    function _spinnerEl() {
        let el = document.getElementById('_sa-spinner');
        if (!el) {
            el = document.createElement('div');
            el.id = '_sa-spinner';
            el.style.cssText = [
                'position:fixed;inset:0;background:rgba(0,0,0,0.65);',
                'display:none;align-items:center;justify-content:center;',
                'z-index:99999;flex-direction:column;gap:0.8rem;',
            ].join('');
            el.innerHTML = [
                '<style>@keyframes _saSpin{to{transform:rotate(360deg)}}</style>',
                '<div style="width:38px;height:38px;border:3px solid rgba(255,255,255,0.12);',
                'border-top-color:#58a6ff;border-radius:50%;',
                'animation:_saSpin 0.75s linear infinite;"></div>',
                '<div id="_sa-spinner-msg" style="color:white;font-size:0.88rem;',
                'font-family:Inter,sans-serif;"></div>',
            ].join('');
            document.body.appendChild(el);
        }
        return el;
    }

    window._saShowSpinner = function (msg) {
        if (typeof showSpinner === 'function') { showSpinner(msg); return; }
        const el = _spinnerEl();
        const msgEl = document.getElementById('_sa-spinner-msg');
        if (msgEl) msgEl.textContent = msg || '';
        el.style.display = 'flex';
    };

    window._saHideSpinner = function () {
        if (typeof hideSpinner === 'function') { hideSpinner(); return; }
        const el = document.getElementById('_sa-spinner');
        if (el) el.style.display = 'none';
    };

    window._saToast = function (msg, ms) {
        if (typeof showToast === 'function') { showToast(msg, ms); return; }
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = [
            'position:fixed;bottom:1.8rem;left:50%;transform:translateX(-50%);',
            'background:#1a2233;color:white;padding:0.75rem 1.4rem;',
            'border-radius:8px;font-size:0.87rem;font-family:Inter,sans-serif;',
            'z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,0.55);',
            'border:1px solid rgba(255,255,255,0.1);white-space:nowrap;',
        ].join('');
        document.body.appendChild(t);
        setTimeout(() => t.remove(), ms || 3000);
    };
})();

// ═══════════════════════════════════════════════════════════════════════════
// saFS() — helper compartido de Firebase
// ⚠️ IMPORTANTE: devuelve TANTO 'fa' como 'db' directamente
//    porque 17_club_admin.js espera destructurar 'db' en la raíz
// ═══════════════════════════════════════════════════════════════════════════

window.saFS = async function saFS() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) {
        throw new Error('Firebase no inicializado. Recarga la página.');
    }

    const [fs, fnMod, appMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    ]);

    if (!fa._functions) {
        try {
            fa._functions = fnMod.getFunctions(appMod.getApp());
        } catch (e) {
            console.warn('[saFS] Functions no disponibles:', e.message);
        }
    }

    const faWithFns = Object.assign({}, fa, { functions: fa._functions });

    return {
        // ── acceso directo a 'db' (necesario para 17_club_admin.js) ──────
        db:  fa.db,
        fa:  faWithFns,
        // ── Firestore ─────────────────────────────────────────────────────
        doc:             fs.doc,
        getDoc:          fs.getDoc,
        setDoc:          fs.setDoc,
        updateDoc:       fs.updateDoc,
        deleteDoc:       fs.deleteDoc,
        collection:      fs.collection,
        query:           fs.query,
        where:           fs.where,
        getDocs:         fs.getDocs,
        orderBy:         fs.orderBy,
        onSnapshot:      fs.onSnapshot,
        serverTimestamp: fs.serverTimestamp,
        // ── Functions ─────────────────────────────────────────────────────
        httpsCallable:   fnMod.httpsCallable,
    };
};

// ── saGet: lectura simple de un documento ─────────────────────────────────
window.saGet = async function saGet(colName, docId) {
    try {
        const { db, doc, getDoc } = await saFS();
        const snap = await getDoc(doc(db, colName, docId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (e) {
        console.warn('[saGet]', colName, docId, e.message);
        return null;
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// openSuperAdminPanel() — punto de entrada del panel superadmin
// ═══════════════════════════════════════════════════════════════════════════

window.openSuperAdminPanel = function openSuperAdminPanel() {
    // Ocultar otras pantallas activas
    ['main-header', 'role-selection-screen', 'install-screen', 'auth-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const mainApp = document.getElementById('app-main') || document.querySelector('main');
    if (mainApp) mainApp.style.display = 'none';

    // Cerrar modal de setup si está abierto
    const setupModal = document.getElementById('setup-modal');
    if (setupModal) setupModal.style.display = 'none';

    // Crear panel si no existe
    let panel = document.getElementById('sa-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'sa-panel';
        panel.style.cssText = [
            'position:fixed;inset:0;',
            'background:var(--bg-dark,#0d1117);',
            'z-index:9500;display:flex;flex-direction:column;',
            'overflow:hidden;font-family:Inter,sans-serif;',
        ].join('');
        panel.innerHTML = `
<!-- ── Header ─────────────────────────────────────────────────── -->
<div style="background:rgba(255,255,255,0.04);
            border-bottom:1px solid rgba(255,255,255,0.1);
            padding:0.85rem 1.2rem;
            display:flex;justify-content:space-between;align-items:center;
            flex-shrink:0;flex-wrap:wrap;gap:0.4rem;">
    <div style="display:flex;align-items:center;gap:0.7rem;">
        <span style="font-size:1.3rem;">👑</span>
        <div>
            <div style="font-family:'Outfit',sans-serif;font-size:1rem;
                        color:white;font-weight:700;letter-spacing:0.5px;">
                SuperAdmin
            </div>
            <div style="font-size:0.7rem;color:var(--text-muted,#8b949e);">
                Chronos Fútbol · Control Total
            </div>
        </div>
    </div>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button onclick="if(typeof showRoleSelector==='function')showRoleSelector();"
                style="background:rgba(255,215,0,0.1);
                       border:1px solid rgba(255,215,0,0.3);
                       color:#ffd700;padding:0.35rem 0.75rem;
                       border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:700;">
            ⇄ Cambiar rol
        </button>
        <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();
                         else if(typeof window.logoutUser==='function')window.logoutUser();"
                style="background:rgba(255,88,88,0.12);
                       border:1px solid rgba(255,88,88,0.3);
                       color:rgba(255,88,88,0.9);padding:0.35rem 0.75rem;
                       border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:700;">
            ⏻ Salir
        </button>
    </div>
</div>

<!-- ── Tabs ───────────────────────────────────────────────────── -->
<div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.1);
            flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch;">
    <button id="sa-tab-clubs"
            onclick="saTab('clubs')"
            style="padding:0.75rem 1.1rem;background:none;border:none;
                   border-bottom:2px solid #58a6ff;color:#58a6ff;
                   font-weight:700;cursor:pointer;font-size:0.82rem;
                   white-space:nowrap;flex-shrink:0;">
        🏟️ Clubes
    </button>
    <button id="sa-tab-requests"
            onclick="saTab('requests')"
            style="padding:0.75rem 1.1rem;background:none;border:none;
                   border-bottom:2px solid transparent;
                   color:var(--text-muted,#8b949e);
                   font-weight:700;cursor:pointer;font-size:0.82rem;
                   white-space:nowrap;flex-shrink:0;">
        📋 Solicitudes
    </button>
    <button id="sa-tab-trash"
            onclick="saTab('trash')"
            style="padding:0.75rem 1.1rem;background:none;border:none;
                   border-bottom:2px solid transparent;
                   color:var(--text-muted,#8b949e);
                   font-weight:700;cursor:pointer;font-size:0.82rem;
                   white-space:nowrap;flex-shrink:0;">
        🗑️ Rastros
    </button>
</div>

<!-- ── Body ───────────────────────────────────────────────────── -->
<div id="sa-body"
     style="flex:1;overflow-y:auto;padding:1.2rem;
            -webkit-overflow-scrolling:touch;"></div>
        `;
        document.body.appendChild(panel);
    }

    panel.style.display = 'flex';
    saTab('clubs');
    setupClubsSyncListener();
};

// ═══════════════════════════════════════════════════════════════════════════
// saTab() — cambia entre pestañas
// ═══════════════════════════════════════════════════════════════════════════

window.saTab = function saTab(tab) {
    ['clubs', 'requests', 'trash'].forEach(t => {
        const btn = document.getElementById('sa-tab-' + t);
        if (!btn) return;
        const active = (t === tab);
        btn.style.borderBottomColor = active ? '#58a6ff' : 'transparent';
        btn.style.color = active ? '#58a6ff' : 'var(--text-muted,#8b949e)';
    });

    if      (tab === 'clubs')    saClubs();
    else if (tab === 'requests') saRequests();
    else if (tab === 'trash')    saTrash();
};

// ═══════════════════════════════════════════════════════════════════════════
// saClubs() — listado de clubs y sus usuarios
// ═══════════════════════════════════════════════════════════════════════════

window.saClubs = async function saClubs() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="text-align:center;padding:2.5rem;
                    color:var(--text-muted,#8b949e);">
            <div style="font-size:1.6rem;margin-bottom:0.4rem;">⏳</div>
            Cargando clubes y usuarios…
        </div>`;

    try {
        const { db, collection, getDocs } = await saFS();

        const [clubsSnap, usersSnap] = await Promise.all([
            getDocs(collection(db, 'clubs')),
            getDocs(collection(db, 'users')),
        ]);

        const clubs = {};
        clubsSnap.forEach(d => {
            clubs[d.id] = { id: d.id, users: [], ...d.data() };
        });

        const orphans = [];
        usersSnap.forEach(d => {
            const u = { id: d.id, ...d.data() };
            if (u.role === 'superadmin' || u.role === 'admin') return;
            if (u.clubId && clubs[u.clubId]) clubs[u.clubId].users.push(u);
            else orphans.push(u);
        });

        const stColor = { active: '#3fb950', blocked: '#f0883e', removed: '#ff5858' };
        const stTxt   = { active: 'Activo',  blocked: 'Bloqueado', removed: 'Baja' };

        const renderRow = (u, cid) => {
            const st   = u.status || (u.isAuthorized ? 'active' : 'blocked');
            const meta = window.ROLE_META[u.role] || { icon: '👤', color: '#8b949e' };
            return `
            <div style="display:flex;align-items:center;gap:0.4rem;
                        padding:0.5rem 0.5rem;
                        border-bottom:1px solid rgba(255,255,255,0.04);">
                <span>${meta.icon}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.82rem;color:white;
                                overflow:hidden;text-overflow:ellipsis;
                                white-space:nowrap;">
                        ${u.email || u.id}
                    </div>
                    <div style="font-size:0.69rem;
                                color:${stColor[st] || '#8b949e'};">
                        ${meta.label || u.role || 'N/A'} · ${stTxt[st] || st}
                        ${u.status === 'pending_register'
                            ? ' <span style="color:#ffa500;">· ⏳ Pendiente registro</span>'
                            : ''}
                    </div>
                </div>
                <div style="display:flex;gap:0.2rem;flex-shrink:0;">
                    ${st !== 'active' && st !== 'pending_register' ? `
                    <button title="Activar"
                            onclick="saSetClubUserStatus('${u.id}','${(u.email||u.id).replace(/'/g,"\\'")}','active','${cid}')"
                            style="padding:0.25rem 0.45rem;background:rgba(63,185,80,0.15);
                                   border:1px solid rgba(63,185,80,0.4);border-radius:5px;
                                   color:#3fb950;font-size:0.7rem;cursor:pointer;">✅</button>` : ''}
                    ${st === 'active' ? `
                    <button title="Bloquear"
                            onclick="saSetClubUserStatus('${u.id}','${(u.email||u.id).replace(/'/g,"\\'")}','blocked','${cid}')"
                            style="padding:0.25rem 0.45rem;background:rgba(240,136,62,0.15);
                                   border:1px solid rgba(240,136,62,0.4);border-radius:5px;
                                   color:#f0883e;font-size:0.7rem;cursor:pointer;">🔒</button>` : ''}
                    ${st !== 'removed' ? `
                    <button title="Dar de baja definitiva"
                            onclick="saSetClubUserStatus('${u.id}','${(u.email||u.id).replace(/'/g,"\\'")}','removed','${cid}')"
                            style="padding:0.25rem 0.45rem;background:rgba(255,88,88,0.15);
                                   border:1px solid rgba(255,88,88,0.4);border-radius:5px;
                                   color:#ff5858;font-size:0.7rem;cursor:pointer;">🗑️</button>` : ''}
                </div>
            </div>`;
        };

        let html = '';
        const clubList = Object.values(clubs);

        if (clubList.length === 0) {
            html = `<p style="color:var(--text-muted);text-align:center;padding:2rem;">
                        Sin clubes registrados.</p>`;
        } else {
            clubList.forEach(c => {
                const visible = c.users.filter(u =>
                    u.role !== 'superadmin' && u.role !== 'admin');
                html += `
                <div style="margin-bottom:1.1rem;
                            border:1px solid rgba(255,255,255,0.08);
                            border-radius:10px;overflow:hidden;">
                    <div style="background:rgba(88,166,255,0.07);
                                padding:0.62rem 0.9rem;
                                display:flex;justify-content:space-between;
                                align-items:center;">
                        <span style="font-family:'Outfit',sans-serif;
                                     font-weight:700;color:white;
                                     font-size:0.92rem;">
                            🏟️ ${c.name || c.id}
                        </span>
                        <div style="display:flex;gap:0.5rem;align-items:center;">
                            <span style="font-size:0.7rem;
                                         color:var(--text-muted);">
                                ${visible.length} usuario(s)
                            </span>
                            <button onclick="openClubAdminPanel('${c.id}')"
                                    style="padding:0.25rem 0.55rem;
                                           background:rgba(88,166,255,0.12);
                                           border:1px solid rgba(88,166,255,0.3);
                                           border-radius:5px;color:#58a6ff;
                                           font-size:0.7rem;cursor:pointer;
                                           font-weight:700;">
                                ⚙️ Gestionar
                            </button>
                        </div>
                    </div>
                    ${visible.length
                        ? `<div>${visible.map(u => renderRow(u, c.id)).join('')}</div>`
                        : `<p style="margin:0;padding:0.62rem 0.9rem;
                                    color:var(--text-muted);font-size:0.8rem;">
                               Sin usuarios asignados.
                           </p>`}
                </div>`;
            });
        }

        // Usuarios sin club
        if (orphans.length > 0) {
            html += `
            <div style="margin-bottom:1.1rem;
                        border:1px solid rgba(255,215,0,0.2);
                        border-radius:10px;overflow:hidden;">
                <div style="background:rgba(255,215,0,0.07);
                            padding:0.62rem 0.9rem;">
                    <span style="font-weight:700;color:#ffd700;font-size:0.9rem;">
                        ⚠️ Sin club asignado (${orphans.length})
                    </span>
                </div>
                <div>${orphans.map(u => renderRow(u, '')).join('')}</div>
            </div>`;
        }

        body.innerHTML = html;

    } catch (e) {
        body.innerHTML = `
            <p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${e.message}</p>`;
        console.error('[saClubs]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// saSetClubUserStatus() — activar / bloquear / dar de baja
// ═══════════════════════════════════════════════════════════════════════════

window.saSetClubUserStatus = async function saSetClubUserStatus(uid, email, newStatus, clubId) {
    const labels = {
        active:  'activar',
        blocked: 'bloquear',
        removed: 'dar de baja definitivamente',
    };
    if (!confirm(`¿Deseas ${labels[newStatus] || newStatus} a ${email}?`)) return;

    _saShowSpinner('Procesando…');
    try {
        const { db, fa, doc, getDoc, updateDoc, httpsCallable } = await saFS();

        const uSnap = await getDoc(doc(db, 'users', uid));
        const ud    = uSnap.exists() ? uSnap.data() : {};
        const role  = ud.role || 'user';

        const slotMap = {
            director:    'usedSlots.directors',
            coordinator: 'usedSlots.coordinators',
            parent:      'usedSlots.parents',
        };
        const slotKey = slotMap[role] || 'usedSlots.users';

        // ── BAJA DEFINITIVA ───────────────────────────────────────────
        if (newStatus === 'removed') {
            // Intentar borrar de Firebase Auth via Cloud Function
            if (httpsCallable && fa.functions) {
                try {
                    const fn = httpsCallable(fa.functions, 'deleteAuthUser');
                    await fn({ uid, email });
                } catch (authErr) {
                    console.warn('[SA] Auth delete warning:', authErr.message);
                }
            }

            // Marcar en Firestore (el trigger onUserStatusRemoved también borrará Auth)
            await updateDoc(doc(db, 'users', uid), {
                status:       'removed',
                isAuthorized: false,
                removedAt:    new Date().toISOString(),
                removedBy:    window._cronosCurrentUser?.email || 'superadmin',
            }).catch(() => {});

            // Liberar plaza del club
            if (clubId) {
                const cSnap = await getDoc(doc(db, 'clubs', clubId)).catch(() => null);
                if (cSnap?.exists()) {
                    const subF = slotKey.split('.')[1];
                    const cur  = (cSnap.data().usedSlots || {})[subF] || 1;
                    await updateDoc(doc(db, 'clubs', clubId), {
                        [slotKey]: Math.max(0, cur - 1),
                    }).catch(() => {});
                }
            }

            _saHideSpinner();
            _saToast(`🗑️ ${email} dado de baja. Puede volver a registrarse.`, 4500);

        // ── ACTIVAR / BLOQUEAR ────────────────────────────────────────
        } else {
            const isActive = (newStatus === 'active');
            await updateDoc(doc(db, 'users', uid), {
                isAuthorized: isActive,
                status:       newStatus,
                ...(isActive
                    ? { authorizedAt: new Date().toISOString() }
                    : { blockedAt:    new Date().toISOString() }),
            });

            if (clubId) {
                const cSnap = await getDoc(doc(db, 'clubs', clubId)).catch(() => null);
                if (cSnap?.exists()) {
                    const subF  = slotKey.split('.')[1];
                    const cur   = (cSnap.data().usedSlots || {})[subF] || 0;
                    const delta = isActive ? 1 : -1;
                    await updateDoc(doc(db, 'clubs', clubId), {
                        [slotKey]: Math.max(0, cur + delta),
                    }).catch(() => {});
                }
            }

            _saHideSpinner();
            _saToast(
                isActive ? `✅ ${email} activado` : `🔒 ${email} bloqueado`,
                3000,
            );
        }

        saClubs();

    } catch (e) {
        _saHideSpinner();
        _saToast(`⚠️ Error: ${e.message}`, 5000);
        console.error('[saSetClubUserStatus]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// saRequests() — solicitudes pendientes del admin de club al superadmin
// ⚠️ Lee de 'platform_requests' (donde escribe 17_club_admin.js)
//    con status 'pending_sa'  (campo que usa caSolicitarUsuario)
// ═══════════════════════════════════════════════════════════════════════════

window.saRequests = async function saRequests() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="text-align:center;padding:2.5rem;
                    color:var(--text-muted,#8b949e);">
            <div style="font-size:1.6rem;">⏳</div>
            Cargando solicitudes…
        </div>`;

    try {
        const { db, collection, query, where, getDocs, orderBy } = await saFS();

        // ── Solicitudes de nuevo usuario (type: user_request) ────────
        const qUser = query(
            collection(db, 'platform_requests'),
            where('status', '==', 'pending_sa'),
            orderBy('createdAt', 'desc'),
        );

        // ── Solicitudes de ampliación de cuota (type: quota_increase) ─
        const qQuota = query(
            collection(db, 'platform_requests'),
            where('type', '==', 'quota_increase'),
            where('status', '==', 'unread'),
            orderBy('createdAt', 'desc'),
        );

        const [snapUser, snapQuota] = await Promise.all([
            getDocs(qUser).catch(() => ({ forEach: () => {} })),
            getDocs(qQuota).catch(() => ({ forEach: () => {} })),
        ]);

        const userReqs  = [];
        const quotaReqs = [];

        snapUser.forEach(d  => userReqs.push ({ id: d.id, ...d.data() }));
        snapQuota.forEach(d => quotaReqs.push({ id: d.id, ...d.data() }));

        const total = userReqs.length + quotaReqs.length;

        if (total === 0) {
            body.innerHTML = `
                <div style="text-align:center;padding:3rem;
                            color:var(--text-muted,#8b949e);">
                    <div style="font-size:2rem;margin-bottom:0.5rem;">✅</div>
                    Sin solicitudes pendientes.
                </div>`;
            return;
        }

        const roleLabels = {
            director:    '📋 Director Deportivo',
            coordinator: '🎯 Coordinador',
            user:        '⚽ Entrenador',
            parent:      '👨‍👩‍👧 Padre / Madre / Tutor',
        };

        const fmt = iso => iso
            ? new Date(iso).toLocaleDateString('es-ES',
                { day:'2-digit', month:'2-digit', year:'numeric' })
            : '–';

        let html = '';

        // ── Bloque: solicitudes de nuevo usuario ─────────────────────
        if (userReqs.length > 0) {
            html += `
            <h3 style="font-size:0.88rem;color:#58a6ff;margin:0 0 0.7rem;">
                📩 Solicitudes de Nuevo Usuario (${userReqs.length})
            </h3>
            <div style="display:grid;gap:0.8rem;margin-bottom:1.5rem;">
                ${userReqs.map(req => `
                <div style="background:var(--glass,rgba(255,255,255,0.04));
                            border:1px solid rgba(88,166,255,0.25);
                            border-radius:9px;padding:0.9rem;">
                    <div style="display:flex;justify-content:space-between;
                                align-items:flex-start;margin-bottom:0.6rem;">
                        <div>
                            <div style="font-weight:700;color:#58a6ff;font-size:0.9rem;">
                                ${req.clubName || req.clubId || '–'}
                            </div>
                            <div style="font-size:0.73rem;color:var(--text-muted);
                                        margin-top:0.1rem;">
                                Admin: ${req.requestedByEmail || '–'}
                            </div>
                        </div>
                        <div style="background:rgba(88,166,255,0.1);
                                   padding:0.25rem 0.5rem;border-radius:5px;
                                   font-size:0.68rem;color:#58a6ff;font-weight:700;">
                            ${fmt(req.createdAt)}
                        </div>
                    </div>
                    <div style="background:rgba(255,255,255,0.03);padding:0.6rem;
                                border-radius:6px;margin-bottom:0.6rem;
                                font-size:0.82rem;">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;">
                            <div>
                                <div style="color:var(--text-muted);font-size:0.68rem;">
                                    Email solicitado</div>
                                <div style="color:white;font-weight:700;word-break:break-all;">
                                    ${req.requestedEmail || '–'}</div>
                            </div>
                            <div>
                                <div style="color:var(--text-muted);font-size:0.68rem;">
                                    Rol</div>
                                <div style="color:white;font-weight:700;">
                                    ${roleLabels[req.requestedRole] || req.requestedRole || '–'}</div>
                            </div>
                            ${req.requestedName ? `
                            <div style="grid-column:1/-1;">
                                <div style="color:var(--text-muted);font-size:0.68rem;">Nombre</div>
                                <div style="color:white;">${req.requestedName}</div>
                            </div>` : ''}
                            ${req.playerNumber ? `
                            <div>
                                <div style="color:var(--text-muted);font-size:0.68rem;">Dorsal jugador</div>
                                <div style="color:white;">${req.playerNumber} ${req.playerAlias ? '· '+req.playerAlias : ''}</div>
                            </div>` : ''}
                        </div>
                        ${req.notes ? `
                        <div style="margin-top:0.4rem;padding-top:0.4rem;
                                    border-top:1px solid rgba(255,255,255,0.08);">
                            <div style="color:var(--text-muted);font-size:0.68rem;">Notas</div>
                            <div style="color:white;font-size:0.8rem;">${req.notes}</div>
                        </div>` : ''}
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button onclick="saApproveRequest('${req.id}', 'user_request', true)"
                                style="flex:1;padding:0.45rem;
                                       background:rgba(63,185,80,0.15);
                                       border:1px solid rgba(63,185,80,0.4);
                                       border-radius:6px;color:#3fb950;
                                       font-weight:700;cursor:pointer;font-size:0.82rem;">
                            ✅ APROBAR
                        </button>
                        <button onclick="saApproveRequest('${req.id}', 'user_request', false)"
                                style="flex:1;padding:0.45rem;
                                       background:rgba(255,88,88,0.15);
                                       border:1px solid rgba(255,88,88,0.4);
                                       border-radius:6px;color:#ff5858;
                                       font-weight:700;cursor:pointer;font-size:0.82rem;">
                            ❌ RECHAZAR
                        </button>
                    </div>
                </div>`).join('')}
            </div>`;
        }

        // ── Bloque: solicitudes de ampliación de cuota ────────────────
        if (quotaReqs.length > 0) {
            html += `
            <h3 style="font-size:0.88rem;color:#f0883e;margin:0 0 0.7rem;">
                📈 Solicitudes de Ampliación de Cuota (${quotaReqs.length})
            </h3>
            <div style="display:grid;gap:0.8rem;">
                ${quotaReqs.map(req => `
                <div style="background:var(--glass,rgba(255,255,255,0.04));
                            border:1px solid rgba(240,136,62,0.25);
                            border-radius:9px;padding:0.9rem;">
                    <div style="display:flex;justify-content:space-between;
                                margin-bottom:0.6rem;">
                        <div>
                            <div style="font-weight:700;color:#f0883e;font-size:0.9rem;">
                                ${req.clubName || req.clubId || '–'}
                            </div>
                            <div style="font-size:0.73rem;color:var(--text-muted);">
                                Admin: ${req.requestedByEmail || '–'}
                            </div>
                        </div>
                        <div style="background:rgba(240,136,62,0.1);padding:0.25rem 0.5rem;
                                   border-radius:5px;font-size:0.68rem;
                                   color:#f0883e;font-weight:700;">
                            ${fmt(req.createdAt)}
                        </div>
                    </div>
                    <div style="background:rgba(255,255,255,0.03);padding:0.6rem;
                                border-radius:6px;margin-bottom:0.6rem;
                                display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;
                                font-size:0.82rem;">
                        <div>
                            <div style="color:var(--text-muted);font-size:0.68rem;">Rol</div>
                            <div style="color:white;font-weight:700;">
                                ${roleLabels[req.role] || req.roleLabel || req.role || '–'}</div>
                        </div>
                        <div>
                            <div style="color:var(--text-muted);font-size:0.68rem;">Actual</div>
                            <div style="color:white;font-weight:700;">
                                ${req.currentUsed || 0} / ${req.currentMax === -1 ? '∞' : (req.currentMax || 0)}</div>
                        </div>
                        <div>
                            <div style="color:var(--text-muted);font-size:0.68rem;">Solicita</div>
                            <div style="color:#f0883e;font-weight:700;">
                                +${req.requestedExtra || 1}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button onclick="saApproveRequest('${req.id}', 'quota_increase', true)"
                                style="flex:1;padding:0.45rem;
                                       background:rgba(63,185,80,0.15);
                                       border:1px solid rgba(63,185,80,0.4);
                                       border-radius:6px;color:#3fb950;
                                       font-weight:700;cursor:pointer;font-size:0.82rem;">
                            ✅ APROBAR
                        </button>
                        <button onclick="saApproveRequest('${req.id}', 'quota_increase', false)"
                                style="flex:1;padding:0.45rem;
                                       background:rgba(255,88,88,0.15);
                                       border:1px solid rgba(255,88,88,0.4);
                                       border-radius:6px;color:#ff5858;
                                       font-weight:700;cursor:pointer;font-size:0.82rem;">
                            ❌ RECHAZAR
                        </button>
                    </div>
                </div>`).join('')}
            </div>`;
        }

        body.innerHTML = html;

    } catch (e) {
        body.innerHTML = `
            <p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${e.message}</p>`;
        console.error('[saRequests]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// saApproveRequest() — aprobar o rechazar una solicitud
// ═══════════════════════════════════════════════════════════════════════════

window.saApproveRequest = async function saApproveRequest(requestId, type, approve) {
    const verb = approve ? 'aprobar' : 'rechazar';
    if (!confirm(`¿${verb} esta solicitud?`)) return;

    _saShowSpinner(approve ? 'Aprobando…' : 'Rechazando…');
    try {
        const { db, doc, getDoc, setDoc, updateDoc } = await saFS();
        const me = window._cronosCurrentUser?.email || 'superadmin';

        const reqSnap = await getDoc(doc(db, 'platform_requests', requestId));
        if (!reqSnap.exists()) throw new Error('Solicitud no encontrada');
        const req = reqSnap.data();

        if (approve) {
            if (type === 'user_request') {
                // ── Crear pre-usuario para que pueda registrarse ────────
                const preUid = 'pre_sa_' + Date.now().toString(36);
                await setDoc(doc(db, 'users', preUid), {
                    email:         req.requestedEmail,
                    displayName:   req.requestedName  || '',
                    role:          req.requestedRole  || 'user',
                    clubId:        req.clubId,
                    clubName:      req.clubName       || '',
                    isAuthorized:  false,
                    status:        'pending_register',
                    // Datos de padre si aplica
                    ...(req.playerNumber ? {
                        playerNumber: req.playerNumber,
                        playerAlias:  req.playerAlias || '',
                        parentWA:     req.parentWA    || '',
                    } : {}),
                    createdAt:     new Date().toISOString(),
                    createdBySA:   me,
                    requestRef:    requestId,
                });
            } else if (type === 'quota_increase') {
                // ── Aumentar slots del club ─────────────────────────────
                const clubSnap = await getDoc(doc(db, 'clubs', req.clubId)).catch(() => null);
                if (clubSnap?.exists()) {
                    const slots   = Object.assign({}, clubSnap.data().slots || {});
                    const roleKey = {
                        director:    'directors',
                        coordinator: 'coordinators',
                        parent:      'parents',
                        user:        'users',
                    }[req.role] || 'users';
                    if (slots[roleKey] !== -1) {
                        slots[roleKey] = (slots[roleKey] || 0) + (req.requestedExtra || 1);
                    }
                    await updateDoc(doc(db, 'clubs', req.clubId), { slots });
                }
            }

            // Marcar solicitud como aprobada
            await updateDoc(doc(db, 'platform_requests', requestId), {
                status:     'approved',
                approvedAt: new Date().toISOString(),
                approvedBy: me,
            });

            _saHideSpinner();
            _saToast(
                type === 'user_request'
                    ? `✅ Aprobado. ${req.requestedEmail} puede registrarse ya.`
                    : `✅ Cuota ampliada +${req.requestedExtra || 1} plaza(s).`,
                5000,
            );

        } else {
            // ── RECHAZAR ───────────────────────────────────────────────
            await updateDoc(doc(db, 'platform_requests', requestId), {
                status:     'rejected',
                rejectedAt: new Date().toISOString(),
                rejectedBy: me,
            });

            _saHideSpinner();
            _saToast('❌ Solicitud rechazada.', 3000);
        }

        saRequests();   // refrescar

    } catch (e) {
        _saHideSpinner();
        _saToast(`⚠️ Error: ${e.message}`, 5000);
        console.error('[saApproveRequest]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// saTrash() — vista de usuarios en baja / bloqueados
// ═══════════════════════════════════════════════════════════════════════════

window.saTrash = async function saTrash() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="text-align:center;padding:2.5rem;
                    color:var(--text-muted,#8b949e);">
            <div style="font-size:1.6rem;">⏳</div> Cargando rastros…
        </div>`;

    try {
        const { db, collection, query, where, getDocs } = await saFS();

        const snap = await getDocs(query(
            collection(db, 'users'),
            where('status', 'in', ['removed', 'blocked']),
        ));

        const users = [];
        snap.forEach(d => users.push({ id: d.id, ...d.data() }));

        if (users.length === 0) {
            body.innerHTML = `
                <div style="text-align:center;padding:3rem;
                            color:var(--text-muted,#8b949e);">
                    <div style="font-size:2rem;margin-bottom:0.5rem;">✅</div>
                    Sin rastros pendientes de limpiar.
                </div>`;
            return;
        }

        const removed = users.filter(u => u.status === 'removed');
        const blocked = users.filter(u => u.status === 'blocked');
        const fmt     = iso => iso
            ? new Date(iso).toLocaleDateString('es-ES')
            : '–';

        const card = (borderRGB, u, buttons) => `
        <div style="background:var(--glass,rgba(255,255,255,0.04));
                    border:1px solid rgba(${borderRGB},0.3);
                    border-radius:8px;padding:0.65rem 0.75rem;
                    display:flex;justify-content:space-between;align-items:center;">
            <div>
                <div style="font-weight:700;color:white;font-size:0.83rem;">
                    ${u.email || u.id}
                </div>
                <div style="font-size:0.7rem;color:var(--text-muted);">
                    ${u.role || 'N/A'}
                    ${u.clubName ? '· ' + u.clubName : ''}
                    ${u.status === 'removed'
                        ? '· Baja: ' + fmt(u.removedAt)
                        : '· Bloqueado: ' + fmt(u.blockedAt)}
                    ${u.authDeleted ? ' · <span style="color:#3fb950">Auth limpio ✅</span>' : ''}
                </div>
            </div>
            <div style="display:flex;gap:0.25rem;flex-shrink:0;">${buttons}</div>
        </div>`;

        let html = '';

        if (removed.length > 0) {
            html += `
            <h3 style="color:#ff5858;margin:0 0 0.6rem;font-size:0.9rem;">
                🗑️ Dados de Baja (${removed.length})
            </h3>
            <div style="display:grid;gap:0.35rem;margin-bottom:1.4rem;">
                ${removed.map(u => card('255,88,88', u, `
                    <button onclick="saPurgeUser('${u.id}','${(u.email||u.id).replace(/'/g,"\\'")}')"
                            style="padding:0.3rem 0.6rem;background:rgba(255,88,88,0.15);
                                   border:1px solid rgba(255,88,88,0.4);border-radius:5px;
                                   color:#ff5858;font-size:0.72rem;cursor:pointer;font-weight:700;">
                        🗑️ Limpiar
                    </button>`)).join('')}
            </div>`;
        }

        if (blocked.length > 0) {
            html += `
            <h3 style="color:#f0883e;margin:0 0 0.6rem;font-size:0.9rem;">
                🔒 Bloqueados (${blocked.length})
            </h3>
            <div style="display:grid;gap:0.35rem;">
                ${blocked.map(u => card('240,136,62', u, `
                    <button onclick="saSetClubUserStatus('${u.id}','${(u.email||u.id).replace(/'/g,"\\'")}','active','${u.clubId||''}')"
                            style="padding:0.3rem 0.6rem;background:rgba(63,185,80,0.15);
                                   border:1px solid rgba(63,185,80,0.4);border-radius:5px;
                                   color:#3fb950;font-size:0.72rem;cursor:pointer;font-weight:700;">
                        ✅ Activar
                    </button>
                    <button onclick="saPurgeUser('${u.id}','${(u.email||u.id).replace(/'/g,"\\'")}')"
                            style="padding:0.3rem 0.6rem;background:rgba(255,88,88,0.15);
                                   border:1px solid rgba(255,88,88,0.4);border-radius:5px;
                                   color:#ff5858;font-size:0.72rem;cursor:pointer;font-weight:700;">
                        🗑️ Limpiar
                    </button>`)).join('')}
            </div>`;
        }

        body.innerHTML = html;

    } catch (e) {
        body.innerHTML = `
            <p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${e.message}</p>`;
        console.error('[saTrash]', e);
    }
};

// ── Purgar rastro definitivamente (borra documento de Firestore) ──────────

window.saPurgeUser = async function saPurgeUser(uid, email) {
    if (!confirm(
        `🗑️ LIMPIAR RASTRO: ${email}\n\n` +
        `Se borrará el registro de Firestore.\n` +
        `IRREVERSIBLE. ¿Confirmar?`,
    )) return;

    _saShowSpinner('Limpiando rastro…');
    try {
        const { db, doc, deleteDoc } = await saFS();
        await deleteDoc(doc(db, 'users', uid));
        _saHideSpinner();
        _saToast(`✅ Rastro de ${email} eliminado.`, 3000);
        saTrash();
    } catch (e) {
        _saHideSpinner();
        _saToast(`⚠️ Error: ${e.message}`, 4500);
        console.error('[saPurgeUser]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// setupClubsSyncListener() — escucha cambios en tiempo real
// ═══════════════════════════════════════════════════════════════════════════

window.setupClubsSyncListener = async function setupClubsSyncListener() {
    try {
        const { db, collection, onSnapshot } = await saFS();
        if (window._clubsSyncUnsubscribe) {
            window._clubsSyncUnsubscribe();
        }

        window._clubsSyncUnsubscribe = onSnapshot(
            collection(db, 'users'),
            (snap) => {
                const panel = document.getElementById('sa-panel');
                if (!panel || panel.style.display === 'none') return;

                const hasChange = snap.docChanges().some(ch =>
                    ch.type === 'removed' || ch.type === 'modified');

                if (hasChange) {
                    clearTimeout(window._saRefreshTimeout);
                    window._saRefreshTimeout = setTimeout(() => saClubs(), 700);
                }
            },
        );
    } catch (e) {
        console.error('[setupClubsSyncListener]', e);
    }
};

// ─────────────────────────────────────────────────────────────────────────
console.log('✅ 16_superadmin.js v8.1 cargado OK');

/**
 * 16_superadmin.js — Panel SuperAdministrador v8.0
 * Chronos Fútbol
 *
 * Funcionalidades:
 *  - Panel completo con pestañas: Clubes · Solicitudes · Rastros
 *  - Activar / Bloquear / Eliminar usuarios
 *  - Eliminación real de Firebase Auth via Cloud Function
 *  - Gestión de solicitudes de plazas
 *  - Limpieza de rastros en Firestore
 *  - Sincronización en tiempo real
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS UI  — fallbacks seguros si app.js no expone showSpinner etc.
// ═══════════════════════════════════════════════════════════════════════════

(function _registerSAHelpers() {
    // Spinner overlay exclusivo del panel SA
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
        document.getElementById('_sa-spinner-msg').textContent = msg || '';
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
// saFS()  — centraliza imports de Firestore + Functions
// ═══════════════════════════════════════════════════════════════════════════

window.saFS = async function saFS() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) {
        throw new Error('Firebase no inicializado. Recarga la página.');
    }

    // Importar módulos en paralelo
    const [fs, fnMod, appMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    ]);

    // Inicializar Firebase Functions una sola vez
    if (!fa._functions) {
        try {
            fa._functions = fnMod.getFunctions(appMod.getApp());
        } catch (e) {
            console.warn('[saFS] No se pudo inicializar Functions:', e.message);
        }
    }

    return {
        fa: Object.assign({}, fa, { functions: fa._functions }),
        // Firestore
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
        // Functions
        httpsCallable:   fnMod.httpsCallable,
    };
};

// ═══════════════════════════════════════════════════════════════════════════
// openSuperAdminPanel()  — punto de entrada principal
// ═══════════════════════════════════════════════════════════════════════════

window.openSuperAdminPanel = function openSuperAdminPanel() {
    // Ocultar otras pantallas
    ['main-header', 'role-selection-screen', 'install-screen', 'auth-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    // Ocultar main app
    const mainApp = document.getElementById('app-main') || document.querySelector('main');
    if (mainApp) mainApp.style.display = 'none';

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
<!-- ── Header ── -->
<div style="background:rgba(255,255,255,0.04);
            border-bottom:1px solid rgba(255,255,255,0.1);
            padding:0.85rem 1.2rem;
            display:flex;justify-content:space-between;align-items:center;
            flex-shrink:0;">
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
    <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();
                     else if(typeof window.logoutUser==='function')window.logoutUser();"
            style="background:none;border:1px solid rgba(255,88,88,0.3);
                   color:rgba(255,88,88,0.8);padding:0.35rem 0.75rem;
                   border-radius:6px;cursor:pointer;font-size:0.78rem;">
        ⏻ Salir
    </button>
</div>

<!-- ── Tabs ── -->
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

<!-- ── Body ── -->
<div id="sa-body"
     style="flex:1;overflow-y:auto;padding:1.2rem;
            -webkit-overflow-scrolling:touch;"></div>
        `;

        document.body.appendChild(panel);
    }

    panel.style.display = 'flex';
    saTab('clubs');
};

// ═══════════════════════════════════════════════════════════════════════════
// saTab()  — cambia entre pestañas
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
// saClubs()  — listado de clubs y sus usuarios
// ═══════════════════════════════════════════════════════════════════════════

window.saClubs = async function saClubs() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="text-align:center;padding:2.5rem;color:var(--text-muted,#8b949e);">
            <div style="font-size:1.6rem;margin-bottom:0.4rem;">⏳</div>
            Cargando clubes y usuarios…
        </div>`;

    try {
        const { fa, collection, getDocs } = await saFS();

        const [clubsSnap, usersSnap] = await Promise.all([
            getDocs(collection(fa.db, 'clubs')),
            getDocs(collection(fa.db, 'users')),
        ]);

        // Organizar clubs
        const clubs = {};
        clubsSnap.forEach(d => { clubs[d.id] = { id: d.id, users: [], ...d.data() }; });

        // Asignar usuarios
        const orphans = [];
        usersSnap.forEach(d => {
            const u = { id: d.id, ...d.data() };
            if (u.role === 'superadmin') return;
            if (u.clubId && clubs[u.clubId]) clubs[u.clubId].users.push(u);
            else                            orphans.push(u);
        });

        const roleIcon = {
            director: '📋', coordinator: '🎯', user: '⚽',
            parent: '👨‍👩‍👧', individual: '👤', admin: '🏟️', club_admin: '🏟️',
        };
        const stColor = { active: '#3fb950', blocked: '#f0883e', removed: '#ff5858' };
        const stTxt   = { active: 'Activo',  blocked: 'Bloqueado', removed: 'Eliminado' };

        const renderRow = (u, cid) => {
            const st = u.status || (u.isAuthorized ? 'active' : 'blocked');
            return `
            <div style="display:flex;align-items:center;gap:0.45rem;
                        padding:0.52rem 0.6rem;
                        border-bottom:1px solid rgba(255,255,255,0.04);">
                <span>${roleIcon[u.role] || '👤'}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.83rem;color:white;
                                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${u.email || u.id}
                    </div>
                    <div style="font-size:0.7rem;color:${stColor[st] || '#8b949e'};">
                        ${u.role || 'N/A'} · ${stTxt[st] || st}
                    </div>
                </div>
                <div style="display:flex;gap:0.22rem;flex-shrink:0;">
                    ${st !== 'active' ? `
                    <button title="Activar"
                            onclick="saSetClubUserStatus('${u.id}','${u.email}','active','${cid}')"
                            style="padding:0.28rem 0.5rem;
                                   background:rgba(63,185,80,0.15);
                                   border:1px solid rgba(63,185,80,0.4);
                                   border-radius:5px;color:#3fb950;
                                   font-size:0.72rem;cursor:pointer;">✅</button>` : ''}
                    ${st === 'active' ? `
                    <button title="Bloquear"
                            onclick="saSetClubUserStatus('${u.id}','${u.email}','blocked','${cid}')"
                            style="padding:0.28rem 0.5rem;
                                   background:rgba(240,136,62,0.15);
                                   border:1px solid rgba(240,136,62,0.4);
                                   border-radius:5px;color:#f0883e;
                                   font-size:0.72rem;cursor:pointer;">🔒</button>` : ''}
                    <button title="Eliminar definitivamente"
                            onclick="saSetClubUserStatus('${u.id}','${u.email}','removed','${cid}')"
                            style="padding:0.28rem 0.5rem;
                                   background:rgba(255,88,88,0.15);
                                   border:1px solid rgba(255,88,88,0.4);
                                   border-radius:5px;color:#ff5858;
                                   font-size:0.72rem;cursor:pointer;">🗑️</button>
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
                const visible = c.users.filter(u => u.role !== 'superadmin');
                html += `
                <div style="margin-bottom:1.1rem;border:1px solid rgba(255,255,255,0.08);
                            border-radius:10px;overflow:hidden;">
                    <div style="background:rgba(88,166,255,0.07);
                                padding:0.65rem 0.9rem;
                                display:flex;justify-content:space-between;
                                align-items:center;">
                        <span style="font-family:'Outfit',sans-serif;font-weight:700;
                                     color:white;font-size:0.93rem;">
                            🏟️ ${c.name || c.id}
                        </span>
                        <span style="font-size:0.7rem;color:var(--text-muted);">
                            ${visible.length} usuario(s)
                        </span>
                    </div>
                    ${visible.length
                        ? `<div>${visible.map(u => renderRow(u, c.id)).join('')}</div>`
                        : `<p style="margin:0;padding:0.65rem 0.9rem;
                                    color:var(--text-muted);font-size:0.82rem;">
                               Sin usuarios asignados
                           </p>`}
                </div>`;
            });
        }

        // Huérfanos
        if (orphans.length > 0) {
            html += `
            <div style="margin-bottom:1.1rem;border:1px solid rgba(255,215,0,0.2);
                        border-radius:10px;overflow:hidden;">
                <div style="background:rgba(255,215,0,0.07);padding:0.65rem 0.9rem;">
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
// saSetClubUserStatus()  — activar / bloquear / eliminar
// ═══════════════════════════════════════════════════════════════════════════

window.saSetClubUserStatus = async function saSetClubUserStatus(uid, email, newStatus, clubId) {
    const labels = {
        active:  'activar',
        blocked: 'bloquear',
        removed: 'eliminar definitivamente',
    };
    if (!confirm(`¿Deseas ${labels[newStatus] || newStatus} a ${email}?`)) return;

    _saShowSpinner('Procesando…');
    try {
        const { fa, doc, getDoc, updateDoc, deleteDoc, httpsCallable } = await saFS();

        // Leer datos actuales del usuario
        const uSnap = await getDoc(doc(fa.db, 'users', uid));
        const ud    = uSnap.exists() ? uSnap.data() : {};
        const role  = ud.role || 'user';

        const slotFieldMap = {
            director:    'usedSlots.directors',
            coordinator: 'usedSlots.coordinators',
            parent:      'usedSlots.parents',
        };
        const slotKey = slotFieldMap[role] || 'usedSlots.users';

        // ── ELIMINAR DEFINITIVAMENTE ─────────────────────────────────────
        if (newStatus === 'removed') {

            // 1. Borrar de Firebase Auth via Cloud Function
            if (httpsCallable && fa.functions) {
                try {
                    const deleteFn = httpsCallable(fa.functions, 'deleteAuthUser');
                    const result   = await deleteFn({ uid, email });
                    console.log('[SA] Auth eliminado:', result);
                } catch (authErr) {
                    // Puede ya estar eliminado; continuamos
                    console.warn('[SA] Auth delete warning:', authErr.message);
                }
            } else {
                console.warn('[SA] Firebase Functions no disponible. Solo se borrará Firestore.');
            }

            // 2. Marcar como eliminado en Firestore (conservar rastro)
            try {
                await updateDoc(doc(fa.db, 'users', uid), {
                    status:      'removed',
                    isAuthorized: false,
                    removedAt:   new Date().toISOString(),
                    removedBy:   window._cronosCurrentUser?.email || 'superadmin',
                });
            } catch (_) {
                // Si el documento fue borrado ya, ignorar
            }

            // 3. Liberar plaza en el club
            if (clubId) {
                const cSnap = await getDoc(doc(fa.db, 'clubs', clubId)).catch(() => null);
                if (cSnap?.exists()) {
                    const subField = slotKey.split('.')[1];
                    const cur = (cSnap.data().usedSlots || {})[subField] || 1;
                    await updateDoc(doc(fa.db, 'clubs', clubId), {
                        [slotKey]: Math.max(0, cur - 1),
                    }).catch(() => {});
                }
            }

            _saHideSpinner();
            _saToast(`🗑️ ${email} eliminado. Puede volver a registrarse.`, 4500);

        // ── ACTIVAR / BLOQUEAR ────────────────────────────────────────────
        } else {
            const isActive = (newStatus === 'active');
            await updateDoc(doc(fa.db, 'users', uid), {
                isAuthorized: isActive,
                status:       newStatus,
                ...(isActive
                    ? { authorizedAt: new Date().toISOString() }
                    : { blockedAt:    new Date().toISOString() }),
            });

            // Ajustar slots del club
            if (clubId) {
                const cSnap = await getDoc(doc(fa.db, 'clubs', clubId)).catch(() => null);
                if (cSnap?.exists()) {
                    const subField = slotKey.split('.')[1];
                    const cur   = (cSnap.data().usedSlots || {})[subField] || 0;
                    const delta = isActive ? 1 : -1;
                    await updateDoc(doc(fa.db, 'clubs', clubId), {
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

        saClubs();   // refrescar lista

    } catch (e) {
        _saHideSpinner();
        _saToast(`⚠️ Error: ${e.message}`, 5000);
        console.error('[saSetClubUserStatus]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// saTrash()  — vista de usuarios eliminados/bloqueados
// ═══════════════════════════════════════════════════════════════════════════

window.saTrash = async function saTrash() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="text-align:center;padding:2.5rem;color:var(--text-muted,#8b949e);">
            <div style="font-size:1.6rem;">⏳</div> Cargando rastros…
        </div>`;

    try {
        const { fa, collection, query, where, getDocs } = await saFS();

        const q    = query(
            collection(fa.db, 'users'),
            where('status', 'in', ['removed', 'blocked']),
        );
        const snap = await getDocs(q);
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

        const card = (borderRGB) => [
            'background:var(--glass,rgba(255,255,255,0.04));',
            `border:1px solid rgba(${borderRGB},0.3);`,
            'border-radius:8px;padding:0.68rem 0.75rem;',
            'display:flex;justify-content:space-between;align-items:center;',
        ].join('');

        let html = '';

        if (removed.length > 0) {
            html += `
            <h3 style="color:#ff5858;margin:0 0 0.6rem;font-size:0.93rem;">
                🗑️ Usuarios Eliminados (${removed.length})
            </h3>
            <div style="display:grid;gap:0.35rem;margin-bottom:1.4rem;">
                ${removed.map(u => `
                <div style="${card('255,88,88')}">
                    <div>
                        <div style="font-weight:700;color:white;font-size:0.84rem;">
                            ${u.email || u.id}
                        </div>
                        <div style="font-size:0.7rem;color:var(--text-muted);">
                            ${u.role || 'N/A'} ·
                            Eliminado: ${u.removedAt
                                ? new Date(u.removedAt).toLocaleDateString('es-ES')
                                : '–'}
                        </div>
                    </div>
                    <button onclick="saPurgeUser('${u.id}','${u.email || u.id}')"
                            style="padding:0.32rem 0.65rem;
                                   background:rgba(255,88,88,0.15);
                                   border:1px solid rgba(255,88,88,0.4);
                                   border-radius:5px;color:#ff5858;
                                   font-size:0.74rem;cursor:pointer;font-weight:700;">
                        🗑️ LIMPIAR
                    </button>
                </div>`).join('')}
            </div>`;
        }

        if (blocked.length > 0) {
            html += `
            <h3 style="color:#f0883e;margin:0 0 0.6rem;font-size:0.93rem;">
                🔒 Usuarios Bloqueados (${blocked.length})
            </h3>
            <div style="display:grid;gap:0.35rem;">
                ${blocked.map(u => `
                <div style="${card('240,136,62')}">
                    <div>
                        <div style="font-weight:700;color:white;font-size:0.84rem;">
                            ${u.email || u.id}
                        </div>
                        <div style="font-size:0.7rem;color:var(--text-muted);">
                            ${u.role || 'N/A'} ·
                            Bloqueado: ${u.blockedAt
                                ? new Date(u.blockedAt).toLocaleDateString('es-ES')
                                : '–'}
                        </div>
                    </div>
                    <div style="display:flex;gap:0.25rem;">
                        <button onclick="saSetClubUserStatus('${u.id}','${u.email || u.id}','active','${u.clubId || ''}')"
                                style="padding:0.32rem 0.65rem;
                                       background:rgba(63,185,80,0.15);
                                       border:1px solid rgba(63,185,80,0.4);
                                       border-radius:5px;color:#3fb950;
                                       font-size:0.74rem;cursor:pointer;font-weight:700;">
                            ✅ ACTIVAR
                        </button>
                        <button onclick="saPurgeUser('${u.id}','${u.email || u.id}')"
                                style="padding:0.32rem 0.65rem;
                                       background:rgba(255,88,88,0.15);
                                       border:1px solid rgba(255,88,88,0.4);
                                       border-radius:5px;color:#ff5858;
                                       font-size:0.74rem;cursor:pointer;font-weight:700;">
                            🗑️ LIMPIAR
                        </button>
                    </div>
                </div>`).join('')}
            </div>`;
        }

        body.innerHTML = html;

    } catch (e) {
        body.innerHTML = `
            <p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${e.message}</p>`;
        console.error('[saTrash]', e);
    }
};

// ── Limpiar rastro definitivamente (solo borra Firestore) ──────────────────

window.saPurgeUser = async function saPurgeUser(uid, email) {
    if (!confirm(
        `🗑️ LIMPIAR RASTRO: ${email}\n\n` +
        `Se borrará el registro de Firestore.\n` +
        `Esta acción es IRREVERSIBLE.\n\n¿Confirmar?`,
    )) return;

    _saShowSpinner('Limpiando rastro…');
    try {
        const { fa, doc, deleteDoc } = await saFS();
        await deleteDoc(doc(fa.db, 'users', uid));
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
// saRequests()  — solicitudes de plazas pendientes
// ═══════════════════════════════════════════════════════════════════════════

window.saRequests = async function saRequests() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
        <div style="text-align:center;padding:2.5rem;color:var(--text-muted,#8b949e);">
            <div style="font-size:1.6rem;">⏳</div> Cargando solicitudes…
        </div>`;

    try {
        const { fa, collection, query, where, getDocs, orderBy } = await saFS();

        const q    = query(
            collection(fa.db, 'slot_requests'),
            where('status', '==', 'pending'),
            orderBy('createdAt', 'desc'),
        );
        const snap = await getDocs(q);
        const requests = [];
        snap.forEach(d => requests.push({ id: d.id, ...d.data() }));

        if (requests.length === 0) {
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
            parent:      '👨‍👩‍👧 Padre / Madre',
        };

        body.innerHTML = `
        <div style="display:grid;gap:0.8rem;">
            ${requests.map(req => `
            <div style="background:var(--glass,rgba(255,255,255,0.04));
                        border:1px solid rgba(88,166,255,0.25);
                        border-radius:9px;padding:0.9rem;">
                <!-- Club + fecha -->
                <div style="display:flex;justify-content:space-between;
                            align-items:flex-start;margin-bottom:0.65rem;">
                    <div>
                        <div style="font-weight:700;color:#58a6ff;font-size:0.93rem;">
                            ${req.clubName || req.clubId || '–'}
                        </div>
                        <div style="font-size:0.74rem;color:var(--text-muted);
                                    margin-top:0.12rem;">
                            ${req.adminEmail || '–'}
                        </div>
                    </div>
                    <div style="background:rgba(88,166,255,0.12);
                               padding:0.28rem 0.58rem;border-radius:5px;
                               font-size:0.7rem;color:#58a6ff;font-weight:700;">
                        ${req.createdAt
                            ? new Date(req.createdAt).toLocaleDateString('es-ES')
                            : '–'}
                    </div>
                </div>
                <!-- Detalles -->
                <div style="background:rgba(255,255,255,0.03);padding:0.6rem;
                            border-radius:6px;margin-bottom:0.65rem;
                            display:grid;grid-template-columns:1fr 1fr;
                            gap:0.4rem;font-size:0.82rem;">
                    <div>
                        <div style="color:var(--text-muted);font-size:0.7rem;">Rol</div>
                        <div style="color:white;font-weight:700;">
                            ${roleLabels[req.requestedRole] || req.requestedRole || '–'}
                        </div>
                    </div>
                    <div>
                        <div style="color:var(--text-muted);font-size:0.7rem;">Cantidad</div>
                        <div style="color:white;font-weight:700;">
                            ${req.quantity || 1} plaza(s)
                        </div>
                    </div>
                    ${req.notes ? `
                    <div style="grid-column:1/-1;border-top:1px solid rgba(255,255,255,0.08);
                                padding-top:0.4rem;margin-top:0.2rem;">
                        <div style="color:var(--text-muted);font-size:0.7rem;">Notas</div>
                        <div style="color:white;font-size:0.82rem;">${req.notes}</div>
                    </div>` : ''}
                </div>
                <!-- Acciones -->
                <div style="display:flex;gap:0.5rem;">
                    <button onclick="saApproveRequest('${req.id}', true)"
                            style="flex:1;padding:0.48rem;
                                   background:rgba(63,185,80,0.15);
                                   border:1px solid rgba(63,185,80,0.4);
                                   border-radius:6px;color:#3fb950;
                                   font-weight:700;cursor:pointer;font-size:0.82rem;">
                        ✅ APROBAR
                    </button>
                    <button onclick="saApproveRequest('${req.id}', false)"
                            style="flex:1;padding:0.48rem;
                                   background:rgba(255,88,88,0.15);
                                   border:1px solid rgba(255,88,88,0.4);
                                   border-radius:6px;color:#ff5858;
                                   font-weight:700;cursor:pointer;font-size:0.82rem;">
                        ❌ RECHAZAR
                    </button>
                </div>
            </div>`).join('')}
        </div>`;

    } catch (e) {
        body.innerHTML = `
            <p style="color:#ff5858;text-align:center;padding:2rem;">⚠️ ${e.message}</p>`;
        console.error('[saRequests]', e);
    }
};

// ── Aprobar / Rechazar solicitud ───────────────────────────────────────────

window.saApproveRequest = async function saApproveRequest(requestId, approve) {
    if (!confirm(`¿${approve ? 'Aprobar' : 'Rechazar'} esta solicitud?`)) return;

    _saShowSpinner(approve ? 'Aprobando…' : 'Rechazando…');
    try {
        const { fa, doc, getDoc, updateDoc } = await saFS();

        const reqSnap = await getDoc(doc(fa.db, 'slot_requests', requestId));
        if (!reqSnap.exists()) throw new Error('Solicitud no encontrada');
        const req = reqSnap.data();

        if (approve) {
            // Aumentar slots disponibles del club
            const clubSnap = await getDoc(doc(fa.db, 'clubs', req.clubId));
            if (clubSnap.exists()) {
                const club    = clubSnap.data();
                const slots   = Object.assign({}, club.slots || {});
                const roleKey = {
                    director:    'directors',
                    coordinator: 'coordinators',
                    parent:      'parents',
                    user:        'users',
                }[req.requestedRole] || 'users';

                if (slots[roleKey] !== -1) {
                    slots[roleKey] = (slots[roleKey] || 0) + (req.quantity || 1);
                }
                await updateDoc(doc(fa.db, 'clubs', req.clubId), { slots });
            }

            await updateDoc(doc(fa.db, 'slot_requests', requestId), {
                status:     'approved',
                approvedAt: new Date().toISOString(),
                approvedBy: window._cronosCurrentUser?.email || '',
            });

            _saHideSpinner();
            _saToast(`✅ Solicitud aprobada (${req.quantity || 1} plaza(s))`, 4000);

        } else {
            await updateDoc(doc(fa.db, 'slot_requests', requestId), {
                status:     'rejected',
                rejectedAt: new Date().toISOString(),
                rejectedBy: window._cronosCurrentUser?.email || '',
            });

            _saHideSpinner();
            _saToast('❌ Solicitud rechazada', 3000);
        }

        saRequests();   // refrescar lista

    } catch (e) {
        _saHideSpinner();
        _saToast(`⚠️ Error: ${e.message}`, 5000);
        console.error('[saApproveRequest]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// setupClubsSyncListener()  — sincronización en tiempo real
// ═══════════════════════════════════════════════════════════════════════════

window.setupClubsSyncListener = async function setupClubsSyncListener() {
    try {
        const { fa, collection, onSnapshot } = await saFS();
        if (window._clubsSyncUnsubscribe) {
            window._clubsSyncUnsubscribe();
        }

        window._clubsSyncUnsubscribe = onSnapshot(
            collection(fa.db, 'users'),
            (snap) => {
                snap.docChanges().forEach(ch => {
                    if (ch.type === 'removed' || ch.type === 'modified') {
                        const panel = document.getElementById('sa-panel');
                        if (panel && panel.style.display !== 'none') {
                            clearTimeout(window._saRefreshTimeout);
                            window._saRefreshTimeout = setTimeout(() => saClubs(), 600);
                        }
                    }
                });
            },
        );
    } catch (e) {
        console.error('[setupClubsSyncListener]', e);
    }
};

// ─────────────────────────────────────────────────────────────────────────
console.log('✅ 16_superadmin.js v8.0 cargado OK');

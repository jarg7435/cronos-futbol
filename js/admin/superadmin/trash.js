// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/trash.js
//  Papelera del SuperAdmin: usuarios dados de baja/bloqueados.
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-24. Movimiento puramente
//  mecánico, sin cambios de lógica — depende de helpers ya definidos por
//  superadmin.panel.js (saFS, _saShowSpinner/_saHideSpinner/_saToast,
//  window.ROLE_META), que debe cargarse ANTES que este archivo.
//  Cubierto por scripts/test_sa_trash_module.js.
// ════════════════════════════════════════════════════════════════════

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

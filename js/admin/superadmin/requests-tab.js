// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/requests-tab.js
//  Pestaña "Solicitudes" del SuperAdmin — conteo unificado de pendientes
//  (saCountPendingRequests), listado de las cuatro fuentes de solicitudes
//  (saRequests) y el flujo de aprobación/rechazo con sus cuatro tipos:
//  direct_user, user_request, quota_increase y club_admin_succession
//  (saApproveRequest).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-26. Movimiento puramente
//  mecánico, bloque byte a byte idéntico al de HEAD, sin cambios de
//  lógica. Depende de helpers ya definidos por superadmin.panel.js (saFS,
//  _saShowSpinner/_saHideSpinner/_saToast, window.ROLE_META), que debe
//  cargarse ANTES que este archivo.
//
//  ⚠️ ORDEN DE CARGA — DOS CONDICIONES, ambas verificadas por
//  scripts/test_sa_requests_module.js (aserciones 1d y 1e):
//   1. DESPUÉS de js/core/app-init.js, que define una saRequests legacy
//      (panel SuperAdmin antiguo) que quedaría ganando si no.
//   2. ANTES de js/admin/superadmin/extras.js, cuyo patchSaRequests()
//      REEMPLAZA window.saRequests por su propia versión ~600ms después de
//      DOMContentLoaded. Captura `var orig = window.saRequests` pero solo
//      la usa como guarda (`if (!orig || orig._p25req) return;`) — nunca
//      la invoca. Es decir: saRequests y saApproveRequest de este archivo
//      NO se ejecutan en producción, pero su EXISTENCIA es la precondición
//      que habilita el reemplazo de extras.js. Si se borrasen, el parche
//      abortaría en su guarda y la pestaña se quedaría sin implementación.
//      Por eso se conservan tal cual. saCountPendingRequests sí está viva
//      (openSuperAdminPanel y clubs-tab.js la usan para el badge).
//
//  Dos bugs latentes preexistentes viven en las ramas muertas y se han
//  preservado deliberadamente (documentados en la cabecera y en la parte 8
//  del test): _indEntityId3 fuera de scope en el try de setCustomClaims de
//  la rama user_request/individual, y getDocs/query/collection/where sin
//  destructurar en la rama user_request/"otros roles".
//
//  Cubierto por scripts/test_sa_requests_module.js.
// ════════════════════════════════════════════════════════════════════

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
            // ════════════════════════════════════════════════════════════
            //  v532 · DEDUPLICAR POR PERSONA, NO POR TIPO DE SOLICITUD
            //
            //  Reporte del autor: el badge decía 7 y la lista pintaba 4.
            //  Medido por REST sobre producción: había 3 usuarios en
            //  `pending_sa` y 4 solicitudes en `platform_requests/pending_sa`
            //  —los mismos 3, más uno—. El contador sumaba 3 + 4 = 7,
            //  contando DOS VECES a las mismas tres personas: una por su
            //  documento de usuario y otra por su solicitud.
            //
            //  🔑 La regla de arriba intentaba evitarlo, pero deduplicaba por
            //  TIPO y ROL: sólo se saltaba `self_registration` de `club_admin`
            //  o `individual`. Las cuatro reales eran `self_registration` con
            //  `requestedRole: 'user'` (entrenador), así que no entraban. El
            //  desfase aparecía con cualquier entrenador, director,
            //  coordinador o padre: sólo los admins de club y los individuales
            //  estaban cubiertos.
            //
            //  Ahora se deduplica por IDENTIDAD (`userUid`, que es el id del
            //  documento de usuario), que es como lo hace la lista que de
            //  verdad se pinta (extras.js · patchSaRequests). Una persona con
            //  solicitud Y documento pendiente es UN elemento, no dos.
            //
            //  ⚠️ NO se filtra por "usuario ya activo": un usuario activo con
            //  solicitud pendiente es un caso NORMAL —pedir un rol nuevo—, y
            //  hay uno real en producción (brunoromar2012, entrenador en
            //  CD DÍA sobre una cuenta que ya tenía otros seis roles).
            // ════════════════════════════════════════════════════════════
            //  ⚠️ Sólo se salta lo YA CONTADO por su documento de usuario. NO se
            //  marca aquí el userUid como visto: dos solicitudes distintas de la
            //  misma persona (p. ej. entrenador y director) son DOS filas en la
            //  lista, y el badge tiene que decir dos. Marcarlo escondía la
            //  segunda — lo cazó la aserción 2k.
            if (r.userUid && _seen.has(r.userUid)) return;
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

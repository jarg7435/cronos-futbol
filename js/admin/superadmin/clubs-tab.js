// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/clubs-tab.js
//  Pestaña "Clubes" — listado de clubes con contadores de slots, árbol de
//  usuarios por categoría y bolsa de huérfanos sin club (saClubs), la
//  aprobación rápida en dos pasos desde esa vista (saQuickApprove) y el
//  listener de sincronización en tiempo real que la refresca, además del
//  badge de solicitudes pendientes (setupClubsSyncListener).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-26. Movimiento puramente
//  mecánico, sin cambios de lógica — depende de helpers ya definidos por
//  superadmin.panel.js (saFS, _saShowSpinner/_saHideSpinner/_saToast,
//  window.ROLE_META), que debe cargarse ANTES que este archivo. Llama a
//  saIndividuals (individuals-tab.js), saRequests/saCountPendingRequests
//  (superadmin.panel.js) y a saEditClubSlots/saDeleteClubComplete/
//  saShowCreateClub/saShowCreateIndividualEntity/saShowCreateIndividual/
//  saSetClubUserStatus, todas resueltas en tiempo de click o de evento,
//  sin dependencia de orden de carga.
//
//  ⚠️ ORDEN DE CARGA: js/core/app-init.js contiene un `async function
//  saClubs()` LEGACY duplicado (panel SA antiguo). Este archivo DEBE
//  seguir cargándose después de app-init.js en index.html o la versión
//  legacy ganaría y rompería la pestaña. La aserción 1d de
//  scripts/test_sa_clubs_module.js lo verifica automáticamente.
//
//  Cubierto por scripts/test_sa_clubs_module.js.
// ════════════════════════════════════════════════════════════════════

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
        // ⏱️ v638 · Estas DOS son las que se veían denegadas al entrar (captura
        //    9668). `saFS()` ya espera el token; el reintento con refresco
        //    forzado es la segunda red, para cuando el token llega tarde de
        //    verdad. Ver la nota larga en superadmin.panel.js.
        const [clubsSnap, usersSnap] = await window._saConReintento(() => Promise.all([
            getDocs(collection(db,'clubs')),
            getDocs(collection(db,'users')),
        ]), 'saClubs');
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
            // ═══════════════════════════════════════════════════════════
            //  🔴🔴🔴 v582 · ESTE `return` BORRABA EL BENJAMÍN C DEL PANEL
            //
            //  Reporte del autor (capturas 9263/9264, v581): "el entrenador
            //  del Benjamín C ha desaparecido de su sitio", y los dos paneles
            //  no coinciden — el del Club cuenta 11 entrenadores y el del
            //  SuperAdmin, 9.
            //
            //  🔑🔑🔑 Medido por REST: `brunoromar2012@gmail.com` lleva el
            //  **benjamin/C** de CD DÍA, y su documento tiene en la RAÍZ
            //  `role:'individual'`. Sus DOS plazas son `role:'user'` en un club
            //  de verdad, pero la primera condición de arriba mira la raíz, lo
            //  daba por usuario de ente individual y lo sacaba de la lista
            //  ANTES de repartir. Resultado exacto y comprobable:
            //    · Benjamín se queda vacío en el SuperAdmin y lleno en el Club;
            //    · y sus 2 plazas explican, al caracter, el 11 contra 9.
            //
            //  ⚠️ ES EL DEFECTO DE v563 OTRA VEZ, un paso más arriba. Allí se
            //  corrigió el REPARTO para que mirase `allRoles` en vez de la
            //  raíz; pero el filtro que decide quién entra siquiera al reparto
            //  se quedó mirando la raíz, y ninguna corrección del reparto puede
            //  alcanzar a quien ya se ha descartado.
            //
            //  🔑 LA REGLA: la raíz no decide la pertenencia; las PLAZAS sí.
            //  Quien tenga una plaza en un club real ES de ese club, diga lo
            //  que diga un campo de compatibilidad. `clubs` sólo contiene
            //  clubes reales (los de tipo 'individual' se apartaron arriba, en
            //  `_indivClubIds`), así que esto no puede colar a un usuario de
            //  ente individual en la pestaña de Clubes.
            // ═══════════════════════════════════════════════════════════
            const _esClubReal = (cid) => !!(cid && clubs[cid]);
            const _tienePlazaEnClubReal = _esClubReal(u.clubId) ||
                (u.allRoles || []).some(r => r && (_esClubReal(r.clubId) || _esClubReal(r.requestedClubId)));
            if (isIndivUser && !_tienePlazaEnClubReal) return;

            // ═══════════════════════════════════════════════════════════
            //  🔴🔴🔴 v563 · EL SUPERADMIN REPARTÍA SÓLO POR LA RAÍZ
            //
            //  Reporte del autor (capturas 9094 vs 9095): en el Panel de
            //  Administrador de Club los entrenadores y sus categorías salen
            //  perfectamente; en el del SuperAdmin, el MISMO club aparece con
            //  las categorías VACÍAS. Los datos nunca se borraron —lo confirmó
            //  él comparando los dos paneles—: lo que fallaba era la lectura.
            //
            //  🔑🔑🔑 Aquí estaba el porqué: `if (u.clubId && clubs[u.clubId])`
            //  decidía la pertenencia mirando SÓLO `u.clubId`, la raíz del
            //  documento. El panel del club NO usa la raíz para esto: recorre
            //  `allRoles` (`r.clubId === clubId || !r.clubId`). Así que a quien
            //  tuviera la raíz vacía, obsoleta o apuntando a otro club, el
            //  SuperAdmin lo mandaba a "Sin club asignado" aunque sus PLAZAS
            //  dijeran con claridad a qué club pertenece. Dos vistas del mismo
            //  dato con dos criterios distintos: por fuerza tenían que
            //  contradecirse, y el multiequipo es donde más se nota.
            //
            //  ⚠️⚠️ NO ES SÓLO EL ÁRBOL. `c.users` alimenta también `vis`, y de
            //  `vis` salen los CONTADORES DE PLAZAS (`cronosPlazasOcupadas`):
            //  un entrenador invisible tampoco se contaba, así que el club
            //  parecía tener plazas libres que en realidad están ocupadas.
            //
            //  🔑 La unidad es la PLAZA. Una persona con dos equipos —o con
            //  roles en dos clubes— pertenece a TODOS ellos, así que se reparte
            //  a cada club implicado y no al primero que gane un `if/else`.
            // ═══════════════════════════════════════════════════════════
            const _destinos = new Set();
            if (u.clubId && clubs[u.clubId]) _destinos.add(u.clubId);
            (u.allRoles || []).forEach(r => {
                const _rc = r && (r.clubId || r.requestedClubId);
                if (_rc && clubs[_rc]) _destinos.add(_rc);
            });
            // Una plaza SIN clubId sólo puede atribuirse por la raíz, que ya se
            // ha mirado arriba. Sin ningún destino válido sigue siendo huérfano,
            // que es justo lo que ese apartado existe para enseñar.
            if (_destinos.size === 0) { orphans.push(u); return; }
            _destinos.forEach(cid => clubs[cid].users.push(u));
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
                    // ⚠️ v581 · 'removed' TAMBIÉN excluye, no sólo 'rejected'.
                    //    Desde que la baja MARCA el rol en vez de borrarlo
                    //    (v477/v478: la baja es una revocación), una plaza dada
                    //    de baja SIGUE en `allRoles` con status:'removed'. El
                    //    panel de Club ya la descartaba; esta copia del
                    //    SuperAdmin no, así que la pintaba otra vez —y como al
                    //    revocar no se conserva categoría útil, aterrizaba en
                    //    "Sin categoría" inflando el recuento del club.
                    const notRejected = r.status !== 'rejected' && u.status !== 'rejected';
                    const notRemoved  = r.status !== 'removed';
                    const matchClub = rCid === cidStr || (rCid === '' && String(u.clubId||'') === cidStr);
                    if (matchClub && notRejected && notRemoved) {
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
            // ══════════════════════════════════════════════════════════════
            //  🔑🔑🔑 v555 · ÉSTA ES LA BARRA QUE DECÍA "5 / 10 ENTRENADORES"
            //
            //  `vis.filter(...).length` cuenta USUARIOS: cada persona suma UNA
            //  por mucho que lleve dos equipos. En CD DÍA hay 5 usuarios y
            //  **7 plazas de entrenador** (dos de ellos llevan F7 + F11), así
            //  que la barra decía 5 mientras el club tenía 7 equipos.
            //
            //  ⚠️ EL ARREGLO DE v553 NO LLEGABA AQUÍ. Allí se conectó
            //  `saEditClubSlots` (la pantalla "Editar Club") y `slotOf` del
            //  panel del club, pero **la barra de la LISTA de clubes es otro
            //  render distinto** con su propio contador. Tercera copia del
            //  mismo recuento; por eso el número seguía sin moverse.
            //
            //  Ahora las tres consumen `cronosPlazasOcupadas` (utils.js): una
            //  sola definición de "plaza ocupada" para toda la aplicación.
            // ══════════════════════════════════════════════════════════════
            const countByRole = (role) => {
                if (typeof window !== 'undefined' && typeof window.cronosPlazasOcupadas === 'function') {
                    return window.cronosPlazasOcupadas(vis, role, c.id);
                }
                // Respaldo: el criterio anterior (personas), mejor que un cero.
                return vis.filter(u => {
                    if (u.role === role && u.status !== 'removed') return true;
                    return u.status !== 'removed' && (u.allRoles||[]).some(r => r.role === role && r.isAuthorized && r.clubId === c.id);
                }).length;
            };
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
                        <!-- v436 · Vaciado de temporada. Va con guarda typeof
                             porque season-reset.js es un módulo aparte: si no
                             se cargara, el botón avisa en vez de romper. -->
                        <button onclick="if(typeof saResetClubSeason==='function') saResetClubSeason('${c.id}','${typeof escapeAttr==='function'?escapeAttr(c.name||c.id):(c.name||c.id)}'); else alert('Módulo no disponible');"
                            title="Vaciar los datos de la temporada CONSERVANDO el club y sus usuarios"
                            style="padding:0.2rem 0.5rem;background:rgba(240,136,62,0.14);
                                   border:1px solid rgba(240,136,62,0.4);border-radius:5px;
                                   color:#f0883e;font-size:0.68rem;cursor:pointer;font-weight:700;">
                            🧹
                        </button>
                        <button onclick="saDeleteClubComplete('${c.id}','${typeof escapeAttr==='function'?escapeAttr(c.name||c.id):(c.name||c.id)}')"
                            title="Borrar club completo (el club DESAPARECE y sus usuarios quedan libres)"
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
                    ${(function(){const _ex=_expandClubUsers(vis,c.id);return _ex.length?window.renderCategoryTreeReadOnly(_ex,{mode:'club',conBorrado:true}):'<p style="margin:0;padding:0.6rem 0.9rem;color:#8b949e;font-size:0.8rem;">Sin usuarios asignados.</p>';})()}
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
// setupClubsSyncListener()
// ═══════════════════════════════════════════════════════════════════

window.setupClubsSyncListener = async function setupClubsSyncListener() {
    try {
        const { db, collection, onSnapshot, query, where } = await saFS();

        // ⏱️ v638 · LOS DOS OYENTES IBAN SIN MANEJADOR DE ERROR. Por eso una
        //    denegación salía como `Uncaught Error in snapshot listener` en la
        //    consola (captura 9668, dos veces) y el oyente se quedaba MUERTO:
        //    un `onSnapshot` que falla no se rearma solo, así que a partir de
        //    ahí el panel dejaba de enterarse de los cambios sin decir nada.
        //    Ahora, si la denegación es por el token, se refresca y se rearma
        //    UNA vez — con tope, para no entrar en bucle si de verdad no hay
        //    permiso.
        let _rearmado = false;
        const alFallar = (etiqueta, rearmar) => (err) => {
            const esPermisos = err && (err.code === 'permission-denied' ||
                                       (err.message || '').includes('permission'));
            if (esPermisos && !_rearmado) {
                _rearmado = true;
                console.warn('[' + etiqueta + '] Oyente denegado (token aún sin instalar). ' +
                             'Refrescando token y rearmando…');
                window._saEsperarToken(true).then(() => setupClubsSyncListener());
                return;
            }
            console.warn('[' + etiqueta + '] Oyente detenido:', (err && err.message) || err);
        };

        if (window._clubsSyncUnsubscribe) window._clubsSyncUnsubscribe();
        window._clubsSyncUnsubscribe = onSnapshot(collection(db,'users'), snap => {
            const panel = document.getElementById('sa-panel');
            if (!panel || panel.style.display==='none') return;
            if (snap.docChanges().some(c=>c.type==='removed'||c.type==='modified')) {
                clearTimeout(window._saRefreshTimeout);
                // Refresh the currently active tab, not always Clubs
                window._saRefreshTimeout = setTimeout(()=>{
                    // v641 · La sección activa es un DATO desde que se retiró la
                    // barra de pestañas (ver saTab en superadmin.panel.js).
                    // ⚠️ Y si el SuperAdmin está en el TABLERO, no se repinta
                    // nada de contenido: repintar Clubes encima del menú lo
                    // sacaría de donde está sin que él haya tocado nada.
                    const _sec = window._saSeccionActual;
                    if      (_sec === 'individuals') saIndividuals();
                    else if (_sec === 'clubs')       saClubs();
                }, 700);
            }
        }, alFallar('clubsSync'));

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

                // 🔔 v641 · EL AVISO VIVE EN LA TARJETA DEL TABLERO, no en una
                //  pestaña. Se guarda el número y, SÓLO si el SuperAdmin está
                //  mirando el tablero, se repinta para que la píldora roja
                //  cambie sola. Repintarlo estando dentro de una sección lo
                //  echaría de ella (la trampa que ya costó v598).
                window._saPendingCount = count;
                if (window._saSeccionActual === 'menu' && typeof window.saMenu === 'function') {
                    window.saMenu();
                }

                // 🔔 v644 · Y LA INSIGNIA DEL ICONO DE LA APP, con el MISMO
                //  número. Se pone aquí, y no sólo al recibir un push, porque
                //  éste es el único punto que también se entera cuando el
                //  SuperAdmin DESPACHA: sin esto la insignia sólo sabría
                //  subir, y un contador que no baja deja de mirarse a la
                //  tercera vez. (js/services/push-superadmin.js)
                if (typeof window.cronosPushInsignia === 'function') {
                    window.cronosPushInsignia(count);
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

                    // Si está en la sección Solicitudes, refrescar automáticamente
                    // (v641 · el dato, no el borde de un botón retirado)
                    if (window._saSeccionActual === 'requests') {
                        clearTimeout(window._saReqRefreshTimeout);
                        window._saReqRefreshTimeout = setTimeout(() => saRequests(), 500);
                    }
                }
            },
            alFallar('requestsSync')
        );
    } catch (e) { console.error('[setupClubsSyncListener]', e); }
};

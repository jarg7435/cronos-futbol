// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/individuals-tab.js
//  Pestaña "Individuales" — entes individuales, usuarios individuales y
//  huérfanos sin ente (saIndividuals, saActivateIndividual,
//  saAssignOrphanToEntity).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-25. Movimiento puramente
//  mecánico, sin cambios de lógica — depende de helpers ya definidos por
//  superadmin.panel.js (saFS, _saShowSpinner/_saHideSpinner/_saToast,
//  window.ROLE_META), que debe cargarse ANTES que este archivo. Llama a
//  funciones ya extraídas en individual-entity.js (saShowCreateIndividualEntity,
//  saEditIndividualEntity, saDeleteIndividualEntity,
//  saShowCreateIndividualForEntity, saShowEntityUsers) resueltas en
//  tiempo de click, sin dependencia de orden de carga.
//  saActivateIndividual no tiene ningún onclick que la invoque en todo
//  el repo (código huérfano ya en el origen) — se preserva tal cual.
//  Cubierto por scripts/test_sa_individuals_module.js.
// ════════════════════════════════════════════════════════════════════

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
                // ══════════════════════════════════════════════════════════
                //  🔴🔴🔴 v583 · ESTOS CONTADORES CRUZABAN CLUB Y ENTE
                //
                //  Reporte del autor: al crear un ente con un correo que ya
                //  tenía plaza en un club, salían DOS plazas — la de
                //  Administrador Individual (correcta) y una de **Entrenador
                //  Individual que él no había creado**.
                //
                //  🔑🔑🔑 No se creaba ningún rol: se CONTABA el de otro sitio.
                //  Cada rama de aquí preguntaba `allRoles.some(r => r.role ===
                //  'user' && r.isAuthorized)` **sin mirar a qué club o ente
                //  pertenecía esa entrada**. `brunoromar2012` entrena el
                //  Benjamín C de CD DÍA —está escrito en su propia entrada— y
                //  ese equipo se contaba como equipo del ente.
                //
                //  🔑 Ahora sólo cuentan las plazas ANCLADAS a este ente
                //  (`cronosRolDelEnte`, utils.js — una sola definición para el
                //  contador y para el árbol de "Ver usuarios", que tenía el
                //  mismo defecto).
                //
                //  ⚠️ La RAÍZ sólo manda si no hay ninguna plaza anclada, que
                //  es la regla de todo el proyecto para un campo de
                //  compatibilidad (v553/v564/v582). Y `entUsers` ya ha
                //  comprobado que esa raíz apunta a ESTE ente.
                // ══════════════════════════════════════════════════════════
                const _delEnte = (r) => (typeof window.cronosRolDelEnte === 'function')
                    ? window.cronosRolDelEnte(r, ent.id)
                    : !!r && (String(r.clubId||'') === String(ent.id) ||
                              String(r.individualEntityId||'') === String(ent.id) ||
                              String(r.individualOwnerId||'')  === String(ent.id));
                // Qué nombres de rol alimentan cada barra. 'individual' es como
                // auth.js llama al Administrador Individual.
                const _ROLES_DE_BARRA = {
                    admin_individual:      ['admin_individual', 'individual'],
                    individual:            ['admin_individual', 'individual'],
                    user:                  ['user', 'entrenador_individual'],
                    entrenador_individual: ['user', 'entrenador_individual'],
                    parent:                ['parent', 'parent_individual'],
                    parent_individual:     ['parent', 'parent_individual'],
                };
                const slotBar = (roleKey) => {
                    const meta = roleLabels[roleKey];
                    const acepta = _ROLES_DE_BARRA[roleKey] || [roleKey];
                    const used = entUsers.filter(u => {
                        if (u.status === 'removed') return false;
                        const roles = Array.isArray(u.allRoles) ? u.allRoles : [];
                        const anclados = roles.filter(_delEnte);
                        if (anclados.length) {
                            return anclados.some(r => acepta.indexOf(r.role) >= 0 && r.isAuthorized);
                        }
                        return acepta.indexOf(u.role) >= 0;
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
                        <!-- 🔴 v583 · LA SALIDA QUE NO EXISTÍA.
                             Reporte del autor (captura 9269): borró el ente y este
                             bloque se quedó con un residuo que NO SE PODÍA QUITAR.
                             La única acción era "Asignar a un ente" y el desplegable
                             estaba VACÍO, porque no queda ningún ente: un callejón
                             sin salida, con el fantasma fijo en pantalla.
                             "Desvincular" retira el vínculo individual muerto y
                             devuelve a la persona a lo que de verdad le queda. -->
                        <button onclick="saDesvincularHuerfanoIndividual('${eid}','${em}')" title="Retirar el vínculo individual huérfano (sus plazas de club NO se tocan)" style="padding:0.28rem 0.6rem;background:rgba(240,136,62,0.15);border:1px solid rgba(240,136,62,0.45);border-radius:6px;color:#f0883e;font-size:0.72rem;cursor:pointer;font-weight:700;">🔗 Desvincular</button>
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
// ═══════════════════════════════════════════════════════════════════
//  🔴🔴🔴 v583 · DESVINCULAR UN HUÉRFANO INDIVIDUAL
//
//  Reporte del autor (captura 9269): tras borrar el ente le quedó
//  "brunoromar2012@gmail.com · Administrador Individual · Activo · Sin ente"
//  y **ninguna forma de quitarlo**. La única acción del bloque era "Asignar a
//  un ente" con el desplegable VACÍO —no queda ningún ente—: un callejón sin
//  salida con el fantasma clavado en pantalla.
//
//  🔑 Qué hace, exactamente: retira el vínculo individual MUERTO y devuelve a
//  la persona a lo que de verdad le queda.
//    · Las entradas de `allRoles` con rol individual y sin ente vivo se
//      retiran. **Las plazas de club NO se tocan** — ni una.
//    · Las referencias de la raíz (`individualEntityId`, `individualOwnerId`,
//      `isIndividual`) se anulan.
//    · Si su `role` de raíz era individual y conserva una plaza de club, la
//      raíz pasa a describir ESA plaza: vuelve a ser lo que es.
//    · Si no le queda absolutamente nada, no se inventa un rol: se dice, y se
//      ofrece el borrado seguro de siempre (que archiva antes de borrar).
//
//  ⚠️ `role` y `clubId` sólo los puede escribir el SuperAdmin: están en la
//  lista que las reglas prohíben al propio usuario (firestore.rules). Esta
//  función vive en su panel, que es donde tiene que estar.
// ═══════════════════════════════════════════════════════════════════
window.saDesvincularHuerfanoIndividual = async function(uid, email) {
    if (!confirm('🔗 Desvincular a ' + email + ' del ente individual\n\n' +
                 'Se retira su vínculo individual (que ya no apunta a ningún ente).\n' +
                 'Sus plazas en clubes NO se tocan: si es entrenador de un club,\n' +
                 'sigue siéndolo exactamente igual.\n\n' +
                 '¿Continuar?')) return;

    _saShowSpinner('Desvinculando…');
    try {
        const { db, doc, getDoc, getDocs, collection, updateDoc } = await saFS();
        const uSnap = await getDoc(doc(db, 'users', uid));
        if (!uSnap.exists()) throw new Error('Usuario no encontrado');
        const u = uSnap.data() || {};

        // Qué entes existen HOY. Un vínculo sólo se respeta si su ente vive.
        const clubsSnap = await getDocs(collection(db, 'clubs'));
        const entesVivos = new Set();
        const clubesVivos = new Set();
        clubsSnap.forEach(d => {
            const c = d.data() || {};
            if (c.type === 'individual') entesVivos.add(d.id); else clubesVivos.add(d.id);
        });

        const ROLES_INDIV = window.CRONOS_ROLES_INDIVIDUALES ||
            ['individual', 'admin_individual', 'parent_individual',
             'entrenador_individual', 'padre_individual'];
        const roles = Array.isArray(u.allRoles) ? u.allRoles : [];

        // Se retira SÓLO lo individual sin ente vivo. Todo lo demás se queda.
        const limpios = roles.filter(r => {
            if (!r) return false;
            const ancla = String(r.individualEntityId || r.individualOwnerId || r.clubId || '');
            if (ROLES_INDIV.indexOf(r.role) >= 0) return entesVivos.has(ancla);
            return true;                                  // plaza de club: intacta
        });
        // Su plaza de club, si la tiene: es lo que la raíz debe describir.
        const plazaClub = limpios.find(r => r && r.clubId && clubesVivos.has(String(r.clubId)) &&
                                             ROLES_INDIV.indexOf(r.role) < 0);

        const upd = {};
        if (limpios.length !== roles.length) upd.allRoles = limpios;
        if (u.individualEntityId && !entesVivos.has(String(u.individualEntityId))) upd.individualEntityId = null;
        if (u.individualOwnerId  && !entesVivos.has(String(u.individualOwnerId)))  upd.individualOwnerId  = null;
        if (u.isIndividual === true) upd.isIndividual = null;
        if (ROLES_INDIV.indexOf(u.role) >= 0) {
            if (plazaClub) {
                upd.role = plazaClub.role;
                upd.clubId = plazaClub.clubId;
            } else {
                // No le queda NADA. No se inventa un rol: se dice.
                _saHideSpinner();
                alert('⚠️ ' + email + ' no conserva ninguna plaza en ningún club ni ente.\n\n' +
                      'No hay nada a lo que devolverlo, así que no se ha cambiado su rol.\n' +
                      'Si esta cuenta ya no debe existir, elimínala con el borrado seguro ' +
                      '(archiva su trabajo antes de borrar).');
                if (typeof window.cronosEliminarUsuarioSeguro === 'function' &&
                    confirm('¿Abrir ahora el borrado seguro de ' + email + '?')) {
                    await window.cronosEliminarUsuarioSeguro({
                        uid: uid, email: email, role: u.role || '', clubId: u.clubId || '',
                    });
                }
                if (typeof saIndividuals === 'function') saIndividuals();
                return;
            }
        }

        if (!Object.keys(upd).length) {
            _saHideSpinner();
            _saToast('ℹ️ No había nada que desvincular en ' + email + '.', 4000);
            return;
        }
        await updateDoc(doc(db, 'users', uid), upd);

        // Las solicitudes aprobadas que apuntan a un ente muerto se retiran:
        // si no, el arranque de sesión puede reconstruir el vínculo (auth.js,
        // "Auto-activar roles aprobados por el SA").
        try {
            const reqs = await getDocs(collection(db, 'platform_requests'));
            const ops = [];
            reqs.forEach(d => {
                const r = d.data() || {};
                if (String(r.userUid || '') !== String(uid)) return;
                if (ROLES_INDIV.indexOf(r.requestedRole) < 0) return;
                const ancla = String(r.individualOwnerId || r.individualEntityId || r.clubId || '');
                if (entesVivos.has(ancla)) return;        // su ente vive: se respeta
                if (r.status === 'entity_deleted') return;
                ops.push(updateDoc(doc(db, 'platform_requests', d.id), {
                    status: 'entity_deleted',
                    entityDeletedAt: new Date().toISOString(),
                    statusAnterior: r.status || null,
                }));
            });
            if (ops.length) await Promise.all(ops);
        } catch (eReq) {
            console.warn('[saDesvincularHuerfanoIndividual] solicitudes:', eReq && eReq.message);
        }

        _saHideSpinner();
        _saToast('✅ ' + email + ' desvinculado' +
                 (upd.role ? '. Vuelve a ser "' + upd.role + '" de su club.' : '.'), 5000);
        if (typeof saIndividuals === 'function') saIndividuals();
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 5000);
        console.error('[saDesvincularHuerfanoIndividual]', e);
    }
};

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

        // ══════════════════════════════════════════════════════════════════
        //  🔴🔴🔴 v583 · ESTO SE LLEVABA POR DELANTE LAS PLAZAS DE CLUB
        //
        //  El `map` reescribía `clubId: entityId` en **toda** entrada con rol
        //  'user' o 'parent', mirase a donde mirase. Para
        //  `brunoromar2012` —entrenador del Benjamín C de CD DÍA— asignarlo a
        //  un ente le habría ARRANCADO ese equipo del club para pegárselo al
        //  ente, de forma permanente y sin avisar. Es literalmente el cruce que
        //  el autor prohíbe: "los datos y roles de diferentes clubes o entes
        //  deben mantenerse totalmente independientes y aislados".
        //
        //  🔑 Sólo se reancla lo que NO pertenece ya a otro sitio: los roles
        //  individuales y las entradas sin club. Una plaza anclada a un club
        //  real NO SE TOCA NUNCA.
        //
        //  ⚠️ Y LA RAÍZ TAMPOCO SE MUEVE SI TIENE CLUB. El panel del club
        //  carga a su gente con `where('clubId','==',club)` sobre la RAÍZ
        //  (panel.js:234): llevársela al ente hace desaparecer a la persona del
        //  panel de su club — el mismo síntoma de v582. El ente no necesita la
        //  raíz para reconocer a los suyos: le basta `individualEntityId` /
        //  `individualOwnerId`, que es por donde los busca `entUsers`.
        // ══════════════════════════════════════════════════════════════════
        const _ROLES_INDIV = window.CRONOS_ROLES_INDIVIDUALES ||
            ['individual', 'admin_individual', 'parent_individual',
             'entrenador_individual', 'padre_individual'];
        const _anclaAOtroSitio = (r) => !!r && !!r.clubId &&
            String(r.clubId) !== String(entityId);
        const updAllRoles = (uData.allRoles || []).map(r => {
            if (_anclaAOtroSitio(r)) return r;          // plaza de un club: intacta
            if (r.role === 'individual' || r.role === 'admin_individual') {
                return { ...r, clubId: entityId, individualEntityId: entityId, isAuthorized: true, status: 'active' };
            }
            if (_ROLES_INDIV.indexOf(r.role) >= 0 || r.role === 'user' || r.role === 'parent') {
                return { ...r, clubId: entityId, individualEntityId: entityId };
            }
            return r;
        });

        // ¿Le queda alguna plaza en un club de verdad? Entonces la raíz se
        // queda donde está y el vínculo con el ente viaja por sus campos.
        const _plazaDeClub = (uData.allRoles || []).find(_anclaAOtroSitio);

        const updateData = {
            individualEntityId: entityId,
            individualOwnerId: entityId,
            allRoles: updAllRoles,
        };
        if (!_plazaDeClub) {
            updateData.clubId   = entityId;
            updateData.clubName = entName;
        }

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

// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/club-slots.js
//  Editar slots y plan de un club (SuperAdmin).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-24. Movimiento puramente
//  mecánico, sin cambios de lógica — depende de helpers ya definidos por
//  superadmin.panel.js (saFS, _saShowSpinner/_saHideSpinner/_saToast,
//  saTab), que debe cargarse ANTES que este archivo.
//  Cubierto por scripts/test_sa_club_slots_module.js.
// ════════════════════════════════════════════════════════════════════

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
                <h3 style="margin:0;font-size:1rem;">✏️ Editar Club: ${typeof escapeHtml==='function'?escapeHtml(clubName):clubName}</h3>
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

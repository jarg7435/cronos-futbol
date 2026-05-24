// ═══════════════════════════════════════════════════════════════════
//  26_sa_billing.js  —  Facturación por tipo de rol (SuperAdmin)
// ═══════════════════════════════════════════════════════════════════
(function () {
'use strict';

const ROLE_ROWS = [
    { id:'director',    label:'Directores Deportivos', icon:'📋', color:'#d2a8ff' },
    { id:'coordinator', label:'Coordinadores',          icon:'🎯', color:'#79c0ff' },
    { id:'user',        label:'Entrenadores',           icon:'⚽', color:'#3fb950' },
    { id:'parent',      label:'Padres / Madres / Tutores', icon:'👨‍👩‍👧', color:'#58a6ff' },
];
const IND_ROLE_ROWS = [
    { id:'user',   label:'Entrenadores',              icon:'⚽', color:'#3fb950' },
    { id:'parent', label:'Padres / Madres / Tutores', icon:'👨‍👩‍👧', color:'#58a6ff' },
];

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function eA(s)  { return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

// ── CSS ──────────────────────────────────────────────────────────
function injectCSS() {
    if (document.getElementById('billing-css')) return;
    const s = document.createElement('style');
    s.id = 'billing-css';
    s.textContent = `
    .bt{width:100%;border-collapse:collapse;font-size:0.8rem;}
    .bt th{padding:0.4rem 0.9rem;background:rgba(255,255,255,0.04);color:#8b949e;
           font-size:0.67rem;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;
           text-align:left;border-bottom:1px solid rgba(255,255,255,0.07);}
    .bt th.r{text-align:right;}
    .bt td{padding:0.48rem 0.9rem;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:middle;}
    .bt td.r{text-align:right;}
    .bt tfoot td{background:rgba(255,255,255,0.04);font-weight:700;
                 border-top:2px solid rgba(255,255,255,0.1)!important;}
    .fee-in{width:85px;padding:0.28rem 0.5rem;background:rgba(255,255,255,0.07);
            border:1px solid rgba(255,255,255,0.14);border-radius:5px;
            color:white;font-size:0.8rem;text-align:right;}
    .fee-in:focus{outline:none;border-color:#58a6ff;}
    .rtag{display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;
          padding:2px 8px;border-radius:4px;white-space:nowrap;}
    .bsec{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);
          border-radius:10px;margin-bottom:1rem;overflow:hidden;}
    .bsec-head{padding:0.75rem 1rem;background:rgba(255,255,255,0.04);
               display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;}
    .bsec-contact{padding:0.5rem 1rem;background:rgba(255,255,255,0.02);
                  border-bottom:1px solid rgba(255,255,255,0.05);
                  font-size:0.75rem;color:#8b949e;display:flex;gap:1.5rem;flex-wrap:wrap;}
    `;
    document.head.appendChild(s);
}

// ══════════════════════════════════════════════════════════════════
window.openBillingPanel = async function() {
    injectCSS();
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
    <div id="billing-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.9rem;">
        <div>
          <span style="font-size:0.95rem;font-weight:700;color:white;">💰 Facturación y Cuotas</span>
          <span style="display:block;font-size:0.71rem;color:#8b949e;margin-top:0.1rem;">
            Recuento por tipo · Cuota unitaria × nº usuarios = Total mensual</span>
        </div>
        <button onclick="exportBillingCSV()"
          style="padding:0.35rem 0.8rem;background:rgba(63,185,80,0.1);
                 border:1px solid rgba(63,185,80,0.35);border-radius:7px;
                 color:#3fb950;font-size:0.75rem;cursor:pointer;font-weight:600;">
          📥 Exportar CSV</button>
      </div>
      <div style="display:flex;gap:0.35rem;margin-bottom:1rem;
                  border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:0.55rem;">
        <button id="btab-clubs" onclick="billingTab('clubs')"
          style="padding:0.35rem 0.9rem;border-radius:7px;border:none;cursor:pointer;
                 font-size:0.79rem;font-weight:600;background:rgba(88,166,255,0.15);color:#58a6ff;">
          🏟️ Clubes</button>
        <button id="btab-individuals" onclick="billingTab('individuals')"
          style="padding:0.35rem 0.9rem;border-radius:7px;border:none;cursor:pointer;
                 font-size:0.79rem;font-weight:600;background:rgba(255,255,255,0.04);color:#8b949e;">
          👤 Individuales</button>
        <button id="btab-summary" onclick="billingTab('summary')"
          style="padding:0.35rem 0.9rem;border-radius:7px;border:none;cursor:pointer;
                 font-size:0.79rem;font-weight:600;background:rgba(255,255,255,0.04);color:#8b949e;">
          📊 Resumen</button>
      </div>
      <div id="billing-body">
        <div style="text-align:center;padding:2rem;color:#8b949e;">⏳ Cargando...</div>
      </div>
    </div>`;
    billingTab('clubs');
};

window.billingTab = async function(tab) {
    ['clubs','individuals','summary'].forEach(t => {
        const b = document.getElementById('btab-' + t);
        if (!b) return;
        b.style.background = t===tab ? 'rgba(88,166,255,0.15)' : 'rgba(255,255,255,0.04)';
        b.style.color      = t===tab ? '#58a6ff' : '#8b949e';
    });
    const body = document.getElementById('billing-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:2rem;color:#8b949e;">⏳ Cargando...</div>';
    if (tab==='clubs')       await renderClubs(body);
    if (tab==='individuals') await renderIndividuals(body);
    if (tab==='summary')     await renderSummary(body);
};

// ── Leer / guardar cuotas por rol ─────────────────────────────────
async function getRoleFees(entityId) {
    try {
        const { db, doc, getDoc } = await saFS();
        const snap = await getDoc(doc(db,'billing_config',entityId));
        return snap.exists() ? (snap.data().roleFees||{}) : {};
    } catch(_) { return {}; }
}

window.saveRoleFee = async function(entityId, roleId, val, recalcFnName) {
    try {
        const { db, doc, setDoc, getDoc } = await saFS();
        const snap = await getDoc(doc(db,'billing_config',entityId));
        const fees = snap.exists() ? (snap.data().roleFees||{}) : {};
        fees[roleId] = parseFloat(val)||0;
        await setDoc(doc(db,'billing_config',entityId),
            {roleFees:fees, updatedAt:new Date().toISOString()},{merge:true});
        window[recalcFnName] && window[recalcFnName]();
    } catch(e) { if(typeof showToast==='function') showToast('❌ '+e.message,3000); }
};

// ── Helper: construir sección de club ─────────────────────────────
function buildClubSection(club, members, fees) {
    const admin = members.find(u => u.role==='club_admin' || (u.allRoles||[]).some(r=>r.role==='club_admin'));
    const cid   = eA(club._id);
    const safId = club._id.replace(/[^a-zA-Z0-9]/g,'_');

    // Contar por rol — solo usuarios del club (no del sistema individual)
    const counts = {};
    ROLE_ROWS.forEach(row => {
        counts[row.id] = members.filter(u => {
            if (u.status === 'removed') return false;
            if (u.individualOwnerId) return false; // excluir sistema individual
            // Rol principal
            if (u.role === row.id && u.isAuthorized !== false) return true;
            // Rol en allRoles específico del club
            return (u.allRoles||[]).some(r =>
                r.role === row.id &&
                r.isAuthorized === true &&
                (r.clubId === club._id || r.clubId === null)
            );
        }).length;
    });

    let total = 0;
    ROLE_ROWS.forEach(r => { total += (parseFloat(fees[r.id])||0) * (counts[r.id]||0); });

    return `
    <div class="bsec">
      <div class="bsec-head">
        <div>
          <span style="font-weight:700;font-size:0.93rem;color:white;">🏟️ ${esc(club.name||club._id)}</span>
        </div>
        <span id="ch-${safId}" style="font-size:0.88rem;font-weight:800;color:#3fb950;">
          ${total.toFixed(2)}€/mes</span>
      </div>
      <div class="bsec-contact">
        <span>📧 Admin: <strong style="color:white;">${esc(admin?.email||admin?.displayName||club.adminEmail||'—')}</strong></span>
        <span>📞 ${esc(club.phone||admin?.phone||'Sin teléfono')}</span>
        <span>👥 Usuarios activos: <strong style="color:white;">${members.filter(u=>(u.isAuthorized===true||u.status==='active'||u.status==='authorized')&&u.status!=='removed').length}</strong></span>
      </div>
      <table class="bt">
        <thead>
          <tr>
            <th>Tipo de usuario</th>
            <th class="r">Nº confirmados</th>
            <th class="r">Cuota unitaria €/mes</th>
            <th class="r">Subtotal €/mes</th>
          </tr>
        </thead>
        <tbody>
          ${ROLE_ROWS.map(r => {
              const count  = counts[r.id] || 0;
              const fee    = parseFloat(fees[r.id]) || 0;
              const sub    = fee * count;
              const subId  = `cs-${safId}-${r.id}`;
              return `
              <tr>
                <td>
                  <span class="rtag"
                    style="background:${r.color}1a;border:1px solid ${r.color}33;color:${r.color};">
                    ${r.icon} ${esc(r.label)}
                  </span>
                </td>
                <td class="r" style="font-weight:700;color:white;">${count}</td>
                <td class="r">
                  <input class="fee-in" type="number" min="0" step="0.50"
                    value="${fee>0?fee:''}" placeholder="0.00"
                    onchange="saveRoleFee('${cid}','${r.id}',this.value,'recalc_${safId}')">
                </td>
                <td class="r" id="${subId}"
                  style="font-weight:600;color:${sub>0?'#3fb950':'#8b949e'};">
                  ${sub.toFixed(2)}€
                </td>
              </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="color:#8b949e;">Total mensual — ${esc(club.name||club._id)}</td>
            <td class="r" id="cf-${safId}" style="color:#3fb950;font-size:0.88rem;">${total.toFixed(2)}€</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

// ── Helper: construir sección de individual ───────────────────────
function buildIndSection(ind, subUsers, fees) {
    const iid   = eA(ind._id);
    const safId = ind._id.replace(/[^a-zA-Z0-9]/g,'_');

    const counts = {};
    IND_ROLE_ROWS.forEach(r => {
        counts[r.id] = subUsers.filter(u =>
            (u.role===r.id || u._billingRole===r.id) &&
            u.status !== 'removed' && u.status !== 'rejected'
        ).length;
    });

    let total = 0;
    IND_ROLE_ROWS.forEach(r => { total += (parseFloat(fees[r.id])||0) * (counts[r.id]||0); });
    // Sumar cuota del propio individual
    total += parseFloat(fees['individual'])||0;

    const indFee = parseFloat(fees['individual'])||0;

    return `
    <div class="bsec">
      <div class="bsec-head">
        <div>
          <span style="font-weight:700;font-size:0.93rem;color:white;">👤 ${esc(ind.displayName||((ind.firstName||'')+(ind.lastName?' '+ind.lastName:'')).trim()||ind.email||ind._id)}</span>
        </div>
        <span id="ih-${safId}" style="font-size:0.88rem;font-weight:800;color:#ffd700;">
          ${total.toFixed(2)}€/mes</span>
      </div>
      <div class="bsec-contact">
        <span>📧 <strong style="color:white;">${esc(ind.email||'—')}</strong></span>
        <span>📞 ${esc(ind.phone||'Sin teléfono')}</span>
        <span>👥 Sub-usuarios activos: <strong style="color:white;">${subUsers.filter(u=>(u.isAuthorized===true||u.status==='active'||u.status==='authorized')&&u.status!=='removed').length}</strong></span>
      </div>
      <table class="bt">
        <thead>
          <tr>
            <th>Tipo de usuario</th>
            <th class="r">Nº confirmados</th>
            <th class="r">Cuota unitaria €/mes</th>
            <th class="r">Subtotal €/mes</th>
          </tr>
        </thead>
        <tbody>
          <!-- Fila del propio usuario individual -->
          <tr>
            <td>
              <span class="rtag" style="background:#ffd7001a;border:1px solid #ffd70033;color:#ffd700;">
                👤 Usuario Individual (Admin)
              </span>
            </td>
            <td class="r" style="font-weight:700;color:white;">1</td>
            <td class="r">
              <input class="fee-in" type="number" min="0" step="0.50"
                value="${indFee>0?indFee:''}" placeholder="0.00"
                onchange="saveRoleFee('${iid}','individual',this.value,'recalc_ind_${safId}')">
            </td>
            <td class="r" id="is-${safId}-individual"
              style="font-weight:600;color:${indFee>0?'#ffd700':'#8b949e'};">
              ${indFee.toFixed(2)}€
            </td>
          </tr>
          <!-- Sub-usuarios por tipo -->
          ${IND_ROLE_ROWS.map(r => {
              const count = counts[r.id] || 0;
              const fee   = parseFloat(fees[r.id]) || 0;
              const sub   = fee * count;
              return `
              <tr>
                <td>
                  <span class="rtag"
                    style="background:${r.color}1a;border:1px solid ${r.color}33;color:${r.color};">
                    ${r.icon} ${esc(r.label)}
                  </span>
                </td>
                <td class="r" style="font-weight:700;color:white;">${count}</td>
                <td class="r">
                  <input class="fee-in" type="number" min="0" step="0.50"
                    value="${fee>0?fee:''}" placeholder="0.00"
                    onchange="saveRoleFee('${iid}','${r.id}',this.value,'recalc_ind_${safId}')">
                </td>
                <td class="r" id="is-${safId}-${r.id}"
                  style="font-weight:600;color:${sub>0?r.color:'#8b949e'};">
                  ${sub.toFixed(2)}€
                </td>
              </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="color:#8b949e;">Total mensual</td>
            <td class="r" id="if-${safId}" style="color:#ffd700;font-size:0.88rem;">${total.toFixed(2)}€</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
//  TAB CLUBES
// ══════════════════════════════════════════════════════════════════
async function renderClubs(body) {
    try {
        const { db, collection, getDocs, query, where } = await saFS();
        const cSnap = await getDocs(collection(db,'clubs'));
        const clubs=[]; cSnap.forEach(d=>clubs.push({_id:d.id,...d.data()}));
        clubs.sort((a,b)=>(a.name||'').localeCompare(b.name||''));

        if (!clubs.length) { body.innerHTML='<p style="text-align:center;padding:2rem;color:#8b949e;">No hay clubes.</p>'; return; }

        // Cargar TODOS los usuarios una sola vez
        const allUsersSnap = await getDocs(collection(db,'users'));
        const allUsers = [];
        allUsersSnap.forEach(d => allUsers.push({_id:d.id,...d.data()}));
        console.log('[Billing] Total usuarios en Firestore:', allUsers.length);
        let html=''; let grandTotal=0;
        for (const club of clubs) {
            // Filtrar miembros del club:
            // - Excluir usuarios del sistema individual (tienen individualOwnerId)
            // - Solo contar usuarios vinculados específicamente a este club
            const members = allUsers.filter(u => {
                if (u.role === 'superadmin') return false;
                if (u.status === 'removed' || u.status === 'rejected') return false;
                // Excluir sub-usuarios del sistema individual
                if (u.individualOwnerId) return false;
                // Opción 1: clubId en campo raíz
                if (u.clubId === club._id) return true;
                // Opción 2: en allRoles con clubId específico de este club
                if ((u.allRoles||[]).some(r =>
                    r.isAuthorized === true &&
                    r.clubId === club._id
                )) return true;
                // Opción 3: rol principal aprobado Y sin clubId en raíz (aprobado vía SA para este club)
                // Solo si el único club al que pertenece es este (evitar doble conteo)
                if (!u.individualOwnerId && !u.clubId &&
                    (u.allRoles||[]).some(r =>
                        r.isAuthorized === true &&
                        r.clubId === null &&
                        r.role !== 'individual'
                    )
                ) {
                    // Verificar que no pertenezca a otro club
                    const hasOtherClub = allUsers.some(c => c._id !== club._id && (u.clubId === c._id));
                    if (!hasOtherClub) return true;
                }
                return false;
            });
            const fees = await getRoleFees(club._id);
            ROLE_ROWS.forEach(r=>{
                const cnt = members.filter(u=>{
                    const role=u.allRoles?.find(ar=>ar.clubId===club._id)?.role||u.role;
                    return role===r.id && (u.isAuthorized===true||u.status==='active'||u.status==='authorized') && u.status!=='removed';
                }).length;
                grandTotal += (parseFloat(fees[r.id])||0) * cnt;
            });

            const safId = club._id.replace(/[^a-zA-Z0-9]/g,'_');
            // Register recalc function for this club
            window['recalc_'+safId] = async function() {
                const newFees = await getRoleFees(club._id);
                let tot=0;
                ROLE_ROWS.forEach(r=>{
                    const cnt=members.filter(u=>{
                        if(u.status==='removed'||u.individualOwnerId) return false;
                        if(u.role===r.id && u.isAuthorized!==false) return true;
                        return (u.allRoles||[]).some(ar=>ar.role===r.id&&ar.isAuthorized===true&&(ar.clubId===club._id||ar.clubId===null));
                    }).length;
                    const sub=(parseFloat(newFees[r.id])||0)*cnt;
                    tot+=sub;
                    const el=document.getElementById('cs-'+safId+'-'+r.id);
                    if(el){el.textContent=sub.toFixed(2)+'€';el.style.color=sub>0?'#3fb950':'#8b949e';}
                });
                const ft=document.getElementById('cf-'+safId);
                const ht=document.getElementById('ch-'+safId);
                if(ft) ft.textContent=tot.toFixed(2)+'€';
                if(ht) ht.textContent=tot.toFixed(2)+'€/mes';
                // Grand total
                let grand=0;
                document.querySelectorAll('[id^="cf-"]').forEach(e=>grand+=parseFloat(e.textContent)||0);
                const ge=document.getElementById('bill-grand-clubs');
                if(ge) ge.textContent=grand.toFixed(2)+' €';
            };
            html += buildClubSection(club, members, fees);
        }

        html += `
        <div style="background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.35);
                    border-radius:10px;padding:0.85rem 1.1rem;
                    display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.9rem;font-weight:700;color:white;">💰 Total facturación todos los clubes / mes</span>
          <span id="bill-grand-clubs" style="font-size:1.3rem;font-weight:900;color:#3fb950;">${grandTotal.toFixed(2)} €</span>
        </div>`;
        body.innerHTML = html;

    } catch(e) { body.innerHTML=`<p style="color:#ff5858;padding:1rem;">❌ ${esc(e.message)}</p>`; console.error(e); }
}

// ══════════════════════════════════════════════════════════════════
//  TAB INDIVIDUALES
// ══════════════════════════════════════════════════════════════════
async function renderIndividuals(body) {
    try {
        const { db, collection, getDocs, query, where } = await saFS();
        const uSnap = await getDocs(collection(db,'users'));
        const users=[]; uSnap.forEach(d=>users.push({_id:d.id,...d.data()}));

        // Deduplicar por EMAIL y preferir el documento con role==='individual'
        const indByEmail = {};
        users.forEach(u => {
            if (u.role==='individual' || (u.allRoles||[]).some(r=>r.role==='individual'&&r.isAuthorized===true)) {
                const email = (u.email||u._id).toLowerCase();
                const existing = indByEmail[email];
                // Preferir el doc cuyo role principal ES 'individual'
                if (!existing || u.role==='individual') {
                    indByEmail[email] = u;
                }
            }
        });
        const individuals = Object.values(indByEmail);
        console.log('[Billing] Individuales únicos:', individuals.length);
        if (!individuals.length) { body.innerHTML='<p style="text-align:center;padding:2rem;color:#8b949e;">No hay usuarios individuales registrados.</p>'; return; }

        let html=''; let grandTotal=0;
        for (const ind of individuals) {
            // 1. Sub-usuarios con documento propio
            // Matching robusto: buscar por individualOwnerId = UID del admin O = entity ID
            const _entityId = ind.individualEntityId || null;
            const queries = [where('individualOwnerId','==',ind._id)];
            if (_entityId && _entityId !== ind._id) queries.push(where('individualOwnerId','==',_entityId));
            const subSnaps = await Promise.all(queries.map(q => getDocs(query(collection(db,'users'), q)).catch(()=>({forEach:()=>{}}))));
            const subUsersMap = new Map();
            subSnaps.forEach(snap => { snap.forEach(d => { const u={_id:d.id,...d.data()}; if(u.status!=='removed'&&u.status!=='rejected') subUsersMap.set(d.id, u); }); });
            const subUsers = Array.from(subUsersMap.values());

            // 2. Roles propios del individual en allRoles (isSelf) — solo activos y únicos
            //    Verificar que no haya ya un doc separado para ese rol
            const selfExtraRoles = (ind.allRoles||[]).filter(r=>
                (r.role==='user'||r.role==='parent') &&
                r.isAuthorized===true &&
                r.status==='active' &&
                // Solo si NO existe ya un documento separado con ese rol
                !subUsers.some(u => u.role===r.role && u._id!==ind._id && u.status!=='removed')
            );
            // Deduplicar selfExtraRoles por role
            const seenRoles = new Set();
            const selfExtraRolesUniq = selfExtraRoles.filter(r => {
                if (seenRoles.has(r.role)) return false;
                seenRoles.add(r.role);
                return true;
            });
            selfExtraRolesUniq.forEach(r => {
                subUsers.push({
                    ...ind,
                    _id: ind._id + '_self_' + r.role,
                    _billingRole: r.role,
                    role: r.role,
                    category: r.category||null,
                    categoryLabel: r.categoryLabel||null,
                    status: 'active',
                    isAuthorized: true,
                });
            });
            // Deduplicar subUsers por role (evitar dobles)
            const subUsersDedup = [];
            const seenSubRoles = new Set();
            subUsers.forEach(u => {
                const roleKey = u._billingRole || u.role;
                if (!seenSubRoles.has(roleKey)) {
                    seenSubRoles.add(roleKey);
                    subUsersDedup.push(u);
                }
            });
            subUsers.length = 0;
            subUsersDedup.forEach(u => subUsers.push(u));
            console.log('[Billing] Individual:', ind.email, '| sub-usuarios finales:', subUsers.length);
            const fees = await getRoleFees(ind._id);
            const safId = ind._id.replace(/[^a-zA-Z0-9]/g,'_');
            let tot = parseFloat(fees['individual'])||0;
            IND_ROLE_ROWS.forEach(r=>{
                const cnt=subUsers.filter(u=>u.role===r.id&&(u.isAuthorized===true||u.status==='active'||u.status==='authorized')&&u.status!=='removed').length;
                tot += (parseFloat(fees[r.id])||0)*cnt;
            });
            grandTotal += tot;

            window['recalc_ind_'+safId] = async function() {
                const newFees = await getRoleFees(ind._id);
                let t = parseFloat(newFees['individual'])||0;
                const el0=document.getElementById('is-'+safId+'-individual');
                if(el0){el0.textContent=t.toFixed(2)+'€';el0.style.color=t>0?'#ffd700':'#8b949e';}
                IND_ROLE_ROWS.forEach(r=>{
                    const cnt=subUsers.filter(u=>u.role===r.id&&(u.isAuthorized===true||u.status==='active'||u.status==='authorized')&&u.status!=='removed').length;
                    const sub=(parseFloat(newFees[r.id])||0)*cnt;
                    t+=sub;
                    const el=document.getElementById('is-'+safId+'-'+r.id);
                    if(el){el.textContent=sub.toFixed(2)+'€';el.style.color=sub>0?r.color:'#8b949e';}
                });
                const ft=document.getElementById('if-'+safId);
                const ht=document.getElementById('ih-'+safId);
                if(ft) ft.textContent=t.toFixed(2)+'€';
                if(ht) ht.textContent=t.toFixed(2)+'€/mes';
                let grand=0;
                document.querySelectorAll('[id^="if-"]').forEach(e=>grand+=parseFloat(e.textContent)||0);
                const ge=document.getElementById('bill-grand-ind');
                if(ge) ge.textContent=grand.toFixed(2)+' €';
            };
            html += buildIndSection(ind, subUsers, fees);
        }

        html += `
        <div style="background:rgba(255,215,0,0.07);border:1px solid rgba(255,215,0,0.35);
                    border-radius:10px;padding:0.85rem 1.1rem;
                    display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.9rem;font-weight:700;color:white;">💰 Total facturación todos los individuales / mes</span>
          <span id="bill-grand-ind" style="font-size:1.3rem;font-weight:900;color:#ffd700;">${grandTotal.toFixed(2)} €</span>
        </div>`;
        body.innerHTML = html;

    } catch(e) { body.innerHTML=`<p style="color:#ff5858;padding:1rem;">❌ ${esc(e.message)}</p>`; console.error(e); }
}

// ══════════════════════════════════════════════════════════════════
//  TAB RESUMEN
// ══════════════════════════════════════════════════════════════════
async function renderSummary(body) {
    try {
        const { db, collection, getDocs } = await saFS();
        const [cSnap, uSnap] = await Promise.all([
            getDocs(collection(db,'clubs')),
            getDocs(collection(db,'users')),
        ]);
        const clubs=[]; cSnap.forEach(d=>clubs.push({_id:d.id,...d.data()}));
        const users=[]; uSnap.forEach(d=>users.push({_id:d.id,...d.data()}));

        const individuals = users.filter(u=>u.role==='individual'||(u.allRoles||[]).some(r=>r.role==='individual'&&r.isAuthorized));
        let clubsTotal=0, indsTotal=0;

        // Calcular totales de clubes
        const clubSummary = [];
        for (const club of clubs) {
            const fees=await getRoleFees(club._id);
            const mSnap2=await getDocs(query(collection(db,'users'),where('clubId','==',club._id)));
            const members=[]; mSnap2.forEach(d=>{const u={_id:d.id,...d.data()};if(u.role!=='superadmin')members.push(u);});
            let tot=0;
            const rows=ROLE_ROWS.map(r=>{
                const cnt=members.filter(u=>{
                    const role=u.allRoles?.find(ar=>ar.clubId===club._id)?.role||u.role;
                    return role===r.id&&(u.isAuthorized===true||u.status==='active'||u.status==='authorized')&&u.status!=='removed'&&u.status!=='rejected';
                }).length;
                const sub=(parseFloat(fees[r.id])||0)*cnt;
                tot+=sub;
                return {r,cnt,sub};
            });
            clubsTotal+=tot;
            const admin=members.find(u=>u.role==='club_admin'||(u.allRoles||[]).some(r=>r.role==='club_admin'));
            clubSummary.push({club,rows,tot,admin});
        }

        // Calcular totales de individuales
        const indSummary = [];
        for (const ind of individuals) {
            const fees=await getRoleFees(ind._id);
            // Matching robusto: buscar por individualOwnerId = UID del admin O = entity ID
            const _eId = ind.individualEntityId || null;
            const subs=users.filter(u=>{
                if(u.status==='removed') return false;
                return u.individualOwnerId===ind._id || (_eId && u.individualOwnerId===_eId);
            });
            let tot=parseFloat(fees['individual'])||0;
            const rows=IND_ROLE_ROWS.map(r=>{
                const cnt=subs.filter(u=>u.role===r.id&&(u.isAuthorized===true||u.status==='active'||u.status==='authorized')&&u.status!=='removed').length;
                const sub=(parseFloat(fees[r.id])||0)*cnt;
                tot+=sub;
                return {r,cnt,sub};
            });
            indsTotal+=tot;
            indSummary.push({ind,rows,tot,subs});
        }

        const grandTotal=clubsTotal+indsTotal;

        body.innerHTML = `
        <!-- Tarjetas resumen -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:0.65rem;margin-bottom:1.1rem;">
          ${[
            {icon:'🏟️',label:'Clubes',val:clubs.length,col:'#58a6ff'},
            {icon:'👤',label:'Individuales',val:individuals.length,col:'#ffd700'},
            {icon:'👥',label:'Usuarios activos',val:users.filter(u=>u.status==='active'&&u.role!=='superadmin').length,col:'#3fb950'},
            {icon:'💳',label:'Facturación clubes',val:clubsTotal.toFixed(2)+'€/mes',col:'#3fb950'},
            {icon:'💳',label:'Fact. individuales',val:indsTotal.toFixed(2)+'€/mes',col:'#ffd700'},
          ].map(c=>`
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
                      border-radius:10px;padding:0.85rem;text-align:center;">
            <div style="font-size:1.25rem;">${c.icon}</div>
            <div style="font-size:1.05rem;font-weight:800;color:${c.col};margin:0.2rem 0;">${c.val}</div>
            <div style="font-size:0.67rem;color:#8b949e;">${c.label}</div>
          </div>`).join('')}
        </div>

        <!-- Detalle clubes -->
        <div class="bsec" style="margin-bottom:1rem;">
          <div class="bsec-head">
            <span style="font-weight:700;font-size:0.85rem;color:white;">🏟️ Desglose por club</span>
            <span style="font-size:0.82rem;font-weight:700;color:#3fb950;">${clubsTotal.toFixed(2)}€/mes</span>
          </div>
          <table class="bt">
            <thead><tr><th>Club</th><th>Contacto admin</th><th class="r">Usuarios</th><th class="r">€/mes</th></tr></thead>
            <tbody>
              ${clubSummary.map(({club,tot,admin})=>`
              <tr>
                <td style="font-weight:600;color:white;">${esc(club.name||club._id)}</td>
                <td style="color:#8b949e;font-size:0.73rem;">${esc(admin?.email||club.adminEmail||'—')}</td>
                <td class="r" style="color:white;">${users.filter(u=>(u.clubId===club._id||(u.allRoles||[]).some(r=>r.clubId===club._id))&&(u.isAuthorized===true||u.status==='active')&&u.status!=='removed').length}</td>
                <td class="r" style="font-weight:700;color:#3fb950;">${tot.toFixed(2)}€</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <!-- Detalle individuales -->
        ${indSummary.length?`
        <div class="bsec" style="margin-bottom:1rem;">
          <div class="bsec-head">
            <span style="font-weight:700;font-size:0.85rem;color:white;">👤 Desglose por usuario individual</span>
            <span style="font-size:0.82rem;font-weight:700;color:#ffd700;">${indsTotal.toFixed(2)}€/mes</span>
          </div>
          <table class="bt">
            <thead><tr><th>Usuario Individual</th><th>Email</th><th class="r">Sub-usuarios</th><th class="r">€/mes</th></tr></thead>
            <tbody>
              ${indSummary.map(({ind,tot,subs})=>`
              <tr>
                <td style="font-weight:600;color:white;">${esc(ind.displayName||ind.firstName||ind.email||'—')}</td>
                <td style="color:#8b949e;font-size:0.73rem;">${esc(ind.email||'—')}</td>
                <td class="r" style="color:white;">${subs.filter(u=>(u.isAuthorized===true||u.status==='active'||u.status==='authorized')&&u.status!=='removed').length}</td>
                <td class="r" style="font-weight:700;color:#ffd700;">${tot.toFixed(2)}€</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`:''}

        <!-- Grand total -->
        <div style="background:linear-gradient(135deg,rgba(63,185,80,0.09),rgba(88,166,255,0.09));
                    border:1px solid rgba(63,185,80,0.4);border-radius:12px;
                    padding:1.1rem 1.2rem;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:0.95rem;font-weight:700;color:white;">💰 TOTAL FACTURACIÓN MENSUAL</div>
            <div style="font-size:0.7rem;color:#8b949e;margin-top:0.1rem;">Clubes + Usuarios individuales</div>
          </div>
          <div style="font-size:1.8rem;font-weight:900;color:#3fb950;">${grandTotal.toFixed(2)} €</div>
        </div>`;

    } catch(e) { body.innerHTML=`<p style="color:#ff5858;padding:1rem;">❌ ${esc(e.message)}</p>`; console.error(e); }
}

// ── Exportar CSV ──────────────────────────────────────────────────
window.exportBillingCSV = async function() {
    try {
        const { db, collection, getDocs } = await saFS();
        const [cSnap, uSnap] = await Promise.all([getDocs(collection(db,'clubs')),getDocs(collection(db,'users'))]);
        const clubs=[]; cSnap.forEach(d=>clubs.push({_id:d.id,...d.data()}));
        const users=[]; uSnap.forEach(d=>users.push({_id:d.id,...d.data()}));
        const rows=[['Tipo','Entidad','Admin/Contacto','Tipo usuario','Nº usuarios','Cuota unitaria€','Subtotal€']];
        for (const club of clubs) {
            const fees=await getRoleFees(club._id);
            const mSnap2=await getDocs(query(collection(db,'users'),where('clubId','==',club._id)));
            const members=[]; mSnap2.forEach(d=>{const u={_id:d.id,...d.data()};if(u.role!=='superadmin')members.push(u);});
            const admin=members.find(u=>u.role==='club_admin');
            ROLE_ROWS.forEach(r=>{
                const cnt=members.filter(u=>{const role=u.allRoles?.find(ar=>ar.clubId===club._id)?.role||u.role;return role===r.id&&(u.isAuthorized===true||u.status==='active'||u.status==='authorized')&&u.status!=='removed'&&u.status!=='rejected';}).length;
                const fee=parseFloat(fees[r.id])||0;
                rows.push(['CLUB',club.name||club._id,admin?.email||club.adminEmail||'',r.label,cnt,fee,(fee*cnt).toFixed(2)]);
            });
        }
        const inds=users.filter(u=>u.role==='individual'||(u.allRoles||[]).some(r=>r.role==='individual'&&r.isAuthorized));
        for (const ind of inds) {
            const fees=await getRoleFees(ind._id);
            const subs=users.filter(u=>u.individualOwnerId===ind._id&&u.status!=='removed');
            const iF=parseFloat(fees['individual'])||0;
            rows.push(['INDIVIDUAL',ind.email||ind._id,ind.email||'','Usuario Individual',1,iF,iF.toFixed(2)]);
            IND_ROLE_ROWS.forEach(r=>{
                const cnt=subs.filter(u=>u.role===r.id&&(u.isAuthorized===true||u.status==='active'||u.status==='authorized')&&u.status!=='removed').length;
                const fee=parseFloat(fees[r.id])||0;
                rows.push(['INDIVIDUAL',ind.email||ind._id,ind.email||'',r.label,cnt,fee,(fee*cnt).toFixed(2)]);
            });
        }
        const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
        const a=document.createElement('a');
        a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
        a.download='cronos_facturacion_'+new Date().toISOString().slice(0,10)+'.csv';
        a.click();
        if(typeof showToast==='function') showToast('✅ CSV exportado',2000);
    } catch(e){ if(typeof showToast==='function') showToast('❌ '+e.message,3000); }
};

})();

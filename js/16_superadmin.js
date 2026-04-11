// ══════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Panel SuperAdmin v3

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ✏️  DATOS DEL SUPERADMINISTRADOR — Rellenar antes de publicar
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SA_CONFIG = {
    nombre:      'José · Cronos Fútbol',
    bizum:       '612 345 678',
    iban:        'ES12 3456 7890 1234 5678 9012',
    whatsapp:    '34612345678',
    email:       'jarg7435@gmail.com',
    appUrl:      'https://jarg7435.github.io/cronos-futbol/',
};
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tarjetas expandibles · Notificaciones · Usuarios individuales
// ══════════════════════════════════════════════════════════════════

const LIVE_ROLES  = ['superadmin','admin','club_admin','director','coordinator'];
const ROLE_META   = {
    superadmin:  { label:'👑 SuperAdmin',    color:'#ffd700' },
    admin:       { label:'👑 SuperAdmin',    color:'#ffd700' },
    club_admin:  { label:'🏟️ Admin Club',   color:'#58a6ff' },
    director:    { label:'📋 Director Dep.', color:'#f0883e' },
    coordinator: { label:'🎯 Coordinador',  color:'#d2a8ff' },
    user:        { label:'⚽ Entrenador',   color:'#3fb950' },
    individual:  { label:'👤 Individual',   color:'#79c0ff' },
    parent:      { label:'👨‍👩‍👧 Padre/Madre', color:'#d2a8ff' },
};
const PLAN_META   = {
    free:     { label:'🆓 Gratis',   color:'#7d8590' },
    trial:    { label:'⏳ Prueba',   color:'#f0883e' },
    basic:    { label:'📦 Básico',   color:'#58a6ff' },
    pro:      { label:'🚀 Pro',      color:'#3fb950' },
    premium:  { label:'💎 Premium',  color:'#ffd700' },
    custom:   { label:'⚙️ Custom',   color:'#d2a8ff' },
    monthly:  { label:'📅 Mensual',  color:'#58a6ff' },
    annual:   { label:'📆 Anual',    color:'#3fb950' },
};
const STATUS_META = {
    active:   { label:'✅ Activo',    color:'#3fb950' },
    trial:    { label:'⏳ Prueba',    color:'#f0883e' },
    overdue:  { label:'⚠️ Vencido',  color:'#ffa500' },
    blocked:  { label:'🔒 Bloqueado', color:'#ff5858' },
};

// ── Estilos del panel ────────────────────────────────────────────────
const SA_CSS = `
<style id="sa-styles">
.sa-modal{width:1060px;max-width:99vw;max-height:96vh;overflow:hidden;
  display:flex;flex-direction:column;padding:0;}
.sa-topbar{display:flex;justify-content:space-between;align-items:center;
  padding:1rem 1.4rem;border-bottom:1px solid var(--glass-border);flex-shrink:0;}
.sa-tabs{display:flex;gap:0.3rem;padding:0.6rem 1.4rem;
  border-bottom:1px solid var(--glass-border);flex-shrink:0;flex-wrap:wrap;}
.sa-tab{padding:0.42rem 1rem;background:var(--glass);border:1px solid var(--glass-border);
  border-radius:8px;color:var(--text-muted);font-size:0.82rem;cursor:pointer;
  transition:all 0.15s;}
.sa-tab:hover{border-color:rgba(88,166,255,0.4);color:var(--primary);}
.sa-tab.active{background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.5);
  color:var(--primary);font-weight:700;}
.sa-body{flex:1;overflow-y:auto;padding:1.2rem 1.4rem;}
.sa-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));
  gap:0.6rem;margin-bottom:1.4rem;}
.sa-stat{background:var(--glass);border:1px solid var(--glass-border);
  border-radius:10px;padding:0.8rem 1rem;text-align:center;}
.sa-stat-n{font-size:1.8rem;font-weight:700;line-height:1;}
.sa-stat-l{font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;}

/* ─ Tarjeta expandible ─ */
.sa-card{background:var(--glass);border:1px solid var(--glass-border);
  border-radius:11px;margin-bottom:0.65rem;overflow:hidden;transition:border-color 0.2s;}
.sa-card:hover{border-color:rgba(88,166,255,0.35);}
.sa-card.blocked{border-color:rgba(255,88,88,0.4);background:rgba(255,88,88,0.03);}
.sa-card.overdue{border-color:rgba(255,165,0,0.45);}
.sa-card.expanded{border-color:rgba(88,166,255,0.45);}
.sa-card-head{display:flex;justify-content:space-between;align-items:center;
  padding:0.85rem 1.1rem;cursor:pointer;user-select:none;flex-wrap:wrap;gap:0.4rem;}
.sa-card-head:hover{background:rgba(255,255,255,0.02);}
.sa-card-title{font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:0.5rem;}
.sa-card-meta{display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;}
.sa-card-body{display:none;padding:0 1.1rem 1rem;border-top:1px solid var(--glass-border);}
.sa-card.expanded .sa-card-body{display:block;}
.sa-chevron{font-size:0.75rem;transition:transform 0.2s;color:var(--text-muted);}
.sa-card.expanded .sa-chevron{transform:rotate(180deg);}

/* ─ Badge ─ */
.sa-badge{display:inline-block;padding:0.14rem 0.55rem;border-radius:4px;
  font-size:0.7rem;font-weight:700;white-space:nowrap;}

/* ─ User row inside card ─ */
.sa-urow{display:flex;justify-content:space-between;align-items:center;
  padding:0.45rem 0.5rem;border-radius:7px;margin-bottom:0.3rem;
  background:rgba(255,255,255,0.03);}
.sa-urow:hover{background:rgba(255,255,255,0.06);}

/* ─ Botones ─ */
.sa-btn{padding:0.3rem 0.7rem;border-radius:6px;font-size:0.76rem;
  cursor:pointer;border:1px solid;font-weight:600;white-space:nowrap;}

/* ─ Input / Select ─ */
.sa-input{width:100%;padding:0.45rem 0.65rem;background:rgba(255,255,255,0.06);
  border:1px solid var(--glass-border);border-radius:7px;
  color:var(--text);font-size:0.85rem;}
.sa-label{font-size:0.73rem;color:var(--text-muted);margin-bottom:0.22rem;display:block;}

/* ─ Grid ─ */
.sa-g2{display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;}
.sa-g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.7rem;}
.sa-g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0.7rem;}

/* ─ Notificación banner ─ */
.sa-notif{padding:0.65rem 1rem;border-radius:8px;font-size:0.82rem;
  margin-bottom:0.5rem;display:flex;align-items:center;gap:0.6rem;}

/* ─ Slot bar ─ */
.sa-slotbar{height:5px;background:rgba(255,255,255,0.08);
  border-radius:3px;overflow:hidden;margin-top:0.2rem;}
.sa-slotfill{height:100%;border-radius:3px;transition:width 0.3s;}

/* ─ Flag toggle ─ */
.sa-flag{display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.65rem;
  background:var(--glass);border:1px solid var(--glass-border);
  border-radius:6px;cursor:pointer;font-size:0.82rem;transition:all 0.15s;}
.sa-flag.on{border-color:rgba(63,185,80,0.5);background:rgba(63,185,80,0.08);}
.sa-flag.off{opacity:0.5;}

/* ─ Tabla de pagos ─ */
.sa-table{width:100%;border-collapse:collapse;font-size:0.82rem;}
.sa-table th{text-align:left;padding:0.5rem 0.7rem;color:var(--text-muted);
  border-bottom:1px solid var(--glass-border);font-weight:600;}
.sa-table td{padding:0.5rem 0.7rem;border-bottom:1px solid rgba(255,255,255,0.04);}
.sa-table tr:hover td{background:rgba(255,255,255,0.02);}

/* ─ Scrollbar ─ */
.sa-body::-webkit-scrollbar{width:5px;}
.sa-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}
</style>`;

// ── Entrada al panel ─────────────────────────────────────────────────
function openAdminPanel() {
    const me = window._cronosCurrentUser;
    const role = me?._activeRole || me?.role;
    
    if (['superadmin','admin'].includes(role)) openSuperAdminPanel();
    else if (role === 'club_admin')            openClubAdminPanel();
    else showToast('⛔ Sin permisos de administración', 3000);
}
window.openAdminPanel = openAdminPanel;

// ════════════════════════════════════════════════════════════════════
//  SUPERADMIN PANEL
// ════════════════════════════════════════════════════════════════════
async function openSuperAdminPanel() {
    const user = window._cronosCurrentUser;
    if (!user || user.email !== 'jarg7435@gmail.com') {
        alert('Acceso restringido: Solo el creador de la aplicación puede acceder aquí.');
        return;
    }

    // Use dedicated superadmin modal (independent of setup-modal)
    let modal = document.getElementById('sa-root-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sa-root-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);'  +
            'display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem;';
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    modal.innerHTML = SA_CSS + `
    <div class="modal-content sa-modal">
      <div class="sa-topbar">
        <div>
          <div style="font-size:1.2rem;font-weight:700;">⚙️ SuperAdmin · Cronos Fútbol</div>
          <div id="sa-subtitle" style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">
            Cargando…</div>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <button onclick="openSuperAdminPanel()"
            style="padding:0.3rem 0.7rem;background:rgba(88,166,255,0.1);
                   border:1px solid rgba(88,166,255,0.3);border-radius:6px;
                   color:var(--primary);font-size:0.78rem;cursor:pointer;">🔄 Actualizar</button>
          <button onclick="document.getElementById('sa-root-modal').style.display='none'; if(typeof showRoleSelector==='function') showRoleSelector();"
            style="padding:0.3rem 0.7rem;background:rgba(255,215,0,0.08);
                   border:1px solid rgba(255,215,0,0.3);border-radius:6px;
                   color:#ffd700;font-size:0.78rem;cursor:pointer;"
            title="Cambiar rol">⇄ Cambiar Rol</button>
          <button onclick="logoutUser()"
            style="padding:0.3rem 0.9rem;background:rgba(255,88,88,0.15);
                   border:1px solid rgba(255,88,88,0.4);border-radius:6px;
                   color:#ff5858;font-size:0.78rem;font-weight:700;cursor:pointer;
                   display:flex;align-items:center;gap:0.4rem;">
            🚪 SALIR
          </button>
        </div>
      </div>
      <div class="sa-tabs">
        <button class="sa-tab active" onclick="saTab('overview')">📊 Resumen</button>
        <button class="sa-tab" onclick="saTab('clubs')">🏟️ Clubes</button>
        <button class="sa-tab" onclick="saTab('individual')">👤 Individuales</button>
        <button class="sa-tab" onclick="saTab('payments')">💳 Pagos</button>
        <button class="sa-tab" onclick="saTab('requests')">📋 Solicitudes</button>
        <button class="sa-tab" onclick="saTab('pending')">🔔 Pendientes</button>
        <button class="sa-tab" onclick="saTab('tarifas')">💰 Tarifas</button>
        <button class="sa-tab" onclick="saTab('newclub')">➕ Nuevo Club</button>
      </div>
      <div class="sa-body" id="sa-body">
        <p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando…</p>
      </div>
    </div>`;

    window.saTab = (tab) => {
        document.querySelectorAll('.sa-tab').forEach(b => b.classList.remove('active'));
        const idx = ['overview','clubs','individual','payments','requests','pending','tarifas','newclub'].indexOf(tab);
        document.querySelectorAll('.sa-tab')[idx]?.classList.add('active');
        document.getElementById('sa-body').innerHTML =
            '<p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando…</p>';
        ({overview:saOverview, clubs:saClubs, individual:saIndividual,
          payments:saPayments, requests:saRequests, pending:saPending, tarifas:saTariffs, newclub:saNewClub})[tab]?.();
    };
    saOverview();
}
window.openSuperAdminPanel = openSuperAdminPanel;

// ── Helpers Firestore ────────────────────────────────────────────────
async function saFS() {
    const fa = window._cronos_auth;
    const m  = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { fa, db: fa.db, ...m };
}
async function saGetAll(col) {
    const { db, collection, getDocs } = await saFS();
    const snap = await getDocs(collection(db, col));
    const docs = [];
    snap.forEach(d => docs.push({ _id: d.id, ...d.data() }));
    return docs;
}
async function saWrite(col, id, data, merge=true) {
    const { db, doc, setDoc } = await saFS();
    await setDoc(doc(db, col, id), data, merge ? { merge:true } : {});
}
async function saUpd(col, id, data) {
    const { db, doc, updateDoc } = await saFS();
    await updateDoc(doc(db, col, id), data);
}
async function saGet(col, id) {
    const { db, doc, getDoc } = await saFS();
    const s = await getDoc(doc(db, col, id));
    return s.exists() ? { _id: s.id, ...s.data() } : null;
}

// ── HELPERS DE RENDER ────────────────────────────────────────────────
function saBadge(text, color) {
    return `<span class="sa-badge" style="background:${color}22;color:${color};">${text}</span>`;
}
function saSlotBar(used, max) {
    if (max === -1 || max === undefined)
        return `<span style="font-size:0.7rem;color:#3fb950;">∞</span>`;
    const pct = Math.min(100, Math.round(used / max * 100));
    const col = pct >= 90 ? '#ff5858' : pct >= 70 ? '#ffa500' : '#3fb950';
    return `<span style="font-size:0.73rem;">${used}/${max}</span>
        <div class="sa-slotbar" style="width:60px;display:inline-block;vertical-align:middle;margin-left:4px;">
            <div class="sa-slotfill" style="width:${pct}%;background:${col};"></div></div>`;
}
function saExpireLabel(expiresAt) {
    if (!expiresAt) return '';
    const d    = new Date(expiresAt);
    const days = Math.ceil((d - new Date()) / 86400000);
    const str  = d.toLocaleDateString('es-ES');
    if (days < 0)  return `<span style="color:#ff5858;font-size:0.72rem;">⚠️ Vencido ${str}</span>`;
    if (days <= 7) return `<span style="color:#ffa500;font-size:0.72rem;">⏳ Vence en ${days}d (${str})</span>`;
    return `<span style="color:var(--text-muted);font-size:0.72rem;">⏳ ${str}</span>`;
}

// ════════════════════════════════════════════════════════════════════
//  TAB: RESUMEN
// ════════════════════════════════════════════════════════════════════
async function saOverview() {
    const [clubs, users, reqs] = await Promise.all([
        saGetAll('clubs'), saGetAll('users'), saGetAll('deletion_requests')
    ]);

    const totalClubs   = clubs.length;
    const activeClubs  = clubs.filter(c => c.status !== 'blocked').length;
    const totalUsers   = users.filter(u => !['superadmin','admin'].includes(u.role)).length;
    const indivUsers   = users.filter(u => u.role === 'individual').length;
    
    // Solicitudes de nuevos clubes (usuarios con requestedRole='club_admin' no autorizados)
    const clubReqs   = users.filter(u => u.requestedRole === 'club_admin' && !u.isAuthorized).length;
    const pendReqs   = reqs.filter(r => r.status === 'pending').length;
    const pendUsers  = users.filter(u => !u.isAuthorized && !['superadmin','admin'].includes(u.role) &&
                          u.requestedRole !== 'club_admin' && u.requestedRole !== 'individual' &&
                          u.status !== 'rejected' && u.status !== 'removed').length;

    // Notifications
    const now = new Date();
    const alerts = [];
    
    if (clubReqs > 0)
        alerts.push({ type:'info', msg:`🏟️ ${clubReqs} solicitud${clubReqs>1?'es':''} de nuevo club pendiente${clubReqs>1?'s':''}` });
    if (pendUsers > 0)
        alerts.push({ type:'warn', msg:`🔔 ${pendUsers} usuario${pendUsers>1?'s':''} pendiente${pendUsers>1?'s':''} de activación` });

    clubs.forEach(c => {
        if (!c.expiresAt) return;
        const d = new Date(c.expiresAt);
        const days = Math.ceil((d - now) / 86400000);
        if (days < 0 && c.status !== 'blocked')
            alerts.push({ type:'danger', msg:`🔴 <strong>${c.name}</strong> — pago vencido hace ${Math.abs(days)} días` });
        else if (days <= 7 && days >= 0)
            alerts.push({ type:'warn', msg:`🟡 <strong>${c.name}</strong> — vence en ${days} día${days!==1?'s':''}` });
    });
    if (pendReqs > 0)
        alerts.push({ type:'info', msg:`📋 ${pendReqs} solicitud${pendReqs>1?'es':''} de baja pendiente${pendReqs>1?'s':''}` });

    // Update subtitle
    const sub = document.getElementById('sa-subtitle');
    if (sub) sub.textContent = `${totalClubs} clubes · ${totalUsers} usuarios · ${pendReqs} pendientes`;

    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <!-- Alertas -->
        ${alerts.length ? alerts.map(a => `
            <div class="sa-notif" style="background:${a.type==='danger'?'rgba(255,88,88,0.1)':a.type==='warn'?'rgba(255,165,0,0.1)':'rgba(88,166,255,0.1)'};
                border:1px solid ${a.type==='danger'?'rgba(255,88,88,0.35)':a.type==='warn'?'rgba(255,165,0,0.35)':'rgba(88,166,255,0.3)'};">
                ${a.msg}
            </div>`).join('') : `
            <div class="sa-notif" style="background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.3);">
                ✅ Todo en orden — sin alertas activas</div>`}

        <!-- Stats -->
        <div class="sa-stats">
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:#58a6ff;">${totalClubs}</div>
                <div class="sa-stat-l">🏟️ Clubes</div>
            </div>
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:#3fb950;">${activeClubs}</div>
                <div class="sa-stat-l">✅ Activos</div>
            </div>
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:#f0883e;">${totalUsers}</div>
                <div class="sa-stat-l">👥 Usuarios</div>
            </div>
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:#79c0ff;">${indivUsers}</div>
                <div class="sa-stat-l">👤 Individuales</div>
            </div>
            <div class="sa-stat">
                <div class="sa-stat-n" style="color:${pendReqs>0?'#ffa500':'var(--text)'};">${pendReqs}</div>
                <div class="sa-stat-l">📋 Pendientes</div>
            </div>
        </div>

        <!-- Acceso rápido -->
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="sa-btn" onclick="saTab('clubs')"
                style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.08);">
                🏟️ Ver Clubes</button>
            <button class="sa-btn" onclick="saTab('payments')"
                style="color:#f0883e;border-color:rgba(240,136,62,0.3);background:rgba(240,136,62,0.08);">
                💳 Pagos</button>
            <button class="sa-btn" onclick="saTab('requests')"
                style="color:${pendReqs>0?'#ffa500':'var(--text-muted)'};
                       border-color:${pendReqs>0?'rgba(255,165,0,0.35)':'var(--glass-border)'};
                       background:${pendReqs>0?'rgba(255,165,0,0.08)':'var(--glass)'};">
                📋 Solicitudes ${pendReqs>0?`<strong>(${pendReqs})</strong>`:''}
            </button>
            <button class="sa-btn" onclick="saTab('pending')"
                style="color:${pendUsers>0?'#3fb950':'var(--text-muted)'};
                       border-color:${pendUsers>0?'rgba(63,185,80,0.35)':'var(--glass-border)'};
                       background:${pendUsers>0?'rgba(63,185,80,0.08)':'var(--glass)'};">
                🔔 Pendientes ${pendUsers>0?`<strong>(${pendUsers})</strong>`:''}
            </button>
            <button class="sa-btn" onclick="saTab('newclub')"
                style="color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.08);">
                ➕ Nuevo Club</button>
            <button class="sa-btn"
                onclick="document.getElementById('sa-root-modal').style.display='none';openSetupModal();"
                style="color:var(--secondary);border-color:rgba(240,136,62,0.3);background:rgba(240,136,62,0.08);">
                ⚽ Ir a mi App</button>
        </div>`;
}

// ════════════════════════════════════════════════════════════════════
//  TAB: CLUBES — tarjetas expandibles
// ════════════════════════════════════════════════════════════════════
async function saClubs() {
    const [clubs, users] = await Promise.all([saGetAll('clubs'), saGetAll('users')]);
    clubs.sort((a,b) => (a.name||'').localeCompare(b.name||''));

    const body = document.getElementById('sa-body');
    if (!clubs.length) {
        body.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:3rem;">
            No hay clubes. <button class="sa-btn" onclick="saTab('newclub')"
            style="color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.08);">
            ➕ Crear primero</button></p>`;
        return;
    }

    body.innerHTML = clubs.map(cl => {
        const clubUsers = users.filter(u => u.clubId === cl._id);
        const dirs   = clubUsers.filter(u => u.role === 'director');
        const coords = clubUsers.filter(u => u.role === 'coordinator');
        const trainers = clubUsers.filter(u => u.role === 'user');
        const parents  = clubUsers.filter(u => u.role === 'parent');
        const st     = STATUS_META[cl.status||'active'];
        const pl     = PLAN_META[cl.plan||'free'];
        const maxU   = cl.slots?.users ?? -1;
        const maxD   = cl.slots?.directors ?? -1;
        const maxC   = cl.slots?.coordinators ?? -1;
        const maxP   = cl.slots?.parents ?? -1;

        const userRows = (list, label) => list.length ? list.map(u => {
            const isActive  = u.isAuthorized && u.status !== 'blocked' && u.status !== 'removed';
            const isBlocked = u.status === 'blocked' || (!u.isAuthorized && u.status !== 'removed');
            const isRemoved = u.status === 'removed';
            const uid    = u._id;
            const email  = (u.email || u._id).replace(/'/g, "\'");
            const clubId = cl._id;

            const statusBadge =
                isRemoved ? '<span class="sa-badge" style="margin-left:0.3rem;background:#ff585822;color:#ff5858;">🗑️ Baja</span>'
              : isBlocked ? '<span class="sa-badge" style="margin-left:0.3rem;background:#ff585822;color:#ff5858;">🔒 Bloqueado</span>'
              : isActive  ? '<span class="sa-badge" style="margin-left:0.3rem;background:rgba(63,185,80,0.12);color:#3fb950;">✅ Activo</span>'
              : '<span class="sa-badge" style="margin-left:0.3rem;background:#ffa50022;color:#ffa500;">⏳ Pendiente</span>';

            return `<div class="sa-urow" style="opacity:${isRemoved ? '0.5' : '1'};">
                <div style="flex:1;min-width:0;">
                    <span style="font-size:0.83rem;font-weight:600;">${u.email||u._id}</span>
                    ${u.displayName ? `<span style="color:var(--text-muted);font-size:0.74rem;"> · ${u.displayName}</span>` : ''}
                    ${statusBadge}
                </div>
                <div style="display:flex;gap:0.3rem;flex-shrink:0;">
                    ${!isActive && !isRemoved ? `
                    <button class="sa-btn" onclick="saSetClubUserStatus('${uid}','${email}','active','${clubId}')"
                        title="Activar usuario"
                        style="font-size:0.7rem;color:#3fb950;border-color:rgba(63,185,80,0.35);background:rgba(63,185,80,0.08);font-weight:700;">
                        ✅ Activar</button>` : ''}
                    ${isActive ? `
                    <button class="sa-btn" onclick="saSetClubUserStatus('${uid}','${email}','blocked','${clubId}')"
                        title="Bloquear acceso"
                        style="font-size:0.7rem;color:#ffa500;border-color:rgba(255,165,0,0.35);background:rgba(255,165,0,0.07);font-weight:700;">
                        🔒 Bloquear</button>` : ''}
                    ${!isRemoved ? `
                    <button class="sa-btn" onclick="saSetClubUserStatus('${uid}','${email}','removed','${clubId}')"
                        title="Eliminar definitivamente"
                        style="font-size:0.7rem;color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);font-weight:700;">
                        🗑️ Eliminar</button>` : ''}
                </div>
            </div>`;
        }).join('') : `<p style="color:var(--text-muted);font-size:0.78rem;margin:0.3rem 0;">Sin ${label}</p>`;

        return `
        <div class="sa-card ${cl.status==='blocked'?'blocked':''}" id="card-${cl._id}">
          <div class="sa-card-head" onclick="saToggleCard('${cl._id}')">
            <div class="sa-card-title">
                <span class="sa-chevron">▼</span>
                ${cl.name||'Sin nombre'}
                ${saBadge(pl.label, pl.color)}
                ${saBadge(st.label, st.color)}
                ${saExpireLabel(cl.expiresAt)}
            </div>
            <div class="sa-card-meta">
                <span style="font-size:0.76rem;color:var(--text-muted);">
                    👤 ${cl.adminEmail||'—'}
                </span>
                <span style="font-size:0.76rem;color:var(--text-muted);">
                    👥 ${clubUsers.length} usuarios
                </span>
                <div style="display:flex;gap:0.3rem;align-items:center;">
                    <button class="sa-btn" onclick="event.stopPropagation();saEditClub('${cl._id}')"
                        title="Editar club"
                        style="font-size:0.73rem;color:var(--primary);
                               border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">✏️</button>
                    ${cl.status === 'blocked' ? `
                    <button class="sa-btn" onclick="event.stopPropagation();saSetClubStatus('${cl._id}','active')"
                        title="Activar club"
                        style="font-size:0.73rem;color:#3fb950;
                               border-color:rgba(63,185,80,0.35);background:rgba(63,185,80,0.08);font-weight:700;">
                        ✅ Activar</button>` : `
                    <button class="sa-btn" onclick="event.stopPropagation();saSetClubStatus('${cl._id}','blocked')"
                        title="Bloquear club — todos sus usuarios perderán acceso"
                        style="font-size:0.73rem;color:#ffa500;
                               border-color:rgba(255,165,0,0.35);background:rgba(255,165,0,0.07);font-weight:700;">
                        🔒 Bloquear</button>`}
                    <button class="sa-btn" onclick="event.stopPropagation();saDeleteClub('${cl._id}','${cl.name||cl._id}')"
                        title="Eliminar club definitivamente"
                        style="font-size:0.73rem;color:#ff5858;
                               border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);font-weight:700;">
                        🗑️ Eliminar</button>
                </div>
            </div>
          </div>
          <div class="sa-card-body">
            <!-- Slots -->
            <div class="sa-g4" style="margin:0.7rem 0;">
                <div style="font-size:0.76rem;color:var(--text-muted);">
                    📋 Directores: ${saSlotBar(dirs.length, maxD)}</div>
                <div style="font-size:0.76rem;color:var(--text-muted);">
                    🎯 Coordinadores: ${saSlotBar(coords.length, maxC)}</div>
                <div style="font-size:0.76rem;color:var(--text-muted);">
                    ⚽ Entrenadores: ${saSlotBar(trainers.length, maxU)}</div>
                <div style="font-size:0.76rem;color:var(--text-muted);">
                    👨‍👩‍👧 Padres: ${saSlotBar(parents.length, maxP)}</div>
            </div>
            <!-- Usuarios por sección -->
            ${dirs.length || maxD !== 0 ? `
            <div style="margin-bottom:0.7rem;">
                <div style="font-size:0.76rem;font-weight:700;color:#f0883e;margin-bottom:0.3rem;">
                    📋 DIRECTORES DEPORTIVOS (${dirs.length})</div>
                ${userRows(dirs,'directores')}
            </div>` : ''}
            ${`<div style="margin-bottom:0.7rem;">
                <div style="font-size:0.76rem;font-weight:700;color:#d2a8ff;margin-bottom:0.3rem;">
                    🎯 COORDINADORES (${coords.length})</div>
                ${userRows(coords,'coordinadores')}
            </div>`}
            <div style="margin-bottom:0.5rem;">
                <div style="font-size:0.76rem;font-weight:700;color:#3fb950;margin-bottom:0.3rem;">
                    ⚽ ENTRENADORES (${trainers.length})</div>
                ${userRows(trainers,'entrenadores')}
            </div>
            <div style="margin-bottom:0.5rem;">
                <div style="font-size:0.76rem;font-weight:700;color:#d2a8ff;margin-bottom:0.3rem;">
                    👨‍👩‍👧 PADRES/MADRES (${parents.length})</div>
                ${userRows(parents,'padres')}
            </div>
            ${cl.notes ? `<div style="font-size:0.75rem;color:var(--text-muted);
                padding:0.4rem 0.6rem;background:rgba(255,255,255,0.03);
                border-radius:6px;margin-top:0.4rem;">📝 ${cl.notes}</div>` : ''}
          </div>
        </div>`;
    }).join('');

    // Bind
    window.saToggleCard = (id) => {
        const c = document.getElementById(`card-${id}`);
        c.classList.toggle('expanded');
    };
    // ── Cambiar estado de un club (active / blocked) ──────────────────
    window.saSetClubStatus = async (id, newStatus) => {
        const club = await saGet('clubs', id);
        if (!club) return;
        const msgs = {
            blocked: `⚠️ BLOQUEAR CLUB: "${club.name}"

Todos sus usuarios perderán acceso inmediatamente.
¿Confirmar?`,
            active:  `¿Activar el club "${club.name}" y restaurar el acceso a sus usuarios?`,
        };
        if (!confirm(msgs[newStatus])) return;

        const { fa, collection, getDocs, query, where, updateDoc, doc } = await saFS();

        // Bloquear/desbloquear todos los usuarios del club en paralelo
        const usersSnap = await getDocs(query(collection(fa.db,'users'), where('clubId','==',id)));
        const promises  = [];
        usersSnap.forEach(d => {
            const u = d.data();
            // Al activar solo reactivamos los que no estaban en removed/rejected
            if (newStatus === 'active' && ['removed','rejected'].includes(u.status)) return;
            promises.push(updateDoc(doc(fa.db,'users',d.id), {
                isAuthorized: newStatus === 'active',
                status: newStatus === 'active' ? 'active' : 'blocked',
            }));
        });
        await Promise.all(promises);

        // Actualizar estado del club
        await saUpd('clubs', id, {
            status: newStatus,
            [`${newStatus}At`]: new Date().toISOString(),
        });

        const toasts = { blocked: '🔒 Club bloqueado y usuarios suspendidos', active: '✅ Club activado y usuarios restaurados' };
        showToast(toasts[newStatus] || '✅ Hecho', 4000);
        saClubs();
    };

    // Compatibilidad con código antiguo
    window.saBlockClub = async (id, block) => saSetClubStatus(id, block ? 'blocked' : 'active');

    window.saToggleUser = async (uid, currentlyActive) => {
        await saUpd('users', uid, { isAuthorized: !currentlyActive });
        showToast(!currentlyActive ? '✅ Usuario activado' : '🔒 Usuario bloqueado', 2000);
        saClubs();
    };
    // ── Activar / Bloquear / Eliminar usuario de club ─────────────────
    window.saSetClubUserStatus = async (uid, email, newStatus, clubId) => {
        const labels  = { active:'activar', blocked:'bloquear', removed:'eliminar definitivamente' };
        if (!confirm(`¿Deseas ${labels[newStatus]} a ${email}?`)) return;
        showSpinner('Procesando…');
        try {
            const { fa, doc, getDoc, updateDoc, deleteDoc } = await saFS();

            // Leer rol del usuario para ajustar slots
            const uSnap = await getDoc(doc(fa.db,'users',uid));
            const ud    = uSnap.exists() ? uSnap.data() : {};
            const role  = ud.role || 'user';
            const slotKey = role==='director'?'usedSlots.directors'
                          : role==='coordinator'?'usedSlots.coordinators'
                          : role==='parent'?'usedSlots.parents'
                          : 'usedSlots.users';

            if (newStatus === 'removed') {
                // Eliminar el documento de usuario
                await deleteDoc(doc(fa.db,'users',uid));
                // Decrementar slot del club
                const cSnap = await getDoc(doc(fa.db,'clubs',clubId)).catch(()=>null);
                if (cSnap?.exists()) {
                    const cur = cSnap.data().usedSlots?.[slotKey.split('.')[1]] || 1;
                    await updateDoc(doc(fa.db,'clubs',clubId), { [slotKey]: Math.max(0, cur - 1) });
                }
                hideSpinner();
                showToast(`🗑️ ${email} eliminado del club`, 3500);
            } else {
                // Activar o bloquear
                const isActive = newStatus === 'active';
                await updateDoc(doc(fa.db,'users',uid), {
                    isAuthorized: isActive,
                    status:       newStatus,
                    ...(isActive ? { authorizedAt: new Date().toISOString() } : { blockedAt: new Date().toISOString() }),
                });
                // Ajustar slots: bloquear resta, activar suma
                const cSnap = await getDoc(doc(fa.db,'clubs',clubId)).catch(()=>null);
                if (cSnap?.exists()) {
                    const cur = cSnap.data().usedSlots?.[slotKey.split('.')[1]] || 0;
                    const delta = isActive ? 1 : -1;
                    await updateDoc(doc(fa.db,'clubs',clubId), { [slotKey]: Math.max(0, cur + delta) });
                }
                hideSpinner();
                showToast(isActive ? `✅ ${email} activado` : `🔒 ${email} bloqueado`, 3000);
            }
            saClubs();
        } catch(e) {
            hideSpinner();
            showToast('⚠️ Error: ' + e.message, 4000);
            console.error(e);
        }
    };

    window.saEditClub = (id) => saOpenEditor(id);

    window.saDeleteClub = async (id, name) => {
        if (!confirm(`⚠️ ELIMINAR CLUB: "${name}"\n\nAcción IRREVERSIBLE.\nTodos los usuarios del club quedarán desactivados.\n\n¿Confirmar?`)) return;
        const second = prompt(`Escribe el nombre exacto del club para confirmar:\n"${name}"`);
        if (second !== name) { showToast('❌ Nombre incorrecto. Club NO eliminado.', 4000); return; }
        showSpinner('Eliminando club…');
        try {
            const { fa, doc, deleteDoc, collection, getDocs, query, where, updateDoc } = await saFS();
            const usersSnap = await getDocs(query(collection(fa.db,'users'), where('clubId','==',id)));
            const promises  = [];
            usersSnap.forEach(d => promises.push(
                updateDoc(doc(fa.db,'users',d.id), {
                    clubId: null, clubName: null,
                    isAuthorized: false, status: 'removed',
                    removedAt: new Date().toISOString(),
                })
            ));
            await Promise.all(promises);
            await deleteDoc(doc(fa.db,'clubs',id));
            hideSpinner();
            showToast(`🗑️ Club "${name}" eliminado (${usersSnap.size} usuarios desactivados)`, 5000);
            saTab('clubs');
        } catch(e) {
            hideSpinner();
            showToast('⚠️ Error: ' + e.message, 4000);
        }
    };
}

// ── Editor de club ───────────────────────────────────────────────────
async function saOpenEditor(clubId) {
    const cl = await saGet('clubs', clubId);
    if (!cl) return;
    const f  = cl.features || {};
    const FEATURES = [
        { id:'live_view',       icon:'📡', label:'Ver EN VIVO',          desc:'Coordinadores/directores ven partidos' },
        { id:'ai_import',       icon:'🤖', label:'Importar con IA',       desc:'OCR con Gemini para plantillas' },
        { id:'advanced_stats',  icon:'📊', label:'Estadísticas avanzadas',desc:'Próximamente' },
        { id:'custom_branding', icon:'🎨', label:'Marca personalizada',   desc:'Próximamente' },
    ];
    window._editF = { ...f };
    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <div style="max-width:600px;">
          <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1rem;">
            <button onclick="saTab('clubs')" class="sa-btn"
                style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                ← Volver</button>
            <h3 style="margin:0;font-size:1rem;">✏️ ${cl.name||clubId}</h3>
          </div>
          <div class="sa-g2" style="margin-bottom:0.9rem;">
            <div><label class="sa-label">Nombre del club</label>
                <input class="sa-input" id="ec-name" value="${cl.name||''}"></div>
            <div><label class="sa-label">Email admin (único)</label>
                <input class="sa-input" id="ec-admin" type="email" value="${cl.adminEmail||''}"></div>
          </div>
          <div class="sa-g4" style="margin-bottom:0.9rem;">
            <div><label class="sa-label">Slots Directores (-1=∞)</label>
                <input class="sa-input" id="ec-dir" type="number" value="${cl.slots?.directors??-1}"></div>
            <div><label class="sa-label">Slots Coord. (-1=∞)</label>
                <input class="sa-input" id="ec-coord" type="number" value="${cl.slots?.coordinators??-1}"></div>
            <div><label class="sa-label">Slots Entren. (-1=∞)</label>
                <input class="sa-input" id="ec-users" type="number" value="${cl.slots?.users??-1}"></div>
            <div><label class="sa-label">Slots Padres (-1=∞)</label>
                <input class="sa-input" id="ec-parents" type="number" value="${cl.slots?.parents??-1}"></div>
          </div>
          <div class="sa-g2" style="margin-bottom:0.9rem;">
            <div><label class="sa-label">Expira (vacío=sin límite)</label>
                <input class="sa-input" id="ec-exp" type="date" value="${cl.expiresAt?cl.expiresAt.substring(0,10):''}"></div>
            <div><label class="sa-label">Plan</label>
                <select class="sa-input" id="ec-plan">
                    ${Object.entries(PLAN_META).filter(([k])=>!['monthly','annual'].includes(k))
                      .map(([k,v])=>`<option value="${k}" ${cl.plan===k?'selected':''}>${v.label}</option>`).join('')}
                </select></div>
            <div><label class="sa-label">Estado</label>
                <select class="sa-input" id="ec-status">
                    ${Object.entries(STATUS_META).map(([k,v])=>
                      `<option value="${k}" ${(cl.status||'active')===k?'selected':''}>${v.label}</option>`).join('')}
                </select></div>
          </div>
          <div style="margin-bottom:0.9rem;">
            <label class="sa-label" style="margin-bottom:0.4rem;">🔧 Funcionalidades</label>
            <div style="display:flex;flex-direction:column;gap:0.35rem;">
                ${FEATURES.map(ft => `
                <div class="sa-flag ${f[ft.id]?'on':'off'}" id="fl-${ft.id}" onclick="saFlip('${ft.id}')">
                    <span>${f[ft.id]?'✅':'⬜'}</span>
                    <strong>${ft.icon} ${ft.label}</strong>
                    <span style="color:var(--text-muted);font-size:0.74rem;">— ${ft.desc}</span>
                </div>`).join('')}
            </div>
          </div>
          <div style="margin-bottom:0.9rem;"><label class="sa-label">Precio/mes (€)</label>
            <input class="sa-input" id="ec-price" type="number" placeholder="0" value="${cl.price||''}"></div>
          <div style="margin-bottom:0.9rem;"><label class="sa-label">Notas internas</label>
            <textarea class="sa-input" id="ec-notes" rows="2" style="resize:vertical;">${cl.notes||''}</textarea>
          </div>
          <div style="display:flex;gap:0.6rem;">
            <button onclick="saTab('clubs')" class="sa-btn"
                style="color:var(--text-muted);border-color:var(--glass-border);background:var(--glass);">
                Cancelar</button>
            <button onclick="saSaveClub('${clubId}')" class="sa-btn"
                style="flex:1;padding:0.55rem;color:#3fb950;border-color:rgba(63,185,80,0.4);
                       background:rgba(63,185,80,0.1);font-weight:700;font-size:0.88rem;">
                💾 Guardar cambios</button>
          </div>
          <div id="ec-msg" style="font-size:0.8rem;margin-top:0.5rem;text-align:center;min-height:1rem;"></div>
        </div>`;

    window.saFlip = (fid) => {
        window._editF[fid] = !window._editF[fid];
        const el = document.getElementById(`fl-${fid}`);
        const on = window._editF[fid];
        el.classList.toggle('on', on); el.classList.toggle('off', !on);
        el.querySelector('span').textContent = on ? '✅' : '⬜';
    };
    window.saSaveClub = async (id) => {
        const msg = document.getElementById('ec-msg');
        msg.style.color = 'var(--primary)'; msg.textContent = 'Guardando…';
        try {
            await saWrite('clubs', id, {
                name:        document.getElementById('ec-name').value.trim(),
                adminEmail:  document.getElementById('ec-admin').value.trim(),
                slots: {
                    directors:    +document.getElementById('ec-dir').value   || -1,
                    coordinators: +document.getElementById('ec-coord').value || -1,
                    users:        +document.getElementById('ec-users').value || -1,
                    parents:      +document.getElementById('ec-parents').value || -1,
                },
                plan:      document.getElementById('ec-plan').value,
                status:    document.getElementById('ec-status').value,
                expiresAt: document.getElementById('ec-exp').value || null,
                price:     parseFloat(document.getElementById('ec-price').value) || null,
                notes:     document.getElementById('ec-notes').value.trim(),
                features:  window._editF,
            });
            msg.style.color = '#3fb950'; msg.textContent = '✅ Guardado';
            setTimeout(() => saTab('clubs'), 1000);
        } catch(e) {
            msg.style.color = '#ff5858'; msg.textContent = '⚠️ ' + e.message;
        }
    };
}

// ════════════════════════════════════════════════════════════════════
//  TAB: USUARIOS INDIVIDUALES
// ════════════════════════════════════════════════════════════════════
async function saIndividual() {
    const users = (await saGetAll('users')).filter(u => u.role === 'individual' || u.isIndividual);
    const body  = document.getElementById('sa-body');

    const planInfo = `
    <div class="sa-card" style="margin-bottom:1rem;border-color:rgba(121,192,255,0.3);background:rgba(121,192,255,0.04);">
        <div style="font-weight:700;margin-bottom:0.5rem;">👤 Plan Individual — Usuarios sin club</div>
        <div style="font-size:0.81rem;color:var(--text-muted);line-height:1.6;">
            Usuarios que compran o alquilan la app de forma independiente.<br>
            Tienen acceso a las funciones básicas (crear equipos, gestionar plantillas, partidos).<br>
            Sin acceso a EN VIVO ni coordinadores. Precio: <strong style="color:var(--text);">libre (tú defines)</strong>
        </div>
        <div style="margin-top:0.7rem;display:flex;gap:0.5rem;">
            <button class="sa-btn" onclick="saAddIndividual()"
                style="color:#79c0ff;border-color:rgba(121,192,255,0.35);background:rgba(121,192,255,0.08);">
                ➕ Añadir usuario individual</button>
        </div>
    </div>`;

    if (!users.length) {
        body.innerHTML = planInfo + `
            <p style="color:var(--text-muted);text-align:center;padding:2rem;">
                Sin usuarios individuales aún.</p>`;
        return;
    }

    body.innerHTML = planInfo + users.map(u => {
        const pl = PLAN_META[u.plan||'monthly'];
        const st = STATUS_META[u.status||'active'];
        return `
        <div class="sa-card" id="icard-${u._id}">
          <div class="sa-card-head" onclick="saToggleICard('${u._id}')">
            <div class="sa-card-title">
                <span class="sa-chevron">▼</span>
                ${u.email||u._id}
                ${u.displayName?`<span style="font-weight:400;color:var(--text-muted);font-size:0.83rem;"> · ${u.displayName}</span>`:''}
                ${saBadge(pl.label, pl.color)}
                ${saBadge(st.label, st.color)}
            </div>
            <div class="sa-card-meta">
                ${saExpireLabel(u.expiresAt)}
                <button class="sa-btn" onclick="event.stopPropagation();saEditIndividual('${u._id}')"
                    title="Editar"
                    style="font-size:0.73rem;color:var(--primary);
                           border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">✏️</button>
                ${u.isAuthorized ? `
                <button class="sa-btn" onclick="event.stopPropagation();saSetIndividualStatus('${u._id}','${(u.email||u._id).replace(/'/g,"\'")}','blocked')"
                    title="Bloquear acceso"
                    style="font-size:0.73rem;color:#ffa500;
                           border-color:rgba(255,165,0,0.35);background:rgba(255,165,0,0.07);font-weight:700;">
                    🔒 Bloquear</button>` : `
                <button class="sa-btn" onclick="event.stopPropagation();saSetIndividualStatus('${u._id}','${(u.email||u._id).replace(/'/g,"\'")}','active')"
                    title="Activar usuario"
                    style="font-size:0.73rem;color:#3fb950;
                           border-color:rgba(63,185,80,0.35);background:rgba(63,185,80,0.08);font-weight:700;">
                    ✅ Activar</button>`}
                <button class="sa-btn" onclick="event.stopPropagation();saDeleteIndividual('${u._id}','${(u.email||u._id).replace(/'/g,"\'")}')"
                    title="Eliminar usuario definitivamente"
                    style="font-size:0.73rem;color:#ff5858;
                           border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);font-weight:700;">
                    🗑️ Eliminar</button>
            </div>
          </div>
          <div class="sa-card-body">
            <div class="sa-g2" style="margin-top:0.6rem;font-size:0.8rem;color:var(--text-muted);">
                <div>📅 Registrado: ${u.createdAt?new Date(u.createdAt).toLocaleDateString('es-ES'):'—'}</div>
                <div>⏳ Expira: ${u.expiresAt?new Date(u.expiresAt).toLocaleDateString('es-ES'):'—'}</div>
                <div>💳 Plan: ${pl.label}</div>
                <div>💰 Precio: ${u.price?u.price+'€':u.price===0?'Gratis':'—'}</div>
            </div>
            ${u.notes?`<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem;
                padding:0.4rem 0.6rem;background:rgba(255,255,255,0.03);border-radius:6px;">
                📝 ${u.notes}</div>`:''}
          </div>
        </div>`;
    }).join('');

    window.saToggleICard = (id) => {
        document.getElementById(`icard-${id}`)?.classList.toggle('expanded');
    };

    // ── Activar o bloquear usuario individual ──────────────────────────
    window.saSetIndividualStatus = async (uid, email, newStatus) => {
        const isActive  = newStatus === 'active';
        const isBlocked = newStatus === 'blocked';
        const labels    = { active: 'activar', blocked: 'bloquear' };
        if (!confirm(`¿Deseas ${labels[newStatus]} a ${email}?`)) return;
        try {
            await saUpd('users', uid, {
                isAuthorized: isActive,
                status:       newStatus,
                ...(isActive  ? { authorizedAt: new Date().toISOString() } : {}),
                ...(isBlocked ? { blockedAt:    new Date().toISOString() } : {}),
            });
            showToast(isActive ? `✅ ${email} activado` : `🔒 ${email} bloqueado`, 3000);
            saIndividual();
        } catch(e) { showToast('⚠️ Error: ' + e.message, 4000); }
    };

    // Compatibilidad con código antiguo en tab Clubes
    window.saToggleUser = async (uid, cur) => {
        await saUpd('users', uid, { isAuthorized: !cur });
        showToast(!cur ? '✅ Activado' : '🔒 Bloqueado', 2000);
        saIndividual();
    };

    // ── Eliminar usuario individual definitivamente ──────────────────
    window.saDeleteIndividual = async (uid, email) => {
        if (!confirm(`⚠️ ELIMINAR usuario individual:\n${email}\n\nEsta acción es IRREVERSIBLE.\nSe eliminará su cuenta y su club personal.\n\n¿Confirmar?`)) return;
        showSpinner('Eliminando usuario…');
        try {
            const { fa, doc, deleteDoc, getDoc, collection, getDocs, query, where } = await saFS();

            // Obtener datos del usuario para saber su clubId personal
            const snap = await getDoc(doc(fa.db, 'users', uid));
            const userData = snap.exists() ? snap.data() : {};

            // Si tiene un club personal (ind-...), eliminarlo también
            if (userData.clubId && userData.clubId.startsWith('ind-')) {
                try {
                    await deleteDoc(doc(fa.db, 'clubs', userData.clubId));
                } catch(e) { /* no bloquear si el club ya no existe */ }
            }

            // Eliminar vínculos de jugador si los hay
            try {
                const linksSnap = await getDocs(query(
                    collection(fa.db, 'cronos_player_links'),
                    where('clubId', '==', userData.clubId || '')
                ));
                for (const d of linksSnap.docs) {
                    await deleteDoc(doc(fa.db, 'cronos_player_links', d.id));
                }
            } catch(e) { /* opcional */ }

            // Eliminar el usuario
            await deleteDoc(doc(fa.db, 'users', uid));

            hideSpinner();
            showToast(`🗑️ Usuario "${email}" eliminado definitivamente`, 4000);
            saIndividual();
        } catch(e) {
            hideSpinner();
            showToast('⚠️ Error: ' + e.message, 4000);
        }
    };

    // saDeleteUser global (usado desde tab Clubes) — redirige a saDeleteIndividual
    window.saDeleteUser = (uid, email) => saDeleteIndividual(uid, email);

    window.saEditIndividual = (uid) => saOpenIndividualEditor(uid);
    window.saAddIndividual  = ()    => saOpenIndividualEditor(null);
}

async function saOpenIndividualEditor(uid) {
    const u    = uid ? await saGet('users', uid) : {};
    const body = document.getElementById('sa-body');
    body.innerHTML = `
        <div style="max-width:520px;">
          <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1rem;">
            <button onclick="saTab('individual')" class="sa-btn"
                style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                ← Volver</button>
            <h3 style="margin:0;font-size:1rem;">${uid ? '✏️ Editar usuario individual' : '➕ Nuevo usuario individual'}</h3>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.7rem;">
            <div><label class="sa-label">Email *</label>
                <input class="sa-input" id="iu-email" type="email" value="${u.email||''}"></div>
            <div><label class="sa-label">Nombre</label>
                <input class="sa-input" id="iu-name" value="${u.displayName||''}"></div>
            <div class="sa-g2">
                <div><label class="sa-label">Plan</label>
                    <select class="sa-input" id="iu-plan">
                        <option value="monthly" ${u.plan==='monthly'?'selected':''}>📅 Mensual</option>
                        <option value="annual"  ${u.plan==='annual'?'selected':''}>📆 Anual</option>
                        <option value="free"    ${u.plan==='free'?'selected':''}>🆓 Gratis</option>
                        <option value="custom"  ${u.plan==='custom'?'selected':''}>⚙️ Custom</option>
                    </select></div>
                <div><label class="sa-label">Precio (€)</label>
                    <input class="sa-input" id="iu-price" type="number" value="${u.price??''}"></div>
            </div>
            <div><label class="sa-label">Fecha de expiración</label>
                <input class="sa-input" id="iu-exp" type="date" value="${u.expiresAt?u.expiresAt.substring(0,10):''}"></div>
            <div><label class="sa-label">Slots Padres/Madres (-1=∞)</label>
                <input class="sa-input" id="iu-parents" type="number" value="${u.slots?.parents??-1}"
                    placeholder="-1 = sin límite"></div>
            <div><label class="sa-label">Estado</label>
                <select class="sa-input" id="iu-status">
                    ${Object.entries(STATUS_META).map(([k,v])=>
                      `<option value="${k}" ${(u.status||'active')===k?'selected':''}>${v.label}</option>`).join('')}
                </select></div>
            <div><label class="sa-label">Notas</label>
                <textarea class="sa-input" id="iu-notes" rows="2" style="resize:vertical;">${u.notes||''}</textarea></div>
            <button onclick="saSaveIndividual('${uid||''}')" class="sa-btn"
                style="padding:0.6rem;color:#79c0ff;border-color:rgba(121,192,255,0.4);
                       background:rgba(121,192,255,0.1);font-weight:700;font-size:0.88rem;">
                💾 Guardar</button>
            <div id="iu-msg" style="font-size:0.8rem;text-align:center;min-height:1rem;"></div>
          </div>
        </div>`;

    window.saSaveIndividual = async (existingUid) => {
        const msg   = document.getElementById('iu-msg');
        const email = document.getElementById('iu-email').value.trim();
        if (!email) { msg.style.color='#ff5858'; msg.textContent='⚠️ Email obligatorio'; return; }
        msg.style.color='var(--primary)'; msg.textContent='Guardando…';
        const id = existingUid || ('ind_'+Date.now().toString(36));
        await saWrite('users', id, {
            email, displayName: document.getElementById('iu-name').value.trim(),
            role:        'individual',
            isIndividual: true,
            isAuthorized: true,
            plan:        document.getElementById('iu-plan').value,
            price:       parseFloat(document.getElementById('iu-price').value)||0,
            expiresAt:   document.getElementById('iu-exp').value||null,
            status:      document.getElementById('iu-status').value,
            notes:       document.getElementById('iu-notes').value.trim(),
            slots:       { parents: +document.getElementById('iu-parents').value || -1 },
            createdAt:   u.createdAt || new Date().toISOString(),
        });
        msg.style.color='#3fb950'; msg.textContent='✅ Guardado';
        setTimeout(() => saTab('individual'), 1000);
    };
}

// ════════════════════════════════════════════════════════════════════
//  TAB: PAGOS — Registro manual (Bizum / Transferencia / Efectivo)
// ════════════════════════════════════════════════════════════════════
async function saPayments() {
    const [clubs, individuals] = await Promise.all([
        saGetAll('clubs'),
        saGetAll('users').then(u => u.filter(x => x.isIndividual || x.role === 'individual'))
    ]);
    clubs.sort((a,b) => (a.name||'').localeCompare(b.name||''));
    const body = document.getElementById('sa-body');
    const now  = new Date();

    // ── Alertas de vencimiento ──
    const alerts = [];
    [...clubs, ...individuals].forEach(x => {
        if (!x.expiresAt) return;
        const d    = new Date(x.expiresAt);
        const days = Math.ceil((d - now) / 86400000);
        const name = x.name || x.email || x._id;
        if (days < 0)
            alerts.push(`🔴 <strong>${name}</strong> — vencido hace ${Math.abs(days)} día${Math.abs(days)!==1?'s':''}`);
        else if (days <= 7)
            alerts.push(`🟡 <strong>${name}</strong> — vence en ${days} día${days!==1?'s':''}`);
    });

    body.innerHTML = `
        ${alerts.length ? `
        <div style="background:rgba(255,165,0,0.08);border:1px solid rgba(255,165,0,0.35);
                    border-radius:8px;padding:0.7rem 1rem;margin-bottom:1rem;font-size:0.82rem;line-height:1.8;">
            ⚠️ <strong>Avisos de vencimiento:</strong><br>${alerts.join('<br>')}
        </div>` : `
        <div style="background:rgba(63,185,80,0.07);border:1px solid rgba(63,185,80,0.3);
                    border-radius:8px;padding:0.6rem 1rem;margin-bottom:1rem;font-size:0.82rem;">
            ✅ Todos los pagos al día
        </div>`}

        <!-- CLUBES -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <h3 style="font-size:0.9rem;margin:0;">🏟️ Clubes</h3>
            <span style="font-size:0.75rem;color:var(--text-muted);">${clubs.length} club${clubs.length!==1?'s':''}</span>
        </div>
        ${clubs.map(cl => saPaymentCard(cl, 'club')).join('')}

        ${individuals.length ? `
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin:1.2rem 0 0.5rem;">
            <h3 style="font-size:0.9rem;margin:0;">👤 Usuarios individuales</h3>
            <span style="font-size:0.75rem;color:var(--text-muted);">${individuals.length}</span>
        </div>
        ${individuals.map(u => saPaymentCard(u, 'individual')).join('')}
        ` : ''}
    `;

    // Bind actions
    window.saRegisterPayment = (id, type) => saOpenPaymentForm(id, type);
    window.saViewHistory     = (id, type) => saOpenPaymentHistory(id, type);
}

function saPaymentCard(item, type) {
    const pl      = PLAN_META[item.plan||'free'];
    const now     = new Date();
    const expired = item.expiresAt && new Date(item.expiresAt) < now;
    const days    = item.expiresAt
        ? Math.ceil((new Date(item.expiresAt) - now) / 86400000) : null;
    const name    = item.name || item.email || item._id;

    // Last payment info
    const lastPay = item.lastPayment;
    const lastPayStr = lastPay
        ? `${lastPay.method === 'bizum' ? '📱 Bizum' : lastPay.method === 'transfer' ? '🏦 Transferencia' : '💵 Efectivo'} · ${new Date(lastPay.date).toLocaleDateString('es-ES')} · ${lastPay.amount||'—'}€`
        : 'Sin pagos registrados';

    const statusColor = expired ? '#ff5858' : days !== null && days <= 7 ? '#ffa500' : '#3fb950';
    const statusText  = expired
        ? `⚠️ Vencido hace ${Math.abs(days)}d`
        : days === null ? '∞ Sin límite'
        : days <= 7 ? `⏳ Vence en ${days}d`
        : `✅ Válido hasta ${new Date(item.expiresAt).toLocaleDateString('es-ES')}`;

    return `
    <div class="sa-card" style="border-color:${expired?'rgba(255,88,88,0.4)':days!==null&&days<=7?'rgba(255,165,0,0.4)':'var(--glass-border)'};
                                margin-bottom:0.6rem;">
        <div class="sa-row">
            <div>
                <span style="font-weight:700;">${name}</span>
                ${saBadge(pl.label, pl.color)}
                <span style="font-size:0.75rem;color:${statusColor};margin-left:0.4rem;">${statusText}</span>
            </div>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <button class="sa-btn" onclick="saSendPaymentEmail('${item._id}','${type}')"
                    style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);font-weight:700;">
                    📧 Enviar aviso</button>
                <button class="sa-btn" onclick="saRegisterPayment('${item._id}','${type}')"
                    style="color:#3fb950;border-color:rgba(63,185,80,0.4);background:rgba(63,185,80,0.08);font-weight:700;">
                    💳 Registrar pago</button>
                <button class="sa-btn" onclick="saViewHistory('${item._id}','${type}')"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                    📋 Historial</button>
            </div>
        </div>
        <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.4rem;display:flex;gap:1.5rem;flex-wrap:wrap;">
            <span>💰 Precio: <strong style="color:var(--text);">${item.price?item.price+'€/mes':'—'}</strong></span>
            <span>🕐 Último pago: <strong style="color:var(--text);">${lastPayStr}</strong></span>
            ${type==='club'?`<span>👤 Admin: <strong style="color:var(--text);">${item.adminEmail||'—'}</strong></span>`:''}
        </div>
    </div>`;
}

// ── Formulario registrar pago ─────────────────────────────────────────
async function saOpenPaymentForm(id, type) {
    const item = await saGet(type === 'club' ? 'clubs' : 'users', id);
    if (!item) return;
    const name = item.name || item.email || id;
    const body = document.getElementById('sa-body');

    // Calculate suggested next expiry (1 month from today or from current expiry)
    const base = item.expiresAt && new Date(item.expiresAt) > new Date()
        ? new Date(item.expiresAt)
        : new Date();
    const suggested = new Date(base);
    suggested.setMonth(suggested.getMonth() + 1);
    const suggestedStr = suggested.toISOString().substring(0, 10);

    body.innerHTML = `
        <div style="max-width:480px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.2rem;">
                <button onclick="saTab('payments')" class="sa-btn"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                    ← Volver</button>
                <h3 style="margin:0;font-size:1rem;">💳 Registrar pago — ${name}</h3>
            </div>

            <!-- Resumen actual -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:8px;padding:0.8rem 1rem;margin-bottom:1.2rem;font-size:0.82rem;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;color:var(--text-muted);">
                    <div>Plan actual: <strong style="color:var(--text);">${PLAN_META[item.plan||'free']?.label||'—'}</strong></div>
                    <div>Precio/mes: <strong style="color:var(--text);">${item.price?item.price+'€':'—'}</strong></div>
                    <div>Vencimiento actual: <strong style="color:var(--text);">${item.expiresAt?new Date(item.expiresAt).toLocaleDateString('es-ES'):'Sin límite'}</strong></div>
                    <div>Estado: <strong style="color:var(--text);">${STATUS_META[item.status||'active']?.label||'—'}</strong></div>
                </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.8rem;">

                <!-- Método de pago -->
                <div>
                    <label class="sa-label">Método de pago *</label>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;" id="pay-method-btns">
                        <div class="pay-method-btn active" id="pm-bizum" onclick="selectPayMethod('bizum')"
                            style="padding:0.7rem;background:rgba(63,185,80,0.15);border:2px solid rgba(63,185,80,0.5);
                                   border-radius:8px;cursor:pointer;text-align:center;transition:all 0.15s;">
                            <div style="font-size:1.3rem;">📱</div>
                            <div style="font-size:0.8rem;font-weight:700;color:#3fb950;margin-top:0.2rem;">Bizum</div>
                        </div>
                        <div class="pay-method-btn" id="pm-transfer" onclick="selectPayMethod('transfer')"
                            style="padding:0.7rem;background:var(--glass);border:2px solid var(--glass-border);
                                   border-radius:8px;cursor:pointer;text-align:center;transition:all 0.15s;">
                            <div style="font-size:1.3rem;">🏦</div>
                            <div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);margin-top:0.2rem;">Transferencia</div>
                        </div>
                        <div class="pay-method-btn" id="pm-cash" onclick="selectPayMethod('cash')"
                            style="padding:0.7rem;background:var(--glass);border:2px solid var(--glass-border);
                                   border-radius:8px;cursor:pointer;text-align:center;transition:all 0.15s;">
                            <div style="font-size:1.3rem;">💵</div>
                            <div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);margin-top:0.2rem;">Efectivo</div>
                        </div>
                    </div>
                    <input type="hidden" id="pay-method" value="bizum">
                </div>

                <!-- Importe y fecha -->
                <div class="sa-g2">
                    <div>
                        <label class="sa-label">Importe recibido (€) *</label>
                        <input class="sa-input" id="pay-amount" type="number"
                            placeholder="${item.price||''}" value="${item.price||''}">
                    </div>
                    <div>
                        <label class="sa-label">Fecha del pago *</label>
                        <input class="sa-input" id="pay-date" type="date"
                            value="${new Date().toISOString().substring(0,10)}">
                    </div>
                </div>

                <!-- Nuevo vencimiento -->
                <div>
                    <label class="sa-label">Nuevo vencimiento (se calcula automáticamente +1 mes)</label>
                    <input class="sa-input" id="pay-expires" type="date" value="${suggestedStr}">
                </div>

                <!-- Nuevo plan (opcional) -->
                <div>
                    <label class="sa-label">Plan (opcional — cambiar si procede)</label>
                    <select class="sa-input" id="pay-plan">
                        ${Object.entries(PLAN_META)
                            .filter(([k]) => !['monthly','annual'].includes(k))
                            .map(([k,v]) => `<option value="${k}" ${(item.plan||'free')===k?'selected':''}>${v.label}</option>`)
                            .join('')}
                    </select>
                </div>

                <!-- Notas -->
                <div>
                    <label class="sa-label">Notas (referencia Bizum, nº transferencia, etc.)</label>
                    <input class="sa-input" id="pay-notes" placeholder="ej: Bizum ref. 12345 / Transf. ES12...">
                </div>

                <button onclick="saDoRegisterPayment('${id}','${type}')" class="sa-btn"
                    style="padding:0.65rem;color:#3fb950;border-color:rgba(63,185,80,0.4);
                           background:rgba(63,185,80,0.1);font-weight:700;font-size:0.9rem;">
                    ✅ Confirmar pago recibido</button>

                <div id="pay-msg" style="font-size:0.82rem;text-align:center;min-height:1rem;"></div>
            </div>
        </div>`;

    window._payMethod = 'bizum';
    window.selectPayMethod = (method) => {
        window._payMethod = method;
        document.getElementById('pay-method').value = method;
        ['bizum','transfer','cash'].forEach(m => {
            const el = document.getElementById(`pm-${m}`);
            if (!el) return;
            const active = m === method;
            const colors = { bizum:'#3fb950', transfer:'#58a6ff', cash:'#f0883e' };
            const col = colors[m];
            el.style.background    = active ? `rgba(${m==='bizum'?'63,185,80':m==='transfer'?'88,166,255':'240,136,62'},0.15)` : 'var(--glass)';
            el.style.borderColor   = active ? col : 'var(--glass-border)';
            el.querySelector('div:last-child').style.color = active ? col : 'var(--text-muted)';
        });
    };

    window.saDoRegisterPayment = async (id, type) => {
        const msg    = document.getElementById('pay-msg');
        const amount = parseFloat(document.getElementById('pay-amount').value);
        const date   = document.getElementById('pay-date').value;
        const exp    = document.getElementById('pay-expires').value;
        const plan   = document.getElementById('pay-plan').value;
        const notes  = document.getElementById('pay-notes').value.trim();
        const method = window._payMethod || 'bizum';

        if (!amount || !date) {
            msg.style.color = '#ff5858'; msg.textContent = '⚠️ Importe y fecha son obligatorios.'; return;
        }
        msg.style.color = 'var(--primary)'; msg.textContent = 'Guardando…';

        const col     = type === 'club' ? 'clubs' : 'users';
        const payEntry = { method, amount, date, notes, registeredAt: new Date().toISOString() };

        // Get existing history
        const current = await saGet(col, id);
        const history = current?.paymentHistory || [];
        history.unshift(payEntry); // newest first

        await saWrite(col, id, {
            plan,
            status:         'active',
            expiresAt:      exp || null,
            price:          amount,
            lastPayment:    payEntry,
            paymentHistory: history.slice(0, 24), // keep last 24 entries
        });

        msg.style.color = '#3fb950';
        msg.textContent = `✅ Pago de ${amount}€ registrado correctamente.`;
        showToast(`✅ Pago registrado — ${name}`, 3000);
        setTimeout(() => saTab('payments'), 1500);
    };
}

// ── TAB: SOLICITUDES (BAJAS + NUEVOS CLUBES + INDIVIDUALES) ──────────────────────────
// ── TAB: SOLICITUDES (BAJAS + NUEVOS CLUBES + INDIVIDUALES) ──────────────────────────
async function saRequests() {
    const { db, collection, getDocs, doc, query, where, updateDoc, getDoc, setDoc } = await saFS();

    // 1. Obtener los tres tipos de solicitudes pendientes en paralelo
    const [delReqsSnap, clubUsersSnap, indivUsersSnap] = await Promise.all([
        getDocs(query(collection(db, 'deletion_requests'), where('status', '==', 'pending'))),
        getDocs(query(collection(db, 'users'), where('requestedRole', '==', 'club_admin'),  where('isAuthorized', '==', false))),
        getDocs(query(collection(db, 'users'), where('requestedRole', '==', 'individual'), where('isAuthorized', '==', false))),
    ]);

    const delReqs   = []; delReqsSnap.forEach(d  => delReqs.push({ _id: d.id, ...d.data() }));
    const clubReqs  = []; clubUsersSnap.forEach(d => clubReqs.push({ _id: d.id, ...d.data() }));
    const indivReqs = []; indivUsersSnap.forEach(d => {
        const u = d.data();
        if (u.status !== 'rejected') indivReqs.push({ _id: d.id, ...u });
    });

    const body = document.getElementById('sa-body');
    if (!delReqs.length && !clubReqs.length && !indivReqs.length) {
        body.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:4rem 2rem; opacity:0.6;">
                <div style="font-size:3rem; margin-bottom:1rem;">✅</div>
                <div style="font-size:1.1rem; font-weight:600; color:var(--text);">Bandeja vacía</div>
                <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.4rem;">No hay solicitudes de alta ni de baja pendientes.</div>
            </div>`;
        return;
    }

    let html = `<div style="display:flex; gap:1.5rem; flex-direction:column;">`;

    // ── SECCIÓN A: NUEVOS CLUBES ─────────────────────────────────────
    if (clubReqs.length) {
        html += `
        <section>
            <h3 style="font-size:0.9rem; margin:0 0 1rem; color:#58a6ff; display:flex; align-items:center; gap:0.6rem;">
                <span style="background:rgba(88,166,255,0.15); padding:4px 8px; border-radius:6px;">🏟️</span>
                Solicitudes de Nuevo Club (${clubReqs.length})
            </h3>
            <div style="display:grid; gap:0.8rem;">
            ${clubReqs.map(r => `
                <div class="sa-card" style="border-color:rgba(88,166,255,0.3); background:rgba(88,166,255,0.03);">
                    <div style="padding:1rem;">
                        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:0.8rem;">
                            <div>
                                <div style="font-weight:700; font-size:1.05rem; color:var(--text);">${r.requestedClubName || 'Club sin nombre'}</div>
                                <div style="font-size:0.8rem; color:#58a6ff;">👤 Admin: ${r.email}</div>
                            </div>
                            <div style="text-align:right;">
                                ${saBadge('ALTA PENDIENTE', '#58a6ff')}
                                <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px;">
                                    ${r.createdAt ? new Date(r.createdAt.seconds ? r.createdAt.seconds*1000 : r.createdAt).toLocaleDateString('es-ES') : '—'}
                                </div>
                            </div>
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:0.5rem;
                                    background:rgba(255,255,255,0.03); padding:0.7rem; border-radius:8px;
                                    margin-bottom:1rem; border:1px solid rgba(255,255,255,0.05);">
                            <div style="font-size:0.78rem; color:var(--text-muted);">
                                📋 Directores: <strong style="color:var(--text);">${r.requestedQuotas?.directors || 0}</strong>
                            </div>
                            <div style="font-size:0.78rem; color:var(--text-muted);">
                                🎯 Coordinadores: <strong style="color:var(--text);">${r.requestedQuotas?.coordinators || 0}</strong>
                            </div>
                            <div style="font-size:0.78rem; color:var(--text-muted);">
                                ⚽ Entrenadores: <strong style="color:var(--text);">${r.requestedQuotas?.coaches || 0}</strong>
                            </div>
                            <div style="font-size:0.78rem; color:var(--text-muted);">
                                👨‍👩‍👧 Padres: <strong style="color:var(--text);">${r.requestedQuotas?.parents || 0}</strong>
                            </div>
                        </div>
                        <div style="display:flex; gap:0.65rem;">
                            <button class="sa-btn"
                                onclick="saApproveClubRequest('${r._id}','${(r.requestedClubName||'').replace(/'/g,"\\'")}','${r.email}',${r.requestedQuotas?.directors||0},${r.requestedQuotas?.coordinators||0},${r.requestedQuotas?.coaches||0},${r.requestedQuotas?.parents||0})"
                                style="flex:2; color:#3fb950; border-color:rgba(63,185,80,0.4); background:rgba(63,185,80,0.08); font-weight:700; padding:0.6rem;">
                                ✅ Autorizar Club y Admin
                            </button>
                            <button class="sa-btn" onclick="saRejectClubRequest('${r._id}')"
                                style="flex:1; color:#ff5858; border-color:rgba(255,88,88,0.4); background:rgba(255,88,88,0.08); font-weight:700;">
                                ❌ Rechazar
                            </button>
                        </div>
                    </div>
                </div>`).join('')}
            </div>
        </section>`;
    }

    // ── SECCIÓN B: USUARIOS INDIVIDUALES ────────────────────────────
    if (indivReqs.length) {
        html += `
        <section>
            <h3 style="font-size:0.9rem; margin:0 0 1rem; color:#79c0ff; display:flex; align-items:center; gap:0.6rem;">
                <span style="background:rgba(121,192,255,0.15); padding:4px 8px; border-radius:6px;">👤</span>
                Solicitudes de Usuario Individual (${indivReqs.length})
            </h3>
            <div style="display:grid; gap:0.8rem;">
            ${indivReqs.map(r => `
                <div class="sa-card" style="border-color:rgba(121,192,255,0.3); background:rgba(121,192,255,0.03);">
                    <div style="padding:1rem;">
                        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:0.8rem;">
                            <div>
                                <div style="font-weight:700; font-size:1.05rem; color:var(--text);">
                                    ${r.displayName || r.firstName + ' ' + r.lastName || 'Sin nombre'}
                                </div>
                                <div style="font-size:0.8rem; color:#79c0ff;">📧 ${r.email}</div>
                                <div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">
                                    Se creará su club personal: <em>"${r.displayName || (r.firstName + ' ' + r.lastName) || r.email}"</em>
                                </div>
                            </div>
                            <div style="text-align:right;">
                                ${saBadge('INDIVIDUAL PENDIENTE', '#79c0ff')}
                                <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px;">
                                    ${r.createdAt ? new Date(r.createdAt.seconds ? r.createdAt.seconds*1000 : r.createdAt).toLocaleDateString('es-ES') : '—'}
                                </div>
                            </div>
                        </div>
                        <!-- Asignar precio antes de aprobar -->
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;
                                    background:rgba(255,255,255,0.03); padding:0.7rem; border-radius:8px;
                                    margin-bottom:1rem; border:1px solid rgba(255,255,255,0.05);">
                            <div>
                                <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">Plan</label>
                                <select class="sa-input" id="iplan-${r._id}" style="font-size:0.78rem; padding:0.3rem 0.5rem;">
                                    <option value="trial">⏳ Prueba</option>
                                    <option value="monthly">📅 Mensual</option>
                                    <option value="annual">📆 Anual</option>
                                    <option value="free">🆓 Gratis</option>
                                </select>
                            </div>
                            <div>
                                <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">Precio (€/mes)</label>
                                <input class="sa-input" id="iprice-${r._id}" type="number" min="0"
                                    placeholder="ej: 9" style="font-size:0.78rem; padding:0.3rem 0.5rem;">
                            </div>
                        </div>
                        <div style="display:flex; gap:0.65rem;">
                            <button class="sa-btn"
                                onclick="saApproveIndividualRequest('${r._id}','${(r.displayName || r.email).replace(/'/g,"\\'")}','${r.email}')"
                                style="flex:2; color:#3fb950; border-color:rgba(63,185,80,0.4); background:rgba(63,185,80,0.08); font-weight:700; padding:0.6rem;">
                                ✅ Autorizar Usuario Individual
                            </button>
                            <button class="sa-btn" onclick="saRejectIndividualRequest('${r._id}')"
                                style="flex:1; color:#ff5858; border-color:rgba(255,88,88,0.4); background:rgba(255,88,88,0.08); font-weight:700;">
                                ❌ Rechazar
                            </button>
                        </div>
                    </div>
                </div>`).join('')}
            </div>
        </section>`;
    }

    // ── SECCIÓN C: SOLICITUDES DE BAJA ──────────────────────────────
    if (delReqs.length) {
        html += `
        <section>
            <h3 style="font-size:0.9rem; margin:0 0 1rem; color:#f0883e; display:flex; align-items:center; gap:0.6rem;">
                <span style="background:rgba(240,136,62,0.15); padding:4px 8px; border-radius:6px;">❌</span>
                Solicitudes de Baja de Usuario (${delReqs.length})
            </h3>
            <div style="display:grid; gap:0.8rem;">
            ${delReqs.map(r => `
                <div class="sa-card" style="border-color:rgba(240,136,62,0.3); background:rgba(240,136,62,0.03);">
                    <div style="padding:1rem;">
                        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:0.8rem;">
                            <div>
                                <div style="font-weight:700; font-size:1.05rem; color:var(--text);">${r.userEmail || r.userId}</div>
                                <div style="font-size:0.8rem; color:#f0883e;">Solicitado por: ${r.requestedByEmail || r.requestedBy}</div>
                            </div>
                            <div style="text-align:right;">
                                ${saBadge('BAJA PENDIENTE', '#f0883e')}
                                <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px;">
                                    ${r.createdAt ? new Date(r.createdAt).toLocaleDateString('es-ES') : '—'}
                                </div>
                            </div>
                        </div>
                        ${r.reason ? `
                        <div style="font-size:0.82rem; color:var(--text-muted); background:rgba(0,0,0,0.2);
                                    padding:0.7rem; border-radius:8px; margin-bottom:1rem; border:1px solid rgba(255,255,255,0.05);">
                            <strong>Motivo:</strong> ${r.reason}
                        </div>` : ''}
                        <div style="display:flex; gap:0.65rem;">
                            <button class="sa-btn" onclick="saResolve('${r._id}','${r.userId}','${r.clubId||''}',true)"
                                style="flex:2; color:#3fb950; border-color:rgba(63,185,80,0.4); background:rgba(63,185,80,0.08); font-weight:700; padding:0.6rem;">
                                ✅ Aprobar Baja
                            </button>
                            <button class="sa-btn" onclick="saResolve('${r._id}','${r.userId}','${r.clubId||''}',false)"
                                style="flex:1; color:#ff5858; border-color:rgba(255,88,88,0.4); background:rgba(255,88,88,0.08); font-weight:700;">
                                ❌ Rechazar
                            </button>
                        </div>
                    </div>
                </div>`).join('')}
            </div>
        </section>`;
    }

    html += `</div>`;
    body.innerHTML = html;

    // ── Aprobar solicitud de club ─────────────────────────────────────
    window.saApproveClubRequest = async (uid, clubName, email, nDir, nCoord, nCoach, nParents) => {
        if (!confirm(`¿Confirmar alta del club "${clubName}"?`)) return;
        try {
            const id = clubName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').substring(0,28)
                + '-' + Date.now().toString(36).slice(-4);

            await saWrite('clubs', id, {
                name: clubName, adminEmail: email, status: 'active',
                plan: 'trial', price: 0,
                slots: {
                    directors:    parseInt(nDir)    || 10,
                    coordinators: parseInt(nCoord)  || 10,
                    users:        parseInt(nCoach)  || 20,
                    parents:      parseInt(nParents)|| 50,
                },
                usedSlots: { directors: 1, coordinators: 0, users: 0, parents: 0 },
                createdAt: new Date().toISOString(),
            }, false);

            await saUpd('users', uid, {
                isAuthorized: true, role: 'club_admin',
                clubId: id, status: 'active',
                authorizedAt: new Date().toISOString(),
            });

            showToast(`✅ Club "${clubName}" autorizado`, 4000);
            saRequests();
        } catch(e) {
            console.error(e);
            showToast('❌ Error: ' + e.message, 5000);
        }
    };

    // ── Rechazar solicitud de club ────────────────────────────────────
    window.saRejectClubRequest = async (uid) => {
        if (!confirm('¿Rechazar esta solicitud de club? El usuario no será autorizado.')) return;
        try {
            await saUpd('users', uid, {
                requestedRole: 'rejected', isAuthorized: false,
                status: 'rejected', rejectedAt: new Date().toISOString(),
            });
            showToast('❌ Solicitud rechazada', 3000);
            saRequests();
        } catch(e) { showToast('❌ Error: ' + e.message, 4000); }
    };

    // ── Aprobar usuario individual ────────────────────────────────────
    window.saApproveIndividualRequest = async (uid, displayName, email) => {
        if (!confirm(`¿Autorizar a "${displayName}" como usuario individual?`)) return;
        try {
            const plan  = document.getElementById(`iplan-${uid}`)?.value  || 'trial';
            const price = parseFloat(document.getElementById(`iprice-${uid}`)?.value) || 0;

            // Generar ID de club personal
            const clubId = 'ind-' + uid.substring(0,12);
            const clubName = displayName;

            // Crear el club personal del usuario individual
            await saWrite('clubs', clubId, {
                name:        clubName,
                adminEmail:  email,
                type:        'individual',
                status:      'active',
                plan:        plan,
                price:       price,
                slots:       { directors: 0, coordinators: 0, users: 1, parents: 30 },
                usedSlots:   { directors: 0, coordinators: 0, users: 1, parents: 0 },
                createdAt:   new Date().toISOString(),
            }, false);

            // Autorizar al usuario
            await saUpd('users', uid, {
                isAuthorized: true,
                role:         'individual',
                clubId:       clubId,
                clubName:     clubName,
                plan:         plan,
                price:        price,
                status:       'active',
                authorizedAt: new Date().toISOString(),
            });

            showToast(`✅ "${displayName}" autorizado como usuario individual`, 4000);
            saRequests();
        } catch(e) {
            console.error(e);
            showToast('❌ Error: ' + e.message, 5000);
        }
    };

    // ── Rechazar usuario individual ───────────────────────────────────
    window.saRejectIndividualRequest = async (uid) => {
        if (!confirm('¿Rechazar esta solicitud de usuario individual?')) return;
        try {
            await saUpd('users', uid, {
                isAuthorized: false,
                status:       'rejected',
                rejectedAt:   new Date().toISOString(),
            });
            showToast('❌ Solicitud rechazada', 3000);
            saRequests();
        } catch(e) { showToast('❌ Error: ' + e.message, 4000); }
    };

    // ── Aprobar/Rechazar baja ─────────────────────────────────────────
    window.saResolve = async (reqId, userId, clubId, approve) => {
        try {
            await updateDoc(doc(db, 'deletion_requests', reqId), {
                status: approve ? 'approved' : 'rejected',
                resolvedAt: new Date().toISOString(),
            });
            if (approve) {
                const userSnap = await getDoc(doc(db, 'users', userId));
                const ur = userSnap.data()?.role || 'user';
                await updateDoc(doc(db, 'users', userId), {
                    isAuthorized: false, status: 'removed',
                    removedAt: new Date().toISOString(),
                });
                if (clubId) {
                    const cs = await getDoc(doc(db, 'clubs', clubId));
                    if (cs.exists()) {
                        const ud = cs.data().usedSlots || {};
                        const k  = ur==='director'?'directors':ur==='coordinator'?'coordinators':ur==='parent'?'parents':'users';
                        await updateDoc(doc(db,'clubs',clubId), { [`usedSlots.${k}`]: Math.max(0,(ud[k]||1)-1) });
                    }
                }
            }
            showToast(approve ? '✅ Baja aprobada' : '❌ Solicitud rechazada', 3000);
            saRequests();
        } catch(e) { showToast('❌ Error: ' + e.message, 4000); }
    };
}


// ── Historial de pagos ────────────────────────────────────────────────
async function saOpenPaymentHistory(id, type) {
    const item = await saGet(type === 'club' ? 'clubs' : 'users', id);
    if (!item) return;
    const name    = item.name || item.email || id;
    const history = item.paymentHistory || [];
    const body    = document.getElementById('sa-body');

    const METHOD_LABELS = {
        bizum:    '📱 Bizum',
        transfer: '🏦 Transferencia',
        cash:     '💵 Efectivo',
    };

    // Total cobrado
    const total = history.reduce((s, p) => s + (parseFloat(p.amount)||0), 0);

    body.innerHTML = `
        <div style="max-width:600px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.2rem;">
                <button onclick="saTab('payments')" class="sa-btn"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                    ← Volver</button>
                <h3 style="margin:0;font-size:1rem;">📋 Historial de pagos — ${name}</h3>
            </div>

            <!-- Resumen -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;margin-bottom:1.2rem;">
                <div class="sa-stat">
                    <div class="sa-stat-n" style="color:#3fb950;">${history.length}</div>
                    <div class="sa-stat-l">Pagos registrados</div>
                </div>
                <div class="sa-stat">
                    <div class="sa-stat-n" style="color:#58a6ff;">${total.toFixed(0)}€</div>
                    <div class="sa-stat-l">Total cobrado</div>
                </div>
                <div class="sa-stat">
                    <div class="sa-stat-n" style="color:#f0883e;">${item.price||'—'}€</div>
                    <div class="sa-stat-l">Precio/mes actual</div>
                </div>
            </div>

            ${history.length === 0 ? `
                <p style="color:var(--text-muted);text-align:center;padding:2rem;">
                    Sin pagos registrados aún.</p>` :
                history.map((p, i) => `
                <div class="sa-card" style="padding:0.7rem 1rem;margin-bottom:0.4rem;">
                    <div class="sa-row">
                        <div>
                            <span style="font-weight:700;font-size:0.92rem;">${METHOD_LABELS[p.method]||p.method}</span>
                            <span style="margin-left:0.6rem;font-size:0.88rem;color:#3fb950;font-weight:700;">
                                ${p.amount}€</span>
                            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;">
                                📅 ${new Date(p.date).toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'})}
                                ${p.notes?` · 📝 ${p.notes}`:''}
                            </div>
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">
                            #${history.length - i}
                        </div>
                    </div>
                </div>`).join('')
            }
        </div>`;
}

// ════════════════════════════════════════════════════════════════════
//  TAB: SOLICITUDES DE BAJA
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
//  TAB: NUEVO CLUB
// ════════════════════════════════════════════════════════════════════
function saNewClub() {
    document.getElementById('sa-body').innerHTML = `
        <div style="max-width:540px;">
          <h3 style="margin:0 0 1rem;font-size:1rem;">➕ Crear nuevo club</h3>
          <div style="display:flex;flex-direction:column;gap:0.7rem;">
            <div><label class="sa-label">Nombre del club *</label>
                <input class="sa-input" id="nc-name" placeholder="ej: CD Deportivo Ejemplo"></div>
            <div><label class="sa-label">Email del administrador (1 único, contacto directo) *</label>
                <input class="sa-input" id="nc-admin" type="email" placeholder="admin@club.com"></div>
            <div class="sa-g4" style="margin-bottom:0.7rem;">
                <div><label class="sa-label">Slots Directores (-1=∞)</label>
                    <input class="sa-input" id="nc-dir" type="number" value="-1"></div>
                <div><label class="sa-label">Slots Coordinadores (-1=∞)</label>
                    <input class="sa-input" id="nc-coord" type="number" value="-1"></div>
                <div><label class="sa-label">Slots Entrenadores (-1=∞)</label>
                    <input class="sa-input" id="nc-users" type="number" value="-1"></div>
                <div><label class="sa-label">Slots Padres (-1=∞)</label>
                    <input class="sa-input" id="nc-parents" type="number" value="-1"></div>
            </div>
            <div class="sa-g3">
                <div><label class="sa-label">Plan inicial</label>
                    <select class="sa-input" id="nc-plan">
                        ${Object.entries(PLAN_META).filter(([k])=>!['monthly','annual'].includes(k))
                          .map(([k,v])=>`<option value="${k}" ${k==='trial'?'selected':''}>${v.label}</option>`).join('')}
                    </select></div>
                <div><label class="sa-label">Precio €/mes</label>
                    <input class="sa-input" id="nc-price" type="number" placeholder="0"></div>
                <div><label class="sa-label">Expira (vacío=sin límite)</label>
                    <input class="sa-input" id="nc-exp" type="date"></div>
            </div>
            <div><label class="sa-label">Notas internas</label>
                <textarea class="sa-input" id="nc-notes" rows="2" style="resize:vertical;"
                    placeholder="Plan acordado, observaciones…"></textarea></div>
            <div style="background:rgba(88,166,255,0.05);border:1px solid rgba(88,166,255,0.2);
                        border-radius:8px;padding:0.7rem 1rem;font-size:0.79rem;color:var(--text-muted);">
                💡 Al crear el club, el admin deberá registrarse en la app con ese email.
                Tendrá rol <strong>club_admin</strong> y podrá dar de alta a sus usuarios.
            </div>
            <button onclick="saDoCreateClub()" class="sa-btn"
                style="padding:0.65rem;color:#3fb950;border-color:rgba(63,185,80,0.4);
                       background:rgba(63,185,80,0.1);font-weight:700;font-size:0.9rem;">
                ➕ Crear Club</button>
            <div id="nc-msg" style="font-size:0.82rem;text-align:center;min-height:1rem;"></div>
          </div>
        </div>`;

    window.saDoCreateClub = async () => {
        const msg  = document.getElementById('nc-msg');
        const name = document.getElementById('nc-name').value.trim();
        const adm  = document.getElementById('nc-admin').value.trim();
        if (!name||!adm) { msg.style.color='#ff5858'; msg.textContent='⚠️ Nombre y email obligatorios.'; return; }
        msg.style.color='var(--primary)'; msg.textContent='Creando…';
        const id = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
            .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').substring(0,28)
            + '-' + Date.now().toString(36).slice(-4);
        await saWrite('clubs', id, {
            name, adminEmail: adm, status:'active',
            plan:   document.getElementById('nc-plan').value,
            price:  parseFloat(document.getElementById('nc-price').value)||null,
            slots: {
                directors:    +document.getElementById('nc-dir').value   || -1,
                coordinators: +document.getElementById('nc-coord').value || -1,
                users:        +document.getElementById('nc-users').value || -1,
                parents:      +document.getElementById('nc-parents').value || -1,
            },
            usedSlots: { directors:0, coordinators:0, users:0, parents:0 },
            expiresAt: document.getElementById('nc-exp').value||null,
            notes:     document.getElementById('nc-notes').value.trim(),
            features:  { live_view:true, ai_import:true },
            createdAt: new Date().toISOString(),
        }, false);
        msg.style.color='#3fb950'; msg.textContent=`✅ Club "${name}" creado (ID: ${id})`;
        showToast(`✅ Club "${name}" creado`, 4000);
        ['nc-name','nc-admin','nc-exp','nc-notes'].forEach(i => {
            const el=document.getElementById(i); if(el) el.value='';
        });
    };
}

// ════════════════════════════════════════════════════════════════════
//  TAB: PENDIENTES — Activación de usuarios con ✅ palomilla
// ════════════════════════════════════════════════════════════════════
async function saPending() {
    const body = document.getElementById('sa-body');
    body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:3rem;">⏳ Cargando usuarios pendientes…</p>';

    const [clubs, users] = await Promise.all([saGetAll('clubs'), saGetAll('users')]);
    const clubMap = {};
    clubs.forEach(c => { clubMap[c._id] = c.name || c._id; });

    // Usuarios pendientes: isAuthorized=false, no son SA/admin, no son club_admin ni individual (esos van a Solicitudes)
    const pending = users.filter(u =>
        !u.isAuthorized &&
        !['superadmin','admin'].includes(u.role) &&
        !['superadmin','admin','club_admin','individual','rejected'].includes(u.requestedRole) &&
        u.status !== 'rejected' &&
        u.status !== 'removed'
    );

    // Agrupar por club
    const byClub = {};
    pending.forEach(u => {
        const cid   = u.clubId || '_sin_club';
        const cname = clubMap[cid] || (cid === '_sin_club' ? '⚠️ Sin club asignado' : cid);
        if (!byClub[cid]) byClub[cid] = { name: cname, users: [] };
        byClub[cid].users.push(u);
    });

    if (!pending.length) {
        body.innerHTML = `
        <div style="text-align:center;padding:5rem 2rem;opacity:0.7;">
            <div style="font-size:3rem;margin-bottom:1rem;">✅</div>
            <div style="font-size:1.05rem;font-weight:600;">Sin usuarios pendientes</div>
            <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.4rem;">
                Todos los usuarios registrados están activos o en Solicitudes.</div>
        </div>`;
        return;
    }

    const ROLE_LABELS = {
        director:    '📋 Director Dep.',
        coordinator: '🎯 Coordinador',
        user:        '⚽ Entrenador',
        parent:      '👨‍👩‍👧 Padre/Madre',
        individual:  '👤 Individual',
    };

    let html = `
    <div style="margin-bottom:1.2rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
        <h3 style="margin:0;font-size:0.95rem;">
            🔔 Usuarios pendientes de activación —
            <span style="color:#3fb950;">${pending.length} total</span>
        </h3>
        <button onclick="saActivateAll()" class="sa-btn"
            style="color:#3fb950;border-color:rgba(63,185,80,0.4);background:rgba(63,185,80,0.1);font-weight:700;">
            ✅ Activar todos</button>
    </div>`;

    Object.entries(byClub).forEach(([cid, club]) => {
        html += `
        <div class="sa-card expanded" style="border-color:rgba(88,166,255,0.25);margin-bottom:1rem;">
            <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')">
                <div class="sa-card-title">
                    <span class="sa-chevron">▼</span>
                    🏟️ ${club.name}
                    <span class="sa-badge" style="background:rgba(255,165,0,0.15);color:#ffa500;">
                        ${club.users.length} pendiente${club.users.length!==1?'s':''}
                    </span>
                </div>
                <button onclick="event.stopPropagation();saActivateClub('${cid}')" class="sa-btn"
                    style="font-size:0.71rem;color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.07);">
                    ✅ Activar todos del club</button>
            </div>
            <div class="sa-card-body">
                ${club.users.map(u => {
                    const roleLabel = ROLE_LABELS[u.requestedRole || u.role] || u.requestedRole || '—';
                    const since     = u.createdAt
                        ? new Date(u.createdAt.seconds ? u.createdAt.seconds*1000 : u.createdAt)
                            .toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit'})
                        : '—';
                    return `
                    <div class="sa-urow" style="padding:0.5rem 0.6rem;margin-bottom:0.35rem;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.84rem;font-weight:600;">${u.email}</div>
                            <div style="font-size:0.71rem;color:var(--text-muted);margin-top:1px;">
                                ${roleLabel}
                                ${u.displayName ? ` · ${u.displayName}` : ''}
                                · Registro: ${since}
                            </div>
                        </div>
                        <div style="display:flex;gap:0.35rem;flex-shrink:0;align-items:center;">
                            <select id="role-sel-${u._id}" class="sa-input"
                                style="font-size:0.72rem;padding:0.25rem 0.4rem;width:140px;">
                                <option value="user"        ${(u.requestedRole||u.role)==='user'        ?'selected':''}>⚽ Entrenador</option>
                                <option value="parent"      ${(u.requestedRole||u.role)==='parent'      ?'selected':''}>👨‍👩‍👧 Padre/Madre</option>
                                <option value="coordinator" ${(u.requestedRole||u.role)==='coordinator' ?'selected':''}>🎯 Coordinador</option>
                                <option value="director"    ${(u.requestedRole||u.role)==='director'    ?'selected':''}>📋 Director Dep.</option>
                            </select>
                            <button onclick="saActivateUser('${u._id}','${(u.email||'').replace(/'/g,"\'")}','${cid}')"
                                class="sa-btn"
                                style="color:#3fb950;border-color:rgba(63,185,80,0.4);background:rgba(63,185,80,0.1);
                                       font-weight:700;font-size:0.8rem;padding:0.3rem 0.75rem;">
                                ✅</button>
                            <button onclick="saRejectPending('${u._id}','${(u.email||'').replace(/'/g,"\'")}' )"
                                class="sa-btn"
                                style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);
                                       font-size:0.8rem;padding:0.3rem 0.6rem;">
                                ✕</button>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    });

    body.innerHTML = html;

    // ── Activar un usuario ──────────────────────────────────────────
    window.saActivateUser = async (uid, email, clubId) => {
        const role = document.getElementById(`role-sel-${uid}`)?.value || 'user';
        if (!confirm(`¿Activar a ${email} como ${role}?`)) return;
        try {
            // Actualizar usuario
            await saUpd('users', uid, {
                isAuthorized: true,
                role,
                status:       'active',
                authorizedAt: new Date().toISOString(),
                authorizedBy: window._cronosCurrentUser.uid,
            });

            // Actualizar contador de slots del club
            if (clubId && clubId !== '_sin_club') {
                const club = await saGet('clubs', clubId);
                if (club) {
                    const k   = role==='director'?'usedSlots.directors':role==='coordinator'?'usedSlots.coordinators':role==='parent'?'usedSlots.parents':'usedSlots.users';
                    const cur = club.usedSlots?.[k.split('.')[1]] || 0;
                    await saUpd('clubs', clubId, { [k]: cur + 1 });
                }
            }

            showToast(`✅ ${email} activado como ${role}`, 3000);
            saPending();
        } catch(e) {
            showToast('❌ Error: ' + e.message, 4000);
        }
    };

    // ── Rechazar un usuario pendiente ──────────────────────────────
    window.saRejectPending = async (uid, email) => {
        if (!confirm(`¿Rechazar y desactivar la cuenta de ${email}?`)) return;
        try {
            await saUpd('users', uid, {
                isAuthorized: false,
                status:       'rejected',
                rejectedAt:   new Date().toISOString(),
            });
            showToast(`❌ ${email} rechazado`, 3000);
            saPending();
        } catch(e) {
            showToast('❌ Error: ' + e.message, 4000);
        }
    };

    // ── Activar todos los usuarios de un club ──────────────────────
    window.saActivateClub = async (clubId) => {
        const clubUsers = byClub[clubId]?.users || [];
        if (!clubUsers.length) return;
        if (!confirm(`¿Activar a los ${clubUsers.length} usuarios pendientes del club "${byClub[clubId]?.name}"?`)) return;
        let ok = 0;
        for (const u of clubUsers) {
            const role = document.getElementById(`role-sel-${u._id}`)?.value || u.requestedRole || 'user';
            try {
                await saUpd('users', u._id, {
                    isAuthorized: true, role, status: 'active',
                    authorizedAt: new Date().toISOString(),
                    authorizedBy: window._cronosCurrentUser.uid,
                });
                ok++;
            } catch(e) { console.error(e); }
        }
        showToast(`✅ ${ok} usuarios activados`, 3000);
        saPending();
    };

    // ── Activar TODOS de todos los clubes ──────────────────────────
    window.saActivateAll = async () => {
        if (!confirm(`¿Activar a TODOS los ${pending.length} usuarios pendientes con sus roles por defecto?`)) return;
        let ok = 0;
        for (const u of pending) {
            const role = u.requestedRole || u.role || 'user';
            try {
                await saUpd('users', u._id, {
                    isAuthorized: true, role, status: 'active',
                    authorizedAt: new Date().toISOString(),
                    authorizedBy: window._cronosCurrentUser.uid,
                });
                ok++;
            } catch(e) { console.error(e); }
        }
        showToast(`✅ ${ok} usuarios activados de golpe`, 4000);
        saPending();
    };
}

// ════════════════════════════════════════════════════════════════════
//  TAB: TARIFAS — Gestión de precios por tipo de cuenta
// ════════════════════════════════════════════════════════════════════
async function saTariffs() {
    const [clubTariff, indivTariff] = await Promise.all([
        saGet('tariffs', 'club').catch(() => null),
        saGet('tariffs', 'individual').catch(() => null),
    ]);
    const ct = clubTariff  || {};
    const it = indivTariff || {};

    document.getElementById('sa-body').innerHTML = `
    <div style="max-width:660px;">
      <h3 style="margin:0 0 0.3rem; font-size:1rem;">💰 Gestión de Tarifas</h3>
      <p style="font-size:0.8rem; color:var(--text-muted); margin:0 0 1.5rem;">
        Define los precios base globales. Puedes sobrescribir el precio de cada cuenta
        individualmente desde las pestañas <strong>Clubes</strong> e <strong>Individuales</strong>.
      </p>

      <!-- ── Tarifa Club ── -->
      <div class="sa-card expanded" style="border-color:rgba(88,166,255,0.3); margin-bottom:1rem;">
        <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')" style="cursor:pointer;">
          <div class="sa-card-title">
            <span class="sa-chevron">▼</span> 🏟️ Tarifa Base — Clubes
          </div>
          <div style="font-size:0.78rem; color:var(--text-muted);">
            ${ct.monthly != null ? ct.monthly + '€/mes' : 'Sin precio definido'}
            ${ct.annual  != null ? ' · ' + ct.annual + '€/año' : ''}
          </div>
        </div>
        <div class="sa-card-body" style="padding-top:0.8rem;">
          <div class="sa-g2" style="margin-bottom:0.7rem;">
            <div><label class="sa-label">Precio mensual (€)</label>
              <input class="sa-input" id="ct-monthly" type="number" min="0"
                value="${ct.monthly ?? ''}" placeholder="ej: 29"></div>
            <div><label class="sa-label">Precio anual (€)</label>
              <input class="sa-input" id="ct-annual" type="number" min="0"
                value="${ct.annual ?? ''}" placeholder="ej: 299"></div>
          </div>
          <div style="margin-bottom:0.7rem;">
            <label class="sa-label">Descripción / Qué incluye</label>
            <textarea class="sa-input" id="ct-desc" rows="2" style="resize:vertical;"
              placeholder="ej: Hasta 5 equipos, IA, Live View, padres…">${ct.description || ''}</textarea>
          </div>
          <div class="sa-g4" style="margin-bottom:0.7rem;">
            <div><label class="sa-label">Slots Directores (-1=∞)</label>
              <input class="sa-input" id="ct-dir"    type="number" value="${ct.defaultSlots?.directors    ?? -1}"></div>
            <div><label class="sa-label">Slots Coordinadores (-1=∞)</label>
              <input class="sa-input" id="ct-coord"  type="number" value="${ct.defaultSlots?.coordinators ?? -1}"></div>
            <div><label class="sa-label">Slots Entrenadores (-1=∞)</label>
              <input class="sa-input" id="ct-coaches" type="number" value="${ct.defaultSlots?.coaches     ?? -1}"></div>
            <div><label class="sa-label">Slots Padres (-1=∞)</label>
              <input class="sa-input" id="ct-parents" type="number" value="${ct.defaultSlots?.parents     ?? -1}"></div>
          </div>
          <button onclick="saveTariff('club')" class="sa-btn"
            style="color:#58a6ff; border-color:rgba(88,166,255,0.4);
                   background:rgba(88,166,255,0.1); font-weight:700; padding:0.5rem 1.2rem;">
            💾 Guardar tarifa de clubes</button>
          <div id="ct-msg" style="font-size:0.8rem; margin-top:0.4rem; min-height:1rem;"></div>
        </div>
      </div>

      <!-- ── Tarifa Individual ── -->
      <div class="sa-card expanded" style="border-color:rgba(121,192,255,0.3); margin-bottom:1rem;">
        <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')" style="cursor:pointer;">
          <div class="sa-card-title">
            <span class="sa-chevron">▼</span> 👤 Tarifa Base — Usuarios Individuales
          </div>
          <div style="font-size:0.78rem; color:var(--text-muted);">
            ${it.monthly != null ? it.monthly + '€/mes' : 'Sin precio definido'}
            ${it.annual  != null ? ' · ' + it.annual + '€/año' : ''}
          </div>
        </div>
        <div class="sa-card-body" style="padding-top:0.8rem;">
          <div class="sa-g2" style="margin-bottom:0.7rem;">
            <div><label class="sa-label">Precio mensual (€)</label>
              <input class="sa-input" id="it-monthly" type="number" min="0"
                value="${it.monthly ?? ''}" placeholder="ej: 9"></div>
            <div><label class="sa-label">Precio anual (€)</label>
              <input class="sa-input" id="it-annual" type="number" min="0"
                value="${it.annual ?? ''}" placeholder="ej: 89"></div>
          </div>
          <div style="margin-bottom:0.7rem;">
            <label class="sa-label">Descripción / Qué incluye</label>
            <textarea class="sa-input" id="it-desc" rows="2" style="resize:vertical;"
              placeholder="ej: 1 equipo, IA, sin Live View…">${it.description || ''}</textarea>
          </div>
          <div class="sa-g2" style="margin-bottom:0.7rem;">
            <div><label class="sa-label">Slots Padres/Madres (-1=∞)</label>
              <input class="sa-input" id="it-parents" type="number" value="${it.defaultSlots?.parents ?? 30}"></div>
            <div><label class="sa-label">Período de prueba (días)</label>
              <input class="sa-input" id="it-trial" type="number" value="${it.trialDays ?? 30}" placeholder="30"></div>
          </div>
          <button onclick="saveTariff('individual')" class="sa-btn"
            style="color:#79c0ff; border-color:rgba(121,192,255,0.4);
                   background:rgba(121,192,255,0.1); font-weight:700; padding:0.5rem 1.2rem;">
            💾 Guardar tarifa individual</button>
          <div id="it-msg" style="font-size:0.8rem; margin-top:0.4rem; min-height:1rem;"></div>
        </div>
      </div>

      <!-- ── Resumen ── -->
      <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08);
                  border-radius:10px; padding:1rem 1.2rem; font-size:0.82rem;">
        <div style="font-weight:700; color:var(--text-muted); margin-bottom:0.5rem; font-size:0.73rem;">
          📊 RESUMEN ACTUAL</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; color:var(--text-muted);">
          <div>🏟️ Tarifa club mensual:
            <strong style="color:var(--text);">${ct.monthly != null ? ct.monthly + '€' : '—'}</strong></div>
          <div>🏟️ Tarifa club anual:
            <strong style="color:var(--text);">${ct.annual  != null ? ct.annual  + '€' : '—'}</strong></div>
          <div>👤 Tarifa individual mensual:
            <strong style="color:var(--text);">${it.monthly != null ? it.monthly + '€' : '—'}</strong></div>
          <div>👤 Tarifa individual anual:
            <strong style="color:var(--text);">${it.annual  != null ? it.annual  + '€' : '—'}</strong></div>
        </div>
      </div>
    </div>`;

    window.saveTariff = async (type) => {
        const isClub = (type === 'club');
        const pfx    = isClub ? 'ct' : 'it';
        const msg    = document.getElementById(`${pfx}-msg`);
        msg.style.color = 'var(--primary)'; msg.textContent = 'Guardando…';

        const data = {
            type,
            monthly:     parseFloat(document.getElementById(`${pfx}-monthly`).value) || 0,
            annual:      parseFloat(document.getElementById(`${pfx}-annual`).value)  || 0,
            description: document.getElementById(`${pfx}-desc`).value.trim(),
            updatedAt:   new Date().toISOString(),
        };

        if (isClub) {
            data.defaultSlots = {
                directors:    parseInt(document.getElementById('ct-dir').value)     || -1,
                coordinators: parseInt(document.getElementById('ct-coord').value)   || -1,
                coaches:      parseInt(document.getElementById('ct-coaches').value) || -1,
                parents:      parseInt(document.getElementById('ct-parents').value) || -1,
            };
        } else {
            data.defaultSlots = { parents: parseInt(document.getElementById('it-parents').value) || 30 };
            data.trialDays    = parseInt(document.getElementById('it-trial').value) || 30;
        }

        try {
            await saWrite('tariffs', type, data, false);
            msg.style.color  = '#3fb950';
            msg.textContent  = '✅ Tarifa guardada correctamente';
            showToast(`✅ Tarifa ${isClub ? 'de clubes' : 'individual'} actualizada`, 3000);
            setTimeout(() => saTariffs(), 1600);
        } catch(e) {
            msg.style.color  = '#ff5858';
            msg.textContent  = '❌ Error: ' + e.message;
        }
    };
}


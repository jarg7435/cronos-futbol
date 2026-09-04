// ══════════════════════════════════════════════════════════════════
// CHRONOS FUTBOL — SHARED: ADMIN CONSTANTS
// ROLE_META y SA_CSS compartidos entre superadmin, club_admin e individual_admin
// Este archivo DEBE cargarse antes que los paneles de administracion
// ══════════════════════════════════════════════════════════════════

window.ROLE_META = {
    superadmin:  { label:'Superadministrador',    icon:'👑', color:'#ffd700' },
    admin:       { label:'Administrador',          icon:'⚙️',  color:'#58a6ff' },
    club_admin:  { label:'Admin de Club',          icon:'🏟️', color:'#58a6ff' },
    director:    { label:'Director Deportivo',     icon:'📋', color:'#f0883e' },
    coordinator: { label:'Coordinador',            icon:'🎯', color:'#d2a8ff' },
    user:        { label:'Entrenador',             icon:'⚽', color:'#3fb950' },
    parent:      { label:'Familiar / Jugador',     icon:'👨‍👩‍👧', color:'#79c0ff' },
    individual:  { label:'Administrador Individual',  icon:'⚙️', color:'#58a6ff' },  // auth.js uses 'individual' for admin individual
    'admin_individual':  { label:'Administrador Individual',  icon:'⚙️', color:'#58a6ff' },
    'entrenador_individual': { label:'Entrenador Individual', icon:'⚽', color:'#3fb950' },
    'parent_individual': { label:'Familiar / Jugador Individual', icon:'👨‍👩‍👧', color:'#79c0ff' },
};


// ══════════════════════════════════════════════════════════════════
//  Movido desde js/core/app-init.js el 2026-07-28 (monolito #5).
//
//  ⚠️  NO volver a declarar estos nombres con `const`/`let` en un script
//  clasico que cargue ANTES que este: una declaracion lexica de nivel
//  superior vive en el registro DECLARATIVO del ambito global, que se
//  resuelve ANTES que window, y ensombreceria estas tablas en toda lectura
//  por nombre pelado sin que ninguna guarda `typeof window.X` lo note.
//  Guardado por scripts/test_admin_shared_constants.js (parte 1).
//
//  SA_CSS es la version que VENIA APLICANDOSE de verdad (la de app-init):
//  se movio verbatim para no cambiar ni un pixel. La que habia aqui antes
//  (.sa-modal max-width:860px) no la leia nadie, porque las 5 lecturas
//  peladas de club/panel.js e individual/panel.js cogian siempre la const.
// ══════════════════════════════════════════════════════════════════

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ✏️  DATOS DEL SUPERADMINISTRADOR — Rellenar antes de publicar
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
window.SA_CONFIG = {
    nombre:      'TU_NOMBRE_O_NOMBRE_COMERCIAL',   // ej: "José · Chronos Fútbol"
    bizum:       'TU_NUMERO_BIZUM',                // ej: "612 345 678"
    iban:        'TU_IBAN',                        // ej: "ES12 3456 7890 1234 5678 9012"
    // v671 · fuera `whatsapp`: el aviso de pago va sólo por correo.
    email:       'TU_EMAIL_COMERCIAL',             // ej: "cronos@tudominio.com"
    appUrl:      'https://jarg7435.github.io/cronos-futbol/',
};

window.PLAN_META   = {
    free:     { label:'🆓 Gratis',   color:'#7d8590' },
    trial:    { label:'⏳ Prueba',   color:'#f0883e' },
    basic:    { label:'📦 Básico',   color:'#58a6ff' },
    pro:      { label:'🚀 Pro',      color:'#3fb950' },
    premium:  { label:'💎 Premium',  color:'#ffd700' },
    custom:   { label:'⚙️ Custom',   color:'#d2a8ff' },
    monthly:  { label:'📅 Mensual',  color:'#58a6ff' },
    annual:   { label:'📆 Anual',    color:'#3fb950' },
};
window.STATUS_META = {
    active:   { label:'✅ Activo',    color:'#3fb950' },
    trial:    { label:'⏳ Prueba',    color:'#f0883e' },
    overdue:  { label:'⚠️ Vencido',  color:'#ffa500' },
    blocked:  { label:'🔒 Bloqueado', color:'#ff5858' },
};

// ── Estilos del panel ────────────────────────────────────────────────
window.SA_CSS = `
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

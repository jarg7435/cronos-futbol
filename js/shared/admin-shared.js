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
    parent:      { label:'Padre / Madre / Tutor',  icon:'👨‍👩‍👧', color:'#79c0ff' },
    individual:  { label:'Administrador Individual',  icon:'⚙️', color:'#58a6ff' },  // auth.js uses 'individual' for admin individual
    'admin_individual':  { label:'Administrador Individual',  icon:'⚙️', color:'#58a6ff' },
    'entrenador_individual': { label:'Entrenador Individual', icon:'⚽', color:'#3fb950' },
    'parent_individual': { label:'Padre/Madre/Tutor Individual', icon:'👨‍👩‍👧', color:'#79c0ff' },
};

window.SA_CSS = `<style>
.sa-modal{background:#0d1117!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:16px!important;max-width:860px!important;width:98vw!important;max-height:92vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;font-family:Inter,sans-serif!important;}
.sa-topbar{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.2rem;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;flex-wrap:wrap;gap:0.5rem;}
.sa-body{flex:1;overflow-y:auto;padding:1rem 1.2rem;-webkit-overflow-scrolling:touch;}
.sa-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.8rem;}
.sa-card-head{display:flex;align-items:center;justify-content:space-between;cursor:pointer;gap:0.5rem;user-select:none;}
.sa-card-title{display:flex;align-items:center;gap:0.5rem;font-weight:700;font-size:0.88rem;color:white;}
.sa-card-body{display:none;padding-top:0.7rem;margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.1);}
.sa-card.expanded .sa-card-body{display:block;}
.sa-card.expanded .sa-chevron{transform:rotate(0deg);}
.sa-chevron{display:inline-block;transform:rotate(-90deg);transition:transform 0.2s;font-size:0.65rem;}
.sa-badge{display:inline-flex;align-items:center;padding:0.18rem 0.55rem;border-radius:20px;font-size:0.7rem;font-weight:700;background:rgba(88,166,255,0.12);color:#58a6ff;}
.sa-btn{display:inline-flex;align-items:center;gap:0.3rem;padding:0.32rem 0.65rem;border:1px solid rgba(255,255,255,0.1);border-radius:7px;background:rgba(255,255,255,0.04);color:white;font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap;}
.sa-btn:hover{filter:brightness(1.2);}
.sa-input{width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;outline:none;font-family:Inter,sans-serif;}
.sa-input:focus{border-color:#58a6ff;}
.sa-label{display:block;font-size:0.72rem;color:#8b949e;margin-bottom:0.3rem;font-weight:600;letter-spacing:0.3px;}
.sa-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0.6rem;}
.sa-stat{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.6rem;text-align:center;}
.sa-stat-n{font-size:1.3rem;font-weight:800;color:#3fb950;}
.sa-stat-l{font-size:0.65rem;color:#8b949e;margin-top:0.1rem;}
.sa-urow{display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.3rem;border-bottom:1px solid rgba(255,255,255,0.04);}
.sa-urow:last-child{border-bottom:none;}
.sa-g4{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.6rem;align-items:start;}
</style>`;

// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Staff Dashboard (Director / Coordinador) v1.0
// ════════════════════════════════════════════════════════════════════

async function openStaffDashboard() {
    const me = window._cronosCurrentUser;
    const activeRole = me?._activeRole || me?.role;
    const isSA = me?.role === 'superadmin' || me?.role === 'admin';

    if (!me || (!isSA && !['director', 'coordinator'].includes(activeRole))) {
        showToast('⚠️ No tienes permisos para acceder al panel de dirección.', 4000);
        return;
    }

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,950px);max-height:94vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;background:#0d1117;">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:1.2rem 1.5rem;background:linear-gradient(to right, #161b22, #0d1117);
                    border-bottom:1px solid var(--glass-border);flex-shrink:0;">
            <div>
                <h2 style="margin:0;font-size:1.15rem;display:flex;align-items:center;gap:0.7rem;">
                    🏢 Panel de Dirección: <span style="color:var(--primary);">${me.clubName || 'Mi Club'}</span>
                </h2>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">
                    Rol: ${activeRole === 'director' ? 'Director Deportivo' : 'Coordinador'}
                </div>
            </div>
            <div style="display:flex;gap:0.7rem;align-items:center;">
                <button onclick="location.reload()"
                    style="padding:0.45rem 0.9rem;background:rgba(255,255,255,0.05);
                           border:1px solid var(--glass-border);border-radius:8px;
                           color:white;font-size:0.78rem;cursor:pointer;">
                    🔄 Actualizar
                </button>
                <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                    style="padding:0.45rem 1rem;background:rgba(255,215,0,0.1);
                           border:1px solid rgba(255,215,0,0.3);border-radius:8px;
                           color:#ffd700;font-size:0.78rem;font-weight:700;cursor:pointer;">
                    ⇄ Cambiar Rol
                </button>
                <button onclick="logoutUser()"
                    style="padding:0.45rem 1rem;background:rgba(255,88,88,0.15);
                           border:1px solid rgba(255,88,88,0.4);border-radius:8px;
                           color:#ff5858;font-size:0.78rem;font-weight:700;cursor:pointer;">
                    🚪 SALIR
                </button>
            </div>
        </div>

        <!-- Navigation Tabs -->
        <div style="display:flex;gap:0.2rem;padding:0.5rem 1.5rem;background:#161b22;
                    border-bottom:1px solid var(--glass-border);flex-shrink:0;overflow-x:auto;">
            <button onclick="switchStaffTab('convocatorias')" class="staff-tab active" id="tab-convocatorias">📋 Convocatorias</button>
            <button onclick="switchStaffTab('entrenamientos')" class="staff-tab" id="tab-entrenamientos">🕒 Entrenamientos</button>
            <button onclick="switchStaffTab('informes')" class="staff-tab" id="tab-informes">📊 Informes</button>
            <button onclick="switchStaffTab('mensajes')" class="staff-tab" id="tab-mensajes">💬 Mensajes</button>
            <button onclick="openLiveMatchesView()" class="staff-tab" 
                style="color:#3fb950;border-left:1px solid rgba(255,255,255,0.1);margin-left:0.5rem;">🔴 En Vivo</button>
        </div>

        <!-- Content Area -->
        <div id="staff-dashboard-content" style="flex:1;overflow-y:auto;padding:1.5rem;background:#0d1117;">
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div class="spinner" style="margin:0 auto 1rem;"></div>
                Cargando información del club...
            </div>
        </div>
    </div>
    <style>
        .staff-tab {
            padding: 0.6rem 1.2rem;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--text-muted);
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
        }
        .staff-tab:hover { color: white; background: rgba(255,255,255,0.03); }
        .staff-tab.active {
            color: var(--primary);
            border-bottom-color: var(--primary);
            background: rgba(88,166,255,0.05);
        }
        .staff-event-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--glass-border);
            border-radius: 12px;
            padding: 1rem;
            margin-bottom: 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
        }
        .staff-event-badge {
            font-size: 0.65rem;
            font-weight: 700;
            padding: 2px 7px;
            border-radius: 5px;
            text-transform: uppercase;
        }
    </style>`;

    // Initial load
    switchStaffTab('convocatorias');
}

window.switchStaffTab = async (tab) => {
    // Update active tab UI
    document.querySelectorAll('.staff-tab').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`tab-${tab}`);
    if (activeBtn) activeBtn.classList.add('active');

    const container = document.getElementById('staff-dashboard-content');
    container.innerHTML = `<div style="text-align:center;padding:4rem;color:var(--text-muted);">⏳ Cargando ${tab}...</div>`;

    if (tab === 'convocatorias') await loadStaffEvents('convocatoria');
    if (tab === 'entrenamientos') await loadStaffEvents('planificacion_semanal');
    if (tab === 'informes') {
        container.innerHTML = `<div style="text-align:center;padding:2rem;">
            <p>Accediendo a la central de informes...</p>
            <button onclick="openClubReports()" class="btn primary">Abrir Central de Informes 📊</button>
        </div>`;
    }
    if (tab === 'mensajes') {
        container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">
            <div style="font-size:2rem;margin-bottom:1rem;">💬</div>
            Accediendo al canal de comunicación con entrenadores...<br>
            <button onclick="openCoachMessaging()" class="btn" style="margin-top:1rem;">Abrir Mensajería 💬</button>
        </div>`;
    }
};

async function loadStaffEvents(type) {
    const me = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    
    try {
        const { collection, getDocs, query, where, limit } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth?.db;
        if (!db) throw new Error("Base de datos no inicializada. Reintenta en unos segundos.");
        
        // Consulta simplificada sin orderBy compuesto para evitar requerir índice de Firestore
        const clubIdToQuery = me.clubId || 'demo';
        const snap = await getDocs(query(
            collection(db, 'cronos_notifications'),
            where('clubId', '==', clubIdToQuery),
            where('type', '==', type),
            limit(50)
        ));

        let html = '';
        if (snap.empty) {
            html = `<div style="text-align:center;padding:4rem;color:var(--text-muted);">
                No hay ${type}s registradas recientemente.
            </div>`;
        } else {
            snap.forEach(doc => {
                const data = doc.data();
                const date = data.createdAt ? new Date(data.createdAt).toLocaleString('es-ES', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : '—';
                
                html += `
                <div class="staff-event-card">
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.4rem;">
                            <span class="staff-event-badge" style="background:${type==='convocatoria'?'rgba(88,166,255,0.15)':'rgba(210,168,255,0.15)'};color:${type==='convocatoria'?'var(--primary)':'#d2a8ff'};">
                                ${type}
                            </span>
                            <span style="font-size:0.75rem;color:var(--text-muted);">${date}</span>
                        </div>
                        <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.2rem;">
                            ${type==='convocatoria' ? `🆚 vs ${data.rival || 'Rival'}` : `⚽ Entrenamiento: ${data.category || ''}`}
                        </div>
                        <div style="font-size:0.78rem;color:var(--text-muted);">
                            Enviado por: <strong>${data.coachEmail || 'Entrenador'}</strong>
                        </div>
                        ${data.players ? `<div style="font-size:0.75rem;margin-top:0.4rem;color:var(--primary);">👥 ${data.players.length} convocados</div>` : ''}
                    </div>
                    <button onclick="viewEventDetail('${type}', '${doc.id}')" class="btn" style="font-size:0.75rem;padding:0.4rem 0.8rem;">
                        Ver Detalles
                    </button>
                </div>`;
            });
        }
        container.innerHTML = html;

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">⚠️ Error al cargar: ${e.message}</div>`;
    }
}

window.openLiveMatchesView = () => {
    window.open('./live.html', '_blank');
};

window.viewEventDetail = async (type, id) => {
    const { collection, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = window._cronos_auth?.db;
    if (!db) { showToast('⚠️ Base de datos no disponible'); return; }
    const snap = await getDoc(doc(db, 'cronos_notifications', id));
    if (!snap.exists()) return;
    const d = snap.data();

    let details = d.fullText || d.extra || 'Sin detalles adicionales.';
    if (d.players && d.players.length) {
        details += `\n\nLista de Convocados:\n` + d.players.join(', ');
    }

    alert(`Detalles de ${type.toUpperCase()}:\n\n` + details);
};

window.openStaffDashboard = openStaffDashboard;

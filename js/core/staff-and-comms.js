// ══════════════════════════════════════════════════════════════════
//  CUERPO TÉCNICO
// ══════════════════════════════════════════════════════════════════

// Inicialización segura — evita TypeError si app.js aún no declaró staffConfig
if (typeof window.staffConfig === 'undefined') {
    window.staffConfig = { coach1: '', coach2: '', delegate: '', fieldDelegate: '' };
}

function loadStaffConfig() {
    // Asegurar que siempre existe el objeto base antes de mergear
    if (typeof window.staffConfig !== 'object' || window.staffConfig === null) {
        window.staffConfig = { coach1: '', coach2: '', delegate: '', fieldDelegate: '' };
    }
    const saved = localStorage.getItem('cronos_staff');
    if (saved) {
        try { staffConfig = { ...staffConfig, ...JSON.parse(saved) }; }
        catch(e) { console.warn('[Staff] Error leyendo staffConfig:', e); }
    }
}

function saveStaffConfig() {
    staffConfig.coach1        = (document.getElementById('staff-coach1')?.value       || '').trim();
    staffConfig.coach2        = (document.getElementById('staff-coach2')?.value       || '').trim();
    staffConfig.delegate      = (document.getElementById('staff-delegate')?.value     || '').trim();
    staffConfig.fieldDelegate = (document.getElementById('staff-field-delegate')?.value || '').trim();
    cloudSet('cronos_staff', JSON.stringify(staffConfig));
}

function renderStaffInBench() {
    // Recargar siempre desde localStorage
    loadStaffConfig();

    // Eliminar card anterior si existe
    const existing = document.getElementById('staff-bench-card');
    if (existing) existing.remove();

    const staff = staffConfig;
    const hasAny = staff.coach1 || staff.coach2 || staff.delegate || staff.fieldDelegate;
    if (!hasAny) return;

    // El card va DENTRO de bench-list para que sea scrollable junto a los suplentes
    const benchList = document.getElementById('bench-list');
    if (!benchList) return;

    const card = document.createElement('div');
    card.id = 'staff-bench-card';
    // grid-column: 1/-1 para que ocupe las dos columnas del grid del bench-container
    card.style.cssText =
        'grid-column:1/-1; width:100%; margin-top:6px; padding:7px 8px;' +
        'border-top:1px solid rgba(255,255,255,0.12); border-radius:6px;' +
        'background:rgba(88,166,255,0.05); box-sizing:border-box;' +
        'pointer-events:auto;';

    const extras = [];
    if (staff.coach2)        extras.push({ tag:'2DO', name:staff.coach2,        bg:'rgba(88,166,255,0.2)',  color:'#58a6ff' });
    if (staff.delegate)      extras.push({ tag:'DEL', name:staff.delegate,      bg:'rgba(240,136,62,0.2)', color:'#f0883e' });
    if (staff.fieldDelegate) extras.push({ tag:'CAM', name:staff.fieldDelegate, bg:'rgba(63,185,80,0.2)',  color:'#3fb950' });

    let html = '<div style="font-size:0.6rem;color:#7d8590;font-weight:700;letter-spacing:0.5px;margin-bottom:5px;">👨‍💼 CUERPO TÉCNICO</div>';

    if (staff.coach1) {
        html += `<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">
            <span style="font-size:0.6rem;background:rgba(88,166,255,0.25);color:#58a6ff;
                         border-radius:3px;padding:1px 5px;flex-shrink:0;font-weight:700;">1ER</span>
            <span style="font-size:0.73rem;font-weight:700;color:#cdd9e5;
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${typeof escapeHtml==='function'?escapeHtml(staff.coach1):staff.coach1}</span>
        </div>`;
    }

    if (extras.length > 0) {
        html += `<details>
            <summary style="cursor:pointer;color:#7d8590;font-size:0.65rem;
                            list-style:none;display:flex;align-items:center;
                            gap:4px;margin-top:2px;user-select:none;">
                <span>▾</span> ${extras.length} más
            </summary>
            <div style="margin-top:5px;display:flex;flex-direction:column;gap:4px;">
                ${extras.map(e =>
                    `<div style="display:flex;align-items:center;gap:5px;">
                        <span style="font-size:0.6rem;background:${e.bg};color:${e.color};
                                     border-radius:3px;padding:1px 5px;flex-shrink:0;font-weight:700;">${e.tag}</span>
                        <span style="font-size:0.72rem;color:#cdd9e5;white-space:nowrap;
                                     overflow:hidden;text-overflow:ellipsis;">${typeof escapeHtml==='function'?escapeHtml(e.name):e.name}</span>
                    </div>`
                ).join('')}
            </div>
        </details>`;
    }

    card.innerHTML = html;
    benchList.appendChild(card);
}

// v256: Generar ID de jugador basado en categoria + subcategoria.
// Mapeo: prebenjamin=PR, benjamin=BJ, alevin=AL, infantil=IF, cadete=CD, juvenil=JV, regional=RG
window._cronosGeneratePlayerId = function(index) {
    var cat = window._currentMatchCategory || '';
    var sub = window._currentMatchSubcategory || 'A';
    var prefix = 'J'; // fallback
    if (cat.includes('prebenjamin')) prefix = 'PR';
    else if (cat.includes('benjamin')) prefix = 'BJ';
    else if (cat.includes('alevin')) prefix = 'AL';
    else if (cat.includes('infantil')) prefix = 'IF';
    else if (cat.includes('cadete')) prefix = 'CD';
    else if (cat.includes('juvenil')) prefix = 'JV';
    else if (cat.includes('regional')) prefix = 'RG';
    var num = String(index + 1).padStart(2, '0');
    return prefix + sub + num; // ej: PRA01, BJ-B02, IFC03
};

function openRosterManager() {
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const mode = document.getElementById('setup-mode').value;
    const limit = mode === 'f7' ? 18 : 25;

    if (roster[mode].length < limit) {
        for (let i = roster[mode].length; i < limit; i++) {
            roster[mode].push({ 
                id: window._cronosGeneratePlayerId(i), 
                number: i + 1, name: '', surname: '', alias: '' 
            });
        }
    }

    // Asegurar que TODOS tengan un ID (migración para los ya guardados)
    roster[mode].forEach((p, i) => {
        if (!p.id) p.id = window._cronosGeneratePlayerId(i);
    });

    const modal = document.getElementById('setup-modal');
    modal.innerHTML = `
        <div class="modal-content" style="width: 800px; max-width: 95%;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.3rem;">
                <div style="display:flex; align-items:center; gap:0.8rem; flex-wrap:wrap;">
                    <button onclick="openSetupModal()"
                        title="Volver a la configuración del partido"
                        style="display:flex; align-items:center; gap:0.4rem; padding:0.45rem 0.9rem;
                               background:var(--glass); border:1px solid var(--glass-border);
                               border-radius:8px; color:var(--text-muted); font-size:0.85rem;
                               font-weight:600; cursor:pointer; white-space:nowrap;">
                        ← Volver
                    </button>
                    <h2 style="margin:0;">Gestionar Plantilla - ${mode === 'f7' ? 'Fútbol 7' : 'Fútbol 11'}</h2>
                </div>
                <button onclick="triggerRosterPhoto()"
                    title="Haz una foto a la lista de jugadores y la IA la importa automáticamente"
                    style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem 1rem;
                           background:rgba(240,136,62,0.15); border:1px solid rgba(240,136,62,0.5);
                           border-radius:8px; color:var(--secondary); font-size:0.85rem;
                           font-weight:700; cursor:pointer; white-space:nowrap;">
                    📷 IMPORTAR CON IA
                </button>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom:0.8rem;">
                Completa los datos de tus ${limit} jugadores · El Alias es el nombre que aparecerá en la ficha ·
                <span style="color:var(--secondary);">📷 Haz una foto a la lista y la IA la importa sola</span>
            </p>
            <!-- Input oculto para seleccionar imagen -->
            <input type="file" id="roster-photo-input" accept="image/*" capture="environment"
                style="display:none;" onchange="processRosterPhoto(this)">
            <div style="overflow-x: auto;">
                <table class="roster-table">
                    <thead>
                        <tr>
                            <th style="width:50px;">ID</th>
                            <th style="width:44px;">#</th>
                            <th>Nombre</th>
                            
                            <th style="color:var(--primary);">★ Alias <span style="font-size:0.65rem;font-weight:400;color:var(--text-muted);">(en ficha)</span></th>
                        </tr>
                    </thead>
                    <tbody id="roster-tbody">
                        ${roster[mode].map((p, i) => `
                            <tr>
                                <td><input type="text" class="r-id" value="${p.id}" readonly tabindex="-1"
                                    style="width:45px; background:transparent; border:none; color:var(--text-muted); font-size:0.7rem; font-weight:bold; text-align:center;"></td>
                                <td><input type="number" class="r-num" value="${p.number}" style="width:40px;"></td>
                                <td><input type="text" class="r-name" value="${p.name}"></td>
                                <td></td>
                                <td><input type="text" class="r-alias" value="${p.alias}"></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <!-- CUERPO TÉCNICO -->
            <div style="margin-top:1.2rem; padding:1rem; background:var(--glass);
                        border-radius:10px; border:1px solid var(--glass-border);">
                <h3 style="font-size:0.85rem; color:var(--primary); margin:0 0 0.8rem;
                           display:flex; align-items:center; gap:0.5rem;">
                    👨‍💼 Cuerpo Técnico
                    <span style="font-size:0.7rem; color:var(--text-muted); font-weight:400;">
                        — aparecerá en el banquillo durante el partido
                    </span>
                </h3>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem;">
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">1er Entrenador</label>
                        <input type="text" id="staff-coach1" value="${typeof escapeAttr==='function'?escapeAttr(staffConfig.coach1):staffConfig.coach1}"
                               placeholder="Nombre del entrenador"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">2º Entrenador</label>
                        <input type="text" id="staff-coach2" value="${typeof escapeAttr==='function'?escapeAttr(staffConfig.coach2):staffConfig.coach2}"
                               placeholder="Nombre del 2º entrenador"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">Delegado de Equipo</label>
                        <input type="text" id="staff-delegate" value="${typeof escapeAttr==='function'?escapeAttr(staffConfig.delegate):staffConfig.delegate}"
                               placeholder="Nombre del delegado"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:0.75rem;">
                            Delegado de Campo
                            <span style="color:var(--text-muted);font-size:0.68rem;">(solo en casa, opcional)</span>
                        </label>
                        <input type="text" id="staff-field-delegate" value="${typeof escapeAttr==='function'?escapeAttr(staffConfig.fieldDelegate):staffConfig.fieldDelegate}"
                               placeholder="Dejar vacío si se juega fuera"
                               style="width:100%;padding:0.45rem 0.6rem;border-radius:6px;
                                      border:1px solid var(--glass-border);background:var(--bg);
                                      color:var(--text);font-size:0.85rem;">
                    </div>
                </div>
            </div>

            <div style="margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 1rem;">
                <button class="btn" onclick="clearMasterRoster('${mode}')" style="background:rgba(255,88,88,0.15);color:#ff5858;border:1px solid rgba(255,88,88,0.5);margin-right:auto;">🗑️ BORRAR PLANTILLA</button>
                <button class="btn" onclick="openSetupModal()">CANCELAR</button>
                <button class="btn primary" onclick="saveMasterRoster('${mode}')">GUARDAR PLANTILLA</button>
            </div>
        </div>
    `;
}

window.clearMasterRoster = function(mode) {
    if (!confirm('¿Seguro que quieres borrar a TODOS los jugadores de la plantilla actual (' + (mode==='f7'?'F7':'F11') + ')?')) return;
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    roster[mode] = [];
    localStorage.setItem('cronos_master_roster', JSON.stringify(roster));
    if (typeof cloudSet === 'function') cloudSet('cronos_master_roster', JSON.stringify(roster));
    if (typeof showToast === 'function') showToast('🗑️ Plantilla borrada');
    if (typeof openRosterManager === 'function') openRosterManager();
};


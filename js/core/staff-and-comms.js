// ══════════════════════════════════════════════════════════════════
//  CUERPO TÉCNICO
// ══════════════════════════════════════════════════════════════════

// Este archivo es el DUEÑO de staffConfig. app-init.js declaraba además un
// `let staffConfig` propio; como carga el primero y una declaración léxica de
// nivel superior se resuelve ANTES que window, todas las lecturas y escrituras
// por nombre pelado de aquí abajo caían sobre AQUEL objeto y este se quedaba
// vacío para siempre. Ya no lo declara. No volver a declararlo en ningún
// script que cargue antes que este.
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
        // Reasignación explícita sobre window: un `staffConfig = …` pelado
        // crearía un global implícito y volvería a partir el objeto en dos.
        try { window.staffConfig = { ...window.staffConfig, ...JSON.parse(saved) }; }
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

// v258: Generar ID de jugador basado en la CATEGORÍA Y SUBCATEGORÍA DEL ENTRENADOR
// filtrando por la MODALIDAD actual (F7 o F11). Si el entrenador tiene
// Juvenil B (F11) y crea una plantilla F7, NO debe usar JVB sino la categoría
// F7 que tenga registrada (si la tiene). Si no tiene ninguna F7, usa fallback.
// ════════════════════════════════════════════════════════════════════
//  MODALIDAD ACTIVA (F7 / F11) — resolutor único
// ════════════════════════════════════════════════════════════════════
//  🔑🔑🔑 EL PROBLEMA QUE RESUELVE, y por qué no basta con un `?.`:
//  el <select id="setup-mode"> vive DENTRO de #setup-modal, y
//  openRosterManager REESCRIBE el innerHTML de ese modal con la tabla de la
//  plantilla. Desde la pantalla de plantilla en adelante, el elemento YA NO
//  EXISTE. Todo lo que se llame desde ahí y pregunte por él recibe null.
//
//  Eso daba tres fallos distintos, dos de ellos ANTERIORES a las plazas de
//  apoyo y ninguno evidente:
//    1. 💥 openRosterManager leía `.value` SIN protección → TypeError. Sólo
//       saltaba al repintar desde la propia pantalla: con el botón nuevo de
//       plazas de apoyo y, desde siempre, con "🗑️ BORRAR PLANTILLA", que
//       termina llamando a openRosterManager.
//    2. 🤫 showRosterPreview (js/ai/import.js) caía a 'f11' por defecto: una
//       foto importada con IA estando en Fútbol 7 se escribía en la plantilla
//       de Fútbol 11. Sin error y sin aviso.
//    3. 🤫 El selector de jugador invitado caía a 'f7': en F11 ofrecía las
//       plantillas de F7 de los demás equipos.
//
//  ⚠️ POR QUÉ SE RECUERDA Y NO SE ADIVINA: un valor por defecto es
//  precisamente lo que causaba (2) y (3). Aquí se memoriza la última
//  modalidad LEÍDA DEL SELECT, que es el dato real, y sólo se cae a
//  currentMode —el modo del partido en curso— y por último a 'f7'.
window._cronosLastRosterMode = null;
window.cronosActiveMode = function () {
    try {
        var el = document.getElementById('setup-mode');
        if (el && el.value) { window._cronosLastRosterMode = el.value; return el.value; }
    } catch (e) {}
    if (window._cronosLastRosterMode) return window._cronosLastRosterMode;
    if (typeof window.currentMode === 'string' && window.currentMode) return window.currentMode;
    try { if (typeof currentMode === 'string' && currentMode) return currentMode; } catch (e) {}
    return 'f7';
};

window._cronosGeneratePlayerId = function(index) {
    var cat = '';
    var sub = 'A';
    var mode = 'f7'; // default
    try {
        var modeEl = document.getElementById('setup-mode');
        if (modeEl) mode = modeEl.value || 'f7';
    } catch(e) {}

    try {
        var me = window._cronosCurrentUser;
        if (me && me.allRoles) {
            // Buscar el rol de entrenador cuya categoría coinca con la modalidad actual
            var coachRole = me.allRoles.find(function(r) {
                if (!r || (r.role !== 'user' && r.role !== 'coach')) return false;
                // v259: aceptar categoría con o sin prefijo de modalidad.
                // El dropdown auth-category guarda 'alevin', 'cadete', etc. (sin f7_/f11_).
                // Pero el dropdown match-category guarda 'f7_alevin', 'f11_cadete', etc.
                // Aceptamos ambos formatos.
                var rcat = (r.category || '').toLowerCase();
                if (!rcat) return false;
                // Quitar prefijo de modalidad si lo tiene
                var rcatBase = rcat.replace(/^f7_/, '').replace(/^f11_/, '');
                // Coincidir si la categoría base no está vacía
                // (no filtramos por modalidad porque el dropdown auth-category
                // no distingue F7/F11 — la categoría es la misma)
                if (rcatBase) return true;
                return false;
            });
            if (coachRole) {
                cat = coachRole.category || '';
                sub = coachRole.subcategory || 'A';
            }
        }
    } catch(e) {}

    // Fallback: usar la categoría del partido
    if (!cat) cat = window._currentMatchCategory || '';
    if (!sub || sub === 'A') sub = window._currentMatchSubcategory || 'A';

    var prefix = 'J';
    if (cat.includes('prebenjamin')) prefix = 'PR';
    else if (cat.includes('benjamin')) prefix = 'BJ';
    else if (cat.includes('alevin')) prefix = 'AL';
    else if (cat.includes('infantil')) prefix = 'IF';
    else if (cat.includes('cadete')) prefix = 'CD';
    else if (cat.includes('juvenil')) prefix = 'JV';
    // ⚠️ 'regional_fem' CONTIENE 'regional': va delante o comparte prefijo.
    else if (cat.includes('futurefem')) prefix = 'FF';
    else if (cat.includes('regional') && cat.includes('fem')) prefix = 'RF';
    else if (cat.includes('regional')) prefix = 'RG';

    var num = String(index + 1).padStart(2, '0');
    return prefix + sub + num;
};

// ── PLAZAS DE APOYO (2026-08-12) ────────────────────────────────────
// La plantilla BASE sigue siendo 18 en F7 y 25 en F11, intacta. Por encima
// de esa base pueden crecer hasta 7 filas supletorias para incorporar
// puntualmente a jugadores de otra categoría o del filial.
window.CRONOS_ROSTER_BASE  = { f7: 18, f11: 25 };
window.CRONOS_ROSTER_EXTRA = 7;
window._cronosRosterBase = function (mode) {
    return window.CRONOS_ROSTER_BASE[mode === 'f7' ? 'f7' : 'f11'];
};

// Vuelca las filas de la tabla al formato de la plantilla.
//
// 🔑 EXISTE PARA NO PERDER EL ORIGEN DEL INVITADO. saveMasterRoster leía las
// cinco casillas visibles y construía un objeto nuevo; una fila de apoyo
// habría perdido en cada guardado su ficha de origen, su equipo y su
// condición de invitada, en silencio y sin ningún error. Los campos de
// origen viajan en data-* de la fila y se recogen aquí, en UN SOLO SITIO,
// que es lo que garantiza que los dos llamadores (guardar y añadir plaza)
// no se separen.
window._cronosHarvestRosterRows = function () {
    const rows = document.querySelectorAll('#roster-tbody tr');
    return Array.from(rows).map(row => {
        const id      = row.querySelector('.r-id')?.value || '';
        const number  = row.querySelector('.r-num')?.value || '';
        const name    = (row.querySelector('.r-name')?.value || '').trim();
        const surname = (row.querySelector('.r-surname')?.value || '').trim();
        let   alias   = (row.querySelector('.r-alias')?.value || '').trim();
        if (!alias && name) alias = name.split(' ')[0];

        const base = { id, number, name, surname, alias };
        if (row.dataset.extra === '1') base.isSupport = true;
        if (row.dataset.guest === '1') {
            base.isGuest           = true;
            base.originTeamId      = row.dataset.originTeam || '';
            base.originCategory    = row.dataset.originCat  || '';
            base.originSubcategory = row.dataset.originSub  || '';
            base.originPlayerId    = row.dataset.originFicha || '';
        }
        return base;
    });
};

// Marcado de una fila supletoria. Se distingue a simple vista de las filas
// base (borde y fondo malva) y NO se teclea: el nombre y el dorsal los rellena
// el selector, que es el requisito del autor —"en lugar de escribir el nombre
// a mano"—. El dorsal sí queda editable: el invitado suele jugar con un
// dorsal distinto al que lleva en su equipo.
function _cronosSupportRowHtml(p, i) {
    const esc = (s) => (typeof escapeAttr === 'function')
        ? escapeAttr(s == null ? '' : s) : String(s == null ? '' : s).replace(/"/g, '&quot;');
    const puesto = !!p.isGuest;
    const origen = puesto
        ? `${esc(p.originCategory || '')} ${esc(p.originSubcategory || '')}`.trim()
        : '';
    return `
        <tr class="r-support" data-extra="1" data-guest="${puesto ? '1' : '0'}"
            data-origin-team="${esc(p.originTeamId || '')}"
            data-origin-cat="${esc(p.originCategory || '')}"
            data-origin-sub="${esc(p.originSubcategory || '')}"
            data-origin-ficha="${esc(p.originPlayerId || '')}"
            style="background:rgba(210,168,255,0.06); outline:1px solid rgba(210,168,255,0.28);">
            <td><input type="text" class="r-id" value="${esc(p.id || '')}" readonly tabindex="-1"
                title="${puesto ? 'Ficha de origen — no se reescribe' : 'Se rellena al elegir jugador'}"
                style="width:45px; background:transparent; border:none; color:#d2a8ff; font-size:0.7rem; font-weight:bold; text-align:center;"></td>
            <td><input type="number" class="r-num" value="${esc(p.number == null ? '' : p.number)}" style="width:40px;"></td>
            <td style="display:flex; align-items:center; gap:0.4rem;">
                <input type="text" class="r-name" value="${esc(p.name || '')}" readonly
                    placeholder="Sin jugador asignado"
                    style="flex:1; background:rgba(255,255,255,0.03); cursor:pointer;"
                    onclick="cronosOpenGuestPicker(${i})">
                <button onclick="cronosOpenGuestPicker(${i})"
                    title="Elegir jugador de otra categoría del club"
                    style="background:rgba(210,168,255,0.15); border:1px solid rgba(210,168,255,0.45);
                           color:#d2a8ff; border-radius:6px; padding:0.25rem 0.5rem; cursor:pointer;
                           font-size:0.75rem; white-space:nowrap;">🔍</button>
                <button onclick="cronosClearSupportSlot(${i})"
                    title="Vaciar esta plaza de apoyo"
                    style="background:none; border:none; color:#ff5858; cursor:pointer; font-size:0.9rem;">✕</button>
            </td>
            <td>${origen ? `<span style="font-size:0.62rem; font-weight:700; color:#d2a8ff;
                     background:rgba(210,168,255,0.12); border:1px solid rgba(210,168,255,0.3);
                     padding:2px 6px; border-radius:5px; white-space:nowrap;">${origen}</span>` : ''}</td>
            <td><input type="text" class="r-alias" value="${esc(p.alias || '')}"></td>
        </tr>`;
}

function openRosterManager() {
    // Pila de navegación (js/core/nav-stack.js).
    if (typeof navScreen === 'function') navScreen('openRosterManager');

    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const mode = window.cronosActiveMode();
    const limit = window._cronosRosterBase(mode);
    const maxExtra = window.CRONOS_ROSTER_EXTRA;

    if (roster[mode].length < limit) {
        for (let i = roster[mode].length; i < limit; i++) {
            roster[mode].push({
                id: window._cronosGeneratePlayerId(i),
                number: i + 1, name: '', surname: '', alias: ''
            });
        }
    }
    // Tope defensivo: nunca más de base + 7, venga como venga el guardado.
    if (roster[mode].length > limit + maxExtra) roster[mode].length = limit + maxExtra;

    // v260: REGENERAR TODOS los IDs con el formato correcto (categoria+subcategoria).
    // Antes solo se generaban IDs para slots vacíos, pero los ya guardados
    // seguían con J-01. Ahora regeneramos TODOS.
    //
    // ⚠️⚠️ SALVO LAS PLAZAS DE APOYO (2026-08-12). _cronosGeneratePlayerId
    // construye el código con la categoría DEL ENTRENADOR QUE TIENE LA SESIÓN
    // ABIERTA más el número de fila: aplicado a un invitado, el 'CDA07' del
    // cadete se reescribiría como 'JVA19' la primera vez que el juvenil
    // abriera esta pantalla, y el vínculo con su equipo de origen se perdería
    // sin ruido. El requisito del autor es que el invitado CONSERVE
    // ESTRICTAMENTE su ID de origen, así que aquí no se le toca.
    roster[mode].forEach((p, i) => {
        if (i >= limit || p.isGuest || p.isSupport) return;
        var newId = window._cronosGeneratePlayerId(i);
        if (p.id !== newId) {
            console.log('[v260] ID actualizado:', p.id, '→', newId);
            p.id = newId;
        }
    });
    localStorage.setItem('cronos_master_roster', JSON.stringify(roster));

    const modal = document.getElementById('setup-modal');
    modal.innerHTML = `
        <div class="modal-content" style="width: 800px; max-width: 95%;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.3rem;">
                <div style="display:flex; align-items:center; gap:0.8rem; flex-wrap:wrap;">
                    <button onclick="navBack()"
                        title="Volver a la pantalla anterior"
                        style="display:flex; align-items:center; gap:0.4rem; padding:0.45rem 0.9rem;
                               background:var(--glass); border:1px solid var(--glass-border);
                               border-radius:8px; color:var(--text-muted); font-size:0.85rem;
                               font-weight:600; cursor:pointer; white-space:nowrap;">
                        ← Volver
                    </button>
                    <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();" title="Salir al selector de roles"
                        style="background:none; border:none; color:var(--text-muted);
                               font-size:1.2rem; cursor:pointer; line-height:1; padding:0 0.2rem;">✕</button>
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
                        ${roster[mode].map((p, i) => i < limit
                            ? `
                            <tr>
                                <td><input type="text" class="r-id" value="${p.id}" readonly tabindex="-1"
                                    style="width:45px; background:transparent; border:none; color:var(--text-muted); font-size:0.7rem; font-weight:bold; text-align:center;"></td>
                                <td><input type="number" class="r-num" value="${p.number}" style="width:40px;"></td>
                                <td><input type="text" class="r-name" value="${p.name}"></td>
                                <td></td>
                                <td><input type="text" class="r-alias" value="${p.alias}"></td>
                            </tr>
                        `
                            : _cronosSupportRowHtml(p, i)).join('')}
                    </tbody>
                </table>
            </div>

            <!-- ── PLAZAS DE APOYO ─────────────────────────────────────── -->
            <div style="margin-top:0.7rem; display:flex; align-items:center; gap:0.8rem; flex-wrap:wrap;">
                <button onclick="cronosAddSupportSlot()" id="btn-add-support"
                    title="Añade una fila supletoria para convocar puntualmente a un jugador de otra categoría o del filial"
                    style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem 1rem;
                           background:rgba(210,168,255,0.12); border:1px solid rgba(210,168,255,0.45);
                           border-radius:8px; color:#d2a8ff; font-size:0.82rem; font-weight:700; cursor:pointer;">
                    ➕ AÑADIR PLAZA DE APOYO
                </button>
                <span style="font-size:0.72rem; color:var(--text-muted);">
                    ${roster[mode].length - limit} de ${maxExtra} plazas de apoyo ·
                    para jugadores de otra categoría o del filial
                </span>
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

// ── Añadir / vaciar una plaza de apoyo ──────────────────────────────
// 🔑 LAS DOS RECOGEN LA TABLA ANTES DE REPINTAR. openRosterManager vuelve a
// leer la plantilla de localStorage, así que sin volcar antes lo que hay en
// pantalla, pulsar "añadir plaza" borraría todo lo tecleado desde el último
// guardado — el defecto clásico de repintar sobre datos viejos.
window.cronosAddSupportSlot = function () {
    const mode = window.cronosActiveMode();
    const base = window._cronosRosterBase(mode);
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');

    const actuales = window._cronosHarvestRosterRows();
    if (actuales.length) roster[mode] = actuales;

    const extras = Math.max(0, roster[mode].length - base);
    if (extras >= window.CRONOS_ROSTER_EXTRA) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Máximo ' + window.CRONOS_ROSTER_EXTRA + ' plazas de apoyo.', 2800);
        }
        return;
    }
    roster[mode].push({ id: '', number: '', name: '', surname: '', alias: '', isSupport: true });
    localStorage.setItem('cronos_master_roster', JSON.stringify(roster));
    openRosterManager();
};

window.cronosClearSupportSlot = function (index) {
    const mode = window.cronosActiveMode();
    const base = window._cronosRosterBase(mode);
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');

    const actuales = window._cronosHarvestRosterRows();
    if (actuales.length) roster[mode] = actuales;

    // Se ELIMINA la fila, no se vacía: dejar un hueco a medias en mitad de las
    // supletorias descoloca los índices con los que el selector escribe.
    if (index >= base && index < roster[mode].length) roster[mode].splice(index, 1);
    localStorage.setItem('cronos_master_roster', JSON.stringify(roster));
    openRosterManager();
};

window.clearMasterRoster = function(mode) {
    if (!confirm('¿Seguro que quieres borrar a TODOS los jugadores de la plantilla actual (' + (mode==='f7'?'F7':'F11') + ')?')) return;
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    roster[mode] = [];
    localStorage.setItem('cronos_master_roster', JSON.stringify(roster));
    if (typeof cloudSet === 'function') cloudSet('cronos_master_roster', JSON.stringify(roster));
    if (typeof showToast === 'function') showToast('🗑️ Plantilla borrada');
    if (typeof openRosterManager === 'function') openRosterManager();
};


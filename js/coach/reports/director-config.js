// ════════════════════════════════════════════════════════════════════
//  js/coach/reports/director-config.js
//  Pestaña "Configuración del Club" del Panel de Dirección: formulario de
//  umbrales del semáforo e informes a padres por grupo de edad
//  (_renderDirectorConfig) y su guardado (_dirSaveCategoryConfigs).
//
//  Extraído de js/coach/reports/club-reports.js (auditoría 2026-07-22,
//  hallazgo #9 — monolitos sin tests de framework) el 2026-07-26, paso 1 de 6
//  de la descomposición de ese archivo. Movimiento puramente mecánico, sin
//  cambios de lógica.
//
//  ACOPLAMIENTO:
//   · Punto de entrada único: switchStaffTab('config') → _renderDirectorConfig(),
//     y switchStaffTab SE QUEDA en club-reports.js. Los dos botones "Guardar"
//     llaman window._dirSaveCategoryConfigs desde el HTML que genera esta
//     misma sección. Fan-in externo = 0: ningún otro .js/.html referencia
//     estas dos funciones.
//   · Depende de _sdFS() (helper Firestore que SE QUEDA en club-reports.js),
//     escapeHtml (app-init.js), showToast/showSpinner/hideSpinner
//     (match/timer/core.js), window._cronosCurrentUser y window._cronos_auth.
//     Todo se resuelve en tiempo de llamada (son function declarations, que
//     sí pasan a ser propiedades de window), así que el orden de los <script>
//     es indiferente. Se carga después de club-reports.js por coherencia.
//   · La reexportación window._renderDirectorConfig no tiene consumidores
//     (export muerto). Se conserva tal cual: cambio-cero de comportamiento.
//
//  ⚠️ NO TOCAR SIN LEER ESTO: _dirSaveCategoryConfigs publica
//  window._clubCategoryConfigs y window._clubTimerThresholds. Esas dos
//  globales DECIDEN EL COLOR DEL SEMÁFORO DEL CRONÓMETRO en partido — las leen
//  app-init.js (la decisión de color), utils.js, match/live/sync.js y
//  core/patches.js. Este archivo es uno de varios escritores de ese estado.
//  La aserción 4h del test las fija explícitamente.
//
//  ⚠️ DUPLICACIÓN PREEXISTENTE, DELIBERADAMENTE NO CORREGIDA: la lista de las
//  9 categorías está DOS veces — como objetos en _renderDirectorConfig y como
//  array de strings en _dirSaveCategoryConfigs. Quien añada una categoría a
//  una sola de las dos tendrá un guardado silenciosamente incompleto.
//  Unificarlo sería un cambio de comportamiento, ajeno a este refactor; la
//  aserción 2c del test compara ambas listas para que la desincronización
//  salte ahí.
//
//  Cubierto por scripts/test_director_config_module.js.
// ════════════════════════════════════════════════════════════════════

async function _renderDirectorConfig() {
    const container = document.getElementById('staff-dashboard-content');
    const me = window._cronosCurrentUser;

    // TERCERA PUERTA (defensa en profundidad). La vista es exclusiva del
    // Director Deportivo y del SuperAdmin: el Coordinador no debe llegar aqui.
    // El permiso lo decide _sdCanSeeConfigTab (club-reports.js), la MISMA
    // funcion que pinta el boton y que filtra la ruta, para que las tres
    // puertas no puedan discrepar. Esta se comprueba igualmente porque
    // window._renderDirectorConfig es invocable por su cuenta.
    // El `typeof` no es decorativo: club-reports.js podria no haber cargado.
    if (typeof window._sdCanSeeConfigTab === 'function' && !window._sdCanSeeConfigTab()) {
        container.innerHTML = '<p style="color:var(--text-muted);padding:2rem;">La configuración del club es competencia del Director Deportivo.</p>';
        return;
    }

    const clubId = me?.clubId;
    if (!clubId) {
        container.innerHTML = '<p style="color:var(--text-muted);padding:2rem;">Sin club asignado.</p>';
        return;
    }

    const { doc, getDoc } = await _sdFS();
    const db = window._cronos_auth?.db;
    const clubSnap = await getDoc(doc(db, 'clubs', clubId));
    const clubData = clubSnap.exists() ? clubSnap.data() : {};
    const features = clubData.features || {};
    const legacyThresholds = clubData.timerThresholds || { red: 33, yellow: 50 };
    const legacySendReports = features.sendIndividualReports !== false;
    const categoryConfigs = clubData.categoryConfigs || {};

    const extras = (me && me.extras) || {};
    const semaforoEnabled = extras.semaforo !== false;
    const informesPadresEnabled = extras.informes_padres !== false;

    // Definición de las 9 categorías/subcategorías exigidas
    const GROUPS = [
        { key: 'f7',          label: '⚽ Fútbol 7',                  sub: 'Prebenjamín, Benjamín y Alevín', hasSemaforo: true },
        { key: 'infantil_a',  label: '🏆 Infantil — Subcategoría A', sub: 'Categoría Infantil A',           hasSemaforo: true },
        { key: 'infantil_b',  label: '🏆 Infantil — Subcategoría B', sub: 'Categoría Infantil B',           hasSemaforo: true },
        { key: 'infantil_c',  label: '🏆 Infantil — Subcategoría C', sub: 'Categoría Infantil C',           hasSemaforo: true },
        { key: 'cadete_a',    label: '🥇 Cadete — Subcategoría A',   sub: 'Categoría Cadete A',             hasSemaforo: true },
        { key: 'cadete_b',    label: '🥇 Cadete — Subcategoría B',   sub: 'Categoría Cadete B',             hasSemaforo: true },
        { key: 'cadete_c',    label: '🥇 Cadete — Subcategoría C',   sub: 'Categoría Cadete C',             hasSemaforo: true },
        { key: 'juvenil',     label: '🔥 Juveniles',                 sub: 'Todas las subcategorías (A, B, C)', hasSemaforo: false },
        { key: 'regional',    label: '⭐ Regional / Senior',          sub: 'Todas las subcategorías (A, B, C)', hasSemaforo: false },
    ];

    let html = `
    <div style="max-width:780px; padding-bottom:2rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.2rem; flex-wrap:wrap; gap:0.8rem;">
        <div>
          <h3 style="margin:0; font-size:1.1rem; color:white;">⚙️ Configuración de Semáforos e Informes</h3>
          <div style="font-size:0.75rem; color:#7d8590; margin-top:3px;">
            Ajusta los límites del semáforo y los permisos de informes a padres según las exigencias de cada grupo de edad.
          </div>
        </div>
        <button onclick="window._dirSaveCategoryConfigs('${clubId}')"
            style="background:linear-gradient(135deg,#58a6ff,#1f6beb); border:none;
                   color:white; padding:0.6rem 1.4rem; border-radius:8px;
                   font-size:0.85rem; font-weight:800; cursor:pointer; box-shadow:0 4px 12px rgba(88,166,255,0.3);">
          💾 Guardar Configuración
        </button>
      </div>

      <div style="display:flex; flex-direction:column; gap:1rem;">
    `;

    GROUPS.forEach(g => {
        const cfg = categoryConfigs[g.key] || {};
        const semActive = g.hasSemaforo ? (cfg.semaforoActive !== false) : false;
        const redVal    = cfg.red    ?? legacyThresholds.red    ?? 33;
        const yellowVal = cfg.yellow ?? legacyThresholds.yellow ?? 50;
        const parentActive = cfg.sendIndividualReports !== undefined ? cfg.sendIndividualReports : legacySendReports;

        html += `
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.09); border-radius:14px; padding:1.1rem; transition:border-color 0.2s;"
             onmouseover="this.style.borderColor='rgba(88,166,255,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.09)'">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:0.6rem;">
            <div>
              <div style="font-size:0.95rem; font-weight:800; color:white;">${escapeHtml(g.label)}</div>
              <div style="font-size:0.72rem; color:#7d8590; margin-top:2px;">${escapeHtml(g.sub)}</div>
            </div>
            ${g.hasSemaforo ? `
            <label style="display:flex; align-items:center; gap:0.5rem; background:rgba(255,255,255,0.05); padding:0.35rem 0.7rem; border-radius:8px; cursor:pointer; ${semaforoEnabled ? '' : 'opacity:0.5;pointer-events:none;'}">
              <input type="checkbox" id="sem-active-${g.key}" ${semActive ? 'checked' : ''}
                     onchange="document.getElementById('sem-sliders-${g.key}').style.opacity = this.checked ? '1' : '0.4'; document.getElementById('sem-sliders-${g.key}').style.pointerEvents = this.checked ? 'auto' : 'none';"
                     style="width:17px; height:17px; accent-color:#58a6ff;">
              <span style="font-size:0.78rem; font-weight:700; color:white;">Semáforo Activo</span>
            </label>` : `
            <span style="font-size:0.72rem; font-weight:700; color:#79c0ff; background:rgba(121,192,255,0.1); border:1px solid rgba(121,192,255,0.25); padding:3px 8px; border-radius:6px;">
              ℹ️ Sin Semáforo (Celeste)
            </span>`}
          </div>

          <div style="display:grid; grid-template-columns:${g.hasSemaforo ? '1fr 1fr' : '1fr'}; gap:1.2rem; align-items:center;">
            ${g.hasSemaforo ? `
            <!-- Bloque Semáforo -->
            <div id="sem-sliders-${g.key}" style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:0.8rem; transition:all 0.2s; ${semActive && semaforoEnabled ? 'opacity:1; pointer-events:auto;' : 'opacity:0.4; pointer-events:none;'}">
              <div style="font-size:0.75rem; font-weight:700; color:#58a6ff; margin-bottom:0.6rem;">⏱️ Umbrales de Tiempo (%)</div>
              <label style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.5rem;">
                <span style="width:75px; font-size:0.72rem; color:#da3633; font-weight:700;">Rojo hasta</span>
                <input type="range" id="sem-red-${g.key}" min="10" max="45" step="1" value="${redVal}"
                       oninput="document.getElementById('sem-red-val-${g.key}').textContent=this.value+'%'"
                       style="flex:1; accent-color:#da3633;">
                <span id="sem-red-val-${g.key}" style="width:34px; text-align:right; font-weight:700; font-size:0.75rem; color:#da3633;">${redVal}%</span>
              </label>
              <label style="display:flex; align-items:center; gap:0.6rem;">
                <span style="width:75px; font-size:0.72rem; color:#e3b341; font-weight:700;">Amarillo</span>
                <input type="range" id="sem-yellow-${g.key}" min="30" max="70" step="1" value="${yellowVal}"
                       oninput="document.getElementById('sem-yellow-val-${g.key}').textContent=this.value+'%'"
                       style="flex:1; accent-color:#e3b341;">
                <span id="sem-yellow-val-${g.key}" style="width:34px; text-align:right; font-weight:700; font-size:0.75rem; color:#e3b341;">${yellowVal}%</span>
              </label>
              <div style="font-size:0.65rem; color:#7d8590; margin-top:0.4rem; text-align:right;">
                Verde: de ${yellowVal}% a 100%
              </div>
            </div>` : `
            <div style="background:rgba(121,192,255,0.05); border:1px solid rgba(121,192,255,0.15); border-radius:10px; padding:0.8rem; font-size:0.75rem; color:#7d8590; display:flex; align-items:center; gap:0.6rem;">
              <span style="font-size:1.2rem;">🩵</span>
              <div>En Juvenil y Regional no se aplica semáforo. Las tarjetas de cronómetro se muestran en <strong>celeste</strong>.</div>
            </div>`}

            <!-- Bloque Informes a Padres -->
            <div style="background:rgba(210,168,255,0.05); border:1px solid rgba(210,168,255,0.15); border-radius:10px; padding:0.8rem; ${informesPadresEnabled ? '' : 'opacity:0.5;pointer-events:none;'}">
              <div style="font-size:0.75rem; font-weight:700; color:#d2a8ff; margin-bottom:0.4rem;">👨‍👩‍👧 Informes a Padres</div>
              <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer;">
                <input type="checkbox" id="parent-rep-${g.key}" ${parentActive ? 'checked' : ''} style="width:18px; height:18px; accent-color:#d2a8ff;">
                <span style="font-size:0.78rem; font-weight:700; color:white;">Activar informes individualizados a padres</span>
              </label>
              <div style="font-size:0.68rem; color:#7d8590; margin-top:0.3rem;">
                Permite enviar el informe individual del jugador al padre/madre vinculado en esta categoría.
              </div>
            </div>
          </div>
        </div>`;
    });

    html += `
      </div>
      <div style="margin-top:1.5rem; text-align:right;">
        <button onclick="window._dirSaveCategoryConfigs('${clubId}')"
            style="background:linear-gradient(135deg,#58a6ff,#1f6beb); border:none;
                   color:white; padding:0.7rem 1.8rem; border-radius:9px;
                   font-size:0.9rem; font-weight:800; cursor:pointer; box-shadow:0 4px 14px rgba(88,166,255,0.35);">
          💾 Guardar Toda la Configuración
        </button>
      </div>
    </div>`;

    container.innerHTML = html;
}

window._dirSaveCategoryConfigs = async function(clubId) {
    const GROUPS = ['f7', 'infantil_a', 'infantil_b', 'infantil_c', 'cadete_a', 'cadete_b', 'cadete_c', 'juvenil', 'regional'];
    const categoryConfigs = {};

    let hasError = false;
    GROUPS.forEach(key => {
        const semActiveEl = document.getElementById(`sem-active-${key}`);
        const redEl       = document.getElementById(`sem-red-${key}`);
        const yellowEl    = document.getElementById(`sem-yellow-${key}`);
        const parentRepEl = document.getElementById(`parent-rep-${key}`);

        const semaforoActive = semActiveEl ? semActiveEl.checked : false;
        const red = redEl ? parseInt(redEl.value) || 33 : 33;
        const yellow = yellowEl ? parseInt(yellowEl.value) || 50 : 50;

        if (semActiveEl && semActiveEl.checked && red >= yellow) {
            hasError = true;
        }

        categoryConfigs[key] = {
            semaforoActive,
            red,
            yellow,
            sendIndividualReports: parentRepEl ? parentRepEl.checked : true
        };
    });

    if (hasError) {
        showToast('⚠️ En algunas categorías el umbral rojo debe ser menor que el amarillo.', 4000);
        return;
    }

    try {
        if (typeof showSpinner === 'function') showSpinner('Guardando configuración…');
        const { doc, updateDoc } = await _sdFS();
        const db = window._cronos_auth?.db;

        const f7Red = categoryConfigs.f7?.red || 33;
        const f7Yellow = categoryConfigs.f7?.yellow || 50;
        const anyReportsActive = Object.values(categoryConfigs).some(c => c.sendIndividualReports);

        await updateDoc(doc(db, 'clubs', clubId), {
            categoryConfigs: categoryConfigs,
            timerThresholds: { red: f7Red, yellow: f7Yellow },
            'features.sendIndividualReports': anyReportsActive
        });

        window._clubCategoryConfigs = categoryConfigs;
        window._clubTimerThresholds = { red: f7Red, yellow: f7Yellow };

        if (typeof hideSpinner === 'function') hideSpinner();
        showToast('✅ Configuración del club guardada correctamente', 3000);
    } catch(e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        console.error('[Config] Error guardando:', e);
        showToast('⚠️ Error al guardar: ' + e.message, 4000);
    }
};

window._renderDirectorConfig = _renderDirectorConfig;

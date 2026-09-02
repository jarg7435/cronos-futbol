// ══════════════════════════════════════════════════════════════════
//  PLANTILLA, CONVOCATORIA E IR AL PARTIDO
// ══════════════════════════════════════════════════════════════════
//
//  🚫 v647 · AQUÍ VIVÍA «IMPORTAR PLANTILLA CON IA» (foto → jugadores).
//  ELIMINADA POR PROTECCIÓN DE DATOS, a petición suya (2026-08-31): la
//  plantilla se introduce exclusivamente a mano (nombre y alias).
//
//  Qué se ha ido, entero y no sólo su botón: triggerRosterPhoto,
//  processRosterPhoto, compressImageToBase64, callGeminiVision,
//  callTesseract, parsePlayersFromText, updateUsageCounter, showOCRError,
//  showRosterPreview y confirmRosterImport. Con ellas, el <input
//  type="file"> de la pantalla de plantilla (js/core/staff-and-comms.js) y
//  el de la previsualización.
//
//  🔑 POR QUÉ SE BORRA LA CADENA Y NO SÓLO EL BOTÓN: el motivo es RGPD, no
//  estética. La foto de la lista del equipo es un documento externo con
//  datos personales de menores, y se enviaba FUERA del dispositivo (Gemini
//  Vision a través de un Worker de Cloudflare). Un botón escondido deja el
//  camino vivo para cualquiera que lo invoque por nombre; borrar la cadena
//  lo hace inalcanzable de verdad.
//
//  ⚠️ Lo que NO se ha tocado y sigue vivo aquí abajo: saveMasterRoster (el
//  guardado MANUAL de la plantilla, que llama la pantalla de gestión),
//  la convocatoria y el paso al partido. Sólo se fue la importación.
//
//  Guard: scripts/test_sin_importar_con_ia.js
// ══════════════════════════════════════════════════════════════════

function saveMasterRoster(mode) {
    showSpinner('Guardando plantilla…');
    setTimeout(async () => {
        // ⚠️ LA RECOGIDA VIVE EN _cronosHarvestRosterRows (staff-and-comms.js) Y
        // NO AQUÍ. La copia que había leía sólo las cinco casillas visibles, así
        // que una PLAZA DE APOYO perdía en cada guardado su ficha de origen, su
        // equipo y su condición de invitada — sin error y sin síntoma hasta
        // llegar a los informes. El respaldo de abajo mantiene el comportamiento
        // antiguo si el módulo aún no ha cargado.
        const playersData = (typeof window._cronosHarvestRosterRows === 'function')
            ? window._cronosHarvestRosterRows()
            : Array.from(document.querySelectorAll('#roster-tbody tr')).map(row => {
                const id      = row.querySelector('.r-id')?.value || '';
                const number  = row.querySelector('.r-num')?.value || '';
                const name    = (row.querySelector('.r-name')?.value || '').trim();
                // v263: la columna APELLIDOS fue eliminada en v256. Usar optional chaining.
                const surname = (row.querySelector('.r-surname')?.value || '').trim();
                let   alias   = (row.querySelector('.r-alias')?.value || '').trim();
                // Auto-rellenar alias si está vacío: usar el nombre
                if (!alias && name) alias = name.split(' ')[0];
                return { id, number, name, surname, alias };
            });
        // v580 · la plantilla DEL EQUIPO abierto, con la misma forma {f7,f11} de
    // antes: el cuerpo sigue indexando por su propia variable de modalidad
    // (`mode` en unas funciones, `currentMode` en otras) sin cambiar nada.
    const roster = window.cronosPlantillaAmbas();
        roster[mode] = playersData;
        // 🔑 v570 · SE GUARDA EL ASA PARA PODER CONFIRMARLA (ver el aviso final
        // de esta función). `cloudSet` sigue sin esperarse: sólo se recoge lo
        // que devuelve.
        const _subida = await window.cronosPlantillaGuardar(mode, roster[mode]);

        // Copia SIN DATOS PERSONALES para que el resto de entrenadores del club
        // puedan convocar a estos jugadores en sus plazas de apoyo. Sólo salen
        // ficha, dorsal, nombre y alias — ver js/roster/team-rosters.js.
        // ⚠️ Sólo las filas BASE: una plaza de apoyo es un jugador PRESTADO de
        // otro equipo, y republicarlo aquí lo duplicaría en el selector ajeno.
        if (typeof window.cronosPublishTeamRoster === 'function') {
            const base = (typeof window._cronosRosterBase === 'function')
                ? window._cronosRosterBase(mode) : playersData.length;
            window.cronosPublishTeamRoster(mode, playersData.slice(0, base));
        }
        saveStaffConfig();
        hideSpinner();

        // ════════════════════════════════════════════════════════════════
        //  🔑🔑🔑 v570 · EL AVISO DICE LA VERDAD
        // ════════════════════════════════════════════════════════════════
        //  Reportado por el autor (2ª prueba de estrés): guardó las plantillas
        //  de Benjamín C, Infantil, Regional y Alevín, la app dijo "✅ Plantilla
        //  y cuerpo técnico guardados"… y al volver aparecían SIN GUARDAR. Tuvo
        //  que rehacerlas una por una.
        //
        //  🔑 EL AVISO SE MOSTRABA SIEMPRE, 300 ms después, sin comprobar nada.
        //  `cloudSet` entrega la escritura al SDK y no espera el ACK (con
        //  razón: sin cobertura esa promesa no resuelve nunca y colgaría el
        //  guardado). Pero eso convertía CUALQUIER fallo de subida en un
        //  "guardado" silencioso. Y la copia local no salva el día: la purga
        //  por cambio de usuario —que existe por privacidad y debe seguir
        //  ahí— la borra en el siguiente inicio de sesión. La plantilla
        //  desaparecía de los dos sitios y lo último que se había leído era
        //  un tick verde.
        //
        //  Ahora se espera la confirmación CON TOPE (2,5 s) y se dice cuál de
        //  las tres cosas ha pasado. Sin cobertura no se cuelga: se contesta
        //  'pendiente', que es la verdad.
        const _estado = (typeof window.cronosConfirmaSubida === 'function')
            ? await window.cronosConfirmaSubida(_subida, 2500)
            : 'pendiente';

        if (_estado === 'ok') {
            showToast('✅ Plantilla y cuerpo técnico guardados y subidos');
        } else if (_estado === 'pendiente') {
            // Está en la cola del SDK: se subirá sola en cuanto haya red. Pero
            // el entrenador tiene que saber que TODAVÍA no está a salvo.
            showToast('💾 Plantilla guardada en este dispositivo. Subiendo a la nube… ' +
                      'No cierres sesión hasta que tengas conexión.', 6000);
        } else {
            showToast('⚠️ Plantilla guardada SÓLO en este dispositivo: no se ha ' +
                      'podido subir a la nube. Vuelve a guardarla con conexión ' +
                      'antes de cerrar sesión.', 8000);
        }
        openSetupModal();
    }, 300);
}

function openConvocationModal() {
    // Pila de navegación (js/core/nav-stack.js).
    if (typeof navScreen === 'function') navScreen('openConvocationModal');

    document.body.classList.add('setup-mode');
    // v580 · la plantilla DEL EQUIPO abierto, con la misma forma {f7,f11} de
    // antes: el cuerpo sigue indexando por su propia variable de modalidad
    // (`mode` en unas funciones, `currentMode` en otras) sin cambiar nada.
    const roster = window.cronosPlantillaAmbas();
    const myPlayers = roster[currentMode] || [];
    const minForMatch = currentMode === 'f7' ? 5 : 7;

    const isMobile = window.innerWidth < 640;
    const cols = isMobile ? 2 : (currentMode === 'f7' ? 3 : 5);
    const minTitulares = currentMode === 'f7' ? 5 : 7;

    // Restore saved convocation data
    const savedConv = JSON.parse(localStorage.getItem('cronos_conv_data') || '{}');

    // ════════════════════════════════════════════════════════════════
    //  ⚖️ v666 · LOS CUPOS DEPENDEN DEL TIPO DE PARTIDO, ASÍ QUE CAMBIAN
    // ════════════════════════════════════════════════════════════════
    //  Hasta aquí `maxConvoked` y `maxTitulares` eran CONSTANTES calculadas al
    //  pintar (14/18 y 7/11, siempre). Ahora el tipo de partido puede cambiar
    //  sin salir de la pantalla, y con él el cupo: un AMISTOSO no tiene acta de
    //  federación y la convocatoria queda abierta, mientras que el tope de
    //  TITULARES no lo relaja nadie —en el campo hay siete u once—.
    //
    //  🔑 LOS NÚMEROS NO SE ESCRIBEN AQUÍ: salen de `cronosCupoConvocatoria`
    //     (js/core/utils.js), que es la definición única que estrenó v660 para
    //     el informe manual. Copiarlos habría dejado dos tablas que un día
    //     dirán cosas distintas del mismo partido.
    //
    //  🔑 PASAN DE `const` A `let` Y NADA MÁS. Todos los sitios que los usan
    //     —el clic sobre el jugador 15, `convocationError`, los contadores— los
    //     LEEN, así que con recalcular la variable se enteran los tres sin
    //     tocar ni una comparación. Es la forma de cambiar esto sin reabrir el
    //     camino crítico que arregló v506.
    //
    //  ⚠️ «SIN TOPE» SE REPRESENTA CON UN NÚMERO ENORME, no con null: las tres
    //     comparaciones son `>` y `>=`, y contra null darían por bueno
    //     cualquier valor negativo y compararían mal. El texto de «sin tope»
    //     viaja aparte, en `maxConvokedTxt`.
    let maxConvoked = currentMode === 'f7' ? 14 : 18;
    let maxTitulares = currentMode === 'f7' ? 7 : 11;
    let maxConvokedTxt = String(maxConvoked);

    function _convTipoActual() {
        const el = document.getElementById('conv-type');
        return (el && el.value) || savedConv.type || 'amistoso';
    }

    // Recalcula los cupos con la regla única y refresca lo que los muestra.
    function _convRecalcularCupos() {
        const tipo = _convTipoActual();
        let cupo = null;
        if (typeof window.cronosCupoConvocatoria === 'function') {
            cupo = window.cronosCupoConvocatoria(currentMode, tipo);
        }
        if (!cupo) {
            // ⚠️ Sin la regla cargada NO se inventa una tabla de repuesto: se
            //    queda el cupo estricto de competición, que es el que había
            //    hasta v665. «No sé» no puede significar «sin límite» (v617).
            maxConvoked = currentMode === 'f7' ? 14 : 18;
            maxTitulares = currentMode === 'f7' ? 7 : 11;
            maxConvokedTxt = String(maxConvoked);
        } else {
            maxTitulares = cupo.maxTitulares;
            if (cupo.maxConvocados == null) {
                maxConvoked = Number.MAX_SAFE_INTEGER;
                maxConvokedTxt = 'sin tope';
            } else {
                maxConvoked = cupo.maxConvocados;
                maxConvokedTxt = String(maxConvoked);
            }
        }
        const elC = document.getElementById('conv-max-conv');
        const elT = document.getElementById('conv-max-tit');
        if (elC) elC.textContent = (maxConvokedTxt === 'sin tope') ? 'sin tope' : ('de ' + maxConvokedTxt + ' max');
        if (elT) elT.textContent = 'min ' + minForMatch + ' · max ' + maxTitulares;
    }

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,860px); max-height:94vh; display:flex; flex-direction:column; overflow-y:auto; padding:${isMobile ? '1rem 0.8rem' : '1.5rem'};">

            <div style="flex-shrink:0;">
                <h2 style="margin:0 0 0.1rem; font-size:${isMobile ? '1.1rem' : '1.4rem'};">\u{1F4CB} Convocatoria \u2014 ${TEAM_NAMES.home}</h2>
                <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.6rem;">
                    1\u00ba click: <span style="color:var(--primary);font-weight:700;">Convocado</span> \u00b7 2\u00ba click: <span style="color:#f0883e;font-weight:900;background:rgba(240,136,62,0.15);padding:2px 8px;border-radius:4px;">TITULAR</span> \u00b7 3\u00ba click: Quitar \u00b7 M&iacute;n <span style="color:#f0883e;font-weight:700;">${minForMatch}</span> titulares para partido
                </p>
            </div>

            <!-- \u2500\u2500 DATOS DEL PARTIDO \u2500\u2500 -->
            <div style="background:rgba(88,166,255,0.06); border:1px solid rgba(88,166,255,0.2);
                        border-radius:10px; padding:0.8rem 1rem; margin-bottom:0.8rem;">
                <div style="font-size:0.78rem; font-weight:700; color:var(--primary);
                            margin-bottom:0.5rem; letter-spacing:0.5px;">\u26BD DATOS DEL PARTIDO</div>
                <!-- \u{1F3C6} EL TIPO DE PARTIDO, LO PRIMERO (v666).
                     No es orden por gusto: de el dependen los CUPOS de
                     convocatoria y si hay o no calendario oficial que ofrecer,
                     asi que preguntarlo el ultimo obligaba a rehacer lo de
                     arriba. Mismo criterio que en el informe manual (v664). -->
                <div style="margin-bottom:0.6rem;">
                    <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F3C6} Tipo de partido</label>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
                        <select id="conv-type" class="conv-input" onchange="_convCambiarTipo()" style="max-width:14rem;">
                            <option value="liga" ${savedConv.type==='liga'?'selected':''}>\u{1F3C6} Liga</option>
                            <option value="copa" ${savedConv.type==='copa'?'selected':''}>\u{1F3C5} Copa</option>
                            <option value="torneo" ${savedConv.type==='torneo'?'selected':''}>\u{1F396}\uFE0F Torneo</option>
                            <option value="amistoso" ${(savedConv.type||'amistoso')==='amistoso'?'selected':''}>\u{1F91D} Amistoso</option>
                        </select>
                        <div id="conv-cupo-txt" style="flex:1; min-width:12rem; font-size:0.68rem;
                             color:var(--text-muted); line-height:1.5;"></div>
                    </div>
                </div>

                <!-- \u{1F4C5} EL CALENDARIO OFICIAL. Solo se pinta en LIGA y solo si el
                     club lo importo; lo rellena _convCargarCalendario(). -->
                <div id="conv-cal-box" style="display:none; margin-bottom:0.6rem;"></div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:0.5rem;">
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F4C5} Fecha</label>
                        <input type="date" id="conv-date" class="conv-input"
                            value="${savedConv.date || _cronosLocalDateKey(new Date())}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F552} Hora del partido</label>
                        <input type="time" id="conv-time" class="conv-input"
                            value="${savedConv.time || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F3DF}\uFE0F Lugar / Campo</label>
                        <input type="text" id="conv-venue" class="conv-input"
                            placeholder="Nombre del campo o direcci\u00f3n"
                            value="${typeof escapeHtml==='function'? escapeHtml(savedConv.venue||''): savedConv.venue||''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F19A} Rival</label>
                        <input type="text" id="conv-rival" class="conv-input"
                            placeholder="Equipo rival"
                            value="${typeof escapeHtml==='function'? escapeHtml(savedConv.rival||TEAM_NAMES.away||''): savedConv.rival||TEAM_NAMES.away||''}">
                    </div>
                    <div id="conv-jornada-box">
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F522} Jornada</label>
                        <input type="number" min="1" max="60" id="conv-jornada" class="conv-input"
                            onwheel="this.blur()"
                            value="${typeof escapeHtml==='function'? escapeHtml(String(savedConv.jornada||'')): (savedConv.jornada||'')}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F4DD} Hora presentaci\u00f3n</label>
                        <input type="time" id="conv-meettime" class="conv-input"
                            value="${savedConv.meettime || ''}">
                    </div>
                </div>

                <!-- \u2500\u2500 MENSAJE PARA LOS JUGADORES \u2500\u2500 -->
                <div style="margin-top:0.7rem;">
                    <label for="conv-message" style="font-size:0.72rem; color:var(--secondary); display:block; margin-bottom:0.25rem; font-weight:700;">
                        \u{1F4AC} Mensaje para los jugadores (opcional)
                    </label>
                    <textarea id="conv-message" class="conv-input" rows="3"
                        placeholder="\u00a1Vamos equipo! Recordad traer el equipaje completo y la botella de agua. \u{1F4AA}"
                        style="resize:vertical; width:100%; box-sizing:border-box; font-family:inherit;">${typeof escapeHtml==='function'? escapeHtml(savedConv.message||''): (savedConv.message||'')}</textarea>
                    <div style="font-size:0.66rem; color:var(--text-muted); margin-top:0.2rem;">
                        Se enviar\u00e1 con la convocatoria y lo ver\u00e1n los jugadores, el coordinador y el director deportivo.
                    </div>
                </div>
            </div>

            <!-- \u2500\u2500 CONTADORES EN TIEMPO REAL \u2500\u2500 -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-bottom:0.8rem;">
                <div id="conv-counter-conv" style="background:rgba(88,166,255,0.1); border:2px solid rgba(88,166,255,0.35);
                            border-radius:10px; padding:0.7rem 1rem; text-align:center;">
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:2px;">Convocados</div>
                    <div id="conv-num-conv" style="font-size:2.2rem; font-weight:900; color:var(--primary); line-height:1;">0</div>
                    <div id="conv-max-conv" style="font-size:0.6rem; color:var(--text-muted);">de ${maxConvoked} max</div>
                </div>
                <div id="conv-counter-tit" style="background:rgba(240,136,62,0.1); border:2px solid rgba(240,136,62,0.35);
                            border-radius:10px; padding:0.7rem 1rem; text-align:center;">
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:2px;">Titulares</div>
                    <div id="conv-num-tit" style="font-size:2.2rem; font-weight:900; color:#f0883e; line-height:1;">0</div>
                    <div id="conv-max-tit" style="font-size:0.6rem; color:var(--text-muted);">min ${minForMatch} · max ${maxTitulares}</div>
                </div>
            </div>

            <!-- \u2500\u2500 LISTADO DE JUGADORES \u2500\u2500 -->
            <div style="display:grid; grid-template-columns:repeat(${cols}, 1fr); gap:6px; margin-bottom:0.8rem;" id="conv-grid-container">
                ${myPlayers.length > 0 ? myPlayers.map((p, i) => {
                    // \u26a0\ufe0f UNA PLAZA DE APOYO SIN JUGADOR NO SE PINTA. Si no, la
                    // rejilla mostraria hasta 7 fichas fantasma tipo "J26" que
                    // se pueden convocar y arrancarian el partido con jugadores
                    // inexistentes. Se devuelve cadena vacia SIN tocar el array:
                    // data-index tiene que seguir apuntando a myPlayers.
                    if (p && p.isSupport && !(p.alias || p.name)) return '';
                    const _esInv = !!(p && p.isGuest);
                    const _org   = _esInv ? String(p.originCategory || '').trim() : '';
                    return `
                    <div class="conv-row" data-index="${i}" data-state="none" data-guest="${_esInv ? '1' : '0'}"
                        style="background:${_esInv ? 'rgba(210,168,255,0.08)' : 'var(--glass)'}; border:2px solid transparent; border-radius:8px;
                               padding:${isMobile ? '6px 8px' : '8px 10px'}; display:flex; align-items:center; gap:8px;
                               cursor:pointer; transition:all 0.1s; user-select:none;
                               ${_esInv ? 'outline:1px solid rgba(210,168,255,0.35);' : ''}">
                        <span class="conv-dot" style="width:16px;height:16px;border-radius:50%;
                              background:rgba(255,255,255,0.1); border:2px solid rgba(255,255,255,0.25);
                              display:flex;align-items:center;justify-content:center;
                              font-size:0.55rem;flex-shrink:0;color:transparent;">\u2713</span>
                        <span style="font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            <span style="color:var(--primary);font-weight:bold;">${p.number}</span>
                            ${typeof escapeHtml==='function'? escapeHtml(p.alias||p.name||'J'+(i+1)): (p.alias||p.name||'J'+(i+1))}
                        </span>
                        ${_esInv ? `<span title="Jugador de apoyo\u2014sube de ${typeof escapeAttr==='function'?escapeAttr(_org):_org}"
                            style="font-size:0.5rem;font-weight:800;padding:2px 5px;border-radius:3px;flex-shrink:0;
                                   background:rgba(210,168,255,0.18);color:#d2a8ff;">\u2b06 ${typeof escapeHtml==='function'?escapeHtml(_org):_org}</span>` : ''}
                        <span class="conv-att" data-att-ficha="${typeof escapeAttr==='function'?escapeAttr(p.id||''):(p.id||'')}"
                            style="font-size:0.5rem;font-weight:800;padding:2px 5px;border-radius:3px;
                                   flex-shrink:0;display:none;"></span>
                        <span class="conv-status-badge" style="font-size:0.5rem;font-weight:bold;padding:2px 5px;
                            border-radius:3px;display:none;margin-left:auto;flex-shrink:0;"></span>
                    </div>
                `;}).join('') : '<p style="grid-column:1/-1; color:var(--text-muted); font-size:0.8rem; text-align:center; padding:2rem;">No hay jugadores en la plantilla. Ve a GESTIONAR PLANTILLA para a\u00f1adirlos.</p>'}
            </div>

            <!-- \u2500\u2500 BOTONES \u2500\u2500 -->
            <div style="margin-top:auto; padding-top:1rem; border-top:1px solid var(--glass-border);
                        display:flex; flex-direction:column; gap:0.5rem;">

                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div id="conv-count" style="font-size:0.95rem; font-weight:bold; color:var(--primary);">0 convocados · 0 titulares</div>
                    <div style="display:flex; align-items:center; gap:0.4rem;">
                        <button class="btn" onclick="navBack()" style="padding:0.4rem 0.8rem; font-size:0.7rem;">\u2190 VOLVER</button>
                        <button class="btn" onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();" title="Salir al selector de roles"
                            style="padding:0.4rem 0.6rem; font-size:0.8rem; color:var(--text-muted);">\u2715</button>
                    </div>
                </div>

                <div style="display:flex; gap:0.4rem;">
                    <button class="btn" onclick="saveConvData(); saveConvPlayers(); _cronosOpenRoleSelector('convocatoria')"
                        style="flex:1; background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.4);
                               color:var(--primary); font-weight:700; font-size:0.78rem; padding:0.5rem;">
                        \u{1F4E4} ENVIAR CONVOCATORIA
                    </button>
                </div>

                <div id="conv-invalid-msg" style="display:none; font-size:0.72rem; font-weight:700;
                     color:#f85149; background:rgba(248,81,73,0.1); border:1px solid rgba(248,81,73,0.35);
                     border-radius:8px; padding:0.45rem 0.6rem; text-align:center;"></div>

                <button class="btn primary" id="btn-go-titulares" onclick="goToTitularSelection()" disabled
                    style="width:100%; font-weight:900; letter-spacing:1px; padding:0.6rem;">
                    \u26BD IR AL PARTIDO
                </button>
            </div>
        </div>
    `;

    // ── ASISTENCIA RECIENTE JUNTO A CADA JUGADOR ─────────────────────
    // 🔑 Es criterio para convocar, NO un bloqueo: no impide seleccionar a
    // nadie. El entrenador decide; esto sólo le pone delante el dato que si
    // no tendría que ir a buscar a otra pantalla.
    //
    // ⚠️ SE RELLENA DESPUÉS DEL PINTADO Y SIN REPINTAR LA REJILLA. Volver a
    // construir el innerHTML aquí borraría la selección de convocados y
    // titulares que el entrenador llevara hecha.
    if (typeof _cronosPintarAsistenciaConv === 'function') _cronosPintarAsistenciaConv();

    // ════════════════════════════════════════════════════════════════
    //  📅 v666 · EL CALENDARIO OFICIAL, TAMBIÉN EN LA CONVOCATORIA
    // ════════════════════════════════════════════════════════════════
    //  Encargo del autor: que esta pantalla funcione «igual que en el módulo de
    //  informes manuales». En LIGA se ofrecen los partidos del calendario
    //  importado y al elegir uno se autocompletan rival, campo, hora y jornada.
    //
    //  🔑 SE LEE CON LA MISMA FUNCIÓN, `calPartidosDeEquipo()` (v659), que ya
    //     conoce la forma del almacén (11 documentos mensuales) y el índice.
    //     Y el `filaId` que pide ES `cronosTeamId()`, la misma clave con la que
    //     el cuadrante identifica la fila del equipo: por eso el entrenador ve
    //     su calendario sin pasar por una pantalla del director.
    //
    //  ⚠️ NO PUEDE TUMBAR LA CONVOCATORIA. Es una comodidad: si la lectura
    //     falla, o el club no ha importado nada, quedan los campos a mano
    //     exactamente como estaban antes de v666. Por eso va detrás del pintado
    //     y dentro de su propio try.
    window._convPartidosCal = [];

    window._convCambiarTipo = function () {
        _convRecalcularCupos();
        const tipo = _convTipoActual();
        const esLiga = (tipo === 'liga');
        const caja = document.getElementById('conv-cal-box');
        // La JORNADA sólo tiene sentido en liga; un amistoso no la tiene y una
        // copa va por rondas. Es la misma separación del informe manual.
        const jor = document.getElementById('conv-jornada-box');
        if (jor) jor.style.display = esLiga ? '' : 'none';
        if (caja) caja.style.display = (esLiga && window._convPartidosCal.length) ? '' : 'none';

        const txt = document.getElementById('conv-cupo-txt');
        if (txt) {
            const modo = currentMode === 'f7' ? 'Fútbol 7' : 'Fútbol 11';
            txt.innerHTML = (maxConvokedTxt === 'sin tope')
                ? '🤝 ' + modo + ' · convocatoria <strong style="color:#3fb950;">abierta</strong>, ' +
                  'sin límite de convocados. El tope de <strong>' + maxTitulares +
                  ' titulares</strong> se mantiene: en el campo no caben más.'
                : '⚖️ ' + modo + ' · máximo <strong>' + maxConvokedTxt + ' convocados</strong> y ' +
                  '<strong>' + maxTitulares + ' titulares</strong>.';
        }
        if (typeof updateConvCounters === 'function') updateConvCounters();
    };

    // Vuelca en los campos el partido elegido del calendario.
    window._convElegirPartidoCal = function (v) {
        const i = parseInt(v, 10);
        const p = (i >= 0) ? window._convPartidosCal[i] : null;
        if (!p) return;              // «a mano»: no se toca nada de lo escrito
        const set = (id, valor) => { const e = document.getElementById(id); if (e) e.value = valor; };
        set('conv-date', p.fecha || '');
        set('conv-rival', p.rival || '');
        set('conv-venue', p.sede || '');
        set('conv-time', p.hora || '');
        set('conv-jornada', p.jornada == null ? '' : String(p.jornada));
        // 🏠/✈️ La localía del partido la lleva el interruptor LOCAL/VISITA del
        //    menú de arranque, que es de donde salen `TEAM_NAMES` y el rol del
        //    equipo. Aquí sólo se avisa de lo que dice el calendario para que
        //    el entrenador lo cuadre; cambiarlo a su espalda reescribiría la
        //    identidad del partido desde una pantalla que no la gobierna.
        if (typeof showToast === 'function') {
            showToast('📅 J' + (p.jornada || '?') + ' · ' + (p.rival || '') +
                      ' · ' + (p.local === false ? '✈️ fuera' : '🏠 en casa'), 4000);
        }
    };

    (async function _convCargarCalendario() {
        try {
            if (typeof window.calPartidosDeEquipo !== 'function') return;
            const eq = (typeof window.cronosMyTeam === 'function') ? window.cronosMyTeam() : null;
            if (!eq || !eq.clubId || !eq.teamId) return;
            const lista = await window.calPartidosDeEquipo(eq.clubId, eq.teamId) || [];
            if (!lista.length) return;
            window._convPartidosCal = lista;

            const hoy = (typeof _cronosLocalDateKey === 'function')
                ? _cronosLocalDateKey(new Date()) : new Date().toISOString().slice(0, 10);
            const jugados = [], porJugar = [];
            lista.forEach((p, i) => {
                const et = (p.jornada ? 'J' + p.jornada + ' · ' : '') + (p.fecha || '') +
                           (p.hora ? ' · ' + p.hora : '') +
                           ' · ' + (p.local !== false ? '🏠 ' : '✈️ ') + (p.rival || 'Rival');
                const op = '<option value="' + i + '">' +
                           (typeof escapeHtml === 'function' ? escapeHtml(et) : et) + '</option>';
                ((p.fecha || '') <= hoy ? jugados : porJugar).push(op);
            });

            const caja = document.getElementById('conv-cal-box');
            if (!caja) return;
            caja.innerHTML =
                '<label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">' +
                    '📅 Jornada y partido · calendario oficial</label>' +
                '<select id="conv-cal" class="conv-input" onchange="_convElegirPartidoCal(this.value)" ' +
                    'style="width:100%;">' +
                    '<option value="-1" selected>✍️ A mano (no usar el calendario)</option>' +
                    (jugados.length  ? '<optgroup label="Ya jugados">' + jugados.reverse().join('') + '</optgroup>' : '') +
                    (porJugar.length ? '<optgroup label="Aún por jugar">' + porJugar.join('') + '</optgroup>' : '') +
                '</select>' +
                '<div style="font-size:0.66rem; color:var(--text-muted); margin-top:0.2rem;">' +
                    '📅 <strong style="color:#3fb950;">' + lista.length + ' partidos</strong> del calendario ' +
                    'oficial. Al elegir uno se rellenan solos el rival, el campo, la hora y la jornada.</div>';

            // ⚠️ AQUÍ NO SE PRESELECCIONA NINGÚN PARTIDO, al revés que en el
            //    informe manual, y es deliberado: allí se registra un partido
            //    YA JUGADO y acertar es casi seguro; aquí se está preparando el
            //    PRÓXIMO, y pisar el rival o el campo que el entrenador acabe
            //    de escribir sería peor que no ayudar. Se ofrece y él elige.
            if (typeof window._convCambiarTipo === 'function') window._convCambiarTipo();
        } catch (e) {
            console.warn('[Convocatoria] no se pudo leer el calendario oficial:',
                         e && e.message ? e.message : e);
        }
    })();

    const countEl = document.getElementById('conv-count');
    const goBtn   = document.getElementById('btn-go-titulares');
    const numConvEl = document.getElementById('conv-num-conv');
    const numTitEl  = document.getElementById('conv-num-tit');
    const counterConvBox = document.getElementById('conv-counter-conv');
    const counterTitBox  = document.getElementById('conv-counter-tit');
    let convocados = 0;
    let titulares = 0;
    window._titularSelectionOrder = [];

    // v506 · Aviso de limite alcanzado. showToast lo define timer/core.js,
    //   que carga DESPUES; si aun no existe no puede quedarse mudo (seria
    //   un clic que no hace nada y no dice por que).
    function convWarn(msg) {
        if (typeof showToast === 'function') showToast(msg, 2800);
        else alert(msg);
    }

    // v506 · Devuelve la fila al estado "sin seleccionar". Centralizado
    //   porque ahora se deselecciona desde DOS sitios (3er clic y limite de
    //   titulares alcanzado). Limpia tambien el resplandor y la negrita del
    //   punto, que el codigo anterior se dejaba puestos al quitar un titular.
    function convResetRow(row) {
        const dot   = row.querySelector('.conv-dot');
        const badge = row.querySelector('.conv-status-badge');
        row.dataset.state = 'none';
        row.classList.remove('conv-selected');
        row.style.borderColor = 'transparent';
        row.style.background  = 'var(--glass)';
        row.style.boxShadow   = 'none';
        if (dot) {
            dot.style.background  = 'rgba(255,255,255,0.1)';
            dot.style.borderColor = 'rgba(255,255,255,0.25)';
            dot.style.color = 'transparent';
            dot.style.fontWeight = '';
            dot.textContent = '✓';
        }
        if (badge) badge.style.display = 'none';
        const idx = parseInt(row.dataset.index);
        window._titularSelectionOrder = (window._titularSelectionOrder || []).filter(i => i !== idx);
    }

    // v506 · MOTIVO por el que la convocatoria NO es valida ('' = valida).
    //   UNICA fuente de verdad de la validez: la usan el boton IR AL PARTIDO
    //   (para quedar bloqueado) y el aviso bajo el boton. Antes solo se
    //   miraba el minimo de titulares, asi que con 15 convocados en F-7 el
    //   boton seguia activo y el partido arrancaba roto.
    function convocationError() {
        const modoTxt = (currentMode === 'f7' ? 'Fútbol 7' : 'Fútbol 11');
        if (convocados > maxConvoked) {
            return 'Máximo ' + maxConvoked + ' convocados en ' + modoTxt + ' — tienes ' +
                   convocados + '. Quita ' + (convocados - maxConvoked) + '.';
        }
        if (titulares > maxTitulares) {
            return 'Máximo ' + maxTitulares + ' titulares — tienes ' + titulares + '.';
        }
        if (titulares < minTitulares) {
            return 'Necesitas al menos ' + minTitulares + ' titulares (naranja) — tienes ' + titulares + '.';
        }
        return '';
    }
    window._cronosConvocationError = convocationError;

    // Función auxiliar para actualizar los contadores visuales
    function updateConvCounters() {
        if (numConvEl) numConvEl.textContent = convocados;
        if (numTitEl) numTitEl.textContent = titulares;
        // Color de fondo dinámico según estado
        if (counterConvBox) {
            // v506 · en ROJO al rebasar el maximo, para que el motivo del
            // bloqueo se vea en el propio contador.
            const overMax = convocados > maxConvoked;
            counterConvBox.style.background  = overMax ? 'rgba(248,81,73,0.18)'
                                             : (convocados > 0 ? 'rgba(88,166,255,0.2)' : 'rgba(88,166,255,0.1)');
            counterConvBox.style.borderColor = overMax ? 'rgba(248,81,73,0.7)' : 'rgba(88,166,255,0.35)';
            if (numConvEl) numConvEl.style.color = overMax ? '#f85149' : 'var(--primary)';
        }
        if (counterTitBox) {
            const isValid = titulares >= minTitulares && titulares <= maxTitulares;
            counterTitBox.style.background = isValid ? 'rgba(240,136,62,0.2)' : 'rgba(240,136,62,0.1)';
            counterTitBox.style.borderColor = isValid ? 'rgba(240,136,62,0.6)' : 'rgba(240,136,62,0.35)';
        }
        // Mantener también el contador de texto plano
        if (countEl) {
            countEl.innerHTML = '<span style="color:var(--primary)">' + convocados + ' convocados</span> \u00b7 <span style="color:#f0883e;font-weight:700;">' + titulares + ' titulares</span>';
        }
        // v506 · BLOQUEO ESTRICTO: el boton solo se activa si la convocatoria
        // es valida POR COMPLETO, y cuando no lo es se dice POR QUE.
        const err = convocationError();
        if (goBtn) {
            goBtn.disabled = !!err;
            goBtn.style.opacity = err ? '0.45' : '';
            goBtn.title = err || '';
        }
        const msgEl = document.getElementById('conv-invalid-msg');
        if (msgEl) {
            msgEl.textContent = err ? ('⛔ ' + err) : '';
            msgEl.style.display = err ? 'block' : 'none';
        }
    }

    // \u2500\u2500 Pre-restaurar desde equipo cargado \u2500\u2500
    const loadedTeam = window.loadedTeamPlayers?.['home'];
    if (loadedTeam) {
        myPlayers.forEach((p, i) => {
            const savedPlayer = loadedTeam.find(lp => lp.number == p.number);
            const row = document.querySelector(`.conv-row[data-index="${i}"]`);
            if (row && savedPlayer) {
                const isField = savedPlayer.status === 'field';
                row.dataset.state = isField ? 'titular' : 'convocado';
                row.classList.add('conv-selected');
                if (isField) {
                    row.style.borderColor = '#f0883e';
                    row.style.background  = 'rgba(240,136,62,0.25)';
                    row.style.boxShadow = '0 0 12px rgba(240,136,62,0.3)';
                    const dot = row.querySelector('.conv-dot');
                    dot.style.background  = '#f0883e';
                    dot.style.borderColor = '#f0883e';
                    dot.style.color = '#0a0e14';
                    dot.textContent = 'T';
                    dot.style.fontWeight = '900';
                    const badge = row.querySelector('.conv-status-badge');
                    badge.textContent = 'TITULAR';
                    badge.style.background = '#f0883e';
                    badge.style.color = '#0a0e14';
                    badge.style.display = 'inline';
                    badge.style.fontWeight = '900';
                    titulares++;
                    window._titularSelectionOrder.push(i);
                } else {
                    row.style.borderColor = 'var(--primary)';
                    row.style.background  = 'rgba(88,166,255,0.12)';
                    const dot = row.querySelector('.conv-dot');
                    dot.style.background  = 'var(--primary)';
                    dot.style.borderColor = 'var(--primary)';
                    dot.style.color = '#0a0e14';
                    const badge = row.querySelector('.conv-status-badge');
                    badge.textContent = 'CONV';
                    badge.style.background = 'var(--primary)';
                    badge.style.color = '#0a0e14';
                    badge.style.display = 'inline';
                }
                convocados++;
            }
        });
        updateConvCounters();
    }

    // v666 · Y ANTES DE PINTAR, APLICAR EL CUPO DEL TIPO GUARDADO. Si la última
    //   convocatoria fue un amistoso, la pantalla tiene que abrir ya con la
    //   convocatoria abierta; si no, el contador diría «de 14 max» mientras la
    //   validación permite más, que es la peor de las dos mentiras posibles.
    if (typeof window._convCambiarTipo === 'function') window._convCambiarTipo();

    // v506 · Pintar el estado inicial SIEMPRE (haya equipo cargado o no):
    //   asi el motivo del bloqueo se ve desde el primer momento y no solo
    //   despues del primer clic.
    updateConvCounters();

    // \u2500\u2500 Click handler: 3 estados (none \u2192 convocado \u2192 titular \u2192 none) \u2500\u2500
    document.querySelectorAll('.conv-row').forEach(row => {
        row.addEventListener('click', () => {
            const state = row.dataset.state;
            const dot = row.querySelector('.conv-dot');
            const badge = row.querySelector('.conv-status-badge');

            if (state === 'none') {
                // v506 · BLOQUEO EN ORIGEN: no se puede marcar al convocado
                // numero (max+1) — el 15 en Futbol 7. Mismo comportamiento
                // que ya tenia el limite de TITULARES: aviso y no se marca.
                if (convocados >= maxConvoked) {
                    convWarn('⚠️ Máximo ' + maxConvoked + ' convocados en ' +
                             (currentMode === 'f7' ? 'Fútbol 7' : 'Fútbol 11'));
                    return;
                }
                // Estado 1: Seleccionar como CONVOCADO (azul)
                row.dataset.state = 'convocado';
                row.classList.add('conv-selected');
                row.style.borderColor = 'var(--primary)';
                row.style.background  = 'rgba(88,166,255,0.12)';
                dot.style.background  = 'var(--primary)';
                dot.style.borderColor = 'var(--primary)';
                dot.style.color = '#0a0e14';
                dot.textContent = '\u2713';
                badge.textContent = 'CONV';
                badge.style.background = 'var(--primary)';
                badge.style.color = '#0a0e14';
                badge.style.display = 'inline';
                convocados++;
            } else if (state === 'convocado') {
                // Estado 2: Promocionar a TITULAR (naranja)
                if (titulares >= maxTitulares) {
                    // v506 \u00b7 Antes se salia por aqui con `return` y el jugador
                    // quedaba ATRAPADO como convocado: con los titulares al
                    // maximo, el clic no hacia nada y era IMPOSIBLE quitarlo
                    // de la convocatoria (justo lo que hace falta para bajar
                    // de 15 a 14). Ahora el ciclo avanza a "sin seleccionar".
                    convWarn('\u26A0\ufe0f M\u00e1ximo ' + maxTitulares +
                             ' titulares \u00b7 se retira de la convocatoria');
                    convResetRow(row);
                    convocados--;
                    updateConvCounters();
                    return;
                }
                row.dataset.state = 'titular';
                row.style.borderColor = '#f0883e';
                row.style.background  = 'rgba(240,136,62,0.25)';
                row.style.boxShadow = '0 0 12px rgba(240,136,62,0.3)';
                dot.style.background  = '#f0883e';
                dot.style.borderColor = '#f0883e';
                dot.style.color = '#0a0e14';
                dot.textContent = 'T';
                dot.style.fontWeight = '900';
                badge.textContent = 'TITULAR';
                badge.style.background = '#f0883e';
                badge.style.color = '#0a0e14';
                badge.style.display = 'inline';
                badge.style.fontWeight = '900';
                titulares++;
                window._titularSelectionOrder.push(parseInt(row.dataset.index));
            } else {
                // Estado 3: Deseleccionar (volver a none)
                convResetRow(row);
                titulares--;
                convocados--;
            }

            updateConvCounters();
        });
    });
}

// \u2500\u2500 Guardar datos de la convocatoria (fecha, hora, lugar, rival, tipo) \u2500\u2500
function saveConvData() {
    const data = {
        date:     document.getElementById('conv-date')?.value     || '',
        time:     document.getElementById('conv-time')?.value     || '',
        venue:    document.getElementById('conv-venue')?.value.trim() || '',
        rival:    document.getElementById('conv-rival')?.value.trim() || '',
        type:     document.getElementById('conv-type')?.value     || 'amistoso',
        // v666 · La jornada, que ahora puede venir del calendario oficial. Sólo
        // se pregunta en LIGA, así que en amistoso/copa/torneo viaja vacía.
        jornada:  document.getElementById('conv-jornada')?.value.trim() || '',
        meettime: document.getElementById('conv-meettime')?.value || '',
        // 💬 Mensaje del entrenador para los jugadores. Va APARTE de `type`:
        // ver el comentario de _cronosConvExtra() en whatsapp-email.js, donde
        // se explica el fallo que confundía los dos campos.
        message:  document.getElementById('conv-message')?.value.trim() || ''
    };
    localStorage.setItem('cronos_conv_data', JSON.stringify(data));
    // FIX (Error #15c): guardar TAMBIEN en window._savedConvData para que
    // publishConvocationToAppV2 pueda leer los datos cuando el modal de
    // convocatoria ya no está en el DOM.
    window._savedConvData = data;
    return data;
}

// ── Guardar jugadores convocados (para el panel de envío) ──
function saveConvPlayers() {
    // v580 · la plantilla DEL EQUIPO abierto, con la misma forma {f7,f11} de
    // antes: el cuerpo sigue indexando por su propia variable de modalidad
    // (`mode` en unas funciones, `currentMode` en otras) sin cambiar nada.
    const roster = window.cronosPlantillaAmbas();
    const myPlayers = roster[currentMode] || [];
    const convRows = document.querySelectorAll('#conv-grid-container .conv-row[data-state="convocado"], #conv-grid-container .conv-row[data-state="titular"]');
    window._savedConvokedPlayers = Array.from(convRows).map(r => {
        const p = myPlayers[parseInt(r.dataset.index)];
        return p ? { ...p, initialStatus: r.dataset.state === 'titular' ? 'field' : 'bench' } : null;
    }).filter(Boolean);
    // FIX (Error #15c): log para depurar
    console.log('[saveConvPlayers] convRows encontradas:', convRows.length,
        '| myPlayers:', myPlayers.length,
        '| _savedConvokedPlayers:', window._savedConvokedPlayers.length,
        window._savedConvokedPlayers.map(p => p.alias || p.name));
}

// ── IR AL PARTIDO (desde convocatoria con 3 estados: convocado/titular) ──
// v506 · DEVUELVE true si el partido ARRANCA y false si se ABORTA. No es
//   cosmetico: js/core/patches.js envuelve esta funcion y, cuando abortaba,
//   seguia adelante igualmente (ocultaba el modal, mostraba la vista de
//   partido y, al no haber jugadores, FABRICABA 7 "Jugador N" locales). De
//   ahi el partido roto sin visitante tras el aviso de "maximo 14".
function goToTitularSelection() {
    // OJO: aqui NO se devuelve false. Ese guard significa "el usuario ha
    // elegido REANUDAR el partido en curso", y _restoreActiveMatch() ya ha
    // dejado la vista de partido en pantalla: los envoltorios deben seguir
    // su camino de siempre. false queda reservado a "convocatoria RECHAZADA,
    // seguimos en el modal", que es lo unico que debe frenarlos.
    if (typeof window._guardAgainstMatchReset === 'function' && window._guardAgainstMatchReset()) return;
    // v557 · El partido que nace es DE ESTE EQUIPO. Si el entrenador venía de
    // otro (v540), aquí se suelta el liveMatchId anterior para que el Regional
    // no retransmita dentro del documento del Alevín. Ver app-init.js.
    if (typeof window._cronosNuevoPartidoDeEquipo === 'function') window._cronosNuevoPartidoDeEquipo();
    saveConvData();
    saveConvPlayers();

    // v580 · la plantilla DEL EQUIPO abierto, con la misma forma {f7,f11} de
    // antes: el cuerpo sigue indexando por su propia variable de modalidad
    // (`mode` en unas funciones, `currentMode` en otras) sin cambiar nada.
    const roster = window.cronosPlantillaAmbas();
    const myPlayers = roster[currentMode] || [];
    const maxTitulares = currentMode === 'f7' ? 7 : 11;

    // Obtener todos los jugadores seleccionados (convocado o titular)
    const allRows = document.querySelectorAll('#conv-grid-container .conv-row[data-state="convocado"], #conv-grid-container .conv-row[data-state="titular"]');
    const matchPlayers = Array.from(allRows).map(r => {
        const p = myPlayers[parseInt(r.dataset.index)];
        const isTitular = r.dataset.state === 'titular';
        return p ? { 
            ...p, 
            initialStatus: isTitular ? 'field' : 'bench',
            titularOrder: isTitular ? window._titularSelectionOrder.indexOf(parseInt(r.dataset.index)) : 999
        } : null;
    }).filter(Boolean);

    const titularCount = matchPlayers.filter(p => p.initialStatus === 'field').length;

    const minTitulares = currentMode === 'f7' ? 5 : 7;

    // ════════════════════════════════════════════════════════════════
    //  🔴 v667 · ESTE TOPE TAMBIEN TIENE QUE CONOCER EL TIPO DE PARTIDO
    // ════════════════════════════════════════════════════════════════
    //  Aqui habia un `currentMode === 'f7' ? 14 : 18` fijo, y con v666 eso paso
    //  a ser una CONTRADICCION: la pantalla de convocatoria ya deja convocar
    //  sin tope en un amistoso, pero al pulsar IR AL PARTIDO este `if` lo
    //  rechazaba con «Maximo 14 convocados». Una capa permite y la siguiente
    //  deniega — el peor sitio donde dejar dos criterios, porque el usuario ya
    //  ha hecho el trabajo.
    //
    //  🔑 Se pide el cupo a la MISMA regla unica (`cronosCupoConvocatoria`), y
    //     el respaldo —si utils.js no hubiera cargado— es el ESTRICTO de
    //     siempre: «no se» no puede significar «sin limite» (v617).
    let maxConvocados = currentMode === 'f7' ? 14 : 18;
    if (typeof window.cronosCupoConvocatoria === 'function') {
        const _tipo = (document.getElementById('conv-type') && document.getElementById('conv-type').value) ||
                      (window._savedConvData && window._savedConvData.type) || 'amistoso';
        const _cupo = window.cronosCupoConvocatoria(currentMode, _tipo);
        if (_cupo) maxConvocados = (_cupo.maxConvocados == null) ? Number.MAX_SAFE_INTEGER : _cupo.maxConvocados;
    }

    // v506 · Los limites se comprueban ANTES de tocar nada, y cada aborto
    //   devuelve false para que ningun envoltorio siga adelante. Se mira
    //   primero el MAXIMO de convocados: es el que rompia el partido.
    if (matchPlayers.length > maxConvocados) {
        alert('Máximo ' + maxConvocados + ' convocados para Fútbol ' + (currentMode === 'f7' ? '7' : '11') + '.\nActualmente tienes ' + matchPlayers.length + ' convocados.\nElimina jugadores de la convocatoria antes de iniciar.');
        return false;
    }
    if (titularCount > maxTitulares) {
        alert('Máximo ' + maxTitulares + ' titulares para Fútbol ' + (currentMode === 'f7' ? '7' : '11') + '.\nActualmente tienes ' + titularCount + '.');
        return false;
    }
    if (titularCount < minTitulares) {
        alert('Necesitas al menos ' + minTitulares + ' titulares (naranja) para iniciar el partido.\nActualmente tienes ' + titularCount + ' titulares de ' + matchPlayers.length + ' convocados.');
        return false;
    }

    window.activeConvocation = matchPlayers;
    window._convokedPlayers = matchPlayers;

    // 🏷️ v667 · El rival elegido en la convocatoria pasa a ser el nombre del
    //    equipo contrario del partido. Va AQUI —despues de las validaciones y
    //    antes de pintar nada— para que no se aplique cuando la convocatoria se
    //    rechaza y para que `spawnInitialPlayers()` y el marcador ya nazcan con
    //    el nombre bueno. Ver la nota larga junto a la funcion.
    if (typeof _convHeredarRivalAlPartido === 'function') _convHeredarRivalAlPartido();

    document.body.classList.remove('setup-mode');
    spawnInitialPlayers();

    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-container').style.display = 'flex';

    // CRÍTICO: Aplicar formación ANTES de renderizar, para que los jugadores
    // tengan posiciones correctas desde el primer render.
    // Si el usuario eligió formación en setup, respetarla aunque el equipo tenga posiciones guardadas.
    if (selectedFormationOnStart) {
        applyFormationPreset(selectedFormationOnStart);
    } else {
        console.warn('[FORMACIÓN] selectedFormationOnStart está vacío — no se aplica formación');
    }
    window.loadedTeamPlayers = {};

    // Renderizar jugadores (las posiciones ya están asignadas por applyFormationPreset)
    renderPlayers();

    // Iniciar transmisi\u00f3n en vivo
    setTimeout(() => startLiveSync(), 800);

    document.getElementById('setup-modal').style.display = 'none';

    // Inyectar botones de scroll en banquillos
    injectBenchScrollButtons('bench-list');
    if (analyzeAway) injectBenchScrollButtons('bench-list-away');
    renderStaffInBench();

    const pitch = document.getElementById('football-pitch');
    pitch.addEventListener('click', () => closeDrawers());
    pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });

    return true;   // v506 - partido arrancado: los envoltorios pueden seguir
}

// ── INICIAR PARTIDO desde selecci\u00f3n de titulares (compatibilidad) ──
function startMatchFromTitularSelection() {
    // v506 · propaga el veredicto: false = convocatoria invalida, no se arranca
    return goToTitularSelection();
}

// ════════════════════════════════════════════════════════════════════
//  🏷️ v667 · EL RIVAL DE LA CONVOCATORIA SE HEREDA AL PARTIDO
// ════════════════════════════════════════════════════════════════════
//  Reportado por el autor con capturas (2026-09-03): elige «Maspalomas» en la
//  convocatoria —del calendario oficial o a mano— y al pasar al partido el
//  marcador sigue diciendo «VISITANTE». El dato estaba escrito y no viajaba.
//
//  🔑 POR QUE NO VIAJABA. `TEAM_NAMES` lo fija `confirmSetup()` desde las dos
//     casillas del menu de arranque, y la convocatoria es una pantalla
//     POSTERIOR que nunca las tocaba: el rival vivia solo en
//     `cronos_conv_data`, que es lo que se manda a las familias.
//
//  🔑🔑 Y EL RIVAL NO ES SIEMPRE «away». `TEAM_NAMES.home`/`away` son LOCAL y
//     VISITANTE del ENCUENTRO, y `window._userTeamRole` dice cual de los dos
//     es el equipo del entrenador. Si dirige de visitante, el rival es el
//     LOCAL. Escribirlo siempre en `away` le pondria el nombre del rival a su
//     PROPIO equipo — y de ahi salen el marcador, el informe y la
//     retransmision. Es la misma cautela que obligo a `_cMyTeamKey()`.
//
//  ⚠️ SE ESCRIBE TAMBIEN EN LA CASILLA DEL SETUP, no solo en `TEAM_NAMES`: si
//     el entrenador vuelve atras y confirma el arranque, `confirmSetup()` lee
//     la casilla y volveria a poner «VISITANTE» encima. Dejar los dos sitios
//     de acuerdo es lo que hace que el nombre no se pierda por el camino.
//
//  ⚠️ NO PISA UN NOMBRE CON UNO VACIO: sin rival en la convocatoria no se toca
//     nada, y el partido arranca exactamente como antes de v667.
function _convHeredarRivalAlPartido() {
    try {
        const el = document.getElementById('conv-rival');
        const guardado = (typeof window !== 'undefined' && window._savedConvData) || {};
        const rival = String((el && el.value) || guardado.rival || '').trim();
        if (!rival) return '';

        // El rival ocupa el lado CONTRARIO al del equipo del entrenador.
        const miLado    = (window._userTeamRole === 'away') ? 'away' : 'home';
        const ladoRival = (miLado === 'away') ? 'home' : 'away';
        const nombre    = rival.toUpperCase();

        if (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES) TEAM_NAMES[ladoRival] = nombre;

        const input = document.getElementById('setup-' + ladoRival + '-name');
        if (input) input.value = nombre;

        // El marcador de arriba, que es donde el vio el fallo.
        const rotulo = document.getElementById(ladoRival === 'away' ? 'team-b-name' : 'team-a-name');
        if (rotulo) rotulo.textContent = nombre;

        return nombre;
    } catch (e) {
        // ⚠️ Un nombre no puede impedir que arranque un partido.
        console.warn('[Convocatoria] no se pudo heredar el rival:', e && e.message ? e.message : e);
        return '';
    }
}
if (typeof window !== 'undefined') window._convHeredarRivalAlPartido = _convHeredarRivalAlPartido;


function startMatchWithConvocation() {
    if (typeof window._guardAgainstMatchReset === 'function' && window._guardAgainstMatchReset()) return;
    // v557 · igual que en goToTitularSelection: el partido nuevo es del equipo
    // que esté abierto, y no hereda la retransmisión del equipo anterior.
    if (typeof window._cronosNuevoPartidoDeEquipo === 'function') window._cronosNuevoPartidoDeEquipo();
    // v580 · la plantilla DEL EQUIPO abierto, con la misma forma {f7,f11} de
    // antes: el cuerpo sigue indexando por su propia variable de modalidad
    // (`mode` en unas funciones, `currentMode` en otras) sin cambiar nada.
    const roster = window.cronosPlantillaAmbas();
    const myPlayers = roster[currentMode] || [];
    const rows = document.querySelectorAll('.conv-row.conv-selected');
    
    // Guardar selección con el estatus (titular/suplente)
    const selectedPlayers = Array.from(rows).map(r => {
        const p = myPlayers[r.dataset.index];
        return { 
            ...p, 
            initialStatus: r.dataset.status || 'bench' 
        };
    });
    
    window.activeConvocation = selectedPlayers.length > 0 ? selectedPlayers : null;

    // ── Refrescar umbrales del semáforo del club (getTimerColor) ─────────
    // La versión de app-init.js (eclipsada por este archivo) recargaba
    // cl.timerThresholds al empezar partido; se replica aquí por si el
    // director los cambió tras el login. Best-effort, no bloquea el arranque.
    const _clubIdTh = window._cronosCurrentUser?.clubId;
    if (_clubIdTh) {
        Promise.resolve().then(async () => {
            try {
                const { db } = window._cronos_auth || {};
                const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                const snap = await getDoc(doc(db, 'clubs', _clubIdTh));
                if (snap.exists()) {
                    const thresh = snap.data().timerThresholds;
                    if (thresh) window._clubTimerThresholds = thresh;
                }
            } catch(e) { /* no bloquear inicio de partido */ }
        });
    }

    // ── FIX (bug: "informes no se envían a nadie") ───────────────────
    // Esta es la versión ACTIVA de startMatchWithConvocation (js/ai/import.js
    // se carga DESPUÉS de js/core/app-init.js, así que eclipsa a su versión).
    // La versión de app-init.js limpiaba los guards de idempotencia de informes
    // al empezar un partido nuevo; ésta NO lo hacía, por lo que tras el 1er
    // partido los guards persistían y saveAllMatchReportsInternal() omitía el
    // despacho de TODOS los partidos siguientes ("no se envían a nadie").
    // Replicamos aquí la limpieza para liberar el despacho en cada partido nuevo.
    try {
        Object.keys(localStorage)
            .filter(k => k.startsWith('cronos_reports_sent_'))
            .forEach(k => localStorage.removeItem(k));
    } catch (_) { /* localStorage no disponible: no bloquea el arranque */ }
    if (typeof liveMatchId !== 'undefined') liveMatchId = null;
    if (typeof liveIsActive !== 'undefined') liveIsActive = false;
    window._cronosLastDispatchedMatch = null;

    // 🏷️ v667 · LA SEGUNDA VIA AL PARTIDO, y por eso se hereda tambien aqui.
    //    Hay DOS funciones que arrancan un encuentro desde la convocatoria
    //    (`goToTitularSelection` y esta): poner la herencia solo en una es
    //    justo la forma de que el nombre aparezca unas veces si y otras no.
    if (typeof _convHeredarRivalAlPartido === 'function') _convHeredarRivalAlPartido();

    document.body.classList.remove('setup-mode');
    spawnInitialPlayers();

    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-container').style.display = 'flex';

    // CRÍTICO: Aplicar formación ANTES de renderizar
    if (selectedFormationOnStart) {
        applyFormationPreset(selectedFormationOnStart);
    }
    // Limpiar datos de equipo cargado ya aplicados
    window.loadedTeamPlayers = {};

    // Renderizar jugadores (las posiciones ya están asignadas por applyFormationPreset)
    renderPlayers();

    // Iniciar transmisión en vivo automáticamente (el director puede conectarse cuando quiera)
    setTimeout(() => startLiveSync(), 800);

    document.getElementById('setup-modal').style.display = 'none';

    // Inyectar botones de scroll en ambos banquillos
    injectBenchScrollButtons('bench-list');
    if (analyzeAway) injectBenchScrollButtons('bench-list-away');
    // Mostrar cuerpo técnico en el banquillo
    renderStaffInBench();

    const pitch = document.getElementById('football-pitch');
    pitch.addEventListener('click', () => closeDrawers());
    pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });
}

// --- BOTONES DE SCROLL EN BANQUILLO ---
function injectBenchScrollButtons(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const section = container.closest('.bench-section');
    if (!section || section.querySelector('.bench-scroll-btn')) return;

    const STEP = 120; // px por pulsación

    // Botón ▲ arriba
    const btnUp = document.createElement('button');
    btnUp.className = 'bench-scroll-btn';
    btnUp.innerHTML = '▲ subir';
    btnUp.title = 'Scroll arriba';

    // Scroll continuo al mantener pulsado
    let scrollInterval = null;
    const startScroll = (dir) => {
        container.scrollBy({ top: dir * STEP, behavior: 'smooth' });
        scrollInterval = setInterval(() => {
            container.scrollBy({ top: dir * STEP, behavior: 'auto' });
        }, 300);
    };
    const stopScroll = () => clearInterval(scrollInterval);

    btnUp.addEventListener('pointerdown', (e) => { e.preventDefault(); startScroll(-1); });
    btnUp.addEventListener('pointerup',   stopScroll);
    btnUp.addEventListener('pointerleave', stopScroll);
    btnUp.addEventListener('click', () => container.scrollBy({ top: -STEP, behavior: 'smooth' }));

    // Botón ▼ abajo
    const btnDown = document.createElement('button');
    btnDown.className = 'bench-scroll-btn bottom';
    btnDown.innerHTML = '▼ bajar';
    btnDown.title = 'Scroll abajo';

    btnDown.addEventListener('pointerdown', (e) => { e.preventDefault(); startScroll(1); });
    btnDown.addEventListener('pointerup',   stopScroll);
    btnDown.addEventListener('pointerleave', stopScroll);
    btnDown.addEventListener('click', () => container.scrollBy({ top: STEP, behavior: 'smooth' }));

    // Insertar: ▲ antes del container, ▼ después
    section.insertBefore(btnUp, container);
    section.appendChild(btnDown);
}

// --- PERSISTENCE ---

// -- BLOQUE DE PLANTILLAS GUARDADAS ELIMINADO (2026-07-29) ------------
//    Estas tres funciones eran copias FOSILES heredadas de cuando este
//    archivo se llamaba js/08_ai_import.js. Como import.js carga el
//    ULTIMO de los tres, sus versiones GANABAN pese a ser peores, y eso
//    tenia consecuencias visibles:
//      · su populateSavedTeams (12 lineas) no rellenaba la lista visual
//        de plantillas —los <div id="saved-teams-list-home|away"> que
//        pinta core/setup-modal.js— asi que los botones de borrado por
//        plantilla NO existian, y ademas no filtraba por modalidad;
//      · su loadTeamFromDropdown duplicaba en linea una version parcial
//        de loadTeamData, saltandose la sincronizacion de categoria y la
//        de _pendingSetupState (que existe para evitar sobreescrituras).
//    Ninguna de las tres se llamaba desde este archivo: eran huerfanas.
//    Guard: scripts/test_persistence_duplication.js
// populateSavedTeams() -> js/match/persistence/team-persistence.js (fuente canonica)

// loadTeamFromDropdown() -> js/match/persistence/team-persistence.js (fuente canonica)

// saveCurrentTeam() -> js/match/persistence/team-persistence.js (fuente canonica)

// -- setupEventListeners ELIMINADA (C-19/C-20) -------------------
// Copia obsoleta que existia aqui en js/ai/import.js. La definicion
// canonica vive en js/core/event-listeners.js. Se elimina para que
// no haya redefiniciones globales dependientes del orden de carga.
// -----------------------------------------------------------------

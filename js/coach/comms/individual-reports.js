// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL · Mis Informes / Informes Individuales
//  Extraído de js/coach/comms/panel.js (auditoría 2026-07-22, paso 3 de 6
//  del monolito #3). Movimiento MECÁNICO: cero cambios de comportamiento.
//
//  Contenido:
//    · openMisInformes()           — panel del entrenador con sus informes,
//      y sus tres manejadores anidados (miToggleInforme / miDescargarInforme
//      / miEliminarInforme), que se publican en window al ejecutarse.
//    · openIndividualReports()     — informes individuales hacia los padres
//    · _sendAllIndividualReports() — el envío (in-app + WhatsApp + email)
//
//  DEPENDE de panel.js — y de NADA más de ese archivo:
//    _cFS, _cMyTeamKey, openUnifiedCommsMenu
//  (resuelven vía window en tiempo de click, así que el orden de <script>
//  no condiciona la ejecución).
//  Y de otros archivos: _RP.build (coach/reports/report-engine.js),
//  escapeHtml, formatTime, showToast/showSpinner/hideSpinner, TEAM_NAMES,
//  window.players, más los globales léxicos emailConfig y currentMode
//  (core/app-init.js), leídos siempre con guarda typeof.
//
//  ⚠️ La guarda `typeof _RP` es ILUSORIA: _RP es un `const` de nivel
//  superior y, en zona muerta temporal, typeof lanza ReferenceError en vez
//  de devolver 'undefined'. Inocua hoy porque miToggleInforme sólo corre
//  al hacer click, mucho después de que report-engine.js se haya ejecutado.
//
//  ⚠️ ALCANZABILIDAD: openMisInformes se invoca desde dos onclick con guarda
//  typeof (core/app-init.js y core/setup-modal.js). En cambio
//  openIndividualReports y _sendAllIndividualReports NO tienen ningún punto
//  de entrada localizable en el repositorio: se movieron TAL CUAL, sin
//  borrar nada y sin declararlos código muerto. Misma situación que
//  openCollectiveReport en el paso 2.
//
//  ✅ ARREGLADO 2026-07-29: "Descargar TXT" ya funciona. Antes delegaba en
//  window.sdDownloadInforme, que vivía en js/23_staff_dashboard.js y
//  desapareció al refactorizar ese archivo, así que la guarda `typeof`
//  nunca se cumplía y el botón siempre salía por el toast de "no
//  disponible". miDescargarInforme es ahora autocontenido.
//
//  ⚠️ DEFECTO PREEXISTENTE QUE SE PRESERVA A PROPÓSITO:
//   1. `miDismissed` se lee de localStorage y no se usa jamás, mientras que
//      el catch de miEliminarInforme sí escribe esa clave: lo ocultado en
//      local cuando falla Firestore no se vuelve a filtrar al recargar.
//  Y `realDelete` se declara y nunca se lee: el borrado es SIEMPRE lógico
//  (dismissedBy), que es justo lo que pretendía el FIX v2.
//
//  Test: scripts/test_individual_reports_module.js
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  INFORMES INDIVIDUALES → PADRES VINCULADOS
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
//  MIS INFORMES — Panel del entrenador con sus propios informes de partido
//  (se auto-guardan al finalizar cada encuentro en ambos roles)
// ════════════════════════════════════════════════════════════════════
window.openMisInformes = async function openMisInformes() {
    // Pila de navegación (js/core/nav-stack.js). Esta pantalla tiene DOS vías
    // de entrada — el modal de setup (core/setup-modal.js) y el post-partido
    // (core/app-init.js, showPostMatchOptions) — y su "Volver" iba cableado a
    // openUnifiedCommsMenu(), que no es ninguna de las dos: terminabas un
    // partido, entrabas aquí, pulsabas Volver y aparecías en Comunicaciones.
    // Ahora se auto-registra y el botón usa navBack(), que deshace la vía real.
    if (typeof navScreen === 'function') navScreen('openMisInformes');

    const me = window._cronosCurrentUser;
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,900px);max-height:94vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;background:#0d1117;">

        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:1rem 1.4rem;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;">
            <div style="display:flex;align-items:center;gap:0.7rem;">
                <span style="font-size:1.4rem;">📋</span>
                <div>
                    <div style="font-size:1rem;font-weight:700;color:white;">Mis Informes de Partido</div>
                    <div style="font-size:0.7rem;color:var(--text-muted);">
                        Guardados automáticamente al finalizar cada encuentro
                    </div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem;">
                <button onclick="navBack()"
                    style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
                           color:var(--text-muted);padding:0.35rem 0.8rem;border-radius:6px;
                           cursor:pointer;font-size:0.74rem;font-weight:600;">← Volver</button>
                <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();" title="Salir al selector de roles"
                    style="background:none;border:none;color:var(--text-muted);
                           font-size:1.2rem;cursor:pointer;line-height:1;padding:0 0.2rem;">✕</button>
            </div>
        </div>

        <div id="mis-informes-body" style="flex:1;overflow-y:auto;padding:1.2rem;">
            <div style="text-align:center;padding:3rem;color:var(--text-muted);">
                <div class="spinner" style="margin:0 auto 1rem;"></div>Cargando…
            </div>
        </div>
    </div>`;

    try {
        const { db, collection, getDocs, query, where, limit, orderBy } = await _cFS();

        // ══════════════════════════════════════════════════════════════
        // EL INFORME ES DEL EQUIPO, NO DE QUIEN LO FIRMÓ
        // ══════════════════════════════════════════════════════════════
        // Antes esto consultaba `where('coachUid','==',me.uid)`: el entrenador
        // solo veía lo que había escrito ÉL. Consecuencia práctica: al relevar
        // a un entrenador, el que llegaba a la categoría abría "Mis Informes"
        // y lo encontraba VACÍO, aunque el club conservara entero el histórico
        // de ese equipo. El dato estaba; era la consulta la que lo escondía.
        //
        // Ahora se consulta por CLUB y se filtra por EQUIPO asignado.
        //
        // 🔑 DOBLE LECTURA, sin migrar nada: cronosTeamIdOfDoc() usa el campo
        //    `teamId` de los informes nuevos y, cuando no está —todo el
        //    histórico ya escrito—, lo deduce de category+subcategory, que sí
        //    llevan desde siempre. Por eso no hace falta reescribir ni un solo
        //    documento de producción para que el histórico aparezca.
        const equipoAsignado = (typeof window.cronosTeamId === 'function')
            ? window.cronosTeamId(me.clubId || '', me.category || me.categoryLabel || '', me.subcategory || '')
            : '';

        // ⚠️ Sin club o sin categoría asignada NO se ensancha la vista al club
        //    entero: se conserva el comportamiento anterior (solo lo suyo).
        //    Un entrenador todavía sin asignar vería informes de equipos que no
        //    son el suyo, que es justo lo contrario de lo que pide el modelo.
        //    Cubre también al ente individual, que no tiene clubId.
        const puedeFiltrarPorEquipo = !!(me.clubId && equipoAsignado);

        // ══════════════════════════════════════════════════════════════
        // 🔑🔑🔑 v508 · UN `limit` SIN `orderBy` ES UNA VENTANA FIJA EN LO
        //               MÁS VIEJO, NO "LOS ÚLTIMOS 500"
        // ══════════════════════════════════════════════════════════════
        // Esta consulta pedía `limit(500)` SIN ordenar. Firestore devuelve
        // entonces los 500 primeros por ID de documento, y el ID empieza por
        // `match_{uid}_{AAAA-MM-DD}_…`: el orden por ID es CRONOLÓGICO
        // ASCENDENTE. O sea, la ventana estaba clavada en los partidos MÁS
        // ANTIGUOS del club y NUNCA alcanzaba los de hoy.
        //
        // MEDIDO sobre los datos reales (2026-08-11): el club tiene 3620
        // informes; los 500 que traía esta consulta iban del 2026-06-27 al
        // 2026-07-01 — cinco días de hace mes y medio. El informe recién
        // guardado era el documento ~3600: imposible de alcanzar. Por eso
        // salía "Sin informes aún" por muy bien escrita que estuviera la
        // copia del entrenador (comprobado: existe, con su coachUid, su
        // clubId y su teamId correctos).
        //
        // 🔑 ASIMETRÍA QUE LO EXPLICA TODO: el Panel de Dirección
        // (reports-tab.js) SÍ ordena por `createdAt desc`, así que el
        // Director veía el partido de hoy al instante. Misma colección, dos
        // consultas distintas: por eso "a él le llega y a mí no".
        //
        // Se ordena por `__name__` DESC —y no por `createdAt`— a propósito:
        // con una sola igualdad, ordenar por el ID NO necesita índice
        // compuesto nuevo (verificado contra producción por REST), mientras
        // que `createdAt` sí lo exigiría y habría que desplegarlo aparte.
        const COL = () => collection(db, 'cronos_player_reports');
        const NUEVOS_PRIMERO = orderBy('__name__', 'desc');

        // Consulta principal: el equipo (o, sin equipo asignado, lo suyo).
        const consultas = [ puedeFiltrarPorEquipo
            ? query(COL(), where('clubId', '==', me.clubId), NUEVOS_PRIMERO, limit(500))
            : query(COL(), where('coachUid', '==', me.uid),  NUEVOS_PRIMERO, limit(500)) ];

        // ⚠️ Y SIEMPRE lo que él firmó. En un club activo, los 500 más
        // recientes del CLUB pueden ser casi todos de otros entrenadores y
        // volver a dejarle fuera de su propia pestaña. Con esta segunda
        // consulta su histórico no depende del volumen ajeno.
        if (puedeFiltrarPorEquipo) {
            consultas.push(query(COL(), where('coachUid', '==', me.uid), NUEVOS_PRIMERO, limit(500)));
        }

        const porId = new Map();
        for (const c of consultas) {
            const s = await getDocs(c);
            s.forEach(d => { if (!porId.has(d.id)) porId.set(d.id, d); });
        }
        const rawSnap = { forEach: (fn) => porId.forEach(d => fn(d)) };

        // Filtrar en cliente: solo informes de entrenador (_forCoach=true) y,
        // si procede, solo los del equipo asignado.
        const snap = { forEach: (fn) => rawSnap.forEach(d => {
            const datos = d.data();
            if (datos._forCoach !== true) return;
            // ⚠️ v507 · LO QUE ÉL FIRMÓ NO SE LE PUEDE OCULTAR NUNCA.
            // El filtro por equipo descarta el documento cuando su clave de
            // equipo no se resuelve: `cronosDocEsDeEquipo` devuelve false si
            // el informe no trae `teamId` NI `category` (mira
            // cronosTeamIdOfDoc → cronosTeamId, que devuelve '' sin categoría).
            // Y la categoría del partido puede faltar: se escribe desde
            // `window._currentMatchCategory`, que sólo se rellena al confirmar
            // el setup. Resultado: un informe correctamente guardado quedaba
            // INVISIBLE para su propio autor, que es justo el síntoma de
            // "se guarda pero no aparece en Mis Informes".
            // El propio autor ve siempre lo suyo; el filtro por equipo sigue
            // rigiendo para lo que firmaron OTROS (el histórico heredado del
            // equipo), que es para lo que se puso.
            const esMio = !!(datos.coachUid && me.uid && datos.coachUid === me.uid);
            if (!esMio && puedeFiltrarPorEquipo &&
                typeof window.cronosDocEsDeEquipo === 'function' &&
                !window.cronosDocEsDeEquipo(datos, [equipoAsignado], me.clubId)) return;
            fn(d);
        }) };

        const reports = [];
        snap.forEach(d => reports.push({ id: d.id, ...d.data() }));

        // Filtrar informes eliminados localmente
        const miDismissed = JSON.parse(localStorage.getItem('cronos_mi_dismissed_info') || '[]');

        if (!reports.length) {
            document.getElementById('mis-informes-body').innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="font-size:2rem;margin-bottom:1rem;">📋</div>
                <div style="font-size:0.95rem;font-weight:600;margin-bottom:0.4rem;">Sin informes aún</div>
                <div style="font-size:0.8rem;">
                    Los informes se guardan automáticamente al finalizar un partido
                    y al enviar el Informe Colectivo.
                </div>
            </div>`;
            return;
        }

        // Agrupar por matchId → fecha+rival+coach (mismo algoritmo que 23_staff_dashboard)
        const matches = {};
        reports.forEach(r => {
            const key = r.matchId ||
                `${r.matchDate||r.createdAt?.slice(0,10)||'?'}_${r.rival||'sin-rival'}_${r.coachUid||''}`;
            if (!matches[key]) {
                matches[key] = {
                    key, matchId: r.matchId||key,
                    matchDate: r.matchDate||r.createdAt?.slice(0,10),
                    rival: r.rival, scoreHome: r.scoreHome, scoreAway: r.scoreAway,
                    myTeamRole: r.myTeamRole,   // FIX: propagar rol del equipo para el cálculo V/D/E correcto (visitante)
                    category: r.category||'', venue: r.venue||'',
                    competition: r.competition||'', matchTime: r.matchTime||'',
                    duration: r.duration||'', stoppageTime: r.stoppageTime||0,
                    createdAt: r.createdAt, coachEmail: r.coachEmail,
                    _playerMap: {}, players: [],
                };
            }
            const pNum = String(r.playerNumber||'');
            const existing = matches[key]._playerMap[pNum];
            if (!existing || (r.createdAt||'') > (existing.createdAt||''))
                matches[key]._playerMap[pNum] = r;
            // FIX: adoptar myTeamRole si el objeto agrupado aún no lo tiene.
            if (matches[key].myTeamRole == null && r.myTeamRole != null)
                matches[key].myTeamRole = r.myTeamRole;
        });
        Object.values(matches).forEach(m => {
            m.players = Object.values(m._playerMap)
                .sort((a,b)=>(parseInt(a.playerNumber)||99)-(parseInt(b.playerNumber)||99));
            delete m._playerMap;
        });
        const sorted = Object.values(matches)
            .filter(m=>m.players.length>0)
            .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));

        window._misInformesData = matches;

        // ══════════════════════════════════════════════════════════════
        // v509 · RESUMEN ACUMULADO DE LA TEMPORADA, encima del listado
        // ══════════════════════════════════════════════════════════════
        // El entrenador tenía el listado partido a partido pero NO el bloque
        // acumulado que sí ven el Director Deportivo y el Coordinador en su
        // panel (reports-tab.js). Se reutilizan LAS MISMAS funciones globales
        // —`ctAccumulatePlayerStats` para las filas, `ctRenderStatsTable` para
        // la tabla y `rxExportarResumen*` para las descargas— a propósito: si
        // se recalculara aquí, los dos paneles acabarían diciendo cosas
        // distintas del mismo equipo, que es justo lo que se pide evitar.
        // `ctRenderStatsTable` trae su propio CSS (CT_STATS_CSS), así que la
        // tabla se ve igual sin depender de style.css.

        // El equipo de un partido, leído de sus documentos (doble lectura:
        // `teamId` en los nuevos, category+subcategory en el histórico).
        const _miEquipoDe = (m) => {
            const p = (m.players && m.players[0]) || null;
            return (p && typeof window.cronosTeamIdOfDoc === 'function')
                ? window.cronosTeamIdOfDoc(p, me.clubId) : '';
        };
        // El acumulado es DE SU EQUIPO. Si el filtro no deja nada (por
        // ejemplo, informes antiguos sin categoría), se acumula todo lo que
        // se está listando: mejor un acumulado real que una tabla vacía.
        const _miDelEquipo = puedeFiltrarPorEquipo
            ? sorted.filter(m => _miEquipoDe(m) === equipoAsignado)
            : sorted;
        const _miParaResumen = _miDelEquipo.length ? _miDelEquipo : sorted;

        // Etiqueta del equipo: la del árbol de categorías si se reconoce.
        const _miEtiquetaEquipo = () => {
            const p0 = (_miParaResumen[0] && _miParaResumen[0].players && _miParaResumen[0].players[0]) || {};
            const cat = p0.category || me.category || me.categoryLabel || '';
            const sub = p0.subcategory || me.subcategory || '';
            const def = (window.CT_CATEGORIES || []).find(c => c.id === cat);
            const etiqueta = (def && def.label) || cat;
            return (etiqueta ? etiqueta + (sub ? ' ' + sub : '') : 'Mi equipo');
        };

        // Guardado para las descargas, que reacumulan AL PULSAR con la misma
        // función que pintó la tabla (el papel no puede decir otra cosa que
        // la pantalla).
        window._miResumenPartidos = _miParaResumen;
        window._miResumenEquipo   = _miEtiquetaEquipo();

        const _miPuedeExportar = typeof window.rxExportarResumenPDF === 'function' &&
                                 typeof window.rxExportarResumenCSV === 'function';
        const _miPuedeResumir  = typeof window.ctAccumulatePlayerStats === 'function' &&
                                 typeof window.ctRenderStatsTable === 'function';

        let _miResumenHtml = '';
        if (_miPuedeResumir) {
            // Estilos EQUIVALENTES a los de la barra del panel de Dirección
            // (.sd-exp-* en reports-tab.js). Van en línea y con nombres
            // propios para no depender de que aquel panel se haya abierto
            // antes: su <style> se inyecta con SU html y aquí no existe.
            const barra = _miPuedeExportar ? `
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.4rem;
                        margin:0 0 0.7rem;padding:0.45rem 0.7rem;border-radius:9px;
                        background:rgba(88,166,255,0.05);border:1px solid rgba(88,166,255,0.16);">
                <span style="font-size:0.7rem;font-weight:600;color:#8b949e;margin-right:auto;">
                    ⬇️ Resumen acumulado de la temporada de este equipo
                </span>
                <button onclick="miExportResumen('pdf')"
                    style="background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.32);
                           color:#58a6ff;padding:0.3rem 0.7rem;border-radius:6px;cursor:pointer;
                           font-size:0.7rem;font-weight:700;white-space:nowrap;">🖨️ PDF</button>
                <button onclick="miExportResumen('csv')"
                    style="background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.32);
                           color:#58a6ff;padding:0.3rem 0.7rem;border-radius:6px;cursor:pointer;
                           font-size:0.7rem;font-weight:700;white-space:nowrap;">📊 CSV / Excel</button>
            </div>` : '';

            // matchCount = partidos del EQUIPO, que es lo que va en la celda PJ
            // de la fila de totales (sin él sale un guion).
            let _miFilas = window.ctAccumulatePlayerStats(_miParaResumen);

            // 🔑 LA PLANTILLA ENTERA, TAMBIÉN AQUÍ (autor, 2026-08-12). El
            // entrenador no necesita leer nada de la nube: SU plantilla está en
            // localStorage. Se transforma al mismo formato que publica
            // team-rosters.js para reutilizar ctMergeSquadRows tal cual.
            // ⚠️ Se juntan las dos modalidades: el mismo entrenador puede tener
            // plantilla de F7 y de F11, y "Mis Informes" no distingue.
            try {
                if (typeof window.ctMergeSquadRows === 'function') {
                    const _r = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}');
                    const _vistos = Object.create(null);
                    const _sq = [];
                    ['f7', 'f11'].forEach(function (m) {
                        (Array.isArray(_r[m]) ? _r[m] : []).forEach(function (p) {
                            if (!p) return;
                            const alias = String(p.alias || p.name || '').trim();
                            if (!alias) return;                       // fila vacía
                            const k = String(p.id || '') || ('d:' + String(p.number || '') + alias.toLowerCase());
                            if (_vistos[k]) return;
                            _vistos[k] = true;
                            _sq.push({ ficha: p.id || '', dorsal: p.number, nombre: p.name || '', alias: alias });
                        });
                    });
                    if (_sq.length) _miFilas = window.ctMergeSquadRows(_miFilas, _sq);
                }
            } catch (_) { /* sin plantilla local, la tabla sale como antes */ }

            _miResumenHtml = barra + window.ctRenderStatsTable(
                _miFilas, { matchCount: _miParaResumen.length }
            );
        }

        const body = document.getElementById('mis-informes-body');
        body.innerHTML = _miResumenHtml + `<div style="font-size:0.74rem;color:var(--text-muted);margin:0.9rem 0 0.8rem;">
            ${sorted.length} partido${sorted.length!==1?'s':''} · ${reports.length} informes de jugadores
        </div>` + sorted.map(m => {
            const sh=m.scoreHome, sa=m.scoreAway;
            const score=(sh!=null&&sa!=null)?`${sh}–${sa}`:'—';
            // Resultado segun myTeamRole; sin el campo (informes antiguos) -> fallback 'home', comportamiento previo.
            const _mine=m.myTeamRole==='away'?sa:sh, _theirs=m.myTeamRole==='away'?sh:sa;
            const res=(sh!=null&&sa!=null)?(_mine>_theirs?'VICTORIA':_mine<_theirs?'DERROTA':'EMPATE'):'';
            const rCol=res==='VICTORIA'?'#3fb950':res==='DERROTA'?'#ff5858':'#eab308';
            const dateStr=m.matchDate
                ?new Date(m.matchDate+'T12:00:00').toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'}):'—';
            const key64=btoa(unescape(encodeURIComponent(m.key))).replace(/=/g,'');
            const goals=m.players.reduce((s,p)=>s+(p.goals||0),0);
            return `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(63,185,80,0.15);
                        border-radius:12px;padding:0.9rem 1.1rem;margin-bottom:0.7rem;cursor:pointer;transition:all 0.2s;"
                 id="mi-rp-${key64}"
                 onmouseover="this.style.borderColor='rgba(63,185,80,0.4)'"
                 onmouseout="this.style.borderColor='rgba(63,185,80,0.15)'"
                 onclick="miToggleInforme('${key64}')">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                            🆚 vs <span style="color:#3fb950;">${typeof escapeHtml==='function'?escapeHtml(m.rival||'Sin rival'):m.rival||'Sin rival'}</span>
                            ${res?`<span style="font-size:0.62rem;font-weight:700;color:${rCol};">${res}</span>`:''}
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;display:flex;gap:0.5rem 0.9rem;flex-wrap:wrap;">
                            <span>📅 ${dateStr}</span>
                            ${score!=='—'?`<span>⚽ <strong style="color:${rCol};">${score}</strong></span>`:''}
                            ${m.category?`<span style="color:#58a6ff;">${typeof escapeHtml==='function'?escapeHtml(m.category):m.category}</span>`:''}
                        </div>
                        ${goals>0?`<div style="font-size:0.7rem;color:#3fb950;margin-top:2px;">⚽ ${goals} goles</div>`:''}
                    </div>
                    <div style="font-size:0.62rem;color:var(--text-muted);text-align:right;flex-shrink:0;">
                        ${m.players.length} jugadores<br>▼ Ver Gantt
                    </div>
                    <div style="display:flex;align-items:center;padding-left:0.5rem;border-left:1px solid rgba(255,255,255,0.08);">
                        <button onclick="event.stopPropagation(); miEliminarInforme('${key64}', true)" 
                                title="Eliminar informe definitivamente"
                                style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);
                                       color:#ff5858;padding:0.4rem;border-radius:6px;cursor:pointer;
                                       display:flex;align-items:center;justify-content:center;transition:all 0.2s;">
                            🗑️
                        </button>
                    </div>
                </div>
                <div id="mi-rp-detail-${key64}"
                     style="display:none;margin-top:0.75rem;border-top:1px solid rgba(255,255,255,0.07);padding-top:0.75rem;">
                </div>
            </div>`;
        }).join('');

        // Toggle con Gantt completo (usa window._sdBuildGantt de 23_staff_dashboard.js)
        window.miToggleInforme = (key64) => {
            const card   = document.getElementById(`mi-rp-${key64}`);
            const detail = document.getElementById(`mi-rp-detail-${key64}`);
            if (!detail) return;
            const isOpen = detail.style.display !== 'none';
            if (!isOpen && !detail.dataset.rendered) {
                const key = decodeURIComponent(escape(atob(key64)));
                const m   = window._misInformesData?.[key];
                if (m) {
                    try {
                        // Usar el motor de reportes unificado (_RP) de 22_club_reports.js
                        if (typeof _RP !== 'undefined' && typeof _RP.build === 'function') {
                            const fullReportHtml = _RP.build(m, window._cronosCurrentUser);
                            
                            // Añadir botones de acción al final del informe visual
                            const btns = `
                            <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.08);">
                                <button onclick="miDescargarInforme('${key64}')"
                                    style="padding:0.5rem 1rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);border-radius:8px;color:#58a6ff;font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;">
                                    📥 Descargar TXT</button>
                                <button onclick="miEliminarInforme('${key64}', true)"
                                    style="padding:0.5rem 1rem;background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);border-radius:8px;color:#ff5858;font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;">
                                    🗑️ Borrar Permanente</button>
                            </div>`;
                            
                            detail.innerHTML = fullReportHtml + btns;
                        } else {
                            throw new Error('Motor de informes no disponible. Reintenta en unos segundos.');
                        }
                    } catch(err) {
                        detail.innerHTML = `<div style="color:#ff5858;font-size:0.8rem;padding:1rem;background:rgba(255,88,88,0.05);border-radius:8px;border:1px solid rgba(255,88,88,0.2);">
                            ⚠️ Error al generar visualización: ${err.message}</div>`;
                    }
                    detail.dataset.rendered = '1';
                }
            }
            detail.style.display = isOpen ? 'none' : 'block';
            if (card) card.style.borderColor = isOpen ? 'rgba(63,185,80,0.15)' : 'rgba(63,185,80,0.55)';
        };

        // ── Exportar informe del entrenador como TXT ──────────────────────
        //  ARREGLADO 2026-07-29. Antes delegaba en `window.sdDownloadInforme`,
        //  que vivia en js/23_staff_dashboard.js y desaparecio al refactorizar
        //  ese archivo: la guarda `typeof` nunca se cumplia y el boton SIEMPRE
        //  salia por el toast de "no disponible". Nunca descargo nada.
        //
        //  Ahora es autocontenido: esta funcion ya tiene el informe en la mano
        //  (`_misInformesData[key]`), asi que el rodeo por `window._sdMatches`
        //  —que solo existia para alimentar a la otra funcion— sobraba.
        //
        //  ⚠️ El TXT NO se genero copiando el de 23_staff_dashboard.js: aquel
        //  imprimia `m.teamName`, campo que ESTE objeto no tiene (se construye
        //  arriba, en openMisInformes), asi que habria escrito siempre
        //  "Equipo". Se usan los campos que el objeto lleva de verdad.
        window.miDescargarInforme = (key64) => {
            const key = decodeURIComponent(escape(atob(key64)));
            const m   = window._misInformesData?.[key];
            if (!m) {
                if (typeof showToast==='function') showToast('⚠️ No se encontró el informe', 2500);
                return;
            }

            const sh = m.scoreHome, sa = m.scoreAway;
            const hayResultado = sh != null && sa != null;
            // MISMA semantica que la tarjeta (mas arriba en este archivo): el
            // resultado depende de myTeamRole, y los informes antiguos que no
            // lo llevan caen a 'home'. Si esto divergiera, el archivo
            // descargado contradiria a la pantalla.
            const mios  = m.myTeamRole === 'away' ? sa : sh;
            const suyos = m.myTeamRole === 'away' ? sh : sa;
            const veredicto = !hayResultado ? ''
                : mios > suyos ? 'VICTORIA' : mios < suyos ? 'DERROTA' : 'EMPATE';
            const fecha = m.matchDate
                ? new Date(m.matchDate + 'T12:00:00').toLocaleDateString('es-ES',
                    { day: '2-digit', month: 'long', year: 'numeric' })
                : '—';

            const L = [];
            L.push('INFORME DE PARTIDO');
            L.push('='.repeat(46));
            L.push(`Rival:        ${m.rival || '—'}`);
            L.push(`Fecha:        ${fecha}${m.matchTime ? ' · ' + m.matchTime : ''}`);
            if (m.competition) L.push(`Competición:  ${m.competition}`);
            if (m.category)    L.push(`Categoría:    ${m.category}`);
            if (m.venue)       L.push(`Campo:        ${m.venue}`);
            L.push(`Localía:      ${m.myTeamRole === 'away' ? 'Visitante' : 'Local'}`);
            L.push(`Resultado:    ${hayResultado ? `${sh} - ${sa}` : '—'}${veredicto ? '  (' + veredicto + ')' : ''}`);
            if (m.coachEmail) L.push(`Entrenador:   ${m.coachEmail}`);
            L.push('');

            const jug = [...m.players].sort((a, b) =>
                (parseInt(a.playerNumber) || 99) - (parseInt(b.playerNumber) || 99));
            const golesTotales = jug.reduce((s, p) => s + (p.goals || 0), 0);
            L.push(`JUGADORES (${jug.length})${golesTotales ? ` · ${golesTotales} goles` : ''}`);
            L.push('-'.repeat(46));
            jug.forEach(p => {
                const tarjeta = p.cards && p.cards !== 'ninguna' ? p.cards : 'ninguna';
                L.push(`#${String(p.playerNumber || '?').padStart(2)} ${(p.playerAlias || 'Jugador')}`);
                L.push(`     Minutos: ${p.minutesPlayed || '0'} | Goles: ${p.goals || 0}`
                     + ` | Tarjeta: ${tarjeta} | Lesión: ${p.injured ? 'sí' : 'no'}`);
                // el historial lleva los eventos con su minuto (gol, tarjeta,
                // lesion), que es justo lo que un TXT puede aportar y el Gantt
                // de la pantalla no deja copiar.
                if (Array.isArray(p.history) && p.history.length) {
                    p.history.forEach(h => L.push(`     · ${h}`));
                }
            });

            L.push('');
            L.push('-'.repeat(46));
            L.push(`Generado por Chronos Fútbol · ${new Date().toLocaleDateString('es-ES')}`);

            // El BOM es el estilo de la casa (ver movement-log.js) y aqui hace
            // falta de verdad: el informe lleva acentos y el Bloc de notas de
            // Windows los rompe sin el.
            const blob = new Blob(['﻿' + L.join('\r\n')], { type: 'text/plain;charset=utf-8' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            const limpio = s => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_');
            a.href = url;
            a.download = `informe_${limpio(m.rival) || 'partido'}_${m.matchDate || 'sin-fecha'}.txt`;
            // ⚠️ adjuntar al DOM antes del click: un `a.click()` suelto —como
            // hacia la version original— no dispara la descarga en Firefox.
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (typeof showToast === 'function') showToast('📥 Informe descargado', 2000);
        };

        // Eliminar informe — FIX v2: SIEMPRE soft delete (dismissedBy)
        // El borrado físico eliminaba el documento para TODOS los roles (Director y
        // Coordinador lo perdían). Ahora se añade el UID del usuario al array
        // `dismissedBy` en Firestore. Así cada rol borra independientemente.
        window.miEliminarInforme = async (key64, realDelete = false) => {
            const key = decodeURIComponent(escape(atob(key64)));
            const m   = window._misInformesData?.[key];
            if (!m) return;
            const me = window._cronosCurrentUser;

            // Soft delete: ocultar SOLO para este usuario
            if (!confirm('¿Deseas ocultar este informe de tu panel? Solo se eliminará para ti; los demás roles seguirán viéndolo.')) return;

            try {
                const { db, doc, updateDoc, arrayUnion } = await _cFS();
                if (typeof showSpinner === 'function') showSpinner('Ocultando informe…');

                const updatePromises = m.players.flatMap(p => {
                    const docIds = [];
                    // Prioridad 1: ID real del documento
                    if (p._id || p.id) docIds.push(p._id || p.id);
                    // Prioridad 2: IDs derivados si matchId es válido
                    const mid = m.matchId;
                    if (mid && mid !== 'undefined' && mid !== '') {
                        const pNum = p.playerNumber || p.number || '';
                        if (pNum) {
                            docIds.push(`${mid}_coach_p${pNum}`);
                            docIds.push(`${mid}_staff_p${pNum}`);
                            docIds.push(`${mid}_p${pNum}`);
                        }
                    }
                    const uniqueIds = [...new Set(docIds)];
                    return uniqueIds.map(docId =>
                        updateDoc(doc(db, 'cronos_player_reports', docId), {
                            dismissedBy: arrayUnion(me.uid)
                        }).catch(err => {
                            console.warn(`[MisInformes] No se pudo ocultar ${docId}:`, err.message);
                        })
                    );
                });
                await Promise.all(updatePromises);

                if (typeof hideSpinner === 'function') hideSpinner();
                if (typeof showToast === 'function') showToast('✅ Informe ocultado de tu panel', 3000);
            } catch (err) {
                if (typeof hideSpinner === 'function') hideSpinner();
                console.error('[MisInformes] Error al ocultar:', err);
                if (typeof showToast === 'function') showToast('⚠️ Error al ocultar: ' + err.message, 3000);
                // Fallback: ocultar localmente aunque falle Firestore
                const dismissed = JSON.parse(localStorage.getItem('cronos_mi_dismissed_info') || '[]');
                if (!dismissed.includes(key)) dismissed.push(key);
                localStorage.setItem('cronos_mi_dismissed_info', JSON.stringify(dismissed));
            }

            // Quitar de la UI
            const card = document.getElementById(`mi-rp-${key64}`);
            if (card) card.remove();
            
            // Actualizar contador
            const currentCount = Object.keys(window._misInformesData).length - 1;
            const body = document.getElementById('mis-informes-body');
            if (body) {
                const title = body.querySelector('div');
                if (title) title.innerHTML = `${currentCount} partido${currentCount!==1?'s':''} · Informes actualizados`;
            }
            
            delete window._misInformesData[key];
        };

        // ── DESCARGA DEL RESUMEN ACUMULADO (PDF / CSV) ────────────────
        // 🔑 Las filas se ACUMULAN AL PULSAR, con la MISMA función que pintó
        // la tabla de pantalla, igual que hace sdExportResumen en el panel de
        // Dirección: si el papel se calculara por otro camino, podría acabar
        // diciendo algo distinto de lo que el entrenador tiene delante.
        window.miExportResumen = (fmt) => {
            const partidos = window._miResumenPartidos || [];
            if (!partidos.length || typeof window.ctAccumulatePlayerStats !== 'function') {
                if (typeof showToast === 'function') showToast('No hay datos que exportar todavía', 3000);
                return;
            }
            const bloque = {
                equipo:   window._miResumenEquipo || 'Mi equipo',
                filas:    window.ctAccumulatePlayerStats(partidos),
                partidos: partidos.length,
            };
            const meta = { club: me.clubName || me.clubId || '', ambito: bloque.equipo };
            if (fmt === 'csv') window.rxExportarResumenCSV([bloque], meta);
            else               window.rxExportarResumenPDF([bloque], meta);
        };

    } catch(e) {
        const body = document.getElementById('mis-informes-body');
        if (body) body.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">⚠️ ${e.message}</div>`;
    }
};

window.openIndividualReports = async function openIndividualReports() {
    const me    = window._cronosCurrentUser;
    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,560px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">
        <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;color:#ffa500;">
                👤 Informes Individuales → Padres
            </h3>
            <button onclick="openUnifiedCommsMenu()"
                style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>
        <div id="indiv-rpt-body" style="flex:1;overflow-y:auto;padding:1rem 1.2rem;">
            <div style="text-align:center;padding:2rem;color:var(--text-muted);">⏳ Cargando vinculaciones…</div>
        </div>
        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);
                    display:flex;gap:0.5rem;flex-shrink:0;">
            <button onclick="openUnifiedCommsMenu()" class="btn" style="color:var(--text-muted);">← Volver</button>
            <button onclick="_sendAllIndividualReports()"
                style="flex:1;padding:0.5rem;background:rgba(255,165,0,0.15);
                       border:1px solid rgba(255,165,0,0.4);border-radius:7px;
                       color:#ffa500;font-weight:700;cursor:pointer;font-size:0.85rem;">
                📤 Enviar todos los informes a padres
            </button>
        </div>
    </div>`;

    const body = document.getElementById('indiv-rpt-body');

    try {
        const { db, collection, getDocs, query, where } = await _cFS();

        // ── Obtener links jugador↔padre de Firestore ──────────────
        const linksSnap = await getDocs(query(
            collection(db,'cronos_player_links'),
            where('clubId','==',me.clubId||'')
        ));
        const links = {};
        linksSnap.forEach(d => { const v=d.data(); links[v.playerNumber]=v; });

        // ── TAMBIÉN: enriquecer con padres de emailConfig.contacts ──
        // Los padres añadidos en "Gestión de Contactos" están en localStorage
        // (emailConfig.contacts con type:'parent' y playerId), no necesariamente
        // en cronos_player_links de Firestore. Los combinamos aquí.
        if (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts)) {
            const squad = window._cronos_squad_cache ||
                JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}')[
                    (typeof currentMode !== 'undefined' ? currentMode : 'f11')] || [];

            emailConfig.contacts.filter(c => c.type === 'parent' && c.playerId).forEach(c => {
                // Buscar el número de dorsal a partir del playerId (ej: "10" o "j-10" → 10)
                const numFromId = parseInt((c.playerId||'').replace(/[^0-9]/g,'')) || null;
                const squadPlayer = squad.find(sp =>
                    sp.id === c.playerId ||
                    String(sp.number) === String(numFromId));
                const playerNum = squadPlayer
                    ? String(squadPlayer.number)
                    : (numFromId ? String(numFromId) : null);
                if (playerNum && !links[playerNum]) {
                    links[playerNum] = {
                        playerNumber: playerNum,
                        playerAlias:  squadPlayer ? (squadPlayer.alias || squadPlayer.name || '') : '',
                        parentUid:    c.uid   || null,
                        parentEmail:  c.email || '',
                        parentPhone:  c.phone || '',
                        parentName:   c.name  || '',
                        clubId:       me.clubId || null,
                        _fromEmailConfig: true,
                    };
                }
            });
        }

        // Jugadores del partido actual
        const players = window.players
            ? window.players.filter(p => p.team===_cMyTeamKey())
            : [];

        if (!players.length) {
            body.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);padding:2rem;">
                ⚠️ No hay datos de partido en curso.<br>
                <span style="font-size:0.78rem;">
                    Inicia un partido o envía los informes justo después de finalizarlo.</span>
            </div>`;
            return;
        }

        const evIcon = { goal:'⚽ GOL', yellow:'🟨 TARJETA', red:'🟥 TARJETA', sub_in:'▼ CAMBIO·Entra', sub_out:'▲ CAMBIO·Sale', injury:'🚑 LESIÓN' };

        body.innerHTML = players.map(p => {
            const link    = links[p.number];
            // Vinculado si tiene uid en app O al menos email/teléfono de contacto
            const linked  = !!(link && (link.parentUid || link.parentEmail || link.parentPhone));
            const mins    = typeof formatTime==='function' ? formatTime(p.time||0) : (p.minutesPlayed||'—');
            const parentLabel = link
                ? (link.parentName  ? link.parentName
                  : link.parentEmail ? link.parentEmail
                  : link.parentPhone  ? link.parentPhone : '')
                : '';
            const inApp = !!(link && link.parentUid);

            // Eventos del jugador
            const events = [];
            (p.history||[]).forEach(ev => {
                if (typeof ev==='object' && ev.type) events.push(ev);
            });
            if (p.subInMinute)  events.push({ minute:p.subInMinute,  type:'sub_in'  });
            if (p.subOutMinute) events.push({ minute:p.subOutMinute, type:'sub_out' });
            if (p.injuryMinute) events.push({ minute:p.injuryMinute, type:'injury'  });
            events.sort((a,b)=>(a.minute||0)-(b.minute||0));

            return `
            <div style="background:${linked?'rgba(255,165,0,0.04)':'rgba(255,255,255,0.02)'};
                        border:1px solid ${linked?'rgba(255,165,0,0.25)':'rgba(255,255,255,0.07)'};
                        border-radius:9px;padding:0.75rem;margin-bottom:0.55rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span style="background:rgba(88,166,255,0.15);color:var(--primary);
                                     font-weight:700;font-size:0.8rem;padding:2px 7px;border-radius:5px;">
                            ${typeof escapeHtml==='function'?escapeHtml(p.name||'Jugador'):(p.name||'Jugador')}
                        </span>
                        <span style="font-weight:700;font-size:0.88rem;">${typeof escapeHtml==='function'?escapeHtml(p.name||'Jugador'):p.name||'Jugador'}</span>
                    </div>
                    <div style="text-align:right;font-size:0.7rem;">
                        ${linked
                            ? (inApp
                                ? `<span style="color:#3fb950;font-weight:700;">✅ App</span><br>
                                   <span style="color:var(--text-muted);">${typeof escapeHtml==='function'?escapeHtml(parentLabel):parentLabel}</span>`
                                : `<span style="color:#f0883e;font-weight:700;">📋 Contacto</span><br>
                                   <span style="color:var(--text-muted);">${typeof escapeHtml==='function'?escapeHtml(parentLabel):parentLabel}</span>`)
                            : `<span style="color:#ff5858;">⚠️ Sin vincular</span>`}
                    </div>
                </div>
                <!-- Stats -->
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;font-size:0.72rem;
                            color:var(--text-muted);margin-bottom:${events.length?'0.4rem':'0'};">
                    <span>⏱ <strong style="color:white;">${mins}</strong></span>
                    ${p.goals>0 ? `<span>⚽ <strong style="color:#ffa500;">${p.goals}</strong></span>` : ''}
                    ${p.cards&&p.cards!=='ninguna' ? `<span>${p.cards==='roja'||p.cards==='red'?'🟥':'🟨'}</span>` : ''}
                    ${p.injured ? '<span>🩹</span>' : ''}
                </div>
                <!-- Timeline individual -->
                ${events.length ? `
                <div style="display:flex;flex-wrap:wrap;gap:0.3rem 0.6rem;
                            font-size:0.69rem;color:var(--text-muted);
                            background:rgba(255,255,255,0.025);
                            border-radius:6px;padding:0.35rem 0.5rem;">
                    ${events.map(ev => `<span><strong style="color:white;">${ev.minute||'?'}'</strong> ${evIcon[ev.type]||'•'}</span>`).join('')}
                </div>` : ''}
            </div>`;
        }).join('');

        // Guardar para el envío
        window._individualReportPlayers = players;
        window._individualReportLinks   = links;

    } catch(e) {
        body.innerHTML = `<div style="text-align:center;color:#ff5858;padding:2rem;">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
    }
};

window._sendAllIndividualReports = async function() {
    const me      = window._cronosCurrentUser;
    const players = window._individualReportPlayers || [];
    const links   = window._individualReportLinks   || {};
    if (!players.length) {
        if (typeof showToast==='function') showToast('⚠️ Sin datos de partido', 3000); return;
    }
    if (typeof showSpinner==='function') showSpinner('Enviando informes individuales…');

    try {
        const { db, doc, setDoc, updateDoc, getDoc, arrayUnion } = await _cFS();
        const rival     = (typeof TEAM_NAMES!=='undefined'&&TEAM_NAMES.away)||'Rival';
        const scoreHome = document.getElementById('score-home')?.textContent||'?';
        const scoreAway = document.getElementById('score-away')?.textContent||'?';
        const matchDate = new Date().toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'});
        // v218: palabras en MAYÚSCULAS + flechas ▲/▼ coherentes con el feed en vivo.
        const evIcon    = { goal:'⚽ GOL', yellow:'🟨 TARJETA', red:'🟥 TARJETA',
                            sub_in:'▼ CAMBIO·Entra', sub_out:'▲ CAMBIO·Sale', injury:'🚑 LESIÓN' };

        let sent = 0;
        const noLinkList = [];

        for (const p of players) {
            const link = links[p.number];
            // Saltar solo si no hay NINGÚN dato de contacto
            if (!link || (!link.parentUid && !link.parentEmail && !link.parentPhone)) {
                noLinkList.push(p.name || 'Jugador');
                continue;
            }

            const mins   = typeof formatTime==='function' ? formatTime(p.time||0) : (p.minutesPlayed||'—');
            const events = [];
            (p.history||[]).forEach(ev => { if (typeof ev==='object'&&ev.type) events.push(ev); });
            if (p.subInMinute)  events.push({ minute:p.subInMinute,  type:'sub_in'  });
            if (p.subOutMinute) events.push({ minute:p.subOutMinute, type:'sub_out' });
            if (p.injuryMinute) events.push({ minute:p.injuryMinute, type:'injury'  });
            events.sort((a,b)=>(a.minute||0)-(b.minute||0));

            const text = `📊 *INFORME INDIVIDUAL: ${p.name}*\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `📅 ${matchDate} · 🆚 vs ${rival} (${scoreHome}-${scoreAway})\n\n` +
                `⏱ Minutos: *${mins}*\n` +
                `⚽ Goles: *${p.goals||0}*\n` +
                `🎴 Tarjeta: *${p.cards&&p.cards!=='ninguna'?p.cards:'Ninguna'}*\n` +
                `🚑 Lesión: *${p.injured?'SÍ':'NO'}*\n` +
                (events.length
                    ? `\n📋 *Acciones:*\n` + events.map(ev => `• ${ev.minute||'?'}' ${evIcon[ev.type]||ev.type}`).join('\n') + '\n'
                    : '') +
                `\n_Cronos Fútbol_ ⚽`;

            // ── Envío in-app (solo si tiene uid registrado en la app) ──
            if (link.parentUid) {
                const threadId = `${me.uid}_${link.parentUid}`;
                const msgEntry = { sender:'coach', type:'individual_report', text, timestamp:new Date().toISOString() };
                const snap     = await getDoc(doc(db,'cronos_messages',threadId));
                if (snap.exists()) {
                    await updateDoc(doc(db,'cronos_messages',threadId), {
                        messages: arrayUnion(msgEntry),
                        lastMessage: `📊 Informe de ${p.name}`,
                        lastMessageAt: msgEntry.timestamp,
                        unreadByParent: (snap.data().unreadByParent||0) + 1,
                        // FIX (v180): campos de identidad
                        parentUid:     link.parentUid,
                        participants:  arrayUnion(me.uid, link.parentUid),
                        clubId:        me.clubId || null,
                        recipientType: 'parent'
                    });
                } else {
                    await setDoc(doc(db,'cronos_messages',threadId), {
                        threadId, coachUid:me.uid, coachEmail:me.email,
                        parentUid:link.parentUid, parentEmail:link.parentEmail||'',
                        recipientType:'parent',
                        // FIX (v180): campos de identidad
                        clubId: me.clubId || null,
                        participants: [me.uid, link.parentUid],
                        messages:[msgEntry],
                        lastMessage:`📊 Informe de ${p.name}`,
                        lastMessageAt:msgEntry.timestamp,
                        unreadByCoach:0, unreadByParent:1,
                    });
                }
                await setDoc(doc(db,'cronos_notifications',`indiv_rpt_${link.parentUid}_${p.number}_${Date.now().toString(36)}`), {
                    type:'informe_partido', clubId:me.clubId||null,
                    userId: link.parentUid,                       // ← FIX (C3): campo que las reglas verifican
                    coachUid: me.uid,                             // ← FIX (C3): coachUid para reglas Firestore
                    parentUid:link.parentUid, playerNumber:p.number, playerAlias:p.name,
                    rival, scoreHome, scoreAway, matchDate, coachEmail:me.email,
                    createdAt:new Date().toISOString(),
                });
            }

            // ── Envío por WhatsApp si tiene teléfono (con/sin uid en app) ──
            if (link.parentPhone) {
                const waNum = link.parentPhone.replace(/\s/g,'');
                setTimeout(() => {
                    window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(text)}`, '_blank');
                }, sent * 800);
            }

            // ── Envío por Email si tiene email y NO tiene uid (si tiene uid, ya llegó in-app) ──
            if (link.parentEmail && !link.parentUid) {
                const subj = encodeURIComponent(`📊 Informe de ${p.name} — ${matchDate}`);
                const body2 = encodeURIComponent(text.replace(/[*_]/g,''));
                setTimeout(() => {
                    window.open(`mailto:${link.parentEmail}?subject=${subj}&body=${body2}`, '_blank');
                }, sent * 800 + 200);
            }

            sent++;
        }

        if (typeof hideSpinner==='function') hideSpinner();
        let msg = `✅ Informes enviados a ${sent} padre(s).`;
        if (noLinkList.length > 0) msg += ` · Sin contacto: ${noLinkList.join(', ')}.`;
        if (typeof showToast==='function') showToast(msg, 6000);
        openUnifiedCommsMenu();
    } catch(e) {
        if (typeof hideSpinner==='function') hideSpinner();
        if (typeof showToast==='function') showToast('⚠️ Error: '+e.message, 4000);
    }
};

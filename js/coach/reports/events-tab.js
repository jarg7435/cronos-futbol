// ════════════════════════════════════════════════════════════════════
//  js/coach/reports/events-tab.js
//  Pestañas "Convocatorias" y "Entrenamientos" del Panel de Dirección:
//  listado de avisos recibidos (_sdLoadEvents), su detalle en overlay
//  (sdViewEventDetail) y el descarte personal de un aviso (sdDeleteNotif).
//
//  Extraído de js/coach/reports/club-reports.js (auditoría 2026-07-22,
//  hallazgo #9 — monolitos sin tests de framework) el 2026-07-26, paso 2 de 6
//  de la descomposición de ese archivo. Movimiento puramente mecánico, sin
//  cambios de lógica.
//
//  ESTRUCTURA: todo es UNA función. sdViewEventDetail y sdDeleteNotif se
//  asignan a window ANIDADOS dentro de _sdLoadEvents, capturando por CIERRE
//  las locales `items`, `type` y `me`. Por eso el bloque es indivisible y no
//  se puede "ordenar" separando los handlers.
//  Nótese que _sdLoadEvents NO tiene línea de export explícita: depende de que
//  una function declaration de nivel superior pase a ser propiedad de window.
//  No añadir una: sería un cambio innecesario.
//
//  ACOPLAMIENTO:
//   · Entrada: switchStaffTab('convocatorias'|'entrenamientos') →
//     _sdLoadEvents('convocatoria'|'planificacion_semanal'). switchStaffTab SE
//     QUEDA en club-reports.js. Además la función se llama a SÍ MISMA para
//     refrescar tras un descarte. Fan-in externo = 0.
//   · Depende de _sdFS() (helper Firestore que SE QUEDA en club-reports.js,
//     6 invocaciones — la del fallback de sdViewEventDetail lo llama tres
//     veces en una sola expresión), escapeHtml/escapeAttr (app-init.js),
//     showToast (match/timer/core.js, aquí sí guardado con typeof) y un
//     import() dinámico DIRECTO de firebase-firestore.js en el fallback de
//     sdDeleteNotif. Todo en tiempo de llamada: el orden de <script> es
//     indiferente.
//
//  ⚠️ AUTO-PURGADO DESTRUCTIVO — LEER ANTES DE TOCAR: por encima de
//  MAX_POR_SUBCAT (50) avisos **en una misma subcategoría**, esta pestaña
//  BORRA de Firestore con deleteDoc los más antiguos DE ESA subcategoría, para
//  TODOS los roles, de forma irreversible, fire-and-forget y con el error
//  silenciado (.catch(()=>{})). Ocurre en cada apertura de la pestaña.
//
//  🔴 v586 · EL TOPE ERA GLOBAL (40 para todo el club) y el autor lo reportó:
//  con hasta 27 equipos compartiendo esos 40 huecos, uno activo borraba las
//  convocatorias de los demás. Ahora cada subcategoría tiene su cupo.
//
//  ⚠️⚠️ Y SI NO SE PUEDE CLASIFICAR, NO SE BORRA NADA. Sin saber de qué equipo
//  es cada registro, "borrar los más antiguos" se lleva por delante al equipo
//  que menos publica. Ante la duda se acumula, que se puede deshacer.
//  Por contraste, sdDeleteNotif NO borra: marca dismissedBy con
//  arrayUnion(me.uid) — descarte personal que no afecta a los demás roles, el
//  borrado lógico que pedía el hallazgo #6 de la auditoría. La aserción 6c
//  impide que alguien lo convierta en un deleteDoc.
//
//  ⚠️ RAMA MUERTA PRESERVADA: isConv se calcula del argumento `type` e isPlan
//  del campo `d.type` del documento. Como las dos consultas filtran por
//  where('type','==',type), todo documento devuelto cumple d.type === type,
//  así que desde la UI sólo se alcanzan dos combinaciones: la tercera rama
//  (el "Entrenamiento" suelto con d.datetime) es INALCANZABLE en producción.
//  Se conserva tal cual — igual que saActivateIndividual en su momento — y el
//  test la ejercita llamando directamente con otro type, documentando su
//  comportamiento sin afirmar que se alcance.
//
//  Cubierto por scripts/test_events_tab_module.js.
// ════════════════════════════════════════════════════════════════════

async function _sdLoadEvents(type) {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');
    // ══════════════════════════════════════════════════════════════════
    //  🔴🔴🔴 v586 · EL TOPE ES DE CADA SUBCATEGORÍA, NO DEL CLUB ENTERO
    //
    //  Reporte del autor (capturas 9283/9284): la cabecera decía
    //  "12 registros · máx. 40" para TODO el árbol. Con 9 categorías × 3
    //  subcategorías eso son hasta 27 equipos compartiendo 40 huecos: un
    //  Alevín C activo se comía el cupo y **borraba de Firestore, para
    //  siempre, las convocatorias de los demás equipos**. Y el borrado es
    //  irreversible y silencioso (`deleteDoc` con el error tragado).
    //
    //  🔑 El cupo pasa a ser POR SUBCATEGORÍA y sube a 50, que es lo que él
    //  pidió: cubre de sobra las 30-35 jornadas de liga de un equipo y sus
    //  semanas de entrenamientos, con margen.
    // ══════════════════════════════════════════════════════════════════
    const MAX_POR_SUBCAT = 50;
    try {
        const { db, collection, getDocs, query, where, orderBy, deleteDoc, doc: firestoreDoc, limit } = await _sdFS();
        const clubId = me.clubId || '';

        // Buscar por clubId O por parentUid (para coordinadores/directores)
        // FIX: filtrar docs donde me.uid está en dismissedBy (borrado "personal" sin afectar a otros)
        let items = [];
        const queries = [
            getDocs(query(collection(db,'cronos_notifications'), where('clubId','==',clubId), where('type','==',type))).catch(()=>null),
            getDocs(query(collection(db,'cronos_notifications'), where('parentUid','==',me.uid), where('type','==',type))).catch(()=>null),
        ];
        const snaps = await Promise.all(queries);
        const seen  = new Set();
        snaps.forEach(snap => {
            if (!snap) return;
            snap.forEach(d => {
                if (seen.has(d.id)) return;
                seen.add(d.id);
                const dat = d.data();
                // Omitir si este usuario ya lo descartó individualmente
                if (Array.isArray(dat.dismissedBy) && dat.dismissedBy.includes(me.uid)) return;
                items.push({ _id: d.id, ...dat });
            });
        });

        items.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

        // ══════════════════════════════════════════════════════════════
        //  CLASIFICAR ANTES DE PURGAR (v586)
        //
        //  El índice de entrenadores y la resolución de categoría vivían más
        //  abajo, DENTRO del bloque que pinta el árbol. Pero para saber qué
        //  sobra hay que saber primero de quién es cada registro, así que
        //  suben aquí. El árbol reutiliza esta misma resolución: se calcula
        //  una vez, no dos.
        //
        //  ⚠️ Es SÓLO el respaldo para el histórico: los avisos nuevos ya
        //  traen category/subcategory en el documento.
        // ══════════════════════════════════════════════════════════════
        const _sdUsaArbol = typeof window.ctRenderTree === 'function' &&
                            typeof window.ctResolveCatSub === 'function';
        let _sdResueltos = null;
        if (_sdUsaArbol) {
            let _sdCoachIndex = new Map();
            try {
                const uSnap = await getDocs(query(collection(db, 'users'),
                    where('clubId', '==', clubId), limit(200)));
                const uDocs = [];
                uSnap.forEach(ud => uDocs.push({ id: ud.id, ...ud.data() }));
                _sdCoachIndex = window.ctBuildCoachIndex(uDocs);
            } catch (_) { /* respaldo ausente: se resuelve con lo que traiga el doc */ }
            _sdResueltos = items.map(it => ({ it: it, r: window.ctResolveCatSub(it, _sdCoachIndex) }));
        }

        // ══════════════════════════════════════════════════════════════
        //  🎯 v593 · EL COORDINADOR DE F7 NO VE LAS DE F11 (y al revés)
        //
        //  Petición del autor: el coordinador absorbe SÓLO los equipos de su
        //  modalidad. La consulta de arriba trae todo el club porque el
        //  Director sí lo necesita, así que el acotamiento se hace aquí, con
        //  el predicado único de utils.js (_cronosVeCategoria).
        //
        //  🔑🔑 VA ANTES DE LA PURGA, Y ESO IMPORTA. Debajo hay un borrado
        //  IRREVERSIBLE del exceso por subcategoría. Si el filtro fuese
        //  después, un coordinador de F7 estaría destruyendo registros de F11
        //  que ni siquiera puede ver — decidiendo sobre datos que no son
        //  suyos. Filtrando antes, sólo purga lo que tiene delante; de lo
        //  demás se encargan el Director o el coordinador de esa modalidad.
        //
        //  ⚠️ Los dos caminos, no sólo el del árbol: sin el módulo cargado se
        //  filtra por el `category` que trae el propio documento. Dejar el
        //  respaldo sin filtro es la forma clásica de que la regla se caiga
        //  justo cuando algo va mal.
        // ══════════════════════════════════════════════════════════════
        const _sdAlcance = (typeof window._cronosCoordScope === 'function')
            ? window._cronosCoordScope(me) : '';
        let _sdOcultos = 0;
        if (_sdAlcance && typeof window._cronosVeCategoria === 'function') {
            if (_sdResueltos) {
                const _antes = _sdResueltos.length;
                _sdResueltos = _sdResueltos.filter(x => window._cronosVeCategoria(me, x.r.cat));
                _sdOcultos = _antes - _sdResueltos.length;
                const _visibles = new Set(_sdResueltos.map(x => x.it));
                items = items.filter(it => _visibles.has(it));
            } else {
                const _antes = items.length;
                items = items.filter(it => window._cronosVeCategoria(me, it.category));
                _sdOcultos = _antes - items.length;
            }
        }

        // ── Auto-borrar el exceso DE CADA SUBCATEGORÍA (v586) ──────────
        //
        //  ⚠️⚠️ SIN CLASIFICACIÓN NO SE BORRA NADA, Y ES DELIBERADO. Antes,
        //  si el módulo del árbol no estaba cargado, se purgaba igualmente
        //  por un tope global. Eso es exactamente lo peligroso: sin saber de
        //  qué equipo es cada registro, "borrar los más antiguos" se lleva por
        //  delante al equipo que menos publica. Este borrado es irreversible;
        //  ante la duda, se acumula —que se puede deshacer— en vez de
        //  destruir —que no—.
        const _purgados = { total: 0, porGrupo: new Map() };
        if (_sdResueltos) {
            const grupos = new Map();   // 'cat|sub' -> [entradas, ya en orden desc]
            _sdResueltos.forEach(x => {
                const k = String(x.r.cat || '?') + '|' + String(x.r.sub || '?');
                if (!grupos.has(k)) grupos.set(k, []);
                grupos.get(k).push(x);
            });
            const _sobran = new Set();
            grupos.forEach((lista, k) => {
                if (lista.length <= MAX_POR_SUBCAT) return;
                lista.slice(MAX_POR_SUBCAT).forEach(x => {
                    _sobran.add(x.it);
                    if (x.it._id) deleteDoc(firestoreDoc(db,'cronos_notifications',x.it._id)).catch(()=>{});
                });
                _purgados.total += lista.length - MAX_POR_SUBCAT;
                _purgados.porGrupo.set(k, lista.length - MAX_POR_SUBCAT);
            });
            if (_sobran.size) {
                items = items.filter(it => !_sobran.has(it));
                _sdResueltos = _sdResueltos.filter(x => !_sobran.has(x.it));
            }
        }

        if (!items.length) {
            const label = type === 'convocatoria' ? 'convocatorias' : 'avisos de entrenamiento';
            // ⚠️ v593 · UN VACÍO POR ACOTAMIENTO NO ES EL MISMO VACÍO. Si al
            // coordinador de F7 le decimos "no hay nada" cuando lo que pasa es
            // que todo lo recibido es de F11, buscará una avería donde no la
            // hay. Se nombra su modalidad y se dice cuántos quedaron fuera.
            const _amb = _sdAlcance
                ? ` de <strong>${escapeHtml(window._cronosCoordScopeLabel(_sdAlcance))}</strong>`
                : '';
            const _resto = (_sdAlcance && _sdOcultos)
                ? `<span style="font-size:0.78rem;margin-top:0.4rem;display:block;color:#f0883e;">
                       Hay ${_sdOcultos} de la otra modalidad: los ve el coordinador que la lleva y el Director Deportivo.
                   </span>`
                : '';
            container.innerHTML = `<div style="text-align:center;padding:4rem;color:var(--text-muted);">
                📭 Sin ${label}${_amb} recibidos aún.<br>
                ${_resto}
                <span style="font-size:0.78rem;margin-top:0.5rem;display:block;">
                    El entrenador debe activar las palomillas en <strong>Gestión de Contactos</strong> y enviar via Envío Interno.
                </span></div>`;
            return;
        }

        const isConv = type === 'convocatoria';
        const accent = isConv ? 'var(--primary)' : '#f0883e';
        const icon   = isConv ? '📋' : '📅';

        // ══════════════════════════════════════════════════════════════
        //  LA CABECERA DICE QUÉ HAY Y DÓNDE APRIETA (v586)
        //
        //  El autor pidió mantener el recuento y mejorarlo. Antes decía
        //  "12 registros · máx. 40" — un número global comparado con un tope
        //  global, que era justo lo incorrecto. Ahora dice:
        //    · CUÁNTAS convocatorias (o entrenamientos) hay en el árbol,
        //      nombrando el tipo en vez de "registros" a secas;
        //    · en cuántas subcategorías están repartidas;
        //    · que el tope es POR subcategoría;
        //    · y, si alguna se acerca al tope, CUÁL — que es la única
        //      información accionable: dice qué equipo va a empezar a perder
        //      los registros más antiguos.
        // ══════════════════════════════════════════════════════════════
        const _sdEtiquetaTipo = isConv ? 'convocatorias' : 'entrenamientos';
        let _sdCabecera = `${items.length} ${_sdEtiquetaTipo}`;
        // v593 · Decir en voz alta que la lista está acotada. Un recuento que
        // no menciona su filtro parece el recuento del club entero.
        if (_sdAlcance) {
            _sdCabecera += ` de <strong style="color:#d2a8ff;">` +
                           escapeHtml(window._cronosCoordScopeLabel(_sdAlcance)) + `</strong>`;
        }
        if (_sdResueltos) {
            const _porGrupo = new Map();
            _sdResueltos.forEach(x => {
                const k = String(x.r.cat || '?') + '|' + String(x.r.sub || '?');
                _porGrupo.set(k, (_porGrupo.get(k) || 0) + 1);
            });
            _sdCabecera += ` en ${_porGrupo.size} subcategoría${_porGrupo.size === 1 ? '' : 's'}` +
                           ` · máx. ${MAX_POR_SUBCAT} por subcategoría`;
            // Al 80% del tope ya conviene avisar: quedan 10 de margen.
            const _alLimite = [];
            _porGrupo.forEach((n, k) => {
                if (n >= Math.floor(MAX_POR_SUBCAT * 0.8)) {
                    const [c, s] = k.split('|');
                    _alLimite.push(`${c} ${s} (${n}/${MAX_POR_SUBCAT})`);
                }
            });
            if (_alLimite.length) {
                _sdCabecera += `<br><span style="color:#f0883e;">⚠️ Cerca del tope: ` +
                               escapeHtml(_alLimite.join(' · ')) +
                               ` — al pasar de ${MAX_POR_SUBCAT} se eliminan los más antiguos de ESA subcategoría.</span>`;
            }
        } else {
            // Sin el módulo del árbol no se clasifica y, por tanto, no se purga.
            _sdCabecera += ' · sin clasificar por subcategoría (no se elimina nada)';
        }
        let html = `<div style="font-size:0.73rem;color:var(--text-muted);margin-bottom:0.8rem;text-align:right;line-height:1.5;">
            ${_sdCabecera}
        </div>`;

        // ⚠️ LA TARJETA DE UN AVISO, EN UN SOLO SITIO (fase 3 del árbol del panel
        // de Dirección, 2026-07-30). Antes este marcado estaba dentro del
        // items.forEach; ahora lo consumen DOS caminos —la lista plana y las hojas
        // del árbol— y tenerlo duplicado garantizaría que las dos vistas se
        // fuesen separando. El contenido no ha cambiado ni un carácter.
        const _sdEventCard = (d) => {
            const date = d.createdAt
                ? new Date(d.createdAt).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})
                : '—';
            const isPlan = d.type === 'planificacion_semanal';
            const title = isConv
                ? (d.rival ? 'vs ' + escapeHtml(d.rival) : 'Partido')
                : isPlan
                    ? (d.weekStartDate
                        ? 'Semana del ' + new Date(d.weekStartDate + 'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})
                        : (d.datetime ? new Date(d.datetime).toLocaleString('es-ES',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Planificación Semanal'))
                    : (d.datetime ? new Date(d.datetime).toLocaleString('es-ES',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Entrenamiento');
            const subLine = isConv
                ? (isConv && d.venue ? ' · 📍 ' + escapeHtml(d.venue) : '')
                : isPlan
                    ? (Array.isArray(d.days) ? d.days.filter(dy=>dy.time||dy.venue).map(dy=>dy.day+': '+[dy.time,dy.venue].filter(Boolean).join(' ')).slice(0,2).join(' | ') : (d.location ? '📍 ' + escapeHtml(d.location) : ''))
                    : (d.location ? ' · 📍 ' + escapeHtml(d.location) : '');

            return `
            <div class="sd-card" style="position:relative;border-left:3px solid ${accent};">
                <!-- Botón eliminar -->
                <button onclick="sdDeleteNotif('${escapeAttr(d._id)}')"
                    title="Eliminar" 
                    style="position:absolute;top:0.6rem;right:0.6rem;background:rgba(255,88,88,0.1);
                           border:1px solid rgba(255,88,88,0.3);color:#ff5858;border-radius:6px;
                           width:28px;height:28px;cursor:pointer;font-size:0.85rem;display:flex;
                           align-items:center;justify-content:center;">🗑️</button>
                <div style="flex:1;min-width:0;padding-right:2rem;">
                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;">
                        <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:4px;
                            background:${isConv?'rgba(88,166,255,0.12)':'rgba(240,136,62,0.12)'};
                            color:${accent};">${icon} ${isConv?'CONVOCATORIA':'ENTRENAMIENTO'}</span>
                        <span style="font-size:0.7rem;color:var(--text-muted);">${date}</span>
                    </div>
                    <div style="font-weight:700;font-size:0.92rem;margin-bottom:0.2rem;">${title}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">
                        ${isConv && d.players ? `👥 ${d.players.length} convocados · ` : ''}
                        ${d.coachEmail ? 'Enviado por ' + escapeHtml(d.coachEmail) : ''}
                        ${subLine}
                    </div>
                </div>
                <button onclick="sdViewEventDetail('${escapeAttr(d._id)}')" class="btn"
                    style="font-size:0.75rem;padding:0.4rem 0.9rem;flex-shrink:0;background:rgba(88,166,255,0.1);
                           border-color:rgba(88,166,255,0.3);color:var(--primary);">
                    👁 Ver</button>
            </div>`;
        };

        // ── ÁRBOL Categoría → Subcategoría (las DOS pestañas) ────────────────
        // Fase 3 (2026-07-30): Entrenamientos. Fase 4: Convocatorias.
        //
        // ⚠️ CONDICIONADO A QUE EL MÓDULO ESTÉ CARGADO, y no por prudencia
        // decorativa: si no lo estuviera, esta pestaña se quedaría en blanco en
        // vez de degradar a la lista de siempre. Es el mismo respaldo que el
        // Admin Individual (ver la aserción 2f de test_category_tree.js), y es
        // además lo que mantiene en verde test_events_tab_module.js, cuyo
        // sandbox NO carga el módulo: quitar este typeof rompe 2 de sus
        // aserciones además de las de test_events_tab_tree.js.
        //
        // ⚠️ NO añadir aquí un filtro por `type`. Las dos pestañas usan el
        // árbol; un filtro dejaría una plana sin que nadie se enterase, y eso
        // es justo lo que fija la aserción 7b del guard.
        //
        // 🔑 v586 · `_sdUsaArbol`, el índice de entrenadores y la resolución de
        // categoría YA SE HAN CALCULADO ARRIBA — hacían falta antes, para poder
        // purgar por subcategoría. Aquí sólo se pinta con lo ya resuelto: si se
        // recalculara, serían dos consultas de usuarios por cada apertura de la
        // pestaña, y las lecturas son lo único que se factura.
        if (_sdUsaArbol && _sdResueltos) {
            html += window.ctRenderTree({
                items:      _sdResueltos,
                getCat:     (x) => x.r.cat,
                getSub:     (x) => x.r.sub,
                renderLeaf: (x) => _sdEventCard(x.it),
                // v593 · Al coordinador de una modalidad no se le enseñan las
                // ramas de la otra a cero: se le enseña SU árbol.
                modalidad:  _sdAlcance,
                emptyText:  isConv ? 'Sin convocatorias en esta subcategoría.'
                                   : 'Sin avisos de entrenamiento en esta subcategoría.',
            });
        } else {
            items.forEach(d => { html += _sdEventCard(d); });
        }
        container.innerHTML = html;

        // ── Detalle completo sin alert() ────────────────────────────────
        window.sdViewEventDetail = async (id) => {
            const snap = items.find(it => it._id === id) ||
                         await (async () => { const s = await (await _sdFS()).getDoc?.((await _sdFS()).doc?.((await _sdFS()).db,'cronos_notifications',id)); return s?.exists()?{_id:id,...s.data()}:null; })().catch(()=>null);
            if (!snap) return;
            const d = snap;
            const isC = d.type === 'convocatoria';
            const isPlan = d.type === 'planificacion_semanal';

            // Mostrar en modal in-app (no alert)
            const overlay = document.createElement('div');
            overlay.id = 'sd-detail-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:1rem;';

            const logo = `<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;justify-content:center;">
                <span style="font-size:1.8rem;">${isC?'📋':'📅'}</span>
                <div>
                    <div style="font-size:1.1rem;font-weight:900;color:${isC?'var(--primary)':'#f0883e'};">CHRONOS FÚTBOL</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">${isC?'CONVOCATORIA':isPlan?'PLANIFICACIÓN SEMANAL':'AVISO DE ENTRENAMIENTO'}</div>
                </div>
            </div>`;

            let body = '';
            if (isC) {
                body = `
                <div style="background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    ${d.matchDate?`<div style="font-size:0.92rem;margin-bottom:0.4rem;">📅 <strong>${escapeHtml(d.matchDate)}</strong></div>`:''}
                    ${d.rival   ?`<div style="font-size:0.92rem;margin-bottom:0.4rem;">🆚 vs <strong>${escapeHtml(d.rival)}</strong></div>`:''}
                    ${d.venue   ?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">🏟️ ${escapeHtml(d.venue)}</div>`:''}
                    ${d.meettime?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">🕐 Presentación: <strong>${escapeHtml(d.meettime)}h</strong></div>`:''}
                    ${d.kickoff ?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">⚽ Inicio: <strong>${escapeHtml(d.kickoff)}h</strong></div>`:''}
                </div>
                ${d.players?.length?`
                <div style="background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    <div style="font-size:0.75rem;font-weight:700;color:#3fb950;margin-bottom:0.6rem;letter-spacing:0.5px;">👥 CONVOCADOS (${d.players.length})</div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0.3rem;">
                        ${d.players.map((p,i)=>{
                            // v428: el dorsal ya viene DENTRO de la cadena guardada
                            // ("15. CUCO"); anteponer ademas el indice de la lista
                            // pintaba dos numeros ("14. 15. CUCO").
                            const f = (typeof window._cronosFormatConvokedPlayer==='function')
                                ? window._cronosFormatConvokedPlayer(p,i)
                                : { num: String(i+1), name: String(p==null?'':p), origin: '' };
                            // ⬆ Jugador de apoyo: su categoría de origen en malva,
                            // para que el Director y el coordinador vean de un
                            // vistazo que no es de la casa y de dónde viene.
                            const org = f.origin
                                ? `<div style="font-size:0.62rem;font-weight:700;color:#d2a8ff;margin-top:1px;">⬆ ${escapeHtml(f.origin)}</div>`
                                : '';
                            return `<div style="font-size:0.82rem;padding:0.2rem 0.4rem;background:${f.origin?'rgba(210,168,255,0.09)':'rgba(255,255,255,0.04)'};border-radius:4px;${f.origin?'border:1px solid rgba(210,168,255,0.28);':''}">${f.num}.${f.name?' '+escapeHtml(f.name):''}${org}</div>`;
                        }).join('')}
                    </div>
                </div>`:''}
                ${d.extra?`<div style="font-size:0.85rem;padding:0.8rem;background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.2);border-radius:8px;font-style:italic;">💬 ${escapeHtml(d.extra)}</div>`:''}`;
            } else if (isPlan && (Array.isArray(d.days) || d.weekStartDate)) {
                // ── Planificación Semanal: tarjetas EN FILA con scroll ───────
                // Rediseño pedido por el autor (2026-07-30). Antes los siete
                // días se apilaban en vertical y quedaban ilegibles en el móvil.
                //
                // ⚠️ CÓMO SE DETECTA UN DÍA DE PARTIDO, y es la limitación real
                // de esto: un día es { day, time, venue, note } y NO HAY NINGÚN
                // CAMPO que diga si hay partido — js/parent/panel.js lo compone
                // leyendo tres inputs de texto libre. Así que se mira el TEXTO
                // de la nota y del sitio. Se respeta además un `kind`
                // estructurado por si algún día se añade al compositor, que es
                // la solución buena; mientras no exista, la heurística es lo
                // único que funciona sobre los planes YA guardados.
                const _esPartido = (dy) => {
                    const k = String(dy.kind || '').trim().toLowerCase();
                    if (k) return k === 'partido' || k === 'liga' || k === 'amistoso' || k === 'match';
                    const txt = (String(dy.note || '') + ' ' + String(dy.venue || '') + ' ' +
                                 String(dy.tipo || '')).toLowerCase();
                    return /\b(partido|amistoso|liga)\b/.test(txt);
                };

                // ⚠️ UN DATO POR LÍNEA: de dónde salen TIPO, MINUTOS y EQUIPACIÓN.
                // El compositor de js/parent/panel.js sólo tiene UN input de texto
                // libre por día, así que esos tres datos viajan juntos dentro de
                // `note` separados por viñetas ("Partido liga • 90 MINUTOS •
                // EQUIP. AZUL"). Por eso hora y lugar ya salían en su línea y
                // estos tres no: no era el layout, era el dato.
                // Se parte por • · | y se clasifica cada trozo por su contenido.
                // Los campos ESTRUCTURADOS que ya usa js/coach/training/panel.js
                // (tipo / duracion / equipaciones) mandan sobre el texto libre.
                const _lineasDe = (dy) => {
                    const out = [];
                    if (dy.time)  out.push('🕐 ' + escapeHtml(dy.time));
                    if (dy.venue) out.push('📍 ' + escapeHtml(dy.venue));

                    const estructurado = dy.tipo || dy.duracion || dy.minutos || dy.equipaciones;
                    if (estructurado) {
                        if (dy.tipo)      out.push('📋 ' + escapeHtml(dy.tipo));
                        const dur = dy.duracion || dy.minutos;
                        if (dur)          out.push('⏱️ ' + escapeHtml(dur));
                        if (dy.equipaciones) out.push('👕 ' + escapeHtml(dy.equipaciones));
                        if (dy.note)      out.push('📝 ' + escapeHtml(dy.note));
                        return out;
                    }

                    const trozos = String(dy.note || '').split(/\s*[•·|]\s*/)
                        .map(s => s.trim()).filter(Boolean);
                    // Una nota suelta es sólo una nota: se deja con 📝 y sin
                    // interpretar (lo fija la aserción 5ac).
                    if (trozos.length === 1) {
                        out.push('📝 ' + escapeHtml(trozos[0]));
                        return out;
                    }
                    trozos.forEach((t, i) => {
                        const low = t.toLowerCase();
                        const icono = /\bmin\w*\b|\bminutos?\b/.test(low) ? '⏱️'
                                    : /equip/.test(low)                   ? '👕'
                                    : i === 0                             ? '📋'
                                    :                                       '📝';
                        out.push(icono + ' ' + escapeHtml(t));
                    });
                    return out;
                };

                const weekDaysHTML = Array.isArray(d.days)
                    ? d.days.map(dy => {
                        // 💤 v604 · "Descanso" pasó a ser un TIPO explícito en la
                        // Planificación Semanal. Se pinta con el mismo
                        // "_Descanso_" de siempre en vez de listarlo como una
                        // actividad más: para quien lee, un día de descanso y un
                        // día vacío significan lo mismo, y mezclarlo con las
                        // sesiones reales haría contar cuatro entrenamientos
                        // donde hay tres.
                        // ⚠️ El tipo viaja dentro de `note` (training-notify.js
                        // lo une con ' · '), así que se mira también ahí.
                        const _esDescanso = /^\s*descanso\b/i.test(String(dy.tipo || '')) ||
                                            /^\s*descanso\s*(·|$)/i.test(String(dy.note || ''));
                        const hasData = !_esDescanso && (dy.time || dy.venue || dy.note ||
                                        dy.tipo || dy.duracion || dy.minutos || dy.equipaciones);
                        const match   = hasData && _esPartido(dy);
                        // Cada dato en SU línea. Se conservan los mismos emojis y
                        // el mismo "_Descanso_" de siempre: hay guards que los
                        // fijan y el contenido no es lo que se rediseña.
                        const detalle = hasData
                            ? _lineasDe(dy).map(l => '<div class="wp-line">' + l + '</div>').join('')
                            : '<div class="wp-line wp-rest">_Descanso_</div>';
                        // data-day identifica la tarjeta sin depender del texto
                        // de dentro: es lo que permite comprobar en el guard qué
                        // día concreto se ha marcado en verde.
                        return '<div class="wp-day' + (match ? ' wp-day-match' : '') + '"'
                            + ' data-day="' + escapeAttr(dy.day || '') + '">'
                            + '<div class="wp-day-head">' + escapeHtml(dy.day || '')
                            + (match ? '<span class="wp-badge">⚽ PARTIDO</span>' : '')
                            + '</div>'
                            + '<div class="wp-day-body">' + detalle + '</div>'
                            + '</div>';
                    }).join('')
                    : '';

                // CSS propio del modal: no hay hoja de estilos que cubra esto y
                // el overlay se cuelga suelto del body.
                const wpCss = '<style>'
                    + '.wp-week{display:flex;flex-direction:row;gap:0.5rem;overflow-x:auto;'
                        + 'padding-bottom:0.5rem;-webkit-overflow-scrolling:touch;}'
                    + '.wp-week::-webkit-scrollbar{height:6px;}'
                    + '.wp-week::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:3px;}'
                    // flex-shrink:0 es lo que hace que el scroll exista: sin esto
                    // los siete días se comprimen y no hay nada que desplazar.
                    + '.wp-day{flex:0 0 auto;flex-shrink:0;min-width:152px;max-width:200px;'
                        + 'border:1px solid rgba(255,255,255,0.10);border-radius:9px;'
                        + 'background:rgba(255,255,255,0.03);overflow:hidden;}'
                    + '.wp-day-head{font-weight:700;font-size:0.78rem;color:#f0883e;'
                        + 'padding:0.4rem 0.55rem;background:rgba(240,136,62,0.10);'
                        + 'border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap;}'
                    // Un dato por línea, pegados al borde izquierdo: align-items
                    // flex-start es lo que impide que las líneas cortas se
                    // centren dentro de la tarjeta.
                    + '.wp-day-body{padding:0.45rem 0.55rem;display:flex;flex-direction:column;'
                        + 'align-items:flex-start;text-align:left;gap:0.28rem;}'
                    + '.wp-line{font-size:0.76rem;color:var(--text,#c9d1d9);word-break:break-word;'
                        + 'text-align:left;width:100%;}'
                    + '.wp-rest{color:#555;font-style:italic;}'
                    // Día con partido: verde del proyecto, en el borde y en la cabecera.
                    + '.wp-day-match{border-color:#3fb950;box-shadow:0 0 0 1px rgba(63,185,80,0.35);}'
                    + '.wp-day-match .wp-day-head{color:#3fb950;background:rgba(63,185,80,0.16);}'
                    + '.wp-badge{display:block;font-size:0.6rem;font-weight:800;letter-spacing:0.5px;'
                        + 'color:#3fb950;margin-top:2px;}'
                    + '</style>';

                body = `
                ${wpCss}
                <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    ${d.weekStartDate?`<div style="font-size:0.9rem;font-weight:700;color:#f0883e;margin-bottom:0.8rem;">📅 Semana del ${new Date(d.weekStartDate+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}</div>`:''}
                    <div class="wp-week">${weekDaysHTML}</div>
                    ${d.location?`<div style="font-size:0.85rem;margin-top:0.5rem;">📍 ${escapeHtml(d.location)}</div>`:''}
                    ${d.notes?`<div style="font-size:0.82rem;margin-top:0.4rem;padding:0.5rem;background:rgba(255,255,255,0.04);border-radius:6px;">📝 ${escapeHtml(d.notes)}</div>`:''}
                </div>`;
            } else {
                const dtFmt = d.datetime
                    ? new Date(d.datetime).toLocaleString('es-ES',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})
                    : d.trainDate || '—';
                body = `
                <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    <div style="font-size:0.92rem;margin-bottom:0.4rem;">📅 <strong>${escapeHtml(dtFmt)}</strong></div>
                    ${d.location||d.venue?`<div style="font-size:0.88rem;margin-bottom:0.4rem;">📍 ${escapeHtml(d.location||d.venue)}</div>`:''}
                    ${d.notes  ?`<div style="font-size:0.88rem;margin-top:0.4rem;padding:0.6rem;background:rgba(255,255,255,0.04);border-radius:6px;">📝 ${escapeHtml(d.notes)}</div>`:''}
                </div>`;
            }

            overlay.innerHTML = `
            <div style="width:min(92vw,540px);background:var(--surface,#161b22);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:1.4rem;margin:auto;">
                ${logo}
                ${body}
                <div style="text-align:right;margin-top:1rem;">
                    <span style="font-size:0.7rem;color:var(--text-muted);">Enviado: ${d.createdAt?new Date(d.createdAt).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}</span>
                </div>
                <button onclick="(function(){var el=document.getElementById('sd-detail-overlay');if(el)el.remove();})()"
                    style="width:100%;margin-top:0.9rem;padding:0.6rem;background:rgba(88,166,255,0.15);
                           border:1px solid rgba(88,166,255,0.3);border-radius:8px;color:var(--primary);
                           font-weight:700;cursor:pointer;font-size:0.88rem;">
                    ✕ Cerrar
                </button>
            </div>`;
            document.body.appendChild(overlay);
        };

        // ── Eliminar notificación ────────────────────────────────────────
        // FIX: "borrar" = marcar como descartado por este usuario (no borra para los demás)
        window.sdDeleteNotif = async (id) => {
            if (!confirm('¿Quitar este aviso de tu panel? Los demás roles seguirán viéndolo.')) return;
            try {
                const { db: db2, doc: dRef, updateDoc: upd, arrayUnion: au } = await _sdFS();
                await upd(dRef(db2, 'cronos_notifications', id), {
                    dismissedBy: au(me.uid)
                });
                items = items.filter(it => it._id !== id);
                await _sdLoadEvents(type);
                if (typeof showToast === 'function') showToast('🗑️ Quitado de tu panel', 2000);
            } catch(e) {
                // Fallback: si el campo arrayUnion falla (doc sin el campo), intentar con set merge
                try {
                    const { db: db3, doc: dRef3 } = await _sdFS();
                    const { updateDoc, arrayUnion } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    await updateDoc(dRef3(db3, 'cronos_notifications', id), { dismissedBy: arrayUnion(me.uid) });
                    items = items.filter(it => it._id !== id);
                    await _sdLoadEvents(type);
                    if (typeof showToast === 'function') showToast('🗑️ Quitado de tu panel', 2000);
                } catch(e2) {
                    if (typeof showToast === 'function') showToast('⚠️ Error: ' + e2.message, 3000);
                }
            }
        };

    } catch(e) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">⚠️ ${escapeHtml(e.message)}</div>`;
    }
}

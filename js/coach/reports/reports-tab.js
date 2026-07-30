// ════════════════════════════════════════════════════════════════════
//  js/coach/reports/reports-tab.js
//  Pestaña "Informes" del Panel de Dirección: reúne los informes colectivos
//  de partido que envían los entrenadores (_sdLoadReports), los despliega
//  bajo demanda renderizando el informe visual completo (sdToggleReport) y
//  permite ocultarlos del panel de forma individual por rol (sdDeleteReport).
//
//  Extraído de js/coach/reports/club-reports.js (auditoría 2026-07-22,
//  hallazgo #9 — monolitos sin tests de framework) el 2026-07-26, paso 5 de 6
//  de la descomposición de ese archivo. Movimiento puramente mecánico, sin
//  cambios de lógica.
//
//  ACOPLAMIENTO:
//   · Entrada única: switchStaffTab('informes') → _sdLoadReports().
//     switchStaffTab SE QUEDA en club-reports.js. Fan-in externo = 0:
//     comms/panel.js nombra _sdLoadReports tres veces, pero LAS TRES SON
//     COMENTARIOS (la aserción 1d del test distingue código de comentario).
//   · Depende de _sdFS() (helper Firestore que SE QUEDA en club-reports.js),
//     escapeHtml (app-init.js), showToast/showSpinner/hideSpinner
//     (match/timer/core.js, todos con guarda typeof), window._cResolveClubId
//     (comms/panel.js), window._CRONOS_DEBUG (app-init.js) y sobre todo
//     _RP.build() del motor de informes (report-engine.js, paso 4), que se
//     carga antes que este archivo.
//
//  LECTURA MULTI-CLUBID: el clubId del entrenador y el del director pueden
//  diferir por inconsistencias históricas en users/{uid}, así que la carga
//  descubre clubIds alternativos en tres saltos (allRoles del propio doc →
//  usuarios que tengan alguno de esos clubIds → usuarios con el mismo email) y
//  consulta cronos_player_reports por cada uno. OJO: el segundo salto itera
//  sobre una FOTO del conjunto tomada tras el primero, así que un usuario cuyo
//  clubId no estuviera ya dentro no se descubre nunca. Cada consulta tiene dos
//  fallbacks en cascada (sin orderBy, y sin el filtro staffReport) para el caso
//  de que el índice compuesto no esté desplegado, más un último recurso por
//  staffUids. Todo eso lo fija la parte 3 y 4 del test: no simplificarlo a una
//  sola query sin comprobar que el filtrado en cliente se mantiene.
//
//  BORRADO LÓGICO POR ROL: sdDeleteReport NO borra nada. Añade `uid_rol` al
//  array dismissedBy vía arrayUnion, sobre varios ids candidatos por jugador
//  (el id real del documento y los derivados de matchId), cada uno con su
//  propio catch para que un fallo aislado no aborte el resto. El filtro de
//  lectura excluye por esa misma clave, de modo que Director y Coordinador
//  ocultan informes de forma independiente. La aserción 8b impide que alguien
//  lo convierta en un deleteDoc.
//
//  ⚠️ REGRESIÓN PREEXISTENTE QUE VIAJA CON ESTE CÓDIGO (no corregida aquí):
//  el dismissKey se construye leyendo un campo `currentRole` del usuario, pero
//  `currentRole` NO es un campo que la app rellene — el fix v269 lo cambió a
//  `_activeRole` y ese cambio no está en el código. Efecto real: una cuenta con
//  doble rol (mismo uid como Director y como Coordinador) genera LA MISMA
//  clave para ambos, así que ocultar un informe como Director lo oculta también
//  como Coordinador, justo lo que los comentarios de la propia función dicen
//  querer evitar. scripts/test_v269_fixes.js lo señala y SIGUE EN ROJO a
//  propósito: se le enseñó a leer también este archivo para que mover el código
//  no convirtiera su contador en un falso verde.
//
//  ⚠️ FRAGILIDAD PREEXISTENTE: el orden de los encuentros usa
//  `(b.createdAt || '').localeCompare(...)`, que asume que createdAt es un
//  STRING. Un createdAt numérico lanza TypeError y tumba la pestaña entera por
//  el catch general (aserción 8h). finished-matches-tab.js sí tolera number y
//  {seconds}; aquí no.
//
//  Cubierto por scripts/test_reports_tab_module.js.
// ════════════════════════════════════════════════════════════════════

async function _sdLoadReports() {
    const me        = window._cronosCurrentUser;
    const container = document.getElementById('staff-dashboard-content');

    // FIX (v179): Intentar resolver clubId si no está disponible.
    // Esto cubre el caso donde openStaffDashboard no pudo resolverlo
    // (p.ej. _cResolveClubId no estaba disponible aún).
    let clubId = me.clubId;
    if (!clubId && me && me.uid && typeof window._cResolveClubId === 'function') {
        try {
            const { doc, getDoc } = await _sdFS();
            const db = window._cronos_auth?.db;
            if (db) {
                clubId = await window._cResolveClubId(db, me, { doc, getDoc });
                if (clubId) me.clubId = clubId;
            }
        } catch(e) {
            if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][_sdLoadReports] clubId resolution falló:', e.message);
        }
    }

    if (!clubId) {
        container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">
            ⚠️ Sin club asignado. Usa el modo prueba para seleccionar un club.</div>`;
        return;
    }

    try {
        const { db, collection, getDocs, query, where, orderBy, limit, doc, getDoc } = await _sdFS();

        // FIX (v179): Query multi-clubId para acceder a informes de staff.
        // PROBLEMA IDENTIFICADO: El clubId del entrenador y el del director
        // pueden ser DIFERENTES si hay inconsistencias en los documentos users/{uid}.
        // El entrenador escribe informes con SU clubId, el director busca con SU clubId
        // → nunca coinciden.
        // SOLUCIÓN: Descubrir TODOS los clubIds del club consultando la colección
        // 'clubs' y los documentos de entrenadores, y hacer queries por cada uno.

        // FIX (v179): Recopilar clubIds alternativos del mismo club.
        // PROBLEMA: El clubId del entrenador y el del director pueden ser
        // DIFERENTES (p.ej. club_mq1hzm6o_1j6j vs club_mqlhzm6o_ij6j)
        // porque el campo se asignó de forma inconsistente.
        // ESTRATEGIA:
        // 1. Leer allRoles del director → obtener todos sus clubIds
        // 2. Para cada clubId encontrado, buscar usuarios con ese clubId
        // 3. Recopilar TODOS los clubIds de todos esos usuarios (incluidos los de allRoles)
        // 4. Consultar informes por cada clubId encontrado
        const _allClubIds = new Set([clubId]);

        // Paso 1: Leer allRoles del propio director
        try {
            const myDoc = await getDoc(doc(db, 'users', me.uid));
            if (myDoc.exists()) {
                const myData = myDoc.data();
                // ClubId raíz
                if (myData.clubId) _allClubIds.add(myData.clubId);
                // ClubIds de allRoles
                if (myData.allRoles && Array.isArray(myData.allRoles)) {
                    myData.allRoles.forEach(r => {
                        if (r.clubId) _allClubIds.add(r.clubId);
                    });
                }
            }
        } catch(_) {}

        // Documentos de usuario que ya se leen aquí abajo. Antes se usaban SÓLO
        // para recopilar clubIds y se tiraban; ahora alimentan también el índice
        // de entrenadores del árbol (fase 5), así que NO hace falta una consulta
        // nueva para eso.
        const _sdUserDocs = [];

        // Paso 2: Para cada clubId, buscar usuarios y recopilar SUS clubIds
        const _initialClubIds = [..._allClubIds];
        for (const cid of _initialClubIds) {
            try {
                const usersSnap = await getDocs(query(
                    collection(db, 'users'),
                    where('clubId', '==', cid),
                    limit(200)
                ));
                usersSnap.forEach(d => {
                    const data = d.data();
                    _sdUserDocs.push({ id: d.id, ...data });
                    if (data.clubId) _allClubIds.add(data.clubId);
                    if (data.allRoles && Array.isArray(data.allRoles)) {
                        data.allRoles.forEach(r => {
                            if (r.clubId) _allClubIds.add(r.clubId);
                        });
                    }
                });
            } catch(e) {
                if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] No se pudieron buscar usuarios con clubId', cid, ':', e.code || e.message);
            }
        }

        // Paso 3 (FIX v179): Buscar por email del propio director para encontrar
        // otros documentos de usuario con el mismo email (caso multi-rol donde
        // el mismo email tiene clubIds diferentes). Esto cubre el caso donde
        // el director y entrenador comparten email pero tienen clubIds distintos.
        try {
            if (me.email) {
                const emailSnap = await getDocs(query(
                    collection(db, 'users'),
                    where('email', '==', me.email),
                    limit(10)
                ));
                emailSnap.forEach(d => {
                    const data = d.data();
                    if (data.clubId) _allClubIds.add(data.clubId);
                    if (data.allRoles && Array.isArray(data.allRoles)) {
                        data.allRoles.forEach(r => {
                            if (r.clubId) _allClubIds.add(r.clubId);
                        });
                    }
                });
            }
        } catch(e) {
            if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] Búsqueda por email falló:', e.code || e.message);
        }


        // FIX (v179): Consultar por TODOS los clubIds encontrados
        const combinedDocs = [];
        const seenIds = new Set();
        let _clubQueryOk = false;

        for (const cid of _allClubIds) {
            // FIX (limit-500): el club puede tener MILES de docs (informes de
            // staff + coach + padres de muchos partidos). La query antigua
            //   where(clubId==cid).limit(500)
            // traía 500 docs SIN orden, que se llenaban con _coach_pN / _parent_*
            // y partidos antiguos; tras el filtro cliente staffReport===true al
            // director le quedaban muy pocos (o 1) partido visible. Ahora la query
            // PRIMARIA filtra ya por staffReport==true y ordena por createdAt desc,
            // así el limit se gasta SOLO en docs útiles del panel de staff.
            // Requiere el índice compuesto (clubId, staffReport, createdAt desc).
            // Si el índice aún no está desplegado (failed-precondition), se hace
            // fallback a la query antigua sin orderBy para no romper nada.
            try {
                const snap = await getDocs(query(
                    collection(db, 'cronos_player_reports'),
                    where('clubId', '==', cid),
                    where('staffReport', '==', true),
                    orderBy('createdAt', 'desc'),
                    limit(500)
                ));
                _clubQueryOk = true;
                snap.forEach(d => {
                    if (!seenIds.has(d.id)) {
                        seenIds.add(d.id);
                        combinedDocs.push(d);
                    }
                });
            } catch (clubErr) {
                const _code = clubErr.code || clubErr.message || '';
                if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] Query staff por clubId', cid, 'FALLÓ:', _code, '— intentando fallback sin orderBy');
                // Fallback A: misma query sin orderBy (cubre el caso de índice no
                // desplegado; sigue filtrando por staffReport para no saturar limit).
                try {
                    const snapA = await getDocs(query(
                        collection(db, 'cronos_player_reports'),
                        where('clubId', '==', cid),
                        where('staffReport', '==', true),
                        limit(500)
                    ));
                    _clubQueryOk = true;
                    snapA.forEach(d => {
                        if (!seenIds.has(d.id)) { seenIds.add(d.id); combinedDocs.push(d); }
                    });
                } catch (clubErr2) {
                    // Fallback B: query original (sin filtro staffReport). Último
                    // recurso para clubs pequeños / reglas que no permitan el filtro.
                    if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] Fallback staff también falló:', clubErr2.code || clubErr2.message, '— usando query legacy');
                    try {
                        const snapB = await getDocs(query(
                            collection(db, 'cronos_player_reports'),
                            where('clubId', '==', cid),
                            limit(500)
                        ));
                        _clubQueryOk = true;
                        snapB.forEach(d => {
                            if (!seenIds.has(d.id)) { seenIds.add(d.id); combinedDocs.push(d); }
                        });
                    } catch (clubErr3) {
                        if(window._CRONOS_DEBUG) console.warn('[StaffDashboard][DIAG] Query legacy por clubId', cid, 'FALLÓ:', clubErr3.code || clubErr3.message);
                    }
                }
            }
        }

        let rawSnap = { forEach: (fn) => combinedDocs.forEach(fn) };

        // Contar docs de staff
        let _clubQueryDocCount = 0;
        let _hasStaffDocs = false;
        let _staffDocCount = 0;
        rawSnap.forEach(d => {
            _clubQueryDocCount++;
            if (d.data().staffReport === true) { _hasStaffDocs = true; _staffDocCount++; }
        });

        // Si aún no hay docs de staff, intentar por staffUids
        if ((!_hasStaffDocs || !_clubQueryOk) && me.uid) {
            try {
                const altSnap = await getDocs(query(
                    collection(db, 'cronos_player_reports'),
                    where('staffUids', 'array-contains', me.uid),
                    limit(500)
                ));
                let _altCount = 0;
                altSnap.forEach(d => _altCount++);
                // Fusionar resultados alternativos con los originales
                const existingIds = new Set();
                rawSnap.forEach(d => existingIds.add(d.id));
                altSnap.forEach(d => {
                    if (!existingIds.has(d.id) && d.data().staffReport === true) {
                        // Añadir docs que no estaban en el snap original
                        _hasStaffDocs = true;
                    }
                });
                // Usar el snap alternativo si tiene resultados de staff
                if (_hasStaffDocs) {
                    // Combinar ambos snaps
                    const combinedDocs = [];
                    rawSnap.forEach(d => combinedDocs.push(d));
                    const existingIds2 = new Set(combinedDocs.map(d => d.id));
                    altSnap.forEach(d => {
                        if (!existingIds2.has(d.id)) combinedDocs.push(d);
                    });
                    rawSnap = { forEach: fn => combinedDocs.forEach(fn) };
                }
            } catch(altErr) {
                console.warn('[StaffDashboard] Query alternativa por staffUids falló:', altErr.message);
            }
        }

        // Filtrar en cliente: solo documentos del panel de staff (staffReport=true)
        // FIX v3: Solo usar dismissKey con rol (uid_role) para el filtro.
        // Así Director y Coordinador pueden borrar de forma INDEPENDIENTE:
        // el borrado del Director añade "uid_director" y el del Coordinador
        // añade "uid_coordinador". Cada uno solo ve su propia clave.
        // IMPORTANTE: NO filtrar por me.uid a secas porque si dos roles
        // comparten el mismo uid (o versiones antiguas lo guardaron sin rol)
        // se borraría para ambos.
        const currentRole = me.currentRole || me.role || 'staff';
        const dismissKey = `${me.uid}_${currentRole}`;

        const snap = { empty: true, forEach: (fn) => {
            rawSnap.forEach(d => {
                const data = d.data();
                const dismissed = data.dismissedBy || [];
                // Solo excluir si contiene la clave específica de rol de este usuario
                if (data.staffReport === true && !dismissed.includes(dismissKey)) fn(d);
            });
        }};
        // Recalcular si está vacío
        let _snapHasDocs = false;
        rawSnap.forEach(d => {
            const data = d.data();
            const dismissed = data.dismissedBy || [];
            if (data.staffReport === true && !dismissed.includes(dismissKey)) _snapHasDocs = true;
        });
        Object.defineProperty(snap, 'empty', { get: () => !_snapHasDocs });

        if (snap.empty) {
            container.innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:1rem;">📊</div>
                <div style="font-size:0.95rem;font-weight:600;margin-bottom:0.4rem;">Sin informes de partido aún</div>
                <div style="font-size:0.8rem;">Los informes aparecen aquí cuando un entrenador finaliza un partido
                    y pulsa <strong>"Enviar Informe"</strong> en la app.</div>
            </div>`;
            return;
        }

        // ── Agrupar documentos por partido (fecha + rival + coach) ───
        const matches = {};
        snap.forEach(docSnap => {
            const r   = { _id: docSnap.id, ...docSnap.data() };
            const key = `${r.matchDate || 'sin-fecha'}_${r.rival || 'sin-rival'}_${r.coachUid || ''}`;
            if (!matches[key]) {
                matches[key] = {
                    key,
                    matchId:       r.matchId || r._id || '',
                    matchDate:     r.matchDate,
                    rival:         r.rival,
                    scoreHome:     r.scoreHome,
                    scoreAway:     r.scoreAway,
                    myTeamRole:    r.myTeamRole,   // FIX: propagar rol del equipo para el cálculo V/D/E correcto (visitante)
                    coachEmail:    r.coachEmail,
                    coachUid:      r.coachUid,
                    createdAt:     r.createdAt,
                    // Campos opcionales (enriquecen la cabecera)
                    category:      r.category,
                    // ⚠️ subcategory se PERDÍA aquí (fase 2 del árbol del panel
                    // de Dirección, 2026-07-30). El dato SÍ está en Firestore
                    // —lo escriben collective-report.js y match-reports-*.js—
                    // pero este objeto agrupado por partido no lo copiaba, así
                    // que al agrupar por el árbol TODOS los informes habrían
                    // caído en "Sin clasificar" pareciendo un fallo del árbol.
                    subcategory:   r.subcategory,
                    venue:         r.venue,
                    competition:   r.competition,
                    matchTime:     r.matchTime,
                    duration:      r.duration,
                    stoppageTime:  r.stoppageTime,
                    players:       [],
                };
            }
            matches[key].players.push(r);
            // FIX: si el objeto agrupado aún no tiene myTeamRole pero este doc sí,
            // adoptarlo (algunos docs antiguos del mismo partido pueden no llevarlo).
            if (matches[key].myTeamRole == null && r.myTeamRole != null) {
                matches[key].myTeamRole = r.myTeamRole;
            }
        });

        // Ordenar por fecha descendente
        const sorted = Object.values(matches).sort((a, b) =>
            (b.createdAt || '').localeCompare(a.createdAt || ''));

        // Mapa global de datos de partido para renderizado lazy
        window._sdMatchData = {};

        let html = `
        <div style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;font-size:0.95rem;color:white;">
                📊 Informes — ${sorted.length} encuentro${sorted.length !== 1 ? 's' : ''}
            </h3>
            <span style="font-size:0.73rem;color:var(--text-muted);">
                Club: <strong style="color:var(--primary);">${escapeHtml(me.clubName||clubId)}</strong>
            </span>
        </div>`;

        // ⚠️ _sdMatchData se rellena en SU PROPIA pasada, antes de pintar (fase 5).
        // Antes se rellenaba dentro del bucle de render; ahora hay dos caminos de
        // render (árbol y lista plana) y sdToggleReport / sdDeleteReport dependen
        // de este mapa, así que no puede quedar a merced de por dónde se pinte.
        const _sdKey64 = (m) => btoa(unescape(encodeURIComponent(m.key))).replace(/=/g, '');
        sorted.forEach(m => { window._sdMatchData[_sdKey64(m)] = m; });

        // ⚠️ LA TARJETA DE UN INFORME, EN UN SOLO SITIO (fase 5). La consumen la
        // lista plana y las hojas del árbol; duplicarla haría que las dos vistas
        // se fueran separando. El contenido no ha cambiado.
        const _sdReportCard = (m) => {
            const goals   = m.players.reduce((s, p) => s + (p.goals || 0), 0);
            const injured = m.players.filter(p => p.injured).length;
            const dateStr = m.matchDate
                ? new Date(m.matchDate).toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })
                : '—';
            const sh = m.scoreHome, sa = m.scoreAway;
            const score = (sh != null && sa != null) ? `${sh} – ${sa}` : '—';
            // Resultado según myTeamRole; sin el campo (informes antiguos) → fallback 'home', comportamiento previo.
            const _mine   = m.myTeamRole === 'away' ? sa : sh;
            const _theirs = m.myTeamRole === 'away' ? sh : sa;
            const res   = (sh != null && sa != null) ? (_mine > _theirs ? 'VICTORIA' : _mine < _theirs ? 'DERROTA' : 'EMPATE') : '';
            const rCol  = res === 'VICTORIA' ? '#3fb950' : res === 'DERROTA' ? '#ff5858' : '#eab308';
            const key64 = _sdKey64(m);

            return `
            <div class="sd-report-card" id="rcard-${key64}" onclick="sdToggleReport('${key64}')">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:1rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                            🆚 vs <span style="color:var(--primary);">${escapeHtml(m.rival||'Sin rival')}</span>
                            ${res ? `<span style="font-size:0.65rem;font-weight:700;letter-spacing:0.5px;color:${rCol};">${res}</span>` : ''}
                        </div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;display:flex;flex-wrap:wrap;gap:0.3rem 0.8rem;">
                            <span>📅 ${dateStr}</span>
                            ${score !== '—' ? `<span>⚽ <strong style="color:${rCol};">${score}</strong></span>` : ''}
                            ${m.category ? `<span style="color:#58a6ff;">${escapeHtml(m.category)}</span>` : ''}
                            <span>👤 ${escapeHtml(m.coachEmail||'Entrenador')}</span>
                        </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
                        <span class="sd-badge" style="background:rgba(63,185,80,0.12);color:#3fb950;">${m.players.length} jugadores</span>
                        ${goals > 0 ? `<span class="sd-badge" style="background:rgba(255,165,0,0.12);color:#ffa500;">⚽ ${goals} gol${goals !== 1 ? 'es' : ''}</span>` : ''}
                        ${injured > 0 ? `<span class="sd-badge" style="background:rgba(249,115,22,0.12);color:#f97316;">🩹 ${injured} lesión${injured > 1 ? 'es' : ''}</span>` : ''}
                        <div style="font-size:0.62rem;color:var(--text-muted);margin-top:2px;">▼ Ver informe completo</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.5rem;padding-left:0.5rem;border-left:1px solid rgba(255,255,255,0.08);">
                        <button onclick="event.stopPropagation(); sdDeleteReport('${key64}')" 
                                title="Eliminar este informe definitivamente"
                                style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);
                                       color:#ff5858;padding:0.4rem;border-radius:6px;cursor:pointer;
                                       display:flex;align-items:center;justify-content:center;transition:all 0.2s;">
                            🗑️
                        </button>
                    </div>
                </div>
                <!-- Panel de detalle: vacío hasta el primer click (lazy render) -->
                <div id="rdetail-${key64}"
                     style="display:none;margin-top:0.8rem;border-top:1px solid var(--glass-border);padding-top:0.8rem;">
                </div>
            </div>`;
        };

        // ── ÁRBOL Categoría → Subcategoría, con la TABLA RESUMEN arriba ──────
        // Fase 5 (2026-07-30). Dentro de cada subcategoría, y en este orden:
        //   1. el resumen acumulado de temporada de ese equipo (ctRenderStatsTable)
        //   2. el listado de informes partido a partido, que es el de siempre
        //
        // ⚠️ CONDICIONADO A QUE EL MÓDULO ESTÉ CARGADO: si no, se pinta la lista
        // plana de siempre en vez de dejar la pestaña en blanco. Mismo respaldo
        // que en events-tab.js, y por la misma razón — hay guards cuyo sandbox
        // no carga el módulo.
        const _sdUsaArbol = typeof window.ctRenderTree === 'function' &&
                            typeof window.ctResolveCatSub === 'function' &&
                            typeof window.ctAccumulatePlayerStats === 'function' &&
                            typeof window.ctRenderStatsTable === 'function';

        if (_sdUsaArbol) {
            // Índice de entrenadores para completar los informes históricos a los
            // que _cMatchSubcatFor dejó la subcategoría vacía. Sale de los
            // documentos de usuario que ya se leyeron arriba: sin consulta nueva.
            let _sdCoachIndex = new Map();
            try { _sdCoachIndex = window.ctBuildCoachIndex(_sdUserDocs); } catch (_) {}

            const _sdResueltos = sorted.map(m => ({ m: m, r: window.ctResolveCatSub(m, _sdCoachIndex) }));
            html += window.ctRenderTree({
                items:      _sdResueltos,
                getCat:     (x) => x.r.cat,
                getSub:     (x) => x.r.sub,
                // 🔑 La tabla es POR EQUIPO, así que va en renderSubHeader y no en
                // renderLeaf: se calcula con TODOS los partidos de esa rama.
                renderSubHeader: (arr) =>
                    window.ctRenderStatsTable(window.ctAccumulatePlayerStats(arr.map(x => x.m))),
                renderLeaf: (x) => _sdReportCard(x.m),
                emptyText:  'Sin informes de este equipo todavía.',
            });
        } else {
            sorted.forEach(m => { html += _sdReportCard(m); });
        }

        container.innerHTML = html;

        // ── Toggle con renderizado lazy del informe visual ────────────
        window.sdToggleReport = (key64) => {
            const card   = document.getElementById(`rcard-${key64}`);
            const detail = document.getElementById(`rdetail-${key64}`);
            if (!detail) return;
            const isOpen = detail.style.display !== 'none';
            // Renderizar el informe completo solo en el primer click
            if (!isOpen && !detail.dataset.rendered) {
                const matchData = window._sdMatchData && window._sdMatchData[key64];
                if (matchData) {
                    try {
                        detail.innerHTML = _RP.build(matchData, window._cronosCurrentUser);
                    } catch (err) {
                        detail.innerHTML = `<div style="color:#ff5858;font-size:0.8rem;">⚠️ Error al generar informe: ${err.message}</div>`;
                    }
                    detail.dataset.rendered = '1';
                }
            }
            detail.style.display = isOpen ? 'none' : 'block';
            if (card) card.style.borderColor = isOpen ? 'rgba(88,166,255,0.15)' : 'rgba(88,166,255,0.55)';
        };

        // ── Función para ocultar informe del panel ──────────────
        // FIX v2: Soft delete — añade el UID del usuario a dismissedBy.
        // Así cada rol (Director/Coordinador) borra independientemente.
        // El documento no se elimina físicamente, solo se oculta para este usuario.
        // Solo el coach autor (coachUid) puede eliminar físicamente.
        window.sdDeleteReport = async (key64) => {
            if (!confirm('¿Deseas ocultar este informe de tu panel? Solo se eliminará para ti; los demás roles seguirán viéndolo.')) return;
            
            const currentRole = me.currentRole || me.role || 'staff';
            const dismissKey = `${me.uid}_${currentRole}`;

            const match = window._sdMatchData[key64];
            if (!match) return;
            
            try {
                const { db, doc, updateDoc, arrayUnion } = await _sdFS();
                if (typeof showSpinner === 'function') showSpinner('Ocultando informe…');
                
                // Añadir mi UID a dismissedBy en cada documento de jugador
                // Usar SIEMPRE el ID real del documento (p._id), no construir IDs
                // con matchId que puede ser undefined
                const updatePromises = match.players.flatMap(p => {
                    const docIds = [];
                    // Prioridad 1: ID real del documento
                    if (p._id || p.id) docIds.push(p._id || p.id);
                    // Prioridad 2: IDs derivados si matchId es válido
                    const mid = match.matchId;
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
                            dismissedBy: arrayUnion(dismissKey)
                        }).catch(err => {
                            console.warn(`[StaffDashboard] No se pudo ocultar ${docId}:`, err.message);
                        })
                    );
                });
                
                await Promise.all(updatePromises);
                
                if (typeof hideSpinner === 'function') hideSpinner();
                if (typeof showToast === 'function') showToast('✅ Informe ocultado de tu panel', 3000);
                
                // Quitar de la UI
                const card = document.getElementById(`rcard-${key64}`);
                if (card) card.remove();
                
                // Actualizar contador
                const currentCount = Object.keys(window._sdMatchData).length - 1;
                const title = container.querySelector('h3');
                if (title) title.innerHTML = `📊 Informes — ${currentCount} encuentro${currentCount !== 1 ? 's' : ''}`;
                
                delete window._sdMatchData[key64];
                
            } catch (err) {
                if (typeof hideSpinner === 'function') hideSpinner();
                console.error('[StaffDashboard] Error al ocultar:', err);
                if (typeof showToast === 'function') showToast('⚠️ Error al ocultar: ' + err.message, 4000);
            }
        };

    } catch(e) {
        console.error('[StaffDashboard] Error cargando informes:', e);
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">
            ⚠️ Error al cargar informes: ${escapeHtml(e.message)}</div>`;
    }
}

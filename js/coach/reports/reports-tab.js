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
//  DESCARGAS (2026-08-08): los botones de PDF y CSV que aparecen en la
//  cabecera de cada equipo y en cada tarjeta de informe delegan TODO el
//  formateo en js/coach/reports/reports-export.js (window.rx*). Aquí sólo se
//  reúnen los datos, que es lo único que este archivo sabe hacer:
//   · window._sdStatsData[cat|sub] guarda los PARTIDOS de cada rama del árbol,
//     no las filas ya acumuladas: así el CSV y el PDF se calculan al pulsar,
//     con el mismo ctAccumulatePlayerStats que pintó la tabla de pantalla, y
//     no hay una segunda copia de los números que se pueda desincronizar.
//   · _sdReportHtml(m) es el ÚNICO sitio que llama al motor de informes. Se
//     extrajo al añadir la descarga en PDF porque el desplegable y el PDF
//     necesitan exactamente el mismo HTML — y porque la aserción 1c del test
//     exige que _RP.build aparezca UNA sola vez en este archivo.
//   · Las descargas sólo se ofrecen si el módulo está cargado (guarda typeof,
//     igual que el árbol): un botón que no puede hacer nada es peor que no
//     tenerlo.
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

        // Identidad de un jugador dentro de un partido: el dorsal si lo hay, si
        // no el alias. El prefijo evita que un alias que parezca un número se
        // mezcle con el dorsal de otro. Sin ninguno de los dos, el propio id del
        // documento — así un doc raro nunca se traga a otro jugador.
        const _sdPlayerKey = (r) => {
            const num = String(r.playerNumber == null ? '' : r.playerNumber).trim();
            if (num) return 'n:' + num;
            const alias = String(r.playerAlias || r.playerName || '').trim().toLowerCase();
            return alias ? 'a:' + alias : 'id:' + r._id;
        };
        // Gana el createdAt más reciente; a igualdad, el _id menor (determinista).
        const _sdPreferDoc = (a, b) => {
            const ca = String(a.createdAt || ''), cb = String(b.createdAt || '');
            if (ca !== cb) return ca > cb ? a : b;
            return String(a._id) < String(b._id) ? a : b;
        };

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
                    // Índice de deduplicación por jugador. Se elimina antes de
                    // renderizar: no forma parte de los datos del partido y no
                    // debe acabar en window._sdMatchData ni en el motor _RP.
                    _byPlayer:     new Map(),
                };
            }
            // 🔑 UN JUGADOR, UNA VEZ POR PARTIDO (fix 2026-07-30).
            // El panel mostraba "42 JUGADORES", "84 JUGADORES". La causa NO era
            // la deduplicación por id de documento —que ya existe y funciona—
            // sino que DOS escritores distintos crean documentos staffReport:true
            // para el MISMO jugador y partido, con ids que nunca coinciden:
            //     ${matchId}_staff_p${n}  · match-reports-auto.js, match-reports-send.js
            //     ${matchId}_p${n}        · collective-report.js
            // Los dos caen en esta misma clave (fecha_rival_coachUid), así que
            // cada jugador se contaba tantas veces como vías de envío se usaran.
            //
            // ⚠️ SE DEDUPLICA AQUÍ, EN LA AGREGACIÓN, NO EN EL BADGE: de este
            // array salen también los goles y las lesiones de la tarjeta y TODA
            // la tabla resumen de temporada. Arreglar sólo el número visible
            // habría dejado el resto mintiendo, y eso es peor porque ya no se
            // nota a simple vista.
            //
            // Desempate: gana el documento con createdAt más reciente (un
            // reenvío refleja el estado final del partido); a igualdad, el de
            // _id menor, para que el resultado no dependa del orden de llegada
            // de las consultas.
            const _pKey = _sdPlayerKey(r);
            const _prev = matches[key]._byPlayer.get(_pKey);
            if (!_prev) {
                matches[key]._byPlayer.set(_pKey, r);
                matches[key].players.push(r);
            } else if (_sdPreferDoc(r, _prev) === r) {
                matches[key]._byPlayer.set(_pKey, r);
                matches[key].players[matches[key].players.indexOf(_prev)] = r;
            }
            // FIX: si el objeto agrupado aún no tiene myTeamRole pero este doc sí,
            // adoptarlo (algunos docs antiguos del mismo partido pueden no llevarlo).
            if (matches[key].myTeamRole == null && r.myTeamRole != null) {
                matches[key].myTeamRole = r.myTeamRole;
            }
        });

        // El índice de deduplicación era un andamio: fuera antes de que estos
        // objetos lleguen a window._sdMatchData y al motor de informes _RP.
        Object.values(matches).forEach(m => { delete m._byPlayer; });

        // Ordenar por fecha descendente
        const sorted = Object.values(matches).sort((a, b) =>
            (b.createdAt || '').localeCompare(a.createdAt || ''));

        // Mapa global de datos de partido para renderizado lazy
        window._sdMatchData = {};

        let html = `
        <style>
            .sd-exp-bar { display:flex;flex-wrap:wrap;align-items:center;gap:0.4rem;
                margin:0 0 0.7rem;padding:0.45rem 0.7rem;border-radius:9px;
                background:rgba(88,166,255,0.05);border:1px solid rgba(88,166,255,0.16); }
            .sd-exp-lbl { font-size:0.7rem;font-weight:600;color:#8b949e;margin-right:auto; }
            .sd-exp-btn { background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.32);
                color:#58a6ff;padding:0.3rem 0.7rem;border-radius:6px;cursor:pointer;
                font-size:0.7rem;font-weight:700;white-space:nowrap;transition:all 0.2s; }
            .sd-exp-btn:hover { background:rgba(88,166,255,0.2);border-color:rgba(88,166,255,0.6); }
            .sd-exp-mini { background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                color:#58a6ff;padding:0.4rem;border-radius:6px;cursor:pointer;line-height:1;
                display:flex;align-items:center;justify-content:center;transition:all 0.2s; }
            .sd-exp-mini:hover { background:rgba(88,166,255,0.22); }
        </style>
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

        // ── DESCARGAS (PDF / CSV) ────────────────────────────────────────
        // Módulo de exportación: js/coach/reports/reports-export.js. Mismo
        // criterio que con el árbol — sin él, la pestaña sigue funcionando y
        // simplemente no aparece ningún botón de descarga.
        const _sdPuedeExpInforme = typeof window.rxExportarInformePDF === 'function' &&
                                   typeof window.rxExportarInformeCSV === 'function';
        const _sdPuedeExpResumen = typeof window.rxExportarResumenPDF === 'function' &&
                                   typeof window.rxExportarResumenCSV === 'function' &&
                                   typeof window.ctAccumulatePlayerStats === 'function';

        // ── BORRADO PERMANENTE: SÓLO EL DIRECTOR DEPORTIVO ───────────────
        // Regla de producto (2026-08-13): el entrenador y el coordinador sólo
        // OCULTAN de su panel; destruir datos de la base —y descontarlos del
        // acumulado del club— es del Director Deportivo, que es el máximo
        // responsable deportivo.
        //
        // ⚠️ Mismo predicado que la pestaña "Config." (_sdEsDirector), no una
        // copia: el criterio de "esto es cosa del director" tiene que ser uno.
        // ⚠️ Y si el módulo no ha cargado se responde NO. Un permiso que falla
        // abierto ante un botón irreversible es peor que no tener el botón.
        const _sdMuestraPurga = (typeof window._sdPuedePurgar === 'function')
                                && window._sdPuedePurgar(me);
        // Partidos de cada rama del árbol, indexados por 'categoria|SUB'. Se
        // rellena al pintar cada cabecera de subcategoría y se consume al
        // pulsar un botón de descarga.
        window._sdStatsData = {};

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
                        ${_sdPuedeExpInforme ? `
                        <button onclick="event.stopPropagation(); sdExportInforme('${key64}','pdf')"
                                title="Descargar este informe grupal en PDF" class="sd-exp-mini">🖨️</button>
                        <button onclick="event.stopPropagation(); sdExportInforme('${key64}','csv')"
                                title="Descargar este informe grupal en CSV (Excel)" class="sd-exp-mini">📊</button>` : ''}
                        <button onclick="event.stopPropagation(); sdDeleteReport('${key64}')"
                                title="Ocultar este informe de MI panel (los demás roles lo siguen viendo)"
                                style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);
                                       color:#ff5858;padding:0.4rem;border-radius:6px;cursor:pointer;
                                       display:flex;align-items:center;justify-content:center;transition:all 0.2s;">
                            🗑️
                        </button>
                        ${_sdMuestraPurga ? `
                        <button onclick="event.stopPropagation(); sdPurgeMatch('${key64}')"
                                title="BORRADO PERMANENTE (sólo Director Deportivo): elimina el partido de la base de datos para todo el mundo y lo descuenta del acumulado. No se puede deshacer."
                                style="background:rgba(139,0,0,0.18);border:1px solid rgba(255,88,88,0.55);
                                       color:#ff5858;padding:0.4rem;border-radius:6px;cursor:pointer;
                                       display:flex;align-items:center;justify-content:center;transition:all 0.2s;">
                            💣
                        </button>` : ''}
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

        // Barra de descarga que se pinta encima de la tabla de un equipo. Deja
        // los PARTIDOS de esa rama en _sdStatsData y devuelve los dos botones.
        // ⚠️ Va aquí y NO dentro de ctRenderStatsTable: esa función la comparten
        // otros paneles y su marcado está fijado por scripts/test_category_tree.js.
        const _sdStatsBar = (arr, catId, subId) => {
            const skey = catId + '|' + subId;
            window._sdStatsData[skey] = arr.map(x => x.m);
            // Un equipo sin partidos propios no ofrece descarga: no hay
            // temporada que exportar aunque tenga colaboraciones que mostrar.
            if (!arr.length) return '';
            if (!_sdPuedeExpResumen) return '';
            return `
            <div class="sd-exp-bar">
                <span class="sd-exp-lbl">⬇️ Resumen acumulado de la temporada de este equipo</span>
                <button class="sd-exp-btn" onclick="sdExportResumen('${skey}','pdf')">🖨️ PDF</button>
                <button class="sd-exp-btn" onclick="sdExportResumen('${skey}','csv')">📊 CSV / Excel</button>
            </div>`;
        };

        if (_sdUsaArbol) {
            // Índice de entrenadores para completar los informes históricos a los
            // que _cMatchSubcatFor dejó la subcategoría vacía. Sale de los
            // documentos de usuario que ya se leyeron arriba: sin consulta nueva.
            let _sdCoachIndex = new Map();
            try { _sdCoachIndex = window.ctBuildCoachIndex(_sdUserDocs); } catch (_) {}

            // Plantillas publicadas del club, para listar en la tabla también a
            // quien todavía no ha jugado (petición del autor, 2026-08-12).
            // ⚠️ Son la copia SIN datos personales de clubs/{id}/team_rosters,
            // no las plantillas originales: aquí no se lee ningún contacto.
            // Si la lectura falla o el equipo no la ha publicado, la tabla sale
            // como siempre — sólo con quien tiene informes.
            let _sdPlantillas = {};
            if (typeof window.cronosFetchAllTeamRosters === 'function') {
                try { _sdPlantillas = await window.cronosFetchAllTeamRosters(clubId) || {}; }
                catch (_) { _sdPlantillas = {}; }
            }

            // Descarga global: TODOS los equipos del club en un solo documento.
            // Sólo en el camino del árbol — en la lista plana no hay tabla de
            // resumen en pantalla, así que tampoco se ofrece descargarla.
            if (_sdPuedeExpResumen) {
                // v593 · "TODOS los equipos" tiene que ser verdad. Para un
                // coordinador de una modalidad, el documento sale con SUS
                // equipos (sólo se exporta lo que el árbol ha pintado), así
                // que la etiqueta lo dice en vez de prometer el club entero.
                const _sdAmbitoExp = (typeof window._cronosCoordScope === 'function' &&
                                      window._cronosCoordScope(me))
                    ? 'TODOS los equipos de ' + window._cronosCoordScopeLabel(window._cronosCoordScope(me))
                    : 'TODOS los equipos';
                html += `
                <div class="sd-exp-bar">
                    <span class="sd-exp-lbl">⬇️ Resumen acumulado de la temporada · ${_sdAmbitoExp}</span>
                    <button class="sd-exp-btn" onclick="sdExportResumen('*','pdf')">🖨️ PDF</button>
                    <button class="sd-exp-btn" onclick="sdExportResumen('*','csv')">📊 CSV / Excel</button>
                </div>`;
            }

            // 🎯 v593 · El coordinador ve los informes de SU modalidad.
            //
            // 🔑 SE FILTRAN LOS ELEMENTOS DEL ÁRBOL, NO `sorted`. `sorted` se
            // sigue usando entero unas líneas más abajo para buscar las
            // COLABORACIONES (ctAccumulateGuestStats): un alevín que sube con
            // el infantil deja su informe DENTRO del partido del infantil, o
            // sea en un partido de F11. Filtrando `sorted` el coordinador de
            // F7 perdería la fila de su propio jugador — que sí es asunto
            // suyo. Lo que se acota son los EQUIPOS que se listan.
            const _sdResueltos = sorted
                .map(m => ({ m: m, r: window.ctResolveCatSub(m, _sdCoachIndex) }))
                .filter(x => typeof window._cronosVeCategoria !== 'function' ||
                             window._cronosVeCategoria(me, x.r.cat));
            html += window.ctRenderTree({
                items:      _sdResueltos,
                getCat:     (x) => x.r.cat,
                getSub:     (x) => x.r.sub,
                // 🔑 La tabla es POR EQUIPO, así que va en renderSubHeader y no en
                // renderLeaf: se calcula con TODOS los partidos de esa rama.
                // arr.length son los PARTIDOS de esa rama (un elemento = un
                // partido ya agrupado), que es justo lo que va en la celda PJ de
                // la fila de totales. Sin pasarlo, esa celda saldría con guion.
                // 🔑 LAS COLABORACIONES SE BUSCAN EN **TODOS** LOS PARTIDOS DEL
                // CLUB (`sorted`), NO en los de esta rama (`arr`). Un cadete que
                // sube con el juvenil deja su informe DENTRO del partido del
                // juvenil, así que en `arr` —los partidos del cadete— no está.
                // Buscarlo ahí habría devuelto siempre cero y la fila supletoria
                // no habría aparecido nunca.
                alwaysSubHeader: true,
                renderSubHeader: (arr, catId, subId) => {
                    const _inv = (typeof window.ctAccumulateGuestStats === 'function')
                        ? window.ctAccumulateGuestStats(sorted, catId, subId) : [];
                    const _sq = _sdPlantillas[catId + '|' + subId] || [];
                    // Rama sin partidos, sin colaboraciones y sin plantilla
                    // publicada: se devuelve '' y queda exactamente como antes
                    // ("Sin informes de este equipo").
                    if (!arr.length && !_inv.length && !_sq.length) return '';
                    let _filas = window.ctAccumulatePlayerStats(arr.map(x => x.m));
                    if (typeof window.ctMergeSquadRows === 'function') {
                        _filas = window.ctMergeSquadRows(_filas, _sq);
                    }
                    return _sdStatsBar(arr, catId, subId) + window.ctRenderStatsTable(
                        _filas, { matchCount: arr.length, guestRows: _inv });
                },
                renderLeaf: (x) => _sdReportCard(x.m),
                // v593 · El árbol del coordinador es el de SU modalidad.
                modalidad:  (typeof window._cronosCoordScope === 'function')
                                ? window._cronosCoordScope(me) : '',
                emptyText:  'Sin informes de este equipo todavía.',
            });
        } else {
            // Respaldo sin árbol: el acotamiento por modalidad no se puede
            // perder sólo porque el módulo no esté cargado.
            sorted.forEach(m => {
                if (typeof window._cronosVeCategoria === 'function' &&
                    !window._cronosVeCategoria(me, m.category || m.matchCategory)) return;
                html += _sdReportCard(m);
            });
        }

        container.innerHTML = html;

        // ⚠️ EL ÚNICO PUNTO DE LLAMADA AL MOTOR DE INFORMES. Lo usan el
        // desplegable de la tarjeta y la descarga en PDF, y tienen que ver
        // EXACTAMENTE el mismo informe: si el PDF lo construyera por su cuenta,
        // cualquier cambio futuro en el motor podría llegar a una vía y no a la
        // otra. Además, la aserción 1c del guard exige que _RP.build aparezca
        // una sola vez en este archivo.
        const _sdReportHtml = (m) => _RP.build(m, window._cronosCurrentUser);

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
                        detail.innerHTML = _sdReportHtml(matchData);
                    } catch (err) {
                        detail.innerHTML = `<div style="color:#ff5858;font-size:0.8rem;">⚠️ Error al generar informe: ${err.message}</div>`;
                    }
                    detail.dataset.rendered = '1';
                }
            }
            detail.style.display = isOpen ? 'none' : 'block';
            if (card) card.style.borderColor = isOpen ? 'rgba(88,166,255,0.15)' : 'rgba(88,166,255,0.55)';
        };

        // ── DESCARGA DE UN INFORME GRUPAL (PDF / CSV) ─────────────────
        // El PDF necesita el informe visual completo, así que se construye en
        // el momento aunque la tarjeta esté plegada: descargar no obliga a
        // haber abierto antes el desplegable.
        window.sdExportInforme = (key64, fmt) => {
            const m = window._sdMatchData && window._sdMatchData[key64];
            if (!m) {
                if (typeof showToast === 'function') showToast('⚠️ No se encontró ese informe', 2500);
                return;
            }
            if (fmt === 'csv') { window.rxExportarInformeCSV(m); return; }
            let cuerpo = '';
            try {
                cuerpo = _sdReportHtml(m);
            } catch (err) {
                if (typeof showToast === 'function') showToast('⚠️ Error al generar el informe: ' + err.message, 4000);
                return;
            }
            window.rxExportarInformePDF(m, cuerpo, { club: me.clubName || clubId });
        };

        // ── DESCARGA DEL RESUMEN ACUMULADO DE TEMPORADA (PDF / CSV) ───
        // skey = 'categoria|SUB' para un equipo, o '*' para todos.
        // 🔑 Las filas se ACUMULAN AL PULSAR, con la misma función que pintó la
        // tabla de pantalla: el papel no puede decir otra cosa que el panel.
        window.sdExportResumen = (skey, fmt) => {
            const _label = (k) => {
                const cat = k.split('|')[0], sub = k.split('|')[1] || '';
                const def = (window.CT_CATEGORIES || []).find(c => c.id === cat);
                return ((def && def.label) || cat) + (sub ? ' ' + sub : '');
            };
            const _bloque = (k) => {
                const ms = (window._sdStatsData && window._sdStatsData[k]) || [];
                return { equipo: _label(k), filas: window.ctAccumulatePlayerStats(ms), partidos: ms.length };
            };

            const claves = Object.keys(window._sdStatsData || {}).sort();
            const bloques = (skey === '*')
                ? claves.map(_bloque)
                : (claves.indexOf(skey) !== -1 ? [_bloque(skey)] : []);

            if (!bloques.length) {
                if (typeof showToast === 'function') showToast('⚠️ No hay datos de temporada que descargar', 3000);
                return;
            }
            const meta = {
                club:   me.clubName || clubId,
                ambito: skey === '*'
                    ? ('Todos los equipos del club' +
                       ((typeof window._cronosCoordScope === 'function' && window._cronosCoordScope(me))
                            ? ' · ' + window._cronosCoordScopeLabel(window._cronosCoordScope(me))
                            : ''))
                    : bloques[0].equipo,
            };
            if (fmt === 'csv') window.rxExportarResumenCSV(bloques, meta);
            else               window.rxExportarResumenPDF(bloques, meta);
        };

        // ══════════════════════════════════════════════════════════════
        //  BORRADO PERMANENTE DE UN PARTIDO (2026-08-13)
        // ══════════════════════════════════════════════════════════════
        //  Pedido por el autor: en fase de pruebas, los partidos de ensayo
        //  ensucian el acumulado de temporada, y ocultarlos NO basta porque el
        //  documento sigue vivo y los demás roles lo siguen contando.
        //
        //  🔑🔑 UN PARTIDO NO ES UN DOCUMENTO, SON MUCHOS. Por cada jugador se
        //  escriben hasta cuatro copias con ids distintos —{mid}_staff_p{n},
        //  {mid}_coach_p{n}, {mid}_p{n} y {mid}_parent_{uid}_p{n}— desde tres
        //  ficheros diferentes. Borrar sólo el que tiene delante el panel
        //  dejaría el resto vivo y el acumulado seguiría sucio: exactamente el
        //  problema que se viene a resolver. Por eso se CONSULTA por matchId
        //  además de usar los ids que el panel ya tiene.
        //
        //  ⚠️ NO SE PROMETE LO QUE NO SE PUEDE CUMPLIR. firestore.rules sólo
        //  deja borrar al AUTOR del informe (coachUid) y al SuperAdmin: un
        //  director NO puede borrar los informes de otro entrenador. Se
        //  cuentan los borrados y los denegados y se dice la verdad, en vez de
        //  enseñar "borrado" y dejar los documentos donde estaban.
        //
        //  ⚠️ ES IRREVERSIBLE Y AFECTA A TODOS, así que pide DOS confirmaciones
        //  y la segunda obliga a escribir la palabra. Un solo confirm() delante
        //  de una papelera es demasiado fácil de pulsar sin leer.
        window.sdPurgeMatch = async (key64) => {
            // 🔑 LA PUERTA VA TAMBIÉN AQUÍ, no sólo en el botón. Ocultar el
            // botón NO es un permiso: esta función es window.* y se invoca
            // desde la consola o desde un onclick reutilizado. Es el mismo
            // razonamiento con el que la pestaña "Config." comprueba el
            // permiso en el botón Y en la ruta.
            // ⚠️ La barrera REAL son las reglas de Firestore; esto sólo evita
            // que alguien se lleve un error feo y un borrado a medias.
            if (typeof window._sdPuedePurgar !== 'function' || !window._sdPuedePurgar(me)) {
                const aviso = '⛔ El borrado permanente es exclusivo del Director Deportivo. ' +
                              'Usa 🗑️ para ocultar el informe de tu panel.';
                if (typeof showToast === 'function') showToast(aviso, 5000); else alert(aviso);
                return;
            }

            const match = window._sdMatchData[key64];
            if (!match) return;

            const _rival = match.rival || 'rival';
            const _fecha = match.matchDate || '';
            if (!confirm(
                '⚠️ BORRADO PERMANENTE\n\n' +
                'Vas a eliminar de la base de datos el partido:\n' +
                '   ' + _fecha + ' · vs ' + _rival + '\n\n' +
                'Se borrarán TODOS sus informes (entrenador, dirección y padres).\n' +
                'Desaparecerá para todo el mundo y del acumulado de temporada.\n\n' +
                'ESTO NO SE PUEDE DESHACER. ¿Continuar?')) return;

            // ⚠️ El mensaje dice EXACTAMENTE lo que el código acepta. La
            // comparación ignora mayúsculas y espacios sobrantes —teclear la
            // palabra ya es acto deliberado, que es para lo que sirve este
            // paso—, así que no se exige un formato que luego no se comprueba.
            const _tecleado = prompt(
                'Confirmación final.\n\nEscribe la palabra BORRAR para eliminar el partido definitivamente:');
            if (String(_tecleado || '').trim().toUpperCase() !== 'BORRAR') {
                if (typeof showToast === 'function') showToast('Cancelado · no se ha borrado nada', 2500);
                return;
            }

            try {
                if (typeof showSpinner === 'function') showSpinner('Purgando partido…');

                // 🔑 LA PURGA VIVE EN js/coach/reports/match-purge.js, NO AQUÍ.
                // El mismo borrado se dispara también desde Partidos
                // Terminados; con dos implementaciones, "purga total"
                // significaba dos cosas distintas según por dónde entrases y el
                // acumulado quedaba sucio en una de ellas.
                const r = await window.cronosPurgarPartido({
                    matchId: match.matchId,
                    docIds: (match.players || []).map(p => p._id).filter(Boolean),
                    borrarPartidoEnVivo: true,
                });

                if (typeof hideSpinner === 'function') hideSpinner();

                const resumen = window.cronosResumenPurga(r);
                if (typeof showToast === 'function') showToast(resumen, 6000); else alert(resumen);

                // ⚠️ Si no se borró NADA, la ficha se queda donde está: quitarla
                // de la lista daría por hecho un borrado que no ha ocurrido y al
                // recargar reaparecería.
                if (!r.borrados && !r.partidoBorrado) return;

                const card = document.getElementById('rcard-' + key64);
                if (card) card.remove();
                delete window._sdMatchData[key64];

                // El acumulado se deriva de los informes vivos: basta repintar
                // ESTA pestaña, que es la que lo muestra.
                if (typeof _sdLoadReports === 'function') _sdLoadReports();

            } catch (err) {
                if (typeof hideSpinner === 'function') hideSpinner();
                console.error('[Purga] error borrando el partido:', err);
                alert('Error al borrar el partido: ' + (err && err.message ? err.message : err));
            }
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

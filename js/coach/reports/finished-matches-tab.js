// ════════════════════════════════════════════════════════════════════
//  js/coach/reports/finished-matches-tab.js
//  Pestaña "Partidos Terminados" del Panel de Dirección: reúne los partidos
//  finalizados desde live_matches y los informes colectivos de
//  cronos_player_reports, y los presenta como lista plana filtrada (rol
//  entrenador) o como árbol de Categoría × Subcategoría (director/coordinador).
//
//  Extraído de js/coach/reports/club-reports.js (auditoría 2026-07-22,
//  hallazgo #9 — monolitos sin tests de framework) el 2026-07-26, paso 3 de 6
//  de la descomposición de ese archivo. Movimiento puramente mecánico, sin
//  cambios de lógica.
//
//  ⚠️ ESTE ARCHIVO NO ES AUTÓNOMO: tiene un CICLO con js/core/app-init.js.
//  El HTML que genera llama a deleteFinishedMatchFromCloud (definida en
//  app-init.js), y esa función llama de vuelta a _renderFinishedMatchesTab
//  para refrescar. Los dos sentidos se resuelven en tiempo de click vía
//  window, así que el orden de <script> es indiferente, pero no se puede
//  razonar sobre este archivo sin tener app-init.js delante.
//
//  ACOPLAMIENTO:
//   · Entrada 1: switchStaffTab('partidos_terminados') → esta función
//     (switchStaffTab SE QUEDA en club-reports.js), detrás de la comprobación
//     del extra `partidos_terminados`.
//   · Entrada 2: app-init.js, dentro de deleteFinishedMatchFromCloud, con
//     guarda typeof. Es el ÚNICO consumidor externo — la aserción 1c del test
//     lo fija para que no aparezcan otros por descuido.
//   · Depende de _sdFS() (helper Firestore que SE QUEDA en club-reports.js),
//     escapeHtml (app-init.js), window.openMatchReplay
//     (match/replay/replay-player.js), openRetroactiveEventModal
//     (match/events/retroactive-modal.js, invocada con guarda) y
//     deleteFinishedMatchFromCloud (app-init.js, invocada SIN guarda).
//
//  ⚠️ IMPLEMENTACIÓN PARALELA: app-init.js:1086 define
//  `async function showFinishedMatches()`, un SEGUNDO renderizador
//  independiente del mismo listado, con su propio _renderItem casi idéntico a
//  _renderMatchItem de aquí. No hay colisión de nombres ni de contenedor, así
//  que no es un caso de "last script wins", pero es lógica duplicada entre dos
//  monolitos y deleteFinishedMatchFromCloud refresca LAS DOS. Unificarlas es
//  tarea para cuando le toque a app-init.js, no de este refactor.
//
//  ⚠️ ESCRIBE EN FIRESTORE DURANTE EL RENDER: el "enriquecimiento retroactivo"
//  hace updateDoc sobre live_matches o cronos_player_reports para rellenar
//  category/subcategory ausentes, fire-and-forget y con el error silenciado.
//  No es destructivo, pero no es un render de sólo lectura. Además lee TRES
//  colecciones enteras sin where (live_matches, cronos_player_reports y, sólo
//  si hay partidos sin categoría, users) y filtra en cliente: el alcance real
//  lo impone firestore.rules. No convertirlo a queries con where sin revisar
//  que la semántica del filtrado cliente se mantiene.
//
//  ⚠️ RAREZAS PREEXISTENTES, DELIBERADAMENTE NO CORREGIDAS:
//   · El objeto que se guarda en finishedMap para los informes colectivos
//     termina en `...data`, DESPUÉS de las ~26 líneas que normalizan
//     homeTeam/awayTeam. Si el documento trae esos campos, el valor crudo pisa
//     la normalización, que sólo surte efecto cuando el campo no viene. NO
//     produce fallo visible porque _renderMatchItem repite la misma cadena de
//     fallbacks, pero son 26 líneas de trabajo muerto. Aserción 2n del test.
//   · Los tres onclick interpolan m.id / m.docId SIN escapeAttr (aserción 6g),
//     al contrario que events-tab.js, que sí escapaba.
//   · deleteFinishedMatchFromCloud va sin guarda typeof mientras
//     openRetroactiveEventModal, en el botón contiguo, sí la lleva.
//
//  Cubierto por scripts/test_finished_matches_module.js.
// ════════════════════════════════════════════════════════════════════

async function _renderFinishedMatchesTab() {
    const container = document.getElementById('staff-dashboard-content');
    const me = window._cronosCurrentUser;
    const activeRole = me?._activeRole || me?.role;
    const clubId = me?.clubId;

    try {
        const { db, collection, getDocs } = await _sdFS();
        if (!db) {
            container.innerHTML = '<p style="color:#7d8590;padding:2rem;">Error de conexión.</p>';
            return;
        }

        const finishedMap = new Map(); // id -> matchData

        // 1. Cargar desde live_matches
        try {
            const snapLive = await getDocs(collection(db, 'live_matches'));
            snapLive.forEach(d => {
                const data = d.data() || {};
                const isMyClub = !clubId || data.clubId === clubId || data.createdBy === me?.uid;
                if (isMyClub && (data.status === 'finished' || data.phase === 'finished' || data.matchPhase === 'finished')) {
                    finishedMap.set(d.id, { id: d.id, source: 'live_matches', ...data });
                }
            });
        } catch(e1) {
            console.warn('[FinishedMatches] Error leyendo live_matches:', e1);
        }

        // 2. Cargar desde cronos_player_reports (informes colectivos del staff)
        try {
            const snapReports = await getDocs(collection(db, 'cronos_player_reports'));
            snapReports.forEach(d => {
                const data = d.data() || {};
                const isMyClub = !clubId || data.clubId === clubId || data.coachUid === me?.uid;
                const isCollective = data.staffReport === true || data.type === 'collective_match_report' || data.reportType === 'collective';
                if (isMyClub && isCollective) {
                    const idKey = data.liveMatchId || d.id;
                    if (!finishedMap.has(idKey)) {
                        finishedMap.set(idKey, {
                            id: idKey,
                            docId: d.id,
                            source: 'cronos_player_reports',
                            homeTeam: typeof data.homeTeam === 'object' && data.homeTeam ? {
                                name: data.homeTeam.name || data.homeName || 'LOCAL',
                                score: data.homeTeam.score ?? data.scoreHome ?? data.goalsHome ?? 0,
                                color: data.homeTeam.color || data.homeColor || '#58a6ff',
                                shorts: data.homeTeam.shorts || data.homeShorts || '#1a4e99',
                                textColor: data.homeTeam.textColor || data.homeText || '#000000'
                            } : {
                                name: data.homeName || (typeof data.homeTeam === 'string' ? data.homeTeam : 'LOCAL'),
                                score: data.scoreHome ?? data.goalsHome ?? 0,
                                color: data.homeColor || '#58a6ff',
                                shorts: data.homeShorts || '#1a4e99',
                                textColor: data.homeText || '#000000'
                            },
                            awayTeam: typeof data.awayTeam === 'object' && data.awayTeam ? {
                                name: data.awayTeam.name || data.awayName || 'VISITANTE',
                                score: data.awayTeam.score ?? data.scoreAway ?? data.goalsAway ?? 0,
                                color: data.awayTeam.color || data.awayColor || '#ff5858',
                                shorts: data.awayTeam.shorts || data.awayShorts || '#b22222',
                                textColor: data.awayTeam.textColor || data.awayText || '#ffffff'
                            } : {
                                name: data.awayName || (typeof data.awayTeam === 'string' ? data.awayTeam : 'VISITANTE'),
                                score: data.scoreAway ?? data.goalsAway ?? 0,
                                color: data.awayColor || '#ff5858',
                                shorts: data.awayShorts || '#b22222',
                                textColor: data.awayText || '#ffffff'
                            },
                            category: data.category || '',
                            subcategory: data.subcategory || '',
                            createdAt: data.createdAt || data.timestamp || 0,
                            events: data.events || data.timeline || [],
                            players: data.players || [],
                            mode: data.mode || 'f7',
                            ...data
                        });
                    }
                }
            });
        } catch(e2) {
            console.warn('[FinishedMatches] Error leyendo cronos_player_reports:', e2);
        }

        let finishedMatches = Array.from(finishedMap.values());

        // ── ENRIQUECIMIENTO RETROACTIVO DE CATEGORÍA Y SUBCATEGORÍA ─────────────
        // Si un partido no tiene categoría/subcategoría registrada, buscamos en los
        // datos del entrenador creador (por UID, email o me) y actualizamos Firestore.
        try {
            const coachCatMap = new Map();
            if (me) {
                const meCat = me.category || me._activeRoleData?.category || me.categoryLabel || '';
                const meSub = me.subcategory || me._activeRoleData?.subcategory || '';
                if (meCat || meSub) {
                    if (me.uid) coachCatMap.set(me.uid, { category: meCat, subcategory: meSub });
                    if (me.email) coachCatMap.set(me.email, { category: meCat, subcategory: meSub });
                }
            }

            // Cargar perfiles de usuarios del club si hay partidos sin categoría
            const unassignedMatches = finishedMatches.filter(m => !m.category);
            if (unassignedMatches.length > 0) {
                const usersSnap = await getDocs(collection(db, 'users')).catch(() => null);
                if (usersSnap) {
                    usersSnap.forEach(ud => {
                        const uData = ud.data() || {};
                        const cat = uData.category || uData._activeRoleData?.category || uData.categoryLabel || '';
                        const sub = uData.subcategory || uData._activeRoleData?.subcategory || '';
                        if (cat || sub) {
                            coachCatMap.set(ud.id, { category: cat, subcategory: sub });
                            if (uData.email) coachCatMap.set(uData.email, { category: cat, subcategory: sub });
                            if (uData.uid) coachCatMap.set(uData.uid, { category: cat, subcategory: sub });
                        }
                    });
                }

                // Asignar categoría encontrada y actualizar Firestore
                const { doc, updateDoc } = await _sdFS();
                unassignedMatches.forEach(m => {
                    const info = coachCatMap.get(m.createdBy) || coachCatMap.get(m.coachUid) || coachCatMap.get(m.coachEmail);
                    if (info && (info.category || info.subcategory)) {
                        m.category = m.category || info.category;
                        m.subcategory = m.subcategory || info.subcategory;

                        // Guardar en Firestore de forma silenciosa e instantánea
                        const colName = m.source === 'live_matches' ? 'live_matches' : 'cronos_player_reports';
                        const targetId = m.docId || m.id;
                        if (targetId && updateDoc && doc) {
                            updateDoc(doc(db, colName, targetId), {
                                category: m.category,
                                subcategory: m.subcategory
                            }).catch(() => {});
                        }
                    }
                });
            }
        } catch(catErr) {
            console.warn('[FinishedMatches] Error en enriquecimiento retroactivo:', catErr);
        }

        finishedMatches.sort((a, b) => {
            const tsA = typeof a.createdAt === 'number' ? a.createdAt : (a.createdAt?.toMillis?.() || 0);
            const tsB = typeof b.createdAt === 'number' ? b.createdAt : (b.createdAt?.toMillis?.() || 0);
            return tsB - tsA;
        });

        // ── Normalizadores de Categoría y Subcategoría ────────────────────
        const _normCat = (c) => {
            if (!c) return '';
            let str = String(c).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (str.includes('prebenj')) return 'prebenjamin';
            if (str.includes('benj')) return 'benjamin';
            if (str.includes('alev')) return 'alevin';
            if (str.includes('infant')) return 'infantil';
            if (str.includes('cadet')) return 'cadete';
            if (str.includes('juven')) return 'juvenil';
            if (str.includes('region')) return 'regional';
            return str.replace(/_[abc]$/, '');
        };
        const _normSub = (s, c) => {
            let sub = String(s || '').trim().toUpperCase();
            if (!sub && c) {
                const m = String(c).match(/_([abc])$/i);
                if (m) sub = m[1].toUpperCase();
            }
            return sub;
        };

        const isCoach = (activeRole === 'user' || activeRole === 'coach');

        // ── FILTRO EXCLUSIVO PARA ENTRENADOR ──────────────────────────────
        if (isCoach) {
            const coachCat = _normCat(me?.category || me?._activeRoleData?.category || me?.categoryLabel);
            const coachSub = _normSub(me?.subcategory || me?._activeRoleData?.subcategory, me?.category);

            finishedMatches = finishedMatches.filter(m => {
                const isMyDoc = m.createdBy === me?.uid || m.coachUid === me?.uid || m.coachEmail === me?.email;
                if (isMyDoc) return true;
                const mCat = _normCat(m.category);
                const mSub = _normSub(m.subcategory, m.category);
                if (coachCat && mCat === coachCat) {
                    if (!coachSub || !mSub || mSub === coachSub) return true;
                }
                return false;
            });
        }

        if (finishedMatches.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:3rem 1rem;">
                    <div style="font-size:3rem; margin-bottom:0.8rem;">🎬</div>
                    <h3 style="color:white; margin-bottom:0.4rem;">No hay partidos terminados guardados</h3>
                    <p style="color:#7d8590; font-size:0.85rem;">
                        ${isCoach ? 'Solo se muestran los partidos de tu categoría y subcategoría asignada.' : 'En cuanto finalice un partido o se genere su informe, aparecerá aquí organizados por categoría.'}
                    </p>
                </div>`;
            return;
        }

        // Helper renderizado de tarjeta de partido
        const _renderMatchItem = (m) => {
            const homeName = m.homeTeam?.name || m.homeName || (typeof m.homeTeam === 'string' ? m.homeTeam : 'LOCAL');
            const awayName = m.awayTeam?.name || m.awayName || (typeof m.awayTeam === 'string' ? m.awayTeam : 'VISITANTE');
            const scoreHome = m.homeTeam?.score ?? m.scoreHome ?? m.goalsHome ?? 0;
            const scoreAway = m.awayTeam?.score ?? m.scoreAway ?? m.goalsAway ?? 0;
            const cat = (m.category || 'Fútbol').toUpperCase();
            const sub = m.subcategory ? `Grupo ${m.subcategory}` : '';
            const eventsCount = Array.isArray(m.events) ? m.events.length : 0;
            const dateStr = m.matchDate || (m.createdAt ? (typeof m.createdAt === 'number' ? new Date(m.createdAt).toLocaleDateString('es-ES') : new Date(m.createdAt.seconds * 1000).toLocaleDateString('es-ES')) : '—');

            return `
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(121,192,255,0.2); border-radius:12px; padding:0.9rem 1.1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; margin-bottom:0.7rem; transition:border-color 0.2s;"
                     onmouseover="this.style.borderColor='rgba(121,192,255,0.45)'" onmouseout="this.style.borderColor='rgba(121,192,255,0.2)'">
                    <div>
                        <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.3rem;">
                            <span style="font-size:0.92rem; font-weight:800; color:white;">${escapeHtml(homeName)} vs ${escapeHtml(awayName)}</span>
                            <span style="background:rgba(121,192,255,0.12); border:1px solid rgba(121,192,255,0.3); color:#79c0ff; font-size:0.65rem; font-weight:700; padding:2px 6px; border-radius:5px;">
                                ${escapeHtml(cat)} ${escapeHtml(sub)}
                            </span>
                        </div>
                        <div style="font-size:0.75rem; color:#7d8590; display:flex; align-items:center; gap:0.8rem;">
                            <span>📅 ${escapeHtml(dateStr)}</span>
                            <span>⚽ Marcador: <strong>${scoreHome} - ${scoreAway}</strong></span>
                            ${eventsCount > 0 ? `<span>📍 ${eventsCount} eventos</span>` : ''}
                        </div>
                    </div>
                    <div style="display:flex; gap:0.4rem; align-items:center;">
                        <button onclick="window.openMatchReplay('${m.id}')"
                            style="background:linear-gradient(135deg,#58a6ff,#1f6beb); border:none; color:white; padding:0.5rem 1.1rem; border-radius:8px; font-weight:800; font-size:0.8rem; cursor:pointer; box-shadow:0 4px 12px rgba(88,166,255,0.3); display:flex; align-items:center; gap:0.4rem;">
                            ▶️ Revivir Partido
                        </button>
                        <button onclick="if(typeof openRetroactiveEventModal==='function') openRetroactiveEventModal('${m.id}');" title="Añadir evento retroactivo (batería/cobertura)"
                            style="background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.4); color:#58a6ff; padding:0.5rem 0.65rem; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;"
                            onmouseover="this.style.background='rgba(88,166,255,0.3)'" onmouseout="this.style.background='rgba(88,166,255,0.15)'">
                            ⏱️
                        </button>
                        <button onclick="deleteFinishedMatchFromCloud('${m.id}', '${m.docId || ''}', event);" title="Eliminar partido"
                            style="background:rgba(255,88,88,0.15); border:1px solid rgba(255,88,88,0.4); color:#ff5858; padding:0.5rem 0.65rem; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;"
                            onmouseover="this.style.background='rgba(255,88,88,0.3)'" onmouseout="this.style.background='rgba(255,88,88,0.15)'">
                            🗑️
                        </button>
                    </div>
                </div>`;
        };

        // Si es ENTRENADOR: mostrar la lista filtrada de su propia categoría
        if (isCoach) {
            let html = `
                <div style="max-width:850px;">
                    <div style="margin-bottom:1.2rem;">
                        <h3 style="margin:0; font-size:1.1rem; color:white;">🎬 Mis Partidos Terminados (${finishedMatches.length})</h3>
                        <div style="font-size:0.75rem; color:#7d8590; margin-top:3px;">
                            Revive los encuentros finalizados de tu categoría asignada.
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.3rem;">
                        ${finishedMatches.map(_renderMatchItem).join('')}
                    </div>
                </div>`;
            container.innerHTML = html;
            return;
        }

        // ── ÁRBOLES DE CATEGORÍAS Y SUBCATEGORÍAS PARA DIRECTOR / COORDINADOR ──
        const CAT_DEFINITIONS = [
            { id: 'prebenjamin', label: 'Prebenjamín', icon: '⚽' },
            { id: 'benjamin',    label: 'Benjamín', icon: '⚡' },
            { id: 'alevin',      label: 'Alevín', icon: '🌟' },
            { id: 'infantil',    label: 'Infantil', icon: '🔥' },
            { id: 'cadete',      label: 'Cadete', icon: '🏆' },
            { id: 'juvenil',     label: 'Juvenil', icon: '👑' },
            { id: 'regional',    label: 'Regional', icon: '🥇' }
        ];
        const SUB_LIST = ['A', 'B', 'C'];

        const byCatSub = new Map(); // catId -> (subId -> [matches])
        const unassigned = [];

        finishedMatches.forEach(m => {
            const cId = _normCat(m.category);
            const sId = _normSub(m.subcategory, m.category);
            if (!cId || !CAT_DEFINITIONS.some(c => c.id === cId)) {
                unassigned.push(m);
                return;
            }
            const subKey = SUB_LIST.includes(sId) ? sId : 'A';
            if (!byCatSub.has(cId)) byCatSub.set(cId, new Map());
            const subMap = byCatSub.get(cId);
            if (!subMap.has(subKey)) subMap.set(subKey, []);
            subMap.get(subKey).push(m);
        });

        let html = `
            <div style="max-width:850px;">
                <div style="margin-bottom:1.2rem;">
                    <h3 style="margin:0; font-size:1.1rem; color:white;">🎬 Partidos Terminados del Club (${finishedMatches.length})</h3>
                    <div style="font-size:0.75rem; color:#7d8590; margin-top:3px;">
                        Organizados jerárquicamente por Categoría y Subcategoría. Haz clic en cualquier grupo para desplegar sus partidos.
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.8rem;">
        `;

        CAT_DEFINITIONS.forEach((catDef, catIdx) => {
            const subMap = byCatSub.get(catDef.id) || new Map();
            let catTotalMatches = 0;
            subMap.forEach(arr => { catTotalMatches += arr.length; });

            const isExpanded = catTotalMatches > 0;

            html += `
                <div style="background:rgba(255,255,255,0.02); border:1px solid ${catTotalMatches > 0 ? 'rgba(88,166,255,0.3)' : 'rgba(255,255,255,0.08)'}; border-radius:14px; overflow:hidden;">
                    <div onclick="const b=this.nextElementSibling; b.style.display=(b.style.display==='none'?'block':'none'); this.querySelector('.arrow').textContent=(b.style.display==='none'?'►':'▼');"
                         style="padding:0.8rem 1.1rem; background:rgba(255,255,255,0.03); cursor:pointer; display:flex; align-items:center; justify-content:space-between; user-select:none;">
                        <div style="display:flex; align-items:center; gap:0.6rem;">
                            <span class="arrow" style="font-size:0.75rem; color:#79c0ff;">${isExpanded ? '▼' : '►'}</span>
                            <span style="font-size:1rem;">${catDef.icon}</span>
                            <span style="font-weight:800; color:white; font-size:0.95rem;">${catDef.label}</span>
                            <span style="background:${catTotalMatches > 0 ? 'rgba(63,185,80,0.18)' : 'rgba(255,255,255,0.06)'}; color:${catTotalMatches > 0 ? '#3fb950' : '#7d8590'}; font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:12px;">
                                ${catTotalMatches} ${catTotalMatches === 1 ? 'partido' : 'partidos'}
                            </span>
                        </div>
                    </div>
                    <div style="display:${isExpanded ? 'block' : 'none'}; padding:0.8rem; border-top:1px solid rgba(255,255,255,0.05);">
            `;

            SUB_LIST.forEach(subId => {
                const subMatches = subMap.get(subId) || [];
                const hasSubMatches = subMatches.length > 0;

                html += `
                    <div style="margin-bottom:0.6rem; border:1px solid ${hasSubMatches ? 'rgba(121,192,255,0.2)' : 'rgba(255,255,255,0.05)'}; border-radius:10px; overflow:hidden;">
                        <div onclick="const b=this.nextElementSibling; if(b){ b.style.display=(b.style.display==='none'?'block':'none'); this.querySelector('.sub-arrow').textContent=(b.style.display==='none'?'►':'▼'); }"
                             style="padding:0.55rem 0.9rem; background:rgba(0,0,0,0.2); cursor:pointer; display:flex; align-items:center; justify-content:space-between; user-select:none;">
                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                <span class="sub-arrow" style="font-size:0.7rem; color:#58a6ff;">${hasSubMatches ? '▼' : '►'}</span>
                                <span style="font-size:0.85rem; font-weight:700; color:white;">Subcategoría ${subId}</span>
                                <span style="font-size:0.68rem; color:${hasSubMatches ? '#79c0ff' : '#4d5566'}; font-weight:700;">
                                    (${subMatches.length})
                                </span>
                            </div>
                        </div>
                        <div style="display:${hasSubMatches ? 'block' : 'none'}; padding:0.6rem 0.6rem 0.1rem 0.6rem;">
                            ${hasSubMatches ? subMatches.map(_renderMatchItem).join('') : '<div style="font-size:0.75rem; color:#4d5566; padding:0.4rem 0.6rem;">Sin partidos en esta subcategoría.</div>'}
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        // ── Sección para Partidos sin categoría asignada ──────────────────
        if (unassigned.length > 0) {
            html += `
                <div style="margin-top:0.6rem; border:1px solid rgba(255,215,0,0.25); border-radius:14px; overflow:hidden;">
                    <div style="padding:0.8rem 1.1rem; background:rgba(255,215,0,0.06); display:flex; align-items:center; gap:0.6rem;">
                        <span style="font-size:0.95rem; font-weight:800; color:#ffd700;">⚠️ Sin categoría asignada (${unassigned.length})</span>
                    </div>
                    <div style="padding:0.8rem;">
                        ${unassigned.map(_renderMatchItem).join('')}
                    </div>
                </div>
            `;
        }

        html += `</div></div>`;
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = `<div style="color:#ff5858;padding:2rem;">⚠️ Error cargando partidos terminados: ${escapeHtml(e.message)}</div>`;
    }
}

window._renderFinishedMatchesTab = _renderFinishedMatchesTab;

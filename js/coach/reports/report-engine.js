// ════════════════════════════════════════════════════════════════════
//  js/coach/reports/report-engine.js
//  MOTOR DE INFORMES VISUAL v1.0 — genera el informe completo de un partido:
//  cabecera con marcador y duración, estadísticas, diagrama de Gantt con la
//  línea individual de cada jugador, leyenda, tabla de tiempo jugado, panel de
//  rotaciones ("quién por quién") y registro cronológico de incidencias.
//
//  Extraído de js/coach/reports/club-reports.js (auditoría 2026-07-22,
//  hallazgo #9 — monolitos sin tests de framework) el 2026-07-26, paso 4 de 6
//  de la descomposición de ese archivo. Movimiento puramente mecánico, sin
//  cambios de lógica.
//
//  FUNCIÓN PURA: 682 líneas sin una sola referencia a window, document,
//  console, escapeHtml, _sdFS ni try/catch. Recibe (matchData, currentUser) y
//  devuelve un string de HTML. Tiene su propio escapador (`esc`) y sus propias
//  paletas de color. El test lo carga en un sandbox DESNUDO (sólo built-ins)
//  para demostrarlo, en lugar de suponerlo.
//  API pública: SOLO `_RP.build(matchData, currentUser)`.
//
//  ⚠️⚠️ NO DECLARAR _RP EN NINGÚN OTRO ARCHIVO ⚠️⚠️
//  _RP es un `const` de nivel superior: vive en el entorno léxico global
//  (compartido entre scripts clásicos) y NO es una propiedad de window. Dos
//  declaraciones del mismo nombre en ese ámbito NO se comportan como el
//  habitual "last script wins": producen
//      SyntaxError: Identifier '_RP' has already been declared
//  y ese error ABORTA EL SCRIPT COMPLETO que llega segundo. Si alguien
//  reintrodujese `const _RP` en club-reports.js, ese archivo entero dejaría de
//  cargarse y el Panel de Dirección desaparecería. La aserción 1g del test
//  vigila que exista EXACTAMENTE UNA declaración en todo el repositorio.
//
//  ⚠️ ORDEN DE CARGA: este archivo va ANTES de club-reports.js en index.html,
//  al contrario que director-config.js / events-tab.js / finished-matches-tab.js,
//  que van después. NO "corregirlo" por simetría. Motivo: comms/panel.js
//  comprueba `typeof _RP !== 'undefined'` antes de usarlo, y para un const en
//  su zona muerta temporal `typeof` LANZA ReferenceError en vez de devolver
//  'undefined' — la guarda es ilusoria. Hoy es inocuo porque ese código sólo
//  corre al hacer click, cuando ya está inicializado; cargar el motor antes
//  reduce esa ventana en lugar de agrandarla. Promoverlo a window._RP sí
//  arreglaría la guarda, pero es un cambio de comportamiento y queda fuera del
//  mandato de este refactor.
//
//  CONSUMIDORES (ambos en tiempo de click):
//   · js/coach/reports/club-reports.js — _sdLoadReports() pinta el informe de
//     un partido en el detalle desplegable. (Pasará a reports-tab.js en el
//     paso 5 de este refactor.)
//   · js/coach/comms/panel.js — reutiliza el mismo motor para el informe que
//     se envía por mensajería.
//
//  ✅ CORREGIDO 2026-07-27 — getTotMin devolvía duraciones equivocadas en 5 de
//  las 7 categorías, no sólo en prebenjamín. La tabla anterior codificaba otra
//  cosa (¿medias partes? ¿un reglamento antiguo?) y sólo acertaba en juvenil y
//  regional, por casualidad. Desvíos medidos contra la duración real:
//    prebenjamín −10, benjamín −20, alevín −10, infantil −10, cadete +10.
//  Además la rama de prebenjamín era INALCANZABLE, porque se comprobaba
//  después de benjamín y 'prebenjamin' contiene 'benjamin'.
//  Ahora la tabla es 2 × los minutos por tiempo del cronómetro
//  (js/core/setup-modal.js). Ojo: `window.matchDuration` NO se asigna en
//  ningún sitio del proyecto, así que el `if (m.duration)` nunca se cumple y
//  esta tabla se usa SIEMPRE. Y no decide sólo la escala del Gantt: un jugador
//  sin cambios se acredita el intervalo [0, totMin] entero, así que fija los
//  minutos que se muestran a cada jugador. La parte 2f del test recorre las
//  siete categorías.
//
//  OTROS DETALLES QUE EL TEST FIJA:
//   · `esc` NO coincide con el escapeHtml global de app-init.js: usa &#39;
//     para la comilla simple (no &#039;) y NO escapa "/".
//   · `build` MUTA su argumento: escribe m.participantsCount.
//   · Sin m.players lanza TypeError (no hay guarda).
//
//  Cubierto por scripts/test_report_engine_module.js.
// ════════════════════════════════════════════════════════════════════

const _RP = (() => {

    // ── Colores y etiquetas por posición ──────────────────────────────
    const PC = { POR:'#BA7517', DEF:'#185FA5', MED:'#1D9E75', DEL:'#D85A30', SUP:'#7F77DD' };
    
    // Paleta de colores para cadenas de rotación (Gantt)
    const CHAIN_COLORS = [
        '#3fb950', '#58a6ff', '#f0883e', '#d2a8ff', '#ff5858', '#eab308', 
        '#79c0ff', '#aff5b4', '#ff7b72', '#d29922', '#bc8cff', '#58d1ff'
    ];

    // ── Escape HTML seguro ────────────────────────────────────────────
    const esc = s => (s || '').toString()
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    // ── Detectar posición del jugador ─────────────────────────────────
    const getPos = p => {
        const v = p.position || p.pos || '';
        if (PC[v]) return v;
        return (String(p.playerNumber) === '1') ? 'POR' : 'MED';
    };

    // ── Reconstruir intervalos en campo desde el historial ────────────
    // history contiene eventos {type:'sub_in'|'sub_out'|'goal'|..., minute:N, second:S, timeStr:"MM:SS"}
    const buildIvs = (player, totMin) => {
        const rawHist = (player.history || []).filter(e => e.type === 'sub_in' || e.type === 'sub_out');
        
        // Agrupar por tiempo exacto para eliminar intercambios de posición (sub_in y sub_out simultáneos del mismo jugador)
        const timeMap = {};
        rawHist.forEach(e => {
            const exact = (e.minute || 0) + (e.second || 0) / 60;
            const tKey = exact.toFixed(3);
            if (!timeMap[tKey]) timeMap[tKey] = { in: false, out: false, events: [] };
            if (e.type === 'sub_in') timeMap[tKey].in = true;
            if (e.type === 'sub_out') timeMap[tKey].out = true;
            timeMap[tKey].events.push(e);
        });
        
        const hist = [];
        Object.values(timeMap).forEach(g => {
            if (g.in && g.out) return; // Se anulan (cambio de posición en el campo)
            hist.push(...g.events);
        });
        
        hist.sort((a, b) => {
            const ta = (a.minute || 0) + (a.second || 0) / 60;
            const tb = (b.minute || 0) + (b.second || 0) / 60;
            return ta - tb;
        });
            
        if (!hist.length) {
            const playedSome = (player.minutesPlayed > 0) || (player.status === 'field') || (player.initialStatus === 'field') || (player.titular === true);
            return playedSome ? [[0, totMin]] : [];
        }
        
        const ivs = [];
        let on = (player.status === 'field' || player.initialStatus === 'field' || player.titular === true) || hist[0].type === 'sub_out';
        let at = on ? 0 : null;
        
        hist.forEach(ev => {
            const exact = (ev.minute || 0) + (ev.second || 0) / 60;
            if (ev.type === 'sub_in' && !on) { on = true;  at = exact; }
            else if (ev.type === 'sub_out' && on)  { ivs.push([at, exact]); on = false; at = null; }
        });
        
        if (on && at !== null) ivs.push([at, totMin]);
        return ivs;
    };

    // ── Calcular minutos totales desde intervalos ─────────────────────
    const calcTot = ivs => ivs.reduce((s, [a, b]) => s + (b - a), 0);

    // ── Helper format time for totals
    const formatTot = t => {
        const mm = Math.floor(t);
        const ss = Math.round((t - mm) * 60);
        return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    };

    // ── Obtener tiempo exacto del cronómetro de cada jugador ──────────
    // Prioridad: minutesPlayed (cronómetro real) > calcTot(_ivs) (calculado por historial)
    const getExactTime = p => {
        if (p.minutesPlayed && /^\d{1,3}:\d{2}$/.test(String(p.minutesPlayed))) {
            return p.minutesPlayed; // "MM:SS" ya formateado
        }
        if (typeof p.minutesPlayed === 'number' && p.minutesPlayed > 0) {
            const mm = Math.floor(p.minutesPlayed / 60);
            const ss = p.minutesPlayed % 60;
            return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
        }
        if (p.time != null && p.time > 0) {
            const mm = Math.floor(p.time / 60);
            const ss = p.time % 60;
            return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
        }
        return formatTot(p._tot || 0);
    };

    // ── Extraer pares de sustitución de todos los jugadores ───────────
    // Empareja sub_out con sub_in al mismo minuto y segundo (±0.05 min de margen)
    const buildSubs = players => {
        const outs = [], ins = [];
        players.forEach(p => {
            const evs = (p.history || []);
            // Filtrar eventos simultáneos (cambios de posición)
            const timeMap = {};
            evs.forEach(ev => {
                if (ev.type !== 'sub_in' && ev.type !== 'sub_out') return;
                const exact = (ev.minute || 0) + (ev.second || 0) / 60;
                const tKey = exact.toFixed(3);
                if (!timeMap[tKey]) timeMap[tKey] = { in: false, out: false, eIn: null, eOut: null };
                if (ev.type === 'sub_in')  { timeMap[tKey].in = true; timeMap[tKey].eIn = ev; }
                if (ev.type === 'sub_out') { timeMap[tKey].out = true; timeMap[tKey].eOut = ev; }
            });
            
            Object.keys(timeMap).forEach(tKey => {
                const g = timeMap[tKey];
                if (g.in && g.out) return; // Es un simple cambio de posición en el campo, no sustitución
                const exact = parseFloat(tKey);
                if (g.out) outs.push({ min: exact, timeStr: g.eOut.timeStr || '', subId: g.eOut.subId || null, p });
                if (g.in)  ins.push({ min: exact, timeStr: g.eIn.timeStr || '', subId: g.eIn.subId || null, p });
            });
        });
        outs.sort((a, b) => a.min - b.min);
        const used = new Set(); // playerAlias de entradas (ins) ya emparejadas

        // Indice de entradas por subId para el emparejado PRIORITARIO. El subId
        // (id numerico de sustitucion) lo comparten la salida y la entrada de un
        // mismo cambio, asi que empareja con exactitud aunque haya varias
        // sustituciones en el mismo minuto (lo que la proximidad temporal no podia).
        const insBySubId = new Map(); // subId -> [ins]
        ins.forEach(i => {
            if (i.subId == null) return;
            if (!insBySubId.has(i.subId)) insBySubId.set(i.subId, []);
            insBySubId.get(i.subId).push(i);
        });

        const pairIn = new Array(outs.length).fill(null);

        // PASO 1 (prioritario): emparejar por subId exacto, ignorando la distancia
        // temporal. Se resuelve para TODAS las salidas con subId antes de pasar a la
        // proximidad, para que esta no 'robe' una entrada destinada a un subId.
        outs.forEach((o, idx) => {
            if (o.subId == null) return;
            const cands = insBySubId.get(o.subId);
            if (!cands) return;
            const hit = cands.find(i => !used.has(i.p.playerAlias) && i.p.playerAlias !== o.p.playerAlias);
            if (hit) { pairIn[idx] = hit; used.add(hit.p.playerAlias); }
        });

        // PASO 2 (fallback): salidas sin emparejar (informes antiguos sin subId, o
        // sin coincidencia por id) -> proximidad 0.05 min + entrada libre (Set de
        // playerAlias usados) + no auto-emparejar al mismo jugador.
        outs.forEach((o, idx) => {
            if (pairIn[idx]) return;
            const hit = ins.find(i => Math.abs(i.min - o.min) <= 0.05 && !used.has(i.p.playerAlias) && i.p.playerAlias !== o.p.playerAlias);
            if (hit) { pairIn[idx] = hit; used.add(hit.p.playerAlias); }
        });

        // Array unico final, en el mismo orden que outs (ordenado por min).
        return outs.map((o, idx) => {
            const found = pairIn[idx];
            return { min: o.min, timeStr: o.timeStr, out: o.p, inp: found ? found.p : null };
        });
    };

    // ── Determinar duración reglamentaria según categoría ─────────────
    //  Duración OFICIAL del encuentro = 2 × los minutos por tiempo que usa el
    //  cronómetro (js/core/setup-modal.js, donde se fijan half1MaxTime y
    //  half2MaxTime). Las dos tablas TIENEN que decir lo mismo: ésta atribuye
    //  los minutos que se muestran a cada jugador, no sólo la escala del Gantt.
    //    prebenjamín  2×30 = 60      infantil  2×40 = 80
    //    benjamín     2×35 = 70      cadete    2×40 = 80
    //    alevín       2×35 = 70      juvenil   2×45 = 90
    //                                regional  2×45 = 90
    //  El margen que permite el cronómetro (+10 min en F7, +15 en F11) es
    //  prolongación y protección ante cortes de conexión: NO forma parte de la
    //  base reglamentaria y se muestra aparte, como `+N'` (ver buildHeader).
    //
    //  ⚠️ EL ORDEN DE ESTAS COMPROBACIONES IMPORTA: 'prebenjamin' CONTIENE
    //  'benjamin'. Si se invierten, prebenjamín vuelve a resolverse como
    //  benjamín — que es exactamente el bug que esto corrige. La parte 2f del
    //  test recorre las siete categorías para impedir que vuelva.
    const getTotMin = m => {
        if (m.duration) return parseInt(m.duration) || 60;
        const cat = (m.category || '').toLowerCase();
        if (cat.includes('prebenjamin') || cat.includes('prebenjamín')) return 60;
        if (cat.includes('benjamin')    || cat.includes('benjamín'))    return 70;
        if (cat.includes('alevin')      || cat.includes('alevín'))      return 70;
        if (cat.includes('infantil'))                                   return 80;
        if (cat.includes('cadete'))                                     return 80;
        if (cat.includes('juvenil') || cat.includes('regional') || cat.includes('senior')) return 90;
        return 60; // genérico
    };

    // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 1: CABECERA DEL ENCUENTRO
    // ════════════════════════════════════════════════════════════════
    const buildHeader = (m, clubName, totMin, stopMin) => {
        const home  = esc(clubName || 'CD Local');
        const away  = esc(m.rival || 'Sin rival');
        const sh = m.scoreHome, sa = m.scoreAway;
        const score = (sh != null && sa != null) ? `${sh} – ${sa}` : '— : —';
        // Resultado desde la perspectiva del equipo del usuario (myTeamRole).
        // Sin myTeamRole (informes antiguos) → fallback 'home' (sh = mi equipo): comportamiento previo intacto.
        const _mine   = m.myTeamRole === 'away' ? sa : sh;
        const _theirs = m.myTeamRole === 'away' ? sh : sa;
        const res   = (sh != null && sa != null) ? (_mine > _theirs ? 'VICTORIA' : _mine < _theirs ? 'DERROTA' : 'EMPATE') : '';
        const rCol  = res === 'VICTORIA' ? '#3fb950' : res === 'DERROTA' ? '#ff5858' : '#eab308';
        const dateStr = m.matchDate
            ? new Date(m.matchDate).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
            : 'Fecha no disponible';
        const durStr = stopMin > 0
            ? `${totMin}' <span style="color:#58a6ff;font-size:0.85em;">+${stopMin}'</span>`
            : `${totMin}'`;

        const logoSVG =
            `<svg width="14" height="14" viewBox="0 0 20 20" fill="none">` +
            `<circle cx="10" cy="10" r="8" stroke="#3fb950" stroke-width="1.5"/>` +
            `<circle cx="10" cy="10" r="3" fill="#3fb950"/>` +
            `<line x1="10" y1="2" x2="10" y2="7" stroke="#3fb950" stroke-width="1.2"/>` +
            `<line x1="10" y1="13" x2="10" y2="18" stroke="#3fb950" stroke-width="1.2"/>` +
            `<line x1="2" y1="10" x2="7" y2="10" stroke="#3fb950" stroke-width="1.2"/>` +
            `<line x1="13" y1="10" x2="18" y2="10" stroke="#3fb950" stroke-width="1.2"/>` +
            `</svg>`;

        return (
            `<div style="background:linear-gradient(135deg,#0d1117,#161b22);` +
            `border:1px solid rgba(88,166,255,0.22);border-radius:14px;padding:1.1rem 1.3rem;margin-bottom:0.85rem;">` +

            // Cronos header row
            `<div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:0.85rem;` +
            `padding-bottom:0.7rem;border-bottom:1px solid rgba(255,255,255,0.07);">` +
            `<div style="width:30px;height:30px;border-radius:50%;background:#0d1117;border:2px solid #3fb950;` +
            `display:flex;align-items:center;justify-content:center;flex-shrink:0;">${logoSVG}</div>` +
            `<div style="flex:1;">` +
            `<div style="font-size:0.7rem;font-weight:700;letter-spacing:0.7px;color:#3fb950;">CRONOS FÚTBOL</div>` +
            `<div style="font-size:0.64rem;color:var(--text-muted);">Informe oficial post-partido · Generado automáticamente · No editable</div>` +
            `</div>` +
            `<div style="text-align:right;font-size:0.67rem;">` +
            (m.competition ? `<div style="color:#58a6ff;font-weight:600;margin-bottom:1px;">${esc(m.competition)}</div>` : '') +
            (m.category    ? `<div style="color:rgba(255,255,255,0.45);">${esc(m.category)}</div>` : '') +
            `</div></div>` +

            // Score row
            `<div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.75rem;">` +
            `<div style="flex:1;">` +
            `<div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">LOCAL</div>` +
            `<div style="font-size:1rem;font-weight:700;color:white;">${home}</div>` +
            `</div>` +
            `<div style="text-align:center;flex-shrink:0;">` +
            `<div style="font-size:1.85rem;font-weight:700;letter-spacing:6px;color:${rCol};">${score}</div>` +
            (res ? `<div style="font-size:0.62rem;font-weight:700;letter-spacing:1px;margin-top:1px;color:${rCol};">${res}</div>` : '') +
            `</div>` +
            `<div style="flex:1;text-align:right;">` +
            `<div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">VISITANTE</div>` +
            `<div style="font-size:1rem;font-weight:700;color:white;">${away}</div>` +
            `</div></div>` +

            // Metadata row
            `<div style="display:flex;flex-wrap:wrap;gap:0.4rem 0.9rem;font-size:0.69rem;color:var(--text-muted);">` +
            `<span>📅 ${dateStr}</span>` +
            (m.matchTime ? `<span>🕐 ${esc(m.matchTime)}</span>` : '') +
            `<span>⏱ <span style="color:rgba(255,255,255,0.7);">${durStr}</span></span>` +
            (stopMin > 0 ? `<span>⌛ Descuento: <strong style="color:#58a6ff;">+${stopMin}'</strong></span>` : '') +
            (m.venue ? `<span>📍 ${esc(m.venue)}</span>` : '') +
            `<span>👤 ${esc(m.coachEmail || 'Entrenador')}</span>` +
            `</div>` +
            `</div>`
        );
    };

    // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 2: TARJETAS DE RESUMEN (4 métricas)
    // ════════════════════════════════════════════════════════════════
    const buildStats = m => {
        const goals  = m.players.reduce((s, p) => s + (p.goals || 0), 0);
        const ycards = m.players.filter(p => p.cards === 'yellow').length;
        const rcards = m.players.filter(p => p.cards === 'red').length;
        const inj    = m.players.filter(p => p.injured).length;
        const cardTxt = ycards > 0
            ? (rcards > 0
                ? `<span style="color:#eab308;">${ycards}</span><span style="font-size:0.72rem;color:#ff5858;margin-left:2px;">+${rcards}R</span>`
                : `<span style="color:#eab308;">${ycards}</span>`)
            : `<span style="color:rgba(255,255,255,0.25);">0</span>`;
        return (
            `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);` +
            `border-radius:10px;padding:0.5rem;text-align:center;">` +
            `<div style="font-size:1.2rem;font-weight:700;color:white;">${m.participantsCount || m.players.length}</div>` +
            `<div style="font-size:0.62rem;color:var(--text-muted);">convocados</div></div>` +

            `<div style="background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.15);` +
            `border-radius:10px;padding:0.5rem;text-align:center;">` +
            `<div style="font-size:1.2rem;font-weight:700;color:#3fb950;">${goals}</div>` +
            `<div style="font-size:0.62rem;color:var(--text-muted);">goles</div></div>` +

            `<div style="background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.12);` +
            `border-radius:10px;padding:0.5rem;text-align:center;">` +
            `<div style="font-size:1.2rem;font-weight:700;">${cardTxt}</div>` +
            `<div style="font-size:0.62rem;color:var(--text-muted);">tarjetas</div></div>` +

            `<div style="background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.12);` +
            `border-radius:10px;padding:0.5rem;text-align:center;">` +
            `<div style="font-size:1.2rem;font-weight:700;color:${inj > 0 ? '#f97316' : 'rgba(255,255,255,0.25)'};">${inj}</div>` +
            `<div style="font-size:0.62rem;color:var(--text-muted);">lesiones</div></div>` +
            `</div>`
        );
    };

    // ════════════════════════════════════════════════════════════════
    // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 3: LÍNEAS DE TIEMPO INDIVIDUALES POR JUGADOR
    //  Reemplaza el Gantt combinado. Cada jugador tiene su propia
    //  línea de tiempo: barra azul = en campo, gris = banquillo.
    //  Al inicio/fin de cada barra: nombre del compañero de cambio.
    //  ────────────────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════
    const buildPlayerTimelines = (players, subs, totMin) => {
        // ── Mapas de sustitución para etiquetar los extremos de barra ──
        // subOutMap[alias] = [{timeFrac, name}]  → quién entró cuando salió
        // subInMap[alias]  = [{timeFrac, name}]  → a quién reemplazó al entrar
        const subOutMap = {}, subInMap = {};
        subs.forEach(s => {
            if (!s.out || !s.inp) return;
            const oa = s.out.playerAlias  || ('#' + s.out.playerNumber);
            const ia = s.inp.playerAlias  || ('#' + s.inp.playerNumber);
            const minStr = Math.floor(s.min) + "'";
            // esc(): estos nombres vienen del alias que teclea el entrenador y
            // acaban dentro de un <text> del SVG.
            (subOutMap[oa] = subOutMap[oa] || []).push({ timeFrac: s.min, name: `${esc(ia.substring(0, 9))} ${minStr}` });
            (subInMap[ia]  = subInMap[ia]  || []).push({ timeFrac: s.min, name: `${esc(oa.substring(0, 9))} ${minStr}` });
        });
        const findNear = (map, alias, t) => {
            const arr = map[alias];
            if (!arr) return null;
            const hit = arr.find(e => Math.abs(e.timeFrac - t) <= 0.12);
            return hit ? hit.name : null;
        };

        const W = 500;
        const TRACK_H = 16;
        const LANE_H  = 8.5;   // separación entre carriles de etiquetas apiladas
        const sc      = W / totMin;

        // ── Reparto de etiquetas en CARRILES para que no se solapen ──────────
        //  Con cambios en bloque (4, 5, 7 a la vez) y con jugadores que entran y
        //  salen varias veces seguidas, las etiquetas caen casi en la misma x y
        //  se encimaban. Se estima el ancho por número de caracteres (font-size 7
        //  ≈ 3.7 px por carácter) y cada etiqueta baja al primer carril libre.
        //  Devuelve el número de carriles usados, que es lo que define la altura
        //  de la fila.
        const asignarCarriles = (items) => {
            const lanes = [];   // lane -> [[x1,x2], …]
            items.forEach(it => {
                const w  = it.txt.length * 3.7 + 4;
                const x1 = it.anchor === 'end' ? it.x - w : it.x;
                const x2 = x1 + w;
                let lane = 0;
                while (lanes[lane] && lanes[lane].some(r => x1 < r[1] && r[0] < x2)) lane++;
                (lanes[lane] = lanes[lane] || []).push([x1, x2]);
                it.lane = lane;
            });
            return lanes.length;
        };

        // Marcas de tiempo según duración
        const step = totMin <= 50 ? 10 : 15;
        const ticks = [];
        for (let m = 0; m <= totMin; m += step) ticks.push(m);
        if (ticks[ticks.length-1] !== totMin) ticks.push(totMin);

        let html = `<div style="display:flex;flex-direction:column;gap:1px;padding:2px 0;">`;

        players.forEach((p, idx) => {
            const posCol  = PC[p._pos] || '#888';
            const timeStr = getExactTime(p);
            const alias   = esc((p.playerAlias || 'Jugador').substring(0, 16));
            const num     = p.playerNumber || '?';
            const aliasKey = p.playerAlias || ('#' + num);
            const periods  = p._ivs || [];

            // ── Etiquetas de cambio: UNA por transición, y nombra AL OTRO ──
            //  🔑 Antes se pintaban DOS textos en cada extremo de barra: el
            //  nombre del propio jugador y el de su pareja de cambio. El propio
            //  nombre es redundante —la fila ya es suya— y duplicar etiquetas
            //  era justo lo que las amontonaba con cambios en bloque.
            //  Convención (requisito del autor): ▲ verde al ENTRAR, con el
            //  nombre de a quién sustituye; ▼ roja al SALIR, con el nombre de
            //  quién entra por él.
            const arriba = [];   // salidas  (rojas ▼), sobre la barra
            const abajo  = [];   // entradas (verdes ▲), bajo la barra
            periods.forEach(([a, b]) => {
                if (a > 0.15) {
                    const outName = findNear(subInMap, aliasKey, a); // a quién sustituye
                    abajo.push({ x: a * sc + 3, anchor: 'start', color: '#3fb950',
                                 txt: '▲ ' + (outName || (Math.floor(a) + "'")) });
                }
                if (b < totMin - 0.3) {
                    const inpName = findNear(subOutMap, aliasKey, b); // quién entra por él
                    arriba.push({ x: b * sc - 3, anchor: 'end', color: '#ff5858',
                                  txt: (inpName || (Math.floor(b) + "'")) + ' ▼' });
                }
            });
            const nArriba = asignarCarriles(arriba);
            const nAbajo  = asignarCarriles(abajo);

            // La fila crece según los carriles que hagan falta: así apilar
            // etiquetas nunca las saca de su fila ni las mete en la siguiente.
            const TRACK_Y = 20 + Math.max(0, nArriba - 1) * LANE_H;
            const Hrow    = TRACK_Y + TRACK_H + 14 + Math.max(0, nAbajo - 1) * LANE_H + 12;
            const EVT_Y   = Math.max(6, TRACK_Y - 10); // zona de eventos, sobre la barra
            const LBL_Y   = Hrow - 3;                  // etiquetas de minutos

            // ── SVG por jugador ─────────────────────────────────────────
            let svg = `<svg viewBox="0 0 ${W} ${Hrow}" width="100%" style="display:block;overflow:visible;">`;

            // Fondo gris (banquillo completo)
            svg += `<rect x="0" y="${TRACK_Y}" width="${W}" height="${TRACK_H}" rx="4"
                fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.07)" stroke-width="0.5"/>`;

            // Calcular huecos (banquillo) y etiquetarlos
            const gaps = [];
            let prev = 0;
            [...periods].sort((a,b)=>a[0]-b[0]).forEach(([a,b]) => {
                if (a > prev + 0.1) gaps.push([prev, a]);
                prev = b;
            });
            if (prev < totMin - 0.1) gaps.push([prev, totMin]);

            gaps.forEach(([ga, gb]) => {
                const gW = (gb - ga) * sc;
                if (gW > 30) {
                    const cx = (ga + (gb - ga)/2) * sc;
                    svg += `<text x="${cx.toFixed(1)}" y="${TRACK_Y + TRACK_H/2 + 3.5}"
                        text-anchor="middle" font-size="6" fill="rgba(255,255,255,0.18)"
                        font-weight="700" letter-spacing="0.8">BANQUILLO</text>`;
                }
            });

            // Barras de tiempo en campo (azul) + etiquetas de cambio
            periods.forEach(([a, b]) => {
                const px = a * sc, pw = Math.max(2, (b - a) * sc);
                svg += `<rect x="${px.toFixed(1)}" y="${TRACK_Y}" width="${pw.toFixed(1)}"
                    height="${TRACK_H}" rx="3" fill="#58a6ff" fill-opacity="0.82"/>`;

                // Marcas verticales de entrada (verde) y salida (roja).
                if (a > 0.15) {
                    svg += `<line x1="${px.toFixed(1)}" y1="${TRACK_Y-4}" x2="${px.toFixed(1)}" y2="${TRACK_Y+TRACK_H+2}" stroke="#3fb950" stroke-width="1.8"/>`;
                }
                if (b < totMin - 0.3) {
                    const ex = px + pw;
                    svg += `<line x1="${ex.toFixed(1)}" y1="${TRACK_Y-4}" x2="${ex.toFixed(1)}" y2="${TRACK_Y+TRACK_H+2}" stroke="#ff5858" stroke-width="1.8"/>`;
                }
            });

            // Etiquetas ya repartidas en carriles (ver asignarCarriles).
            arriba.forEach(l => {
                const y = TRACK_Y - 7 - l.lane * LANE_H;
                svg += `<text x="${l.x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${l.anchor}" font-size="7" fill="${l.color}" font-weight="700">${l.txt}</text>`;
            });
            abajo.forEach(l => {
                const y = TRACK_Y + TRACK_H + 11 + l.lane * LANE_H;
                svg += `<text x="${l.x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${l.anchor}" font-size="7" fill="${l.color}" font-weight="700">${l.txt}</text>`;
            });

            // Ticks de tiempo
            ticks.forEach(mn => {
                const tx = mn * sc;
                svg += `<line x1="${tx.toFixed(1)}" y1="${TRACK_Y}" x2="${tx.toFixed(1)}" y2="${TRACK_Y+TRACK_H}"
                    stroke="rgba(255,255,255,0.1)" stroke-width="0.7" stroke-dasharray="2,2"/>`;
                svg += `<text x="${tx.toFixed(1)}" y="${LBL_Y}"
                    font-size="7.5" fill="rgba(255,255,255,0.28)"
                    text-anchor="${mn===0?'start':mn===totMin?'end':'middle'}">${mn}'</text>`;
            });

            // Eventos sobre la barra (goles, tarjetas, lesiones) con tiempo exacto
            (p.history || [])
                .filter(e => ['goal','yellow','red','injury'].includes(e.type))
                .forEach(ev => {
                    const ef = (ev.minute||0) + (ev.second||0)/60;
                    const ex = ef * sc;
                    const ts = ev.timeStr || `${ev.minute||0}'${ev.second>0?String(ev.second).padStart(2,'0')+'"':''}`;
                    if (ev.type === 'goal') {
                        svg += `<circle cx="${ex.toFixed(1)}" cy="${EVT_Y}" r="5.5" fill="white" stroke="#3fb950" stroke-width="1.5"/>`;
                        svg += `<circle cx="${ex.toFixed(1)}" cy="${EVT_Y}" r="2.2" fill="#3fb950"/>`;
                    } else if (ev.type === 'yellow') {
                        svg += `<rect x="${(ex-3.5).toFixed(1)}" y="${EVT_Y-6}" width="7" height="10" rx="1.5" fill="#eab308"/>`;
                    } else if (ev.type === 'red') {
                        svg += `<rect x="${(ex-3.5).toFixed(1)}" y="${EVT_Y-6}" width="7" height="10" rx="1.5" fill="#ef4444"/>`;
                    } else if (ev.type === 'injury') {
                        svg += `<polygon points="${ex},${EVT_Y-7} ${(ex-5)},${EVT_Y+4} ${(ex+5)},${EVT_Y+4}" fill="#f97316"/>`;
                    }
                    svg += `<text x="${ex.toFixed(1)}" y="${TRACK_Y-8}"
                        text-anchor="middle" font-size="5.5" fill="rgba(255,255,255,0.38)">${ts}</text>`;
                });

            svg += '</svg>';

            const bg = idx % 2 === 0 ? 'rgba(255,255,255,0.014)' : 'transparent';

            html += `
            <div style="display:flex;align-items:center;gap:0;padding:2px 0;background:${bg};border-radius:5px;">
                <div style="min-width:118px;max-width:118px;padding:0 6px 0 6px;flex-shrink:0;">
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span style="width:5px;height:5px;border-radius:50%;background:${posCol};flex-shrink:0;"></span>
                        <span style="font-size:0.72rem;font-weight:700;color:rgba(255,255,255,0.87);
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${num}. ${alias}</span>
                    </div>
                    <div style="font-size:0.65rem;color:#58a6ff;font-weight:600;margin-top:1px;padding-left:9px;">${timeStr}</div>
                </div>
                <div style="flex:1;min-width:0;overflow:hidden;">${svg}</div>
            </div>`;
        });

        html += '</div>';
        return html;
    };

    // ── Leyenda (actualizada para el nuevo formato) ───────────────────
    const buildLegend = () =>
        `<div style="display:flex;gap:6px 14px;flex-wrap:wrap;margin:6px 0 0.85rem;font-size:0.66rem;color:var(--text-muted);">` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="display:inline-block;width:12px;height:7px;background:#58a6ff;border-radius:2px;opacity:0.82;"></span>En campo</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="display:inline-block;width:12px;height:7px;background:rgba(255,255,255,0.07);border:0.5px solid rgba(255,255,255,0.15);border-radius:2px;"></span>Banquillo</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="display:inline-block;width:1.5px;height:12px;background:#3fb950;"></span><span style="color:#3fb950;font-weight:700;font-size:0.62rem;">▲ NOMBRE</span> Entra (sustituye a)</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="display:inline-block;width:1.5px;height:12px;background:#ff5858;"></span><span style="color:#ff5858;font-weight:700;font-size:0.62rem;">NOMBRE ▼</span> Sale (entra por él)</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;border-radius:50%;background:white;border:1.5px solid #3fb950;display:inline-block;"></span>Gol</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="width:7px;height:10px;background:#eab308;border-radius:1px;display:inline-block;"></span>Amarilla</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="width:7px;height:10px;background:#ef4444;border-radius:1px;display:inline-block;"></span>Roja</span>` +
        `<span style="display:flex;align-items:center;gap:3px;"><span style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid #f97316;display:inline-block;"></span>Lesión</span>` +
        `</div>`;

        // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 4: PANEL DE ROTACIONES — Quién por quién
    // ════════════════════════════════════════════════════════════════
    const buildRotPanel = (subs) => {
        if (!subs.length) return '';

        const rows = subs.map((sub, idx) => {
            const op = sub.out, ip = sub.inp;
            const oc = PC[op._pos] || '#888', ic = ip ? (PC[ip._pos] || '#888') : null;

            // ¿Es un regreso? (el jugador entrante tiene más de un intervalo y este no es el primero)
            let retBadge = '';
            if (ip && ip._ivs && ip._ivs.length > 1) {
                const pi = ip._ivs.findIndex(([a]) => a === sub.min);
                if (pi > 0) retBadge = `<span style="background:rgba(88,166,255,0.12);color:#58a6ff;padding:1px 6px;border-radius:100px;font-size:0.65rem;">Regresa · ${pi + 1}º per.</span>`;
            }

            // ¿Lesión asociada a esta sustitución?
            const isInj = (op.history || []).some(e => e.type === 'injury' && Math.abs((e.minute || 0) - sub.min) <= 1);
            const injBadge = isInj
                ? `<span style="background:rgba(249,115,22,0.12);color:#f97316;padding:1px 6px;border-radius:100px;font-size:0.65rem;">Lesión</span>` : '';

            // ¿En qué período sale el jugador saliente?
            const opPeriods = op._ivs ? op._ivs.length : 1;
            const opPeriodIdx = op._ivs ? op._ivs.findIndex(([, b]) => b === sub.min) : -1;
            const outPerBadge = opPeriods > 1 && opPeriodIdx >= 0
                ? ` <span style="font-size:0.62rem;opacity:0.6;">(${opPeriodIdx + 1}º per.)</span>` : '';

            // v219: flechas invertidas. ▼ verde = ENTRA al campo (hacia abajo), ▲ roja = SALE del campo (hacia arriba).
            // Sin "nº<num>"; solo se muestra el nombre del jugador.
            const outPill =
                `<span style="background:rgba(255,88,88,0.10);color:#ff5858;padding:2px 8px;border-radius:100px;` +
                `font-size:0.77rem;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;flex-shrink:0;">` +
                `<span style="font-size:0.85rem;color:#ff5858;font-weight:800;">▲</span> ${esc((op.playerAlias || 'Jugador').substring(0, 15))}${outPerBadge}</span>`;

            const inPill = ip
                ? `<span style="background:rgba(63,185,80,0.10);color:#3fb950;padding:2px 8px;border-radius:100px;` +
                  `font-size:0.77rem;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;flex-shrink:0;">` +
                  `<span style="font-size:0.85rem;color:#3fb950;font-weight:800;">▼</span> ${esc((ip.playerAlias || 'Jugador').substring(0, 15))}</span>`
                : `<span style="font-size:0.77rem;color:var(--text-muted);font-style:italic;">banquillo</span>`;

            return (
                `<div style="display:flex;align-items:center;gap:7px;padding:6px 0;` +
                `border-bottom:${idx < subs.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'};flex-wrap:wrap;">` +
                `<span style="min-width:35px;font-size:0.7rem;font-weight:700;color:var(--text-muted);flex-shrink:0;">${sub.timeStr || formatTot(sub.min)}</span>` +
                outPill +
                `<span style="color:rgba(255,255,255,0.2);font-size:0.85rem;flex-shrink:0;">→</span>` +
                inPill +
                injBadge + retBadge +
                `</div>`
            );
        }).join('');

        return (
            `<div style="font-size:0.67rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Panel de rotaciones · Quién por quién</div>` +
            `<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:0.65rem 0.85rem;margin-bottom:0.85rem;">${rows}</div>`
        );
    };

    // ════════════════════════════════════════════════════════════════
    //  SECCIÓN 5: REGISTRO CRONOLÓGICO DE INCIDENCIAS
    // ════════════════════════════════════════════════════════════════
    const buildEventsList = players => {
        const all = [];
        players.forEach(p => (p.history || []).forEach(ev => all.push({ ...ev, _p: p })));
        all.sort((a, b) => (a.minute || 0) - (b.minute || 0));

        const relevant = all.filter(ev => ['goal','yellow','red','injury','sub_in','sub_out'].includes(ev.type));
        if (!relevant.length) return '';

        const rows = relevant.map((ev, idx) => {
            // v218: sin "nº<num>"; solo nombre del jugador.
            const name = esc((ev._p.playerAlias || 'Jugador').substring(0, 16));
            let icon = '', col = 'var(--text-muted)', txt = '';

            if (ev.type === 'goal') {
                icon = `<span style="width:10px;height:10px;border-radius:50%;background:#3fb950;border:2px solid #27500A;display:inline-block;flex-shrink:0;"></span>`;
                // v218: GOL en MAYÚSCULAS (verde).
                col = '#3fb950'; txt = `<strong style="letter-spacing:0.5px;">GOL</strong> &middot; ${name}`;
            } else if (ev.type === 'yellow') {
                icon = `<span style="width:7px;height:10px;background:#eab308;border-radius:1px;display:inline-block;flex-shrink:0;"></span>`;
                // v218: TARJETA en MAYÚSCULAS (amarillo).
                col = '#eab308'; txt = `<strong style="letter-spacing:0.5px;">TARJETA</strong> &middot; ${name}`;
            } else if (ev.type === 'red') {
                icon = `<span style="width:7px;height:10px;background:#ef4444;border-radius:1px;display:inline-block;flex-shrink:0;"></span>`;
                // v218: TARJETA en MAYÚSCULAS (rojo).
                col = '#ff5858'; txt = `<strong style="letter-spacing:0.5px;">TARJETA</strong> &middot; ${name}`;
            } else if (ev.type === 'injury') {
                icon = `<span style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid #f97316;display:inline-block;flex-shrink:0;"></span>`;
                // v218: LESIÓN en MAYÚSCULAS (rojo).
                col = '#ef4444'; txt = `<strong style="letter-spacing:0.5px;">LESIÓN</strong> &middot; ${name}`;
            } else if (ev.type === 'sub_in') {
                // v219: ▼ verde = ENTRA al campo (hacia abajo).
                icon = `<span style="color:#3fb950;font-size:13px;line-height:1;flex-shrink:0;font-weight:800;">▼</span>`;
                col  = '#58a6ff';
                txt  = `<strong style="letter-spacing:0.5px;color:#58a6ff;">CAMBIO</strong> · <span style="color:#3fb950;">Entra</span> &middot; ${name}`;
            } else if (ev.type === 'sub_out') {
                // v219: ▲ roja = SALE del campo (hacia arriba).
                icon = `<span style="color:#ff5858;font-size:13px;line-height:1;flex-shrink:0;font-weight:800;">▲</span>`;
                col  = '#58a6ff';
                txt  = `<strong style="letter-spacing:0.5px;color:#58a6ff;">CAMBIO</strong> · <span style="color:#ff5858;">Sale</span> &middot; ${name}`;
            }

            return (
                `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;` +
                `border-bottom:${idx < relevant.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none'};font-size:0.76rem;">` +
                `<span style="min-width:35px;font-size:0.69rem;font-weight:700;color:var(--text-muted);flex-shrink:0;">${ev.timeStr || formatTot((ev.minute||0) + (ev.second||0)/60)}</span>` +
                icon +
                `<span style="color:${col};">${txt}</span>` +
                `</div>`
            );
        }).join('');

        return (
            `<div style="font-size:0.67rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Registro cronológico de incidencias</div>` +
            `<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:0.65rem 0.85rem;">${rows}</div>`
        );
    };

    // ════════════════════════════════════════════════════════════════
    //  TABLA RESUMEN — TIEMPO POR JUGADOR (cronómetro real)
    // ════════════════════════════════════════════════════════════════
    const buildTimeSummary = players => {
        const sorted = [...players].sort((a, b) => {
            const toSec = p => {
                const t = getExactTime(p);
                const [m, sc] = String(t).split(':').map(Number);
                return (m || 0) * 60 + (sc || 0);
            };
            return toSec(b) - toSec(a);
        });

        const rows = sorted.map((p, i) => {
            const t  = getExactTime(p);
            const bg = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'transparent';
            const goalBadge = (p.goals || 0) > 0
                ? `<span style="font-size:0.68rem;background:rgba(63,185,80,0.15);color:#3fb950;padding:1px 6px;border-radius:100px;">⚽ ${p.goals}</span>` : '';
            const cardBadge = p.cards === 'amarilla'
                ? `<span style="font-size:0.68rem;background:rgba(234,179,8,0.15);color:#eab308;padding:1px 6px;border-radius:100px;">🟨</span>`
                : p.cards === 'roja'
                ? `<span style="font-size:0.68rem;background:rgba(239,68,68,0.15);color:#ef4444;padding:1px 6px;border-radius:100px;">🟥</span>` : '';
            const injBadge = p.injured
                ? `<span style="font-size:0.68rem;background:rgba(249,115,22,0.15);color:#f97316;padding:1px 6px;border-radius:100px;">🚑</span>` : '';
            const badges = [goalBadge, cardBadge, injBadge].filter(Boolean).join(' ');

            return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:${bg};border-radius:5px;">
                <span style="min-width:22px;font-size:0.72rem;font-weight:700;color:rgba(255,255,255,0.35);text-align:right;">${esc(String(p.playerNumber || '?'))}</span>
                <span style="flex:1;font-size:0.8rem;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc((p.playerAlias || 'Jugador').substring(0, 22))}</span>
                <span style="display:flex;gap:3px;align-items:center;">${badges}</span>
                <span style="font-size:0.9rem;font-weight:800;color:white;letter-spacing:0.5px;font-variant-numeric:tabular-nums;min-width:46px;text-align:right;">${t}</span>
            </div>`;
        }).join('');

        return `<div style="font-size:0.67rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:1rem 0 0.4rem;">
            ⏱ Tiempo jugado por jugador
        </div>
        <div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:0.5rem 0.6rem;margin-bottom:0.9rem;">
            ${rows}
        </div>`;
    };

    // ════════════════════════════════════════════════════════════════
    //  ORQUESTADOR PRINCIPAL — build(matchData, currentUser)
    // ════════════════════════════════════════════════════════════════
    const build = (m, me) => {
        const totMin  = getTotMin(m);
        const stopMin = parseInt(m.stoppageTime) || 0;

        // 1. Deduplicar jugadores por número (quedarnos con el informe más completo/reciente)
        const uniquePlayers = {};
        m.players.forEach(p => {
            const num = p.playerNumber || '?';
            if (!uniquePlayers[num] || (p.history && p.history.length > (uniquePlayers[num].history || []).length)) {
                uniquePlayers[num] = p;
            }
        });

        // 2. Enriquecer y filtrar: Solo los que han tenido minutos de juego (convocados/participantes)
        const players = Object.values(uniquePlayers)
            .map(p => ({ ...p, _pos: getPos(p), _ivs: buildIvs(p, totMin) }))
            .filter(p => p.convocado || p._ivs.some(([a, b]) => b > a))
            .sort((a, b) => (parseInt(a.playerNumber) || 99) - (parseInt(b.playerNumber) || 99));

        players.forEach(p => { p._tot = calcTot(p._ivs); });
        
        // Guardar contador para las estadísticas
        m.participantsCount = players.length;

        const subs      = buildSubs(players);
        const clubName  = me?.clubName || 'CD Local';

        return (
            `<div style="padding:0.35rem 0 0.15rem;">` +
            buildHeader(m, clubName, totMin, stopMin) +
            buildStats(m) +
            `<div style="font-size:0.67rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:7px;">` +
            `Tiempos de partido · Línea individual por jugador</div>` +
            `<div style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:6px 4px;margin-bottom:4px;">` +
            buildPlayerTimelines(players, subs, totMin) +
            `</div>` +
            buildLegend() +
            buildTimeSummary(players) +
            buildRotPanel(subs) +
            buildEventsList(players) +
            `</div>`
        );
    };

    // Solo exponer build públicamente
    return { build };

})();

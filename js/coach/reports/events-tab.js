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
//  ⚠️ AUTO-PURGADO DESTRUCTIVO — LEER ANTES DE TOCAR: con más de MAX_ITEMS
//  (40) avisos, esta pestaña BORRA de Firestore con deleteDoc los más
//  antiguos, para TODOS los roles, de forma irreversible, fire-and-forget y
//  con el error silenciado (.catch(()=>{})). Ocurre en cada apertura de la
//  pestaña. La parte 3 del test fija el umbral, el orden previo por createdAt
//  descendente y que se borre el excedente y SÓLO el excedente.
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
    const MAX_ITEMS = 40;
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

        // Auto-borrar exceso (> MAX_ITEMS)
        if (items.length > MAX_ITEMS) {
            const toDelete = items.splice(MAX_ITEMS);
            toDelete.forEach(it => {
                if (it._id) deleteDoc(firestoreDoc(db,'cronos_notifications',it._id)).catch(()=>{});
            });
        }

        if (!items.length) {
            const label = type === 'convocatoria' ? 'convocatorias' : 'avisos de entrenamiento';
            container.innerHTML = `<div style="text-align:center;padding:4rem;color:var(--text-muted);">
                📭 Sin ${label} recibidos aún.<br>
                <span style="font-size:0.78rem;margin-top:0.5rem;display:block;">
                    El entrenador debe activar las palomillas en <strong>Gestión de Contactos</strong> y enviar via Envío Interno.
                </span></div>`;
            return;
        }

        const isConv = type === 'convocatoria';
        const accent = isConv ? 'var(--primary)' : '#f0883e';
        const icon   = isConv ? '📋' : '📅';

        let html = `<div style="font-size:0.73rem;color:var(--text-muted);margin-bottom:0.8rem;text-align:right;">
            ${items.length} registros · máx. ${MAX_ITEMS} (los más antiguos se eliminan automáticamente)
        </div>`;

        items.forEach(d => {
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

            html += `
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
        });
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
                    <div style="font-size:1.1rem;font-weight:900;color:${isC?'var(--primary)':'#f0883e'};">CRONOS FÚTBOL</div>
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
                        ${d.players.map((p,i)=>`<div style="font-size:0.82rem;padding:0.2rem 0.4rem;background:rgba(255,255,255,0.04);border-radius:4px;">${i+1}. ${escapeHtml(p)}</div>`).join('')}
                    </div>
                </div>`:''}
                ${d.extra?`<div style="font-size:0.85rem;padding:0.8rem;background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.2);border-radius:8px;font-style:italic;">💬 ${escapeHtml(d.extra)}</div>`:''}`;
            } else if (isPlan && (Array.isArray(d.days) || d.weekStartDate)) {
                // Planificación Semanal con tabla de días
                const weekDaysHTML = Array.isArray(d.days)
                    ? d.days.map(dy => {
                        const hasData = dy.time || dy.venue || dy.note;
                        return '<div style="display:flex;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">'
                            + '<div style="font-weight:700;color:#f0883e;min-width:80px;font-size:0.82rem;">' + escapeHtml(dy.day||'') + '</div>'
                            + '<div style="font-size:0.8rem;color:' + (hasData?'var(--text)':'#555') + ';">'
                            + (hasData
                                ? [dy.time?'🕐 '+dy.time:'', dy.venue?'📍 '+escapeHtml(dy.venue):'', dy.note?'📝 '+escapeHtml(dy.note):''].filter(Boolean).join(' &nbsp;·&nbsp; ')
                                : '_Descanso_')
                            + '</div></div>';
                    }).join('')
                    : '';
                body = `
                <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.2);border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
                    ${d.weekStartDate?`<div style="font-size:0.9rem;font-weight:700;color:#f0883e;margin-bottom:0.8rem;">📅 Semana del ${new Date(d.weekStartDate+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}</div>`:''}
                    <div style="display:flex;flex-direction:column;gap:0;">${weekDaysHTML}</div>
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

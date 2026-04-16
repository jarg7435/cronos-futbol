// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Staff Dashboard (Director Deportivo / Coordinador) v1.0
//  Pestañas: 📋 Convocatorias · 📊 Informes de Equipos
// ════════════════════════════════════════════════════════════════════

'use strict';

async function openStaffDashboard() {
    const me = window._cronosCurrentUser;
    const activeRole = me?._activeRole || me?.role;
    const isSA = me?.role === 'superadmin' || me?.role === 'admin';

    if (!me || (!isSA && !['director', 'coordinator'].includes(activeRole))) {
        if (typeof showToast === 'function') showToast('⛔ Acceso restringido', 3000);
        return;
    }

    // Ocultar app principal
    ['main-header', 'main-container', 'auth-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const fa = window._cronos_auth;
    const clubId = me.clubId || null;
    let clubName = '';

    if (fa && clubId) {
        try {
            const { doc, getDoc } = await import(
                'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            const cs = await getDoc(doc(fa.db, 'clubs', clubId));
            if (cs.exists()) clubName = cs.data().name || '';
        } catch(e) {}
    }

    const roleIcon = activeRole === 'director' ? '📋' : '🎯';
    const roleLabel = activeRole === 'director' ? 'Director Deportivo' : 'Coordinador';

    // Crear / reutilizar contenedor
    let panel = document.getElementById('staff-dashboard');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'staff-dashboard';
        document.body.appendChild(panel);
    }
    panel.style.cssText =
        'position:fixed;inset:0;background:#0a0e14;z-index:8000;' +
        'display:flex;flex-direction:column;overflow:hidden;font-family:inherit;';

    panel.innerHTML = `
    <style>
        #staff-dashboard .sd-tab {
            padding:0.55rem 1.1rem;
            background:rgba(255,255,255,0.04);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:8px;
            color:#7d8590;
            font-size:0.84rem;
            cursor:pointer;
            transition:all 0.15s;
            white-space:nowrap;
        }
        #staff-dashboard .sd-tab.active {
            background:rgba(240,136,62,0.15);
            border-color:rgba(240,136,62,0.5);
            color:#f0883e;
            font-weight:700;
        }
        #staff-dashboard .sd-card {
            background:rgba(255,255,255,0.04);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:12px;
            padding:1rem 1.2rem;
            margin-bottom:0.75rem;
        }
        #staff-dashboard .sd-empty {
            text-align:center;
            color:#7d8590;
            padding:4rem 1rem;
            font-size:0.9rem;
            line-height:1.8;
        }
        @keyframes sdPulse{0%,100%{opacity:1}50%{opacity:0.35}}
    </style>

    <!-- TOPBAR -->
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:0.85rem 1.2rem;
                border-bottom:1px solid rgba(255,255,255,0.08);
                background:rgba(10,14,20,0.98);flex-shrink:0;">
        <div>
            <div style="font-size:1rem;font-weight:700;color:white;">
                ${roleIcon} Panel de ${roleLabel}
                ${clubName ? `<span style="font-size:0.74rem;color:#7d8590;
                    font-weight:400;margin-left:0.4rem;">· ${typeof escapeHtml==='function'?escapeHtml(clubName):clubName}</span>` : ''}
            </div>
            <div style="font-size:0.71rem;color:#7d8590;margin-top:0.12rem;">
                ${typeof escapeHtml==='function'?escapeHtml(me.email||''):me.email||''}
            </div>
        </div>
        <div style="display:flex;gap:0.4rem;">
            <button onclick="window.saGoBackToRoles&&saGoBackToRoles();"
                style="background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.3);
                       color:#ffd700;padding:0.35rem 0.85rem;border-radius:6px;cursor:pointer;
                       font-size:0.74rem;font-weight:700;">⇄ Cambiar rol</button>
            <button onclick="if(typeof logoutUser==='function')logoutUser();"
                style="background:none;border:1px solid rgba(255,88,88,0.35);
                       color:rgba(255,88,88,0.75);font-size:0.74rem;
                       padding:0.35rem 0.85rem;border-radius:6px;cursor:pointer;">
                ⏻ Salir
            </button>
        </div>
    </div>

    <!-- TABS -->
    <div style="display:flex;gap:0.5rem;padding:0.7rem 1.2rem;
                border-bottom:1px solid rgba(255,255,255,0.08);
                flex-shrink:0;">
        <button class="sd-tab active" onclick="sdTab('convocatorias',this)">📋 Convocatorias</button>
        <button class="sd-tab" onclick="sdTab('informes',this)">📊 Informes</button>
    </div>

    <!-- CUERPO -->
    <div id="sd-body" style="flex:1;overflow-y:auto;padding:1.1rem 1.2rem;">
        <p style="color:#7d8590;text-align:center;padding:3rem;">⏳ Cargando…</p>
    </div>`;

    // ── Router ────────────────────────────────────────────────────
    window.sdTab = (tab, btn) => {
        panel.querySelectorAll('.sd-tab').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        document.getElementById('sd-body').innerHTML =
            '<p style="color:#7d8590;text-align:center;padding:3rem;">⏳ Cargando…</p>';
        ({ convocatorias: sdConvocatorias, informes: sdInformes })[tab]?.();
    };

    // ══════════════════════════════════════════════════════════════
    // TAB 1 · CONVOCATORIAS RECIBIDAS
    // ══════════════════════════════════════════════════════════════
    window.sdConvocatorias = async () => {
        const body = document.getElementById('sd-body');
        try {
            const { collection, getDocs, query, where } = await import(
                'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            let snap;
            if (clubId) {
                snap = await getDocs(query(
                    collection(fa.db, 'cronos_notifications'),
                    where('clubId', '==', clubId)
                ));
            } else {
                snap = await getDocs(collection(fa.db, 'cronos_notifications'));
            }

            const dismissed = JSON.parse(localStorage.getItem('cronos_staff_dismissed_conv') || '[]');
            const items = [];
            snap.forEach(d => {
                const dat = d.data();
                if (dismissed.includes(d.id)) return;
                if (dat.type === 'convocatoria') {
                    items.push({ _id: d.id, ...dat });
                }
            });
            items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

            if (!items.length) {
                body.innerHTML = `<div class="sd-empty">
                    📋 No hay convocatorias recibidas.<br>
                    <span style="font-size:0.8rem;color:#555;">
                        Aquí aparecerán las convocatorias enviadas por los entrenadores.
                    </span>
                </div>`;
                return;
            }

            body.innerHTML = items.map(n => {
                const sent = n.createdAt
                    ? new Date(n.createdAt).toLocaleDateString('es-ES', { day:'numeric', month:'long', year:'numeric' })
                    : '';
                const isConv = true;

                return `
                <div class="sd-card" style="border-left:3px solid #3fb950; position:relative;">
                    <button onclick="sdDismissConv('${typeof escapeAttr==='function'?escapeAttr(n._id):n._id}')"
                        style="position:absolute; top:1rem; right:1rem; background:rgba(255,88,88,0.08);
                               border:1px solid rgba(255,88,88,0.3); color:#ff5858;
                               width:30px; height:30px; border-radius:50%; display:flex;
                               align-items:center; justify-content:center; cursor:pointer;
                               font-size:0.85rem; z-index:10;"
                        title="Eliminar convocatoria">
                        🗑️
                    </button>
                    <div style="display:flex;justify-content:space-between;
                                margin-bottom:0.55rem;flex-wrap:wrap;gap:0.3rem; padding-right:2rem;">
                        <span style="font-weight:700;color:#3fb950;">📋 Convocatoria</span>
                        <span style="font-size:0.71rem;color:#7d8590;">${sent}</span>
                    </div>
                    ${n.matchDate ? `<div style="font-size:0.83rem;margin-bottom:0.25rem;">
                        📅 <strong>${typeof escapeHtml==='function'?escapeHtml(n.matchDate):n.matchDate}</strong>
                        ${n.rival ? ` · 🆚 vs <strong>${typeof escapeHtml==='function'?escapeHtml(n.rival):n.rival}</strong>` : ''}
                    </div>` : ''}
                    ${n.venue ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">🏟️ ${typeof escapeHtml==='function'?escapeHtml(n.venue):n.venue}</div>` : ''}
                    ${n.meettime ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">🕐 Presentación: <strong>${typeof escapeHtml==='function'?escapeHtml(n.meettime):n.meettime}h</strong></div>` : ''}
                    ${n.kickoff ? `<div style="font-size:0.82rem;margin-bottom:0.22rem;">⚽ Inicio: <strong>${typeof escapeHtml==='function'?escapeHtml(n.kickoff):n.kickoff}h</strong></div>` : ''}
                    ${n.coachEmail ? `<div style="font-size:0.72rem;color:#7d8590;margin-top:0.4rem;">📧 Enviada por: ${typeof escapeHtml==='function'?escapeHtml(n.coachEmail):n.coachEmail}</div>` : ''}
                    ${n.players?.length ? `
                    <div style="margin-top:0.5rem;padding:0.55rem 0.8rem;
                                background:rgba(63,185,80,0.07);border-radius:8px;
                                border:1px solid rgba(63,185,80,0.2);">
                        <div style="font-size:0.71rem;font-weight:700;
                                    color:#3fb950;margin-bottom:0.35rem;">
                            👥 CONVOCADOS (${n.players.length})
                        </div>
                        <div style="font-size:0.8rem;line-height:1.8;">
                            ${n.players.map((p, i) => `${i + 1}. ${typeof escapeHtml==='function'?escapeHtml(p):p}`).join('<br>')}
                        </div>
                    </div>` : ''}
                    ${n.extra ? `<div style="font-size:0.8rem;margin-top:0.5rem;
                        color:#7d8590;font-style:italic;">💬 ${typeof escapeHtml==='function'?escapeHtml(n.extra):n.extra}</div>` : ''}
                    <div style="margin-top:0.7rem;display:flex;gap:0.4rem;flex-wrap:wrap;">
                        <button onclick="sdSaveConv('${typeof escapeAttr==='function'?escapeAttr(n._id):n._id}')"
                            style="padding:0.35rem 0.8rem;background:rgba(63,185,80,0.12);
                                   border:1px solid rgba(63,185,80,0.35);border-radius:7px;
                                   color:#3fb950;font-size:0.75rem;font-weight:700;cursor:pointer;">
                            💾 Guardar</button>
                        <button onclick="sdDismissConv('${typeof escapeAttr==='function'?escapeAttr(n._id):n._id}')"
                            style="padding:0.35rem 0.8rem;background:rgba(255,88,88,0.1);
                                   border:1px solid rgba(255,88,88,0.3);border-radius:7px;
                                   color:#ff5858;font-size:0.75rem;font-weight:700;cursor:pointer;">
                            🗑️ Eliminar</button>
                    </div>
                </div>`;
            }).join('');

        } catch (e) {
            body.innerHTML = `<div class="sd-empty">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
        }
    };

    // ── Guardar convocatoria localmente ──
    window.sdSaveConv = (id) => {
        const saved = JSON.parse(localStorage.getItem('cronos_staff_saved_conv') || '[]');
        if (!saved.includes(id)) saved.push(id);
        localStorage.setItem('cronos_staff_saved_conv', JSON.stringify(saved));
        if (typeof showToast === 'function') showToast('💾 Convocatoria guardada', 2000);
    };

    // ── Eliminar / descartar convocatoria ──
    window.sdDismissConv = (id) => {
        if (!confirm('¿Deseas eliminar esta convocatoria?')) return;
        const dismissed = JSON.parse(localStorage.getItem('cronos_staff_dismissed_conv') || '[]');
        if (!dismissed.includes(id)) dismissed.push(id);
        localStorage.setItem('cronos_staff_dismissed_conv', JSON.stringify(dismissed));
        if (typeof sdConvocatorias === 'function') sdConvocatorias();
        if (typeof showToast === 'function') showToast('🗑️ Convocatoria eliminada', 2000);
    };

    // ══════════════════════════════════════════════════════════════
    // TAB 2 · INFORMES DE EQUIPOS
    // ══════════════════════════════════════════════════════════════
    window.sdInformes = async () => {
        const body = document.getElementById('sd-body');
        try {
            const { collection, getDocs, query, where } = await import(
                'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            const snap = await getDocs(query(
                collection(fa.db, 'cronos_player_reports'),
                where('clubId', '==', clubId || '_none')
            ));

            const reports = [];
            snap.forEach(d => reports.push({ id: d.id, ...d.data() }));
            reports.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

            if (!reports.length) {
                body.innerHTML = `<div class="sd-empty">
                    📊 No hay informes de partido disponibles.<br>
                    <span style="font-size:0.8rem;color:#555;">
                        Aquí aparecerán los informes enviados por los entrenadores
                        tras cada partido.
                    </span>
                </div>`;
                return;
            }

            // Agrupar por partido
            const matches = {};
            reports.forEach(r => {
                const key = `${r.matchDate || r.createdAt?.slice(0,10) || '?'}_${r.rival || 'sin-rival'}_${r.coachUid || ''}`;
                if (!matches[key]) {
                    matches[key] = {
                        key, matchDate: r.matchDate || r.createdAt?.slice(0,10),
                        rival: r.rival, scoreHome: r.scoreHome, scoreAway: r.scoreAway,
                        coachEmail: r.coachEmail, teamName: r.teamName || '',
                        createdAt: r.createdAt, players: [],
                    };
                }
                matches[key].players.push(r);
            });

            const sorted = Object.values(matches).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

            body.innerHTML = `<div style="margin-bottom:0.8rem;font-size:0.76rem;color:#7d8590;">
                ${sorted.length} partido${sorted.length !== 1 ? 's' : ''} · ${reports.length} informes de jugadores
            </div>` + sorted.map(m => {
                const goals = m.players.reduce((s, p) => s + (p.goals || 0), 0);
                const dateStr = m.matchDate
                    ? new Date(m.matchDate).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit' })
                    : '—';
                const score = (m.scoreHome != null && m.scoreAway != null) ? `${m.scoreHome}-${m.scoreAway}` : '—';
                const matchKey = btoa(unescape(encodeURIComponent(m.key))).replace(/=/g, '');

                return `
                <div class="sd-card" id="sd-rpcard-${matchKey}" style="position:relative;">
                    <button onclick="sdDeleteInforme('${matchKey}')"
                        style="position:absolute;top:1rem;right:1rem;background:rgba(255,88,88,0.08);
                               border:1px solid rgba(255,88,88,0.3);color:#ff5858;
                               width:30px;height:30px;border-radius:50%;display:flex;
                               align-items:center;justify-content:center;cursor:pointer;
                               font-size:0.8rem;z-index:10;" title="Eliminar informe">
                        🗑️
                    </button>
                    <div onclick="sdToggleInforme('${matchKey}')"
                         style="display:flex;justify-content:space-between;
                                align-items:start;gap:0.5rem;cursor:pointer;padding-right:2rem;">
                        <div>
                            <div style="font-weight:700;font-size:0.95rem;">
                                🆚 vs <span style="color:#f0883e;">
                                    ${typeof escapeHtml==='function'?escapeHtml(m.rival || 'Sin rival'):m.rival || 'Sin rival'}
                                </span>
                            </div>
                            <div style="font-size:0.72rem;color:#7d8590;margin-top:2px;">
                                📅 ${dateStr} · <strong style="color:white;">${score}</strong>
                                ${m.coachEmail ? ` · ${typeof escapeHtml==='function'?escapeHtml(m.coachEmail):m.coachEmail}` : ''}
                            </div>
                            ${goals > 0 ? `<div style="font-size:0.72rem;color:#3fb950;margin-top:2px;">⚽ ${goals} goles</div>` : ''}
                        </div>
                        <div style="font-size:0.62rem;color:#7d8590;text-align:right;">
                            ${m.players.length} jugadores<br>▼ Ver
                        </div>
                    </div>
                    <div id="sd-rpdetail-${matchKey}" style="display:none;margin-top:0.7rem;
                            border-top:1px solid rgba(255,255,255,0.08);padding-top:0.7rem;">
                        <div style="display:flex;gap:0.4rem;margin-bottom:0.6rem;flex-wrap:wrap;">
                            <button onclick="sdDownloadInforme('${matchKey}')"
                                style="padding:0.3rem 0.7rem;background:rgba(88,166,255,0.12);
                                       border:1px solid rgba(88,166,255,0.3);border-radius:6px;
                                       color:#58a6ff;font-size:0.72rem;font-weight:700;cursor:pointer;">
                                📥 Descargar</button>
                            <button onclick="sdShareInforme('${matchKey}')"
                                style="padding:0.3rem 0.7rem;background:rgba(63,185,80,0.12);
                                       border:1px solid rgba(63,185,80,0.3);border-radius:6px;
                                       color:#3fb950;font-size:0.72rem;font-weight:700;cursor:pointer;">
                                📤 Compartir</button>
                        </div>
                        ${m.players.sort((a,b)=>(a.playerNumber||0)-(b.playerNumber||0)).map(p => `
                        <div style="display:flex;align-items:center;gap:0.5rem;
                                    padding:0.4rem 0.5rem;background:rgba(255,255,255,0.025);
                                    border-radius:7px;margin-bottom:0.3rem;">
                            <div style="background:rgba(240,136,62,0.12);width:30px;height:30px;
                                        border-radius:8px;display:flex;align-items:center;
                                        justify-content:center;color:#f0883e;font-weight:700;
                                        font-size:0.8rem;flex-shrink:0;">
                                #${p.playerNumber || '?'}
                            </div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:700;font-size:0.82rem;">
                                    ${typeof escapeHtml==='function'?escapeHtml(p.playerAlias || 'Jugador'):p.playerAlias || 'Jugador'}
                                </div>
                                <div style="font-size:0.68rem;color:#7d8590;">
                                    ⏱ ${p.minutesPlayed || '—'}
                                    ${p.goals > 0 ? ` · ⚽ ${p.goals}` : ''}
                                    ${p.cards && p.cards !== 'ninguna' ? ` · ${p.cards === 'roja' ? '🟥' : '🟨'}` : ''}
                                    ${p.injured ? ' · 🩹' : ''}
                                </div>
                            </div>
                        </div>`).join('')}
                    </div>
                </div>`;
            }).join('');

            // Store match data globally for download/share
            window._sdMatches = matches;

        } catch (e) {
            body.innerHTML = `<div class="sd-empty">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
        }
    };

    // ── Toggle detalle de informe ──
    window.sdToggleInforme = (key64) => {
        const card = document.getElementById(`sd-rpcard-${key64}`);
        const detail = document.getElementById(`sd-rpdetail-${key64}`);
        if (!detail) return;
        const isOpen = detail.style.display !== 'none';
        detail.style.display = isOpen ? 'none' : 'block';
        if (card) card.style.borderColor = isOpen ? 'rgba(255,255,255,0.1)' : 'rgba(240,136,62,0.5)';
    };

    // ── Descargar informe como texto ──
    window.sdDownloadInforme = (key64) => {
        const key = decodeURIComponent(escape(atob(key64)));
        const m = window._sdMatches?.[key];
        if (!m) return;

        let text = `INFORME DE PARTIDO - ${m.teamName || 'Equipo'}\n`;
        text += `========================================\n`;
        text += `Rival: ${m.rival || '—'}\n`;
        text += `Fecha: ${m.matchDate || '—'}\n`;
        text += `Resultado: ${m.scoreHome ?? '—'} - ${m.scoreAway ?? '—'}\n`;
        text += `Entrenador: ${m.coachEmail || '—'}\n\n`;
        text += `JUGADORES:\n`;
        text += `----------------------------------------\n`;
        m.players.sort((a,b)=>(a.playerNumber||0)-(b.playerNumber||0)).forEach(p => {
            text += `#${p.playerNumber || '?'} ${p.playerAlias || 'Jugador'} | `;
            text += `Min: ${p.minutesPlayed || '0'} | Goles: ${p.goals || 0} | `;
            text += `Tarjeta: ${p.cards && p.cards !== 'ninguna' ? p.cards : 'Ninguna'} | `;
            text += `Lesion: ${p.injured ? 'Sí' : 'No'}\n`;
        });
        text += `\nGenerado por Chronos Fútbol`;

        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `informe_${m.rival || 'partido'}_${m.matchDate || 'fecha'}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        if (typeof showToast === 'function') showToast('📥 Informe descargado', 2000);
    };

    // ── Compartir informe (Web Share API o copiar al portapapeles) ──
    window.sdShareInforme = async (key64) => {
        const key = decodeURIComponent(escape(atob(key64)));
        const m = window._sdMatches?.[key];
        if (!m) return;

        let text = `📋 INFORME - ${m.teamName || 'Equipo'} vs ${m.rival || '—'}\n`;
        text += `📅 ${m.matchDate || '—'} · Resultado: ${m.scoreHome ?? '—'}-${m.scoreAway ?? '—'}\n\n`;
        m.players.sort((a,b)=>(a.playerNumber||0)-(b.playerNumber||0)).forEach(p => {
            text += `#${p.playerNumber || '?'} ${p.playerAlias || 'Jugador'} - ${p.minutesPlayed || '0'}min`;
            if (p.goals > 0) text += ` - ⚽${p.goals}`;
            text += '\n';
        });

        if (navigator.share) {
            try {
                await navigator.share({ title: `Informe: vs ${m.rival}`, text });
                return;
            } catch (e) { /* fallback */ }
        }

        // Fallback: copiar al portapapeles
        try {
            await navigator.clipboard.writeText(text);
            if (typeof showToast === 'function') showToast('📋 Informe copiado al portapapeles', 3000);
        } catch (e) {
            if (typeof showToast === 'function') showToast('⚠️ No se pudo copiar', 3000);
        }
    };

    // ── Eliminar informe ──
    window.sdDeleteInforme = async (key64) => {
        if (!confirm('¿Deseas eliminar este informe de tu vista?')) return;
        const key = decodeURIComponent(escape(atob(key64)));
        const dismissed = JSON.parse(localStorage.getItem('cronos_staff_dismissed_info') || '[]');
        if (!dismissed.includes(key)) dismissed.push(key);
        localStorage.setItem('cronos_staff_dismissed_info', JSON.stringify(dismissed));
        if (typeof sdInformes === 'function') sdInformes();
        if (typeof showToast === 'function') showToast('🗑️ Informe eliminado', 2000);
    };

    // Cargar pestaña inicial
    sdConvocatorias();
}

window.openStaffDashboard = openStaffDashboard;

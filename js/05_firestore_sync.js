// ══════════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN EN VIVO — Firestore
// ══════════════════════════════════════════════════════════════════

async function cleanupStaleMatches() {
    try {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) return;
        const { collection, query, where, getDocs,
                updateDoc, deleteDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // Obtener todos los partidos
        const snap = await getDocs(collection(fa.db, 'live_matches'));

        let closed = 0, deleted = 0;
        const promises = [];

        snap.forEach(d => {
            const data    = d.data();
            const updated = data.updatedAt?.toDate?.() || new Date(0);

            if (updated < sevenDaysAgo) {
                // Más de 7 días → borrar definitivamente
                promises.push(
                    deleteDoc(doc(fa.db, 'live_matches', d.id))
                        .then(() => deleted++)
                        .catch(() => {})
                );
            } else if (data.status === 'active' && updated < fourHoursAgo) {
                // Más de 4 horas sin actualizar → cerrar como finalizado
                promises.push(
                    updateDoc(doc(fa.db, 'live_matches', d.id), { status: 'finished' })
                        .then(() => closed++)
                        .catch(() => {})
                );
            }
        });

        await Promise.all(promises);

        if (closed > 0)   console.log('Partidos zombis cerrados:', closed);
        if (deleted > 0)  console.log('Partidos antiguos borrados:', deleted);

    } catch(e) { console.warn('cleanupStaleMatches:', e.message); }
}

async function startLiveSync() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) return;

    // Generar ID legible: nombre-equipo-fecha  (ej: atletico-20032026-a3f)
    // Así en el historial y en los enlaces se identifica el equipo de un vistazo
    const slugify = (str) => (str || 'equipo')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
        .replace(/[^a-z0-9]+/g, '-')                        // solo letras y números
        .replace(/^-+|-+$/g, '')                            // sin guiones al inicio/fin
        .substring(0, 20);                                   // máximo 20 chars

    const teamSlug = slugify(TEAM_NAMES.home);
    const now      = new Date();
    const dateSlug = String(now.getDate()).padStart(2,'0') +
                     String(now.getMonth()+1).padStart(2,'0') +
                     now.getFullYear();
    const randSlug = Math.random().toString(36).substr(2,4);
    liveMatchId    = `${teamSlug}-${dateSlug}-${randSlug}`;
    liveIsActive = true;

    // Guardar el snapshot inicial
    await pushLiveSnapshot('active');

    // Sincronizar el cronómetro cada 5 segundos (antes era 15s)
    liveSyncTimer = setInterval(() => {
        if (liveIsActive && isRunning) pushLiveSnapshot('active');
    }, 5000);

    // Mostrar botón de compartir en el header
    updateLiveButton(true);
    console.log('🔴 Live sync iniciado:', liveMatchId);
}

async function pushLiveSnapshot(status = 'active') {
    const fa = window._cronos_auth;
    if (!fa || !fa.db || !liveMatchId) return;

    try {
        const { setDoc, doc, serverTimestamp } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const scoreHome = document.getElementById('score-home')?.textContent || '0';
        const scoreAway = document.getElementById('score-away')?.textContent || '0';

        const snapshot = {
            id:          liveMatchId,
            status:      status,          // 'active' | 'finished'
            updatedAt:   serverTimestamp(),
            createdBy:   window._cronosCurrentUser?.uid   || '',
            coachEmail:  window._cronosCurrentUser?.email || '',
            clubId:      window._cronosCurrentUser?.clubId || null,

            // Partido
            mode:        currentMode,
            phase:       matchPhase,
            timeH1:      masterTimeH1,
            timeH2:      masterTimeH2,
            formation:   activeFormationKey || '',

            // Equipos
            homeTeam: {
                name:     TEAM_NAMES.home,
                score:    parseInt(scoreHome) || 0,
                color:    COLORS.home.primary,
                shorts:   COLORS.home.shorts,
                textColor:COLORS.home.text
            },
            awayTeam: {
                name:     TEAM_NAMES.away,
                score:    parseInt(scoreAway) || 0,
                color:    COLORS.away.primary,
                shorts:   COLORS.away.shorts,
                textColor:COLORS.away.text
            },

            // Jugadores (campo + banquillo)
            players: players.map(p => ({
                id:      p.id,
                number:  p.number,
                name:    p.name,
                team:    p.team,
                status:  p.status,    // 'field' | 'bench'
                time:    p.time,
                goals:   p.goals   || 0,
                cards:   p.cards   || 'ninguna',
                injured: p.injured || false,
                x:       p.x       || 0,
                y:       p.y       || 0
            }))
        };

        await setDoc(doc(fa.db, 'live_matches', liveMatchId), snapshot);
    } catch (err) {
        console.warn('Error sync live:', err.message);
    }
}

async function stopLiveSync() {
    if (!liveIsActive) return;
    liveIsActive = false;
    if (liveSyncTimer) { clearInterval(liveSyncTimer); liveSyncTimer = null; }
    await pushLiveSnapshot('finished');
    updateLiveButton(false);
    console.log('⏹ Live sync detenido');
}

function updateLiveButton(active) {
    let btn = document.getElementById('btn-live-share');
    if (!btn) {
        // Crear el botón si no existe e insertarlo en header-actions
        btn = document.createElement('button');
        btn.id = 'btn-live-share';
        btn.title = 'Compartir partido en vivo';
        btn.style.cssText =
            'font-size:0.65rem; padding:0.3rem 0.6rem; border-radius:6px; cursor:pointer;';
        btn.onclick = showLiveShareModal;
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) headerActions.insertBefore(btn, headerActions.firstChild);
    }
    if (active) {
        btn.textContent   = '🔴 EN VIVO';
        btn.style.background = 'rgba(255,88,88,0.2)';
        btn.style.border     = '1px solid rgba(255,88,88,0.6)';
        btn.style.color      = '#ff5858';
        btn.style.animation  = 'livePulse 1.5s ease-in-out infinite';
        // Añadir keyframe si no existe
        if (!document.getElementById('live-pulse-style')) {
            const s = document.createElement('style');
            s.id = 'live-pulse-style';
            s.textContent = '@keyframes livePulse{0%,100%{opacity:1}50%{opacity:0.5}}';
            document.head.appendChild(s);
        }
    } else {
        btn.textContent      = '📡 INICIAR VIVO';
        btn.style.background = 'rgba(88,166,255,0.1)';
        btn.style.border     = '1px solid rgba(88,166,255,0.3)';
        btn.style.color      = '#58a6ff';
        btn.style.animation  = 'none';
    }
}

function openLiveView() {
    // Abrir la pantalla de partidos en vivo en una nueva pestaña
    const liveUrl = location.origin + location.pathname.replace('index.html','') + 'live.html';
    window.open(liveUrl, '_blank');
}

function showLiveShareModal() {
    if (!liveMatchId) {
        // No hay partido activo — preguntar si quiere iniciarlo
        if (confirm('¿Iniciar la transmisión en vivo para que el Director Deportivo pueda seguir el partido?')) {
            startLiveSync();
        }
        return;
    }

    const liveUrl = `${location.origin}${location.pathname.replace('index.html','')}live.html?match=${liveMatchId}`;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(95vw,500px);">
            <h2 style="margin:0 0 0.3rem; text-align:center;">🔴 Partido en Vivo</h2>
            <p style="color:var(--text-muted); font-size:0.8rem; text-align:center; margin-bottom:1.2rem;">
                Comparte este enlace con el Director Deportivo para que siga el partido en tiempo real.
                Solo usuarios registrados y autorizados pueden verlo.
            </p>

            <!-- URL -->
            <div style="background:rgba(255,88,88,0.08); border:1px solid rgba(255,88,88,0.3);
                        border-radius:10px; padding:0.9rem; margin-bottom:1rem;">
                <p style="font-size:0.7rem; color:#7d8590; margin:0 0 0.4rem;">🔗 Enlace del partido</p>
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <input id="live-url-input" type="text" value="${liveUrl}" readonly
                        style="flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                               border-radius:6px; padding:0.5rem 0.7rem; color:#cdd9e5;
                               font-size:0.75rem; font-family:monospace; outline:none;">
                    <button onclick="copyLiveUrl()"
                        style="padding:0.5rem 0.8rem; background:#58a6ff; border:none;
                               border-radius:6px; color:#0a0e14; font-weight:700;
                               font-size:0.75rem; cursor:pointer; white-space:nowrap;">
                        📋 Copiar
                    </button>
                </div>
            </div>

            <!-- Botones de compartir -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-bottom:1rem;">
                <button onclick="shareLiveWhatsApp('${liveUrl}')"
                    style="padding:0.7rem; background:rgba(37,211,102,0.12);
                           border:1px solid rgba(37,211,102,0.4); border-radius:8px;
                           color:#25d366; font-weight:700; font-size:0.85rem; cursor:pointer;">
                    📱 WhatsApp
                </button>
                <button onclick="shareLiveEmail('${liveUrl}')"
                    style="padding:0.7rem; background:rgba(88,166,255,0.1);
                           border:1px solid rgba(88,166,255,0.3); border-radius:8px;
                           color:#58a6ff; font-weight:700; font-size:0.85rem; cursor:pointer;">
                    📧 Email
                </button>
            </div>

            <div style="display:flex; justify-content:space-between; gap:0.6rem;">
                <button class="btn danger" onclick="confirmStopLive()"
                    style="font-size:0.82rem;">
                    ⏹ Finalizar transmisión
                </button>
                <button class="btn primary" onclick="document.getElementById('setup-modal').style.display='none'">
                    ✕ Cerrar
                </button>
            </div>
        </div>`;
}

function copyLiveUrl() {
    const input = document.getElementById('live-url-input');
    if (!input) return;
    navigator.clipboard.writeText(input.value).then(() => {
        const btn = input.nextElementSibling;
        btn.textContent = '✅ Copiado';
        setTimeout(() => btn.textContent = '📋 Copiar', 2000);
    }).catch(() => { input.select(); document.execCommand('copy'); });
}

function shareLiveWhatsApp(url) {
    const date = new Date().toLocaleDateString('es-ES');
    const msg  = encodeURIComponent(
        `⚽ *CRONOS FÚTBOL — Partido en Vivo*\n` +
        `${TEAM_NAMES.home} vs ${TEAM_NAMES.away} · ${date}\n\n` +
        `Sigue el partido en tiempo real:\n${url}\n\n` +
        `_(Necesitas estar registrado en la app para verlo)_`);
    const num = emailConfig?.whatsappNumber;
    window.open(num ? `https://wa.me/${num}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank');
}

function shareLiveEmail(url) {
    const date    = new Date().toLocaleDateString('es-ES');
    const subject = encodeURIComponent(`⚽ Partido en Vivo — ${TEAM_NAMES.home} vs ${TEAM_NAMES.away}`);
    const body    = encodeURIComponent(
        `Hola,\n\n` +
        `Puedes seguir el partido en tiempo real desde este enlace:\n${url}\n\n` +
        `${TEAM_NAMES.home} vs ${TEAM_NAMES.away} · ${date}\n\n` +
        `Necesitas estar registrado y autorizado en Cronos Fútbol para acceder.\n\n` +
        `Cronos Fútbol — Coach Assistant`);
    const to = emailConfig?.directorEmail || '';
    window.open(`mailto:${to}?subject=${subject}&body=${body}`);
}

function confirmStopLive() {
    if (confirm('¿Finalizar la transmisión en vivo?\n\nEl enlace quedará guardado como historial.')) {
        stopLiveSync();
        document.getElementById('setup-modal').style.display = 'none';
    }
}

// Llamar a pushLiveSnapshot en cada acción relevante del partido
function liveSyncOnAction() {
    if (liveIsActive) pushLiveSnapshot('active');
}


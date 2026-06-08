// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — MATCH/LIVE/SYNC
// Live sync, Firestore push, stop sync, live view, sharing
// Extraído de app.js (líneas 1552-1957)
// ══════════════════════════════════════════════════════════════════

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
    // E4: nuevo partido en vivo → liberar el guard de despacho de informes.
    window._cronosLastDispatchedMatch = null;

    // Guardar el snapshot inicial
    await pushLiveSnapshot('active');

    // Sincronizar estado cada 5 segundos — siempre, incluso en pausa
    liveSyncTimer = setInterval(() => {
        if (liveIsActive) pushLiveSnapshot('active');
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

            // Partido
            mode:        currentMode,
            phase:       matchPhase,
            isRunning:   isRunning,
            timeH1:      masterTimeH1,
            timeH2:      masterTimeH2,
            half1MaxTime: typeof half1MaxTime !== 'undefined' ? half1MaxTime : 1800,
            half2MaxTime: typeof half2MaxTime !== 'undefined' ? half2MaxTime : 1800,
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

        await setDoc(doc(fa.db, 'live_matches', liveMatchId), snapshot, { merge: true });
    } catch (err) {
        console.warn('Error sync live:', err.message);
    }
}

async function stopLiveSync() {
    if (!liveIsActive) return;
    liveIsActive = false;
    if (liveSyncTimer) { clearInterval(liveSyncTimer); liveSyncTimer = null; }
    
    // Si el partido REALMENTE ha terminado (fase finished), se marca como finished.
    // De lo contrario, se queda como 'active' para que siga recuperándolo!
    const finalStatus = (typeof matchPhase !== 'undefined' && matchPhase === 'finished') ? 'finished' : 'active';
    await pushLiveSnapshot(finalStatus);
    
    updateLiveButton(false);
    console.log('⏹ Live sync detenido, status:', finalStatus);
}

function updateLiveButton(active) {
    let indicator = document.getElementById('live-status-indicator');
    if (!indicator) {
        // Crear el contenedor del indicador si no existe
        indicator = document.createElement('div');
        indicator.id = 'live-status-indicator';
        indicator.style.cssText =
            'display:none; align-items:center; gap:8px; padding:0.4rem 0.8rem; ' +
            'background:rgba(255,88,88,0.1); border:1px solid rgba(255,88,88,0.3); ' +
            'border-radius:20px; color:#ff5858; font-size:0.7rem; font-weight:800; ' +
            'letter-spacing:0.5px; transition:all 0.3s; margin-right: 8px;';
        
        // Insertar en la zona de acciones del header
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) headerActions.insertBefore(indicator, headerActions.firstChild);
        
        // Añadir estilos de animación si no existen
        if (!document.getElementById('live-pulse-style')) {
            const s = document.createElement('style');
            s.id = 'live-pulse-style';
            s.textContent = `
                @keyframes liveDotPulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.3); opacity: 0.5; }
                    100% { transform: scale(1); opacity: 1; }
                }
            `;
            document.head.appendChild(s);
        }
    }

    if (active) {
        indicator.style.display = 'inline-flex';
        indicator.innerHTML = `
            <span style="width:8px; height:8px; background:#ff5858; border-radius:50%; 
                         box-shadow:0 0 8px #ff5858; animation: liveDotPulse 1.5s ease-in-out infinite;"></span>
            EN VIVO
        `;
    } else {
        indicator.style.display = 'none';
    }

    // ELIMINAR el antiguo botón de compartir si existiera para no duplicar
    const oldBtn = document.getElementById('btn-live-share');
    if (oldBtn) oldBtn.remove();
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

    // Recoger contactos con acceso EN VIVO (staff + padres ya se envían por Firestore)
    const liveContacts = (emailConfig.contacts || []).filter(c => c.tags && c.tags.includes('live'));
    const liveCount    = liveContacts.length;

    const liveContactsHtml = liveCount > 0
        ? `<div style="background:rgba(255,88,88,0.06);border:1px solid rgba(255,88,88,0.2);
                        border-radius:8px;padding:0.7rem 0.9rem;margin-bottom:1rem;">
               <p style="font-size:0.7rem;color:#ff5858;font-weight:700;margin:0 0 0.5rem;">
                   📡 ACCESO EN VIVO AUTORIZADO (${liveCount})
               </p>
               <div style="display:flex;flex-direction:column;gap:0.3rem;">
                   ${liveContacts.map(c => `
                   <div style="display:flex;align-items:center;justify-content:space-between;
                               font-size:0.75rem;color:var(--text-muted);">
                       <span>✅ ${c.name || c.email}</span>
                       <span style="display:flex;gap:0.3rem;">
                           ${c.phone ? `<a href="https://wa.me/${c.phone}?text=${encodeURIComponent('⚽ Partido en vivo: ' + liveUrl)}" target="_blank"
                               style="padding:2px 8px;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.4);
                                      border-radius:5px;color:#25d366;text-decoration:none;font-size:0.68rem;font-weight:700;">
                               📱 WA</a>` : ''}
                           ${c.email ? `<a href="mailto:${c.email}?subject=${encodeURIComponent('⚽ Partido en Vivo — ' + TEAM_NAMES.home + ' vs ' + TEAM_NAMES.away)}&body=${encodeURIComponent('Sigue el partido en tiempo real:\n' + liveUrl)}" target="_blank"
                               style="padding:2px 8px;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                                      border-radius:5px;color:#58a6ff;text-decoration:none;font-size:0.68rem;font-weight:700;">
                               📧</a>` : ''}
                       </span>
                   </div>`).join('')}
               </div>
               <button onclick="notifyAllLiveContacts('${liveUrl}')"
                   style="margin-top:0.7rem;width:100%;padding:0.55rem;
                          background:rgba(255,88,88,0.2);border:1px solid rgba(255,88,88,0.5);
                          border-radius:7px;color:#ff5858;font-weight:700;
                          font-size:0.8rem;cursor:pointer;">
                   📡 Notificar a todos por WhatsApp
               </button>
           </div>`
        : `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
                        border-radius:8px;padding:0.6rem 0.9rem;margin-bottom:1rem;
                        font-size:0.73rem;color:var(--text-muted);text-align:center;">
               📡 Sin contactos con acceso EN VIVO configurados.<br>
               <span style="font-size:0.68rem;">Ve a <strong>Comunicaciones → Gestión de Contactos</strong>
               y activa la casilla 📡 EN VIVO en quien quieras.</span>
           </div>`;

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

            <!-- Contactos EN VIVO -->
            ${liveContactsHtml}

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

// ── Notificar a todos los contactos con acceso EN VIVO ──────────────
window.notifyAllLiveContacts = function(url) {
    const liveContacts = (emailConfig.contacts || []).filter(c => c.tags && c.tags.includes('live') && c.phone);
    if (!liveContacts.length) {
        showToast('⚠️ Ningún contacto tiene WhatsApp configurado para EN VIVO', 4000);
        return;
    }
    const date    = new Date().toLocaleDateString('es-ES');
    const msg     = encodeURIComponent(
        `⚽ *PARTIDO EN VIVO — ${TEAM_NAMES.home} vs ${TEAM_NAMES.away}*\n` +
        `📅 ${date}\n\n` +
        `Sigue el partido en tiempo real aquí:\n${url}\n\n` +
        `_Cronos Fútbol_`);
    let opened = 0;
    liveContacts.forEach((c, i) => {
        // Abrimos ventanas escalonadas para no bloquear pop-ups
        setTimeout(() => {
            window.open(`https://wa.me/${c.phone}?text=${msg}`, '_blank');
        }, i * 600);
        opened++;
    });
    showToast(`📡 WhatsApp abierto para ${opened} contacto${opened > 1 ? 's' : ''} con acceso EN VIVO`, 4000);
};

function confirmStopLive() {
    if (confirm('¿Finalizar la transmisión en vivo?\n\nEl enlace quedará guardado como historial.')) {
        stopLiveSync();
        document.getElementById('setup-modal').style.display = 'none';
    }
}

// Llamar a pushLiveSnapshot en cada acción relevante del partido.
// Throttle de 2 s: agrupa ráfagas de acciones rápidas (gol, tarjeta,
// sustitución, lesión…) en una sola escritura a Firestore. La primera
// acción programa el push y las siguientes dentro de la ventana se ignoran.
let _liveSyncThrottleTimer = null;
function liveSyncOnAction() {
    if (!liveIsActive) return;
    if (_liveSyncThrottleTimer) return;
    _liveSyncThrottleTimer = setTimeout(() => {
        _liveSyncThrottleTimer = null;
        if (liveIsActive) pushLiveSnapshot('active');
    }, 2000);
}

// ══════════════════════════════════════════════════════════════════
//  CAPA DE ALMACENAMIENTO EN LA NUBE (Firestore)
//  Sustituye localStorage de forma transparente.
//  El resto del código no cambia — solo se llaman estas funciones.
// ══════════════════════════════════════════════════════════════════


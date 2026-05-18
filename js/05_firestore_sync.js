/**
 * js/05_firestore_sync.js
 * Sincronización en tiempo real con Firestore para el "Live Match"
 */

// Variables globales para la sincronización (se comparten con app.js)
// liveMatchId, liveSyncTimer, liveIsActive ya están declaradas en app.js pero
// aquí las usamos para gestionar el estado de Firestore.

// Timestamp de inicio del partido actual (ISO string, solo se fija en el primer push)
let liveMatchStartTime = null;

// Duración máxima de un partido recuperable:
// 45 + 45 (reglamentario) + 15 + 15 (prórrogas) = 120 minutos
const LIVE_MATCH_MAX_MS = 120 * 60 * 1000;

async function startLiveSync() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) return;

    // Generar ID legible: nombre-equipo-fecha (ej: atletico-20032026-a3f)
    const slugify = (str) => (str || 'equipo')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
        .replace(/[^a-z0-9]+/g, '-')                        // solo letras y números
        .replace(/^-+|-+$/g, '')                            // sin guiones al inicio/fin
        .substring(0, 20);

    const teamSlug = slugify(TEAM_NAMES.home);
    const now      = new Date();
    const dateSlug = String(now.getDate()).padStart(2,'0') +
                     String(now.getMonth()+1).padStart(2,'0') +
                     now.getFullYear();
    const randSlug = Math.random().toString(36).substr(2,4);
    liveMatchId        = `${teamSlug}-${dateSlug}-${randSlug}`;
    liveIsActive       = true;
    liveMatchStartTime = new Date().toISOString(); // ← fijar hora de inicio (no cambia)

    // Guardar el snapshot inicial
    await pushLiveSnapshot('active');

    // Sincronizar el cronómetro cada 5 segundos
    liveSyncTimer = setInterval(() => {
        if (liveIsActive && isRunning) pushLiveSnapshot('active');
    }, 5000);

    // Llamar a la UI definida en app.js
    if (typeof updateLiveButton === 'function') updateLiveButton(true);
    console.log('🔴 Live sync iniciado (Firestore):', liveMatchId);
}

async function pushLiveSnapshot(status = 'active') {
    const fa = window._cronos_auth;
    if (!fa || !fa.db || !liveMatchId) return;

    try {
        const { setDoc, doc, serverTimestamp } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const scoreHome = document.getElementById('score-home')?.textContent || '0';
        const scoreAway = document.getElementById('score-away')?.textContent || '0';

        // Si se perdió por reinicio, usar la hora actual como createdAt
        if (!liveMatchStartTime) liveMatchStartTime = new Date().toISOString();

        const snapshot = {
            id:          liveMatchId,
            status:      status,          // 'active' | 'finished'
            updatedAt:   serverTimestamp(),
            createdAt:   liveMatchStartTime,  // ← ISO string, no varía durante el partido
            createdBy:   window._cronosCurrentUser?.uid   || '',
            coachEmail:  window._cronosCurrentUser?.email || '',
            clubId:      window._cronosCurrentUser?.clubId || null,

            mode:        currentMode,
            phase:       matchPhase,
            isRunning:   typeof isRunning !== 'undefined' ? isRunning : true,
            timeH1:      masterTimeH1,
            timeH2:      masterTimeH2,
            formation:   activeFormationKey || '',
            category:    (document.getElementById('match-category')?.value || window._currentMatchCategory || ''),

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
                y:       p.y       || 0,
                history: p.history || [],
                convocado: p.convocado || false
            }))
        };

        await setDoc(doc(fa.db, 'live_matches', liveMatchId), snapshot);
    } catch (err) {
        console.warn('Error sync live:', err.message);
    }
}

async function stopLiveSync() {
    if (!liveIsActive) return;
    liveIsActive       = false;
    liveMatchStartTime = null; // ← limpiar al finalizar
    if (liveSyncTimer) { clearInterval(liveSyncTimer); liveSyncTimer = null; }
    await pushLiveSnapshot('finished');
    if (typeof updateLiveButton === 'function') updateLiveButton(false);
    console.log('⏹ Live sync detenido (Firestore)');
}

// Las funciones de UI (updateLiveButton, showLiveShareModal, etc.)
// se mantienen en app.js para evitar conflictos de sobreescritura.

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
    // FIX (Problema 1): ID DETERMINISTA — SIN Math.random(). Reutiliza el id
    // existente o deriva el sufijo de uid+fecha+equipo (+rival+convocatoria).
    const _uidSlug = (window._cronosCurrentUser && window._cronosCurrentUser.uid) || 'u';
    liveMatchId        = (typeof window._cronosBuildLiveMatchId === 'function')
        ? window._cronosBuildLiveMatchId({ teamName: TEAM_NAMES.home, rivalName: TEAM_NAMES.away, date: now, existing: liveMatchId, uid: _uidSlug })
        : `${teamSlug}-${dateSlug}-${(window._cronosStableSlug ? window._cronosStableSlug(_uidSlug+'|'+teamSlug+'|'+dateSlug, 4) : '0000')}`;
    liveIsActive       = true;
    liveMatchStartTime = new Date().toISOString(); // ← fijar hora de inicio (no cambia)
    // E4: nuevo partido en vivo → liberar el guard de despacho de informes.
    window._cronosLastDispatchedMatch = null;

    // Guardar el snapshot inicial
    await pushLiveSnapshot('active');

    // Sincronizar el cronómetro cada 1 segundo
    liveSyncTimer = setInterval(() => {
        if (liveIsActive && isRunning) pushLiveSnapshot('active');
    }, 1000);

    // Llamar a la UI definida en app.js
    if (typeof updateLiveButton === 'function') updateLiveButton(true);
}

// v244: pushLiveSnapshot delega a la versión canónica en js/match/live/sync.js
// que incluye events, timerThresholds, y usa { merge: true }.
// La versión que estaba aquí era ANTIGUA y pisaba la de sync.js porque
// firestore-sync.js carga DESPUÉS en index.html. Esto causaba que los
// eventos del historial NO se incluyeran en el snapshot.
async function pushLiveSnapshot(status = 'active') {
    // La versión canónica está en live/sync.js (cargada antes).
    // Como ambas son function declarations globales, la última en cargar
    // pisa a la anterior. Hemos eliminado la de aquí para que NO pise.
    // Si por alguna razón live/sync.js no cargó, usar un fallback mínimo.
    const fa = window._cronos_auth;
    if (!fa || !fa.db || !liveMatchId) return;
    try {
        const { setDoc, doc, serverTimestamp } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const scoreHome = document.getElementById('score-home')?.textContent || '0';
        const scoreAway = document.getElementById('score-away')?.textContent || '0';
        const snapshot = {
            id: liveMatchId, status: status,
            updatedAt: serverTimestamp(),
            clubId: window._cronosCurrentUser?.clubId || null,
            mode: currentMode, phase: matchPhase,
            isRunning: typeof isRunning !== 'undefined' ? isRunning : true,
            timeH1: masterTimeH1, timeH2: masterTimeH2,
            homeTeam: { name: TEAM_NAMES.home, score: parseInt(scoreHome) || 0 },
            awayTeam: { name: TEAM_NAMES.away, score: parseInt(scoreAway) || 0 },
            players: players.map(p => ({ id: p.id, number: p.number, name: p.name,
                team: p.team, status: p.status, time: p.time,
                goals: p.goals||0, cards: p.cards||'ninguna', injured: p.injured||false,
                x: p.x||0, y: p.y||0 }))
        };
        await setDoc(doc(fa.db, 'live_matches', liveMatchId), snapshot, { merge: true });
    } catch (err) { /* offline — esperado */ }
}

async function stopLiveSync() {
    if (!liveIsActive) return;
    liveIsActive       = false;
    liveMatchStartTime = null; // ← limpiar al finalizar
    if (liveSyncTimer) { clearInterval(liveSyncTimer); liveSyncTimer = null; }
    
    // Si el partido REALMENTE ha terminado (fase finished), se marca como finished.
    // De lo contrario, se queda como 'active' para que siga recuperándolo!
    const finalStatus = (typeof matchPhase !== 'undefined' && matchPhase === 'finished') ? 'finished' : 'active';
    await pushLiveSnapshot(finalStatus);
    
    if (typeof updateLiveButton === 'function') updateLiveButton(false);
}

// Las funciones de UI (updateLiveButton, showLiveShareModal, etc.)
// se mantienen en app.js para evitar conflictos de sobreescritura.

// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — replay-player.js
//  Reproductor Interactivo de Partidos Terminados (Modo Repetición)
// ════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    let _replayState = {
        active: false,
        matchData: null,
        events: [],
        currentTimeSec: 0,
        maxTimeSec: 3600,
        isPlaying: false,
        speed: 1, // 1x, 4x, 10x
        timerInterval: null,
        mediaRecorder: null,
        recordedChunks: []
    };

    // ── Abrir el reproductor de un partido finalizado ─────────────────
    window.openMatchReplay = async function(matchIdOrData) {
        let data = null;

        if (typeof matchIdOrData === 'string') {
            try {
                if (typeof showSpinner === 'function') showSpinner('Cargando partido finalizado…');
                const fa = window._cronos_auth;
                if (fa && fa.db) {
                    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    // 1. Leer de live_matches
                    let snap = await getDoc(doc(fa.db, 'live_matches', matchIdOrData));
                    if (snap.exists()) {
                        data = { id: snap.id, ...snap.data() };
                    } else {
                        // 2. Fallback: leer de cronos_player_reports
                        snap = await getDoc(doc(fa.db, 'cronos_player_reports', matchIdOrData));
                        if (snap.exists()) {
                            const rData = snap.data() || {};
                            data = {
                                id: snap.id,
                                homeTeam: typeof rData.homeTeam === 'object' && rData.homeTeam ? {
                                    name: rData.homeTeam.name || rData.homeName || 'LOCAL',
                                    score: rData.homeTeam.score ?? rData.scoreHome ?? rData.goalsHome ?? 0,
                                    color: rData.homeTeam.color || rData.homeColor || '#58a6ff',
                                    shorts: rData.homeTeam.shorts || rData.homeShorts || '#1a4e99',
                                    textColor: rData.homeTeam.textColor || rData.homeText || '#000000'
                                } : {
                                    name: rData.homeName || (typeof rData.homeTeam === 'string' ? rData.homeTeam : 'LOCAL'),
                                    score: rData.scoreHome ?? rData.goalsHome ?? 0,
                                    color: rData.homeColor || '#58a6ff',
                                    shorts: rData.homeShorts || '#1a4e99',
                                    textColor: rData.homeText || '#000000'
                                },
                                awayTeam: typeof rData.awayTeam === 'object' && rData.awayTeam ? {
                                    name: rData.awayTeam.name || rData.awayName || 'VISITANTE',
                                    score: rData.awayTeam.score ?? rData.scoreAway ?? rData.goalsAway ?? 0,
                                    color: rData.awayTeam.color || rData.awayColor || '#ff5858',
                                    shorts: rData.awayTeam.shorts || rData.awayShorts || '#b22222',
                                    textColor: rData.awayTeam.textColor || rData.awayText || '#ffffff'
                                } : {
                                    name: rData.awayName || (typeof rData.awayTeam === 'string' ? rData.awayTeam : 'VISITANTE'),
                                    score: rData.scoreAway ?? rData.goalsAway ?? 0,
                                    color: rData.awayColor || '#ff5858',
                                    shorts: rData.awayShorts || '#b22222',
                                    textColor: rData.awayText || '#ffffff'
                                },
                                category: rData.category || '',
                                subcategory: rData.subcategory || '',
                                mode: rData.mode || 'f7',
                                events: rData.events || rData.timeline || [],
                                players: rData.players || [],
                                ...rData
                            };
                        }
                    }
                }
            } catch(e) {
                console.warn('[Replay] Error leyendo de Firestore:', e);
            } finally {
                if (typeof hideSpinner === 'function') hideSpinner();
            }
        } else if (matchIdOrData && typeof matchIdOrData === 'object') {
            data = matchIdOrData;
        }

        if (!data) {
            if (typeof showToast === 'function') showToast('⚠️ No se pudieron cargar los datos del partido.', 3000);
            return;
        }

        _replayState.matchData = data;
        _replayState.events = _extractEventsFromMatch(data);
        _replayState.maxTimeSec = _calculateMaxTime(data);
        _replayState.currentTimeSec = 0;
        _replayState.isPlaying = false;
        _replayState.speed = 1;

        _renderReplayModal();
        _updateReplayFrame(0);
    };

    // ── Extraer y ordenar eventos del partido ────────────────────────
    function _extractEventsFromMatch(data) {
        const rawEvents = Array.isArray(data.events) ? data.events : [];
        const parsed = [];

        rawEvents.forEach(ev => {
            let timeSec = 0;
            if (typeof ev.matchTime === 'string') {
                const matchM = ev.matchTime.match(/(1T|2T)\s+(\d+):(\d+)/);
                if (matchM) {
                    const half = matchM[1];
                    const m = parseInt(matchM[2]) || 0;
                    const s = parseInt(matchM[3]) || 0;
                    timeSec = (half === '2T' ? 1800 : 0) + m * 60 + s;
                }
            } else if (ev.createdAt) {
                timeSec = Math.floor((ev.createdAt - (data.createdAt || ev.createdAt)) / 1000);
            }

            let detailData = null;
            if (ev.type === 'tactical_move' && typeof ev.text === 'string') {
                try { detailData = JSON.parse(ev.text); } catch(_) {}
            }

            parsed.push({
                ...ev,
                timeSec: Math.max(0, timeSec),
                detailData
            });
        });

        parsed.sort((a, b) => (a.timeSec - b.timeSec));
        return parsed;
    }

    function _calculateMaxTime(data) {
        const mode = data.mode === 'f7' ? 'f7' : 'f11';
        const h1 = data.half1MaxTime || (mode === 'f7' ? 1800 : 2400);
        const h2 = data.half2MaxTime || (mode === 'f7' ? 1800 : 2400);
        return h1 + h2;
    }

    // ── Construir la UI Modal del Reproductor ────────────────────────
    function _renderReplayModal() {
        let modal = document.getElementById('cronos-replay-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cronos-replay-modal';
            modal.style.cssText = `
                position: fixed; inset: 0; z-index: 100000;
                background: #0a0e14; display: flex; flex-direction: column;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: white; overflow: hidden;
            `;
            document.body.appendChild(modal);
        }

        const data = _replayState.matchData || {};
        const homeName = data.homeTeam?.name || 'LOCAL';
        const awayName = data.awayTeam?.name || 'VISITANTE';
        const homeColor = data.homeTeam?.color || '#58a6ff';
        const awayColor = data.awayTeam?.color || '#ff5858';
        const rival = data.rival || awayName;
        const category = (data.category || 'Fútbol').toUpperCase();

        modal.innerHTML = `
            <!-- Cabecera del visor -->
            <div style="background:rgba(255,255,255,0.03); border-bottom:1px solid rgba(255,255,255,0.1); padding:0.6rem 1.2rem; display:flex; align-items:center; justify-content:space-between;">
                <div style="display:flex; align-items:center; gap:0.8rem;">
                    <span style="background:rgba(88,166,255,0.2); border:1px solid rgba(88,166,255,0.4); color:#58a6ff; font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:6px;">
                        ▶️ REPETICIÓN DEL PARTIDO
                    </span>
                    <span style="font-size:0.85rem; font-weight:700; color:white;">
                        vs ${escapeHtml(rival)} (${escapeHtml(category)})
                    </span>
                </div>
                <div style="display:flex; align-items:center; gap:0.6rem;">
                    <button onclick="window._replayRecordVideo()" id="btn-replay-record"
                        style="background:rgba(231,76,60,0.15); border:1px solid rgba(231,76,60,0.4); color:#ff5858; font-size:0.75rem; font-weight:800; padding:0.35rem 0.8rem; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:4px;">
                        📹 Descargar Vídeo (.webm)
                    </button>
                    <button onclick="window.closeMatchReplay()"
                        style="background:rgba(255,255,255,0.1); border:none; color:white; font-size:1.1rem; width:30px; height:30px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center;">
                        ✕
                    </button>
                </div>
            </div>

            <!-- Marcador y Cronómetro -->
            <div style="background:rgba(0,0,0,0.3); padding:0.8rem 1.2rem; display:flex; align-items:center; justify-content:center; gap:1.5rem; border-bottom:1px solid rgba(255,255,255,0.06);">
                <div style="text-align:right; font-weight:800; font-size:1.1rem; color:${homeColor};">
                    ${escapeHtml(homeName)}
                </div>
                <div style="background:rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.15); border-radius:10px; padding:0.4rem 1.2rem; display:flex; align-items:center; gap:1rem;">
                    <span id="replay-score-home" style="font-size:1.8rem; font-weight:900; color:white;">0</span>
                    <span style="font-size:1.2rem; color:#7d8590;">-</span>
                    <span id="replay-score-away" style="font-size:1.8rem; font-weight:900; color:white;">0</span>
                </div>
                <div style="text-align:left; font-weight:800; font-size:1.1rem; color:${awayColor};">
                    ${escapeHtml(awayName)}
                </div>
                <div style="margin-left:2rem; background:rgba(255,255,255,0.05); padding:0.3rem 0.8rem; border-radius:8px; text-align:center;">
                    <div id="replay-timer-display" style="font-family:monospace; font-size:1.3rem; font-weight:800; color:#58a6ff;">00:00</div>
                    <div id="replay-phase-display" style="font-size:0.65rem; color:#7d8590; font-weight:700;">1ª PARTE</div>
                </div>
            </div>

            <!-- Área de Campo y Banquillos -->
            <div id="replay-main-area" style="flex:1; display:flex; padding:0.8rem; gap:0.8rem; overflow:hidden; position:relative;">
                <!-- Banquillo Local -->
                <div style="width:160px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:0.6rem; display:flex; flex-direction:column; overflow-y:auto;">
                    <div style="font-size:0.7rem; font-weight:800; color:${homeColor}; margin-bottom:0.5rem; text-transform:uppercase;">Banquillo Local</div>
                    <div id="replay-bench-home" style="display:flex; flex-direction:column; gap:4px;"></div>
                </div>

                <!-- Campo de Fútbol -->
                <div id="replay-pitch-container" style="flex:1; position:relative; background:#1e3a29; border:2px solid rgba(255,255,255,0.2); border-radius:14px; overflow:hidden;">
                    <!-- Líneas del campo -->
                    <div style="position:absolute; inset:0; pointer-events:none;">
                        <div style="position:absolute; top:0; bottom:0; left:50%; border-left:2px solid rgba(255,255,255,0.25);"></div>
                        <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:90px; height:90px; border:2px solid rgba(255,255,255,0.25); border-radius:50%;"></div>
                        <div style="position:absolute; top:20%; bottom:20%; left:0; width:15%; border:2px solid rgba(255,255,255,0.25); border-left:none;"></div>
                        <div style="position:absolute; top:20%; bottom:20%; right:0; width:15%; border:2px solid rgba(255,255,255,0.25); border-right:none;"></div>
                    </div>
                    <!-- Capa para fichas de jugadores -->
                    <div id="replay-pitch-players" style="position:absolute; inset:0;"></div>
                </div>

                <!-- Banquillo Visitante -->
                <div style="width:160px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:0.6rem; display:flex; flex-direction:column; overflow-y:auto;">
                    <div style="font-size:0.7rem; font-weight:800; color:${awayColor}; margin-bottom:0.5rem; text-transform:uppercase;">Banquillo Visitante</div>
                    <div id="replay-bench-away" style="display:flex; flex-direction:column; gap:4px;"></div>
                </div>
            </div>

            <!-- Toolbar de Controles (Bottom) -->
            <div style="background:rgba(255,255,255,0.04); border-top:1px solid rgba(255,255,255,0.1); padding:0.8rem 1.2rem; display:flex; flex-direction:column; gap:0.6rem;">
                <!-- Barra de tiempo (Seekbar) -->
                <div style="display:flex; align-items:center; gap:1rem;">
                    <span id="replay-seek-curr" style="font-size:0.75rem; font-weight:700; color:#58a6ff; width:42px;">00:00</span>
                    <input type="range" id="replay-seekbar" min="0" max="${_replayState.maxTimeSec}" value="0" step="1"
                           oninput="window._replaySeek(parseInt(this.value))"
                           style="flex:1; accent-color:#58a6ff; cursor:pointer;">
                    <span id="replay-seek-max" style="font-size:0.75rem; font-weight:700; color:#7d8590; width:42px; text-align:right;">${_fmtSecs(_replayState.maxTimeSec)}</span>
                </div>

                <!-- Botones Play/Pausa y Velocidad -->
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <div style="display:flex; align-items:center; gap:0.8rem;">
                        <button onclick="window._replayTogglePlay()" id="btn-replay-play"
                            style="background:linear-gradient(135deg,#58a6ff,#1f6beb); border:none; color:white; padding:0.5rem 1.4rem; border-radius:8px; font-weight:800; font-size:0.9rem; cursor:pointer; box-shadow:0 4px 12px rgba(88,166,255,0.3);">
                            ▶️ Play
                        </button>
                        <button onclick="window._replaySeek(0)"
                            style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:white; padding:0.5rem 0.9rem; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">
                            ⏮️ Reiniciar
                        </button>
                    </div>

                    <!-- Selector de Velocidad -->
                    <div style="display:flex; align-items:center; gap:0.4rem; background:rgba(0,0,0,0.3); padding:4px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                        <span style="font-size:0.7rem; color:#7d8590; font-weight:700; margin-right:4px; margin-left:6px;">VELOCIDAD:</span>
                        <button onclick="window._replaySetSpeed(1)" id="btn-spd-1" style="background:rgba(88,166,255,0.3); border:1px solid #58a6ff; color:white; font-size:0.75rem; font-weight:800; padding:3px 8px; border-radius:6px; cursor:pointer;">1x</button>
                        <button onclick="window._replaySetSpeed(4)" id="btn-spd-4" style="background:transparent; border:1px solid transparent; color:#7d8590; font-size:0.75rem; font-weight:800; padding:3px 8px; border-radius:6px; cursor:pointer;">4x</button>
                        <button onclick="window._replaySetSpeed(10)" id="btn-spd-10" style="background:transparent; border:1px solid transparent; color:#7d8590; font-size:0.75rem; font-weight:800; padding:3px 8px; border-radius:6px; cursor:pointer;">10x</button>
                    </div>
                </div>
            </div>
        `;
    }

    // ── Actualizar el Estado Visual para un Minuto Concreto ──────────
    function _updateReplayFrame(timeSec) {
        _replayState.currentTimeSec = timeSec;

        const data = _replayState.matchData || {};
        const events = _replayState.events || [];
        const mode = data.mode === 'f7' ? 'f7' : 'f11';
        const h1Max = data.half1MaxTime || (mode === 'f7' ? 1800 : 2400);

        // 1. Actualizar Seekbar y Tiempos
        const seek = document.getElementById('replay-seekbar');
        const currTxt = document.getElementById('replay-seek-curr');
        const timerTxt = document.getElementById('replay-timer-display');
        const phaseTxt = document.getElementById('replay-phase-display');

        if (seek) seek.value = timeSec;
        if (currTxt) currTxt.textContent = _fmtSecs(timeSec);
        if (timerTxt) timerTxt.textContent = _fmtSecs(timeSec);
        if (phaseTxt) {
            phaseTxt.textContent = timeSec >= h1Max ? '2ª PARTE' : '1ª PARTE';
        }

        // 2. Reconstruir estado de jugadores a partir del snapshot inicial + eventos hasta timeSec
        const playersMap = {};
        const initialPlayers = Array.isArray(data.players) ? data.players : [];
        initialPlayers.forEach(p => {
            playersMap[String(p.id)] = {
                ...p,
                status: p.status || 'field',
                x: p.x || 50,
                y: p.y || 50,
                goals: 0,
                cards: 'ninguna',
                yellowCards: 0,
                injured: false
            };
        });

        let homeScore = 0;
        let awayScore = 0;

        // Aplicar eventos cronológicamente hasta timeSec
        events.forEach(ev => {
            if (ev.timeSec > timeSec) return;

            // Movimiento táctico
            if (ev.type === 'tactical_move' && ev.detailData) {
                const pid = String(ev.detailData.playerId);
                if (playersMap[pid]) {
                    playersMap[pid].x = ev.detailData.x;
                    playersMap[pid].y = ev.detailData.y;
                    if (ev.detailData.status) playersMap[pid].status = ev.detailData.status;
                }
            }

            // Goles
            if (ev.type === 'goal') {
                const matchName = ev.text || '';
                let foundP = null;
                Object.values(playersMap).forEach(p => {
                    if (matchName.includes(p.name)) foundP = p;
                });
                if (foundP) {
                    foundP.goals = (foundP.goals || 0) + 1;
                    if (foundP.team === 'home') homeScore++;
                    else awayScore++;
                } else {
                    if (ev.team === 'away') awayScore++; else homeScore++;
                }
            }

            // Tarjetas
            if (ev.type === 'yellow') {
                Object.values(playersMap).forEach(p => {
                    if (ev.text && ev.text.includes(p.name)) {
                        p.yellowCards = (p.yellowCards || 0) + 1;
                        if (p.yellowCards >= 2) p.cards = 'roja';
                        else p.cards = 'amarilla';
                    }
                });
            }
            if (ev.type === 'red') {
                Object.values(playersMap).forEach(p => {
                    if (ev.text && ev.text.includes(p.name)) p.cards = 'roja';
                });
            }

            // Sustituciones
            if (ev.type === 'sub_in') {
                Object.values(playersMap).forEach(p => {
                    if (ev.text && ev.text.includes(p.name)) p.status = 'field';
                });
            }
            if (ev.type === 'sub_out') {
                Object.values(playersMap).forEach(p => {
                    if (ev.text && ev.text.includes(p.name)) p.status = 'bench';
                });
            }

            // Lesiones
            if (ev.type === 'injury') {
                Object.values(playersMap).forEach(p => {
                    if (ev.text && ev.text.includes(p.name)) p.injured = true;
                });
            }
        });

        // 3. Renderizar Marcador
        const scoreHomeEl = document.getElementById('replay-score-home');
        const scoreAwayEl = document.getElementById('replay-score-away');
        if (scoreHomeEl) scoreHomeEl.textContent = homeScore;
        if (scoreAwayEl) scoreAwayEl.textContent = awayScore;

        // 4. Renderizar Campo y Banquillos
        _renderPitchAndBenches(Object.values(playersMap), data);
    }

    // Helper para determinar si un color de fondo necesita texto blanco o negro
    function safeColor(value, fallback) {
        if (typeof value === 'string' &&
            /^(#[0-9a-fA-F]{3,8}|rgb\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)|rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)|[a-zA-Z]{1,20})$/.test(value.trim())) {
            return value.trim();
        }
        return fallback;
    }

    function _getContrastTextColor(hexColor) {
        if (!hexColor || typeof hexColor !== 'string') return '#ffffff';
        let hex = hexColor.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        if (hex.length !== 6) return '#ffffff';
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        return yiq >= 128 ? '#000000' : '#ffffff';
    }

    function _renderPitchAndBenches(playersList, data) {
        const pitchEl = document.getElementById('replay-pitch-players');
        const benchHomeEl = document.getElementById('replay-bench-home');
        const benchAwayEl = document.getElementById('replay-bench-away');
        if (!pitchEl) return;

        const homeColor  = safeColor(data.homeTeam?.color  || data.homeColor  || data.shirtColorHome, '#58a6ff');
        const awayColor  = safeColor(data.awayTeam?.color  || data.awayColor  || data.shirtColorAway, '#ff5858');
        const homeShorts = safeColor(data.homeTeam?.shorts || data.homeShorts || data.shortsColorHome, '#1a4e99');
        const awayShorts = safeColor(data.awayTeam?.shorts || data.awayShorts || data.shortsColorAway, '#b22222');
        const homeText   = safeColor(data.homeTeam?.textColor || data.homeText || data.textColorHome, _getContrastTextColor(homeColor));
        const awayText   = safeColor(data.awayTeam?.textColor || data.awayText || data.textColorAway, _getContrastTextColor(awayColor));

        let pitchHtml = '';
        let benchHomeHtml = '';
        let benchAwayHtml = '';

        playersList.forEach(p => {
            const isHome = p.team === 'home';
            const color       = safeColor(p.color       || p.shirtColor  || (isHome ? homeColor  : awayColor),  isHome ? '#58a6ff' : '#ff5858');
            const shortsColor = safeColor(p.shortsColor || p.pantsColor  || (isHome ? homeShorts : awayShorts), isHome ? '#1a4e99' : '#b22222');
            const textColor   = safeColor(p.textColor   || p.dorsalColor || (isHome ? homeText   : awayText),   _getContrastTextColor(color));

            const cardIcon = p.cards === 'amarilla' ? '🟨' : p.cards === 'roja' ? '🟥' : '';
            const goalIcon = p.goals > 0 ? `⚽×${p.goals}` : '';

            // Eliminar el símbolo '#' del nombre si viniera prefijado
            const rawName = String(p.name || '').replace(/^#\s*/, '');
            const cleanName = escapeHtml(rawName);
            const rawNum = String(p.number !== undefined && p.number !== null ? p.number : '').replace(/^#\s*/, '');
            const cleanNum = escapeHtml(rawNum);
            const numLabel = cleanNum ? `${cleanNum} ` : '';

            if (p.status === 'field') {
                const x = Math.max(5, Math.min(95, p.x || 50));
                const y = Math.max(5, Math.min(95, p.y || 50));
                pitchHtml += `
                    <div style="position:absolute; left:${x}%; top:${y}%; transform:translate(-50%,-50%); transition:left 0.4s ease-out, top 0.4s ease-out; display:flex; flex-direction:column; align-items:center; z-index:10;">
                        <div style="background:linear-gradient(to bottom, ${color} 50%, ${shortsColor} 50%); color:${textColor}; font-weight:900; font-size:0.75rem; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid white; box-shadow:0 3px 8px rgba(0,0,0,0.5); position:relative;">
                            ${cleanNum}
                            ${cardIcon ? `<span style="position:absolute; top:-4px; right:-6px; font-size:0.6rem;">${cardIcon}</span>` : ''}
                        </div>
                        <div style="font-size:0.62rem; font-weight:700; color:white; text-shadow:0 1px 3px black; white-space:nowrap; margin-top:2px;">
                            ${cleanName} ${goalIcon}
                        </div>
                    </div>`;
            } else {
                const itemHtml = `
                    <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); padding:4px 8px; border-radius:6px; font-size:0.7rem; display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <span style="display:flex; align-items:center; gap:5px;">
                            <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:linear-gradient(to bottom, ${color} 50%, ${shortsColor} 50%); border:1px solid rgba(255,255,255,0.4); flex-shrink:0;"></span>
                            <span style="font-weight:700; color:white;">${numLabel}${cleanName}</span>
                        </span>
                        <span>${cardIcon} ${goalIcon}</span>
                    </div>`;
                if (isHome) benchHomeHtml += itemHtml;
                else benchAwayHtml += itemHtml;
            }
        });

        pitchEl.innerHTML = pitchHtml;
        if (benchHomeEl) benchHomeEl.innerHTML = benchHomeHtml || '<span style="font-size:0.65rem; color:#7d8590;">Vacío</span>';
        if (benchAwayEl) benchAwayEl.innerHTML = benchAwayHtml || '<span style="font-size:0.65rem; color:#7d8590;">Vacío</span>';
    }

    // ── Controles de Reproducción ────────────────────────────────────
    window._replayTogglePlay = function() {
        if (_replayState.isPlaying) {
            _pauseReplay();
        } else {
            _playReplay();
        }
    };

    function _playReplay() {
        if (_replayState.currentTimeSec >= _replayState.maxTimeSec) {
            _replayState.currentTimeSec = 0;
        }
        _replayState.isPlaying = true;
        const btn = document.getElementById('btn-replay-play');
        if (btn) btn.innerHTML = '⏸️ Pausa';

        if (_replayState.timerInterval) clearInterval(_replayState.timerInterval);
        _replayState.timerInterval = setInterval(() => {
            let next = _replayState.currentTimeSec + _replayState.speed;
            if (next >= _replayState.maxTimeSec) {
                next = _replayState.maxTimeSec;
                _pauseReplay();
            }
            _updateReplayFrame(next);
        }, 1000);
    }

    function _pauseReplay() {
        _replayState.isPlaying = false;
        if (_replayState.timerInterval) {
            clearInterval(_replayState.timerInterval);
            _replayState.timerInterval = null;
        }
        const btn = document.getElementById('btn-replay-play');
        if (btn) btn.innerHTML = '▶️ Play';
    }

    window._replaySeek = function(sec) {
        _updateReplayFrame(sec);
    };

    window._replaySetSpeed = function(spd) {
        _replayState.speed = spd;
        ['1', '4', '10'].forEach(s => {
            const btn = document.getElementById(`btn-spd-${s}`);
            if (btn) {
                if (parseInt(s) === spd) {
                    btn.style.background = 'rgba(88,166,255,0.3)';
                    btn.style.borderColor = '#58a6ff';
                    btn.style.color = 'white';
                } else {
                    btn.style.background = 'transparent';
                    btn.style.borderColor = 'transparent';
                    btn.style.color = '#7d8590';
                }
            }
        });
        if (_replayState.isPlaying) {
            _pauseReplay();
            _playReplay();
        }
    };

    window.closeMatchReplay = function() {
        _pauseReplay();
        const modal = document.getElementById('cronos-replay-modal');
        if (modal) modal.remove();
    };

    // ── Exportar Vídeo (.webm) Nativo con Canvas & MediaRecorder ─────
    let _recordCanvasTimer = null;

    window._replayRecordVideo = async function() {
        const pitchContainer = document.getElementById('replay-pitch-container');
        if (!pitchContainer) return;

        try {
            const recordBtn = document.getElementById('btn-replay-record');

            // Si ya está grabando, detener y descargar
            if (_replayState.mediaRecorder && _replayState.mediaRecorder.state === 'recording') {
                _replayState.mediaRecorder.stop();
                _pauseReplay();
                if (_recordCanvasTimer) clearInterval(_recordCanvasTimer);
                if (recordBtn) {
                    recordBtn.innerHTML = '📹 Descargar Vídeo (.webm)';
                    recordBtn.style.background = 'rgba(231,76,60,0.15)';
                    recordBtn.style.borderColor = 'rgba(231,76,60,0.4)';
                    recordBtn.style.color = '#ff5858';
                }
                return;
            }

            if (typeof showToast === 'function') showToast('📹 Iniciando grabación del partido…', 3000);

            // Crear Canvas dinámico para renderizar la repetición a 30 FPS
            const canvas = document.createElement('canvas');
            canvas.width = 900;
            canvas.height = 550;
            const ctx = canvas.getContext('2d');

            function drawPitchFrame() {
                const data = _replayState.matchData || {};
                const homeName = data.homeTeam?.name || 'LOCAL';
                const awayName = data.awayTeam?.name || 'VISITANTE';
                const homeColor = data.homeTeam?.color || '#58a6ff';
                const awayColor = data.awayTeam?.color || '#ff5858';

                const scoreHomeEl = document.getElementById('replay-score-home');
                const scoreAwayEl = document.getElementById('replay-score-away');
                const timerEl = document.getElementById('replay-timer-display');
                const phaseEl = document.getElementById('replay-phase-display');

                const scoreHome = scoreHomeEl ? scoreHomeEl.textContent : '0';
                const scoreAway = scoreAwayEl ? scoreAwayEl.textContent : '0';
                const timerTxt = timerEl ? timerEl.textContent : '00:00';
                const phaseTxt = phaseEl ? phaseEl.textContent : '1ª PARTE';

                // 1. Fondo del césped
                ctx.fillStyle = '#1e3a29';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // 2. Cabecera (Marcador y Cronómetro)
                ctx.fillStyle = 'rgba(10, 14, 20, 0.95)';
                ctx.fillRect(0, 0, canvas.width, 60);

                // Nombres y Marcador
                ctx.font = 'bold 16px sans-serif';
                ctx.fillStyle = homeColor;
                ctx.textAlign = 'right';
                ctx.fillText(homeName, canvas.width / 2 - 80, 36);

                ctx.fillStyle = awayColor;
                ctx.textAlign = 'left';
                ctx.fillText(awayName, canvas.width / 2 + 80, 36);

                // Caja del Marcador
                ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.fillRect(canvas.width / 2 - 60, 10, 120, 40);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 22px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`${scoreHome} - ${scoreAway}`, canvas.width / 2, 38);

                // Reloj
                ctx.font = 'bold 15px monospace';
                ctx.fillStyle = '#58a6ff';
                ctx.textAlign = 'right';
                ctx.fillText(`${timerTxt} (${phaseTxt})`, canvas.width - 20, 36);

                // 3. Líneas del Campo
                const pX = 20, pY = 75, pW = canvas.width - 40, pH = canvas.height - 90;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 2;
                ctx.strokeRect(pX, pY, pW, pH);

                // Línea de medio campo
                ctx.beginPath();
                ctx.moveTo(pX + pW / 2, pY);
                ctx.lineTo(pX + pW / 2, pY + pH);
                ctx.stroke();

                // Círculo central
                ctx.beginPath();
                ctx.arc(pX + pW / 2, pY + pH / 2, 50, 0, Math.PI * 2);
                ctx.stroke();

                // Áreas de penalti
                ctx.strokeRect(pX, pY + pH * 0.2, pW * 0.15, pH * 0.6);
                ctx.strokeRect(pX + pW * 0.85, pY + pH * 0.2, pW * 0.15, pH * 0.6);

                // 4. Renderizar Jugadores en el Campo
                const pitchPlayersEl = document.getElementById('replay-pitch-players');
                if (pitchPlayersEl) {
                    const chips = pitchPlayersEl.querySelectorAll('div[style*="position:absolute"]');
                    chips.forEach(chip => {
                        const style = chip.getAttribute('style') || '';
                        const leftM = style.match(/left:\s*([\d\.]+)%/);
                        const topM = style.match(/top:\s*([\d\.]+)%/);
                        if (leftM && topM) {
                            const pctX = parseFloat(leftM[1]) / 100;
                            const pctY = parseFloat(topM[1]) / 100;

                            const cX = pX + pctX * pW;
                            const cY = pY + pctY * pH;

                            // Leer dorsal y color
                            const numEl = chip.querySelector('div');
                            const nameEl = chip.children[1];
                            const numTxt = numEl ? numEl.textContent.trim() : '';
                            const nameTxt = nameEl ? nameEl.textContent.trim() : '';
                            const color = numEl ? numEl.style.background : homeColor;

                            // Dibujar Ficha
                            ctx.beginPath();
                            ctx.arc(cX, cY, 14, 0, Math.PI * 2);
                            ctx.fillStyle = color;
                            ctx.fill();
                            ctx.strokeStyle = '#ffffff';
                            ctx.lineWidth = 2;
                            ctx.stroke();

                            // Dorsal
                            ctx.fillStyle = '#000000';
                            ctx.font = 'bold 11px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.fillText(numTxt, cX, cY + 4);

                            // Nombre
                            if (nameTxt) {
                                ctx.fillStyle = '#ffffff';
                                ctx.font = 'bold 10px sans-serif';
                                ctx.fillText(nameTxt, cX, cY + 26);
                            }
                        }
                    });
                }
            }

            // Iniciar renderizado constante a 30 FPS
            drawPitchFrame();
            _recordCanvasTimer = setInterval(drawPitchFrame, 1000 / 30);

            // Transmisión de vídeo desde el canvas
            const stream = canvas.captureStream(30);

            let mimeType = 'video/webm';
            if (typeof MediaRecorder !== 'undefined') {
                if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
                else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
            }

            const recorder = new MediaRecorder(stream, { mimeType });
            _replayState.mediaRecorder = recorder;
            const chunks = [];

            recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = () => {
                if (_recordCanvasTimer) clearInterval(_recordCanvasTimer);
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                a.download = `partido_repeticion_${Date.now()}.${ext}`;
                a.click();
                URL.revokeObjectURL(url);
                if (typeof showToast === 'function') showToast('✅ Vídeo descargado con éxito', 4000);
            };

            recorder.start();
            _playReplay();

            if (recordBtn) {
                recordBtn.innerHTML = '⏹️ Detener y Descargar Vídeo';
                recordBtn.style.background = '#e74c3c';
                recordBtn.style.borderColor = '#c0392b';
                recordBtn.style.color = '#ffffff';
            }

            if (typeof showToast === 'function') showToast('⏺️ Grabando vídeo… Pulsa "Detener" cuando desees guardar.', 4000);

        } catch(e) {
            console.error('[Replay] Error al grabar vídeo:', e);
            if (typeof showToast === 'function') showToast('⚠️ No se pudo iniciar la grabación: ' + e.message, 4000);
        }
    };

    function _fmtSecs(s) {
        const m = Math.floor(s / 60).toString().padStart(2, '0');
        const sec = (s % 60).toString().padStart(2, '0');
        return `${m}:${sec}`;
    }

})();

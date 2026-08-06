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

        // v459 · cómo estaba la capa de modales ANTES de abrir el reproductor.
        // Se restaura tal cual al cerrar (ver _restauraCapaOrigen).
        _recuerdaCapaOrigen();

        _replayState.matchData = data;
        _replayState.events = _extractEventsFromMatch(data);
        // v446: los eventos van como segundo argumento para que la barra no
        // pueda terminar antes que el último suceso.
        _replayState.maxTimeSec = _calculateMaxTime(data, _replayState.events);
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
                    // FIX (fidelidad de "Revivir", 2026-07-29): el minuto ya viene
                    // ACUMULADO desde el principio del partido, tambien en la 2a
                    // parte. Lo escriben asi los DOS productores:
                    //   · js/match/events/player-actions.js:24 — en 2a parte usa
                    //     `masterTimeH1 + masterTimeH2`, o sea el total del partido;
                    //   · js/match/events/retroactive-modal.js:151 — el modal pide
                    //     "Minuto Exacto (1'-90')", tambien absoluto.
                    // El prefijo 1T/2T es solo una ETIQUETA, no un origen de
                    // coordenadas. Aqui se le sumaban ademas 1800 s fijos, con dos
                    // consecuencias: (1) TODO evento de la 2a parte se iba +30:00, y
                    // como la barra llega solo hasta half1MaxTime+half2MaxTime, casi
                    // toda la 2a parte caia FUERA y no se reproducia jamas (en
                    // prebenjamin, 1 de cada 61 instantes era visible); (2) el 1800
                    // estaba fijo, y las partes duran 30/35/40/45 min segun categoria
                    // (js/core/setup-modal.js:509-521), asi que ni siquiera era el
                    // desplazamiento correcto para la mayoria de los partidos.
                    const m = parseInt(matchM[2]) || 0;
                    const s = parseInt(matchM[3]) || 0;
                    timeSec = m * 60 + s;
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

    // ════════════════════════════════════════════════════════════════
    //  v446 · LA DURACIÓN REAL DEL PARTIDO, DESCUENTO INCLUIDO
    //
    //  Reporte del autor: la repetición y las descargas sólo contaban el tiempo
    //  REGLAMENTARIO. Un partido que se alargó con descuento se reproducía
    //  cortado, y la barra terminaba antes que el partido.
    //
    //  🔑 EL DESCUENTO NO ES UN CAMPO: ESTÁ EN EL CRONÓMETRO. La app deja correr
    //  el reloj más allá del reglamentario (así se pinta el "+MM:SS" del visor),
    //  y ese exceso queda en `timeH1`/`timeH2`, que son los segundos ACUMULADOS
    //  de cada parte. `half1MaxTime`/`half2MaxTime` son sólo el reglamento
    //  configurado, o sea el mínimo previsto, no lo jugado.
    //
    //  Se usa lo JUGADO cuando el documento lo trae —es la realidad del partido,
    //  y también acorta la barra de un partido suspendido antes de tiempo— y se
    //  cae al reglamento cuando no está (documentos antiguos). En los dos casos
    //  se estira hasta el último suceso: ningún evento puede quedar fuera de la
    //  barra, que es como se perdía media segunda parte antes de v394.
    // ════════════════════════════════════════════════════════════════
    function _reglamentarioSec(data) {
        const mode = data.mode === 'f7' ? 'f7' : 'f11';
        const h1 = data.half1MaxTime || (mode === 'f7' ? 1800 : 2400);
        const h2 = data.half2MaxTime || (mode === 'f7' ? 1800 : 2400);
        return h1 + h2;
    }

    function _jugadoSec(data) {
        const t1 = Number(data && data.timeH1) || 0;
        const t2 = Number(data && data.timeH2) || 0;
        return t1 + t2;
    }

    // Instante en que acabó de verdad la 1ª parte: su cronómetro acumulado, que
    // ya incluye el descuento. Sin él, el rótulo saltaba a "2ª PARTE" en cuanto
    // se pasaba del reglamento, con la 1ª todavía en juego.
    function _finPrimeraParteSec(data) {
        const real = Number(data && data.timeH1) || 0;
        if (real > 0) return real;
        const mode = data.mode === 'f7' ? 'f7' : 'f11';
        return data.half1MaxTime || (mode === 'f7' ? 1800 : 2400);
    }

    function _calculateMaxTime(data, events) {
        const jugado = _jugadoSec(data);
        let total = jugado > 0 ? jugado : _reglamentarioSec(data);
        (events || []).forEach(e => {
            const t = e && Number(e.timeSec);
            if (!isNaN(t) && t > total) total = t;
        });
        return Math.max(1, Math.round(total));
    }

    // ── Hoja de estilos del reproductor ──────────────────────────────
    // v427. ¿Por qué se inyecta desde JS y no vive en style.css?
    // Porque `replay-player.js` lo cargan DOS páginas —index.html (panel del
    // entrenador/director) y live.html (visor en directo)— y **live.html no
    // enlaza style.css**: tiene su propia hoja embebida. Si las clases del
    // reproductor vivieran en style.css, la repetición se vería con estilos
    // desde el panel y SIN NINGUNO desde el visor (fichas apiladas sin tamaño
    // ni color), que es justo lo contrario del requisito de que la experiencia
    // sea idéntica. Inyectándola aquí, la hoja viaja con el módulo.
    //
    // Los tamaños replican los de la retransmisión (live.html): 48px de ficha
    // en escritorio —el punto medio que allí usa la banda de tablet— con las
    // etiquetas de tiempo y nombre proporcionales, y las mismas dos bandas
    // responsive. Antes las fichas eran círculos de 26px con el nombre a
    // 0.62rem: ilegibles.
    function _injectReplayStyles() {
        // La hoja es un ADORNO: si no se puede inyectar, la repetición debe
        // seguir funcionando. Sin esta guarda, un `document` sin head tumbaba
        // openMatchReplay entero con un TypeError antes de pintar nada.
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('cronos-replay-styles')) return;
        const st = document.createElement('style');
        st.id = 'cronos-replay-styles';
        st.textContent = `
        .replay-player {
            position: absolute;
            transform: translate(-50%, -50%);
            display: flex; flex-direction: column;
            align-items: center; gap: 2px;
            z-index: 10;
            transition: left 0.4s ease-out, top 0.4s ease-out;
        }
        .replay-player-time {
            font-size: 0.72rem; font-weight: 800;
            font-family: 'Courier New', monospace;
            min-width: 46px; text-align: center;
            border-radius: 4px; padding: 2px 6px;
            line-height: 1.25; white-space: nowrap;
            box-shadow: 0 1px 4px rgba(0,0,0,0.6);
        }
        .replay-player-chip {
            width: 48px; height: 48px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 1.05rem; font-weight: 900;
            border: 3px solid rgba(255,255,255,0.85);
            box-shadow: 0 2px 8px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.4);
            position: relative;
        }
        .replay-player-label {
            font-size: 0.72rem; font-weight: 700;
            background: rgba(0,0,0,0.85);
            color: #f5f0e8;
            border-radius: 3px; padding: 2px 6px;
            white-space: nowrap; max-width: 92px;
            overflow: hidden; text-overflow: ellipsis;
            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            line-height: 1.25;
        }
        .replay-goal-badge {
            position: absolute; top: 20%; right: -24px;
            transform: translateY(-50%);
            font-size: 0.68rem; font-weight: 700;
            background: rgba(0,0,0,0.9); color: #fff;
            border: 1px solid rgba(255,255,255,0.3);
            border-radius: 4px; padding: 1px 4px;
            white-space: nowrap; z-index: 36;
        }
        .replay-card-badge {
            position: absolute; bottom: -8px; right: -8px;
            font-size: 1rem; z-index: 35; line-height: 1;
        }
        .replay-injured-badge {
            position: absolute; bottom: -8px; left: -8px;
            width: 20px; height: 20px; border-radius: 50%;
            background: #e74c3c; color: #fff;
            font-size: 0.75rem; font-weight: 700;
            display: flex; align-items: center; justify-content: center;
            border: 2px solid #fff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.6);
        }
        .replay-bench-row {
            display: flex; align-items: center; gap: 6px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 6px; padding: 4px 6px; margin-bottom: 4px;
        }
        .replay-bench-dot {
            width: 22px; height: 22px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 0.6rem; font-weight: 900;
            border: 1px solid rgba(255,255,255,0.4);
            flex-shrink: 0;
        }
        .replay-bench-name {
            flex: 1; min-width: 0;
            font-size: 0.72rem; font-weight: 700; color: #fff;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .replay-bench-time {
            font-size: 0.66rem; font-weight: 800;
            font-family: 'Courier New', monospace;
            border-radius: 3px; padding: 1px 5px;
            flex-shrink: 0; white-space: nowrap;
        }
        /* ── v459 · LA CABECERA DEL REPRODUCTOR, EN LOS TRES FORMATOS ──
           La barra superior lleva el título del encuentro, el botón de descarga
           y la ✕. Iba en flex con space-between y SIN envolver, dentro de un
           contenedor que recorta lo que se sale: en un móvil de 390px el título
           empuja a los botones fuera de la caja y la ✕ —la única salida del
           reproductor— se queda recortada. Con esto el bloque de acciones no se
           encoge nunca y, si no cabe, baja a una segunda línea. Mismo
           comportamiento en PC, tablet y móvil.
           ⚠️ SIN ACENTOS GRAVES EN ESTE COMENTARIO: toda esta hoja vive dentro
           de un template literal, y uno solo lo cerraría y rompería el fichero
           entero (la lección de v400, que dejó muerto el panel de Padres). */
        .replay-topbar {
            display: flex; align-items: center; justify-content: space-between;
            gap: 0.5rem; flex-wrap: wrap;
        }
        .replay-topbar-info {
            display: flex; align-items: center; gap: 0.8rem;
            min-width: 0; flex: 1 1 auto;
        }
        .replay-topbar-title {
            min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .replay-topbar-actions {
            display: flex; align-items: center; gap: 0.6rem;
            flex-shrink: 0;   /* 🔑 la ✕ nunca se encoge ni se recorta */
        }
        @media (max-width: 600px) {
            .replay-topbar-actions button { font-size: 0.7rem; padding: 0.3rem 0.6rem; }
        }
        /* Tablet: mismo escalón intermedio que la retransmisión. */
        @media (max-width: 950px) {
            .replay-player-chip  { width: 38px; height: 38px; font-size: 0.85rem; border-width: 2.5px; }
            .replay-player-time  { font-size: 0.62rem; min-width: 40px; padding: 1px 4px; }
            .replay-player-label { font-size: 0.62rem; max-width: 72px; padding: 1px 4px; }
            .replay-goal-badge   { font-size: 0.6rem; right: -20px; }
        }
        @media (max-width: 600px) {
            .replay-player-chip  { width: 32px; height: 32px; font-size: 0.72rem; border-width: 2px; }
            .replay-player-time  { font-size: 0.55rem; min-width: 34px; padding: 1px 3px; }
            .replay-player-label { font-size: 0.55rem; max-width: 56px; padding: 1px 3px; }
            .replay-goal-badge   { font-size: 0.55rem; right: -18px; }
            .replay-card-badge   { font-size: 0.8rem; bottom: -6px; right: -6px; }
        }
        `;
        document.head.appendChild(st);
    }

    // ── Semáforo de tiempo jugado en la repetición ───────────────────
    // v427. Puerto de `_timerColorFor` (live.html) con UNA diferencia
    // deliberada: aquí la fuente de verdad es el PARTIDO, no el club de hoy.
    //
    // Desde v427 `pushLiveSnapshot` persiste `semaforoActive` en el documento
    // (js/match/live/sync.js), que es la decisión ya resuelta el día que se
    // jugó. Si el campo existe, MANDA: no se vuelve a preguntar por la
    // categoría ni por `categoryConfigs`, porque el Director puede haber
    // apagado el semáforo o cambiado los umbrales después del partido y la
    // repetición debe seguir mostrando los colores que se retransmitieron.
    //
    // Para los partidos ANTERIORES a v427 el campo no existe, y sólo entonces
    // se reconstruye la decisión con la misma cascada que usa el visor:
    // extras del club → juvenil/regional (nunca llevan semáforo) →
    // categoryConfigs[grupo].semaforoActive → umbrales → defaults 33/50.
    const REPLAY_CELESTE = { bg: '#79c0ff', text: '#000000' };

    function _replayGroupKey(cat, sub) {
        if (typeof window.getCategoryGroupKey === 'function') {
            return window.getCategoryGroupKey(cat, sub);
        }
        const raw = String(cat || '').toLowerCase();
        if (raw.includes('f7') || raw.includes('prebenj') || raw.includes('benj') || raw.includes('alev')) return 'f7';
        if (raw.includes('infant')) return sub === 'B' ? 'infantil_b' : sub === 'C' ? 'infantil_c' : 'infantil_a';
        if (raw.includes('cadet'))  return sub === 'B' ? 'cadete_b'   : sub === 'C' ? 'cadete_c'   : 'cadete_a';
        if (raw.includes('juvenil')) return 'juvenil';
        if (raw.includes('regional') || raw.includes('senior') || raw.includes('aficionad')) return 'regional';
        return 'f7';
    }

    function _replayTimerColor(timeSec, data) {
        data = data || {};

        const cat = data.category || '';
        const sub = data.subcategory || 'A';
        const groupKey = _replayGroupKey(cat, sub);
        const configs = data.categoryConfigs
                     || (typeof window !== 'undefined' && window._clubCategoryConfigs)
                     || (typeof window !== 'undefined' && window._liveCategoryConfigs)
                     || {};
        const groupCfg = configs[groupKey] || null;

        // ── 1. ¿Semáforo activo? ──
        // La bandera guardada CON el partido gana a cualquier otra fuente.
        // Ojo con el `=== false`: un partido antiguo no trae el campo
        // (undefined) y debe caer a la cascada, no darse por activo.
        let semaforoOn;
        if (data.semaforoActive === true)  semaforoOn = true;
        else if (data.semaforoActive === false || data.semaforo === false || data.semaforoEnabled === false) semaforoOn = false;
        else {
            const me = (typeof window !== 'undefined' && window._cronosCurrentUser) || null;
            const extras = (me && me.extras)
                        || (typeof window !== 'undefined' && window._liveClubExtras)
                        || {};
            if (extras.semaforo === false) semaforoOn = false;
            else if (groupKey === 'juvenil' || groupKey === 'regional') semaforoOn = false;
            else if (groupCfg && groupCfg.semaforoActive === false) semaforoOn = false;
            else semaforoOn = true;
        }

        if (!semaforoOn) return { bg: REPLAY_CELESTE.bg, text: REPLAY_CELESTE.text };

        // ── 2. Umbrales ──
        // `timerThresholds` viaja en el snapshot desde v221, así que para los
        // partidos grabados es el valor que el partido tenía de verdad.
        const fallback = data.timerThresholds
                      || (typeof window !== 'undefined' && window._clubTimerThresholds)
                      || (typeof window !== 'undefined' && window._liveCachedThresholds)
                      || null;
        const src = (groupCfg && (typeof groupCfg.red === 'number' || typeof groupCfg.yellow === 'number'))
                  ? groupCfg
                  : (fallback || {});
        const redPct    = (typeof src.red    === 'number' && !isNaN(src.red))    ? src.red    : 33;
        const yellowPct = (typeof src.yellow === 'number' && !isNaN(src.yellow)) ? src.yellow : 50;

        // v446: el semáforo mide el % del partido jugado, así que su base tiene
        // que ser la duración REAL —descuento incluido—, no el reglamento. Con
        // la base corta, un partido alargado ponía a todo el mundo en verde
        // antes de tiempo.
        const totalSec = _calculateMaxTime(data, _replayState.events);

        const t = timeSec || 0;
        if (t >= totalSec * (yellowPct / 100)) return { bg: '#2ea043', text: '#000000' };
        if (t >= totalSec * (redPct    / 100)) return { bg: '#e3b341', text: '#000000' };
        return { bg: '#da3633', text: '#ffffff' };
    }

    // ── Construir la UI Modal del Reproductor ────────────────────────
    function _renderReplayModal() {
        _injectReplayStyles();
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
            <div class="replay-topbar" style="background:rgba(255,255,255,0.03); border-bottom:1px solid rgba(255,255,255,0.1); padding:0.6rem 1.2rem;">
                <div class="replay-topbar-info">
                    <span style="background:rgba(88,166,255,0.2); border:1px solid rgba(88,166,255,0.4); color:#58a6ff; font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:6px; flex-shrink:0;">
                        ▶️ REPETICIÓN DEL PARTIDO
                    </span>
                    <span class="replay-topbar-title" style="font-size:0.85rem; font-weight:700; color:white;">
                        vs ${escapeHtml(rival)} (${escapeHtml(category)})
                    </span>
                </div>
                <div class="replay-topbar-actions">
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

    // FIX (auditoría 2026-07-22): los eventos de partido solo llevan `text`
    // libre (p.ej. `'GOL · ' + p.name`, ver js/match/events/player-actions.js
    // `_registerMatchEvent`) — no hay playerId/playerNumber en el evento. El
    // código anterior comparaba el texto contra el nombre con "includes",
    // así que un nombre que
    // fuera subcadena de otro (p.ej. "Ana" dentro de "Anabel") o dos jugadores
    // homónimos misatribuían el evento, y como el `forEach` no paraba al
    // primer match, un solo evento podía aplicarse a VARIOS jugadores a la
    // vez (tarjetas/entradas-salidas/lesiones). Estas dos funciones extraen el
    // nombre EXACTO tras el separador ' · ' (con el sufijo entre paréntesis,
    // p.ej. "(doble amarilla)", recortado) y buscan por IGUALDAD normalizada
    // (no por subcadena), devolviendo como mucho UN jugador.
    function _extractPlayerNameFromEventText(text) {
        if (typeof text !== 'string') return null;
        const parts = text.split(' · ');
        if (parts.length < 2) return null;
        // El nombre es SIEMPRE el ÚLTIMO segmento (algunos formatos tienen más
        // de un separador, p.ej. 'CAMBIO · Entra · ' + nombre) — tomar todo lo
        // posterior al primer separador incluiría "Entra" como si fuera parte
        // del nombre.
        let name = parts[parts.length - 1].trim();
        name = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
        return name || null;
    }

    function _findPlayerByEventText(playersMap, text) {
        const name = _extractPlayerNameFromEventText(text);
        if (!name) return null;
        return _findPlayerByName(playersMap, name);
    }

    function _findPlayerByName(playersMap, name) {
        if (!name) return null;
        const norm = (s) => String(s || '').trim().toLowerCase();
        const target = norm(name);
        return Object.values(playersMap).find(p => norm(p.name) === target) || null;
    }

    // FIX (fidelidad de "Revivir", 2026-07-29, defecto D): el modal de eventos
    // retroactivos NO emite 'sub_in'/'sub_out'. Emite UN SOLO evento de tipo
    // 'sub' con los dos jugadores dentro del texto
    // (js/match/events/retroactive-modal.js:173):
    //     'CAMBIO · Sale <sale>, Entra <entra> (Retroactivo)'
    // El visor solo entendia el par sub_in/sub_out, asi que estos cambios —
    // justamente los que anota el entrenador cuando se quedo sin bateria o sin
    // cobertura — no se reproducian. Ademas _extractPlayerNameFromEventText no
    // sirve aqui: al haber un unico ' · ' devolveria el segmento entero
    // ("Sale Diego, Entra Bruno"), que no es el nombre de nadie.
    function _parseRetroSubText(text) {
        if (typeof text !== 'string') return null;
        // Formato del modal retroactivo: "CAMBIO · Sale X, Entra Y (Retroactivo)".
        let m = text.match(/Sale\s+(.+?),\s*Entra\s+(.+?)(?:\s*\([^)]*\))?\s*$/);
        if (m) return { sale: m[1].trim(), entra: m[2].trim() };
        // Formato unificado del visor: "EQUIPO | ▲ SALE: X | ▼ ENTRA: Y".
        // El glifo cambió tres veces (🔺🔻 → 🟥🟩 → ▲▼, ver player-actions.js) y
        // este parseo sobrevivió a las tres porque NO mira el símbolo, sólo las
        // palabras SALE:/ENTRA:. No meter el glifo en la expresión.
        m = text.match(/SALE:\s*(.+?)\s*\|\s*[^|]*ENTRA:\s*(.+?)\s*$/);
        if (m) return { sale: m[1].trim(), entra: m[2].trim() };
        return null;
    }

    // ⚠️ EL TEXTO NO ES EL CONTRATO DE DATOS. Estas dos funciones prefieren los
    // campos ESTRUCTURADOS del evento (subOutName/subInName/playerName, que
    // añade _registerMatchEvent) y sólo caen al parseo del texto para los
    // eventos ANTIGUOS, que no los llevan. Antes el replay sacaba el nombre
    // partiendo el texto por ' · ', así que reformatear las sustituciones —algo
    // puramente visual— le dejaba de encontrar los jugadores y las
    // sustituciones desaparecían de la repetición sin error alguno.
    function _subNamesFromEvent(ev) {
        if (ev && ev.subOutName && ev.subInName) {
            return { sale: String(ev.subOutName).trim(), entra: String(ev.subInName).trim() };
        }
        return _parseRetroSubText(ev && ev.text);
    }

    function _playerNameFromEvent(ev) {
        if (ev && ev.playerName) return String(ev.playerName).trim();
        return _extractPlayerNameFromEventText(ev && ev.text);
    }

    // ── Alineación con la que EMPEZÓ el partido ──────────────────────
    // FIX (fidelidad de "Revivir", 2026-07-29, defectos A y C).
    //
    // `data.players` NO es el once inicial: pushLiveSnapshot (js/match/live/
    // sync.js) lo reescribe en cada latido de 5 s con el estado ACTUAL, así que
    // el documento solo conserva la ÚLTIMA foto. Sembrar el minuto 0 con eso
    // hacía que el visor pintase el once FINAL al empezar (el que entró en el
    // 60' aparecía en el campo desde el segundo 0, el que salió en el banquillo
    // desde el segundo 0) y luego aplicase los cambios ENCIMA de un estado que
    // ya los tenía aplicados.
    //
    // Desde hoy los partidos nuevos guardan `initialPlayers`. Para los ya
    // grabados se reconstruye el once recorriendo los eventos HACIA ATRÁS e
    // invirtiendo cada cambio: como la última inversión aplicada corresponde al
    // evento más antiguo de ese jugador, se recupera con exactitud quién era
    // titular y quién suplente. Las posiciones exactas del minuto 0 no son
    // recuperables por esta vía (solo se registran los arrastres posteriores),
    // así que esos partidos conservan las coordenadas finales.
    function _resolveInitialLineup(data, events) {
        const finalPlayers = Array.isArray(data.players) ? data.players : [];

        if (Array.isArray(data.initialPlayers) && data.initialPlayers.length) {
            return { players: data.initialPlayers, exact: true };
        }

        const rebuilt = finalPlayers.map(p => ({ ...p }));
        const byName = {};
        rebuilt.forEach(p => { byName[String(p.id)] = p; });

        for (let i = events.length - 1; i >= 0; i--) {
            const ev = events[i];
            if (ev.type === 'sub_in') {
                const p = _findPlayerByName(byName, _playerNameFromEvent(ev));
                if (p) p.status = 'bench';       // si entró, empezó fuera
            } else if (ev.type === 'sub_out') {
                const p = _findPlayerByName(byName, _playerNameFromEvent(ev));
                if (p) p.status = 'field';       // si salió, empezó dentro
            } else if (ev.type === 'sub') {
                const par = _subNamesFromEvent(ev);
                if (par) {
                    const sale  = _findPlayerByName(byName, par.sale);
                    const entra = _findPlayerByName(byName, par.entra);
                    if (sale)  sale.status  = 'field';
                    if (entra) entra.status = 'bench';
                }
            }
        }
        return { players: rebuilt, exact: false };
    }

    // ── Actualizar el Estado Visual para un Minuto Concreto ──────────
    function _updateReplayFrame(timeSec) {
        _replayState.currentTimeSec = timeSec;

        const data = _replayState.matchData || {};
        const events = _replayState.events || [];
        // v446: la 1ª parte acaba cuando acabó DE VERDAD (su cronómetro
        // acumulado), no cuando se agotó el reglamento: si no, el rótulo decía
        // "2ª PARTE" durante el descuento de la primera.
        const h1Max = _finPrimeraParteSec(data);

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
        // El minuto 0 se siembra con la alineación INICIAL (ver
        // _resolveInitialLineup), nunca con `data.players`, que es el estado
        // final del partido.
        const playersMap = {};
        const initialPlayers = _resolveInitialLineup(data, events).players;
        initialPlayers.forEach(p => {
            playersMap[String(p.id)] = {
                ...p,
                status: p.status || 'field',
                // Un suplente tiene x=0/y=0 legítimamente; `|| 50` los movía al
                // centro del campo. Solo se recentra si la coordenada falta.
                x: (typeof p.x === 'number') ? p.x : 50,
                y: (typeof p.y === 'number') ? p.y : 50,
                goals: 0,
                cards: 'ninguna',
                yellowCards: 0,
                injured: false,
                // v427: minutos jugados hasta el instante que se está pintando.
                // Se ACUMULA (ver _avanzarCronometros); no se lee de ningún sitio.
                timePlayed: 0
            };
        });

        // ── Cronómetro individual de cada jugador ────────────────────
        // v427. El tiempo jugado NO se puede leer del documento: `data.players`
        // es la ÚLTIMA foto que dejó pushLiveSnapshot (la reescribe entera en
        // cada latido de 5 s), así que sus `time` son los TOTALES al acabar el
        // partido. Usarlos aquí pintaría los 47' finales de un jugador ya en el
        // minuto 3 — la misma trampa que el defecto A del once inicial.
        //
        // Se deriva integrando el estado: cada tramo entre dos eventos suma a
        // quien estuviera en el campo durante ese tramo. La condición es
        // exactamente la del reloj real (js/match/timer/core.js: `if (p.status
        // === 'field') p.time += delta`), incluidos sus matices — un expulsado
        // sigue contando hasta que el entrenador lo retira del campo, igual que
        // en el partido en vivo.
        //
        // La línea de tiempo de la repetición está en SEGUNDOS DE PARTIDO, que
        // por construcción ya excluyen las pausas y el descanso, así que el
        // delta del reloj de partido es el delta correcto de tiempo jugado.
        let _marcaSec = 0;
        function _avanzarCronometros(hastaSec) {
            const dt = Math.max(0, (hastaSec || 0) - _marcaSec);
            if (dt <= 0) return;
            Object.values(playersMap).forEach(p => {
                if (p.status === 'field') p.timePlayed += dt;
            });
            _marcaSec = hastaSec;
        }

        let homeScore = 0;
        let awayScore = 0;

        // Aplicar eventos cronológicamente hasta timeSec
        events.forEach(ev => {
            if (ev.timeSec > timeSec) return;

            // Cerrar el tramo ANTERIOR antes de aplicar el evento: si este
            // evento es un cambio, el que sale debe cobrar hasta AQUÍ y el que
            // entra empezar a cobrar DESDE aquí.
            _avanzarCronometros(ev.timeSec);

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
                const foundP = _findPlayerByEventText(playersMap, ev.text);
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
                const p = _findPlayerByEventText(playersMap, ev.text);
                if (p) {
                    p.yellowCards = (p.yellowCards || 0) + 1;
                    if (p.yellowCards >= 2) p.cards = 'roja';
                    else p.cards = 'amarilla';
                }
            }
            if (ev.type === 'red') {
                const p = _findPlayerByEventText(playersMap, ev.text);
                if (p) p.cards = 'roja';
            }

            // Sustituciones
            if (ev.type === 'sub_in') {
                const p = _findPlayerByName(playersMap, _playerNameFromEvent(ev));
                if (p) p.status = 'field';
            }
            if (ev.type === 'sub_out') {
                const p = _findPlayerByName(playersMap, _playerNameFromEvent(ev));
                if (p) p.status = 'bench';
            }
            // Cambio de UN solo evento con los dos jugadores: el retroactivo y
            // también el unificado del visor (ver _subNamesFromEvent).
            if (ev.type === 'sub') {
                const par = _subNamesFromEvent(ev);
                if (par) {
                    const sale  = _findPlayerByName(playersMap, par.sale);
                    const entra = _findPlayerByName(playersMap, par.entra);
                    if (sale)  sale.status  = 'bench';
                    if (entra) entra.status = 'field';
                }
            }

            // Lesiones
            if (ev.type === 'injury') {
                const p = _findPlayerByEventText(playersMap, ev.text);
                if (p) p.injured = true;
            }
        });

        // Último tramo: desde el evento más reciente hasta el instante pintado.
        _avanzarCronometros(timeSec);

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

            // v427: cronómetro individual. `timePlayed` lo acumula
            // _updateReplayFrame instante a instante; el color sale del
            // semáforo del partido (celeste si estaba desactivado).
            const played = p.timePlayed || 0;
            const timerCol = _replayTimerColor(played, data);
            const timeHtml = `<div class="replay-player-time" style="background:${timerCol.bg}; color:${timerCol.text};">${_fmtSecs(played)}</div>`;
            const injuredBadge = p.injured ? `<span class="replay-injured-badge">✚</span>` : '';

            // ⚠️ v446 · LOS DATOS DE LA FICHA, EN ATRIBUTOS `data-*`.
            // El exportador de vídeo los necesita y hasta aquí los sacaba del
            // CSS: leía `chip.style.background`, que es un
            // `linear-gradient(...)`, y se lo pasaba a `ctx.fillStyle`. Canvas
            // NO entiende un gradiente en forma de cadena: descarta el valor en
            // silencio y sigue pintando con el color anterior — de ahí que los
            // equipos salieran MEZCLADOS en el vídeo. Es la misma lección de
            // v427: leer la PRESENTACIÓN para reconstruir datos se rompe sin dar
            // ningún error. Ahora el dato viaja como dato.
            const datosFicha =
                ` data-team="${isHome ? 'home' : 'away'}"` +
                ` data-shirt="${escapeHtml(color)}"` +
                ` data-shorts="${escapeHtml(shortsColor)}"` +
                ` data-text="${escapeHtml(textColor)}"` +
                ` data-num="${cleanNum}"` +
                ` data-name="${cleanName}"` +
                ` data-goals="${p.goals || 0}"` +
                ` data-card="${p.cards === 'amarilla' ? 'amarilla' : p.cards === 'roja' ? 'roja' : ''}"` +
                ` data-injured="${p.injured ? '1' : ''}"` +
                ` data-time="${_fmtSecs(played)}"` +
                ` data-timebg="${escapeHtml(timerCol.bg)}"` +
                ` data-timefg="${escapeHtml(timerCol.text)}"`;

            if (p.status === 'field') {
                const x = Math.max(5, Math.min(95, p.x || 50));
                const y = Math.max(5, Math.min(95, p.y || 50));
                // ⚠️ `left:`/`top:` siguen siendo INLINE a propósito: son valores
                // dinámicos por jugador y además el exportador de vídeo los lee
                // del atributo style (ver drawPitchFrame).
                pitchHtml += `
                    <div class="replay-player" style="left:${x}%; top:${y}%;"${datosFicha}>
                        ${timeHtml}
                        <div class="replay-player-chip" style="background:linear-gradient(to bottom, ${color} 50%, ${shortsColor} 50%); color:${textColor};">${cleanNum}${goalIcon ? `<span class="replay-goal-badge">${goalIcon}</span>` : ''}${cardIcon ? `<span class="replay-card-badge">${cardIcon}</span>` : ''}${injuredBadge}</div>
                        <div class="replay-player-label">${cleanName}</div>
                    </div>`;
            } else {
                const itemHtml = `
                    <div class="replay-bench-row"${datosFicha}>
                        <span class="replay-bench-dot" style="background:linear-gradient(to bottom, ${color} 50%, ${shortsColor} 50%); color:${textColor};">${cleanNum}</span>
                        <span class="replay-bench-name">${numLabel}${cleanName} ${cardIcon} ${goalIcon}</span>
                        <span class="replay-bench-time" style="background:${timerCol.bg}; color:${timerCol.text};">${_fmtSecs(played)}</span>
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

    // ════════════════════════════════════════════════════════════════
    //  v459 · LA ✕ DEVUELVE AL LISTADO, NO AL CAMPO VACÍO
    //
    //  Reporte del autor: al salir de un partido terminado con la ✕, la app
    //  dejaba a la vista un campo de fútbol vacío en lugar del panel de
    //  "Partidos Terminados".
    //
    //  🔑 NO ERA ESTE BOTÓN: ERAN LAS CAPAS DEL DOM. El reproductor es una capa
    //  `position:fixed` OPACA a z-index 100000, así que quitarla deja ver lo que
    //  hubiera debajo. Y debajo no estaba el listado: el botón "▶️ Revivir" de
    //  Partidos Terminados hacía `setup-modal.style.display='none'` ANTES de
    //  abrir el reproductor, y #setup-modal (z-index 2200) es justo la capa
    //  donde vive ese listado. Sin ella, lo que queda a la vista es
    //  #main-container, o sea el terreno de juego. Ocultarla no servía de nada
    //  —el reproductor ya la tapaba entera— y era la causa del síntoma.
    //  Es la misma lección de v404: ante un síntoma visual, mapear las CAPAS
    //  antes que los manejadores.
    //
    //  El arreglo va en dos sitios: el botón ya no oculta nada (app-init.js), y
    //  aquí se restaura de forma DEFENSIVA por si alguna otra vía lo ocultara.
    //  Se guarda cómo estaba la capa al ABRIR y se deja igual al cerrar; sólo se
    //  repinta (navReload) si de verdad hubo que devolverla a la vista, para no
    //  provocar lecturas de Firestore cuando el listado sigue intacto.
    //
    //  ⚠️ En live.html no existe #setup-modal: todo esto no hace nada allí, que
    //  es lo correcto — el visor en directo queda debajo y se ve solo.
    // ════════════════════════════════════════════════════════════════
    function _capaSetupModal() {
        if (typeof document === 'undefined' || !document.getElementById) return null;
        return document.getElementById('setup-modal');
    }

    function _recuerdaCapaOrigen() {
        const capa = _capaSetupModal();
        _replayState.capaVisibleAlAbrir = !!(capa && capa.style && capa.style.display &&
                                             capa.style.display !== 'none');
        _replayState.capaDisplayAlAbrir = (capa && capa.style && capa.style.display) || 'flex';
    }

    function _restauraCapaOrigen() {
        const capa = _capaSetupModal();
        if (!capa || !capa.style) return;
        if (!_replayState.capaVisibleAlAbrir) return;          // no estaba abierta: no se inventa
        if (capa.style.display !== 'none') return;             // sigue a la vista: nada que hacer
        capa.style.display = _replayState.capaDisplayAlAbrir || 'flex';
        // Repintar la pantalla que la pila dice que es la actual (el listado),
        // por si quien la ocultó también la vació.
        if (typeof window !== 'undefined' && typeof window.navReload === 'function') {
            try { window.navReload(); } catch (e) { /* el listado ya está a la vista */ }
        }
    }

    window.closeMatchReplay = function() {
        // Si se estaba exportando, se aborta sin descargar un fichero a medias.
        _detenerRecorrido();
        if (_replayState.mediaRecorder && _replayState.mediaRecorder.state === 'recording') {
            _replayState.exportAbortada = true;
            try { _replayState.mediaRecorder.stop(); } catch (e) {}
        }
        if (_recordCanvasTimer) { clearInterval(_recordCanvasTimer); _recordCanvasTimer = null; }
        _pauseReplay();
        const modal = document.getElementById('cronos-replay-modal');
        if (modal) modal.remove();
        _restauraCapaOrigen();
    };

    // ── Exportar Vídeo (.webm) Nativo con Canvas & MediaRecorder ─────
    let _recordCanvasTimer = null;

    // ════════════════════════════════════════════════════════════════
    //  v459 · EL VÍDEO CONTIENE EL PARTIDO ENTERO, SIEMPRE
    //
    //  Reporte del autor: el fichero descargado traía sólo la primera parte.
    //  Medido ejecutando el reproductor con un reloj controlado, la grabación
    //  tenía TRES agujeros y bastaba con cualquiera de ellos:
    //
    //   1 · EMPEZABA DONDE ESTUVIERA EL REPRODUCTOR. `_playReplay` sólo
    //       rebobina si el cursor ya está en el final, así que quien hubiera
    //       estado viendo el partido grababa desde donde lo dejó.
    //   2 · AVANZABA A TIEMPO REAL: un segundo de partido por segundo de
    //       reloj. Un partido de 73:40 exigía 73 minutos y 40 segundos de
    //       grabación con la pestaña abierta. Nadie espera eso: se pulsa
    //       "Detener" a media faena y el fichero se queda por donde iba.
    //   3 · NO SE DETENÍA SOLA. Ni al llegar al final: el `_pauseReplay()` del
    //       tic para el reloj del partido, pero el MediaRecorder sigue
    //       abierto. El fichero se cerraba SÓLO cuando el usuario pulsaba
    //       Detener, así que su contenido dependía de su paciencia.
    //
    //  🔑 La exportación deja de depender del usuario: rebobina a 0, recorre la
    //  línea temporal COMPLETA —descuento incluido, porque `maxTimeSec` sale de
    //  `timeH1`+`timeH2` desde v446— con un ritmo propio, y se detiene y
    //  descarga sola al llegar al final.
    //
    //  El ritmo: 10 saltos por segundo (100 ms) y el paso se calcula para que
    //  CUALQUIER duración quepa en ~1200 saltos, o sea ~2 MINUTOS de vídeo. Un
    //  partido de 73:40 sale en dos minutos en vez de en 73. El lienzo se sigue
    //  capturando a 30 fps, así que cada instante de la línea temporal ocupa
    //  unos 3 fotogramas y el movimiento se ve fluido.
    //
    //  ⚠️ LOS DOS SON DECISIÓN DEL AUTOR, no un ajuste técnico: pidió el vídeo
    //  "más lento, a unos 2 minutos" tras ver la primera versión de un minuto.
    //  Para cambiar la duración se toca SÓLO `_EXPORT_SALTOS`: la duración del
    //  vídeo es `_EXPORT_SALTOS × _EXPORT_MS` (1200 × 100 ms = 120 s), y el paso
    //  se recalcula solo para cada partido. Bajar `_EXPORT_MS` no alarga el
    //  vídeo, lo acelera.
    // ════════════════════════════════════════════════════════════════
    const _EXPORT_MS    = 100;    // cada cuánto avanza la línea temporal
    const _EXPORT_SALTOS = 1200;  // saltos totales ⇒ ~120 s de vídeo
    let _exportTimer = null;

    function _detenerRecorrido() {
        if (_exportTimer) { clearInterval(_exportTimer); _exportTimer = null; }
        _replayState.exportando = false;
    }

    function _restauraBotonGrabar() {
        const btn = document.getElementById('btn-replay-record');
        if (!btn) return;
        btn.innerHTML = '📹 Descargar Vídeo (.webm)';
        btn.style.background = 'rgba(231,76,60,0.15)';
        btn.style.borderColor = 'rgba(231,76,60,0.4)';
        btn.style.color = '#ff5858';
    }

    function _progresoExport(actual, total) {
        const btn = document.getElementById('btn-replay-record');
        if (!btn) return;
        const pct = Math.min(100, Math.round((actual / (total || 1)) * 100));
        btn.innerHTML = `⏹️ Grabando el partido… ${pct}%`;
    }

    // Recorre la línea temporal de 0 al final y llama a `alAcabar` cuando ha
    // pintado el último instante. No usa `_playReplay`: ése es el reproductor
    // del usuario, va a tiempo real y se puede pausar desde la interfaz.
    function _recorreParaExportar(alAcabar) {
        _pauseReplay();
        _detenerRecorrido();
        _replayState.exportando = true;
        const total = Math.max(1, _replayState.maxTimeSec || 1);
        const paso  = Math.max(1, Math.ceil(total / _EXPORT_SALTOS));
        _updateReplayFrame(0);
        _progresoExport(0, total);
        _exportTimer = setInterval(() => {
            const siguiente = _replayState.currentTimeSec + paso;
            if (siguiente >= total) {
                _updateReplayFrame(total);     // el instante final, completo
                _progresoExport(total, total);
                _detenerRecorrido();
                // Un respiro para que el último fotograma entre en el vídeo:
                // el lienzo se captura a 30 fps y el corte es asíncrono.
                setTimeout(() => { if (typeof alAcabar === 'function') alAcabar(); }, 700);
                return;
            }
            _updateReplayFrame(siguiente);
            _progresoExport(siguiente, total);
        }, _EXPORT_MS);
    }

    window._replayRecordVideo = async function() {
        const pitchContainer = document.getElementById('replay-pitch-container');
        if (!pitchContainer) return;

        try {
            const recordBtn = document.getElementById('btn-replay-record');

            // Si ya está grabando, detener y descargar lo que haya. Sigue
            // existiendo como ESCAPE —una grabación larga se puede abortar—,
            // pero ya no es la forma normal de terminar: v459 la cierra sola.
            if (_replayState.mediaRecorder && _replayState.mediaRecorder.state === 'recording') {
                _detenerRecorrido();
                _replayState.mediaRecorder.stop();
                _pauseReplay();
                if (_recordCanvasTimer) clearInterval(_recordCanvasTimer);
                _restauraBotonGrabar();
                return;
            }

            if (typeof showToast === 'function') showToast('📹 Iniciando grabación del partido…', 3000);

            // Crear Canvas dinámico para renderizar la repetición a 30 FPS
            const canvas = document.createElement('canvas');
            canvas.width = 900;
            // v446: 550 → 700. Los 150 px de más son la franja de BANQUILLOS,
            // que el vídeo no dibujaba en absoluto. El campo conserva su tamaño:
            // lo que antes era el borde inferior del lienzo ahora es el borde
            // superior de la franja.
            canvas.height = 700;
            const ctx = canvas.getContext('2d');
            const ALTO_BANQUILLOS = 150;

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
                // v446: el alto del campo descuenta la franja de banquillos.
                const pX = 20, pY = 75, pW = canvas.width - 40,
                      pH = canvas.height - 90 - ALTO_BANQUILLOS;
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
                    // v427: el selector era `div[style*="position:absolute"]` y
                    // los hijos se leían POR POSICIÓN (`chip.children[1]` = el
                    // nombre). Al pasar las fichas a clases, `position:absolute`
                    // dejó de estar en el atributo style —se lo lleva la hoja—
                    // y el orden cambió (ahora [0] es el cronómetro). Sin este
                    // cambio el vídeo exportado saldría con el campo VACÍO, y
                    // sin ningún error: el selector simplemente no encuentra
                    // nada. Ahora se busca por clase y cada parte por la suya.
                    const chips = pitchPlayersEl.querySelectorAll('.replay-player');
                    chips.forEach(chip => {
                        const style = chip.getAttribute('style') || '';
                        const leftM = style.match(/left:\s*([\d\.]+)%/);
                        const topM = style.match(/top:\s*([\d\.]+)%/);
                        if (leftM && topM) {
                            const pctX = parseFloat(leftM[1]) / 100;
                            const pctY = parseFloat(topM[1]) / 100;

                            const cX = pX + pctX * pW;
                            const cY = pY + pctY * pH;

                            // v446 · TODO SALE DE LOS `data-*`, no del CSS.
                            const d = chip.dataset || {};
                            const numTxt  = d.num  || '';
                            const nameTxt = d.name || '';
                            const timeTxt = d.time || '';

                            dibujaFicha(cX, cY, 18, d);

                            // Cronómetro individual, con el color del semáforo
                            // que ya decidió el render.
                            if (timeTxt) {
                                const tw = 40, th = 14, ty = cY - 34;
                                ctx.fillStyle = d.timebg || '#79c0ff';
                                ctx.fillRect(cX - tw / 2, ty, tw, th);
                                ctx.fillStyle = d.timefg || '#000000';
                                ctx.font = 'bold 10px monospace';
                                ctx.textAlign = 'center';
                                ctx.fillText(timeTxt, cX, ty + 11);
                            }

                            // Nombre
                            if (nameTxt) {
                                ctx.fillStyle = '#ffffff';
                                ctx.font = 'bold 11px sans-serif';
                                ctx.textAlign = 'center';
                                ctx.fillText(nameTxt, cX, cY + 32);
                            }
                        }
                    });
                }

                // 5. v446 · LOS BANQUILLOS. El vídeo no los dibujaba en
                //    absoluto: quien lo veía no sabía quién estaba fuera.
                // ⚠️ Los nombres y colores van por ARGUMENTO: se declaran dentro
                // de drawPitchFrame, así que una función hermana no los ve. Con
                // la referencia suelta esto lanzaba ReferenceError y se llevaba
                // por delante la grabación entera, fotograma a fotograma.
                dibujaBanquillos(pY + pH + 8, homeName, awayName, homeColor, awayColor);
            }

            // ── Una ficha, con sus dos colores y sus sucesos ────────────────
            //  🔑 EL GRADIENTE SE CONSTRUYE, NO SE COPIA. La camiseta arriba y
            //  el pantalón abajo, igual que en pantalla. Antes se le pasaba a
            //  `fillStyle` la cadena CSS `linear-gradient(...)`, que canvas
            //  ignora en silencio dejando el color del dibujo ANTERIOR: por eso
            //  los equipos salían mezclados.
            function dibujaFicha(cX, cY, r, d) {
                const camiseta = d.shirt  || '#58a6ff';
                const pantalon = d.shorts || camiseta;
                const grad = ctx.createLinearGradient(0, cY - r, 0, cY + r);
                grad.addColorStop(0, camiseta);
                grad.addColorStop(0.5, camiseta);
                grad.addColorStop(0.5, pantalon);
                grad.addColorStop(1, pantalon);

                ctx.beginPath();
                ctx.arc(cX, cY, r, 0, Math.PI * 2);
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Dorsal, con el color de texto que eligió el club.
                ctx.fillStyle = d.text || '#000000';
                ctx.font = 'bold ' + Math.round(r * 0.72) + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(String(d.num || ''), cX, cY + r * 0.28);

                dibujaSucesos(cX, cY, r, d);
            }

            // ── Goles, tarjetas y lesión SOBRE la ficha ─────────────────────
            //  El vídeo sólo pintaba dorsal, nombre y cronómetro: un gol no se
            //  veía por ninguna parte. Se dibujan con formas, no con emojis,
            //  para que no dependan de que la fuente del sistema los tenga.
            function dibujaSucesos(cX, cY, r, d) {
                const goles = parseInt(d.goals || '0', 10) || 0;
                if (goles > 0) {
                    const bx = cX + r * 0.85, by = cY - r * 0.85;
                    ctx.beginPath();
                    ctx.arc(bx, by, 8, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();
                    ctx.strokeStyle = '#1a1a1a';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.fillStyle = '#1a1a1a';
                    ctx.font = 'bold 10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(goles > 1 ? String(goles) : '1', bx, by + 3.5);
                }
                if (d.card === 'amarilla' || d.card === 'roja') {
                    const cw = 9, ch = 13;
                    const tx = cX - r - cw * 0.6, ty = cY - r * 0.9;
                    ctx.fillStyle = d.card === 'roja' ? '#da3633' : '#e3b341';
                    ctx.fillRect(tx, ty, cw, ch);
                    ctx.strokeStyle = '#1a1a1a';
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(tx, ty, cw, ch);
                }
                if (d.injured) {
                    const ix = cX - r * 0.85, iy = cY + r * 0.85;
                    ctx.beginPath();
                    ctx.arc(ix, iy, 8, 0, Math.PI * 2);
                    ctx.fillStyle = '#e74c3c';
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    // La cruz de la lesión, en trazo (no como texto).
                    ctx.beginPath();
                    ctx.moveTo(ix - 4, iy); ctx.lineTo(ix + 4, iy);
                    ctx.moveTo(ix, iy - 4); ctx.lineTo(ix, iy + 4);
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }

            // ── La franja de banquillos ─────────────────────────────────────
            function dibujaBanquillos(yTop, homeName, awayName, homeColor, awayColor) {
                const filas = {
                    home: document.querySelectorAll('#replay-bench-home .replay-bench-row'),
                    away: document.querySelectorAll('#replay-bench-away .replay-bench-row'),
                };
                ctx.fillStyle = 'rgba(10, 14, 20, 0.92)';
                ctx.fillRect(0, yTop, canvas.width, canvas.height - yTop);

                const mitad = canvas.width / 2;
                [['home', 20, homeName, homeColor], ['away', mitad + 10, awayName, awayColor]]
                    .forEach(([lado, x0, titulo, colorTitulo]) => {
                        ctx.textAlign = 'left';
                        ctx.font = 'bold 11px sans-serif';
                        ctx.fillStyle = colorTitulo;
                        ctx.fillText('BANQUILLO · ' + String(titulo).toUpperCase().slice(0, 22),
                                     x0, yTop + 18);

                        const lista = filas[lado];
                        // Dos columnas por equipo: con una sola, un banquillo
                        // largo se salía del lienzo sin avisar.
                        const porColumna = 4;
                        lista.forEach((fila, i) => {
                            if (i >= porColumna * 2) return;   // tope visible
                            const col = Math.floor(i / porColumna);
                            const x = x0 + 14 + col * 210;
                            const y = yTop + 42 + (i % porColumna) * 26;
                            const d = fila.dataset || {};
                            dibujaFicha(x, y, 11, d);
                            ctx.textAlign = 'left';
                            ctx.fillStyle = '#e6edf3';
                            ctx.font = 'bold 11px sans-serif';
                            ctx.fillText(String(d.name || '').slice(0, 14), x + 18, y + 4);
                            if (d.time) {
                                ctx.fillStyle = d.timebg || '#79c0ff';
                                ctx.fillRect(x + 140, y - 7, 38, 14);
                                ctx.fillStyle = d.timefg || '#000000';
                                ctx.font = 'bold 9px monospace';
                                ctx.textAlign = 'center';
                                ctx.fillText(d.time, x + 159, y + 3);
                            }
                        });
                        if (!lista.length) {
                            ctx.textAlign = 'left';
                            ctx.fillStyle = '#7d8590';
                            ctx.font = 'italic 11px sans-serif';
                            ctx.fillText('Vacío', x0 + 14, yTop + 44);
                        }
                    });
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
                _detenerRecorrido();
                _restauraBotonGrabar();
                // v459 · si la grabación se abortó al cerrar el reproductor, no
                // se descarga nada: un fichero a medias que nadie pidió es peor
                // que ninguno.
                if (_replayState.exportAbortada) { _replayState.exportAbortada = false; return; }
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
            // 🔑 v459 · DE 0 AL FINAL, Y SE CIERRA SOLA. Antes esto era
            // `_playReplay()`: arrancaba donde estuviera el cursor, avanzaba a
            // tiempo real y no paraba nunca.
            _recorreParaExportar(() => {
                if (_replayState.mediaRecorder && _replayState.mediaRecorder.state === 'recording') {
                    _replayState.mediaRecorder.stop();
                }
            });

            if (recordBtn) {
                recordBtn.style.background = '#e74c3c';
                recordBtn.style.borderColor = '#c0392b';
                recordBtn.style.color = '#ffffff';
            }

            if (typeof showToast === 'function') {
                showToast('⏺️ Grabando el partido completo… se descargará solo al terminar.', 4000);
            }

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

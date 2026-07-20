// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — retroactive-modal.js
//  Registro de Eventos Retroactivos (Pérdida de Batería / Cobertura)
// ════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    let _selectedEventType = 'goal';
    let _targetMatchId = null;

    // ── Abrir el modal para registrar un evento retroactivo ────────────
    window.openRetroactiveEventModal = function(matchId) {
        _targetMatchId = matchId || (typeof liveMatchId !== 'undefined' ? liveMatchId : null);

        let modal = document.getElementById('cronos-retroactive-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cronos-retroactive-modal';
            modal.className = 'modal-backdrop';
            modal.style.cssText = `
                position: fixed; inset: 0; z-index: 100005;
                background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: white;
            `;
            document.body.appendChild(modal);
        }

        // Obtener lista de jugadores convocados (locales / partido actual)
        let playerOptions = '';
        const currentPlayers = Array.isArray(window.players) ? window.players : [];
        if (currentPlayers.length > 0) {
            playerOptions = currentPlayers.map(p => 
                `<option value="${p.id}">#${p.number} ${escapeHtml(p.name)} (${p.status === 'field' ? 'Campo' : 'Banquillo'})</option>`
            ).join('');
        } else {
            playerOptions = `<option value="rival">⚽ Gol del Rival / Equipo Visitante</option>`;
        }

        modal.innerHTML = `
            <div class="modal-content" style="width:min(92vw, 480px); background:#0d1117; border:1px solid rgba(88,166,255,0.3); border-radius:14px; padding:1.2rem; display:flex; flex-direction:column; gap:1rem; box-shadow:0 10px 30px rgba(0,0,0,0.8);">
                <!-- Cabecera -->
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.6rem;">
                    <h3 style="margin:0; font-size:1.05rem; color:white; display:flex; align-items:center; gap:0.5rem;">
                        ⏱️ Registrar Evento Perdido
                    </h3>
                    <button onclick="window.closeRetroactiveEventModal()" style="background:none; border:none; color:#7d8590; font-size:1.4rem; cursor:pointer;">✕</button>
                </div>

                <div style="font-size:0.75rem; color:#7d8590; background:rgba(88,166,255,0.08); border:1px solid rgba(88,166,255,0.2); padding:0.6rem; border-radius:8px;">
                    💡 Usa este formulario si te quedaste sin batería o cobertura durante el partido. El evento se insertará cronológicamente en el historial y en el informe.
                </div>

                <!-- Selección de Minuto y Parte -->
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.8rem;">
                    <div>
                        <label style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.3rem;">Parte del Partido:</label>
                        <select id="retro-half-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700;">
                            <option value="1T">1ª Parte (1T)</option>
                            <option value="2T">2ª Parte (2T)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.3rem;">Minuto Exacto (1' - 90'):</label>
                        <input type="number" id="retro-minute-input" min="1" max="120" value="30" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700; font-family:monospace;">
                    </div>
                </div>

                <!-- Selección del Tipo de Evento -->
                <div>
                    <label style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.4rem;">Tipo de Suceso:</label>
                    <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:0.4rem;">
                        <button type="button" onclick="window._setRetroEventType('goal')" id="btn-retro-goal" class="btn-retro-type" style="background:rgba(88,166,255,0.25); border:1px solid #58a6ff; color:white; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">⚽ Gol</button>
                        <button type="button" onclick="window._setRetroEventType('sub')" id="btn-retro-sub" class="btn-retro-type" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🔄 Cambio</button>
                        <button type="button" onclick="window._setRetroEventType('yellow')" id="btn-retro-yellow" class="btn-retro-type" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🟨 Amarilla</button>
                        <button type="button" onclick="window._setRetroEventType('red')" id="btn-retro-red" class="btn-retro-type" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🟥 Roja</button>
                        <button type="button" onclick="window._setRetroEventType('injury')" id="btn-retro-injury" class="btn-retro-type" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#7d8590; padding:0.5rem 0.2rem; border-radius:8px; font-weight:800; font-size:0.75rem; cursor:pointer;">🚑 Lesión</button>
                    </div>
                </div>

                <!-- Selección de Jugador -->
                <div>
                    <label id="retro-player-label" style="font-size:0.75rem; font-weight:700; color:#58a6ff; display:block; margin-bottom:0.3rem;">Jugador Implicado:</label>
                    <select id="retro-player-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700;">
                        ${playerOptions}
                    </select>
                </div>

                <!-- Jugador Entrante (para cambios) -->
                <div id="retro-sub-container" style="display:none;">
                    <label style="font-size:0.75rem; font-weight:700; color:#2ecc71; display:block; margin-bottom:0.3rem;">Jugador que Entra al Campo:</label>
                    <select id="retro-sub-player-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:white; padding:0.5rem; border-radius:8px; font-weight:700;">
                        ${playerOptions}
                    </select>
                </div>

                <!-- Botón Guardar -->
                <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:0.4rem;">
                    <button type="button" onclick="window.closeRetroactiveEventModal()" style="background:rgba(255,255,255,0.08); border:none; color:white; padding:0.6rem 1.2rem; border-radius:8px; font-weight:700; cursor:pointer;">Cancelar</button>
                    <button type="button" onclick="window.submitRetroactiveEvent()" style="background:linear-gradient(135deg,#58a6ff,#1f6beb); border:none; color:white; padding:0.6rem 1.4rem; border-radius:8px; font-weight:800; cursor:pointer; box-shadow:0 4px 12px rgba(88,166,255,0.3);">
                        💾 Guardar Evento Retroactivo
                    </button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';
    };

    window._setRetroEventType = function(type) {
        _selectedEventType = type;
        const types = ['goal', 'sub', 'yellow', 'red', 'injury'];
        types.forEach(t => {
            const btn = document.getElementById(`btn-retro-${t}`);
            if (btn) {
                if (t === type) {
                    btn.style.background = 'rgba(88,166,255,0.25)';
                    btn.style.borderColor = '#58a6ff';
                    btn.style.color = 'white';
                } else {
                    btn.style.background = 'rgba(255,255,255,0.05)';
                    btn.style.borderColor = 'rgba(255,255,255,0.1)';
                    btn.style.color = '#7d8590';
                }
            }
        });

        const subContainer = document.getElementById('retro-sub-container');
        const playerLabel = document.getElementById('retro-player-label');
        if (subContainer) subContainer.style.display = type === 'sub' ? 'block' : 'none';
        if (playerLabel) playerLabel.textContent = type === 'sub' ? 'Jugador que Sale (Banquillo):' : 'Jugador Implicado:';
    };

    window.closeRetroactiveEventModal = function() {
        const modal = document.getElementById('cronos-retroactive-modal');
        if (modal) modal.style.display = 'none';
    };

    // ── Procesar el envío del evento retroactivo ──────────────────────
    window.submitRetroactiveEvent = async function() {
        const half = document.getElementById('retro-half-select')?.value || '1T';
        const minute = parseInt(document.getElementById('retro-minute-input')?.value || '30');
        const playerId = document.getElementById('retro-player-select')?.value;
        const subPlayerId = document.getElementById('retro-sub-player-select')?.value;

        const currentPlayers = Array.isArray(window.players) ? window.players : [];
        const p = currentPlayers.find(x => String(x.id) === String(playerId));
        const pSub = currentPlayers.find(x => String(x.id) === String(subPlayerId));

        const minStr = String(minute).padStart(2, '0');
        const matchTime = `${half} ${minStr}:00`;
        const nowStr = new Date().toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });

        let eventType = _selectedEventType;
        let text = '';
        let icon = '•';

        if (eventType === 'goal') {
            text = p ? `GOL · ${p.name} (Retroactivo)` : 'GOL · Equipo (Retroactivo)';
            icon = '⚽';
        } else if (eventType === 'yellow') {
            text = p ? `TARJETA AMARILLA · ${p.name} (Retroactivo)` : 'TARJETA AMARILLA (Retroactivo)';
            icon = '🟨';
        } else if (eventType === 'red') {
            text = p ? `TARJETA ROJA · ${p.name} (Retroactivo)` : 'TARJETA ROJA (Retroactivo)';
            icon = '🟥';
        } else if (eventType === 'injury') {
            text = p ? `LESIÓN · ${p.name} (Retroactivo)` : 'LESIÓN (Retroactivo)';
            icon = '🚑';
        } else if (eventType === 'sub') {
            const nameOut = p ? p.name : 'Jugador';
            const nameIn = pSub ? pSub.name : 'Jugador Entrante';
            text = `CAMBIO · Sale ${nameOut}, Entra ${nameIn} (Retroactivo)`;
            icon = '🔄';
        }

        // Actualizar estadísticas locales de jugador si existe
        if (p) {
            if (eventType === 'goal') p.goals = (p.goals || 0) + 1;
            if (eventType === 'yellow') {
                p.yellowCards = (p.yellowCards || 0) + 1;
                p.cards = p.yellowCards >= 2 ? 'roja' : 'amarilla';
            }
            if (eventType === 'red') p.cards = 'roja';
            if (eventType === 'injury') p.injured = true;
        }

        // Registrar el evento reutilizando la ruta central _registerMatchEvent,
        // que además persiste en Firestore (live_matches) con arrayUnion. Le
        // pasamos el matchTime manual como 4º parámetro (override retroactivo).
        if (typeof _registerMatchEvent === 'function') {
            _registerMatchEvent(eventType, text, icon, matchTime);
            // El evento retroactivo se inserta fuera de orden: reordenar por tiempo.
            if (Array.isArray(window._cronosMatchEvents)) {
                window._cronosMatchEvents.sort((a, b) => (a.createdAt - b.createdAt));
            }
        }

        // Tras un gol retroactivo, recalcular el marcador desde los jugadores.
        if (eventType === 'goal' && p && typeof syncScoreFromPlayers === 'function') {
            syncScoreFromPlayers(p.team);
        }

        if (typeof renderPlayers === 'function') renderPlayers();
        if (typeof updateMasterUI === 'function') updateMasterUI();

        // Auditar la acción crítica igual que hace el resto de acciones.
        const _liveId = _targetMatchId || (typeof liveMatchId !== 'undefined' ? liveMatchId : null);
        if (p && window.auditLogger && _liveId) {
            window.auditLogger.logPlayerAction(
                p.id,
                p.name,
                p.number,
                'retroactive_' + eventType,
                text,
                { retroactive: true, matchTime: matchTime }
            );
        }

        if (typeof showToast === 'function') showToast('✅ Evento retroactivo registrado con éxito', 3500);

        window.closeRetroactiveEventModal();
    };

})();

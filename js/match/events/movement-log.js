// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — MATCH/EVENTS/MOVEMENT LOG
// logMovement, logEvent, resetMatch, goBackToSetup, changeScore, export
// Extraído de app.js (líneas 5234-5809)
// ══════════════════════════════════════════════════════════════════

function logEvent(player, eventType) {
    // Registra gol, tarjeta o lesión con el minuto exacto
    const elapsed = matchPhase === '2nd_half' ? (masterTimeH1 + masterTimeH2) : masterTimeH1;
    const timestamp = formatTime(elapsed);
    const halfLabel = matchPhase === '1st_half' ? '1ªP' : matchPhase === '2nd_half' ? '2ªP' : 'DESC';
    player.history.push(`${eventType} a las ${timestamp} (${halfLabel})`);
}

function resetMatch() {
    if (!confirm("¿Reiniciar partido? Se perderá el tiempo y las estadísticas, pero se mantendrán los jugadores.")) return;
    
    // Detener sincronización en vivo si está activa
    if (typeof stopLiveSync === 'function') stopLiveSync();
    
    isRunning = false;
    clearInterval(timerInterval);
    masterTimeH1 = 0; masterTimeH2 = 0;
    lastTickTime = 0; matchPhase = '1st_half';
    // Bloque B: limpiar goles no asignados (propia puerta) del partido anterior
    // para que no se arrastren al marcador del partido reiniciado.
    window._cronosExtraGoals = { home: 0, away: 0 };
    // E4: nuevo partido → liberar el guard de despacho de informes para que
    // los informes del próximo partido vuelvan a enviarse una vez.
    window._cronosLastDispatchedMatch = null;
    // Punto 2: limpiar la marca de finalización para que el autoguardado del
    // partido reiniciado persista y no sea descartado al recargar la app.
    try { localStorage.removeItem('cronos_active_match_v2_finished'); } catch (e) {}
    updateMasterUI();
    const btn = document.getElementById('btn-play-pause');
    btn.textContent = 'EMPEZAR'; btn.classList.remove('danger');
    const startersCount = currentMode === 'f7' ? 7 : 11;
    let homeCount = 0, awayCount = 0;
    players.forEach((p) => {
        p.time = 0; p.history = []; p.x = 0; p.y = 0;
        if (p.team === 'home') { homeCount++; p.status = homeCount <= startersCount ? 'field' : 'bench'; }
        else { awayCount++; p.status = awayCount <= startersCount ? 'field' : 'bench'; }
    });
    activeFormationKey = null;
    document.querySelectorAll('.formation-btn').forEach(b => b.classList.remove('active'));
    renderPlayers();
}

function goBackToSetup() {
    // Eliminada la pausa automática para que el modo autónomo sobreviva:
    // if (isRunning) {
    //     isRunning = false; clearInterval(timerInterval);
    //     document.getElementById('btn-play-pause').textContent = 'REANUDAR';
    //     document.getElementById('btn-play-pause').classList.remove('danger');
    // }
    
    // Guardar el estado actual en LocalStorage antes de detener el sync y salir,
    // asegurando que sea recuperable en todo momento
    if (matchPhase !== 'finished' && matchPhase !== 'idle') {
        _saveMatchStateToStorage();
    }
    
    // Finalizar transmisión en vivo al volver al inicio
    stopLiveSync();
    // Ocultar card de staff al volver al setup
    const staffCard = document.getElementById('staff-bench-card');
    if (staffCard) { staffCard.style.display = 'none'; staffCard.innerHTML = ''; }
    openSetupModal();
}

function changeScore(team, delta) {
    if (!isRunning) {
        alert("⚠️ No se pueden sumar o quitar goles con el cronómetro del partido detenido. Debe iniciar o reanudar el partido.");
        return;
    }

    const el = document.getElementById(`score-${team}`);
    const current = parseInt(el.textContent) || 0;
    const next = Math.max(0, current + delta);

    if (delta > 0) {
        const teamPlayers = players.filter(p => p.team === team);
        if (teamPlayers.length > 0) {
            const listLines = teamPlayers.map((p, i) =>
                `${i + 1}. [${p.status === 'field' ? 'CAMPO' : 'BAN'}] ${p.number} - ${p.name}`
            ).join('\n');
            const answer = prompt(
                `⚽ GOL de ${team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away}\n¿Quién ha marcado? (escribe el número de la lista)\n\n0. Gol No Asignado / Propia Puerta\n${listLines}`, ''
            );
            if (answer !== null && answer.trim() !== '') {
                const idx = parseInt(answer) - 1;
                if (!isNaN(idx) && idx >= 0 && idx < teamPlayers.length) {
                    const scorer = teamPlayers[idx];
                    scorer.goals = (scorer.goals || 0) + 1;
                    if (typeof logEvent === 'function') {
                        logEvent(scorer, `GOL (${scorer.goals}º)`);
                    }
                    renderPlayers();
                } else if (answer.trim() === '0' || idx === -1) {
                    if (!window._cronosExtraGoals) window._cronosExtraGoals = { home: 0, away: 0 };
                    window._cronosExtraGoals[team]++;
                    if (typeof showToast === 'function') showToast(`⚽ Gol no asignado sumado a ${team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away}`, 3000);
                }
                syncScoreFromPlayers(team);
            }
        } else {
            if (!window._cronosExtraGoals) window._cronosExtraGoals = { home: 0, away: 0 };
            window._cronosExtraGoals[team]++;
            syncScoreFromPlayers(team);
        }
    } else {
        // Quitar gol (delta < 0)
        const teamPlayers = players.filter(p => p.team === team);
        if (teamPlayers.length > 0) {
            const scorers = teamPlayers.filter(p => (p.goals || 0) > 0);
            const extraGoals = window._cronosExtraGoals && window._cronosExtraGoals[team] ? window._cronosExtraGoals[team] : 0;
            
            if (scorers.length === 1 && extraGoals === 0) {
                scorers[0].goals--;
                if (typeof logEvent === 'function') {
                    logEvent(scorers[0], `GOL ANULADO (Quedan: ${scorers[0].goals})`);
                }
                renderPlayers();
                syncScoreFromPlayers(team);
            } else if (scorers.length === 0 && extraGoals > 0) {
                window._cronosExtraGoals[team]--;
                if (typeof showToast === 'function') showToast(`⚽ Gol no asignado anulado a ${team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away}`, 3000);
                syncScoreFromPlayers(team);
            } else if (scorers.length > 0 || extraGoals > 0) {
                const listLines = scorers.map((p, i) =>
                    `${i + 1}. Dorsal ${p.number} - ${p.name} (Goles: ${p.goals})`
                ).join('\n');
                let promptMsg = `⚽ QUITAR GOL de ${team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away}\n¿A quién le quitamos el gol? (escribe el número de la lista`;
                if (extraGoals > 0) {
                    promptMsg += `, o '0' para quitar Gol No Asignado)\n\n0. Gol No Asignado / Propia Puerta (${extraGoals} goles)\n`;
                } else {
                    promptMsg += `)\n\n`;
                }
                promptMsg += listLines;
                
                const answer = prompt(promptMsg, '');
                if (answer !== null && answer.trim() !== '') {
                    const idx = parseInt(answer) - 1;
                    if (!isNaN(idx) && idx >= 0 && idx < scorers.length) {
                        const scorer = scorers[idx];
                        scorer.goals--;
                        if (typeof logEvent === 'function') {
                            logEvent(scorer, `GOL ANULADO (Quedan: ${scorer.goals})`);
                        }
                        renderPlayers();
                    } else if ((answer.trim() === '0' || idx === -1) && extraGoals > 0) {
                        window._cronosExtraGoals[team]--;
                        if (typeof showToast === 'function') showToast(`⚽ Gol no asignado anulado a ${team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away}`, 3000);
                    }
                    syncScoreFromPlayers(team);
                }
            } else {
                el.textContent = next;
            }
        } else {
            if (window._cronosExtraGoals && window._cronosExtraGoals[team] > 0) {
                window._cronosExtraGoals[team]--;
                syncScoreFromPlayers(team);
            } else {
                el.textContent = next;
            }
        }
    }

    if (typeof liveSyncOnAction === 'function') {
        liveSyncOnAction();
    }
}

async function exportData() {
    const allPlayers = [...players];
    const processedPlayers = allPlayers.map(p => {
        const shiftsH1 = [], shiftsH2 = [];
        let descanso = "", currentEntry = null, currentHalf = "";
        // E5 (punto D): saneo defensivo para informes ya guardados antes del guard
        // de idempotencia. Si history trae pares Entra/Sale duplicados (mismo
        // minuto), el emparejador generaba columnas de entrada/salida repetidas.
        // pushShift descarta un turno idéntico (mismo in+out) al último ya añadido,
        // de modo que cada entrada/salida aparece exactamente una vez.
        const pushShift = (arr, shift) => {
            const last = arr[arr.length - 1];
            if (last && last.in === shift.in && last.out === shift.out) return; // duplicado → omitir
            arr.push(shift);
        };
        const hasImplicitStart = (p.history.length > 0 && p.history[0].includes('Sale')) ||
            (p.history.length === 0 && (p.time > 0 || p.status === 'field'));
        if (hasImplicitStart) { currentEntry = "00:00"; currentHalf = "1ªP"; }
        p.history.forEach(h => {
            const timeMatch = h.match(/(\d{2}:\d{2})/);
            const halfMatch = h.match(/\(([^)]+)\)/);
            const timestamp = timeMatch ? timeMatch[1] : "";
            const halfLabel = halfMatch ? halfMatch[1] : "";
            if (h.includes('Entra')) { currentEntry = timestamp; currentHalf = halfLabel; }
            else if (h.includes('Sale')) {
                if (halfLabel === 'DESCANSO') {
                    descanso = timestamp;
                    pushShift(shiftsH1, { in: currentEntry || "00:00", out: timestamp });
                    currentEntry = null; currentHalf = "";
                } else if (currentHalf === '2ªP' || halfLabel === '2ªP') {
                    if (currentEntry) { pushShift(shiftsH2, { in: currentEntry, out: timestamp }); currentEntry = null; currentHalf = ""; }
                } else {
                    if (currentEntry) { pushShift(shiftsH1, { in: currentEntry, out: timestamp }); currentEntry = null; currentHalf = ""; }
                }
            }
        });
        if (currentEntry) {
            if (currentHalf === '2ªP') pushShift(shiftsH2, { in: currentEntry, out: "" });
            else pushShift(shiftsH1, { in: currentEntry, out: "" });
        }
        // Extraer eventos del historial (goles, tarjetas, lesión) con minuto
        const events = [];
        p.history.forEach(h => {
            const timeMatch = h.match(/(\d{2}:\d{2})/);
            const halfMatch = h.match(/\(([^)]+)\)/);
            const t = timeMatch ? timeMatch[1] : '';
            const half = halfMatch ? halfMatch[1] : '';
            if (h.includes('GOL'))             events.push({ type: 'GOL',      time: t, half });
            if (h.includes('AMARILLA'))        events.push({ type: 'AMARILLA', time: t, half });
            if (h.includes('ROJA'))            events.push({ type: 'ROJA',     time: t, half });
            if (h.includes('LESIÓN'))          events.push({ type: 'LESIÓN',   time: t, half });
        });
        return { ...p, shiftsH1, shiftsH2, descanso, events };
    });

    // ── Construir mapa de colores para sustituciones emparejadas ──────────
    // Paleta de 10 colores distinguibles (fondo claro para texto negro)
    const SUB_COLORS = [
        '#FFD700','#90EE90','#87CEEB','#FFB6C1','#DDA0DD',
        '#F0E68C','#98FB98','#ADD8E6','#FFA07A','#B0C4DE'
    ];
    const subColorMap = {}; // subId → color
    let subColorIdx   = 0;

    // Recorrer historial de todos los jugadores para asignar color por subId
    processedPlayers.forEach(p => {
        p.history.forEach(h => {
            const subMatch = h.match(/#(\d+)/);
            if (subMatch) {
                const sid = subMatch[1];
                if (!subColorMap[sid]) {
                    subColorMap[sid] = SUB_COLORS[subColorIdx % SUB_COLORS.length];
                    subColorIdx++;
                }
            }
        });
    });

    // Añadir color a cada shift del jugador
    processedPlayers.forEach(p => {
        // Buscar subIds en el historial y asociarlos a los shifts
        let h1idx = 0, h2idx = 0;
        p.history.forEach(h => {
            const subMatch = h.match(/#(\d+)/);
            const color    = subMatch ? subColorMap[subMatch[1]] : null;
            const half     = h.match(/\(([^)]+)\)/)?.[1] || '';
            if (h.includes('Entra') || h.includes('Sale')) {
                if (half === '2ªP') {
                    if (p.shiftsH2[h2idx]) { p.shiftsH2[h2idx].color = color; h2idx++; }
                } else {
                    if (p.shiftsH1[h1idx]) { p.shiftsH1[h1idx].color = color; h1idx++; }
                }
            }
        });
    });

    const maxH1 = Math.max(...processedPlayers.map(p => p.shiftsH1.length), 1);
    const maxH2 = Math.max(...processedPlayers.map(p => p.shiftsH2.length), 1);
    const totalCols = 5 + (maxH1 * 2) + 1 + (maxH2 * 2) + 1;
    const q = (v) => `"${(v || "").toString().replace(/"/g, '""')}"`;
    const makeRow = (cells) => { const r = [...cells]; while (r.length < totalCols) r.push(""); return r.map(q).join(";") + "\n"; };

    let csvContent = "sep=;\n";
    const date = new Date().toLocaleDateString();
    const mode = currentMode === 'f7' ? 'Futbol 7' : 'Futbol 11';
    const homeName = TEAM_NAMES.home, awayName = TEAM_NAMES.away;
    const scoreHome = document.getElementById('score-home').textContent;
    const scoreAway = document.getElementById('score-away').textContent;
    const totalElapsed = masterTimeH1 + masterTimeH2;

    csvContent += makeRow(["FECHA", date]);
    csvContent += makeRow(["MODO", mode]);
    csvContent += makeRow(["ENCUENTRO", `${homeName} vs ${awayName}`]);
    csvContent += makeRow(["RESULTADO", `${scoreHome} - ${scoreAway}`]);
    csvContent += makeRow(["TIEMPO GLOBAL", formatTime(totalElapsed)]);
    csvContent += makeRow([]);

    const sectionRow = ["","","","",""];
    sectionRow.push("=== 1ª PARTE ===");
    for (let i = 1; i < maxH1 * 2; i++) sectionRow.push("");
    sectionRow.push("=== DESCANSO ===");
    sectionRow.push("=== 2ª PARTE ===");
    for (let i = 1; i < maxH2 * 2; i++) sectionRow.push("");
    sectionRow.push("");
    csvContent += makeRow(sectionRow);

    const headers = ["EQUIPO","DORSAL","NOMBRE","GOLES","TARJETAS","LESION",
                      "EVENTOS (minuto - tipo)"];
    for (let i = 1; i <= maxH1; i++) headers.push(`ENTRADA ${i}`, `SALIDA ${i}`);
    headers.push("MIN. DESCANSO");
    for (let i = 1; i <= maxH2; i++) headers.push(`ENTRADA ${i}`, `SALIDA ${i}`);
    headers.push("TIEMPO TOTAL");
    csvContent += makeRow(headers);

    const sortedPlayers = [...processedPlayers].sort((a, b) => {
        if (a.team !== b.team) return a.team === 'home' ? -1 : 1;
        return a.number - b.number;
    });

    sortedPlayers.forEach(p => {
        const teamName = p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away;
        const cardDisplay = p.cards === 'ninguna' ? "" : (p.cards === 'amarilla' ? "AMARILLA" : "ROJA");
        const injuryDisplay = p.injured ? 'SI' : '';
        const eventsDisplay = (p.events || [])
            .map(e => e.time + ' (' + e.half + ') ' + e.type)
            .join(' | ');
        const rowCells = [teamName, p.number, p.name, p.goals || 0, cardDisplay,
                          injuryDisplay, eventsDisplay];
        // Añadir número de cambio (C1, C2...) junto al minuto para identificar pares
        const getShiftLabel = (s) => {
            if (!s) return ['', ''];
            const changeNum = s.color ? ' (C' + (Object.values(subColorMap).indexOf(s.color) + 1) + ')' : '';
            return [s.in ? s.in + changeNum : '', s.out ? s.out + changeNum : ''];
        };
        for (let i = 0; i < maxH1; i++) { const sl = getShiftLabel(p.shiftsH1[i]); rowCells.push(sl[0], sl[1]); }
        rowCells.push(p.descanso || '');
        for (let i = 0; i < maxH2; i++) { const sl = getShiftLabel(p.shiftsH2[i]); rowCells.push(sl[0], sl[1]); }
        rowCells.push(formatTime(p.time));
        csvContent += makeRow(rowCells);
    });

    // Añadir leyenda de cambios al final del CSV
    if (Object.keys(subColorMap).length > 0) {
        csvContent += makeRow([]);
        csvContent += makeRow(['=== LEYENDA DE CAMBIOS ===']);
        csvContent += makeRow(['CAMBIO', 'JUGADOR QUE SALE', 'JUGADOR QUE ENTRA', 'MINUTO']);
        Object.entries(subColorMap).forEach(([sid, color], idx) => {
            const paired = processedPlayers.filter(p =>
                p.history.some(h => h.includes('#' + sid))
            );
            const salida  = paired.find(p => p.history.some(h => h.includes('#' + sid) && h.includes('Sale')));
            const entrada = paired.find(p => p.history.some(h => h.includes('#' + sid) && h.includes('Entra')));
            const timeMatch = (salida || entrada)?.history
                .find(h => h.includes('#' + sid))?.match(/(\d{2}:\d{2})/);
            csvContent += makeRow([
                'C' + (idx + 1),
                salida  ? salida.number  + ' ' + salida.name  : '',
                entrada ? entrada.number + ' ' + entrada.name : '',
                timeMatch ? timeMatch[1] : ''
            ]);
        });
    }

    const metaEl = document.getElementById('report-metadata');
    const bodyEl = document.getElementById('report-players-body');
    metaEl.innerHTML = `
        <div><strong>Fecha:</strong> ${date}</div>
        <div><strong>Partido:</strong> ${homeName} vs ${awayName}</div>
        <div><strong>Resultado:</strong> ${scoreHome} - ${scoreAway}</div>
        <div><strong>Competición:</strong> ${mode}</div>
        <div><strong>Tiempo Global:</strong> ${formatTime(totalElapsed)}</div>
    `;
    bodyEl.innerHTML = sortedPlayers.map(p => {
        const teamName = p.team === 'home' ? TEAM_NAMES.home : TEAM_NAMES.away;
        const cardDisplay = p.cards === 'ninguna' ? "" : (p.cards === 'amarilla' ? "🟨 AMARILLA" : "🟥 ROJA");
        // Generar celdas de entrada/salida con colores de sustitución
        const makeShiftCells = (shifts) => shifts.map(s => {
            const bg    = s && s.color ? s.color : 'transparent';
            const style = `border:1px solid #ddd;padding:6px 8px;text-align:center;background:${bg};font-weight:${s&&s.color?'700':'400'};font-size:0.82rem;`;
            const inVal  = s ? s.in  : '';
            const outVal = s ? s.out : '';
            return `<td style="${style}">${inVal}</td><td style="${style}">${outVal}</td>`;
        }).join('');

        return `<tr>
            <td style="border:1px solid #ddd;padding:8px;">${teamName}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:700;">${p.number}</td>
            <td style="border:1px solid #ddd;padding:8px;">${p.name}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${p.goals || 0}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${cardDisplay}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${p.injured ? '🚑' : '-'}</td>
            <td style="border:1px solid #ddd;padding:8px;font-size:0.8rem;color:#333;">
                ${(p.events||[]).map(e =>
                    e.time + '(' + e.half + ') ' +
                    (e.type==='GOL' ? '⚽' : e.type==='AMARILLA' ? '🟨' : e.type==='ROJA' ? '🟥' : '🚑')
                ).join('  ')}
            </td>
            ${makeShiftCells(p.shiftsH1.concat(Array(maxH1 - p.shiftsH1.length).fill(null)))}
            <td style="border:1px solid #ddd;padding:8px;text-align:center;">${p.descanso||''}</td>
            ${makeShiftCells(p.shiftsH2.concat(Array(maxH2 - p.shiftsH2.length).fill(null)))}
            <td style="border:1px solid #ddd;padding:8px;text-align:right;">${formatTime(p.time)}</td>
        </tr>`;
    }).join('');

    // Añadir leyenda de colores de sustituciones al informe imprimible
    const legendEl = document.getElementById('report-sub-legend');
    if (legendEl) {
        const usedColors = Object.entries(subColorMap);
        if (usedColors.length > 0) {
            // Encontrar qué jugadores comparten cada color
            const pairsByColor = {};
            usedColors.forEach(([sid, color]) => {
                const paired = processedPlayers.filter(p =>
                    p.history.some(h => h.includes('#' + sid))
                ).map(p => p.number + ' ' + p.name);
                pairsByColor[color] = paired;
            });
            legendEl.innerHTML = '<strong style="font-size:0.85rem;">🔄 Leyenda de sustituciones:</strong><br>' +
                Object.entries(pairsByColor).map(([color, names]) =>
                    `<span style="display:inline-flex;align-items:center;gap:5px;
                                  margin:3px 8px 3px 0;padding:3px 8px;
                                  background:${color};border-radius:4px;
                                  font-size:0.78rem;font-weight:700;color:#000;">
                        ${names.join(' ⇄ ')}
                    </span>`
                ).join('');
        } else {
            legendEl.innerHTML = '';
        }
    }

    window.print();

    // --- DESCARGA LOCAL (copia para el entrenador) ---
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cronos_${homeName}_vs_${awayName}_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // ── WHATSAPP: automático, principal ────────────────────────────
    const waNumbers = [emailConfig.whatsappNumber, emailConfig.whatsappNumber2]
        .filter(n => n && n.length > 5);

    const waLines = sortedPlayers.filter(p => p.team === 'home').map(p => {
        const card    = p.cards === 'amarilla' ? ' 🟨' : p.cards === 'roja' ? ' 🟥' : '';
        const goals   = p.goals > 0 ? ' ⚽×' + p.goals : '';
        const injured = p.injured ? ' 🚑' : '';
        const evts    = (p.events||[]).map(e =>
            e.time + '(' + e.half + ')' +
            (e.type==='GOL'?'⚽':e.type==='AMARILLA'?'🟨':e.type==='ROJA'?'🟥':'🚑')
        ).join(' ');
        return p.number + '. ' + p.name + ' — ' + formatTime(p.time) +
               goals + card + injured + (evts ? ' [' + evts + ']' : '');
    });

    const waMsg = '📊 *INFORME — Cronos Fútbol*\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        '📅 ' + date + '  |  ' + mode + '\n' +
        '⚽ *' + homeName + ' ' + scoreHome + ' - ' + scoreAway + ' ' + awayName + '*\n' +
        '⏱️ ' + formatTime(totalElapsed) + '\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        waLines.join('\n') + '\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        '_Cronos Fútbol_';

    if (waNumbers.length > 0) {
        const encoded = encodeURIComponent(waMsg);
        waNumbers.forEach((num, i) => {
            setTimeout(() => {
                window.open('https://wa.me/' + num + '?text=' + encoded, '_blank');
            }, i * 1200);
        });
        showToast('📱 WhatsApp abierto — pulsa Enviar para confirmar');
    } else {
        showToast('✅ Informe descargado');
    }

    // ── EMAIL: alternativo con mailto (correo personal, sin cuentas extra) ──
    const emailRecipients = [emailConfig.directorEmail, emailConfig.directorEmail2]
        .filter(e => e && e.includes('@')).join(',');
    if (emailRecipients) {
        const subj = encodeURIComponent('📊 Informe ' + homeName + ' ' + scoreHome +
                     '-' + scoreAway + ' ' + awayName + ' · ' + date);
        const body = encodeURIComponent(waMsg.replace(/[*_]/g, ''));
        setTimeout(() => {
            window.open('mailto:' + emailRecipients + '?subject=' + subj + '&body=' + body);
        }, waNumbers.length > 0 ? 1500 : 0);
    }

}


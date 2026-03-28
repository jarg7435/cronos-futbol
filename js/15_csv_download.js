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





/**
 * Chronos Fútbol - ReportGenerator v9.0
 * Genera informes profesionales en CSV y PDF (HTML-Print) con branding oficial.
 *
 * FIXED v9.0:
 *   - generatePDF() implementada completamente: genera informe HTML
 *     profesional con todas las estadísticas del partido.
 *   - Soporta datos simples (matchData) y datos enriquecidos desde
 *     la app principal (shifts, eventos, sustituciones).
 *   - Eliminado console.log de debug.
 */

class ReportGenerator {
    constructor(matchData) {
        this.matchData = matchData || {};
        this.logoUrl   = 'public/assets/img_29448ebf.png';
    }

    async generateCSV() {
        const d       = this.matchData;
        const date    = d.date      || new Date().toLocaleDateString('es-ES');
        const home    = d.homeTeam  || 'Local';
        const away    = d.awayTeam  || 'Visitante';
        const scoreH  = d.homeScore ?? '?';
        const scoreA  = d.awayScore ?? '?';
        const players = d.players   || [];

        let csv = 'CHRONOS FÚTBOL - INFORME DE PARTIDO\n';
        csv += `Fecha,${date}\n`;
        csv += `Resultado,${home} ${scoreH} - ${scoreA} ${away}\n\n`;
        csv += 'Dorsal,Nombre,Minutos,Goles,Tarjetas\n';
        players.forEach(p => {
            csv += `${p.number},${p.name},${p.minutes||0},${p.goals||0},${p.cards||'ninguna'}\n`;
        });
        return csv;
    }

    downloadCSV() {
        this.generateCSV().then(csv => {
            const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `informe_partido_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }).catch(e => console.error('[ReportGenerator] CSV error:', e));
    }

    /**
     * generatePDF() — Genera un informe profesional del partido.
     * Crea un HTML con formato de impresión y lo abre en una nueva ventana
     * con el diálogo de impresión (permite "Guardar como PDF").
     *
     * matchData esperado:
     *   {
     *     date, homeTeam, awayTeam, homeScore, awayScore,
     *     mode, half1Time, half2Time, formation,
     *     players: [{
     *       number, name, team, time, goals, cards, injured,
     *       status, shiftsH1:[], shiftsH2:[], descanso,
     *       events:[{type,time,half}], history:[]
     *     }],
     *     subColorMap: { subId: colorHex }
     *   }
     */
    async generatePDF() {
        const d       = this.matchData;
        const date    = d.date      || new Date().toLocaleDateString('es-ES');
        const home    = d.homeTeam  || 'Local';
        const away    = d.awayTeam  || 'Visitante';
        const scoreH  = d.homeScore ?? '?';
        const scoreA  = d.awayScore ?? '?';
        const mode    = d.mode      || '';
        const h1Time  = d.half1Time || '—';
        const h2Time  = d.half2Time || '—';
        const form    = d.formation || '—';
        const players = d.players   || [];
        const subColorMap = d.subColorMap || {};

        // ── Calcular estadísticas ──────────────────────────────────
        const homePlayers   = players.filter(p => p.team === 'home');
        const awayPlayers   = players.filter(p => p.team === 'away');
        const totalGoalsH   = homePlayers.reduce((s, p) => s + (p.goals || 0), 0);
        const totalGoalsA   = awayPlayers.reduce((s, p) => s + (p.goals || 0), 0);
        const yellowCards   = players.filter(p => p.cards === 'amarilla').length;
        const redCards      = players.filter(p => p.cards === 'roja').length;
        const injuredCount  = players.filter(p => p.injured).length;
        const substitutions = players.reduce((s, p) => {
            return s + (p.shiftsH1 ? p.shiftsH1.length : 0) + (p.shiftsH2 ? p.shiftsH2.length : 0);
        }, 0) / 2;

        // Ordenar: titulares primero, luego suplentes
        const sorted = [...players].sort((a, b) => {
            if (a.status === 'field' && b.status !== 'field') return -1;
            if (a.status !== 'field' && b.status === 'field') return 1;
            if (a.team === 'home' && b.team !== 'home') return -1;
            if (a.team !== 'home' && b.team === 'home') return 1;
            return (a.number || 0) - (b.number || 0);
        });

        // ── Detectar máximos de shifts para tabla avanzada ─────────
        const maxH1 = Math.max(...sorted.map(p => (p.shiftsH1 || []).length), 1);
        const maxH2 = Math.max(...sorted.map(p => (p.shiftsH2 || []).length), 1);

        // ── Generar leyenda de sustituciones ──────────────────────
        const legendEntries = Object.entries(subColorMap);
        const legendHTML = legendEntries.length > 0 ? `
            <div class="legend-box">
                <strong>Sustituciones:</strong><br>
                ${legendEntries.map(([sid, color]) => {
                    const paired = sorted.filter(p =>
                        (p.history || []).some(h => h.includes('#' + sid))
                    ).map(p => '#' + p.number + ' ' + p.name);
                    return `<span class="legend-chip" style="background:${color}">${paired.join(' ⇄ ')}</span>`;
                }).join('')}
            </div>` : '';

        // ── Generar filas de jugadores ────────────────────────────
        const playerRows = sorted.map(p => {
            const teamLabel = p.team === 'home' ? home : away;
            const cardDisplay = p.cards === 'ninguna' ? '—' :
                (p.cards === 'amarilla' ? '🟨 Amarilla' : '🟥 Roja');
            const injDisplay  = p.injured ? '🚑' : '—';
            const minutes     = p.time || 0;
            const m = Math.floor(minutes / 60);
            const s = minutes % 60;
            const timeStr = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

            // Eventos del jugador
            const evts = (p.events || []).map(e => {
                const icon = e.type === 'GOL' ? '⚽' :
                             e.type === 'AMARILLA' ? '🟨' :
                             e.type === 'ROJA' ? '🟥' : '🚑';
                return `${icon} ${e.time}(${e.half || ''})`;
            }).join(' &nbsp; ');

            // Shifts con colores
            const makeShiftCells = (shifts, maxLen) => {
                let cells = '';
                for (let i = 0; i < maxLen; i++) {
                    const sh = shifts[i];
                    const bg = sh && sh.color ? `background:${sh.color}` : '';
                    const fw = sh && sh.color ? 'font-weight:700' : '';
                    cells += `<td class="shift" style="${bg};${fw}">${sh ? sh.in : ''}</td>`;
                    cells += `<td class="shift" style="${bg};${fw}">${sh ? sh.out : ''}</td>`;
                }
                return cells;
            };

            const statusIcon = p.status === 'field' ? '' : '<span class="bench-badge">SUP</span>';

            return `<tr>
                <td>${teamLabel}</td>
                <td class="num">${p.number}</td>
                <td>${p.name} ${statusIcon}</td>
                <td class="center">${p.goals || 0}</td>
                <td class="center">${cardDisplay}</td>
                <td class="center">${injDisplay}</td>
                <td class="events-cell">${evts || '—'}</td>
                ${makeShiftCells(p.shiftsH1 || [], maxH1)}
                <td class="center">${p.descanso || ''}</td>
                ${makeShiftCells(p.shiftsH2 || [], maxH2)}
                <td class="center time-cell">${timeStr}</td>
            </tr>`;
        }).join('');

        // ── Generar goleadores resumen ────────────────────────────
        const scorers = sorted.filter(p => p.goals > 0).map(p =>
            `⚽ ${p.number} ${p.name} (${p.goals})`
        ).join(' &nbsp;|&nbsp; ') || '—';

        // ── Build del HTML del informe ────────────────────────────
        const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe de Partido — ${home} vs ${away}</title>
<style>
    @page { size: A4 landscape; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
        font-size: 11px;
        color: #1a1a1a;
        background: #fff;
        padding: 15px 20px;
    }

    /* ── Header ─────────────────────────────────── */
    .report-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 3px solid #0d1117;
        padding-bottom: 12px;
        margin-bottom: 14px;
    }
    .report-title {
        font-size: 20px;
        font-weight: 800;
        color: #0d1117;
        letter-spacing: 1px;
    }
    .report-subtitle {
        font-size: 11px;
        color: #555;
        font-weight: 400;
    }
    .brand {
        font-size: 12px;
        color: #888;
        text-align: right;
    }

    /* ── Scoreboard ─────────────────────────────── */
    .scoreboard {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 20px;
        padding: 14px 0;
        margin-bottom: 14px;
        border: 1px solid #ddd;
        border-radius: 8px;
        background: #fafafa;
    }
    .team-name {
        font-size: 16px;
        font-weight: 700;
        text-align: center;
        min-width: 120px;
    }
    .score {
        font-size: 32px;
        font-weight: 900;
        color: #0d1117;
        letter-spacing: 4px;
    }

    /* ── Stats bar ──────────────────────────────── */
    .stats-bar {
        display: flex;
        justify-content: center;
        gap: 30px;
        padding: 10px 0;
        margin-bottom: 14px;
        border-bottom: 1px solid #eee;
    }
    .stat-item {
        text-align: center;
    }
    .stat-value {
        font-size: 18px;
        font-weight: 800;
        color: #0d1117;
    }
    .stat-label {
        font-size: 9px;
        color: #777;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    /* ── Metadata ───────────────────────────────── */
    .metadata {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-bottom: 14px;
        font-size: 11px;
    }
    .meta-item {
        padding: 6px 10px;
        background: #f7f8fa;
        border-radius: 5px;
        border: 1px solid #e8e8e8;
    }
    .meta-label {
        font-size: 9px;
        color: #777;
        text-transform: uppercase;
        letter-spacing: 0.3px;
    }
    .meta-value {
        font-weight: 700;
        color: #222;
    }

    /* ── Scorers ────────────────────────────────── */
    .scorers {
        text-align: center;
        padding: 6px;
        margin-bottom: 10px;
        font-size: 11px;
        color: #333;
    }

    /* ── Table ──────────────────────────────────── */
    .report-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 12px;
        font-size: 10px;
    }
    .report-table thead th {
        background: #0d1117;
        color: #fff;
        padding: 7px 6px;
        text-align: left;
        font-weight: 700;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        border: 1px solid #0d1117;
    }
    .report-table thead th.center { text-align: center; }
    .report-table tbody tr:nth-child(even) { background: #f7f8fa; }
    .report-table tbody td {
        padding: 5px 6px;
        border: 1px solid #e0e0e0;
        vertical-align: middle;
    }
    .report-table td.num { text-align: center; font-weight: 700; }
    .report-table td.center { text-align: center; }
    .report-table td.shift { text-align: center; font-size: 9px; min-width: 32px; }
    .report-table td.time-cell {
        text-align: right;
        font-weight: 700;
        font-size: 10px;
        color: #0d1117;
    }
    .report-table td.events-cell { font-size: 9px; color: #444; }
    .bench-badge {
        display: inline-block;
        font-size: 7px;
        background: #58a6ff;
        color: #fff;
        padding: 1px 4px;
        border-radius: 3px;
        font-weight: 700;
        margin-left: 4px;
    }
    .half-header {
        background: #2d333b !important;
        text-align: center !important;
        letter-spacing: 0.5px;
    }

    /* ── Legend ─────────────────────────────────── */
    .legend-box {
        margin-top: 8px;
        padding: 8px 12px;
        background: #f7f8fa;
        border: 1px solid #e0e0e0;
        border-radius: 5px;
        font-size: 10px;
    }
    .legend-chip {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 9px;
        font-weight: 700;
        color: #000;
        margin: 2px 4px 2px 0;
    }

    /* ── Footer ─────────────────────────────────── */
    .report-footer {
        margin-top: 20px;
        padding-top: 10px;
        border-top: 1px solid #ddd;
        font-size: 9px;
        color: #999;
        text-align: center;
    }

    /* ── Print helpers ──────────────────────────── */
    @media print {
        body { padding: 0; }
        .no-print { display: none !important; }
    }
</style>
</head>
<body>

<!-- Header -->
<div class="report-header">
    <div>
        <div class="report-title">INFORME DE PARTIDO</div>
        <div class="report-subtitle">Cronos Fútbol — Asistente de Entrenadores</div>
    </div>
    <div class="brand">
        Generado: ${new Date().toLocaleString('es-ES')}<br>
        Ref: CRONOS-${Date.now().toString(36).toUpperCase()}
    </div>
</div>

<!-- Marcador -->
<div class="scoreboard">
    <div class="team-name">${home}</div>
    <div class="score">${scoreH} – ${scoreA}</div>
    <div class="team-name">${away}</div>
</div>

<!-- Estadísticas rápidas -->
<div class="stats-bar">
    <div class="stat-item">
        <div class="stat-value">${players.length}</div>
        <div class="stat-label">Jugadores</div>
    </div>
    <div class="stat-item">
        <div class="stat-value">${totalGoalsH + totalGoalsA}</div>
        <div class="stat-label">Goles</div>
    </div>
    <div class="stat-item">
        <div class="stat-value">${yellowCards}</div>
        <div class="stat-label">Amarillas</div>
    </div>
    <div class="stat-item">
        <div class="stat-value">${redCards}</div>
        <div class="stat-label">Rojas</div>
    </div>
    <div class="stat-item">
        <div class="stat-value">${injuredCount}</div>
        <div class="stat-label">Lesiones</div>
    </div>
    <div class="stat-item">
        <div class="stat-value">${substitutions}</div>
        <div class="stat-label">Cambios</div>
    </div>
</div>

<!-- Metadatos -->
<div class="metadata">
    <div class="meta-item">
        <div class="meta-label">Fecha</div>
        <div class="meta-value">${date}</div>
    </div>
    <div class="meta-item">
        <div class="meta-label">Modo</div>
        <div class="meta-value">${mode || (h1Time !== '—' ? 'Fútbol' : '—')}</div>
    </div>
    <div class="meta-item">
        <div class="meta-label">1ª Parte</div>
        <div class="meta-value">${h1Time}</div>
    </div>
    <div class="meta-item">
        <div class="meta-label">2ª Parte</div>
        <div class="meta-value">${h2Time}</div>
    </div>
    <div class="meta-item">
        <div class="meta-label">Formación</div>
        <div class="meta-value">${form}</div>
    </div>
    <div class="meta-item">
        <div class="meta-label">Titulares ${home}</div>
        <div class="meta-value">${homePlayers.filter(p => p.status === 'field').length}</div>
    </div>
    <div class="meta-item">
        <div class="meta-label">Titulares ${away}</div>
        <div class="meta-value">${awayPlayers.filter(p => p.status === 'field').length}</div>
    </div>
    <div class="meta-item">
        <div class="meta-label">Total Suplentes</div>
        <div class="meta-value">${players.filter(p => p.status === 'bench').length}</div>
    </div>
</div>

<!-- Goleadores -->
<div class="scorers"><strong>Goleadores:</strong> ${scorers}</div>

<!-- Tabla principal -->
<table class="report-table">
<thead>
    <tr>
        <th>Equipo</th>
        <th class="center">Dorsal</th>
        <th>Jugador</th>
        <th class="center">Goles</th>
        <th class="center">Tarjetas</th>
        <th class="center">Lesión</th>
        <th>Eventos</th>
        ${Array.from({length: maxH1}, (_, i) =>
            `<th class="half-header" colspan="2">1ªP Entrada ${i+1} / Salida ${i+1}</th>`
        ).join('')}
        <th class="half-header">Descanso</th>
        ${Array.from({length: maxH2}, (_, i) =>
            `<th class="half-header" colspan="2">2ªP Entrada ${i+1} / Salida ${i+1}</th>`
        ).join('')}
        <th class="center">Tiempo Total</th>
    </tr>
</thead>
<tbody>
    ${playerRows}
</tbody>
</table>

${legendHTML}

<!-- Footer -->
<div class="report-footer">
    Informe generado automáticamente por Cronos Fútbol — Asistente de Entrenadores
</div>

<!-- Botón imprimir (solo en pantalla, no se imprime) -->
<div class="no-print" style="text-align:center;margin-top:20px;">
    <button onclick="window.print()" style="
        padding:10px 30px;
        background:#0d1117;
        color:#fff;
        border:none;
        border-radius:8px;
        font-size:14px;
        font-weight:700;
        cursor:pointer;
    ">Imprimir / Guardar como PDF</button>
</div>

</body>
</html>`;

        // ── Abrir en nueva ventana y lanzar impresión ─────────
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const win  = window.open(url, '_blank', 'width=1100,height=750');

        if (win) {
            win.addEventListener('load', () => {
                setTimeout(() => win.print(), 500);
            });
        } else {
            // Fallback: si bloquean popups, descargar como HTML
            const a = document.createElement('a');
            a.href = url;
            a.download = `informe_${home}_vs_${away}_${Date.now()}.html`;
            a.click();
        }

        // Limpiar URL tras 60s
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
}

// Exponer globalmente
window.ReportGenerator = ReportGenerator;

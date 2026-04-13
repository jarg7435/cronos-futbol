/**
 * Chronos Fútbol - ReportGenerator v8.0
 * Genera informes profesionales en CSV con branding oficial.
 *
 * FIXED: eliminado 'export class' — se usa como script normal (window.ReportGenerator)
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
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `informe_partido_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }).catch(e => console.error('[ReportGenerator] CSV error:', e));
    }

    async generatePDF() {
        console.log('[ReportGenerator] Generando PDF…');
    }
}

// Exponer globalmente
window.ReportGenerator = ReportGenerator;

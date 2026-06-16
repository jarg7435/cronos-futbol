// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — SERVICES/EMAIL WHATSAPP
// Email config, EmailJS, WhatsApp test, sendReportByEmail
// Extraído de app.js (líneas 2151-2227)
// ══════════════════════════════════════════════════════════════════

function loadEmailConfig() {
    const saved = localStorage.getItem('cronos_email_config');
    if (saved) {
        try { emailConfig = { ...emailConfig, ...JSON.parse(saved) }; } catch(e) {}
    }
    initEmailJS();
}

function initEmailJS() {
    if (emailConfig.emailjsPublicKey && typeof emailjs !== 'undefined') {
        emailjs.init(emailConfig.emailjsPublicKey);
        window._emailjsReady = true;
    }
}


function testWhatsApp() {
    loadEmailConfig();
    const num = (document.getElementById('cfg-whatsapp')?.value || emailConfig.whatsappNumber || '').replace(/[^0-9]/g,'');
    if (!num) { alert('Introduce primero el número de WhatsApp.'); return; }
    const msg = encodeURIComponent('✅ Prueba Cronos Fútbol\nSi recibes esto, el envío automático está listo. ⚽');
    window.open('https://wa.me/' + num + '?text=' + msg, '_blank');
}


async function sendReportByEmail(matchInfo, reportHtml) {
    if (!emailConfig.contacts || emailConfig.contacts.length === 0) {
        // Fallback para legacy
        if (!emailConfig.directorEmail) return;
        emailConfig.contacts = [{ name: 'Director', email: emailConfig.directorEmail, tags: ['reports'] }];
    }

    const recipients = emailConfig.contacts.filter(c => c.tags.includes('reports') && c.email);
    if (recipients.length === 0) return;

    if (!emailConfig.emailjsServiceId || !emailConfig.emailjsTemplateId || !emailConfig.emailjsPublicKey) return;

    if (!window._emailjsReady) {
        initEmailJS();
        if (!window._emailjsReady) return;
    }

    const date = new Date().toLocaleDateString('es-ES');
    let successCount = 0;

    for (const contact of recipients) {
        try {
            await emailjs.send(
                emailConfig.emailjsServiceId,
                emailConfig.emailjsTemplateId,
                {
                    to_name:     contact.name,
                    to_email:    contact.email,
                    coach_email: emailConfig.coachEmail || '',
                    subject:     `📊 Informe de Partido — ${matchInfo} — ${date}`,
                    match_info:  matchInfo,
                    report_body: reportHtml
                }
            );
            successCount++;
        } catch(err) {
            console.error(`Error enviando email a ${contact.email}:`, err);
        }
    }

    if (successCount === 0) {
        const toast = document.createElement('div');
        toast.textContent = '⚠️ El informe se descargó, pero no pudo enviarse por email.';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
            'background:#c0392b;color:#fff;padding:10px 20px;border-radius:8px;' +
            'font-size:0.82rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }
}


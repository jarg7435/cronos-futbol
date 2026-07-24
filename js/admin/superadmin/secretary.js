// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/secretary.js
//  Pestaña "Secretaría" — envío de invitaciones por email/WhatsApp
//  (saSecretary, saToggleMethod, saUpdateInviteTemplate,
//  saResetInviteTemplate, saSendInvite, saSendInviteEmail,
//  saSendInviteWhatsApp, _limpiarFormularioSecretaria).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-25. Movimiento puramente
//  mecánico, sin cambios de lógica — depende de helpers ya definidos por
//  superadmin.panel.js (saFS, _saShowSpinner/_saHideSpinner/_saToast),
//  que debe cargarse ANTES que este archivo. Sección más autocontenida
//  hasta ahora: sin llamadas a saTab/saIndividuals/saClubs ni a ninguna
//  otra sección — solo saTab() (en superadmin.panel.js) llama HACIA
//  saSecretary() al cambiar de pestaña.
//  Cubierto por scripts/test_sa_secretary_module.js.
// ════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// saSecretary() — Pestaña de Secretaría
// ═══════════════════════════════════════════════════════════════════

window.saSecretary = async function saSecretary() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = `
    <div style="max-width:600px;">
        <h3 style="margin:0 0 1rem;font-size:1rem;color:white;">✉️ Secretaría</h3>
        <p style="font-size:0.8rem;color:#8b949e;margin:0 0 1.2rem;">
            Envía invitaciones personalizadas a futuros usuarios para registrarse en la plataforma mediante Correo o WhatsApp.
        </p>
        <div style="display:flex;flex-direction:column;gap:0.8rem;">
            <!-- Método de envío -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:6px;">Método de envío</label>
                <div style="display:flex;gap:1.5rem;margin-bottom:4px;">
                    <label style="display:flex;align-items:center;gap:0.45rem;color:white;font-size:0.85rem;cursor:pointer;font-weight:600;">
                        <input type="radio" name="sec-method" value="email" checked onchange="window.saToggleMethod('email')" style="cursor:pointer;width:16px;height:16px;">
                        ✉️ Correo electrónico
                    </label>
                    <label style="display:flex;align-items:center;gap:0.45rem;color:white;font-size:0.85rem;cursor:pointer;font-weight:600;">
                        <input type="radio" name="sec-method" value="whatsapp" onchange="window.saToggleMethod('whatsapp')" style="cursor:pointer;width:16px;height:16px;">
                        💬 WhatsApp
                    </label>
                </div>
            </div>

            <!-- Nombre del destinatario -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del destinatario *</label>
                <input id="sec-name" type="text" placeholder="Ej: José Alberto" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Email de destino -->
            <div id="sec-email-block">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email de destino *</label>
                <input id="sec-email" type="email" placeholder="usuario@email.com" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Teléfono de destino (WhatsApp) -->
            <div id="sec-phone-block" style="display:none;">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Teléfono de destino *</label>
                <input id="sec-phone" type="tel" placeholder="Ej: 34600112233" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
                <span style="font-size:0.68rem;color:#8b949e;margin-top:2px;display:block;">Incluye el código de país (ej. 34 para España) sin el signo + ni espacios.</span>
            </div>

            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Rol asignado</label>
                <select id="sec-role" onchange="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
                    <option value="individual">👤 Entrenador Individual</option>
                    <option value="individual_admin">🛡️ Administrador Individual</option>
                    <option value="club_admin">🏟️ Administrador de Club</option>
                    <option value="user">⚽ Entrenador</option>
                    <option value="parent">👨‍👩‍👧 Padre/Madre/Tutor</option>
                    <option value="director">📋 Director Deportivo</option>
                    <option value="coordinator">🎯 Coordinador</option>
                </select>
            </div>

            <!-- Nombre del Club -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del Club (opcional)</label>
                <input id="sec-club" type="text" placeholder="Nombre del club si aplica" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Asunto (Email) -->
            <div id="sec-subject-block">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Asunto</label>
                <input id="sec-subject" type="text" value="Invitación a Chronos Fútbol"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Mensaje Personalizado -->
            <div>
                <div style="display:flex;justify-content:between;align-items:center;margin-bottom:4px;">
                    <label style="font-size:0.78rem;color:#8b949e;flex:1;">Mensaje predeterminado (puedes modificarlo)</label>
                    <button onclick="window.saResetInviteTemplate()"
                        style="background:none;border:none;color:#58a6ff;font-size:0.68rem;cursor:pointer;font-weight:700;padding:0;">
                        🔄 Restablecer predeterminado
                    </button>
                </div>
                <textarea id="sec-body" rows="6"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;resize:vertical;font-family:Inter,sans-serif;"></textarea>
            </div>

            <!-- Botón de Envío -->
            <button onclick="window.saSendInvite()"
                style="margin-top:0.5rem;padding:0.8rem;background:#58a6ff;border:none;
                       border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                       cursor:pointer;width:100%;display:flex;align-items:center;justify-content:center;gap:0.5rem;">
                <span id="sec-btn-text">✉️ Enviar Invitación por Email</span>
            </button>
        </div>
    </div>`;

    // Inicializar listeners y templates
    setTimeout(() => {
        const secBody = document.getElementById('sec-body');
        if (secBody) {
            secBody.addEventListener('input', () => {
                secBody.classList.add('user-edited');
            });
        }
        window.saUpdateInviteTemplate();
    }, 100);
};

// Alternar entre Email y WhatsApp en la interfaz
window.saToggleMethod = function(method) {
    const emailBlock = document.getElementById('sec-email-block');
    const phoneBlock = document.getElementById('sec-phone-block');
    const subjectBlock = document.getElementById('sec-subject-block');
    const btnText = document.getElementById('sec-btn-text');
    
    if (method === 'email') {
        if (emailBlock) emailBlock.style.display = 'block';
        if (phoneBlock) phoneBlock.style.display = 'none';
        if (subjectBlock) subjectBlock.style.display = 'block';
        if (btnText) btnText.innerHTML = '✉️ Enviar Invitación por Email';
    } else {
        if (emailBlock) emailBlock.style.display = 'none';
        if (phoneBlock) phoneBlock.style.display = 'block';
        if (subjectBlock) subjectBlock.style.display = 'none';
        if (btnText) btnText.innerHTML = '💬 Enviar Invitación por WhatsApp';
    }
    
    const secBody = document.getElementById('sec-body');
    if (secBody && !secBody.classList.contains('user-edited')) {
        window.saUpdateInviteTemplate();
    }
};

// Actualizar en tiempo real el mensaje adaptativo con el nombre y parámetros
window.saUpdateInviteTemplate = function() {
    const name = document.getElementById('sec-name')?.value.trim() || '';
    const roleVal = document.getElementById('sec-role')?.value || 'individual';
    const club = document.getElementById('sec-club')?.value.trim() || '';
    const email = document.getElementById('sec-email')?.value.trim() || '';
    const method = document.querySelector('input[name="sec-method"]:checked')?.value || 'email';
    
    const roleLabels = {
        individual: 'Entrenador Individual',
        club_admin: 'Administrador de Club',
        user: 'Entrenador',
        parent: 'Padre/Madre/Tutor',
        director: 'Director Deportivo',
        coordinator: 'Coordinador'
    };
    const roleLabel = roleLabels[roleVal] || 'Usuario';
    const clubText = club ? (' del club ' + club) : '';
    
    // Construir enlace de invitación que bypassa onboarding (fullscreen=true, invite=true)
    const inviteUrl = 'https://cronos-futbol-app.web.app/?invite=true' + (email ? '&email=' + encodeURIComponent(email) : '');
    
    let defaultText = '';
    if (method === 'email') {
        defaultText = `Hola, ${name || '[Nombre]'}:

Te damos la bienvenida a Chronos Fútbol. Has sido invitado a unirte a nuestra plataforma como ${roleLabel}${clubText}.

Chronos Fútbol es una aplicación innovadora diseñada para transformar la experiencia en el fútbol base, ayudando a que directivas, cuerpos técnicos, familias y profesionales colaboren en un mismo ecosistema para disfrutar al máximo de este deporte.

Te invitamos a formar parte de este proyecto y a descubrir cómo optimizar nuestro día a día. Para acceder directamente a la plataforma (con pantalla completa e instalación automática en tu móvil), haz clic en el siguiente enlace de invitación:

🔗 [ENLACE DE INVITACIÓN - SE AÑADE AUTOMÁTICAMENTE AL ENVIAR]

¡Muchas gracias por tu implicación y bienvenido a bordo!

Atentamente,
El Equipo de Chronos Fútbol`;
    } else {
        defaultText = `⚽ *Invitación a Chronos Fútbol* ⚽

¡Hola, *${name || '[Nombre]'}*! Te invito a unirte a Chronos Fútbol como *${roleLabel}*${club ? ' del club *' + club + '*' : ''}.

Completa tu registro y accede a la app aquí:
${inviteUrl}

¡Un saludo!`;
    }
    
    const secBody = document.getElementById('sec-body');
    if (secBody && !secBody.classList.contains('user-edited')) {
        secBody.value = defaultText;
    }
};

// Restablecer el mensaje al predeterminado de fábrica
window.saResetInviteTemplate = function() {
    const secBody = document.getElementById('sec-body');
    if (secBody) {
        secBody.classList.remove('user-edited');
        window.saUpdateInviteTemplate();
        _saToast('🔄 Mensaje restablecido al predeterminado', 2500);
    }
};

// Enrutador de envío
window.saSendInvite = async function() {
    const method = document.querySelector('input[name="sec-method"]:checked')?.value || 'email';
    const name = document.getElementById('sec-name')?.value.trim();
    if (!name) { _saToast('⚠️ El nombre del destinatario es obligatorio', 3000); return; }
    
    if (method === 'email') {
        await window.saSendInviteEmail();
    } else {
        window.saSendInviteWhatsApp();
    }
};

// Enviar email de invitación vía Cloud Function (con fallback a mailto local)
window.saSendInviteEmail = async function() {
    const name    = document.getElementById('sec-name')?.value.trim() || '';
    const to      = document.getElementById('sec-email')?.value.trim();
    const role    = document.getElementById('sec-role')?.value || 'individual';
    const clubName= document.getElementById('sec-club')?.value.trim() || '';
    const subject = document.getElementById('sec-subject')?.value.trim() || 'Invitación a Chronos Fútbol';
    const body    = document.getElementById('sec-body')?.value.trim() || '';

    if (!to) { _saToast('⚠️ El email de destino es obligatorio', 3000); return; }

    _saShowSpinner('Enviando invitación por email...');
    try {
        const { fa, httpsCallable } = await saFS();
        if (!fa.functions) throw new Error('Firebase Functions no disponible. Recarga la página.');
        const sendEmail = httpsCallable(fa.functions, 'sendInviteEmail');
        const result = await sendEmail({ to, subject, body, role, clubName });
        _saHideSpinner();

        const d = result.data || {};

        if (d.success === true) {
            // ✅ Email enviado correctamente por el servidor
            _saToast('✅ Invitación enviada con éxito a ' + to, 5000);
            _limpiarFormularioSecretaria();
        } else if (d.noCredentials || d.error) {
            // ⚠️ El servidor no tiene credenciales configuradas o Nodemailer falló
            // → Usamos mailto automáticamente sin molestar al usuario con confirm()
            const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            const motivo = d.noCredentials
                ? 'El servidor no tiene credenciales Gmail configuradas.'
                : 'Error del servidor: ' + d.error;
            console.warn('[saSendInviteEmail] Fallback a mailto. Motivo:', motivo);
            _saToast('📧 Abriendo tu correo local para enviar la invitación...', 4000);
            window.open(mailtoUrl, '_self');
            _limpiarFormularioSecretaria();
        } else {
            _saToast('⚠️ Respuesta inesperada del servidor. Revisa la consola.', 4000);
            console.warn('[saSendInviteEmail] Respuesta inesperada:', d);
        }
    } catch (e) {
        _saHideSpinner();
        console.error('[saSendInviteEmail]', e);
        // Fallback a mailto como último recurso
        if (confirm(`⚠️ Error de conexión con el servidor.\n\n¿Abrir tu cliente de correo para enviar la invitación manualmente?`)) {
            const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.open(mailtoUrl, '_self');
            _saToast('📧 Abriendo cliente de correo...', 3000);
            _limpiarFormularioSecretaria();
        }
    }
};

// Helper: limpiar formulario de secretaría tras envío
function _limpiarFormularioSecretaria() {
    const fields = ['sec-email', 'sec-name', 'sec-phone'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const secBody = document.getElementById('sec-body');
    if (secBody) secBody.classList.remove('user-edited');
    window.saUpdateInviteTemplate?.();
}


// Enviar invitación vía WhatsApp Web/App
window.saSendInviteWhatsApp = function() {
    const name  = document.getElementById('sec-name')?.value.trim() || '';
    const phone = document.getElementById('sec-phone')?.value.trim();
    const body  = document.getElementById('sec-body')?.value.trim() || '';

    if (!phone) { _saToast('⚠️ El teléfono de destino es obligatorio', 3000); return; }

    // Limpiar caracteres del número telefónico
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 7) { _saToast('⚠️ El número de teléfono no parece ser válido', 3000); return; }

    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`;
    window.open(waUrl, '_blank');
    _saToast('✅ Abriendo WhatsApp...', 3000);
    
    // Limpiar campos
    document.getElementById('sec-phone').value = '';
    document.getElementById('sec-name').value = '';
    const secBody = document.getElementById('sec-body');
    if (secBody) secBody.classList.remove('user-edited');
    window.saUpdateInviteTemplate();
};

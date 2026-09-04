// ════════════════════════════════════════════════════════════════════
//  ENVÍO DE AVISO DE PAGO — Email + WhatsApp
// ════════════════════════════════════════════════════════════════════

async function saSendPaymentEmail(id, type) {
    // Pila de navegación (js/core/nav-stack.js) — primera sentencia, antes del
    // await (ver la nota en superadmin.panel.js).
    //
    // 🐛 ESTA PANTALLA TENÍA EL "VOLVER" ROTO: llamaba a saTab('payments'), y
    // 'payments' NO ES UNA PESTAÑA. saTab sólo enruta clubs/individuals/
    // requests/secretary/trash/billing/extras/messages, así que ninguna rama
    // se cumplía: no repintaba nada, dejaba el cuerpo del aviso en pantalla y
    // apagaba el subrayado de todas las pestañas. El botón no hacía nada.
    // (La pestaña se llama 'billing'; 'payments' fue un panel legacy que se
    // eliminó en la Fase D del refactor.) Ahora vuelve con navBack().
    if (typeof navScreen === 'function') navScreen('saSendPaymentEmail', id, type);

    const item = await saGet(type === 'club' ? 'clubs' : 'users', id);
    if (!item) return;

    const name      = item.name || item.email || id;
    const adminEmail= item.adminEmail || item.email || '';
    const plan      = PLAN_META[item.plan || 'free'];
    const price     = item.price ? item.price + '€/mes' : 'a convenir';
    const expires   = item.expiresAt
        ? new Date(item.expiresAt).toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })
        : 'sin límite';

    // ── Contenido del email ──────────────────────────────────────
    const subject = encodeURIComponent(
        `Chronos Fútbol — Aviso de renovación · ${name}`
    );

    const body = encodeURIComponent(
`Hola,

Te contacto en relación a tu plan de Chronos Fútbol para el club "${name}".

━━━━━━━━━━━━━━━━━━━━━━━━━━
  DETALLES DEL PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━
  Plan:         ${plan.label}
  Importe:      ${price}
  Vencimiento:  ${expires}

━━━━━━━━━━━━━━━━━━━━━━━━━━
  FORMAS DE PAGO
━━━━━━━━━━━━━━━━━━━━━━━━━━
  📱 Bizum:          ${SA_CONFIG.bizum}
  🏦 Transferencia:  ${SA_CONFIG.iban}

Una vez realizado el pago, envíame el justificante respondiendo a este email.

━━━━━━━━━━━━━━━━━━━━━━━━━━
  CONDICIONES
━━━━━━━━━━━━━━━━━━━━━━━━━━
  • El acceso se mantiene activo hasta la fecha de vencimiento.
  • En caso de impago, el acceso quedará suspendido automáticamente.
  • Al realizar el pago aceptas las condiciones del servicio.

Puedes acceder a la app en: ${SA_CONFIG.appUrl}

Gracias,
${SA_CONFIG.nombre}
${SA_CONFIG.email}
`
    );

    // ── Contenido de WhatsApp ────────────────────────────────────
    const emailUrl = `mailto:${adminEmail}?subject=${subject}&body=${body}`;

    // ── Modal de envío ───────────────────────────────────────────
    const body_el = document.getElementById('sa-body');
    body_el.innerHTML = `
        <div style="max-width:520px;">
            <div style="display:flex;align-items:center;gap:0.7rem;margin-bottom:1.2rem;">
                <button onclick="navBack()" class="sa-btn"
                    style="color:var(--primary);border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.07);">
                    ← Volver</button>
                <h3 style="margin:0;font-size:1rem;">📧 Enviar aviso de pago — ${name}</h3>
            </div>

            <!-- Preview del mensaje -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:10px;padding:1rem;margin-bottom:1.2rem;
                        font-size:0.79rem;color:var(--text-muted);line-height:1.8;
                        white-space:pre-wrap;font-family:monospace;max-height:260px;overflow-y:auto;">
Plan: ${plan.label}
Importe: ${price}
Vencimiento: ${expires}
Destinatario: ${adminEmail || '⚠️ Sin email de admin definido'}

📱 Bizum: ${SA_CONFIG.bizum}
🏦 IBAN: ${SA_CONFIG.iban}
            </div>

            ${SA_CONFIG.bizum === 'TU_NUMERO_BIZUM' ? `
            <div style="background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.4);
                        border-radius:8px;padding:0.7rem 1rem;margin-bottom:1rem;
                        font-size:0.8rem;color:#ffa500;">
                ⚠️ Recuerda rellenar tus datos en <strong>SA_CONFIG</strong> dentro de app.js
                antes de enviar avisos reales.
            </div>` : ''}

            <!-- Botones de envío -->
            <div style="display:flex;flex-direction:column;gap:0.7rem;">

                ${adminEmail ? `
                <a href="${emailUrl}" target="_blank" style="text-decoration:none;">
                    <button class="sa-btn" style="width:100%;padding:0.7rem;
                        color:#58a6ff;border-color:rgba(88,166,255,0.4);
                        background:rgba(88,166,255,0.1);font-weight:700;font-size:0.9rem;
                        cursor:pointer;">
                        📧 Abrir en tu cliente de email
                        <div style="font-size:0.72rem;font-weight:400;color:var(--text-muted);margin-top:0.2rem;">
                            Para: ${adminEmail}
                        </div>
                    </button>
                </a>` : `
                <div style="background:rgba(255,88,88,0.08);border:1px solid rgba(255,88,88,0.3);
                            border-radius:8px;padding:0.7rem 1rem;font-size:0.8rem;color:#ff5858;">
                    ⚠️ Este club no tiene email de administrador definido.
                    Edita el club y añade el email del admin.
                </div>`}

<!-- v671 · fuera el botón "Enviar por WhatsApp" del aviso de pago -->

                <!-- Registrar aviso enviado -->
                <button onclick="saMarkNoticeSent('${id}','${type}')" class="sa-btn"
                    style="padding:0.6rem;color:var(--text-muted);border-color:var(--glass-border);
                           background:var(--glass);font-size:0.83rem;cursor:pointer;">
                    ✅ Marcar como "Aviso enviado"
                </button>
                <div style="font-size:0.74rem;color:var(--text-muted);text-align:center;">
                    Pulsa esto después de enviar el email para registrar la fecha del aviso.
                </div>
            </div>
        </div>`;

    window.saMarkNoticeSent = async (id, type) => {
        const col = type === 'club' ? 'clubs' : 'users';
        await saWrite(col, id, {
            lastNotice: {
                date: new Date().toISOString(),
                sentBy: window._cronosCurrentUser?.email || 'superadmin'
            }
        });
        showToast('✅ Aviso registrado correctamente', 3000);
        // Igual que el botón Volver: saTab('payments') tampoco existía aquí,
        // así que tras registrar el aviso NO pasaba nada y el usuario se
        // quedaba en la pantalla del aviso. Ahora vuelve a la pestaña real.
        if (typeof navBack === 'function') navBack(); else saTab('billing');
    };
}
window.saSendPaymentEmail = saSendPaymentEmail;


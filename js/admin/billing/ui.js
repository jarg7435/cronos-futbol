/**
 * js/24_billing_ui.js
 * Gestión de alertas de facturación y estado de suscripción.
 * Banner persistente para Administradores e Individuales.
 */

'use strict';

window.initBillingUI = async function() {
    const me = window._cronosCurrentUser;
    if (!me) return;

    // Solo mostrar para administradores de club e individuales
    const role = me._activeRole || me.role;
    if (role !== 'club_admin' && role !== 'individual') return;

    // Obtener datos del club/inquilino
    try {
        const { db, doc, getDoc } = await saFS();
        const clubId = me.clubId;
        if (!clubId || clubId === '_sa_preview') return;

        const clubSnap = await getDoc(doc(db, 'clubs', clubId));
        if (!clubSnap.exists()) return;

        const clubData = clubSnap.data();
        const expiresAt = clubData.subscribedUntil || clubData.expiresAt;
        
        if (!expiresAt) return;

        const now = new Date();
        const expDate = new Date(expiresAt);
        const diffMs = expDate - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        // 1. Caso: Expirado
        if (diffDays <= 0) {
            showBillingBanner('❌ Tu suscripción ha caducado. Contacta con el administrador para renovar.', 'danger');
        }
        // 2. Caso: Próximo a expirar (menos de 7 días, persistente informativo)
        else if (diffDays <= 7) {
            showBillingBanner(`⚠️ Tu suscripción vence en ${diffDays} días. Evita interrupciones renovando pronto.`, 'warning');
        }
    } catch (e) {
        console.error('[BillingUI] Error checking subscription:', e);
    }
};

function showBillingBanner(msg, type) {
    // Eliminar banner previo si existe
    const old = document.getElementById('billing-banner');
    if (old) old.remove();

    const banner = document.createElement('div');
    banner.id = 'billing-banner';
    
    const colors = {
        warning: { bg: '#ffa500', text: '#000', border: '#cc8400' },
        danger:  { bg: '#ff5858', text: '#fff', border: '#b91c1c' }
    };
    const c = colors[type] || colors.warning;

    banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: ${c.bg};
        color: ${c.text};
        text-align: center;
        padding: 8px 12px;
        font-size: 0.82rem;
        font-weight: 700;
        z-index: 10000;
        border-bottom: 2px solid ${c.border};
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        font-family: Inter, sans-serif;
    `;

    banner.innerHTML = `
        <span>${msg}</span>
        <button onclick="this.parentElement.remove()" 
                style="background:rgba(0,0,0,0.1); border:none; border-radius:4px; 
                       cursor:pointer; padding:2px 6px; font-size:0.7rem; color:inherit;">✕</button>
    `;

    document.body.appendChild(banner);
    document.body.style.paddingTop = '40px'; // Bajar contenido para que no lo tape el banner
}

// Iniciar cuando el usuario esté listo
window.addEventListener('load', () => {
    // El trigger real debe ser tras el login exitoso, 
    // pero lo dejamos registrado aquí por si acaso.
});

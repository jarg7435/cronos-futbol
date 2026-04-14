// --- CORE FUNCTIONS ---

// ══════════════════════════════════════════════════════════════════
//  SANITIZACIÓN XSS — escapeHtml()
//  Previene inyección de código cuando se usan innerHTML con datos
//  de usuarios (nombres de jugadores, contenido de notificaciones, etc.)
//  Uso: escapeHtml(texto) → devuelve string seguro para innerHTML
// ══════════════════════════════════════════════════════════════════
window.escapeHtml = window.escapeHtml || function(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
    return s.replace(/[&<>"'/]/g, c => map[c]);
};

// ══════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN Y ENVÍO DE EMAIL (EmailJS)
// ══════════════════════════════════════════════════════════════════

// --- CORE FUNCTIONS ---

// ══════════════════════════════════════════════════════════════════
//  UTILIDAD GLOBAL: escapeHtml — previene XSS
//  Convierte caracteres especiales HTML en entidades seguras.
//  Se usa en TODOS los innerHTML que contienen datos de usuario.
// ══════════════════════════════════════════════════════════════════
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
    return s.replace(/[&<>"'/]/g, c => map[c]);
}

// ══════════════════════════════════════════════════════════════════
//  UTILIDAD: escapeAttr — escape seguro para atributos HTML
//  Usa para value="...", onclick="...", data-xxx="..."
// ══════════════════════════════════════════════════════════════════
function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════════════════
//  UTILIDAD: formatTime — formato mm:ss
// ══════════════════════════════════════════════════════════════════
window.miFuncion = window.miFuncion || function(){};

// ══════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN Y ENVÍO DE EMAIL (EmailJS)
// ══════════════════════════════════════════════════════════════════

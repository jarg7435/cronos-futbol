/**
 * accessibility-wcag.js — Mejoras de Accesibilidad WCAG 2.1 AA
 * SPRINT 4 — BLOQUE C: Accesibilidad básica para screen readers
 *
 * Inyecta automáticamente:
 * - ARIA roles (nav, main, section, article)
 * - ARIA labels en botones sin texto
 * - aria-labelledby en secciones
 * - role="button" en elementos clickeables
 * - Soporte para navegación con teclado
 * - Mejoras semánticas HTML
 *
 * Uso:
 *   AccessibilityWCAG.init()  // Se ejecuta automáticamente al cargar
 *   AccessibilityWCAG.enhanceElement(el)  // Mejora un elemento
 *   AccessibilityWCAG.getStats()  // Obtiene estadísticas
 */

const AccessibilityWCAG = (() => {
  'use strict';

  let _initialized = false;
  let _stats = {
    elementsEnhanced: 0,
    ariaLabelsAdded: 0,
    rolesAdded: 0,
    keyboardHandlersAdded: 0
  };

  /**
   * Mapa de aria-labels sugeridos según clases CSS
   */
  const ARIA_LABEL_MAP = {
    // Botones comunes
    'btn-close': 'Cerrar',
    'btn-back': 'Volver',
    'btn-menu': 'Menú',
    'btn-submit': 'Enviar',
    'btn-cancel': 'Cancelar',
    'btn-save': 'Guardar',
    'btn-delete': 'Eliminar',
    'btn-edit': 'Editar',
    'btn-search': 'Buscar',
    'btn-expand': 'Expandir',
    'btn-collapse': 'Contraer',
    'btn-next': 'Siguiente',
    'btn-prev': 'Anterior',
    'btn-copy': 'Copiar',
    'btn-download': 'Descargar',
    'btn-upload': 'Cargar',
    'btn-refresh': 'Actualizar',
    'btn-help': 'Ayuda',
    'btn-info': 'Información',
    'btn-warning': 'Advertencia',
    'btn-success': 'Éxito',
    'btn-error': 'Error',
    // Iconos comunes
    'icon-play': 'Reproducir',
    'icon-pause': 'Pausar',
    'icon-stop': 'Detener',
    'icon-settings': 'Configuración',
    'icon-user': 'Usuario',
    'icon-logout': 'Cerrar sesión',
    'icon-login': 'Iniciar sesión',
    'icon-home': 'Inicio',
    'icon-notifications': 'Notificaciones',
    'icon-messages': 'Mensajes',
  };

  /**
   * Mejora un elemento individual con atributos ARIA
   */
  function enhanceElement(element) {
    if (!element) return;

    // 1. Agregar ARIA label a botones sin texto visible
    if (element.matches('button, [onclick], [role="button"], .btn')) {
      _enhanceButton(element);
    }

    // 2. Agregar roles a elementos contenedores
    if (element.matches('[class*="nav"], [class*="menu"]')) {
      if (!element.hasAttribute('role')) {
        element.setAttribute('role', 'navigation');
        _stats.rolesAdded++;
      }
    }

    if (element.matches('[class*="panel"], [class*="sidebar"], [class*="main"]')) {
      if (!element.hasAttribute('role')) {
        element.setAttribute('role', 'main');
        _stats.rolesAdded++;
      }
    }

    if (element.matches('[class*="section"], [class*="tab"], [class*="card"]')) {
      if (!element.hasAttribute('role') && !element.matches('section, article, aside')) {
        element.setAttribute('role', 'region');
        _stats.rolesAdded++;
      }
    }

    // 3. Mejorar inputs
    if (element.matches('input, textarea, select')) {
      _enhanceFormInput(element);
    }

    // 4. Agregar soporte teclado a elementos clickeables
    if (element.hasAttribute('onclick') && !element.hasAttribute('role')) {
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      _stats.rolesAdded++;

      // Permitir Enter y Space
      if (!element.dataset.keyboardEnhanced) {
        element.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            element.click();
          }
        });
        element.dataset.keyboardEnhanced = 'true';
        _stats.keyboardHandlersAdded++;
      }
    }

    _stats.elementsEnhanced++;
  }

  /**
   * Mejora botones específicamente
   */
  function _enhanceButton(button) {
    const text = button.textContent.trim();
    
    // Si el botón no tiene texto visible, buscar aria-label o icon
    if (!text || text.length === 0) {
      // Buscar clase conocida
      let label = '';
      Object.keys(ARIA_LABEL_MAP).forEach(key => {
        if (button.classList.contains(key)) {
          label = ARIA_LABEL_MAP[key];
        }
      });

      // Buscar en emoji o contenido
      if (!label) {
        const emoji = button.innerHTML.match(/[😀-🙏]/)?.[0] || '';
        if (emoji) label = `Botón ${emoji}`;
      }

      // Buscar en title
      if (!label && button.hasAttribute('title')) {
        label = button.getAttribute('title');
      }

      // Usar clase genérica
      if (!label && button.classList.length > 0) {
        label = `Botón ${button.className.split(' ')[0]}`;
      }

      if (label && !button.hasAttribute('aria-label')) {
        button.setAttribute('aria-label', label);
        _stats.ariaLabelsAdded++;
      }
    }

    // Asegurar que sea accesible con teclado
    if (!button.hasAttribute('tabindex')) {
      button.setAttribute('tabindex', '0');
    }
  }

  /**
   * Mejora inputs de formulario
   */
  function _enhanceFormInput(input) {
    // Si no tiene label asociado, crear uno invisible
    if (!input.id || !document.querySelector(`label[for="${input.id}"]`)) {
      if (input.hasAttribute('placeholder')) {
        const placeholder = input.getAttribute('placeholder');
        if (!input.hasAttribute('aria-label')) {
          input.setAttribute('aria-label', placeholder);
          _stats.ariaLabelsAdded++;
        }
      }
    }

    // Marcar inputs requeridos
    if (input.hasAttribute('required') && !input.hasAttribute('aria-required')) {
      input.setAttribute('aria-required', 'true');
    }
  }

  /**
   * Procesa todo el DOM para mejorar accesibilidad
   */
  function enhanceDocument() {
    // Envolver navegación principal
    document.querySelectorAll('[class*="nav"], [class*="menu"]:not([role])').forEach(nav => {
      if (!nav.hasAttribute('role')) {
        nav.setAttribute('role', 'navigation');
        nav.setAttribute('aria-label', 'Navegación principal');
        _stats.rolesAdded++;
      }
    });

    // Marcar contenido principal
    const mainContent = document.querySelector('main') || 
                       document.querySelector('[class*="main"]') || 
                       document.querySelector('[class*="content"]');
    if (mainContent && !mainContent.hasAttribute('role')) {
      mainContent.setAttribute('role', 'main');
      _stats.rolesAdded++;
    }

    // Mejorar todos los botones
    document.querySelectorAll('button, [onclick], .btn').forEach(btn => {
      _enhanceButton(btn);
    });

    // Mejorar todos los inputs
    document.querySelectorAll('input, textarea, select').forEach(input => {
      _enhanceFormInput(input);
    });

    // Agregar skip to content link (invisible pero accesible)
    _addSkipToContentLink();

    // Mejorar headings semánticos
    _enhanceHeadings();

    console.log('[AccessibilityWCAG] Documento mejorado. Stats:', _stats);
  }

  /**
   * Agrega "Skip to content" link
   */
  function _addSkipToContentLink() {
    if (document.querySelector('[aria-label="Saltar al contenido"]')) return;

    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.textContent = 'Saltar al contenido principal';
    skipLink.setAttribute('aria-label', 'Saltar al contenido');
    skipLink.style.cssText = `
      position: absolute;
      top: -40px;
      left: 0;
      background: #000;
      color: #fff;
      padding: 8px;
      text-decoration: none;
      z-index: 100;
    `;

    skipLink.addEventListener('focus', () => {
      skipLink.style.top = '0';
    });
    skipLink.addEventListener('blur', () => {
      skipLink.style.top = '-40px';
    });

    document.body.prepend(skipLink);
  }

  /**
   * Mejora estructura de headings
   */
  function _enhanceHeadings() {
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="heading"]');
    headings.forEach((h, idx) => {
      if (!h.id) {
        h.id = `heading-${idx}`;
      }
    });
  }

  /**
   * Observador de mutaciones para mejorar elementos nuevos (AJAX)
   */
  function _initMutationObserver() {
    if (!window.MutationObserver) return;

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Element node
              enhanceElement(node);
              node.querySelectorAll('button, input, [onclick]').forEach(el => {
                enhanceElement(el);
              });
            }
          });
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });
  }

  /**
   * Inicializa el módulo
   */
  function init() {
    if (_initialized) return;
    
    // Esperar a que el DOM esté listo
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        enhanceDocument();
        _initMutationObserver();
      });
    } else {
      enhanceDocument();
      _initMutationObserver();
    }

    _initialized = true;
    console.log('[AccessibilityWCAG] Inicializado');
  }

  /**
   * Obtiene estadísticas de mejoras aplicadas
   */
  function getStats() {
    return { ..._ stats };
  }

  // ── API Pública ──
  return {
    init: init,
    enhanceElement: enhanceElement,
    enhanceDocument: enhanceDocument,
    getStats: getStats
  };
})();

// Inicializar automáticamente
AccessibilityWCAG.init();

// Exportar globalmente
window.AccessibilityWCAG = AccessibilityWCAG;

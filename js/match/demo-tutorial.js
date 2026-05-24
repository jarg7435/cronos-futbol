// ══════════════════════════════════════════════════════════════════
//  MODO DEMO
// ══════════════════════════════════════════════════════════════════

function startDemo() {
    if (!confirm('Se cargará un partido de demostración con jugadores de ejemplo.\n\nLos datos actuales NO se modificarán.\n\n¿Continuar?')) return;

    // Configurar modo demo
    currentMode   = 'f11';
    analyzeAway   = false;
    selectedFormationOnStart = '433';

    TEAM_NAMES.home = 'ATLÉTICO';
    TEAM_NAMES.away = 'VISITANTE';
    COLORS.home = { primary: '#58a6ff', secondary: '#f0883e', shorts: '#0a0e14', text: '#ffffff' };
    COLORS.away = { primary: '#ff5858', secondary: '#f0883e', shorts: '#ffffff', text: '#ffffff' };

    document.getElementById('team-a-name').textContent = TEAM_NAMES.home;
    document.getElementById('team-b-name').textContent = TEAM_NAMES.away;
    document.body.classList.remove('hide-visitor');
    document.body.classList.toggle('mode-f11', true);

    half1MaxTime = 45 * 60;
    half2MaxTime = 45 * 60;

    // Jugadores demo
    const demoPlayers = [
        { number:1,  name:'MOLINA',    status:'field' },
        { number:2,  name:'NAHUEL',    status:'field' },
        { number:3,  name:'LE NORMAND',status:'field' },
        { number:4,  name:'WITSEL',    status:'field' },
        { number:5,  name:'REINILDO',  status:'field' },
        { number:6,  name:'KOKE',      status:'field' },
        { number:8,  name:'SAÚL',      status:'field' },
        { number:10, name:'GRIEZMANN', status:'field' },
        { number:7,  name:'CORREA',    status:'field' },
        { number:9,  name:'MORATA',    status:'field' },
        { number:11, name:'LLORENTE',  status:'field' },
        { number:13, name:'OBLAK',     status:'bench' },
        { number:14, name:'HERMOSO',   status:'bench' },
        { number:17, name:'DE PAUL',   status:'bench' },
        { number:19, name:'ÁLVAREZ',   status:'bench' },
        { number:20, name:'BARRIOS',   status:'bench' },
        { number:22, name:'GALLAGHER', status:'bench' },
        { number:23, name:'RIQUELME',  status:'bench' },
    ];

    players = demoPlayers.map((p, i) => ({
        id: i + 1,
        number: p.number,
        name: p.name,
        team: 'home',
        status: p.status,
        time: p.status === 'field' ? Math.floor(Math.random() * 900) : 0,
        color: COLORS.home.primary,
        shortsColor: COLORS.home.shorts,
        textColor: COLORS.home.text,
        history: [], goals: 0, cards: 'ninguna', x: 0, y: 0
    }));

    document.body.classList.remove('setup-mode', 'hide-visitor');
    document.getElementById('main-header').style.display    = 'flex';
    document.getElementById('main-container').style.display = 'flex';
    document.getElementById('setup-modal').style.display    = 'none';

    renderPlayers();
    applyFormationPreset('433');

    // Marcar visualmente que es demo
    const badge = document.createElement('div');
    badge.id = 'demo-badge';
    badge.textContent = '🎮 MODO DEMO';
    badge.style.cssText =
        'position:fixed;top:8px;left:50%;transform:translateX(-50%);' +
        'background:rgba(88,166,255,0.2);border:1px solid rgba(88,166,255,0.5);' +
        'color:#58a6ff;font-size:0.7rem;font-weight:700;padding:3px 12px;' +
        'border-radius:20px;z-index:9998;pointer-events:none;letter-spacing:1px;';
    document.body.appendChild(badge);

    injectBenchScrollButtons('bench-list');
    const pitch = document.getElementById('football-pitch');
    pitch.addEventListener('click',      () => closeDrawers());
    pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });

    // Mostrar toast de bienvenida al demo
    setTimeout(() => {
        const toast = document.createElement('div');
        toast.innerHTML = '🎮 <strong>Modo Demo</strong> — Explora todas las funciones libremente.<br>' +
            '<span style="font-size:0.75rem;opacity:0.8;">Pulsa ← INICIO para volver a la configuración real</span>';
        toast.style.cssText =
            'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);' +
            'background:#0d2137;border:1px solid rgba(88,166,255,0.4);color:#cdd9e5;' +
            'padding:12px 20px;border-radius:10px;font-size:0.82rem;z-index:9999;' +
            'box-shadow:0 4px 16px rgba(0,0,0,0.5);text-align:center;max-width:90vw;';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 6000);
    }, 500);
}

// ══════════════════════════════════════════════════════════════════
//  TUTORIAL INTERACTIVO
// ══════════════════════════════════════════════════════════════════

// TUTORIAL_STEPS y tutorialStep ya declarados en app.js

function startTutorial() {
    tutorialStep = 0;
    renderTutorialStep();
}

function renderTutorialStep() {
    // Eliminar overlay anterior si existe
    const prev = document.getElementById('tutorial-overlay');
    if (prev) prev.remove();

    if (tutorialStep >= TUTORIAL_STEPS.length) {
        // Tutorial completado
        cloudSet('cronos_tutorial_done', '1');
        return;
    }

    const step = TUTORIAL_STEPS[tutorialStep];
    const total = TUTORIAL_STEPS.length;
    const isFirst = tutorialStep === 0;
    const isLast  = tutorialStep === total - 1;

    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;' +
        'display:flex;align-items:center;justify-content:center;padding:1rem;' +
        'backdrop-filter:blur(3px);';

    overlay.innerHTML = `
        <div style="background:#0d1117;border:1px solid rgba(88,166,255,0.4);
                    border-radius:16px;padding:1.8rem;width:min(92vw,440px);
                    box-shadow:0 8px 32px rgba(0,0,0,0.6);">

            <!-- Progreso -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <span style="font-size:0.72rem;color:#7d8590;">
                    Paso ${tutorialStep + 1} de ${total}
                </span>
                <div style="display:flex;gap:4px;">
                    ${Array.from({length: total}, (_, i) =>
                        `<div style="width:${i === tutorialStep ? 18 : 6}px;height:6px;border-radius:3px;
                            background:${i === tutorialStep ? '#58a6ff' : i < tutorialStep ? 'rgba(88,166,255,0.4)' : 'rgba(255,255,255,0.1)'};
                            transition:all 0.3s;"></div>`
                    ).join('')}
                </div>
                <button onclick="closeTutorial()"
                    style="background:none;border:none;color:#7d8590;cursor:pointer;
                           font-size:1.1rem;padding:0;line-height:1;">✕</button>
            </div>

            <!-- Contenido -->
            <h3 style="color:#cdd9e5;font-size:1.1rem;margin:0 0 0.7rem;font-family:'Outfit',sans-serif;">
                ${step.title}
            </h3>
            <p style="color:#7d8590;font-size:0.88rem;line-height:1.6;margin:0 0 1.5rem;">
                ${step.text}
            </p>

            <!-- Botones de navegación -->
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.6rem;">
                <button onclick="tutorialPrev()"
                    style="flex:1;padding:0.65rem;background:var(--glass);border:1px solid var(--glass-border);
                           border-radius:8px;color:#7d8590;cursor:pointer;font-size:0.85rem;
                           ${isFirst ? 'visibility:hidden;' : ''}">
                    ← Anterior
                </button>
                ${isLast
                    ? `<button onclick="closeTutorial()"
                           style="flex:2;padding:0.65rem;background:#58a6ff;border:none;
                                  border-radius:8px;color:#0a0e14;font-weight:700;
                                  cursor:pointer;font-size:0.9rem;">
                           ✅ ¡Listo!
                       </button>`
                    : `<button onclick="tutorialNext()"
                           style="flex:2;padding:0.65rem;background:#58a6ff;border:none;
                                  border-radius:8px;color:#0a0e14;font-weight:700;
                                  cursor:pointer;font-size:0.9rem;">
                           Siguiente →
                       </button>`
                }
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
}

function tutorialNext() {
    tutorialStep++;
    renderTutorialStep();
}

function tutorialPrev() {
    if (tutorialStep > 0) {
        tutorialStep--;
        renderTutorialStep();
    }
}

function closeTutorial() {
    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) overlay.remove();
}


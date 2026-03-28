    // --- PRE-SELECCIÓN DE EQUIPO CARGADO ---
    // Titulares  → borde naranja (--secondary) + badge "T"
    // Suplentes  → borde azul   (--primary)   + badge "S"
    const loadedTeam = window.loadedTeamPlayers?.['home'];
    if (loadedTeam) {
        myPlayers.forEach((p, i) => {
            const savedPlayer = loadedTeam.find(lp => lp.number == p.number);
            if (savedPlayer) {
                const row = document.querySelector(`.conv-row[data-index="${i}"]`);
                if (row) {
                    const isTitular = savedPlayer.status === 'field';
                    const borderColor = isTitular ? 'var(--secondary)' : 'var(--primary)';
                    const bgColor     = isTitular ? 'rgba(240,136,62,0.15)' : 'rgba(88,166,255,0.12)';
                    row.classList.add('conv-selected');
                    row.style.borderColor = borderColor;
                    row.style.background  = bgColor;
                    row.querySelector('.conv-dot').style.background  = borderColor;
                    row.querySelector('.conv-dot').style.borderColor = borderColor;
                    row.querySelector('.conv-dot').style.color = '#0a0e14';
                    row.querySelector('.conv-dot').textContent = isTitular ? 'T' : 'S';
                    // Badge titular/suplente
                    const badge = document.createElement('span');
                    badge.className = 'conv-status-badge';
                    badge.textContent = isTitular ? 'TITULAR' : 'SUP';
                    badge.style.cssText = `font-size:0.55rem;font-weight:bold;padding:2px 5px;
                        border-radius:3px;background:${borderColor};color:#0a0e14;
                        margin-left:auto;flex-shrink:0;`;
                    row.appendChild(badge);
                    selected++;
                }
            }
        });
        countEl.textContent = `${selected}`;
        const isValid = (selected >= minLimit && selected <= maxLimit);
        countEl.style.color = isValid ? 'var(--secondary)' : 'var(--primary)';
        startBtn.disabled = !isValid;
    }

    document.querySelectorAll('.conv-row').forEach(row => {
        row.addEventListener('click', () => {
            const isSelected = row.classList.contains('conv-selected');

            if (!isSelected && selected >= maxLimit) return; // límite máximo alcanzado

            if (isSelected) {
                row.classList.remove('conv-selected');
                row.style.borderColor = 'transparent';
                row.style.background  = 'var(--glass)';
                row.querySelector('.conv-dot').style.background = 'rgba(255,255,255,0.1)';
                row.querySelector('.conv-dot').style.borderColor = 'rgba(255,255,255,0.25)';
                row.querySelector('.conv-dot').style.color = 'transparent';
                row.querySelector('.conv-dot').textContent = '✓';
                // Quitar badge si existe
                const badge = row.querySelector('.conv-status-badge');
                if (badge) badge.remove();
                selected--;
            } else {
                row.classList.add('conv-selected');
                row.style.borderColor = 'var(--primary)';
                row.style.background  = 'rgba(88,166,255,0.12)';
                row.querySelector('.conv-dot').style.background  = 'var(--primary)';
                row.querySelector('.conv-dot').style.borderColor = 'var(--primary)';
                row.querySelector('.conv-dot').style.color = '#0a0e14';
                row.querySelector('.conv-dot').textContent = '✓';
                selected++;
            }

            countEl.textContent = `${selected}`;
            const isValid = (selected >= minLimit && selected <= maxLimit);
            countEl.style.color = isValid ? 'var(--secondary)' : 'var(--primary)';
            startBtn.disabled = !isValid;
        });
    });
}

function startMatchWithConvocation() {
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const rows = document.querySelectorAll('.conv-row.conv-selected');
    const selectedPlayers = Array.from(rows).map(r => myPlayers[r.dataset.index]);
    window.activeConvocation = selectedPlayers.length > 0 ? selectedPlayers : null;

    document.body.classList.remove('setup-mode');
    spawnInitialPlayers();

    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-container').style.display = 'flex';

    renderPlayers();

    // Aplicar formación inicial SOLO si no hay posiciones guardadas de un equipo cargado.
    // Si el equipo fue cargado, sus posiciones (x,y) ya fueron restauradas por spawnInitialPlayers
    // y aplicar la formación las sobreescribiría incorrectamente.
    const hasLoadedPositions = window.loadedTeamPlayers?.['home']?.some(p => p.x || p.y);
    if (selectedFormationOnStart && !hasLoadedPositions) {
        applyFormationPreset(selectedFormationOnStart);
    }
    // Limpiar datos de equipo cargado ya aplicados
    window.loadedTeamPlayers = {};

    // Iniciar transmisión en vivo automáticamente (el director puede conectarse cuando quiera)
    setTimeout(() => startLiveSync(), 800);

    document.getElementById('setup-modal').style.display = 'none';

    // Inyectar botones de scroll en ambos banquillos
    injectBenchScrollButtons('bench-list');
    if (analyzeAway) injectBenchScrollButtons('bench-list-away');
    // Mostrar cuerpo técnico en el banquillo
    renderStaffInBench();

    const pitch = document.getElementById('football-pitch');
    pitch.addEventListener('click', () => closeDrawers());
    pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });
}


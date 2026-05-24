// --- BOTONES DE SCROLL EN BANQUILLO ---
function injectBenchScrollButtons(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const section = container.closest('.bench-section');
    if (!section || section.querySelector('.bench-scroll-btn')) return;

    const STEP = 120; // px por pulsación

    // Botón ▲ arriba
    const btnUp = document.createElement('button');
    btnUp.className = 'bench-scroll-btn';
    btnUp.innerHTML = '▲ subir';
    btnUp.title = 'Scroll arriba';

    // Scroll continuo al mantener pulsado
    let scrollInterval = null;
    const startScroll = (dir) => {
        container.scrollBy({ top: dir * STEP, behavior: 'smooth' });
        scrollInterval = setInterval(() => {
            container.scrollBy({ top: dir * STEP, behavior: 'auto' });
        }, 300);
    };
    const stopScroll = () => clearInterval(scrollInterval);

    btnUp.addEventListener('pointerdown', (e) => { e.preventDefault(); startScroll(-1); });
    btnUp.addEventListener('pointerup',   stopScroll);
    btnUp.addEventListener('pointerleave', stopScroll);
    btnUp.addEventListener('click', () => container.scrollBy({ top: -STEP, behavior: 'smooth' }));

    // Botón ▼ abajo
    const btnDown = document.createElement('button');
    btnDown.className = 'bench-scroll-btn bottom';
    btnDown.innerHTML = '▼ bajar';
    btnDown.title = 'Scroll abajo';

    btnDown.addEventListener('pointerdown', (e) => { e.preventDefault(); startScroll(1); });
    btnDown.addEventListener('pointerup',   stopScroll);
    btnDown.addEventListener('pointerleave', stopScroll);
    btnDown.addEventListener('click', () => container.scrollBy({ top: STEP, behavior: 'smooth' }));

    // Insertar: ▲ antes del container, ▼ después
    section.insertBefore(btnUp, container);
    section.appendChild(btnDown);
}


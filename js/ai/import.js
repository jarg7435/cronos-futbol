// ══════════════════════════════════════════════════════════════════
//  IMPORTACIÓN DE PLANTILLA CON IA (foto → jugadores)
// ══════════════════════════════════════════════════════════════════

function triggerRosterPhoto() {
    const input = document.getElementById('roster-photo-input');
    if (input) input.click();
}

// ── OCR con Tesseract.js (100% local, sin API, sin coste) ───────────
// Carga la librería solo cuando se necesita (lazy load)
// ══════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Importación de plantilla con IA (Gemini Vision)
//  Motor: Google Gemini 1.5 Flash (gratis hasta 1500 imgs/día)
//  Fallback: Tesseract.js (100% local, sin límite)
// ══════════════════════════════════════════════════════════════════

async function processRosterPhoto(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;

    // ── Spinner con barra de progreso ─────────────────────────────
    const modal = document.getElementById('setup-modal');
    const existingContent = modal.querySelector('.modal-content');
    const spinnerOverlay = document.createElement('div');
    spinnerOverlay.id = 'ocr-spinner';
    spinnerOverlay.style.cssText =
        'position:absolute;inset:0;background:rgba(10,14,20,0.92);border-radius:16px;' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'z-index:100;gap:0.9rem;padding:2rem;';
    spinnerOverlay.innerHTML = `
        <div style="font-size:3rem;animation:spin 1.2s linear infinite;">📷</div>
        <p id="ocr-status-title" style="color:#58a6ff;font-weight:700;font-size:1.05rem;margin:0;text-align:center;">
            Analizando imagen con IA…
        </p>
        <p id="ocr-status-sub" style="color:#7d8590;font-size:0.82rem;margin:0;text-align:center;">
            Gemini Vision reconociendo jugadores
        </p>
        <div style="width:240px;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
            <div id="ocr-progress" style="height:100%;width:10%;background:#58a6ff;
                 border-radius:3px;transition:width 0.4s ease;"></div>
        </div>
        <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>`;
    if (existingContent) existingContent.style.position = 'relative';
    existingContent?.appendChild(spinnerOverlay);

    const setStatus = (title, sub, pct) => {
        const t = document.getElementById('ocr-status-title');
        const s = document.getElementById('ocr-status-sub');
        const p = document.getElementById('ocr-progress');
        if (t && title) t.textContent = title;
        if (s && sub)   s.textContent = sub;
        if (p && pct !== undefined) p.style.width = pct + '%';
    };

    try {
        // ── 1. Comprimir imagen ────────────────────────────────────
        setStatus('Preparando imagen…', 'Optimizando para análisis', 15);
        const base64 = await compressImageToBase64(file, 1600, 0.88);

        // ── 2. Intentar Gemini Vision (principal) ─────────────────
        setStatus('Analizando con IA…', 'Gemini Vision reconociendo texto', 35);
        let players = null;
        let engine  = 'gemini';

        try {
            players = await callGeminiVision(base64);
        } catch (geminiErr) {
            console.warn('[OCR] Gemini falló:', geminiErr.message, '→ usando Tesseract fallback');
            setStatus('Cambiando a modo local…', 'Tesseract.js procesando en tu dispositivo', 40);
            engine = 'tesseract';
            players = await callTesseract(base64, setStatus);
        }

        setStatus('Extrayendo jugadores…', `Motor: ${engine === 'gemini' ? 'Gemini IA ✓' : 'Tesseract local ✓'}`, 95);

        if (!players || players.length === 0) {
            throw new Error('No se encontraron jugadores. Prueba con una imagen más nítida y bien iluminada.');
        }

        // ── 3. Actualizar contador (no bloquea) ───────────────────
        updateUsageCounter(engine).catch(() => {});

        spinnerOverlay.remove();
        showRosterPreview(players);

    } catch (err) {
        spinnerOverlay.remove();
        showOCRError(err.message);
    }

    inputEl.value = '';
}

// ── Comprimir imagen a base64 ────────────────────────────────────────
function compressImageToBase64(file, maxPx, quality) {
    return new Promise((res, rej) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > maxPx || h > maxPx) {
                if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
                else       { w = Math.round(w * maxPx / h); h = maxPx; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.filter = 'contrast(1.2) brightness(1.05)'; // mejora legibilidad
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            res(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
        };
        img.onerror = () => rej(new Error('No se pudo procesar la imagen.'));
        img.src = url;
    });
}

// ── Gemini Vision API via Cloudflare Worker ──────────────────────────
async function callGeminiVision(base64) {
    const PROXY = 'https://cronos-prox.jarg7435.workers.dev/gemini';

    const prompt = `Extrae la lista de jugadores de esta imagen. Devuelve SOLO un array JSON sin texto adicional:
[{"number":1,"name":"NOMBRE","surname":"APELLIDOS","alias":"ALIAS"}]
Reglas:
- number: dorsal si aparece, si no 1,2,3...
- name: nombre de pila en MAYÚSCULAS (puede estar vacío)
- surname: apellidos en MAYÚSCULAS (puede estar vacío)
- alias: apodo o primer apellido, NUNCA vacío
- Si solo hay un nombre/apodo por línea: va en alias y surname
- Devuelve ÚNICAMENTE el JSON array, nada más`;

    const response = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, prompt, provider: 'gemini' })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'Error en Gemini API');
    }

    const data = await response.json();
    const text = data.text || '';

    // Extraer JSON de la respuesta
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) throw new Error('Gemini no devolvió JSON válido');

    const players = JSON.parse(match[0]);
    if (!Array.isArray(players) || players.length === 0) {
        throw new Error('No se detectaron jugadores en la imagen');
    }
    return players;
}

// ── Tesseract.js fallback (100% local) ──────────────────────────────
// _tesseractLoaded ya declarado en app.js
async function callTesseract(base64, setStatus) {
    if (!_tesseractLoaded) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
        _tesseractLoaded = true;
    }

    const imgDataUrl = 'data:image/jpeg;base64,' + base64;
    const worker = await Tesseract.createWorker('spa+eng', 1, {
        logger: m => {
            if (m.status === 'recognizing text') {
                const pct = 40 + Math.round(m.progress * 50);
                if (setStatus) setStatus(
                    `Reconociendo… ${Math.round(m.progress * 100)}%`,
                    'Tesseract.js procesando localmente',
                    pct
                );
            }
        }
    });
    const { data } = await worker.recognize(imgDataUrl);
    await worker.terminate();

    const text = data.text || '';
    if (!text.trim()) throw new Error('No se detectó texto en la imagen.');
    return parsePlayersFromText(text);
}

// ── Parser de texto plano → jugadores ───────────────────────────────
function parsePlayersFromText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    const players = [];
    let autoNum = 1;
    const SKIP = /^(nº|num|n\.|número|nombre|apellido|jugador|player|lista|plantilla|equipo|team|pos|posición|#|dorsal)$/i;

    for (const line of lines) {
        if (SKIP.test(line) || /^\d+$/.test(line)) continue;

        let number = null, rest = line;

        const startNum = rest.match(/^[\(\[]?(\d{1,2})[\)\]\s.\-:)]+(.+)/);
        if (startNum) { number = parseInt(startNum[1]); rest = startNum[2].trim(); }
        else {
            const endNum = rest.match(/^(.+?)\s+(\d{1,2})$/);
            if (endNum) { number = parseInt(endNum[2]); rest = endNum[1].trim(); }
        }

        rest = rest.replace(/[|\\/_@\[\]()]/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (rest.length < 2) continue;

        const words = rest.toUpperCase().split(/\s+/).filter(w => w.length > 0);
        if (!words.length) continue;

        let name = '', surname = '', alias = '';
        if (words.length === 1)      { alias = surname = words[0]; }
        else if (words.length === 2) { name = words[0]; surname = words[1]; alias = words[1]; }
        else                         { name = words[0]; surname = words.slice(1).join(' '); alias = words[1]; }

        if (!number) number = autoNum;
        autoNum = number + 1;
        players.push({ number, name, surname, alias: alias || name || surname || String(number) });
    }

    const seen = new Set();
    return players
        .filter(p => { if (seen.has(p.number)) return false; seen.add(p.number); return true; })
        .sort((a, b) => a.number - b.number)
        .slice(0, 30);
}

// ── Contador de uso en Firestore (informativo) ───────────────────────
async function updateUsageCounter(engine) {
    try {
        const db2 = window._cronos_db;
        if (!db2) return;
        const { doc: _doc, getDoc: _getDoc, setDoc: _setDoc } =
            await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const now      = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const ref      = _doc(db2, 'app_stats', 'ocr_usage');
        const snap     = await _getDoc(ref);
        let u = snap.exists() ? snap.data() : { gemini:0, tesseract:0, month: monthKey };
        if (u.month !== monthKey) u = { gemini:0, tesseract:0, month: monthKey };
        u[engine] = (u[engine] || 0) + 1;
        u.month   = monthKey;
        u.lastUsed = now.toISOString();
        await _setDoc(ref, u);
        // Avisos (Gemini: 1500/día gratis → aviso a 1000 y 1300)
        if (engine === 'gemini') {
            if (u.gemini === 1000) showToast('📊 1.000 análisis con Gemini este mes. Perfecto.', 4000);
            if (u.gemini === 1300) showToast('⚠️ 1.300 análisis Gemini/mes. Cerca del límite diario (1.500). Considera ampliar.', 7000);
        }
    } catch(e) { /* no bloquear */ }
}

// ── Toast de error visible ───────────────────────────────────────────
function showOCRError(msg) {
    const toast = document.createElement('div');
    toast.innerHTML = `❌ <strong>No se pudo analizar la imagen</strong><br>
        <span style="font-size:0.78rem;">${typeof escapeHtml==='function'?escapeHtml(msg):msg}</span><br>
        <span style="font-size:0.72rem;color:#ffaaaa;">Consejo: usa buena iluminación y que el texto sea legible</span>`;
    toast.style.cssText =
        'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
        'background:#3d1a1a;border:1px solid #c0392b;color:#ff7b7b;' +
        'padding:14px 22px;border-radius:12px;font-size:0.85rem;' +
        'z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.6);text-align:center;max-width:92vw;line-height:1.5;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
}


function showRosterPreview(players) {
    const mode  = document.getElementById('setup-mode')?.value || 'f11';
    const limit = mode === 'f7' ? 18 : 25;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(95vw,820px); max-height:92vh;
             display:flex; flex-direction:column; overflow:hidden;">

            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                <h2 style="margin:0;">✅ Jugadores detectados</h2>
                <span style="background:rgba(88,166,255,0.15); color:#58a6ff;
                       border:1px solid rgba(88,166,255,0.3); border-radius:20px;
                       padding:3px 12px; font-size:0.78rem; font-weight:700;">
                    ${players.length} jugadores
                </span>
            </div>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.8rem;">
                Revisa y corrige si es necesario antes de cargar en la plantilla.
            </p>

            <!-- Indicación de campos -->
            <div style="background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.2);
                        border-radius:8px;padding:8px 12px;margin-bottom:0.6rem;font-size:0.78rem;color:var(--text-muted);">
                💡 <strong style="color:var(--primary);">Alias</strong> = nombre que aparece en la ficha del jugador durante el partido.
                Revisa que cada jugador tenga un alias claro y corto.
            </div>

            <!-- Tabla editable -->
            <div style="overflow-y:auto; flex:1;">
                <table class="roster-table" style="width:100%;">
                    <thead>
                        <tr>
                            <th style="width:44px;">#</th>
                            <th>Nombre</th>
                            <th>Apellidos</th>
                            <th style="color:var(--primary);">★ Alias (Ficha)</th>
                            <th style="width:36px;"></th>
                        </tr>
                    </thead>
                    <tbody id="preview-tbody">
                        ${players.map((p, i) => `
                            <tr id="preview-row-${i}">
                                <td><input type="number" class="p-num" value="${typeof escapeAttr==='function'?escapeAttr(p.number||i+1):p.number||i+1}"
                                    style="width:44px;"></td>
                                <td><input type="text" class="p-name" value="${typeof escapeAttr==='function'?escapeAttr(p.name):p.name}"></td>
                                <td><input type="text" class="p-surname" value="${typeof escapeAttr==='function'?escapeAttr(p.surname):p.surname}"></td>
                                <td><input type="text" class="p-alias" value="${typeof escapeAttr==='function'?escapeAttr(p.alias):p.alias}"></td>
                                <td>
                                    <button onclick="document.getElementById('preview-row-${i}').remove()"
                                        style="background:none; border:none; color:#ff5858;
                                               cursor:pointer; font-size:1rem; padding:2px 6px;"
                                        title="Eliminar fila">✕</button>
                                </td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>

            <!-- Acciones -->
            <div style="margin-top:0.8rem; padding-top:0.8rem;
                        border-top:1px solid var(--glass-border);
                        display:flex; justify-content:space-between; align-items:center; flex-shrink:0; gap:0.6rem; flex-wrap:wrap;">
                <button class="btn" onclick="openRosterManager()"
                    style="color:var(--text-muted);">
                    ← Volver sin importar
                </button>
                <div style="display:flex; gap:0.6rem;">
                    <button class="btn" onclick="triggerRosterPhoto()"
                        style="background:rgba(240,136,62,0.12); color:var(--secondary);
                               border:1px solid rgba(240,136,62,0.4);">
                        📷 Nueva foto
                    </button>
                    <button class="btn primary" onclick="confirmRosterImport('${mode}')">
                        ✅ CARGAR EN PLANTILLA
                    </button>
                </div>
            </div>
        </div>
        <!-- Input oculto para nueva foto desde preview -->
        <input type="file" id="roster-photo-input" accept="image/*" capture="environment"
            style="display:none;" onchange="processRosterPhoto(this)">
    `;
}

function confirmRosterImport(mode) {
    const rows = document.querySelectorAll('#preview-tbody tr');
    if (rows.length === 0) { alert('No hay jugadores para importar.'); return; }

    const imported = Array.from(rows).map(row => ({
        number:  row.querySelector('.p-num')?.value     || '',
        name:    row.querySelector('.p-name')?.value    || '',
        surname: row.querySelector('.p-surname')?.value || '',
        alias:   row.querySelector('.p-alias')?.value   || ''
    })).filter(p => p.name || p.surname || p.alias);

    // Cargar en la plantilla existente: rellenar desde el principio
    const limit = mode === 'f7' ? 18 : 25;
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');

    // Asegurar que hay suficientes filas
    while (roster[mode].length < limit) {
        roster[mode].push({ number: roster[mode].length + 1, name: '', surname: '', alias: '' });
    }

    // Escribir los jugadores importados
    imported.forEach((p, i) => {
        if (i < limit) {
            const existingId = roster[mode][i]?.id || ('J-' + String(i + 1).padStart(2, '0'));
            roster[mode][i] = {
                id: existingId,
                number:  p.number || (i + 1),
                name:    p.name,
                surname: p.surname,
                alias:   p.alias
            };
        }
    });

    showSpinner('Importando jugadores…');
    setTimeout(() => {
        cloudSet('cronos_master_roster', JSON.stringify(roster));
        hideSpinner();
        showToast('✅ ' + imported.length + ' jugadores importados correctamente');
        openSetupModal();
    }, 400);
}

function saveMasterRoster(mode) {
    showSpinner('Guardando plantilla…');
    setTimeout(() => {
        const rows = document.querySelectorAll('#roster-tbody tr');
        const playersData = Array.from(rows).map(row => {
            const id      = row.querySelector('.r-id')?.value || '';
            const number  = row.querySelector('.r-num').value;
            const name    = (row.querySelector('.r-name').value || '').trim();
            const surname = (row.querySelector('.r-surname').value || '').trim();
            let   alias   = (row.querySelector('.r-alias').value || '').trim();
            // Auto-rellenar alias si está vacío: primer apellido o nombre
            if (!alias && surname) alias = surname.split(' ')[0];
            if (!alias && name)    alias = name.split(' ')[0];
            return { id, number, name, surname, alias };
        });
        const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
        roster[mode] = playersData;
        cloudSet('cronos_master_roster', JSON.stringify(roster));
        saveStaffConfig();
        hideSpinner();
        // Toast en lugar de alert
        showToast('✅ Plantilla y cuerpo técnico guardados');
        openSetupModal();
    }, 300);
}

function openConvocationModal() {
    document.body.classList.add('setup-mode');
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const maxConvoked = currentMode === 'f7' ? 14 : 18;
    const minForMatch = currentMode === 'f7' ? 5 : 7;

    const isMobile = window.innerWidth < 640;
    const cols = isMobile ? 2 : (currentMode === 'f7' ? 3 : 5);
    const maxTitulares = currentMode === 'f7' ? 7 : 11;
    const minTitulares = currentMode === 'f7' ? 5 : 7;

    // Restore saved convocation data
    const savedConv = JSON.parse(localStorage.getItem('cronos_conv_data') || '{}');

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,860px); max-height:94vh; display:flex; flex-direction:column; overflow-y:auto; padding:${isMobile ? '1rem 0.8rem' : '1.5rem'};">

            <div style="flex-shrink:0;">
                <h2 style="margin:0 0 0.1rem; font-size:${isMobile ? '1.1rem' : '1.4rem'};">\u{1F4CB} Convocatoria \u2014 ${TEAM_NAMES.home}</h2>
                <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.6rem;">
                    1\u00ba click: <span style="color:var(--primary);font-weight:700;">Convocado</span> \u00b7 2\u00ba click: <span style="color:#f0883e;font-weight:900;background:rgba(240,136,62,0.15);padding:2px 8px;border-radius:4px;">TITULAR</span> \u00b7 3\u00ba click: Quitar \u00b7 M&iacute;n <span style="color:#f0883e;font-weight:700;">${minForMatch}</span> titulares para partido
                </p>
            </div>

            <!-- \u2500\u2500 DATOS DEL PARTIDO \u2500\u2500 -->
            <div style="background:rgba(88,166,255,0.06); border:1px solid rgba(88,166,255,0.2);
                        border-radius:10px; padding:0.8rem 1rem; margin-bottom:0.8rem;">
                <div style="font-size:0.78rem; font-weight:700; color:var(--primary);
                            margin-bottom:0.5rem; letter-spacing:0.5px;">\u26BD DATOS DEL PARTIDO</div>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:0.5rem;">
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F4C5} Fecha</label>
                        <input type="date" id="conv-date" class="conv-input"
                            value="${savedConv.date || new Date().toISOString().substring(0,10)}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F552} Hora del partido</label>
                        <input type="time" id="conv-time" class="conv-input"
                            value="${savedConv.time || ''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F3DF}\uFE0F Lugar / Campo</label>
                        <input type="text" id="conv-venue" class="conv-input"
                            placeholder="Nombre del campo o direcci\u00f3n"
                            value="${typeof escapeHtml==='function'? escapeHtml(savedConv.venue||''): savedConv.venue||''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F19A} Rival</label>
                        <input type="text" id="conv-rival" class="conv-input"
                            placeholder="Equipo rival"
                            value="${typeof escapeHtml==='function'? escapeHtml(savedConv.rival||TEAM_NAMES.away||''): savedConv.rival||TEAM_NAMES.away||''}">
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F3C6} Tipo de partido</label>
                        <select id="conv-type" class="conv-input">
                            <option value="liga" ${savedConv.type==='liga'?'selected':''}>Liga</option>
                            <option value="copa" ${savedConv.type==='copa'?'selected':''}>Copa</option>
                            <option value="amistoso" ${(savedConv.type||'amistoso')==='amistoso'?'selected':''}>Amistoso</option>
                            <option value="torneo" ${savedConv.type==='torneo'?'selected':''}>Torneo</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.2rem;">\u{1F4DD} Hora presentaci\u00f3n</label>
                        <input type="time" id="conv-meettime" class="conv-input"
                            value="${savedConv.meettime || ''}">
                    </div>
                </div>
            </div>

            <!-- \u2500\u2500 CONTADORES EN TIEMPO REAL \u2500\u2500 -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-bottom:0.8rem;">
                <div id="conv-counter-conv" style="background:rgba(88,166,255,0.1); border:2px solid rgba(88,166,255,0.35);
                            border-radius:10px; padding:0.7rem 1rem; text-align:center;">
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:2px;">Convocados</div>
                    <div id="conv-num-conv" style="font-size:2.2rem; font-weight:900; color:var(--primary); line-height:1;">0</div>
                    <div style="font-size:0.6rem; color:var(--text-muted);">de ${maxConvoked} max</div>
                </div>
                <div id="conv-counter-tit" style="background:rgba(240,136,62,0.1); border:2px solid rgba(240,136,62,0.35);
                            border-radius:10px; padding:0.7rem 1rem; text-align:center;">
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:2px;">Titulares</div>
                    <div id="conv-num-tit" style="font-size:2.2rem; font-weight:900; color:#f0883e; line-height:1;">0</div>
                    <div style="font-size:0.6rem; color:var(--text-muted);">min ${minForMatch} · max ${maxTitulares}</div>
                </div>
            </div>

            <!-- \u2500\u2500 LISTADO DE JUGADORES \u2500\u2500 -->
            <div style="display:grid; grid-template-columns:repeat(${cols}, 1fr); gap:6px; margin-bottom:0.8rem;" id="conv-grid-container">
                ${myPlayers.length > 0 ? myPlayers.map((p, i) => `
                    <div class="conv-row" data-index="${i}" data-state="none"
                        style="background:var(--glass); border:2px solid transparent; border-radius:8px;
                               padding:${isMobile ? '6px 8px' : '8px 10px'}; display:flex; align-items:center; gap:8px;
                               cursor:pointer; transition:all 0.1s; user-select:none;">
                        <span class="conv-dot" style="width:16px;height:16px;border-radius:50%;
                              background:rgba(255,255,255,0.1); border:2px solid rgba(255,255,255,0.25);
                              display:flex;align-items:center;justify-content:center;
                              font-size:0.55rem;flex-shrink:0;color:transparent;">\u2713</span>
                        <span style="font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            <span style="color:var(--primary);font-weight:bold;">${p.number}</span>
                            ${typeof escapeHtml==='function'? escapeHtml(p.alias||p.name||'J'+(i+1)): (p.alias||p.name||'J'+(i+1))}
                        </span>
                        <span class="conv-status-badge" style="font-size:0.5rem;font-weight:bold;padding:2px 5px;
                            border-radius:3px;display:none;margin-left:auto;flex-shrink:0;"></span>
                    </div>
                `).join('') : '<p style="grid-column:1/-1; color:var(--text-muted); font-size:0.8rem; text-align:center; padding:2rem;">No hay jugadores en la plantilla. Ve a GESTIONAR PLANTILLA para a\u00f1adirlos.</p>'}
            </div>

            <!-- \u2500\u2500 BOTONES \u2500\u2500 -->
            <div style="margin-top:auto; padding-top:1rem; border-top:1px solid var(--glass-border);
                        display:flex; flex-direction:column; gap:0.5rem;">

                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div id="conv-count" style="font-size:0.95rem; font-weight:bold; color:var(--primary);">0 convocados · 0 titulares</div>
                    <button class="btn" onclick="openSetupModal()" style="padding:0.4rem 0.8rem; font-size:0.7rem;">\u2190 VOLVER</button>
                </div>

                <div style="display:flex; gap:0.4rem;">
                    <button class="btn" onclick="saveConvData(); saveConvPlayers(); openConvocationMessage('directors')"
                        style="flex:1; background:rgba(88,166,255,0.1); border:1px solid rgba(88,166,255,0.3);
                               color:var(--primary); font-weight:700; font-size:0.72rem;">
                        \u{1F4CB} DIRECTORES
                    </button>
                    <button class="btn" onclick="saveConvData(); saveConvPlayers(); openConvocationMessage('coordinators')"
                        style="flex:1; background:rgba(240,136,62,0.1); border:1px solid rgba(240,136,62,0.3);
                               color:#f0883e; font-weight:700; font-size:0.72rem;">
                        \u{1F3AF} COORDINADORES
                    </button>
                    <button class="btn" onclick="saveConvData(); saveConvPlayers(); openConvocationMessage('parents')"
                        style="flex:1; background:rgba(63,185,80,0.1); border:1px solid rgba(63,185,80,0.3);
                               color:#3fb950; font-weight:700; font-size:0.72rem;">
                        \u{1F468}\u200D\u{1F469}\u200D\u{1F467} PADRES
                    </button>
                </div>

                <button class="btn primary" id="btn-go-titulares" onclick="goToTitularSelection()" disabled
                    style="width:100%; font-weight:900; letter-spacing:1px; padding:0.6rem;">
                    \u26BD IR AL PARTIDO
                </button>
            </div>
        </div>
    `;

    const countEl = document.getElementById('conv-count');
    const goBtn   = document.getElementById('btn-go-titulares');
    const numConvEl = document.getElementById('conv-num-conv');
    const numTitEl  = document.getElementById('conv-num-tit');
    const counterConvBox = document.getElementById('conv-counter-conv');
    const counterTitBox  = document.getElementById('conv-counter-tit');
    let convocados = 0;
    let titulares = 0;
    window._titularSelectionOrder = [];

    // Función auxiliar para actualizar los contadores visuales
    function updateConvCounters() {
        if (numConvEl) numConvEl.textContent = convocados;
        if (numTitEl) numTitEl.textContent = titulares;
        // Color de fondo dinámico según estado
        if (counterConvBox) {
            counterConvBox.style.background = convocados > 0 ? 'rgba(88,166,255,0.2)' : 'rgba(88,166,255,0.1)';
        }
        if (counterTitBox) {
            const isValid = titulares >= minTitulares;
            counterTitBox.style.background = isValid ? 'rgba(240,136,62,0.2)' : 'rgba(240,136,62,0.1)';
            counterTitBox.style.borderColor = isValid ? 'rgba(240,136,62,0.6)' : 'rgba(240,136,62,0.35)';
        }
        // Mantener también el contador de texto plano
        if (countEl) {
            countEl.innerHTML = '<span style="color:var(--primary)">' + convocados + ' convocados</span> \u00b7 <span style="color:#f0883e;font-weight:700;">' + titulares + ' titulares</span>';
        }
        goBtn.disabled = titulares < minTitulares;
    }

    // \u2500\u2500 Pre-restaurar desde equipo cargado \u2500\u2500
    const loadedTeam = window.loadedTeamPlayers?.['home'];
    if (loadedTeam) {
        myPlayers.forEach((p, i) => {
            const savedPlayer = loadedTeam.find(lp => lp.number == p.number);
            const row = document.querySelector(`.conv-row[data-index="${i}"]`);
            if (row && savedPlayer) {
                const isField = savedPlayer.status === 'field';
                row.dataset.state = isField ? 'titular' : 'convocado';
                row.classList.add('conv-selected');
                if (isField) {
                    row.style.borderColor = '#f0883e';
                    row.style.background  = 'rgba(240,136,62,0.25)';
                    row.style.boxShadow = '0 0 12px rgba(240,136,62,0.3)';
                    const dot = row.querySelector('.conv-dot');
                    dot.style.background  = '#f0883e';
                    dot.style.borderColor = '#f0883e';
                    dot.style.color = '#0a0e14';
                    dot.textContent = 'T';
                    dot.style.fontWeight = '900';
                    const badge = row.querySelector('.conv-status-badge');
                    badge.textContent = 'TITULAR';
                    badge.style.background = '#f0883e';
                    badge.style.color = '#0a0e14';
                    badge.style.display = 'inline';
                    badge.style.fontWeight = '900';
                    titulares++;
                    window._titularSelectionOrder.push(i);
                } else {
                    row.style.borderColor = 'var(--primary)';
                    row.style.background  = 'rgba(88,166,255,0.12)';
                    const dot = row.querySelector('.conv-dot');
                    dot.style.background  = 'var(--primary)';
                    dot.style.borderColor = 'var(--primary)';
                    dot.style.color = '#0a0e14';
                    const badge = row.querySelector('.conv-status-badge');
                    badge.textContent = 'CONV';
                    badge.style.background = 'var(--primary)';
                    badge.style.color = '#0a0e14';
                    badge.style.display = 'inline';
                }
                convocados++;
            }
        });
        updateConvCounters();
    }

    // \u2500\u2500 Click handler: 3 estados (none \u2192 convocado \u2192 titular \u2192 none) \u2500\u2500
    document.querySelectorAll('.conv-row').forEach(row => {
        row.addEventListener('click', () => {
            const state = row.dataset.state;
            const dot = row.querySelector('.conv-dot');
            const badge = row.querySelector('.conv-status-badge');

            if (state === 'none') {
                // Estado 1: Seleccionar como CONVOCADO (azul)
                row.dataset.state = 'convocado';
                row.classList.add('conv-selected');
                row.style.borderColor = 'var(--primary)';
                row.style.background  = 'rgba(88,166,255,0.12)';
                dot.style.background  = 'var(--primary)';
                dot.style.borderColor = 'var(--primary)';
                dot.style.color = '#0a0e14';
                dot.textContent = '\u2713';
                badge.textContent = 'CONV';
                badge.style.background = 'var(--primary)';
                badge.style.color = '#0a0e14';
                badge.style.display = 'inline';
                convocados++;
            } else if (state === 'convocado') {
                // Estado 2: Promocionar a TITULAR (naranja)
                if (titulares >= maxTitulares) {
                    showToast('\u26A0\ufe0f M\u00e1ximo ' + maxTitulares + ' titulares', 2500);
                    return;
                }
                row.dataset.state = 'titular';
                row.style.borderColor = '#f0883e';
                row.style.background  = 'rgba(240,136,62,0.25)';
                row.style.boxShadow = '0 0 12px rgba(240,136,62,0.3)';
                dot.style.background  = '#f0883e';
                dot.style.borderColor = '#f0883e';
                dot.style.color = '#0a0e14';
                dot.textContent = 'T';
                dot.style.fontWeight = '900';
                badge.textContent = 'TITULAR';
                badge.style.background = '#f0883e';
                badge.style.color = '#0a0e14';
                badge.style.display = 'inline';
                badge.style.fontWeight = '900';
                titulares++;
                window._titularSelectionOrder.push(parseInt(row.dataset.index));
            } else {
                // Estado 3: Deseleccionar (volver a none)
                row.dataset.state = 'none';
                row.classList.remove('conv-selected');
                row.style.borderColor = 'transparent';
                row.style.background  = 'var(--glass)';
                dot.style.background  = 'rgba(255,255,255,0.1)';
                dot.style.borderColor = 'rgba(255,255,255,0.25)';
                dot.style.color = 'transparent';
                dot.textContent = '\u2713';
                badge.style.display = 'none';
                titulares--;
                convocados--;
                const idx = parseInt(row.dataset.index);
                window._titularSelectionOrder = window._titularSelectionOrder.filter(i => i !== idx);
            }

            updateConvCounters();
        });
    });
}

// \u2500\u2500 Guardar datos de la convocatoria (fecha, hora, lugar, rival, tipo) \u2500\u2500
function saveConvData() {
    const data = {
        date:     document.getElementById('conv-date')?.value     || '',
        time:     document.getElementById('conv-time')?.value     || '',
        venue:    document.getElementById('conv-venue')?.value.trim() || '',
        rival:    document.getElementById('conv-rival')?.value.trim() || '',
        type:     document.getElementById('conv-type')?.value     || 'amistoso',
        meettime: document.getElementById('conv-meettime')?.value || ''
    };
    localStorage.setItem('cronos_conv_data', JSON.stringify(data));
    return data;
}

// ── Guardar jugadores convocados (para el panel de envío) ──
function saveConvPlayers() {
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const convRows = document.querySelectorAll('#conv-grid-container .conv-row[data-state="convocado"], #conv-grid-container .conv-row[data-state="titular"]');
    window._savedConvokedPlayers = Array.from(convRows).map(r => {
        const p = myPlayers[parseInt(r.dataset.index)];
        return p ? { ...p, initialStatus: r.dataset.state === 'titular' ? 'field' : 'bench' } : null;
    }).filter(Boolean);
}

// ── IR AL PARTIDO (desde convocatoria con 3 estados: convocado/titular) ──
function goToTitularSelection() {
    if (typeof window._guardAgainstMatchReset === 'function' && window._guardAgainstMatchReset()) return;
    saveConvData();
    saveConvPlayers();

    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const maxTitulares = currentMode === 'f7' ? 7 : 11;

    // Obtener todos los jugadores seleccionados (convocado o titular)
    const allRows = document.querySelectorAll('#conv-grid-container .conv-row[data-state="convocado"], #conv-grid-container .conv-row[data-state="titular"]');
    const matchPlayers = Array.from(allRows).map(r => {
        const p = myPlayers[parseInt(r.dataset.index)];
        const isTitular = r.dataset.state === 'titular';
        return p ? { 
            ...p, 
            initialStatus: isTitular ? 'field' : 'bench',
            titularOrder: isTitular ? window._titularSelectionOrder.indexOf(parseInt(r.dataset.index)) : 999
        } : null;
    }).filter(Boolean);

    const titularCount = matchPlayers.filter(p => p.initialStatus === 'field').length;

    const minTitulares = currentMode === 'f7' ? 5 : 7;
    const maxConvocados = currentMode === 'f7' ? 14 : 18;
    if (titularCount < minTitulares) {
        alert('Necesitas al menos ' + minTitulares + ' titulares (naranja) para iniciar el partido.\nActualmente tienes ' + titularCount + ' titulares de ' + matchPlayers.length + ' convocados.');
        return;
    }
    if (matchPlayers.length > maxConvocados) {
        alert('Máximo ' + maxConvocados + ' convocados para Fútbol ' + (currentMode === 'f7' ? '7' : '11') + '.\nActualmente tienes ' + matchPlayers.length + ' convocados.\nElimina jugadores de la convocatoria antes de iniciar.');
        return;
    }

    window.activeConvocation = matchPlayers;
    window._convokedPlayers = matchPlayers;

    document.body.classList.remove('setup-mode');
    spawnInitialPlayers();

    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-container').style.display = 'flex';

    // CRÍTICO: Aplicar formación ANTES de renderizar, para que los jugadores
    // tengan posiciones correctas desde el primer render.
    // Si el usuario eligió formación en setup, respetarla aunque el equipo tenga posiciones guardadas.
    if (selectedFormationOnStart) {
        applyFormationPreset(selectedFormationOnStart);
    } else {
        console.warn('[FORMACIÓN] selectedFormationOnStart está vacío — no se aplica formación');
    }
    window.loadedTeamPlayers = {};

    // Renderizar jugadores (las posiciones ya están asignadas por applyFormationPreset)
    renderPlayers();

    // Iniciar transmisi\u00f3n en vivo
    setTimeout(() => startLiveSync(), 800);

    document.getElementById('setup-modal').style.display = 'none';

    // Inyectar botones de scroll en banquillos
    injectBenchScrollButtons('bench-list');
    if (analyzeAway) injectBenchScrollButtons('bench-list-away');
    renderStaffInBench();

    const pitch = document.getElementById('football-pitch');
    pitch.addEventListener('click', () => closeDrawers());
    pitch.addEventListener('touchstart', () => closeDrawers(), { passive: true });
}

// ── INICIAR PARTIDO desde selecci\u00f3n de titulares (compatibilidad) ──
function startMatchFromTitularSelection() {
    goToTitularSelection();
}


function startMatchWithConvocation() {
    if (typeof window._guardAgainstMatchReset === 'function' && window._guardAgainstMatchReset()) return;
    const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
    const myPlayers = roster[currentMode] || [];
    const rows = document.querySelectorAll('.conv-row.conv-selected');
    
    // Guardar selección con el estatus (titular/suplente)
    const selectedPlayers = Array.from(rows).map(r => {
        const p = myPlayers[r.dataset.index];
        return { 
            ...p, 
            initialStatus: r.dataset.status || 'bench' 
        };
    });
    
    window.activeConvocation = selectedPlayers.length > 0 ? selectedPlayers : null;

    // ── FIX (bug: "informes no se envían a nadie") ───────────────────
    // Esta es la versión ACTIVA de startMatchWithConvocation (js/ai/import.js
    // se carga DESPUÉS de js/core/app-init.js, así que eclipsa a su versión).
    // La versión de app-init.js limpiaba los guards de idempotencia de informes
    // al empezar un partido nuevo; ésta NO lo hacía, por lo que tras el 1er
    // partido los guards persistían y saveAllMatchReportsInternal() omitía el
    // despacho de TODOS los partidos siguientes ("no se envían a nadie").
    // Replicamos aquí la limpieza para liberar el despacho en cada partido nuevo.
    try {
        Object.keys(localStorage)
            .filter(k => k.startsWith('cronos_reports_sent_'))
            .forEach(k => localStorage.removeItem(k));
    } catch (_) { /* localStorage no disponible: no bloquea el arranque */ }
    if (typeof liveMatchId !== 'undefined') liveMatchId = null;
    if (typeof liveIsActive !== 'undefined') liveIsActive = false;
    window._cronosLastDispatchedMatch = null;

    document.body.classList.remove('setup-mode');
    spawnInitialPlayers();

    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-container').style.display = 'flex';

    // CRÍTICO: Aplicar formación ANTES de renderizar
    if (selectedFormationOnStart) {
        applyFormationPreset(selectedFormationOnStart);
    }
    // Limpiar datos de equipo cargado ya aplicados
    window.loadedTeamPlayers = {};

    // Renderizar jugadores (las posiciones ya están asignadas por applyFormationPreset)
    renderPlayers();

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

// --- PERSISTENCE ---

function populateSavedTeams(teamKey) {
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    if (!dropdown) return;
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    dropdown.innerHTML = '<option value="">-- Cargar --</option>';
    teams.forEach((team, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = team.name;
        dropdown.appendChild(opt);
    });
}

function loadTeamFromDropdown(teamKey) {
    const dropdown = document.getElementById(`saved-teams-${teamKey}`);
    const index = dropdown.value;
    if (index === "") return;
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const team = teams[index];
    if (team) {
        document.getElementById(`setup-${teamKey}-name`).value = team.name;
        document.getElementById(`setup-${teamKey}-color`).value = team.color;
        document.getElementById(`setup-${teamKey}-shorts`).value = team.shortsColor || '#ffffff';
        document.getElementById(`setup-${teamKey}-text`).value = team.textColor || '#ffffff';

        // Restaurar color secundario si existe
        if (team.secondaryColor) {
            const secEl = document.getElementById(`setup-${teamKey}-secondary`);
            if (secEl) secEl.value = team.secondaryColor;
            // Guardarlo también en COLORS para que esté disponible al iniciar
            if (COLORS[teamKey]) COLORS[teamKey].secondary = team.secondaryColor;
        }

        // Cargar modalidad y formación si están guardadas
        if (team.mode) {
            document.getElementById('setup-mode').value = team.mode;
            updateFormationOptions();
        }
        if (team.formation) {
            document.getElementById('setup-formation').value = team.formation;
        }

        // Guardar los jugadores de este equipo para restaurar convocatoria, titulares y suplentes
        if (!window.loadedTeamPlayers) window.loadedTeamPlayers = {};
        window.loadedTeamPlayers[teamKey] = team.players;
    }
}

function saveCurrentTeam() {
    const choice = prompt("¿Qué equipo quieres guardar?\nEscribe '1' para Local\nEscribe '2' para Visitante");
    if (!choice) return;
    let teamKey = '';
    if (choice === '1' || choice.toLowerCase() === 'local') teamKey = 'home';
    else if (choice === '2' || choice.toLowerCase() === 'visitante') teamKey = 'away';
    else return;

    const teamName = TEAM_NAMES[teamKey];
    // Guardar jugadores: número, nombre, alias, status (titular=field / suplente=bench) y posición en campo
    const currentPlayers = players.filter(p => p.team === teamKey).map(p => ({
        id: p.id,
        number: p.number,
        name: p.name,
        status: p.status,   // 'field' = titular  |  'bench' = suplente
        x: p.x,
        y: p.y
    }));
    const newTeam = {
        name: teamName,
        color: COLORS[teamKey].primary,
        secondaryColor: COLORS[teamKey].secondary,
        shortsColor: COLORS[teamKey].shorts,
        textColor: COLORS[teamKey].text,
        players: currentPlayers,          // convocatoria completa con titulares y suplentes
        mode: currentMode,                // 'f7' o 'f11'
        formation: activeFormationKey     // sistema de juego activo
    };
    const teams = JSON.parse(localStorage.getItem('cronos_teams') || '[]');
    const existingIndex = teams.findIndex(t => t.name === teamName);
    if (existingIndex >= 0) {
        if (confirm(`¿Sobrescribir equipo "${teamName}"?`)) teams[existingIndex] = newTeam;
        else return;
    } else {
        if (teams.length >= 20) { alert('Memoria llena (20 equipos).'); return; }
        teams.push(newTeam);
    }
    showSpinner('Guardando equipo…');
    setTimeout(() => {
        cloudSet('cronos_teams', JSON.stringify(teams));
        const titulares = currentPlayers.filter(p => p.status === 'field').length;
        const suplentes = currentPlayers.filter(p => p.status === 'bench').length;
        const formationDisplay = activeFormationKey ? '1-' + activeFormationKey : 'sin definir';
        hideSpinner();
        showToast('✅ ' + teamName + ' guardado · ' + (currentMode === 'f7' ? 'F7' : 'F11') + ' · ' + formationDisplay + ' · ' + titulares + 'T + ' + suplentes + 'S');
    }, 300);
}

// -- setupEventListeners ELIMINADA (C-19/C-20) -------------------
// Copia obsoleta que existia aqui en js/ai/import.js. La definicion
// canonica vive en js/core/event-listeners.js. Se elimina para que
// no haya redefiniciones globales dependientes del orden de carga.
// -----------------------------------------------------------------

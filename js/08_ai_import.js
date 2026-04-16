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
// NOTA: _tesseractLoaded declarado en app.js

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

// NOTA: openConvocationModal() y startMatchWithConvocation() eliminadas de aquí.
// Las versiones correctas están en app.js — este archivo no debe sobreescribirlas.

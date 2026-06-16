// ══════════════════════════════════════════════════════════════════
//  CAPA DE ALMACENAMIENTO EN LA NUBE (Firestore)
//  Sustituye localStorage de forma transparente.
//  El resto del código no cambia — solo se llaman estas funciones.
// ══════════════════════════════════════════════════════════════════

// ── Referencia al doc de settings del usuario actual ─────────────
function _userRef() {
    const fa  = window._cronos_auth;
    const uid = window._cronosCurrentUser?.uid;
    if (!fa || !uid) return null;
    return fa.doc(fa.db, 'users', uid);
}

// ── Guardar un campo en el subdocumento 'data' del usuario ────────
async function cloudSet(key, value) {
    try {
        const fa  = window._cronos_auth;
        const uid = window._cronosCurrentUser?.uid;
        if (!fa || !uid) {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            return;
        }
        const { setDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await setDoc(
            doc(fa.db, 'users', uid, 'cronos_data', 'main'),
            { [key]: typeof value === 'string' ? value : JSON.stringify(value) },
            { merge: true }
        );
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch(e) {
        console.warn('cloudSet error, usando localStorage:', e.message);
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
}

// ── Leer un campo (primero localStorage como caché, luego Firestore) ─
async function cloudGet(key, defaultValue) {
    const cached = localStorage.getItem(key);
    if (cached !== null) return cached;
    try {
        const fa  = window._cronos_auth;
        const uid = window._cronosCurrentUser?.uid;
        if (!fa || !uid) return defaultValue ?? null;
        const { getDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await getDoc(doc(fa.db, 'users', uid, 'cronos_data', 'main'));
        if (snap.exists()) {
            const val = snap.data()[key];
            if (val !== undefined) {
                localStorage.setItem(key, val);
                return val;
            }
        }
    } catch(e) {
        console.warn('cloudGet error:', e.message);
    }
    return defaultValue ?? null;
}

// ── Sincronización inicial: cargar TODO desde Firestore al entrar ──
async function syncFromCloud() {
    try {
        const fa  = window._cronos_auth;
        const uid = window._cronosCurrentUser?.uid;
        if (!fa || !uid) return;
        const { getDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await getDoc(doc(fa.db, 'users', uid, 'cronos_data', 'main'));
        if (snap.exists()) {
            const data = snap.data();
            Object.entries(data).forEach(([k, v]) => {
                if (k.startsWith('cronos_')) localStorage.setItem(k, v);
            });
        }
    } catch(e) {
        console.warn('syncFromCloud error:', e.message);
    }
}

// _realtimeUnsubscribe ya declarado en app.js

// ── Refrescar UI del partido activo tras sincronización remota ──
function _refreshMatchUI() {
    if (typeof window._cronosSyncCallback === 'function') {
        try {
            window._cronosSyncCallback();
            return;
        } catch (e) {
            console.warn('_cronosSyncCallback error, fallback a refresco por defecto:', e);
        }
    }
    try {
        const raw = localStorage.getItem('cronos_active_match_v2');
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state || !Array.isArray(state.players)) return;
        window.players = state.players;
        if (typeof matchPhase !== 'undefined' && state.matchPhase) matchPhase = state.matchPhase;
        if (typeof renderPlayers === 'function') renderPlayers();
        if (typeof sortBenchUI === 'function') {
            sortBenchUI('home');
            if (window.analyzeAway) sortBenchUI('away');
        }
        const sh = document.getElementById('score-home');
        const sa = document.getElementById('score-away');
        if (sh) sh.textContent = state.scoreHome ?? '0';
        if (sa) sa.textContent = state.scoreAway ?? '0';
    } catch (e) {
        console.warn('Error re-renderizando partido tras sync:', e);
    }
}

async function startRealtimeSync() {
    const fa  = window._cronos_auth;
    const uid = window._cronosCurrentUser?.uid;
    if (!fa || !uid) return;
    if (_realtimeUnsubscribe) { _realtimeUnsubscribe(); _realtimeUnsubscribe = null; }
    try {
        const { onSnapshot, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const docRef = doc(fa.db, 'users', uid, 'cronos_data', 'main');
        _realtimeUnsubscribe = onSnapshot(docRef, (snap) => {
            if (!snap.exists()) return;
            if (snap.metadata.hasPendingWrites) return;
            const data = snap.data();
            let changed = false;
            Object.entries(data).forEach(([k, v]) => {
                if (!k.startsWith('cronos_')) return;
                const current = localStorage.getItem(k);
                if (current !== v) {
                    localStorage.setItem(k, v);
                    changed = true;
                }
            });
            if (changed) {
                const activeMatchChanged = Object.keys(data).some(k => k === 'cronos_active_match_v2');
                if (activeMatchChanged) _refreshMatchUI();
                if (typeof loadEmailConfig === 'function') loadEmailConfig();
                if (typeof loadStaffConfig === 'function') loadStaffConfig();
                const setupModal = document.getElementById('setup-modal');
                if (setupModal && setupModal.style.display !== 'none') {
                    if (typeof populateSavedTeams === 'function') {
                        populateSavedTeams('home');
                        populateSavedTeams('away');
                    }
                }
                if (typeof showToast === 'function') showToast('🔄 Datos actualizados desde otro dispositivo');
            }
        }, (err) => {
            console.warn('Realtime sync error:', err.message);
        });
    } catch(e) {
        console.warn('startRealtimeSync error:', e.message);
    }
}

function stopRealtimeSync() {
    if (_realtimeUnsubscribe) {
        _realtimeUnsubscribe();
        _realtimeUnsubscribe = null;
    }
}

// ── Migración: subir datos locales existentes a Firestore ─────────
async function migrateLocalToCloud() {
    const keys = [
        'cronos_master_roster', 'cronos_teams',
        'cronos_staff', 'cronos_email_config', 'cronos_tutorial_done'
    ];
    const fa  = window._cronos_auth;
    const uid = window._cronosCurrentUser?.uid;
    if (!fa || !uid) return;
    try {
        const { setDoc, doc, getDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await getDoc(doc(fa.db, 'users', uid, 'cronos_data', 'main'));
        if (snap.exists() && snap.data().cronos_master_roster) {
            await syncFromCloud();
            return;
        }
        const payload = {};
        let hasData = false;
        keys.forEach(k => {
            const val = localStorage.getItem(k);
            if (val) { payload[k] = val; hasData = true; }
        });
        if (hasData) {
            await setDoc(
                doc(fa.db, 'users', uid, 'cronos_data', 'main'),
                payload,
                { merge: true }
            );
            showToast('☁️ Datos guardados en la nube');
        }
    } catch(e) {
        console.warn('migrateLocalToCloud error:', e.message);
    }
}

function loadEmailConfig() {
    const saved = localStorage.getItem('cronos_email_config');
    if (saved) {
        try { emailConfig = { ...emailConfig, ...JSON.parse(saved) }; } catch(e) {}
    }
    initEmailJS();
}

function initEmailJS() {
    if (emailConfig.emailjsPublicKey && typeof emailjs !== 'undefined') {
        emailjs.init(emailConfig.emailjsPublicKey);
        window._emailjsReady = true;
    }
}

function saveEmailSettings() {
    emailConfig.whatsappNumber  = (document.getElementById('cfg-whatsapp')?.value  || '').replace(/[^0-9]/g,'');
    emailConfig.whatsappNumber2 = (document.getElementById('cfg-whatsapp2')?.value || '').replace(/[^0-9]/g,'');
    emailConfig.directorEmail   = (document.getElementById('cfg-director-email')?.value  || '').trim();
    emailConfig.directorEmail2  = (document.getElementById('cfg-director-email2')?.value || '').trim();
    cloudSet('cronos_email_config', JSON.stringify(emailConfig));
    const parts = [];
    if (emailConfig.whatsappNumber)  parts.push('📱 WA');
    if (emailConfig.whatsappNumber2) parts.push('📱 WA 2');
    if (emailConfig.directorEmail)   parts.push('📧 Email');
    showToast('✅ ' + (parts.length ? parts.join(' + ') : 'Sin destinatarios configurados'));
    openSetupModal();
}

function testWhatsApp() {
    loadEmailConfig();
    const num = (document.getElementById('cfg-whatsapp')?.value || emailConfig.whatsappNumber || '').replace(/[^0-9]/g,'');
    if (!num) { alert('Introduce primero el número de WhatsApp.'); return; }
    const msg = encodeURIComponent('✅ Prueba Cronos Fútbol\nSi recibes esto, el envío automático está listo. ⚽');
    window.open('https://wa.me/' + num + '?text=' + msg, '_blank');
}

async function sendReportByEmail(matchInfo, reportHtml) {
    if (!emailConfig.contacts || emailConfig.contacts.length === 0) {
        if (!emailConfig.directorEmail) return;
        emailConfig.contacts = [{ name: 'Director', email: emailConfig.directorEmail, tags: ['reports'] }];
    }
    const recipients = emailConfig.contacts.filter(c => c.tags.includes('reports') && c.email);
    if (recipients.length === 0) return;
    if (!emailConfig.emailjsServiceId || !emailConfig.emailjsTemplateId || !emailConfig.emailjsPublicKey) return;
    if (!window._emailjsReady) {
        initEmailJS();
        if (!window._emailjsReady) return;
    }
    const date = new Date().toLocaleDateString('es-ES');
    let successCount = 0;
    for (const contact of recipients) {
        try {
            await emailjs.send(
                emailConfig.emailjsServiceId,
                emailConfig.emailjsTemplateId,
                {
                    to_name:     contact.name,
                    to_email:    contact.email,
                    coach_email: emailConfig.coachEmail || '',
                    subject:     `📊 Informe de Partido — ${matchInfo} — ${date}`,
                    match_info:  matchInfo,
                    report_body: reportHtml
                }
            );
            successCount++;
        } catch(err) {
            console.error(`Error enviando email a ${contact.email}:`, err);
        }
    }
    if (successCount === 0) {
        const toast = document.createElement('div');
        toast.textContent = '⚠️ El informe se descargó, pero no pudo enviarse por email.';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
            'background:#c0392b;color:#fff;padding:10px 20px;border-radius:8px;' +
            'font-size:0.82rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }
}

// NOTA (v76-fix): function init() ELIMINADA — ya existe en app-init.js
// La versión de app-init.js es la correcta (tiene _checkActiveMatch).
// Esta copia sobreescribía la versión correcta por "last-loaded-wins".

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(reg => {
            reg.update().catch(() => {});
            reg.onupdatefound = () => {
                const newWorker = reg.installing;
                newWorker.onstatechange = () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        sessionStorage.setItem('cronos_post_update', '1');
                        const toast = document.createElement('div');
                        toast.innerHTML = '🔄 Actualizando Cronos Fútbol…';
                        toast.style.cssText =
                            'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
                            'background:#1a7a3e;color:#fff;padding:10px 24px;border-radius:8px;' +
                            'font-size:0.88rem;font-weight:bold;z-index:99999;' +
                            'box-shadow:0 4px 16px rgba(0,0,0,0.5);';
                        document.body.appendChild(toast);
                        setTimeout(() => window.location.reload(), 1500);
                    }
                };
            };
        })
        .catch(err => { if (window._CRONOS_DEBUG) console.warn('SW Error:', err); });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    });
}

async function forceUpdate() {
    if (confirm('Esto forzará la descarga de la última versión. ¿Continuar?')) {
        sessionStorage.setItem('cronos_post_update', '1');
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let registration of registrations) await registration.unregister();
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            for (let key of keys) await caches.delete(key);
        }
        window.location.href = window.location.pathname + '?v=' + Date.now();
    }
}

// NOTA (v76-fix): saveSetupState() y restoreSetupState() ELIMINADAS
// — ya existen en setup-modal.js (versión correcta con myTeamRole / _setMyTeamRole).
// Estas copias sobreescribían las correctas por "last-loaded-wins".



// ══════════════════════════════════════════════════════════════════
//  CAPA DE ALMACENAMIENTO EN LA NUBE (Firestore)
//  Sustituye localStorage de forma transparente.
//  El resto del código no cambia — solo se llaman estas funciones.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  PURGA DE PII LOCAL AL CAMBIAR DE USUARIO EN EL MISMO DISPOSITIVO
//  ──────────────────────────────────────────────────────────────────
//  localStorage NO está namespaced por uid. Si un usuario distinto
//  inicia sesión en el mismo navegador, heredaría la caché del anterior
//  (plantillas, jugadores, configs...). Estas funciones purgan TODA
//  clave 'cronos_*' de PII cuando se detecta un cambio de uid (login)
//  o al cerrar sesión (logout), ANTES de que cloudGet/syncFromCloud
//  repueblen la caché desde Firestore (aislado por uid).
// ══════════════════════════════════════════════════════════════════

// Lista blanca COMPARTIDA: claves cronos_* genéricas/seguras por
// dispositivo que NUNCA se purgan (preferencias UI, flags). Reutilizada
// por login (_purgeStaleLocalDataIfNeeded) y logout (_cronosPurgeAllLocalPII).
const _CRONOS_LOCAL_KEEP_KEYS = new Set([
    'cronos_owner_uid',      // marcador de propietario del dispositivo
    'cronos_install_shown',  // timestamp banner PWA (por dispositivo)
    'cronos_live_muted',     // preferencia mute alertas (por dispositivo)
    'cronos_tutorial_done',  // flag tutorial visto (genérico)
    'cronos_post_update',    // flag actualización SW (normalmente sessionStorage)
    // v467 · marca de "hay que borrar la caché de Firestore en el próximo
    // arranque". NO es PII: es una orden pendiente para el dispositivo. Va en
    // la lista blanca porque el barrido corre JUSTO ANTES de dejarla, y una
    // barrida que se la llevara dejaría la caché del usuario anterior sin
    // borrar — que es exactamente lo que la marca viene a garantizar.
    'cronos_pending_cache_clear',
]);
window._CRONOS_LOCAL_KEEP_KEYS = _CRONOS_LOCAL_KEEP_KEYS;

// Barrido interno: elimina toda clave cronos_* salvo la lista blanca.
// Devuelve el array de claves purgadas (para logging). Síncrono.
function _cronosSweepLocalPII() {
    const _purged = [];
    // Copia de claves: removeItem muta el índice de localStorage al iterar.
    const _allKeys = Object.keys(localStorage);
    for (const key of _allKeys) {
        if (!key.startsWith('cronos_')) continue;       // no tocar claves ajenas
        if (_CRONOS_LOCAL_KEEP_KEYS.has(key)) continue; // conservar genéricas
        localStorage.removeItem(key);
        _purged.push(key);
    }
    return _purged;
}

// LOGIN: purga condicional por cambio de uid. Idempotente y SÍNCRONA.
// Debe invocarse tras fijar window._cronosCurrentUser y ANTES de cualquier
// cloudGet/syncFromCloud/_initSprint4Sync del usuario entrante.
function _purgeStaleLocalDataIfNeeded(incomingUid) {
    try {
        if (!incomingUid) {
            console.warn('[Cronos-Privacy] _purgeStaleLocalDataIfNeeded llamado sin uid — omitido.');
            return;
        }
        const ownerUid = localStorage.getItem('cronos_owner_uid');

        // CASO 1: mismo usuario que la última vez → no tocar nada (preserva
        // la caché legítima y la sincronización entre dispositivos del mismo uid).
        if (ownerUid === incomingUid) {
            console.log('[Cronos-Privacy] Mismo usuario en el dispositivo (uid coincide). Sin purga.');
            return;
        }

        // CASO 2: dispositivo SIN marcador previo (ownerUid == null).
        // ───────────────────────────────────────────────────────────────
        // FIX PÉRDIDA DE DATOS: el marcador 'cronos_owner_uid' se introdujo en
        // v199. Cualquier usuario que ya tuviera datos ANTES de v199 (o que
        // limpiara la caché del navegador) no tiene marcador. NO podemos asumir
        // que esos datos son "heredados de otro usuario": lo más probable es que
        // sean del PROPIO usuario que está entrando. Purgarlos aquí provocaba que
        // en CADA actualización de versión el entrenador perdiera plantillas,
        // formaciones, convocatorias y planificaciones de entrenamiento (claves
        // que SOLO viven en localStorage y no se restauran desde Firestore).
        //
        // Comportamiento seguro: ADOPTAR el uid entrante como propietario SIN
        // purgar. Si los datos locales fueran realmente de otro usuario, quedarán
        // sobreescritos de forma natural por syncFromCloud() del usuario entrante
        // (Firestore está aislado por uid). Solo se purga ante un cambio de uid
        // REAL y comprobado (CASO 3).
        if (!ownerUid) {
            localStorage.setItem('cronos_owner_uid', incomingUid);
            console.log(
                '[Cronos-Privacy] Dispositivo sin marcador previo. Se adopta el uid ' +
                'actual como propietario SIN purgar (se preservan los datos locales ' +
                'existentes, que pertenecen al usuario entrante).'
            );
            return;
        }

        // CASO 3: cambio de usuario REAL (ownerUid existe y NO coincide) → purgar PII.
        const _purged = _cronosSweepLocalPII();
        localStorage.setItem('cronos_owner_uid', incomingUid);
        console.log(
            `[Cronos-Privacy] 🔒 Cambio de usuario detectado en el dispositivo. ` +
            `Purgadas ${_purged.length} clave(s) de PII del usuario anterior:`,
            _purged
        );

        // [Cronos-Privacy] La caché EN DISCO de Firestore guarda documentos del
        // usuario ANTERIOR y sus lecturas no pasan por las reglas: hay que
        // borrarla también. No se puede hacer en caliente —borrarla exige
        // terminar la instancia, que este mismo login está usando—, así que se
        // borra y se recarga: el login se rehace con la caché limpia.
        //
        // No hay bucle: el marcador ya se ha actualizado arriba, así que tras
        // la recarga se entra por el CASO 1 (mismo uid) y no se vuelve a pasar
        // por aquí.
        if (typeof window._cronosClearFirestoreCache === 'function') {
            window._cronosClearFirestoreCache().finally(() => location.reload());
        }
    } catch (e) {
        console.warn('[Cronos-Privacy] Error en _purgeStaleLocalDataIfNeeded:', e.message);
    }
}

// LOGOUT: purga incondicional de PII + elimina el marcador, dejando el
// dispositivo limpio para el siguiente usuario (red de seguridad).
function _cronosPurgeAllLocalPII() {
    try {
        const _purged = _cronosSweepLocalPII();
        localStorage.removeItem('cronos_owner_uid');
        console.log(`[Cronos-Privacy] 🔒 Logout: purgadas ${_purged.length} clave(s) de PII + marcador.`, _purged);
    } catch (e) {
        console.warn('[Cronos-Privacy] Error en _cronosPurgeAllLocalPII:', e.message);
    }
}

window._purgeStaleLocalDataIfNeeded = _purgeStaleLocalDataIfNeeded;
window._cronosPurgeAllLocalPII      = _cronosPurgeAllLocalPII;

// ── Referencia al doc de settings del usuario actual ─────────────
function _userRef() {
    const fa  = window._cronos_auth;
    const uid = window._cronosCurrentUser?.uid;
    if (!fa || !uid) return null;
    return fa.doc(fa.db, 'users', uid);
}

// ── Guardar un campo en el subdocumento 'data' del usuario ────────
//
// ⚠️ EL ORDEN DE ESTA FUNCIÓN ES SU CONTRATO. Antes escribía en localStorage
// DESPUÉS de `await setDoc(...)`, y eso perdía datos sin cobertura:
//
//   · `setDoc()` no resuelve cuando la escritura se guarda en local, sino
//     cuando el SERVIDOR la confirma. Sin red se queda pendiente PARA
//     SIEMPRE: no lanza, no entra en el catch, simplemente no sigue.
//   · Con el `localStorage.setItem` detrás de ese await, guardar una
//     plantilla sin cobertura no la guardaba en ningún sitio — y el llamador
//     (team-persistence.js) ya había enseñado "✅ <equipo> guardado".
//   · Esto NO lo arregla la caché persistente de Firestore: la promesa sigue
//     esperando el ACK del servidor haya o no persistencia en disco.
//
// Ahora: (1) local SIEMPRE primero y de forma síncrona, y (2) la escritura en
// la nube se ENTREGA al SDK sin esperar su confirmación. La cola del propio
// SDK la reenvía sola al recuperar la red, que es exactamente lo que hace
// falta; esperarla aquí sólo servía para colgar a quien nos llamara.
async function cloudSet(key, value) {
    const _raw = typeof value === 'string' ? value : JSON.stringify(value);

    // 1. LOCAL PRIMERO. Éxito garantizado y sin depender de la red.
    try {
        localStorage.setItem(key, _raw);
    } catch (e) {
        console.warn('cloudSet: no se pudo escribir en localStorage:', e.message);
    }

    const fa  = window._cronos_auth;
    const uid = window._cronosCurrentUser?.uid;
    if (!fa || !uid) return;

    try {
        const { setDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // 2. Entregar la escritura al SDK SIN esperar el ACK del servidor.
        //    El aviso de permisos se maneja aquí porque el llamador ya no
        //    puede recibirlo: esta función deja de rechazar por ese motivo.
        setDoc(
            doc(fa.db, 'users', uid, 'cronos_data', 'main'),
            { [key]: _raw },
            { merge: true }
        ).catch((err) => {
            const _msg = err && err.message ? err.message : String(err);
            console.warn('cloudSet: la escritura en la nube falló:', _msg);
            if (_msg.includes('permission') && typeof showToast === 'function') {
                showToast('⚠️ Guardado en este dispositivo, pero error de permisos en la nube. Contacta con soporte.', 5000);
            }
        });
    } catch (e) {
        console.warn('cloudSet: no se pudo entregar la escritura a la nube:', e.message);
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
        // v465 · La ranura de ESTA pestaña, nunca "el partido activo" a secas.
        // ⚠️ Esta función REEMPLAZA window.players, matchPhase y el marcador de
        // la pantalla. Leyendo la clave única, una pestaña podía repintarse con
        // el estado del partido que estuviera jugando la OTRA pestaña del mismo
        // entrenador y ponerse a emitir eso. Si esta pestaña no tiene partido
        // propio, no hay nada que refrescar: no se toca nada.
        const S = window._cronosMatchSlots;
        const propio = S && S.getTabMatchId();
        const state = (S && propio) ? S.leer(propio) : null;
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
                // v465 · las ranuras de partido llevan sufijo `::<matchId>`.
                // Nunca deberían llegar por aquí (el estado del partido en
                // curso no se sube a la nube), pero si un documento antiguo
                // las trae, el refresco sigue reconociéndolas.
                const activeMatchChanged = Object.keys(data).some(k => k.indexOf('cronos_active_match_v2') === 0);
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
    const msg = encodeURIComponent('✅ Prueba Chronos Fútbol\nSi recibes esto, el envío automático está listo. ⚽');
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
                        toast.innerHTML = '🔄 Actualizando Chronos Fútbol…';
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



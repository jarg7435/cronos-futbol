// ════════════════════════════════════════════════════════════════════
//  js/coach/comms/training-notify.js
//  Aviso de entrenamiento: modal para componer la notificación
//  (openTrainingNotification) y su envío interno a los contactos con la
//  palomilla "tr" más los seleccionados a mano (_sendTrainingNotification).
//
//  Extraído de js/coach/comms/panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-27, paso 1 de 6 de la
//  descomposición de ese archivo. Movimiento puramente mecánico, sin cambios
//  de lógica.
//
//  ⚠️ NO ES AUTÓNOMO: llama a openUnifiedCommsMenu() tres veces (la X y el
//  botón "Volver" de la modal, y al terminar el envío). Esa función vive HOY
//  en comms/panel.js y en el paso 5 de este refactor se irá a
//  bulk-messaging.js. Funciona igual en ambos casos porque es una function
//  declaration —pasa a ser propiedad de window— y la llamada se resuelve en
//  tiempo de click. Por eso el orden de los <script> es indiferente.
//
//  ACOPLAMIENTO:
//   · Entradas: js/core/app-init.js:2349 y js/coach/training/panel.js, las dos
//     con guarda typeof y en tiempo de click, más el botón "Envío Interno" del
//     HTML que genera esta misma sección. _sendTrainingNotification no tiene
//     ningún consumidor externo.
//   · NO usa _cFS(), el helper Firestore de panel.js: hace su propio import()
//     dinámico de firebase-firestore. Eso lo desacopla del archivo de origen
//     más que a ninguna otra sección.
//   · Depende de sharedBuildRecipientsHTML, sharedGetSelectedRecipients y
//     _cronos_getContactsByFlag, que viven en js/shared/whatsapp-email.js (no
//     en panel.js), y de showToast/showSpinner/hideSpinner y
//     escapeAttr/escapeHtml. Todas se invocan con guarda typeof.
//
//  ⚠️ EL CAMPO userId NO ES REDUNDANTE: el payload de cronos_notifications
//  incluye `userId` ADEMÁS de `parentUid` porque es el campo que verifican las
//  reglas de Firestore (FIX C3). Si alguien lo "simplifica" por parecer
//  duplicado, la escritura empezará a ser rechazada. La aserción 4d del test
//  lo fija.
//
//  Otros comportamientos que fija el test y conviene no romper: los avisos se
//  deduplican por uid entre las dos fuentes (palomilla "tr" y selección
//  manual) mediante un Set compartido; el id de cada documento es
//  tr_<uid>_<timestamp en base36>; y cero destinatarios NO es un error, sino
//  un aviso concreto para que el entrenador active las palomillas ENTR.
//
//  Cubierto por scripts/test_training_notify_module.js.
// ════════════════════════════════════════════════════════════════════

async function openTrainingNotification() {
    // Pila de navegación (js/core/nav-stack.js).
    if (typeof navScreen === 'function') navScreen('openTrainingNotification');

    const me    = window._cronosCurrentUser;
    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    // Quitar setup-mode del body al abrir esta modal — evita el warning
    // de patches.js que detecta setup-mode + partido visible sin modal de setup
    document.body.classList.remove('setup-mode');

    // Pre-cargar caché de contactos con flag 'tr'
    if (typeof window._cronos_getContactsByFlag === 'function' && !window._cronosContactsCache) {
        window._cronos_getContactsByFlag('tr').catch(() => {});
    }

    // Restaurar último entrenamiento enviado
    const saved = JSON.parse(localStorage.getItem('cronos_last_training') || '{}');

    // Auto-rellenar fecha/lugar desde la planificación semanal actual
    const _trOffset = window._trWeekOffset || 0;
    const _trMon = (function() {
        const now = new Date(); const dow = now.getDay();
        const m = new Date(now); m.setDate(now.getDate() - (dow===0?6:dow-1) + _trOffset*7);
        m.setHours(0,0,0,0); return m;
    })();
    const _trWeekKey = _trMon.toISOString().substring(0,10);
    const _trWeekAll = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    const _trWeekData = _trWeekAll[_trWeekKey] || {};
    const _trFirstDs = Object.keys(_trWeekData).sort()[0];
    const _trFirst = _trFirstDs ? (_trWeekData[_trFirstDs] || {}) : {};
    const _autoLoc = _trFirst.lugar || saved.location || '';
    const _autoDt = (_trFirstDs && _trFirst.hora)
        ? (new Date(_trFirstDs + 'T' + _trFirst.hora + ':00').toISOString().slice(0,16))
        : (saved.datetime || '');
    const _autoNotes = saved.notes || '';

    // HTML de destinatarios (igual que convocatoria)
    const recipientsHTML = (typeof window.sharedBuildRecipientsHTML === 'function')
        ? window.sharedBuildRecipientsHTML(saved.recipients, 'tr')
        : '<div style="color:var(--text-muted);font-size:0.78rem;padding:0.5rem;">⏳ Cargando contactos…</div>';

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,560px);max-height:92vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <!-- CABECERA -->
        <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;color:#f0883e;">📅 Aviso de Entrenamiento</h3>
            <button onclick="navExit()" title="Cerrar y salir"
                style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- BODY SCROLL -->
        <div style="flex:1;overflow-y:auto;padding:1rem 1.2rem;">
            <div style="display:grid;gap:0.7rem;">

                <!-- Fecha y hora -->
                <div>
                    <label style="font-size:0.76rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">📅 Fecha y hora</label>
                    <input type="datetime-local" id="tr-datetime"
                        value="${_autoDt}"
                        style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);
                               border:1px solid rgba(255,255,255,0.1);border-radius:8px;
                               color:white;font-size:0.85rem;box-sizing:border-box;">
                </div>

                <!-- Lugar / Campo -->
                <div>
                    <label style="font-size:0.76rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">📍 Lugar / Campo</label>
                    <input type="text" id="tr-location"
                        value="${typeof escapeAttr==='function'?escapeAttr(_autoLoc):_autoLoc}"
                        placeholder="Campo de fútbol…"
                        style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);
                               border:1px solid rgba(255,255,255,0.1);border-radius:8px;
                               color:white;font-size:0.85rem;box-sizing:border-box;">
                </div>

                <!-- Notas -->
                <div>
                    <label style="font-size:0.76rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">📝 Notas adicionales</label>
                    <textarea id="tr-notes" rows="3"
                        placeholder="Cambio de horario, ropa especial, material necesario…"
                        style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);
                               border:1px solid rgba(255,255,255,0.1);border-radius:8px;
                               color:white;font-size:0.85rem;box-sizing:border-box;resize:none;">${typeof escapeHtml==='function'?escapeHtml(_autoNotes):_autoNotes}</textarea>
                </div>

                <!-- DESTINATARIOS — mismo diseño que convocatoria -->
                <div style="background:rgba(240,136,62,0.04);border:1px solid rgba(240,136,62,0.2);
                            border-radius:8px;padding:0.75rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                        <div style="font-size:0.72rem;color:#f0883e;font-weight:700;">📤 ENVIAR A</div>
                        <div style="display:flex;gap:0.3rem;">
                            <button onclick="typeof sharedSelectAll==='function'&&sharedSelectAll(true,'tr')"
                                style="font-size:0.6rem;padding:0.18rem 0.5rem;background:rgba(88,166,255,0.1);
                                       border:1px solid rgba(88,166,255,0.3);border-radius:4px;color:var(--primary);cursor:pointer;">
                                ✓ Todos</button>
                            <button onclick="typeof sharedSelectAll==='function'&&sharedSelectAll(false,'tr')"
                                style="font-size:0.6rem;padding:0.18rem 0.5rem;background:rgba(255,255,255,0.05);
                                       border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--text-muted);cursor:pointer;">
                                ✗ Ninguno</button>
                            <button onclick="typeof sharedSavePreselection==='function'&&sharedSavePreselection('tr')"
                                style="font-size:0.6rem;padding:0.18rem 0.5rem;background:rgba(63,185,80,0.1);
                                       border:1px solid rgba(63,185,80,0.3);border-radius:4px;color:#3fb950;cursor:pointer;">
                                💾 Guardar</button>
                        </div>
                    </div>
                    <div id="tr-recipients-list" style="display:flex;flex-direction:column;gap:0.35rem;max-height:200px;overflow-y:auto;">
                        ${recipientsHTML}
                    </div>
                </div>

            </div>
        </div>

        <!-- FOOTER — igual que convocatoria -->
        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);
                    display:flex;gap:0.5rem;flex-shrink:0;">
            <button onclick="navBack()" class="btn"
                style="color:var(--text-muted);padding:0.5rem 0.9rem;">← Volver</button>
            <button onclick="_sendTrainingNotification()"
                style="flex:1;padding:0.5rem;background:rgba(240,136,62,0.15);
                       border:1px solid rgba(240,136,62,0.4);border-radius:7px;
                       color:#f0883e;font-weight:700;cursor:pointer;font-size:0.85rem;">
                📱 Envío Interno
            </button>
        </div>
    </div>`;
}

window._sendTrainingNotification = async function() {
    const me       = window._cronosCurrentUser;
    const datetime = document.getElementById('tr-datetime')?.value || '';
    const location = document.getElementById('tr-location')?.value.trim() || '';
    const notes    = document.getElementById('tr-notes')?.value.trim() || '';

    if (!datetime && !location) {
        if (typeof showToast === 'function') showToast('⚠️ Indica al menos fecha/hora o lugar', 3000);
        return;
    }

    // Guardar para reutilizar la próxima vez
    const selectedIds = Array.from(document.querySelectorAll('.tr-recipient-chk:checked')).map(c => c.dataset.id);
    localStorage.setItem('cronos_last_training', JSON.stringify({ datetime, location, notes, recipients: selectedIds, savedAt: new Date().toISOString() }));
    localStorage.setItem('cronos_tr_preselection', JSON.stringify(selectedIds));

    if (typeof showSpinner === 'function') showSpinner('Enviando aviso de entrenamiento…');

    try {
        const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const fa = window._cronos_auth;
        const db = fa.db;

        const dtFmt = datetime
            ? new Date(datetime).toLocaleString('es-ES', {weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})
            : '—';

        const notifPayload = (uid) => ({
            type: 'planificacion_semanal', clubId: me.clubId || null,
            userId: uid,                                  // ← FIX (C3): campo que las reglas verifican
            parentUid: uid, coachUid: me.uid, coachEmail: me.email,
            datetime, location, notes,
            createdAt: new Date().toISOString(),
        });

        // Asegurar caché cargada antes de enviar
        if (typeof window._cronos_getContactsByFlag === 'function' && !window._cronosContactsCache) {
            await window._cronos_getContactsByFlag('tr');
        }

        // Fuente de verdad: flag 'tr' + seleccionados manualmente
        let trContacts = [];
        if (typeof window._cronos_getContactsByFlag === 'function') {
            trContacts = await window._cronos_getContactsByFlag('tr');
        }
        const manualSelected = (typeof window.sharedGetSelectedRecipients === 'function')
            ? window.sharedGetSelectedRecipients('tr')
            : [];

        const notifiedUids = new Set();
        let sentInternal = 0;

        for (const c of trContacts) {
            if (!c.uid || notifiedUids.has(c.uid)) continue;
            notifiedUids.add(c.uid);
            await setDoc(doc(db, 'cronos_notifications', 'tr_' + c.uid + '_' + Date.now().toString(36)), notifPayload(c.uid));
            sentInternal++;
        }
        for (const r of manualSelected) {
            // FIX: sharedGetSelectedRecipients ahora incluye uid; usar id como fallback
            const uid = r.uid || r.id;
            if (!uid || notifiedUids.has(uid)) continue;
            notifiedUids.add(uid);
            await setDoc(doc(db, 'cronos_notifications', 'tr_' + uid + '_' + Date.now().toString(36)), notifPayload(uid));
            sentInternal++;
        }

        if (typeof hideSpinner === 'function') hideSpinner();
        const msg = sentInternal > 0
            ? `✅ Entrenamiento enviado a ${sentInternal} persona(s) en la app`
            : '⚠️ 0 destinatarios — activa las palomillas ENTR. en Gestión de Contactos';
        if (typeof showToast === 'function') showToast(msg, 5000);
        openUnifiedCommsMenu();

    } catch(e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        if (typeof showToast  === 'function') showToast('⚠️ Error: ' + e.message, 4000);
        console.error('[TrainingNotif]', e);
    }
};

window.openTrainingNotification = openTrainingNotification;

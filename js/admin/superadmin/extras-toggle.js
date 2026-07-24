// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/extras-toggle.js
//  Extras por club/individual (activar/desactivar funcionalidades).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-24. Movimiento puramente
//  mecánico, sin cambios de lógica. Nombrado 'extras-toggle.js' (no
//  'extras.js') para no chocar con js/admin/superadmin/extras.js, ya
//  existente y sin relación (mejoras del panel SA, no toggles de
//  funcionalidades por club).
//  Cubierto por scripts/test_sa_extras_module.js.
// ════════════════════════════════════════════════════════════════════

window._CRONOS_EXTRAS_DEF = [
    { key: 'plantilla',      icon: '👥', label: 'Gestionar Plantilla',      desc: 'Dar de alta y editar jugadores' },
    { key: 'convocatorias',  icon: '📋', label: 'Crear Convocatorias',      desc: 'Enviar convocatorias a destinatarios' },
    { key: 'entrenamientos', icon: '🏃', label: 'Crear Entrenamientos',     desc: 'Planificación semanal de entrenamientos' },
    { key: 'informes',       icon: '📊', label: 'Recibir Informes',         desc: 'Informes colectivos y de partido' },
    { key: 'comunicaciones', icon: '💬', label: 'Comunicaciones',           desc: 'Mensajes, partidos terminados y retransmisión' },
    { key: 'semaforo',       icon: '🚦', label: 'Semáforo con Porcentajes', desc: 'Sistema de colores y umbrales de tiempos' },
    { key: 'informes_padres',icon: '📧', label: 'Enviar Informes a Padres', desc: 'Informes individuales por jugador enviados a padres' },
    { key: 'actualizaciones', icon: '🔄', label: 'Actualizaciones de la App', desc: 'Permitir recibir actualizaciones automáticas' },
    { key: 'partidos_terminados', icon: '🎬', label: 'Partidos Terminados', desc: 'Ver y reproducir el historial de partidos finalizados (director, coordinador, entrenador)' },
    { key: 'partidos_en_vivo', icon: '🔴', label: 'Partidos en Vivo', desc: 'Ver partidos en vivo del club (director, coordinador, padres, entrenador)' },
];

window.saExtras = async function saExtras() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:2.5rem;color:#8b949e;"><div style="font-size:1.6rem;">⏳</div>Cargando…</div>';
    try {
        const { collection, getDocs, doc, updateDoc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth?.db;
        if (!db) { body.innerHTML = '<div style="color:#ff5858;padding:1rem;">⚠️ Firebase no disponible</div>'; return; }
        
        // Cargar clubes
        const clubsSnap = await getDocs(collection(db, 'clubs'));
        const clubs = [];
        clubsSnap.forEach(d => clubs.push({ id: d.id, ...d.data() }));
        
        // Cargar individuales
        const indSnap = await getDocs(collection(db, 'individuals'));
        const individuals = [];
        indSnap.forEach(d => individuals.push({ id: d.id, ...d.data() }));
        
        const allEntities = [...clubs, ...individuals];
        
        if (!allEntities.length) {
            body.innerHTML = '<div style="text-align:center;padding:3rem;color:#8b949e;">No hay clubes ni individuales dados de alta.</div>';
            return;
        }
        
        let html = '<div style="margin-bottom:1rem;"><h3 style="margin:0;font-size:1rem;color:white;">⚙️ Extras de la Aplicación</h3><p style="font-size:0.78rem;color:#8b949e;margin-top:0.3rem;">Activa o desactiva las funcionalidades extras para cada club o ente individual según el plan contratado.</p></div>';
        
        allEntities.forEach(entity => {
            const extras = entity.extras || {};
            const isClub = clubs.includes(entity);
            const entityName = entity.name || entity.clubName || entity.individualName || entity.id;
            const entityType = isClub ? '🏟️ Club' : '👤 Individual';
            
            const extrasHTML = window._CRONOS_EXTRAS_DEF.map(ext => {
                const enabled = extras[ext.key] !== false; // Por defecto activado
                return '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.7rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:0.4rem;">' +
                    '<div style="display:flex;align-items:center;gap:0.5rem;">' +
                    '<span style="font-size:1.1rem;">' + ext.icon + '</span>' +
                    '<div><div style="font-size:0.8rem;font-weight:600;color:white;">' + ext.label + '</div>' +
                    '<div style="font-size:0.65rem;color:#8b949e;">' + ext.desc + '</div></div>' +
                    '</div>' +
                    '<label style="position:relative;display:inline-block;width:40px;height:22px;cursor:pointer;">' +
                    '<input type="checkbox" class="sa-extra-toggle" data-entity="' + entity.id + '" data-key="' + ext.key + '" ' + (enabled ? 'checked' : '') + ' style="opacity:0;width:0;height:0;">' +
                    '<span style="position:absolute;inset:0;background:' + (enabled ? '#3fb950' : '#555') + ';border-radius:22px;transition:0.3s;"></span>' +
                    '<span style="position:absolute;left:' + (enabled ? '20px' : '3px') + ';top:3px;width:16px;height:16px;background:white;border-radius:50%;transition:0.3s;"></span>' +
                    '</label>' +
                    '</div>';
            }).join('');
            
            html += '<div class="sa-card" style="margin-bottom:0.8rem;border-color:rgba(88,166,255,0.15);">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.8rem;border-bottom:1px solid rgba(255,255,255,0.06);">' +
                '<div style="font-weight:700;font-size:0.88rem;color:white;">' + entityType + ' · ' + entityName + '</div>' +
                '<span style="font-size:0.68rem;color:#8b949e;">' + entity.id.substring(0, 12) + '...</span>' +
                '</div>' +
                '<div style="padding:0.6rem 0.8rem;">' + extrasHTML + '</div>' +
                '</div>';
        });
        
        html += '<button onclick="saSaveExtras()" style="width:100%;padding:0.7rem;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);border-radius:10px;color:#3fb950;font-weight:700;cursor:pointer;font-size:0.88rem;margin-top:0.5rem;">💾 Guardar Cambios</button>';
        
        body.innerHTML = html;
        
        // Animar toggles al cambiar
        body.querySelectorAll('.sa-extra-toggle').forEach(toggle => {
            toggle.addEventListener('change', function() {
                const span1 = this.nextElementSibling;
                const span2 = span1.nextElementSibling;
                span1.style.background = this.checked ? '#3fb950' : '#555';
                span2.style.left = this.checked ? '20px' : '3px';
            });
        });
        
    } catch(e) {
        body.innerHTML = '<div style="color:#ff5858;padding:1rem;">⚠️ Error: ' + e.message + '</div>';
    }
};

window.saSaveExtras = async function saSaveExtras() {
    try {
        const { doc, updateDoc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth?.db;
        if (!db) { if (typeof showToast==='function') showToast('⚠️ Firebase no disponible', 3000); return; }
        const toggles = document.querySelectorAll('.sa-extra-toggle');
        const byEntity = {};
        toggles.forEach(t => {
            const eid = t.dataset.entity;
            const key = t.dataset.key;
            if (!byEntity[eid]) byEntity[eid] = {};
            byEntity[eid][key] = t.checked;
        });
        
        let saved = 0;
        for (const [entityId, extras] of Object.entries(byEntity)) {
            // Intentar actualizar en clubs, luego en individuals
            try {
                await updateDoc(doc(db, 'clubs', entityId), { extras });
                saved++;
            } catch(e1) {
                try {
                    await updateDoc(doc(db, 'individuals', entityId), { extras });
                    saved++;
                } catch(e2) {
                    // Si no existe, crear con setDoc merge
                    try {
                        await setDoc(doc(db, 'clubs', entityId), { extras }, { merge: true });
                        saved++;
                    } catch(e3) {
                        console.warn('[saSaveExtras] Error guardando', entityId, e3.message);
                    }
                }
            }
        }
        
        if (typeof showToast === 'function') showToast('✅ Extras guardados para ' + saved + ' entidad(es)', 3000);
        else alert('✅ Extras guardados para ' + saved + ' entidad(es)');
    } catch(e) {
        if (typeof showToast === 'function') showToast('⚠️ Error: ' + e.message, 4000);
        else alert('⚠️ Error: ' + e.message);
    }
};

// ════════════════════════════════════════════════════════════════════
//  js/directivo/panel.js  ·  🏢 v810 · PANEL DEL DIRECTIVO / EMPLEADO
//
//  Encargo del autor (2026-10-12): un rol «Directivo / Empleado», para
//  clubes y entes individuales, que SÓLO ve «Partidos en Vivo» y, ahí, TODOS
//  los partidos de su entidad a la vez — cualquier categoría, subcategoría y
//  jornada. Decisiones del autor: lo aprueba el administrador del club o del
//  ente (y el SuperAdmin, como a todos); cupo propio `slots.directivos`;
//  nada más que En Vivo; en el visor, el detalle de Dirección.
//
//  🔑 QUÉ VE LO DECIDE EL SERVIDOR, NO ESTA PANTALLA. Las reglas de
//  `live_matches`/`live_index` ya dejan leer a cualquier miembro AUTORIZADO
//  de la entidad (`userDocClubId`), y las de `live_stats` le dejan LEER (no
//  escribir) desde v810. Este panel sólo es la puerta; el visor es el de
//  siempre (live.html), que lo trata como Dirección para la lista y los avisos.
//
//  ⚠️ Respeta el extra `partidos_en_vivo` del club: sin él, la tarjeta se ve
//  bloqueada y diciendo por qué (política del autor desde v429). La propia
//  tarjeta del selector de roles ya sale con candado (CRONOS_ROL_EXTRA).
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const _esc = (s) => (typeof window.escapeHtml === 'function')
        ? window.escapeHtml(String(s == null ? '' : s))
        : String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function _vivoActivo() {
        // Ausente = activo (misma regla que el resto de extras de acceso).
        return (typeof window._cronosExtraEnabled !== 'function') || window._cronosExtraEnabled('partidos_en_vivo');
    }

    function abrirEnVivo() {
        if (!_vivoActivo()) {
            const m = (window.CRONOS_ROL_EXTRA_MOTIVO || {}).partidos_en_vivo
                || 'Partidos en Vivo no está contratado en el plan de tu club.';
            if (typeof window.showToast === 'function') window.showToast('🔒 ' + m, 4500);
            return;
        }
        window.open('./live.html', '_blank');
    }

    async function openDirectivoPanel() {
        const me = window._cronosCurrentUser;
        const rol = me && (me._activeRole || me.role);
        const esSA = !!me && (me.role === 'superadmin' || me.role === 'admin');
        if (!me || (!esSA && rol !== 'directivo')) {
            if (typeof window.showToast === 'function') window.showToast('⛔ Acceso restringido a Directivos / Empleados', 3000);
            return;
        }

        ['main-header', 'main-container', 'auth-screen'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        if (typeof window.navRootScreen === 'function') window.navRootScreen('openDirectivoPanel');

        let clubName = me.clubName || '';
        const fa = window._cronos_auth;
        if (!clubName && fa && me.clubId) {
            try {
                const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                const cs = await getDoc(doc(fa.db, 'clubs_public', me.clubId));
                if (cs.exists()) clubName = cs.data().name || '';
            } catch (e) { /* el nombre es adorno: el panel funciona sin él */ }
        }

        let panel = document.getElementById('directivo-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'directivo-panel';
            document.body.appendChild(panel);
        }
        panel.style.cssText =
            'position:fixed;inset:0;background:#0a0e14;z-index:8000;' +
            'display:flex;flex-direction:column;overflow:hidden;font-family:inherit;';

        const activo = _vivoActivo();
        const motivo = (window.CRONOS_ROL_EXTRA_MOTIVO || {}).partidos_en_vivo
            || 'Partidos en Vivo no está contratado en el plan de tu club.';

        panel.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.6rem;flex-wrap:wrap;' +
                       'padding:0.85rem 1.2rem;border-bottom:1px solid rgba(255,255,255,0.08);' +
                       'background:rgba(10,14,20,0.98);flex-shrink:0;">' +
                '<div style="min-width:0;">' +
                    '<div style="font-size:1rem;font-weight:700;color:white;">🏢 Directivos / Empleados' +
                        (clubName ? '<span style="font-size:0.74rem;color:#7d8590;font-weight:400;margin-left:0.4rem;">· ' + _esc(clubName) + '</span>' : '') +
                    '</div>' +
                    '<div style="font-size:0.71rem;color:#7d8590;margin-top:0.12rem;word-break:break-all;">' + _esc(me.email || '') + '</div>' +
                '</div>' +
                '<div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">' +
                    (typeof window._cronosDevRoleBtn === 'function'
                        ? window._cronosDevRoleBtn("typeof showRoleSelection==='function'&&showRoleSelection()", 'padding:0.35rem 0.8rem;border-radius:6px;font-size:0.74rem;') : '') +
                    (typeof window.cronosBotonContrasena === 'function' ? window.cronosBotonContrasena() : '') +
                    '<button type="button" onclick="typeof logoutUser===\'function\'?logoutUser():typeof cerrarSesion===\'function\'&&cerrarSesion()" ' +
                        'style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);color:#ff5858;' +
                               'padding:0.35rem 0.8rem;border-radius:6px;cursor:pointer;font-size:0.74rem;font-weight:700;">⏻ Salir</button>' +
                '</div>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto;padding:1.2rem 1rem;">' +
                '<div style="max-width:560px;margin:0 auto;">' +
                    '<div style="font-size:0.78rem;color:#7d8590;margin-bottom:0.9rem;line-height:1.5;">' +
                        'Desde aquí sigues en directo <strong style="color:white;">todos los partidos</strong> que está jugando ' +
                        (clubName ? _esc(clubName) : 'tu club') + ' ahora mismo, de cualquier categoría.' +
                    '</div>' +
                    '<button type="button" id="dv-envivo" onclick="window.cronosDirectivoEnVivo()" ' +
                        (activo ? '' : 'aria-disabled="true" title="' + _esc(motivo) + '" ') +
                        'style="width:100%;text-align:left;display:flex;align-items:center;gap:0.9rem;min-height:84px;' +
                               'padding:1.1rem 1.2rem;border-radius:14px;cursor:' + (activo ? 'pointer' : 'not-allowed') + ';' +
                               'background:rgba(255,88,88,0.12);border:1px solid rgba(255,88,88,0.45);color:white;' +
                               (activo ? '' : 'opacity:0.5;filter:grayscale(0.7);') + '">' +
                        '<span style="font-size:2rem;flex-shrink:0;">' + (activo ? '🔴' : '🔒') + '</span>' +
                        '<span style="min-width:0;">' +
                            '<span style="display:block;font-size:1.05rem;font-weight:800;color:#ff5858;">Partidos en Vivo</span>' +
                            '<span style="display:block;font-size:0.78rem;color:#c9d1d9;margin-top:0.2rem;">' +
                                (activo ? 'Todos los partidos que se están jugando ahora mismo.' : _esc(motivo)) +
                            '</span>' +
                        '</span>' +
                    '</button>' +
                '</div>' +
            '</div>';
    }

    window.openDirectivoPanel = openDirectivoPanel;
    window.cronosDirectivoEnVivo = abrirEnVivo;
})();

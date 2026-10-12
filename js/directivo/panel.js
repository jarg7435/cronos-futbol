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
//  🎬 v812 · Y LOS VÍDEOS DE JUGADAS (encargo del autor, capturas 11385-
//  11386): segunda tarjeta, con la misma lógica que el tablero de Dirección —
//  activa si el club tiene el extra `modulo_videos`, bloqueada con el aviso
//  si no—. Decisión del autor: los VE como el cuerpo técnico (todas las
//  categorías, también menores), pero no los sube ni los borra. Lo que de
//  verdad lo decide son las reglas (firestore.rules · cronos_clips y
//  storage.rules), no esta pantalla.
//
//  🔑 QUÉ VE LO DECIDE EL SERVIDOR, NO ESTA PANTALLA. Las reglas de
//  `live_matches`/`live_index` le dejan leer por `esDirectivoDe` (v810), y
//  las de `live_stats` sólo LEER. Este panel sólo es la puerta; el visor es
//  el de siempre (live.html), que lo trata como Dirección para la lista y los
//  avisos.
//
//  ⚠️ Respeta los extras del club: sin ellos, la tarjeta se ve bloqueada y
//  diciendo por qué (política del autor desde v429).
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const _esc = (s) => (typeof window.escapeHtml === 'function')
        ? window.escapeHtml(String(s == null ? '' : s))
        : String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const MOTIVO_VIVO = () => (window.CRONOS_ROL_EXTRA_MOTIVO || {}).partidos_en_vivo
        || 'Partidos en Vivo no está contratado en el plan de tu club.';
    // El mismo texto que el tablero de Dirección (club-reports.js).
    const MOTIVO_VIDEOS = 'Extra no activado para tu club. Habla con el administrador.';

    function _vivoActivo() {
        // Ausente = activo (misma regla que el resto de extras de acceso).
        return (typeof window._cronosExtraEnabled !== 'function') || window._cronosExtraEnabled('partidos_en_vivo');
    }
    function _videosActivo() {
        // Ausente = APAGADO (extra `modulo_videos`, v804): lo decide el módulo.
        return !!(window.CronosClips && window.CronosClips.activo(window._cronosCurrentUser));
    }

    function abrirEnVivo() {
        if (!_vivoActivo()) {
            if (typeof window.showToast === 'function') window.showToast('🔒 ' + MOTIVO_VIVO(), 4500);
            return;
        }
        window.open('./live.html', '_blank');
    }
    function abrirVideos() {
        if (!_videosActivo()) {
            if (typeof window.showToast === 'function') window.showToast('🔒 ' + MOTIVO_VIDEOS, 4500);
            return;
        }
        window.CronosClips.abrirLista();
    }

    // Una tarjeta grande, apta para el dedo; con candado y motivo si no está activa.
    function _tarjeta(t) {
        return '<button type="button" id="' + t.id + '" onclick="' + t.onclick + '" ' +
                (t.activo ? '' : 'aria-disabled="true" title="' + _esc(t.motivo) + '" ') +
                'style="width:100%;text-align:left;display:flex;align-items:center;gap:0.9rem;min-height:84px;' +
                       'padding:1.1rem 1.2rem;border-radius:14px;margin-bottom:0.8rem;cursor:' + (t.activo ? 'pointer' : 'not-allowed') + ';' +
                       'background:' + t.fondo + ';border:1px solid ' + t.borde + ';color:white;' +
                       (t.activo ? '' : 'opacity:0.5;filter:grayscale(0.7);') + '">' +
                '<span style="font-size:2rem;flex-shrink:0;">' + (t.activo ? t.icono : '🔒') + '</span>' +
                '<span style="min-width:0;">' +
                    '<span style="display:block;font-size:1.05rem;font-weight:800;color:' + t.color + ';">' + _esc(t.titulo) + '</span>' +
                    '<span style="display:block;font-size:0.78rem;color:#c9d1d9;margin-top:0.2rem;">' +
                        _esc(t.activo ? t.desc : t.motivo) +
                    '</span>' +
                '</span>' +
            '</button>';
    }

    // Los extras del club llegan por una escucha (role-launch.js) que puede
    // terminar un instante DESPUÉS de abrir el panel: sin esperar, la tarjeta
    // de vídeos saldría bloqueada al entrar. Se espera un poco (máx. 3 s).
    function _esperaExtras(me) {
        if (!me || (me.extras && typeof me.extras === 'object')) return Promise.resolve();
        return new Promise((res) => {
            let n = 0;
            const t = setInterval(() => {
                const yo = window._cronosCurrentUser;
                if (++n >= 15 || (yo && yo.extras && typeof yo.extras === 'object')) { clearInterval(t); res(); }
            }, 200);
        });
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
        await _esperaExtras(me);

        let panel = document.getElementById('directivo-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'directivo-panel';
            document.body.appendChild(panel);
        }
        panel.style.cssText =
            'position:fixed;inset:0;background:#0a0e14;z-index:8000;' +
            'display:flex;flex-direction:column;overflow:hidden;font-family:inherit;';

        const tarjetas =
            _tarjeta({ id: 'dv-envivo', onclick: 'window.cronosDirectivoEnVivo()', activo: _vivoActivo(), motivo: MOTIVO_VIVO(),
                       icono: '🔴', titulo: 'Partidos en Vivo', color: '#ff5858',
                       desc: 'Todos los partidos que se están jugando ahora mismo.',
                       fondo: 'rgba(255,88,88,0.12)', borde: 'rgba(255,88,88,0.45)' }) +
            // 🎬 v812 · Vídeos de jugadas (extra modulo_videos).
            _tarjeta({ id: 'dv-videos', onclick: 'window.cronosDirectivoVideos()', activo: _videosActivo(), motivo: MOTIVO_VIDEOS,
                       icono: '🎬', titulo: 'Vídeos', color: '#d2a8ff',
                       desc: 'Clips de los sucesos: una vista por cuenta, con marca de agua; se borran a las 24 h.',
                       fondo: 'rgba(210,168,255,0.10)', borde: 'rgba(210,168,255,0.45)' });

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
                        (clubName ? _esc(clubName) : 'tu club') + ' ahora mismo, de cualquier categoría, y ves los vídeos de sus jugadas.' +
                    '</div>' +
                    tarjetas +
                '</div>' +
            '</div>';
    }

    window.openDirectivoPanel = openDirectivoPanel;
    window.cronosDirectivoEnVivo = abrirEnVivo;
    window.cronosDirectivoVideos = abrirVideos;
})();

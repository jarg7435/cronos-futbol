// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — match-unlocks.js
//  🔓 v797 · Permiso de desbloqueo de un partido cerrado
// ════════════════════════════════════════════════════════════════════
//
//  Encargo del autor (implementar.txt 2026-10-11):
//    1 · Los sucesos se añaden libremente en directo o en las 2 h
//        siguientes al final. Pasadas, el partido queda bloqueado.
//    2 · Para añadirlos después por «Registrar sucesos offline», el
//        entrenador necesita que el Director Deportivo o el Coordinador le
//        concedan permiso PARA ESE PARTIDO CONCRETO.
//
//  🔑 UN DOCUMENTO POR PARTIDO: `cronos_match_unlocks/{matchId}`.
//      status  'pending'  → lo ha pedido el entrenador
//              'granted'  → concedido, hasta `expiresAt` (24 h)
//              'denied'   → denegado
//              'revoked'  → retirado antes de caducar
//  El entrenador sólo puede escribir 'pending'; decidir es de la autoridad
//  del club. Lo hace cumplir firestore.rules (bloque cronos_match_unlocks)
//  y el permiso lo consume `lmDesbloqueado()` en live_matches.
//
//  ⚠️ ESTE FICHERO ES INTERFAZ Y TRANSPORTE. Quién puede conceder lo deciden
//  las reglas; aquí sólo se enseña el botón a quien tiene sentido verlo.
//
//  Dos usuarios:
//    · el modal de sucesos offline (retroactive-modal.js): `leer`,
//      `solicitar`, `estado`;
//    · el Panel de Dirección / Coordinación (club-reports.js): la pestaña
//      «Desbloqueos» (`renderPanel`) y su aviso de pendientes
//      (`pintarBadge`).
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const FS_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
    const COL = 'cronos_match_unlocks';

    const _esc = (s) => (typeof window.escapeHtml === 'function')
        ? window.escapeHtml(String(s == null ? '' : s))
        : String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function _db() {
        const fa = window._cronos_auth;
        return (fa && fa.db) ? fa.db : null;
    }

    function _toMs(v) {
        if (v == null) return 0;
        try {
            if (typeof v.toDate === 'function') return v.toDate().getTime();
            if (typeof v.seconds === 'number') return v.seconds * 1000;
            if (typeof v === 'number') return v;
            if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
        } catch (e) { /* como ausente */ }
        return 0;
    }

    function _horaCorta(ms) {
        if (!ms) return '';
        const d = new Date(ms);
        const hoy = new Date();
        const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        return d.toDateString() === hoy.toDateString()
            ? hora
            : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
    }

    function _nombreDe(me) {
        if (!me) return '';
        const n = (typeof window._ccNombreDe === 'function') ? window._ccNombreDe(me) : '';
        return n || me.displayName || me.firstName || me.email || '';
    }

    function _rolActivo(me) {
        return (me && (me._activeRole || me.role)) || '';
    }

    // 'none' | 'pending' | 'granted' | 'expired' | 'denied' | 'revoked'
    // ⚠️ La vigencia la decide CronosMatchLock.unlockValid (la misma que mira
    // el candado), no una copia de la cuenta.
    function estado(u, ahoraMs) {
        if (!u || !u.status) return 'none';
        if (u.status === 'granted') {
            const lock = window.CronosMatchLock;
            const vale = (lock && typeof lock.unlockValid === 'function')
                ? lock.unlockValid(u, ahoraMs)
                : (_toMs(u.expiresAt) > (typeof ahoraMs === 'number' ? ahoraMs : Date.now()));
            return vale ? 'granted' : 'expired';
        }
        if (u.status === 'pending' || u.status === 'denied' || u.status === 'revoked') return u.status;
        return 'none';
    }

    // ── Lectura de UN permiso (o null si no existe / no se puede leer) ──
    async function leer(matchId) {
        const db = _db();
        if (!db || !matchId) return null;
        try {
            const fs = await import(FS_URL);
            const snap = await fs.getDoc(fs.doc(db, COL, String(matchId)));
            return snap.exists() ? Object.assign({ id: snap.id }, snap.data()) : null;
        } catch (e) {
            console.warn('[v797] No se pudo leer el permiso de', matchId, e && e.message);
            return null;
        }
    }

    // ── El entrenador PIDE el desbloqueo ───────────────────────────────
    //  `p` = { matchId, matchLabel, matchDate, teamId, category, subcategory,
    //          reason }. Se escribe con `merge` para reabrir una solicitud
    //  denegada sin tocar los campos de la decisión anterior (las reglas sólo
    //  le dejan tocar los suyos).
    async function solicitar(p) {
        const db = _db();
        const me = window._cronosCurrentUser || {};
        if (!db || !p || !p.matchId || !me.uid) return { ok: false, motivo: 'sin-sesion' };
        const clubId = me.clubId || me.individualEntityId || null;
        if (!clubId) return { ok: false, motivo: 'sin-club' };
        try {
            const fs = await import(FS_URL);
            const txt = (v, n) => String(v == null ? '' : v).slice(0, n || 120);
            await fs.setDoc(fs.doc(db, COL, String(p.matchId)), {
                matchId:     String(p.matchId),
                clubId:      clubId,
                coachUid:    me.uid,
                coachName:   txt(_nombreDe(me), 80),
                teamId:      txt(p.teamId),
                category:    txt(p.category, 40),
                subcategory: txt(p.subcategory, 10),
                matchLabel:  txt(p.matchLabel, 160),
                matchDate:   txt(p.matchDate, 40),
                reason:      txt(p.reason, 300),
                status:      'pending',
                requestedAt: fs.serverTimestamp(),
            }, { merge: true });
            return { ok: true };
        } catch (e) {
            console.warn('[v797] Solicitud de desbloqueo no guardada:', e && e.message);
            return { ok: false, motivo: (e && e.code) || 'error' };
        }
    }

    // ── La autoridad DECIDE ────────────────────────────────────────────
    async function decidir(matchId, decision) {
        const db = _db();
        const me = window._cronosCurrentUser || {};
        if (!db || !matchId || !me.uid) return false;
        if (['granted', 'denied', 'revoked'].indexOf(decision) < 0) return false;
        try {
            const fs = await import(FS_URL);
            const lock = window.CronosMatchLock;
            const dur = (lock && lock.UNLOCK_MS) || 24 * 60 * 60 * 1000;
            const rol = _rolActivo(me);
            const upd = {
                status:        decision,
                decidedBy:     me.uid,
                decidedByName: _nombreDe(me).slice(0, 80),
                decidedRole:   rol === 'coordinator' ? 'coordinator'
                             : rol === 'club_admin' ? 'club_admin'
                             : ((window.CRONOS_ROLES_INDIVIDUALES || []).indexOf(rol) >= 0
                                || rol === 'individual_admin') ? 'individual_admin'
                             : 'director',
                decidedAt:     fs.serverTimestamp(),
            };
            // ⚠️ La caducidad se calcula en el cliente y se manda como Timestamp:
            // las reglas exigen que caiga entre ahora y ahora + 25 h, así que un
            // reloj desajustado no puede regalar un permiso eterno.
            if (decision === 'granted') upd.expiresAt = fs.Timestamp.fromMillis(Date.now() + dur);
            await fs.updateDoc(fs.doc(db, COL, String(matchId)), upd);
            return true;
        } catch (e) {
            console.warn('[v797] Decisión de desbloqueo no guardada:', e && e.message);
            return false;
        }
    }

    // ── Todos los permisos del club, filtrados por el alcance del que mira ──
    //  Sin `orderBy`: no hace falta índice compuesto y el volumen es pequeño
    //  (uno por partido que alguien haya pedido desbloquear). Se ordena aquí.
    // 🔓 v798 · `clubIdForzado`: el panel del ENTE pasa su id, que en esa
    // cuenta puede vivir en `individualEntityId` y no en `clubId`.
    async function listarClub(me, clubIdForzado) {
        const db = _db();
        me = me || window._cronosCurrentUser || {};
        const clubId = clubIdForzado || me.clubId || me.individualEntityId || null;
        if (!db || !clubId) return [];
        try {
            const fs = await import(FS_URL);
            const snap = await fs.getDocs(fs.query(fs.collection(db, COL), fs.where('clubId', '==', clubId)));
            const out = [];
            snap.forEach(d => out.push(Object.assign({ id: d.id }, d.data())));
            // 🎯 El coordinador acotado a una modalidad (v593) sólo ve SUS
            // equipos, igual que en el resto del panel.
            const ve = (typeof window._cronosVeCategoria === 'function')
                ? (u) => window._cronosVeCategoria(me, u.category) : () => true;
            return out.filter(ve).sort((a, b) =>
                (_toMs(b.requestedAt) || _toMs(b.decidedAt)) - (_toMs(a.requestedAt) || _toMs(a.decidedAt)));
        } catch (e) {
            console.warn('[v797] No se pudieron listar los permisos del club:', e && e.message);
            return [];
        }
    }

    // ── El aviso de pendientes sobre la tarjeta del tablero ────────────
    //  Mismo contrato que `ubPintarBadge`: el hueco se pinta oculto y se
    //  rellena cuando llega el dato; si ya no está, no se hace nada.
    async function pintarBadge(elId, clubId) {
        if (!document.getElementById(elId)) return;
        let n = 0;
        try { n = (await listarClub(null, clubId)).filter(u => estado(u) === 'pending').length; } catch (_) { return; }
        const el = document.getElementById(elId);
        if (!el) return;
        if (!n) { el.style.display = 'none'; el.textContent = ''; return; }
        el.textContent = n > 99 ? '99+' : String(n);
        el.style.display = '';
        el.title = n === 1 ? '1 solicitud de desbloqueo pendiente' : n + ' solicitudes de desbloqueo pendientes';
    }

    // ════════════════════════════════════════════════════════════════
    //  LA PESTAÑA «DESBLOQUEOS» DEL PANEL DE DIRECCIÓN / COORDINACIÓN
    // ════════════════════════════════════════════════════════════════
    const _ETIQ = {
        pending: { txt: '⏳ PENDIENTE',  col: '#f0883e' },
        granted: { txt: '🔓 CONCEDIDO',  col: '#3fb950' },
        expired: { txt: '⌛ CADUCADO',   col: '#7d8590' },
        denied:  { txt: '⛔ DENEGADO',   col: '#ff5858' },
        revoked: { txt: '↩️ REVOCADO',   col: '#7d8590' },
    };

    function _tarjeta(u) {
        const st = estado(u);
        const et = _ETIQ[st] || _ETIQ.pending;
        const nombreEquipo = (typeof window.cronosNombreCategoria === 'function' && u.category)
            ? window.cronosNombreCategoria(u.category, u.subcategory || '')
            : [u.category, u.subcategory].filter(Boolean).join(' ');
        const id = _esc(u.id);
        const quien = u.decidedByName ? ' por ' + _esc(u.decidedByName) : '';
        let detalle = '';
        if (st === 'pending') detalle = 'Pedido ' + _esc(_horaCorta(_toMs(u.requestedAt)));
        if (st === 'granted') detalle = 'Concedido' + quien + ' · vale hasta las ' + _esc(_horaCorta(_toMs(u.expiresAt)));
        if (st === 'expired') detalle = 'Concedido' + quien + ' · caducó ' + _esc(_horaCorta(_toMs(u.expiresAt)));
        if (st === 'denied')  detalle = 'Denegado' + quien + ' ' + _esc(_horaCorta(_toMs(u.decidedAt)));
        if (st === 'revoked') detalle = 'Revocado' + quien + ' ' + _esc(_horaCorta(_toMs(u.decidedAt)));

        const btn = (accion, texto, col) =>
            '<button type="button" onclick="window.CronosUnlocks._accion(\'' + id + '\',\'' + accion + '\')" ' +
            'style="padding:0.45rem 0.8rem;border-radius:8px;cursor:pointer;font-weight:800;font-size:0.78rem;' +
            'background:rgba(' + col + ',0.14);border:1px solid rgba(' + col + ',0.45);color:rgb(' + col + ');">' +
            texto + '</button>';
        let acciones = '';
        if (st === 'pending') acciones = btn('granted', '🔓 Conceder 24 h', '63,185,80') + btn('denied', '⛔ Denegar', '255,88,88');
        if (st === 'granted') acciones = btn('revoked', '↩️ Revocar', '255,88,88');

        return '' +
        '<div style="background:rgba(255,255,255,0.03);border:1px solid ' + et.col + '55;border-radius:12px;' +
                    'padding:0.85rem 1rem;margin-bottom:0.7rem;display:flex;justify-content:space-between;' +
                    'align-items:center;flex-wrap:wrap;gap:0.8rem;">' +
            '<div style="min-width:0;flex:1 1 260px;">' +
                '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">' +
                    '<span style="font-weight:800;color:white;font-size:0.9rem;">' + _esc(u.matchLabel || u.matchId) + '</span>' +
                    '<span style="font-size:0.62rem;font-weight:800;padding:2px 6px;border-radius:5px;color:' + et.col + ';' +
                          'border:1px solid ' + et.col + '66;background:' + et.col + '1f;">' + et.txt + '</span>' +
                '</div>' +
                '<div style="font-size:0.74rem;color:#8b949e;line-height:1.45;">' +
                    '👤 ' + _esc(u.coachName || 'Entrenador') +
                    (nombreEquipo ? ' · ' + _esc(nombreEquipo) : '') +
                    (u.matchDate ? ' · 📅 ' + _esc(u.matchDate) : '') +
                    '<br>' + detalle +
                    (u.reason ? '<br>💬 «' + _esc(u.reason) + '»' : '') +
                '</div>' +
            '</div>' +
            (acciones ? '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' + acciones + '</div>' : '') +
        '</div>';
    }

    let _contenedorPanel = null;
    let _clubPanel = null;

    // `clubId` sólo lo pasa el panel del ente (v798); Dirección usa el suyo.
    async function renderPanel(containerId, clubId) {
        if (containerId) { _contenedorPanel = containerId; _clubPanel = clubId || null; }
        _contenedorPanel = _contenedorPanel || 'staff-dashboard-content';
        const cont = document.getElementById(_contenedorPanel);
        if (!cont) return;
        const lista = await listarClub(null, _clubPanel);
        const vivo = document.getElementById(_contenedorPanel);
        if (!vivo) return;

        const pend = lista.filter(u => estado(u) === 'pending');
        const vig  = lista.filter(u => estado(u) === 'granted');
        const hist = lista.filter(u => ['expired', 'denied', 'revoked'].indexOf(estado(u)) >= 0).slice(0, 15);
        const seccion = (titulo, items, vacio) =>
            '<h3 style="font-size:0.9rem;color:white;margin:1.1rem 0 0.6rem;">' + titulo +
            ' <span style="color:#7d8590;font-weight:600;">(' + items.length + ')</span></h3>' +
            (items.length ? items.map(_tarjeta).join('')
                          : '<div style="font-size:0.78rem;color:#7d8590;padding:0.4rem 0 0.2rem;">' + vacio + '</div>');

        vivo.innerHTML =
            '<div style="font-size:0.8rem;color:#8b949e;background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.2);' +
                        'border-radius:10px;padding:0.75rem 0.9rem;line-height:1.5;">' +
                '🔒 Un partido admite sucesos en directo y durante las <strong style="color:white;">2 horas</strong> siguientes a su final. ' +
                'Después queda cerrado, y el entrenador sólo puede añadir sucesos olvidados si se lo concedes aquí, ' +
                '<strong style="color:white;">partido a partido</strong>. El permiso dura 24 h y lo puedes revocar cuando quieras. ' +
                'Todo lo que se añada así aparece en los informes <em>en cursiva</em> y con el icono en <span style="color:#ff4d4f;font-weight:800;">rojo</span>.' +
            '</div>' +
            seccion('⏳ Solicitudes pendientes', pend, 'No hay solicitudes pendientes.') +
            seccion('🔓 Permisos en vigor', vig, 'Ningún partido desbloqueado ahora mismo.') +
            seccion('🗂️ Historial reciente', hist, 'Sin movimientos.');
    }

    // Botones de la pestaña. Se confirma antes: un permiso concedido por un
    // toque accidental abre un partido cerrado.
    async function _accion(matchId, decision) {
        const textos = {
            granted: '¿Conceder 24 h al entrenador para añadir sucesos a este partido?\n\n' +
                     'Lo que añada saldrá marcado como posterior al encuentro.',
            denied:  '¿Denegar la solicitud de desbloqueo?',
            revoked: '¿Revocar el permiso? El partido vuelve a quedar cerrado al momento.',
        };
        if (!confirm(textos[decision] || '¿Confirmar?')) return;
        const ok = await decidir(matchId, decision);
        if (typeof showToast === 'function') {
            showToast(ok
                ? (decision === 'granted' ? '🔓 Partido desbloqueado durante 24 h.'
                   : decision === 'denied' ? '⛔ Solicitud denegada.' : '↩️ Permiso revocado.')
                : '⚠️ No se ha podido guardar. Comprueba la conexión o tus permisos.', ok ? 3500 : 6000);
        }
        await renderPanel();
    }

    window.CronosUnlocks = {
        COL: COL,
        estado: estado,
        leer: leer,
        solicitar: solicitar,
        decidir: decidir,
        listarClub: listarClub,
        pintarBadge: pintarBadge,
        renderPanel: renderPanel,
        horaCorta: _horaCorta,
        toMs: _toMs,
        _accion: _accion,
    };
})();
